import { tradingSessionsBetween } from "./flows-universe.js";

export const DEEPEN = Object.freeze({
  v: 1,
  key: "deepen",
  switchEnv: "FLOWS_DEEPEN",
  capEnv: "FLOWS_DEEPEN_CAP",
  perNightCap: 470,
  dryRunCap: 24,
  hardCap: 900,
  minBatch: 4,
  keepSessions: 40,
  callsPerName: 39,
  msPerName: 6650,
  baselineCalls: 6560,
  baselineMs: 19 * 60 * 1000,
  deadlineMs: 90 * 60 * 1000,
  daySharePct: 0.85,
  timeSharePct: 0.8,
  minuteSharePct: 0.8,
  overrunMargin: 0.1,
  workingDayLine: 60000,
  workingMinuteLine: 500,
  failBackoffMax: 8,
  failQuarantineAfter: 3,
  ledgerBudgetBytes: 64 * 1024,
});

export const DEPTH_RANK = Object.freeze({
  screen: 0, quote: 0, "cross-section": 1, breadth: 1, cross: 1, index: 2, fund: 2, deepened: 3, deep: 3, focus: 3, board: 3,
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const isDay = (v) => typeof v === "string" && DAY_RE.test(v);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function deepenMode(env = {}) {
  const raw = String((env && env[DEEPEN.switchEnv]) ?? "").trim().toLowerCase();
  return raw === "off" ? "off" : "on";
}

export function capFromEnv(env = {}, fallback = DEEPEN.perNightCap) {
  const raw = env ? env[DEEPEN.capEnv] : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === "") return Math.min(fallback, DEEPEN.hardCap);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return Math.min(fallback, DEEPEN.hardCap);
  return Math.min(Math.floor(n), DEEPEN.hardCap);
}

const AGO = new Map();

export function sessionsAgo(from, to) {
  if (!isDay(from) || !isDay(to)) return null;
  const key = from + ">" + to;
  if (AGO.has(key)) return AGO.get(key);
  const n = tradingSessionsBetween(from, to);
  if (AGO.size >= 4096) AGO.clear();
  AGO.set(key, n);
  return n;
}

export function paceFor(minuteLine, share = DEEPEN.minuteSharePct) {
  const line = num(minuteLine) !== null && minuteLine > 0 ? minuteLine : DEEPEN.workingMinuteLine;
  const perMinute = Math.max(1, Math.floor(line * share));
  return { perMinute, spacingMs: Math.ceil(60000 / perMinute) };
}

export function governor({
  mode = "on", cap = DEEPEN.perNightCap, backlog = 0, dayLine = null, minuteLine = null, callsSoFar = 0, elapsedMs = 0,
  deadlineMs = DEEPEN.deadlineMs, budget = DEEPEN, dailySeen = null,
} = {}) {
  const pace = paceFor(minuteLine, budget.minuteSharePct);
  const out = { n: 0, binding: "none", limits: {}, pace, why: "" };
  if (mode === "off") return { ...out, binding: "switch", why: "the switch is off" };
  const day = num(dayLine) !== null && dayLine > 0 ? dayLine : budget.workingDayLine;
  const seen = num(dailySeen) !== null && dailySeen > 0 ? dailySeen : 0;
  const spentCalls = Math.max(Math.max(0, callsSoFar), seen, budget.baselineCalls) + budget.baselineCalls * budget.overrunMargin;
  const byCalls = Math.floor((day * budget.daySharePct - spentCalls) / budget.callsPerName);
  const remainingBaselineMs = Math.max(budget.baselineMs - Math.max(0, elapsedMs), 0);
  const byTime = Math.floor((deadlineMs * budget.timeSharePct - Math.max(0, elapsedMs) - remainingBaselineMs) / budget.msPerName);
  const limits = {
    cap: Math.min(Math.max(0, Math.floor(cap)), budget.hardCap),
    backlog: Math.max(0, Math.floor(backlog)),
    calls: Math.max(0, byCalls),
    time: Math.max(0, byTime),
  };
  const order = ["cap", "backlog", "calls", "time"];
  let binding = order[0];
  for (const k of order) if (limits[k] < limits[binding]) binding = k;
  let n = limits[binding];
  if (n < budget.minBatch) {
    return { ...out, limits, binding, why: `the tightest limit (${binding}) leaves ${n}, under the smallest batch of ${budget.minBatch}` };
  }
  return {
    ...out, n, limits, binding,
    why: `${n} name(s), limited by ${binding} (cap ${limits.cap}, backlog ${limits.backlog}, calls ${limits.calls}, time ${limits.time})`,
  };
}

export function parseLedger(payload) {
  const at = new Map();
  const tries = new Map();
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.v !== DEEPEN.v) {
    return { at, tries, sessionDate: null, valid: false };
  }
  const src = payload.at && typeof payload.at === "object" && !Array.isArray(payload.at) ? payload.at : {};
  for (const [t, d] of Object.entries(src)) if (TICKER_RE.test(t) && isDay(d)) at.set(t, d);
  const tr = payload.tries && typeof payload.tries === "object" && !Array.isArray(payload.tries) ? payload.tries : {};
  for (const [t, e] of Object.entries(tr)) {
    if (!TICKER_RE.test(t) || !Array.isArray(e) || !isDay(e[0]) || !Number.isInteger(e[1]) || e[1] < 1) continue;
    tries.set(t, [e[0], e[1]]);
  }
  return { at, tries, sessionDate: isDay(payload.sessionDate) ? payload.sessionDate : null, valid: true };
}

