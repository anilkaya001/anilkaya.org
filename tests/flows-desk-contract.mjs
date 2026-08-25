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
       cannot-tell row — the three states that are currently one silence. */
    if (ticker !== "AAA") { res.writeHead(404); res.end("{}"); return; }
    res.writeHead(200);
    res.end(JSON.stringify({ data: {
      next_earnings_date: "2026-09-10", announce_time: "premarket",
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
      const strike = Number((await tr.locator("td").nth(1).textContent()).trim());
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

    await page.focus("#deskGripY");
    await page.keyboard.press("ArrowUp");
    const shorter = await size();
    ok(shorter.h < narrower.h, `and the height grip shortens it (${narrower.h} -> ${shorter.h})`);

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
    `and a pane three grips and a keyboard can resize`);
} finally {
  await browser.close();
  await server.stop();
  await new Promise((r) => upstream.close(r));
}
