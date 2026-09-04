/* =============================================================
   flows-alerts.js — the vendor's flow alerts, shaped and ranked.

   WHAT A ROW IS, precisely, because everything else here follows
   from it: one row is one ALERT — a window of activity in ONE
   contract that one of the vendor's own rules flagged. The vendor
   states the window (start_time..end_time), a trade count, a total
   size, a total premium and its ask-side/bid-side split, and a set
   of flags (sweep, floor, single-leg, all-opening). That is more
   than the chain counter has ever carried — a size, a span, a side
   — and it is still NOT the tape: a row aggregates trade_count
   executions, so it is never "a trade", and the page built on it
   may not call it one.

   THE SELECTION IS THE VENDOR'S, AND THAT IS THE HEADLINE CAVEAT.
   These rows exist because a rule named in `alert_rule` fired, and
   the rules' definitions are the vendor's own — not published, not
   observable, not reproducible from this payload. The population is
   therefore "what the vendor chose to flag", not "the most unusual
   activity in the market", and the notes say so in those words.
   Ranking INSIDE that population by its own published premium adds
   no new assumption; treating the population as complete would.

   FIELD PROVENANCE: the field set below was not taken from the
   vendor's documentation — documentation has been wrong five times
   in this repo — but from the probe's first-row key dumps on three
   separate live runs (2026-08-27 twice, 2026-08-28). Fields the
   probe saw only sometimes (strike, price, iv_start/iv_end,
   total_size, option_chain) are treated as optional everywhere.
   ============================================================= */

import { parseOptionSymbol } from "./flows-premium.js";

/* Absent in, absent out — Number(null) is 0 and a confident zero is the
   house defect. Same idiom as flows-scores.js, for the same reason. */
const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* A flag the vendor did not send is NOT false. `has_sweep: false` says the
   vendor looked and found none; an absent key says nothing was asked. The
   two must stay distinguishable all the way to the page, where null renders
   as an em dash and false as a plain "no". */
const flag = (v) => (v === null || v === undefined ? null : Boolean(v));

/** Rows the pooled payload carries. A choice, published as `cap`. */
export const ALERT_ROWS = 60;

export const ALERTS_NOTES = Object.freeze({
  unit:
    "One row is one alert: a window of activity in one contract that one of " +
    "the vendor's own rules flagged, carrying the vendor's stated span, its " +
    "count of executions, a total size and a total premium with its " +
    "ask-side/bid-side split. A row aggregates that whole window, so it is " +
    "never a single transaction and this page does not present it as one.",
  selection:
    "The population is what the vendor's rules chose to flag. The rules are " +
    "named per row but their definitions are the vendor's own — not " +
    "published, not reproducible from this payload — so absence from this " +
    "list is not evidence of quiet, and presence is not a ranking of the " +
    "whole market. The premium ordering below ranks only within what was " +
    "flagged.",
  sides:
    "Ask-side and bid-side premium are the vendor's attribution of the " +
    "window's dollars against the quote. The split is carried as published; " +
    "this page adds no inference about who initiated, and the two need not " +
    "sum to the total where the vendor left dollars between the quotes.",
  flags:
    "Sweep, floor, single-leg and all-opening are the vendor's flags, " +
    "reported as sent. A dash means the vendor did not carry the flag on " +
    "that row — which is not the same fact as the flag being off.",
  record:
    "During the session this feed is a RECORD, not a snapshot. The vendor's " +
    "list is a rolling window \u2014 a name flagged at 09:31 has usually " +
    "fallen off it by midday \u2014 so each fifteen-minute read is merged " +
    "into the day's record rather than replacing it. Every row says when the " +
    "record first held it, when a read last carried it, and how many reads " +
    "carried it; the first of those is the early fact and it never advances. " +
    "The record covers one Eastern session, names that date, and starts " +
    "empty at the next one \u2014 yesterday's flags under today's timestamp " +
    "would be a claim about a day that never made it. When the union outgrows " +
    "its ceiling the smallest premiums are shed first, in the same order the " +
    "list is ranked, and both the ceiling and what it removed are published " +
    "beside it \u2014 with a running count of everything that has entered the " +
    "record today, because the ceiling compounds and the count of what the " +
    "record still holds would otherwise stop growing at the moment it began " +
    "to overflow.",
  refusals:
    "No intent and no identity: nothing here says who was active or why, " +
    "and no flag makes that observable. Rows are windows, not executions, " +
    "so no number here is an execution price either.",
});

