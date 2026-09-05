/* Contracts for card assembly.

   The load-bearing test here is the ABLATION SWEEP: build a card with each
   source knocked out in turn and assert that no numeric field comes back as
   0 and the affected panel reports "unavailable".

   That is not a hypothetical. This repository has already shipped the same
   bug twice — a missing greek-flow scored BETTER than a present one because
   otmShare fell back to 0, which was the top of a winsorized column; and a
   missing family sub-score rendered as a short positive bar, which read as a
   small bullish contribution. On a card it is worse still, because a card has
   no cross-section to normalise against: a fallback zero renders as
   "spot is exactly at the gamma flip", the single most actionable state the
   panel can show, manufactured entirely by absence. */

import assert from "node:assert/strict";
import {
  buildCard, buildLevels, buildGammaProfile, buildPath, buildCongress,
  buildCalendar, buildDisplacement, buildPricedMove, buildContext, buildSurface,
  buildCohort, COHORT_ROWS, COHORT_NOTES,
  indexMarketCross, indexCrossFeed, readCrossFeed, buildMarketCross,
  measureOrder, measureOiBasis, CROSS_NOTES,
  numOrNull, polarityOf, POLARITY, pickMaxPain, pickMaxPainRow, CARD_SCHEMA_VERSION,
  HORIZON_SESSIONS,
} from "../shared/flows-card.js";
import { horizonMove } from "../shared/flows-features.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

/* ---------- numOrNull is the whole discipline ------------------- */
{
  eq(numOrNull(undefined), null, "undefined is null, not zero");
  eq(numOrNull(null), null, "null is null");
  eq(numOrNull(""), null, "an empty string is null");
  eq(numOrNull("abc"), null, "an unparseable string is null");
  eq(numOrNull(NaN), null, "NaN is null");
  eq(numOrNull(Infinity), null, "Infinity is null");
  eq(numOrNull("0"), 0, "a genuine zero is still zero");
  eq(numOrNull(0), 0, "a genuine numeric zero survives");
  eq(numOrNull("12.5"), 12.5, "a numeric string parses");
}

/* ---------- polarity is a property of the FIELD ------------------ */
{
  eq(polarityOf("netPutPremium"), -1,
     "THE ENTRY THIS TABLE EXISTS FOR: positive net put premium is put buying, which is bearish");
  eq(polarityOf("netCallPremium"), +1, "net call premium is bullish when positive");
  eq(polarityOf("riskReversal"), -1,
     "risk reversal is IV(put) - IV(call), so negative means calls bid and bullish");
  eq(polarityOf("netGamma"), 0, "a gamma regime has no direction of its own");
  eq(polarityOf("purity"), 0, "a confidence measure is never coloured directionally");
  eq(polarityOf("nonsense_field"), 0,
     "an unknown field is neutral rather than guessed — no call site may colour what it cannot name");
  ok(Object.isFrozen(POLARITY), "the polarity table cannot be mutated at runtime");
  ok(Object.values(POLARITY).every((v) => v === 1 || v === -1 || v === 0),
     "every polarity is exactly +1, -1 or 0");
}

/* ---------- levels: distance in percent AND in ATR --------------- */
{
  const l = buildLevels({ spot: 100, atr: 4, gammaFlip: 96, maxPain: 105, callWall: 110, putWall: 90 });
  eq(l.status, "ok", "a complete level set resolves");
  near(l.levels[0].distPct, -0.04, 1e-9, "nearest level is the gamma flip at -4%");
  near(l.levels[0].distAtr, -1, 1e-9, "and at -1 ATR");
  ok(l.levels.every((x, i, arr) => i === 0 || Math.abs(x.distPct) >= Math.abs(arr[i - 1].distPct)),
     "levels are ordered nearest-first");

  // A distance in sigma units with no sigma is NO number, not a huge one.
  const noAtr = buildLevels({ spot: 100, atr: 0, gammaFlip: 96 });
  eq(noAtr.levels[0].distAtr, null, "with no ATR the sigma distance is null, never Infinity");
  ok(Number.isFinite(noAtr.levels[0].distPct), "but the percent distance still resolves");

  eq(buildLevels({ spot: 0 }).status, "unavailable", "no spot means no levels");
  eq(buildLevels({ spot: 100, atr: 4 }).status, "unavailable", "no levels at all is unavailable");
  ok(!("levels" in buildLevels({ spot: 0 })), "an unavailable panel carries no numbers at all");
}

/* ---------- gamma profile: the dealer-signed sum ----------------- */
{
  // put_gamma arrives already dealer-signed, so exposure per strike is a SUM.
  /* THE REAL FIELD NAMES. /spot-exposures/strike splits every greek by
     aggressor: call_gamma_ask, call_gamma_bid, put_gamma_ask, put_gamma_bid.
     This fixture previously used call_gamma/put_gamma — the names the function
     under test was guessing at — so the test validated the guess against
     itself and passed while production published 54 bars of exactly zero. */
  const ladder = [
    { strike: "90", call_gamma_ask: "0.6e8", call_gamma_bid: "0.4e8",
      put_gamma_ask: "-3e8", put_gamma_bid: "-2e8" },          // net short: put wall
    { strike: "100", call_gamma_ask: "1.2e8", call_gamma_bid: "0.8e8",
      put_gamma_ask: "-0.6e8", put_gamma_bid: "-0.4e8" },
    { strike: "110", call_gamma_ask: "5e8", call_gamma_bid: "4e8",
      put_gamma_ask: "-0.6e8", put_gamma_bid: "-0.4e8" },      // net long: call wall
  ];
  const g = buildGammaProfile(ladder, { spot: 100 });
  eq(g.status, "ok", "a ladder resolves");
  eq(g.callWall, 110, "the call wall is the most positive net-gamma strike");
  eq(g.putWall, 90, "the put wall is the most negative");
  near(g.bars[0].g, -4e8, 1, "all four aggressor legs are SUMMED, not differenced");

  // The exact production failure: rows carrying only the WRONG names must not
  // silently become a ladder of measured zeros.
  const wrongNames = buildGammaProfile(
    [{ strike: "100", call_gamma: "1e9", put_gamma: "-2e8" }], { spot: 100 },
  );
  ok(wrongNames.status === "unavailable" || wrongNames.bars.every((b) => b.g !== 0),
     "a row with no aggressor-split gamma is dropped, never drawn as zero gamma");

  // Bucketing keeps a 500-strike ladder inside the ingest cap.
  const wide = Array.from({ length: 500 }, (_, i) => ({
    strike: String(50 + i), call_gamma_ask: "6e5", call_gamma_bid: "4e5",
    put_gamma_ask: "-1e5", put_gamma_bid: "-1e5",
  }));
  const bucketed = buildGammaProfile(wide, { spot: 200, maxBars: 60 });
  ok(bucketed.bars.length <= 60, `500 strikes reduce to at most 60 bars (${bucketed.bars.length})`);
  ok(bucketed.bucketed === true, "and the card says it was bucketed");
  eq(bucketed.strikes, 500, "while still reporting the true ladder depth");

  eq(buildGammaProfile([]).status, "unavailable", "an empty ladder is unavailable");
  eq(buildGammaProfile(null).status, "unavailable", "a null ladder is unavailable");
}

/* ---------- path: cumulated, downsampled, gap-carried ------------ */
{
  const t0 = Date.parse("2026-08-24T13:30:00Z");
  const ticks = Array.from({ length: 390 }, (_, i) => ({
    tape_time: new Date(t0 + i * 60000).toISOString(),
    net_delta: "100", net_call_premium: "1000", net_put_premium: "400",
  }));
  const p = buildPath(ticks, { sessionDate: "2026-08-24" });
  eq(p.status, "ok", "a full session resolves");
  eq(p.series.length, 78, "390 minutes downsample to 78 buckets");
  eq(p.netDelta, 39000, "the series is CUMULATED, not the raw per-tick values");
  eq(p.netPremium, 390 * 600, "net premium is call buying minus put buying");
  ok(p.series[77][0] > p.series[0][0], "the cumulative curve rises across the session");
  eq(p.asOf, "2026-08-24", "the panel carries the session it describes");

  // A quiet stretch is not a return to zero.
  const gappy = [
    { tape_time: new Date(t0).toISOString(), net_delta: "500", net_call_premium: "0", net_put_premium: "0" },
    { tape_time: new Date(t0 + 300 * 60000).toISOString(), net_delta: "0", net_call_premium: "0", net_put_premium: "0" },
    { tape_time: new Date(t0 + 380 * 60000).toISOString(), net_delta: "100", net_call_premium: "0", net_put_premium: "0" },
  ];
  const gp = buildPath(gappy);
  ok(gp.series.every(([d]) => d >= 500 - 1e-9),
     "the running total carries forward through quiet buckets rather than dropping to zero");

  /* THE SECOND SERIES IS REAL, NOT PADDING.
     Each row is [cumulative delta, cumulative premium]. The renderer read only
     p[0] for months, so ~78 premium points per card were serialised, shipped
     and dropped on the floor. Pinning the last bucket against the published
     total is what makes that column load-bearing: a buildPath that stopped
     emitting the pair, or emitted a constant beside it, fails here. */
  eq(p.series[77][1], p.netPremium,
     "the last bucket's premium IS the published session total — the premium leg " +
     "is a measured series, not a placeholder beside the delta one");
  ok(p.series.every((row) => Array.isArray(row) && row.length === 2),
     "every bucket is a [delta, premium] pair");
  ok(p.series[77][1] > p.series[0][1],
     "and the premium leg cumulates across the session in its own units");

  /* ---- THE PATH SIGNATURE, which is the whole of family D and which the
     card published none of. Two sessions with the SAME net delta and opposite
     meanings are the fixture, because that is the distinction the panel's own
     docstring says it exists to draw. */
  eq(p.persistence, 1,
     "a tape that moves the same way every minute has persistence 1, not an unpublished field");
  near(p.concentration, 20 / 390, 1e-9,
     "on a perfectly uniform session the busiest 5% of minutes carry 5% of the movement");
  near(p.centroid, 0.5, 1e-9, "and its movement-weighted mean minute sits at mid-session");

  const spikeTicks = Array.from({ length: 390 }, (_, i) => ({
    tape_time: new Date(t0 + i * 60000).toISOString(),
    net_delta: i === 5 ? "39000" : "0", net_call_premium: "0", net_put_premium: "0",
  }));
  const spike = buildPath(spikeTicks, { sessionDate: "2026-08-24" });
  eq(spike.netDelta, p.netDelta,
     "THE FIXTURE PAIR: one 09:35 print and a session-long worked order with the " +
     "SAME end-of-day net delta — the totals cannot tell them apart");
  eq(spike.concentration, 1,
     "but the spike put every unit of its movement in the busiest 5% of minutes");
  ok(spike.concentration > p.concentration * 10,
     "which separates it from the worked order by an order of magnitude");
  ok(spike.persistence < 0.01 && p.persistence === 1,
     "and only one of its 390 minutes moved with the day's direction");
  ok(spike.centroid < 0.05, "an early spike reports an early centroid");

  /* A TAPE THAT DID NOT MOVE HAS NO SHAPE, and pathSignature's own fallbacks —
     persistence 0, concentration 0, centroid 0.5 — are the manufactured
     extremes this file exists to prevent reaching a card: 0.5 is "the day's
     weight sat exactly at midday" and 0 concentration is the flattest session
     that can exist. Both must be withheld, not published. */
  const flat = buildPath(Array.from({ length: 30 }, (_, i) => ({
    tape_time: new Date(t0 + i * 60000).toISOString(),
    net_delta: "0", net_call_premium: "0", net_put_premium: "0",
  })), { sessionDate: "2026-08-24" });
  eq(flat.status, "ok", "a motionless tape is still a tape: the panel resolves");
  eq(flat.persistence, null, "with no movement there is no direction to persist in — null, not 0");
  eq(flat.concentration, null, "and no busiest minute — null, not the flattest possible session");
  eq(flat.centroid, null, "and no weighted mean minute — null, not a confident midday");

  ok(!("persistence" in buildPath([])),
     "an unavailable path panel carries no signature fields at all, not null ones a " +
     "renderer might paint");

  eq(buildPath([]).status, "unavailable", "no tape is unavailable");
  eq(buildPath([{ tape_time: "nonsense", net_delta: "1" }]).status, "unavailable",
     "unparseable timestamps are unavailable, not an empty chart");
}

