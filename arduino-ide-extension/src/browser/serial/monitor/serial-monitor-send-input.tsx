import * as React from '@theia/core/shared/react';
import { Key, KeyCode } from '@theia/core/lib/browser/keys';
import { Board } from '../../../common/protocol/boards-service';
import { DisposableCollection, nls } from '@theia/core/lib/common';
import { BoardsServiceProvider } from '../../boards/boards-service-provider';
import { MonitorModel } from '../../monitor-model';
import { Unknown } from '../../../common/nls';

class HistoryList {
  private readonly items: string[] = [];
  private index = -1;

  constructor(private readonly size = 100) {}

  push(val: string): void {
    this.items.push(val);
    while (this.items.length > this.size) {
      this.items.shift();
    }
    this.index = -1;
  }

  previous(): string {
    if (this.index === -1) {
      this.index = this.items.length - 1;
      return this.items[this.index];
    }
    if (this.hasPrevious) {
      return this.items[--this.index];
    }
    return '';
  }

  private get hasPrevious(): boolean {
    return this.index >= 1;
  }

  next(): string {
    if (this.index === this.items.length - 1) {
      this.index = -1;
      return '';
    }
    if (this.hasNext) {
      return this.items[++this.index];
    }
    return '';
  }

  private get hasNext(): boolean {
    return this.index >= 0 && this.index !== this.items.length - 1;
  }
}

export namespace SerialMonitorSendInput {
  export interface Props {
    readonly boardsServiceProvider: BoardsServiceProvider;
    readonly monitorModel: MonitorModel;
    readonly onSend: (text: string) => void;
    readonly resolveFocus: (element: HTMLElement | undefined) => void;
  }
  export interface State {
    text: string;
    connected: boolean;
    history: HistoryList;
  }
}

export class SerialMonitorSendInput extends React.Component<
  SerialMonitorSendInput.Props,
  SerialMonitorSendInput.State
> {
  protected toDisposeBeforeUnmount = new DisposableCollection();

  constructor(props: Readonly<SerialMonitorSendInput.Props>) {
    super(props);
    this.state = { text: '', connected: true, history: new HistoryList() };
    this.onChange = this.onChange.bind(this);
    this.onSend = this.onSend.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  override componentDidMount(): void {
    this.setState({ connected: this.props.monitorModel.connected });
    this.toDisposeBeforeUnmount.push(
      this.props.monitorModel.onChange(({ property }) => {
        if (property === 'connected')
          this.setState({ connected: this.props.monitorModel.connected });
      })
    );
  }

  override componentWillUnmount(): void {
    // TODO: "Your preferred browser's local storage is almost full." Discard `content` before saving layout?
    this.toDisposeBeforeUnmount.dispose();
  }

  override render(): React.ReactNode {
    return (
      <input
        ref={this.setRef}
        type="text"
        className={`theia-input ${this.shouldShowWarning() ? 'warning' : ''}`}
        placeholder={this.placeholder}
        value={this.state.text}
        onChange={this.onChange}
        onKeyDown={this.onKeyDown}
      />
    );
  }

  protected shouldShowWarning(): boolean {
    const board = this.props.boardsServiceProvider.boardsConfig.selectedBoard;
    const port = this.props.boardsServiceProvider.boardsConfig.selectedPort;
    return !this.state.connected || !board || !port;
  }

  protected get placeholder(): string {
    if (this.shouldShowWarning()) {
      return nls.localize(
        'arduino/serial/notConnected',
        'Not connected. Select a board and a port to connect automatically.'
      );
    }

    const board = this.props.boardsServiceProvider.boardsConfig.selectedBoard;
    const port = this.props.boardsServiceProvider.boardsConfig.selectedPort;
    return nls.localize(
      'arduino/serial/message',
      "Message (Enter to send message to '{0}' on '{1}')",
      board
        ? Board.toString(board, {
            useFqbn: false,
          })
        : Unknown,
      port ? port.address : Unknown
    );
  }

  protected setRef = (element: HTMLElement | null): void => {
    if (this.props.resolveFocus) {
      this.props.resolveFocus(element || undefined);
    }
  };

  protected onChange(event: React.ChangeEvent<HTMLInputElement>): void {
    this.setState({ text: event.target.value });
  }

  protected onSend(): void {
    this.props.onSend(this.state.text + this.props.monitorModel.lineEnding);
    this.setState({ text: '' });
  }

  protected onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    const keyCode = KeyCode.createKeyCode(event.nativeEvent);
    if (keyCode) {
      const { key } = keyCode;
      if (key === Key.ENTER) {
        const { text } = this.state;
        this.onSend();
        if (text) {
          this.state.history.push(this.state.text);
        }
      } else if (key === Key.ARROW_UP) {
        const text = this.state.history.previous();
        // IDE 1.x does not advance from the first element to empty string. IDE2 preserves this behavior.
        if (text) {
          this.setState({ text });
        }
      } else if (key === Key.ARROW_DOWN) {
        this.setState({ text: this.state.history.next() });
      } else if (key === Key.ESCAPE) {
        this.setState({ text: '' });
      }
    }
  }
}
