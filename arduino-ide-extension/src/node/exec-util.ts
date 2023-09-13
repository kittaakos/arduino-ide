// @ts-expect-error see https://github.com/microsoft/TypeScript/issues/49721#issuecomment-1319854183
import type { ExecaChildPromise, ExecaReturnValue, Options } from 'execa';
import type { ChildProcess } from 'node:child_process';

export type ExecResult = ChildProcess &
  ExecaChildPromise<string> &
  Promise<ExecaReturnValue<string>>;

export async function exec(
  file: string,
  args?: readonly string[],
  options?: Options
): Promise<ExecResult> {
  const { execa } = await import('execa');
  return execa(file, args, options);
}

export async function spawnCommand(
  file: string,
  args?: readonly string[],
  options?: Options
): Promise<string> {
  const { stdout } = await exec(file, args, options);
  return stdout;
}
