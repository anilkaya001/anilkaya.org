import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { ROOT, NOW, RAIL, world, serve, opsFor } from "./lib/status-world.mjs";
import { COVERAGE_KEYS } from "../server/ops.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const require = createRequire(import.meta.url);
let AXE = null;
try { AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); } catch { AXE = null; }

const ROUTES = {
  health: ["/api/flows/ai-usage", "/api/flows/lk?k=heartbeat", "/api/flows/meta", "/api/flows/ops", "/api/flows/ready", "/api/rt/status"],
  capacity: ["/api/flows/ai-usage", "/api/flows/meta", "/api/flows/ops", "/api/flows/ops?part=ai", "/api/flows/ready", "/api/rt/status"],
  latency: ["/api/flows/lk?k=heartbeat", "/api/flows/lk?k=strips:series", "/api/flows/meta", "/api/flows/ops", "/api/flows/ops?part=ai", "/api/flows/ready", "/api/rt/status"],
  coverage: ["/api/flows/meta", "/api/flows/ops", "/api/flows/ops?part=coverage", "/api/flows/ready", "/api/rt/status"],
};
const READY_ASOF = { health: "#hEngAsof", capacity: "#cVendorAsof", latency: "#lFeedsAsof", coverage: "#kStoreAsof" };
const ALLOWED = /^\/api\/(rt\/status|flows\/(ops|lk|meta|ready|ai-usage))/;
const VIEWPORTS = [[1440, 820], [1024, 768], [390, 844]];
const SHOWN = { health: ["hEng", "hRail", "hNight", "hSw"], capacity: ["cVendor", "cAi", "cPlat", "cLimits"], latency: ["lFeeds", "stSession", "lStored", "lTime"], coverage: ["kStore", "kNight"] };

async function open(browser, { width = 1440, height = 820, view = "health", map = world(), serveOpts = {}, mutate = null, pause = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const asked = [];
  const errors = [];
  await serve(page, map, { asked, errors, ...serveOpts });
  if (mutate) {
    await page.route(/\/assets\/(js|css)\/flows-status[\w-]*\.(js|css)/, async (route) => {
      const u = new URL(route.request().url());
      const text = fs.readFileSync(path.join(ROOT, u.pathname), "utf8");
      const next = mutate(text, path.basename(u.pathname));
      return route.fulfill({ contentType: u.pathname.endsWith(".css") ? "text/css" : "text/javascript", body: next });
    });
  }
  await page.clock.install({ time: new Date(NOW) });
  await page.goto("https://example.test/flows/status/" + (view === "health" ? "" : "#view=" + view));
  await page.waitForFunction(() => !document.getElementById("stAgain").disabled);
  await page.waitForFunction((sel) => /read \d\d:\d\d:\d\d/.test((document.querySelector(sel) || {}).textContent || ""), READY_ASOF[view]);
  if (pause) await page.clock.pauseAt(new Date(NOW + 5000));
  return { page, asked, errors };
}

const text = (page, sel) => page.evaluate((s) => document.querySelector(s).innerText, sel);
const uniq = (list) => [...new Set(list)].sort();
const fail = (map, p, status, code) => { map[p] = { status, body: { error: { code, message: code } } }; };

async function screen(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const main = document.querySelector(".flows-main");
    const cards = [...document.querySelectorAll(".st-panel:not([hidden]) .st-card")].filter((c) => c.offsetParent !== null);
    return {
      doc: de.scrollHeight - de.clientHeight,
      across: de.scrollWidth - de.clientWidth,
      main: main.scrollHeight - main.clientHeight,
      mainWide: main.scrollWidth - main.clientWidth,
      clipped: cards.filter((c) => { const b = c.querySelector(".st-cb"); return b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1; }).map((c) => c.id),
      visible: cards.map((c) => c.id),
      h1: document.querySelectorAll("h1").length,
    };
  });
}

