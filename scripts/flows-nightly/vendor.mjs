import { makePermitQueue } from "../../shared/flows-permits.js";
import { createProgress } from "../flows-legs/live.mjs";
import { LIVE_MODE } from "./flags.mjs";
import { LIVE_VENDOR, RATE } from "./vendor-params.mjs";

const BASE = process.env.FLOWS_UW_BASE_URL || "https://api.unusualwhales.com";

export function rateFloorSurvivesBudget(
  { floorCeilingMs, callBudget, deadlineMs, reserveMs } = {},
) {
  return floorCeilingMs * callBudget < deadlineMs - reserveMs;
}

export function raiseRateFloor(floor, { minStepMs = 150, ceilingMs = RATE.floorCeilingMs } = {}) {
  return Math.min(Math.max(floor * 1.5, minStepMs), ceilingMs);
}

export function stepRateController({ delayMs, floorMs }, outcome, { maxDelayMs = RATE.maxDelayMs } = {}) {
  if (outcome === "limited") {
    const raised = raiseRateFloor(floorMs);
    return { floorMs: raised, delayMs: Math.min(Math.max(delayMs * 2, raised), maxDelayMs) };
  }
  if (outcome === "error") {
    return { floorMs, delayMs: Math.min(delayMs * 2, maxDelayMs) };
  }
  return { floorMs, delayMs: Math.max(floorMs, delayMs * 0.9) };
}

export const stats = {
  calls: 0, retries: 0, rateLimited: 0, failures: 0, timedOut: 0, startedAt: Date.now(),

  permitWaitMs: 0, networkMs: 0, rateLimitWaitMs: 0, rateLimitQueueMs: 0,
};

export let delayMs = RATE.startDelayMs;

export const wireProgress = createProgress();

export let delayFloorMs = RATE.minDelayMs;

