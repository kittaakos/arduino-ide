// TODO: eclipse-theia/theia#12909
import { Duplex, DuplexOptions } from 'node:stream';
declare module '@theia/core/shared/ws' {
  function createWebSocketStream(
    websocket: WebSocket,
    options?: DuplexOptions
  ): Duplex;
}

import { Emitter } from '@theia/core/lib/common/event';
import { injectable } from '@theia/core/shared/inversify';
import WebSocket, { createWebSocketStream } from '@theia/core/shared/ws';

@injectable()
export class WebSocketProviderImpl {
  private readonly clients: Duplex[];
  private readonly server: WebSocket.Server;

  private readonly onMessage = new Emitter<string>();
  readonly onMessageReceived = this.onMessage.event;

  private readonly onConnectedClients = new Emitter<number>();
  readonly onClientCountDidChange = this.onConnectedClients.event;

  constructor() {
    this.clients = [];
    this.server = new WebSocket.Server({ port: 0 });
    this.server.on('connection', (websocket) => this.addClient(websocket));
  }

  private addClient(websocket: WebSocket): void {
    const duplex = createWebSocketStream(websocket);
    this.clients.push(duplex);
    this.onConnectedClients.fire(this.clients.length);

    websocket.onclose = () => {
      this.clients.splice(this.clients.indexOf(duplex), 1);
      this.onConnectedClients.fire(this.clients.length);
    };

    websocket.onmessage = (res) => {
      this.onMessage.fire(res.data.toString());
    };
  }

  getConnectedClientsNumber(): number {
    return this.clients.length;
  }

  getAddress(): WebSocket.AddressInfo {
    return this.server.address() as WebSocket.AddressInfo;
  }

  sendMessage(message: string | Uint8Array): void {
    // TODO: remove and pipe in/out
  }

  pipe(source: NodeJS.ReadableStream): void {
    this.clients.forEach((client) => {
      source.on('data', (chunk) => {
        const result = client.write(chunk);
        if (!result) {
          // handle backpressure
          source.pause();
        }
      });
      source.on('end', () => {
        client.end();
      });
      client.on('drain', () => {
        source.resume();
      });
    });
  }
}
