import { describe, it, expect, beforeAll } from 'vitest';
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
    hasMessageContaining: (level: string, text: string) =>
      entries.some(e => e.level === level && e.args.some(a => String(a).includes(text))),
  };
}

async function drainBucket(client: WinixClient, deviceId: string): Promise<number> {
  let requestCount = 0;
  let rateLimited = false;
  while (!rateLimited && requestCount < 100) {
    try {
      await client.getDeviceStatus(deviceId);
      requestCount++;
    } catch (e) {
      if (e instanceof RateLimitError) {
        rateLimited = true;
      } else {
        throw e;
      }
    }
  }
  if (!rateLimited) {
    throw new Error(`Failed to trigger rate limit after ${requestCount} requests`);
  }
  return requestCount;
}

describe.runIf(DEVICE_ID)('rate limiting integration', () => {
  // Tests 1 and 2 share a pre-drained client (efficient, no recovery wait needed).
  // Test 3 uses its own client so it can do initialFetch before draining.
  let drainedClient: WinixClient;

  beforeAll(async () => {
    drainedClient = new WinixClient();
    const count = await drainBucket(drainedClient, DEVICE_ID!);
    console.log(`Drained bucket after ${count} requests`);
    expect(drainedClient.getCooldownRemaining()).toBeGreaterThan(0);
  }, 60_000);

  it('should handle rate limit during initialFetch gracefully', async () => {
    // Device created with an already-rate-limited client.
    // initialFetch should not crash, should use defaults, should log a warning.
    const { log, hasMessageContaining } = createTestLogger();
    const device = new Device(DEVICE_ID!, 30_000, log, drainedClient);

    await device.initialFetch();

    expect(device.hasData()).toBe(false);
    expect(device.getPower()).toBe(Power.Off);
    expect(hasMessageContaining('warn', 'rate limited')).toBe(true);
  }, 15_000);

  it('should throw RateLimitError on SET command without changing state', async () => {
    // Device starts with default state (power=Off). Trying to set power=On
    // should throw RateLimitError and not update the optimistic state.
    const { log } = createTestLogger();
    const device = new Device(DEVICE_ID!, 30_000, log, drainedClient);

    await expect(device.setPower(Power.On)).rejects.toThrow(RateLimitError);
    expect(device.getPower()).toBe(Power.Off);
  }, 15_000);

  it('should stay reachable during rate limit and recover after cooldown', async () => {
    // This test uses its own client so we can:
    // 1. Wait for the IP-level rate limit from beforeAll to clear
    // 2. Do a successful initialFetch (device becomes reachable)
    // 3. Drain the bucket again (device enters rate limit)
    // 4. Verify device stays reachable during cooldown (consecutiveFailures not incremented)
    // 5. Wait for cooldown to clear
    // 6. Verify polling recovers and delivers updates
    const { log, hasMessageContaining } = createTestLogger();
    const client = new WinixClient();
    const device = new Device(DEVICE_ID!, 5_000, log, client);

    // Step 1: Wait for the IP-level rate limit from beforeAll/earlier tests to clear.
    // The drainedClient tracks its own cooldown, but the IP-level limit is shared.
    const remaining = drainedClient.getCooldownRemaining();
    if (remaining > 0) {
      console.log(`Waiting ${remaining + 5000}ms for IP-level rate limit to clear...`);
      await new Promise(r => setTimeout(r, remaining + 5_000));
    }

    // Step 2: Successful fetch so device has data and is reachable
    await device.initialFetch();
    expect(device.hasData()).toBe(true);
    expect(device.isReachable()).toBe(true);

    // Step 2: Drain the bucket on this client
    const count = await drainBucket(client, DEVICE_ID!);
    console.log(`Drained bucket after ${count} requests`);
    expect(client.getCooldownRemaining()).toBeGreaterThan(0);

    // Step 3: Start polling. Polls will hit RateLimitError but device should
    // NOT become unreachable (consecutiveFailures should not increment).
    let updateCount = 0;
    device.startPolling(() => updateCount++);

    await new Promise(r => setTimeout(r, 12_000));
    expect(hasMessageContaining('warn', 'rate limited')).toBe(true);
    expect(device.isReachable()).toBe(true);

    // Step 4: Wait for cooldown to clear, plus extra buffer for the API-side
    // rate limit window. The client's 60s cooldown means no requests hit the API
    // during that time, but the API may need its own 60s of silence. Add 15s buffer.
    const cooldownLeft = client.getCooldownRemaining();
    if (cooldownLeft > 0) {
      const waitMs = cooldownLeft + 15_000;
      console.log(`Waiting ${waitMs}ms for cooldown + API recovery...`);
      await new Promise(r => setTimeout(r, waitMs));
    }

    // Step 5: After cooldown, polls should eventually succeed.
    // If the first post-cooldown poll re-triggers cooldown (API not fully recovered),
    // wait for that second cooldown too.
    const secondCooldown = client.getCooldownRemaining();
    if (secondCooldown > 0) {
      console.log(`Second cooldown triggered, waiting ${secondCooldown + 15_000}ms...`);
      await new Promise(r => setTimeout(r, secondCooldown + 15_000));
    }

    await new Promise(r => setTimeout(r, 15_000));
    device.stopPolling();

    expect(updateCount).toBeGreaterThanOrEqual(1);
    expect(client.getCooldownRemaining()).toBe(0);
    expect(device.isReachable()).toBe(true);
  }, 300_000);
});
