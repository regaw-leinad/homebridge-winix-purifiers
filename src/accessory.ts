import { Airflow, AirQuality, Mode, Plasmawave, Power } from 'winix-api';
import { CharacteristicValue, PlatformAccessory } from 'homebridge';
import { DeviceOverride, WinixPlatformConfig } from './config';
import { CharacteristicManager } from './characteristic';
import { Characteristic, Service } from 'hap-nodejs';
import { DeviceContext } from './platform';
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

  private readonly device: Device;
  private readonly servicesInUse: Set<Service>;

  private readonly purifier: Service;
  private readonly purifierInfo: Service;
  private readonly airQuality?: Service;
  private readonly plasmawave?: Service;
  private readonly ambientLight?: Service;
  private readonly autoSwitch?: Service;

  constructor(
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

    const characteristics = new CharacteristicManager(log);

    // Create services
    this.purifier = accessory.getService(Service.AirPurifier) ||
      accessory.addService(Service.AirPurifier);
    this.servicesInUse.add(this.purifier);
    characteristics.set(this.purifier, Characteristic.Name, deviceName);
    characteristics.set(this.purifier, Characteristic.ConfiguredName, deviceName);
    characteristics.get(this.purifier, Characteristic.Active)
      .onGet(this.getActiveState.bind(this))
      .onSet(this.setActiveState.bind(this));
    characteristics.get(this.purifier, Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentState.bind(this));
    characteristics.get(this.purifier, Characteristic.TargetAirPurifierState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));
    characteristics.get(this.purifier, Characteristic.RotationSpeed)
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));
    characteristics.get(this.purifier, Characteristic.FilterLifeLevel)
      .onGet(this.getFilterLifeLevel.bind(this));
    characteristics.get(this.purifier, Characteristic.FilterChangeIndication)
      .onGet(this.getFilterChangeIndication.bind(this));

    this.purifierInfo = accessory.getService(Service.AccessoryInformation) ||
      accessory.addService(Service.AccessoryInformation);
    this.servicesInUse.add(this.purifierInfo);
    characteristics.set(this.purifierInfo, Characteristic.Name, deviceName);
    characteristics.set(this.purifierInfo, Characteristic.ConfiguredName, deviceName);
    characteristics.set(this.purifierInfo, Characteristic.Manufacturer, 'Winix');
    characteristics.set(this.purifierInfo, Characteristic.SerialNumber, deviceSerial);
    characteristics.get(this.purifierInfo, Characteristic.FirmwareRevision)
      .onGet(() => accessory.context.device.mcuVer);
    characteristics.get(this.purifierInfo, Characteristic.Model)
      .onGet(() => accessory.context.device.modelName);

    if (config.exposeAirQuality) {
      this.airQuality = accessory.getServiceById(Service.AirQualitySensor, 'air-quality-sensor') ||
        accessory.addService(Service.AirQualitySensor, airQualityName, 'air-quality-sensor');
      this.servicesInUse.add(this.airQuality);
      characteristics.set(this.airQuality, Characteristic.Name, airQualityName);
      characteristics.set(this.airQuality, Characteristic.ConfiguredName, airQualityName);
      characteristics.get(this.airQuality, Characteristic.AirQuality)
        .onGet(this.getAirQuality.bind(this));
    }

    if (config.exposePlasmawave) {
      this.plasmawave = accessory.getServiceById(Service.Switch, 'switch-plasmawave') ||
        accessory.addService(Service.Switch, plasmawaveName, 'switch-plasmawave');
      this.servicesInUse.add(this.plasmawave);
      characteristics.set(this.plasmawave, Characteristic.Name, plasmawaveName);
      characteristics.set(this.plasmawave, Characteristic.ConfiguredName, plasmawaveName);
      characteristics.get(this.plasmawave, Characteristic.On)
        .onGet(this.getPlasmawave.bind(this))
        .onSet(this.setPlasmawave.bind(this));
    }

    if (config.exposeAmbientLight) {
      this.ambientLight = accessory.getServiceById(Service.LightSensor, 'light-sensor-ambient') ||
        accessory.addService(Service.LightSensor, ambientLightName, 'light-sensor-ambient');
      this.servicesInUse.add(this.ambientLight);
      characteristics.set(this.ambientLight, Characteristic.Name, ambientLightName);
      characteristics.set(this.ambientLight, Characteristic.ConfiguredName, ambientLightName);
      characteristics.get(this.ambientLight, Characteristic.CurrentAmbientLightLevel)
        .onGet(this.getAmbientLight.bind(this));
    }

    if (config.exposeAutoSwitch) {
      this.autoSwitch = accessory.getServiceById(Service.Switch, 'switch-auto') ||
        accessory.addService(Service.Switch, autoSwitchName, 'switch-auto');
      this.servicesInUse.add(this.autoSwitch);
      characteristics.set(this.autoSwitch, Characteristic.Name, autoSwitchName);
      characteristics.set(this.autoSwitch, Characteristic.ConfiguredName, autoSwitchName);
      characteristics.get(this.autoSwitch, Characteristic.On)
        .onGet(this.getAutoSwitchState.bind(this))
        .onSet(this.setAutoSwitchState.bind(this));
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
    this.log.debug('getActiveState()', power);
    return this.toActiveState(power);
  }

  /**
   * Set the active state of the purifier.
   * This maps to the Power attribute of the Winix device.
   */
  async setActiveState(state: CharacteristicValue) {
    const power: Power = state === Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    this.log.debug(`setActiveState(${state})`, power);
    await this.device.setPower(power);
    await this.sendHomekitUpdate();
  }

  /**
   * Get the current state of the purifier. Either purifying air or inactive.
   * Same as power for this implementation.
   */
  async getCurrentState(): Promise<CharacteristicValue> {
    const power = await this.device.getPower();
    this.log.debug('getCurrentState()', power);
    return this.toCurrentState(power);
  }

  /**
   * Get the target state of the purifier. Either auto or manual mode.
   */
  async getTargetState(): Promise<CharacteristicValue> {
    const mode = await this.device.getMode();
    this.log.debug('getTargetState()', mode);
    return this.toTargetState(mode);
  }

  /**
   * Set the target state of the purifier. Either auto or manual mode.
   */
  async setTargetState(state: CharacteristicValue): Promise<void> {
    const newMode: Mode = state === Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
    this.log.debug(`setTargetState(${state})`, newMode);
    await this.device.setMode(newMode);

    if (newMode === Mode.Manual) {
      return;
    }

    // If we're switching back to auto, the airflow speed will most likely change on the Winix device itself.
    // Pause, get the latest airflow speed, then send the update to Homekit
    this.log.debug('scheduling homekit update to rotation speed');

    setTimeout(async () => {
      await this.device.update();
      await this.sendHomekitUpdate();
    }, 2000);
  }

  /**
   * Get the rotation speed of the purifier.
   */
  async getRotationSpeed(): Promise<CharacteristicValue> {
    const airflow = await this.device.getAirflow();
    this.log.debug('getRotationSpeed()', airflow);
    return this.toRotationSpeed(airflow);
  }

  /**
   * Set the rotation speed of the purifier.
   */
  async setRotationSpeed(state: CharacteristicValue): Promise<void> {
    const airflow: Airflow = this.toAirflow(state);
    this.log.debug(`setRotationSpeed(${state}):`, airflow);
    await this.device.setAirflow(airflow);
    await this.sendHomekitUpdate();
  }

  /**
   * Get the air quality of the purifier.
   */
  async getAirQuality(): Promise<CharacteristicValue> {
    const airQuality = await this.device.getAirQuality();
    this.log.debug('getAirQuality():', airQuality);
    return this.toAirQuality(airQuality);
  }

  /**
   * Get the plasmawave state of the purifier.
   */
  async getPlasmawave(): Promise<CharacteristicValue> {
    const plasmawave = await this.device.getPlasmawave();
    this.log.debug('getPlasmawave():', plasmawave);
    return this.toSwitch(plasmawave);
  }

  /**
   * Set the plasmawave state of the purifier.
   */
  async setPlasmawave(state: CharacteristicValue): Promise<void> {
    const plasmawave: Plasmawave = this.toPlasmawave(state);
    this.log.debug(`setPlasmawave(${state}):`, plasmawave);
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
    this.log.debug('getAmbientLight():', 'measured:', ambientLight, 'fixed:', fixedAmbientLight);
    return ambientLight;
  }

  /**
   * Get the auto switch state of the purifier.
   */
  async getAutoSwitchState(): Promise<CharacteristicValue> {
    const targetState = await this.getTargetState();

    // Translate target state (auto/manual mode) to auto switch state
    const result = targetState === Characteristic.TargetAirPurifierState.AUTO ?
      Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;

    this.log.debug('getAutoSwitchState()', 'target', targetState, 'result', result);
    return result;
  }

  /**
   * Set the auto switch state of the purifier.
   */
  async setAutoSwitchState(state: CharacteristicValue): Promise<void> {
    // Translate auto switch state to target state (auto/manual mode)
    const proxyState: CharacteristicValue = state ?
      Characteristic.TargetAirPurifierState.AUTO :
      Characteristic.TargetAirPurifierState.MANUAL;

    this.log.debug(`setAutoSwitchState(${state})`, proxyState);
    return this.setTargetState(proxyState);
  }

  /**
   * Get the filter life level of the purifier.
   */
  async getFilterLifeLevel(): Promise<CharacteristicValue> {
    const currentFilterHours = await this.device.getFilterHours();

    if (currentFilterHours <= 0) {
      this.log.debug('getFilterLifeLevel(): currentFilterHours is not a positive number:', currentFilterHours);
      return 100;
    }

    const remainingLife = Math.max(MAX_FILTER_HOURS - currentFilterHours, 0);
    const remainingPercentage = Math.round((remainingLife / MAX_FILTER_HOURS) * 100);
    this.log.debug('getFilterLifeLevel()', remainingPercentage);

    return remainingPercentage;
  }

  /**
   * Get the filter change indication of the purifier.
   */
  async getFilterChangeIndication(): Promise<CharacteristicValue> {
    const filterLife = await this.getFilterLifeLevel() as number;
    const replacementPercentage = this.config.filterReplacementIndicatorPercentage ?? DEFAULT_FILTER_LIFE_REPLACEMENT_PERCENTAGE;
    const shouldReplaceFilter = filterLife <= replacementPercentage ?
      Characteristic.FilterChangeIndication.CHANGE_FILTER :
      Characteristic.FilterChangeIndication.FILTER_OK;

    this.log.debug(
      'getFilterChangeIndication() filterLife:', filterLife,
      'replacementPercentage:', replacementPercentage,
      'shouldReplaceFilter:', shouldReplaceFilter,
    );

    return shouldReplaceFilter;
  }

  /**
   * Send an update to Homekit with the latest device status.
   */
  private async sendHomekitUpdate(): Promise<void> {
    this.log.debug('sendHomekitUpdate()');

    if (!this.device.hasData()) {
      this.log.debug('sendHomekitUpdate(): skipping update, no status');
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

    this.purifier.updateCharacteristic(Characteristic.Active, this.toActiveState(power));
    this.purifier.updateCharacteristic(Characteristic.CurrentAirPurifierState, this.toCurrentState(power));
    this.purifier.updateCharacteristic(Characteristic.TargetAirPurifierState, this.toTargetState(mode));
    this.purifier.updateCharacteristic(Characteristic.RotationSpeed, this.toRotationSpeed(airflow));

    if (this.airQuality !== undefined) {
      this.airQuality?.updateCharacteristic(Characteristic.AirQuality, this.toAirQuality(airQuality));
    }

    if (this.plasmawave !== undefined) {
      this.plasmawave?.updateCharacteristic(Characteristic.On, this.toSwitch(plasmawave));
    }

    if (this.ambientLight !== undefined) {
      this.ambientLight?.updateCharacteristic(Characteristic.CurrentAmbientLightLevel, ambientLight);
    }

    if (this.autoSwitch !== undefined) {
      this.autoSwitch?.updateCharacteristic(
        Characteristic.On,
        this.toTargetState(mode) === Characteristic.TargetAirPurifierState.AUTO,
      );
    }
  }

  private toActiveState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return Characteristic.Active.ACTIVE;
      case Power.Off:
        return Characteristic.Active.INACTIVE;
    }
  }

  private toCurrentState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
      case Power.Off:
        return Characteristic.CurrentAirPurifierState.INACTIVE;
    }
  }

  private toTargetState(mode: Mode): CharacteristicValue {
    switch (mode) {
      case Mode.Auto:
        return Characteristic.TargetAirPurifierState.AUTO;
      case Mode.Manual:
        return Characteristic.TargetAirPurifierState.MANUAL;
    }
  }

  private toRotationSpeed(airflow: Airflow): CharacteristicValue {
    switch (airflow) {
      case Airflow.Sleep:
        return 0;
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

  private toAirflow(state: CharacteristicValue): Airflow {
    // Round to nearest 25
    const nearestState: number = Math.round(state as number / 25) * 25;
    this.log.debug(`toAirflow(${state}): ${nearestState}`);

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
        return Characteristic.AirQuality.GOOD;
      case AirQuality.Fair:
        return Characteristic.AirQuality.FAIR;
      case AirQuality.Poor:
        return Characteristic.AirQuality.POOR;
      default:
        return Characteristic.AirQuality.UNKNOWN;
    }
  }

  private toSwitch(plasmawave: Plasmawave): CharacteristicValue {
    return plasmawave === Plasmawave.On;
  }

  private toPlasmawave(state: CharacteristicValue): Plasmawave {
    return state ? Plasmawave.On : Plasmawave.Off;
  }
}
