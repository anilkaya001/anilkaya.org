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
  if (!store || typeof store !== "object" || !Object.hasOwn(store, key)) {
    return { status: "pending" };
  }
  /* AND A KEY HELD AS undefined WAS NEVER WRITTEN EITHER. Object.hasOwn
     answers yes for one, but a store assembled by spreading another or
     by reading fields off a parse writes every key it did not find that
     way, and there is nothing in `{market: undefined}` that a page could
     have failed to read. Sending that down the null branch below told a
     reader a fault happened here, on a surface nothing had yet tried to
     publish, and sent them looking for a breakage that does not exist. */
  if (store[key] === undefined) return { status: "pending" };
  /* NULL IS NOT PENDING, AND COLLAPSING THEM WOULD MERGE TWO OF THE
     THREE SILENCES AT THE ONE PLACE THEY ENTER THIS MODULE. Absent
     means the key was never written — nothing was measured, nothing is
     claimed. Null is what readFlowsPayload returns when the read ITSELF
     failed, which is a fault here; calling that "not published yet"
     tells a reader a job has not run when the truth is that this page
     could not read what the job wrote. Harmless while the only caller
     is the pipeline, whose store never holds null — and a live trap the
     first time anything else builds an index. */
  return store[key] === null ? null : store[key];
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
const NUMERAL_SOURCE = "(?<![\\d.])-?\\d+(?:,\\d+)*(?:\\.\\d+)?";

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
 * A GROUP SEPARATOR SITS BETWEEN DIGITS; A COMMA AFTER A NUMBER IS
 * PUNCTUATION. "1,234" and "1234" are two different strings and only
 * one of them can have been quoted, so a separator between digits
 * stays inside the token. A trailing one used to stay as well, and
 * "Of 118, 61 leaned bullish" then scanned as the token "118," —
 * which matches nothing in a fact that wrote 118 with a space after
 * it, so a verbatim quote was refused and the caller was handed a
 * refused "token" that is not a number. A guard that fires on correct
 * answers is the one failure this file cannot afford, because it is
 * the guard somebody eventually switches off.
 *
 * AND A HYPHEN BETWEEN DIGITS IS A DATE, NOT A MINUS SIGN. Every
 * stamp this pipeline publishes is ISO, so "2026-09-04" scanned as
 * 2026, -09 and -04: two negative figures the model never wrote,
 * reported to the caller as arithmetic it had invented. A sign is
 * only a sign where a number begins, which is what the lookbehind
 * says and what the hyphen inside a date is not.
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
   every fact stamped in that year.

   AN UPPERCASE INITIAL, WHICH EVERY TICKER AND SECTOR HAS AND NO
   REGIME OR SIDE WORD DOES. The per-name facts pin the words that
   describe a reading beside its figures — the gamma regime "short",
   the board side "long" — and a pattern that admitted any letter
   turned each of those into a topic. A standing fact for a name on
   the LONG board then carried "short" (its regime), and "which names
   are on the short board" was answered with eleven long-board names:
   measured on the emitted index before this line changed, 11 of 14
   picks came from card facts and every one of them from the wrong
   side. A pinned word that describes a reading is not a name the
   reading is about. Names the index is about — SYN046, XLF,
   Technology — all begin with a capital; the describing words never
   do. */
