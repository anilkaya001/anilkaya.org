import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync, appendFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import * as PAGES from "../shared/flows-pages.js";

const REPO = new URL("../", import.meta.url);
const sizeOf = (src) => statSync(new URL("." + src, REPO)).size;
const gzipOf = (src) => gzipSync(readFileSync(new URL("." + src, REPO)), { level: 9 }).length;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const CEILING_KIB = {
  tickerPage: 400,
  overviewPage: 265,
  sidePage: 220,
  watchPage: 220,
  deskPage: 234,
  askPage: 133,
  strategyPage: 251,
  trackPage: 164,
  marketPage: 242,
  unusualPage: 204 + (57017 + 13882 + 4176 + 830 + 189 + 95 + 843) / 1024,
  eventsPage: 155,
  politicalPage: 104,
  historyPage: 157,
  loginPage: 5,
};

const GZIP_KIB = {
  tickerPage: 122,
  overviewPage: 80,
  sidePage: 65,
  watchPage: 65,
  deskPage: 77,
  askPage: 39,
  strategyPage: 81,
  trackPage: 51,
  marketPage: 72,
  unusualPage: 85,
  eventsPage: 34,
  politicalPage: 31,
  historyPage: 48,
  loginPage: 3,
};

const CSS_KIB = {
  tickerPage: 113,
  overviewPage: 115,
  sidePage: 113,
  watchPage: 113,
  deskPage: 123,
  askPage: 105,
  strategyPage: 123,
  trackPage: 104,
  marketPage: 105,
  unusualPage: 123,
  eventsPage: 116,
  politicalPage: 116,
  historyPage: 104,
  loginPage: 91,
};

const CSS_GZIP_KIB = {
  tickerPage: 25,
  overviewPage: 26,
  sidePage: 25,
  watchPage: 25,
  deskPage: 27,
  askPage: 24,
  strategyPage: 27,
  trackPage: 24,
  marketPage: 24,
  unusualPage: 28,
  eventsPage: 26,
  politicalPage: 26,
  historyPage: 24,
  loginPage: 21,
};

const RATCHET_KIB = { raw: 12, gzip: 3, css: 3, cssGzip: 3 };
const HELD_RAW_KIB = { eventsPage: 50 };

const BASES = [
  { key: "raw", label: "JS raw", ceilings: CEILING_KIB },
  { key: "gzip", label: "JS gzip", ceilings: GZIP_KIB },
  { key: "css", label: "CSS raw", ceilings: CSS_KIB },
  { key: "cssGzip", label: "CSS gzip", ceilings: CSS_GZIP_KIB },
];

const judge = (row, bases = BASES) => {
  const faults = [];
  for (const base of bases) {
    const ceiling = base.ceilings[row.name];
    if (ceiling === undefined) { faults.push(`${row.name} has no ${base.label} ceiling`); continue; }
    const used = row[base.key];
    if (used > ceiling * 1024) {
      faults.push(`${row.name} ${base.label} ${used} B is over its ${ceiling} KiB ceiling`);
    }
    const slackLimit = base.key === "raw" && HELD_RAW_KIB[row.name] !== undefined
      ? HELD_RAW_KIB[row.name] : RATCHET_KIB[base.key];
    if (ceiling * 1024 - used > slackLimit * 1024) {
      faults.push(`${row.name} ${base.label} ceiling ${ceiling} KiB sits ${Math.round((ceiling * 1024 - used) / 1024)} KiB ` +
        `above ${used} B, past the ${slackLimit} KiB the ratchet allows`);
    }
  }
  return faults;
};

const pageNames = Object.keys(PAGES)
  .filter((k) => typeof PAGES[k] === "function" && /Page$/.test(k))
  .sort();

ok(pageNames.length >= 12,
   `every page function is discovered from the module rather than listed here ` +
   `(${pageNames.length} found) — a route added without a ceiling below fails this suite ` +
   `rather than shipping unmeasured`);

const measured = [];

