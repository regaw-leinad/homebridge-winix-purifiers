import { API, APIEvent, Categories, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, UnknownContext } from 'homebridge';
import { WinixPurifierAccessory } from './accessory';
import { WinixPlatformConfig } from './config';
import { WinixAccount, WinixDevice } from 'winix-api';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export interface DeviceContext extends UnknownContext {
  device: WinixDevice;
}

export class WinixPurifierPlatform implements DynamicPlatformPlugin {
  public readonly Service = this.api.hap.Service;
  public readonly Characteristic = this.api.hap.Characteristic;
  public readonly HapStatusError = this.api.hap.HapStatusError;

  private readonly config: WinixPlatformConfig;
  private winix?: WinixAccount;
  private accessories: Map<string, PlatformAccessory<DeviceContext>>;
  private handlers: Set<WinixPurifierAccessory>;

  constructor(
    private readonly log: Logger,
    readonly platformConfig: PlatformConfig,
    private readonly api: API,
  ) {
    this.config = platformConfig as WinixPlatformConfig;
    this.accessories = new Map<string, PlatformAccessory<DeviceContext>>();
    this.handlers = new Set<WinixPurifierAccessory>();
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.onFinishLaunching.bind(this));
  }

  async onFinishLaunching(): Promise<void> {
    if (!this.config.auth?.refreshToken) {
      this.log.warn('Winix Purifiers is NOT set up. ' +
        'Please log in with your Winix account credentials in the Homebridge UI.');
      return;
    }

    this.log.debug('Refresh token found, discovering devices...');
    try {
      this.winix = await WinixAccount.fromExistingAuth(this.config.auth);
    } catch (e: unknown) {
      this.log.error('error generating winix account from existing auth:', e);
      return;
    }

    await this.discoverDevices();
  }

  async discoverDevices(): Promise<void> {
    this.log.info('Discovering devices...');
    const devices = await this.winix?.getDevices();

    // if devices is explicitly typeof undefined, then the user has not logged in yet
    if (typeof devices === 'undefined') {
      this.log.warn('Winix Purifiers is NOT set up. ' +
        'Please log in with your Winix account credentials in the Homebridge UI.');
      return;
    }

    const accessoriesToAdd: PlatformAccessory<DeviceContext>[] = [];

    for (const device of devices) {
      this.log.debug('Discovered device - model:', device.modelName, 'id:', device.deviceId);
      const uuid = this.api.hap.uuid.generate(device.deviceId);
      let accessory = this.accessories.get(uuid);

      if (accessory) {
        this.log.debug('Restoring existing accessory from cache:', device.modelName, device.deviceAlias);
        accessory.context.device = device;
        this.api.updatePlatformAccessories([accessory]);
        this.handlers.add(new WinixPurifierAccessory(this.log, this, this.config, accessory));
      } else {
        // new accessory
        this.log.debug('Adding new accessory:', device.modelName, device.deviceAlias);
        accessory = new this.api.platformAccessory(device.deviceAlias, uuid, Categories.AIR_PURIFIER);
        accessory.context.device = device;
        this.handlers.add(new WinixPurifierAccessory(this.log, this, this.config, accessory));
        accessoriesToAdd.push(accessory);
      }
    }

    if (accessoriesToAdd.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToAdd);
    }

    // TODO: cleanup old accessories which aren't in the discovered devices anymore
  }

  configureAccessory(accessory: PlatformAccessory<DeviceContext>): void {
    this.log.debug('configureAccessory(): Loading accessory from cache:', accessory.context.device.deviceId);
    this.accessories.set(accessory.UUID, accessory);
  }
}