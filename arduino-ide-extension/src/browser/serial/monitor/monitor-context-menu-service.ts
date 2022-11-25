import type { MenuPath } from '@theia/core/lib/common/menu';
import { injectable } from '@theia/core/shared/inversify';
import { MonacoContextMenuService } from '@theia/monaco/lib/browser/monaco-context-menu';

export namespace MonitorContextMenu {
  export const MENU_PATH: MenuPath = ['monitor_context_menu'];
  export const TEXT_EDIT_GROUP = [...MENU_PATH, '0_text_edit_group'];
  export const WIDGET_GROUP = [...MENU_PATH, '1_widget_group'];
}

@injectable()
export class MonitorContextMenuService extends MonacoContextMenuService {
  protected override menuPath(): MenuPath {
    return MonitorContextMenu.MENU_PATH;
  }
}
