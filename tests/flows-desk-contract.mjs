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
import { sizeToBuyingPower } from "../shared/flows-premium.js";
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

/* ---------- CCC: a chain that is actually a VOLATILITY SURFACE ----

   AAA and BBB were built to break a ranking and they have one expiry each and
   three IVs between them, which cannot show anything about a smile. A surface
   fixture has to contain the shapes the surface exists to draw, or every
   assertion about it passes against code that draws a flat grid.

   Spot is 100 and there is no live print for CCC, so it is priced off its own
   daily close and every moneyness is the logarithm of a round ratio.

   FOUR PLACES WHERE THE NAIVE ANSWER AND THE CORRECT ONE DIVERGE:

     THE SMILE IS NON-MONOTONE. 46.0 38.0 32.0 30.5 31.0 35.0 41.0 across the
     front expiry's strikes — down into the money and up again into the call
     wing, with the minimum strictly inside. Nothing that can only draw a
     monotone skew, and nothing that paints a column with its own level, can
     produce that sequence.

     TWO LIVE EXPIRIES AT DIFFERENT LEVELS. 30.5 at 25 days against 24.0 at
     116, so a surface shaded against one chain-wide at-the-money quote is
     wrong on both columns and in opposite directions.

     THE LEVEL AND THE SKEW ORDER ONE ROW THE OPPOSITE WAY. At 10% below the
     money the front quotes 38.0 and the back 34.0, while the back's skew is
     the steeper of the two — +10.0 against +7.5. A grid of raw volatility
     says the front wing is the dramatic one. The smile says it is the back.

     THE CONTRACT EXACTLY AT THE MONEY HAS NOT TRADED TODAY. The 100 call's
     30.0 is a print of unknown age; the 102, two percent out, traded 300 times
     this morning. The level is 30.5. A build that took the nearest contract
     regardless of age reads 30.0, and every cell in that column is then half a
     vol point out with no marker on any of them.

   The 10-16 expiry is the fourth case on its own: everything within reach of
   the money is a stale print and the only contract that traded today is 24.8%
   out, so that column gets NO level at all. */
