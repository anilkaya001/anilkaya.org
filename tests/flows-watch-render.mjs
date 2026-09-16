import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const TOKEN = "watch-token-aaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const put = (key, bodyObj) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(bodyObj),
});

const SCORE_SCALE = Math.atanh(0.80) / 2.0;
const scoreOf = (resid) => 100 * Math.tanh(resid / SCORE_SCALE);
const BAND = 1;
const distOf = (resid) => Math.max(0, BAND - Math.abs(scoreOf(resid)));

const R = {
  CLOSE: 0.0040,
  WIDEN: 0.0040,
  SLOW: 0.0045,
  NOQV: 0.0030,
  FADED: 0.0020,
  BARE: 0.0010,
};

const D = { CLOSE: +0.0008, WIDEN: -0.0008, SLOW: +0.0005, FADED: -0.0090 };

const watchRow = (t, resid) => ({
  t, px: 100, s: Math.round(scoreOf(resid)), resid: Number(resid.toFixed(4)),
  cnv: 50, surpriseTilt: 0.1, relVolume: 1.2, putCallRatio: 0.9, w52: 0.5,
});

const WATCH = {
  v: 1, generatedAt: new Date().toISOString(), sessionDate: "2026-08-24",
  status: "ok", deadBand: BAND, scored: 120, neutral: 6,
  rows: [

    watchRow("BARE", R.BARE),
    watchRow("WIDEN", R.WIDEN),
    watchRow("NOQV", R.NOQV),
    watchRow("CLOSE", R.CLOSE),
    watchRow("FADED", R.FADED),
    watchRow("SLOW", R.SLOW),
  ],
};

const trackName = (t, resid, delta, gap, cross) => ({
  t,
  s: [Math.round(scoreOf(resid - delta)), Math.round(scoreOf(resid))],
  n: 2, last: Math.round(scoreOf(resid)), lastAt: 1, run: 1,
  ext: { hi: 1, hiAt: 1, lo: -1, loAt: 0 },
  d1: cross
    ? { v: 1, gap, qv: Math.round(delta * 1e4), cross }
    : { v: 1, gap, qv: Math.round(delta * 1e4) },
});

const TRACK = {
  v: 1, generatedAt: new Date().toISOString(), sessionDate: "2026-08-24",
  windowSessions: 42, deadBand: BAND, epoch: null,
  sessions: [{ d: "2026-08-21", source: "scores", names: 6, preEpoch: false },
             { d: "2026-08-24", source: "scores", names: 6, preEpoch: false }],
  namesSeen: 5, namesShed: 0, shedBy: null, namesBytes: 1000,
  status: "ok",
  change: { session: "2026-08-24", prior: "2026-08-21", comparable: 5, consecutive: 4,
            moved: 5, held: 0, current: 6, entered: 1, left: 0, band: BAND,
            crossings: { cleared: 0, faded: 1, flipped: 0 }, status: "ok" },
  names: [
    trackName("CLOSE", R.CLOSE, D.CLOSE, 1),
    trackName("WIDEN", R.WIDEN, D.WIDEN, 1),
    trackName("SLOW", R.SLOW, D.SLOW, 5),
    trackName("FADED", R.FADED, D.FADED, 1, "faded"),

    { t: "NOQV", s: [3, 0], n: 2, last: 0, lastAt: 1, run: 0,
      ext: { hi: 3, hiAt: 0, lo: 0, loAt: 1 }, d1: { v: -3, gap: 1 } },

  ],
  notes: { change: "x", crossing: "x", saturation: "x", run: "x", gaps: "x" },
};

