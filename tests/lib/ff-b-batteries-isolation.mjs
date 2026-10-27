import { SQL } from "../../server/ff-store.js";
import { alice, bob, carol, astOf, seedHit, seedWire, seedRun, NOW, SESSION, PREV_SESSION, NAMES } from "./ff-b-world.mjs";
import { walkStrings } from "./ff-b-kit.mjs";

const SENTINEL = "SENTINEL-bob-private-note-7f3a";

export const statementsOf = (f, from = 0) => {
  const out = [];
  for (const t of f.trips.slice(from)) {
    if (!t.sqls) continue;
    if (t.kind === "batch") t.sqls.forEach((sql, i) => out.push({ sql, args: t.args[i] || [] }));
    else out.push({ sql: t.sqls[0], args: (t.args && t.args[0]) || [] });
  }
  return out;
};

const known = new Map(Object.entries(SQL).map(([name, st]) => [st.text, { name, scope: st.scope }]));

export const classify = (statement) => known.get(statement.sql) || null;

const rawAll = (api, sql, ...args) => api.world.f.db.prepare(sql).all(...args).map((r) => ({ ...r }));
const rawOne = (api, sql, ...args) => {
  const r = api.world.f.db.prepare(sql).get(...args);
  return r === undefined ? undefined : { ...r };
};

const compiledSeed = async (api, ast) => {
  const compiled = await api.world.core.compile({ body: ast, universe: api.world.universe });
  return compiled.version;
};

