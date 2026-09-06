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

/* THE DECK AND THE TABLE MOVED. /flows/ is the Overview now — both poles at
   once over the dead band — and the full ranked list with its deck/table
   toggle is a route of its own. The sides stopped being a toggle because a
   toggle has no address: half the session sat behind a click that could not be
   linked to, bookmarked or sent. */
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");

// The table's family glyph must withhold V and O on a v1 board.
await page.click('.flows-view[data-view="table"]');
const glyph = await page.evaluate(() => {
  const cell = document.querySelector(".fb-fam");
  const row = document.querySelector("#flowsBody tr");
  return {
    label: cell.getAttribute("aria-label"),
    nullMarks: cell.querySelectorAll("i.is-null").length,
    bars: cell.querySelectorAll("i").length,
    // Column order: #, ticker, last, score, conv, families, purity, ...
    purity: row.children[6].textContent.trim(),
  };
});


/* THE CONVICTION TITLE ON A BOARD THAT PREDATES IT.

   `agr`/`bth` — how many signed axes agreed, out of how many were measured —
   are the newest fields on a board row, published so a ranked list can say
   what its own sort key is mostly made of. This fixture is a REAL v1 board
   and carries neither, which is precisely the deploy window this file exists
   for: new assets, old payload. The renderer must add no title at all rather
   than compose one out of undefined, and the conviction number itself must
   keep printing — losing the explanation is not losing the reading. */
const legacyConv = await page.evaluate(() => {
  const td = document.querySelector("#flowsBody tr").children[4];
  const badge = document.querySelector(".fd-foot span");
  return {
    cellText: td.textContent.trim(),
    cellTitled: td.hasAttribute("title"),
    badgeTitled: badge ? badge.hasAttribute("title") : null,
    aria: (document.querySelector(".fd-card") || { getAttribute: () => "" })
      .getAttribute("aria-label") || "",
  };
});

/* A DEEP-LINKED SORT ON A WITHHELD COLUMN. purity changed meaning at v2, so
   on this v1 board the column renders the em dash and sortable() is false —
   but ?sort=purity arrives from links minted while it was sortable. The table
   must stay in the published order AND SAY SO: announcing "sorted descending"
   over unsorted rows is a lie only a screen reader hears, and even
   aria-sort="none" would claim the column is sortable-but-unsorted. The
   withheld column carries no aria-sort at all. */
await page.goto(url("/flows/long/?sort=purity&dir=desc"), { waitUntil: "networkidle" });
await page.click('.flows-view[data-view="table"]');
await page.waitForSelector("#flowsBody tr");
const withheldSort = await page.evaluate(() => ({
  announced: [...document.querySelectorAll("#flowsTable thead th")]
    .map((th) => th.getAttribute("aria-sort"))
    .filter((v) => v === "ascending" || v === "descending").length,
  purityAria: document.querySelectorAll("#flowsTable thead th")[6].hasAttribute("aria-sort"),
  firstTicker: document.querySelector("#flowsBody tr .fb-tk").textContent.trim(),
}));


/* THE SCORE DERIVATION IS READ ON /flows/ticker/ NOW. It used to be read by
   clicking a deck card and measuring inside the card dialog's #fcWhy; the
   dialog is retired, the same renderer draws the same panel into #ftWhy on
   the reader, and the deck card is the link that leads there. The fixture and
   the question are unchanged — a v1 card drawn by a v2 renderer, withholding
   exactly the two fields whose meaning moved — because that question never
   depended on which surface the panel was mounted in. */
await page.goto(url("/flows/ticker/?t=INTC&s=signal&from=long"), { waitUntil: "networkidle" });
await page.waitForSelector("#ftWhy .fc-fam li");
const fam = await page.evaluate(() => [...document.querySelectorAll("#ftWhy .fc-fam li")].map((li) => ({
  k: li.querySelector(".fc-fam-k").textContent,
  v: li.querySelector(".fc-fam-v").textContent,
  note: li.querySelector(".fc-fam-l").textContent,
  width: getComputedStyle(li.querySelector(".fc-fam-track i")).width,
})));
/* NAMED, NOT SUBSTRING-HUNTED. Two notes on this card legitimately contain
   "built before" (the V/O explanation and the quality pair's), so a broad
   .includes() here could never fail — the assertion it feeds was satisfied by
   the WRONG note the moment the second one shipped. Both constants are used
   on both sides of the boundary below. */
const V_O_NOTE = "volatility and quality readings became";
const QUALITY_NOTE = "not published on this card";
const legacyNote = await page.evaluate((needle) =>
  [...document.querySelectorAll("#ftWhy .fc-note")].some((n) => n.textContent.includes(needle)), V_O_NOTE);


