import * as PQueue from 'p-queue';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandHandler } from '@theia/core/lib/common/command';
import {
  MenuPath,
  CompositeMenuNode,
  SubMenuOptions,
} from '@theia/core/lib/common/menu';
import {
  Disposable,
  DisposableCollection,
} from '@theia/core/lib/common/disposable';
import { OpenSketch } from './open-sketch';
import { ArduinoMenus, PlaceholderMenuNode } from '../menu/arduino-menus';
import { MainMenuManager } from '../../common/main-menu-manager';
import { BoardsServiceProvider } from '../boards/boards-service-provider';
import { ExamplesService } from '../../common/protocol/examples-service';
import {
  SketchContribution,
  CommandRegistry,
  MenuModelRegistry,
  URI,
} from './contribution';
import { NotificationCenter } from '../notification-center';
import { Board, SketchRef, SketchContainer } from '../../common/protocol';
import { nls } from '@theia/core/lib/common/nls';

@injectable()
export abstract class Examples extends SketchContribution {
  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry;

  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry;

  @inject(MainMenuManager)
  protected readonly menuManager: MainMenuManager;

  @inject(ExamplesService)
  protected readonly examplesService: ExamplesService;

  @inject(BoardsServiceProvider)
  protected readonly boardsServiceClient: BoardsServiceProvider;

  protected readonly toDispose = new DisposableCollection();

  protected override init(): void {
    super.init();
    this.boardsServiceClient.onBoardsConfigChanged(({ selectedBoard }) =>
      this.handleBoardChanged(selectedBoard)
    );
  }

  protected handleBoardChanged(board: Board | undefined): void {
    // NOOP
  }

  override registerMenus(registry: MenuModelRegistry): void {
    try {
      // This is a hack the ensures the desired menu ordering! We cannot use https://github.com/eclipse-theia/theia/pull/8377 due to ATL-222.
      const index = ArduinoMenus.FILE__EXAMPLES_SUBMENU.length - 1;
      const menuId = ArduinoMenus.FILE__EXAMPLES_SUBMENU[index];
      const groupPath =
        index === 0 ? [] : ArduinoMenus.FILE__EXAMPLES_SUBMENU.slice(0, index);
      const parent: CompositeMenuNode = (registry as any).findGroup(groupPath);
      const examples = new CompositeMenuNode(menuId, '', { order: '4' });
      parent.addNode(examples);
    } catch (e) {
      console.error(e);
      console.warn('Could not patch menu ordering.');
    }
    // Registering the same submenu multiple times has no side-effect.
    // TODO: unregister submenu? https://github.com/eclipse-theia/theia/issues/7300
    registry.registerSubmenu(
      ArduinoMenus.FILE__EXAMPLES_SUBMENU,
      nls.localize('arduino/examples/menu', 'Examples'),
      {
        order: '4',
      }
    );
  }

  registerRecursively(
    sketchContainerOrPlaceholder:
      | SketchContainer
      | (SketchRef | SketchContainer)[]
      | string,
    menuPath: MenuPath,
    pushToDispose: DisposableCollection = new DisposableCollection(),
    subMenuOptions?: SubMenuOptions | undefined
  ): void {
    if (typeof sketchContainerOrPlaceholder === 'string') {
      const placeholder = new PlaceholderMenuNode(
        menuPath,
        sketchContainerOrPlaceholder
      );
      this.menuRegistry.registerMenuNode(menuPath, placeholder);
      pushToDispose.push(
        Disposable.create(() =>
          this.menuRegistry.unregisterMenuNode(placeholder.id)
        )
      );
    } else {
      const sketches: SketchRef[] = [];
      const children: SketchContainer[] = [];
      let submenuPath = menuPath;

      if (SketchContainer.is(sketchContainerOrPlaceholder)) {
        const { label } = sketchContainerOrPlaceholder;
        submenuPath = [...menuPath, label];
        this.menuRegistry.registerSubmenu(submenuPath, label, subMenuOptions);
        sketches.push(...sketchContainerOrPlaceholder.sketches);
        children.push(...sketchContainerOrPlaceholder.children);
      } else {
        for (const sketchOrContainer of sketchContainerOrPlaceholder) {
          if (SketchContainer.is(sketchOrContainer)) {
            children.push(sketchOrContainer);
          } else {
            sketches.push(sketchOrContainer);
          }
        }
      }
      children.forEach((child) =>
        this.registerRecursively(child, submenuPath, pushToDispose)
      );
      for (const sketch of sketches) {
        const { uri } = sketch;
        const commandId = `arduino-open-example-${submenuPath.join(
          ':'
        )}--${uri}`;
        const command = { id: commandId };
        const handler = this.createHandler(uri);
        pushToDispose.push(
          this.commandRegistry.registerCommand(command, handler)
        );
        this.menuRegistry.registerMenuAction(submenuPath, {
          commandId,
          label: sketch.name,
          order: sketch.name.toLocaleLowerCase(),
        });
        pushToDispose.push(
          Disposable.create(() =>
            this.menuRegistry.unregisterMenuAction(command)
          )
        );
      }
    }
  }

