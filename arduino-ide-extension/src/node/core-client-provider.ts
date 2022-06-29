import * as grpc from '@grpc/grpc-js';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { ArduinoCoreServiceClient } from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';
import { Instance } from './cli-protocol/cc/arduino/cli/commands/v1/common_pb';
import {
  CreateRequest,
  InitRequest,
  InitResponse,
  UpdateCoreLibrariesIndexResponse,
  UpdateIndexRequest,
  UpdateIndexResponse,
  UpdateLibrariesIndexRequest,
  UpdateLibrariesIndexResponse,
} from './cli-protocol/cc/arduino/cli/commands/v1/commands_pb';
import * as commandsGrpcPb from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';
import { NotificationServiceServer } from '../common/protocol';
import { Deferred, retry } from '@theia/core/lib/common/promise-util';
import {
  Status as RpcStatus,
  Status,
} from './cli-protocol/google/rpc/status_pb';
import { ConfigServiceImpl } from './config-service-impl';
import { ArduinoDaemonImpl } from './arduino-daemon-impl';
import { DisposableCollection, nls } from '@theia/core';
import { Disposable } from '@theia/core/shared/vscode-languageserver-protocol';
import { v4 } from 'uuid';
import { InstallWithProgress } from './grpc-installable';

@injectable()
export class CoreClientProvider {
  @inject(ArduinoDaemonImpl)
  private readonly daemon: ArduinoDaemonImpl;
  @inject(ConfigServiceImpl)
  private readonly configService: ConfigServiceImpl;
  @inject(NotificationServiceServer)
  private readonly notificationService: NotificationServiceServer;

  private ready = new Deferred<void>();
  private pending: Deferred<CoreClientProvider.Client> | undefined;
  private _client: CoreClientProvider.Client | undefined;
  private readonly toDisposeBeforeCreate = new DisposableCollection();
  private readonly toDisposeAfterDidCreate = new DisposableCollection();
  private readonly onClientReadyEmitter =
    new Emitter<CoreClientProvider.Client>();
  private readonly onClientReady = this.onClientReadyEmitter.event;

  @postConstruct()
  protected init(): void {
    this.daemon.getPort().then((port) => this.create(port));
    this.daemon.onDaemonStopped(() => {
      // TODO
    });
    this.configService.onConfigChange(async () => {
      const port = await this.daemon.getPort();
      this.create(port, 10); // Due to a config change, run the indexes update immediately.
    });
  }

  get tryGetClient(): CoreClientProvider.Client | undefined {
    return this._client;
  }

  get client(): Promise<CoreClientProvider.Client> {
    const client = this.tryGetClient;
    if (client) {
      return Promise.resolve(client);
    }
    if (!this.pending) {
      this.pending = new Deferred();
      this.toDisposeAfterDidCreate.pushAll([
        Disposable.create(() => (this.pending = undefined)),
        this.onClientReady((client) => {
          this.pending?.resolve(client);
          this.toDisposeAfterDidCreate.dispose();
        }),
      ]);
    }
    return this.pending.promise;
  }

  /**
   * Encapsulates both the gRPC core client creation (`CreateRequest`) and initialization (`InitRequest`).
   */
  private async create(
    port: string,
    indexesUpdateDelay = 10_000
  ): Promise<CoreClientProvider.Client> {
    this.toDisposeBeforeCreate.dispose();
    const address = this.address(port);
    const client = await this.createClient(address);
    this.toDisposeBeforeCreate.pushAll([
      Disposable.create(() => client.client.close()),
      Disposable.create(() => {
        this.ready.reject();
        this.ready = new Deferred();
      }),
    ]);
    // Normal startup workflow:
    // 1. create instance,
    // 2. init instance,
    // 3. update indexes asynchronously.

    // First startup workflow:
    // 1. create instance,
    // 2. update indexes and wait (to download the built-in pluggable tools, etc),
    // 3. init instance.
    try {
      await this.initInstance(client); // init the gRPC core client instance
      setTimeout(() => this.updateIndexes(client), indexesUpdateDelay); // Update the indexes asynchronously
      return this.useClient(client);
    } catch (error) {
      console.error(
        'Error occurred while initializing the core gRPC client provider',
        error
      );
      if (error instanceof IndexUpdateRequiredBeforeInitError) {
        // If it's a first start, IDE2 must run index update before the init request.
        await this.updateIndexes(client);
        await this.initInstance(client);
        return this.useClient(client);
      } else {
        throw error;
      }
    }
  }

