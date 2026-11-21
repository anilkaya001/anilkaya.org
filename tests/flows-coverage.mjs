import assert from "node:assert/strict";
import { createRouter } from "../server/router.js";
import { COVERAGE_ROW_CEILING, COVERAGE_TTL_S, flowsPipelineRows } from "../server/routes/flows-pipeline.js";
import { ERRORS } from "../server/errors.js";
import {
  FAILING_MAX, KEY_PRODUCTS, MIN_CANDLES, cardProducts, coverageLedger, screenProducts, stateName, stateOfPanel, verifyCoverage,
} from "../shared/flows-coverage.js";
import { GLOBAL_KEYS, NIGHTLY_GLOBAL_KEYS, PANEL_IDS, STATE, contractFor } from "../shared/flows-products.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import * as COVERAGE_MODULE from "../shared/flows-coverage.js";
import { createFlowsStore, NAME_LIST_CHUNK, NAME_LIST_MAX_NAMES } from "../server/store.js";
import { emitKeys } from "./lib/emit-keys.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const SESSION = "2026-08-24";
const { keys } = emitKeys(nightlyEmit());
const clone = (v) => JSON.parse(JSON.stringify(v));
const universe = keys.get("universe");
const roster = keys.get("roster");

const cardsOf = (names) => {
  const map = new Map();
  for (const t of names) if (keys.has("card:" + t)) map.set(t, { card: keys.get("card:" + t), cardX: keys.get("card-x:" + t) || null, hist: keys.get("hist:" + t) || null });
  return map;
};
const listingOf = (over = {}) => {
  const out = {};
  for (const [key, payload] of keys) {
    if (!/^(card|card-x|hist):/.test(key)) continue;
    out[key] = { present: true, sessionDate: payload.sessionDate, generatedAt: payload.generatedAt, updatedAt: 1 };
  }
  for (const [k, v] of Object.entries(over)) { if (v === null) delete out[k]; else out[k] = { ...out[k], ...v }; }
  return { keys: out, listed: Object.keys(out).length, truncated: false };
};
const globalsOf = (over = {}) => {
  const out = {};
  for (const k of NIGHTLY_GLOBAL_KEYS) {
    const src = keys.get(k) || { sessionDate: SESSION, generatedAt: universe.generatedAt };
    out[k] = { present: true, sessionDate: src.sessionDate, generatedAt: src.generatedAt, updatedAt: 1, bytes: 10 };
  }
  for (const [k, v] of Object.entries(over)) out[k] = v;
  return out;
};
const nameOf = (depth) => universe.t.find((t) => roster.depth[t] === depth);

eq([stateOfPanel({ status: "ok" })[0], stateOfPanel({ status: "quiet", reason: "none" })[0], stateOfPanel({ status: "pending" })[0], stateOfPanel({ status: "stale" })[0]],
  [STATE.ok, STATE.quiet, STATE.pending, STATE.stale], "a panel's status is a state");
eq(stateOfPanel({ status: "unavailable", reason: "no strike ladder" }), [STATE.failed, "no strike ladder"], "an unavailable panel that gives no sign it was never asked for is a failure");
eq(stateOfPanel({ status: "unavailable", code: "failed", reason: "the feed's darkpool read answered HTTP 503" })[0], STATE.failed, "a read that failed says so with its code");
eq(stateOfPanel({ status: "unavailable", reason: "it was never requested, rather than requested and refused" })[0], STATE.unfetched, "and one that was never requested is unfetched");
eq(stateOfPanel(undefined)[0], STATE.unfetched, "a panel the card does not carry is unfetched");
eq(stateOfPanel({ status: "mystery" })[0], STATE.failed, "an unknown status is a failure, never a pass");
eq([stateName(0), stateName(3), stateName(99)], ["ok", "unfetched", "failed"], "state names");

