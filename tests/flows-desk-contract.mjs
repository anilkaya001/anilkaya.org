/* End-to-end contracts for the premium desk, driven through a real browser
   against a real Worker and a stub upstream.

   flows-desk.js is the newest and most user-facing code in this repository and
   until now the only thing asserted about it was that the page is gated. Its
   controller does the things that go wrong quietly: it merges payloads from
   several symbols into one ranking, it holds state in the URL, it fans out
   bounded concurrent fetches against a metered credential, and it renders
   counts that must reconcile. None of that is reachable from a unit test.

   The stub upstream serves DIFFERENT chains per ticker on purpose. A desk that
   concatenates per-symbol payloads instead of re-ranking them looks perfectly
   correct against one symbol, and puts every AAPL line above every MSFT line
   the moment there are two. That is the defect this file exists to catch. */

import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* ---------- the stub upstream ---------------------------------- */

let upstreamCalls = 0;
const callsByTicker = new Map();

/* THE FIXTURE IS TUNED SO THE CORRECT ANSWER INTERLEAVES.

   A first version gave AAA both of the top two yields, so the correct ranking
   was AAA, AAA, BBB — which is also exactly what naive concatenation produces.
   The test passed on a desk that never re-ranked at all. Grouped and correct
   have to DISAGREE or the assertion proves nothing.
  
   Priced at the bid over 25 days (2026-08-24 -> 2026-09-18), annualised:
     AAA 47 put   190 / 4700  collateral  -> 59.0%
     BBB 380 put  600 / 38000 collateral  -> 23.1%
     AAA 55 call   60 / 5000  collateral  -> 17.5%
   So the correct order is AAA, BBB, AAA. Concatenating per-symbol payloads
   gives AAA, AAA, BBB. The two are now distinguishable.
  
   Under PREMIUM DOLLARS the order reverses to BBB, AAA, AAA — a different
   answer from the same rows, which is the point of offering both keys. */
