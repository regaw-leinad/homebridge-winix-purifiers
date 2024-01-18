import { CharacteristicValue, HAPStatus, Logger, PlatformAccessory, Service } from 'homebridge';
import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI, WinixDevice } from 'winix-api';
import { WinixPurifierPlatform } from './platform';
import { WinixPlatformConfig } from './config';

const MIN_AMBIENT_LIGHT = 0.0001;

export class WinixPurifierAccessory {

  private readonly deviceId: string;
  private readonly latestStatus: DeviceStatus;
  private readonly cacheIntervalMs: number;
  private lastWinixPoll: number;

  private readonly purifier: Service;
  private readonly airQuality?: Service;
  private readonly plasmawave?: Service;
  private readonly ambientLight?: Service;
  private readonly autoSwitch?: Service;

  constructor(
    private readonly log: Logger,
    private readonly platform: WinixPurifierPlatform,
    readonly config: WinixPlatformConfig,
    readonly accessory: PlatformAccessory,
  ) {
    const device: WinixDevice = accessory.context.device;

    const deviceName = device.deviceAlias;
    this.deviceId = device.deviceId;
    this.latestStatus = {};
    this.cacheIntervalMs = config.cacheIntervalSeconds! * 1000 || 60_000;
    this.lastWinixPoll = -1;

    // Create services
    this.purifier = accessory.getService(this.platform.Service.AirPurifier) ||
      accessory.addService(this.platform.Service.AirPurifier, deviceName);

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

    if (config.exposeAirQuality) {
      this.airQuality = accessory.getServiceById(this.platform.Service.AirQualitySensor, 'air-quality-sensor') ||
        accessory.addService(this.platform.Service.AirQualitySensor, 'Air Quality', 'air-quality-sensor');
      this.airQuality.setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Air Quality');
      this.airQuality.getCharacteristic(this.platform.Characteristic.AirQuality)
        .onGet(this.getAirQuality.bind(this));
    }

    if (config.exposePlasmawave) {
      this.plasmawave = accessory.getServiceById(this.platform.Service.Switch, 'switch-plasmawave') ||
        accessory.addService(this.platform.Service.Switch, 'Plasmawave', 'switch-plasmawave');
      this.plasmawave.setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Plasmawave');
      this.plasmawave.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getPlasmawave.bind(this))
        .onSet(this.setPlasmawave.bind(this));
    }

    if (config.exposeAmbientLight) {
      this.ambientLight = accessory.getServiceById(this.platform.Service.LightSensor, 'light-sensor-ambient') ||
        accessory.addService(this.platform.Service.LightSensor, 'Ambient Light', 'light-sensor-ambient');
      this.ambientLight.setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Ambient Light');
      this.ambientLight.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .onGet(this.getAmbientLight.bind(this));
    }

