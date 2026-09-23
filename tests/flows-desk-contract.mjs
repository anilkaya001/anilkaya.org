import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { sizeToBuyingPower } from "../shared/flows-premium.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";
import * as WORLD from "../shared/flows-quant-world.js";
import * as QC from "../shared/flows-quant-card.js";
import * as ENG from "../shared/flows-quant-engine.js";
import * as QP from "../scripts/flows-quant-pipeline.mjs";
import { STATE_STRUCTURES } from "../shared/flows-neuron.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

let upstreamCalls = 0;
const callsByTicker = new Map();

const CHAINS = {
  AAA: {
    spot: 50,
    rows: [
      { option_symbol: "AAA260918P00047000", nbbo_bid: "1.90", nbbo_ask: "1.95",
        implied_volatility: "0.42", open_interest: "800", prev_oi: "700", volume: "120" },
      { option_symbol: "AAA260918C00055000", nbbo_bid: "0.60", nbbo_ask: "0.65",
        implied_volatility: "0.40", open_interest: "600", volume: "90" },

      { option_symbol: "AAA260918P00030000", nbbo_bid: "0", nbbo_ask: "0.20",
        implied_volatility: "0.80", open_interest: "400", volume: "5" },
    ],
  },
  BBB: {
    spot: 400,
    rows: [

      { option_symbol: "BBB260918P00380000", nbbo_bid: "6.00", nbbo_ask: "6.20",
        implied_volatility: "0.30", open_interest: "2000", prev_oi: "1500", volume: "0" },

      { option_symbol: "BBB260904P00300000", nbbo_bid: "0.05", nbbo_ask: "0.60",
        implied_volatility: "0.95", open_interest: "11", volume: "2" },
    ],
  },
};

const CCC_ROWS = [

  ["P00085000", 0.80, 0.85, 0.46, 150, 150],
  ["P00090000", 1.40, 1.48, 0.38, 220, 220],
  ["P00095000", 2.30, 2.40, 0.32, 400, 400],
  ["C00100000", 2.10, 2.20, 0.30, 900, 0],
  ["C00102000", 1.60, 1.68, 0.305, 700, 300],
  ["C00105000", 1.05, 1.10, 0.31, 500, 500],
  ["C00110000", 0.55, 0.60, 0.35, 300, 300],
  ["C00115000", 0.30, 0.34, 0.41, 120, 120],
].map(([tail, bid, ask, iv, oi, volume]) => ({ tail: "260918" + tail, bid, ask, iv, oi, volume }))
  .concat([

    ["P00078000", 0.65, 0.72, 0.44, 300, 300],
    ["P00095000", 2.90, 3.05, 0.33, 260, 0],
    ["C00100000", 3.10, 3.25, 0.28, 340, 0],
    ["C00110000", 1.05, 1.15, 0.31, 180, 0],
  ].map(([tail, bid, ask, iv, oi, volume]) => ({ tail: "261016" + tail, bid, ask, iv, oi, volume })))
  .concat([

    ["P00080000", 1.50, 1.62, 0.40, 190, 90],
    ["P00090000", 3.20, 3.35, 0.34, 140, 140],
    ["C00100000", 5.10, 5.30, 0.24, 260, 260],
    ["C00110000", 2.05, 2.18, 0.23, 110, 110],
    ["C00120000", 1.10, 1.20, 0.32, 170, 70],
  ].map(([tail, bid, ask, iv, oi, volume]) => ({ tail: "261218" + tail, bid, ask, iv, oi, volume })));

const ccRow = (ticker, r, ivScale) => ({
  option_symbol: ticker + r.tail,
  nbbo_bid: String(r.bid), nbbo_ask: String(r.ask),
  implied_volatility: String(r.iv * ivScale),
  open_interest: String(r.oi), volume: String(r.volume),
});

CHAINS.CCC = { spot: 100, rows: CCC_ROWS.map((r) => ccRow("CCC", r, 1)) };
CHAINS.DDD = { spot: 100, rows: CCC_ROWS.map((r) => ccRow("DDD", r, 100)) };

CHAINS.FFF = {
  spot: 1000,
  rows: [
    ...Array.from({ length: 120 }, (_, i) => ({
      option_symbol: "FFF260918P" + String((20 + i) * 1000).padStart(8, "0"),
      nbbo_bid: "0.60", nbbo_ask: "0.62", implied_volatility: "0.35",
      open_interest: "200", volume: "100",
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      option_symbol: "FFF260918P" + String((2000 + i) * 1000).padStart(8, "0"),
      nbbo_bid: "5.00", nbbo_ask: "5.10", implied_volatility: "0.35",
      open_interest: "500", volume: "100",
    })),
  ],
};

CHAINS.GGG = {
  spot: CHAINS.AAA.spot,
  rows: CHAINS.AAA.rows.map((r) => ({
    ...r, option_symbol: r.option_symbol.replace(/^AAA/, "GGG"),
  })),
};

const upstream = http.createServer((req, res) => {
  upstreamCalls++;
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/\/api\/stock\/([^/]+)\//);
  const ticker = m ? decodeURIComponent(m[1]).toUpperCase() : "";
  callsByTicker.set(ticker, (callsByTicker.get(ticker) || 0) + 1);
  const chain = CHAINS[ticker];
  res.setHeader("Content-Type", "application/json");
  if (!chain) { res.writeHead(404); res.end("{}"); return; }
  if (url.pathname.endsWith("/option-contracts")) {
    res.writeHead(200); res.end(JSON.stringify({ data: chain.rows })); return;
  }
  if (url.pathname.endsWith("/info")) {

    const dates = { AAA: "2026-09-10", CCC: "2026-11-05", DDD: "2026-11-05" };
    if (!dates[ticker]) { res.writeHead(404); res.end("{}"); return; }
    res.writeHead(200);
    res.end(JSON.stringify({ data: {
      next_earnings_date: dates[ticker], announce_time: "premarket",
      issue_type: "Common Stock" } }));
    return;
  }
  if (url.pathname.endsWith("/stock-state")) {

    if (ticker !== "AAA") { res.writeHead(404); res.end("{}"); return; }
    res.writeHead(200);
    res.end(JSON.stringify({
      close: String(chain.spot * 1.02), prev_close: String(chain.spot),
      open: String(chain.spot), high: String(chain.spot * 1.03), low: String(chain.spot * 0.99),
      market_time: "regular", tape_time: "2026-08-25 18:06:00+00:00",
      total_volume: 1000000, volume: 5000,
    }));
    return;
  }
  if (url.pathname.includes("/ohlc/")) {
    res.writeHead(200);
    res.end(JSON.stringify({ data: [
      { date: "2026-08-20", close: String(chain.spot * 0.9) },
      { date: "2026-08-24", close: String(chain.spot) },
    ] }));
    return;
  }
  res.writeHead(404); res.end("{}");
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamURL = `http://127.0.0.1:${upstream.address().port}`;

const INGEST = "desk-ingest-token";
const server = await startWorker({
  extraVars: ["UW_API_KEY:test-uw-key", `UW_BASE:${upstreamURL}`, `FLOWS_INGEST_TOKEN:${INGEST}`],
});

const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);

const MINUS = "−";
const DASH = "—";
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

{
  const GARCH = { status: "ok", omega: 0.045, alpha: 0.05, beta: 0.9, nu: 7, lambda: -0.1, avg21Vol: 40, nextVol: 42,
    sigma2Next: Math.pow(0.42, 2) / 252, persistence: 0.95, grade: 3, why: [], converged: true };
  const closes = (() => { const c = [50]; const rng = WORLD.xoshiro128ss("aaa"); for (let i = 0; i < 260; i++) c.push(c[c.length - 1] * Math.exp(0.025 * WORLD.normalDraw(rng))); return c; })();
  const pLaw = QC.compactLaw(QP.garchLaw({ garch: GARCH, ticker: "AAA", sessionDate: "2026-08-25", closes, rate: 0.04, paths: 2048 }));
  const card = {
    ticker: "AAA", sessionDate: "2026-08-25", generatedAt: new Date().toISOString(), panels: {},
    engine: {
      v: 1, engine: "q1", asOf: "2026-08-25", spot: 51, atr: 1.2, rate: { r: 0.04, method: "constant", n: 0 },
      facts: [], state: { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich },
      levels: { callWall: 55, putWall: 47, magnet: 50, flip: 49, maxPain: 50, atr: 1.2 }, event: null, pLaw,
      structures: [], ideas: [], noTrade: null,
    },
  };
  const put = await fetch(server.baseURL + "/api/flows/ingest?key=card%3AAAA", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST }, body: JSON.stringify(card),
  });
  ok(put.ok, `a card with an engine block and a GARCH law is published for AAA, and for no other symbol (${put.status})`);
}

