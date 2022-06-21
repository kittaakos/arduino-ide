import { inject, injectable } from '@theia/core/shared/inversify';
import { ElectronMainWindowServiceImpl as TheiaElectronMainWindowServiceImpl } from '@theia/core/lib/electron-main/electron-main-window-service-impl';
import { ElectronMainApplication } from './electron-main-application';
import { NewWindowOptions } from '@theia/core/lib/common/window';
import { ElectronMainWindowService } from '../../electron-common/theia/electron-main-window-service';

@injectable()
export class ElectronMainWindowServiceImpl
  extends TheiaElectronMainWindowServiceImpl
  implements ElectronMainWindowService
{
  @inject(ElectronMainApplication)
  protected override readonly app: ElectronMainApplication;

  override openNewWindow(
    url: string,
    { external }: NewWindowOptions
  ): undefined {
    if (!external) {
      const sanitizedUrl = this.sanitize(url);
      const existing = this.app.browserWindows.find(
        (window) => this.sanitize(window.webContents.getURL()) === sanitizedUrl
      );
      if (existing) {
        existing.focus();
        return;
      }
    }
    return super.openNewWindow(url, { external });
  }

  async isFirstInstance(id: number): Promise<boolean> {
    return this.app.firstWindowId === id;
  }

  private sanitize(url: string): string {
    const copy = new URL(url);
    const searchParams: string[] = [];
    copy.searchParams.forEach((_, key) => searchParams.push(key));
    for (const param of searchParams) {
      copy.searchParams.delete(param);
    }
    return copy.toString();
  }
}
