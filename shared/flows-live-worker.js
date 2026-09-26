import {
  LIVE_KEYS, LIVE_BUDGET, TIER1_CALLS, TAPE_SPEC, shapeMarketLive, tideSessionState, tideLastAt, checkLiveWrite,
  liveKeyFromParam, shapeTapePrem, shapeTapeGex, assembleTape, nextTapeLeg, pulseWithLive, liveAlertsWin,
  nightlyFreshMeta, rowsOf, timeMs, anyAnswered, marketFeeds, VERDICT, verdictPatch, parseClosedDays,
} from "./flows-live.js";
import {
  FRESH_CLASSES, PHASE_MINUTES, LIVE_CLOCK, freshHeaders, pendingHeaders, phaseAt, tier1Due, liveDispatchDue,
  liveStalled, nightlyDispatchDue, easternDay, easternInstant, sessionOpen, clockClosed,
} from "./flows-freshness.js";
import { LIVE_OIDC, looksLikeJwt, rsaKeys, verifyLiveOidc, claimsBrief } from "./flows-oidc.js";

export { looksLikeJwt };

export const LIVE_SCHEMA_SQL = Object.freeze([
  "CREATE TABLE IF NOT EXISTS flows_live (id TEXT PRIMARY KEY CHECK (id GLOB 'live:*'), payload TEXT NOT NULL, " +
    "read_at INTEGER NOT NULL CHECK (read_at > 0), session TEXT NOT NULL, cadence_s INTEGER NOT NULL CHECK (cadence_s > 0), " +
    "source TEXT NOT NULL CHECK (source IN ('worker', 'actions')), writer TEXT NOT NULL, updated_at INTEGER NOT NULL CHECK (updated_at > 0))",
  "CREATE TABLE IF NOT EXISTS flows_tape (ticker TEXT PRIMARY KEY CHECK (length(ticker) BETWEEN 1 AND 10), payload TEXT, " +
    "read_at INTEGER, session TEXT, legs INTEGER NOT NULL DEFAULT 0, refreshing_until INTEGER, last_served INTEGER)",
  "CREATE TABLE IF NOT EXISTS flows_clock (id INTEGER PRIMARY KEY CHECK (id = 1), day TEXT, trading INTEGER, " +
    "early_close INTEGER, tape_at INTEGER, tape_moved_at INTEGER, live_dispatched_at INTEGER, live_done_at INTEGER, " +
    "live_redispatched_at INTEGER, nightly_day TEXT, nightly_dispatched_at INTEGER, nightly_redispatched_at INTEGER, " +
    "summary_stamp TEXT, updated_at INTEGER, tier1_at INTEGER, tier1_ok_at INTEGER, tier1_why TEXT, " +
    "closed_probe_at INTEGER, closed_days TEXT, dispatch_why TEXT)",
  "CREATE TRIGGER IF NOT EXISTS flows_archive_immutable BEFORE UPDATE ON flows_payload " +
    "WHEN OLD.id GLOB 'board:*:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' " +
    "OR OLD.id GLOB 'scores:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' " +
    "BEGIN SELECT RAISE(ABORT, 'flows archive rows are immutable'); END",
]);

export const CLOCK_ADDED_COLUMNS = Object.freeze([
  Object.freeze(["tier1_at", "INTEGER"]), Object.freeze(["tier1_ok_at", "INTEGER"]), Object.freeze(["tier1_why", "TEXT"]),
  Object.freeze(["closed_probe_at", "INTEGER"]), Object.freeze(["closed_days", "TEXT"]), Object.freeze(["dispatch_why", "TEXT"]),
]);

export async function upgradeClockColumns(db) {
  if (!db) return [];
  let have = new Set();
  try {
    const info = await db.prepare("PRAGMA table_info(flows_clock)").all();
    have = new Set(((info && info.results) || []).map((r) => r && r.name));
  } catch {
    have = new Set();
  }
  const added = [];
  for (const [column, type] of CLOCK_ADDED_COLUMNS) {
    if (have.has(column)) continue;
    try {
      await db.prepare(`ALTER TABLE flows_clock ADD COLUMN ${column} ${type}`).run();
      added.push(column);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column/i.test(message)) throw error;
    }
  }
  return added;
}

export const RTH_CRON = "1-59/5 13-21 * * 1-5";
export const HOUSEKEEPING_CRON = "*/30 * * * *";

export function cronJob(cron, at) {
  if (cron === RTH_CRON) return "rth";
  if (cron === HOUSEKEEPING_CRON) return "housekeeping";
  const d = new Date(Number.isFinite(at) ? at : Date.now());
  const weekday = d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
  const hour = d.getUTCHours();
  return weekday && hour >= 13 && hour <= 21 && d.getUTCMinutes() % 30 !== 0 ? "rth" : "housekeeping";
}

export const NIGHTLY_READ_KEYS = Object.freeze(["board:long", "board:short", "board:watch", "meta", "focus"]);

export const NIGHTLY_MISSING_AFTER_MIN = 300;

export const NOW_NIGHTLY_KEYS = Object.freeze([
  "board:long", "board:short", "board:watch", "brief", "pulse", "flowalerts", "market", "meta", "events",
  "movers", "news", "unusual", "political", "record", "scoretrack", "sector:trix", "sector:premium",
]);

const CLOCK_COLUMNS = Object.freeze({
  day: "day", trading: "trading", earlyClose: "early_close", tapeAt: "tape_at", tapeMovedAt: "tape_moved_at",
  liveDispatchedAt: "live_dispatched_at", liveDoneAt: "live_done_at", liveRedispatchedAt: "live_redispatched_at",
  nightlyDay: "nightly_day", nightlyDispatchedAt: "nightly_dispatched_at",
  nightlyRedispatchedAt: "nightly_redispatched_at", summaryStamp: "summary_stamp",
  tier1At: "tier1_at", tier1OkAt: "tier1_ok_at", tier1Why: "tier1_why",
  closedProbeAt: "closed_probe_at", closedDays: "closed_days", dispatchWhy: "dispatch_why",
});

