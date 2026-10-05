import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { MARKET_INDICES, buildSnapshot } from "../shared/markets.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const ROOT = new URL("../", import.meta.url).pathname;
const ORIGIN = "http://landing.test";
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const NOW = Date.UTC(2026, 8, 29, 14, 0);
const snapshot = (n, bump = 0) => buildSnapshot(MARKET_INDICES.slice(0, n).map((index, i) => {
  const changePct = (i % 3 - 1) * 0.37 + 0.05 + bump;
  const price = 1000 * (i + 2) + 0.25 + bump * 100;
  return { key: index.key, label: index.label, currency: index.currency, price, changePct, prevClose: price / (1 + changePct / 100),
    asOf: NOW - 60000, asOfDay: "2026-09-29", prevDay: "2026-09-28", sessionEnd: null };
}), NOW);
const SNAPSHOT = snapshot(MARKET_INDICES.length);
const PARTICLES = readFileSync(new URL("../assets/js/particles.js", import.meta.url), "utf8");
const STILL = "function still() {";
assert.ok(PARTICLES.includes(STILL), "particles.js draws its reduced-motion frame in still()");
const stillOf = (passes) => PARTICLES.replace(STILL, `${STILL} ctx.clearRect(0, 0, state.width, state.height); for (let n = 0; n < ${passes}; n++) renderFrame(lastTime); return;`);

const scratch = mkdtempSync(join(tmpdir(), "landing-motion-"));
const browser = await chromium.launch();

async function open(reducedMotion, viewport = { width: 1280, height: 800 }, { snaps = [SNAPSHOT], clock = false, particles = null, seeded = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  let calls = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  if (seeded) await page.addInitScript(() => {
    let a = 0x2f6b4a1d;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  if (clock) await page.clock.install({ time: NOW });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === "/api/markets") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snaps[Math.min(calls++, snaps.length - 1)]) });
    if (particles !== null && url.pathname === "/assets/js/particles.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: particles });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    const file = join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const ext = file.slice(file.lastIndexOf("."));
    return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector("#marketTicker:not([hidden]) .tk");
  return { context, page, errors, calls: () => calls };
}

let traceN = 0;
async function animationFrames(page, ms) {
  const path = join(scratch, `trace-${traceN++}.json`);
  await browser.startTracing(page, { path, categories: ["devtools.timeline", "toplevel"] });
  await page.evaluate(() => console.timeStamp("LM|start"));
  await page.waitForTimeout(ms);
  await page.evaluate(() => console.timeStamp("LM|end"));
  await browser.stopTracing();
  const events = JSON.parse(readFileSync(path, "utf8")).traceEvents;
  const marks = events.filter((e) => e.name === "TimeStamp" && String(e.args?.data?.message || "").startsWith("LM|"));
  assert.equal(marks.length, 2, "both trace marks recorded");
  const thread = marks[0].pid + ":" + marks[0].tid;
  const from = marks[0].ts, to = marks[1].ts;
  return events.filter((e) => e.ph === "X" && e.name === "FireAnimationFrame" && e.pid + ":" + e.tid === thread && e.ts >= from && e.ts <= to).length;
}

const inked = (page) => page.evaluate(() => {
  const canvas = document.getElementById("field");
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
  return { lit, width: canvas.width, height: canvas.height };
});

{
  const { context, page, errors } = await open("reduce");
  await page.waitForTimeout(1000);
  const frames = await animationFrames(page, 2000);
  eq(frames, 0, `under reduced motion the particle field draws one frame and stops: ${frames} animation frames fired in the 2 s after the first second`);
  const first = await inked(page);
  ok(first.lit > 500, `the still frame is drawn (${first.lit} lit pixels)`);
  eq(first.width, 1280, "the canvas buffer matches the viewport width");

  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(600);
  const after = await inked(page);
  eq(after.width, 900, "a resize resizes the canvas buffer");
  ok(after.lit > 500, `a resize redraws the still frame (${after.lit} lit pixels after the buffer was cleared)`);
  const resized = await animationFrames(page, 1500);
  eq(resized, 0, `no animation loop resumes after a resize (${resized} frames)`);

  const toggle = await page.$eval(".market-ticker__toggle", (el) => getComputedStyle(el).display);
  eq(toggle, "none", "nothing moves under reduced motion, so the marquee shows no pause control");
  const play = await page.$eval(".market-ticker__row", (el) => getComputedStyle(el).animationName);
  eq(play, "none", "the marquee row does not animate under reduced motion");
  eq(errors.join(" | "), "", "no page error under reduced motion");
  await context.close();
}

