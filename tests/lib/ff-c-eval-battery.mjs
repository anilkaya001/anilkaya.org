import { LIMITS } from "../../shared/ff-contract.js";
import { HOUSE_WIRES } from "../../shared/ff-house.js";
import { createFfStore } from "../../server/ff-store.js";
import { hitIdOf, makeWorld, seedWire, seedHit, seedRun, NAMES } from "./ff-b-world.mjs";
import { clone } from "./ff-c-kit.mjs";

const SESSION = "2026-10-26";
const AT = Date.parse("2026-10-26T23:00:00Z");
const LIVE_AT = Date.parse("2026-10-27T15:30:00Z");
const LIVE_SESSION = "2026-10-27";
const WIRE = "w-aaaaaaaaaaaaaaaa";
const wid = (c) => "w-" + c + "a".repeat(15);
const WIRE2 = wid("b");

const all = (w, sql, ...a) => w.f.db.prepare(sql).all(...a).map((r) => ({ ...r }));
const one = (w, sql, ...a) => {
  const r = w.f.db.prepare(sql).get(...a);
  return r === undefined ? undefined : { ...r };
};

const body = (over = {}) => ({
  v: 1, cadence: "nightly", scope: { kind: "names", symbols: ["SYA101"] }, all: [{ m: "flow.net_premium.z20", op: ">=", x: 3 }], persist: 1, cooldown: { unit: "session", n: 5 }, ...over,
});

const metrics = (over = {}) => {
  const n = NAMES.length;
  const zs = NAMES.map((_, i) => (i === 0 ? 500 : i === 1 ? 120 : 10));
  return {
    v: 1, sessionDate: SESSION, generatedAt: "2026-10-26T22:50:00.000Z", registryVersion: 1, t: NAMES,
    cols: { "flow.net_premium.z20": zs, "earn.sessions": NAMES.map((_, i) => 3 + i), "earn.confirmed": NAMES.map(() => 1) },
    n: { "flow.net_premium.z20": NAMES.map(() => 20) }, f: {}, why: {}, sectors: null, windows: { carry: { n: 0 }, carded: n }, ...over,
  };
};

const alerts = (day = SESSION, rows = []) => ({ v: 1, day, sessionDate: day, readAt: day + "T20:00:00.000Z", generatedAt: day + "T20:00:00.000Z", rows });

const WINDOWS = [
  { t: "SYA101", oc: "SYA101261113C00105000", cp: "C", k: 105, exp: "2026-11-13", prem: 2000000, size: 400, voi: 3, px: 100, opening: true, spanStart: "2026-10-26T15:00:00.000Z" },
  { t: "SYA102", oc: "SYA102261218P00095000", cp: "P", k: 95, exp: "2026-12-18", prem: 5000000, size: 400, voi: 3, px: 100, opening: true, spanStart: "2026-10-26T15:10:00.000Z" },
  { t: "SYA101", oc: "SYA101261030C00100000", cp: "C", k: 100, exp: "2026-10-30", prem: 900000, size: 100, voi: 1, px: 100, opening: false, spanStart: "2026-10-26T15:20:00.000Z" },
  { t: "SYB201", oc: "SYB201261106P00090000", cp: "P", k: 90, exp: "2026-11-06", prem: 1500000, size: 250, voi: 2, px: 100, opening: true, spanStart: "2026-10-26T15:30:00.000Z" },
  { t: "SYB202", oc: "SYB202261120C00095000", cp: "C", k: 95, exp: "2026-11-20", prem: 800000, size: 120, voi: 2, px: 100, opening: true, spanStart: "2026-10-26T15:40:00.000Z" },
];

function make(M, { env = {}, store = null } = {}) {
  const w = makeWorld({ now: AT, env: { FF_MODE: "on", ...env } });
  const real = createFfStore({ ensureFf: async () => {} });
  const payloads = new Map();
  const flowsStore = {
    async readMany(_env, keys) {
      return new Map(keys.filter((k) => payloads.has(k)).map((k) => [k, { payload: clone(payloads.get(k)), updatedAt: AT }]));
    },
  };
  const ev = M.evalMod.createEvaluator({ store: store || real, flowsStore, now: () => AT });
  return { w, ev, payloads, store: real };
}

