import yargs from '@theia/core/shared/yargs';
// import { FileSystemWatcherServiceClient } from '../../common/filesystem-watcher-protocol';
// import { NsfwFileSystemWatcherService } from './nsfw-filesystem-service';

const options: {
  verbose?: boolean;
} = yargs
  .option('verbose', {
    default: false,
    alias: 'v',
    type: 'boolean',
  })
  .option('monitorOptions', {
    alias: 'o',
    type: 'string',
    coerce: JSON.parse,
  }).argv;

export default <IPCEntryPoint>((connection) => {
  const server = new NsfwFileSystemWatcherService(options);
  const factory = new JsonRpcProxyFactory<FileSystemWatcherServiceClient>(
    server
  );
  server.setClient(factory.createProxy());
  factory.listen(connection);
});
