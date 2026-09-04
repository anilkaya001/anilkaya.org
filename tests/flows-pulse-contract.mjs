/* =============================================================
   flows-pulse-contract.mjs — seven market-wide feeds, one key.

   WHAT IS WORTH ASSERTING. The pulse pools seven vendor feeds whose
   shapes come from a spec that marks half its own fields "ToBeDone",
   so the expensive defects are the quiet ones this repo keeps
   meeting:

     - Number(null) === 0 minting confident zeros out of absent fields;
     - one failed feed sinking six healthy neighbours;
     - a capped list read as the population because the shed went
       uncounted;
     - a vendor ranking re-sorted into an ordering claim the payload
       cannot state;
     - prose drifting into intent/identity claims no feed supports.

   The envelope test matters doubly here because TWO writers share
   this schema: the nightly pipeline publishes the whole pulse and
   the worker cron re-publishes the tide intraday, and both go
   through these same shapers.
   ============================================================= */

import assert from "node:assert/strict";
import {
  shapeTide, shapeTotals, shapeOiChange, shapeNetImpact, shapeInsiders,
  shapeDarkpool, shapeSeasonality, buildPulse, unwrapRows,
  PULSE_FEEDS, PULSE_CAPS, PULSE_NOTES,
} from "../shared/flows-pulse.js";
import { REFRESH_CADENCE_MINUTES } from "../shared/flows-freshness.js";
import { readFileSync } from "node:fs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

/* ---------- §1 the envelope is ambiguous and both shapes are read */
{
  const bare = shapeNetImpact([{ ticker: "AAA", net_premium: 5 }]);
  const wrapped = shapeNetImpact({ data: [{ ticker: "AAA", net_premium: 5 }] });
  deep(bare.rows, wrapped.rows,
    "a bare array and a {data:[...]} envelope shape identically — the vendor's " +
    "own spec declares one and demonstrates the other");
  deep(unwrapRows(null), [], "and a non-response is an empty read, not a throw");
  deep(unwrapRows({ data: "nope" }), [], "as is an envelope holding no array");
}

/* ---------- §2 absent is absent, measured zero is a measurement -- */
{
  const tide = shapeTide([
    { timestamp: "2026-08-24T13:30:00Z", net_call_premium: "1000", net_put_premium: null, net_volume: 5 },
    { timestamp: "2026-08-24T13:35:00Z", net_call_premium: "0", net_put_premium: "250" },
  ]);
  eq(tide.points[0].putPrem, null,
    "an absent leg stays null — Number(null) is 0 and a confident zero is the house defect");
  eq(tide.points[1].callPrem, 0, "while a MEASURED zero survives as a zero");
  eq(tide.points[1].vol, null, "and a missing key is null, not NaN, not 0");

  const dp = shapeDarkpool({ data: [{ ticker: "AAA", price: "12.5", size: 100 }] });
  eq(dp.rows[0].canceled, null,
    "a flag the vendor did not carry is null, never a confident false");

  const empty = shapeTide([{ timestamp: "2026-08-24T13:30:00Z" }]);
  eq(empty.status, "quiet",
    "a point measuring nothing is dropped, and a feed of only such points is quiet");
}

/* ---------- §3 caps shed with the shed counted ------------------- */
{
  const many = Array.from({ length: PULSE_CAPS.netImpact + 9 }, (_, i) => ({
    ticker: "T" + i, net_premium: 1000 - i,
  }));
  const built = shapeNetImpact(many);
  eq(built.rows.length, PULSE_CAPS.netImpact, "the cap holds");
  eq(built.shed, 9, "and what it removed is counted beside what it kept");
  eq(built.cap, PULSE_CAPS.netImpact, "with the cap itself published");
  eq(built.rows[0].t, "T0",
    "VENDOR ORDER PRESERVED: the ranking is the vendor's selection and re-sorting " +
    "would claim an ordering rule this payload cannot state");
}

/* ---------- §4 a series sheds its OLDEST buckets ----------------- */
{
  const pts = Array.from({ length: PULSE_CAPS.tide + 5 }, (_, i) => ({
    timestamp: "T" + String(i).padStart(4, "0"), net_volume: i,
  }));
  const tide = shapeTide(pts);
  eq(tide.points.length, PULSE_CAPS.tide, "the tide cap holds");
  eq(tide.points[tide.points.length - 1].vol, PULSE_CAPS.tide + 4,
    "and the survivors are the NEWEST buckets — a time series that shed its tail " +
    "would show a session that ended at lunchtime");
  eq(tide.shed, 5, "with the shed counted");
}

