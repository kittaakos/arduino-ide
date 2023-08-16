import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { FileUri } from '@theia/core/lib/node/file-uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ParseJsonc } from './jsonc-parser';
import { ErrnoException } from './utils/errors';

// Poor man's preferences on the backend. (https://github.com/arduino/arduino-ide/issues/1056#issuecomment-1153975064)
@injectable()
export class SettingsReader {
  @inject(EnvVariablesServer)
  private readonly envVariableServer: EnvVariablesServer;
  private _settings: Deferred<Record<string, unknown> | undefined> | undefined;

  async read(
    forceReload = false
  ): Promise<Record<string, unknown> | undefined> {
    if (forceReload) {
      this._settings?.reject("Reloading settings. Received 'forceReload:true'");
      this._settings = undefined;
    }
    if (this._settings) {
      return this._settings.promise;
    }
    this._settings = new Deferred();
    setTimeout(async () => {
      const configDirUri = await this.envVariableServer.getConfigDirUri();
      const configDirPath = FileUri.fsPath(configDirUri);
      const settingsPath = join(configDirPath, 'settings.json');
      try {
        const raw = await fs.readFile(settingsPath, { encoding: 'utf8' });
        parseJsonc(raw).then((parsed) => this._settings?.resolve(parsed));
      } catch (err) {
        if (ErrnoException.isENOENT(err)) {
          this._settings?.resolve(undefined);
        } else {
          this._settings?.reject(err);
        }
      }
    }, 0);
  }
}

let _parseJsonc: ParseJsonc | undefined;
export async function parseJsonc(
  raw: string
): Promise<Record<string, unknown> | undefined> {
  if (!_parseJsonc) {
    const module = await import('./jsonc-parser.js');
    _parseJsonc = <ParseJsonc>module.default;
  }
  const start = performance.now();
  const parsed = await _parseJsonc(raw);
  console.log(`Parsing JSONC took`, performance.now() - start, 'ms'); // TODO: use debug instead of log
  return parsed;
}
