import { FormatType } from '@theia/core/lib/common/i18n/localization';
import { nls } from '@theia/core/lib/common/nls';
import { FileUri } from '@theia/core/lib/node/file-uri';
import { Sketch } from '../common/protocol';

/**
 * The location indexing is one-based. Unlike in LSP, the start of the document is `{ line: 1, column: 1 }`.
 */
export interface Location {
  readonly uri: string;
  readonly line: number;
  readonly column?: number;
}
export interface ErrorInfo {
  readonly message?: string;
  readonly details?: string;
  readonly location?: Location;
}
export interface ErrorSource {
  readonly content: string | ReadonlyArray<Uint8Array>;
  readonly sketch?: Sketch;
}

export function tryParseError(source: ErrorSource): ErrorInfo {
  const { content, sketch } = source;
  const err =
    typeof content === 'string'
      ? content
      : Buffer.concat(content).toString('utf8');
  if (sketch) {
    const result = maybeRemapError(tryParse(err));
    if (result) {
      const uri = FileUri.create(result.path).toString();
      if (!Sketch.isInSketch(uri, sketch)) {
        console.warn(
          `URI <${uri}> is not contained in sketch: <${JSON.stringify(sketch)}>`
        );
        return {};
      }
      return {
        details: result.error,
        message: result.message,
        location: {
          uri: FileUri.create(result.path).toString(),
          line: result.line,
          column: result.column,
        },
      };
    }
  }
  return {};
}

interface ParseResult {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
  readonly errorPrefix: string;
  readonly error: string;
  readonly message?: string;
}
export function tryParse(raw: string): ParseResult | undefined {
  // Shamelessly stolen from the Java IDE: https://github.com/arduino/Arduino/blob/43b0818f7fa8073301db1b80ac832b7b7596b828/arduino-core/src/cc/arduino/Compiler.java#L137
  const matches =
    /(.+\.\w+):(\d+)(:\d+)*:\s*((fatal)?\s*error:\s*)(.*)\s*/m.exec(raw);
  if (!matches) {
    console.warn(`Could not parse raw error. Skipping.`);
    return undefined;
  }
  const [, path, rawLine, rawColumn, errorPrefix, , error] = matches.map(
    (match) => match.trim()
  );
  const line = Number.parseInt(rawLine, 10);
  if (!Number.isInteger(line)) {
    console.warn(
      `Could not parse line number. Raw input: <${rawLine}>, parsed integer: <${line}>.`
    );
    return undefined;
  }
  let column: number | undefined = undefined;
  if (rawColumn) {
    const normalizedRawColumn = rawColumn.slice(-1); // trims the leading colon
    column = Number.parseInt(normalizedRawColumn, 10);
    if (!Number.isInteger(column)) {
      console.warn(
        `Could not parse column number. Raw input: <${normalizedRawColumn}>, parsed integer: <${column}>.`
      );
    }
  }
  return {
    path,
    line,
    column,
    errorPrefix,
    error,
  };
}

function maybeRemapError(
  result: ParseResult | undefined
): ParseResult | undefined {
  if (!result) {
    return undefined;
  }
  const knownError = KnownErrors[result.error];
  if (!knownError) {
    return result;
  }
  const { message, error } = knownError;
  return {
    ...result,
    ...(message && { message }),
    ...(error && { error }),
  };
}

// Based on the Java IDE: https://github.com/arduino/Arduino/blob/43b0818f7fa8073301db1b80ac832b7b7596b828/arduino-core/src/cc/arduino/Compiler.java#L528-L578
const KnownErrors: Record<string, { error: string; message?: string }> = {
  'SPI.h: No such file or directory': {
    error: tr(
      'spiError',
      'Please import the SPI library from the Sketch > Import Library menu.'
    ),
    message: tr(
      'spiMessage',
      `As of Arduino 0019, the Ethernet library depends on the SPI library.
You appear to be using it or another library that depends on the SPI library.`
    ),
  },
  "'BYTE' was not declared in this scope": {
    error: tr('byteError', "The 'BYTE' keyword is no longer supported."),
    message: tr(
      'byteMessage',
      `As of Arduino 1.0, the 'BYTE' keyword is no longer supported.
Please use Serial.write() instead.`
    ),
  },
  "no matching function for call to 'Server::Server(int)'": {
    error: tr(
      'serverError',
      'The Server class has been renamed EthernetServer.'
    ),
    message: tr(
      'serverMessage',
      'As of Arduino 1.0, the Server class in the Ethernet library has been renamed to EthernetServer.'
    ),
  },
  "no matching function for call to 'Client::Client(byte [4], int)'": {
    error: tr(
      'clientError',
      'The Client class has been renamed EthernetClient.'
    ),
    message: tr(
      'clientMessage',
      'As of Arduino 1.0, the Client class in the Ethernet library has been renamed to EthernetClient.'
    ),
  },
  "'Udp' was not declared in this scope": {
    error: tr('udpError', 'The Udp class has been renamed EthernetUdp.'),
    message: tr(
      'udpMessage',
      'As of Arduino 1.0, the Udp class in the Ethernet library has been renamed to EthernetUdp.'
    ),
  },
  "'class TwoWire' has no member named 'send'": {
    error: tr('sendError', 'Wire.send() has been renamed Wire.write().'),
    message: tr(
      'sendMessage',
      'As of Arduino 1.0, the Wire.send() function was renamed to Wire.write() for consistency with other libraries.'
    ),
  },
  "'class TwoWire' has no member named 'receive'": {
    error: tr('receiveError', 'Wire.receive() has been renamed Wire.read().'),
    message: tr(
      'receiveMessage',
      'As of Arduino 1.0, the Wire.receive() function was renamed to Wire.read() for consistency with other libraries.'
    ),
  },
  "'Mouse' was not declared in this scope": {
    error: tr(
      'mouseError',
      "'Mouse' not found. Does your sketch include the line '#include <Mouse.h>'?"
    ),
  },
  "'Keyboard' was not declared in this scope": {
    error: tr(
      'keyboardError',
      "'Keyboard' not found. Does your sketch include the line '#include <Keyboard.h>'?"
    ),
  },
};

function tr(key: string, text: string, ...args: FormatType[]): string {
  return nls.localize(`arduino/cli-error-parser/${key}`, text, ...args);
}
