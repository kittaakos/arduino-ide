import { inject, injectable } from '@theia/core/shared/inversify';
import { Writable } from 'node:stream';
import {
  ArduinoFirmwareUploader,
  FirmwareInfo,
  FlashFirmwareParams,
  UploadCertificateParams,
} from '../common/protocol/arduino-firmware-uploader';
import {
  OutputMessage,
  ResponseService,
} from '../common/protocol/response-service';
import { execFunc, spawnCommand } from './exec-util';
import { MonitorManager } from './monitor-manager';
import { arduinoFirmwareUploaderPath } from './resources';

@injectable()
export class ArduinoFirmwareUploaderImpl implements ArduinoFirmwareUploader {
  @inject(ResponseService)
  private readonly responseService: ResponseService;
  @inject(MonitorManager)
  private readonly monitorManager: MonitorManager;

  async uploadCertificates(params: UploadCertificateParams): Promise<void> {
    const { fqbn, port, urls } = params;
    const args = [
      'certificates',
      'flash',
      '-b',
      fqbn,
      '-a',
      port.address,
      ...urls.flatMap((url) => ['-u', url]),
    ];
    await this.exec(args);
  }

  async list(fqbn?: string): Promise<FirmwareInfo[]> {
    const fqbnFlag = fqbn ? ['--fqbn', fqbn] : [];
    const stdout = await spawnCommand(arduinoFirmwareUploaderPath, [
      'firmware',
      'list',
      ...fqbnFlag,
      '--format',
      'json',
    ]);
    const firmwares = JSON.parse(stdout);
    return firmwares.reverse();
  }

  async updatableBoards(): Promise<string[]> {
    return (await this.list()).reduce(
      (a, b) => (a.includes(b.board_fqbn) ? a : [...a, b.board_fqbn]),
      [] as string[]
    );
  }

  async flash(params: FlashFirmwareParams): Promise<void> {
    const { firmware, port } = params;
    const fqbn = firmware.board_fqbn;
    const args = [
      'firmware',
      'flash',
      '--fqbn',
      firmware.board_fqbn,
      '--address',
      port.address,
      '--module',
      `${firmware.module}@${firmware.firmware_version}`,
    ];
    try {
      await this.monitorManager.notifyUploadStarted(fqbn, port);
      await this.exec(args);
    } finally {
      await this.monitorManager.notifyUploadFinished(fqbn, port, port); // here the before and after ports are assumed to be always the same
    }
  }

  private async exec(args: string[]): Promise<string> {
    const exec = await execFunc();
    this.responseService.appendToOutput({
      chunk: [arduinoFirmwareUploaderPath, ...args].join(' ') + '\n',
    });
    const result = exec(arduinoFirmwareUploaderPath, args);
    const { stdout, stderr } = this.createWritableWrappers();
    result.pipeStdout?.(stdout);
    result.pipeStderr?.(stderr);
    const { stdout: output } = await result;
    return output;
  }

  private createWritableWrappers(): Readonly<{
    stdout: Writable;
    stderr: Writable;
  }> {
    const options: ResponseServiceWritableOptions = {
      responseService: this.responseService,
      severity: OutputMessage.Severity.Info,
    };
    return {
      stdout: new ResponseServiceWritable(options),
      stderr: new ResponseServiceWritable({
        ...options,
        severity: OutputMessage.Severity.Error,
      }),
    };
  }
}

interface ResponseServiceWritableOptions {
  readonly responseService: ResponseService;
  readonly severity: OutputMessage.Severity;
}

class ResponseServiceWritable extends Writable {
  constructor(private readonly options: ResponseServiceWritableOptions) {
    super();
  }

  override _write(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: any,
    _: BufferEncoding,
    callback: (error?: Error | null | undefined) => void
  ): void {
    const message = chunk.toString();
    this.options.responseService.appendToOutput({
      chunk: message,
      severity: this.options.severity,
    });
    callback();
  }
}
