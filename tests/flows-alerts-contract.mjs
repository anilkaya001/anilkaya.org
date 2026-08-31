/* =============================================================
   flows-alerts-contract.mjs — the vendor's flow alerts, shaped.

   WHAT IS WORTH ASSERTING. This module sits between a vendor feed
   whose field set was established by probe (three live runs, not
   documentation) and a page whose predecessor panel is BUILT on the
   refusal to say "trade". The expensive defects are all quiet
   category confusions:

     - an absent vendor flag read as FALSE (the vendor not asking is
       not the vendor answering no);
     - a row with nothing measurable shaped into a row of dashes;
     - the vendor's selection presented as the market's ranking;
     - prose that drifts into claims the data cannot support.

   The tie-break fixture below exists because the FIRST draft of the
   sort had `x || y < z ? -1 : 1` — precedence made the whole chain a
   truthiness test — and only a fixture with two null-premium rows of
   different sizes can see that class of bug at all.
   ============================================================= */

import assert from "node:assert/strict";
import {
  alertRow, buildFlowAlerts, ALERT_ROWS, ALERTS_NOTES,
} from "../shared/flows-alerts.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const stageOf = (t) => (t === "AAA" ? "deep" : t === "BBB" ? "gated" : null);

/* ---------- §1 one row, shaped ------------------------------------ */
{
  const row = alertRow({
    ticker: "AAA",
    option_chain: "AAA260918C00150000",
    total_premium: "125000.5",
    total_size: 400,
    trade_count: 7,
    total_ask_side_prem: 100000,
    total_bid_side_prem: 20000,
    has_sweep: true,
    has_floor: false,
    open_interest: 1200,
    volume_oi_ratio: 2.5,
    iv_start: 0.41, iv_end: 0.44,
    underlying_price: 148.2,
    start_time: "2026-08-28T14:31:02Z", end_time: "2026-08-28T14:33:40Z",
    alert_rule: "RepeatedHits",
  }, { stageOf });

  eq(row.cp, "C", "call/put comes off the option symbol, through the same parser " +
    "the premium desk uses — one spelling of one relation");
  eq(row.k, 150, "and so does the strike");
  eq(row.exp, "2026-09-18", "and the expiry");
  eq(row.prem, 125000.5, "the vendor's premium survives as a number");
  eq(row.sweep, true, "a sent flag is carried");
  eq(row.floor, false, "false is carried AS false — the vendor looked and found none");
  eq(row.single, null,
    "AND AN ABSENT FLAG IS NULL, NOT FALSE — the vendor not carrying the field " +
    "is a different fact from the vendor answering no, and collapsing them " +
    "would print a confident “no” nobody measured");
  eq(row.st, "deep", "the board-funnel stage rides on the row");
  eq(alertRow({ ticker: "ZZZ", total_premium: 1 }, { stageOf }).st, "foreign",
    "a name the funnel never saw is foreign, not a dash");
}

/* ---------- §2 unusable rows are counted, not dashed -------------- */
{
  eq(alertRow({ option_chain: "AAA260918C00150000", total_premium: 5 }), null,
    "no ticker, no row");
  eq(alertRow({ ticker: "AAA", alert_rule: "X", has_sweep: true }), null,
    "a row with no premium, no size and no count measures nothing this surface " +
    "publishes — shaped, it would be a row of dashes wearing a sweep flag");
  const zero = alertRow({ ticker: "AAA", total_premium: 0 });
  ok(zero && zero.prem === 0,
    "but a MEASURED zero premium is a measurement and the row survives");
}

