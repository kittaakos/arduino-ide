import type { ILogger, Log, Loggable } from '@theia/core/lib/common/logger';
import { OS } from '@theia/core/lib/common/os';
import type { Resource } from '@theia/core/lib/common/resource';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { URI as CodeURI } from '@theia/core/shared/vscode-uri';
import type { EditorPreferences } from '@theia/editor/lib/browser/editor-preferences';
import { ITextResourcePropertiesService } from '@theia/monaco-editor-core/esm/vs/editor/common/services/textResourceConfiguration';
import { StandaloneServices } from '@theia/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneServices';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService as TheiaMonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { SketchesServiceClientImpl } from '../../sketches-service-client-impl';
import type { MonacoToProtocolConverter } from '@theia/monaco/lib/browser/monaco-to-protocol-converter';
import type { ProtocolToMonacoConverter } from '@theia/monaco/lib/browser/protocol-to-monaco-converter';
import { MonitorUri } from '../../serial/monitor/monitor-uri';

@injectable()
export class MonacoTextModelService extends TheiaMonacoTextModelService {
  @inject(SketchesServiceClientImpl)
  protected readonly sketchesServiceClient: SketchesServiceClientImpl;

  @postConstruct()
  override init(): void {
    const resourcePropertiesService = StandaloneServices.get(
      ITextResourcePropertiesService
    );
    if (resourcePropertiesService) {
      resourcePropertiesService.getEOL = (resource: CodeURI) => {
        if (MonitorUri.toString() === resource.toString()) {
          // The CLI seems to send `\r\n` through the monitor when calling `Serial.println` from `ino` code.
          // See: https://github.com/arduino/arduino-ide/issues/391#issuecomment-850622814
          return '\r\n';
        }
        const eol = this.editorPreferences['files.eol'];
        if (eol && eol !== 'auto') {
          return eol;
        }
        return OS.backend.isWindows ? '\r\n' : '\n';
      };
    }
  }

  protected override async createModel(
    resource: Resource
  ): Promise<MonacoEditorModel> {
    const factory = this.factories
      .getContributions()
      .find(({ scheme }) => resource.uri.scheme === scheme);
    const readOnly = this.sketchesServiceClient.isReadOnly(resource.uri);
    return factory
      ? factory.createModel(resource)
      : new MaybeReadonlyMonacoEditorModel(
          resource,
          this.m2p,
          this.p2m,
          this.logger,
          undefined,
          readOnly
        );
  }
}

// https://github.com/eclipse-theia/theia/pull/8491
class SilentMonacoEditorModel extends MonacoEditorModel {
  protected override trace(loggable: Loggable): void {
    if (this.logger) {
      this.logger.trace((log: Log) =>
        loggable((message, ...params) =>
          log(message, ...params, this.resource.uri.toString(true))
        )
      );
    }
  }
}

class MaybeReadonlyMonacoEditorModel extends SilentMonacoEditorModel {
  constructor(
    protected override readonly resource: Resource,
    protected override readonly m2p: MonacoToProtocolConverter,
    protected override readonly p2m: ProtocolToMonacoConverter,
    protected override readonly logger?: ILogger,
    protected override readonly editorPreferences?: EditorPreferences,
    protected readonly _readOnly?: boolean
  ) {
    super(resource, m2p, p2m, logger, editorPreferences);
  }

  override get readOnly(): boolean {
    if (typeof this._readOnly === 'boolean') {
      return this._readOnly;
    }
    return this.resource.saveContents === undefined;
  }

  protected override setDirty(dirty: boolean): void {
    if (this._readOnly === true) {
      // NOOP
      return;
    }
    if (dirty === this._dirty) {
      return;
    }
    this._dirty = dirty;
    if (dirty === false) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).updateSavedVersionId();
    }
    this.onDirtyChangedEmitter.fire(undefined);
  }
}
