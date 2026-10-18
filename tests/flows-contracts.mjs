import assert from "node:assert/strict";
import { CARD_SCHEMA_VERSION } from "../shared/flows-card.js";
import {
  CARD_CORE_PANELS, CARD_PANELS, CODES, canonical, canonicalHash, checkPayload, isDay, isStamp, validate,
} from "../shared/flows-contracts.js";
import { productById, productOf } from "../shared/flows-products.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import { emitKeys } from "./lib/emit-keys.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const dir = nightlyEmit();
const { keys } = emitKeys(dir);
const clone = (v) => JSON.parse(JSON.stringify(v));
const ALLOW = { allowSynthetic: true };

let refusedSynthetic = 0;
for (const [key, payload] of keys) {
  const v = validate(key, payload, ALLOW);
  ok(v.ok, `${key}: valid (${JSON.stringify(v.structural.slice(0, 2))})`);
  const strict = validate(key, payload);
  if (!strict.ok) {
    refusedSynthetic++;
    ok(strict.structural.every((s) => s.code === CODES.synthetic), `${key}: the only thing wrong with it outside a test is that it is synthetic`);
  }
}
ok(refusedSynthetic >= 100, `SYNTHETIC NAMES ARE REFUSED WITHOUT THE TEST ALLOWANCE: ${refusedSynthetic} of ${keys.size} emitted payloads carry a SYN name`);

const aaplKey = "card:AAPL";
const aapl = (({ fixture, ...rest }) => rest)(keys.get(aaplKey));
const universe = keys.get("universe");
ok(aapl && universe, "the emit holds a deep card and the universe");
const real = validate(aaplKey, aapl);
ok(real.ok, "a card for a real ticker passes with no allowance");
eq(real.baseOk.of, Object.keys(aapl.panels).length, "its base share counts every panel");
ok(real.baseOk.ok > 15 && real.tier === 3, `a complete deep card has most panels ok (${real.baseOk.ok} of ${real.baseOk.of}) and tier 3, engine ok`);
const cross = [...keys.entries()].find(([k, v]) => k.startsWith("card:") && v.depth === "cross-section");
ok(cross && validate(cross[0], cross[1], ALLOW).tier === 1, "a cross-section card has no engine and is tier 1");

const REFUSE = [];
const refuse = (label, key, payload, code, path, ctx) => REFUSE.push({ label, key, payload, code, path, ctx });

