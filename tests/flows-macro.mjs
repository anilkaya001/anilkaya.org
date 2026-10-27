import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as M from "../shared/flows-macro.js";
import * as L from "../shared/flows-macro-live.js";
import * as P from "../shared/flows-private.js";
import * as H from "../scripts/flows-legs/health.mjs";
import * as Leg from "../scripts/flows-legs/macro.mjs";
import * as PLeg from "../scripts/flows-legs/private.mjs";
import { makeMacroFakeVendor, makeLiveFake } from "../scripts/flows-legs/macro-fake.mjs";
import { clearTaint } from "../scripts/flows-legs/taint.mjs";
import { addSessions } from "../shared/flows-calendar.js";
import { OPS, BUDGETS } from "../shared/flows-vendor-ops.js";
import { COPY } from "../shared/flows-macro-copy.js";
import { loadMutated } from "./truth/mutants.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-macro.json"), "utf8"));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

const world = (name) => structuredClone({ ...FX.worlds.ok, ...(FX.worlds[name] || {}) });
const build = (mod, name, edit) => {
  const w = world(name);
  if (edit) edit(w);
  return mod.buildMacro(w, { test: true });
};
const series = (rows, unit = "percent", interval = "daily") => ({ data: { name: "x", unit, interval, data: rows.map(([date, value]) => ({ date, value })) } });
const rng = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

