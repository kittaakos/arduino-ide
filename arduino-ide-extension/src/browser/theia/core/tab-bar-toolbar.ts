import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { TabBarToolbar as TheiaTabBarToolbar } from '@theia/core/lib/browser/shell/tab-bar-toolbar/tab-bar-toolbar';
import type { Message } from '@theia/core/shared/@phosphor/messaging';
import { inject, injectable } from '@theia/core/shared/inversify/index';

@injectable()
export class TabBarToolbar extends TheiaTabBarToolbar {
  @inject(FrontendApplicationStateService)
  private readonly appStateService: FrontendApplicationStateService;

  protected override onUpdateRequest(message: Message): void {
    if (this.appStateService.state !== 'ready') {
      return;
    }
    super.onUpdateRequest(message);
  }
}
