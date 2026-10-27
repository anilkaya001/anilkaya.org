import assert from "node:assert/strict";
import { launch } from "./lib/browser.mjs";
import { openMacro, settle, macroPayload, FX, liveBodies, NOW } from "./lib/macro-world.mjs";
import * as PAGES from "../shared/flows-pages.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const TABS = ["overview", "rates", "fx", "commod", "crypto", "futures", "odds", "season"];
const SIZES = [[1920, 1080], [1440, 820], [1024, 768], [390, 844]];
const BANNED = /\b(vendor|tape|unusual whales)\b/i;
const ZONES = /\b(ET|EST|EDT|UTC|GMT|CET)\b/;

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fixed = (x, dp) => group(x.toFixed(dp));

const base = macroPayload("ok");
const MACRO_JS = "/assets/js/flows-macro.js";

const html = PAGES.macroPage({ username: "t", live: true });
ok(/id="mcT-overview"/.test(html) && /role="tablist"/.test(html), "the page carries its tablist");
ok(!BANNED.test(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, "")), "the served markup names no provider and no tape");
ok(!/<script[^>]+flows-macro-charts/.test(html) && /data-defer="macro-charts"/.test(html), "the chart painters are a deferred group, not a script");

const browser = await launch();

async function geometry(page, w, h, tab) {
  await page.click("#mcT-" + tab);
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.getElementById("flowsMain");
    const mods = [...document.querySelectorAll(".mc-view:not([inert]) .mc-mod")].filter((m) => m.offsetParent !== null);
    const bad = [];
    for (const m of mods) {
      const r = m.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1) bad.push(m.dataset.m + ":out");
      const body = m.querySelector(".mc-body");
      if (body && body.scrollHeight > body.clientHeight + 1) bad.push(m.dataset.m + ":cut");
    }
    return { page: doc.scrollHeight > innerHeight + 1, sideways: doc.scrollWidth > innerWidth + 1, main: main.scrollHeight > main.clientHeight + 1, mods: mods.length, bad, text: document.querySelector(".mc-view:not([inert])").innerText + " " + document.getElementById("mcHero").innerText };
  });
  ok(!info.page && !info.sideways && !info.main, `${w}x${h} ${tab}: no page scroll and no sideways scroll`);
  eq(info.bad, [], `${w}x${h} ${tab}: every module sits inside the viewport and none cuts its own body`);
  ok(info.mods >= 1, `${w}x${h} ${tab}: a module is on screen`);
  ok(!ZONES.test(info.text), `${w}x${h} ${tab}: times are TRT only`);
  ok(!BANNED.test(info.text), `${w}x${h} ${tab}: no provider name and no tape in the text`);
  return info;
}

for (const [w, h] of SIZES) {
  const { page, errors, context, requests } = await openMacro(browser, { viewport: { width: w, height: h } });
  await settle(page);
  for (const tab of TABS) await geometry(page, w, h, tab);
  eq(errors, [], `${w}x${h}: no page error`);
  ok(requests.some((r) => r.startsWith("/api/flows/macro?")) || requests.includes("/api/flows/macro"), `${w}x${h}: the board is read once from /api/flows/macro`);
  ok(requests.filter((r) => r === "/api/flows/macro").length === 1, `${w}x${h}: and only once`);
  await context.close();
}

{
  const { page, context } = await openMacro(browser);
  await settle(page);
  const hero = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".mc-cell")].map((c) => [c.dataset.k, c.querySelector(".mc-cv").textContent])));
  const curve = Object.fromEntries(base.rates.curve.map((r) => [r[0], r]));
  eq(hero.es, fixed(base.futures.products.ES.last[1], 2), "the S&P futures tile prints the payload's last settlement");
  eq(hero.ty, fixed(curve["10year"][1], 2) + "%", "the 10-year tile prints the payload's yield");
  eq(hero.sp, (base.rates.spreads.s2s10 >= 0 ? "+" : "−") + Math.abs(Math.round(base.rates.spreads.s2s10)) + " bp", "the 2s10s tile prints the payload's spread in basis points");
  ok(/^\d[\d,]*$/.test(hero.btc) && Number(hero.btc.replace(/,/g, "")) > 0, "the Bitcoin tile prints a live level");
  const src = await page.evaluate(() => [...document.querySelectorAll(".mc-cs")].map((c) => c.textContent.trim()));
  ok(src.every((t) => /^(Nightly, as of|Read )/.test(t) || t === ""), "every hero tile names its source as nightly or a read time");
  await page.click("#mcT-odds");
  await page.waitForTimeout(150);
  const odds = await page.evaluate(() => document.querySelector(".mc-view:not([inert])").innerText);
  const fomc = base.odds.events.find((e) => e.tag === "fomc");
  ok(odds.includes(Math.round(fomc.markets[0].price * 100) + "%"), "the odds view prints the FOMC market price from the payload");
  await context.close();
}

{
  const thin = macroPayload("odds-thin");
  const { page, context } = await openMacro(browser, { payload: thin });
  await settle(page);
  const chips = await page.evaluate(() => [...document.querySelectorAll("#mcM-cal .mc-chip")].map((c) => ({ warn: /warn/.test(c.className), hollow: c.textContent.includes("\u25cb") })));
  const first = thin.odds.events.map((e) => e.markets[0]).filter(Boolean);
  ok(first.some((m) => m.thin), "the thin world carries a thin market");
  eq(chips.filter((c) => c.hollow).length, first.filter((m) => m.thin).length, "a thin market is drawn hollow");
  eq(chips.filter((c) => c.warn).length, first.filter((m) => m.thin).length, "and flagged, never solid");
  await context.close();
}

