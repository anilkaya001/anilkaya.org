import { decodeColumn } from "./flows-cross.js";
import { expectedNightlySession } from "./flows-freshness.js";
import { stamp, day as trtDay, instantOf } from "./flows-time.js";
import { sessionsBetween, HORIZON_SESSIONS } from "./flows-member-calendar.js";
import { LEAN_REASONS, REASONS } from "./flows-columns.js";
import { moveZ } from "./flows-member-state.js";
import { dayOf, tickerOf, windowsByTicker, pooled } from "./flows-member-windows.js";

export const SINCE_LIMITS = Object.freeze({ moveZ: 3, lines: 5, keep: 30 });

export const SINCE_COPY = Object.freeze({
  title: "Since your last visit",
  first: "This is your first visit. Changes since now will appear here next time.",
  quiet: "New nightly data arrived. Nothing crossed these thresholds.",
  unavailable: "Nightly data did not load. Try again in a minute.",
  titles: Object.freeze({
    flow: "New flagged windows",
    moves: "Large moves",
    board: "Board changes",
    entering: "Entering the " + HORIZON_SESSIONS + "-session window",
    soon: "Report dated this session or the next",
  }),
  soonNote: "Before-open or after-close timing is not published yet.",
  failed: Object.freeze({
    flow: "New flagged windows: the flow record did not load.",
    moves: "Large moves: nightly data did not load.",
    board: "Board changes: the score track did not load.",
    entering: "Entering the " + HORIZON_SESSIONS + "-session window: the events did not load.",
    soon: "Reporting soon: nightly data did not load.",
  }),
});

const DASH = "—";
const MINUS = "−";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function usd(cents) {
  const d = cents / 100;
  if (d >= 999500000) return "$" + (d / 1e9).toFixed(1) + "B";
  if (d >= 999500) return "$" + (d / 1e6).toFixed(1) + "M";
  if (d >= 999.5) return "$" + Math.round(d / 1e3) + "K";
  return "$" + Math.round(d);
}

const round2 = (x) => Math.round(x * 100) / 100;
const signed2 = (z) => (z < 0 ? MINUS : "") + Math.abs(z).toFixed(2);

function column(universe, key) {
  if (!isObj(universe) || !isObj(universe.cols) || !isObj(universe.units)) return null;
  const col = universe.cols[key];
  const unit = universe.units[key];
  if (!Array.isArray(col) || !Array.isArray(unit) || !(num(unit[1]) > 0)) return null;
  return decodeColumn(col, unit[1]);
}

const group = (id, title, summary, lines, total, extra = {}) => ({
  id, title, summary, total, error: false, lines: lines.slice(0, SINCE_LIMITS.keep), more: Math.max(0, total - SINCE_LIMITS.keep), ...extra,
});

const failed = (id) => ({ id, title: SINCE_COPY.titles[id], summary: SINCE_COPY.failed[id], total: 0, error: true, lines: [], more: 0 });

const leanText = (read) => {
  if (read.side === "buyers") return "buyers lean";
  if (read.side === "sellers") return "sellers lean";
  if (read.side === "undetermined") return "lean undetermined";
  return "lean " + DASH + " " + REASONS[LEAN_REASONS[read.why]];
};

export function flowGroup(alerts, prev) {
  if (!isObj(alerts) || !Array.isArray(alerts.rows)) return failed("flow");
  const payloadAt = instantOf(alerts.readAt) ?? instantOf(isObj(alerts.record) ? alerts.record.lastReadAt : null) ?? instantOf(alerts.generatedAt);
  const fresh = (r) => {
    const first = typeof r.firstAt === "string" ? instantOf(r.firstAt) : null;
    if (first !== null) return first > prev;
    return payloadAt !== null && payloadAt > prev;
  };
  const by = windowsByTicker(alerts, fresh);
  const rows = [];
  let windows = 0;
  for (const [t, list] of by) {
    const p = pooled(list);
    if (p.totals.n === 0) continue;
    windows += p.totals.n;
    rows.push({ t, n: p.totals.n, T: p.totals.T, read: p.read });
  }
  rows.sort((a, b) => b.T - a.T || byCode(a.t, b.t));
  const lines = rows.map((r) => ({
    t: r.t, kind: "flow", rest: plural(r.n, "window", "windows") + " · " + usd(r.T) + " · " + leanText(r.read),
  }));
  return group("flow", SINCE_COPY.titles.flow, grouped(windows) + " " + (windows === 1 ? "window" : "windows") + " across " + plural(rows.length, "name", "names") + ".", lines, rows.length, { windows });
}

