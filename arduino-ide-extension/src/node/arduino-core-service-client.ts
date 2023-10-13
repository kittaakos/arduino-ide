import { credentials, makeClientConstructor } from '@grpc/grpc-js';
import * as commandsGrpcPb from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';
import { ArduinoCoreServiceClient } from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';

export function localhost(port: number): string {
  return `localhost:${port}`;
}

export function createChannelOptions(
  version = '0.0.0'
): Record<string, unknown> {
  return {
    'grpc.max_send_message_length': 512 * 1024 * 1024,
    'grpc.max_receive_message_length': 512 * 1024 * 1024,
    'grpc.primary_user_agent': `arduino-ide/${version}`,
  };
}

export function createCoreArduinoClient(
  port: number,
  channelOptions = createChannelOptions()
): ArduinoCoreServiceClient {
  const address = localhost(port);
  // https://github.com/agreatfool/grpc_tools_node_protoc_ts/blob/master/doc/grpcjs_support.md#usage
  const ArduinoCoreServiceClient = makeClientConstructor(
    // @ts-expect-error: ignore
    commandsGrpcPb['cc.arduino.cli.commands.v1.ArduinoCoreService'],
    'ArduinoCoreServiceService'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
  return new ArduinoCoreServiceClient(
    address,
    credentials.createInsecure(),
    channelOptions
  ) as ArduinoCoreServiceClient;
}