// No negative or absurd widths anywhere on the panel.
const bad = await page.evaluate(() => [...document.querySelectorAll("#ftWhy .fc-fam-track i")]
  .map((i) => getComputedStyle(i).width).filter((w) => w.startsWith("-")));


/* THE OTHER SIDE OF THE BOUNDARY. A test that only checks v1 cannot catch v2
   regressing into silence — withholding everything always passes a
   "withholds the moved fields" assertion. So the same renderer is handed a
   current payload and must draw the gauges it just refused to draw. */
const currentCard = JSON.parse(JSON.stringify(legacyCard));
currentCard.v = 2;
currentCard.ticker = "CURR";
currentCard.fam = { F: -73, P: -78, D: -69, V: 59, O: 71 };
currentCard.weights = { F: 2.1, P: 0.9, D: 0.8 };
currentCard.conv = { agreement: 1, breadth: 3, coverage: 1, gate: 1.42 };
const currentBoard = JSON.parse(JSON.stringify(legacyBoard));
currentBoard.v = 2;
/* THE AGREEMENT COUNTS, on the current side of the boundary. Two of three
   signed axes agreeing is the modal case on the live corpus (64 of 96 rows)
   and is the one worth carrying here: it is the value a reader most often
   sees, and the one a renderer that rounded a ratio would get wrong. */
currentBoard.rows = [{ ...legacyBoard.rows[0], t: "CURR", fam: currentCard.fam, agr: 2, bth: 3 }];
/* NAMES THAT CLEARED THE BAND AND DID NOT FIT. The dead band is the rule this
   product states for publication, but each board's own length cap truncates
   the side and the overflow lands on NEITHER surface — the watch list holds
   only the names inside the band. On a measured session that was four names,
   fully scored, past the threshold, and visible nowhere. */
currentBoard.cleared = 5;
currentBoard.shed = 4;
await post("board:long", currentBoard);
await post("card:CURR", currentCard);

await page.goto(url("/flows/ticker/?t=CURR&s=signal&from=long"), { waitUntil: "networkidle" });
await page.waitForSelector("#ftWhy .fc-fam li");
const famV2 = await page.evaluate(() => [...document.querySelectorAll("#ftWhy .fc-fam li")].map((li) => ({
  k: li.querySelector(".fc-fam-k").textContent,
  v: li.querySelector(".fc-fam-v").textContent,
  gauge: li.classList.contains("is-gauge"),
  width: getComputedStyle(li.querySelector(".fc-fam-track i")).width,
})));
const v2 = (k) => famV2.find((f) => f.k === k);
const px = (w) => parseFloat(w) || 0;

/* NARROWED, AND THE NARROWING IS THE POINT.

   This read `.includes("built before")` and matched ANY such note in the
   panel. That was fine while there was exactly one — the note explaining that
   V and O could not be redrawn as gauges on a v1 payload. It broke the moment
   a second, entirely correct one appeared: the quality pair (otmShare and
   vegaTilt) is newer than this fixture, so a v2 card that predates it says so,
   which is exactly the behaviour the transitional design demands.

   A schema boundary accumulates these notes by construction — every field
   added after a stored payload earns one. So an assertion here must name the
   note it means, or it becomes a tripwire that fires on every future addition
   and has to be loosened each time until it means nothing. */
const notesOnV2 = await page.evaluate(() =>
  [...document.querySelectorAll("#ftWhy .fc-note")].map((n) => n.textContent));
const legacyNoteOnV2 = notesOnV2.some((t) => t.includes(V_O_NOTE));
/* The other side of the same coin: a card genuinely missing a newer field
   must SAY so rather than render a zero. The fixture predates the quality
   pair, so this note is required to be present — which turns the collision
   above into a guard instead of a nuisance. */
const qualityNoteOnV2 = notesOnV2.some((t) => t.includes(QUALITY_NOTE));

/* READ WHILE THE READER IS STILL ON SCREEN. The version this replaces pulled
   these notes out of the dialog after two reloads had closed it, and the
   panel was only still populated because flows-card.js reopened itself from
   the ?t= it had pushed — three coincidences holding up an assertion. On its
   own page the panel is there for as long as the page is. */

/* BACK TO THE BOARD: the panel above was read on its own page, so returning
   is a navigation rather than an Escape keystroke. */
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");

