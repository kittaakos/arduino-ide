import type { AddressInfo } from '@theia/core/shared/ws';
import type { Port as ProtocolPort } from '../../common/protocol/boards-service';
import type { MonitorSettings } from '../../common/protocol/monitor-service';

type Port = Pick<ProtocolPort, 'address' | 'protocol'>;
type FQBN = string;

export interface MonitorServiceOptions {
  readonly daemonPort: string; // TODO: ask
  readonly port: Port | undefined;
  readonly fqbn: FQBN | undefined;
}

export interface MonitorService {}

export type MonitorDataType = 'message' | 'configuration';
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

export interface MonitorServiceClient {
  readonly options: MonitorServiceOptions;
  onOpen(websocketAddress: AddressInfo): void;
  onData(data: MonitorData): void;
  onClose(): void;
  onError(reason: unknown): void;
}

export type MonitorServiceId = string;
export function createMonitorServiceId(
  fqbn: FQBN,
  port: Port
): MonitorServiceId {
  return '';
}
