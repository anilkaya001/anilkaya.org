import { readFileSync } from "node:fs";
import { holdsAndPlants } from "./lib/ff-a-kit.mjs";
import { enginePlants } from "./lib/ff-a-engine-plants.mjs";
import { Store, symbolsOf, snapshotOf, sessionsFrom, wireOf, bodyOf, occOf, SECTORS } from "./lib/ff-a-world.mjs";
import { refEdge, liveOracle, bhRef, t5UpperRef, robustZRef } from "./lib/ff-a-oracle.mjs";
import { mulberry32 } from "../shared/flows-stats.js";
import * as W from "../shared/ff-contract.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures-ff-contract.json", import.meta.url), "utf8"));
const t = (iso) => Date.parse(iso);
const T = (id) => W.TEMPLATES.find((x) => x.id === id);
const clone = (v) => structuredClone(v);

const Z = "flow.net_premium.z20";
const CHG = "vol.iv.30d.chg1d";

function single(M, { edge, persist, op, x, cooldown, looks, start = "2026-03-02", extraNames = 1 }) {
  const metricId = edge === "event" ? Z : CHG;
  const sym = "SYA000";
  const names = [sym, ...Array.from({ length: extraNames }, (_, i) => "SYZ" + String(i + 1).padStart(3, "0"))];
  const body = bodyOf("nightly", [{ m: metricId, op, x }], { persist, cooldown: { unit: "session", n: cooldown }, scope: { kind: "names", symbols: names } });
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body });
  const sessions = sessionsFrom(M, start, looks.length);
  const store = new Store();
  const hitsAt = [];
  looks.forEach((v, i) => {
    const cols = { [metricId]: [v, ...names.slice(1).map(() => 0)] };
    const snap = snapshotOf({ kind: "nightly", session: sessions[i], symbols: names, cols, n: edge === "event" ? { [Z]: names.map(() => 20) } : null }, M);
    const before = store.hits.length;
    store.run(M, snap, [wire]);
    if (store.hits.length > before) hitsAt.push(i);
  });
  return { hitsAt, store, sessions, wire };
}

function vectorCases(M, R) {
  let mapped = 0;
  for (const v of fixtures.edge) {
    const distinct = !v.sessions || new Set(v.sessions).size === v.sessions.length;
    if (!distinct) continue;
    const r = single(M, { edge: v.edge, persist: v.persist, op: v.op, x: v.x, cooldown: v.cooldown || 1, looks: v.looks });
    R.eq(r.hitsAt, v.hitsAt, "contract edge vector: " + v.name);
    R.eq(refEdge(v), v.hitsAt, "the reference machine agrees: " + v.name);
    R.eq(r.store.conflicts, 0, "no insert conflicts: " + v.name);
    mapped++;
  }
  R.ok(mapped >= 13, "the contract's edge vectors are run through the engine: " + mapped);
}

function diffNightly(M, R) {
  const rng = mulberry32(77);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const zs = [null, 0, 1.5, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4];
  const cs = [null, 0, 1.5, 2, 2.5, 3, 3.5, 4];
  const total = R.heavy ? 260 : 36;
  for (let i = 0; i < total; i++) {
    const edge = i % 2 ? "state" : "event";
    const op = pick([">=", ">=", "<="]);
    const sign = op === ">=" ? 1 : -1;
    const pool = edge === "event" ? zs : cs;
    const looks = Array.from({ length: 24 }, () => {
      const v = pick(pool);
      return v === null ? null : sign * v;
    });
    const spec = { edge, persist: 1 + Math.floor(rng() * 3), op, x: sign * 3, h: 0.5, cooldown: pick([1, 2, 5, 10, 20]), looks };
    const got = single(M, spec).hitsAt;
    const want = refEdge(spec);
    R.eq(got, want, `random ${edge} ${op} persist ${spec.persist} cooldown ${spec.cooldown} looks ${JSON.stringify(looks)}`);
    if (R.fails.length > 12) break;
  }
}

function windowWire(M, { x = 1000000, persist = 1, cadence = "live", id = "w-bbbbbbbbbbbbbbbb", extra = [], over = {}, scope = { kind: "universe" } }) {
  const body = bodyOf(cadence, [{ m: "contract.premium", op: ">=", x }, ...extra], { persist, scope, ...over });
  return wireOf(M, { id, body });
}

function liveSnap(M, { session, look, windows, sourceAge = 60, symbols = ["SYA000", "SYB001"], extraCols = {} }) {
  const now = t(session + "T14:00:00Z") + look * 300000;
  const rows = windows.map((w, k) => ({ symbol: w.symbol || "SYA000", occ: w.occ || occOf(w.symbol || "SYA000", k), spanStart: w.spanStart ?? now - 600000, cols: { "contract.premium": w.premium } }));
  return snapshotOf({
    kind: "live", session, now, look, symbols, windows: rows, cols: extraCols,
    sources: { "live:alerts": { session, asOf: now - sourceAge * 1000 }, "live:strips": { session, asOf: now - sourceAge * 1000 } },
  }, M);
}

function diffLive(M, R) {
  const rng = mulberry32(31);
  const total = R.heavy ? 120 : 20;
  const sessions = ["2026-03-09", "2026-03-10", "2026-03-11"];
  for (let i = 0; i < total; i++) {
    const persist = 1 + Math.floor(rng() * 4);
    const wire = windowWire(M, { persist });
    const store = new Store();
    const looks = [];
    const hits = [];
    let n = 0;
    for (const s of sessions) {
      const ticks = 3 + Math.floor(rng() * 9);
      for (let k = 0; k < ticks; k++) {
        const r = rng();
        const tval = r < 0.15 ? null : r < 0.6 ? true : false;
        looks.push({ session: s, t: tval });
        const premium = tval === null ? null : tval ? 1500000 : 500000;
        const absent = tval === null && rng() < 0.5;
        const snap = liveSnap(M, { session: s, look: k, windows: absent ? [] : [{ premium }] });
        const before = store.hits.length;
        store.run(M, snap, [wire]);
        if (store.hits.length > before) hits.push(n);
        n++;
      }
    }
    R.eq(hits, liveOracle({ persist, looks }), `live persist ${persist}: ${JSON.stringify(looks.map((l) => (l.t === null ? "u" : l.t ? "T" : "F")).join(""))}`);
    R.eq(store.conflicts, 0, "a live run never offers a duplicate");
    R.ok(store.rows.size <= 1, "a live wire holds at most the pending row of its one contract");
    if (R.fails.length > 12) break;
  }
}

function hVectors(M, R) {
  const zBase = [...Array(10).fill(9e5), ...Array(10).fill(1.1e6)];
  const floor = { abs: 1e5, rel: 0 };
  const S = M.stats;
  const oneName = (zRaw, extra = {}) => {
    const body = bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "names", symbols: ["SYA000"] } });
    const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body });
    const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], cols: { [Z]: [zRaw] }, n: { [Z]: [20] }, floored: { [Z]: [extra.floored ? 1 : 0] } }, M);
    const store = new Store();
    store.run(M, snap, [wire]);
    return store;
  };
  const fire = S.robustZ({ x: 1444700, baseline: zBase, floor });
  const quiet = S.robustZ({ x: 1443900, baseline: zBase, floor });
  R.near(fire.z, 2.99946, 5e-6, "H1 x = $1.4447M gives z = 2.99946");
  R.near(quiet.z, 2.99406, 5e-6, "H1 x = $1.4439M gives z = 2.99406");
  R.eq([fire.zq, quiet.zq], [3, 2.99], "H1 shown 3.00 and 2.99");
  const a = oneName(fire.z);
  const b = oneName(quiet.z);
  R.eq([a.hits.length, b.hits.length], [1, 0], "H1 the displayed 3.00 fires and the displayed 2.99 does not");
  R.eq(JSON.parse(a.hits[0].evidence_json).clauses[0].value, 3, "H1 the evidence stores the displayed value");
  const flat = Array(20).fill(0);
  const zero = S.robustZ({ x: 0, baseline: flat, floor });
  const five = S.robustZ({ x: 5e6, baseline: flat, floor });
  R.eq(oneName(zero.z).hits.length, 0, "H2 x = 0 on a flat baseline is z = 0.00 and silent");
  const big = oneName(five.z, { floored: five.floored });
  R.eq(big.hits.length, 1, "H2 x = 5M on a flat baseline with a $100k floor fires");
  const ev = JSON.parse(big.hits[0].evidence_json);
  R.eq([ev.clauses[0].value, ev.clauses[0].floored], [50, true], "H2 the evidence says the denominator was floored");
  R.ok(M.sentence.renderHit(ev).rows[0].floored === true, "H2 and the table says floored");
  const warm = S.robustZ({ x: 5e6, baseline: [...Array(11).fill(1e6), ...Array(9).fill(null)], floor });
  const warmBody = bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "names", symbols: ["SYA000", "SYB001"] } });
  const warmWire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: warmBody });
  const warmSnap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000", "SYB001"], cols: { [Z]: [warm.z, 50] }, n: { [Z]: [warm.n, 20] }, why: { [Z]: { warming: [0] } } }, M);
  const ws = new Store();
  const wr = ws.run(M, warmSnap, [warmWire]);
  R.eq(wr.receipts[0].names_absent, 1, "H3 11 of 20 sessions is unknown, not false");
  R.eq(JSON.parse(wr.receipts[0].absent_json), { warming: { n: 1, sample: ["SYA000"] } }, "H3 the receipt names the reason and the name");
  R.eq(M.sentence.baselineText(warm.n), "— warming: baseline 11/20 sessions", "H3 and the line to show");
  const padded = S.robustZ({ x: 5e6, baseline: [...Array(11).fill(1e6), ...Array(9).fill(0)], floor });
  R.ok(padded.z !== null, "H3 a baseline padded with zeros would have produced a z");
  const pre = M.engine.preview(warmSnap, warmWire);
  R.eq([pre.unknown, pre.reasons], [1, { warming: 1 }], "H3 the preview counts it unknown with its reason");
}

