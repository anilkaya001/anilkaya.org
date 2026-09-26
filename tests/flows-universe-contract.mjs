import assert from "node:assert/strict";
import {
  capBands, selectCoverage, NDX_100, NDX_AS_OF, SELECTION_EPOCH,
  PICK_SIZE, PICK_INDEX, UNIVERSE_NOTES,
} from "../shared/flows-universe.js";
import { deepNames, DEEP_NAMES, SCREENER_PAGE_ROWS } from "../scripts/flows-pipeline.mjs";
import {
  ndxConstantAge, NDX_STALE_DAYS, priorLedger, retirePlan, buildRoster, RETIRE_AFTER_SESSIONS, ROSTER_DEPTHS,
  ROSTER_BUDGET_BYTES, tradingSessionsBetween, cardDepthOf,
} from "../shared/flows-universe.js";
import {
  FOCUS_METALS, MAG7, FOCUS_FUNDS, FOCUS_MINERS, ndx10, ndxMembership, focusTickers, focusGroups, focusDeepSet,
  focusRow, focusCloses, buildFocusPayload, FOCUS_FIELDS, FOCUS_BUDGET_BYTES, SHARE_CLASS,
} from "../shared/flows-focus.js";
import { MAG7 as REGIME_MAG7 } from "../shared/flows-regime.js";
import { STRIP_FIELDS } from "../shared/flows-live.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

{
  const bands = capBands({ min: 1e9, max: 4e12, ratio: 1.3 });
  ok(bands.length > 25,
     `the ladder is ${bands.length} bands, not the six it replaces — and the band count IS ` +
     "the pagination, because the vendor caps every band at ~50 rows and offers no page parameter");

  for (let i = 1; i < bands.length; i++) {
    eq(bands[i][0], bands[i - 1][1],
       `band ${i} starts exactly where band ${i - 1} ends — no gap, no overlap`);
  }
  eq(bands[0][0], 1e9, "the ladder starts at the universe floor");
  eq(bands[bands.length - 1][1], null,
     "and the top band is UNBOUNDED, so the largest companies are never above the ladder");
  ok(bands.slice(0, -1).every(([lo, hi]) => hi > lo),
     "every bounded band is non-empty");

  for (let i = 1; i < bands.length - 1; i++) {
    const r = bands[i][1] / bands[i][0];
    ok(Math.abs(r - 1.3) < 1e-9, `band ${i} has the stated ratio, not an arbitrary width`);
  }

  eq(capBands({ min: 0 }).length, 0, "a nonsense floor yields no ladder rather than an infinite one");
  eq(capBands({ ratio: 1 }).length, 0, "and a ratio of 1 would never terminate, so it yields none");
  ok(SCREENER_PAGE_ROWS === 50,
     "the page cap the ladder is sized against is named, not repeated as a literal");
}

