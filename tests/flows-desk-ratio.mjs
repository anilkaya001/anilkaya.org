import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { chromium } from "playwright";
import * as P from "../shared/flows-premium.js";
import { yearFraction, closeUtcMs } from "../shared/flows-quant-time.js";
import { loadMutated } from "./truth/mutants.mjs";
import { chain, engineBlock, openDesk, showView, REPO } from "./desk-fixtures.mjs";
import { contractCents, ratioTextExact, ratioMicroExact, dollarsTextExact, centsOfDollars } from "./lib/pc-oracle.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

const rng = (() => { let a = 0x2f6e2b1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const decimal = (maxInt, places) => {
  const frac = Math.floor(rng() * 10 ** places);
  return String(1 + Math.floor(rng() * maxInt)) + (places ? "." + String(frac).padStart(places, "0") : "");
};

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("assets/js/flows-desk.js", REPO), "utf8"), sandbox, { filename: "assets/js/flows-desk.js" });
const D = sandbox.__FlowsDeskTest;
ok(D && typeof D.premiumLine === "function" && typeof D.ratioText === "function", "the desk's ratio functions are reachable from Node");

const TABLE = [
  ["0.01", 100], ["1.235", 12350], ["0.12345", 1235], ["1.5", 15000], ["0.995", 9950], ["2.675", 26750], ["10.005", 100050], ["0.285", 2850], ["1.005", 10050], ["3.14159", 31416], ["0.05015", 502], ["0.06195", 620], ["0.06495", 650],
];
for (const [bid, cents] of TABLE) {
  eq(String(contractCents(bid)), String(cents), `the oracle reads a ${bid} bid as ${cents} cents a contract`);
  const line = P.premiumLine({ bid: Number(bid), strategy: "csp", strike: 100, spot: 100 });
  eq(line.premiumC, cents, `premiumLine rounds a ${bid} bid half-up to ${cents} cents`);
}
for (const bid of [null, undefined, NaN, 0, -0.05, "", "abc", 0.00004, Infinity]) {
  const line = P.premiumLine({ bid, strategy: "csp", strike: 100, spot: 100 });
  eq([line.ok, line.why, line.ratio], [false, "no-bid", null], `a bid of ${String(bid)} is no bid, with no ratio and never a zero`);
}
eq(P.premiumLine({ bid: 1, strategy: "csp", strike: 0, spot: 100 }).why, "no-strike", "a put with no strike has no cash to reserve");
eq(P.premiumLine({ bid: 1, strategy: "cc", strike: 100, spot: 0 }).why, "no-spot", "a covered call with no price has no collateral");
eq(P.premiumLine({ bid: 1, strategy: "cc", strike: 100, spot: null }).why, "no-spot", "and null is no price, not zero");
eq(P.premiumLine({ bid: 1, strategy: "cc", strike: 100, spot: 0.00004 }).why, "no-collateral", "a price that rounds to no cents is no collateral");
{
  const csp = P.premiumLine({ bid: 1.235, strategy: "csp", strike: 17, spot: 99 });
  eq([csp.premiumC, csp.collateralC], [12350, 170000], "a put's collateral is its strike times 100, not the price");
  const cc = P.premiumLine({ bid: 1.235, strategy: "cc", strike: 17, spot: 99.5 });
  eq([cc.premiumC, cc.collateralC], [12350, 995000], "a covered call's collateral is 100 shares at the price, not the strike");
}

{
  let bad = 0, n = 0;
  for (let i = 0; i < 20000; i++) {
    const bidText = decimal(60, 1 + Math.floor(rng() * 5));
    const baseText = decimal(900, Math.floor(rng() * 5));
    const strategy = rng() < 0.5 ? "csp" : "cc";
    const server = P.premiumLine({ bid: Number(bidText), strategy, strike: Number(baseText), spot: Number(baseText) });
    const wantP = Number(contractCents(bidText)), wantC = Number(contractCents(baseText));
    n++;
    if (wantP === 0) { if (server.ok || server.why !== "no-bid") bad++; continue; }
    if (server.premiumC !== wantP || server.collateralC !== wantC || server.ratio !== wantP / wantC) bad++;
    const client = D.premiumLine({ bid: Number(bidText), strategy, collateral: Number(baseText) * 100 });
    if (client.premiumC !== server.premiumC || client.collateralC !== server.collateralC || client.ratio !== server.ratio) bad++;
    const text = D.ratioText(server.premiumC, server.collateralC);
    if (text !== ratioTextExact(wantP, wantC)) bad++;
    const frac = D.ratioFraction(server.premiumC, server.collateralC);
    if (frac !== ratioMicroExact(wantP, wantC)) bad++;
    if (D.centsText(server.premiumC, true) !== dollarsTextExact(wantP) || D.centsText(server.collateralC, false) !== dollarsTextExact(wantC, false)) bad++;
  }
  eq(bad, 0, `over ${n} random bids and strikes the server's and the page's cents, ratio, percentage text, six-decimal fraction and dollar text equal an exact decimal reference (${bad} off)`);
}

{
  const T = [
    [1005, 100000, "1.01%"], [9995, 100000, "10.0%"], [99949, 1000000, "9.99%"], [100, 40000000, "<0.01%"], [25000, 10000, "250.0%"], [12345678, 10000, "123,456.8%"],
    [1, 3, "33.3%"], [1, 200, "0.50%"], [999, 10000, "9.99%"], [9999, 100000, "10.0%"], [10, 100000, "0.01%"], [4, 100000, "<0.01%"], [5, 100000, "0.01%"],
  ];
  for (const [p, c, text] of T) {
    eq(D.ratioText(p, c), text, `${p} on ${c} cents prints ${text}`);
    eq(ratioTextExact(p, c), text, `and so does the exact reference`);
  }
  eq(D.ratioText(5e11, 1e9), null, "a numerator past the safe integers is refused, not mis-rounded");
  for (const bad of [[0, 100], [100, 0], [-1, 100], [100, -5], [NaN, 100], [100, null], [1.5, 100]]) eq(D.ratioText(bad[0], bad[1]), null, `${JSON.stringify(bad)} has no text, so the page prints a dash with its reason`);
  eq(D.ratioFraction(1, 10000000), 1e-7, "a ratio under half a millionth is exported at ten decimals, never as zero and never as empty");
  eq(D.ratioFraction(4, 10000000), 4e-7, "four parts in ten million is 0.0000004");
  eq(D.ratioFraction(5, 10000000), 0.000001, "and from half a millionth up it is written to six decimals");
  eq(D.ratioFraction(1, 50000000), 2e-8, "one cent on five hundred thousand dollars is 2e-8");
  eq(D.ratioFraction(1, 4e11), null, "and a figure no ten-decimal fraction can hold is absent, not zero");
}

