import { num } from "./flows-brief.js";

const KEY = {
  long: "board:long",
  short: "board:short",
  watch: "board:watch",
  events: "events",
  alerts: "flowalerts",
  sectorPremium: "sector:premium",
  market: "market",
  movers: "movers",
  news: "news",
  unusual: "unusual",
};

const answered = (p) => (p && typeof p === "object" && p.status !== "pending" ? p : null);
const rowsOf = (p) => (p && typeof p === "object" && p.status !== "pending" && Array.isArray(p.rows) ? p.rows : null);

function boardReading(s, read) {
  for (const slot of ["long", "short"]) {
    const p = answered(s[slot]);
    if (!p) continue;
    const v = read(p);
    if (v === null) continue;
    return { key: KEY[slot], v };
  }
  return null;
}

const plural = (k, one, many) => (k === 1 ? one : many);

const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
function instantMs(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!INSTANT.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function ymd(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return DATE.test(t) ? t : null;
}

const HOUR = 3600000;

function extremes(items, valueOf) {
  let low = items[0];
  let high = items[0];
  for (const item of items) {
    if (valueOf(item) < valueOf(low)) low = item;
    if (valueOf(item) > valueOf(high)) high = item;
  }
  return { low, high };
}

const RANK = { blocking: 0, caution: 1, note: 2 };

const warn = (severity, id, say, n, sources) =>
  ({ id, severity, say, n: n || {}, sources: sources || [] });

export const THRESHOLDS = Object.freeze({

  driftCautionHours: 6,

  driftBlockingHours: 24,

  shrinkFraction: 0.5,
});

function checkSilentStamp(s) {
  const answeredKeys = [];
  const silent = [];
  for (const slot of Object.keys(KEY)) {
    const p = answered(s[slot]);
    if (!p) continue;
    answeredKeys.push(KEY[slot]);
    if (instantMs(p.generatedAt) === null) silent.push(slot);
  }
  const readable = answeredKeys.length - silent.length;
  if (answeredKeys.length < 2 || readable < 1) return null;
  return silent.map((slot) => warn("caution", "stamp:silent:" + slot,
    KEY[slot] + " is published but states no readable generatedAt, so its age cannot be " +
    "computed at all while the " + readable + " " + plural(readable, "surface", "surfaces") +
    " beside it " + plural(readable, "states", "state") + " theirs.",
    { comparable: readable },
    answeredKeys));
}

function checkStampDrift(s) {
  const stamps = [];
  for (const slot of Object.keys(KEY)) {
    const p = answered(s[slot]);
    if (!p) continue;
    const ms = instantMs(p.generatedAt);

    if (ms === null) continue;
    stamps.push({ slot, at: String(p.generatedAt).trim(), ms });
  }
  if (stamps.length < 2) return null;
  const { low: oldest, high: newest } = extremes(stamps, (x) => x.ms);
  const gap = newest.ms - oldest.ms;
  if (gap < THRESHOLDS.driftCautionHours * HOUR) return [];

  const hours = Math.floor(gap / HOUR);
  const severity = gap >= THRESHOLDS.driftBlockingHours * HOUR ? "blocking" : "caution";
  return [warn(severity, "stamp:drift",
    KEY[oldest.slot] + " was generated " + oldest.at + " and " + KEY[newest.slot] + " " +
    newest.at + ", " + hours + " " + plural(hours, "hour", "hours") + " apart, so the two " +
    "were written by different runs and a reading taken from one beside a reading taken " +
    "from the other compares two sessions.",
    { hours, older: oldest.at, newer: newest.at,
      olderKey: KEY[oldest.slot], newerKey: KEY[newest.slot] },
    [KEY[oldest.slot], KEY[newest.slot]])];
}

function checkSessionSplit(s) {
  const dated = [];
  for (const slot of Object.keys(KEY)) {
    const p = answered(s[slot]);
    if (!p) continue;
    const d = ymd(p.sessionDate);
    if (d === null) continue;
    dated.push({ slot, d });
  }
  if (dated.length < 2) return null;

  const { low: first, high: last } = extremes(dated, (x) => x.d);
  if (first.d === last.d) return [];
  return [warn("blocking", "session:split",
    KEY[first.slot] + " describes the " + first.d + " session and " + KEY[last.slot] +
    " describes " + last.d + ", so a day count taken from one is measured against a " +
    "session the other never saw.",
    { earlier: first.d, later: last.d,
      earlierKey: KEY[first.slot], laterKey: KEY[last.slot] },
    [KEY[first.slot], KEY[last.slot]])];
}

function checkSessionBoundary(s) {
  const al = answered(s.alerts);
  const record = al && al.record && typeof al.record === "object" ? al.record : null;
  const day = record ? ymd(record.date) : null;
  const board = boardReading(s, (p) => ymd(p.sessionDate));
  if (day === null || board === null) return null;
  const session = board.v;
  if (day === session) return [];
  const boardKey = board.key;
  const ahead = day > session;
  return [warn(ahead ? "note" : "caution", "session:boundary",
    ahead
      ? "The flow-alert record on flowalerts covers " + day + " while the boards rank the " +
        session + " session, so a flagged-window count and a board rank are not readings " +
        "from the same day."
      : "The flow-alert record on flowalerts still covers " + day + " while the boards rank " +
        "the " + session + " session, so the tape shown beside today's board belongs to a " +
        "session that has already closed and the record never reset at the boundary.",
    { recordDay: day, session },
    [KEY.alerts, boardKey])];
}

function checkPopulation(s) {
  let prior = 0;
  let held = 0;
  const priorSessions = [];
  const sides = [];
  const sources = [];
  for (const [slot, word] of [["long", "bullish"], ["short", "bearish"]]) {
    const p = answered(s[slot]);
    const r = rowsOf(s[slot]);
    if (!p || !r) continue;
    const memory = p.memory && typeof p.memory === "object" ? p.memory : null;

    if (!memory || memory.status !== "ok") continue;
    const named = num(memory.named);
    if (named === null) continue;

    prior += named;
    held += r.length;
    sides.push(word);
    sources.push(KEY[slot]);
    priorSessions.push(ymd(memory.sessionDate));
  }
  if (!sides.length) return null;

  const agreed = priorSessions[0];
  const priorSession = priorSessions.every((d) => d !== null && d === agreed) ? agreed : null;
  if (prior === 0) return [];
  if (held >= prior * THRESHOLDS.shrinkFraction) return [];
  const fellPct = Math.round((1 - held / prior) * 100);
  const subject = sides.length === 2
    ? "The two boards hold " + held + " " + plural(held, "name", "names") + " between them"
    : "The " + sides[0] + " board holds " + held + " " + plural(held, "name", "names");
  const n = { held, prior, fellPct };
  if (priorSession !== null) n.priorSession = priorSession;

  return [warn("caution", "population:shrank",
    subject + " against " + prior + " on the " +
    (priorSession === null ? "previous" : priorSession) + " board, a fall of " + fellPct +
    "%, and a fall this size comes from the dead band or the earnings gate cutting deeper " +
    "as readily as from a quieter tape, which these two row counts cannot tell apart.",
    n, sources)];
}

function recordReads(al) {
  const record = al && al.record && typeof al.record === "object" ? al.record : null;
  const reads = record ? num(record.reads) : null;
  return reads !== null && Number.isInteger(reads) && reads > 1 ? reads : null;
}

function checkAlertCeiling(s) {
  const al = answered(s.alerts);
  if (!al) return null;
  const limit = num(al.vendorLimit);
  if (limit === null || typeof al.vendorTruncated !== "boolean") return null;
  if (al.vendorTruncated !== true) return [];
  const reads = recordReads(al);
  return [warn("caution", "ceiling:alerts",
    "flowalerts hit the vendor's " + limit + "-row ceiling on " +
    (reads === null ? "the read that built it" : "the latest of the " + reads + " reads merged into its record") +
    ", so the windows flagged this session are unknown in number and at least " + limit +
    ", and the row count on the page below is what our own cap kept of that " +
    (reads === null ? "read" : "record") + " rather than a count of the session.",
    reads === null ? { limit } : { limit, reads },
    [KEY.alerts])];
}

function checkNewsCeiling(s) {
  const nw = answered(s.news);
  if (!nw) return null;
  const requested = num(nw.requested);
  const returned = num(nw.returned);
  if (requested === null || returned === null || typeof nw.atVendorLimit !== "boolean") return null;
  if (nw.atVendorLimit !== true) return [];

  if (returned < requested) return null;
  return [warn("caution", "ceiling:news",
    "news returned " + returned + " " + plural(returned, "headline", "headlines") +
    " against the " + requested + " it requested, so the response ended at the vendor's own " +
    "ceiling and the population above it is unknown and at least that large.",
    { returned, requested },
    [KEY.news])];
}

function checkChainCeiling(s) {
  const un = answered(s.unusual);
  if (!un) return null;
  const chains = num(un.namesSeen);
  const truncated = num(un.namesTruncated);
  if (chains === null || truncated === null) return null;
  if (truncated <= 0) return [];
  return [warn("caution", "ceiling:chains",
    "unusual read " + chains + " option " + plural(chains, "chain", "chains") + " and " +
    truncated + " of them came back truncated, so its contract counts are floors for those " +
    "names rather than totals.",
    { chains, truncated },
    [KEY.unusual])];
}

function checkInheritedCeiling(s) {
  const al = answered(s.alerts);
  const mv = answered(s.movers);
  if (!al || !mv) return null;
  const limit = num(al.vendorLimit);
  const premium = mv.premium && typeof mv.premium === "object" ? mv.premium : null;
  const band = premium && premium.byContract && typeof premium.byContract === "object"
    ? premium.byContract : null;
  const bandRows = band && Array.isArray(band.rows) ? band.rows : null;
  if (limit === null || bandRows === null || typeof al.vendorTruncated !== "boolean") return null;
  if (al.vendorTruncated !== true) return [];
  const ranked = bandRows.length;
  const reads = recordReads(al);

  return [warn("caution", "ceiling:inherited",
    "The movers per-contract premium band is cut from a flowalerts " +
    (reads === null ? "read that" : "record whose latest read") + " hit the " +
    "vendor's " + limit + "-row ceiling, so the " + ranked + " contract " +
    plural(ranked, "window", "windows") + " it ranks " + plural(ranked, "is", "are") +
    " the largest of what arrived under that ceiling rather than the largest of the session.",
    { limit, ranked },
    [KEY.movers, KEY.alerts])];
}

function boardField(s, field) {
  const seen = [];
  for (const slot of ["long", "short", "watch"]) {
    const p = answered(s[slot]);
    if (!p) continue;
    const v = num(p[field]);
    if (v === null) continue;
    seen.push({ slot, v });
  }
  return seen;
}

function checkScoredPool(s) {
  const seen = boardField(s, "scored");
  if (seen.length < 2) return null;
  const { low: lo, high: hi } = extremes(seen, (x) => x.v);
  if (lo.v === hi.v) return [];
  return [warn("blocking", "scored:disagree",
    KEY[hi.slot] + " reports " + hi.v + " names scored and " + KEY[lo.slot] + " reports " +
    lo.v + ", and one scoring pass cannot produce two pool sizes, so a share printed " +
    "against the pool is dividing by a count from a different run.",
    { higher: hi.v, lower: lo.v, higherKey: KEY[hi.slot], lowerKey: KEY[lo.slot] },
    [KEY[hi.slot], KEY[lo.slot]])];
}

function checkDeadBand(s) {
  const seen = boardField(s, "deadBand");
  if (seen.length < 2) return null;
  const { low: narrow, high: wide } = extremes(seen, (x) => x.v);
  if (narrow.v === wide.v) return [];

  return [warn("blocking", "band:disagree",
    KEY[wide.slot] + " partitions on a dead band of ±" + wide.v + " and " + KEY[narrow.slot] +
    " on ±" + narrow.v + ", so the same score puts a name on a board by one surface and " +
    "inside the band by the other.",
    { wider: wide.v, narrower: narrow.v, widerKey: KEY[wide.slot], narrowerKey: KEY[narrow.slot] },
    [KEY[wide.slot], KEY[narrow.slot]])];
}

function checkPartition(s) {
  const lng = answered(s.long);
  const sht = answered(s.short);
  if (!lng || !sht) return null;
  const bullish = num(lng.cleared);
  const bearish = num(sht.cleared);
  const neutral = num(lng.neutral) ?? num(sht.neutral);
  const scored = num(lng.scored) ?? num(sht.scored);
  if (bullish === null || bearish === null || neutral === null || scored === null) return null;
  const accounted = bullish + bearish + neutral;
  if (accounted === scored) return [];
  const head = "The two boards account for " + accounted + " names — " + bullish +
    " cleared bullish, " + bearish + " cleared bearish and " + neutral +
    " inside the dead band — against " + scored + " scored, so ";
  const n = { accounted, bullish, bearish, neutral, scored };
  if (accounted > scored) {
    return [warn("blocking", "partition:impossible",
      head + "the sides were not cut from one pool and any share printed from them is wrong.",
      n, [KEY.long, KEY.short])];
  }
  const missing = scored - accounted;
  n.missing = missing;
  return [warn("blocking", "partition:impossible",
    head + missing + " " + plural(missing, "name", "names") + " " +
    plural(missing, "was", "were") + " scored and " + plural(missing, "reaches", "reach") +
    " no surface a reader can open.",
    n, [KEY.long, KEY.short])];
}

function checkGate(s) {
  const ev = answered(s.events);
  if (!ev) return null;
  const out = [];
  let ran = false;

  const board = boardReading(s, (p) => num(p.gateDays));
  const eventsDays = num(ev.gateDays);
  if (board !== null && eventsDays !== null) {
    ran = true;
    if (board.v !== eventsDays) {
      out.push(warn("blocking", "gate:window",
        "The boards apply a " + board.v + "-day earnings gate and events publishes a " +
        eventsDays + "-day window, so a name the board kept can read as gated on the " +
        "calendar beside it.",
        { boardDays: board.v, eventsDays },
        [board.key, KEY.events]));
    }
  }

  const origin = boardReading(s, (p) => ymd(p.gateOrigin));
  const eventsOrigin = ymd(ev.gateOrigin);
  if (origin !== null && eventsOrigin !== null) {
    ran = true;
    if (origin.v !== eventsOrigin) {
      out.push(warn("blocking", "gate:origin",
        "The boards count days to earnings from " + origin.v + " and events counts from " +
        eventsOrigin + ", so one name's day count differs between two pages that both call " +
        "it days to earnings.",
        { boardOrigin: origin.v, eventsOrigin },
        [origin.key, KEY.events]));
    }
  }

  return ran ? out : null;
}

const CHECKS = [
  checkSilentStamp,
  checkStampDrift,
  checkSessionSplit,
  checkSessionBoundary,
  checkPopulation,
  checkAlertCeiling,
  checkNewsCeiling,
  checkChainCeiling,
  checkInheritedCeiling,
  checkScoredPool,
  checkDeadBand,
  checkPartition,
  checkGate,
];

export function assessStoreFrom(published) {
  const p = published && typeof published === "object" ? published : {};
  const out = {};
  for (const [slot, key] of Object.entries(KEY)) {
    out[slot] = Object.hasOwn(p, key) ? p[key] : { status: "pending" };
  }
  return out;
}

export function assess(store) {
  const s = store && typeof store === "object" ? store : {};
  const warnings = [];
  let checked = 0;
  for (const check of CHECKS) {
    const found = check(s);
    if (found === null) continue;
    checked++;
    for (const w of found) warnings.push(w);
  }
  warnings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { warnings, checked, questions: CHECKS.length };
}