/* ---------- §5 orderings that ARE this payload's to claim -------- */
{
  const season = shapeSeasonality([{ month: 9, avg_change: 1 }, { month: 2, avg_change: 2 }]);
  deep(season.rows.map((r) => r.month), [2, 9],
    "months sort onto the calendar — the one natural total order here");

  const totals = shapeTotals([{ date: "2026-08-01", call_volume: 1 }, { date: "2026-08-03", call_volume: 2 }]);
  eq(totals.rows[0].date, "2026-08-03", "sessions sort newest first");

  const ins = shapeInsiders({ data: [{ filing_date: "2026-08-01", purchases: 1 }, { filing_date: "2026-08-04", sells: 2 }] });
  eq(ins.rows[0].date, "2026-08-04", "filing days sort newest first");
}

/* ---------- §6 the contract column derives from the symbol ------- */
{
  /* THE FIXTURE USED TO WRITE oi_change: "250" AS THOUGH IT WERE A COUNT,
     which is the misreading the shaper had and the reason no suite here
     caught it: a test built on the same wrong model cannot see the defect.
     The numbers below are the vendor's own example (docs/uw-openapi.yaml),
     where oi_change is (curr-last)/last and the contract difference rides
     separately as oi_diff_plain. */
  const oi = shapeOiChange([{
    option_symbol: "AAPL260918C00150000",
    oi_change: "15.6149126946672959", oi_diff_plain: 33088,
    curr_oi: 35207, last_oi: 2119,
  }]);
  eq(oi.rows[0].diff, 33088, "the CONTRACT difference is published from oi_diff_plain");
  eq(oi.rows[0].ratio, 15.6149126946672959, "and the ratio under its own name");
  ok(Math.abs(oi.rows[0].ratio - (35207 - 2119) / 2119) < 1e-9,
     "the ratio reconciles with the two snapshots on the same row, which is what makes " +
     "it a ratio rather than a difference — reconstructed here so the two fields can " +
     "never be silently swapped back");
  ok(!("change" in oi.rows[0]),
     "and the name that meant both things is gone rather than kept as an alias, because " +
     "an alias is how a renderer keeps reading the wrong one");
  /* NEITHER READING IS DERIVED FROM THE OTHER. curr-last would give the same
     number, but one field carrying two provenances is the confusion being
     fixed, so an absent count stays absent. */
  const noDiff = shapeOiChange([{
    option_symbol: "AAPL260918C00150000", oi_change: "0.5", curr_oi: 30, last_oi: 20,
  }]);
  eq(noDiff.rows[0].diff, null,
     "a row the vendor sent no oi_diff_plain for publishes no count — not curr minus last");
  eq(noDiff.rows[0].ratio, 0.5, "while the ratio it did send is still published");
  const noRatio = shapeOiChange([{
    option_symbol: "AAPL260918C00150000", oi_diff_plain: 10, curr_oi: 30, last_oi: 20,
  }]);
  eq(noRatio.rows[0].diff, 10, "and a row with only the count keeps it");
  eq(noRatio.rows[0].ratio, null, "with the ratio absent rather than computed");
  eq(shapeOiChange([{ option_symbol: "AAPL260918C00150000", curr_oi: 30 }]).status, "quiet",
     "a row carrying NEITHER reading measures nothing and is dropped");
  eq(oi.rows[0].t, "AAPL", "the underlying falls out of the symbol when the vendor omits it");
  eq(oi.rows[0].cp, "C", "and so do side");
  eq(oi.rows[0].k, 150, "strike");
  eq(oi.rows[0].exp, "2026-09-18", "and expiry — one parser, one spelling of one relation");
  eq(shapeOiChange([{ option_symbol: "garbage", oi_change: "5" }]).status, "quiet",
    "a row with no derivable underlying is dropped, not published as a dash-ticker");
}

/* ---------- §7 one failed feed cannot sink six neighbours -------- */
{
  const pulse = buildPulse({
    tide: [{ timestamp: "2026-08-24T13:30:00Z", net_volume: 3 }],
    totals: { __failed: "HTTP 500 from the vendor" },
    /* oiChange deliberately not supplied at all */
    netImpact: [{ ticker: "AAA", net_premium: 9 }],
    insiders: "not even an object",
    darkpool: { data: [] },
    seasonality: [{ month: 1, avg_change: 0.5 }],
  });
  eq(pulse.tide.status, "ok", "a healthy feed shapes");
  eq(pulse.totals.status, "unavailable", "a failed fetch publishes unavailable");
  ok(/HTTP 500/.test(pulse.totals.reason), "with the reason it carried");
  eq(pulse.oiChange.status, "unavailable", "a feed never fetched says so");
  eq(pulse.oiChange.reason, "not fetched", "in its own words");
  eq(pulse.netImpact.status, "ok", "and the neighbours are untouched by any of it");
  eq(pulse.insiders.status, "quiet", "junk shapes to quiet rather than throwing");
  eq(pulse.darkpool.status, "quiet", "an empty answer is measured emptiness");
  eq(pulse.notes, PULSE_NOTES, "and the notes ride the payload whatever the feeds did");
  for (const f of PULSE_FEEDS) ok(pulse[f], `every declared feed (${f}) is present in the composite`);
}

