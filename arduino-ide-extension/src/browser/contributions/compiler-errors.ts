import {
  Command,
  CommandRegistry,
  Disposable,
  DisposableCollection,
  Emitter,
  nls,
  notEmpty,
} from '@theia/core';
import { ApplicationShell, FrontendApplication } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
  Location,
  Range,
} from '@theia/core/shared/vscode-languageserver-protocol';
import { EditorWidget } from '@theia/editor/lib/browser';
import {
  EditorDecoration,
  TrackedRangeStickiness,
} from '@theia/editor/lib/browser/decorations/editor-decoration';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import * as monaco from '@theia/monaco-editor-core';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoToProtocolConverter } from '@theia/monaco/lib/browser/monaco-to-protocol-converter';
import { ProtocolToMonacoConverter } from '@theia/monaco/lib/browser/protocol-to-monaco-converter';
import { CoreError } from '../../common/protocol/core-service';
import { ArduinoPreferences } from '../arduino-preferences';
import { InoSelector } from '../ino-selectors';
import { fullRange } from '../utils/monaco';
import { Contribution } from './contribution';
import { CoreErrorHandler } from './core-error-handler';

interface ErrorDecoration {
  /**
   * This is the unique ID of the decoration given by `monaco`.
   */
  readonly id: string;
  /**
   * The resource this decoration belongs to.
   */
  readonly uri: string;
}
namespace ErrorDecoration {
  export async function rangeOf(
    { id, uri }: ErrorDecoration,
    editorProvider: (uri: string) => Promise<MonacoEditor | undefined>
  ): Promise<monaco.Range | undefined> {
    const editor = await editorProvider(uri);
    if (editor) {
      const control = editor.getControl();
      const model = control.getModel();
      if (model) {
        return control
          .getDecorationsInRange(fullRange(model))
          ?.find(({ id: candidateId }) => id === candidateId)?.range;
      }
    }
    return undefined;
  }
  export function sameAs(
    left: ErrorDecoration,
    right: ErrorDecoration
  ): boolean {
    return left.id === right.id && left.uri === right.uri;
  }
}

