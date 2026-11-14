import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, firefox } from "playwright";
import * as PAGES from "../shared/flows-pages.js";
import { erPayload, eventsPayload, NOW } from "./lib/er-world.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const MODULES = ["erRiskCard", "erIssuesCard", "erPolicyCard", "erHaltsCard"];
const SIZES = [{ width: 1920, height: 1080 }, { width: 1440, height: 820 }, { width: 1024, height: 768 }, { width: 390, height: 844 }];

let checks = 0;
let planted = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const engines = [["chromium", chromium]];
for (const [name, type] of [["webkit", webkit], ["firefox", firefox]]) {
  try {
    const b = await type.launch();
    await b.close();
    engines.push([name, type]);
  } catch (error) {
    if (process.env.ER_ENGINES === "all") throw new Error(`${name} is required (ER_ENGINES=all) and did not launch: ${String(error.message).split("\n")[0]}`);
    console.log(`  skipped ${name}: not installed (set ER_ENGINES=all to require it)`);
  }
}

const SAMPLER = `
(() => {
  const ids = ${JSON.stringify(["fdTabs", ...MODULES])};
  window.__fp = [];
  window.__frames = 0;
  const take = () => {
    const row = { t: performance.now(), data: !!window.__dataIn, boxes: {} };
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      row.boxes[id] = [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
    }
    window.__fp.push(row);
    window.__frames++;
    requestAnimationFrame(take);
  };
  requestAnimationFrame(take);
})();
`;

async function firstPaint(type, size, { patch = null } = {}) {
  const browser = await type.launch();
  const context = await browser.newContext({ viewport: size, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const html = PAGES.eventsPage({ username: "test", eventrisk: true, halts: true });
  const payload = erPayload();
  const { out: events } = eventsPayload();
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.addInitScript(SAMPLER);
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) {
          if (src.split(from).length !== 2) throw new Error("planted build anchor not found once: " + from.slice(0, 60));
          src = src.replace(from, to);
        }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/api/flows/eventrisk") {
      await gate;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
    }
    if (u.pathname === "/api/flows/events") return route.fulfill({ contentType: "application/json", body: JSON.stringify(events) });
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", rows: [] }) });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.clock.install({ time: NOW });
  await page.goto("https://example.test/flows/events/#view=risk");
  await page.waitForFunction(() => document.querySelector("#erRisk [data-er-load]") && document.querySelector("#evWeek .fe-week, #evWeek .ui-silent, #evWeek [data-state]") && document.fonts.status === "loaded", null, { timeout: 20000 });
  await page.evaluate(() => { window.__fp = []; window.__frames = 0; });
  await page.waitForFunction(() => window.__frames >= 4, null, { timeout: 20000 });
  const skeleton = await page.evaluate(() => window.__fp.length);
  await page.evaluate(() => { window.__dataIn = true; });
  release();
  await page.waitForFunction(() => document.querySelector("#erRisk .er-row, #erRisk .ui-silent"), null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  const rows = await page.evaluate(() => window.__fp);
  await browser.close();
  return { rows, skeleton, errors };
}

const drift = (rows) => {
  const first = rows[0] ? rows[0].boxes : {};
  let worst = 0;
  let where = null;
  for (const r of rows) {
    for (const [id, b] of Object.entries(r.boxes)) {
      const a = first[id];
      if (!a) continue;
      for (let i = 0; i < 4; i++) {
        const d = Math.abs(b[i] - a[i]);
        if (d > worst) { worst = d; where = `${id}[${["left", "top", "width", "height"][i]}] ${a[i]} to ${b[i]}`; }
      }
    }
  }
  return { worst, where };
};

for (const [name, type] of engines) {
  for (const size of SIZES) {
    const run = await firstPaint(type, size);
    const label = `${name} ${size.width}x${size.height}`;
    ok(run.errors.length === 0, `${label}: no page error (${run.errors.join("; ")})`);
    ok(run.skeleton >= 4, `${label}: the skeleton drew ${run.skeleton} frames before the data was let through`);
    const before = run.rows.filter((r) => !r.data);
    const after = run.rows.filter((r) => r.data);
    ok(after.length >= 4, `${label}: and frames were sampled after it (${after.length})`);
    ok(MODULES.every((id) => run.rows.at(-1).boxes[id]), `${label}: all four event-risk modules are laid out`);
    const d = drift([...before, ...after]);
    ok(d.worst <= 1, `${label}: FROM THE SKELETON TO THE DATA NO MODULE AND NOT THE TABLIST MOVES BY MORE THAN 1 PX (worst ${d.worst}${d.where ? ", " + d.where : ""})`);
  }
}

const builds = [
  ["a notice inserted above the tabs when the data lands", { "/assets/js/flows-er.js": [["  function chip() {\n", "  function chip() {\n    const tabs = document.getElementById(\"fdTabs\");\n    if (tabs && !document.getElementById(\"erLate\")) tabs.before(Object.assign(document.createElement(\"p\"), { id: \"erLate\", textContent: \"Event risk loaded.\" }));\n"]] }],
  ["a module that grows with its rows", { "/assets/css/flows-er.css": [[".er-days {", "#erRiskCard { height: auto !important; min-height: 0 !important; }\n.er-days {"]] }],
];
for (const [name, patch] of builds) {
  let worst = 0;
  for (const size of [{ width: 1440, height: 820 }, { width: 390, height: 844 }]) {
    const run = await firstPaint(chromium, size, { patch });
    worst = Math.max(worst, drift(run.rows).worst);
  }
  ok(worst > 1, `PLANTED WRONG BUILD, ${name}: a module moves by ${worst} px and the check fails it`);
  planted++;
}

console.log(`flows-er-firstpaint: ${checks} checks — the four event-risk modules and the tablist held to within 1 px from the served skeleton to the data in ${engines.map(([n]) => n).join(", ")} at ${SIZES.length} sizes, the data held until four frames of the skeleton drew, and ${planted} planted wrong builds failed`);
