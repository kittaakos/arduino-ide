import React from '@theia/core/shared/react';
import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { TreeNode } from '@theia/core/lib/browser/tree/tree';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import {
  NodeProps,
  TreeProps,
  TREE_NODE_SEGMENT_CLASS,
  TREE_NODE_TAIL_CLASS,
} from '@theia/core/lib/browser/tree/tree-widget';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FileTreeWidget } from '@theia/filesystem/lib/browser';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { SketchbookTree } from './sketchbook-tree';
import { SketchbookTreeModel } from './sketchbook-tree-model';
import { ArduinoPreferences } from '../../arduino-preferences';
import {
  CurrentSketch,
  SketchesServiceClientImpl,
} from '../../sketches-service-client-impl';
import { SelectableTreeNode } from '@theia/core/lib/browser/tree/tree-selection';
import { nls } from '@theia/core/lib/common';

const customTreeProps: TreeProps = {
  leftPadding: 26,
  expansionTogglePadding: 6,
};

@injectable()
export class SketchbookTreeWidget extends FileTreeWidget {
  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry;

  @inject(ArduinoPreferences)
  protected readonly arduinoPreferences: ArduinoPreferences;

  @inject(SketchesServiceClientImpl)
  protected readonly sketchServiceClient: SketchesServiceClientImpl;

  protected currentSketchUri = '';

  constructor(
    @inject(TreeProps) override readonly props: TreeProps,
    @inject(SketchbookTreeModel) override readonly model: SketchbookTreeModel,
    @inject(ContextMenuRenderer)
    override readonly contextMenuRenderer: ContextMenuRenderer,
    @inject(EditorManager) readonly editorManager: EditorManager
  ) {
    super(props, model, contextMenuRenderer);
    this.id = 'arduino-sketchbook-tree-widget';
    this.title.iconClass = 'sketchbook-tree-icon';
    this.title.caption = nls.localize(
      'arduino/sketch/titleLocalSketchbook',
      'Local Sketchbook'
    );
    this.title.closable = false;
    this.addClass('tree-container'); // Adds `height: 100%` to the tree. Otherwise you cannot see it.
  }

  @postConstruct()
  protected override init(): void {
    super.init();
    // cache the current open sketch uri
    this.sketchServiceClient
      .currentSketch()
      .then(
        (currentSketch) =>
          (this.currentSketchUri =
            (CurrentSketch.isValid(currentSketch) && currentSketch.uri) || '')
      );
  }

  protected override createNodeClassNames(
    node: TreeNode,
    props: NodeProps
  ): string[] {
    const classNames = super.createNodeClassNames(node, props);

    if (
      SketchbookTree.SketchDirNode.is(node) &&
      this.currentSketchUri === node?.uri.toString()
    ) {
      classNames.push('active-sketch');
    }

    return classNames;
  }

  protected override renderIcon(
    node: TreeNode,
    props: NodeProps
  ): React.ReactNode {
    if (SketchbookTree.SketchDirNode.is(node)) {
      return undefined;
    }
    const icon = this.toNodeIcon(node);
    if (icon) {
      return <div className={icon + ' file-icon'}></div>;
    }
    return undefined;
  }

  protected override renderTailDecorations(
    node: TreeNode,
    props: NodeProps
  ): React.ReactNode {
    return (
      <React.Fragment>
        {super.renderTailDecorations(node, props)}
        {this.renderInlineCommands(node)}
      </React.Fragment>
    );
  }

  protected hoveredNodeId: string | undefined;
  protected setHoverNodeId(id: string | undefined): void {
    this.hoveredNodeId = id;
  }

  protected override createNodeAttributes(
    node: TreeNode,
    props: NodeProps
  ): React.Attributes & React.HTMLAttributes<HTMLElement> {
    return {
      ...super.createNodeAttributes(node, props),
      draggable: false,
      onMouseOver: () => this.setHoverNodeId(node.id),
      onMouseOut: () => this.setHoverNodeId(undefined),
    };
  }

  protected renderInlineCommands(node: TreeNode): React.ReactNode {
    if (SketchbookTree.SketchDirNode.is(node) && node.commands) {
      return Array.from(new Set(node.commands)).map((command) =>
        this.renderInlineCommand(command, node)
      );
    }
    return undefined;
  }

  protected renderInlineCommand(
    command: Command | string | [command: string, label: string],
    node: SketchbookTree.SketchDirNode,
    options?: any
  ): React.ReactNode {
    const commandId = Command.is(command)
      ? command.id
      : Array.isArray(command)
      ? command[0]
      : command;
    const resolvedCommand = this.commandRegistry.getCommand(commandId);
    const icon = resolvedCommand?.iconClass;
    const args = { model: this.model, node: node, ...options };
    if (
      resolvedCommand &&
      icon &&
      this.commandRegistry.isEnabled(commandId, args) &&
      this.commandRegistry.isVisible(commandId, args)
    ) {
      const label = Array.isArray(command)
        ? command[1]
        : resolvedCommand.label ?? resolvedCommand.id;
      const className = [
        TREE_NODE_SEGMENT_CLASS,
        TREE_NODE_TAIL_CLASS,
        icon,
        'theia-tree-view-inline-action',
        'sketchbook-commands-icons',
      ].join(' ');
      return (
        <div
          key={`${commandId}--${node.id}`}
          className={className}
          title={label}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            this.commandRegistry.executeCommand(
              commandId,
              Object.assign(args, { event: event.nativeEvent })
            );
          }}
        />
      );
    }
    return undefined;
  }

  protected override handleClickEvent(
    node: TreeNode | undefined,
    event: React.MouseEvent<HTMLElement>
  ): void {
    if (node) {
      if (!!this.props.multiSelect) {
        const shiftMask = this.hasShiftMask(event);
        const ctrlCmdMask = this.hasCtrlCmdMask(event);
        if (SelectableTreeNode.is(node)) {
          if (shiftMask) {
            this.model.selectRange(node);
          } else if (ctrlCmdMask) {
            this.model.toggleNode(node);
          } else {
            this.model.selectNode(node);
          }
        }
      } else {
        if (SelectableTreeNode.is(node)) {
          this.model.selectNode(node);
        }
      }
      event.stopPropagation();
    }
  }

  protected override doToggle(event: React.MouseEvent<HTMLElement>): void {
    const nodeId = event.currentTarget.getAttribute('data-node-id');
    if (nodeId) {
      const node = this.model.getNode(nodeId);
      if (node && this.isExpandable(node)) {
        this.model.toggleNodeExpansion(node);
      }
    }
    event.stopPropagation();
  }

  protected override getPaddingLeft(node: TreeNode, props: NodeProps): number {
    return (
      props.depth * customTreeProps.leftPadding +
      (this.needsExpansionTogglePadding(node)
        ? customTreeProps.expansionTogglePadding
        : 0)
    );
  }
}