const NAME_LIKE = /^[A-Z][A-Za-z0-9.]{0,9}$/;

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
  return (id, topic, say, n, lead) => {
    const f = { id, topic: keywords(topic, source, n), say, n: n || {}, source, at: at || null };
    /* THE LEAD TRAVELS, OR THE FIGURE NEVER LANDS. flows-brief attaches
       `lead` — which keys of `n` head the sentence, in which unit — so
       a renderer can set the number before the words. The re-emit at
       the briefing loop dropped it for every fact, and the thirty
       lines of renderer and the stylesheet built for the headline
       figure were dead on every answer ever served: measured, zero of
       282 facts carried one. It is copied as published, never built
       here, because the module that wrote the sentence is the only
       one that knows which number leads it. */
    if (lead && typeof lead === "object" && Array.isArray(lead.keys) && lead.keys.length) {
      f.lead = lead;
    }
    return f;
  };
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
  /* AND ONLY WHERE THERE ARE FIVE NAMES TO BE THE LARGEST OF. The five
     is flows-market.js's slice and this payload publishes no count
     beside `topShare`, so on a run that priced fewer than five names
     the sentence named five movements over three — and the ratio it
     quotes is 1 by construction there, because every priced name is
     inside the top five. A reader would have read total concentration
     off a tape that was too thin to measure concentration at all. */
  const share = num(prem.topShare);
  if (all(share, priced) && priced >= 5) {
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
  /* AND THE FLAG AND THE ARITHMETIC HAVE TO AGREE BEFORE EITHER IS
     REPEATED. `atVendorLimit` is set at publish time as wire >= the
     limit the fetch actually sent (scripts/flows-pipeline.mjs:4010),
     and the publisher's own comment says a later edit to that fetch
     would turn the claim into a lie rather than into a failure. A true
     flag beside a return well under the request is that lie arriving,
     and repeating it would take a population this page knows EXACTLY —
     63 rows came back, so 63 is the count — and publish it as unknown
     and at least 63, which is the rule the sentence exists to serve
     running backwards. shared/flows-warnings.js:484 refuses the same
     pair for the same reason. */
  if (p.atVendorLimit === true && all(returned, requested) && returned >= requested) {
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
  /* THE ROWS THAT NEVER BECAME ALERTS ARE NOT INSIDE `seen`, so a
     sentence built from `seen` alone reports a page holding everything
     the vendor sent on a read where five rows arrived and could not be
     shaped. shared/flows-alerts.js:281 sets seen to the SHAPED rows and
     counts the rest separately, which makes `unusable` the unreadable
     silence in miniature — a fault on this page — and the news tape one
     function above never has this problem because its `returned` is the
     wire. Null when the read carried no count of its own, which is not
     a measured zero and may not be printed as one. */
  const unusable = num(p.unusable);
  if (all(rows, seen, shed, cap)) {
    out.push(f("flowalerts/coverage", ["alerts", "flow", "tape", "coverage", "cap"],
      "The flow-alert page holds " + rows + " of the " + seen + " alerts read, with " +
      shed + " removed by a cap of " + cap + " rows" +
      (unusable === null ? "" : ", beside " + unusable +
        " rows the vendor sent that this page could not read") + ".",
      Object.assign({ keptAlerts: rows, seenAlerts: seen, shedAlerts: shed, rowCap: cap },
        unusable === null ? {} : { unusableRows: unusable })));
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

/* ---------- the per-name readings ------------------------------- */

/* THE DEFECT THIS BLOCK EXISTS FOR. Asked "what is new for NVDA Calls"
   on a board where NVDA sat at rank 30, the assistant answered with a
   market-wide put/call ratio, because nothing in this index was about
   NVDA: the six surfaces above are boards and market-wide feeds, and
   every deep reading the pipeline computes for one name — its gamma
   regime, its walls, its priced move, its premium flow — was published
   in card:NVDA and read by nobody here. The data existed; the index
   was blind to it.

   THE CARDS ARE ALREADY IN THE STORE. The pipeline holds every payload
   it published in memory when it builds this index, so the per-name
   facts cost no new read, no new key and no vendor call — only a
   constructor. And they need no change downstream: keywords() splits
   the source on ":" so a fact built from "card:NVDA" carries "nvda" as
   a topic, which is the same lowercase form questionTickers() emits,
   and the guard scans sentences it does not know the origin of.

   WHAT BOUNDS IT IS BYTES, NOT CPU. The Worker parses the brief key on
   every question, but the survey that costed this found the binding
   limit is the ingest cap the pipeline publishes under, so the shed
   below is by size and it drops whole NAMES from the least-read end,
   never a fact from the middle of a name — a name half-indexed would
   answer half a question and call it the reading. */

/* THE CARD KEY, AND ONLY THE CARD KEY. Anchored at both ends so
   "card:AAPL:2026-08-24" — a dated archive key, if one is ever
   published — is not read as a live card for a name called
   "AAPL:2026-08-24". The class is the pipeline's own ticker shape. */
const CARD_KEY = /^card:([A-Z][A-Z0-9.\-]{0,9})$/;

/* ROUNDED TO FOUR DECIMALS AND NEVER TO ZERO. A card carries readings
   at full float precision — a persistence of 0.7948717948717948 — and
   a model restating that faithfully as 0.79 would trip the guard on a
   figure it did not invent, so the figure is rounded HERE, once, and
   the same rounded value goes into `n` so the pins and the sentence
   agree. The precision retreats rather than rounds when four decimals
   would turn a nonzero reading into 0: that is the one rounding this
   codebase refuses, because a measured 0.00003 printed as 0 is a
   confident zero with a measurement behind it. Integers pass through
   untouched — a dollar sum is written as published, never as
   "20.4 million", since that is arithmetic on a measurement. */
function r4(v) {
  if (v === null || !Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return v;
  let places = 4;
  let out = Number(v.toFixed(places));
  while (out === 0 && v !== 0 && places < 12) { places++; out = Number(v.toFixed(places)); }
  return out;
}

/* WHERE EACH NAME STANDS ON THE BOARDS, keyed by ticker. The first
   board a name appears on wins — a name is on one side only — and a
   pending or failed board contributes nothing, so a card whose board
   did not publish gets a standing clause of nothing rather than a
   rank on a board that is not there. */
function boardStanding(store) {
  const map = new Map();
  for (const side of ["long", "short"]) {
    const p = store["board:" + side];
    const list = p !== null && typeof p === "object" && p.status !== "pending" &&
      Array.isArray(p.rows) ? p.rows : null;
    if (list === null) continue;
    for (const row of list) {
      if (row === null || typeof row !== "object" || typeof row.t !== "string") continue;
      if (map.has(row.t)) continue;
      map.set(row.t, { side, rank: num(row.r), rows: list.length });
    }
  }
  return map;
}

/* ONE CARD, UP TO FIVE FACTS. Each is emitted only when every reading
   its sentence quotes is present — the same rule marketFacts follows —
   so a card whose gamma panel did not build loses its gamma fact and
   keeps the other four, rather than printing a sentence with a hole. */
function oneCard(t, card, at, st) {
  /* THE TICKER IS PINNED IN EVERY FACT'S RECORD. A symbol carries digits
     of its own — SYN46, BRK.B — and the anti-tamper scan masks pinned
     strings out of the sentence before it reads the figures, so a name
     that is not pinned accuses its own fact of an unpinned "46". The
     brief's facts pin theirs; these do the same, in one place. */
  const f0 = maker("card:" + t, at);
  const f = (id, topic, say, n) => f0(id, topic, say, { ticker: t, ...n });
  const out = [];
  const reg = card.regime !== null && typeof card.regime === "object" ? card.regime : {};
  const panels = card.panels !== null && typeof card.panels === "object" ? card.panels : {};
  const ok = (p) => p !== null && typeof p === "object" && p.status === "ok" ? p : {};

  /* 1. STANDING: the score a reader arrived from, its conviction and
        the regime word, plus the rank and side when a board holds it.
        The rank always travels with the side's row count. */
  const score = num(card.score), conv = num(card.conviction);
  const label = typeof reg.label === "string" && reg.label ? reg.label : null;
  if (all(score, conv) && label !== null) {
    let say = t + " scored " + score + " this session with conviction " + conv +
      " of 100; dealer gamma at spot is " + label + ".";
    /* THE SCALE IS PINNED AS THE UNIT IT IS. "96 of 100" puts a literal
       100 in the sentence, and the anti-tamper record must hold every
       figure the prose quotes — a scale is a unit, and units travel. */
    const n = { score, convictionOf100: conv, convictionScale: 100, regime: label };
    if (st !== null && st.rank !== null && st.rows !== null) {
      say += " It sits at rank " + st.rank + " of " + st.rows + " on the " + st.side + " board.";
      n.boardRank = st.rank; n.boardRows = st.rows; n.side = st.side;
    }
    out.push(f("card:" + t + "/standing", [t, "score", "conviction", "rank", "regime"], say, n));
  }

  /* 2. GAMMA: spot, the walls, the band — and the flip level, which is
        the reading most cards WITHHOLD. On 31 of 50 emitted cards
        gammaFlip is null because crossings is a measured 0: net gamma
        never changed sign inside the band, which is a finding about the
        book and is said as one. A null crossings is not that — it is a
        ladder that was not measured — and it gets no clause at all,
        because "no flip level" over an unmeasured ladder is the
        confident zero wearing prose. */
  const g = ok(panels.gamma);
  const spot = num(g.spot), cw = num(g.callWall), pw = num(g.putWall);
  const strikes = num(g.strikes), lo = num(g.bandMin), hi = num(g.bandMax);
  if (all(spot, cw, pw, strikes, lo, hi) && label !== null) {
    let say = "Dealer gamma for " + t + " is " + label + " at spot " + r4(spot) +
      ", measured over " + strikes + " strikes between " + r4(lo) + " and " + r4(hi) +
      "; the call wall is at " + r4(cw) + " and the put wall at " + r4(pw) + ".";
    const n = { spotPx: r4(spot), callWallPx: r4(cw), putWallPx: r4(pw), strikes,
      bandMinPx: r4(lo), bandMaxPx: r4(hi) };
    const flip = num(card.gammaFlip), crossings = num(reg.crossings);
    if (flip !== null) {
      const side = typeof reg.flipSide === "string" && reg.flipSide
        ? " (" + reg.flipSide.replace(/_/g, " ") + ")" : "";
      say += " Net gamma flips sign at " + r4(flip) + side + ".";
      n.gammaFlipPx = r4(flip);
      if (crossings !== null) n.crossings = crossings;
    } else if (crossings === 0) {
      say += " Net gamma does not change sign inside that band, so no flip level is " +
        "published (0 crossings).";
      n.crossings = 0;
    }
    out.push(f("card:" + t + "/gamma", [t, "gamma", "flip", "wall", "dealer"], say, n));
  }

  /* 3. THE PRICED MOVE, as the fraction of spot the payload publishes.
        It is not turned into a percentage: that is arithmetic, and the
        renderer that draws this panel already states the unit. */
  const pm = ok(panels.pricedMove);
  const im = num(pm.impliedMove), rm = num(pm.realizedMove), sess = num(pm.sessions);
  const il = num(pm.impliedLow), ih = num(pm.impliedHigh);
  if (all(im, rm, sess, il, ih)) {
    const rule = typeof pm.horizonRule === "string" && pm.horizonRule ? pm.horizonRule : null;
    const say = "The priced move for " + t + " over " + sess + " sessions is " + r4(im) +
      " of spot as a fraction, implying a range of " + r4(il) + " to " + r4(ih) +
      ", against a realised move of " + r4(rm) + " over the same horizon" +
      (rule !== null ? "; the horizon is " + rule + "." : ".");
    out.push(f("card:" + t + "/move", [t, "move", "priced", "implied", "range"],
      say, { impliedMoveFraction: r4(im), realizedMoveFraction: r4(rm), sessions: sess,
        impliedLowPx: r4(il), impliedHighPx: r4(ih) }));
  }

  /* 4. FLOW: the session's net premium, as published, and its
        persistence as a ratio. netDelta is on the same panel and is
        NOT quoted, because the payload publishes no unit for it and a
        number without a unit is not a reading this index will state. */
  const path = ok(panels.path);
  const np = num(path.netPremium), pers = num(path.persistence), mins = num(path.minutes);
  if (all(np, pers, mins)) {
    const say = "Net option premium in " + t + " over the " + mins + " minutes read summed to " +
      np + " US dollars, with a persistence of " + r4(pers) + " as a ratio.";
    out.push(f("card:" + t + "/flow", [t, "premium", "flow", "dollars", "persistence"],
      say, { netPremiumUsd: np, persistenceRatio: r4(pers), minutesRead: mins }));
  }

  /* 5. IV RANK, and only when the payload says its unit is a percent.
        A card carries two IV ranks in two units — pricedMove.ivRank as
        a 0–1 fraction and volContext.ivRank.rows[].rank1y as 0–100 —
        and this reads the one whose unit travels with it, so a change
        in what the vendor publishes cannot silently turn 52 into 0.52
        on the page. */
  const vc = ok(panels.volContext);
  const ivr = vc.ivRank !== null && typeof vc.ivRank === "object" ? vc.ivRank : {};
  const unit = typeof ivr.rankUnit === "string" ? ivr.rankUnit : "";
  const latest = ivr.status === "ok" && Array.isArray(ivr.rows) && ivr.rows.length ? ivr.rows[0] : null;
  const rank = latest !== null && typeof latest === "object" ? num(latest.rank1y) : null;
  const asOf = latest !== null && typeof latest.date === "string" && latest.date ? latest.date : null;
  if (rank !== null && asOf !== null && /^percent\b/i.test(unit)) {
    out.push(f("card:" + t + "/ivrank", [t, "iv", "rank", "volatility", "cheap"],
      t + "'s one-year implied-volatility rank was " + r4(rank) + " percent on " + asOf +
      ", as published.",
      { ivRank1yPct: r4(rank), ivRankAsOf: asOf }));
  }

  return out;
}

/**
 * Every per-name fact the published cards support, in board order.
 *
 * Returns the facts and the ordered list of names they cover, so the
 * shed below can drop names from the tail and the page can print how
 * many of the carded names are indexed against how many were carded.
 */
export function cardFacts(store) {
  const s = store && typeof store === "object" ? store : {};
  const standing = boardStanding(s);
  const entries = [];
  for (const key of Object.keys(s)) {
    const m = CARD_KEY.exec(key);
    if (m === null) continue;
    const card = s[key];
    /* A NULL CARD IS A READ THAT FAILED, not a name with no card, and
       typeof null is "object" — the null arm is written on its own. */
    if (card === null || typeof card !== "object" || card.status === "pending") continue;
    const t = typeof card.ticker === "string" && card.ticker ? card.ticker : m[1];
    entries.push({ t, card, at: atOf(card), st: standing.get(t) || null });
  }
  /* LEAST-READ LAST. A shed takes from the end, so the order is the
     order a reader meets the names: long board by rank, then short by
     rank, then any card no board holds. Ties and unranked names fall
     back to the ticker so the order is a function of the store alone. */
  const sideOrder = { long: 0, short: 1 };
  entries.sort((a, b) => {
    const sa = a.st === null ? 2 : sideOrder[a.st.side], sb = b.st === null ? 2 : sideOrder[b.st.side];
    if (sa !== sb) return sa - sb;
    const ra = a.st === null || a.st.rank === null ? Infinity : a.st.rank;
    const rb = b.st === null || b.st.rank === null ? Infinity : b.st.rank;
    if (ra !== rb) return ra - rb;
    return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
  });
  const facts = [];
  const names = [];
  for (const e of entries) {
    const built = oneCard(e.t, e.card, e.at, e.st);
    if (!built.length) continue;
    names.push(e.t);
    for (const item of built) facts.push(item);
  }
  return { facts, names };
}

/**
 * Drop per-name facts from the least-read end until `measure` says
 * the whole payload fits, and say how many names survived.
 *
 * `measure` is handed the candidate fact list and returns the bytes
 * the caller would publish; it is a parameter so this stays pure and
 * testable without a serializer. Whole names go, never single facts,
 * and the count published beside the facts is a count WITH its
 * denominator: "indexed 38 of 50 carded names" is a reading a page
 * can print, "38" is not.
 */
export function shedCardFacts(facts, names, measure) {
  const list = Array.isArray(facts) ? facts.slice() : [];
  const order = Array.isArray(names) ? names.slice() : [];
  let kept = order.length;
  while (kept > 0 && measure(list) > 0) {
    const drop = order[kept - 1];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].source === "card:" + drop) list.splice(i, 1);
    }
    kept--;
  }
  return { facts: list, namesIndexed: { of: order.length, indexed: kept, shed: order.length - kept } };
}

/* THE FOUR SILENCES THIS INDEX CAN FILE, AND A FIFTH IS AN ERROR. The
   stylesheet has named four kinds and four marks since the ask page
   shipped — pending, unreadable, quiet, and UNAVAILABLE, "it spoke, and
   this field was not in it" — while this index held three lists and a
   record() that returned quietly on any other kind. So the fourth
   silence had nowhere to go, and a per-name withholding filed as
   "unavailable" would have vanished with no error and no failing test:
   the exact class of defect the module header says it most fears. The
   list exists now, and an unknown kind throws rather than returns,
   because a silence that is dropped in silence is the one this file
   cannot see. */
export const SILENCE_KINDS = Object.freeze(["pending", "unreadable", "quiet", "unavailable"]);

export function emptySilences() {
  return { pending: [], unreadable: [], quiet: [], unavailable: [] };
}

export function fileSilence(silences, kind, what, say, source, reason) {
  if (!SILENCE_KINDS.includes(kind)) throw new Error("unknown silence kind: " + String(kind));
  silences[kind].push({ kind, what, say, source,
    reason: typeof reason === "string" && reason ? reason : null });
}

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
  /* FOUR LISTS, NOT ONE WITH A FIELD. A silence that can be filtered
     is a silence that gets summed, and "4 surfaces are silent" is a
     sentence that merges a job that has not run with a market that
     was quiet. Keeping them apart in the shape makes the merge take
     an edit rather than an oversight. */
  const silences = emptySilences();
  const record = (kind, what, say, source, reason) => fileSilence(silences, kind, what, say, source, reason);

  /* ---- the three-session briefing ---- */
  const briefStore = briefStoreFrom(s);
  /* A SLOT HELD AS undefined IS PENDING; A SLOT HELD AS null IS NOT,
     and this loop is what keeps one index from answering in two voices.
     briefStoreFrom fills in a key the store never carried, but it reads
     Object.hasOwn, so a key written as undefined arrives here as
     undefined and buildBrief would call it unreadable — a fault on this
     page for a board nothing had tried to publish. Null is the other
     fact and it is not this one: it is what readFlowsPayload returns
     when the read ITSELF failed, and served() answers that with
     unreadable for every surface below. Coercing it to pending here
     would have one index tell a reader a job has not run while, from
     the same store, it told them a read broke — and a reader would
     have to know which half they were reading to know which sentence
     to believe. */
  for (const slot of Object.keys(briefStore)) {
    if (briefStore[slot] === undefined) briefStore[slot] = { status: "pending" };
  }
  const brief = buildBrief(briefStore);
  const briefAt = atOf(briefStore.long) || atOf(briefStore.short) || atOf(briefStore.events);
  /* WHICH OF THE BRIEFING'S INPUTS EXIST AT ALL. Two of its silences
     are decided from the absence of ROWS rather than from the state
     of the key, which is the right test when a payload arrived and
     the wrong one when none did — and the index is the only place
     that still knows the difference, because it built the store. */
  /* A NULL SLOT HAS NO STATUS TO READ, and reading one would throw
     where no reader could ever see it: the pipeline builds this index
     inside a try/catch that only warns, so a TypeError here would drop
     the whole brief key and the page would report a briefing that was
     never published. A failed read is not pending, which is the answer
     this asks for in any case. */
  const pendingSlot = (slot) => {
    const held = briefStore[slot];
    return held !== null && typeof held === "object" && held.status === "pending";
  };
  /* AND WHICH OF THEM WERE MEASURED AT ALL, which is the wider
     question and the one an emptiness has to answer. A slot that is
     absent, that failed to read, or that carries the pending marker
     measured nothing, and a section assembled from nothing may not
     call its own silence a reading. */
  const unmeasuredSlot = (slot) => {
    const held = briefStore[slot];
    return held === null || typeof held !== "object" || held.status === "pending";
  };
  /* EVERY INPUT THE SECTION READS, NOT ONLY THE ONES IT SHARES WITH
     ANOTHER. The next-session section draws on both boards, the watch
     board and the calendar, and its emptiness is a measurement only
     when ALL FOUR were measured — so the test below is "any of them
     was not", never "all of them were not". Requiring all four to be
     missing was the wrong quantifier and it let the strongest claim
     through on the thinnest evidence: a store holding a measured-empty
     calendar and nothing else published "no name sits on a threshold
     this session" as a measured emptiness, on a morning when the three
     surfaces a threshold is read from had not been published at all.
     The boards below are counted for the same reason, one at a time. */
  const NEXT_SLOTS = ["long", "short", "watch", "events"];
  const boardsPending = ["long", "short"].filter(pendingSlot);
  const nextUnmeasured = NEXT_SLOTS.filter(unmeasuredSlot);

  const SECTIONS = [
    ["today", brief.today, ["today", "session", "now"]],
    ["yesterday", brief.yesterday, ["yesterday", "changed", "moved", "prior"]],
    ["next", brief.next, ["next", "tomorrow", "scheduled", "calendar", "threshold"]],
  ];
  /* THE BOARDS' TWO NAMES. The briefing says "bullish" and "bearish";
     the routes say "long" and "short"; a reader asks in either. Before
     the regime label stopped leaking into topics, "which names are on
     the short board" matched fourteen per-name facts on the leaked word
     and looked answered; with the leak closed it matched nothing on
     "short" at all, because no market-wide fact carried the route's
     word. The board's route name is a topic of the fact about its
     leader, so the question lands on the reading it asks for. */
  const SIDE_WORDS = { bullish: ["long"], bearish: ["short"] };
  const sideWords = (id) => {
    const out = [];
    for (const part of id.split(":")) for (const w of SIDE_WORDS[part] || []) out.push(w);
    return out;
  };
  for (const [name, section, topics] of SECTIONS) {
    const f = maker("brief", briefAt);
    for (const item of section.facts) {
      facts.push(f("brief:" + name + "/" + item.id,
        topics.concat(item.id.split(":"), sideWords(item.id)), item.say, item.n, item.lead));
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
      /* EACH RE-FILING NAMES THE ONE SILENCE IT IS FOR. The section is
         not enough to identify it: the next-session section also
         carries the earnings calendar's own quiet, which is a real
         reading — the calendar was read and held no dated report — and
         a re-filing that matched on kind alone swallowed it and told a
         reader the calendar had not been published when it had been
         read that morning. */
      if (name === "yesterday" && q.what === "both boards" &&
          q.kind === "unreadable" && boardsPending.length) {
        record("pending", q.what,
          boardsPending.length === 2
            ? "Neither board has been published for this session yet, so nothing has " +
              "been measured and nothing is claimed about what changed."
            /* ONE BOARD SHORT IS STILL NOT A FAULT ON THIS PAGE. The
               briefing reaches "neither board could be read" the moment
               neither side yields rows, and one side never published is
               enough for that — so a half-finished morning read as a
               breakage. A board that did arrive and could not be read
               keeps its own unreadable sentence beside this one; this
               one says only why the comparison is absent. */
            : "One of the two boards has not been published for this session yet, so " +
              "there is nothing to measure this session against the previous one with, " +
              "and nothing is claimed about what changed.",
          "brief", null);
        continue;
      }
      if (name === "next" && q.what === "the next session" &&
          q.kind === "quiet" && nextUnmeasured.length) {
        /* WHICH SILENCE THE UNMEASURED INPUTS ADD UP TO, rather than
           one word for both of them. Inputs still unpublished are a job
           that has not run; an input that arrived and could not be read
           is a fault here, and a reader told to wait for a run waits
           while the fault stays where it is. */
        const allPending = nextUnmeasured.every(pendingSlot);
        record(allPending ? "pending" : "unreadable", q.what,
          allPending
            ? "The surfaces the next session is read from have not all been published " +
              "for this session yet, so nothing is stated about it. Nothing has been " +
              "measured, so nothing is claimed — least of all that the calendar is empty."
            : "At least one of the surfaces the next session is read from could not be " +
              "read, so nothing is stated about it. That is a fault on this page rather " +
              "than an empty calendar.",
          "brief", null);
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
    /* `p === null` IS TESTED SEPARATELY BECAUSE typeof null IS "object".
       This condition means "there is nothing here worth trying to read",
       and a null read — the shape readFlowsPayload returns when the read
       itself failed — passed straight through it into the builders
       below, which then found no fields and reported the surface as
       having nothing to say. A failed read would have rendered as a
       quiet market. */
    if (state && (state.kind === "pending" || p === null || typeof p !== "object")) {
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

  /* ---- the per-name readings, from every card in the store ---- */
  const cards = cardFacts(s);
  for (const item of cards.facts) facts.push(item);

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

  return { facts, silences, generatedAt, cardNames: cards.names };
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
/* THE PAGE'S OWN NAME, SCORED BELOW A TYPED ONE. A question asked from
   the docked box on /flows/ticker/?t=NVDA is about NVDA unless it says
   otherwise, so the caller may pass the page's name as `subject` and it
   scores at half the weight of a symbol the reader typed: a typed name
   overrides the page outright (the subject list is emptied), and the
   page's name never outranks a typed one. Two names at most, because a
   page is about one and the desk's pair is the widest any route holds. */
const NAMED_WEIGHT = 100;
const SUBJECT_WEIGHT = 50;

/* THE FLOOD RULE. Two hundred and forty-four per-name facts share the
   index with thirty-eight market-wide ones, and on a topic word every
   card fact scores the same ten as a market fact and only loses the
   tie. Measured on the emitted index: "where is dealer gamma short"
   picked 14 of 14 from card facts and "what is priced" the same, so the
   market-wide reading a question like that is asking for was pushed out
   by fourteen names' copies of the same sentence. A card fact that hit
   no name — typed, on the page, or otherwise — is capped at one word's
   score, and at most FOUR such facts are served, one per name, in the
   index's own order (long board by rank, then short, then unboarded),
   AFTER every matched market-wide fact. The reader gets the reading and
   four names to open, not fourteen and no reading. */
const WORD_ONLY_NAMES = 4;

function subjectTickers(subject) {
  const list = subject && typeof subject === "object" && Array.isArray(subject.tickers)
    ? subject.tickers : [];
  const out = [];
  for (const t of list) {
    if (typeof t !== "string") continue;
    const u = t.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(u)) continue;
    const l = u.toLowerCase();
    if (!out.includes(l)) out.push(l);
  }
  return out.slice(0, 2);
}

const plural = (n, word) => word + (n === 1 ? "" : "s");

/* "a", "a and b", "a, b and c" — the clauses of one sentence. */
function joinClauses(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
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
 *
 * TWO NAMES ARE DEALT, NOT RANKED. When a question names two symbols
 * the facts about each are dealt round-robin before the cap, so a
 * comparison is answered seven and seven rather than ten and four —
 * the first name's fifth fact does not outrank the second name's
 * first. Within a name the order is the usual one.
 *
 * THE SENTENCE NAMES WHAT IT COUNTED. "3 of those matched a ticker"
 * never said which, and a reader holding two names could not tell
 * whether both were found. Every count below is over the list the
 * reader is holding, and every name that was asked about is named,
 * found or not.
 */
export function selectFacts(index, question, options) {
  const o = options || {};
  const max = num(o.max) === null ? 14 : Math.max(1, Math.trunc(num(o.max)));
  const facts = index && Array.isArray(index.facts) ? index.facts : [];
  if (!facts.length) {
    return { picked: [], capped: false, subjectApplied: false,
      why: "The index holds no facts at all, so nothing was selected." };
  }

  const typed = questionTickers(question);
  const subject = typed.length ? [] : subjectTickers(o.subject);
  const named = typed.length ? typed : subject;
  const weight = typed.length ? NAMED_WEIGHT : SUBJECT_WEIGHT;
  /* A NAME IS NOT ALSO A WORD. questionWords lowercases every token,
     so a typed symbol would match its own fact twice — once as the
     name and once as a word — and the sentence below would report it
     among "the words". */
  const words = questionWords(question).filter((w) => !named.includes(w));

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

  const cardName = (f) => (typeof f.source === "string" && f.source.startsWith("card:")
    ? f.source.slice(5).toLowerCase() : null);

  const scored = facts.map((f, i) => {
    const topic = new Set(f.topic || []);
    let hitNamed = 0, hitWords = 0, first = null;
    for (const t of named) if (topic.has(t)) { hitNamed++; if (first === null) first = t; }
    for (const w of words) if (topic.has(w)) hitWords++;
    const ms = f.at === null ? NaN : Date.parse(f.at);
    const recency = span > 0 && Number.isFinite(ms) ? (ms - oldest) / span : 0;
    const name = cardName(f);
    const wordOnly = name !== null && hitNamed === 0 && hitWords > 0;
    const score = wordOnly ? 10 : hitNamed * weight + hitWords * 10;
    return { f, i, hitNamed, hitWords, first, name, wordOnly, recency, score };
  });

  const matched = scored.filter((x) => x.hitNamed > 0 || x.hitWords > 0);
  const pool = matched.length ? matched : scored;
  /* RECENCY BREAKS A TIE; IT DOES NOT SET THE ORDER. Held inside the
     score it was the only term that ever varied among facts that
     matched nothing, so the unmatched fallback sorted by whichever key
     was republished last rather than by the fixed list below — and the
     Worker's intraday cron republishes the alert feed and the news tape
     every fifteen minutes. A reader asking a question that matched
     nothing was answered "the run spent 812 vendor calls" while being
     told these were the session's headline readings in the briefing's
     order. Ranked after the source, it does what its own comment says. */
  const byRank = (a, b) => (b.score - a.score) ||
    (sourceRank(a.f.source) - sourceRank(b.f.source)) ||
    (b.recency - a.recency) || (a.i - b.i);

  const general = pool.filter((x) => !x.wordOnly).sort(byRank);

  /* The flood rule, applied: one per name, four names, index order. */
  const perName = [];
  const seenNames = new Set();
  const wordOnlyNames = new Set();
  for (const x of pool) {
    if (!x.wordOnly) continue;
    wordOnlyNames.add(x.name);
    if (seenNames.has(x.name) || perName.length >= WORD_ONLY_NAMES) continue;
    seenNames.add(x.name);
    perName.push(x);
  }

  /* Fairness: deal the named facts round-robin when two names hit. */
  let ordered;
  if (named.length >= 2) {
    const groups = new Map(named.map((t) => [t, []]));
    const rest = [];
    for (const x of general) {
      if (x.hitNamed > 0) groups.get(x.first).push(x);
      else rest.push(x);
    }
    const dealt = [];
    let dealing = true;
    while (dealing) {
      dealing = false;
      for (const t of named) {
        const g = groups.get(t);
        if (g.length) { dealt.push(g.shift()); dealing = true; }
      }
    }
    ordered = dealt.concat(rest, perName);
  } else {
    ordered = general.concat(perName);
  }

  const chosen = ordered.slice(0, max);
  const picked = chosen.map((x) => x.f);
  const capped = ordered.length > max;

  /* THE POPULATION IS KNOWN AND IS SAID, because a list that
     truncates without saying so reads as a population — and here the
     cap is ours, so the total is exactly reportable rather than a
     lower bound. Each clause counts the group it names, over the list
     the reader is holding against the group that matched, so "3 of
     the 9 facts about NVDA" means nine matched the name and three were
     served — never nine in the index, never nine that matched
     something else. */
  const upper = (t) => t.toUpperCase();
  const hitWordList = words.filter((w) => pool.some((x) => x.f.topic && x.f.topic.includes(w)));
  const wordsPhrase = "the words " + hitWordList.slice(0, 4).join(", ") +
    (hitWordList.length > 4 ? " and " + (hitWordList.length - 4) + " more" : "");
  const pageNote = (t) => (subject.includes(t)
    ? (subject.length === 1 ? ", the name on this page" : ", a name on this page") : "");

  let why;
  if (matched.length) {
    const clauses = [];
    const missing = [];
    for (const t of named) {
      const about = general.filter((x) => x.hitNamed > 0 && x.first === t).length;
      if (!about) { missing.push(t); continue; }
      const served = chosen.filter((x) => x.hitNamed > 0 && x.first === t).length;
      clauses.push(served + " of the " + about + plural(about, " fact") + " about " + upper(t) + pageNote(t));
    }
    const wordGeneral = general.filter((x) => x.hitNamed === 0).length;
    if (wordGeneral) {
      const served = chosen.filter((x) => !x.wordOnly && x.hitNamed === 0).length;
      clauses.push(served + " of the " + wordGeneral + plural(wordGeneral, " fact") + " that matched " + wordsPhrase);
    }
    if (wordOnlyNames.size) {
      const served = chosen.filter((x) => x.wordOnly).length;
      clauses.push(served + " per-name reading" + (served === 1 ? "" : "s") + " on " +
        wordsPhrase + ", one each from " + served + " of the " + wordOnlyNames.size +
        " name" + (wordOnlyNames.size === 1 ? "" : "s") + " that carry one");
    }
    why = (missing.length
      ? "Nothing indexed is about " + joinClauses(missing.map((t) => upper(t) + pageNote(t))) + ". "
      : "") +
      "Picked " + joinClauses(clauses) + (capped ? ", cut at the cap of " + max + "." : ".");
  } else {
    why = (subject.length
      ? "Nothing indexed is about " + joinClauses(subject.map(upper)) +
        (subject.length === 1 ? ", the name on this page. " : ", the names on this page. ")
      : "") +
      "Nothing in the question matched a ticker or a topic word in the index, so these " +
      "are the session's headline readings in the order the briefing states them: " +
      picked.length + " of " + facts.length + " facts" +
      (capped ? ", cut at the cap." : ".");
  }

  return { picked, capped, why, subjectApplied: subject.length > 0 };
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

/* AND A ZERO SPELLED OUT IS STILL A ZERO. The scan reads numerals, so
   "0 names cleared" was refused and "zero names cleared" was not —
   and the word is how a model actually writes a count, which left the
   one integer this file refuses reachable by spelling it. It is held
   to the same test as every numeral: it has to be in the text the
   model was handed, as the digit or as the word. The word matters
   because a fact reading "the median IV rank is 0.31 on a zero-to-one
   scale" hands the model the word and no bare 0, and refusing it
   there would be the guard firing on a faithful restatement. */
const ZERO_WORD = /\bzero\b/i;

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
    return { ok: false, rejected: [], numerals: [], invented: false, forecast: false,
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
  if (ZERO_WORD.test(text) &&
      !allowed.has("0") &&
      !facts.some((f) => ZERO_WORD.test(f && typeof f.say === "string" ? f.say : ""))) {
    rejected.push("zero");
  }
  const invented = rejected.length;

  const verbs = text.match(new RegExp(FORECAST.source, "gi")) || [];
  for (const v of verbs) rejected.push(v);

  if (!rejected.length) {
    return { ok: true, rejected: [], reason: null, numerals, invented: false, forecast: false };
  }

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
  /* WHICH FAILURE IT WAS, REPORTED SEPARATELY. A caller handed only
     `rejected` cannot tell an invented figure from a claim about the
     future, and those are not the same fault: one says the model did
     arithmetic nobody asked for, the other says it predicted a market.
     Flattening them would throw away the only interesting thing this
     function learned, and the page that has to explain itself to a
     reader is exactly where that distinction is worth most. */
  return { ok: false, rejected, numerals,
    invented: invented > 0, forecast: verbs.length > 0,
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
/* ---------- which names the facts actually cover ----------------- */

/**
 * Which tickers in the question the facts cover, and which they do not.
 *
 * ONE BOOLEAN WAS TWO FACTS WEARING ONE COAT. renderFactsPlain asked a
 * single `touched` — did ANY word or ticker in the question match ANY
 * fact — and led with "these are the published readings that bear on
 * what you asked" whenever it was true. A question naming NVDA beside
 * the word "calls" set it true through "calls", which matched the
 * market-wide put/call fact, while NVDA itself matched nothing; the page
 * then told a reader that a ratio over 668 names bore on the one name
 * they had asked about. The owner saw it on the live site.
 *
 * Split into the facts it always was: the names the facts cover
 * (`hit`), the names they do not (`miss`), and whether a topic word
 * matched at all (`wordHit`). A name is covered when some fact's topic
 * carries it — the same test selectFacts scores on, so the two can never
 * disagree about what "matched" means.
 *
 * NAMES ARE HANDED BACK UPPERCASE, AND PRINTABLE BY THE GUARD'S OWN RULE.
 * renderFactsPlain is asserted to pass the guard it exists to satisfy,
 * and the guard scans numerals against the union of the picked facts'
 * sentences. So a name may be printed into the lead exactly when every
 * numeral it carries is already in that set — which a covered name's
 * always are, since the fact that covers it names it, and an uncovered
 * name's usually are not. A digit-free rule was tried first and blanked
 * SYN46 on the very question it was covered in; the guard's rule, applied
 * to the name, is the one that cannot disagree with the guard. A name
 * that fails it is referred to, not printed — `hitSaid` and `missSaid`
 * are the printable subsets.
 *
 * "I" AND "A" ARE NOT WITHHELD. The ticker pattern is one capital and up
 * to four more, and the two capitals that are also English words match
 * it: "Should I buy NVDA" names I, "A read on NVDA" names A. A
 * withholding is a claim — "None of the readings below is about I" — and
 * for those two letters the claim is far more often about a pronoun or
 * an article than about a symbol, so an UNCOVERED one is dropped from
 * `miss` rather than announced. A covered one is still a hit: Agilent
 * trades as A, and a fact that carries the letter as a topic is about it.
 * The rule is those two letters and no wider, because F, T, X, V and C
 * are names people ask about, and a withholding on one of them is true.
 * The cost is one honest silence: "is A a buy" with Agilent uncovered
 * falls to the generic lead instead of a withholding, and the generic
 * lead claims nothing false.
 */
const ENGLISH_LETTERS = new Set(["i", "a"]);

export function tickerCoverage(picked, question) {
  const facts = Array.isArray(picked) ? picked : [];
  const tickers = questionTickers(question);
  const words = questionWords(question);
  const covered = new Set();
  let wordHit = false;
  for (const f of facts) {
    const topic = new Set(f && Array.isArray(f.topic) ? f.topic : []);
    for (const t of tickers) if (topic.has(t)) covered.add(t);
    for (const w of words) if (topic.has(w)) wordHit = true;
  }
  const allowed = new Set();
  for (const f of facts) for (const n of numeralsIn(f && typeof f.say === "string" ? f.say : "")) allowed.add(n);
  const printable = (t) => numeralsIn(t).every((n) => allowed.has(n));
  const said = (list) => list.filter(printable).map((t) => t.toUpperCase());
  const hit = tickers.filter((t) => covered.has(t));
  const miss = tickers.filter((t) => !covered.has(t) && !ENGLISH_LETTERS.has(t));
  return { hit, miss, wordHit, hitSaid: said(hit), missSaid: said(miss) };
}

/* "NVDA", "NVDA or AMD", "NVDA, AMD or TSLA". */
function nameList(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}

export function renderFactsPlain(picked, question) {
  const facts = Array.isArray(picked) ? picked : [];
  if (!facts.length) {
    /* WHICH SILENCE THIS IS, THIS FUNCTION CANNOT KNOW, so it names
       all three and asserts none. It is handed facts and never the
       store, and an empty list looks the same from here on a morning
       before the run, on a morning when every payload arrived and none
       of it could be read, and on a session that really was measured
       and empty. The old wording chose one of the three — "nothing has
       been published" — and on the second of those mornings it told a
       reader the pipeline had not run when the truth was that it had
       run and this page could not read a word of it. */
    return "No reading this index holds speaks to this question, so there is nothing to " +
      "quote. Whether nothing has been published for this session, whether what was " +
      "published could not be read, or whether what was measured was empty are three " +
      "different facts, and this sentence is not where they are told apart — the " +
      "silences beside it name each surface one at a time. None of the three is a " +
      "statement about the market.";
  }

  /* THE LEAD IS A CLAIM ABOUT COVERAGE, SO IT IS BUILT FROM COVERAGE.
     Five cases, and the ones that matter are the two in the middle: a
     name asked about that no fact here is about. That is a withholding
     and it goes in the open, ahead of every reading, because a reader
     who sees market-wide figures under "these bear on what you asked"
     attaches them to the name they typed.

     IT CLAIMS ONLY WHAT IT CAN SEE. This function is handed `picked` and
     never the index, so "no reading this index holds" would assert
     something it cannot check — a fact cut by the cap is held and not
     here. "None of the readings below" is exactly what it knows. WHY the
     name has no reading — on a board with no per-name facts indexed,
     screened only, never heard of — is a diagnosis, and it belongs to
     the roster that can make it; this sentence does not guess, and it
     never says "nothing published", because the name may well be on a
     board and hold a card. */
  const cov = tickerCoverage(facts, question);
  const one = cov.miss.length === 1;
  const missPhrase = cov.missSaid.length ? nameList(cov.missSaid)
    : (one ? "the name you asked about" : "the names you asked about");
  const withheld = "None of the readings below is about " + missPhrase + ".";

  let lead;
  if (cov.miss.length === 0 && (cov.hit.length > 0 || cov.wordHit)) {
    lead = "These are the published readings that bear on what you asked.";
  } else if (cov.miss.length > 0 && cov.hit.length > 0) {
    const hitPhrase = cov.hitSaid.length ? nameList(cov.hitSaid) : "the name it does cover";
    lead = "These are the published readings that bear on " + hitPhrase + ". " + withheld;
  } else if (cov.miss.length > 0 && cov.wordHit) {
    lead = withheld + " They are the session's readings on the other words in the question.";
  } else if (cov.miss.length > 0) {
    lead = withheld + " Nothing else in the question matched a topic the published payloads " +
      "carry, so these are the session's headline readings.";
  } else {
    lead = "Nothing in the question matched a name or a topic the published payloads carry, " +
      "so these are the session's headline readings.";
  }
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
    "3. FOUR KINDS OF SILENCE ARE FOUR DIFFERENT FACTS and may never be merged into " +
      "one sentence. PENDING means the payload has not been published for this session, " +
      "so nothing was measured and nothing is claimed. UNREADABLE means it was " +
      "published and could not be read, which is a fault on our side rather than a fact " +
      "about the session. QUIET means it was measured and holds nothing, which is a " +
      "reading in its own right. UNAVAILABLE means the payload was published and this " +
      "particular reading is not on it, so nothing is claimed about that reading. Never " +
      "answer that a market was quiet when the truth is that a job has not run.",
    "4. UNITS TRAVEL WITH NUMBERS. A ratio and a dollar sum are not interchangeable; " +
      "quote the unit the fact itself uses, in the fact's own words.",
    "5. A capped list is not a population. If a fact says a count was capped or came " +
      "back at a vendor's limit, keep that qualification in your answer.",
    "6. If the supplied facts do not answer the question, say so plainly and say what " +
      "they do cover. A short honest answer is the goal.",
    "7. If a COVERAGE line says a name in the question has no reading among the facts, " +
      "never attach a figure to that name. A market-wide figure is not a reading for one " +
      "name, and writing one beside it is the same as inventing it.",
    "",
    "Write two or three plain sentences. No lists, no headings, no markdown, and do " +
      "not refer to the facts by number or position.",
  ].join("\n");

  /* THE MODEL IS TOLD WHAT THE PAGE IS TOLD. Rule 6 asks it to say when
     the facts do not answer the question, but it cannot know that NVDA
     matched nothing: it sees a put/call ratio and the name in the
     question, and "for NVDA, the put/call ratio is 0.5546" passes the
     guard because the figure IS in a fact. A market-wide number attached
     to one name is the one fabrication the numeral scan cannot see, so
     the coverage is stated to the model in the same terms the plain
     reading states it to the reader. */
  const cov = tickerCoverage(facts, question);
  const coverage = cov.miss.length
    ? "\n\nCOVERAGE: the question names " +
      (cov.missSaid.length ? nameList(cov.missSaid) : "a symbol") +
      ", and none of the facts below is a reading for " +
      (cov.miss.length === 1 ? "that name" : "those names") +
      ". Do not attribute any figure to " + (cov.miss.length === 1 ? "it" : "them") +
      "; say that no reading for " + (cov.miss.length === 1 ? "it" : "them") +
      " was supplied."
    : "";
  const user = "Question: " + (typeof question === "string" ? question.trim() : "") +
    coverage +
    "\n\nFacts measured for this session:\n" +
    facts.map((f) => "- " + f.say).join("\n");

  return { system, user };
}
