import {
  AccessoryEventTypes,
  API,
  APIEvent,
  Categories,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  UnknownContext,
} from 'homebridge';
import { DeviceOverride, WinixPlatformConfig } from './config';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { WinixAccount, WinixDevice } from 'winix-api';
import { WinixPurifierAccessory } from './accessory';
import { assertError } from './errors';

const DEFAULT_DEVICE_REFRESH_INTERVAL_MINUTES = 60;

export interface DeviceContext extends UnknownContext {
  device: WinixDevice;
}

export class WinixPurifierPlatform implements DynamicPlatformPlugin {
  public readonly Service = this.api.hap.Service;
  public readonly Characteristic = this.api.hap.Characteristic;
  public readonly HapStatusError = this.api.hap.HapStatusError;

  private readonly config: WinixPlatformConfig;
  private readonly accessories: Map<string, PlatformAccessory<DeviceContext>>;
  private readonly handlers: Map<string, WinixPurifierAccessory>;
  private readonly deviceOverrides: Map<string, DeviceOverride>;
  private winix?: WinixAccount;

  constructor(
    private readonly log: Logger,
    readonly platformConfig: PlatformConfig,
    private readonly api: API,
  ) {
    this.config = platformConfig as WinixPlatformConfig;
    this.accessories = new Map<string, PlatformAccessory<DeviceContext>>();
    this.handlers = new Map<string, WinixPurifierAccessory>();
    this.deviceOverrides = (this.config.deviceOverrides ?? [])
      .reduce((m, o) => m.set(o.deviceId, o), new Map<string, DeviceOverride>());

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.onFinishLaunching.bind(this));
  }

  async onFinishLaunching(): Promise<void> {
    if (!this.config.auth?.refreshToken) {
      this.log.warn('Winix Purifiers is NOT set up. ' +
        'Please link your Winix account in the Homebridge UI.');
      return;
    }

    try {
      this.winix = await WinixAccount.fromExistingAuth(this.config.auth);
    } catch (e: unknown) {
      this.log.error('error generating winix account from existing auth:', e);
      return;
    }

    await this.discoverDevices();

    // refresh devices on the configured interval
    const refreshIntervalMs = (this.config.deviceRefreshIntervalMinutes ?? DEFAULT_DEVICE_REFRESH_INTERVAL_MINUTES) * 60 * 1000;
    setInterval(async () => await this.discoverDevices(), refreshIntervalMs);
  }

  async discoverDevices(): Promise<void> {
    this.log.debug('Starting device discovery...');
    let devices: WinixDevice[] | undefined;

    try {
      devices = await this.winix?.getDevices();
    } catch (e: unknown) {
      assertError(e);
      this.log.error('error getting devices:', e.message);
      return;
    }

    // if devices is explicitly typeof undefined, then the user has not logged in yet
    if (typeof devices === 'undefined') {
      this.log.warn('Winix Purifiers is NOT set up. ' +
        'Please log in with your Winix account credentials in the Homebridge UI.');
      return;
    }

    if (devices.length === 0) {
      this.log.warn('No Winix devices found. Please add devices to your Winix account.');
    }

    const accessoriesToAdd: PlatformAccessory<DeviceContext>[] = [];
    const discoveredUUIDs = new Set<string>();

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.deviceId);
      let accessory = this.accessories.get(uuid);
      this.log.debug('Found', accessory ? 'existing' : 'new', 'accessory:', this.logName(device));

      if (accessory) {
        accessory.context.device = device;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        accessory = new this.api.platformAccessory(device.deviceAlias, uuid, Categories.AIR_PURIFIER);
        accessory.context.device = device;
        const handler = this.createNewAccessoryHandler(accessory);
        this.accessories.set(uuid, accessory);
        this.handlers.set(uuid, handler);
        accessoriesToAdd.push(accessory);
      }

      discoveredUUIDs.add(accessory.UUID);
    }

    if (accessoriesToAdd.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToAdd);
    }

    this.removeOldDevices(discoveredUUIDs);
  }

  private createNewAccessoryHandler(accessory: PlatformAccessory<DeviceContext>): WinixPurifierAccessory {
    // 🫣 suppress warning message about adding characteristics which aren't required / optional, since it isn't accurate
    this.suppressCharacteristicWarnings(accessory);
    const deviceOverride = this.deviceOverrides.get(accessory.context.device.deviceId);
    const handler = new WinixPurifierAccessory(this.log, this, this.config, accessory, deviceOverride);
    this.unsuppressCharacteristicWarnings(accessory);

    return handler;
  }

  private removeOldDevices(discoveredUUIDs: Set<string>): void {
    this.accessories.forEach((accessory) => {
      // if we've seen this accessory in discovered devices, don't remove it
      if (discoveredUUIDs.has(accessory.UUID)) {
        return;
      }

      this.log.debug('Removing old accessory:', this.logName(accessory.context.device));
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.delete(accessory.UUID);
      this.handlers.delete(accessory.UUID);
    });
  }

  configureAccessory(accessory: PlatformAccessory<DeviceContext>): void {
    this.log.debug('Loading cached accessory:', this.logName(accessory.context.device));
    const handler = this.createNewAccessoryHandler(accessory);
    this.accessories.set(accessory.UUID, accessory);
    this.handlers.set(accessory.UUID, handler);
  }

  logName(device: WinixDevice): string {
    return `${device.modelName}-${device.deviceAlias}`;
  }

  private suppressCharacteristicWarnings(accessory: PlatformAccessory<DeviceContext>): void {
    this.log.debug('Suppressing characteristic warnings for %s', this.logName(accessory.context.device));
    accessory._associatedHAPAccessory.on(AccessoryEventTypes.CHARACTERISTIC_WARNING, this.doNada);
  }

  private unsuppressCharacteristicWarnings(accessory: PlatformAccessory<DeviceContext>): void {
    this.log.debug('Unsuppressing characteristic warnings for %s', this.logName(accessory.context.device));
    accessory._associatedHAPAccessory.removeListener(AccessoryEventTypes.CHARACTERISTIC_WARNING, this.doNada);
  }

  private doNada(): void {
    // do nothing
  }
}
