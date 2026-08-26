/* =============================================================
   flows-chain-panels.mjs — the option chain turned into panels.

   The fixture is a REAL smile: a floor plus a skewed parabola, put
   wing bid over the call wing, whole curve lifted on the front.
   Every assertion below is built so the correct answer differs from
   the naive one — a builder that interpolates a wing, averages two
   crowded cells, sums an unreported aggressor split as zero, or
   lets a percent-quoted chain through must fail by name.
   ============================================================= */
import assert from "node:assert/strict";
import {
  buildChainPanels, chainScalars, buildTopContracts, buildAggressor,
  serialiseSurface, CHAIN_PAGE_SIZE, SKEW_MONEYNESS, SKEW_TOLERANCE, SKEW_MIN_DAYS,
} from "../shared/flows-chain.js";
import { ivConvention, priceSale, ivSurface } from "../shared/flows-premium.js";
import { buildCard } from "../shared/flows-card.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-6) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b})`);
  checks++;
};

const SPOT = 100;
const ASOF = "2026-08-24";

/* Expiry codes are YYMMDD; days are measured from ASOF by the module. */
const EXPIRIES = [
  /* A 3-day expiry the floor must refuse: its implied vol is dominated by the
     hours left in it and its wings are quoted in pennies where one tick moves
     the vol by ten points. A fixture whose nearest expiry already clears the
     floor cannot tell a scorer that honours it from one that does not. */
  ["260827", 3],
  ["260831", 7],
  ["260918", 25],
  ["261016", 53],
  ["261218", 116],
];

/**
 * A chain with a genuine equity smile.
 *
 *   iv(m, dte) = level(dte) + 0.55 m² − 0.22 m
 *
 * The −0.22 m term is what makes the put wing (m < 0) bid over the call wing,
 * so at ±0.10 the skew is exactly 2 × 0.22 × 0.10 = 0.044 — a number this test
 * can predict in closed form rather than read back from the implementation.
 * level() falls with tenor, so the term structure is negative and known too.
 */
const levelOf = (dte) => 0.34 - 0.03 * Math.log(dte / 7);
const ivOf = (m, dte) => levelOf(dte) + 0.55 * m * m - 0.22 * m;

