import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOracle, callsFor, staleView, screenOracle, fit, rankTop, THRESHOLDS, ORACLE_BYTE_CAP, STATES } from "../shared/flows-oracle.js";
import { callSay, liveSay, STANCE_LINES, MODEL_IMPLIED, CONVICTION_WORDS, usd } from "../shared/flows-oracle-words.js";
import { isFixtureTicker } from "../shared/flows-fixture-names.js";
import { guardAnswer } from "../shared/flows-ask.js";
import { validate } from "../shared/flows-contracts.js";
import { inspect } from "../shared/flows-door.js";
import { productOf, NAME_KINDS, GLOBAL_KEYS } from "../shared/flows-products.js";
import { ingestKeyParts, INGEST_LIST_KINDS } from "../server/store.js";
import { normOf, foldNorm, emptyNorm } from "../scripts/flows-legs/oracle-norm.mjs";
import { SESSION, NEXT, card, block, structure, NORM } from "./lib/oracle-fixtures.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.UTC(2026, 9, 16, 22, 0, 0);
const build = (c, extra = {}) => buildOracle({ ticker: "SYO001", session: SESSION, card: c, flowNorm: NORM, expectedSession: SESSION, now: NOW, ...extra });

const ncdf = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
};
const b76 = (F, D, K, s, T, type) => {
  const nu = s * Math.sqrt(T), d1 = Math.log(F / K) / nu + nu / 2, d2 = d1 - nu;
  return type === "P" ? D * (K * ncdf(-d2) - F * ncdf(-d1)) : D * (F * ncdf(d1) - K * ncdf(d2));
};
const ivOf = (price, F, D, K, T, type) => {
  let lo = 0.01, hi = 3;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (b76(F, D, K, m, T, type) < price) lo = m; else hi = m; }
  return (lo + hi) / 2;
};

{
  const r = build(card());
  eq(r.state, "signal", "a fitted slice, a clear edge and a leaning stance is a signal");
  eq(r.calls.length, 1, "one single-leg structure gives one call");
  const c = r.calls[0];
  eq(c.verdict, "cheap", "a long call with a positive edge is cheap");
  eq(c.action, "pay", "and the position is to pay");
  const fairPrice = 2.9 + 45 / 100;
  const want = ivOf(fairPrice, 100, 0.995, 105, 0.0959, "C");
  ok(Math.abs(c.fairIv - want) < 5e-4, `fair IV ${c.fairIv} against an independent solve ${want.toFixed(4)}`);
  ok(Math.abs(c.edgeVol - (0.30 - want)) < 5e-4, "edge in vol is market minus fair");
  eq(c.edgeUsd, 45, "edge in dollars is the engine's edge per contract");
  eq(c.breakeven, 103.1, "break-even is the structure's");
  eq(c.maxLoss, 310, "a bounded loss is printed as a positive cap");
  ok(c.say.gain.includes("$41") && c.say.gain.includes("46%"), "the gain line carries the EV and the chance of profit");
  ok(r.modelImplied === MODEL_IMPLIED, "the model-implied footer travels with the record");
  eq(r.provenance.ideas, "priced", "provenance names the tier");
  ok(Array.isArray(r.limits) && r.limits.length >= 2, "limits are listed");
  const v = validate("oracle:SYO001", r, { allowSynthetic: true });
  ok(v.ok, "the record passes the payload contract: " + JSON.stringify(v.structural));
  ok(isFixtureTicker("SYO001") && !isFixtureTicker("NVDA"), "the fixture namespace catches the invented ticker and not a real one");
  ok(!validate("oracle:SYO001", { ...r, fixture: true }, {}).ok, "a stamped record is refused without the test allowance");
  ok(!validate("oracle:SYO001", { ...r, state: "loud" }, { allowSynthetic: true }).ok, "a state outside the vocabulary is refused");
  ok(!validate("oracle:SYO001", { ...r, calls: [{ id: "x" }] }, { allowSynthetic: true }).ok, "a call that lacks a required field is refused");
  const insp = inspect("oracle:SYO001", JSON.stringify(r), { now: NOW });
  ok(insp.structural.length === 0, "the door finds no structural problem: " + JSON.stringify(insp.structural));
  eq(JSON.stringify(build(card())), JSON.stringify(build(card())), "two builds at one clock are byte equal");
  ok(JSON.stringify(r).length <= ORACLE_BYTE_CAP, "under the byte cap");
}

