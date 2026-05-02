import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { MobileSessionInvalidError, WinixAccount, WinixClient } from 'winix-api';
import { WinixHandler } from '../../src/winix';
import { ENCRYPTION_KEY } from '../../src/settings';
import { Device } from '../../src/device';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const USERNAME = process.env.WINIX_USERNAME;
const PASSWORD = process.env.WINIX_PASSWORD;
const DEVICE_ID = process.env.WINIX_DEVICE_ID;

const hasCredentials = !!(USERNAME && PASSWORD);
const hasDevice = hasCredentials && !!DEVICE_ID;

const log = {
  debug: (...args: unknown[]) => console.log('[DEBUG]', ...args),
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.log('[WARN]', ...args),
  error: (...args: unknown[]) => console.log('[ERROR]', ...args),
} as any;

// WARNING: these tests invalidate the Winix mobile-app session on whatever
// phone is logged in with the same account.

describe.runIf(hasCredentials)('plugin session recovery', () => {
  let storagePath: string;

  beforeAll(async () => {
    storagePath = await mkdtemp(path.join(tmpdir(), 'winix-test-'));
  });

  afterAll(async () => {
    await rm(storagePath, { recursive: true, force: true });
  });

  describe.runIf(hasDevice)('NoDataError', () => {
    it('Device.poll() handles NoDataError without erroring out the device', async () => {
      const handler = new WinixHandler(storagePath, ENCRYPTION_KEY);
      await handler.login(USERNAME!, PASSWORD!);

      const client = new WinixClient(handler.getIdentityId());

      // Plausible-but-unregistered deviceId. initialFetch soft-fails (no throw),
      // poll() catches NoDataError and skips failure counter.
      const ghostDevice = new Device('CCCCCCCCCCCC_xxxxxxxxxx', 2_000, log, client);
      try {
        await ghostDevice.initialFetch();
        ghostDevice.startPolling(() => {});
        await new Promise(r => setTimeout(r, 6_000));
      } finally {
        ghostDevice.stopPolling();
      }

      expect(ghostDevice.hasData()).toBe(false);
    }, 30_000);
  });

  describe('MobileSessionInvalidError', () => {
    it('handler.getDevices() recovers via re-login after mobile session invalidation', async () => {
      const handler = new WinixHandler(storagePath, ENCRYPTION_KEY);
      await handler.login(USERNAME!, PASSWORD!);

      const baseline = await handler.getDevices();
      expect(baseline.length).toBeGreaterThan(0);

      // Invalidate the handler's mobile session by logging in elsewhere
      await new Promise(r => setTimeout(r, 2000));
      await WinixAccount.fromCredentials(USERNAME!, PASSWORD!);

      // getDevices should auto-recover via internal re-login
      const recovered = await handler.getDevices();
      expect(recovered.length).toBeGreaterThan(0);
    }, 60_000);

    it('throttle: second invalidation within 5 minutes bubbles MobileSessionInvalidError', async () => {
      const handler = new WinixHandler(storagePath, ENCRYPTION_KEY);
      await handler.login(USERNAME!, PASSWORD!);

      // First invalidation + recovery (consumes throttle slot)
      await new Promise(r => setTimeout(r, 2000));
      await WinixAccount.fromCredentials(USERNAME!, PASSWORD!);
      await handler.getDevices();

      // Immediately invalidate again — re-login should be throttled, error bubbles
      await new Promise(r => setTimeout(r, 2000));
      await WinixAccount.fromCredentials(USERNAME!, PASSWORD!);

      await expect(handler.getDevices()).rejects.toBeInstanceOf(MobileSessionInvalidError);
    }, 90_000);
  });
});
