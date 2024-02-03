import { WinixDevice } from 'winix-api';
import { Logger } from 'homebridge';

export class DeviceLogger {

  private readonly logPrefix: string;

  constructor(private readonly log: Logger, device: WinixDevice) {
    this.logPrefix = `[${device.modelName}-${device.deviceAlias}] `;
  }

  info(message: string, ...parameters: unknown[]): void {
    this.log.info(this.logPrefix + message, ...parameters);
  }

  debug(message: string, ...parameters: unknown[]): void {
    this.log.debug(this.logPrefix + message, ...parameters);
  }

  warn(message: string, ...parameters: unknown[]): void {
    this.log.warn(this.logPrefix + message, ...parameters);
  }

  error(message: string, ...parameters: unknown[]): void {
    this.log.error(this.logPrefix + message, ...parameters);
  }
}