export function movesGroup(universe) {
  if (!isObj(universe) || !Array.isArray(universe.t)) return failed("moves");
  const sig = column(universe, "sig");
  const chg = column(universe, "chg");
  const ed = column(universe, "ed");
  if (sig === null || chg === null) return failed("moves");
  const rows = [];
  for (let i = 0; i < universe.t.length; i += 1) {
    const t = tickerOf(universe.t[i]);
    if (t === null) continue;
    const z = moveZ(chg[i], sig[i]);
    if (z.z === null || Math.abs(round2(z.z)) < SINCE_LIMITS.moveZ) continue;
    const near = ed !== null && Number.isFinite(ed[i]) && ed[i] >= 0 && ed[i] <= HORIZON_SESSIONS;
    rows.push({ t, z: round2(z.z), near });
  }
  rows.sort((a, b) => Math.abs(b.z) - Math.abs(a.z) || byCode(a.t, b.t));
  const lines = rows.map((r) => ({ t: r.t, kind: "move", rest: signed2(r.z) + " typical moves" + (r.near ? " · near a report" : "") }));
  return group("moves", SINCE_COPY.titles.moves, plural(rows.length, "name", "names") + " moved " + SINCE_LIMITS.moveZ + " or more typical daily moves.", lines, rows.length);
}

function scoreAt(series, index) {
  return Array.isArray(series) && index >= 0 && index < series.length ? num(series[index]) : null;
}

const sideWord = (score) => (score > 0 ? "bullish" : "bearish");

export function boardGroup(track, base) {
  if (!isObj(track) || !Array.isArray(track.sessions)) return failed("board");
  const entries = Array.isArray(track.names) ? track.names : isObj(track.names) ? Object.values(track.names) : null;
  const band = num(track.deadBand);
  if (entries === null || band === null || band < 0) return failed("board");
  const sessions = track.sessions.map((s) => (isObj(s) ? dayOf(s.d) : null));
  const last = sessions.length - 1;
  let from = -1;
  for (let i = last - 1; i >= 0; i -= 1) {
    if (base !== null && sessions[i] !== null && sessions[i] <= base) { from = i; break; }
  }
  if (last < 1 || sessions[last] === null || from < 0 || sessions[last] <= sessions[from]) {
    return group("board", SINCE_COPY.titles.board, "", [], 0, { since: from >= 0 ? sessions[from] : null });
  }
  const rows = [];
  for (const entry of entries) {
    const t = tickerOf(entry && entry.t);
    if (t === null) continue;
    const now = scoreAt(entry.s, last);
    if (now === null) continue;
    const then = scoreAt(entry.s, from);
    const wasIn = then === null || Math.abs(then) <= band;
    const isIn = Math.abs(now) <= band;
    let kind = null;
    if (wasIn && !isIn) kind = "cleared";
    else if (!wasIn && !isIn && Math.sign(then) !== Math.sign(now)) kind = "flipped";
    else if (!wasIn && isIn) kind = "faded";
    if (kind !== null) rows.push({ t, kind, now, then });
  }
  const rank = { cleared: 0, flipped: 1, faded: 2 };
  rows.sort((a, b) => rank[a.kind] - rank[b.kind] || Math.abs(b.now) - Math.abs(a.now) || byCode(a.t, b.t));
  const lines = rows.map((r) => ({
    t: r.t, kind: r.kind,
    rest: r.kind === "cleared" ? "joined the " + sideWord(r.now) + " board"
      : r.kind === "flipped" ? "flipped from " + sideWord(r.then) + " to " + sideWord(r.now)
        : "fell out of the " + sideWord(r.then) + " board",
  }));
  return group("board", SINCE_COPY.titles.board, plural(rows.length, "name", "names") + " crossed the board line since " + sessions[from] + ".", lines, rows.length, { since: sessions[from] });
}

export function enteringGroup(events, base) {
  if (!isObj(events) || !Array.isArray(events.rows)) return failed("entering");
  const session = dayOf(events.sessionDate);
  if (session === null || base === null) return group("entering", SINCE_COPY.titles.entering, "", [], 0);
  const rows = [];
  for (const r of events.rows) {
    const t = tickerOf(r && r.t);
    const d = r ? dayOf(r.d) : null;
    if (t === null || d === null) continue;
    const until = sessionsBetween(session, d);
    const before = sessionsBetween(base, d);
    if (until === null || before === null) continue;
    if (before > HORIZON_SESSIONS && until >= 0 && until <= HORIZON_SESSIONS) rows.push({ t, until, d });
  }
  rows.sort((a, b) => a.until - b.until || byCode(a.t, b.t));
  const lines = rows.map((r) => ({ t: r.t, kind: "entering", rest: "reports in " + plural(r.until, "session", "sessions") + " · " + r.d }));
  return group("entering", SINCE_COPY.titles.entering, plural(rows.length, "name", "names") + " now report within " + HORIZON_SESSIONS + " sessions.", lines, rows.length);
}

