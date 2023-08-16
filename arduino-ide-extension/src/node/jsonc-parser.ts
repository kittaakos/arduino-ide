import type { ParseError } from 'jsonc-parser';
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads';

export type ParsedJsonc = Promise<Record<string, unknown>>;
export type ParseJsonc = (text: string) => Promise<ParsedJsonc | undefined>;

if (isMainThread) {
  module.exports = function parseJsonc(text: string): ReturnType<ParseJsonc> {
    return new Promise<ParsedJsonc>((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: text,
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Jsonc parser stopped with exit code ${code}`));
        }
      });
    });
  };
} else {
  import('jsonc-parser').then((module) => {
    const { parse: parseJsonc, printParseErrorCode } = module;
    const text = workerData;
    const errors: ParseError[] = [];
    const parseResult =
      parseJsonc(text, errors, {
        allowEmptyContent: true,
        allowTrailingComma: true,
        disallowComments: false,
      }) ?? {};
    let result = typeof parseResult === 'object' ? parseResult : undefined;
    if (errors.length) {
      console.error('Detected JSONC parser errors:');
      console.error('----- CONTENT START -----');
      console.error(text);
      console.error('----- CONTENT END -----');
      errors.forEach(({ error, offset }) =>
        console.error(` - ${printParseErrorCode(error)} at ${offset}`)
      );
    }
    if (errors.length) {
      result = undefined;
    }
    parentPort?.postMessage(result);
  });
}