const wireRow = (w, over) => seedWire(w.f, {
  member: "alice.one", id: WIRE, title: "A wire", cadence: "nightly", scopeKind: "names", symbols: ["SYA101"], astJson: JSON.stringify(body()), effective: "2026-10-01", ...over,
});

async function basic(M, R) {
  const { w, ev, payloads } = make(M);
  payloads.set("ff-metrics", metrics());
  wireRow(w, {});
  const out = await ev.nightly(w.env, { session: SESSION, at: AT });
  R.eq(out.status, "done", "basic: done");
  const hits = all(w, "SELECT * FROM ff_hit");
  R.eq(hits.length, 1, "basic: one hit, SYA101 at 5.00 sigma, and none for the quiet names");
  const h = hits[0];
  R.eq([h.stream, h.member_id, h.wire_id, h.subject, h.symbol, h.session, h.evaluator, h.state], ["alice.one", "alice.one", WIRE, "n:SYA101", "SYA101", SESSION, "nightly", "delivered"], "basic: the hit row");
  R.eq(h.hit_id, hitIdOf(WIRE, h.dedupe_key), "basic: the hit id is the first 20 base32 characters of sha256(wire|key)");
  R.ok(h.dedupe_key.startsWith("n:SYA101:" + SESSION + ":"), "basic: dedupe key is subject, session, clause hash");
  R.eq(h.fired_at, AT, "basic: fired at the evaluation time");
  const ev1 = JSON.parse(h.evidence_json);
  R.ok(JSON.stringify(ev1).includes("5"), "basic: the evidence holds the value");
  R.eq(ev1.clauses[0].m, "flow.net_premium.z20", "basic: the evidence names the metric");
  R.eq(ev1.clauses[0].value, 5, "basic: the evidence value is the z, descaled from the leg's integer");
  const rc = all(w, "SELECT * FROM ff_receipt WHERE wire_id = ?", WIRE);
  R.eq(rc.length, 1, "basic: one receipt");
  R.eq([rc[0].status, rc[0].names_evaluated, rc[0].hits, rc[0].hits_capped, rc[0].run_id, rc[0].looks_expected], ["evaluated", 1, 1, 0, "nightly:" + SESSION, 1], "basic: receipt");
  R.eq(rc[0].evaluated_at, AT, "basic: receipt evaluation time");
  const run = one(w, "SELECT * FROM ff_run WHERE id = ?", "nightly:" + SESSION);
  R.eq([run.status, run.kind, run.attempts, run.hits_written], ["done", "nightly", 1, 1], "basic: run row");
  R.ok(run.wires_evaluated >= 1, "basic: run counts wires");
  R.eq(all(w, "SELECT id FROM ff_wire WHERE layer = 'house'").length, HOUSE_WIRES.length, "basic: house wires are seeded once");
  const st = all(w, "SELECT * FROM ff_state WHERE wire_id = ?", WIRE);
  R.eq(st.length, 1, "basic: the fired name carries state");
  R.eq(st[0].subject, "n:SYA101", "basic: state subject");

  const again = await ev.nightly(w.env, { session: SESSION, at: AT + 1000 });
  R.eq(again.status, "not_claimed", "rerun: a finished night is not claimed again");
  R.eq(all(w, "SELECT * FROM ff_hit").length, 1, "rerun: no second hit");

  w.f.db.prepare("DELETE FROM ff_state").run();
  w.f.db.prepare("UPDATE ff_run SET status = 'failed', lease_until = NULL WHERE id = ?").run("nightly:" + SESSION);
  const forced = await ev.nightly(w.env, { session: SESSION, at: AT + 2000 });
  R.eq(forced.status, "done", "rerun: a failed night is claimed again");
  R.eq(forced.result.hits.length, 0, "rerun: the engine sees the stored hit and proposes nothing");
  R.eq(forced.hitsWritten, 0, "rerun: nothing written");
  R.eq(all(w, "SELECT * FROM ff_hit").length, 1, "rerun: still one hit");
  R.eq(one(w, "SELECT attempts FROM ff_run WHERE id = ?", "nightly:" + SESSION).attempts, 2, "rerun: attempts counted");
}

