/* End-to-end contracts for the ON-DEMAND chain route, against a real local
   Worker and a stub upstream.

   This route is different in kind from everything else under /api/flows.
   The rest stream a blob the pipeline already computed; this one holds the
   vendor API key and spends it on the request path, because the whole point
   is a ticker nobody chose in advance. That makes three things load-bearing
   which are decoration elsewhere:

     THE GATE, because behind it is a metered credential rather than a
     precomputed board. An unauthenticated hit that reaches the upstream is
     not an information leak, it is somebody else spending money.

     THE CACHE, because it IS the quota control. And a cache in front of a
     gated route is a bypass waiting to happen if its key comes from the
     request rather than from validated parameters.

     THE REFRESH FLOOR, because the user asked for a refresh button and a
     refresh button wired straight through is an unmetered vendor proxy with
     a nice label on it.

   The stub upstream is what makes those testable at all: without it these
   would be three assertions about a 401 and nothing about the behaviour the
   route exists for. */

import assert from "node:assert/strict";
import http from "node:http";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

/* ---------- the stub upstream ---------------------------------- */
let upstreamCalls = 0;
let upstreamMode = "ok";
let pagesAsked = [];
const chainRows = [
  /* the one real line */
  { option_symbol: "AAPL260918P00170000", nbbo_bid: "2.50", nbbo_ask: "2.60",
    implied_volatility: "0.28", open_interest: "1200", prev_oi: "1000", volume: "340" },
  /* a lottery ticket that a naive yield sort would rank first */
  { option_symbol: "AAPL260827P00120000", nbbo_bid: "0.01", nbbo_ask: "0.30",
    implied_volatility: "0.90", open_interest: "11", volume: "2" },
  /* a covered call */
  { option_symbol: "AAPL260918C00190000", nbbo_bid: "3.20", nbbo_ask: "3.35",
    implied_volatility: "0.26", open_interest: "950", volume: "400" },
];
/* Deliberately NOT in date order, and the newest is in the middle: the route
   picks spot by comparing dates, never by trusting an index. */
const candles = [
  { date: "2026-08-20", close: "171.00" },
  { date: "2026-08-24", close: "180.00" },
  { date: "2026-08-21", close: "174.00" },
];

const upstream = http.createServer((req, res) => {
  upstreamCalls++;
  const path = req.url.split("?")[0];
  res.setHeader("Content-Type", "application/json");
  if (upstreamMode === "error") { res.writeHead(500); res.end("{}"); return; }
  if (upstreamMode === "garbage") { res.writeHead(200); res.end("<html>not json</html>"); return; }
  if (upstreamMode === "rate") { res.writeHead(429); res.end("{}"); return; }
  if (path.endsWith("/option-contracts")) {
    const page = Number(new URL(req.url, "http://x").searchParams.get("page") || 1);
    pagesAsked.push(page);
    res.writeHead(200);
    if (upstreamMode === "emptyChain") { res.end(JSON.stringify({ data: [] })); return; }
    /* A FULL PAGE MEANS THERE MAY BE MORE. The vendor caps limit at 500 and
       offers no ordering on this route, so a full page is the only signal that
       the chain was cut. "big" returns two full pages (still truncated);
       "part" returns one full page then a short one (complete). */
    if (upstreamMode === "big" || upstreamMode === "part") {
      const full = Array.from({ length: 500 }, (_, i) => ({
        option_symbol: `PAG260918P${String((100 + i) * 1000).padStart(8, "0")}`,
        nbbo_bid: "2.00", nbbo_ask: "2.05", implied_volatility: "0.30",
        open_interest: "900", volume: "50",
      }));
      if (page >= 2 && upstreamMode === "part") {
        res.end(JSON.stringify({ data: full.slice(0, 3) }));
        return;
      }
      res.end(JSON.stringify({ data: full }));
      return;
    }
    res.end(JSON.stringify({ data: chainRows }));
    return;
  }
  if (path.includes("/ohlc/")) {
    res.writeHead(200);
    res.end(JSON.stringify({ data: upstreamMode === "noSpot" ? [] : candles }));
    return;
  }
  if (path.endsWith("/stock-state")) {
    /* The live print is DELIBERATELY different from the latest daily close
       (183.40 against 180.00). If the route still prices off the candle, every
       moneyness and every covered-call collateral on the page is measured
       against a number nobody can trade at, and the two are indistinguishable
       unless the fixture makes them differ. */
    /* "noSpot" means NO usable price from ANY source. With two price sources
       the case has to fail both, or it only proves the fallback works — which
       is what a separate case below is for. */
    if (upstreamMode === "noState" || upstreamMode === "noSpot") {
      res.writeHead(404); res.end("{}"); return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      close: "183.40", prev_close: "179.10", open: "180.20",
      high: "184.00", low: "179.80", market_time: "regular",
      tape_time: "2026-08-25 18:06:00+00:00", total_volume: 23132119, volume: 12348,
    }));
    return;
  }
  res.writeHead(404); res.end("{}");
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamURL = `http://127.0.0.1:${upstream.address().port}`;

