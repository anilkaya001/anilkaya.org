/* =============================================================
   flows-overview-contract.mjs — the Session Overview, in a browser.

   THIS IS THE PAGE THE SECTION OPENS ON and until now the only thing
   asserted about it was that its <script> tag is in the HTML. Everything
   it actually does — fetching both sides, ranking each by distance from
   neutral, drawing a fixed axis with the dead band on it, and refusing to
   present two different sessions as one — was untested.

   THE FIXTURE IS A QUIET SESSION, which is the ordinary one. On the real
   board this was built against, 17 of 24 scored names landed inside the
   ±20 band and were published on neither side. A reader who cannot see
   that band reads a three-name page as a broken page, so the band is
   drawn — and here, measured.

   THE TWO SIDES ARE TWO FETCHES, which is the defect this file exists
   for: a pipeline that failed between them puts yesterday's bulls beside
   today's bears, and both halves render perfectly. Nothing in the payload
   forces them to agree, so the page has to check.
   ============================================================= */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startWorker, FLOWS_PASSWORD, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

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
   in the same direction: the bear pole wants the most negative first, so a
   descending sort — the obvious one, and the one that works on the bull
   side — puts the LEAST bearish name at the top of the bearish pole. That
   is the mistake this fixture is built to catch, and a fixture already in
   rank order could not catch it.

   BOTH SIDES ARE LONGER THAN A POLE. Each pole shows three; a first version
   of this file gave each side exactly three, which made "the spine marks
   every published name, not just the three per pole" an assertion that a
   spine truncated to three would also pass. Five and four make the two
   counts disagree, which is the only way that assertion means anything. */
const bullRows = [
  { t: "KLA", r: 3, s: 41, cnv: 62, px: 812.40, chg: 0.0071,
    fam: { F: 44, P: 12, D: 30, V: 51, O: 40 } },
  { t: "ORCL", r: 1, s: 88, cnv: 81, px: 244.10, chg: 0.0192,
    fam: { F: 71, P: 90, D: 22, V: 63, O: 58 } },
  { t: "ADBE", r: 4, s: 33, cnv: 55, px: 372.66, chg: 0.0043,
    fam: { F: 29, P: 18, D: 21, V: 40, O: 33 } },
  { t: "DE", r: 2, s: 57, cnv: 70, px: 498.02, chg: -0.0035,
    fam: { F: 33, P: 20, D: 61, V: 44, O: 35 } },
  { t: "CAT", r: 5, s: 26, cnv: 51, px: 415.88, chg: 0.0012,
    fam: { F: 24, P: 9, D: 14, V: 36, O: 28 } },
];
const bearRows = [
  { t: "MU", r: 3, s: -35, cnv: 58, px: 118.77, chg: -0.0104,
    fam: { F: -40, P: -12, D: -25, V: 55, O: 41 } },
  { t: "PFE", r: 1, s: -91, cnv: 84, px: 24.33, chg: -0.0221,
    fam: { F: -55, P: -94, D: -30, V: 39, O: 62 } },
  { t: "XOM", r: 4, s: -28, cnv: 49, px: 112.04, chg: -0.0017,
    fam: { F: -26, P: -11, D: -19, V: 33, O: 24 } },
  { t: "BAC", r: 2, s: -62, cnv: 66, px: 47.15, chg: 0.0008,
    fam: { F: -70, P: -31, D: -48, V: 48, O: 29 } },
];
const SCORES = new Map([...bullRows, ...bearRows].map((r) => [r.t, r.s]));

const board = (side, rows, sessionDate = SESSION) => ({
  side, rows, sessionDate, status: "ok", v: 2,
  generatedAt: new Date().toISOString(),
  deadBand: 20, scored: 24, neutral: 15, universe: 264, enriched: 60,
});

