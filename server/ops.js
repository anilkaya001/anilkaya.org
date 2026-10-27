import { easternDay, easternClock, easternInstant, shiftDay, freshnessState, classOf, FRESH_CLASSES } from "../shared/flows-freshness.js";
import { LIVE_KEYS, LIVE_BUDGET } from "../shared/flows-live.js";
import { coverageSql } from "./store.js";
import { productOf, PAYLOAD_CAP_BYTES } from "../shared/flows-products.js";
import { normalizeClock, ingestClockView, NOW_NIGHTLY_KEYS } from "../shared/flows-live-worker.js";
import { ledgerView } from "../shared/flows-ledger.js";
import { lines, planOf, renewalState, vendorDay } from "../shared/flows-plan-facts.js";
import { spendShape } from "../shared/flows-ai.js";
import { aiCapOf } from "../shared/flows-reading-worker.js";
import { RT_LIMITS } from "../shared/flows-rt.js";
import { AI_REJECT_SLOTS, foldCounters } from "../shared/flows-ai-broker.js";

export const OPS_LEDGER_DAYS = 7;

export const OPS_SWITCHES = Object.freeze([
  "FLOWS_RT_MODE", "FLOWS_RT_AUDIENCE", "FLOWS_RT_UPSTREAM", "FLOWS_RT_SOCKET_HOURS", "FLOWS_READ_MODE", "FLOWS_LIVE_MODE",
  "FLOWS_PREMARKET_NEWS", "FLOWS_READY", "FLOWS_HEALTH", "FLOWS_SCENES", "FLOWS_MOVES", "FLOWS_LEDGER", "FLOWS_HOME_NET", "FLOWS_FRONT_DOOR",
  "FLOWS_OPS", "FLOWS_FLOWLAB", "FLOWS_FLOWLAB_NIGHTLY", "FLOWS_FLOWLAB_ANALYTICS",
]);

export const RATE_LIMITS = Object.freeze([
  Object.freeze({ name: "UW_ONDEMAND", limit: 120, periodS: 60 }),
  Object.freeze({ name: "MEMBER_VENDOR", limit: 60, periodS: 60 }),
  Object.freeze({ name: "AI_ASK", limit: 10, periodS: 60 }),
  Object.freeze({ name: "LAB_WRITE", limit: 30, periodS: 60 }),
]);

export const COVERAGE_KEYS = Object.freeze([...new Set([...NOW_NIGHTLY_KEYS, "universe", "regime", "ideas", "roster", "calib", "dispersion", "deepen"])]);

const LIVE_IDS = Object.freeze(Object.keys(LIVE_KEYS));

const LEDGER_SQL = "SELECT * FROM flows_ledger WHERE day >= ?1 ORDER BY day DESC LIMIT " + OPS_LEDGER_DAYS;
const CLOCK_SQL = "SELECT * FROM flows_clock WHERE id = 1";
const LIVE_SQL = "SELECT id, read_at, session, cadence_s, source, writer, updated_at, " +
  "CASE WHEN json_valid(payload) THEN json_extract(payload, '$.fresh.vendorAt') END AS vendor_at " +
  "FROM flows_live WHERE id IN (" + LIVE_IDS.map((k) => `'${k}'`).join(", ") + ")";
const COVERAGE_SQL = coverageSql(COVERAGE_KEYS);
const USAGE_SQL = "SELECT calls, tokens_in, tokens_out FROM flows_ai_usage WHERE day = ?1";
const USAGE_MODEL_SQL = "SELECT model, calls, tokens_in, tokens_out FROM flows_ai_usage_model WHERE day = ?1 ORDER BY model";
const COUNTERS_SQL = "SELECT day, surface, model, outcome, reason, n, ms_sum, ms_max FROM flows_ai_outcome WHERE day >= ?1 AND day <= ?2";
const RING_SQL = "SELECT surface, slot, at, model, reason, culprit FROM flows_ai_reject ORDER BY at DESC, slot DESC LIMIT " + AI_REJECT_SLOTS;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const whole = (v) => { const n = num(v); return n === null ? null : Math.max(0, Math.trunc(n)); };
const firstOf = (res) => (res && Array.isArray(res.results) && res.results.length ? res.results[0] : null);
const rowsOf = (res) => (res && Array.isArray(res.results) ? res.results : null);