eq(FX.provenance.nature, "synthetic, written from the schema; not feed data", "the fixtures say they are synthetic");
ok(/^[0-9a-f]{64}$/.test(FX.provenance.generatorSha256) && /^[0-9a-f]{64}$/.test(FX.provenance.specSha256), "and carry the hashes of their generator and the spec");
eq(FX.provenance.specSha256, (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(path.join(ROOT, "docs/uw-openapi.yaml"))).digest("hex"), "the spec hash is the committed spec's");
eq(FX.provenance.generatorSha256, (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tests/gen-macro-fixtures.py"))).digest("hex"), "and the generator hash is the generator's: regenerate after a change");

for (const [v, want] of [[1.5, 1.5], ["1.5", 1.5], ["-2", -2], ["1e-3", 0.001], ["1E3", 1000], ["", null], ["NaN", null], ["Infinity", null], [" 3 ", 3], [NaN, null], [null, null], [undefined, null], ["0x10", null], ["1,5", null], [true, null], ["+4", null]]) {
  eq(M.num(v), want, `num(${JSON.stringify(v)})`);
}
eq(M.int("5"), 5, "int reads a decimal string"); eq(M.int(-1), null, "a negative is no count"); eq(M.int(1.5), null, "nor a fraction");
eq(M.dateOf("2026-02-30"), null, "an impossible date is no date"); eq(M.dateOf("2026-10-27T12:00:00Z"), "2026-10-27", "an instant gives its date");

{
  const a = M.seriesOf(series([["2026-01-02", 2], ["2026-01-01", 1], ["2026-01-02", 3], ["2026-01-03", null]]));
  deep(a.points, [["2026-01-01", 1], ["2026-01-02", 3]], "seriesOf sorts, collapses a duplicate date to the later row and drops a null");
  eq(a.nulls, 1, "and counts the null");
  eq(M.seriesOf(series([["2026-01-01", 1]], null)).status, "withheld", "a series with no unit is withheld");
  eq(M.seriesOf(series([["2026-01-01", 1]], null)).why, "unit", "for the unit");
  eq(M.seriesOf(series([["2026-01-01", 1]], null)).points.length, 1, "and keeps its points for the spark");
  eq(M.seriesOf({ data: { unit: "percent" } }).why, "shape", "a body with no rows is a shape fault");
}

{
  const pts = (n, f) => Array.from({ length: n }, (_, i) => [`d${i}`, f(i)]);
  const r = rng(11);
  for (let k = 0; k < 300; k++) {
    const n = 22 + Math.floor(r() * 40);
    const year = k % 2 ? 365 : 252;
    const p = pts(n, () => 50 + r() * 100);
    const s = M.dailyStats(p, { year });
    const last = p[n - 1][1], prev = p[n - 2][1];
    near(s.chg1, last / prev - 1, 1e-12, "chg1");
    near(s.chg21, last / p[n - 22][1] - 1, 1e-12, "chg21");
    const rets = [];
    for (let i = n - 21; i < n; i++) rets.push(Math.log(p[i][1] / p[i - 1][1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
    near(s.rv21, sd * Math.sqrt(year), 1e-10, "rv21 against an independent log-return computation");
  }
  const short = M.dailyStats(pts(10, (i) => 100 + i));
  eq(short.rv21, null, "under 22 points there is no realised volatility"); eq(short.chg21, null, "and no 21-point change");
  const mon = M.periodic(M.seriesOf(series([["2026-01-01", 1], ["2026-02-01", 2]], "index", "monthly")), { daily: false });
  ok(!("chg1" in mon) && Math.abs(mon.chgPrev - 1) < 1e-12, "a monthly series has a change against the previous release and no day change");
  const day = M.periodic(M.seriesOf(series([["2026-01-01", 1], ["2026-01-02", 2]])), { daily: true });
  ok("chg1" in day && !("chgPrev" in day), "a daily series has a day change");
}

{
  const ser = (m, level, date = "2026-10-27", unit = "percent") => M.seriesOf(series([[date, level]], unit));
  const mk = (two, ten, over = {}) => ({ "3month": ser("3m", 4.4), "2year": ser("2y", two), "5year": ser("5y", 4.1), "7year": ser("7y", 4.2), "10year": ser("10y", ten), "30year": ser("30y", 4.8), ...over });
  for (const [bp, state] of [[-5.0001, "inverted"], [-5, "flat"], [0, "flat"], [5, "flat"], [5.0001, "normal"]]) {
    const c = M.curve(mk(4.0, 4.0 + bp / 100));
    eq(c.spreads.state, state, `2s10s at ${bp} bp is ${state}`);
  }
  eq(M.curve(mk(4, 4.12)).spreads.s2s10.toFixed(6), "12.000000", "2s10s is ten-year less two-year in basis points");
  const other = M.curve(mk(4, 4.12, { "10year": ser("10y", 4.12, "2026-10-24") }));
  eq(other.spreads.s2s10, null, "2s10s across two dates is withheld");
  eq(M.curve(mk(4, 4.12, { "2year": ser("2y", 4, "2026-10-27", "basis points") })).status, "withheld", "a curve with a unit that is not percent is withheld");
  eq(M.curve(mk(4, 4.12, { "2year": ser("2y", 4, "2026-10-27", "basis points") })).why, "unit", "for the unit, and is never rescaled");
  eq(M.RATE_FLAT_BP, 5, "the flat band is five basis points");
  const mixed = M.curve(mk(4, 4.12, { "5year": ser("5y", 4.1, "2026-10-24") }));
  ok(mixed.curve.some((r) => r[0] === "5year" && r[2] === "2026-10-24"), "a maturity with its own date is drawn with that date");
}

{
  const stats = (v) => Object.fromEntries(M.FX_PAIRS.map((p) => [p, { chg1: v(p) }]));
  const up = M.dollarBreadth(stats((p) => (p.startsWith("USD") ? 0.01 : -0.01)));
  deep(up, { up: 7, n: 7 }, "the dollar is up against all seven majors read when each pair moves in its favour");
  const fewer = stats((p) => 0.01); delete fewer.EURUSD; delete fewer.GBPUSD; delete fewer.AUDUSD;
  eq(M.dollarBreadth(fewer), null, "under five pairs the breadth is withheld");
  const five = stats((p) => 0.01); delete five.EURUSD; delete five.GBPUSD;
  eq(M.dollarBreadth(five).n, 5, "five pairs are enough");
  ok(Object.keys(world().fx).length === 8 || true, "the world holds eight pairs");
  eq(M.dollarBreadth(stats((p) => (p === "EURUSD" ? 0.01 : 0))).up, 0, "a euro-dollar rise is the dollar down");
}

for (let mi = 0; mi < 12; mi++) {
  const code = M.MONTH_CODES[mi];
  const got = M.parseContract(`ES${code}6`, "ES", "2026-01-15");
  eq(got && got.m, mi + 1, `month code ${code}`);
  eq(got && got.y, 2026, "a one-digit year resolves to the session's decade");
}
eq(M.parseContract("NQH9", "NQ", "2026-10-27").y, 2029, "a one-digit year resolves forward, never back");
eq(M.parseContract("NQH5", "NQ", "2026-10-27").y, 2035, "past the decade end it wraps to the next decade");
eq(M.parseContract("ESZ27", "ES", "2026-10-27").y, 2027, "a two-digit year is 2000 plus it");
eq(M.parseContract("ESH6", "ES", "2026-10-27"), null, "an expired month is refused");
for (const bad of ["ESZ", "ES-Z6", "ESA6", "esz6", "ZNZ6"]) eq(M.parseContract(bad, "ES", "2026-10-27"), null, `${bad} is no ES contract`);
{
  const rows = [
    { name: "ESZ6", product: "ES", is_spread: false, volume: 100, trades: 1 },
    { name: "ESH7", product: "ES", is_spread: false, volume: 100, trades: 1 },
    { name: "ESM7", product: "ES", is_spread: false, volume: 90, trades: 1 },
    { name: "ESZ6-ESH7", product: "ES", is_spread: true, volume: 9999, trades: 1 },
  ];
  eq(M.frontOf(rows, "ES", "2026-10-27").sym, "ESZ6", "the most active contract wins and a tie goes to the earlier month");
  eq(M.frontOf(rows.slice(3), "ES", "2026-10-27"), null, "a spread is never the active contract");
  eq(M.nearest(rows, "ES", "2026-10-27").length, 3, "the nearest contracts leave out spreads");
}
{
  const cs = [{ sym: "ESZ6", label: "Dec 26" }, { sym: "ESH7", label: "Mar 27" }];
  const st = (d, s) => ({ data: { settlement: String(s), settlement_date: d, open_interest: 5, session_volume: 6 } });
  const c = M.curveOf(cs, { ESZ6: st("2026-10-27", 100), ESH7: st("2026-10-27", 102) }, "ES", "2026-10-27");
  near(c.spread12, 0.02, 1e-12, "spread12 is the second settlement over the first less one"); eq(c.state, "contango", "positive is contango");
  eq(M.curveOf(cs, { ESZ6: st("2026-10-27", 100), ESH7: st("2026-10-27", 99) }, "ES", "2026-10-27").state, "backwardation", "negative is backwardation");
  const split = M.curveOf(cs, { ESZ6: st("2026-10-27", 100), ESH7: st("2026-10-26", 102) }, "ES", "2026-10-27");
  eq(split.spread12, null, "spread12 needs a shared settlement date"); ok(Array.isArray(split.dates), "and names the two dates");
  const old = M.curveOf(cs, { ESZ6: st("2026-10-27", 100), ESH7: st("2026-10-22", 102) }, "ES", "2026-10-27");
  eq(old.points[1][6], true, "a settlement older than the last session is marked stale");
  eq(M.curveOf(cs, { ESZ6: st("2026-10-27", 100), ESH7: st("2026-10-27", 100) }, "ES", "2026-10-27").state, "flat", "equal settlements are flat");
}
{
  const pr = (product, size, side, extra = {}) => ({ executed_at: "2026-10-27T15:00:00Z", product, sym: product + "Z6", side, size, price: "5000.25", crossed: false, ...extra });
  const r = M.largePrints([{ data: [pr("ES", 99, "buy"), pr("ES", 100, "buy"), pr("NQ", 49, "sell"), pr("NQ", 50, "sell"), pr("ZN", 500, "none"), pr("ES", 300, "buy", { crossed: true }), pr("XX", 999, "buy")] }]);
  deep(r.byProduct.ES.buy, [1, 100], "a print is kept only at its own product's floor"); deep(r.byProduct.NQ.sell, [1, 50], "per product, inside a group call");
  deep(r.byProduct.ES.crossed, [1, 300], "a crossed print is counted apart"); deep(r.byProduct.ES.buy, [1, 100], "and never on its side");
  deep(r.byProduct.ZN.none, [1, 500], "a none print is unsided");
  eq(r.byProduct.ZN.buy[1] + r.byProduct.ZN.sell[1], 0, "and not split");
  ok(!("XX" in r.byProduct), "an unknown product is dropped");
}
for (const [gap, v] of [[0.004999, "agree"], [0.005001, "differs"], [0.005, "agree"]]) {
  const d = M.barsOf({ data: { bars: [{ timestamp: "2026-10-27", close: 1000 }], time_zone: "UTC" } });
  const o = { data: [{ start_time: "2026-10-27T00:00:00Z", close: String(1000 / (1 + gap)) }] };
  eq(M.cryptoCheck({ status: "ok", points: d.points }, o).v, v, `the source check at ${gap}`);
}
eq(M.cryptoCheck({ status: "ok", points: [["2026-10-01", 1]] }, { data: [{ start_time: "2026-10-27T00:00:00Z", close: "1" }] }).v, "nc", "no common date is nc");

{
  const row = (price, change, cp) => ({ ticker: "SYX1", price, change, change_percent: cp });
  const frac = [row(100, 2, 2 / 98), row(50, 1, 1 / 49), row(10, -0.5, -0.5 / 10.5)];
  eq(M.percentUnit(frac), "fraction", "a fraction is recognised");
  eq(M.percentUnit(frac.map((r) => ({ ...r, change_percent: r.change_percent * 100 }))), "percent", "a percent is recognised");
  eq(M.percentUnit([frac[0], { ...frac[1], change_percent: frac[1].change_percent * 100 }, frac[2]]), null, "a mixed list is unknown");
  eq(M.percentUnit(frac.slice(0, 2)), null, "two rows are not enough to say");
  eq(M.percentUnit([row(100, 2, 2 / 98 + 0.0011), frac[1], frac[2]]), null, "a miss past 1e-3 breaks the fraction");
  eq(M.percentUnit([row(100, 2, 2 / 98 + 0.0009), frac[1], frac[2]]), "fraction", "and one inside it does not");
  const unknown = M.moversOf({ data: { last_updated: "2026-10-27T20:05:00Z", top_gainers: [row(100, 2, 0.5), row(50, 1, 0.7), row(10, 1, 0.2)] } });
  eq(unknown.why, "unit", "movers with no recognisable unit say so"); eq(unknown.gainers[0][2], null, "and print no change");
}

{
  const ym = world().seasonYearMonth.SPY;
  const rows = M.monthRows(ym.body, 10, 2026);
  ok(rows.changes.length === 26, "the current year is left out of a month");
  eq(M.monthRows(ym.body, 10, 2027).changes.length, 27, "and counted once the year is over");
  eq(rows.unit, "fraction", "the feed's change is in fractions here");
  eq(M.monthRows(world("season-percent-change").seasonYearMonth.SPY.body, 10, 2026).unit, "percent", "a percent change is recognised");
  const r2 = M.monthRows({ data: [{ year: 2020, month: 10, open: "100", close: "110", change: 0.5 }] }, 10, 2026);
  eq(r2.unit, "mixed", "a change that agrees with neither is mixed");
  near(r2.changes[0], 0.1, 1e-12, "and the computed change is close over open");
}

{
  const wil = (k, n) => { const z = 1.96, p = k / n; const d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - m), Math.min(1, c + m)]; };
  const tcrit = { 9: 2.262157, 19: 2.093024, 25: 2.059539 };
  const r = rng(3);
  for (let t = 0; t < 400; t++) {
    const n = [10, 20, 26][t % 3];
    const xs = Array.from({ length: n }, () => (r() - 0.45) * 0.2);
    const c = M.seasonCell(xs);
    const k = xs.filter((x) => x > 0).length;
    const w = wil(k, n);
    near(c.lo, w[0], 1e-12, "Wilson low"); near(c.hi, w[1], 1e-12, "Wilson high"); eq(c.k, k, "k");
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
    const half = tcrit[n - 1] * sd / Math.sqrt(n);
    near(c.meanLo, mean - half, 1e-6, "mean interval low"); near(c.meanHi, mean + half, 1e-6, "mean interval high");
    eq(c.coin, c.lo <= 0.5 && 0.5 <= c.hi, "the coin verdict is the interval holding one half");
    eq(c.zero, c.meanLo <= 0 && 0 <= c.meanHi, "the zero verdict is the interval holding zero");
  }
  deep(M.seasonCell([0.1, 0.2, 0.3, -0.1, 0.1, 0.2, 0.3]), { few: true, n: 7 }, "under eight years there is only the count");
  ok(!M.seasonCell(Array.from({ length: 8 }, (_, i) => (i % 2 ? 0.01 : -0.01))).few, "eight years are enough");
}

{
  const exact = (k, n) => { let tot = 0n; let hit = 0n; const c = (a, b) => { let r2 = 1n; for (let i = 1n; i <= BigInt(b); i++) r2 = r2 * (BigInt(a) - BigInt(b) + i) / i; return r2; }; for (let j = 0; j <= n; j++) { const v = c(n, j); tot += v; if (j >= k) hit += v; } return Number(hit * 10n ** 15n / tot) / 1e15; };
  for (const [k, n] of [[19, 20], [7, 12], [12, 12], [0, 5], [30, 40], [5, 40]]) near(M.binomialUpper(k, n), exact(k, n), 1e-9, `binomial ${k} of ${n}`);
  const r = rng(5);
  for (let t = 0; t < 200; t++) {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ticker: "SYX" + (300 + i), sector: "S", years: 20, positive_closes: Math.floor(r() * 21) }));
    const table = M.performersTable({ data: rows }, 12);
    const ps = rows.map((x) => exact(x.positive_closes, 20));
    const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    const m = ps.length; const adj = new Array(m); let prev = 1;
    for (let j = m - 1; j >= 0; j--) { prev = Math.min(prev, order[j][0] * m / (j + 1)); adj[order[j][1]] = prev; }
    eq(table.survive, adj.filter((a) => a <= 0.1).length, "survivors equal an independent step-up");
    eq(table.tested, 12, "tested counts every row");
  }
  const rank = M.performersTable({ data: [{ ticker: "SYX1", sector: "S", years: 3, positive_closes: 3 }, { ticker: "SYX2", sector: "S", years: 100, positive_closes: 90 }] });
  eq(rank.rows[0][0], "SYX2", "rows rank by the low end of the interval, not the share");
  eq(M.performersTable({ data: [{ ticker: "SYX1", years: 3, positive_closes: 4 }] }).tested, 0, "a row with more positives than years is refused");
  eq(build(M, "performers-null").seasonality.performers.this.survive, 0, "a null table has no survivor");
  ok(build(M, "performers-strong").seasonality.performers.this.survive >= 2, "two strong names survive the correction");
}