const recipe = (Q, p, r) => {
  const isNum = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const eng = p.engine && p.engine.status === "ok" ? p.engine : null;
  const tape = p.tapeTime ? Date.parse(String(p.tapeTime).replace(" ", "T")) : NaN;
  const asOfMs = Number.isFinite(tape) ? tape : Date.parse(p.asOf + "T20:00:00Z");
  const type = r.type === "P" ? "P" : "C";
  const row = { K: r.strike, type, bid: isNum(r.bid), ask: isNum(r.ask), oi: isNum(r.oi), volume: isNum(r.volume), sym: r.symbol, ivSeed: isNum(r.iv) };
  const fit = Q.contractFit({ expiry: r.expiry, asOfMs, spot: p.spot, rate: eng && eng.rate ? eng.rate.r : null, row });
  if (!fit) return null;
  const setup = Q.labSetup({ asOfMs, spot: p.spot, facts: eng ? eng.facts : [], state: eng ? eng.state : null, pLaw: eng ? eng.pLaw : null, event: eng ? eng.event : null, stale: eng ? eng.stale : false, books: [{ fit, rows: [row] }] });
  const legs = r.strategy === "cc" ? [{ type: "S", side: 1, qty: 1 }, { type: "C", K: r.strike, side: -1, qty: 1 }] : [{ type: "P", K: r.strike, side: -1, qty: 1 }];
  return Q.priceStructure(setup, { family: r.strategy === "cc" ? "covered-call" : "short-put", expiry: r.expiry, legs, basis: "natural" });
};
const NODE_Q = { contractFit: QC.contractFit, labSetup: QC.labSetup, priceStructure: ENG.priceStructure };
const pct0 = (v) => (v === null || v === undefined ? DASH : (v < 0 ? MINUS : "") + (Math.abs(v) * 100).toFixed(0) + "%");
const usd = (v) => (v === null || v === undefined ? DASH : (v < 0 ? MINUS : v > 0 ? "+" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US"));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.addCookies([{
    name: "flows_session", value: token,
    domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax",
  }]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const ROWS = "#dkList .dk-row";
  const rowCount = (pg = page) => pg.locator(ROWS).count();
  const settle = (want, pg = page) => pg.waitForFunction(
    (n) => document.querySelectorAll("#dkList .dk-row").length >= n, want, { timeout: 15000 });
  const tickers = (pg = page) => pg.$$eval(ROWS, (rs) => rs.map((r) => r.dataset.t));
  const strikesOf = (pg = page) => pg.$$eval(ROWS, (rs) => rs.map((r) => Number(r.dataset.strike)));
  const popText = async (pg = page) => flat(await pg.locator("#fxPop").textContent());
  const openInfo = async (loc, pg = page) => {
    await loc.click();
    await pg.waitForSelector("#fxPop:popover-open");
    return popText(pg);
  };
  const closeInfo = async (pg = page) => {
    await pg.keyboard.press("Escape");
    await pg.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" });
  };
  const factsOf = (pg = page) => pg.$$eval("#fxPop dt", (dts) =>
    Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
  const rowInfo = async (sel) => {
    const text = await openInfo(page.locator(sel + " .ui-info").first());
    const facts = await factsOf();
    await closeInfo();
    return { text, facts };
  };
  const statusText = async (pg = page) => flat(await pg.locator("#deskStatus").textContent());
  const statusShown = (pg = page) => pg.$eval("#deskStatus", (n) => !n.classList.contains("visually-hidden"));

  {
    await page.goto(server.baseURL + "/flows/desk/", { waitUntil: "domcontentloaded" });
    eq(await page.locator("#dkList").count(), 1, "the list of lines is present");
    eq(await page.locator("#dkLinesM").isHidden(), true, "and hidden before a symbol is added — no empty table shell");
    ok(/Add a symbol/.test(await statusText()), "and the status invites one");
    eq(await page.locator("#deskAll").isDisabled(), true, "select-all is disabled with nothing to select");
    eq(await page.locator("#deskBP").count(), 1,
       "the buying-power field is there before any symbol, so a balance can be set first");
    const frontier = await page.locator("#dkScatter .ui-silent").getAttribute("aria-label");
    ok(/Frontier/.test(frontier || ""), `the frontier says it is empty in the silence vocabulary rather than drawing empty axes (${frontier})`);
    eq(upstreamCalls, 0, "an empty desk spends no vendor call");
  }

  {
    await page.fill("#deskInput", "aaa");
    await page.click(".desk-add");
    await settle(1);
    ok(await rowCount() >= 1, "typing a symbol prices it");
    eq((await page.locator(".desk-chip__sym").first().textContent()).trim(), "AAA",
       "lowercase input is normalised to a ticker");

    const foot = await page.locator("#deskFoot").textContent();
    ok(/of 3 quoted contracts/.test(foot), `the screened total is the vendor's, not the survivors' (${foot})`);
    ok(/first gate it failed/.test(foot), "and the counts are declared a partition");

    ok((await tickers()).every((s) => s === "AAA"), "only the added symbol is priced");
    ok(!(await strikesOf()).includes(30),
       "the zero-bid contract is absent — no bid is no sale, not a cheap one");

    const lines = await openInfo(page.locator('#dkLinesM [aria-label="About lines"]'));
    ok(/of 3 quoted contracts/.test(lines) && /first gate it failed/.test(lines),
       "and the same partition is one tap away in the Lines disclosure, where a sighted reader finds it");
    await closeInfo();
  }

  {
    const shape = await page.evaluate(() => {
      const head = document.querySelector("#dkList .dk-head");
      const cols = head ? head.children.length : 0;
      return {
        cols,
        rows: Array.from(document.querySelectorAll("#dkList .dk-row")).map((r) =>
          r.querySelectorAll(":scope > .ui-badge, :scope > .dk-main, :scope > .dk-cells > .dk-c, :scope > .ui-info").length),
      };
    });
    ok(shape.cols > 0 && shape.rows.length > 0, "there is a list with a header to check");
    for (const w of shape.rows) {
      eq(w, shape.cols, `every row has exactly one cell per header column (${w} cells, ${shape.cols} columns)`);
    }
  }

  {
    const note = await page.locator(".desk-chip__note").first().textContent();
    ok(/\$51\.00/.test(note), `AAA is priced against the live print, not its 50.00 close (${note})`);
    ok(!/close/.test(note), "and a live print is not labelled a close");
    eq(await page.locator(".desk-chip .dk-chip-t").first().getAttribute("title"), note,
       "the chip carries the same note where a pointer reads it");
    ok(/regular session/.test(await statusText()), "the vendor's session name reaches the status line");
    eq(await statusShown(), false, "which stays off the surface while there is nothing to warn about");
  }

  {
    const u = new URL(page.url());
    eq(u.searchParams.get("t"), "AAA", "the watchlist is in the URL, not in browser storage");
    ok(u.searchParams.get("rank"), "and so is the ranking key");
  }

  {
    const before = upstreamCalls;
    await page.fill("#deskInput", "BBB");
    await page.click(".desk-add");
    await settle(3);
    ok(upstreamCalls > before, "the new symbol costs its own vendor call");

    const syms = await tickers();
    ok(syms.includes("AAA") && syms.includes("BBB"), "both symbols are in one list");

    const notes = await page.locator(".desk-chip__note").allTextContents();
    ok(/close/.test(notes[1] || ""), `BBB is marked as priced off the last close (${notes[1]})`);
    ok(/BBB priced off the last close/.test(await statusText()),
       "and the status names it rather than averaging the two states away");
    eq(await statusShown(), true,
       "and that status is ON the surface now — a price that is not a live print is a warning, not a footnote");

    assert.deepEqual(syms, ["AAA", "BBB", "AAA"],
      "the merged list is re-ranked across symbols, not concatenated"); checks++;
  }

  {
    const cc = await rowInfo('#dkList .dk-row[data-strategy="cc"]');
    ok(/%/.test(cc.facts["If called"] || ""), `a covered call states its called-away return (${cc.facts["If called"]})`);
    ok(/run/.test(cc.facts["If called"] || ""), "and how far the market must run to get there");
    const csp = await rowInfo('#dkList .dk-row[data-strategy="csp"]');
    ok((csp.facts["If called"] || "").startsWith(DASH), "a put shows a dash — it has no upside cap");
    ok(/no upside cap/.test(csp.facts["If called"] || ""),
       "and the dash SAYS it is an absence, not missing data");
  }

  {
    const marked = page.locator("#dkList .dk-earn:not(.is-unknown)");
    ok(await marked.count() >= 1, "a contract outliving the report is marked");
    eq(await marked.first().locator("svg").count(), 1,
       "the marker is a glyph shape, so it survives a greyscale render");
    const label = await marked.first().getAttribute("aria-label");
    ok(label && /diffusion number priced against a jump/.test(label),
       `and says why the cushion is weaker there (${(label || "").slice(0, 60)})`);

    const unknown = page.locator("#dkList .dk-earn.is-unknown");
    ok(await unknown.count() >= 1,
       "a symbol with no earnings information is marked as UNDETERMINED, not clean");
    const uLabel = await unknown.first().getAttribute("aria-label");
    ok(uLabel && /could not be\s+determined/.test(uLabel),
       `and says so rather than implying safety (${(uLabel || "").slice(0, 60)})`);

    const status = await statusText();
    ok(/AAA reports 09-10/.test(status), `the status names the report date (${status})`);
    ok(/BBB has no known earnings date/.test(status), "and says which symbol it could not date");
  }

  {
    const stale = page.locator("#dkList .dk-row[data-stale-iv]");
    ok(await stale.count() >= 1, "a contract that has not traded today is flagged on its row");
    const info = await rowInfo("#dkList .dk-row[data-stale-iv]");
    ok(/not traded today/.test(info.facts.Cushion || ""), `and its cushion says why (${info.facts.Cushion})`);
    ok(!(info.facts.Cushion || "").startsWith(DASH),
       "the cushion is MARKED, not withheld — it is still the best reading available");
    ok(await stale.count() < await rowCount(), "contracts that traded today are not flagged");
  }

  {
    const before = upstreamCalls;
    await page.selectOption("#deskRank", "premium");
    await page.waitForFunction(() => (document.querySelector("#dkList .dk-row") || {}).dataset?.t === "BBB",
      null, { timeout: 8000 });
    eq((await tickers())[0], "BBB", "by premium dollars the expensive underlying leads — a different answer");
    eq(upstreamCalls, before, "re-sorting rows already in hand spends no vendor call");
    eq(new URL(page.url()).searchParams.get("rank"), "premium", "and the key is in the URL");
    await page.selectOption("#deskRank", "annualized");
  }

  {
    eq(await page.locator("#deskAll").isDisabled(), false, "select-all enables once there is a list");
    eq(await page.locator("#deskAll").isChecked(), true, "added symbols start selected");

    await page.uncheck("#deskAll");
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length === 0, null, { timeout: 8000 });
    eq(await rowCount(), 0, "deselecting everything empties the list");
    ok(/Select a symbol/.test(await statusText()), "and the status says why it is empty rather than looking broken");
    const silence = await page.locator("#dkList .ui-silent").getAttribute("aria-label");
    ok(/Lines/.test(silence || ""), "and so does the list itself, in the silence vocabulary");

    await page.check("#deskAll");
    await settle(3);
    ok(await rowCount() >= 3, "select-all brings them back");
  }

  {
    await page.locator(".desk-chip .dk-chip-t").first().click();
    const state = await page.evaluate(() => {
      const b = document.getElementById("deskAll");
      return { checked: b.checked, indeterminate: b.indeterminate };
    });
    eq(state.indeterminate, true, "a half-selected list shows indeterminate rather than claiming either extreme");
    eq(state.checked, false, "and is not reported as all-selected");
    eq(await page.locator(".desk-chip .dk-chip-t").first().getAttribute("aria-pressed"), "false",
       "and the chip that was switched off says so to a screen reader");
    await page.locator(".desk-chip .dk-chip-t").first().click();
  }

  {
    await settle(3);
    const before = upstreamCalls;
    await page.click("#deskRefresh");
    await page.waitForTimeout(1500);
    eq(upstreamCalls, before, "a refresh moments after a fetch is served from the edge and spends nothing");
    const chipNotes = (await page.locator(".desk-chip__note").allTextContents()).join(" ");
    ok(/sellable/.test(chipNotes), "each chip still reports what it holds");
  }

  {
    await page.fill("#deskInput", "ZZZ");
    await page.click(".desk-add");
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".desk-chip"))
      .some((c) => c.className.includes("is-error")), null, { timeout: 10000 });
    const errChip = page.locator(".desk-chip.is-error").first();
    ok((await errChip.textContent()).includes("ZZZ"), "the failing symbol is named");
    ok(await rowCount() >= 3, "and the symbols that DID price stay on the list — one bad ticker is not a dead page");
    const status = await statusText();
    ok(/ZZZ/.test(status) && /unavailable/.test(status), `the status reports the partial failure (${status})`);
    eq(await statusShown(), true, "on the surface, where a failure belongs");
  }

  {
    const before = upstreamCalls;
    await page.fill("#deskInput", "!!!");
    await page.click(".desk-add");
    await page.waitForTimeout(600);
    eq(upstreamCalls, before, "an unparseable symbol costs no vendor call");
    ok(/not a symbol/.test(await statusText()), "and says so rather than failing silently");
    eq(await statusShown(), true, "visibly");
  }

  {
    await page.click("#deskClear");
    await page.waitForFunction(() => document.querySelectorAll(".desk-chip").length === 0, null, { timeout: 8000 });
    eq(await page.locator("#dkLinesM").isHidden(), true, "clearing hides the list");
    eq(new URL(page.url()).searchParams.get("t"), null, "and empties the watchlist in the URL");
  }

  {
    await page.goto(server.baseURL + "/flows/desk/?t=AAA,BBB&rank=premium&strategy=csp", { waitUntil: "domcontentloaded" });
    await settle(1);
    const syms = (await page.locator(".desk-chip__sym").allTextContents()).map((s) => s.trim());
    assert.deepEqual(syms, ["AAA", "BBB"], "a shared URL restores the whole watchlist"); checks++;
    eq(await page.locator("#deskRank").inputValue(), "premium", "and the ranking key");
    eq(flat(await page.locator('#deskStrategy [aria-selected="true"]').textContent()), "Puts", "and the side being sold");
    const sides = await page.$$eval(ROWS, (rs) => rs.map((r) => r.dataset.strategy));
    ok(sides.length > 0 && sides.every((s) => s === "csp"), "a puts-only desk shows only puts");
  }

  {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length > 0, null, { timeout: 8000 });
    const wide = await page.evaluate(() => {
      const list = document.getElementById("dkList");
      const head = Array.from(document.querySelectorAll("#dkList .dk-head > span"));
      return {
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        listScrolls: list.scrollWidth > list.clientWidth + 1,
        headShown: head.length > 0 && getComputedStyle(head[0].parentElement).display !== "none",
        minHeadW: Math.min(...head.slice(1, -1).map((h) => Math.round(h.getBoundingClientRect().width))),
      };
    });
    eq(wide.pageOverflow, false, "the desk overflows nothing at 1440px");
    ok(wide.headShown, "at desk width the lines read as a table, under one header row");
    ok(wide.minHeadW >= 24, `no column is crushed to an unreadable sliver (${wide.minHeadW}px)`);
    eq(wide.listScrolls, false, "and every column fits without a horizontal scroller");
  }

  {
    const BP = 10000;
    await page.goto(server.baseURL + "/flows/desk/?t=AAA,BBB&strategy=both&rank=annualized", { waitUntil: "domcontentloaded" });
    await settle(3);

    const chainOf = async (symbol) => {
      const r = await fetch(`${server.baseURL}/api/flows/chain?t=${symbol}&strategy=both&rank=yieldOnCollateral`,
        { headers: { Cookie: `flows_session=${token}`, Accept: "application/json" } });
      ok(r.ok, `the chain route answers for ${symbol} (${r.status})`);
      return r.json();
    };
    const expected = new Map();
    for (const symbol of ["AAA", "BBB"]) {
      const payload = await chainOf(symbol);
      for (const row of payload.rows || []) expected.set(`${row.ticker}|${row.strike}|${row.strategy}`, sizeToBuyingPower(row, BP));
    }
    ok(expected.size >= 3, `the fixture priced enough lines to size (${expected.size})`);

    eq(await page.locator("#dkList .dk-col").count(), 0, "no Collect column before a buying power is entered");
    eq(await page.locator("#deskPlan").isHidden(), true, "and no plan");

    const chainRequests = [];
    page.on("request", (req) => { if (req.url().includes("/api/flows/chain")) chainRequests.push(req.url()); });

    const callsBefore = upstreamCalls;
    await page.fill("#deskBP", "10,000");
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-col").length > 0, null, { timeout: 5000 });
    eq(upstreamCalls, callsBefore, "sizing to a balance spends no vendor call — it is arithmetic on rows already here");
    eq(chainRequests.length, 0, "and issues no request at all");
    ok(await page.locator("#dkList .dk-head").evaluate((n) => /Collect/.test(n.textContent)), "the Collect column is drawn");

    const rows = await page.$$eval(ROWS, (rs) => rs.map((r) => {
      const c = r.querySelector(".dk-col");
      return { ticker: r.dataset.t, strike: Number(r.dataset.strike), strategy: r.dataset.strategy,
        text: c ? c.lastChild.textContent.trim() : null, title: c ? c.title : null,
        unaffordable: c ? c.classList.contains("is-unaffordable") : false };
    }));
    for (const r of rows) {
      const want = expected.get(`${r.ticker}|${r.strike}|${r.strategy}`);
      ok(want !== undefined, `the browser row ${r.ticker} ${r.strike} came from the Worker's payload`);
      r.want = want;
      if (!want.affordable) {
        eq(r.text, "$0", `${r.ticker} ${r.strike} collects nothing at $${BP}`);
        ok(r.unaffordable, "and the cell is marked as a verdict rather than a figure");
        ok(r.title && /more than/.test(r.title), `and says by how much it misses (${r.title})`);
      } else {
        const dollars = "$" + Math.round(want.collectible).toLocaleString("en-US");
        eq(r.text, `${dollars} (${want.contracts}×)`, `${r.ticker} ${r.strike} collects what sizeToBuyingPower() says it does`);
        ok(r.title && r.title.includes("$" + Math.round(want.deployed).toLocaleString("en-US")), "and the title names the capital it deploys");
        ok(r.title && r.title.includes("$" + Math.round(want.idle).toLocaleString("en-US")),
           "and what it leaves idle — the number a yield percentage hides");
      }
    }
    ok(rows.some((r) => !r.want.affordable), "the fixture contains an unaffordable line");
    ok(rows.some((r) => r.want.affordable && r.want.contracts > 1), "and one the account can buy more than once");

    const plan = await page.locator("#deskPlan").getAttribute("data-plan");
    ok(/\$10,000 buying power/.test(plan), `the plan states the balance (${plan})`);
    ok(/best single deployment: 2× AAA 47\.00 cash-secured put/.test(plan), `and names the best line, not the highest yield (${plan})`);
    ok(/collects \$380/.test(plan), "with what it collects");
    ok(/leaving \$600 idle/.test(plan), "and the idle cash, which is the cost integer division imposes");
    const planInfo = await openInfo(page.locator('#deskPlan [aria-label="About the best deployment"]'));
    ok(planInfo.includes("best single deployment: 2× AAA 47.00 cash-secured put"), "the whole sentence is one tap away on the plan");
    await closeInfo();
    eq(flat(await page.locator("#deskPlan .dk-plan-v b").textContent()), "2× AAA 47 put", "and the plan's headline is the line itself");
    ok(/Deploys \$9,400 of \$10,000, \$600 idle/.test(await page.locator("#deskPlan .ui-split").getAttribute("aria-label")),
       "the deployed-and-idle bar carries the same two numbers in words");

    {
      const dollars = (s) => Number(String(s).replace(/[^0-9.]/g, ""));
      const best = dollars(await page.locator("#deskPlan .ui-metric").first().locator(".ui-metric-v").textContent());
      const alts = (await page.$$eval("#dkSizingM .dk-alt b", (bs) => bs.map((b) => b.textContent))).map(dollars);
      const affordable = rows.filter((r) => r.want.affordable).map((r) => Math.round(r.want.collectible)).sort((a, b) => b - a);
      eq(best, affordable[0], "the best deployment's collect is the largest any affordable line collects");
      assert.deepEqual(alts, affordable.slice(1, 3), "and the next two are the runners-up in order, so the plan is a ranking and not a single pick"); checks++;
    }

    assert.deepEqual(await tickers(), ["AAA", "BBB", "AAA"], "before the switch the list is ranked by the default key"); checks++;
    await page.selectOption("#deskRank", "collectible");
    await page.waitForFunction(() => {
      const t = Array.from(document.querySelectorAll("#dkList .dk-row")).map((r) => r.dataset.t);
      return t.length === 3 && t[1] === "AAA";
    }, null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await tickers(), ["AAA", "AAA", "BBB"], "ranking by premium collectible sinks the line this account cannot buy"); checks++;
    eq(upstreamCalls, callsBefore, "and re-ranking still spends no vendor call");

    {
      chainRequests.length = 0;
      await page.click("#deskRefresh");
      await page.waitForTimeout(500);
      ok(chainRequests.length > 0, "Refresh does go back to the route");
      for (const url of chainRequests) {
        const rank = new URL(url).searchParams.get("rank");
        eq(rank, "yieldOnCollateral", `a collectible ranking asks the API for its proxy, not for a key it lacks (${rank})`);
      }
    }

    {
      eq(new URL(page.url()).searchParams.get("bp"), "10000", "the balance is held in the URL like the rest of the desk");
      const help = await openInfo(page.locator('#dkSizingM [aria-label="About sizing"]'));
      ok(/link you share carries it too/.test(help),
         "and the page says so, because an account size in a shared link is not a surprise anyone should get");
      await closeInfo();
    }

    {
      await page.fill("#deskBP", "25.000.00");
      await page.waitForFunction(() => document.getElementById("deskBP").getAttribute("aria-invalid") === "true", null, { timeout: 3000 });
      eq(await page.locator("#dkList .dk-col").count(), 0, "an unparseable balance sizes nothing");
      ok(await page.locator("#deskBP").evaluate((el) => el.classList.contains("is-invalid")),
         "and the field says it is the input that is wrong, not the desk");
      eq(await page.locator("#deskRank").inputValue(), "annualized", "and the collectible ranking falls back rather than sorting by nothing");

      await page.fill("#deskBP", "25k");
      await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-col").length > 0, null, { timeout: 3000 });
      eq(new URL(page.url()).searchParams.get("bp"), "25000", "shorthand is accepted and normalised — 25k is a balance a person types");
    }
  }

  {
    const got = [];
    const probe = await context.newPage();
    probe.on("pageerror", (e) => pageErrors.push(String(e)));
    probe.on("response", async (res) => {
      if (!res.url().includes("/api/flows/chain")) return;
      try { got.push(await res.json()); } catch { return; }
    });
    await probe.setViewportSize({ width: 1440, height: 1000 });
    await probe.goto(server.baseURL + "/flows/desk/?t=AAA,BBB&strategy=both&rank=annualized", { waitUntil: "domcontentloaded" });
    await settle(3, probe);
    await probe.waitForFunction(() => !!document.querySelector("#dkScatter svg"), null, { timeout: 10000 });
    const aaa = got.find((p) => p && p.ticker === "AAA");
    const bbb = got.find((p) => p && p.ticker === "BBB");
    ok(aaa && bbb, "the test holds the exact payloads the page priced");
    eq(aaa.engine && aaa.engine.status, "ok", "AAA's payload carries its card's engine block, law included");
    ok(aaa.engine.pLaw && Array.isArray(aaa.engine.pLaw.knots), "with the real-world law the card publishes");
    eq(bbb.engine && bbb.engine.status, "unavailable", "BBB has no card, and its payload says so rather than inventing a law");

    for (const p of [aaa, bbb]) {
      for (const r of p.rows) {
        const node = recipe(NODE_Q, p, r);
        const inPage = await probe.evaluate(({ src, p, r }) => {
          const fn = new Function("return " + src)();
          return JSON.stringify(fn(window.FlowsQuant, p, r));
        }, { src: recipe.toString(), p, r });
        eq(inPage, JSON.stringify(node),
           `${r.ticker} ${r.strike} ${r.strategy}: the page's engine prices this line to the byte the server module does`);
        ok(node && node.prob && Number.isFinite(node.prob.popQ), `and it is a priced line (${r.ticker} ${r.strike})`);
        const cells = await probe.$eval(`#dkList .dk-row[data-t="${r.ticker}"][data-strike="${r.strike}"][data-strategy="${r.strategy}"]`, (n) => ({
          pq: n.querySelector(".dk-pq").lastChild.textContent, pp: n.querySelector(".dk-pp").lastChild.textContent, ev: n.querySelector(".dk-ev").lastChild.textContent,
        }));
        eq(cells.pq, pct0(node.prob.popQ), `the Implied cell is the engine's risk-neutral chance of profit (${cells.pq})`);
        eq(cells.pp, pct0(node.prob.popP), `the Real world cell is the engine's chance under the card's law (${cells.pp})`);
        eq(cells.ev, usd(node.ev.p), `the EV cell is the engine's real-world expected value (${cells.ev})`);
        if (p === bbb) {
          eq(node.prob.popP, null, "BBB has no real-world law, so the engine publishes no real-world chance");
          eq(cells.pp, DASH, "and the cell is an em dash, not a number borrowed from the implied side");
        } else {
          ok(node.prob.popP !== null, "AAA's real-world chance is priced under its card's GARCH law");
        }
      }
    }

    const bInfo = await probe.locator('#dkList .dk-row[data-t="BBB"] .ui-info').first();
    await bInfo.click();
    await probe.waitForSelector("#fxPop:popover-open");
    const bText = await popText(probe);
    ok(/No real-world figure: no card is published for BBB/.test(bText),
       `the line says why its real-world figures are absent (${bText.slice(0, 80)}…)`);
    ok(/same engine as the strategy lab/.test(bText) && /flat slice/.test(bText) && /skew correction is not in this number/.test(bText),
       "and every line's disclosure names its engine and the approximation it makes");
    await probe.keyboard.press("Escape");

    const lab = await probe.locator('#dkList .dk-row[data-t="AAA"][data-strategy="csp"] .dk-k').first().getAttribute("href");
    ok(/^\/flows\/strategy\/\?t=AAA&s=short-put&expiry=2026-09-18&basis=natural&legs=AAA260918P00047000%40-1$/.test(lab),
       `each line opens in the strategy lab as the same structure on the same fill basis (${lab})`);

    {
      const chart = await probe.evaluate(() => {
        const svg = document.querySelector("#dkScatter svg");
        const marks = svg.querySelectorAll("g circle, g rect, g path").length;
        return { label: svg.getAttribute("aria-label"), front: svg.querySelectorAll(".dk-front").length, marks };
      });
      ok(/Annualised yield against delta for 3 lines/.test(chart.label), `the frontier is a chart of every priced line, with a text alternative (${chart.label})`);
      ok(chart.marks >= 3, "one mark per line");
      await probe.locator("#dkFrontierM .ui-seg-i", { hasText: "Chance" }).click();
      await probe.waitForFunction(() => /implied chance of profit/.test(document.querySelector("#dkScatter svg")?.getAttribute("aria-label") || ""), null, { timeout: 5000 }).catch(() => {});
      ok(/Annualised yield against the implied chance of profit/.test(await probe.locator("#dkScatter svg").getAttribute("aria-label")),
         "and the risk axis switches from delta to the implied chance of profit");
      await probe.locator("#dkScatter .tl-scrub").focus();
      await probe.keyboard.press("ArrowRight");
      ok(await probe.locator("#dkScatter .ui-readout.is-on").count() === 1, "the frontier is walked from the keyboard, point by point");
    }

    {
      await probe.locator("#dkTenor .ui-seg-i", { hasText: "2–6w" }).click();
      await probe.waitForFunction(() => document.querySelector('#dkTenor [aria-selected="true"]')?.textContent === "2–6w", null, { timeout: 5000 });
      await probe.waitForTimeout(400);
      const inside = await probe.$$eval("#dkList .dk-row", (rs) => rs.map((r) => Number(r.dataset.days)));
      ok(inside.length > 0 && inside.every((d) => d >= 15 && d <= 45), `the tenor filter keeps the lines inside its window (${inside.join(",")})`);
      await probe.locator("#dkTenor .ui-seg-i", { hasText: "> 6w" }).click();
      await probe.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length === 0, null, { timeout: 5000 }).catch(() => {});
      eq(await probe.locator("#dkList .dk-row").count(), 0, "and drops every line outside it");
      await probe.locator("#dkList .ui-silent [data-info]").click();
      await probe.waitForSelector("#fxPop:popover-open");
      ok(/No line on the desk expires inside this window/.test(await popText(probe)), "and says the window is empty rather than showing an empty list");
      await probe.keyboard.press("Escape");
      await probe.locator("#dkTenor .ui-seg-i", { hasText: "All" }).click();
    }
    await probe.close();
  }

  {
    await page.goto(server.baseURL + "/flows/desk/?t=AAA,BBB&strategy=both&rank=annualized&bp=10000", { waitUntil: "domcontentloaded" });
    await settle(3);
    const sticky = await page.evaluate(() => {
      const head = document.querySelector("#dkList .dk-head");
      const cs = getComputedStyle(head);
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 56;
      return { position: cs.position, top: parseFloat(cs.top), bar, bg: cs.backgroundColor };
    });
    eq(sticky.position, "sticky", "the column header is pinned while the rows scroll under it");
    ok(sticky.top >= sticky.bar, `below the fixed top bar rather than underneath it (${sticky.top}px)`);
    ok(!/, 0\)$/.test(sticky.bg) && sticky.bg !== "transparent", `with a ground the rows cannot show through (${sticky.bg})`);
    await page.setViewportSize({ width: 1440, height: 560 });
    await page.waitForFunction(() => !!document.querySelector("#deskSurface .ivs"), null, { timeout: 10000 });
    const stuck = await page.evaluate(async () => {
      await Promise.all(document.getElementById("dkLinesM").getAnimations().map((a) => a.finished.catch(() => null)));
      const list = document.getElementById("dkList");
      const bar = parseFloat(getComputedStyle(document.querySelector("#dkList .dk-head")).top);
      window.scrollTo({ top: list.getBoundingClientRect().top + window.scrollY - bar + 60, behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const head = document.querySelector("#dkList .dk-head");
      return { listTop: Math.round(list.getBoundingClientRect().top), headTop: Math.round(head.getBoundingClientRect().top), bar: Math.round(parseFloat(getComputedStyle(head).top)) };
    });
    ok(stuck.listTop < stuck.bar, `the rows have scrolled up past the top bar (${stuck.listTop}px)`);
    ok(Math.abs(stuck.headTop - stuck.bar) <= 2, `and the header row is still where it was pinned, just under the bar (${stuck.headTop}px)`);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.baseURL + "/flows/desk/?t=CCC,DDD&strategy=both&rank=annualized", { waitUntil: "domcontentloaded" });
    await settle(3);
    await page.waitForFunction(() => document.querySelectorAll("#deskSurface .ivs-cell").length > 0, null, { timeout: 10000 });

    const smileNote = async () => {
      const text = await openInfo(page.locator('#deskSurface [aria-label="About smile"]'));
      await closeInfo();
      return text;
    };
    const readSurface = () => page.evaluate(() => {
      const q = (sel) => Array.from(document.querySelectorAll("#deskSurface " + sel));
      const svg = document.querySelector("#deskSurface .ivs");
      return {
        symbol: document.getElementById("deskSurfaceSymbol").value,
        cells: q(".ivs-cell").map((el) => ({
          expiry: el.getAttribute("data-expiry"), strike: Number(el.getAttribute("data-strike")), iv: Number(el.getAttribute("data-iv")),
          skew: el.getAttribute("data-skew"), traded: el.getAttribute("data-traded"), crowd: Number(el.getAttribute("data-crowd")),
          dash: el.getAttribute("stroke-dasharray"), fill: el.getAttribute("fill"), opacity: Number(el.getAttribute("fill-opacity")),
        })),
        numbers: q(".ivs-iv").map((t) => t.textContent),
        levels: q(".ivs-level").map((t) => t.textContent),
        columns: q(".ivs-exp").map((t) => ({ text: t.textContent, crosses: t.classList.contains("crosses-earnings") })),
        rowLabels: q(".ivs-m").map((t) => t.textContent),
        voids: q(".ivs-void").length, hatches: q(".ivs-hatch").length, clips: q(".ivs-clip").length,
        dots: q(".ivs-dot").length, termLines: q(".ivs-termline").length,
        aria: svg ? svg.getAttribute("aria-label") : null,
        svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
        viewW: svg ? Number((svg.getAttribute("viewBox") || "").split(/\s+/)[2]) : 0,
      };
    });

    await page.waitForFunction(() => {
      const svg = document.querySelector("#deskSurface .ivs");
      const vb = svg && Number((svg.getAttribute("viewBox") || "").split(/\s+/)[2]);
      return vb > 0 && Math.abs(vb - svg.getBoundingClientRect().width) <= 2;
    }, null, { timeout: 5000 }).catch(() => {});
    const ccc = await readSurface();
    const note = await smileNote();
    eq(ccc.symbol, "CCC", "the smile opens on the first symbol on the desk");
    eq(ccc.columns.length, 3, "one column per expiry on the chain");
    eq(ccc.cells.length, 16, "sixteen contracts are placed on the grid");

    {
      const front = ccc.cells.filter((c) => c.expiry === "2026-09-18").sort((a, b) => a.strike - b.strike)
        .map((c) => Number((c.iv * 100).toFixed(1)));
      assert.deepEqual(front, [46, 38, 32, 30.5, 31, 35, 41],
        "the front expiry's smile is drawn contract by contract, not flattened to its level"); checks++;
      const low = Math.min(...front);
      const at = front.indexOf(low);
      ok(at > 0 && at < front.length - 1,
         `and it bottoms strictly INSIDE the strike range (${front.join(" ")}) — a monotone skew cannot represent this chain`);
      ok(front[0] > low && front[front.length - 1] > low, "rising into both wings, which is the shape a seller is choosing between");
    }

    {
      assert.deepEqual(ccc.levels, ["30.5", DASH, "24.0"],
        "the at-the-money level is published per expiry — the term structure, read left to right"); checks++;
      eq(ccc.levels[0], "30.5",
         "the front level is the 102 call's, which TRADED today — not the 30.0 of the 100 that sits exactly at the money and has not");
      ok(/30\.5/.test(note) && /24\.0/.test(note), "and the levels are repeated in text in the Smile disclosure, where a strip of dots is unreadable");
      eq(ccc.dots, 2, "each measurable level is a dot on the term strip");
      eq(ccc.termLines, 0, "and the line does NOT bridge the expiry between them — a bridged segment would be an interpolated level");
    }

    {
      const middle = ccc.cells.filter((c) => c.expiry === "2026-10-16");
      ok(middle.length >= 3, "the expiry nobody traded near the money is still on the chart");
      ok(middle.every((c) => c.skew === ""), "with every cell carrying NO skew rather than a zero one — an unknown place on the smile is not the middle of it");
      ok(middle.every((c) => c.fill === "none"), "so those cells are drawn hollow rather than shaded as if they sat at the money");
      ok(middle.every((c) => c.iv > 0), "while still showing the volatility that was actually quoted, which is an observable either way");
      ok(/nearest contract that traded today is 24\.8%/.test(note), `and the disclosure says exactly why that column has no level (${note.slice(0, 40)}…)`);
      ok(/does not bridge/.test(note), "and that the term-structure line refuses to cross it");
    }

    {
      const stale = ccc.cells.filter((c) => c.traded === "false");
      eq(stale.length, 3, "three contracts on this chain have not traded today");
      ok(stale.every((c) => c.dash === "3 2"), "each is drawn with a BROKEN border — a form, so it survives a greyscale print and a colour-blind reader");
      const fresh = ccc.cells.filter((c) => c.traded === "true");
      ok(fresh.length > 0 && fresh.every((c) => c.dash === null), "and a contract that traded today carries no such border, or the mark would mean nothing");
      ok(/LAST TRANSACTION/.test(note), "the disclosure says this vendor's implied volatility is a fill and not a quote");
      ok(/13 of 16 cells traded today/.test(note), `and how much of the surface is today's (${(note.match(/\d+ of \d+ cells traded today/) || [])[0]})`);
      ok(/NONE of them set an expiry's level/.test(note),
         "and that a stale print never sets a level — a stale cell is one marked number, a stale level tilts a whole column with no marker on it");
    }

    {
      const negative = ccc.cells.filter((c) => c.skew !== "" && Number(c.skew) < 0);
      eq(negative.length, 1, "one contract on this chain is quoted BELOW its own expiry's at-the-money vol");
      eq(negative[0].strike, 110, "the back 110 call");
      eq(ccc.hatches, 1, "and it is HATCHED — the sign survives a greyscale render and a deuteranope reader, which a diverging hue does not");
      ok(/hatched below it/.test(note), "the disclosure says what the hatch means");
      ok(await page.locator("#deskSurface .ui-legend").evaluate((n) => /hatched/.test(n.textContent)), "and so does the legend under the chart");
    }

    {
      eq(ccc.clips, 2, "two cells run past the shade cap and are marked with a slash");
      ok(/capped at/.test(note), "rather than being flattened silently against everything else");
    }

    {
      const crowded = ccc.cells.filter((c) => c.crowd > 1);
      eq(crowded.length, 1, "the 100 and 102 calls fall in the same band of the same column");
      eq(crowded[0].strike, 102, "and the cell shows the 102 — today's print — not the 30.25 average of the two quotes");
      ok(/never an average/.test(note), "and the page says a cell is never an average");
    }

    {
      ok(ccc.rowLabels.includes("ATM"), "the at-the-money band is labelled as such");
      ok(/log-moneyness/.test(note) && /bands 5\.0% wide/.test(note),
         `the disclosure states the axis and the band width it chose (${(note.match(/bands [\d.]+% wide/) || [])[0]})`);
      ok(ccc.rowLabels.some((t) => t.indexOf(MINUS) === 0), "and a negative row label uses U+2212, not a hyphen");
    }

    {
      ok(/before the liquidity gates/.test(note) && /regardless of the Sell toggle/.test(note),
         "the page says the smile is not the list — the gates fall hardest on the wings, and a smile with its tails cut off is a different smile");
    }

    {
      const crossing = ccc.columns.filter((c) => c.crosses);
      eq(crossing.length, 1, "one expiry outlives the 11-05 report");
      ok(/12-18/.test(crossing[0].text), "and it is the back one");
      ok(crossing[0].text.includes("⚠"), "marked with a glyph, so it survives a greyscale render");
    }

    {
      ok(/Nothing here is fitted, interpolated or repriced/.test(note),
         "the smile states that it publishes quoted volatilities and differences of them, and nothing fitted");
      ok(/reads as a fraction/.test(note), `and carries the evidence for the units it is in (${(note.match(/median [\d.]+ reads as [a-z ]+/) || [])[0]})`);
      ok(ccc.aria && /At-the-money implied volatility by expiry/.test(ccc.aria), "and the chart has a text alternative that carries the term structure");
    }

    {
      await page.selectOption("#deskSurfaceSymbol", "DDD");
      await page.waitForFunction(() => document.getElementById("deskSurfaceSymbol").value === "DDD" &&
        document.querySelectorAll("#deskSurface .ivs-cell").length > 0, null, { timeout: 5000 });
      const ddd = await readSurface();
      const dNote = await smileNote();
      eq(ddd.cells.length, ccc.cells.length, "the percent-quoted chain places the same cells");
      assert.deepEqual(ddd.levels, ccc.levels, "and publishes the IDENTICAL at-the-money levels"); checks++;
      assert.deepEqual(ddd.numbers, ccc.numbers,
        "and the identical volatility in every cell — a chain quoted in percent and one quoted in fractions draw the same surface"); checks++;
      assert.deepEqual(ddd.cells.map((c) => `${c.expiry}|${c.strike}|${c.traded}`), ccc.cells.map((c) => `${c.expiry}|${c.strike}|${c.traded}`),
        "cell for cell, in the same places"); checks++;
      eq(ddd.hatches, ccc.hatches, "with the same sign on the same cell");
      ok(/reads as percent/.test(dNote), `and the page names the convention it detected rather than assuming one (${(dNote.match(/median [\d.]+ reads as [a-z ]+/) || [])[0]})`);
      eq(ddd.levels[0], "30.5", "30.5, not 3050 and not 0.305 — the level a desk would actually quote");
      eq(new URL(page.url()).searchParams.get("surface"), "DDD", "which smile is on screen travels in the link, like the watchlist and the ranking key");
      await page.selectOption("#deskSurfaceSymbol", "CCC");
    }

    {
      eq(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "the smile overflows nothing at 1440px");
      ok(Math.abs(ccc.viewW - ccc.svgW) <= 2, `the desk-width chart is built at one viewBox unit per pixel (${ccc.viewW} in ${ccc.svgW})`);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.waitForFunction(() => {
        const svg = document.querySelector("#deskSurface .ivs");
        const vb = svg && Number((svg.getAttribute("viewBox") || "").split(/\s+/)[2]);
        return vb > 0 && vb < 500;
      }, null, { timeout: 5000 }).catch(() => {});
      const narrow = await readSurface();
      ok(narrow.svgW < ccc.svgW, `the chart's box follows the column (${ccc.svgW} -> ${narrow.svgW})`);
      ok(Math.abs(narrow.viewW - narrow.svgW) <= 2,
         `and the chart is REDRAWN against the phone width rather than scaled down with it — one viewBox unit is still one pixel (${narrow.viewW} in ${narrow.svgW})`);
      eq(narrow.cells.length, ccc.cells.length, "with every cell still on it");
      eq(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "and it overflows nothing at 390px either");
    }

    {
      await page.click("#deskClear");
      await page.waitForFunction(() => document.getElementById("deskSurface").hidden === true, null, { timeout: 5000 });
      eq(await page.locator("#deskSurface").isHidden(), true,
         "clearing the desk clears the smile, rather than leaving the last symbol's chart under an empty list");
      eq(new URL(page.url()).searchParams.get("surface"), null, "and drops it from the URL");
    }
  }

  {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.baseURL + "/flows/desk/?t=FFF&strategy=csp&rank=annualized", { waitUntil: "domcontentloaded" });
    await settle(120);
    eq(await rowCount(), 120, "the route sends its top 120 and the desk holds all of them");
    eq(await page.locator(ROWS + ":not([hidden])").count(), 12, "and shows the first twelve until asked");
    await page.locator("#dkLinesM .ui-disclose").click();
    eq(await page.locator(ROWS + ":not([hidden])").count(), 120, "one tap shows all 120");
    await page.locator("#dkLinesM .ui-disclose").click();

    const note = await page.locator(".desk-chip__note").first().textContent();
    ok(/120 of 130 sellable/.test(note), `the chip states what is on the list AND what it was cut from (${note})`);

    const foot = await page.locator("#deskFoot").textContent();
    ok(/130 of 130 quoted contracts are sellable/.test(foot), `the screened total is still the chain's (${foot})`);
    ok(/This list is a slice/.test(foot), "the footnote says a cut happened at all");
    ok(/FFF shows its top 120 of 130 sellable lines/.test(foot), "and names the symbol, the count kept and the count it was cut from");
    ok(/ranked by annualised yield/.test(foot), "and the ordering that decided WHICH 120 — a top 120 by yield is not a top 120 by premium");
    ok(/10 lines below the cut are not on this list/.test(foot), "and how many are missing");

    const byYield = await strikesOf();
    ok(byYield.length === 120 && !byYield.some((k) => k >= 2000), "ranked by yield, the slice contains none of the ten deep in-the-money lines");

    const asked = [];
    const watchRank = (req) => { if (req.url().includes("/api/flows/chain")) asked.push(new URL(req.url()).searchParams.get("rank")); };
    page.on("request", watchRank);
    const callsBefore = upstreamCalls;
    await page.selectOption("#deskRank", "premium");
    await page.waitForFunction(() => Array.from(document.querySelectorAll("#dkList .dk-row")).some((r) => Number(r.dataset.strike) >= 2000),
      null, { timeout: 15000 }).catch(() => {});
    ok(upstreamCalls > callsBefore, "a re-rank on a CUT symbol goes back to the chain — the old slice cannot contain the new key's winners");
    ok(asked.includes("premium"), `and asks the route for the key it now wants (${asked.join(",")})`);
    const byPremium = await strikesOf();
    eq(byPremium.filter((k) => k >= 2000).length, 10, "and the ten $500 lines the yield slice never contained are now on the list");
    ok(byPremium.slice(0, 10).every((k) => k >= 2000), "at the top of it, which is what ranking by premium received means");
    page.off("request", watchRank);

    {
      eq(await page.locator("#deskBP").inputValue(), "", "no balance is entered here");
      eq(await page.locator("#dkList .dk-col").count(), 0, "so there is no Collect column");
      const cells = await page.$$eval(ROWS, (rs) => rs.map((r) => ({
        strike: Number(r.dataset.strike), away: r.dataset.away, collateral: r.dataset.collateral,
        line: r.querySelector(".dk-meta").textContent, sub: (r.querySelector(".dk-prem .dk-sub") || {}).textContent || "",
        ann: r.querySelector(".dk-ann").lastChild.textContent,
      })));
      ok(cells.every((c) => c.away && c.collateral), "every row carries both annotations, with no balance and no hover");
      ok(cells.every((c) => c.line.endsWith(c.away) && c.sub === c.collateral),
         "and both are printed on the row itself: the distance after the expiry, under the line, and the collateral under the premium");
      ok(cells.every((c) => /%$/.test(c.ann.trim())), "the yield keeps its unit");
      for (const c of cells) eq(c.collateral, "on $" + (c.strike * 100).toLocaleString("en-US"), `strike ${c.strike} states the collateral it reserves`);
      const otm = cells.filter((c) => / OTM$/.test(c.away));
      const itm = cells.filter((c) => / ITM$/.test(c.away));
      eq(itm.length, 10, "the ten puts struck above spot are marked in the money");
      ok(otm.length >= 100, "and the cheap ones below spot are marked out of it");
      ok(itm.every((c) => c.strike >= 2000), "the ITM mark is on the strikes above spot");
      ok(otm.every((c) => c.strike < 1000), "and the OTM mark on the ones below it");
      const deep = itm.find((c) => c.strike === 2000);
      eq(deep && deep.away, "100.0% ITM", "the distance is a percentage of spot, with its unit");
      const info = await rowInfo('#dkList .dk-row[data-strike="2000"]');
      ok(/above spot/.test(info.facts.Distance || ""), `and the row's disclosure says which side of spot, in words (${info.facts.Distance})`);
      ok(/cash reserved/.test(info.facts.Yield || ""), "and which collateral it is — cash for a put, shares for a call");
      ok(/intrinsic value/.test(info.text), "and how much of an in-the-money premium is intrinsic value that assignment returns");
      eq(await page.locator('#dkList .dk-row[data-strike="2000"]').evaluate((n) => n.classList.contains("is-itm")), true,
         "and the in-the-money row greys its yield, so a premium that is partly intrinsic does not read as income");

      const link = page.locator("#dkList .dk-row .dk-t").first();
      eq(await link.getAttribute("href"), "/flows/ticker/?t=FFF", "the symbol links to the analysis page, the way every other Flows surface does");
      eq((await link.textContent()).trim(), "FFF", "and reads as the ticker alone — the link is the text, not an appended glyph");
      ok(/today's board/.test(await link.getAttribute("title") || ""), "and says before the click that a name off the board has no card there");
    }
    await page.setViewportSize({ width: 390, height: 900 });
  }

  {
    const twin = await context.newPage();
    twin.on("pageerror", (e) => pageErrors.push(String(e)));
    const asked = [];
    twin.on("request", (req) => { if (req.url().includes("/api/flows/chain")) asked.push(new URL(req.url()).searchParams.get("rank")); });
    await twin.goto(server.baseURL + "/flows/desk/?t=FFF&strategy=csp&rank=yieldOnCollateral&bp=50000", { waitUntil: "domcontentloaded" });
    await twin.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length === 120, null, { timeout: 20000 });
    eq(asked.length, 1, `the first load asks the route once (${asked.join(",")})`);
    const askedBefore = asked.length;
    await twin.selectOption("#deskRank", "collectible");
    await twin.waitForTimeout(500);
    eq(asked.length, askedBefore, `switching to the key that maps to the same server rank sends nothing (${asked.join(",")})`);
    eq(await twin.locator("#dkList .dk-row").count(), 120, "and the list is still the slice it already had");
    ok(/ranked by yield on collateral/.test(await twin.locator("#deskFoot").textContent()),
       "the footnote still names the ordering that CHOSE the slice, which is the payload's, not the select's");
    await twin.selectOption("#deskRank", "cushionSigmas");
    await twin.waitForFunction(() => /ranked by cushion/.test(document.getElementById("deskFoot").textContent), null, { timeout: 20000 });
    eq(asked.length, askedBefore + 1, `a key the route ranks differently does go back to it (${asked.join(",")})`);
    eq(asked[asked.length - 1], "cushionSigmas", "under the key the reader now wants");
    await twin.close();
  }

  {
    const racer = await context.newPage();
    racer.on("pageerror", (e) => pageErrors.push(String(e)));
    await racer.addInitScript(() => { window.__flowsRankDebounceMs = 0; });
    await racer.route("**/api/flows/chain**", async (route) => {
      const rank = new URL(route.request().url()).searchParams.get("rank");
      if (rank === "premium") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await racer.goto(server.baseURL + "/flows/desk/?t=FFF&strategy=csp&rank=annualized", { waitUntil: "domcontentloaded" });
    await racer.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length === 120, null, { timeout: 20000 });
    await racer.selectOption("#deskRank", "premium");
    await racer.selectOption("#deskRank", "cushionSigmas");
    await racer.waitForFunction(() => /ranked by cushion/.test(document.getElementById("deskFoot").textContent), null, { timeout: 20000 });
    await racer.waitForTimeout(2500);
    const foot = await racer.locator("#deskFoot").textContent();
    ok(/ranked by cushion/.test(foot), `the superseded premium slice does not overwrite the one the reader asked for (${foot.slice(0, 160)})`);
    ok(!/ranked by premium/.test(foot), "and the footnote names no ordering the select has moved off");
    eq(await racer.locator("#deskRank").inputValue(), "cushionSigmas", "the select and the list agree about which question was answered");
    await racer.close();
  }

  {
    const stepper = await context.newPage();
    stepper.on("pageerror", (e) => pageErrors.push(String(e)));
    await stepper.addInitScript(() => { window.__flowsRankDebounceMs = 150; });
    const asked = [];
    await stepper.route("**/api/flows/chain**", async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get("rank"));
      await route.continue();
    });
    await stepper.goto(server.baseURL + "/flows/desk/?t=FFF&strategy=csp&rank=annualized", { waitUntil: "domcontentloaded" });
    await stepper.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length === 120, null, { timeout: 20000 });
    const settled = asked.length;
    ok(settled > 0, "the first load spends its calls, so the count below is a measurement of the re-ranking rather than of an empty page");
    await stepper.selectOption("#deskRank", "premium");
    await stepper.selectOption("#deskRank", "cushionSigmas");
    await stepper.selectOption("#deskRank", "yieldOnCollateral");
    eq(await stepper.locator("#deskRank").inputValue(), "yieldOnCollateral", "the select holds the key the reader landed on");
    ok(/rank=yieldOnCollateral/.test(stepper.url()), `and the URL already tracks it, without waiting for any refetch (${stepper.url()})`);
    await stepper.waitForTimeout(700);
    const spent = asked.slice(settled);
    eq(spent.length, 1,
       `three distinct keys crossed in a burst spend ONE round of calls, not three (sent: ${JSON.stringify(spent)}) — ` +
       "the two orderings the reader passed through were never asked for");
    eq(spent[0], "yieldOnCollateral", "and the one that is sent is for the key on screen, not for a key the reader has already left");
    await stepper.close();
  }

  {
    const bare = await context.newPage();
    bare.on("pageerror", (e) => pageErrors.push(String(e)));
    await bare.route("**/api/flows/chain**", async (route) => {
      const res = await route.fetch();
      const headers = Object.fromEntries(Object.entries(res.headers())
        .filter(([k]) => !["x-chain-age", "content-length"].includes(k.toLowerCase())));
      await route.fulfill({ status: res.status(), headers, body: await res.body() });
    });
    await bare.goto(server.baseURL + "/flows/desk/?t=AAA", { waitUntil: "domcontentloaded" });
    await bare.waitForFunction(() => /sellable/.test(document.querySelector(".desk-chip__note")?.textContent || ""), null, { timeout: 20000 });
    const note = await bare.locator(".desk-chip__note").first().textContent();
    ok(!/just now/.test(note), `an unstated age is not reported as a fresh one (${note})`);
    ok(/age not stated/.test(note), `and it is not reported as nothing either — the silence is named (${note})`);
    const status = await statusText(bare);
    ok(/quote age was not stated by the route/.test(status), `the status line says which silence it is too (${status})`);
    ok(!/quotes just now/.test(status), "and does not claim a freshness it never received");
    await bare.close();
  }

  {
    const junk = await context.newPage();
    junk.on("pageerror", (e) => pageErrors.push(String(e)));
    await junk.route("**/api/flows/chain**", async (route) => {
      await route.fulfill({ status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-chain-age": "0" },
        body: "<!doctype html><title>a captive portal, with a 200 on it</title>" });
    });
    await junk.goto(server.baseURL + "/flows/desk/?t=AAA", { waitUntil: "domcontentloaded" });
    await junk.waitForFunction(() => {
      const t = document.querySelector(".desk-chip__note")?.textContent || "";
      return t !== "" && !/loading/.test(t);
    }, null, { timeout: 15000 }).catch(() => {});
    eq(await junk.locator(".desk-chip__note").first().textContent(), "unreadable response", "the chip says which silence this is");
    const status = await statusText(junk);
    ok(/AAA unavailable/.test(status), `and the desk does not count it among the symbols it priced (${status})`);
    ok(!/1 symbol priced/.test(status), "which is what it used to do");
    await junk.close();
  }

  {
    const thin = await context.newPage();
    thin.on("pageerror", (e) => pageErrors.push(String(e)));
    await thin.route("**/api/flows/chain**", async (route) => {
      const url = new URL(route.request().url());
      const res = await route.fetch();
      if (url.searchParams.get("t") !== "AAA") { await route.fulfill({ response: res }); return; }
      const body = await res.json();
      delete body.priced;
      delete body.screened;
      const headers = Object.fromEntries(Object.entries(res.headers()).filter(([k]) => k.toLowerCase() !== "content-length"));
      await route.fulfill({ status: res.status(), headers, body: JSON.stringify(body) });
    });
    await thin.goto(server.baseURL + "/flows/desk/?t=FFF,AAA&strategy=csp", { waitUntil: "domcontentloaded" });
    await thin.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length === 121, null, { timeout: 20000 });
    const foot = await thin.locator("#deskFoot").textContent();
    ok(/10 lines below the cut are not on this list/.test(foot),
       `the shortfall is the sum of the cuts the sentence names, not a difference of two whole-desk totals (${foot})`);
    ok(/AAA is outside those two numbers/.test(foot), `and the symbol whose counts never arrived is named rather than added as nought (${foot})`);
    ok(/not a count of nought/.test(foot), "in the sentence that says why");
    ok(/130 of 130 quoted contracts are sellable/.test(foot), "the totals themselves stay the ones that were actually stated");
    await thin.close();
  }

  {
    const clockPage = await context.newPage();
    const clockErrors = [];
    clockPage.on("pageerror", (e) => clockErrors.push(String(e)));
    await clockPage.clock.install({ time: new Date("2026-08-25T14:00:00Z") });
    await clockPage.goto(server.baseURL + "/flows/desk/?t=GGG", { waitUntil: "domcontentloaded" });
    const noteText = () => clockPage.evaluate(() => { const n = document.querySelector(".desk-chip__note"); return n ? n.textContent : ""; });
    const until = async (test, what) => {
      let last = "";
      for (let i = 0; i < 300; i++) {
        last = await noteText();
        if (test(last)) return last;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out waiting for ${what} (last note: "${last}")`);
    };
    const fresh = await until((t) => /sellable/.test(t), "GGG to price");
    ok(/just now/.test(fresh), `a quote that has just arrived reads as fresh (${fresh})`);
    await clockPage.clock.fastForward(11 * 60 * 1000);
    const aged = await until((t) => /sellable/.test(t) && !/just now/.test(t), "the printed age to advance");
    ok(/11m ago/.test(aged), `eleven minutes later the chip says eleven minutes, with no keystroke in between (${aged})`);
    const status = await statusText(clockPage);
    ok(/quotes 11m ago/.test(status), `and so does the status line (${status})`);
    ok(/older than this desk will call a price/.test(status), "which stops claiming a freshness it cannot have, and says what to press");
    eq(await statusShown(clockPage), true, "and puts that on the surface, because a stale quote is a warning");
    eq(clockErrors.length, 0, `nothing threw on the ticking desk (${clockErrors[0] || ""})`);
    await clockPage.close();
  }

  {
    eq(pageErrors.length, 0, `no uncaught page error across the whole session (${pageErrors[0] || ""})`);
    await page.goto(server.baseURL + "/flows/desk/?t=AAA,BBB&bp=10000", { waitUntil: "domcontentloaded" });
    await settle(3);
    eq(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "the desk does not overflow a 390px viewport");
    eq(await page.locator("#dkList").getAttribute("role"), "list", "the lines are announced as a list");
    ok(await page.locator("#dkList").getAttribute("aria-label"), "with a name");
    eq(await page.locator("#dkList .dk-row").first().getAttribute("role"), "listitem", "and each line as an item of it");
    const labels = await page.$$eval("#dkList .dk-row:not([hidden]) .dk-c small", (n) => n.map((x) => x.textContent));
    ok(labels.includes("Real world") && labels.includes("Implied"),
       "on a phone every figure is printed under its own label, because the header row is gone at this width");
    const cellsVisible = await page.$eval("#dkList .dk-row .dk-c small", (n) => getComputedStyle(n).position !== "absolute");
    ok(cellsVisible, "and the labels are on the surface, not only in the accessibility tree");
  }

  console.log(`✓ flows-desk: ${checks} assertions — cross-symbol re-ranking, URL-held state, select-all tri-state, ` +
    `a refresh floor that spends nothing, per-chip failure isolation, every line priced in the page by the engine ` +
    `to the byte the server module prices it, the real-world figures present only where a card publishes a law, ` +
    `a frontier of yield against risk walked from the keyboard, a desk sized to a real balance and checked against ` +
    `the module that defines the sizing, a smile whose shape, term structure, stale prints and unit convention are ` +
    `each read out of the DOM with its reading one tap away, a top-120 slice that names its cut and refetches rather ` +
    `than re-sorting it, rows that print their collateral and their distance from spot with no balance and no hover, ` +
    `a header that stays put while the rows scroll, a quote age driven off a faked clock to prove it advances on its ` +
    `own, two select options that share one key on the wire and cost one round trip between them, a superseded slice ` +
    `that loses to the one the reader actually asked for, and three payloads a stub cannot produce — no age header, ` +
    `no counts, no readable body — each answered with the sentence that says which silence it is`);
} finally {
  await browser.close();
  await server.stop();
  await new Promise((r) => upstream.close(r));
}
