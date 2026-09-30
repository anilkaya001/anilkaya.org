import assert from "node:assert/strict";
import http from "node:http";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

let upstreamCalls = 0;
let upstreamMode = "ok";
let pagesAsked = [];

let openNow = 0, openPeak = 0;

let slowUpstream = 0;
const READ = "2026-08-25T22:00:00Z";
const envelope = (data) => JSON.stringify({ data });
const chainRows = [

  { option_symbol: "AAPL260918P00170000", nbbo_bid: "2.50", nbbo_ask: "2.60",
    implied_volatility: "0.28", open_interest: "1200", prev_oi: "1000", volume: "340" },

  { option_symbol: "AAPL260827P00120000", nbbo_bid: "0.01", nbbo_ask: "0.30",
    implied_volatility: "0.90", open_interest: "11", volume: "2" },

  { option_symbol: "AAPL260918C00190000", nbbo_bid: "3.20", nbbo_ask: "3.35",
    implied_volatility: "0.26", open_interest: "950", volume: "400" },
];

const candles = [
  { date: "2026-08-20", close: "171.00" },
  { date: "2026-08-24", close: "180.00" },
  { date: "2026-08-21", close: "174.00" },
];

const sessionCandles = [
  { date: "2026-08-25", market_time: "pr", close: "181.00" },
  { date: "2026-08-25", market_time: "r", close: "183.40" },
  { date: "2026-08-25", market_time: "po", close: "190.00" },
  { date: "2026-08-24", market_time: "r", close: "180.00" },
];

const liveState = {
  close: "183.40", prev_close: "179.10", open: "180.20",
  high: "184.00", low: "179.80", market_time: "regular",
  tape_time: "2026-08-25 18:06:00+00:00", total_volume: 23132119, volume: 12348,
};