const server = await startWorker({
  extraVars: ["UW_API_KEY:test-uw-key", `UW_BASE:${upstreamURL}`],
});
/* `epoch` is not optional: it is the session revocation lever, and a token
   without it is refused exactly as a token minted before the last bump is. */
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const auth = { Cookie: "flows_session=" + token };
const get = (p, headers) => fetch(server.baseURL + p, { redirect: "manual", headers: { ...auth, ...headers } });
const anon = (p) => fetch(server.baseURL + p, { redirect: "manual" });

/* A marker that appears only in the authenticated desk, never in the login
   page — the single most useful signal for "did the gate leak". */
const DESK_MARKER = 'id="deskBody"';

try {
  /* ---------- the desk PAGE is gated exactly as the board is ------ */
  {
    const res = await anon("/flows/desk/");
    eq(res.status, 200, "an anonymous visitor gets a page, not a 404 — the section is not the secret");
    const body = await res.text();
    ok(!body.includes(DESK_MARKER), "but never the desk itself");
    ok(body.includes('action="/flows/login"'), "they get the sign-in form");
    eq(res.headers.get("cache-control"), "no-store", "gated documents are no-store");

    /* Signed out, the login page must be served AT /flows/desk/ rather than
       redirecting to /flows/ — a redirect sends the user to the board after
       signing in, not back to the desk they asked for. */
    eq(res.status, 200, "and it is served in place rather than bounced to the board");

    const inn = await get("/flows/desk/");
    eq(inn.status, 200, "a signed-in user gets the desk");
    const deskBody = await inn.text();
    ok(deskBody.includes(DESK_MARKER), "which contains the desk table");
    ok(deskBody.includes('href="/flows/"'), "and a way back to the board");

    const canon = await anon("/flows/desk");
    eq(canon.status, 308, "the un-slashed path redirects to the canonical one");
    ok((canon.headers.get("location") || "").endsWith("/flows/desk/"), "to /flows/desk/");

    const post = await fetch(server.baseURL + "/flows/desk/", { method: "POST", headers: auth });
    eq(post.status, 405, "the desk page is GET only");
  }

  /* ---------- the gate is in front of the credential -------------- */
  {
    const res = await anon("/api/flows/chain?t=AAPL");
    eq(res.status, 401, "an anonymous chain lookup is refused");
    eq(upstreamCalls, 0, "and never reaches the upstream — the 401 costs nobody a vendor call");

    const learn = await signSession(
      { sub: "g_test", aud: "learn", exp: Date.now() + 60000 }, SESSION_SECRET);
    const cross = await fetch(server.baseURL + "/api/flows/chain?t=AAPL",
      { headers: { Cookie: "flows_session=" + learn } });
    eq(cross.status, 401, "a learning token does not unlock the chain route either");
    eq(upstreamCalls, 0, "still no vendor call");

    const post = await fetch(server.baseURL + "/api/flows/chain?t=AAPL",
      { method: "POST", headers: auth });
    eq(post.status, 405, "the route is GET only");
  }

  /* ---------- the ticker is validated before anything is spent ---- */
  {
    for (const bad of ["", "../../etc", "aapl!", "TOOLONGTICKERNAME", "%2e%2e"]) {
      const res = await get(`/api/flows/chain?t=${encodeURIComponent(bad)}`);
      eq(res.status, 400, `"${bad}" is refused as a ticker`);
    }
    eq(upstreamCalls, 0, "no malformed ticker ever reached the upstream");
  }

  /* ---------- the happy path ------------------------------------- */
  {
    const res = await get("/api/flows/chain?t=AAPL&refresh=1");
    eq(res.status, 200, "an authenticated lookup succeeds");
    eq(res.headers.get("cache-control"), "no-store",
       "a gated response is never storable by a browser or an intermediary");
    const body = await res.json();

    eq(body.ticker, "AAPL");
    /* THE LIVE PRINT WINS OVER THE DAILY CLOSE. A covered call's collateral is
       the shares at spot and every moneyness is measured from it, so during a
       session the previous close is simply the wrong number. */
    eq(body.spot, 183.4, "spot is the live print, not the latest daily close");
    eq(body.spotSource, "stock-state", "and the payload says which price it used");
    eq(body.marketTime, "regular", "the vendor's session name is passed through verbatim");
    eq(body.prevClose, 179.1, "the previous close ships alongside rather than as spot");
    /* asOf dates the days-to-expiry count, so it is the SESSION, taken from the
       last print's UTC date — which equals the Eastern trading date across the
       whole US session and stays frozen after the close. */
    eq(body.asOf, "2026-08-25", "the session comes from the tape time, not the candle");

    eq(body.screened, 3, "the chain's true size is reported");
    eq(body.priced, 2, "the lottery ticket does not survive the gates");
    ok(body.gated.premium >= 1, "and its exclusion is attributed, not silent");
    ok(body.rows.every((r) => r.symbol !== "AAPL260827P00120000"),
       "the unsellable line is absent from the ranking");

    const put = body.rows.find((r) => r.type === "P");
    eq(put.premium, 250, "premium is the bid times 100");
    eq(put.collateral, 17000, "a put's collateral is the strike");
    eq(put.breakeven, 167.5);
    ok(put.annualizedIsConvention === true,
       "annualized ships flagged as a convention so no reader prints it as a return");
    /* DERIVED FROM THE PAYLOAD'S OWN SPOT, not from a hardcoded band. Both of
       these were pinned to spot = 180 and broke the moment the route started
       pricing against the live print — which is the fix working, not a
       regression. An assertion that restates the relation survives a fixture
       change; one that hardcodes its output does not. */
    const sigma = put.iv * Math.sqrt(put.days / 365);
    near(put.cushionSigmas, Math.log(body.spot / put.breakeven) / sigma, 1e-9,
         "cushion is the move to breakeven in the option's own implied sigmas");
    ok(put.cushionSigmas > 0, "and it is positive for a breakeven below spot");

    const call = body.rows.find((r) => r.type === "C");
    eq(call.collateral, Math.round(body.spot * 100 * 1e6) / 1e6,
       "a covered call's collateral is the shares at the SPOT the payload used");
    ok(call.capSigmas > 0, "and its upside cap is measured, not omitted");
  }

  /* ---------- the cache is the quota ------------------------------ */
  {
    const before = upstreamCalls;
    const a = await get("/api/flows/chain?t=AAPL");
    eq(a.status, 200);
    eq(a.headers.get("x-chain-cache"), "hit", "a second read is served from the edge");
    eq(upstreamCalls, before, "and costs no vendor call at all");
    eq(a.headers.get("cache-control"), "no-store",
       "a cache HIT is still no-store to the caller — the edge copy is ours, not theirs");

    /* Different parameters are a different question and must not collide. */
    const puts = await get("/api/flows/chain?t=AAPL&strategy=csp");
    eq(puts.status, 200);
    ok((await puts.json()).rows.every((r) => r.type === "P"),
       "a csp screen returns puts, so the key separates strategies");
    ok(upstreamCalls > before, "which cost its own vendor call rather than reusing the wrong body");

    /* An unknown parameter value must NORMALISE rather than mint a new key.
       Unbounded distinct keys from an authenticated user is unbounded vendor
       calls, which is the same failure the gate exists to prevent. */
    const callsBeforeJunk = upstreamCalls;
    for (const junk of ["xxx", "1", "csp2", "'; DROP", "%00"]) {
      const r = await get(`/api/flows/chain?t=AAPL&strategy=${encodeURIComponent(junk)}`);
      eq(r.status, 200, `strategy=${junk} normalises rather than erroring`);
    }
    eq(upstreamCalls, callsBeforeJunk,
       "five junk parameter values minted zero new cache keys and zero vendor calls");

    const badRank = await get("/api/flows/chain?t=AAPL&rank=nonsense");
    eq((await badRank.json()).rankedBy, "annualized",
       "an unknown rank falls back to the documented default");
  }

  /* ---------- the refresh floor ----------------------------------- */
  {
    /* The user asked for a refresh button, so refresh must actually refresh.
       It must also not be a hole: a first draft let refresh=1 skip the cache
       read outright, which means holding the button down is one vendor call
       per press. The floor makes refresh spend a call only once the copy is
       genuinely stale, and SAY so when it declines. */
    const before = upstreamCalls;
    const r1 = await get("/api/flows/chain?t=AAPL&refresh=1");
    eq(r1.status, 200);
    eq(r1.headers.get("x-chain-cache"), "throttled",
       "a refresh moments after a fetch is served from cache");
    eq(upstreamCalls, before, "and spends nothing");
    ok(Number(r1.headers.get("x-chain-age")) >= 0,
       "the response says how old the data it served is, rather than implying it is live");

    for (let i = 0; i < 5; i++) await get("/api/flows/chain?t=AAPL&refresh=1");
    eq(upstreamCalls, before, "five more presses in the same window spend nothing either");
  }

  /* ---------- upstream failures are reported as upstream ---------- */
  {
    const cases = [
      ["error", 502, "an upstream 500 is a bad gateway, not our 500"],
      ["garbage", 502, "HTML where JSON was promised is their outage, reported as theirs"],
      ["rate", 429, "an upstream rate limit is passed through as one"],
      ["emptyChain", 404, "a symbol with no listed options is a 404, not an empty success"],
      ["noSpot", 502, "no usable price from EITHER source is a failure, not a chain priced against zero"],
    ];
    let n = 0;
    for (const [mode, status, msg] of cases) {
      upstreamMode = mode;
      /* A distinct ticker per case so each misses the cache. */
      const res = await get(`/api/flows/chain?t=TST${n++}&refresh=1`);
      eq(res.status, status, msg);
      const body = await res.json();
      ok(!/test-uw-key/.test(JSON.stringify(body)),
         `the ${mode} path never echoes the vendor credential`);
      ok(body.error && body.error.code, "and answers in the project error envelope");
    }
    upstreamMode = "ok";
  }

  /* ---------- the page size is a CEILING, not a chain ------------- */
  {
    /* `limit` is documented maximum=500 and this route has no `order`
       parameter, so a single call on a liquid name returns an arbitrary
       vendor-ordered slice. The footer used to call that slice the chain, and
       in a merged table it was ranked head to head against complete ones. */
    upstreamMode = "ok";
    pagesAsked = [];
    const small = await get("/api/flows/chain?t=SMALL");
    eq(small.status, 200);
    const sBody = await small.json();
    eq(sBody.truncated, false, "a chain that fits in one page is not truncated");
    assert.deepEqual(pagesAsked, [1], "and costs exactly one page"); checks++;

    upstreamMode = "big";
    pagesAsked = [];
    const big = await get("/api/flows/chain?t=BIG");
    eq(big.status, 200);
    const bBody = await big.json();
    assert.deepEqual(pagesAsked, [1, 2], "a full first page buys a second"); checks++;
    eq(bBody.screened, 1000, "both pages reach the ranker");
    eq(bBody.truncated, true, "a full SECOND page means a third exists, and says so");
    eq(bBody.pageSize, 500, "the ceiling ships so the claim can be checked");

    upstreamMode = "part";
    pagesAsked = [];
    const part = await get("/api/flows/chain?t=PART");
    const pBody = await part.json();
    assert.deepEqual(pagesAsked, [1, 2], "a full first page always buys a second"); checks++;
    eq(pBody.screened, 503, "the short second page completes the chain");
    eq(pBody.truncated, false,
       "a short second page means the chain ENDED — the only case where screened is the chain");

    /* AND IT NEVER GOES FURTHER. Three pages is 6.5ms of a 10ms budget and
       four is 8.5ms; the bound is deliberate and the disclosure is what makes
       it honest. */
    upstreamMode = "big";
    pagesAsked = [];
    await get("/api/flows/chain?t=BIG2");
    eq(pagesAsked.length, 2, "two pages is the ceiling, whatever the chain holds");
    upstreamMode = "ok";
  }

  /* ---------- the cushion is only as fresh as its vol ------------- */
  {
    /* implied_volatility is the LAST TRANSACTION's, per the vendor's own
       schema ref. A contract that has not traded today carries one of unknown
       age, and the cushion divides by it. */
    upstreamMode = "ok";
    const res = await get("/api/flows/chain?t=IVAGE&refresh=1");
    const body = await res.json();
    const traded = body.rows.find((r) => r.volume > 0);
    ok(traded && traded.ivTraded === true, "a contract that traded today carries a fresh fill IV");
    ok(traded.cushionSigmas !== null, "and its cushion is published");
  }

  /* ---------- the live price is allowed to fail ------------------ */
  {
    /* /stock-state is one extra subrequest and it must never be able to take
       the desk down: a table priced off the close and SAYING so beats no table.
       The candle is still fetched, so the fallback is already in hand. */
    upstreamMode = "noState";
    /* A FRESH TICKER, because refresh=1 is floored: moments after the earlier
       AAPL fetch it is throttled and serves the cached, live-priced body, so
       this block would silently assert against the wrong response. The stub
       keys on the path, not the symbol, so any unused ticker misses the cache. */
    const res = await get("/api/flows/chain?t=FALLB");
    eq(res.status, 200, "a missing live price does not fail the request");
    const body = await res.json();
    eq(body.spot, 180, "it falls back to the latest daily close");
    eq(body.spotSource, "daily-close", "and says so, rather than passing a close off as a print");
    eq(body.asOf, "2026-08-24", "dating falls back to the candle's own date");
    eq(body.marketTime, null, "with no session claimed that was not observed");
    ok(body.rows.length > 0, "and the chain still prices");
    upstreamMode = "ok";
  }

  /* ---------- an unconfigured deploy degrades, it does not crash --- */
  {
    const bare = await startWorker({});
    try {
      const res = await fetch(bare.baseURL + "/api/flows/chain?t=AAPL", { headers: auth });
      eq(res.status, 503, "with no vendor key the route reports unconfigured");
      eq((await res.json()).error.code, "chain_unconfigured", "and names the reason");
      const board = await fetch(bare.baseURL + "/api/flows/board", { headers: auth });
      eq(board.status, 200, "while the precomputed board is unaffected");
    } finally {
      await bare.stop();
    }
  }

  console.log(`✓ flows-chain: ${checks} assertions — the gate in front of a metered credential, ` +
    `a cache key that cannot be minted by a caller, a refresh floor that still refreshes, ` +
    `spot by date, and upstream failures reported as upstream`);
} finally {
  await server.stop();
  await new Promise((r) => upstream.close(r));
}
