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

/* ---------- the stub upstream ---------------------------------- */
let upstreamCalls = 0;
let upstreamMode = "ok";
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
    res.writeHead(200);
    res.end(JSON.stringify({ data: upstreamMode === "emptyChain" ? [] : chainRows }));
    return;
  }
  if (path.includes("/ohlc/")) {
    res.writeHead(200);
    res.end(JSON.stringify({ data: upstreamMode === "noSpot" ? [] : candles }));
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

try {
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
    eq(body.spot, 180, "spot is the LATEST close by date, not the first or last row");
    eq(body.asOf, "2026-08-24", "and the date it came from ships with it");

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
    ok(put.cushionSigmas > 0.9 && put.cushionSigmas < 1.1,
       `breakeven sits about one implied sigma out (${put.cushionSigmas})`);

    const call = body.rows.find((r) => r.type === "C");
    eq(call.collateral, 18000, "a covered call's collateral is the shares at spot");
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
      ["noSpot", 502, "no usable price is a failure, not a chain priced against zero"],
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