function h4Vectors(M, R) {
  const longTrue = single(M, { edge: "event", persist: 1, op: ">=", x: 3, cooldown: 5, looks: [3.1, 3.2, 3.4, 3.1, 3.3] });
  R.eq(longTrue.hitsAt, [0], "H4 true for five looks is one hit");
  const inside = single(M, { edge: "event", persist: 1, op: ">=", x: 3, cooldown: 5, looks: [3.5, 2, 3.5, 2, 3.5, 2, 3.5] });
  R.eq(inside.hitsAt, [0, 6], "H4 true, false, true inside the cooldown is one hit; after the cooldown and the exit, two");
  const dipInside = single(M, { edge: "event", persist: 1, op: ">=", x: 3, cooldown: 1, looks: [3.5, 2.75, 3.5] });
  R.eq(dipInside.hitsAt, [0], "H4 a dip inside the band does not re-arm");
  const dipBelow = single(M, { edge: "event", persist: 1, op: ">=", x: 3, cooldown: 1, looks: [3.5, 2.25, 3.5] });
  R.eq(dipBelow.hitsAt, [0, 2], "H4 a dip below the band does");
  const frozen = single(M, { edge: "event", persist: 1, op: ">=", x: 3, cooldown: 1, looks: [3.5, null, 3.5] });
  R.eq(frozen.hitsAt, [0], "H4 unknown freezes the phase");
  const rows = frozen.store.rowOf("w-aaaaaaaaaaaaaaaa", "n:SYA000");
  R.eq([rows.phase, rows.cool_until], ["firing", "2026-03-03"], "the firing row holds its quiet period as a session date");
  const cooled = single(M, { edge: "event", persist: 1, op: ">=", x: 3, cooldown: 5, looks: [3.5, 2, 2, 2, 2, 2, 2] });
  R.eq(cooled.store.rows.size, 0, "a quiet period that has ended leaves no row");
  const during = single(M, { edge: "event", persist: 1, op: ">=", x: 3, cooldown: 5, looks: [3.5, 2] });
  R.eq(during.store.rowOf("w-aaaaaaaaaaaaaaaa", "n:SYA000").phase, "cooling", "an exit inside the quiet period is a cooling row");
  const quietNights = single(M, { edge: "state", persist: 1, op: ">=", x: 3, cooldown: 1, looks: [3.5, 3.5, 3.5, 3.5, 3.5] });
  const w0 = quietNights.store.writes;
  const more = single(M, { edge: "state", persist: 1, op: ">=", x: 3, cooldown: 1, looks: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5] });
  R.eq(more.store.writes - w0, 3 * 1, "a state that stays true writes only its receipt each further night");
}

function h5Vectors(M, R) {
  const wire = windowWire(M, { id: "w-bbbbbbbbbbbbbbbb" });
  const store = new Store();
  const snap = liveSnap(M, { session: "2026-03-09", look: 3, windows: [{ premium: 1500000 }] });
  store.run(M, snap, [wire]);
  const again = store.run(M, snap, [wire]);
  R.eq([store.hits.length, again.hits.length], [1, 0], "H5 the same tick run twice gives one hit");
  const later = liveSnap(M, { session: "2026-03-09", look: 4, windows: [{ premium: 1500000 }] });
  R.eq(store.run(M, later, [wire]).hits.length, 0, "H5 the next tick over the same window gives none");
  R.eq(store.conflicts, 0, "H5 the engine never relies on the table to refuse a duplicate");
  const t03 = M.house.compileHouse(M.house.houseById("h-t03"), { effectiveSession: "2026-03-02" });
  const s2 = new Store();
  const liveWindow = { symbol: "SYA000", occ: occOf("SYA000", 0), spanStart: t("2026-03-09T14:30:00Z"), cols: { "contract.dte": 14, "contract.otm_pct": 12, "contract.premium": 1500000, "contract.vol_oi": 4 } };
  const liveS = snapshotOf({ kind: "live", session: "2026-03-09", now: t("2026-03-09T15:00:00Z"), look: 5, symbols: ["SYA000"], windows: [liveWindow], sources: { "live:alerts": { session: "2026-03-09", asOf: t("2026-03-09T14:59:00Z") } } }, M);
  s2.run(M, liveS, [t03]);
  const nightly = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], windows: [liveWindow], sources: { flowalerts: { session: "2026-03-09", asOf: t("2026-03-09T21:30:00Z") } } }, M);
  const caught = s2.run(M, nightly, [t03]);
  R.eq([s2.hits.length, caught.hits.length, s2.hits[0].evaluator], [1, 0, "live"], "H5 the nightly catch-up over the same window adds nothing");
  const fresh = new Store();
  const only = fresh.run(M, nightly, [t03]);
  R.eq([only.hits.length, only.hits[0].evaluator, only.hits[0].dedupe_key], [1, "nightly", "c:SYA000:" + occOf("SYA000", 0) + ":2026-03-09"], "H5 the catch-up alone writes the same key the live pass would have");
  R.eq(only.hits[0].hit_id, s2.hits[0].hit_id, "H5 so the id is the same whichever evaluator saw the event first");
  const night = (x, symbols) => bodyOf("nightly", [{ m: Z, op: ">=", x }], { scope: { kind: "names", symbols } });
  const nw = wireOf(M, { id: "w-cccccccccccccccc", body: night(3, ["SYA000"]) });
  const snapN = (s, v) => snapshotOf({ kind: "nightly", session: s, symbols: ["SYA000", "SYB001"], cols: { [Z]: [v, 0] }, n: { [Z]: [20, 20] } }, M);
  const n1 = new Store();
  n1.run(M, snapN("2026-03-09", 2), [nw]);
  const n2 = n1.run(M, snapN("2026-03-10", 4), [nw]);
  const retry = n1.run(M, snapN("2026-03-10", 4), [nw]);
  R.eq([n2.hits.length, retry.hits.length, n1.conflicts], [1, 0, 0], "H5 a nightly retry adds no hit");
  const nw2 = wireOf(M, { id: "w-cccccccccccccccc", version: 2, body: night(3.25, ["SYA000"]) });
  const adj = new Store();
  adj.run(M, snapN("2026-03-09", 2), [nw]);
  adj.run(M, snapN("2026-03-10", 4), [nw]);
  adj.run(M, snapN("2026-03-10", 4), [nw2]);
  R.eq(adj.hits.length, 2, "H5 an Adjust that changes the clauses and fires again in one session gives two");
  R.ok(adj.hits.length === 2 && adj.hits[0].dedupe_key !== adj.hits[1].dedupe_key && adj.hits[0].hit_id !== adj.hits[1].hit_id, "H5 under two keys");
  R.eq(adj.conflicts, 0, "H5 and neither is offered twice");
  const nw3 = wireOf(M, { id: "w-cccccccccccccccc", version: 2, body: night(3, ["SYA000", "SYB001"]) });
  const sc = new Store();
  sc.run(M, snapN("2026-03-09", 2), [nw]);
  sc.run(M, snapN("2026-03-10", 4), [nw]);
  const scr = sc.run(M, snapN("2026-03-10", 4), [nw3]);
  R.eq([sc.hits.length, scr.hits.length], [1, 0], "H5 an Adjust that changes only the scope does not re-fire");
  R.eq(nw.clauseHash === nw3.clauseHash, true, "because the clause hash is the same");
  const back = new Store();
  back.run(M, snapN("2026-03-09", 2), [nw]);
  back.run(M, snapN("2026-03-10", 4), [nw]);
  back.run(M, snapN("2026-03-10", 4), [nw2]);
  const nwBack = wireOf(M, { id: "w-cccccccccccccccc", version: 3, body: night(3, ["SYA000"]) });
  const backRun = back.run(M, snapN("2026-03-10", 4), [nwBack]);
  R.eq(backRun.hits.length, 0, "H5 going from A to B and back to A does not re-fire A's event");
  const stateBody = (x) => bodyOf("nightly", [{ m: "vol.iv.30d.chg1d", op: ">=", x }, { m: "earn.sessions", op: "<=", x: 100 }], { scope: { kind: "names", symbols: ["SYA000"] } });
  const sw = wireOf(M, { id: "w-dddddddddddddddd", body: stateBody(3) });
  const sw2 = wireOf(M, { id: "w-dddddddddddddddd", version: 2, body: stateBody(3.5) });
  const stateSnap = (s, v) => snapshotOf({ kind: "nightly", session: s, symbols: ["SYA000"], cols: { "vol.iv.30d.chg1d": [v], "earn.sessions": [5] } }, M);
  const st = new Store();
  st.run(M, stateSnap("2026-03-09", 2), [sw]);
  st.run(M, stateSnap("2026-03-10", 4), [sw]);
  const stv2 = st.run(M, stateSnap("2026-03-10", 4), [sw2]);
  R.eq([st.hits.length, stv2.hits.length], [1, 0], "a new version of a state wire does not fire on its first look");
}