export function limitsOf(env) {
  const cap = aiCapOf(env);
  return [
    { name: "UW_ONDEMAND", scope: "all members together", limit: 120, periodS: 60,
      effect: "A member's on-demand vendor read past it is answered from the kept copy, or with a 429 when none is kept." },
    { name: "MEMBER_VENDOR", scope: "one member", limit: 60, periodS: 60,
      effect: "A member's vendor-backed read past it is answered from the kept copy stamped throttled, or with a 429." },
    { name: "AI_ASK", scope: "one member", limit: 10, periodS: 60,
      effect: "The eleventh question in a minute is a 429 with no model call." },
    { name: "LAB_WRITE", scope: "one Lab user", limit: 30, periodS: 60,
      effect: "The thirty-first Lab write in a minute is a 429; the browser keeps it in its outbox." },
    { name: "Rail vendor calls", scope: "the real-time rail", limit: RT_LIMITS.callsPerMinute, periodS: 60,
      effect: "A topic past it is degraded with reason budget and the pages fall back to their own heartbeats." },
    { name: "Tier 2 calls", scope: "one Tier 2 pass", limit: LIVE_BUDGET.tier2MaxCalls, periodS: null,
      effect: "The pass stops reading and publishes what it has." },
    { name: "Model neurons", scope: "the site, a model day", limit: cap.neurons, periodS: 86400,
      effect: "Every model call past it is refused before it reaches the model; the deterministic reading stands." },
    { name: "Model calls", scope: "the site, a model day", limit: cap.calls, periodS: 86400,
      effect: "Every model call past it is refused before it reaches the model." },
    { name: "Model readings", scope: "the site, a model day", limit: cap.readsStopAt, periodS: 86400,
      effect: "Per-name readings stop at this many neurons and leave the rest to the Neuron and the Ask box." },
    { name: "D1 daily quota", scope: "the account", limit: null, periodS: 86400,
      effect: "A refused read is a 503 store_quota with the last good copy of a nightly key where one is kept." },
  ];
}

export function switchesOf(env) {
  const out = {};
  for (const name of OPS_SWITCHES) {
    const raw = env && typeof env[name] === "string" ? env[name].trim() : "";
    out[name] = raw === "" ? null : raw.slice(0, 32);
  }
  return out;
}

export function staticOps(env, now) {
  return {
    lines: lines(env),
    plan: { ...planOf(env), renewal: renewalState(now, env) },
    limits: limitsOf(env),
    switches: switchesOf(env),
  };
}

export function liveView(rows, now, clock) {
  const byId = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));
  return LIVE_IDS.map((key) => {
    const r = byId.get(key);
    if (!r) return { key, present: false };
    const readAt = num(r.read_at);
    const cadenceS = num(r.cadence_s);
    const meta = { readAt, session: r.session, cadenceS, source: r.source };
    const klass = classOf(meta);
    const spec = FRESH_CLASSES[klass];
    const f = freshnessState(meta, now, clock);
    const parsed = typeof r.vendor_at === "string" ? Date.parse(r.vendor_at) : num(r.vendor_at);
    const vendorAt = Number.isFinite(parsed) ? parsed : null;
    return {
      key, present: true, writer: typeof r.writer === "string" ? r.writer : null, source: r.source, session: r.session, cadenceS,
      klass, readAt, vendorAt,
      behindS: vendorAt === null || readAt === null ? null : Math.max(0, Math.round((readAt - vendorAt) / 1000)),
      ageS: readAt === null ? null : Math.max(0, Math.round((now - readAt) / 1000)),
      state: f.state, reason: f.reason, liveS: spec.liveS, staleS: spec.staleS,
    };
  });
}

