import { Endpoint } from '@theia/core/lib/browser/endpoint';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { BaseWidget } from '@theia/core/lib/browser/widgets';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common/nls';
import { Deferred } from '@theia/core/lib/common/promise-util';
import type { MaybePromise } from '@theia/core/lib/common/types';
import { Message, MessageLoop } from '@theia/core/shared/@phosphor/messaging';
import { Widget } from '@theia/core/shared/@phosphor/widgets';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { serialMonitorWidgetLabel } from '../../../common/nls';
import { MonitorEOL, MonitorSettings } from '../../../common/protocol';
import {
  BoardList,
  getInferredBoardOrBoard,
} from '../../../common/protocol/board-list';
import {
  createMonitorID,
  MonitorID2,
  MonitorService2,
} from '../../../common/protocol/monitor-service2';
import { joinUint8Arrays } from '../../../common/utils';
import { BoardsServiceProvider } from '../../boards/boards-service-provider';
import { MonitorModel } from '../../monitor-model';
import { ArduinoSelect, SelectOption } from '../../widgets/arduino-select';
import { SerialMonitorSendInput } from './serial-monitor-send-input';

// https://github.com/arduino/arduino-ide/blob/57975f8d91c7158becdbf3a74d0713a50aa577ca/arduino-ide-extension/src/node/monitor-service.ts#L708
// In milliseconds. 16ms was to support ~60Hz.
// const updateInterval = 32;

@injectable()
export class MonitorWidget extends BaseWidget {
  static readonly ID = 'serial-monitor';

  protected settings: MonitorSettings = {};

  protected widgetHeight: number;

  /**
   * Do not touch or use it. It is for setting the focus on the `input` after the widget activation.
   */
  protected focusNode: HTMLElement | undefined;
  /**
   * Guard against re-rendering the view after the close was requested.
   * See: https://github.com/eclipse-theia/theia/issues/6704
   */
  protected closing = false;
  protected readonly clearOutputEmitter = new Emitter<void>();

  @inject(MonitorModel)
  private readonly monitorModel: MonitorModel;
  @inject(MonitorService2)
  private readonly monitorService: MonitorService2;
  @inject(BoardsServiceProvider)
  private readonly boardsServiceProvider: BoardsServiceProvider;
  @inject(FrontendApplicationStateService)
  private readonly appStateService: FrontendApplicationStateService;
  @inject(TerminalFrontendContribution)
  private readonly terminalContribution: TerminalFrontendContribution;

  private readonly toDisposeOnReset: DisposableCollection;
  private readonly contentNode: HTMLDivElement;
  private readonly headerRoot: Root;
  private readonly headerRef = React.createRef<HTMLDivElement>();
  private _monitorClient: MonitorClient;
  private _terminalWidget: TerminalWidgetImpl | undefined;
  private _deferredTerminal: Deferred<TerminalWidgetImpl> = new Deferred();

  constructor() {
    super();
    this.id = MonitorWidget.ID;
    this.title.label = serialMonitorWidgetLabel;
    this.title.iconClass = 'monitor-tab-icon';
    this.title.closable = true;
    this.scrollOptions = undefined;
    this.contentNode = document.createElement('div');
    this.contentNode.classList.add('serial-monitor');
    const headerContainer = document.createElement('div');
    headerContainer.classList.add('header-container');
    this.contentNode.appendChild(headerContainer);
    this.headerRoot = createRoot(headerContainer);
    this.node.tabIndex = 0;
    this.node.appendChild(this.contentNode);

    this.toDisposeOnReset = new DisposableCollection();
    this.toDispose.push(this.clearOutputEmitter);
  }

  @postConstruct()
  protected init(): void {
    this.toDisposeOnReset.dispose();
    this._monitorClient = new MonitorClient(
      this.monitorService,
      this.boardsServiceProvider
    );
    this._deferredTerminal = new Deferred();
    this.terminalContribution
      .newTerminal({
        isPseudoTerminal: true,
      })
      .then((widget) => {
        this._terminalWidget = widget as TerminalWidgetImpl;
        this._deferredTerminal?.resolve(widget as TerminalWidgetImpl);
      });
    this.toDisposeOnReset.pushAll([
      Disposable.create(() => this._monitorClient.dispose()),
      this.monitorModel.onChange(() => this.update()),
      // this.monitorManagerProxy.onMonitorSettingsDidChange((event) =>
      //   this.updateSettings(event)
      // ),
      Disposable.create(() => {
        this._terminalWidget?.dispose();
        this._terminalWidget = undefined;
      }),
    ]);
    Promise.all([
      this.appStateService.reachedState('ready'),
      this.boardsServiceProvider.ready,
    ]).then(() => {
      let start = Date.now();
      let chunks: Uint8Array[] = [];
      this._monitorClient.activate((chunk) => {
        const now = Date.now();
        chunks.push(chunk);
        if (now - start >= 32) {
          const data = joinUint8Arrays(chunks);
          chunks = [];
          start = now;
          this._terminalWidget?.getTerminal().write(data);
        }
      });
    });
  }

