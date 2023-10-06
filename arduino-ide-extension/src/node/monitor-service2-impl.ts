import type { ClientDuplexStream } from '@grpc/grpc-js';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { nls } from '@theia/core/lib/common/nls';
import { Deferred, retry } from '@theia/core/lib/common/promise-util';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { Application, Request, Response } from 'express';
import { Transform } from 'node:stream';
import {
  assertValidMonitorStateTransition,
  isMonitorID,
  MonitorID2,
  MonitorMessage2,
  MonitorService2,
  MonitorSettings2,
  MonitorState2,
  parseMonitorID,
} from '../common/protocol/monitor-service2';
import { waitForEvent } from '../common/utils';
import type { ArduinoCoreServiceClient } from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';
import {
  MonitorRequest,
  MonitorResponse,
} from './cli-protocol/cc/arduino/cli/commands/v1/monitor_pb';
import { Port } from './cli-protocol/cc/arduino/cli/commands/v1/port_pb';
import { CoreClientAware } from './core-client-provider';

@injectable()
export class MonitorService2Impl
  extends CoreClientAware
  implements MonitorService2, BackendApplicationContribution
{
  @inject(ILogger)
  private readonly logger: ILogger;
  private readonly monitors = new Map<MonitorID2, MonitorImpl>();

  configure(app: Application): void {
    // HTTP PUT (start)
    app.put('/monitor', this.handleStart);
    // HTTP DELETE (stop)
    app.delete('/monitor', this.handleStop);
    // HTTP GET (stream monitor data)
    app.get('/monitor', this.handleStream);
    // HTTP GET (state)
    app.get('/monitor/state', this.handleState);
    // HTTP POST (send message or command)
    app.post('/monitor', this.handleSend);
  }

  async start(id: MonitorID2): Promise<void> {
    this.logger.debug(`start monitor: ${id}`);
    const { client, instance } = await this.coreClient;
    let monitor = this.monitors.get(id);
    if (!monitor) {
      this.logger.debug(`creating monitor: ${id}`);
      const { port, fqbn } = parseMonitorID(id);
      const toDisposeOnWillClose = new DisposableCollection();
      const create = () => this.createMonitor(client);
      monitor = new MonitorImpl(create);
      toDisposeOnWillClose.pushAll([
        monitor.onWillStop(() => toDisposeOnWillClose.dispose()),
        Disposable.create(() => {
          this.logger.debug(`deleting monitor: ${id}`);
          this.monitors.delete(id);
        }),
      ]);
      this.monitors.set(id, monitor);
      this.logger.debug(`starting monitor: ${id}`);
      monitor.start(
        new MonitorRequest()
          .setPort(
            new Port().setAddress(port.address).setProtocol(port.protocol)
          )
          .setFqbn(fqbn ?? '')
          .setInstance(instance)
      );
    }
    switch (monitor.state) {
      case 'created': // fallthrough
      case 'starting': {
        this.logger.debug(`waiting for monitor to start: ${id}`);
        await waitForEvent(monitor.onDidStart);
        return;
      }
      case 'started': {
        return;
      }
      case 'stopping': {
        await waitForEvent(monitor.onWillStop);
        this.monitors.delete(id);
        await this.start(id);
        return;
      }
    }
  }

  async stop(id: MonitorID2): Promise<void> {
    const monitor = this.monitors.get(id);
    if (!monitor) {
      return;
    }
    monitor.stop();
    await waitForEvent(monitor.onWillStop);
  }

  async send(
    id: MonitorID2,
    message: string | MonitorSettings2
  ): Promise<void> {
    const monitor = this.monitors.get(id);
    if (!monitor) {
      throw new Error(`Could not find monitor with ID: ${id}`); // TODO: make it `ApplicationError`
    }
    await monitor.send(message);
  }

  async status(id: MonitorID2): Promise<MonitorState2 | undefined> {
    const monitor = this.monitors.get(id);
    return monitor?.state;
  }

  private async duplex(
    id: MonitorID2
  ): Promise<ClientDuplexStream<MonitorRequest, MonitorResponse>> {
    const monitor = this.monitors.get(id);
    if (!monitor) {
      throw new Error(`Monitor not found: ${id}`); // TODO: make it `ApplicationError`
    }
    if (monitor.state === 'stopping') {
      throw new Error(`Conflict. Monitor is stopping: ${id}`);
    }
    if (monitor.state === 'starting') {
      await waitForEvent(monitor.onDidStart);
    }
    const source = monitor.duplex;
    if (!source) {
      throw new Error(`Stream not found: ${id}`);
    }
    return source;
  }

  private async createMonitor(
    client: ArduinoCoreServiceClient
  ): Promise<ClientDuplexStream<MonitorRequest, MonitorResponse>> {
    const timeout = new Deferred<never>();
    const timer = setTimeout(
      () =>
        timeout.reject(
          new Error(
            nls.localize(
              'arduino/monitor/connectionTimeout',
              "Timeout. The IDE has not received the 'success' message from the monitor after successfully connecting to it"
            )
          )
        ),
      20_000
    );
    return Promise.race([
      retry(
        async () => {
          let duplex:
            | ClientDuplexStream<MonitorRequest, MonitorResponse>
            | undefined = undefined;
          try {
            duplex = client.monitor();
            clearTimeout(timer);
            return duplex;
          } catch (err) {
            duplex?.destroy();
            throw err;
          }
        },
        2_000,
        20_000
      ),
      timeout.promise,
    ]);
  }

  private readonly handleStart = async (
    req: Request,
    resp: Response
  ): Promise<void> => {
    this.handle(req, resp, (id) => this.start(id));
  };

  private readonly handleStop = async (
    req: Request,
    resp: Response
  ): Promise<void> => {
    this.handle(req, resp, (id) => this.stop(id));
  };

  private readonly handleState = async (
    req: Request,
    resp: Response
  ): Promise<void> => {
    this.handle(req, resp, (id) => this.status(id));
  };

  private readonly handleSend = async (
    req: Request,
    resp: Response
  ): Promise<void> => {
    this.handle(req, resp, async (id) => {
      const message = req.body;
      await this.send(id, message);
    });
  };

  private readonly handleStream = async (
    req: Request,
    resp: Response
  ): Promise<void> => {
    const id = this.resolveQuery(req, resp);
    if (id) {
      try {
        const duplex = await this.duplex(id);
        duplex
          .pipe(
            new Transform({
              readableObjectMode: false,
              writableObjectMode: true,
              transform(chunk, _, callback) {
                if (chunk instanceof MonitorResponse) {
                  const data = chunk.getRxData_asU8();
                  callback(null, data);
                }
              },
            })
          )
          .pipe(resp);
      } catch (err) {
        console.log(err);
        resp.status(500).send(err).end();
      }
    }
  };

  private readonly handle = async <T>(
    req: Request,
    resp: Response,
    task: (id: MonitorID2) => Promise<T>
  ): Promise<void> => {
    const id = this.resolveQuery(req, resp);
    if (id) {
      try {
        const result = await task(id);
        resp.status(200);
        if (result) {
          resp.send(result);
        }
        resp.end();
      } catch (err) {
        resp.status(500).send(err).end();
      }
    }
  };

  private resolveQuery(req: Request, resp: Response): MonitorID2 | undefined {
    const { query } = req;
    if (typeof query === 'object') {
      const q = Object.keys(query)[0];
      if (isMonitorID(q)) {
        return q;
      }
    }
    resp.status(400).end();
    return undefined;
  }
}

