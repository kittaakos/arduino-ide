import { Sketch } from '../common/protocol';
import { Location } from '@theia/core/shared/vscode-languageserver-protocol';

export function tryParseError(
  rawError: string | Uint8Array[],
  sketch?: Sketch
): { message: string; location?: Location } {
  const err =
    typeof rawError === 'string'
      ? rawError
      : Buffer.concat(rawError).toString('utf8');
  if (sketch) {
  }
  return { message: err };
}
