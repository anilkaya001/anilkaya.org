/* =============================================================
   Regression suite — the per-cycle checks, run on every push.
   Self-contained: starts a static server, drives Chromium, asserts.
   Covers: layout overflow, console errors, touch targets, contrast,
   iOS input zoom, the fixed-size pill, rapid-nav races, and the
   course heading outline. Exits non-zero on any failure.

   Local:  SITE_DIR=/abs/repo PW_CHROMIUM=/path/chrome node regression.mjs
   CI:     npx playwright install chromium && node regression.mjs
   ============================================================= */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import net from "node:net";

const SITE_DIR = process.env.SITE_DIR || "..";
const PORT = 8399;
const BASE = `http://127.0.0.1:${PORT}`;
const launchOpts = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

function waitPort(port) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tryOnce = () => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => { s.destroy(); res(); });
      s.on("error", () => { s.destroy(); Date.now() - t0 > 15000 ? rej(new Error("server timeout")) : setTimeout(tryOnce, 200); });
    };
    tryOnce();
  });
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", SITE_DIR], { stdio: "ignore" });
await waitPort(PORT);

const browser = await chromium.launch(launchOpts);
const PAGES = ["/", "/lab/", "/lab/course.html?m=ols", "/articles/"];
const contrast = (a, b) => {
  const L = (c) => { const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05);
};

try {
  // 1. no horizontal overflow + no page errors, across viewports
  for (const [w, h, mob] of [[320, 720, true], [390, 844, true], [768, 1024, true], [1440, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/jsdelivr|pyodide|cdn\.|net::|Failed to load resource|api\/me/i.test(m.text())) errs.push("console: " + m.text()); });
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: "load" });
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 1, `[${w}px] horizontal overflow on ${path}: ${over}px`);
    }
    ok(errs.length === 0, `[${w}px] page/console errors: ${JSON.stringify([...new Set(errs)])}`);
    await ctx.close();
  }

  // 2. contrast of the faint ink token must pass WCAG AA on the base surface
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    const faint = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink-faint").trim());
    const hex = faint.startsWith("#") ? faint : "#8a8571";
    ok(contrast(hex, "#0a0a08") >= 4.5, `--ink-faint contrast ${contrast(hex, "#0a0a08").toFixed(2)} < 4.5 (${hex})`);
    await ctx.close();
  }

  // 3. pill: equal-width tabs + fixed-size indicator on the active tab
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const ws = [...document.querySelectorAll(".pill a")].map((l) => Math.round(l.getBoundingClientRect().width));
      const ind = document.querySelector(".pill__ind").getBoundingClientRect();
      const cur = document.querySelector(".pill a.is-current").getBoundingClientRect();
      return { equal: new Set(ws).size === 1, onCurrent: Math.abs(ind.left - cur.left) < 2 && Math.abs(ind.width - cur.width) < 2, trans: getComputedStyle(document.querySelector(".pill__ind")).transitionProperty };
    });
    ok(m.equal, "pill tabs are not equal width");
    ok(m.onCurrent, "pill indicator not aligned to the current tab");
    ok(m.trans === "transform", `pill indicator animates ${m.trans}, expected transform only`);
    await ctx.close();
  }

  // 4. iOS input zoom guard: editor + its highlight layer are ≥16px & metrically matched on touch
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const page = await ctx.newPage();
    await page.goto(BASE + "/lab/course.html?m=ols#s1", { waitUntil: "load" }); await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const e = getComputedStyle(document.querySelector(".cell__editor")), h = getComputedStyle(document.querySelector(".cell__hl"));
      return { fs: parseFloat(e.fontSize), match: e.fontSize === h.fontSize && e.lineHeight === h.lineHeight, wrap: e.whiteSpace };
    });
    ok(m.fs >= 16, `editor font ${m.fs}px < 16px on touch (iOS will zoom)`);
    ok(m.match, "editor and highlight layer metrics diverge");
    ok(m.wrap === "pre-wrap", `editor whiteSpace ${m.wrap}, expected pre-wrap on mobile`);
    await ctx.close();
  }

  // 5. rapid-nav race: three fast Next clicks advance exactly three stages
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    await page.goto(BASE + "/lab/course.html?m=ols", { waitUntil: "load" }); await page.waitForTimeout(350);
    const before = await page.evaluate(() => document.querySelector("#cPos").textContent.trim());
    await page.click("#cNext"); await page.click("#cNext"); await page.click("#cNext");
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => document.querySelector("#cPos").textContent.trim());
    ok(before === "1 / 20" && after === "4 / 20", `rapid Next: ${before} -> ${after} (expected 1/20 -> 4/20)`);
    await ctx.close();
  }

  // 6. heading outline has no skipped levels on the course player
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    for (const idx of [0, 1, 3]) {
      await page.goto(BASE + `/lab/course.html?m=ols#s${idx}`, { waitUntil: "load" }); await page.waitForTimeout(200);
      const skip = await page.evaluate(() => { const l = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => +h.tagName[1]); for (let i = 1; i < l.length; i++) if (l[i] - l[i - 1] > 1) return true; return false; });
      ok(!skip, `heading level skip on course stage #s${idx}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill("SIGKILL");
}

if (fails.length) { console.error("✗ REGRESSIONS:\n" + fails.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("✓ all regression checks passed");