/**
 * One vendor alert row, shaped for publication. Null on an unusable row
 * (no ticker, or nothing measurable on it at all).
 */
export function alertRow(raw, { stageOf } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const t = typeof raw.ticker === "string" && raw.ticker ? raw.ticker : null;
  if (!t) return null;

  const oc = typeof raw.option_chain === "string" && raw.option_chain
    ? raw.option_chain : null;
  const parsed = oc ? parseOptionSymbol(oc) : null;

  const prem = num(raw.total_premium);
  const size = num(raw.total_size);
  const trades = num(raw.trade_count);
  /* A row with no premium, no size and no count measures nothing this
     surface publishes; shaping it would print a row of dashes. */
  if (prem === null && size === null && trades === null) return null;

  return {
    t,
    oc,
    /* Derived from the option symbol by the same parser the premium desk
       uses — one spelling of one relation. Null when the vendor sent no
       symbol or an unparseable one, and the coverage counts say how often. */
    cp: parsed ? parsed.type : null,
    k: parsed ? parsed.strike : num(raw.strike),
    exp: parsed ? parsed.expiry : (typeof raw.expiry === "string" ? raw.expiry.slice(0, 10) : null),
    prem, size, trades,
    askPrem: num(raw.total_ask_side_prem),
    bidPrem: num(raw.total_bid_side_prem),
    sweep: flag(raw.has_sweep),
    floor: flag(raw.has_floor),
    single: flag(raw.has_singleleg),
    opening: flag(raw.all_opening_trades),
    oi: num(raw.open_interest),
    /* The vendor's own ratio, carried under the vendor's name. Recomputing
       it from oi here would create a second spelling of a quantity whose
       denominator's as-of the vendor does not state. */
    voi: num(raw.volume_oi_ratio),
    ivStart: num(raw.iv_start),
    ivEnd: num(raw.iv_end),
    px: num(raw.underlying_price),
    spanStart: typeof raw.start_time === "string" ? raw.start_time : null,
    spanEnd: typeof raw.end_time === "string" ? raw.end_time : null,
    rule: typeof raw.alert_rule === "string" && raw.alert_rule ? raw.alert_rule : null,
    /* Where the name stood in the board's own funnel, so a reader can see
       at a glance whether the flagged name is one the board scores at all. */
    st: typeof stageOf === "function" ? (stageOf(t) || "foreign") : null,
  };
}

/** Rows the movers band carries. A choice, published as `cap` beside it. */
export const ALERT_BAND_ROWS = 8;

/**
 * The per-contract band for the movers panel, cut from ALREADY-SHAPED alert
 * rows (buildFlowAlerts().rows — premium-ranked with a total tie-break, so
 * this function adds no ordering of its own and stays deterministic for free).
 *
 * WHY THIS EXISTS: the movers premium lists are `byName` because the screener
 * reports whole-symbol net premium, and for months a comment said contract-
 * level ranking "needs a flow-alerts endpoint this key does not reach". The
 * feed has since been proven reachable and is fetched every run — this band
 * is that stale sentence retired. It stays the VENDOR'S selection: the band
 * ranks inside what the alert rules flagged, never the whole tape, and the
 * basis string on the payload says so.
 */
export function alertBand(shapedRows, { cap = ALERT_BAND_ROWS } = {}) {
  const usable = (Array.isArray(shapedRows) ? shapedRows : [])
    .filter((r) => r && r.prem !== null && typeof r.t === "string");
  const rows = usable.slice(0, cap).map((r) => ({
    t: r.t, oc: r.oc, cp: r.cp, k: r.k, exp: r.exp,
    prem: r.prem, sweep: r.sweep, rule: r.rule,
  }));
  return {
    basis: "vendor-flagged windows",
    rows,
    seen: usable.length,
    cap,
    shed: Math.max(0, usable.length - rows.length),
  };
}