async function core(page, asked) {
  const problems = [];
  const expect = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
  const rail = await text(page, "#hRail");
  const eng = await text(page, "#hEng");
  const meta = await text(page, "#stMeta");
  const note = await text(page, "#stNote");
  const tiles = await text(page, "#stTiles");
  const all = await text(page, "body");
  expect(/Flagged alerts\s+2\.3 s\s+7\.4 s/.test(rail), "the flagged-alert row prints the item lag 2.3 s and 7.4 s: " + rail.slice(0, 300));
  expect(/Landed 03:30 TRT/.test(eng) && /Last tick 21:40 TRT/.test(eng), "engine times are TRT: " + eng.slice(0, 300));
  expect(/Read at 21:41:07 TRT/.test(meta), "the read time is 21:41:07 TRT: " + meta);
  expect(!/\b(UTC|EDT|EST|GMT)\b|\bET\b/.test(all), "no other time zone is named");
  expect(new RegExp("All " + uniq(asked).length + " sources read\\.").test(note), "the source count is the number of routes asked (" + uniq(asked).length + "): " + note);
  expect(/14,900 of 30,000/.test(tiles), "the neuron tile is measured against the enforced cap: " + tiles.slice(0, 300));
  expect(!/Vendor calls\s+\d+ of 0\b/.test(rail), "an absent figure is never a zero");
  return problems;
}