for (const name of pageNames) {
  let html;
  try {
    html = String(PAGES[name]({ username: "tester", ticker: "AAPL" }));
  } catch (error) {
    assert.fail(`${name} threw while rendering: ${error && error.message}`);
  }

  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1].split("?")[0]);

  ok(srcs.length > 0, `${name} emits at least one script, so the measurement has a subject`);

  let bytes = 0;
  let gzip = 0;
  const parts = [];
  for (const src of srcs) {

    let size = null;
    try { size = sizeOf(src); } catch { size = null; }
    ok(size !== null,
       `${name} emits ${src} and that file exists — a deferred script that 404s leaves the ` +
       `route a shell with no renderer, and it fails silently: the document renders, nothing ` +
       `draws, and no error reaches anything that watches`);
    if (size === null) continue;
    ok(size > 0, `${src} is not empty`);
    bytes += size;
    gzip += gzipOf(src);
    parts.push(src.split("/").pop() + " " + Math.round(size / 1024) + "k");
  }

  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1].split("?")[0]);
  ok(hrefs.length > 0, `${name} emits at least one stylesheet, so the CSS measurement has a subject`);
  let css = 0;
  let cssGzip = 0;
  for (const href of hrefs) {
    let size = null;
    try { size = sizeOf(href); } catch { size = null; }
    ok(size !== null, `${name} links ${href} and that file exists`);
    if (size === null) continue;
    css += size;
    cssGzip += gzipOf(href);
  }

  measured.push({ name, kib: bytes / 1024, raw: bytes, gzip, css, cssGzip, parts });
}

measured.sort((a, b) => b.kib - a.kib);
console.log("  route JavaScript, uncompressed:");
for (const m of measured) {
  const ceiling = CEILING_KIB[m.name];
  console.log(
    "    " + String(Math.round(m.kib)).padStart(4) + "k" +
    (ceiling ? " / " + String(ceiling) + "k" : "  (no ceiling)") +
    "  " + m.name.replace(/Page$/, "").padEnd(10) + m.parts.join("  "));
}

{
  const kib = (n) => (n / 1024).toFixed(1);
  const rows = [...measured].sort((a, b) => a.name.localeCompare(b.name));
  const head = ["route", "JS raw", "JS gzip", "CSS raw", "CSS gzip"];
  const line = (cells) => "  " + cells.map((c, i) => (i === 0 ? String(c).padEnd(10) : String(c).padStart(22))).join("");
  console.log("  weight ledger, KiB used / ceiling (headroom):");
  console.log(line(head));
  const table = [];
  for (const m of rows) {
    const cells = BASES.map((b) => `${kib(m[b.key])} / ${b.ceilings[m.name]} (${kib(b.ceilings[m.name] * 1024 - m[b.key])})`);
    console.log(line([m.name.replace(/Page$/, ""), ...cells]));
    table.push("| " + [m.name.replace(/Page$/, ""), ...cells].join(" | ") + " |");
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        "\n### Flows weight ledger, KiB used / ceiling (headroom)\n\n| route | JS raw | JS gzip | CSS raw | CSS gzip |\n|---|---|---|---|---|\n" +
        table.join("\n") + "\n");
    } catch {}
  }
}

for (const m of measured) {
  const faults = judge(m);
  eq(faults.join("; "), "",
     `${m.name} is inside all four ceilings and no ceiling hangs loose of it. Raw JavaScript stays the binding ` +
     `basis (parse and compile cost follows raw bytes); gzip and CSS ceilings sit 2-3 KiB above the measurement. ` +
     `A change that saves bytes lowers the ceiling in the same diff, so the saving cannot be spent by the next ` +
     `change unseen; one that adds them raises it in the diff where it can be argued`);
}

