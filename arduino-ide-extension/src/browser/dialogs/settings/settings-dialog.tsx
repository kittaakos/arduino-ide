import * as React from '@theia/core/shared/react';
import {
  injectable,
  inject,
  postConstruct,
} from '@theia/core/shared/inversify';
import { Message } from '@theia/core/shared/@phosphor/messaging';
import { DialogError, DialogProps } from '@theia/core/lib/browser';
import { Settings, SettingsService } from './settings';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { nls } from '@theia/core/lib/common';
import { SettingsComponent } from './settings-component';
import { AsyncLocalizationProvider } from '@theia/core/lib/common/i18n/localization';
import { AdditionalUrls } from '../../../common/protocol';
import { AbstractDialog, ReactDialog } from '../../theia/dialogs/dialogs';
import { ThemeService } from '@theia/core/lib/browser/theming';

@injectable()
export class SettingsDialogProps extends DialogProps {}

@injectable()
export class SettingsDialog extends ReactDialog<Promise<Settings>> {
  @inject(SettingsService)
  private readonly settingsService: SettingsService;
  @inject(ThemeService)
  private readonly themeService: ThemeService;
  @inject(FileService)
  private readonly fileService: FileService;
  @inject(FileDialogService)
  private readonly fileDialogService: FileDialogService;
  @inject(WindowService)
  private readonly windowService: WindowService;
  @inject(AsyncLocalizationProvider)
  private readonly localizationProvider: AsyncLocalizationProvider;

  constructor(
    @inject(SettingsDialogProps)
    protected override readonly props: SettingsDialogProps
  ) {
    super(props);
    this.node.id = 'arduino-settings-dialog-container';
    this.contentNode.classList.add('arduino-settings-dialog');
    this.appendCloseButton(
      nls.localize('vscode/issueMainService/cancel', 'Cancel')
    );
    this.appendAcceptButton(nls.localize('vscode/issueMainService/ok', 'OK'));
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(
      this.settingsService.onDidChange(this.validate.bind(this))
    );
  }

  protected override async isValid(
    settings: Promise<Settings>
  ): Promise<DialogError> {
    const result = await this.settingsService.validate(settings);
    if (typeof result === 'string') {
      return result;
    }
    return '';
  }

  get value(): Promise<Settings> {
    return this.settingsService.settings();
  }

  protected override onActivateRequest(msg: Message): void {
    // calling settingsService.reset() in order to reload the settings from the preferenceService
    // and update the UI including changes triggered from the command palette
    this.settingsService.reset();
    super.onActivateRequest(msg);
  }

  protected override render(): React.ReactNode {
    return (
      <SettingsComponent
        settingsService={this.settingsService}
        fileService={this.fileService}
        fileDialogService={this.fileDialogService}
        windowService={this.windowService}
        localizationProvider={this.localizationProvider}
        themeService={this.themeService}
      />
    );
  }

  override async open(): Promise<Promise<Settings> | undefined> {
    const themeIdBeforeOpen = this.themeService.getCurrentTheme().id;
    const result = await super.open();
    if (!result) {
      if (this.themeService.getCurrentTheme().id !== themeIdBeforeOpen) {
        this.themeService.setCurrentTheme(themeIdBeforeOpen);
      }
    }
    return result;
  }
}

export class AdditionalUrlsDialog extends AbstractDialog<string[]> {
  protected readonly textArea: HTMLTextAreaElement;

  constructor(urls: string[], windowService: WindowService) {
    super({
      title: nls.localize(
        'arduino/preferences/additionalManagerURLs',
        'Additional Boards Manager URLs'
      ),
    });

    this.contentNode.classList.add('additional-urls-dialog');

    const description = document.createElement('div');
    description.textContent = nls.localize(
      'arduino/preferences/enterAdditionalURLs',
      'Enter additional URLs, one for each row'
    );
    description.style.marginBottom = '5px';
    this.contentNode.appendChild(description);

    this.textArea = document.createElement('textarea');
    this.textArea.className = 'theia-input';
    this.textArea.value = urls
      .filter((url) => url.trim())
      .filter((url) => !!url)
      .join('\n');
    this.textArea.wrap = 'soft';
    this.textArea.cols = 90;
    this.textArea.rows = 5;
    this.contentNode.appendChild(this.textArea);

    const anchor = document.createElement('div');
    anchor.classList.add('link');
    anchor.textContent = nls.localize(
      'arduino/preferences/unofficialBoardSupport',
      'Click for a list of unofficial board support URLs'
    );
    anchor.style.marginTop = '5px';
    anchor.style.cursor = 'pointer';
    this.addEventListener(anchor, 'click', () =>
      windowService.openNewWindow(
        'https://github.com/arduino/Arduino/wiki/Unofficial-list-of-3rd-party-boards-support-urls',
        { external: true }
      )
    );
    this.contentNode.appendChild(anchor);

    this.appendCloseButton(
      nls.localize('vscode/issueMainService/cancel', 'Cancel')
    );
    this.appendAcceptButton(nls.localize('vscode/issueMainService/ok', 'OK'));
  }

  get value(): string[] {
    return AdditionalUrls.parse(this.textArea.value, 'newline');
  }

  protected override onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    this.addUpdateListener(this.textArea, 'input');
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message);
    this.textArea.focus();
  }

  protected override handleEnter(event: KeyboardEvent): boolean | void {
    if (event.target instanceof HTMLInputElement) {
      return super.handleEnter(event);
    }
    return false;
  }
}
