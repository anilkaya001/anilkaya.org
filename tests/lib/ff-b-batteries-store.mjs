import { LIMITS } from "../../shared/ff-contract.js";
import { evidenceProblems, validateHit } from "../../server/ff-store.js";
import { alice, bob, astOf, liveAst, hitIdOf, seedWire, seedRun, seedHit, NOW, SESSION, PREV_SESSION } from "./ff-b-world.mjs";

const rawOne = (api, sql, ...args) => {
  const r = api.world.f.db.prepare(sql).get(...args);
  return r === undefined ? undefined : { ...r };
};
const rawAll = (api, sql, ...args) => api.world.f.db.prepare(sql).all(...args).map((r) => ({ ...r }));

const EVIDENCE = JSON.stringify({ sentence: "SYA101 net premium crossed above 3.00σ", key: "z 3.42", clauses: [{ m: "flow.net_premium.z20", value: 3.42, x: 3 }] });

const hitOf = (wire, key, over = {}) => ({
  hit_id: hitIdOf(wire, key), wire_id: wire, wire_version: 1, subject: "n:SYA101", symbol: "SYA101", sector: null, dedupe_key: key, session: PREV_SESSION,
  session_label: "close", fired_at: NOW - 3600000, data_as_of: NOW - 3700000, evaluator: "nightly", evaluator_version: "e1", evidence_json: EVIDENCE, state: "delivered",
  layer: "member", cadence: "nightly", ...over,
});

const setup = async (build, opt = {}) => {
  const api = build(opt);
  api.world.core.setSession("2026-10-01");
  const w = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  const b = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }) }, user: bob });
  const compiled = await api.world.core.compile({ body: astOf({ scope: { kind: "universe" } }), universe: api.world.universe });
  seedWire(api.world.f, { member: null, id: "h-t01", title: "Earnings run-up", cadence: "nightly", scopeKind: "universe", control: "fact", astJson: compiled.version.ast_json, astHash: compiled.version.ast_hash, clauseHash: compiled.version.clause_hash, sentence: "House sentence", template: "T01", effective: "2026-10-01" });
  const live = await api.world.core.compile({ body: liveAst({ scope: { kind: "universe" } }), universe: api.world.universe });
  seedWire(api.world.f, { member: null, id: "h-t03", title: "Short-dated", cadence: "live", scopeKind: "universe", control: "fact", astJson: live.version.ast_json, astHash: live.version.ast_hash, clauseHash: live.version.clause_hash, sentence: "House live", template: "T03", effective: "2026-10-01" });
  return { api, wire: w.body.wire.id, bobWire: b.body.wire.id };
};

const write = (api, hits, options) => api.store.writeHits(api.world.env, hits, options);

