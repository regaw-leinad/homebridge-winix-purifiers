import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, UnknownContext } from 'homebridge';

export class WinixPurifierPlatform implements DynamicPlatformPlugin {
  public readonly Service = this.api.hap.Service;
  public readonly Characteristic = this.api.hap.Characteristic;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    log.debug('Finished initializing platform:', this.config.name);
  }

  configureAccessory(accessory: PlatformAccessory<UnknownContext>): void {

  }

  discoverDevices(): void {
  }
}