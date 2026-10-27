import { LIMITS } from "../../shared/ff-contract.js";
import { alice, bob, astOf, anomalyAst, liveAst, seedWire, seedRun, NOW, SESSION, PREV_SESSION, NAMES } from "./ff-b-world.mjs";
import { refDerivedId } from "./ff-b-kit.mjs";

const rawWires = (api) => api.world.f.db.prepare("SELECT * FROM ff_wire ORDER BY id").all();
const rawVersions = (api, id) => api.world.f.db.prepare("SELECT * FROM ff_wire_version WHERE wire_id = ? ORDER BY version").all(id);
const rawSymbols = (api, member) => api.world.f.db.prepare("SELECT symbol, wire_id FROM ff_wire_symbol WHERE member_id = ? ORDER BY symbol, wire_id").all(member);
const rawOne = (api, sql, ...args) => api.world.f.db.prepare(sql).get(...args);

const letters = (i) => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));

const fill = (api, member, n, over = {}) => {
  for (let i = 0; i < n; i++) {
    const id = "w-" + member.slice(0, 1) + "fill" + letters(i) + "aaaaaaaaa";
    seedWire(api.world.f, { member, id, title: "Fill " + i, symbols: [NAMES[i % NAMES.length]], clauseHash: String(i).padStart(10, "0"), astHash: String(i + 1).padStart(64, "0"), ...over });
  }
};

const universeAst = (over = {}) => astOf({ scope: { kind: "universe" }, ...over });