    if (config.exposeAutoSwitch) {
      this.autoSwitch = accessory.getServiceById(this.platform.Service.Switch, 'switch-auto') ||
        accessory.addService(this.platform.Service.Switch, 'Auto Mode', 'switch-auto');
      this.autoSwitch.setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Auto Mode');
      this.autoSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getAutoSwitchState.bind(this))
        .onSet(this.setAutoSwitchState.bind(this));
    }

    const purifierInfo: Service = accessory.getService(this.platform.Service.AccessoryInformation) ||
      accessory.addService(this.platform.Service.AccessoryInformation);

    purifierInfo
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Winix')
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, device.mcuVer)
      .setCharacteristic(this.platform.Characteristic.Model, device.modelName);
  }

  async getActiveState(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.power)) {
      this.log.debug('getActiveState() (cached)', this.latestStatus.power);
      return this.toActiveState(this.latestStatus.power!);
    }

    let power: Power;

    try {
      power = await WinixAPI.getPower(this.deviceId);
    } catch (e) {
      assertError(e);
      this.log.error('error getting active state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.power = power;
    this.polledWinix();

    this.log.debug('getActiveState()', power);
    return this.toActiveState(power);
  }

  async setActiveState(state: CharacteristicValue) {
    const power: Power = state === this.platform.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    this.log.debug(`setActiveState(${state})`, power);

    if (this.latestStatus.power === power) {
      this.log.debug('ignoring duplicate state set: active');
      return;
    }

    try {
      await WinixAPI.setPower(this.deviceId, power);
    } catch (e) {
      assertError(e);
      this.log.error('error setting active state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.power = power;
    this.sendHomekitUpdate();
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.power)) {
      this.log.debug('getCurrentState() (cached)', this.latestStatus.power);
      return this.toCurrentState(this.latestStatus.power!);
    }

    let power: Power;

    try {
      power = await WinixAPI.getPower(this.deviceId);
    } catch (e) {
      assertError(e);
      this.log.error('error getting current state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.power = power;
    this.polledWinix();

    this.log.debug('getCurrentState()', power);
    return this.toCurrentState(power);
  }

  async getAutoSwitchState(): Promise<CharacteristicValue> {
    const targetState = await this.getTargetState();
    this.log.debug('getAutoSwitchState() targetState', targetState);

    // Translate target state (auto/manual mode) to auto switch state
    const result = targetState === this.platform.Characteristic.TargetAirPurifierState.AUTO ?
      this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;

    this.log.debug('getAutoSwitchState() result', result);
    return result;
  }

  async setAutoSwitchState(state: CharacteristicValue) {
    // Translate auto switch state to target state (auto/manual mode)
    const proxyState: CharacteristicValue = state ?
      this.platform.Characteristic.TargetAirPurifierState.AUTO :
      this.platform.Characteristic.TargetAirPurifierState.MANUAL;

    this.log.debug(`setAutoSwitchState(${state}) proxyState`, proxyState);
    return this.setTargetState(proxyState);
  }

  async getTargetState(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.mode)) {
      this.log.debug('getTargetState() (cached)', this.latestStatus.mode);
      return this.toTargetState(this.latestStatus.mode!);
    }

    let mode: Mode;

    try {
      mode = await WinixAPI.getMode(this.deviceId);
    } catch (e) {
      assertError(e);
      this.log.error('error getting target state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.mode = mode;
    this.polledWinix();

    this.log.debug('getTargetState()', mode);
    return this.toTargetState(mode);
  }

  async setTargetState(state: CharacteristicValue) {
    const mode: Mode = state === this.platform.Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
    this.log.debug(`setTargetState(${state})`, mode);

    // Don't try to set the mode if we're already in this mode
    // Fixes issues with this being set right around the time of power on
    if (this.latestStatus.mode === mode) {
      this.log.debug('ignoring duplicate state set: target');
      return;
    }

    try {
      await WinixAPI.setMode(this.deviceId, mode);
    } catch (e) {
      assertError(e);
      this.log.error('error setting target state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.mode = mode;
    this.sendHomekitUpdate();

    if (mode === Mode.Manual) {
      return;
    }

    // If we're switching back to auto, the airflow speed will most likely change on the Winix device itself.
    // Pause, get the latest airflow speed, then send the update to Homekit
    this.log.debug('scheduling homekit update to rotation speed');

    setTimeout(async () => {
      await this.getRotationSpeed(true);
      this.sendHomekitUpdate();
    }, 2000);
  }

  async getRotationSpeed(force = false): Promise<CharacteristicValue> {
    if (!force && this.shouldUseCachedValue(this.latestStatus.airflow)) {
      this.log.debug('getRotationSpeed() (cached)', this.latestStatus.airflow);
      return this.toRotationSpeed(this.latestStatus.airflow!);
    }

    let airflow: Airflow;

    try {
      airflow = await WinixAPI.getAirflow(this.deviceId);
    } catch (e) {
      assertError(e);
      this.log.error('error getting rotation speed: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.airflow = airflow;
    this.polledWinix();

    this.log.debug('getRotationSpeed():', airflow);
    return this.toRotationSpeed(airflow);
  }

  async setRotationSpeed(state: CharacteristicValue) {
    const airflow: Airflow = this.toAirflow(state);
    this.log.debug(`setRotationSpeed(${state}):`, airflow);

    try {
      await WinixAPI.setAirflow(this.deviceId, airflow);
    } catch (e) {
      assertError(e);
      this.log.error('error setting rotation speed: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.airflow = airflow;
    this.latestStatus.mode = Mode.Manual;
    this.sendHomekitUpdate();
  }

  async getAirQuality(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.airQuality)) {
      this.log.debug('getAirQuality() (cached)', this.latestStatus.airQuality);
      return this.toAirQuality(this.latestStatus.airQuality!);
    }

    let airQuality: AirQuality;

    try {
      airQuality = await WinixAPI.getAirQuality(this.deviceId);
    } catch (e) {
      assertError(e);
      this.log.error('error getting air quality: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.airQuality = airQuality;
    this.polledWinix();

    this.log.debug('getAirQuality():', airQuality);
    return this.toAirQuality(airQuality);
  }

  async getPlasmawave(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.plasmawave)) {
      this.log.debug('getPlasmawave() (cached)', this.latestStatus.plasmawave);
      return this.toSwitch(this.latestStatus.plasmawave!);
    }

    let plasmawave: Plasmawave;

    try {
      plasmawave = await WinixAPI.getPlasmawave(this.deviceId);
    } catch (e) {
      assertError(e);
      this.log.error('error getting plasmawave state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.plasmawave = plasmawave;
    this.polledWinix();

    this.log.debug('getPlasmawave():', plasmawave);
    return this.toSwitch(plasmawave);
  }

  async setPlasmawave(state: CharacteristicValue) {
    const plasmawave: Plasmawave = this.toPlasmawave(state);
    this.log.debug(`setPlasmawave(${state}):`, plasmawave);

    try {
      await WinixAPI.setPlasmawave(this.deviceId, plasmawave);
    } catch (e) {
      assertError(e);
      this.log.error('error setting plasmawave state: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.plasmawave = plasmawave;
    this.sendHomekitUpdate();
  }

  async getAmbientLight(): Promise<CharacteristicValue> {
    if (this.shouldUseCachedValue(this.latestStatus.ambientLight)) {
      this.log.debug('getAmbientLight() (cached)', this.latestStatus.ambientLight);
      return this.latestStatus.ambientLight!;
    }

    let ambientLight: number;

    try {
      ambientLight = await WinixAPI.getAmbientLight(this.deviceId);
    } catch (e) {
      assertError(e);
      this.log.error('error getting ambient light: ' + e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    // Fix ambient light value under 0.0001 warning
    ambientLight = Math.max(ambientLight, MIN_AMBIENT_LIGHT);
    this.latestStatus.ambientLight = ambientLight;
    this.polledWinix();

    this.log.debug('getAmbientLight():', ambientLight);
    return ambientLight;
  }

  private sendHomekitUpdate(): void {
    this.log.debug('sendHomekitUpdate()');

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
}

function assertError(error: unknown): asserts error is Error {
  if (!(error instanceof Error)) {
    throw error;
  }
}