{
  const uni = [];
  for (let i = 0; i < 300; i++) {
    uni.push({ ticker: `T${String(i).padStart(3, "0")}`, marketcap: (300 - i) * 1e9 });
  }

  uni.push({ ticker: "SMALLNDX", marketcap: 1.1e9 });
  uni.push({ ticker: "TINYNDX", marketcap: 1.05e9 });

  const picked = selectCoverage(uni, { count: 100, guaranteed: ["SMALLNDX", "TINYNDX"] });
  eq(picked.length, 102, "the pool is the size cohort PLUS the guaranteed names, not capped at the count");

  const bySize = picked.filter((p) => p.why === PICK_SIZE);
  eq(bySize.length, 100, "exactly `count` names are chosen on size");
  eq(bySize[0].row.ticker, "T000", "the largest name is in");

  const added = picked.filter((p) => p.why === PICK_INDEX).map((p) => p.row.ticker).sort();
  assert.deepEqual(added, ["SMALLNDX", "TINYNDX"],
    "a guaranteed name far below the size cohort is ADDED"); checks++;
  ok(picked.some((p) => p.row.ticker === "T099"),
     "and no size-cohort name was displaced to make room for it");

  const absent = selectCoverage(uni, { count: 5, guaranteed: ["NOT_LISTED_ANYWHERE"] });
  ok(!absent.some((p) => p.row.ticker === "NOT_LISTED_ANYWHERE"),
     "a guaranteed ticker absent from the universe is not invented — the pool is a SUBSET of what was screened");

  const tied = [
    { ticker: "BBB", marketcap: 5e9 }, { ticker: "AAA", marketcap: 5e9 },
    { ticker: "CCC", marketcap: 5e9 },
  ];
  const once = selectCoverage(tied, { count: 2, guaranteed: [] }).map((p) => p.row.ticker);
  const twice = selectCoverage([...tied].reverse(), { count: 2, guaranteed: [] }).map((p) => p.row.ticker);
  assert.deepEqual(once, ["AAA", "BBB"], "ties break on ticker, ascending"); checks++;
  assert.deepEqual(once, twice,
    "and the pool does not depend on the order the vendor happened to return rows in"); checks++;

  const noCap = selectCoverage(
    [{ ticker: "GOOD", marketcap: 2e9 }, { ticker: "NOCAP" }, { ticker: "JUNK", marketcap: "x" }],
    { count: 1, guaranteed: [] });
  eq(noCap[0].row.ticker, "GOOD",
     "a row with no usable market cap sorts BELOW a measured one rather than above it");

  const zeroVsAbsent = selectCoverage(
    [{ ticker: "ZERO", marketcap: 0 }, { ticker: "ABSENT" }],
    { count: 1, guaranteed: [] });
  eq(zeroVsAbsent.length, 1, "the cap is respected");
  eq(zeroVsAbsent[0].row.ticker, "ZERO",
     "a cap the vendor MEASURED as zero outranks one it never reported — absent is not a value");

  eq(selectCoverage(null).length, 0, "no universe yields no pool rather than a throw");
  ok(selectCoverage([{ marketcap: 1e9 }], { guaranteed: [] }).length === 0,
     "a row with no ticker is not a name");
}

{
  ok(NDX_100.length >= 100, `the guarantee list carries ${NDX_100.length} names`);
  eq(new Set(NDX_100).size, NDX_100.length, "with no duplicates");
  ok(NDX_100.every((t) => /^[A-Z.]{1,6}$/.test(t)), "every entry looks like a ticker");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(NDX_AS_OF),
     "and the list carries the DATE it was written, because index membership is a choice this key cannot measure");
  ok(NDX_100.includes("GOOG") && NDX_100.includes("GOOGL"),
     "both share classes are listed — collapseShareClasses is what resolves them, downstream and once");
  ok(UNIVERSE_NOTES.index.includes(NDX_AS_OF),
     "the published note names the same date the constant does, so the page cannot claim a freshness the code does not have");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(SELECTION_EPOCH), "the selection epoch is a date");
  ok(UNIVERSE_NOTES.rule.length > 80 && UNIVERSE_NOTES.epoch.includes(SELECTION_EPOCH),
     "and the rule and the epoch are published in words, not left for a reader to infer from the row count");
}

{
  const published = {
    long: [{ t: "AA", s: 91 }, { t: "BB", s: 12 }, { t: "CC", s: 4 }],
    short: [{ t: "XX", s: -95 }, { t: "YY", s: -40 }, { t: "ZZ", s: -2 }],
  };
  const deep = deepNames(published, 3).map((d) => d.t);

  assert.deepEqual(deep, ["XX", "AA", "YY"],
    "the deep names are the strongest |score| across BOTH boards"); checks++;

  const sides = deepNames(published, 3).map((d) => d.side);
  assert.deepEqual(sides, ["short", "long", "short"],
    "and each carries the side it was published on, so the card leg does not have to look it up again"); checks++;

  eq(deepNames(published, 0).length, 0, "a zero budget spends nothing");
  eq(deepNames(published, 99).length, 6, "a budget larger than the board takes the whole board");
  eq(deepNames({}, 5).length, 0, "no board, no deep names");
  eq(deepNames({ long: [{ t: "NS" }] }, 5)[0].t, "NS",
     "a row with no score still resolves rather than throwing");
  ok(deepNames({ long: [{ t: "NS" }, { t: "HAS", s: 1 }] }, 1)[0].t === "HAS",
     "and it sorts BELOW a scored row — an unscored name is not the furthest from neutral");
  ok(DEEP_NAMES > 0 && DEEP_NAMES <= 60,
     `the deep budget (${DEEP_NAMES}) is bounded: it is multiplied by three vendor calls a name`);
}