/* THE ROW ORDERING, in ONE place because this feed now has two rankers.
   The nightly build ranks a single vendor read; the intraday record re-ranks
   a union of reads after every merge. Two spellings of "which row is first"
   would let the same rows publish in two different orders depending on which
   process wrote last, and the list would reshuffle at 09:15 for a reason no
   reader could name.

   Premium descending. Rows the vendor sent WITHOUT a premium rank after every
   row that has one — they are still alerts, they just cannot be ranked by a
   number they lack — ordered among themselves by size then name. The `?? -1`
   below is not a confident zero: a measured size of 0 must still sort above a
   size the vendor never sent, and -1 is the only sentinel that keeps those two
   apart. Ties break totally so two runs over one response publish identical
   bytes. */
const byName = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)
  || ((a.oc || "") < (b.oc || "") ? -1 : (a.oc || "") > (b.oc || "") ? 1 : 0);

function byPremium(a, b) {
  if (a.prem === null && b.prem === null) {
    return ((b.size ?? -1) - (a.size ?? -1)) || byName(a, b);
  }
  if (a.prem === null) return 1;
  if (b.prem === null) return -1;
  return (b.prem - a.prem) || byName(a, b);
}

/* Coverage counted over the rows ACTUALLY PUBLISHED, because the page prints
   it as "N of <rows.length> carried a parseable contract symbol". Shared by
   both writers for the same reason the comparator is: the record's coverage
   after a merge has to be counted the same way the nightly's was. */
function coverageOf(rows) {
  const count = (f) => rows.filter(f).length;
  return {
    withPremium: count((r) => r.prem !== null),
    withSpan: count((r) => r.spanStart !== null && r.spanEnd !== null),
    withContract: count((r) => r.cp !== null),
    sweeps: count((r) => r.sweep === true),
    opening: count((r) => r.opening === true),
    calls: count((r) => r.cp === "C"),
    puts: count((r) => r.cp === "P"),
  };
}

/**
 * The published feed: shaped, ranked by the vendor's own premium inside the
 * vendor's own selection, capped with the shed counted.
 *
 * THE SHAPER OWNS THE ENVELOPE, AND IT LEARNED THAT THE EXPENSIVE WAY.
 * This function accepted only a bare array, so the two writers of the
 * `flowalerts` key had to agree, out of band, on who unwrapped. They did not.
 * The nightly pipeline's uw() returns `body.data` already unwrapped; the
 * worker's uwFetch() returns the parsed body verbatim. Handed
 * `{data:[...60 rows...]}`, the `Array.isArray` guard below iterated NOTHING
 * and returned a well-formed, entirely empty feed — and the cron's unguarded
 * spread wrote that over sixty real rows, every fifteen minutes, all session.
 * The Overview then reported "FLAGGED WINDOWS 0" over 569 screened names: a
 * confident claim about the market manufactured by a type check.
 *
 * The guard is now an UNWRAP rather than a filter, so a caller cannot get the
 * envelope wrong. Putting it here rather than at the two call sites is the
 * point: the shaper is the only place that knows what a row is, and one
 * spelling in one function removes the class of bug instead of this instance.
 */
export function buildFlowAlerts(rawRows, { stageOf, cap = ALERT_ROWS } = {}) {
  const shaped = [];
  let unusable = 0;
  const incoming = Array.isArray(rawRows)
    ? rawRows
    : (rawRows && typeof rawRows === "object" && Array.isArray(rawRows.data))
      ? rawRows.data
      : [];
  for (const raw of incoming) {
    const row = alertRow(raw, { stageOf });
    if (row) shaped.push(row);
    else unusable++;
  }

  shaped.sort(byPremium);

  const seen = shaped.length;
  const rows = shaped.slice(0, cap);

  return {
    rows,
    seen,
    unusable,
    shed: Math.max(0, seen - rows.length),
    cap,
    coverage: coverageOf(rows),
    status: rows.length ? "ok" : "quiet",
    notes: ALERTS_NOTES,
  };
}

