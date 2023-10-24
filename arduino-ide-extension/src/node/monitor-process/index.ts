import { isObject } from '@theia/core/lib/common/types';
import yargs from '@theia/core/shared/yargs';
import { Transform, PassThrough } from 'node:stream';
import { createCoreArduinoClient } from '../arduino-core-service-client';
import {
  MonitorRequest,
  MonitorResponse,
} from '../cli-protocol/cc/arduino/cli/commands/v1/monitor_pb';

export interface StartMonitorParams {
  // TODO: address? what if the daemon is not on localhost?
  readonly daemonPort: number;
  readonly requestId: string;
}

function isStartMonitorParams(arg: unknown): arg is StartMonitorParams {
  return (
    isObject<StartMonitorParams>(arg) &&
    arg.daemonPort !== undefined &&
    typeof arg.daemonPort === 'number' &&
    arg.requestId !== undefined &&
    typeof arg.requestId === 'string'
  );
}

const { params } = yargs.option('params', {
  type: 'string',
  alias: 'p',
  coerce: JSON.parse,
}).argv;
if (!isStartMonitorParams(params)) {
  process.stderr.write(`Invalid arguments: ${JSON.stringify(params)}`);
  process.exit(1);
}

const client = createCoreArduinoClient(params.daemonPort);
const duplex = client.monitor();
duplex.on('error', (err) => {
  process.stderr.write(err.message);
  process.exit(1);
});
duplex
  .pipe(
    new PassThrough({
      readableObjectMode: true,
      writableObjectMode: false,
      transform(chunk, encoding, callback) {
        return callback(null, chunk);
      },
    })
  )
  .pipe(
    new Transform({
      readableObjectMode: true,
      writableObjectMode: false,
      transform(chunk: MonitorResponse, encoding, callback) {
        if (!(chunk instanceof MonitorResponse)) {
          return callback(
            new Error(
              `Unexpected chunk. Expected a monitor response. Got: ${JSON.stringify(
                chunk
              )}, [${typeof chunk}]`
            )
          );
        }
        const error = chunk.getError();
        if (error) {
          return callback(new Error(error));
        }
        const success = chunk.getSuccess();
        if (success) {
          return callback(null, params.requestId);
        }
        const data = chunk.getRxData_asU8();
        return callback(null, data);
      },
    })
  )
  .pipe(process.stdout);

process.stdin
  .pipe(
    new PassThrough({
      readableObjectMode: true,
      writableObjectMode: false,
      transform(chunk, encoding, callback) {
        return callback(null, chunk);
      },
    })
  )
  .pipe(
    new Transform({
      readableObjectMode: true,
      writableObjectMode: false,
      transform(chunk, _, callback) {
        const request = MonitorRequest.deserializeBinary(chunk);
        return callback(null, request);
      },
    })
  )
  .pipe(duplex as any);