const SPOT = 100;
const raw = (type, strike, bid, ask, extra = {}) => ({
  option_symbol: `SYX101260918${type}${String(Math.round(strike * 1000)).padStart(8, "0")}`, nbbo_bid: String(bid), nbbo_ask: String(ask),
  implied_volatility: "0.3", open_interest: "800", volume: "100", prev_oi: "700", ...extra,
});
const CONTRACTS = [raw("P", 120, 20.4, 20.6), raw("P", 95, 1.1, 1.15), raw("P", 90, 0.5, 0.55), raw("C", 105, 1.4, 1.5), raw("C", 80, 20.2, 20.4), raw("P", 100, 3.2, 3.3)];
const ranked = (rankBy) => P.rankChain(CONTRACTS, { spot: SPOT, asOf: "2026-08-25", rankBy, strategy: "both", ticker: "SYX101", rate: 0.04 });

{
  const byRatio = ranked("premiumRatio");
  eq(byRatio.rankedBy, "premiumRatio", "the ranking key ships with the ranking");
  const keys = byRatio.rows.map((r) => `${r.type}${r.strike}`);
  eq(keys[0], "C80", "ranked by Premium ÷ collateral the deepest in-the-money call leads: 20.20 on 10,000 of stock is the largest whole-bid ratio");
  const ratios = byRatio.rows.map((r) => r.premiumRatio);
  ok(ratios.every((v, i) => i === 0 || ratios[i - 1] >= v), `descending by the exact ratio (${ratios.map((v) => v.toFixed(4)).join(" > ")})`);
  ok(ratios.every((v) => Number.isFinite(v) && v > 0), "every ratio is finite and positive, never NaN or zero");
  for (const r of byRatio.rows) {
    const want = Number(contractCents(String(r.bid))) / Number(contractCents(String(r.strategy === "csp" ? r.strike : SPOT)));
    eq([r.premiumC, r.collateralC, r.premiumRatio], [Number(contractCents(String(r.bid))), Number(contractCents(String(r.strategy === "csp" ? r.strike : SPOT))), want], `${r.type}${r.strike}: the row carries its cents and its ratio`);
    eq(P.premiumLine({ bid: r.bid, strategy: r.strategy, strike: r.strike, spot: SPOT }).ratio, r.premiumRatio, `${r.type}${r.strike}: premiumLine and the priced row agree`);
  }
  const byAnn = ranked("annualized").rows.map((r) => `${r.type}${r.strike}`);
  ok(byAnn[0] !== keys[0], `the default rank, which counts time value only, does not lead with that line (${byAnn[0]})`);
  const deep = byRatio.rows.find((r) => r.type === "P" && r.strike === 120), otm = byRatio.rows.find((r) => r.type === "P" && r.strike === 95);
  ok(Math.abs(deep.premiumRatio - 0.17) < 1e-12 && Math.abs(deep.yieldOnCollateral - 0.4 * 100 / 12000) < 1e-12 && deep.premiumRatio > otm.premiumRatio * 10, "a put 20 dollars in the money shows 17 percent gross while its time value is 0.33 percent, the caveat for the owner in numbers");
  eq(ranked("nonsense").rankedBy, "annualized", "an unknown rank still falls back to the annualised yield");
  ok(P.RANK_KEYS.includes("premiumRatio"), "premiumRatio is an allowed rank key");
}

{
  const tie = [raw("P", 100, 1, 1.05), raw("P", 200, 2, 2.1, { option_symbol: "SYX101260925P00200000" })];
  const r = P.rankChain(tie, { spot: 400, asOf: "2026-08-25", rankBy: "premiumRatio", strategy: "csp", ticker: "SYX101", rate: 0.04 });
  eq(r.rows.map((x) => x.premiumRatio), [0.01, 0.01], "100 on 10,000 and 200 on 20,000 are the same rational and the same double");
  eq(r.rows.map((x) => x.strike), r.rows.slice().sort((a, b) => b.annualized - a.annualized || (a.expiry < b.expiry ? -1 : 1)).map((x) => x.strike), "so the tie falls to the annualised yield, then the expiry, as the other ranks do");
}