/* =============================================================
   THE SESSION'S RECORD — the union of a day's reads.

   WHAT WAS WRONG BEFORE, precisely, because the shape below is
   built out of that defect. The Worker's fifteen-minute cron
   wrote `{...prev, ...buildFlowAlerts(read)}`. The spread
   replaces `rows` wholesale, and the vendor's list is a ROLLING
   window of its newest flags — so a name flagged at 09:31 was
   gone from the page at 09:46, and every morning's flags were
   erased by lunch. The page then showed "what the vendor's rules
   flagged in the last few minutes" under a heading a reader takes
   to mean "what the vendor's rules flagged today".

   For an early-warning surface the useful fact is not the newest
   window; it is "this name was flagged at 09:31 and again at
   11:04", and no single read can say that. Only a union across
   the session's reads can, and only if it keeps FIRST-seen as
   well as last.
   ============================================================= */

/**
 * The identity of one alert ACROSS reads.
 *
 * (name, contract, window start) is that identity. The vendor restates an
 * open window with a moving end_time, premium, size and count; only its start
 * holds still. Keying on the whole row would make every restatement a new
 * alert and the record would fill with copies of one window. Keying on
 * (name, contract) alone would fuse two genuinely separate windows on one
 * contract into one and lose the earlier one's first-seen time — the fact
 * this record exists to keep.
 *
 * A row the vendor sent with NO start_time has nothing left to be identified
 * by, so those collapse per (name, contract, rule). Under-counting an
 * unidentifiable window is the safe error here: the alternative is a row that
 * can never be recognised again and therefore re-enters the record on every
 * read, all session, until the ceiling sheds the rows that are real.
 *
 * Null on a row with no ticker — such a row cannot be held or found again.
 */
export function alertKey(row) {
  if (!row || typeof row !== "object") return null;
  const t = typeof row.t === "string" && row.t ? row.t : null;
  if (!t) return null;
  const oc = typeof row.oc === "string" ? row.oc : "";
  /* NUL separates the parts because it is not legal in a ticker, an option
     symbol or a vendor rule name, so no pair of different rows can spell one
     another's key by accident. A "|" could: rule names are the vendor's. */
  const SEP = "\u0000";
  return typeof row.spanStart === "string" && row.spanStart
    ? "w" + SEP + t + SEP + oc + SEP + row.spanStart
    : "u" + SEP + t + SEP + oc + SEP + (typeof row.rule === "string" ? row.rule : "");
}

/**
 * The record's ceilings, and why these two numbers.
 *
 * The stored payload is served whole to a browser and the ingest route
 * refuses anything over 128KB, so a union that grew with the session would
 * eventually stop being publishable: 28 reads of up to 60 windows is 1680
 * rows in the worst case. One fully-populated row of this shape measures
 * about 505 bytes — MEASURED, not guessed: every vendor field present, a long
 * rule name, and the record's own two ISO instants. 180 rows is therefore
 * about 91KB of rows under a 96KB ceiling, which leaves the envelope, the
 * coverage counts and the notes their room.
 *
 * Rows is the ceiling that normally bites; bytes is the backstop for a day of
 * unusually fat rows, and `record.shedBy` names which one did. Both are
 * published beside the shed count, because a capped list that does not say it
 * is capped invites reading the cap as the population — the same argument
 * ALERT_ROWS carries one level up.
 */
export const MERGED_ALERT_ROWS = 180;
export const MERGED_ALERT_BYTES = 96 * 1024;

/* A row read back out of the STORED payload rather than shaped from the wire.
   Rows written by an earlier build may lack keys this one reads, and
   `undefined !== null` is true — so an absent premium would sail straight
   past the comparator's null test and land in `b.prem - a.prem` as NaN, which
   silently randomises the whole ranking. Normalising absence to null on the
   way in keeps "absent in, absent out" true across a round trip through JSON
   and across a schema that changed under a running session. */
function carriedRow(row) {
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = (v) => (typeof v === "string" && v ? v : null);
  return {
    ...row,
    prem: n(row.prem), size: n(row.size), trades: n(row.trades),
    cp: s(row.cp), spanStart: s(row.spanStart), spanEnd: s(row.spanEnd),
    /* The record's own three fields are normalised on the way in too, so
       every published row carries all three KEYS even when a half-written
       payload carried none: an absent key and a null are different silences,
       and only the null one can be rendered as "not known". A row held
       without a sighting count is treated as one prior sighting when it is
       next seen — the minimum that is certainly true, since being in the
       record at all means some read put it there. */
    firstAt: s(row.firstAt), lastAt: s(row.lastAt), reads: n(row.reads),
  };
}