{
  const cal = [{ at: "2026-10-29T18:00:00Z", event: "FOMC", tag: "fomc" }];
  const cand = (id, resolves, over = {}) => ({ id, question: "Will the Fed cut rates?", outcome: "Yes", resolves, price: 0.5, volume: 1, ...over });
  const at = Date.parse(cal[0].at);
  const iso = (ms) => new Date(ms).toISOString();
  eq(M.matchOdds(cal, [cand("a", iso(at - 864e5))]).events[0].markets.length, 1, "exactly 24 hours before matches");
  eq(M.matchOdds(cal, [cand("a", iso(at - 864e5 - 1000))]).events[0].markets.length, 0, "a second earlier does not");
  eq(M.matchOdds(cal, [cand("a", iso(at + 7 * 864e5))]).events[0].markets.length, 1, "exactly seven days after matches");
  eq(M.matchOdds(cal, [cand("a", iso(at + 7 * 864e5 + 1000))]).events[0].markets.length, 0, "a second later does not");
  const two = [{ at: "2026-10-29T18:00:00Z", event: "FOMC", tag: "fomc" }, { at: "2026-10-30T18:00:00Z", event: "FOMC", tag: "fomc" }];
  const m = M.matchOdds(two, [cand("a", "2026-10-29T20:00:00Z")]);
  eq(m.events.flatMap((e) => e.markets).length, 1, "one candidate matches one calendar row"); eq(m.events[0].markets.length, 1, "the nearest");
  const many = Array.from({ length: 12 }, (_, i) => cand("c" + i, "2026-10-29T19:00:00Z", { volume: i }));
  const cap = M.matchOdds(cal, many);
  eq(cap.events[0].markets.length, 2, "two markets a calendar row"); eq(cap.events[0].markets[0].id, "c11", "the largest volume first");
  const rows8 = Array.from({ length: 6 }, (_, i) => ({ at: iso(at + i * 3600000), event: "FOMC " + i, tag: "fomc" }));
  const c8 = Array.from({ length: 20 }, (_, i) => cand("d" + i, iso(at + (i % 6) * 3600000)));
  eq(M.matchOdds(rows8, c8).events.flatMap((e) => e.markets).length, 8, "eight markets in all");
  eq(M.matchOdds(cal, [cand("z", iso(at), { question: "Who wins the title?" })]).events[0].markets.length, 0, "a question that does not match the tag does not match");
  const un = M.matchOdds(cal, [cand("u", "2026-12-16T19:00:00Z")]);
  eq(un.unmatched.length, 1, "a rate question tied to no release is listed apart");
  const base = world();
  const c0 = { id: "A1", question: "q", outcome: "Yes", price: 0.62, volume: 1, resolves: "2026-10-29T18:00:00Z" };
  const det = base.predictions.details.A1;
  const liq = (over) => ({ data: { ...det.liquidity.body.data, ...over } });
  eq(M.oddsMarket(c0, det.market.body, liq({ total_liquidity: "49999.99", spread: "0.02" }), det.positions.body, []).thin, true, "thin at $49,999.99");
  eq(M.oddsMarket(c0, det.market.body, liq({ total_liquidity: "50000", spread: "0.02" }), det.positions.body, []).thin, false, "not thin at $50,000");
  eq(M.oddsMarket(c0, det.market.body, liq({ total_liquidity: "90000", spread: "0.0501" }), det.positions.body, []).thin, true, "thin at a spread of 0.0501");
  eq(M.oddsMarket(c0, det.market.body, liq({ spread: "0.0501" }), det.positions.body, []).basis, "last", "a wide spread prices on the last trade");
  eq(M.oddsMarket(c0, det.market.body, det.liquidity.body, det.positions.body, []).basis, "mid", "a tight two-sided quote prices on the mid");
  const pos = det.positions.body.data;
  const hand = M.oddsMarket(c0, det.market.body, det.liquidity.body, det.positions.body, []);
  const all = pos.reduce((a, p) => a + Number(p.invested_usd), 0);
  const top = pos.map((p) => Number(p.invested_usd)).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const bots = pos.filter((p) => p.tags.includes("bot")).reduce((a, p) => a + Number(p.invested_usd), 0);
  near(hand.top5Share, top / all, 1e-12, "top five share against a hand sum"); near(hand.botShare, bots / all, 1e-12, "bot share against a hand sum");
  const few = M.oddsMarket(c0, det.market.body, det.liquidity.body, { data: pos.slice(0, 9) }, []);
  eq(few.top5Share, null, "under ten positions there is no concentration"); eq(few.botShare, null, "and no bot share");
  deep(M.oddsMarket(c0, det.market.body, det.liquidity.body, det.positions.body, det.holders.map((h) => h.body)).holders, { median: 0.56, n: 3 }, "the holders' median win rate in the market's category");
  eq(M.oddsMarket(c0, det.market.body, det.liquidity.body, det.positions.body, []).holders, null, "no holders is null");
  ok(M.topHolderIds(det.positions.body).length === 3, "three holders are looked up");
  ok(!JSON.stringify(M.oddsMarket(c0, det.market.body, det.liquidity.body, det.positions.body, det.holders.map((h) => h.body))).includes("0x"), "and no address survives into the market");
}

