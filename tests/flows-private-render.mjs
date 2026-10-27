import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { macroPayload, ROOT } from "./lib/macro-world.mjs";
import { project } from "../server/routes/flows-macro.js";
import { pmCardSection } from "../shared/flows-private.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const TICKER_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
const LENS_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker-private.js"), "utf8");

const ON = PAGES.tickerPage({ username: "u", privateLens: true });
const OFF = PAGES.tickerPage({ username: "u" });
ok(/<i hidden data-defer="private" data-src="\/assets\/js\/flows-ticker-private\.js\?v=\d+" data-css="\/assets\/css\/flows-ticker-private\.css\?v=\d+" id="ftPrivate"><\/i>/.test(ON), "the ticker page declares the lens as one hidden, versioned group with its own sheet");
ok(!/ftPrivate|flows-ticker-private/.test(OFF), "with the switch off the page carries no trace of the lens");
ok(!/<script[^>]+flows-ticker-private/.test(ON), "and never ships it as a script");
ok(/\.defer\("private", \{ when: "visible"/.test(TICKER_SRC) && /function buildPrivate\(card\) \{\s*if \(isIndex\(card\) \|\| !UI\.defer \|\| !\$\("ftPrivate"\)\) return;/.test(TICKER_SRC), "the controller defers the group when the module nears the viewport, and only for a name that is not an index or a fund, and only if the page declares it");
ok(!/vendor|tape|unusual whales/i.test(LENS_SRC), "no provider name and no tape in the lens");
ok(!/leader[^"\n]*\bname/i.test(LENS_SRC.replace(/\{n\} disclosed leaders; names are not shown\./, "")), "the lens never reads a leader's name");

const NOW = Date.parse("2026-10-27T21:40:00Z");

function pmPayload(world) {
  const sectors = {
    Robotics: { status: "ok", listed: 12, cursor: 12, profiled: 3, complete: "2026-10-26", top: [
      ["SYPM01", "Sample Robotics", 1250000000, 41, 18.42, "2026-10-20", 0.1234, ["2026-06-01", "Series D", 300000000], 7, ["Industrial"]],
      ["SYPM02", "Sample Dynamics", 640000000, 22, null, null, null, null, null, []],
      ["SYPM03", "Sample Motion", 300000000, 9, 7.1, "2026-09-30", -0.05, ["2026-01-12", "Series B", 80000000], 3, []],
    ] },
    Quiet: { status: "unmatched", listed: 0, cursor: 0, profiled: 0, complete: "2026-10-26", top: [] },
    Locked: { status: "plan", listed: 0, cursor: 0, profiled: 0, complete: null, top: [] },
  };
  return { v: 1, session: "2026-10-27", generatedAt: "2026-10-27T21:00:00Z", fixture: true, sectors, investors: { asOf: "2026-10-27", n: 0, top: [] }, basis: { calls: 10, plan: false }, ...(world || {}) };
}

async function open(browser, { sector, pm, body = null, status = 200, viewport = { width: 1440, height: 820 }, patch = null }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const calls = [];
  await page.clock.install({ time: NOW });
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/base.css"><link rel="stylesheet" href="/assets/css/flows.css"></head><body class="flows-body"><main class="flows-main" id="flowsMain"><div id="slot" style="container-type:inline-size"></div><i hidden data-defer="private" data-src="/assets/js/flows-ticker-private.js" data-css="/assets/css/flows-ticker-private.css" id="ftPrivate"></i></main><script src="/assets/js/flows-ui.js"></script></body></html>`;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) src = src.replaceAll(from, to);
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/macro") {
      calls.push(u.pathname + u.search);
      if (status !== 200) return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code: "invalid_part", message: "no" } }) });
      const payload = pmPayload();
      const want = u.searchParams.get("sector");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body || project(payload, "pm", want)) });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
  await page.goto("https://example.test/flows/ticker/");
  await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.defer);
  await page.evaluate(({ sector, pm }) => window.FlowsUI.defer("private").then(() => window.FlowsUI.privateLens.mount(document.getElementById("slot"), { sector, pm })), { sector, pm });
  await page.waitForTimeout(300);
  return { page, context, errors, calls };
}

const section = (opts) => pmCardSection({ at: NOW - 86400000, session: "2026-10-27", ...opts });
const browser = await launch();

const MATCHED = section({ match: { name: "Sample Fund", companyCount: 11 }, companies: [["SYPM01", "Sample Robotics", "Robotics"], ["SYPM02", "Sample Dynamics", "Robotics"]] });
{
  const { page, context, errors, calls } = await open(browser, { sector: "Robotics", pm: MATCHED });
  const text = await page.evaluate(() => document.getElementById("slot").innerText);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".pl-row")].map((r) => [...r.children].map((c) => c.textContent.trim())));
  ok(text.includes("Disclosed investor in 11 private companies."), "the investor line prints the count from the card section");
  ok(text.includes("Sample Robotics") && text.includes("Sample Dynamics"), "and lists the companies it names");
  eq(rows.length, 3, "the peers table has one row for each profiled company");
  eq(rows[0], ["Sample Robotics", "$1.25B", "41", "18.42 Oct 20", "+12.3%", "Series D · Jun 1 · $300M", "7"], "the first peer's figures equal the payload through an independent formatter");
  eq(rows[1].slice(3, 7), ["—", "—", "—", "—"], "a peer with no mark, change, round or leaders count shows dashes, never zeros");
  ok(text.includes("The feed's implied per-share price on the date shown; not a trade."), "the mark line sits under the table");
  ok(text.includes("Profiles read for 3 of 12 companies listed in this sector."), "the coverage sentence prints profiled and listed");
  ok(!/Leader|leader name|Chief|CEO/i.test(text.replace("7", "")), "no leader name appears");
  eq(calls, ["/api/flows/macro?part=pm&sector=Robotics"], "exactly one request, for the card's sector");
  eq(errors, [], "no page error");
  const wide = await page.evaluate(() => { const b = document.querySelectorAll(".pl-blk"); return b.length === 2 && b[1].getBoundingClientRect().left > b[0].getBoundingClientRect().left; });
  ok(wide, "at 1440 px the two blocks sit side by side");
  await context.close();
}

