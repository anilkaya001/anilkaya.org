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

console.log(`✓ flows-card: ${checks} assertions — numOrNull discipline, field polarity, ATR-normalised levels, dealer-signed gamma, cumulated path, dated gross roll-off, a priced band that is never a forecast, a full source-ablation sweep, and wave-2 panels holding the three-silences boundary`);
