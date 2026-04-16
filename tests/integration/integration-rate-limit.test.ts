import { describe, it, expect, beforeAll } from 'vitest';
import { Power, WinixClient, RateLimitError } from 'winix-api';
import { Device } from '../../src/device';
import { WinixHandler } from '../../src/winix';
import { ENCRYPTION_KEY } from '../../src/settings';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const USERNAME = process.env.WINIX_USERNAME;
const PASSWORD = process.env.WINIX_PASSWORD;
const DEVICE_ID = process.env.WINIX_DEVICE_ID;
const canRun = !!(USERNAME && PASSWORD && DEVICE_ID);

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

async function waitForRecovery(client: WinixClient, deviceId: string, timeoutMs = 5 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.getDeviceStatus(deviceId);
      return; // success
    } catch {
      const cooldown = client.getCooldownRemaining();
      const waitMs = cooldown > 0 ? cooldown + 5_000 : 10_000;
      console.log(`  Recovery probe failed, waiting ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw new Error(`API did not recover within ${timeoutMs}ms`);
}

async function drainBucket(client: WinixClient, deviceId: string): Promise<number> {
  let requestCount = 0;
  let rateLimited = false;
  while (!rateLimited && requestCount < 500) {
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

describe.runIf(canRun)('rate limiting integration', () => {
  // Tests 1 and 2 share a pre-drained client (efficient, no recovery wait needed).
  // Test 3 uses its own client so it can do initialFetch before draining.
  let drainedClient: WinixClient;
  let identityId: string;

  beforeAll(async () => {
    const storagePath = await mkdtemp(path.join(tmpdir(), 'winix-rate-limit-'));
    const handler = new WinixHandler(storagePath, ENCRYPTION_KEY);
    await handler.login(USERNAME!, PASSWORD!);
    identityId = handler.getIdentityId();

    drainedClient = new WinixClient(identityId);
    const count = await drainBucket(drainedClient, DEVICE_ID!);
    console.log(`Drained bucket after ${count} requests`);
    expect(drainedClient.getCooldownRemaining()).toBeGreaterThan(0);
  }, 120_000);

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
    // 1. Wait for API recovery (poll, don't guess)
    // 2. Do a successful initialFetch (device becomes reachable)
    // 3. Drain the bucket (device enters rate limit)
    // 4. Verify device stays reachable during cooldown
    // 5. Wait for recovery (poll, don't guess)
    // 6. Verify polling delivered updates
    const { log, hasMessageContaining } = createTestLogger();
    const client = new WinixClient(identityId);
    const device = new Device(DEVICE_ID!, 5_000, log, client);

    // Step 1: Wait for API to recover from earlier tests.
    // AWS WAF recovery timing is unpredictable, so poll instead of guessing.
    const probeClient = new WinixClient(identityId);
    console.log('Waiting for API to recover from earlier tests...');
    await waitForRecovery(probeClient, DEVICE_ID!);

    // Step 2: Successful fetch so device has data and is reachable
    await device.initialFetch();
    expect(device.hasData()).toBe(true);
    expect(device.isReachable()).toBe(true);

    // Step 3: Drain the bucket on this client
    const count = await drainBucket(client, DEVICE_ID!);
    console.log(`Drained bucket after ${count} requests`);
    expect(client.getCooldownRemaining()).toBeGreaterThan(0);

    // Step 4: Start polling. Polls will hit RateLimitError but device should
    // NOT become unreachable (consecutiveFailures should not increment).
    let updateCount = 0;
    device.startPolling(() => updateCount++);

    await new Promise(r => setTimeout(r, 12_000));
    expect(hasMessageContaining('warn', 'rate limited')).toBe(true);
    expect(device.isReachable()).toBe(true);

    // Step 5: Wait for recovery by polling, not fixed sleeps.
    // The polling loop will naturally recover once the API starts responding.
    console.log('Waiting for polling to recover...');
    const deadline = Date.now() + 5 * 60_000;
    while (updateCount === 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10_000));
    }
    device.stopPolling();

    // Step 6: Verify recovery
    expect(updateCount).toBeGreaterThanOrEqual(1);
    expect(device.isReachable()).toBe(true);
  }, 600_000);
});