async function modes(M, R) {
  let k = make(M, { env: { FF_MODE: "off" } });
  k.payloads.set("ff-metrics", metrics());
  wireRow(k.w, {});
  let out = await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  R.eq(out.status, "off", "mode: off evaluates nothing");
  R.eq(all(k.w, "SELECT * FROM ff_run").length, 0, "mode: off claims no run");
  R.eq(all(k.w, "SELECT * FROM ff_receipt").length, 0, "mode: off writes no receipt");
  k = make(M, { env: { FF_MODE: "bogus" } });
  R.eq((await k.ev.nightly(k.w.env, { session: SESSION, at: AT })).status, "off", "mode: anything but on or shadow is off");

  k = make(M, { env: { FF_MODE: "shadow" } });
  k.payloads.set("ff-metrics", metrics());
  wireRow(k.w, {});
  out = await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  R.eq(out.status, "done", "mode: shadow evaluates");
  R.eq(all(k.w, "SELECT state FROM ff_hit").map((r) => r.state), ["held"], "mode: shadow holds every hit");

  k = make(M);
  k.payloads.set("ff-metrics", metrics());
  wireRow(k.w, {});
  k.w.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('evaluator', 'all', 'off', 'drill', ?)").run(AT);
  R.eq((await k.ev.nightly(k.w.env, { session: SESSION, at: AT })).status, "off", "switch: evaluator off");
  R.eq(all(k.w, "SELECT * FROM ff_hit").length, 0, "switch: evaluator off writes no hit");
  R.eq(one(k.w, "SELECT status FROM ff_run WHERE id = ?", "nightly:" + SESSION).status, "failed", "switch: the claimed run is closed, not left running");

  k = make(M);
  k.payloads.set("ff-metrics", metrics());
  wireRow(k.w, {});
  wireRow(k.w, { id: WIRE2, member: "bob.two" });
  k.w.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('wire', ?, 'off', 'drill', ?)").run(WIRE, AT);
  k.w.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('member', 'bob.two', 'hold', 'drill', ?)").run(AT);
  out = await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  const r1 = one(k.w, "SELECT * FROM ff_receipt WHERE wire_id = ?", WIRE);
  R.eq([r1.status, r1.reason], ["not_evaluated", "switch_off"], "switch: a wire off is a receipt with its reason");
  const bob = all(k.w, "SELECT wire_id, state FROM ff_hit");
  R.eq(bob, [{ wire_id: WIRE2, state: "held" }], "switch: a member on hold is evaluated and held, a wire off is not evaluated");

  k = make(M);
  k.payloads.set("ff-metrics", metrics());
  wireRow(k.w, {});
  k.w.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('wire', ?, 'hold', 'a', ?)").run(WIRE, AT);
  k.w.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('member', 'alice.one', 'off', 'b', ?)").run(AT);
  await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  R.eq(one(k.w, "SELECT reason FROM ff_receipt WHERE wire_id = ?", WIRE).reason, "switch_off", "switch: the most restrictive matching row wins");
}

async function sources(M, R) {
  let k = make(M);
  wireRow(k.w, {});
  await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  let r = one(k.w, "SELECT status, reason, hits FROM ff_receipt WHERE wire_id = ?", WIRE);
  R.eq(r, { status: "not_evaluated", reason: "source_missing", hits: 0 }, "source: no payload at all is source_missing");
  R.eq(all(k.w, "SELECT * FROM ff_hit").length, 0, "source: missing writes no hit");
  R.eq(one(k.w, "SELECT status FROM ff_run WHERE id = ?", "nightly:" + SESSION).status, "done", "source: the run itself is done");

  k = make(M);
  k.payloads.set("ff-metrics", metrics({ sessionDate: "2026-10-16", generatedAt: "2026-10-16T22:50:00.000Z" }));
  wireRow(k.w, {});
  await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  r = one(k.w, "SELECT status, reason FROM ff_receipt WHERE wire_id = ?", WIRE);
  R.eq(r, { status: "not_evaluated", reason: "source_stale" }, "source: an old payload is stale, never carried forward");
  R.eq(all(k.w, "SELECT * FROM ff_hit").length, 0, "source: stale writes no hit");

  k = make(M);
  k.payloads.set("ff-metrics", metrics());
  wireRow(k.w, { id: wid("c"), status: "paused" });
  wireRow(k.w, { id: wid("d"), status: "retired" });
  wireRow(k.w, { id: wid("e"), effective: "2026-10-27" });
  wireRow(k.w, { id: wid("f"), astJson: "not json" });
  wireRow(k.w, { id: wid("g"), cadence: "live", astJson: JSON.stringify(body({ cadence: "live", all: [{ m: "contract.premium", op: ">=", x: 1000000 }] })) });
  wireRow(k.w, {});
  const out = await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  R.eq(out.status, "done", "wires: a malformed record does not stop the night");
  const ids = all(k.w, "SELECT wire_id FROM ff_receipt WHERE wire_id LIKE 'w-%' ORDER BY wire_id").map((x) => x.wire_id);
  R.eq(ids, [WIRE], "wires: paused, retired, not yet effective, malformed and live wires get no nightly receipt");
  R.eq(all(k.w, "SELECT wire_id FROM ff_hit").map((x) => x.wire_id), [WIRE], "wires: only the armed nightly wire fires");
}

