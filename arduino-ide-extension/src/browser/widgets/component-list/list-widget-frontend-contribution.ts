import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application';
import {
  OpenerOptions,
  OpenHandler,
} from '@theia/core/lib/browser/opener-service';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { URI } from '@theia/core/lib/common/uri';
import { injectable } from '@theia/core/shared/inversify';
import { Searchable } from '../../../common/protocol';
import { ArduinoComponent } from '../../../common/protocol/arduino-component';
import { ListWidget } from './list-widget';

@injectable()
export abstract class ListWidgetFrontendContribution<
    T extends ArduinoComponent,
    S extends Searchable.Options
  >
  extends AbstractViewContribution<ListWidget<T, S>>
  implements FrontendApplicationContribution, OpenHandler
{
  protected abstract readonly openerAuthority: string;
  readonly id: string = `http-opener-${this.viewId}`;

  async initializeLayout(): Promise<void> {
    this.openView();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override registerMenus(_: MenuModelRegistry): void {
    // NOOP
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canHandle(uri: URI, _?: OpenerOptions): number {
    // `500` is the default HTTP opener in Theia. IDE2 has higher priority.
    // https://github.com/eclipse-theia/theia/blob/b75b6144b0ffea06a549294903c374fa642135e4/packages/core/src/browser/http-open-handler.ts#L39
    return uri.scheme === 'http' && uri.authority === this.openerAuthority
      ? 501
      : 0;
  }

  async open(
    uri: URI,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _?: OpenerOptions | undefined
  ): Promise<void> {
    const searchOptions = this.parse(uri);
    if (!searchOptions) {
      console.warn(
        `Failed to parse URI into a search options. URI: ${uri.toString()}`
      );
      return;
    }

    const widget = await this.openView({
      activate: true,
      reveal: true,
    });
    if (!widget) {
      console.warn(`Failed to open view for URI: ${uri.toString()}`);
      return;
    }

    widget.refresh(searchOptions);
  }

  protected parse(uri: URI): S | undefined {
    const refinements = this.parsePath(uri.path.toString());
    if (!refinements) {
      return undefined;
    }
    return { ...refinements, query: uri.fragment } as S;
  }

  protected normalizedSegmentsOf(
    path: string,
    maxSegmentCount: number
  ): string[] | undefined {
    // /
    // /All
    // /All/Device%20Control
    // /All/Display
    const segments = path.split('/').slice(1).map(decodeURIComponent);
    if (segments.length > maxSegmentCount) {
      return undefined;
    }
    return segments;
  }

  protected abstract parsePath(path: string): Omit<S, 'query'> | undefined;
}
