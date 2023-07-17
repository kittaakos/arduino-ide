// @ts-check
const os = require('os');
const path = require('path');
const { environment } = require('@theia/application-package/lib/environment');
if (!environment.electron.isDevMode()) {
  // `plugins` folder inside IDE2. IDE2 is shipped with these VS Code extensions. Such as cortex-debug, vscode-cpp, and translations.
  process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${path.resolve(
    __dirname,
    'plugins'
  )}`;
  // `plugins` folder inside the `~/.arduinoIDE` folder. This is for manually installed VS Code extensions. For example, custom themes.
  process.env.THEIA_PLUGINS = [
    process.env.THEIA_PLUGINS,
    `local-dir:${path.resolve(os.homedir(), '.arduinoIDE', 'plugins')}`,
  ]
    .filter(Boolean)
    .join(',');
  // `resources` folder after webpack:node.
  process.env.IDE2_RESOURCES = path.join(
    __dirname,
    'lib',
    'backend',
    'resources'
  );
}
require('./lib/backend/electron-main.js');
