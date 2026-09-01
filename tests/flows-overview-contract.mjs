/* =============================================================
   flows-overview-contract.mjs — the Session Overview, in a browser.

   THIS IS THE PAGE THE SECTION OPENS ON, and it is now a command center:
   seven regions drawn from seven endpoints that already existed. The
   version it replaced fetched both FULL board payloads and rendered six
   tiles from them — three a side — discarding every other ranked name, and
   left the level, the flagged windows, the calendar, the watch board and
   the score moves each on its own route.

   SO THE FIXTURE IS BUILT TO BREAK A TRUNCATED RENDER. The two sides are
   given FIVE and FOUR names against regions that show ten, so a renderer
   that quietly caps at three fails here rather than passing with a shorter
   page. That property is inherited from the version of this file that
   guarded the three-tile poles, and it is the only reason "the region
   shows the whole side" means anything.

   THE FIXTURE IS ALSO A QUIET SESSION, which is the ordinary one: 15 of 24
   scored names land inside the ±20 band and are published on neither side.
   A reader who cannot see that band reads a short page as a broken page,
   so the band is drawn — and here, measured.

   THREE SILENCES, THREE SENTENCES, and this file asserts all three at once
   rather than trusting the prose. `events` is never published, so that
   region is PENDING; `scoretrack` is failed at the network for one load,
   so "what changed" is UNREADABLE; the short board is emptied at the end,
   so that region is EMPTY. Only the last of the three is a claim about the
   market, and the page must not word them alike.

   THE TWO SIDES ARE TWO FETCHES, which is the defect the original file
   existed for: a pipeline that failed between them puts yesterday's bulls
   beside today's bears, and both halves render perfectly. Nothing in the
   payload forces them to agree, so the page has to check.
   ============================================================= */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startWorker, FLOWS_PASSWORD, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const TOKEN = "overview-token-aaaaaaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;

const post = (key, body) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(body),
});

const SESSION = "2026-08-24";

/* THE SCORES ARE CHOSEN SO EVERY ORDERING QUESTION HAS ONE ANSWER.

   Bullish  KLA 41, ORCL 88, ADBE 33, DE 57, CAT 26  -> 88, 57, 41, 33, 26
   Bearish  MU -35, PFE -91, XOM -28, BAC -62        -> -91, -62, -35, -28

   Neither list arrives sorted, and neither is sorted by the SIGNED number
   in the same direction: the bear side wants the most negative first, so a
   descending sort — the obvious one, and the one that works on the bull
   side — puts the LEAST bearish name at the top of the bearish region. That
   is the mistake this fixture is built to catch, and a fixture already in
   rank order could not catch it.

   `r` IS THE PUBLISHED RANK and the renderer is required to use it rather
   than re-derive an order the pipeline already settled. It is stamped here
   in the correct order on both sides, so a renderer that re-derives with a
   signed descending sort still fails on the bear side.

   `deep`/`dp` MARK WHICH ROWS HAVE A DETAIL CARD. The board publishes four
   of the five bulls with one, so CAT is the row that proves a name with no
   card is not minted into an opener that opens nothing. */
const bullRows = [
  { t: "KLA", r: 3, s: 41, cnv: 62, px: 812.40, chg: 0.0071, netPrem: 21400000, dp: 1,
    fam: { F: 44, P: 12, D: 30, V: 51, O: 40 } },
  { t: "ORCL", r: 1, s: 88, cnv: 81, px: 244.10, chg: 0.0192, netPrem: 36743812, dp: 1,
    fam: { F: 71, P: 90, D: 22, V: 63, O: 58 } },
  { t: "ADBE", r: 4, s: 33, cnv: 55, px: 372.66, chg: 0.0043, netPrem: -998000, dp: 1,
    fam: { F: 29, P: 18, D: 21, V: 40, O: 33 } },
  { t: "DE", r: 2, s: 57, cnv: 70, px: 498.02, chg: -0.0035, netPrem: 4100000, dp: 1,
    fam: { F: 33, P: 20, D: 61, V: 44, O: 35 } },
  /* No `dp`: scored and ranked from the same five sources, no card built. */
  { t: "CAT", r: 5, s: 26, cnv: 51, px: 415.88, chg: 0.0012, netPrem: 862000,
    fam: { F: 24, P: 9, D: 14, V: 36, O: 28 } },
];
const bearRows = [
  { t: "MU", r: 3, s: -35, cnv: 58, px: 118.77, chg: -0.0104, netPrem: -1700000, dp: 1,
    fam: { F: -40, P: -12, D: -25, V: 55, O: 41 } },
  { t: "PFE", r: 1, s: -91, cnv: 84, px: 24.33, chg: -0.0221, netPrem: -32300000, dp: 1,
    fam: { F: -55, P: -94, D: -30, V: 39, O: 62 } },
  { t: "XOM", r: 4, s: -28, cnv: 49, px: 112.04, chg: -0.0017, netPrem: -759000, dp: 1,
    fam: { F: -26, P: -11, D: -19, V: 33, O: 24 } },
  { t: "BAC", r: 2, s: -62, cnv: 66, px: 47.15, chg: 0.0008, netPrem: -7100000, dp: 1,
    fam: { F: -70, P: -31, D: -48, V: 48, O: 29 } },
];
const SCORES = new Map([...bullRows, ...bearRows].map((r) => [r.t, r.s]));

