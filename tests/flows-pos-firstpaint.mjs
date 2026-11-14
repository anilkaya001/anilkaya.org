import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { ROOT, SIZES, payload, html, NOW_MS } from "./lib/pos-world.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const css = fs.readFileSync(path.join(ROOT, "assets/css/flows-pos.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets/js/flows-pos.js"), "utf8");

const BOXES = ["#fxTitle", "#posHero", "#fdTabs", "#fdStage", "#posRotCard", "#posFilCard", "#posInsCard", "#posShCard"];

async function sample(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.addInitScript(() => {
    window.__shift = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shift += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/assets/")) {
      if (u.pathname === "/assets/css/flows-pos.css" && o.css) return r.fulfill({ contentType: "text/css", body: o.css });
      if (u.pathname === "/assets/js/flows-pos.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/positioning") {
      await gate;
      return r.fulfill({ contentType: "application/json", headers: { "X-Payload-Updated": String(NOW_MS) }, body: JSON.stringify(payload()) });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: html() });
  });
  await page.goto("https://example.test/flows/positioning/");
  await page.waitForSelector("#posHero");
  for (let i = 0; i < 4; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
  const read = () => page.evaluate((sel) => Object.fromEntries(sel.map((s) => { const e = document.querySelector(s); const b = e ? e.getBoundingClientRect() : null; return [s, b ? [b.x, b.y, b.width, b.height] : null]; })), BOXES);
  const before = await read();
  const skeletonPaint = await page.evaluate(() => ({ ready: Boolean(document.querySelector("#pos[data-ready]")), cells: [...document.querySelectorAll("#posHero .v")].map((v) => v.textContent) }));
  release();
  await page.waitForSelector("#pos[data-ready]", { timeout: 15000 });
  await page.waitForTimeout(500);
  const after = await read();
  const shift = await page.evaluate(() => window.__shift);
  await ctx.close();
  return { before, after, shift, skeletonPaint };
}

const moved = (a, b) => BOXES.filter((s) => !a[s] || !b[s] || a[s].some((v, i) => Math.abs(v - b[s][i]) > 1));

const browser = await launch();
try {
  for (const [w, h] of SIZES) {
    const r = await sample(browser, w, h);
    ok(!r.skeletonPaint.ready, `${w}x${h}: the skeleton is on screen before the data arrives`);
    ok(r.skeletonPaint.cells.every((c) => c.startsWith("—")), `${w}x${h}: and its figures are dashes`);
    const m = moved(r.before, r.after);
    assert.deepEqual(m, [], `${w}x${h}: nothing moves when the data lands: ${JSON.stringify(m.map((s) => [s, r.before[s], r.after[s]]))}`);
    checks++;
    ok(r.shift < 0.02, `${w}x${h}: layout shift ${r.shift.toFixed(4)} stays under 0.02`);
  }

  const plants = [
    ["a banner added above the hero when the data lands", { js: js.replace("    paintStamp(p);\n", "    paintStamp(p);\n    $(\"pos\").prepend(Object.assign(document.createElement(\"p\"), { textContent: \"late\", style: \"height:30px;margin:0\" }));\n") }],
    ["a hero that grows once ready", { css: css + "\n#pos[data-ready] .pos-hero { margin-bottom: 40px; }\n" }],
    ["a stage that changes height once ready", { css: css + "\n#pos[data-ready] .fd-stage { margin-top: 24px; }\n" }],
  ];
  for (const [title, o] of plants) {
    assert.ok((o.js && o.js !== js) || (o.css && o.css !== css), "plant applies: " + title);
    let any = false;
    for (const [w, h] of [[1440, 820], [390, 844]]) {
      const r = await sample(browser, w, h, o);
      if (moved(r.before, r.after).length || r.shift >= 0.02) any = true;
    }
    ok(any, "PLANTED WRONG BUILD FAILS: " + title);
  }
} finally {
  await browser.close();
}

console.log(`✓ flows-pos-firstpaint: ${checks} assertions — the served skeleton at four sizes with the data held back, then released: the title, hero, tabs, stage and four panels move by no more than a pixel, layout shift stays under 0.02, the skeleton figures are dashes, and three planted wrong builds that each fail`);
