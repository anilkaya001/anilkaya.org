import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startWorker, FLOWS_PASSWORD, FLOWS_TEST_USER } from "./worker-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "shot-token-aaaaaaaaaaaaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;

const legacyCard = JSON.parse(
  fs.readFileSync(path.join(HERE, "fixtures-flows-v1-card.json"), "utf8"));
legacyCard.generatedAt = new Date().toISOString();
if (legacyCard.v !== 1) throw new Error(`fixture drifted: expected a v1 card, got v${legacyCard.v}`);

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
{
  const { signFlowsSession } = await import("../shared/flows-auth.js");
  const { SESSION_SECRET } = await import("./worker-server.mjs");
  const cookie = { Cookie: "flows_session=" + await signFlowsSession(FLOWS_TEST_USER, SESSION_SECRET, 600, "1") };
  const served = await fetch(url("/api/flows/board?side=long"), { headers: cookie });
  const body = await served.json();
  if (body.rows.length !== 2) throw new Error("the legacy board is served whole");
  if (served.headers.get("x-fresh-session") !== "2026-08-25" || served.headers.get("x-fresh-class") !== "nightly" ||
      !served.headers.get("x-fresh-read-at")) {
    throw new Error("a legacy payload that predates the fresh envelope still gets its X-Fresh-* headers, derived from " +
      "sessionDate and generatedAt: " + JSON.stringify(Object.fromEntries(served.headers)));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const UNSHIPPED = /^\/api\/flows\/(universe|lk)$/;
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const where = m.location() && m.location().url ? new URL(m.location().url).pathname : "";
  if (/status of 404/.test(m.text()) && UNSHIPPED.test(where)) return;
  errors.push("console: " + m.text());
});

await page.goto(url("/flows/"), { waitUntil: "networkidle" });
await page.fill("#u", FLOWS_TEST_USER);
await page.fill("#p", FLOWS_PASSWORD);
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.click(".flows-submit")]);

const ROW = "#flowsBody .bd-row[data-flip]";
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROW);

const glyph = await page.evaluate(() => ({
  label: "families are drawn on the card, not on the board",
  famGlyphs: document.querySelectorAll(".fb-fam").length,
  purityCells: document.querySelectorAll('[data-col="purity"]').length,
  zeros: [...document.querySelectorAll("#flowsBody [role=cell]")].filter((c) => /^[+\u2212]?0$/.test(c.textContent.trim())).length,
}));

const legacyConv = await page.evaluate(() => {
  const td = document.querySelector('#flowsBody .bd-row [data-col="cnv"] .bd-conv');
  return {
    cellText: td.textContent.trim(),
    cellTitled: td.hasAttribute("title"),
    aria: (document.querySelector("#flowsBody .bd-open") || { getAttribute: () => "" })
      .getAttribute("aria-label") || "",
  };
});

await page.goto(url("/flows/long/?sort=purity&dir=desc"), { waitUntil: "networkidle" });
await page.waitForSelector(ROW);
const withheldSort = await page.evaluate(() => ({
  announced: [...document.querySelectorAll("#bdHead [role=columnheader]")]
    .map((th) => th.getAttribute("aria-sort"))
    .filter((v) => v === "ascending" || v === "descending").length,
  purityAria: !!document.querySelector('#bdHead [data-col="purity"]'),
  kept: new URL(location.href).searchParams.get("sort"),
  firstTicker: document.querySelector("#flowsBody .bd-open").textContent.trim(),
}));

await page.goto(url("/flows/ticker/?t=INTC&s=signal&from=long"), { waitUntil: "load" });
await page.waitForSelector("#ftWhy .fc-fam li");
const fam = await page.evaluate(() => [...document.querySelectorAll("#ftWhy .fc-fam li")].map((li) => ({
  k: li.querySelector(".fc-fam-k").textContent,
  v: li.querySelector(".fc-fam-v").textContent,
  note: li.querySelector(".fc-fam-l").textContent,
  width: getComputedStyle(li.querySelector(".fc-fam-track i")).width,
})));

const V_O_NOTE = "volatility and quality readings became";
const QUALITY_NOTE = "not published on this card";
const legacyNote = await page.evaluate((needle) =>
  [...document.querySelectorAll("#ftWhy .fc-note")].some((n) => n.textContent.includes(needle)), V_O_NOTE);

const bad = await page.evaluate(() => [...document.querySelectorAll("#ftWhy .fc-fam-track i")]
  .map((i) => getComputedStyle(i).width).filter((w) => w.startsWith("-")));

