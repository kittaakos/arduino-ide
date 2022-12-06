import { Deferred } from '@theia/core/lib/common/promise-util';
import type {
  Resource,
  ResourceReadOptions,
} from '@theia/core/lib/common/resource';
import URI from '@theia/core/lib/common/uri';
import * as monaco from '@theia/monaco-editor-core';
import { IReference } from '@theia/monaco-editor-core/esm/vs/base/common/lifecycle';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';

export class MonitorResource implements Resource {
  private _textModel: monaco.editor.ITextModel | undefined;
  private _disposed = false;

  constructor(
    readonly uri: URI,
    readonly editorModelRef: Deferred<IReference<MonacoEditorModel>>
  ) {
    this.editorModelRef.promise.then((modelRef) => {
      if (this._disposed) {
        modelRef.dispose();
        return;
      }
      this._textModel = modelRef.object.textEditorModel;
    });
  }

  get textModel(): monaco.editor.ITextModel | undefined {
    return this._textModel;
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this.textModel?.dispose();
  }

  // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
  async readContents(options?: ResourceReadOptions): Promise<string> {
    return this._textModel?.getValue() ?? '';
  }

  async reset(): Promise<void> {
    this.textModel?.setValue('');
  }
}
