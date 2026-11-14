import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
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
const COUNTED = PARTICLES.replace(STILL, `${STILL} window.__stills = (window.__stills || 0) + 1;`);
const price = (snap) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(snap.quotes[0].price);
const HOME_CSS = readFileSync(new URL("../assets/css/home.css", import.meta.url), "utf8");
const START = "function start() {";
const CTX = 'const ctx = canvas.getContext("2d", { alpha: true });';
for (const anchor of [START, CTX]) assert.ok(PARTICLES.includes(anchor), `particles.js carries the line the suite plants its probe at: ${anchor}`);
const plant = (src, pairs, what) => pairs.reduce((out, [from, to]) => {
  assert.equal(out.split(from).length - 1, 1, `${what}: the planted change needs exactly one ${JSON.stringify(from)} in the source`);
  return out.replace(from, () => to);
}, src);
const PROBE = "window.__field = window.__field || { pX, pY, pZ, pLum, brightest, plane, state, zone, atlas, renderFrame, COUNT, GRID_R, GRID_STEP, GRID_N, GRID_SEG, RIM_SEG, GRID_COLOR, RESID_COLOR, REST_DIST, REST_PITCH, DOLLY_MS, DOLLY_PULL, SCROLL_PITCH, SCROLL_PULL, PAR_YAW, ORBIT_YAW };";
const RECORDER = `window.__lm = { on: !!window.__lmOn, fills: 0, draws: 0, foreign: 0, sprites: [], lines: [], path: [] };
  for (const name of ["drawImage", "beginPath", "moveTo", "lineTo", "stroke", "fillRect"]) {
    const real = ctx[name].bind(ctx);
    ctx[name] = (...a) => {
      const lm = window.__lm;
      if (name === "fillRect") lm.fills++;
      else if (name === "drawImage") {
        lm.draws++;
        if (a[0] !== atlas) lm.foreign++;
        if (lm.on) lm.sprites.push([lm.fills, a[1], a[2], a[3], a[5], a[6], a[7], a[8], ctx.globalAlpha]);
      } else if (lm.on && name === "beginPath") lm.path = [];
      else if (lm.on && (name === "moveTo" || name === "lineTo")) lm.path.push(a[0], a[1]);
      else if (lm.on && name === "stroke") lm.lines.push({ pass: lm.fills, style: ctx.strokeStyle, alpha: ctx.globalAlpha, width: ctx.lineWidth, pts: lm.path });
      return real(...a);
    };
  }`;
const MUTE = 'for (const name of ["drawImage", "fillRect", "stroke"]) ctx[name] = () => {};';
const probed = (src, { record = true, hold = false, mute = false } = {}) => plant(src, [
  [CTX, mute ? `${CTX} ${MUTE}` : record ? `${CTX} ${RECORDER}` : CTX],
  [STILL, `${STILL} ${PROBE}`],
  [START, `${START} ${PROBE}${hold ? " return;" : ""}`],
], "the probe");

const scratch = mkdtempSync(join(tmpdir(), "landing-motion-"));
const browser = await chromium.launch();

async function open(reducedMotion, viewport = { width: 1280, height: 800 }, { snaps = [SNAPSHOT], clock = false, particles = null, seeded = false, dpr = 1, css = null, forcedColors = "none", record = false, opaque = false, init = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion, forcedColors });
  const page = await context.newPage();
  if (opaque) await (await context.newCDPSession(page)).send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  if (record) await page.addInitScript(() => { window.__lmOn = true; });
  if (init) await page.addInitScript(init);
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
    if (css !== null && url.pathname === "/assets/css/home.css") return route.fulfill({ status: 200, contentType: "text/css", body: css });
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
  const { context, page, errors } = await open("reduce", { width: 1280, height: 800 }, { particles: COUNTED });
  await page.waitForTimeout(1000);
  const frames = await animationFrames(page, 2000);
  eq(frames, 0, `under reduced motion the particle field draws one frame and stops: ${frames} animation frames fired in the 2 s after the first second`);
  const first = await inked(page);
  ok(first.lit > 500, `the still frame is drawn (${first.lit} lit pixels)`);
  eq(first.width, 1280, "the canvas buffer matches the viewport width");
  const stills = () => page.evaluate(() => window.__stills);
  eq(await stills(), 1, "the still frame is drawn once during load: the load, rAF, pageshow and timeout resizes find the size unchanged and keep the pixels");
  await page.evaluate(() => dispatchEvent(new Event("resize")));
  await page.waitForTimeout(400);
  eq(await stills(), 1, "a resize event with the viewport unchanged does not clear and redraw the field");

  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(600);
  const after = await inked(page);
  eq(after.width, 900, "a resize resizes the canvas buffer");
  ok(after.lit > 500, `a resize redraws the still frame (${after.lit} lit pixels after the buffer was cleared)`);
  eq(await stills(), 2, "a viewport change redraws the still frame once");
  const resized = await animationFrames(page, 1500);
  eq(resized, 0, `no animation loop resumes after a resize (${resized} frames)`);

  const toggle = await page.$eval(".market-ticker__toggle", (el) => ({ display: getComputedStyle(el).display, text: el.textContent, label: el.getAttribute("aria-label") }));
  ok(toggle.display !== "none", "the prices still auto-update under reduced motion, so the Pause control stays (WCAG 2.2.2, auto-updating)");
  eq(toggle.text, "Pause", "the control reads Pause under reduced motion");
  ok(toggle.label.startsWith(toggle.text) && !/scroll/i.test(toggle.label), `the accessible name begins with the visible label and claims no scrolling (${toggle.label})`);
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

{
  const { context, page, errors } = await open("reduce", { width: 640, height: 500 }, { dpr: 2 });
  await page.waitForTimeout(1000);
  const quadrants = () => page.evaluate(() => {
    const canvas = document.getElementById("field");
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const lit = [0, 0, 0, 0];
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] === 0) continue;
      const p = (i - 3) / 4, x = p % canvas.width, y = (p - x) / canvas.width;
      lit[(y >= canvas.height / 2 ? 2 : 0) + (x >= canvas.width / 2 ? 1 : 0)]++;
    }
    return { width: canvas.width, height: canvas.height, lit };
  });
  const drawn = await quadrants();
  eq(drawn.width, 1280, "at DPR 2 the buffer is twice the viewport width");
  ok(drawn.lit.every((n) => n > 50), `the still frame reaches every quadrant of the buffer (${drawn.lit.join(", ")})`);
  await page.evaluate(() => {
    const canvas = document.getElementById("field");
    const ctx = canvas.getContext("2d");
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.dispatchEvent(new Event("contextrestored"));
  });
  const restored = await quadrants();
  ok(restored.lit.every((n) => n > 50), `after a context loss, which resets the transform, the restored still frame is drawn at the device scale again and reaches every quadrant (${restored.lit.join(", ")})`);
  ok(Math.abs(restored.lit[3] - drawn.lit[3]) <= 0.05 * drawn.lit[3], `the restored frame matches the first in the bottom-right quadrant (${restored.lit[3]} against ${drawn.lit[3]})`);
  eq(errors.join(" | "), "", "no page error across a context restore");
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