const UTC_DAY_MS = 86_400_000;

export function vendorWindow(ms, resetMinuteEt) {
  if (!Number.isFinite(ms)) return null;
  if (!Number.isInteger(resetMinuteEt)) {
    const day = new Date(ms).toISOString().slice(0, 10);
    const start = Date.parse(day + "T00:00:00Z");
    return { day, start, end: start + UTC_DAY_MS };
  }
  const wall = easternClock(ms);
  const here = easternDay(ms);
  if (!wall || !here) return null;
  const day = wall.minutes < resetMinuteEt ? here : shiftDay(here, 1);
  return { day, start: easternInstant(shiftDay(day, -1), resetMinuteEt), end: easternInstant(day, resetMinuteEt) };
}

export function vendorView(ledger, clockView, held, env = {}, now = Date.now()) {
  const vday = vendorDay(env);
  const current = vendorWindow(now, vday.resetMinuteEt);
  const today = ledger && Array.isArray(ledger.days) && ledger.days.length ? ledger.days[0] : null;
  const fromClock = clockView && clockView.vendor ? clockView.vendor : null;
  const atOf = Date.parse(today && today.vendor ? today.vendor.at : "");
  const fromLedger = today && today.vendor && Number.isFinite(today.vendor.dailyMax) && Number.isFinite(atOf)
    ? { daily: today.vendor.dailyMax, at: atOf } : null;
  const candidates = [fromClock, fromLedger, held].filter((m) => m && Number.isFinite(m.daily) && Number.isFinite(m.at));
  const reading = candidates.length ? candidates.reduce((a, b) => (b.at > a.at ? b : a)) : null;
  const own = today
    ? { day: today.day, tier1: today.tier1.calls ?? null, focus: today.focus.calls ?? null, tier2: today.tier2.calls, tier2Failed: today.tier2.failedCalls,
      current: !!current && today.day === current.day }
    : null;
  const readWindow = reading ? vendorWindow(reading.at, vday.resetMinuteEt) : null;
  return {
    reading: reading
      ? { daily: reading.daily, at: reading.at, window: readWindow, current: !!(readWindow && current && readWindow.day === current.day) }
      : null,
    own,
    dayBoundary: vday.basis,
    window: current ? { ...current, basis: vday.basis, resetMinuteEt: vday.resetMinuteEt, source: vday.source, via: vday.via, readOn: vday.readOn } : null,
  };
}

