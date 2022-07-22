import * as remote from '@theia/core/electron-shared/@electron/remote';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import {
  CommandMenuNode,
  CompoundMenuNode,
  CompoundMenuNodeRole,
  MAIN_MENU_BAR,
  MenuNode,
  MenuPath,
} from '@theia/core/lib/common/menu';
import { isOSX } from '@theia/core/lib/common/os';
import {
  ElectronMainMenuFactory as TheiaElectronMainMenuFactory,
  ElectronMenuItemRole,
  ElectronMenuOptions,
} from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
  ArduinoMenus,
  PlaceholderMenuNode,
} from '../../../browser/menu/arduino-menus';

@injectable()
export class ElectronMainMenuFactory extends TheiaElectronMainMenuFactory {
  @inject(FrontendApplicationStateService)
  private readonly appStateService: FrontendApplicationStateService;

  private appReady = false;
  private updateWhenReady = false;

  override postConstruct(): void {
    super.postConstruct();
    this.appStateService.reachedState('ready').then(() => {
      this.appReady = true;
      if (this.updateWhenReady) {
        this.setMenuBar();
      }
    });
  }

  override createElectronMenuBar(): Electron.Menu {
    this._toggledCommands.clear(); // https://github.com/eclipse-theia/theia/issues/8977
    const menuModel = this.menuProvider.getMenu(MAIN_MENU_BAR);
    const template = this.fillMenuTemplate([], menuModel, [], {
      rootMenuPath: MAIN_MENU_BAR,
    });
    if (isOSX) {
      template.unshift(this.createOSXMenu());
    }
    const menu = remote.Menu.buildFromTemplate(this.escapeAmpersand(template));
    this._menu = menu;
    return menu;
  }

  override async setMenuBar(): Promise<void> {
    // Avoid updating menu items when the app is not ready.
    // Getting the current electron window is not free and synchronous.
    // Here, we defer all menu update requests, and fire one when the app is ready.
    if (!this.appReady) {
      this.updateWhenReady = true;
      return;
    }
    await this.preferencesService.ready;
    const createdMenuBar = this.createElectronMenuBar();
    if (isOSX) {
      remote.Menu.setApplicationMenu(createdMenuBar);
    } else {
      remote.getCurrentWindow().setMenu(createdMenuBar);
    }
  }

  override createElectronContextMenu(
    menuPath: MenuPath,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: any[],
    context?: HTMLElement
  ): Electron.Menu {
    const menuModel = this.menuProvider.getMenu(menuPath);
    const template = this.fillMenuTemplate([], menuModel, args, {
      showDisabled: false,
      context,
      rootMenuPath: menuPath,
    });
    return remote.Menu.buildFromTemplate(this.escapeAmpersand(template));
  }

  // TODO: remove after https://github.com/eclipse-theia/theia/pull/9231
  private escapeAmpersand(
    template: Electron.MenuItemConstructorOptions[]
  ): Electron.MenuItemConstructorOptions[] {
    for (const option of template) {
      if (option.label) {
        option.label = option.label.replace(/\&+/g, '&$&');
      }
      if (option.submenu) {
        this.escapeAmpersand(
          option.submenu as Electron.MenuItemConstructorOptions[]
        );
      }
    }
    return template;
  }

