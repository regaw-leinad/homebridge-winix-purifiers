import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Airflow, AirQuality, Mode, Plasmawave, Power, WinixAPI } from 'winix-api';
import { Device } from '../src/device';

vi.mock('winix-api', () => ({
  WinixAPI: {
    getDeviceStatus: vi.fn(),
    setPower: vi.fn(),
    setMode: vi.fn(),
    setAirflow: vi.fn(),
    setPlasmawave: vi.fn(),
  },
  Power: { Off: '0', On: '1' },
  Mode: { Auto: '01', Manual: '02' },
  Airflow: { Low: '01', Medium: '02', High: '03', Turbo: '05', Sleep: '06' },
  AirQuality: { Good: '01', Fair: '02', Poor: '03' },
  Plasmawave: { Off: '0', On: '1' },
}));

const mockLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

const DEVICE_ID = 'test-device-123';
const POLL_INTERVAL_MS = 30000;

const mockStatus = {
  power: Power.On,
  mode: Mode.Auto,
  airflow: Airflow.Low,
  airQuality: AirQuality.Good,
  plasmawave: Plasmawave.On,
  ambientLight: 150,
  filterHours: 1234,
};

describe('Device', () => {
  let device: Device;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    device = new Device(DEVICE_ID, POLL_INTERVAL_MS, mockLog);
  });

  afterEach(() => {
    device.stopPolling();
    vi.useRealTimers();
  });

  describe('default state', () => {
    it('should start with default values', () => {
      expect(device.getPower()).toBe(Power.Off);
      expect(device.getMode()).toBe(Mode.Auto);
      expect(device.getAirflow()).toBe(Airflow.Low);
      expect(device.getAirQuality()).toBe(AirQuality.Good);
      expect(device.getPlasmawave()).toBe(Plasmawave.Off);
      expect(device.getAmbientLight()).toBe(0);
      expect(device.getFilterHours()).toBe(0);
      expect(device.hasData()).toBe(false);
    });
  });

  describe('initialFetch', () => {
    it('should update state on success', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      expect(device.hasData()).toBe(true);
      expect(device.getPower()).toBe(Power.On);
      expect(device.getMode()).toBe(Mode.Auto);
      expect(device.getAmbientLight()).toBe(150);
      expect(device.getFilterHours()).toBe(1234);
    });

    it('should keep defaults on failure', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockRejectedValue(new Error('network error'));
      await device.initialFetch();

      expect(device.hasData()).toBe(false);
      expect(device.getPower()).toBe(Power.Off);
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });

  describe('synchronous getters', () => {
    it('should return state without calling the API', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      vi.clearAllMocks();

      const state = device.getState();
      expect(state.power).toBe(Power.On);
      expect(WinixAPI.getDeviceStatus).not.toHaveBeenCalled();
    });

    it('should return a copy of state', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      const state1 = device.getState();
      const state2 = device.getState();
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });
  });

  describe('polling', () => {
    it('should poll on interval and call onUpdate', async () => {
      const onUpdate = vi.fn();
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);

      device.startPolling(onUpdate);

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(WinixAPI.getDeviceStatus).toHaveBeenCalledWith(DEVICE_ID);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff on failure', async () => {
      const onUpdate = vi.fn();
      vi.mocked(WinixAPI.getDeviceStatus).mockRejectedValue(new Error('offline'));

      device.startPolling(onUpdate);

      // First poll fails
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalled();

      // Backoff: 30000 * 2^1 = 60000ms
      await vi.advanceTimersByTimeAsync(60000);
      expect(WinixAPI.getDeviceStatus).toHaveBeenCalledTimes(2);

      // Backoff: 30000 * 2^2 = 120000ms
      await vi.advanceTimersByTimeAsync(120000);
      expect(WinixAPI.getDeviceStatus).toHaveBeenCalledTimes(3);
    });

    it('should keep last known state on poll failure', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      vi.mocked(WinixAPI.getDeviceStatus).mockRejectedValue(new Error('offline'));
      device.startPolling(vi.fn());
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      expect(device.getPower()).toBe(Power.On);
      expect(device.getMode()).toBe(Mode.Auto);
    });

    it('should become unreachable after consecutive failures', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      expect(device.isReachable()).toBe(true);

      vi.mocked(WinixAPI.getDeviceStatus).mockRejectedValue(new Error('offline'));
      device.startPolling(vi.fn());

      // 1st failure
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(device.isReachable()).toBe(true);

      // 2nd failure (backoff: 60s)
      await vi.advanceTimersByTimeAsync(60000);
      expect(device.isReachable()).toBe(true);

      // 3rd failure (backoff: 120s) - now unreachable
      await vi.advanceTimersByTimeAsync(120000);
      expect(device.isReachable()).toBe(false);
    });

    it('should become reachable again after recovery', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      vi.mocked(WinixAPI.getDeviceStatus).mockRejectedValue(new Error('offline'));
      device.startPolling(vi.fn());

      // Fail 3 times to become unreachable
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(60000);
      await vi.advanceTimersByTimeAsync(120000);
      expect(device.isReachable()).toBe(false);

      // Recover
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await vi.advanceTimersByTimeAsync(240000); // backoff: 240s
      expect(device.isReachable()).toBe(true);
    });

    it('should reset backoff after successful poll', async () => {
      const onUpdate = vi.fn();

      // Fail first
      vi.mocked(WinixAPI.getDeviceStatus).mockRejectedValue(new Error('offline'));
      device.startPolling(onUpdate);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      // Succeed on next
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await vi.advanceTimersByTimeAsync(60000); // backoff delay
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Should be back to normal interval
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetPollTimer', () => {
    it('should schedule a poll after the specified delay', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      const onUpdate = vi.fn();
      device.startPolling(onUpdate);

      device.resetPollTimer(3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopPolling', () => {
    it('should stop the poll timer', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      const onUpdate = vi.fn();
      device.startPolling(onUpdate);

      device.stopPolling();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe('setPower', () => {
    it('should call API and update state', async () => {
      await device.setPower(Power.On);
      expect(WinixAPI.setPower).toHaveBeenCalledWith(DEVICE_ID, Power.On);
      expect(device.getPower()).toBe(Power.On);
    });

    it('should skip if no change', async () => {
      expect(device.getPower()).toBe(Power.Off);
      await device.setPower(Power.Off);
      expect(WinixAPI.setPower).not.toHaveBeenCalled();
    });

    it('should reset mode and plasmawave on power off', async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      await device.setPower(Power.Off);
      expect(device.getMode()).toBe(Mode.Auto);
      expect(device.getPlasmawave()).toBe(Plasmawave.Off);
    });

    it('should restore plasmawave on power on', async () => {
      await device.setPower(Power.On);
      expect(device.getPlasmawave()).toBe(Plasmawave.On);
    });
  });

  describe('setMode', () => {
    beforeEach(async () => {
      // Start with device on
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      vi.clearAllMocks();
    });

    it('should call API and update state', async () => {
      await device.setMode(Mode.Manual);
      expect(WinixAPI.setMode).toHaveBeenCalledWith(DEVICE_ID, Mode.Manual);
      expect(device.getMode()).toBe(Mode.Manual);
    });

    it('should reset airflow when switching to auto', async () => {
      await device.setMode(Mode.Manual);
      vi.clearAllMocks();

      await device.setMode(Mode.Auto);
      expect(device.getAirflow()).toBe(Airflow.Low);
    });
  });

  describe('setAirflow', () => {
    beforeEach(async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue({
        ...mockStatus,
        mode: Mode.Manual,
      });
      await device.initialFetch();
      vi.clearAllMocks();
    });

    it('should call API and update state when already in manual', async () => {
      await device.setAirflow(Airflow.High);
      expect(WinixAPI.setAirflow).toHaveBeenCalledWith(DEVICE_ID, Airflow.High);
      expect(device.getAirflow()).toBe(Airflow.High);
      // Should not have called setMode since already manual
      expect(WinixAPI.setMode).not.toHaveBeenCalled();
    });

    it('should switch to manual mode with delay before setting airflow', async () => {
      // Set device to auto mode
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus); // auto mode
      await device.initialFetch();
      vi.clearAllMocks();

      const start = Date.now();
      const setAirflowPromise = device.setAirflow(Airflow.High);
      // Advance past the 1500ms command delay
      await vi.advanceTimersByTimeAsync(1500);
      await setAirflowPromise;

      expect(WinixAPI.setMode).toHaveBeenCalledWith(DEVICE_ID, Mode.Manual);
      expect(WinixAPI.setAirflow).toHaveBeenCalledWith(DEVICE_ID, Airflow.High);
    });

    it('should set plasmawave off when setting sleep', async () => {
      await device.setAirflow(Airflow.Sleep);
      expect(device.getPlasmawave()).toBe(Plasmawave.Off);
    });
  });

  describe('setPlasmawave', () => {
    beforeEach(async () => {
      vi.mocked(WinixAPI.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      vi.clearAllMocks();
    });

    it('should call API and update state', async () => {
      await device.setPlasmawave(Plasmawave.Off);
      expect(WinixAPI.setPlasmawave).toHaveBeenCalledWith(DEVICE_ID, Plasmawave.Off);
      expect(device.getPlasmawave()).toBe(Plasmawave.Off);
    });
  });
});
