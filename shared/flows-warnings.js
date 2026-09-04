/* =============================================================
   flows-warnings.js — the warnings that have read the payloads.

   A banner that says "data may be stale" is not a warning. It fires
   on every page whether or not anything is wrong, it names nothing,
   and a reader learns within a week to look past it — at which
   point the one morning it was telling the truth is the morning it
   is invisible. This module refuses to emit that sentence. Every
   warning here has READ the payloads, can NAME the surfaces that
   disagree, and quotes the numbers that make the disagreement a
   fact rather than a worry.

   MOST OF THESE CANNOT BE SEEN FROM ONE PAYLOAD, and that is the
   point of putting them here rather than in a renderer. A board
   that says "100 scored" is internally consistent; it is only wrong
   beside a watch list that says 87 were scored in the same pass. A
   flow-alert count is only misleading beside the movers band that
   was cut from it. A stamp is only stale relative to another stamp.
   Each renderer sees one key; this sees the store.

   PURE, LIKE shared/flows-brief.js AND FOR THE SAME REASON. No DOM,
   no fetch, no clock. In particular there is NO `Date.now()` here:
   an age measured against the machine's wall clock would make the
   same store produce different warnings in the pipeline, in the
   Worker and in a test, and the one place this product cannot
   afford a moving answer is the place that tells a reader something
   is wrong. Every interval below is measured BETWEEN two stamps the
   payloads themselves carry.

   THE STORE IS THE BRIEFING'S STORE, plus four slots. flows-brief
   reads six; these checks read those six and four more, under the
   same camelCase convention and with the same rename owed by the
   caller, because the published key names are not identifiers:

     long  <- board:long        market  <- market
     short <- board:short       movers  <- movers
     watch <- board:watch       news    <- news
     events        <- events    unusual <- unusual
     alerts        <- flowalerts
     sectorPremium <- sector:premium

   A slot holding {status:"pending"} has not been published; a slot
   holding null could not be read; a slot holding rows: [] was
   measured and holds nothing. All three are SILENCES, and a silence
   is never a contradiction. A check whose inputs are absent reports
   nothing and does not count itself as having run — `checked` is
   how many questions the store could actually answer, so a caller
   can tell "nothing is wrong" from "almost nothing was asked".
   ============================================================= */

/* THE COERCION IS IMPORTED RATHER THAN COPIED. shared/flows-brief.js
   already exports the canonical absence-before-coercion helper and
   this module lives beside it in the same Node/Worker-only
   directory, so a second spelling of `num` here would be a second
   place for the Number(null) === 0 defect to come back. Both files
   are pure; the import costs nothing and pins the two to one rule. */
import { num } from "./flows-brief.js";

/* THE PUBLISHED KEY, NOT THE SLOT, IS WHAT A WARNING NAMES. A reader
   told "long disagrees with watch" has to be told twice; a reader
   told "board:long disagrees with board:watch" can go and open both.
   The map lives here once so the sentences below cannot drift from
   the ingest allowlist the Worker enforces. */
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

/* Matching shared/flows-brief.js exactly, because a payload this
   module calls unreadable and that module calls answered would put
   a warning beside a fact that contradicts it. */
const answered = (p) => (p && typeof p === "object" && p.status !== "pending" ? p : null);
const rowsOf = (p) => (p && typeof p === "object" && p.status !== "pending" && Array.isArray(p.rows) ? p.rows : null);

/* THE FIELD CHOOSES THE BOARD, AND NOT THE OTHER WAY ROUND.
   Several checks below need one value the boards publish once between
   them — the session they rank, the gate they applied — and the two
   sides normally carry identical envelopes, so reaching for whichever
   side answered first looks like a free choice. It is not one. When the
   first side is published and SILENT about the field — a thin copy, or
   one written before the field existed — reading it off that side
   discards the reading the other side is still publishing, and the check
   then declines on a store that could have answered it. The decline is
   invisible from outside: DELETING the quiet board from that same store
   makes the contradiction reappear, which is a warning engine whose
   findings depend on how much of the store it was handed. So each field
   is resolved across the sides in turn and the board that actually
   carried it is the board the sentence names. */
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

/* THE SHAPE TEST BEFORE THE PARSE, for the reason shared/flows-freshness.js
   states over easternDay: Date.parse is lenient enough to be dangerous.
   "2026-09" comes back FINITE and means midnight UTC on the first, and
   `new Date(null)` is not an invalid date at all — it is the epoch, so a
   payload with no stamp would be dated 1969 and reported as fifty-seven
   years stale rather than as unstamped. A stamp needs a date AND a time
   before this module will subtract it from another one. */