export function tier1Why(value) {
  const raw = typeof value === "string" ? value : "";
  if (!raw.startsWith("error:")) return raw.slice(0, 24);
  return "error:" + raw.slice(6).replace(/[^\w .:-]+/g, " ").trim().slice(0, 48);
}

const CLOCK_MEMO_MS = 60 * 1000;
let clockMemo = { at: 0, clock: null };

export function memoClock(clock, now = Date.now()) {
  clockMemo = { at: now, clock };
}

export function memoizedClock(now = Date.now()) {
  return clockMemo.at > 0 && now - clockMemo.at < 10 * CLOCK_MEMO_MS ? clockMemo.clock : null;
}

export function normalizeClock(row) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  for (const [camel, col] of Object.entries(CLOCK_COLUMNS)) {
    const v = row[col];
    out[camel] = v === undefined ? null : v;
  }
  out.closedDays = parseClosedDays(out.closedDays);
  return out;
}

export async function readClock(db) {
  if (!db) return null;
  const row = await db.prepare("SELECT * FROM flows_clock WHERE id = 1").first().catch(() => null);
  return normalizeClock(row);
}

export async function cachedClock(env, now = Date.now()) {
  if (clockMemo.clock !== undefined && now - clockMemo.at < CLOCK_MEMO_MS && clockMemo.at > 0) return clockMemo.clock;
  const clock = await readClock(env && env.DB);
  memoClock(clock, now);
  return clock;
}

export function clockPatchStatement(db, patch, now) {
  const cols = Object.keys(patch).filter((k) => Object.hasOwn(CLOCK_COLUMNS, k))
    .map((k) => [CLOCK_COLUMNS[k], Array.isArray(patch[k]) ? JSON.stringify(patch[k]) : patch[k]]);
  const names = ["id", ...cols.map(([c]) => c), "updated_at"];
  const values = [1, ...cols.map(([, v]) => v), now];
  const sets = [...cols.map(([c]) => `${c} = excluded.${c}`), "updated_at = excluded.updated_at"];
  return db.prepare(
    `INSERT INTO flows_clock (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${sets.join(", ")}`,
  ).bind(...values);
}

export function writeLiveStatement(db, key, text, meta, now) {
  return db.prepare(
    "INSERT INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, " +
    "read_at = excluded.read_at, session = excluded.session, cadence_s = excluded.cadence_s, " +
    "source = excluded.source, writer = excluded.writer, updated_at = excluded.updated_at " +
    "WHERE excluded.read_at >= flows_live.read_at",
  ).bind(key, text, meta.readAt, meta.session, meta.cadenceS, meta.source, meta.writer, now);
}

export async function readLive(db, key) {
  if (!db) return null;
  const row = await db.prepare(
    "SELECT payload, read_at, session, cadence_s, source, writer, updated_at FROM flows_live WHERE id = ?",
  ).bind(key).first().catch(() => null);
  return row && row.payload ? liveRow(row) : null;
}

const liveRow = (row) => ({
  payload: row.payload, readAt: Number(row.read_at), session: row.session, cadenceS: Number(row.cadence_s),
  source: row.source, writer: row.writer, updatedAt: Number(row.updated_at),
});

export function liveMeta(row) {
  return { readAt: row.readAt, session: row.session, cadenceS: row.cadenceS, source: row.source };
}

const withTimeout = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ __failed: "timeout after " + ms + " ms" }), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); },
    (e) => { clearTimeout(timer); resolve({ __failed: e && e.message ? String(e.message) : String(e) }); });
});

export async function tier1Reads(fetchVendor, { timeoutMs = LIVE_BUDGET.tier1TimeoutMs } = {}) {
  const results = await Promise.all(TIER1_CALLS.map((c) => withTimeout(fetchVendor(c.path, c.params), timeoutMs)));
  const raws = {};
  TIER1_CALLS.forEach((c, i) => { raws[c.feed] = results[i]; });
  return raws;
}

const clockFlag = (v) => (v === null || v === undefined || v === "" ? null : Number(v) === 1 ? 1 : Number(v) === 0 ? 0 : null);

export function verdictReprobeDue(at, clock) {
  const wall = phaseAt(at, clock);
  return !!wall && wall.minutes >= PHASE_MINUTES.sessionProbe && wall.minutes < VERDICT.provisionalUntilMin &&
    wall.minutes % VERDICT.reprobeEveryMin < 5;
}

export function sessionStatePatch(clock, raws, at, today) {
  const wall = phaseAt(at, clock);
  const patch = {};
  const same = !!clock && clock.day === today;
  if (!same) Object.assign(patch, { day: today, trading: null, earlyClose: null, tapeAt: null, tapeMovedAt: null,
    closedProbeAt: null });
  const trading = same ? clockFlag(clock.trading) : null;
  if (wall && wall.minutes >= PHASE_MINUTES.sessionProbe &&
      (trading === null || (trading === 0 && wall.minutes < VERDICT.provisionalUntilMin))) {
    Object.assign(patch, verdictPatch({
      seen: tideSessionState(raws, { today, afterProbe: true }), trading,
      closedProbeAt: same ? clock.closedProbeAt : null, closedDays: clock ? clock.closedDays : [], at, today,
    }));
  }
  const last = tideLastAt(raws.tide);
  if (Number.isFinite(last) && easternDay(last) === today) {
    const heldAt = same ? Number(clock.tapeAt) : NaN;
    if (!(last <= heldAt)) { patch.tapeAt = last; patch.tapeMovedAt = at; }
    const movedAt = Object.hasOwn(patch, "tapeMovedAt") ? patch.tapeMovedAt : Number(same ? clock.tapeMovedAt : NaN);
    const tradingNow = Object.hasOwn(patch, "trading") ? patch.trading : trading;
    const early = easternInstant(today, PHASE_MINUTES.earlyClose + 5);
    if (Number(tradingNow) === 1 && !(same && Number(clock.earlyClose) === 1) &&
        wall && wall.minutes >= PHASE_MINUTES.earlyClose + 30 && last <= early &&
        Number.isFinite(movedAt) && at - movedAt >= LIVE_CLOCK.earlyCloseQuietMs) {
      patch.earlyClose = 1;
    }
  }
  return patch;
}

