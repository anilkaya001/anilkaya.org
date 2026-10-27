import { HOUSE_IDS } from "../../shared/ff-contract.js";
import { astOf, liveAst, hitIdOf, seedWire, seedReceipt, seedRecord, seedRun, NAMES, NOW } from "./ff-b-world.mjs";

export const LOAD = Object.freeze({
  members: 12,
  wiresPerMember: 25,
  symbolsPerWire: 5,
  sessions: ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"],
  houseHitsPerSession: 100,
  memberHitsPerSession: 25,
  mutes: 50,
  marks: 30,
  houseOptOuts: 3,
});

const letters = (i) => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));

export const memberName = (i) => "load" + letters(i) + ".x";

export const loadMember = (i) => ({ username: memberName(i), exp: NOW + 86400000, epoch: "1" });

const dayMs = (day, hh, mm) => Date.parse(day + "T" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":00Z");

export async function loadWorld(api) {
  const f = api.world.f;
  const universe = api.world.universe;
  const house = [];
  for (const id of HOUSE_IDS) {
    const live = id === "h-t03";
    const compiled = await api.world.core.compile({ body: live ? liveAst({ scope: { kind: "universe" } }) : astOf({ scope: { kind: "universe" } }), universe });
    seedWire(f, { member: null, id, title: "House " + id, cadence: live ? "live" : "nightly", scopeKind: "universe", control: "fact", astJson: compiled.version.ast_json, astHash: compiled.version.ast_hash, clauseHash: compiled.version.clause_hash, sentence: "House sentence " + id, template: "T" + id.slice(3, 5), effective: "2026-10-01" });
    house.push(id);
    for (const session of LOAD.sessions) seedReceipt(f, { wire: id, session });
    seedRecord(f, { wire: id, firings: 4, sessions: 60, budget: 1, placebo: 1, placeboN: 200, confirmation: 0.5, confirmN: 4, p50: 90, p95: 300, coverage: 0.9 });
  }
  const wires = new Map();
  const insert = f.db.prepare("INSERT INTO ff_member (member_id, read_seq, house_read_seq, budget_b, created_at) VALUES (?, 0, 0, 2, ?)");
  for (let i = 0; i < LOAD.members; i++) {
    const member = i === 0 ? "alice.one" : memberName(i);
    insert.run(member, NOW - 86400000 * 30);
    const ids = [];
    for (let w = 0; w < LOAD.wiresPerMember; w++) {
      const id = "w-" + letters(i) + "load" + letters(w) + "aaaaaaaa";
      const symbols = Array.from({ length: LOAD.symbolsPerWire }, (_, k) => NAMES[(w + k) % NAMES.length]);
      seedWire(f, { member, id, title: "Wire " + w, symbols: [...new Set(symbols)], clauseHash: String(i * 100 + w).padStart(10, "0"), astHash: (String(i) + String(w) + "ab").repeat(32).slice(0, 64), effective: "2026-10-01" });
      ids.push(id);
      for (const session of LOAD.sessions.slice(-2)) seedReceipt(f, { wire: id, session });
      seedRecord(f, { wire: id, firings: 2, sessions: 25 });
    }
    wires.set(member, ids);
  }
  const hit = f.db.prepare("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES (?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?, 'close', ?, ?, ?, 'e1', ?, 'delivered')");
  const evidence = JSON.stringify({ sentence: "SYA101 net premium crossed above 3.00σ", key: "z 3.42", clauses: [{ m: "flow.net_premium.z20", value: 3.42, x: 3 }] });
  let houseSeq = 0;
  const memberSeq = new Map();
  for (const session of LOAD.sessions) {
    for (let k = 0; k < LOAD.houseHitsPerSession; k++) {
      houseSeq += 1;
      const wire = house[k % house.length];
      const symbol = NAMES[k % NAMES.length];
      const at = dayMs(session, 21, 0) + k * 1000;
      const key = "hh" + session + "-" + k;
      hit.run("house", houseSeq, hitIdOf(wire, key), wire, null, "n:" + symbol, symbol, key, session, at, at - 60000, wire === "h-t03" ? "live" : "nightly", evidence);
    }
    for (let i = 0; i < LOAD.members; i++) {
      const member = i === 0 ? "alice.one" : memberName(i);
      for (let k = 0; k < LOAD.memberHitsPerSession; k++) {
        const seq = (memberSeq.get(member) || 0) + 1;
        memberSeq.set(member, seq);
        const wire = wires.get(member)[k % LOAD.wiresPerMember];
        const symbol = NAMES[k % NAMES.length];
        const at = dayMs(session, 21, 0) + k * 1000 + 500;
        const key = "mh" + session + "-" + k;
        hit.run(member, seq, hitIdOf(wire, key), wire, member, "n:" + symbol, symbol, key, session, at, at - 60000, "nightly", evidence);
      }
    }
  }
  const mute = f.db.prepare("INSERT INTO ff_mute (member_id, symbol, created_at) VALUES ('alice.one', ?, ?)");
  for (let k = 0; k < LOAD.mutes; k++) mute.run("M" + String(k).padStart(4, "0"), NOW);
  const off = f.db.prepare("INSERT INTO ff_house_off (member_id, wire_id, created_at) VALUES ('alice.one', ?, ?)");
  for (let k = 0; k < LOAD.houseOptOuts; k++) off.run(house[k + 4], NOW);
  const marks = f.db.prepare("INSERT INTO ff_hit_mark (member_id, hit_id, mark, feedback, updated_at) VALUES ('alice.one', ?, ?, NULL, ?)");
  for (let k = 0; k < LOAD.marks; k++) marks.run(hitIdOf(wires.get("alice.one")[k % LOAD.wiresPerMember], "mh2026-10-20-" + k), k % 2 ? "pinned" : "dismissed", NOW);
  for (const session of LOAD.sessions) {
    seedRun(f, { id: "nightly:" + session, kind: "nightly", session, finishedAt: dayMs(session, 22, 10) });
  }
  seedRun(f, { id: "live:2026-10-27", kind: "live", session: "2026-10-27", finishedAt: NOW - 60000, startedAt: NOW - 62000 });
  return { wires, house };
}
