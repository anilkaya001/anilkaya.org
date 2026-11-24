import { LIVE_BUDGET, LIVE_KEYS, checkLiveWrite } from "../shared/flows-live.js";
import { liveWindow, runLive, universeReader } from "../shared/flows-live-pass.js";
import {
  batchWithLedger, clockPatchStatement, heartbeatLedger, liveMode, readClock, readLive, writeLiveStatement,
} from "../shared/flows-live-worker.js";
import { fixtureRefusal } from "../shared/flows-fixture-names.js";
import { vendorRedirected } from "../shared/flows-vendor-core.js";
import { pathFor } from "../shared/flows-vendor-ops.js";
import { shapeNews } from "../shared/flows-news.js";

export const TIER2_WRITER = "worker@tier2";

const CUTOFF_MS = 120_000;
const DEADLINE_MS = 8_000;
const MAX_BODY_BYTES = 384 * 1024;
const SCREENER_BYTES = 1280 * 1024;
const SCREENER_PATH = pathFor("screener-stocks");
const CONCURRENCY = 4;
const quiet = () => {};

function pacedVendor(fetchVendor, expires, now, wait) {
  let inFlight = 0;
  let nextAt = 0;
  let limited = false;
  let pumping = false;
  const pending = [];
  const meter = { calls: 0, failedCalls: 0 };

  const closed = () => limited || meter.calls >= LIVE_BUDGET.tier2MaxCalls || now() >= expires;

  const drain = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length && inFlight < CONCURRENCY) {
        if (closed()) {
          const error = new Error("Tier 2 feed budget closed");
          for (const { reject } of pending.splice(0)) reject(error);
          return;
        }
        const pause = nextAt - now();
        if (pause > 0) await wait(pause);
        if (closed()) continue;
        const { path, params, resolve, reject } = pending.shift();
        const started = now();
        const deadlineMs = Math.min(DEADLINE_MS, expires - started);
        const maxBytes = path === SCREENER_PATH ? SCREENER_BYTES : MAX_BODY_BYTES;
        nextAt = started + LIVE_BUDGET.tier2PaceMs;
        meter.calls++;
        inFlight++;
        void Promise.resolve().then(() => fetchVendor(path, params, { deadlineMs, maxBytes }))
          .then(resolve, (error) => {
            meter.failedCalls++;
            if (error && error.upstream === 429) limited = true;
            reject(error);
          })
          .finally(() => {
            inFlight--;
            void drain();
          });
      }
    } finally {
      pumping = false;
    }
  };

  const uw = (path, params) => new Promise((resolve, reject) => {
    pending.push({ path, params, resolve, reject });
    void drain();
  });
  return { uw, meter };
}

async function slotClaim(db, at, now) {
  const result = await db.prepare(
    "UPDATE flows_clock SET live_dispatched_at = ?, updated_at = MAX(COALESCE(updated_at, 0), ?) " +
    "WHERE id = 1 AND (live_dispatched_at IS NULL OR live_dispatched_at < ?)",
  ).bind(at, now, at).run();
  return Number(result.meta && result.meta.changes) === 1;
}

export async function tier2Tick(env, at, {
  fetchVendor, store, log = console, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (liveMode(env) !== "worker") return { skipped: "mode" };
  if (!env.DB || !env.UW_API_KEY || typeof fetchVendor !== "function" || !store) return { skipped: "unconfigured" };
  if (vendorRedirected(env)) return { skipped: "redirected-feed" };
  const db = env.DB;
  const expires = at + CUTOFF_MS;
  if (!Number.isFinite(at) || now() >= expires) return { skipped: "late-slot" };
  const clock = await readClock(db);
  const window = liveWindow(at, clock);
  if (!window.run) return { skipped: window.why };
  if (!clock || !(await slotClaim(db, at, now()))) return { skipped: "no-slot" };

  const readStored = async (key) => {
    const trace = {};
    const row = key.startsWith("live:")
      ? await readLive(db, key, { strict: true })
      : await store.read(env, key, trace);
    if (trace.failed) throw new Error("Tier 2 store read failed: " + key);
    return row ? { payload: JSON.parse(row.payload) } : null;
  };
  const { uw, meter } = pacedVendor(fetchVendor, expires, now, wait);
  const statements = [];
  let ledger = null;
  const publish = (key, payload) => {
    if (LIVE_KEYS[key]?.writer !== "actions") throw new Error("Tier 2 cannot write " + key);
    const body = { ...payload, fresh: { ...payload.fresh, source: "worker" } };
    if (key === "live:heartbeat") body.run = { ...body.run, ...meter };
    const verdict = checkLiveWrite(key, body, { source: "worker", tier2Writer: "worker" });
    if (!verdict.ok) throw new Error(verdict.code);
    const text = JSON.stringify(body);
    if (fixtureRefusal(key, text)) throw new Error("Tier 2 fixture refused");
    if (text.length > LIVE_KEYS[key].maxBytes) throw new Error("Tier 2 payload exceeds its byte cap");
    statements.push(writeLiveStatement(db, key, text, verdict.meta, now()));
    if (key === "live:heartbeat") {
      statements.push(clockPatchStatement(db, { liveDoneAt: now(), dispatchWhy: "worker-owner" }, now()));
      ledger = heartbeatLedger(db, body, verdict.meta);
    }
  };

  const result = await runLive({
    uw, publish, readStored, now, log: quiet, warn: quiet, shapeNews, clock, skipRecent: false,
    writer: TIER2_WRITER, origin: "worker-cron", universe: universeReader(readStored),
  });
  if (result.skipped) return result;
  if (now() >= expires || !ledger) throw new Error("Tier 2 pass expired or did not build a heartbeat");
  await batchWithLedger(db, statements, ledger);
  if (!result.published.some((key) => key !== "live:heartbeat")) {
    log.warn(JSON.stringify({ message: "Tier 2 published only a heartbeat", ...meter }));
  }
  return { ...result, run: { ...result.run, ...meter } };
}
