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
import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import { EditorWidget } from '@theia/editor/lib/browser';
import * as monaco from '@theia/monaco-editor-core';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import PQueue from 'p-queue';
import {
  MonitorEOL,
  MonitorManagerProxyClient,
  MonitorSettings,
} from '../../../common/protocol';
import { BoardsServiceProvider } from '../../boards/boards-service-provider';
import { MonitorModel } from '../../monitor-model';
import { ArduinoSelect } from '../../widgets/arduino-select';
import { MonitorResourceProvider } from './monitor-resource-provider';
import { SelectOption } from './monitor-utils';
import { SerialMonitorSendInput } from './serial-monitor-send-input';

@injectable()
export class MonitorWidget extends BaseWidget {
  static readonly ID = 'serial-monitor';
  static readonly LABEL = nls.localize(
    'arduino/common/serialMonitor',
    'Serial Monitor'
  );

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
  private readonly contentNode: HTMLDivElement;
  private readonly headerNode: HTMLDivElement;
  private readonly editorContainer: DockPanel;
  private closing = false;
  protected readonly appendContentQueue = new PQueue({
    autoStart: true,
    concurrency: 1,
  });

  @inject(MonitorModel)
  private readonly monitorModel: MonitorModel;
  @inject(MonitorManagerProxyClient)
  private readonly monitorManagerProxy: MonitorManagerProxyClient;
  @inject(BoardsServiceProvider)
  private readonly boardsServiceProvider: BoardsServiceProvider;
  @inject(FrontendApplicationStateService)
  private readonly appStateService: FrontendApplicationStateService;

  private readonly toDisposeOnReset: DisposableCollection;

  @inject(SelectionService)
  private readonly selectionService: SelectionService;
  @inject(MonacoEditorProvider)
  private readonly editorProvider: MonacoEditorProvider;
  @inject(MonitorResourceProvider)
  private readonly resourceProvider: MonitorResourceProvider;

  constructor() {
    super();
    this.id = MonitorWidget.ID;
    this.title.label = MonitorWidget.LABEL;
    this.title.iconClass = 'monitor-tab-icon';
    this.title.closable = true;
    this.scrollOptions = undefined;
    this.toDisposeOnReset = new DisposableCollection();
    this.toDispose.push(
      Disposable.create(() => this.monitorManagerProxy.disconnect())
    );

    this.contentNode = document.createElement('div');
    this.contentNode.classList.add('content');
    this.headerNode = document.createElement('div');
    this.headerNode.classList.add('header');
    this.contentNode.appendChild(this.headerNode);
    this.node.appendChild(this.contentNode);

    this.editorContainer = new NoopDragOverDockPanel({
      spacing: 0,
      mode: 'single-document',
    });
    this.editorContainer.addClass('editor-container');
    this.editorContainer.node.tabIndex = -1;

    this.toDispose.pushAll([
      Disposable.create(() => this.monitorManagerProxy.disconnect()),
      Disposable.create(() => {
        this.appendContentQueue.pause();
        this.appendContentQueue.clear();
      }),
    ]);
  }

  @postConstruct()
  protected init(): void {
    this.toDisposeOnReset.dispose();
    this.toDisposeOnReset.pushAll([
      Disposable.create(() => this.monitorManagerProxy.disconnect()),
      this.monitorModel.onChange(() => this.update()),
      this.monitorManagerProxy.onMonitorSettingsDidChange((event) =>
        this.updateSettings(event)
      ),
    ]);
    this.toDispose.pushAll([
      this.monitorModel.onChange(async ({ property }) => {
        if (property === 'connected') {
          const { connectionStatus } = this.monitorModel;
          if (connectionStatus === 'not-connected') {
            await this.clearConsole();
          }
        }
        this.update();
      }),
      this.monitorManagerProxy.onMonitorSettingsDidChange((settings) =>
        this.updateSettings(settings)
      ),
      this.monitorManagerProxy.onMessagesReceived(({ messages }) =>
        this.appendContent(messages)
      ),
    ]);
    this.getCurrentSettings().then((settings) => this.updateSettings(settings));
    this.monitorManagerProxy.startMonitor();
    this.startMonitor();
  }

  reset(): void {
    this.init();
  }

  async clearConsole(): Promise<void> {
    return this.resourceProvider.resource.reset();
  }

