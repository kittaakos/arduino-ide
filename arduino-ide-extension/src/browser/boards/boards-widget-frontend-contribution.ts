import { injectable } from '@theia/core/shared/inversify';
import { BoardsListWidget } from './boards-list-widget';
import {
  BoardSearch,
  BoardsPackage,
} from '../../common/protocol/boards-service';
import { ListWidgetFrontendContribution } from '../widgets/component-list/list-widget-frontend-contribution';

@injectable()
export class BoardsListWidgetFrontendContribution extends ListWidgetFrontendContribution<
  BoardsPackage,
  BoardSearch
> {
  protected readonly openerAuthority = 'boardsmanager';

  constructor() {
    super({
      widgetId: BoardsListWidget.WIDGET_ID,
      widgetName: BoardsListWidget.WIDGET_LABEL,
      defaultWidgetOptions: {
        area: 'left',
        rank: 2,
      },
      toggleCommandId: `${BoardsListWidget.WIDGET_ID}:toggle`,
      toggleKeybinding: 'CtrlCmd+Shift+B',
    });
  }

  protected parsePath(path: string): Omit<BoardSearch, 'query'> | undefined {
    const segments = this.normalizedSegmentsOf(path, 1);
    if (!segments) {
      return undefined;
    }
    const [type] = segments;
    if (!type) {
      return {
        type: 'All',
      };
    }
    if (BoardSearch.Type.is(type)) {
      return {
        type,
      };
    }
    return undefined;
  }
}
