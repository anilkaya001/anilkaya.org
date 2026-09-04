/* =============================================================
   flows-ask.js — the retrieval and safety core of a textbot over
   payloads that were already published.

   PURE, AND FOR THE SAME REASON flows-brief.js IS. No DOM, no
   fetch, no model, no clock. It takes the parsed payloads a reader
   already has and returns facts, a selection over them, a guard, a
   deterministic answer and a prompt. Every one of those is a value
   computed from its arguments, so the whole safety argument below
   can be tested without a network and without a token.

   THE MODEL IS NEVER ALLOWED TO PRODUCE A NUMBER. That is the whole
   design, and it is structural rather than a line in a prompt:

     - every fact carries its numbers inside its own sentence, and
       `n` names each of them so a reader can check the sentence was
       built from measured fields rather than composed;
     - the model is handed those sentences and asked to rephrase;
     - the answer is then scanned, and every numeral in it must
       already appear in the sentences it was handed. A numeral that
       does not is arithmetic or invention, and the answer is refused
       in favour of renderFactsPlain, which is built from the same
       facts and says the same things in a fixed order.

   THE READER IS NEVER WORSE OFF WHEN THE GUARD FIRES, because the
   numbers were always deterministic and only the prose was ever the
   model's. That is why the fallback is written as a real answer and
   not as an error: an apology would be a worse answer than the one
   the guard just refused, for a defect the reader did not cause.

   THE ALLOWED SET IS THE PROSE, NOT `n`. A first draft compared the
   answer against the VALUES in `n`, which would have rejected a
   faithful restatement: a fact may say "1.2M" beside n.premiumUsd
   1200000, and those are the same reading in two representations. So
   the allowed set is numeralsIn(fact.say) — the model is asked to
   restate, and every numeral it writes must already be in the text
   it was given. That is exactly checkable, needs no reconciliation
   between two representations, and is strictly stronger: it also
   catches a model that rewrites 1200000 as 1.2M, which is arithmetic
   performed on a measurement.

   THE THREE SILENCES SURVIVE INTO THE ANSWER. pending, unreadable
   and quiet are three different facts about the world and this
   module keeps them in three different lists. A bot that answered
   "no unusual activity" when the truth was "the pipeline has not
   published yet" would be inventing a quiet market out of an
   unfinished job, which is the same class of defect as inventing a
   number and is harder to notice.

   WHAT THIS FILE DOES NOT DO. It does not read the briefing's own
   surfaces twice: shared/flows-brief.js already turns the two
   boards, the watch list, the events key, the alert feed and the
   sector premium lean into facts, and buildFactIndex imports it
   rather than restating that logic. What this file adds is every
   other published surface, the selection, and the guard.
   ============================================================= */

import { buildBrief, briefStoreFrom, silenceOf, num } from "./flows-brief.js";

/* THE SLOT RENAME IS IMPORTED, NOT RESTATED. flows-brief reads six
   slots — long, short, watch, events, alerts, sectorPremium — while
   the pipeline publishes board:long, board:short, board:watch,
   events, flowalerts and sector:premium. This module used to carry
   its own copy of that mapping and the pipeline carried another.
   Two spellings of one rename would be ordinary duplication in most
   code; here its failure mode is not an exception but a SILENCE, and
   a briefing reporting six absent surfaces is indistinguishable from
   a quiet market. The drift would have read as the product working. */

/* A KEY THE READER DOES NOT HAVE IS `pending`, NOT MISSING, and the
   difference is which sentence a reader gets. silenceOf() calls an
   absent object "unreadable", whose text says the fault is on this
   page — that would be a lie about a key that was simply never
   written. The Worker already answers an unwritten key with
   {status:"pending"}, and the pipeline's own briefing call maps
   absent to the same shape, so this reads identically to both. */
function served(store, key) {
  const v = store && typeof store === "object" ? store[key] : undefined;
  return v === null || v === undefined ? { status: "pending" } : v;
}

const answered = (p) => (p && typeof p === "object" && p.status !== "pending" ? p : null);

const atOf = (p) => (p && typeof p === "object" && typeof p.generatedAt === "string" &&
  p.generatedAt.trim() !== "" ? p.generatedAt : null);

/* THE PUBLISHER'S OWN WORD FOR WHAT IT FOUND, mapped onto the three
   silences this product names. shapeNews and sectorLean publish
   "quiet" and "unreadable" already; the pulse and political feeds
   publish "unavailable" for a fetch that never landed; the dated
   score archive publishes "empty". Reading these rather than
   re-deriving them is what keeps this index's account of a surface
   identical to the account that surface's own page gives. */
const PUBLISHED_QUIET = new Set(["quiet", "empty"]);
const PUBLISHED_UNREADABLE = new Set(["unreadable", "unavailable"]);

/* ---------- numerals -------------------------------------------- */

/* A FRESH REGEX PER CALL. A module-scope /g regex carries lastIndex,
   which is shared mutable state in a file whose entire claim is that
   it has none — and the failure mode is a scan that silently starts
   in the middle of the text it was asked to read. */
const NUMERAL_SOURCE = "-?\\d[\\d,]*(?:\\.\\d+)?";

/**
 * Every numeral in a piece of text, exactly as it is written.
 *
 * THE CURRENCY MARK AND THE MAGNITUDE LETTER ARE UNITS, NOT PART OF
 * THE NUMBER. "$1.2M" yields "1.2" and "-3.4%" yields "-3.4",
 * because units travel with numbers in the field name and in the
 * prose rather than inside the token. The consequence is the one
 * this guard wants: a model that turns a published 1200000 into
 * "1.2M" has written the numeral 1.2, which appears in no fact it
 * was given, and the answer is refused as the arithmetic it is.
 *
 * Group separators stay in the token — "1,234" and "1234" are two
 * different strings and only one of them can have been quoted.
 */
export function numeralsIn(text) {
  if (typeof text !== "string" || text === "") return [];
  return text.match(new RegExp(NUMERAL_SOURCE, "g")) || [];
}

/* THE SCAN THE BRIEFING'S OWN SUITE ALREADY RUNS, kept identical on
   purpose. tests/flows-brief.mjs refuses any next-session sentence
   carrying one of these verbs, and a model rephrasing those same
   sentences has to clear the same bar — otherwise the guarantee
   would hold for the module and evaporate at the surface a reader
   actually reads. */
