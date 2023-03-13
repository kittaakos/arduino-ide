import { RpcProxyFactory } from '@theia/core/lib/common/messaging/proxy-factory';
import { IPCEntryPoint } from '@theia/core/lib/node/messaging/ipc-protocol';
import yargs from '@theia/core/shared/yargs';
import {
  MonitorServiceClient,
  AcquireMonitorParams,
} from './monitor-service-protocol';
import { MonitorService } from './monitor-service-server';

const options = yargs
  .option('monitorOptions', {
    alias: 'o',
    type: 'string',
    coerce: JSON.parse,
  })
  .option('verbose', {
    default: false,
    alias: 'v',
    type: 'boolean',
  }).argv as unknown as {
  verbose?: boolean;
  monitorOptions: AcquireMonitorParams;
};

export default <IPCEntryPoint>((connection) => {
  const { monitorOptions } = options;
  const server = new MonitorService(monitorOptions);
  const factory = new RpcProxyFactory<MonitorServiceClient>(server);
  server.setClient(factory.createProxy());
  factory.listen(connection);
});
