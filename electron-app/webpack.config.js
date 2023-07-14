const webpack = require('webpack');
const configs = require('./gen-webpack.config.js');

// https://github.com/browserify/node-util/issues/57#issuecomment-764436352
const mainWindowConfig = configs[0];
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

module.exports = configs;