function chain({
  ivScale = 1,          // 100 to quote the whole chain in percent
  withAggressor = true,
  strikeStep = 0.05,    // in log-moneyness
  volumeAt = () => 500, // contracts traded, by (m, dte)
} = {}) {
  const rows = [];
  for (const [code, dte] of EXPIRIES) {
    for (let i = -6; i <= 6; i++) {
      const m = i * strikeStep;
      const strike = Math.round(SPOT * Math.exp(m) * 100) / 100;
      const iv = ivOf(m, dte);
      const isPut = i <= 0;
      const cp = isPut ? "P" : "C";
      const intrinsic = isPut ? Math.max(0, strike - SPOT) : Math.max(0, SPOT - strike);
      const t = dte / 365;
      const bid = Math.max(0.05, intrinsic + SPOT * iv * Math.sqrt(t) * 0.4 * Math.exp(-2 * m * m));
      const vol = volumeAt(m, dte);
      const row = {
        option_symbol: `TST${code}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
        nbbo_bid: bid.toFixed(2),
        nbbo_ask: (bid * 1.02 + 0.03).toFixed(2),
        implied_volatility: (iv * ivScale).toFixed(6),
        open_interest: String(1000 + Math.round(4000 * Math.exp(-6 * m * m))),
        prev_oi: String(900 + Math.round(3800 * Math.exp(-6 * m * m))),
        volume: String(vol),
      };
      if (withAggressor) {
        /* Calls lifted on the ask above spot, puts lifted below: a bullish
           tape. The signed ladder must recover that; an unsigned one cannot. */
        const lifted = Math.round(vol * (0.5 + 0.3 * Math.sign(m || 1)));
        row.ask_volume = String(Math.max(0, lifted));
        row.bid_volume = String(Math.max(0, vol - lifted));
      }
      rows.push(row);
    }
  }
  return rows;
}

/* ---------- the whole pipeline, on a well-formed chain ------------ */
{
  const built = buildChainPanels(chain(), { spot: SPOT, asOf: ASOF });
  eq(built.status, "ok", "a well-formed chain builds");
  eq(built.truncated, false, "and is not reported as truncated below the page size");
  ok(built.pricedRows > 0 && built.pricedRows <= built.rowsSeen,
     `the priced subset is stated (${built.pricedRows} of ${built.rowsSeen})`);

  /* ---- the surface ---- */
  const s = built.ivSurface;
  eq(s.status, "ok", "the surface builds");
  ok(s.iv.length === s.rows.length,
     `the iv matrix has one row per ladder row (${s.iv.length} vs ${s.rows.length})`);
  ok(s.iv.every((r) => r.length === s.expiries.length),
     "and one column per shown expiry");
  for (const key of ["skew", "traded", "strike"]) {
    ok(s[key].length === s.iv.length && s[key].every((r) => r.length === s.expiries.length),
       `the ${key} matrix is the same shape as iv — parallel arrays, read by index`);
  }

  /* THE SKEW CELL IS A DIFFERENCE FROM ITS OWN COLUMN'S LEVEL, and where the
     column has no level it must be null rather than the raw iv. */
  s.expiries.forEach((e, col) => {
    for (let r = 0; r < s.iv.length; r++) {
      const iv = s.iv[r][col], sk = s.skew[r][col];
      if (iv === null) { eq(sk, null, `an empty cell carries no skew (col ${col})`); continue; }
      if (e.atmIv === null) { eq(sk, null, `a column with no level publishes no skew (col ${col})`); continue; }
      /* Two independently rounded 4-dp numbers differenced can sit 1.5 units
         of the last place from the rounded difference. The tolerance covers
         exactly that and nothing more: a cell measured against the WRONG
         column's level would be off by whole vol points. */
      near(sk, Number((iv - e.atmIv).toFixed(4)),
           `cell (${r},${col}) skew reconciles against its own column level`, 2e-4);
    }
  });

  /* ---- the scalars, in closed form ---- */
  const sc = built.skewTerm;
  eq(sc.status, "ok", "the skew/term panel builds");
  /* The fixture's strikes land exactly on ±0.10 (step 0.05, i = ±2), so no
     tolerance is spent and the skew is the analytic 2 × 0.22 × 0.10. */
  near(built.scalars.skew, 0.044, "skew is the put wing minus the call wing, in vol points", 5e-4);
  ok(built.scalars.skew > 0, "and is POSITIVE on an ordinary equity smile — puts bid over calls");
  near(sc.skewBasis.putM, -SKEW_MONEYNESS, "the put leg sat exactly on its target", 1e-3);
  near(sc.skewBasis.callM, SKEW_MONEYNESS, "and so did the call leg", 1e-3);
  ok(sc.skewBasis.putStrike < SPOT && sc.skewBasis.callStrike > SPOT,
     "with the legs on opposite sides of spot");
  eq(sc.skewBasis.putTraded, 1, "and the chosen legs traded today, which is stated per leg");

  /* term: level falls with tenor, so far minus near is negative and known. */
  ok(built.scalars.term < 0, "term is negative on a downward-sloping level curve");
  ok(sc.termBasis && sc.termBasis.near !== sc.termBasis.far,
     "and names two DIFFERENT expiries — a scalar alone cannot say which");
  near(built.scalars.term,
       Number((sc.termBasis.farAtm - sc.termBasis.nearAtm).toFixed(4)),
       "the published term is exactly the difference of the two published levels", 1e-4);

  /* THE AT-THE-MONEY HAS ONE ANSWER. The scalar must be a level the surface
     itself vouches for, not a second reading under a looser rule. */
  const levelForAtm = s.expiries.find((e) => e.expiry === sc.atmExpiry);
  ok(levelForAtm, "the front at-the-money names the expiry it came from");
  eq(built.scalars.atmIv, levelForAtm.atmIv,
     "and IS that expiry's own surface level — one at-the-money answer, not two");
  ok(levelForAtm.days >= SKEW_MIN_DAYS,
     `the front level respects the ${SKEW_MIN_DAYS}-day floor (${levelForAtm.days}d)`);
  /* THE FIXTURE HAS SOMETHING NEARER, and it is levelled — so the floor is
     doing work rather than being satisfied by accident. */
  const nearer = s.expiries.filter((e) => e.days !== null && e.days < SKEW_MIN_DAYS && e.atmIv !== null);
  ok(nearer.length > 0,
     `and there IS a nearer levelled expiry it declined to use (${nearer.map((e) => e.days + "d").join(", ")})`);
  ok(sc.skewBasis.days >= SKEW_MIN_DAYS,
     `the skew respects the same floor (${sc.skewBasis.days}d)`);

  /* ---- the tape ---- */
  const top = built.topContracts;
  eq(top.status, "ok", "top contracts build");
  ok(top.rows.length <= 10 && top.rows.length > 0, "capped at ten");
  ok(top.rows.every((r, i) => i === 0 || r.vol <= top.rows[i - 1].vol),
     "ranked by volume, descending");
  ok(top.total >= top.shown, "with the population it was drawn from stated");
  ok(top.rows.every((r) => r.aggr !== null), "and every row carries its aggressor imbalance");

  const agg = built.aggressor;
  eq(agg.status, "ok", "the aggressor ladder builds");
  ok(agg.bars.every((b, i) => i === 0 || b.k >= agg.bars[i - 1].k), "ordered by strike");
  eq(agg.unreported, 0, "with nothing unreported on this chain");
  /* THE LADDER IS SIGNED BY WHAT THE BUYER IS LONG. The fixture lifts calls
     above spot and puts below, which is a BULLISH tape; an unsigned sum would
     report the same busy day with no direction at all. */
  const netTotal = agg.bars.reduce((a, b) => a + b.net, 0);
  ok(netTotal !== 0, "the signed total is not zero on a directional tape");
}

/* ---------- there is exactly ONE at-the-money answer --------------

   The surface will only vouch for an at-the-money level that TRADED TODAY,
   because every skew cell in a column is measured against it and one stale
   reference silently shifts a whole column's smile. A scalar recomputed here
   under a looser rule would disagree with the panel drawn directly above it —
   two answers to one question, and the reader has no way to tell which one the
   number beside "ATM" came from.

   This fixture makes the two rules DIFFER: the at-the-money contracts did not
   trade, so the surface has no level, while a naive nearest-strike search
   finds one immediately. */
{
  const rows = chain();
  let silenced = 0;
  for (const r of rows) {
    if (!/260918/.test(r.option_symbol)) continue;
    const strike = Number(r.option_symbol.slice(-8)) / 1000;
    if (Math.abs(Math.log(strike / SPOT)) <= 0.06) { r.volume = "0"; silenced++; }
  }
  ok(silenced >= 2, `the fixture silenced the second expiry's at-the-money contracts (${silenced})`);

  const conv = ivConvention(rows.map((r) => Number(r.implied_volatility)));
  const priced = rows.map((r) => priceSale(r, { spot: SPOT, asOf: ASOF, ivDivisor: conv.divisor })).filter(Boolean);
  const raw = ivSurface(priced, { ivBasis: conv.basis });
  const silencedCol = raw.expiries.find((e) => e.expiry === "2026-09-18");
  ok(silencedCol, "the silenced expiry is still a column on the surface");
  eq(silencedCol.atmIv, null,
     "with NO level, because nothing at the money traded today");
  ok(/traded today/.test(String(silencedCol.atmReason)), `and the column says why (${silencedCol.atmReason})`);

  /* A naive search finds a quote there anyway — which is exactly the number
     the scalar must NOT publish. */
  const naive = priced.filter((p) => p.expiry === "2026-09-18" && Math.abs(Math.log1p(p.moneyness)) < 0.04);
  ok(naive.length > 0 && naive.some((p) => p.iv > 0),
     "while a nearest-strike search finds a quote on that expiry regardless — the divergence is real");

  const built = buildChainPanels(rows, { spot: SPOT, asOf: ASOF });
  const level = built.ivSurface.expiries.find((e) => e.expiry === built.skewTerm.atmExpiry);
  ok(level, "the scalar names the expiry its level came from");
  eq(built.scalars.atmIv, level.atmIv,
     "and the published at-the-money IS that column's own surface level — never a second reading");
  ok(built.skewTerm.atmExpiry !== "2026-09-18",
     "so the silenced expiry is skipped for the level rather than quietly used");

  /* The skew does NOT need a level, and must survive the silencing — it is one
     quoted wing minus another. */
  ok(built.scalars.skew !== null,
     "while the skew still reads, because it never needed an at-the-money reference");
}

/* ---------- the percent tripwire is inherited, not reimplemented -- */
{
  const built = buildChainPanels(chain({ ivScale: 100 }), { spot: SPOT, asOf: ASOF });
  /* ivConvention divides by 100 on a percent chain, so the surface should come
     back correct — the point is that the module does not carry its OWN
     convention that could disagree with the desk's. */
  eq(built.ivSurface.status, "ok", "a percent-quoted chain is normalised by the shared convention");
  ok(/percent/.test(String(built.ivBasis)), `and the basis says so (${built.ivBasis})`);
  near(built.scalars.skew, 0.044, "with the skew unchanged in vol points", 5e-4);
}

/* ---------- an absent aggressor split is not a balanced tape ------ */
{
  const built = buildChainPanels(chain({ withAggressor: false }), { spot: SPOT, asOf: ASOF });
  eq(built.ivSurface.status, "ok", "the surface still builds without an aggressor split");
  eq(built.aggressor.status, "unavailable",
     "THE LADDER IS WITHHELD: summing absent splits as zero would draw a flat, confident " +
     "'no aggression anywhere' over a chain the vendor simply did not report");
  ok(/no aggressor split|reported no aggressor/.test(built.aggressor.reason),
     `and says why (${built.aggressor.reason})`);
  ok(built.topContracts.status === "ok" && built.topContracts.rows.every((r) => r.aggr === null),
     "while the contracts still list, each with a null imbalance rather than a zero");
  eq(built.topContracts.aggressorReported, 0, "and the count of reported splits is zero, stated");
}

/* ---------- a partial split is counted, not silently dropped ------ */
{
  const rows = chain();
  /* Strip the split from a third of the rows — the shape a vendor actually
     sends, and the one where a builder that just skips them reports a
     confident ladder over two thirds of the tape with no note. */
  rows.forEach((r, i) => { if (i % 3 === 0) { delete r.ask_volume; delete r.bid_volume; } });
  const agg = buildAggressor(rows, { spot: SPOT });
  eq(agg.status, "ok", "a partially reported chain still builds a ladder");
  ok(agg.unreported > 0, `with the unreported contracts COUNTED (${agg.unreported})`);
  ok(agg.reported > 0 && agg.reported + agg.unreported <= rows.length,
     "and the two counts partition what actually traded");
}

/* ---------- a contract with no bid still counts on the tape ------- */
{
  /* priceSale refuses a contract with no live bid — correct for a sale, and
     wrong for a volume ladder. The far call here is quoted 0.00 bid and traded
     more than anything else on the chain: it is the single most interesting
     line, and going through priceSale would delete it. */
  const rows = chain();
  /* The furthest call on the front expiry, re-quoted with nobody bidding. */
  const calls = rows.filter((r) => /260831C/.test(r.option_symbol));
  const far = calls[calls.length - 1];
  ok(far, "the fixture carries a far front-expiry call");
  far.nbbo_bid = "0.00";
  far.nbbo_ask = "0.05";
  far.volume = "99999";
  const top = buildTopContracts(rows, { spot: SPOT });
  eq(top.rows[0].vol, 99999,
     "THE NO-BID CONTRACT LEADS THE TAPE: the volume panel parses directly rather than " +
     "through the sale pricer, which refuses a contract nobody is bidding for");
  eq(top.rows[0].cp, "C", "and it is the call it actually is");

  /* The surface, which DOES price, must exclude it — and the two panels
     disagreeing here is correct rather than a bug, so both state their basis. */
  const conv = ivConvention(rows.map((r) => Number(r.implied_volatility)));
  const priced = rows.map((r) => priceSale(r, { spot: SPOT, asOf: ASOF, ivDivisor: conv.divisor })).filter(Boolean);
  ok(!priced.some((p) => p.symbol === far.option_symbol),
     "while the priced subset excludes it, because there is nobody to sell to");
}

/* ---------- degenerate chains degrade, and say so ----------------- */
{
  const emptyChain = buildChainPanels([], { spot: SPOT, asOf: ASOF });
  eq(emptyChain.status, "unavailable", "an empty chain is unavailable");
  for (const key of ["ivSurface", "skewTerm", "topContracts", "aggressor"]) {
    eq(emptyChain[key].status, "unavailable", `and every panel says so (${key})`);
    ok(typeof emptyChain[key].reason === "string" && emptyChain[key].reason.length > 10,
       `with a reason on ${key}`);
  }
  eq(emptyChain.scalars.skew, null, "with no scalar invented");

  const noSpot = buildChainPanels(chain(), { spot: 0, asOf: ASOF });
  eq(noSpot.status, "unavailable", "a chain with no spot cannot be measured");
  ok(/spot/.test(noSpot.reason), `and names the missing input (${noSpot.reason})`);

  /* A chain whose only expiry is tomorrow: the floor refuses it, and the
     refusal is a stated reason rather than a silent null. */
  const soon = chain().filter((r) => /260831/.test(r.option_symbol));
  const built = buildChainPanels(soon, { spot: SPOT, asOf: "2026-08-29" });
  eq(built.scalars.skew, null, "a chain inside the day floor publishes no skew");
  ok(/reached 7 days|reached \d+ days/.test(built.skewTerm.skewReason),
     `and names the floor (${built.skewTerm.skewReason})`);
  eq(built.scalars.term, null, "nor a term structure from one expiry");
  ok(built.skewTerm.termReason, "with its own reason");
}

/* ---------- wings are the nearest LISTED strike, never interpolated */
{
  /* A coarse ladder whose strikes straddle ±0.10 without landing on it. The
     honest answer is the nearest listed strike inside the tolerance, WITH the
     moneyness it actually sat at published; an interpolated answer would be a
     vol nobody quoted. */
  const rows = chain({ strikeStep: 0.07 });     // strikes at 0, ±0.07, ±0.14 …
  const built = buildChainPanels(rows, { spot: SPOT, asOf: ASOF });
  const b = built.skewTerm.skewBasis;
  ok(b, "a coarse ladder still produces a reading");
  ok(Math.abs(Math.abs(b.putM) - SKEW_MONEYNESS) > 1e-3,
     `the put leg did NOT sit on the target (${b.putM}), which is the interesting case`);
  ok(Math.abs(b.putM + SKEW_MONEYNESS) <= SKEW_TOLERANCE + 1e-9,
     "but sat inside the stated tolerance");
  /* The published vol is one the fixture actually quoted at that strike. */
  near(b.putIv, Number(ivOf(b.putM, b.days).toFixed(4)),
       "and the published wing vol is the QUOTED vol at the strike used, not an interpolation", 2e-3);

  /* Beyond tolerance there is no reading at all. */
  const sparse = chain({ strikeStep: 0.20 });   // nothing within 0.04 of ±0.10
  const far = buildChainPanels(sparse, { spot: SPOT, asOf: ASOF });
  eq(far.scalars.skew, null,
     "a ladder with nothing inside the tolerance publishes NO skew rather than reaching further");
  ok(/within/.test(far.skewTerm.skewReason), `and says so (${far.skewTerm.skewReason})`);
}

/* ---------- truncation is stated ---------------------------------- */
{
  const rows = [];
  while (rows.length < CHAIN_PAGE_SIZE) rows.push(...chain());
  const built = buildChainPanels(rows.slice(0, CHAIN_PAGE_SIZE), { spot: SPOT, asOf: ASOF });
  eq(built.truncated, true,
     "a chain that filled the page is reported as truncated — partial coverage is stated, not hidden");
  eq(built.rowsSeen, CHAIN_PAGE_SIZE, "with the row count it actually saw");
}

/* ---------- a truncated chain says so ON THE CARD ------------------ */
{
  const rows = [];
  while (rows.length < CHAIN_PAGE_SIZE) rows.push(...chain());
  const built = buildChainPanels(rows.slice(0, CHAIN_PAGE_SIZE), { spot: SPOT, asOf: ASOF });
  eq(built.truncated, true, "the builder knows it filled the page");

  /* THE FLAG HAS TO REACH THE CARD, through the real builder. A surface drawn
     from the first 500 of a 2,000-contract book looks exactly as complete as
     one drawn from the whole book; without coverage on the panel a reader
     cannot tell "these are the strikes" from "these are the strikes that fit
     on one page". */
  const card = buildCard({
    ticker: "TST", row: { close: SPOT }, features: {},
    strikes: [], ticks: [], expiries: [], maxPain: [], congress: [],
    surface: [], chain: built,
    generatedAt: "2026-08-25T09:15:00Z", sessionDate: ASOF,
  });
  for (const key of ["ivSurface", "skewTerm", "topContracts", "aggressor"]) {
    const panel = card.panels[key];
    eq(panel.status, "ok", `${key} reached the card`);
    ok(panel.coverage, `and carries its coverage (${key})`);
    eq(panel.coverage.truncated, true, `which says the chain was truncated (${key})`);
    eq(panel.coverage.rowsSeen, CHAIN_PAGE_SIZE, `with the rows it actually saw (${key})`);
    ok(/open interest/.test(panel.coverage.filter),
       `and the upstream selection stated rather than left to be inferred (${key})`);
  }

  /* A card with NO chain says that too, rather than shipping four silent
     absences a renderer would draw as empty panels. */
  const bare = buildCard({
    ticker: "TST", row: { close: SPOT }, features: {},
    strikes: [], ticks: [], expiries: [], maxPain: [], congress: [],
    surface: [], chain: null,
    generatedAt: "2026-08-25T09:15:00Z", sessionDate: ASOF,
  });
  for (const key of ["ivSurface", "skewTerm", "topContracts", "aggressor"]) {
    eq(bare.panels[key].status, "unavailable", `a chainless card withholds ${key}`);
    ok(/chain leg/.test(bare.panels[key].reason),
       `naming why the chain is absent rather than implying the vendor had nothing (${key})`);
  }
}

/* ---------- the payload budget ------------------------------------ */
{
  const built = buildChainPanels(chain(), { spot: SPOT, asOf: ASOF });
  const bytes = JSON.stringify({
    ivSurface: built.ivSurface, skewTerm: built.skewTerm,
    topContracts: built.topContracts, aggressor: built.aggressor,
  }).length;
  ok(bytes < 14 * 1024,
     `four chain panels cost ${(bytes / 1024).toFixed(1)}KB, inside the budget the 100KB ` +
     "card self-check leaves them");
  /* Parallel arrays, not arrays of objects: the key names must not repeat per
     cell. A grid of 17x8 objects would carry "iv" over a hundred times. */
  const surfaceJson = JSON.stringify(built.ivSurface);
  const ivKeys = (surfaceJson.match(/"iv"/g) || []).length;
  ok(ivKeys <= 2, `the surface names "iv" ${ivKeys} time(s), not once per cell`);
}

console.log(`✓ flows-chain: ${checks} assertions — a smile whose skew is known in closed form, ` +
  `wings that are the nearest listed strike or nothing at all, one at-the-money answer shared ` +
  `with the surface, an aggressor ladder signed by what the buyer is long and withheld rather ` +
  `than zeroed when the vendor did not report it, and a tape that keeps the no-bid contract ` +
  `the sale pricer must refuse`);