export function dispatchOutcome(sent) {
  if (!sent) return null;
  if (sent.sent) return "sent";
  return (sent.why + (sent.status ? ":" + sent.status : "")).slice(0, 24);
}

export function dispatchBase(env) {
  const raw = env && typeof env.GITHUB_API_BASE === "string" ? env.GITHUB_API_BASE.trim().replace(/\/+$/, "") : "";
  if (!raw) return "https://api.github.com";
  return /^https:\/\/api\.github\.com$|^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(raw) ? raw : null;
}

export async function dispatchWorkflow(env, workflow, inputs, fetchImpl = fetch) {
  const token = env && typeof env.GITHUB_DISPATCH_TOKEN === "string" ? env.GITHUB_DISPATCH_TOKEN.trim() : "";
  if (!token) return { sent: false, why: "no-token" };
  const base = dispatchBase(env);
  if (!base) return { sent: false, why: "bad-base" };
  const repo = env.FLOWS_LIVE_REPO || "anilkaya001/anilkaya.org";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { sent: false, why: "bad-repo" };
  try {
    const res = await fetchImpl(`${base}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "anilkaya-flows-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: env.FLOWS_LIVE_REF || "main", inputs }),
    });
    return { sent: res.status === 204, status: res.status, why: res.status === 204 ? "sent" : "refused" };
  } catch (error) {
    return { sent: false, why: "unreachable", error: error instanceof Error ? error.message : String(error) };
  }
}

export function liveMode(env) {
  const m = env && typeof env.FLOWS_LIVE_MODE === "string" ? env.FLOWS_LIVE_MODE.trim() : "";
  return m === "off" ? "off" : m === "worker" ? "worker" : "actions";
}

export async function rthTick(env, at, { fetchVendor, fetchImpl = fetch, log = console } = {}) {
  const out = { tier1: null, dispatch: null, watchdog: null };
  if (!env || !env.DB) return { ...out, skipped: "no-db" };
  const telemetry = await clockPatchStatement(env.DB, { tier1At: at }, at).run().then(() => true, () => false);
  out.telemetry = telemetry;
  if (liveMode(env) === "off") {
    if (telemetry) await clockPatchStatement(env.DB, { tier1Why: "off" }, at).run().catch(() => {});
    return { ...out, skipped: "off" };
  }
  const today = easternDay(at);
  const [clockRes, breadthRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM flows_clock WHERE id = 1"),
    env.DB.prepare("SELECT read_at FROM flows_live WHERE id = 'live:breadth'"),
  ]).catch(() => [null, null]);
  const clock = normalizeClock(clockRes && clockRes.results ? clockRes.results[0] : null);
  const breadthReadAt = breadthRes && breadthRes.results && breadthRes.results[0]
    ? Number(breadthRes.results[0].read_at) : null;
  const closedToday = !!clock && clock.day === today && clockClosed(clock.trading);
  const reprobe = closedToday && verdictReprobeDue(at, clock);
  if (closedToday && !reprobe) {
    if (telemetry) await clockPatchStatement(env.DB, { tier1Why: "holiday" }, at).run().catch(() => {});
    memoClock({ ...clock, tier1At: at, tier1Why: telemetry ? "holiday" : clock.tier1Why }, at);
    return { ...out, skipped: "holiday" };
  }
  const statements = [];
  const patch = {};
  let why = "not-due";

  if (reprobe || tier1Due(at, clock)) {
    if (!env.UW_API_KEY || typeof fetchVendor !== "function") why = "error:no-key";
    else {
      try {
        const raws = await tier1Reads(fetchVendor);
        Object.assign(patch, sessionStatePatch(clock, raws, at, today));
        const payload = shapeMarketLive(raws, { at, session: today, writer: "worker@tier1" });
        const text = JSON.stringify(payload);
        const spec = LIVE_KEYS["live:market"];
        const statuses = { tide: payload.tide.status, sectors: payload.sectors.status };
        if (reprobe && patch.trading !== 1) {
          why = "holiday";
          out.tier1 = { written: false, why, reprobe: true, statuses };
        } else if (!anyAnswered(marketFeeds(payload))) {
          why = "no-feed-answered";
          out.tier1 = { written: false, why, bytes: text.length, statuses };
          log.error(JSON.stringify({ message: "live:market not written: no vendor feed answered", statuses }));
        } else if (text.length > spec.maxBytes) {
          why = "over-cap";
          out.tier1 = { written: false, why, bytes: text.length, statuses };
          log.error(JSON.stringify({ message: "live:market over its byte cap", bytes: text.length, cap: spec.maxBytes }));
        } else {
          statements.push(writeLiveStatement(env.DB, "live:market", text, {
            readAt: at, session: today, cadenceS: spec.cadenceS, source: "worker", writer: "worker@tier1",
          }, at));
          why = "written";
          patch.tier1OkAt = at;
          out.tier1 = { written: true, bytes: text.length, statuses };
        }
      } catch (error) {
        why = tier1Why("error:" + (error instanceof Error ? error.message : String(error)));
        out.tier1 = { written: false, why };
        log.error(JSON.stringify({ message: "tier 1 read failed", why }));
      }
    }
  }
  if (!telemetry) delete patch.tier1OkAt;
  else if (why !== "not-due") patch.tier1Why = tier1Why(why);

  const merged = { ...(clock || {}), ...patch };
  const due = liveDispatchDue(at, merged);
  if (due.due) {
    const sent = await dispatchWorkflow(env, env.FLOWS_LIVE_WORKFLOW || "flows-live.yml",
      { tick: new Date(at).toISOString(), origin: "worker" }, fetchImpl);
    out.dispatch = sent;
    if (dispatchOutcome(sent)) patch.dispatchWhy = dispatchOutcome(sent);
    if (sent.sent) patch.liveDispatchedAt = at;
    else if (sent.why !== "no-token") log.error(JSON.stringify({ message: "live dispatch failed", ...sent }));
  } else out.dispatch = { sent: false, why: due.why };

  if (liveStalled(at, breadthReadAt, merged)) {
    const ageMin = Number.isFinite(breadthReadAt) && breadthReadAt > 0 ? Math.round((at - breadthReadAt) / 60000) : null;
    const canDispatch = !!env.GITHUB_DISPATCH_TOKEN;
    log.error(JSON.stringify({ message: "live layer stalled", ageMin, canDispatch,
      dispatchedAt: merged.liveDispatchedAt || null, doneAt: merged.liveDoneAt || null }));
    const again = Number(merged.liveRedispatchedAt);
    const episode = Number.isFinite(again) && again > 0 && at - again < LIVE_CLOCK.watchdogMs;
    if (canDispatch && !episode && !(out.dispatch && out.dispatch.sent)) {
      const sent = await dispatchWorkflow(env, env.FLOWS_LIVE_WORKFLOW || "flows-live.yml",
        { tick: new Date(at).toISOString(), origin: "watchdog" }, fetchImpl);
      out.watchdog = { stalled: true, ageMin, redispatch: sent };
      if (dispatchOutcome(sent)) patch.dispatchWhy = dispatchOutcome(sent);
      if (sent.sent) { patch.liveRedispatchedAt = at; patch.liveDispatchedAt = at; }
    } else out.watchdog = { stalled: true, ageMin, redispatch: null };
  }

  if (Object.keys(patch).length) statements.push(clockPatchStatement(env.DB, patch, at));
  if (statements.length) await env.DB.batch(statements);
  memoClock({ ...(clock || {}), ...(telemetry ? { tier1At: at } : {}), ...patch }, at);
  out.why = why;
  return out;
}

export async function nightlyTick(env, at, { fetchImpl = fetch, log = console } = {}) {
  if (!env || !env.DB || liveMode(env) === "off") return { skipped: "off" };
  const [clockRes, metaRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM flows_clock WHERE id = 1"),
    env.DB.prepare("SELECT json_extract(payload, '$.sessionDate') AS session FROM flows_payload WHERE id = 'meta'"),
  ]).catch(() => [null, null]);
  const clock = normalizeClock(clockRes && clockRes.results ? clockRes.results[0] : null);
  const metaSession = metaRes && metaRes.results && metaRes.results[0] && typeof metaRes.results[0].session === "string"
    ? metaRes.results[0].session.slice(0, 10) : null;
  const due = nightlyDispatchDue(at, clock, metaSession);
  const today = easternDay(at);
  const wall = phaseAt(at, clock);
  if (wall && due.why !== "landed" && due.why !== "not-trading" &&
      wall.minutes >= PHASE_MINUTES.close + NIGHTLY_MISSING_AFTER_MIN) {
    log.error(JSON.stringify({ message: "nightly missing", today, metaSession }));
  }
  if (!due.due) return { due: false, why: due.why, metaSession };
  const sent = await dispatchWorkflow(env, env.FLOWS_NIGHTLY_WORKFLOW || "flows-pipeline.yml",
    { origin: "worker" }, fetchImpl);
  if (sent.sent) {
    const patch = due.redispatch
      ? { nightlyRedispatchedAt: at }
      : { nightlyDay: today, nightlyDispatchedAt: at, nightlyRedispatchedAt: null };
    await clockPatchStatement(env.DB, { ...patch, dispatchWhy: "sent" }, at).run();
  } else {
    if (sent.why !== "no-token") log.error(JSON.stringify({ message: "nightly dispatch failed", ...sent }));
    const outcome = dispatchOutcome(sent);
    if (!clock || clock.dispatchWhy !== outcome) {
      await clockPatchStatement(env.DB, { dispatchWhy: outcome }, at).run().catch(() => {});
    }
  }
  return { due: true, redispatch: !!due.redispatch, sent, metaSession };
}

export function pruneDue(at) {
  const p = phaseAt(at, null);
  return !!p && p.minutes >= 3 * 60 && p.minutes < 3 * 60 + 30;
}

export async function pruneTape(env, now) {
  if (!env || !env.DB) return 0;
  const res = await env.DB.prepare(
    "DELETE FROM flows_tape WHERE last_served IS NULL OR last_served < ?",
  ).bind(now - LIVE_BUDGET.tapeRetentionMs).run().catch(() => null);
  return res && res.meta ? Number(res.meta.changes) || 0 : 0;
}

export function tokenKind(offered, env, equal) {
  if (!offered) return null;
  if (env.FLOWS_INGEST_TOKEN && equal(offered, env.FLOWS_INGEST_TOKEN)) return "nightly";
  if (env.FLOWS_LIVE_TOKEN && equal(offered, env.FLOWS_LIVE_TOKEN)) return "live";
  return null;
}

export const JWKS_TTL_MS = 60 * 60 * 1000;
export const JWKS_RETRY_MS = 60 * 1000;
export const JWKS_COLD_RETRY_MS = 5 * 1000;
const emptyMemo = (url) => ({ url, keys: null, at: 0, triedAt: 0, inflight: null });
let jwksMemo = emptyMemo(null);

export function resetJwksMemo() {
  jwksMemo = emptyMemo(null);
}

export function jwksUrl(env) {
  const raw = env && typeof env.GITHUB_OIDC_JWKS === "string" ? env.GITHUB_OIDC_JWKS.trim() : "";
  if (!raw) return LIVE_OIDC.jwks;
  return /^https:\/\/token\.actions\.githubusercontent\.com\/[^\s?#]*$|^http:\/\/(127\.0\.0\.1|localhost):\d+\/[^\s?#]*$/.test(raw)
    ? raw : null;
}

export function jwksKeys(env, fetchImpl, now, force) {
  const url = jwksUrl(env);
  if (!url) return Promise.resolve(null);
  if (jwksMemo.url !== url) jwksMemo = emptyMemo(url);
  const memo = jwksMemo;
  if (memo.inflight) return memo.inflight;
  const fresh = !!memo.keys && now - memo.at < JWKS_TTL_MS;
  const wait = memo.keys ? JWKS_RETRY_MS : JWKS_COLD_RETRY_MS;
  if ((fresh && !force) || now - memo.triedAt < wait) return Promise.resolve(memo.keys);
  memo.triedAt = now;
  memo.inflight = fetchImpl(url, {
    redirect: "manual", signal: AbortSignal.timeout(4000),
    headers: { Accept: "application/json", "User-Agent": "anilkaya-flows-worker" },
  }).then((res) => (res.ok ? res.json().then(rsaKeys) : [])).catch(() => []).then((keys) => {
    if (keys.length) {
      memo.keys = keys;
      memo.at = now;
    }
    memo.inflight = null;
    return memo.keys;
  });
  return memo.inflight;
}

export async function oidcKind(offered, env, { fetchImpl = fetch, now = Date.now(), log = console } = {}) {
  if (!looksLikeJwt(offered)) return { kind: null, why: "not-a-jwt", unavailable: false };
  const out = await verifyLiveOidc(offered, (force) => jwksKeys(env, fetchImpl, now, force), now);
  if (out.ok) return { kind: "live", why: null, unavailable: false };
  const unavailable = out.why === "keys-unavailable";
  if (out.why !== "malformed") {
    log.error(JSON.stringify({
      message: unavailable ? "live OIDC key set unavailable" : "live OIDC token refused",
      why: out.why, jwks: jwksUrl(env) ? "ok" : "bad-override", claims: claimsBrief(out.claims),
    }));
  }
  return { kind: null, why: out.why, unavailable };
}

export function ingestScope(key, method, kind) {
  const live = key.startsWith("live:");
  if (kind === "live") {
    if (method === "DELETE") return { ok: false, status: 403, code: "live_token_scope", message: "The live token cannot delete" };
    if (live) return { ok: true };
    if (method === "GET" && NIGHTLY_READ_KEYS.includes(key)) return { ok: true };
    return { ok: false, status: 403, code: "live_token_scope", message: "The live token writes live:* keys only" };
  }
  if (kind === "nightly") {
    if (live && method !== "GET") {
      return { ok: false, status: 403, code: "nightly_token_scope", message: "The nightly token cannot write live:* keys" };
    }
    return { ok: true };
  }
  return { ok: false, status: 401, code: "unauthorized", message: "Authentication required" };
}

export async function ingestLive(env, key, method, text, now, { json }) {
  if (!Object.hasOwn(LIVE_KEYS, key)) return json({ error: { code: "invalid_key", message: "Unknown payload key" } }, 400);
  if (method === "GET") {
    const row = await readLive(env.DB, key);
    if (!row) return json({ key, status: "pending" });
    return new Response(row.payload, { status: 200, headers: {
      "Content-Type": "application/json; charset=utf-8", "X-Payload-Updated": String(row.updatedAt || 0),
      "X-Fresh-Read-At": new Date(row.readAt).toISOString(), "X-Fresh-Session": row.session || "",
    } });
  }
  let body;
  try { body = JSON.parse(text); } catch {
    return json({ error: { code: "invalid_payload", message: "Payload is not valid JSON" } }, 400);
  }
  const spec = LIVE_KEYS[key];
  if (text.length > spec.maxBytes) {
    return json({ error: { code: "too_large", message: `${key} is capped at ${spec.maxBytes} bytes` } }, 413);
  }
  const verdict = checkLiveWrite(key, body, { source: "actions" });
  if (!verdict.ok) return json({ error: { code: verdict.code, message: verdict.message } }, verdict.status);
  const statements = [writeLiveStatement(env.DB, key, text, verdict.meta, now)];
  if (key === "live:heartbeat") statements.push(clockPatchStatement(env.DB, { liveDoneAt: now }, now));
  const results = await env.DB.batch(statements);
  const changed = results && results[0] && results[0].meta ? Number(results[0].meta.changes) || 0 : 0;
  return json({ ok: true, key, bytes: text.length, stored: changed ? "written" : "older-than-held" });
}

export function liveResponse(row, now, clock, extra = {}) {
  const { headers } = freshHeaders(liveMeta(row), now, clock);
  return new Response(row.payload, { status: 200, headers: {
    "Content-Type": "application/json; charset=utf-8", "X-Payload-Updated": String(row.updatedAt || 0),
    ...headers, ...extra,
  } });
}

export async function serveLiveKey(env, url, now, { json, HttpError }) {
  const key = liveKeyFromParam(url.searchParams.get("k"));
  if (!key) throw new HttpError(400, "invalid_key", "Unknown live key");
  const clock = await cachedClock(env, now);
  const row = await readLive(env.DB, key);
  if (!row) {
    return json({ key, status: "pending" }, 200, pendingHeaders(LIVE_KEYS[key].klass, now, clock));
  }
  return liveResponse(row, now, clock);
}

export function parseList(raw, allow, max = 16) {
  const out = [];
  for (const part of String(raw || "").split(",")) {
    const v = part.trim();
    if (!v || out.includes(v)) continue;
    if (allow(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

const isoOf = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? new Date(Number(v)).toISOString() : null);

export function tier1View(clock) {
  return { at: isoOf(clock && clock.tier1At), okAt: isoOf(clock && clock.tier1OkAt),
    why: clock && typeof clock.tier1Why === "string" ? clock.tier1Why : null };
}

export function clockView(clock) {
  return clock && typeof clock.day === "string"
    ? { day: clock.day, trading: clockFlag(clock.trading), earlyClose: clockFlag(clock.earlyClose),
      closedDays: parseClosedDays(clock.closedDays) }
    : null;
}

export function ingestClockView(clock) {
  const view = clockView(clock);
  return view ? { ...view, tier1: tier1View(clock),
    dispatchWhy: typeof clock.dispatchWhy === "string" ? clock.dispatchWhy : null } : null;
}

export async function serveIngestClock(env, { json }) {
  return json({ key: "clock", clock: ingestClockView(await readClock(env && env.DB)) });
}

export async function serveNow(env, url, now, { json, HttpError, quote }) {
  const liveKeys = parseList(url.searchParams.get("k"), (k) => liveKeyFromParam(k) !== null).map(liveKeyFromParam);
  const nightly = parseList(url.searchParams.get("n"),
    (k) => NOW_NIGHTLY_KEYS.includes(k) || /^card:[A-Z][A-Z0-9.-]{0,9}$/.test(k));
  const clock = await cachedClock(env, now);
  const phase = phaseAt(now, clock);
  const keys = {};
  const place = (id, meta, updatedAt) => {
    const f = freshHeaders(meta, now, clock).fresh;
    keys[id] = {
      state: f.state, reason: f.reason, klass: f.klass, cadenceS: f.cadenceS, source: meta.source,
      session: f.session, updatedAt: updatedAt || null,
      readAt: f.readAt === null ? null : new Date(f.readAt).toISOString(),
      liveUntil: f.liveUntil === null ? null : new Date(f.liveUntil).toISOString(),
      staleAt: f.staleAt === null ? null : new Date(f.staleAt).toISOString(),
    };
  };
  const statements = [];
  if (liveKeys.length) {
    statements.push(env.DB.prepare(
      `SELECT id, read_at, session, cadence_s, source, updated_at FROM flows_live WHERE id IN (${liveKeys.map(() => "?").join(", ")})`,
    ).bind(...liveKeys));
  }
  if (nightly.length) {
    statements.push(env.DB.prepare(
      "SELECT id, updated_at, json_extract(payload, '$.sessionDate') AS session, " +
      "COALESCE(json_extract(payload, '$.readAt'), json_extract(payload, '$.generatedAt')) AS read_iso " +
      `FROM flows_payload WHERE id IN (${nightly.map(() => "?").join(", ")})`,
    ).bind(...nightly));
  }
  const results = statements.length ? await env.DB.batch(statements).catch(() => null) : [];
  if (results === null) throw new HttpError(503, "store_unreadable", "The store could not be read");
  let i = 0;
  if (liveKeys.length) {
    const rows = results[i++].results || [];
    for (const k of liveKeys) {
      const r = rows.find((x) => x.id === k);
      if (!r) { keys[k] = { state: "pending", reason: "unpublished", klass: LIVE_KEYS[k].klass }; continue; }
      place(k, { readAt: Number(r.read_at), session: r.session, cadenceS: Number(r.cadence_s), source: r.source },
        Number(r.updated_at));
    }
  }
  if (nightly.length) {
    const rows = results[i++].results || [];
    for (const k of nightly) {
      const r = rows.find((x) => x.id === k);
      if (!r) { keys[k] = { state: "pending", reason: "unpublished", klass: "nightly" }; continue; }
      place(k, nightlyFreshMeta(r), Number(r.updated_at));
    }
  }
  const iso = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? new Date(Number(v)).toISOString() : null);
  const body = {
    serverNow: now,
    tier1: { at: iso(clock && clock.tier1At), okAt: iso(clock && clock.tier1OkAt),
      why: clock && typeof clock.tier1Why === "string" ? clock.tier1Why : null },
    clock: clockView(clock),
    phase: phase ? { phase: phase.phase, session: phase.session, trading: phase.trading,
      endsAt: Number.isFinite(phase.endsAt) ? new Date(phase.endsAt).toISOString() : null } : null,
    keys,
  };
  const t = String(url.searchParams.get("t") || "").trim().toUpperCase();
  if (t && typeof quote === "function") {
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) throw new HttpError(400, "invalid_ticker", "Unknown ticker");
    body.quote = await quote(t);
  }
  return json(body, 200, { "X-Server-Now": String(now) });
}

export function quoteTtlS(now, clock) {
  const p = phaseAt(now, clock);
  const phase = p ? p.phase : "closed";
  return LIVE_BUDGET.quoteTtlS[phase] ?? LIVE_BUDGET.quoteTtlS.closed;
}

export async function ondemandAllowed(env) {
  const limiter = env && env.UW_ONDEMAND;
  if (!limiter || typeof limiter.limit !== "function") return true;
  try {
    const verdict = await limiter.limit({ key: "uw" });
    return !(verdict && verdict.success === false);
  } catch {
    return true;
  }
}

export async function serveQuote(env, ctx, ticker, now, { build, json }) {
  const clock = await cachedClock(env, now);
  const ttl = quoteTtlS(now, clock);
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const key = new Request(`https://flows-live.internal/${ticker}`, { method: "GET" });
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  const storedAt = hit ? Number(hit.headers.get("X-Quote-Stored")) : NaN;
  const age = Number.isFinite(storedAt) ? now - storedAt : Infinity;
  const respond = async (body, extra) => {
    const meta = { readAt: body.readAt, session: easternDay(timeMs(body.readAt)), cadenceS: FRESH_CLASSES.quote.cadenceS,
      klass: "quote", source: "ondemand" };
    const { headers } = freshHeaders(meta, now, clock);
    return json(body, 200, { "Cache-Control": "no-store", "X-Quote-Ttl": String(ttl), ...headers, ...extra });
  };
  if (hit && age < ttl * 1000) {
    const body = await hit.json().catch(() => null);
    if (body) return respond(body, { "X-Chain-Cache": "hit", "X-Chain-Age": String(Math.round(age / 1000)) });
  }
  if (!(await ondemandAllowed(env))) {
    const body = hit ? await hit.json().catch(() => null) : null;
    if (body) {
      const r = await respond(body, { "X-Chain-Cache": "throttled", "X-Fresh-Throttled": "1" });
      r.headers.set("X-Fresh-State", "stale");
      r.headers.set("X-Fresh-Reason", "throttled");
      return r;
    }
    return json({ ticker, status: "unavailable", why: "throttled", readAt: new Date(now).toISOString(), price: null,
      prevClose: null, changePct: null, open: null, high: null, low: null, volume: null, marketTime: null, tapeTime: null },
    200, { "Cache-Control": "no-store", "X-Fresh-State": "stale", "X-Fresh-Reason": "throttled", "X-Fresh-Throttled": "1",
      "X-Server-Now": String(now) });
  }
  const body = await build();
  if (cache && body && body.status === "ok") {
    const store = new Response(JSON.stringify(body), { headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": `max-age=${LIVE_BUDGET.quoteKeepS}`,
      "X-Quote-Stored": String(now),
    } });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(key, store).catch(() => {}));
    else await cache.put(key, store).catch(() => {});
  }
  return respond(body, { "X-Chain-Cache": "miss", "X-Chain-Age": "0" });
}

