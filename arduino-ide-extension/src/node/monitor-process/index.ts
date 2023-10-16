import { isObject } from '@theia/core/lib/common/types';
import yargs from '@theia/core/shared/yargs';
import { createMonitorID } from '../../common/protocol/monitor-service2';
import { createCoreArduinoClient } from '../arduino-core-service-client';

export interface StartMonitorParams {
  // TODO: address? what if it is not localhost?
  readonly daemonPort: number;
  readonly clientInstanceId: number;
  readonly monitorFqbn?: string | undefined;
  readonly monitorAddress: string;
  readonly monitorProtocol: string;
}

function isStartMonitorParams(arg: unknown): arg is StartMonitorParams {
  return (
    isObject<StartMonitorParams>(arg) &&
    arg.daemonPort !== undefined &&
    typeof arg.daemonPort === 'number' &&
    arg.clientInstanceId !== undefined &&
    typeof arg.clientInstanceId === 'number' &&
    (arg.monitorFqbn === undefined ||
      (arg.monitorFqbn !== undefined && typeof arg.monitorFqbn === 'string')) &&
    arg.monitorAddress !== undefined &&
    typeof arg.monitorAddress === 'string' &&
    arg.monitorProtocol !== undefined &&
    typeof arg.monitorProtocol === 'string'
  );
}

const params = yargs.option('params', {
  type: 'string',
  alias: 'p',
  coerce: JSON.parse,
}).argv;

if (!isStartMonitorParams(params)) {
  process.stderr.write(`Invalid arguments: ${JSON.stringify(params)}`);
  process.exit(1);
}

const monitorID = createMonitorID({
  port: { address: params.monitorAddress, protocol: params.monitorProtocol },
  fqbn: params.monitorFqbn,
});

const client = createCoreArduinoClient(params.daemonPort);