async function capsAndCounts(M, R) {
  const k = make(M);
  k.payloads.set("ff-metrics", metrics());
  wireRow(k.w, {});
  for (let i = 0; i < LIMITS.hitsPerMemberWirePerSession; i++) seedHit(k.w.f, { stream: "alice.one", wire: WIRE, symbol: "SYB" + (200 + i), session: SESSION, key: "n:SYB" + (200 + i) + ":" + SESSION + ":x" + i, evaluator: "nightly" });
  const out = await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  R.eq(out.status, "done", "cap: done");
  R.eq(all(k.w, "SELECT * FROM ff_hit WHERE wire_id = ?", WIRE).length, LIMITS.hitsPerMemberWirePerSession, "cap: a wire at its ten for the session writes no more");
  const r = one(k.w, "SELECT hits, hits_capped FROM ff_receipt WHERE wire_id = ?", WIRE);
  R.eq([r.hits, r.hits_capped], [0, 1], "cap: the receipt says one was capped and none written");

  const k2 = make(M);
  k2.payloads.set("ff-metrics", metrics());
  wireRow(k2.w, {});
  const refuse = {
    ...k2.store,
    writeHits: async () => [false],
  };
  const k3 = make(M, { store: refuse });
  k3.payloads.set("ff-metrics", metrics());
  wireRow(k3.w, {});
  await k3.ev.nightly(k3.w.env, { session: SESSION, at: AT });
  const rr = one(k3.w, "SELECT hits, hits_capped FROM ff_receipt WHERE wire_id = ?", WIRE);
  R.eq([rr.hits, rr.hits_capped], [0, 1], "settle: a hit the store refused is counted as capped, not as a hit");
}

async function windows(M, R) {
  const k = make(M);
  const carry = { from: "2026-10-23", reason: null, n: 3, t: ["SYA101", "SYA102", "SYB201"], oc: ["C1", "C2", "C3"], prem: [3000000, 2000000, 100000], voi: [4, 5, 9], oic: [75, 10, null], spanStart: ["2026-10-23T15:00:00.000Z", null, null] };
  k.payloads.set("ff-metrics", metrics({ windows: { carry, carded: 10 } }));
  k.payloads.set("flowalerts", alerts(SESSION, WINDOWS));
  wireRow(k.w, {
    scopeKind: "universe", astJson: JSON.stringify(body({ scope: { kind: "universe" }, all: [{ m: "contract.dte", op: "<=", x: 21 }, { m: "contract.premium", op: ">=", x: 1000000 }] })),
  });
  wireRow(k.w, {
    id: WIRE2, scopeKind: "universe", astJson: JSON.stringify(body({ scope: { kind: "universe" }, all: [{ m: "contract.otm_pct", op: ">=", x: 4 }, { m: "contract.vol_oi", op: ">=", x: 1.5 }] })),
  });
  const w3 = wid("c");
  wireRow(k.w, {
    id: w3, scopeKind: "universe", astJson: JSON.stringify(body({ scope: { kind: "universe" }, all: [{ m: "contract.oi_confirm", op: ">=", x: 0.5 }, { m: "contract.premium", op: ">=", x: 1000000 }] })),
  });
  const out = await k.ev.nightly(k.w.env, { session: SESSION, at: AT });
  R.eq(out.status, "done", "windows: done");
  const subj = (id) => all(k.w, "SELECT subject FROM ff_hit WHERE wire_id = ? ORDER BY subject", id).map((x) => x.subject);
  R.eq(subj(WIRE), ["c:SYA101:SYA101261113C00105000", "c:SYB201:SYB201261106P00090000"], "windows: days to expiry from the session and the premium bar, by hand");
  R.eq(subj(WIRE2), ["c:SYA101:SYA101261113C00105000", "c:SYA102:SYA102261218P00095000", "c:SYB201:SYB201261106P00090000"], "windows: out of the money from strike and underlying, calls and puts, and volume over open interest");
  R.eq(subj(w3), ["c:SYA101:C1"], "windows: yesterday's window confirmed tonight, the share descaled from the leg's integer, an unobservable one never matched");
  const rcpt = one(k.w, "SELECT names_evaluated, names_absent FROM ff_receipt WHERE wire_id = ?", w3);
  R.ok(rcpt.names_absent >= 1, "windows: the unobservable confirmations are counted as absent, not as no");
}

