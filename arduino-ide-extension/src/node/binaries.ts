import { platform } from 'node:os';
import { join } from 'node:path';

const relative = ['..', '..', 'build'];
const extension = platform() === 'win32' ? '.exe' : '';
export const arduinoCliPath =
  join(__dirname, ...relative, 'arduino-cli') + extension;
export const arduinoFirmwareUploaderPath =
  join(__dirname, ...relative, 'arduino-fwuploader') + extension;
export const arduinoLanguageServerPath =
  join(__dirname, ...relative, 'arduino-language-server') + extension;
export const clangdPath = join(__dirname, ...relative, 'clangd') + extension;
export const clangFormatPath =
  join(__dirname, ...relative, 'clang-format') + extension;
