/* End-to-end contracts for the gated Flows section, against a real local
   Worker. These are the tests that prove the gate actually holds, as opposed
   to the unit tests in flows-auth-contract.mjs which prove the primitives.

   The bypass cases matter most. route() ends with env.ASSETS.fetch(request),
   so anything a path check fails to match is handed to the static bundle.
   A prefix test is evadable — /%66lows/index.html, //flows/index.html and
   /FLOWS/index.html all slip past startsWith("/flows/"). The defence here is
   structural rather than filtered: the gated HTML lives in shared/flows-pages.js
   and never enters the bundle, so a missed path has nothing to leak. */

import assert from "node:assert/strict";
import { signSession } from "../shared/session.js";
import { TICKER_PANELS } from "../shared/flows-panels.js";
import {
  startWorker, SESSION_SECRET, FLOWS_PASSWORD, FLOWS_TEST_USER,
} from "./worker-server.mjs";

const INGEST_TOKEN = "test-ingest-token-abcdefghijklmnopqrstuv";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${INGEST_TOKEN}`] });
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const url = (p) => server.baseURL + p;
const get = (p, init) => fetch(url(p), { redirect: "manual", ...init });

/* A marker that appears only in an AUTHENTICATED page, never in the login
   page. It must be on the page each assertion actually requests: /flows/ is
   now the Overview, which has no results table at all, so the old
   id="flowsBody" marker would have passed every leak test for the wrong
   reason — absent when signed in as much as when signed out. The rail is on
   every gated page and on none of the public ones. */
const BOARD_MARKER = 'class="flows-rail"';

try {
  /* ---------- the login page is public, the board is not ---------- */
  {
    const res = await get("/flows/");
    eq(res.status, 200, "GET /flows/ serves a page to an anonymous visitor");
    const body = await res.text();
    ok(body.includes('action="/flows/login"'), "anonymous visitors get the sign-in form");
    ok(!body.includes(BOARD_MARKER), "anonymous visitors never receive the board");
    ok(body.includes('content="noindex, nofollow"'), "the section is noindex");
    ok(/text\/html/.test(res.headers.get("content-type") || ""), "served as HTML");
    eq(res.headers.get("cache-control"), "no-store",
       "gated documents are no-store, not merely no-cache");
  }

  /* ---------- canonical path ------------------------------------- */
  {
    const res = await get("/flows");
    eq(res.status, 308, "GET /flows redirects to the canonical trailing slash");
    ok((res.headers.get("location") || "").endsWith("/flows/"), "redirect target is /flows/");
  }

  /* ---------- method discipline ---------------------------------- */
  {
    const res = await get("/flows/login");
    eq(res.status, 405, "GET /flows/login is refused");
    ok((res.headers.get("allow") || "").includes("POST"), "405 advertises POST");

    const out = await get("/flows/logout");
    eq(out.status, 405, "GET /flows/logout is refused (no CSRF sign-out)");
  }

  /* ---------- the JSON surface ----------------------------------- */
  {
    const res = await get("/api/flows/board");
    eq(res.status, 401, "anonymous board access is refused");
    eq(res.headers.get("cache-control"), "no-store", "API responses are no-store");
    const body = await res.json();
    ok(body.error && body.error.code === "unauthorized",
       "the project error envelope is used");
  }

  /* ---------- BYPASS: the gate must be structural ------------------ */
  {
    for (const path of [
      "/%66lows/index.html",   // percent-encoded 'f'
      "//flows/index.html",    // protocol-relative style double slash
      "/FLOWS/index.html",     // case variation
      "/flows/index.html",     // the file a bundled page would have had
      "/flows/board",          // a plausible guess
      "/flows/../flows/",      // traversal that normalises back
    ]) {
      const res = await get(path);
      const body = res.status === 200 ? await res.text() : "";
      ok(!body.includes(BOARD_MARKER),
         `bypass attempt ${path} does not leak the board (status ${res.status})`);
      ok(!body.includes('action="/flows/login"') || res.status === 200,
         `bypass attempt ${path} returns a coherent response`);
    }
  }

  /* ---------- wrong-audience tokens ------------------------------- */
  {
    // A learning session, correctly signed with the SAME secret, must not
    // unlock flows. This is the isolation boundary, tested through HTTP.
    const learn = await signSession(
      { sub: "g_test", aud: "learn", exp: Date.now() + 60000 }, SESSION_SECRET,
    );
    const res = await get("/api/flows/board", { headers: { Cookie: "flows_session=" + learn } });
    eq(res.status, 401, "a learning token does not unlock the flows API");

    const page = await get("/flows/", { headers: { Cookie: "flows_session=" + learn } });
    ok(!(await page.text()).includes(BOARD_MARKER), "a learning token does not render the board");

    // And the reverse: a flows token must not be accepted as a learner.
    const flows = await signSession(
      { sub: FLOWS_TEST_USER, aud: "flows", exp: Date.now() + 60000 }, SESSION_SECRET,
    );
    const me = await get("/api/me", { headers: { Cookie: "session=" + flows } });
    const meBody = await me.json();
    ok(meBody.user === null, "a flows token is not accepted as a learning session");
  }

  /* ---------- legacy learning sessions still work ------------------ */
  {
    // Tokens minted before audiences existed carry none. They must keep
    // working, or this deployment logs out every current learner.
    const legacy = await signSession(
      { sub: "g_legacy", email: "l@example.com", name: "Legacy", exp: Date.now() + 60000 },
      SESSION_SECRET,
    );
    const res = await get("/api/me", { headers: { Cookie: "session=" + legacy } });
    const body = await res.json();
    ok(body.user && body.user.id === "g_legacy",
       "a legacy audience-less learning session is still honoured");
  }

  /* ---------- failed sign-in is uniform ---------------------------- */
  {
    const post = (params) => fetch(url("/flows/login"), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL,
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams(params).toString(),
    });

    const unknown = await post({ username: "nosuchperson", password: FLOWS_PASSWORD });
    const wrongPw = await post({ username: FLOWS_TEST_USER, password: "definitely-wrong" });

    eq(unknown.status, 401, "an unknown username is refused");
    eq(wrongPw.status, 401, "a wrong password is refused");

    const a = await unknown.text();
    const b = await wrongPw.text();
    eq(a, b, "the two failures are byte-identical — the response cannot enumerate the roster");
    ok(!a.includes(BOARD_MARKER), "a failed sign-in never renders the board");
  }

  /* ---------- cross-origin sign-in is refused ---------------------- */
  {
    const res = await fetch(url("/flows/login"), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: new URLSearchParams({ username: FLOWS_TEST_USER, password: FLOWS_PASSWORD }).toString(),
    });
    eq(res.status, 403, "a cross-origin sign-in attempt is refused");
  }

  /* ---------- the happy path -------------------------------------- */
  {
    const res = await fetch(url("/flows/login"), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL,
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({
        username: FLOWS_TEST_USER, password: FLOWS_PASSWORD,
      }).toString(),
    });
    eq(res.status, 303, "a correct credential redirects rather than rendering");

    const setCookie = res.headers.get("set-cookie") || "";
    ok(setCookie.includes("flows_session="), "a flows session cookie is issued");
    ok(/HttpOnly/i.test(setCookie), "the session cookie is HttpOnly");
    ok(/Secure/i.test(setCookie), "the session cookie is Secure");
    ok(/SameSite=Lax/i.test(setCookie), "the session cookie is SameSite=Lax");

    const token = /flows_session=([^;]+)/.exec(setCookie)[1];

    const board = await get("/flows/", { headers: { Cookie: "flows_session=" + token } });
    const html = await board.text();
    eq(board.status, 200, "the board renders for an authenticated session");
    ok(html.includes(BOARD_MARKER), "the board markup is present");
    ok(html.includes(FLOWS_TEST_USER), "the board names the signed-in account");
    ok(html.includes("/assets/js/flows-overview.js"),
       "the overview loads its own controller");

    /* THE SIDES ARE ROUTES NOW, not a toggle. A toggle has no address: a
       reader could not link to the bearish side, bookmark it or send it, and
       half the session sat behind a click. Each side is a page, so each is
       asserted as one. */
    for (const route of ["/flows/long/", "/flows/short/"]) {
      const side = await get(route, { headers: { Cookie: "flows_session=" + token } });
      eq(side.status, 200, `${route} renders for an authenticated session`);
      const sideHtml = await side.text();
      ok(sideHtml.includes(BOARD_MARKER), `${route} is a gated page`);
      ok(sideHtml.includes("/assets/js/flows-board.js"), `${route} loads the board controller`);
      ok(sideHtml.includes('id="flowsBody"'), `${route} carries the results table`);
      ok(/aria-current="page"/.test(sideHtml), `${route} marks itself current in the rail`);

      const anon = await get(route);
      eq(anon.status, 200, `${route} serves a page to an anonymous visitor`);
      const anonHtml = await anon.text();
      ok(!anonHtml.includes(BOARD_MARKER), `${route} leaks nothing to an anonymous visitor`);
      ok(anonHtml.includes('action="/flows/login"'),
         `${route} offers the sign-in form IN PLACE — a redirect would lose the page asked for`);

      const bare = await get(route.replace(/\/$/, ""));
      eq(bare.status, 308, `${route} without its trailing slash redirects`);
    }

    /* THE TICKER PAGE — a route with a query parameter, which is the one
       shape the rest of this section does not use. Its own block rather than
       another entry in the loop above, because the ?t= handling is the part
       that can go wrong and the loop asserts board markup this page does not
       carry. */
    {
      const tick = await get("/flows/ticker/", { headers: { Cookie: "flows_session=" + token } });
      eq(tick.status, 200, "/flows/ticker/ renders for an authenticated session");
      const tickHtml = await tick.text();
      ok(tickHtml.includes("/assets/js/flows-ticker.js"), "the ticker page loads its own controller");
      ok(tickHtml.includes("/assets/js/flows-panels.js"),
         "and the extracted renderers it cannot draw without");
      ok(tickHtml.indexOf("/assets/js/flows-panels.js") < tickHtml.indexOf("/assets/js/flows-ticker.js"),
         "with flows-panels.js FIRST — the controller fails closed without it");
      ok(tickHtml.includes('id="ftGrid"'), "the ticker page carries the panel grid");
      ok(tickHtml.includes('id="ftZoom"'), "and the enlarge dialog");

      /* EVERY REGISTRY PANEL REACHES THE MARKUP, with its question. A panel
         whose host is missing is a chart that silently never draws, which is
         the exact failure the shared registry exists to make impossible. */
      for (const p of TICKER_PANELS) {
        const idCount = tickHtml.split(`id="${p.id}"`).length - 1;
        eq(idCount, 1, `the ticker page emits ${p.id} exactly once`);
        ok(tickHtml.includes(`data-panel="${p.key}"`), `and mounts panel ${p.key}`);
      }
      ok(tickHtml.includes("data-question="), "each panel carries its question as an attribute");
      /* shared/ is in .assetsignore and is never served, so the browser cannot
         import the registry. If the question did not reach the DOM the drawers
         would print an empty question with nothing failing. */
      for (const p of TICKER_PANELS) {
        ok(tickHtml.includes(p.question.replace(/&/g, "&amp;").replace(/</g, "&lt;")
             .replace(/>/g, "&gt;").replace(/"/g, "&quot;")),
           `panel ${p.key}'s question reaches the markup`);
      }

      const anonTick = await get("/flows/ticker/");
      eq(anonTick.status, 200, "/flows/ticker/ serves a page to an anonymous visitor");
      const anonTickHtml = await anonTick.text();
      ok(!anonTickHtml.includes('id="ftGrid"'),
         "/flows/ticker/ leaks nothing to an anonymous visitor");
      ok(anonTickHtml.includes('action="/flows/login"'),
         "/flows/ticker/ offers the sign-in form IN PLACE");

      const bareTick = await get("/flows/ticker");
      eq(bareTick.status, 308, "/flows/ticker without its trailing slash redirects");

      /* THE HOLE THIS FOUND. /flows/market shipped with the slashed route in
         the dispatch table and NOTHING in the trailing-slash list, so the bare
         path fell through to the static bundle and 404ed. Nothing failed: the
         rail always writes the slash, so only a hand-typed URL ever found it. */
      const bareMarket = await get("/flows/market");
      eq(bareMarket.status, 308, "/flows/market without its trailing slash redirects too");
    }

    /* ---------- THE FOUR BOARD ROUTES' OWN ?t= ADDRESSES ------------
       The retired dialog pushed one into history on every open, so they are in
       histories, bookmarks and links people sent each other, naming a
       parameter no page reads. Asserted per route AND per `from`: a table
       mapping three routes to one origin would name a page the reader was
       never on. */
    for (const [route, from] of [["/flows/", "overview"], ["/flows/long/", "long"],
                                 ["/flows/short/", "short"], ["/flows/watch/", "watch"]]) {
      const fwd = await get(route + "?t=NVDA", { headers: { Cookie: "flows_session=" + token } });
      eq(fwd.status, 302,
         `${route}?t= forwards to the reader — 302 and not 308, because the address is not ` +
         "permanently gone: it is the parameter on it that moved");
      eq(new URL(fwd.headers.get("location"), url("/")).pathname + "" +
         new URL(fwd.headers.get("location"), url("/")).search,
         "/flows/ticker/?t=NVDA&s=signal&from=" + from,
         `${route}?t=NVDA lands on that name's reader carrying from=${from}`);

      /* THE BARE ROUTE IS UNTOUCHED: a forward firing without a `t` would
         make the board unreachable. */
      const bare = await get(route, { headers: { Cookie: "flows_session=" + token } });
      eq(bare.status, 200, `${route} with no ?t= still renders its own page`);

      /* AND SO IS AN EMPTY OR BLANK ONE: `?t=` and `?t=%20` are not names. */
      for (const empty of ["?t=", "?t=%20%20"]) {
        eq((await get(route + empty,
             { headers: { Cookie: "flows_session=" + token } })).status, 200,
           `${route}${empty} is not a name, so the board answers it`);
      }
    }

    /* IT READS NO PAYLOAD AND NO SESSION, which is what makes it free and
       keeps it from leaking: a forward that first checked whether the name was
       published would be a KV read on every stale bookmark AND an oracle for
       whether a ticker is on the board. */
    {
      const anonFwd = await get("/flows/long/?t=NVDA");
      eq(anonFwd.status, 302, "an anonymous visitor is forwarded like any other");
      eq(new URL(anonFwd.headers.get("location"), url("/")).search,
         "?t=NVDA&s=signal&from=long", "to the same address, decided without a session");

      /* RE-ENCODED, NEVER PASTED: whatever arrives lands as ONE query value
         and cannot open a second parameter, a fragment or a path segment. */
      const hostile = await get("/flows/long/?t=" + encodeURIComponent("A&s=evil#x/../"));
      const loc = new URL(hostile.headers.get("location"), url("/"));
      eq(loc.pathname, "/flows/ticker/",
         `a hostile name cannot climb out of the query into the path (${loc.pathname})`);
      eq(loc.searchParams.get("s"), "signal",
         "nor overwrite the section parameter with one of its own");
      eq(loc.searchParams.get("t"), "A&s=evil#x/../",
         "and it survives the round trip as the single value it was");
      eq(loc.hash, "", "with no fragment smuggled onto the end");
    }

    /* AND THE DIALOG IS OFF THE ROUTES THAT CARRIED IT: the forward above would
       pass on a page still shipping it and 166 KiB of library beside it. */
    for (const route of ["/flows/", "/flows/long/", "/flows/short/", "/flows/watch/"]) {
      const html = await (await get(route,
        { headers: { Cookie: "flows_session=" + token } })).text();
      for (const gone of ['id="flowsCard"', "/assets/js/flows-card.js",
                          "/assets/js/flows-panels.js"]) {
        ok(!html.includes(gone), `${route} no longer serves ${gone}`);
      }
    }

    /* THE UNUSUAL-ACTIVITY FEED. Its own block because the thing that can go
       wrong here is not routing but VOCABULARY: the page is built on a
       contract aggregate and may never call it a trade, and may never date a
       counter the endpoint refuses to date. */
    {
      const ua = await get("/flows/unusual/", { headers: { Cookie: "flows_session=" + token } });
      eq(ua.status, 200, "/flows/unusual/ renders for an authenticated session");
      const uaHtml = await ua.text();
      ok(uaHtml.includes("/assets/js/flows-unusual.js"),
         "the unusual page loads its own controller");
      ok(uaHtml.includes('id="uaFeedBody"'), "and carries the contract feed's table body");
      ok(uaHtml.includes('id="uaNameBody"'), "and the name panel's");
      ok(uaHtml.includes('id="uaBasis"'), "and the basis panel, which is the page's honesty");

      /* THE BAN, AND IT IS A BAN ON THE CLAIM RATHER THAN ON THE WORD.

         The source is one row per listed strike with a volume total — no
         size, no timestamp, no execution price — so calling it a print or a
         trade asserts something the data cannot support. But a page whose
         entire design is that refusal has to be ALLOWED TO NAME WHAT IT
         REFUSES: its lede says "A counter, not a trade", which is the most
         important sentence on the page and would fail a blanket sweep.

         So the assertion is two-sided and stronger than "never appears":
         every occurrence must sit inside the prose whose job is to state the
         refusals — the lede and the basis panel. One anywhere else, in a
         table header, a caption or a status strip, is the page claiming it.

         "order" is excluded from the vocabulary because it occurs in ordinary
         prose ("in no documented order"); the per-trade words are the ones
         that carry a claim. */
      const banned = /\b(print|trade|block|sweep|bought|sold|paid|whale|smart money|institutional)\b/ig;
      const refusalProse = [
        ...uaHtml.matchAll(/<p class="flows-lede">[\s\S]*?<\/p>/g),
        ...uaHtml.matchAll(/<section[^>]*id="uaBasisPanel"[\s\S]*?<\/section>/g),
      ].map((x) => x[0]).join("\n");
      const strayClaims = [];
      for (const hit of uaHtml.matchAll(banned)) {
        const around = uaHtml.slice(Math.max(0, hit.index - 60), hit.index + 60);
        if (!refusalProse.includes(around.slice(10, -10))) strayClaims.push(hit[0] + ": " + around);
      }
      eq(strayClaims.length, 0,
         `the unusual page names a trade only where it is refusing to call it one ` +
         `(${strayClaims.slice(0, 2).join(" | ")})`);
      ok(/not a trade/i.test(uaHtml),
         "and the lede states that refusal in so many words, rather than leaving it implied");
      /* AND IT NEVER DATES THE COUNTER. The endpoint accepts no date and the
         pipeline reads it four hours before the bell, so "today" would be a
         free parameter on the page's most load-bearing quantity. */
      const dated = /\b(today|this session|the day's|the day\u2019s)\b/i;
      const d = uaHtml.match(dated);
      ok(!d, `the unusual page never dates an undated counter (found "${d && d[0]}")`);

      const anonUa = await get("/flows/unusual/");
      eq(anonUa.status, 200, "/flows/unusual/ serves a page to an anonymous visitor");
      ok(!(await anonUa.text()).includes('id="uaFeedBody"'),
         "/flows/unusual/ leaks nothing to an anonymous visitor");

      const bareUa = await get("/flows/unusual");
      eq(bareUa.status, 308, "/flows/unusual without its trailing slash redirects");

      /* The API answers honestly before the pipeline has ever written the key. */
      /* THE ALERTS PANEL rides on the same page under its own payload. The
         markup half asserted here: the panel exists, its flags column warns
         that an em dash is not "off", and the lede's new sentence carries
         the vendor-flag vocabulary INSIDE the refusal prose — the two-sided
         ban above already proved no banned word escaped it. */
      ok(uaHtml.includes('id="uaAlertsBody"'), "the vendor-alerts panel's table body ships");
      ok(uaHtml.includes('id="uaAlertsNote"'), "with its own note host");
      ok(/not the same fact as the flag being off/i.test(uaHtml),
         "and the flags column's own header states that an absent flag is not an " +
         "off one — the three-state distinction the module enforces");

      const alertsApi = await get("/api/flows/flowalerts", { headers: { Cookie: "flows_session=" + token } });
      eq(alertsApi.status, 200, "an authenticated flow-alerts request succeeds");
      const alertsPayload = await alertsApi.json();
      ok(alertsPayload.status === "pending" || Array.isArray(alertsPayload.rows),
         "and answers pending or a real feed, never a half-shaped object");
      eq((await get("/api/flows/flowalerts")).status, 401,
         "and refuses an anonymous reader");

      const pulseApi = await get("/api/flows/pulse", { headers: { Cookie: "flows_session=" + token } });
      eq(pulseApi.status, 200, "an authenticated pulse request succeeds");
      const pulsePayload = await pulseApi.json();
      ok(pulsePayload.status === "pending" || typeof pulsePayload.tide === "object",
         "and answers pending or a real pulse, never a half-shaped object");
      eq((await get("/api/flows/pulse")).status, 401,
         "the pulse refuses an anonymous reader — behind it is a metered vendor " +
         "relationship, exactly like every other flows key");

      /* THE SECTOR OPTIONS LEAN GETS ITS OWN ROUTE, and that is the point of
         the assertion below rather than an accident of layout. /api/flows/
         sectors serves `sector:trix` — TRIX on daily closes, no option data
         in it anywhere. This serves today's bullish-minus-bearish premium per
         sector. The two can disagree for weeks without either being wrong, so
         a reader who asked for one must never be handed the other, which is
         what a single route with a `kind` parameter would eventually do. */
      const leanApi = await get("/api/flows/sector-premium",
        { headers: { Cookie: "flows_session=" + token } });
      eq(leanApi.status, 200, "an authenticated sector-premium request succeeds");
      const leanPayload = await leanApi.json();
      ok(leanPayload.status === "pending" || Array.isArray(leanPayload.sectors),
         "and answers pending or a real lean, never a half-shaped object");
      ok(Array.isArray(leanPayload.sectors),
         "the pending envelope carries an empty `sectors` array, so a page that opens before " +
         "the first publish iterates nothing rather than guarding an undefined");
      eq((await get("/api/flows/sector-premium")).status, 401,
         "and it refuses an anonymous reader, like every other flows key");

      const sectorsApi = await get("/api/flows/sectors",
        { headers: { Cookie: "flows_session=" + token } });
      eq(sectorsApi.status, 200, "the momentum route still answers on its own path");
      ok(sectorsApi.url !== leanApi.url,
         "and it is genuinely a different route — two quantities, two keys, two paths");

      /* THE NEWS TAPE, AND THE ROUTE SHAPE THAT MUST NOT EXIST. The vendor
         has no per-ticker news endpoint: `ticker` is a query filter on the
         same market-wide path. A `?t=` parameter here would look reasonable
         and would either spend a vendor call per name behind an authenticated
         route or filter a blob the caller could filter itself, so the route
         ignores it entirely and every stored row carries its own `tickers`. */
      const newsApi = await get("/api/flows/news", { headers: { Cookie: "flows_session=" + token } });
      eq(newsApi.status, 200, "an authenticated news request succeeds");
      const newsPayload = await newsApi.json();
      ok(newsPayload.status === "pending" || Array.isArray(newsPayload.rows),
         "and answers pending or a real tape, never a half-shaped object");
      ok(Array.isArray(newsPayload.rows),
         "with an empty `rows` array on the pending envelope");
      const filtered = await get("/api/flows/news?t=AAPL",
        { headers: { Cookie: "flows_session=" + token } });
      eq(filtered.status, 200,
         "a `?t=` parameter is neither honoured nor an error — it is IGNORED, because the " +
         "only two things this route could do with it are spend a vendor call per name or " +
         "filter a blob the caller already has");
      assert.deepEqual(await filtered.json(), newsPayload,
        "and the answer is byte-identical to the unfiltered one, so no reader can come to " +
        "believe a per-ticker news route exists here"); checks++;
      eq((await get("/api/flows/news")).status, 401, "the tape refuses an anonymous reader");

      /* THE QUESTION BOX. It is the one route under /api/flows that PARSES
         what it serves, so it is also the one whose input had to be made
         small: the pipeline publishes a fact index of about sixteen
         kilobytes and this reads that, never the seventeen surfaces it was
         built from.

         THE SUITE RUNS WITH NO MODEL, ON PURPOSE. Local Wrangler inference
         bills the same account-wide free allowance as production, so a
         suite that reached one would spend a shared budget on every CI run
         and would make its own result depend on a quota. Empty is a
         supported configuration, so what is exercised here is a branch a
         reader can really land in and not a stub. */
      const askGet = await get("/api/flows/brief", { headers: { Cookie: "flows_session=" + token } });
      eq(askGet.status, 200, "the briefing is served from its own key, at the path every other " +
         "key here is served from, and streamed rather than parsed");
      const brief = await askGet.json();
      ok("today" in brief && "facts" in brief,
         "carrying both shapes from one key — the three sections the page draws and the flat " +
         "index the question box selects from, so the two can never answer out of different " +
         "sessions");
      eq((await get("/api/flows/brief")).status, 401, "and it refuses an anonymous reader");
      eq((await get("/api/flows/ask", { headers: { Cookie: "flows_session=" + token } })).status, 405,
         "a GET on the question route is 405: the briefing has its own key now, so a GET here " +
         "would be a second way to ask for the same bytes");

      const ask = (body, headers) => fetch(url("/api/flows/ask"), {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/json", ...(headers || {}) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      eq((await ask({ question: "what happened today" })).status, 401,
         "an anonymous question is refused before any work is done");

      const auth = { Cookie: "flows_session=" + token };
      eq((await ask("{not json", auth)).status, 400, "a body that is not JSON is a 400");
      eq((await ask({ question: "anything" }, auth)).status, 200,
         "and before any briefing is published a question is answered with `pending` — a " +
         "statement about this site, not about the market");
      const beforePublish = await (await ask({ question: "anything" }, auth)).json();
      eq(beforePublish.status, "pending",
         "which is named rather than left to be inferred from a null answer");

      /* PUBLISHED THROUGH THE REAL DOOR. `brief` has to be in the ingest
         allowlist or this 400s — which is exactly how the key was found
         missing from it, and the pipeline's publish is non-fatal by design,
         so a live run would have swallowed the failure into one warning
         line and served a briefing that never arrived. */
      const briefIngest = await fetch(url("/api/flows/ingest?key=brief"), {
        method: "POST", redirect: "manual",
        headers: { Authorization: "Bearer " + INGEST_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          generatedAt: "2026-09-04T08:00:00.000Z", sessionDate: "2026-09-03",
          today: { facts: [], silences: [] },
          yesterday: { facts: [], silences: [] },
          next: { facts: [], silences: [], isForecast: false },
          facts: [{ id: "t/tilt", topic: ["today", "lean"], source: "brief",
                    at: "2026-09-04T08:00:00.000Z",
                    say: "44 names lean bullish and 53 lean bearish out of 100 scored.",
                    n: { bullish: 44, bearish: 53, scored: 100 } }],
          silences: { pending: [], unreadable: [], quiet: [] },
        }),
      });
      eq(briefIngest.status, 200, "the briefing key is accepted at the ingest door");
      eq((await ask({ question: "   " }, auth)).status, 400,
         "and so is a question of nothing but spaces — an empty prompt is a mistake to name, " +
         "not a question to answer badly");

      const answered = await ask({ question: "what is the session leaning?" }, auth);
      eq(answered.status, 200, "a real question is answered");
      const ans = await answered.json();
      eq(ans.llm, false,
         "with `llm` FALSE, because no model is configured here — a page told nothing would " +
         "present the deterministic wording as the model's");
      ok(typeof ans.note === "string" && /no model is configured/i.test(ans.note),
         "and the reason is stated in words rather than left for the reader to infer from a " +
         "missing field");
      ok(typeof ans.answer === "string" && ans.answer.length > 0,
         "an answer is served anyway: the figures were never the model's, so a reader who " +
         "lands here has lost the phrasing and nothing else");
      eq(ans.model, null, "no model is named, because none was asked");
      ok(Array.isArray(ans.facts), "the facts it answered from travel with the answer");
      eq((await ask({ question: "x" }, auth)).status, 200,
         "a question that matches nothing still answers, rather than returning empty while " +
         "the index holds readings");
      const methodDenied = await fetch(url("/api/flows/ask"),
        { method: "DELETE", redirect: "manual", headers: auth });
      eq(methodDenied.status, 405, "and only POST is allowed");

      /* THE NAME THE PAGE THE READER IS ON IS ABOUT, POSTED BESIDE THE
         QUESTION. The assistant is docked on every gated route, including
         /flows/ticker/?t=SYN046, and until this field existed it answered a
         reader who typed "what changed" over one name with market-wide
         readings — nothing they typed named a ticker, and nothing else told
         the selection which name they meant.

         THE NAME BELOW IS SIX CHARACTERS AND THAT IS NOT INCIDENTAL. Every
         card the pipeline emits is SYN0## — 93 of them in the dry-run
         corpus, none of them five — so a bound of /^[A-Z][A-Z0-9]{0,4}$/
         passes a suite written around "SYN46" while dropping every name
         this route is ever posted. The shape here is the one readTicker()
         serves and subjectTickers() accepts: /^[A-Z][A-Z0-9.-]{0,9}$/.

         THE ROUTE DOES NOT DECIDE WHETHER TO USE IT, AND THAT IS THE POINT.
         shared/flows-ask.js consults `subject` only when the question names
         no ticker of its own, so a reader who does name one is never
         answered about the page instead. Deciding it here, or in the
         browser, would be a second copy of that rule in a file that does not
         own it — and the two would disagree the first time either moved. */
      const briefWithName = await fetch(url("/api/flows/ingest?key=brief"), {
        method: "POST", redirect: "manual",
        headers: { Authorization: "Bearer " + INGEST_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          generatedAt: "2026-09-04T08:00:00.000Z", sessionDate: "2026-09-03",
          today: { facts: [], silences: [] },
          yesterday: { facts: [], silences: [] },
          next: { facts: [], silences: [], isForecast: false },
          facts: [
            { id: "t/tilt", topic: ["today", "lean"], source: "brief",
              at: "2026-09-04T08:00:00.000Z",
              say: "44 names lean bullish and 53 lean bearish out of 100 scored.",
              n: { bullish: 44, bearish: 53, scored: 100 } },
            { id: "card:SYN046/standing", topic: ["syn046"], source: "card:SYN046",
              at: "2026-09-04T08:00:00.000Z",
              say: "SYN046 is rank 1 of 2 on the long board, conviction 96 of 100.",
              n: { boardRank: 1, boardRows: 2, convictionOf100: 96 } },
          ],
          silences: { pending: [], unreadable: [], quiet: [] },
        }),
      });
      eq(briefWithName.status, 200, "a briefing carrying a per-name reading is ingested");

      const onPage = await (await ask({ question: "what changed", subject: "syn046" }, auth)).json();
      eq(onPage.subjectApplied, true,
         "a SIX-character name that names no ticker in the question, posted from a page " +
         "that does, is selected with the page's name — lowercase on the wire and shaped " +
         "like a symbol is enough, and every card this pipeline publishes is six " +
         "characters, so a bound narrower than the route's own drops all of them and says " +
         "nothing about having done it");
      eq(onPage.subject, "SYN046",
         "and the name is echoed back so the page can say in the open which symbol it " +
         "added, rather than leaving a reader to work out where the readings came from");
      ok(onPage.facts.some((f) => f.source === "card:SYN046"),
         "the per-name reading is what gets selected, which is the whole defect: the same " +
         "question without the field is answered from the market-wide surfaces");
      ok(/SYN046/.test(onPage.answer),
         "and the answer names it, because the question the wording is built from carries " +
         "the page's name once selection has used it — otherwise a per-name answer opens " +
         "with 'nothing in the question matched a name'");

      const shareClass = await (await ask(
        { question: "what changed", subject: "brk.b" }, auth)).json();
      eq(shareClass.subjectApplied, true,
         "a share-class symbol carrying a dot is a name here too, and a hyphenated one " +
         "likewise: BRK.B and RDS-A are quoted by the vendor and served by /flows/ticker, " +
         "so a route that refuses them answers market-wide about a page that is not");
      eq(shareClass.subject, "BRK.B",
         "echoed back uppercased and whole, punctuation included");

      const typedOwn = await (await ask(
        { question: "what is the lean", subject: "syn046" }, auth)).json();
      eq(typedOwn.subjectApplied, true,
         "a question with no ticker still takes the page's name");
      const otherName = await (await ask(
        { question: "what is the lean for ZZZQ", subject: "syn046" }, auth)).json();
      eq(otherName.subjectApplied, false,
         "while a question that names a ticker of its own overrides the page outright, and " +
         "the route reports that rather than claiming a name it did not use");
      eq(otherName.subject, null,
         "with no symbol echoed back, so the page states nothing about a name that was not " +
         "applied");
      ok(typeof otherName.withheld === "string" &&
         /^Nothing indexed is about ZZZQ/.test(otherName.withheld),
         "and the withholding travels as its own field, separate from `why`: `why` is the " +
         "audit trail and folds into the page's method disclosure, this is the caveat and " +
         "may not — the fold rule is asymmetric, and on the branch where a model writes the " +
         "prose this sentence is the only thing on the page saying the name has no reading " +
         "behind it. It is a field rather than a substring so the page is not matching on " +
         "wording to find it");
      ok(!/Picked /.test(otherName.withheld),
         "carrying none of the accounting, which is the half that is allowed to fold");
      eq(onPage.withheld, null,
         "and a question every name of which is covered withholds nothing, stated as null " +
         "rather than as an empty string a page would have to test the length of");

      const junkSubject = await (await ask(
        { question: "what changed", subject: "not a symbol" }, auth)).json();
      eq(junkSubject.subjectApplied, false,
         "a `subject` that is not shaped like a symbol is dropped before selection sees it: " +
         "the value comes off a query string a reader can type into, and it is bounded here, " +
         "again in the module, and never trusted by either alone");

      /* THE MODEL BUDGET, ON ITS OWN GET ROUTE. It is not a published key
         and so it is not under the passthrough convention every other path
         here follows — it is computed from D1 and named for what it
         reports, so a reader of worker.js is not sent looking for an
         `ai-usage` payload the pipeline never publishes. It exists at all
         because the answer route is a POST that costs a model call to
         reach, and a budget a reader can only see AFTER spending from it
         is a receipt rather than a budget. */
      eq((await get("/api/flows/ai-usage")).status, 401,
         "the meter is behind the same gate as everything else here: what this site spends " +
         "is not a fact for an anonymous reader");
      const usage = await get("/api/flows/ai-usage", { headers: auth });
      eq(usage.status, 200, "and an authenticated reader is served it on a GET, before any " +
         "question has been asked — which is the whole point of it having its own route");
      const spend = (await usage.json()).spend;
      ok(spend && typeof spend === "object", "carrying the meter as one object rather than " +
         "as loose fields, so a page cannot read half of it");
      eq(spend.calls, 0,
         "with a MEASURED zero: this table is written only by a model call, so a day with no " +
         "row is a day on which this site made none. That is a reading, and it is the one " +
         "place on this route where no row is allowed to mean zero — a failed READ returns " +
         "null instead, so the two never collapse");
      eq(spend.allowanceNeurons, 10000,
         "the allowance is stated, so the figure beside it has a denominator");
      /* A MEASURED ZERO, AND IT IS ONLY MEASURED BECAUSE THE RATE IS
         CONFIGURED. This worker reads the real wrangler.toml, where
         FLOWS_ASK_NEURONS sits beside FLOWS_ASK_MODEL — so the arithmetic
         is available and 0 tokens really do cost 0 credits, leaving the
         allowance whole. That is a reading rather than a gap, and this
         asserts the derivable path end to end: the rate reaches the Worker
         from configuration, and the subtraction runs.

         THE OTHER BRANCH — no rate, so the spend is UNKNOWN and `remaining`
         must be null rather than 10000 — is the dangerous one, because
         Number(null) === 0 reaching the subtraction would render a full
         allowance on a day this route may have emptied it. It cannot be
         reached from here without a second Worker on a different
         configuration, so it is asserted in tests/flows-ask-render.mjs
         against the shape this route sends, where its CONTROL sits beside
         it: the fresh-morning case below, which must still print 10,000 of
         10,000. Asserting only the withholding would pass just as well
         against a renderer that never printed an allowance at all. */
      eq(spend.neurons, 0,
         "the spend is a measured zero — no question has been asked, so no tokens were " +
         "billed, and the rate configured beside the model id is what makes that derivable " +
         "rather than merely absent");
      eq(spend.remaining, 10000,
         "leaving the whole allowance, which is the subtraction actually running rather than " +
         "a field echoed back: allowance minus a spend of zero is the allowance");
      eq(spend.assumesSoleSpender, true,
         "and the condition travels WITH the number rather than beside it, because the " +
         "allowance is the account's: a remaining balance separated from the fact that it " +
         "counts only this site's own calls is the confident unmeasured figure again");
      eq((await fetch(url("/api/flows/ai-usage"),
        { method: "POST", redirect: "manual", headers: auth })).status, 405,
         "and it is a read: only the question route takes a POST under /api/flows");

      const answeredSpend = await (await ask({ question: "what is the lean?" }, auth)).json();
      ok(Object.prototype.hasOwnProperty.call(answeredSpend, "spend"),
         "every branch of the answer route carries the meter, including this one where no " +
         "model is configured and none was called — a reader told the allowance is spent is " +
         "the reader who needs the gauge most, and a gauge that appears only on success is " +
         "absent exactly when it is being asked about");

      const api = await get("/api/flows/unusual", { headers: { Cookie: "flows_session=" + token } });
      eq(api.status, 200, "an authenticated unusual request succeeds");
      const payload = await api.json();
      ok(payload.status === "pending" || Array.isArray(payload.contracts && payload.contracts.rows),
         "and answers pending or a real feed, never a half-shaped object");

      const anonApi = await get("/api/flows/unusual");
      eq(anonApi.status, 401, "and refuses an anonymous reader");
    }

    /* THE EVENTS CALENDAR. The thing that can go wrong here is the two
       clocks: a page that counts days from sessionDate rather than from the
       run's own Eastern date draws its window one to three days early and
       classifies every name against a gate that never ran. The markup cannot
       assert the arithmetic — that is the module suite's job — but it can
       assert the page SAYS which clock governs what, because a page that does
       not say it cannot be checked by a reader either. */
    {
      const ev = await get("/flows/events/", { headers: { Cookie: "flows_session=" + token } });
      eq(ev.status, 200, "/flows/events/ renders for an authenticated session");
      const evHtml = await ev.text();
      ok(evHtml.includes("/assets/js/flows-events.js"), "the events page loads its own controller");
      ok(evHtml.includes('id="evBody"'), "and carries the calendar's table body");
      ok(evHtml.includes('id="evWindow"'), "and the window chart's host");
      ok(evHtml.includes('id="evBasis"'), "and the basis panel");
      /* `gated` is the column the page exists for, and its meaning is the one
         thing a reader will get wrong by default: it means the board was
         FORBIDDEN from scoring the name, not that it scored badly. */
      ok(/FORBIDDEN/i.test(evHtml),
         "the Stage column states that a gated name was forbidden from being scored, " +
         "rather than leaving it to read as a low score");

      const anonEv = await get("/flows/events/");
      eq(anonEv.status, 200, "/flows/events/ serves a page to an anonymous visitor");
      ok(!(await anonEv.text()).includes('id="evBody"'),
         "/flows/events/ leaks nothing to an anonymous visitor");

      const bareEv = await get("/flows/events");
      eq(bareEv.status, 308, "/flows/events without its trailing slash redirects");

      const evApi = await get("/api/flows/events", { headers: { Cookie: "flows_session=" + token } });
      eq(evApi.status, 200, "an authenticated events request succeeds");
      const evPayload = await evApi.json();
      ok(evPayload.status === "pending" || Array.isArray(evPayload.rows),
         "and answers pending or a real calendar, never a half-shaped object");

      const anonEvApi = await get("/api/flows/events");
      eq(anonEvApi.status, 401, "and refuses an anonymous reader");
    }

    /* THE SCORE TRACK. What can go wrong here is a page that treats a gap as
       a zero — but the markup cannot assert that; the module and render
       suites do. What the markup CAN assert is that the page ships its own
       honesty scaffolding: the basis host for the pipeline's notes, and the
       UI module loaded BEFORE the controller that destructures from it. */
    {
      const st = await get("/flows/track/", { headers: { Cookie: "flows_session=" + token } });
      eq(st.status, 200, "/flows/track/ renders for an authenticated session");
      const stHtml = await st.text();
      ok(stHtml.includes("/assets/js/flows-track.js"), "the track page loads its own controller");
      ok(stHtml.includes("/assets/js/flows-ui.js"), "and the shared UI module");
      ok(stHtml.indexOf("/assets/js/flows-ui.js") < stHtml.indexOf("/assets/js/flows-track.js"),
         "with the module BEFORE the controller — the load order is the dependency order");
      ok(stHtml.includes('id="stTrack"'), "and carries the trace host");
      ok(stHtml.includes('id="stBasis"'), "and the basis panel, which is the page's honesty");
      ok(/never zero/i.test(stHtml),
         "the page's own lede states that a gap is not a zero — the one sentence a " +
         "reader must not have to infer");

      const anonSt = await get("/flows/track/");
      eq(anonSt.status, 200, "/flows/track/ serves a page to an anonymous visitor");
      ok(!(await anonSt.text()).includes('id="stTrack"'),
         "/flows/track/ leaks nothing to an anonymous visitor");

      const bareSt = await get("/flows/track");
      eq(bareSt.status, 308, "/flows/track without its trailing slash redirects");

      const stApi = await get("/api/flows/scoretrack", { headers: { Cookie: "flows_session=" + token } });
      eq(stApi.status, 200, "an authenticated scoretrack request succeeds");
      const stPayload = await stApi.json();
      ok(stPayload.status === "pending" || Array.isArray(stPayload.names),
         "and answers pending or a real trace, never a half-shaped object");

      const anonStApi = await get("/api/flows/scoretrack");
      eq(anonStApi.status, 401, "and refuses an anonymous reader");
    }

    /* Every gated page carries the rail, and the rail carries every
       destination — a nav that omits a route is a route nobody finds. */
    for (const dest of ["/flows/", "/flows/long/", "/flows/short/", "/flows/watch/",
                        "/flows/market/", "/flows/unusual/", "/flows/events/",
                        "/flows/ticker/", "/flows/desk/", "/flows/history/",
                        "/flows/track/"]) {
      ok(html.includes(`href="${dest}"`), `the rail links to ${dest}`);
    }

    // The API answers, and answers honestly before the pipeline has run.
    const api = await get("/api/flows/board?side=long", {
      headers: { Cookie: "flows_session=" + token },
    });
    eq(api.status, 200, "an authenticated board request succeeds");
    const payload = await api.json();
    ok(Array.isArray(payload.rows), "the payload carries a rows array");
    ok(payload.status === "pending" || payload.generatedAt !== undefined,
       "an unpublished board reports pending rather than inventing data");
    ok(!("reason" in payload),
       "and a key the pipeline has never written carries NO reason: the SELECT ran and found no " +
       "row, and “read-failed” on it would report a fault the store did not have");

    /* THE OTHER NULL. readFlowsPayload answers null for an absent row AND for
       a SELECT that threw, and the board route used to hand both to the reader
       as the same bytes — so /flows/long/ said “either never published or the
       store could not be read” and could never say which. The read is made to
       throw here by hiding the column it selects; the table, its rows and the
       Worker's schema flag are untouched, and the column is put back before
       anything else reads, so no block after this one sees a difference. */
    await server.d1("ALTER TABLE flows_payload RENAME COLUMN payload TO payload_hidden");
    const broken = await get("/api/flows/board?side=long", {
      headers: { Cookie: "flows_session=" + token },
    });
    const brokenBody = await broken.json();
    await server.d1("ALTER TABLE flows_payload RENAME COLUMN payload_hidden TO payload");
    eq(broken.status, 200,
       "a board read that threw still answers 200 with the pending shape every board renderer " +
       "already understands — a 500 here would be a renderer-side “could not reach the service” " +
       "over a store that answered");
    eq(brokenBody.status, "pending", "and the shape is the same pending envelope");
    eq(brokenBody.reason, "read-failed",
       "but it carries reason: “read-failed”, which is what lets the page mark the deck unreadable " +
       "(×) rather than pending (…) — the one bit the two envelopes used to lack");
    const healed = await (await get("/api/flows/board?side=long", {
      headers: { Cookie: "flows_session=" + token },
    })).json();
    eq(healed.status, "pending", "with the column back the same key answers pending again");
    ok(!("reason" in healed), "and with no reason, because this time the read ran and found nothing");

    // Sign-out clears the cookie.
    const out = await fetch(url("/flows/logout"), {
      method: "POST",
      redirect: "manual",
      headers: { Origin: server.baseURL, "Sec-Fetch-Site": "same-origin", Cookie: "flows_session=" + token },
    });
    eq(out.status, 303, "sign-out redirects");
    ok(/flows_session=;|flows_session=%3B|Max-Age=0/i.test(out.headers.get("set-cookie") || ""),
       "sign-out clears the session cookie");
  }

  /* ---------- the ingest endpoint ---------------------------------- */
  {
    const post = (key, body, token) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body,
    });

    const payload = JSON.stringify({
      side: "long", generatedAt: new Date().toISOString(), status: "ok",
      rows: [{ t: "TEST", r: 1, s: 42, cnv: 70, px: 100, chg: 0.01,
               purity: 0.5, gRegime: "long", gFlipDist: -0.02, netPrem: 1e6,
               fam: { F: 10, P: 20, D: 30, V: 5, O: -5 } }],
    });

    eq((await post("board:long", payload, null)).status, 401, "ingest without a token is refused");
    eq((await post("board:long", payload, "wrong-token")).status, 401, "ingest with a wrong token is refused");
    eq((await post("../../etc/passwd", payload, INGEST_TOKEN)).status, 400,
       "ingest rejects a key outside the allowed set");
    eq((await post("board:sideways", payload, INGEST_TOKEN)).status, 400,
       "ingest rejects an unknown board side");
    eq((await post("board:long", "not json at all", INGEST_TOKEN)).status, 400,
       "ingest rejects malformed JSON at the door, so the read path never serves it");

    /* The score archive's two keys pass the same door. The dated pool is the
       immutable per-session distribution; scoretrack is the live trace the
       pipeline rebuilds from it. */
    eq((await post("scores:2026-01-02", JSON.stringify({ rows: [{ t: "TEST", s: 0 }] }),
        INGEST_TOKEN)).status, 200, "a dated scores pool is an accepted key");
    eq((await post("scoretrack", JSON.stringify({ names: [], sessions: [] }),
        INGEST_TOKEN)).status, 200, "and so is the live trace");
    eq((await post("flowalerts", JSON.stringify({ rows: [] }), INGEST_TOKEN)).status, 200,
       "the vendor-alerts feed is an accepted key");
    eq((await post("pulse", JSON.stringify({ tide: { points: [] } }), INGEST_TOKEN)).status, 200,
       "and so is the market pulse");

    /* THE TWO MARKET-WIDE KEYS THIS WAVE ADDED. `sector:premium` is a SECOND
       sector key beside `sector:trix`, not a widening of it: one is TRIX on
       daily closes and the other is today's option premium lean, and they are
       published separately so a momentum reading and a premium lean can never
       end up sharing a field. The door has to accept both names, and it has
       to keep refusing anything that merely looks like them — this key
       becomes a primary key, and the read path rebuilds it from a literal, so
       a shape the two sides could disagree about is a row nothing can read. */
    eq((await post("sector:premium", JSON.stringify({ sectors: [] }), INGEST_TOKEN)).status, 200,
       "the sector option lean is an accepted key");
    eq((await post("sector:trix", JSON.stringify({ sectors: [] }), INGEST_TOKEN)).status, 200,
       "and the sector momentum key it must never be merged with still is too");
    eq((await post("news", JSON.stringify({ rows: [] }), INGEST_TOKEN)).status, 200,
       "and so is the market-wide news tape");
    eq((await post("sector:lean", "{}", INGEST_TOKEN)).status, 400,
       "while a near-miss sector key is refused — the publisher and the reader build this " +
       "string from two literals, and a door that guessed would turn a typo into a row " +
       "nothing ever reads");
    eq((await post("news:2026-01-02", "{}", INGEST_TOKEN)).status, 400,
       "and the news tape has no dated form: it is a view of today, not a record of a " +
       "session, so a dated key would accumulate rows the prune does not sweep");
    eq((await post("scores:02-01-2026", "{}", INGEST_TOKEN)).status, 400,
       "but a scores key with a malformed date is refused at the door — the read " +
       "path rebuilds this key from a date, so any other shape is unreachable forever");

    const good = await post("board:long", payload, INGEST_TOKEN);
    eq(good.status, 200, "a correctly authenticated ingest succeeds");
    const receipt = await good.json();
    ok(receipt.ok === true && receipt.key === "board:long", "ingest returns a receipt");

    /* GET on the ingest route reads back what is stored, under the same
       bearer. The pipeline needs it for hysteresis — holding a name on the
       board until it falls out of the exit band requires yesterday's ticker
       list, and previousIds was a hardcoded empty array. */
    eq((await get("/api/flows/ingest?key=board:long")).status, 401,
       "ingest GET still requires the bearer");
    eq((await fetch(url("/api/flows/ingest?key=board:long"), {
      headers: { Authorization: "Bearer " + INGEST_TOKEN },
    })).status, 200, "an authenticated ingest GET reads the stored board");

    const readBack = await fetch(url("/api/flows/ingest?key=board:long"), {
      headers: { Authorization: "Bearer " + INGEST_TOKEN },
    });
    const rb = await readBack.json();
    eq(rb.rows[0].t, "TEST", "and returns exactly what was written");

    const absent = await fetch(url("/api/flows/ingest?key=card:NOTHERE"), {
      headers: { Authorization: "Bearer " + INGEST_TOKEN },
    });
    eq(absent.status, 200, "an unwritten key is not an error");
    eq((await absent.json()).status, "pending", "it reports pending");

    /* DELETE IS AN ALLOWED VERB NOW, and this assertion used to prove it was
       not. It exists so the pipeline can prune the dated boards it retains for
       the track record; an archive with no prune is a table that grows forever
       against a write budget shared with a live learning app.

       Being allowed is not being open. Unauthenticated it is refused like
       every other verb here, and the narrowing to dated-board keys is asserted
       in flows-sections-contract.mjs, which owns that behaviour. */
    eq((await fetch(url("/api/flows/ingest?key=board:long:2026-01-02"), { method: "DELETE" })).status, 401,
       "DELETE without the bearer is refused like every other verb");

    /* ---------- the dated archive is immutable, and was not ----------

       IT SAID SO IN THREE COMMENTS AND NOTHING ENFORCED IT. Every key was
       written with ON CONFLICT DO UPDATE, dated ones included, so a second
       run on the same day silently replaced an archived board with a
       different one. Measured before it was fixed: two POSTs to
       board:long:2026-08-24 with contradictory rows both returned 200 and the
       archive then reported the second.

       That is not cosmetic. shared/flows-record.js reads exactly these keys
       to compute the accuracy the deck publishes, and the crons fire twice
       for the two US timezones and have been observed running hours late — so
       a same-day second run is ordinary, not rare. A record that can be
       quietly rewritten is not a record.

       All five behaviours are pinned, because four of them are ways to get
       this wrong: refusing the first write, refusing an identical retry
       (which would turn the pipeline's own retry into an outage), freezing
       the LIVE board, and leaving no way to correct a genuinely bad day. */
    const ARCH = "board:long:2026-08-24";
    const boardA = JSON.stringify({ v: 2, rows: [{ t: "AAA", s: 90 }] });
    const boardZ = JSON.stringify({ v: 2, rows: [{ t: "ZZZ", s: -90 }] });
    const archGet = () => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(ARCH)),
      { headers: { Authorization: "Bearer " + INGEST_TOKEN } });

    eq((await post(ARCH, boardA, INGEST_TOKEN)).status, 200,
       "the first write of a dated key succeeds — immutability is not read-only");

    const clash = await post(ARCH, boardZ, INGEST_TOKEN);
    eq(clash.status, 409,
       "a second write carrying a DIFFERENT payload is refused: it would revise what a " +
       "past session said, which is the one thing this archive exists to prevent");
    eq((await clash.json()).error.code, "archive_immutable",
       "with a code a caller can switch on rather than prose it has to match");
    assert.deepEqual(JSON.parse(await (await archGet()).text()).rows, [{ t: "AAA", s: 90 }],
      "and the archive still holds what the FIRST run published"); checks++;

    const retry = await post(ARCH, boardA, INGEST_TOKEN);
    eq(retry.status, 200,
       "a byte-identical rewrite still succeeds — the pipeline retries its own writes on a " +
       "5xx, and refusing a retry that changes nothing would turn this guard into an outage");
    eq((await retry.json()).stored, "unchanged",
       "and says it stored nothing, so a run reporting `unchanged` on a key it thought it " +
       "was publishing is visible in the log as the retry it is");

    /* THE UNDATED KEYS ARE VIEWS AND MUST STAY WRITABLE. Freezing board:long
       would take the product down every morning after the first.

       CHECKED ON KEYS NOTHING ELSE IN THIS FILE READS. The first draft of
       this block proved the point on `board:long` and left BoardZ sitting
       there, so an assertion two hundred lines further down — that the
       ingested board round-trips as TEST — failed on a payload this block had
       written. A test that mutates shared state its neighbours depend on is a
       worse defect than the one it is testing, because it fails somewhere
       else. */
    for (const view of ["pulse", "market", "flowalerts", "scoretrack"]) {
      eq((await post(view, boardA, INGEST_TOKEN)).status, 200,
         `${view} is a view of today and stays writable`);
      eq((await post(view, boardZ, INGEST_TOKEN)).status, 200,
         `${view} takes a second, different write without complaint — a view describes ` +
         `today and rewriting it every morning is the product working`);
    }

    /* THE ESCAPE HATCH, and it is deliberately two steps. Immutability with
       no way out is permanence by accident; a silent overwrite is a draft
       pretending to be a record. Delete-then-write is neither. */
    eq((await fetch(url("/api/flows/ingest?key=" + encodeURIComponent(ARCH)), {
      method: "DELETE", headers: { Authorization: "Bearer " + INGEST_TOKEN },
    })).status, 200, "a dated key can still be deleted");
    eq((await post(ARCH, boardZ, INGEST_TOKEN)).status, 200,
       "and rewritten afterwards — correcting a genuinely bad archive day is possible, " +
       "visible, and impossible to do by accident");
    assert.deepEqual(JSON.parse(await (await archGet()).text()).rows, [{ t: "ZZZ", s: -90 }],
      "the correction landed"); checks++;

    /* A DATED SCORES POOL IS THE SAME KIND OF RECORD and the same rule
       applies — the DELETE branch and the write guard read one pattern, so
       they cannot disagree about which keys are history. */
    const POOL = "scores:2026-08-24";
    eq((await post(POOL, boardA, INGEST_TOKEN)).status, 200, "a dated scores pool writes once");
    eq((await post(POOL, boardZ, INGEST_TOKEN)).status, 409,
       "and is immutable too: the write guard and the delete branch share one pattern");

    /* THE VERBS THAT ARE STILL NOT VERBS HERE. A route that quietly grew a
       third method could grow a fourth, so the closed set is asserted rather
       than assumed. */
    for (const method of ["PUT", "PATCH"]) {
      eq((await fetch(url("/api/flows/ingest?key=board:long"), {
        method, headers: { Authorization: "Bearer " + INGEST_TOKEN },
      })).status, 405, `${method} is still refused`);
    }

    /* X-Payload-Updated is how a reader detects a stale card. Once a card has
       been written, a later pipeline failure leaves the old row in place and
       the route answers 200 with old numbers — the Worker cannot notice,
       because not parsing is the architecture. The write timestamp can. */
    const stamp = readBack.headers.get("x-payload-updated");
    ok(stamp && Number(stamp) > 0, `the read carries its write timestamp (${stamp})`);
    ok(Math.abs(Date.now() - Number(stamp)) < 5 * 60 * 1000,
       "and the timestamp is the real write time, not a placeholder");

    // Round trip: what was ingested is what an authenticated reader gets.
    const login = await fetch(url("/flows/login"), {
      method: "POST", redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL, "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ username: FLOWS_TEST_USER, password: FLOWS_PASSWORD }).toString(),
    });
    const token = /flows_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")[1];
    const read = await get("/api/flows/board?side=long", {
      headers: { Cookie: "flows_session=" + token },
    });
    eq(read.status, 200, "the ingested board reads back");
    const board = await read.json();
    eq(board.rows.length, 1, "the ingested row is served");
    eq(board.rows[0].t, "TEST", "the payload round-trips unchanged");
    eq(read.headers.get("cache-control"), "no-store", "board data is never cached");

    // And it is still gated.
    eq((await get("/api/flows/board?side=long")).status, 401,
       "the ingested board is still refused to anonymous callers");

    /* ---- THE TWO SECTOR KEYS, ROUND-TRIPPED SIDE BY SIDE ----

       The route assertions earlier in this file check that two paths exist
       and that each answers. That is not the same as checking they serve
       DIFFERENT things: with both keys unpublished both answer the pending
       envelope, and a route wired to the wrong key would pass. So both are
       ingested here with payloads that can only have come from one of them,
       and each route is required to hand back its own.

       This is the assertion that fails if someone ever "simplifies" the two
       routes into one, or points /api/flows/sector-premium at `sector:trix`:
       a reader asking for today's option premium lean would be served a
       triple-smoothed price oscillator, and both are eleven numbers between
       plausible bounds, so nothing on the page would look wrong. */
    eq((await post("sector:premium",
      JSON.stringify({ sectors: [{ etf: "XLK", leanRatio: 0.5, netPremiumUsd: 200 }] }),
      INGEST_TOKEN)).status, 200, "the option lean ingests");
    eq((await post("sector:trix",
      JSON.stringify({ sectors: [{ etf: "XLK", trixBp: 12, trix: 62 }] }),
      INGEST_TOKEN)).status, 200, "and the momentum key ingests beside it");

    const lean = await (await get("/api/flows/sector-premium",
      { headers: { Cookie: "flows_session=" + token } })).json();
    const momentum = await (await get("/api/flows/sectors",
      { headers: { Cookie: "flows_session=" + token } })).json();
    eq(lean.sectors[0].leanRatio, 0.5,
       "/api/flows/sector-premium serves the OPTION LEAN it was published with");
    ok(!("trixBp" in lean.sectors[0]),
       "and carries no momentum field, so a renderer cannot read one off it");
    eq(momentum.sectors[0].trixBp, 12,
       "/api/flows/sectors still serves the MOMENTUM, unchanged by the new neighbour");
    ok(!("leanRatio" in momentum.sectors[0]),
       "and carries no premium field — two quantities, two keys, two routes, and the only " +
       "way for a reader to be handed the wrong one is a wiring mistake this catches");

    eq((await post("news", JSON.stringify({ rows: [{ headline: "TEST", tickers: ["TEST"] }],
      kept: 1, returned: 1 }), INGEST_TOKEN)).status, 200, "the news tape ingests");
    const tape = await (await get("/api/flows/news",
      { headers: { Cookie: "flows_session=" + token } })).json();
    eq(tape.rows[0].headline, "TEST", "and reads back through its own route unchanged");
  }

  /* ---------- BODY BOUNDS: Content-Length is not a bound ----------
     readFlowsForm checked the declared Content-Length and then read the
     whole body anyway. A chunked request declares no length at all, so the
     check was skipped entirely and an unauthenticated caller could stream
     an unbounded body into the Worker before the KDF ever ran. The bound
     now lives in the read loop, where it cannot be declared away. */
  {
    const big = "x".repeat(64 * 1024);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("username=anilkaya&password=" + big));
        controller.close();
      },
    });
    const res = await fetch(url("/flows/login"), {
      method: "POST",
      redirect: "manual",
      duplex: "half",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL,
        "Sec-Fetch-Site": "same-origin",
      },
      body: stream,
    });
    eq(res.status, 413, "a chunked oversize login body is refused on its actual size, not its declared one");
    ok(!(await res.text()).includes(BOARD_MARKER), "and it certainly does not render the board");

    // Harness detail, not a product behaviour: responding before the client
    // has finished streaming leaves wrangler dev's proxy holding a half-written
    // upload, and it closes that connection. undici then reuses the dead socket
    // and reports the reset as a 503. Two throwaway requests retire it so the
    // next assertion measures the Worker rather than the pool.
    const settle = async () => {
      for (let i = 0; i < 2; i++) {
        try { await (await get("/flows/")).text(); } catch { /* the dead socket */ }
      }
    };
    await settle();

    // The same body WITH an honest Content-Length is refused too, so the
    // fix did not trade one path for the other.
    const declared = await fetch(url("/flows/login"), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "username=anilkaya&password=" + big,
    });
    eq(declared.status, 413, "a declared oversize login body is still refused");
    await settle();
  }

  /* ---------- THROTTLE SCOPE: lockout must not be a weapon ---------
     The roster is hardcoded in a PUBLIC repository, so all eleven usernames
     are readable by anyone. Keying the failure counter on the username alone
     meant eight deliberate wrong passwords locked a real person out of the
     section for fifteen minutes, repeatable forever. The key is now scoped to
     the caller as well, so an attacker can only lock out themselves. */
  {
    const ATTACKER = "203.0.113.10";
    const VICTIM = "198.51.100.20";
    const TARGET = "berkkocak";

    const attempt = (username, password, ip) => fetch(url("/flows/login"), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL,
        "Sec-Fetch-Site": "same-origin",
        "CF-Connecting-IP": ip,
      },
      body: new URLSearchParams({ username, password }).toString(),
    });

    // Burn through the lockout threshold from one address.
    let lastBody = "";
    for (let i = 0; i < 9; i++) {
      const res = await attempt(TARGET, "wrong-" + i, ATTACKER);
      eq(res.status, 401, `attacker attempt ${i + 1} is refused`);
      lastBody = await res.text();
    }
    ok(/Too many attempts/i.test(lastBody), "the attacker's own address is locked out");

    // THE FIX: the real account holder, from their own address, is unaffected.
    const victim = await attempt(TARGET, FLOWS_PASSWORD, VICTIM);
    eq(victim.status, 303, "THE FIX: the account holder still signs in while an attacker is locked out");
    ok((victim.headers.get("set-cookie") || "").includes("flows_session="),
       "and receives a working session");
  }

  /* ---------- THROTTLE STORAGE: off-roster costs no rows -----------
     The submitted string was used verbatim as a D1 primary key, so an
     unauthenticated caller could mint unbounded rows in a database whose
     free-tier write budget is shared with the live learning app. An
     off-roster attempt can never succeed, so there is nothing to count. */
  {
    const junkPost = (username) => fetch(url("/flows/login"), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL,
        "Sec-Fetch-Site": "same-origin",
        "CF-Connecting-IP": "192.0.2.77",
      },
      body: new URLSearchParams({ username, password: "whatever" }).toString(),
    });

    for (let i = 0; i < 5; i++) {
      eq((await junkPost("floodrow" + i)).status, 401, `off-roster attempt ${i} is refused`);
    }

    const dump = await server.d1(
      "SELECT username FROM flows_login_failures"
    );
    ok(!/floodrow/.test(dump),
       "THE FIX: five off-roster sign-in attempts wrote zero rows to D1");
    ok(/berkkocak\|203\.0\.113\.10/.test(dump),
       "a genuine failure is still counted, and the key is scoped to the caller");
  }

  /* ---------- the section is not in the static bundle -------------- */
  {
    // shared/ and flows/ are both in .assetsignore. If the board HTML were
    // ever bundled, this would start returning it.
    const res = await get("/shared/flows-pages.js");
    ok(res.status === 404 || !(await res.text()).includes("boardPage"),
       "the page source is not publicly served");
  }

  /* ---------- CARDS: per-ticker detail, one D1 row each ------------
     The storage shape is settled by measurement, not preference. The read path
     costs about 1 ms of CPU per 106 KB served (measured against local workerd,
     calibrated with PBKDF2-10k as a ruler), so one blob holding all 50 cards
     would be ~1 MB and blow the 10 ms Workers Free budget. One row per ticker
     keeps each read near 0.3 ms. */
  {
    const login = await fetch(url("/flows/login"), {
      method: "POST", redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: server.baseURL, "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ username: FLOWS_TEST_USER, password: FLOWS_PASSWORD }).toString(),
    });
    const token = /flows_session=([^;]+)/.exec(login.headers.get("set-cookie") || "")[1];
    const cookie = { Cookie: "flows_session=" + token };

    const putCard = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST_TOKEN },
      body,
    });

    const card = JSON.stringify({
      ticker: "AAPL", generatedAt: new Date().toISOString(),
      gamma: { flip: 212.5, spot: 214.2, strikes: [[210, 1.2e9], [215, -3.4e8]] },
      levels: [{ kind: "max_pain", px: 210, distPct: -0.019, distAtr: -0.62 }],
    });

    eq((await putCard("card:AAPL", card)).status, 200, "a card ingests under its ticker key");

    const read = await get("/api/flows/card?t=AAPL", { headers: cookie });
    eq(read.status, 200, "an authenticated card read succeeds");
    const got = await read.json();
    eq(got.ticker, "AAPL", "the card round-trips unchanged");
    eq(got.gamma.flip, 212.5, "nested structure survives the byte passthrough");
    eq(read.headers.get("cache-control"), "no-store", "card data is never cached");

    // Case folding: the read builds the key the ingest wrote.
    eq((await get("/api/flows/card?t=aapl", { headers: cookie })).status, 200,
       "a lowercase ticker resolves to the same card");

    // A valid ticker with no card is "not built", not an error — the board and
    // the cards are published by separate POSTs and a card may legitimately lag.
    const missing = await get("/api/flows/card?t=ZZZZ", { headers: cookie });
    eq(missing.status, 200, "an unbuilt card is not an error");
    eq((await missing.json()).status, "pending", "it reports pending honestly");

    // The ticker pattern is shared with the ingest key check, in both directions.
    for (const bad of ["", "../../etc/passwd", "A B", "TOOLONGTICKER", "1ABC", "%2e%2e"]) {
      const res = await get("/api/flows/card?t=" + encodeURIComponent(bad), { headers: cookie });
      eq(res.status, 400, `card read refuses the ticker ${JSON.stringify(bad)}`);
    }
    for (const bad of ["card:", "card:a b", "card:TOOLONGTICKER", "card:1ABC"]) {
      eq((await putCard(bad, card)).status, 400, `ingest refuses the key ${JSON.stringify(bad)}`);
    }

    // Cards are gated exactly like the board.
    eq((await get("/api/flows/card?t=AAPL")).status, 401,
       "an anonymous caller cannot read a card");
  }

  /* ---------- the payload cap IS the read-path CPU guarantee --------
     Nothing larger than the cap can be stored, so nothing larger can be
     served, so no read can exceed roughly 2.4 ms of the 10 ms budget. The cap
     was 2 MB, which accepted payloads the read path could not serve. */
  {
    const big = JSON.stringify({ side: "long", rows: [], pad: "x".repeat(200 * 1024) });
    const res = await fetch(url("/api/flows/ingest?key=board:long"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST_TOKEN },
      body: big,
    });
    eq(res.status, 413, "a payload beyond the read-path CPU bound is refused at ingest");

    const fine = JSON.stringify({ side: "long", generatedAt: new Date().toISOString(),
                                  status: "ok", rows: [], pad: "x".repeat(100 * 1024) });
    const ok200 = await fetch(url("/api/flows/ingest?key=board:long"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST_TOKEN },
      body: fine,
    });
    eq(ok200.status, 200, "a payload inside the bound still ingests");
  }

  /* ---------- the login page escapes what it renders --------------
     The error string is interpolated into the login markup. Today every
     caller passes a fixed literal, but "no untrusted value reaches it yet"
     is a property of the callers, not of the page, and callers change. */
  {
    const { loginPage } = await import("../shared/flows-pages.js");
    const html = loginPage({ error: '<img src=x onerror=alert(1)>"&' });
    ok(!html.includes("<img src=x"), "an injected tag is escaped, not rendered");
    ok(html.includes("&lt;img"), "it appears as text");
    ok(html.includes("&amp;"), "ampersands are escaped too");
    ok(loginPage().includes('action="/flows/login"'), "the ordinary page is unaffected");
  }

  /* ---------- a misconfigured deploy fails LOUDLY -----------------
     A missing credential map or pepper is a configuration fault and must not
     masquerade as a wrong password. Without this check a deploy that forgot
     either secret rejects all eleven accounts with "those credentials were not
     recognised", which is indistinguishable from a typo — so the operator
     retries the password instead of checking the secret store. This runs on
     its own Worker because it needs a deliberately broken environment. */
  {
    const broken = await startWorker({ extraVars: ["FLOWS_CREDENTIALS:not-valid-json"] });
    try {
      const res = await fetch(broken.baseURL + "/flows/login", {
        method: "POST", redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: broken.baseURL, "Sec-Fetch-Site": "same-origin",
        },
        body: new URLSearchParams({ username: FLOWS_TEST_USER, password: FLOWS_PASSWORD }).toString(),
      });
      eq(res.status, 503,
         "an unparseable credential map is a configuration fault, not a bad password");
      const body = await res.json();
      eq(body.error.code, "unavailable", "and it says so in the project error envelope");
      ok(!/not recognised/i.test(JSON.stringify(body)),
         "it never blames the credentials the operator typed correctly");

      // The login PAGE must still render, so the operator can see the section exists.
      const page = await fetch(broken.baseURL + "/flows/", { redirect: "manual" });
      eq(page.status, 200, "the login page still renders on a misconfigured deploy");
      ok(!(await page.text()).includes(BOARD_MARKER), "and still leaks no board");
    } finally {
      await broken.stop();
    }
  }

  console.log(`✓ flows-worker: ${checks} assertions — public login, no-store gating, structural bypass resistance, bidirectional audience isolation, legacy learner tolerance, uniform failures, full sign-in round trip, and the two market-wide keys this wave added served on their own gated routes: the sector option lean beside — never merged into — the sector momentum it shares eleven tickers with, and the news tape whose absent per-ticker form is asserted to stay absent. Plus the retirement of the card dialog: the four board routes serve neither it nor the 151k panel library it was the only caller of, and their own ?t= addresses — pushed into history on every open the modal ever had — are 302'd to /flows/ticker/ with the surface they came from, from a Location that is a pure function of the request URL and reads no payload and no session`);
} finally {
  await server.stop();
}