const q2 = (x) => Math.round(x * 100) / 100;
const names = (hits) => hits.map((h) => h.symbol).sort();

function bhScenarios(M, R) {
  const rng = mulberry32(5);
  const trials = R.heavy ? 40 : 10;
  for (let tr = 0; tr < trials; tr++) {
    const m = 30 + Math.floor(rng() * 60);
    const symbols = symbolsOf(m);
    const zs = symbols.map(() => {
      const r = rng();
      if (r < 0.08) return null;
      if (r < 0.28) return q2(2 + rng() * 5);
      return q2((rng() - 0.5) * 4);
    });
    const conf = symbols.map(() => (rng() < 0.7 ? 1 : 0));
    const body = bodyOf("nightly", [{ m: Z, op: ">=", x: 2 }, { m: "earn.confirmed", op: "==", x: 1 }]);
    const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body });
    const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols, cols: { [Z]: zs, "earn.confirmed": conf }, n: { [Z]: symbols.map(() => 20) } }, M);
    const store = new Store();
    const res = store.run(M, snap, [wire]);
    const ps = zs.map((z) => (z === null ? NaN : t5UpperRef(z)));
    const ref = bhRef(ps, 0.05);
    const through = symbols.map((s, i) => ({ s, z: zs[i] })).filter((c, i) => ref.reject[i] && zs[i] >= 2 && conf[i] === 1);
    const want = through.sort((a, b) => b.z - a.z || (a.s < b.s ? -1 : 1)).slice(0, 10).map((c) => c.s).sort();
    R.eq(names(res.hits), want, `BH then facts then the ten strongest, m=${m}, ${ref.k} rejected`);
    R.eq(res.capped.length, Math.max(0, through.length - 10), "and the rest counted as capped");
    const rc = res.receipts[0];
    R.eq(rc.names_evaluated + rc.names_absent, m, "every name is evaluated or absent");
    R.eq(rc.names_absent, zs.filter((z, i) => z === null && conf[i] === 1).length, "the absent names are the unknown ones that no fact rules out");
    if (R.fails.length > 10) break;
  }
  const base = symbolsOf(40);
  const zs = base.map((_, i) => (i < 6 ? 4.5 : 0.5));
  const body = bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }]);
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body });
  const res = new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: base, cols: { [Z]: zs }, n: { [Z]: base.map(() => 20) } }, M), [wire]);
  const e = JSON.parse(res.hits[0].evidence_json);
  R.eq(res.hits.length, 6, "six lone spikes in 40 names clear the BH line together");
  R.eq([e.bh.m, e.bh.k, e.bh.q, e.bh.e >= e.bh.cutoff], [40, 6, 0.05, true], "the evidence carries the family size, the rank and the cutoff");
  R.eq(M.engine.replayDecision(e), { ok: true, reasons: [] }, "and the decision replays from it");
  const lone = zs.map((z, i) => (i === 0 ? 4.5 : 0.5));
  R.eq(new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: base, cols: { [Z]: lone }, n: { [Z]: base.map(() => 20) } }, M), [wire]).hits.length, 0, "one spike of 4.5 sigma in 40 names does not clear 0.05 / 40");
  const two = zs.map((z, i) => (i === 0 ? 7 : 0.5));
  R.eq(new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: base, cols: { [Z]: two }, n: { [Z]: base.map(() => 20) } }, M), [wire]).hits.length, 1, "one spike of 7 sigma does");
  const one = new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], cols: { [Z]: [2.5] }, n: { [Z]: [20] } }, M), [wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 2 }]) })]);
  R.eq(one.hits.length, 1, "a one-name scope is rejected at p <= q");
  const low = new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], cols: { [Z]: [1.9] }, n: { [Z]: [20] } }, M), [wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 1.75 }]) })]);
  R.eq(low.hits.length, 0, "and a one-name scope at z = 1.9 is above p = 0.05");
  const lowerBody = bodyOf("nightly", [{ m: Z, op: "<=", x: -2.5 }]);
  const lw = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: lowerBody });
  const neg = base.map((_, i) => (i < 6 ? -4.5 : 0.5));
  R.eq(new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: base, cols: { [Z]: neg }, n: { [Z]: base.map(() => 20) } }, M), [lw]).hits.length, 6, "a <= clause tests the lower tail");
  const tied = base.map((_, i) => (i < 4 ? 5 : 0.5));
  const tw = new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: base, cols: { [Z]: tied }, n: { [Z]: base.map(() => 20) } }, M), [wire]);
  R.eq(tw.hits.length, 4, "names tied at the cutoff are all rejected");
}

function threeValued(M, R) {
  const cases = { T: [4, 5], F: [1, 20], U: [null, null] };
  const kleene = (a, b) => (a === "F" || b === "F" ? "F" : a === "U" || b === "U" ? "U" : "T");
  for (const a of "TFU") {
    for (const b of "TFU") {
      const body = bodyOf("nightly", [{ m: CHG, op: ">=", x: 3 }, { m: "earn.sessions", op: "<=", x: 10 }]);
      const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body });
      const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000", "SYB001"], cols: { [CHG]: [cases[a][0], 4], "earn.sessions": [cases[b][1], 5] } }, M);
      const p = M.engine.preview(snap, wire);
      const want = kleene(a, b);
      R.eq([p.wouldHit - 1, p.unknown - 0, p.evaluated - 1], [want === "T" ? 1 : 0, want === "U" ? 1 : 0, want === "U" ? 0 : 1], `Kleene AND ${a} and ${b} is ${want}`);
      const r = new Store().run(M, snap, [wire]).receipts[0];
      R.eq([r.names_evaluated, r.names_absent], [want === "U" ? 1 : 2, want === "U" ? 1 : 0], `the receipt counts ${a} and ${b} as ${want}`);
    }
  }
  const t01 = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: T("T01").ast });
  const warming = snapshotOf({
    kind: "nightly", session: "2026-03-09", symbols: ["SYA000", "SYB001"],
    cols: { [Z]: [null, 4], "earn.confirmed": [1, 1], "earn.sessions": [25, 5] }, n: { [Z]: [11, 20] }, why: { [Z]: { warming: [0] } },
  }, M);
  const r = new Store().run(M, warming, [t01]).receipts[0];
  R.eq([r.names_evaluated, r.names_absent], [2, 0], "T01 with the report 25 sessions away and z still warming is FALSE, not unknown");
  const exit = bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }, { m: "earn.sessions", op: "<=", x: 10 }], { scope: { kind: "names", symbols: ["SYA000"] }, cooldown: { unit: "session", n: 1 } });
  const ew = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: exit });
  const store = new Store();
  const night = (s, z, e) => store.run(M, snapshotOf({ kind: "nightly", session: s, symbols: ["SYA000"], cols: { [Z]: [z], "earn.sessions": [e] }, n: { [Z]: [20] } }, M), [ew]);
  night("2026-03-02", 3.5, 5);
  night("2026-03-03", 2, null);
  const again = night("2026-03-04", 3.5, 5);
  R.eq([store.hits.length, again.hits.length], [2, 1], "any clause FALSE at its relaxed threshold exits even if another is UNKNOWN");
  const kept = new Store();
  const nightK = (s, z, e) => kept.run(M, snapshotOf({ kind: "nightly", session: s, symbols: ["SYA000"], cols: { [Z]: [z], "earn.sessions": [e] }, n: { [Z]: [20] } }, M), [ew]);
  nightK("2026-03-02", 3.5, 5);
  nightK("2026-03-03", null, null);
  nightK("2026-03-04", 3.5, 5);
  R.eq(kept.hits.length, 1, "while all-unknown freezes the phase and no second hit appears");
}

