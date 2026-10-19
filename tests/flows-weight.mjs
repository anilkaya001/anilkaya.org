import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import * as PAGES from "../shared/flows-pages.js";

const REPO = new URL("../", import.meta.url);
const sizeOf = (src) => statSync(new URL("." + src, REPO)).size;
const gzipOf = (src) => gzipSync(readFileSync(new URL("." + src, REPO)), { level: 9 }).length;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const TICKER_RAISE = { od: "OD-08", bytes: 1613, why: "FlowsUI.defer ships on every route that ships flows-ui.js and the ticker defers no group, so the raise is a debt that P2-18 pays with measured savings in its own PR" };
const KERNEL_LIMIT = { kib: 3.8, decision: "F-07 PR 1 measured FlowsUI.defer at 1.6 KB where section 2.10 ruling 8 counted 0.9 KB, so the V and L share of the kernel is stated as 3.8 KB instead of 3.1" };

const CEILING_KIB = {
  tickerPage: 411 + (6504 + 752) / 1024 + (411 + 6504 / 1024 + 2310 / 1024) - (411 + 6504 / 1024) + (411 + 6504 / 1024 + 2310 / 1024 + 265 / 1024) - (411 + 6504 / 1024 + 2310 / 1024) + (411 + 6504 / 1024 + 2310 / 1024 + 265 / 1024 - 65 / 1024) - (411 + 6504 / 1024 + 2310 / 1024 + 265 / 1024) + 405 / 1024 + 64 / 1024 + 702 / 1024 + 56300 / 1024 + 2400 / 1024 + 32000 / 1024 + 2348 / 1024 + 210 / 1024 + 1400 / 1024 + 5700 / 1024 + 2500 / 1024,
  overviewPage: 246 + 1483 / 1024 + (246 + 2327 / 1024) - (246) + (246 + 2327 / 1024 + 265 / 1024) - (246 + 2327 / 1024) + (246 + 2327 / 1024 + 265 / 1024 - 958 / 1024) - (246 + 2327 / 1024 + 265 / 1024) + 2322 / 1024 + 3600 / 1024,
  sidePage: 230 + 7778 / 1024 + (230 + 7778 / 1024 + 2327 / 1024) - (230 + 7778 / 1024) + (230 + 7778 / 1024 + 2327 / 1024 + 265 / 1024) - (230 + 7778 / 1024 + 2327 / 1024) + 2322 / 1024 + 608 / 1024 + 608 / 1024 + 1536 / 1024,
  watchPage: 230 + 7778 / 1024 + (230 + 7778 / 1024 + 2327 / 1024) - (230 + 7778 / 1024) + (230 + 7778 / 1024 + 2327 / 1024 + 265 / 1024) - (230 + 7778 / 1024 + 2327 / 1024) + 2322 / 1024 + 608 / 1024 + 608 / 1024 + 1536 / 1024,
  deskPage: 243 + 7093 / 1024 + (243 + 7093 / 1024 + 2327 / 1024) - (243 + 7093 / 1024) + (243 + 7093 / 1024 + 2327 / 1024 + 265 / 1024) - (243 + 7093 / 1024 + 2327 / 1024) + 2010 / 1024 + 360 / 1024 + 8400 / 1024,
  strategyPage: 261 + 5786 / 1024 + (261 + 5786 / 1024 + 2327 / 1024) - (261 + 5786 / 1024) + (261 + 5786 / 1024 + 2327 / 1024 + 265 / 1024) - (261 + 5786 / 1024 + 2327 / 1024) + 2010 / 1024,
  marketPage: 213 + 293 / 1024 + (213 + 2327 / 1024) - (213) + (213 + 2327 / 1024 + 265 / 1024) - (213 + 2327 / 1024) + (213 + 2327 / 1024 + 265 / 1024 - 939 / 1024) - (213 + 2327 / 1024 + 265 / 1024) + 2322 / 1024 + 846 / 1024 + 846 / 1024 + 9.5,
  unusualPage: 191 + (191 + 2327 / 1024) - (191) + (191 + 2327 / 1024 + 265 / 1024) - (191 + 2327 / 1024) + (191 + 2327 / 1024 + 265 / 1024 - 314 / 1024) - (191 + 2327 / 1024 + 265 / 1024) + 2322 / 1024 + 2000 / 1024 + 1300 / 1024 + 2400 / 1024,
  eventsPage: 155 + 5786 / 1024 + (155 + 5786 / 1024 + 2327 / 1024) - (155 + 5786 / 1024) + (155 + 5786 / 1024 + 2327 / 1024 + 265 / 1024) - (155 + 5786 / 1024 + 2327 / 1024) + 2010 / 1024,
  movesPage: 151 + 2322 / 1024,
  politicalPage: 118 + 2010 / 1024 + 700 / 1024,
  loginPage: 5,
  aboutPage: 5,
  glossaryPage: 5,
  statusPage: 80 + 1792 / 1024 + 24.5 + 9,
};

