import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { nvdaBefore, openDesk } from "./desk-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const BOARD = { status: "ok", sessionDate: "2026-09-29", rows: [{ t: "NVDA", s: 80 }, { t: "AAPL", s: 70 }] };
const boardApi = (u) => (u.pathname === "/api/flows/board" ? BOARD : null);
const MIME = { css: "text/css", js: "text/javascript", json: "application/json", woff2: "font/woff2", svg: "image/svg+xml" };

const browser = await chromium.launch();
try {
  {
    const asked = [];
    const page = await openDesk(browser, {
      viewport: { width: 1440, height: 820 }, api: boardApi, payloads: { NVDA: nvdaBefore() },
      onChain: async (route, u) => { asked.push(u.searchParams.get("t")); return false; },
    });
    await page.waitForSelector(".dk-suggest", { timeout: 8000 });
    eq((await page.textContent(".dk-suggest")).trim(), "Try NVDA", "A DESK OPENED WITH NO SYMBOL OFFERS THE TOP BULLISH NAME as a button instead of a blank Quiet frontier");
    await page.waitForTimeout(600);
    eq(asked.length, 0, "and the vendor chain is not read until the reader presses it: an empty visit costs no call");
    await page.click(".dk-suggest");
    await page.waitForFunction(() => document.querySelectorAll("#dkChips .desk-chip, .desk-chip").length > 0, null, { timeout: 8000 });
    eq(asked.join(","), "NVDA", "pressing it makes exactly one chain read, for the board's first row");
    ok(/t=NVDA/.test(page.url()), "and the address records it, so a reload or a shared link opens the same desk");
    await page.close();
  }
  {
    const asked = [];
    const page = await openDesk(browser, {
      viewport: { width: 1440, height: 820 }, api: () => null, payloads: {},
      onChain: async (route, u) => { asked.push(u.searchParams.get("t")); return false; },
    });
    await page.waitForTimeout(1200);
    eq(asked.length, 0, "with no board published the desk stays empty and makes no chain read: the default never invents a name");
    await page.close();
  }
  {
    const asked = [];
    const page = await openDesk(browser, {
      viewport: { width: 1440, height: 820 }, api: boardApi, payloads: { TYPED: nvdaBefore() }, query: "?t=TYPED",
      onChain: async (route, u) => { asked.push(u.searchParams.get("t")); return false; },
    });
    await page.waitForTimeout(1500);
    ok(!asked.includes("NVDA"), "a desk that arrives with its own symbol in the address keeps it and does not add the board's name beside it");
    await page.close();
  }
  for (const [w, h] of [[390, 844], [1440, 820]]) {
    const page = await openDesk(browser, { viewport: { width: w, height: h }, api: () => null });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth }));
    ok(m.sh <= m.ih + 1, `the empty desk fits one screen at ${w}x${h} (${m.sh} of ${m.ih}): the phone's frontier stand-in is shorter so the sizing card is not pushed past the fixed bar`);
    eq(m.sw, w, `and does not scroll sideways at ${w}`);
    await page.close();
  }

  const pages = await import(pathToFileURL(path.join(ROOT, "shared/flows-pages.js")).href);
  const strategy = async (api) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
    const asked = [];
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      const json = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
      if (u.pathname === "/api/flows/strategy") { asked.push(u.searchParams.get("t")); return json({ error: { code: "chain_empty", message: "none" } }, 404); }
      if (u.pathname.startsWith("/api/")) return json(api(u) || { status: "pending" });
      if (u.pathname.startsWith("/assets/")) {
        const body = await readFile(path.join(ROOT, u.pathname)).catch(() => null);
        if (body === null) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ contentType: MIME[u.pathname.split(".").pop()] || "application/octet-stream", body });
      }
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: pages.strategyPage({ username: "tester" }) });
    });
    await page.goto("https://x.test/flows/strategy/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const before = asked.length;
    const button = await page.$(".dk-suggest");
    const label = button ? (await button.textContent()).trim() : null;
    if (button) { await button.click(); await page.waitForTimeout(1200); }
    const url = page.url();
    await page.close();
    return { asked, url, before, label };
  };
  const withBoard = await strategy(boardApi);
  eq(withBoard.label, "Try NVDA", "THE STRATEGY LAB OPENED WITH NO SYMBOL OFFERS THE TOP BULLISH NAME as a button");
  eq(withBoard.before, 0, "and asks for no context until it is pressed");
  eq(withBoard.asked[0], "NVDA", "pressing it makes the first context request, for the board's first row");
  ok(/t=NVDA/.test(withBoard.url), "and records it in the address");
  const without = await strategy(() => null);
  eq(without.asked.length, 0, "with no board published it asks for nothing");
  eq(without.label, null, "and offers no button");
} finally {
  await browser.close();
}

console.log(`✓ flows-defaults-render: ${checks} assertions — the premium desk and the strategy lab opened with no symbol take the top bullish board name, keep a symbol that is already in the address, invent nothing when no board is published, and the empty desk fits one screen on a phone`);
