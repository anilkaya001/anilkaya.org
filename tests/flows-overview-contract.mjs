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

   AND THE PAGE NOW LEADS ON CHANGE. It answered "what is the LEVEL" — both
   tails ranked, the band drawn — which is the right page at 16:00 and the
   wrong one at 09:15, when the reader already knows GOOG is +71 because it
   was +71 yesterday. So "What changed" is the first region under the verdict
   bar, spans the whole grid, and ranks CROSSINGS of the dead band above
   magnitude: a name that left the band became actionable this session and a
   name that fell back into it stopped being so, and neither is a bigger
   version of a drift. Every number in it arrives DERIVED, from the change
   layer on the payload, and this file's fixture is built by the same shaper
   that publishes it so the two cannot drift apart.

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
import { buildScoreTrack } from "../shared/flows-scores.js";

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

/* THE TRACE IS BUILT BY THE SHAPER THAT PUBLISHES IT.

   A hand-written scoretrack was the right fixture while the renderer did its
   own subtraction. It is the wrong one now: the payload carries the change
   layer, and a hand-written `d1` is this file's OPINION about what
   buildScoreTrack emits rather than what it emits. So the fixture states the
   thing the archive actually holds — sessions of scores — and
   shared/flows-scores.js derives d1, lastAt, run, ext and change from them.
   A change to that derivation now reaches this suite instead of passing it.

   THE SESSIONS ARE CHOSEN SO EVERY BRANCH OF THE CHANGE LAYER FIRES ONCE,
   against the board's ±20 dead band:

     CAT   -30 ->  26  FLIPPED: outside the band at both ends, opposite
                       signs. The largest move on the page — and the one name
                       the run built NO detail card for, so a crossing must
                       still render as plain text rather than be minted into
                       an opener that opens nothing.
     NKE    45 ->  18  FADED: out of the band and into it. NKE is the watch
                       board's first row at 18, so the two payloads agree
                       about where it ended up.
     MU    -18 -> -35  CLEARED, ACROSS A GAP of two sessions: the name was
                       not scored on 2026-08-21 at all, and a renderer that
                       filters the nulls out before subtracting cannot tell.
     PFE   -60 -> -91  the largest DRIFT, and larger than two of the three
                       crossings — so a renderer still ranking on |delta|
                       heads the region with it and fails here.
     ORCL   80 ->  88  a small overnight drift, and the only pair carrying a
                       residual at both ends, so it is the only row that can
                       print an unsaturated move.
     DE / ADBE         measured twice, moved zero. Held, which is not moved.
     BAC   -55 -> -62  moved, and its newest score is on the PRIOR session:
                       the reading is real and it is not about today.
     AVGO   62 ->  40  stale AND spanning the board-only backfill session,
                       which is sparser rather than quieter.
     KLA    41         one session only: nothing to subtract from.
     XOM               absent from the trace entirely, which its strip must
                       say with an em dash rather than a flat line at zero. */
const TRACK_DAYS = [
  { d: "2026-08-18", source: "boards", rows: [
    { t: "ORCL", s: 74 }, { t: "PFE", s: -55 }, { t: "NKE", s: 50 },
    { t: "CAT", s: -30 }, { t: "DE", s: 57 }, { t: "BAC", s: -50 }, { t: "AVGO", s: 62 },
  ] },
  { d: "2026-08-19", source: "scores", rows: [
    { t: "ORCL", s: 76 }, { t: "PFE", s: -58 }, { t: "MU", s: -18 }, { t: "NKE", s: 47 },
    { t: "CAT", s: -31 }, { t: "DE", s: 57 }, { t: "ADBE", s: 33 }, { t: "BAC", s: -55 },
  ] },
  { d: "2026-08-21", source: "scores", rows: [
    { t: "ORCL", s: 80, q: 1820 }, { t: "PFE", s: -60 }, { t: "NKE", s: 45 },
    { t: "CAT", s: -30 }, { t: "DE", s: 57 }, { t: "ADBE", s: 33 },
    { t: "BAC", s: -62 }, { t: "AVGO", s: 40 },
  ] },
  { d: SESSION, source: "scores", rows: [
    { t: "ORCL", s: 88, q: 2450 }, { t: "PFE", s: -91 }, { t: "MU", s: -35 },
    { t: "NKE", s: 18 }, { t: "CAT", s: 26 }, { t: "DE", s: 57 },
    { t: "ADBE", s: 33 }, { t: "KLA", s: 41 },
  ] },
];

/* EVERY NAME COMPARED, NOT ONE OF THEM MOVED. A reading about the session,
   and the one silence on this region that is a claim about the market. */
const FLAT_DAYS = ["2026-08-21", SESSION].map((d) => ({
  d, source: "scores",
  rows: [...bullRows, ...bearRows].map((r) => ({ t: r.t, s: r.s })),
}));

/* TWO SESSIONS THAT SHARE NO NAME. Nothing has two observations, so no
   change EXISTS to report — which is a fact about the archive and not about
   a market that stood still, and the two may not share a sentence. */
const COLD_DAYS = [
  { d: "2026-08-21", source: "scores", rows: [{ t: "ORCL", s: 80 }] },
  { d: SESSION, source: "scores", rows: [{ t: "PFE", s: -91 }] },
];