/* ---------- congress: honest, and only what is computable -------- */
{
  const trades = [
    { name: "A Member", member_type: "house", issuer: "self", txn_type: "Purchase",
      transaction_date: "2026-06-10", filed_at_date: "2026-08-25", amounts: "$1,001 - $15,000" },
    { name: "B Member", member_type: "senate", issuer: "spouse", txn_type: "Sale",
      transaction_date: "2026-08-20", filed_at_date: "2026-08-23", amounts: "$50,001 - $100,000" },
  ];
  const c = buildCongress(trades, { asOf: "2026-08-24" });
  eq(c.status, "ok", "disclosed transactions resolve");
  eq(c.trades[0].member, "B Member", "most recent transaction first");
  eq(c.trades[0].disclosureLagDays, 3, "a prompt filing shows a short lag");
  eq(c.trades[1].disclosureLagDays, 76,
     "THE INFORMATIVE NUMBER: a June trade surfacing in August is 76 days old");
  eq(c.trades[0].issuer, "spouse", "the issuer is shown, never collapsed into the member");
  eq(c.trades[0].side, "sell", "a Sale is a sell");
  eq(c.trades[1].side, "buy", "a Purchase is a buy");
  eq(c.trades[1].amountRange, "$1,001 - $15,000",
     "the amount is the bracket verbatim — a midpoint would be fabricated precision");
  eq(c.trades[1].amountLow, 1001, "the bracket bounds are parsed for sorting, not for display");
  eq(c.trades[1].amountHigh, 15000, "both bounds are kept");

  // No field may claim a return or a member track record.
  const asText = JSON.stringify(c);
  ok(!/"return"|"avgReturn"|"trackRecord"|"winRate"/.test(asText),
     "the panel claims no return, and for the ONE reason that cannot expire: a " +
     "disclosure reports an opening with no paired closing print. This message " +
     "also used to argue that congress-trader has no pagination — which was " +
     "true, then stopped being true when the vendor documented `page` and " +
     "`date_from`, and the political section now walks exactly that ladder. A " +
     "refusal resting on a vendor limitation has to be re-read when the vendor " +
     "changes, or it becomes folklore that outlives its own reason");

  /* The unit-level split, matching the card-level one below. */
  eq(buildCongress([]).status, "quiet",
     "A TAPE THAT WAS READ AND NAMED NOBODY IS QUIET, not unavailable — still " +
     "never '0 congressional buyers', but a fact about the filings rather than " +
     "about the request");
  eq(buildCongress(null).status, "unavailable",
     "while a tape that was never read for this name is unavailable");
  ok(buildCongress([]).reason !== buildCongress(null).reason,
     "and the two carry different sentences, so the distinction survives into " +
     "prose as well as into the status");
  eq(buildCongress(null).status, "unavailable", "a failed fetch is unavailable");
  ok(!("trades" in buildCongress([])), "and it carries no numbers");
}

/* ---------- max pain picks the NEAREST expiry -------------------- */
{
  eq(pickMaxPain([{ expiry: "2026-09-18", max_pain: "210" },
                  { expiry: "2026-08-28", max_pain: "195" }]), 195,
     "the nearest expiry's max pain is the one that pins");
  eq(pickMaxPain([]), null, "no expiries yields null, not zero");
  eq(pickMaxPain([{ expiry: "2026-08-28", max_pain: "" }]), null, "an empty value is null");
}