{
  const t = nameOf("board");
  const deep = cardProducts(keys.get("card:" + t), keys.get("card-x:" + t), keys.get("hist:" + t), { depth: "board" });
  eq(Object.keys(deep.codes), PANEL_IDS, "a card is read for every product, in the registry's order");
  const gaps = contractFor("board").filter((id) => deep.codes[id] !== STATE.ok && id !== "reading");
  eq(gaps, [], `a deep card meets its contract (${t}): ${JSON.stringify(deep.why)}`);
  eq(deep.codes.reading, STATE.pending, "the reading is outside the nightly, so it is pending");
  eq(cardProducts(keys.get("card:" + t), keys.get("card-x:" + t), null, { depth: "board", reading: true }).codes.reading, STATE.ok, "unless a reading is in hand");

  const c = nameOf("cross");
  const cross = cardProducts(keys.get("card:" + c), keys.get("card-x:" + c), keys.get("hist:" + c), { depth: "cross" });
  eq([cross.codes.surface, cross.codes.engine, cross.codes.chart, cross.codes.levels, cross.codes.gamma], [STATE.unfetched, STATE.unfetched, STATE.ok, STATE.ok, STATE.ok],
    "a cross-section card has a chart, levels and gamma, and no surface and no engine, which it was never asked for");
  ok(/never requested/.test(cross.why.surface), "and says so in the panel's own words");

  const hole = clone(keys.get("card:" + t));
  hole.panels.ivSurface = { status: "unavailable", code: "failed", reason: "the feed's spot-exposures-expiry-strike read answered HTTP 503" };
  eq(cardProducts(hole, keys.get("card-x:" + t), null, { depth: "board" }).codes.surface, STATE.failed, "A PLANTED HOLE IS FOUND: a failed surface read is state 2");
  const thin = clone(keys.get("card:" + t));
  thin.panels.context.candles = thin.panels.context.candles.slice(0, MIN_CANDLES - 1);
  const short = cardProducts(thin, null, null, { depth: "board" });
  eq(short.codes.chart, STATE.quiet, "a chart of fewer bars than it wants is quiet");
  ok(new RegExp(`${MIN_CANDLES - 1} daily bars`).test(short.why.chart), "with the count in its reason");
  eq([short.codes.flow, short.codes.events, short.codes.positioning], [STATE.unfetched, STATE.unfetched, STATE.unfetched], "a missing card-x leaves flow, events and positioning unfetched");
  eq(cardProducts(thin, { status: "pending" }, null, { depth: "board" }).codes.flow, STATE.pending, "and a pending one leaves them pending");
  const noEngine = clone(keys.get("card:" + t));
  delete noEngine.engine;
  eq(cardProducts(noEngine, null, null, { depth: "board" }).codes.engine, STATE.failed, "a deep card with no engine block failed to build it");
  eq(cardProducts(noEngine, null, null, { depth: "cross" }).codes.engine, STATE.unfetched, "while a cross-section card never had one");
  const split = cardProducts(noEngine, { engine: { state: { state: "x" } } }, null, { depth: "board" });
  eq(split.codes.engine, STATE.ok, "an engine moved to the card-x counts");
  const noSpot = clone(keys.get("card:" + t));
  noSpot.panels.levels.spot = null;
  noSpot.panels.pricedMove.spot = null;
  noSpot.readPx = null;
  eq(cardProducts(noSpot, null, null, { depth: "board" }).codes.quote, STATE.failed, "a card with no price has no quote");
  eq(Object.values(cardProducts(null, null, null).codes).filter((s) => s === STATE.unfetched).length, PANEL_IDS.length - 1, "no card at all leaves everything unfetched but the reading");
}

{
  const screen = nameOf(null) || universe.t.find((t) => !roster.depth[t]);
  const i = universe.t.indexOf(screen);
  const row = screenProducts(universe, i);
  eq([row.codes.quote, row.codes.chart, row.codes.levels, row.codes.surface], [STATE.ok, STATE.unfetched, STATE.unfetched, STATE.unfetched],
    "a name known only by its universe row has a price and nothing else a card gives");
  eq([row.codes.gamma, row.codes.vol].every((c) => c === STATE.ok || c === STATE.unfetched), true, "its dealer gamma and volatility come from the row when the row has them");
  const bare = clone(universe);
  for (const k of ["px", "im5", "im30", "iv30", "gexAdv"]) bare.cols[k][i] = null;
  const none = screenProducts(bare, i);
  eq([none.codes.quote, none.codes.move, none.codes.vol, none.codes.gamma], [STATE.failed, STATE.unfetched, STATE.unfetched, STATE.unfetched], "a row with the columns null reads as absent, never as zero");
}