for (const motion of ["no-preference", "reduce"]) {
  const fresh = snapshot(MARKET_INDICES.length, 0.5);
  const third = snapshot(MARKET_INDICES.length, 1.0);
  const { context, page, errors, calls } = await open(motion, { width: 1280, height: 800 }, { clock: true, particles: "", snaps: [SNAPSHOT, fresh, third] });
  const text = () => page.$eval(".market-ticker__row", (el) => el.textContent);
  const first = () => page.$eval(".market-ticker__row .tk__price", (el) => el.textContent);
  const label = () => page.$eval(".market-ticker__toggle", (el) => el.textContent);
  const shown = await text();
  const firstPrice = await first();
  eq(firstPrice, price(SNAPSHOT), `the first snapshot is on screen, ${motion}`);
  await page.focus(".market-ticker__toggle");
  await page.keyboard.press("Enter");
  eq(await page.$eval("#marketTicker", (el) => el.dataset.paused), "true", `the row is paused before the refresh, ${motion}`);
  await page.clock.runFor(5 * 60 * 1000 + 1000);
  for (let i = 0; i < 50 && calls() < 2; i++) await page.waitForTimeout(100);
  eq(calls(), 2, `the five-minute refresh fetched a new snapshot while the row was paused, ${motion}`);
  await page.waitForTimeout(500);
  await page.clock.runFor(100);
  eq(await text(), shown, `a paused row keeps the prices the reader stopped to read, ${motion} (first price still ${firstPrice})`);
  eq(await label(), "Play", `the control still reads Play, ${motion}`);
  await page.keyboard.press("Enter");
  const after = await first();
  eq(after, price(fresh), `Play shows the snapshot that arrived during the pause, ${motion} (first price ${firstPrice} becomes ${after})`);
  const released = await text();
  ok(released !== shown, `the whole row was replaced on Play, ${motion}`);

  await page.keyboard.press("Enter");
  eq(await label(), "Play", `a second Pause with nothing held pauses, ${motion}`);
  await page.keyboard.press("Enter");
  eq(await label(), "Pause", `a second Play with nothing held plays, ${motion}`);
  const bar = await page.evaluate(() => {
    const mount = document.getElementById("marketTicker");
    const toggle = mount.querySelector(".market-ticker__toggle");
    return { hidden: mount.hidden, display: getComputedStyle(mount).display, control: getComputedStyle(toggle).display, visible: toggle.getClientRects().length > 0, focused: document.activeElement === toggle };
  });
  ok(!bar.hidden && bar.display !== "none", `the bar stays after a Play with nothing held, ${motion} (hidden ${bar.hidden}, display ${bar.display})`);
  ok(bar.control !== "none" && bar.visible, `the control stays visible, ${motion}`);
  ok(bar.focused, `the control keeps focus, ${motion}`);
  eq(await text(), released, `the row text is unchanged by a Pause and Play with nothing held, ${motion}`);

  await page.clock.runFor(5 * 60 * 1000 + 1000);
  for (let i = 0; i < 50 && calls() < 3; i++) await page.waitForTimeout(100);
  eq(calls(), 3, `a third refresh was fetched while playing, ${motion}`);
  await page.waitForTimeout(500);
  await page.clock.runFor(100);
  eq(await first(), price(third), `while playing a refresh renders at once, ${motion} (first price ${after} becomes ${price(third)})`);
  eq(errors.join(" | "), "", `no page error across a held refresh, ${motion}`);
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
  ok(fit.left >= 0 && fit.right <= fit.inner, `the pause control sits inside the viewport at ${width} px, ${motion}`);
  ok(fit.barTop >= fit.footBottom, `the marquee bar starts at or below the footer at ${width} px, ${motion} (bar top ${fit.barTop.toFixed(1)}, footer bottom ${fit.footBottom.toFixed(1)})`);
  ok(fit.barH <= 30.5, `the marquee bar keeps its height at ${width} px, ${motion} (${fit.barH.toFixed(1)} px)`);
  {
    const board = await page.evaluate(() => {
      const el = document.getElementById("marketBoard");
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { mid: r.left + r.width / 2, left: r.left, right: r.right, transform: cs.transform, markets: el.querySelectorAll(".market").length, eyebrow: document.querySelectorAll(".hero__eyebrow").length };
    });
    ok(board.markets > 0, `the market board carries its markets at ${width} px, ${motion}`);
    ok(Math.abs(board.mid - width / 2) <= 1, `the market board sits on the page's centre line at ${width} px, ${motion} (centre ${board.mid.toFixed(1)} of ${width / 2})`);
    ok(board.left >= 0 && board.right <= width, `and inside the viewport (${board.left.toFixed(1)} to ${board.right.toFixed(1)})`);
    const shift = board.transform === "none" ? 0 : Number((/^matrix\(([^)]+)\)$/.exec(board.transform) || [, "0,0,0,0,NaN,0"])[1].split(",")[4]);
    eq(shift, 0, `the board is centred by its margins: no transform moves it sideways, so an entrance animation cannot draw it against a stale width, at ${width} px, ${motion} (${board.transform})`);
    eq(board.eyebrow, 0, `the hero carries no eyebrow line above its title at ${width} px`);
  }
  {
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

const mulberry = (seed) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const solveQR = (xs, ys, zs) => {
  const n = xs.length;
  const A = Array.from({ length: n }, (_, i) => [1, xs[i], zs[i], ys[i]]);
  for (let k = 0; k < 3; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm += A[i][k] * A[i][k];
    norm = Math.sqrt(norm);
    const v = new Float64Array(n);
    for (let i = k; i < n; i++) v[i] = A[i][k];
    v[k] -= A[k][k] > 0 ? -norm : norm;
    let vv = 0;
    for (let i = k; i < n; i++) vv += v[i] * v[i];
    if (!(vv > 0)) continue;
    for (let j = k; j < 4; j++) {
      let dot = 0;
      for (let i = k; i < n; i++) dot += v[i] * A[i][j];
      const f = 2 * dot / vv;
      for (let i = k; i < n; i++) A[i][j] -= f * v[i];
    }
  }
  const c = A[2][3] / A[2][2];
  const b = (A[1][3] - A[1][2] * c) / A[1][1];
  const a = (A[0][3] - A[0][1] * b - A[0][2] * c) / A[0][0];
  return [a, b, c];
};

const project = (cam, x, y, z) => {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const x1 = x * cy - z * sy, z1 = z * cy + x * sy;
  const depth = z1 * cp + y * sp + cam.dist;
  const k = cam.fov / depth;
  return { x: cam.cx + x1 * k, y: cam.cy + (y * cp - z1 * sp) * k, depth };
};

const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const failsWith = async (run, what) => {
  let failed = null;
  try { await run(); } catch (err) { failed = err; }
  if (failed && process.env.LM_SHOW) console.log(`  planted: ${what}\n    caught by: ${failed.message.split("\n")[0].slice(0, 220)}`);
  ok(failed !== null && failed.code === "ERR_ASSERTION", `a planted wrong build fails its check: ${what}${failed && failed.code !== "ERR_ASSERTION" ? " (it broke for another reason: " + failed.message + ")" : ""}`);
};

const fieldTest = (src) => {
  const box = {};
  vm.createContext(box);
  vm.runInContext(src, box);
  return box.__FieldTest;
};

{
  const pure = fieldTest(PARTICLES);
  ok(pure && typeof pure.fitPlane === "function" && Object.isFrozen(pure), "where there is no document the script binds its pure functions as __FieldTest and does nothing else");
  eq(PARTICLES.split("__FieldTest").length - 1, 1, "the hook is bound once, in the branch that has no document");

  const cloud = (seed, n, shift) => {
    const rnd = mulberry(seed);
    const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 200 + 1100 * rnd(), t = rnd() * Math.PI * 2;
      xs[i] = shift + r * Math.cos(t);
      zs[i] = r * Math.sin(t) - shift / 2;
      ys[i] = 12 + 0.11 * xs[i] - 0.07 * zs[i] + (rnd() - 0.5) * 180 + (rnd() < 0.1 ? (rnd() - 0.5) * 900 : 0);
    }
    return { xs, ys, zs, n };
  };
  const CLOUDS = [cloud(11, 1200, 0), cloud(12, 900, 800), cloud(13, 3, 0), cloud(14, 40, -2500), cloud(15, 2200, 300)];
  const fitsLikeQR = (fit) => {
    let worst = 0;
    for (const { xs, ys, zs, n } of CLOUDS) {
      const out = new Float64Array(3);
      assert.equal(fit(xs, ys, zs, n, out), true, `the fit solves a cloud of ${n} points`);
      const want = solveQR(xs, ys, zs);
      for (let k = 0; k < 3; k++) {
        const gap = Math.abs(out[k] - want[k]) / Math.max(1, Math.abs(want[k]));
        worst = Math.max(worst, gap);
        assert.ok(gap <= 1e-6, `coefficient ${k} of the plane over ${n} seeded points is ${out[k]}, and an independent Householder QR solve gives ${want[k]}`);
      }
    }
    return worst;
  };
  const worst = fitsLikeQR(pure.fitPlane);
  checks += CLOUDS.length * 4;
  ok(worst <= 1e-6, `the fitted plane equals an independent least-squares solve (Householder QR of [1, x, z]) on ${CLOUDS.length} seeded clouds, worst relative gap ${worst.toExponential(2)}`);

  {
    const { xs, ys, zs, n } = CLOUDS[0];
    const out = new Float64Array(3);
    pure.fitPlane(xs, ys, zs, n, out);
    let e = 0, ex = 0, ez = 0, scale = 0;
    for (let i = 0; i < n; i++) {
      const r = ys[i] - out[0] - out[1] * xs[i] - out[2] * zs[i];
      e += r; ex += r * xs[i]; ez += r * zs[i]; scale += Math.abs(r);
    }
    ok(Math.abs(e) < 1e-6 * scale && Math.abs(ex) < 1e-6 * scale * 1300 && Math.abs(ez) < 1e-6 * scale * 1300, `the residuals of the fit are orthogonal to the constant and to both regressors (sums ${e.toExponential(1)}, ${ex.toExponential(1)}, ${ez.toExponential(1)})`);
    const exact = new Float64Array(3);
    const px = [0, 1, 0, 1, 2, -3], pz = [0, 0, 1, 1, 3, 5], py = px.map((x, i) => 3 + 0.25 * x - 0.5 * pz[i]);
    ok(pure.fitPlane(px, py, pz, 6, exact) && Math.abs(exact[0] - 3) < 1e-12 && Math.abs(exact[1] - 0.25) < 1e-12 && Math.abs(exact[2] + 0.5) < 1e-12, `points that lie on y = 3 + 0.25x - 0.5z give that plane back (${Array.from(exact).join(", ")})`);
    const kept = new Float64Array([7, 8, 9]);
    eq(pure.fitPlane([1, 2], [1, 2], [3, 4], 2, kept), false, "two points do not fix a plane");
    eq(pure.fitPlane([0, 1, 2, 3], [5, 1, 2, 8], [0, 2, 4, 6], 4, kept), false, "points on one line in the horizontal plane do not fix a plane");
    eq(Array.from(kept).join(","), "7,8,9", "a refused fit leaves the last plane untouched");
  }

  for (const [what, pairs] of [
    ["a wrong cofactor in the normal equations", [["const c12 = sx * sz - n * sxz;", "const c12 = sx * sz + n * sxz;"]]],
    ["the mean in place of the intercept", [["out[0] = (c00 * sy + c01 * sxy + c02 * szy) / det;", "out[0] = sy / n;"]]],
    ["the cross product of the two regressors dropped", [["sxx += x * x; sxz += x * z; szz += z * z;", "sxx += x * x; szz += z * z;"]]],
  ]) {
    const wrong = fieldTest(plant(PARTICLES, pairs, what));
    await failsWith(() => fitsLikeQR(wrong.fitPlane), `${what} is not the least-squares plane`);
  }

  const depthLaw = (t) => {
    const focus = 1080;
    assert.equal(t.blurOf(focus, focus), 0, "a particle on the focal plane has no blur");
    let last = 0;
    for (let d = focus; d <= 3200; d += 40) { const b = t.blurOf(d, focus); assert.ok(b >= last, `blur grows behind the focal plane (${b} at ${d})`); last = b; }
    assert.ok(last > 2, `a particle far behind the focal plane is blurred by more than two pixels (${last})`);
    last = 0;
    for (let d = focus; d >= 80; d -= 20) { const b = t.blurOf(d, focus); assert.ok(b >= last, `blur grows in front of the focal plane (${b} at ${d})`); last = b; }
    assert.ok(t.blurOf(focus - 600, focus) > t.blurOf(focus + 600, focus), "at equal distances the near side blurs more than the far side, as a lens does");
    assert.ok(t.blurOf(70, focus) <= 20.0001 && t.blurOf(70, focus) >= t.blurOf(3200, focus), "the blur is capped");
    assert.equal(t.fogOf(200, focus), 1, "a near particle is not fogged");
    last = 1;
    for (let d = 200; d <= 4000; d += 50) { const f = t.fogOf(d, focus); assert.ok(f <= last && f > 0, `fog only dims with distance and never to nothing (${f} at ${d})`); last = f; }
    assert.ok(t.fogOf(focus + 1500, focus) < 0.6 * t.fogOf(focus, focus), "a particle far behind the focal plane keeps less than 0.6 of the light of one on it");
  };
  depthLaw(pure);
  checks += 6;
  await failsWith(() => depthLaw(fieldTest(plant(PARTICLES, [["const c = APERTURE * Math.abs(depth - focus) / depth;", "const c = 0;"]], "no depth of field"))), "no blur away from the focal plane");
  await failsWith(() => depthLaw(fieldTest(plant(PARTICLES, [["return f > 1 ? 1 : f < FOG_FLOOR ? FOG_FLOOR : f;", "return 1;"]], "no fog"))), "no fog with distance");

  const dollyLaw = (t) => {
    assert.equal(t.dollyAt(0), 0, "the dolly starts at 0");
    assert.equal(t.dollyAt(t.DOLLY_MS), 1, "the dolly is exactly at rest when its time is up");
    assert.equal(t.dollyAt(t.DOLLY_MS * 40), 1, "and stays exactly there");
    let last = 0;
    for (let ms = 0; ms <= t.DOLLY_MS; ms += 10) { const e = t.dollyAt(ms); assert.ok(e >= last && e <= 1, `the dolly only moves in (${e} at ${ms} ms)`); last = e; }
    const first = t.dollyAt(100) - t.dollyAt(0), mid = t.dollyAt(t.DOLLY_MS / 2 + 50) - t.dollyAt(t.DOLLY_MS / 2 - 50), end = 1 - t.dollyAt(t.DOLLY_MS - 100);
    assert.ok(first < mid / 8 && end < mid / 8, `the dolly is eased at both ends (${first.toFixed(4)}, ${mid.toFixed(4)}, ${end.toFixed(4)} over 100 ms at the start, the middle and the end)`);
    assert.ok(t.DOLLY_MS >= 1500 && t.DOLLY_MS <= 2500, `the dolly lasts about two seconds (${t.DOLLY_MS} ms)`);
  };
  dollyLaw(pure);
  checks += 5;
  await failsWith(() => dollyLaw(fieldTest(plant(PARTICLES, [["if (!(ms < DOLLY_MS)) return 1;", "if (!(ms < DOLLY_MS)) return 0.999;"]], "a dolly that never rests"))), "a dolly that stops short of rest");
  await failsWith(() => dollyLaw(fieldTest(plant(PARTICLES, [["return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;", "return t;"]], "a linear dolly"))), "a dolly with no easing");
}