async function houseNight(M, R) {
  const k = make(M);
  const s = "2026-11-03";
  const at = Date.parse("2026-11-03T23:00:00Z");
  k.payloads.set("ff-metrics", metrics({ sessionDate: s, generatedAt: "2026-11-03T22:50:00.000Z" }));
  const out = await k.ev.nightly(k.w.env, { session: s, at });
  R.eq(out.status, "done", "house: done");
  const ids = new Set(all(k.w, "SELECT wire_id FROM ff_receipt").map((r) => r.wire_id));
  const nightly = HOUSE_WIRES.filter((e) => e.body.cadence === "nightly" || e.catchup === true);
  R.ok(nightly.length > 0, "house: some nightly house wires");
  for (const e of nightly) R.ok(ids.has(e.id), "house: a receipt for " + e.id);
  for (const e of HOUSE_WIRES.filter((x) => x.body.cadence === "live" && x.catchup !== true)) R.ok(!ids.has(e.id), "house: no nightly receipt for live-only " + e.id);
}

async function gap(M, R) {
  const k = make(M);
  wireRow(k.w, {});
  seedRun(k.w.f, { id: "nightly:2026-10-23", kind: "nightly", session: "2026-10-23" });
  const before = Date.parse("2026-10-26T17:00:00Z");
  R.eq((await k.ev.gap(k.w.env, { at: before })).status, "none", "gap: before the deadline nothing is late");
  const after = Date.parse("2026-10-27T01:30:00Z");
  const late = await k.ev.gap(k.w.env, { at: after });
  R.eq([late.status, late.session, late.reason], ["flagged", SESSION, "run_late"], "gap: after the deadline with no run, the night is late");
  const rc = one(k.w, "SELECT status, reason, looks, evaluated_at FROM ff_receipt WHERE wire_id = ? AND session = ?", WIRE, SESSION);
  R.eq(rc, { status: "not_evaluated", reason: "run_late", looks: 0, evaluated_at: null }, "gap: the member wire's receipt");
  R.eq(all(k.w, "SELECT wire_id FROM ff_receipt WHERE wire_id LIKE 'h-%'").length, HOUSE_WIRES.filter((e) => e.effectiveSession <= SESSION).length, "gap: house wires effective by then are flagged too");

  seedRun(k.w.f, { id: "nightly:" + SESSION, kind: "nightly", session: SESSION, status: "failed", error: "x", finishedAt: null });
  k.w.f.db.prepare("DELETE FROM ff_receipt").run();
  const failed = await k.ev.gap(k.w.env, { at: after });
  R.eq(failed.reason, "run_failed", "gap: a failed run is named as failed");
  R.eq(one(k.w, "SELECT reason FROM ff_receipt WHERE wire_id = ?", WIRE).reason, "run_failed", "gap: receipt reason");

  k.w.f.db.prepare("UPDATE ff_run SET status = 'done', finished_at = ? WHERE id = ?").run(after, "nightly:" + SESSION);
  k.w.f.db.prepare("DELETE FROM ff_receipt").run();
  R.eq((await k.ev.gap(k.w.env, { at: after })).status, "none", "gap: a done night is not late");
  R.eq(all(k.w, "SELECT * FROM ff_receipt").length, 0, "gap: a done night writes nothing");

  k.w.f.db.prepare("UPDATE ff_run SET status = 'running', lease_until = ? WHERE id = ?").run(after + 60000, "nightly:" + SESSION);
  R.eq((await k.ev.gap(k.w.env, { at: after })).status, "none", "gap: a night inside its lease is running, not late");

  const off = make(M, { env: { FF_MODE: "off" } });
  R.eq((await off.ev.gap(off.w.env, { at: after })).status, "off", "gap: off checks nothing");

  const k2 = make(M);
  k2.payloads.set("ff-metrics", metrics());
  wireRow(k2.w, {});
  await k2.ev.gap(k2.w.env, { at: after });
  const out = await k2.ev.nightly(k2.w.env, { session: SESSION, at: Date.parse("2026-10-27T02:00:00Z") });
  R.eq(out.status, "done", "late: the night runs after being flagged");
  const up = one(k2.w, "SELECT status, late, hits FROM ff_receipt WHERE wire_id = ? AND session = ?", WIRE, SESSION);
  R.eq(up, { status: "evaluated", late: 1, hits: 1 }, "late: a late run upgrades the flagged receipt and marks it late");
}