  reset(): void {
    this.init();
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

  clearConsole(): void {
    this.clearOutputEmitter.fire(undefined);
    this.update();
  }

  get terminal(): TerminalWidget | undefined {
    return this._terminalWidget;
  }

  override dispose(): void {
    this.toDisposeOnReset.dispose();
    super.dispose();
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.headerRoot.render(this.renderHeader());
    const attachTerminal = (widget: TerminalWidgetImpl) =>
      Widget.attach(widget, this.contentNode);
    const detachTerminal = (widget: TerminalWidgetImpl | undefined) => {
      if (widget?.isAttached) {
        Widget.detach(widget);
      }
    };
    if (this._terminalWidget) {
      attachTerminal(this._terminalWidget);
    } else {
      this._deferredTerminal.promise.then((widget) => attachTerminal(widget));
    }
    this.toDisposeOnDetach.push(
      Disposable.create(() => detachTerminal(this._terminalWidget))
    );
  }

  protected override onCloseRequest(msg: Message): void {
    this.closing = true;
    super.onCloseRequest(msg);
  }

  protected override onUpdateRequest(msg: Message): void {
    // TODO: `this.isAttached`
    // See: https://github.com/eclipse-theia/theia/issues/6704#issuecomment-562574713
    if (!this.closing && this.isAttached) {
      super.onUpdateRequest(msg);
    }
    if (this._terminalWidget) {
      this._terminalWidget['onUpdateRequest'](msg);
    }
  }

  protected override onResize(msg: Widget.ResizeMessage): void {
    super.onResize(msg);
    if (this._terminalWidget) {
      this._terminalWidget['onResize'](msg);
    }
    this.widgetHeight = msg.height;
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    (this.focusNode || this.node).focus();
  }

  protected override onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    this.update();
  }

  protected onFocusResolved = (element: HTMLElement | undefined): void => {
    if (this.closing || !this.isAttached) {
      return;
    }
    this.focusNode = element;
    requestAnimationFrame(() =>
      MessageLoop.sendMessage(this, Widget.Msg.ActivateRequest)
    );
  };

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

  // private async startMonitor(): Promise<void> {
  //   await this.appStateService.reachedState('ready');
  //   await this.syncSettings();
  //   this._monitorClient.activate();
  // }

  /*TODO*/ protected async syncSettings(): Promise<void> {
    const settings = await this.getCurrentSettings();
    this.updateSettings(settings);
  }

  private async getCurrentSettings(): Promise<MonitorSettings> {
    const board = this.boardsServiceProvider.boardsConfig.selectedBoard;
    const port = this.boardsServiceProvider.boardsConfig.selectedPort;
    if (!board || !port) {
      return this.settings || {};
    }
    // return this.monitorManagerProxy.getCurrentSettings(board, port);
    return {};
  }