export async function lifecycle(c, build) {
  {
    const api = build();
    const made = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() } });
    c.eq(made.status, 201, "create: a new wire answers 201");
    const id = made.body && made.body.wire && made.body.wire.id;
    c.ok(/^w-[a-z2-7]{16}$/.test(id || ""), "create: the id has the member wire grammar", id);
    c.eq(made.body.replayed, false, "create: a first create is not a replay");
    c.eq(made.body.wire.version, 1, "create: version 1");
    c.eq(made.body.wire.status, "armed", "create: armed");
    const wires = rawWires(api);
    c.eq(wires.length, 1, "create: exactly one wire row");
    c.eq([wires[0].member_id, wires[0].layer, wires[0].current_version], ["alice.one", "member", 1], "create: the row is the caller's member wire");
    const versions = rawVersions(api, id);
    c.eq(versions.length, 1, "create: exactly one version row");
    c.eq(versions[0].ast_hash, made.body.wire.ast ? versions[0].ast_hash : "", "create: the version carries a hash");
    c.eq(rawSymbols(api, "alice.one").map((s) => s.symbol), ["SYA101", "SYA102"], "create: the symbol index holds the names");
    c.eq(made.body.limits.armed, { used: 1, max: LIMITS.armedMemberWires }, "create: the limits block counts the new wire");
    c.ok(made.body.wire.ast && !("d" in made.body.wire.ast) && !("control" in made.body.wire.ast), "create: the reply carries the member's own AST and not the derived block", Object.keys(made.body.wire.ast || {}));
    c.ok(!JSON.stringify(made.body).includes('"rv"'), "create: nor the registry version of the derived block");
    c.eq(made.written, 4, "create: rows written are the wire, the version and two symbols");
    c.ok(made.trips <= 4, "create: at most four trips, the switch reads and the universe read concurrent and one batch after them", made.trips);
    c.ok(made.body.wire.title.length > 0 && made.body.wire.title.length <= 80, "create: the title defaults to the sentence, 80 characters at most");
    const named = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }), title: "  My wire  " } });
    c.eq(named.body.wire.title, "My wire", "create: a given title is trimmed");
    const long = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB202"] } }), title: "x".repeat(81) } });
    c.eq(long.error && long.error.code, "ff_grammar_invalid", "create: an 81-character title is refused");
    const unknown = await api.call("POST", "/api/ff/wires", { body: { ast: astOf(), member: "bob.two" } });
    c.eq(unknown.error && unknown.error.code, "ff_grammar_invalid", "create: a field the route does not take is refused");
  }

  {
    const api = build();
    const key = { "Idempotency-Key": "retry-key-1" };
    const first = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: key });
    const again = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: key });
    c.eq([first.status, again.status], [201, 200], "idempotency: 201 then 200");
    c.eq(again.body.replayed, true, "idempotency: the second answer is a replay");
    c.eq(first.body.wire.id, refDerivedId("alice.one", "retry-key-1"), "idempotency: the id is the independent hash of the member and the key");
    c.eq(again.body.wire.id, first.body.wire.id, "idempotency: the same wire");
    c.eq(rawWires(api).length, 1, "idempotency: one wire row");
    c.eq(rawVersions(api, first.body.wire.id).length, 1, "idempotency: one version row");
    c.eq(rawSymbols(api, "alice.one").length, 2, "idempotency: one set of symbol rows");
    const titled = await api.call("POST", "/api/ff/wires", { body: { ast: astOf(), title: "Another title" }, headers: key });
    c.eq([titled.status, titled.body.wire.title], [200, first.body.wire.title], "idempotency: a different title on a replay is ignored");
    const other = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }) }, headers: key });
    c.eq([other.status, other.error && other.error.code], [409, "attempt_conflict"], "idempotency: the same key with another wire is a conflict");
    const theirs = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: key, user: bob });
    c.eq(theirs.status, 201, "idempotency: another member's create under the same key is a new wire");
    c.ok(theirs.body.wire.id !== first.body.wire.id, "idempotency: and a different id");
    c.eq(theirs.body.wire.id, refDerivedId("bob.two", "retry-key-1"), "idempotency: the id is derived from the member too");
    const bad = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: { "Idempotency-Key": "has space" } });
    c.eq(bad.error && bad.error.code, "ff_grammar_invalid", "idempotency: a key with a space is refused");
  }

  {
    const api = build();
    const key = { "Idempotency-Key": "adjust-then-retry" };
    const first = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: key });
    const id = first.body.wire.id;
    const moved = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYA101"] } }) } });
    c.eq(moved.status, 200, "idempotency: the member adjusts the wire to version 2 in another tab");
    const retry = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: key });
    c.eq([retry.status, retry.body && retry.body.replayed], [200, true], "idempotency: a retry of the lost create after an adjust is still a replay of version 1");
  }

  {
    const api = build();
    fill(api, "alice.one", 49);
    const key = { "Idempotency-Key": "at-the-cap" };
    const fiftieth = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: key });
    c.eq(fiftieth.status, 201, "quota: the fiftieth armed wire is admitted");
    const retry = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: key });
    c.eq([retry.status, retry.body && retry.body.replayed], [200, true], "quota: the retry of a create at the cap is a replay and not a refusal");
    const over = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }) } });
    c.eq([over.status, over.error && over.error.code], [409, "ff_wire_limit"], "quota: the fifty-first is refused");
    c.eq(over.body.limit, "armed", "quota: the refusal names the limit");
    c.eq([over.body.used, over.body.max], [50, 50], "quota: and its figures");
    c.eq(rawWires(api).length, 50, "quota: nothing was written for the refusal");
    const budgetRead = fiftieth.read;
    c.ok(budgetRead <= 120, "quota: a create at 49 armed reads about a hundred rows", budgetRead);
  }

  {
    const api = build();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await api.call("POST", "/api/ff/wires", { body: { ast: universeAst({ persist: 1, all: [{ m: "earn.sessions", op: "<=", x: i + 1 }] }) } }));
    c.eq(results.map((r) => r.status), [201, 201, 201, 201, 201, 409], "quota: five universe wires, the sixth is refused");
    c.eq(results[5].body.limit, "universe", "quota: and named universe");
    const live = [];
    for (let i = 0; i < 6; i++) live.push(await api.call("POST", "/api/ff/wires", { body: { ast: liveAst({ all: [{ m: "contract.dte", op: "<=", x: i + 1 }, { m: "contract.premium", op: ">=", x: 1000000 }] }) } }));
    c.eq(live.map((r) => r.status), [201, 201, 201, 201, 201, 409], "quota: five live wires, the sixth is refused");
    c.eq(live[5].body.limit, "live", "quota: and named live");
  }

  {
    const api = build();
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await api.call("POST", "/api/ff/wires", { body: { ast: anomalyAst({ scope: { kind: "names", symbols: [NAMES[2 * i], NAMES[2 * i + 1]] }, all: [{ m: "flow.net_premium.z20", op: ">=", x: 3 + i }] }) } }));
    c.eq(made.map((r) => r.status), [201, 201, 201, 201, 409], "budget: four wires of 0.5 fill a budget of 2 exactly and the fifth is refused");
    c.eq(made[4].error && made[4].error.code, "ff_budget_exceeded", "budget: the refusal is ff_budget_exceeded");
    c.eq([made[4].body.used, made[4].body.adding, made[4].body.max], [2, 0.5, 2], "budget: and carries the figures");
    c.eq(made[3].body.limits.budget.used, 2, "budget: the limits block shows the budget used");
  }

  for (const [exps, add, want, label] of [
    [[0.1, 0.2, 0.3], 2, 409, "0.1 + 0.2 + 0.3 plus 0.5 is over a budget of 1"],
    [[0.1, 0.2, 0.3], 1, 201, "0.1 + 0.2 + 0.3 plus 0.25 is 0.85 and is admitted"],
    [[0.1, 0.2, 0.4], 2, 409, "0.1 + 0.2 + 0.4 plus 0.5 is over a budget of 1"],
    [[0.1, 0.2, 0.2], 2, 201, "0.1 + 0.2 + 0.2 plus 0.5 is exactly a budget of 1 and is admitted"],
    [[0.1, 0.1, 0.1], 3, 409, "0.3 plus 0.75 is 1.05 and is refused"],
  ]) {
    const api = build();
    api.world.f.db.prepare("INSERT INTO ff_member (member_id, read_seq, house_read_seq, budget_b, created_at) VALUES ('alice.one', 0, 0, 1, ?)").run(NOW);
    exps.forEach((exp, i) => seedWire(api.world.f, { member: "alice.one", id: "w-bud" + letters(i) + "aaaaaaaaaaa", title: "B" + i, control: "bh", exp, symbols: [NAMES[i]], clauseHash: "000000000" + i, astHash: String(i + 1).repeat(64).slice(0, 64) }));
    const names = NAMES.slice(6, 6 + add);
    const r = await api.call("POST", "/api/ff/wires", { body: { ast: anomalyAst({ scope: { kind: "names", symbols: names }, all: [{ m: "flow.net_premium.z20", op: ">=", x: 3.5 }] }) } });
    const total = exps.reduce((a, b) => Math.round((a + b) * 1000) / 1000, 0) + 0.25 * add;
    c.eq(want, total <= 1.0000001 ? 201 : 409, "budget float: the table row agrees with exact arithmetic: " + label);
    c.eq(r.status, want, "budget float: " + label);
    if (want === 409) c.eq(r.error && r.error.code, "ff_budget_exceeded", "budget float: refused with ff_budget_exceeded: " + label);
  }

  {
    const api = build();
    const due = "2026-10-26";
    seedRun(api.world.f, { id: "nightly:" + due, kind: "nightly", session: due });
    api.world.f.db.prepare("UPDATE ff_run SET wires_evaluated = 1950 WHERE id = ?").run("nightly:" + due);
    const refused = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() } });
    c.eq([refused.status, refused.body && refused.body.limit], [409, "capacity"], "capacity: the evaluator at 1950 wires admits no new wire");
    c.eq(rawWires(api).length, 0, "capacity: nothing written");
    api.world.f.db.prepare("UPDATE ff_run SET wires_evaluated = 1949 WHERE id = ?").run("nightly:" + due);
    const admitted = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() } });
    c.eq(admitted.status, 201, "capacity: 1949 admits");
  }
}