  get text(): string | undefined {
    return this.editor?.getControl().getModel()?.getValue();
  }

  protected override onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    ReactDOM.render(
      <React.Fragment>{this.renderHeader()}</React.Fragment>,
      this.headerNode
    );
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
    this.update();
  }

  override dispose(): void {
    this.toDisposeOnReset.dispose();
    super.dispose();
  }

  protected override onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    this.update();
  }

  protected get lineEndings(): SelectOption<MonitorEOL>[] {
    return [
      {
        label: nls.localize('arduino/serial/noLineEndings', 'No Line Ending'),
        value: '',
      },
      {
        label: nls.localize('arduino/serial/newLine', 'New Line'),
        value: '\n',
      },
      {
        label: nls.localize('arduino/serial/carriageReturn', 'Carriage Return'),
        value: '\r',
      },
      {
        label: nls.localize(
          'arduino/serial/newLineCarriageReturn',
          'Both NL & CR'
        ),
        value: '\r\n',
      },
    ];
  }

  private async startMonitor(): Promise<void> {
    await this.appStateService.reachedState('ready');
    await this.boardsServiceProvider.reconciled;
    await this.syncSettings();
    await this.monitorManagerProxy.startMonitor();
  }

  private async syncSettings(): Promise<void> {
    const settings = await this.getCurrentSettings();
    this.updateSettings(settings);
  }

  private async getCurrentSettings(): Promise<MonitorSettings> {
    const board = this.boardsServiceProvider.boardsConfig.selectedBoard;
    const port = this.boardsServiceProvider.boardsConfig.selectedPort;
    if (!board || !port) {
      return this.settings ?? {};
    }
    return this.monitorManagerProxy.getCurrentSettings(board, port);
  }

  private renderHeader(): React.ReactNode {
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

  private readonly onSend = (value: string): void =>
    this.monitorManagerProxy.send(value);

  private readonly onChangeLineEnding = (
    option: SelectOption<MonitorEOL>
  ): void => {
    this.monitorModel.lineEnding = option.value;
  };

  private readonly onChangeBaudRate = ({ value }: { value: string }): void => {
    this.getCurrentSettings().then(({ pluggableMonitorSettings }) => {
      if (!pluggableMonitorSettings || !pluggableMonitorSettings['baudrate']) {
        return;
      }
      const baudRateSettings = pluggableMonitorSettings['baudrate'];
      baudRateSettings.selectedValue = value;
      this.monitorManagerProxy.changeSettings({ pluggableMonitorSettings });
    });
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
      Disposable.create(() => widget.close()),
      this.resourceProvider.resource.onDidChangeContents(() =>
        this.revealLastLine()
      ),
    ]);
    if (!preserveFocus) {
      this.activate();
    }
    this.revealLastLine();
  }

  private revealLastLine(): void {
    if (this.isLocked) {
      return;
    }
    const editor = this.editor;
    if (editor) {
      const model = editor.getControl().getModel();
      if (model) {
        const lineNumber = model.getLineCount();
        const column = model.getLineMaxColumn(lineNumber);
        editor
          .getControl()
          .revealPosition(
            { lineNumber, column },
            monaco.editor.ScrollType.Smooth
          );
      }
    }
  }

  private get isLocked(): boolean {
    return !this.monitorModel.autoscroll;
  }

  private async createEditorWidget(): Promise<EditorWidget> {
    const editor = await this.editorProvider.get(
      this.resourceProvider.resource.uri
    );
    return new EditorWidget(editor, this.selectionService);
  }

  private get editorWidget(): EditorWidget | undefined {
    for (const widget of toArray(this.editorContainer.children())) {
      if (widget instanceof EditorWidget) {
        return widget;
      }
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

  private async appendContent(messages: string[]): Promise<void> {
    return this.appendContentQueue.add(async () => {
      const textModel = (
        await this.resourceProvider.resource.editorModelRef.promise
      ).object.textEditorModel;
      const end = textModel.getFullModelRange().getEndPosition();
      textModel.applyEdits([
        {
          range: new monaco.Range(
            end.lineNumber,
            end.column,
            end.lineNumber,
            end.column
          ),
          text: messages.join(''),
          forceMoveMarkers: true,
        },
      ]);
    });
  }
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
