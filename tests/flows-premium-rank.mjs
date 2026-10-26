import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { makeChain, regressionChain } from "./lib/sc-chain.mjs";
import { makeRng } from "./truth/rng.mjs";
import { preRank, rankShortCalls, leanRows, RANK_K, RANK_CAP, RANK_CONVENTIONS } from "../shared/flows-premium-rank.js";
import { lineCompare, RANK_BUCKETS, bucketOf } from "../shared/flows-quant-rank.js";
import { deltaBand } from "../shared/flows-quant-forward.js";
import * as QC from "../shared/flows-quant-card.js";
import * as ENG from "../shared/flows-quant-engine.js";
import * as PREM from "../shared/flows-premium.js";
import { loadMutated } from "./truth/mutants.mjs";
import { cpuNow } from "./lib/cpu-budget.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const SEEDS = Number(process.env.SC_SEEDS || 500);
const ENGINE_EVERY = Number(process.env.SC_ENGINE_EVERY || 10);
const TERMS = [{ h: 0.3, f: 0.1 }, { h: 0.6, f: 0.2 }, { h: 0.2, f: 0 }, { h: 1, f: 0 }];
const CONV = ["shares", "delta", "regt"];
const FAM = Object.freeze({ id: "custom", risk: "undefined", dir: "neutral" });

const deskSource = readFileSync(new URL("../assets/js/flows-desk.js", import.meta.url), "utf8");
const deskCtx = vm.createContext({});
vm.runInContext(deskSource, deskCtx);
const TENORS = deskCtx.__FlowsDeskTest.TENORS.map(([label, lo, hi]) => ({ label, lo, hi }));

const factsOf = (ch) => [{ id: "carry.implied", v: ch.carry, g: 3 }];
const argsOf = (ch, terms, extra = {}) => ({ raw: ch.rows, ticker: ch.ticker, spot: ch.spot, readMs: ch.readMs, asOfDay: ch.asOf, rate: ch.rate, facts: factsOf(ch), terms, ...extra });

function pageRow(r, out, facts, rate) {
  const fwds = new Map(out.forwards.map((f) => [f.expiry, f]));
  const row = { K: r.strike, type: "C", bid: r.bid, ask: r.ask, oi: r.oi, volume: r.volume, sym: r.symbol, ivSeed: null, opposite: r.opposite };
  const fwd = fwds.get(r.expiry) || null;
  const input = { expiry: r.expiry, asOfMs: out.cut.asOf, spot: out.cut.spot, rate, rateMethod: "given", facts, expiries: null, row, fwd };
  const fit = QC.contractFit(input);
  if (!fit) return { delta: null, band: null, fit: null };
  const c = fit.slice.contract;
  const held = c.via === "own" ? "C" : "P";
  const band = deltaBand({ F: fit.forward.F, se: fwd ? fwd.se : 0, K: r.strike, sigma: c.iv, T: fit.T, held, veto: !!(fwd && fwd.veto) });
  const setup = QC.labSetup({ asOfMs: out.cut.asOf, spot: out.cut.spot, facts, state: null, pLaw: null, event: null, stale: false, crossesEarnings: null, books: [{ fit, rows: [row] }], lawCache: new Map() });
  const st = ENG.priceStructure(setup, { family: "custom", fam: FAM, expiry: r.expiry, legs: [{ type: "C", K: r.strike, side: -1, qty: 1 }], basis: "natural" });
  const delta = st ? Math.abs(st.legs[0].delta) : null;
  return { delta: band.band === "dash" ? null : delta, raw: delta, band, fit };
}

function pageKey(r, conv, terms, delta, spot) {
  return PREM.shortCallLine({ bid: r.bid, strike: r.strike }, { spot, delta, days: r.days, convention: conv, haircut: terms.h, floor: terms.f }).annRatio;
}

function topOf(entries, tenor) {
  return entries.filter((e) => e.days >= tenor.lo && e.days <= tenor.hi).sort(lineCompare).slice(0, RANK_K).map((e) => e.symbol);
}

function truthEntries(pre, conv, terms) {
  const out = [];
  for (const { c, keys } of pre.keyed) if (keys[conv] !== null) out.push({ key: keys[conv], oi: c.oi, strike: c.strike, expiry: c.expiry, symbol: c.symbol, days: c.days });
  return out;
}

function pageEntries(out, conv, terms, facts, rate, cache) {
  const list = [];
  for (const r of out.rows) {
    let pr = cache.get(r.symbol);
    if (!pr) { pr = pageRow(r, out, facts, rate); cache.set(r.symbol, pr); }
    const key = conv === "delta" ? (pr.delta === null ? null : pageKey(r, conv, terms, pr.delta, out.cut.spot)) : pageKey(r, conv, terms, null, out.cut.spot);
    if (key !== null && key !== undefined) list.push({ key, oi: r.oi, strike: r.strike, expiry: r.expiry, symbol: r.symbol, days: r.days });
  }
  return list;
}

