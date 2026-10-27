import { makeEvents, shuffle, batches, expectedHeld, project, keyOf } from "./ledger-stream.mjs";
import { makeWorld } from "./sfc-world.mjs";
import { SESSION } from "./sfc-world.mjs";

const DAY = SESSION;

const tieRows = (n) => Array.from({ length: n }, (_, i) => ({
  t: "SYT101", oc: "SYT101261120C00100000", cp: "C", k: 100, exp: DAY, prem: 1000, askPrem: 400, bidPrem: 300, size: 10, px: 50, ivStart: 0.3, ivEnd: 0.3,
  spanStart: new Date(Date.UTC(2026, 9, 23, 14, 0, 0) + i * 1000).toISOString(), spanEnd: new Date(Date.UTC(2026, 9, 23, 14, 0, 30) + i * 1000).toISOString(),
  single: true, floor: false,
}));

const rowOf = (name, prem, i, extra = {}) => ({
  t: name, oc: name + "261120C00100000", cp: "C", k: 100, exp: DAY, prem, askPrem: prem * 0.4, bidPrem: prem * 0.3, size: 10, px: 50, ivStart: 0.3, ivEnd: 0.3,
  spanStart: new Date(Date.UTC(2026, 9, 23, 15, 0, 0) + i * 1000).toISOString(), spanEnd: new Date(Date.UTC(2026, 9, 23, 15, 1, 0) + i * 1000).toISOString(),
  single: true, floor: false, ...extra,
});

export function build(M, world, over = {}) {
  const uni = M.sfc.readUniverse(world.universe);
  const d = over.dByKey || new Map();
  const deltaMicro = over.deltaMicro || ((row) => (d.has(keyOf(row)) ? d.get(keyOf(row)) : null));
  const engine = M.book.createLedgerBook({ column: uni.columnOf, session: world.session, deltaMicro, cap: over.cap, seenCap: over.seenCap });
  return { engine, uni, deltaMicro };
}

export function drive(M, world, events, { dByKey, deltaMicro, order = null, seed = 1, batchMax = 9, check = null, cap, seenCap } = {}) {
  const ctx = build(M, world, { dByKey, deltaMicro, cap, seenCap });
  const list = order ? shuffle(events, order) : events;
  const parts = batches(list, seed, batchMax);
  const seen = [];
  for (const part of parts) {
    for (const ev of part) { ctx.engine.put(ev.row, { at: ev.at }); seen.push(ev); }
    ctx.engine.settle();
    if (check) check(ctx, seen);
  }
  return ctx;
}

export function diffAgainst(M, ctx, world, events, cap = 180) {
  const want = expectedHeld(events, cap);
  const full = M.sfc.bookWindows(want, { column: ctx.uni.columnOf, deltaMicro: ctx.deltaMicro, session: world.session });
  const snap = ctx.engine.snapshot();
  const out = M.book.diffBooks({ books: snap.books, counts: { ...snap.counts } }, { books: full.books, counts: { ...full.counts, given: want.length, duplicate: 0 } });
  const keys = new Set(ctx.engine.heldRows().map((r) => keyOf(r)));
  const wantKeys = new Set(want.map((r) => keyOf(r)));
  if (keys.size !== wantKeys.size || [...keys].some((k) => !wantKeys.has(k))) out.push("held set differs from the expected set");
  return out;
}

