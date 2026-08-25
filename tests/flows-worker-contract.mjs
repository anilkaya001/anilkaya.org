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

/* A marker that appears only in the authenticated board, never in the login
   page — the single most useful signal for "did the gate leak". */
const BOARD_MARKER = 'id="flowsBody"';

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
    ok(html.includes("/assets/js/flows-board.js"), "the board loads its controller");

    // The API answers, and answers honestly before the pipeline has run.
    const api = await get("/api/flows/board?side=long", {
      headers: { Cookie: "flows_session=" + token },
    });
    eq(api.status, 200, "an authenticated board request succeeds");
    const payload = await api.json();
    ok(Array.isArray(payload.rows), "the payload carries a rows array");
    ok(payload.status === "pending" || payload.generatedAt !== undefined,
       "an unpublished board reports pending rather than inventing data");

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

    const good = await post("board:long", payload, INGEST_TOKEN);
    eq(good.status, 200, "a correctly authenticated ingest succeeds");
    const receipt = await good.json();
    ok(receipt.ok === true && receipt.key === "board:long", "ingest returns a receipt");

    eq((await get("/api/flows/ingest")).status, 405, "ingest is POST-only");

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
    const big = JSON.stringify({ side: "long", rows: [], pad: "x".repeat(300 * 1024) });
    const res = await fetch(url("/api/flows/ingest?key=board:long"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST_TOKEN },
      body: big,
    });
    eq(res.status, 413, "a payload beyond the read-path CPU bound is refused at ingest");

    const fine = JSON.stringify({ side: "long", generatedAt: new Date().toISOString(),
                                  status: "ok", rows: [], pad: "x".repeat(200 * 1024) });
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

  console.log(`✓ flows-worker: ${checks} assertions — public login, no-store gating, structural bypass resistance, bidirectional audience isolation, legacy learner tolerance, uniform failures, full sign-in round trip`);
} finally {
  await server.stop();
}
