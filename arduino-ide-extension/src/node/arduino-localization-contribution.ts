import {
  LocalizationContribution,
  LocalizationRegistry,
} from '@theia/core/lib/node/i18n/localization-contribution';
import { injectable } from '@theia/core/shared/inversify';
import bgJson from './i18n/bg.json';
import csJson from './i18n/cs.json';
import deJson from './i18n/de.json';
import esJson from './i18n/es.json';
import frJson from './i18n/fr.json';
import huJson from './i18n/hu.json';
import itJson from './i18n/it.json';
import jaJson from './i18n/ja.json';
import koJson from './i18n/ko.json';
import nlJson from './i18n/nl.json';
import plJson from './i18n/pl.json';
import ptJson from './i18n/pt.json';
import ruJson from './i18n/ru.json';
import trJson from './i18n/tr.json';
import uk_UAJson from './i18n/uk_UA.json';
import zhJson from './i18n/zh.json';

@injectable()
export class ArduinoLocalizationContribution
  implements LocalizationContribution
{
  // keys: locales
  // values: the required JSON modules
  // If you touch the locales, please keep the alphabetical order. Also in the `package.json` for the VS Code language packs. Thank you! ❤️
  // Note that IDE2 has more translations than available VS Code language packs. (https://github.com/arduino/arduino-ide/issues/1447)
  private readonly locales: Readonly<Record<string, unknown>> = {
    bg: bgJson,
    cs: csJson,
    de: deJson,
    es: esJson,
    fr: frJson,
    hu: huJson,
    // ['id'], Does not have Transifex translations, but has a VS Code language pack available on Open VSX.
    it: itJson,
    ja: jaJson,
    ko: koJson,
    nl: nlJson,
    pl: plJson,
    'pt-br': ptJson,
    ru: [ruJson],
    tr: [trJson],
    uk: uk_UAJson,
    'zh-cn': zhJson,
  };

  async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
    for (const [locale, module] of Object.entries(this.locales)) {
      registry.registerLocalizationFromRequire(locale, module);
    }
  }
}
