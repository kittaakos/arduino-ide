import { Deferred } from '@theia/core/lib/common/promise-util';
import { Resource, ResourceResolver } from '@theia/core/lib/common/resource';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { IReference } from '@theia/monaco-editor-core/esm/vs/base/common/lifecycle';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { MonitorResource } from './monitor-resource';
import { MonitorUri } from './monitor-uri';

@injectable()
export class MonitorResourceProvider implements ResourceResolver {
  readonly resource: MonitorResource;

  constructor(
    @inject(MonacoTextModelService) textModelService: MonacoTextModelService
  ) {
    const editorModelRef = new Deferred<IReference<MonacoEditorModel>>();
    this.resource = new MonitorResource(MonitorUri, editorModelRef);
    textModelService
      .createModelReference(MonitorUri)
      .then((ref) => editorModelRef.resolve(ref));
  }

  async resolve(uri: URI): Promise<Resource> {
    if (this.resource.uri.toString() === uri.toString()) {
      return this.resource;
    }
    throw new Error(`Cannot handle URI: ${uri.toString()}`);
  }
}
