import { inject, injectable } from '@theia/core/shared/inversify';
import { IContextMenuService } from '@theia/monaco-editor-core/esm/vs/platform/contextview/browser/contextView';
import { MonacoContextMenuService } from '@theia/monaco/lib/browser/monaco-context-menu';
import {
  EditorServiceOverrides,
  MonacoEditor,
} from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { ArduinoPreferences } from '../../arduino-preferences';
import { OutputEditorFactory } from '../../theia/output/output-editor-factory';
import { MonitorContextMenuService } from './monitor-context-menu-service';
import { MonitorUri } from './monitor-uri';

// To hide the margin in the editor https://github.com/microsoft/monaco-editor/issues/1960
const noMargin = {
  lineNumbers: 'off',
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 0,
} as const;
@injectable()
export class MonitorEditorFactory extends OutputEditorFactory {
  @inject(MonitorContextMenuService)
  private readonly monitorContextMenuService: MonacoContextMenuService;
  @inject(ArduinoPreferences)
  private readonly preference: ArduinoPreferences;

  override readonly scheme: string = MonitorUri.scheme;

  protected override createOptions(
    model: MonacoEditorModel,
    defaultOptions: MonacoEditor.IOptions
  ): MonacoEditor.IOptions {
    return {
      ...super.createOptions(model, defaultOptions),
      ...noMargin,
      stopRenderingLineAfter:
        this.preference['arduino.monitor.stopRenderingLineAfter'],
      hideCursorInOverviewRuler: true,
      trimAutoWhitespace: false,
      maxTokenizationLineLength: 0,
      cursorBlinking: 'solid',
      cursorStyle: undefined,
      domReadOnly: true,
      renderLineHighlight: 'none',
      renderValidationDecorations: 'off',
      fixedOverflowWidgets: false,
      acceptSuggestionOnCommitCharacter: false,
      acceptSuggestionOnEnter: 'off',
      autoClosingBrackets: 'never',
      autoClosingDelete: 'never',
      autoClosingOvertype: 'never',
      autoClosingQuotes: 'never',
      autoIndent: 'none',
      unusualLineTerminators: 'off',
      glyphMargin: false,
      lineDecorationsWidth: 0,
      disableLayerHinting: true,
      disableMonospaceOptimizations: true,
      inlineSuggest: { enabled: false },
      quickSuggestions: false,
      parameterHints: { enabled: false },
      suggestOnTriggerCharacters: false,
      snippetSuggestions: 'none',
      tabCompletion: 'off',
      codeLens: false,
      lightbulb: { enabled: false },
      folding: false,
      matchBrackets: 'never',
      renderLineHighlightOnlyWhenFocus: true,
      inlayHints: { enabled: 'off' },
    };
  }

  protected override *createOverrides(
    model: MonacoEditorModel,
    defaultOverrides: EditorServiceOverrides
  ): EditorServiceOverrides {
    yield [IContextMenuService, this.monitorContextMenuService];
    for (const [identifier, provider] of defaultOverrides) {
      if (identifier !== IContextMenuService) {
        yield [identifier, provider];
      }
    }
  }
}
