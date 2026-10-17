import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { ROOT, NOW, RAIL, META, SPEND, READY, HEARTBEAT, SERIES, world, serve, opsFor } from "./lib/status-world.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const require = createRequire(import.meta.url);
let AXE = null;
try { AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); } catch { AXE = null; }

const HEALTH_ROUTES = ["/api/flows/ai-usage", "/api/flows/lk?k=heartbeat", "/api/flows/meta", "/api/flows/ops", "/api/flows/ready", "/api/rt/status"];
const LATENCY_ROUTES = ["/api/flows/lk?k=heartbeat", "/api/flows/lk?k=strips:series", "/api/flows/meta", "/api/flows/ops", "/api/flows/ops?part=ai", "/api/flows/ready", "/api/rt/status"];
const USAGE_ROUTES = ["/api/flows/ai-usage", "/api/flows/meta", "/api/flows/ops", "/api/flows/ops?part=ai", "/api/flows/ready", "/api/rt/status"];
const ALLOWED = /^\/api\/(rt\/status|flows\/(ops|lk|meta|ready|ai-usage))/;

async function open(browser, { width = 1440, view = "", map = world(), serveOpts = {}, mutate = null, pause = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const asked = [];
  const errors = [];
  await serve(page, map, { asked, errors, ...serveOpts });
  if (mutate) {
    await page.route(/\/assets\/js\/flows-status[\w-]*\.js/, async (route) => {
      const u = new URL(route.request().url());
      let text = fs.readFileSync(path.join(ROOT, u.pathname), "utf8");
      const next = mutate(text, path.basename(u.pathname));
      return route.fulfill({ contentType: "text/javascript", body: next });
    });
  }
  await page.clock.install({ time: new Date(NOW) });
  await page.goto("https://example.test/flows/status/" + (view ? "#view=" + view : ""));
  await page.waitForFunction(() => !document.getElementById("stAgain").disabled);
  if (view && view !== "health") await page.waitForFunction((v) => /read \d\d:\d\d:\d\d TRT/.test((document.querySelector(v === "latency" ? "#stFeedsAsof" : "#stMetersAsof") || {}).textContent || ""), view);
  if (pause) await page.clock.pauseAt(new Date(NOW + 5000));
  return { page, asked, errors };
}

const text = (page, sel) => page.evaluate((s) => document.querySelector(s).innerText, sel);
const uniq = (list) => [...new Set(list)].sort();
const fail = (map, path, status, code) => { map[path] = { status, body: { error: { code, message: code } } }; };

async function core(page, asked) {
  const problems = [];
  const expect = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
  const rail = await text(page, "#stRail");
  const meta = await text(page, "#stMeta");
  const note = await text(page, "#stNote");
  const ai = await text(page, "#stAi");
  const tiles = await text(page, "#stTiles");
  const all = await text(page, "body");
  expect(/fl\s+socket\s+yes[^\n]*2\.3 s\s+7\.4 s\s+180/.test(rail), "the flagged-alert row prints the item lag 2.3 s, 7.4 s and its 180 samples: " + rail.split("\n").filter((l) => /^fl/.test(l)).join("|"));
  expect(/14,900 of 30,000 \(site cap\)/.test(ai) && /15,100 neurons/.test(ai) && !/10,000 free a day/.test(ai), "neurons are measured against the enforced 30,000 cap: " + ai.slice(0, 300));
  expect(/Read at 21:41:07 TRT/.test(meta), "the read time is 21:41:07 TRT: " + meta);
  expect(!/\b(UTC|EDT|EST|GMT)\b|\bET\b/.test(all), "no other time zone is named");
  expect(new RegExp("All " + uniq(asked).length + " sources read\\.").test(note), "the source count is the number of routes asked (" + uniq(asked).length + "): " + note);
  expect(/1\.8 s/.test(tiles) && /2\.3 s/.test(tiles), "the tiles print the price and alert lag: " + tiles.slice(0, 200));
  expect(!/\b0 neurons\b/.test(ai), "a measured spend is never a zero remainder");
  return problems;
}

const browser = await chromium.launch();
try {
  {
    const { page, asked, errors } = await open(browser);
    eq(uniq(asked), HEALTH_ROUTES, "THE HEALTH TAB reads six existing owner routes and no other");
    ok(asked.every((p) => ALLOWED.test(p)), "and none of them is a vendor or a model route");
    const problems = await core(page, asked);
    eq(problems, [], "the core readings of the Health tab hold");
    const line = await text(page, "#stReady");
    ok(/Ready/.test(line) && /US session open/.test(line), "the readiness line: " + line);
    eq(await page.evaluate(() => document.querySelectorAll("h1").length), 1, "one h1");
    eq(await page.evaluate(() => [...document.querySelectorAll("main h1, main h2, main h3")].filter((e) => e.offsetParent !== null).map((e) => e.tagName)),
      ["H1", "H2", "H2", "H2", "H2", "H2"], "the visible outline is h1 then the five Health modules, no level skipped");
    const rail = await text(page, "#stRail");
    ok(/Vendor key counter\s+21,400 calls today, read 21:41:03 TRT/.test(rail), "the vendor counter the rail read is printed with its TRT time: " + rail.slice(0, 500));
    ok(/Upstream\s+composite, socket connected/.test(rail) && /Started\s+18:41 TRT/.test(rail), "the socket upstream state and the start in TRT");
    ok(/mk\s+rest/.test(rail) && /px\s+socket/.test(rail), "each topic names its transport");
    ok(/frame against the vendor's stamp/.test(rail) && /behind the item's own time/.test(rail), "and what its lag is measured against");
    const tiles = await text(page, "#stTiles");
    ok(/VENDOR CALLS TODAY[\s\S]*21,400/i.test(tiles) && /MODEL NEURONS TODAY[\s\S]*14,900 of 30,000/i.test(tiles), "the vendor and model tiles: " + tiles.replace(/\n/g, "|"));
    const sw = await text(page, "#stSw");
    ok(/FLOWS_RT_MODE\s+on/.test(sw) && /FLOWS_SCENES\s+unset/.test(sw) && /set in wrangler\.toml/.test(sw), "the switches are read-only with their values and where they are set");
    const eng = await text(page, "#stEng");
    ok(/GitHub refused the Worker's dispatch \(refused:403\), an owner action/.test(eng), "the GitHub dispatch refusal is on the page: " + eng.slice(0, 300));
    ok(/Landed 03:30 TRT/.test(eng) && /Last tick 21:40 TRT/.test(eng), "engine times are TRT");
    eq(errors, [], "no page error");
    const pressed = await page.evaluate(() => [...document.querySelectorAll("#stTabs [role=tab]")].map((b) => [b.id, b.getAttribute("aria-controls"), b.getAttribute("aria-selected")]));
    eq(pressed, [["stTab-health", "stPanel-health", "true"], ["stTab-latency", "stPanel-latency", "false"], ["stTab-usage", "stPanel-usage", "false"]], "the tabs are a tablist wired to their panels");
    eq(await page.evaluate(() => [...document.querySelectorAll("[role=tabpanel]")].map((p) => [p.id, p.getAttribute("aria-labelledby"), p.hidden])),
      [["stPanel-health", "stTab-health", false], ["stPanel-latency", "stTab-latency", true], ["stPanel-usage", "stTab-usage", true]], "each panel is labelled by its tab and only one is shown");
    await page.close();
  }

  {
    const { page, asked, errors } = await open(browser);
    await page.focus("#stTab-health");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.location.hash === "#view=latency");
    ok(await page.evaluate(() => !document.getElementById("stPanel-latency").hidden && document.getElementById("stPanel-health").hidden), "the arrow key opens Latency and the hash follows it");
    await page.keyboard.press("End");
    await page.waitForFunction(() => window.location.hash === "#view=usage");
    await page.keyboard.press("Home");
    await page.waitForFunction(() => window.location.hash === "#view=health");
    await page.evaluate(() => { window.location.hash = "#view=usage"; });
    await page.waitForFunction(() => !document.getElementById("stPanel-usage").hidden);
    ok(await page.evaluate(() => document.getElementById("stTab-usage").getAttribute("aria-selected") === "true"), "a hash change selects its tab");
    await page.waitForFunction(() => /read \d\d:\d\d:\d\d TRT/.test(document.getElementById("stMetersAsof").textContent));
    eq(uniq(asked.slice(HEALTH_ROUTES.length)).filter((p) => p === "/api/flows/ops?part=ai").length, 1, "the outcome block is read once, when a tab that shows it opens");
    ok(await page.evaluate(() => document.querySelector('#railOps').nextElementSibling.querySelector('a[aria-current="page"]').textContent.includes("Status")), "the sidebar marks Status on the Usage tab");
    await page.evaluate(() => { window.location.hash = "#view=latency"; });
    await page.waitForFunction(() => document.querySelector('#railOps').nextElementSibling.querySelector('a[aria-current="page"]').textContent.includes("Latency"));
    eq(errors, [], "no page error while switching");
    await page.close();
  }

  {
    const { page, asked, errors } = await open(browser, { view: "latency" });
    eq(uniq(asked), LATENCY_ROUTES, "THE LATENCY TAB reads seven existing owner routes and no other");
    ok(asked.every((p) => ALLOWED.test(p)), "none of them a vendor or model route");
    ok(/Read at 21:41:07 TRT/.test(await text(page, "#stMeta")) && /All 7 sources read\./.test(await text(page, "#stNote")), "the header counts seven sources");
    const feeds = await text(page, "#stFeeds");
    ok(/Prices[\s\S]*p50 1\.8 s · p95 4\.9 s · 256 samples/.test(feeds), "prices: p50, p95 and n: " + feeds.slice(0, 400));
    ok(/Flagged alerts[\s\S]*p50 2\.3 s · p95 7\.4 s · 180 samples/.test(feeds), "flagged alerts read the item lag, not the frame lag");
    ok(/Dealer gamma[\s\S]*p50 21\.0 s · p95 50\.0 s/.test(feeds) && /Market tide[\s\S]*p50 31\.0 s/.test(feeds) && /News[\s\S]*p95 4 min/.test(feeds), "dealer gamma, market tide and news");
    ok(/Quote age p95\s+41\.0 s, 256 rows/.test(feeds), "price quote age");
    ok(/Poll round trip\s+socket: no poll/.test(feeds) && /Poll round trip\s+p50 700 ms, p95 1\.5 s/.test(feeds), "round trip for REST and none for the socket");
    ok(/Live share of watched time\s+96% of 3\.0 h \(vendor lag 3%, ours 1%\)/.test(feeds), "live share of watched time with its split");
    ok(/live window 15\.0 s, stale at 1 min/.test(feeds), "the live window and the stale line");
    ok(/No option-prints feed on the rail \(F-94, F-116\)/.test(feeds), "option prints say there is no feed");
    ok(/The vendor's pipeline before it stamps a row is upstream of these figures\. Flagged alerts on the vendor's own socket ran 5\.9 s p50/.test(feeds), "and the foot states what is upstream");
    ok(await page.evaluate(() => document.querySelectorAll("#stFeeds svg.lt-bar").length === 5), "five range bars");
    const sess = await text(page, "#stSession");
    ok(/not recorded/.test(sess) && /1 of 21 passes had a 90th percentile past it/.test(sess), "the session module says the rail has no timeline and counts the Tier 2 passes over the line: " + sess.slice(0, 600));
    ok(await page.evaluate(() => !!document.querySelector("#stSessionChart svg")) && await page.evaluate(() => !!document.querySelector("#stSession .ui-tbl-b")), "the Tier 2 chart is drawn and has its table");
    const stored = await text(page, "#stStored");
    ok(/live:market\s+worker@tier1 \(worker\)\s+21:40:47 TRT\s+20\.0 s\s+5\.0 s/.test(stored), "stored feeds with TRT read time, age and distance behind the vendor: " + stored.slice(0, 300));
    ok(/unstamped/.test(stored), "a row with no vendor stamp is unstamped");
    const timing = await text(page, "#stTiming");
    ok(/Retries 14, rate limited 2/.test(timing) && /Vendor calls counted 366/.test(timing) && /ask: mean 1\.2 s, longest 3\.1 s/.test(timing) && /Quote age p50 4\.0 s, p90 11\.0 s, largest 2 min/.test(timing), "engine timing: " + timing.slice(0, 700));
    const sock = await text(page, "#stSocket");
    ok(/Connection\s+connected/.test(sock) && /Channels\s+11 wanted, 11 joined, 10 acknowledged, 1 refused/.test(sock) && /Refused\s+gex:AMD \(refused\)/.test(sock) && /Messages\s+412,000, 83\.9 MiB/.test(sock), "socket facts: " + sock.slice(0, 500));
    const browserText = await text(page, "#stBrowser");
    ok(/Worker clock against this browser\s+\+\d+ ms/.test(browserText) || /Worker clock against this browser\s+\u2212?\d+ ms/.test(browserText), "the clock offset is an estimate in ms: " + browserText.slice(0, 300));
    eq(await page.evaluate(() => [...document.querySelectorAll("main h1, main h2")].filter((e) => e.offsetParent !== null).map((e) => e.tagName + e.textContent)),
      ["H1Status", "H2Feed latency now", "H2Through the session", "H2Stored feeds", "H2Engines' timing", "H2Socket upstream", "H2This browser"], "the Latency outline");
    eq(errors, [], "no page error");
    await page.close();
  }

  {
    const { page, asked, errors } = await open(browser, { view: "usage" });
    eq(uniq(asked), USAGE_ROUTES, "THE USAGE TAB reads six existing owner routes and no other");
    const meters = await text(page, "#stMeters");
    ok(/Vendor calls today, whole key\s+21,400 of 60,000 calls\s+·\s+36%/.test(meters), "the vendor meter against the advisory line: " + meters.slice(0, 400));
    ok(/Workers AI neurons\s+14,900 of 30,000 neurons today\s+·\s+50%/.test(meters) && /free allowance 10,000; readings stop at 22,500/.test(meters), "model neurons against the enforced cap, marked at the allowance and where readings stop");
    ok(/Workers AI calls\s+268 of 2,500 calls today\s+·\s+11%/.test(meters), "model calls against 2,500");
    ok(/Vendor calls, rail, last minute\s+26 of 240 calls a minute/.test(meters) && /per-minute header never decrements/.test(meters), "the rail's per-minute ceiling and the key's unmeasurable one");
    ok(/Not measured on the site: D1 counts rows per account/.test(meters) && /Durable Object requests/.test(meters), "the D1 and Durable Object meters say they are not measured");
    ok(/your target band 80 to 85%, not enforced/.test(meters), "the 80 to 85 band is labelled the owner's, not enforced");
    ok(/paid through 2026-10-29, renews 2026-10-30/.test(meters), "the plan period");
    const cons = await text(page, "#stConsumers");
    ok(/Nightly run\s+4,100\s+attempts including retries, session 2026-10-09/.test(cons), "the nightly's count and its basis: " + cons.slice(0, 500));
    ok(/Tier 1 \(Worker\)\s+366/.test(cons) && /Focus \(Worker\)\s+125/.test(cons) && /Tier 2 \(Actions\)\s+920/.test(cons), "the engines' own counts from the ledger");
    ok(/Everything else on the key\s+15,889/.test(cons), "the remainder is the vendor's count minus the engines' own (21,400 less 5,511)");
    ok(/The rail made 1,440 calls in the last hour/.test(cons), "and the rail's last hour is stated apart");
    const limits = await text(page, "#stLimits");
    ok(/UW_ONDEMAND\s+all members together\s+120\s+minute/.test(limits) && /Not enforced yet: a daily vendor line \(P1-30, F-26\) and a daily D1 line \(F-25, F-73\)/.test(limits), "what stops at each line, and what is not enforced: " + limits.slice(0, 300));
    const out = await text(page, "#stOutcomes");
    ok(/ask\s+47\s+46\s+40\s+0\s+6\s+0\s+1\s+13%\s+1\.2 s\s+3\.1 s/.test(out) && /will rise/.test(out) && /21:41:07 TRT/.test(out), "model outcomes by surface and the latest refusals in TRT: " + out.slice(0, 500));
    const plan = await text(page, "#stPlan");
    ok(/Vendor plan\s+unknown \(not recorded; the working line is advisory\)/.test(plan), "the plan is as recorded");
    eq(errors, [], "no page error");
    await page.close();
  }

  {
    const map = world();
    const bare = opsFor({ clock: { uw_daily: null, uw_daily_at: null }, ledgerRow: { t1_calls: null, focus_calls: null, uw_daily_max: null, uw_daily_at: null } });
    map["/api/flows/ops"] = { body: bare };
    map["/api/rt/status"] = { body: { running: false, calls: {}, sockets: {}, topics: { px: { demanded: false, calls: {}, lagMs: { n: 0, p50: null, p95: null, max: null }, fresh: { state: "pending" } }, fl: { demanded: true, calls: {}, itemLagMs: { n: 0, p50: null, p95: null, max: null }, fresh: { state: "pending" } } }, upstream: { kind: "rest" } } };
    const { page, errors } = await open(browser, { map });
    const tiles = await text(page, "#stTiles");
    ok(/PRICES[\s\S]*\u2014[\s\S]*rail idle: no one is watching/.test(tiles), "an idle rail is a dash with its reason, not a zero: " + tiles.replace(/\n/g, "|"));
    ok(/FLAGGED ALERTS[\s\S]*\u2014[\s\S]*rail idle/.test(tiles), "also for alerts");
    ok(/VENDOR CALLS TODAY[\s\S]*\u2014[\s\S]*no Tier 1 or focus tick has recorded the vendor's counter header yet/.test(tiles), "no vendor counter is a dash and says why: " + tiles.replace(/\n/g, "|"));
    const rail = await text(page, "#stRail");
    ok(/Rail\s+idle, no viewer/.test(rail) && /Vendor calls, this minute\s+\u2014 of \u2014/.test(rail), "absent counters are dashes, not 0 of 0");
    const eng = await text(page, "#stEng");
    ok(/Vendor calls counted/.test(eng) === false, "the short engine view omits the call counters");
    await page.click("#stTab-latency");
    await page.waitForFunction(() => /Rail idle/.test((document.getElementById("stFeeds") || {}).innerText || ""));
    const feeds = await text(page, "#stFeeds");
    ok(/Rail idle: no one is watching/.test(feeds) && /reset when the last viewer leaves/.test(feeds), "the idle rail sentence");
    await page.waitForFunction(() => /Vendor calls counted/.test(document.getElementById("stTiming").innerText));
    const timing = await text(page, "#stTiming");
    ok(/Vendor calls counted \u2014 \(column not yet written\)/.test(timing), "a ledger column not yet written is a dash and says so: " + timing.slice(0, 300));
    eq(errors, [], "no page error");
    await page.click("#stTab-usage");
    await page.waitForFunction(() => /Vendor calls today, whole key/.test(document.getElementById("stMeters").innerText));
    const meters = await text(page, "#stMeters");
    ok(/Vendor calls today, whole key[\s\S]*\u2014 of 60,000[\s\S]*no Tier 1 or focus tick has recorded/.test(meters), "the vendor meter is a dash with its reason: " + meters.slice(0, 300));
    const cons = await text(page, "#stConsumers");
    ok(/Everything else on the key\s+\u2014/.test(cons) && /the vendor's count was not read today/.test(cons), "the remainder is a dash when the count is unread");
    await page.close();
  }

  {
    const map = {};
    for (const p of Object.keys(world())) fail(map, p, 404, "rt_off");
    const { page, errors } = await open(browser, { map });
    const rail = await text(page, "#stRail");
    ok(/not read: HTTP 404 rt_off/.test(rail) && !/\b0\b/.test(rail), "a switched-off rail is a dash and its reason, with no zero");
    ok(/6 of 6 sources could not be read\./.test(await text(page, "#stNote")), "the status line counts the unread sources of the six asked");
    ok(/Readiness: \u2014 \(HTTP 404 rt_off\)/.test(await text(page, "#stReady")), "readiness says it was not read");
    for (const id of ["#stNight", "#stAi", "#stSw"]) ok(/was not read: HTTP 404 rt_off/.test(await text(page, id)), id + " says why");
    ok(/PRICES[\s\S]*the rail was not read: HTTP 404 rt_off/.test(await text(page, "#stTiles")), "and so do the tiles");
    eq(errors, [], "no page error with every source missing");
    await page.close();
  }

  {
    const map = world();
    map["/api/flows/meta"] = { body: { status: "pending" } };
    map["/api/flows/ai-usage"] = { body: { spend: null } };
    const { page } = await open(browser, { map });
    ok(/was not read: no run has been published yet/.test(await text(page, "#stNight")), "a pending nightly record says so");
    ok(/the store could not be read/.test(await text(page, "#stAi")), "an unreadable spend says so");
    await page.close();
  }

  {
    const map = world();
    map["/api/rt/status"] = { body: { ...RAIL, topics: { ...RAIL.topics, fl: { ...RAIL.topics.fl, lagMs: { n: 0, p50: null, p95: null, max: null } } } } };
    const { page } = await open(browser, { map });
    ok(/2\.3 s/.test(await text(page, "#stTileFl")), "an alert lag that lives only in itemLagMs is still printed");
    await page.close();
  }

  for (const view of ["health", "latency", "usage"]) {
    for (const width of [320, 390, 768, 1440]) {
      const { page } = await open(browser, { width, view });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 0, `no horizontal overflow on ${view} at ${width} px (${over})`);
      if (width === 390 || width === 1440) {
        const hit = await page.evaluate(() => [...document.querySelectorAll("#stTabs [role=tab], #stAgain")].every((b) => b.getBoundingClientRect().height >= 28));
        ok(hit, `${view}: the tabs and the button have a usable height at ${width} px`);
      }
      if (AXE && width === 1440) {
        await page.evaluate(AXE);
        const n = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] }, resultTypes: ["violations"] })).violations.reduce((t, v) => t + v.nodes.length, 0));
        eq(n, 0, `${view}: axe finds no colour-contrast violation`);
      }
      await page.close();
    }
  }

  {
    const { page, asked } = await open(browser, { view: "latency", pause: true });
    const count = (p) => asked.filter((a) => a === p).length;
    const start = { rail: count("/api/rt/status"), ops: count("/api/flows/ops"), series: count("/api/flows/lk?k=strips:series"), ai: count("/api/flows/ops?part=ai") };
    eq([start.rail, start.ops, start.series, start.ai], [1, 1, 1, 1], "each Latency read is made once at load");
    await page.clock.runFor(11000);
    eq(count("/api/rt/status") - start.rail, 1, "THE RAIL IS READ EVERY 10 s on the Latency tab");
    eq(count("/api/flows/ops") - start.ops, 0, "and the ops view not yet");
    await page.clock.runFor(50000);
    eq(count("/api/flows/ops") - start.ops, 1, "the ops view every 60 s");
    eq(count("/api/flows/lk?k=heartbeat"), 2, "and the heartbeat");
    eq(count("/api/flows/lk?k=strips:series") - start.series, 0, "the series not before five minutes");
    await page.clock.runFor(250000);
    eq(count("/api/flows/lk?k=strips:series") - start.series, 1, "the Tier 2 series every 5 minutes");
    eq(count("/api/flows/ops?part=ai"), 1, "the outcome block is read once, not on a timer");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    const before = asked.length;
    await page.clock.runFor(180000);
    eq(asked.length - before, 0, "NO READ AND NO TIMER WHILE THE TAB IS HIDDEN");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.clock.runFor(100);
    ok(asked.length - before >= 5, "it resumes with one immediate read of what the tab shows");
    await page.close();
  }

  {
    const { page, asked } = await open(browser, { view: "health", pause: true });
    const n0 = asked.length;
    await page.clock.runFor(20000);
    eq(asked.length - n0, 0, "THE HEALTH TAB READS NOTHING INSIDE 30 s");
    await page.clock.runFor(11000);
    eq(asked.filter((a) => a === "/api/rt/status").length, 2, "and the rail at 30 s");
    await page.close();
  }

  {
    const { page } = await open(browser, { pause: true });
    await page.evaluate(() => {
      const real = window.fetch;
      window.__rail = 0;
      window.fetch = (u, o) => {
        if (String(u).includes("/api/rt/status")) {
          window.__rail++;
          return Promise.resolve(new Response('{"error":{"code":"rt_unavailable","message":"x"}}', { status: 503, headers: { "Content-Type": "application/json" } }));
        }
        return real(u, o);
      };
    });
    await page.click("#stAgain");
    await page.waitForFunction(() => !document.getElementById("stAgain").disabled);
    const rail = () => page.evaluate(() => window.__rail);
    const hits = await rail();
    eq(hits, 1, "the failing read was made once");
    await page.clock.runFor(31000);
    eq((await rail()) - hits, 0, "AFTER AN ERROR THE INTERVAL DOUBLES: no read at the usual 30 s");
    await page.clock.runFor(31000);
    ok((await rail()) - hits >= 1, "and the read comes at 60 s");
    ok(/HTTP 503 rt_unavailable/.test(await text(page, "#stRail")), "with the reason shown");
    await page.close();
  }

  {
    const mutants = [
      ["flagged alerts read the frame lag", (t, f) => (f === "flows-status.js" ? t.replace("const series = EVENT[k] ? t && t.itemLagMs : t && t.lagMs;", "const series = t && t.lagMs;") : t)],
      ["spend measured against the free allowance", (t, f) => (f === "flows-status.js" ? t.replace('whole(s.neurons) + " of " + whole(cap.neurons) + " (site cap)"', 'whole(s.neurons) + " of " + whole(s.allowanceNeurons) + " free a day"') : t)],
      ["the time zone is Eastern", (t, f) => (f === "flows-status.js" ? t.replace('+ ":" + pad(t.getUTCSeconds()) + " TRT"', '+ ":" + pad(t.getUTCSeconds()) + " ET"') : t)],
      ["the source count is fixed at three", (t, f) => (f === "flows-status.js" ? t.replace('"All " + total + " sources read."', '"All three sources read."') : t)],
    ];
    for (const [name, mutate] of mutants) {
      const { page, asked } = await open(browser, { mutate });
      let problems = [];
      try { problems = await core(page, asked); } catch (e) { problems = [String(e)]; }
      ok(problems.length > 0, "PLANTED WRONG BUILD, " + name + ", fails the core readings");
      await page.close();
    }
    const nulls = world();
    nulls["/api/rt/status"] = { body: { running: true, calls: {}, sockets: {}, topics: {}, upstream: {} } };
    const { page } = await open(browser, { map: nulls, mutate: (t, f) => (f === "flows-status.js" ? t.replace("const whole = (v) => (num(v) === null ? DASH :", 'const whole = (v) => (num(v) === null ? "0" :') : t) });
    ok(/Vendor calls, this minute\s+0 of 0/.test(await text(page, "#stRail")), "the zero-printing mutant shows the 0 of 0 the clean build never shows");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-status-render: ${checks} checks passed`);
