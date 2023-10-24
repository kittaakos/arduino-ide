import { environment } from '@theia/application-package/lib/environment';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { nls } from '@theia/core/lib/common/nls';
import { Deferred } from '@theia/core/lib/common/promise-util';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { UUID } from '@theia/core/shared/@phosphor/coreutils';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { Application, Request, Response } from 'express';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
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
import { joinUint8Arrays, waitForEvent } from '../common/utils';
import { ArduinoDaemonImpl } from './arduino-daemon-impl';
import {
  MonitorRequest,
  MonitorResponse,
} from './cli-protocol/cc/arduino/cli/commands/v1/monitor_pb';
import { Port } from './cli-protocol/cc/arduino/cli/commands/v1/port_pb';
import { CoreClientAware } from './core-client-provider';
import { StartMonitorParams } from './monitor-process/index';

@injectable()
export class MonitorService2Impl
  extends CoreClientAware
  implements MonitorService2, BackendApplicationContribution
{
  @inject(ILogger)
  private readonly logger: ILogger;
  private readonly monitors = new Map<MonitorID2, MonitorImpl>();

  @inject(ArduinoDaemonImpl)
  private readonly daemon: ArduinoDaemonImpl;
  private _daemonPort: number | undefined;

  onStart(): void {
    this.daemon.tryGetPort().then((port) => (this._daemonPort = port));
    this.daemon.onDaemonStarted((port) => (this._daemonPort = port));
  }

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
    if (typeof this._daemonPort !== 'number') {
      throw new Error(
        'Cannot start monitor connection. Arduino CLI daemon port is not set'
      );
    }
    const { instance } = await this.coreClient;
    let monitor = this.monitors.get(id);
    if (!monitor) {
      this.logger.debug(`creating monitor: ${id}`);
      const { port, fqbn } = parseMonitorID(id);
      const toDisposeOnWillClose = new DisposableCollection();
      monitor = new MonitorImpl();
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
          .setInstance(instance),
        this._daemonPort
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

  private async process(
    id: MonitorID2
  ): Promise<ChildProcessWithoutNullStreams> {
    const monitor = this.monitors.get(id);
    if (!monitor) {
      throw new Error(`Monitor not found: ${id}`); // TODO: make it `ApplicationError`
    }
    if (monitor.state === 'stopping') {
      throw new Error(`Conflict. Monitor is stopping: ${id}`); // TODO: make it `ApplicationError`
    }
    if (monitor.state === 'starting') {
      await waitForEvent(monitor.onDidStart);
    }
    const process = monitor.process;
    if (!process) {
      throw new Error(`Monitor process not found: ${id}`); // TODO: make it `ApplicationError`
    }
    return process;
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
        // a stream request automatically starts the monitor
        await this.start(id);
        const process = await this.process(id);
        let start = Date.now();
        let buffer: Uint8Array[] = [];
        process.stdout
          .pipe(
            new Transform({
              readableObjectMode: false,
              readableHighWaterMark: 1024, // bytes
              writableObjectMode: true,
              writableHighWaterMark: 32, // objects
              transform(chunk, _, cb) {
                if (chunk instanceof MonitorResponse) {
                  const data = chunk.getRxData_asU8();
                  buffer.push(data);
                  const now = Date.now();
                  if (now - start >= 32) {
                    const toSend = joinUint8Arrays(buffer);
                    buffer = [];
                    start = now;
                    return cb(null, toSend);
                  } else {
                    return cb();
                  }
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
  private _process: ChildProcessWithoutNullStreams | undefined;
  private _state: MonitorState2;

  constructor() {
    this.onDidStartEmitter = new Emitter();
    this.onWillStopEmitter = new Emitter();
    this.toDispose = new DisposableCollection(
      this.onDidStartEmitter,
      this.onWillStopEmitter,
      Disposable.create(() => (this._state = 'stopped'))
    );
    this._state = 'created';
  }

  start(request: MonitorRequest, daemonPort: number): void {
    this.changeState('starting');
    process.nextTick(async () => {
      const process = await this.spawnMonitorProcess(request, daemonPort);
      this.toDispose.pushAll([
        Disposable.create(() => process.kill()),
        Disposable.create(() => (this._process = undefined)),
      ]);
      process.on('exit', () => this.stop());
      this._process = process;
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

  get process(): ChildProcessWithoutNullStreams | undefined {
    return this._process;
  }

  get state(): MonitorState2 {
    return this._state;
  }

  async send(message: MonitorMessage2): Promise<void> {
    if (!this._process) {
      throw new Error('Monitor process is not running');
    }
    const process = this._process;
    if (typeof message === 'string') {
      await new Promise<void>((resolve, reject) => {
        process.stdin.write(
          new MonitorRequest().setTxData(message).serializeBinary(),
          (err) => (err ? reject(err) : resolve())
        );
      });
    } else {
      // TODO
    }
  }

  private async spawnMonitorProcess(
    request: MonitorRequest,
    daemonPort: number
  ): Promise<ChildProcessWithoutNullStreams> {
    // TODO: this won't work. webpack the index module!
    let startError: Error | undefined = undefined;
    // /Users/a.kitta/dev/git/arduino-ide/arduino-ide-extension/lib/node/monitor-process/index.js
    // /Users/a.kitta/dev/git/arduino-ide/arduino-ide-extension/lib/monitor-process/index.js
    const module = path.join(__dirname, 'monitor-process', 'index.js');
    for (let i = 0; i < 5; i++) {
      const params: StartMonitorParams = {
        daemonPort,
        requestId: UUID.uuid4(),
      };
      const [node] = process.argv;
      const env = environment.electron.runAsNodeEnv();
      const cp = spawn(node, [module, '--params', JSON.stringify(params)], {
        stdio: [null, null, null, 'pipe'],
        env,
      });
      const didSpawn = new Deferred();
      const didStart = new Deferred();
      cp.once('spawn', () => {
        didSpawn.resolve();
        cp.stdin.write(request.serializeBinary());
      });
      cp.once('error', (err) => {
        didSpawn.reject(err);
        didStart.reject(err);
      });
      cp.once('exit', (code, signal) => {
        let error: Error | undefined = undefined;
        if (code !== null) {
          error = new Error(`Unexpected exit with code: ${code}`);
        }
        if (!error && typeof signal !== null) {
          error = new Error(`Unexpected exit with signal: ${signal}`);
        }
        if (!error) {
          error = new Error('Unexpectedly exited.');
        }
        didSpawn.reject(error);
        didStart.reject(error);
      });
      cp.stdout.once('readable', () => {
        let chunk = cp.stdout.read();
        if (chunk === params.requestId) {
          didStart.resolve();
        } else {
          if (!chunk) {
            chunk = cp.stderr.read();
          }
          didStart.reject(
            new Error(
              `Monitor process replied with an unexpected message: ${chunk}`
            )
          );
        }
      });
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
        400_000
      );
      try {
        await Promise.race([
          Promise.all([didSpawn.promise, didStart.promise]).then(() =>
            clearTimeout(timer)
          ),
          timeout.promise,
        ]);
        return cp;
      } catch (err) {
        startError = err;
      }
    }
    throw startError;
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
