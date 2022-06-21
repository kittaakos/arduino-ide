import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { ILogger } from '@theia/core/lib/common/logger';
import { MockLogger } from '@theia/core/lib/common/test/mock-logger';
import { EnvVariablesServerImpl } from '@theia/core/lib/node/env-variables/env-variables-server';
import { Container, injectable } from '@theia/core/shared/inversify';
import { expect } from 'chai';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as temp from 'temp';
import {
  ArduinoDaemon,
  BoardsService,
  ConfigService,
  NotificationServiceServer,
  ResponseService,
} from '../../common/protocol';
import { ArduinoDaemonImpl } from '../../node/arduino-daemon-impl';
import { BoardDiscovery } from '../../node/board-discovery';
import { BoardsServiceImpl } from '../../node/boards-service-impl';
import { ConfigServiceImpl } from '../../node/config-service-impl';
import { CoreClientProvider } from '../../node/core-client-provider';
import { NotificationServiceServerImpl } from '../../node/notification-service-server';

const track = temp.track();

describe('core-client-provider', () => {
  function createTestContainer(): Container {
    const container = new Container({ defaultScope: 'Singleton' });
    container.bind(ConfigServiceImpl).toSelf().inSingletonScope();
    container.bind(ConfigService).toService(ConfigServiceImpl);
    container.bind(ArduinoDaemonImpl).toSelf().inSingletonScope();
    container.bind(ArduinoDaemon).toService(ArduinoDaemonImpl);
    container.bind(BoardsServiceImpl).toSelf().inSingletonScope();
    container.bind(BoardsService).toService(BoardsServiceImpl);
    container.bind(ILogger).to(MockLogger);
    container.bind(NoopResponseService).toSelf();
    container.bind(ResponseService).toService(NoopResponseService);
    container.bind(NotificationServiceServerImpl).toSelf();
    container
      .bind(NotificationServiceServer)
      .toService(NotificationServiceServerImpl);
    container.bind(NoopBoardDiscovery).toSelf();
    container.bind(BoardDiscovery).toService(NoopBoardDiscovery);
    container.bind(CoreClientProvider).toSelf();
    container.bind(EnvVariablesServerImpl).toSelf();
    container.bind(EnvVariablesServer).toService(EnvVariablesServerImpl);
    return container;
  }
  async function assertCoreClientCanStart(
    tempConfigDir: string,
    cliConfig: string
  ) {
    const originalConfigDirPath = process.env.THEIA_CONFIG_DIR;
    try {
      process.env.THEIA_CONFIG_DIR = tempConfigDir;
      await fs.writeFile(join(tempConfigDir, 'arduino-cli.yaml'), cliConfig, {
        encoding: 'utf8',
      });
      const container = createTestContainer();
      await Promise.all([
        container.get<ConfigServiceImpl>(ConfigServiceImpl).onStart(),
        container.get<ArduinoDaemonImpl>(ArduinoDaemonImpl).onStart(),
      ]);
      const boardService = container.get<BoardsService>(BoardsService);
      const packages = await boardService.search({});
      expect(packages).to.be.not.empty;
    } finally {
      delete process.env.THEIA_CONFIG_DIR;
      if (originalConfigDirPath) {
        process.env.THEIA_CONFIG_DIR = originalConfigDirPath;
      }
    }
  }
  it('should automatically update indexes on first run', async () => {
    const tempConfigDir = track.mkdirSync();
    await assertCoreClientCanStart(
      tempConfigDir,
      `board_manager:
  additional_urls: []
directories:
  data: ${join(tempConfigDir, 'Arduino15')}
  downloads: ${join(tempConfigDir, 'Arduino15', 'staging')}
  user: ${join(tempConfigDir, 'Arduino')}
  `
    );
  });

  it('should start if any 3rd party URL is invalid', async () => {
    const tempConfigDir = track.mkdirSync();
    await assertCoreClientCanStart(
      tempConfigDir,
      `board_manager:
  additional_urls: [
    "https://downloads.arduino.cc/packages/package_nonexistent_index.json"
  ]
directories:
  data: ${join(tempConfigDir, 'Arduino15')}
  downloads: ${join(tempConfigDir, 'Arduino15', 'staging')}
  user: ${join(tempConfigDir, 'Arduino')}
  `
    );
  });

  afterEach(() => track.cleanupSync());
});

@injectable()
class NoopResponseService implements ResponseService {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  appendToOutput(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  reportProgress(): void {}
}
@injectable()
class NoopBoardDiscovery extends BoardDiscovery {
  protected override async init(): Promise<void> {
    // does not watch board changes.
  }
}
