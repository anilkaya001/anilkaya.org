/* =============================================================
   flows-legacy-payload.mjs — the transitional state, which is a
   CERTAINTY rather than an edge case.

   The Worker deploys new assets the moment a change merges; the next
   pipeline run is hours later. In between, the new renderers are
   reading the OLD payload. That window has to be designed, not hoped
   through, because the failure it produces is the quietest kind: a
   number that still parses, still draws, and no longer means what it
   says.

   The concrete case this file was written for: fam.V and fam.O were
   SIGNED family votes in [-100, 100] and became UNSIGNED gauges in
   [0, 100]. The live board carried "O": 53 on one name and "O": -22 on
   another. Drawn by the new renderer with no version check, the first
   becomes a 53%-full gauge labelled "no direction" and the second a
   negative-width bar under the number -22 — both of them confident,
   neither of them true.

   So both payloads carry a schema version, and both renderers withhold
   exactly the fields whose meaning moved, and say so. Fields that did
   not change meaning keep rendering.

   The fixtures below are REAL: live-card.json is a card this pipeline
   actually published, and the board rows are the shape that was live
   when this was written.
   ============================================================= */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startWorker, FLOWS_PASSWORD, FLOWS_TEST_USER } from "./worker-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "shot-token-aaaaaaaaaaaaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;

/* A REAL published card, trimmed to what a renderer touches — every bar and
   tick row is genuine, only thinned. Kept as a fixture rather than
   hand-written, because a hand-written v1 card would carry whatever the author
   remembered of the old shape, and the whole point is to test against what was
   actually out there. */
const legacyCard = JSON.parse(
  fs.readFileSync(path.join(HERE, "fixtures-flows-v1-card.json"), "utf8"));
legacyCard.generatedAt = new Date().toISOString();
if (legacyCard.v !== 1) throw new Error(`fixture drifted: expected a v1 card, got v${legacyCard.v}`);

// A v1 board: exactly the shape that is published right now.
const legacyBoard = {
  side: "long", generatedAt: new Date().toISOString(), sessionDate: "2026-08-25",
  status: "ok", universe: 264, enriched: 60,
  rows: [
    { t: "INTC", r: 1, s: 84, cnv: 79, px: 87.26, chg: 0.012, purity: 0.006,
      gRegime: "short", gFlipDist: -0.1087, netPrem: -1.3e7,
      fam: { F: -73, P: -78, D: -69, V: 0, O: 53 } },
    { t: "GOOG", r: 2, s: 65, cnv: 79, px: 344.59, chg: -0.004, purity: 0.031,
      gRegime: "short", gFlipDist: -0.2831, netPrem: 1.1e7,
      fam: { F: 16, P: 53, D: 35, V: 0, O: -22 } },
  ],
};

const post = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(body),
});
await post("board:long", legacyBoard);
await post("card:INTC", legacyCard);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto(url("/flows/"), { waitUntil: "networkidle" });
await page.fill("#u", FLOWS_TEST_USER);
await page.fill("#p", FLOWS_PASSWORD);
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.click(".flows-submit")]);
await page.waitForSelector(".fd-card");

// The table's family glyph must withhold V and O on a v1 board.
await page.click('.flows-view[data-view="table"]');
const glyph = await page.evaluate(() => {
  const cell = document.querySelector(".fb-fam");
  return {
    label: cell.getAttribute("aria-label"),
    nullMarks: cell.querySelectorAll("i.is-null").length,
    bars: cell.querySelectorAll("i").length,
  };
});


await page.click('.flows-view[data-view="deck"]');
await page.click('.fd-card[data-t="INTC"]');
await page.waitForSelector("#fcWhy .fc-fam li");
const fam = await page.evaluate(() => [...document.querySelectorAll("#fcWhy .fc-fam li")].map((li) => ({
  k: li.querySelector(".fc-fam-k").textContent,
  v: li.querySelector(".fc-fam-v").textContent,
  note: li.querySelector(".fc-fam-l").textContent,
  width: getComputedStyle(li.querySelector(".fc-fam-track i")).width,
})));
const legacyNote = await page.evaluate(() =>
  [...document.querySelectorAll("#fcWhy .fc-note")].some((n) => n.textContent.includes("built before")));