{
  const led = coverageLedger({ universe, roster, cards: cardsOf(universe.t), expected: SESSION });
  eq(led.n, universe.n, "the ledger has one record for every universe name");
  eq(led.t, universe.t, "in the universe's own order");
  ok(PANEL_IDS.every((id) => led.products[id].length === led.n && led.products[id].every((c) => Number.isInteger(c) && c >= 0 && c <= 5)), "each product is a column of state codes the length of the universe");
  for (const id of PANEL_IDS) eq(Object.values(led.counts[id]).reduce((a, b) => a + b, 0), led.n, `${id}: the counts add up to the universe (conservation)`);
  eq(led.depth.length, led.n, "the depth of every name is recorded");
  const screens = led.depth.filter((d) => d === "screen").length;
  ok(screens > led.n / 2, `most of the emit's universe is screen tier (${screens} of ${led.n}), as production is (483 of 655)`);
  eq(led.counts.chart.unfetched, screens, "and each of them has no chart: the gap this ledger exists to show");
  eq(led.counts.levels.unfetched, screens, "or levels");
  ok(led.contract.ok === false && led.contract.missing.chart === screens && led.contract.missing.levels === screens, "so the contract is broken, product by product");
  ok(!Object.hasOwn(led.contract.missing, "reading"), "a pending reading is not a miss");
  ok(led.failing.length <= FAILING_MAX && led.failingTotal >= led.failing.length, "the failing list is capped and its total kept");
  ok(led.failing.every((f) => ["t", "p", "code", "why", "d"].every((k) => k in f)) && led.failing.every((f) => [2, 3, 4].includes(f.code)), "each entry names the name, product, state, reason and tier");
  const bytes = JSON.stringify(led).length;
  ok(bytes < 40 * 1024, `the whole ledger is ${bytes} bytes for ${led.n} names`);

  const target = nameOf("board");
  const broken = cardsOf(universe.t);
  const held = broken.get(target);
  const planted = clone(held.card);
  planted.panels.ivSurface = { status: "unavailable", code: "failed", reason: "x" };
  broken.set(target, { ...held, card: planted });
  const again = coverageLedger({ universe, roster, cards: broken, expected: SESSION });
  const i = again.t.indexOf(target);
  eq(again.products.surface[i], STATE.failed, "A CARD WITH ITS SURFACE FAILED SHOWS 2 IN THAT NAME'S COLUMN");
  ok(again.failing.some((f) => f.t === target && f.p === "surface" && f.code === STATE.failed), "and the failing list names it first");
  eq(again.failing[0].code, STATE.failed, "failures sort before gaps by design");
  eq(again.counts.surface.failed, 1, "and the count of failures is one");
  eq(again.contract.missing.surface, 1, "a failure the contract requires is a miss");
  eq(coverageLedger({ universe: null }).n, 0, "an unreadable universe is an empty ledger, not a throw");
}

