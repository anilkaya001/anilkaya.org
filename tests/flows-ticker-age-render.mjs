import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const EMIT = nightlyEmit();
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EMIT, f), "utf8"));
const T = "AAPL";
const BASE = rd(`-card-${T}.json`);
const NOW = Date.parse("2026-11-14T12:00:00Z");
const EXPECTED = "2026-11-13";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };
const SRC_PATH = "/assets/js/flows-ticker.js";
const SRC = fs.readFileSync(path.join(ROOT, SRC_PATH), "utf8");
const SHOTS = process.env.AGE_SHOTS || null;

const HOLIDAYS = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-calendar.json"), "utf8")).holidays);
const oracleBehind = (from, to) => {
  let n = 0;
  for (let t = Date.parse(from + "T00:00:00Z") + 864e5; t <= Date.parse(to + "T00:00:00Z"); t += 864e5) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !HOLIDAYS.has(iso)) n++;
  }
  return n;
};

const PAGE_HTML = FLOWS_PAGES.tickerPage({ username: "test", now: NOW });
{
  const past = /data-past="([^"]*)"/.exec(PAGE_HTML);
  ok(!!past, "the ticker page carries the sessions before today");
  const list = past[1].split(",");
  eq(list.length, FLOWS_PAGES.PAST_SESSIONS, "sixty of them");
  eq(list.at(-1), EXPECTED, "ending with the last session before today");
  ok(list.every((d) => oracleBehind(d, EXPECTED) === list.length - 1 - list.indexOf(d)), "every one an exchange session, none skipped, against the exchange's own holiday list");
  ok(!list.includes("2026-11-26") && FLOWS_PAGES.pastSessions(Date.parse("2026-11-30T12:00:00Z")).includes("2026-11-27") && !FLOWS_PAGES.pastSessions(Date.parse("2026-11-30T12:00:00Z")).includes("2026-11-26"), "Thanksgiving is not a session and the day after it is");
}

const browser = await chromium.launch();

async function load({ card, meta, src = null, viewport = { width: 1440, height: 820 } }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const body = { card, "card-x": { status: "absent" }, hist: { status: "absent" }, summary: { status: "quiet", scope: T, summary: null, ideas: [], tier: "family", code: null, why: "x" },
    tape: { status: "pending" }, meta, events: { status: "pending", rows: [] },
    now: { serverNow: NOW, expected: EXPECTED, phase: { phase: "closed", session: EXPECTED, trading: false, endsAt: null }, keys: {} } };
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === SRC_PATH && src) return route.fulfill({ contentType: "text/javascript", body: src });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      const b = key === "board" ? { status: "pending", rows: [] } : body[key] === undefined ? { status: "pending" } : body[key];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.clock.install({ time: NOW });
  await page.clock.resume();
  const metaServed = page.waitForResponse((r) => r.url().includes("/api/flows/meta"), { timeout: 15000 }).catch(() => null);
  await page.goto("https://example.test/flows/ticker/?t=" + T);
  return { page, ctx, errors, metaServed };
}

async function readAge(page) {
  await page.waitForSelector("#ftHeroFlags .ft-stale", { timeout: 15000 });
  const label = await page.$eval("#ftHeroFlags .ft-stale", (b) => b.getAttribute("aria-label"));
  await page.click("#ftHeroFlags .ft-stale");
  await page.waitForFunction(() => { const b = document.getElementById("fxPopB"); return b && b.textContent.trim().length > 0; }, null, { timeout: 5000 });
  const lead = await page.$eval("#fxPopB", (b) => b.textContent.replace(/\s+/g, " ").trim());
  return { label, lead };
}

const CASES = [
  { id: "kept-deep", session: "2026-11-06", depth: "deepened", meta: EXPECTED, why: /The run for 2026-11-13 did not land a new read of this name, so the read of 2026-11-06 is kept until one does\./ },
  { id: "not-yet", session: "2026-11-12", depth: "deepened", meta: "2026-11-12", why: /The run for 2026-11-13 has not published yet, so this is the newest full read of the name\./ },
  { id: "board-kept", session: "2026-11-10", depth: "board", meta: EXPECTED, why: /The run for 2026-11-13 did not rebuild this card, so the card of 2026-11-10 is kept\./ },
  { id: "later-run", session: "2026-11-10", depth: "deepened", meta: "2026-11-12", why: /The run for 2026-11-12 did not rebuild this card, and the run for 2026-11-13 has not published yet\./ },
  { id: "across-a-holiday", session: "2026-09-04", depth: "deepened", meta: EXPECTED, why: /did not land a new read/ },
  { id: "very-old", session: "2026-07-31", depth: "deepened", meta: EXPECTED, why: /did not land a new read/ },
];

