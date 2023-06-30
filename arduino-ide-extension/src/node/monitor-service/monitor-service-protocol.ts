import { JsonRpcServer } from '@theia/core';
import type { AddressInfo } from '@theia/core/shared/ws';
import type { Port as ProtocolPort } from '../../common/protocol/boards-service';
import type { MonitorSettings } from '../../common/protocol/monitor-service';

type Port = Pick<ProtocolPort, 'address' | 'protocol'>;
type FQBN = string;

export interface MonitorServiceOptions {
  readonly daemonPort: number;
  readonly port: Port | undefined;
  readonly fqbn: FQBN | undefined;
}

export type MonitorServiceServer = JsonRpcServer<MonitorServiceClient>;

export interface MonitorService {
  start(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  sendData(data: MonitorData): void;
}

export type MonitorDataType = 'message' | 'configuration' | 'address';
export interface MonitorData {
  readonly type: MonitorDataType;
  readonly data: unknown;
}

export interface MonitorMessage extends MonitorData {
  readonly type: 'message';
  readonly data: string;
}

export interface MonitorSettingsChange extends MonitorData {
  readonly type: 'configuration';
  readonly data: MonitorSettings;
}

export interface MonitorAddressInfo extends MonitorData {
  readonly type: 'address';
  readonly data: string | AddressInfo;
}

export interface MonitorServiceClient {
  readonly options: MonitorServiceOptions;
  onData(data: MonitorData): void;
  onClose(reason?: unknown): void;
  onError(reason: unknown): void;
}

export type MonitorServiceId = string;
export function createMonitorServiceId(
  fqbn: FQBN,
  port: Port
): MonitorServiceId {
  return '';
}
