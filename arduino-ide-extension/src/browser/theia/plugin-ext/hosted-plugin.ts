import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { injectable, interfaces } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { PLUGIN_RPC_CONTEXT } from '@theia/plugin-ext/lib/common/plugin-api-rpc';
import { RpcInvocationHandler } from '@theia/plugin-ext/lib/common/proxy-handler';
import {
  RPCProtocol,
  RPCProtocolImpl,
} from '@theia/plugin-ext/lib/common/rpc-protocol';
import {
  HostedPluginSupport as TheiaHostedPluginSupport,
  PluginContributions,
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
    this['server'].onDidCloseConnection(() =>
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

  protected override startPlugins(
    contributionsByHost: Map<string, PluginContributions[]>,
    toDisconnect: DisposableCollection
  ): Promise<void> {
    reorderPlugins(contributionsByHost);
    return super.startPlugins(contributionsByHost, toDisconnect);
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

/**
 * Force the `vscode-arduino-ide` API to activate before any Arduino IDE tool VSIX.
 *
 * Arduino IDE tool VISXs are not forced to declare the `vscode-arduino-api` as a `extensionDependencies`,
 * but the API must activate before any tools. This in place sorting helps to bypass Theia's plugin resolution
 * without forcing tools developers to add `vscode-arduino-api` to the `extensionDependencies`.
 */
function reorderPlugins(
  contributionsByHost: Map<string, PluginContributions[]>
): void {
  for (const [, contributions] of contributionsByHost) {
    const apiPluginIndex = contributions.findIndex(isArduinoAPI);
    if (apiPluginIndex >= 0) {
      const apiPlugin = contributions[apiPluginIndex];
      contributions.splice(apiPluginIndex, 1);
      contributions.unshift(apiPlugin);
    }
  }
}

function isArduinoAPI(pluginContribution: PluginContributions): boolean {
  return (
    pluginContribution.plugin.metadata.model.id ===
    'dankeboy36.vscode-arduino-api'
  );
}