{
  const { page, context, requests } = await openMacro(browser, { live: false });
  await settle(page);
  await page.waitForTimeout(300);
  ok(!requests.some((r) => r.startsWith("/api/flows/macro/now")), "with the live switch off the page makes no macro/now request");
  await context.close();
}

{
  const { page, context, requests } = await openMacro(browser);
  await settle(page);
  const first = requests.filter((r) => r.startsWith("/api/flows/macro/now")).length;
  ok(first >= 1, "with the live switch on the page reads macro/now");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(10 * 60 * 1000);
  eq(requests.filter((r) => r.startsWith("/api/flows/macro/now")).length, first, "a hidden tab makes no live request over ten minutes");
  await context.close();
}

{
  const { page, context, requests } = await openMacro(browser);
  await settle(page);
  const before = requests.filter((r) => r.startsWith("/api/flows/macro/now")).length;
  await page.clock.runFor(4 * 60 * 1000);
  eq(requests.filter((r) => r.startsWith("/api/flows/macro/now")).length, before, "the live read is not polled faster than every five minutes");
  await page.clock.runFor(2 * 60 * 1000);
  ok(requests.filter((r) => r.startsWith("/api/flows/macro/now")).length > before, "and is read again once five minutes have passed");
  await context.close();
}

{
  const { page, context } = await openMacro(browser, { pending: true });
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.getElementById("mc").innerText);
  ok(!/\bNaN\b|undefined|\bnull\b/.test(text), "a pending payload draws no NaN, undefined or null");
  await context.close();
}

{
  const { page, context } = await openMacro(browser, { viewport: { width: 390, height: 844 }, coarse: true });
  await settle(page);
  const small = await page.evaluate(() => [...document.querySelectorAll(".mc-tab, .mc-sub button, .mc-seg button")].filter((b) => b.offsetParent !== null).map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x < 44));
  eq(small, [], "on a coarse pointer every tab and switch is at least 44 px tall");
  await context.close();
}

{
  const { page, context } = await openMacro(browser, { reduced: true });
  await settle(page);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  eq(running, 0, "under reduced motion no animation runs");
  await context.close();
}

async function planted(name, patch, check, payload = null) {
  const { page, context } = await openMacro(browser, { patch, payload });
  await settle(page).catch(() => {});
  let failed = false;
  try { await check(page); } catch { failed = true; }
  await context.close();
  ok(failed, `PLANTED WRONG BUILD caught: ${name}`);
}

const heroOf = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".mc-cell")].map((c) => [c.dataset.k, c.querySelector(".mc-cv").textContent])));
const expectSpread = (base.rates.spreads.s2s10 >= 0 ? "+" : "−") + Math.abs(Math.round(base.rates.spreads.s2s10)) + " bp";

await planted("the spread printed without its unit", { [MACRO_JS]: [['F.signed(sp, 0) + " bp"', 'F.signed(sp, 0)']] }, async (page) => eq((await heroOf(page)).sp, expectSpread, "unit"));
const NULLED = macroPayload("unit-null");
const withheldText = (page) => page.evaluate(() => [...document.querySelectorAll(".mc-why[title]")].map((e) => e.textContent.trim()));
{
  const { page, context } = await openMacro(browser, { payload: NULLED });
  await settle(page);
  await page.click("#mcT-rates");
  await page.waitForTimeout(150);
  const marks = await withheldText(page);
  ok(marks.length > 0 && marks.every((t) => t.startsWith("\u2014")), "a withheld series is a dash with its reason, never a zero");
  await context.close();
}
await planted("a missing value drawn as zero", { [MACRO_JS]: [['title="${esc(say("state.withheld", { reason: why(code) }))}">${DASH}', 'title="${esc(say("state.withheld", { reason: why(code) }))}">0']] }, async (page) => {
  await page.click("#mcT-rates");
  await page.waitForTimeout(150);
  const marks = await withheldText(page);
  ok(marks.length > 0 && marks.every((t) => t.startsWith("\u2014")), "dash");
}, NULLED);
await planted("a thin market drawn solid", { [MACRO_JS]: [['${mk.thin ? " \u25cb" : ""}', ""], ['mc-chip${mk.thin ? " warn" : ""}', "mc-chip"]] }, async (page) => {
  const chips = await page.evaluate(() => [...document.querySelectorAll("#mcM-cal .mc-chip")].map((c) => c.textContent));
  ok(chips.some((t) => t.includes("\u25cb")), "hollow");
}, macroPayload("odds-thin"));
await planted("the zone named Eastern", { "/assets/js/flows-ui.js": [[" TRT\"", " ET\""]] }, async (page) => {
  const text = await page.evaluate(() => document.getElementById("mc").innerText);
  ok(!ZONES.test(text), "zone");
});
await planted("a live read every thirty seconds", { [MACRO_JS]: [["LIVE_EVERY_MS = 300000", "LIVE_EVERY_MS = 30000"], ["LIVE_EVERY_MS = 300 * 1000", "LIVE_EVERY_MS = 30 * 1000"], ["LIVE_EVERY_MS = 5 * 60 * 1000", "LIVE_EVERY_MS = 30 * 1000"]] }, async (page) => {
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.clock.runFor(4 * 60 * 1000);
  ok(!reqs.some((u) => u.includes("/api/flows/macro/now")), "poll");
});
await planted("a live read while the tab is hidden", { [MACRO_JS]: [["if (!document.hidden) loadLive(needed())", "loadLive(needed())"], ["if (!S.liveOn || document.hidden) return;", "if (!S.liveOn) return;"]] }, async (page) => {
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); });
  await page.clock.runFor(10 * 60 * 1000);
  ok(!reqs.some((u) => u.includes("/api/flows/macro/now")), "hidden");
});

await browser.close();
console.log(`flows-macro-render: ${checks} checks`);
