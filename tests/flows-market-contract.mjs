/* =============================================================
   flows-market-contract.mjs — the market level.

   THE PAGE EXISTS BECAUSE OF A STRUCTURAL BLIND SPOT, not a gap in
   coverage. Every score in Flows is a RESIDUAL: neutralize() divides
   sector and log-capitalisation out of the composite before the ranking
   is taken, which is exactly what makes the board a comparison between
   names. The cost is that a board reporting fifty bullish names cannot
   say whether the tape as a whole was bought — the level was removed on
   purpose, upstream of everything.

   TWO CLASSES OF DEFECT ARE ASSERTED HERE, and both render perfectly.

   THE PRESENCE RULE. moverRow gates net premium on `onWire(call) ||
   onWire(put)` and subtracts with a zero fallback. On a ranking of
   extremes that disjunction is survivable: a one-legged row's spurious
   near-zero lands in neither tail. On an AGGREGATE it publishes a
   measured zero — a name counted as balanced when one side was never
   quoted. So the aggregate requires BOTH legs, counts the one-legged
   rows separately, and this file proves the distinction with a fixture
   that has the hole in it.

   THE SCALE. iv_rank arrives on 0..100 while screenerTilt().ivRank is a
   FRACTION, because the vendor's own schema misdeclares the field. This
   repository has already published "1352% of its year" once. The
   aggregate takes tilts rather than rows so there is exactly one scale.

   AND A THIRD, ADDED AFTER THIS FILE CERTIFIED IT FOR MONTHS. The sector
   panel drew `trix`, a 0..100 clamp score whose neutral point is 50, as
   though it carried a sign — it branched on `trix >= 0`, which is true of
   every value the publisher can emit, so every sector drew positive and a
   sector at −23.65 basis points printed "+26.4" in the positive tone. The
   fixture here made that invisible: it wrote `trix: 12.5` and `trix:
   -8.25`, two numbers the published relation cannot produce. A fixture that
   cannot contain the payload's own arithmetic proves only that the renderer
   agrees with the person who wrote both. The sector rows are now GENERATED
   from the published relation and the relation is asserted before any
   browser starts, so an impossible row can no longer be typed into this file.
   ============================================================= */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";
import { marketAggregate, MARKET_NOTES } from "../shared/flows-market.js";
/* The cadence the Worker's cron is configured for, imported from the module
   that owns it. Typing 15 into this file would recreate, on the test side,
   exactly the second copy the renderer just stopped keeping. */
import { REFRESH_CADENCE_MINUTES } from "../shared/flows-freshness.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

/* THE FOUR SILENCES, COLLECTED AS THE SCENARIOS MEET THEM. Each kind is
   recorded with the sentence it was printed under, and the tail of the file
   asserts that all four were seen and that no two share a sentence: a page
   that only ever emitted two of the four marks — which this one did, for
   months — passes every per-scenario assertion and is still collapsing
   silences. */
const seenSilences = new Map();
const sawSilence = (kind, text) => { if (kind) seenSilences.set(kind, text); };

/* ---------- the arithmetic, before any browser ------------------- */
{
  const row = (t, over) => Object.assign({
    ticker: t,
    net_call_premium: "1000", net_put_premium: "400",
    call_volume: "100", put_volume: "50",
    call_premium: "900", put_premium: "300",
    call_volume_ask_side: "60", call_volume_bid_side: "40",
    put_volume_ask_side: "20", put_volume_bid_side: "30",
    iv30d: "0.30",
  }, over);

  /* THE ONE-LEGGED ROW IS THE WHOLE ARGUMENT. It quotes a call leg of zero and
     no put leg. Under moverRow's rule it would contribute nu = 0 - 0 = 0 and be
     counted in `flat`: published as a name whose two sides were EQUAL, when one
     of them was never reported. */
  const rows = [
    row("A"),                                                   // nu = +600
    row("B", { net_call_premium: "100", net_put_premium: "900" }), // nu = -800
    row("C", { net_call_premium: "0", net_put_premium: undefined }), // one leg
    row("D", { net_call_premium: undefined, net_put_premium: undefined }), // neither
    row("E", { net_call_premium: "500", net_put_premium: "500" }),  // a REAL zero
  ];
  const tilts = new Map([["A", { ivRank: 0.2 }], ["B", { ivRank: 0.8 }]]);
  const m = marketAggregate(rows, tilts, { screened: 9 });

  eq(m.n, 5, "n is the eligible population handed in");
  eq(m.screened, 9, "and the screened count rides along, because 5 of 9 and 5 of 500 differ");

  eq(m.premium.priced, 3, "only rows quoting BOTH legs are priced");
  eq(m.premium.oneLegged, 1, "the one-legged row is counted, not folded in");
  eq(m.breadth.unpriced, 2, "and both it and the no-leg row are excluded from every total");
  eq(m.breadth.flat, 1,
     "`flat` is ONE — the row that genuinely quoted equal legs. The one-legged row is NOT " +
     "flat: a name whose put side was never quoted is not a name whose sides were equal");
  eq(m.premium.net, -200, "net premium sums only the priced rows: +600 − 800 + 0");
  eq(m.premium.netPositive, 600, "positives and negatives are reported apart");
  eq(m.premium.netNegative, 800, "so a near-zero net cannot hide two large opposing flows");
  eq(m.breadth.bull, 1, "one name net bought");
  eq(m.breadth.bear, 1, "one net sold");

  near(m.premium.tilt, -200 / 1400, 1e-4, "premium tilt is dollar-weighted");
  eq(m.breadth.tilt, 0, "breadth tilt is equal-weighted, and here the two DISAGREE");
  ok(m.premium.tilt !== m.breadth.tilt,
     "which is the reading the page exists to show: the same ratio under two weightings");

  /* JOINT PRESENCE. Summing put volume over the names that quoted put volume
     and dividing by call volume summed over a DIFFERENT set is not a ratio of
     anything — it moves when a name drops one leg. */
  const lopsided = [
    { ticker: "X", call_volume: "100", put_volume: "50" },
    { ticker: "Y", call_volume: "900" },
    { ticker: "Z", put_volume: "700" },
  ];
  const j = marketAggregate(lopsided, new Map());
  near(j.pcr.volume, 0.5, 1e-9,
       "the put/call ratio is a ratio of sums over ONE population — the name quoting only " +
       "calls and the name quoting only puts are both excluded, rather than inflating " +
       "one side of a fraction whose halves then describe different markets");
  eq(j.pcr.quotedVolume, 1, "and the population size is published, so the reader can judge it");

  /* IV RANK IS A FRACTION HERE AND 0..100 ON THE WIRE. */
  near(m.vol.ivRankMedian, 0.5, 1e-9, "the IV-rank median is a FRACTION in [0,1]");
  ok(m.vol.ivRankMedian <= 1,
     "never the raw 0..100 column — one quantity on two scales, a factor of a hundred apart, " +
     "is the defect that published '1352% of its year'");
  eq(m.vol.ivRankQuoted, 2, "over the names whose tilt carried one");

  /* A MEDIAN, NOT A MEAN. */
  const skew = marketAggregate(
    [row("P", { iv30d: "0.20" }), row("Q", { iv30d: "0.30" }), row("R", { iv30d: "9.00" })],
    new Map());
  near(skew.vol.iv30dMedian, 0.30, 1e-9,
       "the implied-vol level is a MEDIAN: one name at 900% would own a mean and the column " +
       "exists to say where the middle of the universe sits");

  /* CONCENTRATION. */
  const whale = marketAggregate([
    row("W", { net_call_premium: "1000000", net_put_premium: "0" }),
    row("a"), row("b"), row("c"), row("d"), row("e"), row("f"),
  ], new Map());
  ok(whale.premium.topShare > 0.9,
     `one dominant print drives topShare to ${whale.premium.topShare} — without it, ` +
     "'the universe bought calls' and 'one name bought calls' are the same sentence");

  /* NOTHING MEASURED IS NOT ZERO MEASURED. */
  const empty = marketAggregate([{ ticker: "N" }], new Map());
  eq(empty.premium.net, null, "a universe that quoted no premium publishes null, not 0");
  eq(empty.premium.tilt, null, "and no tilt");
  eq(empty.breadth.tilt, null, "and no breadth tilt");
  eq(empty.pcr.volume, null, "and no ratio");
  eq(empty.aggressor.callLift, null, "and no lift");
  eq(empty.vol.iv30dMedian, null, "and no volatility level");
  eq(empty.n, 1, "though the population is still reported");
  eq(marketAggregate(null).n, 0, "no input is no population rather than a throw");

  ok(MARKET_NOTES.population.includes("SCREENED UNIVERSE"),
     "the published prose names the population in the words the page must use");
  ok(/never .*the market|not.*over the market/i.test(MARKET_NOTES.population),
     "and explicitly refuses the phrase 'the market'");
  ok(MARKET_NOTES.presence.includes("BOTH"),
     "and states the presence rule, beside the arithmetic that implements it");
}

/* ---------- the sector fixture, checked against its own publisher ---------

   THE SECOND FIXTURE LIE ON THIS SURFACE, and it is worse than the first.

   The first was structural: this file wrote `rows:` where the publisher
   writes `sectors:`, so the renderer and the fixture agreed with each other
   and neither agreed with the pipeline. That one is fixed and pinned by
   tests/flows-payload-shape.mjs.

   This one was NUMERICAL. The fixture said `trix: 12.5` and `trix: -8.25`.
   `trix` is a 0..100 clamp score whose neutral point is 50 — the payload
   publishes the relation on itself — so NEITHER VALUE CAN EVER BE EMITTED:
   one is far below neutral and the other is negative, which the quantity does
   not admit. assets/js/flows-market.js branched on `r.trix >= 0` to place the
   bar and pick the tone, a test that is true for every value the publisher
   can produce, and these two impossible numbers were the only reason a fixed
   renderer would have looked broken and a broken one looked fine. Fifty-eight
   assertions passed over a panel that drew every sector positive.

   So the fixture is now GENERATED FROM THE PUBLISHED RELATION rather than
   typed, and the relation is asserted here before any browser starts. A row
   that cannot exist can no longer be written by hand into this file. */
const TRIX_FULL_SCALE_BP = 50;          // the payload's own declared band
const scaleTrix = (bp) =>
  Number((50 + 50 * Math.max(-1, Math.min(1, bp / TRIX_FULL_SCALE_BP))).toFixed(1));

const sectorRow = (sector, etf, trixBp) => ({
  sector, etf, trixBp,
  trix: scaleTrix(trixBp),
  clamped: Math.abs(trixBp) >= TRIX_FULL_SCALE_BP,
});

/* Four measured sectors chosen to reach four different branches of the
   renderer, and one that never settled:
     XLK  a positive reading
     XLF  a MEASURED ZERO — the row that proves a zero is drawn at the centre
          rule, classed neither way, and printed WITHOUT a plus
     XLE  a negative reading — the row the old renderer printed as "+45.9"
     XLU  a SATURATED reading past the band, drawn at the rail with its true
          number beside it
     XLRE unmeasured, which must be omitted rather than drawn at zero */
const SECTOR_FIXTURE = [
  sectorRow("Technology", "XLK", 6.25),
  sectorRow("Financials", "XLF", 0),
  sectorRow("Energy", "XLE", -4.13),
  sectorRow("Utilities", "XLU", -71.4),
  { sector: "Real Estate", etf: "XLRE", trix: null, trixBp: null, clamped: null,
    reason: "31 usable XLRE closes of 31 returned; 106 are needed" },
];

{
  for (const r of SECTOR_FIXTURE) {
    if (r.trixBp === null) { eq(r.trix, null, `${r.etf} publishes both readings null together`); continue; }
    eq(r.trix, scaleTrix(r.trixBp),
       `${r.etf}: the fixture's trix is exactly what the published relation makes of its trixBp`);
    ok(r.trix >= 0 && r.trix <= 100,
       `${r.etf}: trix ${r.trix} is inside the 0..100 the publisher can emit — the old fixture ` +
       "wrote 12.5 and −8.25, and a renderer testing `trix >= 0` for a sign passed against both");
  }
  eq(scaleTrix(0), 50, "no momentum is FIFTY on this scale, which is why `trix` cannot carry a sign");
  eq(scaleTrix(-71.4), 0, "and a reading past the band saturates at the rail rather than going negative");
}

/* ---------- the cadence is not the renderer's to keep ---------------

   assets/js/flows-market.js declared `var REFRESH_CADENCE_MINUTES = 15`
   under a comment admitting the copy was linked to shared/flows-freshness.js
   by that comment and nothing else. shared/flows-pulse.js publishes
   `cadenceMinutes` on the pulse the market page already fetches, so the copy
   is gone. Asserted over the SOURCE as well as the page below, because a
   rendered stamp cannot tell a payload read from a local constant that
   happens to agree with the fixture — which is precisely how the copy
   survived for as long as it did. */
{
  const src = readFileSync(new URL("../assets/js/flows-market.js", import.meta.url), "utf8");
  /* COMMENTS OUT FIRST, for the reason tests/flows-payload-shape.mjs strips
     them: the renderer's own account of the constant it deleted names that
     constant, and a scan that reads prose as code reports the warning as the
     defect. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/([^:])\/\/[^\n]*/g, "$1");
  ok(!/REFRESH_CADENCE_MINUTES/.test(code),
     "assets/js/flows-market.js keeps no cadence constant of its own. A browser IIFE cannot " +
     "import shared/, which is why the number travels on the payload now instead of being " +
     "restated somewhere nothing can keep it true");
  ok(/pulseStamp\(\s*pulse\.readAt,\s*pulse\.refreshed,\s*pulse\.cadenceMinutes\s*\)/.test(code),
     "and the stamp is handed the cadence off the payload the page already fetched, rather " +
     "than a second request or a second literal");
  ok(/function pulseStamp\(readAt, refreshed, cadenceMinutes\)/.test(code),
     "which pulseStamp takes as an argument instead of closing over a module constant — a " +
     "closed-over copy is the shape this change removed, and it would pass every page " +
     "assertion below while quietly disagreeing with the cron");
}

/* ---------- the page ---------------------------------------------- */
const TOKEN = "market-token-aaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const auth = { Cookie: "flows_session=" + token };
const put = (key, bodyObj) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(bodyObj),
});