refuse("a card for another ticker", aaplKey, { ...clone(aapl), ticker: "MSFT" }, CODES.tickerMismatch, "ticker");
refuse("a card with a session that is not a date", aaplKey, { ...clone(aapl), sessionDate: "2026-02-30" }, CODES.badSession, "sessionDate");
refuse("a card with no session", aaplKey, (() => { const c = clone(aapl); delete c.sessionDate; return c; })(), CODES.badSession, "sessionDate");
refuse("a card with a stamp that is not ISO", aaplKey, { ...clone(aapl), generatedAt: "yesterday" }, CODES.badStamp, "generatedAt");
refuse("a card from the future of the schema", aaplKey, { ...clone(aapl), v: CARD_SCHEMA_VERSION + 1 }, CODES.schemaVersion, "v");
refuse("a card from before the panels existed", aaplKey, { ...clone(aapl), v: 1 }, CODES.schemaVersion, "v");
refuse("a card with an unknown depth", aaplKey, { ...clone(aapl), depth: "deep" }, CODES.badShape, "depth");
refuse("a card with no panels", aaplKey, (() => { const c = clone(aapl); delete c.panels; return c; })(), CODES.missing, "panels");
refuse("a card whose panels are a list", aaplKey, { ...clone(aapl), panels: [] }, CODES.badShape, "panels");
refuse("a card with a panel in an unknown state", aaplKey, (() => { const c = clone(aapl); c.panels.levels.status = "great"; return c; })(), CODES.badShape, "panels.levels");
refuse("a card with a panel that is not an object", aaplKey, (() => { const c = clone(aapl); c.panels.gamma = 4; return c; })(), CODES.badShape, "panels.gamma");
for (const core of CARD_CORE_PANELS) {
  refuse("a card with no " + core + " panel", aaplKey, (() => { const c = clone(aapl); delete c.panels[core]; return c; })(), CODES.missing, "panels." + core);
}
refuse("a card holding a number that is not finite", aaplKey, (() => { const c = clone(aapl); c.score = Number.POSITIVE_INFINITY; return c; })(), CODES.nonFinite, "score");
refuse("a card holding a nested NaN", aaplKey, (() => { const c = clone(aapl); c.panels.levels.spot = Number.NaN; return c; })(), CODES.nonFinite, "panels.levels.spot");
refuse("a card stamped as a fixture", aaplKey, { ...clone(aapl), fixture: true }, CODES.synthetic, "fixture");
refuse("a card with a synthetic name inside it", aaplKey, (() => { const c = clone(aapl); c.panels.marketRank = { status: "ok", peers: ["SYN012"] }; return c; })(), CODES.synthetic, "panels.marketRank.peers.0");
refuse("a card keyed by a synthetic ticker", "card:SYN001", { ...clone(aapl), ticker: "SYN001" }, CODES.synthetic, "key");
refuse("a card-x for another ticker", "card-x:AAPL", { ...clone(keys.get("card-x:AAPL")), ticker: "MSFT" }, CODES.tickerMismatch, "ticker");
refuse("a hist with no session", "hist:AAPL", (() => { const h = clone(keys.get("hist:AAPL")); delete h.sessionDate; return h; })(), CODES.badSession, "sessionDate");
refuse("a key no product owns", "card:lower", clone(aapl), CODES.badKey, "key");
refuse("a key of another grammar", "boards:long", clone(keys.get("board:long")), CODES.badKey, "key");
refuse("an array for an object", "universe", [], CODES.notObject, "$");
refuse("a string for an object", "meta", "meta", CODES.notObject, "$");
refuse("a universe whose count is wrong", "universe", { ...clone(universe), n: universe.n + 1 }, CODES.badShape, "t.length");
refuse("a universe column of the wrong length", "universe", (() => { const u = clone(universe); u.cols.px.pop(); return u; })(), CODES.badShape, "cols.px");
refuse("a universe column with no unit", "universe", (() => { const u = clone(universe); delete u.units.chg; return u; })(), CODES.badShape, "units.chg");
refuse("a universe rank column of the wrong length", "universe", (() => { const u = clone(universe); u.pct.iv30.pop(); return u; })(), CODES.badShape, "pct.iv30");
refuse("a universe holding a bad ticker", "universe", (() => { const u = clone(universe); u.t[3] = "bad ticker"; return u; })(), CODES.badShape, "t.3");
refuse("a universe with no columns", "universe", (() => { const u = clone(universe); delete u.cols; return u; })(), CODES.missing, "cols");
refuse("a roster with an unknown depth", "roster", (() => { const r = clone(keys.get("roster")); r.depth.AAPL = "deeper"; return r; })(), CODES.badShape, "depth.AAPL");
refuse("a roster with a bad session for a name", "roster", (() => { const r = clone(keys.get("roster")); r.session.AAPL = "x"; return r; })(), CODES.badSession, "session.AAPL");
refuse("a run record with no stages", "meta", (() => { const m = clone(keys.get("meta")); delete m.stages; return m; })(), CODES.missing, "stages");
refuse("a board on the wrong side", "board:long", { ...clone(keys.get("board:long")), side: "short" }, CODES.badShape, "side");
refuse("a board with a row that has no ticker", "board:long", (() => { const b = clone(keys.get("board:long")); b.rows[2] = { r: 3 }; return b; })(), CODES.badShape, "rows.2.t");
refuse("a board whose rows are not a list", "board:short", { ...clone(keys.get("board:short")), rows: {} }, CODES.badShape, "rows");
const dated = [...keys.keys()].find((k) => /^board:long:\d/.test(k));
refuse("a dated board filed under another day", dated, { ...clone(keys.get(dated)), sessionDate: "2026-08-21" }, CODES.keySession, "sessionDate");
refuse("a scoretrack with no session", "scoretrack", (() => { const s = clone(keys.get("scoretrack")); delete s.sessionDate; return s; })(), CODES.badSession, "sessionDate");
refuse("a live row that names another key", "live:strips", { ...clone(keys.get("live:strips")), key: "live:market" }, CODES.badKey, "key");

for (const r of REFUSE) {
  const v = validate(r.key, r.payload, { ...ALLOW, ...(r.ctx || {}), ...(r.code === CODES.synthetic ? { allowSynthetic: false } : {}) });
  ok(!v.ok, `REFUSED: ${r.label}`);
  ok(v.structural.some((s) => s.code === r.code && s.path === r.path), `${r.label}: ${r.code} at ${r.path} (got ${JSON.stringify(v.structural.slice(0, 3))})`);
  const c = checkPayload(r.key, r.payload, { ...ALLOW, ...(r.code === CODES.synthetic ? { allowSynthetic: false } : {}) });
  ok(c.ok === false && typeof c.code === "string" && typeof c.path === "string", `${r.label}: checkPayload names the first failure`);
}
ok(REFUSE.length >= 40, "the invalid corpus is " + REFUSE.length + " payloads");
eq(checkPayload(aaplKey, aapl), { ok: true }, "checkPayload answers ok for a valid payload");