{
  const ch = makeChain(1, { rows: 3000 });
  const pre = preRank(argsOf(ch, TERMS[0]));
  ok(pre.picks.length > 0 && pre.picks.length <= RANK_CAP, `a chain of ${ch.rows.length} rows is cut to ${pre.picks.length} calls`);
  eq(pre.cut.k, RANK_K, "k is 25");
  eq(pre.cut.buckets, RANK_BUCKETS.map((b) => [b[0], b[1]]), "the five buckets are in the cut");
  ok(pre.picks.every(({ pk }) => pk >= 1 && pk <= 7), "every row carries a convention bitmask of 1, 2 and 4");
  eq(pre.cut.nOut, pre.picks.length, "n_out counts the rows sent");
  eq(RANK_CONVENTIONS.map((x) => x[1]), [1, 2, 4], "shares is bit 1, delta bit 2, Reg-T bit 4");
}

{
  const covered = new Set();
  for (const t of TENORS) {
    const inside = RANK_BUCKETS.filter(([lo, hi]) => hi >= t.lo && lo <= t.hi);
    const union = [Math.min(...inside.map((b) => b[0])), Math.max(...inside.map((b) => b[1]))];
    ok(inside.every(([lo, hi]) => lo >= t.lo && hi <= Math.min(t.hi, 400) || t.lo === 0 && lo >= 1 && hi <= t.hi), `every bucket under the page tenor ${t.label} lies wholly inside it (${union.join("-")})`);
    for (const [lo, hi] of inside) covered.add(lo + "-" + hi);
  }
  eq(bucketOf(0), -1, "day 0 is in no bucket");
  eq([bucketOf(1), bucketOf(7), bucketOf(8), bucketOf(14), bucketOf(15), bucketOf(42), bucketOf(43), bucketOf(90), bucketOf(91), bucketOf(400), bucketOf(401)], [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, -1], "bucket edges, and nothing past 400");
}

let lastReport = null;
{
  const t0 = Date.now();
  let engineRows = 0, deltaRows = 0, mismatched = 0, rowsSeen = 0, withBand = 0, dashSeen = 0, pmSeen = 0;
  const worstOut = { rows: 0, k: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rng = makeRng("premium-rank|" + seed);
    const rows = Math.round(Math.exp(Math.log(2000) + rng.uniform() * (Math.log(12000) - Math.log(2000))));
    const ch = makeChain(seed, { rows, plant: true, spreadRel: rng.uniform() < 0.3 ? 0.04 + rng.uniform() * 0.4 : null, shift: rng.uniform() < 0.4 ? (rng.uniform() - 0.7) * 0.08 : 0 });
    const terms = TERMS[seed % TERMS.length];
    const args = argsOf(ch, terms);
    const out = rankShortCalls(ch.rows, args);
    const pre = preRank(args);
    ok(out.rows.length <= RANK_CAP, `seed ${seed}: at most ${RANK_CAP} rows (${out.rows.length})`);
    worstOut.rows = Math.max(worstOut.rows, out.rows.length);
    const symbols = out.rows.map((r) => r.symbol);
    ok(new Set(symbols).size === symbols.length, `seed ${seed}: no symbol twice`);
    ok(out.rows.every((r) => r.type === "C" && PREM.gateOf(r) === null), `seed ${seed}: every row is a call that passes the gates`);
    eq(out.cut.terms, terms, `seed ${seed}: the cut names the terms it was made for`);
    eq(out.cut.k, RANK_K, `seed ${seed}: all 25 fit under the cap`);
    const second = rankShortCalls(ch.rows.slice().reverse(), args);
    eq(JSON.stringify(second), JSON.stringify(out), `seed ${seed}: the same chain in the opposite order gives byte-identical output`);
    const cache = new Map();
    const facts = factsOf(ch);
    const doEngine = seed % ENGINE_EVERY === 0;
    const sample = doEngine ? out.rows : out.rows.filter((_, i) => i % 7 === 0);
    for (const r of sample) {
      const pr = pageRow(r, out, facts, ch.rate);
      cache.set(r.symbol, pr);
      const lean = pre.keyed.find((e) => e.c.symbol === r.symbol);
      rowsSeen++;
      if (pr.band) { withBand++; if (pr.band.band === "dash") dashSeen++; if (pr.band.band === "pm") pmSeen++; }
      if (!Object.is(lean.c.delta, pr.delta)) mismatched++;
      engineRows++;
      if (pr.delta !== null) deltaRows++;
    }
    if (doEngine) {
      for (const conv of CONV) {
        const truth = truthEntries(pre, conv, terms);
        const got = pageEntries(out, conv, terms, facts, ch.rate, cache);
        for (const t of TENORS) {
          const a = topOf(truth, t), b = topOf(got, t);
          eq(b, a, `seed ${seed}: ${conv} top ${RANK_K} for ${t.label} on the page equals the full chain's`);
        }
        for (let bi = 0; bi < RANK_BUCKETS.length; bi++) {
          const [lo, hi] = RANK_BUCKETS[bi];
          const a = new Set(topOf(truth, { lo, hi })), b = new Set(topOf(got, { lo, hi }));
          eq([...b].sort(), [...a].sort(), `seed ${seed}: ${conv} bucket ${lo}-${hi} set`);
        }
      }
    } else {
      for (const conv of CONV) {
        const truth = truthEntries(pre, conv, terms);
        const kept = new Set(symbols);
        for (const t of TENORS) {
          const want = topOf(truth, t);
          ok(want.every((s) => kept.has(s)), `seed ${seed}: every ${conv} top ${RANK_K} row for ${t.label} was sent`);
        }
      }
    }
  }
  lastReport = { seeds: SEEDS, ms: Date.now() - t0, engineRows, mismatched, deltaRows, withBand, dashSeen, pmSeen, maxRows: worstOut.rows };
  eq(mismatched, 0, `the pre-rank delta equals the page's engine delta on ${engineRows} sent rows (null where the page has none)`);
  ok(deltaRows > 0, "and the sample holds priced rows");
}

