import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { BaseWidget, Widget } from '@theia/core/lib/browser/widgets/widget';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { toArray } from '@theia/core/shared/@phosphor/algorithm';
import { Message, MessageLoop } from '@theia/core/shared/@phosphor/messaging';
import { DockPanel } from '@theia/core/shared/@phosphor/widgets';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { EditorWidget } from '@theia/editor/lib/browser';
import * as monaco from '@theia/monaco-editor-core';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import { serialMonitorWidgetLabel } from '../../../common/nls';
import {
  MonitorEOL,
  MonitorManagerProxyClient,
  MonitorSettings,
} from '../../../common/protocol';
import { splitLines } from '../../../common/utils';
import { ArduinoPreferences } from '../../arduino-preferences';
import { BoardsServiceProvider } from '../../boards/boards-service-provider';
import { MonitorModel } from '../../monitor-model';
import { ArduinoSelect } from '../../widgets/arduino-select';
import { MonitorResourceProvider } from './monitor-resource-provider';
import { format, SelectOption, timestampLength } from './monitor-utils';
import { SerialMonitorSendInput } from './serial-monitor-send-input';

@injectable()
export class MonitorWidget extends BaseWidget {
  static readonly ID = 'serial-monitor';
  static readonly LABEL = nls.localize(
    'arduino/common/serialMonitor',
    'Serial Monitor'
  );

  @inject(MonitorModel)
  private readonly monitorModel: MonitorModel;
  @inject(MonitorManagerProxyClient)
  private readonly monitorManagerProxy: MonitorManagerProxyClient;
  @inject(BoardsServiceProvider)
  private readonly boardsServiceProvider: BoardsServiceProvider;
  @inject(FrontendApplicationStateService)
  private readonly appStateService: FrontendApplicationStateService;
  @inject(SelectionService)
  private readonly selectionService: SelectionService;
  @inject(MonacoEditorProvider)
  private readonly editorProvider: MonacoEditorProvider;
  @inject(MonitorResourceProvider)
  private readonly resourceProvider: MonitorResourceProvider;
  @inject(ArduinoPreferences)
  private readonly preference: ArduinoPreferences;

  private settings: MonitorSettings = {};
  private widgetHeight: number;
  /**
   * Do not touch or use it. It is for setting the focus on the `input` after the widget activation.
   */
  private focusNode: HTMLElement | undefined;
  /**
   * Guard against re-rendering the view after the close was requested.
   * See: https://github.com/eclipse-theia/theia/issues/6704
   */
  private closing = false;
  private textModel: monaco.editor.ITextModel | undefined;
  private maxLineNumber: number;
  private shouldHandleNextLeadingNL = false;
  private removedLinesCount = 0;
  private readonly lineNumber2Timestamp: Record<number, string>;
  private readonly contentNode: HTMLDivElement;
  private readonly headerRoot: Root;
  private readonly editorContainer: DockPanel;
  private readonly toDisposeOnReset: DisposableCollection;

  constructor() {
    super();
    this.id = MonitorWidget.ID;
    this.title.label = serialMonitorWidgetLabel;
    this.title.iconClass = 'monitor-tab-icon';
    this.title.closable = true;
    this.scrollOptions = undefined;
    this.contentNode = document.createElement('div');
    this.contentNode.classList.add('content');
    const headerNode = document.createElement('div');
    headerNode.classList.add('header');
    this.contentNode.appendChild(headerNode);
    this.headerRoot = createRoot(headerNode);
    this.node.appendChild(this.contentNode);
    this.editorContainer = new NoopDragOverDockPanel({
      spacing: 0,
      mode: 'single-document',
    });
    this.editorContainer.addClass('editor-container');
    this.editorContainer.node.tabIndex = -1;
    this.lineNumber2Timestamp = {};
    this.toDisposeOnReset = new DisposableCollection();
    this.toDispose.push(Disposable.create(() => this.headerRoot.unmount()));
  }

