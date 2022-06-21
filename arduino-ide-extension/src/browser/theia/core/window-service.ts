import { DefaultWindowService as TheiaDefaultWindowService } from '@theia/core/lib/browser/window/default-window-service';
import { WindowService as TheiaWindowService } from '@theia/core/lib/browser/window/window-service';
import { injectable } from '@theia/core/shared/inversify';

export interface WindowService extends TheiaWindowService {
  isFirstInstance(): Promise<boolean>;
}

@injectable()
export class DefaultWindowService
  extends TheiaDefaultWindowService
  implements WindowService
{
  async isFirstInstance(): Promise<boolean> {
    return true; // IDE2 treats every browser tab as the first instance. It's not used anyway.
  }
}
