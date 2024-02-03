import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI } from 'winix-api';
import { DeviceLogger } from './logger';
import AsyncLock from 'async-lock';

export interface DeviceState extends DeviceStatus {
}

export class Device {

  private readonly lock: AsyncLock;
  private state: DeviceState;
  private lastWinixPoll = -1;

  constructor(
    private readonly deviceId: string,
    private readonly cacheIntervalMs: number,
    private readonly log: DeviceLogger,
  ) {
    this.lock = new AsyncLock({ timeout: 3000 });
    this.state = {
      power: Power.Off,
      mode: Mode.Auto,
      airflow: Airflow.Low,
      airQuality: AirQuality.Good,
      plasmawave: Plasmawave.Off,
      ambientLight: 0,
      filterHours: 0,
    };
  }

  hasData(): boolean {
    return this.lastWinixPoll > -1;
  }

  async getPower(): Promise<Power> {
    await this.ensureUpdated();
    return this.state.power;
  }

  async getMode(): Promise<Mode> {
    await this.ensureUpdated();
    return this.state.mode;
  }

  async getAirflow(): Promise<Airflow> {
    await this.ensureUpdated();
    return this.state.airflow;
  }

  async getAirQuality(): Promise<AirQuality> {
    await this.ensureUpdated();
    return this.state.airQuality;
  }

  async getPlasmawave(): Promise<Plasmawave> {
    await this.ensureUpdated();
    return this.state.plasmawave;
  }

  async getAmbientLight(): Promise<number> {
    await this.ensureUpdated();
    return this.state.ambientLight;
  }

  async getFilterHours(): Promise<number> {
    await this.ensureUpdated();
    return this.state.filterHours;
  }

  async setPower(value: Power): Promise<void> {
    const initialPower = await this.getPower();
    if (initialPower === value) {
      this.log.debug('setPower(%s)', value, '(no change)');
      return;
    }

    this.log.debug('setPower()', initialPower, value);
    await WinixAPI.setPower(this.deviceId, value);
    this.state.power = value;

    // default to auto mode when turning on from off
    if (initialPower === Power.Off && value === Power.On) {
      this.state.mode = Mode.Auto;
    }
  }

  async setMode(value: Mode): Promise<void> {
    const turnedOn = await this.ensureOn();

    // Don't try to set the mode if it's already set to the same value
    // Fixes issues with this being set right around the time of power on
    if (!turnedOn && value === await this.getMode()) {
      this.log.debug('setMode(%s)', value, '(no change)');
      return;
    }

    this.log.debug('setMode(%s)', value);
    await WinixAPI.setMode(this.deviceId, value);
    this.state.mode = value;
    // default to low airflow when switching modes
    this.state.airflow = Airflow.Low;
  }

  async setAirflow(value: Airflow): Promise<void> {
    this.log.debug('setAirflow(%s)', value);
    // Device must be on and in manual mode to set airflow
    await this.ensureOn();
    await this.setMode(Mode.Manual);
    await WinixAPI.setAirflow(this.deviceId, value);
    this.state.airflow = value;
  }

  async setPlasmawave(value: Plasmawave): Promise<void> {
    this.log.debug('setPlasmawave()', value);
    await this.ensureOn();
    await WinixAPI.setPlasmawave(this.deviceId, value);
    this.state.plasmawave = value;
  }

  async getState(): Promise<DeviceState> {
    await this.ensureUpdated();
    return {
      power: this.state.power,
      mode: this.state.mode,
      airflow: this.state.airflow,
      airQuality: this.state.airQuality,
      plasmawave: this.state.plasmawave,
      ambientLight: this.state.ambientLight,
      filterHours: this.state.filterHours,
    };
  }

  async update(): Promise<void> {
    this.log.debug('update()');
    this.state = await WinixAPI.getDeviceStatus(this.deviceId);
    this.log.debug('update()', JSON.stringify(this.state));
    this.lastWinixPoll = Date.now();
  }

  private async ensureUpdated(): Promise<void> {
    // Use a lock to ensure only one update is running at a time
    await this.lock.acquire('update', async () => {
      if (this.shouldUpdate()) {
        await this.update();
      }
    });
  }

  private shouldUpdate(): boolean {
    return Date.now() - this.lastWinixPoll > this.cacheIntervalMs;
  }

  private async ensureOn(): Promise<boolean> {
    if (await this.getPower() === Power.On) {
      this.log.debug('ensureOn()', 'already on');
      return false;
    }

    this.log.debug('ensureOn()');
    await this.setPower(Power.On);
    return true;
  }
}
