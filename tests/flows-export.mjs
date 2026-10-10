import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { openDesk, nvdaAfter } from "./desk-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 2; continue; }
    cell += c; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function mountBoard(browser, { html, url, board, errors }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/board") return route.fulfill({ contentType: "application/json", body: JSON.stringify(board) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
  await page.goto("https://example.test" + url);
  await page.waitForSelector("#flowsBody .bd-row, #watchBody .bd-row", { state: "attached", timeout: 15000 });
  return page;
}

const menuItems = async (page) => {
  const sum = page.locator(".ui-exp > summary");
  if (!(await page.locator(".ui-exp[open]").count())) await sum.click();
  await page.waitForSelector(".ui-exp-i, .ui-exp-n");
  return page.$$eval(".ui-exp-i", (b) => b.map((x) => x.textContent));
};

const download = async (page, label) => {
  await menuItems(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".ui-exp-i", { hasText: new RegExp("^" + label + "$") }).click()]);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
};

const errors = [];
const browser = await launch();
try {
  const TICKERS = ["NVDA", "AMD", "MSFT", "AAPL"];
  const board = {
    side: "long", generatedAt: "2026-09-28T21:30:00.000Z", sessionDate: "2026-09-28", status: "ok", universe: 264, enriched: 60,
    rows: TICKERS.map((t, i) => ({
      t, r: i + 1, s: 90 - i * 7, cnv: 80 - i * 3, px: 100 + i, chg: 0.01 * (i + 1), purity: 0.02,
      sector: i === 1 ? '=HYPERLINK("http://evil.test","x")' : i === 2 ? "+cmd|' /C calc'!A0" : "Technology",
      gRegime: "long", gFlipDist: -0.1, netPrem: i === 3 ? null : 1e7 - i * 1e5, hm: 0.05, surpriseTilt: i === 0 ? -0.4 : 0.2,
      relVolume: 1.5, putCallRatio: 0.8, w52: 0.9, ivr: 0.4, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 + i,
    })),
  };

  {
    const page = await mountBoard(browser, { html: PAGES.sidePage({ username: "t", side: "long" }), url: "/flows/long/", board, errors });
    ok(await page.evaluate(() => typeof window.FlowsUI.exportMenu === "function" && Object.isFrozen(window.FlowsUI)), "the export helper joins the frozen FlowsUI global");
    eq(await menuItems(page), ["CSV"], "in the list view the menu offers CSV and no chart");
    const got = await download(page, "CSV");
    eq(got.name, "flows-long-board-2026-09-28.csv", "the file is named for the board and the session it holds");
    const text = got.bytes.toString("utf8");
    ok(text.charCodeAt(0) === 0xFEFF, "it starts with a byte order mark so a spreadsheet reads the U+2212 and other non-ASCII correctly");
    const grid = parseCsv(text.slice(1));
    eq(grid[0], ["Rank", "Ticker", "Sector", "Score (points)", "Conviction (points)", "Net premium (USD)", "Priced move (fraction)",
      "Volume surprise tilt (ln ratio)", "Relative volume (x)", "Put/call volume (ratio)", "52-week position (fraction)", "IV rank (fraction)", "Dealer gamma regime"],
      "the header row carries each column's unit");
    ok(grid.every((r) => r.length === grid[0].length), "every row, the two footer rows included, is as wide as the header, so a strict parser reads the file");
    eq(grid.length, 1 + 4 + 2, "one header, the four names and two footer rows");
    eq(grid.slice(1, 5).map((r) => r[1]), TICKERS, "rows follow the board's published order");
    eq(grid[2][2], "'=HYPERLINK(\"http://evil.test\",\"x\")", "a string cell beginning = is neutralised with a leading apostrophe and its quotes survive a round trip");
    eq(grid[3][2], "'+cmd|' /C calc'!A0", "and one beginning +");
    eq(grid[1][2], "Technology", "an ordinary string is left alone");
    eq(grid[4][5], "", "a null net premium exports as an empty cell, not 0");
    eq(grid[1][6], "0.05", "numbers export as numbers");
    eq(grid[1][7], "-0.4", "a negative number keeps its ASCII minus: it is a number, not a string a spreadsheet could read as a formula");
    eq(grid[1][0], "1", "rank is numeric");
    ok(/^Source: .*; as of 2026-09-28$/.test(grid[5][0]) && grid[5].slice(1).every((c) => c === ""), `the freshness stamp is the first footer row (${grid[5][0]})`);
    ok(/^Exported \d{4}-\d{2}-\d{2}T.* from anilkaya\.org$/.test(grid[6][0]), "and the export instant the second");
    ok(!/\b(px|chg|Price)\b/.test(grid[0].join(",")), "the vendor quote (last price, day change) is not among the exported columns");

    const cells = ["=1+1", "+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd", "\u22123.2%", "plain", "a,b", 'say "hi"', "two\nlines", "", null, undefined, NaN, Infinity, -0.5, 0, 1e21, true];
    const raw = await page.evaluate((c) => window.FlowsUI.csv(c.map((v) => [v]), [{ label: "v", get: (r) => r[0] }], []), cells);
    const back = parseCsv(raw).slice(1).map((r) => r[0]);
    eq(back.slice(0, 6), ["'=1+1", "'+1", "'-2+3", "'@SUM(A1)", "'\tcmd", "'\rcmd"], "every spreadsheet formula trigger (= + - @ tab CR) at the start of a string is neutralised");
    eq(back.slice(6, 10), ["\u22123.2%", "plain", "a,b", 'say "hi"'], "U+2212 survives, plain text is unchanged, commas and quotes round-trip");
    eq(back[10], "two\nlines", "an embedded newline is quoted and survives");
    eq(back.slice(11, 16), ["", "", "", "", ""], "empty, null, undefined, NaN and Infinity all export as empty cells, never the words NaN or Infinity");
    eq(back.slice(16, 20), ["-0.5", "0", "1e+21", "true"], "finite numbers are written bare (a negative keeps its ASCII minus), zero is not empty, and a boolean is its word");

    await page.selectOption("#fbSort", { label: "Ticker" });
    await page.waitForTimeout(200);
    const sorted = parseCsv((await download(page, "CSV")).bytes.toString("utf8").slice(1));
    eq(sorted.slice(1, 5).map((r) => r[1]), ["AAPL", "AMD", "MSFT", "NVDA"], "a re-sorted board exports in the order the reader sees");
    await page.fill("#fbQ", "AM");
    await page.waitForTimeout(250);
    const filtered = parseCsv((await download(page, "CSV")).bytes.toString("utf8").slice(1));
    eq(filtered.slice(1, -2).map((r) => r[1]), ["AMD"], "and a filtered board exports only the rows that match");

    await page.locator(".ui-exp > summary").click();
    await page.locator(".ui-exp > summary").click();
    await page.keyboard.press("Escape");
    eq(await page.locator(".ui-exp[open]").count(), 0, "Escape closes the menu");
    await page.locator(".ui-exp > summary").click();
    await page.locator("#fbQ").focus();
    eq(await page.locator(".ui-exp[open]").count(), 0, "and so does moving focus out of it");
    await page.close();
  }

  {
    const page = await mountBoard(browser, { html: PAGES.sidePage({ username: "t", side: "long" }), url: "/flows/long/?view=map", board, errors });
    await page.waitForSelector("#bdMap svg");
    eq(await menuItems(page), ["CSV", "SVG", "PNG"], "in the map view the menu also offers the chart as SVG and PNG");
    const svg = await download(page, "SVG");
    eq(svg.name, "flows-long-map.svg", "the chart is named for the board");
    const text = svg.bytes.toString("utf8");
    ok(text.startsWith("<svg") && text.includes('xmlns="http://www.w3.org/2000/svg"'), "the SVG is a standalone document");
    ok(!/var\(--/.test(text), "no colour is left as a custom property the file could not resolve");
    const valid = await page.evaluate((t) => { const d = new DOMParser().parseFromString(t, "image/svg+xml"); return !d.querySelector("parsererror") && d.querySelectorAll("*").length > 5; }, text);
    ok(valid, "and it parses as XML with the chart's marks in it");
    ok(/fill:\s*rgb/.test(text), "fills are resolved to concrete colours");
    const png = await download(page, "PNG");
    eq(png.name, "flows-long-map.png", "the PNG is named alike");
    eq([...png.bytes.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], "and carries the PNG signature");
    const w = png.bytes.readUInt32BE(16), hgt = png.bytes.readUInt32BE(20);
    const box = await page.$eval("#bdMap svg", (n) => { const b = n.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
    ok(w >= box[0] && hgt >= box[1], `at least the chart's own size (${w}x${hgt} against ${box.join("x")})`);
    await page.close();
  }

  {
    const watch = {
      side: "watch", generatedAt: "2026-09-28T21:30:00.000Z", sessionDate: "2026-09-28", status: "ok", universe: 264, enriched: 60, deadBand: 30,
      rows: ["NVDA", "AMD"].map((t, i) => ({ t, s: 10 + i * 10, cnv: 50, px: 100, chg: 0.01, sector: "Technology", gRegime: "short", netPrem: 5e6, __edge: i + 1 })),
    };
    const page = await mountBoard(browser, { html: PAGES.watchPage({ username: "t" }), url: "/flows/watch/", board: watch, errors });
    const grid = parseCsv((await download(page, "CSV")).bytes.toString("utf8").slice(1));
    eq(grid[0][0], "Edge order", "the watchlist leads with its own order, not a rank it does not have");
    eq(grid[0][grid[0].length - 1], "To band (score points)", "and ends with the distance to the band edge");
    eq(grid.slice(1, 3).map((r) => r[1] + ":" + r[r.length - 1]), ["AMD:10", "NVDA:20"], "nearest the edge first, each worked from the score and the band: 30 less 20, 30 less 10");
    await page.close();
  }

  {
    const page = await openDesk(browser, { payloads: { NVDA: nvdaAfter() }, query: "?t=NVDA&strategy=both&rank=annualized", errors });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row").length >= 9 && !!document.querySelector("#dkScatter svg"), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const items = await menuItems(page);
    eq(items, ["CSV", "SVG", "PNG"], "the desk offers its lines and its frontier chart");
    const csv = (await download(page, "CSV")).bytes.toString("utf8");
    const grid = parseCsv(csv.slice(1));
    eq(grid[0], ["Ticker", "Structure", "Expiry", "Days to expiry", "Strike (USD)", "Annualised yield (fraction)", "Collateral (USD)",
      "Win probability (implied) (fraction)", "Win probability (real-world) (fraction)", "Expected value, real world (USD)"], "the desk's lines export our own model outputs with their units");
    ok(grid.length >= 1 + 9 + 2, `every priced line is a row (${grid.length - 3})`);
    ok(grid.slice(1, -2).every((r) => r[0] === "NVDA" && /^(covered call|cash-secured put)$/.test(r[1]) && Number.isFinite(Number(r[4]))), "each row is a named structure at a numeric strike");
    ok(!grid[0].some((c) => /premium|bid|ask/i.test(c)), "and the vendor's quoted premium is not among them");
    await page.close();
  }
} finally {
  await browser.close();
}

assert.equal(errors.length, 0, "no page threw: " + errors.join("; "));
console.log(`✓ flows-export: ${checks} assertions — the CSV helper's quoting, byte order mark, units in the header, freshness footer and padded footer rows read back through an independent parser; cells beginning = + - @ tab or CR neutralised while numbers and U+2212 survive; null exports empty; the board's order, sort and filter followed; the map and the desk frontier serialised to standalone SVG and PNG; keyboard close; no page error`);
