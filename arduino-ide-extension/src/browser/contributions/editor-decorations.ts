import { Disposable, DisposableCollection } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
  Location,
  Range,
} from '@theia/core/shared/vscode-languageserver-protocol';
import { CoreError } from '../../common/protocol/core-service';
import { Contribution } from './contribution';
import { CoreErrorHandler } from './core-error-handler';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EditorWidget } from '@theia/editor/lib/browser';
import { ApplicationShell, FrontendApplication } from '@theia/core/lib/browser';
import {
  EditorDecoration,
  TrackedRangeStickiness,
} from '@theia/editor/lib/browser/decorations/editor-decoration';

@injectable()
export class EditorDecorations extends Contribution {
  @inject(EditorManager)
  private readonly editorManager: EditorManager;

  @inject(CoreErrorHandler)
  private readonly coreErrorHandler: CoreErrorHandler;

  private shell: ApplicationShell | undefined;

  private readonly toDisposeOnCompilerErrorDidChange =
    new DisposableCollection();

  override onStart(app: FrontendApplication): void {
    this.shell = app.shell;
    this.coreErrorHandler.onCompilerErrorsDidChange((errors) =>
      this.handleCompilerErrorsDidChange(errors)
    );
  }

  private async handleCompilerErrorsDidChange(
    errors: CoreError.Compiler[]
  ): Promise<void> {
    this.toDisposeOnCompilerErrorDidChange.dispose();
    this.toDisposeOnCompilerErrorDidChange.pushAll(
      await Promise.all([
        this.decorateEditors(errors),
        this.registerCodeLens(errors),
      ])
    );
    const first = errors[0];
    if (first) {
      await this.revealLocationInEditor(first.location);
    }
  }

  private async decorateEditors(
    errors: CoreError.Compiler[]
  ): Promise<Disposable> {
    return new DisposableCollection(
      ...(await Promise.all(
        [
          ...errors
            .reduce((acc, curr) => {
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
            }, new Map<string, CoreError.Compiler[]>())
            .entries(),
        ].map(([uri, errors]) => this.decorateEditor(uri, errors))
      ))
    );
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

  private async registerCodeLens(
    errors: CoreError.Compiler[]
  ): Promise<Disposable> {
    return new DisposableCollection();
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
