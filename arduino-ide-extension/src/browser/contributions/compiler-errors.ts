import {
  Command,
  CommandRegistry,
  Disposable,
  DisposableCollection,
  Emitter,
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
  readonly p2m: ProtocolToMonacoConverter;
  @inject(MonacoToProtocolConverter)
  readonly mp2: MonacoToProtocolConverter;

  @inject(CoreErrorHandler)
  private readonly coreErrorHandler: CoreErrorHandler;

  private readonly errors: ErrorDecoration[] = [];
  private readonly onDidChangeEmitter = new monaco.Emitter<this>();
  private readonly currentErrorDidChangEmitter = new Emitter<ErrorDecoration>();
  private readonly onCurrentErrorDidChange =
    this.currentErrorDidChangEmitter.event;
  private readonly toDisposeOnCompilerErrorDidChange =
    new DisposableCollection();
  private currentError: ErrorDecoration | undefined;
  private shell: ApplicationShell | undefined;

  override onStart(app: FrontendApplication): void {
    this.shell = app.shell;
    monaco.languages.registerCodeLensProvider(InoSelector, this);
    this.coreErrorHandler.onCompilerErrorsDidChange((errors) =>
      this.handleCompilerErrorsDidChange(errors)
    );
    this.onCurrentErrorDidChange(async (error) => {
      const range = await ErrorDecoration.rangeOf(error, (uri) =>
        this.monacoEditor(uri)
      );
      if (!range) {
        console.warn(`Could not find range of decoration: ${error.id}`);
        return;
      }
      this.revealLocationInEditor({
        uri: error.uri,
        range: this.mp2.asRange(range),
      }).then((editor) => {
        if (!editor) {
          console.warn(`Failed to mark error ${error.id} as the current one.`);
        }
      });
    });
  }

  override registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(CompilerErrors.Commands.REVEAL_NEXT_ERROR, {
      execute: (currentError: ErrorDecoration) => {
        const index = this.errors.findIndex((candidate) =>
          ErrorDecoration.sameAs(candidate, currentError)
        );
        if (index < 0) {
          console.warn(
            `Could not advance to next error. ${currentError.id} is not a known error.`
          );
          return;
        }
        const nextError =
          index === this.errors.length - 1
            ? this.errors[0]
            : this.errors[index + 1];
        this.markAsCurrentError(nextError);
      },
    });
    registry.registerCommand(CompilerErrors.Commands.REVEAL_PREVIOUS_ERROR, {
      execute: (currentError: ErrorDecoration) => {
        const index = this.errors.findIndex((candidate) =>
          ErrorDecoration.sameAs(candidate, currentError)
        );
        if (index < 0) {
          console.warn(
            `Could not advance to previous error. ${currentError.id} is not a known error.`
          );
          return;
        }
        const previousError =
          index === 0
            ? this.errors[this.errors.length - 1]
            : this.errors[index - 1];
        this.markAsCurrentError(previousError);
      },
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
              id: CompilerErrors.Commands.REVEAL_PREVIOUS_ERROR.id,
              title: 'Go to Previous Error',
              arguments: [this.currentError],
            },
          },
          {
            range,
            command: {
              id: CompilerErrors.Commands.REVEAL_NEXT_ERROR.id,
              title: 'Go to Next Error',
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
    const compilerErrorsPerResource = this.groupByResource(errors);
    const decorations = await this.decorateEditors(compilerErrorsPerResource);
    this.errors.push(...decorations.errors);
    this.toDisposeOnCompilerErrorDidChange.pushAll([
      Disposable.create(() => (this.errors.length = 0)),
      ...(await Promise.all([
        decorations.dispose,
        this.trackEditorsSelection(compilerErrorsPerResource),
      ])),
    ]);
    const first = this.errors[0];
    if (first) {
      await this.markAsCurrentError(first);
    }
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
        this.editorManager.getByUri(new URI(uri)).then((e) => {
          if (e) {
            e.editor.deltaDecorations({ oldDecorations, newDecorations: [] });
          }
        });
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
        stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
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
          if (editor.editor instanceof MonacoEditor) {
            const control = editor.editor.getControl();
            console.log(typeof control);
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
      return (
        candidateErrorRange.intersectRanges(currentSelection) ||
        (candidateErrorRange.startLineNumber <=
          currentSelection.startLineNumber &&
          candidateErrorRange.endLineNumber >= currentSelection.endLineNumber)
      );
    };
    const error = await this.errors
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
    const { uri, range: selection } = location;
    const editor = await this.editorManager.getByUri(new URI(uri), {
      mode: 'activate',
      selection,
    });
    if (editor && this.shell) {
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
    export const REVEAL_NEXT_ERROR: Command = {
      id: 'arduino-reveal-next-error',
    };
    export const REVEAL_PREVIOUS_ERROR: Command = {
      id: 'arduino-reveal-previous-error',
    };
  }
}