export async function isolation(c, build) {
  const api = build();
  const a = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYA102"] } }) }, user: alice });
  const b = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYB201"] } }), title: "Bob private title" }, user: bob });
  const idA = a.body.wire.id;
  const idB = b.body.wire.id;
  c.ok(idA !== idB, "isolation: two members, two wires");

  const listA = await api.call("GET", "/api/ff/wires", { user: alice });
  const listB = await api.call("GET", "/api/ff/wires", { user: bob });
  const listC = await api.call("GET", "/api/ff/wires", { user: carol });
  c.eq(listA.body.wires.map((w) => w.id), [idA], "isolation: alice lists her wire alone");
  c.eq(listB.body.wires.map((w) => w.id), [idB], "isolation: bob lists his wire alone");
  c.eq(listC.body.wires.length, 0, "isolation: carol lists nothing");
  c.eq(listA.body.limits.armed.used, 1, "isolation: alice's armed count is her own");
  c.eq(listC.body.limits.armed.used, 0, "isolation: carol's armed count is her own");

  const before = JSON.stringify(rawAll(api, "SELECT * FROM ff_wire WHERE id = ?", idB));
  const versionsBefore = JSON.stringify(rawAll(api, "SELECT * FROM ff_wire_version WHERE wire_id = ?", idB));
  const symbolsBefore = JSON.stringify(rawAll(api, "SELECT * FROM ff_wire_symbol ORDER BY member_id, symbol, wire_id"));
  const probes = [
    ["GET", "/api/ff/wires?id=" + idB, undefined],
    ["PATCH", "/api/ff/wires", { id: idB, status: "retired" }],
    ["PATCH", "/api/ff/wires", { id: idB, status: "paused" }],
    ["PATCH", "/api/ff/wires", { id: idB, status: "armed" }],
    ["PATCH", "/api/ff/wires", { id: idB, title: "Hijacked" }],
    ["PATCH", "/api/ff/wires", { id: idB, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }) }],
    ["GET", "/api/ff/receipts?wire=" + idB, undefined],
    ["GET", "/api/ff/records?wire=" + idB, undefined],
    ["PUT", "/api/ff/note", { wire: idB, body: "alice writes on bob's wire" }],
    ["DELETE", "/api/ff/note?wire=" + idB, undefined],
  ];
  const unknown = await api.call("GET", "/api/ff/wires?id=w-zzzzzzzzzzzzzzzz", { user: alice });
  for (const [method, path, body] of probes) {
    const r = await api.call(method, path, { body, user: alice });
    const label = method + " " + path.split("?")[0] + (body && body.status ? " " + body.status : body && body.title ? " title" : body && body.ast ? " adjust" : "");
    if (method === "DELETE") {
      c.eq([r.status, r.body && r.body.wire], [200, idB], "isolation: " + label + " is a no-op for the owner of nothing");
    } else {
      c.eq([r.status, r.error && r.error.code], [404, "ff_wire_not_found"], "isolation: " + label + " is a 404 and not a 403");
      if (method === "GET" && path.includes("/wires?id=")) c.eq(r.error, unknown.error, "isolation: another member's id is indistinguishable from an unknown id");
    }
  }
  c.eq(JSON.stringify(rawAll(api, "SELECT * FROM ff_wire WHERE id = ?", idB)), before, "isolation: bob's wire row is untouched");
  c.eq(JSON.stringify(rawAll(api, "SELECT * FROM ff_wire_version WHERE wire_id = ?", idB)), versionsBefore, "isolation: bob's version rows are untouched");
  c.eq(JSON.stringify(rawAll(api, "SELECT * FROM ff_wire_symbol ORDER BY member_id, symbol, wire_id")), symbolsBefore, "isolation: the symbol index is untouched");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_note").n, 0, "isolation: no note was written");

  const noteB = await api.call("PUT", "/api/ff/note", { body: { wire: idB, body: SENTINEL }, user: bob });
  c.eq(noteB.status, 200, "isolation: bob writes a note on his wire");
  const noteFromAlice = await api.call("DELETE", "/api/ff/note?wire=" + idB, { user: alice });
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_note WHERE member_id = 'bob.two'").n, 1, "isolation: alice cannot delete bob's note");
  c.ok(noteFromAlice.status === 200 || noteFromAlice.status === 404, "isolation: and gets a plain answer", noteFromAlice.status);

  const symbolA = await api.call("GET", "/api/ff/symbol?t=SYB201", { user: alice });
  c.eq(symbolA.body.panel.armed, 0, "isolation: alice's panel on a name only bob watches counts nothing");
  c.eq(symbolA.body.panel.wires, [], "isolation: and lists no wire");
  const symbolShared = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice });
  c.eq(symbolShared.body.panel.wires.map((w) => w.id), [idA], "isolation: a name both watch shows each member their own wire");
  const symbolBob = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: bob });
  c.eq(symbolBob.body.panel.wires.map((w) => w.id), [idB], "isolation: bob sees his own");

  seedHit(api.world.f, { stream: "bob.two", wire: idB, symbol: "SYB201", key: "bob-hit-1" });
  const bobHit = seedHit(api.world.f, { stream: "bob.two", wire: idB, symbol: "SYA101", key: "bob-hit-2" });
  const aliceHit = seedHit(api.world.f, { stream: "alice.one", wire: idA, symbol: "SYA102", key: "alice-hit-1" });
  const hitsA = await api.call("GET", "/api/ff/hits", { user: alice });
  c.eq(hitsA.body.hits.map((h) => h.id), [aliceHit.hitId], "isolation: alice's inbox holds her hit alone");
  const hitsB = await api.call("GET", "/api/ff/hits", { user: bob });
  c.eq(hitsB.body.hits.length, 2, "isolation: bob's inbox holds his two");
  for (const state of ["unread", "pinned", "archived"]) {
    const r = await api.call("GET", "/api/ff/hits?state=" + state, { user: alice });
    c.ok(!JSON.stringify(r.body).includes(bobHit.hitId), "isolation: the " + state + " list never carries bob's hit");
  }
  const detail = await api.call("GET", "/api/ff/hits?id=" + bobHit.hitId, { user: alice });
  c.eq([detail.status, detail.error && detail.error.code], [404, "ff_hit_not_found"], "isolation: alice opening bob's hit is a 404");
  const mark = await api.call("POST", "/api/ff/hits", { body: { id: bobHit.hitId, mark: "pinned" }, user: alice });
  c.eq([mark.status, mark.error && mark.error.code], [404, "ff_hit_not_found"], "isolation: alice marking bob's hit is a 404");
  const feedback = await api.call("POST", "/api/ff/hits", { body: { id: bobHit.hitId, feedback: "noise" }, user: alice });
  c.eq(feedback.status, 404, "isolation: and so is feedback");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_hit_mark").n, 0, "isolation: no mark row exists");
  const own = await api.call("POST", "/api/ff/hits", { body: { id: aliceHit.hitId, mark: "pinned" }, user: alice });
  c.eq([own.status, own.body.mark], [200, "pinned"], "isolation: alice marks her own hit");
  c.eq(rawAll(api, "SELECT member_id, hit_id, mark FROM ff_hit_mark"), [{ member_id: "alice.one", hit_id: aliceHit.hitId, mark: "pinned" }], "isolation: the mark row is alice's");
  const bobPinned = await api.call("GET", "/api/ff/hits?state=pinned", { user: bob });
  c.eq(bobPinned.body.hits.length, 0, "isolation: alice's mark does not pin anything for bob");

  const healthA = await api.call("GET", "/api/ff/health", { user: alice });
  c.eq(healthA.body.unread.member, 1, "isolation: alice's unread count is her stream alone");
  const healthB = await api.call("GET", "/api/ff/health", { user: bob });
  c.eq(healthB.body.unread.member, 2, "isolation: bob's unread count is his stream alone");
  const readA = await api.call("POST", "/api/ff/read", { body: { all: true }, user: alice });
  c.eq(readA.body.cursors.readSeq, 1, "isolation: alice reads up to her own head");
  const healthB2 = await api.call("GET", "/api/ff/health", { user: bob });
  c.eq(healthB2.body.unread.member, 2, "isolation: and bob's count is unmoved");
  c.eq(rawOne(api, "SELECT read_seq FROM ff_member WHERE member_id = 'bob.two'").read_seq, 0, "isolation: bob's cursor row is unmoved");

  const muteA = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
  c.eq(muteA.body.muted, true, "isolation: alice mutes a name");
  const hitsB2 = await api.call("GET", "/api/ff/hits", { user: bob });
  c.eq(hitsB2.body.hits.length, 2, "isolation: bob still sees the name alice muted");
  const symbolMuted = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: bob });
  c.eq(symbolMuted.body.panel.muted, false, "isolation: bob's panel says it is not muted");

  const surfaces = [
    ["GET", "/api/ff/wires"], ["GET", "/api/ff/wires?status=retired"], ["GET", "/api/ff/house"], ["GET", "/api/ff/hits"], ["GET", "/api/ff/digest"],
    ["GET", "/api/ff/symbol?t=SYA101"], ["GET", "/api/ff/health"], ["GET", "/api/ff/export?from=2026-10-20&to=2026-10-27"],
  ];
  for (const [method, path] of surfaces) {
    const r = await api.call(method, path, { user: alice });
    const text = r.text;
    c.ok(!text.includes(SENTINEL), "isolation: " + path.split("?")[0] + " never carries bob's note");
    c.ok(!text.includes(idB) && !text.includes(bobHit.hitId), "isolation: " + path.split("?")[0] + " never carries bob's ids");
    c.ok(!text.includes("Bob private title"), "isolation: " + path.split("?")[0] + " never carries bob's title");
  }
  const bobDetail = await api.call("GET", "/api/ff/wires?id=" + idB, { user: bob });
  c.eq(bobDetail.body.note.body, SENTINEL, "isolation: bob reads his own note back");
  const exportB = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: bob });
  c.ok(!exportB.text.includes(SENTINEL), "isolation: no export carries a note");
}