{
  const rep = verifyCoverage({ universe, roster, listing: listingOf(), globals: globalsOf(), expected: SESSION });
  eq(rep.universe.n, universe.n, "the report counts the universe");
  eq(rep.complete, true, "THE EMIT IS COMPLETE AT KEY LEVEL: every name that should hold a card, a card-x or a hist holds it, for the expected session");
  eq(rep.predicates.P1.failing + rep.predicates.P2.failing + rep.predicates.P4.failing, 0, "no predicate fails");
  ok(rep.predicates.P7.failing > 0 && rep.predicates.P7.of === universe.n, "P7 reports what the universe row lacks (sig, f2, f3, iv30p exist only for carded names): " + rep.predicates.P7.failing);
  eq(rep.conservation, { ok: true, expected: universe.n, counted: { row: universe.n, card: universe.n, cardX: universe.n, hist: universe.n } }, "every name is in exactly one state of every product");
  eq(Object.keys(rep.columns), ["t", "depth", ...KEY_PRODUCTS, "fresh", "age"], "the columns are the universe, its four products and each name's freshness and age");
  ok(KEY_PRODUCTS.every((p) => rep.columns[p].length === universe.n), "of the universe's length");
  const board = rep.byDepth.board;
  eq([board.n, board.card.ok, board.cardX.ok, board.hist.ok], [50, 50, 50, 50], "fifty board names hold all three keys");
  eq(rep.byDepth.screen.card.unfetched, rep.byDepth.screen.n, "a screen name's card is unfetched by design, not failed");
  eq(rep.failingTotal, 0, "so nothing is listed as failing");
  ok(JSON.stringify(rep).length < 30 * 1024, "and the report is " + JSON.stringify(rep).length + " bytes");
  eq(rep.roster.held, Object.keys(roster.held).length, "held names are counted");

  const t = nameOf("board");
  const gone = verifyCoverage({ universe, roster, listing: listingOf({ ["card:" + t]: null }), globals: globalsOf(), expected: SESSION });
  eq([gone.complete, gone.predicates.P1.failing], [false, 1], "A BOARD NAME WITH NO CARD FAILS P1 AND THE REPORT IS NOT COMPLETE");
  ok(gone.failing.some((f) => f.t === t && f.p === "card" && f.code === STATE.failed && /not stored/.test(f.why)), "naming the name, the product and why");
  const stale = verifyCoverage({ universe, roster, listing: listingOf({ ["card:" + t]: { sessionDate: "2026-08-21" } }), globals: globalsOf(), expected: SESSION });
  ok(stale.failing.some((f) => f.t === t && f.p === "card" && f.code === STATE.stale && /2026-08-21/.test(f.why)), "a card from an earlier session is stale");
  eq(stale.predicates.P2.failing >= 1 && stale.predicates.P4.failing >= 1, true, "and disagrees with its card-x, hist and the roster");
  const skew = verifyCoverage({ universe, roster, listing: listingOf({ ["card-x:" + t]: { sessionDate: "2026-08-21" } }), globals: globalsOf(), expected: SESSION });
  eq([skew.predicates.P2.failing, skew.predicates.P1.failing], [1, 0], "a card-x of another session than its card fails P2 alone");
  const rosterSkew = clone(roster);
  rosterSkew.session[t] = "2026-08-21";
  eq(verifyCoverage({ universe, roster: rosterSkew, listing: listingOf(), globals: globalsOf(), expected: SESSION }).predicates.P4.failing, 1, "a roster that dates the card differently fails P4");
  const nohist = verifyCoverage({ universe, roster, listing: listingOf({ ["hist:" + t]: null }), globals: globalsOf(), expected: SESSION });
  ok(nohist.failing.some((f) => f.t === t && f.p === "hist") && !nohist.complete, "a missing hist is found");
  const cut = verifyCoverage({ universe, roster, listing: { ...listingOf({ ["card:" + t]: null }), truncated: true }, globals: globalsOf(), expected: SESSION });
  eq([cut.listing.truncated, cut.complete], [true, false], "a listing cut short is never complete");
  eq(cut.failing.some((f) => f.t === t && f.p === "card"), false, "and a key missing from a cut listing is pending, not failed");
  const unread = verifyCoverage({ universe, roster, listing: null, globals: globalsOf(), expected: SESSION });
  eq([unread.listing.read, unread.complete, unread.products.card.pending > 0], [false, false, true], "a listing that could not be read leaves the names pending and the report incomplete");
  const noExpected = verifyCoverage({ universe, roster, listing: listingOf(), globals: globalsOf(), expected: null });
  eq(noExpected.complete, false, "with no expected session nothing can be complete");
  const lateGlobals = verifyCoverage({ universe, roster, listing: listingOf(), globals: globalsOf({ regime: { present: true, sessionDate: "2026-08-21" }, events: { present: false } }), expected: SESSION });
  eq([lateGlobals.globals.regime.state, lateGlobals.globals.events.state, lateGlobals.complete], ["stale", "failed", false], "a stale or missing global key breaks completeness and is named");
  eq(Object.keys(rep.globals).sort(), NIGHTLY_GLOBAL_KEYS.slice().sort(), "every registered global the nightly writes each night is judged");
  eq(GLOBAL_KEYS.filter((k) => !NIGHTLY_GLOBAL_KEYS.includes(k)), ["er-sectors"], "the weekly sector list is the one global left out: it is written once a week and carries no session date");
  const weekly = verifyCoverage({ universe, roster, listing: listingOf(), globals: globalsOf({ "er-sectors": { present: true, sessionDate: null, updatedAt: 1, bytes: 10 } }), expected: SESSION });
  eq([weekly.complete, weekly.globals["er-sectors"].state], [false, "failed"], "A REPORT THAT JUDGED THE WEEKLY KEY BY THE NIGHT WOULD NEVER BE COMPLETE, which is why the route does not ask for it");
  eq(verifyCoverage({}).universe.n, 0, "an empty call is an empty report");
}

