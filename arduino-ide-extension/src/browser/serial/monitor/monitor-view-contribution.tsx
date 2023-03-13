import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { CommonCommands } from '@theia/core/lib/browser/common-frontend-contribution';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { codicon, Widget } from '@theia/core/lib/browser/widgets/widget';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { Event } from '@theia/core/lib/common/event';
import { MenuModelRegistry } from '@theia/core/lib/common/menu/menu-model-registry';
import { nls } from '@theia/core/lib/common/nls';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import React from '@theia/core/shared/react';
import { serialMonitorWidgetLabel } from '../../../common/nls';
import { MonitorManagerProxyClient } from '../../../common/protocol';
import {
  ArduinoPreferences,
  defaultMonitorWidgetDockPanel,
  isMonitorWidgetDockPanel,
} from '../../arduino-preferences';
import { ArduinoMenus } from '../../menu/arduino-menus';
import { MonitorModel } from '../../monitor-model';
import { ArduinoToolbar } from '../../toolbar/arduino-toolbar';
import { MonitorContextMenu } from './monitor-context-menu-service';
import { MonitorWidget } from './monitor-widget';

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

  @inject(MonitorModel)
  private readonly model: MonitorModel;
  @inject(MonitorManagerProxyClient)
  private readonly monitorManagerProxy: MonitorManagerProxyClient;
  @inject(ArduinoPreferences)
  private readonly arduinoPreferences: ArduinoPreferences;
  @inject(ClipboardService)
  private readonly clipboardService: ClipboardService;

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
