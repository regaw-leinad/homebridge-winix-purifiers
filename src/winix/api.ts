import { Airflow, AirQuality, DeviceStatus, Mode, Power } from './types';
import axios, { AxiosResponse } from 'axios';

interface StatusResponse {
  body: StatusBody;
}

interface StatusBody {
  data: StatusData[];
}

interface StatusData {
  attributes: StatusAttributes;
}

interface StatusAttributes {
  /**
   * Power
   */
  A02: string;
  /**
   * Mode
   */
  A03: string;
  /**
   * Airflow
   */
  A04: string;
  /**
   * Air Quality
   */
  S07: string;
}

enum Attribute { Power = 'A02', Mode = 'A03', Airflow = 'A04', AirQuality = 'S07' }

type AttributeValue = Power | Mode | Airflow | AirQuality;

export class WinixAPI {

  async getPower(deviceId: string): Promise<Power> {
    return await this.getDeviceAttribute(deviceId, Attribute.Power) as Power;
  }

  async setPower(deviceId: string, value: Power): Promise<Power> {
    return await this.setDeviceAttribute(deviceId, Attribute.Power, value) as Power;
  }

  async getMode(deviceId: string): Promise<Mode> {
    return await this.getDeviceAttribute(deviceId, Attribute.Mode) as Mode;
  }

  async setMode(deviceId: string, value: Mode): Promise<Mode> {
    return await this.setDeviceAttribute(deviceId, Attribute.Mode, value) as Mode;
  }

  async getAirflow(deviceId: string): Promise<Airflow> {
    return await this.getDeviceAttribute(deviceId, Attribute.Airflow) as Airflow;
  }

  async setAirflow(deviceId: string, value: Airflow): Promise<Airflow> {
    return await this.setDeviceAttribute(deviceId, Attribute.Airflow, value) as Airflow;
  }

  async getAirQuality(deviceId: string): Promise<AirQuality> {
    return await this.getDeviceAttribute(deviceId, Attribute.AirQuality) as AirQuality;
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    const attributes: StatusAttributes = await this.getDeviceStatusInternal(deviceId);
    return this.toDevice(attributes);
  }

  private async getDeviceStatusInternal(deviceId: string): Promise<StatusAttributes> {
    const url: string = this.getDeviceStatusUrl(deviceId);
    const result: AxiosResponse<StatusResponse> = await axios.get<StatusResponse>(url);
    return result.data.body.data[0].attributes;
  }

  private async getDeviceAttribute(deviceId: string, attribute: Attribute): Promise<AttributeValue> {
    const attributes: StatusAttributes = await this.getDeviceStatusInternal(deviceId);
    return attributes[attribute.toString()];
  }

  private async setDeviceAttribute(deviceId: string, attribute: Attribute, value: AttributeValue): Promise<AttributeValue> {
    const url: string = this.getSetAttributeUrl(deviceId, attribute, value);
    await axios.get(url);
    return value;
  }

  private getDeviceStatusUrl(deviceId: string): string {
    return `https://us.api.winix-iot.com/common/event/sttus/devices/${deviceId}`;
  }

  private getSetAttributeUrl(deviceId: string, attribute: Attribute, value: AttributeValue): string {
    return `https://us.api.winix-iot.com/common/control/devices/${deviceId}/A211/${attribute}:${value}`;
  }

  private toDevice(attributes: StatusAttributes): DeviceStatus {
    return {
      power: attributes[Attribute.Power] as Power,
      mode: attributes[Attribute.Mode] as Mode,
      airflow: attributes[Attribute.Airflow] as Airflow,
      airQuality: attributes[Attribute.AirQuality] as AirQuality,
    };
  }
}
