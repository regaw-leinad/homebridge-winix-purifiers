import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { Airflow, AirQuality, Mode, Plasmawave, Power } from 'winix-api';
import { DeviceContext, WinixPurifierPlatform } from './platform';
import { DeviceOverride, WinixPlatformConfig } from './config';
import { CharacteristicManager } from './characteristic';
import { DeviceLogger } from './logger';
import { Device } from './device';

/**
 * The maximum filter life in hours.
 * Winix only reports the first 6480 hours of usage, then stops counting 😑
 */
const MAX_FILTER_HOURS = 6480;
const DEFAULT_FILTER_LIFE_REPLACEMENT_PERCENTAGE = 10;
const DEFAULT_CACHE_INTERVAL_SECONDS = 60;
const MIN_AMBIENT_LIGHT = 0.0001;

export class WinixPurifierAccessory {

  private readonly ServiceType = this.platform.Service;
  private readonly Characteristic = this.platform.Characteristic;

  private readonly device: Device;
  private readonly servicesInUse: Set<Service>;

  private readonly purifier: Service;
  private readonly purifierInfo: Service;
  private readonly airQuality?: Service;
  private readonly plasmawave?: Service;
  private readonly ambientLight?: Service;
  private readonly autoSwitch?: Service;
  private readonly sleepSwitch?: Service;