  @postConstruct()
  protected init(): void {
    this.toDisposeOnReset.dispose();
    this.toDisposeOnReset.pushAll([
      Disposable.create(() => this.monitorManagerProxy.disconnect()),
      Disposable.create(() => this.monitorManagerProxy.disconnect()),
      Disposable.create(() => this.clearConsole()),
      this.preference.onPreferenceChanged(({ preferenceName, newValue }) => {
        if (typeof newValue === 'number') {
          switch (preferenceName) {
            case 'arduino.monitor.maxLineNumber': {
              this.handleDidChangeMaxLineNumber(newValue);
              break;
            }
            case 'arduino.monitor.stopRenderingLineAfter': {
              this.handleDidChangeStopRenderingLineAfter(newValue);
              break;
            }
          }
        }
      }),
      this.monitorModel.onChange(({ property }) => {
        switch (property) {
          case 'connectionStatus': {
            this.handleDidChangeConnected();
            break;
          }
          case 'timestamp': {
            this.handleDidChangeTimestamp();
            break;
          }
        }
      }),
      this.monitorManagerProxy.onMonitorSettingsDidChange((settings) =>
        this.updateSettings(settings)
      ),
      this.monitorManagerProxy.onMessagesReceived(({ message }) =>
        this.appendToTextModel(message)
      ),
    ]);
    this.maxLineNumber = this.preference['arduino.monitor.maxLineNumber'];
    this.getCurrentSettings().then((settings) => {
      if (settings) {
        this.updateSettings(settings);
      }
    });
    this.appStateService
      .reachedState('ready')
      .then(() =>
        setTimeout(() => this.monitorManagerProxy.startMonitor(), 5_000)
      );
  }

  reset(): void {
    this.init();
  }

  async clearConsole(): Promise<void> {
    return this.resourceProvider.resource.reset();
  }

  override dispose(): void {
    this.toDisposeOnReset.dispose();
    super.dispose();
  }

  get text(): string | undefined {
    return this.editor?.getControl().getModel()?.getValue();
  }