const FORECAST = /\b(will|should|expect(?:ed)?|likely|going to|forecast|predict)\b/i;

/* ---------- facts ------------------------------------------------ */

/* WHAT A QUESTION IS MATCHED AGAINST. Keywords are lowercase, so a
   ticker typed as SYN046 and a sector typed as Technology both land
   in the same space as the words around them. Values that look like
   dates or timestamps are left out: they carry digits rather than
   meaning, and a reader asking about "2026" wants a session, not
   every fact stamped in that year. */
const NAME_LIKE = /^[A-Za-z][A-Za-z0-9.]{0,9}$/;

function addNames(set, v) {
  if (typeof v === "string") {
    if (NAME_LIKE.test(v)) set.add(v.toLowerCase());
    return;
  }
  if (Array.isArray(v)) for (const x of v) addNames(set, x);
}

function keywords(topic, source, n) {
  const set = new Set();
  for (const w of topic || []) set.add(String(w).toLowerCase());
  for (const part of String(source).split(/[:/\-_]/)) if (part) set.add(part.toLowerCase());
  for (const v of Object.values(n || {})) addNames(set, v);
  return [...set];
}

/* THE SHAPE OF A FACT, and it extends the briefing's rather than
   competing with it. `id`, `say` and `n` are flows-brief's, so the
   two sets compose into one list a model can be handed; `topic`,
   `source` and `at` are what a retrieval layer needs and a renderer
   does not. `n` stays an OBJECT keyed by what each number is, with
   the unit in the key — a ratio and a dollar sum never share a name. */
function maker(source, at) {
  return (id, topic, say, n) => ({
    id, topic: keywords(topic, source, n), say, n: n || {}, source, at: at || null,
  });
}

/* A FACT IS EMITTED ONLY WHEN EVERY READING ITS SENTENCE QUOTES IS
   PRESENT. A sentence with a hole in it is worse than no sentence,
   and printing 0 for the hole is the defect this whole codebase is
   organised against. The cost is that a renamed field drops a fact,
   which is why a surface that answered and produced NO fact at all
   is reported as unreadable below rather than passing in silence —
   the briefing lost its entire sector section that way once. */
const all = (...v) => v.every((x) => x !== null);

/* ---------- the surfaces the briefing does not read -------------- */

function marketFacts(p, at) {
  const f = maker("market", at);
  const out = [];
  const b = p.breadth && typeof p.breadth === "object" ? p.breadth : {};
  const prem = p.premium && typeof p.premium === "object" ? p.premium : {};
  const pcr = p.pcr && typeof p.pcr === "object" ? p.pcr : {};
  const vol = p.vol && typeof p.vol === "object" ? p.vol : {};
  const agg = p.aggressor && typeof p.aggressor === "object" ? p.aggressor : {};

  const read = num(p.n), bull = num(b.bull), bear = num(b.bear);
  const flat = num(b.flat), unpriced = num(b.unpriced);
  if (all(read, bull, bear, flat, unpriced)) {
    out.push(f("market/breadth", ["breadth", "bullish", "bearish", "tape", "lean", "names"],
      "Across the " + read + " names this run read, " + bull +
      " leaned bullish on net option premium, " + bear + " leaned bearish, " + flat +
      " were exactly balanced and " + unpriced + " could not be priced at all.",
      { namesRead: read, bullishNames: bull, bearishNames: bear,
        flatNames: flat, unpricedNames: unpriced }));
  }

  const net = num(prem.net), priced = num(prem.priced), one = num(prem.oneLegged);
  if (all(net, priced, one)) {
    out.push(f("market/premium", ["premium", "dollars", "net", "flow", "money"],
      "Net option premium over the " + priced + " names that quoted both legs summed to " +
      net + " US dollars, and " + one + " names quoted one leg only and are counted beside " +
      "that total rather than inside it.",
      { netPremiumUsd: net, pricedNames: priced, oneLeggedNames: one }));
  }

  /* THE DOLLAR SUM IS WRITTEN AS IT WAS PUBLISHED and never
     abbreviated. Turning 12345678 into "12.3 million" is arithmetic
     on a measurement, and the rounding that matters is the one that
     would turn a small nonzero into a confident zero. */
  const share = num(prem.topShare);
  if (all(share, priced)) {
    out.push(f("market/concentration", ["concentration", "share", "largest", "premium"],
      "The five largest absolute net-premium movements account for " + share +
      " of gross premium, as a ratio, over " + priced + " priced names.",
      { topShareRatio: share, pricedNames: priced }));
  }

  const pv = num(pcr.volume), pvn = num(pcr.quotedVolume);
  const pp = num(pcr.premium), ppn = num(pcr.quotedPremium);
  if (all(pv, pvn, pp, ppn)) {
    out.push(f("market/pcr", ["pcr", "put", "call", "ratio", "puts", "calls"],
      "The put/call ratio is " + pv + " on volume over " + pvn + " names and " + pp +
      " on premium over " + ppn + " names; both are ratios and neither is a count.",
      { pcrVolumeRatio: pv, quotedVolumeNames: pvn,
        pcrPremiumRatio: pp, quotedPremiumNames: ppn }));
  }

  /* THE IV RANK IS A FRACTION AND THE SENTENCE SAYS SO. The vendor's
     own schema misdeclares this column on 0..100, and this
     repository has published "1352% of its year" once already. */
  const iv = num(vol.iv30dMedian), ivn = num(vol.iv30dQuoted);
  const rank = num(vol.ivRankMedian), rankn = num(vol.ivRankQuoted);
  if (all(iv, ivn, rank, rankn)) {
    out.push(f("market/vol", ["volatility", "iv", "implied", "rank", "vol"],
      "Median thirty-day implied volatility is " + iv + " over " + ivn +
      " names, and the median IV rank is " + rank + " on a zero-to-one scale over " +
      rankn + " names, never a percentage of a year.",
      { iv30dMedianRatio: iv, iv30dQuotedNames: ivn,
        ivRankMedianRatio: rank, ivRankQuotedNames: rankn }));
  }

  const cl = num(agg.callLift), pl = num(agg.putLift), qn = num(agg.quoted);
  if (all(cl, pl, qn)) {
    out.push(f("market/aggressor", ["aggressor", "lift", "offer", "bid", "ask"],
      "Over the " + qn + " names that quoted both sides, the call lift is " + cl +
      " and the put lift is " + pl + ", each the share of volume that traded at the " +
      "offer as a ratio.",
      { callLiftRatio: cl, putLiftRatio: pl, quotedNames: qn }));
  }
  return out;
}