/* ---------- THE ABLATION SWEEP ----------------------------------
   Knock out one source at a time and assert the card never manufactures a
   number. This is the only mechanism that actually prevents the failure; the
   rest is discipline. */
{
  const t0 = Date.parse("2026-08-24T13:30:00Z");
  const full = {
    ticker: "TEST",
    row: { close: "100" },
    features: {
      spot: 100, atr: 4, gammaFlip: 96, netGamma: -8e8, gRegime: "short",
      flipSide: "short_below", spotGammaShare: -0.4, flipCount: 1,
      bandMin: 70, bandMax: 130,
      score: 71, conviction: 64, agreement: 1, breadth: 3, coverage: 1, gate: 1.2,
      fam: { F: 60, P: -20, D: 30, V: 55, O: 62 },
      otmShare: 0.62, vegaTilt: 1.4,
      iv30: 0.42, rv30: 0.31, vrp: 0.11, ivRank: 0.66, ivMomentum: 0.03,
      impliedMovePerc: 0.048,
      closes: Array.from({ length: 42 }, (_, i) => 90 + i * 0.25),
      r5: 0.012, r21: 0.05, r42: 0.11, week52Pos: 0.72,
    },
    weights: { F: 2.1, P: 0.9, D: 0.8 },
    expiries: [
      { expiry: "2026-08-28", call_gamma: "6e8", put_gamma: "-2e8" },
      { expiry: "2026-09-18", call_gamma: "2e8", put_gamma: "-1e8" },
      { expiry: "2026-12-18", call_gamma: "5e7", put_gamma: "-5e7" },
    ],
    /* All EIGHT gamma fields /spot-exposures/strike returns, not just the four
       the gamma panel reads. A fixture that carries only the fields the code
       under test happens to use cannot fail when a second consumer reads a
       different set — which is how the aggressor-split field names shipped
       inverted, and how the displacement panel would have shipped blank. */
    strikes: [{ strike: "95", call_gamma_ask: "0.6e8", call_gamma_bid: "0.4e8",
                put_gamma_ask: "-2.4e8", put_gamma_bid: "-1.6e8",
                call_gamma_oi: "1.2e8", put_gamma_oi: "-3.1e8",
                call_gamma_vol: "0.3e8", put_gamma_vol: "-0.9e8" },
              { strike: "105", call_gamma_ask: "4e8", call_gamma_bid: "3e8",
                put_gamma_ask: "-0.6e8", put_gamma_bid: "-0.4e8",
                call_gamma_oi: "6.4e8", put_gamma_oi: "-0.8e8",
                call_gamma_vol: "2.1e8", put_gamma_vol: "-0.2e8" }],
    ticks: Array.from({ length: 60 }, (_, i) => ({
      tape_time: new Date(t0 + i * 60000).toISOString(),
      net_delta: "50", net_call_premium: "800", net_put_premium: "300",
    })),
    maxPain: [{ expiry: "2026-08-28", max_pain: "102" }],
    congress: [{ name: "M", member_type: "house", issuer: "self", txn_type: "Purchase",
                 transaction_date: "2026-08-01", filed_at_date: "2026-08-20",
                 amounts: "$1,001 - $15,000" }],
    generatedAt: "2026-08-25T09:15:00Z",
    sessionDate: "2026-08-24",
  };

  const complete = buildCard(full);
  eq(complete.v, CARD_SCHEMA_VERSION, "the card carries its schema version");
  /* THE VERSION IS A CONTRACT WITH THE RENDERER, not decoration. It moved to 2
     when fam.V and fam.O stopped being signed votes and became unsigned gauges.
     Pinning the literal here means a future change to those semantics cannot
     ship without also moving the number the renderer switches on — which is the
     only thing standing between a reader and a published 53 redrawn as a
     53%-full gauge it never meant. */
  eq(CARD_SCHEMA_VERSION, 2,
     "schema version 2 is where V and O became unsigned gauges; bump it again " +
     "if any published field changes MEANING, and teach the renderer the new floor");
  eq(complete.sessionDate, "2026-08-24",
     "THE SESSION, not the run date: a pre-open job reads the previous completed session");
  ok(complete.generatedAt !== complete.sessionDate, "the two dates are distinct fields");
  eq(complete.gammaFlip, 96,
     "the flip price is a top-level field — the gamma panel draws its line from it");
  eq(complete.atr, 4, "and ATR travels with it, so distances can be shown in sigma");
  /* THE TWO SUPPRESSION REASONS ARE PUBLISHED, not folded away into the O digit.
     POLARITY has reserved an entry for each of these since before buildCard
     existed — a reserved slot for a field nothing published, which is the exact
     shape the unrendered quantities in this repository keep taking. */
  ok(complete.quality,
     "the card publishes a quality block at all, rather than leaving the two gate " +
     "inputs computable but unpublished");
  eq((complete.quality || {}).otmShare, 0.62,
     "the OTM share of directional flow reaches the card");
  eq((complete.quality || {}).vegaTilt, 1.4,
     "and so does vega flow per unit of delta flow — the cleanest reason to " +
     "suppress a directional read rather than misread it as a view");
  eq(polarityOf("otmShare"), 0, "neither carries a direction of its own");
  eq(polarityOf("vegaTilt"), 0, "so neither may ever be coloured directionally");
  eq((buildCard({ ...full, features: null }).quality || {}).otmShare, null,
     "with no greek-flow the OTM share is null, NEVER 0 — zero is the TOP of that " +
     "column once it is oriented, and a missing source scoring better than a present " +
     "one is a bug this repository has already shipped twice");
  eq((buildCard({ ...full, features: null }).quality || {}).vegaTilt, null,
     "and the vega tilt likewise: no delta flow to divide by is 'no directional view', " +
     "never zero vol content");
  eq((buildCard({ ...full,
    features: { ...full.features, otmShare: null, vegaTilt: null } }).quality || {}).otmShare, null,
     "a null from positioningQuality survives as a null rather than parsing to zero");

  eq(buildCard({ ...full, features: null }).gammaFlip, null,
     "with no features the flip is null, never 0 — 'spot is exactly at the flip' " +
     "is the most actionable state on the card and must never be manufactured");
  for (const key of ["gamma", "levels", "path", "congress", "calendar",
                     "displacement", "pricedMove", "context"]) {
    eq(complete.panels[key].status, "ok", `panel ${key} resolves when every source is present`);
  }

  const SOURCES = ["strikes", "ticks", "maxPain", "congress", "features", "row", "expiries"];
  const PANEL_OF = {
    strikes: "gamma", ticks: "path", congress: "congress", expiries: "calendar",
  };

  for (const source of SOURCES) {
    for (const empty of [[], null, undefined]) {
      const card = buildCard({ ...full, [source]: empty });

      // 1. Every number that DOES survive is finite. A NaN or an Infinity
      //    reaching the renderer is as bad as a manufactured zero.
      const walk = (node, path, out) => {
        if (node === null || node === undefined) return out;
        if (typeof node === "number") { out.push([path, node]); return out; }
        if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, out)); return out; }
        if (typeof node === "object") {
          for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, out);
        }
        return out;
      };
      const numbers = walk(card, "card", []);
      ok(numbers.every(([, v]) => Number.isFinite(v)),
         `every surviving number is finite with ${source} missing`);

      // 2. THE INVARIANT. The panel that depended on the missing source
      //    reports unavailable and carries NO numeric field at all — not a
      //    zero, not a count, nothing a renderer could paint as a reading.
      //    A count of 0 on a LIVE panel is a true measurement and is fine;
      //    a 0 on a dead panel is the manufactured extreme this guards.
      const panel = PANEL_OF[source];
      if (panel) {
        /* AN EMPTY ARRAY IS NOT A MISSING SOURCE FOR EVERY PANEL.
           This sweep ablates each source three ways — [], null, undefined —
           and asserted all three produce "unavailable". For congress that
           collapsed the very distinction the panel needs: [] is a tape that
           WAS read and named nobody, which is a fact about the filings, while
           null and undefined are reads that did not happen. The invariant
           this sweep exists to protect is that a dead panel carries no
           numbers, and that holds for both dead states; the status is
           asserted precisely per source instead of uniformly. */
        const expected = (panel === "congress" && Array.isArray(empty))
          ? "quiet" : "unavailable";
        eq(card.panels[panel].status, expected,
           `panel ${panel} reports ${expected} when ${source} is ${JSON.stringify(empty) || "undefined"}`);
        ok(card.panels[panel].reason, `and gives a reason`);
        const stray = walk(card.panels[panel], `panels.${panel}`, []);
        ok(stray.length === 0,
           `an unavailable ${panel} panel carries no numbers at all ` +
           `(found: ${stray.map(([k, v]) => `${k}=${v}`).join(", ") || "none"})`);
      }

      // 3. Panels that did NOT depend on the missing source are untouched:
      //    one dead feed never degrades another panel.
      for (const [other, p] of Object.entries(card.panels)) {
        if (other === panel) continue;
        if (p.status !== "ok") continue;
        ok(walk(p, other, []).every(([, v]) => Number.isFinite(v)),
           `panel ${other} still holds finite numbers with ${source} missing`);
      }

      // 4. Every panel is always a tagged union — the renderer switches on
      //    status before touching a number, so there is always a status.
      for (const p of Object.values(card.panels)) {
        /* THREE STATES NOW, AND THE WIDENING IS THE POINT OF A WHOLE CHANGE
           RATHER THAN A SIDE EFFECT OF ONE. This union was two states for as
           long as the card had no way to say "the source answered and
           measured nothing", which is why a measured emptiness had to borrow
           `unavailable` and the live product printed both silences in one
           sentence. An earlier wave added three panels that wanted the third
           state and mapped onto the two instead, deliberately, rather than
           widening this assertion to let new code pass — because widening it
           without teaching the renderer the third arm would have produced
           panels the reader sees as "Unavailable." regardless. The renderer
           has that arm now, so this widens once, for every panel. */
        ok(p.status === "ok" || p.status === "unavailable" || p.status === "quiet",
           `every panel is a tagged union with ${source} missing`);
        if (p.status !== "ok") {
          ok(typeof p.reason === "string" && p.reason.length > 0,
             `and every non-ok panel says WHICH silence it is, in words, with ` +
             `${source} missing — a bare status is a blank the reader cannot read`);
        }
      }

      // 5. A dead panel never removes the card, and never touches the others.
      eq(card.ticker, "TEST", `the card survives ${source} being missing`);
    }
  }

  // The specific manufactured readings that motivated all of the above.
  const noLevels = buildCard({ ...full, features: null, maxPain: null });
  ok(noLevels.panels.levels.status === "unavailable"
     || noLevels.panels.levels.levels.every((l) => l.kind !== "gamma_flip"),
     "with no features there is no gamma flip level — never 'spot is exactly at the flip'");
  /* THE THREE SILENCES AT THE CONGRESS PANEL, AND THIS SUITE USED TO ENCODE
     THE CONFLATION AS CORRECT. The one case it constructed was `congress: []`
     — a read that HAPPENED and matched nothing — and it asserted that this
     reports "unavailable". So the live product printed "Unavailable. no
     disclosed transactions" on every card: an unavailability status carrying
     a measured-emptiness reason, and no reader could tell a failed request
     from a genuine absence of filings. The case that should legitimately
     produce "unavailable" — `congress: null`, a read that did not happen —
     was never constructed at all. */
  const emptyCongress = buildCard({ ...full, congress: [] });
  eq(emptyCongress.panels.congress.status, "quiet",
     "A READ THAT FOUND NOTHING IS QUIET. The tape was fetched and this ticker " +
     "appeared in no filing — a fact about the filings, and the only one of " +
     "the three silences that is about the world rather than about the request");
  ok(/read and named no member/.test(emptyCongress.panels.congress.reason),
     "with the sentence saying which of the three it is, not just that it is empty");
  ok(!("buys" in emptyCongress.panels.congress),
     "and still no '0 congressional buyers' — a quiet panel carries no numbers either");

  const unreadCongress = buildCard({ ...full, congress: null });
  eq(unreadCongress.panels.congress.status, "unavailable",
     "A READ THAT DID NOT HAPPEN IS UNAVAILABLE. The pipeline's market-wide " +
     "fetch can throw and its per-name fallback is deadline-gated, and either " +
     "way the run knows — it just used to drop the knowledge on the floor with " +
     "`congressByTicker.get(t) || []`");
  ok(/not read for this name/.test(unreadCongress.panels.congress.reason),
     "saying so in words, so the two dead states are distinguishable in prose too");

  const preFieldCongress = buildCard({ ...full, congress: undefined });
  eq(preFieldCongress.panels.congress.status, "unavailable",
     "and a card from before the pipeline learned the distinction reads as " +
     "unavailable rather than claiming a measurement it never made");
}

/* ---------- price context: the join key that did not exist --------

   The directive this product is built to has one explicit deliverable that
   was nowhere in it: historical daily-close scores overlaid on price. Both
   halves ship and both are drawn — on separate pages, in incompatible
   shapes. The score series is keyed by session date; `closes` was a
   POSITIONAL array with no dates, so nothing could align close[i] to
   session[j].

   The trap is not that dates were missing. It is that buildContext FILTERS —
   dropping any close that is null or non-positive — so index stops being
   time exactly when a session goes missing, and a dates array added
   afterwards and filtered separately (or not filtered at all) is misaligned
   by precisely the number of dropped sessions. Two independent designs for
   this feature proposed exactly that. These assertions are what makes the
   lockstep unreachable to get wrong. */
{
  const ctx = buildContext({
    closes: [10, 11, 12, 13],
    closeDates: ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"],
  }, { asOf: "2026-08-27" });
  eq(ctx.closes.length, ctx.closeDates.length,
     "closes and closeDates are the same length");
  assert.deepEqual(ctx.closeDates, ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"],
     "and pair up in order when nothing is dropped"); checks++;
  eq(ctx.dropped, 0, "with nothing dropped");

  /* THE ASSERTION THE WHOLE SECTION EXISTS FOR. */
  const gappy = buildContext({
    closes: [10, null, 12, 0, 14],
    closeDates: ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"],
  }, { asOf: "2026-08-28" });
  assert.deepEqual(gappy.closes, [10, 12, 14],
     "the null and the non-positive close are dropped, as they always were"); checks++;
  assert.deepEqual(gappy.closeDates, ["2026-08-24", "2026-08-26", "2026-08-28"],
     "AND THEIR DATES GO WITH THEM. The surviving closes are 10, 12, 14 and " +
     "they happened on the 24th, 26th and 28th — not the 24th, 25th and 26th. " +
     "A dates array filtered separately from the closes, or not filtered at " +
     "all, would have said the second and third here, putting every point on " +
     "the wrong day and the score overlay out of step with the price it is " +
     "drawn against"); checks++;
  eq(gappy.dropped, 2,
     "and the count of removed sessions is published, because a non-zero " +
     "value is exactly when index stops being time in these arrays");
  eq(gappy.closes.length, gappy.closeDates.length,
     "the two arrays stay the same length across the filter");

  /* A publisher that sends no dates must not manufacture a row of nulls that
     a renderer could read as a measurement. */
  const undated = buildContext({ closes: [10, 11, 12] }, { asOf: "2026-08-27" });
  ok(!("closeDates" in undated),
     "a card published before this field existed OMITS it rather than carrying " +
     "nulls — an absent key is a different fact from a date that could not be read");
  eq(undated.datedSessions, 0,
     "with the dated count at zero, so a time-axis chart knows it cannot draw");
  eq(undated.sessions, 3, "while the positional series is unaffected");

  const halfDated = buildContext({
    closes: [10, 11, 12], closeDates: ["2026-08-24", null, "2026-08-26"],
  }, { asOf: "2026-08-26" });
  eq(halfDated.closeDates[1], null, "a candle with no readable date keeps its slot as null");
  eq(halfDated.datedSessions, 2,
     "and datedSessions counts what can be placed on a time axis, which is not " +
     "the same as sessions — a chart that joined on date and trusted `sessions` " +
     "would silently plot two points and label them three");
}

