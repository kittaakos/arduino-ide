const os = require('os');
const path = require('path');
// Enables the discovery of the VS Code extensions in the embedded `plugins` folder in the final app.
process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${path.resolve(
  __dirname,
  '..',
  'plugins'
)}`;
process.env.THEIA_PLUGINS = [
  process.env.THEIA_PLUGINS,
  `local-dir:${path.resolve(os.homedir(), '.arduinoIDE', 'plugins')}`,
]
  .filter(Boolean)
  .join(',');
require('../lib/backend/electron-main.js');
