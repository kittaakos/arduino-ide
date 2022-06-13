import {
  Command,
  CommandRegistry,
  Disposable,
  DisposableCollection,
  Emitter,
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
import { ProtocolToMonacoConverter } from '@theia/monaco/lib/browser/protocol-to-monaco-converter';
import { CoreError } from '../../common/protocol/core-service';
import { InoSelector } from '../ino-selectors';
import { Contribution } from './contribution';
import { CoreErrorHandler } from './core-error-handler';

@injectable()
export class CompilerErrors
  extends Contribution
  implements monaco.languages.CodeLensProvider
{
  @inject(EditorManager)
  private readonly editorManager: EditorManager;

  @inject(ProtocolToMonacoConverter)
  readonly p2m: ProtocolToMonacoConverter;

  @inject(CoreErrorHandler)
  private readonly coreErrorHandler: CoreErrorHandler;

  private readonly errors: CoreError.Compiler[] = [];
  private currentError: CoreError.Compiler | undefined;
  /**
   * monaco API to rerender the code lens.
   */
  private readonly onDidChangeEmitter = new monaco.Emitter<this>();
  private readonly currentErrorDidChangEmitter =
    new Emitter<CoreError.Compiler>();
  private readonly onCurrentErrorDidChange =
    this.currentErrorDidChangEmitter.event;
  private readonly toDisposeOnCompilerErrorDidChange =
    new DisposableCollection();
  private shell: ApplicationShell | undefined;

  override onStart(app: FrontendApplication): void {
    this.shell = app.shell;
    monaco.languages.registerCodeLensProvider(InoSelector, this);
    this.coreErrorHandler.onCompilerErrorsDidChange((errors) =>
      this.handleCompilerErrorsDidChange(errors)
    );
    this.onCurrentErrorDidChange(async (error) =>
      this.revealLocationInEditor(error.location).then((editor) => {
        if (!editor) {
          console.warn(
            `Failed to mark error ${CoreError.Compiler.toString(
              error
            )} as the current one.`
          );
        }
      })
    );
  }

  override registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(CompilerErrors.Commands.REVEAL_NEXT_ERROR, {
      execute: (currentError: CoreError.Compiler) => {
        const index = this.errors.findIndex((candidate) =>
          CoreError.Compiler.sameAs(candidate, currentError)
        );
        if (index < 0) {
          console.warn(
            `Could not advance to next error. ${CoreError.Compiler.toString(
              currentError
            )} is not a known error.`
          );
          return;
        }
        const nextError =
          index === this.errors.length - 1
            ? this.errors[0]
            : this.errors[index];
        this.markAsCurrentError(nextError);
      },
    });
    registry.registerCommand(CompilerErrors.Commands.REVEAL_PREVIOUS_ERROR, {
      execute: (currentError: CoreError.Compiler) => {
        const index = this.errors.findIndex((candidate) =>
          CoreError.Compiler.sameAs(candidate, currentError)
        );
        if (index < 0) {
          console.warn(
            `Could not advance to previous error. ${CoreError.Compiler.toString(
              currentError
            )} is not a known error.`
          );
          return;
        }
        const previousError =
          index === 0
            ? this.errors[this.errors.length - 1]
            : this.errors[index];
        this.markAsCurrentError(previousError);
      },
    });
  }

  get onDidChange(): monaco.IEvent<this> {
    return this.onDidChangeEmitter.event;
  }

  provideCodeLenses(
    model: monaco.editor.ITextModel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: monaco.CancellationToken
  ): monaco.languages.ProviderResult<monaco.languages.CodeLensList> {
    const lenses: monaco.languages.CodeLens[] = [];
    if (
      this.currentError &&
      this.currentError.location.uri === model.uri.toString() &&
      this.errors.length > 1
    ) {
      lenses.push(
        {
          range: this.p2m.asRange(this.currentError.location.range),
          command: {
            id: CompilerErrors.Commands.REVEAL_PREVIOUS_ERROR.id,
            title: 'Go to Previous Error',
            arguments: [this.currentError],
          },
        },
        {
          range: this.p2m.asRange(this.currentError.location.range),
          command: {
            id: CompilerErrors.Commands.REVEAL_NEXT_ERROR.id,
            title: 'Go to Next Error',
            arguments: [this.currentError],
          },
        }
      );
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
    this.errors.push(...errors);
    const compilerErrorsPerResource = this.groupByResource(this.errors);
    this.toDisposeOnCompilerErrorDidChange.pushAll([
      Disposable.create(() => (this.errors.length = 0)),
      ...(await Promise.all([
        this.decorateEditors(compilerErrorsPerResource),
        this.trackEditorsSelection(compilerErrorsPerResource),
      ])),
    ]);
    const first = errors[0];
    if (first) {
      await this.markAsCurrentError(first);
    }
  }

  private async decorateEditors(
    errors: Map<string, CoreError.Compiler[]>
  ): Promise<Disposable> {
    return new DisposableCollection(
      ...(await Promise.all(
        [...errors.entries()].map(([uri, errors]) =>
          this.decorateEditor(uri, errors)
        )
      ))
    );
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

  private async decorateEditor(
    uri: string,
    errors: CoreError.Compiler[]
  ): Promise<Disposable> {
    const editor = await this.editorManager.getByUri(new URI(uri));
    if (!editor) {
      return Disposable.NULL;
    }
    const oldDecorations = editor.editor.deltaDecorations({
      oldDecorations: [],
      newDecorations: errors.map((error) =>
        this.compilerErrorDecoration(error.location.range)
      ),
    });
    return Disposable.create(() => {
      this.editorManager.getByUri(new URI(uri)).then((e) => {
        if (e) {
          e.editor.deltaDecorations({ oldDecorations, newDecorations: [] });
        }
      });
    });
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
          return editor.editor.onSelectionChanged((selection) =>
            this.handleSelectionChange(uri, selection)
          );
        })
      ))
    );
  }

  private handleSelectionChange(uri: string, selection: Range) {
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
    const error = this.errors
      .filter((error) => error.location.uri === uri)
      .find((error) =>
        intersectsError(this.p2m.asRange(error.location.range), monacoSelection)
      );
    if (error) {
      this.markAsCurrentError(error);
    } else {
      console.info(
        `New (monaco) selection ${monacoSelection.toJSON()} does not intersect any error locations. Skipping.`
      );
    }
  }

  private async markAsCurrentError(error: CoreError.Compiler): Promise<void> {
    const index = this.errors.findIndex((candidate) =>
      CoreError.Compiler.sameAs(candidate, error)
    );
    if (index < 0) {
      console.warn(
        `Failed to mark error ${CoreError.Compiler.toString(
          error
        )} as the current one. Error is unknown. Known errors are: ${this.errors.map(
          CoreError.Compiler.toString
        )}`
      );
      return;
    }
    this.currentError = this.errors[index];
    console.log(
      `Current error changed to ${CoreError.Compiler.toString(
        this.currentError
      )}`
    );
    this.currentErrorDidChangEmitter.fire(this.currentError);
    this.onDidChangeEmitter.fire(this);
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