{
  const T = THRESHOLDS;
  const at = (edge, extra = {}, legOver = {}) => callsFor(card({}, {}, [structure({ ev: { p: 41, q: -4, edge }, ...extra }, legOver)]), null, { ticker: "SYO001" }).calls.length;
  eq(at(45), 1, "a clear edge clears");
  eq(at(14.9), 0, "$14.9 is under the dollar bar");
  const volAt = (edge) => {
    const f = 2.9 + edge / 100;
    return Math.abs(0.30 - ivOf(f, 100, 0.995, 105, 0.0959, "C"));
  };
  let lo = 15, hi = 200;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (volAt(m) < 0.02) lo = m; else hi = m; }
  eq(at(hi + 0.2), 1, "just past 2.0 vol points clears");
  eq(at(lo - 0.2 < 15 ? 14.9 : lo - 0.2), 0, "just under 2.0 vol points does not");
  eq(callsFor(card({}, {}, [structure({}, { bid: 2.0, ask: 4.0, mid: 3.0 })]), null, { ticker: "SYO001" }).calls.length, 0, "a spread of $2 against a $45 edge is under 1.5 spread costs");
  eq(callsFor(card({}, {}, [structure({}, { bid: 2.2, ask: 3.8, mid: 3.0 })]), null, { ticker: "SYO001" }).calls.length, 0, "a spread over half the mid is refused");
  eq(callsFor(card({}, {}, [structure({}, { bid: 0, ask: 3.1 })]), null, { ticker: "SYO001" }).calls.length, 0, "a one-sided quote is refused");
  eq(callsFor(card({}, {}, [structure({}, { oi: 3, vol: 4 })]), null, { ticker: "SYO001" }).calls.length, 0, "thin open interest and volume is refused");
  eq(callsFor(card({ }, {}, [structure({ dte: 13 })]), null, { ticker: "SYO001" }).calls.length, 0, "inside 14 days is refused");
  eq(callsFor(card({}, {}, [structure({ grade: 1 })]), null, { ticker: "SYO001" }).calls.length, 0, "grade 1 is refused");
  const repaired = card({}, { expiries: [{ expiry: "2026-11-20", T: 0.0959, forward: { F: 100, D: 0.995 }, smile: { method: "svi-repaired", n: 12 } }] });
  eq(callsFor(repaired, null, { ticker: "SYO001" }).calls.length, 0, "a repaired slice is refused");
  eq(at(-45), 0, "a negative edge is no call");
  ok(T.edgeVol === 0.02 && T.edgeUsd === 15 && T.edgeOverSpread === 1.5, "the pre-registered bars");
}

{
  const short = structure({ id: "b", family: "short-put", dir: "bull", lossUnbounded: false, maxLoss: -9295, breakevens: [92.95], ev: { p: 30, q: -8, edge: 38 } }, { type: "P", k: 95, side: -1, bid: 2.0, ask: 2.1, mid: 2.05, model: 2.0, iv: 0.34 });
  const r = build(card({}, {}, [short]));
  const c = r.calls[0];
  ok(c, "a short put with an edge is a call");
  eq(c.verdict, "rich", "a short position with an edge is rich");
  eq(c.action, "collect", "and the position collects");
  ok(c.edgeVol > 0, "market vol is above fair for a rich option");
  ok(/collects about \$2\.05/.test(c.say.gain) && /loss is capped at \$9,295/.test(c.say.gain), "the collect line names the credit and the capped loss");
  const open = build(card({}, {}, [structure({ id: "c", family: "short-put", lossUnbounded: true, maxLoss: null, ev: { p: 30, q: -8, edge: 38 } }, { type: "P", k: 95, side: -1, bid: 2.0, ask: 2.1, mid: 2.05, model: 2.0, iv: 0.34 })]));
  ok(/loss can grow past what the position collects/.test(open.calls[0].say.gain), "an unbounded loss is never printed as a number");
  eq(open.calls[0].maxLoss, null, "and is null");
}