/* ---------- the panels added after the live board was read -------- */
{
  /* GAMMA ROLL-OFF. put_gamma arrives ALREADY dealer-signed, so gross roll-off
     sums the magnitudes; a front week of 1e9 call against -999e6 put is 2.0e9
     of gamma about to expire, not the 1e6 their signed sum leaves. Every
     fixture in the older block passes put_gamma "0", which is precisely why
     that convention shipped inverted once already. */
  const signed = buildCalendar([
    { expiry: "2026-08-28", call_gamma: "1e9", put_gamma: "-999000000" },
    { expiry: "2026-09-18", call_gamma: "5e6", put_gamma: "0" },
  ], { asOf: "2026-08-24" });
  ok(signed.schedule[0].share > 0.99,
     `the front week carries the book: gross, not the signed residual (got ${signed.schedule[0].share})`);
  eq(signed.halfLifeExpiry, "2026-08-28", "and it is the half-life");
  eq(signed.schedule[0].days, 4, "days to expiry are measured from the SESSION, not the clock");
  eq(signed.halfLifeDays, 4, "the half-life carries its own horizon in days");

  const cal = buildCalendar([
    { expiry: "2026-08-28", call_gamma: "600", put_gamma: "0" },
    { expiry: "2026-09-25", call_gamma: "400", put_gamma: "0" },
  ], { asOf: "2026-08-24" });
  // Mean life is gamma-weighted E[days]: 0.6*4 + 0.4*32 = 15.2.
  ok(Math.abs(cal.meanLifeDays - 15.2) < 0.05,
     `mean life is the gamma-weighted average horizon (got ${cal.meanLifeDays})`);
  /* AND IT IS PARTITION-INVARIANT, which frontLoad is not. Splitting the front
     expiry's gamma across two same-day rows must not move it. */
  const split = buildCalendar([
    { expiry: "2026-08-28", call_gamma: "300", put_gamma: "0" },
    { expiry: "2026-08-28", call_gamma: "300", put_gamma: "0" },
    { expiry: "2026-09-25", call_gamma: "400", put_gamma: "0" },
  ], { asOf: "2026-08-24" });
  ok(Math.abs(split.meanLifeDays - cal.meanLifeDays) < 1e-9,
     "mean life survives a repartition of the chain");
  ok(split.frontLoad !== cal.frontLoad,
     "while frontLoad does not — which is why it is not the comparable number");

  ok(buildCalendar([], { asOf: "2026-08-24" }).status === "unavailable", "an empty chain is unavailable");
  /* THE WIRE NAMES, which is the whole reason this panel shipped empty.
     buildCalendar read the documented call_gamma / put_gamma; /greek-exposure
     /expiry sends call_gex / put_gex. Every fixture in this file used the
     documented pair, so the contract passed and all twelve published cards
     carried panels.calendar = "unavailable: no expiry gamma". */
  const wireCal = buildCalendar([
    { expiry: "2026-08-28", call_gex: "6e8", put_gex: "-2e8" },
    { expiry: "2026-09-18", call_gex: "2e8", put_gex: "-1e8" },
  ], { asOf: "2026-08-24" });
  ok(wireCal.status === "ok", "buildCalendar reads the wire's call_gex / put_gex legs");
  ok(wireCal.schedule.length === 2, "both wire-named expiries reach the schedule");
  ok(wireCal.schedule[0].share > 0.7,
     "put_gex is dealer-signed, so the gross front-week share sums the legs");

  ok(buildCalendar([{ expiry: "2026-08-28", call_gamma: null, put_gamma: null }]).status === "unavailable",
     "rows the vendor returned with null greeks are NOT a measured zero — this is " +
     "the exact shape that made family V identically zero on all 34 live names");
  eq(buildCalendar(cal.schedule.length ? [] : []).asOf, null, "an unavailable calendar carries no date");

  /* THE PRICED MOVE is a price, never a forecast, and its horizon is the
     expiry the vendor quoted rather than a round number of days. */
  const pm = buildPricedMove({
    spot: 100, impliedMovePerc: 0.05, vrp: 0.11, iv30: 0.42, rv30: 0.31,
    asOf: "2026-08-24", sessions: 10,
  });
  eq(pm.low, 95, "the band's low is spot times one minus the implied move");
  eq(pm.high, 105, "and its high the mirror");
  /* THE VENDOR'S QUOTE IS NOT DATED, because its date cannot be observed. The
     schema behind implied_move says the figure is "for the nearest end of the
     week expiration" when no expiry is supplied, and the screener accepts no
     expiry parameter. This panel used to name that horizon from the max-pain
     chain's nearest row — the same date only when the nearest listed expiry
     happens to be the coming Friday. It is labelled by the RULE now. */
  eq(pm.horizonRule, "the nearest end-of-week expiry",
     "the quote is labelled by the vendor's stated rule, not by an inferred date");
  ok(!("horizonExpiry" in pm) && !("horizonDays" in pm),
     "and carries no date at all, so no renderer can print one");

  /* THE FIXED HORIZON, which is the only one of the two bands that is a
     cross-section. The vendor's implied_move_perc is quoted to each name's own
     next listed expiry, so a column of those compares different horizons. */
  eq(pm.sessions, 10, "the horizon is published beside the numbers derived from it");
  /* 0.42 * sqrt(10/252) = 0.0836662..., published rounded to five decimals, so
     the tolerance is the rounding granularity and not tighter. */
  ok(Math.abs(pm.impliedMove - 0.42 * Math.sqrt(10 / 252)) < 1e-5,
     `the fixed-horizon move is the square-root-of-time scaling (got ${pm.impliedMove})`);
  ok(Math.abs(pm.realizedMove - 0.31 * Math.sqrt(10 / 252)) < 1e-5,
     "and the realized band uses the same rule, so the two are comparable");
  ok(pm.impliedMove > pm.realizedMove,
     "a positive variance risk premium means the priced band is wider than the delivered one");
  ok(Math.abs((pm.impliedHigh - pm.impliedLow) / 2 / 100 - pm.impliedMove) < 1e-4,
     "the published prices agree with the published fraction");

  ok(Math.abs(horizonMove(0.42, { sessions: 252 }) - 0.42) < 1e-12,
     "a full year of sessions returns the annual figure unchanged");
  ok(horizonMove(0.42, { sessions: 40 }) > horizonMove(0.42, { sessions: 10 }),
     "and a longer horizon is a wider band");
  ok(horizonMove(null) === null && horizonMove(0) === null && horizonMove(-1) === null,
     "a missing or non-positive vol has no horizon move, rather than zero");
  ok(horizonMove(0.4, { sessions: 0 }) === null, "and neither does a zero horizon");
  ok(HORIZON_SESSIONS > 0, "the default horizon is a positive number of sessions");

  /* THE TWO BANDS ARE INDEPENDENT. A name with no vendor quote still gets the
     comparable band, and a name with no implied vol still gets the quote. */
  const noQuote = buildPricedMove({ spot: 100, impliedMovePerc: null, iv30: 0.42, rv30: 0.2, asOf: "2026-08-24" });
  eq(noQuote.status, "ok", "no vendor quote is not a dead panel when implied vol is present");
  eq(noQuote.movePerc, null, "the quoted band is withheld");
  ok(noQuote.impliedMove > 0, "while the fixed-horizon band is published");
  const noIv = buildPricedMove({ spot: 100, impliedMovePerc: 0.05, iv30: null, rv30: null, asOf: "2026-08-24" });
  eq(noIv.status, "ok", "and the reverse");
  eq(noIv.impliedMove, null, "with the fixed-horizon band withheld");
  ok(noIv.movePerc > 0, "and the quote published");
  ok(buildPricedMove({ spot: 100, impliedMovePerc: null, iv30: null }).status === "unavailable",
     "neither band means no panel");
  eq(pm.richness, "rich", "a positive variance risk premium is a rich band");
  eq(buildPricedMove({ spot: 100, impliedMovePerc: 0.05, vrp: -0.04, asOf: "2026-08-24" }).richness,
     "cheap", "and a negative one a cheap band");
  eq(buildPricedMove({ spot: 100, impliedMovePerc: 0.05, vrp: null, asOf: "2026-08-24" }).richness,
     null, "with no realized-vol baseline there is no richness claim, not a default one");
  ok(buildPricedMove({ spot: 100, impliedMovePerc: null }).status === "unavailable",
     "no quoted move means no band — never a zero-width one at spot");
  ok(buildPricedMove({ spot: 0, impliedMovePerc: 0.05 }).status === "unavailable",
     "and no spot means no band either");
  eq(buildPricedMove({ spot: 100, impliedMovePerc: null, iv30: 0.4, asOf: "2026-08-24" }).horizonRule, null,
     "with no vendor quote there is no rule to state either");

  /* THE VOLATILITY SURFACE. Nothing in it is directional, and the polarity
     table must say so — a renderer that green-tints a rich option market is
     inventing a forecast the data does not support. */
  for (const k of ["iv30", "rv30", "vrp", "ivMomentum", "impliedMovePerc", "spotGammaShare"]) {
    eq(polarityOf(k), 0, `${k} carries no direction`);
  }
  /* IT TRAVELS WITH THE BAND, not in a panel of its own. A separate `vol` panel
     was built, serialised and published on every card, and no renderer drew it
     — bytes on the read path that nothing could read. */
  const surf = buildPricedMove({
    spot: 100, impliedMovePerc: 0.05, iv30: 0.4, rv30: null, vrp: null,
    ivRank: 0.5, ivMomentum: 0.02, asOf: "2026-08-24",
  });
  eq(surf.rv30, null, "a missing realized vol stays null beside a live implied one");
  eq(surf.ivRank, 0.5, "IV rank travels with the band it qualifies");
  eq(surf.ivMomentum, 0.02, "and so does the week's IV change");

  /* BOOK DISPLACEMENT, in ATR units, and null rather than Infinity without one. */
  const disp = buildDisplacement([
    { strike: "90", call_gamma_oi: "100", put_gamma_oi: "-100", call_gamma_vol: "0", put_gamma_vol: "0" },
    { strike: "110", call_gamma_oi: "0", put_gamma_oi: "0", call_gamma_vol: "100", put_gamma_vol: "-100" },
  ], { atr: 4, spot: 100 });
  eq(disp.oiCentroid, 90, "the standing book's gamma centroid");
  eq(disp.volCentroid, 110, "and today's");
  eq(disp.gapAtr, 5, "the gap is expressed in ATR units, which is what compares across names");
  eq(polarityOf("displacement"), +1, "displacement is signed: positive means gamma building ABOVE");
  eq(buildDisplacement([
    { strike: "90", call_gamma_oi: "100", put_gamma_oi: "0", call_gamma_vol: "100", put_gamma_vol: "0" },
  ], { atr: 0, spot: 100 }).gapAtr, null,
     "a distance in sigma units with no sigma is no number, not a small one");
  ok(buildDisplacement([], { atr: 4 }).status === "unavailable", "no ladder, no displacement");

  /* PRICE CONTEXT is descriptive and says so; none of it enters the score. */
  const ctx = buildContext({ closes: [10, 11, 12], r5: 0.01, r21: null, r42: 0.2, week52Pos: 0.5, changePct: 0.02 });
  eq(ctx.r21, null, "a window too short to measure stays null");
  eq(ctx.closes.length, 3, "the closes travel for the card's own chart");
  ok(buildContext({ closes: [], r5: null, r21: null, r42: null, week52Pos: null, changePct: null })
     .status === "unavailable", "no history at all is unavailable");

  /* MAX PAIN carries its expiry, because the priced move's horizon is read
     from it — and it is a level computed from today's open interest, not a
     target the price is pulled toward. */
  const mp = pickMaxPainRow([
    { expiry: "2026-09-18", max_pain: "120" },
    { expiry: "2026-08-28", max_pain: "102" },
  ]);
  eq(mp.expiry, "2026-08-28", "the NEAREST expiry, whatever order the vendor returned");
  eq(mp.px, 102, "with its level");
  eq(pickMaxPain([]), null, "an empty chain has no max pain");
  eq(pickMaxPainRow([{ expiry: "2026-08-28", max_pain: null }]), null,
     "and a null level is dropped rather than parsed to zero");

  /* THE NEAREST LIVE EXPIRY, not the first row. The vendor documents /max-pain
     as returning "all expirations ... for the last 120 days", so the array can
     carry expiries that have already passed; sorting ascending and taking
     rows[0] took the OLDEST and drew it on the levels rail beside spot as
     though it still existed. No fixture supplied a past expiry, which is why
     nothing caught it. */
  const stale = [
    { expiry: "2026-05-15", max_pain: "70" },
    { expiry: "2026-08-28", max_pain: "102" },
    { expiry: "2026-09-18", max_pain: "120" },
  ];
  eq(pickMaxPainRow(stale, { asOf: "2026-08-24" }).expiry, "2026-08-28",
     "an expired row is skipped, not published as the nearest level");
  eq(pickMaxPainRow(stale).expiry, "2026-05-15",
     "and with no session date the old behaviour is unchanged, so the guard is the date");
  eq(pickMaxPainRow([{ expiry: "2026-05-15", max_pain: "70" }], { asOf: "2026-08-24" }), null,
     "a chain whose every expiry has passed reports NO max pain, never a stale one");
  eq(pickMaxPainRow(stale, { asOf: "2026-08-28" }).expiry, "2026-08-28",
     "an expiry on the session date itself is still live");

  const staleCard = buildCard({
    ticker: "STALE",
    row: { close: "100" },
    features: { spot: 100, atr: 4, gammaFlip: 96 },
    strikes: [], ticks: [], expiries: [], congress: [],
    maxPain: [{ expiry: "2026-05-15", max_pain: "70" }],
    generatedAt: "2026-08-25T09:15:00Z", sessionDate: "2026-08-24",
  });
  ok(staleCard.panels.levels.status === "unavailable"
     || staleCard.panels.levels.levels.every((l) => l.kind !== "max_pain"),
     "so a four-month-stale chain puts no max-pain level on the rail");
}

