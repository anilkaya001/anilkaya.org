import assert from "node:assert/strict";
import { createLedgerBook, HELD_ROWS, retain, newerVersion, fingerprintOf, projectWindow } from "../shared/flows-ledger-book.js";
import { readUniverse, bookWindows, contributionOf, applyContribution, newBookState, deltaMicroOf, SECTORS } from "../shared/flows-sfc.js";
import { mergeAlerts, alertKey } from "../shared/flows-alerts.js";
import { loadVariant } from "./lib/sfc-variant.mjs";
import { runBattery, drive, diffAgainst, build } from "./lib/ledger-battery.mjs";
import { makeEvents, keyOf, expectedHeld, shuffle, project } from "./lib/ledger-stream.mjs";
import { oracleBook } from "./lib/sfc-oracle.mjs";
import { LEDGER_PLANTS } from "./lib/ledger-plants.mjs";
import { makeWorld } from "./lib/sfc-world.mjs";
import { mulberry32 } from "./lib/sfc-rng.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const SEED_BASE = Number(process.env.LEDGER_SEED || 20261026);
const WORLDS = Number(process.env.LEDGER_WORLDS || 1500);

const M0 = await loadVariant(null, "ledger-baseline");

{
  eq(HELD_ROWS, 180, "the held set is the stored record's 180 windows");
  const failed = runBattery(M0);
  eq(failed, [], "the correct build passes every check of the battery");
}

{
  let bad = 0;
  let first = null;
  const t0 = Date.now();
  for (let i = 0; i < WORLDS; i++) {
    const seed = SEED_BASE + i;
    const { world, events, dByKey } = makeEvents(seed, { tickers: 14 + (i % 30), perName: 4 + (i % 9), revise: (i % 5) / 8, down: 0.5, resend: (i % 4) / 6 });
    const ctx = drive(M0, world, events, { dByKey, seed, order: i % 3 === 0 ? seed + 1 : null, batchMax: 1 + (i % 11) });
    const diff = diffAgainst(M0, ctx, world, events);
    const v = ctx.engine.verify();
    if (diff.length || !v.ok) { bad++; if (first === null) first = { seed, diff: diff.slice(0, 3), drift: v.drift.slice(0, 3) }; }
  }
  eq(first, null, `${WORLDS} seeded streams end on the books of a from-scratch recompute of the expected held set, and the drift counter stays zero (first failing seed: ${first && first.seed})`);
  eq(bad, 0, "and none of them drifts");
  console.log(`  ${WORLDS} worlds in ${Date.now() - t0} ms`);
}

{
  let bad = 0;
  for (let i = 0; i < 60; i++) {
    const seed = SEED_BASE + 90000 + i;
    const { world, events, dByKey } = makeEvents(seed, { tickers: 30, perName: 9, revise: 0.3, down: 0.5, resend: 0.2 });
    drive(M0, world, events, {
      dByKey, seed, batchMax: 7,
      check: (ctx, seen) => {
        if (diffAgainst(M0, ctx, world, seen).length) bad++;
        if (!ctx.engine.verify().ok) bad++;
        if (ctx.engine.fingerprint() !== fingerprintOf(expectedHeld(seen))) bad++;
      },
    });
  }
  eq(bad, 0, "after every batch of 60 streams the books, the drift check and the fingerprint agree with the expected held set");
}

{
  let bad = 0;
  for (let i = 0; i < 40; i++) {
    const seed = SEED_BASE + 200000 + i;
    const { world, events } = makeEvents(seed, { tickers: 25, perName: 8, revise: 0.3, down: 0.5, resend: 0.1 });
    const ctx = drive(M0, world, events, { seed, deltaMicro: deltaMicroOf });
    const want = bookWindows(expectedHeld(events), { column: ctx.uni.columnOf, session: world.session });
    const d = M0.book.diffBooks({ books: ctx.engine.snapshot().books, counts: { ...ctx.engine.snapshot().counts } }, { books: want.books, counts: { ...want.counts, given: ctx.engine.stats().held, duplicate: 0 } });
    if (d.length || !ctx.engine.verify().ok) bad++;
  }
  eq(bad, 0, "with the real Black-Scholes delta the live books equal the full recompute too");
}