export function raiseReadPace(ms) {
  delayFloorMs = Math.max(delayFloorMs, ms);
  delayMs = Math.max(delayMs, ms);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const permits = makePermitQueue({
  delayMs: () => delayMs,
  now: () => Date.now(),
  sleep,
  maxInFlight: 6,
});

export const POOL_MAX_WIDTH = 4;

export const POOL_EVIDENCE_MIN = 24;

export const POOL_REFUSAL_HALT = 0.10;

export const POOL_REFUSAL_EASE = 0.05;

const meterRead = (meter, key) => {
  if (!meter) return null;
  const v = meter[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function poolWidth(max = POOL_MAX_WIDTH, meter = stats) {
  const seen = meterRead(meter, "calls");
  const refused = meterRead(meter, "rateLimited");

  if (seen === null) {
    return { width: 1, rate: null, seen: null,
      why: "no call counter to read, so this run has measured no refusal rate" };
  }
  if (seen < POOL_EVIDENCE_MIN) {
    return { width: 1, rate: null, seen, why: `only ${seen} call(s) so far, which is not evidence` };
  }

  if (refused === null) {
    return { width: 1, rate: null, seen,
      why: `${seen} call(s) counted and no refusal counter beside them` };
  }
  const rate = refused / seen;
  if (rate > POOL_REFUSAL_HALT) {
    return { width: 1, rate, seen, why: `${(rate * 100).toFixed(1)}% of calls refused so far` };
  }
  if (rate > POOL_REFUSAL_EASE) {
    return { width: Math.min(2, max), rate, seen, why: `${(rate * 100).toFixed(1)}% refused` };
  }
  return { width: max, rate, seen, why: `${(rate * 100).toFixed(1)}% refused` };
}

export async function runPooled(items, work, { width = 1, stopEarly = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length).fill(undefined);

  const attempted = new Array(list.length).fill(false);
  let next = 0;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (stopped) return;
      if (stopEarly && stopEarly()) { stopped = true; return; }
      const i = next++;
      if (i >= list.length) return;
      attempted[i] = true;
      results[i] = await work(list[i], i);
    }
  };

  const lanes = Math.max(1, Math.min(Math.floor(width) || 1, list.length || 1));
  await Promise.all(Array.from({ length: lanes }, worker));
  return { results, attempted, stopped, done: attempted.filter(Boolean).length };
}

export function foldCardOutcomes(tickers, run) {
  const list = Array.isArray(tickers) ? tickers : [];
  const attempted = (run && run.attempted) || [];
  const results = (run && run.results) || [];
  const out = {
    built: 0, failed: 0, unenriched: 0, deadlineSkipped: 0, skipped: 0, gammaProfiles: [],

    garchConverged: 0, garchUnconverged: 0, garchUnavailable: 0,
    garchNu: [], garchLambda: [], garchPersistence: [],
  };
  list.forEach((ticker, i) => {
    if (!attempted[i]) { out.deadlineSkipped++; out.skipped++; return; }
    const outcome = results[i];

    if (!outcome || outcome.status === "failed") { out.failed++; return; }
    if (outcome.status === "unenriched") { out.unenriched++; out.skipped++; return; }
    out.built++;

    if (outcome.gamma) out.gammaProfiles.push(outcome.gamma);

    const g = outcome.garch;
    if (g && typeof g === "object") {
      if (g.status !== "ok") out.garchUnavailable++;
      else if (g.converged === false) out.garchUnconverged++;
      else {
        out.garchConverged++;
        if (Number.isFinite(g.nu)) out.garchNu.push(g.nu);
        if (Number.isFinite(g.lambda)) out.garchLambda.push(g.lambda);
        if (Number.isFinite(g.persistence)) out.garchPersistence.push(g.persistence);
      }
    }
  });
  return out;
}

export function describeFloorVerdict(meter) {
  const calls = meterRead(meter, "calls");

  if (!calls) return null;
  const refused = meterRead(meter, "rateLimited");

  if (refused === null) return null;
  const queuedMs = meterRead(meter, "permitWaitMs");
  const backoffMs = meterRead(meter, "rateLimitWaitMs");
  const rate = refused / calls;

  const timed = queuedMs !== null && backoffMs !== null;
  const share = timed && queuedMs > 0 ? backoffMs / queuedMs : null;

  const head =
    `floor verdict: ${refused} of ${calls} calls refused (${(rate * 100).toFixed(1)}%), ` +
    (!timed
      ? "and this run carries no wait meters, so what the floor charged and what the " +
        "refusals cost were not measured — read the rate alone. "
      : `backoff ${(backoffMs / 1000).toFixed(1)}s against ${(queuedMs / 1000).toFixed(1)}s of queueing` +
        (share === null
          ? " — nothing queued, so the floor was never the binding cost this run. "
          : ` (${(share * 100).toFixed(0)}% as large). `));
  if (rate > POOL_REFUSAL_HALT) {
    return head +
      "THE CEILING IS DOING ITS JOB and must not move up: the controller asked to go slower " +
      `than RATE.floorCeilingMs=${RATE.floorCeilingMs}ms and was refused anyway. Cut calls ` +
      "before touching the rate, and expect every pooled leg to have run one wide.";
  }
  if (rate > POOL_REFUSAL_EASE) {
    return head +
      "The floor is roughly where the vendor wants it. Neither raising nor lowering the " +
      "ceiling is supported by this run.";
  }
  return head +
    `The floor is CONSERVATIVE — refusals are under ${(POOL_REFUSAL_EASE * 100).toFixed(0)}% ` +
    "and the queueing above is what this run actually paid. RATE.floorCeilingMs can come " +
    "down one step at a time, re-reading this line each morning.";
}

export function vendorTimeoutMs() {
  if (!LIVE_MODE) return 0;
  const set = Number(process.env.FLOWS_UW_TIMEOUT_MS);
  return Number.isFinite(set) && set >= 100 && set <= 60_000 ? set : LIVE_VENDOR.timeoutMs;
}

const isTimeout = (error) => !!error && (error.name === "TimeoutError" || error.name === "AbortError");

export async function uw(path, params = {}, { envelope = false } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;

    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(k, String(item));
      }
      continue;
    }
    url.searchParams.set(k, String(v));
  }

  const limitMs = vendorTimeoutMs();
  let timeouts = 0;
  for (let attempt = 0; attempt <= RATE.maxRetries; attempt++) {

    stats.permitWaitMs += await permits.acquire();
    stats.calls++;
    let response;
    const wireStarted = Date.now();
    const landed = permits.enter();
    try {
      response = await fetch(url, {
        headers: {
          Authorization: "Bearer " + process.env.UW_API_KEY,
          Accept: "application/json",
        },
        ...(limitMs ? { signal: AbortSignal.timeout(limitMs) } : {}),
      });
    } catch (error) {
      stats.networkMs += Date.now() - wireStarted;
      landed();
      wireProgress.settled();
      stats.retries++;
      ({ delayMs, floorMs: delayFloorMs } = stepRateController(
        { delayMs, floorMs: delayFloorMs }, "error"));
      const timedOut = !!limitMs && isTimeout(error);
      if (timedOut) {
        stats.timedOut++;
        timeouts++;
      }
      if (attempt === RATE.maxRetries || (timedOut && timeouts > LIVE_VENDOR.timeoutRetries)) throw error;
      continue;
    }
    stats.networkMs += Date.now() - wireStarted;
    landed();
    wireProgress.settled();

    if (response.status === 429) {
      stats.rateLimited++;
      const retryAfter = Number(response.headers.get("Retry-After"));

      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, RATE.maxRetryAfterMs)
        : Math.min(delayMs * 4, RATE.maxDelayMs);

      ({ delayMs, floorMs: delayFloorMs } = stepRateController(
        { delayMs, floorMs: delayFloorMs }, "limited"));

      stats.rateLimitQueueMs += permits.defer(wait);
      stats.rateLimitWaitMs += wait;
      wireProgress.quiet(wait);
      await sleep(wait);
      continue;
    }

    if (response.status >= 500) {
      stats.retries++;
      ({ delayMs, floorMs: delayFloorMs } = stepRateController(
        { delayMs, floorMs: delayFloorMs }, "error"));
      if (attempt === RATE.maxRetries) throw new Error(`${path} -> HTTP ${response.status}`);
      continue;
    }

    if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);

    ({ delayMs, floorMs: delayFloorMs } = stepRateController(
      { delayMs, floorMs: delayFloorMs }, "ok"));
    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (limitMs && isTimeout(error)) stats.timedOut++;
      throw error;
    } finally {
      wireProgress.settled();
    }
    if (envelope) return body;
    return Array.isArray(body) ? body : (body && body.data) || [];
  }
  throw new Error(`${path} -> exhausted retries`);
}
