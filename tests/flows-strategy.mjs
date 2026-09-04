/* =============================================================
   flows-strategy.mjs — the options strategy tester, end to end.

   /flows/strategy/ is the first page in this section that draws a
   FUNCTION rather than a ranking, and everything that can go wrong
   with it goes wrong quietly. A payoff diagram renders perfectly
   whether or not the arithmetic behind it is right; "unbounded"
   and "$9,500" occupy the same slot and only one of them is ever
   correct; a greek the vendor did not send is a null that
   Number() turns into a confident zero, and a position total built
   from one is a number about a position nobody holds.

   SO THE PAYOFFS ARE HAND-COMPUTED HERE AND WRITTEN OUT IN FULL.
   Every expected figure below is derived in a comment from the
   fixture's own quotes before it is asserted, so a reader can check
   the test rather than trusting it, and so a test that computed its
   expectations with the code under test — which asserts only that
   the code equals itself — is structurally impossible here.

   THE FIXTURE IS INLINE. Nothing is read from tests/.shots-* or any
   other dotted scratch directory: those are gitignored, absent on
   CI, and a suite that depends on one passes locally and fails in
   the runner with a message about a missing file rather than about
   the thing it was testing.

   AND NOTHING HERE WAITS ON A TIMER. Every leg is added by a click
   whose handler runs synchronously inside the dispatch, and every
   fetch is awaited through a selector that only exists once the
   payload has landed. A fixture that depends on one timeout
   outrunning another fails under load and teaches the next reader
   to re-run rather than to look.
   ============================================================= */
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const MINUS = "−";   // U+2212, the real minus this site prints
const DASH = "—";    // U+2014, the one and only "not measured"

/* EVERY TEXT READ GOES THROUGH THIS. The page's prose is indented source, so
   textContent carries the newlines and the leading spaces of the file it was
   written in: "intrinsic\n      value" is one phrase to a reader and two words
   with six spaces between them to a regex. Collapsing runs of whitespace makes
   an assertion about a SENTENCE rather than about how the markup was wrapped —
   which is the difference between a test that survives a re-indent and one
   that has to be edited every time a paragraph is reflowed. */
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/* =============================================================
   THE FIXTURE

   SPOT IS 102 AND NO STRIKE SITS ON IT. A spot equal to a strike
   collapses two rows of the payoff table into one and makes
   "the payoff at spot" and "the payoff at the strike" the same
   assertion, which would hide a renderer that confused them.

   THE QUOTES STRADDLE ROUND MIDS ON PURPOSE: 4.90 / 5.10 is a mid
   of exactly 5.00, so every hand computation below is exact and a
   reader can redo it without a calculator. The marketable basis is
   then a different number by exactly the half-spread, which is what
   makes the basis switch assertable at all.
   ============================================================= */

const SESSION_DAY = "2026-09-04";
const NEAR = "2026-10-16";   // 42 calendar days out
const FAR = "2026-12-18";    // the expiry that overflows the vendor's page
const BROKEN = "2026-11-20"; // the expiry whose read fails

const greeks = (d, g, t, v, r) => ({
  delta: String(d), gamma: String(g), theta: String(t), vega: String(v), rho: String(r),
});

const NEAR_CALLS = [
  /* $100 call: mid 5.00. delta 0.55 -> a one-contract long is 55 share-equivalents. */
  { option_symbol: "AAA261016C00100000", nbbo_bid: "4.90", nbbo_ask: "5.10",
    implied_volatility: "0.30", volume: "100", open_interest: "500",
    ...greeks(0.55, 0.03, -0.05, 0.12, 0.04) },
  /* $110 call: mid 2.00. */
  { option_symbol: "AAA261016C00110000", nbbo_bid: "1.90", nbbo_ask: "2.10",
    implied_volatility: "0.28", volume: "80", open_interest: "400",
    ...greeks(0.30, 0.02, -0.04, 0.10, 0.02) },
  /* $120 call: mid 0.50, AND NOT ONE GREEK. The vendor marks all five nullable
     and its own spec example carries a row exactly like this. Everything this
     suite asserts about withheld totals hangs off this single contract. */
  { option_symbol: "AAA261016C00120000", nbbo_bid: "0.45", nbbo_ask: "0.55",
    implied_volatility: null, volume: "5", open_interest: "20",
    delta: null, gamma: null, theta: null, vega: null, rho: null },
];

const NEAR_PUTS = [
  /* $100 put: mid 5.00. */
  { option_symbol: "AAA261016P00100000", nbbo_bid: "4.90", nbbo_ask: "5.10",
    implied_volatility: "0.31", volume: "60", open_interest: "300",
    ...greeks(-0.45, 0.03, -0.05, 0.12, -0.03) },
  { option_symbol: "AAA261016P00090000", nbbo_bid: "1.40", nbbo_ask: "1.60",
    implied_volatility: "0.35", volume: "10", open_interest: "120",
    ...greeks(-0.20, 0.02, -0.03, 0.08, -0.01) },
];

