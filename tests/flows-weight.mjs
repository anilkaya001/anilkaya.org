import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync } from "node:fs";
import * as PAGES from "../shared/flows-pages.js";

const REPO = new URL("../", import.meta.url);
const sizeOf = (src) => statSync(new URL("." + src, REPO)).size;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const CEILING_KIB = {
  tickerPage: 350,
  overviewPage: 226,
  sidePage: 183,
  watchPage: 183,
  deskPage: 226,
  askPage: 172,
  strategyPage: 243,
  trackPage: 163,
  marketPage: 207,
  unusualPage: 169,
  eventsPage: 154,
  politicalPage: 143,
  historyPage: 157,
  loginPage: 5,
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
    parts.push(src.split("/").pop() + " " + Math.round(size / 1024) + "k");
  }

  measured.push({ name, kib: bytes / 1024, parts });
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