const server = {
  probe: async (mod) => {
    const bad = [];
    const line = (o) => mod.premiumLine(o);
    for (const [bid, cents] of TABLE) if (line({ bid: Number(bid), strategy: "csp", strike: 100, spot: 100 }).premiumC !== cents) bad.push("rounding " + bid);
    if (line({ bid: 0.00004, strategy: "csp", strike: 100, spot: 100 }).ok) bad.push("a bid under a cent a contract is a ratio");
    if (line({ bid: 1.235, strategy: "csp", strike: 17, spot: 99 }).collateralC !== 170000) bad.push("put collateral");
    if (line({ bid: 1.235, strategy: "cc", strike: 17, spot: 99.5 }).collateralC !== 995000) bad.push("call collateral");
    const out = mod.rankChain(CONTRACTS, { spot: SPOT, asOf: "2026-08-25", rankBy: "premiumRatio", strategy: "both", ticker: "SYX101", rate: 0.04 });
    if (out.rankedBy !== "premiumRatio") bad.push("rank key refused");
    const tv = out.rows.find((r) => r.type === "P" && r.strike === 120);
    if (!tv || Math.abs(tv.premiumRatio - 0.17) > 1e-12) bad.push("row ratio is not the whole bid over the collateral");
    const rs = out.rows.map((r) => r.premiumRatio);
    if (rs.some((v, i) => i > 0 && rs[i - 1] < v)) bad.push("order");
    if (!mod.RANK_KEYS.includes("premiumRatio")) bad.push("no key");
    return bad;
  },
};
{
  eq(await server.probe(P), [], "the shipped server module passes its own probe");
  const MUT = [
    ["the premium rounds without the half-cent epsilon", [["export const roundCents = (dollars) => Math.round(dollars * 100 + 1e-9 + Math.abs(dollars) * 1e-13);", "export const roundCents = (dollars) => Math.round(dollars * 100);"]]],
    ["a put's collateral is the price", [["const base = numOrNull(strategy === \"csp\" ? strike : spot);", "const base = numOrNull(spot);"]]],
    ["a call's collateral is the strike", [["const base = numOrNull(strategy === \"csp\" ? strike : spot);", "const base = numOrNull(strike);"]]],
    ["a premium under a cent is still a ratio", [["  if (!(premiumC > 0)) return none(\"no-bid\");\n  const base", "  const base"]]],
    ["the ratio is over the time value", [["return { ok: true, why: null, premiumC, collateralC, ratio: premiumC / collateralC };", "return { ok: true, why: null, premiumC, collateralC, ratio: Math.max(0, premiumC - 100) / collateralC };"]]],
    ["the rank key is not offered", [["\"cushionSigmas\", \"premiumRatio\"]);", "\"cushionSigmas\"]);"]]],
    ["the ratio is struck at the mid", [["const line = premiumLine({ bid, strategy,", "const line = premiumLine({ bid: mid, strategy,"]]],
  ];
  let caught = 0;
  for (const [title, edits] of MUT) {
    const mod = await loadMutated("shared/flows-premium.js", edits);
    const bad = await server.probe(mod).catch((e) => ["threw " + e.message]);
    ok(bad.length > 0, `PLANTED WRONG BUILD IS CAUGHT (server): ${title}`);
    caught++;
  }
  eq(caught, MUT.length, "every planted server build was run");
}

const errors = [];
const browser = await chromium.launch();
const SYMS = ["SYX101", "SYX102"];
const lines = (spot, base) => [
  ["P", +(spot * 0.95).toFixed(1), "2026-10-09", 1.235], ["P", +(spot * 0.9).toFixed(1), "2026-10-09", 0.12], ["P", +(spot * 1.2).toFixed(1), "2026-10-09", spot * 0.2 + 0.4],
  ["C", +(spot * 1.05).toFixed(1), "2026-10-09", 1.47], ["C", +(spot * 0.8).toFixed(1), "2026-10-09", spot * 0.2 + 0.31], ["C", +(spot * 1.1).toFixed(1), "2026-10-23", 2.1],
].map(([type, strike, expiry, bid]) => ({ type, strike, expiry, bid: +bid.toFixed(2) }));
const payloadOf = (ticker, spot, extra = {}) => chain({ ticker, spot, asOf: "2026-09-29", lines: lines(spot), engine: null, ...extra });
const payloads = () => ({
  SYX101: payloadOf("SYX101", 100), SYX102: payloadOf("SYX102", 52.4),
  SYX103: chain({ ticker: "SYX103", spot: 5000, asOf: "2026-09-29", lines: [{ type: "P", strike: 4500, expiry: "2026-10-09", bid: 0.05 }], engine: null }),
});
const QUERY = "?t=SYX101,SYX102,SYX103&strategy=both";

const readRows = (page) => page.$$eval("#dkList .dk-row", (rs) => rs.filter((r) => r.dataset.strategy !== "sc").map((r) => {
  const cell = (cls) => r.querySelector(".dk-c." + cls);
  const main = (c) => c ? [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() : null;
  return {
    t: r.dataset.t, strike: r.dataset.strike, expiry: r.dataset.expiry, strategy: r.dataset.strategy, pcAttr: r.dataset.pc, premiumC: r.dataset.premiumC, collateralC: r.dataset.collateralC,
    pc: main(cell("dk-pc")), sub: (cell("dk-pc") && cell("dk-pc").querySelector(".dk-sub") || {}).textContent || null, premium: main(cell("dk-prem")), title: cell("dk-pc") && cell("dk-pc").getAttribute("title"),
    subShown: !!cell("dk-pc") && !!cell("dk-pc").querySelector(".dk-sub") && cell("dk-pc").querySelector(".dk-sub").getBoundingClientRect().height > 0,
  };
}));

const wantOf = (p, r) => {
  const bid = String(r.bid), base = String(r.strategy === "csp" ? r.strike : p.spot);
  const pC = Number(contractCents(bid)), cC = Number(contractCents(base));
  return { pC, cC, text: ratioTextExact(pC, cC), sub: dollarsTextExact(pC) + " ÷ " + dollarsTextExact(cC, false), premium: dollarsTextExact(pC) };
};

const waitRows = (page, n) => page.waitForFunction((k) => document.querySelectorAll("#dkList .dk-row").length >= k, n, { timeout: 20000 });

const forwardProbe = async (route) => {
  const bad = [];
  const base = () => chain({ ticker: "SYX101", spot: 100, asOf: "2026-09-29", lines: lines(100), engine: engineBlock("SYX101", "2026-09-29", 50) });
  const withForward = (f) => ({ ...base(), forwards: [{ expiry: "2026-10-09", method: "parity", pairs: 6, F: f }] });
  const forwardFact = async (payload, strike) => {
    const page = await openDesk(browser, { payloads: { SYX101: payload }, query: "?t=SYX101&strategy=both", errors: [], viewport: { width: 1440, height: 820 }, before: route || null });
    try {
      await waitRows(page, 6);
      await showView(page, "lines");
      await page.evaluate((q) => document.querySelector(q).click(), `#dkList .dk-row[data-strike="${strike}"][data-expiry="2026-10-09"] .ui-info`);
      await page.waitForSelector("#fxPop:popover-open");
      return await page.$$eval("#fxPop dt", (dts) => { const d = dts.find((x) => x.textContent.trim() === "Forward"); return d ? d.nextElementSibling.textContent.trim() : ""; });
    } finally { await page.close(); }
  };
  try {
    const first = await forwardFact(withForward(100.2), 105);
    const used = Number(/prices delta, win % and EV on ([\d.]+)/.exec(first)[1]);
    if (!(used > 100)) bad.push("no engine forward");
    const quiet = await forwardFact(withForward(+(used * 1.00002).toFixed(2)), 105);
    if (/would move the delta/.test(quiet)) bad.push("a close forward warns");
    const target = +(used * 1.02).toFixed(2);
    const loud = await forwardFact(withForward(target), 105);
    const m = /would move the delta by about ([\d.]+)/.exec(loud);
    if (!m) { bad.push("a far forward is silent"); return bad; }
    const row = base().rows.find((x) => x.strike === 105 && x.expiry === "2026-10-09" && x.type === "C");
    const years = yearFraction(closeUtcMs("2026-09-29"), "2026-10-09"), sd = row.ivMid * Math.sqrt(years);
    const d1 = (Math.log(used / 105) + sd * sd / 2) / sd;
    const want = Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI) * Math.abs(Math.log(target / used)) / sd;
    if (!(Math.abs(Number(m[1]) - want) < 0.006 && Number(m[1]) > 0.02)) bad.push(`the figure ${m[1]} is not ${want.toFixed(3)}`);
  } catch (e) { bad.push("threw " + String(e.message).split("\n")[0]); }
  return bad;
};