const sceneOf = (page) => page.evaluate(() => {
  const f = window.__field, lm = window.__lm, last = lm.fills, s = f.state;
  const g = f.atlas.getContext("2d");
  const cells = {};
  const sprites = lm.sprites.filter((d) => d[0] === last).map((d) => d.slice(1));
  for (const d of sprites) {
    const key = d[0] + "," + d[1] + "," + d[2];
    if (cells[key]) continue;
    const size = d[2], px = g.getImageData(d[0], d[1], size, size).data;
    let peak = 0, sum = 0, half = 0;
    for (let i = 3; i < px.length; i += 4) { sum += px[i] / 255; if (px[i] / 255 > peak) peak = px[i] / 255; }
    for (let i = 3; i < px.length; i += 4) if (px[i] / 255 >= peak / 2) half++;
    cells[key] = { peak, area: sum / peak, halfRadius: Math.sqrt(half / Math.PI), fill: sum / peak / (Math.PI * size * size / 4) };
  }
  return {
    passes: last, draws: lm.draws, foreign: lm.foreign, attached: f.atlas.isConnected, sprites, cells,
    lines: lm.lines.filter((l) => l.pass === last),
    x: Array.from(f.pX), y: Array.from(f.pY), z: Array.from(f.pZ), lum: Array.from(f.pLum), brightest: Array.from(f.brightest), plane: Array.from(f.plane),
    cam: { yaw: s.yaw, pitch: s.pitch, dist: s.dist, fov: s.fov, cx: s.cx, cy: s.cy, focus: s.focus, intro: s.intro, scroll: s.scroll },
    zone: { ...f.zone },
    grid: { R: f.GRID_R, step: f.GRID_STEP, n: f.GRID_N, seg: f.GRID_SEG, rim: f.RIM_SEG, color: f.GRID_COLOR, resid: f.RESID_COLOR },
    rest: f.REST_DIST, restPitch: f.REST_PITCH, dollyMs: f.DOLLY_MS,
  };
});

const readScene = (scene) => {
  const { cam, cells, zone } = scene;
  const fit = solveQR(scene.x, scene.y, scene.z);
  const pts = scene.x.map((x, i) => project(cam, x, scene.y[i], scene.z[i]));
  const used = new Uint8Array(scene.sprites.length);
  const centre = scene.sprites.map((d) => [d[3] + d[5] / 2, d[4] + d[6] / 2]);
  const claim = (x, y, tol) => {
    for (let k = 0; k < centre.length; k++) if (!used[k] && Math.abs(centre[k][0] - x) < tol && Math.abs(centre[k][1] - y) < tol) { used[k] = 1; return k; }
    return -1;
  };
  const feet = scene.brightest.map((i) => {
    const p = project(cam, scene.x[i], fit[0] + fit[1] * scene.x[i] + fit[2] * scene.z[i], scene.z[i]);
    return { i, x: p.x, y: p.y, draw: claim(p.x, p.y, 0.05) };
  });
  const rows = [];
  let blooms = 0;
  pts.forEach((p, i) => {
    const k = claim(p.x, p.y, 0.03);
    if (k < 0) return;
    if (claim(p.x, p.y, 0.03) >= 0) blooms++;
    const d = scene.sprites[k], cell = cells[d[0] + "," + d[1] + "," + d[2]], scale = d[5] / d[2];
    const capped = Math.abs(p.x - zone.x) - zone.hw < 95 && Math.abs(p.y - zone.y) - zone.hh < 95;
    rows.push({ i, depth: p.depth, off: (p.depth - cam.focus) / p.depth, size: cell.halfRadius * scale, spread: cell.area * scale * scale, fill: cell.fill, light: d[7] * cell.peak / scene.lum[i], column: d[0], capped: zone.on && capped });
  });
  return { fit, pts, feet, rows, blooms, stray: used.reduce((a, u) => a + (u ? 0 : 1), 0) };
};

const depthCues = (scene) => {
  const { rows, stray } = readScene(scene);
  assert.equal(stray, 0, `every sprite drawn is a particle, its bloom or the foot of a residual line (${stray} are none of them)`);
  assert.equal(scene.foreign, 0, "every sprite comes from the one pre-rendered sheet");
  assert.equal(scene.attached, false, "the sprite sheet is drawn once, off the page");
  const kinds = Object.keys(scene.cells).length;
  assert.ok(kinds >= 6 && kinds <= 40, `the particles are drawn from a small set of pre-rendered sprites (${kinds} in use)`);
  const sharp = rows.filter((r) => Math.abs(r.off) < 0.03), far = rows.filter((r) => r.off > 0.3), near = rows.filter((r) => r.off < -0.5);
  assert.ok(sharp.length >= 8 && far.length >= 40 && near.length >= 8, `the still frame holds particles in focus, far behind and near in front (${sharp.length}, ${far.length}, ${near.length})`);
  const of = (list, key) => mean(list.map((r) => r[key]));
  const lit = (list) => mean(list.filter((r) => !r.capped).map((r) => r.light));
  const figures = { size: [of(sharp, "size"), of(far, "size"), of(near, "size")], spread: [of(sharp, "spread"), of(far, "spread"), of(near, "spread")], fill: [of(sharp, "fill"), of(far, "fill"), of(near, "fill")], light: [lit(sharp), lit(far), lit(near)] };
  assert.ok(figures.size[1] > 1.3 * figures.size[0], `a far particle is drawn larger than one in focus (radius at half its peak ${figures.size[1].toFixed(2)} px against ${figures.size[0].toFixed(2)} px)`);
  assert.ok(figures.size[2] > 3 * figures.size[0], `a near particle is drawn far larger than one in focus (${figures.size[2].toFixed(2)} px against ${figures.size[0].toFixed(2)} px)`);
  assert.ok(figures.light[1] < 0.5 * figures.light[0], `a far particle is drawn dimmer than one in focus (peak ${figures.light[1].toFixed(3)} of its own brightness against ${figures.light[0].toFixed(3)})`);
  assert.ok(figures.spread[1] > 1.5 * figures.spread[0] && figures.spread[2] > 8 * figures.spread[0], `the light of a particle is spread wider the further it sits from the focal plane (${figures.spread.map((v) => v.toFixed(0)).join(", ")} px² in focus, far and near)`);
  assert.ok(figures.fill[1] > 1.5 * figures.fill[0] && figures.fill[2] > 1.5 * figures.fill[0], `and it is drawn from a softer sprite (the sprite's light fills ${figures.fill.map((v) => v.toFixed(2)).join(", ")} of its cell in focus, far and near)`);
  const bins = [[0.03, 0.15], [0.15, 0.3], [0.3, 0.45], [0.45, 0.75]].map(([lo, hi]) => rows.filter((r) => r.off >= lo && r.off < hi));
  assert.ok(bins.every((b) => b.length >= 8), `there are particles at every depth behind the focal plane (${bins.map((b) => b.length).join(", ")})`);
  for (let k = 1; k < bins.length; k++) {
    assert.ok(of(bins[k], "size") > of(bins[k - 1], "size"), `size grows with every step behind the focal plane (${bins.map((b) => of(b, "size").toFixed(2)).join(", ")} px)`);
    assert.ok(lit(bins[k]) < lit(bins[k - 1]), `brightness falls with every step behind the focal plane (${bins.map((b) => lit(b).toFixed(3)).join(", ")})`);
  }
  const columns = [...new Set(rows.map((r) => r.column))].map((column) => {
    const same = rows.filter((r) => r.column === column && !r.capped);
    return { front: same.filter((r) => r.off < -0.05), back: same.filter((r) => r.off > 0.05) };
  }).filter((c) => c.front.length >= 8 && c.back.length >= 8);
  assert.ok(columns.length >= 2, `at least two softness levels are drawn on both sides of the focal plane (${columns.length})`);
  for (const c of columns) assert.ok(of(c.back, "light") < 0.9 * of(c.front, "light"), `at equal softness a particle behind the focal plane is dimmer than one in front of it: fog (${of(c.back, "light").toFixed(3)} against ${of(c.front, "light").toFixed(3)})`);
  return figures;
};