const CHAINS = {
  AAA: {
    spot: 50,
    rows: [
      { option_symbol: "AAA260918P00047000", nbbo_bid: "1.90", nbbo_ask: "1.95",
        implied_volatility: "0.42", open_interest: "800", prev_oi: "700", volume: "120" },
      { option_symbol: "AAA260918C00055000", nbbo_bid: "0.60", nbbo_ask: "0.65",
        implied_volatility: "0.40", open_interest: "600", volume: "90" },
      // junk: no bid at all
      { option_symbol: "AAA260918P00030000", nbbo_bid: "0", nbbo_ask: "0.20",
        implied_volatility: "0.80", open_interest: "400", volume: "5" },
    ],
  },
  BBB: {
    spot: 400,
    rows: [
      /* NO VOLUME TODAY. implied_volatility is the LAST TRANSACTION's per the
         vendor's own schema ref, so this contract's cushion is as old as a
         print nobody can date. The page must mark it rather than render it
         beside AAA's — which traded — in the same typeface. */
      { option_symbol: "BBB260918P00380000", nbbo_bid: "6.00", nbbo_ask: "6.20",
        implied_volatility: "0.30", open_interest: "2000", prev_oi: "1500", volume: "0" },
      // junk: eleven contracts of open interest
      { option_symbol: "BBB260904P00300000", nbbo_bid: "0.05", nbbo_ask: "0.60",
        implied_volatility: "0.95", open_interest: "11", volume: "2" },
    ],
  },
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
  if (url.pathname.endsWith("/stock-state")) {
    /* AAA gets a LIVE print above its daily close; BBB gets no live price at
       all. One desk therefore carries both cases at once, which is the only
       way to assert that the page distinguishes them instead of rendering a
       stale close and a live quote identically. */
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

const server = await startWorker({
  extraVars: ["UW_API_KEY:test-uw-key", `UW_BASE:${upstreamURL}`],
});

const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);

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

  const rowCount = () => page.locator("#deskBody tr").count();
  const settle = async (want) => {
    await page.waitForFunction(
      (n) => document.querySelectorAll("#deskBody tr").length >= n, want, { timeout: 15000 });
  };

  /* ---------- the page loads and starts empty -------------------- */
  {
    await page.goto(server.baseURL + "/flows/desk/", { waitUntil: "domcontentloaded" });
    ok(await page.locator("#deskBody").count() === 1, "the desk table body is present");
    eq(await page.locator("#deskTableWrap").isHidden(), true, "no table before a symbol is added");
    ok(/Add a symbol/.test(await page.locator("#deskStatus").textContent()),
       "and the status invites one");
    eq(await page.locator("#deskAll").isDisabled(), true,
       "select-all is disabled with nothing to select");
    eq(upstreamCalls, 0, "an empty desk spends no vendor call");
  }

  /* ---------- one symbol prices, and the junk is gated ----------- */
  {
    await page.fill("#deskInput", "aaa");
    await page.click(".desk-add");
    await settle(1);
    ok(await rowCount() >= 1, "typing a symbol prices it");
    ok((await page.locator(".desk-chip__sym").first().textContent()).trim() === "AAA",
       "lowercase input is normalised to a ticker");

    const foot = await page.locator("#deskFoot").textContent();
    ok(/of 3 quoted contracts/.test(foot), `the screened total is the vendor's, not the survivors' (${foot})`);
    ok(/first gate it failed/.test(foot), "and the counts are declared a partition");

    const symbols = await page.locator("#deskBody th").allTextContents();
    ok(symbols.every((s) => s.trim() === "AAA"), "only the added symbol is priced");
    const strikes = await page.locator("#deskBody tr td:nth-child(3)").allTextContents();
    ok(!strikes.some((s) => s.trim() === "30.00"),
       "the zero-bid contract is absent — no bid is no sale, not a cheap one");
  }

  /* ---------- the page says WHICH price it priced against -------- */
  {
    /* A covered call's collateral IS the shares at spot and every moneyness is
       measured from it, so a table built on yesterday's close and one built on
       a live print are different tables. Rendering them identically is the
       same omission as showing a cached row as live. */
    const note = await page.locator(".desk-chip__note").first().textContent();
    ok(/\$51\.00/.test(note), `AAA is priced against the live print, not its 50.00 close (${note})`);
    ok(!/close/.test(note), "and a live print is not labelled a close");
    const status = await page.locator("#deskStatus").textContent();
    ok(/regular session/.test(status), `the vendor's session name reaches the page (${status})`);
  }

  /* ---------- the watchlist lives in the URL --------------------- */
  {
    const u = new URL(page.url());
    eq(u.searchParams.get("t"), "AAA", "the watchlist is in the URL, not in browser storage");
    ok(u.searchParams.get("rank"), "and so is the ranking key");
  }

  /* ---------- a second symbol RE-RANKS across both --------------- */
  {
    const before = upstreamCalls;
    await page.fill("#deskInput", "BBB");
    await page.click(".desk-add");
    await settle(3);
    ok(upstreamCalls > before, "the new symbol costs its own vendor call");

    const syms = (await page.locator("#deskBody th").allTextContents()).map((s) => s.trim());
    ok(syms.includes("AAA") && syms.includes("BBB"), "both symbols are in one table");

    /* BBB HAS NO LIVE PRICE, and the page must say so rather than quietly
       pricing it off yesterday's close beside a symbol that is live. */
    const notes = await page.locator(".desk-chip__note").allTextContents();
    const bbbNote = notes[1] || "";
    ok(/close/.test(bbbNote), `BBB is marked as priced off the last close (${bbbNote})`);
    const status = await page.locator("#deskStatus").textContent();
    ok(/BBB priced off the last close/.test(status),
       `and the status names it rather than averaging the two states away (${status})`);

    /* THE DEFECT THIS FILE EXISTS FOR. Each payload arrives ranked within its
       own symbol, so concatenating them groups by insertion. The fixture is
       built so the correct answer INTERLEAVES — AAA, BBB, AAA — which
       concatenation cannot produce under any ordering of the two payloads. */
    assert.deepEqual(syms, ["AAA", "BBB", "AAA"],
      "the merged table is re-ranked across symbols, not concatenated"); checks++;
  }

  /* ---------- a cushion is only as fresh as the vol it divides by -- */
  {
    const stale = page.locator("#deskBody td.is-stale-iv");
    ok(await stale.count() >= 1,
       "a contract that has not traded today has its cushion marked");
    const title = await stale.first().getAttribute("title");
    ok(title && /not traded today/.test(title),
       `and says why on hover (${title})`);
    ok((await stale.first().textContent()).trim() !== "—",
       "the cushion is MARKED, not withheld — it is still the best reading available");

    /* And a contract that DID trade is not marked, or the mark means nothing. */
    const cells = await page.locator("#deskBody tr").count();
    const marked = await stale.count();
    ok(marked < cells, "contracts that traded today are not marked");
  }

  /* ---------- switching the ranking key re-sorts LOCALLY ---------- */
  {
    const before = upstreamCalls;
    await page.selectOption("#deskRank", "premium");
    await page.waitForFunction(
      () => (document.querySelector("#deskBody th") || {}).textContent === "BBB",
      null, { timeout: 8000 });
    const syms = (await page.locator("#deskBody th").allTextContents()).map((s) => s.trim());
    eq(syms[0], "BBB", "by premium dollars the expensive underlying leads — a different answer");
    eq(upstreamCalls, before,
       "re-sorting rows already in hand spends no vendor call");
    eq(new URL(page.url()).searchParams.get("rank"), "premium", "and the key is in the URL");
    await page.selectOption("#deskRank", "annualized");
  }

  /* ---------- select all, and deselect -------------------------- */
  {
    eq(await page.locator("#deskAll").isDisabled(), false, "select-all enables once there is a list");
    eq(await page.locator("#deskAll").isChecked(), true, "added symbols start selected");

    await page.uncheck("#deskAll");
    await page.waitForFunction(() => document.querySelectorAll("#deskBody tr").length === 0,
      null, { timeout: 8000 });
    eq(await rowCount(), 0, "deselecting everything empties the table");
    ok(/Select a symbol/.test(await page.locator("#deskStatus").textContent()),
       "and the status says why it is empty rather than looking broken");

    await page.check("#deskAll");
    await settle(3);
    ok(await rowCount() >= 3, "select-all brings them back");
  }

  /* ---------- a half-selected list is INDETERMINATE -------------- */
  {
    await page.locator('.desk-chip input[type="checkbox"]').first().uncheck();
    const state = await page.evaluate(() => {
      const b = document.getElementById("deskAll");
      return { checked: b.checked, indeterminate: b.indeterminate };
    });
    eq(state.indeterminate, true,
       "a half-selected list shows indeterminate rather than claiming either extreme");
    eq(state.checked, false, "and is not reported as all-selected");
    await page.locator('.desk-chip input[type="checkbox"]').first().check();
  }

  /* ---------- refresh, and the floor that stops it being a proxy -- */
  {
    await settle(3);
    const before = upstreamCalls;
    await page.click("#deskRefresh");
    await page.waitForTimeout(1500);
    eq(upstreamCalls, before,
       "a refresh moments after a fetch is served from the edge and spends nothing");
    const chipNotes = (await page.locator(".desk-chip__note").allTextContents()).join(" ");
    ok(/sellable/.test(chipNotes), "each chip still reports what it holds");
  }

  /* ---------- an unknown symbol fails ON ITS CHIP, not the page --- */
  {
    await page.fill("#deskInput", "ZZZ");
    await page.click(".desk-add");
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".desk-chip"))
        .some((c) => c.className.includes("is-error")), null, { timeout: 10000 });

    const errChip = page.locator(".desk-chip.is-error").first();
    ok((await errChip.textContent()).includes("ZZZ"), "the failing symbol is named");
    ok(await rowCount() >= 3,
       "and the symbols that DID price stay on the table — one bad ticker is not a dead page");
    const status = await page.locator("#deskStatus").textContent();
    ok(/ZZZ/.test(status) && /unavailable/.test(status),
       `the status reports the partial failure (${status})`);
  }

  /* ---------- a malformed symbol never reaches the network ------- */
  {
    const before = upstreamCalls;
    await page.fill("#deskInput", "!!!");
    await page.click(".desk-add");
    await page.waitForTimeout(600);
    eq(upstreamCalls, before, "an unparseable symbol costs no vendor call");
    ok(/not a symbol/.test(await page.locator("#deskStatus").textContent()),
       "and says so rather than failing silently");
  }

  /* ---------- clear ---------------------------------------------- */
  {
    await page.click("#deskClear");
    await page.waitForFunction(() => document.querySelectorAll(".desk-chip").length === 0,
      null, { timeout: 8000 });
    eq(await page.locator("#deskTableWrap").isHidden(), true, "clearing hides the table");
    eq(new URL(page.url()).searchParams.get("t"), null, "and empties the watchlist in the URL");
  }

  /* ---------- the URL is the state: a deep link restores a desk --- */
  {
    const deep = server.baseURL + "/flows/desk/?t=AAA,BBB&rank=premium&strategy=csp";
    await page.goto(deep, { waitUntil: "domcontentloaded" });
    await settle(1);
    const syms = (await page.locator(".desk-chip__sym").allTextContents()).map((s) => s.trim());
    assert.deepEqual(syms, ["AAA", "BBB"], "a shared URL restores the whole watchlist"); checks++;
    eq(await page.locator("#deskRank").inputValue(), "premium", "and the ranking key");
    eq(await page.locator("#deskStrategy").inputValue(), "csp", "and the strategy");
    const sides = (await page.locator("#deskBody td.c-side").allTextContents()).map((s) => s.trim());
    ok(sides.length > 0 && sides.every((s) => s === "Cash-secured put"),
       "a csp desk shows only puts");
  }

  /* ---------- nothing threw, at a phone width -------------------- */
  {
    eq(pageErrors.length, 0, `no uncaught page error across the whole session (${pageErrors[0] || ""})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    eq(overflow, false, "the desk does not overflow a 390px viewport");
    /* The table is wider than a phone by design, so the WRAPPER scrolls and
       must be reachable by keyboard — without a tabindex a keyboard-only user
       tabs straight past it and most columns are unreachable. */
    eq(await page.locator("#deskTableWrap").getAttribute("tabindex"), "0",
       "the scrolling table region is focusable");
    ok(await page.locator("#deskTableWrap").getAttribute("aria-label"),
       "and is announced as a named region");
  }

  console.log(`✓ flows-desk: ${checks} assertions — cross-symbol re-ranking, URL-held state, ` +
    `select-all tri-state, a refresh floor that spends nothing, per-chip failure isolation, ` +
    `and no vendor call for a symbol the page can reject itself`);
} finally {
  await browser.close();
  await server.stop();
  await new Promise((r) => upstream.close(r));
}