/* ---------- §3 ranking inside the vendor's selection -------------- */
{
  const built = buildFlowAlerts([
    { ticker: "CCC", total_premium: 50 },
    { ticker: "AAA", total_premium: 900 },
    { ticker: "DDD", trade_count: 3, total_size: 10 },      // no premium
    { ticker: "BBB", total_premium: 900 },                   // tie with AAA
    { ticker: "EEE", trade_count: 2, total_size: 90 },       // no premium, bigger
    { ticker: null, total_premium: 5 },                      // unusable
  ], { stageOf });

  deep(built.rows.map((r) => r.t), ["AAA", "BBB", "CCC", "EEE", "DDD"],
    "premium descending with a TOTAL tie-break; rows the vendor sent without a " +
    "premium rank after every row that has one, by size then name — the first " +
    "draft's precedence bug made this exact ordering random, which is why the " +
    "fixture holds two null-premium rows of different sizes");
  eq(built.seen, 5, "seen counts the usable rows");
  eq(built.unusable, 1, "and the unusable one is counted, not vanished");
  eq(built.coverage.withPremium, 3, "coverage says how many rows the ranking " +
    "actually ranked");
  eq(built.status, "ok", "rows present is ok");
  eq(JSON.stringify(buildFlowAlerts([
    { ticker: "CCC", total_premium: 50 },
    { ticker: "AAA", total_premium: 900 },
    { ticker: "DDD", trade_count: 3, total_size: 10 },
    { ticker: "BBB", total_premium: 900 },
    { ticker: "EEE", trade_count: 2, total_size: 90 },
    { ticker: null, total_premium: 5 },
  ], { stageOf })), JSON.stringify(built),
    "two builds over one response publish identical bytes");
}

/* ---------- §4 the cap and its shed ------------------------------- */
{
  const many = [];
  for (let i = 0; i < ALERT_ROWS + 7; i++) {
    many.push({ ticker: "T" + String(100 + i), total_premium: 1000 - i });
  }
  const built = buildFlowAlerts(many);
  eq(built.rows.length, ALERT_ROWS, "the cap holds");
  eq(built.shed, 7, "and what it removed is counted beside what it kept");
  eq(built.cap, ALERT_ROWS, "with the cap itself published — a capped list that " +
    "does not say so invites reading the cap as the population");
  eq(built.rows[0].prem, 1000, "the shed takes the smallest premiums, never the largest");
}

/* ---------- §5 flags in coverage count ONLY the affirmative ------- */
{
  const built = buildFlowAlerts([
    { ticker: "AAA", total_premium: 3, has_sweep: true },
    { ticker: "BBB", total_premium: 2, has_sweep: false },
    { ticker: "CCC", total_premium: 1 },                     // flag absent
  ]);
  eq(built.coverage.sweeps, 1,
    "the sweep count counts true and only true — counting an absent flag either " +
    "way would manufacture a measurement the vendor never sent");
}

/* ---------- §6 empty is quiet, said in a word --------------------- */
{
  const built = buildFlowAlerts([]);
  eq(built.status, "quiet", "an empty response reports quiet");
  deep(built.rows, [], "with no rows");
  eq(built.notes, ALERTS_NOTES, "and the notes still ride, because the page's " +
    "basis panel must explain the surface even when it is empty");
}

/* ---------- §7 the vocabulary holds in the payload's own prose ----
   The unusual page's ban exists because its counter cannot support the
   claims; THIS surface supports more (a size, a span, a side) and still
   not these. The notes are scanned with NO allow-list: the prose was
   written to need no exception, and an edit that introduces one should
   have to come here and argue for it. */
{
  const BAN = /\b(print|trade|block|bought|sold|paid|whale|smart money|institutional|fill)\b/gi;
  const scan = (value, at) => {
    if (typeof value === "string") {
      BAN.lastIndex = 0;
      const m = BAN.exec(value);
      ok(!m, `${at} says "${m && m[1]}" — a claim this feed cannot support: rows are ` +
        "vendor-flagged windows, not executions, and carry no identity");
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) scan(v, `${at}.${k}`);
    }
  };
  scan(ALERTS_NOTES, "notes");
  ok(/vendor's rules chose to flag/.test(ALERTS_NOTES.selection),
    "and the selection caveat — the population is the vendor's choice, not the " +
    "market's ranking — is stated in those words, because it is the headline " +
    "fact about this feed");
}

console.log(`✓ flows-alerts: ${checks} assertions — a vendor flag that is absent staying ` +
  `null rather than becoming a confident no, a row measuring nothing dropped and counted, ` +
  `premium ranking inside the vendor's own selection with a total tie-break the first ` +
  `draft's precedence bug would fail, a published cap with its shed, affirmative-only ` +
  `flag counts, a quiet empty, and notes that need no allow-list`);
