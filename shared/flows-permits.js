export function makePermitQueue({ delayMs, now, sleep, maxInFlight = 6, onReserve } = {}) {
  if (typeof delayMs !== "function") throw new TypeError("delayMs must be a function");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (typeof sleep !== "function") throw new TypeError("sleep must be a function");

  let nextAt = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  let issued = 0;

  return {

    async acquire() {
      const started = now();

      while (inFlight >= maxInFlight) await sleep(25);

      const at = Math.max(now(), nextAt);
      nextAt = at + delayMs();
      issued++;
      if (onReserve) onReserve(at);
      const wait = at - now();
      if (wait > 0) await sleep(wait);
      return now() - started;
    },

    enter() {
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight--;
      };
    },

    defer(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n <= 0) return 0;
      const target = now() + n;
      const added = Math.max(0, target - nextAt);
      nextAt = Math.max(nextAt, target);
      return added;
    },

    stats() {
      return { issued, inFlight, peakInFlight };
    },
  };
}