export async function storeIsolation(c, build) {
  const api = build();
  const env = api.world.env;
  const store = api.store;
  const mine = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101"] } }) }, user: alice })).body.wire.id;
  const theirs = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }), title: "Bob's" }, user: bob })).body.wire.id;
  const bobHit = seedHit(api.world.f, { stream: "bob.two", wire: theirs, symbol: "SYB201", key: "sb1" });
  await api.call("PUT", "/api/ff/note", { body: { wire: theirs, body: "bob's note" }, user: bob });
  await api.call("POST", "/api/ff/mute", { body: { symbol: "SYB201", mute: true }, user: bob });
  api.world.f.db.prepare("INSERT INTO ff_receipt (wire_id, version, session, status, reason, looks, names_evaluated, names_absent, hits, hits_capped, late, evaluated_at) VALUES (?, 1, ?, 'evaluated', NULL, 1, 1, 0, 0, 0, 0, ?)").run(theirs, PREV_SESSION, NOW - 1000);
  api.world.f.db.prepare("INSERT INTO ff_record (wire_id, version, period, firings, sessions, updated_at) VALUES (?, 1, 'all', 1, 1, ?)").run(theirs, NOW - 1000);
  const compiled = await api.world.core.compile({ body: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }), universe: api.world.universe });
  const snapshot = () => JSON.stringify(["ff_wire", "ff_wire_version", "ff_wire_symbol", "ff_note", "ff_hit_mark", "ff_mute", "ff_house_off", "ff_state"].map((t) => rawAll(api, "SELECT * FROM " + t + " ORDER BY 1, 2, 3")));
  const before = snapshot();
  const row = rawOne(api, "SELECT * FROM ff_wire w JOIN ff_wire_version v ON v.wire_id = w.id AND v.version = w.current_version WHERE w.id = ?", theirs);
  const version = { scope_kind: row.scope_kind, cadence: row.cadence, control: row.control, exp_week: row.exp_week };

  for (const to of ["retired", "paused"]) {
    const r = await store.setStatus(env, "alice.one", { id: theirs, to }, NOW);
    c.eq([r.changed, r.row], [false, null], "store: " + to + " on another member's wire changes nothing");
  }
  const arm = await store.setStatus(env, "alice.one", { id: theirs, to: "armed", from: "armed", expect: 1, version, runId: "none" }, NOW);
  c.eq([arm.changed, arm.row], [false, null], "store: arming another member's wire changes nothing");
  const retitled = await store.retitleWire(env, "alice.one", theirs, "Hijacked");
  c.eq([retitled.changed, retitled.row], [false, null], "store: renaming another member's wire changes nothing");
  const adjusted = await store.adjustWire(env, "alice.one", { id: theirs, expect: 1, title: "Hijacked", version: compiled.version, effectiveSession: PREV_SESSION, drop: ["SYB201"], add: ["SYC301"], clauseChanged: true }, NOW);
  c.eq([adjusted.advanced, adjusted.row], [false, null], "store: adjusting another member's wire advances nothing");
  c.eq(await store.getWire(env, "alice.one", theirs), undefined, "store: reading another member's wire finds nothing");
  c.eq(await store.wireVersion(env, "alice.one", theirs, 1), null, "store: nor its versions");
  c.eq(await store.hitMark(env, "alice.one", bobHit.hitId, { mark: "pinned" }, NOW), undefined, "store: marking another member's hit finds nothing");
  c.eq(await store.hitGet(env, "alice.one", bobHit.hitId), undefined, "store: nor opening it");
  c.eq(await store.noteSet(env, "alice.one", theirs, "mine now", NOW), undefined, "store: writing a note on another member's wire finds nothing");
  c.eq(await store.note(env, "alice.one", theirs), null, "store: and reading a note of theirs finds none");
  c.eq(await store.receipts(env, "alice.one", { wireId: theirs, session: null, limit: 10 }), [], "store: another member's receipts are empty");
  c.eq(await store.records(env, "alice.one", { wireId: theirs, version: 1, week: "none" }), [], "store: and their records");
  const panel = await store.symbolWires(env, "alice.one", "SYB201", { limit: 3 });
  c.eq([panel.wires, panel.lastHit, panel.muted], [[], null, false], "store: the name panel shows none of their wire, hit or mute");
  const exported = await store.exportRead(env, "alice.one", { limit: 100 });
  c.eq([exported.member.length, exported.house.length], [0, 0], "store: an export of hers holds none of their hits");
  const page = await store.hitsPage(env, "alice.one", { state: "all", cursor: { h: 99, m: 99, first: true }, limit: 12, now: NOW });
  c.eq([page.member.length, page.heads.m], [0, 0], "store: her inbox page holds none of their stream and its head is zero");
  const dup = await store.createWire(env, "alice.one", { id: theirs, title: "Mine", version: compiled.version, symbols: ["SYC301"], effectiveSession: PREV_SESSION, runId: "none" }, NOW);
  c.eq([dup.created, dup.row, dup.first], [false, null, null], "store: a create under another member's wire id writes nothing and reveals nothing");
  c.eq(snapshot(), before, "store: not one row of the other member's tables moved");
  c.ok(mine !== theirs, "store: the two wires are distinct");
}

