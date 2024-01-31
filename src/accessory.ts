import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI } from 'winix-api';
import { CharacteristicValue, HAPStatus, Logger, PlatformAccessory, Service } from 'homebridge';
import { DeviceContext, WinixPurifierPlatform } from './platform';
import { DeviceOverride, WinixPlatformConfig } from './config';
import { assertError } from './errors';

const DEFAULT_FILTER_LIFE_REPLACEMENT_PERCENTAGE = 10;
const DEFAULT_CACHE_INTERVAL_SECONDS = 60;
const MIN_AMBIENT_LIGHT = 0.0001;

export class WinixPurifierAccessory {

  private readonly deviceId: string;
  private readonly latestStatus: DeviceStatus;
  private readonly cacheIntervalMs: number;
  private lastWinixPoll: number;
  private readonly servicesInUse: Set<Service>;

  private readonly purifier: Service;
  private readonly purifierInfo: Service;
  private readonly airQuality?: Service;
  private readonly plasmawave?: Service;
  private readonly ambientLight?: Service;
  private readonly autoSwitch?: Service;

  constructor(
    private readonly log: Logger,
    private readonly platform: WinixPurifierPlatform,
    private readonly config: WinixPlatformConfig,
    private readonly accessory: PlatformAccessory<DeviceContext>,
    readonly override?: DeviceOverride,
  ) {
    const { deviceId, deviceAlias } = accessory.context.device;

    this.deviceId = deviceId;
    this.latestStatus = {};
    this.cacheIntervalMs = (config.cacheIntervalSeconds ?? DEFAULT_CACHE_INTERVAL_SECONDS) * 1000;
    this.lastWinixPoll = -1;
    this.servicesInUse = new Set<Service>();

    const deviceSerial = override?.serialNumber ?? 'WNXAI00000000';
    const deviceName = override?.nameDevice ?? deviceAlias;
    const airQualityName = override?.nameAirQuality ?? 'Air Quality';
    const plasmawaveName = override?.namePlasmawave ?? 'Plasmawave';
    const ambientLightName = override?.nameAmbientLight ?? 'Ambient Light';
    const autoSwitchName = override?.nameAutoSwitch ?? 'Auto Mode';

    // Create services
    this.purifier = accessory.getService(this.platform.Service.AirPurifier) ||
      accessory.addService(this.platform.Service.AirPurifier);
    this.purifier.updateCharacteristic(this.platform.Characteristic.Name, deviceName);
    this.servicesInUse.add(this.purifier);

    // TODO: Add handler for get/set ConfiguredName
    this.purifier.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActiveState.bind(this))
      .onSet(this.setActiveState.bind(this));
    this.purifier.getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentState.bind(this));
    this.purifier.getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));
    this.purifier.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));
    this.purifier.getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(this.getFilterLifeLevel.bind(this));
    this.purifier.getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(this.getFilterChangeIndication.bind(this));

    this.purifierInfo = accessory.getService(this.platform.Service.AccessoryInformation) ||
      accessory.addService(this.platform.Service.AccessoryInformation);
    this.purifierInfo.updateCharacteristic(this.platform.Characteristic.Manufacturer, 'Winix');
    this.purifierInfo.updateCharacteristic(this.platform.Characteristic.SerialNumber, deviceSerial);
    this.purifierInfo.getCharacteristic(this.platform.Characteristic.FirmwareRevision)
      .onGet(() => accessory.context.device.mcuVer);
    this.purifierInfo.getCharacteristic(this.platform.Characteristic.Model)
      .onGet(() => accessory.context.device.modelName);
    this.servicesInUse.add(this.purifierInfo);

    if (config.exposeAirQuality) {
      this.airQuality = accessory.getServiceById(this.platform.Service.AirQualitySensor, 'air-quality-sensor') ||
        accessory.addService(this.platform.Service.AirQualitySensor, airQualityName, 'air-quality-sensor');
      this.airQuality.setCharacteristic(this.platform.Characteristic.Name, airQualityName);
      // TODO: Add handler for get/set ConfiguredName
      this.airQuality.setCharacteristic(this.platform.Characteristic.ConfiguredName, airQualityName);
      this.airQuality.getCharacteristic(this.platform.Characteristic.AirQuality)
        .onGet(this.getAirQuality.bind(this));
      this.servicesInUse.add(this.airQuality);
    }

    if (config.exposePlasmawave) {
      this.plasmawave = accessory.getServiceById(this.platform.Service.Switch, 'switch-plasmawave') ||
        accessory.addService(this.platform.Service.Switch, plasmawaveName, 'switch-plasmawave');
      this.plasmawave.setCharacteristic(this.platform.Characteristic.Name, plasmawaveName);
      // TODO: Add handler for get/set ConfiguredName
      this.plasmawave.setCharacteristic(this.platform.Characteristic.ConfiguredName, plasmawaveName);
      this.plasmawave.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getPlasmawave.bind(this))
        .onSet(this.setPlasmawave.bind(this));
      this.servicesInUse.add(this.plasmawave);
    }

    if (config.exposeAmbientLight) {
      this.ambientLight = accessory.getServiceById(this.platform.Service.LightSensor, 'light-sensor-ambient') ||
        accessory.addService(this.platform.Service.LightSensor, ambientLightName, 'light-sensor-ambient');
      this.ambientLight.setCharacteristic(this.platform.Characteristic.Name, ambientLightName);
      // TODO: Add handler for get/set ConfiguredName
      this.ambientLight.setCharacteristic(this.platform.Characteristic.ConfiguredName, ambientLightName);
      this.ambientLight.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .onGet(this.getAmbientLight.bind(this));
      this.servicesInUse.add(this.ambientLight);
    }

    if (config.exposeAutoSwitch) {
      this.autoSwitch = accessory.getServiceById(this.platform.Service.Switch, 'switch-auto') ||
        accessory.addService(this.platform.Service.Switch, autoSwitchName, 'switch-auto');
      this.autoSwitch.setCharacteristic(this.platform.Characteristic.Name, autoSwitchName);
      // TODO: Add handler for get/set ConfiguredName
      this.autoSwitch.setCharacteristic(this.platform.Characteristic.ConfiguredName, autoSwitchName);
      this.autoSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getAutoSwitchState.bind(this))
        .onSet(this.setAutoSwitchState.bind(this));
      this.servicesInUse.add(this.autoSwitch);
    }

    this.pruneUnusedServices();
  }

  private pruneUnusedServices(): void {
    this.accessory.services.forEach((service) => {
      if (this.servicesInUse.has(service)) {
        return;
      }

      this.debug('pruning unused service:', service.displayName);
      this.accessory.removeService(service);
    });
  }

  getFilterLifeLevel(): CharacteristicValue {
    const { filterMaxPeriod, filterReplaceDate } = this.accessory.context.device;
    const period = parseInt(filterMaxPeriod, 10);

    if (isNaN(period)) {
      this.debug('getFilterLifeLevel(): device.filterMaxPeriod is not a number:', period);
      // just assuming 100% life if filterMaxPeriod is not valid
      return 100;
    }

    // Ensure the date is in ISO 8601 format
    const isoDate = filterReplaceDate.replace(' ', 'T') + 'Z';
    const replaceDate = new Date(isoDate);
    const currentDate = new Date();

    // Total lifespan in milliseconds
    const totalLifespan = new Date(replaceDate);
    totalLifespan.setMonth(totalLifespan.getMonth() + period);

    const elapsedTime = currentDate.getTime() - replaceDate.getTime();
    const totalLifespanTime = totalLifespan.getTime() - replaceDate.getTime();
    const lifeUsed = Math.min(Math.max(elapsedTime / totalLifespanTime, 0), 1);
    const lifeLevel = Math.round((1 - lifeUsed) * 100);

    this.debug('getFilterLifeLevel()', lifeLevel);
    return lifeLevel;
  }

  getFilterChangeIndication(): CharacteristicValue {
    const filterLife = this.getFilterLifeLevel() as number;
    const replacementPercentage = this.config.filterReplacementIndicatorPercentage ?? DEFAULT_FILTER_LIFE_REPLACEMENT_PERCENTAGE;
    const shouldReplaceFilter = filterLife <= replacementPercentage ?
      this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER :
      this.platform.Characteristic.FilterChangeIndication.FILTER_OK;

    this.debug(
      'getFilterChangeIndication() filterLife:', filterLife,
      'replacementPercentage:', replacementPercentage,
      'shouldReplaceFilter:', shouldReplaceFilter,
    );

    return shouldReplaceFilter;
  }

  async getActiveState(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.power)) {
      this.debug('getActiveState() (cached)', this.latestStatus.power);
      return this.toActiveState(this.latestStatus.power!);
    }

    let power: Power;

    try {
      power = await WinixAPI.getPower(this.deviceId);
    } catch (e) {
      assertError(e);
      this.error('error getting active state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.power = power;
    this.polledWinix();

    this.debug('getActiveState()', power);
    return this.toActiveState(power);
  }

  async setActiveState(state: CharacteristicValue) {
    const power: Power = state === this.platform.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    this.debug(`setActiveState(${state})`, power);

    if (this.latestStatus.power === power) {
      this.debug('ignoring duplicate state set: active');
      return;
    }

    try {
      await WinixAPI.setPower(this.deviceId, power);
    } catch (e) {
      assertError(e);
      this.error('error setting active state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.power = power;
    this.sendHomekitUpdate();
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.power)) {
      this.debug('getCurrentState() (cached)', this.latestStatus.power);
      return this.toCurrentState(this.latestStatus.power!);
    }

    let power: Power;

    try {
      power = await WinixAPI.getPower(this.deviceId);
    } catch (e) {
      assertError(e);
      this.error('error getting current state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.power = power;
    this.polledWinix();

    this.debug('getCurrentState()', power);
    return this.toCurrentState(power);
  }

  async getAutoSwitchState(): Promise<CharacteristicValue> {
    const targetState = await this.getTargetState();
    this.debug('getAutoSwitchState() targetState', targetState);

    // Translate target state (auto/manual mode) to auto switch state
    const result = targetState === this.platform.Characteristic.TargetAirPurifierState.AUTO ?
      this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;

    this.debug('getAutoSwitchState() result', result);
    return result;
  }

  async setAutoSwitchState(state: CharacteristicValue) {
    // Translate auto switch state to target state (auto/manual mode)
    const proxyState: CharacteristicValue = state ?
      this.platform.Characteristic.TargetAirPurifierState.AUTO :
      this.platform.Characteristic.TargetAirPurifierState.MANUAL;

    this.debug(`setAutoSwitchState(${state}) proxyState`, proxyState);
    return this.setTargetState(proxyState);
  }

  async getTargetState(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.mode)) {
      this.debug('getTargetState() (cached)', this.latestStatus.mode);
      return this.toTargetState(this.latestStatus.mode!);
    }

    let mode: Mode;

    try {
      mode = await WinixAPI.getMode(this.deviceId);
    } catch (e) {
      assertError(e);
      this.error('error getting target state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.mode = mode;
    this.polledWinix();

    this.debug('getTargetState()', mode);
    return this.toTargetState(mode);
  }

  async setTargetState(state: CharacteristicValue) {
    const mode: Mode = state === this.platform.Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
    this.debug(`setTargetState(${state})`, mode);

    // Don't try to set the mode if we're already in this mode
    // Fixes issues with this being set right around the time of power on
    if (this.latestStatus.mode === mode) {
      this.debug('ignoring duplicate state set: target');
      return;
    }

    try {
      await WinixAPI.setMode(this.deviceId, mode);
    } catch (e) {
      assertError(e);
      this.error('error setting target state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.mode = mode;
    this.sendHomekitUpdate();

    if (mode === Mode.Manual) {
      return;
    }

    // If we're switching back to auto, the airflow speed will most likely change on the Winix device itself.
    // Pause, get the latest airflow speed, then send the update to Homekit
    this.debug('scheduling homekit update to rotation speed');

    setTimeout(async () => {
      await this.getRotationSpeed(true);
      this.sendHomekitUpdate();
    }, 2000);
  }

  async getRotationSpeed(force = false): Promise<CharacteristicValue> {
    if (!force && this.shouldUseCachedValue(this.latestStatus.airflow)) {
      this.debug('getRotationSpeed() (cached)', this.latestStatus.airflow);
      return this.toRotationSpeed(this.latestStatus.airflow!);
    }

    let airflow: Airflow;

    try {
      airflow = await WinixAPI.getAirflow(this.deviceId);
    } catch (e) {
      assertError(e);
      this.error('error getting rotation speed: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.airflow = airflow;
    this.polledWinix();

    this.debug('getRotationSpeed():', airflow);
    return this.toRotationSpeed(airflow);
  }

  async setRotationSpeed(state: CharacteristicValue) {
    const airflow: Airflow = this.toAirflow(state);
    this.debug(`setRotationSpeed(${state}):`, airflow);

    try {
      await WinixAPI.setAirflow(this.deviceId, airflow);
    } catch (e) {
      assertError(e);
      this.error('error setting rotation speed: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.airflow = airflow;
    this.latestStatus.mode = Mode.Manual;
    this.sendHomekitUpdate();
  }

  async getAirQuality(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.airQuality)) {
      this.debug('getAirQuality() (cached)', this.latestStatus.airQuality);
      return this.toAirQuality(this.latestStatus.airQuality!);
    }

    let airQuality: AirQuality;

    try {
      airQuality = await WinixAPI.getAirQuality(this.deviceId);
    } catch (e) {
      assertError(e);
      this.error('error getting air quality: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.airQuality = airQuality;
    this.polledWinix();

    this.debug('getAirQuality():', airQuality);
    return this.toAirQuality(airQuality);
  }

  async getPlasmawave(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.plasmawave)) {
      this.debug('getPlasmawave() (cached)', this.latestStatus.plasmawave);
      return this.toSwitch(this.latestStatus.plasmawave!);
    }

    let plasmawave: Plasmawave;

    try {
      plasmawave = await WinixAPI.getPlasmawave(this.deviceId);
    } catch (e) {
      assertError(e);
      this.error('error getting plasmawave state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.plasmawave = plasmawave;
    this.polledWinix();

    this.debug('getPlasmawave():', plasmawave);
    return this.toSwitch(plasmawave);
  }

  async setPlasmawave(state: CharacteristicValue) {
    const plasmawave: Plasmawave = this.toPlasmawave(state);
    this.debug(`setPlasmawave(${state}):`, plasmawave);

    try {
      await WinixAPI.setPlasmawave(this.deviceId, plasmawave);
    } catch (e) {
      assertError(e);
      this.error('error setting plasmawave state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.plasmawave = plasmawave;
    this.sendHomekitUpdate();
  }

  async getAmbientLight(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.ambientLight)) {
      this.debug('getAmbientLight() (cached)', this.latestStatus.ambientLight);
      return this.latestStatus.ambientLight!;
    }

    let ambientLight: number;

    try {
      ambientLight = await WinixAPI.getAmbientLight(this.deviceId);
    } catch (e) {
      assertError(e);
      this.error('error getting ambient light: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    // Fix ambient light value under 0.0001 warning
    ambientLight = Math.max(ambientLight, MIN_AMBIENT_LIGHT);
    this.latestStatus.ambientLight = ambientLight;
    this.polledWinix();

    this.debug('getAmbientLight():', ambientLight);
    return ambientLight;
  }

  private sendHomekitUpdate(): void {
    this.debug('sendHomekitUpdate()');

    if (this.latestStatus.power !== undefined) {
      this.purifier.updateCharacteristic(this.platform.Characteristic.Active, this.toActiveState(this.latestStatus.power));
      this.purifier.updateCharacteristic(this.platform.Characteristic.CurrentAirPurifierState, this.toCurrentState(this.latestStatus.power));
    }

    if (this.latestStatus.mode !== undefined) {
      this.purifier.updateCharacteristic(this.platform.Characteristic.TargetAirPurifierState, this.toTargetState(this.latestStatus.mode));
    }

    if (this.latestStatus.airflow !== undefined) {
      this.purifier.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.toRotationSpeed(this.latestStatus.airflow));
    }

    if (this.airQuality !== undefined && this.latestStatus.airQuality !== undefined) {
      this.airQuality?.updateCharacteristic(this.platform.Characteristic.AirQuality, this.toAirQuality(this.latestStatus.airQuality));
    }

    if (this.plasmawave !== undefined && this.latestStatus.plasmawave !== undefined) {
      this.plasmawave?.updateCharacteristic(this.platform.Characteristic.On, this.toSwitch(this.latestStatus.plasmawave));
    }

    if (this.ambientLight !== undefined && this.latestStatus.ambientLight !== undefined) {
      this.ambientLight?.updateCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel, this.latestStatus.ambientLight);
    }

    if (this.autoSwitch !== undefined && this.latestStatus.mode !== undefined) {
      this.autoSwitch?.updateCharacteristic(
        this.platform.Characteristic.On,
        this.toTargetState(this.latestStatus.mode) === this.platform.Characteristic.TargetAirPurifierState.AUTO,
      );
    }
  }

  private toActiveState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return this.platform.Characteristic.Active.ACTIVE;
      case Power.Off:
        return this.platform.Characteristic.Active.INACTIVE;
    }
  }

  private toCurrentState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
      case Power.Off:
        return this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
    }
  }

  private toTargetState(mode: Mode): CharacteristicValue {
    switch (mode) {
      case Mode.Auto:
        return this.platform.Characteristic.TargetAirPurifierState.AUTO;
      case Mode.Manual:
        return this.platform.Characteristic.TargetAirPurifierState.MANUAL;
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
    this.debug(`toAirflow(${state}): ${nearestState}`);

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
        return this.platform.Characteristic.AirQuality.GOOD;
      case AirQuality.Fair:
        return this.platform.Characteristic.AirQuality.FAIR;
      case AirQuality.Poor:
        return this.platform.Characteristic.AirQuality.POOR;
      default:
        return this.platform.Characteristic.AirQuality.UNKNOWN;
    }
  }

  private shouldUseCachedValue(v?: unknown): boolean {
    return v !== undefined && Date.now() - this.lastWinixPoll < this.cacheIntervalMs;
  }

  private polledWinix() {
    this.lastWinixPoll = Date.now();
  }

  private toSwitch(plasmawave: Plasmawave): CharacteristicValue {
    return plasmawave === Plasmawave.On;
  }

  private toPlasmawave(state: CharacteristicValue): Plasmawave {
    return state ? Plasmawave.On : Plasmawave.Off;
  }

  private getDeviceLogPrefix(): string {
    return `[${this.platform.logName(this.accessory.context.device)}] `;
  }

  private debug(message: string, ...parameters: unknown[]): void {
    this.log.debug(this.getDeviceLogPrefix() + message, ...parameters);
  }

  private error(message: string, ...parameters: unknown[]): void {
    this.log.error(this.getDeviceLogPrefix() + message, ...parameters);
  }
}