export async function hitWrites(c, build) {
  const { api, wire, bobWire } = await setup(build);
  const a = hitOf(wire, "k1");
  c.eq(await write(api, [a]), [true], "hits: a hit is written");
  const row = rawOne(api, "SELECT * FROM ff_hit WHERE hit_id = ?", a.hit_id);
  c.eq([row.stream, row.seq, row.member_id, row.wire_version, row.state, row.session], ["alice.one", 1, "alice.one", 1, "delivered", PREV_SESSION], "hits: stream and member come from the wire, the first seq is 1");
  const spoof = hitOf(wire, "k2", { stream: "bob.two", member_id: "bob.two" });
  c.eq(await write(api, [spoof]), [true], "hits: a record that names another stream is still written");
  c.eq(rawOne(api, "SELECT stream, member_id, seq FROM ff_hit WHERE hit_id = ?", spoof.hit_id), { stream: "alice.one", member_id: "alice.one", seq: 2 }, "hits: but into the wire's own stream, member and next seq");
  c.eq(await write(api, [a]), [false], "hits: the same hit again is not written");
  c.eq(await write(api, [hitOf(wire, "k1", { hit_id: hitIdOf(wire, "other") })]), [false], "hits: the same dedupe key under another id is not written");
  const seq = await write(api, [hitOf(wire, "k3")]);
  c.eq([seq, rawOne(api, "SELECT max(seq) AS n FROM ff_hit WHERE stream = 'alice.one'").n, rawOne(api, "SELECT count(*) AS n FROM ff_hit WHERE stream = 'alice.one'").n], [[true], 3, 3], "hits: a duplicate consumed no sequence number, the stream is gapless");
  c.eq(await write(api, [hitOf(bobWire, "k1")]), [true], "hits: another member's wire with the same key is its own hit");
  c.eq(rawAll(api, "SELECT stream, seq FROM ff_hit ORDER BY stream, seq"), [{ stream: "alice.one", seq: 1 }, { stream: "alice.one", seq: 2 }, { stream: "alice.one", seq: 3 }, { stream: "bob.two", seq: 1 }], "hits: each stream counts from one");
  const h = hitOf("h-t01", "house-1", { layer: "house", subject: "n:SYB201", symbol: "SYB201" });
  c.eq(await write(api, [h]), [true], "hits: a house hit is written");
  c.eq(rawOne(api, "SELECT stream, member_id, seq FROM ff_hit WHERE hit_id = ?", h.hit_id), { stream: "house", member_id: null, seq: 1 }, "hits: into the house stream with no member");

  const batch = await write(api, [hitOf(wire, "b1"), hitOf(wire, "b1"), hitOf(wire, "b2"), hitOf("w-zzzzzzzzzzzzzzzz", "b3")]);
  c.eq(batch, [true, false, true, false], "hits: a batch answers one flag per hit, in order");
  const many = Array.from({ length: 100 }, (_, i) => hitOf(bobWire, "bulk" + i, { session: "2026-10-26", symbol: "SYB201", subject: "n:SYB201" }));
  const res = await write(api, many);
  c.eq([res.length, res.filter(Boolean).length], [100, 9], "hits: a hundred in one call answer a hundred flags, the wire cap of ten lets nine through after the one already written");
  c.eq(rawOne(api, "SELECT max(seq) AS n, count(*) AS c FROM ff_hit WHERE stream = 'bob.two'"), { n: 10, c: 10 }, "hits: and the stream stays gapless after the cap");

  const paused = await api.call("PATCH", "/api/ff/wires", { body: { id: wire, status: "paused" }, user: alice });
  c.eq(await write(api, [hitOf(wire, "paused")]), [false], "hits: a paused wire writes nothing");
  await api.call("PATCH", "/api/ff/wires", { body: { id: wire, status: "retired" }, user: alice });
  c.eq(await write(api, [hitOf(wire, "retired")]), [false], "hits: a retired wire writes nothing");
  await api.call("PATCH", "/api/ff/wires", { body: { id: wire, status: "armed" }, user: alice });
  c.eq(await write(api, [hitOf(wire, "restored")]), [true], "hits: a restored wire writes again");
  c.eq(paused.status, 200, "hits: the pause itself worked");
  c.eq(await write(api, [hitOf("h-t99", "unknown")]), [false], "hits: an unknown wire writes nothing");
  c.eq(await write(api, []), [], "hits: an empty call is an empty answer");

  const held = hitOf(wire, "held-1", { state: "held" });
  c.eq(await write(api, [held]), [true], "hits: a held hit is stored");
  const heldRow = rawOne(api, "SELECT state, seq FROM ff_hit WHERE hit_id = ?", held.hit_id);
  c.eq(heldRow.state, "held", "hits: as held");
  const listed = await api.call("GET", "/api/ff/hits?limit=30", { user: alice });
  c.ok(!listed.body.hits.some((x) => x.id === held.hit_id), "hits: and never listed");
}