{
  const base = { name: "marketPage", raw: 241587, gzip: 71322, css: 104614, cssGzip: 21713 };
  eq(judge(base).join("; "), "", "the ledger judge passes today's market route");
  ok(judge({ ...base, gzip: base.gzip + 8 * 1024 }).length > 0,
     "the judge fails a route inflated by 8 KiB of gzip");
  ok(judge({ ...base, raw: base.raw + 8 * 1024 }).length > 0, "the judge fails a route inflated by 8 KiB raw");
  ok(judge({ ...base, css: base.css + 8 * 1024 }).length > 0, "the judge fails a stylesheet inflated by 8 KiB");
  ok(judge({ ...base, cssGzip: base.cssGzip + 8 * 1024 }).length > 0, "the judge fails a stylesheet inflated by 8 KiB of gzip");
  ok(judge({ ...base, gzip: base.gzip - 8 * 1024 }).length > 0,
     "the ratchet fails a route that saved 8 KiB of gzip and left its ceiling where it was");
  ok(judge({ ...base, raw: base.raw - 13 * 1024 }).length > 0,
     "the ratchet fails a route that saved 13 KiB raw and left its ceiling where it was");
  ok(judge({ ...base, name: "nowhere" }).length === 4, "a route with no ceilings fails on all four bases");
  const events = { name: "eventsPage", raw: 108054, gzip: 32662, css: 116236, cssGzip: 23788 };
  eq(judge(events).join("; "), "", "events, whose ceiling is held for the earnings strip, passes with its wide raw headroom");
  eq(Object.keys(HELD_RAW_KIB).join(", "), "eventsPage", "events is the only route whose raw ceiling is held above the ratchet");
}

for (const name of Object.keys(CEILING_KIB)) {
  for (const t of [GZIP_KIB, CSS_KIB, CSS_GZIP_KIB]) {
    ok(Object.prototype.hasOwnProperty.call(t, name) && Object.keys(t).length === Object.keys(CEILING_KIB).length,
       `${name} has an entry in every ceiling table and no table has a stray one`);
  }
}

for (const m of measured) {
  const ceiling = CEILING_KIB[m.name];
  ok(ceiling !== undefined,
     `${m.name} has a stated ceiling — a route measured at ${Math.round(m.kib)}k with no ` +
     `budget is a route nobody chose the size of`);
  if (ceiling === undefined) continue;
  ok(m.kib <= ceiling,
     `${m.name} ships ${Math.round(m.kib)}k of JavaScript, inside its ${ceiling}k ceiling. ` +
     `If this fails, the question is whether the route needed what it just gained — raising ` +
     `the ceiling is a decision and should look like one in the diff`);
}

for (const name of Object.keys(CEILING_KIB)) {
  ok(pageNames.includes(name),
     `the ceiling for ${name} guards a route that still exists — a stale entry reads as a ` +
     `budget and enforces nothing`);
}

{
  const heaviest = measured[0];
  const panelRoutes = measured.filter((m) => m.parts.some((p) => /^flows-panels\.js/.test(p)));
  const dossierRoutes = measured.filter((m) => m.parts.some((p) => /^flows-ticker\.js/.test(p)));
  ok(heaviest.kib > 250,
     `the heaviest route still ships over 250k (${Math.round(heaviest.kib)}k on ` +
     `${heaviest.name}) — asserted as a STANDING FACT rather than as a target, so that the ` +
     `day someone splits that bundle this line fails and has to be rewritten deliberately ` +
     `rather than the improvement passing unnoticed`);

  eq(panelRoutes.length, 0,
     `no route links flows-panels.js (${panelRoutes.map((m) => m.name).join(", ") || "none"}) — the panel ` +
     `library was deleted when the ticker dossier was rebuilt on FlowsUI, and its renderers now live in ` +
     `the dossier's own controller`);
  ok(!existsSync(new URL("assets/js/flows-panels.js", REPO)), "and the file itself is gone, not orphaned");
  eq(dossierRoutes.map((m) => m.name).join(", "), "tickerPage",
     `the dossier's renderers ship on exactly one route — the bundle they replaced was on four, and on ` +
     `three of them the only thing that ever reached it was the card dialog: none of flows-overview.js, ` +
     `flows-board.js or flows-watch.js contains the string FlowsPanels, and on /flows/watch/ not even the ` +
     `dialog did, because that page minted no opener for its delegation to find`);
}

