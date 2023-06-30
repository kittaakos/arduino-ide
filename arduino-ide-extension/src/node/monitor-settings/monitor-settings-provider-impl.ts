import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  injectable,
  inject,
  postConstruct,
} from '@theia/core/shared/inversify';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/node/file-uri';
import { MonitorSettingsProvider } from './monitor-settings-provider';
import { Deferred } from '@theia/core/lib/common/promise-util';
import {
  longestPrefixMatch,
  reconcileSettings,
} from './monitor-settings-utils';
import { ILogger } from '@theia/core';
import { PluggableMonitorSettings } from '../../common/protocol';
import { ErrnoException } from '../utils/errors';

const MONITOR_SETTINGS_FILE = 'pluggable-monitor-settings.json';

@injectable()
export class MonitorSettingsProviderImpl implements MonitorSettingsProvider {
  @inject(EnvVariablesServer)
  protected readonly envVariablesServer: EnvVariablesServer;

  @inject(ILogger)
  protected logger: ILogger;

  // deferred used to guarantee file operations are performed after the service is initialized
  protected ready = new Deferred<void>();

  // this contains actual values coming from the stored file and edited by the user
  // this is a map with MonitorId as key and PluggableMonitorSetting as value
  private monitorSettings: Record<string, PluggableMonitorSettings>;

  // this is the path to the pluggable monitor settings file, set during init
  private pluggableMonitorSettingsPath: string;

  @postConstruct()
  protected async init(): Promise<void> {
    // get the monitor settings file path
    const configDirUri = await this.envVariablesServer.getConfigDirUri();
    this.pluggableMonitorSettingsPath = join(
      FileUri.fsPath(configDirUri),
      MONITOR_SETTINGS_FILE
    );

    // read existing settings
    this.monitorSettings = await this.readSettings();

    // init is done, resolve the deferred and unblock any call that was waiting for it
    this.ready.resolve();
  }

  async getSettings(
    monitorId: string,
    defaultSettings: PluggableMonitorSettings
  ): Promise<PluggableMonitorSettings> {
    // wait for the service to complete the init
    await this.ready.promise;

    const { matchingSettings } = this.longestPrefixMatch(monitorId);

    this.monitorSettings[monitorId] = this.reconcileSettings(
      matchingSettings,
      defaultSettings
    );
    return this.monitorSettings[monitorId];
  }

  async setSettings(
    monitorId: string,
    settings: PluggableMonitorSettings
  ): Promise<PluggableMonitorSettings> {
    // wait for the service to complete the init
    await this.ready.promise;

    const newSettings = this.reconcileSettings(
      settings,
      this.monitorSettings[monitorId] || {}
    );
    this.monitorSettings[monitorId] = newSettings;

    await this.writeSettings(this.monitorSettings);
    return newSettings;
  }

  private reconcileSettings(
    newSettings: PluggableMonitorSettings,
    defaultSettings: PluggableMonitorSettings
  ): PluggableMonitorSettings {
    return reconcileSettings(newSettings, defaultSettings);
  }

  private async readSettings(): Promise<
    Record<string, PluggableMonitorSettings>
  > {
    let rawJson: string | undefined;
    try {
      rawJson = await fs.readFile(this.pluggableMonitorSettingsPath, {
        encoding: 'utf8',
      });
    } catch (err) {
      if (!ErrnoException.isENOENT(err)) {
        throw err;
      }
    }
    if (!rawJson) {
      return {};
    }
    try {
      const settings = JSON.parse(rawJson);
      return settings;
    } catch (err) {
      this.logger.error(
        'Could not parse the pluggable monitor settings file. Ignoring settings file.',
        err
      );
      return {};
    }
  }

  private async writeSettings(
    settings: Record<string, PluggableMonitorSettings>
  ): Promise<void> {
    await fs.writeFile(
      this.pluggableMonitorSettingsPath,
      JSON.stringify(settings),
      { encoding: 'utf8' }
    );
  }

  private longestPrefixMatch(id: string): {
    matchingPrefix: string;
    matchingSettings: PluggableMonitorSettings;
  } {
    return longestPrefixMatch(id, this.monitorSettings);
  }
}