export async function hitRefusals(c, build) {
  const { api, wire } = await setup(build);
  const bad = [
    [{ hit_id: "SHORT" }, "hit_id"], [{ hit_id: "A".repeat(20) }, "hit_id"], [{ session: "2026-1-1" }, "session"], [{ state: "pending" }, "state"], [{ evaluator: "rail" }, "evaluator"],
    [{ layer: "other" }, "layer"], [{ cadence: "weekly" }, "cadence"], [{ wire_version: 0 }, "version"], [{ wire_version: 1.5 }, "version"], [{ evidence_json: "{}".repeat(3000) }, "evidence_size"],
    [{ evidence_json: "not json" }, "evidence_shape"], [{ evidence_json: "[1]" }, "evidence_shape"], [{ evidence_json: "" }, "evidence_size"],
    [{ evidence_json: JSON.stringify({ sentence: "x", px: 101.5 }) }, "evidence_price"], [{ evidence_json: JSON.stringify({ clauses: [{ ref_px: 1 }] }) }, "evidence_price"],
    [{ evidence_json: JSON.stringify({ price: 3 }) }, "evidence_price"], [{ evidence_json: JSON.stringify({ a: { b: [{ iv: 0.4 }] } }) }, "evidence_price"], [{ evidence_json: JSON.stringify({ ret_5d: 0.1 }) }, "evidence_price"],
    [{ evidence_json: JSON.stringify({ pnl: 9 }) }, "evidence_price"], [{ evidence_json: JSON.stringify({ pnl_open: 9 }) }, "evidence_price"], [{ evidence_json: JSON.stringify({ returns: [1] }) }, "evidence_price"],
  ];
  for (const [over, code] of bad) {
    let message = null;
    try {
      await write(api, [hitOf(wire, "r" + code, over)]);
    } catch (e) {
      message = String(e.message);
    }
    c.ok(message !== null && message.includes(code), "refused: " + JSON.stringify(over).slice(0, 60) + " is refused as " + code, message);
  }
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_hit").n, 0, "refused: nothing was written");
  const ok = [
    { evidence_json: JSON.stringify({ sentence: "x", clauses: [{ m: "earn.sessions", value: 3 }], source: "universe", asOf: "2026-10-26T22:50:00Z" }) },
    { evidence_json: JSON.stringify({ priority: 1, ivory: 3, source: "universe", note: "retail" }) },
  ];
  for (const over of ok) c.eq(validateHit(hitOf(wire, "ok", over)), [], "refused: a fine evidence passes the validator " + over.evidence_json.slice(0, 40));
  c.eq(evidenceProblems(JSON.stringify({ a: "x".repeat(4096) })), "size", "refused: 4096 bytes of payload plus its framing is over the limit");
  c.eq(evidenceProblems("{\"a\":\"" + "é".repeat(2048) + "\"}"), "size", "refused: the limit counts bytes, not characters");
  c.eq(evidenceProblems("{\"a\":\"" + "x".repeat(4000) + "\"}"), null, "refused: just under 4 KiB is fine");
}