  private renderHeader(): React.ReactNode {
    const baudrate = this.settings?.pluggableMonitorSettings
      ? this.settings.pluggableMonitorSettings.baudrate
      : undefined;

    const baudrateOptions = baudrate?.values.map((b) => ({
      label: nls.localize('arduino/monitor/baudRate', '{0} baud', b),
      value: b,
    }));
    const baudrateSelectedOption = baudrateOptions?.find(
      (b) => b.value === baudrate?.selectedValue
    );

    const lineEnding =
      this.lineEndings.find(
        (item) => item.value === this.monitorModel.lineEnding
      ) || MonitorEOL.DEFAULT;
    return (
      <div className="header" ref={this.headerRef}>
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
              options={this.lineEndings}
              value={lineEnding}
              onChange={this.onChangeLineEnding}
            />
          </div>
          {baudrateOptions && baudrateSelectedOption && (
            <div className="select">
              <ArduinoSelect
                className="select"
                maxMenuHeight={this.widgetHeight - 40}
                options={baudrateOptions}
                value={baudrateSelectedOption}
                onChange={this.onChangeBaudRate}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  protected readonly onSend = (value: string): void => this.doSend(value);
  protected doSend(value: string): void {
    this._monitorClient.send(value);
  }

  protected readonly onChangeLineEnding = (
    option: SelectOption<MonitorEOL>
  ): void => {
    this.monitorModel.lineEnding = option.value;
  };

  protected readonly onChangeBaudRate = ({
    value,
  }: {
    value: string;
  }): void => {
    this.getCurrentSettings().then(({ pluggableMonitorSettings }) => {
      if (!pluggableMonitorSettings || !pluggableMonitorSettings['baudrate'])
        return;
      const baudRateSettings = pluggableMonitorSettings['baudrate'];
      baudRateSettings.selectedValue = value;
      // this.monitorManagerProxy.changeSettings({ pluggableMonitorSettings }); TODO!
    });
  };
}

const monitorEndpoint = new Endpoint({ path: '/monitor' }).getRestUrl();

export type MonitorDataHandler = (chunk: Uint8Array) => MaybePromise<void>;

export class MonitorClient implements Disposable {
  private readonly toDispose = new DisposableCollection();
  private readonly handlers = new Set<MonitorDataHandler>();
  private _stream: Disposable | undefined;

  constructor(
    private readonly monitorService: MonitorService2,
    private readonly boardServiceProvider: BoardsServiceProvider
  ) {
    this.toDispose.pushAll([
      boardServiceProvider.onBoardListDidChange(() => this.maybeUpdateStream()),
      Disposable.create(() => this._stream?.dispose()),
    ]);
  }

  dispose(): void {
    this.toDispose.dispose();
  }

  activate(handler: MonitorDataHandler): Disposable {
    if (this.handlers.has(handler)) {
      return Disposable.NULL;
    }
    if (!this.handlers.size) {
      setTimeout(() => this.maybeUpdateStream(), 0);
    }
    this.handlers.add(handler);
    const disposeHandler = Disposable.create(() =>
      this.handlers.delete(handler)
    );
    this.toDispose.push(disposeHandler);
    return disposeHandler;
  }

  send(message: string): Promise<void> {
    const id = this.createMonitorID();
    if (!id) {
      throw new Error('Not connected');
    }
    return this.monitorService.send(id, message);
  }

  private maybeUpdateStream(
    boardList: BoardList = this.boardServiceProvider.boardList
  ): void {
    this._stream?.dispose();
    const id = this.createMonitorID(boardList);
    if (id) {
      this._stream = this.stream(id);
    }
  }

  private createMonitorID(
    boardList: BoardList = this.boardServiceProvider.boardList
  ): MonitorID2 | undefined {
    const { selectedIndex } = boardList;
    const selectedItem = boardList.items[selectedIndex];
    if (!selectedItem) {
      return undefined;
    }
    return createMonitorID({
      port: selectedItem.port,
      fqbn: getInferredBoardOrBoard(selectedItem)?.fqbn,
    });
  }

  private stream(id: MonitorID2): Disposable {
    const abortController = new AbortController();
    const { signal } = abortController;
    const url = monitorEndpoint.withQuery(id).toString();
    const disposable = Disposable.create(() => abortController.abort());
    fetch(new Request(url, { signal })).then((resp) => {
      if (resp.body) {
        const handlers = Array.from(this.handlers.values());
        const reader = resp.body.getReader();
        const writeable = new WritableStream({
          async write(
            data: Uint8Array,
            controller: WritableStreamDefaultController
          ): Promise<void> {
            if (controller.signal.aborted) {
              return;
            }
            handlers.map((handler) => handler(data));
          },
        });
        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            const readOne = async (): Promise<unknown> => {
              const { value, done } = await reader.read();
              if (done) {
                disposable.dispose();
                controller.close();
                return;
              }
              controller.enqueue(value);
              return readOne();
            };
            return readOne();
          },
          cancel() {
            console.log('cancel');
          },
        });
        readable.pipeTo(
          new WritableStream({
            async write(chunk) {
              const writer = writeable.getWriter();
              await writer.write(chunk);
              writer.releaseLock();
            },
          })
        );
      }
    });
    return disposable;
  }
}