const currentCard = JSON.parse(JSON.stringify(legacyCard));
currentCard.v = 2;
currentCard.ticker = "CURR";
currentCard.fam = { F: -73, P: -78, D: -69, V: 59, O: 71 };
currentCard.weights = { F: 2.1, P: 0.9, D: 0.8 };
currentCard.conv = { agreement: 1, breadth: 3, coverage: 1, gate: 1.42 };
const currentBoard = JSON.parse(JSON.stringify(legacyBoard));
currentBoard.v = 2;

currentBoard.rows = [{ ...legacyBoard.rows[0], t: "CURR", fam: currentCard.fam, agr: 2, bth: 3 }];

currentBoard.cleared = 5;
currentBoard.shed = 4;
await post("board:long", currentBoard);
await post("card:CURR", currentCard);

await page.goto(url("/flows/ticker/?t=CURR&s=signal&from=long"), { waitUntil: "load" });
await page.waitForSelector("#ftWhy .fc-fam li");
const famV2 = await page.evaluate(() => [...document.querySelectorAll("#ftWhy .fc-fam li")].map((li) => ({
  k: li.querySelector(".fc-fam-k").textContent,
  v: li.querySelector(".fc-fam-v").textContent,
  gauge: li.classList.contains("is-gauge"),
  width: getComputedStyle(li.querySelector(".fc-fam-track i")).width,
})));
const v2 = (k) => famV2.find((f) => f.k === k);
const px = (w) => parseFloat(w) || 0;

const notesOnV2 = await page.evaluate(() =>
  [...document.querySelectorAll("#ftWhy .fc-note")].map((n) => n.textContent));
const legacyNoteOnV2 = notesOnV2.some((t) => t.includes(V_O_NOTE));

const qualityNoteOnV2 = notesOnV2.some((t) => t.includes(QUALITY_NOTE));

await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROW);

await page.evaluate(() => window.scrollTo(0, 0));

const preDeep = JSON.parse(JSON.stringify(currentBoard));
preDeep.rows = [{ ...currentBoard.rows[0], t: "OLDB" }];
delete preDeep.deep;
await post("board:long", preDeep);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(ROW);
const preDeepClickable = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("#flowsBody .bd-open")]
    .filter((el) => (el.getAttribute("aria-label") || "").startsWith("OLDB"));
  return cards.length === 1 && cards[0].tagName === "A" &&
    cards[0].getAttribute("href") === "/flows/ticker/?t=OLDB&s=signal&from=long";
});

const withDeep = JSON.parse(JSON.stringify(currentBoard));
withDeep.deep = 1;
withDeep.deepRule = "the names furthest from neutral carry a chain and a detail card";
withDeep.rows = [
  { ...currentBoard.rows[0], t: "DEEPR", dp: 1 },
  { ...currentBoard.rows[0], t: "FLATR" },
];
await post("board:long", withDeep);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(ROW);
const deepSplit = await page.evaluate(() => {
  const byName = (t) => [...document.querySelectorAll("#flowsBody .bd-open")]
    .find((el) => (el.getAttribute("aria-label") || "").startsWith(t));
  const deep = byName("DEEPR");
  const flat = byName("FLATR");
  return {

    deepIsAnchor: !!deep && deep.tagName === "A",
    deepHref: deep ? deep.getAttribute("href") : null,
    flatExists: !!flat,
    flatIsAnchor: !!flat && flat.tagName === "A",
    flatHasHref: !!flat && flat.hasAttribute("href"),
    flatSaysWhy: !!flat && /No detail card/i.test(flat.getAttribute("aria-label") || ""),
  };
});

const v2Purity = await page.evaluate(() => document.querySelectorAll('[data-col="purity"]').length);

const v2Status = await page.evaluate(() => ({
  text: (document.getElementById("flowsStatus") || { textContent: "" }).textContent,
  rendered: document.querySelectorAll("#flowsBody .bd-row[data-flip]").length,
}));
const v2Conv = await page.evaluate(() => {
  const td = document.querySelector('#flowsBody .bd-row [data-col="cnv"] .bd-conv');
  return {
    cellTitle: td.getAttribute("title") || "",
    aria: (document.querySelector("#flowsBody .bd-open") || { getAttribute: () => "" })
      .getAttribute("aria-label") || "",
  };
});

const coldBase = JSON.parse(JSON.stringify(currentBoard));
coldBase.deep = 1;
coldBase.rows = [{ ...currentBoard.rows[0], t: "COLDR", nw: null, r0: null, dr: null }];

const SAME_SESSION_NOTE =
  "The board published for this session was written by this run, so it is this run's own " +
  "output rather than a previous session: no name here claims to be new and no rank move " +
  "is drawn.";

