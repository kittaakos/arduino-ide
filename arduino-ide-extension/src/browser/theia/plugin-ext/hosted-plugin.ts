import { Emitter, Event, JsonRpcProxy } from '@theia/core';
import { injectable, interfaces } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { PLUGIN_RPC_CONTEXT } from '@theia/plugin-ext/lib/common/plugin-api-rpc';
import { HostedPluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { RpcInvocationHandler } from '@theia/plugin-ext/lib/common/proxy-handler';
import {
  RPCProtocol,
  RPCProtocolImpl,
} from '@theia/plugin-ext/lib/common/rpc-protocol';
import {
  HostedPluginSupport as TheiaHostedPluginSupport,
  PluginHost,
} from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { PluginWorker } from '@theia/plugin-ext/lib/hosted/browser/plugin-worker';
import { DocumentsMainImpl } from '@theia/plugin-ext/lib/main/browser/documents-main';
import { setUpPluginApi } from '@theia/plugin-ext/lib/main/browser/main-context';
import { MonitorUri } from '../../serial/monitor/monitor-uri';

@injectable()
export class HostedPluginSupport extends TheiaHostedPluginSupport {
  private readonly onDidLoadEmitter = new Emitter<void>();
  private readonly onDidCloseConnectionEmitter = new Emitter<void>();

  override onStart(container: interfaces.Container): void {
    super.onStart(container);
    this.hostedPluginServer.onDidCloseConnection(() =>
      this.onDidCloseConnectionEmitter.fire()
    );
  }

  protected override async doLoad(): Promise<void> {
    await super.doLoad();
    this.onDidLoadEmitter.fire(); // Unlike Theia, IDE2 fires an event after loading the VS Code extensions.
  }

  get onDidLoad(): Event<void> {
    return this.onDidLoadEmitter.event;
  }

  get onDidCloseConnection(): Event<void> {
    return this.onDidCloseConnectionEmitter.event;
  }

  private get hostedPluginServer(): JsonRpcProxy<HostedPluginServer> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).server;
  }

  // to patch the VS Code extension based debugger
  // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
  protected override initRpc(host: PluginHost, pluginId: string): RPCProtocol {
    const rpc =
      host === 'frontend' ? new PluginWorker().rpc : this.createServerRpc(host);
    setUpPluginApi(rpc, this.container);
    this.patchDocumentsMain(rpc);
    this.mainPluginApiProviders
      .getContributions()
      .forEach((p) => p.initialize(rpc, this.container));
    return rpc;
  }

  private patchDocumentsMain(rpc: RPCProtocol): void {
    const handler: RpcInvocationHandler = (<RPCProtocolImpl>rpc)['locals'].get(
      PLUGIN_RPC_CONTEXT.DOCUMENTS_MAIN.id
    );
    const documentsMain: DocumentsMainImpl = handler.target;

    const originalOnModelAdded = documentsMain['onModelAdded'];
    documentsMain['onModelAdded'] = function (event: {
      model: MonacoEditorModel;
      oldModeId: string;
    }) {
      if (event.model.uri.toString() === MonitorUri.toString()) {
        return;
      }
      originalOnModelAdded.bind(this)(event);
    };

    const originalOnModelChanged = documentsMain['onModelChanged'];
    documentsMain['onModelChanged'] = function (model: MonacoEditorModel) {
      if (model.uri.toString() === MonitorUri.toString()) {
        return;
      }
      originalOnModelChanged.bind(this)(model);
    };

    const originalOnModelRemoved = documentsMain['onModelRemoved'];
    documentsMain['onModelRemoved'] = function (uri: monaco.Uri) {
      if (uri.toString() === MonitorUri.toString()) {
        return;
      }
      return originalOnModelRemoved.bind(documentsMain)(uri);
    };
  }
}