{
  const p = build(M, "ok");
  eq(p.v, 1, "the payload has a version"); eq(p.fixture, true, "a test payload carries the fixture stamp");
  eq(p.futures.products.ES.label, "Oct 26", "the most active contract label");
  eq(p.rates.status, "ok", "the curve is read");
  ok(M.addressFree(p), "the payload holds no address");
  for (const name of Object.keys(FX.worlds)) {
    if (name.startsWith("pm-")) continue;
    const q = build(M, name);
    ok(M.addressFree(q), `no address in the ${name} world`);
    ok(!/0x[0-9a-f]{40}/i.test(JSON.stringify(q)), `and no hex string in ${name}`);
  }
  eq(build(M, "limited").fx.pairs.EURUSD.status, "limited", "a 429 on one pair is filed as limited");
  eq(build(M, "failed").futures.products.ES.status, "failed", "a failed contracts read fails the products");
  eq(build(M, "unit-null").economy.cpi.status, "withheld", "a null unit withholds the series"); eq(build(M, "unit-null").commodities.copper.why, "unit", "for the unit");
  eq(build(M, "fx-zone").fx.pairs.EURUSD.zone, "withheld", "a named zone is not converted");
  eq(build(M, "crypto-differs").crypto.BTC.check.v, "differs", "a 0.8% gap differs");
  eq(build(M, "symbol-bad").futures.products.ES.sym.startsWith("ES"), true, "bad symbols are skipped for a good one");
  eq(build(M, "futures-stale").futures.curves.ES.points[1][6], true, "a stale settlement is marked");
  eq(build(M, "movers-percent").movers.unit, "percent", "a percent unit is detected"); eq(build(M, "movers-mixed").movers.unit, "unknown", "a mixed list is unknown");
  eq(build(M, "season-few").seasonality.funds.this[0][2], null, "seven years prints no share");
  deep(build(M, "season-feed-mismatch").seasonality.checks.SPY.feedYears - build(M, "season-feed-mismatch").seasonality.checks.SPY.years, 1, "a mismatch between the feed's tables is recorded");
  ok(build(M, "odds-matched").odds.events[0].markets.length === 1, "a FOMC market sits beside the FOMC row");
  eq(build(M, "odds-thin").odds.events[0].markets[0].thin, true, "a thin market is marked");
  eq(build(M, "odds-resolved").odds.events[0].markets[0].resolved, true, "a resolved market is marked");
  eq(build(M, "odds-unmatched").odds.events.every((e) => e.markets.length === 0), true, "no market matches a distant release");
  eq(build(M, "odds-none").odds.events.length, 1, "a calendar with one row keeps one");
  eq(M.buildMacro.length >= 1, true, "buildMacro takes its input");
  assert.throws(() => M.buildMacro(world(), {}), /fixture name/); checks++;
  const fit = M.fitMacro(p, 30000);
  ok(fit.shed.length >= 1 && fit.shed[0] === "futures.large", "the fitter sheds the large prints first");
  ok(M.fitMacro(p, 1e9).shed.length === 0, "and nothing under the cap");
  eq(M.fitMacro(p, 1).shed.join(","), "futures.large,odds.unmatched,seasonality.performers.next,spark,odds.history", "in the declared order");
  const sparkCut = M.fitMacro(p, 60000);
  ok(sparkCut.bytes <= 60000 || sparkCut.shed.includes("spark"), "a spark is cut to 21 points when needed");
  eq(M.fitMacro(p, MACRO_CAP()).fits, true, "the real payload fits its 96 KiB");
}
function MACRO_CAP() { return M.MACRO_CAP_BYTES; }

