import { AccessoryConfig, AccessoryPlugin, API, CharacteristicValue, HAP, Logging, Service } from 'homebridge';
import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI } from './winix';

const winix = new WinixAPI();

export class WinixPurifierAccessory implements AccessoryPlugin {

  private readonly hap: HAP;
  private readonly log: Logging;

  private readonly deviceName: string;
  private readonly deviceId: string;
  private readonly deviceStatus: DeviceStatus;

  private readonly services: Service[];
  private readonly purifier: Service;
  private readonly airQuality?: Service;
  private readonly plasmawave?: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.hap = api.hap;
    this.log = log;

    this.deviceName = config.name;
    this.deviceId = config.deviceId;
    this.deviceStatus = {
      power: Power.Off,
      mode: Mode.Auto,
      airflow: Airflow.Low,
      airQuality: AirQuality.Good,
      plasmawave: Plasmawave.On,
    };
    this.services = [];

    // Main purifier
    this.purifier = new this.hap.Service.AirPurifier(this.deviceName);
    this.registerService(this.purifier);

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

    // Accessory information
    const purifierInfo: Service = new this.hap.Service.AccessoryInformation();
    this.registerService(purifierInfo);

    purifierInfo.setCharacteristic(this.hap.Characteristic.Manufacturer, 'Winix')
      .setCharacteristic(this.hap.Characteristic.Model, config.model);

    if (config.exposeAirQuality) {
      this.airQuality = new this.hap.Service.AirQualitySensor(`${this.deviceName} Air Quality`);
      this.registerService(this.airQuality);

      this.airQuality.getCharacteristic(this.hap.Characteristic.AirQuality)
        .onGet(this.getAirQuality.bind(this));
    }

    if (config.exposePlasmawave) {
      this.plasmawave = new this.hap.Service.Switch(`${this.deviceName} Plasmawave`);
      this.registerService(this.plasmawave);

      this.plasmawave.getCharacteristic(this.hap.Characteristic.On)
        .onGet(this.getPlasmawave.bind(this))
        .onSet(this.setPlasmawave.bind(this));
    }
  }

  async getActiveState(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    this.deviceStatus.power = power;

    this.log.debug('getActiveState()', power);
    return power === Power.On ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE;
  }

  async setActiveState(state: CharacteristicValue) {
    const power: Power = state === this.hap.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    this.log.debug(`setActiveState(${state})`, power);

    await winix.setPower(this.deviceId, power);
    this.deviceStatus.power = power;
    this.sendHomekitUpdate();
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    this.deviceStatus.power = power;

    this.log.debug('getCurrentState()', power);
    return power === Power.On ? this.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR :
      this.hap.Characteristic.CurrentAirPurifierState.INACTIVE;
  }

  async getTargetState(): Promise<CharacteristicValue> {
    const mode: Mode = await winix.getMode(this.deviceId);
    this.deviceStatus.mode = mode;

    this.log.debug('getTargetState()', mode);
    return mode === Mode.Auto ? this.hap.Characteristic.TargetAirPurifierState.AUTO :
      this.hap.Characteristic.TargetAirPurifierState.MANUAL;
  }

  async setTargetState(state: CharacteristicValue) {
    const mode: Mode = state === this.hap.Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
    this.log.debug(`setTargetState(${state})`, mode);

    await winix.setMode(this.deviceId, mode);
    this.deviceStatus.mode = mode;
    this.sendHomekitUpdate();

    if (mode === Mode.Manual) {
      return;
    }

    this.log.debug('scheduling update to rotation speed');

    setTimeout(async () => {
      await this.getRotationSpeed();
      this.sendHomekitUpdate();
    }, 2000);
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    const airflow: Airflow = await winix.getAirflow(this.deviceId);
    this.deviceStatus.airflow = airflow;

    this.log.debug('getRotationSpeed()', airflow);
    return this.toRotationSpeed(airflow);
  }

  async setRotationSpeed(state: CharacteristicValue) {
    const airflow: Airflow = this.toAirflow(state);
    this.log.debug(`setRotationSpeed(${state})`, airflow);

    await winix.setAirflow(this.deviceId, airflow);
    this.deviceStatus.airflow = airflow;
    this.deviceStatus.mode = Mode.Manual;
    this.sendHomekitUpdate();
  }

  async getAirQuality(): Promise<CharacteristicValue> {
    const airQuality: AirQuality = await winix.getAirQuality(this.deviceId);
    this.deviceStatus.airQuality = airQuality;

    this.log.debug('getAirQuality()', airQuality);
    return this.toAirQuality(airQuality);
  }

  async getPlasmawave(): Promise<CharacteristicValue> {
    const plasmawave: Plasmawave = await winix.getPlasmawave(this.deviceId);
    this.deviceStatus.plasmawave = plasmawave;

    this.log.debug('getPlasmawave()', plasmawave);
    return this.toSwitch(plasmawave);
  }

  async setPlasmawave(state: CharacteristicValue) {
    const plasmawave: Plasmawave = this.toPlasmawave(state);
    this.log.debug(`setPlasmawave(${state})`, plasmawave);

    await winix.setPlasmawave(this.deviceId, plasmawave);
    this.deviceStatus.plasmawave = plasmawave;
    this.sendHomekitUpdate();
  }

  private sendHomekitUpdate(): void {
    this.log.debug('sendHomekitUpdate()');

    this.purifier.updateCharacteristic(this.hap.Characteristic.Active, this.toActiveState(this.deviceStatus.power));
    this.purifier.updateCharacteristic(this.hap.Characteristic.CurrentAirPurifierState, this.toCurrentState(this.deviceStatus.power));
    this.purifier.updateCharacteristic(this.hap.Characteristic.TargetAirPurifierState, this.toTargetState(this.deviceStatus.mode));
    this.purifier.updateCharacteristic(this.hap.Characteristic.RotationSpeed, this.toRotationSpeed(this.deviceStatus.airflow));
    this.airQuality?.updateCharacteristic(this.hap.Characteristic.AirQuality, this.toAirQuality(this.deviceStatus.airQuality));
    this.plasmawave?.updateCharacteristic(this.hap.Characteristic.On, this.toSwitch(this.deviceStatus.plasmawave));
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

  private registerService(service: Service) {
    this.services.push(service);
  }

  getServices(): Service[] {
    return this.services;
  }
}