function moversFacts(p, at) {
  const f = maker("movers", at);
  const out = [];
  const risers = Array.isArray(p.risers) ? p.risers : [];
  const fallers = Array.isArray(p.fallers) ? p.fallers : [];
  const prem = p.premium && typeof p.premium === "object" ? p.premium : {};
  const ranked = num(p.ranked), priced = num(p.priced);

  const up = risers[0] || null, down = fallers[0] || null;
  const upChange = up ? num(up.chg) : null, downChange = down ? num(down.chg) : null;
  if (up && down && up.t && down.t && all(upChange, downChange, ranked)) {
    /* A FRACTION OF THE PRIOR CLOSE, said in the sentence rather than
       converted. 0.0412 is four per cent and turning it into one here
       would be this module doing arithmetic on a published field. */
    out.push(f("movers/extremes", ["movers", "risers", "fallers", "move", "change", "gainers"],
      String(up.t) + " led the day's risers at a change ratio of " + upChange +
      " against its prior close and " + String(down.t) + " led the fallers at " +
      downChange + ", over " + ranked + " names that carried a prior close to rank against.",
      { riser: String(up.t), riserChangeRatio: upChange,
        faller: String(down.t), fallerChangeRatio: downChange, rankedNames: ranked }));
  }

  const universe = num(p.universe), cap = num(p.cap);
  const noClose = num(p.unrankedChange), noPremium = num(p.unrankedPremium);
  if (all(universe, cap, ranked, noClose, noPremium)) {
    out.push(f("movers/coverage", ["movers", "universe", "cap", "coverage", "population"],
      "The mover lists are cut from a universe of " + universe + " names and capped at " +
      cap + " rows a side; " + ranked + " names carried a prior close, " + noClose +
      " did not, and " + noPremium + " quoted no premium at all.",
      { universeNames: universe, rowCap: cap, rankedNames: ranked,
        unrankedChangeNames: noClose, unrankedPremiumNames: noPremium }));
  }

  const bulls = Array.isArray(prem.bullish) ? prem.bullish : [];
  const bears = Array.isArray(prem.bearish) ? prem.bearish : [];
  const topBull = bulls[0] || null, topBear = bears[0] || null;
  const bullUsd = topBull ? num(topBull.netPrem) : null;
  const bearUsd = topBear ? num(topBear.netPrem) : null;
  if (topBull && topBear && topBull.t && topBear.t && all(bullUsd, bearUsd, priced)) {
    out.push(f("movers/premium", ["premium", "dollars", "largest", "name", "money"],
      String(topBull.t) + " carried the largest positive net option premium at " + bullUsd +
      " US dollars and " + String(topBear.t) + " the most negative at " + bearUsd +
      " US dollars, over " + priced + " names that quoted both legs.",
      { bullishName: String(topBull.t), bullishNetPremiumUsd: bullUsd,
        bearishName: String(topBear.t), bearishNetPremiumUsd: bearUsd,
        pricedNames: priced }));
  }
  return out;
}

function unusualFacts(p, at) {
  const f = maker("unusual", at);
  const out = [];
  const c = p.contracts && typeof p.contracts === "object" ? p.contracts : {};
  const nm = p.names && typeof p.names === "object" ? p.names : {};

  const shown = num(c.shown), eligible = num(c.eligible);
  const cap = num(c.cap), perName = num(c.perName);
  const bound = typeof c.capBound === "string" && c.capBound ? c.capBound : null;
  if (all(shown, eligible, cap, perName) && bound !== null) {
    /* WHICH CEILING BOUND, because a capped list that does not say so
       reads as a population. "shown of eligible" answers what we cut;
       capBound answers which cut did it. */
    out.push(f("unusual/contracts", ["unusual", "contracts", "activity", "feed", "cap"],
      "The unusual-contract feed shows " + shown + " of " + eligible +
      " eligible contracts, capped at " + cap + " rows with at most " + perName +
      " per name, and the cap that bound was " + bound + ".",
      { shownContracts: shown, eligibleContracts: eligible, rowCap: cap,
        perNameCap: perName, capBound: bound }));
  }

  const nShown = num(nm.shown), nRanked = num(nm.ranked);
  const nUniverse = num(nm.universe), nUnranked = num(nm.unranked);
  if (all(nShown, nRanked, nUniverse, nUnranked)) {
    out.push(f("unusual/names", ["unusual", "names", "surprise", "volume", "ranked"],
      nShown + " of " + nRanked + " names ranked on volume surprise are shown, from a " +
      "universe of " + nUniverse + "; " + nUnranked + " carried no measured surprise and " +
      "sit outside the ordering rather than at the bottom of it.",
      { shownNames: nShown, rankedNames: nRanked,
        universeNames: nUniverse, unrankedNames: nUnranked }));
  }

  const seen = num(p.namesSeen), truncated = num(p.namesTruncated);
  if (all(seen, truncated)) {
    out.push(f("unusual/reach", ["unusual", "chains", "truncated", "ceiling", "coverage"],
      "Chains were read for " + seen + " names and " + truncated +
      " of them came back at the vendor's row ceiling, so those contract counts are " +
      "lower bounds rather than totals.",
      { namesRead: seen, namesTruncated: truncated }));
  }
  return out;
}