{
  const { page, context } = await open(browser, { sector: "Robotics", pm: MATCHED, viewport: { width: 390, height: 844 } });
  const stacked = await page.evaluate(() => { const b = document.querySelectorAll(".pl-blk"); return b[1].getBoundingClientRect().top > b[0].getBoundingClientRect().bottom - 1; });
  ok(stacked, "at 390 px the blocks stack");
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok(!over, "and nothing scrolls sideways");
  await context.close();
}

for (const [name, sector, line] of [["unmatched", "Quiet", "The feed lists no private companies under this sector name."], ["plan", "Locked", "Private-markets data needs a feed plan the site does not hold."]]) {
  const { page, context } = await open(browser, { sector, pm: section({ match: null, why: "none" }) });
  const text = await page.evaluate(() => document.getElementById("slot").innerText);
  ok(text.includes(line), `the ${name} sector says so in words`);
  eq(await page.evaluate(() => document.querySelectorAll(".pl-row, .pl-tbl").length), 0, `and draws no empty table for ${name}`);
  ok(text.includes("Not listed as a disclosed private-markets investor."), `${name}: an unmatched investor says it is not listed`);
  await context.close();
}

{
  const { page, context } = await open(browser, { sector: "Elsewhere", pm: null, status: 400 });
  const text = await page.evaluate(() => document.getElementById("slot").innerText);
  ok(text.includes("The feed lists no private companies under this sector name."), "a sector the payload does not hold is unmatched, not an error");
  ok(text.includes("The private-markets read is not published yet."), "and a missing card section is pending");
  await context.close();
}

{
  const { page, context } = await open(browser, { sector: "Robotics", pm: MATCHED, body: { status: "pending", why: "not_published" } });
  const text = await page.evaluate(() => document.getElementById("slot").innerText);
  ok(text.includes("The private-markets read is not published yet."), "an unpublished payload is pending");
  await context.close();
}

{
  const stale = pmCardSection({ at: NOW - 70 * 86400000, session: "2026-08-10", match: { name: "Sample Fund", companyCount: 11 }, companies: [] });
  const { page, context } = await open(browser, { sector: "Robotics", pm: stale });
  const text = await page.evaluate(() => document.getElementById("slot").innerText);
  ok(!text.includes("Disclosed investor in 11"), "an investor section past its maximum age is not printed");
  await context.close();
}

async function planted(name, patch, check, opts = {}) {
  const { page, context } = await open(browser, { sector: "Robotics", pm: MATCHED, patch, ...opts });
  let failed = false;
  try { await check(page); } catch { failed = true; }
  await context.close();
  ok(failed, `PLANTED WRONG BUILD caught: ${name}`);
}

const FILE = "/assets/js/flows-ticker-private.js";
await planted("a mark printed without its date", { [FILE]: [['F.px(r.price, 2) + (r.priceDate ? " " + r.priceDate : "")', "F.px(r.price, 2)"]] }, async (page) => {
  const rows = await page.evaluate(() => [...document.querySelectorAll(".pl-row")].map((r) => r.children[3].textContent.trim()));
  eq(rows[0], "18.42 Oct 20", "mark");
});
await planted("a missing change printed as zero", { [FILE]: [['const signed = (v) => (v === null ? DASH :', 'const signed = (v) => (v === null ? "+0.0%" :']] }, async (page) => {
  const rows = await page.evaluate(() => [...document.querySelectorAll(".pl-row")].map((r) => r.children[4].textContent.trim()));
  eq(rows[1], "—", "change");
});
await planted("leaders' names shown", { [FILE]: [['cell("pl-l r", "Leaders", r.leaders === null ? DASH : String(r.leaders))', 'cell("pl-l r", "Leaders", r.leaders === null ? DASH : "Chief Founder")']] }, async (page) => {
  const text = await page.evaluate(() => document.getElementById("slot").innerText);
  ok(!/Chief/.test(text), "names");
});
await planted("unmatched drawn as an empty table", { [FILE]: [['if (entry.status === "unmatched" || !Array.isArray(entry.top) || !entry.top.length) return { state: "unmatched", line: say("unmatched") };', ""], ['if (!rows.length) return { state: "unmatched", line: say("unmatched") };', ""]] }, async (page) => {
  const text = await page.evaluate(() => document.getElementById("slot").innerText);
  ok(text.includes("The feed lists no private companies under this sector name."), "unmatched");
}, { sector: "Quiet" });
await planted("a second request for the same sector", { [FILE]: [["const ctl = typeof AbortController", "fetch('/api/flows/macro?part=pm&sector=' + encodeURIComponent(sector)); const ctl = typeof AbortController"]] }, async (page) => {
  eq(await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.includes("/api/flows/macro")).length), 1, "one request");
});

await browser.close();
console.log(`flows-private-render: ${checks} checks`);