export function backoffSessions(failures) {
  if (!Number.isInteger(failures) || failures < 1) return 0;
  return Math.min(2 ** (failures - 1), DEEPEN.failBackoffMax);
}

export function ready(ledger, ticker, sessionDate) {
  const t = ledger.tries.get(ticker);
  if (!t) return true;
  const gap = sessionsAgo(t[0], sessionDate);
  if (gap === null) return true;
  return gap >= backoffSessions(t[1]);
}

export function carriedFrom(ledger, sessionDate, keep = DEEPEN.keepSessions) {
  const out = new Map();
  for (const [t, d] of ledger.at) {
    const age = sessionsAgo(d, sessionDate);
    if (age !== null && age >= 1 && age <= keep) out.set(t, { session: d, age });
  }
  return out;
}

export function pickRotation({ candidates = [], ledger, sessionDate, exclude = new Set(), n = 0 } = {}) {
  if (!(n > 0)) return { picked: [], waiting: 0, never: 0, neverLeft: 0 };
  const led = ledger || parseLedger(null);
  const seen = new Set();
  const rows = [];
  let waiting = 0;
  for (const c of candidates) {
    if (!c || !TICKER_RE.test(String(c.t || "")) || seen.has(c.t) || exclude.has(c.t)) continue;
    seen.add(c.t);
    if (!ready(led, c.t, sessionDate)) { waiting++; continue; }
    rows.push({ t: c.t, w: num(c.w) ?? 0, at: led.at.get(c.t) || null });
  }
  rows.sort((a, b) => {
    if (!a.at !== !b.at) return a.at ? 1 : -1;
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
    return b.w - a.w || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  });
  const picked = rows.slice(0, n).map((r) => r.t);
  const never = rows.filter((r) => !r.at).length;
  return { picked, waiting, never, neverLeft: Math.max(0, never - picked.filter((t) => !led.at.has(t)).length) };
}

export function planNight({
  mode = "on", cap = DEEPEN.perNightCap, payload = null, readable = true, sessionDate, rows = [], board = new Set(),
  rosterKnown = null, dayLine = null, minuteLine = null, callsSoFar = 0, elapsedMs = 0, deadlineMs = DEEPEN.deadlineMs, dailySeen = null,
} = {}) {
  const ledger = parseLedger(readable ? payload : null);
  let carried = readable ? carriedFrom(ledger, sessionDate) : new Map();
  if (rosterKnown && carried.size) {
    carried = new Map([...carried].filter(([t, c]) => {
      if (!rosterKnown.has("card:" + t)) return false;
      const stored = rosterKnown.get("card:" + t);
      return stored === null || stored === undefined || stored === c.session;
    }));
  }
  const candidates = rows.filter((r) => r && !board.has(r.t));
  const gov = governor({
    mode: readable ? mode : "off", cap, backlog: candidates.length, dayLine, minuteLine, callsSoFar, elapsedMs, deadlineMs, dailySeen,
  });
  const picked = gov.n > 0
    ? pickRotation({ candidates, ledger, sessionDate, n: gov.n })
    : { picked: [], waiting: 0, never: 0, neverLeft: 0 };
  const why = readable ? gov.why : "the ledger could not be read, so no name is chosen blind and no deep read is touched";
  return { ledger, carried, gov, picked, candidates: candidates.length, protectAll: !readable && mode !== "off", why };
}

export function holdSet({ carried = new Map(), protectAll = false, cross = [], board = new Set(), chosen = new Set() } = {}) {
  const keep = new Set([...carried.keys()].filter((t) => !chosen.has(t) && !board.has(t)));
  if (protectAll) for (const t of cross) if (!board.has(t) && !chosen.has(t)) keep.add(t);
  return keep;
}