function newsFacts(p, at) {
  const f = maker("news", at);
  const out = [];
  const kept = num(p.kept), returned = num(p.returned);
  const requested = num(p.requested), cap = num(p.cap);
  if (all(kept, returned, requested, cap)) {
    out.push(f("news/coverage", ["news", "headlines", "tape", "coverage"],
      "The news tape holds " + kept + " headlines of the " + returned +
      " rows the vendor returned against a request for " + requested +
      ", under a cap of " + cap + " rows.",
      { keptHeadlines: kept, returnedRows: returned,
        requestedRows: requested, rowCap: cap }));
  }

  /* THE VENDOR'S CEILING IS A DIFFERENT FACT FROM OUR CAP. Ours
     leaves the population known and states what it dropped; theirs
     leaves the population UNKNOWN and at least as large as what
     arrived, and a reader comparing two days of counts is then
     comparing two ceilings rather than two markets. */
  if (p.atVendorLimit === true && all(returned, requested)) {
    out.push(f("news/ceiling", ["news", "ceiling", "limit", "truncated", "population"],
      "That response came back at the vendor's own limit of " + requested +
      " rows, so the population above it is unknown and at least " + returned + ".",
      { requestedRows: requested, returnedRows: returned }));
  }

  const newest = typeof p.newest === "string" && p.newest ? p.newest : null;
  const oldest = typeof p.oldest === "string" && p.oldest ? p.oldest : null;
  if (newest !== null && oldest !== null) {
    out.push(f("news/window", ["news", "window", "age", "span", "stamps"],
      "The stored headlines span " + oldest + " to " + newest +
      " by the vendor's own stamps.",
      { oldest, newest }));
  }
  return out;
}

function alertFacts(p, at) {
  const f = maker("flowalerts", at);
  const out = [];
  const rows = Array.isArray(p.rows) ? p.rows.length : null;
  const seen = num(p.seen), shed = num(p.shed), cap = num(p.cap);
  if (all(rows, seen, shed, cap)) {
    out.push(f("flowalerts/coverage", ["alerts", "flow", "tape", "coverage", "cap"],
      "The flow-alert page holds " + rows + " of the " + seen + " alerts read, with " +
      shed + " removed by a cap of " + cap + " rows.",
      { keptAlerts: rows, seenAlerts: seen, shedAlerts: shed, rowCap: cap }));
  }

  /* THE BRIEFING ALREADY SAYS HOW MANY WINDOWS WERE FLAGGED. What it
     cannot say is whether that count is a measurement or a ceiling,
     and those are two different facts about the same number. */
  const limit = num(p.vendorLimit);
  if (p.vendorTruncated === true && limit !== null) {
    out.push(f("flowalerts/ceiling", ["alerts", "ceiling", "limit", "truncated", "population"],
      "The alert read came back at the vendor's maximum of " + limit +
      " rows, so today's count is a ceiling rather than a measurement and the true " +
      "population is unknown and at least that large.",
      { vendorLimitRows: limit }));
  }
  return out;
}

function trixFacts(p, at) {
  const f = maker("sector:trix", at);
  const out = [];
  const measured = num(p.measured);
  const baskets = Array.isArray(p.sectors) ? p.sectors.length : null;
  const span = num(p.span);
  if (all(measured, baskets, span)) {
    /* NOT THE PREMIUM LEAN. sector:trix is TRIX on daily closes and
       contains no option data at all; sector:premium is an options
       reading the briefing states separately. The two may disagree
       for weeks and neither is wrong, so the sentence names its own
       basis rather than leaving a reader to merge them. */
    out.push(f("sector:trix/coverage", ["sector", "sectors", "trix", "momentum", "rotation"],
      "TRIX momentum is measured for " + measured + " of " + baskets +
      " sector baskets over a span of " + span + " sessions, on SPDR Select Sector " +
      "ETFs rather than GICS index levels.",
      { measuredSectors: measured, basketCount: baskets, spanSessions: span }));
  }
  return out;
}

function recordFacts(p, at) {
  const f = maker("record", at);
  const out = [];
  const retained = num(p.retained);
  const first = typeof p.firstSession === "string" && p.firstSession ? p.firstSession : null;
  const last = typeof p.lastSession === "string" && p.lastSession ? p.lastSession : null;
  if (retained !== null && first !== null && last !== null) {
    out.push(f("record/retention", ["record", "history", "sessions", "archive", "retained"],
      "The scored record retains " + retained + " sessions, the earliest " + first +
      " and the latest " + last + ".",
      { retainedSessions: retained, firstSession: first, lastSession: last }));
  }
  return out;
}

function trackFacts(p, at) {
  const f = maker("scoretrack", at);
  const out = [];
  const window = num(p.windowSessions);
  const kept = Array.isArray(p.names) ? p.names.length : null;
  const seen = num(p.namesSeen), shed = num(p.namesShed);
  const by = typeof p.shedBy === "string" && p.shedBy ? p.shedBy : null;
  if (all(window, kept, seen, shed)) {
    /* WHICH CEILING BOUND AGAIN, and here it decides what a reader
       does about it: a name cap is a constant somebody chose and can
       raise, a byte cap is the row shape having outgrown the route. */
    out.push(f("scoretrack/coverage", ["track", "scores", "history", "names", "window"],
      "The score track covers " + window + " sessions and carries " + kept + " of the " +
      seen + " names it saw, " + shed + " shed" +
      (by === null ? "" : " against the " + by + " ceiling") + ".",
      { windowSessions: window, keptNames: kept, seenNames: seen,
        shedNames: shed, shedBy: by }));
  }
  return out;
}

function politicalFacts(p, at, note) {
  const f = maker("political", at);
  const out = [];
  const w = p.window && typeof p.window === "object" ? p.window : {};
  const days = num(w.days), filings = num(p.filings), unusable = num(p.unusable);
  if (all(days, filings, unusable)) {
    out.push(f("political/window", ["political", "congress", "disclosure", "filings", "window"],
      "The disclosure window covers " + days + " days and holds " + filings +
      " readable filings, with " + unusable + " rows this page could not read.",
      { windowDays: days, readableFilings: filings, unusableRows: unusable }));
  }

  const latest = typeof p.latestFiled === "string" && p.latestFiled ? p.latestFiled : null;
  const fresh = num(p.freshFilings);
  if (latest !== null && fresh !== null) {
    out.push(f("political/latest", ["political", "congress", "disclosure", "newest", "filed"],
      "The newest disclosure in that window is dated " + latest + ", and " + fresh +
      " filings carry that date.",
      { latestFiled: latest, freshFilings: fresh }));
  }

  const census = blockCensus(p, "disclosure block", note);
  if (census.total > 0) {
    out.push(f("political/blocks", ["political", "congress", "blocks", "coverage"],
      census.answered + " of the " + census.total +
      " disclosure blocks on this key answered with rows.",
      { answeredBlocks: census.answered, blockCount: census.total }));
  }
  return out;
}