  protected createHandler(uri: string): CommandHandler {
    return {
      execute: async () => {
        const sketch = await this.sketchService.cloneExample(uri);
        return this.commandService
          .executeCommand(OpenSketch.Commands.OPEN_SKETCH.id, sketch)
          .then((result) => {
            const name = new URI(uri).path.base;
            this.sketchService.markAsRecentlyOpened({ name, sourceUri: uri }); // no await
            return result;
          });
      },
    };
  }
}

@injectable()
export class BuiltInExamples extends Examples {
  override async onReady(): Promise<void> {
    this.register(); // no `await`
  }

  protected async register(): Promise<void> {
    let sketchContainers: SketchContainer[] | undefined;
    try {
      sketchContainers = await this.examplesService.builtIns();
    } catch (e) {
      console.error('Could not initialize built-in examples.', e);
      this.messageService.error(
        nls.localize(
          'arduino/examples/couldNotInitializeExamples',
          'Could not initialize built-in examples.'
        )
      );
      return;
    }
    this.toDispose.dispose();
    for (const container of [
      nls.localize('arduino/examples/builtInExamples', 'Built-in examples'),
      ...sketchContainers,
    ]) {
      this.registerRecursively(
        container,
        ArduinoMenus.EXAMPLES__BUILT_IN_GROUP,
        this.toDispose
      );
    }
    this.menuManager.update();
  }
}

@injectable()
export class LibraryExamples extends Examples {
  @inject(NotificationCenter)
  protected readonly notificationCenter: NotificationCenter;

  protected readonly queue = new PQueue({ autoStart: true, concurrency: 1 });

  override onStart(): void {
    this.notificationCenter.onLibraryDidInstall(() => this.register());
    this.notificationCenter.onLibraryDidUninstall(() => this.register());
  }

  override async onReady(): Promise<void> {
    this.register(); // no `await`
  }

  protected override handleBoardChanged(board: Board | undefined): void {
    this.register(board);
  }

  protected async register(
    board: Board | undefined = this.boardsServiceClient.boardsConfig
      .selectedBoard
  ): Promise<void> {
    return this.queue.add(async () => {
      this.toDispose.dispose();
      const fqbn = board?.fqbn;
      const name = board?.name;
      // Shows all examples when no board is selected, or the platform of the currently selected board is not installed.
      const { user, current, any } = await this.examplesService.installed({
        fqbn,
      });
      if (user.length) {
        (user as any).unshift(
          nls.localize(
            'arduino/examples/customLibrary',
            'Examples from Custom Libraries'
          )
        );
      }
      if (name && fqbn && current.length) {
        (current as any).unshift(
          nls.localize('arduino/examples/for', 'Examples for {0}', name)
        );
      }
      if (any.length) {
        (any as any).unshift(
          nls.localize('arduino/examples/forAny', 'Examples for any board')
        );
      }
      for (const container of user) {
        this.registerRecursively(
          container,
          ArduinoMenus.EXAMPLES__USER_LIBS_GROUP,
          this.toDispose
        );
      }
      for (const container of current) {
        this.registerRecursively(
          container,
          ArduinoMenus.EXAMPLES__CURRENT_BOARD_GROUP,
          this.toDispose
        );
      }
      for (const container of any) {
        this.registerRecursively(
          container,
          ArduinoMenus.EXAMPLES__ANY_BOARD_GROUP,
          this.toDispose
        );
      }
      this.menuManager.update();
    });
  }
}