/* ---------- THE DEEP-ROW WINDOW ------------------------------------

   THE SAME TRANSITIONAL CERTAINTY THIS FILE EXISTS FOR, one field later.

   The board now publishes ~93 rows and builds detail cards only for the 50
   furthest from neutral, stamping `dp` on those rows so the renderer can stop
   advertising a card that was never written. Fine — except that assets deploy
   the moment `main` moves and the pipeline runs the NEXT MORNING, so for the
   whole intervening day the new renderer reads a board written before `dp`
   existed. Every row would carry no `dp`, the renderer would conclude no row
   has a card, and the entire card reader would go dark on a page whose only
   purpose is opening those cards. Silently: no error, no empty state, just
   ninety-three names that no longer respond to a click.

   The compatibility rule is that the test is on the PAYLOAD, not the row.
   `deep` is a count published beside `deepRule`; a board that omits it
   predates the distinction, so every row on it has a card. */
await page.evaluate(() => window.scrollTo(0, 0));

// (a) A board with no `deep` at all — literally yesterday's payload.
const preDeep = JSON.parse(JSON.stringify(currentBoard));
preDeep.rows = [{ ...currentBoard.rows[0], t: "OLDB" }];
delete preDeep.deep;
await post("board:long", preDeep);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
const preDeepClickable = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".fd-card")]
    .filter((el) => (el.getAttribute("aria-label") || "").startsWith("OLDB"));
  return cards.length === 1 && cards[0].tagName === "A" &&
    cards[0].getAttribute("href") === "/flows/ticker/?t=OLDB&s=signal&from=long";
});

// (b) A board that DOES publish `deep`: an unstamped row is a real answer.
const withDeep = JSON.parse(JSON.stringify(currentBoard));
withDeep.deep = 1;
withDeep.deepRule = "the names furthest from neutral carry a chain and a detail card";
withDeep.rows = [
  { ...currentBoard.rows[0], t: "DEEPR", dp: 1 },
  { ...currentBoard.rows[0], t: "FLATR" },
];
await post("board:long", withDeep);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
const deepSplit = await page.evaluate(() => {
  const byName = (t) => [...document.querySelectorAll(".fd-card")]
    .find((el) => (el.getAttribute("aria-label") || "").startsWith(t));
  const deep = byName("DEEPR");
  const flat = byName("FLATR");
  return {
    /* NAMED FOR WHAT THEY HOLD. These were deepIsButton / flatIsButton /
       flatHasDataT while holding `tagName === "A"` and `hasAttribute("href")`
       — the messages below had been rewritten for the anchor and the names
       left behind, so the file read `[!deepSplit.flatHasHref, "and it
       carries no href at all"]`. A name that says the opposite of its value
       is the same defect as a stale comment, and harder to see. */
    deepIsAnchor: !!deep && deep.tagName === "A",
    deepHref: deep ? deep.getAttribute("href") : null,
    flatExists: !!flat,
    flatIsAnchor: !!flat && flat.tagName === "A",
    flatHasHref: !!flat && flat.hasAttribute("href"),
    flatSaysWhy: !!flat && /No detail card/i.test(flat.getAttribute("aria-label") || ""),
  };
});
/* TABLE VIEW, for the purity column below. */
await page.click('.flows-view[data-view="table"]');
const v2Purity = await page.evaluate(() =>
  document.querySelector("#flowsBody tr").children[6].textContent.trim());

/* AND THE OTHER SIDE OF THE CONVICTION BOUNDARY. Withholding the title
   always satisfies "a v1 board adds no title", so the modern board has to
   prove the title actually arrives — and that it carries the counts rather
   than a weight restated in this renderer. */
/* READ WITH THE ROW COUNT IT DESCRIBES. The board loaded at this point is
   `withDeep`, not `currentBoard`, so hard-coding the numerator pins which
   fixture happens to be current — a brittleness that has nothing to do with
   what is being tested. The denominator is the fixture's `cleared`; the
   numerator must be whatever this board actually rendered. */
const v2Status = await page.evaluate(() => ({
  text: (document.querySelector(".flows-status") || { textContent: "" }).textContent,
  rendered: document.querySelectorAll(".fd-card").length,
}));
const v2Conv = await page.evaluate(() => {
  const td = document.querySelector("#flowsBody tr").children[4];
  const badge = document.querySelector(".fd-foot span");
  return {
    cellTitle: td.getAttribute("title") || "",
    badgeTitle: badge ? (badge.getAttribute("title") || "") : "",
    aria: (document.querySelector(".fd-card") || { getAttribute: () => "" })
      .getAttribute("aria-label") || "",
  };
});

