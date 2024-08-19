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
import { NotConfiguredError, UnauthenticatedError, WinixHandler } from './winix';
import { ENCRYPTION_KEY, PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DeviceOverride, WinixPlatformConfig } from './config';
import { WinixPurifierAccessory } from './accessory';
import { WinixDevice } from 'winix-api';
import { DeviceLogger } from './logger';
import { assertError } from './errors';
import { decrypt } from './encryption';

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
  private winix: WinixHandler;

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
    this.winix = new WinixHandler(api.user.storagePath(), ENCRYPTION_KEY);

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.onFinishLaunching.bind(this));
  }

  async onFinishLaunching(): Promise<void> {
    if (!this.config.auth) {
      this.notConfigured();
      return;
    }

    // decrypt the password in memory if there is one
    if (this.config.auth.password) {
      try {
        this.config.auth.password = await decrypt(this.config.auth.password, ENCRYPTION_KEY);
      } catch (e: unknown) {
        this.log.error('error decrypting Winix login password from config:', e);
      }
    }

    try {
      await this.winix.refresh(this.config.auth);
    } catch (e: unknown) {
      if (e instanceof NotConfiguredError) {
        this.notConfigured();
        return;
      }

      assertError(e);
      this.log.error('error getting devices:', e.message);
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
      devices = await this.winix.getDevices();
    } catch (e: unknown) {
      if (e instanceof UnauthenticatedError) {
        this.notConfigured();
        return;
      }

      assertError(e);
      this.log.error('error getting devices:', e.message);
      return;
    }

    if (devices.length === 0) {
      this.log.error('No Winix devices found. Please add devices to your Winix account.');
    }

    const accessoriesToAdd: PlatformAccessory<DeviceContext>[] = [];
    const discoveredUUIDs = new Set<string>();

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.deviceId);
      let accessory = this.accessories.get(uuid);
      this.log.debug('Found', accessory ? 'existing' : 'new', 'accessory:', this.logName(device));

      if (accessory) {
        accessory.context.device = device;
        const handler = this.createNewAccessoryHandler(accessory);
        this.handlers.set(uuid, handler);
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
    const log = new DeviceLogger(this.log, accessory.context.device);
    const handler = new WinixPurifierAccessory(this, this.config, accessory, deviceOverride, log);
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
    this.accessories.set(accessory.UUID, accessory);
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

  private notConfigured(): void {
    this.log.error('Winix Purifiers is NOT set up. ' +
      'Please link your Winix account in the Homebridge UI.');

    // Message for users migrating from a previous version of the
    // plugin which required a refresh token in the config
    if (this.config.auth && this.config.auth['refreshToken']) {
      this.log.error('This version of the plugin requires re-linking your Winix account.');
    }
  }
}