{
  eq(build(null).state, "building", "no card is building");
  eq(build(null).stateWhy, "no-card", "with its reason");
  eq(build(card({ engine: undefined })).stateWhy, "no-engine", "no engine is named");
  const calm = build(card({}, {}, []));
  eq(calm.state, "calm", "a priced name with no call is calm");
  ok(/^Nothing stands out for SYO001/.test(calm.line), "calm says so in plain words");
  const conflict = build(card({}, { state: { state: "x", direction: "bearish", confidence: 2 } }));
  eq(conflict.state, "conflict", "idea up and state down is a conflict");
  eq(conflict.stance.lean, "mixed", "the lean is mixed");
  ok(conflict.stance.conviction <= 1, "and conviction is capped at 1");
  const behind1 = build(card(), { expectedSession: NEXT });
  eq(behind1.state, "stale", "one session behind is stale");
  eq(behind1.stateWhy, "behind1", "named behind1");
  ok(behind1.calls.every((c) => c.grade <= 1), "with grades capped at 1");
  const expired = build(card(), { expectedSession: "2026-10-20" });
  eq(expired.stateWhy, "expired", "two sessions behind is expired");
  eq(expired.calls.length, 0, "with no calls");
  const view = staleView(build(card()), NEXT);
  eq(view.stateWhy, "behind1", "the read-time re-judge agrees with the build-time one");
  eq(staleView(build(card()), "2026-10-20").calls.length, 0, "and drops calls at two sessions");
  const lowGrade = build(card({}, {}, [structure({ grade: 1 })]));
  eq(lowGrade.state, "building", "a grade-1 lead is building");
  eq(lowGrade.stateWhy, "grade", "named grade");
  ok(STATES.includes(screenOracle({ ticker: "SYO002", session: SESSION }).state), "a thin record is a state");
  eq(screenOracle({ ticker: "SYO002", session: SESSION, now: NOW }).calls.length, 0, "a screen record has no calls");
  const noNorm = build(card(), { flowNorm: null });
  ok(noNorm.withheld.some((w) => w.k === "flow.norm"), "a missing norm is a withheld entry with a reason");
  eq(noNorm.context.norm, null, "and null, never a zero");
  eq(build(card(), { flowNorm: { ...NORM, winN: 19 } }).context.norm, null, "under 20 windows is no norm");
}

{
  const nulled = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const paths = ["ev.edge", "ev.p", "prob.popP", "legs.0.iv", "legs.0.model", "legs.0.mid", "legs.0.bid", "legs.0.ask", "breakevens"];
  for (let i = 0; i < 400; i++) {
    const s = structure();
    const hit = paths.filter(() => rnd() < 0.2);
    for (const p of hit) {
      const parts = p.split(".");
      let o = s;
      for (let j = 0; j < parts.length - 1; j++) o = o[parts[j]];
      o[parts[parts.length - 1]] = null;
    }
    nulled.push({ s, hit });
  }
  for (const { s, hit } of nulled) {
    const r = build(card({}, {}, [s]));
    for (const c of r.calls) for (const k of ["marketIv", "fairIv", "edgeVol", "edgeUsd", "mid", "ev", "pop"]) ok(Number.isFinite(c[k]), `no call carries a non-finite ${k}`);
    if (hit.length && !(hit.length === 1 && hit[0] === "breakevens")) ok(r.calls.length === 0 || hit.every((h) => h === "breakevens"), "a null input never yields a call: " + hit.join(","));
  }
}

{
  const lead = (r) => [r.line, r.stance.line, ...r.calls.flatMap((c) => [c.say.head, c.say.why, c.say.gain])];
  const records = [build(card()), build(card({}, {}, [])), build(null), build(card({}, { state: { direction: "bearish", confidence: 2 } })),
    build(card({}, {}, [structure({ id: "b", family: "short-put", ev: { p: 30, q: -8, edge: 38 } }, { type: "P", k: 95, side: -1, bid: 2.0, ask: 2.1, mid: 2.05, model: 2.0, iv: 0.34 })]))];
  const banned = /\b(will|should|expect\w*|likely|going to|forecast\w*|predict\w*|anticipat\w*|poised|target\w*|odds|would|could|might|may|recommend\w*|advise\w*|guarantee\w*|buy|sell)\b/i;
  let strings = 0;
  for (const r of records) for (const t of lead(r)) {
    strings++;
    ok(!banned.test(t), "no forecast, modal or advice word in: " + t);
    ok(guardAnswer(t, [{ say: t }], { smallIntegers: false, modals: true }).forecast === false, "the ask guard finds no forecast verb in: " + t);
    ok(!/\bat (the )?(ask|bid)\b/i.test(t), "no feed side phrase in: " + t);
    for (const sentence of t.split(/(?<=[.!?])\s+/)) ok(sentence.split(/\s+/).length <= 22, "a sentence of at most 22 words: " + sentence);
  }
  ok(strings > 15, `${strings} strings swept`);
  for (const lean of Object.keys(STANCE_LINES)) for (const t of STANCE_LINES[lean]) ok(!banned.test(t) && t.length > 0, "stance line is clean: " + t);
  eq(CONVICTION_WORDS.length, 4, "four conviction words");
  ok(!banned.test(MODEL_IMPLIED.replace(/not advice/, "")), "the footer is clean apart from its own disclaimer");
  ok(/not advice/.test(MODEL_IMPLIED), "and says it is not advice");
  const msgs = [
    { kind: "surge", ticker: "SYO001", f: { k: 3.2, premium: 2.4e6, minutes: 28, norm: 7.5e5 } },
    { kind: "repeat", ticker: "SYO001", f: { strike: 65, side: "C", expiry: "2026-11-20", n: 4, minutes: 12, premium: 6e5 } },
    { kind: "flip", ticker: "SYO001", f: { now: 0.6, before: -0.5 } },
    { kind: "cluster", ticker: "SYO001", f: { expiry: "2026-11-20", share: 0.7, premium: 9e5 } },
    { kind: "sweeps", ticker: "SYO001", f: { minutes: 8, premium: 4e5 } },
    { kind: "size", ticker: "SYO001", f: { size: 1200, strike: 65, side: "P", expiry: "2026-11-20", premium: 8e5, k: 3 } },
    { kind: "sector", ticker: "Energy", f: { n: 4, sector: "Energy", names: ["SYO001", "SYO002", "SYO003"] } },
  ];
  for (const m of msgs) {
    const t = liveSay(m);
    ok(t.length > 10 && !banned.test(t) && !/\bat (the )?(ask|bid)\b/i.test(t), "live wording is clean: " + t);
    ok(guardAnswer(t, [{ say: t }], { smallIntegers: false, modals: true }).forecast === false, "live wording passes the guard: " + t);
  }
  eq(usd(-12.5, 2), "−$12.50", "minus is U+2212");
  eq(usd(null), "—", "a null is the em dash");
  ok(callSay({ side: "C", strike: 65, expiry: "2026-11-20", verdict: "cheap", action: "pay", marketIv: 0.3, fairIv: 0.35, edgeVol: -0.05, edgeUsd: 45, ev: -12, pop: 0.4, breakeven: 68.1 }).gain.includes("−$12"), "a negative EV prints with U+2212");
}

