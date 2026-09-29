import {
  FRESH_CLASSES, LIVE_CLOCK, closeMinutes, easternInstant, sessionOpen, freshnessState, shiftDay, phaseAt, classOf,
} from "./flows-freshness.js";

export const LEDGER_RETAIN_DAYS = 30;

export const LEDGER_LIMITS = Object.freeze({
  tier1Ms: FRESH_CLASSES.market.staleS * 1000,
  focusMs: FRESH_CLASSES.market.staleS * 1000,
  tier2Ms: FRESH_CLASSES.breadth.staleS * 1000,
});

export const LEDGER_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS flows_ledger (day TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), " +
  "ticks INTEGER NOT NULL DEFAULT 0, t1_last_at INTEGER, t1_gap_ms INTEGER NOT NULL DEFAULT 0, t1_gap_end INTEGER, " +
  "t1_ok INTEGER NOT NULL DEFAULT 0, t1_fail INTEGER NOT NULL DEFAULT 0, t1_ok_at INTEGER, " +
  "t1_ok_gap_ms INTEGER NOT NULL DEFAULT 0, t1_ok_gap_end INTEGER, " +
  "focus_ok INTEGER NOT NULL DEFAULT 0, focus_partial INTEGER NOT NULL DEFAULT 0, focus_fail INTEGER NOT NULL DEFAULT 0, " +
  "focus_ok_at INTEGER, focus_gap_ms INTEGER NOT NULL DEFAULT 0, focus_gap_end INTEGER, " +
  "t2_passes INTEGER NOT NULL DEFAULT 0, t2_first_at INTEGER, t2_last_at INTEGER, t2_gap_ms INTEGER NOT NULL DEFAULT 0, " +
  "t2_gap_end INTEGER, t2_calls INTEGER NOT NULL DEFAULT 0, t2_failed INTEGER NOT NULL DEFAULT 0, " +
  "stale_ticks INTEGER NOT NULL DEFAULT 0, stale_over_s INTEGER, stale_key TEXT, " +
  "nightly_at INTEGER, nightly_runs INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)";

const int = (v) => Math.round(Number(v));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const count = (v, max = 100000) => (Number.isFinite(Number(v)) ? clamp(Math.trunc(Number(v)), 0, max) : 0);

const gapSets = (gap, end, last, at, start, stop) => {
  const grown = `?${at} - min(max(coalesce(${last}, ?${start}), ?${start}), ?${stop})`;
  return `${end} = CASE WHEN ${grown} > ${gap} THEN ?${at} ELSE ${end} END, ${gap} = max(${gap}, ${grown})`;
};

export function tickWindow(day, clock = null) {
  return {
    start: sessionOpen(day),
    end: easternInstant(day, closeMinutes(day, clock) + LIVE_CLOCK.tier1AfterCloseMin),
  };
}

export function ledgerTickStatement(db, { day, at, start, end }) {
  const here = clamp(int(at), int(start), int(end));
  return db.prepare(
    "INSERT INTO flows_ledger (day, ticks, t1_last_at, t1_gap_ms, t1_gap_end, updated_at) VALUES (?1, 1, ?2, ?3, ?4, ?2) " +
    "ON CONFLICT(day) DO UPDATE SET ticks = ticks + 1, " +
    gapSets("t1_gap_ms", "t1_gap_end", "t1_last_at", 4, 5, 6) +
    ", t1_last_at = max(coalesce(t1_last_at, ?2), ?2), updated_at = ?2",
  ).bind(day, int(at), Math.max(0, here - int(start)), here, int(start), int(end));
}

