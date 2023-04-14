import { DisposableCollection } from '@theia/core/lib/common/disposable';
import type { MaybePromise } from '@theia/core/lib/common/types';
import { FileUri } from '@theia/core/lib/node/file-uri';
import { Container } from '@theia/core/shared/inversify';
import { expect } from 'chai';
import { promises as fs } from 'fs';
import { join } from 'path';
import { sync as syncDelete } from 'rimraf';
import {
  BoardsService,
  CoreService,
  LibraryService,
} from '../../common/protocol';
import { CLI_CONFIG } from '../../node/cli-config';
import { BoardListRequest } from '../../node/cli-protocol/cc/arduino/cli/commands/v1/board_pb';
import { CoreClientProvider } from '../../node/core-client-provider';
import { ConfigDirUriProvider } from '../../node/theia/env-variables/env-variables-server';
import { ErrnoException } from '../../node/utils/errors';
import {
  createBaseContainer,
  createCliConfig,
  newTempConfigDirPath,
  startDaemon,
} from './test-bindings';

const timeout = 5 * 60 * 1_000; // five minutes

describe('core-client-provider', () => {
  let toDispose: DisposableCollection;

  beforeEach(() => (toDispose = new DisposableCollection()));
  afterEach(() => toDispose.dispose());

  it("should update no indexes when the 'directories.data' exists", async function () {
    this.timeout(timeout);
    const configDirPath = await prepareTestConfigDir();

    const container = await startCli(configDirPath, toDispose);
    await assertFunctionalCli(container, ({ coreClientProvider }) => {
      const { indexUpdateSummaryBeforeInit } = coreClientProvider;
      expect(indexUpdateSummaryBeforeInit).to.be.not.undefined;
      expect(indexUpdateSummaryBeforeInit).to.be.empty;
    });
  });

  it("should recover all when the 'directories.data' folder is missing", async function () {
    this.timeout(timeout);
    const configDirPath = await prepareTestConfigDir();
    syncDelete(join(configDirPath, 'data'));

    const now = new Date().toISOString();
    const container = await startCli(configDirPath, toDispose);
    await assertFunctionalCli(container, ({ coreClientProvider }) => {
      const { indexUpdateSummaryBeforeInit } = coreClientProvider;
      const libUpdateTimestamp = indexUpdateSummaryBeforeInit['library'];
      expect(libUpdateTimestamp).to.be.not.empty;
      expect(libUpdateTimestamp.localeCompare(now)).to.be.greaterThan(0);
      const platformUpdateTimestamp = indexUpdateSummaryBeforeInit['platform'];
      expect(platformUpdateTimestamp).to.be.not.empty;
      expect(platformUpdateTimestamp.localeCompare(now)).to.be.greaterThan(0);
    });
  });

  it("should recover when the primary package index file ('package_index.json') is missing", async function () {
    this.timeout(timeout);
    const configDirPath = await prepareTestConfigDir();
    const primaryPackageIndexPath = join(
      configDirPath,
      'data',
      'Arduino15',
      'package_index.json'
    );
    syncDelete(primaryPackageIndexPath);

    const now = new Date().toISOString();
    const container = await startCli(configDirPath, toDispose);
    await assertFunctionalCli(container, ({ coreClientProvider }) => {
      const { indexUpdateSummaryBeforeInit } = coreClientProvider;
      expect(indexUpdateSummaryBeforeInit['library']).to.be.undefined;
      const platformUpdateTimestamp = indexUpdateSummaryBeforeInit['platform'];
      expect(platformUpdateTimestamp).to.be.not.empty;
      expect(platformUpdateTimestamp.localeCompare(now)).to.be.greaterThan(0);
    });
    const rawJson = await fs.readFile(primaryPackageIndexPath, {
      encoding: 'utf8',
    });
    expect(rawJson).to.be.not.empty;
    const object = JSON.parse(rawJson);
    expect(object).to.be.not.empty;
  });

  ['serial-discovery', 'mdns-discovery'].map((tool) =>
    it(`should recover the platform tools when the 'tools/${tool}' location is missing inside the 'directories.data/packages' folder`, async function () {
      this.timeout(timeout);
      const configDirPath = await prepareTestConfigDir();
      const builtinToolsPath = join(
        configDirPath,
        'data',
        'Arduino15',
        'packages',
        'builtin',
        'tools',
        tool
      );
      syncDelete(builtinToolsPath);

      const container = await startCli(configDirPath, toDispose);
      await assertFunctionalCli(container, ({ coreClientProvider }) => {
        const { indexUpdateSummaryBeforeInit } = coreClientProvider;
        expect(indexUpdateSummaryBeforeInit).to.be.not.undefined;
        expect(indexUpdateSummaryBeforeInit).to.be.empty;
      });
      const toolVersions = await fs.readdir(builtinToolsPath);
      expect(toolVersions.length).to.be.greaterThanOrEqual(1);
    })
  );

  it("should recover when the library index file ('library_index.json') is missing", async function () {
    this.timeout(timeout);
    const configDirPath = await prepareTestConfigDir();
    const libraryPackageIndexPath = join(
      configDirPath,
      'data',
      'Arduino15',
      'library_index.json'
    );
    syncDelete(libraryPackageIndexPath);

    const now = new Date().toISOString();
    const container = await startCli(configDirPath, toDispose);
    await assertFunctionalCli(container, ({ coreClientProvider }) => {
      const { indexUpdateSummaryBeforeInit } = coreClientProvider;
      const libUpdateTimestamp = indexUpdateSummaryBeforeInit['library'];
      expect(libUpdateTimestamp).to.be.not.empty;
      expect(libUpdateTimestamp.localeCompare(now)).to.be.greaterThan(0);
      expect(indexUpdateSummaryBeforeInit['platform']).to.be.undefined;
    });
    const rawJson = await fs.readFile(libraryPackageIndexPath, {
      encoding: 'utf8',
    });
    expect(rawJson).to.be.not.empty;
    const object = JSON.parse(rawJson);
    expect(object).to.be.not.empty;
  });

  it('should recover when a 3rd party package index file is missing but the platform is not installed', async function () {
    this.timeout(timeout);
    const additionalUrls = [
      'https://www.pjrc.com/teensy/package_teensy_index.json',
    ];
    const assertTeensyAvailable = async (boardsService: BoardsService) => {
      const boardsPackages = await boardsService.search({});
      expect(
        boardsPackages.filter(({ id }) => id === 'teensy:avr').length
      ).to.be.equal(1);
    };
    const configDirPath = await prepareTestConfigDir(
      additionalUrls,
      ({ boardsService }) => assertTeensyAvailable(boardsService)
    );
    const thirdPartyPackageIndexPath = join(
      configDirPath,
      'data',
      'Arduino15',
      'package_teensy_index.json'
    );
    syncDelete(thirdPartyPackageIndexPath);

    const container = await startCli(configDirPath, toDispose);
    await assertFunctionalCli(
      container,
      async ({ coreClientProvider, boardsService, coreService }) => {
        const { indexUpdateSummaryBeforeInit } = coreClientProvider;
        expect(indexUpdateSummaryBeforeInit).to.be.not.undefined;
        expect(indexUpdateSummaryBeforeInit).to.be.empty;

        // IDE2 cannot recover from a 3rd party package index issue.
        // Only when the primary package or library index is corrupt.
        // https://github.com/arduino/arduino-ide/issues/2021
        await coreService.updateIndex({ types: ['platform'] });

        await assertTeensyAvailable(boardsService);
      }
    );
  });
});