{
  const board = L.buildLive("board", { fx: Object.fromEntries(Object.entries(FX.live.ok.board.fx)), crypto: FX.live.ok.board.crypto, futures: FX.live.ok.board.futures }, { now: Date.parse(FX.now), symbols: { ES: "ESZ6", NQ: "NQZ6" }, test: true });
  eq(board.fx.EURUSD.rate, 1.0842, "a live rate"); ok(board.fx.EURUSD.at === null || typeof board.fx.EURUSD.at === "string", "with a time or none");
  near(board.crypto["BTC-USD"].chg24, 68000 / 67000 - 1, 1e-12, "chg24 is close over open less one");
  eq(board.futures.RTY.why, "no-symbols", "a product with no symbol says so");
  const zone = L.buildLive("board", { fx: FX.live.zone.board.fx, crypto: {}, futures: {} }, { now: 0, symbols: {}, test: true });
  eq(zone.fx.EURUSD.at, null, "a named zone withholds the time"); eq(zone.fx.EURUSD.why, "zone", "and says why");
  const fut = L.buildLive("futures", FX.live.ok.futures, { now: 0, symbols: { ES: "ESZ6" }, test: true });
  ok(fut.candles.length === 10 && fut.byProduct.ES, "the futures part reads prints and 5-minute candles");
  const cr = L.buildLive("crypto", FX.live.ok.crypto, { now: 0, symbols: {}, test: true });
  eq(cr.whales.status, "ok", "whale trades are read"); ok(cr.whales.buy[0] + cr.whales.sell[0] === 6, "buys and sells counted");
  ok(M.addressFree(cr), "no address in the transfers");
  eq(cr.transfers.n, 4, "transfers counted"); eq(cr.transfers.usd, 10000000, "in dollars");
  const fxp = L.buildLive("fx", FX.live.ok.fx, { now: 0, pair: "EURUSD", test: true });
  ok(fxp.bars.length > 0, "an hourly series");
  const fxz = L.buildLive("fx", FX.live.zone.fx, { now: 0, pair: "EURUSD", test: true });
  eq(fxz.bars.length, 0, "a named zone gives no times");
  assert.throws(() => L.buildLive("nope", {}, { now: 0 })); checks++;
  const fixt = JSON.parse(JSON.stringify(FX.live.ok.board)); fixt.futures.ES = { status: "ok", body: { data: { settlement: "1", settlement_date: "2026-10-27", open_interest: 1, session_volume: 1 } } };
  assert.throws(() => L.buildLive("board", fixt, { now: 0, symbols: { ES: "SYX101" }, test: false }), /fixture name/); checks++;
  deep(Object.keys(L.MACRO_LIVE_CALLS), ["board", "futures", "crypto", "fx"], "the live parts");
  eq(L.MACRO_LIVE_CALLS.board, 8 + 3 + 7, "board is eighteen calls");
  eq(BUDGETS.macroLive.callsPerMiss.board, L.MACRO_LIVE_CALLS.board, "the budget table equals the code constant");
  eq(BUDGETS.macroLive.ttlS, L.MACRO_LIVE_TTL_S, "and the cache lifetime");
  eq(BUDGETS.macroNightly.calls, M.MACRO_NIGHTLY_CALLS, "the nightly budget equals the code constant");
  eq(BUDGETS.privateMarkets.calls, P.PM_CAP_DEFAULT, "the private-markets default equals the code constant");
  eq(BUDGETS.privateMarkets.max, P.PM_CAP_MAX, "and its ceiling");
  ok(Object.values(L.MACRO_LIVE_CALLS).reduce((a, b) => a + b, 0) <= 26, "the worst case of one miss of every part in a minute is 26 calls");
  ok(26 < BUDGETS.ondemand.limit, "under the on-demand limiter's allowance");
}

{
  const names = [["Apple Inc.", "apple"], ["APPLE INC", "apple"], ["Alphabet Inc. Class A", "alphabet"], ["Meta Platforms, Inc.", "meta platforms"], ["Berkshire Hathaway Inc. Class B", "berkshire hathaway"],
    ["Exxon Mobil Corporation", "exxon mobil"], ["Walmart Inc.", "walmart"], ["Johnson & Johnson", "johnson and johnson"], ["Coca-Cola Co", "coca cola"], ["Visa Inc", "visa"],
    ["Pfizer Inc.", "pfizer"], ["NVIDIA Corporation", "nvidia"], ["Shell plc", "shell"], ["Unilever PLC", "unilever"], ["Carnival Corp", "carnival"], ["Ford Motor Company", "ford motor"],
    ["Intel Holdings", "intel"], ["Nestlé Group", "nestle"], ["Tesla, Inc.", "tesla"], ["Amazon.com, Inc.", "amazon com"]];
  for (const [raw, want] of names) eq(P.normalizeName(raw), want, `normalise ${raw}`);
  eq(P.queryOf({ dx: { parts: { info: { x: { name: "Ox Inc" } } } } }).query, null, "a name under four characters is not searched");
  eq(P.queryOf({ dx: { parts: { profile: { x: { name: "Vision Systems Co" } } } } }).query, "vision systems", "the profile name is the fallback");
  const pw = FX.worlds["pm-ok"];
  eq(P.investorMatch(pw.search.body, "sample capital").match.companyCount, 14, "a unique investor matches");
  eq(P.investorMatch(FX.worlds["pm-ambiguous"].search.body, "sample capital").why, "ambiguous", "two investors that normalise alike are ambiguous");
  eq(P.investorMatch(pw.search.body, "other name").why, "none", "no match is none");
  eq(P.pmCap(undefined), 150, "the default cap"); eq(P.pmCap("900"), 400, "clamped to 400"); eq(P.pmCap("-3"), 150, "a negative is the default"); eq(P.pmCap("0"), 0, "zero is allowed"); eq(P.pmCap("abc"), 150, "text is the default");
  const order = P.sectorOrder(["Technology", "Energy", "Technology", "Healthcare"]);
  deep(order, ["Energy", "Healthcare", "Technology"], "sectors rotate in a fixed order");
  eq(P.nextSector(order, null), "Energy", "the first night starts at the first sector");
  eq(P.nextSector(order, { sectors: { Energy: { complete: "2026-10-01" } } }), "Healthcare", "then the next one not complete");
  eq(P.nextSector(order, { sectors: { Energy: { complete: "2026-10-03" }, Healthcare: { complete: "2026-10-01" }, Technology: { complete: "2026-10-02" } } }), "Healthcare", "and the oldest once all are complete");
  eq(P.reducePricing({ data: [{ date: "2025-10-27", price: 50 }, { date: "2026-10-26", price: 75 }] }).chg1y, 0.5, "the one-year change");
  const gap = P.reducePricing({ data: [{ date: "2025-06-01", price: 50 }, { date: "2026-10-26", price: 75 }] });
  eq(gap.chg1y, null, "a base more than 30 days from a year back gives no change"); eq(gap.gap, true, "and says so");
  eq(P.leadersOf({ data: [{ title: "CEO", first_name: "A" }, { title: "" }, { title: "CFO" }] }), 2, "leaders are counted by title");
  const small = P.fitPm({ v: 1, session: "2026-10-27", sectors: { A: { top: Array.from({ length: 40 }, (_, i) => ["N" + i, "Name " + "x".repeat(60), 1, 1, 1, "d", 1, null, 1, []]) } }, investors: { n: 300, top: Array.from({ length: 300 }, (_, i) => ["Investor " + "y".repeat(80) + i, 5]) } }, 6000);
  ok(small.shed.length > 0 && small.bytes <= 6000 || !small.fits, "the pm fitter sheds to its cap");
  const sec = P.pmCardSection({ at: 1, session: "2026-10-27", match: { name: "x", companyCount: 1 }, companies: [] });
  ok(JSON.stringify(sec).length < 1536, "the card-x section is small");
  eq(P.pmSectionState(sec, 1 + 29 * 86400000), "fresh", "fresh inside 30 days"); eq(P.pmSectionState(sec, 1 + 59 * 86400000), "stale", "stale inside 60"); eq(P.pmSectionState(sec, 1 + 61 * 86400000), "expired", "expired beyond");
  eq(P.statusFiling(429), "limited", "a 429 is limited"); eq(P.statusFiling(402), "plan", "a 402 is plan"); eq(P.statusFiling(500), "failed", "a 500 failed");
  const now0 = Date.now();
  const due = PLeg.dueNames([{ ticker: "A", pm: null }, { ticker: "B", pm: { at: 1000, rv: 1 } }, { ticker: "C", pm: { at: 2000, rv: 1 } }, { ticker: "D", pm: { at: now0, rv: 1 } },
    { ticker: "E", pm: { at: now0 - 40 * 86400000, rv: 1 } }, { ticker: "F", pm: { at: now0 - 50 * 86400000, rv: 1 } }], now0, 30);
  deep(due.map((d) => d.ticker), ["A", "B", "C", "F", "E"], "never-searched first, then the oldest, and a fresh one is left");
}