export async function hitCapsAndVersions(c, build) {
  {
    const { api, wire } = await setup(build);
    const out = await write(api, Array.from({ length: 12 }, (_, i) => hitOf(wire, "cap" + i)));
    c.eq(out.filter(Boolean).length, LIMITS.hitsPerMemberWirePerSession, "caps: ten hits per member wire per session");
    c.eq(out.slice(0, 10).every(Boolean) && out.slice(10).every((x) => !x), true, "caps: the first ten win");
    const w2 = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }) }, user: alice })).body.wire.id;
    const w3 = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYC302"] } }) }, user: alice })).body.wire.id;
    const more = await write(api, [...Array.from({ length: 10 }, (_, i) => hitOf(w2, "c2-" + i)), ...Array.from({ length: 10 }, (_, i) => hitOf(w3, "c3-" + i))]);
    c.eq(more.filter(Boolean).length, 15, "caps: twenty-five a member a session, so fifteen more after the first wire's ten");
    c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_hit WHERE stream = 'alice.one' AND session = ?", PREV_SESSION).n, 25, "caps: the session holds exactly twenty-five");
    const next = await write(api, [hitOf(wire, "cap-next", { session: "2026-10-27" })]);
    c.eq(next, [true], "caps: the next session has its own allowance");
  }
  {
    const { api } = await setup(build);
    const nightly = await write(api, Array.from({ length: 12 }, (_, i) => hitOf("h-t01", "hn" + i, { layer: "house", subject: "n:SYA101" })));
    c.eq(nightly.filter(Boolean).length, LIMITS.hitsPerHouseWirePerSession.nightly, "caps: ten per nightly house wire");
    const live = await write(api, Array.from({ length: 24 }, (_, i) => hitOf("h-t03", "hl" + i, { layer: "house", cadence: "live", evaluator: "live" })));
    c.eq(live.filter(Boolean).length, LIMITS.hitsPerHouseWirePerSession.live, "caps: twenty per live house wire");
  }
  {
    const { api, wire } = await setup(build);
    api.world.core.setSession("2026-10-26");
    const v2 = await api.call("PATCH", "/api/ff/wires", { body: { id: wire, version: 1, ast: astOf({ all: [{ m: "earn.sessions", op: "<=", x: 7 }, { m: "earn.confirmed", op: "==", x: 1 }] }) }, user: alice });
    c.eq(v2.body.wire.effectiveSession, "2026-10-26", "versions: version two takes effect at the core's session");
    c.eq(await write(api, [hitOf(wire, "v2-ok", { wire_version: 2 })]), [true], "versions: a hit of the current version is written");
    c.eq(await write(api, [hitOf(wire, "v1-late", { wire_version: 1 })]), [false], "versions: a hit of the old version after the new one took effect is refused");
    c.eq(await write(api, [hitOf(wire, "v1-early", { wire_version: 1, session: "2026-10-23" })]), [true], "versions: but an old version's hit for a session before that is fine");
    c.eq(await write(api, [hitOf(wire, "v2-early", { wire_version: 2, session: "2026-10-23" })]), [false], "versions: a new version's hit for a session before it took effect is refused");
    c.eq(await write(api, [hitOf(wire, "v9", { wire_version: 9 })]), [false], "versions: a version that does not exist is refused");
  }
  {
    const { api, wire } = await setup(build);
    c.eq(await write(api, [hitOf(wire, "new", { session: "2026-10-26" })]), [true], "monotone: a hit for the latest session");
    c.eq(await write(api, [hitOf(wire, "old", { session: "2026-10-20" })]), [false], "monotone: a hit for a session more than four days older than the stream's latest is refused");
    c.eq(await write(api, [hitOf(wire, "near", { session: "2026-10-22" })]), [true], "monotone: four days back is allowed");
    c.eq(await write(api, [hitOf(wire, "forced", { session: "2026-10-01" })], { force: true }), [true], "monotone: an operator's force writes an old session");
    c.eq(await write(api, [hitOf(wire, "future", { session: "2026-11-03" })]), [true], "monotone: a later session is always allowed");
  }
}

export async function runFencing(c, build) {
  const { api, wire } = await setup(build);
  seedRun(api.world.f, { id: "nightly:" + PREV_SESSION, kind: "nightly", session: PREV_SESSION, status: "running", attempts: 3 });
  const claim = { id: "nightly:" + PREV_SESSION, token: 3 };
  const ok = await write(api, [hitOf(wire, "f1"), hitOf(wire, "f2")], { run: claim });
  c.eq(ok, [true, true], "fence: the holder of the lease writes");
  c.eq(rawOne(api, "SELECT hits_written FROM ff_run WHERE id = ?", claim.id).hits_written, 2, "fence: and the run counts its hits");
  const dup = await write(api, [hitOf(wire, "f1")], { run: claim });
  c.eq([dup, rawOne(api, "SELECT hits_written FROM ff_run WHERE id = ?", claim.id).hits_written], [[false], 2], "fence: a duplicate is not counted");
  const stale = await write(api, [hitOf(wire, "f3")], { run: { id: claim.id, token: 2 } });
  c.eq(stale, [false], "fence: a worker with an older token writes nothing");
  api.world.f.db.prepare("UPDATE ff_run SET status = 'done' WHERE id = ?").run(claim.id);
  const done = await write(api, [hitOf(wire, "f4")], { run: claim });
  c.eq(done, [false], "fence: a finished run writes nothing");
  api.world.f.db.prepare("UPDATE ff_run SET status = 'running', hits_written = 600 WHERE id = ?").run(claim.id);
  const full = await write(api, [hitOf(wire, "f5")], { run: claim });
  c.eq(full, [false], "fence: a run at its ceiling of 600 writes nothing more");
  const missing = await write(api, [hitOf(wire, "f6")], { run: { id: "nightly:1999-01-01", token: 1 } });
  c.eq(missing, [false], "fence: a run that does not exist writes nothing");
  const bare = await write(api, [hitOf(wire, "f7")]);
  c.eq(bare, [true], "fence: a write with no run is allowed, the operator's path");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_hit WHERE dedupe_key IN ('f3','f4','f5','f6')").n, 0, "fence: and none of the refused hits exists");
}

