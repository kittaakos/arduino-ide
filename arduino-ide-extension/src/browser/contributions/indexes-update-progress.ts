import { Progress } from '@theia/core/lib/common/message-service-protocol';
import { ProgressService } from '@theia/core/lib/common/progress-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ProgressMessage } from '../../common/protocol';
import { NotificationCenter } from '../notification-center';
import { Contribution } from './contribution';

@injectable()
export class IndexesUpdateProgress extends Contribution {
  @inject(NotificationCenter)
  private readonly notificationCenter: NotificationCenter;
  @inject(ProgressService)
  private readonly progressService: ProgressService;
  private currentProgress:
    | (Progress & Readonly<{ progressId: string }>)
    | undefined;

  override onStart(): void {
    this.notificationCenter.onIndexWillUpdate((progressId) =>
      this.getOrCreateProgress(progressId)
    );
    this.notificationCenter.onIndexUpdateDidProgress((progress) => {
      this.getOrCreateProgress(progress).then((delegate) =>
        delegate.report(progress)
      );
    });
    this.notificationCenter.onIndexDidUpdate((progressId) => {
      if (this.currentProgress) {
        if (this.currentProgress.progressId !== progressId) {
          console.warn(
            `Mismatching progress IDs. Expected ${progressId}, got ${this.currentProgress.progressId}. Canceling anyway.`
          );
        }
        this.currentProgress.cancel();
        this.currentProgress = undefined;
      }
    });
  }

  private async getOrCreateProgress(
    progressOrId: ProgressMessage | string
  ): Promise<Progress & { progressId: string }> {
    const progressId = ProgressMessage.is(progressOrId)
      ? progressOrId.progressId
      : progressOrId;
    if (
      this.currentProgress &&
      this.currentProgress.progressId === progressId
    ) {
      return this.currentProgress;
    }
    if (this.currentProgress) {
      this.currentProgress.cancel();
    }
    this.currentProgress = undefined;
    const progress = await this.progressService.showProgress({
      text: 'Arduino',
      // TODO: IDE2 could show the progress in `notification`, like the platform/library install and uninstall.
      // However, the index update progress responses are not much helpful. They cannot provide a fine-grain progress.
      // So IDE2 could report two total works only: index update and library index update.
      // See here an example: https://github.com/arduino/arduino-ide/issues/906#issuecomment-1171145630
      // Due to this, IDE2 shows a spinner on the status bar.
      options: { location: 'window' },
    });
    if (ProgressMessage.is(progressOrId)) {
      progress.report(progressOrId); // if the client has missed the `willStart` event, report the progress immediately.
    }
    this.currentProgress = { ...progress, progressId };
    return this.currentProgress;
  }
}