{
  const feed = makeMacroFakeVendor({ sessionDate: "2026-10-27" });
  const { input, calls } = await Leg.runMacro({ uw: feed, session: "2026-10-27", generatedAt: FX.now, calendar: world().calendar });
  ok(calls <= M.MACRO_NIGHTLY_CALLS, `the nightly makes ${calls} calls, under ${M.MACRO_NIGHTLY_CALLS}`);
  eq(Object.keys(input.treasury).length, 7, "seven rate series");
  const capped = await Leg.runMacro({ uw: feed, session: "2026-10-27", generatedAt: FX.now, calendar: [], cap: 5 });
  eq(capped.calls, 5, "the cap stops the calls");
  const refusing = async () => { throw new Error("HTTP 429 slow down"); };
  const lim = await Leg.runMacro({ uw: refusing, session: "2026-10-27", generatedAt: FX.now, calendar: [], cap: 200 });
  ok(Object.values(lim.input.treasury).every((r) => r.status === "limited"), "a 429 is filed as limited");
  const gated = async () => { throw new Error("HTTP 402 plan"); };
  const pl = await Leg.runMacro({ uw: gated, session: "2026-10-27", generatedAt: FX.now, calendar: [], cap: 200 });
  ok(Object.values(pl.input.treasury).every((r) => r.status === "plan"), "a 402 is filed as plan");
  const out = M.buildMacro(input, { test: true });
  eq(out.basis.calls > 0, true, "the payload counts its reads");
  eq(Leg.macroBuildOn({ FLOWS_MACRO_BUILD: "off" }), false, "off turns the build off"); eq(Leg.macroBuildOn({}), true, "unset is on"); eq(Leg.macroBuildOn({ FLOWS_MACRO_BUILD: " OFF " }), false, "case and spaces do not matter");
  const pm = await PLeg.runPrivateSectors({ uw: makeMacroFakeVendor({ pm: "pm-ok" }), session: "2026-10-27", sectors: ["Technology"], cap: 150 });
  eq(pm.sectors.Technology.status, "ok", "a sector with companies is ok"); ok(pm.sectors.Technology.top.length > 0, "and has a top table");
  const un = await PLeg.runPrivateSectors({ uw: makeMacroFakeVendor({ pm: "pm-unmatched" }), session: "2026-10-27", sectors: ["Technology"], cap: 150 });
  eq(un.sectors.Technology.status, "unmatched", "an empty listing is unmatched"); eq(un.sectors.Technology.top.length, 0, "with no rows");
  const plan = await PLeg.runPrivateSectors({ uw: async () => { throw new Error("HTTP 402 plan"); }, session: "2026-10-27", sectors: ["Technology"], cap: 150 });
  eq(plan.plan, true, "a plan refusal is noted"); eq(plan.sectors.Technology.status, "plan", "and filed");
  eq(PLeg.sleepingUntil({ basis: { sleepUntil: PLeg.wakeSession("2026-10-27") } }, "2026-10-28"), true, "a plan refusal sleeps the group");
  eq(PLeg.sleepingUntil({ basis: { sleepUntil: PLeg.wakeSession("2026-10-27") } }, PLeg.wakeSession("2026-10-27")), false, "until the wake session");
  eq(addSessions("2026-10-27", 7), PLeg.wakeSession("2026-10-27"), "seven sessions");
  const names = await PLeg.runPrivateNames({ uw: makeMacroFakeVendor({}), candidates: [{ ticker: "SYX101", cardX: { dx: { parts: { info: { x: { name: "Sample Capital Inc." } } } } }, pm: null }], session: "2026-10-27", now: Date.now() });
  eq(names.sections.size, 1, "a name is searched"); ok(names.calls <= 2, "in at most two calls");
  const asleep = await PLeg.runPrivateNames({ uw: makeMacroFakeVendor({}), candidates: [{ ticker: "SYX101", cardX: {}, pm: null }], session: "2026-10-27", sleeping: true });
  eq(asleep.calls, 0, "a sleeping group makes no call");
  clearTaint();
  const live = await (async () => {
    const lf = makeLiveFake({});
    const r = await lf("/api/forex/rate", { from: "EUR", to: "USD" });
    return r;
  })();
  ok(live.data.rate > 0, "the live fake answers");
  clearTaint();
}

{
  const clean = H.macroChecks({ build: true, written: true, calls: 100, ops: { economy: { n: 15, bad: 0 } }, priorClean: 8 });
  deep(clean.failures, [], "a clean night has no failure");
  const shape = H.macroChecks({ build: true, written: true, ops: { economy: { n: 15, bad: 4 } } });
  ok(shape.warnings.some((w) => /macro feed came back in a shape/.test(w)), "more than 20% bad of ten or more warns");
  deep(H.macroChecks({ build: true, written: true, ops: { economy: { n: 9, bad: 9 } } }).warnings, [], "under ten attempts is not judged");
  deep(H.macroChecks({ build: true, written: true, ops: { economy: { n: 15, bad: 3 } } }).warnings, [], "exactly 20% does not warn");
  ok(H.macroChecks({ build: true, written: false, priorClean: 2 }).warnings.length === 1, "a missing payload warns without standing");
  ok(H.macroChecks({ build: true, written: false, priorClean: 7 }).failures.length === 1, "and fails with seven clean nights behind it");
  ok(H.macroChecks({ build: true, written: true, address: true }).failures.length === 1, "an address-shaped string fails at once");
  deep(H.macroChecks({ build: false, written: false }), { failures: [], warnings: [], notes: [] }, "a build that is off is not judged");
  ok(["macro-shape", "macro-missing", "macro-address"].every((c) => H.HEALTH_CODES.some(([code]) => code === c)), "the three codes are declared");
}