const WEEKDAYS_BACK = (from, to) => {
  const hol = new Set(["2026-09-07", "2026-11-26", "2026-12-25"]);
  let n = 0;
  for (let d = Date.parse(from + "T00:00:00Z"); d < Date.parse(to + "T00:00:00Z"); d += 864e5) {
    const next = new Date(d + 864e5);
    const iso = next.toISOString().slice(0, 10);
    if (next.getUTCDay() !== 0 && next.getUTCDay() !== 6 && !hol.has(iso)) n++;
  }
  return n;
};

function freshBattery(mod) {
  const bad = [];
  const check = (cond, name) => { if (!cond) bad.push(name); };
  const carded = universe.t.filter((t) => keys.has("card:" + t));
  const bare = universe.t.filter((t) => !keys.has("card:" + t)).slice(0, 3);
  const small = { ...universe, t: carded.concat(bare), n: carded.length + bare.length };
  const run = (over = {}, extra = {}) => mod.verifyCoverage({ universe: extra.universe || small, roster: extra.roster || roster, listing: "listing" in extra ? extra.listing : listingOf(over), globals: globalsOf(), expected: extra.expected === undefined ? SESSION : extra.expected });
  const whole = run({}, { universe });
  check(whole.freshness.n === universe.n && whole.freshness.counts.fresh === carded.length && whole.freshness.counts.new === universe.n - carded.length, "on the whole emit every carded name is fresh and every other is new");
  check(whole.freshness.ok === false && whole.freshness.total === universe.n - carded.length, "and the contract is broken by every name with no card");
  check(whole.columns.fresh.length === universe.n && whole.columns.age.length === universe.n, "a freshness and an age for every name");
  const allFresh = run({}, { universe: { ...universe, t: carded, n: carded.length } });
  check(allFresh.freshness.ok === true && allFresh.freshness.total === 0 && allFresh.freshness.maxAge === 0, "a universe whose every name is fresh meets the contract");
  const t = carded.find((x) => roster.depth[x] === "board");
  const u = carded.find((x) => x !== t && roster.depth[x] === "board");
  const old = "2026-08-14";
  const heldRoster = clone(roster);
  delete heldRoster.depth[t];
  heldRoster.held["card:" + t] = old;
  const held = run({ ["card:" + t]: { sessionDate: old }, ["card-x:" + t]: { sessionDate: old }, ["hist:" + t]: { sessionDate: old } }, { roster: heldRoster });
  const hi = held.columns.t.indexOf(t);
  check(mod.FRESH_WHY[held.columns.fresh[hi]] === "held", "a card kept by the run from an earlier session is held, not fresh");
  check(held.columns.age[hi] === WEEKDAYS_BACK(old, SESSION) && held.columns.age[hi] === 6, "its age is counted in exchange sessions, six from 2026-08-14 to 2026-08-24, not ten calendar days");
  check(held.freshness.worst.some((w) => w.t === t && w.why === "held" && w.age === 6 && w.session === old), "the held name is listed with its session and age");
  check(held.freshness.ok === false && held.freshness.maxAge === 6 && held.freshness.ages[6] === 1, "a held card breaks the contract and sets the oldest age");
  const stale = run({ ["card:" + u]: { sessionDate: "2026-08-21" } });
  const si = stale.columns.t.indexOf(u);
  check(mod.FRESH_WHY[stale.columns.fresh[si]] === "stale" && stale.columns.age[si] === 1, "an earlier card nothing holds is stale, one session behind");
  const split = run({ ["card-x:" + u]: { sessionDate: "2026-08-21" } });
  check(mod.FRESH_WHY[split.columns.fresh[split.columns.t.indexOf(u)]] === "split", "a fresh card whose card-x is older is split");
  const splitRow = split.freshness.worst.find((w) => w.t === u);
  check(!!splitRow && /card-x 2026-08-21/.test(splitRow.note), "and the note names the older part");
  const gone = run({ ["card:" + u]: null });
  check(mod.FRESH_WHY[gone.columns.fresh[gone.columns.t.indexOf(u)]] === "absent", "a card the roster lists but the store lacks is absent");
  const undated = run({ ["card:" + u]: { sessionDate: null } });
  check(mod.FRESH_WHY[undated.columns.fresh[undated.columns.t.indexOf(u)]] === "undated", "a card with no session date is undated");
  const cut = run({}, { listing: { ...listingOf({ ["card:" + u]: null }), truncated: true } });
  check(mod.FRESH_WHY[cut.columns.fresh[cut.columns.t.indexOf(u)]] === "unknown", "a name missing from a cut listing is unknown, never new or absent");
  const unread = run({}, { listing: null });
  check(unread.freshness.counts.unknown === small.n && unread.freshness.ok === false, "an unread listing leaves every name unknown");
  const blind = run({}, { expected: null });
  check(blind.freshness.counts.unknown === small.n, "with no expected session every name is unknown");
  const both = run({ ["card:" + u]: { sessionDate: "2026-08-21" }, ["card:" + t]: { sessionDate: old } });
  const order = both.freshness.worst.filter((w) => w.why === "stale").map((w) => w.t);
  check(order[0] === t && order[1] === u, "the oldest card is listed first within its reason");
  const firstNew = both.freshness.worst.findIndex((w) => w.why === "new");
  check((firstNew >= 0 && firstNew < both.freshness.worst.findIndex((w) => w.why === "stale")), "a name with no card is listed ahead of an old one");
  return bad;
}

