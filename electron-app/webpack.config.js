const path = require('path');
const webpack = require('webpack');
const frontendConfigs = require('./gen-webpack.config.js');
const backendConfig = require('./gen-webpack.node.config.js');
const CopyPlugin = require('copy-webpack-plugin');

// https://github.com/browserify/node-util/issues/57#issuecomment-764436352
const mainWindowConfig = frontendConfigs[0];
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

// https://github.com/eclipse-theia/theia-blueprint/blob/022878d5488c47650fb17b5fdf49a28be88465fe/applications/browser/webpack.config.js#L18-L21
if (process.platform !== 'win32') {
  // For some reason, webpack wants to bundle the `.node` files directly without going through `@vscode/windows-ca-certs`
  backendConfig.ignoredResources.add(
    '@vscode/windows-ca-certs/build/Release/crypt32.node'
  );
}

// Include the plotter web app in the static folder of express.
const plotterWebApp = path.join(
  require.resolve('arduino-serial-plotter-webapp/build/index.html'),
  '..'
);
// // Include the executables and examples in the backend code.
// const executables = path.dirname(
//   path.join(
//     require.resolve('arduino-ide-extension/lib/node/exec-util'),
//     '../../../build'
//   )
// );
// // Include the built-in examples, and the their generated parentage file.
// const examples = path.dirname(
//   path.join('arduino-ide-extension/lib/node/exec-util', '../../../Examples')
// );
backendConfig.config.plugins.push(
  new CopyPlugin({
    patterns: [
      { from: plotterWebApp, to: 'plotter-webapp' },
      // { from: executables, to: 'build' },
      // { from: examples, to: 'Examples' },
    ],
  })
);

module.exports = [...frontendConfigs, backendConfig.config];
