import { Deferred } from '@theia/core/lib/common/promise-util';
// @ts-expect-error see https://github.com/microsoft/TypeScript/issues/49721#issuecomment-1319854183
import type { execa, Options } from 'execa';

const deferred = new Deferred<typeof execa>();
(async () => {
  const { execa } = await import('execa');
  deferred.resolve(execa);
})();

export const execFunc = () => deferred.promise;

export async function spawnCommand(
  file: string,
  args?: readonly string[],
  options?: Options
): Promise<string> {
  const execa = await deferred.promise;
  const { stdout } = await execa(file, args, options);
  return stdout;
}