export async function stateReceiptRecord(c, build) {
  const { api, wire } = await setup(build);
  const f = api.world.f;
  const S = (over) => ({ wire_id: wire, subject: "n:SYA101", version: 1, phase: "pending", cnt: 1, last_session: PREV_SESSION, cool_until: null, detector_json: null, ...over });
  const written = async (fn) => {
    const t0 = f.trips.length;
    await fn();
    return f.written(t0);
  };
  c.eq(await written(() => api.store.writeStates(api.world.env, [S({})])), 1, "state: a new row is one write");
  c.eq(await written(() => api.store.writeStates(api.world.env, [S({})])), 0, "state: the same row again writes nothing");
  c.eq(await written(() => api.store.writeStates(api.world.env, [S({ last_session: SESSION })])), 0, "state: a changed last_session alone is not worth a write");
  c.eq(await written(() => api.store.writeStates(api.world.env, [S({ cnt: 2 })])), 1, "state: a changed count is one write");
  c.eq(await written(() => api.store.writeStates(api.world.env, [S({ cnt: 2, phase: "firing", detector_json: "{\"a\":1}" })])), 1, "state: phase and detector change in one write");
  c.eq(rawOne(api, "SELECT phase, cnt, detector_json FROM ff_state WHERE wire_id = ?", wire), { phase: "firing", cnt: 2, detector_json: "{\"a\":1}" }, "state: the stored row");
  c.eq(await written(() => api.store.writeStates(api.world.env, [{ wire_id: wire, subject: "n:SYA101", drop: true }])), 1, "state: a drop deletes the row");
  c.eq(await written(() => api.store.writeStates(api.world.env, [{ wire_id: wire, subject: "n:SYA101", drop: true }])), 0, "state: and again is nothing");
  seedRun(f, { id: "nightly:" + PREV_SESSION, kind: "nightly", session: PREV_SESSION, status: "running", attempts: 2 });
  const fence = { id: "nightly:" + PREV_SESSION, token: 2 };
  c.eq(await written(() => api.store.writeStates(api.world.env, [S({ subject: "n:SYA102" })], fence)), 1, "state: the lease holder writes");
  c.eq(await written(() => api.store.writeStates(api.world.env, [S({ subject: "n:SYB201" })], { id: fence.id, token: 1 })), 0, "state: an older token writes nothing");
  c.eq(await written(() => api.store.writeStates(api.world.env, [{ wire_id: wire, subject: "n:SYA102", drop: true }], { id: fence.id, token: 1 })), 0, "state: nor drops");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_state").n, 1, "state: one row remains");
  const big = Array.from({ length: 95 }, (_, i) => S({ subject: "n:SYX" + String(i + 100) }));
  const t0 = f.trips.length;
  await api.store.writeStates(api.world.env, big);
  c.eq(f.trips.slice(t0).length, 3, "state: ninety-five rows go in three batches of at most forty");

  const R = (over) => ({ wire_id: wire, version: 1, session: PREV_SESSION, status: "evaluated", reason: null, looks: 1, names_evaluated: 4, names_absent: 0, hits: 1, evaluated_at: NOW - 1000, ...over });
  const cutoff = NOW + 3600000;
  await api.store.writeReceipts(api.world.env, [R({})], { cutoff });
  c.eq(rawOne(api, "SELECT status, hits, late FROM ff_receipt WHERE wire_id = ?", wire), { status: "evaluated", hits: 1, late: 0 }, "receipt: an evaluated receipt is stored");
  const before = f.trips.length;
  await api.store.writeReceipts(api.world.env, [R({ hits: 9 })], { cutoff });
  c.eq([f.written(before), rawOne(api, "SELECT hits FROM ff_receipt WHERE wire_id = ?", wire).hits], [0, 1], "receipt: an evaluated receipt is final");
  await api.store.writeReceipts(api.world.env, [R({ status: "not_evaluated", reason: "run_late" })], { cutoff });
  c.eq(rawOne(api, "SELECT status FROM ff_receipt WHERE wire_id = ?", wire).status, "evaluated", "receipt: it never goes back to not evaluated");
  const other = R({ session: "2026-10-23", status: "not_evaluated", reason: "run_late", looks: 0, names_evaluated: 0, hits: 0, evaluated_at: NOW - 5000 });
  await api.store.writeReceipts(api.world.env, [other], { cutoff });
  c.eq(rawOne(api, "SELECT status, reason FROM ff_receipt WHERE session = '2026-10-23'").status, "not_evaluated", "receipt: a missed session is stored");
  await api.store.writeReceipts(api.world.env, [{ ...other, reason: "source_stale" }], { cutoff });
  c.eq(rawOne(api, "SELECT reason FROM ff_receipt WHERE session = '2026-10-23'").reason, "run_late", "receipt: a second miss does not rewrite the first");
  await api.store.writeReceipts(api.world.env, [R({ session: "2026-10-23", hits: 2, evaluated_at: NOW - 100 })], { cutoff });
  const up = rawOne(api, "SELECT status, reason, hits, late, upgraded_at FROM ff_receipt WHERE session = '2026-10-23'");
  c.eq([up.status, up.hits, up.late, up.upgraded_at], ["evaluated", 2, 1, NOW - 100], "receipt: a later run upgrades a miss to evaluated, flagged late");
  await api.store.writeReceipts(api.world.env, [other, R({ session: "2026-10-22", status: "not_evaluated", reason: "run_late", looks: 0, evaluated_at: NOW - 3000 })], { cutoff });
  await api.store.writeReceipts(api.world.env, [R({ session: "2026-10-22", evaluated_at: NOW + 7200000 })], { cutoff });
  c.eq(rawOne(api, "SELECT status FROM ff_receipt WHERE session = '2026-10-22'").status, "not_evaluated", "receipt: an evaluation stamped after the cutoff does not upgrade a miss");

  const K = (over) => ({ wire_id: wire, version: 1, period: "all", firings: 2, sessions: 10, budget: null, updated_at: NOW, ...over });
  await api.store.writeRecords(api.world.env, [K({})]);
  const b2 = f.trips.length;
  await api.store.writeRecords(api.world.env, [K({ updated_at: NOW + 99999 })]);
  c.eq(f.written(b2), 0, "record: an identical record with a newer stamp writes nothing");
  await api.store.writeRecords(api.world.env, [K({ firings: 3, confirmation: 0.5, confirm_n: 2 })]);
  c.eq(rawOne(api, "SELECT firings, confirmation, confirm_n FROM ff_record WHERE wire_id = ? AND period = 'all'", wire), { firings: 3, confirmation: 0.5, confirm_n: 2 }, "record: a changed record updates in place");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_record").n, 1, "record: one row");
  const b3 = f.trips.length;
  await api.store.writeRecords(api.world.env, [K({ firings: 5 })], { id: fence.id, token: 1 });
  c.eq([f.written(b3), rawOne(api, "SELECT firings FROM ff_record WHERE wire_id = ?", wire).firings], [0, 3], "record: an older token writes nothing");
  void bob;
}