/* ---------- the strike x expiry gamma surface ------------------- */
{
  /* The profile and the calendar are both MARGINALS of this. The surface is
     fetched from its own endpoint rather than derived, because an outer
     product of two marginals is a model of a joint, not a measurement of one,
     and the difference is the whole reason this panel exists. */
  const cell = (strike, expiry, call, put) => ({
    strike: String(strike), expiry,
    call_gamma_ask: String(call * 0.6), call_gamma_bid: String(call * 0.4),
    put_gamma_ask: String(put * 0.6), put_gamma_bid: String(put * 0.4),
  });

  const rows = [
    cell(90, "2026-08-28", 1e7, -5e7), cell(90, "2026-09-18", 2e6, -1e7),
    cell(100, "2026-08-28", 4e7, -2e7), cell(100, "2026-09-18", 8e6, -4e6),
    cell(110, "2026-08-28", 9e7, -1e7), cell(110, "2026-09-18", 2e7, -2e6),
  ];
  const surf = buildSurface(rows, { spot: 100, asOf: "2026-08-25" });
  eq(surf.status, "ok", "a strike x expiry response builds a surface");
  assert.deepEqual(surf.expiries, ["2026-08-28", "2026-09-18"]); checks++;
  assert.deepEqual(surf.strikes, [90, 100, 110]); checks++;
  eq(surf.atSpot, 100, "the strike nearest spot is named");

  /* THE RECONCILIATION. Summing the grid across expiries must reproduce the
     row marginal — the same quantity the gamma profile draws. Two views of one
     book that disagree are worse than one view. The put legs arrive ALREADY
     dealer-signed, so all four legs are SUMMED here exactly as the profile
     sums them; taking a difference anywhere would break this equality. */
  surf.strikes.forEach((k, i) => {
    const across = surf.grid[i].reduce((a, v) => a + (v ?? 0), 0);
    near(across, surf.rowTotals[i], Math.abs(surf.rowTotals[i]) * 1e-9 + 1,
         `strike ${k} reconciles across expiries`);
  });

  /* THE SURFACE IS NOT SEPARABLE, and the fixture must not let it be. If the
     joint were the outer product of its marginals, every 2x2 minor would have
     zero determinant and the endpoint would be redundant with two cheaper
     calls. This asserts the fixture actually exercises a joint. */
  const det = surf.grid[0][0] * surf.grid[2][1] - surf.grid[0][1] * surf.grid[2][0];
  ok(Math.abs(det) > 1e-6,
     "the fixture carries a genuine joint, not an outer product of two marginals");

  eq(surf.callWall.strike, 110, "the call wall is the most positive row in the drawn window");
  eq(surf.putWall.strike, 90, "the put wall is the most negative");
}

{
  const cell = (strike, expiry, g) => ({
    strike: String(strike), expiry,
    call_gamma_ask: String(g), call_gamma_bid: "0", put_gamma_ask: "0", put_gamma_bid: "0",
  });

  /* UNMEASURED IS NULL, NEVER ZERO. A strike-expiry pair the vendor did not
     return and one carrying no gamma look identical the moment a fallback zero
     is written into the grid, and only one of them is a fact. On a heatmap the
     difference is a grey cell versus a cell that says "no gamma here", which
     is a tradeable claim. */
  const sparse = buildSurface([
    cell(100, "2026-08-28", 5e6),
    cell(110, "2026-09-18", 3e6),
  ], { spot: 105 });
  eq(sparse.status, "ok");
  const at100 = sparse.strikes.indexOf(100);
  const sep = sparse.expiries.indexOf("2026-09-18");
  ok(sparse.grid[at100][sep] === null,
     "a pair the vendor did not return is null, not a confident zero");

  /* A row with no measured leg at all is DROPPED rather than entered as zero. */
  const noLegs = buildSurface([
    cell(100, "2026-08-28", 5e6),
    { strike: "105", expiry: "2026-08-28" },
  ], { spot: 100 });
  ok(!noLegs.strikes.includes(105), "a row carrying no gamma leg never reaches the grid");

  /* EXPIRIES IN DATE ORDER, NOT BY SIZE. Keeping the largest columns would
     draw a January LEAP beside this Friday with nothing saying six weeks were
     skipped — a column axis with holes that still reads as consecutive. */
  const many = [];
  for (let j = 0; j < 12; j++) {
    const d = new Date(Date.UTC(2026, 7, 28) + j * 7 * 86400000).toISOString().slice(0, 10);
    // The LAST expiry is by far the largest, so a size-ranked axis would keep it.
    many.push(cell(100, d, j === 11 ? 9e9 : 1e6));
  }
  const windowed = buildSurface(many, { spot: 100, maxExpiries: 4 });
  assert.deepEqual(windowed.expiries, many.slice(0, 4).map((r) => r.expiry)); checks++;
  ok(!windowed.expiries.includes(many[11].expiry),
     "the biggest far-dated column does not jump the queue past the near term");
  eq(windowed.expiriesShown, 4, "and the window says how much it is showing");
  eq(windowed.expiriesTotal, 12, "out of how much there is");

  /* STRIKES ARE CENTRED ON SPOT, and the window REFILLS when spot sits at an
     edge rather than returning a half-empty grid. */
  const ladder = [];
  for (let i = 0; i < 30; i++) ladder.push(cell(80 + i, "2026-08-28", 1e6));
  const centred = buildSurface(ladder, { spot: 95, maxStrikes: 5 });
  assert.deepEqual(centred.strikes, [93, 94, 95, 96, 97]); checks++;
  const atEdge = buildSurface(ladder, { spot: 80, maxStrikes: 5 });
  eq(atEdge.strikes.length, 5, "spot at the low edge still yields a full window");
  eq(atEdge.strikes[0], 80, "anchored where the data starts");
  const atTop = buildSurface(ladder, { spot: 109, maxStrikes: 5 });
  eq(atTop.strikes.length, 5, "and at the high edge too");
  eq(atTop.strikes[4], 109);
}

{
  const cell = (strike, expiry, g) => ({
    strike: String(strike), expiry,
    call_gamma_ask: String(g), call_gamma_bid: "0", put_gamma_ask: "0", put_gamma_bid: "0",
  });

  /* THE COLOUR SCALE IS CAPPED AND SAYS SO. One ATM cell on the front expiry
     routinely carries more gamma than the rest of the grid combined. Scaling
     to the maximum paints one saturated square on a field of grey and hides
     the structure the panel exists to show. */
  const rows = [];
  for (let i = 0; i < 21; i++) rows.push(cell(90 + i, "2026-08-28", 1e6));
  rows.push(cell(100, "2026-09-18", 1e9));            // the dominant cell
  const capped = buildSurface(rows, { spot: 100 });
  ok(capped.scaleCap < capped.peak,
     `the scale caps below the peak (cap ${capped.scaleCap}, peak ${capped.peak})`);
  ok(capped.clipped >= 1, "and reports how many cells were clipped rather than flattening them");
  ok(capped.scaleCap > 0, "a capped scale is still a positive scale");

  /* A grid of one value must not produce a zero scale — that would divide
     every cell by nothing. */
  const flat = buildSurface([cell(100, "2026-08-28", 5e6)], { spot: 100 });
  ok(flat.scaleCap > 0, "a single-valued grid still has a usable scale");

  /* Unavailable paths carry a reason and NO numbers. */
  for (const [args, why] of [
    [[[], { spot: 100 }], "an empty response"],
    [[null, { spot: 100 }], "a null response"],
    [[[cell(100, "2026-08-28", 1e6)], { spot: null }], "no spot"],
    [[[cell(100, "2026-08-28", 1e6)], { spot: 0 }], "a zero spot"],
  ]) {
    const out = buildSurface(...args);
    eq(out.status, "unavailable", `${why} yields unavailable`);
    ok(out.reason && !("grid" in out), `${why} carries a reason and no numbers`);
  }
}

