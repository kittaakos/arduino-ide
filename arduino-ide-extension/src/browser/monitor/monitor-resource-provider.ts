import { inject, injectable } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Resource, ResourceResolver } from '@theia/core/lib/common/resource';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService, IReference } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { MonitorUri } from './monitor-uri';
import { MonitorResource } from './monitor-resource';

@injectable()
export class MonitorResourceProvider implements ResourceResolver {

    readonly resource: MonitorResource;

    constructor(@inject(MonacoTextModelService) textModelService: MonacoTextModelService) {
        const editorModelRef = new Deferred<IReference<MonacoEditorModel>>();
        this.resource = new MonitorResource(MonitorUri, editorModelRef);
        textModelService.createModelReference(MonitorUri).then(ref => editorModelRef.resolve(ref));
    }

    async resolve(uri: URI): Promise<Resource> {
        if (this.resource.uri.toString() === uri.toString()) {
            return this.resource;
        }
        // Note: this is totally normal. This is the way Theia loads a resource.
        throw new Error(`Cannot handle URI: ${uri.toString()}`);
    }

}
