/* End-to-end browser regression suite against the real local Worker runtime. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startWorker } from "./worker-server.mjs";

const server = await startWorker();
const BASE = server.baseURL;
let browser;
const PAGES = ["/", "/lab/", "/lab/course?m=ols", "/articles/"];
const TOPICS = { ols: 20, iv2sls: 31, did: 29, var: 30, panel: 30, logit: 32, gmm: 33 };
const stageRoute = (topic, index, nonce = index) => `/lab/course?m=${topic}&test=${nonce}#s${index}`;

function watch(page, ignored = () => false) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !ignored(message.text())) errors.push("console: " + message.text());
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "unknown";
    const navigationAbortedAuthProbe = reason === "net::ERR_ABORTED" && new URL(request.url()).pathname === "/api/me";
    const detail = `request failed: ${request.url()} (${reason})`;
    if (!navigationAbortedAuthProbe && !ignored(detail)) errors.push(detail);
  });
  return () => assert.deepEqual([...new Set(errors)], [], "unexpected browser errors");
}

const contrast = (a, b) => {
  const luminance = (color) => {
    const values = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

async function points(page) {
  return page.evaluate(() => window.Gamify.get().points);
}

async function solve(route, answer, expectedPoints, repeat) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const clean = watch(page);
  await page.goto(BASE + route, { waitUntil: "load" });
  await answer(page);
  await page.click(".quiz__check");
  await page.waitForSelector(".quiz__feedback.ok");
  assert.equal(await points(page), expectedPoints, `${route}: wrong award`);
  await page.click(".quiz__check");
  assert.equal(await points(page), expectedPoints, `${route}: double-submit awarded twice`);
  if (repeat) {
    await page.reload({ waitUntil: "load" });
    await answer(page);
    await page.click(".quiz__check");
    await page.waitForSelector(".quiz__feedback.ok");
    assert.equal(await points(page), expectedPoints, `${route}: completed stage awarded after reload`);
  }
  clean();
  await context.close();
}

try {
  browser = await chromium.launch();
  // Layout and console integrity at all supported viewports.
  for (const [width, height, mobile] of [[320, 720, true], [390, 844, true], [768, 1024, true], [1440, 900, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await context.newPage();
    const clean = watch(page);
    for (const route of PAGES) {
      await page.goto(BASE + route, { waitUntil: "load" });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `[${width}px] horizontal overflow on ${route}: ${overflow}px`);
    }
    clean();
    await context.close();

  }

  // The faintest text token remains WCAG-AA on the base surface.
  {
    const page = await browser.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    const faint = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink-faint").trim());
    assert(contrast(faint, "#0a0a08") >= 4.5, `--ink-faint contrast is ${contrast(faint, "#0a0a08").toFixed(2)}`);
    await page.close();
  }

  // Pill tabs are equal and the indicator only translates.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => {
      const widths = [...document.querySelectorAll(".pill a")].map((link) => Math.round(link.getBoundingClientRect().width));
      const indicator = document.querySelector(".pill__ind").getBoundingClientRect();
      const current = document.querySelector(".pill a.is-current").getBoundingClientRect();
      return {
        equal: new Set(widths).size === 1,
        aligned: Math.abs(indicator.left - current.left) < 2 && Math.abs(indicator.width - current.width) < 2,
        transition: getComputedStyle(document.querySelector(".pill__ind")).transitionProperty,
      };
    });
    assert(metrics.equal && metrics.aligned && metrics.transition === "transform", `pill metrics: ${JSON.stringify(metrics)}`);
    await context.close();
  }

  // Coarse-pointer inputs avoid iOS zoom and primary targets are at least 44×44.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(BASE + stageRoute("ols", 1, "touch-code"), { waitUntil: "load" });
    const editor = await page.evaluate(() => {
      const input = getComputedStyle(document.querySelector(".cell__editor"));
      const overlay = getComputedStyle(document.querySelector(".cell__hl"));
      return { font: parseFloat(input.fontSize), match: input.fontSize === overlay.fontSize && input.lineHeight === overlay.lineHeight, wrap: input.whiteSpace };
    });
    assert(editor.font >= 16 && editor.match && editor.wrap === "pre-wrap", `mobile editor: ${JSON.stringify(editor)}`);

    for (const selector of ["#cPrev", "#cNext", ".course-nav__mod", ".cell__run", ".cell__reset"]) {
      const box = await page.locator(selector).first().boundingBox();
      assert(box && box.width >= 44 && box.height >= 44, `${selector} is ${box?.width}×${box?.height}`);
    }
    await page.goto(BASE + stageRoute("ols", 2, "touch-range"), { waitUntil: "load" });
    const range = await page.locator(".control__range").first().boundingBox();
    assert(range && range.width >= 44 && range.height >= 44, `range input is ${range?.width}×${range?.height}`);
    await page.goto(BASE + stageRoute("ols", 4, "touch-choice"), { waitUntil: "load" });
    const choice = await page.locator(".quiz__choice").first().boundingBox();
    assert(choice && choice.width >= 44 && choice.height >= 44, `quiz choice is ${choice?.width}×${choice?.height}`);
    await page.goto(BASE + stageRoute("ols", 13, "touch-numeric"), { waitUntil: "load" });
    const numeric = await page.locator(".q-num").boundingBox();
    assert(numeric && numeric.width >= 44 && numeric.height >= 44, `numeric input is ${numeric?.width}×${numeric?.height}`);
    await page.goto(BASE + stageRoute("iv2sls", 20, "touch-blank"), { waitUntil: "load" });
    const blank = await page.locator(".q-blank").boundingBox();
    assert(blank && blank.width >= 44 && blank.height >= 44, `blank input is ${blank?.width}×${blank?.height}`);
    await context.close();

    const wideTouch = await browser.newContext({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const widePage = await wideTouch.newPage();
    await widePage.goto(BASE + stageRoute("ols", 1, "touch-splitter"), { waitUntil: "load" });
    const splitter = await widePage.locator(".stage__handle").boundingBox();
    assert(splitter && splitter.width >= 44 && splitter.height >= 44, `splitter is ${splitter?.width}×${splitter?.height}`);
    await wideTouch.close();
  }

  // Rapid navigation advances from the target index, not a stale rendered index.
  {
    const page = await browser.newPage();
    await page.goto(BASE + "/lab/course?m=ols", { waitUntil: "load" });
    assert.equal((await page.locator("#cPos").textContent()).trim(), "1 / 20");
    assert.equal(await page.locator('.course-nav__mod[aria-current="step"]').count(), 1);
    await page.click("#cNext"); await page.click("#cNext"); await page.click("#cNext");
    await page.waitForFunction(() => document.querySelector("#cPos").textContent.trim() === "4 / 20");
    assert.equal(await page.locator('.course-nav__mod[aria-current="step"]').count(), 1);
    await page.locator(".course-nav__mod").nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll(".course-nav__mod")[1]?.getAttribute("aria-current") === "step");
    assert.equal(await page.locator('.course-nav__mod[aria-current="step"]').count(), 1);
    assert(await page.locator('.course-nav__mod[aria-current="step"]').evaluate((node) => node === document.querySelectorAll(".course-nav__mod")[1]));
    await page.close();
  }

  // Background account synchronization repaints progress without destroying unsaved work.
  {
    const page = await browser.newPage();
    await page.goto(BASE + "/lab/course?m=ols#s13", { waitUntil: "load" });
    await page.fill(".q-num", "36");
    const state = await page.evaluate(() => {
      const input = document.querySelector(".q-num");
      window.IEWTStorage.setProgress({ ols: { done: [0] } });
      document.dispatchEvent(new Event("iewt:synced"));
      return {
        sameInput: input === document.querySelector(".q-num"),
        answer: document.querySelector(".q-num").value,
        progress: document.querySelector("#cBar").style.width,
      };
    });
    assert.deepEqual(state, { sameInput: true, answer: "36", progress: "5%" });
    await page.close();
  }

  // Every rendered stage has a non-skipping heading outline.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const clean = watch(page);
    for (const [topic, count] of Object.entries(TOPICS)) {
      for (let index = 0; index < count; index++) {
        await page.goto(BASE + stageRoute(topic, index), { waitUntil: "load" });
        const levels = await page.evaluate(() => [...document.querySelectorAll("h1,h2,h3,h4")].map((heading) => Number(heading.tagName[1])));
        assert(levels.length >= 2, `${topic}#s${index}: missing headings`);
        for (let i = 1; i < levels.length; i++) assert(levels[i] - levels[i - 1] <= 1, `${topic}#s${index}: heading skip ${levels.join("→")}`);
      }
    }
    clean();
    await context.close();
  }

  // Legacy splitter state migrates; keyboard controls persist without stage navigation.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => localStorage.setItem("iewt:splitW", "61.4"));
    const page = await context.newPage();
    await page.goto(BASE + "/lab/course?m=ols#s1", { waitUntil: "load" });
    const migrated = await page.evaluate(() => ({
      width: document.querySelector(".stage__split").style.getPropertyValue("--guideW"),
      current: localStorage.getItem("iewt:guideW"), legacy: localStorage.getItem("iewt:splitW"),
      role: document.querySelector(".stage__handle").getAttribute("role"),
    }));
    assert.deepEqual(migrated, { width: "61.4%", current: "61.4", legacy: null, role: "separator" });
    const position = (await page.locator("#cPos").textContent()).trim();
    await page.locator(".stage__handle").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(".stage__handle").getAttribute("aria-valuenow"), "64");
    await page.keyboard.press("End");
    assert.equal(await page.locator(".stage__handle").getAttribute("aria-valuenow"), "72");
    assert.equal((await page.locator("#cPos").textContent()).trim(), position);
    await page.reload({ waitUntil: "load" });
    assert.equal(await page.locator(".stage__handle").getAttribute("aria-valuenow"), "72");
    await context.close();
  }

  // Blocked and malformed storage never prevent the course from rendering.
  {
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.removeItem = () => { throw new DOMException("blocked", "SecurityError"); };
    });
    const page = await blocked.newPage();
    const clean = watch(page);
    await page.goto(BASE + "/lab/course?m=ols#s1", { waitUntil: "load" });
    assert.equal((await page.locator("#cPos").textContent()).trim(), "2 / 20");
    assert(await page.locator(".cell__editor").isVisible());
    clean();
    await blocked.close();

    const malformed = await browser.newContext();
    await malformed.addInitScript(() => {
      localStorage.setItem("iewt:progress", "5");
      localStorage.setItem("iewt:gamify", "5");
    });
    const malformedPage = await malformed.newPage();
    await malformedPage.goto(BASE + "/lab/course?m=ols", { waitUntil: "load" });
    const repaired = await malformedPage.evaluate(() => ({ progress: JSON.parse(localStorage.getItem("iewt:progress")), gamify: JSON.parse(localStorage.getItem("iewt:gamify")) }));
    assert.equal(typeof repaired.progress, "object");
    assert.deepEqual(Object.keys(repaired.gamify).sort(), ["last", "points", "streak"]);
    await malformed.close();

    const quota = await browser.newContext();
    await quota.addInitScript(() => {
      localStorage.setItem("iewt:progress", JSON.stringify({ ols: { done: [] } }));
      localStorage.setItem("iewt:gamify", JSON.stringify({ points: 0, streak: 0, last: null }));
      Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    });
    const quotaPage = await quota.newPage();
    await quotaPage.goto(BASE + "/lab/course?m=ols#s4", { waitUntil: "load" });
    await quotaPage.check('input[value="false"]');
    await quotaPage.click(".quiz__check");
    const quotaState = await quotaPage.evaluate(() => ({
      done: window.IEWTStorage.progress().ols.done,
      points: window.Gamify.get().points,
      persisted: JSON.parse(localStorage.getItem("iewt:progress")).ols.done,
    }));
    assert.deepEqual(quotaState, { done: [4], points: 10, persisted: [] }, "write-only storage failure restored stale state");
    await quota.close();

    const legacyScore = await browser.newContext();
    await legacyScore.addInitScript(() => {
      localStorage.setItem("iewt:progress", JSON.stringify({ ols: { done: [13] } }));
      localStorage.setItem("iewt:gamify", JSON.stringify({ points: 5, streak: 0, last: null }));
    });
    const scorePage = await legacyScore.newPage();
    await scorePage.goto(BASE + "/lab/", { waitUntil: "load" });
    assert.equal(await points(scorePage), 20, "legacy under-count was not reconciled from progress");
    const correctedHigh = await scorePage.evaluate(() => {
      window.IEWTStorage.setGamify({ points: 9999, streak: 0, last: null });
      return window.Gamify.get().points;
    });
    assert.equal(correctedHigh, 20, "stale high local points were not reconciled from progress");
    await legacyScore.close();
  }

  // Boot progress is announced without downloading Pyodide during the test.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => { window.loadPyodide = () => new Promise(() => {}); });
    const page = await context.newPage();
    const clean = watch(page, (value) => value.includes("cdn.jsdelivr.net"));
    await page.goto(BASE + "/lab/course?m=ols#s1", { waitUntil: "load" });
    await page.click(".cell__run");
    const boot = page.locator("#labBoot.show");
    await boot.waitFor();
    assert.equal(await boot.getAttribute("role"), "status");
    assert((await boot.textContent()).trim().length > 0, "boot status text missing");
    clean();
    await context.close();
  }

  // When progress sync fails, verified remote points remain a temporary floor.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      const reply = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { "Content-Type": "application/json" },
      });
      window.fetch = (input, init = {}) => {
        const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
        const method = init.method || "GET";
        if (path === "/api/me") return Promise.resolve(reply({ user: { id: "g_partial", name: "Partial Sync", email: "" } }));
        if (path === "/api/progress") return Promise.resolve(reply({ error: { code: "temporary" } }, 500));
        if (path === "/api/stats" && method === "GET") return Promise.resolve(reply({ stats: { points: 100, streak: 2, last: "2026-07-12" } }));
        if (path === "/api/stats" && method === "PUT") return Promise.resolve(reply({ ok: true, stats: { points: 100, streak: 2, last: "2026-07-12" } }));
        return nativeFetch(input, init);
      };
    });
    const page = await context.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Gamify.get().points === 100 && window.Gamify.get().streak === 2);
    assert.deepEqual(await page.evaluate(() => window.Gamify.get()), { points: 100, streak: 2, last: "2026-07-12" });
    const reconciled = await page.evaluate(() => {
      window.IEWTStorage.setProgress({ ols: { done: [13] } });
      window.Gamify.merge({ points: 20, streak: 2, last: "2026-07-12" }, { progressComplete: true });
      return window.Gamify.get();
    });
    assert.deepEqual(reconciled, { points: 20, streak: 2, last: "2026-07-12" }, "successful progress sync did not clear the temporary remote floor");
    await context.close();
  }

  // Authored rewards and deterministic grading for every question family.
  await solve("/lab/course?m=ols#s4", (page) => page.check('input[value="false"]'), 10, true);
  await solve("/lab/course?m=ols#s3", (page) => page.check('input[value="2"]'), 15, false);
  await solve("/lab/course?m=ols#s13", (page) => page.fill(".q-num", "36"), 20, false);
  await solve("/lab/course?m=ols#s19", async (page) => {
    for (const value of [0, 1, 2]) await page.check(`input[value="${value}"]`);
  }, 20, false);
  await solve("/lab/course?m=iv2sls#s20", (page) => page.fill(".q-blank", "  THE fitted values. "), 15, false);
  await solve("/lab/course?m=iv2sls#s29", (page) => page.fill(".q-num", "−3.6"), 20, false);

  {
    const page = await browser.newPage();
    await page.goto(BASE + "/lab/course?m=ols#s13", { waitUntil: "load" });
    await page.fill(".q-num", "36abc"); await page.click(".quiz__check");
    assert(await page.locator(".quiz__feedback.err").isVisible());
    assert.equal(await points(page), 0);
    await page.fill(".q-num", "36.5"); await page.click(".quiz__check");
    assert(await page.locator(".quiz__feedback.ok").isVisible());
    await page.close();
  }

  console.log("✓ browser: layouts, all headings, touch targets, storage, splitter, boot, grading, rewards");
} finally {
  if (browser) await browser.close();
  await server.stop();
}