async function battery(src = null) {
  const bad = [];
  const check = (c, m) => { if (!c) bad.push(m); };
  for (const c of CASES) {
    const card = { ...BASE, sessionDate: c.session, depth: c.depth };
    const { page, ctx, errors, metaServed } = await load({ card, meta: { sessionDate: c.meta, generatedAt: "2026-11-13T23:36:00Z" }, src });
    try {
      await page.waitForSelector("#ftHeroFlags .ft-stale", { timeout: 15000 });
      await metaServed;
      await page.waitForTimeout(400);
      const { label, lead } = await readAge(page);
      const n = oracleBehind(c.session, EXPECTED);
      const span = c.id === "very-old" ? "at least 60 sessions behind" : `${n} ${n === 1 ? "session" : "sessions"} behind`;
      check(lead.includes(`Stale: every figure on this page is from the session of ${c.session}, ${span} the last completed session, ${EXPECTED}.`), `${c.id}: the sentence states the age in exchange sessions (${span}): ${lead}`);
      check(c.why.test(lead), `${c.id}: the sentence says why the figure is old: ${lead}`);
      check(typeof label === "string" && label.startsWith("Stale: session ") && label.endsWith(", " + span), `${c.id}: the chip's accessible name carries the age: ${label}`);
      check(errors.length === 0, `${c.id}: no page error: ${errors.join(" | ")}`);
      if (SHOTS && !src && c.id === "kept-deep") {
        await page.screenshot({ path: path.join(SHOTS, "ticker-age-1440x820.png") });
      }
    } catch (e) {
      bad.push(`${c.id}: ${e.message.split("\n")[0]}`);
    } finally {
      await ctx.close();
    }
  }
  return bad;
}

try {
  const good = await battery();
  eq(good, [], "THE TICKER PAGE SAYS HOW OLD A KEPT CARD IS, IN EXCHANGE SESSIONS, AND WHY");
  if (SHOTS) {
    const card = { ...BASE, sessionDate: "2026-11-06", depth: "deepened" };
    const { page, ctx } = await load({ card, meta: { sessionDate: EXPECTED }, viewport: { width: 390, height: 844 } });
    await readAge(page);
    await page.screenshot({ path: path.join(SHOTS, "ticker-age-390x844.png") });
    await ctx.close();
  }
  const fresh = { ...BASE, sessionDate: EXPECTED, depth: "deepened" };
  {
    const { page, ctx, errors } = await load({ card: fresh, meta: { sessionDate: EXPECTED } });
    await page.waitForSelector("#ftHeroT", { state: "visible", timeout: 15000 });
    await page.waitForFunction(() => document.getElementById("ftHeroT").textContent.length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    eq(await page.$$eval("#ftHeroFlags .ft-stale", (n) => n.length), 0, "a card of the expected session carries no stale chip");
    eq(errors, [], "and no page error");
    await ctx.close();
  }
  const PLANTS = [
    ["age-in-calendar-days", [["return i < 0 || i > j ? null : { n: j - i, more: false };", "return i < 0 || i > j ? null : { n: Math.round((Date.parse(to) - Date.parse(from)) / 864e5), more: false };"]]],
    ["no-reason-given", [['    const why = !known ? "" : !landed && meta.sessionDate > d ?', '    const why = ""; const unused = !known ? "" : !landed && meta.sessionDate > d ?']]],
    ["reasons-swapped", [["const known = !!meta && isoOk(meta.sessionDate), landed = known && meta.sessionDate >= expected;", "const known = !!meta && isoOk(meta.sessionDate), landed = known && meta.sessionDate < expected;"]]],
    ["weekdays-only-calendar", [['calDays = [...new Set(read("past").concat(read("sessions")))].sort();', 'calDays = []; for (let t = Date.parse("2026-01-01T00:00:00Z"); t < Date.parse("2027-01-01T00:00:00Z"); t += 864e5) { const w = new Date(t); if (w.getUTCDay() % 6) calDays.push(w.toISOString().slice(0, 10)); }']]],
    ["weekdays-only-same-window", [['calDays = [...new Set(read("past").concat(read("sessions")))].sort();', 'const real = [...new Set(read("past").concat(read("sessions")))].sort(); calDays = []; for (let t = Date.parse(real[0] + "T00:00:00Z"); t <= Date.parse(real[real.length - 1] + "T00:00:00Z"); t += 864e5) { const w = new Date(t); if (w.getUTCDay() % 6) calDays.push(w.toISOString().slice(0, 10)); }']]],
    ["later-run-unsaid", [['!landed && meta.sessionDate > d ?', 'false ?']]],
    ["old-card-floor-not-said", [["if (from < days[0]) return { n: j + 1, more: true };", "if (from < days[0]) return null;"]]],
    ["chip-label-without-age", [['b.setAttribute("aria-label", "Stale: session " + day(card.sessionDate) + (gap ?', 'b.setAttribute("aria-label", "Stale: session " + day(card.sessionDate) + (false ?']]],
  ];
  for (const [id, transforms] of PLANTS) {
    let src = SRC;
    for (const [from, to] of transforms) {
      const n = src.split(from).length - 1;
      assert.equal(n, 1, `plant ${id}: anchor matches once (${n})`);
      src = src.replace(from, () => to);
    }
    const caught = await battery(src);
    ok(caught.length > 0, `PLANTED WRONG BUILD ${id} must fail: ${caught.length} check(s) caught it`);
  }
} finally {
  await browser.close();
}

console.log(`flows-ticker-age-render: ${checks} checks passed`);