export const TAPE_LEG_BITS = Object.freeze({ prem: 1, gex: 2 });
const TAPE_COMPLETE = TAPE_LEG_BITS.prem | TAPE_LEG_BITS.gex;

function tapeTtlMs(phase, row) {
  if (!phase) return 0;
  if (Number(row && row.legs) !== TAPE_COMPLETE) return 0;
  if (phase.phase === "rth") return FRESH_CLASSES.tape.cadenceS * 1000;
  if (phase.phase === "pre" || phase.phase === "post") return LIVE_BUDGET.tapePreTtlMs;
  const current = row && typeof row.session === "string" && phase.lastClosed && row.session >= phase.lastClosed;
  return current ? Infinity : 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function tapeSession(raws, fallback) {
  let best = null;
  for (const r of rowsOf(raws && raws.ticks)) {
    const d = r && typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : easternDay(timeMs(r && r.tape_time));
    if (d && (best === null || d > best)) best = d;
  }
  return best || fallback;
}

export function tapeLegFor(heldText, heldLegs, { session = null, rth = false } = {}) {
  const mask = Number(heldLegs) || 0;
  let held = null;
  try { held = heldText ? JSON.parse(heldText) : null; } catch { held = null; }
  if (!held || typeof held !== "object" || typeof held.session !== "string") return { leg: "prem", held: null };
  if (!(mask & TAPE_LEG_BITS.prem)) return { leg: "prem", held };
  const premAt = held.prem && typeof held.prem.readAt === "string" ? timeMs(held.prem.readAt) : NaN;
  if (rth && typeof session === "string" && held.session < session && !(premAt >= sessionOpen(session))) {
    return { leg: "prem", held };
  }
  if (!(mask & TAPE_LEG_BITS.gex)) return { leg: "gex", held };
  return { leg: nextTapeLeg(held), held };
}

export async function refreshTape(env, ticker, now, { fetchVendor, heldText = null, heldLegs = 0 }) {
  const t = encodeURIComponent(ticker);
  const clock = await cachedClock(env, now);
  const phase = phaseAt(now, clock);
  const day = phase && phase.session ? phase.session : easternDay(now);
  const plan = tapeLegFor(heldText, heldLegs, { session: day, rth: !!phase && phase.phase === "rth" });
  let legs;
  let session;
  if (plan.leg === "prem") {
    const since = phase && phase.phase === "pre" && phase.lastClosed ? phase.lastClosed : day;
    const [ticks, alerts] = await Promise.all([
      withTimeout(fetchVendor(`/api/stock/${t}/net-prem-ticks`, {}), LIVE_BUDGET.tier1TimeoutMs),
      withTimeout(fetchVendor("/api/option-trades/flow-alerts",
        { ticker_symbol: ticker, newer_than: since, limit: LIVE_BUDGET.alertsPerTape * 2 }), LIVE_BUDGET.tier1TimeoutMs),
    ]);
    session = tapeSession({ ticks }, day);
    legs = shapeTapePrem({ ticks, alerts }, { at: now, session, now });
    if (legs.prem.status === "unavailable" && legs.alerts.status === "unavailable") return null;
  } else {
    session = plan.held.session;
    const spot = await withTimeout(fetchVendor(`/api/stock/${t}/spot-exposures`, { date: session }),
      LIVE_BUDGET.tier1TimeoutMs);
    legs = shapeTapeGex({ spot }, { at: now, session, now });
    if (legs.gex.status === "unavailable") return null;
  }
  const held = plan.held && plan.held.session === session ? plan.held : null;
  const payload = assembleTape(held, legs, { ticker, session });
  const mask = (held ? Number(heldLegs) || 0 : 0) | TAPE_LEG_BITS[plan.leg];
  const readAt = timeMs(payload.fresh.readAt);
  return { payload, text: JSON.stringify(payload), session, legs: mask, leg: plan.leg,
    readAt: Number.isFinite(readAt) ? readAt : now };
}

export async function serveTape(env, ctx, ticker, now, { fetchVendor, json }) {
  const db = env.DB;
  const clock = await cachedClock(env, now);
  const phase = phaseAt(now, clock);
  const read = () => db.prepare(
    "SELECT payload, read_at, session, legs, refreshing_until, last_served FROM flows_tape WHERE ticker = ?",
  ).bind(ticker).first().catch(() => null);
  const respond = (row, how) => {
    const meta = { readAt: Number(row.read_at), session: row.session, cadenceS: TAPE_SPEC.cadenceS, klass: "tape",
      source: "ondemand" };
    const { headers } = freshHeaders(meta, now, clock);
    if (!(Number(row.last_served) > now - 3600 * 1000)) {
      const touch = db.prepare("UPDATE flows_tape SET last_served = ? WHERE ticker = ?").bind(now, ticker).run().catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(touch);
    }
    return new Response(row.payload, { status: 200, headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Tape": how,
      "X-Tape-Legs": String(Number(row.legs) || 0), ...headers,
    } });
  };
  const pending = (how) => json({ ticker, status: "pending", why: how }, 200,
    { ...pendingHeaders("tape", now, clock), "X-Tape": how });

  const row = await read();
  const hasPayload = row && typeof row.payload === "string" && row.payload;
  const age = hasPayload ? now - Number(row.read_at) : Infinity;
  if (hasPayload && age <= tapeTtlMs(phase, row)) return respond(row, "fresh");
  const usable = hasPayload && (phase && phase.phase === "rth" ? age <= LIVE_BUDGET.tapeUsableMs : true);

  if (!env.UW_API_KEY) return usable ? respond(row, "stale-unconfigured") : pending("unconfigured");

  await db.prepare("INSERT OR IGNORE INTO flows_tape (ticker) VALUES (?)").bind(ticker).run().catch(() => {});
  const claim = await db.prepare(
    "UPDATE flows_tape SET refreshing_until = ? WHERE ticker = ? AND (refreshing_until IS NULL OR refreshing_until < ?)",
  ).bind(now + LIVE_BUDGET.tapeLeaseMs, ticker, now).run().catch(() => null);
  const won = !!(claim && claim.meta && Number(claim.meta.changes) === 1);

  const release = () => db.prepare("UPDATE flows_tape SET refreshing_until = NULL WHERE ticker = ?").bind(ticker).run();
  const refresh = async () => {
    try {
      if (!(await ondemandAllowed(env))) { await release(); return { throttled: true }; }
      const fresh = await refreshTape(env, ticker, now, { fetchVendor,
        heldText: hasPayload ? row.payload : null, heldLegs: row ? row.legs : 0 });
      if (!fresh) { await release(); return null; }
      await db.prepare(
        "UPDATE flows_tape SET payload = ?, read_at = ?, session = ?, legs = ?, refreshing_until = NULL, last_served = ? " +
        "WHERE ticker = ?",
      ).bind(fresh.text, fresh.readAt, fresh.session, fresh.legs, now, ticker).run();
      return fresh;
    } catch (error) {
      await release().catch(() => {});
      console.error(JSON.stringify({ message: "tape refresh failed", ticker,
        error: error instanceof Error ? error.message : String(error) }));
      return null;
    }
  };

  if (usable) {
    if (won) {
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(refresh());
      else await refresh();
      return respond(row, "stale-refreshing");
    }
    return respond(row, "stale-leased");
  }
  if (won) {
    const fresh = await refresh();
    if (fresh && fresh.text) {
      return respond({ payload: fresh.text, read_at: fresh.readAt, session: fresh.session, legs: fresh.legs,
        last_served: now }, "refreshed");
    }
    const again = await read();
    if (again && again.payload) return respond(again, fresh && fresh.throttled ? "stale-throttled" : "stale-failed");
    return pending(fresh && fresh.throttled ? "throttled" : "unreadable");
  }
  await sleep(Math.min(LIVE_BUDGET.tapeWaitMs, 1500));
  const waited = await read();
  if (waited && waited.payload) return respond(waited, "waited");
  return pending("leased");
}

