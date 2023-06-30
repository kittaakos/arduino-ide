import {
  CommandContribution,
  CommandRegistry,
  CommandService,
} from '@theia/core/lib/common/command';
import { bindContributionProvider } from '@theia/core/lib/common/contribution-provider';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { EnvVariablesServer as TheiaEnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { ILogger, Loggable } from '@theia/core/lib/common/logger';
import { LogLevel } from '@theia/core/lib/common/logger-protocol';
import { waitForEvent } from '@theia/core/lib/common/promise-util';
import { MockLogger } from '@theia/core/lib/common/test/mock-logger';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/node/file-uri';
import { ProcessUtils } from '@theia/core/lib/node/process-utils';
import {
  Container,
  ContainerModule,
  injectable,
  interfaces,
} from '@theia/core/shared/inversify';
import deepmerge from 'deepmerge';
import { promises as fs, mkdirSync } from 'node:fs';
import { dump as dumpYaml } from 'js-yaml';
import { join } from 'node:path';
import { path as tempPath, track } from 'temp';
import {
  ArduinoDaemon,
  AttachedBoardsChangeEvent,
  AvailablePorts,
  BoardsPackage,
  BoardsService,
  ConfigService,
  ConfigState,
  CoreService,
  IndexUpdateDidCompleteParams,
  IndexUpdateDidFailParams,
  IndexUpdateParams,
  LibraryPackage,
  LibraryService,
  NotificationServiceClient,
  NotificationServiceServer,
  OutputMessage,
  ProgressMessage,
  ResponseService,
  Sketch,
  SketchesService,
} from '../../common/protocol';
import { ArduinoDaemonImpl } from '../../node/arduino-daemon-impl';
import { BoardDiscovery } from '../../node/board-discovery';
import { BoardsServiceImpl } from '../../node/boards-service-impl';
import { CLI_CONFIG, CliConfig, DefaultCliConfig } from '../../node/cli-config';
import { ConfigServiceImpl } from '../../node/config-service-impl';
import { CoreClientProvider } from '../../node/core-client-provider';
import { CoreServiceImpl } from '../../node/core-service-impl';
import { IsTempSketch } from '../../node/is-temp-sketch';
import { LibraryServiceImpl } from '../../node/library-service-impl';
import { MonitorManager } from '../../node/monitor-manager';
import { MonitorService } from '../../node/monitor-service';
import {
  MonitorServiceFactory,
  MonitorServiceFactoryOptions,
} from '../../node/monitor-service-factory';
import { SettingsReader } from '../../node/settings-reader';
import { SketchesServiceImpl } from '../../node/sketches-service-impl';
import {
  ConfigDirUriProvider,
  EnvVariablesServer,
} from '../../node/theia/env-variables/env-variables-server';

const tracked = track();

@injectable()
class ConsoleLogger extends MockLogger {
  override log(
    logLevel: number,
    arg2: string | Loggable | Error,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...params: any[]
  ): Promise<void> {
    if (arg2 instanceof Error) {
      return this.error(String(arg2), params);
    }
    switch (logLevel) {
      case LogLevel.INFO:
        return this.info(arg2, params);
      case LogLevel.WARN:
        return this.warn(arg2, params);
      case LogLevel.TRACE:
        return this.trace(arg2, params);
      case LogLevel.ERROR:
        return this.error(arg2, params);
      case LogLevel.FATAL:
        return this.fatal(arg2, params);
      default:
        return this.info(arg2, params);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async info(arg: string | Loggable, ...params: any[]): Promise<void> {
    if (params.length) {
      console.info(arg, ...params);
    } else {
      console.info(arg);
    }
  }

  override async trace(
    arg: string | Loggable,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...params: any[]
  ): Promise<void> {
    if (params.length) {
      console.trace(arg, ...params);
    } else {
      console.trace(arg);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async warn(arg: string | Loggable, ...params: any[]): Promise<void> {
    if (params.length) {
      console.warn(arg, ...params);
    } else {
      console.warn(arg);
    }
  }

  override async error(
    arg: string | Loggable,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...params: any[]
  ): Promise<void> {
    if (params.length) {
      console.error(arg, ...params);
    } else {
      console.error(arg);
    }
  }

  override async fatal(
    arg: string | Loggable,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...params: any[]
  ): Promise<void> {
    return this.error(arg, params);
  }
}

@injectable()
class SilentArduinoDaemon extends ArduinoDaemonImpl {
  protected override onData(): void {
    //  NOOP
  }
}

@injectable()
class TestBoardDiscovery extends BoardDiscovery {
  mutableAvailablePorts: AvailablePorts = {};

  override async start(): Promise<void> {
    // NOOP
  }
  override async stop(): Promise<void> {
    // NOOP
  }
  override get availablePorts(): AvailablePorts {
    return this.mutableAvailablePorts;
  }
}

@injectable()
class TestNotificationServiceServer implements NotificationServiceServer {
  readonly events: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  disposeClient(client: NotificationServiceClient): void {
    this.events.push('disposeClient:');
  }
  notifyDidReinitialize(): void {
    this.events.push('notifyDidReinitialize:');
  }
  notifyIndexUpdateWillStart(params: IndexUpdateParams): void {
    this.events.push(`notifyIndexUpdateWillStart:${JSON.stringify(params)}`);
  }
  notifyIndexUpdateDidProgress(progressMessage: ProgressMessage): void {
    this.events.push(
      `notifyIndexUpdateDidProgress:${JSON.stringify(progressMessage)}`
    );
  }
  notifyIndexUpdateDidComplete(params: IndexUpdateDidCompleteParams): void {
    this.events.push(`notifyIndexUpdateDidComplete:${JSON.stringify(params)}`);
  }
  notifyIndexUpdateDidFail(params: IndexUpdateDidFailParams): void {
    this.events.push(`notifyIndexUpdateDidFail:${JSON.stringify(params)}`);
  }
  notifyDaemonDidStart(port: number): void {
    this.events.push(`notifyDaemonDidStart:${port}`);
  }
  notifyDaemonDidStop(): void {
    this.events.push('notifyDaemonDidStop:');
  }
  notifyConfigDidChange(event: ConfigState): void {
    this.events.push(`notifyConfigDidChange:${JSON.stringify(event)}`);
  }
  notifyPlatformDidInstall(event: { item: BoardsPackage }): void {
    this.events.push(`notifyPlatformDidInstall:${JSON.stringify(event)}`);
  }
  notifyPlatformDidUninstall(event: { item: BoardsPackage }): void {
    this.events.push(`notifyPlatformDidUninstall:${JSON.stringify(event)}`);
  }
  notifyLibraryDidInstall(event: {
    item: LibraryPackage | 'zip-install';
  }): void {
    this.events.push(`notifyLibraryDidInstall:${JSON.stringify(event)}`);
  }
  notifyLibraryDidUninstall(event: { item: LibraryPackage }): void {
    this.events.push(`notifyLibraryDidUninstall:${JSON.stringify(event)}`);
  }
  notifyAttachedBoardsDidChange(event: AttachedBoardsChangeEvent): void {
    this.events.push(`notifyAttachedBoardsDidChange:${JSON.stringify(event)}`);
  }
  notifyRecentSketchesDidChange(event: { sketches: Sketch[] }): void {
    this.events.push(`notifyRecentSketchesDidChange:${JSON.stringify(event)}`);
  }
  dispose(): void {
    this.events.push('dispose:');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  setClient(client: NotificationServiceClient | undefined): void {
    this.events.push('setClient:');
  }
}

@injectable()
class TestResponseService implements ResponseService {
  readonly outputMessages: OutputMessage[] = [];
  readonly progressMessages: ProgressMessage[] = [];

  appendToOutput(message: OutputMessage): void {
    this.outputMessages.push(message);
  }
  reportProgress(message: ProgressMessage): void {
    this.progressMessages.push(message);
  }
}

class TestConfigDirUriProvider extends ConfigDirUriProvider {
  constructor(private readonly configDirPath: string) {
    super();
  }

  override configDirUri(): URI {
    return FileUri.create(this.configDirPath);
  }
}

function shouldKeepTestFolder(): boolean {
  return (
    typeof process.env.ARDUINO_IDE__KEEP_TEST_FOLDER === 'string' &&
    /true/i.test(process.env.ARDUINO_IDE__KEEP_TEST_FOLDER)
  );
}

export function newTempConfigDirPath(
  prefix = 'arduino-ide--slow-tests'
): string {
  let tempDirPath;
  if (shouldKeepTestFolder()) {
    tempDirPath = tempPath(prefix);
    mkdirSync(tempDirPath, { recursive: true });
    console.log(
      `Detected ARDUINO_IDE__KEEP_TEST_FOLDER=true, keeping temporary test configuration folders: ${tempDirPath}`
    );
  } else {
    tempDirPath = tracked.mkdirSync();
  }
  return join(tempDirPath, '.testArduinoIDE');
}

interface CreateBaseContainerParams {
  readonly cliConfig?: CliConfig | (() => Promise<CliConfig>);
  readonly configDirPath?: string;
  readonly additionalBindings?: (
    bind: interfaces.Bind,
    rebind: interfaces.Rebind
  ) => void;
}

export async function createBaseContainer(
  params?: CreateBaseContainerParams
): Promise<Container> {
  const configDirUriProvider = new TestConfigDirUriProvider(
    params?.configDirPath || newTempConfigDirPath()
  );
  if (params?.cliConfig) {
    const config =
      typeof params.cliConfig === 'function'
        ? await params.cliConfig()
        : params.cliConfig;
    await writeCliConfigFile(
      FileUri.fsPath(configDirUriProvider.configDirUri()),
      config
    );
  }
  const container = new Container({ defaultScope: 'Singleton' });
  const module = new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(CoreClientProvider).toSelf().inSingletonScope();
    bind(CoreServiceImpl).toSelf().inSingletonScope();
    bind(CoreService).toService(CoreServiceImpl);
    bind(BoardsServiceImpl).toSelf().inSingletonScope();
    bind(BoardsService).toService(BoardsServiceImpl);
    bind(TestResponseService).toSelf().inSingletonScope();
    bind(ResponseService).toService(TestResponseService);
    bind(MonitorManager).toSelf().inSingletonScope();
    bind(MonitorServiceFactory).toFactory(
      ({ container }) =>
        (options: MonitorServiceFactoryOptions) => {
          const child = container.createChild();
          child
            .bind<MonitorServiceFactoryOptions>(MonitorServiceFactoryOptions)
            .toConstantValue({
              ...options,
            });
          child.bind(MonitorService).toSelf();
          return child.get<MonitorService>(MonitorService);
        }
    );
    bind(ConfigDirUriProvider).toConstantValue(configDirUriProvider);
    bind(EnvVariablesServer).toSelf().inSingletonScope();
    bind(TheiaEnvVariablesServer).toService(EnvVariablesServer);
    bind(SilentArduinoDaemon).toSelf().inSingletonScope();
    bind(ArduinoDaemon).toService(SilentArduinoDaemon);
    bind(ArduinoDaemonImpl).toService(SilentArduinoDaemon);
    bind(ConsoleLogger).toSelf().inSingletonScope();
    bind(ILogger).toService(ConsoleLogger);
    bind(TestNotificationServiceServer).toSelf().inSingletonScope();
    bind(NotificationServiceServer).toService(TestNotificationServiceServer);
    bind(ConfigServiceImpl).toSelf().inSingletonScope();
    bind(ConfigService).toService(ConfigServiceImpl);
    bind(CommandRegistry).toSelf().inSingletonScope();
    bind(CommandService).toService(CommandRegistry);
    bindContributionProvider(bind, CommandContribution);
    bind(TestBoardDiscovery).toSelf().inSingletonScope();
    bind(BoardDiscovery).toService(TestBoardDiscovery);
    bind(IsTempSketch).toSelf().inSingletonScope();
    bind(SketchesServiceImpl).toSelf().inSingletonScope();
    bind(SketchesService).toService(SketchesServiceImpl);
    bind(SettingsReader).toSelf().inSingletonScope();
    bind(LibraryServiceImpl).toSelf().inSingletonScope();
    bind(LibraryService).toService(LibraryServiceImpl);
    bind(ProcessUtils).toSelf().inSingletonScope();
    params?.additionalBindings?.(bind, rebind);
  });
  container.load(module);
  return container;
}

async function writeCliConfigFile(
  containerFolderPath: string,
  cliConfig: CliConfig
): Promise<void> {
  await fs.mkdir(containerFolderPath, { recursive: true });
  const yaml = dumpYaml(cliConfig);
  const cliConfigPath = join(containerFolderPath, CLI_CONFIG);
  await fs.writeFile(cliConfigPath, yaml);
  console.debug(`Created CLI configuration file at ${cliConfigPath}:
${yaml}
`);
}

export async function createCliConfig(
  configDirPath: string,
  configOverrides: Partial<DefaultCliConfig> = {}
): Promise<DefaultCliConfig> {
  const directories = {
    data: join(configDirPath, 'data', 'Arduino15'),
    downloads: join(configDirPath, 'data', 'Arduino15', 'staging'),
    builtin: join(configDirPath, 'data', 'Arduino15', 'libraries'),
    user: join(configDirPath, 'user', 'Arduino'),
  };
  for (const directoryPath of Object.values(directories)) {
    await fs.mkdir(directoryPath, { recursive: true });
  }
  const config = { directories };
  const mergedOverrides = deepmerge(configOverrides, <DefaultCliConfig>{
    logging: { level: 'trace' },
  });
  return deepmerge(config, mergedOverrides);
}

export async function startDaemon(
  container: Container,
  toDispose: DisposableCollection,
  startCustomizations?: (
    container: Container,
    toDispose: DisposableCollection
  ) => Promise<void>
): Promise<void> {
  const daemon = container.get<ArduinoDaemonImpl>(ArduinoDaemonImpl);
  const configService = container.get<ConfigServiceImpl>(ConfigServiceImpl);
  const coreClientProvider =
    container.get<CoreClientProvider>(CoreClientProvider);
  toDispose.push(Disposable.create(() => daemon.stop()));
  configService.onStart();
  daemon.onStart();
  await Promise.all([
    waitForEvent(daemon.onDaemonStarted, 10_000),
    coreClientProvider.client,
  ]);
  if (startCustomizations) {
    await startCustomizations(container, toDispose);
  }
}
