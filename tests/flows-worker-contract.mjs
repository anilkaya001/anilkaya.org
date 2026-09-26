import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signSession } from "../shared/session.js";
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
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

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
      ok(sideHtml.includes('id="flowsBody"'), `${route} carries the results table's body`);
      ok(sideHtml.includes('role="table"'), `${route} announces that body's list as a table`);
      ok(sideHtml.includes("/assets/css/flows-boards.css"), `${route} carries the boards stylesheet`);
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
      const order = ["/assets/js/flows-ui.js", "/assets/js/flows-fresh.js", "/assets/js/flows-quant-read.bundle.js", "/assets/js/flows-ticker.js"].map((src) => tickHtml.indexOf(src));
      ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])),
         "with the Depth primitives, the freshness layer and the pricing bundle FIRST — the controller builds every module out of FlowsUI and fails closed without it");
      ok(!tickHtml.includes("/assets/js/flows-panels.js") && !tickHtml.includes("/assets/js/flows-drawers.js"),
         "and no longer the retired panel library or its deferred drawers");
      ok(tickHtml.includes("/assets/css/flows-ticker.css"), "with the route stylesheet linked through the per-route hook");
      ok(/<div class="ft-grid" id="ftGrid" hidden><\/div>/.test(tickHtml),
         "the ticker page carries the module grid, served hidden and empty: its modules are built from the card, so nothing reads as a finding before one lands");
      ok(!tickHtml.includes('id="ftZoom"'), "and no enlarge dialog: every chart is drawn in its module at full width");

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
      ok(uaHtml.includes('id="uaFeed"'), "and carries the contract feed's module body");
      ok(uaHtml.includes('id="uaSurprise"'), "and the name panel's");
      ok(uaHtml.includes('id="uaAbout"'), "and the page's own account of what it refuses to claim, which is its honesty");

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
      const ownWords = uaHtml.replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "");
      ok(ownWords.length < uaHtml.length,
         "the shared sidebar is found and set aside before the page's own words are read");
      const d = ownWords.match(dated);
      ok(!d, `the unusual page never dates an undated counter (found "${d && d[0]}") — the ` +
         `sidebar's "Today" is the name of a navigation group, identical on every route, ` +
         "not a claim about when this page's counts were counted");

      const anonUa = await get("/flows/unusual/");
      eq(anonUa.status, 200, "/flows/unusual/ serves a page to an anonymous visitor");
      ok(!(await anonUa.text()).includes('id="uaFeed"'),
         "/flows/unusual/ leaks nothing to an anonymous visitor");

      const bareUa = await get("/flows/unusual");
      eq(bareUa.status, 308, "/flows/unusual without its trailing slash redirects");

      ok(uaHtml.includes('id="uaTimeline"'), "the vendor-alerts timeline's host ships");
      ok(uaHtml.includes('id="uaFilterNote"'), "with the filter note that announces what is drawn");
      ok(/not the same fact as the flag being off/i.test(uaHtml),
         "and the page's own disclosure states that an absent flag is not an " +
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
      ok(Array.isArray(spend.byModel) && spend.byModel.length === 0,
         "the meter publishes its per-model split, empty on a day with no call: the fallback " +
         "model is billed at about five times the primary's rate, so a day total at one rate " +
         "would understate the spend exactly when the fallback is doing the writing");
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
      ok(evHtml.includes('id="evEarn"'), "and carries the earnings list's host");
      ok(evHtml.includes('id="evWeek"'), "and the week-ahead calendar's host");
      ok(evHtml.includes('id="evAbout"'), "and the page's own account of its clocks and its gate");

      ok(/FORBIDDEN/i.test(evHtml),
         "the page states that a gated name was forbidden from being scored, " +
         "rather than leaving it to read as a low score");

      const anonEv = await get("/flows/events/");
      eq(anonEv.status, 200, "/flows/events/ serves a page to an anonymous visitor");
      ok(!(await anonEv.text()).includes('id="evEarn"'),
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
    for (const back of ["/flows/history/", "/flows/track/"]) {
      ok(rail.includes(`href="${back}"`),
         `the RAIL links to ${back} again, under Record — it was taken off to keep a sideways ` +
         "phone strip short, and the sidebar that replaced the strip is a grouped vertical list");
      const still = await get(back, { headers: { Cookie: "flows_session=" + token } });
      eq(still.status, 200, `and ${back} answers for a session`);
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

    const auth = { headers: { Cookie: "flows_session=" + token } };
    eq((await (await get("/api/flows/universe", auth)).json()).status, "pending",
       "the universe route answers pending before its first publish");
    const regimeBefore = await get("/api/flows/regime", auth);
    eq(regimeBefore.status, 200, "an unwritten regime is not an error");
    eq((await regimeBefore.json()).status, "pending", "it reads pending until the pipeline writes it");
    eq((await get("/api/flows/regime")).status, 401, "the regime route refuses an anonymous reader");
    eq((await post("universe", JSON.stringify({ v: 1, t: ["TEST"], cols: { iv30: [312] }, units: { iv30: ["vol", 1000] } }),
      INGEST_TOKEN)).status, 200, "the columnar universe is an accepted key");
    eq((await post("regime", JSON.stringify({ v: 1, volCurve: { status: "ok" } }), INGEST_TOKEN)).status, 200,
       "and so is the market regime");
    eq((await post("card-x:TEST", JSON.stringify({ v: 1, ticker: "TEST", short: { status: "quiet" } }), INGEST_TOKEN)).status, 200,
       "and card-x under the ticker rule");
    eq((await post("card-x:../etc", "{}", INGEST_TOKEN)).status, 400, "while a card-x key that is not a ticker is refused");
    eq((await post("universe:2026-01-02", "{}", INGEST_TOKEN)).status, 400,
       "and the universe has no dated form: it is tonight's cross-section, not an archive");
    const uni = await (await get("/api/flows/universe", auth)).json();
    eq(uni.cols.iv30[0], 312, "the universe reads back through its own route unchanged");
    eq((await (await get("/api/flows/regime", auth)).json()).volCurve.status, "ok", "and the regime through its own");
    const cxr = await get("/api/flows/card-x?t=test", auth);
    eq(cxr.status, 200, "card-x is read by ticker, case-folded");
    eq((await cxr.json()).short.status, "quiet", "and returns the stored parts");
    eq((await get("/api/flows/card-x?t=../x", auth)).status, 400, "an invalid ticker is refused at the read");
    eq((await (await get("/api/flows/card-x?t=NONE", auth)).json()).status, "pending", "and an unpublished one is pending");

    for (const key of ["focus", "roster"]) {
      eq((await (await get("/api/flows/" + key, auth)).json()).status, "pending", `the ${key} route answers pending before its first publish`);
      eq((await get("/api/flows/" + key)).status, 401, `and refuses an anonymous reader`);
      eq((await post(key + ":2026-09-24", "{}", INGEST_TOKEN)).status, 400, `${key} has no dated form`);
    }
    const focusBody = { v: 1, status: "ok", sessionDate: "2026-09-24", fields: ["px"], groups: [{ id: "gold", tickers: ["GLD"] }],
      rows: { GLD: { px: 391.645 } }, closes: {}, missing: [] };
    eq((await post("focus", JSON.stringify(focusBody), INGEST_TOKEN)).status, 200, "focus is an accepted nightly key");
    eq((await (await get("/api/flows/focus", auth)).json()).rows.GLD.px, 391.645, "and reads back through its own route unchanged");
    const rosterBody = { v: 1, sessionDate: "2026-09-24", depth: { GLD: "fund", NVDA: "focus" }, session: { GLD: "2026-09-24", NVDA: "2026-09-24" } };
    eq((await post("roster", JSON.stringify(rosterBody), INGEST_TOKEN)).status, 200, "roster is an accepted nightly key");
    eq((await (await get("/api/flows/roster", auth)).json()).depth.GLD, "fund", "and reads back through its own route");

    const del = (key) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
      method: "DELETE", headers: { Authorization: "Bearer " + INGEST_TOKEN } });
    eq((await post("card:RETIRE", JSON.stringify({ v: 2, ticker: "RETIRE", sessionDate: "2026-09-17" }), INGEST_TOKEN)).status, 200,
       "a card to retire is written");
    eq((await del("card:RETIRE")).status, 200, "the nightly token retires a stale card through the ingest DELETE");
    eq((await del("card:RETIRE")).status, 404, "and a second retire of the same key is an honest 404, which the run counts as absent");
    eq((await del("card-x:TEST")).status, 200, "card-x keys retire the same way");
    eq((await del("hist:NONE")).status, 404, "and hist keys are deletable too");
    eq((await (await get("/api/flows/card-x?t=TEST", auth)).json()).status, "pending", "a retired key reads as unpublished");
    for (const key of ["universe", "focus", "roster", "board:long", "card:../etc"]) {
      eq((await del(key)).status, 400, `${key} stays undeletable: only dated archives and per-ticker keys can be removed`);
    }
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

    const dossier = JSON.stringify({
      v: 1, ticker: "AAPL", scope: "deep", sessionDate: "2026-09-22",
      cone: { status: "ok", iv30: 0.221, tenors: [{ days: 7, iv: 0.221, pct: 0.2191 }] },
      skew: { status: "unavailable", code: "read-failed", reason: "the vendor call failed after its retries" },
    });
    eq((await putCard("card-x:AAPL", dossier)).status, 200,
       "the volatility dossier ingests under card-x:<TICKER>, beside the card and never inside it");
    const xRead = await get("/api/flows/card-x?t=aapl", { headers: cookie });
    eq(xRead.status, 200, "an authenticated dossier read succeeds with the ticker case-folded");
    const xBody = await xRead.json();
    eq(xBody.cone.tenors[0].pct, 0.2191, "and the nested panels survive the byte passthrough");
    eq(xBody.skew.code, "read-failed", "a silent panel keeps its code, so the glyph can say which silence it is");
    eq(xRead.headers.get("cache-control"), "no-store", "the dossier is never cached");
    const xMissing = await get("/api/flows/card-x?t=ZZZZ", { headers: cookie });
    eq(xMissing.status, 200, "a dossier the run has not written is not an error");
    eq((await xMissing.json()).status, "pending", "and it reports pending honestly");
    for (const bad of ["", "../../etc/passwd", "1ABC", "TOOLONGTICKER"]) {
      eq((await get("/api/flows/card-x?t=" + encodeURIComponent(bad), { headers: cookie })).status, 400,
         `the dossier read refuses the ticker ${JSON.stringify(bad)}`);
    }
    for (const bad of ["card-x:", "card-x:a b", "card-x:1ABC", "card-y:AAPL"]) {
      eq((await putCard(bad, dossier)).status, 400, `ingest refuses the key ${JSON.stringify(bad)}`);
    }
    eq((await get("/api/flows/card-x?t=AAPL")).status, 401, "an anonymous caller cannot read a dossier");

    const regime = JSON.stringify({ v: 1, sessionDate: "2026-09-22",
      volRadar: { status: "ok", rich: { status: "ok", rows: [{ t: "SOXS", score: 52.263 }] } } });
    eq((await putCard("regime", regime)).status, 200, "the market regime key ingests");
    const regimeRead = await get("/api/flows/regime", { headers: cookie });
    eq(regimeRead.status, 200, "and reads back to a signed-in page");
    eq((await regimeRead.json()).volRadar.rich.rows[0].t, "SOXS", "with the vol radar rows unchanged");
    eq((await get("/api/flows/regime")).status, 401, "an anonymous caller cannot read the regime");
    {
      const before = await get("/api/flows/ideas", { headers: cookie });
      eq((await before.json()).status, "pending", "the engine's lead ideas read pending until the pipeline writes them");
      const ideas = JSON.stringify({ v: 1, status: "ok", sessionDate: "2026-09-22", n: 1,
        rows: [{ t: "AAPL", id: "iron-condor", structure: "iron condor", dir: "neutral", grade: 2 }] });
      eq((await putCard("ideas", ideas)).status, 200, "the ideas key ingests");
      const read = await get("/api/flows/ideas", { headers: cookie });
      eq((await read.json()).rows[0].structure, "iron condor", "and reads back to a signed-in page unchanged");
      eq((await get("/api/flows/ideas")).status, 401, "an anonymous caller cannot read them");
      eq((await putCard("ideas:AAPL", ideas)).status, 400, "and the key admits no suffix");
    }
    for (const prefix of ["card-x", "hist"]) {
      const body = JSON.stringify({ v: 1, ticker: "AAPL", sessionDate: "2026-09-22",
        gex: { status: "ok", why: null, z: 1.25, gaps: {} } });
      eq((await putCard(prefix + ":AAPL", body)).status, 200,
         `a ${prefix} payload ingests under its ticker key`);
      const got = await get(`/api/flows/${prefix}?t=aapl`, { headers: cookie });
      eq(got.status, 200, `an authenticated ${prefix} read succeeds, lowercase ticker included`);
      eq((await got.json()).gex.z, 1.25, `the ${prefix} payload round-trips through the byte passthrough`);
      eq(got.headers.get("cache-control"), "no-store", `${prefix} data is never cached`);
      const back = await fetch(url("/api/flows/ingest?key=" + prefix + ":AAPL"),
        { headers: { Authorization: "Bearer " + INGEST_TOKEN } });
      eq(back.status, 200, `the pipeline can read ${prefix} back through the ingest route it writes through`);
      eq((await (await get(`/api/flows/${prefix}?t=ZZZZ`, { headers: cookie })).json()).status, "pending",
         `an unbuilt ${prefix} key reports pending honestly`);
      for (const bad of [prefix + ":", prefix + ":a b", prefix + ":1ABC", prefix + "x:AAPL"]) {
        eq((await putCard(bad, body)).status, 400, `ingest refuses the key ${JSON.stringify(bad)}`);
      }
      eq((await get(`/api/flows/${prefix}?t=` + encodeURIComponent("../x"), { headers: cookie })).status, 400,
         `${prefix} read refuses a malformed ticker`);
      eq((await get(`/api/flows/${prefix}?t=AAPL`)).status, 401, `an anonymous caller cannot read ${prefix}`);
    }
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
    const put = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + INGEST_TOKEN },
      body: JSON.stringify(body),
    });
    const sessionDate = "2026-09-22";
    const at = new Date().toISOString();
    const block = { v: 1, engine: "q1", asOf: "2026-09-22T20:00:00.000Z", spot: 420.5, atr: 8,
      facts: [{ id: "iv.cm.30", v: 0.31, u: "vol", g: 3 }, { id: "iv.pct.30", v: 0.8, u: "frac", g: 2 },
        { id: "vrp.rel.21", v: 0.2, u: "frac", g: 3 }],
      state: { state: "premium-rich", direction: null, confidence: 2, preferred: ["put credit spread"], avoid: ["long straddle"] },
      structures: [{ id: "S1", family: "put-credit-spread", risk: "defined", dir: "bull", expiry: "2026-10-16", dte: 24,
        legs: [{ type: "P", k: 400, side: -1, qty: 1 }, { type: "P", k: 390, side: 1, qty: 1 }],
        prob: { popQ: 0.7, popP: 0.76 }, ev: { q: -2, p: 14, edge: 16 }, maxProfit: 180, maxLoss: -820,
        grade: 3, gradeWhy: [], rules: ["vrp.rich", "iv.high"] }],
      ideas: ["S1"], noTrade: null };
    const panels = { pricedMove: { status: "ok", impliedMove: 0.05, realizedMove: 0.04, sessions: 10, iv30: 0.31, rv30: 0.25 } };

    eq((await put("card-x:MSFT", { ticker: "MSFT", sessionDate, generatedAt: at, engine: block })).status, 200,
       "the engine's overflow key card-x:<T> ingests beside the card");
    eq((await put("card:MSFT", { ticker: "MSFT", sessionDate, generatedAt: at, panels,
      engine: { status: "split", key: "card-x:MSFT", bytes: 1234 } })).status, 200,
       "and a card carrying only the split pointer ingests under its own key");
    const merged = await (await get("/api/flows/card?t=MSFT", { headers: cookie })).json();
    ok(merged.engine && Array.isArray(merged.engine.structures) && merged.engine.structures[0].id === "S1" &&
       merged.engine.facts[0].v === 0.31 && merged.panels.pricedMove.status === "ok",
       "a card read resolves the pointer: the page receives one card with its engine block in place, panels untouched");
    eq((await put("card-x:1ABC", {})).status, 400, "the overflow key is validated like the card key it rides beside");

    await put("card-x:NVDA", { ticker: "NVDA", sessionDate: "2026-09-19", generatedAt: at, engine: block });
    await put("card:NVDA", { ticker: "NVDA", sessionDate, generatedAt: at, panels,
      engine: { status: "split", key: "card-x:NVDA", bytes: 1 } });
    const stale = await (await get("/api/flows/card?t=NVDA", { headers: cookie })).json();
    eq(stale.engine && stale.engine.status, "unreadable",
       "an overflow written for another session is never grafted onto today's card: the pointer reads unreadable");
    await put("card:AMD", { ticker: "AMD", sessionDate, generatedAt: at, panels,
      engine: { status: "split", key: "card-x:MSFT", bytes: 1 } });
    const foreign = await (await get("/api/flows/card?t=AMD", { headers: cookie })).json();
    eq(foreign.engine && foreign.engine.status, "split", "and a pointer naming another ticker's overflow is not followed");

    const first = await (await get("/api/flows/summary?t=MSFT", { headers: cookie })).json();
    ok(first.status === "pending" || first.status === "ok", `the Neuron route reads the merged card (${first.status})`);
    let neuron = first;
    for (let i = 0; i < 40 && neuron.status !== "ok"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      neuron = await (await get("/api/flows/summary?t=MSFT", { headers: cookie })).json();
    }
    eq(neuron.status, "ok", "and writes a reading over it");
    eq(neuron.engine, true, "over the engine protocol, because the card carries an engine block");
    eq(neuron.ideas.length, 1, "with the engine's own ranked idea");
    ok(neuron.ideas[0].structure === "S1" && neuron.ideas[0].from === "engine" && neuron.ideas[0].verdict === "harvest-rich-premium" &&
       neuron.ideas[0].word === "Harvest rich premium" && neuron.ideas[0].because.length === 2,
       `named by structure id, with a verdict code whose preconditions hold, its word, and two facts it rests on (${JSON.stringify(neuron.ideas[0])})`);
    ok(!("popQ" in neuron.ideas[0]) && !("maxLoss" in neuron.ideas[0]),
       "and no figure of its own: the page draws every number from the card's engine block by that id");
    eq(neuron.verdictWord, "Harvest rich premium", "the reading's verdict travels with its word");
    ok(/engine\u2019s own ranking: no model was asked/.test(neuron.provenance || ""),
       `with no model configured, the provenance says the ideas are the engine's own ranking (${neuron.provenance})`);
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

  {
    const { mergeLiveAlerts, LIVE_BUDGET, LIVE_KEYS, freshEnvelope } = await import("../shared/flows-live.js");
    const { phaseAt } = await import("../shared/flows-freshness.js");
    const { signFlowsSession } = await import("../shared/flows-auth.js");
    const { fakeFlowAlerts } = await import("../scripts/flows-legs/live-fake.mjs");
    const { startStubVendor, startStubGithub, oidcIssuer } = await import("./live-stubs.mjs");
    const et = (iso) => Date.parse(iso);
    const marketNow = { value: et("2026-09-23T10:06:00-04:00") };
    const vendor = await startStubVendor({ marketSession: "2026-09-23", marketNow, tapeSession: "2026-09-22" });
    const issuer = await oidcIssuer();
    const github = await startStubGithub({ jwks: issuer.jwks });
    const LIVE_TOKEN = "test-live-token-abcdefghijklmnopqrstuv";
    const live = await startWorker({ extraVars: [
      `FLOWS_INGEST_TOKEN:${INGEST_TOKEN}`, `FLOWS_LIVE_TOKEN:${LIVE_TOKEN}`, "UW_API_KEY:stub-uw-key",
      `UW_BASE:${vendor.base}`, "GITHUB_DISPATCH_TOKEN:stub-dispatch-token", `GITHUB_API_BASE:${github.base}`,
      `GITHUB_OIDC_JWKS:${github.base}/.well-known/jwks`,
    ] });
    const L = (p) => live.baseURL + p;
    const liveMigration = readFileSync(new URL("../migrations/0010_flows_live.sql", import.meta.url), "utf8");
    const oldClock = /CREATE TABLE IF NOT EXISTS flows_clock \([\s\S]*?\n\);/.exec(liveMigration)[0];
    await live.d1("DROP TABLE flows_clock");
    await live.d1(oldClock.replace(/\s+/g, " "));
    const cookie = { Cookie: "flows_session=" + await signFlowsSession(FLOWS_TEST_USER, SESSION_SECRET, 600, "1") };
    const ingest = (key, method, token, body) => fetch(L("/api/flows/ingest?key=" + encodeURIComponent(key)), {
      method, redirect: "manual",
      headers: { Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    });
    const tick = async (cron, iso) => {
      const res = await fetch(L(`/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(cron)}&time=${et(iso)}`));
      await res.text();
      return res.status;
    };
    const RTH = "1-59/5 13-21 * * 1-5";
    const HOUSE = "*/30 * * * *";
    const fresh = (key, readAt, session = "2026-09-23") => ({ v: 1, readAt, session, cadenceS: LIVE_KEYS[key].cadenceS,
      source: "actions", writer: "flows-live@test", vendorAt: null });
    try {
      const board = { side: "long", generatedAt: "2026-09-22T21:40:00.000Z", sessionDate: "2026-09-22", rows: [] };
      eq((await ingest("board:long", "POST", INGEST_TOKEN, board)).status, 200, "the nightly token still writes the nightly board");
      for (const key of ["board:long", "board:long:2026-09-22", "scores:2026-09-22", "card:AAPL", "flowalerts"]) {
        const res = await ingest(key, "POST", LIVE_TOKEN, board);
        eq(res.status, 403, `LAYER 2 (credential): the live token is refused on ${key}`);
        eq((await res.json()).error.code, "live_token_scope", "with its own code");
      }
      eq((await ingest("live:breadth", "DELETE", LIVE_TOKEN)).status, 403, "the live token can delete nothing");
      eq((await ingest("card:AAPL", "DELETE", LIVE_TOKEN)).status, 403,
        "not even a card: retiring per-ticker keys is the nightly token's alone");
      eq((await ingest("board:long", "GET", LIVE_TOKEN)).status, 200,
        "it may READ the board it plans the strip from");
      eq((await ingest("card:AAPL", "GET", LIVE_TOKEN)).status, 403, "and nothing else of the nightly store");
      const nightlyOnLive = await ingest("live:market", "POST", INGEST_TOKEN, {});
      eq(nightlyOnLive.status, 403, "the nightly token is refused on live:market");
      eq((await nightlyOnLive.json()).error.code, "nightly_token_scope", "so the nightly run cannot corrupt a live row");
      eq((await ingest("live:breadth", "GET", INGEST_TOKEN)).status, 200, "though it may read the live union it merges");
      const wrongWriter = await ingest("live:market", "POST", LIVE_TOKEN,
        { v: 1, fresh: { ...fresh("live:market", "2026-09-23T14:00:00.000Z"), source: "worker" } });
      eq(wrongWriter.status, 403, "ONE WRITER PER KEY: the Actions token cannot write the Worker's live:market");
      eq((await ingest("live:breadth", "POST", LIVE_TOKEN, { v: 1 })).status, 400, "a live payload with no fresh envelope is refused");
      eq((await ingest("live:unknown", "POST", LIVE_TOKEN, { v: 1 })).status, 400, "and an unregistered live key");
      const big = { v: 1, key: "live:vol", session: "2026-09-23", fresh: fresh("live:vol", "2026-09-23T14:00:00.000Z"),
        pad: "x".repeat(LIVE_KEYS["live:vol"].maxBytes) };
      eq((await ingest("live:vol", "POST", LIVE_TOKEN, big)).status, 413, "a live key over its own cap is refused");
      const breadth = (readAt) => ({ v: 1, key: "live:breadth", session: "2026-09-23", fresh: fresh("live:breadth", readAt),
        sectors: { t: [], rows: {} } });
      const w1 = await ingest("live:breadth", "POST", LIVE_TOKEN, breadth("2026-09-23T14:10:00.000Z"));
      eq(w1.status, 200, "a well-formed Tier 2 payload lands");
      eq((await w1.json()).stored, "written", "and is written");
      const w0 = await ingest("live:breadth", "POST", LIVE_TOKEN, breadth("2026-09-23T14:05:00.000Z"));
      eq((await w0.json()).stored, "older-than-held", "a delayed older read never overwrites a newer one");
      const oidc = await issuer.mint();
      const viaOidc = await ingest("live:breadth", "POST", oidc, breadth("2026-09-23T14:01:00.000Z"));
      eq(viaOidc.status, 200, "OIDC: the live workflow's own GitHub token is accepted, with no shared secret anywhere");
      eq((await viaOidc.json()).stored, "older-than-held", "and its write meets the same read-time rule as any live write");
      const oidcBoard = await ingest("board:long", "POST", oidc, board);
      eq(oidcBoard.status, 403, "OIDC: the token is refused on the nightly board");
      eq((await oidcBoard.json()).error.code, "live_token_scope", "because the role it earns is the live role");
      eq((await ingest("live:breadth", "DELETE", oidc)).status, 403, "and it deletes nothing");
      const otherBranch = await issuer.mint(Date.now(), {
        workflow_ref: "anilkaya001/anilkaya.org/.github/workflows/flows-live.yml@refs/heads/feature",
        job_workflow_ref: "anilkaya001/anilkaya.org/.github/workflows/flows-live.yml@refs/heads/feature",
        ref: "refs/heads/feature",
      });
      eq((await ingest("live:breadth", "POST", otherBranch, breadth("2026-09-23T14:01:00.000Z"))).status, 401,
        "OIDC: the same workflow run from any branch but main is refused");
      eq((await ingest("live:breadth", "POST", await issuer.mint(Date.now(), { aud: "https://github.com/anilkaya001" }),
        breadth("2026-09-23T14:01:00.000Z"))).status, 401, "and so is a token minted for another audience");
      eq((await ingest("live:breadth", "POST", await issuer.mint(Date.now() - 3600_000),
        breadth("2026-09-23T14:01:00.000Z"))).status, 401, "or one that has expired");
      const stranger = await oidcIssuer();
      eq((await ingest("live:breadth", "POST", await stranger.mint(), breadth("2026-09-23T14:01:00.000Z"))).status, 401,
        "or one signed by a key the issuer never published");
      ok(github.jwksHits() >= 1, "the Worker read the key set from the configured issuer");

      eq((await ingest("board:long:2026-01-02", "POST", INGEST_TOKEN, { ...board, sessionDate: "2026-01-02" })).status, 200,
        "a dated archive row is created");
      let refused = null;
      try { await live.d1("UPDATE flows_payload SET payload = '{}' WHERE id = 'board:long:2026-01-02'"); }
      catch (error) { refused = String(error && error.message); }
      ok(refused && /flows archive rows are immutable/.test(refused),
        "LAYER 4 (storage): a direct UPDATE of a dated row aborts with the trigger's message, whatever the code path");
      await live.d1("UPDATE flows_payload SET updated_at = updated_at WHERE id = 'board:long'");
      ok(true, "while the undated nightly rows stay writable");
      let checked = null;
      try {
        await live.d1("INSERT INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) " +
          "VALUES ('board:long', '{}', 1, '2026-09-23', 300, 'worker', 'x', 1)");
      } catch (error) { checked = String(error && error.message); }
      ok(checked && /CHECK constraint/i.test(checked), "LAYER 3 (table): flows_live refuses any id outside live:*");

      const pulse = { v: 2, generatedAt: "2026-09-22T21:40:00.000Z", sessionDate: "2026-09-22",
        readAt: "2026-09-22T21:40:00.000Z", readDay: "2026-09-22", refreshed: "nightly", cadenceMinutes: 15,
        tide: { status: "ok", points: [{ t: "2026-09-22T13:30:00Z", callPrem: 1, putPrem: 2, vol: 3 }], seen: 1, cap: 480, shed: 0 },
        totals: { status: "ok", rows: [{ date: "2026-09-22", callPrem: 1, callVol: 2, putPrem: 3, putVol: 4 }] } };
      const pulseText = JSON.stringify(pulse);
      eq((await ingest("pulse", "POST", INGEST_TOKEN, pulseText)).status, 200, "a nightly pulse lands");
      eq((await ingest("meta", "POST", INGEST_TOKEN, { sessionDate: "2026-09-22", generatedAt: "2026-09-22T21:40:00.000Z" })).status,
        200, "and the nightly meta");

      eq(await tick(RTH, "2026-09-23T10:06:00-04:00"), 200, "the market-hours cron fires the RTH tick");
      eq(vendor.count(/^\/api\/(market|net-flow)\//), 2, "TIER 1 spends exactly two vendor calls");
      const mk = await fetch(L("/api/flows/lk?k=market"), { headers: cookie });
      eq(mk.status, 200, "live:market is served on the live read route");
      const market = await mk.json();
      eq(market.key, "live:market", "whole, as the Worker wrote it");
      eq(market.fresh.source, "worker", "stamped by the Worker");
      eq(market.fresh.readAt, new Date(et("2026-09-23T10:06:00-04:00")).toISOString(),
        "at the cron's scheduled instant, so a late invocation cannot pass for an earlier read");
      ok(market.tide.status === "ok" && market.tide.n >= 7 && market.sectors.status === "ok" &&
         !("zeroDte" in market) && !("etf" in market),
        "with both feeds shaped, and neither the 0DTE series nor the SPY/QQQ tides, which live:breadth carries now");
      eq(mk.headers.get("x-fresh-source"), "worker", "X-Fresh-Source comes from the row's column");
      eq(mk.headers.get("x-fresh-cadence"), "300", "and X-Fresh-Cadence");
      ok(["live", "fresh", "stale", "closed"].includes(mk.headers.get("x-fresh-state")), "X-Fresh-State is one of the four states");
      ok(/^\d{13}$/.test(mk.headers.get("x-server-now") || ""), "and X-Server-Now gives the browser its skew");
      eq((await fetch(L("/api/flows/lk?k=market"))).status, 401, "the live route is gated like every other");
      eq((await fetch(L("/api/flows/lk?k=board:long"), { headers: cookie })).status, 400, "and reaches live keys only");

      const pulseAfter = await (await ingest("pulse", "GET", INGEST_TOKEN)).text();
      eq(pulseAfter, pulseText, "ONE WRITER PER KEY: the tick left the nightly pulse row byte-identical");
      const served = await fetch(L("/api/flows/pulse"), { headers: cookie });
      eq(served.headers.get("x-live-overlay"), "live:market", "and the page is served today's tide by a read-time overlay");
      const sp = await served.json();
      ok(sp.refreshed === "intraday" && sp.readDay === "2026-09-23" && sp.tide.points.length === market.tide.n,
        "stamped intraday on today's read, with the live points");
      deep(sp.totals, pulse.totals, "while every nightly feed beside the tide is the nightly's own");

      eq(github.dispatches.length, 0, "10:06 is not a dispatch tick");
      marketNow.value = et("2026-09-23T10:16:00-04:00");
      await tick(RTH, "2026-09-23T10:16:00-04:00");
      eq(github.dispatches.length, 1, "10:16 dispatches the Tier 2 run");
      const d1 = github.dispatches[0];
      eq(d1.path, "/repos/anilkaya001/anilkaya.org/actions/workflows/flows-live.yml/dispatches",
        "to the live workflow of this repository");
      ok(d1.auth === "Bearer stub-dispatch-token" && d1.body.ref === "main" && d1.body.inputs.origin === "worker",
        "authenticated with the dispatch token, on main, saying the Worker sent it");
      marketNow.value = et("2026-09-23T10:21:00-04:00");
      await tick(RTH, "2026-09-23T10:21:00-04:00");
      eq(github.dispatches.length, 1, "at 10:21 the breadth read of 10:10 is eleven minutes old, so the watchdog stays quiet");
      marketNow.value = et("2026-09-23T10:56:00-04:00");
      await tick(RTH, "2026-09-23T10:56:00-04:00");
      eq(github.dispatches.length, 2, "at 10:56, with breadth 46 minutes old, the watchdog re-dispatches off the 15-minute grid");
      eq(github.dispatches[1].body.inputs.origin, "watchdog", "and says so");
      marketNow.value = et("2026-09-23T11:01:00-04:00");
      await tick(RTH, "2026-09-23T11:01:00-04:00");
      eq(github.dispatches.length, 2, "the 11:01 grid tick sees the watchdog's run in flight and sends nothing");
      marketNow.value = et("2026-09-23T11:06:00-04:00");
      await tick(RTH, "2026-09-23T11:06:00-04:00");
      eq(github.dispatches.length, 2, "and the watchdog fires only once per stall");

      const beforeHoliday = vendor.count(/^\/api\/(market|net-flow)\//);
      await tick(RTH, "2026-09-24T10:06:00-04:00");
      await tick(RTH, "2026-09-24T10:11:00-04:00");
      eq(vendor.count(/^\/api\/(market|net-flow)\//) - beforeHoliday, 2,
        "A TAPE-DERIVED HOLIDAY: when the tide still carries yesterday's date after 09:45, the day is marked closed and " +
        "the next tick spends no vendor call");

      await tick(HOUSE, "2026-09-23T17:14:00-04:00");
      eq(github.dispatches.length, 2, "the nightly is not dispatched before 17:15 ET");
      await tick(HOUSE, "2026-09-23T17:30:00-04:00");
      eq(github.dispatches.length, 3, "at 17:30 ET, with meta a session behind, the Worker dispatches the nightly");
      eq(github.dispatches[2].path, "/repos/anilkaya001/anilkaya.org/actions/workflows/flows-pipeline.yml/dispatches",
        "to the nightly workflow");
      eq(github.dispatches[2].body.inputs.origin, "worker", "with origin worker");
      await tick(HOUSE, "2026-09-23T18:00:00-04:00");
      eq(github.dispatches.length, 3, "once");
      await tick(HOUSE, "2026-09-23T18:30:00-04:00");
      eq(github.dispatches.length, 4, "and once more after 18:15 when nothing has landed");
      await tick(HOUSE, "2026-09-23T19:00:00-04:00");
      eq(github.dispatches.length, 4, "never a third time");

      const alerts = mergeLiveAlerts(null, [{ body: fakeFlowAlerts({ session: "2026-09-23",
        now: et("2026-09-23T11:00:00-04:00"), count: 20 }), full: false }],
      { at: et("2026-09-23T11:00:00-04:00"), session: "2026-09-23", writer: "flows-live@test" }).write;
      eq((await ingest("flowalerts", "POST", INGEST_TOKEN, { v: 2, sessionDate: "2026-09-22", generatedAt: "2026-09-22T21:40:00.000Z",
        readAt: "2026-09-22T21:40:00.000Z", rows: [], status: "quiet" })).status, 200, "a nightly flowalerts lands");
      eq((await ingest("live:alerts", "POST", LIVE_TOKEN, alerts)).status, 200, "and today's live union lands beside it");
      const fa = await fetch(L("/api/flows/flowalerts"), { headers: cookie });
      eq(fa.headers.get("x-live-overlay"), "live:alerts", "the alerts route serves the live union for the later session");
      eq((await fa.json()).key, "live:alerts", "whole and unparsed");

      const now = await fetch(L("/api/flows/now?k=market,breadth,tape&n=pulse,board:long,brief"), { headers: cookie });
      eq(now.status, 200, "the heartbeat answers");
      const nb = await now.json();
      ok(nb.keys["live:market"].updatedAt > 0 && nb.keys["live:breadth"].readAt === "2026-09-23T14:10:00.000Z",
        "with every subscribed live key's updatedAt and read instant from columns alone");
      eq(nb.keys["live:tape"].state, "pending", "an unwritten key is pending");
      deep(nb.tier1, { at: new Date(et("2026-09-24T10:11:00-04:00")).toISOString(),
        okAt: new Date(et("2026-09-24T10:06:00-04:00")).toISOString(), why: "holiday" },
      "TIER 1 TELEMETRY FROM D1: /now carries when the last tick began, when one last wrote live:market and how the " +
        "last one ended — on a flows_clock created with 0010's columns, which the Worker's first use upgraded in place");
      deep(nb.clock, { day: "2026-09-24", trading: 0, earlyClose: null },
        "THE SESSION CLOCK TIER 2 READS: /now carries the tape-derived day verdict, so the Actions loop stops on a " +
        "holiday or at an early close the calendar alone cannot know");
      const ic = await ingest("clock", "GET", LIVE_TOKEN);
      deep([ic.status, await ic.json()], [200, { key: "clock", clock: { day: "2026-09-24", trading: 0, earlyClose: null } }],
        "and the Actions loop reads the same verdict from the ingest route under its live credential, not a signed-in route");
      eq((await ingest("clock", "GET", "wrong-token")).status, 401, "never without a credential");
      eq((await ingest("clock", "POST", LIVE_TOKEN, {})).status, 405, "and only by GET: the clock is written by Tier 1 alone");
      eq(nb.keys.pulse.session, "2026-09-22", "and nightly keys carry their session");
      eq(nb.keys.brief.state, "pending", "an unpublished nightly key is pending too");
      ok(nb.phase && typeof nb.phase.phase === "string" && typeof nb.phase.endsAt === "string",
        "the phase and when it ends travel with it");

      const t0 = vendor.count(/net-prem-ticks$/);
      const racers = await Promise.all([0, 1, 2].map(() => fetch(L("/api/flows/tape?t=AAPL"), { headers: cookie })));
      eq(vendor.count(/net-prem-ticks$/) - t0, 1,
        "SINGLE-FLIGHT: three concurrent readers of a cold tape spend exactly one refresh");
      const hows = racers.map((r) => r.headers.get("x-tape")).sort();
      ok(hows.includes("refreshed"), `one of them refreshed (${hows.join(", ")})`);
      const first = await racers.find((r) => r.headers.get("x-tape") === "refreshed").json();
      ok(first.prem.status === "ok" && first.prem.n >= 78 && first.gex.status === "pending",
        "the first refresh reads the premium leg (net-prem-ticks and alerts) and leaves gamma pending — one leg per " +
        "invocation keeps a cold isolate inside 10 ms of CPU");
      eq(first.session, "2026-09-22", "and dates itself from the vendor's rows, not the wall clock");
      const second = await fetch(L("/api/flows/tape?t=AAPL"), { headers: cookie });
      const ahead = hows.includes("stale-refreshing");
      eq(second.headers.get("x-tape"), ahead ? "stale-leased" : "stale-refreshing",
        "the next reader is served at once while the missing leg refreshes" + (ahead
          ? " — a racer that reached the Worker after the first refresh landed already took the lease for that leg " +
            `(${hows.join(", ")}), so this reader finds it held and does not start a second one`
          : ""));
      let legs = 0;
      for (let i = 0; i < 20 && legs !== 3; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const r = await fetch(L("/api/flows/tape?t=AAPL"), { headers: cookie });
        legs = Number(r.headers.get("x-tape-legs"));
        await r.text();
      }
      eq(legs, 3, "until both legs are held");
      eq(vendor.count(/spot-exposures$/), 1, "the gamma leg was read once");
      const full = await (await fetch(L("/api/flows/tape?t=AAPL"), { headers: cookie })).json();
      ok(full.gex.status === "ok" && full.prem.status === "ok", "and the tape carries both");
      ok(Date.parse(full.fresh.readAt) <= Date.parse(full.gex.readAt), "its fresh.readAt is the older leg");

      const q1 = await fetch(L("/api/flows/live?t=AAPL"), { headers: cookie });
      const qb = await q1.json();
      ok(qb.status === "ok" && qb.price === 101.5, "the quote reads the vendor's stock-state");
      const phase = phaseAt(Date.now(), { day: "2026-09-24", trading: 0 }).phase;
      eq(q1.headers.get("x-quote-ttl"), String(LIVE_BUDGET.quoteTtlS[phase]),
        `its cache life follows the market phase on the Worker's own clock (${phase}): 5 s in session, 30 s pre and ` +
        "post, 6 h closed — a clock that holds the tape-derived holiday this suite marked, so a run on that real date " +
        "expects closed");
      eq(q1.headers.get("x-fresh-class"), "quote", "and it carries the quote class");
      const before = vendor.count(/stock-state$/);
      const q2 = await fetch(L("/api/flows/live?t=AAPL"), { headers: cookie });
      await q2.text();
      if (LIVE_BUDGET.quoteTtlS[phase] >= 30) {
        eq(vendor.count(/stock-state$/) - before, 0, "inside its life a second read is served from the cache");
        eq(q2.headers.get("x-chain-cache"), "hit", "and says so");
      }

      const beforeOpen = vendor.count(/^\/api\/(market|net-flow)\//);
      for (const hm of ["09:31", "09:36", "09:41"]) {
        marketNow.value = et(`2026-09-25T${hm}:00-04:00`);
        await tick(RTH, `2026-09-25T${hm}:00-04:00`);
      }
      const opened = await (await fetch(L("/api/flows/now?k=market"), { headers: cookie })).json();
      ok(vendor.count(/^\/api\/(market|net-flow)\//) - beforeOpen === 6 && opened.clock.day === "2026-09-25" &&
         opened.clock.trading === null && opened.tier1.why === "written" &&
         opened.tier1.okAt === new Date(et("2026-09-25T09:41:00-04:00")).toISOString(),
      "THE MORNING AFTER, ON REAL D1: the 09:31 tick rolls flows_clock to the new day with trading NULL, and the 09:36 " +
        "and 09:41 ticks still read and write — a NULL verdict is undecided, never a holiday");
    } finally {
      await live.stop();
      await vendor.close();
      await github.close();
    }
  }

  console.log(`✓ flows-worker: ${checks} assertions — public login, no-store gating, structural bypass resistance, bidirectional audience isolation, legacy learner tolerance, uniform failures, full sign-in round trip, and the two market-wide keys this wave added served on their own gated routes: the sector option lean beside — never merged into — the sector momentum it shares eleven tickers with, and the news tape whose absent per-ticker form is asserted to stay absent. Plus the retirement of the card dialog: the four board routes serve neither it nor the 151k panel library it was the only caller of, and their own ?t= addresses — pushed into history on every open the modal ever had — are 302'd to /flows/ticker/ with the surface they came from, from a Location that is a pure function of the request URL and reads no payload and no session. Plus the live layer: one writer per key held by credential, table and trigger, Tier 1 in exactly two vendor calls with its outcome in D1 on a clock table that upgrades itself, read-time overlays that leave the nightly rows byte-identical, the dispatch clock with its in-flight guard and one-shot watchdog, a tape-derived holiday, the tape's single flight, and quote lives that follow the market phase`);
} finally {
  await server.stop();
}
