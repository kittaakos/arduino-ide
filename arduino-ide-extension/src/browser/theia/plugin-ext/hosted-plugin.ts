import {
  Emitter,
  Event,
  JsonRpcProxy,
  UntitledResourceResolver,
} from '@theia/core';
import { ApplicationShell, OpenerService } from '@theia/core/lib/browser';
import { injectable, interfaces } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import * as monaco from '@theia/monaco-editor-core';
import { MonacoBulkEditService } from '@theia/monaco/lib/browser/monaco-bulk-edit-service';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoEditorService } from '@theia/monaco/lib/browser/monaco-editor-service';
import { MonacoLanguages } from '@theia/monaco/lib/browser/monaco-languages';
import { ConnectionImpl } from '@theia/plugin-ext/lib/common/connection';
import { PLUGIN_RPC_CONTEXT } from '@theia/plugin-ext/lib/common/plugin-api-rpc';
import { HostedPluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { RPCProtocol } from '@theia/plugin-ext/lib/common/rpc-protocol';
import {
  HostedPluginSupport as TheiaHostedPluginSupport,
  PluginHost,
} from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { PluginWorker } from '@theia/plugin-ext/lib/hosted/browser/plugin-worker';
import { DocumentsMainImpl } from '@theia/plugin-ext/lib/main/browser/documents-main';
import { EditorsAndDocumentsMain } from '@theia/plugin-ext/lib/main/browser/editors-and-documents-main';
import { setUpPluginApi } from '@theia/plugin-ext/lib/main/browser/main-context';
import { EditorModelService } from '@theia/plugin-ext/lib/main/browser/text-editor-model-service';
import { TextEditorsMainImpl } from '@theia/plugin-ext/lib/main/browser/text-editors-main';
import { MonitorUri } from '../../serial/monitor/monitor-uri';
import { DebugMainImpl } from './debug-main';

const originalOnModelAdded = DocumentsMainImpl.prototype['onModelAdded'];
const originalOnModelRemoved = DocumentsMainImpl.prototype['onModelRemoved'];
const originalOnModelChanged = DocumentsMainImpl.prototype['onModelChanged'];
DocumentsMainImpl.prototype['onModelAdded'] = function (event: {
  model: MonacoEditorModel;
  oldModeId: string;
}) {
  if (event.model.uri.toString() === MonitorUri.toString()) {
    return;
  }
  originalOnModelAdded.bind(this)(event);
};
DocumentsMainImpl.prototype['onModelRemoved'] = function (uri: monaco.Uri) {
  if (uri.toString() === MonitorUri.toString()) {
    return;
  }
  return originalOnModelRemoved.bind(this)(uri);
};
DocumentsMainImpl.prototype['onModelChanged'] = function (
  model: MonacoEditorModel
) {
  if (model.uri.toString() === MonitorUri.toString()) {
    return;
  }
  originalOnModelChanged.bind(this)(model);
};

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
    this.patchDebugMain(rpc);
    this.patchDocumentsMain(rpc);
    this.mainPluginApiProviders
      .getContributions()
      .forEach((p) => p.initialize(rpc, this.container));
    return rpc;
  }

  private patchDebugMain(rpc: RPCProtocol): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectionMain = (rpc as any).locals.get(
      PLUGIN_RPC_CONTEXT.CONNECTION_MAIN.id
    ) as ConnectionImpl;
    const debugMain = new DebugMainImpl(rpc, connectionMain, this.container);
    rpc.set(PLUGIN_RPC_CONTEXT.DEBUG_MAIN, debugMain);
  }

  private patchDocumentsMain(rpc: RPCProtocol): void {
    const editorsAndDocuments = new EditorsAndDocumentsMain(
      rpc,
      this.container
    );

    const documentsMain = new DocumentsMainImpl(
      editorsAndDocuments,
      this.container.get<EditorModelService>(EditorModelService),
      rpc,
      this.container.get<EditorManager>(EditorManager),
      this.container.get<OpenerService>(OpenerService),
      this.container.get<ApplicationShell>(ApplicationShell),
      this.container.get<UntitledResourceResolver>(UntitledResourceResolver),
      this.container.get<MonacoLanguages>(MonacoLanguages)
    );
    rpc.set(PLUGIN_RPC_CONTEXT.DOCUMENTS_MAIN, documentsMain);

    const editorsMain = new TextEditorsMainImpl(
      editorsAndDocuments,
      documentsMain,
      rpc,
      this.container.get<MonacoBulkEditService>(MonacoBulkEditService),
      this.container.get<MonacoEditorService>(MonacoEditorService)
    );
    rpc.set(PLUGIN_RPC_CONTEXT.TEXT_EDITORS_MAIN, editorsMain);
  }
}
