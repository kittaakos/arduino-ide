import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as PQueue from 'p-queue';
import * as dateFormat from 'dateformat';
import { postConstruct, injectable, inject } from 'inversify';
import { OptionsType } from 'react-select/src/types';
import { toArray } from '@phosphor/algorithm';
import { DockPanel } from '@phosphor/widgets';
import { IDragEvent } from '@phosphor/dragdrop';
import { isOSX } from '@theia/core/lib/common/os';
import { Event } from '@theia/core/lib/common/event';
import { Key, KeyCode } from '@theia/core/lib/browser/keys';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import { DisposableCollection, Disposable } from '@theia/core/lib/common/disposable'
import { Message, Widget, MessageLoop, BaseWidget } from '@theia/core/lib/browser/widgets';
import { Board, Port } from '../../common/protocol/boards-service';
import { MonitorConfig } from '../../common/protocol/monitor-service';
import { ArduinoSelect } from '../widgets/arduino-select';
import { MonitorModel } from './monitor-model';
import { MonitorConnection } from './monitor-connection';
import { MonitorServiceClientImpl } from './monitor-service-client-impl';
import { MonitorResourceProvider } from './monitor-resource-provider';

@injectable()
export class MonitorWidget extends BaseWidget {

    static readonly ID = 'serial-monitor';

    @inject(MonitorModel)
    protected readonly monitorModel: MonitorModel;

    @inject(MonitorConnection)
    protected readonly monitorConnection: MonitorConnection;

    @inject(MonitorServiceClientImpl)
    protected readonly monitorServiceClient: MonitorServiceClientImpl;

    @inject(SelectionService)
    protected readonly selectionService: SelectionService;

    @inject(MonacoEditorProvider)
    protected readonly editorProvider: MonacoEditorProvider;

    @inject(MonitorResourceProvider)
    protected readonly resourceProvider: MonitorResourceProvider;

    protected widgetHeight: number;

    /**
     * Do not touch or use it. It is for setting the focus on the `input` after the widget activation.
     */
    protected focusNode: HTMLElement | undefined;

    protected readonly contentNode: HTMLDivElement;
    protected readonly headerNode: HTMLDivElement;
    protected readonly editorContainer: DockPanel;

    /**
     * Guard against re-rendering the view after the close was requested.
     * See: https://github.com/eclipse-theia/theia/issues/6704
     */
    protected closing = false;
    protected readonly appendContentQueue = new PQueue({ autoStart: true, concurrency: 1 });

    constructor() {
        super();
        this.id = MonitorWidget.ID;
        this.title.label = 'Serial Monitor';
        this.title.iconClass = 'monitor-tab-icon';
        this.title.closable = true;
        this.scrollOptions = undefined;

        this.contentNode = document.createElement('div');
        this.contentNode.classList.add('content');
        this.headerNode = document.createElement('div');
        this.headerNode.classList.add('header');
        this.contentNode.appendChild(this.headerNode);
        this.node.appendChild(this.contentNode);

        this.editorContainer = new NoopDragOverDockPanel({ spacing: 0, mode: 'single-document' });
        this.editorContainer.addClass('editor-container');
        this.editorContainer.node.tabIndex = -1;

        this.toDispose.pushAll([
            Disposable.create(() => {
                this.monitorConnection.autoConnect = false;
                if (this.monitorConnection.connected) {
                    this.monitorConnection.disconnect();
                }
            }),
            Disposable.create(() => {
                this.appendContentQueue.pause();
                this.appendContentQueue.clear();
            })
        ]);
    }

    @postConstruct()
    protected init(): void {
        this.toDispose.pushAll([
            this.monitorConnection.onConnectionChanged(() => this.clearConsole()),
            this.monitorConnection.onRead(this.appendContent.bind(this))
        ]);
        this.refreshEditorWidget();
    }

    async clearConsole(): Promise<void> {
        return this.resourceProvider.resource.reset();
    }

    dispose(): void {
        super.dispose();
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.monitorConnection.autoConnect = true;
        ReactDOM.render(<React.Fragment>{this.renderHeader()}</React.Fragment>, this.headerNode);
        Widget.attach(this.editorContainer, this.contentNode);
        this.toDisposeOnDetach.push(Disposable.create(() => Widget.detach(this.editorContainer)));
    }

    protected onCloseRequest(msg: Message): void {
        this.closing = true;
        super.onCloseRequest(msg);
    }

    protected onUpdateRequest(msg: Message): void {
        // TODO: `this.isAttached`
        // See: https://github.com/eclipse-theia/theia/issues/6704#issuecomment-562574713
        if (!this.closing && this.isAttached) {
            super.onUpdateRequest(msg);
        }
    }

