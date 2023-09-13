import type { Port } from './boards-service';

export const ArduinoFirmwareUploaderPath =
  '/services/arduino-firmware-uploader';
export const ArduinoFirmwareUploader = Symbol('ArduinoFirmwareUploader');
export interface FirmwareInfo {
  readonly board_name: string;
  readonly board_fqbn: string;
  readonly module: string;
  readonly firmware_version: string;
  readonly Latest: boolean;
}
export interface UploadCertificateParams {
  readonly fqbn: string;
  readonly address: string;
  readonly urls: readonly string[];
}
export interface ArduinoFirmwareUploader {
  listFirmwares(fqbn?: string): Promise<FirmwareInfo[]>;
  flash(firmware: FirmwareInfo, port: Port): Promise<string>;
  uploadCertificates(params: UploadCertificateParams): Promise<unknown>;
  updatableBoards(): Promise<string[]>;
}