const GZIP_KIB = {
  tickerPage: 125 + (2126 + 226) / 1024 + (125 + 2126 / 1024 + 821 / 1024) - (125 + 2126 / 1024) + (125 + 2126 / 1024 + 821 / 1024 + 101 / 1024) - (125 + 2126 / 1024 + 821 / 1024) + 150 / 1024 + 15600 / 1024 + 800 / 1024 + 8800 / 1024 + 736 / 1024 + 420 / 1024 + 3500 / 1024,
  overviewPage: 82 - 7712 / 1024 + (82 - 7712 / 1024 + 830 / 1024) - (82 - 7712 / 1024) + (82 - 7712 / 1024 + 830 / 1024 + 101 / 1024) - (82 - 7712 / 1024 + 830 / 1024) + (82 - 7712 / 1024 + 830 / 1024 + 101 / 1024 - 288 / 1024) - (82 - 7712 / 1024 + 830 / 1024 + 101 / 1024) + 722 / 1024 + 1800 / 1024,
  sidePage: 69 + 2571 / 1024 + (69 + 2571 / 1024 + 830 / 1024) - (69 + 2571 / 1024) + (69 + 2571 / 1024 + 830 / 1024 + 101 / 1024) - (69 + 2571 / 1024 + 830 / 1024) + 722 / 1024 + 428 / 1024 + 428 / 1024,
  watchPage: 69 + 2571 / 1024 + (69 + 2571 / 1024 + 830 / 1024) - (69 + 2571 / 1024) + (69 + 2571 / 1024 + 830 / 1024 + 101 / 1024) - (69 + 2571 / 1024 + 830 / 1024) + 722 / 1024 + 428 / 1024 + 428 / 1024,
  deskPage: 80 + 1937 / 1024 + (80 + 1937 / 1024 + 830 / 1024) - (80 + 1937 / 1024) + (80 + 1937 / 1024 + 830 / 1024 + 101 / 1024) - (80 + 1937 / 1024 + 830 / 1024) + (80 + 1937 / 1024 + 830 / 1024 + 101 / 1024 + 10 / 1024) - (80 + 1937 / 1024 + 830 / 1024 + 101 / 1024) + 641 / 1024 + 680 / 1024 + 2900 / 1024,
  strategyPage: 83 + 1932 / 1024 + (83 + 1932 / 1024 + 830 / 1024) - (83 + 1932 / 1024) + (83 + 1932 / 1024 + 830 / 1024 + 101 / 1024) - (83 + 1932 / 1024 + 830 / 1024) + 641 / 1024,
  marketPage: 76 - 10914 / 1024 + (76 - 10998 / 1024 + 830 / 1024) - (76 - 10998 / 1024) + (76 - 10998 / 1024 + 830 / 1024 + 101 / 1024) - (76 - 10998 / 1024 + 830 / 1024) + (76 - 10998 / 1024 + 830 / 1024 + 101 / 1024 - 322 / 1024) - (76 - 10998 / 1024 + 830 / 1024 + 101 / 1024) + 722 / 1024 + 3.3,
  unusualPage: 87 - 30788 / 1024 + (87 - 30788 / 1024 + 830 / 1024) - (87 - 30788 / 1024) + (87 - 30788 / 1024 + 830 / 1024 + 101 / 1024) - (87 - 30788 / 1024 + 830 / 1024) + 722 / 1024 + 2000 / 1024,
  eventsPage: 34 + 1932 / 1024 + (34 + 1932 / 1024 + 830 / 1024) - (34 + 1932 / 1024) + (34 + 1932 / 1024 + 830 / 1024 + 101 / 1024) - (34 + 1932 / 1024 + 830 / 1024) + (34 + 1932 / 1024 + 830 / 1024 + 101 / 1024 - 98 / 1024) - (34 + 1932 / 1024 + 830 / 1024 + 101 / 1024) + 641 / 1024 + 2000 / 1024,
  movesPage: 47.5 + 722 / 1024,
  politicalPage: 37.5 + 641 / 1024,
  loginPage: 3,
  aboutPage: 3,
  glossaryPage: 3,
  statusPage: 27 + 9.5,
};

