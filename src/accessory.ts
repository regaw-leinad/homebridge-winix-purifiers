import { AccessoryConfig, AccessoryPlugin, API, CharacteristicValue, HAP, Logging, Service } from 'homebridge';
import { Power, WinixAPI } from './winix';

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
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.purifier.getCharacteristic(this.hap.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentState.bind(this));
  }

  async getActive(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    return power === Power.On ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE;
  }

  async setActive(value: CharacteristicValue) {
    const power: Power = value === this.hap.Characteristic.Active.ACTIVE ? Power.On : Power.Off;
    await winix.setPower(this.deviceId, power);

    // TODO: refactor out a way to force a status update
    this.purifier.updateCharacteristic(this.hap.Characteristic.Active, value);
    // This one is necessary to force the UI to update? weird
    this.purifier.updateCharacteristic(this.hap.Characteristic.CurrentAirPurifierState, this.toCurrentState(power));
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    const power: Power = await winix.getPower(this.deviceId);
    return power === Power.On ? this.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR :
      this.hap.Characteristic.CurrentAirPurifierState.INACTIVE;
  }

  private toCurrentState(power: Power): CharacteristicValue {
    switch (power) {
      case Power.On:
        return this.hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
      case Power.Off:
        return this.hap.Characteristic.CurrentAirPurifierState.INACTIVE;
    }
  }

  getServices(): Service[] {
    return [this.purifier];
  }
}

