import { describe, it, expect, afterAll, afterEach, beforeAll } from 'vitest';
import { Power, Mode, Airflow, WinixClient } from 'winix-api';
import { WinixHandler } from '../../src/winix';
import { ENCRYPTION_KEY } from '../../src/settings';
import { Device } from '../../src/device';
import { WinixPluginAuth } from '../../src/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const USERNAME = process.env.WINIX_USERNAME;
const PASSWORD = process.env.WINIX_PASSWORD;
const DEVICE_ID = process.env.WINIX_DEVICE_ID;

const hasCredentials = !!(USERNAME && PASSWORD);

const log = {
  debug: (...args: unknown[]) => console.log('[DEBUG]', ...args),
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.log('[WARN]', ...args),
  error: (...args: unknown[]) => console.log('[ERROR]', ...args),
} as any;

describe.runIf(hasCredentials)('plugin integration', () => {
  let storagePath: string;
  let handler: WinixHandler;
  let auth: WinixPluginAuth;

  beforeAll(async () => {
    storagePath = await mkdtemp(path.join(tmpdir(), 'winix-test-'));
  });

  afterAll(async () => {
    await rm(storagePath, { recursive: true, force: true });
  });

  describe('WinixHandler', () => {
    it('should login with real credentials', async () => {
      handler = new WinixHandler(storagePath, ENCRYPTION_KEY);
      auth = await handler.login(USERNAME!, PASSWORD!);

      expect(auth.username).toBe(USERNAME);
      expect(auth.userId).toBeDefined();
      expect(auth.password).toBe(PASSWORD);
    }, 30_000);

    it('should discover devices', async () => {
      const devices = await handler.getDevices();

      expect(devices.length).toBeGreaterThan(0);
      for (const device of devices) {
        expect(device.deviceId).toBeDefined();
        expect(device.modelName).toBeDefined();
        expect(device.deviceAlias).toBeDefined();
      }
    }, 15_000);

    it('should refresh using persisted encrypted token', async () => {
      const handler2 = new WinixHandler(storagePath, ENCRYPTION_KEY);
      await handler2.refresh(auth);

      const devices = await handler2.getDevices();
      expect(devices.length).toBeGreaterThan(0);
    }, 30_000);
  });

  describe.runIf(DEVICE_ID)('Device', () => {
    let client: WinixClient;
    let device: Device;

    afterEach(() => {
      device?.stopPolling();
    });

    it('should fetch device status on initialFetch', async () => {
      client = new WinixClient();
      device = new Device(DEVICE_ID!, 30_000, log, client);

      await device.initialFetch();

      expect(device.hasData()).toBe(true);
      expect(device.isReachable()).toBe(true);

      const state = device.getState();
      expect([Power.On, Power.Off]).toContain(state.power);
      expect([Mode.Auto, Mode.Manual]).toContain(state.mode);
      expect([Airflow.Low, Airflow.Medium, Airflow.High, Airflow.Turbo, Airflow.Sleep]).toContain(state.airflow);
    }, 15_000);

    it('should receive updates via polling', async () => {
      client = new WinixClient();
      device = new Device(DEVICE_ID!, 5_000, log, client);
      await device.initialFetch();

      let updateCount = 0;
      device.startPolling(() => updateCount++);

      // First poll has random jitter up to pollIntervalMs (5s), then polls every 5s.
      // Wait 15s to guarantee at least one poll fires regardless of jitter.
      await new Promise(r => setTimeout(r, 15_000));
      device.stopPolling();

      expect(updateCount).toBeGreaterThanOrEqual(1);
    }, 25_000);

    it('should work with shared WinixClient across two devices', async () => {
      client = new WinixClient();
      const device1 = new Device(DEVICE_ID!, 5_000, log, client);
      const device2 = new Device(DEVICE_ID!, 7_000, log, client);

      await device1.initialFetch();
      await device2.initialFetch();

      let updates1 = 0;
      let updates2 = 0;
      device1.startPolling(() => updates1++);
      device2.startPolling(() => updates2++);

      // Jitter can be up to pollIntervalMs per device. Worst case:
      // device1: 5s jitter + 5s interval = 10s, device2: 7s jitter + 7s interval = 14s.
      // Wait 20s to guarantee both fire at least once.
      await new Promise(r => setTimeout(r, 20_000));
      device1.stopPolling();
      device2.stopPolling();

      expect(updates1).toBeGreaterThanOrEqual(1);
      expect(updates2).toBeGreaterThanOrEqual(1);
      expect(client.getCooldownRemaining()).toBe(0);

      // Clean up for afterEach
      device = device1;
    }, 30_000);
  });
});
