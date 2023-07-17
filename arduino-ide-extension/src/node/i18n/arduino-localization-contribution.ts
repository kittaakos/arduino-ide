import {
  LocalizationContribution,
  LocalizationRegistry,
} from '@theia/core/lib/node/i18n/localization-contribution';
import { injectable } from '@theia/core/shared/inversify';
import { join } from 'node:path';
import fs from 'node:fs/promises';
import { i18nExtensionsPath } from '../resources';

@injectable()
export class ArduinoLocalizationContribution
  implements LocalizationContribution
{
  // 0. index: locale
  // 1. index: optional JSON file to `require` (if differs from the locale)
  // If you touch the locales, please keep the alphabetical order. Also in the `package.json` for the VS Code language packs. Thank you! ❤️
  // Note that IDE2 has more translations than available VS Code language packs. (https://github.com/arduino/arduino-ide/issues/1447)
  private readonly locales: ReadonlyArray<[string, string?]> = [
    ['bg'],
    ['cs'],
    ['de'],
    ['es'],
    ['fr'],
    ['hu'],
    // ['id'], Does not have Transifex translations, but has a VS Code language pack available on Open VSX.
    ['it'],
    ['ja'],
    ['ko'],
    ['nl'],
    ['pl'],
    ['pt-br', 'pt'],
    ['ru'],
    ['tr'],
    ['uk', 'uk_UA'],
    ['zh-cn', 'zh'],
  ];

  async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
    for (const [locale, jsonFilename] of this.locales) {
      const languageVsixPath = join(
        i18nExtensionsPath,
        `${jsonFilename ?? locale}.json`
      );
      const raw = await fs.readFile(languageVsixPath, { encoding: 'utf8' });
      const json = JSON.stringify(raw);
      registry.registerLocalizationFromRequire(locale, json);
    }
  }
}