const browser = await chromium.launch();
try {
  /* THE EMPTY STORE FIRST, or it cannot be taken at all — the publish below
     would be asserting against this file's own writes. */
  {
    const anon = await fetch(url("/api/flows/market"), { redirect: "manual" });
    eq(anon.status, 401, "the market level needs a session like every other flows API");
    const pending = await (await fetch(url("/api/flows/market"), { headers: auth })).json();
    eq(pending.status, "pending", "an unpublished market level reports pending, not an error");

    const page = await browser.newPage();
    await page.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await page.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    const text = await page.textContent("#mktStatus");
    ok(/no session has been measured yet/i.test(text || ""),
       "and the page says so as a fact about the store rather than rendering an empty chart");
    const bare = await page.evaluate(() => {
      const first = (sel) => document.querySelector(sel);
      const kindOf = (sel) => (first(sel) ? first(sel).getAttribute("data-empty") : null);
      const tilt = first("#mktTilt [data-empty]");
      return {
        panels: [...document.querySelectorAll(".fc-panel")].filter((p) => !p.hidden).length,
        status: document.getElementById("mktStatus").getAttribute("data-empty"),
        statusStyle: getComputedStyle(document.getElementById("mktStatus")).borderLeftStyle,
        tilt: kindOf("#mktTilt [data-empty]"),
        tiltStyle: tilt ? getComputedStyle(tilt).borderLeftStyle : null,
        tiltGlyph: tilt ? getComputedStyle(tilt, "::before").content : null,
        tiltText: tilt ? tilt.textContent : "",
        breadth: kindOf("#mktBreadth [data-empty]"),
        tape: kindOf("#mktTapeBody [data-empty]"),
        sectors: kindOf("#mktSectors [data-empty]"),
        movers: kindOf("#mktMovers [data-empty]"),
        pulse: kindOf("#mkPulseGrid [data-empty]"),
        against: kindOf("#mktAgainst [data-empty]"),
        charts: document.querySelectorAll(".mk-tide-svg").length,
      };
    });
    /* THE EMPTY STORE IS SEVEN PENDING REGIONS, NOT A BLANK PAGE. The
       controller used to return before any painter ran, so a market key the
       pipeline had not written yet took sectors, the extremes, the pulse and
       the board join down with it — four regions that never read that key —
       behind one untagged sentence in the status line. Every region now
       carries its own pending mark: the dotted bar and ellipsis flows.css
       reserves for "still coming", which is a different mark from the dagger
       that means "published without this field", and which pendingLine()
       used to emit for both. */
    eq(bare.panels, 7,
       "every panel is drawn, each holding a pending line, rather than no panel at all — a " +
       "panel that vanishes for a reason the reader cannot see is the worst of the silences");
    eq(bare.status, "pending", "the status line carries the pending mark, not bare prose");
    eq(bare.statusStyle, "dotted", "and draws it as the dotted bar");
    for (const region of ["tilt", "breadth", "tape", "sectors", "movers", "pulse", "against"]) {
      eq(bare[region], "pending",
         `the ${region} region is tagged pending — an unpublished key, which is neither a ` +
         "failed request nor a payload missing a field");
      sawSilence(bare[region], region + ": " + bare.tiltText);
    }
    eq(bare.tiltStyle, "dotted",
       "the pending line's mark is the dotted bar — the dagger it used to wear belongs to " +
       "a published payload missing a field, which this is not");
    ok(/…/.test(bare.tiltGlyph || ""),
       `and the ellipsis glyph (${bare.tiltGlyph}), so the kind is legible in greyscale`);
    ok(/has not published the market level yet/.test(bare.tiltText),
       `naming the key that is pending (${bare.tiltText})`);
    eq(bare.charts, 0, "and no chart is drawn from a pulse that was never published");
    await page.close();
  }

  /* A REAL SESSION. The two tilts DISAGREE in sign by construction: breadth is
     positive (more names bought than sold) while premium is negative (the
     dollars went the other way). That is the page's most informative state and
     the one a single-number design would erase. */
  /* THE SESSION DATE IS RELATIVE, NOT TYPED. It used to be the literal
     "2026-08-25", which was fresh on the day it was written and is now
     whatever the wall clock makes of it. The page's stale banner tests the
     session's age, so a hard-coded date would make a freshness assertion flip
     from pass to fail on a calendar boundary and would let the fresh branch
     rot into the stale one unnoticed. Both branches are asserted below, each
     against a date built for it. */
  const dayStamp = (offsetDays) =>
    new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
  const FRESH_SESSION = dayStamp(1);

  const payload = {
    v: 2, generatedAt: new Date().toISOString(), sessionDate: FRESH_SESSION, status: "ok",
    n: 200, screened: 260,
    premium: {
      netPositive: 1_000_000_000, netNegative: 3_000_000_000, net: -2_000_000_000,
      priced: 180, oneLegged: 7, tilt: -0.5, topShare: 0.62,
    },
    breadth: { bull: 120, bear: 55, flat: 5, unpriced: 20, tilt: 0.3714 },
    pcr: { volume: 0.812, premium: 0.744, quotedVolume: 190, quotedPremium: 185 },
    aggressor: {
      callAsk: 900, callBid: 600, putAsk: 400, putBid: 700,
      callLift: 0.6, putLift: 0.3636, quoted: 175,
    },
    vol: { iv30dMedian: 0.3412, iv30dQuoted: 178, ivRankMedian: 0.4102, ivRankQuoted: 200 },
    notes: MARKET_NOTES,
  };
  eq((await put("market", payload)).status, 200, "the ingest route accepts the market key");

  /* THE PUBLISHER'S SHAPE, NOT THE RENDERER'S.

     This fixture used to write `rows:`, which is the key the RENDERER read and
     a key scripts/flows-pipeline.mjs has never written — it publishes the
     eleven readings under `sectors`. Fixture and renderer agreed with each
     other, 58 assertions passed, and the live page said "No sector carried
     enough history" through a run that measured all eleven. That is this
     repo's oldest trap: a fixture written from the same assumption as the code
     proves only that the assumption is self-consistent.

     The field names below are copied from the publish("sector:trix", ...) call
     and are pinned against the pipeline's REAL emitted payload by
     tests/flows-payload-shape.mjs, which is what makes this fixture honest
     rather than merely corrected. */
  await put("sector:trix", {
    v: 2, status: "ok", measured: 4,
    span: 15, price: "log", seriesSessions: 42, warmupSessions: 63,
    /* THE SCALING BLOCK IS PART OF THE FIXTURE, because the renderer now
       reads its band to build the axis. Leaving it out would have quietly
       exercised only the fallback path. */
    scaling: {
      rule: "fixed-clamp", choice: true, neutral: 50,
      fullScaleBp: TRIX_FULL_SCALE_BP,
      relation: "trix = 50 + 50 * clamp(trixBp / fullScaleBp, -1, +1)",
    },
    basis: "SPDR Select Sector ETFs, not GICS index levels",
    sectors: SECTOR_FIXTURE,
  });
  /* THE DENOMINATORS THE PUBLISHER WRITES, in the fixture so the page can be
     required to print them: universe is the screened population, ranked and
     priced the names that quoted a change and a net premium, and the two
     complements the names in no column. Nine risers against a cut of eight,
     so the column's "8 of 9" is a number the page has to compute rather than
     one it could echo. */
  await put("movers", {
    v: 2, status: "ok",
    universe: 260, cap: 15, ranked: 254, priced: 250, unrankedChange: 6, unrankedPremium: 10,
    risers: [{ t: "AAA", chg: 0.081, netPrem: 1e7 }].concat(
      ["AB2", "AC3", "AD4", "AE5", "AF6", "AG7", "AH8", "AI9"].map((t, i) => (
        { t, chg: 0.07 - i * 0.005, netPrem: 1e6 }))),
    fallers: [{ t: "BBB", chg: -0.064, netPrem: -2e7 }],
    premium: { bullish: [{ t: "CCC", netPrem: 5e8 }], bearish: [{ t: "DDD", netPrem: -6e8 }] },
  });

  /* THE TWO BOARDS, so the market level and the ranking it exists beside can
     finally be read against each other. DDD is ranked third LONG and is the
     session's largest net PUT premium — a direct contradiction, and the whole
     reason the panel exists. The short board deliberately overlaps NOTHING,
     so the same render exercises both the hit column and the measured-empty
     one; a panel that has only ever been shown its happy path is the shape
     this repo keeps paying for. */
  await put("board:long", {
    v: 2, side: "long", status: "ok", sessionDate: FRESH_SESSION,
    rows: [{ t: "EEE", r: 1 }, { t: "FFF", r: 2 }, { t: "DDD", r: 3 }],
  });
  await put("board:short", {
    v: 2, side: "short", status: "ok", sessionDate: FRESH_SESSION,
    rows: [{ t: "GGG", r: 1 }, { t: "HHH", r: 2 }],
  });

  /* THE PULSE, which no browser has ever rendered in this repository: the
     only pulse suite is over the shapers. So the tide chart, the seven cards
     and the freshness stamp have shipped untested since the day they landed.

     Each feed below is chosen for a branch: `insiders` is QUIET (it answered
     with nothing), `darkpool` is UNAVAILABLE (it could not be read), the tide
     carries a NULL bucket that must break the line rather than be bridged,
     oiChange carries a MEASURED ZERO change and seasonality a measured zero
     average — the two readings that used to print "+0" and "+0.00%". */
  const totalsRows = [];
  for (let i = 0; i < 20; i++) {
    totalsRows.push({
      date: dayStamp(i + 1),
      callPrem: 1e9, putPrem: (20 - i) * 4e7,
      callVol: 5_000_000, putVol: 3_000_000,
    });
  }
  /* THE CADENCE IS TWENTY HERE AND FIFTEEN IN shared/flows-freshness.js, ON
     PURPOSE. The renderer used to carry `var REFRESH_CADENCE_MINUTES = 15`
     mirroring that module, under a comment admitting the mirror was the only
     link between them; shared/flows-pulse.js now publishes `cadenceMinutes`
     and the renderer reads it. A fixture that repeated the shared constant
     would pass against a renderer that had gone back to hard-coding it, so
     this one deliberately does not: the number on the page has to be the
     number in the payload, and 20 is a number no constant in this repository
     holds.

     ASSERTED, NOT MERELY INTENDED. "20 is not 15" is the whole discriminating
     power of every stamp assertion below, and it is a claim about a constant
     in another module that this file cannot see change. Move the cron to
     twenty minutes and this suite would go on passing against a renderer that
     had quietly gone back to mirroring it, so the divergence fails here
     instead — loudly, and next to the number to change. */
  const FIXTURE_CADENCE = 20;
  ok(FIXTURE_CADENCE !== REFRESH_CADENCE_MINUTES,
     `the pulse fixture's cadence (${FIXTURE_CADENCE}) is not the one the Worker's cron ships ` +
     `with (${REFRESH_CADENCE_MINUTES}), which is what makes the stamp assertions below able ` +
     "to tell a payload read from a mirrored constant");

  const pulsePayload = (over) => Object.assign({
    v: 2, generatedAt: new Date().toISOString(), sessionDate: FRESH_SESSION,
    readAt: new Date().toISOString(), refreshed: "intraday", cadenceMinutes: FIXTURE_CADENCE,
    tide: {
      status: "ok", seen: 5, cap: 480, shed: 0,
      points: [
        { t: FRESH_SESSION + "T13:30:00Z", callPrem: 1.0e8, putPrem: -4.0e7 },
        { t: FRESH_SESSION + "T14:00:00Z", callPrem: 1.4e8, putPrem: -5.0e7 },
        // The bucket the vendor never sent. It must be a GAP, never a zero.
        { t: FRESH_SESSION + "T14:30:00Z", callPrem: null, putPrem: -6.0e7 },
        { t: FRESH_SESSION + "T15:00:00Z", callPrem: 1.1e8, putPrem: -5.5e7 },
        { t: FRESH_SESSION + "T15:30:00Z", callPrem: 0.9e8, putPrem: -7.0e7 },
      ],
    },
    totals: { status: "ok", rows: totalsRows, seen: 20, cap: 20, shed: 0 },
    oiChange: {
      status: "ok", seen: 2, cap: 20, shed: 0,
      rows: [
        /* TWO READINGS PER ROW. The vendor sends a ratio (oi_change) and a
           contract count (oi_diff_plain); this table drew the ratio under a
           contracts header until 2026-09-04, so both now ride the fixture
           with values that reconcile against curr/prev. AAA is the measured
           zero in BOTH: no contracts moved and the ratio is 0. */
        { t: "AAA", cp: "C", k: 150, exp: "2026-09-18", diff: 0, ratio: 0,
          currOi: 12000, prevOi: 12000, vol: 3400 },
        { t: "BBB", cp: "P", k: 80, exp: "2026-10-16", diff: -2500, ratio: -0.2174,
          currOi: 9000, prevOi: 11500, vol: 1200 },
      ],
    },
    netImpact: {
      status: "ok", seen: 2, cap: 20, shed: 0,
      rows: [{ t: "CCC", netPrem: 5e8 }, { t: "DDD", netPrem: -6e8 }],
    },
    insiders: { status: "quiet", rows: [], seen: 0, cap: 12, shed: 0 },
    darkpool: { status: "unavailable", reason: "the venue feed answered 502", rows: [] },
    seasonality: {
      status: "ok", seen: 2, cap: 12, shed: 0,
      rows: [
        { month: 1, avg: 0, positivePct: 50, median: 0.5, min: -3, max: 4, years: 20 },
        { month: 2, avg: -1.25, positivePct: 41.5, years: 20 },
      ],
    },
    notes: { refusals: "No feed here supports intent or identity." },
  }, over || {});
  eq((await put("pulse", pulsePayload())).status, 200, "the ingest route accepts the pulse key");

  const page = await browser.newPage();
  await page.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
  await page.goto(url("/flows/market/"), { waitUntil: "networkidle" });
  await page.waitForSelector("#mktTiltPanel:not([hidden])");
  await page.waitForSelector("#mkPulsePanel:not([hidden])");

  const read = await page.evaluate(() => {
    const txt = (sel) => (document.querySelector(sel) || {}).textContent || "";
    const bars = [...document.querySelectorAll("#mktTilt .mk-bar")].map((b) => ({
      cls: b.className, width: b.style.width, left: b.style.left,
    }));
    const svgs = [...document.querySelectorAll(".mk-tide-svg")].map((g) => ({
      viewBox: g.getAttribute("viewBox"),
      width: g.getAttribute("width"),
      height: g.getAttribute("height"),
      /* THE DRAWN BOX, NOT THE DECLARED ONE. Every "chart invariant"
         assertion in this repository has read the ATTRIBUTE, which is exactly
         the number a stylesheet width overrides without touching. */
      rectW: Number(g.getBoundingClientRect().width.toFixed(3)),
      rectH: Number(g.getBoundingClientRect().height.toFixed(3)),
      par: g.getAttribute("preserveAspectRatio"),
      hostWidth: Math.round(g.parentNode.clientWidth),
      callD: (g.querySelector(".mk-tide-call") || {}).getAttribute
        ? g.querySelector(".mk-tide-call").getAttribute("d") : null,
      putD: g.querySelector(".mk-tide-put")
        ? g.querySelector(".mk-tide-put").getAttribute("d") : null,
      labels: [...g.querySelectorAll(".mk-tide-lab")].map((t) => t.textContent),
      /* The x-axis ticks alone: the labels on the chart's bottom row, by x. */
      ticks: (() => {
        const labs = [...g.querySelectorAll(".mk-tide-lab")].map((t) => ({
          x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")), text: t.textContent,
        }));
        const bottom = Math.max(...labs.map((l) => l.y));
        return labs.filter((l) => l.y === bottom).sort((a, b) => a.x - b.x);
      })(),
    }));
    return {
      status: txt("#mktStatus"),
      stale: {
        hidden: (document.getElementById("mktStale") || {}).hidden,
        text: txt("#mktStale"),
        bodyClass: document.body.className,
      },
      tiltNote: txt("#mktTiltNote"),
      breadthNote: txt("#mktBreadthNote"),
      foot: txt("#mktFoot"),
      tape: [...document.querySelectorAll("#mktTapeBody tr")].map((tr) => ({
        k: tr.querySelector("th").textContent,
        v: tr.querySelectorAll("td")[0].textContent,
        n: tr.querySelectorAll("td")[1].textContent,
      })),
      bars,
      /* The NAME is the label's first text node: the ETF ticker sits beside
         it in a <small>, and textContent would fuse the two. */
      sectors: [...document.querySelectorAll(".mk-sector-k")].map((n) => n.firstChild.textContent),
      sectorEtfs: [...document.querySelectorAll(".mk-sector-k")]
        .map((n) => (n.querySelector(".mk-sector-etf") || {}).textContent || null),
      /* THE WHOLE SECTOR ROW, not just its name: the defect this suite missed
         lived entirely in the bar's placement and the value's sign. The
         unsettled row is read apart, below: it has no bar and no value. */
      sectorRows: [...document.querySelectorAll(".mk-sector:not(.is-unsettled)")].map((li) => {
        const bar = li.querySelector(".mk-bar");
        return {
          name: li.querySelector(".mk-sector-k").firstChild.textContent,
          value: (li.querySelector(".mk-sector-v") || {}).textContent,
          cls: bar ? bar.className : null,
          width: bar ? bar.style.width : null,
          left: bar ? bar.style.left : null,
          aria: (li.querySelector(".mk-track") || {}).getAttribute
            ? li.querySelector(".mk-track").getAttribute("aria-label") : null,
        };
      }),
      sectorNote: txt("#mktSectorNote"),
      unsettled: [...document.querySelectorAll(".mk-sector.is-unsettled")].map((li) => ({
        name: li.querySelector(".mk-sector-k").firstChild.textContent,
        etf: (li.querySelector(".mk-sector-etf") || {}).textContent || null,
        kind: li.querySelector("[data-empty]")
          ? li.querySelector("[data-empty]").getAttribute("data-empty") : null,
        text: li.querySelector("[data-empty]") ? li.querySelector("[data-empty]").textContent : "",
        bars: li.querySelectorAll(".mk-bar").length,
        values: li.querySelectorAll(".mk-sector-v").length,
      })),
      movers: [...document.querySelectorAll("#mktMovers .mk-mv-t")].map((n) => n.textContent),
      moverLinks: document.querySelectorAll("#mktMovers a").length,
      moverHeads: [...document.querySelectorAll("#mktMovers .mk-movers-h")].map((h) => ({
        title: h.firstChild.textContent,
        cut: (h.querySelector(".mk-movers-n") || {}).textContent || null,
      })),
      moverPop: txt("#mktMovers .mk-movers-pop"),
      moverPopEmpty: document.querySelector("#mktMovers > [data-empty]")
        ? document.querySelector("#mktMovers > [data-empty]").getAttribute("data-empty") : null,
      stackTotal: [...document.querySelectorAll(".mk-seg")]
        .reduce((s, i) => s + parseFloat(i.style.width || "0"), 0),
      againstHidden: (document.getElementById("mktAgainstPanel") || {}).hidden,
      againstTickers: [...document.querySelectorAll("#mktAgainst .mk-mv-t")].map((n) => n.textContent),
      againstEmpties: [...document.querySelectorAll("#mktAgainst [data-empty]")]
        .map((n) => ({ kind: n.getAttribute("data-empty"), text: n.textContent })),
      againstNote: txt("#mktAgainstNote"),
      pulseStamp: txt("#mkPulseStamp"),
      pulseRank: txt(".mk-pulse-rank"),
      /* Per CARD, not per document: four of the seven cards draw a table and
         a document-wide selector would let one card's rows answer for
         another's — the same blur the payload-shape scan exists to stop. */
      pulseCards: [...document.querySelectorAll(".mk-pulse-card")].map((c) => ({
        title: (c.querySelector(".mk-pulse-h") || {}).textContent,
        rows: [...c.querySelectorAll("tbody tr")]
          .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent)),
        empties: [...c.querySelectorAll("[data-empty]")]
          .map((n) => ({ kind: n.getAttribute("data-empty"), text: n.textContent })),
      })),
      seaValues: [...document.querySelectorAll(".mk-sea-v")].map((n) => n.textContent),
      svgs,
    };
  });

  /* THE DISAGREEMENT IS NAMED, not left for the reader to spot. */
  ok(/disagree/i.test(read.tiltNote),
     "two tilts of opposite sign are reported AS a disagreement — breadth without size is a " +
     "different session from size without breadth, and no single number can say which");

  /* SIGN IS CARRIED BY POSITION. Both bars must be placed on the fixed axis
     such that the negative one sits left of the centre rule; hue is
     confirmation, and this assertion holds with the colours removed. */
  eq(read.bars.length, 2, "both weightings are drawn");
  const pos = read.bars.find((b) => /is-pos/.test(b.cls));
  const neg = read.bars.find((b) => /is-neg/.test(b.cls));
  ok(pos && pos.left === "50%",
     "the positive bar starts at the centre rule and grows right");
  ok(neg && parseFloat(neg.left) < 50,
     `the negative bar starts LEFT of centre (${neg && neg.left}) — position carries the sign, ` +
     "so the reading survives greyscale and colour blindness");
  near(parseFloat(neg.width), 25, 0.01,
       "and its width is the magnitude on a FIXED [-1,1] axis: −0.5 fills half the half-axis. " +
       "Scaling to the data would draw a 0.03 session as a decisive one");

  /* CONCENTRATION IS SPOKEN, because 62% in five names changes what the
     aggregate means. */
  ok(/62\.0%|62%/.test(read.breadthNote),
     "the top-five share is stated");
  ok(/five names/i.test(read.breadthNote) && /not as the universe/i.test(read.breadthNote),
     "and when it exceeds half, the note says to read the total as those names");
  ok(/7/.test(read.breadthNote) && /one leg/i.test(read.breadthNote),
     "the one-legged count reaches the reader rather than vanishing into `unpriced`");

  /* EVERY TAPE ROW STATES ITS OWN POPULATION. */
  eq(read.tape.length, 7, "seven aggregate readings");
  ok(read.tape.every((r) => r.n && r.n !== ""),
     "and every one names the population it was measured over — two ratios over different " +
     "sets of names are not comparable and must not look it");
  const iv = read.tape.find((r) => /IV rank/i.test(r.k));
  ok(iv && /41\.0%/.test(iv.v),
     `the IV-rank median renders as a percentage of the fraction (${iv && iv.v}), not as the ` +
     "raw 0..100 column — 0.4102 is 41.0%, never 0.4%");

  /* THE PART-TO-WHOLE BAR IS A WHOLE. */
  near(read.stackTotal, 100, 0.01,
       "the breadth segments sum to 100% of the priced population, so the bar is a " +
       "part-to-whole reading rather than three unrelated widths");

  /* ---------- SECTOR MOMENTUM: THE SIGN LIVES IN POSITION -------------

     THE DEFECT THIS BLOCK EXISTS FOR. paintSectors drew `trix`, the 0..100
     clamp score, and branched on `trix >= 0` to place the bar and pick the
     tone. That predicate is true of every value the publisher can emit, so
     every sector started at the centre rule and grew right, and a sector at
     −23.65 bp printed a positive number in the positive tone. Nothing below
     asserts a colour: every assertion is about the number's glyph, the bar's
     side of the centre rule, or the words in the caption, so the whole block
     holds on a greyscale printout — which is the actual requirement. */

  /* A SECTOR WITH NO SETTLED READING IS NAMED IN ITS ROW, NEVER DRAWN AT
     ZERO. It used to be omitted and counted — "1 sector had too little
     history to settle and is omitted" — which told a reader that one of
     eleven was missing and not which, while the payload carried the name,
     the ticker and the reason. The withholding is a row now: no bar, no
     number, the reason verbatim, under the mark for a published field that
     is not on the payload. */
  assert.deepEqual(read.sectors, ["Technology", "Financials", "Energy", "Utilities", "Real Estate"],
    "the settled sectors are ranked by the RAW reading, high to low — ranking on `trix` " +
    "instead ties every saturated sector at 100 and then orders them arbitrarily — and " +
    "the unsettled sector is listed last, by name"); checks++;
  eq(read.unsettled.length, 1, "exactly one row is the unsettled kind");
  const xlre = read.unsettled[0];
  eq(xlre.name, "Real Estate", "it is the sector the fixture could not settle");
  eq(xlre.etf, "XLRE", "with its ticker");
  eq(xlre.bars, 0, "and NO bar: a flat bar at zero would read as measured neutrality");
  eq(xlre.values, 0, "and no number, because there is none");
  eq(xlre.kind, "unavailable",
     "tagged unavailable — the payload was published and this reading is not on it — " +
     "which is neither a failed request nor a quiet market");
  ok(/31 usable XLRE closes of 31 returned; 106 are needed/.test(xlre.text),
     `holding the payload's own reason verbatim (${xlre.text})`);
  sawSilence(xlre.kind, xlre.text);
  ok(/4 of 5 sectors settled a reading/.test(read.sectorNote),
     `the note states the settled population with its denominator (${read.sectorNote.slice(0, 60)})`);
  ok(/1 of 5 sectors had too little history to settle/.test(read.sectorNote) &&
     /listed without a bar/.test(read.sectorNote),
     "and counts the unsettled one against the same denominator, saying it is listed rather " +
     "than omitted");
  ok(!/omitted/.test(read.sectorNote),
     "and no longer claims an omission, since nothing is omitted any more");
  /* UNITS TRAVEL WITH THE LABEL TOO. Every row is a tradeable ETF and not
     the GICS index its name suggests; the basis sentence said so five rows
     away from the labels it was about. */
  assert.deepEqual(read.sectorEtfs, ["XLK", "XLF", "XLE", "XLU", "XLRE"],
    "every row, the unsettled one included, carries its ETF ticker beside the sector name"); checks++;

  const sec = (name) => read.sectorRows.find((r) => r.name === name);
  const xlk = sec("Technology"), xlf = sec("Financials");
  const xle = sec("Energy"), xlu = sec("Utilities");

  /* UNITS TRAVEL WITH THE NUMBER. "+26.4" was a bare figure under a caption
     that called it basis points; it was not basis points. */
  read.sectorRows.forEach((r) => {
    ok(/ bp$/.test(r.value),
       `${r.name} states its unit (${r.value}) — a bare number under a caption naming a ` +
       "different unit is how this panel published a clamp score as basis points");
  });

  eq(xle.value, "−4.13 bp",
     "THE HEADLINE REGRESSION: Energy is negative and prints as negative. Under the old " +
     "renderer this row was the clamp score 45.9 with a plus in front of it, in the " +
     "positive tone, on a bar growing right from the centre rule");
  ok(parseFloat(xle.left) < 50,
     `and its bar starts LEFT of the centre rule (${xle.left}) — position, not hue, carries ` +
     "the sign");
  ok(/is-neg/.test(xle.cls), "with the negative class agreeing, as confirmation and not as the channel");
  near(parseFloat(xle.width), 4.13, 0.01,
       "and its width is |−4.13| against the published ±50 bp band on the half-axis");

  eq(xlk.value, "+6.25 bp", "the positive sector keeps its plus");
  eq(xlk.left, "50%", "and grows right from the centre rule");
  near(parseFloat(xlk.width), 6.25, 0.01, "at |6.25| of the same fixed band");

  /* A MEASURED ZERO IS NOT A POSITIVE. This row is the one the fixture was
     structurally unable to contain before: `trix` cannot be zero-signed
     because its zero is 50. */
  eq(xlf.value, "0.00 bp",
     "a sector measured at exactly zero prints UNSIGNED — not '+0.00'. A displayed zero " +
     "must mean 'measured zero', and a plus in front of it is the confident-zero defect " +
     "one level up from the arithmetic");
  eq(xlf.left, "50%", "it sits ON the centre rule");
  near(parseFloat(xlf.width), 0, 0.001, "with no width at all");
  ok(/is-flat/.test(xlf.cls) && !/is-pos/.test(xlf.cls),
     `and is classed neither way (${xlf.cls}) — 'is-pos' on a measured zero is a lie in the ` +
     "DOM even when nothing paints");

  /* THE RAIL ANNOUNCES ITSELF. A reading past the band and one just inside it
     draw the same bar; the number beside it is what tells them apart. */
  near(parseFloat(xlu.width), 50, 0.01,
       "a sector past the published band fills the half-axis rather than overflowing it");
  eq(xlu.value, "−71.40 bp",
     "and the number beside it is the TRUE reading, not the rail it was drawn at");
  ok(/1 sector sits beyond that band/.test(read.sectorNote),
     `and the caption counts the saturated readings (${read.sectorNote})`);

  /* THE SCREEN READER GETS THE SIDE IN WORDS, since the position it depends on
     is exactly the channel it cannot see. */
  ok(/left of the zero rule/.test(xle.aria || ""),
     `the negative row's aria-label says which side of the rule it is on (${xle.aria})`);
  ok(/at the zero rule/.test(xlf.aria || ""),
     `and the measured zero says it is AT the rule (${xlf.aria})`);

  /* THE AXIS IS FIXED AND PUBLISHED, so the caveat it used to need is gone. */
  ok(/−50 to \+50 bp/.test(read.sectorNote),
     `the caption names the payload's own band (${read.sectorNote})`);
  ok(/same band every session/.test(read.sectorNote),
     "and says the axis is comparable across days");
  ok(!/never with another day/.test(read.sectorNote),
     "and no longer carries the session-scaled caveat, which was true of the old max-scaled " +
     "axis and is false of this one");
  ok(/basis points per session/i.test(read.sectorNote),
     "the unit is named in the caption as well as on every row");
  ok(/SPDR Select Sector ETFs/.test(read.sectorNote),
     "and the payload's own basis line reaches the reader: these are eleven tradeable " +
     "baskets, not GICS index levels");

  /* TICKERS ARE NOT LINKS. movers ranks the whole screened universe while
     cards exist only for the board's deep names, so a link would usually open
     an empty modal. */
  eq(read.moverLinks, 0,
     "no ticker on this page is a link: movers ranks the whole screened universe while a " +
     "detail card exists only for the names the board went deep on, so a link would " +
     "reliably lead nowhere");
  ok(read.movers.includes("AAA") && read.movers.includes("DDD"),
     "all four mover lists reach the page — eleven vendor calls a run stop being dark");

  /* A COUNT NEVER APPEARS WITHOUT ITS POPULATION. Four columns of eight
     names printed with no number anywhere saying eight of what: the payload
     ranks fifteen deep over a screened universe it also counts, and none of
     universe, ranked, priced, unrankedChange or unrankedPremium was read. */
  const head = (t) => read.moverHeads.find((h) => h.title === t);
  eq(head("Largest risers").cut, " · 8 of 9",
     "a column cut to eight of nine ranked names says so beside its title");
  eq(head("Largest fallers").cut, " · 1 of 1",
     "and a column that prints its whole ranking says that too, in the same form");
  ok(!read.movers.includes("AI9"),
     "the ninth riser is the one cut, which is what makes the 8 of 9 a measurement");
  ok(/254 of 260 screened names could be ranked by change and 250 by net premium/.test(read.moverPop),
     `the open population line reads the publisher's own denominators (${read.moverPop})`);
  ok(/6 quoted no change and 10 no net premium, and those names are in no column/.test(read.moverPop),
     "and accounts for the names in no column out loud rather than deducting them silently");
  eq(read.moverPopEmpty, null,
     "with no silence mark on the panel's population, because the payload carried it");

  /* THE FUSED SENTENCE. The size-rank claim had no terminator, so it ran
     into the caveat after it: "…that quoted both legs A rank over 20
     sessions is an ordinal claim". */
  ok(/that quoted both legs\. A rank over 20 sessions/.test(read.pulseRank),
     `the size rank ends in a full stop before the caveat begins (${read.pulseRank.slice(-200)})`);

  /* THE X TICKS DO NOT OVERPRINT. Twenty sessions make the step 6, so the
     ticks fall on 0, 6, 12, 18 and then the newest session, 19, is pushed
     one bucket after 18 — two five-glyph mono labels a bucket apart, which
     rendered as "07-2307-24". The newest stamp always prints; the one
     crowding it is dropped. */
  const totalsTicks = read.svgs[1].ticks;
  ok(totalsTicks.length >= 3, `the totals chart labels at least three sessions (${totalsTicks.length})`);
  totalsTicks.slice(1).forEach((t, i) => {
    ok(t.x - totalsTicks[i].x >= 40,
       `x ticks "${totalsTicks[i].text}" and "${t.text}" are ${(t.x - totalsTicks[i].x).toFixed(1)}px ` +
       "apart — never under 40px, where two five-glyph labels overprint");
  });
  eq(totalsTicks[totalsTicks.length - 1].text, dayStamp(1).slice(5),
     "and the newest session keeps its label, so the tick dropped was the one crowding it");

  read.againstEmpties.forEach((e) => sawSilence(e.kind, e.text));
  read.pulseCards.forEach((c) => c.empties.forEach((e) => sawSilence(e.kind, e.text)));

  /* THE PROSE TRAVELS WITH THE NUMBERS. */
  ok(/screened universe/i.test(read.foot),
     "the footer states the population in the payload's own words");
  ok(/both/i.test(read.foot),
     "and the presence rule, so a reader knows what was excluded from the totals");
  ok(!/\bthe market\b/i.test(read.status),
     "and the status line never calls this population 'the market'");
  ok(/200 screened names/.test(read.status) && /260/.test(read.status),
     "reporting both the eligible count and what the ladder returned");

  /* ---------- FRESHNESS, on a payload built to be fresh ---------------- */
  eq(read.stale.hidden, true,
     "a session written yesterday raises no stale banner");
  ok(!/is-stale/.test(read.stale.bodyClass),
     "and the page is not dimmed");

  /* ---------- AGAINST THE TAPE ----------------------------------------

     The product's one crossing point. The board score is a residual with
     sector and size divided out; these premium lists are the raw level. DDD
     is ranked third LONG and is the session's single largest net PUT
     premium, which is a contradiction no other surface on the site can see —
     the market page did not fetch the boards and the board page did not
     fetch the movers. */
  eq(read.againstHidden, false, "the panel is drawn rather than hidden");
  assert.deepEqual(read.againstTickers, ["DDD #3"],
    "the one long-board name sitting in the largest net put premium is named, with its " +
    "board rank beside it — a contradiction on the name ranked first is different news " +
    "from one on the name ranked twenty-fifth"); checks++;
  eq(read.againstEmpties.length, 1,
     "and the side with no overlap gets its own sentence rather than an empty column");
  eq(read.againstEmpties[0].kind, "quiet",
     "tagged QUIET: both inputs were read and the intersection is genuinely empty, which " +
     "is a fact about the session and not a failure to measure it");
  ok(/No short-board name/.test(read.againstEmpties[0].text),
     `and the sentence names which side was empty (${read.againstEmpties[0].text})`);
  ok(/1 of 5 published board names \(3 long, 2 short\)/.test(read.againstNote),
     `THE DENOMINATOR TRAVELS WITH THE COUNT (${read.againstNote}) — "one name against the ` +
     'tape" is unreadable without the population it came out of');
  ok(/CAPPED extremes/.test(read.againstNote),
     "and the note refuses the inverse reading: the mover lists are capped, so a name " +
     "absent from them has not been shown to agree with the tape");

  /* ---------- THE PULSE, rendered in a browser for the first time -------

     tests/flows-pulse-contract.mjs covers the shapers and never opens a page,
     so the tide chart, the seven cards and the freshness stamp had shipped
     with no rendering coverage at all. */

  /* THE CHART INVARIANT: one viewBox unit is one CSS pixel. */
  eq(read.svgs.length, 2,
     "two line charts are drawn: the intraday tide, and the sessions the totals feed " +
     "returned — the one distribution this page already held and used to spend on a " +
     "ten-row table");
  read.svgs.forEach((g, i) => {
    const vbWidth = Number(g.viewBox.split(" ")[2]);
    const vbHeight = Number(g.viewBox.split(" ")[3]);
    eq(String(vbWidth), g.width,
       `chart ${i}: the width attribute equals the viewBox width, so one viewBox unit is ` +
       "one CSS pixel and nothing is scaled");
    eq(g.par, "xMidYMid meet", `chart ${i}: preserveAspectRatio is explicit`);
    ok(Math.abs(vbWidth - g.hostWidth) <= 1,
       `chart ${i}: the width was measured from a VISIBLE host (${vbWidth} vs ${g.hostWidth}) — ` +
       "a hidden element reports clientWidth 0 and the chart silently falls back");

    /* THE ASSERTION THE ATTRIBUTE ONES COULD NOT MAKE, and the reason this
       block was passing over a chart that was in fact being rescaled.
       assets/css/flows.css gives .mk-tide-svg `width: 100%`, which overrides
       the width ATTRIBUTE without changing it: the host measured 282.81px,
       the renderer rounded that to 283, and the browser then squeezed 283
       viewBox units into 282.81 CSS pixels. Every assertion above still
       passed, because every one of them reads the attribute. The renderer
       now floors the measured box and pins the size inline, so the identity
       is exact — and this is the assertion that says so. The flows.css
       comment on .cc-trk states the same rule for scoreStrip in so many
       words; nothing was enforcing it here. */
    eq(g.rectW, vbWidth,
       `chart ${i}: the DRAWN width is exactly the viewBox width (${g.rectW} vs ${vbWidth}) — ` +
       "one viewBox unit is one CSS pixel in the rendered box, not merely in the markup");
    eq(g.rectH, vbHeight,
       `chart ${i}: and the drawn height too, so nothing is scaled on either axis`);
    ok(g.rectW <= g.hostWidth,
       `chart ${i}: and the drawing never exceeds the host it was measured from ` +
       `(${g.rectW} in ${g.hostWidth}), which is what keeps a pinned pixel width from ` +
       "pushing a 320px viewport sideways");
  });

  /* NO INTERPOLATION ACROSS A GAP. The tide fixture drops one call bucket;
     the path must lift the pen and start again, never bridge and never
     substitute zero — zero is a real published net premium. */
  const tide = read.svgs[0];
  eq((tide.callD.match(/M/g) || []).length, 2,
     `the call line is drawn in TWO segments (${tide.callD}) because one bucket was never ` +
     "sent: a null is not measured, and bridging it would invent a reading");
  eq((tide.putD.match(/M/g) || []).length, 1,
     "while the put line, which quoted every bucket, is one unbroken segment");
  ok(tide.labels.includes("calls") && tide.labels.includes("puts"),
     "and both series are named at the end of their own line, so the pair is separated by " +
     "words and a dash pattern rather than by hue alone");

  /* THE RANK SENTENCE: the page's only reference distribution, in words. */
  ok(/44\.4% of the two-sided total/.test(read.pulseRank),
     `put premium is stated as a SHARE (${read.pulseRank}) — raw sums are not comparable ` +
     "across sessions that differ in level before they differ in lean");
  ok(/the 1st highest of the 20 sessions/.test(read.pulseRank),
     "with its rank and its denominator, which is what lets anything here be called unusual");
  ok(/most put-leaning session in the window/.test(read.pulseRank),
     "and the extreme is named when the newest session is the extreme");
  ok(/ordinal claim and nothing more/.test(read.pulseRank),
     "while the note refuses the sigma the window is far too short to support");

  const card = (title) => read.pulseCards.find((c) => c.title === title);

  /* A MEASURED ZERO, TWICE, in the two formatters that used to stamp a plus
     on one. */
  const oi = card("Open-interest change");
  eq(oi.rows[0][0], "0",
     "an open-interest change measured at exactly zero prints '0', never '+0' — the row " +
     "reports that the contract's open interest did not move, which is a measurement");
  eq(oi.rows[1][0], "−2,500", "while a real fall keeps its minus and its grouping");
  /* THE COLUMN THAT USED TO CARRY THE WRONG READING, now carrying both under
     their own units. The vendor's oi_change is (curr-last)/last, and this
     table rendered it through signedGrouped() beneath a contracts header:
     a line that went 2,119 to 35,207 printed "+16", and one that grew 21.5%
     printed "+0" — a measured rise drawn as no movement. */
  eq(oi.rows[0][1], "0%",
     "a growth of exactly zero prints '0%' — unsigned for the same reason the count is, " +
     "but STILL CARRYING ITS UNIT, because a bare 0 in a column beside a contract count " +
     "is the ambiguity this pair was split to remove");
  eq(oi.rows[1][1], "−21.7%",
     "and the ratio is multiplied into a percent and CARRIES THE PERCENT SIGN, so it " +
     "can never again be read as a number of contracts");
  eq(read.seaValues[0], "0.00%",
     "a seasonal average of exactly zero prints '0.00%', never '+0.00%'");
  eq(read.seaValues[1], "−1.25%", "and a negative month keeps the U+2212 minus");

  /* THE TWO PER-FEED SILENCES, told apart in the DOM as well as in prose. */
  const dark = card("Dark pool prints"), ins = card("Insider filings");
  eq(dark.empties[0].kind, "unavailable",
     "a feed that could not be read is UNAVAILABLE");
  ok(/502/.test(dark.empties[0].text),
     "and names the reason the payload gave rather than a generic apology");
  eq(ins.empties[0].kind, "quiet",
     "while a feed that answered with nothing is QUIET — a fact about the tape, not an outage");

  /* THE STAMP, on a read taken just now. */
  ok(new RegExp("refreshes about every " + FIXTURE_CADENCE + " minutes").test(read.pulseStamp),
     `a read inside one cadence may claim the intraday refresh (${read.pulseStamp}), and ` +
     `the interval it claims is the PAYLOAD'S — ${FIXTURE_CADENCE}, which is not the ` +
     `${REFRESH_CADENCE_MINUTES} that shared/flows-freshness.js holds. A renderer mirroring ` +
     "that constant would print 15 here and pass every other assertion in this block");
  ok(!/\d{4}/.test(read.pulseStamp.replace(new RegExp(FIXTURE_CADENCE + " minutes"), "")),
     "and carries no calendar date, because the read is from today");

  /* ---------- 320px, WITH EVERY PANEL POPULATED ------------------------

     tests/regression.mjs walks this route at 320px but cannot publish a
     payload, so it has only ever measured the page's EMPTY state. Everything
     that can overflow — two SVG charts, four mover columns, five tables and
     the join panel — is drawn only when the store is full, which is exactly
     the state that suite cannot reach. Resized rather than reloaded so the
     debounced repaint is exercised too: a chart that measured its host once
     at 1280 and then scaled would fail here. */
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(400);
  const narrow = await page.evaluate(() => {
    const grid = document.getElementById("mkPulseGrid");
    const asShipped = document.documentElement.scrollWidth - window.innerWidth;
    /* THE SHIPPED STYLESHEET, MEASURED AS SHIPPED.

       This block used to override .mk-pulse-grid before measuring, because
       `repeat(auto-fit, minmax(19rem, 1fr))` put a HARD 304px track minimum
       inside a padded 320px viewport and pushed the document three pixels
       sideways. That declaration has since been relaxed to `minmax(min(19rem,
       100%), 1fr)` in assets/css/flows.css, so the override is now the
       shipped value and measuring only the overridden page would assert
       nothing: it would pass just as happily if the stylesheet regressed.
       `asShipped` is therefore the assertion, and the override is kept
       alongside it purely to prove the two now agree. */
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(min(19rem, 100%), 1fr))";
    const relaxed = document.documentElement.scrollWidth - window.innerWidth;
    grid.style.gridTemplateColumns = "";
    const vw = window.innerWidth;
    const past = (id) => {
      const n = document.getElementById(id);
      return n ? Math.round(n.getBoundingClientRect().right) - vw : null;
    };
    return {
      asShipped, relaxed,
      panels: {
        sectors: past("mktSectorPanel"),
        movers: past("mktMoversPanel"),
        against: past("mktAgainstPanel"),
      },
      chartWidths: [...document.querySelectorAll(".mk-tide-svg")]
        .map((g) => Number(g.getAttribute("width"))),
    };
  });
  ok(narrow.asShipped <= 1,
     `THE PAGE AS SHIPPED has no horizontal overflow at 320px (${narrow.asShipped}px), with ` +
     "the stylesheet exactly as it stands. tests/regression.mjs walks this route but cannot " +
     "publish a payload, so it has only ever measured the EMPTY page — two charts, four " +
     "mover columns, five tables and the join panel all draw only when the store is full");
  eq(narrow.relaxed, narrow.asShipped,
     "and relaxing the pulse grid's track minimum by hand changes nothing, because that " +
     "relaxation is now what the stylesheet ships — an override that still mattered would " +
     "mean this suite was measuring a page no reader gets");
  Object.keys(narrow.panels).forEach((k) => {
    ok(narrow.panels[k] !== null && narrow.panels[k] <= 1,
       `and the ${k} panel's own right edge is inside the viewport (${narrow.panels[k]}px past)`);
  });
  narrow.chartWidths.forEach((w) => {
    ok(w <= 320,
       `each chart REPAINTED at the narrow width (${w}) rather than being scaled down from ` +
       "the width it was first measured at — the resize handler is debounced and this " +
       "assertion runs after it");
  });

  await page.close();

  /* ---------- A REQUEST THAT NEVER CAME BACK ---------------------------

     THE DEFECT: all three optional feeds were fetched with a catch that
     returned null, and null is what the worker's {status:"pending"} envelope
     reduces to at the first branch of every painter. A 500 therefore printed
     "The pipeline has not published this key yet" — a confident claim about
     the pipeline, produced by a request that never arrived — and movers and
     pulse hid their whole section instead, leaving no sentence at all.

     Aborted at the network layer rather than mocked, so the branch under test
     is the real rejection path and not a shape this file invented. */
  {
    const failing = await browser.newPage();
    await failing.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await failing.route("**/api/flows/sectors", (route) => route.abort());
    await failing.route("**/api/flows/movers", (route) => route.abort());
    await failing.route("**/api/flows/pulse", (route) => route.abort());
    await failing.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    await failing.waitForSelector("#mktTiltPanel:not([hidden])");

    const dead = await failing.evaluate(() => {
      const read = (panelId, hostId) => {
        const panel = document.getElementById(panelId);
        const empty = document.querySelector("#" + hostId + " [data-empty]");
        return {
          hidden: panel ? panel.hidden : null,
          kind: empty ? empty.getAttribute("data-empty") : null,
          text: empty ? empty.textContent : "",
          /* The mark, computed: the kind has to be visible, not only readable. */
          bar: empty ? getComputedStyle(empty).borderLeftWidth : null,
          glyph: empty ? getComputedStyle(empty, "::before").content : null,
        };
      };
      return {
        sectors: read("mktSectorPanel", "mktSectors"),
        movers: read("mktMoversPanel", "mktMovers"),
        against: read("mktAgainstPanel", "mktAgainst"),
        pulse: read("mkPulsePanel", "mkPulseGrid"),
        charts: document.querySelectorAll(".mk-tide-svg").length,
      };
    });

    eq(dead.sectors.hidden, false, "a failed sector fetch still draws its panel");
    eq(dead.sectors.kind, "unreadable",
       "tagged UNREADABLE — a request that never came back is this page's failure to read, " +
       "and it wore the dagger of 'published without this field' until the two were told apart");
    eq(dead.sectors.bar, "3px",
       "under the 3px bar flows.css reserves for the one silence whose remedy is reload");
    ok(/×/.test(dead.sectors.glyph || ""),
       `with the cross glyph (${dead.sectors.glyph}), so the kind survives greyscale`);
    sawSilence(dead.sectors.kind, dead.sectors.text);
    ok(/did not come back/.test(dead.sectors.text),
       `and says the REQUEST failed (${dead.sectors.text})`);
    ok(!/has not published/.test(dead.sectors.text),
       "and does NOT claim the pipeline never published the key — a confident statement " +
       "about the pipeline manufactured by a request that never arrived");
    ok(/not a statement about what the payload holds/.test(dead.sectors.text),
       "stating in so many words that this is a read failure and not a reading");

    eq(dead.movers.hidden, false,
       "and the movers panel is DRAWN rather than deleted: a section that vanishes for a " +
       "reason the reader cannot see is the worst of the silences");
    eq(dead.movers.kind, "unreadable", "with the same tag");
    ok(/did not come back/.test(dead.movers.text), "and the same distinction in words");

    eq(dead.pulse.hidden, false,
       "and the whole pulse SECTION is drawn: seven feeds and two charts used to disappear " +
       "together on a failed request, with no sentence left where they had been");
    eq(dead.pulse.kind, "unreadable", "tagged as a read failure");
    ok(/did not come back/.test(dead.pulse.text),
       `naming the request rather than the pipeline (${dead.pulse.text})`);
    eq(dead.charts, 0,
       "with no chart left standing from a payload the page no longer holds — the handles " +
       "are cleared with the panel, or a resize repaints a tide that is no longer there");

    eq(dead.against.hidden, false,
       "the join panel is drawn too, because it needs the movers it could not read");
    ok(/premium extremes/.test(dead.against.text),
       `and names WHICH of its two inputs failed (${dead.against.text})`);

    await failing.close();
  }

  /* ---------- AND THE LOAD-BEARING KEY ITSELF REFUSED ------------------

     THE DEFECT: the market key kept the bare get(), so an HTTP 500 on it
     fell to the catch, which wrote "could not be loaded: HTTP 500" into the
     status line with no data-empty on it and stopped. The three regions
     the key feeds stayed hidden, and so did the four that never read it —
     sectors, the extremes, the pulse and the join were deleted by a failure
     on a key they do not need. Fulfilled with a 500 rather than aborted, so
     the branch under test is the one a real upstream error takes. */
  {
    const broken = await browser.newPage();
    await broken.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await broken.route("**/api/flows/market", (route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "upstream" }));
    await broken.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    /* Settled on the status line, which both the fixed and the old
       controller write, so the old one fails on an assertion below and not
       on a wait for a panel it never draws. */
    await broken.waitForFunction(
      () => !/Loading the session/.test(document.getElementById("mktStatus").textContent),
      null, { timeout: 15000 });

    const refused = await broken.evaluate(() => {
      const one = (sel) => {
        const e = document.querySelector(sel);
        return e ? {
          kind: e.getAttribute("data-empty"), text: e.textContent,
          bar: getComputedStyle(e).borderLeftWidth,
        } : null;
      };
      return {
        status: one("#mktStatus"),
        tilt: one("#mktTilt [data-empty]"),
        breadth: one("#mktBreadth [data-empty]"),
        tape: one("#mktTapeBody [data-empty]"),
        panels: [...document.querySelectorAll(".fc-panel")].filter((p) => !p.hidden).length,
        sectorRows: document.querySelectorAll(".mk-sector").length,
        moverNames: [...document.querySelectorAll("#mktMovers .mk-mv-t")].map((n) => n.textContent),
        charts: document.querySelectorAll(".mk-tide-svg").length,
        staleHidden: document.getElementById("mktStale").hidden,
      };
    });

    eq(refused.tilt && refused.tilt.kind, "unreadable",
       "the market key's failure is painted where the level would have been, as unreadable");
    ok(/HTTP 500/.test(refused.tilt.text),
       `carrying the status the request came back with (${refused.tilt.text})`);
    eq(refused.tilt.bar, "3px", "under the 3px bar, which no other kind wears");
    eq(refused.breadth && refused.breadth.kind, "unreadable", "the breadth region says the same");
    eq(refused.tape && refused.tape.kind, "unreadable",
       "and so does the tape, inside its own table rather than as a header over nothing");
    eq(refused.status.kind, "unreadable",
       "the status line carries the mark too, instead of the bare prose it used to hold");
    ok(/did not come back: HTTP 500/.test(refused.status.text),
       `and names the request rather than the pipeline (${refused.status.text})`);
    eq(refused.panels, 7,
       "all seven panels are drawn: four of them never read this key and paint from " +
       "their own settled payloads");
    ok(refused.sectorRows >= 4,
       `the sector list is drawn from its own payload (${refused.sectorRows} rows)`);
    ok(refused.moverNames.includes("AAA"), "the extremes are drawn from theirs");
    eq(refused.charts, 2, "and the pulse draws both its charts");
    eq(refused.staleHidden, true,
       "while no stale verdict is passed on a payload that never arrived — an age cannot " +
       "be measured on nothing");
    sawSilence(refused.tilt.kind, refused.tilt.text);

    await broken.close();
  }

  /* ---------- THE STALE BANNER, which nothing had ever written ----------

     shared/flows-pages.js has emitted `id="mktStale"` since the page shipped
     and no file in assets/js referenced it: the element was in the markup,
     the CSS rule was in the stylesheet, and the banner could not fire on any
     input. Republished last so the fresh assertions above ran against the
     fresh copy. */
  {
    await put("market", Object.assign({}, payload, { sessionDate: dayStamp(9) }));
    /* AND THE OTHER HALF OF THE RANK: a window in which no session quoted
       both legs supports NO rank, and the card has to say that rather than
       fall back to a middle. Under the presence rule a missing call leg is
       not a call premium of zero, so the share is not computable and the
       sentence is the reading. */
    await put("pulse", pulsePayload({
      readAt: new Date(Date.now() - 26 * 3600000).toISOString(),
      refreshed: "intraday",
      /* A BUCKET WITH NO NEIGHBOURS. The gap rule broke the line at a null,
         which is right; the consequence nobody had a fixture for is that a
         reading whose two neighbours are BOTH null became a lone "M x y" —
         a path that moves and never draws, so a measurement the vendor did
         send rendered as nothing at all. Refusing to invent a reading must
         not turn into losing one. */
      tide: {
        status: "ok", seen: 5, cap: 480, shed: 0,
        points: [
          { t: dayStamp(9) + "T13:30:00Z", callPrem: null, putPrem: -4.0e7 },
          { t: dayStamp(9) + "T14:00:00Z", callPrem: 1.4e8, putPrem: -5.0e7 },
          { t: dayStamp(9) + "T14:30:00Z", callPrem: null, putPrem: -6.0e7 },
          { t: dayStamp(9) + "T15:00:00Z", callPrem: 1.1e8, putPrem: -5.5e7 },
          { t: dayStamp(9) + "T15:30:00Z", callPrem: 1.2e8, putPrem: -7.0e7 },
        ],
      },
      totals: {
        status: "ok", seen: 3, cap: 20, shed: 0,
        rows: [
          { date: dayStamp(1), callPrem: null, putPrem: 8e8, callVol: 1e6, putVol: 2e6 },
          { date: dayStamp(2), callPrem: null, putPrem: 7e8, callVol: 1e6, putVol: 2e6 },
          { date: dayStamp(3), callPrem: null, putPrem: 6e8, callVol: 1e6, putVol: 2e6 },
        ],
      },
    }));

    const old = await browser.newPage();
    await old.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await old.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    await old.waitForSelector("#mktStale:not([hidden])");

    const aged = await old.evaluate(() => {
      const svg = document.querySelector(".mk-tide-svg");
      const call = svg && svg.querySelector(".mk-tide-call");
      return {
        stale: (document.getElementById("mktStale") || {}).textContent || "",
        staleKind: (document.getElementById("mktStale") || {}).dataset
          ? document.getElementById("mktStale").dataset.stale : null,
        bodyClass: document.body.className,
        stamp: (document.getElementById("mkPulseStamp") || {}).textContent || "",
        rank: (document.querySelector(".mk-pulse-rank") || {}).textContent || "",
        callD: call ? call.getAttribute("d") : null,
      };
    });

    ok(/more than four days old/.test(aged.stale),
       `a session nine days old raises the banner (${aged.stale})`);
    ok(/not advancing/.test(aged.stale),
       "and names the failure: the pipeline is running, its data is not moving. A dead " +
       "pipeline is the other failure and has the other remedy");
    ok(/is-stale/.test(aged.bodyClass), "and the page marks itself stale for the stylesheet");
    eq(aged.staleKind, "session",
       "WHICH of the two outages is stamped on the element, not only spelled in the prose: " +
       "a dead pipeline and a frozen upstream send the reader to two different people, and " +
       "a test should not have to parse a sentence to tell them apart. This is the shape " +
       "assets/js/flows-board.js has carried since the staleness test was lifted into " +
       "flows-ui.js, and the market page's own copy of that test had dropped it");
    ok(/These numbers describe the/.test(aged.stale),
       `and the sentence is flows-ui.js's sentence to the word (${aged.stale}). The first ` +
       'version of this page\'s copy said "These readings describe the … session" — six ' +
       "routes wording one outage six ways is exactly why that function was lifted out of " +
       "the renderers, and this page had quietly become the seventh");
    ok(new RegExp("describe the " + dayStamp(9) + " session").test(aged.stale),
       `and it names the session it aged (${aged.stale}). The shape gate that now stands in ` +
       "front of this parse rejects anything that is not YYYY-MM-DD, and a guard that had " +
       "bought its silence by refusing real dates too would show up here as a banner that " +
       "stopped firing on a well-formed nine-day-old session");

    /* AN ISOLATED READING IS STILL DRAWN. */
    eq((aged.callD.match(/M/g) || []).length, 2,
       `the call line has two runs (${aged.callD}): one real segment, and one lone bucket ` +
       "whose neighbours were both null");
    ok((aged.callD.match(/L/g) || []).length >= 2,
       "and BOTH runs draw. A one-sample run used to emit a bare moveto — a path that " +
       "moves and never paints — so a bucket the vendor did send disappeared from the " +
       "chart entirely. The gap rule exists to stop a missing reading being invented, not " +
       "to make a taken one vanish");
    ok(/^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M/.test(aged.callD),
       `the lone bucket is drawn as a short tick centred on it (${aged.callD}), in the ` +
       "series' own stroke and dash, far too short to be read as a segment bridging two " +
       "buckets");

    /* THE STAMP USED TO LIE TWICE on exactly this input: a bare HH:MM with no
       date, plus an unconditional "refreshes about every 15 minutes", so a
       copy read at 15:45 yesterday announced itself as a live feed. */
    ok(!/refreshes about every/.test(aged.stamp),
       `a read 26 hours old no longer claims the intraday refresh (${aged.stamp})`);
    ok(/hours ago|days ago/.test(aged.stamp), "it says how old it is instead");
    ok(/not keeping it current/.test(aged.stamp),
       "and says the refresh is not doing its job, which is the reader's actual question");
    ok(/\d/.test(aged.stamp.split("Read ")[1] || ""),
       "with the calendar date beside the clock, because the read is not from today");

    ok(/cannot be ranked against the others/.test(aged.rank),
       `a window where no session quoted both legs publishes no rank (${aged.rank})`);
    ok(!/highest of/.test(aged.rank),
       "rather than falling back to a middle position, which would be a rank computed " +
       "from a quantity that was never measured");

    await old.close();
  }

  /* ---------- A SESSION DATE THAT PARSES AND WAS NEVER PUBLISHED --------

     THE MIRROR TRUSTED A STRING NOTHING COULD READ. assessAge() reached
     `Date.parse(String(payload.sessionDate) + "T21:00:00Z")` on the strength
     of `if (payload.sessionDate)` — the TRUTHINESS OF THE KEY — and V8's
     parser is lenient enough to make that dangerous: a bare "YYYY-MM" plus
     that suffix comes back FINITE and dates the session to the first of that
     month, a day the publisher never wrote. The shape is now tested BEFORE
     the parse, against the same ISO_DAY the publisher validates on the way
     out, so a month is not a day.

     WITH A RECENT WRITE TIME THAT IS A BANNER OVER A CURRENT PAGE. The write
     branch above passes, because the pipeline ran minutes ago; the invented
     first-of-month then fails the four-day test, so the reader is told the
     upstream feed is frozen and sent to look at a pipeline that is fine. A
     staleness banner that cries wolf is the failure shared/flows-pulse.js
     names as the worst one, because it is the one readers learn to ignore.

     ONLY HALF OF THIS FIX IS OBSERVABLE HERE, AND THE OTHER HALF IS NOT
     FAKED. assessAge() also stopped answering "fresh" for a payload whose
     only date was unreadable, and answers "unknown" instead. setStale renders
     the MESSAGE and nothing else, and "unknown" and "fresh" both carry a null
     message, so the two kinds are indistinguishable in this DOM: nothing
     below tells them apart and no assertion pretends to. That half is a
     contract between assessAge() and its caller, pinned where the shared
     function lives in assets/js/flows-ui.js. This block pins the half a
     browser can see.

     THE MALFORMED DATE IS DERIVED RATHER THAN TYPED, for the same reason
     FRESH_SESSION is. A literal "2026-09" is more than four days old for most
     of a month and three days old at the start of one, so a hard-coded month
     would exercise the guard on some calendar days and prove nothing on the
     rest — the exact rot the relative dayStamp() was introduced to stop.
     Truncating a nine-day-old session to its month always lands on a
     first-of-month at least nine days back. */
  {
    const MALFORMED_SESSION = dayStamp(9).slice(0, 7);   // "YYYY-MM": a month, not a day
    const leniently = Date.parse(MALFORMED_SESSION + "T21:00:00Z");
    ok(Number.isFinite(leniently),
       `"${MALFORMED_SESSION}T21:00:00Z" still parses in this engine, to ` +
       `${new Date(leniently).toISOString()}. The whole trap is that it does: if a future ` +
       "V8 began rejecting it, this fixture would stop exercising the guard it was written " +
       "for and would go on passing");
    ok(Date.now() - leniently > 4 * 86400000,
       "and the day it invents is more than four days old, so the ungated parse reaches the " +
       "session branch rather than falling past it — a malformed date that happened to parse " +
       "to something recent would pass against the very renderer this block exists to pin");

    await put("market", Object.assign({}, payload, { sessionDate: MALFORMED_SESSION }));

    const shaped = await browser.newPage();
    await shaped.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await shaped.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    /* The tilt panel is painted after setStale in the same synchronous run,
       so waiting on it is what makes a hidden banner below mean "assessAge
       declined to raise one" rather than "the render had not happened yet". */
    await shaped.waitForSelector("#mktTiltPanel:not([hidden])");

    const bad = await shaped.evaluate(() => {
      const s = document.getElementById("mktStale");
      return {
        hidden: s ? s.hidden : null,
        text: s ? s.textContent : null,
        kind: s ? s.getAttribute("data-stale") : "no element",
        bodyClass: document.body.className,
        status: (document.getElementById("mktStatus") || {}).textContent || "",
      };
    });
    await shaped.close();

    ok(bad.status.includes(MALFORMED_SESSION),
       `the payload under test is the one on screen (${bad.status}) — a hidden banner proves ` +
       "nothing about the shape gate if the page is still showing some earlier session");
    eq(bad.hidden, true,
       `a session date of "${MALFORMED_SESSION}" raises NO banner: it is not a date the ` +
       "publisher can emit, so it dates nothing. The old mirror parsed it to the first of " +
       "that month and announced a frozen upstream over a level written minutes ago");
    eq(bad.text, "",
       "and no sentence is left in the element either — hidden text is still text, and this " +
       "one would name a session nobody published");
    eq(bad.kind, null,
       "with no data-stale kind stamped on it, so nothing reading the element rather than " +
       "the prose can take a verdict out of a payload that carried no readable date");
    ok(!/is-stale/.test(bad.bodyClass),
       `and the page does not dim itself (${bad.bodyClass || "no body class"})`);
  }

  /* ---------- THE HALF-PUBLISHED SESSION ---------------------------------

     EVERY BRANCH BELOW EXISTS BECAUSE A PAYLOAD CAN ARRIVE INCOMPLETE, and
     until this block none of them had a fixture: the suite had only ever been
     shown a payload with every field on it, so each of these branches was
     prose nobody had read and arithmetic nobody had run.

     This block is LAST on purpose. It republishes market, movers and both
     boards, and a block that rewrites the store has to run after everything
     reading the old contents — the stale block above republishes `market` and
     `pulse` for the same reason. */
  {
    await put("market", {
      v: 2, generatedAt: new Date().toISOString(), sessionDate: FRESH_SESSION, status: "ok",
      n: 140, screened: 200,
      premium: { netPositive: 5e8, netNegative: 5e8, net: 0, priced: 100, oneLegged: 3,
                 tilt: 0, topShare: 0.2 },
      /* `bear` IS ABSENT, not zero. The renderer coerced each of the three
         counts with `isNum(x) || 0`, so a count the publisher never wrote
         became a segment of width zero AND a contribution of zero to the
         denominator: the two counts that did arrive were then drawn as 100%
         of a whole this session never measured, and the bar's aria-label read
         "0 names net sold" out loud to the reader least able to check it. */
      breadth: { bull: 60, flat: 4, unpriced: 12, tilt: 0.2 },
      pcr: { volume: 0.9, premium: 0.9, quotedVolume: 100, quotedPremium: 100 },
      aggressor: { callLift: 0.5, putLift: 0.5, quoted: 100 },
      vol: { iv30dMedian: 0.3, iv30dQuoted: 100, ivRankMedian: 0.5, ivRankQuoted: 100 },
      notes: MARKET_NOTES,
    });

    /* ONE PREMIUM EXTREME, NOT BOTH — and one mover list absent while another
       is measured and empty. The join's guard used to require BOTH premium
       lists to be missing before it would say so, so this payload rendered
       "No long-board name appears in the session's largest net put premium":
       a measured-emptiness sentence about a ranking that was never taken. */
    await put("movers", {
      v: 2, status: "ok",
      fallers: [],
      premium: { bullish: [{ t: "GGG", netPrem: 4e8 }, { t: "ZZZ", netPrem: 3e8 }] },
    });

    /* A WINDOW WHERE ONLY SOME SESSIONS CAN BE RANKED, and where the newest
       TIES for the top. Both are ordinary and neither had a fixture: the rank
       sentence said "of the N sessions this feed returned" while N was the
       count that could be ranked, and it called a tied session "the most
       put-leaning session in the window". */
    await put("pulse", pulsePayload({
      /* A PAYLOAD WITH NO CADENCE — one written before the field existed.
         ABSENT IS NOT ZERO: `Number(null)` would make every read stale and
         announce a refresh "about every 0 minutes", and a fallback of 15
         would print an interval nobody published. The stamp has to withhold
         the verdict and say why. */
      cadenceMinutes: null,
      totals: {
        status: "ok", seen: 5, cap: 20, shed: 0,
        rows: [
          { date: dayStamp(1), callPrem: 6e8, putPrem: 6e8, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(2), callPrem: null, putPrem: 5e8, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(3), callPrem: 1e9, putPrem: 1e9, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(4), callPrem: null, putPrem: 4e8, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(5), callPrem: 8e8, putPrem: 2e8, callVol: 1e6, putVol: 1e6 },
        ],
      },
    }));

    /* A SECTOR PAYLOAD WITH NO PUBLISHED BAND, and one row carrying a clamp
       score with no raw reading beside it. Both branches were added with the
       sign fix and neither had a fixture: the fallback caption — the one that
       says the axis is this session's own and cannot be set beside another
       day's — was prose nobody had ever read, in the very panel whose caption
       was the last thing found to be wrong.

       The XLB row is DELIBERATELY DEFECTIVE. The publisher writes `trix` and
       `trixBp` together or writes both null; 62.5 is a value it can emit, so
       this is a payload regression rather than an impossible number, and the
       renderer is required to count it and name it as a defect rather than
       drop a sector on the floor. */
    await put("sector:trix", {
      v: 2, status: "ok", measured: 3,
      span: 15, price: "log", seriesSessions: 42, warmupSessions: 63,
      basis: "SPDR Select Sector ETFs, not GICS index levels",
      sectors: [
        { sector: "Technology", etf: "XLK", trixBp: 6.25, trix: scaleTrix(6.25) },
        { sector: "Energy", etf: "XLE", trixBp: -4.13, trix: scaleTrix(-4.13) },
        { sector: "Materials", etf: "XLB", trixBp: null, trix: 62.5 },
      ],
    });

    const half = await browser.newPage();
    await half.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await half.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    await half.waitForSelector("#mktAgainstPanel:not([hidden])");

    const part = await half.evaluate(() => {
      const col = (hostId) => [...document.querySelectorAll("#" + hostId + " .mk-movers-col")]
        .map((c) => ({
          title: ((c.querySelector(".mk-movers-h") || {}).firstChild || {}).textContent,
          kind: c.querySelector("[data-empty]")
            ? c.querySelector("[data-empty]").getAttribute("data-empty") : null,
          text: c.querySelector("[data-empty]")
            ? c.querySelector("[data-empty]").textContent : "",
          names: [...c.querySelectorAll(".mk-mv-t")].map((n) => n.textContent),
        }));
      const breadthEmpty = document.querySelector("#mktBreadth [data-empty]");
      return {
        breadth: {
          kind: breadthEmpty ? breadthEmpty.getAttribute("data-empty") : null,
          text: breadthEmpty ? breadthEmpty.textContent : "",
          segments: document.querySelectorAll("#mktBreadth .mk-seg").length,
          aria: (document.querySelector("#mktBreadth .mk-stack") || {}).getAttribute
            ? document.querySelector("#mktBreadth .mk-stack").getAttribute("aria-label") : null,
        },
        tiltNote: (document.querySelector("#mktTilt .mk-tilt-n") || {}).textContent || "",
        tiltVerdict: (document.getElementById("mktTiltNote") || {}).textContent || "",
        movers: col("mktMovers"),
        against: col("mktAgainst"),
        againstNote: (document.getElementById("mktAgainstNote") || {}).textContent || "",
        rank: (document.querySelector(".mk-pulse-rank") || {}).textContent || "",
        stamp: (document.getElementById("mkPulseStamp") || {}).textContent || "",
        sectorNote: (document.getElementById("mktSectorNote") || {}).textContent || "",
        moverPop: document.querySelector("#mktMovers > [data-empty]") ? {
          kind: document.querySelector("#mktMovers > [data-empty]").getAttribute("data-empty"),
          text: document.querySelector("#mktMovers > [data-empty]").textContent,
        } : null,
        sectorBars: [...document.querySelectorAll(".mk-sector")].map((li) => ({
          name: li.querySelector(".mk-sector-k").firstChild.textContent,
          width: (li.querySelector(".mk-bar") || {}).style
            ? li.querySelector(".mk-bar").style.width : null,
        })),
      };
    });

    /* A PART-TO-WHOLE BAR NEEDS THE WHOLE. */
    eq(part.breadth.segments, 0,
       "a breadth split missing one of its three counts draws NO segments: two parts of an " +
       "unknown whole summing to 100% is a total this session never measured");
    eq(part.breadth.kind, "unavailable",
       "and the absence is tagged as a failure to produce a reading, not as a quiet market");
    ok(/net sold/.test(part.breadth.text),
       `naming WHICH count never arrived (${part.breadth.text})`);
    eq(part.breadth.aria, null,
       'and no aria-label announces "0 names net sold" to the one reader who cannot check ' +
       "the bar against the numbers beside it");
    ok(/— sold/.test(part.tiltNote),
       `the tilt row's population reads the em dash for the count nobody published ` +
       `(${part.tiltNote}) — "0 sold" is Number(null) === 0 wearing newer syntax, and a ` +
       "session where nothing was sold must not look like a field that was never written");
    ok(!/0 sold/.test(part.tiltNote), "which is exactly what it used to print");

    /* A MEASURED ZERO IS A THIRD ANSWER. The premium tilt of this fixture is
       exactly 0 while the breadth tilt is +0.2. The disagreement test cannot
       fire — a zero has no sign to disagree with, and it correctly guarded
       itself — so the page fell through to "Both weightings agree in sign",
       a confident claim about a reading that has no sign. */
    ok(/exactly level/.test(part.tiltVerdict),
       `a weighting that came back exactly level is reported as level (${part.tiltVerdict})`);
    ok(/neither agree nor disagree/.test(part.tiltVerdict),
       "and the pair is neither agreeing nor disagreeing, which is the third sentence this " +
       "note owed and did not have");
    ok(!/agree in sign/.test(part.tiltVerdict),
       "never \"Both weightings agree in sign\", which is what it used to say about a " +
       "session where one of the two had no sign at all");

    /* THE TWO SILENCES OF A RANKED COLUMN, which shared one untagged
       "Nothing ranked." for the life of the panel. */
    const mv = (t) => part.movers.find((c) => c.title === t);
    eq(mv("Largest risers").kind, "unavailable",
       "a ranking the payload never published is UNAVAILABLE");
    ok(/never measured/.test(mv("Largest risers").text),
       "and says so rather than implying no name qualified");
    eq(mv("Largest fallers").kind, "quiet",
       "while a ranking that was taken and came back empty is QUIET — one untagged " +
       '"Nothing ranked." used to be the whole vocabulary for both');
    eq(mv("Most net put premium").kind, "unavailable",
       "and the missing premium extreme is unavailable too");
    assert.deepEqual(mv("Most net call premium").names, ["GGG", "ZZZ"],
      "while the one ranking that did arrive is drawn"); checks++;
    /* A PAYLOAD WITH NO DENOMINATOR SAYS SO. This fixture carries none of
       universe, ranked, priced or the two complements, so the population line
       under the columns is the unavailable kind rather than an em dash or
       nothing — a published payload missing a field, marked as one. */
    eq(part.moverPop && part.moverPop.kind, "unavailable",
       "the missing denominators are a marked silence under the columns");
    ok(/no count of the screened names it ranked/.test((part.moverPop || {}).text || ""),
       `naming what is missing (${(part.moverPop || {}).text})`);
    sawSilence(part.moverPop.kind, part.moverPop.text);

    /* THE JOIN, WITH ONE SIDE UNJOINABLE. */
    const ag = (t) => part.against.find((c) => c.title === t);
    eq(ag("Long board, in the largest net PUT premium").kind, "unavailable",
       "the side whose premium ranking was never published is UNAVAILABLE, not quiet: the " +
       "guard that used to cover this required BOTH lists to be missing, so a payload " +
       "carrying one of the two published a measured-emptiness sentence about a ranking " +
       "nobody took — the confident zero one level up from the arithmetic");
    ok(/never taken/.test(ag("Long board, in the largest net PUT premium").text),
       "and says the overlap was never taken rather than that it is empty");
    assert.deepEqual(ag("Short board, in the largest net CALL premium").names, ["GGG #1"],
      "while the side that could be joined is joined, with its board rank"); checks++;
    ok(/1 of 2 published board names \(2 short\)/.test(part.againstNote),
       `THE DENOMINATOR COUNTS ONLY WHAT WAS JOINED (${part.againstNote}) — the long ` +
       "board's three names were never compared with anything and cannot sit in a " +
       '"1 of 5 appear" that reads as a measurement of agreement');
    ok(/long board \(3 names\) could not be joined/.test(part.againstNote),
       "and those three names are accounted for in words rather than silently deducted");

    /* THE RANK'S DENOMINATOR IS THE COMPARABLE POPULATION, AND SAYS SO. */
    ok(/the 1st highest of the 3 sessions in this window that quoted both legs/.test(part.rank),
       `the denominator is the sessions that could be RANKED (${part.rank}), under that ` +
       'noun — "of the 20 sessions this feed returned" over a denominator of 3 is the ' +
       "right number wearing the wrong population");
    ok(/5 sessions were returned; 2 quoted only one leg and cannot be ranked/.test(part.rank),
       "with the rows it could not rank counted out loud rather than quietly deducted");
    ok(/tied for the most put-leaning/.test(part.rank),
       `a session TIED at the top does not get the superlative (${part.rank}): "the most " +
       "put-leaning session in the window" is a claim about uniqueness that two equal " +
       "shares do not support`);
    ok(/2nd largest of the 3 sessions that quoted both legs/.test(part.rank),
       "and the size rank keeps its noun — \"the 2nd largest of 3\" is three what, " +
       "measured how");

    /* A STAMP WITH NO CADENCE TO JUDGE ITSELF BY. */
    ok(/did not publish the refresh cadence/.test(part.stamp),
       `a pulse carrying no cadence says the page cannot judge the read (${part.stamp})`);
    ok(!/refreshes about every/.test(part.stamp),
       "rather than falling back to an interval nobody published");
    ok(!/0 minutes/.test(part.stamp),
       "and a read taken seconds ago does not round to \"0 minutes ago\" — a measurement " +
       "of nothing printed beside a sentence about a field that is missing");

    /* THE AXIS WITHOUT A PUBLISHED BAND, and the caveat that comes back with it. */
    ok(/no full-scale band/.test(part.sectorNote),
       `a payload with no scaling block says so (${part.sectorNote}) rather than silently ` +
       "inventing a band and drawing on it");
    ok(/never with another day/.test(part.sectorNote),
       "and the session-scaled caveat RETURNS on the session-scaled axis. It was retired " +
       "from the fixed-axis caption because it is false there; it is true here, and a " +
       "caption that dropped it on both would be wrong on one");
    eq(part.sectorBars.length, 2,
       "the row carrying a clamp score with no raw reading is not drawn — it cannot be " +
       "placed on a signed axis, and drawing it at neutral would invent a measurement");
    eq(part.sectorBars.find((r) => r.name === "Technology").width, "50%",
       "and the widest reading of the session fills the half-axis, which is what a " +
       "session-scaled axis means");
    ok(/1 sector published a clamp score with no raw reading/.test(part.sectorNote),
       `while the defective row is COUNTED and named as a payload defect (${part.sectorNote}) ` +
       "rather than silently dropped — a quietly shrinking panel is how the last two " +
       "defects on this surface stayed invisible for weeks");
    ok(!/too little history/.test(part.sectorNote),
       "and it is not filed under 'too little history', which is a statement about the " +
       "market and would hide a publisher bug behind a fact about a sector");

    await half.close();

    /* ---------- AND A JOIN WITH NO POPULATION AT ALL --------------------
       Both boards publish, neither ranks a name. "0 of 0 published board
       names appear in the opposite premium extreme" is a fraction over an
       empty set: it looks like a measurement of agreement and is a statement
       that nothing was compared. */
    await put("board:long", { v: 2, side: "long", status: "ok", sessionDate: FRESH_SESSION, rows: [] });
    await put("board:short", { v: 2, side: "short", status: "ok", sessionDate: FRESH_SESSION, rows: [] });
    await put("movers", {
      v: 2, status: "ok", risers: [], fallers: [],
      premium: { bullish: [{ t: "GGG", netPrem: 4e8 }], bearish: [{ t: "DDD", netPrem: -6e8 }] },
    });

    const bare = await browser.newPage();
    await bare.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await bare.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    await bare.waitForSelector("#mktAgainstPanel:not([hidden])");
    const none = await bare.evaluate(() => ({
      note: (document.getElementById("mktAgainstNote") || {}).textContent || "",
      kinds: [...document.querySelectorAll("#mktAgainst [data-empty]")]
        .map((n) => n.getAttribute("data-empty")),
      texts: [...document.querySelectorAll("#mktAgainst [data-empty]")]
        .map((n) => n.textContent),
    }));
    ok(/no population to state a count against/.test(none.note),
       `a join over two empty boards states that there is no population (${none.note}) ` +
       'rather than publishing "0 of 0 published board names appear", which is a ratio ' +
       "over an empty set wearing the shape of a measurement");
    ok(!/0 of 0/.test(none.note), "and the empty fraction never reaches the page");
    assert.deepEqual(none.kinds, ["quiet", "quiet"],
      "both columns are QUIET: the boards were read and ranked nobody, which is a fact " +
      "about the boards"); checks++;
    ok(none.texts.every((t) => /ranked no name this session/.test(t)),
       "and each names the board rather than claiming the overlap is empty — an empty " +
       "board has no overlap to be empty");
    await bare.close();
  }

  /* ---------- THE CADENCE IS JUDGED BY, NOT ONLY PRINTED ----------------

     Everything above proves the page QUOTES the published interval. The
     stamp's other use of it decides whether the read is still worth
     believing — "one cadence plus one cadence of slack" — and that branch
     would go on passing against a renderer holding its own 15 for as long as
     the two verdicts happened to agree.

     THIRTY MINUTES IS THE READING THAT SEPARATES THEM. Under the payload's
     twenty it is inside the slack and live; under the fifteen this file used
     to mirror it is stale by a whisker, and the page would tell a reader the
     intraday refresh had stopped keeping up while the cron was doing exactly
     what it is configured to do. That is the direction shared/flows-pulse.js
     names as the worst one: a staleness banner that cries wolf is a banner
     readers learn to ignore.

     AND THE ZERO, published rather than inferred. `Number(null)` is this
     repository's recurring defect and a cadence is where it does the most
     damage: every read stale, and a refresh schedule of "about every 0
     minutes" printed as though someone had chosen it. A cadence of zero is
     not a schedule, so it is read as the absence it is. */
  {
    const stampFor = async (body) => {
      await put("pulse", body);
      const p = await browser.newPage();
      await p.context().addCookies([{
        name: "flows_session", value: token, url: server.baseURL,
      }]);
      await p.goto(url("/flows/market/"), { waitUntil: "networkidle" });
      await p.waitForSelector("#mkPulsePanel:not([hidden])");
      const out = await p.evaluate(() => ({
        stamp: (document.getElementById("mkPulseStamp") || {}).textContent || "",
        cards: document.querySelectorAll(".mk-pulse-card").length,
      }));
      await p.close();
      return out;
    };

    const slack = await stampFor(pulsePayload({
      readAt: new Date(Date.now() - 30 * 60000).toISOString(),
    }));
    ok(!/not keeping it current/.test(slack.stamp),
       `a read thirty minutes old is INSIDE one cadence plus one cadence of slack at the ` +
       `published ${FIXTURE_CADENCE} minutes (${slack.stamp}) — at the ` +
       `${REFRESH_CADENCE_MINUTES} this renderer used to mirror, the same read would be ` +
       "called stale and the reader told the refresh had stopped keeping up");
    ok(new RegExp("refreshes about every " + FIXTURE_CADENCE + " minutes").test(slack.stamp),
       "so it still claims the intraday refresh, in the payload's own interval");

    const zeroed = await stampFor(pulsePayload({ cadenceMinutes: 0 }));
    ok(!/every 0 minutes/.test(zeroed.stamp),
       `a published zero is never quoted as a schedule (${zeroed.stamp}): "refreshes about ` +
       'every 0 minutes" is what Number(null) prints, and it reads as a decision somebody ' +
       "made rather than a field nobody wrote");
    ok(!/not keeping it current/.test(zeroed.stamp),
       "nor is it judged by — `ageMin < 0 * 2` is false for every read ever taken, so a zero " +
       "cadence marks a payload written seconds ago as stale");
    ok(/did not publish the refresh cadence/.test(zeroed.stamp),
       "it is treated as the absence it is, and the verdict is withheld in the same words a " +
       "missing field gets: a refresh every zero minutes is not a schedule");
    eq(zeroed.cards, 7,
       "and all seven feed cards are still drawn. A cadence nobody published costs this " +
       "section one sentence, not a panel — the silence is in the stamp, where the missing " +
       "field is, and nowhere else");
  }
  /* ---------- A READING THE VENDOR QUOTED -------------------------------

     THE LOCAL isNum() USED TO REFUSE A NUMERIC STRING. It read
     `typeof v === "number" && isFinite(v) ? v : null`, which is safe against
     the confident zero — Number(null) never runs — and STRICTER than the
     contract every other surface in this product holds: flows-ui.js's UI.isNum
     and shared/flows-market.js's numOrNull both coerce a quoted reading, and
     the vendor quotes several fields on the wire. The harm runs the opposite
     way from a fallback zero. A reading that WAS taken rendered as an em dash,
     which is this page's mark for "not measured", so the page published an
     absence over a measurement. assets/js/flows-panels.js carries the same
     divergence written up after it shipped: one payload field rendered as a
     value on the board and as an em dash in the card panel, for the same card,
     in the same session.

     NOTHING ABOVE HAD EVER EXERCISED THE STRING PATH. Every fixture in this
     file is a JS object literal handed to JSON.stringify, so every number
     reaches the renderer as a number and the two spellings of the helper agree
     on all of them. The type under test was the fixture author's choice and
     never the payload's, which is why widening the helper could not have
     failed a single assertion above.

     THE FIELD IS `premium.net`, chosen by reading paintTape rather than for
     convenience. It is the headline row of the tape table — "Net premium,
     signed" — its absence is VISIBLE as the em dash in a cell this suite
     already reads, and its whole path to the DOM runs through usd() and
     toneClass(), each of which calls isNum itself and formats the RESULT.
     `vol.iv30dMedian` is quoted beside it because it lands on pct(), the other
     formatter, and a helper reached from two call sites is worth proving at
     both.

     THE TWO `pcr` ROWS ARE QUOTED TOO, AND THEY ARE THE REASON THIS BLOCK
     EARNS ITS KEEP. They were the one pair in the file that tested with isNum
     and then formatted the RAW field — `isNum(pcr.volume) === null ? DASH :
     pcr.volume.toFixed(3)`. That was harmless while the helper rejected
     strings, because the test failed and the em dash printed; widening the
     helper turned it into a CRASH, since a quoted ratio now passes the test
     and calls .toFixed on a String, which has no such method. The TypeError
     escapes paintTape and takes every row after it off the page — so the
     widening would have shipped as a blank tape rather than as a fixed one.
     The renderer now formats the coerced value, like every other reading in
     that table, and these two rows are how that is held.

     THE IV ROW BELOW IS ALSO THE NO-THROW WITNESS. It is rendered after both
     pcr rows in the same pass, so if the ratios threw, the assertion on it
     could not find its row at all. That is deliberate: an assertion that a
     later row still exists is the only way a suite reading the finished DOM
     can tell "formatted correctly" from "never got there". */
  {
    await put("market", Object.assign({}, payload, {
      premium: Object.assign({}, payload.premium, { net: "-2000000000" }),
      vol: Object.assign({}, payload.vol, { iv30dMedian: "0.3412" }),
      pcr: Object.assign({}, payload.pcr, { volume: "1.25", premium: "0.875" }),
    }));

    const quoted = await browser.newPage();
    /* THE WITNESS IS THE DOM, NOT THE ERROR CHANNEL, and that is a measurement
       rather than a preference. The failure this block exists to catch is not
       a wrong string in a cell — it is a TypeError that stops the renderer
       mid-table. The obvious instrument is page.on("pageerror"), and it was
       tried here first: it collected NOTHING under the reverted renderer,
       because paintTape runs inside the fetch promise chain, so the throw
       arrives as an unhandled REJECTION and Playwright emits pageerror only
       for uncaught exceptions. A listener that stays empty through the very
       crash it was added for is worse than no listener, so it was removed and
       the table itself is asked instead.

       The wait is bounded and its failure is allowed through for the same
       reason: a panel that never unhides is a symptom, and the assertion
       under it says what actually did not render. */
    await quoted.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await quoted.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    try {
      await quoted.waitForSelector("#mktTapePanel:not([hidden])", { timeout: 8000 });
    } catch {
      /* Deliberately swallowed. A panel that never unhides is a symptom of
         the throw the next assertion names. */
    }

    const tape = await quoted.evaluate(() =>
      [...document.querySelectorAll("#mktTapeBody tr")].map((tr) => ({
        k: tr.querySelector("th").textContent,
        v: tr.querySelectorAll("td")[0].textContent,
        cls: tr.querySelectorAll("td")[0].className,
        n: tr.querySelectorAll("td")[1].textContent,
      })));
    await quoted.close();

    /* THE WHOLE TABLE, asserted before anything in it is read. paintTape
       builds all seven rows — an unconditional list, no payload field adds or
       drops one — before it appends any of them, so a throw while building
       costs the entire table and leaves panel.hidden set: under the reverted
       renderer `tape` is empty, and without this line that surfaces as
       "Cannot read properties of undefined" pointing at this suite instead of
       at the page. The count is exact rather than a floor, because a row list
       that silently loses an entry is the other failure this catches. */
    eq(tape.length, 7,
       `the tape rendered all seven of its rows (${tape.length}) on a payload whose numbers ` +
       "arrived as strings. This is the no-throw witness: the two ratio rows formatted the " +
       "RAW payload field after testing it with the helper, so widening the helper sent a " +
       "quoted ratio into String.prototype.toFixed — and since the list is built before a " +
       "single row is appended, the TypeError cost the whole table, not its tail");

    const netRow = tape.find((r) => /^Net premium/.test(r.k));
    eq(netRow.v, "−$2.00B",
       `a net premium quoted on the wire as "-2000000000" renders as the sum it is ` +
       `(${netRow.v}). Under the stricter helper this cell printed an em dash — the page's ` +
       "own mark for a reading nobody took — over two billion dollars that were measured");
    ok(/fb-neg/.test(netRow.cls),
       `and the quoted reading keeps its sign in the DOM as well as in the glyph ` +
       `(${netRow.cls}): usd() and toneClass() call the helper separately, so one that ` +
       "half-admitted a string could print the dollars and lose the tone qualifying them");
    eq(netRow.n, "180",
       "with the population column beside it unmoved, because it arrived as a number all " +
       "along and widening the helper must not disturb what already worked");

    const volRow = tape.find((r) => /^Put contracts per call/.test(r.k));
    eq(volRow.v, "1.250",
       `a put/call ratio quoted as "1.25" renders to three places (${volRow.v}). This row ` +
       "tested the value with the helper and then formatted the RAW field, so widening the " +
       "helper made a quoted ratio reach String.prototype.toFixed — a TypeError, not an em " +
       "dash. It formats the coerced value now");
    const premRow = tape.find((r) => /^Put premium per call/.test(r.k));
    eq(premRow.v, "0.875",
       `and its premium twin the same (${premRow.v}), because the pair was written once and ` +
       "copied, which is how one of them being fixed and the other not would look normal");

    const ivRow = tape.find((r) => /implied vol/i.test(r.k));
    ok(ivRow, "the tape still has rows BELOW the two ratios — the no-throw witness. A " +
       "TypeError inside paintTape would leave this row unbuilt, and every assertion above " +
       "it could still pass on the rows that were appended before the throw");
    eq(ivRow.v, "34.1%",
       `a quoted "0.3412" reaches pct() and renders as ${ivRow.v} — the same reading the ` +
       "unquoted fixture above prints. The helper is reached from more than one formatter, " +
       "and admitting a string at one of them would not be the fix");
  }

  /* ---------- THE MEASURED ZERO, ON THE THREE FIELDS THAT DROPPED IT ------

     Everything above this line is drawn from a busy session, which is exactly
     the payload under which a falsy-zero guard behaves perfectly. isNum
     RETURNS the reading rather than a boolean, so `!isNum(x)` and `isNum(x) ?`
     read a measured 0 as an absence — and this page publishes three counts
     that can legitimately come back 0: a ladder that admitted nobody, a
     screener that returned nothing, and a session in which no name moved.

     THE FIRST ONE COST THE WHOLE PAGE. `!isNum(m.n)` gated the branch that
     draws every panel, so `status: "ok", n: 0` fell through to "No session has
     been measured yet" — a claim about the pipeline, made about a run that
     completed. Not one assertion above could catch it: every fixture up to
     here has n = 200, and the sentence the reader gets is the same sentence
     the genuinely-unpublished store gets. */
  {
    const empty = {
      netPositive: 0, netNegative: 0, net: 0, priced: 0, oneLegged: 0, tilt: 0, topShare: 0,
    };
    await put("market", Object.assign({}, payload, {
      n: 0, screened: 0,
      premium: empty,
      breadth: { bull: 0, bear: 0, flat: 0, unpriced: 0, tilt: 0 },
      pcr: { volume: null, premium: null, quotedVolume: 0, quotedPremium: 0 },
      aggressor: { callAsk: 0, callBid: 0, putAsk: 0, putBid: 0, callLift: null, putLift: null, quoted: 0 },
      vol: { iv30dMedian: null, iv30dQuoted: 0, ivRankMedian: null, ivRankQuoted: 0 },
    }));

    const zero = await browser.newPage();
    await zero.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await zero.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    /* THE PANEL IS THE WITNESS, NOT THE SENTENCE. paintTape clears
       panel.hidden as its last act and is only ever reached past the guard, so
       an unhidden tape panel is proof the payload was rendered rather than
       explained away. The wait is bounded and its failure is swallowed for the
       same reason the quoted block above swallows its own: a panel that never
       unhides is the symptom, and the assertion under it says what did not
       render. */
    try {
      await zero.waitForSelector("#mktTapePanel:not([hidden])", { timeout: 8000 });
    } catch { /* deliberately swallowed — the assertions below report it */ }
    const drawn = await zero.evaluate(() => ({
      status: (document.getElementById("mktStatus") || {}).textContent || "",
      panels: [...document.querySelectorAll(".fc-panel")].filter((p) => !p.hidden).length,
      tape: !(document.getElementById("mktTapePanel") || {}).hidden,
    }));
    await zero.close();

    ok(drawn.tape,
       "a session that screened zero names still DRAWS: `status: \"ok\", n: 0` is a ladder " +
       "that admitted nobody, and the guard read `!isNum(m.n)` — isNum returns the reading, " +
       "0 is falsy, so the whole page took the never-published branch");
    ok(drawn.panels > 0,
       `with panels on the page (${drawn.panels}) rather than none — the pending branch ` +
       "draws no tilt, breadth, tape, sector, mover, pulse or against panel at all");
    ok(!/no session has been measured yet/i.test(drawn.status),
       `and the reader is not told the pipeline has never run (${drawn.status}). That ` +
       "sentence is a claim about the STORE, and here the store had been written to");
    ok(/^0 screened names of 0 returned by the ladder/.test(drawn.status),
       `the status line keeps its denominator on a measured zero (${drawn.status}). It read ` +
       "`isNum(m.screened) ? … : \"\"`, so `screened: 0` dropped the clause entirely and left " +
       "no way to tell a ladder that returned nothing from a payload that never published " +
       "the field — the two silences this page spends its prose separating");
  }

  /* ---------- A BLANK IS NOT A READING -------------------------------------

     The widened helper excluded only the literal "", and Number() is generous
     in exactly the directions that manufacture a measurement: Number(" ") is
     0, Number(false) is 0, Number([]) is 0. So a field the vendor sent as a
     space rendered "$0" — a sum this page states as measured, invented out of
     whitespace, and the one error mode worse than the em dash it replaced.

     BOTH FORMATTERS ARE ASKED, for the same reason the quoted block above asks
     both: usd() and pct() call the helper separately, and a fix applied at one
     of them would not be one. */
  {
    await put("market", Object.assign({}, payload, {
      premium: Object.assign({}, payload.premium, { net: " " }),
      vol: Object.assign({}, payload.vol, { iv30dMedian: false }),
      /* QUOTED WITH THE VENDOR'S OWN WHITESPACE, which is the reading that
         tells a coerced value apart from a raw one. The breadth note tested
         `isNum(b.unpriced)` and then concatenated `b.unpriced`, so the string
         the vendor sent reached the sentence with its padding intact. */
      breadth: Object.assign({}, payload.breadth, { unpriced: "20 " }),
    }));

    const blank = await browser.newPage();
    await blank.context().addCookies([{
      name: "flows_session", value: token, url: server.baseURL,
    }]);
    await blank.goto(url("/flows/market/"), { waitUntil: "networkidle" });
    await blank.waitForSelector("#mktTapePanel:not([hidden])");
    const { tape, note } = await blank.evaluate(() => ({
      tape: [...document.querySelectorAll("#mktTapeBody tr")].map((tr) => ({
        k: tr.querySelector("th").textContent,
        v: tr.querySelectorAll("td")[0].textContent,
        cls: tr.querySelectorAll("td")[0].className,
      })),
      note: (document.getElementById("mktBreadthNote") || {}).textContent || "",
    }));
    await blank.close();

    const netRow = tape.find((r) => /^Net premium/.test(r.k));
    eq(netRow.v, "—",
       `a net premium sent as a single space prints the em dash (${netRow.v}) — the mark ` +
       'this page keeps for a reading nobody took. Number(" ") is 0, and the guard excluded ' +
       'only the literal "", so the cell read "$0": not a missing number rendered wrongly ' +
       "but a measured sum invented out of whitespace");
    eq(netRow.cls.trim(), "c-num",
       `and it carries no tone class (${netRow.cls}) — toneClass() calls the helper too, so ` +
       "a blank that coerced to 0 would also have painted the cell as neither-way LEVEL, " +
       "which is a third claim about a session nobody measured");
    const ivRow = tape.find((r) => /implied vol/i.test(r.k));
    eq(ivRow.v, "—",
       `and a boolean prints the em dash rather than a measured 0.0% (${ivRow.v}). ` +
       "Number(false) is 0 and false is neither null nor undefined nor \"\", so the old " +
       "guard passed it straight into the coercion");

    ok(/\b20 of 200 screened names quoted no usable\b/.test(note),
       `the breadth note prints the COERCED count (${note.slice(0, 120)}…). It tested ` +
       "`isNum(b.unpriced) !== null` and then concatenated the RAW field, so a count the " +
       "vendor quoted as \"20 \" reached the sentence carrying the vendor's whitespace — " +
       "the same guarded-then-raw shape that sent a quoted ratio into String.prototype." +
       "toFixed two rows up, one string concatenation away from being a crash instead of " +
       "a typo");
  }

  /* ---------- THE FOUR SILENCES, TOLD APART ----------------------------- */
  assert.deepEqual([...seenSilences.keys()].sort(), ["pending", "quiet", "unavailable", "unreadable"],
    "the scenarios above, taken together, met all four kinds of silence — an unpublished " +
    "key, a request that never came back, a published payload missing a field, and a " +
    "reading taken and found empty — each under its own data-empty"); checks++;
  eq(new Set(seenSilences.values()).size, seenSilences.size,
     "and no two kinds were printed under the same sentence");
} finally {
  await browser.close();
  await server.stop();
}

console.log(`✓ flows-market: ${checks} assertions — a level the board neutralises away by design, net premium measured only where both legs were quoted, ratios of sums over one population, an IV rank that is a fraction on both sides of the wire, sector momentum drawn from the RAW signed reading on the payload's own published band with a measured zero printed unsigned and unclassed, a failed request told apart from an unpublished key and from a quiet one, twenty sessions of totals turned into a rank with its denominator, the boards read against the session's premium extremes, a stale banner that can finally fire carrying WHICH outage it found, no line bridged across a bucket the vendor never sent and none dropped either, a part-to-whole bar refused when one of its parts was never published, a rank whose denominator is the sessions that could be ranked and says so, a superlative withheld from a tie, a session date that parses but names no day refused before it can date anything, a reading the vendor quoted rendered as the number it is rather than as the em dash this page keeps for a reading nobody took, two ratios that formatted the coerced value rather than the raw one and a row below them proving nothing threw on the way, a ladder that admitted nobody rendered as the session it is rather than as a pipeline that never ran, a screened count of zero that keeps the denominator telling it apart from an unpublished field, a blank string and a boolean refused before the coercion that would have made either a measured zero, and every chart asserted at its DRAWN size rather than its declared one`);