const scProbe = async (route) => {
  const bad = [];
  const pl = payloads();
  const page = await openDesk(browser, { payloads: pl, query: "?t=SYX101,SYX102&strategy=sc&cv=regt", errors: [], viewport: { width: 1440, height: 820 }, before: route || null });
  try {
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= 4, null, { timeout: 20000 });
    await showView(page, "lines");
    const read = () => page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => {
      const c = r.querySelector(".dk-c.dk-ratio");
      return { t: r.dataset.t, strike: r.dataset.strike, expiry: r.dataset.expiry, pc: [...(c ? c.childNodes : [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(), sub: c && c.querySelector(".dk-sub") ? c.querySelector(".dk-sub").textContent : null };
    }));
    const lineOf = (r) => { const row = pl[r.t].rows.find((x) => String(x.strike) === r.strike && x.expiry === r.expiry); return P.shortCallLine({ bid: row.bid, strike: row.strike }, { spot: pl[r.t].spot, days: row.days, contracts: 100, convention: "regt" }); };
    for (const r of await read()) {
      const l = lineOf(r);
      if (r.pc !== ratioTextExact(l.bidC, l.m1C)) bad.push(`ratio ${r.t} ${r.strike}: ${r.pc}`);
      if (r.sub !== dollarsTextExact(l.bidC) + " ÷ " + dollarsTextExact(l.m1C, false)) bad.push(`dollars ${r.t} ${r.strike}: ${r.sub}`);
    }
    await page.selectOption("#deskRank", "premiumRatio");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("rank") === "premiumRatio", null, { timeout: 5000 }).catch(() => bad.push("rank not in the address"));
    await page.waitForTimeout(300);
    const vals = (await read()).map((r) => { const l = lineOf(r); return l.bidC / l.m1C; });
    if (vals.some((v, i) => i > 0 && vals[i - 1] < v - 1e-12)) bad.push("order is not descending by the gross ratio");
  } catch (e) { bad.push("threw " + String(e.message).split("\n")[0]); }
  await page.close();
  return bad;
};