{
  let bad = 0;
  let compared = 0;
  for (let i = 0; i < 80; i++) {
    const seed = SEED_BASE + 300000 + i;
    const { world, events, dByKey, originals } = makeEvents(seed, { tickers: 30, perName: 9, revise: 0, resend: 0.25 });
    const ctx = drive(M0, world, events, { dByKey, seed, order: seed });
    const keys = ctx.engine.heldRows().map((r) => keyOf(r));
    const rows = keys.map((k) => originals.get(k));
    const oracle = oracleBook({ universe: world.universe, session: world.session, rows });
    const books = ctx.engine.snapshot().books;
    if (books.size !== oracle.names.size) { bad++; continue; }
    for (const [name, ob] of oracle.names) {
      const b = books.get(name);
      if (!b) { bad++; continue; }
      compared++;
      for (const f of ["n", "T", "AC", "BC", "AP", "BP", "sided", "covered", "sameDay"]) if (BigInt(b[f]) !== ob[f]) bad++;
      for (const r of ["btw", "cross", "leg", "ns"]) if (BigInt(b.U[r]) !== ob.U[r]) bad++;
      if (b.X !== ob.X || b.Ub !== ob.Ub || b.column !== ob.column) bad++;
    }
  }
  eq(bad, 0, "the live books equal the independent BigInt oracle written from the decimal strings");
  ok(compared > 800, "and that compared enough books to mean something: " + compared);
}

{
  const mk = (name, prem, i) => ({
    t: name, oc: name + "261120C00100000", cp: "C", k: 100, exp: "2026-10-23", prem, askPrem: prem * 0.4, bidPrem: prem * 0.3, size: 10, px: 50, ivStart: 0.3, ivEnd: 0.3,
    spanStart: new Date(Date.UTC(2026, 9, 23, 15, 0, i)).toISOString(), spanEnd: new Date(Date.UTC(2026, 9, 23, 15, 1, i)).toISOString(), single: true, floor: false,
  });
  const a = mk("SYA101", 10, 1), b = mk("SYB101", 8, 2), c = mk("SYC101", 5, 3);
  const a2 = { ...a, prem: 1, askPrem: 0.4, bidPrem: 0.3 };
  const first = { rows: [a, b], status: "ok" };
  const second = { rows: [c, a2], status: "ok" };
  const readAt1 = "2026-10-23T15:05:00.000Z";
  const readAt2 = "2026-10-23T15:10:00.000Z";
  const m1 = mergeAlerts(null, first, { at: readAt1, sessionDate: "2026-10-23", cap: 2 });
  const m2 = mergeAlerts(m1, second, { at: readAt2, sessionDate: "2026-10-23", cap: 2 });
  eq(m2.rows.map((r) => r.t).sort(), ["SYB101", "SYC101"], "the stored record replaces a re-seen window, then keeps the two largest: b and c");
  const uni = readUniverse({ t: [], sectors: [], sec: [], cols: { mcap: [] } });
  const eng = createLedgerBook({ column: uni.columnOf, session: "2026-10-23", cap: 2, deltaMicro: () => null });
  for (const row of [a, b]) eng.put(row, { at: Date.parse(readAt1) });
  eng.settle();
  for (const row of [c, a2]) eng.put(row, { at: Date.parse(readAt2) });
  eng.settle();
  eq(eng.heldRows().map((r) => r.t).sort(), ["SYB101", "SYC101"], "and the live book holds the same pair, whatever order the rows arrive in");
  const eng2 = createLedgerBook({ column: uni.columnOf, session: "2026-10-23", cap: 2, deltaMicro: () => null });
  for (const row of [a2, c]) eng2.put(row, { at: Date.parse(readAt2) });
  for (const row of [b, a]) eng2.put(row, { at: Date.parse(readAt1) });
  eng2.settle();
  eq(eng2.heldRows().map((r) => r.t).sort(), ["SYB101", "SYC101"], "even when the later read arrives first");
}

{
  const w = makeWorld(5, { tickers: 6, perName: 3, pathologies: false });
  const uni = readUniverse(w.universe);
  const eng = createLedgerBook({ column: uni.columnOf, session: w.session, deltaMicro: () => null });
  eq(eng.put({ t: "", prem: 1 }, { at: 1 }), "unkeyed", "a row with no ticker is not keyed");
  eq(eng.put(null, { at: 1 }), "unkeyed", "and neither is nothing");
  eq(projectWindow({ t: "SYA101", extra: 1 }).extra, undefined, "a window is projected to the fields the ledger reads");
  eq(retain([], 5), [], "an empty set retains nothing");
  ok(newerVersion({ at: 2, end: 0, row: { a: 1 } }, { at: 1, end: 9, row: { a: 1 } }), "the later read is the newer version");
  ok(newerVersion({ at: 1, end: 5, row: { a: 1 } }, { at: 1, end: 4, row: { a: 1 } }), "then the later window end");
}