{
  const { context, page, errors } = await open("no-preference");
  await page.waitForTimeout(1000);
  const frames = await animationFrames(page, 1500);
  ok(frames > 5, `with no motion preference the particle field keeps animating (${frames} frames), so the trace counts frames when there are any`);

  const state = () => page.$eval(".market-ticker__row", (el) => {
    const [a] = el.getAnimations();
    return { play: getComputedStyle(el).animationPlayState, state: a ? a.playState : null, t: a ? Number(a.currentTime) : null };
  });
  const settle = () => page.$eval(".market-ticker__row", (el) => el.getAnimations()[0].ready.then(() => 0));
  const moves = async () => {
    await settle();
    const t0 = (await state()).t;
    return page.waitForFunction((t) => Number(document.querySelector(".market-ticker__row").getAnimations()[0].currentTime) > t, t0, { timeout: 5000 })
      .then(() => true, () => false);
  };
  const still = async () => {
    await settle();
    const a = await state();
    await page.waitForTimeout(600);
    const b = await state();
    return a.state === "paused" && b.state === "paused" && a.t === b.t;
  };
  const label = () => page.$eval(".market-ticker__toggle", (el) => el.textContent);
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.classList.contains("market-ticker__toggle"));

  const running = await state();
  eq(running.state, "running", "the marquee scrolls by default");
  ok(await moves(), "the marquee moves by default");

  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await focused();
  }
  ok(reached, "Tab reaches the marquee's pause control");
  ok(await moves(), "focusing the control does not by itself stop the marquee it offers to pause");
  const named = await page.evaluate(() => ({ text: document.activeElement.textContent, label: document.activeElement.getAttribute("aria-label"), tag: document.activeElement.tagName, type: document.activeElement.type }));
  eq(named.tag, "BUTTON", "the control is a native button");
  eq(named.type, "button", "the control does not submit");
  eq(named.text, "Pause", "the control reads Pause while the marquee scrolls");
  ok(named.label.startsWith(named.text), `the accessible name begins with the visible label (${named.label})`);
  const box = await page.$eval(".market-ticker__toggle", (el) => el.getBoundingClientRect().toJSON());
  ok(box.height >= 24 && box.width >= 24, `the control is at least 24 by 24 CSS pixels (${box.width.toFixed(1)} by ${box.height.toFixed(1)})`);

  await page.keyboard.press("Enter");
  eq(await label(), "Play", "Enter pauses and the control then reads Play");
  eq(await page.$eval("#marketTicker", (el) => el.dataset.paused), "true", "the paused state is on the marquee");
  ok(await still(), "the paused marquee stands still while the control keeps focus");
  await page.keyboard.press("Enter");
  eq(await label(), "Pause", "Enter again plays and the control reads Pause");
  ok(await focused(), "the control still has focus");
  ok(await moves(), "the marquee scrolls again while the control keeps focus");

  await page.keyboard.press("Enter");
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(640, 10);
  const held = await state();
  eq(held.play, "paused", "the pause holds after focus leaves the marquee");
  eq(held.state, "paused", "the scroll animation is paused, not merely hidden");
  ok(await still(), "the paused marquee does not move after focus leaves");

  await page.focus(".market-ticker__toggle");
  await page.keyboard.press("Space");
  eq(await label(), "Pause", "Space plays again and the control reads Pause");
  ok(await moves(), "the marquee resumes on Space with the control still focused");

  const center = await page.$eval(".market-ticker__toggle", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(center.x, center.y);
  eq(await label(), "Play", "a click pauses");
  ok(await still(), "the marquee stands still after the click with the pointer on the control");
  await page.mouse.click(center.x, center.y);
  eq(await label(), "Pause", "a second click plays");
  ok(await moves(), "the marquee resumes with the pointer left on the control");

  const track = await page.$eval(".market-ticker__track", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(track.x, track.y);
  eq((await state()).play, "paused", "hovering the prices still pauses them");
  await page.mouse.move(640, 10);
  ok(await moves(), "the prices move again once the pointer leaves them");

  const before = await page.$eval(".market-ticker__toggle", (el) => el.getBoundingClientRect().x);
  await page.waitForTimeout(500);
  eq(await page.$eval(".market-ticker__toggle", (el) => el.getBoundingClientRect().x), before, "the control does not scroll with the prices");
  eq(errors.join(" | "), "", "no page error with motion");
  await context.close();
}

const brightness = (page) => page.evaluate(() => {
  const canvas = document.getElementById("field");
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let seen = 0, lum = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 16) continue;
    seen++;
    lum += (d[i + 3] / 255) * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  }
  return { seen, lum };
});

{
  const field = {};
  for (const [name, body] of [["shipped", PARTICLES], ["settled", stillOf(40)], ["single", stillOf(1)]]) {
    const { context, page, errors } = await open("reduce", { width: 1280, height: 800 }, { particles: body, seeded: true });
    await page.waitForTimeout(1200);
    field[name] = await brightness(page);
    eq(errors.join(" | "), "", `no page error drawing the ${name} still field`);
    await context.close();
  }
  const { shipped, settled, single } = field;
  const ratio = (a, b) => (a / b).toFixed(3);
  ok(shipped.seen >= 0.92 * settled.seen && shipped.seen <= 1.02 * settled.seen,
    `the still field shows as many visible pixels as the settled trail the reduced-motion loop used to build (${shipped.seen} against ${settled.seen}, ratio ${ratio(shipped.seen, settled.seen)})`);
  ok(shipped.lum >= 0.92 * settled.lum && shipped.lum <= 1.02 * settled.lum,
    `the still field is as bright as that settled trail (luminance ${shipped.lum.toFixed(0)} against ${settled.lum.toFixed(0)}, ratio ${ratio(shipped.lum, settled.lum)})`);
  ok(single.seen < 0.7 * settled.seen,
    `the measure tells a single pass from the settled field (${single.seen} visible pixels against ${settled.seen}), so it would catch a dimmed still frame`);
}

