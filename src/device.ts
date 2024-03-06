import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI } from 'winix-api';
import { DeviceLogger } from './logger';
import AsyncLock from 'async-lock';

export interface DeviceState extends DeviceStatus {
}

/**
 * Abstract class for interacting with a Winix device
 */
export abstract class Device {

  protected state: DeviceState;
  protected lastWinixPoll = -1;

  protected constructor(
    protected readonly deviceId: string,
    protected readonly log: DeviceLogger,
  ) {
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

  protected abstract ensureUpdated(): Promise<void>;

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
      this.log.debug('device:setPower(%s)', value, '(no change)');
      return;
    }

    this.log.debug('device:setPower()', initialPower, value);
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
      this.log.debug('device:setMode(%s)', value, '(no change)');
      return;
    }

    this.log.debug('device:setMode(%s)', value);
    await WinixAPI.setMode(this.deviceId, value);
    this.state.mode = value;
    // default to low airflow when switching modes
    this.state.airflow = Airflow.Low;
  }

  async setAirflow(value: Airflow): Promise<void> {
    this.log.debug('device:setAirflow(%s)', value);
    // Device must be on and in manual mode to set airflow
    await this.ensureOn();
    await this.setMode(Mode.Manual);
    await WinixAPI.setAirflow(this.deviceId, value);
    this.state.airflow = value;
  }

  async setPlasmawave(value: Plasmawave): Promise<void> {
    this.log.debug('device:setPlasmawave()', value);
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
    this.log.debug('device:update()');
    const newState = await WinixAPI.getDeviceStatus(this.deviceId);
    Object.assign(this.state, newState);
    this.log.debug('device:update()', JSON.stringify(this.state));
    this.lastWinixPoll = Date.now();
  }

  /**
   * Ensures the device is on, returning true if it was turned on
   */
  private async ensureOn(): Promise<boolean> {
    if (await this.getPower() === Power.On) {
      this.log.debug('device:ensureOn()', 'already on');
      return false;
    }

    this.log.debug('device:ensureOn()');
    await this.setPower(Power.On);
    return true;
  }
}

/**
 * Implementation of Device that updates on a regular interval
 */
export class UpdateIntervalDevice extends Device {

  constructor(
    readonly deviceId: string,
    readonly log: DeviceLogger,
    readonly updateIntervalMs: number,
  ) {
    super(deviceId, log);
    setInterval(async () => await this.update(), updateIntervalMs);
  }

  protected async ensureUpdated(): Promise<void> {
    // do nothing, since updating is handled by the interval
  }
}

/**
 * Implementation of Device that caches the state for a period of time
 */
export class CachedDevice extends Device {

  private lock: AsyncLock;

  constructor(
    readonly deviceId: string,
    readonly log: DeviceLogger,
    private readonly cacheIntervalMs: number,
  ) {
    super(deviceId, log);
    this.lock = new AsyncLock({ timeout: 3000 });
  }

  protected async ensureUpdated(): Promise<void> {
    // Use a lock to ensure only one update is running at a time
    await this.lock.acquire('ensureUpdated', async () => {
      if (this.shouldUpdate()) {
        await this.update();
      }
    });
  }

  private shouldUpdate(): boolean {
    return Date.now() - this.lastWinixPoll > this.cacheIntervalMs;
  }
}
