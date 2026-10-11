import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const NOW = Date.parse("2026-10-11T18:12:00Z");

const RAIL = {
  running: true, ep: 1, startedAt: Date.parse("2026-10-11T07:00:00Z"), session: "2026-10-09", now: NOW,
  phase: { phase: "closed", trading: false, day: "2026-10-11" },
  upstream: { kind: "rest" },
  sockets: { n: 2, byUser: { anilkaya: 2 }, userCap: 3, max: 40 },
  calls: { minuteTotal: 31, perMinute: 240 },
  degraded: { since: Date.parse("2026-10-11T17:40:00Z"), reason: "vendor-429", k: ["px"], all: ["px"] },
  killSwitches: { FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "members" },
  topics: {
    px: { demanded: true, lastFrameAgeMs: 4200, lagMs: { n: 9, p50: 850, p95: 2400, max: 3000 }, calls: { minute: 12, hour: 700 }, fails: 3, fresh: { state: "fresh" } },
    fl: { demanded: true, lastFrameAgeMs: null, lagMs: { n: 0, p50: null, p95: null, max: null }, calls: { minute: 0, hour: 0 }, fails: 0, fresh: { state: "pending" } },
    gx: { demanded: false, lastFrameAgeMs: null, lagMs: { n: 0, p50: null, p95: null, max: null }, calls: { minute: 0, hour: 0 }, fails: 0, fresh: { state: "pending" } },
  },
};
const META = {
  generatedAt: "2026-10-10T20:30:00.000Z", sessionDate: "2026-10-09", universe: 670, cardsBuilt: 500, cardsFailed: 2, cardsSkipped: 8, apiCalls: 4100,
  health: { failures: 1, warnings: 2, first: ["cards: 2 failed"] },
  stages: [
    { id: "universe", status: "ok", ms: 4200, calls: 12, keys: 1 },
    { id: "roster", status: "failed", ms: 900, calls: 3, keys: 0, why: "vendor 5xx" },
  ],
};
const SPEND = { spend: { day: "2026-10-11", calls: 41, tokensIn: 52000, tokensOut: 9000, allowanceNeurons: 10000, neurons: 2300, remaining: 7700,
  byModel: [{ model: "m-one", calls: 30, tokensIn: 40000, tokensOut: 7000, neurons: 1800 }, { model: "m-two", calls: 11, tokensIn: 12000, tokensOut: 2000, neurons: null }] } };