async function live(M, R) {
  const k = make(M);
  k.payloads.set("live:alerts", { ...alerts(LIVE_SESSION, WINDOWS.map((r) => ({ ...r, exp: r.exp, spanStart: "2026-10-27T15:00:00.000Z" }))), readAt: "2026-10-27T15:28:00.000Z", day: LIVE_SESSION });
  wireRow(k.w, {
    scopeKind: "universe", cadence: "live", astJson: JSON.stringify(body({ cadence: "live", scope: { kind: "universe" }, cooldown: { unit: "session", n: 1 }, all: [{ m: "contract.dte", op: "<=", x: 21 }, { m: "contract.premium", op: ">=", x: 1000000 }] })),
  });
  const out = await k.ev.live(k.w.env, { at: LIVE_AT });
  R.eq(out.status, "done", "live: done");
  const hits = all(k.w, "SELECT subject, evaluator, session FROM ff_hit ORDER BY subject");
  R.eq(hits.map((h) => h.subject), ["c:SYA101:SYA101261113C00105000", "c:SYB201:SYB201261106P00090000"], "live: the windows that pass, dte counted from the window's day");
  R.eq(hits.map((h) => [h.evaluator, h.session]), [["live", LIVE_SESSION], ["live", LIVE_SESSION]], "live: evaluator and session");
  const run = one(k.w, "SELECT kind, status, hits_written FROM ff_run WHERE id = ?", "live:" + LIVE_SESSION);
  R.eq(run, { kind: "live", status: "done", hits_written: 2 }, "live: the tick is recorded on the session's run row");
  const again = await k.ev.live(k.w.env, { at: LIVE_AT + 300000 });
  R.eq(again.status, "done", "live: the next tick runs");
  R.eq(all(k.w, "SELECT * FROM ff_hit").length, 2, "live: the same windows do not fire twice in a session");

  const closed = await k.ev.live(k.w.env, { at: Date.parse("2026-10-27T22:30:00Z") });
  R.eq(closed.status, "closed", "live: no ticks outside the regular session");
  const weekend = await k.ev.live(k.w.env, { at: Date.parse("2026-10-31T15:30:00Z") });
  R.eq(weekend.status, "closed", "live: none on a weekend");

  const stale = make(M);
  stale.payloads.set("live:alerts", { ...alerts(LIVE_SESSION, WINDOWS), readAt: "2026-10-27T13:00:00.000Z", day: LIVE_SESSION });
  wireRow(stale.w, {
    scopeKind: "universe", cadence: "live", astJson: JSON.stringify(body({ cadence: "live", scope: { kind: "universe" }, cooldown: { unit: "session", n: 1 }, all: [{ m: "contract.premium", op: ">=", x: 1000000 }] })),
  });
  await stale.ev.live(stale.w.env, { at: LIVE_AT });
  R.eq(all(stale.w, "SELECT * FROM ff_hit").length, 0, "live: a record two hours old is stale, no hit");
  R.eq(one(stale.w, "SELECT reason FROM ff_receipt WHERE wire_id = ?", WIRE).reason, "source_stale", "live: stale is a receipt reason");

  const prev = make(M);
  prev.payloads.set("live:alerts", { ...alerts(SESSION, WINDOWS), readAt: "2026-10-27T15:28:00.000Z", day: SESSION });
  wireRow(prev.w, {
    scopeKind: "universe", cadence: "live", astJson: JSON.stringify(body({ cadence: "live", scope: { kind: "universe" }, cooldown: { unit: "session", n: 1 }, all: [{ m: "contract.premium", op: ">=", x: 1000000 }] })),
  });
  await prev.ev.live(prev.w.env, { at: LIVE_AT });
  R.eq(all(prev.w, "SELECT * FROM ff_hit").length, 0, "live: yesterday's record is not today's");

  const none = make(M);
  wireRow(none.w, {
    scopeKind: "universe", cadence: "live", astJson: JSON.stringify(body({ cadence: "live", scope: { kind: "universe" }, cooldown: { unit: "session", n: 1 }, all: [{ m: "contract.premium", op: ">=", x: 1000000 }] })),
  });
  await none.ev.live(none.w.env, { at: LIVE_AT });
  R.eq(one(none.w, "SELECT reason FROM ff_receipt WHERE wire_id = ?", WIRE).reason, "source_missing", "live: no record at all is missing");
}

