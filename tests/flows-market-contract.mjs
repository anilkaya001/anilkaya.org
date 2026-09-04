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
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";
import { marketAggregate, MARKET_NOTES } from "../shared/flows-market.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

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
    const panels = await page.evaluate(() =>
      [...document.querySelectorAll(".fc-panel")].filter((p) => !p.hidden).length);
    eq(panels, 0, "with no panel drawn at all, rather than panels full of zeroes");
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
  await put("movers", {
    v: 2, status: "ok",
    risers: [{ t: "AAA", chg: 0.081, netPrem: 1e7 }],
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
  const pulsePayload = (over) => Object.assign({
    v: 2, generatedAt: new Date().toISOString(), sessionDate: FRESH_SESSION,
    readAt: new Date().toISOString(), refreshed: "intraday",
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
        { t: "AAA", cp: "C", k: 150, exp: "2026-09-18", change: 0, currOi: 12000, vol: 3400 },
        { t: "BBB", cp: "P", k: 80, exp: "2026-10-16", change: -2500, currOi: 9000, vol: 1200 },
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
      par: g.getAttribute("preserveAspectRatio"),
      hostWidth: Math.round(g.parentNode.clientWidth),
      callD: (g.querySelector(".mk-tide-call") || {}).getAttribute
        ? g.querySelector(".mk-tide-call").getAttribute("d") : null,
      putD: g.querySelector(".mk-tide-put")
        ? g.querySelector(".mk-tide-put").getAttribute("d") : null,
      labels: [...g.querySelectorAll(".mk-tide-lab")].map((t) => t.textContent),
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
      sectors: [...document.querySelectorAll(".mk-sector-k")].map((n) => n.textContent),
      /* THE WHOLE SECTOR ROW, not just its name: the defect this suite missed
         lived entirely in the bar's placement and the value's sign. */
      sectorRows: [...document.querySelectorAll(".mk-sector")].map((li) => {
        const bar = li.querySelector(".mk-bar");
        return {
          name: (li.querySelector(".mk-sector-k") || {}).textContent,
          value: (li.querySelector(".mk-sector-v") || {}).textContent,
          cls: bar ? bar.className : null,
          width: bar ? bar.style.width : null,
          left: bar ? bar.style.left : null,
          aria: (li.querySelector(".mk-track") || {}).getAttribute
            ? li.querySelector(".mk-track").getAttribute("aria-label") : null,
        };
      }),
      sectorNote: txt("#mktSectorNote"),
      movers: [...document.querySelectorAll("#mktMovers .mk-mv-t")].map((n) => n.textContent),
      moverLinks: document.querySelectorAll("#mktMovers a").length,
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

  /* A SECTOR WITH NO SETTLED READING IS OMITTED, NEVER DRAWN AT ZERO. */
  ok(!read.sectors.includes("Real Estate"),
     "a sector whose TRIX could not settle is left out rather than drawn as a flat bar at zero, " +
     "which would read as measured neutrality");
  ok(/1 sector/.test(read.sectorNote) && /omitted/i.test(read.sectorNote),
     "and its absence is counted in the note, so the omission is visible");
  assert.deepEqual(read.sectors, ["Technology", "Financials", "Energy", "Utilities"],
    "the settled sectors are ranked by the RAW reading, high to low. Ranking on `trix` " +
    "instead ties every saturated sector at 100 and then orders them arbitrarily"); checks++;

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
    eq(String(vbWidth), g.width,
       `chart ${i}: the width attribute equals the viewBox width, so one viewBox unit is ` +
       "one CSS pixel and nothing is scaled");
    eq(g.par, "xMidYMid meet", `chart ${i}: preserveAspectRatio is explicit`);
    ok(Math.abs(vbWidth - g.hostWidth) <= 1,
       `chart ${i}: the width was measured from a VISIBLE host (${vbWidth} vs ${g.hostWidth}) — ` +
       "a hidden element reports clientWidth 0 and the chart silently falls back");
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
  ok(/refreshes about every 15 minutes/.test(read.pulseStamp),
     `a read inside one cadence may claim the intraday refresh (${read.pulseStamp})`);
  ok(!/\d{4}/.test(read.pulseStamp.replace(/15 minutes/, "")),
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
    /* ONE DECLARATION ISOLATED, RATHER THAN A TOLERANCE.

       assets/css/flows.css gives .mk-pulse-grid `repeat(auto-fit,
       minmax(19rem, 1fr))`. 19rem is 304px and it is a HARD minimum, so on a
       320px phone the track is wider than the padded container and the grid
       pushes the document three pixels past the viewport. The rule's own
       comment says "on a phone every card is one column and nothing can
       overflow sideways", which is true of the column count and false of the
       track width. The fix is `minmax(min(19rem, 100%), 1fr)` and it lives in
       a stylesheet this renderer does not own, so the measurement below
       applies it and then asserts the REST of the page is at zero — a
       tolerance of "3px is fine" would quietly absorb the next regression,
       and this cannot. */
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
  ok(narrow.relaxed <= 1,
     `with the pulse grid's track minimum relaxed, the fully populated page has no ` +
     `horizontal overflow at 320px (${narrow.relaxed}px). tests/regression.mjs walks this ` +
     "route but cannot publish a payload, so it has only ever measured the EMPTY page — " +
     "two charts, four mover columns, five tables and the join panel all draw only when " +
     "the store is full");
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
        };
      };
      return {
        sectors: read("mktSectorPanel", "mktSectors"),
        movers: read("mktMoversPanel", "mktMovers"),
        against: read("mktAgainstPanel", "mktAgainst"),
      };
    });

    eq(dead.sectors.hidden, false, "a failed sector fetch still draws its panel");
    eq(dead.sectors.kind, "unavailable", "tagged as a failure to produce a reading");
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
    eq(dead.movers.kind, "unavailable", "with the same tag");
    ok(/did not come back/.test(dead.movers.text), "and the same distinction in words");

    eq(dead.against.hidden, false,
       "the join panel is drawn too, because it needs the movers it could not read");
    ok(/premium extremes/.test(dead.against.text),
       `and names WHICH of its two inputs failed (${dead.against.text})`);

    await failing.close();
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

    const aged = await old.evaluate(() => ({
      stale: (document.getElementById("mktStale") || {}).textContent || "",
      bodyClass: document.body.className,
      stamp: (document.getElementById("mkPulseStamp") || {}).textContent || "",
      rank: (document.querySelector(".mk-pulse-rank") || {}).textContent || "",
    }));

    ok(/more than four days old/.test(aged.stale),
       `a session nine days old raises the banner (${aged.stale})`);
    ok(/not advancing/.test(aged.stale),
       "and names the failure: the pipeline is running, its data is not moving. A dead " +
       "pipeline is the other failure and has the other remedy");
    ok(/is-stale/.test(aged.bodyClass), "and the page marks itself stale for the stylesheet");

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
} finally {
  await browser.close();
  await server.stop();
}

console.log(`✓ flows-market: ${checks} assertions — a level the board neutralises away by design, net premium measured only where both legs were quoted, ratios of sums over one population, an IV rank that is a fraction on both sides of the wire, sector momentum drawn from the RAW signed reading on the payload's own published band with a measured zero printed unsigned and unclassed, a failed request told apart from an unpublished key and from a quiet one, twenty sessions of totals turned into a rank with its denominator, the boards read against the session's premium extremes, a stale banner that can finally fire, and no line bridged across a bucket the vendor never sent`);