export async function houseSeparation(c, build) {
  const api = build();
  const v = await compiledSeed(api, astOf({ scope: { kind: "universe" } }));
  seedWire(api.world.f, { member: null, id: "h-t01", title: "Earnings run-up", cadence: "nightly", scopeKind: "universe", control: "fact", astJson: v.ast_json, astHash: v.ast_hash, clauseHash: v.clause_hash, sentence: "House sentence", template: "T01" });
  seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: "SYA101", key: "house-hit-1" });
  seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: "SYB201", key: "house-hit-2" });
  const aliceFirst = await api.call("GET", "/api/ff/hits", { user: alice });
  const bobFirst = await api.call("GET", "/api/ff/hits", { user: bob });
  c.eq(aliceFirst.body.hits.length, 2, "house: alice sees the house stream");
  c.eq(bobFirst.body.hits.length, 2, "house: bob sees the house stream");
  const pinned = await api.call("POST", "/api/ff/hits", { body: { id: rawOne(api, "SELECT hit_id FROM ff_hit WHERE dedupe_key = 'house-hit-2'").hit_id, mark: "pinned" }, user: alice });
  c.eq(pinned.body.mark, "pinned", "house: alice pins a house hit");
  const bobSeesPin = await api.call("GET", "/api/ff/hits?state=pinned", { user: bob });
  c.eq(bobSeesPin.body.hits.length, 0, "house: and bob's pinned list stays empty");
  const left = await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: false }, user: alice });
  c.eq(left.status, 200, "house: alice leaves the wire");
  const aliceAfter = await api.call("GET", "/api/ff/hits", { user: alice });
  const bobAfter = await api.call("GET", "/api/ff/hits", { user: bob });
  c.eq(aliceAfter.body.hits.length, 0, "house: alice no longer sees its hits");
  c.eq(bobAfter.body.hits.length, 2, "house: bob still sees them");
  c.eq(rawAll(api, "SELECT member_id, wire_id FROM ff_house_off"), [{ member_id: "alice.one", wire_id: "h-t01" }], "house: one opt-out row, alice's");
  const houseA = await api.call("GET", "/api/ff/house", { user: alice });
  const houseB = await api.call("GET", "/api/ff/house", { user: bob });
  c.eq([houseA.body.wires[0].following, houseB.body.wires[0].following], [false, true], "house: following is per member");
  const noteA = await api.call("PUT", "/api/ff/note", { body: { wire: "h-t01", body: "alice's thought" }, user: alice });
  c.eq(noteA.status, 200, "house: a member can annotate a house wire");
  const houseB2 = await api.call("GET", "/api/ff/wires?id=h-t01", { user: bob });
  const houseBdetail = await api.call("GET", "/api/ff/house?id=h-t01", { user: bob });
  c.ok(!houseB2.text.includes("alice's thought") && !houseBdetail.text.includes("alice's thought"), "house: bob never sees alice's note on it");
  const houseAdetail = await api.call("GET", "/api/ff/house?id=h-t01", { user: alice });
  c.eq(houseAdetail.body.note.body, "alice's thought", "house: alice sees her own");
  await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: false }, user: bob });
  await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: true }, user: alice });
  c.eq(rawAll(api, "SELECT member_id FROM ff_house_off"), [{ member_id: "bob.two" }], "house: alice following again removes her opt-out and not bob's");
  const bobsHits = await api.call("GET", "/api/ff/hits", { user: bob });
  c.eq(bobsHits.body.hits.length, 0, "house: so bob still sees none of it");
  await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: bob });
  await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
  await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: false }, user: alice });
  c.eq(rawAll(api, "SELECT member_id, symbol FROM ff_mute"), [{ member_id: "bob.two", symbol: "SYA101" }], "house: alice unmuting a name leaves bob's mute of it alone");
  await api.call("PUT", "/api/ff/note", { body: { wire: "h-t01", body: "bob's thought" }, user: bob });
  await api.call("DELETE", "/api/ff/note?wire=h-t01", { user: alice });
  c.eq(rawAll(api, "SELECT member_id FROM ff_note WHERE wire_id = 'h-t01'"), [{ member_id: "bob.two" }], "house: alice deleting her note leaves bob's");
  const adjust = await api.call("PATCH", "/api/ff/wires", { body: { id: "h-t01", status: "retired" }, user: alice });
  c.eq([adjust.status, adjust.error && adjust.error.code], [403, "ff_house_readonly"], "house: a member cannot retire a house wire");
  c.eq(rawOne(api, "SELECT status FROM ff_wire WHERE id = 'h-t01'").status, "armed", "house: and it stays armed");
  const wiresList = await api.call("GET", "/api/ff/wires", { user: alice });
  c.eq(wiresList.body.wires.length, 0, "house: house wires are not in the member list");
  const getHouseAsMember = await api.call("GET", "/api/ff/wires?id=h-t01", { user: alice });
  c.eq(getHouseAsMember.error && getHouseAsMember.error.code, "ff_wire_not_found", "house: a house id is not a member wire");
}

