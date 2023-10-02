import queryString from 'query-string';
import {
  assertSanitizedFqbn,
  isPortIdentifier,
  PortIdentifier,
  sanitizeFqbn,
} from './boards-service';

export type MonitorID2 = string;

export function createMonitorID(params: {
  port: PortIdentifier;
  fqbn?: string | undefined;
}): MonitorID2 {
  const { port, fqbn } = params;
  const { protocol, address } = port;
  return queryString.stringify(
    { protocol, address, fqbn: fqbn ? sanitizeFqbn(fqbn) : '' },
    { skipEmptyString: true }
  );
}

export function isMonitorID(arg: unknown): arg is MonitorID2 {
  if (typeof arg === 'string') {
    try {
      parseMonitorID(arg);
      return true;
    } catch {}
  }
  return false;
}

export function parseMonitorID(id: MonitorID2): {
  port: PortIdentifier;
  fqbn: string | undefined;
} {
  const { protocol, address, fqbn } = queryString.parse(id);
  const port = { protocol, address };
  if (!isPortIdentifier(port)) {
    throw new Error(`Could not parse monitor ID: ${id}`);
  }
  if (fqbn) {
    if (typeof fqbn !== 'string') {
      throw new Error(`Could not parse monitor ID: ${id}`);
    }
    try {
      assertSanitizedFqbn(fqbn);
    } catch {
      throw new Error(`Could not parse monitor ID: ${id}`);
    }
  }
  return { port, fqbn: fqbn ?? undefined };
}
export type MonitorSettings2 = Record<string, string>; // TODO
export type MonitorMessage2 = string | MonitorSettings2;

const monitorStatusLiterals = ['starting', 'started', 'stopping'] as const;
export type MonitorStatus2 = (typeof monitorStatusLiterals)[number] | undefined;

export const MonitorService2Path = '/services/monitor-service-2';
export const MonitorService2 = Symbol('MonitorService2');
export interface MonitorService2 {
  start(id: MonitorID2): Promise<void>;
  stop(id: MonitorID2): Promise<void>;
  send(id: MonitorID2, message: MonitorMessage2): Promise<void>;
  status(id: MonitorID2): Promise<MonitorStatus2>;
}