    protected onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        MessageLoop.sendMessage(this.editorContainer, Widget.ResizeMessage.UnknownSize);
        for (const widget of toArray(this.editorContainer.widgets())) {
            MessageLoop.sendMessage(widget, Widget.ResizeMessage.UnknownSize);
        }
        this.widgetHeight = msg.height;
        this.refreshEditorWidget();
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        (this.focusNode || this.node).focus();
    }

    protected onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.onResize(Widget.ResizeMessage.UnknownSize);
    }

    private onFocusResolved = (element: HTMLElement | undefined) => {
        if (this.closing || !this.isAttached) {
            return;
        }
        this.focusNode = element;
        requestAnimationFrame(() => MessageLoop.sendMessage(this, Widget.Msg.ActivateRequest));
    }

    private get lineEndings(): OptionsType<SelectOption<MonitorModel.EOL>> {
        return [
            {
                label: 'No Line Ending',
                value: ''
            },
            {
                label: 'New Line',
                value: '\n'
            },
            {
                label: 'Carriage Return',
                value: '\r'
            },
            {
                label: 'Both NL & CR',
                value: '\r\n'
            }
        ];
    }

    private get baudRates(): OptionsType<SelectOption<MonitorConfig.BaudRate>> {
        const baudRates: Array<MonitorConfig.BaudRate> = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
        return baudRates.map(baudRate => ({ label: baudRate + ' baud', value: baudRate }));
    }

    private renderHeader(): React.ReactNode {
        const { baudRates, lineEndings } = this;
        const lineEnding = lineEndings.find(item => item.value === this.monitorModel.lineEnding) || lineEndings[1]; // Defaults to `\n`.
        const baudRate = baudRates.find(item => item.value === this.monitorModel.baudRate) || baudRates[4]; // Defaults to `9600`.
        return <div className='serial-monitor'>
            <div className='head'>
                <div className='send'>
                    <SerialMonitorSendInput
                        monitorConfig={this.monitorConnection.monitorConfig}
                        resolveFocus={this.onFocusResolved}
                        onSend={this.onSend} />
                </div>
                <div className='config'>
                    <div className='select'>
                        <ArduinoSelect
                            maxMenuHeight={this.widgetHeight - 40}
                            options={lineEndings}
                            defaultValue={lineEnding}
                            onChange={this.onChangeLineEnding} />
                    </div>
                    <div className='select'>
                        <ArduinoSelect
                            className='select'
                            maxMenuHeight={this.widgetHeight - 40}
                            options={baudRates}
                            defaultValue={baudRate}
                            onChange={this.onChangeBaudRate} />
                    </div>
                </div>
            </div>
        </div>;
    }

    private readonly onSend = (value: string) => this.doSend(value);
    private async doSend(value: string): Promise<void> {
        this.monitorConnection.send(value);
    }

    private readonly onChangeLineEnding = (option: SelectOption<MonitorModel.EOL>) => {
        this.monitorModel.lineEnding = option.value;
    }

    private readonly onChangeBaudRate = (option: SelectOption<MonitorConfig.BaudRate>) => {
        this.monitorModel.baudRate = option.value;
    }

    private async refreshEditorWidget({ preserveFocus }: { preserveFocus: boolean } = { preserveFocus: false }): Promise<void> {
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
            this.resourceProvider.resource.onDidChangeContents(() => this.revealLastLine())
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
                editor.getControl().revealPosition({ lineNumber, column }, monaco.editor.ScrollType.Smooth);
            }
        }
    }

    private get isLocked(): boolean {
        return !this.monitorModel.autoscroll;
    }

    private async createEditorWidget(): Promise<EditorWidget> {
        const editor = await this.editorProvider.get(this.resourceProvider.resource.uri);
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

    private async appendContent({ message }: { message: string }): Promise<void> {
        return this.appendContentQueue.add(async () => {
            const textModel = (await this.resourceProvider.resource.editorModelRef.promise).object.textEditorModel;
            const lastLine = textModel.getLineCount();
            const lastLineMaxColumn = textModel.getLineMaxColumn(lastLine);
            const position = new monaco.Position(lastLine, lastLineMaxColumn);
            const range = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
            const edits = [{
                range,
                text: message,
                forceMoveMarkers: true
            }];
            // We do not use `pushEditOperations` as we do not need undo/redo support. VS Code uses `applyEdits` too.
            // https://github.com/microsoft/vscode/blob/dc348340fd1a6c583cb63a1e7e6b4fd657e01e01/src/vs/workbench/services/output/common/outputChannelModel.ts#L108-L115
            textModel.applyEdits(edits);
        });
    }

}

export namespace SerialMonitorSendInput {
    export interface Props {
        readonly monitorConfig?: MonitorConfig;
        readonly onSend: (text: string) => void;
        readonly resolveFocus: (element: HTMLElement | undefined) => void;
    }
    export interface State {
        text: string;
    }
}

