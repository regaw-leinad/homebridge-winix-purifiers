export enum Power {
  Off = '0',
  On = '1'
}

export enum Mode {
  Auto = '01',
  Manual = '02'
}

export enum Airflow {
  Low = '01',
  Medium = '02',
  High = '03',
  Turbo = '05',
  Sleep = '06'
}

export enum AirQuality {
  Good = '01',
  Fair = '02',
  Poor = '03'
}

export interface DeviceStatus {
  power: Power;
  mode: Mode;
  airflow: Airflow;
  airQuality: AirQuality;
}