function pure(M, R) {
  const E = M.evalMod;
  R.eq(E.otmPct("C", 105, 100), 5, "pure: a call struck above the price is out of the money");
  R.eq(E.otmPct("P", 105, 100), -5, "pure: a put struck above the price is in the money");
  R.eq(E.otmPct("P", 90, 100), 10, "pure: a put struck below the price is out of the money");
  R.eq(E.otmPct("C", 0, 100), null, "pure: no strike, no distance");
  R.eq(E.otmPct("X", 90, 100), null, "pure: unknown side");
  R.eq(E.otmPct("C", 90, 0), null, "pure: no price");
  R.eq(E.stampOf("2026-10-26T15:00:00.000Z"), Date.parse("2026-10-26T15:00:00Z"), "pure: an ISO stamp");
  R.eq(E.stampOf(1790000000000), 1790000000000, "pure: a millisecond stamp");
  R.eq(E.stampOf("soon"), null, "pure: junk is absent");
  R.eq(E.expandRuns([0, [3, 5], 9, [7, 6], "x", [20, 30]], 10), [0, 3, 4, 5, 9], "pure: runs expand, bad ranges are dropped, out of range is clipped");
  const sw = (wire, rows) => E.resolveSwitch(wire, rows);
  R.eq(sw({ id: "a", layer: "member", memberId: "m", template: "custom" }, []), "on", "pure: no row is on");
  R.eq(sw({ id: "a", layer: "member", memberId: "m", template: "custom" }, [{ scope: "template", target: "T01", state: "off" }]), "on", "pure: another template's row does not apply");
  R.eq(sw({ id: "a", layer: "member", memberId: "m", template: "T01" }, [{ scope: "template", target: "T01", state: "hold" }, { scope: "wire", target: "a", state: "on" }]), "hold", "pure: hold beats on");
  R.eq(sw({ id: "h-t01", layer: "house", memberId: null, template: "T01" }, [{ scope: "house", target: "*", state: "off" }]), "off", "pure: the house switch");
  R.eq(sw({ id: "a", layer: "member", memberId: "m", template: "custom" }, [{ scope: "house", target: "*", state: "off" }]), "on", "pure: the house switch is not a member's");
  R.eq(E.capUsedOf([{ wire_id: "a", member_id: "m" }, { wire_id: "a", member_id: "m" }, { wire_id: "h", member_id: null }]).global, 3, "pure: cap counts");
  R.eq([...E.capUsedOf([{ wire_id: "a", member_id: "m" }, { wire_id: "a", member_id: "m" }]).wire.entries()], [["a", 2]], "pure: cap by wire");
  R.eq([...E.firstLooksOf([{ wire_id: "a", version: 2, session: "2026-10-01" }]).entries()], [["a@2", "2026-10-01"]], "pure: first looks keyed wire@version");
}

export async function battery(M, R, only = null) {
  const pick = (n) => !only || only.includes(n);
  if (pick("pure")) pure(M, R);
  if (pick("basic")) await basic(M, R);
  if (pick("modes")) await modes(M, R);
  if (pick("sources")) await sources(M, R);
  if (pick("caps")) await capsAndCounts(M, R);
  if (pick("windows")) await windows(M, R);
  if (pick("house")) await houseNight(M, R);
  if (pick("gap")) await gap(M, R);
  if (pick("live")) await live(M, R);
}
