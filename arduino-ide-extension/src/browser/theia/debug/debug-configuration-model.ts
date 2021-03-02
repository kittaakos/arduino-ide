import { Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { PreferenceService } from '@theia/core/lib/browser/preferences/preference-service';
import { DebugConfiguration } from '@theia/debug/lib/common/debug-common';
import { DebugConfigurationModel as TheiaDebugConfigurationModel } from '@theia/debug/lib/browser/debug-configuration-model';

export class DebugConfigurationModel extends TheiaDebugConfigurationModel {

    constructor(
        readonly workspaceFolderUri: string,
        protected readonly preferences: PreferenceService,
        protected readonly value: any,
        protected readonly configUri: URI,
        protected readonly onConfigDidChange: Event<void>) {

        super(workspaceFolderUri, preferences);
        this.toDispose.push(onConfigDidChange(() => this.reconcile()));
        this.reconcile();
    }

    protected parseConfigurations(): TheiaDebugConfigurationModel.JsonContent {
        const configurations: DebugConfiguration[] = [];
        const collectConfigurations = (from: any) => {
            if (from && typeof from === 'object' && 'configurations' in from) {
                if (Array.isArray(from.configurations)) {
                    for (const configuration of from.configurations) {
                        if (DebugConfiguration.is(configuration)) {
                            configurations.push(configuration);
                        }
                    }
                }
            }
        }
        collectConfigurations(this.value);
        return {
            uri: this.configUri,
            configurations
        };
    }

}