/* ---------- the wave-2 panels at the card boundary -----------------
   Their internals live in flows-stock-contract.mjs; what the CARD owes
   is the three-silences boundary: a null raw (the fetch failed) is
   unavailable-with-reason, an empty raw (the vendor answered nothing)
   is quiet, and a card from before these panels existed simply lacks
   the keys — which older payloads already prove. */
{
  const base = {
    ticker: "TEST", row: { close: "100" }, features: null,
    strikes: [], ticks: [], expiries: [], maxPain: [], congress: [],
    surface: [], chain: null, generatedAt: null, sessionDate: "2026-08-28",
    weights: null,
  };
  const dead = buildCard(base).panels;
  for (const key of ["darkpool", "oiDeltas", "volContext"]) {
    eq(dead[key].status, "unavailable",
       `an omitted ${key} raw defaults to a FAILED read — unavailable`);
    ok(dead[key].reason, "with a reason");
    ok(dead[key].note && dead[key].note.length > 60,
       "and the panel's own prose rides even when it is empty");
  }

  const quiet = buildCard({ ...base, darkpool: [], oiDeltas: [], termStructure: [], ivRank: [] }).panels;
  eq(quiet.darkpool.status, "quiet",
     "while a vendor that ANSWERED with nothing is quiet — a different fact, " +
     "worth a different sentence on the page");
  eq(quiet.volContext.status, "quiet", "for the vol context too");

  /* THE HALVES REACH THE SHAPER AS READ. The card coerced a null half to []
     before buildVolContext saw it, so a term read that never landed beside
     a rank that was read empty came out "quiet" — "the feed answered with
     nothing" over a feed that did not answer. */
  const halfDead = buildCard({ ...base, darkpool: [], oiDeltas: [], termStructure: null, ivRank: [] }).panels.volContext;
  eq(halfDead.status, "unavailable",
     "a term half that never landed and a rank half read empty is NOT a quiet panel");
  ok(/term structure could not be read this run/.test(halfDead.reason),
     "and the reason names the half that failed — " + halfDead.reason);
  const halfLive = buildCard({ ...base, darkpool: [], oiDeltas: [],
    termStructure: [{ expiry: "2026-09-18", dte: 21, volatility: "0.3" }], ivRank: null }).panels.volContext;
  eq(halfLive.status, "ok", "one live half is still a panel");
  eq(halfLive.ivRank.status, "unavailable", "whose other half says unavailable for itself, never quiet");
  const garbled = buildCard({ ...base, darkpool: { data: "nope" }, oiDeltas: "x", termStructure: [], ivRank: [] }).panels;
  eq(garbled.darkpool.status, "unreadable", "a malformed dark-pool body is unreadable on the card");
  eq(garbled.oiDeltas.status, "unreadable", "as is a malformed OI body");

  const live = buildCard({
    ...base,
    darkpool: [{ executed_at: "2026-08-28T14:00:00Z", price: "100", size: 1000, premium: "100000" }],
    oiDeltas: [{ option_symbol: "TEST260918C00100000", oi_change: "500", curr_oi: 900 }],
    termStructure: [{ expiry: "2026-09-18", dte: 21, volatility: "0.3", implied_move_perc: "0.041" }],
    ivRank: [{ date: "2026-08-28", volatility: "0.3", iv_rank_1y: "44.0" }],
  }).panels;
  eq(live.darkpool.status, "ok", "a fed dark-pool panel is ok");
  eq(live.darkpool.rows[0].prem, 100000, "with the print's own dollars");
  eq(live.oiDeltas.rows[0].k, 100, "the OI delta's contract comes off the shared parser");
  eq(live.volContext.term.rows[0].impliedMovePerc, 0.041, "and the implied move survives as a number");
  eq(live.volContext.ivRank.rows[0].rank1y, 44, "beside a rank whose unit the payload states");
}


/* ---------- the cohort: who this name was measured against ---------

   A 21-PANEL WORKSPACE THAT COULD NOT NAME ITS OWN CROSS-SECTION. Four
   surfaces print the sentence "sector and log-capitalisation neutralised out
   before ranking", and the page a reader opens to understand ONE name could
   not tell them which cohort that was, how many names were in it, or whether
   this name's sector was so small it was pooled into the reference bucket.

   The question the panel exists to answer is the obvious follow-up to every
   strong reading on the page: is my top long simply the strongest name in a
   sector being bought wholesale? */
{
  const peers = [
    { t: "AAA", s: 71 }, { t: "BBB", s: 12 }, { t: "CCC", s: 3 },
    { t: "DDD", s: 0 },                            // a REAL zero, not an absence
    { t: "EEE", s: -8 }, { t: "GGG", s: -20 },
    { t: "FFF", s: null },                         // absent — must not become a zero
  ];
  const c = buildCohort({ ticker: "AAA", sector: "Technology", peers, pooled: false, minGroup: 3 });

  eq(c.status, "ok", "a cohort with scored peers is ok");
  eq(c.sector, "Technology", "and it NAMES the cohort, which is the panel's entire point");
  eq(c.n, 6,
     "counting the six peers that carried a score. The seventh carried null and was " +
     "DROPPED rather than coerced: Number(null) is 0, zero sits at the centre of the " +
     "dead band, and a phantom zero would drag the median — the one number this panel " +
     "is read for — toward a value nobody measured");
  eq(c.rank, 1, "this name is the strongest in its cohort");
  eq(c.score, 71, "at the score every other surface prints for it");
  eq(c.median, 1.5,
     "against a cohort median of 1.5 — so the name stands out from its own sector rather " +
     "than riding it, which is the answer the panel exists to give");
  eq(c.best, 71, "the cohort's extremes are published");
  eq(c.worst, -20, "signed, so the short end is not folded onto the long");

  /* THE WHOLESALE COUNT, AND THE ZERO THAT BELONGS TO NEITHER SIDE. */
  eq(c.sameSide, 3, "three peers share this name's sign");
  eq(c.otherSide, 2, "two oppose it");
  eq(c.neutral, 1,
     "and the name scoring exactly zero is counted APART — it sits at the centre of the " +
     "dead band and holds no position, so folding it into either side would invent one");
  eq(c.sameSide + c.otherSide + c.neutral, c.n,
     "the three counts partition the cohort exactly, so a reader can check the arithmetic " +
     "rather than take it");

  /* THE MEDIAN'S OFF-BY-ONE, which is the whole of a median. */
  eq(buildCohort({ ticker: "AAA", peers: [{ t: "AAA", s: 10 }, { t: "BBB", s: 4 }] }).median, 7,
     "an even-length cohort takes the mean of its two middle values — a list of two must " +
     "not report its larger member as the median, which is what a naive middle index does");
  eq(buildCohort({ ticker: "AAA", peers: [{ t: "AAA", s: 5 }] }).median, 5,
     "and a cohort of one is its own median");
  eq(buildCohort({ ticker: "AAA", peers: [{ t: "AAA", s: 5 }] }).n, 1,
     "with a size of one, which is itself the finding on that card");

  /* POOLED IS NOT MISSING, AND NULL IS NOT FALSE. */
  eq(c.pooled, false, "a level with enough members is reported as not pooled");
  eq(buildCohort({ ticker: "AAA", peers, pooled: true }).pooled, true,
     "and a pooled level says so — the name WAS adjusted, against a cohort that is not " +
     "its sector, which is the case a reader most needs flagged");
  eq(buildCohort({ ticker: "AAA", peers }).pooled, null,
     "while a caller that said nothing yields NULL, not false. 'This level was not pooled' " +
     "and 'nobody told this panel whether it was' are different facts, and the second must " +
     "not render as the reassuring first");
  eq(buildCohort({ ticker: "AAA", peers, sector: "" }).sector, null,
     "an empty sector label is null rather than an empty string a renderer would print");

  /* THE PEER LIST IS CAPPED AND SAYS SO. */
  const many = Array.from({ length: 40 }, (_, i) => ({ t: "T" + i, s: 40 - i }));
  many.push({ t: "AAA", s: 100 });
  const big = buildCohort({ ticker: "AAA", peers: many });
  eq(big.n, 41, "the cohort's SIZE is the whole cohort");
  eq(big.rows.length, COHORT_ROWS,
     "while the rows carried are capped — a reader who cannot see the names behind the " +
     "median has a number to trust rather than a comparison to check, and forty names is " +
     "not a comparison either");
  eq(big.shown, COHORT_ROWS, "and the payload states the cut rather than leaving it inferred");
  ok(big.n > big.shown, "so the two numbers genuinely differ on this fixture");
  eq(big.rows[0].t, "AAA", "the rows are ordered strongest first");
  eq(big.rank, 1, "and the rank is over the WHOLE cohort, not over the shown slice");

  /* DETERMINISTIC ORDER. Ties broken on the ticker so a re-run of the same
     session builds the same card bytes. */
  const tied = buildCohort({ ticker: "BBB", peers: [
    { t: "CCC", s: 5 }, { t: "AAA", s: 5 }, { t: "BBB", s: 5 }] });
  assert.deepEqual(tied.rows.map((r) => r.t), ["AAA", "BBB", "CCC"],
    "a cohort where every score ties is ordered by ticker, so a re-run writes identical " +
    "bytes rather than whatever the input order happened to be"); checks++;
  eq(tied.rank, 2, "and this name's rank falls out of that same total order");

  /* THE THREE SILENCES, ALL THREE REACHED. */
  const noPeers = buildCohort({ ticker: "AAA" });
  eq(noPeers.status, "unavailable",
     "no peer list at all is UNAVAILABLE — the pool was not carried into the build");
  ok(/score itself is unaffected/.test(noPeers.reason),
     "and the reason says the score is unaffected, because a reader seeing an unavailable " +
     "panel beside a confident +71 needs to know which of the two is in doubt");
  ok(!("n" in noPeers) && !("median" in noPeers),
     "an unavailable panel carries no numbers at all");

  const allNull = buildCohort({ ticker: "AAA", peers: [{ t: "BBB", s: null }, { t: "CCC" }] });
  eq(allNull.status, "quiet",
     "a peer list that ARRIVED and held no scored name is QUIET — measured emptiness, not " +
     "an absent source, and the two are opposite facts about the same blank space");
  ok(!("median" in allNull), "and carries no numbers either");

  const absent = buildCohort({ ticker: "ZZZ", peers });
  eq(absent.status, "quiet",
     "a cohort that was measured but does not contain this name is QUIET rather than an " +
     "error: a card can be built for a name the scorer dropped after the cohort was " +
     "assembled, and inventing a rank for it would be worse than saying so");
  ok(/held 6 name/.test(absent.reason),
     "and the reason still reports the cohort's own size, which is the part that was measured");

  eq(buildCohort({}).status, "unavailable", "no ticker is unavailable, not a throw");

  /* THE NOTES ARE PUBLISHED, because the median's meaning is genuinely
     counter-intuitive and a renderer restating it would be a second copy. */
  ok(COHORT_NOTES.median.length > 40 && /near zero is/.test(COHORT_NOTES.median),
     "the payload carries the note that a median near zero is the ORDINARY outcome of " +
     "neutralisation and not a finding — without it a reader draws a sector call out of " +
     "a number that has had the sector removed from it");
  ok(/reference bucket/.test(COHORT_NOTES.pooled),
     "and the note explaining that a pooled name was adjusted against a cohort that is " +
     "not its sector");
  eq(c.notes, COHORT_NOTES, "the notes ride on the panel rather than on the renderer");
}


