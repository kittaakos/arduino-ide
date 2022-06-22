import { MaybePromise } from '@theia/core';
import { ApplicationShell, FrontendApplication } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';
import { Contribution } from '../../contributions/contribution';
import { CloudSketchbookWidget } from './cloud-sketchbook-widget';

@injectable()
export class Focus extends Contribution {
  private shell: ApplicationShell;

  override onStart(app: FrontendApplication): MaybePromise<void> {
    this.shell = app.shell;
  }

  override onReady(): MaybePromise<void> {
    this.shell
      .activateWidget('arduino-sketchbook-widget')
      .then(async (widget) => {
        if (widget instanceof CloudSketchbookWidget) {
          widget.activateTreeWidget('cloud-sketchbook-composite-widget');
        }
      });
  }
}
