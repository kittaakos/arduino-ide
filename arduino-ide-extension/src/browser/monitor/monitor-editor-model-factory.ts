import { injectable } from 'inversify';
import { OutputEditorModelFactory } from '@theia/output/lib/browser/output-editor-model-factory';
import { MonitorUri } from './monitor-uri';

@injectable()
export class MonitorEditorModelFactory extends OutputEditorModelFactory {

    readonly scheme: string = MonitorUri.scheme;

}
