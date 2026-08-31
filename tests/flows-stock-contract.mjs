/* =============================================================
   flows-stock-contract.mjs — the wave-2 per-name feeds, shaped.

   Shapes were established by live probe (2026-08-31 15:35 UTC run,
   first-row key dumps), not by the vendor's spec, and these
   contracts pin the reading discipline that history demands:
   absent is absent (never a confident zero), rankings are claimed
   only where every ranked row carries the ranking key, vendor
   selections stay in vendor order, the rank unit travels with the
   number (the "1352% of its year" scar), and one dead feed cannot
   take its neighbour panel down.
   ============================================================= */

import assert from "node:assert/strict";
import {
  shapeStockDarkpool, shapeStockOiChange, shapeTermStructure, shapeIvRank,
  buildVolContext, STOCK_CAPS, STOCK_NOTES,
} from "../shared/flows-stock.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* ---------- §1 prints ranked by a key every kept row carries ----- */
{
  const dp = shapeStockDarkpool({ data: [
    { executed_at: "2026-08-28T14:00:00Z", price: "10", size: 100, premium: "1000" },
    { executed_at: "2026-08-28T15:00:00Z", price: "10", size: 900, premium: "9000" },
    { executed_at: "2026-08-28T13:00:00Z", price: "10", size: 500 },        // unpriced
    { executed_at: "2026-08-28T12:00:00Z" },                                 // measures nothing
  ] });
  deep(dp.rows.map((r) => r.prem), [9000, 1000],
    "prints rank by their own dollar size, descending — an ordering this payload " +
    "CAN claim because every kept row carries the key");
  eq(dp.unpriced, 1,
    "a print without a premium is counted out rather than seated at the bottom — " +
    "ranking it would place it by a number it lacks");
  eq(dp.rows[0].canceled, null, "an absent cancel flag is null, never a confident no");
  eq(dp.seen, 2, "seen counts the ranked rows");

  const two = shapeStockDarkpool([
    { executed_at: "B", price: 1, size: 1, premium: 100 },
    { executed_at: "A", price: 1, size: 9, premium: 100 },
  ]);
  deep(two.rows.map((r) => r.at), ["A", "B"],
    "ties break on time then size — total, so one response shapes to one byte string");
}

/* ---------- §2 OI deltas: vendor order, contract from one parser - */
{
  const oi = shapeStockOiChange([
    { option_symbol: "AAPL260918C00150000", oi_change: "50", curr_oi: 10,
      days_of_oi_increases: 4, days_of_vol_greater_than_oi: 2 },
    { option_symbol: "AAPL260918P00140000", oi_change: "-900", curr_oi: 99 },
    { option_symbol: "unparseable", oi_change: "5" },
    { option_symbol: "AAPL261218C00160000" },                     // no change value
  ]);
  deep(oi.rows.map((r) => r.change), [50, -900],
    "VENDOR ORDER PRESERVED — the selection is the vendor's, and |change| " +
    "re-sorting would claim a rule this payload cannot state (the fixture's " +
    "order differs from magnitude order on purpose)");
  eq(oi.rows[0].cp, "C", "side comes off the option symbol through the shared parser");
  eq(oi.rows[0].oiUpDays, 4, "the per-name streak counters ride when sent");
  eq(oi.rows[1].oiUpDays, null, "and are null when not sent — not zero streaks");
  eq(oi.seen, 2, "rows without a parseable contract or a change are dropped, not dashed");
}