export function overlayFlowalerts(nightly, live, now, clock) {
  if (!live || !liveAlertsWin(nightly ? nightly.session : null, live.session)) return null;
  return liveResponse(live, now, clock, { "X-Live-Overlay": "live:alerts" });
}

export function overlayPulse(nightly, live, now, clock, { json }) {
  if (!nightly || !live) return null;
  let pulse, market;
  try { pulse = JSON.parse(nightly.payload); market = JSON.parse(live.payload); } catch { return null; }
  const merged = pulseWithLive(pulse, market);
  if (!merged) return null;
  const { headers } = freshHeaders(liveMeta(live), now, clock);
  return json(merged, 200, { "X-Payload-Updated": String(Math.max(nightly.updatedAt || 0, live.updatedAt || 0)),
    "X-Live-Overlay": "live:market", ...headers });
}

export async function readOverlayRows(db, nightlyKey, liveKey) {
  const [a, b] = await db.batch([
    db.prepare(
      "SELECT payload, updated_at, json_extract(payload, '$.sessionDate') AS session, " +
      "COALESCE(json_extract(payload, '$.readAt'), json_extract(payload, '$.generatedAt')) AS read_iso " +
      "FROM flows_payload WHERE id = ?").bind(nightlyKey),
    db.prepare("SELECT payload, read_at, session, cadence_s, source, writer, updated_at FROM flows_live WHERE id = ?")
      .bind(liveKey),
  ]);
  const n = a && a.results && a.results[0] ? a.results[0] : null;
  const l = b && b.results && b.results[0] ? b.results[0] : null;
  return {
    nightly: n && n.payload ? { payload: n.payload, updatedAt: Number(n.updated_at),
      session: typeof n.session === "string" ? n.session.slice(0, 10) : null, readIso: n.read_iso } : null,
    live: l && l.payload ? liveRow(l) : null,
  };
}