{
  const fresh = snapshot(MARKET_INDICES.length, 0.5);
  const { context, page, errors, calls } = await open("no-preference", { width: 1280, height: 800 }, { clock: true, particles: "", snaps: [SNAPSHOT, fresh] });
  const text = () => page.$eval(".market-ticker__row", (el) => el.textContent);
  const shown = await text();
  const firstPrice = await page.$eval(".market-ticker__row .tk__price", (el) => el.textContent);
  await page.click(".market-ticker__toggle");
  eq(await page.$eval("#marketTicker", (el) => el.dataset.paused), "true", "the row is paused before the refresh");
  await page.clock.runFor(5 * 60 * 1000 + 1000);
  for (let i = 0; i < 50 && calls() < 2; i++) await page.waitForTimeout(100);
  eq(calls(), 2, "the five-minute refresh fetched a new snapshot while the row was paused");
  await page.waitForTimeout(500);
  await page.clock.runFor(100);
  eq(await text(), shown, `a paused row keeps the prices the reader stopped to read (first price still ${firstPrice})`);
  eq(await page.$eval(".market-ticker__toggle", (el) => el.textContent), "Play", "the control still reads Play");
  await page.click(".market-ticker__toggle");
  const after = await page.$eval(".market-ticker__row .tk__price", (el) => el.textContent);
  ok(after !== firstPrice && (await text()) !== shown, `Play shows the snapshot that arrived during the pause (first price ${firstPrice} becomes ${after})`);
  await page.clock.runFor(5 * 60 * 1000 + 1000);
  for (let i = 0; i < 50 && calls() < 3; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(500);
  eq(await page.$eval(".market-ticker__row .tk__price", (el) => el.textContent), after, "while playing a refresh renders at once");
  eq(errors.join(" | "), "", "no page error across a held refresh");
  await context.close();
}

for (const [width, motion] of [[320, "no-preference"], [390, "no-preference"], [1280, "no-preference"], [390, "reduce"], [1280, "reduce"]]) {
  const { context, page, errors } = await open(motion, { width, height: 800 });
  await page.waitForTimeout(1500);
  const fit = await page.evaluate(() => {
    const t = document.querySelector(".market-ticker__toggle").getBoundingClientRect();
    const bar = document.querySelector("#marketTicker").getBoundingClientRect();
    const foot = document.querySelector(".home-foot").getBoundingClientRect();
    return { scroll: document.scrollingElement.scrollWidth, inner: innerWidth, left: t.left, right: t.right, barTop: bar.top, barH: bar.height, footBottom: foot.bottom };
  });
  ok(fit.scroll <= fit.inner, `no horizontal page scroll at ${width} px, ${motion} (${fit.scroll} against ${fit.inner})`);
  if (motion === "no-preference") ok(fit.left >= 0 && fit.right <= fit.inner, `the pause control sits inside the viewport at ${width} px`);
  ok(fit.barTop >= fit.footBottom, `the marquee bar starts at or below the footer at ${width} px, ${motion} (bar top ${fit.barTop.toFixed(1)}, footer bottom ${fit.footBottom.toFixed(1)})`);
  ok(fit.barH <= 30.5, `the marquee bar keeps its height at ${width} px, ${motion} (${fit.barH.toFixed(1)} px)`);
  if (motion === "no-preference") {
    const trackX = () => page.$eval(".market-ticker__track", (el) => el.getBoundingClientRect().x);
    await page.focus(".market-ticker__toggle");
    const at = [await trackX()];
    await page.keyboard.press("Enter");
    at.push(await trackX());
    await page.keyboard.press("Enter");
    at.push(await trackX());
    ok(at[0] === at[1] && at[1] === at[2], `the prices keep their place when the control flips between Pause and Play at ${width} px (track x ${at.map((x) => x.toFixed(2)).join(", ")})`);
  }
  eq(errors.join(" | "), "", `no page error at ${width} px`);
  await context.close();
}

await browser.close();
rmSync(scratch, { recursive: true, force: true });
console.log(`✓ landing-motion: ${checks} assertions — under reduced motion the particle field draws one still frame, redraws it on resize and fires no animation frame after the first second, and the marquee neither moves nor offers a control; with motion the field animates and the marquee has a native Pause button that Tab reaches, Enter and Space toggle, that plays again while it keeps focus, by key and by a click with the pointer still on it, holds after focus leaves and does not scroll with the prices, the prices keep their place when the label flips, a refresh that lands while paused waits for Play, the still field is as bright as the settled trail it replaced, and the bar stays clear of the footer at 320, 390 and 1280 px`);