const browser = await chromium.launch();
const open = async (viewport = { width: 1400, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  await page.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
  return page;
};

try {

  await put("board:watch", WATCH);
  await put("scoretrack", TRACK);

  const page = await open();
  await page.goto(url("/flows/watch/"), { waitUntil: "networkidle" });
  await page.waitForSelector("#watchBody tr");

  const order = await page.$$eval("#watchBody tr th a", (a) => a.map((x) => x.textContent.trim()));
  eq(order.length, 6, "every fixture row rendered");

  const readerHrefs = await page.$$eval("#watchBody tr th a",
    (as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href")]));
  for (const [name, href] of readerHrefs) {
    eq(href, "/flows/ticker/?t=" + name + "&s=signal&from=watch",
       `${name}: the watched name links to its own reader (${href})`);
  }

  eq(distOf(R.CLOSE).toFixed(6), distOf(R.WIDEN).toFixed(6),
     "the fixture's two headline names are exactly the same distance from the edge, so " +
     "distance alone cannot order them and any ordering that appears is doing something else");
  ok(order.indexOf("CLOSE") < order.indexOf("WIDEN"),
     "and the approaching one is ranked above the retreating one — a name walking toward " +
     "the edge is the more urgent row, which is the whole of this page's former blind spot. " +
     "The fixture listed WIDEN first, so this cannot pass on input order");

  const closeCell = await page.$eval("#watchBody tr:has(th a:text-is('CLOSE')) .c-toband",
    (el) => ({ text: el.textContent, html: el.innerHTML, title: (el.querySelector(".c-approach") || {}).title || "" }));
  ok(/▸/.test(closeCell.text),
     "an approaching row carries a right-pointing marker — a glyph, so the direction " +
     "survives greyscale and a monochrome printout");
  ok(/\+0\.\d\d/.test(closeCell.text),
     "beside a signed number, which is the SECOND channel: the sign is never carried by " +
     "hue alone, and here it is not carried by the glyph alone either");

  const widenCell = await page.$eval("#watchBody tr:has(th a:text-is('WIDEN')) .c-toband",
    (el) => el.textContent);
  ok(/◂/.test(widenCell) && /−|-/.test(widenCell),
     "and a retreating row points the other way and carries a minus — the two rows differ " +
     "in glyph and in sign, not merely in colour");

  ok(/1 session/.test(closeCell.title),
     "the overnight row names the single session its rate was measured across");
  const slowTitle = await page.$eval("#watchBody tr:has(th a:text-is('SLOW')) .c-approach",
    (el) => el.title);
  ok(/5 sessions/.test(slowTitle) && /divided by 5/.test(slowTitle),
     "and a rate measured across five sessions says so AND says it was divided by five — " +
     "the same number without its denominator is the exact defect the change layer replaced");

  ok(/≈/.test(closeCell.text),
     "the overnight approach carries a projection, marked as approximate");
  const slowText = await page.$eval("#watchBody tr:has(th a:text-is('SLOW')) .c-toband",
    (el) => el.textContent);
  ok(!/≈/.test(slowText),
     "but a rate averaged over FIVE sessions gets no projection at all — it says nothing " +
     "about tonight, and dividing it by five does not make it a nightly rate. It renders " +
     "as no projection rather than as a large one, because a large number in that position " +
     "would be read as a measurement");
  ok(/[+]0\.\d\d/.test(slowText),
     "while the rate itself is still shown: the observation is real, only the extrapolation " +
     "from it is refused");
  ok(!/▸|◂/.test(await page.$eval("#watchBody tr:has(th a:text-is('WIDEN')) .c-toband",
     (el) => el.textContent.replace(/◂/, ""))),
     "and the retreating row carries exactly one direction marker, not two");

  const noqvText = await page.$eval("#watchBody tr:has(th a:text-is('NOQV')) .c-toband",
    (el) => el.textContent);
  ok(!/▸|◂|≈/.test(noqvText),
     "a name whose earlier observation carried no residual gets NO approach, no direction " +
     "and no projection — a residual differenced against an absent one is a different " +
     "quantity, not a smaller number, and this row's change field exists but its qv does not");
  ok(/^\s*\d/.test(noqvText.trim()) || noqvText.trim().length > 0,
     "though its distance still renders: the row is not blanked for want of a second reading");

  const bareText = await page.$eval("#watchBody tr:has(th a:text-is('BARE')) .c-toband",
    (el) => el.textContent);
  ok(!/▸|◂|≈/.test(bareText),
     "and a name absent from the trace entirely renders its distance and nothing more");

  const fadedMark = await page.$$eval("#watchBody .c-faded", (els) => els.length);
  eq(fadedMark, 1, "exactly the one name that came back through the edge is marked");
  const fadedRow = await page.$eval("#watchBody tr:has(.c-faded) th a", (el) => el.textContent.trim());
  eq(fadedRow, "FADED",
     "and it is the right one — this row is here BECAUSE it fell in, which a reader " +
     "scanning for what is about to leave should not have to work out");

  const status = await page.$eval("#watchStatus", (el) => el.textContent);
  ok(!/within three/.test(status),
     "the status line no longer claims a threshold of three. That was three SCORE units " +
     "against a +-20 band; the mark it describes has been edge-relative for some time, and " +
     "against a band of 1 the old sentence claimed a distance arithmetically impossible on " +
     "the numbers printed beside it");
  ok(/fifth of the band/.test(status) || !/within/.test(status),
     "and where it states the threshold at all it states the one the code uses");
  ok(/of \d+ measurable/.test(status),
     "the count of approaching names carries its denominator: 'six approaching' is otherwise " +
     "indistinguishable from 'six approaching and seventy-four we could not measure'");
  ok(/came back through the edge/.test(status),
     "and the faded crossing is counted in words as well as marked on its row");
  await page.close();

  {

    const p2 = await open();
    await p2.route("**/api/flows/scoretrack", (route) => route.abort());
    await p2.goto(url("/flows/watch/"), { waitUntil: "networkidle" });
    await p2.waitForSelector("#watchBody tr");

    const rows = await p2.$$eval("#watchBody tr th a", (a) => a.map((x) => x.textContent.trim()));
    eq(rows.length, 6,
       "every row still renders — a failed second read costs this page its approach column " +
       "and nothing else");
    const marks = await p2.$$eval("#watchBody .c-approach", (e) => e.length);
    eq(marks, 0, "with no direction of travel shown anywhere");
    const s2 = await p2.$eval("#watchStatus", (el) => el.textContent);
    ok(/did not load/.test(s2),
       "and the page SAYS the trace did not load rather than letting an absent measurement " +
       "read as a measured stillness");
    ok(!/measurable/.test(s2),
       "so it claims no denominator it does not have");

    const feed = WATCH.rows.map((r) => r.t);
    const byDistance = feed.slice().sort((a, b) => distOf(R[a]) - distOf(R[b]));
    assert.deepEqual(rows, byDistance,
      "and the ordering falls back to pure distance — the ordering that shipped before this " +
      "column existed — rather than to nothing at all"); checks++;

    ok(rows.indexOf("WIDEN") < rows.indexOf("CLOSE"),
       "with the two equidistant names left in the order they arrived — the distance " +
       "comparator returns zero for that pair, so the retreating name sits above the " +
       "approaching one. Section 1 asserts the reverse on these same two rows with the " +
       "trace loaded, which is the whole value of the second read stated as a pair of " +
       "assertions rather than as a claim");
    await p2.close();
  }

  {
    await put("scoretrack", { ...TRACK, names: [], change: { ...TRACK.change, comparable: 0, status: "cold" } });
    const p3 = await open();
    await p3.goto(url("/flows/watch/"), { waitUntil: "networkidle" });
    await p3.waitForSelector("#watchBody tr");
    const s3 = await p3.$eval("#watchStatus", (el) => el.textContent);
    ok(/prior scored session to measure against/.test(s3),
       "a trace that LOADED and held nothing comparable is a measured emptiness and gets its " +
       "own sentence — on a young archive that is the ordinary state, and it is a different " +
       "fact from the trace having failed to load");
    ok(!/did not load/.test(s3), "and it does not claim a failure that did not happen");
    await p3.close();
    await put("scoretrack", TRACK);
  }

  {
    const p4 = await open({ width: 320, height: 900 });
    await p4.goto(url("/flows/watch/"), { waitUntil: "networkidle" });
    await p4.waitForSelector("#watchBody tr");
    const over = await p4.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1,
       `the page overflows nothing at 320px (over by ${over}px) — the second line inside the ` +
       "distance cell is why this reading was folded into an existing column rather than " +
       "given two new ones");
    await p4.close();
  }

  {
    const p5 = await open();
    await p5.goto(url("/flows/watch/"), { waitUntil: "networkidle" });
    await p5.waitForSelector("#watchBody tr");
    const heads = await p5.$$eval("#watchTableWrap thead th", (e) => e.length);
    const cells = await p5.$$eval("#watchBody tr:first-child > *", (e) => e.length);
    eq(cells, heads,
       `every row has exactly as many cells as the head has columns (${cells} of ${heads}) — ` +
       "a renderer that appends a cell to a head emitted from the page template produces a " +
       "table whose every heading is off by one from the row beneath it, silently, with " +
       "nothing overflowing to give it away");
    await p5.close();
  }
} finally {
  await browser.close();
  await server.stop();
}

console.log(`✓ flows-watch-render: ${checks} assertions — two names at an identical distance ` +
  `ordered by which way they are walking, a direction carried by a glyph and a sign rather ` +
  `than by hue, a rate that never appears without the sessions it was divided by, a ` +
  `projection withheld on a five-session average and on an absent residual alike, a crossing ` +
  `that came back through the edge marked and counted, a trace failure that says so instead ` +
  `of reading as stillness, and a row that still has exactly as many cells as the head`);
