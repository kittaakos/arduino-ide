const webpack = require('webpack');
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
    "Detected NODE_ENV=production. Overriding 'mode' with 'production'"
  );
  configs.forEach((config) => (config.mode = 'production'));
}

// Taken from https://github.com/eclipse-theia/theia-blueprint/blob/022878d5488c47650fb17b5fdf49a28be88465fe/applications/electron/webpack.config.js#L18-L21
if (process.platform !== 'win32') {
  // For some reason, blueprint wants to bundle the `.node` files directly without going through `@vscode/windows-ca-certs`
  backend.ignoredResources.add(
    '@vscode/windows-ca-certs/build/Release/crypt32.node'
  );
}

module.exports = [...frontend, backend.config];
