import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { Event, Emitter } from '@theia/core/lib/common/event';
import WebSocket, { AddressInfo } from '@theia/core/shared/ws';

export default class WebSocketProviderImpl implements Disposable {
  private readonly toDispose: DisposableCollection;
  private readonly server: WebSocket.Server;
  private readonly clients: WebSocket[];

  private readonly onDidReceiveMessageEmitter: Emitter<string>;
  readonly onDidReceiveMessage: Event<string>;

  private readonly onLastClientDidDisconnectEmitter: Emitter<void>;
  readonly onLastClientDidDisconnect: Event<void>;

  constructor() {
    this.onDidReceiveMessageEmitter = new Emitter<string>();
    this.onLastClientDidDisconnectEmitter = new Emitter<void>();
    this.server = new WebSocket.Server({ port: 0 });
    this.toDispose = new DisposableCollection(
      this.onDidReceiveMessageEmitter,
      this.onLastClientDidDisconnectEmitter,
      Disposable.create(() => this.server.close())
    );
    this.onDidReceiveMessage = this.onDidReceiveMessageEmitter.event;
    this.onLastClientDidDisconnect =
      this.onLastClientDidDisconnectEmitter.event;
    this.server.on('connection', (ws) => this.addClient(ws));
  }

  dispose(): void {
    this.toDispose.dispose();
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

  getAddress(): string | AddressInfo {
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