/* ---------- the market-wide join: rank, cut, session, coverage ------

   WHAT THIS PANEL IS FOR, and why the tests below are shaped the way they
   are. The card already spends a per-name dark-pool call and a per-name
   open-interest call on every deep name, and neither can answer "compared
   with what" — a request for one name carries no other names in it. The
   pulse leg fetches the two MARKET-WIDE feeds once a run for the market
   page, and joining those onto the cards costs nothing and supplies exactly
   the missing cross-section.

   The three things that would make the panel worse than nothing, each with
   its own block below:

     an absence read as a silence — the feeds are SELECTIONS, and a name
     that is not in one still had open interest and still had prints;

     a rank read as today's — the vendor updates the market-wide
     open-interest feed at about 06:45 ET and this pipeline runs at 05:15,
     so the ranking is usually the PREVIOUS session's;

     a cut-off asserted over a list that is not ordered, or over a list that
     the request never truncated at all. */
{
  const oiRow = (t, change, i) => ({
    option_symbol: `${t}260918C0015${i}000`,
    underlying_symbol: t,
    oi_change: String(change),
    last_oi: 40000,
    curr_oi: 40000 + change,
    curr_date: "2026-08-21", last_date: "2026-08-20",
  });
  /* Descending, as the vendor documents this route to be, so the ordering
     is measurable and the last row is a real threshold. */
  const oiRaw = { data: [
    oiRow("AAA", 9000, 1), oiRow("BBB", 5000, 2), oiRow("AAA", 4000, 3),
    oiRow("CCC", 1000, 4), oiRow("DDD", -2000, 5),
  ] };
  const dpRaw = { data: [
    { ticker: "BBB", premium: "8000000", executed_at: "2026-08-21T19:59:00Z", price: "10", size: 800000 },
    { ticker: "AAA", premium: "3000000", executed_at: "2026-08-21T19:40:00Z", price: "10", size: 300000 },
    { ticker: "EEE", premium: "9000000", executed_at: "2026-08-21T19:02:00Z", price: "10", size: 900000 },
  ] };
  const names = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ"];
  const idx = indexMarketCross({
    oiChange: oiRaw, darkpool: dpRaw,
    limits: { oiChange: 5, darkpool: 100 },
    tickers: names, sessionDate: "2026-08-24",
  });

  /* ---- the ordering is MEASURED, never taken from the documentation ---- */
  eq(measureOrder([9, 5, 4, 1, -2]), "descending", "a falling list is descending");
  eq(measureOrder([1, 2, 3]), "ascending", "and a rising one ascending");
  eq(measureOrder([1, 3, 2]), null, "a list that turns is neither, and says so");
  eq(measureOrder([4, 4, 4]), null,
     "a list of identical values is reported as UNORDERED rather than as descending — it " +
     "satisfies both tests, and the reading that claims least is the honest one");
  eq(measureOrder([9, null, 4]), null,
     "one gap makes the sequence unjudgeable: an ordering measured across a hole is a " +
     "claim about rows nobody read");
  eq(measureOrder([7]), null, "one row is not an order");

  /* ---- and so is the UNIT, against the vendor's own two snapshots ------ */
  eq(measureOiBasis([{ oi_change: "500", curr_oi: 1500, last_oi: 1000 }]).basis, "contracts",
     "a change that reconciles with curr_oi minus last_oi is a CONTRACT COUNT");
  /* The vendor's own published example, verbatim from docs/uw-openapi.yaml:
     oi_change 15.6149… beside curr_oi 35207 and last_oi 2119, which is
     (35207 − 2119) / 2119 — a RATIO, not a count, and 33088 contracts is
     carried separately as oi_diff_plain. Rendering that 15.61 as "+16
     contracts" would be a confident wrong reading of a correct number. */
  eq(measureOiBasis([
    { oi_change: "15.6149126946672959", curr_oi: 35207, last_oi: 2119 },
    { oi_change: "0.21534300646906180330", curr_oi: 33253, last_oi: 27361 },
  ]).basis, "ratio",
     "and the vendor's own documented example reconciles as a RATIO of the previous " +
     "snapshot — the two forms are what this reconciliation exists to tell apart");
  eq(measureOiBasis([{ oi_change: "9", curr_oi: 500, last_oi: 100 }]).basis, null,
     "a change that reconciles as neither resolves to no basis at all, rather than to the " +
     "more plausible-looking of two guesses");
  eq(measureOiBasis([{ oi_change: "5" }]).checked, 0,
     "rows without both snapshots are not checked, and an unchecked row votes for nothing");

  /* ---- the name that placed ------------------------------------------- */
  const a = readCrossFeed(idx.oiChange, "AAA");
  eq(a.status, "ok", "a name inside the feed reads ok");
  eq(a.present, true, "and says so as data");
  eq(a.rank, 1, "its rank is the BEST position it holds, not its last");
  eq(a.population, 5, "and the rank travels with the population it sits inside");
  eq(a.count, 2, "with the number of its own rows in the feed, so one line and a whole book " +
     "are not the same reading");
  eq(a.value, 9000, "the value it ranked on is published");
  eq(a.unit, "contracts", "with its unit");
  eq(a.unitOne, "contract", "and the singular that agrees with a value of one");
  eq(a.kind, "count", "and the kind a renderer needs to format it at all");

  /* ---- the name that did not, which is a MEASURED absence ------------- */
  const f = readCrossFeed(idx.oiChange, "FFF");
  eq(f.status, "quiet",
     "a name the feed was READ without finding is QUIET, not unavailable: the request " +
     "succeeded and the market answered, and only the third silence is a fact about the market");
  eq(f.present, false, "and it is present:false rather than a missing key");
  eq(f.population, 5, "the absence still carries the population it was measured against");
  eq(f.cut, -2000, "and the value the last place actually held, so a near miss and a name " +
     "nowhere near it are different readings on the page");
  eq(f.ordered, "descending", "which is only a cut-off because the ordering was measured");
  eq(f.capped, true,
     "and the feed FILLED the five rows this call asked for, so the name really was below a cut");
  ok(/did not/.test(f.reason) === false && /is not in/.test(f.reason),
     "the sentence states the absence without claiming the name was quiet");
  ok(/selection, not about this name's own/.test(f.reason),
     "and says outright that this is a fact about a market-wide selection rather than " +
     "about the name — the reading that turns 'not extreme today' into 'nothing happened' " +
     "is the one this panel exists to prevent");
  ok(!("rank" in f) && !("value" in f),
     "a name outside the feed carries NO rank and NO value: a rank of zero or a value of " +
     "zero would be the confident-zero defect wearing a cross-section's clothes");

  /* ---- a list nothing was cut from is not a cut ------------------------ */
  const loose = indexMarketCross({
    oiChange: oiRaw, darkpool: dpRaw,
    limits: { oiChange: 100, darkpool: 100 },
    tickers: names, sessionDate: "2026-08-24",
  });
  eq(loose.oiChange.capped, false,
     "five rows against a request for a hundred is a feed that was not truncated by this run");
  ok(/fewer rows than the 100 requested/.test(readCrossFeed(loose.oiChange, "FFF").reason),
     "and the absence says so, because 'below the cut' would assert a threshold this run " +
     "never imposed");

  /* ---- the recency feed's cut is a TIME, not a size ------------------- */
  const dp = readCrossFeed(idx.darkpool, "AAA");
  eq(dp.ordered, "descending", "the print feed came back newest first");
  eq(dp.orderedBy, "execution time, newest first",
     "and the ordering is named, because a rank inside a recency list means something " +
     "entirely different from a rank inside a size list");
  eq(dp.cut, null, "so there is no dollar cut-off to quote");
  eq(dp.cutAt, "2026-08-21T19:02:00Z",
     "and the cut is the TIME the market-wide window reaches back to — the fact that " +
     "actually decides whether a name could have been in it");
  eq(dp.kind, "money", "the print's size is money");
  eq(dp.at, "2026-08-21T19:40:00Z", "and its own print carries the stamp it was ranked at");

  /* ---- the timing trap, in all three of its states ------------------- */
  eq(idx.oiChange.asOf, "2026-08-21", "the feed publishes the session ITS OWN ROWS describe");
  eq(idx.oiChange.asOfStated, true, "and says that it stated one");
  eq(idx.oiChange.sameSession, false,
     "which is NOT the session the cards describe — the vendor updates this feed at about " +
     "06:45 ET and this pipeline runs at 05:15, so a live join is normally a prior " +
     "session's cross-section laid onto today's per-name data");
  const sameDay = indexMarketCross({
    oiChange: oiRaw, darkpool: dpRaw, limits: { oiChange: 5 },
    tickers: names, sessionDate: "2026-08-21",
  });
  eq(sameDay.oiChange.sameSession, true, "a feed dated to the card's own session says so");
  const undated = indexMarketCross({
    oiChange: { data: oiRaw.data.map((r) => ({ ...r, curr_date: undefined })) },
    darkpool: dpRaw, limits: { oiChange: 5 },
    tickers: names, sessionDate: "2026-08-24",
  });
  eq(undated.oiChange.asOfStated, false, "a feed that states no date of its own says THAT");
  eq(undated.oiChange.sameSession, null,
     "and sameSession is NULL, never false: 'this ranking is from another session' and " +
     "'nobody said which session this ranking is from' are different facts, and the " +
     "second must not render as the first");
  eq(readCrossFeed(undated.oiChange, "AAA").asOf, null,
     "the per-name reading carries the refusal too, rather than borrowing the card's date");

  /* ---- A PRINT'S SESSION IS ITS EASTERN DAY, NOT ITS UTC ONE ---------

     Off-exchange prints are reported to 20:00 ET. Under EST every print after
     19:00 ET carries a UTC date one day AHEAD of its own Eastern session —
     and /darkpool/recent at a 05:15 ET run returns exactly those newest rows.
     This took isoDay(executed_at), the first ten characters of the instant,
     and compared it against a sessionDate resolved in America/New_York: the
     feed dated itself to TOMORROW and every card said "this ranking is from
     another session" about prints from its own. */
  const lateEve = indexCrossFeed("darkpool", { data: [
    { ticker: "AAA", premium: 900000, executed_at: "2026-01-06T00:10:00Z" },  // 19:10 ET Jan 5
    { ticker: "BBB", premium: 800000, executed_at: "2026-01-06T00:45:00Z" },  // 19:45 ET Jan 5
  ] }, { limit: 2, tickers: ["AAA", "BBB"], sessionDate: "2026-01-05" });
  eq(lateEve.asOf, "2026-01-05",
     "a print executed 19:10 ET belongs to that evening's session, though its UTC stamp " +
     "reads the next day — the ISO prefix of an instant is not its Eastern day");
  eq(lateEve.sameSession, true,
     "so a feed made entirely of late prints IS this card's session, and the page no " +
     "longer disowns rows that are its own");
  eq(lateEve.asOfSessions, 1,
     "and they span ONE session, not two — the count that would have printed " +
     "'its rows span 2 sessions' over a feed inside a single evening");
  /* The summer half, because a fixed offset would pass the winter case alone. */
  const summerEve = indexCrossFeed("darkpool", { data: [
    { ticker: "AAA", premium: 900000, executed_at: "2026-07-07T00:10:00Z" },  // 20:10 ET Jul 6
  ] }, { limit: 1, tickers: ["AAA"], sessionDate: "2026-07-06" });
  eq(summerEve.asOf, "2026-07-06",
     "and the same holds under EDT, so the answer is read through the zone rather than " +
     "an offset that is right for half the year");

  /* ---- THE CUT IS THE FLOOR IN BOTH DIRECTIONS ------------------------

     measureOrder tells ascending from descending so a threshold is claimed
     only where one exists, and both branches then took the LAST row of the
     array regardless. On an ascending feed the last row is the MAXIMUM, so
     the largest value in the feed was published as the floor everything else
     cleared. /api/market/oi-change takes an `order` parameter, so this is a
     shape the endpoint can actually return. */
  const mkOi = (v) => ({ underlying_symbol: "AAA", option_symbol: "AAA260918C00150000",
                         oi_change: String(v), oi_diff_plain: v, curr_oi: 100 + v,
                         last_oi: 100, curr_date: "2026-08-21" });
  const desc = indexCrossFeed("oiChange",
    { data: [199, 196, 193, 190].map(mkOi) },
    { limit: 4, tickers: ["AAA"], sessionDate: "2026-08-21" });
  const asc = indexCrossFeed("oiChange",
    { data: [190, 193, 196, 199].map(mkOi) },
    { limit: 4, tickers: ["AAA"], sessionDate: "2026-08-21" });
  eq(desc.ordered, "descending", "a feed running downwards is measured as such");
  eq(asc.ordered, "ascending", "and one running upwards as such — the reason to measure");
  eq(desc.cut, 190, "the cut is the last-included value in ranked order");
  eq(asc.cut, 190,
     "which on an ASCENDING feed is the first row, not the last: publishing 199 there " +
     "would announce the feed's own maximum as the floor everything cleared");
  const noOrder = indexCrossFeed("oiChange",
    { data: [190, 199, 193, 196].map(mkOi) },
    { limit: 4, tickers: ["AAA"], sessionDate: "2026-08-21" });
  eq(noOrder.ordered, null, "a feed in no measurable order says so");
  eq(noOrder.cut, null,
     "and publishes NO cut, because a value from an arbitrary position is not a threshold");

  /* ---- the three silences, at the feed level -------------------------- */
  eq(indexCrossFeed("oiChange", undefined, { tickers: names }).status, "unavailable",
     "a feed the run never carried in is unavailable");
  eq(indexCrossFeed("oiChange", { __failed: "HTTP 500" }, { tickers: names }).status, "unavailable",
     "and so is one whose fetch threw");
  ok(/HTTP 500/.test(indexCrossFeed("oiChange", { __failed: "HTTP 500" }, {}).reason),
     "with the vendor's own reason carried through rather than paraphrased");
  const emptyFeed = indexCrossFeed("darkpool", { data: [] },
    { limit: 100, tickers: names, sessionDate: "2026-08-24" });
  eq(emptyFeed.status, "quiet",
     "a feed that ANSWERED and held nothing is quiet — the request worked and the market " +
     "was silent, which is the one arm of the three that is a reading");
  eq(emptyFeed.coverage.in, 0,
     "the INDEX's coverage is a measured zero rather than an absent count");
  ok(/none missed it/.test(readCrossFeed(emptyFeed, "AAA").reason),
     "and a name's reading against an empty feed says nobody made it and nobody missed it, " +
     "which is not the same sentence as missing a cut");

  /* ---- never a confident zero at the row level ------------------------ */
  const gappy = indexCrossFeed("oiChange", { data: [
    { underlying_symbol: "AAA", oi_change: null, curr_oi: 10, last_oi: 5 },
    { underlying_symbol: "BBB", oi_change: "300", curr_oi: 305, last_oi: 5 },
  ] }, { limit: 100, tickers: ["AAA", "BBB"] });
  eq(gappy.population, 1,
     "a row whose change the vendor did not publish is counted OUT of the population, not " +
     "carried at zero — Number(null) is 0 and a zero here would rank a name on a reading " +
     "nobody took");
  eq(readCrossFeed(gappy, "AAA").present, false,
     "so the name with the unpublished change reads as not in the feed rather than as a " +
     "contract change of nothing");

  /* ---- the panel, and its own three arms ------------------------------ */
  const panel = buildMarketCross(idx, "AAA", { asOf: "2026-08-24" });
  eq(panel.status, "ok", "the panel is ok when at least one feed was measured");
  eq(panel.asOf, "2026-08-24", "and carries the session the CARD describes");
  eq(panel.feeds.oiChange.rank, 1, "with each feed's own reading under its own key");
  eq(panel.coverage.oiChange.of, 10, "and the coverage of the join across the deep names");
  ok(!("coverage" in panel.feeds.oiChange),
     "which lives on the PANEL and not on each feed reading: how far the join reached is a " +
     "fact about the join, identical on all fifty cards, and the same number in two places " +
     "on one payload is two numbers that will eventually stop agreeing");
  eq(panel.coverage.oiChange.in, 4,
     "measured, not asserted: four of the ten names carded appear in this feed");
  eq(panel.coverage.darkpool.in, 3, "and three of them in the print feed");
  eq(panel.notes, CROSS_NOTES, "the prose rides on the payload, since shared/ never reaches a browser");

  eq(buildMarketCross(null, "AAA").status, "unavailable",
     "no index at all is an unavailability, not an absence of market activity");
  const bothDown = buildMarketCross({
    oiChange: indexCrossFeed("oiChange", { __failed: "timeout" }, {}),
    darkpool: indexCrossFeed("darkpool", null, {}),
  }, "AAA");
  eq(bothDown.status, "unavailable", "and so is a run where neither feed could be read");
  const halfDown = buildMarketCross({
    oiChange: idx.oiChange,
    darkpool: indexCrossFeed("darkpool", { __failed: "timeout" }, {}),
  }, "AAA");
  eq(halfDown.status, "ok",
     "but ONE feed down and one read is an ordinary run, and the reader gets the half " +
     "that exists rather than a blank panel");
  eq(halfDown.feeds.darkpool.status, "unavailable", "with the dead half saying which it is");

  /* ---- and it is on the card the pipeline builds --------------------- */
  /* The thinnest card that can be built: this block is about the panel
     reaching card.panels at all, and every other input is already exercised
     by the source-ablation sweep above. */
  const bare = { ticker: "AAA", row: { close: "100" }, features: {}, sessionDate: "2026-08-24" };
  eq(buildCard({ ...bare, marketCross: idx }).panels.marketRank.status, "ok",
     "buildCard mounts the join as a panel of its own");
  eq(buildCard({ ...bare, marketCross: idx }).panels.marketRank.feeds.oiChange.rank, 1,
     "carrying this name's own reading rather than the whole index");
  eq(buildCard(bare).panels.marketRank.status, "unavailable",
     "and a card built without the index says so rather than omitting the key, which is " +
     "what lets a renderer tell a failed run from a card that predates the join");

  /* ---- the notes carry the refusals, in the payload's own words ------- */
  ok(/SELECTIONS/.test(CROSS_NOTES.absence),
     "the payload states in words that these lists are selections rather than the market");
  ok(/exchange-traded-fund/.test(CROSS_NOTES.absence),
     "and names the exclusion the vendor documents — the open-interest list carries no index " +
     "or fund contracts, so a fund's absence from it is a fact about the list's construction " +
     "and not a reading of the fund");
  ok(/06:45/.test(CROSS_NOTES.timing) && /05:15/.test(CROSS_NOTES.timing),
     "and names both clocks, which is the whole of the timing trap");
  ok(/population/.test(CROSS_NOTES.rank),
     "and says a rank is meaningless without the population beside it");
}

console.log(`✓ flows-card: ${checks} assertions — numOrNull discipline, field polarity, ATR-normalised levels, dealer-signed gamma, cumulated path, dated gross roll-off, a priced band that is never a forecast, a full source-ablation sweep, wave-2 panels holding the three-silences boundary, a cohort panel that finally names the cross-section the score was neutralised against, and a market-wide join whose ordering and unit are MEASURED rather than assumed, whose absences are quiet with the cut they missed, and whose rank never claims the session it was not read in`);