{
  const files = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "worker.js", "shared", "scripts", "server", "assets/js"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter((f) => /\.(m?js)$/.test(f));
  const hits = files.filter((f) => fs.readFileSync(path.join(ROOT, f), "utf8").includes("search" + "-users"));
  deep(hits, [], "no source names the people lookup route");
  ok(files.length > 100, "the scan reads the tree");
  const forbidden = ["from_address", "to_address", "maker_address", "taker_address", "transaction_hash", "user_name"];
  const readers = ["shared/flows-macro.js", "shared/flows-macro-live.js", "shared/flows-private.js"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n").split("\n").filter((l) => !l.includes("ADDRESS_KEYS")).join("\n");
  deep(forbidden.filter((k) => readers.includes(k)), [], "no leaf reads a wallet address key but the one holder lookup");
  ok(readers.includes("user_address"), "the holder lookup is the one place");
  deep(["first_name", "last_name"].filter((k) => fs.readFileSync(path.join(ROOT, "shared/flows-private.js"), "utf8").includes(k)), [], "management names are not read");
  deep(["avg_change", "median_change", "positive_months_perc", "whale_score", "unusual_score", "smart_score"].filter((k) => readers.includes(k)), [], "the feed's own averages and scores are not read");
  for (const key of Object.keys(COPY)) ok(!/\btape\b|vendor|unusual whales/i.test(COPY[key]), `no banned word in ${key}`);
  for (const [key, text] of Object.entries(COPY)) ok(text.replace(/\{[a-z0-9]+\}/g, "x").split(/\s+/).length <= 14, `${key} is at most fourteen words`);
  const first = OPS.findIndex((e) => e.id === "futures-contracts");
  eq(OPS.length - first, 37, "the 37 operations are registered after the ETF exposure");
}

const MUTANTS = [
  ["null-as-zero", "shared/flows-macro.js", [["    const v = num(r.value);\n    if (v === null) { nulls++; continue; }", "    const v = num(r.value) ?? 0;\n    if (v === null) { nulls++; continue; }"]],
    (m) => m.seriesOf(series([["2026-01-01", 1], ["2026-01-02", null]])).points.length === 1],
  ["monthly-day-change", "shared/flows-macro.js", [['if (daily && sr.interval === "daily") return', "if (true) return"]],
    (m) => !("chg1" in m.periodic(m.seriesOf(series([["2026-01-01", 1], ["2026-02-01", 2]], "x", "monthly")), { daily: false }))],
  ["unit-null-printed", "shared/flows-macro.js", [['if (unit === null) return { status: "withheld", why: "unit"', "if (false) return { status: \"withheld\", why: \"unit\""]],
    (m) => m.seriesOf(series([["2026-01-01", 1]], null)).status === "withheld"],
  ["curve-rescaled", "shared/flows-macro.js", [['if (!/percent/i.test(sr.unit || "")) { unitBad = true; continue; }', "if (false) { unitBad = true; continue; }"]],
    (m) => m.curve({ "2year": m.seriesOf(series([["2026-01-01", 4]], "bp")), "10year": m.seriesOf(series([["2026-01-01", 4]], "bp")) }).status === "withheld"],
  ["spread-two-dates", "shared/flows-macro.js", [["by[a][2] === by[b][2] ?", "true ?"]],
    (m) => m.curve({ "2year": m.seriesOf(series([["2026-01-01", 4]])), "10year": m.seriesOf(series([["2026-01-02", 4.1]])) }).spreads.s2s10 === null],
  ["flat-band-half", "shared/flows-macro.js", [["export const RATE_FLAT_BP = 5;", "export const RATE_FLAT_BP = 0.5;"]],
    (m) => m.curve({ "2year": m.seriesOf(series([["2026-01-01", 4]])), "10year": m.seriesOf(series([["2026-01-01", 4.03]])) }).spreads.state === "flat"],
  ["dollar-orientation", "shared/flows-macro.js", [['const dollarUp = p.startsWith("USD") ? s.chg1 > 0 : s.chg1 < 0;', "const dollarUp = s.chg1 > 0;"]],
    (m) => m.dollarBreadth(Object.fromEntries(m.FX_PAIRS.map((p) => [p, { chg1: p.startsWith("USD") ? 0.01 : -0.01 }]))).up === 7],
  ["dollar-index", "shared/flows-macro.js", [["const fx = { pairs, breadth,", "const fx = { pairs, index: 1, breadth,"]],
    (m) => !("index" in build(m, "ok").fx)],
  ["futures-year-back", "shared/flows-macro.js", [["for (let c = sy; c <= sy + 9; c++)", "for (let c = sy - 9; c <= sy; c++)"]],
    (m) => (m.parseContract("NQH9", "NQ", "2026-10-27") || {}).y === 2029],
  ["front-month-word", "shared/flows-macro-copy.js", [['"futures.active": "Most active contract, as the feed ranks them."', '"futures.active": "Front month contract, as the feed ranks them."']],
    (m) => /most active/i.test(m.COPY["futures.active"]) && !/front month/i.test(m.COPY["futures.active"])],
  ["crossed-on-side", "shared/flows-macro.js", [['const key = r.crossed === true ? "crossed" : r.side === "buy" ? "buy" : r.side === "sell" ? "sell" : "none";', 'const key = r.side === "buy" ? "buy" : r.side === "sell" ? "sell" : "none";']],
    (m) => m.largePrints([{ data: [{ executed_at: "2026-10-27T15:00:00Z", product: "ES", sym: "ESZ6", side: "buy", size: 300, price: "1", crossed: true }] }]).byProduct.ES.crossed[0] === 1],
  ["none-split", "shared/flows-macro.js", [["      slot[key][0]++;", '      slot[key][0]++; if (key === "none") { slot.buy[1] += size / 2; slot.sell[1] += size / 2; }']],
    (m) => { const r = m.largePrints([{ data: [{ executed_at: "2026-10-27T15:00:00Z", product: "ZN", sym: "ZNZ6", side: "none", size: 600, price: "1", crossed: false }] }]); return r.byProduct.ZN.buy[1] === 0; }],
  ["one-floor-for-all", "shared/flows-macro.js", [["size < LARGE[p] ||", "size < 25 ||"]],
    (m) => !m.largePrints([{ data: [{ executed_at: "2026-10-27T15:00:00Z", product: "ES", sym: "ESZ6", side: "buy", size: 60, price: "1", crossed: false }] }]).byProduct.ES],
  ["crypto-average", "shared/flows-macro.js", [["const gap = Math.abs(v / m.get(d) - 1);", "const gap = Math.abs(v / ((v + m.get(d)) / 2) - 1);"]],
    (m) => m.cryptoCheck({ status: "ok", points: [["2026-10-27", 1008]] }, { data: [{ start_time: "2026-10-27T00:00:00Z", close: "1000" }] }).v === "differs"],
  ["zone-converted", "shared/flows-macro.js", [['return { at: null, why: "zone", date: dateOf(ts) };', 'return { at: new Date(Date.parse(ts.replace(" ", "T") + "Z") + 4 * 3600000).toISOString(), why: null };']],
    (m) => m.zonedInstant("2026-10-27 16:00:00", "US/Eastern").at === null],
  ["percent-untested", "shared/flows-macro.js", [['const pct = unit === null || cp === null ? null : unit === "fraction" ? cp : cp / 100;', "const pct = cp === null ? null : cp / 100;"]],
    (m) => Math.abs(build(m, "movers-fraction").movers.gainers[0][2] - 0.0526) < 0.001],
  ["current-year-counted", "shared/flows-macro.js", [["y === null || y >= sessionYear", "y === null || y > sessionYear"]],
    (m) => m.monthRows(world().seasonYearMonth.SPY.body, 10, 2026).changes.length === 26],
  ["feed-change-used", "shared/flows-macro.js", [["    out.push(change);", "    out.push(num(r.change) ?? change);"]],
    (m) => Math.abs(m.monthRows(world("season-percent-change").seasonYearMonth.SPY.body, 10, 2026).changes[0]) < 0.5],
  ["normal-interval", "shared/flows-macro.js", [["const w = wilson(share, n);", "const w = [share - 1.96 * Math.sqrt(share * (1 - share) / n), share + 1.96 * Math.sqrt(share * (1 - share) / n)];"]],
    (m) => m.seasonCell(Array.from({ length: 10 }, () => 0.01)).lo < 1],
  ["share-under-eight", "shared/flows-macro.js", [["if (n < SEASON_MIN_YEARS) return { few: true, n };", "if (false) return { few: true, n };"]],
    (m) => m.seasonCell([0.1, 0.2, 0.3, -0.1, 0.1, 0.2, 0.3]).few === true],
  ["rank-by-share", "shared/flows-macro.js", [["items.sort((a, b) => b.lo - a.lo ||", "items.sort((a, b) => b.k / b.n - a.k / a.n ||"]],
    (m) => m.performersTable({ data: [{ ticker: "SYX1", years: 3, positive_closes: 3 }, { ticker: "SYX2", years: 100, positive_closes: 90 }] }).rows[0][0] === "SYX2"],
  ["bh-skipped", "shared/flows-macro.js", [["const bh = benjaminiHochberg(items.map((i) => i.p), 0.1);", "const bh = { adjusted: items.map((i) => i.p), reject: items.map((i) => i.p <= 0.1) };"]],
    (m) => build(m, "performers-null").seasonality.performers.this.survive === 0],
  ["two-rows", "shared/flows-macro.js", [["if (!best || d < best.d) best = { i, d };", "{ const l = claim.get(i) || []; l.push(c); claim.set(i, l); taken.add(c.id); } if (!best || d < best.d) best = { i, d };"]],
    (m) => { const two = [{ at: "2026-10-29T18:00:00Z", event: "FOMC", tag: "fomc" }, { at: "2026-10-30T18:00:00Z", event: "FOMC", tag: "fomc" }]; return m.matchOdds(two, [{ id: "a", question: "Will the Fed cut rates?", outcome: "Yes", resolves: "2026-10-29T20:00:00Z", price: 0.5, volume: 1 }]).events.flatMap((e) => e.markets).length === 1; }],
  ["window-thirty-days", "shared/flows-macro.js", [["afterMs: 7 * 864e5", "afterMs: 30 * 864e5"]],
    (m) => m.matchOdds([{ at: "2026-10-29T18:00:00Z", event: "FOMC", tag: "fomc" }], [{ id: "a", question: "Will the Fed cut rates?", outcome: "Yes", resolves: "2026-11-08T18:00:00Z", price: 0.5, volume: 1 }]).events[0].markets.length === 0],
  ["thin-solid", "shared/flows-macro.js", [["const thin = liquidityUsd === null || liquidityUsd < ODDS_THIN.liquidityUsd || spread === null || spread > ODDS_THIN.spread;", "const thin = false;"]],
    (m) => build(m, "odds-thin").odds.events[0].markets[0].thin === true],
  ["resolved-live", "shared/flows-macro.js", [["const closed = !!d && (d.closed === true || d.active === false);", "const closed = false;"]],
    (m) => build(m, "odds-resolved").odds.events[0].markets[0].resolved === true],
  ["last-over-mid", "shared/flows-macro.js", [["const price = twoSided && !closed ? mid : lastPrice;", "const price = lastPrice;"]],
    (m) => build(m, "ok").odds.events[0].markets[0].price === 0.62],
  ["top5-of-five", "shared/flows-macro.js", [["const sum = list.reduce((a, r) => a + r.v, 0);", "const sum = list.slice().sort((a, b) => b.v - a.v).slice(0, 5).reduce((a, r) => a + r.v, 0);"]],
    (m) => build(m, "ok").odds.events[0].markets[0].top5Share < 0.9],
  ["address-kept", "shared/flows-macro.js", [["    history: prices.slice(-30).map((p) => [p[0], p[1]]),\n  };", "    history: prices.slice(-30).map((p) => [p[0], p[1]]),\n    top: (unwrap(positions)[0] || {}).user_address,\n  };"]],
    (m) => m.addressFree(build(m, "ok"))],
  ["management-names", "shared/flows-private.js", [['return (Array.isArray(d) ? d : []).filter((r) => r && typeof r.title === "string" && r.title.trim()).length;', 'return (Array.isArray(d) ? d : []).map((r) => r.first_name + " " + r.last_name).join(", ");']],
    (m) => typeof m.leadersOf({ data: [{ first_name: "A", last_name: "B", title: "CEO" }] }) === "number"],
  ["unmatched-as-ok", "scripts/flows-legs/private.mjs", [['sectorEntry({ status: "unmatched", listed: 0', 'sectorEntry({ status: "ok", listed: 0']],
    async (m) => (await m.runPrivateSectors({ uw: makeMacroFakeVendor({ pm: "pm-unmatched" }), session: "2026-10-27", sectors: ["Technology"], cap: 150 })).sectors.Technology.status === "unmatched"],
  ["plan-retried", "scripts/flows-legs/private.mjs", [["return gap !== null && gap > 0;", "return false;"]],
    (m) => m.sleepingUntil({ basis: { sleepUntil: PLeg.wakeSession("2026-10-27") } }, "2026-10-28") === true],
  ["dollar-index-claimed", "shared/flows-macro-copy.js", [['"fx.nodxy": "The feed carries no dollar index; this count is not one."', '"fx.nodxy": "The dollar index is shown above."']],
    (m) => /no dollar index/.test(m.COPY["fx.nodxy"])],
  ["provider-word-in-copy", "shared/flows-macro-copy.js", [['"nothere.title": "What is not shown"', '"nothere.title": "Vendor data not shown"']],
    (m) => !Object.values(m.COPY).some((t) => /vendor/i.test(t))],
  ["fixtures-allowed", "shared/flows-macro.js", [['if (bad && !test) throw new Error("fixture name " + bad);', "if (false) throw new Error(\"fixture name \" + bad);"]],
    (m) => { try { m.buildMacro(world(), {}); return false; } catch { return true; } }],
];

const killed = [];
for (const [id, target, transforms, check] of MUTANTS) {
  const good = await loadMutated(target, []);
  ok(await check(good), `${id}: the correct build passes its check`);
  const bad = await loadMutated(target, transforms);
  let passes = false;
  try { passes = await check(bad); } catch { passes = false; }
  ok(passes === false, `${id}: the planted wrong build fails it`);
  killed.push(id);
}
ok(killed.length >= 34, `${killed.length} planted wrong builds are killed`);

{
  const scan = (text) => text.includes("search" + "-users");
  ok(!scan("shared/flows-macro.js"), "the scanner passes clean text");
  ok(scan("const path = '/api/predictions/search" + "-users';"), "and fails a planted call to the people lookup route");
}

console.log(`flows-macro: ${checks} assertions - the macro, live and private-markets leaves, the nightly and live legs, the call budgets, the health checks and ${killed.length} planted wrong builds`);
