import { CommonCommands } from '@theia/core/lib/browser/common-frontend-contribution';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { Endpoint } from '@theia/core/lib/browser/endpoint';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { codicon } from '@theia/core/lib/browser/widgets';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { Event } from '@theia/core/lib/common/event';
import { MenuModelRegistry } from '@theia/core/lib/common/menu/menu-model-registry';
import { nls } from '@theia/core/lib/common/nls';
import { isOSX } from '@theia/core/lib/common/os';
import type { MaybePromise } from '@theia/core/lib/common/types';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import React from '@theia/core/shared/react';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { serialMonitorWidgetLabel } from '../../../common/nls';
import { MonitorManagerProxyClient } from '../../../common/protocol';
import { createMonitorID } from '../../../common/protocol/monitor-service2';
import {
  ArduinoPreferences,
  defaultMonitorWidgetDockPanel,
  isMonitorWidgetDockPanel,
} from '../../arduino-preferences';
import { BoardsServiceProvider } from '../../boards/boards-service-provider';
import { KeybindingRegistry } from '../../contributions/contribution';
import { ArduinoMenus } from '../../menu/arduino-menus';
import { MonitorModel } from '../../monitor-model';
import { ArduinoToolbar } from '../../toolbar/arduino-toolbar';
import { MonitorWidget } from './monitor-widget';

// https://code.visualstudio.com/api/references/when-clause-contexts
const monitorFocus = 'monitorFocus';

export namespace SerialMonitor {
  export namespace Commands {
    export const AUTOSCROLL = Command.toLocalizedCommand(
      {
        id: 'serial-monitor-autoscroll',
        label: 'Autoscroll',
      },
      'arduino/serial/autoscroll'
    );
    export const TIMESTAMP = Command.toLocalizedCommand(
      {
        id: 'serial-monitor-timestamp',
        label: 'Timestamp',
      },
      'arduino/serial/timestamp'
    );
    export const CLEAR_OUTPUT = Command.toLocalizedCommand(
      {
        id: 'serial-monitor-clear-output',
        label: 'Clear Output',
        iconClass: codicon('clear-all'),
      },
      'vscode/output.contribution/clearOutput.label'
    );
    export const TERMINAL_FIND_TEXT = Command.toDefaultLocalizedCommand({
      id: 'arduino-monitor-find',
      label: 'Find',
    });
    export const TERMINAL_FIND_TEXT_CANCEL = Command.toDefaultLocalizedCommand({
      id: 'arduino-monitor-find-cancel',
      label: 'Hide Find',
    });
    export const SCROLL_LINE_UP = Command.toDefaultLocalizedCommand({
      id: 'monitor-scroll-line-up',
      label: 'Scroll Up (Line)',
    });
    export const SCROLL_LINE_DOWN = Command.toDefaultLocalizedCommand({
      id: 'monitor-scroll-line-down',
      label: 'Scroll Down (Line)',
    });
    export const SCROLL_TO_TOP = Command.toDefaultLocalizedCommand({
      id: 'monitor-scroll-top',
      label: 'Scroll to Top',
    });
    export const SCROLL_PAGE_UP = Command.toDefaultLocalizedCommand({
      id: 'monitor-scroll-page-up',
      label: 'Scroll Up (Page)',
    });
    export const SCROLL_PAGE_DOWN = Command.toDefaultLocalizedCommand({
      id: 'monitor-scroll-page-down',
      label: 'Scroll Down (Page)',
    });
    export const SELECT_ALL: Command = {
      id: 'monitor-select-all',
      label: CommonCommands.SELECT_ALL.label,
    };
  }
}

