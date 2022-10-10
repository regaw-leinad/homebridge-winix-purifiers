import { AccessoryConfig, AccessoryPlugin, API, CharacteristicValue, HAP, Logging, Service } from 'homebridge';
import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI } from './winix';

const winix = new WinixAPI();

export class WinixPurifierAccessory implements AccessoryPlugin {

  private readonly hap: HAP;
  private readonly log: Logging;

  private readonly deviceId: string;
  private readonly latestStatus: DeviceStatus;

  private readonly services: Service[];
  private readonly purifier: Service;
  private readonly airQuality?: Service;
  private readonly plasmawave?: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.hap = api.hap;
    this.log = log;

    const deviceName = config.name;
    this.deviceId = config.deviceId;
    this.latestStatus = {
      power: Power.Off,
      mode: Mode.Auto,
      airflow: Airflow.Low,
      airQuality: AirQuality.Good,
      plasmawave: Plasmawave.On,
    };
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
      .setCharacteristic(this.hap.Characteristic.Model, config.model);

    this.airQuality?.getCharacteristic(this.hap.Characteristic.AirQuality)
      .onGet(this.getAirQuality.bind(this));

    this.plasmawave?.getCharacteristic(this.hap.Characteristic.On)
      .onGet(this.getPlasmawave.bind(this))
      .onSet(this.setPlasmawave.bind(this));
  }

  async getActiveState(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    this.latestStatus.power = power;

    this.log.debug('getActiveState()', power);
    return power === Power.On ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE;
  }

  async setActiveState(state: CharacteristicValue) {
    const power: Power = state === this.hap.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    this.log.debug(`setActiveState(${state})`, power);

    await winix.setPower(this.deviceId, power);
    this.latestStatus.power = power;
    this.sendHomekitUpdate();
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    this.latestStatus.power = power;

    this.log.debug('getCurrentState()', power);
    return power === Power.On ? this.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR :
      this.hap.Characteristic.CurrentAirPurifierState.INACTIVE;
  }

  async getTargetState(): Promise<CharacteristicValue> {
    const mode: Mode = await winix.getMode(this.deviceId);
    this.latestStatus.mode = mode;

    this.log.debug('getTargetState()', mode);
    return mode === Mode.Auto ? this.hap.Characteristic.TargetAirPurifierState.AUTO :
      this.hap.Characteristic.TargetAirPurifierState.MANUAL;
  }

  async setTargetState(state: CharacteristicValue) {
    const mode: Mode = state === this.hap.Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
    this.log.debug(`setTargetState(${state})`, mode);

    // Don't try to set the mode if we're already in this mode
    // Fixes issues with this being set right around the time of power on
    if (this.latestStatus.mode === mode) {
      this.log.debug('ignoring mode set: latestStatus.mode === mode');
      return;
    }

    await winix.setMode(this.deviceId, mode);
    this.latestStatus.mode = mode;
    this.sendHomekitUpdate();

    if (mode === Mode.Manual) {
      return;
    }

    // If we're switching back to auto, the airflow speed will most likely change on the Winix device itself.
    // Pause, get the latest airflow speed, then send the update to Homekit
    this.log.debug('scheduling homekit update to rotation speed');

    setTimeout(async () => {
      await this.getRotationSpeed();
      this.sendHomekitUpdate();
    }, 2000);
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    const airflow: Airflow = await winix.getAirflow(this.deviceId);
    this.latestStatus.airflow = airflow;

    this.log.debug('getRotationSpeed()', airflow);
    return this.toRotationSpeed(airflow);
  }

  async setRotationSpeed(state: CharacteristicValue) {
    const airflow: Airflow = this.toAirflow(state);
    this.log.debug(`setRotationSpeed(${state})`, airflow);

    await winix.setAirflow(this.deviceId, airflow);
    this.latestStatus.airflow = airflow;
    this.latestStatus.mode = Mode.Manual;
    this.sendHomekitUpdate();
  }

  async getAirQuality(): Promise<CharacteristicValue> {
    const airQuality: AirQuality = await winix.getAirQuality(this.deviceId);
    this.latestStatus.airQuality = airQuality;

    this.log.debug('getAirQuality()', airQuality);
    return this.toAirQuality(airQuality);
  }

  async getPlasmawave(): Promise<CharacteristicValue> {
    const plasmawave: Plasmawave = await winix.getPlasmawave(this.deviceId);
    this.latestStatus.plasmawave = plasmawave;

    this.log.debug('getPlasmawave()', plasmawave);
    return this.toSwitch(plasmawave);
  }

  async setPlasmawave(state: CharacteristicValue) {
    const plasmawave: Plasmawave = this.toPlasmawave(state);
    this.log.debug(`setPlasmawave(${state})`, plasmawave);

    await winix.setPlasmawave(this.deviceId, plasmawave);
    this.latestStatus.plasmawave = plasmawave;
    this.sendHomekitUpdate();
  }

  private sendHomekitUpdate(): void {
    this.log.debug('sendHomekitUpdate()');

    this.purifier.updateCharacteristic(this.hap.Characteristic.Active, this.toActiveState(this.latestStatus.power));
    this.purifier.updateCharacteristic(this.hap.Characteristic.CurrentAirPurifierState, this.toCurrentState(this.latestStatus.power));
    this.purifier.updateCharacteristic(this.hap.Characteristic.TargetAirPurifierState, this.toTargetState(this.latestStatus.mode));
    this.purifier.updateCharacteristic(this.hap.Characteristic.RotationSpeed, this.toRotationSpeed(this.latestStatus.airflow));
    this.airQuality?.updateCharacteristic(this.hap.Characteristic.AirQuality, this.toAirQuality(this.latestStatus.airQuality));
    this.plasmawave?.updateCharacteristic(this.hap.Characteristic.On, this.toSwitch(this.latestStatus.plasmawave));
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
    if (state > 75) {
      return Airflow.Turbo;
    } else if (state > 50) {
      return Airflow.High;
    } else if (state > 25) {
      return Airflow.Medium;
    } else if (state > 0) {
      return Airflow.Low;
    }

    return Airflow.Sleep;
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

