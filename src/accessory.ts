import { AccessoryConfig, AccessoryPlugin, API, CharacteristicValue, HAP, HAPStatus, Logging, Nullable, Service } from 'homebridge';
import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI } from 'winix-api';

const MIN_AMBIENT_LIGHT = 0.0001;

export class WinixPurifierAccessory implements AccessoryPlugin {

  private readonly hap: HAP;
  private readonly log: Logging;

  private readonly deviceId: string;
  private readonly latestStatus: DeviceStatus;
  private readonly cacheIntervalMs: number;
  private lastWinixPoll: number;

  private readonly services: Service[];
  private readonly purifier: Service;
  private readonly airQuality?: Service;
  private readonly plasmawave?: Service;
  private readonly ambientLight?: Service;
  private readonly autoSwitch?: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.hap = api.hap;
    this.log = log;

    const deviceName = config.name;
    this.deviceId = config.deviceId;
    this.latestStatus = {};
    this.cacheIntervalMs = config.cacheIntervalSeconds * 1000 || 60_000;
    this.lastWinixPoll = -1;
    this.services = [];

    // Create services
    this.purifier = this.registerService(new this.hap.Service.AirPurifier(deviceName));
    const purifierInfo: Service = this.registerService(new this.hap.Service.AccessoryInformation());

    if (config.exposeAirQuality) {
      this.airQuality = this.registerService(new this.hap.Service.AirQualitySensor(`${deviceName} Air Quality`));
    }

    if (config.exposePlasmawave) {
      this.plasmawave = this.registerService(new this.hap.Service.Switch(`${deviceName} Plasmawave`));
    }

    if (config.exposeAmbientLight) {
      this.ambientLight = this.registerService(new this.hap.Service.LightSensor(`${deviceName} Ambient Light`));
    }

    if (config.exposeAutoSwitch) {
      this.autoSwitch = this.registerService(new this.hap.Service.Switch(`${deviceName} Auto Mode`));
    }

    // Assign characteristics
    this.purifier.getCharacteristic(this.hap.Characteristic.Active)
      .onGet(this.getActiveState.bind(this))
      .onSet(this.setActiveState.bind(this));
    this.purifier.getCharacteristic(this.hap.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentState.bind(this));
    this.purifier.getCharacteristic(this.hap.Characteristic.TargetAirPurifierState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));
    this.purifier.getCharacteristic(this.hap.Characteristic.RotationSpeed)
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));

    purifierInfo
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Winix')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, config.serialNumber)
      .setCharacteristic(this.hap.Characteristic.Model, config.model);

    this.airQuality?.getCharacteristic(this.hap.Characteristic.AirQuality)
      .onGet(this.getAirQuality.bind(this));

    this.plasmawave?.getCharacteristic(this.hap.Characteristic.On)
      .onGet(this.getPlasmawave.bind(this))
      .onSet(this.setPlasmawave.bind(this));

    this.ambientLight?.getCharacteristic(this.hap.Characteristic.CurrentAmbientLightLevel)
      .onGet(this.getAmbientLight.bind(this));

    this.autoSwitch?.getCharacteristic(this.hap.Characteristic.On)
      .onGet(this.getAutoSwitchState.bind(this))
      .onSet(this.setAutoSwitchState.bind(this));
  }

  async getActiveState(): Promise<Nullable<CharacteristicValue>> {
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.power = power;
    this.polledWinix();

    this.log.debug('getActiveState()', power);
    return this.toActiveState(power);
  }

  async setActiveState(state: CharacteristicValue) {
    const power: Power = state === this.hap.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
    const result = targetState === this.hap.Characteristic.TargetAirPurifierState.AUTO ?
      this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE;

    this.log.debug('getAutoSwitchState() result', result);
    return result;
  }

  async setAutoSwitchState(state: CharacteristicValue) {
    // Translate auto switch state to target state (auto/manual mode)
    const proxyState: CharacteristicValue = state ?
      this.hap.Characteristic.TargetAirPurifierState.AUTO :
      this.hap.Characteristic.TargetAirPurifierState.MANUAL;

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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.latestStatus.mode = mode;
    this.polledWinix();

    this.log.debug('getTargetState()', mode);
    return this.toTargetState(mode);
  }

  async setTargetState(state: CharacteristicValue) {
    const mode: Mode = state === this.hap.Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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

  async getRotationSpeed(force = true): Promise<CharacteristicValue> {
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      throw new this.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
      this.purifier.updateCharacteristic(this.hap.Characteristic.Active, this.toActiveState(this.latestStatus.power));
      this.purifier.updateCharacteristic(this.hap.Characteristic.CurrentAirPurifierState, this.toCurrentState(this.latestStatus.power));
    }

    if (this.latestStatus.mode !== undefined) {
      this.purifier.updateCharacteristic(this.hap.Characteristic.TargetAirPurifierState, this.toTargetState(this.latestStatus.mode));
    }

    if (this.latestStatus.airflow !== undefined) {
      this.purifier.updateCharacteristic(this.hap.Characteristic.RotationSpeed, this.toRotationSpeed(this.latestStatus.airflow));
    }

    if (this.airQuality !== undefined && this.latestStatus.airQuality !== undefined) {
      this.airQuality?.updateCharacteristic(this.hap.Characteristic.AirQuality, this.toAirQuality(this.latestStatus.airQuality));
    }

    if (this.plasmawave !== undefined && this.latestStatus.plasmawave !== undefined) {
      this.plasmawave?.updateCharacteristic(this.hap.Characteristic.On, this.toSwitch(this.latestStatus.plasmawave));
    }

    if (this.ambientLight !== undefined && this.latestStatus.ambientLight !== undefined) {
      this.ambientLight?.updateCharacteristic(this.hap.Characteristic.CurrentAmbientLightLevel, this.latestStatus.ambientLight);
    }

    if (this.autoSwitch !== undefined && this.latestStatus.mode !== undefined) {
      this.autoSwitch?.updateCharacteristic(
        this.hap.Characteristic.On,
        this.toTargetState(this.latestStatus.mode) === this.hap.Characteristic.TargetAirPurifierState.AUTO,
      );
    }
  }

  private toActiveState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return this.hap.Characteristic.Active.ACTIVE;
      case Power.Off:
        return this.hap.Characteristic.Active.INACTIVE;
    }
  }

  private toCurrentState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return this.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
      case Power.Off:
        return this.hap.Characteristic.CurrentAirPurifierState.INACTIVE;
    }
  }

  private toTargetState(mode: Mode): CharacteristicValue {
    switch (mode) {
      case Mode.Auto:
        return this.hap.Characteristic.TargetAirPurifierState.AUTO;
      case Mode.Manual:
        return this.hap.Characteristic.TargetAirPurifierState.MANUAL;
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
        return this.hap.Characteristic.AirQuality.GOOD;
      case AirQuality.Fair:
        return this.hap.Characteristic.AirQuality.FAIR;
      case AirQuality.Poor:
        return this.hap.Characteristic.AirQuality.POOR;
      default:
        return this.hap.Characteristic.AirQuality.UNKNOWN;
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

  private registerService(service: Service): Service {
    this.services.push(service);
    return service;
  }

  getServices(): Service[] {
    return this.services;
  }
}

function assertError(error: unknown): asserts error is Error {
  if (!(error instanceof Error)) {
    throw error;
  }
}