{
  eq(freshBattery(COVERAGE_MODULE), [], "THE PER-NAME FRESHNESS CONTRACT holds on the real build");
  ok(COVERAGE_MODULE.FRESH_WHY.length === 8 && COVERAGE_MODULE.FRESH_WHY.at(-1) === "fresh", "eight reasons, fresh last");
  const PLANTS = [
    ["held-reads-as-fresh", [["const age = session >= expected ? 0 : behindBy(session, expected);", "const age = 0;"]]],
    ["age-in-calendar-days", [["const n = sessionsBetween(from, to);", "const n = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);"]]],
    ["split-unchecked", [['const gaps = ["card-x", "hist"].filter(', "const gaps = [].filter("]]],
    ["cut-listing-reads-as-new", [['    if (truncated) return { t, why: "unknown", age: null, session: null, note: "the listing stopped before this name" };\n', ""]]],
    ["contract-ignores-names", [["ok: names.length > 0 && counts.fresh === names.length,", "ok: counts.stale === 0,"]]],
    ["roster-never-knows", [["  if (!isObject(roster)) return false;\n", "  return false;\n"]]],
    ["held-never-distinguished", [["const kept = isObject(roster) && isObject(roster.held) && Object.hasOwn(roster.held, `card:${t}`);", "const kept = false;"]]],
    ["worst-by-ticker-only", [["FRESH_RANK[a.why] - FRESH_RANK[b.why] || (b.age || 0) - (a.age || 0) || ", ""]]],
    ["no-expected-passes", [['  if (typeof expected !== "string" || !DAY.test(expected)) return { t, why: "unknown", age: null, session: dayOf(card), note: "the session the store should hold is not known" };\n', ""]]],
  ];
  for (const [id, transforms] of PLANTS) {
    const mod = await loadMutated("shared/flows-coverage.js", transforms);
    const caught = freshBattery(mod);
    ok(caught.length > 0, `PLANTED WRONG BUILD ${id} must fail the freshness battery`);
  }
}