const fittedPlane = (scene) => {
  const { fit, pts, feet } = readScene(scene);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  for (let k = 0; k < 3; k++) assert.ok(near(scene.plane[k], fit[k], 1e-6 * Math.max(1, Math.abs(fit[k]))), `coefficient ${k} of the plane the page drew is ${scene.plane[k]}; an independent least-squares solve on the page's own particles gives ${fit[k]}`);
  assert.ok(Math.abs(fit[1]) + Math.abs(fit[2]) > 0.05, `the cloud's plane is tilted, so a flat grid would not pass for it (slopes ${fit[1].toFixed(4)}, ${fit[2].toFixed(4)})`);
  const { R, step, n, seg, rim, color, resid } = scene.grid;
  const at = (x, z) => project(scene.cam, x, fit[0] + fit[1] * x + fit[2] * z, z);
  const want = [];
  for (let axis = 0; axis < 2; axis++) for (let k = -n; k <= n; k++) {
    const u = k * step, half = Math.sqrt(R * R - u * u);
    let prev = null;
    for (let m = 0; m <= seg; m++) {
      const v = -half + (2 * half * m) / seg;
      const p = axis ? at(v, u) : at(u, v);
      if (prev) want.push([prev, p]);
      prev = p;
    }
  }
  let prev = null;
  for (let m = 0; m <= rim; m++) {
    const t = (m / rim) * Math.PI * 2, p = at(R * Math.cos(t), R * Math.sin(t));
    if (prev) want.push([prev, p]);
    prev = p;
  }
  const drawn = [];
  for (const line of scene.lines.filter((l) => l.style === color)) for (let k = 0; k + 3 < line.pts.length; k += 4) drawn.push(line.pts.slice(k, k + 4));
  assert.ok(drawn.length >= 0.95 * want.length && drawn.length <= want.length, `the grid is drawn as ${drawn.length} segments of the ${want.length} a ${2 * n + 1} by ${2 * n + 1} grid on a disc and its rim have`);
  const taken = new Uint8Array(want.length);
  let off = 0;
  for (const [x1, y1, x2, y2] of drawn) {
    const hit = want.findIndex(([a, b], k) => !taken[k] && ((near(a.x, x1, 0.05) && near(a.y, y1, 0.05) && near(b.x, x2, 0.05) && near(b.y, y2, 0.05)) || (near(b.x, x1, 0.05) && near(b.y, y1, 0.05) && near(a.x, x2, 0.05) && near(a.y, y2, 0.05))));
    if (hit < 0) off++; else taken[hit] = 1;
  }
  assert.equal(off, 0, `every grid segment drawn lies on the least-squares plane of the cloud, in perspective (${off} of ${drawn.length} do not)`);
  const floor = Math.min(...scene.brightest.map((i) => scene.lum[i]));
  assert.ok(scene.lum.every((v, i) => v <= floor || scene.brightest.includes(i)), "the residual lines belong to the brightest particles");
  const stems = [];
  for (const line of scene.lines.filter((l) => l.style === resid)) for (let k = 0; k + 3 < line.pts.length; k += 4) stems.push(line.pts.slice(k, k + 4));
  assert.ok(stems.length >= 3 && stems.length <= scene.brightest.length, `a few residual lines are drawn (${stems.length} of at most ${scene.brightest.length})`);
  for (const [x1, y1, x2, y2] of stems) {
    const foot = feet.find((f) => near(pts[f.i].x, x1, 0.05) && near(pts[f.i].y, y1, 0.05) && near(f.x, x2, 0.05) && near(f.y, y2, 0.05));
    assert.ok(foot, `a residual line runs from one of the brightest particles straight to the fitted plane (${x1.toFixed(1)}, ${y1.toFixed(1)} to ${x2.toFixed(1)}, ${y2.toFixed(1)})`);
  }
  return { fit, grid: drawn.length, stems: stems.length };
};

const stillScene = async (source, what) => {
  const { context, page, errors } = await open("reduce", { width: 1280, height: 800 }, { particles: probed(source), seeded: true, record: true });
  await page.waitForFunction(() => window.__field && window.__lm.fills >= 8);
  const scene = await sceneOf(page);
  assert.equal(errors.join(" | "), "", `no page error drawing ${what}`);
  await context.close();
  return scene;
};

{
  const scene = await stillScene(PARTICLES, "the recorded still frame");
  eq(scene.passes, 8, "the still frame is eight passes of one frame");
  const cues = depthCues(scene);
  checks += 14;
  ok(cues.size[1] > cues.size[0], `depth of field, read from the draw calls of the still frame: in focus ${cues.size[0].toFixed(2)} px wide at half height and ${cues.light[0].toFixed(3)} bright, far ${cues.size[1].toFixed(2)} px and ${cues.light[1].toFixed(3)}, near ${cues.size[2].toFixed(2)} px and ${cues.light[2].toFixed(3)}`);
  const plane = fittedPlane(scene);
  checks += 8;
  ok(plane.grid > 300 && plane.stems >= 3, `the grid (${plane.grid} segments) and the ${plane.stems} residual lines are drawn on the plane an independent solve fits to the page's own ${scene.x.length} particles: y = ${plane.fit[0].toFixed(2)} + ${plane.fit[1].toFixed(4)}x + ${plane.fit[2].toFixed(4)}z`);
  eq(scene.cam.dist, scene.rest, "under reduced motion the still frame is drawn with the camera where the dolly ends");
  eq(scene.cam.intro, scene.dollyMs, "and with the dolly already over, so no frame is owed to it");
  eq(scene.cam.pitch, scene.restPitch, "at the resting pitch");
  eq(scene.cam.scroll, 0, "and unscrolled");

  for (const [what, pairs, check] of [
    ["no depth of field: every particle keeps its perspective size", [["const blur = blurOf(depth, focus) * unit;", "const blur = 0;"]], depthCues],
    ["no fog: brightness does not fall with distance", [["let a = pLum[i] * fogOf(depth, focus) *", "let a = pLum[i] *"]], depthCues],
    ["one sharp sprite at every depth", [["let level = (soft * LEVELS) | 0;", "let level = 0;"]], depthCues],
    ["a grid on a flat plane that was never fitted", [["    fitPlane(pX, pY, pZ, COUNT, plane);\n", ""]], fittedPlane],
    ["a flat grid under a correct fit", [["    const a = plane[0], b = plane[1], c = plane[2];\n    const focus = state.focus, unit = state.unit;\n    for (let axis = 0;", "    const a = 0, b = 0, c = 0;\n    const focus = state.focus, unit = state.unit;\n    for (let axis = 0;"]], fittedPlane],
    ["a grid on the plane of half the cloud", [["fitPlane(pX, pY, pZ, COUNT, plane);", "fitPlane(pX, pY, pZ, COUNT >> 1, plane);"]], fittedPlane],
    ["residual lines from the first particles, not the brightest", [["sort((a, b) => pLum[b] - pLum[a] || a - b)", "sort((a, b) => a - b)"]], fittedPlane],
    ["residual lines that stop short of the plane", [["if (!project(pX[i], a + b * pX[i] + c * pZ[i], pZ[i])) continue;", "if (!project(pX[i], (pY[i] + a + b * pX[i] + c * pZ[i]) / 2, pZ[i])) continue;"]], fittedPlane],
    ["a still frame drawn mid-dolly", [["intro: calm ? DOLLY_MS : 0,", "intro: 0,"]], (s) => assert.equal(s.cam.dist, s.rest, "the still frame is drawn at rest")],
  ]) {
    const wrong = await stillScene(plant(PARTICLES, pairs, what), `the planted build (${what})`);
    await failsWith(() => check(wrong), what);
  }
}

const steppedPage = async (source, { viewport = { width: 1280, height: 800 }, record = false, mute = true } = {}) => {
  const opened = await open("no-preference", viewport, { particles: probed(source, { record, hold: true, mute }), seeded: true, record });
  await opened.page.waitForFunction(() => !!window.__field);
  await opened.page.evaluate(() => {
    const f = window.__field;
    let t = performance.now();
    window.__step = (n) => { for (let i = 0; i < n; i++) { t += 1000 / 60; f.renderFrame(t); } };
    window.__cam = () => { const s = f.state; return { yaw: s.yaw, pitch: s.pitch, dist: s.dist, intro: s.intro, scroll: s.scroll, target: s.scrollTarget, cy: s.cy / s.height, lead: s.yaw - s.baseYaw - s.dragYaw, drag: s.dragYaw, tilt: s.dragPitch, held: s.held, observed: s.isObserved, parX: s.parX, parY: s.parY, flick: s.flick, spread: s.spread }; };
  });
  return opened;
};
const step = (page, n) => page.evaluate((count) => window.__step(count), n);
const cam = (page) => page.evaluate(() => window.__cam());
const consts = (page) => page.evaluate(() => { const f = window.__field; return { rest: f.REST_DIST, restPitch: f.REST_PITCH, dollyMs: f.DOLLY_MS, pull: f.DOLLY_PULL, scrollPitch: f.SCROLL_PITCH, scrollPull: f.SCROLL_PULL, parYaw: f.PAR_YAW, orbit: f.ORBIT_YAW }; });
const scrollTo = async (page, share) => {
  await page.evaluate((k) => window.scrollTo({ top: k * (document.documentElement.scrollHeight - innerHeight), behavior: "instant" }), share);
  const heard = await page.waitForFunction((k) => Math.abs(window.__field.state.scrollTarget - k) < 0.01, share, { timeout: 2000 }).then(() => true, () => false);
  assert.ok(heard, `the camera hears the page scroll to ${share} of its runway`);
};
const touchRule = async (page) => {
  const style = await page.$eval("#field", (el) => getComputedStyle(el).touchAction);
  assert.ok(/pan-y/.test(style) && !/pan-x|none|manipulation/.test(style), `the canvas leaves vertical swipes to the page and keeps horizontal ones for the orbit (touch-action: ${style})`);
};