export function ledgerOutcomeStatement(db, { day, at, start, end, ok, failed, stale = null }) {
  const here = clamp(int(at), int(start), int(end));
  const over = stale && Number.isFinite(stale.over) ? int(stale.over) : null;
  return db.prepare(
    "INSERT INTO flows_ledger (day, t1_ok, t1_fail, t1_ok_at, t1_ok_gap_ms, t1_ok_gap_end, stale_ticks, stale_over_s, stale_key, updated_at) " +
    "VALUES (?1, ?7, ?8, CASE WHEN ?7 = 1 THEN ?2 END, CASE WHEN ?7 = 1 THEN ?3 ELSE 0 END, CASE WHEN ?7 = 1 THEN ?4 END, ?9, ?10, ?11, ?2) " +
    "ON CONFLICT(day) DO UPDATE SET t1_ok = t1_ok + ?7, t1_fail = t1_fail + ?8, " +
    "t1_ok_gap_end = CASE WHEN ?7 = 1 AND ?4 - min(max(coalesce(t1_ok_at, ?5), ?5), ?6) > t1_ok_gap_ms THEN ?4 ELSE t1_ok_gap_end END, " +
    "t1_ok_gap_ms = CASE WHEN ?7 = 1 THEN max(t1_ok_gap_ms, ?4 - min(max(coalesce(t1_ok_at, ?5), ?5), ?6)) ELSE t1_ok_gap_ms END, " +
    "t1_ok_at = CASE WHEN ?7 = 1 THEN max(coalesce(t1_ok_at, ?2), ?2) ELSE t1_ok_at END, " +
    "stale_ticks = stale_ticks + ?9, " +
    "stale_key = CASE WHEN ?10 IS NOT NULL AND ?10 > coalesce(stale_over_s, -1) THEN ?11 ELSE stale_key END, " +
    "stale_over_s = CASE WHEN ?10 IS NOT NULL AND ?10 > coalesce(stale_over_s, -1) THEN ?10 ELSE stale_over_s END, updated_at = ?2",
  ).bind(day, int(at), Math.max(0, here - int(start)), here, int(start), int(end), ok ? 1 : 0, failed ? 1 : 0,
    over === null ? 0 : 1, over, over === null ? null : String(stale.key || "").slice(0, 32));
}

export function ledgerFocusStatement(db, { day, at, start, end, ok, partial, failed }) {
  const here = clamp(int(at), int(start), int(end));
  return db.prepare(
    "INSERT INTO flows_ledger (day, focus_ok, focus_partial, focus_fail, focus_ok_at, focus_gap_ms, focus_gap_end, updated_at) " +
    "VALUES (?1, ?7, ?8, ?9, CASE WHEN ?7 = 1 THEN ?2 END, CASE WHEN ?7 = 1 THEN ?3 ELSE 0 END, CASE WHEN ?7 = 1 THEN ?4 END, ?2) " +
    "ON CONFLICT(day) DO UPDATE SET focus_ok = focus_ok + ?7, focus_partial = focus_partial + ?8, focus_fail = focus_fail + ?9, " +
    "focus_gap_end = CASE WHEN ?7 = 1 AND ?4 - min(max(coalesce(focus_ok_at, ?5), ?5), ?6) > focus_gap_ms THEN ?4 ELSE focus_gap_end END, " +
    "focus_gap_ms = CASE WHEN ?7 = 1 THEN max(focus_gap_ms, ?4 - min(max(coalesce(focus_ok_at, ?5), ?5), ?6)) ELSE focus_gap_ms END, " +
    "focus_ok_at = CASE WHEN ?7 = 1 THEN max(coalesce(focus_ok_at, ?2), ?2) ELSE focus_ok_at END, updated_at = ?2",
  ).bind(day, int(at), Math.max(0, here - int(start)), here, int(start), int(end), ok ? 1 : 0, partial ? 1 : 0,
    failed ? 1 : 0);
}