export async function runs(c, build) {
  const { api } = await setup(build);
  const spec = (over = {}) => ({ id: "nightly:2026-10-26", kind: "nightly", session: PREV_SESSION, slot: "n", leaseUntil: NOW + 600000, now: NOW, version: "e1", attemptsMax: 3, ...over });
  const first = await api.store.claimRun(api.world.env, spec());
  c.eq([first.claimed, first.token, first.row.status, first.row.attempts], [true, 1, "running", 1], "runs: the first claim holds token 1");
  const again = await api.store.claimRun(api.world.env, spec({ now: NOW + 1000 }));
  c.eq([again.claimed, again.token], [false, null], "runs: a second worker cannot take a live lease");
  const expired = await api.store.claimRun(api.world.env, spec({ now: NOW + 700000, leaseUntil: NOW + 1300000 }));
  c.eq([expired.claimed, expired.token], [true, 2], "runs: an expired lease is taken over with the next token");
  const staleFinish = await api.store.finishRun(api.world.env, "nightly:2026-10-26", { token: 1, now: NOW, wires: 5, names: 100, unknown: 2, rowsRead: 10, rowsWritten: 3 });
  c.eq(staleFinish, false, "runs: the old holder cannot finish the run");
  const fail = await api.store.finishRun(api.world.env, "nightly:2026-10-26", { token: 2, error: "boom ".repeat(100) });
  c.eq(fail, true, "runs: the holder can fail it");
  const failed = rawOne(api, "SELECT status, error FROM ff_run WHERE id = 'nightly:2026-10-26'");
  c.eq([failed.status, failed.error.length], ["failed", 240], "runs: with the error cut to 240 characters");
  const retry = await api.store.claimRun(api.world.env, spec({ now: NOW + 800000 }));
  c.eq([retry.claimed, retry.token], [true, 3], "runs: a failed run can be claimed again");
  const done = await api.store.finishRun(api.world.env, "nightly:2026-10-26", { token: 3, now: NOW + 900000, wires: 5, names: 100, unknown: 2, rowsRead: 10, rowsWritten: 3 });
  c.eq(done, true, "runs: and finished");
  const row = rawOne(api, "SELECT status, wires_evaluated, names_evaluated, unknown_count, finished_at, lease_until, error FROM ff_run WHERE id = 'nightly:2026-10-26'");
  c.eq(row, { status: "done", wires_evaluated: 5, names_evaluated: 100, unknown_count: 2, finished_at: NOW + 900000, lease_until: null, error: null }, "runs: the figures are stored and the lease cleared");
  const never = await api.store.claimRun(api.world.env, spec({ now: NOW + 5000000 }));
  c.eq(never.claimed, false, "runs: a done run is never claimed again");
  const once = spec({ id: "nightly:2026-10-22", session: "2026-10-22" });
  await api.store.claimRun(api.world.env, once);
  await api.store.finishRun(api.world.env, once.id, { token: 1, now: NOW + 1, wires: 1, names: 1, unknown: 0, rowsRead: 1, rowsWritten: 1 });
  const again2 = await api.store.claimRun(api.world.env, { ...once, now: NOW + 9000000 });
  c.eq([again2.claimed, again2.row.status, again2.row.attempts], [false, "done", 1], "runs: a run finished at its first attempt is not claimed again either");
  const twice = await api.store.finishRun(api.world.env, "nightly:2026-10-26", { token: 3, now: NOW + 950000, wires: 9, names: 9, unknown: 9, rowsRead: 9, rowsWritten: 9 });
  c.eq(twice, false, "runs: a finished run cannot be finished twice");

  const cap = spec({ id: "nightly:2026-10-23", session: "2026-10-23" });
  await api.store.claimRun(api.world.env, cap);
  await api.store.finishRun(api.world.env, cap.id, { token: 1, error: "e" });
  await api.store.claimRun(api.world.env, { ...cap, now: NOW + 1 });
  await api.store.finishRun(api.world.env, cap.id, { token: 2, error: "e" });
  await api.store.claimRun(api.world.env, { ...cap, now: NOW + 2 });
  await api.store.finishRun(api.world.env, cap.id, { token: 3, error: "e" });
  const exhausted = await api.store.claimRun(api.world.env, { ...cap, now: NOW + 3 });
  c.eq([exhausted.claimed, exhausted.row.attempts], [false, 3], "runs: three attempts and no more");

  const tick = { id: "live:" + SESSION, session: SESSION, slot: "15", slots: null, now: NOW, wires: 4, names: 40, hits: 1, unknown: 0, rowsRead: 20, rowsWritten: 5, version: "e1" };
  c.eq(await api.store.tickRun(api.world.env, tick), true, "ticks: the first tick creates the session's live row");
  c.eq(await api.store.tickRun(api.world.env, { ...tick, now: NOW + 900000, hits: 2, rowsRead: 20, rowsWritten: 5 }), true, "ticks: the next adds to it");
  const t = rawOne(api, "SELECT status, attempts, hits_written, rows_read, rows_written, finished_at FROM ff_run WHERE id = ?", tick.id);
  c.eq(t, { status: "done", attempts: 2, hits_written: 3, rows_read: 40, rows_written: 10, finished_at: NOW + 900000 }, "ticks: hits and rows accumulate, finished_at follows the latest");
  c.eq(await api.store.tickRun(api.world.env, { ...tick, now: NOW - 5000 }), false, "ticks: a tick that started before the recorded one is ignored");
  await api.store.tickRun(api.world.env, { ...tick, now: NOW + 1800000, error: "vendor down" });
  const e = rawOne(api, "SELECT status, error, finished_at FROM ff_run WHERE id = ?", tick.id);
  c.eq([e.status, e.error, e.finished_at], ["failed", "vendor down", NOW + 900000], "ticks: a failed tick marks the row failed and keeps the last finish time");
  const pruned = await api.store.pruneRuns(api.world.env, "2026-10-24");
  c.eq(pruned, 2, "ticks: the prune removes the two runs before the cutoff");
  c.eq(rawAll(api, "SELECT id FROM ff_run ORDER BY id").map((r) => r.id), ["live:" + SESSION, "nightly:" + PREV_SESSION], "ticks: and keeps the rest");
  c.eq(await api.store.withdrawHit(api.world.env, "a".repeat(20), "x", NOW), 0, "withdraw: an unknown hit changes nothing");
  void seedHit;
}