const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
function instantMs(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!INSTANT.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/* A SESSION DATE IS A DATE AND NOT AN INSTANT, and this module compares
   the published strings rather than re-deriving a calendar day from a
   timestamp. Both `sessionDate` and the alerts record's `date` were
   already resolved in America/New_York by the writer that stamped them;
   a second conversion here would be a second opinion about which day a
   read belongs to, and the Worker's own comment on easternSessionDate
   says what that costs — two payloads a reader compares, named by two
   calendars, disagreeing on every row. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function ymd(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return DATE.test(t) ? t : null;
}

const HOUR = 3600000;

/* THE TWO ENDS OF A SPREAD, WITH THE TIE GOING TO THE FIRST DECLARED.

   Most of the store shares one stamp and one session, so the extremes
   below are almost always one outlier against a crowd — and which
   member of the crowd gets named is then decided by a sort's tie
   handling, which means the same disagreement is reported against
   `unusual` one run and `market` the next. The keys are declared in
   the order a reader meets them, boards first, so first-declared wins
   and the sentence anchors the outlier to the board. Written as a
   scan rather than a sort for exactly that reason: a stable sort
   ascending gives the first minimum and the LAST maximum, which is
   the asymmetry that produced the arbitrary half of the pair. */
function extremes(items, valueOf) {
  let low = items[0];
  let high = items[0];
  for (const item of items) {
    if (valueOf(item) < valueOf(low)) low = item;
    if (valueOf(item) > valueOf(high)) high = item;
  }
  return { low, high };
}

/* SEVERITY IS EARNED, AND THESE ARE THE THREE THINGS IT MEANS.

   BLOCKING — a reading a page is drawing right now is actively wrong,
   not merely old. Two boards that disagree about the size of the pool
   they were cut from make the tilt sentence's denominator belong to a
   different run than its numerators; a partition whose parts outnumber
   the whole makes every share printed from it arithmetically impossible.
   A reader who acts on those has acted on a number nothing measured.

   CAUTION — the reading is defensible but a reasonable reader will draw
   the wrong conclusion from it. A list at the vendor's ceiling is a real
   count of what we received and a false count of what exists; a board
   that halved is a real count of what cleared and reads as a quiet
   market. Nothing here is wrong, and the natural inference is.

   NOTE — worth knowing before comparing two surfaces, with no wrong
   inference forced. The intraday tape covering the day AFTER the session
   the boards rank is the ordinary state of the product between the close
   and the next publish; it is still the reason a flagged-window count
   and a board rank are not counts of the same day.

   The rule that keeps this honest: if the warning would still be true
   on a perfectly healthy morning, it is not blocking. */
const RANK = { blocking: 0, caution: 1, note: 2 };

const warn = (severity, id, say, n, sources) =>
  ({ id, severity, say, n: n || {}, sources: sources || [] });

/* THE THRESHOLDS, EXPORTED BECAUSE A TEST SHOULD BE ABLE TO PIN THEM.
   A number chosen in one file and asserted in another as a literal is a
   number that can be changed in one place; the suite reads these. */
export const THRESHOLDS = Object.freeze({
  /* SIX HOURS IS LONGER THAN A RUN AND SHORTER THAN THE GAP BETWEEN TWO.
     Every key in a pipeline run shares one `generatedAt` constant, so
     legs that publish minutes apart still stamp the same instant; a real
     spread between two keys means one of them was written by a DIFFERENT
     run and the other kept its old copy. The crons fire twice a day for
     the two US timezones and have been observed running hours late, so a
     threshold under a few hours would fire on the ordinary second run;
     six is past that and still well inside one session. */
  driftCautionHours: 6,
  /* AND TWENTY-FOUR IS A WHOLE SESSION. Past a day apart the older
     surface is describing a session that has since closed, so a page
     showing the two together is not showing a slow key — it is showing
     two markets under one date. */
  driftBlockingHours: 24,
  /* MORE THAN HALF THE NAMES GONE. Each side of the board is capped, so
     on any ordinary session both sides publish at or near their cap and
     the count is flat from one day to the next. A fall this large is the
     dead band or the earnings gate cutting deeper, which is a fact about
     our own thresholds and not about the market — and "the board is
     short today" is exactly the sentence a reader writes instead. */
  shrinkFraction: 0.5,
});

/* ---------- STAMPS ------------------------------------------------ */

/**
 * A PAYLOAD THAT CANNOT SAY HOW OLD IT IS, which is worse than one that
 * says it is old.
 *
 * Staleness is a measurement and it can be printed, argued with and
 * acted on. An absent or unparseable `generatedAt` removes the
 * measurement itself: no page can compute the age, no check below can
 * compare it, and the surface then sits beside stamped ones looking
 * exactly as current as they are. The failure is silent by
 * construction, which is why it is worth a sentence of its own.
 *
 * NOT RUN AGAINST A STORE WITH NO STAMPS AT ALL. If nothing in the
 * store carries a readable stamp then the store is not a set of
 * payloads with one bad member — it is a caller handing us something
 * else — and blaming one surface for a store-wide silence would be
 * inventing a contradiction out of missing data.
 */
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

/**
 * TWO SURFACES A READER SEES SIDE BY SIDE, WRITTEN BY DIFFERENT RUNS.
 *
 * One run stamps every key it publishes with one `generatedAt`, so a
 * spread across the store is not slowness — it is a leg that failed and
 * left the previous run's copy standing. The stored copy is not corrupt
 * and its own numbers are fine; what is wrong is the page that draws it
 * beside today's board under today's date.
 *
 * ONLY `generatedAt` IS COMPARED. The intraday keys also carry `readAt`,
 * which answers a different question — when we last looked, not when
 * this payload was written — and subtracting one from the other would
 * produce an interval measuring nothing.
 */
function checkStampDrift(s) {
  const stamps = [];
  for (const slot of Object.keys(KEY)) {
    const p = answered(s[slot]);
    if (!p) continue;
    const ms = instantMs(p.generatedAt);
    /* An unreadable stamp is checkSilentStamp's finding, not a gap of
       unknown size to be reported here as though it were measured. */
    if (ms === null) continue;
    stamps.push({ slot, at: String(p.generatedAt).trim(), ms });
  }
  if (stamps.length < 2) return null;
  const { low: oldest, high: newest } = extremes(stamps, (x) => x.ms);
  const gap = newest.ms - oldest.ms;
  if (gap < THRESHOLDS.driftCautionHours * HOUR) return [];
  const hours = Math.round(gap / HOUR);
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

/**
 * TWO SURFACES THAT NAME DIFFERENT SESSIONS.
 *
 * This is not the drift check restated. `generatedAt` is when a payload
 * was WRITTEN and `sessionDate` is what it is ABOUT, and a payload can
 * have one without the other: a key whose stamp is unreadable is
 * invisible to the drift check and still names its session here, and a
 * re-run minutes after midnight rewrites one key's session while a
 * failed leg keeps yesterday's with almost no gap between the stamps.
 *
 * The consequence is the one the events page exists to prevent in the
 * other direction: every day count on these surfaces is measured from a
 * session, so two surfaces naming two sessions put the same name at two
 * distances from the same earnings date.
 */
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
  /* ISO dates sort as strings, which is the whole reason this module
     compares the published `sessionDate` rather than parsing it. */
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

/**
 * THE DAY BOUNDARY: the tape and the board are not the same day.
 *
 * `flowalerts` is the one key that fills DURING a session — the Worker's
 * cron merges each read into a record that names its own Eastern day —
 * while the boards rank the last COMPLETED session. Between the open and
 * the next publish those are two different dates by design, and the page
 * shows them one above the other with nothing saying so. A reader who
 * takes "18 flagged windows" as belonging to the ranked session has
 * taken a count from Tuesday and attached it to Monday.
 *
 * THE TWO DIRECTIONS ARE NOT THE SAME FACT. A record dated AFTER the
 * ranked session is the ordinary intraday state and a note; a record
 * dated BEFORE it means the accumulation never reset at the boundary and
 * the tape on screen belongs to a session that has already closed, which
 * is a caution because nothing on the page distinguishes it from a live
 * one.
 */
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

/* ---------- POPULATIONS ------------------------------------------- */

/**
 * A BOARD THAT HALVED, WHICH IS OUR THRESHOLD MOVING AND NOT THE MARKET.
 *
 * Each board row carries the session's memory and each board payload
 * carries `memory.named`: how many rows the PRIOR board held. So the
 * comparison a reader makes by eye — "there are fewer names today" — is
 * one the payload can make exactly, and it can say the thing the reader
 * cannot see, which is that a shorter list is produced by the dead band
 * and the earnings gate cutting deeper just as readily as by a quiet
 * tape. The two are indistinguishable on screen and lead to opposite
 * conclusions.
 *
 * ROW COUNTS ON BOTH SIDES OF THE COMPARISON. `named` is what the prior
 * board HELD, so it is compared against `rows.length` and never against
 * `cleared`: `cleared` is the side's whole pool and the two differ by
 * whatever the board cap shed. A fall computed across those two would be
 * the population/page confusion the rail badge shipped with, dressed up
 * as a warning about it.
 *
 * A PRIOR OF ZERO IS A READING AND STOPS THE CHECK WITHOUT A WARNING.
 * The publisher writes `named: null` — never 0 — when no prior board
 * could be read, so a 0 here means a board that was read and held
 * nothing. Nothing can fall from nothing, and dividing by it would
 * manufacture an infinite one.
 */
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
    /* THE MEMORY MUST BE A PREVIOUS SESSION, AND IT IS NOT ALWAYS ONE.
       A board re-run on the same day reads back its OWN earlier write
       and stamps the memory `same-session`, saying so in as many words:
       "it is this run's own output". Counting against that compares the
       run to itself, and the difference it reports is an artefact of
       having run twice — the exact confusion the pipeline's memory
       guard exists to prevent, reintroduced one layer up. Any status
       other than a clean read of an earlier board stops this check
       rather than clearing it. */
    if (!memory || memory.status !== "ok") continue;
    const named = num(memory.named);
    if (named === null) continue;
    /* ROWS AGAINST ROWS, AND THE SYMMETRY IS THE POINT. `named` is
       documented at flows-pipeline.mjs as "how many rows the prior
       board named" — a page, not a pool. So `rows.length` is its
       correct comparand and `cleared` is NOT: quoting today's pool
       against yesterday's page would invent a rise on any morning the
       cap binds, which is the population/page confusion running in the
       opposite direction. Both numbers are pages and the sentence says
       so. */
    prior += named;
    held += r.length;
    sides.push(word);
    sources.push(KEY[slot]);
    priorSessions.push(ymd(memory.sessionDate));
  }
  if (!sides.length) return null;
  /* THE PRIOR BOARD IS NAMED ONLY WHEN EVERY SIDE COUNTED NAMES THE SAME
     ONE. `prior` is a sum across the sides, so a date taken from the first
     side that stated one would be printed as the date the whole sum came
     from — and the store in which the two sides disagree is exactly the
     store this module exists for: a leg that failed and left an older
     copy standing carries an older memory with it. Naming one of two
     sessions there tells a reader that eighty names were on the board of a
     day when twenty of them were on the board of a week earlier. When the
     sides disagree, or when any of them could not state a session at all,
     the sentence falls back to "the previous board" — which is vaguer and
     true, and the branch that prints it already exists below. */
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
    "%, which is the dead band or the earnings gate removing names rather than the market " +
    "going quiet.",
    n, sources)];
}

