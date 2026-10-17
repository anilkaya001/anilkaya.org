import { setImmediate as macrotask } from "node:timers";

const START = Date.parse("2026-08-24T21:00:00Z");

export function createVirtualTime({ start = START } = {}) {
  let now = start;
  let seq = 0;
  const timers = new Map();
  const real = { setTimeout: null, clearTimeout: null, dateNow: null, abortTimeout: null };
  let installed = false;

  const set = (fn, ms = 0, ...args) => {
    const id = ++seq;
    timers.set(id, { id, at: now + Math.max(0, Number(ms) || 0), fn: () => fn(...args) });
    return id;
  };
  const clear = (id) => { timers.delete(id); };
  const timeoutSignal = (ms) => {
    const controller = new AbortController();
    set(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms);
    return controller.signal;
  };

  const flush = async () => {
    for (let i = 0; i < 3; i++) await new Promise((resolve) => macrotask(resolve));
  };

  return {
    now: () => now,
    set,
    clear,
    timeoutSignal,
    pending: () => timers.size,

    install() {
      if (installed) return this;
      installed = true;
      real.setTimeout = globalThis.setTimeout;
      real.clearTimeout = globalThis.clearTimeout;
      real.dateNow = Date.now;
      real.abortTimeout = AbortSignal.timeout;
      globalThis.setTimeout = set;
      globalThis.clearTimeout = clear;
      Date.now = () => now;
      AbortSignal.timeout = timeoutSignal;
      return this;
    },

    uninstall() {
      if (!installed) return;
      installed = false;
      globalThis.setTimeout = real.setTimeout;
      globalThis.clearTimeout = real.clearTimeout;
      Date.now = real.dateNow;
      AbortSignal.timeout = real.abortTimeout;
    },

    async drive(promise, { maxTimers = 400000 } = {}) {
      const state = { settled: false, ok: false, value: undefined, error: undefined };
      promise.then((value) => { state.settled = true; state.ok = true; state.value = value; }, (error) => { state.settled = true; state.error = error; });
      const startedAt = now;
      for (let fired = 0; fired < maxTimers; fired++) {
        await flush();
        if (state.settled) return { ...state, hung: false, elapsed: now - startedAt };
        let next = null;
        for (const t of timers.values()) if (next === null || t.at < next.at || (t.at === next.at && t.id < next.id)) next = t;
        if (next === null) return { ...state, hung: true, elapsed: now - startedAt };
        timers.delete(next.id);
        now = Math.max(now, next.at);
        next.fn();
      }
      return { ...state, hung: true, elapsed: now - startedAt, runaway: true };
    },
  };
}