export async function budgetRounding(c, build) {
  const { api } = await setup(build);
  const f = api.world.f;
  f.db.prepare("INSERT INTO ff_member (member_id, read_seq, house_read_seq, budget_b, created_at) VALUES ('rounder.x', 0, 0, 1, ?)").run(NOW);
  const version = (exp, name) => ({
    template: "custom", cadence: "nightly", scope_kind: "names", control: "bh", exp_week: exp, clause_hash: "0123456789", registry_version: 1, sentence: "When x",
    ast_json: JSON.stringify({ v: 1, cadence: "nightly", scope: { kind: "names", symbols: [name] }, all: [{ m: "flow.net_premium.z20", op: ">=", x: 3 }], persist: 1 }),
    ast_hash: (exp + name).split("").map((ch) => ch.charCodeAt(0).toString(16)).join("").padEnd(64, "0").slice(0, 64),
  });
  const make = (id, exp, name) => api.store.createWire(api.world.env, "rounder.x", { id, title: id, version: version(exp, name), symbols: [name], effectiveSession: PREV_SESSION, runId: "none" }, NOW);
  c.eq((await make("w-roundaaaaaaaaaaa", 0.1, "SYA101")).created, true, "rounding: 0.1 is admitted under a budget of 1");
  c.eq((await make("w-roundbaaaaaaaaaa", 0.7, "SYA102")).created, true, "rounding: and 0.7 more, the stored sum is 0.7999999999999999 in floating point");
  c.eq(f.db.prepare("SELECT SUM(exp_week) AS s FROM ff_wire_version").get().s < 0.8, true, "rounding: the sum really is a hair under 0.8");
  const refused = await make("w-roundcaaaaaaaaaa", 0.201, "SYB201");
  c.eq(refused.created, false, "rounding: 0.201 more would make 1.001 and is refused, a truncated sum would have let it through");
  const edge = await make("w-rounddaaaaaaaaaa", 0.2, "SYB202");
  c.eq(edge.created, true, "rounding: 0.2 more makes exactly 1.0 and is admitted");
  const over = await make("w-roundeaaaaaaaaaa", 0.001, "SYC301");
  c.eq(over.created, false, "rounding: and a thousandth beyond is refused");
  c.eq(f.db.prepare("SELECT count(*) AS n FROM ff_wire WHERE member_id = 'rounder.x'").get().n, 3, "rounding: three wires exist");
  const cap = await api.store.capacity(api.world.env, "rounder.x", { runId: "none" });
  c.eq([cap.armed, cap.milli, cap.budget_b], [3, 1000, 1], "rounding: the capacity row shows 1000 thousandths of a budget of 1");
}