await post("board:long", board("long", bullRows));
await post("board:short", board("short", bearRows));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
  await page.fill("#u", FLOWS_TEST_USER);
  await page.fill("#p", FLOWS_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.click(".flows-submit"),
  ]);
  await page.waitForSelector(".ptile", { timeout: 15000 });

  /* ---------- both tails, at once -------------------------------- */
  {
    /* The board used to hide half the session behind a LONG/SHORT toggle.
       The whole reason this page exists is that a session leans in two
       directions and a reader comparing them should not have to remember
       the other one. */
    const bull = (await page.locator("#bullDeck .ptile-sym").allTextContents()).map((s) => s.trim());
    const bear = (await page.locator("#bearDeck .ptile-sym").allTextContents()).map((s) => s.trim());
    ok(bull.length > 0 && bear.length > 0, "both poles are populated from one page load");

    assert.deepEqual(bull, ["ORCL", "DE", "KLA"],
      "the bullish pole is ranked by how far it leans, not by arrival order"); checks++;
    /* THE ASYMMETRY. A descending sort gets the bull side right and the bear
       side exactly backwards: -35 > -91, so MU would head a pole labelled
       "most bearish-leaning" while being the least bearish name on it. */
    assert.deepEqual(bear, ["PFE", "BAC", "MU"],
      "and the bearish pole leads with the most bearish name, not the largest number"); checks++;
  }

  /* ---------- the lean line: why this name, not merely how much -- */
  {
    /* A score with no account of itself is a number. The tile names the
       signed family that put the name at the pole — and V and O are
       deliberately not candidates: they are unsigned gauges, and a gauge
       cannot lead a direction. ORCL's largest signed family is P at 90;
       its largest family of any kind is P too, but PFE's are P -94 against
       an O of 62, so a version that ranked on raw magnitude across all five
       would still agree. MU is the discriminating row: F -40 is its
       strongest signed family while V 55 is larger in magnitude. */
    const mu = await page.locator("#bearDeck .ptile", { hasText: "MU" }).locator(".ptile-lean").textContent();
    ok(/Flow leads/.test(mu), `an unsigned gauge never leads a direction (${mu})`);
    ok(/−?40/.test(mu), `and the lean line carries the value (${mu})`);

    const orcl = await page.locator("#bullDeck .ptile", { hasText: "ORCL" }).locator(".ptile-lean").textContent();
    ok(/Positioning leads/.test(orcl), `ORCL is at the pole on positioning (${orcl})`);
  }

  /* ---------- the dead band is DRAWN, not inferred --------------- */
  {
    /* 18 of 24 names scored inside ±20 and are published on neither side.
       That is why this page is short, and a reader who cannot see it reads
       a six-name page as a broken one. */
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
      };
    });
    ok(spine, "the spine is drawn");
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
    assert.deepEqual(spine.ticks, ["−100", "−50", "0", "+50", "+100"],
      "the axis is labelled -100..+100"); checks++;

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

    /* EVERY PUBLISHED NAME HAS A MARK. The poles name three a side; the
       spine is where the rest of the tail is visible at all, so a spine
       truncated to the pole count would silently shorten the session. Five
       bulls and four bears against three per pole is what makes this
       assertion able to fail. */
    eq(spine.dots.length, 9,
       "the spine marks every published name, not just the three per pole");
    const bulls = spine.dots.filter((d) => d.bull).map((d) => d.x);
    const bears = spine.dots.filter((d) => !d.bull).map((d) => d.x);
    eq(bulls.length, 5, "all five bullish names are on the axis");
    eq(bears.length, 4, "and all four bearish ones");
    ok(Math.max(...bears) < Math.min(...bulls),
       "every bearish mark sits left of every bullish one");

    /* A MARK WITH NO NAME IS A DOT. Most of these belong to names that
       appear nowhere else on the page, so each carries its own accessible
       name rather than being an anonymous smudge on an axis. */
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
    eq(counts.long?.hidden, false, "and reveals them once there is a real number");

    const bullAll = await page.locator("#bullAll").textContent();
    ok(/All 5 bullish/.test(bullAll),
       `the pole's link says how many the pole is NOT showing (${bullAll})`);
  }

  /* ---------- a name is one click from its card ------------------ */
  {
    const href = await page.locator("#bullDeck .ptile").first().getAttribute("href");
    eq(href, "?t=ORCL", "each tile deep-links to the name's card");
  }

  /* ---------- nothing overflows a phone -------------------------- */
  {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1);
    eq(overflow, false, "the overview overflows nothing at 390px");
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
    await post("board:short", board("short", bearRows, "2026-08-21"));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsStale:not([hidden])", { timeout: 15000 });
    const warn = await page.locator("#flowsStale").textContent();
    ok(/different sessions/.test(warn), `mismatched halves are called out (${warn})`);
    ok(/2026-08-24/.test(warn) && /2026-08-21/.test(warn),
       `and both dates are named, so the reader knows which half is stale (${warn})`);
    /* The names still render: a stale half is still a reading, and blanking
       the page would throw away the half that IS current. */
    ok(await page.locator("#bullDeck .ptile").count() > 0,
       "and the current half is still shown rather than blanked");
  }

  /* ---------- an empty side is a reading, not a failure ---------- */
  {
    await post("board:short", board("short", []));
    await page.goto(url("/flows/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".pole-empty", { timeout: 15000 });
    const empty = await page.locator("#bearDeck .pole-empty").textContent();
    ok(/No name leaned bearish/.test(empty),
       `an empty pole says what happened, not "error" (${empty})`);
    eq(await page.locator("#bullDeck .ptile").count(), 3,
       "and the other side is unaffected");
    const spineDots = await page.locator("#spinePlot .sp-dot").count();
    eq(spineDots, 5, "the spine draws what there is");
  }

  eq(errors.length, 0, `no uncaught page error across the whole session (${errors[0] || ""})`);

  console.log(`✓ flows-overview: ${checks} assertions — both tails at once, poles ranked by ` +
    `distance from neutral, a fixed axis with the dead band hatched onto it, live rail counts, ` +
    `and two halves that refuse to be presented as one session when they are not`);
} finally {
  await browser.close();
  await server.stop();
}