const CCC_ROWS = [
  // 2026-09-18, 25 days out.
  ["P00085000", 0.80, 0.85, 0.46, 150, 150],
  ["P00090000", 1.40, 1.48, 0.38, 220, 220],
  ["P00095000", 2.30, 2.40, 0.32, 400, 400],
  ["C00100000", 2.10, 2.20, 0.30, 900, 0],      // at the money, and NOT traded today
  ["C00102000", 1.60, 1.68, 0.305, 700, 300],   // 2% out, traded today — this is the level
  ["C00105000", 1.05, 1.10, 0.31, 500, 500],
  ["C00110000", 0.55, 0.60, 0.35, 300, 300],
  ["C00115000", 0.30, 0.34, 0.41, 120, 120],
].map(([tail, bid, ask, iv, oi, volume]) => ({ tail: "260918" + tail, bid, ask, iv, oi, volume }))
  .concat([
    // 2026-10-16: nothing near the money traded today.
    ["P00078000", 0.65, 0.72, 0.44, 300, 300],
    ["P00095000", 2.90, 3.05, 0.33, 260, 0],
    ["C00100000", 3.10, 3.25, 0.28, 340, 0],
    ["C00110000", 1.05, 1.15, 0.31, 180, 0],
  ].map(([tail, bid, ask, iv, oi, volume]) => ({ tail: "261016" + tail, bid, ask, iv, oi, volume })))
  .concat([
    // 2026-12-18, 116 days out, at a lower level — and one call quoted BELOW
    // its own at-the-money vol, which is the only cell on the chain that can
    // prove the sign is carried by something other than a colour.
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

/* DDD IS CCC QUOTED IN PERCENT, and it exists for one assertion.

   ivConvention() decides ONCE PER CHAIN whether this vendor sent fractions or
   percent, from the median, because the vendor is inconsistent about it — the
   same ambiguity that nearly shipped a card reading "1352% of its year" off
   iv_rank. A surface that read the raw field would be exactly right on every
   symbol quoted as a fraction and exactly 100x wrong on the rest, and it would
   render perfectly in both cases. Nothing on the page could reveal which one
   the reader was looking at.

   So the identical chain is served under two conventions and the two surfaces
   have to draw the same numbers. */
CHAINS.CCC = { spot: 100, rows: CCC_ROWS.map((r) => ccRow("CCC", r, 1)) };
CHAINS.DDD = { spot: 100, rows: CCC_ROWS.map((r) => ccRow("DDD", r, 100)) };

/* ---------- FFF: a chain the route has to CUT --------------------

   Every fixture above fits inside the route's 120-row slice, so nothing in
   this file could reach the code that STATES a cut, and nothing could reach
   the code that decides a re-rank on a cut symbol cannot be answered locally.
   A fixture that cannot reach the branch it certifies is this repository's
   most repeated mistake, so this one is built to reach both.

   130 sellable puts on a $1,000 name, in two bands that RANK IN OPPOSITE
   ORDERS:

     120 cheap out-of-the-money puts — 60c on strikes 20..139, so the yields
     run 3.00% down to 0.43% and every premium is $60.

     10 deep in-the-money puts — $5.00 on strikes 2000..2009, so every yield is
     0.25%, below all 120 of them, and every premium is $500, above all 120.

   Ranked by annualised yield the ten are ranks 121-130 and the slice drops
   every one. Ranked by premium received they are ranks 1-10. So the top 120 by
   one key and the top 120 by the other do not merely differ in ORDER — they
   differ in MEMBERSHIP, which is the whole reason a re-rank on a cut symbol
   cannot be served from the rows already in hand. A desk that re-sorted
   locally shows the same 120 rows rearranged, with a $60 premium on its top
   line while ten $500 lines sit unfetched, and it looks completely correct.

   FFF also carries the only in-the-money contracts in this file, which is the
   other side of the strike cell's OTM/ITM word. */
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

/* GGG is AAA's chain under another name, and it exists so ONE symbol in this
   file is guaranteed never to have been fetched before. The age assertions
   need a response the edge cache has not already answered: every other symbol
   here is priced several times over by the blocks above, so its X-Chain-Age
   arrives as whatever the cache's copy happens to be worth, and "a fresh quote
   reads as fresh" would then be an assertion about test order. */
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
    /* AAA reports between its two expiries; BBB has no info at all. One page
       therefore carries a marked row, an unmarked-for-a-reason row, and a
       cannot-tell row — the three states that are currently one silence.

       CCC reports 11-05, which falls between its 10-16 and 12-18 expiries. Its
       surface therefore has one column that outlives a report and two that do
       not, which is the reading a term structure is for: a front that is bid
       relative to the back is a different statement when the back is the leg
       carrying the event. */
    const dates = { AAA: "2026-09-10", CCC: "2026-11-05", DDD: "2026-11-05" };
    if (!dates[ticker]) { res.writeHead(404); res.end("{}"); return; }
    res.writeHead(200);
    res.end(JSON.stringify({ data: {
      next_earnings_date: dates[ticker], announce_time: "premarket",
      issue_type: "Common Stock" } }));
    return;
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

  /* ---------- headers and cells agree ---------------------------- */
  {
    /* A column added to the markup and not to rowFor — or the reverse —
       shifts every cell after it under the wrong heading, and the table still
       renders perfectly. This is not hypothetical: adding the "If called"
       column did exactly that to a test reading a hardcoded index, and it read
       the spread as the cap.

       It runs HERE, immediately after the first table, rather than in the
       desktop block where it started. Assertions abort the file, so a
       mismatch was being reported by whichever later assertion happened to
       trip over the shift — a confusing message for the clearest possible
       defect. Order is part of a test's diagnosis. */
    /* VISIBLE headers, because one column is conditional: Collect exists only
       once a buying power does. A hidden <th> counted here would demand a cell
       nothing should be drawing. The buying-power block below asserts both
       states of that column explicitly, so nothing is lost by excluding it. */
    const shape = await page.evaluate(() => {
      const heads = document.querySelectorAll(".desk-table thead th:not([hidden])").length;
      const rows = Array.from(document.querySelectorAll("#deskBody tr"));
      return { heads, widths: rows.map((r) => r.querySelectorAll("th, td").length) };
    });
    ok(shape.heads > 0 && shape.widths.length > 0, "there is a table to check");
    for (const w of shape.widths) {
      eq(w, shape.heads,
         `every row has exactly one cell per header (${w} cells, ${shape.heads} headers)`);
    }
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

  /* ---------- the covered call's cap, which was computed and hidden -- */
  {
    /* priceSale has always computed assignedReturn and capSigmas, serialised
       them on every row, and shipped them over the wire. rowFor drew neither,
       so the desk told a covered-call seller what they get paid and never what
       they gave up. */
    /* THE COLUMN INDEX IS DERIVED FROM THE HEADER, not hardcoded. A magic
       index silently reads the wrong column the first time anyone inserts
       one — and this test was written the same day a column was inserted. */
    const calledIdx = await page.evaluate(() => {
      /* :not([hidden]) is load-bearing. A conditional column that is present
         in the markup but drawn in no row shifts every derived index past it,
         which is the same off-by-one this block already warns about — just
         arriving through the header list instead of through a magic number. */
      const heads = Array.from(document.querySelectorAll(".desk-table thead th:not([hidden])"));
      const i = heads.findIndex((h) => /If called/.test(h.textContent));
      return i - 1;                                  // the first column is a <th> in each row
    });
    ok(calledIdx >= 0, "the table has an 'If called' column");

    const rows = await page.locator("#deskBody tr").all();
    let sawCall = false, sawPut = false;
    for (const tr of rows) {
      const side = (await tr.locator("td.c-side").textContent()).trim();
      const called = tr.locator("td").nth(calledIdx);
      const text = (await called.textContent()).trim();
      const title = await called.getAttribute("title");
      if (side === "Covered call") {
        sawCall = true;
        ok(/%$/.test(text), `a covered call shows its called-away return (${text})`);
        ok(title && /run/.test(title), "and how far the market must run to get there");
      } else if (side === "Cash-secured put") {
        sawPut = true;
        eq(text, "\u2014", "a put shows a dash — it has no upside cap");
        ok(title && /no upside cap/.test(title),
           "and the dash SAYS it is an absence, not missing data");
      }
    }
    ok(sawCall, "the fixture contains a covered call");
    ok(sawPut, "and a cash-secured put");
  }

  /* ---------- earnings crossing, and the state that is not false -- */
  {
    /* A cushion is a diffusion number and an earnings report is a jump. AAA's
       September contracts outlive its 09-10 report; BBB has no earnings
       information at all, which is NOT the same as having no report. */
    const marked = page.locator("#deskBody td.crosses-earnings");
    ok(await marked.count() >= 1, "a contract outliving the report is marked");
    ok((await marked.first().textContent()).includes("\u26a0"),
       "the marker is a glyph, so it survives a greyscale render");
    const title = await marked.first().getAttribute("title");
    ok(title && /diffusion number priced against a jump/.test(title),
       `and says why the cushion is weaker there (${(title || "").slice(0, 60)})`);

    /* THE DANGEROUS STATE. BBB's /info 404s, so whether its rows cross cannot
       be determined — and rendering that identically to "no report before
       expiry" tells a seller their position is event-free when the truth is
       that nobody looked. */
    const unknown = page.locator("#deskBody td.earnings-unknown");
    ok(await unknown.count() >= 1,
       "a symbol with no earnings information is marked as UNDETERMINED, not clean");
    const uTitle = await unknown.first().getAttribute("title");
    ok(uTitle && /could not be\s+determined/.test(uTitle.replace(/\s+/g, " ")),
       `and says so rather than implying safety (${(uTitle || "").slice(0, 60)})`);

    /* And the status line names both, so an unmarked row is unmarked for a
       stated reason. */
    const status = await page.locator("#deskStatus").textContent();
    ok(/AAA reports 09-10/.test(status), `the status names the report date (${status})`);
    ok(/BBB has no known earnings date/.test(status),
       "and says which symbol it could not date");
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

  /* ---------- and at the width it is actually used at ------------ */
  {
    /* Every assertion above runs at 390px, which is the width that breaks
       layouts — but a premium desk is a trading screen, and the width it is
       actually USED at had never been measured. Thirteen columns behave
       differently when they all fit. */
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelectorAll("#deskBody tr").length > 0,
      null, { timeout: 8000 });

    const wide = await page.evaluate(() => {
      const wrap = document.getElementById("deskTableWrap");
      const table = document.querySelector(".desk-table");
      const heads = Array.from(document.querySelectorAll(".desk-table thead th:not([hidden])"));
      const firstRow = document.querySelector("#deskBody tr");
      const cells = firstRow ? firstRow.querySelectorAll("th, td").length : 0;
      return {
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        headCount: heads.length,
        cellCount: cells,
        // Does the table now fit without the wrapper scrolling?
        wrapScrolls: wrap.scrollWidth > wrap.clientWidth + 1,
        tableW: Math.round(table.getBoundingClientRect().width),
        wrapW: Math.round(wrap.getBoundingClientRect().width),
        // Any header text wrapped to an unreadable sliver?
        minHeadW: Math.min(...heads.map((h) => Math.round(h.getBoundingClientRect().width))),
      };
    });

    eq(wide.pageOverflow, false, "the desk overflows nothing at 1440px");
    ok(wide.minHeadW >= 24,
       `no header is crushed to an unreadable sliver (${wide.minHeadW}px)`);
    ok(wide.tableW <= wide.wrapW + 2,
       `thirteen columns fit without scrolling at desk width (${wide.tableW} in ${wide.wrapW})`);
  }

  /* ---------- buying power sizes the desk ------------------------
     Still at 1440px: this is the block that adds a fourteenth column, so it
     runs where there is room for one.

     THE FIXTURE STRADDLES THE AFFORDABILITY CLIFF ON PURPOSE. At $10,000:

       AAA 47 put   $4,700 collateral -> 2 contracts, collects $380
       AAA 55 call  $5,100 collateral -> 1 contract,  collects  $60
       BBB 380 put $38,000 collateral -> 0 contracts, collects   $0

     BBB pays the most per contract and has the second-best yield, and this
     account cannot buy one. So the collectible order is AAA, AAA, BBB where
     every other key on the page orders it AAA, BBB, AAA or BBB, AAA, AAA. The
     table is ALREADY rendered in AAA, BBB, AAA when this block starts, so a
     controller that ignored the new key would be caught by the order not
     changing at all. */
  {
    const BP = 10000;

    /* A KNOWN STARTING STATE. The block above left the desk on a deep link
       that pinned strategy=csp and rank=premium, and an ordering assertion
       that inherits whatever the previous block happened to leave behind is
       an assertion about test order rather than about the desk. */
    await page.goto(server.baseURL + "/flows/desk/?t=AAA,BBB&strategy=both&rank=annualized",
      { waitUntil: "domcontentloaded" });
    await settle(3);

    /* THE ARITHMETIC IS CHECKED AGAINST ITS AUTHORITY, not against numbers
       typed into this file. flows-desk.js re-implements sizeToBuyingPower()
       so the account balance never leaves the browser — see the comment there
       — and a re-implementation with no parity check is a fork waiting to
       drift. The rows come from the Worker's own JSON; the expected cells are
       computed here by the shared module; the actual cells are read out of a
       real browser. */
    const chainOf = async (symbol) => {
      const r = await fetch(
        `${server.baseURL}/api/flows/chain?t=${symbol}&strategy=both&rank=yieldOnCollateral`,
        { headers: { Cookie: `flows_session=${token}`, Accept: "application/json" } });
      ok(r.ok, `the chain route answers for ${symbol} (${r.status})`);
      return r.json();
    };
    const expected = new Map();
    for (const symbol of ["AAA", "BBB"]) {
      const payload = await chainOf(symbol);
      for (const row of payload.rows || []) {
        expected.set(`${row.ticker}|${row.strike}|${row.strategy}`, sizeToBuyingPower(row, BP));
      }
    }
    ok(expected.size >= 3, `the fixture priced enough lines to size (${expected.size})`);

    /* ---- the column exists only once a balance does ---- */
    eq(await page.locator("#deskCollectHead").isHidden(), true,
       "no Collect column before a buying power is entered");
    eq(await page.locator("#deskPlan").isHidden(), true, "and no plan line");

    const chainRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/flows/chain")) chainRequests.push(req.url());
    });

    const callsBefore = upstreamCalls;
    await page.fill("#deskBP", "10,000");
    await page.waitForFunction(
      () => !document.getElementById("deskCollectHead").hidden, null, { timeout: 5000 });
    eq(upstreamCalls, callsBefore,
       "sizing to a balance spends no vendor call — it is arithmetic on rows already here");
    eq(chainRequests.length, 0, "and issues no request at all");

    /* ---- every Collect cell matches the shared module ---- */
    const collectIdx = await page.evaluate(() => {
      const heads = Array.from(document.querySelectorAll(".desk-table thead th:not([hidden])"));
      return heads.findIndex((h) => /Collect/.test(h.textContent)) - 1;
    });
    ok(collectIdx >= 0, "the Collect column is drawn");

    const seen = [];
    for (const tr of await page.locator("#deskBody tr").all()) {
      const ticker = (await tr.locator("th").textContent()).trim();
      /* THE FIRST TEXT NODE, not the cell's whole textContent. The strike cell
         carries a second line saying how far the strike is from spot, so
         Number() over the whole cell reads "47.00−7.8% OTM" and answers NaN —
         which then silently failed the payload lookup below rather than the
         strike read above it. Reading the leading node also asserts the thing
         that matters: the strike stays the cell's primary value and the
         distance is an annotation under it. */
      const strike = Number(await tr.locator("td").nth(1)
        .evaluate((td) => (td.firstChild ? td.firstChild.textContent : "").trim()));
      const side = (await tr.locator("td.c-side").textContent()).trim();
      const strategy = side === "Covered call" ? "cc" : "csp";
      const cell = tr.locator("td").nth(collectIdx);
      const text = (await cell.textContent()).trim();
      const want = expected.get(`${ticker}|${strike}|${strategy}`);
      ok(want !== undefined, `the browser row ${ticker} ${strike} came from the Worker's payload`);
      seen.push({ ticker, strike, text, want });

      if (!want.affordable) {
        /* $0 IS A READING. A blank or a dash here would say "not measured",
           and what is true is "one contract costs more than the account". */
        eq(text, "$0", `${ticker} ${strike} collects nothing at $${BP}`);
        ok(await cell.evaluate((el) => el.classList.contains("is-unaffordable")),
           "and the cell is marked as a verdict rather than a figure");
        const title = await cell.getAttribute("title");
        ok(title && /more than/.test(title),
           `and says by how much it misses (${title})`);
      } else {
        const dollars = "$" + Math.round(want.collectible).toLocaleString("en-US");
        eq(text, `${dollars} (${want.contracts}\u00d7)`,
           `${ticker} ${strike} collects what sizeToBuyingPower() says it does`);
        const title = await cell.getAttribute("title");
        ok(title && title.includes("$" + Math.round(want.deployed).toLocaleString("en-US")),
           "and the tooltip names the capital it deploys");
        ok(title && title.includes("$" + Math.round(want.idle).toLocaleString("en-US")),
           "and what it leaves idle — the number a yield percentage hides");
      }
    }
    ok(seen.some((r) => !r.want.affordable), "the fixture contains an unaffordable line");
    ok(seen.some((r) => r.want.affordable && r.want.contracts > 1),
       "and one the account can buy more than once");

    /* ---- the plan line ---- */
    const plan = await page.locator("#deskPlan").textContent();
    ok(/\$10,000 buying power/.test(plan), `the plan states the balance (${plan})`);
    ok(/best single deployment: 2\u00d7 AAA 47\.00 cash-secured put/.test(plan),
       `and names the best line, not the highest yield (${plan})`);
    ok(/collects \$380/.test(plan), "with what it collects");
    ok(/leaving \$600 idle/.test(plan),
       "and the idle cash, which is the cost integer division imposes");

    /* ---- ranking by what this account collects ---- */
    const orderNow = async () =>
      (await page.locator("#deskBody th").allTextContents()).map((t) => t.trim());
    assert.deepEqual(await orderNow(), ["AAA", "BBB", "AAA"],
      "before the switch the table is ranked by the default key"); checks++;

    await page.selectOption("#deskRank", "collectible");
    /* The wait is SWALLOWED so the assertion below is what reports. A bare
       waitForFunction turns the clearest possible failure — a table in the
       wrong order — into a bare TimeoutError naming a line number and no
       ordering at all. The wait is here to avoid a race, not to be the test. */
    await page.waitForFunction(() => {
      const t = document.querySelectorAll("#deskBody th");
      return t.length === 3 && t[1].textContent.trim() === "AAA";
    }, null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await orderNow(), ["AAA", "AAA", "BBB"],
      "ranking by premium collectible sinks the line this account cannot buy"); checks++;
    eq(upstreamCalls, callsBefore, "and re-ranking still spends no vendor call");

    /* ---- the server rank the client asks for ---- */
    {
      /* "collectible" cannot be a server rank: it depends on a balance the
         Worker deliberately never learns. Yield on collateral is its proxy,
         exact to within one contract's premium, and it is what decides which
         120 rows survive truncation. Asking for a key the API does not have
         would silently fall back to the default and truncate the wrong slice. */
      chainRequests.length = 0;
      await page.click("#deskRefresh");
      await page.waitForFunction((n) => n > 0, chainRequests.length, { timeout: 100 })
        .catch(() => {});
      await page.waitForTimeout(400);
      ok(chainRequests.length > 0, "Refresh does go back to the route");
      for (const url of chainRequests) {
        const rank = new URL(url).searchParams.get("rank");
        eq(rank, "yieldOnCollateral",
           `a collectible ranking asks the API for its proxy, not for a key it lacks (${rank})`);
      }
    }

    /* ---- the balance survives a reload, and says that it does ---- */
    {
      const u = new URL(page.url());
      eq(u.searchParams.get("bp"), "10000", "the balance is held in the URL like the rest of the desk");
      const help = await page.locator("#deskBPHelp").textContent();
      ok(/link you share carries it too/.test(help),
         "and the page says so, because an account size in a shared link is not a surprise anyone should get");
    }

    /* ---- an unreadable balance is marked, not swallowed ---- */
    {
      await page.fill("#deskBP", "25.000.00");
      await page.waitForFunction(
        () => document.getElementById("deskBP").getAttribute("aria-invalid") === "true",
        null, { timeout: 3000 });
      eq(await page.locator("#deskCollectHead").isHidden(), true,
         "an unparseable balance sizes nothing");
      ok(await page.locator("#deskBP").evaluate((el) => el.classList.contains("is-invalid")),
         "and the field says it is the input that is wrong, not the desk");
      /* The rank had nowhere to go, so it must not stay pointing at a key
         nothing can compute. */
      eq(await page.locator("#deskRank").inputValue(), "annualized",
         "and the collectible ranking falls back rather than sorting by nothing");

      await page.fill("#deskBP", "25k");
      await page.waitForFunction(
        () => !document.getElementById("deskCollectHead").hidden, null, { timeout: 3000 });
      eq(new URL(page.url()).searchParams.get("bp"), "25000",
         "shorthand is accepted and normalised — 25k is a balance a person types");
    }
  }

  /* ---------- the pane resizes, including from the keyboard ------ */
  {
    /* A native `resize: both` corner would cover the pointer and nothing else.
       These three grips exist because a keyboard cannot reach that corner and
       a screen reader is never told the pane is resizable at all. */
    for (const id of ["deskGripX", "deskGripY", "deskGripXY"]) {
      eq(await page.locator("#" + id).getAttribute("tabindex"), "0",
         `${id} is reachable by keyboard`);
    }
    eq(await page.locator("#deskGripX").getAttribute("aria-orientation"), "vertical",
       "the width grip is announced as a vertical separator");
    eq(await page.locator("#deskGripY").getAttribute("aria-orientation"), "horizontal",
       "and the height grip as a horizontal one");

    /* THE CORNER BORROWS NO ROLE. It answers arrow keys, and every role that
       fits its shape promises something else: button promises Enter and Space,
       separator carries a single orientation, slider is one-dimensional. A
       focusable element whose label states the interaction is honest where a
       borrowed role is a promise the handle breaks. */
    eq(await page.locator("#deskGripXY").getAttribute("role"), null,
       "the corner claims no role it cannot honour");
    const cornerLabel = await page.locator("#deskGripXY").getAttribute("aria-label");
    ok(cornerLabel && /arrow keys/i.test(cornerLabel),
       `and its label says how to work it (${cornerLabel})`);

    const size = () => page.evaluate(() => ({
      w: Math.round(document.getElementById("deskPane").getBoundingClientRect().width),
      h: Math.round(document.getElementById("deskTableWrap").getBoundingClientRect().height),
    }));

    const before = await size();
    await page.focus("#deskGripX");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    const narrower = await size();
    ok(narrower.w < before.w,
       `the arrow keys narrow the pane (${before.w} -> ${narrower.w})`);
    eq(narrower.h, before.h, "and leave the height alone");

    /* OFF THE FLOOR BEFORE ASKING IT TO SHRINK. A three-row table's natural
       height lands within a pixel or two of the 160px minimum, so "press
       ArrowUp and check it got shorter" was asking a pane already AT its floor
       to go below it — an assertion that passed or failed on where the last
       row's baseline happened to land, and did both across consecutive runs of
       an unchanged file. Growing it one step first makes the shrink a real
       measurement rather than a coin toss, and the floor itself is asserted
       explicitly further down. */
    /* AND OFF THE CEILING BEFORE ASKING IT TO GROW, which is the same defect
       on the other end and arrived the day the rows grew a second line. maxH()
       is the viewport less everything above the pane, and a three-row table
       whose rows each carry a sub-line — the strike's distance from spot, the
       yield's collateral — is now naturally TALLER than that, so the pane opens
       already clamped at its maximum. "Press ArrowDown and check it got taller"
       was then asking a pane at its ceiling to go above it, and it measured the
       clamp rather than the grip. Step down twice first so the growth is real. */
    await page.focus("#deskGripY");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    const squat = await size();
    await page.keyboard.press("ArrowDown");
    const taller = await size();
    ok(taller.h > squat.h, `the height grip grows the pane (${squat.h} -> ${taller.h})`);
    await page.keyboard.press("ArrowUp");
    const shorter = await size();
    ok(shorter.h < taller.h, `and the height grip shortens it (${taller.h} -> ${shorter.h})`);

    /* THE CORNER IS BOTH AT ONCE, which is the whole reason it exists. */
    await page.focus("#deskGripXY");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const bigger = await size();
    ok(bigger.w > shorter.w && bigger.h > shorter.h,
       `the corner moves both axes (${shorter.w}x${shorter.h} -> ${bigger.w}x${bigger.h})`);

    /* A FLOOR, or the reader can drag the table out of existence and has no
       way back to it. */
    await page.focus("#deskGripX");
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
    const floor = await size();
    ok(floor.w >= 320, `the pane cannot be collapsed past a usable width (${floor.w}px)`);

    /* And the way back. */
    eq(await page.locator("#deskGripReset").isHidden(), false,
       "a resized pane offers to go back");
    await page.click("#deskGripReset");
    const restored = await size();
    ok(restored.w > floor.w, `Reset restores the pane (${floor.w} -> ${restored.w})`);
    eq(await page.locator("#deskGripReset").isHidden(), true,
       "and the offer withdraws once there is nothing to restore");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1);
    eq(overflow, false, "a fourteen-column desk still overflows nothing at 1440px");

    await page.setViewportSize({ width: 390, height: 900 });
  }

  /* ---------- the implied volatility surface --------------------

     Every contract the chain route returns has always carried a quoted
     implied volatility beside its strike and its expiry, and the page spent
     all of it on the cushion column and dropped the rest. This block drives
     the surface those numbers describe through a real browser: the smile down
     a column, the term structure across the strip, the columns that have no
     level and must say so, and the unit convention that decides whether every
     number on the chart is right or exactly a hundred times wrong. */
  {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.baseURL + "/flows/desk/?t=CCC,DDD&strategy=both&rank=annualized",
      { waitUntil: "domcontentloaded" });
    await settle(3);
    await page.waitForFunction(
      () => document.querySelectorAll("#deskSurface .ivs-cell").length > 0,
      null, { timeout: 10000 });

    /* Everything the chart says, read out of the DOM rather than off a
       screenshot. The <title>s hang on wrapping groups precisely so these
       textContents are the labels and not the labels plus their prose. */
    const readSurface = () => page.evaluate(() => {
      const q = (sel) => Array.from(document.querySelectorAll("#deskSurface " + sel));
      const svg = document.querySelector("#deskSurface .ivs");
      return {
        symbol: document.getElementById("deskSurfaceSymbol").value,
        cells: q(".ivs-cell").map((el) => ({
          expiry: el.getAttribute("data-expiry"),
          strike: Number(el.getAttribute("data-strike")),
          iv: Number(el.getAttribute("data-iv")),
          skew: el.getAttribute("data-skew"),
          traded: el.getAttribute("data-traded"),
          crowd: Number(el.getAttribute("data-crowd")),
          dash: el.getAttribute("stroke-dasharray"),
          fill: el.getAttribute("fill"),
          opacity: Number(el.getAttribute("fill-opacity")),
        })),
        numbers: q(".ivs-iv").map((t) => t.textContent),
        levels: q(".ivs-level").map((t) => t.textContent),
        columns: q(".ivs-exp").map((t) => ({
          text: t.textContent, crosses: t.classList.contains("crosses-earnings"),
        })),
        rowLabels: q(".ivs-m").map((t) => t.textContent),
        voids: q(".ivs-void").length,
        hatches: q(".ivs-hatch").length,
        clips: q(".ivs-clip").length,
        dots: q(".ivs-dot").length,
        termLines: q(".ivs-termline").length,
        note: (document.querySelector("#deskSurface .desk-surface__note") || {}).textContent || "",
        aria: svg ? svg.getAttribute("aria-label") : null,
        svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
        viewW: svg ? Number((svg.getAttribute("viewBox") || "").split(/\s+/)[2]) : 0,
      };
    });

    const ccc = await readSurface();
    eq(ccc.symbol, "CCC", "the surface opens on the first symbol on the desk");
    eq(ccc.columns.length, 3, "one column per expiry on the chain");
    eq(ccc.cells.length, 16, "sixteen contracts are placed on the grid");

    /* ---- THE SMILE, down one column ---- */
    {
      /* The front expiry's cells, lowest strike first — the order a smile is
         actually read in. */
      const front = ccc.cells
        .filter((c) => c.expiry === "2026-09-18")
        .sort((a, b) => a.strike - b.strike)
        .map((c) => Number((c.iv * 100).toFixed(1)));
      assert.deepEqual(front, [46, 38, 32, 30.5, 31, 35, 41],
        "the front expiry's smile is drawn contract by contract, not flattened to its level"); checks++;
      const low = Math.min(...front);
      const at = front.indexOf(low);
      ok(at > 0 && at < front.length - 1,
         `and it bottoms strictly INSIDE the strike range (${front.join(" ")}) — a monotone skew cannot represent this chain`);
      ok(front[0] > low && front[front.length - 1] > low,
         "rising into both wings, which is the shape a seller is choosing between");
    }

    /* ---- THE TERM STRUCTURE, across the strip ---- */
    {
      assert.deepEqual(ccc.levels, ["30.5", "—", "24.0"],
        "the at-the-money level is published per expiry — the term structure, read left to right"); checks++;
      eq(ccc.levels[0], "30.5",
         "the front level is the 102 call's, which TRADED today — not the 30.0 of the 100 that sits exactly at the money and has not");
      ok(/30\.5/.test(ccc.note) && /24\.0/.test(ccc.note),
         "and the levels are repeated in text, where a strip of dots is unreadable");

      /* THE LINE MUST NOT BRIDGE A MISSING LEVEL. Joining 09-18 to 12-18
         across an expiry with no at-the-money print would draw a level
         straight through the gap, which is an interpolation — the invented
         number this desk does not publish. */
      eq(ccc.dots, 2, "each measurable level is a dot on the term strip");
      eq(ccc.termLines, 0,
         "and the line does NOT bridge the expiry between them — a bridged segment would be an interpolated level");
    }

    /* ---- AN EXPIRY WITH NO LEVEL SAYS SO ---- */
    {
      const middle = ccc.cells.filter((c) => c.expiry === "2026-10-16");
      ok(middle.length >= 3, "the expiry nobody traded near the money is still on the chart");
      ok(middle.every((c) => c.skew === ""),
         "with every cell carrying NO skew rather than a zero one — an unknown place on the smile is not the middle of it");
      ok(middle.every((c) => c.fill === "none"),
         "so those cells are drawn hollow rather than shaded as if they sat at the money");
      ok(middle.every((c) => c.iv > 0),
         "while still showing the volatility that was actually quoted, which is an observable either way");
      ok(/nearest contract that traded today is 24\.8%/.test(ccc.note),
         `and the page says exactly why that column has no level (${ccc.note.slice(0, 40)}…)`);
      ok(/does not bridge/.test(ccc.note),
         "and that the term-structure line refuses to cross it");
    }

    /* ---- STALE PRINTS ARE MARKED, AND THE MARK IS NOT A COLOUR ---- */
    {
      const stale = ccc.cells.filter((c) => c.traded === "false");
      eq(stale.length, 3, "three contracts on this chain have not traded today");
      ok(stale.every((c) => c.dash === "3 2"),
         "each is drawn with a BROKEN border — a form, so it survives a greyscale print and a colour-blind reader");
      const fresh = ccc.cells.filter((c) => c.traded === "true");
      ok(fresh.length > 0 && fresh.every((c) => c.dash === null),
         "and a contract that traded today carries no such border, or the mark would mean nothing");
      ok(/LAST TRANSACTION/.test(ccc.note),
         "the note says this vendor's implied volatility is a fill and not a quote");
      ok(/13 of 16 cells traded today/.test(ccc.note),
         `and how much of the surface is today's (${(ccc.note.match(/\d+ of \d+ cells traded today/) || [])[0]})`);
      ok(/NONE of them set an expiry's level/.test(ccc.note),
         "and that a stale print never sets a level — a stale cell is one marked number, a stale level tilts a whole column with no marker on it");
    }

    /* ---- SIGN IS CARRIED BY A HATCH, NOT BY HUE ---- */
    {
      const negative = ccc.cells.filter((c) => c.skew !== "" && Number(c.skew) < 0);
      eq(negative.length, 1, "one contract on this chain is quoted BELOW its own expiry's at-the-money vol");
      eq(negative[0].strike, 110, "the back 110 call");
      eq(ccc.hatches, 1,
         "and it is HATCHED — the sign survives a greyscale render and a deuteranope reader, which a diverging hue does not");
      ok(/hatched below it/.test(ccc.note), "the note says what the hatch means");
    }

    /* ---- the cap is a cap, and the cells past it say so ---- */
    {
      eq(ccc.clips, 2, "two cells run past the shade cap and are marked with a slash");
      ok(/capped at/.test(ccc.note), "rather than being flattened silently against everything else");
    }

    /* ---- a cell is one quoted contract, never an average ---- */
    {
      const crowded = ccc.cells.filter((c) => c.crowd > 1);
      eq(crowded.length, 1, "the 100 and 102 calls fall in the same band of the same column");
      eq(crowded[0].strike, 102,
         "and the cell shows the 102 — today's print — not the 30.25 average of the two quotes");
      ok(/never an average/.test(ccc.note), "and the page says a cell is never an average");
    }

    /* ---- the axis is stated, and the money is a row ---- */
    {
      ok(ccc.rowLabels.includes("ATM"), "the at-the-money band is labelled as such");
      ok(/log-moneyness/.test(ccc.note) && /bands 5\.0% wide/.test(ccc.note),
         `the note states the axis and the band width it chose (${(ccc.note.match(/bands [\d.]+% wide/) || [])[0]})`);
      ok(ccc.rowLabels.some((t) => t.indexOf("−") === 0),
         "and a negative row label uses U+2212, not a hyphen");
    }

    /* ---- the surface is taken BEFORE the sale gates ---- */
    {
      ok(/before the liquidity gates/.test(ccc.note) && /regardless of the Sell toggle/.test(ccc.note),
         "the page says the surface is not the table — the gates fall hardest on the wings, and a smile with its tails cut off is a different smile");
    }

    /* ---- the earnings column, which is what a term structure is read WITH ---- */
    {
      const crossing = ccc.columns.filter((c) => c.crosses);
      eq(crossing.length, 1, "one expiry outlives the 11-05 report");
      ok(/12-18/.test(crossing[0].text), "and it is the back one");
      ok(crossing[0].text.includes("⚠"),
         "marked with a glyph, so it survives a greyscale render");
    }

    /* ---- nothing is modelled, and the page says so ---- */
    {
      ok(/Nothing here is fitted, interpolated or repriced/.test(ccc.note),
         "the surface states that it publishes quoted volatilities and differences of them, and nothing that needs a rate");
      ok(/reads as a fraction/.test(ccc.note),
         `and carries the evidence for the units it is in (${(ccc.note.match(/median [\d.]+ reads as [a-z ]+/) || [])[0]})`);
      ok(ccc.aria && /At-the-money implied volatility by expiry/.test(ccc.aria),
         "and the chart has a text alternative that carries the term structure");
    }

    /* ---- THE UNIT TRAP, END TO END -------------------------------
       DDD is CCC with every implied volatility multiplied by a hundred, which
       is the other convention this vendor uses and does not flag. ivConvention
       decides the divisor once per chain from the median; priceSale applies
       it; the surface reads the divided field and no raw one. If any link in
       that chain broke, DDD would render a surface a hundred times CCC's — and
       it would render perfectly, with nothing on the page to reveal which one
       the reader was looking at. */
    {
      await page.selectOption("#deskSurfaceSymbol", "DDD");
      await page.waitForFunction(
        () => document.getElementById("deskSurfaceSymbol").value === "DDD" &&
              document.querySelectorAll("#deskSurface .ivs-cell").length > 0,
        null, { timeout: 5000 });
      const ddd = await readSurface();

      eq(ddd.cells.length, ccc.cells.length, "the percent-quoted chain places the same cells");
      assert.deepEqual(ddd.levels, ccc.levels,
        "and publishes the IDENTICAL at-the-money levels"); checks++;
      assert.deepEqual(ddd.numbers, ccc.numbers,
        "and the identical volatility in every cell — a chain quoted in percent and one quoted in fractions draw the same surface"); checks++;
      assert.deepEqual(
        ddd.cells.map((c) => `${c.expiry}|${c.strike}|${c.traded}`),
        ccc.cells.map((c) => `${c.expiry}|${c.strike}|${c.traded}`),
        "cell for cell, in the same places"); checks++;
      eq(ddd.hatches, ccc.hatches, "with the same sign on the same cell");
      ok(/reads as percent/.test(ddd.note),
         `and the page names the convention it detected rather than assuming one (${(ddd.note.match(/median [\d.]+ reads as [a-z ]+/) || [])[0]})`);
      ok(ddd.levels[0] === "30.5",
         "30.5, not 3050 and not 0.305 — the level a desk would actually quote");

      /* And the choice is in the URL, like every other piece of desk state. */
      eq(new URL(page.url()).searchParams.get("surface"), "DDD",
         "which surface is on screen travels in the link, like the watchlist and the ranking key");
      await page.selectOption("#deskSurfaceSymbol", "CCC");
    }

    /* ---- it fits, at both widths ---- */
    {
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1);
      eq(wide, false, "the surface overflows nothing at 1440px");

      /* ONE VIEWBOX UNIT IS ONE CSS PIXEL, at both widths. This is the
         assertion that distinguishes a REDRAWN chart from a scaled one, and
         the obvious version — "the svg got narrower" — cannot: the element is
         width:100%, so its rendered box shrinks with the column whether or not
         a single label was recomputed, and every type size shrinks with it
         until nothing is legible. The viewBox is what says the chart was
         rebuilt against the new width. */
      ok(Math.abs(ccc.viewW - ccc.svgW) <= 2,
         `the desk-width chart is built at one viewBox unit per pixel (${ccc.viewW} in ${ccc.svgW})`);
      await page.setViewportSize({ width: 390, height: 900 });
      /* The wait is SWALLOWED so the assertion below is what reports: a chart
         that never redrew should be diagnosed by name, not by a bare timeout. */
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
      const phoneOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1);
      eq(phoneOverflow, false, "and it overflows nothing at 390px either");
    }

    /* ---- and it goes away with the desk ---- */
    {
      await page.click("#deskClear");
      await page.waitForFunction(
        () => document.getElementById("deskSurface").hidden === true, null, { timeout: 5000 });
      eq(await page.locator("#deskSurface").isHidden(), true,
         "clearing the desk clears the surface, rather than leaving the last symbol's chart under an empty table");
      eq(new URL(page.url()).searchParams.get("surface"), null,
         "and drops it from the URL");
    }
  }

  /* ---------- the table is a SLICE, and says which slice --------- */
  {
    /* A ranked list that truncates in silence reads as "this is everything".
       The route keeps the top 120 of each chain; the page printed the count
       BEFORE that slice — "130 sellable" over a table holding 120 — and said
       nothing anywhere about a cut. */
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.baseURL + "/flows/desk/?t=FFF&strategy=csp&rank=annualized",
      { waitUntil: "domcontentloaded" });
    await settle(120);
    eq(await rowCount(), 120, "the route sends its top 120 and the desk draws all of them");

    const note = await page.locator(".desk-chip__note").first().textContent();
    ok(/120 of 130 sellable/.test(note),
       `the chip states what is on the table AND what it was cut from (${note})`);

    const foot = await page.locator("#deskFoot").textContent();
    ok(/130 of 130 quoted contracts are sellable/.test(foot),
       `the screened total is still the chain's (${foot})`);
    ok(/This table is a slice/.test(foot), "the footnote says a cut happened at all");
    ok(/FFF shows its top 120 of 130 sellable lines/.test(foot),
       "and names the symbol, the count kept and the count it was cut from");
    ok(/ranked by annualised yield/.test(foot),
       "and the ordering that decided WHICH 120 — a top 120 by yield is not a top 120 by premium");
    ok(/10 lines below the cut are not on this table/.test(foot),
       "and how many are missing");

    /* ---- a re-rank on a cut symbol cannot be served locally ---- */
    /* THE SECOND <td>, NOT THE SECOND CHILD. The row leads with a <th>, so a
       CSS :nth-child(2) selects the Sell cell and every strike read comes back
       NaN — which does not fail loudly, it just makes every "is a 2000 strike
       on the table" test quietly answer no. */
    const strikes = () => page.evaluate(() =>
      Array.from(document.querySelectorAll("#deskBody tr"))
        .map((tr) => {
          const td = tr.querySelectorAll("td")[1];
          return Number(td && td.firstChild ? td.firstChild.textContent : NaN);
        }));

    const byYield = await strikes();
    ok(byYield.length === 120 && !byYield.some((k) => k >= 2000),
       "ranked by yield, the slice contains none of the ten deep in-the-money lines");

    const asked = [];
    const watchRank = (req) => {
      if (req.url().includes("/api/flows/chain")) asked.push(new URL(req.url()).searchParams.get("rank"));
    };
    page.on("request", watchRank);
    const callsBefore = upstreamCalls;
    await page.selectOption("#deskRank", "premium");
    /* Swallowed, so the assertions below report rather than a bare timeout. */
    await page.waitForFunction(() => Array.from(document.querySelectorAll("#deskBody tr"))
      .some((tr) => {
        const td = tr.querySelectorAll("td")[1];
        return Number(td && td.firstChild ? td.firstChild.textContent : NaN) >= 2000;
      }), null, { timeout: 15000 }).catch(() => {});

    ok(upstreamCalls > callsBefore,
       "a re-rank on a CUT symbol goes back to the chain — the old slice cannot contain the new key's winners");
    ok(asked.includes("premium"), `and asks the route for the key it now wants (${asked.join(",")})`);
    const byPremium = await strikes();
    eq(byPremium.filter((k) => k >= 2000).length, 10,
       "and the ten $500 lines the yield slice never contained are now on the table");
    ok(byPremium.slice(0, 10).every((k) => k >= 2000),
       "at the top of it, which is what ranking by premium received means");
    page.off("request", watchRank);

    /* The negative control is already in this file: switching the key on the
       AAA/BBB desk, where nothing was cut, spends no vendor call. Both halves
       of the condition are therefore exercised. */

    /* ---- every row says what it ties up and how far out it is ---- */
    {
      /* No buying power is entered on this desk, which is the point: the
         collateral used to live only in the Collect tooltip, and that column
         does not exist until a balance does. So a reader with no balance typed
         saw a 4.2% yield and was never told the line reserves $44,300. */
      eq(await page.locator("#deskBP").inputValue(), "", "no balance is entered here");
      eq(await page.locator("#deskCollectHead").isHidden(), true, "so there is no Collect column");

      const idx = await page.evaluate(() => {
        const heads = Array.from(document.querySelectorAll(".desk-table thead th:not([hidden])"));
        return {
          strike: heads.findIndex((h) => /Strike/.test(h.textContent)) - 1,
          yield: heads.findIndex((h) => h.textContent.trim() === "Yield") - 1,
        };
      });
      ok(idx.strike >= 0 && idx.yield >= 0, "the Strike and Yield columns are found by header");

      const cells = await page.evaluate((at) =>
        Array.from(document.querySelectorAll("#deskBody tr")).map((tr) => {
          const tds = tr.querySelectorAll("td");
          const sub = (td) => {
            const span = td.querySelector("span");
            return span ? { text: span.textContent, title: span.title } : null;
          };
          const lead = (td) => (td.firstChild ? td.firstChild.textContent : "");
          return {
            strike: Number(lead(tds[at.strike])),
            away: sub(tds[at.strike]),
            yieldText: lead(tds[at.yield]),
            ties: sub(tds[at.yield]),
          };
        }), idx);

      ok(cells.every((c) => c.away && c.ties),
         "every row carries both annotations, with no balance and no hover");
      ok(cells.every((c) => /%$/.test(c.yieldText.trim())),
         "the yield keeps its unit");

      /* THE COLLATERAL IS THE YIELD'S DENOMINATOR AND IT MATCHES THE ROW. A
         cash-secured put reserves the strike times a hundred; if these two
         ever disagree the page is printing a percentage of one number beside
         a different one. */
      for (const c of cells) {
        const want = "on $" + (c.strike * 100).toLocaleString("en-US");
        eq(c.ties.text, want, `strike ${c.strike} states the collateral it reserves`);
      }
      ok(cells.every((c) => /cash-secured put ties up/.test(c.ties.title)),
         "and says which collateral it is — cash for a put, shares for a call");

      /* OTM AND ITM ARE BOTH ON THIS TABLE, and the word is not the sign: a
         put below spot and a call above it are both out of the money, so a
         renderer that only printed a signed distance could not say which. */
      const otm = cells.filter((c) => / OTM$/.test(c.away.text));
      const itm = cells.filter((c) => / ITM$/.test(c.away.text));
      eq(itm.length, 10, "the ten puts struck above spot are marked in the money");
      ok(otm.length >= 100, "and the cheap ones below spot are marked out of it");
      ok(itm.every((c) => c.strike >= 2000), "the ITM mark is on the strikes above spot");
      ok(otm.every((c) => c.strike < 1000), "and the OTM mark on the ones below it");
      const deep = itm.find((c) => c.strike === 2000);
      ok(deep && deep.away.text === "100.0% ITM",
         `the distance is a percentage of spot, with its unit (${deep && deep.away.text})`);
      ok(deep && /below|above/.test(deep.away.title),
         "and the title says which side of spot, in words");

      /* ---- and the symbol is a door, not a label ---- */
      const href = await page.locator("#deskBody th a").first().getAttribute("href");
      eq(href, "/flows/ticker/?t=FFF",
         "the symbol links to the analysis page, the way every other Flows surface does");
      eq((await page.locator("#deskBody th").first().textContent()).trim(), "FFF",
         "and the cell still reads as the ticker alone — the link is the text, not an appended glyph");
      const linkTitle = await page.locator("#deskBody th a").first().getAttribute("title");
      ok(linkTitle && /today's board/.test(linkTitle),
         "and says before the click that a name off the board has no card there");
    }

    /* ---- what stays put while the rows scroll ---- */
    {
      /* The desk had one sticky block, written as a one-off in the stylesheet:
         the symbol column, pinned left. The same sentence is true of the header
         row on the other axis, and of the controls on the page — and neither
         was done. A row whose header has scrolled off is a row of numbers about
         nothing, exactly like a row whose symbol has. */
      const style = await page.evaluate(() => {
        const heads = Array.from(document.querySelectorAll(".desk-table thead th"));
        const controls = document.querySelector(".desk-controls");
        const cs = (el) => getComputedStyle(el);
        return {
          positions: heads.map((h) => cs(h).position),
          tops: heads.map((h) => cs(h).top),
          firstLeft: cs(heads[0]).left,
          controls: controls
            ? { position: cs(controls).position, top: cs(controls).top,
                background: cs(controls).backgroundColor }
            : null,
        };
      });
      ok(style.positions.every((p) => p === "sticky"), "every header cell is pinned");
      ok(style.tops.every((t) => t === "0px"), "to the top of the scroller");
      eq(style.firstLeft, "0px",
         "and the symbol header keeps the left pin the stylesheet gives it — sticky is two axes, not a choice between them");
      ok(style.controls && style.controls.position === "sticky", "the controls stay put too");
      ok(style.controls && parseFloat(style.controls.top) > 0,
         `offset below the fixed top bar rather than underneath it (${style.controls && style.controls.top})`);
      ok(style.controls && !/, 0\)$/.test(style.controls.background),
         `with a ground the rows cannot show through (${style.controls && style.controls.background})`);

      /* AND IT ACTUALLY STICKS. Computed style is the intent; this is the
         behaviour, and the two come apart the moment an ancestor grows an
         overflow or a transform. */
      const stuck = await page.evaluate(() => {
        const wrap = document.getElementById("deskTableWrap");
        wrap.scrollTop = 600;
        wrap.scrollLeft = 260;
        const head = document.querySelector(".desk-table thead th");
        const rowHead = document.querySelector("#deskBody th");
        const box = wrap.getBoundingClientRect();
        return {
          scrolled: wrap.scrollTop,
          headOffset: Math.round(head.getBoundingClientRect().top - box.top),
          symbolOffset: Math.round(rowHead.getBoundingClientRect().left - box.left),
        };
      });
      ok(stuck.scrolled > 0, "the table scrolls inside its pane");
      ok(Math.abs(stuck.headOffset) <= 2,
         `the header row is still at the top of it after scrolling (${stuck.headOffset}px)`);
      ok(Math.abs(stuck.symbolOffset) <= 2,
         `and the symbol column still at the left (${stuck.symbolOffset}px)`);
    }

    await page.setViewportSize({ width: 390, height: 900 });
  }

  /* ---------- five options in the select, four keys on the wire ----

     "Premium collectible" is contracts x premium, and contracts need a balance
     the Worker deliberately never learns, so it is fetched as yield on
     collateral and sorted here. The two are ADJACENT options. The re-rank
     refetch landed without noticing that, so arrowing one step between them
     sent every cut symbol back to the route for a slice that cannot differ by
     so much as a byte — the exact waste the refetch branch was written to
     avoid, committed by the branch itself.

     MEASURED AT THE BROWSER, NOT AT THE STUB UPSTREAM. The route's cache is
     keyed by rank, and this pair shares a rank, so a wasted refetch is a cache
     HIT: upstreamCalls never moves and cannot see the defect. What is spent is
     the round trip, which only the page's own request log records. */
  {
    const twin = await context.newPage();
    twin.on("pageerror", (e) => pageErrors.push(String(e)));
    const asked = [];
    twin.on("request", (req) => {
      if (req.url().includes("/api/flows/chain")) {
        asked.push(new URL(req.url()).searchParams.get("rank"));
      }
    });
    await twin.goto(server.baseURL + "/flows/desk/?t=FFF&strategy=csp&rank=yieldOnCollateral&bp=50000",
      { waitUntil: "domcontentloaded" });
    await twin.waitForFunction(
      () => document.querySelectorAll("#deskBody tr").length === 120, null, { timeout: 20000 });
    eq(asked.length, 1, `the first load asks the route once (${asked.join(",")})`);

    const askedBefore = asked.length;
    await twin.selectOption("#deskRank", "collectible");
    /* Long enough for a refetch to have been issued if one was going to be:
       the request goes out synchronously inside the change handler. */
    await twin.waitForTimeout(500);
    eq(asked.length, askedBefore,
       `switching to the key that maps to the same server rank sends nothing (${asked.join(",")})`);
    eq(await twin.locator("#deskBody tr").count(), 120,
       "and the table is still the slice it already had");
    ok(/ranked by yield on collateral/.test(await twin.locator("#deskFoot").textContent()),
       "the footnote still names the ordering that CHOSE the slice, which is the payload's, not the select's");

    /* THE OTHER HALF OF THE CONDITION, so the assertion above is not passing
       on a page that has simply stopped refetching. One step further down the
       same select is a different server key, and that one does go back. */
    await twin.selectOption("#deskRank", "cushionSigmas");
    await twin.waitForFunction(
      () => /ranked by cushion/.test(document.getElementById("deskFoot").textContent),
      null, { timeout: 20000 });
    eq(asked.length, askedBefore + 1,
       `a key the route ranks differently does go back to it (${asked.join(",")})`);
    eq(asked[asked.length - 1], "cushionSigmas", "under the key the reader now wants");
    await twin.close();
  }

  /* ---------- a slower answer to a question already withdrawn -----

     A <select> fires `change` on every arrow key, and a change on a cut symbol
     now issues a fetch, so three requests for one symbol can be in the air
     under three different keys. They do not come back in the order they were
     sent. Before the sequence guard the last one to ARRIVE won, which is not
     the last one the reader asked for: the table then held a slice the select
     no longer named, under a footnote naming an ordering nobody chose.

     The premium request is held for a second and a half at the browser's
     routing layer so the ordering is decided by this test rather than by the
     loopback's mood. */
  {
    const racer = await context.newPage();
    racer.on("pageerror", (e) => pageErrors.push(String(e)));
    await racer.route("**/api/flows/chain**", async (route) => {
      const rank = new URL(route.request().url()).searchParams.get("rank");
      if (rank === "premium") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await racer.goto(server.baseURL + "/flows/desk/?t=FFF&strategy=csp&rank=annualized",
      { waitUntil: "domcontentloaded" });
    await racer.waitForFunction(
      () => document.querySelectorAll("#deskBody tr").length === 120, null, { timeout: 20000 });

    await racer.selectOption("#deskRank", "premium");
    await racer.selectOption("#deskRank", "cushionSigmas");
    await racer.waitForFunction(
      () => /ranked by cushion/.test(document.getElementById("deskFoot").textContent),
      null, { timeout: 20000 });
    /* Past the held request's arrival, which is the whole point: the assertion
       is about what happens AFTER the superseded answer comes back. */
    await racer.waitForTimeout(2500);
    const foot = await racer.locator("#deskFoot").textContent();
    ok(/ranked by cushion/.test(foot),
       `the superseded premium slice does not overwrite the one the reader asked for (${foot.slice(0, 160)})`);
    ok(!/ranked by premium/.test(foot), "and the footnote names no ordering the select has moved off");
    eq(await racer.locator("#deskRank").inputValue(), "cushionSigmas",
       "the select and the table agree about which question was answered");
    await racer.close();
  }

  /* ---------- a response with no age header is not an age of zero --

     `response.headers.get("X-Chain-Age")` answers null when the header is not
     there, and Number(null) is 0, and Number.isFinite(0) is true — so a body
     of entirely unknown vintage was stored as an age of nought and rendered as
     "just now". This repository's oldest scar, wearing a header for a disguise,
     and worse than usual here because zero is ALSO a real reading: the route
     sends X-Chain-Age: 0 on a cache miss and means measured-fresh.

     The route always sends the header today, so the branch is unreachable from
     the stub — the header is stripped at the browser to reach it, which is
     also exactly what a proxy or a future error path would do. */
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
    await bare.waitForFunction(
      () => /sellable/.test(document.querySelector(".desk-chip__note")?.textContent || ""),
      null, { timeout: 20000 });

    const note = await bare.locator(".desk-chip__note").first().textContent();
    ok(!/just now/.test(note), `an unstated age is not reported as a fresh one (${note})`);
    ok(/age not stated/.test(note),
       `and it is not reported as nothing either — the silence is named (${note})`);
    const status = await bare.locator("#deskStatus").textContent();
    ok(/quote age was not stated by the route/.test(status),
       `the status line says which silence it is too (${status})`);
    ok(!/quotes just now/.test(status), "and does not claim a freshness it never received");
    await bare.close();
  }

  /* ---------- a 200 that did not parse is not a price -------------

     The second of the three silences. An unreadable body landed in the "ok"
     branch with a null payload: the chip drew a checkbox and NO note, the
     table gained no rows, and the status line counted the symbol among those
     priced. Nothing anywhere said the response could not be read, so the desk
     read as a name that simply has nothing to sell — which is the third
     silence, and a completely different statement. */
  {
    const junk = await context.newPage();
    junk.on("pageerror", (e) => pageErrors.push(String(e)));
    await junk.route("**/api/flows/chain**", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "x-chain-age": "0" },
        body: "<!doctype html><title>a captive portal, with a 200 on it</title>",
      });
    });
    await junk.goto(server.baseURL + "/flows/desk/?t=AAA", { waitUntil: "domcontentloaded" });
    /* Swallowed so the assertion below reports what the chip actually said.
       The defect this block exists to catch leaves the note EMPTY forever, and
       a bare wait for it to fill would report only a timeout — which is the
       one thing the reader of a failing suite already knows. */
    await junk.waitForFunction(
      () => {
        const t = document.querySelector(".desk-chip__note")?.textContent || "";
        return t !== "" && !/loading/.test(t);
      }, null, { timeout: 15000 }).catch(() => {});

    const note = await junk.locator(".desk-chip__note").first().textContent();
    eq(note, "unreadable response", `the chip says which silence this is (${note})`);
    const status = await junk.locator("#deskStatus").textContent();
    ok(/AAA unavailable/.test(status),
       `and the desk does not count it among the symbols it priced (${status})`);
    ok(!/1 symbol priced/.test(status), "which is what it used to do");
    await junk.close();
  }

  /* ---------- a payload that cannot state its own counts ----------

     The footnote's totals were accumulated with `isNum(p.screened) || 0`, which
     reads a MISSING count as a count of nought and folds it into a published
     sentence. A payload can lose a field for a dull reason — a body cached by
     an earlier deploy, a shape that moved — and the desk then announced "130 of
     130 quoted contracts are sellable" over a table that also carried two rows
     from a chain neither number counted.

     It also decided the slice's shortfall, which was `priced - shown`: a total
     over every symbol minus a count over every symbol, which agree only while
     every payload states its `priced`. With AAA's counts gone the old
     arithmetic reports EIGHT lines below the cut where the enumerated evidence
     in the same sentence says ten, and with enough uncounted rows it goes
     negative — a count printed with a hyphen on a page that spells minus
     U+2212. The shortfall is now the sum of the per-symbol cuts the sentence
     has just named out loud, which cannot disagree with itself. */
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
      const headers = Object.fromEntries(Object.entries(res.headers())
        .filter(([k]) => k.toLowerCase() !== "content-length"));
      await route.fulfill({ status: res.status(), headers, body: JSON.stringify(body) });
    });
    await thin.goto(server.baseURL + "/flows/desk/?t=FFF,AAA&strategy=csp",
      { waitUntil: "domcontentloaded" });
    await thin.waitForFunction(
      () => document.querySelectorAll("#deskBody tr").length === 121, null, { timeout: 20000 });

    const foot = await thin.locator("#deskFoot").textContent();
    ok(/10 lines below the cut are not on this table/.test(foot),
       `the shortfall is the sum of the cuts the sentence names, not a difference of two whole-desk totals (${foot})`);
    ok(/AAA is outside those two numbers/.test(foot),
       `and the symbol whose counts never arrived is named rather than added as nought (${foot})`);
    ok(/not a count of nought/.test(foot), "in the sentence that says why");
    ok(/130 of 130 quoted contracts are sellable/.test(foot),
       "the totals themselves stay the ones that were actually stated");
    await thin.close();
  }

  /* ---------- the quote age is a function of NOW ------------------

     The file header's oldest promise is that every number says how old it is,
     and the desk broke it in the least visible way: X-Chain-Age was read once
     at fetch, stored on the payload and rendered forever. Every assertion in
     this file above reads the age within a second of the response, so all of
     them passed against a clock that never moved. A desk priced at 09:31 and
     left open still said "just now" at 10:11.

     THE PAGE'S CLOCK IS FAKED, NOT THE TEST'S PATIENCE. Waiting real minutes
     would make this the slowest assertion in the suite and still only prove
     one age. The page polls on a thirty-second interval, so the fake clock has
     to drive the timers too — which is why every wait below is a Node-side
     poll: an in-page waitForFunction would be waiting on a timer this block
     has deliberately stopped. */
  {
    const clockPage = await context.newPage();
    const clockErrors = [];
    clockPage.on("pageerror", (e) => clockErrors.push(String(e)));
    await clockPage.clock.install({ time: new Date("2026-08-25T14:00:00Z") });
    await clockPage.goto(server.baseURL + "/flows/desk/?t=GGG", { waitUntil: "domcontentloaded" });

    const noteText = () => clockPage.evaluate(() => {
      const n = document.querySelector(".desk-chip__note");
      return n ? n.textContent : "";
    });
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

    /* Eleven minutes, which is past the point where this desk stops calling
       the table a price — so one jump proves both that the number moves and
       that the sentence changes. */
    await clockPage.clock.fastForward(11 * 60 * 1000);
    const aged = await until((t) => /sellable/.test(t) && !/just now/.test(t),
      "the printed age to advance");
    ok(/11m ago/.test(aged),
       `eleven minutes later the chip says eleven minutes, with no keystroke in between (${aged})`);

    const status = await clockPage.locator("#deskStatus").textContent();
    ok(/quotes 11m ago/.test(status), `and so does the status line (${status})`);
    ok(/older than this desk will call a price/.test(status),
       "which stops claiming a freshness it cannot have, and says what to press");

    eq(clockErrors.length, 0, `nothing threw on the ticking desk (${clockErrors[0] || ""})`);
    await clockPage.close();
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
    `a desk sized to a real balance and checked against the module that defines the sizing, ` +
    `a pane three grips and a keyboard can resize, an implied volatility surface whose ` +
    `smile, term structure, stale prints and unit convention are each read out of the DOM, ` +
    `a top-120 slice that names its cut and refetches rather than re-sorting it, rows that ` +
    `state their collateral and their distance from spot without a balance or a hover, ` +
    `a header and a control bar that stay put while the rows scroll, a quote age ` +
    `driven off a faked clock to prove it advances on its own, two select options that ` +
    `share one key on the wire and cost one round trip between them, a superseded slice ` +
    `that loses to the one the reader actually asked for, and three payloads a stub ` +
    `cannot produce — no age header, no counts, no readable body — each answered with ` +
    `the sentence that says which silence it is`);
} finally {
  await browser.close();
  await server.stop();
  await new Promise((r) => upstream.close(r));
}
