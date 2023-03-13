import type { Disposable } from '@theia/core/lib/common/disposable';
import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';
import type { AddressInfo } from '@theia/core/shared/ws';
import type { Port as ProtocolPort } from '../../common/protocol/boards-service';
import type { MonitorSettings } from '../../common/protocol/monitor-service';

type Port = Pick<ProtocolPort, 'address' | 'protocol'>;
type FQBN = string;

export interface AcquireMonitorParams {
  readonly daemonPort: number;
  readonly port: Port | undefined;
  readonly fqbn: FQBN | undefined;
}

export interface MonitorInitParams {
  readonly port: Port;
  readonly fqbn: FQBN | undefined;
}

export type MonitorID = string;
export function createMonitorID(params: MonitorInitParams): MonitorID {
  return '';
}

export type MonitorServiceServer = RpcServer<MonitorServiceClient>;

export type MonitorDataType = 'message' | 'settings';
export interface MonitorData {
  readonly type: MonitorDataType;
  readonly data: unknown;
}

export interface MonitorMessage extends MonitorData {
  readonly type: 'message';
  readonly data: string;
}

export interface MonitorSettingsChange extends MonitorData {
  readonly type: 'settings';
  readonly data: MonitorSettings;
}

export interface MonitorServiceClient {
  onData(data: MonitorData): void;
  onClose(reason?: unknown): void;
  onError(reason: unknown): void;
}

interface MonitorService2 extends MonitorServiceClient, Disposable {
  send(message: string): void;
}

interface MonitorManager2 {
  acquireMonitor(params: AcquireMonitorParams): Promise<AddressInfo>;
  connect(
    addressInfo: AddressInfo
  ): Promise<{ service: MonitorService2; id: MonitorID }>;
  disconnect(id: MonitorID): Promise<void>;
}

type OrUndefined<T> = {
  [P in keyof T]: T[P] | undefined;
};

type MonitorPauseReason = 'upload' | 'burn-bootloader' | 'flash-firmware';
interface MonitorManagerServer2 {
  pause(
    params: OrUndefined<MonitorInitParams>,
    reason: MonitorPauseReason
  ): Promise<void>;
  resume(
    params: OrUndefined<MonitorInitParams>,
    reason: MonitorPauseReason
  ): Promise<void>;
}
