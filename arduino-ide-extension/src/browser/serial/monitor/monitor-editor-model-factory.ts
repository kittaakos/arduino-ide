import { injectable } from '@theia/core/shared/inversify';
import { OutputEditorModelFactory } from '@theia/output/lib/browser/output-editor-model-factory';
import { MonitorUri } from './monitor-uri';

@injectable()
export class MonitorEditorModelFactory extends OutputEditorModelFactory {
  override readonly scheme: string = MonitorUri.scheme;
}