/* =============================================================
   THE COLD BOARD'S SENTENCE, WHICH STOPPED HAVING ONE CAUSE.

   Until this session a cold board meant exactly one thing — the prior board
   could not be read — and this renderer hard-coded that sentence. The
   pipeline now distinguishes four ways a memory can be refused: never
   published, unreadable, read but naming no rows, and stamped for THIS run's
   own session (a holiday or manual re-run, where the "prior" board is this
   run's own output and holding names against it manufactures a stability
   nothing measured). Only the publisher saw the prior payload, so only the
   publisher can say which happened; the rows carry the same null `nw` in
   every case.

   So the sentence travels on the payload and this file draws it. The three
   cases below are the ones that can actually reach a reader, and the middle
   one is why this exists: a re-run described as an unreadable store sends
   someone looking for an outage that did not happen.
   ============================================================= */
const coldBase = JSON.parse(JSON.stringify(currentBoard));
coldBase.deep = 1;
coldBase.rows = [{ ...currentBoard.rows[0], t: "COLDR", nw: null, r0: null, dr: null }];

const SAME_SESSION_NOTE =
  "The board published for this session was written by this run, so it is this run's own " +
  "output rather than a previous session: no name here claims to be new and no rank move " +
  "is drawn.";

const readNote = () => page.evaluate(() => {
  const el = document.querySelector(".fb-memnote");
  return el ? {
    text: el.textContent.trim(),
    empty: el.dataset.empty || null,
    status: el.dataset.memory || null,
  } : { text: "", empty: null, status: null };
});

/* (a) A board from BEFORE the memory layer: its rows carry no `nw` key at all.
       Not the same as a board whose memory is null — that one carried the
       field and could not fill it. */
const preMemory = JSON.parse(JSON.stringify(coldBase));
preMemory.rows = [{ ...currentBoard.rows[0], t: "PREMR" }];
delete preMemory.rows[0].nw;
delete preMemory.memory;
await post("board:long", preMemory);
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fb-memnote");
const preMemoryNote = await readNote();

/* (b) A board that HAS the fields, has them null, and does not say why. The
       sentence must invent no cause: this payload genuinely carries none, and
       "the store could not be read" would be a guess printed as a finding. */
const coldUnstated = JSON.parse(JSON.stringify(coldBase));
delete coldUnstated.memory;
await post("board:long", coldUnstated);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".fb-memnote");
const unstatedNote = await readNote();

/* (c) THE CASE THIS WAS BUILT FOR. A same-session refusal must read as a
       re-run, never as a store that could not be reached. */
const coldSameSession = JSON.parse(JSON.stringify(coldBase));
coldSameSession.memory = {
  status: "same-session", sessionDate: coldBase.sessionDate,
  named: 36, incumbents: 0, note: SAME_SESSION_NOTE,
};
await post("board:long", coldSameSession);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".fb-memnote");
const sameSessionNote = await readNote();

/* (d) A prior board that WAS read and named no rows: a measured emptiness.
       Tagging it `unavailable` beside the two real absences would put three
       different facts under one word. */
const coldQuiet = JSON.parse(JSON.stringify(coldBase));
coldQuiet.memory = {
  status: "quiet", sessionDate: "2026-08-24", named: 0, incumbents: 0,
  note: "The previously published board was read and named no rows, so there was nothing " +
        "to hold this session's names against.",
};
await post("board:long", coldQuiet);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".fb-memnote");
const quietNote = await readNote();

/* (e) A note present and empty. An empty string is not a sentence, and drawing
       it leaves a blank paragraph where an explanation belongs. */
const coldEmptyNote = JSON.parse(JSON.stringify(coldBase));
coldEmptyNote.memory = {
  status: "unavailable", sessionDate: null, named: null, incumbents: 0, note: "   ",
};
await post("board:long", coldEmptyNote);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".fb-memnote");
const emptyNote = await readNote();

