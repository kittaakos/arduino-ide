import {
  AbstractDialog as TheiaAbstractDialog,
  DialogProps,
} from '@theia/core/lib/browser/dialogs';
import { ReactDialog as TheiaReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { codiconArray } from '@theia/core/lib/browser/widgets/widget';
import type { Message } from '@theia/core/shared/@phosphor/messaging';
import { inject, injectable } from '@theia/core/shared/inversify';

@injectable()
export abstract class AbstractDialog<T> extends TheiaAbstractDialog<T> {
  constructor(
    @inject(DialogProps) protected override readonly props: DialogProps
  ) {
    super(props);
    this.closeCrossNode.classList.remove(...codiconArray('close'));
    this.closeCrossNode.classList.add('fa', 'fa-close');
  }
}

@injectable()
export abstract class ReactDialog<T> extends TheiaReactDialog<T> {
  private _isOnCloseRequestInProgress = false;
  private _isOpen = false;

  override dispose(): void {
    // There is a bug in Theia, and the React component's `componentWillUnmount` will not be called, as the Theia widget is already disposed when closing and reopening a dialog.
    // Widget lifecycle issue in Theia: https://github.com/eclipse-theia/theia/issues/12093
    // Bogus react widget lifecycle management PR: https://github.com/eclipse-theia/theia/pull/11687
    // Do not call super. Do not let the Phosphor widget to be disposed on dialog close.
    if (this._isOnCloseRequestInProgress) {
      // Do not let the widget dispose on close.
      return;
    }
    super.dispose();
  }

  override async open(): Promise<T | undefined> {
    this._isOpen = true;
    try {
      const result = await super.open();
      return result;
    } finally {
      this._isOpen = false;
    }
  }

  protected override onCloseRequest(message: Message): void {
    this._isOnCloseRequestInProgress = true;
    try {
      super.onCloseRequest(message);
    } finally {
      this._isOnCloseRequestInProgress = false;
    }
  }

  protected override onUpdateRequest(message: Message): void {
    if (!this._isOpen) {
      return; // break the update message
    }
    super.onUpdateRequest(message);
  }
}
