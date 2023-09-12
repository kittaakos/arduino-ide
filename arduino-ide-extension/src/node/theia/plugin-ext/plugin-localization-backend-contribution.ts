import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { PluginLocalizationBackendContribution as TheiaPluginLocalizationBackendContribution } from '@theia/plugin-ext/lib/main/node/plugin-localization-backend-contribution';

@injectable()
export class PluginLocalizationBackendContribution extends TheiaPluginLocalizationBackendContribution {
  @postConstruct()
  protected init(): void {
    this.pluginDeployer.onDidDeploy(() => {
      this.pluginsDeployed.resolve();
    });
  }

  override async initialize(): Promise<void> {
    // Unlike Theia, IDE2 does not await here.
    // Otherwise the backend app startup is blocked until all translations are read.
    // https://github.com/eclipse-theia/theia/blob/cb426569d1d5fe42567f5ec5d35b3c77a92f3295/packages/core/src/node/i18n/localization-backend-contribution.ts#L36-L37
    this.localizationRegistry
      .initialize()
      .then(() => this.initialized.resolve());
  }

  override async waitForInitialization(): Promise<void> {
    await Promise.all([this.initialized.promise, this.pluginsDeployed.promise]);
  }
}