export function soonGroup(universe, events) {
  if (!isObj(universe) || !Array.isArray(universe.t)) return failed("soon");
  const ed = column(universe, "ed");
  if (ed === null) return failed("soon");
  const dates = new Map();
  if (isObj(events) && Array.isArray(events.rows)) for (const r of events.rows) if (tickerOf(r && r.t) !== null) dates.set(r.t, dayOf(r.d));
  const rows = [];
  for (let i = 0; i < universe.t.length; i += 1) {
    const t = tickerOf(universe.t[i]);
    if (t !== null && (ed[i] === 0 || ed[i] === 1)) rows.push({ t, ed: ed[i], d: dates.get(t) || null });
  }
  rows.sort((a, b) => a.ed - b.ed || byCode(a.t, b.t));
  const lines = rows.map((r) => ({ t: r.t, kind: "soon", rest: (r.d === null ? DASH : r.d) + " · timing " + DASH + " not published" }));
  return group("soon", SINCE_COPY.titles.soon, SINCE_COPY.soonNote, lines, rows.length);
}

const visitText = (prev, now) => {
  const same = trtDay(prev) === trtDay(now);
  return same ? "at " + stamp(prev).slice(11) : "on " + stamp(prev).slice(0, 10) + " at " + stamp(prev).slice(11);
};

export function sinceModel({ now, prevSeenMs = null, universe = null, track = null, events = null, alerts = null, clock = null } = {}) {
  const prev = Number.isSafeInteger(prevSeenMs) && prevSeenMs > 0 && prevSeenMs <= now ? prevSeenMs : null;
  const session = isObj(universe) ? dayOf(universe.sessionDate) : null;
  const latestMs = isObj(universe) ? instantOf(universe.generatedAt) : null;
  const out = {
    v: 1, state: "first", serverNow: now, lastVisitMs: prev, latestMs, session, base: null, missed: 0,
    status: SINCE_COPY.first, groups: [],
  };
  if (prev === null) return out;
  if (![universe, track, events, alerts].some(isObj)) return { ...out, state: "unavailable", status: SINCE_COPY.unavailable };
  const base = expectedNightlySession(prev, clock);
  const eventsAt = isObj(events) ? instantOf(events.generatedAt) : null;
  const alertsAt = isObj(alerts) ? (instantOf(alerts.readAt) ?? instantOf(isObj(alerts.record) ? alerts.record.lastReadAt : null) ?? instantOf(alerts.generatedAt)) : null;
  const trackAt = isObj(track) ? instantOf(track.generatedAt) : null;
  const newer = (x) => x !== null && x > prev;
  const universeNew = newer(latestMs);
  const anyNew = universeNew || newer(eventsAt) || newer(alertsAt) || newer(trackAt);
  const missed = base !== null && session !== null ? (sessionsBetween(base, session) ?? 0) : 0;
  if (!anyNew) {
    return { ...out, state: "none", base, missed, status: "No new nightly data since your last visit " + visitText(prev, now) + "." };
  }
  const groups = [];
  groups.push(flowGroup(alerts, prev));
  groups.push(universeNew ? movesGroup(universe) : group("moves", SINCE_COPY.titles.moves, "", [], 0));
  groups.push(universeNew || newer(trackAt) ? boardGroup(track, base) : group("board", SINCE_COPY.titles.board, "", [], 0));
  groups.push(enteringGroup(events, base));
  groups.push(universeNew ? soonGroup(universe, events) : group("soon", SINCE_COPY.titles.soon, "", [], 0));
  const live = groups.filter((g) => g.total > 0 || g.error);
  const state = live.some((g) => g.total > 0) ? "some" : "quiet";
  const status = "Last visit " + stamp(prev) + (latestMs === null ? "." : ". Latest nightly " + stamp(latestMs) + ".");
  const note = missed > 1 ? plural(missed, "nightly update", "nightly updates") + " since then. Windows and moves cover " + session + " only." : null;
  return { ...out, state, base, missed, status, note, quiet: state === "quiet" ? SINCE_COPY.quiet : null, groups: live };
}