@injectable()
export class CompilerErrors
  extends Contribution
  implements monaco.languages.CodeLensProvider
{
  @inject(EditorManager)
  private readonly editorManager: EditorManager;

  @inject(ProtocolToMonacoConverter)
  private readonly p2m: ProtocolToMonacoConverter;

  @inject(MonacoToProtocolConverter)
  private readonly mp2: MonacoToProtocolConverter;

  @inject(CoreErrorHandler)
  private readonly coreErrorHandler: CoreErrorHandler;

  @inject(ArduinoPreferences)
  private readonly preferences: ArduinoPreferences;

  private readonly errors: ErrorDecoration[] = [];
  private readonly onDidChangeEmitter = new monaco.Emitter<this>();
  private readonly currentErrorDidChangEmitter = new Emitter<ErrorDecoration>();
  private readonly onCurrentErrorDidChange =
    this.currentErrorDidChangEmitter.event;
  private readonly toDisposeOnCompilerErrorDidChange =
    new DisposableCollection();
  private shell: ApplicationShell | undefined;
  private currentError: ErrorDecoration | undefined;
  private get currentErrorIndex(): number {
    const current = this.currentError;
    if (!current) {
      return -1;
    }
    return this.errors.findIndex((error) =>
      ErrorDecoration.sameAs(error, current)
    );
  }

  override onStart(app: FrontendApplication): void {
    this.shell = app.shell;
    monaco.languages.registerCodeLensProvider(InoSelector, this);
    this.coreErrorHandler.onCompilerErrorsDidChange((errors) =>
      this.filter(errors).then(this.handleCompilerErrorsDidChange.bind(this))
    );
    this.onCurrentErrorDidChange(async (error) => {
      const range = await ErrorDecoration.rangeOf(error, (uri) =>
        this.monacoEditor(uri)
      );
      if (!range) {
        console.warn(`Could not find range of decoration: ${error.id}`);
        return;
      }
      const editor = await this.revealLocationInEditor({
        uri: error.uri,
        range: this.mp2.asRange(range),
      });
      if (!editor) {
        console.warn(`Failed to mark error ${error.id} as the current one.`);
      }
    });
  }

  override registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(CompilerErrors.Commands.NEXT_ERROR, {
      execute: () => {
        const index = this.currentErrorIndex;
        if (index < 0) {
          console.warn(
            `Could not advance to next error. Unknown current error.`
          );
          return;
        }
        const nextError =
          this.errors[index === this.errors.length - 1 ? 0 : index + 1];
        this.markAsCurrentError(nextError);
      },
      isEnabled: () => !!this.currentError && this.errors.length > 1,
    });
    registry.registerCommand(CompilerErrors.Commands.PREVIOUS_ERROR, {
      execute: () => {
        const index = this.currentErrorIndex;
        if (index < 0) {
          console.warn(
            `Could not advance to previous error. Unknown current error.`
          );
          return;
        }
        const previousError =
          this.errors[index === 0 ? this.errors.length - 1 : index - 1];
        this.markAsCurrentError(previousError);
      },
      isEnabled: () => !!this.currentError && this.errors.length > 1,
    });
  }

  get onDidChange(): monaco.IEvent<this> {
    return this.onDidChangeEmitter.event;
  }

  async provideCodeLenses(
    model: monaco.editor.ITextModel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: monaco.CancellationToken
  ): Promise<monaco.languages.CodeLensList> {
    const lenses: monaco.languages.CodeLens[] = [];
    if (
      this.currentError &&
      this.currentError.uri === model.uri.toString() &&
      this.errors.length > 1
    ) {
      const range = await ErrorDecoration.rangeOf(this.currentError, (uri) =>
        this.monacoEditor(uri)
      );
      if (range) {
        lenses.push(
          {
            range,
            command: {
              id: CompilerErrors.Commands.PREVIOUS_ERROR.id,
              title: nls.localize(
                'arduino/editor/previousError',
                'Previous Error'
              ),
              arguments: [this.currentError],
            },
          },
          {
            range,
            command: {
              id: CompilerErrors.Commands.NEXT_ERROR.id,
              title: nls.localize('arduino/editor/nextError', 'Next Error'),
              arguments: [this.currentError],
            },
          }
        );
      }
    }
    return {
      lenses,
      dispose: () => {
        /* NOOP */
      },
    };
  }

  private async handleCompilerErrorsDidChange(
    errors: CoreError.Compiler[]
  ): Promise<void> {
    this.toDisposeOnCompilerErrorDidChange.dispose();
    const compilerErrorsPerResource = this.groupByResource(
      await this.filter(errors)
    );
    const decorations = await this.decorateEditors(compilerErrorsPerResource);
    this.errors.push(...decorations.errors);
    this.toDisposeOnCompilerErrorDidChange.pushAll([
      Disposable.create(() => (this.errors.length = 0)),
      Disposable.create(() => this.onDidChangeEmitter.fire(this)),
      ...(await Promise.all([
        decorations.dispose,
        this.trackEditorsSelection(compilerErrorsPerResource),
      ])),
    ]);
    const currentError = this.errors[0];
    if (currentError) {
      await this.markAsCurrentError(currentError);
    }
  }

  private async filter(
    errors: CoreError.Compiler[]
  ): Promise<CoreError.Compiler[]> {
    if (!errors.length) {
      return [];
    }
    await this.preferences.ready;
    if (this.preferences['arduino.compile.experimental']) {
      return errors;
    }
    // Always shows maximum one error; hence the code lens navigation is unavailable.
    return [errors[0]];
  }

  private async decorateEditors(
    errors: Map<string, CoreError.Compiler[]>
  ): Promise<{ dispose: Disposable; errors: ErrorDecoration[] }> {
    const composite = await Promise.all(
      [...errors.entries()].map(([uri, errors]) =>
        this.decorateEditor(uri, errors)
      )
    );
    return {
      dispose: new DisposableCollection(
        ...composite.map(({ dispose }) => dispose)
      ),
      errors: composite.reduce(
        (acc, { errors }) => acc.concat(errors),
        [] as ErrorDecoration[]
      ),
    };
  }

  private async decorateEditor(
    uri: string,
    errors: CoreError.Compiler[]
  ): Promise<{ dispose: Disposable; errors: ErrorDecoration[] }> {
    const editor = await this.editorManager.getByUri(new URI(uri));
    if (!editor) {
      return { dispose: Disposable.NULL, errors: [] };
    }
    const oldDecorations = editor.editor.deltaDecorations({
      oldDecorations: [],
      newDecorations: errors.map((error) =>
        this.compilerErrorDecoration(error.location.range)
      ),
    });
    return {
      dispose: Disposable.create(() => {
        if (editor) {
          editor.editor.deltaDecorations({
            oldDecorations,
            newDecorations: [],
          });
        }
      }),
      errors: oldDecorations.map((id) => ({ id, uri })),
    };
  }

  private compilerErrorDecoration(range: Range): EditorDecoration {
    return {
      range,
      options: {
        isWholeLine: true,
        className: 'core-error',
        stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
      },
    };
  }

  /**
   * Tracks the selection in all editors that have an error. If the editor selection overlaps one of the compiler error's range, mark as current error.
   */
  private async trackEditorsSelection(
    errors: Map<string, CoreError.Compiler[]>
  ): Promise<Disposable> {
    return new DisposableCollection(
      ...(await Promise.all(
        Array.from(errors.keys()).map(async (uri) => {
          const editor = await this.editorManager.getByUri(new URI(uri));
          if (!editor) {
            return Disposable.NULL;
          }
          return editor.editor.onSelectionChanged((selection) =>
            this.handleSelectionChange(uri, selection)
          );
        })
      ))
    );
  }

  private async handleSelectionChange(
    uri: string,
    selection: Range
  ): Promise<void> {
    const monacoSelection = this.p2m.asRange(selection);
    console.log(
      `Handling selection change in editor ${uri}. New (monaco) selection: ${monacoSelection.toJSON()}`
    );
    const intersectsError = (
      candidateErrorRange: monaco.Range,
      currentSelection: monaco.Range
    ) => {
      console.trace(`Candidate error range: ${candidateErrorRange.toJSON()}`);
      console.trace(`Current selection range: ${currentSelection.toJSON()}`);
      // if editor selection intersects with the error range or the selection is in one of the lines of an error.
      const result =
        candidateErrorRange.intersectRanges(currentSelection) ||
        (candidateErrorRange.startLineNumber <=
          currentSelection.startLineNumber &&
          candidateErrorRange.endLineNumber >= currentSelection.endLineNumber);
      console.trace(`Intersects: ${result}`);
      return result;
    };
    const error = (
      await Promise.all(
        this.errors
          .filter((error) => error.uri === uri)
          .map((error) => ({
            error,
            rangeOf: ErrorDecoration.rangeOf(error, (uri) =>
              this.monacoEditor(uri)
            ),
          }))
          .map(async ({ error, rangeOf }) => {
            const range = await rangeOf;
            if (range) {
              if (intersectsError(range, monacoSelection)) {
                return error;
              }
            }
            return undefined;
          })
      )
    )
      .filter(notEmpty)
      .shift();
    if (error) {
      this.markAsCurrentError(error);
    } else {
      console.info(
        `New (monaco) selection ${monacoSelection.toJSON()} does not intersect any error locations. Skipping.`
      );
    }
  }

  private async markAsCurrentError(error: ErrorDecoration): Promise<void> {
    const index = this.errors.findIndex((candidate) =>
      ErrorDecoration.sameAs(candidate, error)
    );
    if (index < 0) {
      console.warn(
        `Failed to mark error ${
          error.id
        } as the current one. Error is unknown. Known errors are: ${this.errors.map(
          ({ id }) => id
        )}`
      );
      return;
    }
    const newError = this.errors[index];
    if (
      !this.currentError ||
      !ErrorDecoration.sameAs(this.currentError, newError)
    ) {
      this.currentError = this.errors[index];
      console.log(`Current error changed to ${this.currentError.id}`);
      this.currentErrorDidChangEmitter.fire(this.currentError);
      this.onDidChangeEmitter.fire(this);
    }
  }

  // The double editor activation logic is required: https://github.com/eclipse-theia/theia/issues/11284
  private async revealLocationInEditor(
    location: Location
  ): Promise<EditorWidget | undefined> {
    const { uri, range } = location;
    const editor = await this.editorManager.getByUri(new URI(uri), {
      mode: 'activate',
    });
    if (editor && this.shell) {
      // to avoid flickering, reveal the range here and not with `getByUri`, because it uses `at: 'center'` for the reveal option.
      // TODO: check the community reaction whether it is better to set the focus at the error marker. it might cause flickering even if errors are close to each other
      editor.editor.revealRange(range, { at: 'centerIfOutsideViewport' });
      const activeWidget = await this.shell.activateWidget(editor.id);
      if (!activeWidget) {
        console.warn(
          `editor widget activation has failed. editor widget ${editor.id} expected to be the active one.`
        );
        return editor;
      }
      if (editor !== activeWidget) {
        console.warn(
          `active widget was not the same as previously activated editor. editor widget ID ${editor.id}, active widget ID: ${activeWidget.id}`
        );
      }
      return editor;
    }
    console.warn(`could not found editor widget for URI: ${uri}`);
    return undefined;
  }

  private groupByResource(
    errors: CoreError.Compiler[]
  ): Map<string, CoreError.Compiler[]> {
    return errors.reduce((acc, curr) => {
      const {
        location: { uri },
      } = curr;
      let errors = acc.get(uri);
      if (!errors) {
        errors = [];
        acc.set(uri, errors);
      }
      errors.push(curr);
      return acc;
    }, new Map<string, CoreError.Compiler[]>());
  }

  private async monacoEditor(uri: string): Promise<MonacoEditor | undefined> {
    const editorWidget = await this.editorManager.getByUri(new URI(uri));
    if (editorWidget) {
      const editor = editorWidget.editor;
      if (editor instanceof MonacoEditor) {
        return editor;
      }
    }
    return undefined;
  }
}
export namespace CompilerErrors {
  export namespace Commands {
    export const NEXT_ERROR: Command = {
      id: 'arduino-editor-next-error',
    };
    export const PREVIOUS_ERROR: Command = {
      id: 'arduino-editor-previous-error',
    };
  }
}
