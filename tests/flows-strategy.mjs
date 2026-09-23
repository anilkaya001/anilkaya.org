import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";
import * as BS from "../shared/flows-quant-bs.js";
import * as SMILE from "../shared/flows-quant-smile.js";
import * as WORLD from "../shared/flows-quant-world.js";
import * as QC from "../shared/flows-quant-card.js";
import * as QP from "../scripts/flows-quant-pipeline.mjs";
import { STATE_STRUCTURES } from "../shared/flows-neuron.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const MINUS = "−";
const DASH = "—";

const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

const SESSION_DAY = "2026-09-04";
const NEAR = "2026-10-16";
const FAR = "2026-12-18";
const BROKEN = "2026-11-20";

const greeks = (d, g, t, v, r) => ({
  delta: String(d), gamma: String(g), theta: String(t), vega: String(v), rho: String(r),
});

const NEAR_CALLS = [

  { option_symbol: "AAA261016C00100000", nbbo_bid: "4.90", nbbo_ask: "5.10",
    implied_volatility: "0.30", volume: "100", open_interest: "500",
    ...greeks(0.55, 0.03, -0.05, 0.12, 0.04) },

  { option_symbol: "AAA261016C00110000", nbbo_bid: "1.90", nbbo_ask: "2.10",
    implied_volatility: "0.28", volume: "80", open_interest: "400",
    ...greeks(0.30, 0.02, -0.04, 0.10, 0.02) },

  { option_symbol: "AAA261016C00120000", nbbo_bid: "0.45", nbbo_ask: "0.55",
    implied_volatility: null, volume: "5", open_interest: "20",
    delta: null, gamma: null, theta: null, vega: null, rho: null },
];

const NEAR_PUTS = [

  { option_symbol: "AAA261016P00100000", nbbo_bid: "4.90", nbbo_ask: "5.10",
    implied_volatility: "0.31", volume: "60", open_interest: "300",
    ...greeks(-0.45, 0.03, -0.05, 0.12, -0.03) },
  { option_symbol: "AAA261016P00090000", nbbo_bid: "1.40", nbbo_ask: "1.60",
    implied_volatility: "0.35", volume: "10", open_interest: "120",
    ...greeks(-0.20, 0.02, -0.03, 0.08, -0.01) },

  { option_symbol: "AAA261016P00080000", nbbo_bid: null, nbbo_ask: "0.10",
    implied_volatility: "0.40", volume: "0", open_interest: "5",
    ...greeks(-0.05, 0.01, -0.01, 0.02, -0.01) },
];

const farCall = (strike) => ({
  option_symbol: "AAA261218C" + String(strike * 1000).padStart(8, "0"),
  nbbo_bid: "1.00", nbbo_ask: "1.20", implied_volatility: "0.30",
  volume: "1", open_interest: "10", ...greeks(0.5, 0.01, -0.01, 0.05, 0.01),
});
const FAR_CALLS_P1 = Array.from({ length: 500 }, (_, i) => farCall(i + 1));
const FAR_CALLS_P2 = Array.from({ length: 500 }, (_, i) => farCall(i + 501));
const FAR_PUTS = [90, 100, 110].map((k) => ({
  option_symbol: "AAA261218P" + String(k * 1000).padStart(8, "0"),
  nbbo_bid: "2.00", nbbo_ask: "2.20", implied_volatility: "0.30",
  volume: "1", open_interest: "10", ...greeks(-0.4, 0.01, -0.01, 0.05, -0.01),
}));

const SVI = { a: 0.006, b: 0.06, rho: -0.55, m: 0.02, sigma: 0.12 };
const BBB = (() => {
  const T = 42 / 365, F = 102 * Math.exp(0.04 * T), D = Math.exp(-0.04 * T);
  const rng = WORLD.xoshiro128ss("bbb");
  const rows = { C: [], P: [] };
  for (let K = 70; K <= 135 + 1e-9; K += 2.5) {
    const vol = Math.sqrt(SMILE.sviW(SVI, Math.log(K / F)) / (32 / 365));
    for (const type of ["C", "P"]) {
      const price = BS.black76(F, D, K, vol, T, type);
      const half = Math.max(0.01, 0.012 * price);
      const mid = price + (rng.uniform() - 0.5) * half;
      const otm = type === "C" ? K >= 102 : K <= 102;
      const oi = Math.round((otm ? 5000 : 1800) * Math.exp(-Math.abs(Math.log(K / 102)) / 0.1)) + 300;
      rows[type].push({
        option_symbol: "BBB261016" + type + String(Math.round(K * 1000)).padStart(8, "0"),
        nbbo_bid: String(Math.max(0.01, Math.round((mid - half) * 100) / 100)), nbbo_ask: String(Math.round((mid + half) * 100) / 100 + 0.01),
        implied_volatility: String(vol), open_interest: String(oi), volume: String(Math.round(oi / 7)),
        ...greeks(0.5, 0.01, -0.01, 0.05, 0.01),
      });
    }
  }
  return rows;
})();

