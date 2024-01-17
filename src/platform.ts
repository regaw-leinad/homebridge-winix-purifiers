import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, UnknownContext } from 'homebridge';
import { WinixPlatformConfig } from './config';

export class WinixPurifierPlatform implements DynamicPlatformPlugin {
  public readonly Service = this.api.hap.Service;
  public readonly Characteristic = this.api.hap.Characteristic;
  private readonly config: WinixPlatformConfig;

  constructor(
    public readonly log: Logger,
    public readonly platformConfig: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = platformConfig as WinixPlatformConfig;
    log.debug('config:', JSON.stringify(this.config));
  }

  configureAccessory(accessory: PlatformAccessory<UnknownContext>): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    return;
  }

  discoverDevices(): void {
    return;
  }
}