const dollyRun = async (page) => {
  const K = await consts(page);
  await step(page, 1);
  const first = await cam(page);
  assert.ok(first.dist > K.rest * (1 + 0.95 * K.pull), `the first frame is drawn from far back (${first.dist.toFixed(0)} against a resting ${K.rest})`);
  let last = first.dist;
  const track = [];
  for (let n = 0; n < 12; n++) {
    await step(page, 10);
    const c = await cam(page);
    assert.ok(c.dist <= last + 1e-9, `the camera only moves in during the dolly (${c.dist.toFixed(1)} after ${last.toFixed(1)})`);
    last = c.dist;
    track.push(c.dist);
  }
  assert.ok(track[5] < first.dist - 0.3 * (first.dist - K.rest) && track[5] > K.rest + 0.2 * (first.dist - K.rest), `one second in the camera is part of the way (${track[5].toFixed(0)})`);
  await step(page, 5);
  const done = await cam(page);
  assert.equal(done.intro, K.dollyMs, `the dolly is over after ${K.dollyMs} ms of frames`);
  assert.equal(done.dist, K.rest, "and the camera is exactly at its resting distance");
  await step(page, 240);
  const later = await cam(page);
  assert.equal(later.dist, K.rest, "four seconds later the camera has not left its resting distance");
  assert.ok(Math.abs(later.pitch - K.restPitch) < 0.08 && Math.abs(later.lead) < 0.06, `and its swing and tilt have settled (pitch ${later.pitch.toFixed(3)} against ${K.restPitch}, yaw ${later.lead.toFixed(3)} behind its drift)`);
  return { from: first.dist, to: later.dist };
};

const scrollRun = async (page) => {
  const K = await consts(page);
  const runway = await page.evaluate(() => (document.documentElement.scrollHeight - innerHeight) / innerHeight);
  assert.ok(runway > 0.5, `the page scrolls: ${runway.toFixed(2)} viewports of runway under the hero`);
  const box = () => page.$eval(".hero__title", (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => v.toFixed(2)).join(","); });
  await page.evaluate(() => document.querySelectorAll(".hero > *").forEach((el) => el.getAnimations().forEach((a) => a.finish())));
  const before = await cam(page), placed = await box();
  await scrollTo(page, 1);
  await step(page, 2);
  const start = await cam(page);
  assert.ok(start.scroll > 0 && start.scroll < 0.2, `the camera does not jump to the scroll position, it is carried there (${start.scroll.toFixed(3)} of the way after two frames)`);
  await step(page, 240);
  const end = await cam(page);
  assert.ok(end.scroll > 0.99 && end.scroll < 1.01, `the camera follows the scroll to its end (${end.scroll.toFixed(4)})`);
  assert.ok(Math.abs(end.pitch - before.pitch - K.scrollPitch) < 0.13, `scrolled to the end the field has tilted by about ${K.scrollPitch} rad (${(end.pitch - before.pitch).toFixed(3)})`);
  assert.ok(Math.abs(end.dist / before.dist - 1 - K.scrollPull) < 0.01, `and receded to ${(1 + K.scrollPull).toFixed(2)} times its distance (${(end.dist / before.dist).toFixed(3)})`);
  assert.equal(await box(), placed, "the hero has not moved: the scroll moves the camera, not the copy");
  await scrollTo(page, 0.5);
  await step(page, 240);
  const half = await cam(page);
  assert.ok(half.pitch > before.pitch + 0.15 && half.pitch < end.pitch - 0.15 && half.dist > before.dist * 1.05 && half.dist < end.dist * 0.95, `half way down it is half way there (pitch ${half.pitch.toFixed(3)}, distance ${half.dist.toFixed(0)})`);
  await scrollTo(page, 0);
  await step(page, 300);
  const back = await cam(page);
  assert.ok(Math.abs(back.dist / before.dist - 1) < 0.005 && Math.abs(back.pitch - before.pitch) < 0.12, `scrolled back the camera returns (distance ${back.dist.toFixed(1)}, pitch ${back.pitch.toFixed(3)})`);
  return { tilt: end.pitch - before.pitch, pull: end.dist / before.dist };
};

const parallaxRun = async (page, size) => {
  const K = await consts(page);
  await page.mouse.move(size.width / 2, size.height / 2);
  await step(page, 240);
  const rest = await cam(page);
  await page.mouse.move(size.width - 2, size.height / 2);
  const aimed = await cam(page);
  assert.ok(aimed.parX > 0.9, `the pointer at the right edge asks for the full parallax (${aimed.parX.toFixed(3)})`);
  const moves = [];
  let prev = rest.lead;
  for (let n = 0; n < 8; n++) {
    await step(page, 1);
    const c = await cam(page);
    moves.push(Math.abs(c.lead - prev));
    prev = c.lead;
  }
  const want = -aimed.parX * K.parYaw;
  assert.ok(moves[0] < moves[3] && moves[3] < moves[7], `the camera gathers speed: it has weight (${moves.map((m) => m.toFixed(5)).join(", ")} rad a frame)`);
  assert.ok(Math.abs(prev - rest.lead) < 0.35 * Math.abs(want), `after eight frames it has covered ${(100 * (prev - rest.lead) / want).toFixed(0)}% of the way, not all of it`);
  await step(page, 232);
  const there = await cam(page);
  assert.ok(Math.abs(there.lead - rest.lead - want) < 0.06 * Math.abs(want), `four seconds on it rests ${(there.lead - rest.lead).toFixed(4)} rad round, the ${want.toFixed(4)} the pointer asked for`);
  await page.mouse.move(size.width / 2, size.height / 2);
  await step(page, 240);
  return moves;
};

const dragRun = async (page, size) => {
  const K = await consts(page);
  const event = (type, x, y, more = {}) => page.evaluate(([t, cx, cy, extra]) => window.dispatchEvent(new PointerEvent(t, { pointerId: 9, pointerType: "touch", isPrimary: true, clientX: cx, clientY: cy, bubbles: true, ...extra })), [type, x, y, more]);
  const before = await cam(page);
  await event("pointerdown", 200, 300);
  await event("pointermove", 200, 380);
  const swiped = await cam(page);
  assert.ok(swiped.held && Math.abs(swiped.drag - before.drag) < 1e-9 && Math.abs(swiped.tilt - before.tilt) < 1e-9, `a vertical swipe does not orbit the field (yaw ${swiped.drag.toFixed(4)}, pitch ${swiped.tilt.toFixed(4)})`);
  await event("pointercancel", 200, 380);
  const released = await cam(page);
  assert.ok(!released.held && !released.observed, "when the browser takes the swipe to scroll the page, the field lets go");
  await event("pointerdown", 200, 300);
  await event("pointermove", 200 + size.width / 4, 300);
  const dragged = await cam(page);
  assert.ok(Math.abs(dragged.drag - before.drag - K.orbit / 4) < 1e-6, `a horizontal drag of a quarter of the width orbits a quarter of ${K.orbit.toFixed(3)} rad (${(dragged.drag - before.drag).toFixed(4)})`);
  assert.ok(dragged.observed, "and holds the field");
  await page.waitForTimeout(150);
  await event("pointerup", 200 + size.width / 4, 300);
  await step(page, 120);
  const after = await cam(page);
  assert.ok(!after.held && after.flick === 0 && Math.abs(after.drag - dragged.drag) < 1e-9 && Math.abs(after.lead) < 0.08, `a finger that rests before it lifts leaves the orbit where it put it, and two seconds on the camera has caught up (${after.lead.toFixed(3)} rad behind)`);
  await page.evaluate(([w]) => {
    const fire = (type, x) => window.dispatchEvent(new PointerEvent(type, { pointerId: 11, pointerType: "touch", isPrimary: true, clientX: x, clientY: 300, bubbles: true }));
    const wait = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
    fire("pointerdown", 300); wait(4); fire("pointermove", 300 + w / 8); wait(4); fire("pointerup", 300 + w / 8);
  }, [size.width]);
  const flung = await cam(page);
  assert.ok(flung.flick > 1, `a finger that lifts mid-drag throws the orbit (${flung.flick.toFixed(2)} rad a second)`);
  await step(page, 30);
  const gliding = await cam(page);
  assert.ok(gliding.drag > flung.drag + 0.3 && gliding.flick < flung.flick, `and the orbit glides on while it slows (${(gliding.drag - flung.drag).toFixed(3)} rad in half a second)`);
  await step(page, 360);
  const settled = await cam(page);
  assert.ok(settled.flick < 0.01, `until it comes to rest (${settled.flick.toExponential(1)} rad a second after six seconds)`);
  await touchRule(page);
  const stopped = await page.evaluate(() => { const e = new Event("touchstart", { bubbles: true, cancelable: true }); document.getElementById("field").dispatchEvent(e); return e.defaultPrevented; });
  assert.equal(stopped, false, "no listener cancels a touch on the canvas, so the page still scrolls under a finger");
};

const collapseRun = async (page) => {
  const spreadOf = () => page.evaluate(() => {
    const f = window.__field, [a, b, c] = f.plane;
    let sum = 0;
    for (let i = 0; i < f.COUNT; i++) { const r = f.pY[i] - a - b * f.pX[i] - c * f.pZ[i]; sum += r * r; }
    return Math.sqrt(sum / f.COUNT);
  });
  const loose = await spreadOf();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true, clientX: 40, clientY: 200, bubbles: true })));
  assert.equal((await cam(page)).observed, true, "pressing anywhere on the field holds it");
  await step(page, 240);
  const held = await spreadOf();
  assert.ok(held < 0.5 * loose, `held, the cloud collapses onto its own regression plane: the residuals shrink from ${loose.toFixed(1)} to ${held.toFixed(1)} (root mean square)`);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true, clientX: 40, clientY: 200, bubbles: true })));
  await step(page, 360);
  const freed = await spreadOf();
  assert.ok(freed > 0.75 * loose, `released, it spreads out again (${freed.toFixed(1)})`);
  return { loose, held, freed };
};

