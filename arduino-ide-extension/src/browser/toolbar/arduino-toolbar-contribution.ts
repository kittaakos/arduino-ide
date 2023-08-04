import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { LabelParser } from '@theia/core/lib/browser/label-parser';
import { TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { CommandRegistry } from '@theia/core/lib/common/command';
import type { Message } from '@theia/core/shared/@phosphor/messaging';
import { Widget } from '@theia/core/shared/@phosphor/widgets';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ArduinoToolbar } from './arduino-toolbar';

export class ArduinoToolbarContainer extends Widget {
  protected toolbars: ArduinoToolbar[];

  constructor(...toolbars: ArduinoToolbar[]) {
    super();
    this.id = 'arduino-toolbar-container';
    this.toolbars = toolbars;
  }

  protected override onAfterAttach(message: Message) {
    super.onAfterAttach(message);
    for (const toolbar of this.toolbars) {
      Widget.attach(toolbar, this.node);
    }
  }
}

@injectable()
export class ArduinoToolbarContribution
  implements FrontendApplicationContribution
{
  protected arduinoToolbarContainer: ArduinoToolbarContainer;

  constructor(
    @inject(TabBarToolbarRegistry)
    tabBarToolBarRegistry: TabBarToolbarRegistry,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(LabelParser) labelParser: LabelParser,
    @inject(FrontendApplicationStateService)
    appStateService: FrontendApplicationStateService
  ) {
    const leftToolbarWidget = new ArduinoToolbar(
      tabBarToolBarRegistry,
      commandRegistry,
      appStateService,
      labelParser,
      'left'
    );
    const rightToolbarWidget = new ArduinoToolbar(
      tabBarToolBarRegistry,
      commandRegistry,
      appStateService,
      labelParser,
      'right'
    );
    this.arduinoToolbarContainer = new ArduinoToolbarContainer(
      leftToolbarWidget,
      rightToolbarWidget
    );
  }

  onStart(app: FrontendApplication) {
    app.shell.addWidget(this.arduinoToolbarContainer, {
      area: 'top',
    });
  }
}