interface Services {
  coreClientProvider: CoreClientProvider;
  coreService: CoreService;
  libraryService: LibraryService;
  boardsService: BoardsService;
}

async function assertFunctionalCli(
  container: Container,
  otherAsserts?: (services: Services) => MaybePromise<void>
): Promise<void> {
  const coreClientProvider =
    container.get<CoreClientProvider>(CoreClientProvider);
  const coreService = container.get<CoreService>(CoreService);
  const libraryService = container.get<LibraryService>(LibraryService);
  const boardsService = container.get<BoardsService>(BoardsService);
  expect(coreClientProvider).to.be.not.undefined;
  expect(coreService).to.be.not.undefined;
  expect(libraryService).to.be.not.undefined;
  expect(boardsService).to.be.not.undefined;

  const coreClient = coreClientProvider.tryGetClient;
  expect(coreClient).to.be.not.undefined;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { client, instance } = coreClient!;

  const installedBoards = await boardsService.getInstalledBoards();
  expect(installedBoards.length).to.be.equal(0);

  const libraries = await libraryService.search({
    query: 'cmaglie',
    type: 'Contributed',
  });
  expect(libraries.length).to.be.greaterThanOrEqual(1);
  expect(
    libraries.filter(({ name }) => name === 'KonnektingFlashStorage').length
  ).to.be.greaterThanOrEqual(1);

  // IDE2 runs `board list -w` equivalent, but running a single `board list`
  // is sufficient for the tests to check if the serial discover tool is OK.
  await new Promise<void>((resolve, reject) =>
    client.boardList(new BoardListRequest().setInstance(instance), (err) => {
      if (err) {
        reject(err);
      }
      resolve(); // The response does not matter. Tests must be relaxed. Maybe there are environments without a serial port?
    })
  );

  return otherAsserts?.({
    coreClientProvider,
    coreService,
    libraryService,
    boardsService,
  });
}

/**
 * Initializes the CLI by creating a temporary config folder including the correctly initialized
 * `directories.data` folder so that tests can corrupt it and test it the CLI initialization can recover.
 * The resolved path is pointing the temporary config folder. By the time the promise resolves, the CLI
 * daemon is stopped. This function should be used to initialize a correct `directories.data` folder and
 * the config folder.
 */
async function prepareTestConfigDir(
  additionalUrls: string[] = [],
  otherExpect?: (services: Services) => MaybePromise<void>
): Promise<string> {
  const toDispose = new DisposableCollection();
  const params = { configDirPath: newTempConfigDirPath(), additionalUrls };
  const container = await createContainer(params);
  try {
    await start(container, toDispose);
    await assertFunctionalCli(container, otherExpect);
    const configDirUriProvider =
      container.get<ConfigDirUriProvider>(ConfigDirUriProvider);
    return FileUri.fsPath(configDirUriProvider.configDirUri());
  } finally {
    toDispose.dispose();
  }
}

async function startCli(
  configDirPath: string,
  toDispose: DisposableCollection
): Promise<Container> {
  const cliConfigPath = join(configDirPath, CLI_CONFIG);
  try {
    await fs.readFile(cliConfigPath);
  } catch (err) {
    if (ErrnoException.isENOENT(err)) {
      throw new Error(
        `The CLI configuration was not found at ${cliConfigPath} when starting the tests.`
      );
    }
    throw err;
  }
  const container = await createContainer(configDirPath);
  await start(container, toDispose);
  return container;
}

async function start(
  container: Container,
  toDispose: DisposableCollection
): Promise<void> {
  await startDaemon(container, toDispose);
}

async function createContainer(
  params:
    | { configDirPath: string; additionalUrls: string[] }
    | string = newTempConfigDirPath()
): Promise<Container> {
  if (typeof params === 'string') {
    return createBaseContainer({ configDirPath: params });
  }
  const { configDirPath, additionalUrls } = params;
  const cliConfig = await createCliConfig(configDirPath, additionalUrls);
  return createBaseContainer({ configDirPath, cliConfig });
}