/* ---------- CEILINGS ---------------------------------------------- */

/**
 * A COUNT THAT IS THE VENDOR'S CEILING AND READS AS A POPULATION.
 *
 * `vendorTruncated` is the publisher's own claim that the response
 * length equalled the limit we asked for, which makes the true
 * population unknown and at least that large. The page beneath it prints
 * a number of windows; nothing in that number says it is a floor, and
 * the comparison a reader makes across sessions is then between two
 * ceilings rather than between two markets.
 *
 * THE FLAG IS A BOOLEAN AND IS TESTED AS ONE. `num` is for readings;
 * an absent flag is not `false`, so a payload that carries no claim
 * either way stops this check rather than clearing it.
 */
function checkAlertCeiling(s) {
  const al = answered(s.alerts);
  if (!al) return null;
  const limit = num(al.vendorLimit);
  const rows = rowsOf(s.alerts);
  if (limit === null || rows === null || typeof al.vendorTruncated !== "boolean") return null;
  if (al.vendorTruncated !== true) return [];
  const carried = rows.length;
  return [warn("caution", "ceiling:alerts",
    "flowalerts hit the vendor's " + limit + "-row ceiling on the read that built it, so " +
    "the " + carried + " " + plural(carried, "window", "windows") + " it carries " +
    plural(carried, "is", "are") + " a floor rather than a count and today's total cannot " +
    "be compared with another session's as a measurement.",
    { limit, carried },
    [KEY.alerts])];
}