export async function adjusting(c, build) {
  const api = build();
  const made = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() } });
  const id = made.body.wire.id;
  api.world.f.db.prepare("INSERT INTO ff_state (wire_id, subject, version, phase, cnt, last_session) VALUES (?, 'n:SYA101', 1, 'firing', 1, ?)").run(id, PREV_SESSION);
  const t0 = api.world.f.trips.length;
  const same = await api.call("PATCH", "/api/ff/wires", { body: { id, ast: astOf() } });
  c.eq([same.status, same.body && same.body.replayed], [200, true], "adjust: the same definition is a replay, whatever expect says");
  c.eq(rawVersions(api, id).length, 1, "adjust: the replay wrote no version");
  c.eq(same.written, 0, "adjust: the replay wrote no row");
  void t0;

  const retitled = await api.call("PATCH", "/api/ff/wires", { body: { id, title: "Renamed" } });
  c.eq([retitled.status, retitled.body.wire.title, retitled.body.wire.version], [200, "Renamed", 1], "adjust: a title-only edit makes no version");
  c.eq(rawVersions(api, id).length, 1, "adjust: and writes no version row");

  const stateKept = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYB201"] } }) } });
  c.eq([stateKept.status, stateKept.body.wire.version], [200, 2], "adjust: a scope change makes version 2");
  c.eq(rawSymbols(api, "alice.one").map((s) => s.symbol), ["SYA101", "SYB201"], "adjust: the symbol index follows the diff");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_state WHERE wire_id = ?", id).n, 1, "adjust: a scope-only change keeps the state");
  c.eq(stateKept.written, 4, "adjust: a version, one symbol dropped, one added and the pointer are four rows", stateKept.written);
  const versions2 = rawVersions(api, id);
  c.eq(versions2.map((v) => v.version), [1, 2], "adjust: both versions are kept");

  const tweak = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 2, ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYB201"] }, all: [{ m: "earn.sessions", op: "<=", x: 8 }, { m: "earn.confirmed", op: "==", x: 1 }] }) } });
  c.eq([tweak.status, tweak.body.wire.version], [200, 3], "adjust: a threshold change makes version 3");
  c.eq(tweak.written, 3, "adjust: a threshold change writes the version, the cleared state and the pointer, and no symbol row", tweak.written);
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_state WHERE wire_id = ?", id).n, 0, "adjust: a clause change clears the state");

  const stale = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 2, ast: astOf({ scope: { kind: "names", symbols: ["SYB202"] } }) } });
  c.eq([stale.status, stale.error && stale.error.code], [409, "ff_version_immutable"], "adjust: a stale expect is a conflict");
  c.eq(stale.body.current, 3, "adjust: carrying the current version");
  const missing = await api.call("PATCH", "/api/ff/wires", { body: { id, ast: astOf({ scope: { kind: "names", symbols: ["SYB202"] } }) } });
  c.eq(missing.error && missing.error.code, "ff_grammar_invalid", "adjust: a changed definition without expect is refused");
  const lost = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 2, ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYB201"] }, all: [{ m: "earn.sessions", op: "<=", x: 8 }, { m: "earn.confirmed", op: "==", x: 1 }] }) } });
  c.eq([lost.status, lost.body && lost.body.replayed], [200, true], "adjust: the retry of an adjust whose answer was lost replays whatever expect says");

  const cadence = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 3, ast: liveAst() } });
  c.eq([cadence.error && cadence.error.code, cadence.body.field], ["ff_grammar_invalid", "cadence"], "adjust: a cadence change is refused");
  const reserved = await api.call("PATCH", "/api/ff/wires", { body: { id, version: 3, ast: astOf({ scope: { kind: "watchlist" } }) } });
  c.eq(reserved.error && reserved.error.code, "ff_scope_reserved", "adjust: a reserved scope keeps its code");
  const houseEdit = await api.call("PATCH", "/api/ff/wires", { body: { id: "h-t01", version: 1, ast: astOf() } });
  c.eq([houseEdit.status, houseEdit.error && houseEdit.error.code], [403, "ff_house_readonly"], "adjust: a house wire cannot be adjusted either");
  const houseTitle = await api.call("PATCH", "/api/ff/wires", { body: { id: "h-t01", title: "mine" } });
  c.eq([houseTitle.status, houseTitle.error && houseTitle.error.code], [403, "ff_house_readonly"], "adjust: nor renamed");
  const house = await api.call("PATCH", "/api/ff/wires", { body: { id: "h-t01", status: "retired" } });
  c.eq([house.status, house.error && house.error.code], [403, "ff_house_readonly"], "adjust: a house wire is read-only");
  const houseTrips = house.trips;
  c.eq(houseTrips, 0, "adjust: and refused before any store read");
  const unknown = await api.call("PATCH", "/api/ff/wires", { body: { id: "w-zzzzzzzzzzzzzzzz", title: "x" } });
  c.eq(unknown.error && unknown.error.code, "ff_wire_not_found", "adjust: an unknown wire is not found");
  const both = await api.call("PATCH", "/api/ff/wires", { body: { id, status: "paused", title: "x" } });
  c.eq(both.error && both.error.code, "ff_grammar_invalid", "adjust: a status and an edit in one request is refused");

  const lifeId = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }) } })).body.wire.id;
  const paused = await api.call("PATCH", "/api/ff/wires", { body: { id: lifeId, status: "paused" } });
  c.eq([paused.status, paused.body.wire.status, paused.body.wire.version], [200, "paused", 1], "status: pause keeps the version");
  const pausedAgain = await api.call("PATCH", "/api/ff/wires", { body: { id: lifeId, status: "paused" } });
  c.eq([pausedAgain.status, pausedAgain.body.replayed], [200, true], "status: pausing a paused wire is a replay");
  const retired = await api.call("PATCH", "/api/ff/wires", { body: { id: lifeId, status: "retired" } });
  c.eq([retired.status, retired.body.wire.status], [200, "retired"], "status: retire from paused");
  c.eq(retired.written, 1, "status: a retire writes the status row alone", retired.written);
  c.eq(rawSymbols(api, "alice.one").some((s) => s.wire_id === lifeId), true, "status: the symbol rows stay and readers filter by status");
  const retiredAgain = await api.call("PATCH", "/api/ff/wires", { body: { id: lifeId, status: "retired" } });
  c.eq([retiredAgain.status, retiredAgain.body.replayed], [200, true], "status: retiring a retired wire is a replay");
  const pauseRetired = await api.call("PATCH", "/api/ff/wires", { body: { id: lifeId, status: "paused" } });
  c.eq(pauseRetired.error && pauseRetired.error.code, "ff_grammar_invalid", "status: a retired wire cannot be paused");
  const editRetired = await api.call("PATCH", "/api/ff/wires", { body: { id: lifeId, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYC302"] } }) } });
  c.eq(editRetired.error && editRetired.error.code, "ff_grammar_invalid", "status: a retired wire cannot be adjusted");
  const restored = await api.call("PATCH", "/api/ff/wires", { body: { id: lifeId, status: "armed" } });
  c.eq([restored.status, restored.body.wire.status, restored.body.wire.version], [200, "armed", 1], "status: restore keeps the id and the version");
  c.eq(restored.body.wire.id, lifeId, "status: restore keeps the id");
  const listed = await api.call("GET", "/api/ff/wires?status=retired");
  c.eq(listed.body.wires.length, 0, "status: nothing is retired after the restore");

  const capApi = build();
  fill(capApi, "alice.one", 49);
  const fiftieth = await capApi.call("POST", "/api/ff/wires", { body: { ast: astOf() } });
  const pauseOne = await capApi.call("PATCH", "/api/ff/wires", { body: { id: fiftieth.body.wire.id, status: "paused" } });
  c.eq(pauseOne.body.wire.status, "paused", "status: pausing at the cap frees a slot");
  const refill = await capApi.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }) } });
  c.eq(refill.status, 201, "status: the freed slot takes a new wire");
  const resume = await capApi.call("PATCH", "/api/ff/wires", { body: { id: fiftieth.body.wire.id, status: "armed" } });
  c.eq([resume.status, resume.error && resume.error.code], [409, "ff_wire_limit"], "status: resuming at the cap is refused");
  const retireOne = await capApi.call("PATCH", "/api/ff/wires", { body: { id: refill.body.wire.id, status: "retired" } });
  const restoreAfter = await capApi.call("PATCH", "/api/ff/wires", { body: { id: fiftieth.body.wire.id, status: "armed" } });
  c.eq([retireOne.status, restoreAfter.status], [200, 200], "status: after a retire the paused wire resumes");
  const restoreRetired = await capApi.call("PATCH", "/api/ff/wires", { body: { id: refill.body.wire.id, status: "armed" } });
  c.eq([restoreRetired.status, restoreRetired.error && restoreRetired.error.code], [409, "ff_wire_limit"], "status: restoring a retired wire at the cap is refused");
}

