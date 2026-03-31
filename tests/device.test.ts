import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Airflow, AirQuality, Mode, Plasmawave, Power, WinixClient, RateLimitError } from 'winix-api';
import { Device } from '../src/device';

vi.mock('winix-api', async () => {
  const enums = {
    Power: { Off: '0', On: '1' },
    Mode: { Auto: '01', Manual: '02' },
    Airflow: { Low: '01', Medium: '02', High: '03', Turbo: '05', Sleep: '06' },
    AirQuality: { Good: '01', Fair: '02', Poor: '03' },
    Plasmawave: { Off: '0', On: '1' },
  };

  class RateLimitError extends Error {
    constructor() {
      super('Rate limited by Winix API');
      this.name = 'RateLimitError';
    }
  }

  const WinixClient = vi.fn().mockImplementation(() => ({
    getDeviceStatus: vi.fn(),
    setPower: vi.fn(),
    setMode: vi.fn(),
    setAirflow: vi.fn(),
    setPlasmawave: vi.fn(),
  }));

  return { ...enums, WinixClient, RateLimitError };
});

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
  let client: InstanceType<typeof WinixClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    client = new WinixClient();
    device = new Device(DEVICE_ID, POLL_INTERVAL_MS, mockLog, client);
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
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      expect(device.hasData()).toBe(true);
      expect(device.getPower()).toBe(Power.On);
      expect(device.getMode()).toBe(Mode.Auto);
      expect(device.getAmbientLight()).toBe(150);
      expect(device.getFilterHours()).toBe(1234);
    });

    it('should keep defaults on failure', async () => {
      vi.mocked(client.getDeviceStatus).mockRejectedValue(new Error('network error'));
      await device.initialFetch();

      expect(device.hasData()).toBe(false);
      expect(device.getPower()).toBe(Power.Off);
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });

  describe('synchronous getters', () => {
    it('should return state without calling the API', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      vi.clearAllMocks();

      const state = device.getState();
      expect(state.power).toBe(Power.On);
      expect(client.getDeviceStatus).not.toHaveBeenCalled();
    });

    it('should return a copy of state', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
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
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);

      device.startPolling(onUpdate);

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(client.getDeviceStatus).toHaveBeenCalledWith(DEVICE_ID);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff on failure', async () => {
      const onUpdate = vi.fn();
      vi.mocked(client.getDeviceStatus).mockRejectedValue(new Error('offline'));

      device.startPolling(onUpdate);

      // First poll fails
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalled();

      // Backoff: 30000 * 2^1 = 60000ms
      await vi.advanceTimersByTimeAsync(60000);
      expect(client.getDeviceStatus).toHaveBeenCalledTimes(2);

      // Backoff: 30000 * 2^2 = 120000ms
      await vi.advanceTimersByTimeAsync(120000);
      expect(client.getDeviceStatus).toHaveBeenCalledTimes(3);
    });

    it('should keep last known state on poll failure', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      vi.mocked(client.getDeviceStatus).mockRejectedValue(new Error('offline'));
      device.startPolling(vi.fn());
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      expect(device.getPower()).toBe(Power.On);
      expect(device.getMode()).toBe(Mode.Auto);
    });

    it('should become unreachable after consecutive failures', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      expect(device.isReachable()).toBe(true);

      vi.mocked(client.getDeviceStatus).mockRejectedValue(new Error('offline'));
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
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      vi.mocked(client.getDeviceStatus).mockRejectedValue(new Error('offline'));
      device.startPolling(vi.fn());

      // Fail 3 times to become unreachable
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(60000);
      await vi.advanceTimersByTimeAsync(120000);
      expect(device.isReachable()).toBe(false);

      // Recover
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await vi.advanceTimersByTimeAsync(240000); // backoff: 240s
      expect(device.isReachable()).toBe(true);
    });

    it('should reset backoff after successful poll', async () => {
      const onUpdate = vi.fn();

      // Fail first
      vi.mocked(client.getDeviceStatus).mockRejectedValue(new Error('offline'));
      device.startPolling(onUpdate);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      // Succeed on next
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await vi.advanceTimersByTimeAsync(60000); // backoff delay
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Should be back to normal interval
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetPollTimer', () => {
    it('should schedule a poll after the specified delay', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      const onUpdate = vi.fn();
      device.startPolling(onUpdate);

      device.resetPollTimer(3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopPolling', () => {
    it('should stop the poll timer', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
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
      expect(client.setPower).toHaveBeenCalledWith(DEVICE_ID, Power.On);
      expect(device.getPower()).toBe(Power.On);
    });

    it('should skip if no change', async () => {
      expect(device.getPower()).toBe(Power.Off);
      await device.setPower(Power.Off);
      expect(client.setPower).not.toHaveBeenCalled();
    });

    it('should reset mode and plasmawave on power off', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
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
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      vi.clearAllMocks();
    });

    it('should call API and update state', async () => {
      await device.setMode(Mode.Manual);
      expect(client.setMode).toHaveBeenCalledWith(DEVICE_ID, Mode.Manual);
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
      vi.mocked(client.getDeviceStatus).mockResolvedValue({
        ...mockStatus,
        mode: Mode.Manual,
      });
      await device.initialFetch();
      vi.clearAllMocks();
    });

    it('should call API and update state when already in manual', async () => {
      await device.setAirflow(Airflow.High);
      expect(client.setAirflow).toHaveBeenCalledWith(DEVICE_ID, Airflow.High);
      expect(device.getAirflow()).toBe(Airflow.High);
      // Should not have called setMode since already manual
      expect(client.setMode).not.toHaveBeenCalled();
    });

    it('should switch to manual mode with delay before setting airflow', async () => {
      // Set device to auto mode
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus); // auto mode
      await device.initialFetch();
      vi.clearAllMocks();

      const start = Date.now();
      const setAirflowPromise = device.setAirflow(Airflow.High);
      // Advance past the 1500ms command delay
      await vi.advanceTimersByTimeAsync(1500);
      await setAirflowPromise;

      expect(client.setMode).toHaveBeenCalledWith(DEVICE_ID, Mode.Manual);
      expect(client.setAirflow).toHaveBeenCalledWith(DEVICE_ID, Airflow.High);
    });

    it('should set plasmawave off when setting sleep', async () => {
      await device.setAirflow(Airflow.Sleep);
      expect(device.getPlasmawave()).toBe(Plasmawave.Off);
    });
  });

  describe('setPlasmawave', () => {
    beforeEach(async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      vi.clearAllMocks();
    });

    it('should call API and update state', async () => {
      await device.setPlasmawave(Plasmawave.Off);
      expect(client.setPlasmawave).toHaveBeenCalledWith(DEVICE_ID, Plasmawave.Off);
      expect(device.getPlasmawave()).toBe(Plasmawave.Off);
    });
  });

  describe('optional DeviceStatus fields', () => {
    // winix-api 1.8.0 made airQuality, plasmawave, and ambientLight optional
    // on DeviceStatus since not all device models report them. The Device class
    // initializes these with defaults, and Object.assign only overwrites keys
    // present in the API response, so the defaults should survive.

    // Minimal status: only the required fields from DeviceStatus
    const requiredFieldsOnly = {
      power: Power.On,
      mode: Mode.Auto,
      airflow: Airflow.Low,
      filterHours: 500,
    };

    describe('initialFetch with missing optional fields', () => {
      it('should preserve all defaults when API returns only required fields', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue(requiredFieldsOnly);
        await device.initialFetch();

        expect(device.getAirQuality()).toBe(AirQuality.Good);
        expect(device.getPlasmawave()).toBe(Plasmawave.Off);
        expect(device.getAmbientLight()).toBe(0);
        // Required fields should be updated
        expect(device.getPower()).toBe(Power.On);
        expect(device.getFilterHours()).toBe(500);
      });

      it('should handle only airQuality present', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          airQuality: AirQuality.Poor,
        });
        await device.initialFetch();

        expect(device.getAirQuality()).toBe(AirQuality.Poor);
        expect(device.getPlasmawave()).toBe(Plasmawave.Off);
        expect(device.getAmbientLight()).toBe(0);
      });

      it('should handle only plasmawave present', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          plasmawave: Plasmawave.On,
        });
        await device.initialFetch();

        expect(device.getAirQuality()).toBe(AirQuality.Good);
        expect(device.getPlasmawave()).toBe(Plasmawave.On);
        expect(device.getAmbientLight()).toBe(0);
      });

      it('should handle only ambientLight present', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          ambientLight: 200,
        });
        await device.initialFetch();

        expect(device.getAirQuality()).toBe(AirQuality.Good);
        expect(device.getPlasmawave()).toBe(Plasmawave.Off);
        expect(device.getAmbientLight()).toBe(200);
      });

      it('should handle all optional fields present', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          airQuality: AirQuality.Fair,
          plasmawave: Plasmawave.On,
          ambientLight: 300,
        });
        await device.initialFetch();

        expect(device.getAirQuality()).toBe(AirQuality.Fair);
        expect(device.getPlasmawave()).toBe(Plasmawave.On);
        expect(device.getAmbientLight()).toBe(300);
      });
    });

    describe('polling transitions between full and partial status', () => {
      it('should retain last known values when optional fields disappear', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
        await device.initialFetch();

        expect(device.getPlasmawave()).toBe(Plasmawave.On);
        expect(device.getAmbientLight()).toBe(150);

        // Poll returns only required fields
        vi.mocked(client.getDeviceStatus).mockResolvedValue(requiredFieldsOnly);
        device.startPolling(vi.fn());
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

        // Last known values should persist
        expect(device.getAirQuality()).toBe(AirQuality.Good);
        expect(device.getPlasmawave()).toBe(Plasmawave.On);
        expect(device.getAmbientLight()).toBe(150);
      });

      it('should update when optional fields reappear after being absent', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue(requiredFieldsOnly);
        await device.initialFetch();

        // Poll returns full status
        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          airQuality: AirQuality.Poor,
          plasmawave: Plasmawave.On,
          ambientLight: 250,
        });
        device.startPolling(vi.fn());
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

        expect(device.getAirQuality()).toBe(AirQuality.Poor);
        expect(device.getPlasmawave()).toBe(Plasmawave.On);
        expect(device.getAmbientLight()).toBe(250);
      });

      it('should handle optional fields changing values across polls', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          airQuality: AirQuality.Good,
        });
        await device.initialFetch();
        expect(device.getAirQuality()).toBe(AirQuality.Good);

        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          airQuality: AirQuality.Fair,
        });
        device.startPolling(vi.fn());
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(device.getAirQuality()).toBe(AirQuality.Fair);

        vi.mocked(client.getDeviceStatus).mockResolvedValue({
          ...requiredFieldsOnly,
          airQuality: AirQuality.Poor,
        });
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(device.getAirQuality()).toBe(AirQuality.Poor);
      });
    });

    describe('getState with optional fields', () => {
      it('should include defaults for missing optional fields in state copy', async () => {
        vi.mocked(client.getDeviceStatus).mockResolvedValue(requiredFieldsOnly);
        await device.initialFetch();

        const state = device.getState();
        expect(state.airQuality).toBe(AirQuality.Good);
        expect(state.plasmawave).toBe(Plasmawave.Off);
        expect(state.ambientLight).toBe(0);
      });
    });
  });

  describe('rate limiting', () => {
    it('should not increment consecutiveFailures on RateLimitError during poll', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();
      expect(device.isReachable()).toBe(true);

      vi.mocked(client.getDeviceStatus).mockRejectedValue(new RateLimitError());
      device.startPolling(vi.fn());

      // Fail 3+ times with rate limit — should stay reachable
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      expect(device.isReachable()).toBe(true);
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
    });

    it('should retry at normal interval on RateLimitError (no backoff)', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      vi.mocked(client.getDeviceStatus).mockRejectedValue(new RateLimitError());
      const onUpdate = vi.fn();
      device.startPolling(onUpdate);

      // First poll — rate limited
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(client.getDeviceStatus).toHaveBeenCalledTimes(2); // initialFetch + 1 poll

      // Should retry at normal interval, not exponential backoff
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it('should recover after rate limit clears', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      vi.mocked(client.getDeviceStatus).mockRejectedValue(new RateLimitError());
      const onUpdate = vi.fn();
      device.startPolling(onUpdate);

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(device.isReachable()).toBe(true);

      // Recovery
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(onUpdate).toHaveBeenCalled();
      expect(device.isReachable()).toBe(true);
    });

    it('should handle RateLimitError during initialFetch gracefully', async () => {
      vi.mocked(client.getDeviceStatus).mockRejectedValue(new RateLimitError());
      await device.initialFetch();

      expect(device.hasData()).toBe(false);
      expect(device.getPower()).toBe(Power.Off);
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
    });

    it('should throw RateLimitError on SET commands during rate limit', async () => {
      vi.mocked(client.getDeviceStatus).mockResolvedValue(mockStatus);
      await device.initialFetch();

      vi.mocked(client.setPower).mockRejectedValue(new RateLimitError());
      await expect(device.setPower(Power.Off)).rejects.toThrow(RateLimitError);

      // State should not have changed (optimistic update only happens after await succeeds)
      expect(device.getPower()).toBe(Power.On);
    });
  });
});
