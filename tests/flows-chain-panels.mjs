import assert from "node:assert/strict";
import {
  buildChainPanels, chainScalars, buildTopContracts, buildAggressor,
  serialiseSurface, CHAIN_PAGE_SIZE, SKEW_MONEYNESS, SKEW_TOLERANCE, SKEW_MIN_DAYS,
  summariseSkewMisses, mergeChainPages, CHAIN_MAX_PAGES,
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

const EXPIRIES = [

  ["260827", 3],
  ["260831", 7],
  ["260918", 25],
  ["261016", 53],
  ["261218", 116],
];

const levelOf = (dte) => 0.34 - 0.03 * Math.log(dte / 7);
const ivOf = (m, dte) => levelOf(dte) + 0.55 * m * m - 0.22 * m;

const PUT_LIFT = 0.03;

function chain({
  ivScale = 1,
  withAggressor = true,
  strikeStep = 0.05,
  volumeAt = () => 500,
  typeOrder = "putsFirst",
  bearish = false,
} = {}) {
  const rows = [];
  for (const [code, dte] of EXPIRIES) {
    for (let i = -6; i <= 6; i++) {
      const m = i * strikeStep;
      const strike = Math.round(SPOT * Math.exp(m) * 100) / 100;

      const t = dte / 365;
      const vol = volumeAt(m, dte);
      for (const cp of (typeOrder === "callsFirst" ? ["C", "P"] : ["P", "C"])) {
        const isPut = cp === "P";
        const iv = ivOf(m, dte) + (isPut ? PUT_LIFT / 2 : -PUT_LIFT / 2);
        const intrinsic = isPut ? Math.max(0, strike - SPOT) : Math.max(0, SPOT - strike);
        const bid = Math.max(0.05, intrinsic + SPOT * iv * Math.sqrt(t) * 0.4 * Math.exp(-2 * m * m));
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

          const liftShare = bearish ? (isPut ? 0.65 : 0.35) : (isPut ? 0.35 : 0.65);
          const lifted = Math.round(vol * liftShare);
          row.ask_volume = String(Math.max(0, lifted));
          row.bid_volume = String(Math.max(0, vol - lifted));
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

{
  const built = buildChainPanels(chain(), { spot: SPOT, asOf: ASOF });
  eq(built.status, "ok", "a well-formed chain builds");
  eq(built.truncated, false, "and is not reported as truncated below the page size");
  ok(built.pricedRows > 0 && built.pricedRows <= built.rowsSeen,
     `the priced subset is stated (${built.pricedRows} of ${built.rowsSeen})`);

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

  s.expiries.forEach((e, col) => {
    for (let r = 0; r < s.iv.length; r++) {
      const iv = s.iv[r][col], sk = s.skew[r][col];
      if (iv === null) { eq(sk, null, `an empty cell carries no skew (col ${col})`); continue; }
      if (e.atmIv === null) { eq(sk, null, `a column with no level publishes no skew (col ${col})`); continue; }

      near(sk, Number((iv - e.atmIv).toFixed(4)),
           `cell (${r},${col}) skew reconciles against its own column level`, 2e-4);
    }
  });

  const sc = built.skewTerm;
  eq(sc.status, "ok", "the skew/term panel builds");

  near(built.scalars.skew, 0.044 + PUT_LIFT,
       "skew is the OTM PUT wing minus the OTM CALL wing, in vol points", 5e-4);
  eq(sc.skewBasis.putType, "P", "and the put leg really is a put");
  eq(sc.skewBasis.callType, "C", "and the call leg really is a call");
  ok(built.scalars.skew > 0, "and is POSITIVE on an ordinary equity smile — puts bid over calls");
  near(sc.skewBasis.putM, -SKEW_MONEYNESS, "the put leg sat exactly on its target", 1e-3);
  near(sc.skewBasis.callM, SKEW_MONEYNESS, "and so did the call leg", 1e-3);
  ok(sc.skewBasis.putStrike < SPOT && sc.skewBasis.callStrike > SPOT,
     "with the legs on opposite sides of spot");
  eq(sc.skewBasis.putTraded, 1, "and the chosen legs traded today, which is stated per leg");

  ok(built.scalars.term < 0, "term is negative on a downward-sloping level curve");
  ok(sc.termBasis && sc.termBasis.near !== sc.termBasis.far,
     "and names two DIFFERENT expiries — a scalar alone cannot say which");
  near(built.scalars.term,
       Number((sc.termBasis.farAtm - sc.termBasis.nearAtm).toFixed(4)),
       "the published term is exactly the difference of the two published levels", 1e-4);

  const levelForAtm = s.expiries.find((e) => e.expiry === sc.atmExpiry);
  ok(levelForAtm, "the front at-the-money names the expiry it came from");
  eq(built.scalars.atmIv, levelForAtm.atmIv,
     "and IS that expiry's own surface level — one at-the-money answer, not two");
  ok(levelForAtm.days >= SKEW_MIN_DAYS,
     `the front level respects the ${SKEW_MIN_DAYS}-day floor (${levelForAtm.days}d)`);

  const nearer = s.expiries.filter((e) => e.days !== null && e.days < SKEW_MIN_DAYS && e.atmIv !== null);
  ok(nearer.length > 0,
     `and there IS a nearer levelled expiry it declined to use (${nearer.map((e) => e.days + "d").join(", ")})`);
  ok(sc.skewBasis.days >= SKEW_MIN_DAYS,
     `the skew respects the same floor (${sc.skewBasis.days}d)`);

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

  const netTotal = agg.bars.reduce((a, b) => a + b.net, 0);
  ok(netTotal > 0,
     `the signed total is POSITIVE on a tape that lifts calls and writes puts (${netTotal})`);
  ok(agg.bars.every((b) => b.calls !== null && b.puts !== null),
     "every bar carries its two wings, not just their difference");

  const bearish = buildChainPanels(chain({ bearish: true }), { spot: SPOT, asOf: ASOF });
  const bearNet = bearish.aggressor.bars.reduce((a, b) => a + b.net, 0);
  ok(bearNet < 0,
     `a tape that writes calls and lifts puts nets NEGATIVE (${bearNet}) against the ` +
     `bullish tape's +${netTotal} — an unsigned ladder reports these two identically`);
  const bullVol = agg.bars.reduce((a, b) => a + (b.vol || 0), 0);
  const bearVol = bearish.aggressor.bars.reduce((a, b) => a + (b.vol || 0), 0);
  eq(bullVol, bearVol,
     "while the volume traded is the same on both — direction is the only thing that moved");
}

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

  ok(built.scalars.skew !== null,
     "while the skew still reads, because it never needed an at-the-money reference");
}

{

  const flat = (order) => {
    const rows = [];
    for (let i = -6; i <= 6; i++) {
      const strike = Math.round(SPOT * Math.exp(i * 0.05) * 100) / 100;
      for (const cp of (order === "callsFirst" ? ["C", "P"] : ["P", "C"])) {
        rows.push({
          option_symbol: `TST260918${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
          nbbo_bid: "2.00", nbbo_ask: "2.10",
          implied_volatility: (cp === "P" ? 0.40 : 0.25).toFixed(4),
          open_interest: "1000", prev_oi: "900", volume: "500",
          ask_volume: "300", bid_volume: "200",
        });
      }
    }
    return rows;
  };

  const fwd = buildChainPanels(flat("putsFirst"), { spot: SPOT, asOf: ASOF });
  const rev = buildChainPanels(flat("callsFirst"), { spot: SPOT, asOf: ASOF });

  eq(fwd.scalars.skew, rev.scalars.skew,
     `skew is order-independent (${fwd.scalars.skew} vs ${rev.scalars.skew})`);
  eq(fwd.scalars.atmIv, rev.scalars.atmIv,
     `so is the at-the-money level (${fwd.scalars.atmIv} vs ${rev.scalars.atmIv})`);
  assert.deepEqual(fwd.ivSurface.iv, rev.ivSurface.iv,
    "and so is every cell of the surface"); checks++;

  near(fwd.scalars.skew, 0.15,
       "a chain with puts fifteen points over calls publishes +0.15, NOT a confident zero", 1e-6);
  eq(fwd.skewTerm.skewBasis.putType, "P", "the put leg is a put");
  eq(fwd.skewTerm.skewBasis.callType, "C", "the call leg is a call");
  near(fwd.skewTerm.skewBasis.putIv, 0.40, "quoted at the put's own vol", 1e-6);
  near(fwd.skewTerm.skewBasis.callIv, 0.25, "and the call's", 1e-6);

  ok(fwd.strikeCollisions > 0,
     `the de-duplication reports what it resolved (${fwd.strikeCollisions} collisions)`);
  eq(fwd.surfacedRows + fwd.strikeCollisions, fwd.pricedRows,
     "and every priced row is either surfaced or accounted for as a collision");

  const s = fwd.ivSurface;
  const belowRows = s.rows.map((m, r) => ({ m, r })).filter((x) => x.m < -0.02);
  ok(belowRows.length > 0, "the surface has rows below the money");
  for (const { m, r } of belowRows) {
    const iv = s.iv[r][0];
    if (iv === null) continue;
    near(iv, 0.40, `the cell at m=${m} kept the PUT, which is the out-of-the-money one`, 1e-6);
  }
}

{

  const rows = [];
  for (let i = -6; i <= 6; i++) {
    const strike = Math.round(SPOT * Math.exp(i * 0.05) * 100) / 100;

    const types = i < 0 ? ["C"] : ["P", "C"];
    for (const cp of types) {
      rows.push({
        option_symbol: `TST260918${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
        nbbo_bid: "2.00", nbbo_ask: "2.10",
        implied_volatility: (cp === "P" ? 0.40 : 0.25).toFixed(4),
        open_interest: "1000", prev_oi: "900", volume: "500",
        ask_volume: "300", bid_volume: "200",
      });
    }
  }
  const built = buildChainPanels(rows, { spot: SPOT, asOf: ASOF });
  eq(built.scalars.skew, null,
     "with no put listed at the lower wing, NO skew is published — a call standing in " +
     "for the put wing would publish a call-minus-call number under a put-versus-call label");
  ok(/quoted BOTH a put .* and a call/.test(String(built.skewTerm.skewReason)),
     `and the reason names what was missing (${built.skewTerm.skewReason})`);

  eq(built.ivSurface.status, "ok", "while the surface still builds from what is listed");
  ok(built.scalars.atmIv !== null, "and the at-the-money level still reads");
}

{

  const rows = [{
    option_symbol: "TST260918C00020000" .replace("00020000", String(Math.round(SPOT * 1.02 * 1000)).padStart(8, "0")),
    nbbo_bid: "2.00", nbbo_ask: "2.10", implied_volatility: "0.3000",
    open_interest: "500", prev_oi: "400",
    ask_volume: "900", bid_volume: "100",

  }];
  const agg = buildAggressor(rows, { spot: SPOT });
  eq(agg.status, "ok", "a split without a volume field still measures the aggression");
  eq(agg.bars[0].net, 800, "the net is the split the vendor did report");
  eq(agg.bars[0].vol, null,
     "while the volume it did NOT report is null, never a zero beside 800 lifted contracts");
  eq(agg.bars[0].volMissing, 1, "and the missing count is published");
}

{

  const k = Math.round(SPOT * 1.05 * 100) / 100;
  const sym = (cp) => `TST260918${cp}${String(Math.round(k * 1000)).padStart(8, "0")}`;
  const rows = ["C", "P"].map((cp) => ({
    option_symbol: sym(cp), nbbo_bid: "2.00", nbbo_ask: "2.10",
    implied_volatility: "0.3000", open_interest: "500", prev_oi: "400",
    volume: "100", ask_volume: "60", bid_volume: "40",
  }));
  const agg = buildAggressor(rows, { spot: SPOT });
  eq(agg.bars.length, 1, "one strike");
  eq(agg.bars[0].net, 0, "whose net genuinely is zero — the two wings cancel");
  eq(agg.bars[0].vol, 200, "over two hundred contracts, which is the point");
  ok(agg.bars[0].calls > 0 && agg.bars[0].puts > 0,
     `and both wings are published (${agg.bars[0].calls} calls, ${agg.bars[0].puts} puts), so a ` +
     "zero net over real volume cannot be read as a strike nobody touched");
}

{
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const k = Math.round(SPOT * (1 + i * 0.05) * 100) / 100;
    rows.push({
      option_symbol: `TST260918C${String(Math.round(k * 1000)).padStart(8, "0")}`,
      nbbo_bid: "2.00", nbbo_ask: "2.10", implied_volatility: "0.3000",
      open_interest: "500", prev_oi: "400", volume: "100",
      ask_volume: "60", bid_volume: "40",
    });
  }

  const kq = Math.round(SPOT * 1.25 * 100) / 100;
  rows.push({
    option_symbol: `TST260918C${String(Math.round(kq * 1000)).padStart(8, "0")}`,
    nbbo_bid: "0.20", nbbo_ask: "0.25", implied_volatility: "0.4000",
    open_interest: "9000", prev_oi: "8000", volume: "5000",
  });
  const agg = buildAggressor(rows, { spot: SPOT });
  eq(agg.shown, 3, "three strikes are drawn");
  eq(agg.total, 4,
     "over a chain of FOUR — reporting 3 of 3 would be a completeness claim the data " +
     "does not support");
  eq(agg.strikesUnreported, 1, "with the unreported strike counted");
}

{

  const rows = [];
  for (let i = -4; i <= 4; i++) {
    const strike = Math.round(SPOT * Math.exp(i * 0.05) * 100) / 100;
    for (const cp of ["P", "C"]) {
      rows.push({
        option_symbol: `TST260918${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
        nbbo_bid: "9.00", nbbo_ask: "9.20",
        implied_volatility: (3.8 + i * 0.01).toFixed(4),
        open_interest: "800", prev_oi: "700", volume: "300",
        ask_volume: "200", bid_volume: "100",
      });
    }
  }
  const built = buildChainPanels(rows, { spot: SPOT, asOf: ASOF });
  ok(/fraction/.test(String(built.ivBasis)),
     `the shared convention reads this chain as fractional (${built.ivBasis})`);
  eq(built.scalars.atmIv, null,
     "and the at-the-money reading is WITHHELD rather than published as 3.8 — a 380% " +
     "annualised vol on a board column would rank first on every sort");
  ok(/ceiling/.test(String(built.skewTerm.atmReason)),
     `naming the ceiling and the measured value (${built.skewTerm.atmReason})`);
  eq(built.scalars.term, null, "the term difference inherits the refusal");
}

{

  const rows = chain();
  rows.push({
    option_symbol: `TST1260918C${String(Math.round(SPOT * 3 * 1000)).padStart(8, "0")}`,
    nbbo_bid: "1.00", nbbo_ask: "1.10", implied_volatility: "0.4000",
    open_interest: "9000", prev_oi: "8000", volume: "99999",
    ask_volume: "90000", bid_volume: "9999",
  });

  const unfiltered = buildChainPanels(rows, { spot: SPOT, asOf: ASOF });
  eq(unfiltered.topContracts.rows[0].vol, 99999,
     "without a ticker to check against, the adjusted series leads the tape");

  const filtered = buildChainPanels(rows, { spot: SPOT, asOf: ASOF, ticker: "TST" });
  eq(filtered.foreignRows, 1, "given the ticker, the foreign root is dropped and COUNTED");
  ok(filtered.topContracts.rows.every((r) => r.vol !== 99999),
     "so it no longer leads the tape");
  ok(filtered.aggressor.bars.every((b) => b.net !== 99999),
     "nor the aggressor ladder");
}

{
  const built = buildChainPanels(chain({ ivScale: 100 }), { spot: SPOT, asOf: ASOF });

  eq(built.ivSurface.status, "ok", "a percent-quoted chain is normalised by the shared convention");
  ok(/percent/.test(String(built.ivBasis)), `and the basis says so (${built.ivBasis})`);
  near(built.scalars.skew, 0.044 + PUT_LIFT,
       "with the skew unchanged in vol points — the convention scales the inputs, not the answer", 5e-4);
}

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

{
  const rows = chain();

  rows.forEach((r, i) => { if (i % 3 === 0) { delete r.ask_volume; delete r.bid_volume; } });
  const agg = buildAggressor(rows, { spot: SPOT });
  eq(agg.status, "ok", "a partially reported chain still builds a ladder");
  ok(agg.unreported > 0, `with the unreported contracts COUNTED (${agg.unreported})`);
  ok(agg.reported > 0 && agg.reported + agg.unreported <= rows.length,
     "and the two counts partition what actually traded");
}

{

  const rows = chain();

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

  const conv = ivConvention(rows.map((r) => Number(r.implied_volatility)));
  const priced = rows.map((r) => priceSale(r, { spot: SPOT, asOf: ASOF, ivDivisor: conv.divisor })).filter(Boolean);
  ok(!priced.some((p) => p.symbol === far.option_symbol),
     "while the priced subset excludes it, because there is nobody to sell to");
}

{
  const built = buildChainPanels(chain(), { spot: SPOT, asOf: ASOF });
  const sc = built.skewTerm;
  const b30 = sc.skew30Basis;
  ok(b30 && b30.nearDays <= 30 && b30.farDays >= 30,
     `the fixed-tenor skew is read between the two expiries bracketing 30 days (${b30 && b30.nearDays}d, ${b30 && b30.farDays}d)`);
  const wing = (m, lift) => {
    const v1 = ivOf(m, b30.nearDays) + lift, v2 = ivOf(m, b30.farDays) + lift;
    const w1 = v1 * v1 * b30.nearDays, w2 = v2 * v2 * b30.farDays;
    return Math.sqrt((w1 + (w2 - w1) * (30 - b30.nearDays) / (b30.farDays - b30.nearDays)) / 30);
  };
  near(sc.skew30, wing(-SKEW_MONEYNESS, PUT_LIFT / 2) - wing(SKEW_MONEYNESS, -PUT_LIFT / 2),
       "and each wing is interpolated in TOTAL VARIANCE, sigma^2 T, not in vol", 2e-3);
  near(sc.skew30, sc.skew,
       "and on a smile whose wing difference is the same at every tenor it agrees with the " +
       `nearest-expiry reading at ${sc.skewBasis.days} days, as it must`, 1e-3);
  eq(sc.skewBasis.putPlaced, "exact", "a traded strike a cent-rounding away from the target is exact");
  ok(/matching tenors/.test(sc.relation) && /total variance/.test(sc.relation),
     "and the relation says skews compare only at matching tenors");

  const oneExpiry = chain().filter((r) => /260918/.test(r.option_symbol));
  const single = buildChainPanels(oneExpiry, { spot: SPOT, asOf: ASOF }).skewTerm;
  eq(single.skew30, null, "one expiry cannot bracket a fixed tenor");
  ok(/bracketing 30 days/.test(single.skew30Reason || ""), `and says so (${single.skew30Reason})`);

  const quiet = buildChainPanels(chain({ volumeAt: () => 0 }), { spot: SPOT, asOf: ASOF }).skewTerm;
  eq(quiet.skew30, null, "and a chain where nothing traded publishes no fixed-tenor skew from stale quotes");
}

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

  const soon = chain().filter((r) => /260831/.test(r.option_symbol));
  const built = buildChainPanels(soon, { spot: SPOT, asOf: "2026-08-29" });
  eq(built.scalars.skew, null, "a chain inside the day floor publishes no skew");
  ok(/reached 7 days|reached \d+ days/.test(built.skewTerm.skewReason),
     `and names the floor (${built.skewTerm.skewReason})`);
  eq(built.scalars.term, null, "nor a term structure from one expiry");
  ok(built.skewTerm.termReason, "with its own reason");
}

{

  const rows = chain({ strikeStep: 0.07 });
  const built = buildChainPanels(rows, { spot: SPOT, asOf: ASOF });
  const b = built.skewTerm.skewBasis;
  ok(b, "a coarse ladder still produces a reading");
  eq(b.putPlaced, "interpolated",
     "with both strikes around the target traded, the put wing is interpolated in ln(K/S)");
  near(b.putM, -SKEW_MONEYNESS, "to exactly the target, so two names' wings sit at the same moneyness", 1e-9);
  eq(b.putFrom.length, 2, "and the two strikes it was read between are published");
  ok(b.putFrom[0] < SPOT * Math.exp(-SKEW_MONEYNESS) && b.putFrom[1] > SPOT * Math.exp(-SKEW_MONEYNESS),
     `on either side of the target strike (${b.putFrom.join(", ")})`);
  eq(b.putStrike, null, "with no single strike claimed for it");
  const lo = Math.log(b.putFrom[0] / SPOT), hi = Math.log(b.putFrom[1] / SPOT);
  const at = (m) => ivOf(m, b.days) + PUT_LIFT / 2;
  near(b.putIv, Number((at(lo) + (at(hi) - at(lo)) * (-SKEW_MONEYNESS - lo) / (hi - lo)).toFixed(4)),
       "the wing vol is the straight line between the two quoted vols", 2e-3);
  eq(b.callPlaced, "nearest",
     "while the call wing, whose upper strike sits a hair past the window after cent rounding, " +
     "has no bracket to draw between and keeps the nearest strike");
  near(b.offset, Math.abs(b.callM - SKEW_MONEYNESS), "so the stated offset is the call wing's alone", 1e-4);

  const halfTraded = chain({ strikeStep: 0.07, volumeAt: (m) => (m < -0.12 ? 0 : 500) });
  const hb = buildChainPanels(halfTraded, { spot: SPOT, asOf: ASOF }).skewTerm.skewBasis;
  eq(hb.putPlaced, "nearest",
     "when the strike below the target did not trade, NO line is drawn between a traded and an " +
     "untraded quote — the wing falls back to the nearest traded strike");
  ok(Math.abs(Math.abs(hb.putM) - SKEW_MONEYNESS) > 1e-3,
     `so the put leg does NOT sit on the target (${hb.putM})`);
  ok(Math.abs(hb.putM + SKEW_MONEYNESS) <= SKEW_TOLERANCE + 1e-9,
     "but sits inside the stated tolerance");
  near(hb.putIv, Number((ivOf(hb.putM, hb.days) + PUT_LIFT / 2).toFixed(4)),
       "and the published wing vol is the QUOTED vol at the strike used", 2e-3);
  ok(hb.offset > 0.01, `and the total offset from the targets is stated (${hb.offset})`);

  const sparse = chain({ strikeStep: 0.20 });
  const far = buildChainPanels(sparse, { spot: SPOT, asOf: ASOF });
  eq(far.scalars.skew, null,
     "a ladder with nothing inside the tolerance publishes NO skew rather than reaching further");
  ok(/within/.test(far.skewTerm.skewReason), `and says so (${far.skewTerm.skewReason})`);
}

{
  const rows = [];
  while (rows.length < CHAIN_PAGE_SIZE) rows.push(...chain());
  const built = buildChainPanels(rows.slice(0, CHAIN_PAGE_SIZE), { spot: SPOT, asOf: ASOF });
  eq(built.truncated, true,
     "a chain that filled the page is reported as truncated — partial coverage is stated, not hidden");
  eq(built.rowsSeen, CHAIN_PAGE_SIZE, "with the row count it actually saw");

  eq(built.scalars.skew, null, "a truncated chain publishes NO skew");
  eq(built.skewTerm.skew30, null,
     "nor a fixed-tenor skew: the two expiries bracketing 30 days are as unidentifiable in an " +
     "arbitrary 500-row subset as the nearest one, and this page read 0.074 off it before the cut");
  eq(built.skewTerm.skew30Basis, null, "with no basis to describe");
  eq(built.scalars.term, null, "no term structure");
  eq(built.scalars.atmIv, null, "and no at-the-money level");
  for (const key of ["skewReason", "skew30Reason", "termReason", "atmReason"]) {
    ok(/arbitrary subset|no documented order/.test(String(built.skewTerm[key])),
       `${key} names the truncation rather than blaming the data (${built.skewTerm[key]})`);
  }
  eq(built.ivSurface.status, "ok",
     "while the surface still builds, because a partial view of a book is a real view of part of it");
}

{
  const book = [];
  for (let k = 0; book.length < 2 * CHAIN_PAGE_SIZE + 150; k++) {
    for (const r of chain()) {
      book.push({ ...r, option_symbol: r.option_symbol.replace(/^TST/, "T" + String.fromCharCode(65 + k) + "Z") });
    }
  }
  const whole = book.slice(0, 2 * CHAIN_PAGE_SIZE + 150);
  const pageOf = (p) => whole.slice(p * CHAIN_PAGE_SIZE, (p + 1) * CHAIN_PAGE_SIZE);

  const done = mergeChainPages([pageOf(0), pageOf(1), pageOf(2)]);
  eq(done.rows.length, whole.length, "three pages of a 1,150-contract book merge to all of it");
  eq(done.complete, true, "and a short last page with no repeat is the whole book");
  eq(done.duplicates, 0, "with nothing read twice");

  const full = mergeChainPages([pageOf(0), pageOf(1)]);
  eq(full.complete, false, "a last page that is still full leaves the book unfinished");

  const ignored = mergeChainPages([pageOf(0), pageOf(0)]);
  eq(ignored.duplicates, CHAIN_PAGE_SIZE,
     "a vendor that ignores `page` returns the first page again, and every row of it is a repeat");
  eq(ignored.rows.length, CHAIN_PAGE_SIZE, "which the merge keeps once");
  eq(ignored.complete, false, "and never calls complete, whatever the last page's length");
  eq(mergeChainPages([pageOf(0), []]).complete, true,
     "an empty page after a full one is the end of a book of exactly one page");
  ok(CHAIN_MAX_PAGES >= 2, `the pipeline reads up to ${CHAIN_MAX_PAGES} pages a name`);

  const opts = { spot: SPOT, asOf: ASOF };
  const truncatedRead = buildChainPanels(done.rows, opts);
  eq(truncatedRead.truncated, true, "on row count alone, 1,150 contracts look like a truncated page");
  const paged = buildChainPanels(done.rows, { ...opts, complete: true, pages: 3 });
  eq(paged.truncated, false, "while a book read to its short last page is complete");
  eq(paged.pagesRead, 3, "and says how many pages it took");
  ok(paged.unusualRows.every((r) => r.p === 0), "so its unusual-activity rows are not flagged as partial");
  const stillFull = buildChainPanels(full.rows, { ...opts, complete: false, pages: 2 });
  ok(stillFull.truncated && /last of 2 pages/.test(stillFull.skewTerm.skewReason),
     `a book still full at its last page stays truncated and says how far it was read (${stillFull.skewTerm.skewReason})`);
}

{
  const built = buildChainPanels(chain(), { spot: SPOT, asOf: ASOF });
  ok(built.scalars.skew !== null, "the fixture reads a skew");
  eq(built.scalars.skewDays, built.skewTerm.skewBasis.days,
     "and the board-bound scalar carries the tenor it was read at");
  ok(built.scalars.skewDays >= SKEW_MIN_DAYS,
     `which respects the floor (${built.scalars.skewDays}d)`);
}

{
  const rows = [];
  while (rows.length < CHAIN_PAGE_SIZE) rows.push(...chain());
  const built = buildChainPanels(rows.slice(0, CHAIN_PAGE_SIZE), { spot: SPOT, asOf: ASOF });
  eq(built.truncated, true, "the builder knows it filled the page");

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

{
  const built = buildChainPanels(chain(), { spot: SPOT, asOf: ASOF });
  const bytes = JSON.stringify({
    ivSurface: built.ivSurface, skewTerm: built.skewTerm,
    topContracts: built.topContracts, aggressor: built.aggressor,
  }).length;
  ok(bytes < 14 * 1024,
     `four chain panels cost ${(bytes / 1024).toFixed(1)}KB, inside the budget the 100KB ` +
     "card self-check leaves them");

  const surfaceJson = JSON.stringify(built.ivSurface);
  const ivKeys = (surfaceJson.match(/"iv"/g) || []).length;
  ok(ivKeys <= 2, `the surface names "iv" ${ivKeys} time(s), not once per cell`);
}

{

  const spot = 100;
  const sym = (exp, cp, k) =>
    `AAPL${exp.slice(2).replace(/-/g, "")}${cp}${String(k * 1000).padStart(8, "0")}`;
  const row = (exp, cp, k, iv) => ({
    option_symbol: sym(exp, cp, k), nbbo_bid: "1.00", nbbo_ask: "1.10",
    implied_volatility: String(iv), volume: "100", ask_volume: "60", bid_volume: "40",
    open_interest: "500", prev_oi: "480",
  });

  const oneExpiry = [];
  for (let i = 0; oneExpiry.length < 500; i++) {
    const k = 60 + (i % 200) * 0.5;
    oneExpiry.push(row("2026-09-04", k < spot ? "P" : "C", Number(k.toFixed(0)) || 1, 0.30));
  }

  const unasked = buildChainPanels(oneExpiry, { spot, asOf: "2026-08-26", ticker: "AAPL" });
  eq(unasked.truncated, true, "a 500-row page is truncated whatever it contains");
  eq(unasked.scalars.skew, null,
     "and with NO expiry requested its scalars are refused — a page that happens to hold one " +
     "expiry proves nothing about whether the book has a nearer one");
  eq(unasked.identifiedExpiry, null, "so nothing is claimed as identified");

  const asked = buildChainPanels(oneExpiry, {
    spot, asOf: "2026-08-26", ticker: "AAPL", requestedExpiry: "2026-09-04",
  });
  eq(asked.truncated, true, "the same page is still a full page");
  eq(asked.identifiedExpiry, "2026-09-04",
     "but asked for that expiry AND answered with it, the subset is the one that was named");
  ok(asked.scalars.atmIv !== null,
     "so the at-the-money level publishes: identification came from the REQUEST, made against " +
     "a complete expiry list, not from guessing at an arbitrary page");

  const mixed = oneExpiry.slice(0, 480)
    .concat(Array.from({ length: 20 }, (_, i) => row("2026-10-16", "C", 100 + i, 0.28)));
  const ignored = buildChainPanels(mixed, {
    spot, asOf: "2026-08-26", ticker: "AAPL", requestedExpiry: "2026-09-04",
  });
  eq(ignored.identifiedExpiry, null,
     "a single-expiry REQUEST answered with two expiries is the filter being ignored, and the " +
     "refusal stands — the request is not taken on trust");
  eq(ignored.scalars.skew, null, "so no scalar is published from it");

  const wrongExpiry = buildChainPanels(oneExpiry, {
    spot, asOf: "2026-08-26", ticker: "AAPL", requestedExpiry: "2026-09-18",
  });
  eq(wrongExpiry.identifiedExpiry, null,
     "one expiry back, but not the one that was asked for, identifies nothing");
}

{

  const coarse = buildChainPanels(chain({ strikeStep: 0.15 }), { spot: SPOT, asOf: ASOF });
  eq(coarse.scalars.skew, null, "a ladder that steps past the window carries no skew");
  const miss = coarse.skewTerm.skewMiss;
  ok(miss, "and the miss is published as numbers, not only as prose");
  ok(miss.put && miss.call, "with both wings measured, because either can be the one that failed");
  ok(miss.call.listed > 0, "the call wing HAS contracts listed — this is not an absence");
  ok(miss.call.nearest !== null,
     "and a nearest priced candidate, so the miss has a distance");
  ok(miss.call.nearest > SKEW_TOLERANCE,
     `whose distance is outside the window (${miss.call.nearest} > ${SKEW_TOLERANCE}) — ` +
     `which is what makes it a ladder-spacing miss rather than a coverage one`);
  ok(Math.abs(miss.call.nearest - 0.05) < 1e-6,
     `and it is the 0.05 the fixture was built to produce, not an accident (${miss.call.nearest})`);
  eq(miss.call.unpriced, 0, "nothing inside the window was unpriced here");
  ok(/nearest priced strike/.test(coarse.skewTerm.skewReason),
     "the reason names the nearest strike and its distance");
  ok(/ladder-spacing problem a wider\s+tolerance would fix|ladder-spacing/.test(
       coarse.skewTerm.skewReason.replace(/\s+/g, " ")),
     "and says plainly that this is the case a wider window would catch");

  const unpricedRows = chain().map((r) => {
    const m = Math.log(Number(String(r.option_symbol).slice(-8)) / 1000 / SPOT);
    return Math.abs(m - 0.10) <= SKEW_TOLERANCE && String(r.option_symbol).includes("C")
      ? { ...r, implied_volatility: null }
      : r;
  });
  const unpriced = buildChainPanels(unpricedRows, { spot: SPOT, asOf: ASOF });

  eq(unpriced.scalars.skew, null, "nulling the call wing's IV really does cost the skew");
  ok(unpriced.skewTerm.skewMiss, "and the staged case reaches the diagnostic");
  {
    const m2 = unpriced.skewTerm.skewMiss;
    ok(m2.call.listed > 0, "the unpriced wing is still LISTED — absence and silence differ");
    ok(m2.call.nearest === null || m2.call.unpriced > 0,
       "and the diagnostic records it as unpriced rather than as a distance a window could close");
    ok(/no implied volatility/.test(unpriced.skewTerm.skewReason),
       "the reason says so in words");
  }

  const noCalls = chain().filter((r) => !String(r.option_symbol).includes("C"));
  const oneSided = buildChainPanels(noCalls, { spot: SPOT, asOf: ASOF });
  eq(oneSided.scalars.skew, null, "a chain with no calls carries no skew");
  ok(oneSided.skewTerm.skewMiss, "and the one-sided chain reaches the diagnostic too");
  {
    eq(oneSided.skewTerm.skewMiss.call.listed, 0,
       "and the call wing reports zero listed, which is a third finding again");
    ok(/no contract of that type listed/.test(oneSided.skewTerm.skewReason),
       "named as such rather than as a distance");
  }

  const fine = buildChainPanels(chain(), { spot: SPOT, asOf: ASOF });
  ok(fine.scalars.skew !== null, "the default fixture does carry a skew");
  eq(fine.skewTerm.skewMiss, null, "so it publishes no miss diagnostic");
  eq(fine.skewTerm.skewReason, null, "and no reason");
}

{
  const wing = (o) => ({ listed: 4, unpriced: 0, nearest: null, nearestM: null,
    nearestStrike: null, ...o });
  const misses = [

    { expiry: "2026-09-18", days: 21,
      put: wing({ nearest: 0.01 }), call: wing({ nearest: 0.045 }) },

    { expiry: "2026-09-18", days: 21,
      put: wing({ nearest: 0.055 }), call: wing({ nearest: 0.07 }) },

    { expiry: "2026-09-18", days: 21,
      put: wing({ nearest: 0.02 }), call: wing({ nearest: null, unpriced: 2 }) },

    { expiry: "2026-09-18", days: 21,
      put: wing({ nearest: 0.03 }), call: wing({ listed: 0 }) },
  ];
  const sum = summariseSkewMisses(misses, { tolerance: 0.04 });

  eq(sum.names, 4, "four names contributed misses");
  eq(sum.wings, 8, "and eight wings between them");

  eq(sum.unlisted + sum.unpriced + sum.inside + sum.outside, sum.wings,
     `the four groups partition the wings exactly ` +
     `(${sum.unlisted} unlisted + ${sum.unpriced} unpriced + ${sum.inside} inside + ` +
     `${sum.outside} outside = ${sum.wings})`);
  eq(sum.unlisted, 1, "one wing was not listed at all");
  eq(sum.unpriced, 1, "one was listed and carried no implied volatility");
  eq(sum.inside, 3, "three were already inside the window — the OTHER wing failed on those");
  eq(sum.outside, 3, "and three were priced but outside it");

  ok(!sum.gaps.includes(0.01) && !sum.gaps.includes(0.02) && !sum.gaps.includes(0.03),
     "wings already inside the window are kept out of the near-miss distances");

  assert.deepEqual(sum.gaps, [0.045, 0.055, 0.07],
    "the distances are the outside ones, sorted nearest first"); checks++;

  eq(sum.wouldCatch(0.05), 1, "a 0.05 window reaches one of the three outside wings");
  eq(sum.wouldCatch(0.06), 2, "0.06 reaches two");
  eq(sum.wouldCatch(0.08), 3, "0.08 reaches all three");
  eq(sum.wouldCatch(0.04), 0, "and the current window reaches none of them, by construction");

  const recovered = misses.filter((m) =>
    [m.put, m.call].every((w) => w.listed && w.nearest !== null && w.nearest <= 0.08)).length;
  eq(recovered, 2,
     "at 0.08 only two of the four names get BOTH wings — the other two are held back by " +
     "an unpriced and an unlisted wing that no window can reach");
  ok(sum.wouldCatch(0.08) !== recovered,
     `so wings caught (${sum.wouldCatch(0.08)}) and names recovered (${recovered}) are ` +
     `genuinely different numbers, which is why the log says WINGS`);

  const none = summariseSkewMisses([], { tolerance: 0.04 });
  eq(none.names, 0, "a run with no misses summarises to zero");
  eq(none.outside, 0, "with no distances");
  eq(none.wouldCatch(0.9), 0, "and nothing for any window to catch");
  eq(summariseSkewMisses(null).names, 0, "and a null list is not a crash");
}

console.log(`✓ flows-chain: ${checks} assertions — a smile whose skew is known in closed form, ` +
  `wings interpolated to the target between two traded strikes or read off the nearest listed ` +
  `strike, never between a traded and an untraded quote, a fixed 30-day skew in total ` +
  `variance, one at-the-money answer shared ` +
  `with the surface, an aggressor ladder signed by what the buyer is long and withheld rather ` +
  `than zeroed when the vendor did not report it, and a tape that keeps the no-bid contract ` +
  `the sale pricer must refuse`);