{
  const size = { width: 1280, height: 800 };
  const { context, page, errors } = await steppedPage(PARTICLES, { viewport: size });
  const dolly = await dollyRun(page);
  checks += 18;
  ok(dolly.to < dolly.from, `the dolly: the camera comes in from ${dolly.from.toFixed(0)} to ${dolly.to.toFixed(0)} over two seconds of frames, eased, and then holds its distance exactly`);
  const scrolled = await scrollRun(page);
  checks += 8;
  ok(scrolled.tilt > 0.4 && scrolled.pull > 1.2, `the scroll camera: over the runway the field tilts ${scrolled.tilt.toFixed(2)} rad and recedes to ${scrolled.pull.toFixed(2)} times its distance, and comes back`);
  const moves = await parallaxRun(page, size);
  checks += 4;
  ok(moves.length === 8, "pointer parallax is a sprung, damped move, not a jump");
  await dragRun(page, size);
  checks += 11;
  const squeeze = await collapseRun(page);
  checks += 3;
  ok(squeeze.held < squeeze.loose, "holding the field collapses it onto the fitted plane");
  eq(errors.join(" | "), "", "no page error across the dolly, the scroll, the pointer and a touch");
  await context.close();

  for (const [what, pairs, run] of [
    ["a dolly that never reaches rest", [["if (!(ms < DOLLY_MS)) return 1;", "if (!(ms < DOLLY_MS)) return 0.999;"]], dollyRun],
    ["a dolly that snaps in on the first frame", [["s.intro = Math.min(DOLLY_MS, s.intro + sec * 1000);", "s.intro = DOLLY_MS;"]], dollyRun],
    ["a camera deaf to the scroll", [['      window.addEventListener("scroll", readScroll, { passive: true });\n', ""]], async (p) => { await step(p, 250); return scrollRun(p); }],
    ["a camera that jumps to the scroll position", [["s.scroll += s.scrollV * sec;", "s.scroll = s.scrollTarget;"]], async (p) => { await step(p, 250); return scrollRun(p); }],
    ["a camera that tilts the wrong way on scroll", [["s.scroll * SCROLL_PITCH", "-s.scroll * SCROLL_PITCH"]], async (p) => { await step(p, 250); return scrollRun(p); }],
    ["a pointer parallax with no weight", [["      s.yawV += ((targetYaw - s.yaw) * SPRING - s.yawV * DAMP) * sec;\n      s.yaw += s.yawV * sec;", "      s.yaw = targetYaw;"]], async (p) => { await step(p, 250); return parallaxRun(p, size); }],
    ["a touch that orbits on a vertical swipe", [["if (!touch) state.dragPitch =", "state.dragPitch ="]], async (p) => { await step(p, 250); return dragRun(p, size); }],
    ["a canvas that swallows touches again", [['      document.documentElement.addEventListener("pointerleave"', '      canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });\n      document.documentElement.addEventListener("pointerleave"']], async (p) => { await step(p, 250); return dragRun(p, size); }],
    ["a hold that collapses nothing", [["(s.isObserved ? 0.12 : 1)", "1"]], async (p) => { await step(p, 250); return collapseRun(p); }],
  ]) {
    const wrong = await steppedPage(plant(PARTICLES, pairs, what), { viewport: size });
    await failsWith(() => run(wrong.page), what);
    await wrong.context.close();
  }
  {
    const wrong = await open("no-preference", size, { particles: probed(PARTICLES, { record: false, hold: true }), css: plant(HOME_CSS, [["  touch-action: pan-y pinch-zoom;", "  touch-action: none;"]], "a canvas that takes every touch") });
    await failsWith(() => touchRule(wrong.page), "a canvas whose touch-action takes vertical swipes from the page");
    await wrong.context.close();
  }
}

{
  const { context, page, errors } = await open("no-preference", { width: 1280, height: 800 }, { particles: probed(PARTICLES, { record: false }) });
  const early = await page.evaluate(() => ({ dist: window.__field.state.dist, rest: window.__field.REST_DIST, intro: window.__field.state.intro, over: window.__field.DOLLY_MS }));
  await page.waitForFunction(() => window.__field.state.intro >= window.__field.DOLLY_MS, null, { timeout: 20000 });
  const done = await page.evaluate(() => ({ dist: window.__field.state.dist, rest: window.__field.REST_DIST }));
  eq(done.dist, done.rest, `left to its own loop the dolly ends with the camera exactly at rest (${done.dist})`);
  await page.waitForTimeout(400);
  eq(await page.evaluate(() => window.__field.state.dist), done.rest, "and it stays there while the field keeps animating");
  ok(early.dist > early.rest || early.intro >= early.over, `it came in from further back (${early.dist.toFixed(0)} at ${early.intro.toFixed(0)} ms of the dolly)`);
  eq(errors.join(" | "), "", "no page error in the live dolly");
  await context.close();
}

{
  const { context, page, errors } = await open("reduce", { width: 1280, height: 800 }, { particles: probed(PARTICLES), seeded: true });
  await page.waitForFunction(() => window.__field && window.__lm.fills >= 8);
  const flat = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  eq(flat, 0, "under reduced motion the page has no runway: there is nothing for a scroll to move");
  const redrawn = async () => {
    await page.evaluate(() => { document.body.style.minHeight = "260vh"; });
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
    await page.waitForTimeout(500);
    return page.evaluate(() => ({ y: scrollY, fills: window.__lm.fills }));
  };
  const forced = await redrawn();
  ok(forced.y > 0, `the test forces a runway and scrolls it (${forced.y} px)`);
  eq(forced.fills, 8, "a scroll under reduced motion draws nothing: the still frame stands");
  eq(errors.join(" | "), "", "no page error scrolling under reduced motion");
  await context.close();

  const wrong = await open("reduce", { width: 1280, height: 800 }, { seeded: true, particles: probed(plant(PARTICLES, [
    ["    if (!calm) {\n      const onUI", "    if (true) {\n      const onUI"],
    ["state.scrollTarget = max > 1 ? clamp(window.scrollY / max, 0, 1) : 0;", "state.scrollTarget = max > 1 ? clamp(window.scrollY / max, 0, 1) : 0; if (calm && ready) still();"],
  ], "a still field that follows the scroll")) });
  await wrong.page.waitForFunction(() => window.__field && window.__lm.fills >= 8);
  await failsWith(async () => {
    await wrong.page.evaluate(() => { document.body.style.minHeight = "260vh"; });
    await wrong.page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
    await wrong.page.waitForTimeout(500);
    assert.equal(await wrong.page.evaluate(() => window.__lm.fills), 8, "a scroll under reduced motion draws nothing");
  }, "a field that redraws on scroll under reduced motion");
  await wrong.context.close();
}