const board = (side, rows, sessionDate = SESSION, extra = {}) => ({
  side, rows, sessionDate, status: "ok", v: 2,
  generatedAt: new Date().toISOString(),
  deadBand: 20, scored: 24, neutral: 15, universe: 264, enriched: 60,
  ...extra,
});

/* THE TRACE, AND THE MOVES IT IMPLIES.

   "What changed" is last-minus-previous over each name's own measured
   history, so this fixture makes every branch of that arithmetic answer
   once:

     PFE  -60 -> -91   a move of -31, the largest, and it must lead
     MU   -20, gap, -35   a move of -15 ACROSS A GAP: the previous session
                          the name was SCORED, never a zero substituted in
     ORCL  80 ->  88   a move of +8
     DE / BAC / CAT / ADBE  flat: measured twice, moved zero. Not a move.
     KLA   one session only: nothing to subtract from, so not a move either
     XOM   absent from the trace entirely, which its strip must say with an
           em dash rather than a flat line drawn at zero. */
const trackNames = [
  { t: "ORCL", s: [80, 88], n: 2, last: 88 },
  { t: "PFE", s: [-60, -91], n: 2, last: -91 },
  { t: "MU", s: [-20, null, -35], n: 2, last: -35 },
  { t: "DE", s: [57, 57], n: 2, last: 57 },
  { t: "BAC", s: [-62, -62], n: 2, last: -62 },
  { t: "CAT", s: [26, 26], n: 2, last: 26 },
  { t: "ADBE", s: [33, 33], n: 2, last: 33 },
  { t: "KLA", s: [41], n: 1, last: 41 },
];
const scoretrack = (names) => ({
  v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
  windowSessions: 42, deadBand: 20, epoch: "2026-08-26",
  sessions: [{ d: "2026-08-21", source: "boards" }, { d: SESSION, source: "full" }],
  names, namesSeen: names.length, namesShed: 0,
});

const market = {
  v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
  n: 264, screened: 264,
  breadth: { bull: 9, bear: 12, flat: 0, unpriced: 3, tilt: -0.0143 },
  premium: { net: -18400000, tilt: -0.0212 },
};

const alerts = {
  v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
  readAt: "2026-08-25T10:28:20.000Z", refreshed: "nightly", seen: 7, cap: 60,
  rows: [
    { t: "ORCL", cp: "C", k: 250, exp: "2026-09-18", prem: 2980960, rule: "RepeatedHits" },
    { t: "PFE", cp: "P", k: 24, exp: "2026-09-18", prem: 1450000, rule: "SteadyAccumulation" },
    { t: "KLA", cp: "C", k: 820, exp: "2026-10-16", prem: 940000, rule: "LowHistoricVolume" },
  ],
};

/* The dead-band residents. NONE of them has a detail card — by the deep
   rule they are the names CLOSEST to neutral — so this region may not mint
   an opener for any of them. */
const watch = {
  v: 2, side: "watch", status: "ok", sessionDate: SESSION,
  generatedAt: new Date().toISOString(), deadBand: 20, scored: 24, neutral: 15,
  rows: [
    { t: "NKE", r: 1, s: 18, cnv: 44, px: 78.10 },
    { t: "SBUX", r: 2, s: -12, cnv: 39, px: 92.44 },
  ],
};