/* THE OVERFLOWING EXPIRY. The vendor documents `limit` as maximum=500 and its
   own example shows single expiries carrying 12,223 contracts, so a full page
   is the only evidence a caller has that there is another one. Two full pages
   of calls prove the route reports the CUT rather than implying it saw the
   book; three puts prove the report is per side, because a truncated call
   side says nothing at all about the put side. */
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
    /* BETA IS ON THIS ENDPOINT AND WAS BEING DISCARDED. The beta-weighted
       delta below is the reading that could not previously be published for
       want of an observable rather than for want of a parameter. */
    return send(200, { data: {
      next_earnings_date: "2026-11-05", announce_time: "postmarket",
      issue_type: "Common Stock", beta: "1.50",
    } });
  }

  if (url.pathname.endsWith("/expiry-breakdown")) {
    if (ticker === "ZZZ") return send(200, { data: [] });   // read, and empty
    if (ticker === "YYY") return send(500, {});             // did not come back
    return send(200, { data: [
      { expiry: NEAR, chains: 5, open_interest: 1320, volume: 250 },
      { expiry: BROKEN, chains: 10, open_interest: 400, volume: 5 },
      { expiry: FAR, chains: 12223, open_interest: 90000, volume: 40 },
    ] });
  }

  if (url.pathname.endsWith("/option-contracts")) {
    const expiry = url.searchParams.get("expiry");
    const type = url.searchParams.get("option_type");
    const page = Number(url.searchParams.get("page") || "1");
    if (expiry === BROKEN) return send(500, {});
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

const server = await startWorker({
  extraVars: ["UW_API_KEY:test-uw-key", `UW_BASE:${upstreamURL}`],
});
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);

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

  /* Every reading, as {term: {value, hint, cls}}. The hint is the dt's title,
     which is where this page keeps the sentence that says WHY a number is
     what it is — including every "withheld" explanation. */
  const readings = () => page.$$eval("#sgReadings dt", (dts) => {
    const out = {};
    for (const dt of dts) {
      const dd = dt.nextElementSibling;
      out[dt.textContent.trim()] = {
        value: dd ? dd.textContent.trim() : "",
        hint: dt.getAttribute("title") || "",
        cls: dd ? dd.className : "",
      };
    }
    return out;
  });

  const payoffRows = () => page.$$eval("#sgPlot .sg-payoff-t tbody tr", (trs) =>
    trs.map((tr) => ({
      S: tr.children[0].textContent.trim(),
      pnl: tr.children[1].textContent.trim(),
      what: tr.children[2].textContent.trim(),
    })));

  const pnlAt = async (priceLabel) => {
    const rows = await payoffRows();
    const row = rows.find((r) => r.S === priceLabel);
    return row ? row.pnl : null;
  };

  const buy = (expiry, strike, kind) =>
    page.click(`[aria-label="Buy the ${expiry} ${strike} ${kind}"]`);
  const sell = (expiry, strike, kind) =>
    page.click(`[aria-label="Sell the ${expiry} ${strike} ${kind}"]`);
  const clearPosition = () => page.click("#sgClear");

  /* ---------- 1. the page, before anything is asked of it -------- */
  {
    await page.goto(server.baseURL + "/flows/strategy/", { waitUntil: "domcontentloaded" });
    eq(await page.locator("#sgRefusePanel").count(), 1,
       "the refusals panel is in the DOCUMENT rather than in the renderer — it is true " +
       "before any fetch and it is true if every fetch fails");

    const refuse = flat(await page.locator("#sgRefusePanel").textContent());
    /* THE REFUSED READINGS ARE NAMED AS REFUSED. A calculator that silently
       lacks a reading its competitors show reads as an oversight; one that
       says which it will not invent, and why, is making an argument. */
    ok(/Buying power reduction/i.test(refuse) && /Refused/.test(refuse),
       "buying power reduction is named and marked Refused");
    ok(/broker/i.test(refuse) && /28,755/.test(refuse),
       "and the reason is given in full: it is a broker's number, and the vendor's " +
       "specification does not contain the concept anywhere in its 28,755 lines");
    ok(/Conditional value at risk/i.test(refuse) && /distribution/i.test(refuse),
       "conditional value at risk is named and refused for needing a distribution " +
       "nobody quoted");
    ok(/delta .{0,3} beta .{0,3} \(/i.test(refuse) || /not delta times beta/i.test(refuse),
       "and beta-weighted delta is corrected rather than quietly offered as delta x beta");

    const foot = flat(await page.locator(".flows-foot").textContent());
    /* THE STATED CONVENTION IS ON THE PAGE, not only in a comment in the
       module. This is the sentence the whole date-slider decision rests on. */
    ok(/Taylor expansion/i.test(foot),
       "the foot names the engine behind the projected curve: a Taylor expansion in the " +
       "vendor's own greeks");
    ok(/risk-free rate/.test(foot) && /dividend yield/.test(foot),
       "and names the alternative it refused, together with the two free parameters that " +
       "refusing it avoids — the same two shared/flows-chain.js and shared/flows-premium.js " +
       "refuse by name");
    ok(/least accurate/.test(foot) && /near a strike/.test(foot),
       "and states where the approximation is worst rather than leaving a reader to find out");
    ok(/convention/.test(foot) && /convex/.test(foot),
       "monthly decay is labelled a convention and the reason — theta is convex in time — " +
       "is given, the way annualizedIsConvention labels the premium desk's yield");
    ok(/intrinsic value/.test(foot) && /model-free|no volatility/i.test(foot),
       "and the one line that needs nothing is identified as such");

    eq(await page.locator("#sgContextPanel").isHidden(), true,
       "no context panel before a symbol is asked for");
    eq(flat(await page.locator("#sgStatus").textContent()), "Enter a symbol to begin.",
       "and the status invites one");
  }

  /* ---------- 2. the context read ------------------------------- */
  {
    await page.fill("#sgTicker", "aaa");
    await page.click(".sg-load");
    await page.waitForSelector("#sgContextPanel:not([hidden])");

    const facts = await page.$$eval("#sgContext dt", (dts) => {
      const out = {};
      for (const dt of dts) {
        out[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim();
      }
      return out;
    });
    ok(/\$102/.test(facts.Spot) && /live print/.test(facts.Spot),
       `spot is the live print and says so (${facts.Spot}) — the desk's rule, and it matters ` +
       `more here because the diagram's whole x-axis is measured from this number`);
    eq(facts.Session, SESSION_DAY,
       "the session date comes from the tape rather than from the wall clock");
    eq(facts.Beta, "1.50",
       "beta is published. It has been on /info since the desk started calling it and was " +
       "read out of the response and dropped");
    ok(/SPY/.test(facts["Reference index"]) && /\$600/.test(facts["Reference index"]),
       `the reference index is NAMED and priced (${facts["Reference index"]}) — a ` +
       `beta-weighted delta against an unnamed index is a number whose definition was withheld`);
    ok(/2026-11-05/.test(facts["Next earnings"]),
       "and the earnings date rides along, because a contract that outlives a report is a " +
       "different trade at the same premium");

    /* THE UNIVERSE IS DIFFERENT FROM THE DESK'S, AND THAT IS THE WHOLE REASON
       this route exists rather than a parameter on the chain one. The desk
       sends maybe_otm_only and exclude_zero_oi_chains because it screens for
       what can be SOLD; a long in-the-money call is unexpressible in that
       universe, filtered out upstream before any gate here could let it back
       in. Asserted against the requests the stub actually received. */
    const contractCalls = upstreamCalls.filter((u) => u.includes("/option-contracts"));
    ok(contractCalls.length > 0, "the expiry read reached the provider");
    ok(contractCalls.every((u) => /expiry=2026-10-16/.test(u)),
       "every contract request names ONE expiry — the vendor's own documented query " +
       "parameter, and what makes a 12,000-contract book reachable a slice at a time");
    ok(contractCalls.some((u) => /option_type=call/.test(u)) &&
       contractCalls.some((u) => /option_type=put/.test(u)),
       "and splits calls from puts, which halves the population each 500-row page has to " +
       "hold and is what makes two pages enough for almost every listed name");
    ok(contractCalls.every((u) => !/maybe_otm_only|exclude_zero_oi_chains/.test(u)),
       "and sends NEITHER of the premium desk's filters. They screen for what can be sold, " +
       "and a long in-the-money call — the most ordinary position a calculator is asked " +
       "about — does not survive them");

    const opts = await page.$$eval("#sgExpiry option", (os) =>
      os.map((o) => ({ value: o.value, label: o.textContent.trim() })));
    eq(opts.length, 3, "every listed expiry is offered");
    ok(/12223 listed/.test(opts[2].label),
       `THE SIZE OF AN EXPIRY IS IN THE PICKER, BEFORE IT IS READ (${opts[2].label}). The ` +
       `vendor caps a page at 500 and its own example shows single expiries at 12,223, so ` +
       `warning before the read beats confessing after it`);
    ok(/42d/.test(opts[0].label),
       "and each option carries its days to expiry, counted in calendar days from the session");
  }

  /* ---------- 3. the chain, and the contract with no greeks ------ */
  {
    await page.waitForSelector("#sgChainWrap:not([hidden])");
    const rows = await page.$$eval("#sgChainBody tr", (trs) => trs.map((tr) => ({
      cells: [...tr.children].map((c) => c.textContent.trim()),
    })));
    eq(rows.length, 4, "four strikes across the two sides of this expiry");

    /* THE $120 CALL CARRIES NO GREEKS AT ALL. Its delta cell must be an em
       dash: Number(null) is 0 and 0 is a real delta — a contract genuinely
       quoted at zero delta is a deep out-of-the-money contract, which is a
       reading, and it must not be indistinguishable from a field the vendor
       did not send. */
    const row120 = rows.find((r) => r.cells.includes("$120"));
    ok(row120, "the $120 strike renders");
    eq(row120.cells[3], DASH,
       "the delta of a contract the vendor sent no greeks for is an EM DASH, not 0.000 — " +
       "an absent reading and a measured zero are different facts and this page's whole " +
       "discipline is keeping them apart");
    eq(row120.cells[2], DASH,
       "and so is its implied volatility, which is absent on the same row");
    eq(row120.cells[0], "$0.45",
       "while the quote it DOES carry still renders: absence is per field, not per row");

    const note = flat(await page.locator("#sgChainNote").textContent());
    ok(/1 of these contracts carr/.test(note),
       `the count of greek-less contracts is stated up front (${note.slice(0, 120)}…) rather ` +
       `than left for a reader to discover one leg at a time`);
    ok(/Showing 4 of 4 listed strikes/.test(note),
       "and the strike list states what it is showing OF WHAT — a list that truncates " +
       "without saying so reads as a population");
  }

  /* ---------- 4. A LONG CALL. Hand-computed. --------------------
     One $100 call bought at the mid of 4.90/5.10 = 5.00.
       cost      = +1 x 1 x 100 x 5.00           = $500 debit
       P&L(S)    = 100 x max(0, S - 100) - 500
       P&L(0)    = -500        P&L(100) = -500
       P&L(102)  = 200 - 500   = -300
       P&L(105)  = 500 - 500   =    0   -> the breakeven
       max loss  = -500, flat everywhere at or below the strike
       max profit= unbounded: the right-hand slope is +100 per dollar
     ------------------------------------------------------------- */
  {
    await buy(NEAR, "$100", "call");
    await page.waitForSelector("#sgReadings dt");
    const r = await readings();

    eq(r["Net debit"].value, "$500.00", "the net debit is the mid times one hundred shares");
    ok(!r["Net credit"], "and it is called a debit, not a credit — the sign is in the NAME");

    eq(r["Max profit"].value, "unbounded",
       "a long call's maximum profit is UNBOUNDED and is reported as the word. There is no " +
       "number there, so none is printed — the vendor does exactly this for its own detected " +
       "structures");
    ok(/is-unbounded/.test(r["Max profit"].cls),
       "and it is styled as a word rather than as a figure, so it cannot be scanned as one");
    eq(r["Max loss"].value, MINUS + "$500.00",
       "the maximum loss is the whole premium, signed with U+2212");
    ok(/anywhere from \$0 to \$100/.test(r["Max loss"].hint),
       `and it says WHERE as a range rather than a point (${r["Max loss"].hint}) — the loss ` +
       `is flat everywhere at or below the strike, and naming one end of that would be a ` +
       `fact about which candidate a loop visited first`);
    eq(r.Breakeven.value, "$105", "the breakeven is the strike plus the premium");

    eq(await pnlAt("$0"), MINUS + "$500.00", "payoff at zero: the premium, lost");
    eq(await pnlAt("$100"), MINUS + "$500.00", "payoff at the strike: the premium, lost");
    eq(await pnlAt("$102"), MINUS + "$300.00",
       "payoff at spot: $2 of intrinsic on a hundred shares, less the $500 paid");
    eq(await pnlAt("$105"), "$0.00",
       "payoff at the breakeven is a MEASURED zero and prints as one — this page's one " +
       "legitimate $0.00, and it must never be an em dash");

    /* THE POSITION GREEKS, AND THE BETA WEIGHTING DONE PROPERLY.
         delta        = +1 x 1 x 100 x 0.55                     =  55.0 shares
         beta-weighted = 55.0 x 1.50 x (102 / 600)              =  14.025 */
    eq(r["Position delta"].value, "+55.0 share-equivalents",
       "the position delta is signed, multiplied by the hundred shares a contract carries, " +
       "and carries its UNIT — a delta and a dollar sum may not share a name");
    eq(r["Beta-weighted delta"].value, "+14.0 SPY share-equivalents",
       "beta-weighted delta is delta x beta x (this price / the index price) = " +
       "55.0 x 1.50 x (102/600) = 14.025. It is NOT delta x beta, which would have been 82.5");
    ok(/SPY/.test(r["Beta-weighted delta"].hint) && /÷/.test(r["Beta-weighted delta"].hint),
       "and the relation and the index are both stated where the number is printed");
    eq(r["Decay, one day"].value, MINUS + "$5.00 per day",
       "one day of decay is theta times a hundred shares, in dollars per day");
    ok(/convention/.test(r["Decay, thirty days"].value),
       `the thirty-day figure is LABELLED A CONVENTION in the value itself ` +
       `(${r["Decay, thirty days"].value}), not only in a tooltip — thirty times a one-day ` +
       `derivative of a convex function is an extrapolation, and nobody pays it`);
    eq(r["Vega exposure"].value, "+$12.00 per volatility point",
       "vega carries the unit its convention is stated in");
  }

  /* ---------- 5. THE PROJECTION, and the slider's bound ---------- */
  {
    /* At the spot price, one day out, with no volatility shift, the Taylor
       expansion collapses to theta alone:
         dV = 1 x 1 x 100 x (0.55 x 0 + 0 + (-0.05) x 1 + 0.12 x 0) = -5
         P&L = mark + dV - cost = 500 - 5 - 500 = -5 */
    await page.$eval("#sgSceneDays", (n) => {
      n.value = "1";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const scene = await page.$$eval("#sgScene dt", (dts) => dts.map((dt) => ({
      term: dt.textContent.trim(), value: dt.nextElementSibling.textContent.trim(),
      hint: dt.getAttribute("title") || "",
    })));
    const exact = scene.find((s) => /At expiry/.test(s.term));
    const proj = scene.find((s) => /^In 1 day/.test(s.term));
    eq(exact.value, MINUS + "$300.00",
       "the expiry number in the scenario panel agrees with the payoff table at spot — " +
       "one arithmetic, quoted in two places");
    ok(/no model at all/.test(exact.hint),
       "and it says it contains no model, which is the one claim on this page that is free");
    eq(proj.value, MINUS + "$5.00",
       "one day of Taylor at an unchanged price is exactly theta: 100 x -0.05 = -$5.00");
    ok(/convention/.test(proj.hint) && /least accurate/.test(proj.hint),
       "and the projection names itself a convention and says where it is worst");

    const max = await page.$eval("#sgSceneDays", (n) => n.max);
    eq(max, "42",
       "THE SLIDER STOPS AT THE NEAREST EXPIRY (42 calendar days here). Past it the " +
       "expansion is around greeks for a contract that has already settled, so the exact " +
       "line is the answer instead of a confident extrapolation through a settlement");
    const sceneNote = flat(await page.locator("#sgSceneNote").textContent());
    ok(/controls here rather than constants/.test(sceneNote),
       "and the page says that both parameters the projection needs are visible inputs " +
       "rather than constants buried in a module");

    const plotNote = flat(await page.locator("#sgPlotNote").textContent());
    ok(/SOLID line is the payoff at expiry and it is exact/.test(plotNote),
       "the diagram's note separates the exact line from the approximate one");
    ok(/DASHED line is a Taylor expansion/.test(plotNote),
       "and names what the second line is once it is drawn");
    ok(/sign is carried by position, never by colour/.test(plotNote),
       "and states the sign channel: profit above the zero rule, loss below it");
    eq(await page.locator("#sgPlot polyline.sg-payoff").count(), 1, "the expiry line is drawn");
    eq(await page.locator("#sgPlot polyline.sg-proj").count(), 1,
       "and the projected line is drawn beside it");
    eq(await page.locator("#sgPlot line.sg-zero").count(), 1,
       "with the zero rule, which is the axis the sign is read against and is always drawn");

    await page.$eval("#sgSceneDays", (n) => {
      n.value = "0";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /* ---------- 6. A VERTICAL SPREAD. Hand-computed. --------------
     Long the $100 call at 5.00, short the $110 call at 2.00.
       cost      = 500 - 200 = $300 debit
       P&L(S)    = 100 x max(0,S-100) - 100 x max(0,S-110) - 300
       P&L(0)    = -300        P&L(100) = -300
       P&L(102)  = 200 - 300   = -100
       P&L(103)  = 300 - 300   =    0   -> the breakeven
       P&L(110)  = 1000 - 300  = +700   -> and flat above it
       right-hand slope = +100 - 100 = 0, so BOTH ends are bounded
     ------------------------------------------------------------- */
  {
    await sell(NEAR, "$110", "call");
    const r = await readings();
    eq(r["Net debit"].value, "$300.00", "the spread's debit is the difference of the two mids");
    eq(r["Max profit"].value, "+$700.00",
       "a vertical's maximum profit is the width less the debit, and it is a NUMBER — the " +
       "short call caps exactly the ray that made the outright unbounded");
    ok(!/is-unbounded/.test(r["Max profit"].cls),
       "so it is not styled as the word");
    eq(r["Max loss"].value, MINUS + "$300.00", "and the maximum loss is the debit");
    eq(r.Breakeven.value, "$103", "with one breakeven, at the long strike plus the debit");

    eq(await pnlAt("$110"), "+$700.00", "payoff at the short strike is the maximum");
    eq(await pnlAt("$102"), MINUS + "$100.00", "payoff at spot");
    eq(await pnlAt("$103"), "$0.00", "and the breakeven row is a measured zero");

    /* THE BASIS SWITCH MOVES EVERY NUMBER, which is the honest way to show
       what a spread costs. Marketable: pay the 5.10 ask, receive the 1.90 bid.
         cost = 510 - 190 = $320, and the spread crossed is 320 - 300 = $20. */
    await page.selectOption("#sgBasis", "marketable");
    const m = await readings();
    eq(m["Net debit"].value, "$320.00",
       "priced marketable the same spread costs the ask on the buy and pays the bid on the " +
       "sell — twenty dollars more than the mid, which is a real cost the mid hides");
    eq(m["Spread crossed"].value, "$20.00",
       "and the difference is published as its own reading rather than left to be inferred");
    eq(m["Max loss"].value, MINUS + "$320.00", "the whole payoff moves with the basis");
    await page.selectOption("#sgBasis", "mid");
  }

  /* ---------- 7. A NAKED SHORT CALL: unbounded, not a number ----
     Short one $100 call at 5.00.
       cost      = -500  (a credit)
       P&L(0)    = +500        P&L(100) = +500
       P&L(102)  = -200 + 500  = +300
       P&L(105)  = -500 + 500  =    0   -> the breakeven
       right-hand slope = -100 -> the LOSS has no bound
     ------------------------------------------------------------- */
  {
    await clearPosition();
    await sell(NEAR, "$100", "call");
    const r = await readings();
    eq(r["Net credit"].value, "$500.00",
       "a short position opens for a CREDIT and the reading is named for it — a signed " +
       "'net debit of -$500' would make the reader do the sign twice");
    eq(r["Max loss"].value, "unbounded",
       "THE ASSERTION THIS WHOLE SUITE EXISTS FOR: a naked short call's maximum loss is " +
       "unbounded and must be reported as the word, never as a number. A share has no " +
       "upper bound, so there is nothing to print");
    ok(/is-unbounded/.test(r["Max loss"].cls),
       "and it is set as a word so it cannot be read as a figure");
    ok(/net short calls/.test(r["Max loss"].hint) && /no upper bound/.test(r["Max loss"].hint),
       "with the reason attached to the reading rather than to a footnote");
    eq(r["Max profit"].value, "+$500.00", "the maximum profit is the credit received");
    eq(r.Breakeven.value, "$105", "and the breakeven is the strike plus the credit");
    eq(await pnlAt("$102"), "+$300.00", "payoff at spot");
    eq(await pnlAt("$105"), "$0.00", "and zero at the breakeven");
  }

  /* ---------- 8. A NAKED SHORT PUT: bounded, and that is the point
     Short one $100 put at 5.00.
       cost      = -500  (a credit)
       P&L(0)    = -100 x 100 + 500 = -9500   <- FINITE
       P&L(95)   = -500 + 500       =     0   -> the breakeven
       P&L(100)  =    0 + 500       =  +500
       right-hand slope = 0, so nothing here is unbounded at all
     ------------------------------------------------------------- */
  {
    await clearPosition();
    await sell(NEAR, "$100", "put");
    const r = await readings();
    eq(r["Max loss"].value, MINUS + "$9,500.00",
       "A NAKED SHORT PUT'S LOSS IS BOUNDED and this prints the number. It is routinely " +
       "described as unlimited risk and it is not: a share cannot trade below zero, so the " +
       "loss is exactly the strike less the credit");
    ok(/cannot trade below zero/.test(r["Max loss"].hint),
       "and the page says why, at the reading, because the belief it corrects is widespread");
    eq(r["Max profit"].value, "+$500.00", "the maximum profit is the credit");
    eq(r.Breakeven.value, "$95", "and the breakeven is the strike less the credit");
    eq(await pnlAt("$0"), MINUS + "$9,500.00", "the payoff table carries the same figure");
  }

  /* ---------- 9. A NULL-GREEK LEG MUST NOT POISON A TOTAL -------
     Long the $100 call (greeks in full) plus the $120 call (none).
       cost = 500 + 50 = $550 debit — unaffected, because the expiry
       payoff needs no greek at all.
     ------------------------------------------------------------- */
  {
    await clearPosition();
    await buy(NEAR, "$100", "call");
    await buy(NEAR, "$120", "call");
    const r = await readings();

    eq(r["Net debit"].value, "$550.00",
       "the money arithmetic is unaffected by a missing greek: the expiry payoff and " +
       "everything read off it need no greek at all");
    eq(r["Max loss"].value, MINUS + "$550.00", "and the maximum loss still renders as a number");

    /* THE POISONED ANSWER WOULD HAVE BEEN +55.0 — the sum of the legs that DO
       carry a delta, with the null silently counted as zero. That number would
       render perfectly and describe a position nobody holds. */
    eq(r["Position delta"].value, DASH,
       "the position delta is WITHHELD, not summed over the legs that happen to have one. " +
       "The poisoned answer here is +55.0, which renders perfectly and is a confident " +
       "number about a different position");
    ok(/Withheld/.test(r["Position delta"].hint) && /\$120 call/.test(r["Position delta"].hint),
       `and the leg responsible is NAMED (${r["Position delta"].hint.slice(0, 80)}…), because ` +
       `"withheld" without a reason is indistinguishable from a bug`);
    eq(r["Beta-weighted delta"].value, DASH,
       "and everything downstream of the withheld delta is withheld too rather than being " +
       "recomputed from a partial sum");
    eq(r["Decay, one day"].value, DASH, "theta likewise");
    eq(r["Vega exposure"].value, DASH, "and vega");

    const legsNote = flat(await page.locator("#sgLegsNote").textContent());
    ok(/no complete set of greeks/.test(legsNote) && /\$120 call/.test(legsNote),
       "the legs panel names the contract the provider sent no greeks for");
    ok(/expiry payoff is unaffected/.test(legsNote),
       "and says explicitly which readings survive, so a reader does not conclude the " +
       "whole page is broken");

    /* AND NO PROJECTED CURVE, rather than a curve drawn from the legs that
       have greeks — which would be a picture of a different position. */
    await page.$eval("#sgSceneDays", (n) => {
      n.value = "5";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    eq(await page.locator("#sgPlot polyline.sg-proj").count(), 0,
       "no projected line is drawn at all when a leg is missing a greek the expansion needs");
    const plotNote = flat(await page.locator("#sgPlotNote").textContent());
    ok(/No projected line/.test(plotNote) && /different position/.test(plotNote),
       "and the note says so and says why, rather than leaving an absent curve to be read " +
       "as a flat one");
    await page.$eval("#sgSceneDays", (n) => {
      n.value = "0";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clearPosition();
  }

  /* ---------- 10. TRUNCATION IS DISCLOSED, AND PER SIDE ---------- */
  {
    await page.selectOption("#sgExpiry", FAR);
    /* WAIT ON THE ARRIVAL, NOT ON THE ANSWER. The condition below is that the
       far expiry's book has rendered at all — its window holds tens of strikes
       against the near expiry's four — which is true whether or not the
       truncation is disclosed. Waiting for the word "CUT OFF" instead would
       turn a missing disclosure into a twenty-second timeout carrying no
       message about what was actually wrong. */
    await page.waitForFunction(
      () => document.querySelectorAll("#sgChainBody tr").length > 10,
      null, { timeout: 30000 });
    const note = flat(await page.locator("#sgChainNote").textContent());
    ok(/The call side of this expiry is CUT OFF/.test(note),
       "a truncated side is named as truncated. On a ranked table silent truncation is a " +
       "population claim; on a calculator it is worse — the reader's strike is simply not " +
       "there and nothing says a strike is missing");
    ok(/500 contracts/.test(note) && /reads 2 of them per side/.test(note),
       `and the disclosure states the vendor's page limit and how many pages this route ` +
       `reads, so the reader can tell how much is missing (${note.slice(0, 160)}…)`);
    ok(!/Both sides/.test(note),
       "and it is PER SIDE: three puts came back complete, and a truncated call side says " +
       "nothing whatever about the put side");

    const shown = await page.locator("#sgChainBody tr").count();
    ok(shown > 0 && shown < 1000,
       `the strike window cuts the rendered list (${shown} rows of a thousand-contract read)`);
    ok(/Showing \d+ of \d+ listed strikes/.test(note) && /Widen the strike window/.test(note),
       "and that cut is stated with both counts and with the control that undoes it");
  }

  /* ---------- 11. THE THREE SILENCES, THREE SENTENCES ------------ */
  {
    /* (a) THE READ THAT DID NOT COME BACK. */
    await page.selectOption("#sgExpiry", BROKEN);
    await page.waitForSelector('#sgChainNote .flows-empty[data-empty="unreadable"]',
      { timeout: 20000 });
    const broken = flat(await page.locator("#sgChainNote").textContent());
    ok(/did not come back/.test(broken),
       "an expiry whose read failed says the REQUEST failed");
    ok(/not the same as/.test(broken) && /empty/.test(broken),
       `and says in words that this is not the same as the expiry being empty ` +
       `(${broken.slice(0, 140)}…) — the two silences may not share a sentence`);

    /* (b) THE READ THAT SUCCEEDED AND FOUND NOTHING. */
    await page.fill("#sgTicker", "ZZZ");
    await page.click(".sg-load");
    await page.waitForSelector('#sgStatus[data-empty="quiet"]', { timeout: 20000 });
    const quiet = flat(await page.locator("#sgStatus").textContent());
    ok(/lists no option expiries/.test(quiet) && /reading about the name/.test(quiet),
       `a symbol that was read and lists nothing is reported as a READING about the name ` +
       `(${quiet}) — the only one of the three silences that is a fact about the market`);

    /* (c) THE LIST THAT DID NOT COME BACK, with the price that did. */
    await page.fill("#sgTicker", "YYY");
    await page.click(".sg-load");
    await page.waitForSelector('#sgStatus[data-empty="unreadable"]', { timeout: 20000 });
    const dead = flat(await page.locator("#sgStatus").textContent());
    ok(/expiry list did not come back/.test(dead),
       "an expiry list that failed says the LIST failed");
    ok(/price above was read/.test(dead),
       `and distinguishes itself from a whole-symbol failure by naming what DID arrive ` +
       `(${dead}) — the price is on the page and the picker is not`);
    eq(await page.locator("#sgContextPanel").isHidden(), false,
       "the context panel stays, because a spot that was read is still a reading");
  }

  /* ---------- 12. THE POSITION SURVIVES A LINK ------------------- */
  {
    await page.fill("#sgTicker", "AAA");
    await page.click(".sg-load");
    await page.waitForSelector("#sgChainWrap:not([hidden])", { timeout: 20000 });
    await buy(NEAR, "$100", "call");
    await sell(NEAR, "$110", "call");
    const url = page.url();
    /* READ THROUGH URLSearchParams RATHER THAN OFF THE RAW STRING. The browser
       percent-encodes the @ and the comma this encoding uses, so a regex over
       the address bar would be asserting about escaping rather than about the
       position — and would pass or fail on which characters happen to need it. */
    const legs = new URL(url).searchParams.get("legs");
    eq(legs, "AAA261016C00100000@1,AAA261016C00110000@-1",
       "the position lives in the URL, one contract per entry with the SIGN carrying the " +
       "side — the site's storage owner is assets/js/storage.js and a second owner is how " +
       "two of them disagree, and a link is the only form of a position that can be sent " +
       "to anyone");
    ok(!/4\.90|5\.10|500/.test(legs),
       "and it carries no PRICES: a quote is a fact about a moment, and a link opened " +
       "tomorrow that restored today's mid would draw a diagram that was never true");

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sgReadings dt", { timeout: 20000 });
    const r = await readings();
    eq(r["Net debit"].value, "$300.00",
       "and the restored link re-reads the book and prices the same spread at today's quotes");
    eq(r["Max profit"].value, "+$700.00", "with the same bounded maximum");
  }

  /* ---------- 13. it fits a phone -------------------------------- */
  {
    /* THE 320px ZERO-OVERFLOW INVARIANT this section holds everywhere. Two
       eleven-column tables and an SVG sized in CSS pixels are exactly the
       three things that break it, and each of them has to scroll inside its
       own box rather than pushing the document sideways. */
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1);
      eq(over, false, `the strategy tester overflows nothing at ${width}px`);
    }
    const scrolls = await page.evaluate(() => {
      const wrap = document.getElementById("sgChainWrap");
      return { scrollable: wrap.scrollWidth > wrap.clientWidth, focusable: wrap.tabIndex === 0 };
    });
    ok(scrolls.scrollable, "the chain scrolls inside its own box instead");
    ok(scrolls.focusable, "and that scroll is reachable from a keyboard");
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  /* ---------- 14. no page errors anywhere above ------------------ */
  eq(pageErrors.length, 0,
     `no uncaught browser error across every branch above (${pageErrors.join(" | ")})`);

  console.log(`✓ flows-strategy: ${checks} assertions — the payoff at expiry pinned against ` +
    `hand-computed values for a long call, a vertical spread, a naked short call that reports ` +
    `UNBOUNDED and a naked short put that reports a bounded number; a contract with no greeks ` +
    `rendering em dashes and WITHHOLDING every position total it belongs to rather than being ` +
    `summed as zero; the stated Taylor convention and the refused readings both on the page; ` +
    `truncation disclosed per side; and the three silences kept in three sentences`);
} finally {
  await browser.close();
  await server.stop();
  await new Promise((r) => upstream.close(r));
}
