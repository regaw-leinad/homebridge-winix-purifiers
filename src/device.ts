import { Airflow, AirQuality, DeviceStatus, Mode, Plasmawave, Power, WinixAPI } from 'winix-api';
import { DeviceLogger } from './logger';

export interface DeviceState extends DeviceStatus {
  // These fields are optional in DeviceStatus (model-dependent), but the plugin
  // always initializes them with defaults, and Object.assign only overwrites keys
  // present in the API response, so they are guaranteed to be defined here.
  airQuality: AirQuality;
  plasmawave: Plasmawave;
  ambientLight: number;
}

const MAX_BACKOFF_MS = 5 * 60 * 1000;
const COMMAND_DELAY_MS = 1500;
const UNREACHABLE_THRESHOLD = 3;

export class Device {

  private state: DeviceState;
  private hasReceivedData = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private onUpdate: (() => void) | null = null;

  constructor(
    private readonly deviceId: string,
    private readonly pollIntervalMs: number,
    private readonly log: DeviceLogger,
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

  hasData(): boolean {
    return this.hasReceivedData;
  }

  isReachable(): boolean {
    return this.hasReceivedData && this.consecutiveFailures < UNREACHABLE_THRESHOLD;
  }

  async initialFetch(): Promise<void> {
    try {
      this.log.debug('device:initialFetch()');
      const newState = await WinixAPI.getDeviceStatus(this.deviceId);
      Object.assign(this.state, newState);
      this.hasReceivedData = true;
      this.consecutiveFailures = 0;
      this.log.debug('device:initialFetch()', JSON.stringify(this.state));
    } catch (e: unknown) {
      this.log.warn('device:initialFetch() failed, using defaults:', (e as Error).message);
    }
  }

  startPolling(onUpdate: () => void): void {
    this.onUpdate = onUpdate;
    // Stagger the first poll with a random delay to avoid all devices
    // hitting the API at the same time
    const jitter = Math.floor(Math.random() * this.pollIntervalMs);
    this.schedulePoll(jitter);
  }

  resetPollTimer(delayMs = 3000): void {
    this.schedulePoll(delayMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // Getters - all synchronous, return from in-memory state

  getPower(): Power {
    return this.state.power;
  }

  getMode(): Mode {
    return this.state.mode;
  }

  getAirflow(): Airflow {
    return this.state.airflow;
  }

  getAirQuality(): AirQuality {
    return this.state.airQuality;
  }

  getPlasmawave(): Plasmawave {
    return this.state.plasmawave;
  }

  getAmbientLight(): number {
    return this.state.ambientLight;
  }

  getFilterHours(): number {
    return this.state.filterHours;
  }

  getState(): DeviceState {
    return { ...this.state };
  }

  // Setters - async, send commands to Winix API and update state optimistically

  async setPower(value: Power): Promise<void> {
    const initialPower = this.getPower();
    if (initialPower === value) {
      this.log.debug('device:setPower(%s)', value, '(no change)');
      return;
    }

    this.log.debug('device:setPower()', initialPower, value);
    await WinixAPI.setPower(this.deviceId, value);
    this.state.power = value;

    // Side effects observed from device testing
    if (value === Power.Off) {
      this.state.mode = Mode.Auto;
      this.state.plasmawave = Plasmawave.Off;
    }
    if (value === Power.On) {
      this.state.plasmawave = Plasmawave.On;
    }
  }

  async setMode(value: Mode): Promise<void> {
    const turnedOn = await this.ensureOn();

    if (!turnedOn && value === this.getMode()) {
      this.log.debug('device:setMode(%s)', value, '(no change)');
      return;
    }

    this.log.debug('device:setMode(%s)', value);
    await WinixAPI.setMode(this.deviceId, value);
    this.state.mode = value;

    // Side effects observed from device testing
    if (value === Mode.Auto) {
      this.state.airflow = Airflow.Low;
    }
  }

  async setAirflow(value: Airflow): Promise<void> {
    this.log.debug('device:setAirflow(%s)', value);
    await this.ensureOn();

    // Device auto-switches to manual when setting airflow, but we need
    // a delay between mode change and airflow command or the airflow
    // command gets dropped by the device
    if (this.state.mode !== Mode.Manual) {
      await this.setMode(Mode.Manual);
      await new Promise(r => setTimeout(r, COMMAND_DELAY_MS));
    }

    await WinixAPI.setAirflow(this.deviceId, value);
    this.state.airflow = value;

    // Side effects observed from device testing
    if (value === Airflow.Sleep) {
      this.state.plasmawave = Plasmawave.Off;
    }
  }

  async setPlasmawave(value: Plasmawave): Promise<void> {
    this.log.debug('device:setPlasmawave()', value);
    await this.ensureOn();
    await WinixAPI.setPlasmawave(this.deviceId, value);
    this.state.plasmawave = value;
  }

  // Private methods

  private schedulePoll(delayMs: number): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    try {
      this.log.debug('device:poll()');
      const newState = await WinixAPI.getDeviceStatus(this.deviceId);
      Object.assign(this.state, newState);
      this.hasReceivedData = true;
      this.consecutiveFailures = 0;
      this.log.debug('device:poll()', JSON.stringify(this.state));
      this.onUpdate?.();
    } catch (e: unknown) {
      this.consecutiveFailures++;
      const backoffMs = Math.min(
        this.pollIntervalMs * Math.pow(2, this.consecutiveFailures),
        MAX_BACKOFF_MS,
      );
      this.log.error(`device:poll() error: ${(e as Error).message} (retry in ${Math.round(backoffMs / 1000)}s)`);
      this.schedulePoll(backoffMs);
      return;
    }
    this.schedulePoll(this.pollIntervalMs);
  }

  private async ensureOn(): Promise<boolean> {
    if (this.state.power === Power.On) {
      this.log.debug('device:ensureOn()', 'already on');
      return false;
    }

    this.log.debug('device:ensureOn()');
    await this.setPower(Power.On);
    return true;
  }
}
