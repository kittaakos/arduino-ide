import path from 'node:path';

// Single entry point of all resources to help webpack rewrite resources path when bundling backend application
const resourcesPath =
  process.env['IDE2_RESOURCES'] || // Set by the electron-main when forking the backend process in the bundled app
  path.join(__dirname, '..', '..', 'resources'); // The one that will be used for development.
const exe = process.platform === 'win32' ? '.exe' : '';

// Executables
export const arduinoCliPath = path.join(resourcesPath, 'arduino-cli' + exe);
export const arduinoFirmwareUploaderPath = path.join(
  resourcesPath,
  'arduino-fwuploader' + exe
);
export const arduinoLanguageServerPath = path.join(
  resourcesPath,
  'arduino-language-server' + exe
);
export const clangdPath = path.join(resourcesPath, 'clangd' + exe);
export const clangFormatPath = path.join(resourcesPath, 'clang-format' + exe);

// Internationalization
export const i18nExtensionsPath = path.join(resourcesPath, 'i18n');

// Plotter
export const arduinoPlotterWebAppPath = path.join(
  resourcesPath,
  'arduino-serial-plotter-webapp'
);