const CSS_KIB = {
  tickerPage: 103 + (565 + 1294) / 1024 + 1861 / 1024 + 320 / 1024 + 2107 / 1024 + 9900 / 1024 + 12150 / 1024 + 6400 / 1024 + 1030 / 1024 + 3600 / 1024,
  overviewPage: 104 + (779 + 11690) / 1024 + 300 / 1024 + 1700 / 1024 + 15400 / 1024,
  sidePage: 102 + 565 / 1024 + 1700 / 1024 + 2400 / 1024,
  watchPage: 102 + 565 / 1024 + 1700 / 1024 + 2400 / 1024,
  deskPage: 111 + 880 / 1024 + 1700 / 1024 + 8600 / 1024,
  strategyPage: 111 + 880 / 1024 + 1700 / 1024,
  marketPage: 94 + 1263 / 1024 + 1230 / 1024 + 160 / 1024 + 13.4 + 8.5 + 2000 / 1024 + 5.8,
  unusualPage: 113 + 5007 / 1024 + 1700 / 1024 + 6000 / 1024,
  eventsPage: 105 + 565 / 1024 + 160 / 1024 + 367 / 1024 + 367 / 1024 + 1500 / 1024 + 4700 / 1024,
  movesPage: 95.5 + 1700 / 1024,
  politicalPage: 100.5 + 1700 / 1024,
  loginPage: 80 + 565 / 1024 + 1700 / 1024,
  aboutPage: 81 + 565 / 1024 + 1700 / 1024,
  glossaryPage: 81 + 565 / 1024 + 1700 / 1024,
  statusPage: 82 + 7.5 + 5.5 + 1700 / 1024,
};

const CSS_GZIP_KIB = {
  tickerPage: 23 + (64 + 269) / 1024 + 308 / 1024 + 1400 / 1024 + 2900 / 1024 + 2700 / 1024,
  overviewPage: 23 + (100 + 2592) / 1024 + 400 / 1024 + 2400 / 1024,
  sidePage: 22 + 64 / 1024 + 400 / 1024,
  watchPage: 22 + 64 / 1024 + 400 / 1024,
  deskPage: 24 + 64 / 1024 + 400 / 1024 + 1500 / 1024,
  strategyPage: 24 + 64 / 1024 + 400 / 1024,
  marketPage: 21 + 206 / 1024 + 2516 / 1024 + 2516 / 1024 + 300 / 1024,
  unusualPage: 25 + 599 / 1024 + 400 / 1024 + 1800 / 1024,
  eventsPage: 23 + 64 / 1024 + 400 / 1024 + 1800 / 1024,
  movesPage: 21 + 400 / 1024,
  politicalPage: 22.5 + 400 / 1024,
  loginPage: 18 + 64 / 1024 + 400 / 1024,
  aboutPage: 18 + 64 / 1024 + 400 / 1024,
  glossaryPage: 18 + 64 / 1024 + 400 / 1024,
  statusPage: 18 + 4 + 400 / 1024,
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

const DEFERRED = {
  tickerPage: { groups: { surface: "/assets/js/flows-ticker-surface.js", movelab: "/assets/js/flows-ticker-movelab.js" } },
  unusualPage: { groups: { net: "/assets/js/flows-net.js", "flow-below": "/assets/js/flows-unusual-below.js" }, modules: ["uaTimelineCard", "uaNamesCard", "uaUrgencyCard", "uaFeedCard", "uaSurpriseCard"] },
  marketPage: { groups: { floor: "/assets/js/flows-market-floor.js", river: "/assets/js/flows-market-river.js", "market-below": "/assets/js/flows-market-below.js", net: "/assets/js/flows-net.js", netmap: "/assets/js/flows-net-map.js" }, modules: ["mkSectorsCard", "mkGroupsCard", "mkExpiryCard", "mkVolCard", "mkRadarCard", "mkAdvCard", "mkVolumeCard", "mkAgainstCard", "mkMoversCard", "mkOiCard", "mkDarkCard", "mkImpactCard", "mkInsidersCard", "mkSeasonCard"] },
  deskPage: { groups: { "desk-calls": "/assets/js/flows-desk-calls.js" } },
  statusPage: { groups: { "status-panels": ["/assets/js/flows-chart.js", "/assets/js/flows-status-latency.js", "/assets/js/flows-status-capacity.js", "/assets/js/flows-status-coverage.js"] } },
  overviewPage: { groups: { "home-below": "/assets/js/flows-overview-below.js", "home-net": "/assets/js/flows-net.js", "home-netmap": "/assets/js/flows-net-map.js" }, modules: ["hmChg", "hmVol", "hmEvents", "hmNews"] },
};
const SHARED_DEFERRED = {
  dock: { file: "/assets/js/flows-ask.js", declared: /<aside[^>]*\bid="askDock"[^>]*\bdata-src="([^"?]+)/ },
  link: { file: "/assets/js/flows-link.js", declared: null },
};
const GPU_ONLY = {};
const SHARED_GROUPS = new Set(["oracle"]);
const ORACLE_FILES = ["/assets/js/flows-oracle-core.js", "/assets/js/flows-oracle.js", "/assets/js/flows-oracle-boot.js"];
const ORACLE_DEFERRED_KIB = 60;
const ORACLE_MARKUP_BYTES = 720;
const DEFERRED_KIB = {
  tickerPage: 80 + (38836 + 18916) / 1024 + 23400 / 1024, overviewPage: 120 + 82272 / 1024 + 24200 / 1024, sidePage: 80, watchPage: 80, deskPage: 120, strategyPage: 80, marketPage: 322,
  unusualPage: 196 + 900 / 1024, eventsPage: 80, movesPage: 80, politicalPage: 80, loginPage: 0, aboutPage: 0, glossaryPage: 0, statusPage: 80 + 80 + 15 + 4,
};

