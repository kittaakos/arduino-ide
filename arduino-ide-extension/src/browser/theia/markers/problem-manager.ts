import {
  inject,
  injectable,
  postConstruct,
} from '@theia/core/shared/inversify';
import { Diagnostic } from 'vscode-languageserver-types';
import URI from '@theia/core/lib/common/uri';
import { ILogger } from '@theia/core';
import { Marker } from '@theia/markers/lib/common/marker';
import { ProblemManager as TheiaProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { ConfigService } from '../../../common/protocol/config-service';
import debounce = require('lodash.debounce');

@injectable()
export class ProblemManager extends TheiaProblemManager {
  @inject(ConfigService)
  protected readonly configService: ConfigService;

  @inject(ILogger)
  protected readonly logger: ILogger;

  protected dataDirUri: URI | undefined;

  @postConstruct()
  protected override init(): void {
    super.init();
    this.configService
      .getConfiguration()
      .then(({ dataDirUri }) => (this.dataDirUri = new URI(dataDirUri)))
      .catch((err) =>
        this.logger.error(`Failed to determine the data directory: ${err}`)
      );
  }

  override setMarkers(
    uri: URI,
    owner: string,
    data: Diagnostic[]
  ): Marker<Diagnostic>[] {
    if (this.dataDirUri && this.dataDirUri.isEqualOrParent(uri)) {
      return [];
    }
    return super.setMarkers(uri, owner, data);
  }

  private readonly debouncedFireOnDidChangeMakers = debounce(
    (uri: URI) => this.onDidChangeMarkersEmitter.fire(uri),
    500
  );
  protected override fireOnDidChangeMarkers(uri: URI): void {
    this.debouncedFireOnDidChangeMakers(uri);
  }
}
