import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { SidePanelHandler as TheiaSidePanelHandler } from '@theia/core/lib/browser/shell/side-panel-handler';
import { SidePanelToolbar as TheiaSidePanelToolbar } from '@theia/core/lib/browser/shell/side-panel-toolbar';
import type { TabBarToolbarFactory } from '@theia/core/lib/browser/shell/tab-bar-toolbar/tab-bar-toolbar';
import { inject, injectable } from '@theia/core/shared/inversify/index';
import type { TabBarToolbarRegistry } from '../../contributions/contribution';

@injectable()
export class SidePanelHandler extends TheiaSidePanelHandler {
  @inject(FrontendApplicationStateService)
  private readonly appStateService: FrontendApplicationStateService;

  protected override createToolbar(): TheiaSidePanelToolbar {
    const toolbar = new SidePanelToolbar(
      this.tabBarToolBarRegistry,
      this.tabBarToolBarFactory,
      this.side,
      this.appStateService
    );
    toolbar.onContextMenu((e) => this.showContextMenu(e));
    return toolbar;
  }
}

class SidePanelToolbar extends TheiaSidePanelToolbar {
  constructor(
    protected override readonly tabBarToolbarRegistry: TabBarToolbarRegistry,
    protected override readonly tabBarToolbarFactory: TabBarToolbarFactory,
    protected override readonly side: 'left' | 'right',
    private readonly appStateService: FrontendApplicationStateService
  ) {
    super(tabBarToolbarRegistry, tabBarToolbarFactory, side);
  }

  protected override updateToolbar(): void {
    if (this.appStateService.state !== 'ready') {
      return;
    }
    super.updateToolbar();
  }
}
