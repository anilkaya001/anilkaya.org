import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { historyPage } from "../shared/flows-pages.js";
import { evaluateConviction } from "../shared/flows-conviction.js";
import { simulate } from "./conviction-sim.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const ROOT = new URL("../", import.meta.url);

const evaluated = (opts, sim) => evaluateConviction(sim.boards, sim.closes, sim.cal, {});
const KEEP = evaluated({}, simulate({ sessions: 100, b: 1.5, seed: 7 }));
const RELABEL = evaluated({}, simulate({ sessions: 100, b: 0, seed: 11 }));
const PENDING = evaluated({}, simulate({ sessions: 30, b: 1.5, seed: 3 }));
eq(KEEP.verdict, "keep", "fixture: the simulated book with a slope is kept");
eq(RELABEL.verdict, "relabel", "fixture: the simulated book without one is relabelled");
eq(PENDING.verdict, "pending", "fixture: the short archive is pending");

const RECORD = (conviction) => ({
  v: 1, generatedAt: "2026-09-06T02:00:00.000Z", sessionDate: "2026-09-05", status: "ok", statedHorizon: 10,
  retained: 90, firstSession: "2026-05-01", lastSession: "2026-09-04",
  horizons: [], sessions: [], epoch: null, epochRetained: null, priorRetained: null,
  features: { k: 10, minN: 20, sessionMinN: 20, rankedFrom: 30, ranked: 0, cols: [] },
  ...(conviction === undefined ? {} : { conviction }),
});

const browser = await chromium.launch();
const errors = [];

async function open(body, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/flows/record") return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/assets/")) {
      const file = await readFile(new URL("." + u.pathname, ROOT)).catch(() => null);
      if (file === null) return route.fulfill({ status: 404, body: "" });
      const type = u.pathname.endsWith(".css") ? "text/css" : u.pathname.endsWith(".js") ? "text/javascript" : "application/octet-stream";
      return route.fulfill({ contentType: type + "; charset=utf-8", body: file });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: historyPage({ username: "tester" }) });
  });
  await page.goto("https://x.test/flows/history/");
  await page.waitForSelector("#recConvMod", { timeout: 15000 });
  await page.waitForTimeout(200);
  return page;
}

const read = (page) => page.evaluate(() => {
  const mod = document.getElementById("recConvMod");
  return {
    title: mod.querySelector(".ui-mod-t").textContent.trim(),
    lead: document.getElementById("recConvLead").textContent,
    power: document.getElementById("recConvPower") ? document.getElementById("recConvPower").textContent : null,
    metrics: [...mod.querySelectorAll(".ui-metric")].map((m) => ({ label: m.querySelector(".ui-metric-l").textContent, value: m.querySelector(".ui-metric-v").textContent, sub: (m.querySelector(".ui-metric-s") || {}).textContent || "" })),
    state: mod.querySelector(".ui-mod-t .ui-state") ? mod.querySelector(".ui-mod-t .ui-state").dataset.state : null,
    overflow: document.documentElement.scrollWidth - innerWidth,
    inGrid: mod.parentElement.id,
  };
});

{
  const page = await open(RECORD(KEEP));
  const r = await read(page);
  eq(r.title, "Conviction", "keep: the module is named Conviction");
  ok(/keeps its name/.test(r.lead) && /above zero/.test(r.lead), `keep: and says why: ${r.lead}`);
  eq(r.metrics.length, 4, "keep: three terciles and the top-minus-bottom gap");
  eq(r.metrics.map((m) => m.label).join("|"), "Lowest third|Middle third|Highest third|Top minus bottom", "keep: in that order");
  const rates = r.metrics.slice(0, 3).map((m) => parseFloat(m.value));
  ok(rates[0] < rates[1] && rates[1] < rates[2], `keep: the hit rate rises across them (${rates.join(", ")})`);
  ok(r.metrics.every((m) => m.sub.length > 0), "keep: each carries its count and interval");
  ok(/^[+\u2212]\d+\.\d\s*pts$/.test(r.metrics[3].value), `keep: the gap is signed and in points (${r.metrics[3].value})`);
  ok(/standard error of \d+\.\d points/.test(r.power) && /could be detected|cannot be detected/.test(r.power), `keep: the page states what the sample can detect: ${r.power}`);
  ok(r.state === null, "keep: no state glyph on a verdict");
  eq(r.inGrid, "recApp", "keep: it sits in the record grid");
  eq(r.overflow, 0, "keep: no horizontal scroll at 1440");
  const info = await page.evaluate(() => { document.querySelector("#recConvMod .ui-info").click(); const t = document.getElementById("fxPop").textContent; window.FlowsUI.closeInfo(); return t; });
  ok(/Does conviction order outcomes\?/.test(info) && /equal-weight average/.test(info) && /session/.test(info) && /optimistic/.test(info), "keep: the info dialog carries the question, the market definition, the clustering and the overlap caveat");
  await page.close();
}

{
  const page = await open(RECORD(RELABEL));
  const r = await read(page);
  eq(r.title, "Agreement index", "relabel: the module is renamed");
  ok(/agreement index/.test(r.lead) && /does not clear its test/.test(r.lead), `relabel: and says so: ${r.lead}`);
  ok(/under about \d+\.\d points/.test(r.power), `relabel: it still states the smallest gap it could tell from none: ${r.power}`);
  await page.close();
}

{
  const page = await open(RECORD(PENDING), { width: 390, height: 800 });
  const r = await read(page);
  eq(r.title, "Conviction", "pending: the number keeps its name until there is a verdict");
  ok(/^Not yet evaluated\./.test(r.lead) && /60 sessions/.test(r.lead), `pending: ${r.lead}`);
  eq(r.state, "pending", "pending: with a pending state glyph on the module");
  eq(r.overflow, 0, "pending: no horizontal scroll at 390");
  ok(r.metrics.length >= 3, "pending: the estimates it has are shown, thin as they are");
  await page.close();
}

{
  const page = await open(RECORD(undefined), { width: 320, height: 700 });
  const r = await read(page);
  ok(/has not been run yet/.test(r.lead), `absent: an older record without the evaluation says it has not been run: ${r.lead}`);
  eq(r.metrics.length, 0, "absent: no numbers");
  eq(r.state, "pending", "absent: pending");
  eq(r.overflow, 0, "absent: no horizontal scroll at 320");
  await page.close();
}

{
  const page = await open(RECORD({ v: 1, status: "unavailable", verdict: "pending", label: "Conviction", reason: "the evaluation failed on this run", horizons: [] }));
  const r = await read(page);
  ok(/Not yet evaluated\. The evaluation failed on this run/.test(r.lead), `failed: ${r.lead}`);
  await page.close();
}

{
  const hostile = RECORD({ ...KEEP, label: "<img src=x onerror=window.__x=1>", notes: { rule: "<b>bold</b>", market: "m" }, reason: "<script>window.__y=1</script>" });
  const page = await open(hostile);
  const flags = await page.evaluate(() => ({ x: window.__x || 0, y: window.__y || 0, imgs: document.querySelectorAll("#recConvMod img, #recConvMod b, #recConvMod script").length }));
  eq(flags.x + flags.y + flags.imgs, 0, "hostile: a label, a note or a reason with markup is text and never an element");
  await page.close();
}

await browser.close();
eq(errors.length, 0, `no page errors: ${errors.join("; ")}`);
console.log(`flows-conviction-render: ${checks} checks passed`);