  private async useClient(
    client: CoreClientProvider.Client
  ): Promise<CoreClientProvider.Client> {
    // TODO: why async? -> for local testing and `wait`
    this._client = client;
    this.onClientReadyEmitter.fire(this._client);
    return this._client;
  }

  private async createClient(
    address: string
  ): Promise<CoreClientProvider.Client> {
    // https://github.com/agreatfool/grpc_tools_node_protoc_ts/blob/master/doc/grpcjs_support.md#usage
    const ArduinoCoreServiceClient = grpc.makeClientConstructor(
      // @ts-expect-error: ignore
      commandsGrpcPb['cc.arduino.cli.commands.v1.ArduinoCoreService'],
      'ArduinoCoreServiceService'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;
    const client = new ArduinoCoreServiceClient(
      address,
      grpc.credentials.createInsecure(),
      this.channelOptions
    ) as ArduinoCoreServiceClient;

    const instance = await new Promise<Instance>((resolve, reject) => {
      client.create(new CreateRequest(), (err, resp) => {
        if (err) {
          reject(err);
          return;
        }
        const instance = resp.getInstance();
        if (!instance) {
          reject(
            new Error(
              'Could not retrieve instance from the initialize response.'
            )
          );
          return;
        }
        resolve(instance);
      });
    });

    return { instance, client };
  }

  private async initInstance({
    client,
    instance,
  }: CoreClientProvider.Client): Promise<void> {
    const initReq = new InitRequest();
    initReq.setInstance(instance);
    return new Promise<void>((resolve, reject) => {
      const stream = client.init(initReq);
      const errors: RpcStatus[] = [];
      stream.on('data', (res: InitResponse) => {
        const progress = res.getInitProgress();
        if (progress) {
          const downloadProgress = progress.getDownloadProgress();
          if (downloadProgress && downloadProgress.getCompleted()) {
            const file = downloadProgress.getFile();
            console.log(`Downloaded ${file}`);
          }
          const taskProgress = progress.getTaskProgress();
          if (taskProgress && taskProgress.getCompleted()) {
            const name = taskProgress.getName();
            console.log(`Completed ${name}`);
          }
        }

        const error = res.getError();
        if (error) {
          const { code, message } = Status.toObject(false, error);
          console.error(
            `Detected an error response during the gRPC core client initialization: code: ${code}, message: ${message}`
          );
          errors.push(error);
        }
      });
      stream.on('error', reject);
      stream.on('end', () => {
        const error = this.evaluateErrorStatus(errors);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private evaluateErrorStatus(status: RpcStatus[]): Error | undefined {
    const error = isIndexUpdateRequiredBeforeInit(status); // put future error matching here
    return error;
  }

  private async updateIndexes(
    client: CoreClientProvider.Client
  ): Promise<CoreClientProvider.Client> {
    const progressId = v4();
    // Note: at this point, the IDE2 backend might not have any connected clients, so this notification is not delivered to anywhere
    // Hence, clients must handle gracefully when no `willUpdate` is received only `didProgress`.
    this.notificationService.notifyIndexWillUpdate(progressId);
    const message = nls.localize(
      'arduino/updateIndex/progress',
      'Updating indexes'
    );
    let work = {
      done: 0,
      total: 2,
    };
    const reportProgress = () => {
      work = {
        ...work,
        done: work.done + 1,
      };
      this.notificationService.notifyIndexUpdateDidProgress({
        message,
        progressId,
        work,
      });
    };
    await Promise.all([
      retry(() => this.updateIndex(client, progressId), 50, 3).then(
        reportProgress
      ),
      retry(() => this.updateLibraryIndex(client, progressId), 50, 3).then(
        reportProgress
      ),
    ]);
    this.notificationService.notifyIndexDidUpdate(progressId);
    return client;
  }

  private async updateIndex(
    client: CoreClientProvider.Client,
    progressId: string
  ): Promise<void> {
    return this.doUpdateIndex(
      () =>
        client.client.updateIndex(
          new UpdateIndexRequest().setInstance(client.instance)
        ),
      progressId
    );
  }

  private async updateLibraryIndex(
    client: CoreClientProvider.Client,
    progressId: string
  ): Promise<void> {
    return this.doUpdateIndex(
      () =>
        client.client.updateLibrariesIndex(
          new UpdateLibrariesIndexRequest().setInstance(client.instance)
        ),
      progressId
    );
  }

  private async doUpdateIndex<
    R extends
      | UpdateIndexResponse
      | UpdateLibrariesIndexResponse
      | UpdateCoreLibrariesIndexResponse // not used by IDE2
  >(
    responseProvider: () => grpc.ClientReadableStream<R>,
    progressId: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      responseProvider()
        .on(
          'data',
          InstallWithProgress.createDataCallback({
            responseService: {
              appendToOutput: (message) => {
                console.log('core-client-provider', message.chunk);
              },
            },
            progressId,
          })
        )
        .on('error', reject)
        .on('end', resolve);
    });
  }

  private address(port: string): string {
    return `localhost:${port}`;
  }

  private get channelOptions(): Record<string, unknown> {
    return {
      'grpc.max_send_message_length': 512 * 1024 * 1024,
      'grpc.max_receive_message_length': 512 * 1024 * 1024,
      'grpc.primary_user_agent': `arduino-ide/${this.version}`,
    };
  }

  private _version: string | undefined;
  private get version(): string {
    if (this._version) {
      return this._version;
    }
    const json = require('../../package.json');
    if ('version' in json) {
      this._version = json.version;
    }
    if (!this._version) {
      this._version = '0.0.0';
    }
    return this._version;
  }
}
export namespace CoreClientProvider {
  export interface Client {
    readonly client: ArduinoCoreServiceClient;
    readonly instance: Instance;
  }
}

/**
 * Sugar for making the gRPC core client available for the concrete service classes.
 */
@injectable()
export abstract class CoreClientAware {
  @inject(CoreClientProvider)
  private readonly coreClientProvider: CoreClientProvider;
  /**
   * Returns with a promise that resolves when the core client is initialized and ready.
   */
  protected get coreClient(): Promise<CoreClientProvider.Client> {
    return this.coreClientProvider.client;
  }
}

class IndexUpdateRequiredBeforeInitError extends Error {
  constructor(causes: RpcStatus.AsObject[]) {
    super(`The index of the cores and libraries must be updated before initializing the core gRPC client.
The following problems were detected during the gRPC client initialization:
${causes
  .map(({ code, message }) => ` - code: ${code}, message: ${message}`)
  .join('\n')}
`);
    Object.setPrototypeOf(this, IndexUpdateRequiredBeforeInitError.prototype);
    if (!causes.length) {
      throw new Error(`expected non-empty 'causes'`);
    }
  }
}

function isIndexUpdateRequiredBeforeInit(
  status: RpcStatus[]
): IndexUpdateRequiredBeforeInitError | undefined {
  const causes = status
    .filter((s) =>
      IndexUpdateRequiredBeforeInit.map((predicate) => predicate(s)).some(
        Boolean
      )
    )
    .map((s) => RpcStatus.toObject(false, s));
  return causes.length
    ? new IndexUpdateRequiredBeforeInitError(causes)
    : undefined;
}
const IndexUpdateRequiredBeforeInit = [
  isPackageIndexMissingStatus,
  isDiscoveryNotFoundStatus,
];
function isPackageIndexMissingStatus(status: RpcStatus): boolean {
  const predicate = ({ message }: RpcStatus.AsObject) =>
    message.includes('loading json index file');
  // https://github.com/arduino/arduino-cli/blob/f0245bc2da6a56fccea7b2c9ea09e85fdcc52cb8/arduino/cores/packagemanager/package_manager.go#L247
  return evaluate(status, predicate);
}
function isDiscoveryNotFoundStatus(status: RpcStatus): boolean {
  const predicate = ({ message }: RpcStatus.AsObject) =>
    message.includes('discovery') &&
    (message.includes('not found') || message.includes('not installed'));
  // https://github.com/arduino/arduino-cli/blob/f0245bc2da6a56fccea7b2c9ea09e85fdcc52cb8/arduino/cores/packagemanager/loader.go#L740
  // https://github.com/arduino/arduino-cli/blob/f0245bc2da6a56fccea7b2c9ea09e85fdcc52cb8/arduino/cores/packagemanager/loader.go#L744
  return evaluate(status, predicate);
}
function evaluate(
  subject: RpcStatus,
  predicate: (error: RpcStatus.AsObject) => boolean
): boolean {
  const status = RpcStatus.toObject(false, subject);
  return predicate(status);
}
