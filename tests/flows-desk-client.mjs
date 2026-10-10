import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import vm from "node:vm";
import { chromium } from "playwright";
import { ivSurface } from "../shared/flows-premium.js";
import { chain, sale, nvdaAfter, nvdaBefore, engineBlock, NODE_Q, REPO, openDesk } from "./desk-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const same = (a, b, msg) => { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); checks++; };
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const DASH = "—";

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("assets/js/flows-desk.js", REPO), "utf8"), sandbox, { filename: "assets/js/flows-desk.js" });
const D = sandbox.__FlowsDeskTest;
ok(D && Object.isFrozen(D), "the desk's pure functions are exposed to a Node contract, and only when there is no document (a browser page gets no such global)");

{
  const rng = (() => { let a = 0x9e3779b9; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const brute = (pts, chance) => {
    const beats = (q, p) => (chance ? q.x >= p.x : q.x <= p.x) && q.y >= p.y && (q.x !== p.x || q.y !== p.y);
    return [...new Set(pts.filter((p) => !pts.some((q) => beats(q, p))).map((p) => p.x + "|" + p.y))].sort();
  };
  let mismatches = 0, sets = 0, ties = 0;
  for (let n = 0; n < 4000; n++) {
    const size = 1 + Math.floor(rng() * 24);
    const grid = 3 + Math.floor(rng() * 12);
    const pts = Array.from({ length: size }, () => ({ x: Math.floor(rng() * grid) / grid, y: Math.floor(rng() * grid) / 4 }));
    for (const chance of [false, true]) {
      sets++;
      const got = D.frontierOf(pts, chance);
      const key = got.map((p) => p.x + "|" + p.y);
      if (JSON.stringify([...key].sort()) !== JSON.stringify(brute(pts, chance))) mismatches++;
      const xs = got.map((p) => p.x);
      if (xs.some((x, i) => i > 0 && x <= xs[i - 1])) mismatches++;
      const ys = got.map((p) => p.y);
      if (ys.some((y, i) => i > 0 && (chance ? y >= ys[i - 1] : y <= ys[i - 1]))) mismatches++;
      if (new Set(pts.map((p) => p.x)).size < pts.length) ties++;
    }
  }
  eq(mismatches, 0, `across ${sets} random sets on both axes the frontier is exactly the Pareto set, one point per x, monotone (${mismatches} mismatches)`);
  ok(ties > 3000, `and most of those sets carry ties on x, which is where the old chance-axis sweep kept a dominated line (${ties})`);
  same(D.frontierOf([{ x: 0.8, y: 1 }, { x: 0.8, y: 0.5 }], true), [{ x: 0.8, y: 1 }], "two lines at the same chance keep only the one that pays more");
  same(D.frontierOf([{ x: 0.8, y: 0.5 }, { x: 0.8, y: 1 }], true), [{ x: 0.8, y: 1 }], "in either input order");
  same(D.frontierOf([{ x: 0.3, y: 0.5 }, { x: 0.3, y: 1 }], false), [{ x: 0.3, y: 1 }], "and the same on the delta axis");
  same(D.frontierOf([], false), [], "an empty desk has an empty frontier");
}

{
  const P = D.parseBuyingPower;
  const table = [["10,000", 10000], ["25k", 25000], ["25.5k", 25500], ["25000", 25000], ["$10,000", 10000], ["1,000,000", 1e6], ["10 000", 10000], ["1.5m", 1.5e6],
    ["10000.75", 10000.75], [".5k", 500], ["1,000.50", 1000.5], ["100b", 1e11], ["25 k", 25000],
    ["25,5k", null], ["25,5", null], ["1,00", null], ["12,34", null], ["1000,000", null], ["25.000.00", null], ["", null], ["0", null], ["-5", null], ["1e5", null], ["101b", null], ["abc", null], ["k", null]];
  for (const [raw, want] of table) eq(P(raw), want, `parseBuyingPower(${JSON.stringify(raw)}) is ${want} (a comma marks thousands only, so 25,5k is refused and not read as 255k)`);
}

{
  const labels = D.TENORS.map((t) => t[0]);
  same(labels, ["All", "≤ 2w", "2–6w", "> 6w"], "the tenor buckets carry their labels");
  const weeks = (label) => (label.match(/\d+/g) || []).map((n) => Number(n) * 7);
  const [, near, mid, far] = D.TENORS;
  eq(near[2], weeks(near[0])[0], "'≤ 2w' ends on day 14, which is two weeks");
  eq(mid[1], weeks(mid[0])[0] + 1, "'2–6w' starts on the day after two weeks");
  eq(mid[2], weeks(mid[0])[1], "'2–6w' ends on day 42, which is six weeks, not 45");
  eq(far[1], weeks(far[0])[0] + 1, "'> 6w' starts on the day after six weeks");
  for (let d = 0; d <= 500; d++) eq(D.TENORS.slice(1).filter((t) => d >= t[1] && d <= t[2]).length, 1, `day ${d} belongs to exactly one tenor bucket`);
}

{
  const S = D.sizeRow;
  eq(S({ collateral: 1.1 * 100, premium: 10 }, 110).contracts, 1, "a budget that exactly covers a collateral of 1.1 x 100 buys one contract (110.00000000000001 used to floor it to none)");
  eq(S({ collateral: 1.09 * 100, premium: 10 }, 109).contracts, 1, "and 1.09 x 100 against 109");
  let bad = 0;
  const rng = (() => { let a = 12345; return () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648; })();
  for (let i = 0; i < 20000; i++) {
    const strikeCents = 50 + Math.floor(rng() * 90000);
    const contracts = Math.floor(rng() * 6);
    const bp = (strikeCents * 100 * contracts + Math.floor(rng() * 2) * Math.floor(rng() * strikeCents * 100)) / 100;
    if (!(bp > 0)) continue;
    const want = Math.floor((bp * 100 + 1e-6) / (strikeCents * 100));
    const got = S({ collateral: strikeCents / 100 * 100, premium: 5 }, bp);
    if (got.contracts !== want || Math.abs(got.idle - (bp - want * strikeCents)) > 1e-6) bad++;
  }
  eq(bad, 0, `20,000 random budgets and strikes size to the whole-cent answer (${bad} off)`);
  eq(S({ collateral: 0, premium: 5 }, 100), null, "a line with no collateral sizes to nothing");
}

{
  const eng = engineBlock("AAA", "2026-09-29", 100);
  const priceCall = (K, bid) => {
    const row = { K, type: "C", bid, ask: bid + 0.02, oi: 500, volume: 10, sym: "x", ivSeed: 0.4 };
    const asOfMs = Date.parse("2026-09-29T20:00:00Z");
    const fit = NODE_Q.contractFit({ expiry: "2026-10-16", asOfMs, spot: 100, rate: 0.04, row });
    const setup = NODE_Q.labSetup({ asOfMs, spot: 100, facts: [], state: null, pLaw: eng.pLaw, event: null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map() });
    return NODE_Q.priceStructure(setup, { family: "covered-call", expiry: "2026-10-16", legs: [{ type: "S", side: 1, qty: 1 }, { type: "C", K, side: -1, qty: 1 }], basis: "natural" });
  };
  const st = priceCall(105, 0.9);
  const callDelta = st.legs.find((l) => l.type === "C").delta;
  ok(Math.abs(D.netDelta(st) - (1 - callDelta)) < 1e-9, `a covered call's net delta is one minus the call's delta, from the engine's own legs (${D.netDelta(st).toFixed(4)} = 1 - ${callDelta})`);
  ok(D.netDelta(st) > 0.5, "an out-of-the-money call leaves most of the stock's exposure on");
  const put = { legs: [{ type: "P", side: -1, qty: 1, delta: -0.36 }] };
  eq(D.netDelta(put), 0.36, "a short put's net delta is its absolute delta");
  eq(D.netDelta({ legs: [{ type: "P", side: -1, qty: 1, delta: null }] }), null, "and an unreadable leg gives no net delta rather than a partial one");
}

const browser = await chromium.launch();
const errors = [];
try {
  const query = "?t=NVDA&strategy=both&rank=annualized";
  const ready = (page, n = 1) => page.waitForFunction((k) => document.querySelectorAll("#dkList .dk-row").length >= k && !!document.querySelector("#dkScatter svg"), n, { timeout: 15000 });
  const popText = async (page) => flat(await page.locator("#fxPop").textContent());
  const openInfo = async (page, loc) => { await loc.click(); await page.waitForSelector("#fxPop:popover-open"); return popText(page); };
  const closeInfo = async (page) => { await page.keyboard.press("Escape"); await page.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" }); };
  const factsOf = (page) => page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
  const lineInfo = async (page, sel) => {
    const text = await openInfo(page, page.locator(sel + " .ui-info").first());
    const facts = await factsOf(page);
    await closeInfo(page);
    return { text, facts };
  };
  const status = async (page) => flat(await page.locator("#deskStatus").textContent());
  const statusShown = (page) => page.$eval("#deskStatus", (n) => !n.classList.contains("visually-hidden"));

  {
    const payload = nvdaAfter();
    const page = await openDesk(browser, { payloads: { NVDA: payload }, query, errors });
    await ready(page, 9);
    await page.waitForTimeout(400);

    const geo = await page.evaluate(() => {
      const svg = document.querySelector("#dkScatter svg");
      const box = svg.getBoundingClientRect();
      const texts = [...svg.querySelectorAll("text")].map((t) => ({ t: t.textContent, x: +t.getAttribute("x"), y: +t.getAttribute("y"), a: t.getAttribute("text-anchor") }));
      const marks = [...svg.querySelectorAll(":scope > g > circle:not([fill='none']), :scope > g > rect, :scope > g > path")].map((n) => { const b = n.getBoundingClientRect(); return { x: b.x - box.x + b.width / 2, y: b.y - box.y + b.height / 2 }; });
      return { texts, y0: +svg.querySelector("line.base").getAttribute("y1"), marks, aria: svg.getAttribute("aria-label") };
    });
    ok(geo.texts.some((t) => t.t === "Ann. yield, square-root scale"), "the yield axis is labelled as a square-root scale on the chart itself");
    ok(/square-root scale/.test(geo.aria), `and so is its text alternative (${geo.aria})`);
    const yTicks = geo.texts.filter((t) => t.a === "end" && /^\d+%$/.test(t.t)).map((t) => ({ v: parseInt(t.t, 10) / 100, y: t.y - 4 }));
    ok(yTicks.some((t) => t.v === 0), "zero has a tick, so the axis starts from something");
    ok(yTicks.length >= 4, `and there are ticks to read (${yTicks.map((t) => t.v * 100 + "%").join(" ")})`);
    for (const a of yTicks.filter((t) => t.v > 0)) {
      for (const b of yTicks.filter((t) => t.v > 0 && t.v > a.v)) {
        const ratio = (geo.y0 - a.y) / (geo.y0 - b.y), want = Math.sqrt(a.v / b.v);
        ok(Math.abs(ratio - want) < 0.02, `the ${a.v * 100}% and ${b.v * 100}% ticks sit where a square-root scale puts them (${ratio.toFixed(3)} against ${want.toFixed(3)})`);
      }
    }
    const xTicks = geo.texts.filter((t) => t.a === "middle" && /^\.?\d/.test(t.t)).map((t) => ({ v: parseFloat("0" + t.t.replace(/^0/, "")), x: t.x }));
    ok(xTicks.length >= 3, "the net delta axis has ticks");
    const xa = xTicks[0], xb = xTicks[xTicks.length - 1];
    const px = (v) => xa.x + (v - xa.v) * (xb.x - xa.x) / (xb.v - xa.v);
    const ya = yTicks.find((t) => t.v > 0);
    const py = (v) => geo.y0 - (geo.y0 - ya.y) * Math.sqrt(v / ya.v);
    ok(geo.texts.some((t) => t.t === "Net delta"), "the risk axis is named for what it plots");
    eq(geo.marks.length, 9, "one mark per line");

    const eng = payload.engine;
    const asOfMs = Date.parse(payload.asOf + "T20:00:00Z");
    let checked = 0, calls = 0, puts = 0;
    for (const r of payload.rows) {
      const row = { K: r.strike, type: r.type, bid: r.bid, ask: r.ask, oi: r.oi, volume: r.volume, sym: r.symbol, ivSeed: r.iv };
      const fit = NODE_Q.contractFit({ expiry: r.expiry, asOfMs, spot: payload.basis.spot, rate: eng.rate.r, row });
      const setup = NODE_Q.labSetup({ asOfMs, spot: payload.basis.spot, facts: [], state: eng.state, pLaw: eng.pLaw, event: null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map() });
      const legs = r.type === "C" ? [{ type: "S", side: 1, qty: 1 }, { type: "C", K: r.strike, side: -1, qty: 1 }] : [{ type: "P", K: r.strike, side: -1, qty: 1 }];
      const st = NODE_Q.priceStructure(setup, { family: r.type === "C" ? "covered-call" : "short-put", expiry: r.expiry, legs, basis: "natural" });
      const leg = st.legs.find((l) => l.type !== "S");
      const net = r.type === "C" ? 1 - leg.delta : Math.abs(leg.delta);
      const at = { x: px(net), y: py(r.annualized) };
      const near = geo.marks.filter((m) => Math.hypot(m.x - at.x, m.y - at.y) < 2).length;
      ok(near >= 1, `${r.type === "C" ? "call" : "put"} ${r.strike} ${r.expiry} is plotted at net delta ${net.toFixed(3)} (${r.type === "C" ? "one minus the call's delta " + leg.delta.toFixed(3) : "the put's delta"}), yield ${(r.annualized * 100).toFixed(0)}%`);
      checked++;
      if (r.type === "C") calls++; else puts++;
    }
    ok(calls >= 5 && puts >= 2, `the fixture plots both sides on one axis (${calls} calls, ${puts} puts)`);

    same(await page.locator("#dkFrontierM .ui-seg-i").allTextContents(), ["Net delta", "Win % (implied)"], "the toggle names the second axis for what it is: the implied win chance, not a bare 'Chance'");
    const frontier = await openInfo(page, page.locator('#dkFrontierM [aria-label="About frontier"]'));
    ok(/square-root scale/.test(frontier) && /zero included/.test(frontier), "the frontier's disclosure states the scale and that its ticks sit on it");
    ok(/one minus the call/.test(frontier) && /shares add one/.test(frontier), "and says a covered call is plotted at one minus its delta, because the shares add one");
    ok(/Win % \(implied\) is the risk-neutral chance/.test(frontier), "and what the implied win chance is");
    await closeInfo(page);

    await page.locator("#dkFrontierM .ui-seg-i", { hasText: "Win % (implied)" }).click();
    await page.waitForFunction(() => /implied chance of profit/.test(document.querySelector("#dkScatter svg")?.getAttribute("aria-label") || ""), null, { timeout: 5000 });
    const chanceTexts = await page.$$eval("#dkScatter svg text", (ts) => ts.map((t) => t.textContent));
    ok(chanceTexts.includes("Win % (implied)"), "the second axis is titled the same way on the chart");
    ok(chanceTexts.includes("Ann. yield, square-root scale"), "and the yield axis keeps its scale label");
    await page.close();
  }

  {
    const page = await openDesk(browser, { payloads: { NVDA: nvdaAfter() }, query, errors });
    await ready(page, 9);
    const head = flat(await page.locator("#dkList .dk-head").textContent());
    ok(head.includes("Win % (implied)") && head.includes("Win % (real-world)"), `the column headers say what the two chances are (${head})`);
    ok(!/Implied[^ ]/.test(head.replace("Win % (implied)", "")) && !/Real world/.test(head), "and no bare 'Implied' or 'Real world' is left to be read as a volatility");
    const first = page.locator("#dkList .dk-row").first();
    eq(await first.locator(".dk-ev").getAttribute("title"), "Expected profit per contract at the bid, under the real-world law.", "the EV cell says what it is: expected profit per contract, at the bid, under the real-world law");
    ok(/risk-neutral density/.test(await first.locator(".dk-pq").getAttribute("title")), "the implied win chance says which density it reads");
    ok(/real-world law/.test(await first.locator(".dk-pp").getAttribute("title")), "and the real-world one which law");
    ok(/Time-value yield, annualised/.test(await first.locator(".dk-ann").getAttribute("title")), "the Ann. cell says it is a time-value yield");
    await page.close();
  }

  {
    const aaa = chain({ ticker: "AAA", spot: 100, engine: engineBlock("AAA", "2026-09-29", 100), lines: [
      { type: "P", strike: 95, expiry: "2026-10-16", bid: 1.1 },
      { type: "C", strike: 105, expiry: "2026-10-16", bid: 0.9 },
      { type: "C", strike: 95, expiry: "2026-10-16", bid: 5.6 },
      { type: "C", strike: 95, expiry: "2026-10-02", bid: 3.2, ask: 3.3 },
    ] });
    const bbb = chain({ ticker: "BBB", spot: 50, lines: [{ type: "P", strike: 47, expiry: "2026-10-16", bid: 0.9 }] });
    const page = await openDesk(browser, { payloads: { AAA: aaa, BBB: bbb }, query: "?t=AAA,BBB&strategy=both&rank=annualized", errors });
    await ready(page, 5);
    const rowSel = (t, k, e, side = "cc") => `#dkList .dk-row[data-t="${t}"][data-strike="${k}"][data-expiry="${e}"][data-strategy="${side}"]`;

    const broken = page.locator(rowSel("AAA", 95, "2026-10-02"));
    eq(flat(await broken.locator(".dk-pq").textContent()).endsWith(DASH), true, "a line whose bid sits below intrinsic value has no implied chance: a dash");
    const brokenWhy = await broken.locator(".dk-pq").getAttribute("title");
    ok(/The bid \(\$3\.20\) is below the option's discounted intrinsic value \(\$5\.\d\d\), so no volatility is consistent with it/.test(brokenWhy), `and the dash says why, in the engine's own words with the numbers it compared (${brokenWhy})`);
    eq(await broken.getAttribute("data-why"), "iv.below-intrinsic", "and the row carries the engine's code for it");
    eq(await broken.locator(".dk-pp").getAttribute("title"), brokenWhy, "the real-world chance gives the same reason");
    eq(await broken.locator(".dk-ev").getAttribute("title"), brokenWhy, "and so does the EV");
    const noCard = page.locator(rowSel("BBB", 47, "2026-10-16", "csp"));
    eq(flat(await noCard.locator(".dk-pp").textContent()).endsWith(DASH), true, "a name with no card has no real-world chance: a dash");
    ok(/No real-world figure: no card is published for BBB/.test(await noCard.locator(".dk-pp").getAttribute("title")), "and its tooltip says there is no card");
    ok(/No real-world figure: no card is published for BBB/.test(await noCard.locator(".dk-ev").getAttribute("title")), "as does the EV cell's");
    ok(/risk-neutral density/.test(await noCard.locator(".dk-pq").getAttribute("title")), "while the implied chance, which needs no card, keeps its definition");

    const plot = await page.$eval("#dkFrontierM .dk-hint", (n) => n.textContent);
    eq(plot, "Not plotted, for want of an engine reading: 1.", "a line with no engine reading is counted under the frontier, not dropped without a word");

    const below = await lineInfo(page, rowSel("AAA", 95, "2026-10-02"));
    ok(/The bid is below the option's intrinsic value, so none of the premium is time value/.test(below.text), "a bid under intrinsic value says none of the premium is time value, not that it includes some");
    ok(/The bid \(\$3\.20\) is below the option's discounted intrinsic value/.test(below.text), "beside the engine's own reason it could not be priced");
    ok(!/Includes/.test(below.text) && !/time value is \$0/.test(below.text), "and no longer says 'includes $500 of intrinsic value ... time value is $0'");
    ok(/already through the strike/.test(below.facts["If called"]), `and a call already through the strike says so instead of 'has to run -0.9 SD' (${below.facts["If called"]})`);
    ok(!/has to run/.test(below.facts["If called"]), "with no 'has to run' on it");

    const itm = await lineInfo(page, rowSel("AAA", 95, "2026-10-16"));
    ok(/Includes \$500 of intrinsic value, which assignment returns rather than keeps; the time value is \$60\./.test(itm.text), `a coherent in-the-money line splits its premium into intrinsic and time value (${itm.text.slice(0, 60)})`);
    ok(/already through the strike/.test(itm.facts["If called"]), "and its cap is already reached");
    const otm = await lineInfo(page, rowSel("AAA", 105, "2026-10-16"));
    ok(/the market has to run [\d.]+ SD to get there/.test(otm.facts["If called"]), `an out-of-the-money call still says how far the market has to run (${otm.facts["If called"]})`);

    const put = await lineInfo(page, rowSel("AAA", 95, "2026-10-16", "csp"));
    for (const [name, info] of [["call", otm], ["put", put]]) {
      ok(!("Capital" in info.facts), `the ${name}'s disclosure carries no second capital figure beside the yield's`);
      ok(!/reg-?t|margin/i.test(info.text), `and no margin number (${name})`);
    }
    ok(/cash reserved \(cash-secured\)/.test(put.facts.Yield), `a put's yield names its basis: cash-secured (${put.facts.Yield})`);
    ok(/buy-write/.test(otm.facts.Yield) && /100 shares/.test(otm.facts.Yield), `a covered call's names its: stock bought with the option (${otm.facts.Yield})`);
    const ann = parseFloat(otm.facts.Annualised), gross = parseFloat(otm.facts["Gross annualised"]), week = parseFloat(otm.facts["Per week"]);
    ok(/time value/.test(otm.facts.Annualised), "the Ann. figure is labelled as a time-value yield");
    ok(gross >= ann - 0.5, `the gross annualised figure is available in the disclosure (${otm.facts["Gross annualised"]} against ${otm.facts.Annualised})`);
    ok(Math.abs(week - ann * 7 / 365) < 0.02, `and so is the yield per week (${otm.facts["Per week"]} = ${ann}% x 7/365)`);
    ok(/inverted from the mid/.test(otm.facts.Volatility), `the disclosure says which volatility delta, chance and EV use (${otm.facts.Volatility})`);
    ok(/on \d+(\.\d)?% volatility/.test(otm.facts.Cushion), "and the cushion states the volatility it is measured in");
    await page.close();
  }

  {
    const nop = chain({ ticker: "NOP", spot: 100, lines: [{ type: "C", strike: 95, expiry: "2026-10-09", bid: 4.2, ask: 4.3 }] });
    const opp = chain({ ticker: "OPP", spot: 100, lines: [{ type: "C", strike: 95, expiry: "2026-10-09", bid: 4.2, ask: 4.3, opposite: { bid: 0.9, ask: 0.96 } }] });
    const ern = chain({ ticker: "ERN", spot: 100, engine: engineBlock("ERN", "2026-09-29", 100), lines: [
      { type: "P", strike: 95, expiry: "2026-10-16", bid: 1.1, earnings: true }, { type: "P", strike: 94, expiry: "2026-10-16", bid: 0.9, earnings: false }] });
    const csh = chain({ ticker: "CSH", spot: 100, lines: [{ type: "P", strike: 95, expiry: "2026-10-16", bid: 1.1, iv: 0.9, volume: 0, ivMid: 0.3 }] });
    const cry = chain({ ticker: "CRY", spot: 100, engine: engineBlock("CRY", "2026-09-29", 100, { facts: [{ id: "carry.implied", v: 0.03, u: "frac", g: 3 }] }), lines: [
      { type: "P", strike: 95, expiry: "2026-10-16", bid: 1.1, ask: 1.14 }, { type: "C", strike: 105, expiry: "2026-10-16", bid: 0.9, ask: 0.94 }] });
    const page = await openDesk(browser, { payloads: { NOP: nop, OPP: opp, ERN: ern, CSH: csh, CRY: cry }, query: "?t=NOP,OPP,ERN,CSH,CRY&strategy=both", errors });
    await ready(page, 7);
    const sel = (t, k) => `#dkList .dk-row[data-t="${t}"][data-strike="${k}"]`;

    const bare = page.locator(sel("NOP", 95));
    eq(await bare.getAttribute("data-why"), "iv.below-intrinsic", "a call whose bid is under the discounted intrinsic floor, with no other side to read, carries the engine's code on its row");
    ok(/The bid \(\$4\.20\) is below the option's discounted intrinsic value \(\$5\.10\)/.test(await bare.locator(".dk-pq").getAttribute("title")), "and its dash says which numbers were compared: 4.20 against a floor of 5.10, from scipy at S 100, K 95, r 4%, ten days");
    const via = page.locator(sel("OPP", 95));
    eq(await via.getAttribute("data-why"), "model.none", "the same quote with the 95 put beside it is priced, and the only dash on it is the real-world one, which a name with no card cannot have");
    ok(/^\d+%$/.test(flat(await via.locator(".dk-pq").textContent()).replace(/^Win % \(implied\)\s*/, "")), "with an implied chance on the row");
    const viaInfo = await lineInfo(page, sel("OPP", 95));
    ok(viaInfo.facts.Volatility.startsWith("43.0%"), `on 43.0%, the volatility scipy inverts from the put's 0.93 mid, and not on a number from the call's own quote (${viaInfo.facts.Volatility})`);
    ok(/read from the out-of-the-money put at this strike/.test(viaInfo.facts.Smile), `and says whose quote it is (${viaInfo.facts.Smile})`);
    ok(/Priced at r 4\.00% \(the constant fallback, not measured\), dividend yield 0\.00%/.test(viaInfo.facts.Carry), `and that no card gave the rate (${viaInfo.facts.Carry})`);
    ok(/none of the premium is time value/.test(viaInfo.text) && !/Includes/.test(viaInfo.text), "and the intrinsic note follows the engine's time value for the short leg, which is negative at a 4.20 bid against 5.00 of intrinsic value, so it says the premium is below intrinsic and does not say it includes some");

    const crossing = page.locator(sel("ERN", 95)), clear = page.locator(sel("ERN", 94));
    eq(await crossing.getAttribute("data-why"), "world.event-missing", "a line that outlives a report the card cannot weigh carries that code");
    eq(flat(await crossing.locator(".dk-pp").textContent()).endsWith(DASH) && flat(await crossing.locator(".dk-ev").textContent()).endsWith(DASH), true, "and prints no real-world Win % or EV");
    ok(/An earnings report falls inside this expiry and the card holds no report move to weigh it/.test(await crossing.locator(".dk-pp").getAttribute("title")), "with the engine's sentence on hover");
    ok(/^\d+%$/.test(flat(await crossing.locator(".dk-pq").textContent()).replace(/^Win % \(implied\)\s*/, "")), "while the implied chance stays");
    eq(await clear.getAttribute("data-why"), null, "the same chain's line that expires before the report is priced in the real world");
    ok(!flat(await clear.locator(".dk-pp").textContent()).endsWith(DASH), "with a real-world Win %");
    const crossInfo = await lineInfo(page, sel("ERN", 95));
    ok(/No real-world figure: An earnings report falls inside this expiry/.test(crossInfo.text), "and the disclosure names the reason");

    const cush = await lineInfo(page, sel("CSH", 95));
    eq(cush.facts.Cushion.replace(/^[\d.]+ SD /, ""), "on 30.0% volatility", "a cushion is measured in the volatility inverted from the mid the row states, 30.0%, and not in a stale 90.0% last trade");
    ok(!/traded today|last transaction/.test(cush.facts.Cushion), "with no caveat about the print it does not use");

    const put = await lineInfo(page, sel("CRY", 95)), call = await lineInfo(page, sel("CRY", 105));
    ok(put.facts.Volatility.startsWith("35.7%") && call.facts.Volatility.startsWith("30.7%"), `a card that carries a 3% dividend yield moves the volatility each mid inverts to: 35.7% and 30.7%, not the 36.2% and 30.2% of no yield (scipy brentq at F = S e^{(r - q)T}, T = 17/365): ${put.facts.Volatility.slice(0, 6)} and ${call.facts.Volatility.slice(0, 6)}`);
    ok(/dividend yield 3\.00%/.test(put.facts.Carry) && /dividend yield 3\.00%/.test(call.facts.Carry), `and both lines say the yield they were priced at (${call.facts.Carry.slice(0, 90)})`);
    ok(/The shares are credited \$0\.14 a share of dividends to expiry/.test(call.facts.Carry), "the covered call says what the shares are credited, 0.13989 = S (e^{rT} - e^{(r - q)T})");
    ok(!/shares are credited/.test(put.facts.Carry), "and the put, which holds no shares, does not");

    for (const [t, k] of [["NOP", 95], ["OPP", 95], ["ERN", 95], ["ERN", 94], ["CSH", 95]]) {
      const grade = (await lineInfo(page, sel(t, k))).facts.Grade;
      ok(!/\b(fit|liq|edge|model|event|card|risk|world|iv)\.[a-z-]+/.test(grade), `${t} ${k}: the grade line is words, not codes (${grade.slice(0, 90)})`);
    }
    await page.close();
  }

  {
    const legacy = nvdaBefore();
    const page = await openDesk(browser, { payloads: { NVDA: legacy }, query, errors });
    await ready(page, 9);
    ok(!/agree|rebased|implies/.test(await status(page)), "a payload with no basis block draws no basis banner: an older response degrades quietly");
    eq(await page.locator("#dkList .dk-row").count(), 9, "and still prices every line");
    await page.close();
  }

  {
    const page = await openDesk(browser, { payloads: { NVDA: nvdaAfter() }, query, errors });
    await ready(page, 9);
    eq(await status(page).then((t) => t.includes("NVDA priced against 227.28, the underlying the quotes imply; last regular print 231.02 (a post-market bar).")), true,
       "a rebased chain says which underlying it is priced against, which one the quotes imply, and the last regular print");
    eq(await statusShown(page), true, "on the surface");
    const note = await page.locator(".desk-chip__note").first().textContent();
    ok(/\$227\.28 close rebased/.test(note) && /sellable/.test(note), `and the chip carries the rebased price (${note})`);
    eq(await page.locator(".desk-chip .dk-chip-px").first().textContent(), "227.28", "the chip's price is the one the lines are priced against");
    const moneyness = await page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => r.dataset.away));
    ok(moneyness.every((a) => / OTM$/.test(a) || a === "at the money"), `every line is out of the money at the priced underlying (${[...new Set(moneyness)].join(", ")})`);
    await page.close();
  }

  for (const withRows of [false, true]) {
    const bad = nvdaAfter();
    bad.basis = { status: "mismatch", spot: 231.02, printSpot: 231.02, printSource: "daily-close", printNote: null, impliedSpot: null, offMarket: 5 };
    bad.spot = 231.02;
    if (!withRows) { bad.rows = []; bad.priced = 0; }
    const page = await openDesk(browser, { payloads: { NVDA: bad }, query, errors });
    await page.waitForFunction(() => /disagree/.test(document.querySelector(".desk-chip__note")?.textContent || ""), null, { timeout: 15000 });
    const lbl = withRows ? "even if the payload still carries rows, " : "";
    eq(await page.locator("#dkList .dk-row").count(), 0, `${lbl}a mismatched chain ranks nothing`);
    ok(/NVDA: these quotes do not agree with the price \(231\.02\), so nothing is ranked\./.test(await status(page)), `${lbl}the status says the quotes do not agree with the price, and that nothing is ranked (${await status(page)})`);
    eq(await statusShown(page), true, "on the surface");
    const empty = flat(await page.locator("#dkList .ui-silent").getAttribute("aria-label"));
    ok(/these quotes do not agree with the price/.test(empty) || /Lines/.test(empty), "the list says so in the silence vocabulary");
    const silentInfo = await openInfo(page, page.locator("#dkList .ui-silent [data-info]"));
    ok(/these quotes do not agree with the price \(231\.02\), so nothing is ranked/.test(silentInfo), `and the reason is one tap away where the lines would be (${silentInfo})`);
    await closeInfo(page);
    const note = await page.locator(".desk-chip__note").first().textContent();
    ok(!/sellable/.test(note) && /quotes disagree with the price/.test(note), `the chip does not call any line sellable (${note})`);
    ok(!/sellable/.test(await page.locator("#deskFoot").textContent()), "nor does the footnote");
    await page.close();
  }

  {
    const near = [["C", 100, "2026-10-04"], ["C", 105, "2026-10-14"], ["C", 105, "2026-10-13"], ["C", 105, "2026-11-10"], ["C", 105, "2026-11-11"]];
    const spot = 100, asOf = "2026-09-29";
    const lines = [
      { type: "C", strike: 104, expiry: "2026-10-13", bid: 1.2 },
      { type: "C", strike: 104, expiry: "2026-10-14", bid: 1.3 },
      { type: "C", strike: 104, expiry: "2026-11-10", bid: 3.1 },
      { type: "C", strike: 104, expiry: "2026-11-11", bid: 3.2 },
      { type: "P", strike: 96, expiry: "2026-10-04", bid: 0.4 },
    ];
    ok(near.length === 5, "fixture spans the bucket edges");
    const payload = chain({ ticker: "EDG", spot, asOf, lines });
    const days = payload.rows.map((r) => r.days).sort((a, b) => a - b);
    same(days, [5, 14, 15, 42, 43], "the fixture holds lines at 5, 14, 15, 42 and 43 days");
    const page = await openDesk(browser, { payloads: { EDG: payload }, query: "?t=EDG&strategy=both", errors });
    await ready(page, 5);
    const shown = async (label, want) => {
      await page.locator("#dkTenor .ui-seg-i", { hasText: label }).click();
      await page.waitForFunction((w) => [...document.querySelectorAll("#dkList .dk-row")].map((r) => Number(r.dataset.days)).sort((a, b) => a - b).join() === w, want.join(), { timeout: 5000 }).catch(() => {});
      return (await page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => Number(r.dataset.days)))).sort((a, b) => a - b);
    };
    same(await page.locator("#dkTenor .ui-seg-i").allTextContents(), ["All", "≤ 2w", "2–6w", "> 6w"], "the buckets are labelled in weeks");
    same(await shown("≤ 2w", [5, 14]), [5, 14], "'≤ 2w' is up to day 14, two weeks");
    same(await shown("2–6w", [15, 42]), [15, 42], "'2–6w' is day 15 to day 42, six weeks: the 43rd day is not in it");
    same(await shown("> 6w", [43]), [43], "'> 6w' begins on day 43");
    same(await shown("All", [5, 14, 15, 42, 43]), [5, 14, 15, 42, 43], "and 'All' is all of them");
    await page.close();
  }

  {
    const lines = [
      { type: "P", strike: 48, expiry: "2026-10-04", bid: 0.35 },
      { type: "P", strike: 46, expiry: "2026-11-13", bid: 1.4 },
      { type: "C", strike: 52, expiry: "2026-11-13", bid: 1.9 },
    ];
    const payload = chain({ ticker: "PLN", spot: 50, lines });
    const page = await openDesk(browser, { payloads: { PLN: payload }, query: "?t=PLN&strategy=both&bp=1000000", errors });
    await ready(page, 3);
    const plan = () => page.locator("#deskPlan").getAttribute("data-plan");
    ok(/best single deployment: \d+× PLN 52\.00 buy-write covered call expiring 2026-11-13/.test(await plan()), `across every tenor the best line is the largest premium, a 45-day one (${(await plan()).slice(0, 140)})`);
    ok(/3 of 3 lines affordable/.test(await plan()), "counted over all three lines");
    await page.locator("#dkTenor .ui-seg-i", { hasText: "≤ 2w" }).click();
    await page.waitForFunction(() => /1 of 1 lines affordable/.test(document.getElementById("deskPlan").dataset.plan || ""), null, { timeout: 5000 });
    const filtered = await plan();
    ok(/best single deployment: \d+× PLN 48\.00 cash-secured put expiring 2026-10-04/.test(filtered), `with '≤ 2w' selected the best deployment is a line inside that window (${filtered.slice(0, 140)})`);
    ok(/1 of 1 lines affordable/.test(filtered), "and the count of affordable lines is over the lines the window shows");
    eq(await page.locator("#deskPlan .dk-hint").textContent(), "1 of 1 lines affordable", "on the card too");
    await page.locator("#dkTenor .ui-seg-i", { hasText: "> 6w" }).click();
    await page.waitForFunction(() => /2 of 2 lines affordable/.test(document.getElementById("deskPlan").dataset.plan || ""), null, { timeout: 5000 });
    ok(!/PLN 48\.00/.test(await plan()), "and the far window never names the near line");
    const cc = await page.locator('#dkList .dk-row[data-strategy="cc"] .dk-col').getAttribute("title");
    ok(/buy-write/.test(cc) && /100 shares bought at the spot price/.test(cc), `a covered call's Collect cell says it is sized as a buy-write (${cc.slice(-90)})`);
    const help = await openInfo(page, page.locator('#dkSizingM [aria-label="About sizing"]'));
    ok(/buy-write/.test(help) && /shares you already hold are not counted/.test(help), "and so does the sizing disclosure");
    ok(/25,5k|comma marks thousands only/.test(help), "which also says how a balance may be written");
    await closeInfo(page);
    await page.close();
  }

  {
    const payload = chain({ ticker: "PLN", spot: 50, lines: [{ type: "P", strike: 48, expiry: "2026-10-16", bid: 0.6 }] });
    const page = await openDesk(browser, { payloads: { PLN: payload }, query: "?t=PLN&strategy=both", errors });
    await ready(page, 1);
    const bp = page.locator("#deskBP");
    await bp.fill("25,5k");
    await page.waitForFunction(() => document.getElementById("deskBP").getAttribute("aria-invalid") === "true", null, { timeout: 3000 });
    eq(await page.locator("#dkList .dk-col").count(), 0, "'25,5k' is refused, not read as 255,000: no Collect column");
    eq(new URL(page.url()).searchParams.get("bp"), null, "and nothing is written to the address");
    ok(/25,5k is refused rather than guessed/.test(flat(await page.locator("#dkSizingM .dk-hint").first().textContent())), "and the card says why, instead of only turning the field red");
    await bp.fill("10000.75");
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-col").length > 0, null, { timeout: 3000 });
    eq(new URL(page.url()).searchParams.get("bp"), "10000.75", "a balance with cents is written to the address as it is held, not rounded to 10001");
    await bp.blur();
    await bp.evaluate((n) => n.dispatchEvent(new Event("change")));
    eq(await bp.inputValue(), "10,000.75", "and the field shows the same number");
    const reloaded = await openDesk(browser, { payloads: { PLN: payload }, query: "?t=PLN&strategy=both&bp=10000.75", errors });
    await ready(reloaded, 1);
    eq(await reloaded.locator("#deskBP").inputValue(), "10,000.75", "so a reload restores exactly it");
    await reloaded.close();
    await bp.fill("25,000");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("bp") === "25000", null, { timeout: 3000 });
    eq(new URL(page.url()).searchParams.get("bp"), "25000", "thousands separators are still read");
    await page.close();
  }

  {
    const lines = [];
    for (const [strike, bid] of [[92, 0.3], [95, 0.7], [98, 1.4], [102, 1.3], [105, 0.6]]) lines.push({ type: strike < 100 ? "P" : "C", strike, expiry: "2026-10-16", bid, volume: strike === 98 ? 0 : 60 });
    for (const [strike, bid] of [[94, 1.5], [97, 2.4], [103, 2.3], [106, 1.4]]) lines.push({ type: strike < 100 ? "P" : "C", strike, expiry: "2026-11-20", bid, volume: 40 });
    const payload = chain({ ticker: "SMI", spot: 100, lines });
    payload.ivSurface = ivSurface(payload.rows.map((r) => ({ ...r })), { ivBasis: payload.ivBasis });
    ok(payload.ivSurface.status === "ok", `the fixture yields a surface (${payload.ivSurface.status})`);
    const page = await openDesk(browser, { payloads: { SMI: payload }, query: "?t=SMI&strategy=both", errors });
    await ready(page, 3);
    await page.waitForFunction(() => document.querySelectorAll("#deskSurface .ivs-cell").length > 0, null, { timeout: 10000 });
    const note = await openInfo(page, page.locator('#deskSurface [aria-label="About smile"]'));
    await closeInfo(page);
    ok(/vendor.s implied volatility for that contract.s last transaction/.test(note), "the smile says each cell is the vendor's last-transaction volatility");
    ok(/not the volatility the lines above use for delta, win % and EV, which is inverted from each contract.s mid/.test(note), "and that the lines above use another one, so the two are not mixed");
    ok(/At the money, on the vendor.s last-transaction volatility:/.test(note), "the at-the-money levels are labelled with the basis they use");
    const title = await page.$eval("#deskSurface .ivs-cellgroup title", (n) => n.textContent);
    ok(/% vendor volatility/.test(title), `a cell's tooltip names the basis of its number (${title.slice(0, 80)})`);
    const level = await page.$eval("#deskSurface .ivs-levelgroup title", (n) => n.textContent);
    ok(/% vendor volatility/.test(level), "and so does an at-the-money level's");
    const aria = await page.$eval("#deskSurface .ivs", (n) => n.getAttribute("aria-label"));
    ok(/vendor's last-transaction figure/.test(aria), "and the chart's text alternative");
    const row = await lineInfo(page, '#dkList .dk-row[data-strike="98"]');
    ok(/inverted from the mid/.test(row.facts.Volatility || ""), `the same contract's line names the mid-inverted volatility it uses (${row.facts.Volatility})`);
    await page.close();
  }

  {
    const spot = 100;
    const line = { type: "P", strike: 96, expiry: "2026-12-18", bid: 0.4, ask: 0.42 };
    const cases = [
      ["on the half day after Thanksgiving the session ends at 1pm EST (18:00Z), not at 4pm", "2026-11-27T23:00:00Z", "2026-11-27T18:00:00Z"],
      ["after a winter close, the origin is 4pm EST (21:00Z), not the summer 20:00Z", "2026-12-17T23:00:00Z", "2026-12-17T21:00:00Z"],
      ["a read before the close prices from the read, not from a close that has not happened", "2026-12-17T15:00:00Z", "2026-12-17T15:00:00Z"],
      ["a read after a summer close still starts from 4pm EDT (20:00Z)", "2026-09-29T23:00:00Z", "2026-09-29T20:00:00Z"],
    ];
    for (const [why, generatedAt, origin] of cases) {
      const day = generatedAt.slice(0, 10);
      const payload = chain({ ticker: "ORG", spot, asOf: day, lines: [{ ...line, expiry: day.startsWith("2026-1") && day >= "2026-11" ? "2026-12-18" : "2026-10-02" }], source: "daily-close", extra: { generatedAt } });
      const page = await openDesk(browser, { payloads: { ORG: payload }, query: "?t=ORG&strategy=csp", errors });
      await ready(page, 1);
      const info = await lineInfo(page, "#dkList .dk-row");
      const shown = parseFloat(info.facts.Volatility);
      const r = payload.rows[0];
      const fit = NODE_Q.contractFit({ expiry: r.expiry, asOfMs: Date.parse(origin), spot, rate: null, row: { K: r.strike, type: "P", bid: r.bid, ask: r.ask, oi: r.oi, volume: r.volume, sym: r.symbol, ivSeed: r.iv } });
      const want = fit.slice.params.sigma * 100;
      ok(Math.abs(shown - want) < 0.06, `${why}: the volatility inverted from the mid is ${shown}% and the engine gives ${want.toFixed(2)}% from ${origin}`);
      await page.close();
    }
  }

  {
    const payload = nvdaAfter();
    payload.gated = { ...payload.gated, offMarket: 3, spread: 2 };
    const page = await openDesk(browser, { payloads: { NVDA: payload }, query, errors });
    await ready(page, 9);
    const foot = await page.locator("#deskFoot").textContent();
    ok(/3 with an ask below intrinsic value/.test(foot), `the off-market gate is one of the counted reasons a contract was dropped (${foot.slice(0, 160)})`);
    await page.close();
  }

  for (const width of [320, 390, 1440]) {
    const page = await openDesk(browser, { payloads: { NVDA: nvdaAfter() }, query, viewport: { width, height: 900 }, errors });
    await ready(page, 9);
    const head = await page.evaluate(() => {
      const hd = document.querySelector("#dkLinesM .ui-mod-h");
      const tag = hd && hd.querySelector(".ui-calib");
      const b = tag ? tag.getBoundingClientRect() : null, r = hd ? hd.getBoundingClientRect() : null;
      return { text: tag ? tag.textContent : null, next: tag && tag.nextElementSibling ? tag.nextElementSibling.id : null,
        inside: !!(b && r && b.left >= r.left - 1 && b.right <= r.right + 1), clipped: tag ? tag.scrollWidth > tag.clientWidth + 1 : null,
        page: document.documentElement.scrollWidth > innerWidth + 1, tags: document.querySelectorAll(".ui-calib").length };
    });
    eq(head.text, "Not yet calibrated", `at ${width}px the Lines header, which ranks by EV real world and shows the real-world Win %, says the probability is not calibrated`);
    eq(head.next, "deskRank", "and it sits beside the rank option that can order the lines by that uncalibrated figure");
    eq(head.tags, 1, "one note on the page, not one per line");
    ok(head.inside && !head.clipped && !head.page, `and at ${width}px it fits its header, unclipped, with no page overflow`);
    if (width === 1440) {
      const text = await openInfo(page, page.locator("#dkLinesM .ui-calib"));
      const pop = await page.evaluate(() => ({ title: document.getElementById("fxPopT").textContent, lead: document.querySelector("#fxPop .ui-lead").textContent }));
      same(pop, { title: "Not yet calibrated", lead: "Model probability, not yet checked against outcomes." }, `its popover says what the chip means, in the words the plan fixed (${text})`);
      ok(/until 100 effectively independent outcomes are scored/.test(text), "and when it will come off");
      await closeInfo(page);
      const cond = await page.evaluate(() => [undefined, null, {}, { nEff: 99 }, { nEff: 99.9 }, { nEff: "150" }, { nEff: NaN }, { nEff: 100 }, { nEff: 412 }]
        .map((c) => { const n = window.FlowsUI.calibTag(c); return n ? n.textContent : null; }));
      same(cond, ["Not yet calibrated", "Not yet calibrated", "Not yet calibrated", "Not yet calibrated", "Not yet calibrated", "Not yet calibrated", "Not yet calibrated", null, null],
        "the note shows while no calibration record is held, or its effective n is under 100 or not a number, and comes off only at nEff 100 or more");
      await page.locator("#dkScatter .tl-scrub").focus();
      const reads = [];
      for (let k = 0; k < 12; k++) {
        await page.keyboard.press("ArrowRight");
        const t = await page.$eval("#dkScatter .ui-readout", (n) => n.classList.contains("is-on") ? n.textContent : null);
        if (t && !reads.includes(t)) reads.push(t);
      }
      const realRows = await page.$$eval("#dkList .dk-row", (rs) => rs.filter((r) => /\d%/.test((r.querySelector(".dk-pp") || {}).textContent || "")).length);
      ok(reads.length > 1 && realRows > 0, `the frontier is walked point by point over lines that hold a real-world chance (${reads.length} points, ${realRows} rows)`);
      ok(reads.every((t) => !/Real/.test(t)), `and its readout, in a module with no calibration note, prints no real-world chance; that figure stays in the Lines module under the note (${reads.join(" | ")})`);
    }
    await page.close();
  }

  for (const width of [1060, 1440]) {
    const page = await openDesk(browser, { payloads: { NVDA: nvdaAfter() }, query: query + "&bp=25000", viewport: { width, height: 900 }, errors });
    await ready(page, 9);
    await page.waitForTimeout(300);
    const fit = await page.evaluate(() => {
      const head = document.querySelector("#dkList .dk-head");
      const spans = head && getComputedStyle(head).display !== "none" ? [...head.children] : [];
      const wide = spans.filter((s0) => { const r = document.createRange(); r.selectNodeContents(s0); return r.getBoundingClientRect().width > s0.getBoundingClientRect().width + 1; }).map((s0) => s0.textContent);
      return { spans: spans.length, wide, page: document.documentElement.scrollWidth > innerWidth + 1, list: document.getElementById("dkList").scrollWidth > document.getElementById("dkList").clientWidth + 1 };
    });
    ok(fit.spans > 0, `at ${width}px the lines read as a table under a header row`);
    same(fit.wide, [], `and at ${width}px no header label, the two long chance labels included, is wider than its column`);
    ok(!fit.page && !fit.list, `and nothing overflows the page or the list at ${width}px`);
    await page.close();
  }

  if (process.env.DESK_SHOTS) {
    mkdirSync(process.env.DESK_SHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      const page = await openDesk(browser, { payloads: { NVDA: nvdaAfter() }, query, viewport: { width, height: 1300 }, errors });
      await ready(page, 9);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${process.env.DESK_SHOTS}/after-${width}.png`, fullPage: true });
      await page.close();
    }
  }

  eq(errors.length, 0, `no uncaught page error across the whole session (${errors[0] || ""})`);
} finally {
  await browser.close();
}

console.log(`✓ flows-desk-client: ${checks} assertions — the frontier's Pareto set against a brute force over 8,000 random sets with ties, ` +
  `a square-root axis that says so and whose ticks are placed on it, covered calls plotted at one minus their delta beside puts at theirs, ` +
  `the two chances named for what they are, a tooltip on every dash and on the EV, a bid under intrinsic value called impossible, ` +
  `one capital basis per line, a rebased or mismatched chain announced and never ranked, the plan computed over the tenor window, ` +
  `a balance that refuses 25,5k and round-trips its cents, tenor buckets pinned by label at the day, and the smile's volatility basis stated, and a quote origin that follows the Eastern clock, half days included, and never the future, ` +
  `a dash that carries the engine's reason and code, an in-the-money line read from the other side's quote, an earnings gate, ` +
  `the rate and dividend yield each line was priced at, a grade in words, and a real-world chance that says it is not yet calibrated`);