function pulseFacts(p, at, note) {
  const f = maker("pulse", at);
  const out = [];
  const census = blockCensus(p, "pulse feed", note);
  if (census.total === 0) return out;
  out.push(f("pulse/coverage", ["pulse", "feeds", "tide", "darkpool", "insiders", "coverage"],
    census.answered + " of the " + census.total +
    " market-wide pulse feeds answered with rows this session.",
    { answeredFeeds: census.answered, feedCount: census.total }));
  return out;
}

function metaFacts(p, at) {
  const f = maker("meta", at);
  const out = [];
  const universe = num(p.universe), enriched = num(p.enriched), scored = num(p.liquid);
  const built = num(p.cardsBuilt), failed = num(p.cardsFailed), skipped = num(p.cardsSkipped);
  if (all(universe, enriched, scored, built, failed, skipped)) {
    out.push(f("meta/run", ["run", "universe", "cards", "pipeline", "coverage"],
      "The run screened " + universe + " names, enriched " + enriched + " and scored " +
      scored + "; " + built + " cards were built, " + failed + " failed and " + skipped +
      " were skipped.",
      { universeNames: universe, enrichedNames: enriched, scoredNames: scored,
        cardsBuilt: built, cardsFailed: failed, cardsSkipped: skipped }));
  }
  const calls = num(p.apiCalls);
  if (calls !== null) {
    out.push(f("meta/calls", ["run", "calls", "vendor", "api", "budget"],
      "The run spent " + calls + " vendor calls.", { apiCalls: calls }));
  }
  return out;
}

/* THE FEEDS INSIDE A KEY OWN THEIR OWN SILENCE. pulse and political
   each publish several independent blocks under one key, and one
   dead block does not make the key dead. Counting how many answered
   is a reading; naming the ones that did not is a silence, and those
   two belong in two different places, which is why this returns the
   census and hands every failure to `note` rather than folding both
   into a sentence. Blocks are found by shape — an object carrying a
   string `status` — so this file does not have to be kept in step
   with the feed lists in shared/flows-pulse.js and
   shared/flows-political.js. */
function blockCensus(payload, label, note) {
  let answered = 0, total = 0;
  for (const key of Object.keys(payload)) {
    const block = payload[key];
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    if (typeof block.status !== "string") continue;
    total++;
    /* NO ARTICLE HERE. silenceOf() writes "The " + what, so a `what`
       that opened with its own article produced "The the seasonality
       pulse feed could not be read" on every outage of every sub-feed.
       Caught by reading the emitted payload rather than the code: the
       sentence is assembled in two files and neither one is wrong on
       its own. The convention every other caller follows is that
       `what` is a bare noun phrase. */
    const what = key + " " + label;
    if (PUBLISHED_QUIET.has(block.status)) {
      note("quiet", what, silenceOf({ status: "ok", rows: [] }, what).say, block.reason);
      continue;
    }
    if (PUBLISHED_UNREADABLE.has(block.status)) {
      note("unreadable", what, silenceOf(null, what).say, block.reason);
      continue;
    }
    answered++;
  }
  return { answered, total };
}

const SURFACES = Object.freeze([
  { key: "market", what: "market-wide reading", build: marketFacts },
  { key: "movers", what: "movers list", build: moversFacts },
  { key: "unusual", what: "unusual-activity feed", build: unusualFacts },
  { key: "flowalerts", what: "flow-alert feed", build: alertFacts },
  { key: "news", what: "news tape", build: newsFacts },
  { key: "sector:trix", what: "sector momentum reading", build: trixFacts },
  { key: "pulse", what: "market pulse", build: pulseFacts },
  { key: "political", what: "disclosure feed", build: politicalFacts },
  { key: "scoretrack", what: "score track", build: trackFacts },
  { key: "record", what: "scored record", build: recordFacts },
  { key: "meta", what: "run summary", build: metaFacts },
]);

/* THE ORDER A READER OPENS THE PAGE TO ASK, and it is the fallback
   ordering when a question matches nothing: which way the session
   leans first, then the tape, then what is loudest, then the
   surfaces that describe the run rather than the market. Two readers
   asking the same unmatched question have to get the same answer, so
   this is a fixed list rather than whatever order the store's keys
   happened to arrive in. */
const SOURCE_ORDER = Object.freeze([
  "brief", "market", "movers", "unusual", "flowalerts", "news",
  "sector:trix", "pulse", "political", "scoretrack", "record", "meta",
]);

const sourceRank = (s) => {
  const i = SOURCE_ORDER.indexOf(s);
  return i === -1 ? SOURCE_ORDER.length : i;
};

/**
 * Every fact the published payloads support, and every silence they
 * do not.
 *
 * `store` is keyed by PUBLISH key — "board:long", "flowalerts",
 * "sector:premium" and the rest — holding parsed payloads, or null
 * where the reader has none. The three-session facts come from
 * shared/flows-brief.js, imported rather than restated; everything
 * else is assembled here.
 */
