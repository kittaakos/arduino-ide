const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('node:path');
const resolvePackagePath = require('resolve-package-path');
const webpack = require('webpack');
const PermissionsOutputPlugin = require('webpack-permissions-plugin');
const frontend = require('./gen-webpack.config');
const backend = require('./gen-webpack.node.config');

// https://github.com/browserify/node-util/issues/57#issuecomment-764436352
const mainWindowConfig = frontend[0];
mainWindowConfig.resolve.extensions.push('.ts');
mainWindowConfig.resolve.fallback['util'] = require.resolve('util/');
mainWindowConfig.plugins?.push(
  new webpack.ProvidePlugin({
    // Make a global `process` variable that points to the `process` package,
    // because the `util` package expects there to be a global variable named `process`.
    // Thanks to https://stackoverflow.com/a/65018686/14239942
    process: 'process/browser',
  })
);

if (process.env.NODE_ENV === 'production') {
  console.info(
    "Detected NODE_ENV=production. Overriding 'mode' with 'production' and minimizing code."
  );
  frontend.forEach((config) => (config.mode = 'production'));
  backend.config.optimization.minimize = true;
}

// Taken from https://github.com/eclipse-theia/theia-blueprint/blob/022878d5488c47650fb17b5fdf49a28be88465fe/applications/electron/webpack.config.js#L18-L21
if (process.platform !== 'win32') {
  // For some reason, blueprint wants to bundle the `.node` files directly without going through `@vscode/windows-ca-certs`
  backend.ignoredResources.add(
    '@vscode/windows-ca-certs/build/Release/crypt32.node'
  );
}

const arduinoIdeExtensionPackageJson = resolvePackagePath(
  'arduino-ide-extension',
  __dirname
);
if (!arduinoIdeExtensionPackageJson) {
  throw new Error("Could not resolve the 'arduino-ide-extension' package.");
}

const arduinoSerialPlotterWebAppPackageJson = resolvePackagePath(
  'arduino-serial-plotter-webapp',
  __dirname
);
if (!arduinoSerialPlotterWebAppPackageJson) {
  throw new Error(
    "Could not resolve the 'arduino-serial-plotter-webapp' package."
  );
}
// Copy all the IDE2 binaries and the plotter web app.
backend.config.plugins.push(
  new CopyWebpackPlugin({
    patterns: [
      // binaries
      {
        from: path.join(arduinoIdeExtensionPackageJson, '..', 'resources'),
        to: path.resolve(__dirname, 'lib', 'backend', 'resources'),
        globOptions: {
          ignore: ['**/i18n/**'],
        },
      },
      // plotter app
      {
        from: path.join(arduinoSerialPlotterWebAppPackageJson, '..', 'build'),
        to: path.resolve(
          __dirname,
          'lib',
          'backend',
          'resources',
          'arduino-serial-plotter-webapp'
        ),
      },
    ],
  }),
  // restore file permissions after webpack copy
  new PermissionsOutputPlugin({
    buildFolders: [
      {
        path: path.join(__dirname, 'lib', 'backend', 'resources'),
        fileMode: '755',
        dirMode: '644',
      },
    ],
  })
);

module.exports = [...frontend, backend.config];