function freshnessScenarios(M, R) {
  const mk = (over) => windowWire(M, over);
  const liveRun = (wire, snap) => new Store().run(M, snap, [wire]);
  const win = [{ premium: 1500000 }];
  const age = (s) => liveSnap(M, { session: "2026-03-09", look: 3, windows: win, sourceAge: s });
  const ok = liveRun(mk({}), age(1800));
  R.eq([ok.receipts[0].status, ok.hits.length], ["evaluated", 1], "a Tier 2 source 1,800 s old is still fresh");
  const stale = liveRun(mk({}), age(1801));
  R.eq([stale.receipts[0].status, stale.receipts[0].reason, stale.hits.length], ["not_evaluated", "source_stale", 0], "at 1,801 s it is stale: unknown, never carried forward");
  const tier1 = (s) => {
    const snap = age(0);
    snap.sources["live:alerts"] = { session: "2026-03-09", asOf: snap.now - s * 1000, tier: 1 };
    return liveRun(mk({}), snap);
  };
  R.eq([tier1(720).hits.length, tier1(721).receipts[0].reason], [1, "source_stale"], "a Tier 1 source goes stale at 720 s");
  const yesterday = age(60);
  yesterday.sources["live:alerts"].session = "2026-03-06";
  R.eq(liveRun(mk({}), yesterday).receipts[0].reason, "source_stale", "a live source from another session is stale");
  const missing = age(60);
  delete missing.sources["live:alerts"];
  R.eq(liveRun(mk({}), missing).receipts[0].reason, "source_missing", "a live source that is not there is missing");
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }, { m: "earn.sessions", op: "<=", x: 10 }], { scope: { kind: "names", symbols: ["SYA000", "SYB001"] } }) });
  const nightly = (sources, cols, n) => snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000", "SYB001"], cols, n, sources }, M);
  const fresh = { hist: { session: "2026-03-09", asOf: 1 }, universe: { session: "2026-03-09", asOf: 1 }, "card-x": { session: "2026-03-09", asOf: 1 } };
  const cols = { [Z]: [4, 0.5], "earn.sessions": [5, 5] };
  const n = { [Z]: [20, 20] };
  const oldHist = nightly({ ...fresh, hist: { session: "2026-03-06", asOf: 1 } }, cols, n);
  const stR = new Store().run(M, oldHist, [wire]).receipts[0];
  R.eq([stR.status, stR.reason], ["not_evaluated", "source_stale"], "a nightly source one session behind is stale (maxAgeSessions 0)");
  const slowOk = nightly({ ...fresh, universe: { session: "2026-03-02", asOf: 1 } }, cols, n);
  R.eq(new Store().run(M, slowOk, [wire]).receipts[0].names_absent, 0, "a slow field five sessions old is fresh (2026-03-02 to 2026-03-09)");
  const slowOld = nightly({ ...fresh, universe: { session: "2026-02-27", asOf: 1 } }, cols, n);
  const slowR = new Store().run(M, slowOld, [wire]).receipts[0];
  R.eq([slowR.names_absent, slowR.names_evaluated], [1, 1], "six sessions old is stale: the TRUE name is unknown, the FALSE name is still known");
  R.eq(JSON.parse(slowR.absent_json), { stale: { n: 1, sample: ["SYA000"] } }, "and the receipt names the reason");
  const range = new Store().run(M, nightly(fresh, { [Z]: [60, 0.5], "earn.sessions": [5, 5] }, n), [wire]).receipts[0];
  R.eq(JSON.parse(range.absent_json), { out_of_range: { n: 1, sample: ["SYA000"] } }, "a z of 60 is out of range: unknown, never clipped");
  const thin = new Store().run(M, nightly(fresh, cols, { [Z]: [14, 20] }), [wire]).receipts[0];
  R.eq(JSON.parse(thin.absent_json), { warming: { n: 1, sample: ["SYA000"] } }, "a baseline count of 14 makes the value unknown even if the leg shipped it");
  const absentCol = new Store().run(M, nightly(fresh, { [Z]: [4, 0.5] }, n), [wire]).receipts[0];
  R.eq([absentCol.status, absentCol.names_evaluated, absentCol.names_absent], ["evaluated", 1, 1], "a missing column makes names with a TRUE other clause unknown, and names with a FALSE one known");
  const both = new Store().run(M, nightly(fresh, {}, n), [wire]).receipts[0];
  R.eq([both.status, both.reason], ["not_evaluated", "source_missing"], "no columns at all is source_missing");
  const trunc = age(60);
  trunc.truncated = { "live:alerts": true };
  const tr = liveRun(mk({}), trunc);
  R.eq([tr.receipts[0].status, tr.receipts[0].reason], ["evaluated", "record_truncated"], "a truncated record is evaluated and says so");
  const empty = liveRun(mk({}), liveSnap(M, { session: "2026-03-09", look: 3, windows: [] }));
  R.eq([empty.receipts[0].status, empty.receipts[0].names_evaluated, empty.hits.length], ["evaluated", 0, 0], "an empty flagged list is a look with nothing to see, not a missed look");
}

function receiptShape(M, R) {
  const rng = mulberry32(14);
  const symbols = symbolsOf(60);
  const reasons = ["warming", "stale", "missing", "out_of_range", "thin"];
  for (let tr = 0; tr < (R.heavy ? 12 : 3); tr++) {
    const zs = symbols.map(() => (rng() < 0.4 ? null : q2((rng() - 0.3) * 6)));
    const why = {};
    zs.forEach((z, i) => {
      if (z !== null) return;
      const r = reasons[Math.floor(rng() * reasons.length)];
      (why[r] || (why[r] = [])).push(i);
    });
    const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }]) });
    const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols, cols: { [Z]: zs }, n: { [Z]: symbols.map(() => 20) }, why: { [Z]: why } }, M);
    const rc = new Store().run(M, snap, [wire]).receipts[0];
    R.eq(rc.names_evaluated + rc.names_absent, 60, "the nightly count invariant");
    const hist = JSON.parse(rc.absent_json || "{}");
    const wantCounts = {};
    for (const [r, idx] of Object.entries(why)) wantCounts[r] = idx.length;
    R.eq(Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, v.n])), wantCounts, "the reason histogram");
    for (const [r, v] of Object.entries(hist)) R.eq(v.sample, why[r].map((i) => symbols[i]).sort().slice(0, 5), "samples are the alphabetically first five: " + r);
  }
  const rev = ["SYE004", "SYD003", "SYH007", "SYC002", "SYG006", "SYB001", "SYF005", "SYA000"];
  const revWire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "names", symbols: rev } }) });
  const revR = new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: rev, cols: { [Z]: rev.map(() => null) }, n: { [Z]: rev.map(() => 20) }, why: { [Z]: { warming: rev.map((_, i) => i) } } }, M), [revWire]).receipts[0];
  R.eq(JSON.parse(revR.absent_json).warming.sample, rev.slice().sort().slice(0, 5), "samples are the first five by name, whatever the scope's order");
  const big = symbolsOf(800);
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }]) });
  const why = {};
  const cols = big.map((_, i) => null);
  const kinds = ["warming", "stale", "missing", "out_of_range", "thin", "not_carded", "short_history", "unit_unverified", "sector_coverage", "event_inside_window"];
  big.forEach((_, i) => {
    const r = kinds[i % kinds.length];
    (why[r] || (why[r] = [])).push(i);
  });
  const rc = new Store().run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: big, cols: { [Z]: cols }, n: { [Z]: big.map(() => 20) }, why: { [Z]: why } }, M), [wire]).receipts[0];
  R.ok((rc.absent_json || "").length <= 2048, "the absent histogram fits 2 KiB with 800 absent names: " + (rc.absent_json || "").length);
  const parsed = JSON.parse(rc.absent_json);
  R.eq(Object.values(parsed).reduce((n, v) => n + v.n, 0), 800, "and never drops a count");
  R.eq(Object.keys(parsed).length, 10, "ten reasons");
  R.ok(Object.values(parsed).every((v) => v.sample.length === 5), "five names kept for each");
  const reasons12 = ["stale", "missing", "thin", "warming", "out_of_range", "not_carded", "not_in_live_set", "record_truncated", "event_inside_window", "sector_coverage", "short_history", "unit_unverified"];
  const sectorNames = Array.from({ length: 60 }, (_, i) => "S" + String(i).padStart(2, "0") + "x".repeat(37));
  const sectorWhy = {};
  sectorNames.forEach((_, i) => {
    const r = reasons12[i % 12];
    (sectorWhy[r] || (sectorWhy[r] = [])).push(i);
  });
  const sw = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: "sector.breadth_pos", op: ">=", x: 0.6 }]) });
  const sectorSnap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: [], sectors: { names: sectorNames, cols: { "sector.breadth_pos": sectorNames.map(() => null) }, why: { "sector.breadth_pos": sectorWhy } } }, M);
  const lr = new Store().run(M, sectorSnap, [sw]).receipts[0];
  const lp = JSON.parse(lr.absent_json);
  R.ok(lr.absent_json.length <= 2048, "with twelve reasons and sector names of forty characters the histogram still fits 2 KiB: " + lr.absent_json.length);
  R.eq([Object.keys(lp).length, Object.values(lp).reduce((n, v) => n + v.n, 0), Object.values(lp).some((v) => "sample" in v)], [12, 60, false], "the samples go first and no count is lost");
  const two = bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }, { m: CHG, op: ">=", x: 3 }]);
  const tw = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: two });
  const t2 = new Store().run(M, snapshotOf({
    kind: "nightly", session: "2026-03-09", symbols: ["SYA000", "SYB001", "SYC002"], cols: { [Z]: [null, 4, 0.5], [CHG]: [null, null, 0.5] }, n: { [Z]: [20, 20, 20] },
    why: { [Z]: { warming: [0] }, [CHG]: { stale: [0, 1] } },
  }, M), [tw]).receipts[0];
  R.eq(JSON.parse(t2.absent_json), { stale: { n: 2, sample: ["SYA000", "SYB001"] } }, "a name unknown on two clauses is filed under the stronger reason");
}