  protected override createOSXMenu(): Electron.MenuItemConstructorOptions {
    const { submenu } = super.createOSXMenu();
    const label = FrontendApplicationConfigProvider.get().applicationName;
    if (!!submenu && Array.isArray(submenu)) {
      const [, , /* about */ /* preferences */ ...rest] = submenu;
      const about = this.fillMenuTemplate(
        [],
        this.menuProvider.getMenu(ArduinoMenus.HELP__ABOUT_GROUP),
        [],
        { rootMenuPath: ArduinoMenus.HELP__ABOUT_GROUP }
      );
      const preferences = this.fillMenuTemplate(
        [],
        this.menuProvider.getMenu(ArduinoMenus.FILE__PREFERENCES_GROUP),
        [],
        { rootMenuPath: ArduinoMenus.FILE__PREFERENCES_GROUP }
      );
      const advanced = this.fillMenuTemplate(
        [],
        this.menuProvider.getMenu(ArduinoMenus.FILE__ADVANCED_GROUP),
        [],
        { rootMenuPath: ArduinoMenus.FILE__ADVANCED_GROUP }
      );
      return {
        label,
        submenu: [
          ...about,
          { type: 'separator' },
          ...preferences,
          ...advanced,
          { type: 'separator' },
          ...rest,
        ],
      };
    }
    return { label, submenu };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
  protected override roleFor(id: string): ElectronMenuItemRole | undefined {
    // MenuItem `roles` are completely broken on macOS:
    //  - https://github.com/eclipse-theia/theia/issues/11217,
    //  - https://github.com/arduino/arduino-ide/issues/969
    // IDE2 uses commands instead.
    return undefined;
  }

  protected override fillMenuTemplate(
    parentItems: Electron.MenuItemConstructorOptions[],
    menuModel: MenuNode,
    args: unknown[] | undefined,
    options: ElectronMenuOptions
  ): Electron.MenuItemConstructorOptions[] {
    if (menuModel instanceof PlaceholderMenuNode) {
      parentItems.push({
        label: menuModel.label,
        enabled: false,
        visible: true,
      });
    } else {
      this.superFillMenuTemplate(parentItems, menuModel, args, options);
    }
    return parentItems;
  }

  // Copied from 1.31.1 Theia as is to customize the enablement of the menu items.
  // Source: https://github.com/eclipse-theia/theia/blob/5e641750af83383f2ce0cb3432ec333df70778a8/packages/core/src/electron-browser/menu/electron-main-menu-factory.ts#L132-L203
  // See https://github.com/arduino/arduino-ide/issues/1533
  private superFillMenuTemplate(
    parentItems: Electron.MenuItemConstructorOptions[],
    menu: MenuNode,
    args: unknown[] = [],
    options: ElectronMenuOptions
  ): Electron.MenuItemConstructorOptions[] {
    const showDisabled = options?.showDisabled !== false;

    if (
      CompoundMenuNode.is(menu) &&
      menu.children.length &&
      this.undefinedOrMatch(menu.when, options.context)
    ) {
      const role = CompoundMenuNode.getRole(menu);
      if (role === CompoundMenuNodeRole.Group && menu.id === 'inline') {
        return parentItems;
      }
      const children = CompoundMenuNode.getFlatChildren(menu.children);
      const myItems: Electron.MenuItemConstructorOptions[] = [];
      children.forEach((child) =>
        this.fillMenuTemplate(myItems, child, args, options)
      );
      if (myItems.length === 0) {
        return parentItems;
      }
      if (role === CompoundMenuNodeRole.Submenu) {
        parentItems.push({ label: menu.label, submenu: myItems });
      } else if (role === CompoundMenuNodeRole.Group && menu.id !== 'inline') {
        if (
          parentItems.length &&
          parentItems[parentItems.length - 1].type !== 'separator'
        ) {
          parentItems.push({ type: 'separator' });
        }
        parentItems.push(...myItems);
        parentItems.push({ type: 'separator' });
      }
    } else if (menu.command) {
      const node =
        menu.altNode && this.context.altPressed
          ? menu.altNode
          : (menu as MenuNode & CommandMenuNode);
      const commandId = node.command;

      // That is only a sanity check at application startup.
      if (!this.commandRegistry.getCommand(commandId)) {
        console.debug(
          `Skipping menu item with missing command: "${commandId}".`
        );
        return parentItems;
      }

      if (
        !this.menuCommandExecutor.isVisible(
          options.rootMenuPath,
          commandId,
          ...args
        ) ||
        !this.undefinedOrMatch(node.when, options.context)
      ) {
        return parentItems;
      }

      // We should omit rendering context-menu items which are disabled.
      if (
        !showDisabled &&
        !this.menuCommandExecutor.isEnabled(
          options.rootMenuPath,
          commandId,
          ...args
        )
      ) {
        return parentItems;
      }

      const bindings =
        this.keybindingRegistry.getKeybindingsForCommand(commandId);

      const accelerator = bindings[0] && this.acceleratorFor(bindings[0]);

      const menuItem: Electron.MenuItemConstructorOptions = {
        id: node.id,
        label: node.label,
        type: this.commandRegistry.getToggledHandler(commandId, ...args)
          ? 'checkbox'
          : 'normal',
        checked: this.commandRegistry.isToggled(commandId, ...args),
        enabled: this.commandRegistry.isEnabled(commandId, ...args), // Unlike Theia https://github.com/eclipse-theia/theia/blob/v1.31.1/packages/core/src/electron-browser/menu/electron-main-menu-factory.ts#L183
        visible: true,
        accelerator,
        click: () => this.execute(commandId, args, options.rootMenuPath),
      };

      if (isOSX) {
        const role = this.roleFor(node.id);
        if (role) {
          menuItem.role = role;
          delete menuItem.click;
        }
      }
      parentItems.push(menuItem);

      if (this.commandRegistry.getToggledHandler(commandId, ...args)) {
        this._toggledCommands.add(commandId);
      }
    }
    return parentItems;
  }
}
