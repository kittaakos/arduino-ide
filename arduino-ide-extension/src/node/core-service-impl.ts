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
import { NotificationServiceServer, OutputMessage } from '../common/protocol';
import { ArduinoCoreServiceClient } from './cli-protocol/cc/arduino/cli/commands/v1/commands_grpc_pb';
import { Port } from './cli-protocol/cc/arduino/cli/commands/v1/port_pb';
import { ApplicationError, Disposable } from '@theia/core';
import { MonitorManager } from './monitor-manager';
import { SimpleBuffer } from './utils/simple-buffer';
import { tryParseError } from './cli-error-parser';

@injectable()
export class CoreServiceImpl extends CoreClientAware implements CoreService {
  @inject(ResponseService)
  protected readonly responseService: ResponseService;

  @inject(NotificationServiceServer)
  protected readonly notificationService: NotificationServiceServer;

  @inject(MonitorManager)
  protected readonly monitorManager: MonitorManager;

  async compile(
    options: CoreService.Compile.Options & {
      exportBinaries?: boolean;
      compilerWarnings?: CompilerWarnings;
    }
  ): Promise<void> {
    const coreClient = await this.coreClient();
    const { client, instance } = coreClient;

    const { sketch, board, compilerWarnings } = options;
    const sketchUri = sketch.uri;
    const sketchPath = FileUri.fsPath(sketchUri);
    const compileReq = new CompileRequest();
    compileReq.setInstance(instance);
    compileReq.setSketchPath(sketchPath);
    if (board?.fqbn) {
      compileReq.setFqbn(board.fqbn);
    }
    if (compilerWarnings) {
      compileReq.setWarnings(compilerWarnings.toLowerCase());
    }
    compileReq.setOptimizeForDebug(options.optimizeForDebug);
    compileReq.setPreprocess(false);
    compileReq.setVerbose(options.verbose);
    compileReq.setQuiet(false);
    if (typeof options.exportBinaries === 'boolean') {
      const exportBinaries = new BoolValue();
      exportBinaries.setValue(options.exportBinaries);
      compileReq.setExportBinaries(exportBinaries);
    }
    this.mergeSourceOverrides(compileReq, options);

    const { stderr, onDataHandler } = this.createOnDataHandler();
    const response = client.compile(compileReq);
    return new Promise<void>((resolve, reject) => {
      response.on('data', onDataHandler);
      response.on('error', (error) =>
        reject(
          CoreError.VerifyFailed(
            error,
            tryParseError({ content: stderr, sketch })
          )
        )
      );
      response.on('end', () => resolve());
    });
  }

  async upload(options: CoreService.Upload.Options): Promise<void> {
    return this.doUpload(
      options,
      () => new UploadRequest(),
      (client, req) => client.upload(req),
      (error: Error, info: CoreError.Info[]) =>
        CoreError.UploadFailed(error, info)
    );
  }

  async uploadUsingProgrammer(
    options: CoreService.Upload.Options
  ): Promise<void> {
    return this.doUpload(
      options,
      () => new UploadUsingProgrammerRequest(),
      (client, req) => client.uploadUsingProgrammer(req),
      (error: Error, info: CoreError.Info[]) =>
        CoreError.UploadUsingProgrammerFailed(error, info)
    );
  }

  protected async doUpload(
    options: CoreService.Upload.Options,
    requestProvider: () => UploadRequest | UploadUsingProgrammerRequest,
    responseHandler: (
      client: ArduinoCoreServiceClient,
      req: UploadRequest | UploadUsingProgrammerRequest
    ) => ClientReadableStream<UploadResponse | UploadUsingProgrammerResponse>,
    errorHandler: (
      error: Error,
      info: CoreError.Info[]
    ) => ApplicationError<number, CoreError.Info[]>
  ): Promise<void> {
    await this.compile(Object.assign(options, { exportBinaries: false }));

    const coreClient = await this.coreClient();
    const { client, instance } = coreClient;
    const { sketch, board, port, programmer } = options;
    const sketchPath = FileUri.fsPath(sketch.uri);

    await this.monitorManager.notifyUploadStarted(board, port);

    const req = requestProvider();
    req.setInstance(instance);
    req.setSketchPath(sketchPath);
    if (board?.fqbn) {
      req.setFqbn(board.fqbn);
    }
    const p = new Port();
    if (port) {
      p.setAddress(port.address);
      p.setLabel(port.addressLabel);
      p.setProtocol(port.protocol);
      p.setProtocolLabel(port.protocolLabel);
    }
    req.setPort(p);
    if (programmer) {
      req.setProgrammer(programmer.id);
    }
    req.setVerbose(options.verbose);
    req.setVerify(options.verify);

    options.userFields.forEach((e) => {
      req.getUserFieldsMap().set(e.name, e.value);
    });

    const response = responseHandler(client, req);
    const { stderr, onDataHandler, dispose } = this.createOnDataHandler();
    return new Promise<void>((resolve, reject) => {
      response.on('data', onDataHandler);
      response.on('error', (error) =>
        reject(errorHandler(error, tryParseError({ content: stderr, sketch })))
      );
      response.on('end', () => resolve());
    });
  }

  async burnBootloader(options: CoreService.Bootloader.Options): Promise<void> {
    const { board, port, programmer } = options;
    await this.monitorManager.notifyUploadStarted(board, port);

    await this.coreClientProvider.initialized;
    const coreClient = await this.coreClient();
    const { client, instance } = coreClient;
    const burnReq = new BurnBootloaderRequest();
    burnReq.setInstance(instance);
    if (board?.fqbn) {
      burnReq.setFqbn(board.fqbn);
    }
    const p = new Port();
    if (port) {
      p.setAddress(port.address);
      p.setLabel(port.addressLabel);
      p.setProtocol(port.protocol);
      p.setProtocolLabel(port.protocolLabel);
    }
    burnReq.setPort(p);
    if (programmer) {
      burnReq.setProgrammer(programmer.id);
    }
    burnReq.setVerify(options.verify);
    burnReq.setVerbose(options.verbose);
    const result = client.burnBootloader(burnReq);
    const { stderr, onDataHandler, dispose } = this.createOnDataHandler();
    return new Promise<void>((resolve, reject) => {
      result.on('data', onDataHandler);
      result.on('error', (error) =>
        reject(
          CoreError.BurnBootloaderFailed(
            error,
            tryParseError({ content: stderr })
          )
        )
      );
      result.on('end', resolve);
    }).finally(async () => {
      dispose();
      await this.monitorManager.notifyUploadFinished(board, port);
    });
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