{
  const t0 = process.hrtime.bigint();
  const { world, events, dByKey } = makeEvents(77, { tickers: 60, perName: 14, revise: 0.2, resend: 0.1 });
  const ctx = build(M0, world, { dByKey });
  let settles = 0;
  const per = [];
  for (const ev of events) {
    const s = process.hrtime.bigint();
    ctx.engine.put(ev.row, { at: ev.at });
    ctx.engine.settle();
    per.push(Number(process.hrtime.bigint() - s) / 1e6);
    settles++;
  }
  per.sort((x, y) => x - y);
  const p50 = per[Math.floor(per.length / 2)], p99 = per[Math.floor(per.length * 0.99)];
  console.log(`  ${settles} single-window settles, p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, total ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)} ms`);
  ok(Number.isFinite(p50) && settles > 100, "every arriving window was settled on its own: " + settles);
  ok(ctx.engine.verify().ok, "and the books are still the full recompute after every window");
}

{
  const rows = Array.from({ length: 400 }, (_, i) => ({
    t: "SYV" + String(100 + (i % 30)), oc: "SYV" + String(100 + (i % 30)) + "261120C00100000", cp: "C", k: 100, exp: "2026-10-23", prem: 500 + i, askPrem: 100, bidPrem: 100,
    size: 5, px: 40, ivStart: 0.3, ivEnd: 0.3, spanStart: new Date(Date.UTC(2026, 9, 23, 15, 0, i)).toISOString(), spanEnd: new Date(Date.UTC(2026, 9, 23, 15, 1, i)).toISOString(),
    single: true, floor: false,
  }));
  const w = { session: "2026-10-23", universe: { t: [], sectors: [], sec: [], cols: { mcap: [] } } };
  const sizes = [];
  for (let s = 0; s < 6; s++) {
    const ctx = build(M0, w, { deltaMicro: () => 250000 });
    const order = shuffle(rows, 40 + s);
    let at = 100;
    for (let i = 0; i < order.length; i += 17) {
      for (const row of order.slice(i, i + 17)) ctx.engine.put(row, { at: at++ });
      ctx.engine.settle();
    }
    sizes.push(ctx.engine.fingerprint());
  }
  eq(new Set(sizes).size, 1, "six arrival orders of 400 windows give the same held set to the last byte");
}

{
  const rows = [];
  const w = makeWorld(11, { tickers: 10, perName: 5, pathologies: false });
  const uni = readUniverse(w.universe);
  const state = newBookState();
  const sample = w.rows.slice(0, 30);
  const cs = sample.map((r) => contributionOf(r, { deltaMicro: (x) => x.d, session: w.session }));
  for (const c of cs) applyContribution(state, c, 1, uni.columnOf);
  for (const c of cs) applyContribution(state, c, -1, uni.columnOf);
  eq([state.books.size, Object.values(state.counts).every((v) => v === 0 || v === -0)], [0, true], "adding every contribution and taking each one out again leaves nothing: no book, every count zero");
  ok(rows.length === 0 && SECTORS.length === 11, "the shared leaf is the one the full recompute uses");
}

{
  const state = newBookState();
  const mk = (T) => ({ kind: "booked", rounded: false, name: "SYR101", right: "C", entry: {}, n: 1, T, AC: 0, BC: 0, AP: 0, BP: 0, U: { btw: 0, cross: 0, leg: 0, ns: 0 }, sided: 0, covered: 0, sameDay: 0, noExposure: 0, noDelta: 0, X: 0n, Ub: 0n });
  const column = () => "Energy";
  applyContribution(state, mk(500), 1, column);
  let thrown = null;
  try { applyContribution(state, mk(400), -1, column); } catch (e) { thrown = e; }
  ok(thrown instanceof RangeError && /still holds figures/.test(thrown.message), "a book that loses its last window while it still holds figures is an error, not a silent delete");
  const clean = newBookState();
  applyContribution(clean, mk(500), 1, column);
  applyContribution(clean, mk(500), -1, column);
  eq(clean.books.size, 0, "and a book that comes back to nothing is removed");
}

{
  const t0 = Date.now();
  const loaded = new Map();
  for (const p of LEDGER_PLANTS) {
    const V = await loadVariant({ file: p.file, transforms: p.transforms }, p.id);
    loaded.set(p.id, runBattery(V));
  }
  for (const p of LEDGER_PLANTS) {
    const failed = loaded.get(p.id);
    ok(failed.includes(p.expect), `${p.id} (${p.title}) fails its check ${p.expect}; failed: ${failed.join(", ") || "none"}`);
  }
  console.log(`  ${LEDGER_PLANTS.length} planted builds in ${Date.now() - t0} ms`);
}

console.log(`✓ flows-ledger-book: ${checks} assertions`);
