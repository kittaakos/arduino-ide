import { nls } from '@theia/core/lib/common';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { injectable } from '@theia/core/shared/inversify';
import { LibraryPackage, LibrarySearch } from '../../common/protocol';
import { ArduinoMenus } from '../menu/arduino-menus';
import { ListWidgetFrontendContribution } from '../widgets/component-list/list-widget-frontend-contribution';
import { LibraryListWidget } from './library-list-widget';

@injectable()
export class LibraryListWidgetFrontendContribution extends ListWidgetFrontendContribution<
  LibraryPackage,
  LibrarySearch
> {
  protected readonly openerAuthority = 'librarymanager';

  constructor() {
    super({
      widgetId: LibraryListWidget.WIDGET_ID,
      widgetName: LibraryListWidget.WIDGET_LABEL,
      defaultWidgetOptions: {
        area: 'left',
        rank: 3,
      },
      toggleCommandId: `${LibraryListWidget.WIDGET_ID}:toggle`,
      toggleKeybinding: 'CtrlCmd+Shift+I',
    });
  }

  override registerMenus(menus: MenuModelRegistry): void {
    if (this.toggleCommand) {
      menus.registerMenuAction(ArduinoMenus.TOOLS__MAIN_GROUP, {
        commandId: this.toggleCommand.id,
        label: nls.localize(
          'arduino/library/manageLibraries',
          'Manage Libraries...'
        ),
        order: '3',
      });
    }
  }

  protected parsePath(path: string): Omit<LibrarySearch, 'query'> | undefined {
    const segments = this.normalizedSegmentsOf(path, 2);
    if (!segments) {
      return undefined;
    }
    const [type, topic] = segments;
    if (!type && !topic) {
      return {
        type: 'All',
      };
    }
    if (LibrarySearch.Type.is(type)) {
      if (!topic) {
        return {
          type,
        };
      }
      if (LibrarySearch.Topic.is(topic)) {
        return {
          type,
          topic,
        };
      }
    }
    return undefined;
  }
}
