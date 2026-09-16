import assert from "node:assert/strict";
import { signSession } from "../shared/session.js";
import { TICKER_PANELS } from "../shared/flows-panels.js";
import { archiveWriteAction, ARCHIVE_REFUSALS } from "../shared/flows-archive.js";
import { UA_BANNED_CLAIMS } from "../shared/flows-unusual.js";
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

const BOARD_MARKER = 'class="flows-rail"';

try {

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

  {
    const res = await get("/flows");
    eq(res.status, 308, "GET /flows redirects to the canonical trailing slash");
    ok((res.headers.get("location") || "").endsWith("/flows/"), "redirect target is /flows/");
  }

  {
    const res = await get("/flows/login");
    eq(res.status, 405, "GET /flows/login is refused");
    ok((res.headers.get("allow") || "").includes("POST"), "405 advertises POST");

    const out = await get("/flows/logout");
    eq(out.status, 405, "GET /flows/logout is refused (no CSRF sign-out)");
  }

  {
    const res = await get("/api/flows/board");
    eq(res.status, 401, "anonymous board access is refused");
    eq(res.headers.get("cache-control"), "no-store", "API responses are no-store");
    const body = await res.json();
    ok(body.error && body.error.code === "unauthorized",
       "the project error envelope is used");
  }

  {
    for (const path of [
      "/%66lows/index.html",
      "//flows/index.html",
      "/FLOWS/index.html",
      "/flows/index.html",
      "/flows/board",
      "/flows/../flows/",
    ]) {
      const res = await get(path);
      const body = res.status === 200 ? await res.text() : "";
      ok(!body.includes(BOARD_MARKER),
         `bypass attempt ${path} does not leak the board (status ${res.status})`);
      ok(!body.includes('action="/flows/login"') || res.status === 200,
         `bypass attempt ${path} returns a coherent response`);
    }
  }

  {

    const learn = await signSession(
      { sub: "g_test", aud: "learn", exp: Date.now() + 60000 }, SESSION_SECRET,
    );
    const res = await get("/api/flows/board", { headers: { Cookie: "flows_session=" + learn } });
    eq(res.status, 401, "a learning token does not unlock the flows API");

    const page = await get("/flows/", { headers: { Cookie: "flows_session=" + learn } });
    ok(!(await page.text()).includes(BOARD_MARKER), "a learning token does not render the board");

    const flows = await signSession(
      { sub: FLOWS_TEST_USER, aud: "flows", exp: Date.now() + 60000 }, SESSION_SECRET,
    );
    const me = await get("/api/me", { headers: { Cookie: "session=" + flows } });
    const meBody = await me.json();
    ok(meBody.user === null, "a flows token is not accepted as a learning session");
  }

  {

    const legacy = await signSession(
      { sub: "g_legacy", email: "l@example.com", name: "Legacy", exp: Date.now() + 60000 },
      SESSION_SECRET,
    );
    const res = await get("/api/me", { headers: { Cookie: "session=" + legacy } });
    const body = await res.json();
    ok(body.user && body.user.id === "g_legacy",
       "a legacy audience-less learning session is still honoured");
  }

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

      for (const p of TICKER_PANELS) {
        const idCount = tickHtml.split(`id="${p.id}"`).length - 1;
        eq(idCount, 1, `the ticker page emits ${p.id} exactly once`);
        ok(tickHtml.includes(`data-panel="${p.key}"`), `and mounts panel ${p.key}`);
      }
      ok(tickHtml.includes("data-question="), "each panel carries its question as an attribute");

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

      const bareMarket = await get("/flows/market");
      eq(bareMarket.status, 308, "/flows/market without its trailing slash redirects too");
    }

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

      const bare = await get(route, { headers: { Cookie: "flows_session=" + token } });
      eq(bare.status, 200, `${route} with no ?t= still renders its own page`);

      for (const empty of ["?t=", "?t=%20%20"]) {
        eq((await get(route + empty,
             { headers: { Cookie: "flows_session=" + token } })).status, 200,
           `${route}${empty} is not a name, so the board answers it`);
      }
    }

    {
      const anonFwd = await get("/flows/long/?t=NVDA");
      eq(anonFwd.status, 302, "an anonymous visitor is forwarded like any other");
      eq(new URL(anonFwd.headers.get("location"), url("/")).search,
         "?t=NVDA&s=signal&from=long", "to the same address, decided without a session");

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

    for (const route of ["/flows/", "/flows/long/", "/flows/short/", "/flows/watch/"]) {
      const html = await (await get(route,
        { headers: { Cookie: "flows_session=" + token } })).text();
      for (const gone of ['id="flowsCard"', "/assets/js/flows-card.js",
                          "/assets/js/flows-panels.js"]) {
        ok(!html.includes(gone), `${route} no longer serves ${gone}`);
      }
    }

    {
      const ua = await get("/flows/unusual/", { headers: { Cookie: "flows_session=" + token } });
      eq(ua.status, 200, "/flows/unusual/ renders for an authenticated session");
      const uaHtml = await ua.text();
      ok(uaHtml.includes("/assets/js/flows-unusual.js"),
         "the unusual page loads its own controller");
      ok(uaHtml.includes('id="uaFeedBody"'), "and carries the contract feed's table body");
      ok(uaHtml.includes('id="uaNameBody"'), "and the name panel's");
      ok(uaHtml.includes('id="uaBasis"'), "and the basis panel, which is the page's honesty");

      const banned = new RegExp(UA_BANNED_CLAIMS.source, "ig");
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

      const dated = /\b(today|this session|the day's|the day\u2019s)\b/i;
      const d = uaHtml.match(dated);
      ok(!d, `the unusual page never dates an undated counter (found "${d && d[0]}")`);

      const anonUa = await get("/flows/unusual/");
      eq(anonUa.status, 200, "/flows/unusual/ serves a page to an anonymous visitor");
      ok(!(await anonUa.text()).includes('id="uaFeedBody"'),
         "/flows/unusual/ leaks nothing to an anonymous visitor");

      const bareUa = await get("/flows/unusual");
      eq(bareUa.status, 308, "/flows/unusual without its trailing slash redirects");

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

      eq((await get("/api/flows/summary?t=AAPL")).status, 401,
         "a name's Neuron summary is behind the same gate as the board's");
      const perName = await get("/api/flows/summary?t=AAPL", { headers: auth });
      eq(perName.status, 200, "and an authenticated reader is served it on a GET");
      const perNameBody = await perName.json();
      eq(perNameBody.status, "pending",
         "with no card published for the name the answer is PENDING, never quiet: nothing " +
         "has been measured, so nothing is claimed");
      eq(perNameBody.scope, "AAPL", "and the payload names the scope it was asked for");
      eq(perNameBody.summary, null, "carrying no text a page could mistake for a reading");
      eq((await get("/api/flows/summary?t=not-a-symbol", { headers: auth })).status, 400,
         "a subject that is not shaped like a symbol is refused before the store is read");
      eq((await get("/api/flows/live?t=AAPL")).status, 401,
         "the live quote is behind the gate too");
      const live = await get("/api/flows/live?t=AAPL", { headers: auth });
      eq(live.status, 200,
         "and with no vendor key configured in this harness it still answers 200: a live " +
         "read that failed is a silence the page draws, not an error a console should log");
      const liveBody = await live.json();
      eq(liveBody.status, "unavailable", "the silence is UNAVAILABLE");
      eq(liveBody.why, "chain_unconfigured", "and it names the configuration fault");
      eq(liveBody.price, null, "with no price a page could mistake for a reading");

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

    {
      const ev = await get("/flows/events/", { headers: { Cookie: "flows_session=" + token } });
      eq(ev.status, 200, "/flows/events/ renders for an authenticated session");
      const evHtml = await ev.text();
      ok(evHtml.includes("/assets/js/flows-events.js"), "the events page loads its own controller");
      ok(evHtml.includes('id="evBody"'), "and carries the calendar's table body");
      ok(evHtml.includes('id="evWindow"'), "and the window chart's host");
      ok(evHtml.includes('id="evBasis"'), "and the basis panel");

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

    for (const dest of ["/flows/", "/flows/long/", "/flows/short/", "/flows/watch/",
                        "/flows/market/", "/flows/unusual/", "/flows/events/",
                        "/flows/ticker/", "/flows/desk/"]) {
      ok(html.includes(`href="${dest}"`), `the rail links to ${dest}`);
    }

    const rail = (/<nav class="flows-rail"[\s\S]*?<\/nav>/.exec(html) || [""])[0];
    ok(rail.includes("flows-rail"), "the rail markup is found before it is read");
    for (const gone of ["/flows/history/", "/flows/track/"]) {
      ok(!rail.includes(`href="${gone}"`),
         `the RAIL does NOT link to ${gone} — it was taken off deliberately`);
      const still = await get(gone, { headers: { Cookie: "flows_session=" + token } });
      eq(still.status, 200,
         `but ${gone} still answers: unlisted is not deleted, and a link already ` +
         "sent has to keep working");
    }

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

    const out = await fetch(url("/flows/logout"), {
      method: "POST",
      redirect: "manual",
      headers: { Origin: server.baseURL, "Sec-Fetch-Site": "same-origin", Cookie: "flows_session=" + token },
    });
    eq(out.status, 303, "sign-out redirects");
    ok(/flows_session=;|flows_session=%3B|Max-Age=0/i.test(out.headers.get("set-cookie") || ""),
       "sign-out clears the session cookie");
  }

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

    eq((await post("scores:2026-01-02", JSON.stringify({ rows: [{ t: "TEST", s: 0 }] }),
        INGEST_TOKEN)).status, 200, "a dated scores pool is an accepted key");
    eq((await post("scoretrack", JSON.stringify({ names: [], sessions: [] }),
        INGEST_TOKEN)).status, 200, "and so is the live trace");
    eq((await post("flowalerts", JSON.stringify({ rows: [] }), INGEST_TOKEN)).status, 200,
       "the vendor-alerts feed is an accepted key");
    eq((await post("pulse", JSON.stringify({ tide: { points: [] } }), INGEST_TOKEN)).status, 200,
       "and so is the market pulse");

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

    eq((await fetch(url("/api/flows/ingest?key=board:long:2026-01-02"), { method: "DELETE" })).status, 401,
       "DELETE without the bearer is refused like every other verb");

    const ARCH = "board:long:2026-08-24";
    const boardA = JSON.stringify({ v: 2, rows: [{ t: "AAA", s: 90 }] });
    const boardZ = JSON.stringify({ v: 2, rows: [{ t: "ZZZ", s: -90 }] });
    const archGet = () => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(ARCH)),
      { headers: { Authorization: "Bearer " + INGEST_TOKEN } });

    eq(archiveWriteAction({ readable: true, exists: false, same: false }), "write",
       "a dated key the store says is ABSENT is written — this is the first publish of a " +
       "session and the ordinary path");
    eq(archiveWriteAction({ readable: true, exists: true, same: true }), "unchanged",
       "a byte-identical row is left alone rather than rewritten, so the pipeline's own " +
       "retry is not an outage");
    eq(archiveWriteAction({ readable: true, exists: true, same: false }), "refuse_immutable",
       "a DIFFERENT row is refused — the write would revise what a past session said");
    eq(archiveWriteAction({ readable: false, exists: false, same: false }), "refuse_unreadable",
       "AND A READ THAT DID NOT ANSWER IS REFUSED TOO, rather than read as an absence. " +
       "This is the branch the route could not reach and the defect this module exists " +
       "for: null from a thrown SELECT and null from a missing row are the same value, " +
       "and treating them as the same claim overwrites the record the deck's accuracy is " +
       "computed from");
    eq(archiveWriteAction({ readable: false, exists: true, same: true }), "refuse_unreadable",
       "and unreadable OUTRANKS every other state — if the read did not answer, nothing " +
       "it seems to say about the row is a fact");
    eq(archiveWriteAction(), "refuse_unreadable",
       "called with nothing at all it still refuses: the default for `did the store " +
       "answer` is no, so a caller that forgets to pass the trace fails closed");

    eq(ARCHIVE_REFUSALS.refuse_immutable.status, 409,
       "a revision is 409 and final — the correction path is the deliberate two-step DELETE");
    eq(ARCHIVE_REFUSALS.refuse_unreadable.status, 503,
       "an unreadable store is 503 and transient — the pipeline retries 5xx, so the same " +
       "request succeeds once the store answers, and nothing was written in the meantime");
    ok(ARCHIVE_REFUSALS.refuse_unreadable.message.includes("Nothing was stored"),
       "and the unreadable refusal says so out loud, because a caller reading a 503 needs " +
       "to know whether to worry about a half-written archive");
    eq(new Set(Object.values(ARCHIVE_REFUSALS).map((r) => r.code)).size,
       Object.keys(ARCHIVE_REFUSALS).length,
       "every refusal has its own code — a shared code is a switch statement that cannot " +
       "switch");

    const firstWrite = await post(ARCH, boardA, INGEST_TOKEN);
    eq(firstWrite.status, 200,
       "the first write of a dated key succeeds — immutability is not read-only");
    eq((await firstWrite.json()).stored, "created",
       "and says it CREATED the row, which is the other half of the `unchanged` a retry " +
       "reports: a dated write now always names which of the two happened, so a log line " +
       "cannot be read as a publish when it was a no-op");

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

    for (const view of ["pulse", "market", "flowalerts", "scoretrack"]) {
      eq((await post(view, boardA, INGEST_TOKEN)).status, 200,
         `${view} is a view of today and stays writable`);
      eq((await post(view, boardZ, INGEST_TOKEN)).status, 200,
         `${view} takes a second, different write without complaint — a view describes ` +
         `today and rewriting it every morning is the product working`);
    }

    eq((await fetch(url("/api/flows/ingest?key=" + encodeURIComponent(ARCH)), {
      method: "DELETE", headers: { Authorization: "Bearer " + INGEST_TOKEN },
    })).status, 200, "a dated key can still be deleted");
    eq((await post(ARCH, boardZ, INGEST_TOKEN)).status, 200,
       "and rewritten afterwards — correcting a genuinely bad archive day is possible, " +
       "visible, and impossible to do by accident");
    assert.deepEqual(JSON.parse(await (await archGet()).text()).rows, [{ t: "ZZZ", s: -90 }],
      "the correction landed"); checks++;

    const POOL = "scores:2026-08-24";
    eq((await post(POOL, boardA, INGEST_TOKEN)).status, 200, "a dated scores pool writes once");
    eq((await post(POOL, boardZ, INGEST_TOKEN)).status, 409,
       "and is immutable too: the write guard and the delete branch share one pattern");

    for (const method of ["PUT", "PATCH"]) {
      eq((await fetch(url("/api/flows/ingest?key=board:long"), {
        method, headers: { Authorization: "Bearer " + INGEST_TOKEN },
      })).status, 405, `${method} is still refused`);
    }

    const stamp = readBack.headers.get("x-payload-updated");
    ok(stamp && Number(stamp) > 0, `the read carries its write timestamp (${stamp})`);
    ok(Math.abs(Date.now() - Number(stamp)) < 5 * 60 * 1000,
       "and the timestamp is the real write time, not a placeholder");

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

    eq((await get("/api/flows/board?side=long")).status, 401,
       "the ingested board is still refused to anonymous callers");

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

    const settle = async () => {
      for (let i = 0; i < 2; i++) {
        try { await (await get("/flows/")).text(); } catch {   }
      }
    };
    await settle();

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

    let lastBody = "";
    for (let i = 0; i < 9; i++) {
      const res = await attempt(TARGET, "wrong-" + i, ATTACKER);
      eq(res.status, 401, `attacker attempt ${i + 1} is refused`);
      lastBody = await res.text();
    }
    ok(/Too many attempts/i.test(lastBody), "the attacker's own address is locked out");

    const victim = await attempt(TARGET, FLOWS_PASSWORD, VICTIM);
    eq(victim.status, 303, "THE FIX: the account holder still signs in while an attacker is locked out");
    ok((victim.headers.get("set-cookie") || "").includes("flows_session="),
       "and receives a working session");
  }

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

  {

    const res = await get("/shared/flows-pages.js");
    ok(res.status === 404 || !(await res.text()).includes("boardPage"),
       "the page source is not publicly served");
  }

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

    eq((await get("/api/flows/card?t=aapl", { headers: cookie })).status, 200,
       "a lowercase ticker resolves to the same card");

    const missing = await get("/api/flows/card?t=ZZZZ", { headers: cookie });
    eq(missing.status, 200, "an unbuilt card is not an error");
    eq((await missing.json()).status, "pending", "it reports pending honestly");

    for (const bad of ["", "../../etc/passwd", "A B", "TOOLONGTICKER", "1ABC", "%2e%2e"]) {
      const res = await get("/api/flows/card?t=" + encodeURIComponent(bad), { headers: cookie });
      eq(res.status, 400, `card read refuses the ticker ${JSON.stringify(bad)}`);
    }
    for (const bad of ["card:", "card:a b", "card:TOOLONGTICKER", "card:1ABC"]) {
      eq((await putCard(bad, card)).status, 400, `ingest refuses the key ${JSON.stringify(bad)}`);
    }

    eq((await get("/api/flows/card?t=AAPL")).status, 401,
       "an anonymous caller cannot read a card");
  }

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

  {
    const { loginPage } = await import("../shared/flows-pages.js");
    const html = loginPage({ error: '<img src=x onerror=alert(1)>"&' });
    ok(!html.includes("<img src=x"), "an injected tag is escaped, not rendered");
    ok(html.includes("&lt;img"), "it appears as text");
    ok(html.includes("&amp;"), "ampersands are escaped too");
    ok(loginPage().includes('action="/flows/login"'), "the ordinary page is unaffected");
  }

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