{
  const everywhere = [...FOCUS_METALS.flatMap((g) => g.tickers), ...MAG7, ...FOCUS_FUNDS, ...FOCUS_MINERS];
  ok(!everywhere.includes("HG"), "HG is Hamilton Insurance, never copper: no focus list names it");
  assert.deepEqual([...MAG7], [...REGIME_MAG7], "the focus Mag 7 is the same list the regime's mag7 group sums"); checks++;
  for (const g of FOCUS_METALS) ok(g.tickers.includes(g.lead), `${g.id}: its lead ticker is one of its rows`);
  ok(FOCUS_MINERS.every((t) => !FOCUS_FUNDS.includes(t)), "no miner is a fund, so no fund reaches the market-cap coverage path");
  const metalFunds = FOCUS_METALS.flatMap((g) => g.tickers).filter((t) => !FOCUS_MINERS.includes(t));
  ok(metalFunds.every((t) => FOCUS_FUNDS.includes(t)),
     "every metal-group ticker that is not a miner is a focus fund, so each one gets a fund dossier");
  eq(SHARE_CLASS.GOOG, "GOOGL", "GOOG collapses onto GOOGL");
}

{
  const holding = (ticker, weight, over = {}) => ({ ticker, weight: weight === null ? null : String(weight), type: "stock",
    updated: "2026-09-22", etf: "QQQ", ...over });
  const top = [["NVDA", 8.9], ["MSFT", 8.1], ["AAPL", 7.6], ["AMZN", 5.2], ["AVGO", 5.0], ["META", 3.4], ["GOOGL", 2.9],
    ["GOOG", 2.7], ["TSLA", 2.6], ["NFLX", 2.4], ["COST", 2.3], ["PLTR", 2.0], ["AMD", 1.8]];
  const tail = Array.from({ length: 90 }, (_, i) => [`T${String(i).padStart(2, "0")}`, 0.3 - i * 0.002]);
  const rows = [...top, ...tail].map(([t, w]) => holding(t, w))
    .concat([holding("CASHUSD", 0.4, { type: "cash" }), holding("ZERO", 0), holding("NOWT", null)]);
  const n = ndx10(rows, [], { fallback: NDX_100 });
  assert.deepEqual(n.tickers, ["NVDA", "MSFT", "AAPL", "AMZN", "AVGO", "META", "GOOGL", "TSLA", "NFLX", "COST"],
    "the NDX 10 is the ten largest DISTINCT companies by QQQ weight — GOOG and GOOGL are one company, so COST is tenth"); checks++;
  eq(n.source, "qqq-holdings:2026-09-22", "and its source names the holdings and their own update stamp");
  ok(!n.tickers.includes("CASHUSD") && !n.tickers.includes("ZERO"), "only stock rows with a positive weight count");

  const flipped = rows.map((r) => (r.ticker === "GOOG" ? { ...r, weight: "3.5" } : r));
  const f = ndx10(flipped, [], { fallback: NDX_100 });
  ok(f.tickers.includes("GOOGL") && !f.tickers.includes("GOOG"),
     "when GOOG outweighs GOOGL the company is still one row and it is displayed as GOOGL");
  eq(f.tickers.indexOf("GOOGL"), 5, "ranked at the heavier class's weight (3.5), above META");

  const universe = NDX_100.map((t, i) => ({ ticker: t, marketcap: t === "GOOG" ? 9e14 : (200 - i) * 1e10 }));
  const failed = ndx10(null, universe, { fallback: NDX_100 });
  ok(failed.source.startsWith("fallback:holdings-unread"), `a failed read falls back and says so (${failed.source})`);
  eq(failed.tickers.length, 10, "the fallback still names ten");
  eq(failed.tickers[0], "GOOGL", "ranked by the universe's market cap, share classes collapsed onto GOOGL");
  ok(!failed.tickers.includes("GOOG"), "and never both classes");
  const payloadForm = ndx10(null, { t: ["MSFT", "NVDA", "AAPL", "AMZN", "GOOG", "GOOGL", "META", "AVGO", "TSLA", "COST", "NFLX"] },
    { fallback: NDX_100 });
  assert.deepEqual(payloadForm.tickers.slice(0, 5), ["MSFT", "NVDA", "AAPL", "AMZN", "GOOGL"],
    "the fallback also ranks from the universe payload's own marketcap order"); checks++;
  const thin = ndx10(rows.slice(0, 5), universe, { fallback: NDX_100 });
  ok(thin.source.startsWith("fallback:holdings-weighted-5"), `a read yielding fewer than ten companies falls back (${thin.source})`);
  const unweighted = ndx10([...top, ...tail].map(([t]) => holding(t, null)), universe, { fallback: NDX_100 });
  ok(unweighted.source === "fallback:holdings-weighted-0:holdings-by-cap",
     "a read that lists the members without weights is partly usable: its members, ranked by market cap");
  ok(unweighted.tickers.every((t) => [...top, ...tail].some(([x]) => SHARE_CLASS[x] === t || x === t)),
     "and only its own members are ranked");

  const m = ndxMembership(rows, { fallback: NDX_100 });
  eq(m.source, "qqq-holdings", "a full holdings read IS the Nasdaq-100 membership");
  ok(m.members.includes("PLTR") && m.members.includes("T00") && !m.members.includes("CASHUSD"),
     "membership is every weighted stock row");
  ok(m.dropped.includes("ANSS") && !m.members.includes("ANSS"),
     "a name that left the index (ANSS) is no longer guaranteed, and the drift is reported");
  ok(m.added.includes("T00"), "and a name the constant lacks is reported as added");
  const mf = ndxMembership(null, { fallback: NDX_100 });
  ok(mf.source === "fallback" && /failed/.test(mf.fallback) && NDX_100.every((t) => mf.members.includes(t)),
     "a failed read falls back to the constant and names why");
  const mp = ndxMembership(rows.slice(0, 20), { fallback: NDX_100 });
  ok(mp.source === "fallback" && mp.members.includes("PLTR") && mp.members.includes("ANSS"),
     "a thin read is unioned with the constant rather than trusted alone");

  const cohort = [];
  for (let i = 0; i < 300; i++) cohort.push({ ticker: `C${String(i).padStart(3, "0")}`, marketcap: (300 - i) * 1e9 });
  cohort.push({ ticker: "T00", marketcap: 1.2e9 }, { ticker: "ANSS", marketcap: 1.1e9 });
  const picked = selectCoverage(cohort, { count: 100, guaranteed: m.members }).map((p) => p.row.ticker);
  ok(picked.includes("T00") && !picked.includes("ANSS"),
     "the holdings drive the guarantee: a current member far below the size cohort is added, a departed one is not");

  eq(ndxConstantAge("2026-09-24").days, 266, "the constant's age is measured against the session");
  ok(!ndxConstantAge("2026-09-24").stale && ndxConstantAge("2027-02-10").stale,
     `and it turns stale after ${NDX_STALE_DAYS} days, which the run publishes as a meta warning`);
  ok(/QQQ holdings/.test(UNIVERSE_NOTES.index) && !/no endpoint/.test(UNIVERSE_NOTES.index),
     "the published note says where membership comes from now, instead of claiming no endpoint returns it");
}

