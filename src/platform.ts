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
  private handlers: Map<string, WinixPurifierAccessory>;

  constructor(
    private readonly log: Logger,
    readonly platformConfig: PlatformConfig,
    private readonly api: API,
  ) {
    this.config = platformConfig as WinixPlatformConfig;
    this.accessories = new Map<string, PlatformAccessory<DeviceContext>>();
    this.handlers = new Map<string, WinixPurifierAccessory>();
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.onFinishLaunching.bind(this));
  }

  configureAccessory(accessory: PlatformAccessory<DeviceContext>): void {
    this.log.debug(
      'Loading cached device:',
      accessory.context.device.modelName,
      accessory.context.device.deviceAlias,
    );
    this.accessories.set(accessory.UUID, accessory);
  }

  async onFinishLaunching(): Promise<void> {
    if (!this.config.auth?.refreshToken) {
      this.log.warn('Winix Purifiers is NOT set up. ' +
        'Please link your Winix account in the Homebridge UI.');
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

    // refresh devices on the configured interval
    const refreshIntervalSeconds = this.config.deviceRefreshIntervalSeconds ?? 300;
    setInterval(async () => await this.discoverDevices(), refreshIntervalSeconds * 1000);
  }

  async discoverDevices(): Promise<void> {
    this.log.debug('Discovering devices...');
    const devices = await this.winix?.getDevices();

    // if devices is explicitly typeof undefined, then the user has not logged in yet
    if (typeof devices === 'undefined') {
      this.log.warn('Winix Purifiers is NOT set up. ' +
        'Please log in with your Winix account credentials in the Homebridge UI.');
      return;
    }

    const accessoriesToAdd: PlatformAccessory<DeviceContext>[] = [];
    const seenUUIDs = new Set<string>();

    for (const device of devices) {
      this.log.debug('Discovered device:', device.modelName, device.deviceAlias);

      const uuid = this.api.hap.uuid.generate(device.deviceId);
      let accessory = this.accessories.get(uuid);

      if (accessory) {
        this.log.debug('Restoring existing accessory from cache:', device.modelName, device.deviceAlias);
        accessory.context.device = device;
        this.api.updatePlatformAccessories([accessory]);
        this.handlers.set(uuid, new WinixPurifierAccessory(this.log, this, this.config, accessory));
      } else {
        // new accessory
        this.log.debug('Adding new accessory:', device.modelName, device.deviceAlias);
        accessory = new this.api.platformAccessory(device.deviceAlias, uuid, Categories.AIR_PURIFIER);
        accessory.context.device = device;
        this.handlers.set(uuid, new WinixPurifierAccessory(this.log, this, this.config, accessory));
        accessoriesToAdd.push(accessory);
      }

      seenUUIDs.add(accessory.UUID);
    }

    if (accessoriesToAdd.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToAdd);
    }

    this.removeOldDevices(seenUUIDs);
  }

  private removeOldDevices(seenUUIDs: Set<string>) {
    // remove any accessories that are no longer present after discovery
    this.accessories.forEach((accessory) => {
      // if we've seen this accessory in discovered devices, don't remove it
      if (seenUUIDs.has(accessory.UUID)) {
        return;
      }

      this.log.debug(
        'Removing old accessory:',
        accessory.context.device.modelName,
        accessory.context.device.deviceAlias,
      );

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.delete(accessory.UUID);
      this.handlers.delete(accessory.UUID);
    });
  }
}