  constructor(
    private readonly platform: WinixPurifierPlatform,
    private readonly config: WinixPlatformConfig,
    private readonly accessory: PlatformAccessory<DeviceContext>,
    readonly override: DeviceOverride | undefined,
    private readonly log: DeviceLogger,
  ) {
    const { deviceId, deviceAlias } = accessory.context.device;

    const cacheIntervalMs = (config.cacheIntervalSeconds ?? DEFAULT_CACHE_INTERVAL_SECONDS) * 1000;
    this.device = new Device(deviceId, cacheIntervalMs, this.log);
    this.servicesInUse = new Set<Service>();

    const deviceSerial = override?.serialNumber ?? 'WNXAI00000000';
    const deviceName = override?.nameDevice ?? deviceAlias;
    const airQualityName = override?.nameAirQuality ?? 'Air Quality';
    const plasmawaveName = override?.namePlasmawave ?? 'Plasmawave';
    const ambientLightName = override?.nameAmbientLight ?? 'Ambient Light';
    const autoSwitchName = override?.nameAutoSwitch ?? 'Auto Mode';

    const characteristics = new CharacteristicManager(platform, log);

    // Create services
    this.purifier = accessory.getService(this.ServiceType.AirPurifier) ||
      accessory.addService(this.ServiceType.AirPurifier);
    this.servicesInUse.add(this.purifier);
    characteristics.set(this.purifier, this.Characteristic.Name, deviceName);
    characteristics.set(this.purifier, this.Characteristic.ConfiguredName, deviceName);
    characteristics.get(this.purifier, this.Characteristic.Active)
      .onGet(this.getActiveState.bind(this))
      .onSet(this.setActiveState.bind(this));
    characteristics.get(this.purifier, this.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentState.bind(this));
    characteristics.get(this.purifier, this.Characteristic.TargetAirPurifierState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));
    characteristics.get(this.purifier, this.Characteristic.RotationSpeed)
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.debounce(this.setRotationSpeed.bind(this), 500));
    characteristics.get(this.purifier, this.Characteristic.FilterLifeLevel)
      .onGet(this.getFilterLifeLevel.bind(this));
    characteristics.get(this.purifier, this.Characteristic.FilterChangeIndication)
      .onGet(this.getFilterChangeIndication.bind(this));

    this.purifierInfo = accessory.getService(this.ServiceType.AccessoryInformation) ||
      accessory.addService(this.ServiceType.AccessoryInformation);
    this.servicesInUse.add(this.purifierInfo);
    characteristics.set(this.purifierInfo, this.Characteristic.Name, deviceName);
    characteristics.set(this.purifierInfo, this.Characteristic.ConfiguredName, deviceName);
    characteristics.set(this.purifierInfo, this.Characteristic.Manufacturer, 'Winix');
    characteristics.set(this.purifierInfo, this.Characteristic.SerialNumber, deviceSerial);
    characteristics.get(this.purifierInfo, this.Characteristic.FirmwareRevision)
      .onGet(() => accessory.context.device.mcuVer);
    characteristics.get(this.purifierInfo, this.Characteristic.Model)
      .onGet(() => accessory.context.device.modelName);

    if (config.exposeAirQuality) {
      this.airQuality = accessory.getServiceById(this.ServiceType.AirQualitySensor, 'air-quality-sensor') ||
        accessory.addService(this.ServiceType.AirQualitySensor, airQualityName, 'air-quality-sensor');
      this.servicesInUse.add(this.airQuality);
      characteristics.set(this.airQuality, this.Characteristic.Name, airQualityName);
      characteristics.set(this.airQuality, this.Characteristic.ConfiguredName, airQualityName);
      characteristics.get(this.airQuality, this.Characteristic.AirQuality)
        .onGet(this.getAirQuality.bind(this));
    }

    if (config.exposePlasmawave) {
      this.plasmawave = accessory.getServiceById(this.ServiceType.Switch, 'switch-plasmawave') ||
        accessory.addService(this.ServiceType.Switch, plasmawaveName, 'switch-plasmawave');
      this.servicesInUse.add(this.plasmawave);
      characteristics.set(this.plasmawave, this.Characteristic.Name, plasmawaveName);
      characteristics.set(this.plasmawave, this.Characteristic.ConfiguredName, plasmawaveName);
      characteristics.get(this.plasmawave, this.Characteristic.On)
        .onGet(this.getPlasmawave.bind(this))
        .onSet(this.setPlasmawave.bind(this));
    }

    if (config.exposeAmbientLight) {
      this.ambientLight = accessory.getServiceById(this.ServiceType.LightSensor, 'light-sensor-ambient') ||
        accessory.addService(this.ServiceType.LightSensor, ambientLightName, 'light-sensor-ambient');
      this.servicesInUse.add(this.ambientLight);
      characteristics.set(this.ambientLight, this.Characteristic.Name, ambientLightName);
      characteristics.set(this.ambientLight, this.Characteristic.ConfiguredName, ambientLightName);
      characteristics.get(this.ambientLight, this.Characteristic.CurrentAmbientLightLevel)
        .onGet(this.getAmbientLight.bind(this));
    }

    if (config.exposeAutoSwitch) {
      this.autoSwitch = accessory.getServiceById(this.ServiceType.Switch, 'switch-auto') ||
        accessory.addService(this.ServiceType.Switch, autoSwitchName, 'switch-auto');
      this.servicesInUse.add(this.autoSwitch);
      characteristics.set(this.autoSwitch, this.Characteristic.Name, autoSwitchName);
      characteristics.set(this.autoSwitch, this.Characteristic.ConfiguredName, autoSwitchName);
      characteristics.get(this.autoSwitch, this.Characteristic.On)
        .onGet(this.getAutoSwitchState.bind(this))
        .onSet(this.setAutoSwitchState.bind(this));
    }

    if (config.exposeSleepSwitch) {
      this.sleepSwitch = accessory.getServiceById(this.ServiceType.Switch, 'switch-sleep') ||
        accessory.addService(this.ServiceType.Switch, 'Sleep', 'switch-sleep');
      this.servicesInUse.add(this.sleepSwitch);
      characteristics.set(this.sleepSwitch, this.Characteristic.Name, 'Sleep');
      characteristics.set(this.sleepSwitch, this.Characteristic.ConfiguredName, 'Sleep');
      characteristics.get(this.sleepSwitch, this.Characteristic.On)
        .onGet(this.getSleepSwitchState.bind(this))
        .onSet(this.setSleepSwitchState.bind(this));
    }

    this.pruneUnusedServices();
  }

  /**
   * Prune any services that are no longer in use.
   * A service would be pruned if one is initially added,
   * but then later removed from the config
   */
  private pruneUnusedServices(): void {
    this.accessory.services.forEach((service) => {
      if (this.servicesInUse.has(service)) {
        return;
      }

      this.log.debug('pruning unused service:', service.displayName);
      this.accessory.removeService(service);
    });
  }

  /**
   * Get the active state of the purifier.
   * This maps to the Power attribute of the Winix device.
   */
  async getActiveState(): Promise<CharacteristicValue> {
    const power = await this.device.getPower();
    this.log.debug('accessory:getActiveState()', power);
    return this.toActiveState(power);
  }

  /**
   * Set the active state of the purifier.
   * This maps to the Power attribute of the Winix device.
   */
  async setActiveState(state: CharacteristicValue) {
    const power: Power = state === this.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    this.log.debug(`accessory:setActiveState(${state})`, power);
    await this.device.setPower(power);
    await this.sendHomekitUpdate();
  }

  /**
   * Get the current state of the purifier. Either purifying air or inactive.
   * Same as power for this implementation.
   */
  async getCurrentState(): Promise<CharacteristicValue> {
    const power = await this.device.getPower();
    this.log.debug('accessory:getCurrentState()', power);
    return this.toCurrentState(power);
  }

  /**
   * Get the target state of the purifier. Either auto or manual mode.
   */
  async getTargetState(): Promise<CharacteristicValue> {
    const mode = await this.device.getMode();
    this.log.debug('accessory:getTargetState()', mode);
    return this.toTargetState(mode);
  }

  /**
   * Set the target state of the purifier. Either auto or manual mode.
   */
  async setTargetState(state: CharacteristicValue): Promise<void> {
    const newMode: Mode = state === this.Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
    this.log.debug(`accessory:setTargetState(${state})`, newMode);
    await this.device.setMode(newMode);

    if (newMode === Mode.Manual) {
      return;
    }

    // If we're switching back to auto, the airflow speed will most likely change on the Winix device itself.
    // Pause, get the latest airflow speed, then send the update to Homekit
    this.scheduleHomekitUpdate();
  }

  /**
   * Get the rotation speed of the purifier.
   */
  async getRotationSpeed(): Promise<CharacteristicValue> {
    const airflow = await this.device.getAirflow();
    this.log.debug('accessory:getRotationSpeed()', airflow);
    return this.toRotationSpeed(airflow);
  }

  /**
   * Set the rotation speed of the purifier.
   */
  async setRotationSpeed(state: CharacteristicValue): Promise<void> {
    const airflow: Airflow | null = this.toAirflow(state);
    this.log.debug(`accessory:setRotationSpeed(${state}):`, airflow);

    // Don't set the airflow if it's null. this means state was 0 - this is a power-off signal
    if (!airflow) {
      return;
    }

    await this.device.setAirflow(airflow);
    await this.sendHomekitUpdate();
  }

  /**
   * Get the air quality of the purifier.
   */
  async getAirQuality(): Promise<CharacteristicValue> {
    const airQuality = await this.device.getAirQuality();
    this.log.debug('accessory:getAirQuality():', airQuality);
    return this.toAirQuality(airQuality);
  }

  /**
   * Get the plasmawave state of the purifier.
   */
  async getPlasmawave(): Promise<CharacteristicValue> {
    const plasmawave = await this.device.getPlasmawave();
    this.log.debug('accessory:getPlasmawave():', plasmawave);
    return this.toSwitch(plasmawave);
  }

  /**
   * Set the plasmawave state of the purifier.
   */
  async setPlasmawave(state: CharacteristicValue): Promise<void> {
    const plasmawave: Plasmawave = this.toPlasmawave(state);
    this.log.debug(`accessory:setPlasmawave(${state}):`, plasmawave);
    await this.device.setPlasmawave(plasmawave);
    await this.sendHomekitUpdate();
  }

  /**
   * Get the ambient light level of the purifier.
   */
  async getAmbientLight(): Promise<CharacteristicValue> {
    const ambientLight = await this.device.getAmbientLight();
    // Fix ambient light value under 0.0001 warning
    const fixedAmbientLight = Math.max(ambientLight, MIN_AMBIENT_LIGHT);
    this.log.debug('accessory:getAmbientLight():', 'measured:', ambientLight, 'fixed:', fixedAmbientLight);
    return fixedAmbientLight;
  }

  /**
   * Get the auto switch state of the purifier.
   */
  async getAutoSwitchState(): Promise<CharacteristicValue> {
    const targetState = await this.getTargetState();

    // Translate target state (auto/manual mode) to auto switch state
    const result = targetState === this.Characteristic.TargetAirPurifierState.AUTO;
    this.log.debug('accessory:getAutoSwitchState()', 'target', targetState, 'result', result);
    return result;
  }

  /**
   * Set the auto switch state of the purifier.
   */
  async setAutoSwitchState(state: CharacteristicValue): Promise<void> {
    // Translate auto switch state to target state (auto/manual mode)
    const proxyState: CharacteristicValue = state ?
      this.Characteristic.TargetAirPurifierState.AUTO :
      this.Characteristic.TargetAirPurifierState.MANUAL;

    this.log.debug(`accessory:setAutoSwitchState(${state})`, proxyState);
    return await this.setTargetState(proxyState);
  }

  /**
   * Get the sleep switch state of the purifier.
   */
  async getSleepSwitchState(): Promise<CharacteristicValue> {
    const airflow = await this.device.getAirflow();
    const isInSleep = airflow === Airflow.Sleep;
    this.log.debug('accessory:getSleepSwitchState()', isInSleep);
    return isInSleep;
  }

  /**
   * Set the sleep switch state of the purifier.
   */
  async setSleepSwitchState(state: CharacteristicValue): Promise<void> {
    const airflow: Airflow = state ? Airflow.Sleep : Airflow.Low;
    this.log.debug(`accessory:setSleepSwitchState(${state})`, airflow);
    await this.device.setAirflow(airflow);
    this.scheduleHomekitUpdate();
  }

  /**
   * Get the filter life level of the purifier.
   */
  async getFilterLifeLevel(): Promise<CharacteristicValue> {
    const currentFilterHours = await this.device.getFilterHours();

    if (currentFilterHours <= 0) {
      this.log.debug('accessory:getFilterLifeLevel(): currentFilterHours is not a positive number:', currentFilterHours);
      return 100;
    }

    const remainingLife = Math.max(MAX_FILTER_HOURS - currentFilterHours, 0);
    const remainingPercentage = Math.round((remainingLife / MAX_FILTER_HOURS) * 100);
    this.log.debug('accessory:getFilterLifeLevel()', remainingPercentage);

    return remainingPercentage;
  }

  /**
   * Get the filter change indication of the purifier.
   */
  async getFilterChangeIndication(): Promise<CharacteristicValue> {
    const filterLife = await this.getFilterLifeLevel() as number;
    const replacementPercentage = this.config.filterReplacementIndicatorPercentage ?? DEFAULT_FILTER_LIFE_REPLACEMENT_PERCENTAGE;
    const shouldReplaceFilter = filterLife <= replacementPercentage ?
      this.Characteristic.FilterChangeIndication.CHANGE_FILTER :
      this.Characteristic.FilterChangeIndication.FILTER_OK;

    this.log.debug(
      'accessory:getFilterChangeIndication() filterLife:', filterLife,
      'replacementPercentage:', replacementPercentage,
      'shouldReplaceFilter:', shouldReplaceFilter,
    );

    return shouldReplaceFilter;
  }

  private scheduleHomekitUpdate() {
    this.log.debug('scheduling homekit update');

    setTimeout(async () => {
      await this.device.update();
      await this.sendHomekitUpdate();
    }, 1000);
  }

  /**
   * Send an update to Homekit with the latest device status.
   */
  private async sendHomekitUpdate(): Promise<void> {
    this.log.debug('accessory:sendHomekitUpdate()');

    if (!this.device.hasData()) {
      this.log.debug('accessory:sendHomekitUpdate(): skipping update, no status');
      return;
    }

    const {
      power,
      mode,
      airflow,
      airQuality,
      plasmawave,
      ambientLight,
    } = await this.device.getState();

    this.purifier.updateCharacteristic(this.Characteristic.Active, this.toActiveState(power));
    this.purifier.updateCharacteristic(this.Characteristic.CurrentAirPurifierState, this.toCurrentState(power));
    this.purifier.updateCharacteristic(this.Characteristic.TargetAirPurifierState, this.toTargetState(mode));
    this.purifier.updateCharacteristic(this.Characteristic.RotationSpeed, this.toRotationSpeed(airflow));

    if (this.airQuality !== undefined) {
      this.airQuality?.updateCharacteristic(this.Characteristic.AirQuality, this.toAirQuality(airQuality));
    }

    if (this.plasmawave !== undefined) {
      this.plasmawave?.updateCharacteristic(this.Characteristic.On, this.toSwitch(plasmawave));
    }

    if (this.ambientLight !== undefined) {
      this.ambientLight?.updateCharacteristic(this.Characteristic.CurrentAmbientLightLevel, ambientLight);
    }

    if (this.autoSwitch !== undefined) {
      this.autoSwitch?.updateCharacteristic(
        this.Characteristic.On,
        this.toTargetState(mode) === this.Characteristic.TargetAirPurifierState.AUTO,
      );
    }

    if (this.sleepSwitch !== undefined) {
      this.sleepSwitch?.updateCharacteristic(
        this.Characteristic.On,
        airflow === Airflow.Sleep,
      );
    }
  }

  private toActiveState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return this.Characteristic.Active.ACTIVE;
      case Power.Off:
        return this.Characteristic.Active.INACTIVE;
    }
  }

  private toCurrentState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return this.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
      case Power.Off:
        return this.Characteristic.CurrentAirPurifierState.INACTIVE;
    }
  }

  private toTargetState(mode: Mode): CharacteristicValue {
    switch (mode) {
      case Mode.Auto:
        return this.Characteristic.TargetAirPurifierState.AUTO;
      case Mode.Manual:
        return this.Characteristic.TargetAirPurifierState.MANUAL;
    }
  }

  private toRotationSpeed(airflow: Airflow): CharacteristicValue {
    switch (airflow) {
      case Airflow.Sleep:
        return 1;
      case Airflow.Low:
        return 25;
      case Airflow.Medium:
        return 50;
      case Airflow.High:
        return 75;
      case Airflow.Turbo:
        return 100;
    }
  }

  private toAirflow(state: CharacteristicValue): Airflow | null {
    // Don't return any airflow if the state is explicitly 0, this is a power-off signal
    if (state as number === 0) {
      return null;
    }

    // Round to nearest 25
    const nearestState: number = Math.round(state as number / 25) * 25;
    this.log.debug(`accessory:toAirflow(${state}): ${nearestState}`);

    switch (nearestState) {
      case 0:
        return Airflow.Sleep;
      case 25:
        return Airflow.Low;
      case 50:
        return Airflow.Medium;
      case 75:
        return Airflow.High;
      case 100:
        return Airflow.Turbo;
    }

    return nearestState > 100 ? Airflow.Turbo : Airflow.Sleep;
  }

  private toAirQuality(airQuality: AirQuality): CharacteristicValue {
    switch (airQuality) {
      case AirQuality.Good:
        return this.Characteristic.AirQuality.GOOD;
      case AirQuality.Fair:
        return this.Characteristic.AirQuality.FAIR;
      case AirQuality.Poor:
        return this.Characteristic.AirQuality.POOR;
      default:
        return this.Characteristic.AirQuality.UNKNOWN;
    }
  }

  private toSwitch(plasmawave: Plasmawave): CharacteristicValue {
    return plasmawave === Plasmawave.On;
  }

  private toPlasmawave(state: CharacteristicValue): Plasmawave {
    return state ? Plasmawave.On : Plasmawave.Off;
  }

  private debounce(func: (arg: CharacteristicValue) => Promise<void>, delay: number): (arg: CharacteristicValue) => Promise<void> {
    let timeoutId: NodeJS.Timeout | null = null;
    return async (arg: CharacteristicValue) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(async () => await func(arg), delay);
    };
  }
}