{
  const stored = new Map();
  const many = [];
  for (let i = 0; i < 900; i++) {
    const t = "SYX" + String(i).padStart(3, "0");
    many.push(t);
    for (const kind of ["card", "card-x", "hist"]) stored.set(kind + ":" + t, { sessionDate: SESSION });
  }
  let batches = 0, statements = 0, scans = 0;
  const DB = {
    prepare: (sql) => ({
      bind: (...ids) => ({ sql, ids }),
      all: async () => { scans++; return { results: [] }; },
    }),
    batch: async (list) => {
      batches++;
      statements += list.length;
      return list.map((st) => {
        if (!/WHERE id IN \(/.test(st.sql) || st.ids.length > NAME_LIST_CHUNK) throw new Error("not a primary-key lookup");
        return { results: st.ids.filter((id) => stored.has(id)).map((id) => ({ id, updated_at: 1, session: stored.get(id).sessionDate, generated: "x", status: null })) };
      });
    },
  };
  const store = createFlowsStore({ ensureFlowsTables: async () => {} });
  const listing = await store.listing({ DB }, ["card", "card-x", "hist"], many);
  eq([listing.truncated, listing.listed, batches, scans], [false, 2700, 1, 0], "THE COVERAGE LISTING IS EXACT: 900 names, 2,700 keys, one batch of primary-key lookups, never cut at the 2,000-row prefix scan the 2026-11-13 store outgrew");
  eq(statements, Math.ceil(2700 / NAME_LIST_CHUNK), "in chunks of " + NAME_LIST_CHUNK);
  ok(Object.values(listing.keys).every((k) => k.sessionDate === SESSION), "every key carries its session");
  const over = await store.listing({ DB }, ["card"], Array.from({ length: NAME_LIST_MAX_NAMES + 5 }, (_, i) => "SYZ" + String(i % 1000).padStart(3, "0")));
  eq(over.truncated, true, "more names than the ceiling is said to be cut");
  const failing = await store.listing({ DB: { prepare: DB.prepare, batch: async () => { throw new Error("down"); } } }, ["card"], many);
  eq(failing, null, "a refused batch is an unread listing, never an empty one");
  const prefix = await store.listing({ DB }, ["card"]);
  eq(scans, 1, "and the nightly's prefix listing is unchanged when no names are given");
  ok(prefix && prefix.truncated === false, "it still answers");
}

const ROUTE_ENV = { DB: {}, FLOWS_COVERAGE: "on" };
const makeStore = (over = {}) => {
  const calls = [];
  const store = {
    read: async (env, key) => { calls.push(["read", key]); const v = keys.get(key); return v ? { payload: JSON.stringify(v), updatedAt: 1, fresh: {} } : null; },
    metadata: async (env, asked) => { calls.push(["metadata", asked.length]); return globalsOf(); },
    listing: async (env, kinds, names) => { calls.push(["listing", kinds.join(), names]); return listingOf(); },
    ...over,
  };
  return { store, calls };
};
const drive = async (env, { owner = true, store: s = makeStore(), now = () => Date.parse("2026-08-25T06:00:00Z"), caches = null, vendorCalls = undefined } = {}) => {
  const previous = globalThis.caches;
  if (caches) globalThis.caches = caches;
  else delete globalThis.caches;
  try {
    const router = createRouter(flowsPipelineRows({
      store: s.store, ensureFlowsTables: async () => {}, readClock: async () => ({ day: "2026-08-25", trading: 1 }),
      isOwner: () => owner, now, ...(vendorCalls ? { vendorCalls } : {}),
    }));
    const request = new Request("https://anilkaya.org/api/flows/coverage");
    try {
      const res = await router.handle({ request, env, url: new URL(request.url), ctx: { waitUntil: (p) => p } }, { flows: async () => ({ username: "u" }) });
      return { res, body: await res.clone().json().catch(() => null), calls: s.calls };
    } catch (error) {
      return { error, calls: s.calls };
    }
  } finally {
    if (previous === undefined) delete globalThis.caches; else globalThis.caches = previous;
  }
};
const codeOf = (r) => (r.error ? r.error.code : null);

{
  const off = await drive({ ...ROUTE_ENV, FLOWS_COVERAGE: "off" });
  eq([codeOf(off), off.error.status, off.calls.length], ["coverage_off", 404, 0], "THE SWITCH OFF: a 404 and not one read");
  eq(codeOf(await drive({ DB: {} })), "coverage_off", "an unset switch is off");
  eq(codeOf(await drive({ ...ROUTE_ENV, FLOWS_COVERAGE: "yes" })), "coverage_off", "and so is any value but on");
  const member = await drive(ROUTE_ENV, { owner: false });
  eq([codeOf(member), member.error.status, member.calls.length], ["forbidden", 403, 0], "A MEMBER WHO IS NOT AN OWNER IS REFUSED before any read");
  eq(codeOf(await drive({ FLOWS_COVERAGE: "on" })), "store_unreadable", "no database is the store's 503");
  ok(ERRORS.coverage_off[0] === 404, "the error table has the switch's code");

  const r = await drive(ROUTE_ENV);
  eq(r.res.status, 200, "the owner is answered");
  eq(r.res.headers.get("X-Coverage-Cache"), "miss", "from the store");
  eq(r.body.expected, SESSION, "for the session the clock expects");
  eq(r.body.complete, true, "and the emit is complete");
  eq(r.body.rows.ceiling, COVERAGE_ROW_CEILING, "the declared row ceiling travels with the answer");
  ok(!("calls" in r.body), "with no feed call meter unless one is wired");
  eq(r.calls.map((c) => c[0]).sort(), ["listing", "metadata", "read", "read"], "four reads: the universe, the roster, the metadata of the globals and one listing");
  eq(r.calls.find((c) => c[0] === "listing")[1], "card,card-x,hist", "the listing asks for the three name kinds");
  eq(r.calls.find((c) => c[0] === "listing")[2], universe.t, "of exactly the universe's names, so a store holding names that left it cannot cut the listing");
  eq(r.body.freshness.n, universe.n, "and the answer carries the per-name freshness contract");
  eq(COVERAGE_ROW_CEILING, 2 + NIGHTLY_GLOBAL_KEYS.length + 3 * NAME_LIST_MAX_NAMES, "the row ceiling is three keys a name at the listing's name ceiling");
  eq(r.calls.find((c) => c[0] === "metadata")[1], NIGHTLY_GLOBAL_KEYS.length, "and the metadata for the registered globals, ids only");
  ok(NIGHTLY_GLOBAL_KEYS.length <= 96, "which is inside the door's metadata limit");

  const metered = await drive(ROUTE_ENV, { vendorCalls: () => ({ n: 3 }) });
  eq(metered.body.calls, { n: 3 }, "a wired call meter is reported");

  const broken = await drive(ROUTE_ENV, { store: makeStore({ read: async () => null }) });
  eq(codeOf(broken), "store_unreadable", "A STORE THAT HOLDS NO UNIVERSE IS 503, never an empty report that reads as healthy");
  const noRoster = await drive(ROUTE_ENV, { store: makeStore({ read: async (env, key) => (key === "roster" ? null : { payload: JSON.stringify(keys.get(key)) }) }) });
  eq(noRoster.res.status, 200, "a missing roster still answers");
  ok(noRoster.body.byDepth.screen.n === universe.n, "with every name a screen name");
  const nolist = await drive(ROUTE_ENV, { store: makeStore({ listing: async () => null }) });
  eq([nolist.res.status, nolist.body.listing.read, nolist.body.complete], [200, false, false], "an unreadable listing is said, and never complete");
  const garbled = await drive(ROUTE_ENV, { store: makeStore({ read: async (env, key) => ({ payload: key === "universe" ? "{not json" : "{}" }) }) });
  eq(codeOf(garbled), "store_unreadable", "an unparseable universe is the same 503");
}

{
  const entries = new Map();
  const fake = { default: {
    match: async (request) => { const e = entries.get(request.url); return e ? e.clone() : undefined; },
    put: async (request, response) => { entries.set(request.url, response); },
  } };
  const first = await drive(ROUTE_ENV, { caches: fake });
  eq([first.res.headers.get("X-Coverage-Cache"), entries.size], ["miss", 1], "THE CACHE: a first read fills one entry");
  ok(/max-age=60/.test([...entries.values()][0].headers.get("Cache-Control")) && COVERAGE_TTL_S === 60, "held for sixty seconds");
  const second = await drive(ROUTE_ENV, { caches: fake });
  eq([second.res.headers.get("X-Coverage-Cache"), second.calls.length], ["hit", 0], "a second read is answered from it with no store read at all");
  eq(second.body.expected, first.body.expected, "the same answer");
  const member = await drive(ROUTE_ENV, { caches: fake, owner: false });
  eq(codeOf(member), "forbidden", "and the cache is behind the owner check, never in front of it");
  const off = await drive({ ...ROUTE_ENV, FLOWS_COVERAGE: "off" }, { caches: fake });
  eq(codeOf(off), "coverage_off", "and behind the switch");
}

console.log(`flows-coverage: ${checks} checks passed`);