{
  const ndx = { tickers: ["NVDA", "MSFT", "AAPL", "AMZN", "AVGO", "META", "GOOGL", "TSLA", "NFLX", "COST"], source: "qqq-holdings:2026-09-22" };
  const groups = focusGroups(ndx);
  assert.deepEqual(groups.map((g) => g.id), ["gold", "silver", "copper", "mag7", "ndx10"], "five groups, metals first"); checks++;
  eq(groups[4].source, "qqq-holdings:2026-09-22", "the NDX 10 group carries its source");
  const listed = focusTickers({ groups });
  eq(listed.length, new Set(listed).size, "focusTickers dedupes");
  eq(listed[0], "GLD", "and keeps the payload's order");
  eq(listed.length, 12 + 7 + 3, "the metals' twelve, the Mag 7, and the three NDX 10 names outside the Mag 7");
  ok(focusTickers(null).includes("CPER") && focusTickers(null).includes("NVDA"),
     "an absent payload falls back to the constants, so a reader is never left with nothing");
  const deep = focusDeepSet(ndx);
  ok(deep.has("AVGO") && deep.has("PAAS") && !deep.has("GLD"), "the deep focus set is Mag 7, NDX 10 and miners; funds go the dossier path");

  const row = { ticker: "GLD", close: "391.645", prev_close: "392.88", net_call_premium: "100", net_put_premium: "40",
    bullish_premium: "", call_volume: 5, issue_type: "ETF", full_name: "SPDR Gold Shares Trust Of A Very Long Name Indeed" };
  const shaped = focusRow(row);
  assert.deepEqual(Object.keys(shaped).slice(0, FOCUS_FIELDS.length), [...FOCUS_FIELDS], "a focus row carries exactly the focus fields, in order"); checks++;
  ok(FOCUS_FIELDS.every((f) => STRIP_FIELDS.some(([n]) => n === f)), "every focus field is a strip field, so live and nightly rows share names and units");
  eq(shaped.net, 60, "net is ncp - npp, as on the live strip");
  eq(shaped.bull, null, "an absent vendor value is null, never zero");
  eq(shaped.bear, null, "including one the vendor never sent");
  ok(shaped.name.length <= 40 && shaped.type === "ETF", "the name is trimmed to forty characters and the vendor type travels");

  const closes = focusCloses({ closes: Array.from({ length: 42 }, (_, i) => 100 + i), closeDates: Array.from({ length: 42 }, (_, i) => i === 41 ? "2026-09-24" : "2026-08-" + String(i % 28 + 1).padStart(2, "0")) }, "2026-09-24");
  eq(closes.length, 22, "closes are the last 22 sessions");
  eq(closes[21], 141, "ending at the session");
  eq(focusCloses({ closes: [1, 2], closeDates: ["2026-09-22", "2026-09-23"] }, "2026-09-24"), null,
     "a series that does not reach the session is not published as if it did");

  const rows = new Map([["GLD", row], ["NVDA", { ticker: "NVDA", close: "180" }]]);
  const p = buildFocusPayload({ ndx, rows, read: { ok: true }, sessionDate: "2026-09-24", generatedAt: "x", readAt: "y",
    closesOf: (t) => (t === "GLD" ? [1, 2, 3] : null) });
  eq(p.status, "ok", "a readable focus payload is ok");
  ok(p.missing.includes("SLV") && !p.missing.includes("GLD"), "and names what was asked and not returned");
  ok(p.closes.GLD && !p.closes.NVDA, "closes appear only where the run holds candles");
  ok(p.fresh && p.fresh.session === "2026-09-24" && p.fresh.source === "nightly", "the nightly freshness envelope rides along");
  const down = buildFocusPayload({ ndx, rows: new Map(), read: { ok: false, error: "HTTP 500" }, sessionDate: "2026-09-24" });
  ok(down.status === "unavailable" && down.reason === "unreadable" && down.groups.length === 5 && !Object.keys(down.rows).length,
     "a failed read publishes unavailable with the groups still listed and no fabricated row");
  const harvest = new Map([["NVDA", { ticker: "NVDA", close: "181", prev_close: "180" }], ["FCX", { ticker: "FCX", close: "45" }]]);
  const held = buildFocusPayload({ ndx, rows: new Map(), read: { ok: false, error: "HTTP 500" }, sessionDate: "2026-09-24",
    backfill: harvest, backfillReadAt: "h" });
  ok(held.status === "ok" && held.rows.NVDA && held.rows.NVDA.px === 181 && held.rows.FCX,
     "a failed focus read still publishes the stock rows the run already holds from its own harvest: no waiting sign where data exists");
  assert.deepEqual(held.backfill, { from: "harvest", readAt: "h", tickers: ["NVDA", "FCX"].sort((a, b) => listed.indexOf(a) - listed.indexOf(b)), why: "unreadable" },
    "and says which rows came from the harvest, read when, and why"); checks++;
  ok(held.missing.includes("GLD") && !Object.hasOwn(held.rows, "GLD"),
     "a fund the harvest never holds stays missing, never fabricated");
  const mixed = buildFocusPayload({ ndx, rows: new Map([["NVDA", { ticker: "NVDA", close: "190" }]]), read: { ok: true },
    sessionDate: "2026-09-24", backfill: harvest });
  ok(mixed.rows.NVDA.px === 190 && mixed.backfill.tickers.join() === "FCX" && mixed.backfill.why === "not_returned",
     "the focus read wins where it answered; the harvest fills only what it did not return");
  ok(!Object.hasOwn(p, "backfill"), "and a payload with nothing filled carries no backfill note");
  const big = new Map(listed.map((t) => [t, { ticker: t, close: "100" }]));
  const fat = buildFocusPayload({ ndx, rows: big, read: { ok: true }, sessionDate: "2026-09-24",
    closesOf: () => Array.from({ length: 22 }, () => 123456.7891), budgetBytes: 8000 });
  ok(fat.bytes <= 8000 && fat.shed && fat.shed.closes.length > 0 && Object.keys(fat.rows).length === listed.length,
     "over its cap the payload sheds closes, never rows");
  ok(FOCUS_BUDGET_BYTES === 24 * 1024, "the focus cap is 24 KB");
}

