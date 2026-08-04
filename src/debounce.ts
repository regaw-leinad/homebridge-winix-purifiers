import { CharacteristicValue } from 'homebridge';

/**
 * Run a set handler without waiting for it. HAP warns when a handler takes over 3s and
 * returns a timeout to HomeKit at 10s, so handlers whose work can outlast that must
 * return immediately. The rejection still has to go somewhere: onError receives it, so
 * it never becomes an unhandled promise rejection.
 */
export function inBackground(
  func: (arg: CharacteristicValue) => Promise<void>,
  onError: (e: unknown) => void,
): (arg: CharacteristicValue) => Promise<void> {
  return async (arg: CharacteristicValue) => {
    func(arg).catch(onError);
  };
}

/**
 * Debounce a set handler, coalescing rapid calls into a single invocation with the
 * latest value. Every coalesced caller settles on the outcome of that one
 * invocation, so a failed write still reaches CharacteristicWrapper and becomes a
 * HAP error. Resolving early instead would strand the rejection as an unhandled
 * promise rejection, which can take down the Homebridge process.
 */
export function debounce(
  func: (arg: CharacteristicValue) => Promise<void>,
  delay: number,
): (arg: CharacteristicValue) => Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;
  let waiters: { resolve: () => void; reject: (reason: unknown) => void }[] = [];

  return (arg: CharacteristicValue) => new Promise<void>((resolve, reject) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    waiters.push({ resolve, reject });

    timeoutId = setTimeout(() => {
      timeoutId = null;
      const settling = waiters;
      waiters = [];

      func(arg).then(
        () => settling.forEach(w => w.resolve()),
        (e: unknown) => settling.forEach(w => w.reject(e)),
      );
    }, delay);
  });
}
