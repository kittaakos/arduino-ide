import { v4 } from 'uuid';
import {
  ProgressMessage,
  ResponseService,
} from '../common/protocol/response-service';
import {
  UpdateCoreLibrariesIndexResponse,
  UpdateIndexResponse,
  UpdateLibrariesIndexResponse,
} from './cli-protocol/cc/arduino/cli/commands/v1/commands_pb';
import {
  DownloadProgress,
  TaskProgress,
} from './cli-protocol/cc/arduino/cli/commands/v1/common_pb';
import {
  PlatformInstallResponse,
  PlatformUninstallResponse,
} from './cli-protocol/cc/arduino/cli/commands/v1/core_pb';
import {
  LibraryInstallResponse,
  LibraryUninstallResponse,
  ZipLibraryInstallResponse,
} from './cli-protocol/cc/arduino/cli/commands/v1/lib_pb';

type LibraryProgressResponse =
  | LibraryInstallResponse
  | LibraryUninstallResponse
  | ZipLibraryInstallResponse;
namespace LibraryProgressResponse {
  export function is(
    response: ProgressResponse
  ): response is LibraryProgressResponse {
    return (
      response instanceof LibraryInstallResponse ||
      response instanceof LibraryUninstallResponse ||
      response instanceof ZipLibraryInstallResponse
    );
  }
}
type PlatformProgressResponse =
  | PlatformInstallResponse
  | PlatformUninstallResponse;
namespace PlatformProgressResponse {
  export function is(
    response: ProgressResponse
  ): response is PlatformProgressResponse {
    return (
      response instanceof PlatformInstallResponse ||
      response instanceof PlatformUninstallResponse
    );
  }
}
type IndexProgressResponse =
  | UpdateIndexResponse
  | UpdateLibrariesIndexResponse
  | UpdateCoreLibrariesIndexResponse;
namespace IndexProgressResponse {
  export function is(
    response: ProgressResponse
  ): response is IndexProgressResponse {
    return (
      response instanceof UpdateIndexResponse ||
      response instanceof UpdateLibrariesIndexResponse ||
      response instanceof UpdateCoreLibrariesIndexResponse // not used by the IDE2 but available for full typings compatibility
    );
  }
}
export type ProgressResponse =
  | LibraryProgressResponse
  | PlatformProgressResponse
  | IndexProgressResponse;

const DEBUG = false;
export namespace InstallWithProgress {
  export interface Options {
    /**
     * _unknown_ progress if falsy.
     */
    readonly progressId?: string;
    readonly responseService: Partial<ResponseService>;
  }

  export function createDataCallback<R extends ProgressResponse>({
    responseService,
    progressId,
  }: InstallWithProgress.Options): (response: R) => void {
    const uuid = v4();
    let localFile = '';
    let localTotalSize = Number.NaN;
    return (response: R) => {
      if (DEBUG) {
        const json = toJson(response);
        if (json) {
          console.log(`Progress response [${uuid}]: ${json}`);
        }
      }
      const { task, download } = resolve(response);
      if (!download && !task) {
        console.warn(
          "Implementation error. Neither 'download' nor 'task' is available."
        );
        // This is still an API error from the CLI, but IDE2 ignores it.
        // Technically, it does not cause an error, but could mess up the progress reporting.
        // See and example of an empty object `{}` repose here: https://github.com/arduino/arduino-ide/issues/906#issuecomment-1171145630.
        return;
      }
      if (task && download) {
        throw new Error(
          "Implementation error. Both 'download' and 'task' are available."
        );
      }
      if (task) {
        const message = task.getName() || task.getMessage();
        if (message) {
          if (progressId) {
            responseService.reportProgress?.({
              progressId,
              message,
              work: { done: Number.NaN, total: Number.NaN },
            });
          }
          responseService.appendToOutput?.({ chunk: `${message}\n` });
        }
      } else if (download) {
        if (download.getFile() && !localFile) {
          localFile = download.getFile();
        }
        if (download.getTotalSize() > 0 && Number.isNaN(localTotalSize)) {
          localTotalSize = download.getTotalSize();
        }

        // This happens only once per file download.
        if (download.getTotalSize() && localFile) {
          responseService.appendToOutput?.({ chunk: `${localFile}\n` });
        }

        if (progressId && localFile) {
          let work: ProgressMessage.Work | undefined = undefined;
          if (download.getDownloaded() > 0 && !Number.isNaN(localTotalSize)) {
            work = {
              total: localTotalSize,
              done: download.getDownloaded(),
            };
          }
          responseService.reportProgress?.({
            progressId,
            message: `Downloading ${localFile}`,
            work,
          });
        }
        if (download.getCompleted()) {
          // Discard local state.
          if (progressId && !Number.isNaN(localTotalSize)) {
            responseService.reportProgress?.({
              progressId,
              message: '',
              work: { done: Number.NaN, total: Number.NaN },
            });
          }
          localFile = '';
          localTotalSize = Number.NaN;
        }
      }
    };
  }
  function resolve(
    response: ProgressResponse
  ): Readonly<Partial<{ task: TaskProgress; download: DownloadProgress }>> {
    if (LibraryProgressResponse.is(response)) {
      return {
        task: response.getTaskProgress(),
      };
    } else if (PlatformProgressResponse.is(response)) {
      return {
        task: response.getTaskProgress(),
        download: response.getDownloadProgress(),
      };
    } else if (IndexProgressResponse.is(response)) {
      return {
        download: response.getDownloadProgress(),
      };
    }
    console.warn('Unhandled gRPC response', response);
    return {};
  }
  function toJson(response: ProgressResponse): string | undefined {
    if (response instanceof LibraryInstallResponse) {
      return JSON.stringify(LibraryInstallResponse.toObject(false, response));
    } else if (response instanceof LibraryUninstallResponse) {
      return JSON.stringify(LibraryUninstallResponse.toObject(false, response));
    } else if (response instanceof ZipLibraryInstallResponse) {
      return JSON.stringify(
        ZipLibraryInstallResponse.toObject(false, response)
      );
    } else if (response instanceof PlatformInstallResponse) {
      return JSON.stringify(PlatformInstallResponse.toObject(false, response));
    } else if (response instanceof PlatformUninstallResponse) {
      return JSON.stringify(
        PlatformUninstallResponse.toObject(false, response)
      );
    } else if (response instanceof UpdateIndexResponse) {
      return JSON.stringify(UpdateIndexResponse.toObject(false, response));
    } else if (response instanceof UpdateLibrariesIndexResponse) {
      return JSON.stringify(
        UpdateLibrariesIndexResponse.toObject(false, response)
      );
    } else if (response instanceof UpdateCoreLibrariesIndexResponse) {
      return JSON.stringify(
        UpdateCoreLibrariesIndexResponse.toObject(false, response)
      );
    }
    console.warn('Unhandled gRPC response', response);
    return undefined;
  }
}