/**
 * THE SAME CEILING ON THE NEWS TAPE, where the publisher hands us both
 * halves of the comparison: `requested` is what we asked for and
 * `returned` is what came back on the wire.
 *
 * BOTH THE FLAG AND THE ARITHMETIC MUST AGREE. `atVendorLimit` is
 * computed at publish time against the limit the fetch actually sent,
 * and this check re-reads the two counts rather than trusting the flag
 * alone — a flag that is true beside a return well under the request is
 * a defect in whoever set it, and repeating it as a warning would put
 * this module's name on someone else's mistake.
 */
function checkNewsCeiling(s) {
  const nw = answered(s.news);
  if (!nw) return null;
  const requested = num(nw.requested);
  const returned = num(nw.returned);
  if (requested === null || returned === null || typeof nw.atVendorLimit !== "boolean") return null;
  if (nw.atVendorLimit !== true || returned < requested) return [];
  return [warn("caution", "ceiling:news",
    "news returned " + returned + " " + plural(returned, "headline", "headlines") +
    " against the " + requested + " it requested, so the response ended at the vendor's own " +
    "ceiling and the population above it is unknown and at least that large.",
    { returned, requested },
    [KEY.news])];
}

/**
 * AND THE PER-NAME VERSION OF IT ON THE OPTION CHAINS.
 *
 * `namesTruncated` counts the chains that came back cut off, so the
 * contract-level counts derived from those names are floors while the
 * counts from the rest are totals — one payload holding two kinds of
 * number under one heading. A measured 0 here is the healthy answer and
 * is not a warning; a null is no coverage claim at all and stops the
 * check, which is why the publisher writes `complete: null` rather than
 * `false` when no chain contributed.
 */
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