/**
 * Merge one vendor read into the day's record and re-rank the union.
 *
 * PER ROW it publishes `firstAt` (the read that first held this window),
 * `lastAt` (the most recent read that carried it) and `reads` (how many
 * carried it). firstAt never advances; that is the entire point of it.
 * "Flagged at 09:31 and again at 11:04" and "flagged at 11:04" are different
 * facts, and the first is the one an early-warning page is for.
 *
 * IT STARTS OVER AT THE SESSION BOUNDARY AND NOWHERE ELSE. The record names
 * the Eastern trading date it covers, and a read from a different date starts
 * a new record instead of adding to yesterday's. An age-based expiry was the
 * obvious alternative and is wrong: it would leave a record that is part
 * today and part yesterday with no way to say which rows are which. Carrying
 * yesterday's flags into today under today's readAt is the same class of
 * claim as a confident zero — a fact the day did not produce, wearing the
 * day's timestamp. When the caller cannot NAME the date (`sessionDate` null)
 * the record also starts over, because a record whose day is unknown cannot
 * be compared with the next read's day at all.
 *
 * IT DOES NOT DECIDE WHETHER TO WRITE. That guard stays at the call site,
 * where a quiet or unreadable vendor read must leave the stored copy exactly
 * as it stands. Merging makes an empty read less destructive than the old
 * spread did; it does not make writing one honest, because the envelope's
 * readAt would then claim a freshness the rows do not have.
 *
 * @param prev  the STORED payload (or null) — its `rows` and its `record`.
 * @param next  the fresh buildFlowAlerts() result for this read.
 * @param at    ISO instant of this read; `sessionDate` is its Eastern date.
 */