export class SerialMonitorSendInput extends React.Component<SerialMonitorSendInput.Props, SerialMonitorSendInput.State> {

    constructor(props: Readonly<SerialMonitorSendInput.Props>) {
        super(props);
        this.state = { text: '' };
        this.onChange = this.onChange.bind(this);
        this.onSend = this.onSend.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    render(): React.ReactNode {
        return <input
            ref={this.setRef}
            type='text'
            className={`theia-input ${this.props.monitorConfig ? '' : 'warning'}`}
            placeholder={this.placeholder}
            value={this.state.text}
            onChange={this.onChange}
            onKeyDown={this.onKeyDown} />
    }

    protected get placeholder(): string {
        const { monitorConfig } = this.props;
        if (!monitorConfig) {
            return 'Not connected. Select a board and a port to connect automatically.'
        }
        const { board, port } = monitorConfig;
        return `Message (${isOSX ? '⌘' : 'Ctrl'}+Enter to send message to '${Board.toString(board, { useFqbn: false })}' on '${Port.toString(port)}')`;
    }

    protected setRef = (element: HTMLElement | null) => {
        if (this.props.resolveFocus) {
            this.props.resolveFocus(element || undefined);
        }
    }

    protected onChange(event: React.ChangeEvent<HTMLInputElement>): void {
        this.setState({ text: event.target.value });
    }

    protected onSend(): void {
        this.props.onSend(this.state.text);
        this.setState({ text: '' });
    }

    protected onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
        const keyCode = KeyCode.createKeyCode(event.nativeEvent);
        if (keyCode) {
            const { key, meta, ctrl } = keyCode;
            if (key === Key.ENTER && ((isOSX && meta) || (!isOSX && ctrl))) {
                this.onSend();
            }
        }
    }

}

export namespace SerialMonitorOutput {
    export interface Props {
        readonly monitorModel: MonitorModel;
        readonly monitorConnection: MonitorConnection;
        readonly clearConsoleEvent: Event<void>;
    }
    export interface State {
        content: string;
        timestamp: boolean;
    }
}

export class SerialMonitorOutput extends React.Component<SerialMonitorOutput.Props, SerialMonitorOutput.State> {

    /**
     * Do not touch it. It is used to be able to "follow" the serial monitor log.
     */
    protected anchor: HTMLElement | null;
    protected toDisposeBeforeUnmount = new DisposableCollection();

    constructor(props: Readonly<SerialMonitorOutput.Props>) {
        super(props);
        this.state = { content: '', timestamp: this.props.monitorModel.timestamp };
    }

    render(): React.ReactNode {
        return <React.Fragment>
            <div style={({ whiteSpace: 'pre', fontFamily: 'monospace' })}>
                {this.state.content}
            </div>
            <div style={{ float: 'left', clear: 'both' }} ref={element => { this.anchor = element; }} />
        </React.Fragment>;
    }

    componentDidMount(): void {
        this.scrollToBottom();
        this.toDisposeBeforeUnmount.pushAll([
            this.props.monitorConnection.onRead(({ message }) => {
                const rawLines = message.split('\n');
                const lines: string[] = []
                const timestamp = () => this.state.timestamp ? `${dateFormat(new Date(), 'H:M:ss.l')} -> ` : '';
                for (let i = 0; i < rawLines.length; i++) {
                    if (i === 0 && this.state.content.length !== 0) {
                        lines.push(rawLines[i]);
                    } else {
                        lines.push(timestamp() + rawLines[i]);
                    }
                }
                const content = this.state.content + lines.join('\n');
                this.setState({ content });
            }),
            this.props.clearConsoleEvent(() => this.setState({ content: '' })),
            this.props.monitorModel.onChange(({ property }) => {
                if (property === 'timestamp') {
                    const { timestamp } = this.props.monitorModel;
                    this.setState({ timestamp });
                }
            })
        ]);
    }

    componentDidUpdate(): void {
        this.scrollToBottom();
    }

    componentWillUnmount(): void {
        // TODO: "Your preferred browser's local storage is almost full." Discard `content` before saving layout?
        this.toDisposeBeforeUnmount.dispose();
    }

    protected scrollToBottom(): void {
        if (this.props.monitorModel.autoscroll && this.anchor) {
            this.anchor.scrollIntoView();
        }
    }

}

export interface SelectOption<T> {
    readonly label: string;
    readonly value: T;
}

/**
 * Customized `DockPanel` that does not allow dropping widgets into it.
 * Intercepts `'p-dragover'` events, and sets the desired drop action to `'none'`.
 */
class NoopDragOverDockPanel extends DockPanel {

    constructor(options?: DockPanel.IOptions) {
        super(options);
        NoopDragOverDockPanel.prototype['_evtDragOver'] = (event: IDragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            event.dropAction = 'none';
        };
    }

}