const readNote = async () => {
  const mark = await page.evaluate(() => {
    const el = document.getElementById("bdMem");
    return el ? { empty: el.dataset.empty || null, status: el.dataset.memory || null } : { empty: null, status: null };
  });
  await page.click("#bdMem");
  await page.waitForSelector("#fxPop:popover-open");
  const text = await page.$eval("#fxPop .ui-lead", (el) => el.textContent.trim()).catch(() => "");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#fxPop:popover-open"));
  return { text, ...mark };
};

const preMemory = JSON.parse(JSON.stringify(coldBase));
preMemory.rows = [{ ...currentBoard.rows[0], t: "PREMR" }];
delete preMemory.rows[0].nw;
delete preMemory.memory;
await post("board:long", preMemory);
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector("#bdMem[data-memory]");
const preMemoryNote = await readNote();

const coldUnstated = JSON.parse(JSON.stringify(coldBase));
delete coldUnstated.memory;
await post("board:long", coldUnstated);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#bdMem[data-memory]");
const unstatedNote = await readNote();

const coldSameSession = JSON.parse(JSON.stringify(coldBase));
coldSameSession.memory = {
  status: "same-session", sessionDate: coldBase.sessionDate,
  named: 36, incumbents: 0, note: SAME_SESSION_NOTE,
};
await post("board:long", coldSameSession);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#bdMem[data-memory]");
const sameSessionNote = await readNote();

const coldQuiet = JSON.parse(JSON.stringify(coldBase));
coldQuiet.memory = {
  status: "quiet", sessionDate: "2026-08-24", named: 0, incumbents: 0,
  note: "The previously published board was read and named no rows, so there was nothing " +
        "to hold this session's names against.",
};
await post("board:long", coldQuiet);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#bdMem[data-memory]");
const quietNote = await readNote();

const coldEmptyNote = JSON.parse(JSON.stringify(coldBase));
coldEmptyNote.memory = {
  status: "unavailable", sessionDate: null, named: null, incumbents: 0, note: "   ",
};
await post("board:long", coldEmptyNote);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#bdMem[data-memory]");
const emptyNote = await readNote();