function capScenarios(M, R) {
  const symbols = symbolsOf(40);
  const zs = symbols.map((_, i) => q2(9 - i * 0.1));
  const mkWire = (id, memberId, layer = "member") =>
    wireOf(M, { id, layer, memberId, body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }]) });
  const snap = (session = "2026-03-09") => snapshotOf({ kind: "nightly", session, symbols, cols: { [Z]: zs }, n: { [Z]: symbols.map(() => 20) } }, M);
  const ids = ["w-aaaaaaaaaaaaaaaa", "w-bbbbbbbbbbbbbbbb", "w-cccccccccccccccc"];
  const one = new Store().run(M, snap(), [mkWire(ids[0], "member01")]);
  R.eq([one.hits.length, one.receipts[0].hits, one.receipts[0].hits_capped, one.capped.length], [10, 10, 30, 30], "a member wire writes ten hits a session and counts the rest");
  R.eq(one.hits.map((h) => h.symbol), symbols.slice(0, 10), "the ten strongest, by margin");
  const house = new Store().run(M, snap(), [mkWire("h-t06", null, "house")]);
  R.eq([house.hits.length, house.receipts[0].hits_capped], [10, 30], "a nightly house wire writes ten");
  const win = (n) => {
    const now = t("2026-03-09T14:00:00Z");
    const rows = Array.from({ length: n }, (_, k) => ({ symbol: symbols[k], occ: occOf(symbols[k], k), spanStart: now - 600000, cols: { "contract.premium": 2000000 - k * 10000 } }));
    return snapshotOf({ kind: "live", session: "2026-03-09", now, look: 3, symbols, windows: rows, sources: { "live:alerts": { session: "2026-03-09", asOf: now - 30000 } } }, M);
  };
  const lw = (id, layer, memberId) => wireOf(M, { id, layer, memberId, body: bodyOf("live", [{ m: "contract.premium", op: ">=", x: 1000000 }]) });
  const liveHouse = new Store().run(M, win(40), [lw("h-t03", "house", null)]);
  R.eq(liveHouse.hits.length, 20, "a live house wire writes twenty");
  R.eq(liveHouse.hits.map((h) => h.symbol), symbols.slice(0, 20), "the highest premium first");
  const liveMember = new Store().run(M, win(40), [lw(ids[0], "member", "member01")]);
  R.eq(liveMember.hits.map((h) => h.symbol), symbols.slice(0, 10), "a live member wire keeps the ten largest windows");
  const used = new Store().run(M, win(40), [lw(ids[0], "member", "member01")], { capUsed: { wire: new Map([[ids[0], 8]]), member: new Map(), global: 0 } });
  R.eq(used.hits.length, 2, "capUsed leaves room for the rest of the cap");
  const usedMember = new Store().run(M, snap(), ids.map((id) => mkWire(id, "member01")), { capUsed: { wire: new Map(), member: new Map([["member01", 20]]), global: 0 } });
  R.eq(usedMember.hits.length, 5, "and the member's earlier hits count against its 25");
  const usedGlobal = new Store().run(M, snap(), [mkWire(ids[0], "member01")], { capUsed: { wire: new Map(), member: new Map(), global: 497 } });
  R.eq(usedGlobal.hits.length, 3, "and the global 500");
  const three = new Store().run(M, snap(), ids.map((id) => mkWire(id, "member01")));
  R.eq(three.hits.length, 25, "a member's three wires write 25 together");
  const per = ids.map((id) => three.hits.filter((h) => h.wire_id === id).length);
  R.eq(per.slice().sort(), [8, 8, 9], "in rounds of rank within each wire");
  const clauseHash = mkWire(ids[0], "member01").clauseHash;
  const hitIdOf = (id, sym) => M.ids.hitId(id, M.ids.keyFor({ layer: "member", subject: "n:" + sym, session: "2026-03-09", clauseHash }));
  const roundNine = three.hits.filter((h) => h.symbol === symbols[8]).map((h) => h.hit_id);
  R.eq(roundNine, [ids.map((id) => hitIdOf(id, symbols[8])).sort()[0]], "the ninth place goes to the lowest hit id of its round");
  R.eq(three.receipts.map((r) => r.hits_capped).sort((a, b) => a - b), [31, 32, 32], "each wire counts what it lost");
  const uniqueWires = Array.from({ length: 60 }, (_, i) =>
    mkWire("w-aaaaaaaa" + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)) + "aaaaaa", "member" + String(i).padStart(2, "0")));
  const global = new Store().run(M, snap(), uniqueWires);
  R.eq(global.hits.length, 500, "600 member hits are cut to the global 500");
  const perMember = new Map();
  for (const h of global.hits) perMember.set(h.member_id, (perMember.get(h.member_id) || 0) + 1);
  R.eq([Math.min(...perMember.values()), Math.max(...perMember.values())], [8, 9], "in rounds of rank within each member");
  const candidates = uniqueWires.map((w) => hitIdOf(w.id, symbols[8])).sort();
  const keptNine = global.hits.filter((h) => h.symbol === symbols[8]).map((h) => h.hit_id).sort();
  R.eq(keptNine, candidates.slice(0, 20), "and the last round keeps the twenty lowest hit ids");
  const store = new Store();
  store.run(M, snap(), [mkWire(ids[0], "member01")]);
  const next = store.run(M, snap("2026-03-10"), [mkWire(ids[0], "member01")]);
  R.eq([next.hits.length, next.capped.length], [0, 0], "a capped hit still moved its state: the next night proposes nothing");
  R.eq(Array.from(store.rows.values()).filter((r) => r.phase === "firing").length, 40, "all forty subjects are firing, written or capped");
}

function evidenceAndReplay(M, R) {
  const eight = bodyOf("nightly", [
    { m: Z, op: ">=", x: 3 }, { m: "flow.volume.z20", op: ">=", x: 3 }, { m: "earn.sessions", op: "<=", x: 20 }, { m: "earn.sessions", op: ">=", x: 1 },
    { m: "earn.confirmed", op: "==", x: 1 }, { m: CHG, op: ">=", x: 1 }, { m: "vol.rr25.30d", op: ">=", x: -20 }, { m: "vol.iv.30d.zvov", op: ">=", x: 2 },
  ], { persist: 1, scope: { kind: "names", symbols: ["SYA000", "SYB001"] } });
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: eight, over: { sentence: "x".repeat(280) } });
  const cols = { [Z]: [9, 0], "flow.volume.z20": [9, 0], "earn.sessions": [5, 5], "earn.confirmed": [1, 1], [CHG]: [5, 5], "vol.rr25.30d": [3, 3], "vol.iv.30d.zvov": [9, 0] };
  const n = Object.fromEntries(["flow.net_premium.z20", "flow.volume.z20", "vol.iv.30d.zvov"].map((k) => [k, [20, 20]]));
  const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000", "SYB001"], cols, n, floored: { [Z]: [1, 0] } }, M);
  const res = new Store().run(M, snap, [wire]);
  R.eq(res.hits.length, 1, "an eight-clause wire fires");
  const text = res.hits[0].evidence_json;
  R.ok(new TextEncoder().encode(text).length <= 4096, "its evidence fits 4 KiB: " + new TextEncoder().encode(text).length);
  const ev = JSON.parse(text);
  R.eq(M.engine.checkEvidence(ev), [], "no price, return, loss or volatility key in the evidence");
  R.eq(ev.clauses.length, 8, "all eight clauses are in it");
  R.eq(M.engine.replayDecision(ev), { ok: true, reasons: [] }, "re-evaluating the frozen clause values reproduces the decision");
  const bytes = (s) => new TextEncoder().encode(s).length;
  R.ok(bytes(text) > 1500 && bytes(text) < 2500, "eight clauses with their sentence and sources are about 2 KiB: " + bytes(text));
  const wordy = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: eight, over: { sentence: "x".repeat(3700) } });
  const slim = new Store().run(M, snap, [wordy]).hits[0].evidence_json;
  R.ok(bytes(slim) <= 4096 && !("sources" in JSON.parse(slim)) && !("wireSentence" in JSON.parse(slim)), "an oversize record drops its sources and sentence: " + bytes(slim));
  R.eq(M.sentence.renderHit(JSON.parse(slim)).rows.length, 8, "and still renders");
  const hostile = { ...wire, clauses: wire.clauses.map((c) => ({ ...c, label: "L".repeat(600) })) };
  const steady = wireOf(M, { id: "w-bbbbbbbbbbbbbbbb", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "names", symbols: ["SYA000"] } }) });
  const refused = new Store().run(M, snap, [hostile, steady]);
  R.eq([refused.errors.map((e) => e.wire_id), refused.receipts.find((r) => r.wire_id === wire.id).reason, refused.state.upserts.some((u) => u.wire_id === wire.id), refused.hits.map((h) => h.wire_id)], [[wire.id], "evaluator_error", false, ["w-bbbbbbbbbbbbbbbb"]], "a record that cannot fit costs that wire its night, loudly, with no state moved, and no other wire");
  const bad = clone(ev);
  bad.clauses[0].value = 2.5;
  R.eq(M.engine.replayDecision(bad), { ok: false, reasons: [Z] }, "a changed value fails the replay");
  const noBh = clone(ev);
  noBh.bh = { m: 2, k: 1, q: 0.05, e: 100, cutoff: 500 };
  R.eq(M.engine.replayDecision(noBh).reasons, ["bh"], "a BH line the name misses fails the replay");
  R.eq(M.engine.checkEvidence({ a: { px: 1, ref_px: 2, price: 3, iv: 4, ret5: 5, pnl: 6, retx: 1, ok: 1 } }).length, 7, "the validator names every rejected key");
  R.eq(M.engine.checkEvidence({ clauses: [{ m: "vol.iv.30d.chg1d", value: 1 }] }), [], "a metric id is a value, not a key");
  const rng = mulberry32(3);
  const symbols = symbolsOf(80);
  const zs = symbols.map(() => (rng() < 0.3 ? q2(3 + rng() * 5) : q2(rng() * 3)));
  const wires = [0, 1, 2, 3].map((k) => wireOf(M, { id: "w-" + "aaaaaaaaaaaaaa" + "a" + String.fromCharCode(97 + k), memberId: "member0" + k, body: bodyOf("nightly", [{ m: Z, op: ">=", x: 2 + k * 0.5 }]) }));
  const mk = () => snapshotOf({ kind: "nightly", session: "2026-03-09", symbols, cols: { [Z]: zs }, n: { [Z]: symbols.map(() => 20) } }, M);
  const a = new Store().run(M, mk(), wires);
  const b = new Store().run(M, mk(), wires.slice().reverse());
  R.eq(JSON.stringify(a), JSON.stringify(b), "a replay with the wires in another order is byte for byte the same");
  for (const h of a.hits) R.eq(M.engine.replayDecision(JSON.parse(h.evidence_json)).ok, true, "every hit replays: " + h.hit_id);
  R.ok(a.hits.length > 0, "the replay world has hits");
  const frozen = mk();
  deepFreeze(frozen);
  deepFreeze(wires);
  const f = new Store().run(M, frozen, wires);
  R.eq(JSON.stringify(f), JSON.stringify(a), "inputs may be frozen: the engine writes to none of them");
  const sorted = a.hits.map((h) => h.wire_id + "\u0000" + h.subject);
  R.eq(sorted, sorted.slice().sort(), "output is sorted by wire and subject");
  const ordered = a.state.upserts.map((u) => u.wire_id + "\u0000" + u.subject);
  R.eq(ordered, ordered.slice().sort(), "so are the state rows");
}