export async function memberFromSession(c, build) {
  const api = build();
  const a = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101"] } }) }, user: alice });
  const b = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }), title: "Bob wire" }, user: bob });
  seedHit(api.world.f, { stream: "bob.two", wire: b.body.wire.id, symbol: "SYB201", key: "bob-only" });
  const spoof = [
    "?member=bob.two", "?member_id=bob.two", "?m=bob.two", "?user=bob.two", "?username=bob.two", "?stream=bob.two", "?owner=bob.two", "?as=bob.two", "?member_id=bob.two&member=bob.two",
  ];
  for (const q of spoof) {
    const wires = await api.call("GET", "/api/ff/wires" + q, { user: alice });
    c.eq(wires.body.wires.map((w) => w.id), [a.body.wire.id], "member id: " + q + " does not change the wire list");
    const hits = await api.call("GET", "/api/ff/hits" + q, { user: alice });
    c.eq(hits.body.hits.length, 0, "member id: " + q + " does not change the inbox");
    const health = await api.call("GET", "/api/ff/health" + q, { user: alice });
    c.eq(health.body.unread.member, 0, "member id: " + q + " does not change the unread count");
    const digest = await api.call("GET", "/api/ff/digest" + q, { user: alice });
    c.ok(!digest.text.includes("Bob wire"), "member id: " + q + " does not change the digest");
  }
  for (const [name, value] of [["X-Member", "bob.two"], ["X-Member-Id", "bob.two"], ["X-FF-Member", "bob.two"], ["X-RT-User", "bob.two"], ["X-IEWT-Owner", "bob.two"], ["X-Forwarded-User", "bob.two"]]) {
    const wires = await api.call("GET", "/api/ff/wires", { user: alice, headers: { [name]: value } });
    c.eq(wires.body.wires.map((w) => w.id), [a.body.wire.id], "member id: the " + name + " header does not change the list");
  }
  for (const field of ["member", "member_id", "stream", "user"]) {
    const create = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYC301"] } }), [field]: "bob.two" }, user: alice });
    c.eq([create.status, create.error && create.error.code], [400, "ff_grammar_invalid"], "member id: a " + field + " field in a create body is refused");
    const patch = await api.call("PATCH", "/api/ff/wires", { body: { id: a.body.wire.id, title: "x", [field]: "bob.two" }, user: alice });
    c.eq(patch.status, 400, "member id: a " + field + " field in a patch body is refused");
    const mute = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true, [field]: "bob.two" }, user: alice });
    c.eq(mute.status, 400, "member id: a " + field + " field in a mute body is refused");
    const note = await api.call("PUT", "/api/ff/note", { body: { wire: a.body.wire.id, body: "x", [field]: "bob.two" }, user: alice });
    c.eq(note.status, 400, "member id: a " + field + " field in a note body is refused");
    const hit = await api.call("POST", "/api/ff/hits", { body: { id: "a".repeat(20), mark: "pinned", [field]: "bob.two" }, user: alice });
    c.eq(hit.status, 400, "member id: a " + field + " field in a hit body is refused");
    const read = await api.call("POST", "/api/ff/read", { body: { all: true, [field]: "bob.two" }, user: alice });
    c.eq(read.status, 400, "member id: a " + field + " field in a read body is refused");
  }
  c.eq(rawAll(api, "SELECT member_id FROM ff_wire ORDER BY member_id").map((r) => r.member_id), ["alice.one", "bob.two"], "member id: no wire was filed under anyone but its author");
  const methods = [
    (id) => api.store.member(api.world.env, id, NOW), (id) => api.store.listWires(api.world.env, id, { status: "live", limit: 5 }), (id) => api.store.getWire(api.world.env, id, a.body.wire.id),
    (id) => api.store.hitsPage(api.world.env, id, { state: "all", cursor: { h: 9, m: 9, first: true }, limit: 5, now: NOW }), (id) => api.store.mute(api.world.env, id, "SYA101", true, NOW),
    (id) => api.store.houseSet(api.world.env, id, "h-t01", false, NOW), (id) => api.store.noteSet(api.world.env, id, a.body.wire.id, "x", NOW), (id) => api.store.readCursors(api.world.env, id, { readSeq: 1, houseReadSeq: 1, now: NOW }),
    (id) => api.store.createWire(api.world.env, id, { id: "w-zzzzzzzzzzzzzzzz", title: "t", version: {}, symbols: [], effectiveSession: PREV_SESSION }, NOW),
  ];
  for (const bad of ["house", "HOUSE", "ab", "", null, undefined, "a b", "x".repeat(40), "bob/two", 7]) {
    let refused = 0;
    for (const call of methods) {
      try {
        await call(bad);
      } catch (e) {
        if (e instanceof TypeError && /not a member id/.test(e.message)) refused += 1;
      }
    }
    c.eq(refused, methods.length, "member id: the store refuses " + JSON.stringify(bad) + " in every member method");
  }
  c.eq(rawAll(api, "SELECT count(*) AS n FROM ff_wire WHERE id = 'w-zzzzzzzzzzzzzzzz'")[0].n, 0, "member id: and the refused create wrote nothing");
  for (const name of ["house", "HOUSE", "a", "has space", "bad/slash", "x".repeat(40), ""]) {
    const r = await api.call("GET", "/api/ff/wires", { user: { username: name, exp: NOW + 86400000, epoch: "1" } });
    c.ok(r.status === 403 || r.status === 401, "member id: the session name " + JSON.stringify(name.slice(0, 12)) + " is refused", r.status);
    c.eq(r.trips, 0, "member id: and reads nothing for " + JSON.stringify(name.slice(0, 12)));
  }
}