{

  {
    for (const route of measured) {
      ok(!route.parts.some((part) => /^flows-drawers\.js/.test(part)),
         `no route links flows-drawers.js (${route.name}) — it was the deferred half of the old panel library`);
    }
    ok(!existsSync(new URL("assets/js/flows-drawers.js", REPO)),
       "and it is deleted rather than orphaned: its drawers were folded into the dossier's modules");
    const dossier = readFileSync(new URL("assets/js/flows-ticker.js", REPO), "utf8");
    ok(!/createElement\(\s*["']script["']\s*\)|import\(/.test(dossier),
       "the dossier defers no script of its own, so the ticker row above counts every byte the page " +
       "runs — the old page arrived at 422k and fetched 89k of drawers after it, which this table never saw");
  }

  {
    const ui = readFileSync(new URL("assets/js/flows-chart.js", REPO), "utf8");
    const exported = ui.match(/const chart = Object\.freeze\(\{([\s\S]*?)\}\);/);
    ok(exported && /\bline\b/.test(exported[1]) && /\bLEVELS\b/.test(exported[1]),
       "the chart export list is found, so the next line reads it rather than nothing");
    const dead = ["cone", "levels", "area"].filter((name) => new RegExp("\\b" + name + "\\b").test(exported[1]));
    eq(dead.join(", "), "",
       "FlowsUI.chart exports none of cone, levels or area: no page drew them, and they shipped on every Flows route");
    ok(!/function (cone|levels|area)\(/.test(ui), "and their bodies are deleted, not merely unexported");
    for (const route of measured) {
      ok(!route.parts.some((part) => /^flows-cursor\.js/.test(part)), `no route links flows-cursor.js (${route.name})`);
    }
    ok(!existsSync(new URL("assets/js/flows-cursor.js", REPO)), "and flows-cursor.js is deleted rather than orphaned");
  }

  {
    const CHART_ROUTES = ["deskPage", "historyPage", "marketPage", "overviewPage", "sidePage", "strategyPage", "tickerPage", "trackPage",
      "unusualPage", "watchPage"];
    const FREE_ROUTES = ["askPage", "eventsPage", "loginPage", "politicalPage"];
    const chartRoutes = measured.filter((m) => m.parts.some((p) => /^flows-chart\.js/.test(p))).map((m) => m.name).sort();
    eq(chartRoutes.join(", "), CHART_ROUTES.join(", "),
       "the chart library ships on exactly the ten routes that draw a chart, and the routes that draw none never download it");
    for (const name of FREE_ROUTES) {
      ok(pageNames.includes(name) && !chartRoutes.includes(name), `${name} does not link flows-chart.js`);
    }
    for (const name of CHART_ROUTES) {
      const html = String(PAGES[name]({ username: "tester", ticker: "AAPL" }));
      const order = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
      const at = order.indexOf("/assets/js/flows-ui.js");
      ok(at >= 0 && order[at + 1] === "/assets/js/flows-chart.js",
         `${name} links flows-chart.js directly after flows-ui.js, so no script between them captures a FlowsUI without chart`);
      ok(/<script src="[^"]*flows-chart\.js\?v=\d+" defer><\/script>/.test(html), `${name} loads it deferred at the asset version`);
    }
    const core = sizeOf("/assets/js/flows-ui.js"), lib = sizeOf("/assets/js/flows-chart.js");
    console.log("  flows-ui.js " + core + " B, flows-chart.js " + lib + " B");
    ok(core < 60000, `flows-ui.js is the core alone (${core} B): the chart library is not in it`);
    ok(!/const chart = Object\.freeze|function (drawLine|diverging|heatmap|payoff|sparkline)\(/.test(readFileSync(new URL("assets/js/flows-ui.js", REPO), "utf8")),
       "and none of the chart drawing functions is left behind in the core");
  }

  const askBytes = sizeOf("/assets/js/flows-ask.js");
  const askKib = Math.round(askBytes / 1024);
  const dockRoutes = measured.filter((m) => m.parts.some((p) => /^flows-dock\.js/.test(p)));
  const spare = (m) => (CEILING_KIB[m.name] - m.kib) * 1024;
  const wouldFit = dockRoutes.filter((m) => spare(m) >= askBytes);
  eq(wouldFit.length, 0,
     `flows-ask.js (${askKib}k) fits inside the headroom of NONE of the ` +
     `${dockRoutes.length} routes the dock ships on — the whole reason the dock defers it`);
}

console.log(`✓ flows-weight: ${checks} assertions — every route's JavaScript weighed from the ` +
  `HTML it actually emits rather than from a list that could go stale, every emitted script ` +
  `proven to exist so a deferred 404 cannot leave a route a silent shell, a stated ceiling ` +
  `per route and no ceiling without a route, the table printed on every run so the number ` +
  `lives in the log of a build that passed, and the deferred renderer proven to fit inside ` +
  `no dock route's headroom`);
