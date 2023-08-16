import type { ClientDuplexStream } from '@grpc/grpc-js';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { deepClone } from '@theia/core/lib/common/objects';
import { Deferred } from '@theia/core/lib/common/promise-util';
import type { Mutable } from '@theia/core/lib/common/types';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { isDeepStrictEqual } from 'util';
import { v4 } from 'uuid';
import { Unknown } from '../common/nls';
import {
  Board,
  DetectedPort,
  DetectedPorts,
  NotificationServiceServer,
  Port,
} from '../common/protocol';
import {
  BoardListWatchRequest,
  BoardListWatchResponse,
  DetectedPort as RpcDetectedPort,
} from './cli-protocol/cc/arduino/cli/commands/v1/board_pb';
import { ArduinoCoreServiceClient } from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';
import type { Port as RpcPort } from './cli-protocol/cc/arduino/cli/commands/v1/port_pb';
import { CoreClientAware } from './core-client-provider';
import { ServiceError } from './service-error';

type Duplex = ClientDuplexStream<BoardListWatchRequest, BoardListWatchResponse>;
interface StreamWrapper extends Disposable {
  readonly stream: Duplex;
  readonly uuid: string; // For logging only
}

/**
 * Singleton service for tracking the available ports and board and broadcasting the
 * changes to all connected frontend instances.
 *
 * Unlike other services, this is not connection scoped.
 */
