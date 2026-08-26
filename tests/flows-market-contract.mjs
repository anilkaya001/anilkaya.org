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
  const payload = {
    v: 2, generatedAt: new Date().toISOString(), sessionDate: "2026-08-25", status: "ok",
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

  await put("sector:trix", {
    v: 2, status: "ok", rows: [
      { sector: "Technology", etf: "XLK", trix: 12.5 },
      { sector: "Energy", etf: "XLE", trix: -8.25 },
      { sector: "Real Estate", etf: "XLRE", trix: null, reason: "not enough history" },
    ],
  });
  await put("movers", {
    v: 2, status: "ok",
    risers: [{ t: "AAA", chg: 0.081, netPrem: 1e7 }],
    fallers: [{ t: "BBB", chg: -0.064, netPrem: -2e7 }],
    premium: { bullish: [{ t: "CCC", netPrem: 5e8 }], bearish: [{ t: "DDD", netPrem: -6e8 }] },
  });

  const page = await browser.newPage();
  await page.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
  await page.goto(url("/flows/market/"), { waitUntil: "networkidle" });
  await page.waitForSelector("#mktTiltPanel:not([hidden])");

  const read = await page.evaluate(() => {
    const txt = (sel) => (document.querySelector(sel) || {}).textContent || "";
    const bars = [...document.querySelectorAll("#mktTilt .mk-bar")].map((b) => ({
      cls: b.className, width: b.style.width, left: b.style.left,
    }));
    return {
      status: txt("#mktStatus"),
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
      sectorNote: txt("#mktSectorNote"),
      movers: [...document.querySelectorAll(".mk-mv-t")].map((n) => n.textContent),
      moverLinks: document.querySelectorAll("#mktMovers a").length,
      stackTotal: [...document.querySelectorAll(".mk-seg")]
        .reduce((s, i) => s + parseFloat(i.style.width || "0"), 0),
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

  /* A SECTOR WITH NO SETTLED READING IS OMITTED, NEVER DRAWN AT ZERO. */
  ok(!read.sectors.includes("Real Estate"),
     "a sector whose TRIX could not settle is left out rather than drawn as a flat bar at zero, " +
     "which would read as measured neutrality");
  ok(/1 sector/.test(read.sectorNote) && /omitted/i.test(read.sectorNote),
     "and its absence is counted in the note, so the omission is visible");
  assert.deepEqual(read.sectors, ["Technology", "Energy"],
    "the settled sectors are ranked by reading"); checks++;

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

  await page.close();
} finally {
  await browser.close();
  await server.stop();
}

console.log(`✓ flows-market: ${checks} assertions — a level the board neutralises away by design, net premium measured only where both legs were quoted, ratios of sums over one population, an IV rank that is a fraction on both sides of the wire, sign carried by position on a fixed axis, concentration published beside the total it qualifies, and a sector that could not settle omitted rather than drawn at zero`);
