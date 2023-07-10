import { Event } from '@theia/core/lib/common/event';
import WebSocket from '@theia/core/shared/ws';

export const WebSocketProvider = Symbol('WebSocketProvider');
export interface WebSocketProvider {
  getAddress(): WebSocket.AddressInfo;
  sendMessage(message: string): void;
  onMessageReceived: Event<string>;
  onClientsNumberChanged: Event<number>;
  getConnectedClientsNumber(): number;
}
