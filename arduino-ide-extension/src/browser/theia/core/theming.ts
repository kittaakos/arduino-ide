import type { Theme } from '@theia/core/lib/common/theme';

export namespace ArduinoThemes {
  export const Light: Theme = {
    id: 'arduino-theme',
    type: 'light',
    label: 'Light (Arduino)',
    editorTheme: 'arduino-theme',
  };
  export const Dark: Theme = {
    id: 'arduino-dark-theme',
    type: 'dark',
    label: 'Dark (Arduino)',
    editorTheme: 'arduino-dark-theme',
  };
  export const Default =
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? Dark
      : Light;
}