function deepFreeze(v) {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

function windowScenarios(M, R) {
  const wire = (over = {}) => windowWire(M, { cadence: "nightly", id: "w-bbbbbbbbbbbbbbbb", over: { cooldown: { unit: "session", n: 1 } }, ...over });
  const snapW = (session, rows, extra = {}) => {
    const now = t(session + "T22:00:00Z");
    return snapshotOf({
      kind: "nightly", session, symbols: ["SYA000", "SYB001"],
      windows: rows.map((r, k) => ({ symbol: "SYA000", occ: occOf("SYA000", r.k ?? 0), spanStart: r.spanStart ?? 1000 + k, cols: { "contract.premium": r.premium, ...(r.cols || {}) }, ...(r.extra || {}) })),
      sources: { flowalerts: { session, asOf: now - 600000 } }, now, ...extra,
    }, M);
  };
  const res = new Store().run(M, snapW("2026-03-09", [{ premium: 1200000 }, { premium: 1800000 }, { premium: 900000 }]), [wire()]);
  R.eq(res.hits.length, 1, "several windows of one contract make one subject");
  R.eq(JSON.parse(res.hits[0].evidence_json).clauses[0].value, 1800000, "the evidence names the strongest window");
  R.eq(res.receipts[0].names_evaluated, 1, "and the receipt counts the contract once");
  const two = wire({ extra: [{ m: "contract.dte", op: "<=", x: 30 }] });
  const lead = two.clauses[two.lead].m;
  const other = lead === "contract.premium" ? "contract.dte" : "contract.premium";
  const lv = lead === "contract.premium" ? 2000000 : 10;
  const ov = (k) => (other === "contract.premium" ? 2000000 + k * 1000000 : 10 + k * 10);
  const tieRows = (aSpan, bSpan) => [
    { premium: 2000000, spanStart: aSpan, cols: { [lead]: lv, [other]: ov(0) } },
    { premium: 2000000, spanStart: bSpan, cols: { [lead]: lv, [other]: ov(1) } },
  ];
  const otherValue = (rows) => {
    const r = new Store().run(M, snapW("2026-03-09", rows), [two]);
    return JSON.parse(r.hits[0].evidence_json).clauses.find((c) => c.m === other).value;
  };
  R.eq(otherValue(tieRows(5000, 3000)), ov(1), "equal margins: the window with the earlier span is the evidence");
  R.eq(otherValue(tieRows(3000, 5000)), ov(0), "and the other way round");
  const mixed = new Store().run(M, snapW("2026-03-09", [{ premium: null }, { premium: 500000 }, { premium: 500000, k: 1 }]), [wire()]);
  R.eq([mixed.receipts[0].names_evaluated, mixed.receipts[0].names_absent, mixed.hits.length], [1, 1, 0], "one unknown window and one FALSE window make the contract unknown");
  const only = new Store().run(M, snapW("2026-03-09", [{ premium: null }, { premium: 500000 }]), [wire()]);
  R.eq([only.receipts[0].status, only.receipts[0].reason], ["not_evaluated", "source_missing"], "a look where every subject is missing is not a look");
  const allFalse = new Store().run(M, snapW("2026-03-09", [{ premium: 100 }, { premium: 200 }]), [wire()]);
  R.eq([allFalse.receipts[0].names_evaluated, allFalse.hits.length], [1, 0], "all FALSE is FALSE");
  const s2 = new Store();
  s2.run(M, snapW("2026-03-09", [{ premium: 1500000 }, { premium: 100 }]), [wire()]);
  const stays = s2.run(M, snapW("2026-03-10", [{ premium: 100 }, { premium: 1500000 }]), [wire()]);
  R.eq([s2.hits.length, stays.hits.length], [1, 0], "a contract that is still TRUE in one window next night is still firing");
  const exits = s2.run(M, snapW("2026-03-11", [{ premium: 100 }, { premium: 200 }]), [wire()]);
  R.eq([exits.state.deletes.length, s2.rows.size], [1, 0], "it exits only when every window is FALSE");
  const bad = new Store().run(M, snapW("2026-03-09", [
    { premium: 1500000 }, { premium: 1500000, k: 1, extra: { occ: "" } }, { premium: 1500000, k: 2, extra: { occ: "A:B" } },
    { premium: 1500000, k: 3, extra: { occ: "O".repeat(41) } }, { premium: 1500000, k: 4, extra: { symbol: "bad sym" } },
  ]), [wire()]);
  R.eq([bad.hits.length, bad.receipts[0].names_evaluated, bad.receipts[0].names_absent], [1, 1, 4], "a window with no usable contract id or name is absent, never a hit");
  const wrong = new Store().run(M, snapW("2026-03-09", [{ premium: 1500000 }]), [windowWire(M, { cadence: "nightly", id: "w-bbbbbbbbbbbbbbbb", scope: { kind: "names", symbols: ["SYB001"] }, over: { cooldown: { unit: "session", n: 1 } } })]);
  R.eq([wrong.hits.length, wrong.receipts[0].names_evaluated], [0, 0], "a names scope filters the windows");
  const sector = new Store().run(M, snapW("2026-03-09", [{ premium: 1500000 }]), [windowWire(M, { cadence: "nightly", id: "w-bbbbbbbbbbbbbbbb", scope: { kind: "sector", sector: SECTORS[0] }, over: { cooldown: { unit: "session", n: 1 } } })]);
  R.eq(sector.hits.length, 1, "a sector scope uses the symbol's sector");
  const other2 = new Store().run(M, snapW("2026-03-09", [{ premium: 1500000 }]), [windowWire(M, { cadence: "nightly", id: "w-bbbbbbbbbbbbbbbb", scope: { kind: "sector", sector: SECTORS[1] }, over: { cooldown: { unit: "session", n: 1 } } })]);
  R.eq(other2.hits.length, 0, "and another sector's windows are not the wire's");
}

function liveTickScenarios(M, R) {
  const wire = windowWire(M, { persist: 2 });
  const store = new Store();
  const tick = (k, premium) => store.run(M, liveSnap(M, { session: "2026-03-09", look: k, windows: [{ premium }] }), [wire]);
  tick(0, 1500000);
  tick(0, 1500000);
  R.eq(store.rowOf(wire.id, "c:SYA000:" + occOf("SYA000", 0)).cnt, 1, "a tick offered twice counts once");
  const hit = tick(1, 1500000);
  R.eq(hit.hits.length, 1, "persistence two is met on the second distinct tick");
  R.eq(store.rows.size, 0, "a live hit leaves no row");
  const quietTicks = [2, 3, 4].map((k) => tick(k, k % 2 ? 1500000 : 500000));
  R.eq(quietTicks.every((r) => r.hits.length === 0 && r.state.upserts.length === 0), true, "the rest of the session writes no state: the dedupe key is the quiet period");
  R.eq(store.rows.size, 0, "and no row stays behind");
  const next = store.run(M, liveSnap(M, { session: "2026-03-10", look: 0, windows: [{ premium: 1500000 }] }), [wire]);
  R.eq(next.state.upserts[0].cnt, 1, "a new session counts from one");
  const stale = new Store();
  const w2 = windowWire(M, { persist: 3 });
  stale.run(M, liveSnap(M, { session: "2026-03-09", look: 9, windows: [{ premium: 1500000 }] }), [w2]);
  stale.run(M, liveSnap(M, { session: "2026-03-09", look: 10, windows: [{ premium: 1500000 }] }), [w2]);
  const morning = stale.run(M, liveSnap(M, { session: "2026-03-10", look: 0, windows: [{ premium: 1500000 }] }), [w2]);
  R.eq([morning.hits.length, morning.state.upserts[0].cnt, morning.state.upserts[0].last_session], [0, 1, "2026-03-10"], "yesterday's afternoon ticks do not count towards today's open");
  const gone = new Store();
  const w3 = windowWire(M, { persist: 2 });
  gone.run(M, liveSnap(M, { session: "2026-03-09", look: 0, windows: [{ premium: 1500000 }] }), [w3]);
  const absent = gone.run(M, liveSnap(M, { session: "2026-03-09", look: 1, windows: [] }), [w3]);
  R.eq([absent.receipts[0].names_absent, JSON.parse(absent.receipts[0].absent_json).not_in_live_set.n, gone.rows.size], [1, 1, 1], "a pending contract that is not in this tick is absent, not forgotten");
  const flow = bodyOf("live", [{ m: "flow.net_premium", op: ">=", x: 5000000 }], { scope: { kind: "names", symbols: ["SYA000"] } });
  const fw = wireOf(M, { id: "w-eeeeeeeeeeeeeeee", body: flow });
  const fs = new Store();
  const strip = (k, v) => {
    const now = t("2026-03-09T14:00:00Z") + k * 300000;
    return snapshotOf({ kind: "live", session: "2026-03-09", now, look: k, symbols: ["SYA000"], cols: { "flow.net_premium": [v] }, sources: { "live:strips": { session: "2026-03-09", asOf: now - 30000 } } }, M);
  };
  fs.run(M, strip(0, 6000000), [fw]);
  const still = fs.run(M, strip(1, 6500000), [fw]);
  R.eq([fs.hits.length, fs.rows.size, still.hits.length], [0, 1, 0], "a live state wire that is already TRUE on its first look does not fire");
  fs.run(M, strip(2, 1000000), [fw]);
  const cross = fs.run(M, strip(3, 6000000), [fw]);
  R.eq(cross.hits.length, 1, "it fires on the crossing");
  const carry = new Store();
  const w4 = windowWire(M, { persist: 2 });
  const at = (s, k) => carry.run(M, liveSnap(M, { session: s, look: k, windows: [{ premium: 1500000 }] }), [w4]);
  at("2026-03-09", 0);
  at("2026-03-10", 0);
  R.eq(at("2026-03-10", 1).hits.length, 1, "a pending count from yesterday is refreshed at the first tick of today, so today's second tick fires");
}

function stateEdgeScenarios(M, R) {
  const mk = (op, x, cooldown = 1) => bodyOf("nightly", [{ m: "earn.implied_ratio", op, x }], { scope: { kind: "names", symbols: ["SYA000"] }, cooldown: { unit: "session", n: cooldown } });
  const run = (body, looks) => {
    const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body });
    const store = new Store();
    const sessions = sessionsFrom(M, "2026-03-02", looks.length);
    const hits = [];
    looks.forEach((v, i) => {
      const before = store.hits.length;
      store.run(M, snapshotOf({ kind: "nightly", session: sessions[i], symbols: ["SYA000"], cols: { "earn.implied_ratio": [v] } }, M), [wire]);
      if (store.hits.length > before) hits.push(i);
    });
    return { hits, store };
  };
  R.eq(run(mk(">=", 1.5), [1.6, 1.48, 1.55]).hits, [2], "T07 fresh TRUE, a dip below the line, then TRUE: a hit on the third look");
  R.eq(run(mk(">=", 1.5), [1.6, 1.6, 1.6]).hits, [], "T07 TRUE from the first look and never FALSE: no hit");
  R.eq(run(mk(">=", 1.5), [null, 1.6, 1.4, 1.6]).hits, [3], "unknown is not a FALSE: the first TRUE after an unknown first look is consumed");
  R.eq(run(mk(">=", 1.5), [1.4, 1.6, 1.43, 1.6, 1.42, 1.6]).hits, [1, 5], "firing holds down to 1.43 and exits at 1.42");
  R.eq(run(mk("<=", 0.7), [0.9, 0.6, 0.73, 0.5, 0.74, 0.5]).hits, [1, 5], "the mirror: 0.73 holds, 0.74 exits");
  const consumed = run(mk(">=", 1.5), [1.6, 1.6, 1.6, 1.6]);
  R.eq(consumed.store.rows.size, 1, "a consumed state is one pending row");
  R.eq(JSON.parse(Array.from(consumed.store.rows.values())[0].detector_json).f, 0, "marked as never seen false");
  const writes = run(mk(">=", 1.5), [1.6, 1.6, 1.6, 1.6, 1.6, 1.6]).store.writes;
  const writes2 = run(mk(">=", 1.5), [1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6]).store.writes;
  R.eq(writes2 - writes, 2, "and the further nights write only their receipt");
  const event = bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "names", symbols: ["SYA000"] } });
  const ew = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: event });
  const es = new Store();
  es.run(M, snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], cols: { [Z]: [4] }, n: { [Z]: [20] } }, M), [ew]);
  R.eq(es.hits.length, 1, "an event wire fires on its first look");
  const state1 = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: mk(">=", 1.5) });
  const st = new Store();
  const snapAt = (s, v) => snapshotOf({ kind: "nightly", session: s, symbols: ["SYA000"], cols: { "earn.implied_ratio": [v] } }, M);
  st.run(M, snapAt("2026-03-02", 1.6), [state1]);
  st.run(M, snapAt("2026-03-03", 1.4), [state1]);
  const changed = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", version: 2, body: mk(">=", 1.55) });
  const odd = new Store();
  odd.run(M, snapAt("2026-03-02", 1.6), [state1]);
  odd.run(M, snapAt("2026-03-03", 1.4), [state1]);
  odd.run(M, snapAt("2026-03-04", 1.6), [state1]);
  const mm = odd.run(M, snapAt("2026-03-05", 1.7), [changed]);
  R.eq([mm.hits.length, mm.receipts[0].state_mismatch], [0, 1], "a row left by other clauses is counted and treated as a first look, so no false first-look hit");
  R.eq(Array.from(odd.rows.values()).map((r) => JSON.parse(r.detector_json).f), [0], "and is replaced by an unseen marker");
  const evMis = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", version: 2, body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3.25 }], { scope: { kind: "names", symbols: ["SYA000"] } }) });
  const em = new Store();
  em.rows.set("w-aaaaaaaaaaaaaaaa\u0000n:SYA000", { wire_id: "w-aaaaaaaaaaaaaaaa", subject: "n:SYA000", version: 1, phase: "firing", cnt: 0, last_session: "2026-03-02", cool_until: "2026-03-09", detector_json: '{"c":"0000000000"}' });
  const emr = em.run(M, snapshotOf({ kind: "nightly", session: "2026-03-10", symbols: ["SYA000"], cols: { [Z]: [4] }, n: { [Z]: [20] } }, M), [evMis]);
  R.eq([emr.hits.length, emr.receipts[0].state_mismatch], [1, 1], "an event wire fires through a stale row, and the receipt counts the mismatch");
}