export function runBattery(M) {
  const failed = [];
  const check = (name, fn) => {
    let good = false;
    try { good = fn() === true; } catch { good = false; }
    if (!good) failed.push(name);
  };

  const { world, events, dByKey } = makeEvents(31, { tickers: 40, perName: 12, revise: 0.35, down: 0.5, resend: 0.2 });
  check("stream.books", () => {
    const ctx = drive(M, world, events, { dByKey, seed: 5 });
    return diffAgainst(M, ctx, world, events).length === 0;
  });
  check("stream.batches", () => {
    let bad = 0;
    drive(M, world, events, { dByKey, seed: 6, check: (ctx, seen) => { if (diffAgainst(M, ctx, world, seen).length) bad++; } });
    return bad === 0;
  });
  check("stream.drift", () => {
    let bad = 0;
    const ctx = drive(M, world, events, { dByKey, seed: 7, check: (ctx2) => { if (!ctx2.engine.verify().ok) bad++; } });
    return bad === 0 && ctx.engine.verify().ok;
  });
  check("stream.order", () => {
    const prints = new Set();
    for (let s = 1; s <= 6; s++) {
      const ctx = drive(M, world, events, { dByKey, order: 100 + s, seed: s });
      if (diffAgainst(M, ctx, world, events).length) return false;
      prints.add(ctx.engine.fingerprint());
    }
    return prints.size === 1;
  });
  check("stream.ties", () => {
    const rows = tieRows(230);
    const evs = rows.map((row, i) => ({ row, at: 1000 + i }));
    const prints = new Set();
    for (let s = 1; s <= 5; s++) {
      const ctx = drive(M, world, evs, { order: 200 + s, seed: s });
      prints.add(ctx.engine.fingerprint());
      if (ctx.engine.stats().held !== 180) return false;
    }
    return prints.size === 1;
  });
  check("stream.cap", () => {
    const rows = Array.from({ length: 260 }, (_, i) => rowOf("SYC" + String(100 + (i % 13)), 1000 + i, i));
    const ctx = drive(M, world, rows.map((row, i) => ({ row, at: 10 + i })), { seed: 3 });
    const held = ctx.engine.heldRows();
    return held.length === 180 && Math.min(...held.map((r) => r.prem)) === 1080;
  });
  check("stream.correction", () => {
    const v1 = rowOf("SYK101", 5000, 1);
    const v2 = { ...v1, prem: 3000, askPrem: 1200, bidPrem: 900 };
    const ctx = build(M, world);
    ctx.engine.put(v1, { at: 100 });
    ctx.engine.settle();
    ctx.engine.put(v2, { at: 200 });
    ctx.engine.settle();
    const b = ctx.engine.snapshot().books.get("SYK101");
    return !!b && b.T === 300000 && b.AC === 120000 && b.BC === 90000 && b.n === 1 && ctx.engine.verify().ok;
  });
  check("stream.older", () => {
    const v1 = rowOf("SYK102", 5000, 1);
    const v2 = { ...v1, prem: 3000, askPrem: 1200, bidPrem: 900 };
    const ctx = build(M, world);
    ctx.engine.put(v2, { at: 200 });
    ctx.engine.settle();
    ctx.engine.put(v1, { at: 100 });
    ctx.engine.settle();
    const b = ctx.engine.snapshot().books.get("SYK102");
    return !!b && b.T === 300000 && b.n === 1;
  });
  check("stream.promotion", () => {
    const rows = Array.from({ length: 200 }, (_, i) => rowOf("SYP" + String(100 + (i % 50)), 10000 - i * 10, i));
    const ctx = build(M, world);
    rows.forEach((row, i) => ctx.engine.put(row, { at: 10 + i }));
    ctx.engine.settle();
    const top = rows[0];
    const shrunk = { ...top, prem: 100, askPrem: 40, bidPrem: 30 };
    ctx.engine.put(shrunk, { at: 5000 });
    ctx.engine.settle();
    const keys = new Set(ctx.engine.heldRows().map((r) => keyOf(r)));
    return keys.has(keyOf(rows[180])) && ctx.engine.stats().held === 180 && ctx.engine.verify().ok;
  });
  check("stream.offsession", () => {
    const ctx = build(M, world);
    const old = rowOf("SYO101", 9000, 1, { spanStart: "2026-10-22T15:00:00.000Z", spanEnd: "2026-10-22T15:01:00.000Z" });
    ctx.engine.put(old, { at: 10 });
    ctx.engine.put(rowOf("SYO102", 100, 2), { at: 11 });
    ctx.engine.settle();
    return ctx.engine.stats().held === 1 && !ctx.engine.snapshot().books.has("SYO101");
  });
  check("stream.unchanged", () => {
    const ctx = build(M, world);
    const row = rowOf("SYU101", 4000, 1);
    ctx.engine.put(row, { at: 10 });
    ctx.engine.settle();
    const before = ctx.engine.fingerprint();
    for (let i = 0; i < 4; i++) { ctx.engine.put(row, { at: 20 + i }); ctx.engine.settle(); }
    const b = ctx.engine.snapshot().books.get("SYU101");
    return before === ctx.engine.fingerprint() && b.n === 1 && b.T === 400000;
  });
  check("verify.detects", () => {
    const ctx = drive(M, world, events, { dByKey, seed: 8 });
    const books = ctx.engine.snapshot().books;
    const any = books.values().next().value;
    any.T += 1;
    const r = ctx.engine.verify();
    any.T -= 1;
    return r.ok === false && r.drift.length >= 1 && ctx.engine.verify().ok === true;
  });
  check("fingerprint.order", () => {
    const rows = events.map((e) => project(e.row)).slice(0, 60);
    const a = M.book.fingerprintOf(rows);
    const b = M.book.fingerprintOf(rows.slice().reverse());
    return a === b && a !== M.book.fingerprintOf(rows.slice(1));
  });
  check("seen.cap", () => {
    const rows = Array.from({ length: 400 }, (_, i) => rowOf("SYS" + String(100 + (i % 40)), 1000 + i, i));
    const ctx = build(M, world, { seenCap: 220 });
    rows.forEach((row, i) => ctx.engine.put(row, { at: 10 + i }));
    ctx.engine.settle();
    const s = ctx.engine.stats();
    return s.seen <= 220 && s.held === 180 && s.dropped === 180;
  });
  check("seen.resurrect", () => {
    const rows = Array.from({ length: 400 }, (_, i) => rowOf("SYZ" + String(100 + (i % 40)), 1000 + i, i));
    const ctx = build(M, world, { seenCap: 220 });
    rows.forEach((row, i) => ctx.engine.put(row, { at: 10 + i }));
    ctx.engine.settle();
    const before = ctx.engine.stats().seen;
    const older = ctx.engine.put(rows[0], { at: 5 });
    const same = ctx.engine.put(rows[1], { at: 11 });
    const newer = ctx.engine.put(rows[0], { at: 99999 });
    return older === "older" && same === "older" && newer === "entered" && ctx.engine.stats().seen === before + 1;
  });
  check("rebuild.reenter", () => {
    const ctx = build(M, world, { cap: 2 });
    const a = rowOf("SYE101", 1000, 1), b = rowOf("SYE102", 2000, 2), c = rowOf("SYE103", 3000, 3);
    ctx.engine.put(a, { at: 10 });
    ctx.engine.put(b, { at: 11 });
    ctx.engine.settle();
    ctx.engine.put(c, { at: 12 });
    ctx.engine.settle();
    ctx.engine.rebuild(() => "Energy");
    ctx.engine.put({ ...b, prem: 100, askPrem: 40, bidPrem: 30 }, { at: 99 });
    ctx.engine.settle();
    const books = ctx.engine.snapshot().books;
    return books.has("SYE101") && books.get("SYE101").column === "Energy" && books.get("SYE103").column === "Energy" && ctx.engine.verify().ok;
  });
  check("rebuild.column", () => {
    const ctx = build(M, world);
    for (let i = 0; i < 20; i++) ctx.engine.put(rowOf("SYR" + String(100 + i), 1000 + i, i), { at: 10 + i });
    ctx.engine.settle();
    ctx.engine.rebuild(() => "Energy");
    const books = [...ctx.engine.snapshot().books.values()];
    return books.length === 20 && books.every((b) => b.column === "Energy") && ctx.engine.verify().ok;
  });
  check("aligned.totals", () => {
    const ctx = build(M, world);
    const rows = [rowOf("SYA101", 1000, 1), rowOf("SYA101", 2000, 2, { oc: "SYA101261120P00100000", cp: "P" }), rowOf("SYB101", 4000, 3)];
    rows.forEach((row, i) => ctx.engine.put(row, { at: 10 + i }));
    ctx.engine.settle();
    const cut = Date.parse(rows[1].spanEnd);
    const t = ctx.engine.alignedTotals((c) => c.name === "SYA101", cut);
    const all = ctx.engine.alignedTotals((c) => c.name === "SYA101", null);
    return t.T === 300000 && all.T === 300000 && ctx.engine.alignedTotals(() => true, cut).T === 300000 && ctx.engine.alignedTotals(() => true, null).T === 700000 && ctx.engine.newerThan(() => true, cut) === 1;
  });
  return failed;
}

export { makeWorld };