const FLOOR_BYTES = 1024;
const EAGER_KERNEL = [
  { team: "V", name: "freshness pill", kib: 0.3, landed: { file: "/assets/js/flows-ui.js", has: /\bfreshAll\b/ } },
  { team: "V", name: "FlowsUI.defer", kib: 1.6, landed: { file: "/assets/js/flows-ui.js", has: /\bfunction defer\(/, from: /\n  const loadJs = /, to: /\n  const link = / } },
  { team: "V", name: "FlowsUI.link queue stub", kib: 0.4, landed: { file: "/assets/js/flows-ui.js", has: /\bconst link = / } },
  { team: "L", name: "frame scheduler core", kib: 1.5, landed: null },
  { team: "F", name: "Flow Radar stub", kib: 0.4, landed: null },
  { team: "F", name: "X-Basis", kib: 0.3, landed: null },
];
const NO_RELIEF_ROW = "no relief row yet (plan 5.7)";
const BELOW_FLOOR = {
  tickerPage: "OD-08",
  sidePage: NO_RELIEF_ROW,
  watchPage: NO_RELIEF_ROW,
  movesPage: NO_RELIEF_ROW,
  marketPage: NO_RELIEF_ROW,
  overviewPage: NO_RELIEF_ROW,
};

const LOADER = /createElement\(\s*["']script["']\s*\)|\bh\(\s*["']script["']|\bimport\(|new\s+Worker\(|importScripts\(/;
const LOADERS = new RegExp(LOADER.source, "g");

function declarationProblems(html, table, route) {
  const problems = [];
  const seen = new Map();
  const own = new Set([...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<i\b[^>]*\bdata-defer=[^>]*>/g)) {
    const tag = m[0];
    const group = (/\bdata-defer="([^"]*)"/.exec(tag) || [])[1];
    const src = (/\bdata-src="([^"]*)"/.exec(tag) || [])[1];
    if (!group) { problems.push("a deferred element has no group name"); continue; }
    if (!/\shidden(\s|>|=)/.test(tag)) problems.push(`${group}: the element is not hidden`);
    if (src === undefined) { problems.push(`${group}: no data-src`); continue; }
    if (/[\s,;|]/.test(src)) { problems.push(`${group}: one file per element, and ${JSON.stringify(src)} is a list the version scan cannot read past its first URL`); continue; }
    const m2 = /^(\/assets\/js\/[A-Za-z0-9._-]+\.js)\?v=\d+$/.exec(src);
    if (!m2) { problems.push(`${group}: ${src} is not a versioned /assets/js/ path`); continue; }
    const file = m2[1];
    if (own.has(file)) problems.push(`${group}: ${file} is also a script src of the route`);
    const listed = table.groups[group];
    if (listed === undefined) problems.push(`${group}: not in DEFERRED for ${route}`);
    else if (!(Array.isArray(listed) ? listed : [listed]).includes(file)) problems.push(`${group}: ${file} is not among DEFERRED's files for the group`);
    if (!seen.has(group)) seen.set(group, []);
    seen.get(group).push(file);
  }
  for (const [group, files] of Object.entries(table.groups)) {
    const want = Array.isArray(files) ? files : [files];
    const got = seen.get(group) || [];
    for (const f of want) if (!got.includes(f)) problems.push(`${group}: DEFERRED lists ${f} and the page declares no element for it`);
  }
  return problems;
}

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
    html = String(PAGES[name]({ username: "tester", ticker: "AAPL", net: true, scenes: name === "tickerPage" }));
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

  measured.push({ name, kib: bytes / 1024, raw: bytes, bytes, gzip, css, cssGzip, parts, html, srcs });
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
  const base = { name: "marketPage", raw: 232700, gzip: 70600, css: 126600, cssGzip: 24000 };
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
  const events = { name: "eventsPage", raw: 118228, gzip: 39938, css: 112895, cssGzip: 23776 };
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
    const CHART_ROUTES = ["deskPage", "marketPage", "overviewPage", "sidePage", "strategyPage", "tickerPage",
      "unusualPage", "watchPage"];
    const FREE_ROUTES = ["aboutPage", "eventsPage", "glossaryPage", "loginPage", "politicalPage"];
    const chartRoutes = measured.filter((m) => m.parts.some((p) => /^flows-chart\.js/.test(p))).map((m) => m.name).sort();
    eq(chartRoutes.join(", "), CHART_ROUTES.join(", "),
       "the chart library ships on exactly the eight routes that draw a chart, and the routes that draw none never download it");
    for (const name of FREE_ROUTES) {
      ok(pageNames.includes(name) && !chartRoutes.includes(name), `${name} does not link flows-chart.js`);
    }
    for (const name of CHART_ROUTES) {
      const html = String(PAGES[name]({ username: "tester", ticker: "AAPL", net: true, scenes: name === "tickerPage" }));
      const order = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
      const at = order.indexOf("/assets/js/flows-ui.js");
      ok(at >= 0 && order[at + 1] === "/assets/js/flows-chart.js",
         `${name} links flows-chart.js directly after flows-ui.js, so no script between them captures a FlowsUI without chart`);
      ok(/<script src="[^"]*flows-chart\.js\?v=\d+" defer><\/script>/.test(html), `${name} loads it deferred at the asset version`);
    }
    const core = sizeOf("/assets/js/flows-ui.js"), lib = sizeOf("/assets/js/flows-chart.js");
    console.log("  flows-ui.js " + core + " B, flows-chart.js " + lib + " B");
    ok(core < 70500, `flows-ui.js is the core alone (${core} B): the chart library is not in it`);
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

{
  const read = (src) => readFileSync(new URL("." + src, REPO), "utf8");
  const sizes = new Map();
  const bytesOf = (src) => { if (!sizes.has(src)) sizes.set(src, sizeOf(src)); return sizes.get(src); };

  console.log("  deferred JavaScript, uncompressed (allowance in KiB is stated, not derived):");
  for (const m of measured) {
    const table = DEFERRED[m.name] || { groups: {} };
    const problems = declarationProblems(m.html, table, m.name);
    eq(problems.join("; "), "", `${m.name} declares exactly the files DEFERRED lists for it, one per <i hidden data-defer data-src> element`);

    const files = [];
    for (const [group, list] of Object.entries(table.groups)) for (const f of Array.isArray(list) ? list : [list]) files.push({ f, how: "group " + group });
    const dockMatch = SHARED_DEFERRED.dock.declared.exec(m.html);
    if (dockMatch) {
      eq(dockMatch[1], SHARED_DEFERRED.dock.file, `${m.name}'s dock declares ${SHARED_DEFERRED.dock.file} and nothing else`);
      files.push({ f: dockMatch[1], how: "dock" });
    }
    if (m.srcs.includes("/assets/js/flows-ui.js")) files.push({ f: SHARED_DEFERRED.link.file, how: "link" });
    for (const f of GPU_ONLY[m.name] || []) files.push({ f, how: "gpu" });

    let total = 0;
    for (const { f } of files) {
      ok(existsSync(new URL("." + f, REPO)) && bytesOf(f) > 0, `${m.name}: deferred ${f} exists and is not empty`);
      ok(!m.srcs.includes(f), `${m.name}: ${f} is deferred and also a script src of the route, so it would be paid for twice`);
      total += bytesOf(f);
    }
    m.deferredBytes = total;
    m.deferredFiles = files;
    const allowance = DEFERRED_KIB[m.name];
    ok(allowance !== undefined, `${m.name} has a stated deferred allowance`);
    ok(total <= allowance * 1024,
       `${m.name} defers ${Math.round(total / 1024)}k (${files.map((x) => x.f.split("/").pop()).join(", ") || "nothing"}), inside its stated ${allowance}k allowance — a deferred file that grows is a decision`);
    ok(m.bytes + total <= (CEILING_KIB[m.name] + allowance) * 1024,
       `${m.name}: eager plus deferred plus GPU-only is ${Math.round((m.bytes + total) / 1024)}k, inside ceiling ${CEILING_KIB[m.name]}k plus allowance ${allowance}k`);
    console.log("    " + m.name.replace(/Page$/, "").padEnd(10) + String(Math.round(total / 1024)).padStart(4) + "k / " + String(allowance).padStart(2) + "k  " + files.map((x) => x.f.split("/").pop() + " (" + x.how + ")").join("  "));
  }
  for (const m of measured) {
    const table = DEFERRED[m.name];
    if (!table || !table.modules) continue;
    for (const id of table.modules) ok(new RegExp(`<section[^>]*\\bid="${id}"`).test(m.html), `${m.name}: the module ${id} that DEFERRED lists is a section of the page`);
    for (const [group, list] of Object.entries(table.groups)) {
      for (const f of Array.isArray(list) ? list : [list]) {
        const chunk = read(f);
        const attached = /\.attach\(\{([^}]*)\}\)/.exec(chunk);
        if (!attached) continue;
        const names = attached[1].split(",").map((x) => x.trim()).filter(Boolean);
        ok(names.length >= 4, `${m.name}: the ${group} chunk hands ${names.length} painters back`);
        for (const nme of names) {
          ok(new RegExp(`\\bfunction ${nme}\\(`).test(chunk), `${m.name}: ${nme} is defined in ${f.split("/").pop()}`);
          for (const src of m.srcs) {
            if (/flows-(ui|fresh|rt|dock)\.js$/.test(src)) continue;
            ok(!new RegExp(`\\bfunction ${nme}\\(`).test(read(src)), `${m.name}: and ${nme} is not also defined in the first-paint file ${src.split("/").pop()}`);
          }
        }
      }
    }
  }
  for (const name of Object.keys(DEFERRED)) ok(pageNames.includes(name), `DEFERRED names ${name}, a route that still exists`);
  for (const name of Object.keys(DEFERRED_KIB)) ok(pageNames.includes(name), `the allowance for ${name} guards a route that still exists`);

  {
    const bad = { groups: { net: "/assets/js/flows-net.js" } };
    const base = (extra) => `<script src="/assets/js/flows-ui.js?v=1" defer></script>${extra}`;
    const good = base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js?v=1"></i>');
    eq(declarationProblems(good, bad, "fixture").join("; "), "", "the declaration checker passes a well-formed element");
    const has = (html, table, text) => declarationProblems(html, table, "fixture").some((p) => p.includes(text));
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js?v=1 /assets/js/flows-x.js?v=1"></i>'), bad, "one file per element"),
       "A SPACE-SEPARATED data-src FAILS: the version scan cannot see a second URL in a list");
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js?v=1,/assets/js/flows-x.js?v=1"></i>'), bad, "one file per element"), "and so does a comma-separated one");
    ok(has(good, { groups: {} }, "not in DEFERRED"), "A DEFERRED FILE MISSING FROM THE DEFERRED TABLE FAILS");
    ok(has(base(""), bad, "declares no element"), "a table entry with no element on the page fails");
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-net.js"></i>'), bad, "not a versioned"), "an unversioned data-src fails");
    ok(has(base('<i data-defer="net" data-src="/assets/js/flows-net.js?v=1"></i>'), bad, "not hidden"), "an element that is not hidden fails");
    ok(has(`${good}<script src="/assets/js/flows-net.js?v=1" defer></script>`, bad, "also a script src"), "a file that is deferred and also a script src fails");
    ok(has(base('<i hidden data-defer="net" data-src="/assets/js/flows-other.js?v=1"></i>'), bad, "not among DEFERRED"), "a file other than the one the table names fails");
  }

  {
    const assetDir = new URL("assets/js/", REPO);
    const names = readdirSync(assetDir).filter((n) => /^flows-.*\.js$/.test(n));
    ok(names.includes("flows-ui.js") && names.includes("flows-dock.js") && names.length > 15, "the loader scan reads every flows-*.js file");
    const found = {};
    for (const n of names) {
      const src = readFileSync(new URL(n, assetDir), "utf8");
      const hits = [...src.matchAll(LOADERS)];
      if (hits.length) found[n] = { count: hits.length, at: hits.map((x) => x.index) };
    }
    eq(Object.keys(found).sort().join(", "), "flows-dock.js, flows-ui.js", "ONE LOADER: a script element or a dynamic import is created only by the dock and by FlowsUI.defer");
    eq(found["flows-dock.js"].count, 1, "the dock creates one script element");
    eq(found["flows-ui.js"].count, 1, "and flows-ui.js creates one, shared by FlowsUI.defer and the FlowsUI.link stub");
    const ui = read("/assets/js/flows-ui.js");
    const from = ui.indexOf("const loadJs = ");
    const to = ui.indexOf("const queued = ");
    ok(from > 0 && to > from && found["flows-ui.js"].at[0] > from && found["flows-ui.js"].at[0] < to, "and it sits in loadJs, the function FlowsUI.defer calls");
    const linkAt = ui.indexOf("const link = ");
    ok(linkAt > to && /loadJs\(me\.replace\("flows-ui\.js", "flows-link\.js"\)\)/.test(ui.slice(linkAt, linkAt + 700)), "the link stub loads its body through that same function");
    ok(/\bdefer,/.test(ui.slice(ui.lastIndexOf("window.FlowsUI = Object.freeze({"))), "FlowsUI.defer is exported");

    for (const m of measured) {
      const table = DEFERRED[m.name] || { groups: {} };
      const used = new Set();
      for (const src of m.srcs) {
        let code;
        try { code = read(src); } catch { continue; }
        for (const g of code.matchAll(/\.defer\(\s*["']([\w-]+)["']/g)) used.add(g[1]);
      }
      const extra = [...used].filter((g) => table.groups[g] === undefined && !SHARED_GROUPS.has(g));
      eq(extra.join(", "), "", `${m.name} defers only what DEFERRED lists for it (${Object.keys(table.groups).join(", ") || "nothing"})`);
    }
    const oracleBytes = ORACLE_FILES.reduce((a, f) => a + sizeOf(f), 0);
    ok(oracleBytes > 0 && oracleBytes <= ORACLE_DEFERRED_KIB * 1024, `the Neuron's two files weigh ${oracleBytes} B, inside their stated ${ORACLE_DEFERRED_KIB} KiB, and load only when a page carries its markup`);
    for (const m of measured) {
      if (!m.parts.some((p) => /^flows-dock\.js/.test(p))) continue;
      const shelled = PAGES.oracleShell(m.html, "on", "overview");
      const added = shelled.length - m.html.length;
      ok(added > 0 && added <= ORACLE_MARKUP_BYTES + 400, `${m.name}: the Neuron's placeholder adds ${added} B of markup`);
      eq(PAGES.oracleShell(m.html, "off", "overview"), m.html, `${m.name}: with the switch off the page is untouched`);
    }
    const dossier = read("/assets/js/flows-ticker.js");
    ok(!LOADER.test(dossier), "the dossier creates no script element of its own");
    eq(/\.defer\(/.test(dossier), Object.keys(DEFERRED.tickerPage.groups).length > 0,
       "and calls FlowsUI.defer only if DEFERRED.tickerPage lists a group");
  }

  {
    const kernelV = EAGER_KERNEL.filter((k) => k.team !== "F").reduce((a, k) => a + k.kib, 0);
    ok(kernelV <= KERNEL_LIMIT.kib + 1e-9, `the shared eager kernel of teams V and L is ${kernelV.toFixed(1)} KB, at most ${KERNEL_LIMIT.kib} (${KERNEL_LIMIT.decision})`);
    for (const k of EAGER_KERNEL) {
      if (!k.landed) continue;
      const src = read(k.landed.file);
      ok(k.landed.has.test(src), `kernel entry "${k.name}" is marked landed and is in ${k.landed.file}`);
      if (k.landed.from) {
        const a = src.search(k.landed.from), b = src.search(k.landed.to);
        ok(a >= 0 && b > a, `kernel entry "${k.name}" has a measurable span in ${k.landed.file}`);
        const kib = Buffer.byteLength(src.slice(a, b)) / 1024;
        ok(Math.abs(kib - k.kib) <= 0.15, `kernel entry "${k.name}" is stated at ${k.kib} KB and measures ${kib.toFixed(2)} KB, so the ledger says what landed`);
      }
    }
    if (TICKER_RAISE) {
      const grouped = Object.entries(DEFERRED.tickerPage.groups).filter(([g]) => g !== "surface" && g !== "movelab").map(([, f]) => f).flat().reduce((a, f) => a + bytesOf(f), 0);
      ok(TICKER_RAISE.bytes <= 1613, `the ticker's raise (${TICKER_RAISE.od}) is at most the 1,613 B it was made with`);
      ok(grouped < TICKER_RAISE.bytes, `THE TICKER'S ${TICKER_RAISE.bytes} B RAISE STAYS ONLY WHILE THE TICKER DEFERS LESS THAN IT: ${grouped} B of group files are deferred; once they reach the raise, delete TICKER_RAISE (${TICKER_RAISE.od}) and the ceiling returns to 400 KiB`);
      console.log(`  ticker ceiling carries a pending ${TICKER_RAISE.od} deduction of ${TICKER_RAISE.bytes} B: ${TICKER_RAISE.why}`);
    }
    for (const k of EAGER_KERNEL) {
      if (k.landed) continue;
      const hit = readdirSync(new URL("assets/js/", REPO)).filter((n) => /^flows-.*\.js$/.test(n)).filter((n) => /\bFlowsUI\.(scheduler|frame)\b|\bX-Basis\b|\bflowRadarStub\b/.test(readFileSync(new URL("assets/js/" + n, REPO), "utf8")));
      eq(hit.join(", "), "", `kernel entry "${k.name}" is pending and absent from the tree, so the list cannot claim bytes already counted`);
    }
    const pending = EAGER_KERNEL.filter((k) => !k.landed).reduce((a, k) => a + k.kib * 1024, 0);
    console.log(`  eager headroom against the 1 KiB floor, with the ${(pending / 1024).toFixed(1)} KB of pending kernel entries still to land on a live route:`);
    const live = (m) => m.srcs.includes("/assets/js/flows-rt.js");
    const below = [];
    for (const m of [...measured].sort((a, b) => (CEILING_KIB[a.name] * 1024 - a.bytes) - (CEILING_KIB[b.name] * 1024 - b.bytes))) {
      const headroom = Math.round(CEILING_KIB[m.name] * 1024 - m.bytes);
      const after = live(m) ? Math.round(headroom - pending) : headroom;
      console.log("    " + m.name.replace(/Page$/, "").padEnd(10) + String(headroom).padStart(7) + " B now" + (live(m) ? String(after).padStart(8) + " B after the kernel" : "") + (after < FLOOR_BYTES ? "   BELOW THE FLOOR" + (BELOW_FLOOR[m.name] ? " (" + BELOW_FLOOR[m.name] + ")" : "") : ""));
      ok(headroom >= 0, `${m.name} has non-negative headroom`);
      if (after < FLOOR_BYTES) below.push(m.name);
    }
    eq(below.sort().join(", "), Object.keys(BELOW_FLOOR).sort().join(", "),
       "THE ROUTES BELOW THE 1 KiB FLOOR ARE EXACTLY THE ONES NAMED WITH A RELIEF ROW: a route that falls under it without a named relief fails, and a route that gets back over it must leave the list, so the list only shrinks on purpose");
  }
}

console.log(`✓ flows-weight: ${checks} assertions — every route's JavaScript weighed from the ` +
  `HTML it actually emits rather than from a list that could go stale, every emitted script ` +
  `proven to exist so a deferred 404 cannot leave a route a silent shell, a stated ceiling ` +
  `per route and no ceiling without a route, the table printed on every run so the number ` +
  `lives in the log of a build that passed, and the deferred renderer proven to fit inside ` +
  `no dock route's headroom`);