class MonitorImpl {
  private readonly toDispose: DisposableCollection;
  private readonly onDidStartEmitter: Emitter<void>;
  private readonly onWillStopEmitter: Emitter<void>;
  private _duplex:
    | ClientDuplexStream<MonitorRequest, MonitorResponse>
    | undefined;
  private _state: MonitorState2;

  constructor(
    private readonly create: () => Promise<
      ClientDuplexStream<MonitorRequest, MonitorResponse>
    >
  ) {
    this.onDidStartEmitter = new Emitter();
    this.onWillStopEmitter = new Emitter();
    this.toDispose = new DisposableCollection(
      this.onDidStartEmitter,
      this.onWillStopEmitter,
      Disposable.create(() => (this._state = 'stopped'))
    );
    this._state = 'created';
  }

  start(request: MonitorRequest): void {
    this.changeState('starting');
    process.nextTick(async () => {
      const duplex = await this.create();
      this.toDispose.pushAll([
        Disposable.create(() => duplex.destroy()),
        Disposable.create(() => (this._duplex = undefined)),
      ]);
      duplex.on('end', () => this.stop());
      const monitorStarted = new MonitorStarted();
      const { ready, dataHandler } = monitorStarted;
      duplex.on('data', dataHandler);
      duplex.write(request);
      try {
        await ready;
      } finally {
        // Always remove the data handler to force the readstream to go into paused mode
        // The readstream will automatically resume, when it's piped into the HTTP request
        duplex.removeListener('data', dataHandler);
      }
      this._duplex = duplex;
      this.changeState('started');
    });
  }

  stop(): void {
    this.changeState('stopping');
    this.toDispose.dispose();
  }

  get onDidStart(): Event<void> {
    return this.onDidStartEmitter.event;
  }

  get onWillStop(): Event<void> {
    return this.onWillStopEmitter.event;
  }

  get duplex():
    | ClientDuplexStream<MonitorRequest, MonitorResponse>
    | undefined {
    return this._duplex;
  }

  get state(): MonitorState2 {
    return this._state;
  }

  async send(message: MonitorMessage2): Promise<void> {
    if (!this._duplex) {
      throw new Error('Monitor not started');
    }
    const duplex = this._duplex;
    if (typeof message === 'string') {
      await new Promise<void>((resolve) => {
        duplex.write(new MonitorRequest().setTxData(message), resolve);
      });
    } else {
      // TODO
    }
  }

  private changeState(s: MonitorState2): void {
    assertValidMonitorStateTransition(this._state, s);
    this._state = s;
    switch (this._state) {
      case 'started': {
        this.onDidStartEmitter.fire();
        return;
      }
      case 'stopping': {
        this.onWillStopEmitter.fire();
        return;
      }
    }
  }
}

class MonitorStarted {
  private readonly deferred = new Deferred();
  private readonly handler = (resp: MonitorResponse) => {
    const error = resp.getError();
    const success = resp.getSuccess();
    if (error) {
      this.deferred.reject(new Error(error));
    } else if (success) {
      this.deferred.resolve();
    } else {
      // According to the CLI monitor protocol, the first message must be either `success` or `error`
      // Hitting this branch is an implementation error either in IDE2 or on the CLI side.
      const object = resp.toObject(false);
      this.deferred.reject(
        new Error(
          `Unexpected monitor response. Expected either 'success' or 'error' as the first response after establishing the monitor connection. Got: ${JSON.stringify(
            object
          )}`
        )
      );
    }
  };

  get dataHandler(): (resp: MonitorResponse) => void {
    return this.handler;
  }

  get ready(): Promise<void> {
    return this.deferred.promise;
  }
}