export function buildFactIndex(store) {
  const s = store && typeof store === "object" ? store : {};
  const facts = [];
  /* THREE LISTS, NOT ONE WITH A FIELD. A silence that can be filtered
     is a silence that gets summed, and "4 surfaces are silent" is a
     sentence that merges a job that has not run with a market that
     was quiet. Keeping them apart in the shape makes the merge take
     an edit rather than an oversight. */
  const silences = { pending: [], unreadable: [], quiet: [] };
  const record = (kind, what, say, source, reason) => {
    if (!silences[kind]) return;
    silences[kind].push({ kind, what, say, source,
      reason: typeof reason === "string" && reason ? reason : null });
  };

  /* ---- the three-session briefing ---- */
  const briefStore = briefStoreFrom(s);
  /* A SLOT HELD AS null IS PENDING TOO, and this loop is what keeps
     one index from answering in two voices. briefStoreFrom fills in a
     key the store never carried; a key the store DOES carry holding
     null is the same fact from where a reader stands — nothing
     arrived — and every other surface below already answers that with
     pending. Without this, one half of one index would call an absent
     market "not published for this session yet" while the other
     called an absent board a fault on the page, and a reader would
     have to know which half they were reading to know which sentence
     to believe. */
  for (const slot of Object.keys(briefStore)) {
    const held = briefStore[slot];
    if (held === null || held === undefined) briefStore[slot] = { status: "pending" };
  }
  const brief = buildBrief(briefStore);
  const briefAt = atOf(briefStore.long) || atOf(briefStore.short) || atOf(briefStore.events);
  /* WHICH OF THE BRIEFING'S INPUTS EXIST AT ALL. Two of its silences
     are decided from the absence of ROWS rather than from the state
     of the key, which is the right test when a payload arrived and
     the wrong one when none did — and the index is the only place
     that still knows the difference, because it built the store. */
  const pendingSlot = (slot) => briefStore[slot].status === "pending";
  const bothBoardsPending = pendingSlot("long") && pendingSlot("short");
  const nextInputsPending = bothBoardsPending && pendingSlot("watch") && pendingSlot("events");

  const SECTIONS = [
    ["today", brief.today, ["today", "session", "now"]],
    ["yesterday", brief.yesterday, ["yesterday", "changed", "moved", "prior"]],
    ["next", brief.next, ["next", "tomorrow", "scheduled", "calendar", "threshold"]],
  ];
  for (const [name, section, topics] of SECTIONS) {
    const f = maker("brief", briefAt);
    for (const item of section.facts) {
      facts.push(f("brief:" + name + "/" + item.id, topics.concat(item.id.split(":")),
        item.say, item.n));
    }
    for (const q of section.silences) {
      /* THE TWO SILENCES THE BRIEFING CANNOT CLASSIFY FROM WHERE IT
         STANDS, RE-FILED HERE. Both are decided from the absence of
         rows, which is the right test for a payload that arrived and
         the wrong one for a key that was never written:

           briefYesterday says "neither board could be read", which
           tells a reader there is a fault on this page on a morning
           when the job has simply not run;

           briefNext says nothing is scheduled and calls it "a
           measured emptiness", which is a claim about a measurement
           that never happened.

         Every other silence in the briefing is decided by silenceOf
         against the key itself, sees the pending marker directly, and
         passes through untouched. */
      if (name === "yesterday" && q.kind === "unreadable" && bothBoardsPending) {
        record("pending", q.what,
          "Neither board has been published for this session yet, so nothing has been " +
          "measured and nothing is claimed about what changed.", "brief", null);
        continue;
      }
      if (name === "next" && q.kind === "quiet" && nextInputsPending) {
        record("pending", q.what,
          "None of the surfaces the next session is read from has been published yet, " +
          "so nothing is stated about it. Nothing has been measured, so nothing is " +
          "claimed — least of all that the calendar is empty.", "brief", null);
        continue;
      }
      record(q.kind, q.what, q.say, "brief", null);
    }
  }

  /* ---- every other published surface ---- */
  for (const surface of SURFACES) {
    const p = served(s, surface.key);
    const state = silenceOf(p, surface.what);
    /* PENDING AND UNPARSEABLE ARE DECIDED BY THE BRIEFING'S OWN
       silenceOf so that both halves of this index speak with one
       voice. What it cannot decide is whether an answered payload
       held the readings, because those live under a different name
       on nearly every key — sector:premium keeps eleven baskets under
       `sectors`, pulse keeps seven feeds under their own names — so
       that judgement is made below, from what the build produced. */
    if (state && (state.kind === "pending" || typeof p !== "object")) {
      record(state.kind, state.what, state.say, surface.key, null);
      continue;
    }
    const published = answered(p);
    if (!published) continue;

    if (PUBLISHED_QUIET.has(published.status)) {
      record("quiet", surface.what, silenceOf({ status: "ok", rows: [] }, surface.what).say,
        surface.key, null);
      continue;
    }
    if (PUBLISHED_UNREADABLE.has(published.status)) {
      record("unreadable", surface.what, silenceOf(null, surface.what).say,
        surface.key, typeof published.reason === "string" ? published.reason : null);
      continue;
    }

    const note = (kind, what, say, reason) => record(kind, what, say, surface.key, reason);
    const built = surface.build(published, atOf(published), note);
    if (built.length) {
      for (const item of built) facts.push(item);
      continue;
    }
    /* A KEY WHOSE ROWS ARE AN EMPTY ARRAY WAS MEASURED AND HELD
       NOTHING, and that is a reading rather than a breakage. It is
       checked before the fault below so that a genuinely quiet feed
       is never reported as a shape this page failed to read. */
    if (state && state.kind === "quiet") {
      record("quiet", state.what, state.say, surface.key, null);
      continue;
    }
    /* THE KEY ANSWERED AND THIS INDEX FOUND NOTHING IN IT. That is
       not one of the three silences and it is always a fault here
       rather than a fact about the session: the payload parsed and
       the shape it carried was not the shape this file reads. Saying
       so is what turns the next field rename into a visible sentence
       instead of a surface that quietly stops appearing — which is
       exactly how the briefing lost its sector section. */
    record("unreadable", surface.what,
      "The " + surface.what + " was published but this index could not find the readings " +
      "inside it, so nothing about it is stated here. That is a fault on this page rather " +
      "than a fact about the session.", surface.key, null);
  }

  /* NO CLOCK. The index is stamped with the newest reading it was
     built from, which is a measurement; Date.now() here would be
     impure and would also stamp the index with the READER's clock
     rather than with the run that produced the numbers. */
  let generatedAt = null, newest = null;
  for (const key of Object.keys(s)) {
    const stamp = atOf(s[key]);
    if (stamp === null) continue;
    const ms = Date.parse(stamp);
    if (!Number.isFinite(ms)) continue;
    if (newest === null || ms > newest) { newest = ms; generatedAt = stamp; }
  }

  return { facts, silences, generatedAt };
}

/* ---------- selection -------------------------------------------- */