export async function liveBriefFeeds(db) {
  const [p, m, a, n] = await db.batch([
    db.prepare("SELECT payload FROM flows_payload WHERE id = 'pulse'"),
    db.prepare("SELECT payload FROM flows_live WHERE id = 'live:market'"),
    db.prepare("SELECT payload, session FROM flows_live WHERE id = 'live:alerts'"),
    db.prepare("SELECT json_extract(payload, '$.sessionDate') AS session FROM flows_payload WHERE id = 'flowalerts'"),
  ]).catch(() => [null, null, null, null]);
  const first = (r) => (r && r.results && r.results[0] ? r.results[0] : null);
  const parse = (row) => { try { return row && row.payload ? JSON.parse(row.payload) : null; } catch { return null; } };
  const feeds = {};
  const pulse = parse(first(p));
  const market = parse(first(m));
  const merged = pulseWithLive(pulse, market);
  if (merged) feeds.pulse = merged;
  const alertsRow = first(a);
  const nightlySession = first(n) && typeof first(n).session === "string" ? first(n).session.slice(0, 10) : null;
  if (alertsRow && liveAlertsWin(nightlySession, alertsRow.session)) {
    const alerts = parse(alertsRow);
    if (alerts) feeds.flowalerts = alerts;
  }
  return feeds;
}

export async function liveBriefStamp(db) {
  const res = await db.prepare(
    "SELECT id, updated_at FROM flows_live WHERE id IN ('live:market', 'live:alerts')",
  ).all().catch(() => null);
  const rows = res && res.results ? res.results : [];
  return rows.map((r) => `${r.id}@${r.updated_at}`).sort().join(",");
}
