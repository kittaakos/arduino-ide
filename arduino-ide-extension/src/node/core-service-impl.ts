import { FileUri } from '@theia/core/lib/node/file-uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { relative } from 'path';
import * as jspb from 'google-protobuf';
import { BoolValue } from 'google-protobuf/google/protobuf/wrappers_pb';
import { ClientReadableStream } from '@grpc/grpc-js';
import {
  CompilerWarnings,
  CoreService,
  CoreError,
} from '../common/protocol/core-service';
import { CompileRequest } from './cli-protocol/cc/arduino/cli/commands/v1/compile_pb';
import { CoreClientAware } from './core-client-provider';
import {
  BurnBootloaderRequest,
  UploadRequest,
  UploadResponse,
  UploadUsingProgrammerRequest,
  UploadUsingProgrammerResponse,
} from './cli-protocol/cc/arduino/cli/commands/v1/upload_pb';
import { ResponseService } from '../common/protocol/response-service';
import { Board, OutputMessage, Port } from '../common/protocol';
import { ArduinoCoreServiceClient } from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';
import { Port as GrpcPort } from './cli-protocol/cc/arduino/cli/commands/v1/port_pb';
import { ApplicationError, Disposable, nls } from '@theia/core';
import { MonitorManager } from './monitor-manager';
import { SimpleBuffer } from './utils/simple-buffer';
import { tryParseError } from './cli-error-parser';
import { Instance } from './cli-protocol/cc/arduino/cli/commands/v1/common_pb';
import { firstToUpperCase, notEmpty } from '../common/utils';

@injectable()
export class CoreServiceImpl extends CoreClientAware implements CoreService {
  @inject(ResponseService)
  private readonly responseService: ResponseService;

  @inject(MonitorManager)
  private readonly monitorManager: MonitorManager;

  async compile(
    options: CoreService.Compile.Options & {
      exportBinaries?: boolean;
      compilerWarnings?: CompilerWarnings;
    }
  ): Promise<void> {
    const coreClient = await this.coreClient();
    const { client, instance } = coreClient;
    const { stderr, onDataHandler, dispose } = this.createOnDataHandler();
    const request = this.compileRequest(options, instance);
    return new Promise<void>((resolve, reject) => {
      client
        .compile(request)
        .on('data', onDataHandler)
        .on('error', (error) => {
          dispose();
          const errors = tryParseError({
            content: stderr,
            sketch: options.sketch,
          });
          const message = nls.localize(
            'arduino/compile/error',
            'Compilation error: {0}',
            errors
              .map(({ message }) => message)
              .filter(notEmpty)
              .shift() ?? detailsOf(error)
          );
          this.responseService.appendToOutput({
            chunk: (detailsOf(error) ?? error.message) + '\n\n' + message,
            severity: OutputMessage.Severity.Error,
          });
          reject(CoreError.VerifyFailed(message, errors));
        })
        .on('end', () => {
          dispose();
          resolve();
        });
    });
  }

  private compileRequest(
    options: CoreService.Compile.Options & {
      exportBinaries?: boolean;
      compilerWarnings?: CompilerWarnings;
    },
    instance: Instance
  ): CompileRequest {
    const { sketch, board, compilerWarnings } = options;
    const sketchUri = sketch.uri;
    const sketchPath = FileUri.fsPath(sketchUri);
    const request = new CompileRequest();
    request.setInstance(instance);
    request.setSketchPath(sketchPath);
    if (board?.fqbn) {
      request.setFqbn(board.fqbn);
    }
    if (compilerWarnings) {
      request.setWarnings(compilerWarnings.toLowerCase());
    }
    request.setOptimizeForDebug(options.optimizeForDebug);
    request.setPreprocess(false);
    request.setVerbose(options.verbose);
    request.setQuiet(false);
    if (typeof options.exportBinaries === 'boolean') {
      const exportBinaries = new BoolValue();
      exportBinaries.setValue(options.exportBinaries);
      request.setExportBinaries(exportBinaries);
    }
    this.mergeSourceOverrides(request, options);
    return request;
  }

