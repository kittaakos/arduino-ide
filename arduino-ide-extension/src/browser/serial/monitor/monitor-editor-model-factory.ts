import type { CancellationToken, Resource } from '@theia/core';
import type { SaveOptions } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';
import type { TextDocumentContentChangeEvent } from '@theia/core/shared/vscode-languageserver-protocol';
import {
  MonacoEditorModel,
  TextDocumentSaveReason,
} from '@theia/monaco/lib/browser/monaco-editor-model';
import {
  OutputEditorModel,
  OutputEditorModelFactory,
} from '@theia/output/lib/browser/output-editor-model-factory';
import { MonitorUri } from './monitor-uri';

@injectable()
export class MonitorEditorModelFactory extends OutputEditorModelFactory {
  override readonly scheme: string = MonitorUri.scheme;

  override createModel(resource: Resource): MonacoEditorModel {
    const model = new MonitorEditorModel(resource, this.m2p, this.p2m);
    model.autoSave = 'off';
    model['ignoreContentChanges'] = true;
    return model;
  }
}

class MonitorEditorModel extends OutputEditorModel {
  override get readOnly(): boolean {
    return true;
  }

  override isReadonly(): boolean {
    return true;
  }

  // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
  protected override setDirty(dirty: boolean): void {
    // NOOP
  }

  protected override markAsDirty(): void {
    // NOOP
  }

  protected override async doSave(
    // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
    reason: TextDocumentSaveReason,
    // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
    token: CancellationToken,
    // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
    overwriteEncoding?: boolean | undefined,
    // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
    options?: SaveOptions | undefined
  ): Promise<void> {
    // NOOP
  }

  // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
  protected override async doSync(token: CancellationToken): Promise<void> {
    // NOOP
  }

  protected override pushContentChanges(
    // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
    contentChanges: TextDocumentContentChangeEvent[]
  ): void {
    // NOOP
  }
}
