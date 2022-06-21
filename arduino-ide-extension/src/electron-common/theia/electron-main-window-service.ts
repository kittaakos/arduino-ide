import { ElectronMainWindowService as TheiaElectronMainWindowService } from '@theia/core/lib/electron-common/electron-main-window-service';

export interface ElectronMainWindowService
  extends TheiaElectronMainWindowService {
  isFirstInstance(id: number): Promise<boolean>;
}
