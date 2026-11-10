import assert from "node:assert/strict";
import * as K from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsPageRows, FLOWS_PAGE_SLUGS, FLOWS_PUBLIC_SLUGS, FLOWS_GONE_SLUGS } from "../server/routes/flows-pages.js";
import { FLOWS_PAGES, FIRE_SHADOW_LINE, ownerNav } from "../shared/flows-pages.js";
import { workerSource, expect, absent, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const { HttpError, redirect, requireMethod } = K;
const STUB = { currentFlowsUser: async () => null, readFlowsSummary: async () => null, isOwner: () => false };
const table = createRouter(flowsPageRows(STUB));

const SLUGS = ["", "long", "short", "watch", "market", "network", "now", "desk", "strategy", "ticker", "moves", "flowlab", "unusual", "ledger", "events", "political", "status", "fire", "inbox", "digest", "wires"];
eq(FLOWS_PAGE_SLUGS, SLUGS, "the page list is the gated pages in their old order, the Network and Flagged now pop-outs after Market, the owner-gated moves and Flow Lab pages before unusual, and the four Fire & Forget pages last");
eq(FLOWS_PUBLIC_SLUGS, ["about", "glossary"], "and the public front door is the two pages a signed-out reader gets");
const expectedPaths = ["/flows", "/flows/login/"];
for (const slug of SLUGS) {
  expectedPaths.push("/flows/" + (slug ? slug + "/" : ""));
  if (slug) expectedPaths.push("/flows/" + slug);
}
for (const slug of FLOWS_PUBLIC_SLUGS) expectedPaths.push("/flows/" + slug + "/", "/flows/" + slug);
eq(FLOWS_GONE_SLUGS, ["ask", "track", "history"], "the removed pages are Ask, Track and History");
const gonePaths = FLOWS_GONE_SLUGS.flatMap((slug) => ["/flows/" + slug + "/", "/flows/" + slug]);
expectedPaths.push(...gonePaths);
eq(table.rows.map((r) => r.path), expectedPaths, "the family is /flows, the login page, each page and each page's bare form, the two public pages and their bare forms, then the removed pages in both forms");
ok(table.rows.every((r) => r.auth === "none" && r.methods.join() === "GET,HEAD"), "every row is GET and HEAD with no gate: an anonymous visitor gets the login page, not a 401");
ok(new Set(table.rows.map((r) => r.id)).size === table.rows.length && table.rows.every((r) => r.id.startsWith("flows.pages.")), "ids are unique and namespaced");
eq(table.rows.filter((r) => r.path.length > "/flows/".length && !r.path.endsWith("/")).map((r) => r.path.slice("/flows/".length)),
  [...SLUGS.filter(Boolean), ...FLOWS_PUBLIC_SLUGS, ...FLOWS_GONE_SLUGS], "the bare redirects are generated from the page lists, one per page but the overview, and one per removed page");

const FLOWS_READER_FROM = { "/flows/": "overview", "/flows/long/": "long", "/flows/short/": "short", "/flows/watch/": "watch" };

const FF_PAGE_FLAG = { "/flows/fire/": "FF_ROUTE_FIRE", "/flows/inbox/": "FF_ROUTE_INBOX", "/flows/digest/": "FF_ROUTE_INBOX", "/flows/wires/": "FF_ROUTE_WIRES" };
const ffWord = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const ffModeOf = (env) => (ffWord(env.FF_MODE) === "on" ? "on" : ffWord(env.FF_MODE) === "shadow" ? "shadow" : "off");
const ffOpen = (env, flag) => ffModeOf(env) !== "off" && ffWord(env[flag]) === "on";
const FIRE_ENTRY = '<a href="/flows/fire/" data-ff-nav><svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-fire"/></svg><span class="rail-label">Fire</span></a>\n      <a href="/flows/strategy/"';
const withFireEntry = (page) => {
  const parts = page.split('<a href="/flows/strategy/"');
  return parts.length === 2 ? parts[0] + FIRE_ENTRY + parts[1] : page;
};

function oldChain(path, rc, d) {
  const { request, env, url } = rc;
  if (path === "/flows") {
    requireMethod(request, ["GET", "HEAD"]);
    return redirect(new URL("/flows/", url).toString(), 308);
  }
  if (path === "/flows/login/") {
    requireMethod(request, ["GET", "HEAD"]);
    return new Response(FLOWS_PAGES.loginPage(), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return (async () => {
    if (Object.hasOwn(FLOWS_READER_FROM, path) && url.searchParams.has("t")) {
      const wanted = (url.searchParams.get("t") || "").trim();
      if (wanted) {
        requireMethod(request, ["GET", "HEAD"]);
        return redirect(new URL("/flows/ticker/?t=" + encodeURIComponent(wanted) + "&s=signal&from=" + FLOWS_READER_FROM[path], url).toString(), 302);
      }
    }
    const FLOWS_PUBLIC = {
      "/flows/about/": () => FLOWS_PAGES.aboutPage(),
      "/flows/glossary/": () => FLOWS_PAGES.glossaryPage(),
    };
    if (Object.hasOwn(FLOWS_PUBLIC, path) && String(env.FLOWS_FRONT_DOOR || "on").trim().toLowerCase() !== "off") {
      requireMethod(request, ["GET", "HEAD"]);
      return new Response(FLOWS_PUBLIC[path](), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const FLOWS_ROUTES = {
      "/flows/": (u, summary) => FLOWS_PAGES.overviewPage({ username: u, summary }),
      "/flows/long/": (u) => FLOWS_PAGES.sidePage({ username: u, side: "long" }),
      "/flows/short/": (u) => FLOWS_PAGES.sidePage({ username: u, side: "short" }),
      "/flows/watch/": (u) => FLOWS_PAGES.watchPage({ username: u }),
      "/flows/market/": (u, summary, owner) => FLOWS_PAGES.marketPage({ username: u, owner }),
      "/flows/network/": (u) => FLOWS_PAGES.networkPage({ username: u }),
      "/flows/now/": (u) => FLOWS_PAGES.nowPage({ username: u }),
      "/flows/desk/": (u) => FLOWS_PAGES.deskPage({ username: u }),
      "/flows/strategy/": (u) => FLOWS_PAGES.strategyPage({ username: u }),
      "/flows/ticker/": (u) => FLOWS_PAGES.tickerPage({ username: u }),
      "/flows/moves/": (u) => FLOWS_PAGES.movesPage({ username: u }),
      "/flows/flowlab/": (u) => FLOWS_PAGES.flowlabPage({ username: u }),
      "/flows/unusual/": (u, summary, owner) => FLOWS_PAGES.unusualPage({ username: u, owner }),
      "/flows/ledger/": (u) => FLOWS_PAGES.ledgerPage({ username: u }),
      "/flows/events/": (u) => FLOWS_PAGES.eventsPage({ username: u }),
      "/flows/political/": (u) => FLOWS_PAGES.politicalPage({ username: u }),
      "/flows/status/": (u) => FLOWS_PAGES.statusPage({ username: u }),
      "/flows/fire/": (u, summary, owner, e) => FLOWS_PAGES.firePage({ username: u, shadow: ffModeOf(e) === "shadow" }),
      "/flows/inbox/": (u, summary, owner, e) => FLOWS_PAGES.ffPendingPage({ username: u, page: "inbox", shadow: ffModeOf(e) === "shadow" }),
      "/flows/digest/": (u, summary, owner, e) => FLOWS_PAGES.ffPendingPage({ username: u, page: "digest", shadow: ffModeOf(e) === "shadow" }),
      "/flows/wires/": (u, summary, owner, e) => FLOWS_PAGES.ffPendingPage({ username: u, page: "wires", shadow: ffModeOf(e) === "shadow" }),
    };
    if (Object.hasOwn(FLOWS_ROUTES, path)) {
      requireMethod(request, ["GET", "HEAD"]);
      const session = await d.currentFlowsUser(request, env);
      const gateOf = { "/flows/moves/": "FLOWS_MOVES", "/flows/ledger/": "FLOWS_LEDGER" }[path];
      if (session && gateOf) {
        const mode = String(env[gateOf] || "owner").trim().toLowerCase();
        if (mode === "off" || (mode !== "on" && !d.isOwner(env, session.username))) throw HttpError.of("not_found");
      }
      if (session && Object.hasOwn(FF_PAGE_FLAG, path) && !ffOpen(env, FF_PAGE_FLAG[path])) throw HttpError.of("not_found");
      const summary = session && path === "/flows/" ? await d.readFlowsSummary(env, "board") : null;
      const owner = session ? d.isOwner(env, session.username) : false;
      if (session && path === "/flows/flowlab/") {
        const lab = String(env.FLOWS_FLOWLAB || "").trim().toLowerCase();
        if (!(lab === "on" || (lab === "owner" && owner))) throw HttpError.of("not_found");
      }
      if (session && path === "/flows/status/" && !owner) throw new HttpError(404, "not_found", "Not found");
      const drawn = session ? FLOWS_ROUTES[path](session.username, summary, owner, env) : FLOWS_PAGES.loginPage();
      const page = session && ffOpen(env, "FF_ROUTE_FIRE") && path !== "/flows/fire/" ? withFireEntry(drawn) : drawn;
      const body = session && owner ? ownerNav(page) : page;
      return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (path === "/flows/long" || path === "/flows/short" || path === "/flows/desk"
        || path === "/flows/watch"
        || path === "/flows/market" || path === "/flows/network" || path === "/flows/now" || path === "/flows/ticker"
        || path === "/flows/moves" || path === "/flows/flowlab" || path === "/flows/unusual" || path === "/flows/ledger" || path === "/flows/events"
        || path === "/flows/political"
        || path === "/flows/strategy"
        || path === "/flows/status" || path === "/flows/about" || path === "/flows/glossary"
        || path === "/flows/fire" || path === "/flows/inbox" || path === "/flows/digest" || path === "/flows/wires") {
      requireMethod(request, ["GET", "HEAD"]);
      return redirect(new URL(path + "/", url).toString(), 308);
    }
    if (Object.hasOwn(FLOWS_PUBLIC, path)) throw new HttpError(404, "not_found", "Not found");
    return "fell-through";
  })();
}

const view = (e) => (e ? { status: e.status, code: e.code, message: e.message, headers: e.headers } : null);
async function outcome(run) {
  try {
    const res = await run();
    if (res === "fell-through" || res === null) return { fell: true };
    return { status: res.status, headers: [...res.headers].sort(), body: await res.text() };
  } catch (e) {
    return { threw: view(e) };
  }
}

function scenario(user) {
  const log = [];
  return {
    log,
    deps: {
      currentFlowsUser: async (request) => { log.push(["user", request.method]); return user; },
      readFlowsSummary: async (env, scope) => { log.push(["summary", scope]); return { scope, n: 3 }; },
      isOwner: (env, username) => { log.push(["owner", username]); return username === "anilkaya"; },
    },
  };
}

const PATHS = [...new Set([...expectedPaths, "/flows/zz/", "/flows/zz", "/flows/login", "/flows/logout", "/flows/long//", "/flows/LONG/", "/flows/", "/flows//"])];
const QUERIES = ["", "?t=NVDA", "?t=", "?t=%20", "?t=%20nvda%20", "?t=a%26b", "?x=1", "?t=NVDA&t=AAPL", "?t=BRK.B&refresh=1", "?T=NVDA"];
const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
const USERS = [null, { username: "anilkaya" }, { username: "member<x>" }];
const ENVS = [{ tag: "env" }, { tag: "env", FLOWS_FRONT_DOOR: "off" }, { tag: "env", FLOWS_FRONT_DOOR: " OFF " }, { tag: "env", FLOWS_FRONT_DOOR: "maybe" }, { tag: "env", FLOWS_FRONT_DOOR: "" }, { tag: "env", FLOWS_LEDGER: "on" }, { tag: "env", FLOWS_LEDGER: " OFF " }, { tag: "env", FLOWS_LEDGER: "maybe" },
  { tag: "env", FF_MODE: "shadow", FF_ROUTE_FIRE: "on", FF_ROUTE_INBOX: "on", FF_ROUTE_WIRES: "on" }, { tag: "env", FF_MODE: " ON ", FF_ROUTE_FIRE: "on", FF_ROUTE_INBOX: "yes" }];
const isOff = (env) => String(env.FLOWS_FRONT_DOOR || "on").trim().toLowerCase() === "off";

let compared = 0;
let offOther = 0;
for (const path of PATHS) {
  for (const q of QUERIES) {
    for (const method of METHODS) {
      for (const user of USERS) {
        for (const env of ENVS) {
          const mk = () => {
            const sc = scenario(user);
            const url = new URL("https://anilkaya.org" + path + q);
            const request = new Request(url, { method });
            return { sc, rc: { request, env, url, ctx: {} } };
          };
          const a = mk();
          const b = mk();
          const router = createRouter(flowsPageRows(a.sc.deps));
          const got = await outcome(() => router.handle(a.rc, { flows: async () => assert.fail("the page rows never consult the Flows gate") }));
          const want = await outcome(() => oldChain(path, b.rc, b.sc.deps));
          const key = `${method} ${path}${q} ${user && user.username} ${JSON.stringify(env)}`;
          const publicOff = isOff(env) && (path === "/flows/about/" || path === "/flows/glossary/");
          if (gonePaths.includes(path)) {
            eq(want, { fell: true }, key + ": the chain had no row for a removed page and answered it with the unknown-page 404");
            if (method === "GET" || method === "HEAD") eq([got.status, got.headers.find((h) => h[0] === "location")], [308, ["location", "https://anilkaya.org/flows/"]], key + ": a removed page is a 308 to Flows home");
            else eq(got.threw && [got.threw.status, got.threw.code], [405, "method_not_allowed"], key + ": a removed page takes GET and HEAD only");
            eq(a.sc.log, [], key + ": and reads no session");
          } else if (publicOff && method !== "GET" && method !== "HEAD") {
            eq(want.threw && want.threw.status, 404, key + ": the chain answered a switched-off front door with the Flows 404 whatever the method");
            eq(got.threw && [got.threw.status, got.threw.code, got.threw.headers.Allow], [405, "method_not_allowed", "GET, HEAD"], key + ": the table answers a method the row does not take with its 405 first");
            offOther++;
          } else if (want.fell) {
            eq(got, { fell: true }, key + ": a path that is not a page falls through to the chain");
            eq(a.sc.log, [], key + ": and reads no session");
          } else {
            eq(got, want, key);
            eq(a.sc.log, b.sc.log, key + ": the same reads in the same order");
          }
          compared++;
        }
      }
    }
  }
}
ok(offOther > 0, "the switched-off front door was compared under methods other than GET and HEAD: " + offOther);
ok(compared >= 5000, "every path, query, method and member was compared with the code it replaced: " + compared);

{
  const sc = scenario({ username: "anilkaya" });
  const router = createRouter(flowsPageRows(sc.deps));
  const rc = (path) => ({ request: new Request("https://anilkaya.org" + path), env: {}, url: new URL("https://anilkaya.org" + path), ctx: {} });
  const home = await router.find("/flows/").handler(rc("/flows/"));
  eq(sc.log, [["user", "GET"], ["summary", "board"], ["owner", "anilkaya"]], "Home reads the session, then the board summary, then asks whether the member is an owner, once each");
  eq([home.status, home.headers.get("Content-Type")], [200, "text/html; charset=utf-8"], "and answers 200 HTML");
  sc.log.length = 0;
  await router.find("/flows/long/").handler(rc("/flows/long/"));
  eq(sc.log, [["user", "GET"], ["owner", "anilkaya"]], "every other page reads the session, then asks whether the member is an owner");
  sc.log.length = 0;
  const anonymous = createRouter(flowsPageRows(scenario(null).deps));
  const login = await anonymous.find("/flows/market/").handler(rc("/flows/market/"));
  eq([login.status, await login.text()], [200, FLOWS_PAGES.loginPage()], "an anonymous visitor gets the login page with HTTP 200");
  const hop = await router.find("/flows/watch/").handler(rc("/flows/watch/?t=%20msft%20"));
  eq([hop.status, hop.headers.get("Location"), sc.log.length], [302, "https://anilkaya.org/flows/ticker/?t=msft&s=signal&from=watch", 0], "the reader redirect precedes the session read");
  const gate = async (user) => {
    const t = createRouter(flowsPageRows(scenario(user).deps));
    try {
      const res = await t.find("/flows/status/").handler(rc("/flows/status/"));
      return [res.status, (await res.text()) === FLOWS_PAGES.loginPage() ? "login" : "page"];
    } catch (e) {
      return [e.status, e.code];
    }
  };
  eq(await gate({ username: "anilkaya" }), [200, "page"], "the Status page is served to an owner");
  eq(await gate({ username: "member<x>" }), [404, "not_found"], "a signed-in member who is not an owner gets the unknown-page 404");
  eq(await gate(null), [200, "login"], "and an anonymous visitor gets the sign-in page like every gated page");
  const SIDEBAR_PAGES = ["", "long", "short", "watch", "market", "network", "now", "desk", "strategy", "ticker", "moves", "flowlab", "unusual", "ledger", "events", "political", "status", "fire", "inbox", "digest", "wires"];
  for (const slug of SIDEBAR_PAGES) {
    const path = "/flows/" + (slug ? slug + "/" : "");
    const env = { FLOWS_MOVES: "on", FLOWS_LEDGER: "on", FLOWS_FLOWLAB: "on", FF_MODE: "shadow", FF_ROUTE_FIRE: "on", FF_ROUTE_INBOX: "on", FF_ROUTE_WIRES: "on" };
    const call = (deps) => createRouter(flowsPageRows(deps)).find(path).handler({ ...rc(path), env }).then((r) => r.text());
    const asOwner = await call(scenario({ username: "anilkaya" }).deps);
    ok(!asOwner.includes("railOps") && !asOwner.includes(">Operations<") && !asOwner.includes('href="/flows/status/"') && !asOwner.includes("view=latency"), path + ": NO SIDEBAR CARRIES AN OPERATIONS GROUP, a Status link or a Latency link, an owner's included");
    if (slug === "status") continue;
    const asMember = await call({ ...scenario({ username: "anilkaya" }).deps, isOwner: () => false });
    ok(!asMember.includes("railOps") && !asMember.includes("/flows/status/"), path + ": a member's HTML names neither the group nor the page");
    if (slug === "market" || slug === "unusual") continue;
    const brand = /<a class="ff-brand" href="([^"]*)"/;
    ok((asOwner.match(brand) || [])[1] === "/flows/status/#view=coverage" && (asMember.match(brand) || [])[1] === "/flows/about/", path + ": the trade-mark opens data coverage for an owner and About for a member");
    const noBrand = (t) => t.replace(/<a class="ff-brand"[\s\S]*?<\/a>/, "");
    eq(noBrand(asOwner), noBrand(asMember), path + ": and is otherwise byte-identical to the member's");
  }
  const ledgerAs = async (user, env) => {
    const t = createRouter(flowsPageRows(scenario(user).deps));
    try {
      const res = await t.find("/flows/ledger/").handler({ ...rc("/flows/ledger/"), env });
      return [res.status, (await res.text()) === FLOWS_PAGES.loginPage() ? "login" : "page"];
    } catch (e) {
      return [e.status, e.code];
    }
  };
  eq(await ledgerAs({ username: "member<x>" }, {}), [404, "not_found"], "the Ledger page is closed to a member while FLOWS_LEDGER is unset: the owner opens it by setting it to on");
  eq(await ledgerAs({ username: "anilkaya" }, {}), [200, "page"], "and open to an owner");
  eq(await ledgerAs({ username: "member<x>" }, { FLOWS_LEDGER: "on" }), [200, "page"], "on opens it to a member");
  eq(await ledgerAs({ username: "anilkaya" }, { FLOWS_LEDGER: "off" }), [404, "not_found"], "off closes it to the owner too");
  eq(await ledgerAs({ username: "member<x>" }, { FLOWS_LEDGER: "members" }), [404, "not_found"], "a value that is not on, off or owner fails closed for a member");
  eq(await ledgerAs(null, {}), [200, "login"], "and an anonymous visitor is answered with the sign-in page whatever the switch says");
  const wrangler = (await import("node:fs")).readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  ok(/^FLOWS_LEDGER = "on"$/m.test(wrangler), "wrangler.toml ships the switch on: the ledger is every member's page");

  const member = { username: "member<x>" };
  const FF_ON = { FF_MODE: "on", FF_ROUTE_FIRE: "on", FF_ROUTE_INBOX: "on", FF_ROUTE_WIRES: "on" };
  const ffAs = async (slug, user, env) => {
    const path = "/flows/" + slug + "/";
    try {
      const res = await createRouter(flowsPageRows(scenario(user).deps)).find(path).handler({ ...rc(path), env });
      const text = await res.text();
      return [res.status, text === FLOWS_PAGES.loginPage() ? "login" : "page", text];
    } catch (e) {
      return [e.status, e.code, ""];
    }
  };
  const FF_FLAG = { fire: "FF_ROUTE_FIRE", inbox: "FF_ROUTE_INBOX", digest: "FF_ROUTE_INBOX", wires: "FF_ROUTE_WIRES" };
  for (const slug of Object.keys(FF_FLAG)) {
    eq((await ffAs(slug, member, {})).slice(0, 2), [404, "not_found"], slug + ": a Fire & Forget page is the unknown-page 404 while FF_MODE is unset");
    eq((await ffAs(slug, member, { ...FF_ON, FF_MODE: "off" })).slice(0, 2), [404, "not_found"], slug + ": and while it is off, whatever the route switches say");
    eq((await ffAs(slug, member, { ...FF_ON, FF_MODE: "members" })).slice(0, 2), [404, "not_found"], slug + ": a mode that is neither on nor shadow fails closed");
    eq((await ffAs(slug, { username: "anilkaya" }, { ...FF_ON, FF_MODE: "off" })).slice(0, 2), [404, "not_found"], slug + ": for an owner too");
    eq((await ffAs(slug, member, { ...FF_ON, [FF_FLAG[slug]]: "off" })).slice(0, 2), [404, "not_found"], slug + ": its own route switch closes it");
    eq((await ffAs(slug, member, { ...FF_ON, [FF_FLAG[slug]]: "yes" })).slice(0, 2), [404, "not_found"], slug + ": and only the word on opens it");
    eq((await ffAs(slug, null, {})).slice(0, 2), [200, "login"], slug + ": an anonymous visitor gets the sign-in page whatever the switches say");
    eq((await ffAs(slug, null, FF_ON)).slice(0, 2), [200, "login"], slug + ": with the switches on as well");
    for (const mode of ["on", "shadow", " Shadow "]) {
      const [status, kind, text] = await ffAs(slug, member, { ...FF_ON, FF_MODE: mode });
      eq([status, kind], [200, "page"], slug + ": open to every member under FF_MODE " + mode.trim());
      const shadow = mode.trim().toLowerCase() === "shadow";
      eq(text.split(FIRE_SHADOW_LINE).length - 1, shadow ? 1 : 0, slug + ": the shadow sentence is on the page exactly when the mode is shadow");
      ok(text.includes('data-ff-page="' + slug + '"'), slug + ": the page carries its data-ff-page hook");
    }
  }
  eq((await ffAs("inbox", member, { ...FF_ON, FF_ROUTE_FIRE: "off" })).slice(0, 2), [200, "page"], "a route switch closes only its own pages: Fire off leaves the Inbox open");
  eq((await ffAs("fire", member, { ...FF_ON, FF_ROUTE_INBOX: "off", FF_ROUTE_WIRES: "off" })).slice(0, 2), [200, "page"], "and Inbox and Wires off leave Fire open");
  ok(FIRE_SHADOW_LINE === "Running in shadow: wires are evaluated, hits are not delivered yet." && FIRE_SHADOW_LINE.split(/\s+/).length <= 14, "the shadow sentence is one short sentence");
  {
    const fire = (await ffAs("fire", member, { ...FF_ON, FF_MODE: "shadow" }))[2];
    const banner = /<p class="ffx-banner" id="ffxBanner"([^>]*)>([^<]*)<\/p>/.exec(fire);
    ok(banner && !/\bhidden\b/.test(banner[1]) && banner[2] === FIRE_SHADOW_LINE, "in shadow the Fire page's banner is shown and says so");
    const live = /<p class="ffx-banner" id="ffxBanner"([^>]*)>([^<]*)<\/p>/.exec((await ffAs("fire", member, FF_ON))[2]);
    ok(live && /\bhidden\b/.test(live[1]) && live[2] === "", "and with FF_MODE on the banner is hidden and empty");
    for (const slug of ["inbox", "digest", "wires"]) {
      const text = (await ffAs(slug, member, FF_ON))[2];
      ok(/— unavailable: the [A-Za-z ]+ is not released yet\./.test(text) && text.includes('data-ff-absent="not_released"'), slug + ": a page that is not built says so as an em dash with its reason, never an empty list");
      ok(text.includes('<a class="ds-btn" href="/flows/fire/">Open Fire</a>'), slug + ": and links to Fire");
    }
  }
  const NAV_PAGES = ["", "long", "short", "watch", "market", "network", "now", "desk", "strategy", "ticker", "moves", "flowlab", "unusual", "ledger", "events", "political", "inbox", "digest", "wires"];
  const navEnv = { FLOWS_MOVES: "on", FLOWS_LEDGER: "on", FLOWS_FLOWLAB: "on" };
  for (const slug of NAV_PAGES) {
    const path = "/flows/" + (slug ? slug + "/" : "");
    const draw = (env) => createRouter(flowsPageRows(scenario(member).deps)).find(path).handler({ ...rc(path), env }).then((r) => r.text());
    const open = await draw({ ...navEnv, ...FF_ON });
    const links = open.match(/<a href="\/flows\/fire\/"[^>]*>/g) || [];
    eq(links, ['<a href="/flows/fire/" data-ff-nav>'], path + ": with Fire open the sidebar carries one Fire entry");
    ok(open.indexOf('<a href="/flows/fire/" data-ff-nav>') < open.indexOf('<a href="/flows/strategy/"') && open.indexOf('id="railTools"') < open.indexOf('<a href="/flows/fire/" data-ff-nav>'), path + ": in the Tools group, before Strategy");
    if (FF_FLAG[slug]) continue;
    for (const env of [navEnv, { ...navEnv, ...FF_ON, FF_MODE: "off" }, { ...navEnv, ...FF_ON, FF_ROUTE_FIRE: "off" }, { ...navEnv, FF_ROUTE_FIRE: "on" }]) {
      const shut = await draw(env);
      ok(!shut.includes("/flows/fire/") && !shut.includes("data-ff-nav"), path + ": with Fire closed no member page names it");
      eq(open.replace('<a href="/flows/fire/" data-ff-nav><svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-fire"/></svg><span class="rail-label">Fire</span></a>\n      ', ""), shut, path + ": and the entry is the only difference the switch makes");
    }
  }
  {
    const fire = (await ffAs("fire", member, FF_ON))[2];
    eq(fire.match(/<a href="\/flows\/fire\/"[^>]*>/g), ['<a href="/flows/fire/" class="is-on" aria-current="page">'], "the Fire page marks its own entry as the current page and adds no second one");
  }
  ok(/^FF_MODE = "shadow"$/m.test(wrangler) && /^FF_ROUTE_FIRE = "on"$/m.test(wrangler), "wrangler.toml ships Fire & Forget in shadow with the Fire page on");
  const bare = await router.find("/flows/political").handler(rc("/flows/political"));
  eq([bare.status, bare.headers.get("Location")], [308, "https://anilkaya.org/flows/political/"], "a bare page path is a 308 to its slash form");
}

{
  const w = workerSource();
  const text = moduleSource("worker.js");
  expect(w, /createRouter\(flowsReadRows\([\s\S]*?flowsIngestRows\([\s\S]*?\),\s*flowsPageRows\(\{/, { min: 1, max: 1, why: "the Worker's one table takes the flows-pages family" });
  for (const p of table.rows.map((r) => r.path)) {
    absent(text, new RegExp('path === "' + p.replace(/[-/]/g, "\\$&") + '"'), { anchor: /path === "\/flows\/login"/, why: p + " is a table row and no longer a branch of the chain" });
  }
  absent(text, /\bFLOWS_ROUTES\b|\bFLOWS_READER_FROM\b/, { anchor: /path === "\/flows\/logout"/, why: "the page table moved out of the Worker" });
  absent(text, /FLOWS_PAGES\.(overviewPage|sidePage|watchPage|marketPage|networkPage|nowPage|deskPage|strategyPage|tickerPage|unusualPage|movesPage|ledgerPage|eventsPage|politicalPage|statusPage|firePage|ffPendingPage)/, { anchor: /FLOWS_PAGES\.loginPage\(/, why: "the Worker renders only the sign-in page itself" });
  const src = moduleSource("server/routes/flows-pages.js");
  ok(!/from "\.\.\/\.\.\/worker\.js"|cloudflare:|\bfetch\(|\benv\.DB\b/.test(src), "the family imports neither the Worker nor the platform and reads no store: the session and the summary are injected");
  ok(!/\bsetCookie\b|Set-Cookie|\.json\(/.test(src), "and sets no cookie and answers no JSON");
}

console.log("server-pages: " + checks + " checks");