  protected override onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    this.renderHeader();
    Widget.attach(this.editorContainer, this.contentNode);
    this.toDisposeOnDetach.push(
      Disposable.create(() => Widget.detach(this.editorContainer))
    );
  }

  protected override onUpdateRequest(message: Message): void {
    // TODO: `this.isAttached`
    // See: https://github.com/eclipse-theia/theia/issues/6704#issuecomment-562574713
    if (!this.closing && this.isAttached) {
      super.onUpdateRequest(message);
    }
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message);
    (this.focusNode || this.node).focus();
  }

  protected override onCloseRequest(message: Message): void {
    this.closing = true;
    super.onCloseRequest(message);
  }

  protected override onResize(message: Widget.ResizeMessage): void {
    super.onResize(message);
    MessageLoop.sendMessage(
      this.editorContainer,
      Widget.ResizeMessage.UnknownSize
    );
    for (const widget of toArray(this.editorContainer.widgets())) {
      MessageLoop.sendMessage(widget, Widget.ResizeMessage.UnknownSize);
    }
    this.widgetHeight = message.height;
    this.update();
    this.refreshEditorWidget();
  }

  private updateSettings(settings: MonitorSettings): void {
    this.settings = {
      ...this.settings,
      pluggableMonitorSettings: {
        ...this.settings.pluggableMonitorSettings,
        ...settings.pluggableMonitorSettings,
      },
    };
    this.renderHeader();
  }

  private async getCurrentSettings(): Promise<MonitorSettings | undefined> {
    const {
      boardsConfig: { selectedBoard, selectedPort },
    } = this.boardsServiceProvider;
    if (!selectedBoard || !selectedPort) {
      return undefined;
    }
    return this.monitorManagerProxy.getCurrentSettings(
      selectedBoard,
      selectedPort
    );
  }

  private renderHeader() {
    this.headerRoot.render(<>{this.header()}</>);
  }

  private header(): React.ReactNode {
    const baudrate = this.settings?.pluggableMonitorSettings
      ? this.settings.pluggableMonitorSettings.baudrate
      : undefined;
    const baudrateOptions = baudrate?.values.map((value) => ({
      label: `${value} baud`,
      value,
    }));
    const selectedBaudrateOption = baudrateOptions?.find(
      (baud) => baud.value === baudrate?.selectedValue
    );
    const lineEnding =
      lineEndings.find((item) => item.value === this.monitorModel.lineEnding) ??
      defaultLineEnding;

    return (
      <div className="serial-monitor">
        <div className="head">
          <div className="send">
            <SerialMonitorSendInput
              boardsServiceProvider={this.boardsServiceProvider}
              monitorModel={this.monitorModel}
              resolveFocus={this.onFocusResolved}
              onSend={this.onSend}
            />
          </div>
          <div className="config">
            <div className="select">
              <ArduinoSelect
                maxMenuHeight={this.widgetHeight - 40}
                options={lineEndings}
                value={lineEnding}
                onChange={this.onChangeLineEnding}
              />
            </div>
            {baudrateOptions && selectedBaudrateOption && (
              <div className="select">
                <ArduinoSelect
                  className="select"
                  maxMenuHeight={this.widgetHeight - 40}
                  options={baudrateOptions}
                  value={selectedBaudrateOption}
                  onChange={this.onChangeBaudRate}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  private readonly onFocusResolved = (
    element: HTMLElement | undefined
  ): void => {
    if (this.closing || !this.isAttached) {
      return;
    }
    this.focusNode = element;
    requestAnimationFrame(() =>
      MessageLoop.sendMessage(this, Widget.Msg.ActivateRequest)
    );
  };

  private async refreshEditorWidget(
    { preserveFocus }: { preserveFocus: boolean } = { preserveFocus: false }
  ): Promise<void> {
    const editorWidget = this.editorWidget;
    if (editorWidget) {
      if (!preserveFocus) {
        this.activate();
        return;
      }
    }
    const widget = await this.createEditorWidget();
    this.editorContainer.addWidget(widget);
    this.toDispose.pushAll([
      Disposable.create(() => {
        this.editorContainer.layout?.removeWidget(widget);
        widget.close();
        widget.dispose();
      }),
      Disposable.create(() => (this.textModel = undefined)),
    ]);
    if (!preserveFocus) {
      this.activate();
    }
    this.revealLastLine();
  }

  private revealLastLine(
    textModel: monaco.editor.ITextModel | undefined = this.textModel,
    lineNumber?: number
  ): void {
    if (this.isLocked) {
      return;
    }
    if (!textModel) {
      return;
    }
    const editor = this.editor;
    if (editor) {
      editor.getControl().revealPosition(
        {
          lineNumber:
            typeof lineNumber === 'number'
              ? lineNumber
              : textModel.getLineCount(),
          column: 1,
        },
        monaco.editor.ScrollType.Immediate
      );
    }
  }

  private get isLocked(): boolean {
    return !this.monitorModel.autoscroll;
  }

  private async createEditorWidget(): Promise<EditorWidget> {
    const editor = await this.editorProvider.get(
      this.resourceProvider.resource.uri
    );
    this.textModel = editor.getControl().getModel() ?? undefined;
    if (this.textModel) {
      this.textModel.updateOptions({ trimAutoWhitespace: false });
    }
    return new EditorWidget(editor, this.selectionService);
  }

  private get editorWidget(): EditorWidget | undefined {
    const itr = this.editorContainer.children();
    let child = itr.next();
    while (child) {
      if (child instanceof EditorWidget) {
        return child;
      }
      child = itr.next();
    }
    return undefined;
  }

  private get editor(): MonacoEditor | undefined {
    const widget = this.editorWidget;
    if (widget instanceof EditorWidget) {
      if (widget.editor instanceof MonacoEditor) {
        return widget.editor;
      }
    }
    return undefined;
  }

  private appendToTextModel(message: string): void {
    const textModel = this.textModel;
    if (!textModel) {
      console.warn(
        `Received message chunks from the serial monitor, but the text model is not available. Skipping.`
      );
      return;
    }
    const end = textModel.getFullModelRange().getEndPosition();
    const range = monaco.Range.fromPositions(end, end);
    let text =
      this.shouldHandleNextLeadingNL && this.startsWithNL(message)
        ? message.substring(1)
        : message;
    if (this.monitorModel.timestamp) {
      text = splitLines(text)
        .map((line, index) => {
          const now = new Date();
          if (index === 0) {
            return format(end.column === 1 ? now : undefined) + line;
          }
          return format(now) + line;
        })
        .join('');
    }
    const operations: monaco.editor.IIdentifiedSingleEditOperation[] = [
      {
        range,
        text,
        forceMoveMarkers: true,
      },
    ];
    if (this.maxLineNumber > 0) {
      const estimatedLineCount =
        end.lineNumber + text.split(/\r\n|\r|\n/gm).length - 1;
      const linesToRemove = estimatedLineCount - this.maxLineNumber;
      if (linesToRemove > 0) {
        operations.push({
          range: new monaco.Range(1, 1, linesToRemove + 1, 1),
          text: null,
          forceMoveMarkers: true,
        });
        this.removedLinesCount += linesToRemove;
      }
    }
    this.applyEditsUnsafe(textModel, operations);
    this.shouldHandleNextLeadingNL = this.endsWithCR(message);
    this.revealLastLine(textModel, end.lineNumber);
  }

  private applyEditsUnsafe(
    textModel: monaco.editor.ITextModel,
    rawOperations: monaco.editor.IIdentifiedSingleEditOperation[]
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsafeTextModel = textModel as any;
    const operations =
      unsafeTextModel['_validateEditOperations'](rawOperations);
    return unsafeTextModel['_doApplyEdits'](operations, false);
  }

  private endsWithCR(message: string): boolean {
    return message.charCodeAt(message.length - 1) === 13;
  }

  private startsWithNL(message: string): boolean {
    return message.charCodeAt(0) === 10;
  }

  /*TODO*/ protected updateTimestamps(
    changes: monaco.editor.IModelContentChange[]
  ): void {
    for (const {
      text,
      rangeLength,
      range: { startLineNumber, endLineNumber },
    } of changes) {
      const lineNumbers = [startLineNumber, endLineNumber].map(
        (lineNumber) => lineNumber + this.removedLinesCount
      );
      if (rangeLength > 0 && !text) {
        // deletions
        lineNumbers.forEach(
          (lineNumber) => delete this.lineNumber2Timestamp[lineNumber]
        );
      } else if (rangeLength === 0 && text) {
        // insertions
        lineNumbers.forEach((lineNumber) => {
          if (!this.lineNumber2Timestamp[lineNumber]) {
            this.lineNumber2Timestamp[lineNumber] = format(new Date());
          }
        });
      }
    }
  }

  private async handleDidChangeConnected(): Promise<void> {
    const { connectionStatus } = this.monitorModel;
    if (connectionStatus === 'not-connected') {
      this.clearConsole();
    }
    this.update();
  }

  private async handleDidChangeTimestamp(): Promise<void> {
    if (!this.textModel) {
      return;
    }
    const { timestamp } = this.monitorModel;
    const lineCount = this.textModel.getLineCount();
    const operations: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    for (let i = 0; i < lineCount; i++) {
      const lineStart = new monaco.Position(i + 1, 1);
      if (timestamp) {
        operations.push({
          range: monaco.Range.fromPositions(lineStart, lineStart),
          text: this.lineNumber2Timestamp[this.removedLinesCount + i + 1],
          forceMoveMarkers: true,
        });
      } else {
        const timestampEnd = new monaco.Position(
          lineStart.lineNumber,
          lineStart.column + timestampLength
        );
        operations.push({
          range: monaco.Range.fromPositions(lineStart, timestampEnd),
          text: null,
          forceMoveMarkers: true,
        });
      }
    }
    this.textModel.applyEdits(operations);
  }

  private handleDidChangeMaxLineNumber(maxLineNumber: number): void {
    this.maxLineNumber = maxLineNumber;
    this.appendToTextModel(''); // This is a NOOP change but will update the model and adjusts the line numbers if required
  }

  private handleDidChangeStopRenderingLineAfter(
    stopRenderingLineAfter: number
  ): void {
    this.editor?.getControl().updateOptions({ stopRenderingLineAfter });
  }

  private readonly onSend = (value: string): void =>
    this.monitorManagerProxy.send(value);

  private readonly onChangeLineEnding = (
    option: SelectOption<MonitorEOL>
  ): void => {
    this.monitorModel.lineEnding = option.value;
  };

  private readonly onChangeBaudRate = ({ value }: { value: string }): void => {
    this.getCurrentSettings().then((settings) => {
      if (settings) {
        const { pluggableMonitorSettings } = settings;
        if (
          !pluggableMonitorSettings ||
          !pluggableMonitorSettings['baudrate']
        ) {
          return;
        }
        const baudRateSettings = pluggableMonitorSettings['baudrate'];
        baudRateSettings.selectedValue = value;
        this.monitorManagerProxy.changeSettings({ pluggableMonitorSettings });
      }
    });
  };
}

const defaultLineEnding: SelectOption<MonitorEOL> = {
  label: nls.localize('arduino/serial/newLine', 'New Line'),
  value: '\n',
};
const lineEndings: SelectOption<MonitorEOL>[] = [
  {
    label: nls.localize('arduino/serial/noLineEndings', 'No Line Ending'),
    value: '',
  },
  defaultLineEnding,
  {
    label: nls.localize('arduino/serial/carriageReturn', 'Carriage Return'),
    value: '\r',
  },
  {
    label: nls.localize('arduino/serial/newLineCarriageReturn', 'Both NL & CR'),
    value: '\r\n',
  },
];

/**
 * Customized `DockPanel` that does not allow dropping widgets into it.
 * Intercepts `'p-dragover'` events, and sets the desired drop action to `'none'`.
 */
class NoopDragOverDockPanel extends DockPanel {}
NoopDragOverDockPanel.prototype['_evtDragOver'] = () => {
  /* NOOP */
};
NoopDragOverDockPanel.prototype['_evtDrop'] = () => {
  /* NOOP */
};
NoopDragOverDockPanel.prototype['_evtDragLeave'] = () => {
  /* NOOP */
};
