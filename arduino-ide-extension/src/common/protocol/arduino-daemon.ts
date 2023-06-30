export const ArduinoDaemonPath = '/services/arduino-daemon';
export const ArduinoDaemon = Symbol('ArduinoDaemon');
export interface ArduinoDaemon {
  /**
   * Returns with a promise that resolves with the port
   * of the CLI daemon when it's up and running.
   */
  getPort(): Promise<number>;
  /**
   * Unlike `getPort` this method returns with a promise
   * that resolves to `undefined` when the daemon is not running.
   * Otherwise resolves to the CLI daemon port.
   */
  tryGetPort(): Promise<number | undefined>;
  start(): Promise<number>;
  stop(): Promise<void>;
  restart(): Promise<number>;
}