/**
 * A CEILING THAT TRAVELLED TO A SECOND SURFACE WITHOUT ITS CAVEAT.
 *
 * The movers' per-contract premium band is cut from the shaped flow
 * alerts — the pipeline republishes `movers` with it after the alerts
 * leg — so when that read hit the vendor's ceiling the band inherited
 * the ceiling and inherited nothing that says so. `flowalerts` at least
 * publishes `vendorLimit` and `vendorTruncated` beside its rows; the
 * movers band publishes a ranking with no trace of where it came from,
 * and "the largest contract windows of the session" is a claim only the
 * alerts payload can qualify. This is the check that needs two payloads
 * open at once and cannot be written in either renderer.
 */
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
  const windows = bandRows.length;
  return [warn("caution", "ceiling:inherited",
    "The movers per-contract premium band is cut from a flowalerts read that hit the " +
    "vendor's " + limit + "-row ceiling, so the " + windows + " contract " +
    plural(windows, "window", "windows") + " it ranks " + plural(windows, "is", "are") +
    " a floor rather than the session's largest.",
    { limit, windows },
    [KEY.movers, KEY.alerts])];
}

/* ---------- CONTRADICTIONS ---------------------------------------- */

/* THE TOLERANCE ON EVERY CHECK BELOW IS ZERO, AND IT IS NOT A CHOICE.

   `scored`, `neutral`, `deadBand`, `cleared` and the gate pair are not
   independent measurements of one quantity that a sampling difference
   could separate. They are the SAME integers, computed once per run by
   partitionSides and the gate and then copied onto each payload as it is
   published. There is no width within which two copies of one integer
   may legitimately differ, so any difference at all is a stale key or a
   second writer — and a tolerance here would be a band inside which this
   module agrees not to notice. */

/** Pick the readable values of one field across the three board keys. */
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

/**
 * THE THREE BOARDS DISAGREEING ABOUT THE SIZE OF THE POOL.
 *
 * `board:long`, `board:short` and `board:watch` are three slices of ONE
 * scoring pass and each publishes that pass's `scored`. Blocking rather
 * than caution because the briefing prints the tilt as a share of the
 * pool — "44 lean bullish and 53 lean bearish out of 100 scored" — and
 * takes the denominator from whichever board answered first. When the
 * three disagree, that sentence divides a count from this run by a count
 * from another one, and it reads as arithmetic.
 */
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