export function mergeAlerts(prev, next, {
  at = null,
  sessionDate = null,
  cap = MERGED_ALERT_ROWS,
  byteCap = MERGED_ALERT_BYTES,
} = {}) {
  const readAt = typeof at === "string" && at ? at : null;
  const date = typeof sessionDate === "string" && sessionDate ? sessionDate : null;
  const fresh = next && Array.isArray(next.rows) ? next.rows : [];
  const held = prev && typeof prev === "object" ? prev : null;
  const heldRecord = held && held.record && typeof held.record === "object" ? held.record : null;
  const heldRows = held && Array.isArray(held.rows) ? held.rows : [];

  /* WHICH DAY THE STORED ROWS BELONG TO — the one question that decides
     whether they carry at all. Three answers, named separately because they
     are three different facts about the stored copy:
       "cold"             — no record on it: the nightly build published this
                            key, or a build older than this record shape did.
                            Either way those rows describe a closed session.
       "undated"          — this read cannot name its own day, so no stored
                            day can be compared with it.
       "session-boundary" — the record is real and belongs to another day. */
  let reset = null;
  if (!heldRecord) reset = "cold";
  else if (!date) reset = "undated";
  else if (heldRecord.date !== date) reset = "session-boundary";

  const byKey = new Map();
  if (!reset) {
    for (const row of heldRows) {
      const k = alertKey(row);
      if (!k || byKey.has(k)) continue;
      byKey.set(k, carriedRow(row));
    }
  }
  const carriedIn = byKey.size;

  let again = 0;
  let entered = 0;
  const thisRead = new Set();
  for (const row of fresh) {
    const k = alertKey(row);
    if (!k) continue;
    /* One read that lists the same window twice is ONE sighting. Counting it
       twice would turn `reads` into a claim about the vendor's response shape
       rather than about the session. The first copy wins because the read
       arrives premium-ranked, so the survivor is the larger statement. */
    if (thisRead.has(k)) continue;
    thisRead.add(k);
    const prior = byKey.get(k);
    if (prior) {
      again++;
      byKey.set(k, {
        /* The vendor's own numbers come from the LATEST read — an open window
           restates its end, its premium, its size and its count — but the
           record's own three fields do not. firstAt is the fact being kept,
           so it is read off what was already held and never off `row`. */
        ...row,
        firstAt: typeof prior.firstAt === "string" && prior.firstAt ? prior.firstAt : readAt,
        lastAt: readAt,
        reads: (Number.isFinite(prior.reads) ? prior.reads : 1) + 1,
      });
    } else {
      entered++;
      byKey.set(k, { ...row, firstAt: readAt, lastAt: readAt, reads: 1 });
    }
  }

  const union = Array.from(byKey.values()).sort(byPremium);

  /* THE CEILING, AND WHICH ONE BIT. The shed is counted and the ordering it
     shed by is named: "180 windows" printed beside an unstated 412 is a
     ceiling being read as a population, which is the defect `cap` and `shed`
     exist to prevent everywhere else in this codebase. */
  const rows = [];
  let bytes = 0;
  let shedBy = null;
  for (const row of union) {
    if (rows.length >= cap) { shedBy = "rows"; break; }
    /* Code units, not bytes: every string a row carries is ASCII — a ticker,
       an option symbol, a vendor rule name, two ISO instants — so the two
       agree, and the ceiling's headroom absorbs a multibyte rule name if the
       vendor ever sends one. The +1 is the comma this row costs in the array. */
    const width = JSON.stringify(row).length + 1;
    if (bytes + width > byteCap) { shedBy = "bytes"; break; }
    rows.push(row);
    bytes += width;
  }

  const shed = union.length - rows.length;
  const priorReads = !reset && heldRecord && Number.isFinite(heldRecord.reads)
    ? heldRecord.reads : 0;
  const priorEver = !reset && heldRecord && Number.isFinite(heldRecord.everEntered)
    ? heldRecord.everEntered : 0;

  return {
    rows,
    /* `seen` is the whole union, so the page's "N of SEEN flagged windows"
       counts the SESSION's windows rather than this read's sixty. */
    seen: union.length,
    /* Unusable stays a fact about THIS read — rows the vendor sent that could
       not be shaped. Accumulating it would be meaningless: an unusable row
       has no identity, so the same one arriving twice cannot be recognised
       and a running total would count the vendor's repetition as ours.

       NULL, NOT ZERO, when the read carried no count of its own. A published
       0 must mean "counted, and there were none"; handed junk instead of a
       shaped read this function counted nothing, and saying so costs one
       null. Number(null) === 0 is this repository's oldest scar and it does
       not stop being one inside a fallback. */
    unusable: next && Number.isFinite(next.unusable) ? next.unusable : null,
    shed,
    cap,
    coverage: coverageOf(rows),
    status: rows.length ? "ok" : "quiet",
    notes: ALERTS_NOTES,
    record: {
      date,
      reads: priorReads + 1,
      firstReadAt: !reset && heldRecord && typeof heldRecord.firstReadAt === "string"
        ? heldRecord.firstReadAt : readAt,
      lastReadAt: readAt,
      union: union.length,
      kept: rows.length,
      /* The three ways a row relates to THIS read, kept apart because they
         answer different questions: `entered` is new flags (the early-warning
         number), `again` is repetition, and `carried` is what the vendor's
         rolling window has already dropped while this record still holds it —
         exactly the rows the old wholesale spread destroyed. */
      entered,
      again,
      carried: carriedIn - again,
      /* THE DENOMINATOR THAT KEEPS MOVING AFTER THE CEILING BITES, and it is
         needed because the ceiling COMPOUNDS: each read merges into the rows
         the last one KEPT, so once the record is full `union` can never
         exceed cap + one read again. A reader watching `union` would see the
         session's population stop growing at exactly the moment it started
         overflowing — a ceiling read as a population, which is the defect
         `cap` and `shed` exist to prevent everywhere else here.

         `everEntered` counts how many times a window has entered this record
         today. That equals the distinct windows the session flagged unless
         the ceiling shed one that the vendor then flagged again, which counts
         it twice — so it is an UPPER bound on the day's distinct windows, and
         `union` is the lower one: what the record still holds. Two honest
         bounds beat one number that is quietly neither. */
      everEntered: priorEver + entered,
      shed,
      shedBy,
      byteCap,
      bytes,
      reset,
    },
  };
}
