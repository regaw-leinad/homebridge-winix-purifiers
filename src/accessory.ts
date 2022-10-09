import { AccessoryConfig, AccessoryPlugin, API, CharacteristicValue, HAP, Logging, Service } from 'homebridge';
import { Mode, Power, WinixAPI } from './winix';

const winix = new WinixAPI();

export class WinixPurifierAccessory implements AccessoryPlugin {

  private readonly hap: HAP;
  private readonly log: Logging;

  private readonly deviceName: string;
  private readonly model: string;
  private readonly deviceId: string;
  private readonly showAirQuality: boolean;

  private readonly purifier: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.hap = api.hap;
    this.log = log;

    this.deviceName = config.name;
    this.deviceId = config.deviceId;
    this.model = config.model;
    this.showAirQuality = config.showAirQuality;

    this.purifier = new this.hap.Service.AirPurifier(this.deviceName);
    this.purifier.getCharacteristic(this.hap.Characteristic.Active)
      .onGet(this.getPower.bind(this))
      .onSet(this.setPower.bind(this));

    this.purifier.getCharacteristic(this.hap.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentState.bind(this));

    this.purifier.getCharacteristic(this.hap.Characteristic.TargetAirPurifierState)
      .onGet(this.getMode.bind(this))
      .onSet(this.setMode.bind(this));
  }

  async getPower(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    return power === Power.On ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE;
  }

  async setPower(state: CharacteristicValue) {
    const power: Power = state === this.hap.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    await winix.setPower(this.deviceId, power);

    // TODO: refactor out a way to force a status update
    this.purifier.updateCharacteristic(this.hap.Characteristic.Active, state);
    // This one is necessary to force the UI to update? weird
    this.purifier.updateCharacteristic(this.hap.Characteristic.CurrentAirPurifierState, this.toCurrentState(power));
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    return power === Power.On ? this.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR :
      this.hap.Characteristic.CurrentAirPurifierState.INACTIVE;
  }

  async getMode(): Promise<CharacteristicValue> {
    const mode: Mode = await winix.getMode(this.deviceId);
    return mode === Mode.Auto ? this.hap.Characteristic.TargetAirPurifierState.AUTO :
      this.hap.Characteristic.TargetAirPurifierState.MANUAL;
  }

  async setMode(state: CharacteristicValue) {
    const mode: Mode = state === this.hap.Characteristic.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual;
    await winix.setMode(this.deviceId, mode);
    this.purifier.updateCharacteristic(this.hap.Characteristic.TargetAirPurifierState, this.toTargetState(mode));
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

  getServices(): Service[] {
    return [this.purifier];
  }
}