{
  const S = "2026-09-24";
  eq(tradingSessionsBetween("2026-09-18", S), 4, "Fri 09-18 is four sessions before Thu 09-24");
  eq(tradingSessionsBetween("2026-11-24", "2026-11-30"), 3, "and Thanksgiving is not a session");
  const prior = {
    v: 1, sessionDate: "2026-09-23",
    depth: { NVDA: "focus", KEEP: "cross" }, session: { NVDA: "2026-09-23", KEEP: "2026-09-23" },
    x: { "card-x": ["NVDA"], hist: ["NVDA"] },
    held: { "card:OLD": "2026-09-18", "card-x:OLD": "2026-09-18", "card:YOUNG": "2026-09-21", "card:GLD": "2026-09-01",
      "card:BADDAY": "nope" },
  };
  const { known, complete } = priorLedger(prior);
  ok(complete, "a roster carrying its held ledger is a complete ledger");
  eq(known.get("card:NVDA"), "2026-09-23", "tonight's cards enter the ledger at their session");
  eq(known.get("hist:NVDA"), "2026-09-23", "and so do their card-x and hist keys");
  const landed = new Set(["card:NVDA", "card-x:NVDA", "hist:NVDA"]);
  const plan = retirePlan({ sessionDate: S, known: new Map([...known, ["card:FOCUSOLD", "2026-09-10"]]),
    landed: new Set([...landed, "card:FOCUSOLD"]), exempt: new Set(["GLD"]) });
  assert.deepEqual(plan.retire, ["card-x:OLD", "card:OLD"],
    `a card ${tradingSessionsBetween("2026-09-18", S)} sessions old that the run did not rebuild is retired with its card-x; ` +
    `anything within ${RETIRE_AFTER_SESSIONS} sessions is held`); checks++;
  ok(!plan.retire.includes("card:FOCUSOLD") && !Object.hasOwn(plan.held, "card:FOCUSOLD"),
     "a focus card the run rebuilt is never retired, however old its prior entry");
  ok(Object.hasOwn(plan.held, "card:YOUNG") && Object.hasOwn(plan.held, "card:KEEP"), "three sessions or fewer are held");
  ok(Object.hasOwn(plan.held, "card:GLD") && !plan.retire.includes("card:GLD"),
     "an exempt dossier (index, fund, focus) is never retired, however stale — a dated dossier beats an absent one");
  ok(Object.hasOwn(plan.held, "card:BADDAY"), "an entry with no readable date is held, never deleted on a guess");
  eq(priorLedger({ v: 1, depth: {} }).complete, false, "a roster without a held ledger is incomplete, which triggers the probe");
  eq(priorLedger({ v: 1, depth: {}, held: {}, ledger: "bootstrap-partial" }).complete, false,
     "and so is one whose probe was partial (a read failed or the cap was hit): the next run probes again rather than " +
     "forgetting a key it never saw");

  eq(priorLedger({ v: 1, depth: {}, held: {}, ledger: "unread" }).complete, false,
     "and so is one written on a night that could not read ITS prior: its empty ledger forgot every older key, so the next run probes");
  eq(priorLedger({ v: 1, depth: {}, held: {}, ledger: "dropped" }).why, "ledger-dropped", "a dropped ledger is named as the reason");
  eq(priorLedger({ v: 1, depth: {}, held: {}, ledger: "someday" }).complete, false,
     "a ledger state this code does not know is not trusted");
  eq(priorLedger({ v: 1, sessionDate: "2026-09-23", depth: {}, held: {} }, { sessionDate: S }).complete, true,
     "a ledger from the session immediately before tonight is complete");
  eq(priorLedger({ v: 1, sessionDate: "2026-09-18", depth: {}, held: {} }, { sessionDate: "2026-09-21" }).complete, true,
     "a weekend between the two sessions is not a gap");
  const gapped = priorLedger({ v: 1, sessionDate: "2026-09-21", depth: {}, held: {} }, { sessionDate: S });
  ok(!gapped.complete && gapped.why === "gap-3",
     "a ledger three sessions behind is incomplete: the nights between may have landed cards no ledger recorded");
  eq(priorLedger({ v: 1, depth: {}, held: {} }, { sessionDate: S }).why, "undated", "and an undated one cannot be placed, so it is probed");

  const depth = new Map([["NVDA", "focus"], ["PLD", "board"], ["COST", "cross-section"], ["SPY", "index"], ["GLD", "fund"], ["NOPE", "cross"]]);
  const r = buildRoster({ sessionDate: S, generatedAt: "t", depth, held: plan.held, retired: plan.retire,
    landed: new Set(["card:NVDA", "card:PLD", "card:COST", "card:SPY", "card:GLD", "card-x:NVDA", "hist:PLD"]) });
  assert.deepEqual(r.payload.depth, { COST: "cross", GLD: "fund", NVDA: "focus", PLD: "board", SPY: "index" },
    "the roster lists every card published by the run with its depth, cross-section written as cross, " +
    "and nothing whose card did not land"); checks++;
  ok(Object.values(r.payload.session).every((d) => d === S), "and each carries the session it was built for");
  ok(Object.values(r.payload.depth).every((d) => ROSTER_DEPTHS.includes(d)), "depth is one of the five roster depths");
  assert.deepEqual(r.payload.x, { "card-x": ["NVDA"], hist: ["PLD"] }, "tonight's card-x and hist keys are listed for the next run's ledger"); checks++;
  ok(r.fits && r.bytes <= ROSTER_BUDGET_BYTES, `inside its ${ROSTER_BUDGET_BYTES / 1024} KB cap`);
  eq(cardDepthOf("cross-section"), "cross", "the card's cross-section depth is the roster's cross");
  const next = priorLedger(r.payload);
  ok(next.complete && next.known.get("card:OLD") === undefined && next.known.get("card:YOUNG") === "2026-09-21",
     "and the roster a run writes is the ledger the next run reads: retired keys are gone, held keys carry their date");
}

console.log(`✓ flows-universe: ${checks} assertions — a gapless geometric band ladder that is the vendor's only pagination, a size cohort chosen independently of the flow it scores, an index guarantee that can only add names, a pool that does not depend on vendor row order, and the |score| ranking that decides which names are worth three more calls; plus the NDX 10 and the Nasdaq-100 membership read from the QQQ holdings with share classes collapsed and a named fallback, the focus roster and its payload shape, and the retire rule and roster ledger that keep stale cards from outliving their names`);