async function open(browser, { width = 1440, rail, meta, ai }) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const asked = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/flows/status/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGES.statusPage({ username: "anilkaya" }) });
    if (u.pathname.startsWith("/api/")) {
      asked.push(u.pathname);
      const world = { "/api/rt/status": rail, "/api/flows/meta": meta, "/api/flows/ai-usage": ai }[u.pathname];
      if (!world) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not found" } }) });
      return route.fulfill({ status: world.status || 200, contentType: "application/json", body: JSON.stringify(world.body) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.clock.install({ time: new Date(NOW) });
  await page.goto("https://example.test/flows/status/");
  await page.waitForFunction(() => !document.getElementById("stAgain").disabled);
  return { page, asked, errors };
}

const text = (page, sel) => page.evaluate((s) => document.querySelector(s).innerText, sel);

const browser = await chromium.launch();
try {
  {
    const { page, asked, errors } = await open(browser, { rail: { body: RAIL }, meta: { body: META }, ai: { body: SPEND } });
    eq([...new Set(asked)].sort(), ["/api/flows/ai-usage", "/api/flows/meta", "/api/rt/status"], "the page reads the three existing owner routes and no other API route");
    eq(await page.evaluate(() => [...document.querySelectorAll("h1")].length), 1, "one h1");
    eq(await page.evaluate(() => [...document.querySelectorAll("main h1, main h2, main h3")].map((x) => x.tagName)), ["H1", "H2", "H2", "H2"], "the outline is h1 then three h2");
    const rail = await text(page, "#stRail");
    ok(rail.includes("10:00 TRT"), "the rail's start 07:00 [UTC] is written 10:00 TRT: " + rail.slice(0, 200));
    ok(rail.includes("20:40 TRT"), "the degraded episode since 17:40 [UTC] is 20:40 TRT");
    ok(/31 of 240 a minute/.test(rail) && /2 of 40/.test(rail), "calls and sockets carry their units and ceilings");
    ok(/850 ms/.test(rail) && /2\.4 s/.test(rail) && /4\.2 s ago/.test(rail), "lag and age print in ms and s");
    ok(/fl: no frame yet/.test(rail) && /gx: not demanded/.test(rail), "a topic with no frame is a dash with its reason");
    const fl = await page.evaluate(() => [...document.querySelectorAll("#stRail tbody tr")].map((r) => [...r.children].map((c) => c.textContent)));
    eq(fl[1], ["fl", "yes", "—", "—", "—", "0", "0", "0", "pending"], "an unmeasured lag is a dash and a measured zero is 0");
    const night = await text(page, "#stNight");
    ok(night.includes("10 Oct, 23:30 TRT"), "the nightly write 20:30 [UTC] the day before is written with its date: 10 Oct, 23:30 TRT");
    ok(/12 hours ago|12\.7 h ago|21\.7 h ago|h ago/.test(night), "and its age");
    ok(/1 failures, 2 warnings/.test(night) && night.includes("cards: 2 failed") && night.includes("vendor 5xx"), "health, its first line and a stage reason");
    const ai = await text(page, "#stAi");
    ok(/2,300 of 10,000 free a day/.test(ai) && /7,700 neurons/.test(ai) && /03:00 TRT/.test(ai), "spend, allowance and the reset in TRT");
    ok(/m-two: no configured rate, so its neurons are not worked/.test(ai), "a model with no rate shows a dash with its reason");
    const all = await text(page, "body");
    ok(!/\b(UTC|EDT|EST|GMT)\b|\bET\b/.test(all), "no other time zone is named anywhere on the page");
    ok(/Read at 21:12 TRT/.test(await text(page, "#stMeta")), "the read time is 21:12 TRT for 18:12 [UTC]");
    eq(errors, [], "no page error");
    await page.click("#stAgain");
    await page.waitForFunction(() => !document.getElementById("stAgain").disabled);
    ok(asked.length >= 6, "Read again fetches the three routes again");
    await page.close();
  }

  for (const width of [320, 390, 1440]) {
    const { page } = await open(browser, { width, rail: { body: RAIL }, meta: { body: META }, ai: { body: SPEND } });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, `no horizontal overflow at ${width} px (${over})`);
    await page.close();
  }

  {
    const err = (status, code) => ({ status, body: { error: { code, message: code } } });
    const { page, errors } = await open(browser, { rail: err(404, "rt_off"), meta: { body: { status: "pending" } }, ai: { body: { spend: null } } });
    const rail = await text(page, "#stRail");
    ok(/not read: HTTP 404 rt_off/.test(rail) && !/\b0\b/.test(rail), "a switched-off rail is a dash and its reason, with no zero");
    ok(/was not read: no run has been published yet/.test(await text(page, "#stNight")), "a pending nightly record says so");
    ok(/the store could not be read/.test(await text(page, "#stAi")), "an unreadable spend says so");
    ok(/3 of 3 sources could not be read/.test(await text(page, "#stNote")), "the status line counts the unread sources");
    eq(errors, [], "no page error with every source missing");
    await page.close();
  }

  {
    const { page } = await open(browser, { rail: { body: { running: false, calls: {}, sockets: {}, topics: {} } }, meta: { body: { generatedAt: META.generatedAt } }, ai: { body: { spend: { day: "2026-10-11", calls: 0, tokensIn: 0, tokensOut: 0, allowanceNeurons: 10000, neurons: 0, remaining: 10000, byModel: [] } } } });
    const rail = await text(page, "#stRail");
    ok(/Vendor calls, this minute\s+— of —/.test(rail), "absent call counters are dashes, not 0 of 0");
    const night = await text(page, "#stNight");
    ok(/health: this run's record carries no health line/.test(night) && /stages: this run's record carries no stage ledger/.test(night), "a nightly record without health or stages says what is missing");
    ok(/Calls\s+0/.test(await text(page, "#stAi")), "a day with no model call is a true 0");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-status-render: ${checks} checks passed`);