const assertions = [
  /* ---- the cold board says WHICH silence it is ----

     ASSERTED ON STRUCTURE, NOT ON PROSE. These sentences are being written and
     rewritten as the four causes get named more precisely, and a test that
     pins their wording either breaks on every improvement or gets loosened
     until it means nothing. What must hold is that the four cases stay FOUR:
     each carries its own status, the two that are absences are tagged apart
     from the one that is a measurement, no case draws an empty paragraph, and
     no case is ever handed another case's sentence. The one exact-text
     assertion is the same-session note, and that text belongs to the
     publisher rather than to this renderer — it is the whole point of the
     pairing. */
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
  /* FOUR SENTENCES, FIVE STATUSES, AND THE ASYMMETRY IS CORRECT.

     The four cases the renderer has distinct KNOWLEDGE about must say
     distinct things. The fifth — a status of "unavailable" whose note came
     back blank — legitimately shares the unstated sentence: "unavailable"
     means the prior board was never written OR could not be read, which is
     exactly what the unstated sentence already enumerates, and with no note
     to draw there is no honest way to narrow it further. Demanding five
     different sentences would force the renderer to invent a distinction it
     cannot make. The distinction is not lost, it just is not prose:
     `data-memory` still separates all five, which is why the status is on the
     element at all. */
  [new Set([preMemoryNote.text, unstatedNote.text,
            sameSessionNote.text, quietNote.text]).size === 4,
   "the four cases the page has distinct knowledge about say four distinct things"],
  [new Set([preMemoryNote.status, unstatedNote.status, sameSessionNote.status,
            quietNote.status, emptyNote.status]).size === 5,
   "and all five carry a distinct status, so the one collapse in the prose is still " +
   "recoverable by a stylesheet or a test without parsing a sentence"],
  /* THESE SIX WERE WRITTEN [message, condition] INTO A LOOP THAT DESTRUCTURES
     [passed, msg], SO THE CONDITION WAS THE MESSAGE. A non-empty string is
     truthy, and every one of them passed on that alone — the six guarding the
     deploy window where new assets meet a board published before `deep`
     existed, which is the window this whole file is about. An instrument that
     agrees with everything certifies everything. Order corrected; all six
     still pass, and reverting the renderer makes them fail. */
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
  [glyph.nullMarks === 2, "the table glyph marks V and O absent"],
  /* purity changed meaning at v2 too — from a net over a gross to gross over
     gross — and renders in the same column under the same heading. */
  [glyph.purity === "\u2014", `a v1 board withholds purity as well (got "${glyph.purity}")`],
  [withheldSort.announced === 0,
    "a ?sort= deep link to the withheld column announces no sorted header"],
  [!withheldSort.purityAria,
    "and the withheld column carries no aria-sort at all — 'none' would claim it is sortable"],
  [withheldSort.firstTicker === "INTC",
    `while the rows stay in the published order (first row ${withheldSort.firstTicker})`],
  // ...and the same renderer draws them on a current payload.
  [v2("V").v === "59" && v2("O").v === "71", "a v2 card publishes both gauges"],
  [v2("V").gauge && v2("O").gauge, "and draws them as gauges, not signed axes"],
  [px(v2("V").width) > 10 && px(v2("O").width) > 10,
    `with real width (V ${v2("V").width}, O ${v2("O").width})`],
  [!legacyNoteOnV2, "and without the V/O legacy explanation, which is a v1 fact"],
  [qualityNoteOnV2,
    "while a field NEWER than this fixture is named as unpublished rather than " +
    "drawn as zero: zero is the best possible reading of both quality axes once " +
    "oriented, so imputing it would reward a name for having no data"],
  [v2Purity !== "\u2014" && v2Purity.length > 0,
    `a v2 board publishes purity rather than withholding it (got "${v2Purity}")`],
  [v2("F").v === "−73", "signed axes are unaffected by the version"],
  /* ---- the conviction decomposition, across the version boundary ---- */
  [legacyConv.cellText === "79",
   `a v1 board still prints its conviction (got "${legacyConv.cellText}")`],
  [!legacyConv.cellTitled,
   "but the table cell carries NO title: the agreement counts are not on this " +
   "payload, and a title composed from undefined would explain a number with a " +
   "blank where its reason goes"],
  [!legacyConv.badgeTitled,
   "and neither does the deck badge, which reads the same two absent fields"],
  [!/signed axes/.test(legacyConv.aria),
   "and the screen-reader label claims no agreement count it was never given"],
  [/\b2 of 3\b/.test(v2Conv.cellTitle),
   `a board carrying the counts explains its conviction with them (got "${v2Conv.cellTitle}")`],
  [/\b2 of 3\b/.test(v2Conv.badgeTitle),
   "on the deck badge as well as the table cell — the same number in two views"],
  [/2 of 3 signed axes agreeing/.test(v2Conv.aria),
   `and a screen reader is told the same fact, not left with the composite alone`],
  [!/0\.45|45%|0\.35|0\.2\b/.test(v2Conv.cellTitle),
   "while the board names no WEIGHT: the blend is stated once, on the card, from the " +
   "payload's own numbers — a second copy here is how a page ends up describing " +
   "arithmetic the pipeline stopped doing"],
  /* ---- the names that cleared the band and are not on the page ---- */
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
