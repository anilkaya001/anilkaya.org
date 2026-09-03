/* =============================================================
   flows-weight.mjs — what each route actually ships.

   THE ONE NUMBER NOBODY TOOK. This product's owner asked for it to
   be "blazing fast", and every performance conversation in this
   repository has been about the PIPELINE: the vendor's rate limit,
   the sleep that overlapped nothing, the eight sorts per column. All
   of that is real and all of it happens at 05:15 in a runner nobody
   is watching.

   The speed a reader actually experiences is the other one, and it
   had never been measured: the bytes a browser must fetch, parse and
   compile before a single panel draws. Both bundles on the deepest
   route are `defer`, so they do not block the parser — and then they
   run, in order, before anything appears.

   WHY A BUDGET AND NOT A BENCHMARK. A timing benchmark on shared CI
   measures the runner's mood: it passes on a quiet box, flakes on a
   loaded one, and proves nothing either way. Bytes are exact, they
   are the input the timing is a function of, and a route that grew
   by a hundred kilobytes did so in a diff somebody wrote. This suite
   turns "blazing fast" from an aspiration into a number that fails a
   build when it moves the wrong way.

   THE LIST IS DERIVED, NEVER TYPED. Every route's scripts are read
   out of the HTML the page function actually emits, so a route that
   gains a bundle is measured with it on the next run rather than
   whenever somebody remembers to update a list here. A hand-written
   inventory of what each page loads is a second copy of a fact the
   page already states, and this repository's own history is a
   catalogue of what happens to those.

   THE CEILINGS ARE A RATCHET, NOT A TARGET. Each is set above
   today's measurement with room for ordinary work, so a route has to
   grow materially before it trips. Tripping one is not a failure to
   fix by raising it: it is a prompt to ask whether the route needed
   what it just gained. Raising a ceiling is a decision, and it should
   look like one in a diff.
   ============================================================= */
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import * as PAGES from "../shared/flows-pages.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* Per-route ceilings in KiB of UNCOMPRESSED JavaScript. Uncompressed because
   that is what the browser parses and compiles: transfer is gzipped and is
   roughly a quarter of this, but the parse is not, and the parse is the part
   that happens on the reader's own CPU before anything draws.

   Measured 2026-09-03, ratcheted with headroom:

     ticker    365k   the deepest route, and the heaviest by a wide margin
     overview  233k   the LANDING page — the first screen of the section
     side      214k
     watch     182k
     desk       85k
     market     72k
     unusual    61k
     events     60k
     track      51k
     political  28k
     history    26k
     login       3k

   The shape of the problem is visible in the table rather than in any one
   row: one 137k panel bundle appears on four routes, three of which are not
   the panel workspace. It is there for the card overlay a deep link opens,
   which most visitors to those three routes never open. */
const CEILING_KIB = {
  tickerPage: 420,
  overviewPage: 280,
  sidePage: 260,
  watchPage: 230,
  deskPage: 110,
  marketPage: 95,
  unusualPage: 85,
  eventsPage: 85,
  trackPage: 75,
  politicalPage: 45,
  historyPage: 45,
  loginPage: 12,
};

/* Every exported page function, found rather than listed — so a route added
   without a ceiling fails here instead of shipping unmeasured. */
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

  /* Scripts with a src only. An inline script is bytes too, but it arrives
     inside the HTML this same function emitted and is counted by the document
     size rather than by a separate fetch. */
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1].split("?")[0]);

  ok(srcs.length > 0, `${name} emits at least one script, so the measurement has a subject`);

  let bytes = 0;
  const parts = [];
  for (const src of srcs) {
    /* THE SCRIPT MUST EXIST. A rename or a moved file that misses one page
       yields a 404 for a deferred script, which fails silently: the document
       renders, no renderer runs, and the route is a shell with a spinner that
       never resolves. Nothing throws and nothing overflows. */
    let size = null;
    try { size = statSync("." + src).size; } catch { size = null; }
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

/* THE TABLE IS THE DELIVERABLE. Printed on every run so the number exists in
   the log of a build that passed, not only in the message of one that failed. */
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

/* NO CEILING WITHOUT A ROUTE, either: a stale entry here would quietly stop
   guarding anything while still reading as a guard. */
for (const name of Object.keys(CEILING_KIB)) {
  ok(pageNames.includes(name),
     `the ceiling for ${name} guards a route that still exists — a stale entry reads as a ` +
     `budget and enforces nothing`);
}

/* THE SHAPE OF THE PROBLEM, ASSERTED RATHER THAN LEFT TO THE EYE. The heaviest
   route is heavier than the lightest non-trivial one by an order of magnitude,
   and one bundle carries most of that difference across four routes. This is
   not a failure — it is the fact the table exists to keep visible, and it is
   pinned so that a change which fixes it is visible as a change. */
{
  const heaviest = measured[0];
  const panelRoutes = measured.filter((m) => m.parts.some((p) => /^flows-panels\.js/.test(p)));
  ok(heaviest.kib > 300,
     `the heaviest route still ships over 300k (${Math.round(heaviest.kib)}k on ` +
     `${heaviest.name}) — asserted as a STANDING FACT rather than as a target, so that the ` +
     `day someone splits that bundle this line fails and has to be rewritten deliberately ` +
     `rather than the improvement passing unnoticed`);
  ok(panelRoutes.length >= 3,
     `the panel bundle is loaded on ${panelRoutes.length} routes, most of which are not the ` +
     `panel workspace — it is there for the card overlay a deep link opens, which most ` +
     `visitors to those routes never open`);
}

console.log(`✓ flows-weight: ${checks} assertions — every route's JavaScript weighed from the ` +
  `HTML it actually emits rather than from a list that could go stale, every emitted script ` +
  `proven to exist so a deferred 404 cannot leave a route a silent shell, a stated ceiling ` +
  `per route and no ceiling without a route, and the table printed on every run so the number ` +
  `lives in the log of a build that passed`);