// No negative or absurd widths anywhere on the card.
const bad = await page.evaluate(() => [...document.querySelectorAll("#fcWhy .fc-fam-track i")]
  .map((i) => getComputedStyle(i).width).filter((w) => w.startsWith("-")));


/* THE OTHER SIDE OF THE BOUNDARY. A test that only checks v1 cannot catch v2
   regressing into silence — withholding everything always passes a
   "withholds the moved fields" assertion. So the same renderer is handed a
   current payload and must draw the gauges it just refused to draw. */
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

const currentCard = JSON.parse(JSON.stringify(legacyCard));
currentCard.v = 2;
currentCard.ticker = "CURR";
currentCard.fam = { F: -73, P: -78, D: -69, V: 59, O: 71 };
currentCard.weights = { F: 2.1, P: 0.9, D: 0.8 };
currentCard.conv = { agreement: 1, breadth: 3, coverage: 1, gate: 1.42 };
const currentBoard = JSON.parse(JSON.stringify(legacyBoard));
currentBoard.v = 2;
currentBoard.rows = [{ ...legacyBoard.rows[0], t: "CURR", fam: currentCard.fam }];
await post("board:long", currentBoard);
await post("card:CURR", currentCard);

await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('.fd-card[data-t="CURR"]');
await page.click('.fd-card[data-t="CURR"]');
await page.waitForSelector("#fcWhy .fc-fam li");
const famV2 = await page.evaluate(() => [...document.querySelectorAll("#fcWhy .fc-fam li")].map((li) => ({
  k: li.querySelector(".fc-fam-k").textContent,
  v: li.querySelector(".fc-fam-v").textContent,
  gauge: li.classList.contains("is-gauge"),
  width: getComputedStyle(li.querySelector(".fc-fam-track i")).width,
})));
const v2 = (k) => famV2.find((f) => f.k === k);
const px = (w) => parseFloat(w) || 0;
const legacyNoteOnV2 = await page.evaluate(() =>
  [...document.querySelectorAll("#fcWhy .fc-note")].some((n) => n.textContent.includes("built before")));

const assertions = [
  [fam.find((f) => f.k === "V").v === "—", "V is withheld on a v1 card"],
  [fam.find((f) => f.k === "O").v === "—", "O is withheld on a v1 card"],
  [fam.find((f) => f.k === "F").v === "−73", "F still renders, because its meaning did not change"],
  [legacyNote, "and the card says why"],
  [bad.length === 0, "no negative bar widths"],
  [glyph.nullMarks === 2, "the table glyph marks V and O absent"],
  // ...and the same renderer draws them on a current payload.
  [v2("V").v === "59" && v2("O").v === "71", "a v2 card publishes both gauges"],
  [v2("V").gauge && v2("O").gauge, "and draws them as gauges, not signed axes"],
  [px(v2("V").width) > 10 && px(v2("O").width) > 10,
    `with real width (V ${v2("V").width}, O ${v2("O").width})`],
  [!legacyNoteOnV2, "and without the legacy explanation"],
  [v2("F").v === "−73", "signed axes are unaffected by the version"],
  [errors.length === 0, "no page errors: " + errors.join(" | ")],
];
let failed = 0;
for (const [passed, msg] of assertions) {
  if (!passed) {
    failed++;
    console.error("FAIL: " + msg);
    console.error("  families rendered: " +
      fam.map((f) => `${f.k}=${f.v}(${f.width})`).join(" ") +
      "  |  v2: " + famV2.map((f) => `${f.k}=${f.v}(${f.width})`).join(" "));
    console.error("  table glyph: " + glyph.label);
  }
}
console.log(failed
  ? `✗ flows-legacy: ${failed} of ${assertions.length} transitional assertions FAILED`
  : `✓ flows-legacy: ${assertions.length} assertions — both sides of the schema boundary — a v1 payload withholds the two fields whose meaning moved and says why, a v2 payload draws them as gauges`);
await browser.close();
await server.stop();
process.exit(failed ? 1 : 0);