/* A BARE UPPERCASE TOKEN IS A TICKER ONLY IN A SENTENCE THAT HAS
   LOWERCASE IN IT. "Is NVDA on the board" names a ticker; "IS NVDA
   ON THE BOARD" names four of them, and a shouted question would
   otherwise score every fact whose topic happens to hold a matching
   word. Digits are admitted after the first letter because the
   vendor's symbols carry them. */
const TICKER = /\b[A-Z][A-Z0-9]{0,4}\b/g;

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "in", "on", "for", "to", "and",
  "or", "what", "how", "did", "do", "does", "this", "that", "it", "its", "my", "me",
  "you", "we", "they", "there", "here", "be", "been", "at", "by", "with", "from",
  "as", "any", "all", "some", "than", "then", "so", "if", "but", "not", "no", "yes",
  "about", "tell", "show", "give", "please", "can", "could", "would", "who", "why",
]);

function questionWords(question) {
  const text = typeof question === "string" ? question : "";
  const words = text.toLowerCase().match(/[a-z0-9.]{2,}/g) || [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

function questionTickers(question) {
  const text = typeof question === "string" ? question : "";
  if (!/[a-z]/.test(text)) return [];
  return [...new Set((text.match(TICKER) || []).map((t) => t.toLowerCase()))];
}

/**
 * The facts a question is answered from, chosen deterministically.
 *
 * NO EMBEDDINGS AND NO MODEL. Retrieval that cannot be replayed is
 * retrieval that cannot be tested, and this layer is the one a
 * reader has to be able to hold the bot to: the same question over
 * the same index picks the same facts on every machine, forever.
 *
 * A ticker is weighted far above a topic word because a question
 * naming a symbol is asking about that symbol and nothing else, and
 * recency only ever breaks a tie — a fact that scored on the
 * question is always preferred to a newer fact that did not.
 */
export function selectFacts(index, question, options) {
  const o = options || {};
  const max = num(o.max) === null ? 14 : Math.max(1, Math.trunc(num(o.max)));
  const facts = index && Array.isArray(index.facts) ? index.facts : [];
  if (!facts.length) {
    return { picked: [], capped: false,
      why: "The index holds no facts at all, so nothing was selected." };
  }

  const tickers = questionTickers(question);
  const words = questionWords(question);

  /* RECENCY IS A RATIO INSIDE THE INDEX'S OWN SPAN, not an age. The
     module has no clock, so "newer" can only mean newer than the
     other facts here, and a span of zero scores every fact alike
     rather than dividing by it. */
  let oldest = null, newestMs = null;
  for (const f of facts) {
    const ms = f.at === null ? NaN : Date.parse(f.at);
    if (!Number.isFinite(ms)) continue;
    if (oldest === null || ms < oldest) oldest = ms;
    if (newestMs === null || ms > newestMs) newestMs = ms;
  }
  const span = oldest !== null && newestMs !== null ? newestMs - oldest : 0;

  const scored = facts.map((f, i) => {
    const topic = new Set(f.topic || []);
    let hitTickers = 0, hitWords = 0;
    for (const t of tickers) if (topic.has(t)) hitTickers++;
    for (const w of words) if (topic.has(w)) hitWords++;
    const ms = f.at === null ? NaN : Date.parse(f.at);
    const recency = span > 0 && Number.isFinite(ms) ? (ms - oldest) / span : 0;
    return { f, i, hitTickers, hitWords,
      score: hitTickers * 100 + hitWords * 10 + recency };
  });

  const matched = scored.filter((x) => x.hitTickers > 0 || x.hitWords > 0);
  const pool = matched.length ? matched : scored;
  pool.sort((a, b) => (b.score - a.score) ||
    (sourceRank(a.f.source) - sourceRank(b.f.source)) || (a.i - b.i));

  const picked = pool.slice(0, max).map((x) => x.f);
  const capped = pool.length > max;
  const tickerHits = matched.reduce((n, x) => n + (x.hitTickers > 0 ? 1 : 0), 0);

  /* THE POPULATION IS KNOWN AND IS SAID, because a list that
     truncates without saying so reads as a population — and here the
     cap is ours, so the total is exactly reportable rather than a
     lower bound. */
  const of = picked.length + " of " + facts.length + " facts";
  const why = matched.length
    ? "Picked " + of + ": " + (tickerHits
        ? tickerHits + " matched a ticker named in the question and the rest matched " +
          "topic words"
        : "matched on topic words, no ticker in the question matched one") +
      (capped ? ", and the list was cut at the cap." : ".")
    : "Nothing in the question matched a ticker or a topic word in the index, so these " +
      "are the session's headline readings in the order the briefing states them: " + of +
      (capped ? ", cut at the cap." : ".");

  return { picked, capped, why };
}

/* ---------- the guard -------------------------------------------- */

/* THE WHITELIST, AND WHAT IT COSTS. A four-digit year and the
   integers one to twelve are allowed through unquoted because they
   are how dates and ordinals are written — "September 4", "the third
   name", "since 2026" — and a guard that refused them would fire on
   correct answers until somebody switched it off, which is the worst
   outcome available. The price is that a fabricated small count in
   that range passes, so it is written here as one named set rather
   than buried in the scan, and ZERO IS NOT IN IT: zero is the one
   integer this product refuses to let anything but a measurement
   produce. */
function whitelisted(token, allowSmall) {
  if (/^\d{4}$/.test(token)) {
    const y = Number(token);
    if (y >= 1900 && y <= 2100) return true;
  }
  if (allowSmall && /^\d{1,2}$/.test(token)) {
    const v = Number(token);
    if (v >= 1 && v <= 12) return true;
  }
  return false;
}

/**
 * Whether an answer may be shown.
 *
 * Two rules, and both are structural rather than advisory. Every
 * numeral in the answer must already appear in the sentences the
 * answer was built from — the model rephrases, it does not compute —
 * and no answer may carry a verb that claims the future, which is
 * the same scan tests/flows-brief.mjs runs against the briefing's
 * own next-session section.
 *
 * The result is the audit trail, not a boolean: `numerals` is every
 * figure the answer contained and `rejected` is the ones that earned
 * the refusal, so a caller can log what was refused and why without
 * re-deriving it.
 */
export function guardAnswer(answer, picked, options) {
  const o = options || {};
  const allowSmall = o.smallIntegers === undefined ? true : o.smallIntegers === true;
  const text = typeof answer === "string" ? answer : "";
  const facts = Array.isArray(picked) ? picked : [];

  if (text.trim() === "") {
    return { ok: false, rejected: [], numerals: [],
      reason: "The model returned no text, so there is nothing to check and nothing " +
        "to show." };
  }

  const allowed = new Set();
  for (const f of facts) for (const t of numeralsIn(f && f.say)) allowed.add(t);

  const numerals = numeralsIn(text);
  const rejected = [];
  for (const token of numerals) {
    if (allowed.has(token)) continue;
    if (whitelisted(token, allowSmall)) continue;
    rejected.push(token);
  }
  const invented = rejected.length;

  const verbs = text.match(new RegExp(FORECAST.source, "gi")) || [];
  for (const v of verbs) rejected.push(v);

  if (!rejected.length) return { ok: true, rejected: [], reason: null, numerals };

  /* THE REASON CARRIES NO FIGURES OF ITS OWN. A caller printing it
     under a deterministic answer would otherwise put an unquoted
     number back on the page in the sentence explaining why an
     unquoted number was refused. The offending tokens travel in
     `rejected`, where they are data rather than prose. */
  const parts = [];
  if (invented) {
    parts.push("The answer stated a figure that appears in none of the facts it was " +
      "given, which means it was computed or invented rather than quoted");
  }
  if (verbs.length) {
    parts.push("The answer claimed the future, and this product states what was " +
      "measured and what is already on the calendar");
  }
  return { ok: false, rejected, numerals,
    reason: parts.join(". ") + ". The refused tokens are listed in `rejected`, and the " +
      "deterministic reading is served in its place." };
}

/* ---------- the deterministic answer ----------------------------- */

/**
 * The answer that ships when the guard fires, when the day's free
 * model allowance is spent, or when no model was ever reached.
 *
 * IT IS A REAL ANSWER, NOT AN ERROR. The facts were always
 * deterministic; only the prose was ever the model's, so a reader
 * who lands here has lost the phrasing and nothing else, and telling
 * them a system failed would overstate what happened and understate
 * what they are holding.
 *
 * THE QUESTION IS NEVER QUOTED BACK. Echoing it would carry the
 * reader's own numerals into the answer — "what happened to the 40
 * names" would put a 40 on the page that no payload published — and
 * this text has to pass guardAnswer against the same facts it was
 * built from. That is the assertion that matters most in
 * tests/flows-ask.mjs: a fallback that violated its own rule would
 * be a guard that fires on its own output.
 */
export function renderFactsPlain(picked, question) {
  const facts = Array.isArray(picked) ? picked : [];
  if (!facts.length) {
    return "Nothing has been published that speaks to this question, so there is no " +
      "reading to give. That is a statement about what has been measured, not about " +
      "the market.";
  }

  const words = questionWords(question);
  const tickers = questionTickers(question);
  let touched = false;
  for (const f of facts) {
    const topic = new Set(f.topic || []);
    for (const t of tickers) if (topic.has(t)) touched = true;
    for (const w of words) if (topic.has(w)) touched = true;
  }

  const lead = touched
    ? "These are the published readings that bear on what you asked."
    : "Nothing in the question matched a name or a topic the published payloads carry, " +
      "so these are the session's headline readings.";
  const body = facts.map((f) => "- " + f.say).join("\n");
  return lead + "\n\n" + body + "\n\n" +
    "Every figure above is quoted from a payload this pipeline published; none of it " +
    "was computed for this answer.";
}

/* ---------- the prompt ------------------------------------------- */

/**
 * What a chat model is given, and the rules it is held to.
 *
 * THE PROMPT IS NOT THE GUARANTEE. Everything stated here is also
 * enforced by guardAnswer against the answer that comes back, and
 * the enforcement is what makes the product safe — this text only
 * raises the odds of a first attempt that passes. An instruction a
 * model can ignore is a preference; a scan it cannot get past is a
 * contract.
 *
 * The facts are listed unnumbered on purpose: a model asked to cite
 * "fact 15" writes a 15 that no payload published, and its own
 * answer would then be refused for a numeral this prompt handed it.
 */
export function promptFor(picked, question) {
  const facts = Array.isArray(picked) ? picked : [];
  const system = [
    "You answer questions about a stock options briefing using ONLY the facts supplied " +
      "in the next message. You are the prose; the numbers are already decided.",
    "",
    "1. NEVER write a number that does not already appear, character for character, in " +
      "one of the supplied facts. Do not add, subtract, total, average, rank, round, " +
      "convert a ratio into a percentage, or turn a figure into millions. There is no " +
      "arithmetic you are permitted to do. If answering would need a number nobody " +
      "measured, say that it was not measured.",
    "2. NEVER say what the market is going to do. No prediction, no expectation, no " +
      "likelihood. The facts are measurements and calendar entries that already exist, " +
      "and nothing in them supports a claim about a future price or score.",
    "3. THREE KINDS OF SILENCE ARE THREE DIFFERENT FACTS and may never be merged into " +
      "one sentence. PENDING means the payload has not been published for this session, " +
      "so nothing was measured and nothing is claimed. UNREADABLE means it was " +
      "published and could not be read, which is a fault on our side rather than a fact " +
      "about the session. QUIET means it was measured and holds nothing, which is a " +
      "reading in its own right. Never answer that a market was quiet when the truth is " +
      "that a job has not run.",
    "4. UNITS TRAVEL WITH NUMBERS. A ratio and a dollar sum are not interchangeable; " +
      "quote the unit the fact itself uses, in the fact's own words.",
    "5. A capped list is not a population. If a fact says a count was capped or came " +
      "back at a vendor's limit, keep that qualification in your answer.",
    "6. If the supplied facts do not answer the question, say so plainly and say what " +
      "they do cover. A short honest answer is the goal.",
    "",
    "Write two or three plain sentences. No lists, no headings, no markdown, and do " +
      "not refer to the facts by number or position.",
  ].join("\n");

  const user = "Question: " + (typeof question === "string" ? question.trim() : "") +
    "\n\nFacts measured for this session:\n" +
    facts.map((f) => "- " + f.say).join("\n");

  return { system, user };
}