export function opsStatements(env, now, { part = null } = {}) {
  const today = easternDay(now);
  const aiDay = dayOf(now);
  const out = [
    env.DB.prepare(LEDGER_SQL).bind(shiftDay(today, 1 - OPS_LEDGER_DAYS)),
    env.DB.prepare(CLOCK_SQL),
    env.DB.prepare(LIVE_SQL),
    env.DB.prepare(USAGE_SQL).bind(aiDay),
    env.DB.prepare(USAGE_MODEL_SQL).bind(aiDay),
  ];
  if (part === "ai") out.push(env.DB.prepare(COUNTERS_SQL).bind(aiDay, aiDay), env.DB.prepare(RING_SQL));
  if (part === "coverage") out.push(env.DB.prepare(COVERAGE_SQL));
  return out;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function rotationView(row) {
  if (!row) return { present: false, why: "the ledger has never been written" };
  let sum = null;
  try { sum = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary; } catch { sum = null; }
  if (!sum || typeof sum !== "object" || Array.isArray(sum)) return { present: true, summary: false, why: "the ledger carries no summary yet" };
  const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  return {
    present: true, summary: true, session: typeof row.session === "string" ? row.session : null,
    carded: n(sum.carded), universe: n(sum.universe), tonight: n(sum.tonight), planned: n(sum.planned), read: n(sum.read),
    oldest: typeof sum.oldest === "string" && DAY_RE.test(sum.oldest) ? sum.oldest : null,
    calls: n(sum.calls), dailySeen: n(sum.dailySeen), dayLine: n(sum.dayLine), minuteLine: n(sum.minuteLine),
    writtenAt: whole(row.updated_at),
  };
}

export const capBytesOf = (key) => {
  const p = productOf(key);
  return p && Number.isSafeInteger(p.capBytes) && p.capBytes > 0 ? p.capBytes : PAYLOAD_CAP_BYTES;
};

export function coverageView(rows) {
  const list = rowsOf({ results: rows });
  if (!list) return null;
  const byId = new Map(list.map((r) => [r.id, r]));
  return {
    rotation: rotationView(byId.get("deepen")),
    keys: COVERAGE_KEYS.map((key) => {
      const r = byId.get(key);
      const capBytes = capBytesOf(key);
      if (!r) return { key, present: false, capBytes };
      const bytes = whole(r.bytes);
      return { key, present: true, bytes, capBytes, share: bytes === null ? null : bytes / capBytes,
        updatedAt: whole(r.updated_at), session: typeof r.session === "string" ? r.session : null };
    }),
  };
}

export function opsBody(env, now, results, { part = null, meter = null } = {}) {
  const base = { v: 1, now, owner: true, ...staticOps(env, now) };
  if (!Array.isArray(results)) {
    return { ...base, why: "store", ledger: null, clock: null, live: null, vendor: null,
      ai: { spend: null, cap: aiCapOf(env), block: null }, coverage: null };
  }
  const [ledgerRes, clockRes, liveRes, usageRes, modelRes, countersRes, ringRes] = results;
  const coverageRes = part === "coverage" ? countersRes : null;
  const ledgerRows = rowsOf(ledgerRes);
  const clock = normalizeClock(firstOf(clockRes));
  const clockView = clock ? ingestClockView(clock) : null;
  const ledger = ledgerRows ? ledgerView(ledgerRows) : null;
  const usage = firstOf(usageRes);
  const models = rowsOf(modelRes);
  const day = dayOf(now);
  const spend = spendShape(env, day, usage ? whole(usage.calls) || 0 : 0, usage ? whole(usage.tokens_in) || 0 : 0,
    usage ? whole(usage.tokens_out) || 0 : 0,
    models ? models.map((r) => ({ model: String(r.model), calls: whole(r.calls) || 0, tokensIn: whole(r.tokens_in) || 0,
      tokensOut: whole(r.tokens_out) || 0 })) : []);
  const clockOut = clockView
    ? { ...clockView, vendor: clock && whole(clock.uwDaily) !== null && whole(clock.uwDailyAt) !== null
      ? { daily: whole(clock.uwDaily), at: whole(clock.uwDailyAt) } : null }
    : null;
  const block = part === "ai" && rowsOf(countersRes) && rowsOf(ringRes)
    ? foldCounters(rowsOf(countersRes), rowsOf(ringRes), { days: 1, today: day })
    : null;
  return {
    ...base,
    ledger, clock: clockOut,
    live: liveRes && rowsOf(liveRes) ? liveView(rowsOf(liveRes), now, clock) : null,
    vendor: vendorView(ledger, clockOut, meter, env, now),
    ai: { spend, cap: aiCapOf(env), block },
    coverage: part === "coverage" && coverageRes ? coverageView(rowsOf(coverageRes)) : null,
  };
}

export async function readOps(env, deps, { part = null } = {}) {
  const now = deps.now();
  if (!env || !env.DB) return opsBody(env, now, null, { part });
  try {
    await deps.ensureFlowsTables(env);
    const results = await env.DB.batch(opsStatements(env, now, { part }));
    return opsBody(env, now, results, { part, meter: typeof deps.meter === "function" ? deps.meter() : null });
  } catch {
    return opsBody(env, now, null, { part });
  }
}