const pageProbe = async (route) => {
  const bad = [];
  const pl = payloads();
  const page = await openDesk(browser, { payloads: pl, query: QUERY, errors: [], viewport: { width: 1440, height: 820 }, before: route || null });
  try {
    await waitRows(page, 12);
    await showView(page, "lines");
    await page.waitForTimeout(250);
    const rows = await page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => ({ t: r.dataset.t, strike: r.dataset.strike, expiry: r.dataset.expiry, strategy: r.dataset.strategy })));
    const all = await page.evaluate(() => [...document.querySelectorAll("#dkList .dk-row")].map((r) => {
      const c = r.querySelector(".dk-c.dk-pc");
      const main = [...(c ? c.childNodes : [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      const sub = c && c.querySelector(".dk-sub");
      const pr = r.querySelector(".dk-c.dk-prem");
      const prm = [...(pr ? pr.childNodes : [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      return { t: r.dataset.t, strike: r.dataset.strike, expiry: r.dataset.expiry, pc: main, sub: sub ? sub.textContent : null, premium: prm };
    }));
    for (const r of all) {
      const row = pl[r.t].rows.find((x) => String(x.strike) === r.strike && x.expiry === r.expiry);
      const w = wantOf(pl[r.t], row);
      if (r.pc !== w.text) bad.push(`ratio ${r.t} ${r.strike}: ${r.pc} not ${w.text}`);
      if (r.sub !== w.sub) bad.push(`dollars ${r.t} ${r.strike}: ${r.sub} not ${w.sub}`);
      if (r.premium !== w.premium) bad.push(`premium ${r.t} ${r.strike}: ${r.premium} not ${w.premium}`);
    }
    if (rows.length < 12) bad.push("rows " + rows.length);
    const tone = await page.$eval('#dkList .dk-row[data-t="SYX101"][data-strike="80"] .dk-pc', (n) => n.dataset.tone || null).catch(() => "none");
    if (tone !== "silent") bad.push("a premium that is nearly all intrinsic value is not muted");
    const ranks = await page.$$eval("#deskRank option", (o) => o.map((x) => x.value));
    if (!ranks.includes("premiumRatio")) bad.push("no rank option");
    else {
      await page.selectOption("#deskRank", "premiumRatio");
      await page.waitForFunction(() => new URL(location.href).searchParams.get("rank") === "premiumRatio", null, { timeout: 5000 }).catch(() => bad.push("rank not in the address"));
      await page.waitForTimeout(300);
      const order = await page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => ({ t: r.dataset.t, strike: r.dataset.strike, expiry: r.dataset.expiry })));
      const vals = order.map((r) => { const row = pl[r.t].rows.find((x) => String(x.strike) === r.strike && x.expiry === r.expiry); const w = wantOf(pl[r.t], row); return w.pC / w.cC; });
      if (vals.some((v, i) => i > 0 && vals[i - 1] < v)) bad.push("sort order is not descending by the exact ratio");
    }
    await showView(page, "frontier");
    await page.locator("#dkScatter .tl-scrub").focus();
    const reads = [];
    for (let k = 0; k < 14; k++) {
      await page.keyboard.press("ArrowRight");
      const t = await page.$eval("#dkScatter .ui-readout", (n) => n.classList.contains("is-on") ? n.textContent : null).catch(() => null);
      if (t && !reads.includes(t)) reads.push(t);
    }
    if (!reads.length || !reads.every((t) => /\d[\d.,]*% of collateral/.test(t))) bad.push("tooltip lacks the ratio: " + reads[0]);
  } catch (e) { bad.push("threw " + String(e.message).split("\n")[0]); }
  await page.close();
  return bad;
};

try {
  {
    const bad = await pageProbe(null);
    eq(bad, [], "the page shows, on every put and covered-call line, the ratio, the premium and both dollar amounts of one contract against the exact reference, ranks by it, and reads it in the frontier tooltip");
  }

  {
    const pl = payloads();
    const stripped = JSON.parse(JSON.stringify(pl));
    for (const p of Object.values(stripped)) for (const r of p.rows) { delete r.premiumC; delete r.collateralC; delete r.premiumRatio; }
    const page = await openDesk(browser, { payloads: stripped, query: QUERY, errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    await showView(page, "lines");
    const rows = await readRows(page);
    ok(rows.length >= 12 && rows.every((r) => /%$/.test(r.pc)), "a kept copy written before the deploy, with none of the new fields, still shows the ratio: the page derives it from the bid and the collateral");
    await page.close();
  }

  {
    const pl = payloads();
    pl.SYX101.rows[0] = { ...pl.SYX101.rows[0], bid: null };
    delete pl.SYX101.rows[1].collateral;
    const page = await openDesk(browser, { payloads: pl, query: QUERY, errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    await showView(page, "lines");
    const rows = await readRows(page);
    const noBid = rows.find((r) => r.t === "SYX101" && r.strike === String(pl.SYX101.rows[0].strike) && r.expiry === pl.SYX101.rows[0].expiry);
    const noColl = rows.find((r) => r.t === "SYX101" && r.strike === String(pl.SYX101.rows[1].strike) && r.expiry === pl.SYX101.rows[1].expiry);
    eq([noBid.pc, noBid.premium, /No quotable bid/.test(noBid.title || "")], ["—", "—", true], "a line with no bid shows a dash for the ratio and the premium, with the reason, never 0.00%");
    eq([noColl.pc, /No (usable price|strike)/.test(noColl.title || ""), /\$/.test(noColl.premium || "")], ["—", true, true], "a line with a bid and no collateral shows the premium and a dash for the ratio, with its reason");
    await page.close();
  }

  {
    const pl = payloads();
    for (const p of Object.values(pl)) { p.priced = p.rows.length + 40; p.truncated = false; p.rankedBy = "annualized"; }
    const page = await openDesk(browser, { payloads: (() => { const m = {}; for (const [k, v] of Object.entries(pl)) m[k] = (q) => ({ ...v, rankedBy: q.get("rank") === "premiumRatio" ? "premiumRatio" : "annualized" }); return m; })(), query: QUERY + "&rank=premiumRatio", errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    eq(new URL(page.url()).searchParams.get("rank"), "premiumRatio", "an address that names rank=premiumRatio keeps it");
    ok(page.asked.every((q) => q.get("rank") === "premiumRatio"), "and the server is asked for that ordering from the first request");
    eq(await page.$eval("#deskRank", (n) => n.value), "premiumRatio", "the rank menu shows it");
    ok(/ranked by premium ÷ collateral/.test(flat(await page.$eval("#deskFoot", (n) => n.textContent))), "a slice of the chain names the ordering it was cut by");
    await page.close();
  }

  {
    const pl = payloads();
    const cut = {};
    for (const [k, v] of Object.entries(pl)) cut[k] = (q) => ({ ...v, priced: v.rows.length + 40, rankedBy: q.get("rank") === "premiumRatio" ? "premiumRatio" : "annualized" });
    const page = await openDesk(browser, { payloads: cut, query: QUERY, errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    const before = page.asked.length;
    await showView(page, "lines");
    await page.selectOption("#deskRank", "premiumRatio");
    await page.waitForFunction((n) => true, before);
    await page.waitForTimeout(900);
    const fresh = page.asked.slice(before);
    ok(fresh.length >= 2 && fresh.every((q) => q.get("rank") === "premiumRatio"), `choosing Premium ÷ collateral on a sliced chain asks the server for that ordering, once for each name (${fresh.length} requests)`);
    await page.close();
  }

  {
    const pl = payloads();
    const old = {};
    for (const [k, v] of Object.entries(pl)) old[k] = { ...v, priced: v.rows.length + 40, rankedBy: "annualized" };
    const page = await openDesk(browser, { payloads: old, query: QUERY + "&rank=premiumRatio", errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    ok(/ranked by annualised yield/.test(flat(await page.$eval("#deskFoot", (n) => n.textContent))), "a payload an older Worker cut by the annualised yield says so, and does not claim the ratio ordering for its slice");
    await page.close();
  }

  {
    const pl = payloads();
    const page = await openDesk(browser, { payloads: pl, query: QUERY + "&bp=25000", errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    await showView(page, "frontier");
    await page.waitForTimeout(300);
    const plan = await page.evaluate(() => { const p = document.getElementById("deskPlan"); return { text: p ? p.textContent : "", alts: [...document.querySelectorAll(".dk-alt")].map((a) => a.textContent) }; });
    const m = /Prem\. ÷ coll\.\s*([\d.,<]+%)/.exec(flat(plan.text));
    ok(m, `the Best deployment card carries a Premium ÷ collateral metric (${flat(plan.text).slice(0, 160)})`);
    const desc = await page.$eval("#deskPlan .dk-plan-v b", (n) => n.textContent);
    const mm = /^(\d+)× (\w+) ([\d.]+) (call|put)$/.exec(desc);
    const row = pl[mm[2]].rows.find((x) => x.strike === Number(mm[3]) && x.type === (mm[4] === "call" ? "C" : "P"));
    const w = wantOf(pl[mm[2]], row);
    eq(m[1], w.text, `and it is the best line's own ratio, ${w.text}, the same for ${mm[1]} contracts as for one`);
    ok(plan.alts.length > 0 && plan.alts.every((a) => /\d%/.test(a)), "the next best lines print theirs");
    await page.close();
  }

  {
    const pl = payloads();
    const page = await openDesk(browser, { payloads: pl, query: QUERY, errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    await showView(page, "lines");
    await page.locator(".ui-exp > summary").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".ui-exp-i", { hasText: /^CSV$/ }).click()]);
    const text = fs.readFileSync(await dl.path(), "utf8");
    const grid = [];
    { let row = [], cell = "", q = false; const t = text.slice(1); for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; } if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\r") continue; else if (c === "\n") { row.push(cell); grid.push(row); row = []; cell = ""; } else cell += c; } if (cell || row.length) { row.push(cell); grid.push(row); } }
    const at = grid[0].indexOf("Premium ÷ collateral (fraction)");
    ok(at > 0, `the export has a Premium ÷ collateral column in a fraction (${grid[0].join(" | ")})`);
    ok(!grid[0].some((c) => /^(bid|ask|spot|mid)\b|quoted|^Premium \(|premium \(usd\)/i.test(c)), "and still no bid, ask, premium or spot column: the quoted figures are not exported");
    const body = grid.slice(1).filter((r) => r.length === grid[0].length && r[0] && !/^(Source|Exported)/.test(r[0]));
    let off = 0;
    for (const r of body) {
      const p = pl[r[0]];
      const row = p.rows.find((x) => x.expiry === r[2] && x.strike === Number(r[grid[0].indexOf("Strike (USD)")]) && (r[1] === "covered call" ? x.type === "C" : x.type === "P"));
      const w = wantOf(p, row);
      if (r[at] !== String(ratioMicroExact(w.pC, w.cC))) off++;
    }
    eq([body.length, off], [13, 0], "every exported line carries its ratio half-up to six decimals from integer cents");
    await page.close();
  }

  for (const [w, h] of [[1920, 1080], [1440, 820], [1024, 768], [390, 844]]) {
    for (const [label, q] of [["both", QUERY + "&bp=25000"], ["short calls", "?t=SYX101,SYX102&strategy=sc&bp=25000"]]) {
      const page = await openDesk(browser, { payloads: payloads(), query: q, errors, viewport: { width: w, height: h } });
      await waitRows(page, 6);
      await page.waitForTimeout(1500);
      await showView(page, "lines");
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#dkList .dk-row:not([hidden])")];
        const bad = [];
        for (const r of rows) {
          const c = r.querySelector(".dk-pc, .dk-ratio");
          if (!c) { bad.push("no ratio cell"); continue; }
          const b = c.getBoundingClientRect(), rb = r.getBoundingClientRect(), sub = c.querySelector(".dk-sub");
          if (b.width < 20 || b.height < 8) bad.push("ratio cell collapsed");
          if (b.left < rb.left - 1 || b.right > rb.right + 1) bad.push("ratio cell leaves its row");
          if (!sub || sub.getBoundingClientRect().height < 6) bad.push("dollars hidden");
          else if (sub.scrollWidth > sub.clientWidth + 1 || sub.getBoundingClientRect().right > rb.right + 1) bad.push("dollars cut: " + sub.textContent);
          if (!/%$/.test([...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim())) bad.push("no percentage");
        }
        const de = document.documentElement;
        return { n: rows.length, bad: [...new Set(bad)], sw: de.scrollWidth, iw: innerWidth, sh: de.scrollHeight, ih: innerHeight };
      });
      ok(m.n > 0 && m.bad.length === 0, `${w}x${h} ${label}: the ratio and both dollar amounts show on all ${m.n} visible lines, inside their rows, uncut (${m.bad.join("; ")})`);
      ok(m.sw <= m.iw && m.sh <= m.ih + 1, `${w}x${h} ${label}: no sideways scroll and no page scroll (${m.sw}x${m.sh} in ${m.iw}x${m.ih})`);
      await page.close();
    }
  }

  {
    const bad = await scProbe(null);
    eq(bad, [], "Short calls under Reg-T style: every line's ratio is the whole bid over that collateral with both dollar amounts, and ranking by it sorts by the gross ratio");
  }

  {
    const pl = payloads();
    const page = await openDesk(browser, { payloads: pl, query: QUERY, errors, viewport: { width: 1440, height: 820 } });
    await waitRows(page, 12);
    await showView(page, "lines");
    const opts = await page.$$eval("#deskRank option", (o) => o.map((x) => [x.value, x.textContent]));
    eq(opts.find((o) => o[0] === "premiumRatio")[1], "Premium ÷ collateral, in-the-money value included", "the rank menu says at the moment of choosing that the ratio counts in-the-money value");
    eq(opts.find((o) => o[0] === "yieldOnCollateral")[1], "Time value ÷ collateral", "and names the time-value ratio apart");
    const tones = await page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => ({ t: r.dataset.t, strike: r.dataset.strike, type: r.dataset.strategy, tone: r.querySelector(".dk-pc").dataset.tone || null, title: r.querySelector(".dk-pc").title })));
    const deep = tones.find((x) => x.t === "SYX101" && x.strike === "80"), shallow = tones.find((x) => x.t === "SYX101" && x.strike === "105");
    eq([deep.tone, /most of this premium is in-the-money value/.test(deep.title)], ["silent", true], "a call 20 dollars in the money, whose premium is almost all intrinsic value, is muted and says why");
    eq([shallow.tone, /^Premium ÷ collateral: what one contract/.test(shallow.title)], [null, true], "an out-of-the-money line keeps the full figure");
    const factsFor = async (t, strike, expiry) => {
      await page.evaluate((q) => document.querySelector(q).click(), `#dkList .dk-row[data-t="${t}"][data-strike="${strike}"][data-expiry="${expiry}"] .ui-info`);
      await page.waitForSelector("#fxPop:popover-open");
      const facts = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
      await page.keyboard.press("Escape");
      await page.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" });
      return facts;
    };
    const fd = await factsFor("SYX101", 80, "2026-10-09");
    eq(fd["Premium ÷ collateral"], "20.3% = $2,031.00 ÷ $10,000.00 · $2,000.00 of the premium is in-the-money value, not time value · gross of the premium: the collateral is 100 shares at the price shown", "the disclosure of the deep in-the-money call prints the exact split, $2,000.00 of $2,031.00");
    const fo = await factsFor("SYX101", 105, "2026-10-09");
    ok(/^1\.47% = \$147\.00 ÷ \$10,000\.00 · gross of the premium/.test(fo["Premium ÷ collateral"]) && !/in-the-money value/.test(fo["Premium ÷ collateral"]), `and the out-of-the-money one has no intrinsic clause (${fo["Premium ÷ collateral"]})`);
    const fp = await factsFor("SYX101", 90, "2026-10-09");
    ok(/^0\.12% = \$12\.00 ÷ \$9,000\.00 .* the cash reserved is the strike × 100$/.test(fp["Premium ÷ collateral"].replace("· gross of the premium: ", ". ")) || /cash reserved is the strike × 100/.test(fp["Premium ÷ collateral"]), `a put names its collateral: cash at the strike (${fp["Premium ÷ collateral"]})`);
    await page.close();
  }

  {
    const pages = await import("../shared/flows-pages.js");
    const html = pages.deskPage({ username: "t" });
    const keys = new Set([...html.matchAll(/<p data-k="([a-z0-9.-]+)">/g)].map((m) => m[1]));
    const need = ["no-bid", "no-strike", "no-spot", "no-collateral"].map((w) => "pc-" + w).concat(["pc-itm", "pc-csp", "pc-cc", "t-pc", "t-pc-itm", "t-prem", "t-ratio", "sc-conv-delta", "sc-conv-regt", "sc-conv-shares", "fwd-delta"]);
    eq(need.filter((k) => !keys.has(k)), [], "every sentence the ratio's dashes and disclosures can ask for exists, so none prints as a key");
    const used = [...fs.readFileSync(new URL("assets/js/flows-desk.js", REPO), "utf8").matchAll(/T\("(pc-[a-z-]+)"/g)].map((m) => m[1]);
    eq(used.filter((k) => !keys.has(k) && !k.endsWith("-")), [], "and every literal pc- key the desk asks for exists");
  }

  {
    const pl = payloads();
    pl.SYX101.rows[3] = { ...pl.SYX101.rows[3], bid: null };
    const page = await openDesk(browser, { payloads: pl, query: "?t=SYX101,SYX102&strategy=sc&cv=regt", errors, viewport: { width: 1440, height: 820 } });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= 4, null, { timeout: 20000 });
    await showView(page, "lines");
    const row = await page.$eval(`#dkList .dk-row[data-t="SYX101"][data-strike="${pl.SYX101.rows[3].strike}"][data-expiry="${pl.SYX101.rows[3].expiry}"]`, (r) => ({ pc: r.getAttribute("data-pc"), premiumC: r.getAttribute("data-premium-c"), ratio: [...r.querySelector(".dk-ratio").childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() }));
    eq(row, { pc: null, premiumC: null, ratio: "—" }, "a short call with no bid has no premium attribute, not the string undefined, and a dash for the ratio");
    await page.close();
  }

  {
    const bad = await forwardProbe(null);
    eq(bad, [], "a parity forward that would move the delta names the delta it could move, and a close one stays quiet, against the formula worked by hand");
  }

  const SRC = (rel) => fs.readFileSync(new URL(rel, REPO), "utf8");
  const CLIENT = [
    ["the percentage floors instead of rounding half up", "assets/js/flows-desk.js", [["const hundredths = Math.floor((2 * p * 10000 + c) / (2 * c));", "const hundredths = Math.floor((p * 10000) / c);"]]],
    ["a tiny ratio prints 0.00%", "assets/js/flows-desk.js", [["if (hundredths === 0) return \"<0.01%\";", "if (hundredths === 0) return \"0.00%\";"]]],
    ["the premium is read off the ask", "assets/js/flows-desk.js", [["const bid = isNum(row && row.bid);\n    if (bid === null || !(bid > 0)) return none(\"no-bid\");\n    const premiumC", "const bid = isNum(row && row.ask);\n    if (bid === null || !(bid > 0)) return none(\"no-bid\");\n    const premiumC"]]],
    ["the rank sorts by the annualised yield", "assets/js/flows-desk.js", [["rank === \"premiumRatio\" ? (r) => r.__pc.ratio", "rank === \"premiumRatio\" ? (r) => r.annualized"]]],
    ["the frontier tooltip drops the ratio", "assets/js/flows-desk.js", [["C.part(pcText + \" of collateral\", \"k\"), ", ""]]],
    ["the plan drops the ratio", "assets/js/flows-desk.js", [[", UI.metric(\"Prem. ÷ coll.\", planRatio(best))", ""]]],
    ["a missing premium prints zero", "assets/js/flows-desk.js", [["pc.premiumC === null ? cell(\"dk-prem\", \"Premium\", DASH, \"silent\", T(\"pc-no-bid\"))", "pc.premiumC === null ? cell(\"dk-prem\", \"Premium\", \"$0.00\", \"silent\", T(\"pc-no-bid\"))"]]],
    ["a deep in-the-money premium is not muted", "assets/js/flows-desk.js", [["mostlyIntrinsic(r, pc) ? \"silent\" : null, mostlyIntrinsic(r, pc) ? T(\"t-pc-itm\") : T(\"t-pc\")", "null, T(\"t-pc\")"]]],
    ["the forward warning is dropped", "assets/js/flows-desk.js", [["(move !== null && move > DELTA_MOVE_NOTE ? \" \" + T(\"fwd-delta\", { x: move.toFixed(2) }) : \"\")", "\"\""]]],
    ["the forward warning always fires", "assets/js/flows-desk.js", [["move !== null && move > DELTA_MOVE_NOTE ?", "move !== null ?"]]],
    ["the dollars are hidden on a narrow screen", "assets/css/flows-tools.css", [["  .dk-pc .dk-sub, .dk-ratio .dk-sub { display: block; }\n", ""]]],
  ];
  for (const [name, rel, edits] of CLIENT) {
    let body = SRC(rel);
    for (const [from, to] of edits) { assert.equal(body.split(from).length - 1, 1, `mutant "${name}" applies exactly once`); body = body.replace(from, () => to); }
    const css = rel.endsWith(".css");
    let bad;
    if (css) {
      const page = await openDesk(browser, { payloads: payloads(), query: QUERY, errors: [], viewport: { width: 390, height: 844 },
        before: async (p) => { await p.route(new RegExp("/" + rel.replace(/[.]/g, "\\.") + "(\\?.*)?$"), (r) => r.fulfill({ contentType: "text/css", body })); } });
      await waitRows(page, 6);
      await showView(page, "lines");
      await page.waitForTimeout(400);
      bad = await page.evaluate(() => [...document.querySelectorAll("#dkList .dk-row:not([hidden])")].filter((r) => { const s = r.querySelector(".dk-pc .dk-sub"); return !s || s.getBoundingClientRect().height < 6; }).map(() => "dollars hidden"));
      await page.close();
    } else {
      const plant = async (p) => { await p.route(new RegExp("/" + rel.replace(/[.]/g, "\\.") + "(\\?.*)?$"), (r) => r.fulfill({ contentType: "text/javascript", body })); };
      bad = /forward warning/.test(name) ? await forwardProbe(plant) : await pageProbe(plant);
      if (name === "the plan drops the ratio" || name === "a missing premium prints zero") bad = await planProbe(body, name);
    }
    ok(bad.length > 0, `PLANTED WRONG BUILD IS CAUGHT (page): ${name}`);
  }
  const SC = [
    ["the short-call ratio cell shows the time value ratio", "assets/js/flows-desk-calls.js", [["cellOf(\"dk-ratio\", \"Premium ÷ collateral\", pcOf(sc), sc.intrC * 2", "cellOf(\"dk-ratio\", \"Premium ÷ collateral\", fmtRatio(sc.ratio), sc.intrC * 2"]]],
    ["the short-call gross rank sorts by time value", "assets/js/flows-desk-calls.js", [["premiumRatio: (r) => (r.__sc && r.__sc.ok && r.__sc.m1C > 0 ? r.__sc.bidC / r.__sc.m1C : null),", "premiumRatio: (r) => (r.__sc && r.__sc.ok ? r.__sc.ratio : null),"]]],
    ["the short-call dollars are the totals of N contracts", "assets/js/flows-desk-calls.js", [["centsText(sc.bidC, true) + \" ÷ \" + centsText(sc.m1C))", "centsText(sc.premiumC, true) + \" ÷ \" + centsText(sc.collateralC))"]]],
  ];
  for (const [name, rel, edits] of SC) {
    let body = SRC(rel);
    for (const [from, to] of edits) { assert.equal(body.split(from).length - 1, 1, `mutant "${name}" applies exactly once`); body = body.replace(from, () => to); }
    const bad = await scProbe(async (p) => { await p.route(new RegExp("/" + rel.replace(/[.]/g, "\\.") + "(\\?.*)?$"), (r) => r.fulfill({ contentType: "text/javascript", body })); });
    ok(bad.length > 0, `PLANTED WRONG BUILD IS CAUGHT (short calls): ${name}`);
  }
  eq(errors, [], "no page error");
} finally {
  await browser.close();
}

async function planProbe(body, name) {
  const bad = [];
  const rel = "assets/js/flows-desk.js";
  const pl = payloads();
  if (name === "a missing premium prints zero") pl.SYX101.rows[0] = { ...pl.SYX101.rows[0], bid: null };
  const page = await openDesk(browser, { payloads: pl, query: QUERY + "&bp=25000", errors: [], viewport: { width: 1440, height: 820 },
    before: async (p) => { await p.route(new RegExp("/" + rel.replace(/[.]/g, "\\.") + "(\\?.*)?$"), (r) => r.fulfill({ contentType: "text/javascript", body })); } });
  try {
    await waitRows(page, 6);
    if (name === "the plan drops the ratio") {
      await showView(page, "frontier");
      const t = flat(await page.$eval("#deskPlan", (n) => n.textContent));
      if (!/Prem\. ÷ coll\./.test(t)) bad.push("no plan ratio");
    } else {
      await showView(page, "lines");
      const prem = await page.$$eval("#dkList .dk-row .dk-prem", (n) => n.map((x) => x.textContent));
      if (prem.some((t) => /\$0\.00/.test(t))) bad.push("zero premium");
    }
  } catch (e) { bad.push("threw"); }
  await page.close();
  return bad;
}

console.log(`✓ flows-desk-ratio: ${checks} assertions — Premium ÷ collateral per contract on every put, covered-call and short-call line: the bid over the collateral in integer cents half-up, printed with both dollar amounts and no click at four sizes, sortable and in the address, in the frontier tooltip, the plan and the export, derived by the page from the bid and the collateral so an older kept copy still shows it, a dash with its reason for a missing figure, and twenty-one planted wrong builds caught`);