const browser = await chromium.launch();
try {
  for (const view of Object.keys(ROUTES)) {
    const { page, asked, errors } = await open(browser, { view });
    eq(uniq(asked), ROUTES[view], "THE " + view.toUpperCase() + " TAB reads its existing owner routes and no other");
    ok(asked.every((p) => ALLOWED.test(p)), view + ": none of them is a vendor or a model route");
    eq(errors, [], view + ": no page error");
    await page.close();
  }

  for (const [width, height] of VIEWPORTS) {
    for (const view of Object.keys(ROUTES)) {
      const { page } = await open(browser, { width, height, view });
      const s = await screen(page);
      const tag = `${view} at ${width}x${height}`;
      eq([s.doc, s.main], [0, 0], "NO PAGE SCROLL on " + tag);
      ok(s.across <= 0 && s.mainWide <= 0, "no horizontal scroll on " + tag);
      eq(s.clipped, [], "no card clips its own content on " + tag);
      eq(s.h1, 1, "one h1 on " + tag);
      if (width > 640) eq(s.visible, SHOWN[view].map((id) => (id === "stSession" ? "lSessionCard" : id + "Card")), "every card of the tab is on the screen at once on " + tag);
      else eq(s.visible.length, 1, "the phone shows one full-height card at a time on " + tag);
      await page.close();
    }
  }

  {
    const { page } = await open(browser);
    const s = await screen(page);
    eq(s.visible, ["hEngCard", "hRailCard", "hNightCard", "hSwCard"], "Health is four cards");
    const eng = await text(page, "#hEng");
    ok(/Nightly\s+failures\s+Landed 03:30 TRT, 18\.2 h ago/.test(eng), "the nightly state and its landing in TRT: " + eng.slice(0, 300));
    ok(/Tier 1\s+writing\s+Last tick 21:40 TRT, 1 min ago/.test(eng), "Tier 1");
    ok(/Tier 2\s+passing\s+Last pass finished 21:37 TRT/.test(eng), "Tier 2");
    const rail = await text(page, "#hRail");
    ok(/Running · upstream composite · sockets 3 of 40 · vendor calls 26 of 240 this minute/.test(rail), "rail summary: " + rail.slice(0, 300));
    ok(/Prices\s+1\.8 s\s+4\.9 s\s+live/.test(rail) && /Flagged alerts\s+2\.3 s\s+7\.4 s/.test(rail), "rail topics with p50, p95 and state");
    const night = await text(page, "#hNight");
    ok(/Written 03:30 TRT \(18\.2 h ago\) · session 2026-10-09/.test(night) && /670 names · cards 500 built, 2 failed, 8 skipped/.test(night), "nightly summary: " + night.slice(0, 300));
    ok(/universe\s+4\.2 s\s+ok/.test(night), "slowest stages first");
    const sw = await text(page, "#hSw");
    ok(/5 of 14 switches are on/.test(sw) && /Read-only/.test(sw) && /FLOWS_RT_UPSTREAM\s+socket/.test(sw), "switches are read-only and list those not on");
    ok(/vendor calls 21,400|21,400/.test(await text(page, "#stTiles")) && /14,900 of 30,000/.test(await text(page, "#stTiles")), "the tiles carry the vendor and model figures");
    for (const id of ["hEng", "hRail", "hNight", "hSw"]) ok(/read 21:41:07 TRT/.test(await text(page, "#" + id + "Asof")), id + " states when it was read, in TRT");
    ok(/Readiness: Ready\. US session open\./.test(await text(page, "#stReady")), "the readiness line");
    ok(await page.evaluate(() => document.getElementById("stWhy").hidden), "no blockers, no blockers button");
    await page.close();
  }

  {
    const { page } = await open(browser);
    const btn = page.locator("#hRailCard .st-more");
    await btn.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.getElementById("hRailDlg").open);
    const dlg = await text(page, "#hRailDlg");
    ok(/Vendor key counter\s+21,400 calls today, read 21:41:03 TRT/.test(dlg), "the rail detail keeps the vendor counter with its TRT time: " + dlg.slice(0, 400));
    ok(/Upstream\s+composite, socket connected/.test(dlg) && /Started\s+18:41 TRT/.test(dlg), "and the socket upstream and the start in TRT");
    ok(/px\s+socket/.test(dlg) && /mk\s+rest/.test(dlg) && /behind the item's own time/.test(dlg), "each topic names its transport and what its lag is measured against");
    ok(await page.evaluate(() => document.getElementById("hRailDlg").querySelector("[data-close]") !== null), "the dialog has its own close control");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("hRailDlg").open);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.closest("#hRailCard") !== null), "closing returns focus to the card's button");
    await page.click("#hEngCard .st-more");
    await page.waitForFunction(() => document.getElementById("hEngDlg").open);
    const eng = await text(page, "#hEngDlg");
    ok(/GitHub refused the Worker's dispatch \(refused:403\), an owner action/.test(eng) && /Retries 14, rate limited 2/.test(await text(page, "#hEngDlg")) === false, "the dispatch refusal is in the engine detail, the call statistics belong to Latency: " + eng.slice(0, 200));
    await page.click("#hEngDlg [data-close]");
    await page.click("#hSwCard .st-more");
    await page.waitForFunction(() => document.getElementById("hSwDlg").open);
    const sw = await text(page, "#hSwDlg");
    ok(/FLOWS_RT_MODE\s+on/.test(sw) && /FLOWS_SCENES\s+unset/.test(sw) && /set in wrangler\.toml/.test(sw), "every switch with its value and where it is set");
    await page.keyboard.press("Escape");
    await page.click("#hNightCard .st-more");
    await page.waitForFunction(() => document.getElementById("hNightDlg").open);
    const night = await text(page, "#hNightDlg");
    ok(/roster\s+failed\s+900 ms\s+3\s+0\s+vendor 5xx/.test(night), "the full stage ledger keeps every stage with its reason: " + night.slice(0, 400));
    await page.close();
  }

  {
    const { page } = await open(browser, { view: "capacity" });
    const cv = await text(page, "#cVendor");
    ok(/Whole key today\s+21,400 of 60,000 calls · 36%/.test(cv) && /Rail, this minute\s+26 of 240 calls · 11%/.test(cv), "vendor calls against the advisory day line and the rail's minute: " + cv.slice(0, 400));
    ok(/Cap: 60,000 per day/.test(cv), "the cap line carries its plan and source");
    const ai = await text(page, "#cAi");
    ok(/Neurons today\s+14,900 of 30,000 neurons · 50%/.test(ai) && /Calls today\s+268 of 2,500 calls · 11%/.test(ai), "model use against the enforced cap, not the free allowance: " + ai.slice(0, 400));
    ok(/Beyond the free allowance: 4,900 neurons, about \$0\.054/.test(ai) && /readings stop at 22,500/.test(ai), "the allowance excess in dollars and where readings stop");
    ok(/Wording refusals today: 24 of 188 calls/.test(ai), "the day's wording refusals from the outcome block");
    const plat = await text(page, "#cPlat");
    ok(/D1 rows read\s+25,000,000,000 per month\s+\u2014/.test(plat) && /Cloudflare reports none to the Worker/.test(plat), "D1 shows its allowance and a dash for use with the reason: " + plat.slice(0, 400));
    ok(/Tier 1 180 ok, 3 failed/.test(plat) && /Tier 2 21 passes/.test(plat), "cron ticks come from the ledger");
    const lim = await text(page, "#cLimits");
    ok(/UW_ONDEMAND\s+120 \/ min\s+all members together/.test(lim), "limits enforced: " + lim.slice(0, 300));
    await page.click("#cAiCard .st-more");
    await page.waitForFunction(() => document.getElementById("cAiDlg").open);
    const dlg = await text(page, "#cAiDlg");
    ok(/14,900 of 30,000 \(site cap\)/.test(dlg) && /15,100 neurons/.test(dlg) && !/10,000 free a day/.test(dlg), "the model detail: " + dlg.slice(0, 300));
    ok(/ask\s+47\s+46\s+40\s+0\s+6\s+0\s+1\s+13%\s+1\.2 s\s+3\.1 s/.test(dlg) && /will rise/.test(dlg), "outcomes by surface and the latest refusals");
    await page.keyboard.press("Escape");
    await page.click("#cVendorCard .st-more");
    await page.waitForFunction(() => document.getElementById("cVendorDlg").open);
    const cons = await text(page, "#cVendorDlg");
    ok(/Nightly run\s+4,100/.test(cons) && /Tier 1 \(Worker\)\s+366/.test(cons) && /Everything else on the key\s+15,889/.test(cons), "vendor calls by consumer, the remainder worked from the vendor's count: " + cons.slice(0, 500));
    await page.keyboard.press("Escape");
    await page.click("#cPlatCard .st-more");
    await page.waitForFunction(() => document.getElementById("cPlatDlg").open);
    const m = await text(page, "#cPlatDlg");
    ok(/Not measured on the site: D1 counts rows per account/.test(m) && /Durable Object requests/.test(m) && /paid through 2026-10-29/.test(m), "platform detail: " + m.slice(0, 200));
    await page.close();
  }

  {
    const { page } = await open(browser, { view: "latency" });
    const feeds = await text(page, "#lFeeds");
    ok(/Prices\s+1\.8 s\s+4\.9 s\s+15\.0 s\s+live/.test(feeds) && /Flagged alerts\s+2\.3 s\s+7\.4 s/.test(feeds), "feed latency, alerts read the item lag: " + feeds.slice(0, 300));
    ok(/Behind the vendor's stamp; alerts and news behind the item's own time\./.test(feeds), "and what each is measured against");
    const stored = await text(page, "#lStored");
    ok(/All 11 keys are inside their lines|keys are stale or missing/.test(stored) && /live:heartbeat/.test(stored), "stored feeds, worst first: " + stored.slice(0, 300));
    const timing = await text(page, "#lTime");
    ok(/Tier 2 pass\s+Took 1 min, 44 calls, 1 failed/.test(timing) && /Vendor socket\s+connected, 412,000 messages/.test(timing), "timing summary: " + timing.slice(0, 300));
    ok(/Worker clock vs browser\s+[+\u2212]\d+ ms/.test(timing), "the clock offset is an estimate in ms");
    ok(await page.evaluate(() => !!document.querySelector("#stSession svg")), "the Tier 2 chart is drawn");
    ok(/passes had p90 past it/.test(await text(page, "#stSession")) && /not recorded/.test(await text(page, "#stSession")), "the chart says what it shows and what is not recorded: " + (await text(page, "#stSession")).slice(0, 300));
    await page.click("#lFeedsCard .st-more");
    await page.waitForFunction(() => document.getElementById("lFeedsDlg").open);
    const d = await text(page, "#lFeedsDlg");
    ok(/Prices[\s\S]*p50 1\.8 s · p95 4\.9 s · 256 samples/.test(d) && /Live share of watched time\s+96% of 3\.0 h/.test(d) && /No option-prints feed on the rail \(F-94, F-116\)/.test(d), "per-topic detail: " + d.slice(0, 300));
    ok(await page.evaluate(() => document.querySelectorAll("#stFeeds svg.lt-bar").length === 5), "five range bars in the detail");
    await page.keyboard.press("Escape");
    await page.click("#stSession").catch(() => {});
    await page.click("#lSessionCard .st-more");
    await page.waitForFunction(() => document.getElementById("lSessionDlg").open);
    ok(/Quote age, every pass/.test(await text(page, "#lSessionDlg")) && /16:31/.test(await text(page, "#lSessionDlg")), "the chart's numbers are in a table");
    await page.keyboard.press("Escape");
    await page.click("#lTimeCard .st-more");
    await page.waitForFunction(() => document.getElementById("lTimeDlg").open);
    const t = await text(page, "#lTimeDlg");
    ok(/Retries 14, rate limited 2/.test(t) && /Channels\s+11 wanted, 11 joined, 10 acknowledged, 1 refused/.test(t) && /Messages\s+412,000, 83\.9 MiB/.test(t), "timing detail: " + t.slice(0, 300));
    await page.close();
  }

  {
    const { page } = await open(browser, { view: "coverage" });
    const st = await text(page, "#kStore");
    ok(new RegExp("9 of " + COVERAGE_KEYS.length + " expected keys present · 371\\.3 KiB stored · 1 behind the nightly session 2026-10-09").test(st), "payload store headline: " + st.slice(0, 300));
    ok(/universe\s+98\.3 KiB\s+98%\s+19:51 TRT/.test(st), "the largest key against the 100 KiB budget, written time in TRT");
    ok(/Missing: board:watch/.test(st), "the missing keys are named");
    const nc = await text(page, "#kNight");
    ok(/Names in the universe\s+670/.test(nc) && /Cards built\s+500 \(75% of the universe\)/.test(nc) && /Health gate\s+1 failures, 2 warnings/.test(nc), "nightly coverage: " + nc.slice(0, 400));
    await page.click("#kStoreCard .st-more");
    await page.waitForFunction(() => document.getElementById("kStoreDlg").open);
    const all = await text(page, "#kStoreDlg");
    ok(new RegExp("political\\s+behind 2026-10-09").test(all), "a key a session behind is marked behind: " + all.slice(0, 600));
    ok(/unusual\s+no session stamp/.test(all) && /board:watch\s+no row\s+\u2014\s+\u2014/.test(all), "an unstamped key and a missing key are not shown as fresh or as zero bytes");
    ok(/counting them scans the table/.test(all), "the footnote says why no card rows are counted");
    await page.close();
  }

  {
    const map = world();
    map["/api/flows/ops?part=coverage"] = { body: opsFor({}, { part: "coverage" }) };
    map["/api/flows/ops?part=coverage"].body.coverage = null;
    map["/api/flows/ops?part=coverage"].body.why = "store";
    const { page } = await open(browser, { view: "coverage", map });
    ok(/was not read: the store could not be read/.test(await text(page, "#kStore")), "an unreadable store is a dash with the reason, never an empty table");
    await page.close();
    const map2 = world();
    fail(map2, "/api/flows/ops?part=coverage", 404, "ops_off");
    const b = await open(browser, { view: "coverage", map: map2 });
    ok(/HTTP 404 ops_off/.test(await text(b.page, "#kStore")), "a switched-off ops route says so");
    await b.page.close();
  }

  {
    const { page } = await open(browser, { width: 390, height: 844, view: "capacity" });
    eq(await page.evaluate(() => [...document.querySelectorAll("#stSub [role=tab]")].map((b) => b.textContent)), ["Vendor", "Model", "Platform", "Limits"], "the phone's switch names the four cards");
    eq((await screen(page)).visible, ["cVendorCard"], "the first card shows");
    await page.locator("#stSub [role=tab]").nth(1).click();
    await page.waitForFunction(() => document.getElementById("cAiCard").classList.contains("is-on"));
    eq((await screen(page)).visible, ["cAiCard"], "the switch shows the second card full height");
    eq(await page.evaluate(() => document.querySelector("#stSub [role=tab][aria-selected=true]").getAttribute("aria-controls")), "cAiCard", "and points at it");
    const s = await screen(page);
    eq([s.doc, s.clipped], [0, []], "with no scroll and no clipping");
    await page.locator("#stTabs [role=tab]").nth(2).click();
    await page.waitForFunction(() => !document.getElementById("stPanel-latency").hidden);
    await page.locator("#stSub [role=tab]").nth(1).click();
    await page.waitForFunction(() => document.getElementById("lSessionCard").classList.contains("is-on"));
    await page.waitForFunction(() => document.querySelector("#stSession svg") !== null);
    const w = await page.evaluate(() => document.querySelector("#stSession svg").getBoundingClientRect().width);
    ok(w > 150, "a chart on a card that was hidden when it first drew is drawn at the card's width (" + w + ")");
    await page.close();
  }

  {
    const map = world();
    map["/api/flows/ready"] = { body: { ok: false, phase: "pre", minutesToOpen: 38, opens: { ms: Date.parse("2026-10-12T13:30:00Z") }, blockers: [{ code: "nightly", sentence: "The nightly has not landed for 2026-10-09." }, { code: "tier1", sentence: "Tier 1 has not ticked in 11 minutes." }] } };
    const { page } = await open(browser, { map });
    const line = await text(page, "#stReady");
    ok(/2 blockers/.test(line) && /US open/.test(line) && /TRT/.test(line), "the readiness line counts the blockers: " + line);
    ok(await page.evaluate(() => !document.getElementById("stWhy").hidden), "and offers them");
    await page.click("#stWhy");
    await page.waitForFunction(() => document.getElementById("stReadyDlg").open);
    ok(/Tier 1 has not ticked in 11 minutes\./.test(await text(page, "#stReadyBody")), "each blocker's sentence is in the dialog");
    eq((await screen(page)).doc, 0, "a long list of blockers never makes the page scroll");
    await page.close();
  }

  {
    const map = world();
    const bare = opsFor({ clock: { uw_daily: null, uw_daily_at: null }, ledgerRow: { t1_calls: null, focus_calls: null, uw_daily_max: null, uw_daily_at: null } });
    map["/api/flows/ops"] = { body: bare };
    map["/api/rt/status"] = { body: { running: false, calls: {}, sockets: {}, topics: { px: { demanded: false, calls: {}, lagMs: { n: 0, p50: null, p95: null, max: null }, fresh: { state: "pending" } }, fl: { demanded: true, calls: {}, itemLagMs: { n: 0, p50: null, p95: null, max: null }, fresh: { state: "pending" } } }, upstream: {} } };
    const { page, errors } = await open(browser, { map });
    const tiles = await text(page, "#stTiles");
    ok(/PRICES[\s\S]*\u2014[\s\S]*rail idle: no one is watching/.test(tiles), "an idle rail is a dash with its reason, not a zero: " + tiles.replace(/\n/g, "|"));
    ok(/VENDOR CALLS TODAY[\s\S]*\u2014[\s\S]*no Tier 1 or focus tick has recorded the vendor's counter header yet/.test(tiles), "no vendor counter is a dash and says why");
    const rail = await text(page, "#hRail");
    ok(/Idle, no viewer/.test(rail) && /vendor calls \u2014 of \u2014 this minute/.test(rail), "absent counters are dashes, not 0 of 0: " + rail.slice(0, 200));
    ok(/An idle rail polls nothing/.test(rail), "and the idle rail says why there are no figures");
    await page.locator("#stTabs [role=tab]").nth(1).click();
    await page.waitForFunction(() => /Whole key today/.test(document.getElementById("cVendor").innerText));
    const cv = await text(page, "#cVendor");
    ok(/Whole key today\s+\u2014 of 60,000/.test(cv) && /no Tier 1 or focus tick has recorded/.test(cv), "the vendor bar is a dash with its reason: " + cv.slice(0, 300));
    eq(errors, [], "no page error");
    await page.close();
  }

  {
    const map = {};
    for (const p of Object.keys(world())) fail(map, p, 404, "rt_off");
    const { page, errors } = await open(browser, { map });
    const rail = await text(page, "#hRail");
    ok(/not read: HTTP 404 rt_off/.test(rail) && !/\b0\b/.test(rail), "a switched-off rail is a dash and its reason, with no zero");
    ok(/6 of 6 sources could not be read\./.test(await text(page, "#stNote")), "the status line counts the unread sources of the six asked");
    ok(/Readiness: \u2014 \(HTTP 404 rt_off\)/.test(await text(page, "#stReady")), "readiness says it was not read");
    for (const id of ["#hEng", "#hNight", "#hSw"]) ok(/was not read|were all unavailable/.test(await text(page, id)), id + " says it was not read");
    ok(/PRICES[\s\S]*the rail was not read: HTTP 404 rt_off/.test(await text(page, "#stTiles")), "and so do the tiles");
    eq(errors, [], "no page error with every source missing");
    eq((await screen(page)).doc, 0, "and the page still fits");
    await page.close();
  }

  {
    const map = world();
    map["/api/flows/meta"] = { body: { status: "pending" } };
    const { page } = await open(browser, { map });
    ok(/was not read: no run has been published yet/.test(await text(page, "#hNight")), "a pending nightly record says so");
    await page.close();
  }

  {
    const { page } = await open(browser);
    await page.focus("#stTab-health");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.location.hash === "#view=capacity");
    ok(await page.evaluate(() => !document.getElementById("stPanel-capacity").hidden && document.getElementById("stPanel-health").hidden), "the arrow key opens Capacity and the hash follows it");
    await page.keyboard.press("End");
    await page.waitForFunction(() => window.location.hash === "#view=coverage");
    await page.keyboard.press("Home");
    await page.waitForFunction(() => window.location.hash === "#view=health");
    await page.evaluate(() => { window.location.hash = "#view=usage"; });
    await page.waitForFunction(() => !document.getElementById("stPanel-capacity").hidden);
    ok(await page.evaluate(() => document.getElementById("stTab-capacity").getAttribute("aria-selected") === "true"), "the old usage hash lands on Capacity");
    eq(await page.evaluate(() => [...document.querySelectorAll("#stTabs [role=tab]")].map((b) => [b.id, b.getAttribute("aria-controls")])),
      [["stTab-health", "stPanel-health"], ["stTab-capacity", "stPanel-capacity"], ["stTab-latency", "stPanel-latency"], ["stTab-coverage", "stPanel-coverage"]], "four tabs wired to their panels");
    await page.evaluate(() => { window.location.hash = "#view=latency"; });
    await page.waitForFunction(() => document.querySelector("#railOps").nextElementSibling.querySelector('a[aria-current="page"]').textContent.includes("Latency"));
    await page.close();
  }

  for (const view of Object.keys(ROUTES)) {
    for (const width of [320, 390, 768, 1440]) {
      const { page } = await open(browser, { width, height: width === 1440 ? 820 : 800, view });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 0, `no horizontal overflow on ${view} at ${width} px (${over})`);
      const hit = await page.evaluate(() => [...document.querySelectorAll("#stTabs [role=tab], #stAgain, .st-panel:not([hidden]) .st-more")].filter((b) => b.offsetParent !== null).every((b) => b.getBoundingClientRect().height >= 26));
      ok(hit, `${view}: the tabs and buttons have a usable height at ${width} px`);
      if (AXE && width === 1440) {
        await page.evaluate(AXE);
        const n = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast", "button-name", "aria-valid-attr-value", "aria-required-children"] }, resultTypes: ["violations"] })).violations.reduce((t, v) => t + v.nodes.length, 0));
        eq(n, 0, `${view}: axe finds no contrast, name or aria violation`);
      }
      await page.close();
    }
  }

  {
    const css = fs.readFileSync(path.join(ROOT, "assets/css/flows-status.css"), "utf8");
    ok(/@media \(pointer: coarse\) \{[^}]*\.st-more[^}]*min-height: 44px/.test(css), "coarse pointers get 44 px targets on the Details and Close buttons");
    ok(/prefers-reduced-motion|animation/.test(css) === false, "the page carries no animation of its own");
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
    const { page, asked } = await open(browser, { view: "coverage", pause: true });
    const count = (p) => asked.filter((a) => a === p).length;
    eq(count("/api/flows/ops?part=coverage"), 1, "coverage is read once at load");
    await page.clock.runFor(200000);
    eq(count("/api/flows/ops?part=coverage"), 1, "and not inside five minutes");
    await page.clock.runFor(110000);
    eq(count("/api/flows/ops?part=coverage"), 2, "and again at five minutes: a read of about forty-eight rows");
    await page.close();
  }

  {
    const { page, asked } = await open(browser, { view: "health", pause: true });
    const n0 = asked.length;
    await page.clock.runFor(20000);
    eq(asked.length - n0, 0, "THE HEALTH TAB READS NOTHING INSIDE 30 s");
    await page.clock.runFor(11000);
    eq(asked.filter((a) => a === "/api/rt/status").length, 2, "and the rail at 30 s");
    ok(!asked.includes("/api/flows/ops?part=coverage") && !asked.includes("/api/flows/ops?part=ai"), "the heavier ops parts are not read on Health");
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
    ok(/HTTP 503 rt_unavailable/.test(await text(page, "#hRail")), "with the reason shown");
    await page.close();
  }

  {
    const screenMutants = [
      ["the fit never trims a card", (t, f) => (f === "flows-status.js" ? t.replace("    fitAll();\n  }", "  }") : t), 1024, 768, "health"],
      ["the trimmed rows leave no note", (t, f) => (f === "flows-status.js" ? t.replace('note.textContent = hid ? "+" + hid + " more " + what + " in Details" : "";', 'note.textContent = "";') : t), 1440, 820, "health"],
    ];
    for (const [name, mutate, width, height, view] of screenMutants) {
      const { page } = await open(browser, { mutate, width, height, view });
      const s = await screen(page);
      const note = await page.evaluate(() => [...document.querySelectorAll(".st-mt tr[hidden]")].length > 0 && ![...document.querySelectorAll(".st-rest")].some((n) => !n.hidden && /more/.test(n.textContent)));
      ok(s.clipped.length > 0 || note, "PLANTED WRONG BUILD, " + name + ", is caught by the screen checks");
      await page.close();
    }
    const mutants = [
      ["flagged alerts read the frame lag", (t, f) => (f === "flows-status.js" ? t.replace("const series = EVENT[k] ? t && t.itemLagMs : t && t.lagMs;", "const series = t && t.lagMs;") : t)],
      ["the time zone is Eastern", (t, f) => (f === "flows-status.js" ? t.replace('+ ":" + pad(t.getUTCSeconds()) + " TRT"', '+ ":" + pad(t.getUTCSeconds()) + " ET"') : t)],
      ["the source count is fixed at three", (t, f) => (f === "flows-status.js" ? t.replace('"All " + total + " sources read."', '"All three sources read."') : t)],
      ["the neuron tile measures against the free allowance", (t, f) => (f === "flows-status.js" ? t.replace('whole(spend.neurons) + " of " + whole(cap.neurons)', 'whole(spend.neurons) + " of " + whole(spend.allowanceNeurons)') : t)],
    ];
    for (const [name, mutate] of mutants) {
      const { page, asked } = await open(browser, { mutate });
      let problems = [];
      try { problems = await core(page, asked); } catch (e) { problems = [String(e)]; }
      ok(problems.length > 0, "PLANTED WRONG BUILD, " + name + ", fails the core readings");
      await page.close();
    }
    const capMutants = [
      ["the model bar measures against the free allowance", (t, f) => (f === "flows-status-capacity.js" ? t.replace('bar("Neurons today", neurons, cap ? cap.neurons : null', 'bar("Neurons today", neurons, cap ? cap.allowanceNeurons : null') : t), /Neurons today\s+14,900 of 30,000 neurons · 50%/],
    ];
    for (const [name, mutate, want] of capMutants) {
      const { page } = await open(browser, { mutate, view: "capacity" });
      ok(!want.test(await text(page, "#cAi")), "PLANTED WRONG BUILD, " + name + ", fails the capacity reading");
      await page.close();
    }
    const covMutants = [
      ["a missing key prints as zero bytes", (t, f) => (f === "flows-status-coverage.js" ? t.replace('k.present ? bytes(k.bytes) : DASH', 'bytes(k.bytes || 0)') : t), /board:watch\s+no row\s+\u2014\s+\u2014/],
      ["the share is taken against one mebibyte", (t, f) => (f === "flows-status-coverage.js" ? t.replace("pctOf(k.share), k.updatedAt", "pctOf(k.bytes / 1048576), k.updatedAt") : t), /universe\s+98\.3 KiB\s+98%/],
    ];
    for (const [name, mutate, want] of covMutants) {
      const { page } = await open(browser, { mutate, view: "coverage" });
      await page.click("#kStoreCard .st-more");
      await page.waitForFunction(() => document.getElementById("kStoreDlg").open);
      const both = (await text(page, "#kStore")) + (await text(page, "#kStoreDlg"));
      ok(!want.test(both), "PLANTED WRONG BUILD, " + name + ", fails the coverage reading");
      await page.close();
    }
    const nulls = world();
    nulls["/api/rt/status"] = { body: { running: true, calls: {}, sockets: {}, topics: {}, upstream: {} } };
    const { page } = await open(browser, { map: nulls, mutate: (t, f) => (f === "flows-status.js" ? t.replace("const whole = (v) => (num(v) === null ? DASH :", 'const whole = (v) => (num(v) === null ? "0" :') : t) });
    ok(/vendor calls 0 of 0/.test(await text(page, "#hRail")), "the zero-printing mutant shows the 0 of 0 the clean build never shows");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-status-render: ${checks} checks passed`);
