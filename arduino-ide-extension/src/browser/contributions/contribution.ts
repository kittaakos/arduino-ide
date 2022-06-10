import {
  inject,
  injectable,
  interfaces,
  postConstruct,
} from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { ILogger } from '@theia/core/lib/common/logger';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MaybePromise } from '@theia/core/lib/common/types';
import { LabelProvider } from '@theia/core/lib/browser/label-provider';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { TextEditor } from '@theia/editor/lib/browser/editor';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import type { Range } from '@theia/core/shared/vscode-languageserver-protocol';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { TrackedRangeStickiness } from '@theia/editor/lib/browser/decorations/editor-decoration';
import {
  MenuModelRegistry,
  MenuContribution,
} from '@theia/core/lib/common/menu';
import {
  KeybindingRegistry,
  KeybindingContribution,
} from '@theia/core/lib/browser/keybinding';
import {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import {
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser/frontend-application';
import {
  Command,
  CommandRegistry,
  CommandContribution,
  CommandService,
} from '@theia/core/lib/common/command';
import { EditorMode } from '../editor-mode';
import { SettingsService } from '../dialogs/settings/settings';
import {
  CurrentSketch,
  SketchesServiceClientImpl,
} from '../../common/protocol/sketches-service-client-impl';
import {
  SketchesService,
  ConfigService,
  FileSystemExt,
  Sketch,
  CoreService,
  CoreError,
} from '../../common/protocol';
import { ArduinoPreferences } from '../arduino-preferences';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';

export {
  Command,
  CommandRegistry,
  MenuModelRegistry,
  KeybindingRegistry,
  TabBarToolbarRegistry,
  URI,
  Sketch,
  open,
};

@injectable()
export abstract class Contribution
  implements
    CommandContribution,
    MenuContribution,
    KeybindingContribution,
    TabBarToolbarContribution,
    FrontendApplicationContribution
{
  @inject(ILogger)
  protected readonly logger: ILogger;

  @inject(MessageService)
  protected readonly messageService: MessageService;

  @inject(CommandService)
  protected readonly commandService: CommandService;

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService;

  @inject(EditorMode)
  protected readonly editorMode: EditorMode;

  @inject(LabelProvider)
  protected readonly labelProvider: LabelProvider;

  @inject(SettingsService)
  protected readonly settingsService: SettingsService;

  @inject(FrontendApplicationStateService)
  protected readonly appStateService: FrontendApplicationStateService;

  @postConstruct()
  protected init(): void {
    this.appStateService.reachedState('ready').then(() => this.onReady());
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function, unused-imports/no-unused-vars
  onStart(app: FrontendApplication): MaybePromise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function, unused-imports/no-unused-vars
  registerCommands(registry: CommandRegistry): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function, unused-imports/no-unused-vars
  registerMenus(registry: MenuModelRegistry): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function, unused-imports/no-unused-vars
  registerKeybindings(registry: KeybindingRegistry): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function, unused-imports/no-unused-vars
  registerToolbarItems(registry: TabBarToolbarRegistry): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onReady(): MaybePromise<void> {}
}

@injectable()
export abstract class SketchContribution extends Contribution {
  @inject(FileService)
  protected readonly fileService: FileService;

  @inject(FileSystemExt)
  protected readonly fileSystemExt: FileSystemExt;

  @inject(ConfigService)
  protected readonly configService: ConfigService;

  @inject(SketchesService)
  protected readonly sketchService: SketchesService;

  @inject(OpenerService)
  protected readonly openerService: OpenerService;

  @inject(SketchesServiceClientImpl)
  protected readonly sketchServiceClient: SketchesServiceClientImpl;

  @inject(ArduinoPreferences)
  protected readonly preferences: ArduinoPreferences;

  @inject(EditorManager)
  protected readonly editorManager: EditorManager;

  @inject(OutputChannelManager)
  protected readonly outputChannelManager: OutputChannelManager;

  protected async sourceOverride(): Promise<Record<string, string>> {
    const override: Record<string, string> = {};
    const sketch = await this.sketchServiceClient.currentSketch();
    if (CurrentSketch.isValid(sketch)) {
      for (const editor of this.editorManager.all) {
        const uri = editor.editor.uri;
        if (Saveable.isDirty(editor) && Sketch.isInSketch(uri, sketch)) {
          override[uri.toString()] = editor.editor.document.getText();
        }
      }
    }
    return override;
  }
}

@injectable()
export class CoreServiceContribution extends SketchContribution {
  @inject(CoreService)
  protected readonly coreService: CoreService;

  private shell: ApplicationShell | undefined;
  /**
   * Keys are the file URIs per editor, the values are the delta decorations to remove before creating new ones.
   */
  private readonly editorDecorations = new Map<string, string[]>();

  override onStart(app: FrontendApplication): MaybePromise<void> {
    this.shell = app.shell;
  }

  protected async discardEditorMarkers(): Promise<void> {
    return new Promise<void>((resolve) => {
      Promise.all(
        Array.from(this.editorDecorations.entries()).map(
          async ([uri, decorations]) => {
            const editor = await this.editorManager.getByUri(new URI(uri));
            if (editor) {
              editor.editor.deltaDecorations({
                oldDecorations: decorations,
                newDecorations: [],
              });
            }
            this.editorDecorations.delete(uri);
          }
        )
      ).then(() => resolve());
    });
  }

  /**
   * The returning promise resolves when the error was handled. Rejects if the error could not be handled.
   */
  protected handleError(error: unknown): void {
    this.tryHighlightErrorLocation(error);
    this.tryToastErrorMessage(error);
  }

  private tryHighlightErrorLocation(error: unknown): void {
    if (CoreError.is(error)) {
      const {
        data: { location },
      } = error;
      if (location) {
        const { uri, line, column } = location;
        const start = {
          line: line - 1,
          character: typeof column !== 'number' ? 0 : column - 1,
        };
        // The double editor activation logic is apparently required: https://github.com/eclipse-theia/theia/issues/11284;
        this.editorManager
          .getByUri(new URI(uri), { mode: 'activate', selection: { start } })
          .then(async (editor) => {
            if (editor && this.shell) {
              await this.shell.activateWidget(editor.id);
              this.markErrorLocationInEditor(editor.editor, {
                start,
                end: { ...start, character: 1 << 30 },
              });
            }
          });
      }
    }
  }

  private markErrorLocationInEditor(editor: TextEditor, range: Range): void {
    this.editorDecorations.set(
      editor.uri.toString(),
      editor.deltaDecorations({
        oldDecorations: [],
        newDecorations: [
          {
            range,
            options: {
              isWholeLine: true,
              className: 'core-error',
              stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
          },
        ],
      })
    );
  }

  private tryToastErrorMessage(error: unknown): void {
    let message: undefined | string = undefined;
    if (CoreError.is(error)) {
      message = error.message;
    } else if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    } else {
      try {
        message = JSON.stringify(error);
      } catch {}
    }
    if (message) {
      this.messageService.error(message);
    } else {
      throw error;
    }
  }
}

export namespace Contribution {
  export function configure(
    bind: interfaces.Bind,
    serviceIdentifier: typeof Contribution
  ): void {
    bind(serviceIdentifier).toSelf().inSingletonScope();
    bind(CommandContribution).toService(serviceIdentifier);
    bind(MenuContribution).toService(serviceIdentifier);
    bind(KeybindingContribution).toService(serviceIdentifier);
    bind(TabBarToolbarContribution).toService(serviceIdentifier);
    bind(FrontendApplicationContribution).toService(serviceIdentifier);
  }
}