const scoretrack = (days) => ({
  v: 2, sessionDate: SESSION, generatedAt: new Date().toISOString(),
  ...buildScoreTrack(days, { deadBand: 20, epoch: "2026-08-26" }),
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
await post("scoretrack", scoretrack(TRACK_DAYS));
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
    eq(tiles.length, 7, "the verdict bar states seven readings");
    const by = Object.fromEntries(tiles.map((t) => [t.k, t]));

    eq(by.Session?.v, SESSION, "the verdict names the session it is about");
    eq(by.Screened?.v, "264", "and how many names were screened, from the market payload");

    /* TWO TILTS, BECAUSE THE PAYLOAD PUBLISHES TWO AND REFUSES TO CHOOSE
       BETWEEN THEM. breadth.tilt counts names and premium.tilt weights
       dollars; shared/flows-market.js says publishing both is what removes
       the weighting choice instead of burying it. This bar used to print ONE
       of them under the bare label "Tilt", so on a day the two part company
       the landing page showed the opposite sign to /flows/market/ over the
       same payload — and it printed a bounded ratio to four decimals with no
       unit at all. U+2212, not a hyphen, in both. */
    eq(by["Tilt · names"]?.v, "−1.4%",
       "the equal-weight tilt is a share of names, with its unit");
    eq(by["Tilt · dollars"]?.v, "−2.1%",
       "and the dollar-weight tilt is a share of premium, on the same tile row");
    /* AND IT NAMES THE POPULATION IT IS A SHARE OF. breadth.tilt divides by
       bull + bear, not by the 264 in the Screened tile beside it, and
       premium.tilt is a share of gross NET premium — which shared/
       flows-market.js says explicitly is not call premium and not put
       premium. Both subtitles used to name the wrong denominator. */
    eq(by["Tilt · names"]?.s, "of the names that leaned, bull − bear",
       "each tile says what it is a share OF, in the denominator the shaper used");
    eq(by["Tilt · dollars"]?.s, "of gross net premium, bought − sold",
       "and the two subtitles are not the same sentence, nor two vendor columns this is not made of");
    ok(/is-neg/.test(by["Tilt · names"]?.cls || "") &&
       /is-neg/.test(by["Tilt · dollars"]?.cls || ""),
       `and a sold tape is toned as one on both (${by["Tilt · names"]?.cls})`);
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
    /* THE NAME NODE, NOT THE WHOLE CELL. The cell now also carries the
       crossing tag and the earnings marker, which are facts ABOUT the name
       and not part of it — reading the cell whole would make this assertion
       fail the moment either one fires, which is exactly what it did. */
    const bull = (await page.locator(".cc-bull tbody .cc-t > :first-child").allTextContents()).map((s) => s.trim());
    const bear = (await page.locator(".cc-bear tbody .cc-t > :first-child").allTextContents()).map((s) => s.trim());
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
      const row = rows.find((r) => r.querySelector(".cc-t > :first-child")?.textContent.trim() === "ORCL");
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
      const row = rows.find((r) => r.querySelector(".cc-t > :first-child")?.textContent.trim() === "CAT");
      const el = row.querySelector(".cc-t > *");
      return { tag: el.tagName, t: el.dataset.t || null, title: el.getAttribute("title") };
    });
    eq(cat.tag, "SPAN", "a row the run built no card for renders as plain text");
    eq(cat.t, null, "with no data-t, so the delegation cannot reach it");
    ok(/No detail card/.test(cat.title || ""),
       `and it says why rather than looking broken (${cat.title})`);
    /* SCOPED TO THE TWO RANKED REGIONS. The lead region mints openers for
       the same rule over its own rows, so a page-wide count would be
       counting two regions and asserting about one. */
    eq(await page.locator(".cc-bull .cc-open, .cc-bear .cc-open").count(), 8,
       "so eight of the nine published names open a card and the ninth says why");

    /* THE CARD OPENS IN PLACE. A marker set on the window survives a
       dialog; it does not survive a navigation, which is the difference
       this whole change is about. */
    await page.evaluate(() => { window.__noReload = true; });
    await page.locator('.cc-bull .cc-open[data-t="ORCL"]').click();
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
          t: td.closest("tr").querySelector(".cc-t > :first-child").textContent.trim(),
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
          .find((r) => r.querySelector(".cc-t > :first-child").textContent.trim() === name);
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

  /* ---------- the lead region: what changed ---------------------- */
  {
    /* THE PAGE NOW LEADS ON CHANGE. Every surface in this section reports a
       LEVEL; at 09:15 the reader already knows GOOG is +71 because it was
       +71 yesterday. What they do not know is which four names crossed. So
       this region is first under the verdict bar and spans the whole grid,
       rather than being two of twelve columns holding a three-item list
       BELOW both ranked tables. */
    const seat = await page.evaluate(() => {
      const region = document.getElementById("ccChg").closest(".cc-region");
      const grid = region.parentNode;
      const after = document.getElementById("ccVerdict").nextElementSibling;
      return {
        leads: after === region,
        aboveBull: !!(region.compareDocumentPosition(document.getElementById("ccBull")) &
                      Node.DOCUMENT_POSITION_FOLLOWING),
        width: Math.round(region.getBoundingClientRect().width),
        gridWidth: Math.round(grid.getBoundingClientRect().width),
      };
    });
    ok(seat.leads, "the change region is the first region under the verdict bar");
    ok(seat.aboveBull, "and it reads before the ranked poles rather than after them");
    ok(Math.abs(seat.width - seat.gridWidth) <= 2,
       `and spans the whole twelve-column grid (${seat.width} of ${seat.gridWidth})`);

    /* THE DENOMINATOR IS PUBLISHED WITH THE MOVES. "Eight names moved" is
       not a reading: eight of twelve is a session that turned and eight of
       four hundred is a Tuesday. The change layer counts the whole pool
       BEFORE the payload's size cap sheds rows, so this paragraph states a
       population no renderer counting its own visible rows could reach. */
    const lede = (await page.locator("#ccChg .cc-lede").textContent()).trim();
    ok(/7 of 9 names/.test(lede),
       `the region states how many moved out of how many were comparable (${lede})`);
    ok(/±20/.test(lede), `and the threshold the crossings are counted against (${lede})`);
    ok(/1 cleared, 1 faded back inside, 1 flipped sides/.test(lede),
       `and the three crossing counts by name, not as one total (${lede})`);
    ok(/2026-08-21/.test(lede) && new RegExp(SESSION).test(lede),
       `and the two sessions it is a change between (${lede})`);
    ok(/2 names were scored on the prior session and not on this one/.test(lede),
       `and the names that left the pool, which no delta can show (${lede})`);

    const rows = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccChg tbody tr"),
      (tr) => Array.from(tr.children, (td) => td.textContent.trim())));

    /* CROSSINGS OUTRANK MAGNITUDE. PFE's −31 is larger than two of the three
       crossings and it still sorts below all of them, because a change of
       CATEGORY is not a bigger version of a change of degree: inside the
       band a name reaches no board at all. A renderer ranking on |delta| —
       which is what this file used to assert — heads the list with PFE and
       fails here. */
    deep(rows.map((r) => r[1]), ["CAT", "NKE", "MU", "PFE", "ORCL", "AVGO", "BAC"],
      "crossings lead, then fresh drift by size, then the readings that are not about today");

    deep(rows[0], ["flipped · window high", "CAT", "+56", "1 session", "+26", "—", "1",
                   "this session"],
      "each row names the event, the move, the span it took, where it landed and how old the opinion is");

    /* THE GAP TRAVELS WITH THE DELTA, ALWAYS. MU was not scored on
       2026-08-21 at all: its −17 spans two sessions and PFE's −31 spans one,
       and the integers alone cannot be told apart. Filtering the nulls out
       before subtracting — which is what this page used to do — discards
       exactly this. */
    /* AND THE COLUMN HEADERS SAY WHICH SESSION EACH NUMBER IS ABOUT. The
       score column used to be headed "Now", which on the rows this region
       deliberately keeps — readings that are real and are not about today —
       contradicted the "As of" cell two columns along. */
    const heads = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccChg thead th"), (th) => th.textContent.trim()));
    deep(heads, ["Event", "Name", "Δ score", "Over", "Ended at", "Δ resid ×10⁴",
                 "Run · sessions", "As of"],
      "every column is headed with what it measures and, where it has one, its unit");

    const by = Object.fromEntries(rows.map((r) => [r[1], r]));
    eq(by.MU[3], "2 sessions", "a move across a gap says how many sessions it spans");
    eq(by.PFE[3], "1 session", "and an overnight move says that it is one");
    eq(by.MU[0], "cleared · window low",
       "the name that came out of the dead band is the headline event, in words");
    eq(by.NKE[0], "faded · window low",
       "and the exit signal is worded as its own event, not as a smaller entry");

    /* A BOARD-ONLY SESSION IS SPARSER, NOT QUIETER: those columns were
       reconstructed from archived boards, which hold only the names that
       made a board that day. A comparison that spans one is not a
       comparison across a full pool and says so. */
    eq(by.AVGO[3], "2 sessions · board-only",
       "a comparison spanning the backfill is marked rather than presented as adjacency");

    /* THE SCORE SATURATES AND THE RESIDUAL DOES NOT. Only ORCL carried a
       residual at both ends, so it is the only row that can print the move
       in units that do not compress — and an absent residual is an em dash,
       never a zero. */
    eq(by.ORCL[5], "+630", "a move is also given in residual units where both ends carried one");
    eq(by.PFE[5], "—", "and absent where either end did not, which is not a zero");

    /* STALE MEANS REAL, BUT NOT ABOUT TODAY. BAC's newest score is on the
       PRIOR session, so its −7 happened before this morning. A page that
       leads on change owes that before it owes the magnitude, and both such
       rows sort below every reading that is about this session. */
    eq(by.BAC[7], "2026-08-21 · 1 session back",
       "a name not scored in the newest session says which session it was last scored on");
    eq(by.ORCL[7], "this session", "and one that was says so");
    const fresh = rows.findIndex((r) => r[7] !== "this session");
    ok(fresh === 5, `and the stale readings are demoted below the fresh ones (${fresh})`);

    ok(!rows.some((r) => r[1] === "DE" || r[1] === "ADBE"),
       "a name that held its score is counted in the paragraph and is not a move");
    ok(!rows.some((r) => r[1] === "KLA"),
       "and a name with one scored session has nothing to subtract from");

    /* THE NAMES OPEN. These are the same deep board rows that are rendered
       as openers in the ranked region twelve lines below, and this region
       used to emit a plain <span> for every one of them — so the region
       leading the page was the only dead text on it. */
    const cells = await page.evaluate(() => {
      const out = {};
      for (const tr of document.querySelectorAll("#ccChg tbody tr")) {
        const name = tr.children[1];
        const node = name.querySelector("*");
        out[name.textContent.trim()] =
          { tag: node.tagName, t: node.dataset.t || null, title: node.getAttribute("title") };
      }
      return out;
    });
    eq(cells.ORCL?.tag, "BUTTON", "a changed name with a card opens it in place");
    eq(cells.ORCL?.t, "ORCL", "carrying the ticker the card delegation reads");
    /* CAT crossed the band AND has no detail card. A crossing does not mint
       an opener that opens nothing. */
    eq(cells.CAT?.tag, "SPAN", "a crossing with no card is still plain text");
    eq(cells.CAT?.t, null, "with no data-t for the delegation to reach");
    ok(/No detail card/.test(cells.CAT?.title || ""),
       `and it says why rather than looking broken (${cells.CAT?.title})`);
    /* AVGO is in the trace and on neither board, so no card exists for it
       and none is claimed. */
    eq(cells.AVGO?.tag, "SPAN", "and a name on no board opens nothing either");

    /* THE CROSSING IS ALSO ON THE RANKED ROW, which is where a reader
       working down the list actually is. Without it the ten ranked opinions
       are indistinguishable in age: a name that cleared the band this
       morning and one that has sat outside it for a month print the same
       row. The tag is a WORD, so it survives greyscale, and it carries the
       payload's own prose as its title. */
    const tags = await page.evaluate(() => {
      const out = {};
      for (const td of document.querySelectorAll(".cc-bull tbody .cc-t, .cc-bear tbody .cc-t")) {
        const tag = td.querySelector(".cc-cross");
        out[td.querySelector(".cc-open, .cc-flat").textContent.trim()] =
          tag ? tag.textContent.trim() : null;
      }
      return out;
    });
    eq(tags.CAT, "flipped", "a ranked name that changed sides says so on its own row");
    eq(tags.MU, "cleared", "and one that came out of the band this session says that");
    eq(tags.PFE, null, "while the largest drift on the page carries no crossing tag");
    eq(tags.DE, null, "and neither does a name that has not moved at all");

    /* AND IT REALLY OPENS. The delegation in flows-card.js matches
       .cc-open[data-t] anywhere on the document, so the proof that this
       region's names are live — rather than merely button-shaped — is
       opening one from it and coming back out. */
    await page.locator('#ccChg .cc-open[data-t="MU"]').click();
    await page.waitForSelector("#flowsCard[open]", { timeout: 10000 });
    ok(/[?&]t=MU/.test(page.url()),
       `a name in the lead region opens its card in place (${page.url()})`);
    ok(await page.evaluate(() => window.__noReload === true),
       "without reloading the document");
    await page.goBack();
    await page.waitForFunction(
      () => !document.getElementById("flowsCard").open, null, { timeout: 10000 });
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
       session and it is allowed to be said — unlike the silences below it. */
    await post("scoretrack", scoretrack(FLAT_DAYS));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const still = await page.evaluate(() => {
      const p = document.querySelector("#ccChg [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    eq(still.kind, "empty", "a trace that moved nowhere is a measured emptiness");
    ok(/Every one of the 9 names with two scored sessions held its score/.test(still.text),
       `and says exactly that, in the session's own terms (${still.text})`);
    ok(/reading about the session rather than a gap in the archive/.test(still.text),
       `and names which of the two it is (${still.text})`);
    ok(/±20/.test(still.text) && /No name crossed it/.test(still.text),
       `and states the threshold nothing crossed (${still.text})`);
    ok(!/fixture|dry run|synthetic/i.test(still.text),
       "without explaining itself in terms of how the data was made");
    ok(/\b9\b/.test(still.text),
       `and says how many names it compared, so the claim has a population (${still.text})`);
    /* THE STRIPS STILL DRAW. A flat trace is a trace. */
    ok(await page.locator(".cc-bull tbody .cc-trk svg").count() === 5,
       "and the strips still draw, because a flat line is a measurement");
  }

  /* ---------- an archive too thin to answer is NOT a quiet market - */
  {
    /* THE FOURTH SENTENCE. Two sessions that share no name: nothing has two
       observations, so no change EXISTS to report. That is the shape of the
       archive, and wording it like the block above would publish "nothing
       moved" — a claim about the market — out of a page that could not
       measure movement at all. */
    await post("scoretrack", scoretrack(COLD_DAYS));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const cold = await page.evaluate(() => {
      const p = document.querySelector("#ccChg [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    eq(cold.kind, "unavailable",
       "an archive with nothing to compare is not a measured emptiness");
    ok(/No name in the pool was scored on two sessions/.test(cold.text),
       `and says what is missing (${cold.text})`);
    ok(/not a market that stood still/.test(cold.text),
       `refusing the reading it cannot make (${cold.text})`);
    ok(!/held its score/.test(cold.text),
       "in words that are not the measured-emptiness sentence");
    await post("scoretrack", scoretrack(TRACK_DAYS));
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
      /* LONGER THAN THE SPINE'S RESIZE DEBOUNCE. The spine is redrawn at the
         new width rather than scaled to it — one viewBox unit is one CSS
         pixel — and it repaints 150ms after the last resize event. Measuring
         the document's scrollWidth before that repaint measures the old
         width, which is a transient this assertion is not about. */
      await page.waitForTimeout(450);
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

  /* ---------- the earnings join, in both directions -------------- */
  {
    /* THE MOST EXPENSIVE MISTAKE THIS SURFACE CAN LET A READER MAKE is
       carrying a long signal into a print. Both boards and the events
       calendar were already fetched in the same Promise.all and were never
       joined: the page ranked ORCL #1 bullish in one region while another
       region three hundred pixels below said ORCL reports in three sessions,
       and neither region knew about the other.

       TWO SOURCES AND TWO UNITS. The board row carries `edte` in CALENDAR
       DAYS (the gate's own arithmetic on the row it spared) and the events
       payload carries `sdte` in TRADING SESSIONS. "3" means different things
       in each, so the marker prints the unit and the fixture gives ORCL both
       — the events count must win, because it is the count the gate itself
       measured. */
    await post("board:long", board("long", bullRows.map((r) =>
      r.t === "ORCL" ? { ...r, ed: "2026-08-27", edte: 3 }
      : r.t === "CAT" ? { ...r, ed: "2026-09-08", edte: 15 } : r), SESSION, { deep: 4 }));
    await post("board:short", board("short", bearRows, SESSION, { deep: 4 }));
    await post("events", {
      v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
      windowDays: 21, inWindow: 2, gateOrigin: SESSION,
      rows: [
        { t: "ORCL", d: "2026-08-27", dte: 3, sdte: 3, im: 0.0642, s: 88, st: "ranked" },
        /* A GATED NAME REACHED THE CALENDAR WITH NO SCORE AT ALL. The board
           was forbidden from holding an opinion on it, which is not the same
           as holding a neutral one — so this row must print an em dash and
           never a confident 0. */
        { t: "PFE", d: "2026-09-04", dte: 11, sdte: 8, im: 0.0310, s: null, st: "gated" },
      ],
    });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccEvents tbody tr", { timeout: 15000 });

    const marks = await page.evaluate(() => {
      const out = {};
      for (const td of document.querySelectorAll(".cc-bull tbody .cc-t")) {
        const mark = td.querySelector(".cc-ern");
        out[td.querySelector(".cc-open, .cc-flat").textContent.trim()] =
          mark ? { text: mark.textContent.trim(), title: mark.getAttribute("title") } : null;
      }
      return out;
    });
    ok(marks.ORCL, "a ranked name that reports inside the window is marked on the ranked row");
    eq(marks.ORCL.text, "⚠3s",
       "with the events payload's own unit — sessions, which is what the gate counted");
    ok(/2026-08-27/.test(marks.ORCL.title || ""),
       `and the date in the title, because a count with no origin is not checkable (${marks.ORCL.title})`);
    ok(/3 sessions/.test(marks.ORCL.title || ""),
       `spelled out rather than abbreviated (${marks.ORCL.title})`);
    /* CAT is on no calendar row, so the marker falls back to the board's own
       edte — a different quantity in a different unit, and it says so. */
    eq(marks.CAT?.text, "⚠15d",
       "a board row with no calendar row falls back to the board's calendar-day count");
    ok(/15 calendar days/.test(marks.CAT?.title || ""),
       `and never prints one unit's number under the other's name (${marks.CAT?.title})`);
    eq(marks.DE, null, "and a name that reports outside the window carries no marker at all");

    /* THE RECIPROCAL. The event row already carried the funnel stage and the
       score, and this region printed neither — so "Reporting soon" was a
       calendar sitting on the same page as a ranking with no thread between
       them. */
    const evRows = await page.evaluate(() => Array.from(
      document.querySelectorAll("#ccEvents tbody tr"),
      (tr) => Array.from(tr.children, (td) => td.textContent.trim())));
    deep(evRows[0], ["ORCL", "2026-08-27", "3s", "±6.4%", "+88", "ranked"],
      "the calendar row carries the score and the funnel stage it already held");
    eq(evRows[1][4], "—",
       "a gated name has no score, and an em dash is not a zero");
    eq(evRows[1][5], "gated", "and the stage says the board was forbidden, not neutral");
  }

  /* ---------- the two tilts, when they disagree ------------------ */
  {
    /* THE DISAGREEMENT IS THE READING. breadth.tilt counts names and
       premium.tilt weights dollars; when they part company the session was a
       lot of small buying against a little large selling, or the reverse,
       and no single number can say that. The bar used to print one of them
       under the bare label "Tilt", so on this session the landing page
       showed the opposite sign to /flows/market/ over the same payload. */
    await post("market", { ...market,
      breadth: { ...market.breadth, tilt: 0.0500 },
      premium: { ...market.premium, tilt: -0.0300 } });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".cc-bull tbody tr", { timeout: 15000 });
    const tiles = await page.evaluate(() => Object.fromEntries(
      Array.from(document.querySelectorAll("#ccVerdict .cc-tile"), (t) => [
        t.querySelector(".cc-tile-k")?.textContent.trim(),
        { v: t.querySelector(".cc-tile-v")?.textContent.trim(),
          s: t.querySelector(".cc-tile-s")?.textContent.trim() || "",
          cls: t.querySelector(".cc-tile-v")?.className || "" }])));
    eq(tiles["Tilt · names"]?.v, "+5.0%", "both weightings are printed, each as its own share");
    eq(tiles["Tilt · dollars"]?.v, "−3.0%", "so the page cannot show one sign and hide the other");
    ok(/is-pos/.test(tiles["Tilt · names"]?.cls || "") &&
       /is-neg/.test(tiles["Tilt · dollars"]?.cls || ""),
       "and each carries its own sign in the glyph before any hue is applied");
    eq(tiles["Tilt · names"]?.s, "the two weightings disagree in sign",
       "and the disagreement is stated rather than left for the reader to spot");
    eq(tiles["Tilt · dollars"]?.s, "the two weightings disagree in sign",
       "on both tiles, because either one alone would be the misleading half");
    await post("market", market);
  }

  /* ---------- one viewBox unit is one CSS pixel ------------------ */
  {
    /* THE INVARIANT flows-ui.js:20-27 STATES VERBATIM, which this chart was
       the only one on the site to break. renderSpine measured the host, then
       clamped the width to 900 and emitted width:"100%" — so at the 132rem
       canvas tier, where this region spans all twelve columns, a 900-unit
       viewBox was stretched across ~1700 CSS pixels: every dot rendered near
       radius 10 instead of 4.5, the 6-unit hatch became ~11px and the 9px
       tick labels rendered near 17px. */
    await page.setViewportSize({ width: 2000, height: 1000 });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#spinePlot svg", { timeout: 15000 });
    const wide = await page.evaluate(() => {
      const svg = document.querySelector("#spinePlot svg");
      const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      return {
        vbW: vb[2], attrW: svg.getAttribute("width"),
        rendered: Math.round(svg.getBoundingClientRect().width),
        host: Math.round(document.getElementById("spinePlot").clientWidth),
        par: svg.getAttribute("preserveAspectRatio"),
      };
    });
    ok(wide.host > 1000, `the canvas tier really does give the spine a wide host (${wide.host})`);
    eq(wide.attrW, String(wide.vbW),
       "the svg carries an explicit width attribute equal to its viewBox width");
    ok(Math.abs(wide.rendered - wide.vbW) <= 1,
       `so one viewBox unit renders as one CSS pixel (${wide.rendered} css for ${wide.vbW} units)`);
    ok(Math.abs(wide.rendered - wide.host) <= 1,
       `and the drawing is the measured host width, not a 900-unit clamp (${wide.host})`);
    eq(wide.par, "xMidYMid meet", "with the aspect rule the invariant names");

    /* REDRAWN AT THE NEW WIDTH, NEVER SCALED TO IT. Without the debounced
       repaint the first drag of a window edge reintroduces the same defect
       the clamp did, and nothing on the page corrects it. */
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.waitForTimeout(450);
    const narrow = await page.evaluate(() => {
      const svg = document.querySelector("#spinePlot svg");
      const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      return { vbW: vb[2], rendered: Math.round(svg.getBoundingClientRect().width),
               host: Math.round(document.getElementById("spinePlot").clientWidth) };
    });
    ok(narrow.vbW < wide.vbW,
       `a resize repaints the chart at the new width (${wide.vbW} -> ${narrow.vbW})`);
    ok(Math.abs(narrow.rendered - narrow.vbW) <= 1 && Math.abs(narrow.rendered - narrow.host) <= 1,
       `and the invariant survives it (${narrow.rendered} css for ${narrow.vbW} units)`);

    /* THE TRAIL IS THE CHANGE, ON THE LEVEL AXIS. Each mark trails back to
       the score the name held at its previous scored session, so the
       distribution of MOVEMENT is readable on the same fixed axis as the
       distribution of level — and a trail spanning more than one session is
       DASHED rather than tinted, so the difference survives a monochrome
       printout. */
    const trails = await page.evaluate(() => Array.from(
      document.querySelectorAll("#spinePlot .sp-move"), (l) => ({
        t: (l.querySelector("title") || {}).textContent || "",
        dashed: !!l.getAttribute("stroke-dasharray"),
        x1: Number(l.getAttribute("x1")), x2: Number(l.getAttribute("x2")),
      })));
    /* FOUR OF THE NINE MARKS, AND THE COUNT IS THE ASSERTION. ORCL, CAT, PFE
       and MU moved and their track reading is this board row. DE and ADBE
       held their score, KLA and XOM have nothing to subtract from, and BAC's
       newest reading is on the PRIOR session — the trail is a claim about
       this session's movement and BAC's move is not one, so it may not be
       drawn. `>= 5` was the assertion here, which passed while BAC was
       trailed from an origin neither payload contains. */
    eq(trails.length, 4,
       `only the names whose track reading IS this board row trail their move (${trails.length})`);
    deep(trails.map((l) => l.t.split(" ")[0]).sort(), ["CAT", "MU", "ORCL", "PFE"],
      "and they are the four that moved this session");
    const orcl = trails.find((l) => /^ORCL/.test(l.t));
    ok(orcl && /over 1 session/.test(orcl.t),
       `and each trail states its span in the title (${orcl && orcl.t})`);
    ok(orcl && orcl.x2 > orcl.x1, "with the trail running from where the name was to where it is");
    ok(!orcl.dashed, "an overnight move is drawn solid");
    const mu = trails.find((l) => /^MU/.test(l.t));
    ok(mu && mu.dashed && /over 2 sessions/.test(mu.t),
       `and a move across a gap is dashed rather than tinted (${mu && mu.t})`);
    /* A CROSSING IS RINGED, which is a shape and not a hue — and only TWO of
       the session's three crossings can be ringed here, because the spine
       marks PUBLISHED names and a name that faded is by definition back
       inside the band and on neither board. That is the whole argument for
       leading the page with the change region rather than with this chart:
       the exit signal is invisible on a picture of the published
       distribution, and it is the reading a holder needs most. */
    eq(await page.locator("#spinePlot .sp-cross").count(), 2,
       "the names that cleared and flipped are ringed on the axis");
    const ringed = await page.evaluate(() => Array.from(
      document.querySelectorAll("#spinePlot .sp-cross"), (c) => c.getAttribute("class")));
    deep(ringed.map((c) => c.replace("sp-cross ", "")).sort(), ["is-cleared", "is-flipped"],
      "each ring says which category change it marks");
    /* AND IT SAYS IT IN A WORD TOO. The ring is a shape, so THAT a crossing
       happened survives greyscale; WHICH one was carried by the class alone,
       which is a hue to a sighted reader and nothing at all to a screen
       reader. The mark's accessible name carries the word. */
    const muDot = await page.evaluate(() => (document.querySelector(
      '#spinePlot .sp-dot[data-t="MU"] title') || {}).textContent || "");
    ok(/· cleared$/.test(muDot), `a ringed mark names its crossing in words (${muDot})`);
    const deDot = await page.evaluate(() => (document.querySelector(
      '#spinePlot .sp-dot[data-t="DE"] title') || {}).textContent || "");
    ok(!/cleared|faded|flipped/.test(deDot),
       `and a mark that crossed nothing claims none (${deDot})`);
    eq(await page.locator('#spinePlot .sp-dot[data-t="NKE"]').count(), 0,
       "and the faded name is on no board, so the spine cannot show it at all");

    /* THE MARK WHOSE MOVE IS NOT ABOUT TODAY. BAC is on the bear board at
       −62 and its newest track reading is 2026-08-21, so the −7 it carries
       happened before this session. The dot is drawn — the LEVEL is today's,
       from the board — but nothing is trailed from it, because the origin
       would be the board's score minus a move measured on another session:
       a third number, neither payload's, drawn as a measurement. Its title
       says when it was last scored instead. */
    const bac = await page.evaluate(() => {
      const dot = document.querySelector('#spinePlot .sp-dot[data-t="BAC"]');
      return dot && {
        title: (dot.querySelector("title") || {}).textContent || "",
        trailed: Array.from(document.querySelectorAll("#spinePlot .sp-move"))
          .some((l) => /^BAC/.test((l.querySelector("title") || {}).textContent || "")),
      };
    });
    ok(bac, "a name whose reading is not about today is still marked at its published level");
    eq(bac.trailed, false, "but its move is not drawn from an origin neither payload holds");
    ok(/last scored 2026-08-21/.test(bac.title),
       `and the mark says when the track last saw it (${bac && bac.title})`);
    ok(!/over/.test(bac.title),
       "rather than restating a delta the change region has already dated");
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  /* ---------- a track whose newest session is not the board's ----- */
  {
    /* THE ORDINARY OUTAGE ON A PAGE THAT LEADS ON CHANGE. The board and the
       score track are two keys written by two legs of one run, and nothing
       forces the track's newest column to be the session the board is
       publishing: the archive can lag by a session, and a name can be out of
       the screener for a day and carry a real move measured last week.

       Every change reading on the page has to survive that, and before this
       phase two of them did not. The ranked row stamped "flipped" onto CAT
       from a reading a session old, and the spine trailed each mark from
       `board score − published move` — which is the previous observation
       only when the two payloads agree about where the name is NOW, and is
       otherwise a third number that neither of them contains.

       Served here by publishing one more session that holds only ORCL, at a
       score the board does not carry: every other name's newest reading is
       now a session behind, and ORCL's is current but at 92 against the
       board's 88. */
    await post("scoretrack", scoretrack(TRACK_DAYS.concat([{
      d: "2026-08-25", source: "scores", rows: [{ t: "ORCL", s: 92, q: 2600 }],
    }])));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#spinePlot svg", { timeout: 15000 });

    const stale = await page.evaluate(() => ({
      tags: document.querySelectorAll(".cc-bull .cc-cross, .cc-bear .cc-cross").length,
      trails: document.querySelectorAll("#spinePlot .sp-move").length,
      rings: document.querySelectorAll("#spinePlot .sp-cross").length,
      dots: document.querySelectorAll("#spinePlot .sp-dot").length,
      orcl: (document.querySelector('#spinePlot .sp-dot[data-t="ORCL"] title') || {}).textContent || "",
      /* THE NAME NODE, NOT THE CELL: by this point in the file the name cell
         also carries the earnings marker, and reading the cell whole keys
         this map on "ORCL⚠3s". */
      asOf: Array.from(document.querySelectorAll("#ccChg tbody tr"),
        (tr) => [tr.children[1].querySelector(".cc-open, .cc-flat").textContent.trim(),
                 tr.children[7].textContent.trim()]),
      aria: document.querySelector("#spinePlot svg").getAttribute("aria-label") || "",
    }));
    eq(stale.tags, 0,
       "no ranked row claims a crossing once the track's newest reading is not this session's");
    eq(stale.trails, 0,
       "and the spine trails nothing rather than drawing an origin from two payloads that disagree");
    eq(stale.rings, 0, "and rings no crossing onto a session it did not happen on");
    eq(stale.dots, 9, "while every published name is still marked at the level the BOARD published");
    ok(/last scored 2026-08-25/.test(stale.orcl),
       `a mark whose track score is not the board's says when the track last saw it (${stale.orcl})`);
    ok(!/trail the move/.test(stale.aria),
       "and the accessible description does not promise trails that are not drawn");

    /* The change region still reports every one of those moves — dated. The
       reading is real; it is simply not about today, and that distinction is
       this region's whole job. */
    const byName = Object.fromEntries(stale.asOf);
    eq(byName.ORCL, "this session", "the one name scored in the newest session says so");
    ok(/2026-08-24 · 1 session back/.test(byName.CAT || ""),
       `and the rest are dated rather than dropped (CAT: ${byName.CAT})`);

    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  /* ---------- the fourth change sentence, and the missing layer --- */
  {
    /* FOUR STATUSES, FOUR SENTENCES was the claim; three of them had a
       fixture. "single-session" is the archive on its first day: one column,
       nothing to compare it against, and a page that worded it like "cold"
       would tell a reader the pool held nothing comparable when the truth is
       that there is only one session to compare. */
    await post("scoretrack", scoretrack([{
      d: SESSION, source: "scores",
      rows: [...bullRows, ...bearRows].map((r) => ({ t: r.t, s: r.s })),
    }]));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const one = await page.evaluate(() => {
      const p = document.querySelector("#ccChg [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    eq(one.kind, "unavailable",
       "an archive one session long cannot report change, and that is not a quiet market");
    ok(/holds a single session/.test(one.text) && new RegExp(SESSION).test(one.text),
       `it says so and names the session (${one.text})`);
    ok(/once a second session is archived/.test(one.text),
       `and what would make it answerable (${one.text})`);
    ok(!/held its score/.test(one.text) && !/No name in the pool/.test(one.text),
       "in words that are neither of the other two absences");

    /* AND THE PAYLOAD THAT PREDATES THE LAYER ENTIRELY: readable, populated,
       and carrying no d1 and no change block. This is the branch that
       refuses to fall back to subtracting two scores in the browser — the
       arithmetic this region was rebuilt to delete — because a difference
       with no session span attached is not a reading. */
    await post("scoretrack", {
      v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
      windowSessions: 2, deadBand: 20,
      sessions: [{ d: "2026-08-21", source: "scores", names: 2, preEpoch: false },
                 { d: SESSION, source: "scores", names: 2, preEpoch: false }],
      names: [{ t: "ORCL", s: [80, 88], n: 2 }, { t: "PFE", s: [-60, -91], n: 2 }],
    });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const old = await page.evaluate(() => {
      const p = document.querySelector("#ccChg [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim(),
               rows: document.querySelectorAll("#ccChg tbody tr").length };
    });
    eq(old.kind, "unavailable",
       "a track published before the change layer is a missing field, not a still market");
    eq(old.rows, 0, "and nothing is tabulated from it");
    ok(/no name carries a d1 move/.test(old.text),
       `it names the field that is missing (${old.text})`);
    ok(/will not subtract two scores itself/.test(old.text),
       `and refuses the arithmetic that has no span attached (${old.text})`);
    /* The strips still draw from the same series: the SERIES is published,
       only the derived layer is not, and the two are different absences. */
    ok(await page.locator(".cc-bull tbody .cc-trk svg").count() > 0,
       "while the series it does carry is still drawn");

    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  /* ---------- the count with no rows behind it -------------------- */
  {
    /* THE FOURTH WAY THIS REGION CAN HAVE NOTHING TO TABULATE, and the one
       that must not be worded as a quiet market: the pool moved, the change
       block counts it, and the payload's row ceiling shed every name that
       did. Saying "nothing moved" here would contradict the sentence printed
       directly above it.

       Hand-written rather than built by the shaper, because the shaper caps
       at 500 names and this state needs a shed that took every mover — a
       payload shape the wire can carry and this fixture cannot otherwise
       reach. */
    await post("scoretrack", {
      v: 2, status: "ok", sessionDate: SESSION, generatedAt: new Date().toISOString(),
      windowSessions: 2, deadBand: 20, namesShed: 40, shedBy: "names", namesSeen: 41,
      sessions: [{ d: "2026-08-21", source: "scores", names: 41, preEpoch: false },
                 { d: SESSION, source: "scores", names: 41, preEpoch: false }],
      /* One surviving row, and it has no prior observation — so it carries no
         d1 and there is nothing for the table to draw. */
      names: [{ t: "KLA", s: [null, 41], n: 1, last: 41, lastAt: 1, d1: null, run: 1 }],
      change: {
        session: SESSION, prior: "2026-08-21", comparable: 40, consecutive: 38,
        moved: 8, held: 32, current: 41, entered: 1, left: 0, band: 20,
        crossings: { cleared: 2, faded: 1, flipped: 0 }, status: "ok",
      },
    });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg [data-empty]", { timeout: 15000 });
    const shed = await page.evaluate(() => {
      const p = document.querySelector("#ccChg [data-empty]");
      return { kind: p.dataset.empty, text: p.textContent.trim() };
    });
    eq(shed.kind, "unavailable",
       "a session whose movers were all shed is a payload limit, not a still market");
    ok(/8 of 40 names/.test(shed.text),
       `the count is still stated, because it is still true (${shed.text})`);
    ok(/row ceiling shed them/.test(shed.text),
       `and says which ceiling took the rows (${shed.text})`);
    ok(/no rows behind it/.test(shed.text),
       `and that the list below is not the answer to the count above (${shed.text})`);
    ok(!/held its score/.test(shed.text),
       "in words that are not the every-name-compared sentence");
    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  /* ---------- a comparison across the selection epoch ------------- */
  {
    /* THE OTHER SPARSE-COLUMN CAVEAT, which had a renderer branch and no
       fixture that could reach it: the suite's epoch sat after every session
       in the window, so `preEpoch` was true on both ends of every comparison
       and the marking could never fire. Scores either side of the epoch come
       from different pools under different selection rules, which is two
       experiments wearing one line. */
    await post("scoretrack", { ...scoretrack(TRACK_DAYS),
      ...buildScoreTrack(TRACK_DAYS, { deadBand: 20, epoch: "2026-08-20" }) });
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#ccChg tbody tr", { timeout: 15000 });
    const spans = await page.evaluate(() => Object.fromEntries(Array.from(
      document.querySelectorAll("#ccChg tbody tr"),
      (tr) => [tr.children[1].querySelector(".cc-open, .cc-flat").textContent.trim(),
               { text: tr.children[3].textContent.trim(),
                 title: (tr.children[3].querySelector("span[title]") || {}).title || "" }])));
    ok(/across the epoch/.test(spans.MU?.text || ""),
       `a comparison straddling the epoch is marked (${spans.MU?.text})`);
    ok(/different pools/.test(spans.MU?.title || ""),
       `carrying the payload's own note rather than a caption written here (${spans.MU?.title})`);
    ok(!/across the epoch/.test(spans.ORCL?.text || ""),
       `and one entirely on this side of it is not (${spans.ORCL?.text})`);
    await post("scoretrack", scoretrack(TRACK_DAYS));
  }

  /* ---------- the staleness guard -------------------------------- */
  {
    /* THIS WAS THE ONLY FLOWS ROUTE WITHOUT ONE, and it is the route the
       section opens on. loadBoard read r.json() and dropped the
       X-Payload-Updated header the Worker stamps on every payload, so during
       a pipeline outage /flows/long/ warned and /flows/ rendered Tuesday's
       board on Friday with a "Session" tile naming a date and no warning
       anywhere on the page.

       TWO INDEPENDENT FAILURES. A dead pipeline has an old WRITE time and a
       current session date; a frozen upstream has a fresh write time and an
       old session. They are served here as two separate fixtures because a
       guard that only ever reads one of the two would pass on the other. */
    const today = new Date().toISOString().slice(0, 10);
    const serve = async (sessionDate, updatedAt) => {
      for (const [side, rows] of [["long", bullRows], ["short", bearRows]]) {
        await page.route("**/api/flows/board?side=" + side, (route) => route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json", "X-Payload-Updated": String(updatedAt) },
          body: JSON.stringify(board(side, rows, sessionDate, { deep: 4 })),
        }));
      }
    };
    const stop = async () => {
      for (const side of ["long", "short"]) {
        await page.unroute("**/api/flows/board?side=" + side);
      }
    };
    const read = () => page.evaluate(() => ({
      hidden: document.getElementById("flowsStale").hidden,
      text: document.getElementById("flowsStale").textContent.trim(),
      body: document.body.classList.contains("is-stale"),
    }));

    // A session written minutes ago, describing today. Nothing to warn about.
    await serve(today, Date.now() - 5 * 60 * 1000);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".cc-bull tbody tr", { timeout: 15000 });
    let s = await read();
    eq(s.hidden, true, "a fresh session raises no staleness warning");
    eq(s.body, false, "and leaves the document unmarked");
    eq(s.text, "", "with no sentence left behind in the slot");
    await stop();

    /* ---- the two ways this function used to CLAIM freshness it had not
       measured, asked of the function itself rather than through a page.

       Both were "unknown" wearing "fresh". A `fresh` verdict marks nothing and
       says nothing, so on either of these the reader saw a clean page — which
       is the same pixels a genuinely current session produces, and the one
       outcome a staleness guard exists to prevent. */
    const verdicts = await page.evaluate(() => {
      const S = window.FlowsUI.staleness;
      const now = Date.parse("2026-09-04T12:00:00Z");
      return {
        /* A stamp of 0 is the epoch, which is 56 years stale — so it is
           refused as a stamp. Refusing it must not then be read as passing. */
        zeroStamp: S({ __updatedAt: 0 }, now).kind,
        negStamp: S({ __updatedAt: -1 }, now).kind,
        /* Date.parse("2026-09" + "T21:00:00Z") is FINITE in V8. A number that
           parses is not a date that was measured. */
        truncated: S({ sessionDate: "2026-09" }, now).kind,
        prose: S({ sessionDate: "Thursday" }, now).kind,
        /* And the readable ones still answer, or the fix would have bought
           its honesty by refusing to measure anything. */
        realFresh: S({ __updatedAt: now - 60000, sessionDate: "2026-09-04" }, now).kind,
        realStaleSession: S({ __updatedAt: now - 60000, sessionDate: "2026-08-01" }, now).kind,
        nothing: S({}, now).kind,
      };
    });
    eq(verdicts.zeroStamp, "unknown",
       "a write stamp of 0 is an absent stamp, and an absent stamp is not a passed test");
    eq(verdicts.negStamp, "unknown", "and so is a negative one");
    eq(verdicts.truncated, "unknown",
       "a session date that is not a calendar day is not a date — Date.parse returning a " +
       "finite number for \"2026-09\" is exactly why the shape is checked before the parse");
    eq(verdicts.prose, "unknown", "and neither is prose");
    eq(verdicts.realFresh, "fresh",
       "while a payload carrying two readable dates that both pass still reports fresh");
    eq(verdicts.realStaleSession, "session",
       "and one whose session is five weeks old still raises the session warning");
    eq(verdicts.nothing, "unknown", "and a payload with nothing datable claims nothing");

    /* THE WRITE-TIME BRANCH, REACHABLE ONLY BY READING THE HEADER. The
       session date is today's, so a page that checked only the payload body
       would see nothing wrong here. */
    await serve(today, Date.now() - 5 * 24 * 60 * 60 * 1000);
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsStale:not([hidden])", { timeout: 15000 });
    s = await read();
    eq(s.body, true, "a payload last written five days ago marks the document stale");
    ok(s.text.length > 20 && /written/.test(s.text),
       `and says the pipeline has not published, not that the market was quiet (${s.text})`);
    ok(!/different sessions/.test(s.text),
       "in words that are not the mismatched-halves sentence");
    await stop();

    /* THE SESSION-AGE BRANCH, off the real fixture: the write is minutes old
       and the session it describes is the fixed 2026-08-24 of this file,
       which every run after 2026-08-28 is more than four days past. */
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsStale:not([hidden])", { timeout: 15000 });
    s = await read();
    eq(s.body, true, "and a session that stopped advancing marks it too");
    ok(new RegExp(SESSION).test(s.text),
       `naming the session the numbers actually describe (${s.text})`);
  }

  /* ---------- the freshness check that could not run -------------- */
  {
    /* THE GUARD'S OWN ABSENCE IS A SENTENCE, NOT A SILENCE. This page used
       to carry a private copy of the two staleness tests with its own two
       constants and its own wording, behind a comment saying the shared one
       did not exist yet — so one outage was worded two ways on two routes of
       one product, and the thresholds could be tuned in one place and not
       the other. The copy is gone and flows-ui.js's `staleness` is the only
       test. What must NOT follow is a page that silently stops checking when
       an older module is served from a cache: a freshness check that quietly
       stops running looks exactly like a pipeline that is fine.

       Served by intercepting the library assignment in a page of its own, so
       the module really is missing the function rather than the test merely
       asserting that it would be handled. */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const shadow = await ctx.newPage();
    shadow.on("pageerror", (e) => errors.push("shadow: " + e.message));
    await shadow.addInitScript(() => {
      let held;
      Object.defineProperty(window, "FlowsUI", {
        configurable: true,
        get: () => held,
        set: (lib) => {
          const copy = Object.assign({}, lib);
          delete copy.staleness;
          held = Object.freeze(copy);
        },
      });
    });
    await shadow.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    /* Its own context, so its own cookie jar: the gate is the product. */
    await shadow.fill("#u", FLOWS_TEST_USER);
    await shadow.fill("#p", FLOWS_PASSWORD);
    await Promise.all([
      shadow.waitForNavigation({ waitUntil: "domcontentloaded" }),
      shadow.click(".flows-submit"),
    ]);
    await shadow.waitForSelector("#flowsStale:not([hidden])", { timeout: 15000 });
    const said = await shadow.evaluate(() => ({
      has: typeof window.FlowsUI.staleness,
      text: document.getElementById("flowsStale").textContent.trim(),
      stale: document.body.classList.contains("is-stale"),
      rows: document.querySelectorAll(".cc-bull tbody tr").length,
    }));
    eq(said.has, "undefined", "the shared check really is absent from this page's module");
    ok(/could not run/.test(said.text),
       `and the page says the check could not run (${said.text})`);
    ok(/flows-ui/.test(said.text), "naming the module that is too old to carry it");
    ok(!/more than four days old/.test(said.text) && !/last written/.test(said.text),
       "and does not answer the question anyway out of a second copy of the arithmetic");
    eq(said.stale, true, "the document is marked, because nothing here is confirmed to be today's");
    ok(said.rows > 0, "while every reading the page DOES have is still drawn");
    await ctx.close();
  }

  eq(errors.length, 0, `no uncaught page error across the whole session (${errors[0] || ""})`);

  console.log(`✓ flows-overview: ${checks} assertions — a page that leads on CHANGE: ` +
    `crossings of the dead band ranked above magnitude, every delta printed with the ` +
    `number of sessions it spans, readings that are not about today demoted and dated, ` +
    `and the whole thing stated against the published denominator. Plus both sides whole ` +
    `in the payload's own rank order, a score strip per row on one shared domain, earnings ` +
    `joined onto the ranked names in the events payload's own unit and the score joined ` +
    `back onto the calendar, both weightings of the tilt rather than a silent choice ` +
    `between them, four silences in four sentences, a spine at one viewBox unit per CSS ` +
    `pixel that repaints on resize and trails only the moves the two payloads agree are ` +
    `this session's, a staleness guard that is flows-ui.js's one test rather than a second ` +
    `copy of it, and two halves that refuse to be presented as one session when they are not`);
} finally {
  await browser.close();
  await server.stop();
}
