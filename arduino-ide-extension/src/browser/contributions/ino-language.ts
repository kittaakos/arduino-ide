import { Mutex } from 'async-mutex';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
  ArduinoDaemon,
  Board,
  BoardsService,
  ExecutableService,
} from '../../common/protocol';
import { HostedPluginEvents } from '../hosted-plugin-events';
import { SketchContribution, URI } from './contribution';
import { CurrentSketch } from '../../common/protocol/sketches-service-client-impl';
import { BoardsServiceProvider } from '../boards/boards-service-provider';
import { NotificationCenter } from '../notification-center';

@injectable()
export class InoLanguage extends SketchContribution {
  @inject(HostedPluginEvents)
  private readonly hostedPluginEvents: HostedPluginEvents;

  @inject(ExecutableService)
  private readonly executableService: ExecutableService;

  @inject(ArduinoDaemon)
  private readonly daemon: ArduinoDaemon;

  @inject(BoardsService)
  private readonly boardsService: BoardsService;

  @inject(BoardsServiceProvider)
  private readonly boardsServiceProvider: BoardsServiceProvider;

  @inject(NotificationCenter)
  private readonly notificationCenter: NotificationCenter;

  private languageServerFqbn?: string;
  private languageServerStartMutex = new Mutex();

  override onReady(): void {
    this.boardsServiceProvider.onBoardsConfigChanged(
      ({ selectedBoard: board }) =>
        this.start({ board, trigger: 'boards config did change' })
    );
    this.hostedPluginEvents.onPluginsDidStart(() =>
      this.start({
        board: this.boardsServiceProvider.boardsConfig.selectedBoard,
        trigger: 'hosted plugins did start',
      })
    );
    this.hostedPluginEvents.onPluginsWillUnload(
      () => (this.languageServerFqbn = undefined)
    );
    this.notificationCenter.onIndexDidUpdate(() =>
      this.start({
        board: this.boardsServiceProvider.boardsConfig.selectedBoard,
        trigger: 'index did update',
        forceStart: true,
      })
    );
    this.preferences.onPreferenceChanged(
      ({ preferenceName, oldValue, newValue }) => {
        if (oldValue !== newValue) {
          switch (preferenceName) {
            case 'arduino.language.log':
            case 'arduino.language.realTimeDiagnostics':
              this.start({
                board: this.boardsServiceProvider.boardsConfig.selectedBoard,
                trigger: `'${preferenceName}' preference did change`,
                forceStart: true,
              });
          }
        }
      }
    );
    this.start({
      board: this.boardsServiceProvider.boardsConfig.selectedBoard,
      trigger: 'on IDE start',
    });
  }

  private async start({
    board,
    forceStart,
    trigger,
  }: {
    board: Board | undefined;
    forceStart?: boolean;
    trigger: string;
  }): Promise<void> {
    if (board) {
      const { name, fqbn } = board;
      if (fqbn) {
        this.startLanguageServer({ fqbn, name, trigger, forceStart });
      }
    } else {
      console.info(
        `Skipping language server start request for trigger '${trigger}'. No board was selected.`
      );
    }
  }

  private async startLanguageServer({
    fqbn,
    name,
    forceStart,
    trigger,
  }: {
    fqbn: string;
    name: string | undefined;
    forceStart?: boolean;
    trigger: string;
  }): Promise<void> {
    console.info(
      `[ino-language]: >>> Requested language server ${
        !!forceStart ? 'force' : ''
      } start for '${fqbn}' with trigger '${trigger}'...`
    );
    const [port] = await Promise.all([
      this.daemon.tryGetPort(),
      this.hostedPluginEvents.didStart,
    ]);
    if (!port) {
      console.info(
        `[ino-language]: <<< Could not retrieve the port of the running CLI daemon. Skipping.`
      );
      return;
    }
    const release = await this.languageServerStartMutex.acquire();
    try {
      const details = await this.boardsService.getBoardDetails({ fqbn });
      if (!details) {
        // Core is not installed for the selected board.
        console.info(
          `[ino-language]: <<< Could not start language server for ${fqbn}. The core is not installed for the board. Skipping.`
        );
        if (this.languageServerFqbn) {
          console.info(
            `[ino-language]: >>> Detected a running language server for ${this.languageServerFqbn}. Requesting stop.`
          );
          try {
            await this.commandService.executeCommand(
              'arduino.languageserver.stop'
            );
            console.info(
              `[ino-language]: <<< Stopped language server process for ${this.languageServerFqbn}.`
            );
            this.languageServerFqbn = undefined;
          } catch (e) {
            console.error(
              `Failed to start language server process for ${this.languageServerFqbn}`,
              e
            );
            throw e;
          }
        }
        return;
      }
      if (!forceStart && fqbn === this.languageServerFqbn) {
        console.info(
          `[ino-language]: Received request to start the language server for ${this.languageServerFqbn}. The language server is already up and running. Trigger was '${trigger}'. Skipping.`
        );
        // NOOP
        return;
      }
      this.logger.info(
        `[ino-language]: >>> Starting language server: ${fqbn} for trigger '${trigger}'...`
      );
      const log = this.preferences.get('arduino.language.log');
      const realTimeDiagnostics = this.preferences.get(
        'arduino.language.realTimeDiagnostics'
      );
      let currentSketchPath: string | undefined = undefined;
      if (log) {
        const currentSketch = await this.sketchServiceClient.currentSketch();
        if (CurrentSketch.isValid(currentSketch)) {
          currentSketchPath = await this.fileService.fsPath(
            new URI(currentSketch.uri)
          );
        }
      }
      const { clangdUri, lsUri } = await this.executableService.list();
      const [clangdPath, lsPath] = await Promise.all([
        this.fileService.fsPath(new URI(clangdUri)),
        this.fileService.fsPath(new URI(lsUri)),
      ]);

      const startParams = {
        lsPath,
        cliDaemonAddr: `localhost:${port}`,
        clangdPath,
        log: currentSketchPath ? currentSketchPath : log,
        cliDaemonInstance: '1',
        board: {
          fqbn,
          name: name ? `"${name}"` : undefined,
        },
        realTimeDiagnostics,
        silentOutput: true,
      };
      this.logger.info(
        `[ino-language]: >>> Start parameters: ${JSON.stringify(startParams)}`
      );
      this.languageServerFqbn = await Promise.race([
        new Promise<undefined>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${20_000} ms.`)),
            20_000
          )
        ),
        this.commandService.executeCommand<string>(
          'arduino.languageserver.start',
          startParams
        ),
      ]);
      this.logger.info(
        `[ino-language]: <<< Started language server: ${fqbn} for trigger '${trigger}'.`
      );
    } catch (e) {
      console.log(`Failed to start language server for ${fqbn}`, e);
      this.languageServerFqbn = undefined;
    } finally {
      release();
    }
  }
}
