import type { ResourceReadOptions } from '@theia/core/lib/common/resource';
import { OutputResource } from '@theia/output/lib/browser/output-resource';

export class MonitorResource extends OutputResource {
  override async readContents(options?: ResourceReadOptions): Promise<string> {
    if (!this._textModel) {
      return '';
    }
    return super.readContents(options);
  }

  async reset(): Promise<void> {
    this.textModel?.setValue('');
  }
}