/* ---------- §3 the volatility context ---------------------------- */
{
  const term = shapeTermStructure([
    { expiry: "2026-10-16", dte: 46, volatility: "0.31", implied_move: "12.5", implied_move_perc: "0.055" },
    { expiry: "2026-09-04", dte: 4, volatility: "0.45" },
  ]);
  deep(term.rows.map((r) => r.expiry), ["2026-09-04", "2026-10-16"],
    "the term curve sorts onto the calendar — ours to claim");
  eq(term.rows[0].impliedMove, null, "a missing implied move is null beside a real vol");

  const rank = shapeIvRank([
    { date: "2026-08-27", volatility: "0.3", iv_rank_1y: "57.5" },
    { date: "2026-08-28", volatility: "0.32" },
  ]);
  eq(rank.rows[0].date, "2026-08-28", "the rank series is newest first");
  eq(rank.rows[0].rank1y, null, "a day the vendor sent no rank is a gap, not a zero rank");
  ok(/0-100/.test(rank.rankUnit),
    "THE UNIT TRAVELS WITH THE NUMBER: this vendor's rank fields have burned a " +
    "“1352% of its year” once already, so the payload states the scale " +
    "instead of leaving the renderer to guess it");

  const half = buildVolContext([{ expiry: "2026-09-04", volatility: "0.4" }], []);
  eq(half.status, "ok",
    "a name with a curve but no rank history is HALF a panel, not an unavailable one");
  eq(half.ivRank.status, "quiet", "with the missing half saying quiet for itself");
  eq(buildVolContext([], []).status, "quiet", "and both empty is a quiet panel");
}

/* ---------- §4 caps shed with the shed counted ------------------- */
{
  const many = Array.from({ length: STOCK_CAPS.oiDeltas + 6 }, (_, i) => ({
    option_symbol: `AAPL260918C${String((100 + i) * 1000).padStart(8, "0")}`,
    oi_change: String(1000 - i),
  }));
  const built = shapeStockOiChange(many);
  eq(built.rows.length, STOCK_CAPS.oiDeltas, "the cap holds");
  eq(built.shed, 6, "with the shed counted beside what was kept");
  eq(built.cap, STOCK_CAPS.oiDeltas, "and the cap itself published");
}

/* ---------- §5 determinism and junk ------------------------------ */
{
  const raws = [{ executed_at: "T", price: 2, size: 3, premium: 6 }];
  eq(JSON.stringify(shapeStockDarkpool(raws)), JSON.stringify(shapeStockDarkpool(raws)),
    "two shapes over one response are byte-identical");
  eq(shapeStockDarkpool(null).status, "quiet", "junk input is quiet, not a throw");
  eq(shapeIvRank({ data: "nope" }).status, "quiet", "as is a malformed envelope");
}

/* ---------- §6 the vocabulary holds ------------------------------ */
{
  const IDENTITY = /\b(whale|smart money|institutional|bought|sold|buyer|seller|paid)\b/gi;
  const EXECUTION = /\b(trade|trades|print|prints)\b/gi;
  for (const [key, text] of Object.entries(STOCK_NOTES)) {
    IDENTITY.lastIndex = 0;
    const idHit = IDENTITY.exec(text);
    ok(!idHit, `notes.${key} says "${idHit && idHit[1]}" — an identity/intent claim no feed supports`);
    if (key !== "darkpool") {
      EXECUTION.lastIndex = 0;
      const exHit = EXECUTION.exec(text);
      ok(!exHit, `notes.${key} says "${exHit && exHit[1]}" — execution words belong to the dark ` +
        "pool panel alone, whose rows really are reported executions");
    }
  }
  ok(/a day late/.test(STOCK_NOTES.oiDeltas),
    "the OI panel's headline caveat — a settled fact a day late — is stated in words");
  ok(/(none of it is|not) a forecast/.test(STOCK_NOTES.volContext),
    "and the vol panel refuses the forecast reading in words");
}

console.log(`✓ flows-stock: ${checks} assertions — prints ranked only by a key every row carries ` +
  `with the unpriced counted out, vendor order preserved on the vendor's selection, streak ` +
  `counters that are null rather than zero when unsent, a rank unit that travels with its ` +
  `number, a half-empty vol panel that stays ok, caps with counted shed, byte-identical ` +
  `rebuilds, and notes holding the execution-word line at the dark pool boundary`);
