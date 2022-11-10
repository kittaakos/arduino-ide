import { injectable } from '@theia/core/shared/inversify';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import {
  CommonFrontendContribution as TheiaCommonFrontendContribution,
  CommonCommands,
} from '@theia/core/lib/browser/common-frontend-contribution';
import { CommandRegistry } from '@theia/core/lib/common/command';
import type { OnWillStopAction } from '@theia/core/lib/browser/frontend-application';

@injectable()
export class CommonFrontendContribution extends TheiaCommonFrontendContribution {
  override registerCommands(commandRegistry: CommandRegistry): void {
    super.registerCommands(commandRegistry);

    for (const command of [
      CommonCommands.CONFIGURE_DISPLAY_LANGUAGE,
      CommonCommands.CLOSE_TAB,
      CommonCommands.CLOSE_SAVED_TABS,
      CommonCommands.CLOSE_OTHER_TABS,
      CommonCommands.CLOSE_ALL_TABS,
      CommonCommands.COLLAPSE_PANEL,
      CommonCommands.TOGGLE_MAXIMIZED,
      CommonCommands.PIN_TAB,
      CommonCommands.UNPIN_TAB,
      CommonCommands.NEW_UNTITLED_FILE,
    ]) {
      commandRegistry.unregisterCommand(command);
    }
  }

  override registerMenus(registry: MenuModelRegistry): void {
    super.registerMenus(registry);
    for (const command of [
      CommonCommands.SAVE,
      CommonCommands.SAVE_ALL,
      CommonCommands.CUT,
      CommonCommands.COPY,
      CommonCommands.PASTE,
      CommonCommands.COPY_PATH,
      CommonCommands.FIND,
      CommonCommands.REPLACE,
      CommonCommands.AUTO_SAVE,
      CommonCommands.OPEN_PREFERENCES,
      CommonCommands.SELECT_ICON_THEME,
      CommonCommands.SELECT_COLOR_THEME,
      CommonCommands.ABOUT_COMMAND,
      CommonCommands.SAVE_WITHOUT_FORMATTING, // Patched for https://github.com/eclipse-theia/theia/pull/8877
    ]) {
      registry.unregisterMenuAction(command);
    }
  }

  override onWillStop(): OnWillStopAction | undefined {
    // This is NOOP here. All window close and app quit requests are handled in the `Close` contribution.
    return undefined;
  }
}
