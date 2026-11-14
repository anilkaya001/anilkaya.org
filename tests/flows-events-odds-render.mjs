import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { buildEvents } from "../shared/flows-events.js";
import { eventsPage } from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SESSION = "2026-08-24";
const ORIGIN = "2026-08-26";
const EVENTS_JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-events.js"), "utf8");
const HTML = eventsPage({ username: "test", odds: true }).replace(/<script[^>]*><\/script>/g, "");

const print = (at, event) => ({ at, day: at.slice(0, 10), sd: 1, event, type: "report", tag: null, prev: 1.1, prevRaw: "1.1%", forecast: -0.3, forecastRaw: "-0.3%", period: "August" });
const A = print(ORIGIN + "T12:30:00.000Z", "Durable Goods");
const B = print(ORIGIN + "T14:00:00.000Z", "New Home Sales");
const CAL = buildEvents([], { gateOrigin: ORIGIN, sessionDate: SESSION });
CAL.macro = { status: "ok", rows: [A, B], seen: 2, past: 0 };
CAL.catalysts = { status: "ok", rows: [] };

const ODDS = { odds: { events: [
  { at: A.at, event: A.event, markets: [{ price: 0.62, thin: false, resolved: true, basis: "mid" }] },
  { at: B.at, event: B.event, markets: [{ price: 0.4, thin: true, resolved: false, basis: "last" }] },
] } };

async function open(browser, { odds = "ok", js = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const asked = [];
  page.on("pageerror", () => {});
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: HTML }));
  await page.addInitScript(([pl, od, mode]) => {
    window.__asked = [];
    const answer = (o) => ({ ...o, clone: () => ({ text: () => Promise.resolve("") }) });
    window.fetch = (url) => {
      const u = String(url);
      window.__asked.push(u);
      if (u.indexOf("/api/flows/events") >= 0) return Promise.resolve(answer({ ok: true, status: 200, headers: { get: () => String(Date.now()) }, json: () => Promise.resolve(pl) }));
      if (u.indexOf("part=odds") >= 0) {
        if (mode === "503") return Promise.resolve(answer({ ok: false, status: 503, headers: { get: () => null }, json: () => Promise.resolve({}) }));
        return Promise.resolve(answer({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(od) }));
      }
      return Promise.resolve(answer({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ status: "pending" }) }));
    };
  }, [CAL, ODDS, odds]);
  await page.goto("https://x.test/flows/events/", { waitUntil: "domcontentloaded" });
  for (const sheet of ["assets/css/base.css", "assets/css/flows.css", "assets/css/flows-feeds.css"]) await page.addStyleTag({ path: path.join(ROOT, sheet) });
  await page.addScriptTag({ path: path.join(ROOT, "assets/js/flows-ui.js") });
  await page.addScriptTag({ content: js || EVENTS_JS });
  await page.waitForFunction(() => !/^Loading/.test(document.getElementById("evStatus").textContent), null, { timeout: 15000 });
  await page.waitForTimeout(200);
  return page;
}

const cells = (page) => page.evaluate(() => [...document.querySelectorAll("#evMacro .fe-modd")].map((c) => ({ text: c.textContent.trim(), title: c.title })));
const retry = (page) => page.evaluate(() => document.querySelectorAll("#evMacro .fe-modd-retry").length);

const browser = await launch();
try {
  {
    const page = await open(browser);
    const c = await cells(page);
    eq(c.length, 2, "two market cells are drawn");
    ok(/^Resolved 62%/.test(c[0].text) && /final price/.test(c[0].title), "a resolved market is marked resolved with its final price");
    ok(/40%/.test(c[1].text) && /Last traded price/.test(c[1].title) && /Thin market: under \$50K/.test(c[1].title), "a last-traded thin market says so with the spec's wording");
    eq(await retry(page), 0, "no Retry button when the read worked");
    await page.close();
  }
  {
    const page = await open(browser, { odds: "503" });
    const c = await cells(page);
    ok(c.length === 2 && c.every((x) => x.text.startsWith("—") && /read failed \(HTTP 503\)/.test(x.title) && !/No prediction market matches/.test(x.text + x.title)), "a failed read is a dash with its reason, never 'no market'");
    eq(await retry(page), 1, "and the module offers one Retry");
    eq(await page.evaluate(() => document.querySelector("#evMacro .fe-modd-retry").closest("[aria-hidden='true'], [inert]") === null), true, "the Retry button is reachable: not inside an aria-hidden or inert node");
    const before = await page.evaluate(() => window.__asked.filter((u) => u.indexOf("part=odds") >= 0).length);
    await page.evaluate(() => document.querySelector("#evMacro .fe-modd-retry").click());
    await page.waitForTimeout(200);
    eq(await page.evaluate(() => window.__asked.filter((u) => u.indexOf("part=odds") >= 0).length), before + 1, "Retry asks for the market prices again");
    eq(await page.evaluate(() => /\bnull\b/.test(document.getElementById("evMacro").textContent)), false, "no null child is printed");
    await page.close();
  }
  const fails = [
    ["a failure drawn as no market", [['S.oddsFail = "The market-price read failed (" + why + "); this is not an empty table.";', "S.oddsFail = null;"]], "503"],
    ["a Retry hidden from assistive technology", [['h("span", V, "Market price") : null),', 'h("span", V, "Market price", ...(S.oddsFail ? [h("button", { type: "button", class: "fe-modd-retry" }, "Retry")] : [])) : null),'], ['...(oddsOn() && S.oddsFail ? [', '...(false ? [']], "503"],
    ["a resolved price drawn as live", [['(mk.resolved ? "Resolved " : "") + ', ""]], "ok"],
  ];
  for (const [name, edits, mode] of fails) {
    let src = EVENTS_JS;
    for (const [from, to] of edits) { eq(src.split(from).length, 2, `the planted build "${name}" applies exactly once`); src = src.replace(from, () => to); }
    const page = await open(browser, { odds: mode, js: src });
    const c = await cells(page);
    const reachable = await page.evaluate(() => { const b = document.querySelector("#evMacro .fe-modd-retry"); return !!b && b.closest("[aria-hidden='true'], [inert]") === null; });
    const caught = mode === "503"
      ? !(c.length === 2 && c.every((x) => /read failed/.test(x.title)) && reachable)
      : !/^Resolved/.test(c[0].text);
    ok(caught, `PLANTED WRONG BUILD caught: ${name}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-events-odds-render: ${checks} checks`);