{
  const big = build(card({}, {}, [structure(), structure({ id: "x2", expiry: "2026-12-18" }), structure({ id: "x3", expiry: "2027-01-15" })]));
  ok(big.calls.length <= 3, "at most three calls");
  const stuffed = { ...big, provenance: { ...big.provenance, cites: Array.from({ length: 12 }, (_, i) => ({ id: "iv.cm.30", label: "x".repeat(400), display: String(i), asOf: SESSION, grade: 2 })) } };
  const fitted = fit(stuffed, 3000);
  ok(fitted.state === stuffed.state && fitted.stance && Array.isArray(fitted.withheld), "shedding never drops state, stance or withheld");
  ok(JSON.stringify(fitted).length < JSON.stringify(stuffed).length, "shedding shrinks the record");
  const top = rankTop([build(card()), build(card({}, {}, []))]);
  eq(top.length, 1, "only signals reach the top list");
  ok(top[0].topCall && top[0].topCall.head.length > 0, "with the head sentence");
}

{
  eq(productOf("oracle:AAPL").id, "oracle", "the registry knows the key");
  ok(!NAME_KINDS.includes("oracle"), "kept out of the listed kinds, because the listing ceiling is 2,000 rows and three kinds already take about 2,600");
  ok(GLOBAL_KEYS.includes("oracle-top") && GLOBAL_KEYS.includes("oracle-norm"), "and the two globals");
  ok(ingestKeyParts("oracle:AAPL").valid && ingestKeyParts("oracle-top").valid && ingestKeyParts("oracle-norm").valid, "the door grammar accepts all three");
  ok(!ingestKeyParts("oracle:aapl").valid, "and refuses a lower-case name");
  ok(!INGEST_LIST_KINDS.includes("oracle"), "and out of the ingest listing");
  const ledger = foldNorm(emptyNorm(), [{ t: "SYO001", prem: 100, size: 10 }, { t: "SYO001", prem: 300, size: 30 }], SESSION);
  eq(ledger.t.SYO001[0], 2, "the ledger counts windows");
  eq(foldNorm(ledger, [{ t: "SYO001", prem: 9e9, size: 1 }], SESSION).t.SYO001[0], 2, "a rerun of the same session changes nothing");
  eq(normOf(ledger, "SYO001").winN, 2, "normOf reads it");
  eq(normOf(ledger, "SYO009"), null, "an unknown name has no norm");
}

{
  const files = ["shared/flows-oracle.js", "shared/flows-oracle-words.js", "shared/flows-oracle-live.js", "server/routes/flows-oracle.js", "scripts/flows-legs/oracle.mjs", "scripts/flows-legs/oracle-norm.mjs", "scripts/flows-nightly/sections/oracle.mjs"];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    ok(!/\?\s*-1\s*:\s*1\b/.test(text.replace(/\(a\.[^\n]*\? -1 : 1\)/g, "")) || f.endsWith("oracle.js"), "no two-arm sign ternary in " + f);
    ok(!/\bAI\b/.test(text), "no bare AI token in " + f);
    ok(!/\/\/|\/\*/.test(text.replace(/https?:\/\//g, "")), "no comments in " + f);
  }
}

console.log(`flows-oracle: ${checks} checks passed`);
