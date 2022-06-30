import { inject, injectable } from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common/workspace-protocol';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import {
  SketchContribution,
  CommandRegistry,
  MenuModelRegistry,
  Sketch,
} from './contribution';
import { ArduinoMenus } from '../menu/arduino-menus';
import { MainMenuManager } from '../../common/main-menu-manager';
import { OpenSketch } from './open-sketch';
import { NotificationCenter } from '../notification-center';
import { nls } from '@theia/core/lib/common';

@injectable()
export class OpenRecentSketch extends SketchContribution {
  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry;

  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry;

  @inject(MainMenuManager)
  protected readonly mainMenuManager: MainMenuManager;

  @inject(WorkspaceServer)
  protected readonly workspaceServer: WorkspaceServer;

  @inject(NotificationCenter)
  protected readonly notificationCenter: NotificationCenter;

  protected toDisposeBeforeRegister = new Map<string, DisposableCollection>();

  override onStart(): void {
    this.notificationCenter.onRecentSketchesDidChange(({ sketches }) =>
      this.refreshMenu(sketches)
    );
  }

  override async onReady(): Promise<void> {
    this.sketchService
      .recentlyOpenedSketches()
      .then((sketches) => this.refreshMenu(sketches));
  }

  override registerMenus(registry: MenuModelRegistry): void {
    registry.registerSubmenu(
      ArduinoMenus.FILE__OPEN_RECENT_SUBMENU,
      nls.localize('arduino/sketch/openRecent', 'Open Recent'),
      { order: '2' }
    );
  }

  private refreshMenu(sketches: Sketch[]): void {
    this.register(sketches);
    this.mainMenuManager.update();
  }

  protected register(sketches: Sketch[]): void {
    const order = 0;
    for (const sketch of sketches) {
      const { uri } = sketch;
      const toDispose = this.toDisposeBeforeRegister.get(uri);
      if (toDispose) {
        toDispose.dispose();
      }
      const command = { id: `arduino-open-recent--${uri}` };
      const handler = {
        execute: () =>
          this.commandRegistry.executeCommand(
            OpenSketch.Commands.OPEN_SKETCH.id,
            sketch
          ),
      };
      this.commandRegistry.registerCommand(command, handler);
      this.menuRegistry.registerMenuAction(
        ArduinoMenus.FILE__OPEN_RECENT_SUBMENU,
        {
          commandId: command.id,
          label: sketch.name,
          order: String(order),
        }
      );
      this.toDisposeBeforeRegister.set(
        sketch.uri,
        new DisposableCollection(
          Disposable.create(() =>
            this.commandRegistry.unregisterCommand(command)
          ),
          Disposable.create(() =>
            this.menuRegistry.unregisterMenuAction(command)
          )
        )
      );
    }
  }
}