const upstreamCalls = [];
const upstream = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  upstreamCalls.push(url.pathname + url.search);
  const m = url.pathname.match(/\/api\/stock\/([^/]+)\//);
  const ticker = m ? decodeURIComponent(m[1]).toUpperCase() : "";
  const send = (status, body) => {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };

  if (url.pathname.endsWith("/stock-state")) {
    if (ticker === "SPY") {
      return send(200, { close: "600.00", prev_close: "598.00",
        market_time: "regular", tape_time: SESSION_DAY + " 18:06:00+00:00" });
    }
    return send(200, { close: "102.00", prev_close: "100.00",
      market_time: "regular", tape_time: SESSION_DAY + " 18:06:00+00:00" });
  }

  if (url.pathname.includes("/ohlc/")) {
    return send(200, { data: [{ date: "2026-09-03", close: "100.00" }] });
  }

  if (url.pathname.endsWith("/info")) {

    return send(200, { data: {
      next_earnings_date: "2026-11-05", announce_time: "postmarket",
      issue_type: "Common Stock", beta: "1.50",
    } });
  }

  if (url.pathname.endsWith("/expiry-breakdown")) {
    if (ticker === "ZZZ") return send(200, { data: [] });
    if (ticker === "YYY") return send(500, {});
    return send(200, { data: [
      { expires: NEAR, chains: 5, open_interest: 1320, volume: 250 },
      { expires: BROKEN, chains: 10, open_interest: 400, volume: 5 },
      { expires: FAR, chains: 12223, open_interest: 90000, volume: 40 },
    ] });
  }

  if (url.pathname.endsWith("/option-contracts")) {
    const expiry = url.searchParams.get("expiry");
    const type = url.searchParams.get("option_type");
    const page = Number(url.searchParams.get("page") || "1");
    if (expiry === BROKEN) return send(500, {});
    if (ticker === "BBB" && expiry === NEAR) return send(200, { data: type === "call" ? BBB.C : BBB.P });
    if (expiry === NEAR) {
      return send(200, { data: type === "call" ? NEAR_CALLS : NEAR_PUTS });
    }
    if (expiry === FAR) {
      if (type === "put") return send(200, { data: FAR_PUTS });
      return send(200, { data: page >= 2 ? FAR_CALLS_P2 : FAR_CALLS_P1 });
    }
    return send(200, { data: [] });
  }

  return send(404, {});
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamURL = `http://127.0.0.1:${upstream.address().port}`;

const INGEST = "strategy-ingest-token";
const server = await startWorker({
  extraVars: ["UW_API_KEY:test-uw-key", `UW_BASE:${upstreamURL}`, `FLOWS_INGEST_TOKEN:${INGEST}`],
});
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);

