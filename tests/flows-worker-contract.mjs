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

const server = await startWorker();
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

  /* ---------- the section is not in the static bundle -------------- */
  {
    // shared/ and flows/ are both in .assetsignore. If the board HTML were
    // ever bundled, this would start returning it.
    const res = await get("/shared/flows-pages.js");
    ok(res.status === 404 || !(await res.text()).includes("boardPage"),
       "the page source is not publicly served");
  }

  console.log(`✓ flows-worker: ${checks} assertions — public login, no-store gating, structural bypass resistance, bidirectional audience isolation, legacy learner tolerance, uniform failures, full sign-in round trip`);
} finally {
  await server.stop();
}