await post("board:long", board("long", bullRows, SESSION, { deep: 4 }));
await post("board:short", board("short", bearRows, SESSION, { deep: 4 }));
await post("board:watch", watch);
await post("market", market);
await post("flowalerts", alerts);
await post("scoretrack", scoretrack(trackNames));
/* `events` IS DELIBERATELY NEVER PUBLISHED. The worker answers an
   unpublished key with {status:"pending"}, which is the silence this file
   needs a live example of — an endpoint that has not spoken is not an
   endpoint that measured nothing. */

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  /* One phase below fails an endpoint on purpose, and Chromium logs a
     failed fetch to the console as an error. That message is the POINT of
     that phase, so it is ignored only while the flag is up. */
  let allowFetchFailure = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (allowFetchFailure && /Failed to load resource/.test(text)) return;
    errors.push("console: " + text);
  });

  await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
  await page.fill("#u", FLOWS_TEST_USER);
  await page.fill("#p", FLOWS_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click(".flows-submit"),
  ]);
  await page.waitForSelector(".cc-bull tbody tr", { timeout: 15000 });

  /* ---------- the verdict bar ------------------------------------ */
  {
    /* SIX READINGS ACROSS FOUR PAYLOADS, on one line, before anything else.
       The page it replaced could not state the session's level at all: the
       board score is a cross-sectional residual, so whether the tape was
       bought or sold had been neutralised out of every number on it. */
    const tiles = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccVerdict .cc-tile"), (t) => ({
        k: t.querySelector(".cc-tile-k")?.textContent.trim(),
        v: t.querySelector(".cc-tile-v")?.textContent.trim(),
        s: t.querySelector(".cc-tile-s")?.textContent.trim() || "",
        cls: t.querySelector(".cc-tile-v")?.className || "",
      })));
    eq(tiles.length, 6, "the verdict bar states six readings");
    const by = Object.fromEntries(tiles.map((t) => [t.k, t]));

    eq(by.Session?.v, SESSION, "the verdict names the session it is about");
    eq(by.Screened?.v, "264", "and how many names were screened, from the market payload");
    /* U+2212, not a hyphen — the whole site's rule, and the reason the
       formatter lives in flows-ui.js rather than in each page. */
    eq(by.Tilt?.v, "−0.0143", "the level the board's own score neutralises away");
    ok(/is-neg/.test(by.Tilt?.cls || ""),
       `and a sold tape is toned as one (${by.Tilt?.cls})`);
    eq(by.Breadth?.v, "9 / 12", "breadth is bull over bear, from the market payload");
    eq(by["Both sides"]?.v, "5 / 4", "and both boards are counted whole, not to the region cap");
    eq(by["Flagged windows"]?.v, "7", "the vendor's flagged-window count");
    eq(by["Flagged windows"]?.s, "nightly read",
       "carrying WHEN it was read, because the number means nothing without it");
  }

  /* ---------- both sides, whole ---------------------------------- */
  {
    /* The board used to hide half the session behind a LONG/SHORT toggle,
       and then behind a three-tile cap. A session leans in two directions
       and a reader comparing them should not have to remember the other. */
    const bull = (await page.locator(".cc-bull tbody .cc-t").allTextContents()).map((s) => s.trim());
    const bear = (await page.locator(".cc-bear tbody .cc-t").allTextContents()).map((s) => s.trim());
    ok(bull.length > 0 && bear.length > 0, "both sides are populated from one page load");

    /* FIVE AND FOUR. The regions show ten; a renderer truncated to three
       would still satisfy "both sides render", so the counts are the
       assertion that has teeth. */
    deep(bull, ["ORCL", "DE", "KLA", "ADBE", "CAT"],
      "the bullish region shows the whole side in the payload's published rank order");
    /* THE ASYMMETRY. A descending sort on the signed score gets the bull
       side right and the bear side exactly backwards: -35 > -91, so MU
       would head a region labelled Bearish while being the least bearish
       name on it. */
    deep(bear, ["PFE", "BAC", "MU", "XOM"],
      "and the bearish region leads with the most bearish name, not the largest number");

    /* A BEAR LEAN READS BEARISH. The score column is the ranked signal and
       carries its own sign in the glyph before any hue is applied. */
    const bearScores = await page.evaluate(() => Array.from(
      document.querySelectorAll(".cc-bear tbody .cc-score"),
      (c) => ({ text: c.textContent.trim(), neg: c.classList.contains("is-neg") })));
    eq(bearScores[0]?.text, "−91", "the leading bear row prints its score as a real minus");
    ok(bearScores.every((c) => c.text.startsWith("−") && c.neg),
       "and every bear row reads bearish in the glyph and is toned to match");
    const bullScores = await page.locator(".cc-bull tbody .cc-score").allTextContents();
    ok(bullScores.every((s) => s.trim().startsWith("+")),
       "while every bull row reads bullish");

    /* The other columns are the ones the six tiles had no room for. */
    const orcl = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".cc-bull tbody tr"));
      const row = rows.find((r) => r.querySelector(".cc-t")?.textContent.trim() === "ORCL");
      return Array.from(row.querySelectorAll("td"), (td) => td.textContent.trim());
    });
    deep(orcl.slice(0, 6), ["1", "ORCL", "+88", "81", "+1.92%", "$36.7M"],
      "a row carries rank, score, conviction, session change and net premium");
  }

  /* ---------- the ticker is a button, not a navigation ----------- */
  {
    /* THE DEFECT THIS REPLACES. Every name used to be <a href="?t=SYM">, so
       opening a card was a full document load that re-fetched both boards
       to rebuild the page the reader was already looking at. */
    const shape = await page.evaluate(() => {
      const el = document.querySelector(".cc-bull tbody .cc-t > *");
      return { tag: el.tagName, type: el.getAttribute("type"), t: el.dataset.t,
               href: el.getAttribute("href"), pop: el.getAttribute("aria-haspopup") };
    });
    eq(shape.tag, "BUTTON", "a name is a button");
    eq(shape.href, null, "and not an anchor to ?t=, which would reload the page");
    eq(shape.type, "button", "typed, so it cannot submit anything");
    eq(shape.t, "ORCL", "carrying the ticker the card delegation reads");
    eq(shape.pop, "dialog", "and announcing that it opens a dialog");

    /* A ROW WITH NO CARD IS NOT AN OPENER. The card costs vendor calls the
       run spends only on the names furthest from neutral, and this board
       publishes `deep` with `dp` on four rows of five. Withholding data-t
       is what actually keeps the fifth out of the click delegation. */
    const cat = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".cc-bull tbody tr"));
      const row = rows.find((r) => r.querySelector(".cc-t")?.textContent.trim() === "CAT");
      const el = row.querySelector(".cc-t > *");
      return { tag: el.tagName, t: el.dataset.t || null, title: el.getAttribute("title") };
    });
    eq(cat.tag, "SPAN", "a row the run built no card for renders as plain text");
    eq(cat.t, null, "with no data-t, so the delegation cannot reach it");
    ok(/No detail card/.test(cat.title || ""),
       `and it says why rather than looking broken (${cat.title})`);
    eq(await page.locator(".cc-open").count(), 8,
       "so eight of the nine published names open a card and the ninth says why");

    /* THE CARD OPENS IN PLACE. A marker set on the window survives a
       dialog; it does not survive a navigation, which is the difference
       this whole change is about. */
    await page.evaluate(() => { window.__noReload = true; });
    await page.locator('.cc-open[data-t="ORCL"]').click();
    await page.waitForSelector("#flowsCard[open]", { timeout: 10000 });
    ok(await page.evaluate(() => window.__noReload === true),
       "clicking a name opens the card WITHOUT reloading the document");
    ok(/[?&]t=ORCL/.test(page.url()), `and the address still carries the name (${page.url()})`);

    /* AND BACK CLOSES IT. The opener pushed one history entry, so the
       browser's own back gesture is the way out of the modal. */
    await page.goBack();
    /* Waited on the dialog's own `open`, not on visibility: a closed dialog
       is hidden, and waitForSelector's default state is "visible". */
    await page.waitForFunction(
      () => !document.getElementById("flowsCard").open, null, { timeout: 10000 });
    ok(!/[?&]t=ORCL/.test(page.url()), `back leaves the card and the address (${page.url()})`);
    ok(await page.evaluate(() => window.__noReload === true),
       "and back out of the dialog is not a reload either");
  }

  /* ---------- a score strip per row ------------------------------ */
  {
    /* THE ONE THING SIX TILES COULD NEVER SHOW: whether a name arrived at
       this score this morning or has been sitting on it for a month. */
    const strips = await page.evaluate(() => {
      const read = (sel) => Array.from(document.querySelectorAll(sel), (td) => {
        const svg = td.querySelector("svg");
        return {
          t: td.closest("tr").querySelector(".cc-t").textContent.trim(),
          drawn: !!svg,
          label: svg && svg.getAttribute("aria-label"),
          zero: !!(svg && svg.querySelector(".cc-zero")),
          text: td.textContent.trim(),
        };
      });
      return { bull: read(".cc-bull tbody .cc-trk"), bear: read(".cc-bear tbody .cc-trk") };
    });
    eq(strips.bull.length, 5, "every bull row gets a strip cell");
    for (const s of strips.bull) {
      ok(s.drawn, `${s.t} draws its trace beside its score`);
      ok(s.zero, `and against an always-drawn zero rule (${s.t})`);
    }
    /* AN ABSENCE IS AN EM DASH, NOT A FLAT LINE AT ZERO. XOM is in the
       board and not in the trace, and a strip drawn at zero for it would
       be a measurement this page never made. */
    const xom = strips.bear.find((s) => s.t === "XOM");
    ok(xom && !xom.drawn && xom.text === "—",
       `a name with no trace says so with an em dash (${xom && xom.text})`);

    /* ONE SHARED DOMAIN ACROSS BOTH SIDES. Left to itself every strip
       rescales to its own extremes and a name drifting ±2 draws the same
       picture as one swinging ±40, so a bull strip and a bear strip could
       not be read against each other at all. ORCL rises 80->88 and PFE
       falls -60->-91 on the same scale: PFE's whole trace must therefore
       sit BELOW ORCL's, which no per-series scale would produce. */
    const ends = await page.evaluate(() => {
      const y = (side, name) => {
        const row = Array.from(document.querySelectorAll(`${side} tbody tr`))
          .find((r) => r.querySelector(".cc-t").textContent.trim() === name);
        const dots = Array.from(row.querySelectorAll(".cc-trk circle"),
          (c) => Number(c.getAttribute("cy")));
        return { min: Math.min(...dots), max: Math.max(...dots) };
      };
      return { orcl: y(".cc-bull", "ORCL"), pfe: y(".cc-bear", "PFE") };
    });
    ok(ends.pfe.min > ends.orcl.max,
       `both sides are drawn on one scale (PFE ${ends.pfe.min.toFixed(1)} below ` +
       `ORCL ${ends.orcl.max.toFixed(1)}; y grows downward)`);
  }

  /* ---------- what changed --------------------------------------- */
  {
    /* THE QUESTION NO OTHER ROUTE ANSWERS. Every surface in this section
       reports a level; none reports a change, so a name that moved forty
       points overnight looked exactly like one that had not moved in a
       month. */
    const moves = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccChg .cc-moves li"),
      (li) => Array.from(li.children, (c) => c.textContent.trim())));
    deep(moves.map((m) => m[0]), ["PFE", "MU", "ORCL"],
      "the moves are ranked by size regardless of direction, and only real moves are moves");
    deep(moves[0], ["PFE", "−31", "now −91"],
      "each move names the delta and where it left the score");
    /* ACROSS A GAP. MU's trace is -20, nothing, -35: the comparison is
       against the previous session the name was SCORED. A gap means the
       name was not scored that day and never means it scored zero — the
       arithmetic that treats a gap as zero would print -35 here. */
    deep(moves[1], ["MU", "−15", "now −35"],
      "a gap in a trace is skipped, never read as a zero to subtract from");
    ok(!moves.some((m) => m[0] === "DE" || m[0] === "KLA"),
       "a name that held its score, and a name with only one session, are not moves");
  }

  /* ---------- the three silences, side by side ------------------- */
  {
    /* An unpublished key, a request that failed, and a measured emptiness
       are three different facts, and only the third says anything about
       the market. This is the whole reason FlowsUI.emptyState takes a
       `kind`: a test can tell them apart without parsing prose, and the
       page still owes the distinction in words. */
    const pending = await page.evaluate(() => {
      const p = document.querySelector("#ccEvents [data-empty]");
      return p && { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    ok(pending, "the never-published events calendar renders a silence");
    eq(pending.kind, "pending", "marked as an unpublished key");
    ok(/has not been published/.test(pending.text) && !/could not be read/.test(pending.text),
       `and worded as one — the pipeline has not spoken (${pending.text})`);
    ok(!/No name/.test(pending.text),
       "and it makes no claim about what the calendar holds, because it has not seen it");

    /* Populated regions, for contrast: neither of these is a silence. */
    eq(await page.locator("#ccAlerts tbody tr").count(), 3,
       "the flagged-window region draws the vendor's rows");
    const alert = await page.locator("#ccAlerts tbody tr").first()
      .locator("td").allTextContents();
    deep(alert.map((s) => s.trim()), ["ORCL", "C 250 09-18", "$3.0M", "RepeatedHits"],
      "each flagged window names the contract, the premium and the rule that fired");

    eq(await page.locator("#ccWatch .cc-moves li").count(), 2,
       "and the dead band's residents are listed rather than counted");
    /* NO OPENERS HERE. These are the names closest to neutral, so by the
       deep rule none of them has a card, and a link that opens nothing is
       worse than no link. */
    eq(await page.locator("#ccWatch .cc-open").count(), 0,
       "the watch region mints no opener, because no watched name has a card");
  }

  /* ---------- a failed request is not a quiet market ------------- */
  {
    allowFetchFailure = true;
    await page.route("**/api/flows/scoretrack*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const failed = await page.evaluate(() => {
      const p = document.querySelector("#ccChg [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    eq(failed.kind, "unreadable", "an endpoint that answered 500 is marked unreadable");
    ok(/could not be read/.test(failed.text),
       `and says the fault is this page's (${failed.text})`);
    ok(/not a fact about the session/.test(failed.text) || !/No name/.test(failed.text),
       "and refuses to report it as a session in which nothing moved");
    /* The other six regions are untouched: one endpoint that does not
       answer must not blank the regions that did. */
    ok(await page.locator(".cc-bull tbody tr").count() === 5,
       "and the regions that did answer are unaffected");
    /* A row whose trace could not be read shows the em dash, not a zero. */
    eq(await page.locator(".cc-bull tbody .cc-trk svg").count(), 0,
       "with no strip drawn from a payload that never arrived");
    await page.unroute("**/api/flows/scoretrack*");
    allowFetchFailure = false;
  }

  /* ---------- a pending board is not a board with nothing on it -- */
  {
    /* THE WORKER'S PENDING ENVELOPE CARRIES AN EMPTY ROWS ARRAY —
       {status:"pending", rows: []} — so every naive rows.length on this page
       reads a key that was never published as a session in which no name
       leaned. That number then reaches the reader as a rail badge and a
       verdict tile, which are the two places on the page nobody thinks to
       doubt. Served here exactly as the Worker serves it. */
    await page.route("**/api/flows/board?side=watch", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ side: "watch", rows: [], generatedAt: null, status: "pending" }),
    }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccWatch [data-empty]", { timeout: 15000 });
    const kind = await page.evaluate(
      () => document.querySelector("#ccWatch [data-empty]").dataset.empty);
    eq(kind, "pending", "an unpublished watch board is pending, not empty");
    const badge = await page.evaluate(() => {
      const el = document.querySelector('[data-rail-count="watch"]');
      return { text: el.textContent.trim(), hidden: el.hidden };
    });
    eq(badge.hidden, true, "and the rail badges nothing rather than badging 0");
    eq(badge.text, "", "with no number left behind in the slot");
    eq(await page.locator("#ccWatchSub").textContent(), "inside the dead band",
       "and the region header counts nothing it was never given");
    await page.unroute("**/api/flows/board?side=watch");
  }

  /* ---------- a measured emptiness IS a reading ------------------ */
  {
    /* Every name compared, every one unchanged. That is a fact about the
       session and it is allowed to be said — unlike the two above. */
    await post("scoretrack", scoretrack(trackNames.map((n) => ({
      ...n, s: n.s.map((v) => (v === null ? null : n.last)),
    }))));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const still = await page.evaluate(() => {
      const p = document.querySelector("#ccChg [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    eq(still.kind, "empty", "a trace that moved nowhere is a measured emptiness");
    ok(/No name's score moved between the last two archived sessions/.test(still.text),
       `and says exactly that, in the session's own terms (${still.text})`);
    ok(!/fixture|dry run|synthetic/i.test(still.text),
       "without explaining itself in terms of how the data was made");
    ok(/\d+ names were compared/.test(still.text),
       `and says how many names it compared, so the claim has a population (${still.text})`);
    /* THE STRIPS STILL DRAW. A flat trace is a trace. */
    ok(await page.locator(".cc-bull tbody .cc-trk svg").count() === 5,
       "and the strips still draw, because a flat line is a measurement");
    await post("scoretrack", scoretrack(trackNames));
  }

  /* ---------- the dead band is DRAWN, not inferred --------------- */
  {
    /* 15 of 24 names scored inside ±20 and are published on neither side.
       That is why this page is short, and a reader who cannot see it reads
       a nine-name page as a broken one. */
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#spinePlot svg", { timeout: 15000 });
    const spine = await page.evaluate(() => {
      const svg = document.querySelector("#spinePlot svg");
      if (!svg) return null;
      const band = svg.querySelector(".sp-band");
      const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      const ticks = Array.from(svg.querySelectorAll(".sp-ticklabel")).map((t) => t.textContent.trim());
      const dots = Array.from(svg.querySelectorAll(".sp-dot")).map((d) => ({
        x: Number(d.getAttribute("cx")),
        bull: d.classList.contains("is-bull"),
        t: d.getAttribute("data-t"),
        title: (d.querySelector("title") || {}).textContent,
      }));
      /* The axis declares its own reference points. Reading the two end ticks
         out of the DOM lets the mapping be checked without this test knowing
         the renderer's padding or plot width. */
      const tickX = {};
      const labels = Array.from(svg.querySelectorAll(".sp-ticklabel"));
      const lines = Array.from(svg.querySelectorAll(".sp-tick"));
      labels.forEach((l, i) => { tickX[l.textContent.trim()] = Number(lines[i].getAttribute("x1")); });
      const axis = svg.querySelector(".sp-axis");
      return {
        hasBand: !!band,
        bandFill: band && band.getAttribute("fill"),
        bandLabel: (svg.querySelector(".sp-bandlabel") || {}).textContent,
        ariaLabel: svg.getAttribute("aria-label"),
        width: vb[2], ticks, dots, tickX,
        axis: axis ? { x1: Number(axis.getAttribute("x1")), x2: Number(axis.getAttribute("x2")) } : null,
        hasPattern: !!svg.querySelector("defs pattern"),
        inRegion: !!document.querySelector(".cc-spine .spine #spinePlot"),
      };
    });
    ok(spine, "the spine is drawn");
    /* RE-SEATED, NOT REPLACED. The regions above are an index of the
       distribution; this is the only view of the whole of it. */
    ok(spine.inRegion, "and it kept its place, inside a region of the command center");
    ok(spine.hasBand, "and it carries the dead band");
    /* HATCHED, NOT TINTED. A flat fill reads as one more band of the axis,
       and disappears entirely in a greyscale render. */
    ok(spine.hasPattern && /url\(#/.test(spine.bandFill || ""),
       `the band is hatched so it survives greyscale (${spine.bandFill})`);
    ok(/15 of 24/.test(spine.bandLabel || ""),
       `and says how much of the market it swallowed (${spine.bandLabel})`);
    ok(/not named/.test(spine.bandLabel || ""), "and that those names are not published");
    ok(/dead band/.test(spine.ariaLabel || "") || /inside the plus or minus/.test(spine.ariaLabel || ""),
       `a screen reader is told the same thing the picture says (${spine.ariaLabel})`);

    /* THE AXIS IS FIXED AT ±100, not scaled to the day. A data-scaled axis
       makes a quiet session look like a violent one: the widest name of a
       flat day would touch the same edge as a limit move, and two sessions
       would stop being comparable at a glance — which is the only thing an
       axis with a real unit is for. */
    deep(spine.ticks, ["−100", "−50", "0", "+50", "+100"],
      "the axis is labelled -100..+100");

    /* THE LABELS ARE NOT THE SCALE. A first version of this block checked
       only the tick text, which is a hardcoded list and stays correct under
       any mapping: rescaling the axis to ±50 left every label right, every
       mark in the wrong place, and the block passing.

       The second version anchored on the -100 and +100 ticks and checked
       each mark against a linear interpolation between them — which is a
       TAUTOLOGY, because the ticks are drawn by the same function as the
       marks. Under ANY affine mapping the ticks move with the dots and the
       relation holds exactly. It survived the same mutation.

       What a rescale actually breaks is that ±100 are the ENDS OF THE DRAWN
       AXIS. Under a ±50 mapping the -100 tick sits at a negative x — off the
       canvas entirely — while the axis line still spans the same box. So the
       tick positions are checked against the LINE, which is drawn from the
       padding and not from the scale, and the interpolation check is kept
       for what it does prove: that the marks are linear in the score and in
       the right order. */
    ok(spine.axis, "the spine draws an axis line");
    const x0 = spine.tickX["−100"], x1 = spine.tickX["+100"];
    ok(Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0,
       "the axis declares both of its endpoints");
    ok(Math.abs(x0 - spine.axis.x1) < 0.75,
       `the -100 tick IS the left end of the drawn axis (${x0} vs ${spine.axis.x1})`);
    ok(Math.abs(x1 - spine.axis.x2) < 0.75,
       `and +100 IS the right end (${x1} vs ${spine.axis.x2})`);
    ok(x0 >= 0 && x1 <= spine.width,
       `so the whole axis is on the canvas (${x0}..${x1} in 0..${spine.width})`);
    for (const d of spine.dots) {
      const score = SCORES.get(d.t);
      ok(score !== undefined, `the mark ${d.t} is a name from the payload`);
      const want = x0 + ((score + 100) / 200) * (x1 - x0);
      ok(Math.abs(d.x - want) < 0.75,
         `${d.t} at ${score} sits where a fixed ±100 axis puts it (${d.x.toFixed(1)} vs ${want.toFixed(1)})`);
      ok(d.x >= spine.axis.x1 - 0.75 && d.x <= spine.axis.x2 + 0.75,
         `and ${d.t} is drawn on the axis rather than past its end (${d.x.toFixed(1)})`);
    }

    /* EVERY PUBLISHED NAME HAS A MARK. Five bulls and four bears against
       regions capped at ten is what keeps this honest at this size; the cap
       is what makes it matter on a real session, where the tail runs past
       forty a side and the spine is the only place the rest of it exists. */
    eq(spine.dots.length, 9, "the spine marks every published name");
    const bulls = spine.dots.filter((d) => d.bull).map((d) => d.x);
    const bears = spine.dots.filter((d) => !d.bull).map((d) => d.x);
    eq(bulls.length, 5, "all five bullish names are on the axis");
    eq(bears.length, 4, "and all four bearish ones");
    ok(Math.max(...bears) < Math.min(...bulls),
       "every bearish mark sits left of every bullish one");

    /* A MARK WITH NO NAME IS A DOT. On a real session most of these belong
       to names past the region cap, so each carries its own accessible name
       rather than being an anonymous smudge on an axis. */
    const orclDot = spine.dots.find((d) => d.t === "ORCL");
    ok(orclDot && /ORCL/.test(orclDot.title || "") && /\+88/.test(orclDot.title || ""),
       `each mark names itself and its score (${orclDot && orclDot.title})`);
  }

  /* ---------- the rail counts what is actually there -------------- */
  {
    /* The slots are server-rendered EMPTY and hidden: filling them in the
       Worker would cost a D1 row read per page view for a number this page
       fetches anyway. A badge reading 0 while the fetch is in flight is a
       claim about the session, not a loading state. */
    const counts = await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("[data-rail-count]")) {
        out[el.dataset.railCount] = { text: el.textContent.trim(), hidden: el.hidden };
      }
      return out;
    });
    eq(counts.long?.text, "5", "the rail badges the bullish count");
    eq(counts.short?.text, "4", "and the bearish one");
    eq(counts.watch?.text, "2", "and the dead band's, which this page also has in hand");
    eq(counts.long?.hidden, false, "and reveals them once there is a real number");

    /* THE SLOT THAT WAS NEVER RENDERED. flows-events.js has filled
       [data-rail-count="events"] since the calendar shipped, and the rail
       emitted the slot for three keys and not that one — so the query
       matched nothing and the badge could never appear, silently. */
    ok("events" in counts, "the events slot exists to be filled at all");
    eq(counts.events?.hidden, true,
       "and stays hidden here, because this page has no count for it");

    const sub = await page.locator("#ccBullSub").textContent();
    ok(/all 5/.test(sub), `the region header says how many the side actually holds (${sub})`);
    eq(await page.locator("#ccBullSub").getAttribute("href"), "/flows/long/",
       "and is the way to the full side, which is a page rather than a state");
  }

  /* ---------- nothing overflows a phone -------------------------- */
  {
    /* THE STRIPS ARE DRAWN AT A FIXED 150px — one viewBox unit is one CSS
       pixel — so a seven-column row has a hard minimum width no reflow can
       get under. It has to scroll inside its own box; the page may not. */
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1);
      eq(overflow, false, `the overview overflows nothing at ${width}px`);
    }
    const scrolls = await page.evaluate(() => {
      const wrap = document.querySelector(".cc-bull .cc-wrap");
      return { scrollable: wrap.scrollWidth > wrap.clientWidth, focusable: wrap.tabIndex === 0 };
    });
    ok(scrolls.scrollable, "the ranked table scrolls inside its own box instead");
    ok(scrolls.focusable, "and that scroll is reachable from a keyboard");

    /* The rail is a DRAWER at this width, not a column — but it is still a
       nav, and every destination has to survive the collapse. */
    for (const dest of ["/flows/", "/flows/long/", "/flows/short/", "/flows/desk/"]) {
      ok(await page.locator(`.flows-rail a[href="${dest}"]`).isVisible(),
         `${dest} is still reachable at 390px`);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  /* ---------- two sides, two sessions, and the page says so ------ */
  {
    /* THE DEFECT THIS FILE EXISTS FOR. The halves are two fetches of two
       rows. A pipeline that published long and then failed leaves the
       previous session's bulls in D1 beside today's bears — and both halves
       render perfectly, with no field anywhere that disagrees. */
    await post("board:short", board("short", bearRows, "2026-08-21", { deep: 4 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsStale:not([hidden])", { timeout: 15000 });
    const warn = await page.locator("#flowsStale").textContent();
    ok(/different sessions/.test(warn), `mismatched halves are called out (${warn})`);
    ok(/2026-08-24/.test(warn) && /2026-08-21/.test(warn),
       `and both dates are named, so the reader knows which half is stale (${warn})`);
    /* The names still render: a stale half is still a reading, and blanking
       the page would throw away the half that IS current. */
    ok(await page.locator(".cc-bull tbody tr").count() > 0,
       "and the current half is still shown rather than blanked");
  }

  /* ---------- an empty side is a reading, not a failure ---------- */
  {
    await post("board:short", board("short", [], SESSION, { deep: 0 }));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".cc-bear [data-empty]", { timeout: 15000 });
    const empty = await page.evaluate(() => {
      const p = document.querySelector(".cc-bear [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    /* THIRD SILENCE, AND THE ONLY ONE THAT IS A CLAIM ABOUT THE MARKET.
       The dead band can legitimately leave a side with nothing, so this is
       the ordinary case — and it must not share a sentence with the two
       above, which are claims about this page. */
    eq(empty.kind, "empty", "an empty side is a measured emptiness");
    ok(/No name leaned bearish/.test(empty.text),
       `and says what happened, not "error" (${empty.text})`);
    ok(!/could not be read/.test(empty.text) && !/has not been published/.test(empty.text),
       "in words that are not either of the other two silences");
    eq(await page.locator(".cc-bull tbody tr").count(), 5,
       "and the other side is unaffected");
    eq(await page.locator("#spinePlot .sp-dot").count(), 5,
       "the spine draws what there is");
    eq(await page.locator("#ccBearSub").textContent(), "0 ranked",
       "and the region header counts the nothing rather than promising ten");
  }

  eq(errors.length, 0, `no uncaught page error across the whole session (${errors[0] || ""})`);

  console.log(`✓ flows-overview: ${checks} assertions — seven regions from seven endpoints ` +
    `that already existed, both sides whole and in the payload's own rank order, a score ` +
    `strip per row on one shared domain, what changed measured across gaps rather than ` +
    `through them, names that open a card without a reload, three silences in three ` +
    `sentences, a fixed axis with the dead band hatched onto it, live rail counts, and two ` +
    `halves that refuse to be presented as one session when they are not`);
} finally {
  await browser.close();
  await server.stop();
}
