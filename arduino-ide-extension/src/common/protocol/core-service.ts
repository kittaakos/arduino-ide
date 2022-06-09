import { Location } from '@theia/core/shared/vscode-languageserver-protocol';
import { ApplicationError } from '@theia/core';
import { BoardUserField } from '.';
import { Board, Port } from '../../common/protocol/boards-service';
import { Programmer } from './boards-service';
import { Sketch } from './sketches-service';

export const CompilerWarningLiterals = [
  'None',
  'Default',
  'More',
  'All',
] as const;
export type CompilerWarnings = typeof CompilerWarningLiterals[number];
export namespace CoreError {
  export interface Info {
    readonly message: string;
    readonly location?: Location;
  }
  export const Codes = {
    Verify: 4001,
    Upload: 4002,
    UploadUsingProgrammer: 4003,
    BurnBootloader: 4004,
  };
  export const VerifyFailed = create(Codes.Verify);
  export const UploadFailed = create(Codes.Upload);
  export const UploadUsingProgrammerFailed = create(
    Codes.UploadUsingProgrammer
  );
  export const BurnBootloaderFailed = create(Codes.BurnBootloader);
  export function is(error: unknown): error is ApplicationError<number, Info> {
    return (
      error instanceof Error &&
      ApplicationError.is(error) &&
      Object.values(Codes).includes(error.code)
    );
  }
  function create(code: number): ApplicationError.Constructor<number, Info> {
    return ApplicationError.declare(
      code,
      ({ message, stack }: Error, data: Info) => {
        return {
          data,
          message,
          stack,
        };
      }
    );
  }
}

export const CoreServicePath = '/services/core-service';
export const CoreService = Symbol('CoreService');
export interface CoreService {
  compile(
    options: CoreService.Compile.Options &
      Readonly<{
        exportBinaries?: boolean;
        compilerWarnings?: CompilerWarnings;
      }>
  ): Promise<void>;
  upload(options: CoreService.Upload.Options): Promise<void>;
  uploadUsingProgrammer(options: CoreService.Upload.Options): Promise<void>;
  burnBootloader(options: CoreService.Bootloader.Options): Promise<void>;
}

export namespace CoreService {
  export namespace Compile {
    export interface Options {
      /**
       * `file` URI to the sketch folder.
       */
      readonly sketch: Sketch;
      readonly board?: Board;
      readonly optimizeForDebug: boolean;
      readonly verbose: boolean;
      readonly sourceOverride: Record<string, string>;
    }
  }

  export namespace Upload {
    export interface Options extends Compile.Options {
      readonly port?: Port;
      readonly programmer?: Programmer | undefined;
      readonly verify: boolean;
      readonly userFields: BoardUserField[];
    }
  }

  export namespace Bootloader {
    export interface Options {
      readonly board?: Board;
      readonly port?: Port;
      readonly programmer?: Programmer | undefined;
      readonly verbose: boolean;
      readonly verify: boolean;
    }
  }
}