export async function versioning(c, build) {
  const api = build();
  const made = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() } });
  const id = made.body.wire.id;
  let version = 1;
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const r = await api.call("PATCH", "/api/ff/wires", { body: { id, version: version, ast: astOf({ all: [{ m: "earn.sessions", op: "<=", x: 1 + i }, { m: "earn.confirmed", op: "==", x: 1 }] }) } });
    codes.push(r.status);
    if (r.status === 200) version = r.body.wire.version;
    else {
      c.eq(r.error.code, "rate_limited", "versions: the cap answers rate_limited");
      c.ok(Number(r.headers["retry-after"]) > 0, "versions: with a Retry-After", r.headers["retry-after"]);
      c.eq(r.body.limit, "versions", "versions: and names the limit");
      break;
    }
  }
  c.eq(codes.filter((s) => s === 200).length, LIMITS.versionsPerWirePerSession - 1, "versions: nine adjusts after the first version fill a session's ten", codes);
  const symbolsBefore = JSON.stringify(rawSymbols(api, "alice.one"));
  const atCap = await api.call("PATCH", "/api/ff/wires", { body: { id, version, ast: astOf({ scope: { kind: "names", symbols: ["SYB201", "SYB202"] } }) } });
  c.eq([atCap.status, atCap.body && atCap.body.limit], [429, "versions"], "versions: a scope change at the cap is refused as well");
  c.eq(JSON.stringify(rawSymbols(api, "alice.one")), symbolsBefore, "versions: and leaves the symbol index exactly as it was");
  c.eq(rawVersions(api, id).length, LIMITS.versionsPerWirePerSession, "versions: with no eleventh version row");
  api.world.core.setSession("2026-10-28");
  const next = await api.call("PATCH", "/api/ff/wires", { body: { id, version: version, ast: astOf({ all: [{ m: "earn.sessions", op: "<=", x: 9 }, { m: "earn.confirmed", op: "==", x: 1 }] }) } });
  c.eq(next.status, 200, "versions: the next session takes an adjust again");

  const race = build();
  const base = await race.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYA102"] } }) } });
  const rid = base.body.wire.id;
  const [a, b] = await Promise.all([
    race.call("PATCH", "/api/ff/wires", { body: { id: rid, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYB201", "SYB202"] } }) } }),
    race.call("PATCH", "/api/ff/wires", { body: { id: rid, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYC301", "SYC302"] } }) } }),
  ]);
  c.eq([a.status, b.status].sort(), [200, 409], "race: two adjusts at the same version, one wins and one conflicts");
  const loser = a.status === 409 ? a : b;
  c.eq(loser.error.code, "ff_version_immutable", "race: the loser gets ff_version_immutable");
  c.eq(rawVersions(race, rid).length, 2, "race: exactly one new version");
  const winner = a.status === 200 ? a : b;
  const wanted = winner === a ? ["SYB201", "SYB202"] : ["SYC301", "SYC302"];
  c.eq(rawSymbols(race, "alice.one").map((s) => s.symbol), wanted, "race: the symbol index is the winner's names and not the loser's");
  race.world.f.db.prepare("INSERT INTO ff_state (wire_id, subject, version, phase, cnt, last_session) VALUES (?, 'n:SYB201', 2, 'firing', 1, ?)").run(rid, PREV_SESSION);
  const straggler = await race.store.adjustWire(race.world.env, "alice.one", {
    id: rid, expect: 1, title: "late", version: (await race.world.core.compile({ body: astOf({ scope: { kind: "names", symbols: ["SYD401", "SYD402"] } }), universe: race.world.universe })).version,
    effectiveSession: SESSION, drop: ["SYA101", "SYA102"], add: ["SYD401", "SYD402"], clauseChanged: true,
  }, NOW + 5);
  c.eq(straggler.advanced, false, "race: a stale batch advances nothing");
  c.eq(rawSymbols(race, "alice.one").map((s) => s.symbol), wanted, "race: and rewrites no symbol row");
  c.eq(rawOne(race, "SELECT count(*) AS n FROM ff_state WHERE wire_id = ?", rid).n, 1, "race: and clears no state");
  c.eq(rawVersions(race, rid).length, 2, "race: and writes no version");

  const hits = build();
  const wire = await hits.call("POST", "/api/ff/wires", { body: { ast: astOf() } });
  const wid = wire.body.wire.id;
  const sentenceV1 = wire.body.wire.sentence;
  const { seedHit } = await import("./ff-b-world.mjs");
  const seeded = seedHit(hits.world.f, { stream: "alice.one", wire: wid, version: 1, symbol: "SYA101" });
  await hits.call("PATCH", "/api/ff/wires", { body: { id: wid, version: 1, ast: astOf({ all: [{ m: "earn.sessions", op: "<=", x: 7 }, { m: "earn.confirmed", op: "==", x: 1 }] }) } });
  const detail = await hits.call("GET", "/api/ff/hits?id=" + seeded.hitId);
  c.eq(detail.status, 200, "versioning: the old hit still opens");
  c.eq(detail.body.hit.sentence, sentenceV1, "versioning: an old hit renders the sentence of the version that produced it");
  c.eq([detail.body.hit.wire.version, detail.body.hit.wire.currentVersion, detail.body.hit.wire.isCurrent], [1, 2, false], "versioning: and says it is not the current version");
}

export async function houseCopies(c, build) {
  const api = build();
  const compiled = await api.world.core.compile({ body: astOf({ scope: { kind: "universe" } }), universe: api.world.universe });
  seedWire(api.world.f, { member: null, id: "h-t01", title: "Earnings run-up", cadence: "nightly", scopeKind: "universe", control: "fact", astJson: compiled.version.ast_json, astHash: compiled.version.ast_hash, clauseHash: compiled.version.clause_hash, sentence: "House sentence", template: "T01" });
  const dup = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "universe" } }), origin: "h-t01" } });
  c.eq([dup.status, dup.error && dup.error.code], [409, "ff_house_duplicate"], "house: arming an unmodified copy while following is a duplicate");
  const changed = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101"] } }), origin: "h-t01" } });
  c.eq(changed.status, 201, "house: a modified copy is admitted");
  c.eq(changed.body.wire.origin, "h-t01@1", "house: and records its origin and version");
  const left = await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: false } });
  c.eq([left.status, left.body.wire.following], [200, false], "house: leaving a house wire");
  const copy = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "universe" } }), origin: "h-t01" } });
  c.eq(copy.status, 201, "house: after leaving, the unmodified copy is admitted");
  const back = await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: true } });
  c.eq([back.status, back.body.wire.following], [200, true], "house: following again");
  const nowhere = await api.call("POST", "/api/ff/house", { body: { id: "h-t09", follow: false } });
  c.eq(nowhere.error && nowhere.error.code, "ff_wire_not_found", "house: an unknown house wire is not found");
  const list = await api.call("GET", "/api/ff/house");
  c.eq(list.body.wires.map((w) => w.id), ["h-t01"], "house: the list holds the house wires");
  c.eq(list.body.wires[0].record.v, null, "house: a wire with no record has an absent record with a reason");
  c.eq(list.body.wires[0].record.reason, "no_record", "house: reason no_record");
  c.eq(list.body.wires[0].rarity.reason, "short_history", "house: and an absent rarity");
}