export async function everyStatementBindsTheMember(c, build) {
  const api = build();
  const v = await compiledSeed(api, astOf({ scope: { kind: "universe" } }));
  seedWire(api.world.f, { member: null, id: "h-t01", title: "Earnings run-up", cadence: "nightly", scopeKind: "universe", control: "fact", astJson: v.ast_json, astHash: v.ast_hash, clauseHash: v.clause_hash, sentence: "House sentence", template: "T01" });
  seedRun(api.world.f, { id: "nightly:" + PREV_SESSION, kind: "nightly", session: PREV_SESSION });
  const from = api.world.f.trips.length;
  const made = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, headers: { "Idempotency-Key": "k-tour" } });
  const id = made.body.wire.id;
  const hit = seedHit(api.world.f, { stream: "alice.one", wire: id, symbol: "SYA101", key: "tour-1" });
  seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: "SYA101", key: "tour-house" });
  const tour = [
    ["GET", "/api/ff/wires"], ["GET", "/api/ff/wires?id=" + id], ["GET", "/api/ff/wires?status=retired"],
    ["PATCH", "/api/ff/wires", { id, title: "Renamed" }], ["PATCH", "/api/ff/wires", { id, version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYB201"] } }) }],
    ["PATCH", "/api/ff/wires", { id, status: "paused" }], ["PATCH", "/api/ff/wires", { id, status: "armed" }], ["PATCH", "/api/ff/wires", { id, status: "retired" }], ["PATCH", "/api/ff/wires", { id, status: "armed" }],
    ["GET", "/api/ff/house"], ["GET", "/api/ff/house?id=h-t01"], ["POST", "/api/ff/house", { id: "h-t01", follow: false }], ["POST", "/api/ff/house", { id: "h-t01", follow: true }],
    ["GET", "/api/ff/hits"], ["GET", "/api/ff/hits?state=unread"], ["GET", "/api/ff/hits?state=pinned"], ["GET", "/api/ff/hits?state=archived"], ["GET", "/api/ff/hits?id=" + hit.hitId],
    ["POST", "/api/ff/hits", { id: hit.hitId, mark: "pinned", feedback: "useful" }], ["POST", "/api/ff/read", { all: true }],
    ["POST", "/api/ff/preview", { ast: astOf() }], ["GET", "/api/ff/receipts?wire=" + id], ["GET", "/api/ff/records?wire=" + id], ["GET", "/api/ff/records?wire=h-t01"],
    ["GET", "/api/ff/symbol?t=SYA101"], ["GET", "/api/ff/digest"], ["GET", "/api/ff/export?from=2026-10-20&to=2026-10-27"], ["GET", "/api/ff/health"],
    ["POST", "/api/ff/mute", { symbol: "SYA101", mute: true }], ["POST", "/api/ff/mute", { symbol: "SYA101", mute: false }],
    ["PUT", "/api/ff/note", { wire: id, body: "hello" }], ["PUT", "/api/ff/note", { wire: "h-t01", body: "hello house" }], ["DELETE", "/api/ff/note?wire=" + id],
  ];
  const seen = new Map();
  for (const [method, path, body] of tour) {
    const t0 = api.world.f.trips.length;
    const r = await api.call(method, path, { body, user: alice });
    c.ok(r.status < 500, "statements: " + method + " " + path.split("?")[0] + " does not fail", r.status + " " + r.text.slice(0, 120));
    for (const s of statementsOf(api.world.f, t0)) {
      if (/^SELECT id, payload, updated_at FROM flows_payload WHERE id IN \(/.test(s.sql)) {
        c.ok(s.args.every((a) => a === "universe" || a === "ff-metrics"), "statements: the payload reads ask for the universe and the metrics only", s.args);
        continue;
      }
      const info = classify(s);
      c.ok(info !== null, "statements: every executed statement is a registered one", s.sql.slice(0, 90));
      if (!info) continue;
      seen.set(info.name, info.scope);
      if (info.scope === "member") c.ok(s.args.includes("alice.one"), "statements: " + info.name + " binds the session member", JSON.stringify(s.args).slice(0, 100));
      if (info.scope === "house" || info.scope === "system") c.ok(!s.args.includes("bob.two"), "statements: " + info.name + " binds nobody else", "");
    }
  }
  c.ok(seen.size >= 30, "statements: the tour reaches at least thirty distinct statements", seen.size);
  c.ok(statementsOf(api.world.f, from).length > 60, "statements: and runs dozens of them");
  const memberNames = [...seen].filter(([, scope]) => scope === "member").map(([name]) => name);
  c.ok(memberNames.length >= 22, "statements: member-scoped statements dominate the tour", memberNames.length);
}

export async function scale(c, build) {
  const api = build();
  const members = Array.from({ length: 12 }, (_, i) => ({ username: "member" + String.fromCharCode(97 + i) + ".x", exp: NOW + 86400000, epoch: "1" }));
  const own = new Map();
  for (const [mi, m] of members.entries()) {
    const ids = [];
    for (let w = 0; w < 6; w++) {
      const id = "w-" + String.fromCharCode(97 + mi) + "scale" + String.fromCharCode(97 + w) + "aaaaaaaaa";
      seedWire(api.world.f, { member: m.username, id, title: m.username + " wire " + w, symbols: [NAMES[w % NAMES.length]], clauseHash: String(mi * 10 + w).padStart(10, "0"), astHash: (String(mi) + String(w)).repeat(32).slice(0, 64) });
      ids.push(id);
      seedHit(api.world.f, { stream: m.username, wire: id, symbol: NAMES[w % NAMES.length], key: "scale-" + mi + "-" + w });
    }
    own.set(m.username, ids);
  }
  for (const m of members) {
    const list = await api.call("GET", "/api/ff/wires", { user: m });
    c.eq(list.body.wires.map((w) => w.id).sort(), [...own.get(m.username)].sort(), "scale: " + m.username + " lists exactly their own six");
    c.eq(list.body.limits.armed.used, 6, "scale: " + m.username + " counts six");
    const hits = await api.call("GET", "/api/ff/hits?limit=30", { user: m });
    c.eq(hits.body.hits.length, 6, "scale: " + m.username + " reads six hits");
    c.ok(hits.body.hits.every((h) => own.get(m.username).includes(h.wire.id)), "scale: " + m.username + " reads only their own wires' hits");
    const foreign = members.find((x) => x.username !== m.username);
    const probe = await api.call("GET", "/api/ff/wires?id=" + own.get(foreign.username)[0], { user: m });
    c.eq(probe.status, 404, "scale: " + m.username + " cannot open " + foreign.username + "'s wire");
    const mutate = await api.call("PATCH", "/api/ff/wires", { body: { id: own.get(foreign.username)[1], status: "retired" }, user: m });
    c.eq(mutate.status, 404, "scale: " + m.username + " cannot retire " + foreign.username + "'s wire");
  }
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_wire WHERE status = 'armed'").n, 72, "scale: all 72 wires are still armed");
  const symbols = rawAll(api, "SELECT member_id, count(*) AS n FROM ff_wire_symbol GROUP BY member_id");
  c.ok(symbols.every((s) => s.n === 6), "scale: every member keeps six index rows");
  const quota = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: members[0] });
  c.eq(quota.body.limits.armed.used, 7, "scale: a seventh wire counts seven for that member alone");
  const other = await api.call("GET", "/api/ff/wires", { user: members[1] });
  c.eq(other.body.limits.armed.used, 6, "scale: and six for the neighbour");
  const all = walkStrings(quota.body).map((x) => x.value).join(" ");
  c.ok(!all.includes("memberb.x"), "scale: the reply names no other member");
}
