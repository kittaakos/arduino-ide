import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  codicon,
  CommonCommands,
  Widget,
} from '@theia/core/lib/browser';
import { MonitorWidget } from './monitor-widget';
import { MenuModelRegistry, Command, CommandRegistry } from '@theia/core';
import {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ArduinoToolbar } from '../../toolbar/arduino-toolbar';
import { ArduinoMenus } from '../../menu/arduino-menus';
import { nls } from '@theia/core/lib/common';
import { Event } from '@theia/core/lib/common/event';
import { MonitorModel } from '../../monitor-model';
import { MonitorManagerProxyClient } from '../../../common/protocol';
import { MonitorContextMenu } from './monitor-context-menu-service';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';

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
    ) as Command & { label: string };
    export const COPY_ALL: Command = {
      id: 'serial-monitor-copy-all',
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

  @inject(ClipboardService)
  private readonly clipboardService: ClipboardService;

  constructor(
    @inject(MonitorModel)
    protected readonly model: MonitorModel,

    @inject(MonitorManagerProxyClient)
    protected readonly monitorManagerProxy: MonitorManagerProxyClient
  ) {
    super({
      widgetId: MonitorWidget.ID,
      widgetName: MonitorWidget.LABEL,
      defaultWidgetOptions: {
        area: 'bottom',
      },
      toggleCommandId: MonitorViewContribution.TOGGLE_SERIAL_MONITOR,
      toggleKeybinding: 'CtrlCmd+Shift+M',
    });
    this.monitorManagerProxy.onMonitorShouldReset(() => this.reset());
  }

  override registerMenus(menus: MenuModelRegistry): void {
    if (this.toggleCommand) {
      menus.registerMenuAction(ArduinoMenus.TOOLS__MAIN_GROUP, {
        commandId: this.toggleCommand.id,
        label: MonitorWidget.LABEL,
        order: '5',
      });
    }
    menus.registerMenuAction(MonitorContextMenu.TEXT_EDIT_GROUP, {
      commandId: CommonCommands.COPY.id,
    });
    menus.registerMenuAction(MonitorContextMenu.TEXT_EDIT_GROUP, {
      commandId: SerialMonitor.Commands.COPY_ALL.id,
      label: nls.localizeByDefault('Copy All'),
    });
    menus.registerMenuAction(MonitorContextMenu.WIDGET_GROUP, {
      commandId: SerialMonitor.Commands.CLEAR_OUTPUT.id,
      label: nls.localizeByDefault('Clear Output'),
    });
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

  override registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(SerialMonitor.Commands.CLEAR_OUTPUT, {
      isEnabled: (arg) => {
        if (arg instanceof Widget) {
          return arg instanceof MonitorWidget;
        }
        return this.shell.currentWidget instanceof MonitorWidget;
      },
      isVisible: (arg) => {
        if (arg instanceof Widget) {
          return arg instanceof MonitorWidget;
        }
        return this.shell.currentWidget instanceof MonitorWidget;
      },
      execute: () => {
        this.widget.then((widget) => {
          this.withWidget(widget, (output) => {
            output.clearConsole();
            return true;
          });
        });
      },
    });
    if (this.toggleCommand) {
      commands.registerCommand(this.toggleCommand, {
        execute: () => this.toggle(),
      });
      commands.registerCommand(
        { id: MonitorViewContribution.TOGGLE_SERIAL_MONITOR_TOOLBAR },
        {
          isVisible: (widget) =>
            ArduinoToolbar.is(widget) && widget.side === 'right',
          execute: () => this.toggle(),
        }
      );
    }
    commands.registerCommand(
      { id: MonitorViewContribution.RESET_SERIAL_MONITOR },
      { execute: () => this.reset() }
    );
    commands.registerCommand(SerialMonitor.Commands.COPY_ALL, {
      execute: () => {
        const text = this.tryGetWidget()?.text;
        if (text) {
          this.clipboardService.writeText(text);
        }
      },
    });
  }

  protected async toggle(): Promise<void> {
    const widget = this.tryGetWidget();
    if (widget) {
      widget.close();
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

  private withWidget(
    widget: Widget | undefined = this.tryGetWidget(),
    predicate: (monitorWidget: MonitorWidget) => boolean = () => true
  ): boolean | false {
    return widget instanceof MonitorWidget ? predicate(widget) : false;
  }
}