const upstream = http.createServer((req, res) => {
  upstreamCalls++;
  const tm = req.url.match(/\/api\/stock\/([^/]+)\//);
  const ticker = tm ? decodeURIComponent(tm[1]).toUpperCase() : "AAPL";
  openNow++;
  if (openNow > openPeak) openPeak = openNow;

  let closed = false;
  const done = () => { if (!closed) { closed = true; openNow--; } };
  res.on("finish", done);
  res.on("close", done);
  const path = req.url.split("?")[0];
  res.setHeader("Content-Type", "application/json");
  const send = (code, body) => {
    const go = () => { res.writeHead(code); res.end(body); };
    if (slowUpstream > 0) setTimeout(go, slowUpstream); else go();
  };
  if (upstreamMode === "error") { send(500, "{}"); return; }
  if (upstreamMode === "garbage") { send(200, "<html>not json</html>"); return; }
  if (upstreamMode === "rate") { send(429, "{}"); return; }
  if (path.endsWith("/option-contracts")) {
    const page = Number(new URL(req.url, "http://x").searchParams.get("page") || 1);
    pagesAsked.push(page);

    const reroot = (sym) => String(sym).replace(/^[A-Z]+/, ticker);
    if (upstreamMode === "emptyChain") { send(200, JSON.stringify({ data: [] })); return; }
    if (upstreamMode === "incoherent") {
      send(200, JSON.stringify({ data: [
        { option_symbol: `${ticker}260918C00170000`, nbbo_bid: "2.00", nbbo_ask: "2.10", implied_volatility: "0.3", open_interest: "900", volume: "10" },
        { option_symbol: `${ticker}260918C00175000`, nbbo_bid: "3.00", nbbo_ask: "3.10", implied_volatility: "0.3", open_interest: "900", volume: "10" },
        { option_symbol: `${ticker}260918P00160000`, nbbo_bid: "1.00", nbbo_ask: "1.05", implied_volatility: "0.3", open_interest: "900", volume: "10" },
      ] }));
      return;
    }

    if (upstreamMode === "big" || upstreamMode === "part") {
      const full = Array.from({ length: 500 }, (_, i) => ({
        option_symbol: `${ticker}260918P${String((100 + i) * 1000).padStart(8, "0")}`,
        nbbo_bid: "2.00", nbbo_ask: "2.05", implied_volatility: "0.30",
        open_interest: "900", volume: "50",
      }));
      if (page >= 2 && upstreamMode === "part") {
        send(200, JSON.stringify({ data: full.slice(0, 3) }));
        return;
      }
      send(200, JSON.stringify({ data: full }));
      return;
    }
    send(200, JSON.stringify({
      data: chainRows.map((r) => ({ ...r, option_symbol: reroot(r.option_symbol) })),
    }));
    return;
  }
  if (path.includes("/ohlc/")) {
    send(200, JSON.stringify({ data: upstreamMode === "noSpot" ? [] : upstreamMode === "afterHours" ? sessionCandles : candles }));
    return;
  }
  if (path.endsWith("/info")) {
    if (upstreamMode === "noInfo") { send(404, "{}"); return; }

    send(200, JSON.stringify({
      data: { next_earnings_date: "2026-09-04", announce_time: "premarket",
              issue_type: "Common Stock" },
    }));
    return;
  }
  if (path.endsWith("/stock-state")) {

    if (upstreamMode === "noState" || upstreamMode === "noSpot") {
      send(404, "{}"); return;
    }
    if (upstreamMode === "bareState") { send(200, JSON.stringify(liveState)); return; }
    if (upstreamMode === "afterHours") {
      send(200, envelope({ ...liveState, close: "190.00", market_time: "postmarket", tape_time: "2026-08-25T21:30:00Z" }));
      return;
    }
    send(200, envelope(liveState));
    return;
  }
  send(404, "{}");
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamURL = `http://127.0.0.1:${upstream.address().port}`;

const server = await startWorker({
  extraVars: ["UW_API_KEY:test-uw-key", `UW_BASE:${upstreamURL}`, `UW_NOW:${READ}`],
});

const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const auth = { Cookie: "flows_session=" + token };
const get = (p, headers) => fetch(server.baseURL + p, { redirect: "manual", headers: { ...auth, ...headers } });
const anon = (p) => fetch(server.baseURL + p, { redirect: "manual" });

const DESK_MARKER = 'id="dkGrid"';

try {

  {
    const res = await anon("/flows/desk/");
    eq(res.status, 200, "an anonymous visitor gets a page, not a 404 — the section is not the secret");
    const body = await res.text();
    ok(!body.includes(DESK_MARKER), "but never the desk itself");
    ok(body.includes('action="/flows/login"'), "they get the sign-in form");
    eq(res.headers.get("cache-control"), "no-store", "gated documents are no-store");

    eq(res.status, 200, "and it is served in place rather than bounced to the board");

    const inn = await get("/flows/desk/");
    eq(inn.status, 200, "a signed-in user gets the desk");
    const deskBody = await inn.text();
    ok(deskBody.includes(DESK_MARKER), "which contains the desk's grid of modules");
    ok(deskBody.includes('href="/flows/"'), "and a way back to the board");

    const canon = await anon("/flows/desk");
    eq(canon.status, 308, "the un-slashed path redirects to the canonical one");
    ok((canon.headers.get("location") || "").endsWith("/flows/desk/"), "to /flows/desk/");

    const post = await fetch(server.baseURL + "/flows/desk/", { method: "POST", headers: auth });
    eq(post.status, 405, "the desk page is GET only");
  }

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

  {
    for (const bad of ["", "../../etc", "aapl!", "TOOLONGTICKERNAME", "%2e%2e"]) {
      const res = await get(`/api/flows/chain?t=${encodeURIComponent(bad)}`);
      eq(res.status, 400, `"${bad}" is refused as a ticker`);
    }
    eq(upstreamCalls, 0, "no malformed ticker ever reached the upstream");
  }

  {
    const res = await get("/api/flows/chain?t=AAPL&refresh=1");
    eq(res.status, 200, "an authenticated lookup succeeds");
    eq(res.headers.get("cache-control"), "no-store",
       "a gated response is never storable by a browser or an intermediary");
    const body = await res.json();

    eq(body.ticker, "AAPL");

    eq(body.spot, 183.4, "spot is the live print, not the latest daily close");
    eq(body.spotSource, "stock-state", "and the payload says which price it used");
    eq(body.marketTime, "regular", "the vendor's session name is passed through verbatim");
    eq(body.prevClose, 179.1, "the previous close ships alongside rather than as spot");

    eq(body.asOf, "2026-08-25", "the date is the New York date of the READ, not the newest candle's and not the tape's UTC date");
    eq(body.sessionDate, "2026-08-25", "the session the price belongs to ships beside it");
    eq(body.basis.status, "ok", "the chain agrees with its spot");
    eq(body.basis.printSource, "stock-state", "and the basis names the print's source");
    eq(body.basis.printSpot, 183.4, "with the print");
    eq(body.generatedAt, "2026-08-25T22:00:00.000Z", "the payload is stamped with the instant the vendor was read");
    eq(body.tapeTime, "2026-08-25 18:06:00+00:00",
       "and the tape time itself ships beside the read instant");

    ok(body.engine && body.engine.status === "unavailable",
       "no card is published for AAPL here, so the engine block says the real-world law is unavailable");
    eq(body.engine.reason, "no card is published for this name",
       "and says why, rather than shipping an empty law the desk would price as if it were one");

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

    const years = (Date.UTC(2026, 8, 18, 20) - Date.parse(READ)) / (365 * 86400000);
    const sigma = put.ivMid * Math.sqrt(years);
    near(put.cushionSigmas, Math.log(body.spot / put.breakeven) / sigma, 1e-9,
         "cushion is the move to breakeven in the QUOTE's implied sigmas over the exact time from the read to the 4 pm expiry close, not the vendor's last-trade volatility over whole days");
    ok(Math.abs(put.ivMid - put.iv) > 1e-4, "the volatility it uses is the mid's, which differs from the vendor's figure");
    ok(put.cushionSigmas > 0, "and it is positive for a breakeven below spot");
    eq(put.intrinsic, 0, "the put is out of the money and carries no intrinsic value");
    eq(put.extrinsic, 2.5, "so its time value is its whole bid");
    eq(put.annualized, put.annualizedGross, "and the two annualizations agree");

    const call = body.rows.find((r) => r.type === "C");
    eq(call.collateral, Math.round(body.spot * 100 * 1e6) / 1e6,
       "a covered call's collateral is the shares at the SPOT the payload used");
    ok(call.capSigmas > 0, "and its upside cap is measured, not omitted");
  }

  {
    const before = upstreamCalls;
    const a = await get("/api/flows/chain?t=AAPL");
    eq(a.status, 200);
    eq(a.headers.get("x-chain-cache"), "hit", "a second read is served from the edge");
    eq(upstreamCalls, before, "and costs no vendor call at all");
    eq(a.headers.get("cache-control"), "no-store",
       "a cache HIT is still no-store to the caller — the edge copy is ours, not theirs");

    const puts = await get("/api/flows/chain?t=AAPL&strategy=csp");
    eq(puts.status, 200);
    ok((await puts.json()).rows.every((r) => r.type === "P"),
       "a csp screen returns puts, so the key separates strategies");
    ok(upstreamCalls > before, "which cost its own vendor call rather than reusing the wrong body");

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

  {

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

      const res = await get(`/api/flows/chain?t=TST${n++}&refresh=1`);
      eq(res.status, status, msg);
      const body = await res.json();
      ok(!/test-uw-key/.test(JSON.stringify(body)),
         `the ${mode} path never echoes the vendor credential`);
      ok(body.error && body.error.code, "and answers in the project error envelope");
    }
    upstreamMode = "ok";
  }

  {

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

    upstreamMode = "big";
    pagesAsked = [];
    await get("/api/flows/chain?t=BIG2");
    eq(pagesAsked.length, 2, "two pages is the ceiling, whatever the chain holds");
    upstreamMode = "ok";
  }

  {

    upstreamMode = "ok";
    const res = await get("/api/flows/chain?t=EARN&refresh=1");
    eq(res.status, 200);
    const body = await res.json();
    eq(body.earnings.date, "2026-09-04", "the earnings date ships with the payload");
    eq(body.earnings.announceTime, "premarket", "and the vendor's own token, verbatim");
    eq(body.earnings.issueType, "Common Stock",
       "and the issue type, which separates 'no earnings' from 'date unknown'");

    const after = body.rows.filter((r) => r.expiry > "2026-09-04");
    ok(after.length > 0, "the fixture has contracts expiring after the report");
    ok(after.every((r) => r.crossesEarnings === true),
       "every contract outliving the report is marked");
    const before = body.rows.filter((r) => r.expiry < "2026-09-04");
    ok(before.every((r) => r.crossesEarnings === false),
       "and every contract settling before it is not");
  }

  {

    upstreamMode = "noInfo";
    const res = await get("/api/flows/chain?t=NOINFO");
    eq(res.status, 200, "a failed /info lookup does not fail the request");
    const body = await res.json();
    eq(body.earnings, null, "the payload says it has no earnings information");
    ok(body.rows.length > 0, "and the chain still prices");
    ok(body.rows.every((r) => r.crossesEarnings === null),
       "every row is NULL — not false, which would read as event-free");
    upstreamMode = "ok";
  }

  {

    slowUpstream = 60;
    openPeak = 0;
    upstreamMode = "ok";
    const res = await get("/api/flows/chain?t=CONC");
    eq(res.status, 200, "the route answers");
    ok(openPeak >= 2,
       `the fixture actually observed concurrency rather than serialising (${openPeak})`);
    ok(openPeak <= 6,
       `the route opens at most six simultaneous upstream connections (${openPeak})`);
    ok(openPeak >= 4,
       `the fixture sees the fourth leg — /info joined the Promise.all (${openPeak})`);

    openPeak = 0;
    upstreamMode = "big";
    await get("/api/flows/chain?t=CONCBIG");
    ok(openPeak <= 6,
       `a paginated chain still opens at most six (${openPeak})`);
    slowUpstream = 0;
    upstreamMode = "ok";
  }

  {

    upstreamMode = "ok";
    const res = await get("/api/flows/chain?t=IVAGE&refresh=1");
    const body = await res.json();
    const traded = body.rows.find((r) => r.volume > 0);
    ok(traded && traded.ivTraded === true, "a contract that traded today carries a fresh fill IV");
    ok(traded.cushionSigmas !== null, "and its cushion is published");
  }

  {

    upstreamMode = "noState";

    const res = await get("/api/flows/chain?t=FALLB");
    eq(res.status, 200, "a missing live price does not fail the request");
    const body = await res.json();
    eq(body.spot, 180, "it falls back to the latest daily close");
    eq(body.spotSource, "daily-close", "and says so, rather than passing a close off as a print");
    eq(body.basis.printSource, "daily-bar", "the basis says the bar did not state its session");
    eq(body.asOf, "2026-08-25", "dating comes from the read, not from a candle that may be a day or a weekend old");
    eq(body.sessionDate, "2026-08-24", "while the session of the price is the candle's own");
    eq(body.marketTime, null, "with no session claimed that was not observed");
    ok(body.rows.length > 0, "and the chain still prices");
    upstreamMode = "ok";
  }

  {
    upstreamMode = "bareState";
    const res = await get("/api/flows/chain?t=BARE&refresh=1");
    const body = await res.json();
    eq(body.spotSource, "stock-state", "a bare stock-state body, the shape earlier mocks returned, is still read as a live print");
    eq(body.spot, 183.4, "at its close");
    upstreamMode = "ok";
  }

  {
    upstreamMode = "afterHours";
    const res = await get("/api/flows/chain?t=AFTER&refresh=1");
    eq(res.status, 200);
    const body = await res.json();
    eq(body.spot, 183.4, "AFTER THE CLOSE the spot is the regular-session close, not the 190.00 print that chain quotes do not follow");
    eq(body.basis.printSource, "regular-close", "the basis says it is a regular close");
    eq(body.basis.printNote, "regular close 4:00 pm ET", "in words");
    eq(body.spotSource, "daily-close", "and the legacy source field says a close");
    eq(body.marketTime, "postmarket", "the vendor's session name for the live state passes through");
    eq(body.prevClose, 179.1, "with its own previous close");
    upstreamMode = "ok";
  }

  {
    const spread = await get("/api/flows/chain?t=OFFM&refresh=1");
    const clean = await spread.json();
    eq(clean.gated.offMarket, 0, "a coherent chain sets nothing aside as off the market");
    ok("offMarket" in clean.gated, "but the gate is in the counts, so a reader can see it was applied");
    eq(clean.basis.offMarket, 0, "and the basis counts none");

    upstreamMode = "incoherent";
    const res = await get("/api/flows/chain?t=INCOH&refresh=1");
    eq(res.status, 200, "a chain that cannot belong to its spot is still an answer");
    const body = await res.json();
    eq(body.basis.status, "mismatch", "its basis says the two do not belong together");
    eq(body.basis.offMarket, 2, "two calls whose asks are under their exercise value are counted");
    assert.deepEqual(body.rows, []); checks++;
    eq(body.gated.offMarket, 3, "and every contract is accounted for under the gate, so excluded plus priced is still the chain");
    eq(body.priced, 0, "nothing is priced against a spot the quotes contradict");
    upstreamMode = "ok";
  }

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