{
  const flags = (key, payload, ctx) => validate(key, payload, { ...ALLOW, ...ctx }).flags.map((f) => f.code + "@" + f.path);
  const thin = clone(aapl);
  delete thin.panels.variation;
  ok(flags(aaplKey, thin).includes("panel_absent@panels.variation") && validate(aaplKey, thin, ALLOW).ok, "A PANEL A CARD NEVER HAD IS A FLAG, NOT A REFUSAL: an older card stays readable");
  ok(flags(aaplKey, aapl, { universe: new Set(["MSFT"]) }).includes("not_in_universe@ticker"), "a name outside the universe is a flag");
  eq(flags(aaplKey, aapl, { universe: new Set(["AAPL"]) }), [], "and a name inside it, with every panel present, raises none");
  const px = clone(universe);
  px.cols.px[4] = 0;
  ok(flags("universe", px).includes("px_not_positive@cols.px") && validate("universe", px, ALLOW).ok, "a price of zero in the universe is flagged and the universe still stands");
  const chg = clone(universe);
  chg.cols.chg[1] = -9.9 * chg.units.chg[1];
  ok(flags("universe", chg).includes("chg_out_of_range@cols.chg") && validate("universe", chg, ALLOW).ok, "a one-day move past minus 95% is flagged and not refused");
}

{
  ok(isDay("2026-08-24") && !isDay("2026-8-24") && !isDay("2026-02-30") && !isDay("2026-13-01") && !isDay(20260824) && !isDay(null), "a day is a real calendar date");
  ok(isStamp("2026-08-24T21:45:00.000Z") && isStamp("2026-08-24T21:45:00+03:00") && !isStamp("2026-08-24") && !isStamp("2026-08-24 21:45:00Z") && !isStamp("2026-13-24T21:45:00Z"), "a stamp is an instant with a zone");
}

{
  const product = productById("card");
  const a = { b: 1, a: { y: 2, x: [3, { q: 1, p: 2 }] }, generatedAt: "2026-08-24T21:45:00Z", readAt: "x" };
  const b = { readAt: "y", generatedAt: "2026-08-25T00:00:00Z", a: { x: [3, { p: 2, q: 1 }], y: 2 }, b: 1 };
  eq(canonical(a, product), canonical(b, product), "CANONICAL FORM: key order and the volatile stamps do not matter");
  eq(canonical(a, product), '{"a":{"x":[3,{"p":2,"q":1}],"y":2},"b":1}', "the form is sorted and stamp-free");
  ok(canonical({ ...a, b: 2 }, product) !== canonical(a, product), "while a changed value does");
  ok(canonical({ a: [1, 2] }, product) !== canonical({ a: [2, 1] }, product), "and an array keeps its order");
  const h1 = await canonicalHash(a, product);
  const h2 = await canonicalHash(b, product);
  const h3 = await canonicalHash({ ...a, b: 2 }, product);
  ok(/^[0-9a-f]{16}$/.test(h1) && h1 === h2 && h1 !== h3, "the hash is 16 hex characters, equal across the stamps and moved by content");
  const live = productOf("live:market");
  eq(canonical({ readAt: "x", v: 1 }, live), '{"v":1}', "a live product drops the same stamps");
  eq(canonical({ readAt: "x", v: 1 }), '{"v":1}', "and so does a call with no product");
}

{
  const big = keys.get("card:AAPL");
  const text = Buffer.byteLength(JSON.stringify(big));
  const start = process.hrtime.bigint();
  const runs = 40;
  for (let i = 0; i < runs; i++) validate(aaplKey, big);
  const ms = Number(process.hrtime.bigint() - start) / 1e6 / runs;
  ok(ms < 40, `a ${text}-byte card validates in ${ms.toFixed(2)} ms of wall time, far inside what a Worker request spends`);
}

ok(CARD_PANELS.length === 23 && CARD_CORE_PANELS.every((p) => CARD_PANELS.includes(p)), "the card's panel list is the builder's 23 and holds the four core panels");
const builder = (await import("../shared/flows-card.js")).buildCard({ ticker: "AAA", row: { close: 100 }, features: {}, strikes: [], ticks: [], expiries: [], maxPain: [], surface: [], chain: null,
  darkpool: null, oiDeltas: null, termStructure: null, ivRank: null, sessionDate: "2026-08-24", generatedAt: "2026-08-24T22:00:00Z" });
eq(Object.keys(builder.panels).sort(), CARD_PANELS.slice().sort(), "and it is exactly what buildCard emits, panel for panel");
eq(validate("card:AAA", builder, { allowSynthetic: true }).structural, [], "a card straight from the builder, built from nothing, is structurally valid");

console.log(`flows-contracts: ${checks} checks passed`);
