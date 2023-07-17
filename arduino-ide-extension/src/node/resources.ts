import path from 'node:path';

const resourcesPath = path.join(__dirname, 'resources'); // the path seems incorrect but after webpack, the resources path will be correct.
const exe = process.platform === 'win32' ? '.exe' : '';

// binaries
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

// plotter
export const arduinoPlotterWebAppPath = path.join(
  resourcesPath,
  'arduino-serial-plotter-webapp'
);

// examples
export const examplesPath = path.join(resourcesPath, 'Examples');