  async upload(options: CoreService.Upload.Options): Promise<void> {
    return this.doUpload(
      options,
      () => new UploadRequest(),
      (client, req) => client.upload(req),
      (message: string, info: CoreError.ErrorInfo[]) =>
        CoreError.UploadFailed(message, info),
      'upload'
    );
  }

  async uploadUsingProgrammer(
    options: CoreService.Upload.Options
  ): Promise<void> {
    return this.doUpload(
      options,
      () => new UploadUsingProgrammerRequest(),
      (client, req) => client.uploadUsingProgrammer(req),
      (message: string, info: CoreError.ErrorInfo[]) =>
        CoreError.UploadUsingProgrammerFailed(message, info),
      'upload using programmer'
    );
  }

  protected async doUpload(
    options: CoreService.Upload.Options,
    requestFactory: () => UploadRequest | UploadUsingProgrammerRequest,
    responseHandler: (
      client: ArduinoCoreServiceClient,
      request: UploadRequest | UploadUsingProgrammerRequest
    ) => ClientReadableStream<UploadResponse | UploadUsingProgrammerResponse>,
    errorHandler: (
      message: string,
      info: CoreError.ErrorInfo[]
    ) => ApplicationError<number, CoreError.ErrorInfo[]>,
    task: string
  ): Promise<void> {
    await this.compile(Object.assign(options, { exportBinaries: false }));

    const coreClient = await this.coreClient();
    const { client, instance } = coreClient;
    const request = this.uploadOrUploadUsingProgrammerRequest(
      options,
      instance,
      requestFactory
    );
    const { stderr, onDataHandler, dispose } = this.createOnDataHandler();
    return this.notifyUploadWillStart(options).then(() =>
      new Promise<void>((resolve, reject) => {
        responseHandler(client, request)
          .on('data', onDataHandler)
          .on('error', (error) => {
            dispose();
            reject(
              errorHandler(
                nls.localize(
                  'arduino/upload/error',
                  '{0} error: {1}',
                  firstToUpperCase(task),
                  detailsOf(error)
                ),
                tryParseError({ content: stderr, sketch: options.sketch })
              )
            );
          })
          .on('end', () => {
            dispose();
            resolve();
          });
      }).finally(async () => await this.notifyUploadDidFinish(options))
    );
  }

  private uploadOrUploadUsingProgrammerRequest(
    options: CoreService.Upload.Options,
    instance: Instance,
    requestFactory: () => UploadRequest | UploadUsingProgrammerRequest
  ): UploadRequest | UploadUsingProgrammerRequest {
    const { sketch, board, port, programmer } = options;
    const sketchPath = FileUri.fsPath(sketch.uri);
    const request = requestFactory();
    request.setInstance(instance);
    request.setSketchPath(sketchPath);
    if (board?.fqbn) {
      request.setFqbn(board.fqbn);
    }
    request.setPort(this.createPort(port));
    if (programmer) {
      request.setProgrammer(programmer.id);
    }
    request.setVerbose(options.verbose);
    request.setVerify(options.verify);

    options.userFields.forEach((e) => {
      request.getUserFieldsMap().set(e.name, e.value);
    });
    return request;
  }

  async burnBootloader(options: CoreService.Bootloader.Options): Promise<void> {
    const coreClient = await this.coreClient();
    const { client, instance } = coreClient;
    const { stderr, onDataHandler, dispose } = this.createOnDataHandler();
    const request = this.burnBootloaderRequest(options, instance);
    return this.notifyUploadWillStart(options).then(() =>
      new Promise<void>((resolve, reject) => {
        client
          .burnBootloader(request)
          .on('data', onDataHandler)
          .on('error', (error) => {
            dispose();
            reject(
              CoreError.BurnBootloaderFailed(
                nls.localize(
                  'arduino/burnBootloader/error',
                  'Error while burning the bootloader: {0}',
                  detailsOf(error)
                ),
                tryParseError({ content: stderr })
              )
            );
          })
          .on('end', () => {
            dispose();
            resolve();
          });
      }).finally(async () => await this.notifyUploadDidFinish(options))
    );
  }

