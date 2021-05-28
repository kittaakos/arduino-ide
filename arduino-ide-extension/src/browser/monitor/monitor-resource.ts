import { ResourceReadOptions } from '@theia/core/lib/common/resource';
import { OutputResource } from '@theia/output/lib/browser/output-resource';

export class MonitorResource extends OutputResource {

    async readContents(options?: ResourceReadOptions): Promise<string> {
        if (!this._textModel) {
            return 'Not connected';
        }
        return super.readContents(options);
    }

    async reset(): Promise<void> {
        this.textModel?.setValue('');
    }

}