{
  const ch = regressionChain();
  const x = ch.xSymbol;
  eq(ch.rows.findIndex((r) => r.option_symbol === x), 1200, "the regression row sits at vendor row 1,200, on the third page of 500");
  const terms = TERMS[0];
  const out = rankShortCalls(ch.rows, argsOf(ch, terms));
  const row = out.rows.find((r) => r.symbol === x);
  ok(!!row, "the row that ranks first on delta-adjusted collateral survives the cut");
  ok(row && (row.pk & 2) === 2, "and is marked as a delta-adjusted pick");
  const facts = factsOf(ch);
  const cache = new Map();
  for (const t of [TENORS[0], TENORS[1]]) {
    const entries = pageEntries(out, "delta", terms, facts, ch.rate, cache);
    eq(topOf(entries, t)[0], x, `it is the page's number one under delta-adjusted collateral for ${t.label}`);
  }
  const bidOverSpot = row.bid / ch.spot;
  ok(bidOverSpot < 0.01, `by bid over spot it is 0.8% (${bidOverSpot}), far below the 150 long-dated calls at 2% and more`);
  const first1000 = ch.rows.slice(0, 1000);
  ok(!first1000.some((r) => r.option_symbol === x), "the route as it was never read past row 1,000");
}

{
  const ch = makeChain(41, { rows: 5000, plant: true });
  const raw = ch.rows;
  const lean = leanRows(raw, ch.ticker);
  const got = preRank(argsOf(ch, TERMS[0]));
  const cands = new Set(got.keyed.map((e) => e.c.symbol));
  const ranked = PREM.rankChain(raw, { spot: ch.spot, asOf: ch.asOf, strategy: "cc", limit: 1e6, ticker: ch.ticker, readMs: ch.readMs, rate: ch.rate });
  const theirs = new Set(ranked.rows.map((r) => r.symbol));
  eq([...cands].sort(), [...theirs].sort(), "the pre-rank admits exactly the calls rankChain admits: one gate rule, two callers");
  ok(lean.shed.parse >= 1 && lean.shed.root >= 2, "junk symbols and other roots (an adjusted root among them) are refused before any gate");
  ok(lean.dups >= 1, "duplicate copies of one contract are counted");
}

{
  const ch = makeChain(52, { rows: 12000 });
  const args = argsOf(ch, TERMS[0]);
  rankShortCalls(ch.rows, args);
  const t0 = cpuNow();
  const reps = 5;
  for (let i = 0; i < reps; i++) rankShortCalls(ch.rows, args);
  const ms = (cpuNow() - t0) / reps;
  ok(ch.rows.length >= 11000, `a ${ch.rows.length}-row chain`);
  ok(ms < 150, `the whole ranking of ${ch.rows.length} rows costs ${ms.toFixed(1)} ms of CPU, under the 150 ms budget`);
  console.log(`rank CPU: ${ms.toFixed(1)} ms for ${ch.rows.length} rows`);
}

console.log(JSON.stringify(lastReport));
console.log(`flows-premium-rank: ${checks} checks`);
