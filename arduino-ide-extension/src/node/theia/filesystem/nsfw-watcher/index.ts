import { RpcProxyFactory } from '@theia/core/lib/common/messaging/proxy-factory';
import type { IPCEntryPoint } from '@theia/core/lib/node/messaging/ipc-protocol';
import yargs from '@theia/core/shared/yargs';
import type { FileSystemWatcherServiceClient } from '@theia/filesystem/lib/common/filesystem-watcher-protocol';
import type { NsfwFileSystemWatcherServerOptions } from '@theia/filesystem/lib/node/nsfw-watcher/nsfw-filesystem-service';
import { NoDelayDisposalTimeoutNsfwFileSystemWatcherService } from './nsfw-filesystem-service';

const options: {
  verbose: boolean;
} = yargs
  .option('verbose', {
    default: false,
    alias: 'v',
    type: 'boolean',
  })
  .option('nsfwOptions', {
    alias: 'o',
    type: 'string',
    coerce: JSON.parse,
  }).argv as unknown as NsfwFileSystemWatcherServerOptions;

export default <IPCEntryPoint>((connection) => {
  const server = new NoDelayDisposalTimeoutNsfwFileSystemWatcherService(
    options
  );
  const factory = new RpcProxyFactory<FileSystemWatcherServiceClient>(server);
  server.setClient(factory.createProxy());
  factory.listen(connection);
});