const assertions = [

  [preMemoryNote.status === "pre-memory" && preMemoryNote.empty === "unavailable",
   `a board whose rows never carried the fields is its own status and an absence ` +
   `(got status=${preMemoryNote.status} empty=${preMemoryNote.empty})`],
  [unstatedNote.status === "unstated" && unstatedNote.empty === "unavailable",
   `a board carrying null fields and no explanation is a DIFFERENT status from one that ` +
   `never carried them (got status=${unstatedNote.status})`],
  [unstatedNote.text !== preMemoryNote.text && unstatedNote.text !== SAME_SESSION_NOTE,
   "and is handed neither of the other sentences — an unexplained cold board described as " +
   "a re-run sends a reader hunting a cause the payload never claimed"],
  [sameSessionNote.text === SAME_SESSION_NOTE && sameSessionNote.status === "same-session",
   `a same-session refusal draws the PUBLISHER'S sentence verbatim, because only the ` +
   `publisher saw the prior payload (got "${sameSessionNote.text.slice(0, 60)}...")`],
  [quietNote.empty === "quiet" && quietNote.status === "quiet",
   `a prior board READ that named no rows is a MEASURED emptiness, tagged quiet rather ` +
   `than unavailable — three different facts must not share one word (got ${quietNote.empty})`],
  [emptyNote.text.trim().length > 0 && emptyNote.text !== SAME_SESSION_NOTE,
   `a status whose note is blank still draws a real sentence rather than an empty ` +
   `paragraph (got "${emptyNote.text.slice(0, 50)}...")`],

  [new Set([preMemoryNote.text, unstatedNote.text,
            sameSessionNote.text, quietNote.text]).size === 4,
   "the four cases the page has distinct knowledge about say four distinct things"],
  [new Set([preMemoryNote.status, unstatedNote.status, sameSessionNote.status,
            quietNote.status, emptyNote.status]).size === 5,
   "and all five carry a distinct status, so the one collapse in the prose is still " +
   "recoverable by a stylesheet or a test without parsing a sentence"],

  [preDeepClickable,
   "a board written BEFORE `deep` existed keeps every card linked, at the reader's own " +
   "address — the deploy window between new assets and the next pipeline run must not dark " +
   "the per-name reader"],
  [deepSplit.deepIsAnchor,
   "on a board that publishes `deep`, a stamped row is an anchor"],
  [deepSplit.deepHref === "/flows/ticker/?t=DEEPR&s=signal&from=long",
   `and its href names that row's own reader (${deepSplit.deepHref}) — the card dialog it ` +
   "used to open had no address at all"],
  [deepSplit.flatExists,
   "an unstamped row on that same board still RENDERS — it is a real row with real numbers, " +
   "not a hidden one"],
  [!deepSplit.flatIsAnchor,
   "but it is not an anchor, so it cannot be followed to a reader with nothing to read"],
  [!deepSplit.flatHasHref,
   "and it carries no href at all, which is what makes the absence structural rather than a " +
   "class name two files have to agree about"],
  [deepSplit.flatSaysWhy,
   "and it tells a screen reader WHY there is nothing to open"],
  [fam.find((f) => f.k === "V").v === "—", "V is withheld on a v1 card"],
  [fam.find((f) => f.k === "O").v === "—", "O is withheld on a v1 card"],
  [fam.find((f) => f.k === "F").v === "−73", "F still renders, because its meaning did not change"],
  [legacyNote, "and the card says why, in the V/O note specifically"],
  [bad.length === 0, "no negative bar widths"],
  [glyph.famGlyphs === 0 && glyph.purityCells === 0,
   "the board draws neither the family glyph nor purity any more, on a v1 payload or a v2 one — the V and O " +
   "gauges and purity whose meaning moved between versions live on the card, where the assertions above hold " +
   "them to withholding, so the board cannot print a moved field as a number"],
  [glyph.zeros === 0, "and no cell on the v1 board prints a bare zero where a field is absent"],
  [withheldSort.announced === 0,
    "a ?sort= deep link to the withheld column announces no sorted header"],
  [!withheldSort.purityAria,
    "and there is no purity header to carry an aria-sort — 'none' would claim it is sortable"],
  [withheldSort.kept === null,
    "and the dead ?sort= is dropped from the address rather than kept to be shared onward"],
  [withheldSort.firstTicker === "INTC",
    `while the rows stay in the published order (first row ${withheldSort.firstTicker})`],

  [v2("V").v === "59" && v2("O").v === "71", "a v2 card publishes both gauges"],
  [v2("V").gauge && v2("O").gauge, "and draws them as gauges, not signed axes"],
  [px(v2("V").width) > 10 && px(v2("O").width) > 10,
    `with real width (V ${v2("V").width}, O ${v2("O").width})`],
  [!legacyNoteOnV2, "and without the V/O legacy explanation, which is a v1 fact"],
  [qualityNoteOnV2,
    "while a field NEWER than this fixture is named as unpublished rather than " +
    "drawn as zero: zero is the best possible reading of both quality axes once " +
    "oriented, so imputing it would reward a name for having no data"],
  [v2Purity === 0,
    "a v2 board draws no purity column either: the board is a scan, and purity reads on the name's card"],
  [v2("F").v === "−73", "signed axes are unaffected by the version"],

  [legacyConv.cellText === "79",
   `a v1 board still prints its conviction (got "${legacyConv.cellText}")`],
  [!legacyConv.cellTitled,
   "but the table cell carries NO title: the agreement counts are not on this " +
   "payload, and a title composed from undefined would explain a number with a " +
   "blank where its reason goes"],

  [!/signed axes/.test(legacyConv.aria),
   "and the screen-reader label claims no agreement count it was never given"],
  [/\b2 of 3\b/.test(v2Conv.cellTitle),
   `a board carrying the counts explains its conviction with them (got "${v2Conv.cellTitle}")`],

  [/2 of 3 signed axes agreeing/.test(v2Conv.aria),
   `and a screen reader is told the same fact, not left with the composite alone`],
  [!/0\.45|45%|0\.35|0\.2\b/.test(v2Conv.cellTitle),
   "while the board names no WEIGHT: the blend is stated once, on the card, from the " +
   "payload's own numbers — a second copy here is how a page ends up describing " +
   "arithmetic the pipeline stopped doing"],

  [/4 more cleared the band and did not fit/.test(v2Status.text),
   `the board says how many scored names past the threshold it could not hold ` +
   `(status line: "${v2Status.text}")`],
  [new RegExp(`\\b${v2Status.rendered} of 5 shown\\b`).test(v2Status.text),
   `with both halves of the fraction — the rows actually drawn (${v2Status.rendered}) ` +
   `over the pool that cleared the band (5) — so the reader is not left to subtract`],
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
  : `✓ flows-legacy: ${assertions.length} assertions — both sides of the schema boundary — a v1 payload withholds every field whose meaning moved and says why, a v2 payload draws them`);
await browser.close();
await server.stop();
process.exit(failed ? 1 : 0);
