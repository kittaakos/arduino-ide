import debounce = require('p-debounce');
import { inject, injectable, postConstruct } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { Event, Emitter } from '@theia/core/lib/common/event';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { DebugConfigurationManager as TheiaDebugConfigurationManager } from '@theia/debug/lib/browser/debug-configuration-manager';
import { SketchesService } from '../../../common/protocol';
import { SketchesServiceClientImpl } from '../../../common/protocol/sketches-service-client-impl';
import { DebugConfigurationModel } from './debug-configuration-model';
import { FileOperationError, FileOperationResult } from '@theia/filesystem/lib/common/files';

@injectable()
export class DebugConfigurationManager extends TheiaDebugConfigurationManager {

    @inject(SketchesService)
    protected readonly sketchesService: SketchesService;

    @inject(SketchesServiceClientImpl)
    protected readonly sketchesServiceClient: SketchesServiceClientImpl;

    @inject(FrontendApplicationStateService)
    protected readonly appStateService: FrontendApplicationStateService;

    protected onIdeTempFolderConfigDidChangeEmitter = new Emitter<void>();
    get onIdeTempFolderConfigDidChange(): Event<void> {
        return this.onIdeTempFolderConfigDidChangeEmitter.event;
    }

    @postConstruct()
    protected async init(): Promise<void> {
        super.init();
        this.appStateService.reachedState('ready').then(async () => {
            const ideTempFolder = await this.getIdeTempFolderUri();
            if (ideTempFolder) {
                this.fileService.watch(ideTempFolder);
                const ideTempFolderName = ideTempFolder.path.base.toLowerCase();
                this.fileService.onDidFilesChange(event => {
                    for (const { resource } of event.changes) {
                        // Note: we cannot rely on Theia URI comparison here as the paths can be different although they point to the same thing.
                        // /var/folders/k3/d2fkvv1j16v3_rz93k7f74180000gn/T/arduino-ide2-a0337d47f86b24a51df3dbcf2cc17925/launch.json
                        // /private/var/folders/k3/d2fkvv1j16v3_rz93k7f74180000gn/T/arduino-ide2-A0337D47F86B24A51DF3DBCF2CC17925/launch.json
                        if (resource.path.base === 'launch.json' && resource.parent.path.base.toLowerCase() === ideTempFolderName) {
                            this.updateModels();
                            break;
                        }
                    }
                });
                this.updateModels();
            }
        });
    }

    protected updateModels = debounce(async () => {
        await this.appStateService.reachedState('ready');
        const roots = await this.workspaceService.roots;
        const toDelete = new Set(this.models.keys());
        for (const rootStat of roots) {
            const key = rootStat.resource.toString();
            toDelete.delete(key);
            if (!this.models.has(key)) {
                const [config, ideTempFolderUri] = await Promise.all([
                    this.getIdeLaunchConfig(),
                    this.getIdeTempFolderUri()
                ]);
                if (ideTempFolderUri) {
                    const model = new DebugConfigurationModel(key, this.preferences, config, ideTempFolderUri, this.onIdeTempFolderConfigDidChange);
                    model.onDidChange(() => this.updateCurrent());
                    model.onDispose(() => this.models.delete(key));
                    this.models.set(key, model);
                }
            }
        }
        for (const uri of toDelete) {
            const model = this.models.get(uri);
            if (model) {
                model.dispose();
            }
        }
        this.updateCurrent();
    }, 500);

    protected async getIdeLaunchConfig(): Promise<any> {
        const ideTempFolderUri = await this.getIdeTempFolderUri();
        if (!ideTempFolderUri) {
            return {};
        }
        try {
            const { value } = await this.fileService.read(ideTempFolderUri.resolve('launch.json'));
            return JSON.parse(value);
        } catch (err) {
            if (err instanceof FileOperationError && err.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
                return {};
            }
            console.error('Could not load debug configuration from IDE2 temp folder.', err);
            return {};
        }
    }

    protected async getIdeTempFolderUri(): Promise<URI | undefined> {
        const sketch = await this.sketchesServiceClient.currentSketch();
        if (!sketch) {
            return undefined;
        }
        const uri = await this.sketchesService.getIdeTempFolderUri(sketch);
        const ideTempFolderUri = new URI(uri);
        await this.fileService.createFolder(ideTempFolderUri);
        return ideTempFolderUri;
    }

}