export function ledgerPassStatement(db, { day, at, calls = 0, failedCalls = 0 }) {
  const open = int(sessionOpen(day));
  const stop = int(easternInstant(day, 24 * 60));
  const here = clamp(int(at), open, stop);
  return db.prepare(
    "INSERT INTO flows_ledger (day, t2_passes, t2_first_at, t2_last_at, t2_gap_ms, t2_gap_end, t2_calls, t2_failed, updated_at) " +
    "VALUES (?1, 1, ?2, ?2, ?3, ?4, ?7, ?8, ?2) " +
    "ON CONFLICT(day) DO UPDATE SET t2_passes = t2_passes + 1, t2_first_at = coalesce(t2_first_at, ?2), " +
    gapSets("t2_gap_ms", "t2_gap_end", "t2_last_at", 4, 5, 6) +
    ", t2_calls = t2_calls + ?7, t2_failed = t2_failed + ?8, t2_last_at = max(coalesce(t2_last_at, ?2), ?2), updated_at = ?2 " +
    "WHERE ?2 >= coalesce(t2_last_at, 0)",
  ).bind(day, int(at), Math.max(0, here - open), here, open, stop, count(calls), count(failedCalls));
}

export function ledgerNightlyStatement(db, { day, at }) {
  return db.prepare(
    "INSERT INTO flows_ledger (day, nightly_at, nightly_runs, updated_at) VALUES (?1, ?2, 1, ?2) " +
    "ON CONFLICT(day) DO UPDATE SET nightly_at = coalesce(nightly_at, ?2), nightly_runs = nightly_runs + 1, updated_at = ?2",
  ).bind(day, int(at));
}

export const LEDGER_ROWS_SQL = "SELECT * FROM flows_ledger ORDER BY day DESC LIMIT " + LEDGER_RETAIN_DAYS;

export function ledgerPruneCutoff(today) {
  return shiftDay(today, -LEDGER_RETAIN_DAYS);
}

const iso = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? new Date(Number(v)).toISOString() : null);
const or0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function ledgerRowView(r) {
  if (!r || typeof r !== "object" || typeof r.day !== "string") return null;
  return {
    day: r.day,
    ticks: or0(r.ticks),
    tier1: { lastAt: iso(r.t1_last_at), gapMs: or0(r.t1_gap_ms), gapEndAt: iso(r.t1_gap_end), ok: or0(r.t1_ok), fail: or0(r.t1_fail),
      okAt: iso(r.t1_ok_at), okGapMs: or0(r.t1_ok_gap_ms), okGapEndAt: iso(r.t1_ok_gap_end) },
    focus: { ok: or0(r.focus_ok), partial: or0(r.focus_partial), fail: or0(r.focus_fail), okAt: iso(r.focus_ok_at),
      gapMs: or0(r.focus_gap_ms), gapEndAt: iso(r.focus_gap_end) },
    tier2: { passes: or0(r.t2_passes), firstAt: iso(r.t2_first_at), lastAt: iso(r.t2_last_at), gapMs: or0(r.t2_gap_ms),
      gapEndAt: iso(r.t2_gap_end), calls: or0(r.t2_calls), failedCalls: or0(r.t2_failed) },
    stale: { ticks: or0(r.stale_ticks), overS: r.stale_over_s === null || r.stale_over_s === undefined ? null : or0(r.stale_over_s),
      key: typeof r.stale_key === "string" ? r.stale_key : null },
    nightly: { at: iso(r.nightly_at), runs: or0(r.nightly_runs) },
    updatedAt: iso(r.updated_at),
  };
}

export function ledgerView(rows) {
  const days = (Array.isArray(rows) ? rows : []).map(ledgerRowView).filter(Boolean);
  return { retainDays: LEDGER_RETAIN_DAYS, days };
}

export function worstStale(rows, at, clock = null) {
  const phase = phaseAt(at, clock);
  if (!phase || phase.phase !== "rth") return null;
  let worst = null;
  for (const r of rows || []) {
    if (!r || typeof r.id !== "string") continue;
    const meta = { readAt: Number(r.read_at), session: r.session, cadenceS: Number(r.cadence_s), source: r.source };
    if (meta.readAt >= phase.open && at - meta.readAt <= FRESH_CLASSES[classOf(meta)].staleS * 1000) continue;
    const f = freshnessState(meta, at, clock);
    if (f.state !== "stale" || !Number.isFinite(f.staleAt)) continue;
    const over = Math.max(0, Math.round((at - f.staleAt) / 1000));
    if (!worst || over > worst.over) worst = { key: r.id, over };
  }
  return worst;
}
