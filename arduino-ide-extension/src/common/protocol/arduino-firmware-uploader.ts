import type { PortIdentifier } from './boards-service';

// The properties do not follow IDE2's naming conventions. The names come from the stdout of the CLI.
export interface FirmwareInfo {
  readonly board_name: string;
  readonly board_fqbn: string;
  readonly module: string;
  readonly firmware_version: string;
  readonly Latest: boolean;
}

export interface UploadCertificateParams {
  readonly fqbn: string;
  readonly port: PortIdentifier;
  readonly urls: readonly string[];
}

export interface FlashFirmwareParams {
  readonly firmware: FirmwareInfo;
  readonly port: PortIdentifier;
}

export const ArduinoFirmwareUploaderPath =
  '/services/arduino-firmware-uploader';
export const ArduinoFirmwareUploader = Symbol('ArduinoFirmwareUploader');

export interface ArduinoFirmwareUploader {
  list(fqbn?: string): Promise<FirmwareInfo[]>;
  flash(params: FlashFirmwareParams): Promise<void>;
  uploadCertificates(params: UploadCertificateParams): Promise<void>;
  updatableBoards(): Promise<string[]>;
}