{
  const { context, page, errors } = await open("no-preference", { width: 1280, height: 800 }, { particles: probed(PARTICLES) });
  const draws = () => page.evaluate(() => window.__lm.draws);
  const quiet = async (ms) => { const a = await draws(); await page.waitForTimeout(ms); return (await draws()) - a; };
  await page.waitForTimeout(600);
  ok((await quiet(500)) > 100, "the field is drawing while the tab is visible");
  const hide = (p, hidden) => p.evaluate((h) => {
    if (h) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    } else {
      delete document.hidden;
      delete document.visibilityState;
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await hide(page, true);
  await page.waitForTimeout(200);
  eq(await quiet(1300), 0, "nothing is drawn while the tab is hidden, across a tick of the watchdog");
  await hide(page, false);
  await page.waitForTimeout(300);
  ok((await quiet(500)) > 100, "drawing resumes when the tab is shown again");
  const shove = (p, away) => p.$eval("#field", (el, off) => { el.style.transform = off ? "translateY(-300vh)" : ""; }, away);
  await shove(page, true);
  await page.waitForTimeout(400);
  eq(await quiet(1300), 0, "nothing is drawn while the canvas is off screen");
  await shove(page, false);
  await page.waitForTimeout(500);
  ok((await quiet(500)) > 100, "drawing resumes when the canvas is back on screen");
  eq(errors.join(" | "), "", "no page error hiding and showing the field");
  await context.close();

  for (const [what, pairs, away] of [
    ["a loop that keeps drawing in a hidden tab", [["    if (!document.hidden && onScreen) {\n      requestAnimationFrame((t) => frame(t, token));", "    if (onScreen) {\n      requestAnimationFrame((t) => frame(t, token));"]], (p) => hide(p, true)],
    ["a loop that keeps drawing off screen", [["onScreen = entries[entries.length - 1].isIntersecting;", "onScreen = true;"]], (p) => shove(p, true)],
  ]) {
    const wrong = await open("no-preference", { width: 1280, height: 800 }, { particles: probed(plant(PARTICLES, pairs, what)) });
    await wrong.page.waitForTimeout(600);
    await failsWith(async () => {
      await away(wrong.page);
      await wrong.page.waitForTimeout(400);
      const a = await wrong.page.evaluate(() => window.__lm.draws);
      await wrong.page.waitForTimeout(1300);
      assert.equal((await wrong.page.evaluate(() => window.__lm.draws)) - a, 0, "nothing is drawn while the field cannot be seen");
    }, what);
    await wrong.context.close();
  }
}

const frameCost = async (source) => {
  const { context, page, errors } = await open("no-preference", { width: 1440, height: 900 }, { particles: probed(source, { record: false, hold: true }), seeded: true });
  await page.waitForFunction(() => !!window.__field);
  const out = await page.evaluate(async () => {
    const f = window.__field, W = f.state.width, H = f.state.height;
    const field = document.getElementById("field").getContext("2d");
    const board = document.createElement("canvas");
    board.width = W; board.height = H;
    const g = board.getContext("2d");
    const dot = document.createElement("canvas");
    dot.width = dot.height = 32;
    const dg = dot.getContext("2d");
    const glow = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    glow.addColorStop(0, "#ffffff"); glow.addColorStop(1, "rgba(218, 145, 0, 0)");
    dg.fillStyle = glow; dg.fillRect(0, 0, 32, 32);
    const xs = new Float32Array(4096);
    for (let i = 0; i < xs.length; i++) xs[i] = Math.sin(i * 0.37) * 300;
    const reference = () => {
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = 1;
      g.fillStyle = "rgba(0, 0, 0, 0.4)";
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "source-over";
      let sum = 0;
      for (let i = 0; i < 1500; i++) {
        const a = xs[i], b = xs[(i * 7) & 4095], c = xs[(i * 13) & 4095];
        const k = 700 / (Math.sqrt(a * a + b * b + c * c) + 900.1);
        sum += Math.sin(a * 0.01) * k;
        g.globalAlpha = 0.2 + (i & 7) * 0.05;
        const size = 8 + (i % 23);
        g.drawImage(dot, 0, 0, 32, 32, W / 2 + a * k * 2, H / 2 + b * k, size, size);
      }
      return sum;
    };
    const tick = () => new Promise((r) => requestAnimationFrame(r));
    const middle = (list) => list.slice().sort((a, b) => a - b)[list.length >> 1];
    const flush = () => { field.getImageData(0, 0, 1, 1); g.getImageData(0, 0, 1, 1); };
    let t = performance.now();
    for (let i = 0; i < 132; i++) { t += 1000 / 60; f.renderFrame(t); if (i % 3 === 2) { flush(); await tick(); } }
    for (let i = 0; i < 10; i++) { reference(); flush(); await tick(); }
    const runs = [];
    for (let r = 0; r < 2; r++) {
      const frame = [], ref = [];
      for (let i = 0; i < 40; i++) {
        await tick();
        t += 1000 / 60;
        const a = performance.now();
        if (i & 1) { f.renderFrame(t); const b = performance.now(); reference(); frame.push(b - a); ref.push(performance.now() - b); }
        else { reference(); const b = performance.now(); f.renderFrame(t); ref.push(b - a); frame.push(performance.now() - b); }
        flush();
      }
      runs.push({ frame: middle(frame), ref: middle(ref) });
    }
    const drawn = [], refDrawn = [];
    for (let i = 0; i < 16; i++) {
      await tick();
      t += 1000 / 60;
      const a = performance.now();
      if (i & 1) { f.renderFrame(t); field.getImageData(0, 0, 1, 1); const b = performance.now(); reference(); g.getImageData(0, 0, 1, 1); drawn.push(b - a); refDrawn.push(performance.now() - b); }
      else { reference(); g.getImageData(0, 0, 1, 1); const b = performance.now(); f.renderFrame(t); field.getImageData(0, 0, 1, 1); refDrawn.push(b - a); drawn.push(performance.now() - b); }
    }
    return { runs, drawn: middle(drawn), refDrawn: middle(refDrawn), count: f.COUNT };
  });
  assert.equal(errors.join(" | "), "", "no page error timing the frame");
  await context.close();
  const best = out.runs.reduce((a, b) => (a.frame / a.ref <= b.frame / b.ref ? a : b));
  return { ...out, frame: best.frame, ref: best.ref, ratio: best.frame / best.ref, raster: out.drawn / out.refDrawn };
};
const COST_LIMIT = 1.6, COST_FLOOR = 1.2, RASTER_LIMIT = 1.6, RASTER_FLOOR = 4;
const withinCost = (cost) => {
  assert.ok(cost.frame <= Math.max(COST_LIMIT * cost.ref, COST_FLOOR), `a frame costs ${cost.frame.toFixed(2)} ms of script time against ${cost.ref.toFixed(2)} ms for the reference workload, ratio ${cost.ratio.toFixed(2)}, over the limit of ${COST_LIMIT}`);
  assert.ok(cost.drawn <= Math.max(RASTER_LIMIT * cost.refDrawn, RASTER_FLOOR), `with the raster forced to finish a frame costs ${cost.drawn.toFixed(1)} ms against ${cost.refDrawn.toFixed(1)} ms for the reference, ratio ${cost.raster.toFixed(2)}, over the limit of ${RASTER_LIMIT}`);
};

let costLine = "";
{
  const cost = await frameCost(PARTICLES);
  withinCost(cost);
  checks += 2;
  costLine = `a frame of ${cost.count} particles at 1440x900 costs ${cost.frame.toFixed(2)} ms of script time (runs ${cost.runs.map((r) => r.frame.toFixed(2)).join(", ")} ms) against ${cost.ref.toFixed(2)} ms for the reference workload timed in the same animation frames, ratio ${cost.ratio.toFixed(2)} with a limit of ${COST_LIMIT} (4 ms would be a ratio of ${(4 / cost.ref).toFixed(2)} here); with the raster forced to finish ${cost.drawn.toFixed(1)} ms against ${cost.refDrawn.toFixed(1)} ms, ratio ${cost.raster.toFixed(2)} with a limit of ${RASTER_LIMIT}`;
  ok(cost.ratio > 0, costLine);
  for (const [what, pairs] of [
    ["every sprite recorded three times", [["      ctx.drawImage(atlas, spriteAt[level], row, px, px, x - half, y - half, half * 2, half * 2);\n", "      for (let again = 0; again < 3; again++) ctx.drawImage(atlas, spriteAt[level], row, px, px, x - half, y - half, half * 2, half * 2);\n"]]],
    ["the field blended with screen, which a software canvas cannot afford", [['    ctx.globalCompositeOperation = "source-over";\n\n    for (let i = 0; i < COUNT; i++) {', '    ctx.globalCompositeOperation = "screen";\n\n    for (let i = 0; i < COUNT; i++) {']]],
  ]) {
    const wrong = await frameCost(plant(PARTICLES, pairs, what));
    await failsWith(() => withinCost(wrong), `${what} (${wrong.frame.toFixed(2)} ms script, ratio ${wrong.ratio.toFixed(2)}; ${wrong.drawn.toFixed(1)} ms drawn, ratio ${wrong.raster.toFixed(2)})`);
  }
}

const titleOf = (page) => page.$eval(".hero__title", (el) => {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const sweep = el.getAnimations().find((a) => a.animationName === "title-sweep");
  const alpha = (text) => { const m = /rgba?\(([^)]+)\)/.exec(text); if (!m) return 1; const parts = m[1].split(/[,/]\s*|\s+/).filter(Boolean); return parts.length > 3 ? Number(parts[3]) : 1; };
  return {
    names: cs.animationName.split(", "), counts: cs.animationIterationCount.split(", "), image: cs.backgroundImage,
    layers: (cs.backgroundImage.match(/gradient\(/g) || []).length,
    clear: (cs.backgroundImage.match(/rgba\([^)]*,\s*(0(\.\d+)?)\)/g) || []).length,
    clip: cs.backgroundClip, ink: alpha(cs.color), fill: alpha(cs.webkitTextFillColor), filter: cs.filter,
    live: el.getAnimations().map((a) => a.animationName),
    ends: sweep ? sweep.effect.getComputedTiming().endTime : 0,
    box: [r.x, r.y, r.width, r.height].map((v) => v.toFixed(2)).join(","),
    band: 1.5 - 2 * parseFloat(cs.backgroundPosition) / 100,
  };
});
const sweepAt = (page, share) => page.$eval(".hero__title", (el, k) => {
  const a = el.getAnimations().find((x) => x.animationName === "title-sweep");
  const t = a.effect.getComputedTiming();
  a.pause();
  a.currentTime = t.delay + k * t.duration;
}, share);

const glassTitle = async (css) => {
  const { context, page, errors } = await open("no-preference", { width: 1280, height: 800 }, { particles: "", css });
  await page.$eval(".hero__title", (el) => el.getAnimations().filter((a) => a.animationName === "rise").forEach((a) => a.finish()));
  const start = await titleOf(page);
  assert.ok(start.names.includes("title-sweep"), `the title carries the specular sweep (${start.names.join(", ")})`);
  assert.ok(start.counts.every((n) => Number.isFinite(Number(n))) && start.ends > 0 && start.ends < 60000, `the sweep is finite: it ends after ${(start.ends / 1000).toFixed(1)} s (iterations ${start.counts.join(", ")})`);
  assert.equal(start.layers, 4, "the glass is four gradient layers clipped to the letters: the sweep, the flare, the sheen and the gold");
  assert.ok(start.clip.split(", ").every((c) => c === "text"), `the gradients are clipped to the text (${start.clip})`);
  assert.ok(start.clear >= 4, `the upper layers are translucent highlights (${start.clear} transparent stops)`);
  assert.ok(/drop-shadow/.test(start.filter), "the letters keep their shadow");
  const boxes = new Set([start.box]), bands = [];
  for (const share of [0, 0.06, 0.08, 0.09, 0.1, 0.14, 0.24, 0.6]) {
    await sweepAt(page, share);
    const now = await titleOf(page);
    boxes.add(now.box);
    bands.push(now.band);
  }
  assert.equal(boxes.size, 1, `the sweep only repaints the letters: the title's box is the same at every point of it (${[...boxes].join(" | ")})`);
  assert.ok(bands[0] <= -0.5 && bands[bands.length - 1] >= 1.5, `the highlight starts off the left of the title and ends off its right (band centre ${bands.map((b) => b.toFixed(2)).join(", ")} title widths)`);
  assert.ok(bands.some((b) => b > 0.1 && b < 0.9), "and crosses the letters in between");
  for (let k = 1; k < bands.length; k++) assert.ok(bands[k] >= bands[k - 1], "moving one way");
  assert.equal(errors.join(" | "), "", "no page error on the glass title");
  await context.close();
  return bands;
};
const stillTitle = async (css) => {
  const { context, page } = await open("reduce", { width: 1280, height: 800 }, { particles: "", css });
  const calm = await titleOf(page);
  await context.close();
  assert.deepEqual(calm.live, [], `under reduced motion nothing animates the title (${calm.live.join(", ")})`);
  assert.equal(calm.layers, 4, "the glass stays, still");
  assert.ok(calm.band <= -0.5, `with the moving highlight parked off the letters (${calm.band.toFixed(2)})`);
};
const opaqueTitle = async (css) => {
  const { context, page } = await open("no-preference", { width: 1280, height: 800 }, { particles: "", css, opaque: true });
  const flat = await titleOf(page);
  await context.close();
  assert.ok(!flat.live.includes("title-sweep") && !flat.names.includes("title-sweep"), `under reduced transparency the sweep does not run (${flat.names.join(", ")})`);
  assert.equal(flat.layers, 1, "and the letters carry the opaque gold alone");
  assert.equal(flat.clear, 0, "with no translucent layer over it");
};
const plainTitle = async (css) => {
  const { context, page } = await open("no-preference", { width: 1280, height: 800 }, { particles: "", css, forcedColors: "active" });
  const plain = await titleOf(page);
  await context.close();
  assert.equal(plain.image, "none", "in forced colours the title has no gradient");
  assert.equal(plain.filter, "none", "no shadow");
  assert.deepEqual(plain.live, [], "no animation");
  assert.ok(plain.ink === 1 && plain.fill === 1, `and is plain text in the system colour (ink alpha ${plain.ink}, fill alpha ${plain.fill})`);
};

{
  const bands = await glassTitle(null);
  checks += 9 + bands.length;
  await stillTitle(null);
  await opaqueTitle(null);
  await plainTitle(null);
  checks += 10;
  ok(bands.length === 8, "the glass title: a finite specular sweep that only repaints, still under reduced motion, opaque gold under reduced transparency, plain text in forced colours");
  for (const [what, pairs, check] of [
    ["a sweep that never ends", [["1.1s 3 both;", "1.1s infinite both;"]], glassTitle],
    ["a sweep that moves the layout", [["  24%, 100% { background-position: -25% 0, 0 0, 0 0, 0 0; }", "  24%, 100% { background-position: -25% 0, 0 0, 0 0, 0 0; letter-spacing: 0.02em; }"]], glassTitle],
    ["a highlight that never leaves the letters", [["  24%, 100% { background-position: -25% 0, 0 0, 0 0, 0 0; }", "  24%, 100% { background-position: 50% 0, 0 0, 0 0, 0 0; }"]], glassTitle],
    ["a title that keeps sweeping under reduced motion", [["  .hero__title, .hero__lede, .hero__cta, .hero__hint { animation: none; }", "  .hero__lede, .hero__cta, .hero__hint { animation: none; }"]], stillTitle],
    ["a title that keeps its translucent layers under reduced transparency", [["@media (prefers-reduced-transparency: reduce) {\n  .hero__title {", "@media (prefers-reduced-transparency: reduce) and (max-width: 1px) {\n  .hero__title {"]], opaqueTitle],
    ["a gradient title in forced colours", [["@media (forced-colors: active) {\n  .hero__title {", "@media (forced-colors: active) and (max-width: 1px) {\n  .hero__title {"]], plainTitle],
  ]) await failsWith(() => check(plant(HOME_CSS, pairs, what)), what);
}

const inkStudy = async (page, width) => {
  await page.evaluate(() => document.querySelectorAll(".hero > *").forEach((el) => el.getAnimations().forEach((a) => a.finish())));
  const runs = await page.evaluate(() => [".hero__title", ".hero__lede", ".hero__hint"].map((sel) => {
    const el = document.querySelector(sel), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { sel, x: Math.max(0, Math.floor(r.left) - 4), y: Math.max(0, Math.floor(r.top) - 4), w: Math.ceil(r.width) + 8, h: Math.ceil(r.height) + 8, color: cs.color, large: parseFloat(cs.fontSize) >= 24 };
  }));
  const out = {};
  for (const run of runs) {
    const clip = { x: run.x, y: run.y, width: Math.min(run.w, width - run.x), height: run.h };
    const shots = [(await page.screenshot({ clip })).toString("base64")];
    for (const ink of ["#ff00ff", "#00ff00"]) {
      const style = await page.addStyleTag({ content: `${run.sel} { background: none !important; color: ${ink} !important; -webkit-text-fill-color: ${ink} !important; filter: none !important; text-shadow: none !important; }` });
      shots.push((await page.screenshot({ clip })).toString("base64"));
      await style.evaluate((node) => node.remove());
    }
    out[run.sel] = await page.evaluate(async ([list, color, large]) => {
      const read = async (b64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
      };
      const [shot, pink, green] = await Promise.all(list.map(read));
      const W = shot.w, H = shot.h, cover = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) cover[i] = (Math.abs(pink.d[i * 4] - green.d[i * 4]) + Math.abs(pink.d[i * 4 + 1] - green.d[i * 4 + 1])) / 510;
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (i) => 0.2126 * lin(shot.d[i * 4]) + 0.7152 * lin(shot.d[i * 4 + 1]) + 0.0722 * lin(shot.d[i * 4 + 2]);
      const around = (i, reach, test) => {
        const x = i % W, y = (i - x) / W;
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && test(cover[yy * W + xx])) return true;
        }
        return false;
      };
      let deep = Infinity, deepN = 0, ring = 0, ringN = 0, box = 0;
      for (let i = 0; i < W * H; i++) {
        if (cover[i] > 0.97) { if (!around(i, 1, (c) => c <= 0.97)) { deepN++; deep = Math.min(deep, lum(i)); } continue; }
        if (cover[i] >= 0.03) continue;
        const l = lum(i);
        if (around(i, 2, (c) => c >= 0.03)) continue;
        if (l > box) box = l;
        if (around(i, 4, (c) => c > 0.5)) { ringN++; if (l > ring) ring = l; }
      }
      const swatch = document.createElement("canvas").getContext("2d");
      swatch.fillStyle = color;
      swatch.fillRect(0, 0, 1, 1);
      const m = swatch.getImageData(0, 0, 1, 1).data;
      const solid = 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
      const ink = large ? deep : solid;
      return { ink, deepN, ringN, large, ring: (ink + 0.05) / (ring + 0.05), box: (ink + 0.05) / (box + 0.05), ringLum: ring, boxLum: box, opaque: large || m[3] === 255 };
    }, [shots, run.color, run.large]);
  }
  return out;
};

