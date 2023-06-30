import { Emitter } from '@theia/core/lib/common/event';
import WebSocket from '@theia/core/shared/ws';

export default class WebSocketProviderImpl {
  private readonly server: WebSocket.Server;
  private readonly clients: WebSocket[] = [];

  private readonly onDidReceiveMessageEmitter = new Emitter<string>();
  readonly onDidReceiveMessage = this.onDidReceiveMessageEmitter.event;

  private readonly onLastClientDidDisconnectEmitter = new Emitter<void>();
  readonly onLastClientDidDisconnect =
    this.onLastClientDidDisconnectEmitter.event;

  constructor() {
    this.server = new WebSocket.Server({ port: 0 });
    this.server.on('connection', (ws) => this.addClient(ws));
  }

  private addClient(ws: WebSocket): void {
    this.clients.push(ws);
    ws.onclose = () => {
      this.clients.splice(this.clients.indexOf(ws), 1);
      if (!this.clients.length) {
        this.onLastClientDidDisconnectEmitter.fire();
      }
    };
    ws.onmessage = (res) => {
      this.onDidReceiveMessageEmitter.fire(res.data.toString());
    };
  }

  getAddress(): ReturnType<typeof this.server.address> {
    return this.server.address();
  }

  sendMessage(message: string): void {
    for (const ws of this.clients) {
      try {
        ws.send(message);
      } catch (err) {
        console.error(
          `Failed to send monitor message to client. Closing websocket. Message was: ${message}`
        );
        ws.close();
      }
    }
  }
}
