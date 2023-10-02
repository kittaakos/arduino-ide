import type { ClientDuplexStream } from '@grpc/grpc-js';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common/nls';
import { Deferred, retry } from '@theia/core/lib/common/promise-util';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { injectable } from '@theia/core/shared/inversify';
import type { Application, Request, Response } from 'express';
import { Duplex, Transform } from 'node:stream';
import {
  isMonitorID,
  MonitorID2,
  MonitorMessage2,
  MonitorService2,
  MonitorSettings2,
  MonitorStatus2,
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
  private readonly monitors = new Map<MonitorID2, MonitorImpl>();

  configure(app: Application): void {
    // HTTP PUT (start)
    app.put('/monitor', this.handleStart);
    // HTTP DELETE (stop)
    app.delete('/monitor', this.handleStop);
    // HTTP GET (stream monitor data)
    app.get('/monitor', this.handleStream);
    // HTTP GET (status)
    app.get('/monitor/status', this.handleStatus);
    // HTTP POST (send message or command)
    app.post('/monitor', this.handleSend);
  }

  async start(id: MonitorID2): Promise<void> {
    const { client, instance } = await this.coreClient;
    let monitor = this.monitors.get(id);
    if (!monitor) {
      const create = () => this.createMonitor(client);
      monitor = new MonitorImpl(create);
      this.monitors.set(id, monitor);
      const { port, fqbn } = parseMonitorID(id);
      monitor.start(
        new MonitorRequest()
          .setPort(
            new Port().setAddress(port.address).setProtocol(port.protocol)
          )
          .setFqbn(fqbn ?? '')
          .setInstance(instance)
      );
    }
    switch (monitor.status) {
      case 'starting': // fallback. The 'starting' monitor will start only when the data is pulled by the stream request
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

  async status(id: MonitorID2): Promise<MonitorStatus2> {
    const monitor = this.monitors.get(id);
    return monitor?.status;
  }

  private async duplex(id: MonitorID2): Promise<Duplex> {
    const monitor = this.monitors.get(id);
    if (!monitor) {
      throw new Error(`Monitor not found: ${id}`); // TODO: make it `ApplicationError`
    }
    if (monitor.status === 'stopping') {
      throw new Error(`Conflict. Monitor is stopping: ${id}`);
    }
    if (monitor.status === 'starting') {
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

  private readonly handleStatus = async (
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
        duplex.on('data', (chunk) => {
          console.log('data', chunk);
        });
        // duplex.on('data', (data) => resp.send(data));
        // duplex.on('end', () => resp.sendStatus(200));
        // duplex.on('error', (err) => resp.sendStatus(500).send(err));
        // resp.sendStatus(200);
        // duplex.pipe(resp);
        // resp.send(duplex);
        // resp.send();
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

class MonitorImpl implements Disposable {
  private readonly toDispose: DisposableCollection;
  private readonly onDidStartEmitter: Emitter<void>;
  private readonly onWillStopEmitter: Emitter<void>;
  private _duplex: Transform | undefined;
  private _status: MonitorStatus2;

  constructor(
    private readonly create: () => Promise<
      ClientDuplexStream<MonitorRequest, MonitorResponse>
    >
  ) {
    this.onDidStartEmitter = new Emitter();
    this.onWillStopEmitter = new Emitter();
    this.toDispose = new DisposableCollection(
      this.onDidStartEmitter,
      this.onWillStopEmitter
    );
  }

  start(request: MonitorRequest): void {
    const fireDidStart = () => this.changeState('started');
    process.nextTick(async () => {
      const duplex = await this.create();
      this.toDispose.pushAll([
        Disposable.create(() => duplex.destroy()),
        Disposable.create(() => (this._duplex = undefined)),
      ]);
      duplex.on('data', (data) => {
        console.log(data);
      });
      this._duplex = duplex.pipe(
        new Transform({
          objectMode: false,
          transform(chunk: MonitorResponse | MonitorRequest, _, callback) {
            if (chunk instanceof Buffer) {
              return callback(null, chunk);
            } else if (chunk instanceof MonitorResponse) {
              const error = chunk.getError();
              if (error) {
                return callback(new Error(error));
              }
              const success = chunk.getSuccess();
              if (success) {
                fireDidStart();
                return callback();
              }
              const data = chunk.getRxData();
              return callback(null, data);
            }
          },
        })
      );
      this._duplex.on('close', () => this.stop());
      duplex.write(request);
      // this._duplex.pipe(process.stdout);
      this._duplex.on('drain', () => {
        console.log('drain');
      });
      this._duplex.on('pause', () => {
        console.log('pause');
      });
      this._duplex.on('finish', () => {
        console.log('finish');
      });
      this._duplex.on('readable', () => {
        console.log('readable');
      });
      this._duplex.on('resume', () => {
        console.log('resume');
      });
    }, 0);
  }

  stop(): void {
    this.changeState('stopping');
    this.dispose();
  }

  get onDidStart(): Event<void> {
    return this.onDidStartEmitter.event;
  }

  get onWillStop(): Event<void> {
    return this.onWillStopEmitter.event;
  }

  get duplex(): Transform | undefined {
    return this._duplex;
  }

  get status(): Exclude<MonitorStatus2, undefined> {
    if (this._duplex) {
      return 'started';
    }
    if (this.toDispose.disposed) {
      return 'stopping';
    }
    return 'starting';
  }

  dispose(): void {
    this.toDispose.dispose();
  }

  async send(message: MonitorMessage2): Promise<void> {
    if (!this._duplex) {
      throw new Error('Monitor not started');
    }
    const duplex = this._duplex;
    if (typeof message === 'string') {
      await new Promise<void>((resolve, reject) => {
        duplex.write(new MonitorRequest().setTxData(message), (err) => {
          if (err) {
            reject(err);
          }
          resolve();
        });
      });
    } else {
      // TODO
    }
  }

  private changeState(s: MonitorStatus2): void {
    const fail = (from: MonitorStatus2, to: MonitorStatus2): never => {
      throw new Error(
        `Illegal monitor state transition from '${from}' to '${to}'`
      );
    };
    switch (this._status) {
      case 'starting': {
        if (s === 'stopping' || s === 'started') {
          this._status = s;
          break;
        }
        return fail(this._status, s);
      }
      case 'started': {
        if (s === 'stopping') {
          this._status = s;
          break;
        }
        return fail(this._status, s);
      }
      case 'stopping': {
        return fail(this._status, s);
      }
      default:
        throw new Error(`Unexpected status: ${status}`);
    }
    if (this._status === 'started') {
      this.onDidStartEmitter.fire();
    } else if (this.status === 'stopping') {
      this.onWillStopEmitter.fire();
    }
  }
}