export function splitCross(tickers, keep) {
  const build = [];
  const held = [];
  for (const t of tickers) (keep.has(t) ? held : build).push(t);
  return { build, held };
}

export function settleNight({ chosen = [], enrichFailed = new Set(), cardLanded = () => false, cardXLanded = () => false } = {}) {
  const landed = new Set();
  const failed = new Set(enrichFailed);
  for (const t of chosen) {
    if (enrichFailed.has(t)) continue;
    if (cardLanded(t) && cardXLanded(t)) landed.add(t);
    else failed.add(t);
  }
  return { landed, failed };
}

export function updateLedger(prior, { sessionDate, landed = new Set(), failed = new Set(), universe = null, keep = DEEPEN.keepSessions } = {}) {
  const base = parseLedger(prior);
  const at = new Map(base.at);
  const tries = new Map(base.tries);
  for (const t of landed) {
    at.set(t, sessionDate);
    tries.delete(t);
  }
  for (const t of failed) {
    if (landed.has(t)) continue;
    const prev = tries.get(t);
    tries.set(t, [sessionDate, Math.min((prev ? prev[1] : 0) + 1, 30)]);
  }
  for (const [t, d] of [...at]) {
    const age = sessionsAgo(d, sessionDate);
    if ((universe && !universe.has(t) && !landed.has(t)) || (age !== null && age > keep)) at.delete(t);
  }
  for (const t of [...tries.keys()]) if (universe && !universe.has(t)) tries.delete(t);
  const sorted = (m) => Object.fromEntries([...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  return { at: sorted(at), tries: sorted(tries) };
}

export function ledgerSummary(at, { sessionDate, universe = null, planned = null, usage = null } = {}) {
  const days = Object.values(at);
  const u = usage && typeof usage === "object" ? usage : {};
  return {
    carded: days.length,
    universe: universe ? universe.size : null,
    tonight: days.filter((d) => d === sessionDate).length,
    oldest: days.length ? days.reduce((a, b) => (b < a ? b : a)) : null,
    planned: num(planned),
    read: num(u.read),
    calls: num(u.calls),
    dailySeen: num(u.dailySeen),
    dayLine: num(u.dayLine),
    minuteLine: num(u.minuteLine),
  };
}

export function ledgerPayload(prior, { sessionDate, generatedAt = null, landed, failed, universe = null, plan = null, usage = null } = {}) {
  const next = updateLedger(prior, { sessionDate, landed, failed, universe });
  const names = Object.keys(next.at).length;
  const payload = {
    v: DEEPEN.v,
    sessionDate, generatedAt,
    at: next.at,
    tries: next.tries,
    names,
    plan,
    summary: ledgerSummary(next.at, { sessionDate, universe, planned: plan ? plan.n : null, usage }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  return { payload: { ...payload, bytes }, bytes, fits: bytes <= DEEPEN.ledgerBudgetBytes };
}

export function depthRank(depth) {
  return Object.hasOwn(DEPTH_RANK, depth) ? DEPTH_RANK[depth] : 0;
}

export function mayPublish({ storedDepth = null, storedSession = null, newDepth, sessionDate, keep = DEEPEN.keepSessions } = {}) {
  if (storedDepth === null || storedDepth === undefined) return { ok: true, why: "nothing stored" };
  if (depthRank(newDepth) >= depthRank(storedDepth)) return { ok: true, why: "not shallower" };
  const age = sessionsAgo(storedSession, sessionDate);
  if (age === null) return { ok: true, why: "the stored card is undated" };
  if (age > keep) return { ok: true, why: "the deeper card is past its keep window" };
  return { ok: false, why: `a ${storedDepth} card from ${storedSession} is kept over a ${newDepth} one` };
}

export function holds(ledger, ticker, sessionDate, keep = DEEPEN.keepSessions) {
  const d = ledger.at.get(ticker);
  if (!d) return false;
  const age = sessionsAgo(d, sessionDate);
  return age !== null && age >= 1 && age <= keep;
}

export function deepReadSaid(cardSession, expected) {
  const n = sessionsAgo(cardSession, expected);
  if (n === null) return null;
  if (n <= 0) return "Deep read from the last completed session.";
  return `Deep read from ${n} ${n === 1 ? "session" : "sessions"} before the last completed one (${cardSession}); this name is refreshed in turn, least recently read first.`;
}

export function coverageNights({ backlog, perNight }) {
  if (!(perNight > 0)) return null;
  return Math.ceil(Math.max(0, backlog) / perNight);
}