function rerunScenarios(M, R) {
  const body = bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { persist: 2, scope: { kind: "names", symbols: ["SYA000"] } });
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body });
  const snap = (s, z) => snapshotOf({ kind: "nightly", session: s, symbols: ["SYA000"], cols: { [Z]: [z] }, n: { [Z]: [20] } }, M);
  const store = new Store();
  store.run(M, snap("2026-03-09", 3.5), [wire]);
  const again = store.run(M, snap("2026-03-09", 3.5), [wire]);
  R.eq([again.hits.length, again.state.upserts.length, again.state.deletes.length], [0, 0, 0], "persistence two with one TRUE night, run twice: no hit and no change");
  const next = store.run(M, snap("2026-03-10", 3.5), [wire]);
  R.eq(next.hits.length, 1, "the second night's hit comes on the second night");
  R.eq(store.receipts.get("w-aaaaaaaaaaaaaaaa@1@2026-03-09").looks, 1, "a nightly receipt is replaced, not added to");
  const late = store.run(M, snap("2026-03-06", 3.5), [wire]);
  R.eq([late.hits.length, late.state.upserts.length], [0, 0], "an older session run after a newer one changes nothing");
  const w1 = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "names", symbols: ["SYA000"] } }) });
  const lost = new Store();
  lost.run(M, snap("2026-03-09", 3.5), [w1]);
  lost.rows.clear();
  const redo = lost.run(M, snap("2026-03-09", 3.5), [w1]);
  R.eq([redo.hits.length, redo.receipts[0].duplicates, lost.conflicts, lost.hits.length], [0, 1, 0, 1], "state lost and the same night run again: the stored key is respected and counted, never offered twice");
}