@injectable()
export class MonitorViewContribution
  extends AbstractViewContribution<MonitorWidget>
  implements TabBarToolbarContribution
{
  static readonly TOGGLE_SERIAL_MONITOR = MonitorWidget.ID + ':toggle';
  static readonly TOGGLE_SERIAL_MONITOR_TOOLBAR =
    MonitorWidget.ID + ':toggle-toolbar';
  static readonly RESET_SERIAL_MONITOR = MonitorWidget.ID + ':reset';

  @inject(MonitorModel)
  private readonly model: MonitorModel;
  @inject(MonitorManagerProxyClient)
  private readonly monitorManagerProxy: MonitorManagerProxyClient;
  @inject(ArduinoPreferences)
  private readonly arduinoPreferences: ArduinoPreferences;
  @inject(ContextKeyService)
  private readonly contextKeyService: ContextKeyService;
  @inject(BoardsServiceProvider)
  private readonly boardsServiceProvider: BoardsServiceProvider;

  private _panel: ApplicationShell.Area;

  constructor() {
    super({
      widgetId: MonitorWidget.ID,
      widgetName: serialMonitorWidgetLabel,
      defaultWidgetOptions: {
        area: defaultMonitorWidgetDockPanel,
      },
      toggleCommandId: MonitorViewContribution.TOGGLE_SERIAL_MONITOR,
      toggleKeybinding: 'CtrlCmd+Shift+M',
    });
    this._panel = defaultMonitorWidgetDockPanel;
  }

  @postConstruct()
  protected init(): void {
    const contextKey = this.contextKeyService.createKey<boolean>(
      monitorFocus,
      false
    );
    const updateMonitorFocusContext = () => {
      contextKey.set(this.shell.activeWidget instanceof MonitorWidget);
    };
    updateMonitorFocusContext();
    this._panel =
      this.arduinoPreferences['arduino.monitor.dockPanel'] ??
      defaultMonitorWidgetDockPanel;
    this.monitorManagerProxy.onMonitorShouldReset(() => this.reset());
    this.arduinoPreferences.onPreferenceChanged((event) => {
      if (
        event.preferenceName === 'arduino.monitor.dockPanel' &&
        isMonitorWidgetDockPanel(event.newValue) &&
        event.newValue !== this._panel
      ) {
        this._panel = event.newValue;
        const widget = this.tryGetWidget();
        // reopen at the new position if opened
        if (widget) {
          widget.close();
          this.openView({ activate: true, reveal: true });
        }
      }
    });
    this.shell.onDidChangeActiveWidget(updateMonitorFocusContext);
  }

  override get defaultViewOptions(): ApplicationShell.WidgetOptions {
    const viewOptions = super.defaultViewOptions;
    return {
      ...viewOptions,
      area: this._panel,
    };
  }

  override registerMenus(menus: MenuModelRegistry): void {
    if (this.toggleCommand) {
      menus.registerMenuAction(ArduinoMenus.TOOLS__MAIN_GROUP, {
        commandId: this.toggleCommand.id,
        label: serialMonitorWidgetLabel,
        order: '5',
      });
    }
  }

  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    registry.registerItem({
      id: 'monitor-autoscroll',
      render: () => this.renderAutoScrollButton(),
      isVisible: (widget) => widget instanceof MonitorWidget,
      onDidChange: this.model.onChange as Event<unknown> as Event<void>,
    });
    registry.registerItem({
      id: 'monitor-timestamp',
      render: () => this.renderTimestampButton(),
      isVisible: (widget) => widget instanceof MonitorWidget,
      onDidChange: this.model.onChange as Event<unknown> as Event<void>,
    });
    registry.registerItem({
      id: SerialMonitor.Commands.CLEAR_OUTPUT.id,
      command: SerialMonitor.Commands.CLEAR_OUTPUT.id,
      tooltip: nls.localize(
        'vscode/output.contribution/clearOutput.label',
        'Clear Output'
      ),
    });
  }

  override registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(
      { id: 'hello.hello', label: 'ping monitor' },
      {
        execute: async () => {
          const { boardList } = this.boardsServiceProvider;
          const index = boardList.selectedIndex;
          const selectedBoard = boardList.items[index];
          if (selectedBoard) {
            const { port, board } = selectedBoard;
            if (board && board.fqbn && port) {
              const endpoint = new Endpoint({
                path: 'monitor',
              }).getRestUrl();
              const url = endpoint
                .withQuery(createMonitorID({ port, fqbn: board.fqbn }))
                .toString();
              const createResp = await fetch(url, { method: 'PUT' });
              console.log('createResp', createResp);
              fetch(url).then(async (resp) => {
                const reader = resp.body?.getReader();
                if (reader) {
                  const decoder = new TextDecoder();
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      return;
                    }
                    console.log(decoder.decode(value, { stream: true }));
                  }
                }
              });
            }
          }
        },
      }
    );
    registry.registerCommand(SerialMonitor.Commands.CLEAR_OUTPUT, {
      isEnabled: (widget) => widget instanceof MonitorWidget,
      isVisible: (widget) => widget instanceof MonitorWidget,
      execute: (widget) => {
        if (widget instanceof MonitorWidget) {
          widget.clearConsole();
        }
      },
    });
    if (this.toggleCommand) {
      registry.registerCommand(this.toggleCommand, {
        execute: () => this.toggle(),
      });
      registry.registerCommand(
        { id: MonitorViewContribution.TOGGLE_SERIAL_MONITOR_TOOLBAR },
        {
          isVisible: (widget) =>
            ArduinoToolbar.is(widget) && widget.side === 'right',
          execute: () => this.toggle(),
        }
      );
    }
    registry.registerCommand(
      { id: MonitorViewContribution.RESET_SERIAL_MONITOR },
      { execute: () => this.reset() }
    );

    const findMonitorTerminal = () => {
      const { activeWidget } = this.shell;
      if (activeWidget instanceof MonitorWidget) {
        return activeWidget.terminal;
      }
      return undefined;
    };
    const registerTerminalCommand = (
      command: Command,
      task: (widget: TerminalWidget | undefined) => MaybePromise<unknown>
    ) => {
      registry.registerCommand(command, {
        isVisible: () => false,
        isEnabled: () => {
          return Boolean(findMonitorTerminal());
        },
        execute: async () => task(findMonitorTerminal()),
      });
    };
    registry.registerCommand(SerialMonitor.Commands.TERMINAL_FIND_TEXT, {
      isEnabled: () => {
        const terminal = findMonitorTerminal();
        if (terminal) {
          return !terminal.getSearchBox().isVisible;
        }
        return false;
      },
      execute: () => {
        return findMonitorTerminal()?.getSearchBox().show();
      },
    });
    registry.registerCommand(SerialMonitor.Commands.TERMINAL_FIND_TEXT_CANCEL, {
      isEnabled: () => {
        const terminal = findMonitorTerminal();
        if (terminal) {
          return terminal.getSearchBox().isVisible;
        }
        return false;
      },
      execute: () => {
        return findMonitorTerminal()?.getSearchBox().hide();
      },
    });
    registerTerminalCommand(
      SerialMonitor.Commands.SCROLL_LINE_DOWN,
      (terminal) => terminal?.scrollLineDown()
    );
    registerTerminalCommand(SerialMonitor.Commands.SCROLL_LINE_UP, (terminal) =>
      terminal?.scrollLineUp()
    );
    registerTerminalCommand(SerialMonitor.Commands.SCROLL_TO_TOP, (terminal) =>
      terminal?.scrollToTop()
    );
    registerTerminalCommand(SerialMonitor.Commands.SCROLL_PAGE_UP, (terminal) =>
      terminal?.scrollPageUp()
    );
    registerTerminalCommand(
      SerialMonitor.Commands.SCROLL_PAGE_DOWN,
      (terminal) => terminal?.scrollPageDown()
    );
    registerTerminalCommand(SerialMonitor.Commands.SELECT_ALL, (terminal) =>
      terminal?.selectAll()
    );
  }

  override registerKeybindings(keybindings: KeybindingRegistry): void {
    if (isOSX) {
      // selectAll on OSX
      keybindings.registerKeybinding({
        command: KeybindingRegistry.PASSTHROUGH_PSEUDO_COMMAND,
        keybinding: 'ctrlcmd+a',
        when: monitorFocus,
      });
    }
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.TERMINAL_FIND_TEXT.id,
      keybinding: 'ctrlcmd+f',
      when: monitorFocus,
    });
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.TERMINAL_FIND_TEXT_CANCEL.id,
      keybinding: 'esc',
      context: monitorFocus,
    });
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.SCROLL_LINE_UP.id,
      keybinding: 'ctrl+shift+up',
      when: monitorFocus,
    });
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.SCROLL_LINE_DOWN.id,
      keybinding: 'ctrl+shift+down',
      when: monitorFocus,
    });
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.SCROLL_TO_TOP.id,
      keybinding: 'shift-home',
      when: monitorFocus,
    });
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.SCROLL_PAGE_UP.id,
      keybinding: 'shift-pageUp',
      when: monitorFocus,
    });
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.SCROLL_PAGE_DOWN.id,
      keybinding: 'shift-pageDown',
      when: monitorFocus,
    });
    keybindings.registerKeybinding({
      command: SerialMonitor.Commands.SELECT_ALL.id,
      keybinding: 'ctrlcmd+a',
      when: monitorFocus,
    });
  }

  protected async toggle(): Promise<void> {
    const widget = this.tryGetWidget();
    if (widget) {
      widget.dispose();
    } else {
      await this.openView({ activate: true, reveal: true });
    }
  }

  protected async reset(): Promise<void> {
    const widget = this.tryGetWidget();
    if (widget) {
      widget.reset();
    }
  }

  protected renderAutoScrollButton(): React.ReactNode {
    return (
      <React.Fragment key="autoscroll-toolbar-item">
        <div
          title={nls.localize(
            'vscode/output.contribution/toggleAutoScroll',
            'Toggle Autoscroll'
          )}
          className={`item enabled fa fa-angle-double-down arduino-monitor ${
            this.model.autoscroll ? 'toggled' : ''
          }`}
          onClick={this.toggleAutoScroll}
        ></div>
      </React.Fragment>
    );
  }

  protected readonly toggleAutoScroll = () => this.doToggleAutoScroll();
  protected async doToggleAutoScroll(): Promise<void> {
    this.model.toggleAutoscroll();
  }

  protected renderTimestampButton(): React.ReactNode {
    return (
      <React.Fragment key="line-ending-toolbar-item">
        <div
          title={nls.localize(
            'arduino/serial/toggleTimestamp',
            'Toggle Timestamp'
          )}
          className={`item enabled fa fa-clock-o arduino-monitor ${
            this.model.timestamp ? 'toggled' : ''
          }`}
          onClick={this.toggleTimestamp}
        ></div>
      </React.Fragment>
    );
  }

  protected readonly toggleTimestamp = () => this.doToggleTimestamp();
  protected async doToggleTimestamp(): Promise<void> {
    this.model.toggleTimestamp();
  }
}
