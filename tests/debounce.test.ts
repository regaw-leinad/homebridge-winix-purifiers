import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, inBackground } from '../src/debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes the wrapped function once with the latest value', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const debounced = debounce(fn, 500);

    const calls = [debounced(25), debounced(50), debounced(75)];
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(calls);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(75);
  });

  it('does not invoke before the delay elapses', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const debounced = debounce(fn, 500);

    void debounced(25);
    await vi.advanceTimersByTimeAsync(499);

    expect(fn).not.toHaveBeenCalled();
  });

  it('resolves only after the wrapped function completes', async () => {
    let release: () => void = () => undefined;
    const fn = vi.fn().mockReturnValue(new Promise<void>(r => {
      release = r;
    }));
    const debounced = debounce(fn, 500);

    let settled = false;
    const call = debounced(75).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalled();
    expect(settled).toBe(false);

    release();
    await call;
    expect(settled).toBe(true);
  });

  // Regression: the old implementation resolved immediately and ran the write inside
  // setTimeout, so a rejection never reached the caller and surfaced as an unhandled
  // promise rejection instead of a HAP error.
  it('rejects the caller when the wrapped function rejects', async () => {
    const error = new Error('rate limited');
    const fn = vi.fn().mockRejectedValue(error);
    const debounced = debounce(fn, 500);

    const call = debounced(75);
    const assertion = expect(call).rejects.toThrow('rate limited');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('rejects every coalesced caller when the single invocation rejects', async () => {
    const error = new Error('boom');
    const fn = vi.fn().mockRejectedValue(error);
    const debounced = debounce(fn, 500);

    const calls = [debounced(25), debounced(50), debounced(75)];
    const assertions = Promise.all(calls.map(c => expect(c).rejects.toThrow('boom')));
    await vi.advanceTimersByTimeAsync(500);
    await assertions;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh batch after one settles', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const debounced = debounce(fn, 500);

    const first = debounced(25);
    await vi.advanceTimersByTimeAsync(500);
    await first;

    const second = debounced(75);
    await vi.advanceTimersByTimeAsync(500);
    await second;

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 25);
    expect(fn).toHaveBeenNthCalledWith(2, 75);
  });
});

describe('inBackground', () => {
  // HAP warns at 3s and times out at 10s, so the handler must not wait on the write.
  it('returns before the wrapped function settles', async () => {
    let settled = false;
    const fn = vi.fn().mockImplementation(() => new Promise<void>(resolve => {
      setTimeout(() => {
        settled = true;
        resolve();
      }, 5_000);
    }));

    await inBackground(fn, () => undefined)(75);

    expect(fn).toHaveBeenCalledWith(75);
    expect(settled).toBe(false);
  });

  it('routes a rejection to onError instead of leaving it unhandled', async () => {
    const error = new Error('rate limited');
    const onError = vi.fn();

    await inBackground(vi.fn().mockRejectedValue(error), onError)(75);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('does not reject the caller when the wrapped function rejects', async () => {
    const onError = vi.fn();
    const handler = inBackground(vi.fn().mockRejectedValue(new Error('boom')), onError);

    await expect(handler(75)).resolves.toBeUndefined();
  });
});