function modeScenarios(M, R) {
  const body = bodyOf("nightly", [{ m: "vol.rr25.30d.x0", op: "==", x: 1 }], { scope: { kind: "names", symbols: ["SYA000"] } });
  const wire = (over = {}, extra = {}) => wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body, over, ...extra });
  const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], cols: { "vol.rr25.30d.x0": [1] } }, M);
  const run = (w, opts) => new Store().run(M, snap, [w], opts);
  R.eq(run(wire()).hits[0].state, "delivered", "a hit is delivered");
  R.eq(run(wire(), { mode: "shadow" }).hits[0].state, "held", "shadow mode holds every hit");
  R.eq(run(wire({ switch: "hold" })).hits[0].state, "held", "a held wire holds its hits");
  const off = run(wire({ switch: "off" }));
  R.eq([off.hits.length, off.receipts[0].status, off.receipts[0].reason, off.state.upserts.length], [0, "not_evaluated", "switch_off", 0], "a switched-off wire is not evaluated and changes no state");
  R.eq(run(wire({ status: "paused" })).receipts.length, 0, "a paused wire is skipped, with no receipt");
  R.eq(run(wire({ status: "retired" })).receipts.length, 0, "a retired wire is skipped");
  R.eq(run(wire({ effectiveSession: "2026-03-10" })).receipts.length, 0, "a version that takes effect tomorrow is skipped");
  R.eq(run(wire({ effectiveSession: "2026-03-09" })).hits.length, 1, "and evaluated on its own day");
  const live = wireOf(M, { id: "w-bbbbbbbbbbbbbbbb", body: bodyOf("live", [{ m: "contract.premium", op: ">=", x: 1000000 }]) });
  R.eq(run(live).receipts.length, 0, "a live wire is not run by the nightly snapshot");
  const t04 = M.house.compileHouse(M.house.houseById("h-t04"), { effectiveSession: "2026-03-02" });
  const blocked = run(t04);
  R.eq([blocked.receipts[0].status, blocked.receipts[0].reason, blocked.hits.length], ["not_evaluated", "metric_warming", 0], "T04 is registered and says it is warming");
  const conflict = M.house.compileHouse(M.house.houseById("h-t05"), { effectiveSession: "2026-03-02", pinned: "0".repeat(64) });
  R.eq(run(conflict).receipts[0].reason, "registry_conflict", "a house wire whose body no longer matches its pin is not evaluated");
  const poisoned = { ...wire({}, {}), get clauses() { throw new Error("boom"); } };
  const good = wireOf(M, { id: "w-cccccccccccccccc", body });
  const mixed = new Store().run(M, snap, [poisoned, good]);
  R.eq([mixed.errors.length, mixed.errors[0].wire_id, mixed.receipts.map((r) => r.reason)], [1, "w-aaaaaaaaaaaaaaaa", ["evaluator_error", null]], "an exception costs that wire only, with a receipt that says so");
  R.eq(mixed.hits.length, 1, "the other wire still fires");
  const safe = M.engine.evaluateSafe({ kind: "weekly" }, [], {});
  R.eq([safe.ok, typeof safe.error], [false, "string"], "evaluateSafe never throws");
  R.eq(M.engine.evaluateSafe(snap, [good], {}).ok, true, "and passes a good run through");
  const t03 = M.house.compileHouse(M.house.houseById("h-t03"), { effectiveSession: "2026-03-02" });
  const nightly = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], windows: [{ symbol: "SYA000", occ: occOf("SYA000", 0), spanStart: 5, cols: { "contract.dte": 14, "contract.otm_pct": 12, "contract.premium": 1500000, "contract.vol_oi": 4 } }], sources: { flowalerts: { session: "2026-03-09", asOf: t("2026-03-09T21:30:00Z") } } }, M);
  const caught = new Store().run(M, nightly, [t03]);
  R.eq([caught.hits.length, caught.hits[0].stream, caught.hits[0].member_id, caught.hits[0].evaluator], [1, "house", null, "nightly"], "the catch-up pass fires a house hit with no member");
  R.eq(caught.hits[0].data_as_of, t("2026-03-09T20:00:00Z"), "a nightly hit is as of the close");
  R.eq(caught.hits[0].session_label, "close", "labelled close");
  const live2 = windowWire(M, { id: "w-bbbbbbbbbbbbbbbb" });
  const lr = new Store().run(M, liveSnap(M, { session: "2026-03-09", look: 3, windows: [{ premium: 1500000 }] }), [live2]);
  R.eq([lr.hits[0].stream, lr.hits[0].member_id, lr.hits[0].evaluator, lr.hits[0].evaluator_version, lr.hits[0].fired_at > lr.hits[0].data_as_of - 1], ["member01", "member01", "live", M.engine.ENGINE_VERSION, true], "a live member hit");
  R.eq(lr.hits[0].session_label, M.session.sessionLabel("2026-03-09", lr.hits[0].data_as_of), "its label comes from the data's time");
  R.eq(lr.hits[0].dedupe_key, "c:SYA000:" + occOf("SYA000", 0) + ":2026-03-09:" + live2.clauseHash, "its dedupe key");
}

function unusableNames(M, R) {
  const symbols = ["SYA000", "bad sym", "TOOLONGSYMBOL", "SYB001", "A:B", "SYC002"];
  const sectors = ["Technology", "Y:Z", "Energy", "X".repeat(41), "Utilities", "Q|R"];
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }]) });
  const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols, sectorOf: sectors, cols: { [Z]: symbols.map(() => 9) }, n: { [Z]: symbols.map(() => 20) } }, M);
  const res = new Store().run(M, snap, [wire]);
  R.eq(res.hits.map((h) => h.symbol), ["SYA000", "SYB001", "SYC002"], "a name that cannot be a ticker is never a hit");
  R.eq(res.hits.map((h) => h.sector), ["Technology", null, null], "and a sector that cannot be stored (too long, or holding a separator) is none");
  const rc = res.receipts[0];
  R.eq([rc.names_evaluated, rc.names_absent, JSON.parse(rc.absent_json)], [3, 3, { not_carded: { n: 3, sample: ["A:B", "TOOLONGSYMBOL", "bad sym"] } }], "the unusable names are counted as not carded");
  const energy = wireOf(M, { id: "w-bbbbbbbbbbbbbbbb", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "sector", sector: "Energy" } }) });
  const er = new Store().run(M, snap, [energy]);
  R.eq([er.hits.length, er.receipts[0].names_evaluated, er.receipts[0].status], [0, 0, "evaluated"], "a sector scope does not take a name whose symbol is unusable");
  const named = wireOf(M, { id: "w-cccccccccccccccc", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }], { scope: { kind: "names", symbols: ["SYA000", "bad sym"] } }) });
  const nr = new Store().run(M, snap, [named]);
  R.eq([nr.hits.length, nr.receipts[0].names_absent], [1, 1], "nor a names scope");
  const p = M.engine.preview(snap, wire);
  R.eq([p.subjects, p.unknown, p.wouldHit], [6, 3, 3], "and the preview agrees");
}

function previewScenarios(M, R) {
  const symbols = symbolsOf(30);
  const wire = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: CHG, op: ">=", x: 3 }]) });
  const cols = { [CHG]: symbols.map((_, i) => (i % 5 === 0 ? null : i % 2 ? 4 + i / 10 : 1)) };
  const p = M.engine.preview(snapshotOf({ kind: "nightly", session: "2026-03-09", symbols, cols }, M), wire, { limit: 4 });
  const wantTrue = symbols.filter((_, i) => i % 5 !== 0 && i % 2).length;
  R.eq([p.subjects, p.wouldHit, p.unknown, p.evaluated], [30, wantTrue, 6, 24], "the preview counts what the wire would do now");
  R.eq(p.rows.length, 4, "and shows the limit");
  R.eq(p.rows.map((r) => r.values[0].value), p.rows.map((r) => r.values[0].value).slice().sort((a, b) => b - a), "strongest first");
  R.eq(p.reasons, { missing: 6 }, "unknown names are counted by reason");
  const base = symbolsOf(40);
  const bw = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: Z, op: ">=", x: 3 }]) });
  const spike = base.map((_, i) => (i === 0 ? 4.5 : 0.5));
  const pb = M.engine.preview(snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: base, cols: { [Z]: spike }, n: { [Z]: base.map(() => 20) } }, M), bw);
  R.eq([pb.wouldHit, pb.evaluated], [0, 40], "the preview applies the same false-discovery gate");
  const lostW = wireOf(M, { id: "w-aaaaaaaaaaaaaaaa", body: bodyOf("nightly", [{ m: CHG, op: ">=", x: 3 }], { scope: { kind: "names", symbols: ["SYA000", "SYZ999"] } }) });
  const pl = M.engine.preview(snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: ["SYA000"], cols: { [CHG]: [4] } }, M), lostW);
  R.eq([pl.subjects, pl.unknown, pl.wouldHit], [2, 1, 1], "a name in the scope that the snapshot does not carry is unknown");
}

async function battery(M, R) {
  Store.mirror = R.heavy === true;
  vectorCases(M, R);
  diffNightly(M, R);
  diffLive(M, R);
  hVectors(M, R);
  h4Vectors(M, R);
  h5Vectors(M, R);
  bhScenarios(M, R);
  threeValued(M, R);
  freshnessScenarios(M, R);
  receiptShape(M, R);
  capScenarios(M, R);
  evidenceAndReplay(M, R);
  windowScenarios(M, R);
  liveTickScenarios(M, R);
  stateEdgeScenarios(M, R);
  rerunScenarios(M, R);
  modeScenarios(M, R);
  unusableNames(M, R);
  previewScenarios(M, R);
}

const out = await holdsAndPlants("ff-a-engine", battery, enginePlants);
console.log(`ff-a-engine: ${out.checks} checks passed`);