/**
 * THE THREE BOARDS DISAGREEING ABOUT WHERE THE DEAD BAND IS.
 *
 * The band is what decides which surface a name appears on: at or above
 * it a name is on a board, inside it a name is on the watch list, and
 * the product's stated rule is that the band decides. Two surfaces
 * partitioning on two bands make that rule false in the one way a reader
 * cannot see — the same score is a board name on one page and a
 * near-miss on another, and both pages are internally consistent.
 */
function checkDeadBand(s) {
  const seen = boardField(s, "deadBand");
  if (seen.length < 2) return null;
  const { low: narrow, high: wide } = extremes(seen, (x) => x.v);
  if (narrow.v === wide.v) return [];
  return [warn("blocking", "band:disagree",
    KEY[wide.slot] + " partitions on a dead band of " + wide.v + " and " + KEY[narrow.slot] +
    " on " + narrow.v + ", so the same score puts a name on a board by one surface and " +
    "inside the band by the other.",
    { wider: wide.v, narrower: narrow.v, widerKey: KEY[wide.slot], narrowerKey: KEY[narrow.slot] },
    [KEY[wide.slot], KEY[narrow.slot]])];
}

/**
 * THE PARTITION THAT DOES NOT ADD UP.
 *
 * partitionSides cuts the scored pool into three disjoint pieces — at or
 * above the band, at or below its negative, and inside it — so
 * `cleared` on the bullish board plus `cleared` on the bearish board
 * plus `neutral` IS the scored count, by construction and exactly. The
 * identity spans two payloads, which is the only reason it can break:
 * one board from a run the other did not see.
 *
 * BOTH DIRECTIONS ARE BLOCKING AND THEY ARE DIFFERENT SENTENCES. More
 * accounted for than were scored is arithmetically impossible and makes
 * every share printed from the pair wrong. Fewer means names cleared the
 * threshold this product says is the threshold and reach no surface a
 * reader can open — the defect `cleared` and `shed` were added to make
 * visible, showing up here across the pair instead of within one side.
 *
 * `??` AND NOT `||` ON THE NEUTRAL COUNT. A measured 0 inside the band
 * is a real reading of an unusually wide session, and `||` would fall
 * through it to the other board's copy — reading a number from the wrong
 * payload precisely when the first one had something to say.
 */
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

/**
 * THE BOARD'S EARNINGS GATE AND THE CALENDAR'S, DISAGREEING.
 *
 * The gate is the reason a fully scored name is absent from the board,
 * and /flows/events/ is the page a reader opens to see who it removed.
 * Those two only line up because the pipeline hands both legs the same
 * `gateOrigin` and the same `EARNINGS_GATE_DAYS`; when a stale key
 * breaks that, the calendar marks names as gated that the board kept and
 * the board holds names the calendar says are inside the window. Both
 * pages remain internally consistent and the reader is left to decide
 * which one is lying.
 *
 * THE ORIGIN IS ITS OWN WARNING BECAUSE IT IS ITS OWN FAULT. A window of
 * a different width and a window counted from a different day produce
 * the same symptom and need different repairs, and the pipeline's own
 * comment on publishing both clocks beside each other says why: both
 * numbers look like day counts, so a page that mixes them disagrees
 * silently.
 */
function checkGate(s) {
  const ev = answered(s.events);
  if (!ev) return null;
  const out = [];
  let ran = false;

  /* THE TWO CLOCKS ARE RESOLVED SEPARATELY, because a board can publish
     one of them and not the other and each half of the gate is its own
     comparison against the calendar. */
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

/* ---------- THE PASS ---------------------------------------------- */

/* Order is the order a reader meets them in when nothing is wrong with
   the store: the stamps, then the populations, then the arithmetic. The
   OUTPUT is sorted by severity, so this list is only the tiebreak. */
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

/**
 * Read the store and report what disagrees with what.
 *
 * A check returns null when its inputs are not there and an array —
 * usually empty — when it ran. That distinction is the whole discipline
 * of this module restated in its plumbing: "we asked and nothing is
 * wrong" and "we could not ask" are different facts, and collapsing them
 * would let an empty store report a clean bill of health. `checked` is
 * the count of questions the store could answer, so a caller printing
 * "no warnings" beside a `checked` of 0 can see that it has printed
 * nothing at all.
 *
 * Sorted by severity, and stable within it: a blocking contradiction is
 * the first thing a reader should meet, and two warnings of one severity
 * keep the order the checks are declared in so the same store always
 * renders the same page.
 */
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
  return { warnings, checked };
}