  private burnBootloaderRequest(
    options: CoreService.Bootloader.Options,
    instance: Instance
  ): BurnBootloaderRequest {
    const { board, port, programmer } = options;
    const request = new BurnBootloaderRequest();
    request.setInstance(instance);
    if (board?.fqbn) {
      request.setFqbn(board.fqbn);
    }
    request.setPort(this.createPort(port));
    if (programmer) {
      request.setProgrammer(programmer.id);
    }
    request.setVerify(options.verify);
    request.setVerbose(options.verbose);
    return request;
  }

  private createOnDataHandler<R extends StreamingResponse>(): Disposable & {
    stderr: Buffer[];
    onDataHandler: (response: R) => void;
  } {
    const stderr: Buffer[] = [];
    const buffer = new SimpleBuffer((chunks) => {
      Array.from(chunks.entries()).forEach(([severity, chunk]) => {
        if (chunk) {
          this.responseService.appendToOutput({ chunk, severity });
        }
      });
    });
    const onDataHandler = StreamingResponse.createOnDataHandler(
      stderr,
      (out, err) => {
        buffer.addChunk(out);
        buffer.addChunk(err, OutputMessage.Severity.Error);
      }
    );
    return {
      dispose: () => buffer.dispose(),
      stderr,
      onDataHandler,
    };
  }

  private async notifyUploadWillStart({
    board,
    port,
  }: {
    board?: Board | undefined;
    port?: Port | undefined;
  }): Promise<void> {
    this.monitorManager.notifyUploadStarted(board, port);
  }

  private async notifyUploadDidFinish({
    board,
    port,
  }: {
    board?: Board | undefined;
    port?: Port | undefined;
  }): Promise<void> {
    this.monitorManager.notifyUploadFinished(board, port);
  }

  private mergeSourceOverrides(
    req: { getSourceOverrideMap(): jspb.Map<string, string> },
    options: CoreService.Compile.Options
  ): void {
    const sketchPath = FileUri.fsPath(options.sketch.uri);
    for (const uri of Object.keys(options.sourceOverride)) {
      const content = options.sourceOverride[uri];
      if (content) {
        const relativePath = relative(sketchPath, FileUri.fsPath(uri));
        req.getSourceOverrideMap().set(relativePath, content);
      }
    }
  }

  private createPort(port: Port | undefined): GrpcPort {
    const grpcPort = new GrpcPort();
    if (port) {
      grpcPort.setAddress(port.address);
      grpcPort.setLabel(port.addressLabel);
      grpcPort.setProtocol(port.protocol);
      grpcPort.setProtocolLabel(port.protocolLabel);
    }
    return grpcPort;
  }
}
/**
 * Artificial common interface for all gRPC streaming requests.
 * Such as `UploadResponse,` `UploadUsingProgrammerResponse`, `BurnBootloaderResponse`, and the `CompileResponse`.
 */
interface StreamingResponse {
  getOutStream_asU8(): Uint8Array;
  getErrStream_asU8(): Uint8Array;
}
namespace StreamingResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createOnDataHandler<R extends StreamingResponse>(
    stderr: Uint8Array[],
    onData: (out: Uint8Array, err: Uint8Array) => void
  ): (response: R) => void {
    return (response: R) => {
      const out = response.getOutStream_asU8();
      const err = response.getErrStream_asU8();
      stderr.push(err);
      onData(out, err);
    };
  }
}

function detailsOf(error: Error): string | undefined {
  if ('details' in error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (error as any).details;
  }
  return undefined;
}
