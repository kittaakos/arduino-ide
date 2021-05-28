import { injectable } from 'inversify';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { OutputEditorFactory } from '@theia/output/lib/browser/output-editor-factory';
import { MonitorUri } from './monitor-uri';

@injectable()
export class MonitorEditorFactory extends OutputEditorFactory {

    readonly scheme: string = MonitorUri.scheme;

    protected createOptions(model: MonacoEditorModel, defaultOptions: MonacoEditor.IOptions): MonacoEditor.IOptions {
        return {
            ...super.createOptions(model, defaultOptions),
            lineNumbers: 'on',
        };
    }

}
