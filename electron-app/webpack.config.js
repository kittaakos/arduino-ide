//@ts-check

const path = require('path');
const temp = require('temp');
const { promises: fs } = require('fs');
const webpack = require('webpack');
const frontendConfigs = require('./gen-webpack.config.js');
const backendConfig = require('./gen-webpack.node.config.js');
const CopyPlugin = require('copy-webpack-plugin');
const PermissionsOutputPlugin = require('webpack-permissions-plugin');

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

/** @type {import('temp')} */
const tracker = temp.track();
const webpackExecutablesPlugin = 'webpack-executables-plugin';
class WebpackExecutablesPlugin {
  /** @type {{out: string}} */
  options;

  /**
   * @param {{out: string}} options
   */
  constructor(options) {
    this.options = options;
  }

  /**
   * @param {import('webpack').Compiler} compiler
   * @return {void}
   */
  apply(compiler) {
    const replacements = {};
    compiler.hooks.initialize.tap(webpackExecutablesPlugin, () => {
      const directory = tracker.mkdirSync({
        dir: path.resolve(compiler.outputPath, webpackExecutablesPlugin),
      });
      // const binariesModule = this.buildFile(directory, 'binaries.js', 'hello');
    });
    compiler.hooks.normalModuleFactory.tap(webpackExecutablesPlugin, (nmf) => {
      nmf.hooks.beforeResolve.tap(webpackExecutablesPlugin, (result) => {
        for (const [file, replacement] of Object.entries(replacements)) {
          if (result.request === file) {
            result.request = replacement;
          }
        }
      });
      nmf.hooks.afterResolve.tap(webpackExecutablesPlugin, (result) => {
        const createData = result.createData;
        for (const [file, replacement] of Object.entries(replacements)) {
          if (createData.resource === file) {
            createData.resource = replacement;
          }
        }
      });
    });
    compiler.hooks.afterEmit.tapAsync(webpackExecutablesPlugin, async () => {
      const binariesSource = require('arduino-ide-extension/lib/node/binaries');
      const descriptors = Object.getOwnPropertyDescriptors(binariesSource);
      for (const descriptor of Object.values(descriptors)) {
        const maybePath = descriptor.value;
        if (typeof maybePath === 'string') {
          try {
            await fs.access(maybePath, fs.constants.X_OK);
          } catch {
            continue;
          }
          const source = maybePath;
          const filename = path.basename(source);
          const targetDirectory = path.join(
            compiler.outputPath,
            this.options.out
          );
          const target = path.join(targetDirectory, filename);
          await fs.mkdir(targetDirectory, { recursive: true });
          await fs.copyFile(source, target);
          await fs.chmod(target, 0o777);
          console.log(`Copied ${source} to ${target}`);
        }
      }
      tracker.cleanupSync();
    });
    compiler.hooks.failed.tap(webpackExecutablesPlugin, () =>
      tracker.cleanupSync()
    );
  }
}

// Include the plotter web app in the static folder of express.
const plotterWebApp = path.join(
  require.resolve('arduino-serial-plotter-webapp/build/index.html'),
  '..'
);
const executables = path.join(
  require.resolve('arduino-ide-extension/lib/node/exec-util'),
  '..',
  '..',
  '..',
  'build'
);
console.log('HELLO', executables, 'HELLO2');
if (!backendConfig.config.plugins) {
  backendConfig.config.plugins = [];
}
backendConfig.config.plugins.push(
  new CopyPlugin({
    patterns: [
      { from: plotterWebApp, to: 'plotter-webapp' },
      {
        from: executables,
        to: 'build',
        globOptions: {
          ignore: ['**/i18n/**', '**/*.txt'],
        },
      },
    ],
  }),
  new PermissionsOutputPlugin({
    buildFolders: [
      {
        path: path.resolve(__dirname, 'build'),
        fileMode: '755',
        dirMode: '644',
      },
    ],
  })
);

module.exports = [...frontendConfigs, backendConfig.config];
