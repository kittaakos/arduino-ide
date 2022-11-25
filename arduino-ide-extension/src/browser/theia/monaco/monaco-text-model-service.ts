import type { ILogger, Log, Loggable } from '@theia/core/lib/common/logger';
import type { Resource } from '@theia/core/lib/common/resource';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { EditorPreferences } from '@theia/editor/lib/browser/editor-preferences';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService as TheiaMonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import type { MonacoToProtocolConverter } from '@theia/monaco/lib/browser/monaco-to-protocol-converter';
import type { ProtocolToMonacoConverter } from '@theia/monaco/lib/browser/protocol-to-monaco-converter';
import { SketchesServiceClientImpl } from '../../sketches-service-client-impl';

@injectable()
export class MonacoTextModelService extends TheiaMonacoTextModelService {
  @inject(SketchesServiceClientImpl)
  protected readonly sketchesServiceClient: SketchesServiceClientImpl;

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
