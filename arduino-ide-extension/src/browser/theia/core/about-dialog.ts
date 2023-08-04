import { AboutDialog as TheiaAboutDialog } from '@theia/core/lib/browser/about-dialog';

export class AboutDialog extends TheiaAboutDialog {
  protected override async init(): Promise<void> {
    // NOOP
    // IDE2 has a custom about dialog, so it does not make sense to collect Theia extensions at startup time.
  }
  protected override onUpdateRequest(): void {
    // NOOP
    // Although IDE2 does not use it, the Theia one exists, and updated. This is how it works.
  }
  protected override render(): undefined {
    return undefined;
  }
}