/* ---------- §8 determinism: one response, identical bytes -------- */
{
  const raws = {
    tide: [{ timestamp: "a", net_volume: 1 }],
    totals: [{ date: "2026-08-01", call_volume: 2 }],
    oiChange: [{ option_symbol: "AAPL260918C00150000", oi_change: 1 }],
    netImpact: [{ ticker: "B", net_premium: 2 }],
    insiders: [{ filing_date: "2026-08-01", purchases: 1 }],
    darkpool: [{ ticker: "C", price: 1, size: 1 }],
    seasonality: [{ month: 3, avg_change: 1 }],
  };
  eq(JSON.stringify(buildPulse(raws)), JSON.stringify(buildPulse(raws)),
    "two builds over one response publish identical bytes");
}

/* ---------- §9 the vocabulary holds, with ONE argued exception ---
   The dark pool rows are reported equity executions, so "trade" and
   "print" are accurate THERE and only there. Everywhere else the
   feeds are aggregates and vendor selections, and the flow-alerts
   precedent applies unweakened. Identity and intent words are banned
   everywhere including the dark pool. */
{
  const IDENTITY = /\b(whale|smart money|institutional|bought|sold|buyer|seller|paid)\b/gi;
  const EXECUTION = /\b(trade|trades|print|prints)\b/gi;
  for (const [key, text] of Object.entries(PULSE_NOTES)) {
    IDENTITY.lastIndex = 0;
    const idHit = IDENTITY.exec(text);
    ok(!idHit, `notes.${key} says "${idHit && idHit[1]}" — an identity/intent claim no feed here supports`);
    if (key !== "darkpool") {
      EXECUTION.lastIndex = 0;
      const exHit = EXECUTION.exec(text);
      ok(!exHit, `notes.${key} says "${exHit && exHit[1]}" — execution words belong only to the ` +
        "dark pool feed, whose rows really are reported executions");
    }
  }
  ok(/vendor/.test(PULSE_NOTES.oiChange) && /vendor/.test(PULSE_NOTES.netImpact),
    "the two ranked feeds both name the vendor as the selector — the headline caveat");
  ok(/no forecast|never a forecast|carries no claim/i.test(PULSE_NOTES.tide + " " + PULSE_NOTES.seasonality),
    "and the two series feeds refuse the forecast reading in words");
}


/* ---------- the cadence rides on the payload ----------------------

   assets/js/flows-market.js decides whether this feed's stamp is still worth
   believing — one cadence plus one cadence of slack, because a cron that fired
   late is not yet a cron that stopped firing — and to do that it needs the
   number the Worker's cron is actually configured for. It could not import the
   shared module, because shared/ is not served to the browser, so it declared
   its own copy under a comment naming the problem and the fix: "this constant
   mirrors it and this comment is the only link between them. The right end
   state is the pulse payload carrying its own cadence."

   A constant duplicated across a boundary with a comment for a link is a
   constant that will eventually disagree with itself, and this one fails in
   the worst direction: raise the cron to thirty minutes and the page goes on
   calling a twenty-five-minute-old read stale, which trains a reader to ignore
   the one banner that says the data stopped moving. */
{
  const built = buildPulse({});
  eq(built.cadenceMinutes, REFRESH_CADENCE_MINUTES,
     "the pulse payload carries the refresh cadence the Worker's cron is configured for, so " +
     "a renderer reads it rather than keeping a second copy across a boundary it cannot " +
     "import across");
  ok(Number.isFinite(built.cadenceMinutes) && built.cadenceMinutes > 0,
     "and it is a usable number even on a build where every feed failed — the cadence is a " +
     "fact about the CRON, not about any feed, so it must not go missing when the vendor does");

  /* ONE SOURCE, ASSERTED AS ONE. If this ever stops being the same object the
     freshness module exports, the two have already diverged. */
  const src = readFileSync(new URL("../shared/flows-pulse.js", import.meta.url), "utf8");
  ok(/import \{ REFRESH_CADENCE_MINUTES \} from "\.\/flows-freshness\.js"/.test(src),
     "imported from the module that owns it rather than restated here — this file is not " +
     "allowed to become the third copy");
  ok(!/cadenceMinutes:\s*\d/.test(src),
     "and the number is nowhere spelled out in this file as a literal");
}

console.log(`✓ flows-pulse: ${checks} assertions — both envelope spellings, absent staying absent ` +
  `beside measured zeros, caps with counted shed, a series shedding its oldest, vendor order ` +
  `preserved where the ranking is the vendor's and calendar order claimed where it is ours, ` +
  `contract fields from one parser, seven feeds failing alone, byte-identical rebuilds, and ` +
  `notes whose one execution-word exception is argued in place`);
