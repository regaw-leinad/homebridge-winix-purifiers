import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Power, WinixClient, RateLimitError } from 'winix-api';
import { Device } from '../../src/device';

const DEVICE_ID = process.env.WINIX_DEVICE_ID;

interface LogEntry {
  level: string;
  args: unknown[];
}

function createTestLogger() {
  const entries: LogEntry[] = [];
  return {
    log: {
      debug: (...args: unknown[]) => entries.push({ level: 'debug', args }),
      info: (...args: unknown[]) => entries.push({ level: 'info', args }),
      warn: (...args: unknown[]) => entries.push({ level: 'warn', args }),
      error: (...args: unknown[]) => entries.push({ level: 'error', args }),
    } as any,
    entries,
    hasLevel: (level: string) => entries.some(e => e.level === level),
    hasMessageContaining: (level: string, text: string) =>
      entries.some(e => e.level === level && e.args.some(a => String(a).includes(text))),
  };
}

describe.runIf(DEVICE_ID)('rate limiting integration', () => {
  let client: WinixClient;

  beforeAll(async () => {
    client = new WinixClient();

    // Drain the rate limit bucket
    let rateLimited = false;
    let requestCount = 0;
    while (!rateLimited && requestCount < 100) {
      try {
        await client.getDeviceStatus(DEVICE_ID!);
        requestCount++;
      } catch (e) {
        if (e instanceof RateLimitError) {
          rateLimited = true;
        } else {
          throw e;
        }
      }
    }

    console.log(`Drained bucket after ${requestCount} requests`);
    expect(rateLimited).toBe(true);
    expect(client.getCooldownRemaining()).toBeGreaterThan(0);
  }, 60_000);

  it('should handle rate limit during initialFetch gracefully', async () => {
    const { log, hasMessageContaining } = createTestLogger();
    const device = new Device(DEVICE_ID!, 30_000, log, client);

    await device.initialFetch();

    expect(device.hasData()).toBe(false);
    expect(device.getPower()).toBe(Power.Off); // default
    expect(hasMessageContaining('warn', 'rate limited')).toBe(true);
  }, 15_000);

  it('should throw RateLimitError on SET command without changing state', async () => {
    const { log } = createTestLogger();
    const device = new Device(DEVICE_ID!, 30_000, log, client);

    // Set initial state to On so setPower(Off) actually tries the API
    await device.initialFetch(); // will fail (rate limited), state stays at defaults
    // Default power is Off, so try setting to On
    await expect(device.setPower(Power.On)).rejects.toThrow(RateLimitError);
    expect(device.getPower()).toBe(Power.Off); // unchanged
  }, 15_000);

  it('should stay reachable during rate limit and recover after cooldown', async () => {
    const { log, hasMessageContaining } = createTestLogger();
    const device = new Device(DEVICE_ID!, 5_000, log, client);

    // Do a fresh initialFetch on a new client so the device has data
    const freshClient = new WinixClient();
    const setupDevice = new Device(DEVICE_ID!, 30_000, log, freshClient);

    // Wait for any residual cooldown on the fresh client
    // (fresh client has no cooldown, so this should work)
    await setupDevice.initialFetch();

    // If setup succeeded, copy that the device "has data" by doing initialFetch
    // But our test device uses the rate-limited client, so initialFetch will fail
    // Instead, test reachability through polling after we manually set hasData
    // via a successful fetch on the rate-limited client after cooldown

    // Start polling on the rate-limited client
    let updateCount = 0;
    device.startPolling(() => updateCount++);

    // During cooldown, polls should get RateLimitError but device should not go unreachable
    await new Promise(r => setTimeout(r, 10_000));
    expect(hasMessageContaining('warn', 'rate limited')).toBe(true);

    // Wait for cooldown to clear (75s from the start of the test, but bucket was
    // drained in beforeAll, so we need to wait for the remaining cooldown)
    const remaining = client.getCooldownRemaining();
    if (remaining > 0) {
      console.log(`Waiting ${remaining}ms for cooldown to clear...`);
      await new Promise(r => setTimeout(r, remaining + 5_000));
    }

    // After cooldown, next poll should succeed
    await new Promise(r => setTimeout(r, 10_000));
    device.stopPolling();

    expect(updateCount).toBeGreaterThanOrEqual(1);
    expect(client.getCooldownRemaining()).toBe(0);
    expect(device.isReachable()).toBe(true);
  }, 180_000);

  afterAll(() => {
    // Allow garbage collection of timers
  });
});
