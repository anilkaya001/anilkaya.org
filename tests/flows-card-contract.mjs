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
  numOrNull, polarityOf, POLARITY, pickMaxPain, CARD_SCHEMA_VERSION,
} from "../shared/flows-card.js";

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
     "the panel claims no return: congress-trader has no pagination, so a member's " +
     "history cannot be walked, and a disclosure has no paired closing print");

  eq(buildCongress([]).status, "unavailable", "no filings is unavailable, not zero buyers");
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
    features: { spot: 100, atr: 4, gammaFlip: 96, netGamma: -8e8, gRegime: "short",
                score: 71, conviction: 64, fam: { F: 60, P: -20, D: 30, V: 5, O: -5 } },
    strikes: [{ strike: "95", call_gamma_ask: "0.6e8", call_gamma_bid: "0.4e8",
                put_gamma_ask: "-2.4e8", put_gamma_bid: "-1.6e8" },
              { strike: "105", call_gamma_ask: "4e8", call_gamma_bid: "3e8",
                put_gamma_ask: "-0.6e8", put_gamma_bid: "-0.4e8" }],
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
  eq(complete.sessionDate, "2026-08-24",
     "THE SESSION, not the run date: a pre-open job reads the previous completed session");
  ok(complete.generatedAt !== complete.sessionDate, "the two dates are distinct fields");
  eq(complete.gammaFlip, 96,
     "the flip price is a top-level field — the gamma panel draws its line from it");
  eq(complete.atr, 4, "and ATR travels with it, so distances can be shown in sigma");
  eq(buildCard({ ...full, features: null }).gammaFlip, null,
     "with no features the flip is null, never 0 — 'spot is exactly at the flip' " +
     "is the most actionable state on the card and must never be manufactured");
  for (const key of ["gamma", "levels", "path", "congress"]) {
    eq(complete.panels[key].status, "ok", `panel ${key} resolves when every source is present`);
  }

  const SOURCES = ["strikes", "ticks", "maxPain", "congress", "features", "row"];
  const PANEL_OF = { strikes: "gamma", ticks: "path", congress: "congress" };

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
        eq(card.panels[panel].status, "unavailable",
           `panel ${panel} reports unavailable when ${source} is missing`);
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
        ok(p.status === "ok" || p.status === "unavailable",
           `every panel is a tagged union with ${source} missing`);
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
  const noCongress = buildCard({ ...full, congress: [] });
  ok(!("buys" in noCongress.panels.congress),
     "a failed congress fetch reports unavailable, never '0 congressional buyers'");
}

console.log(`✓ flows-card: ${checks} assertions — numOrNull discipline, field polarity, ATR-normalised levels, dealer-signed gamma, cumulated path, honest congress panel, and a full source-ablation sweep`);