{
  const GARCH = { status: "ok", omega: 0.045, alpha: 0.05, beta: 0.9, nu: 7, lambda: -0.1, avg21Vol: 24, nextVol: 23,
    sigma2Next: Math.pow(0.23, 2) / 252, persistence: 0.95, grade: 3, why: [], converged: true };
  const closes = (() => { const c = [100]; const rng = WORLD.xoshiro128ss("closes"); for (let i = 0; i < 260; i++) c.push(c[c.length - 1] * Math.exp(0.015 * WORLD.normalDraw(rng))); return c; })();
  const pLaw = QC.compactLaw(QP.garchLaw({ garch: GARCH, ticker: "BBB", sessionDate: SESSION_DAY, closes, rate: 0.04, paths: 2048 }));
  const card = {
    ticker: "BBB", sessionDate: SESSION_DAY, generatedAt: new Date().toISOString(), panels: {},
    engine: {
      v: 1, engine: "q1", asOf: SESSION_DAY, spot: 101.5, atr: 2, rate: { r: 0.04, method: "constant", n: 0 },
      facts: [], state: { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich },
      levels: { callWall: 105, putWall: 97.5, magnet: 102.5, flip: 100, maxPain: 102.5, atr: 2 }, event: null, pLaw,
      structures: [], ideas: [], noTrade: null,
    },
  };
  const put = await fetch(server.baseURL + "/api/flows/ingest?key=card%3ABBB", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST }, body: JSON.stringify(card),
  });
  ok(put.ok, `a card with an engine block and a GARCH law is published for BBB (${put.status})`);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies([{
    name: "flows_session", value: token,
    domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax",
  }]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const go = async (q) => {
    await page.goto(server.baseURL + "/flows/strategy/" + q, { waitUntil: "domcontentloaded" });
    await ready();
  };
  const ready = () => page.waitForFunction(() => {
    const s = document.getElementById("sgStatus");
    return !!document.querySelector("#sgPayoffM [data-slot='Max loss'] .ui-metric-v") && !document.querySelector("#sgGrid[data-busy]") && s && !/^Reading/.test(s.textContent);
  }, null, { timeout: 30000 });
  const slot = (name) => page.$eval(`[data-slot="${name}"]`, (n) => ({
    label: n.querySelector(".ui-metric-l") ? n.querySelector(".ui-metric-l").textContent.trim() : "",
    value: (() => { const v = n.querySelector(".ui-metric-v"); if (!v) return ""; const num = v.querySelector(".ui-metric-n"); return num ? (num.dataset.value || num.textContent).trim() : v.firstChild ? v.firstChild.textContent.trim() : ""; })(),
    silent: !!n.querySelector('.ui-metric-v[data-tone="silent"]'),
    word: n.classList.contains("is-word"),
    state: n.querySelector(".ui-state") ? n.querySelector(".ui-state").dataset.state : null,
  }));
  const popText = async () => flat(await page.locator("#fxPop").textContent());
  const openInfo = async (label) => {
    await page.click(`[aria-label="${label}"]`);
    await page.waitForSelector("#fxPop:popover-open");
    return popText();
  };
  const closeInfo = async () => { await page.keyboard.press("Escape"); await page.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" }); };
  const turning = async () => {
    await page.click('[aria-label="About payoff"]');
    await page.waitForSelector("#fxPop:popover-open .tl-pts");
    const rows = await page.$$eval("#fxPop .tl-pts tbody tr", (trs) => trs.map((tr) => ({
      S: tr.children[0].textContent.trim(), pnl: tr.children[1].textContent.trim(), what: tr.children[2].textContent.trim(),
    })));
    const text = await popText();
    await closeInfo();
    return { rows, text, at: (label) => { const r = rows.find((x) => x.S === label); return r ? r.pnl : null; } };
  };

  {
    await page.goto(server.baseURL + "/flows/strategy/", { waitUntil: "domcontentloaded" });
    eq(await page.locator("#sgRefusePanel").count(), 1,
       "the refusals are in the DOCUMENT rather than in the renderer — they are true before any fetch and true if every fetch fails");
    ok(await page.locator("#sgRefusePanel").isHidden(), "and they are off the surface: the page paints nouns and numbers, the prose waits one tap away");

    const refuse = flat(await page.locator("#sgRefusePanel").textContent());
    ok(/Buying power reduction/i.test(refuse) && /Refused/.test(refuse),
       "buying power reduction is named and marked Refused");
    ok(/broker/i.test(refuse) && /28,755/.test(refuse),
       "and the reason is given in full: it is a broker's number, and the vendor's specification does not contain the concept anywhere in its 28,755 lines");
    ok(/Reg-T/.test(refuse) && /labelled as such/.test(refuse),
       "and the capital figure the engine does publish is named for what it is, the Reg-T minimum or the maximum loss");
    ok(/Conditional value at risk/i.test(refuse) && /distribution/i.test(refuse) && /real-world law/i.test(refuse),
       "conditional value at risk is published only over the real-world law, and the page says it never takes a tail over the risk-neutral density");
    ok(/delta .{0,3} beta .{0,3} \(/i.test(refuse) || /not delta times beta/i.test(refuse),
       "and beta-weighted delta is corrected rather than quietly offered as delta x beta");

    ok(/model-free/i.test(refuse) && /intrinsic value/.test(refuse),
       "the expiry line is identified as the one reading that needs nothing: intrinsic value, no volatility");
    ok(/fitted smile/.test(refuse) && /Black-76/.test(refuse) && /parity/.test(refuse),
       "the today line names its engine — Black-76 on the fitted smile against a parity forward — replacing the Taylor expansion in vendor greeks that the page used to draw");
    ok(/dividend is implied by the book rather than assumed/.test(refuse) && /rate is the card/.test(refuse),
       "and it names where the two parameters the old page refused to invent now come from: the dividend from put-call parity, the rate from the card");
    ok(/least accurate/.test(refuse) && /extrapolated/.test(refuse),
       "and states where it is worst — beyond the last quoted strike — rather than leaving a reader to find out");
    ok(/not advice/.test(refuse) && /no upper bound/.test(refuse), "and it closes on the loss a short call can reach, and not advice");

    eq(await page.locator("#sgPayoffM").count(), 0, "no priced module before a symbol is asked for");
    eq(flat(await page.locator("#sgStatus").textContent()), "Enter a symbol to begin.", "and the status invites one");
    const tiles = await page.$$eval(".tl-tile", (ts) => ts.map((t) => t.dataset.family));
    eq(tiles.length, 22, "the whole catalogue is on the page before any symbol: twenty-two structures, the engine's 23 less 'no position'");
    const about = await openInfo("About the strategy lab");
    ok(/28,755/.test(about) && /same engine|exactly as the server/.test(about),
       "and the About disclosure carries the refusals and says the page prices exactly as the server does");
    await closeInfo();
  }

  {
    await page.fill("#sgTicker", "aaa");
    await page.click(".sg-load");
    await ready();

    const spot = flat(await page.locator("#sgPx .tl-spot").textContent());
    eq(spot, "102.00", "spot is the live print — the diagram's whole x-axis is measured from this number");
    const ctx = await openInfo("Live print");
    const facts = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
    ok(/live print/.test(ctx) && /live print/.test(facts.Spot), `and the disclosure says it is the live print (${facts.Spot})`);
    eq(facts.Session, "2026-09-04", "the session date comes from the tape rather than from the wall clock");
    eq(facts.Beta, "1.50", "beta is published");
    eq(facts["Reference index"], "SPY 600.00",
       "the reference index is NAMED and priced — a beta-weighted delta against an unnamed index is a number whose definition was withheld");
    ok(/2026-11-05/.test(facts["Next earnings"]), "and the earnings date rides along, because a contract that outlives a report is a different trade at the same premium");
    await closeInfo();

    const contractCalls = upstreamCalls.filter((u) => u.includes("/option-contracts"));
    ok(contractCalls.length > 0, "the expiry read reached the provider");
    ok(contractCalls.every((u) => /expiry=2026-10-16/.test(u)),
       "every contract request names ONE expiry — the vendor's own documented query parameter, and what makes a 12,000-contract book reachable a slice at a time");
    ok(contractCalls.some((u) => /option_type=call/.test(u)) && contractCalls.some((u) => /option_type=put/.test(u)),
       "and splits calls from puts, which halves the population each 500-row page has to hold");
    ok(contractCalls.every((u) => !/maybe_otm_only|exclude_zero_oi_chains/.test(u)),
       "and sends NEITHER of the premium desk's filters: a long in-the-money call does not survive them");

    const chips = await page.$$eval(".tl-chip", (cs) => cs.map((c) => ({ label: c.getAttribute("aria-label"), text: c.textContent, on: c.getAttribute("aria-checked") })));
    eq(chips.length, 3, "every listed expiry is offered");
    ok(/12223 listed/.test(chips[2].label),
       `THE SIZE OF AN EXPIRY IS IN THE PICKER, BEFORE IT IS READ (${chips[2].label}); its bar is drawn to that count`);
    ok(/42d/.test(chips[0].text) && /42 days/.test(chips[0].label),
       "and each chip carries its days to expiry, counted in calendar days from the session");
    eq(chips[0].on, "true", "the first read is the expiry nearest the structure's window, 42 days here");
    ok(!upstreamCalls.some((u) => /\/stock\/AAA\/expiry-breakdown\?.*date=/.test(u)) &&
       !upstreamCalls.some((u) => /\/stock\/AAA\/greek-exposure\/expiry/.test(u)),
       "the breakdown is read under the vendor's live field name `expires`, so no dated retry or fallback is spent");

    const ex = await openInfo("About expiries");
    ok(/5 of 6 contracts read at Oct 16 carry a two-sided quote/.test(ex),
       `the book states what it holds OF WHAT — two-sided quotes among contracts read — because a strike handle can only land on one of those (${ex.slice(0, 160)}…)`);
    await closeInfo();
  }

  {
    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@1");
    const cost = await slot("Cost");
    eq(cost.label, "Debit", "a long call is a debit, and the sign is in the NAME");
    eq(cost.value, "$500.00", "the net debit is the mid times one hundred shares");
    const mp = await slot("Max profit");
    eq(mp.value, "Unbounded",
       "a long call's maximum profit is UNBOUNDED and is reported as the word. There is no number there, so none is printed");
    ok(mp.word, "and it is styled as a word rather than as a figure, so it cannot be scanned as one");
    eq((await slot("Max loss")).value, MINUS + "$500.00", "the maximum loss is the whole premium, signed with U+2212");
    eq((await slot("Breakeven")).value, "105", "the breakeven is the strike plus the premium");

    const t = await turning();
    eq(t.at("$0"), MINUS + "$500.00", "payoff at zero: the premium, lost");
    eq(t.at("$100"), MINUS + "$500.00", "payoff at the strike: the premium, lost");
    eq(t.at("$102"), MINUS + "$300.00", "payoff at spot: $2 of intrinsic on a hundred shares, less the $500 paid");
    eq(t.at("$105"), "$0.00", "payoff at the breakeven is a MEASURED zero and prints as one — never an em dash");
    ok(/net long calls/.test(t.text) && /rises without limit/.test(t.text), "and the disclosure says why the profit has no number");
    ok(/sign is carried by position, never by colour alone/.test(t.text),
       "and states the sign channel: profit above the zero rule, loss below it");

    await page.click('#sgBasis [role="tab"]:nth-of-type(2)');
    await page.waitForFunction(() => /502\.50/.test(document.querySelector('[data-slot="Cost"] .ui-metric-n').dataset.value || ""));
    eq((await slot("Cost")).value, "$502.50", "at the engine's fill the same call costs the mid plus a quarter of the spread");
    eq(new URL(page.url()).searchParams.get("basis"), null, "and fill is the default the URL does not repeat");

    const d = await slot("Delta");
    ok(!d.silent && /^[+−]\d/.test(d.value),
       `the position delta comes from the smile, not from the vendor's per-contract greek (${d.value}); a contract the vendor sent no greeks for no longer silences it`);
    const popQ = await page.$eval('.tl-pop-r[data-law="q"] .tl-pop-v', (n) => (n.querySelector("[data-value]") || n).dataset.value || n.textContent);
    ok(/^\d+\.\d%$/.test(popQ), `and a chance of profit at expiry under the smile's own density, to a tenth of a point (${popQ})`);

    const want = await page.evaluate(async (exp) => {
      const b = await (await fetch("/api/flows/strategy?t=AAA&expiry=" + exp + "&engine=1", { credentials: "same-origin" })).json();
      const en = b.engine, Q = window.FlowsQuant;
      const setup = Q.labSetup({ asOfMs: en.asOfMs, spot: en.spot, facts: en.facts, state: en.state, pLaw: en.pLaw, levels: en.levels, event: en.event, stale: en.stale,
        books: [{ fit: en.fits[0], rows: Q.bookRows(b.calls, b.puts, "AAA") }] });
      const r = Q.priceStructure(setup, { family: "custom", fam: { id: "custom", risk: "defined", dir: "neutral" }, expiry: exp, dir: "neutral",
        legs: [{ type: "C", K: 100, side: 1, qty: 1, expiry: exp }] }, { detail: true, curves: true });
      return { g: r.greeks, S: en.spot, popQ: r.prob.popQ };
    }, NEAR);
    const money = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: Math.abs(v) < 1000 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 0 });
    eq(popQ, (Math.round(want.popQ * 1000) / 10).toFixed(1) + "%", "the implied chance is the engine's, re-priced in the page at the fill the page shows");
    const sh = want.g.delta$ / want.S;
    eq(d.value, (sh < 0 ? MINUS : "+") + Math.abs(sh).toFixed(Math.abs(sh) < 10 ? 1 : 0), `the delta is the engine's dollar delta in shares, unmodified (${d.value})`);
    await page.click('[aria-label="About greeks"]');
    await page.waitForSelector("#fxPop:popover-open");
    const gf = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
    const gtext = await popText();
    await closeInfo();
    ok(gf.Delta.startsWith(money(want.g.delta$)), `the disclosure carries the engine's dollar delta to the cent (${gf.Delta})`);
    eq(gf.Gamma, money(want.g.gamma$1pct) + " of delta per 1% move", "and its gamma per 1% move");
    eq(gf.Vega, money(want.g.vegaPt) + " per volatility point", "and its vega per volatility point");
    eq(gf.Theta, money(want.g.thetaDay) + " per day", "and its theta per calendar day, the engine's number with nothing re-derived in the page");
    const bw = sh * 1.5 * (102 / 600);
    eq(gf["Beta-weighted delta"], (bw < 0 ? MINUS : "+") + Math.abs(bw).toFixed(1) + " SPY share-equivalents",
       `the beta-weighted delta is delta × beta × (this price ÷ the index's price) against a NAMED index (${gf["Beta-weighted delta"]})`);
    ok(/× 1\.50 ×/.test(gtext) && /102\.00 ÷ 600\.00/.test(gtext) && /against a different index it is a different number/.test(gtext),
       "and the disclosure shows the terms, so the number is never delta times beta passed off as the weighted one");
    const evP = await slot("EV real world");
    ok(evP.silent && evP.state === "unavailable",
       "with the real-world expectation shown as an em dash and a glyph while no law was published for the name");
    const odds = await openInfo("About odds");
    ok(/no card with a GARCH law is published for AAA/.test(odds), "and the reason one tap away names what is missing");
    await closeInfo();
    const quant = await page.evaluate(() => typeof window.FlowsQuant === "object" && typeof window.FlowsQuant.priceStructure === "function" && typeof window.FlowsQuant.labSetup === "function");
    ok(quant, "the generated FlowsQuant bundle is the page's only engine global");
  }

  {
    const cookie = { Cookie: "flows_session=" + token };
    const withEngine = await (await fetch(server.baseURL + "/api/flows/strategy?t=AAA&expiry=" + NEAR + "&engine=1",
      { headers: cookie })).json();
    const e = withEngine.engine;
    ok(e && e.status === "ok" && e.spotSource === "stock-state" && e.spot === 102,
       `engine=1 runs the card engine on the expiry just read, priced against the live print (${e && e.status}, ${e && e.spotSource})`);
    ok(e && e.expiries.length === 1 && e.expiries[0].expiry === NEAR && e.expiries[0].smile && e.expiries[0].forward,
       "for that one expiry only, with its smile and its parity forward");
    ok(e && Array.isArray(e.fits) && e.fits.length === 1 && e.fits[0].slice && e.fits[0].forward && Number.isFinite(e.asOfMs) && e.stale === false,
       "and with the full-precision fit, the clock it priced at and the stale flag, which is everything the page needs to price as the Worker does");
    ok(e && Array.isArray(e.structures) && Array.isArray(e.facts) && "noTrade" in e,
       "in the same structure objects the card publishes, so the page reads one shape wherever it came from");
    ok(e && e.lawFrom === null && e.pLaw === null, "and with no card published for the name, no real-world law is invented for it");
    const plain = await (await fetch(server.baseURL + "/api/flows/strategy?t=AAA&expiry=" + NEAR, { headers: cookie })).json();
    ok(!("engine" in plain), "without engine=1 the payload is the vendor read it always was");
  }

  {
    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@1,AAA261016C00110000@-1");
    eq((await slot("Cost")).value, "$300.00", "the spread's debit is the difference of the two mids");
    const mp = await slot("Max profit");
    eq(mp.value, "+$700.00",
       "a vertical's maximum profit is the width less the debit, and it is a NUMBER — the short call caps exactly the ray that made the outright unbounded");
    ok(!mp.word, "so it is not styled as the word");
    eq((await slot("Max loss")).value, MINUS + "$300.00", "and the maximum loss is the debit");
    eq((await slot("Breakeven")).value, "103", "with one breakeven, at the long strike plus the debit");
    const t = await turning();
    eq(t.at("$110"), "+$700.00", "payoff at the short strike is the maximum");
    eq(t.at("$102"), MINUS + "$100.00", "payoff at spot");
    eq(t.at("$103"), "$0.00", "and the breakeven row is a measured zero");

    await page.click('#sgBasis [role="tab"]:nth-of-type(3)');
    await page.waitForFunction(() => /320/.test(document.querySelector('[data-slot="Cost"] .ui-metric-n').dataset.value || ""));
    eq((await slot("Cost")).value, "$320.00",
       "priced natural the same spread costs the ask on the buy and pays the bid on the sell — twenty dollars more than the mid, a real cost the mid hides");
    const px4 = await page.$$eval("#sgLegsM .tl-px4 > div", (ds) => Object.fromEntries(ds.map((d) => [d.firstChild.textContent, d.lastChild.textContent])));
    ok(px4.Mid === "$300.00" && px4.Natural === "$320.00" && px4.Fill === "$305.00" && /^\$\d/.test(px4.Model),
       `and the crossing cost is published beside it rather than left to be inferred: mid ${px4.Mid}, fill ${px4.Fill}, natural ${px4.Natural}, on the smile ${px4.Model}`);
    eq((await slot("Max loss")).value, MINUS + "$320.00", "the whole payoff moves with the basis");
    eq(new URL(page.url()).searchParams.get("basis"), "natural", "and the basis is held in the link");
  }

  {
    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@-1");
    const cost = await slot("Cost");
    eq(cost.label, "Credit", "a short position opens for a CREDIT and the reading is named for it");
    eq(cost.value, "$500.00", "at the credit received");
    const ml = await slot("Max loss");
    eq(ml.value, "Unbounded",
       "THE ASSERTION THIS WHOLE SUITE EXISTS FOR: a naked short call's maximum loss is unbounded and must be reported as the word, never as a number");
    ok(ml.word, "and it is set as a word so it cannot be read as a figure");
    const t = await turning();
    ok(/net short calls/.test(t.text) && /no upper bound/.test(t.text),
       "with the reason one tap away at the reading rather than in a footnote");
    eq((await slot("Max profit")).value, "+$500.00", "the maximum profit is the credit received");
    eq((await slot("Breakeven")).value, "105", "and the breakeven is the strike plus the credit");
    eq(t.at("$102"), "+$300.00", "payoff at spot");
    eq(t.at("$105"), "$0.00", "and zero at the breakeven");
    eq(await page.$eval("#sgGreeksM [data-slot='Capital'] .ui-metric-s", (n) => n.textContent), "Reg-T proxy",
       "and its capital is labelled as the Reg-T formula, never as a broker's buying power");
  }

  {
    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016P00100000@-1");
    eq((await slot("Max loss")).value, MINUS + "$9,500",
       "A NAKED SHORT PUT'S LOSS IS BOUNDED and this prints the number: a share cannot trade below zero, so the loss is exactly the strike less the credit");
    const t = await turning();
    ok(/cannot trade below zero/.test(t.text), "and the page says why, because the belief it corrects is widespread");
    eq((await slot("Max profit")).value, "+$500.00", "the maximum profit is the credit");
    eq((await slot("Breakeven")).value, "95", "and the breakeven is the strike less the credit");
    eq(t.at("$0"), MINUS + "$9,500", "the turning-point table carries the same figure");
  }

  {
    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@1,AAA261016C00120000@1");
    eq((await slot("Cost")).value, "$550.00",
       "the money arithmetic is unaffected by a contract the vendor sent no greeks or IV for: the expiry payoff needs no greek at all");
    eq((await slot("Max loss")).value, MINUS + "$550.00", "and the maximum loss still renders as a number");
    const legIv = await page.$$eval("#sgLegsM .tl-leg", (rows) => rows.map((r) => r.textContent));
    ok(legIv.length === 2 && legIv.every((t) => /IV\s*\d/.test(t)),
       "and both legs carry an implied volatility read off the fitted smile, so the one the vendor left blank is no longer a hole");

    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@1,AAA261016P00080000@1");
    for (const name of ["Cost", "Max loss", "Delta"]) {
      const s0 = await slot(name);
      ok(s0.silent && s0.value === DASH,
         `${name} is WITHHELD — an em dash and a glyph — when one leg has no two-sided quote, never summed over the legs that happen to have one`);
    }
    const why = await page.$eval('[data-slot="Cost"] .ui-state', (b) => { b.click(); return true; });
    ok(why, "the withheld slot is a button");
    await page.waitForSelector("#fxPop:popover-open");
    const reason = await popText();
    ok(/Withheld/.test(reason) && /80 put/.test(reason) && /no two-sided quote/.test(reason) && /unknown cost, not a smaller one/.test(reason),
       `and the leg responsible is NAMED (${reason.slice(0, 120)}…): "withheld" without a reason is indistinguishable from a bug`);
    await closeInfo();

    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@1,AAA261016C00130000@-1");
    const gone = await slot("Cost");
    ok(gone.silent && gone.state === "withheld", "a leg the book does not list is withheld too");
    await page.click('[data-slot="Cost"] .ui-state');
    await page.waitForSelector("#fxPop:popover-open");
    ok(/no longer listed at that expiry/.test(await popText()), "and says the contract was read for and is not in the book");
    await closeInfo();
  }

  {
    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@1");
    eq(await page.locator("#sgPayoff path.tl-exp").count(), 1, "the expiry line is drawn");
    eq(await page.locator("#sgPayoff path.tl-today").count(), 1, "and the today line re-priced on the smile is drawn beside it");
    eq(await page.locator("#sgPayoff line.base").count(), 1, "with the zero rule, the axis the sign is read against");
    eq(await page.locator("#sgPayoff path.tl-wash-up").count(), 1, "the profit wash is one path");
    eq(await page.locator("#sgPayoff path.tl-wash-dn").count(), 1, "and the loss wash its twin");
    const clips = await page.$$eval("#sgPayoff path[class^='tl-wash']", (ps) => ps.map((p) => p.getAttribute("clip-path")));
    ok(clips.every((c) => /^url\(#cp\d+\)$/.test(c)), `each wash is clipped to its own side of the zero rule, never drawn whole (${clips})`);
    ok(await page.locator("#sgPayoff svg[viewBox]").evaluate((s) => s.getAttribute("preserveAspectRatio") === null),
       "and the SVG's viewBox is its pixel box, never preserveAspectRatio=none");
    const scen = await page.$$eval("#sgScenM tbody td", (tds) => tds.length);
    ok(scen >= 28, `the scenario grid prices every spot row at four points in time (${scen} cells)`);
    ok(await page.locator("#sgScenM td.is-now").count() === 1, "and rings the one cell that is today at spot");
    const nowCell = flat(await page.locator("#sgScenM td.is-now").textContent());
    const nowTag = flat(await page.locator("#sgPayoff text.tl-tag-now").textContent());
    eq(nowTag, nowCell, `the payoff's today tag and the ringed cell are one number, as the disclosure says they are (${nowTag})`);
    eq(await page.locator("#sgPayoff circle.tl-now").count(), 1, "and the today line carries a dot at spot, where that number is read");
    const spots = await page.$$eval("#sgScenM tbody th b", (bs) => bs.map((b) => b.textContent));
    ok(spots.every((t) => /^\d+\.\d\d$/.test(t)), `every spot row prints to the cent, one way (${spots.join(", ")})`);
    const cellText = await page.$$eval("#sgScenM tbody td", (tds) => tds.map((t) => t.textContent));
    ok(cellText.every((t) => /^[+−]?\$\d{1,3}(,\d{3})*$/.test(t)), `and every cell in whole dollars with no abbreviation below $100,000 (${cellText.slice(0, 4).join(", ")}…)`);
  }

  {
    const cookie = { Cookie: "flows_session=" + token };
    await go("?t=BBB");
    const served = await (await fetch(server.baseURL + "/api/flows/strategy?t=BBB&expiry=" + NEAR + "&engine=1", { headers: cookie })).json();
    const e = served.engine;
    ok(e && e.status === "ok" && e.lawFrom === "card" && e.structures.length >= 2 && e.ideas.length >= 1,
       `with a card and its law published, the Worker prices and ranks ${e && e.structures.length} structures on BBB`);
    const idea = e.structures.find((s) => s.id === e.ideas[0]);
    const tile = await page.$eval(".tl-tile.is-on", (t) => t.dataset.family);
    eq(tile, idea.family, `the lab opens on the engine's first idea (${idea.family})`);
    const handles = await page.$$eval(".tl-handle", (hs) => hs.map((x) => Number(x.getAttribute("aria-valuenow"))).sort((a, b) => a - b));
    eq(JSON.stringify(handles), JSON.stringify(idea.legs.filter((l) => l.type !== "S").map((l) => l.k).sort((a, b) => a - b)),
       "with exactly the engine's legs, one draggable handle per strike");
    const fmt = (v) => (v === null ? "Unbounded" : (v < 0 ? MINUS : v > 0 ? "+" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: Math.abs(v) < 1000 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 0 }));
    eq((await slot("Max profit")).value, fmt(idea.maxProfit), "the page's maximum profit is the Worker's, to the cent");
    eq((await slot("Max loss")).value, fmt(idea.maxLoss), "and so is its maximum loss");
    const rp = await page.$eval('.tl-pop-r[data-law="p"] .tl-pop-v', (n) => (n.querySelector("[data-value]") || n).dataset.value || n.textContent);
    const rq = await page.$eval('.tl-pop-r[data-law="q"] .tl-pop-v', (n) => (n.querySelector("[data-value]") || n).dataset.value || n.textContent);
    const tenth = (v) => Math.round(v * 1000);
    eq(rp, (tenth(idea.prob.popP) / 10).toFixed(1) + "%", `the real-world chance of profit is the Worker's, under the card's law (${rp})`);
    eq(rq, (tenth(idea.prob.popQ) / 10).toFixed(1) + "%", `and the implied one too (${rq})`);
    const gapWant = tenth(idea.prob.popP) - tenth(idea.prob.popQ);
    const gap = await page.$eval('.tl-lp .tl-lp-v b', (b) => b.textContent);
    eq(gap, (gapWant < 0 ? MINUS : gapWant > 0 ? "+" : "") + (Math.abs(gapWant) / 10).toFixed(1),
       `the gap is printed as the difference of the two chances as printed, so a reader's subtraction agrees with it (${gap})`);
    const lp = await page.$eval(".tl-lp", (n) => ({ label: n.getAttribute("aria-label"), q: n.querySelector(".tl-lp-q") !== null, p: n.querySelector(".tl-lp-p") !== null, lo: n.querySelector(".tl-lp-e").textContent }));
    ok(lp.q && lp.p && /points of chance of profit/.test(lp.label) && /on a scale from \d+% to \d+%/.test(lp.label),
       `and it is drawn as two marks on a magnified scale whose ends are printed and spoken, so a gap of a point is visible rather than a hairline (${lp.label})`);

    const same = await page.evaluate(async (exp) => {
      const b = await (await fetch("/api/flows/strategy?t=BBB&expiry=" + exp + "&engine=1", { credentials: "same-origin" })).json();
      const en = b.engine;
      const Q = window.FlowsQuant;
      const setup = Q.labSetup({ asOfMs: en.asOfMs, spot: en.spot, facts: en.facts, state: en.state, pLaw: en.pLaw, levels: en.levels, event: en.event, stale: en.stale,
        books: [{ fit: en.fits[0], rows: Q.bookRows(b.calls, b.puts, "BBB") }] });
      return en.structures.map((s) => {
        const want = { ...s };
        delete want.id;
        const got = Q.priceStructure(setup, {
          family: s.family, expiry: s.expiry, dir: s.dir, rules: s.rules,
          legs: s.legs.map((l) => ({ type: l.type, K: l.k, side: l.side, qty: l.qty, expiry: l.expiry })),
          snapped: s.legs.filter((l) => l.snapped).map((l) => ({ K: l.k, rule: l.snapped })),
        }, { detail: !!s.grid });
        return JSON.stringify(got) === JSON.stringify(want);
      });
    }, NEAR);
    ok(same.length >= 2 && same.every(Boolean),
       `BYTE FOR BYTE: in the browser, the generated bundle re-prices all ${same.length} structures the Worker published — prices, greeks, both probabilities, both expected values, grades and grids — from the fit alone`);

    const h0 = page.locator(".tl-handle").first();
    const k0 = Number(await h0.getAttribute("aria-valuenow"));
    const before = (await slot("Max profit")).value;
    await h0.focus();
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction((k) => Number(document.querySelector(".tl-handle").getAttribute("aria-valuenow")) !== k, k0);
    const k1 = Number(await h0.getAttribute("aria-valuenow"));
    ok(k1 < k0, `the arrow key moves the strike to the next listed one down (${k0} → ${k1})`);
    const after = (await slot("Max profit")).value;
    ok(after !== before, `and everything re-prices in the page (max profit ${before} → ${after})`);
    const u = new URL(page.url());
    ok(u.searchParams.get("s") === idea.family && new RegExp("BBB261016[CP]" + String(Math.round(k1 * 1000)).padStart(8, "0")).test(u.searchParams.get("legs") || ""),
       "and the moved position is in the link, structure and contracts, so it survives a reload");

    await h0.scrollIntoViewIfNeeded();
    const box = await h0.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width / 2 - i * 6, box.y + box.height / 2);
    ok(await h0.evaluate((b) => b.classList.contains("is-drag")), "a pointer drag picks the handle up");
    await page.mouse.up();
    const k2 = Number(await h0.getAttribute("aria-valuenow"));
    ok(k2 < k1 && !(await h0.evaluate((b) => b.classList.contains("is-drag"))),
       `and drops it on a listed strike further down (${k1} → ${k2}), springing onto it`);
  }

  {
    await go("?t=AAA&expiry=2026-10-16&basis=mid&legs=AAA261016C00100000@1,AAA261016C00110000@-1");
    const legs = new URL(page.url()).searchParams.get("legs");
    eq(legs, "AAA261016C00100000@1,AAA261016C00110000@-1",
       "the position lives in the URL, one contract per entry with the SIGN carrying the side — a link is the only form of a position that can be sent to anyone");
    ok(!/4\.90|5\.10|500/.test(legs), "and it carries no PRICES: a quote is a fact about a moment");
    await page.click('#sgLegsM .tl-leg[data-leg="1"] .tl-bs');
    await page.waitForFunction(() => /C00110000@1/.test(new URL(location.href).searchParams.get("legs") || ""));
    eq(new URL(page.url()).searchParams.get("s"), "custom", "switching a leg's side makes the position custom and the link says so");
    await page.click('#sgLegsM .tl-leg[data-leg="0"] [aria-label^="One more"]');
    await page.waitForFunction(() => /C00100000@2/.test(new URL(location.href).searchParams.get("legs") || ""));
    ok(true, "and a second contract is a signed quantity in the link");
    const reload = page.url();
    await go(reload.slice(reload.indexOf("?")));
    eq((await slot("Cost")).value, "$1,200", "the restored link re-reads the book and prices the same position at today's quotes");
  }

  {
    await go("?t=AAA");
    await page.click(`.tl-chip[data-expiry="${FAR}"]`);
    await page.waitForFunction(() => document.querySelector(".tl-chip.is-on") && document.querySelector(".tl-chip.is-on").dataset.expiry === "2026-12-18");
    await ready();
    const note = await openInfo("About expiries");
    ok(/The call side of this expiry is CUT OFF/.test(note),
       "a truncated side is named as truncated: the reader's strike is simply not there and nothing else says a strike is missing");
    ok(/500 contracts/.test(note) && /reads 2 of them per side/.test(note),
       "and the disclosure states the vendor's page limit and how many pages this route reads");
    ok(!/Both sides/.test(note), "and it is PER SIDE: three puts came back complete");
    await closeInfo();
  }

  {
    await go("?t=AAA");
    await page.click(`.tl-chip[data-expiry="${BROKEN}"]`);
    await page.waitForSelector('#sgStatus[data-empty="unreadable"]', { timeout: 20000 });
    const broken = flat(await page.locator("#sgStatus").textContent());
    ok(/did not come back/.test(broken), "an expiry whose read failed says the REQUEST failed");
    ok(/not the same as/.test(broken) && /empty/.test(broken),
       `and says in words that this is not the same as the expiry being empty (${broken.slice(0, 140)}…)`);
    eq(await page.locator('#sgGrid .ui-silent[data-state="unavailable"]').count(), 1, "and the surface draws the unavailable glyph in its place, with the reason one tap away");

    await page.fill("#sgTicker", "ZZZ");
    await page.click(".sg-load");
    await page.waitForSelector('#sgStatus[data-empty="quiet"]', { timeout: 20000 });
    const quiet = flat(await page.locator("#sgStatus").textContent());
    ok(/lists no option expiries/.test(quiet) && /reading about the name/.test(quiet),
       `a symbol that was read and lists nothing is reported as a READING about the name (${quiet})`);
    eq(await page.locator('#sgGrid .ui-silent[data-state="quiet"]').count(), 1, "drawn with the quiet glyph, not the failure one");

    await page.fill("#sgTicker", "YYY");
    await page.click(".sg-load");
    await page.waitForSelector('#sgStatus[data-empty="unreadable"]', { timeout: 20000 });
    const dead = flat(await page.locator("#sgStatus").textContent());
    ok(/expiry list did not come back/.test(dead), "an expiry list that failed says the LIST failed");
    ok(/price above was read/.test(dead),
       `and distinguishes itself from a whole-symbol failure by naming what DID arrive (${dead})`);
    eq(flat(await page.locator("#sgPx .tl-spot").textContent()), "102.00", "the price stays, because a spot that was read is still a reading");
  }

  {
    await go("?t=AAA&expiry=2026-10-16&legs=AAA261016C00100000@1,AAA261016C00110000@-1");
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      eq(over, false, `the strategy lab overflows nothing at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    const edges = async (x) => page.$eval(".tl-stripw", (w, to) => new Promise((res) => {
      const s = w.firstChild;
      s.scrollLeft = to === "end" ? s.scrollWidth : 0;
      setTimeout(() => res({
        scrollable: s.scrollWidth > s.clientWidth + 2,
        left: getComputedStyle(w, "::before").opacity, right: getComputedStyle(w, "::after").opacity,
      }), 350);
    }), x);
    const start = await edges("start");
    ok(start.scrollable, "the structure strip scrolls inside its own box instead of the page");
    ok(Number(start.left) < 0.05 && Number(start.right) > 0.5,
       `at its start it fades only on the right, where structures are hidden (${start.left}/${start.right})`);
    const end = await edges("end");
    ok(Number(end.left) > 0.5 && Number(end.right) < 0.05,
       `and at its end only on the left (${end.left}/${end.right}) — an edge fade is honest only where content is hidden`);
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  eq(pageErrors.length, 0,
     `no uncaught browser error across every branch above (${pageErrors.join(" | ")})`);

  console.log(`✓ flows-strategy: ${checks} assertions — the payoff at expiry pinned against hand-computed values for a long ` +
    `call, a vertical, a naked short call that reports UNBOUNDED and a naked short put that reports a bounded number; ` +
    `a leg with no two-sided quote WITHHOLDING every figure it belongs to and named in the reason; the fill, mid and ` +
    `natural bases; the Worker's engine re-priced byte for byte in the browser; a strike moved by key and by drag; ` +
    `the refusals in the document; truncation per side; and the three silences kept in three sentences and three glyphs`);
} finally {
  await browser.close();
  await server.stop();
  await new Promise((r) => upstream.close(r));
}