@injectable()
export class BoardDiscovery
  extends CoreClientAware
  implements BackendApplicationContribution
{
  @inject(ILogger)
  @named('discovery-log')
  private readonly logger: ILogger;

  @inject(NotificationServiceServer)
  private readonly notificationService: NotificationServiceServer;

  private watching: Deferred<void> | undefined;
  private stopping: Deferred<void> | undefined;
  private wrapper: StreamWrapper | undefined;
  private readonly onStreamDidEndEmitter = new Emitter<void>(); // sent from the CLI when the discovery process is killed for example after the indexes update and the core client re-initialization.
  private readonly onStreamDidCancelEmitter = new Emitter<void>(); // when the watcher is canceled by the IDE2
  private readonly toDisposeOnStopWatch = new DisposableCollection();

  private _detectedPorts: DetectedPorts = {};
  get detectedPorts(): DetectedPorts {
    return this._detectedPorts;
  }

  onStart(): void {
    this.start();
  }

  onStop(): void {
    this.stop();
  }

  async stop(restart = false): Promise<void> {
    this.logger.info('stop');
    if (this.stopping) {
      this.logger.info('stop already stopping');
      return this.stopping.promise;
    }
    if (!this.watching) {
      return;
    }
    this.stopping = new Deferred();
    this.logger.info('>>> Stopping boards watcher...');
    return new Promise<void>((resolve, reject) => {
      const timeout = this.createTimeout(10_000, reject);
      const toDispose = new DisposableCollection();
      const waitForEvent = (event: Event<unknown>) =>
        event(() => {
          this.logger.info('stop received event: either end or cancel');
          toDispose.dispose();
          this.stopping?.resolve();
          this.stopping = undefined;
          this.logger.info('stop stopped');
          resolve();
          if (restart) {
            this.start();
          }
        });
      toDispose.pushAll([
        timeout,
        waitForEvent(this.onStreamDidEndEmitter.event),
        waitForEvent(this.onStreamDidCancelEmitter.event),
      ]);
      this.logger.info('Canceling boards watcher...');
      this.toDisposeOnStopWatch.dispose();
    });
  }

  private createTimeout(
    after: number,
    onTimeout: (error: Error) => void
  ): Disposable {
    const timer = setTimeout(
      () => onTimeout(new Error(`Timed out after ${after} ms.`)),
      after
    );
    return Disposable.create(() => clearTimeout(timer));
  }

  private async requestStartWatch(
    req: BoardListWatchRequest,
    duplex: Duplex
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (
        !duplex.write(req, (err: Error | undefined) => {
          if (err) {
            reject(err);
            return;
          }
        })
      ) {
        duplex.once('drain', resolve);
      } else {
        process.nextTick(resolve);
      }
    });
  }

  private async createWrapper(
    client: ArduinoCoreServiceClient
  ): Promise<StreamWrapper> {
    if (this.wrapper) {
      throw new Error(`Duplex was already set.`);
    }
    const stream = client
      .boardListWatch()
      .on('end', () => {
        this.logger.info('received end');
        this.onStreamDidEndEmitter.fire();
      })
      .on('error', (error) => {
        this.logger.info('error received');
        if (ServiceError.isCancel(error)) {
          this.logger.info('cancel error received!');
          this.onStreamDidCancelEmitter.fire();
        } else {
          this.logger.error(
            'Unexpected error occurred during the boards discovery.',
            error
          );
          // TODO: terminate? restart? reject?
        }
      });
    const wrapper = {
      stream,
      uuid: v4(),
      dispose: () => {
        this.logger.info('disposing requesting cancel');
        // Cancelling the stream will kill the discovery `builtin:mdns-discovery process`.
        // The client (this class) will receive a `{"eventType":"quit","error":""}` response from the CLI.
        stream.cancel();
        this.logger.info('disposing canceled');
        this.wrapper = undefined;
      },
    };
    this.toDisposeOnStopWatch.pushAll([
      wrapper,
      Disposable.create(() => {
        this.watching?.reject(new Error(`Stopping watcher.`));
        this.watching = undefined;
      }),
    ]);
    return wrapper;
  }

  async start(): Promise<void> {
    this.logger.info('start');
    if (this.stopping) {
      this.logger.info('start is stopping wait');
      await this.stopping.promise;
      this.logger.info('start stopped');
    }
    if (this.watching) {
      this.logger.info('start already watching');
      return this.watching.promise;
    }
    this.watching = new Deferred();
    this.logger.info('start new deferred');
    const { client, instance } = await this.coreClient;
    const wrapper = await this.createWrapper(client);
    wrapper.stream.on('data', (resp) => this.onBoardListWatchResponse(resp));
    this.logger.info('start request start watch');
    await this.requestStartWatch(
      new BoardListWatchRequest().setInstance(instance),
      wrapper.stream
    );
    this.logger.info('start requested start watch');
    this.watching.resolve();
    this.logger.info('start resolved watching');
  }

  protected onBoardListWatchResponse(resp: BoardListWatchResponse): void {
    this.logger.info(JSON.stringify(resp.toObject(false)));
    const eventType = EventType.parse(resp.getEventType());

    if (eventType === EventType.Quit) {
      this.logger.info('quit received');
      this.stop();
      return;
    }

    const rpcDetectedPort = resp.getPort();
    if (rpcDetectedPort) {
      const detectedPort = this.fromRpc(rpcDetectedPort);
      if (detectedPort) {
        this.fireSoon({ detectedPort, eventType });
      } else {
        this.logger.warn(
          `Could not extract the detected port from ${rpcDetectedPort.toObject(
            false
          )}`
        );
      }
    } else if (resp.getError()) {
      this.logger.error(
        `Could not extract any detected 'port' from the board list watch response. An 'error' has occurred: ${resp.getError()}`
      );
    }
  }

  private fromRpc(detectedPort: RpcDetectedPort): DetectedPort | undefined {
    const rpcPort = detectedPort.getPort();
    if (!rpcPort) {
      return undefined;
    }
    const port = createApiPort(rpcPort);
    // if (port.address === '/dev/cu.Bluetooth-Incoming-Port') {
    //   return {
    //     port: {
    //       address: 'COM41',
    //       addressLabel: 'COM41',
    //       protocol: 'serial',
    //       protocolLabel: 'Serial Port (USB)',
    //       properties: {
    //         pid: '0x1001',
    //         serialNumber: '',
    //         vid: '0x303A',
    //       },
    //     },
    //     boards: [
    //       {
    //         name: 'Adafruit QT Py ESP32-C3',
    //         fqbn: 'esp32:esp32:adafruit_qtpy_esp32c3',
    //       },
    //       {
    //         name: 'AirM2M_CORE_ESP32C3',
    //         fqbn: 'esp32:esp32:AirM2M_CORE_ESP32C3',
    //       },
    //       {
    //         name: 'Crabik Slot ESP32-S3',
    //         fqbn: 'esp32:esp32:crabik_slot_esp32_s3',
    //       },
    //       {
    //         name: 'DFRobot Beetle ESP32-C3',
    //         fqbn: 'esp32:esp32:dfrobot_beetle_esp32c3',
    //       },
    //       {
    //         name: 'DFRobot Firebeetle 2 ESP32-S3',
    //         fqbn: 'esp32:esp32:dfrobot_firebeetle2_esp32s3',
    //       },
    //       {
    //         name: 'DFRobot Romeo ESP32-S3',
    //         fqbn: 'esp32:esp32:dfrobot_romeo_esp32s3',
    //       },
    //       {
    //         name: 'ESP32C3 Dev Module',
    //         fqbn: 'esp32:esp32:esp32c3',
    //       },
    //       {
    //         name: 'ESP32S3 Dev Module',
    //         fqbn: 'esp32:esp32:esp32s3',
    //       },
    //       {
    //         name: 'ESP32-S3-Box',
    //         fqbn: 'esp32:esp32:esp32s3box',
    //       },
    //       {
    //         name: 'ESP32S3 CAM LCD',
    //         fqbn: 'esp32:esp32:esp32s3camlcd',
    //       },
    //       {
    //         name: 'ESP32-S3-USB-OTG',
    //         fqbn: 'esp32:esp32:esp32s3usbotg',
    //       },
    //       {
    //         name: 'Heltec WiFi Kit 32(V3)',
    //         fqbn: 'esp32:esp32:heltec_wifi_kit_32_V3',
    //       },
    //       {
    //         name: 'Heltec WiFi LoRa 32(V3) / Wireless shell(V3) / Wireless stick lite (V3)',
    //         fqbn: 'esp32:esp32:heltec_wifi_lora_32_V3',
    //       },
    //       {
    //         name: 'LilyGo T-Display-S3',
    //         fqbn: 'esp32:esp32:lilygo_t_display_s3',
    //       },
    //       {
    //         name: 'LOLIN C3 Mini',
    //         fqbn: 'esp32:esp32:lolin_c3_mini',
    //       },
    //       {
    //         name: 'LOLIN S3',
    //         fqbn: 'esp32:esp32:lolin_s3',
    //       },
    //       {
    //         name: 'M5Stack-ATOMS3',
    //         fqbn: 'esp32:esp32:m5stack-atoms3',
    //       },
    //       {
    //         name: 'M5Stack-CoreS3',
    //         fqbn: 'esp32:esp32:m5stack-cores3',
    //       },
    //       {
    //         name: 'Nebula S3',
    //         fqbn: 'esp32:esp32:nebulas3',
    //       },
    //       {
    //         name: 'u-blox NORA-W10 series (ESP32-S3)',
    //         fqbn: 'esp32:esp32:nora_w10',
    //       },
    //       {
    //         name: 'RedPill(+) ESP32-S3',
    //         fqbn: 'esp32:esp32:redpill_esp32s3',
    //       },
    //       {
    //         name: 'STAMP-S3',
    //         fqbn: 'esp32:esp32:stamp-s3',
    //       },
    //       {
    //         name: 'TAMC Termod S3',
    //         fqbn: 'esp32:esp32:tamc_termod_s3',
    //       },
    //       {
    //         name: 'VALTRACK_V4_MFW_ESP32_C3',
    //         fqbn: 'esp32:esp32:VALTRACK_V4_MFW_ESP32_C3',
    //       },
    //       {
    //         name: 'VALTRACK_V4_VTS_ESP32_C3',
    //         fqbn: 'esp32:esp32:VALTRACK_V4_VTS_ESP32_C3',
    //       },
    //       {
    //         name: 'WiFiduinoV2',
    //         fqbn: 'esp32:esp32:wifiduino32c3',
    //       },
    //       {
    //         name: 'WiFiduino32S3',
    //         fqbn: 'esp32:esp32:wifiduino32s3',
    //       },
    //     ],
    //   };
    // }
    const boards = detectedPort.getMatchingBoardsList().map(
      (board) =>
        ({
          fqbn: board.getFqbn() || undefined, // prefer undefined fqbn over empty string
          name: board.getName() || Unknown,
        } as Board)
    );
    return {
      boards,
      port,
    };
  }

  private fireSoonHandle: NodeJS.Timeout | undefined;
  private readonly bufferedEvents: DetectedPortChangeEvent[] = [];
  private fireSoon(event: DetectedPortChangeEvent): void {
    this.bufferedEvents.push(event);
    clearTimeout(this.fireSoonHandle);
    this.fireSoonHandle = setTimeout(() => {
      const current = deepClone(this.detectedPorts);
      const newState = this.calculateNewState(this.bufferedEvents, current);
      if (!isDeepStrictEqual(current, newState)) {
        this._detectedPorts = newState;
        this.notificationService.notifyDetectedPortsDidChange({
          detectedPorts: this._detectedPorts,
        });
      }
      this.bufferedEvents.length = 0;
    }, 100);
  }

  private calculateNewState(
    events: DetectedPortChangeEvent[],
    prevState: Mutable<DetectedPorts>
  ): DetectedPorts {
    const newState = deepClone(prevState);
    for (const { detectedPort, eventType } of events) {
      const { port, boards } = detectedPort;
      const key = Port.keyOf(port);
      if (eventType === EventType.Add) {
        const alreadyDetectedPort = newState[key];
        if (alreadyDetectedPort) {
          console.warn(
            `Detected a new port that has been already discovered. The old value will be overridden. Old value: ${JSON.stringify(
              alreadyDetectedPort
            )}, new value: ${JSON.stringify(detectedPort)}`
          );
        }
        newState[key] = { port, boards };
      } else if (eventType === EventType.Remove) {
        const alreadyDetectedPort = newState[key];
        if (!alreadyDetectedPort) {
          console.warn(
            `Detected a port removal but it has not been discovered. This is most likely a bug! Detected port was: ${JSON.stringify(
              detectedPort
            )}`
          );
        }
        delete newState[key];
      }
    }
    return newState;
  }
}

enum EventType {
  Add,
  Remove,
  Quit,
}
namespace EventType {
  export function parse(type: string): EventType {
    const normalizedType = type.toLowerCase();
    switch (normalizedType) {
      case 'add':
        return EventType.Add;
      case 'remove':
        return EventType.Remove;
      case 'quit':
        return EventType.Quit;
      default:
        throw new Error(
          `Unexpected 'BoardListWatchResponse' event type: '${type}.'`
        );
    }
  }
}

interface DetectedPortChangeEvent {
  readonly detectedPort: DetectedPort;
  readonly eventType: EventType.Add | EventType.Remove;
}

export function createApiPort(rpcPort: RpcPort): Port {
  return {
    address: rpcPort.getAddress(),
    addressLabel: rpcPort.getLabel(),
    protocol: rpcPort.getProtocol(),
    protocolLabel: rpcPort.getProtocolLabel(),
    properties: Port.Properties.create(rpcPort.getPropertiesMap().toObject()),
    hardwareId: rpcPort.getHardwareId() || undefined, // prefer undefined over empty string
  };
}