const legible = async (source, size, marks = [120, 300]) => {
  const { context, page, errors } = await steppedPage(source, { viewport: size, mute: false });
  const worst = {};
  const note = (study, at) => {
    if (process.env.LM_SHOW) console.log(`  ${size.width} px, ${at}: ${Object.entries(study).map(([sel, s]) => `${sel} ring ${s.ring.toFixed(2)} box ${s.box.toFixed(2)} (box lum ${s.boxLum.toFixed(3)})`).join(", ")}`);
    for (const [sel, s] of Object.entries(study)) {
      assert.ok(s.opaque && (s.large ? s.deepN > 200 : true) && s.ringN > 200, `${sel} is measured on real ink and a real surround (${s.deepN} ink pixels, ${s.ringN} around them)`);
      if (!worst[sel] || s.ring < worst[sel].ring) worst[sel] = { ...s, at, box: Math.min(s.box, worst[sel] ? worst[sel].box : Infinity) };
      else worst[sel].box = Math.min(worst[sel].box, s.box);
    }
  };
  let done = 0;
  for (const frames of marks) {
    await step(page, frames - done);
    done = frames;
    note(await inkStudy(page, size.width), `frame ${frames}`);
  }
  await scrollTo(page, 1);
  await step(page, 200);
  note(await inkStudy(page, size.width), "scrolled to the end");
  assert.equal(errors.join(" | "), "", "no page error measuring contrast");
  await context.close();
  for (const [sel, s] of Object.entries(worst)) {
    assert.ok(s.ring >= 4.5, `${sel} at ${size.width} px: its ink against the brightest pixel within 4 px of its letters is ${s.ring.toFixed(2)}:1 at ${s.at}, under 4.5:1`);
    assert.ok(s.box >= (s.large ? 3 : 4.5), `${sel} at ${size.width} px: its ink against the brightest pixel anywhere in its box is ${s.box.toFixed(2)}:1, under ${s.large ? "3:1 for large text" : "4.5:1"}`);
  }
  return worst;
};

let inkLine = "";
{
  const lines = [];
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const worst = await legible(PARTICLES, size);
    checks += 6;
    lines.push(`${size.width} px: ${Object.entries(worst).map(([sel, s]) => `${sel.replace(".hero__", "")} ${s.ring.toFixed(2)}:1 by its letters and ${s.box.toFixed(2)}:1 in its box`).join(", ")}`);
  }
  inkLine = `the hero text keeps its contrast over three frames of the seeded field, measured from screenshots (ink against the brightest pixel within 4 px of the letters, and anywhere in the element's box): ${lines.join("; ")}`;
  ok(lines.length === 2, inkLine);
  await failsWith(() => legible(plant(PARTICLES, [["        if (a > cap) a = cap;\n", ""]], "no cap behind the copy"), { width: 1440, height: 900 }, [180]), "a field as bright behind the copy as anywhere else");
}

{
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const { context, page, errors } = await open("no-preference", size, { init: () => {
      window.__shifts = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__shifts.push((e.sources || []).map((s) => (s.node && s.node.nodeType === 1 ? (s.node.id || s.node.className || s.node.nodeName) : "")).join(" "));
      }).observe({ type: "layout-shift", buffered: true });
    } });
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelectorAll(".hero > *").forEach((el) => el.getAnimations().forEach((a) => a.finish())));
    const boxes = () => page.evaluate(() => [".hero__title", ".hero__lede", ".hero__cta", ".hero__hint", "#field"].flatMap((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
    const placed = await boxes();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(500);
    const after = await boxes();
    ok(after.every((v, k) => Math.abs(v - placed[k]) < 0.75), `nothing in the hero moves when the page scrolls at ${size.width} px, to within the sub-pixel a sticky box is snapped by (${after.map((v, k) => (v - placed[k]).toFixed(2)).join(", ")})`);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => ({ shifts: window.__shifts, title: document.querySelector(".hero__title").getBoundingClientRect().toJSON(), lede: document.querySelector(".hero__lede").getBoundingClientRect().toJSON(), wide: document.scrollingElement.scrollWidth, inner: innerWidth, aria: document.getElementById("field").getAttribute("aria-hidden") }));
    eq(seen.shifts.filter((s) => /hero|field/.test(s)).join(" ; "), "", `no layout shift comes from the hero or the canvas at ${size.width} px`);
    ok(seen.title.left >= 0 && seen.title.right <= size.width && seen.lede.left >= 0 && seen.lede.right <= size.width && seen.wide <= seen.inner, `the title and the lede are not clipped at ${size.width} px (title ${seen.title.left.toFixed(0)} to ${seen.title.right.toFixed(0)})`);
    eq(seen.aria, "true", "the canvas stays hidden from assistive technology");
    eq(errors.join(" | "), "", `no page error scrolling the page at ${size.width} px`);
    await context.close();
  }
}

await browser.close();
rmSync(scratch, { recursive: true, force: true });
console.log(`✓ landing-motion: ${checks} assertions — under reduced motion the particle field draws one still frame, redraws it on resize and fires no animation frame after the first second, and the marquee does not move but keeps its Pause control for the auto-update; with motion the field animates and the marquee has a native Pause button that Tab reaches, Enter and Space toggle, that plays again while it keeps focus, by key and by a click with the pointer still on it, holds after focus leaves and does not scroll with the prices, the prices keep their place when the label flips, a refresh that lands while paused waits for Play in both views, a Pause and Play with nothing held leaves the bar and its focused control in place, a refresh while playing renders at once, the still field is drawn once at load and once per viewport change and at the device scale again after a context restore, the still field is as bright as the settled trail it replaced, the bar stays clear of the footer at 320, 390 and 1280 px, and the deep field holds: the fitted plane equals an independent least-squares solve, far and near particles are drawn larger, softer and dimmer than those in focus, the dolly ends exactly at rest, the scroll tilts and recedes the camera, the pointer and a horizontal touch drag move it with weight, nothing is drawn while hidden or off screen, the glass title is still under reduced motion, opaque under reduced transparency and plain in forced colours, and every planted wrong build fails`);
console.log(`  ${costLine}`);
console.log(`  ${inkLine}`);
