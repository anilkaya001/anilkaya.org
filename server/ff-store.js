import { FF_SCHEMA_SQL } from "../shared/ff-schema.js";
import { EVIDENCE_REJECT_KEYS, HOUSE_STREAM, LIMITS, SYMBOL_RE, TEMPLATE_IDS } from "../shared/ff-contract.js";
import { errorText } from "../shared/flows-log.js";

export const PROBE_SQL = "SELECT 1 FROM ff_member LIMIT 0";

export async function bootstrapFf(db) {
  try {
    await db.prepare(PROBE_SQL).all();
    return "present";
  } catch (error) {
    if (!/no such table/i.test(errorText(error))) throw error;
  }
  await db.batch(FF_SCHEMA_SQL.map((statement) => db.prepare(statement)));
  return "created";
}

export const MEMBER_ID_RE = /^[a-z0-9_.-]{3,32}$/;

export const FF_STORE_LIMITS = Object.freeze({
  unboundedArmed: 1000000,
  softWireCap: 1950,
  hitMonotoneDays: 4,
  scanFactor: 4,
  listMax: 100,
  versionsListed: 20,
});

export function assertMember(id) {
  if (typeof id !== "string" || !MEMBER_ID_RE.test(id) || id === HOUSE_STREAM) throw new TypeError("ff-store: not a member id");
  return id;
}

const def = (scope, names, build) => {
  const ref = {};
  names.forEach((n, i) => { ref[n] = "?" + (i + 1); });
  return Object.freeze({ scope, names: Object.freeze([...names]), text: build(ref) });
};

const GUARD_NAMES = Object.freeze([
  "member", "skip", "armedMax", "chkUniverse", "universeMax", "chkLive", "liveMax", "chkBudget", "newMilli", "defaultB", "runId", "softCap",
]);

const aggregateSql = (p) =>
  "SELECT count(*) AS armed, COALESCE(SUM(v.scope_kind = 'universe'), 0) AS universe, COALESCE(SUM(v.cadence = 'live'), 0) AS live, " +
  "CAST(ROUND(COALESCE(SUM(CASE WHEN v.control = 'bh' THEN v.exp_week END), 0) * 1000) AS INTEGER) AS milli " +
  "FROM ff_wire w JOIN ff_wire_version v ON v.wire_id = w.id AND v.version = w.current_version " +
  `WHERE w.member_id = ${p.member} AND w.layer = 'member' AND w.status = 'armed' AND w.id IS NOT ${p.skip}`;

const guardSql = (p) =>
  `EXISTS (SELECT 1 FROM (${aggregateSql(p)}) a WHERE a.armed < ${p.armedMax} AND (${p.chkUniverse} = 0 OR a.universe < ${p.universeMax}) ` +
  `AND (${p.chkLive} = 0 OR a.live < ${p.liveMax}) AND (${p.chkBudget} = 0 OR a.milli + ${p.newMilli} <= ` +
  `COALESCE((SELECT budget_b FROM ff_member WHERE member_id = ${p.member}), ${p.defaultB}) * 1000)) ` +
  `AND COALESCE((SELECT wires_evaluated FROM ff_run WHERE id = ${p.runId}), 0) < ${p.softCap}`;

const WIRE_COLS =
  "w.id, w.layer, w.member_id, w.title, w.status, w.status_at, w.current_version, w.origin, w.created_at, " +
  "v.template, v.cadence, v.scope_kind, v.control, v.exp_week, v.clause_hash, v.ast_json, v.ast_hash, v.sentence, v.registry_version, " +
  "v.effective_session, v.created_at AS version_at";

const WIRE_JOIN = "FROM ff_wire w JOIN ff_wire_version v ON v.wire_id = w.id AND v.version = w.current_version";

const RUN_COLS =
  "id, kind, session, slot, slots, status, attempts, lease_until, started_at, finished_at, error, wires_evaluated, names_evaluated, hits_written, unknown_count, version";

const HIT_COLS =
  "h.hit_id, h.stream, h.seq, h.wire_id, h.wire_version, h.member_id, h.subject, h.symbol, h.sector, h.session, h.session_label, h.fired_at, " +
  "h.data_as_of, h.evaluator, h.state, h.withdrawn_at, h.withdrawn_reason, json_extract(h.evidence_json, '$.sentence') AS sentence, " +
  "json_extract(h.evidence_json, '$.key') AS key_text, w.title, w.layer, k.mark, k.feedback";

const mutedSql = (p) => `(h.symbol IS NULL OR NOT EXISTS (SELECT 1 FROM ff_mute m WHERE m.member_id = ${p.member} AND m.symbol = h.symbol))`;
const optedOutSql = (p) => `NOT EXISTS (SELECT 1 FROM ff_house_off o WHERE o.member_id = ${p.member} AND o.wire_id = h.wire_id)`;

const streamSql = (house, unread) => def("member", ["member", "before", ...(unread ? ["after"] : []), "scan", "limit"], (p) =>
  `SELECT ${HIT_COLS} FROM (SELECT * FROM ff_hit WHERE stream = ${house ? `'${HOUSE_STREAM}'` : p.member} AND seq < ${p.before}${unread ? ` AND seq > ${p.after}` : ""} ORDER BY seq DESC LIMIT ${p.scan}) h ` +
  `JOIN ff_wire w ON w.id = h.wire_id LEFT JOIN ff_hit_mark k ON k.member_id = ${p.member} AND k.hit_id = h.hit_id ` +
  `WHERE h.state = 'delivered' ${house ? `AND ${optedOutSql(p)} ` : ""}AND ${mutedSql(p)} AND (k.mark IS NULL OR k.mark <> 'dismissed') ORDER BY h.seq DESC LIMIT ${p.limit}`);

const floorSql = (house, unread) => def(house ? "house" : "member", [...(house ? [] : ["member"]), "before", ...(unread ? ["after"] : []), "scan"], (p) =>
  `SELECT MIN(seq) AS floor_seq, COUNT(*) AS n FROM (SELECT seq FROM ff_hit WHERE stream = ${house ? `'${HOUSE_STREAM}'` : p.member} AND seq < ${p.before}${unread ? ` AND seq > ${p.after}` : ""} ORDER BY seq DESC LIMIT ${p.scan})`);

const VERSION_COLS = "template, cadence, scope_kind, control, exp_week, clause_hash, ast_json, ast_hash, sentence, registry_version, effective_session, created_at";

export const SQL = Object.freeze({
  memberGet: def("member", ["member"], (p) => `SELECT member_id, read_seq, house_read_seq, budget_b, created_at, seen_at FROM ff_member WHERE member_id = ${p.member}`),
  memberInit: def("member", ["member", "now", "defaultB"], (p) =>
    "INSERT INTO ff_member (member_id, read_seq, house_read_seq, budget_b, created_at, seen_at) " +
    `SELECT ${p.member}, 0, COALESCE((SELECT MAX(seq) FROM ff_hit WHERE stream = '${HOUSE_STREAM}'), 0), ${p.defaultB}, ${p.now}, NULL WHERE true ON CONFLICT(member_id) DO NOTHING`),
  maxSeq: def("member", ["member"], (p) => `SELECT COALESCE(MAX(seq), 0) AS seq FROM ff_hit WHERE stream = ${p.member}`),
  houseMaxSeq: def("house", [], () => `SELECT COALESCE(MAX(seq), 0) AS seq FROM ff_hit WHERE stream = '${HOUSE_STREAM}'`),
  advance: def("member", ["member", "readSeq", "houseReadSeq", "now"], (p) => {
    const own = `MIN(${p.readSeq}, COALESCE((SELECT MAX(seq) FROM ff_hit WHERE stream = ${p.member}), 0))`;
    const shared = `MIN(${p.houseReadSeq}, COALESCE((SELECT MAX(seq) FROM ff_hit WHERE stream = '${HOUSE_STREAM}'), 0))`;
    return `UPDATE ff_member SET read_seq = MAX(read_seq, ${own}), house_read_seq = MAX(house_read_seq, ${shared}), seen_at = ${p.now} ` +
      `WHERE member_id = ${p.member} AND (read_seq < ${own} OR house_read_seq < ${shared})`;
  }),
  nightlyLatest: def("system", [], () => `SELECT ${RUN_COLS} FROM ff_run WHERE id >= 'nightly:' AND id < 'nightly;' ORDER BY id DESC LIMIT 1`),
  nightlyDone: def("system", [], () => `SELECT ${RUN_COLS} FROM ff_run WHERE id >= 'nightly:' AND id < 'nightly;' AND status = 'done' ORDER BY id DESC LIMIT 1`),
  liveLatest: def("system", [], () => `SELECT ${RUN_COLS} FROM ff_run WHERE id >= 'live:' AND id < 'live;' ORDER BY id DESC LIMIT 1`),
  runGet: def("system", ["id"], (p) => `SELECT ${RUN_COLS} FROM ff_run WHERE id = ${p.id}`),
  switches: def("system", [], () => "SELECT scope, target, state, reason FROM ff_switches WHERE scope <> 'member' LIMIT 64"),
  memberSwitch: def("member", ["member"], (p) => `SELECT state, reason FROM ff_switches WHERE scope = 'member' AND target = ${p.member}`),

  wireList: def("member", ["member", "statusA", "statusB", "limit"], (p) =>
    `SELECT ${WIRE_COLS} ${WIRE_JOIN} WHERE w.member_id = ${p.member} AND w.layer = 'member' AND w.status IN (${p.statusA}, ${p.statusB}) ORDER BY w.created_at DESC, w.id LIMIT ${p.limit}`),
  wireGet: def("member", ["member", "id"], (p) => `SELECT ${WIRE_COLS} ${WIRE_JOIN} WHERE w.id = ${p.id} AND w.member_id = ${p.member} AND w.layer = 'member'`),
  wireVersions: def("member", ["member", "id", "limit"], (p) =>
    "SELECT v.version, v.template, v.cadence, v.scope_kind, v.control, v.exp_week, v.clause_hash, v.ast_hash, v.sentence, v.registry_version, v.effective_session, v.created_at " +
    `FROM ff_wire_version v WHERE v.wire_id = ${p.id} AND EXISTS (SELECT 1 FROM ff_wire w WHERE w.id = ${p.id} AND w.member_id = ${p.member}) ORDER BY v.version DESC LIMIT ${p.limit}`),
  wireVersion: def("member", ["member", "id", "version"], (p) =>
    `SELECT version, ${VERSION_COLS} FROM ff_wire_version WHERE wire_id = ${p.id} AND version = ${p.version} AND EXISTS (SELECT 1 FROM ff_wire w WHERE w.id = ${p.id} AND w.member_id = ${p.member})`),
  wireInsert: def("member", [...GUARD_NAMES, "id", "title", "now", "origin"], (p) =>
    "INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, origin, created_at) " +
    `SELECT ${p.id}, 'member', ${p.member}, ${p.title}, 'armed', ${p.now}, 1, ${p.origin}, ${p.now} WHERE ${guardSql(p)} ON CONFLICT(id) DO NOTHING`),
  versionFirst: def("member", ["member", "id", "template", "cadence", "scopeKind", "control", "expWeek", "clauseHash", "astJson", "astHash", "sentence", "registryVersion", "effective", "now"], (p) =>
    `INSERT INTO ff_wire_version (wire_id, version, ${VERSION_COLS}) ` +
    `SELECT ${p.id}, 1, ${p.template}, ${p.cadence}, ${p.scopeKind}, ${p.control}, ${p.expWeek}, ${p.clauseHash}, ${p.astJson}, ${p.astHash}, ${p.sentence}, ${p.registryVersion}, ${p.effective}, ${p.now} ` +
    `WHERE EXISTS (SELECT 1 FROM ff_wire WHERE id = ${p.id} AND member_id = ${p.member} AND layer = 'member') AND NOT EXISTS (SELECT 1 FROM ff_wire_version WHERE wire_id = ${p.id})`),
  symbolsFirst: def("member", ["member", "id", "symbols"], (p) =>
    `INSERT OR IGNORE INTO ff_wire_symbol (member_id, symbol, wire_id) SELECT ${p.member}, j.value, ${p.id} FROM json_each(${p.symbols}) j ` +
    `WHERE EXISTS (SELECT 1 FROM ff_wire w WHERE w.id = ${p.id} AND w.member_id = ${p.member} AND w.status IN ('armed', 'paused'))`),
  versionOne: def("member", ["member", "id"], (p) =>
    `SELECT ast_hash, effective_session FROM ff_wire_version WHERE wire_id = ${p.id} AND version = 1 AND EXISTS (SELECT 1 FROM ff_wire w WHERE w.id = ${p.id} AND w.member_id = ${p.member})`),
  versionNext: def("member", [...GUARD_NAMES, "id", "next", "template", "cadence", "scopeKind", "control", "expWeek", "clauseHash", "astJson", "astHash", "sentence", "registryVersion", "effective", "now", "expect", "verCap", "verFloor"], (p) =>
    `INSERT INTO ff_wire_version (wire_id, version, ${VERSION_COLS}) SELECT ${p.id}, ${p.next}, ${p.template}, ${p.cadence}, ${p.scopeKind}, ${p.control}, ${p.expWeek}, ${p.clauseHash}, ${p.astJson}, ${p.astHash}, ${p.sentence}, ${p.registryVersion}, ${p.effective}, ${p.now} ` +
    `WHERE EXISTS (SELECT 1 FROM ff_wire w WHERE w.id = ${p.id} AND w.member_id = ${p.member} AND w.layer = 'member' AND w.current_version = ${p.expect} AND w.status <> 'retired') ` +
    `AND (SELECT count(*) FROM ff_wire_version WHERE wire_id = ${p.id} AND version > ${p.verFloor} AND effective_session = ${p.effective}) < ${p.verCap} ` +
    `AND ((SELECT status FROM ff_wire WHERE id = ${p.id}) <> 'armed' OR (${guardSql(p)}))`),
  symbolsDrop: def("member", ["member", "id", "names", "expect", "next", "astHash"], (p) =>
    `DELETE FROM ff_wire_symbol WHERE member_id = ${p.member} AND wire_id = ${p.id} AND symbol IN (SELECT value FROM json_each(${p.names})) ` +
    `AND EXISTS (SELECT 1 FROM ff_wire WHERE id = ${p.id} AND member_id = ${p.member} AND current_version = ${p.expect}) ` +
    `AND EXISTS (SELECT 1 FROM ff_wire_version WHERE wire_id = ${p.id} AND version = ${p.next} AND ast_hash = ${p.astHash})`),
  symbolsAdd: def("member", ["member", "id", "names", "expect", "next", "astHash"], (p) =>
    `INSERT OR IGNORE INTO ff_wire_symbol (member_id, symbol, wire_id) SELECT ${p.member}, j.value, ${p.id} FROM json_each(${p.names}) j ` +
    `WHERE EXISTS (SELECT 1 FROM ff_wire WHERE id = ${p.id} AND member_id = ${p.member} AND current_version = ${p.expect} AND status IN ('armed', 'paused')) ` +
    `AND EXISTS (SELECT 1 FROM ff_wire_version WHERE wire_id = ${p.id} AND version = ${p.next} AND ast_hash = ${p.astHash})`),
  stateClear: def("member", ["member", "id", "expect", "next", "astHash", "clear"], (p) =>
    `DELETE FROM ff_state WHERE wire_id = ${p.id} AND ${p.clear} = 1 AND EXISTS (SELECT 1 FROM ff_wire WHERE id = ${p.id} AND member_id = ${p.member} AND current_version = ${p.expect}) ` +
    `AND EXISTS (SELECT 1 FROM ff_wire_version WHERE wire_id = ${p.id} AND version = ${p.next} AND ast_hash = ${p.astHash})`),
  wireAdvance: def("member", ["member", "id", "next", "title", "expect", "astHash"], (p) =>
    `UPDATE ff_wire SET current_version = ${p.next}, title = ${p.title} WHERE id = ${p.id} AND member_id = ${p.member} AND layer = 'member' AND current_version = ${p.expect} ` +
    `AND EXISTS (SELECT 1 FROM ff_wire_version WHERE wire_id = ${p.id} AND version = ${p.next} AND ast_hash = ${p.astHash})`),
  wireTitle: def("member", ["member", "id", "title"], (p) => `UPDATE ff_wire SET title = ${p.title} WHERE id = ${p.id} AND member_id = ${p.member} AND layer = 'member' AND title IS NOT ${p.title}`),
  statusRetire: def("member", ["member", "id", "now"], (p) =>
    `UPDATE ff_wire SET status = 'retired', status_at = ${p.now} WHERE id = ${p.id} AND member_id = ${p.member} AND layer = 'member' AND status IN ('armed', 'paused')`),
  statusPause: def("member", ["member", "id", "now"], (p) =>
    `UPDATE ff_wire SET status = 'paused', status_at = ${p.now} WHERE id = ${p.id} AND member_id = ${p.member} AND layer = 'member' AND status = 'armed'`),
  statusArm: def("member", [...GUARD_NAMES, "id", "now", "from", "expect"], (p) =>
    `UPDATE ff_wire SET status = 'armed', status_at = ${p.now} WHERE id = ${p.id} AND member_id = ${p.member} AND layer = 'member' AND status = ${p.from} AND current_version = ${p.expect} AND ${guardSql(p)}`),
  capacity: def("member", ["member", "skip", "defaultB", "runId"], (p) =>
    "SELECT a.armed, a.universe, a.live, a.milli, " +
    `COALESCE((SELECT budget_b FROM ff_member WHERE member_id = ${p.member}), ${p.defaultB}) AS budget_b, COALESCE((SELECT wires_evaluated FROM ff_run WHERE id = ${p.runId}), 0) AS evaluated ` +
    `FROM (${aggregateSql(p)}) a`),

  houseList: def("house", ["member"], (p) =>
    `SELECT ${WIRE_COLS}, (SELECT 1 FROM ff_house_off o WHERE o.member_id = ${p.member} AND o.wire_id = w.id) AS off ${WIRE_JOIN} WHERE w.member_id IS NULL AND w.layer = 'house' AND w.status <> 'retired' ORDER BY w.id LIMIT 32`),
  houseGet: def("house", ["member", "id"], (p) =>
    `SELECT ${WIRE_COLS}, (SELECT 1 FROM ff_house_off o WHERE o.member_id = ${p.member} AND o.wire_id = w.id) AS off ${WIRE_JOIN} WHERE w.id = ${p.id} AND w.layer = 'house'`),
  houseLeave: def("member", ["member", "id", "now"], (p) =>
    `INSERT OR IGNORE INTO ff_house_off (member_id, wire_id, created_at) SELECT ${p.member}, ${p.id}, ${p.now} WHERE EXISTS (SELECT 1 FROM ff_wire WHERE id = ${p.id} AND layer = 'house')`),
  houseFollow: def("member", ["member", "id"], (p) => `DELETE FROM ff_house_off WHERE member_id = ${p.member} AND wire_id = ${p.id}`),

  hitsMember: streamSql(false, false),
  hitsMemberUnread: streamSql(false, true),
  hitsHouse: streamSql(true, false),
  hitsHouseUnread: streamSql(true, true),
  floorMember: floorSql(false, false),
  floorMemberUnread: floorSql(false, true),
  floorHouse: floorSql(true, false),
  floorHouseUnread: floorSql(true, true),
  hitsMarked: def("member", ["member", "mark", "limit"], (p) =>
    `SELECT ${HIT_COLS} FROM ff_hit_mark k JOIN ff_hit h ON h.hit_id = k.hit_id JOIN ff_wire w ON w.id = h.wire_id ` +
    `WHERE k.member_id = ${p.member} AND k.mark = ${p.mark} AND (h.stream = ${p.member} OR h.stream = '${HOUSE_STREAM}') AND h.state = 'delivered' AND (h.stream = ${p.member} OR ${optedOutSql(p)}) AND ${mutedSql(p)} ORDER BY h.fired_at DESC, h.hit_id LIMIT ${p.limit}`),
  hitGet: def("member", ["member", "hitId"], (p) =>
    `SELECT ${HIT_COLS}, h.evaluator_version, h.evidence_json, v.sentence AS version_sentence, v.template, w.status AS wire_status, w.current_version ` +
    "FROM ff_hit h JOIN ff_wire w ON w.id = h.wire_id LEFT JOIN ff_wire_version v ON v.wire_id = h.wire_id AND v.version = h.wire_version " +
    `LEFT JOIN ff_hit_mark k ON k.member_id = ${p.member} AND k.hit_id = h.hit_id WHERE h.hit_id = ${p.hitId} AND h.state = 'delivered' AND (h.stream = ${p.member} OR h.stream = '${HOUSE_STREAM}')`),
  markSet: def("member", ["member", "hitId", "setMark", "mark", "setFeedback", "feedback", "now"], (p) =>
    "INSERT INTO ff_hit_mark (member_id, hit_id, mark, feedback, updated_at) " +
    `SELECT ${p.member}, h.hit_id, CASE WHEN ${p.setMark} = 1 THEN ${p.mark} END, CASE WHEN ${p.setFeedback} = 1 THEN ${p.feedback} END, ${p.now} FROM ff_hit h ` +
    `WHERE h.hit_id = ${p.hitId} AND h.state = 'delivered' AND (h.stream = ${p.member} OR h.stream = '${HOUSE_STREAM}') ` +
    `ON CONFLICT(member_id, hit_id) DO UPDATE SET mark = CASE WHEN ${p.setMark} = 1 THEN excluded.mark ELSE ff_hit_mark.mark END, ` +
    `feedback = CASE WHEN ${p.setFeedback} = 1 THEN excluded.feedback ELSE ff_hit_mark.feedback END, updated_at = excluded.updated_at ` +
    `WHERE (${p.setMark} = 1 AND ff_hit_mark.mark IS NOT excluded.mark) OR (${p.setFeedback} = 1 AND ff_hit_mark.feedback IS NOT excluded.feedback)`),
  markGet: def("member", ["member", "hitId"], (p) => `SELECT mark, feedback FROM ff_hit_mark WHERE member_id = ${p.member} AND hit_id = ${p.hitId}`),

  muteAdd: def("member", ["member", "symbol", "now", "max"], (p) =>
    `INSERT OR IGNORE INTO ff_mute (member_id, symbol, created_at) SELECT ${p.member}, ${p.symbol}, ${p.now} WHERE (SELECT count(*) FROM ff_mute WHERE member_id = ${p.member}) < ${p.max}`),
  muteDrop: def("member", ["member", "symbol"], (p) => `DELETE FROM ff_mute WHERE member_id = ${p.member} AND symbol = ${p.symbol}`),
  muteGet: def("member", ["member", "symbol"], (p) => `SELECT 1 AS muted FROM ff_mute WHERE member_id = ${p.member} AND symbol = ${p.symbol}`),
  noteGet: def("member", ["member", "id"], (p) => `SELECT body, updated_at FROM ff_note WHERE member_id = ${p.member} AND wire_id = ${p.id}`),
  noteSet: def("member", ["member", "id", "body", "now"], (p) =>
    `INSERT INTO ff_note (member_id, wire_id, body, updated_at) SELECT ${p.member}, ${p.id}, ${p.body}, ${p.now} WHERE EXISTS (SELECT 1 FROM ff_wire WHERE id = ${p.id} AND (member_id = ${p.member} OR layer = 'house')) ` +
    "ON CONFLICT(member_id, wire_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at WHERE ff_note.body IS NOT excluded.body"),
  noteDrop: def("member", ["member", "id"], (p) => `DELETE FROM ff_note WHERE member_id = ${p.member} AND wire_id = ${p.id}`),

  symbolWires: def("member", ["member", "symbol", "subject", "limit"], (p) =>
    "SELECT w.id, w.title, w.status, w.current_version, v.cadence, v.scope_kind, v.sentence, st.phase, st.cool_until, st.last_session " +
    "FROM ff_wire_symbol s JOIN ff_wire w ON w.id = s.wire_id AND w.member_id = s.member_id JOIN ff_wire_version v ON v.wire_id = w.id AND v.version = w.current_version " +
    `LEFT JOIN ff_state st ON st.wire_id = w.id AND st.subject = ${p.subject} WHERE s.member_id = ${p.member} AND s.symbol = ${p.symbol} AND w.member_id = ${p.member} AND w.status IN ('armed', 'paused') ORDER BY w.created_at DESC, w.id LIMIT ${p.limit}`),
  symbolLastHit: def("member", ["member", "symbol"], (p) =>
    `SELECT session, session_label, fired_at FROM ff_hit WHERE stream = ${p.member} AND symbol = ${p.symbol} AND state = 'delivered' ORDER BY seq DESC LIMIT 1`),

  receipts: def("member", ["member", "id", "session", "limit"], (p) =>
    "SELECT r.wire_id, r.version, r.session, r.status, r.reason, r.looks, r.looks_expected, r.names_evaluated, r.names_absent, r.absent_json, r.hits, r.hits_capped, r.late, r.evaluated_at, r.upgraded_at " +
    `FROM ff_receipt r WHERE r.wire_id = ${p.id} AND (${p.session} IS NULL OR r.session = ${p.session}) AND EXISTS (SELECT 1 FROM ff_wire w WHERE w.id = ${p.id} AND (w.member_id = ${p.member} OR w.layer = 'house')) ORDER BY r.version DESC, r.session DESC LIMIT ${p.limit}`),
  records: def("member", ["member", "id", "version", "week"], (p) =>
    "SELECT r.wire_id, r.version, r.period, r.firings, r.sessions, r.budget, r.placebo, r.placebo_n, r.confirmation, r.confirm_n, r.lat_p50_s, r.lat_p95_s, r.coverage, r.null_reasons, r.updated_at " +
    `FROM ff_record r WHERE r.wire_id = ${p.id} AND r.version = ${p.version} AND r.period IN ('all', ${p.week}) AND EXISTS (SELECT 1 FROM ff_wire w WHERE w.id = ${p.id} AND (w.member_id = ${p.member} OR w.layer = 'house'))`),

  digestMemberHits: def("member", ["member", "limit", "scan"], (p) =>
    `SELECT ${HIT_COLS}, vv.cadence AS wire_cadence FROM (SELECT * FROM ff_hit WHERE stream = ${p.member} ORDER BY seq DESC LIMIT ${p.scan}) h JOIN ff_wire w ON w.id = h.wire_id ` +
    `LEFT JOIN ff_wire_version vv ON vv.wire_id = h.wire_id AND vv.version = h.wire_version LEFT JOIN ff_hit_mark k ON k.member_id = ${p.member} AND k.hit_id = h.hit_id ` +
    `WHERE h.state = 'delivered' AND ${mutedSql(p)} ORDER BY h.seq DESC LIMIT ${p.limit}`),
  digestHouseHits: def("member", ["member", "limit", "scan"], (p) =>
    `SELECT ${HIT_COLS}, vv.cadence AS wire_cadence FROM (SELECT * FROM ff_hit WHERE stream = '${HOUSE_STREAM}' ORDER BY seq DESC LIMIT ${p.scan}) h JOIN ff_wire w ON w.id = h.wire_id ` +
    `LEFT JOIN ff_wire_version vv ON vv.wire_id = h.wire_id AND vv.version = h.wire_version LEFT JOIN ff_hit_mark k ON k.member_id = ${p.member} AND k.hit_id = h.hit_id ` +
    `WHERE h.state = 'delivered' AND ${optedOutSql(p)} AND ${mutedSql(p)} ORDER BY h.seq DESC LIMIT ${p.limit}`),
  digestEdgeMember: def("member", ["member", "scan"], (p) =>
    `SELECT session FROM ff_hit WHERE stream = ${p.member} AND seq = (SELECT MAX(seq) FROM ff_hit WHERE stream = ${p.member}) - ${p.scan} + 1`),
  digestEdgeHouse: def("house", ["scan"], (p) =>
    `SELECT session FROM ff_hit WHERE stream = '${HOUSE_STREAM}' AND seq = (SELECT MAX(seq) FROM ff_hit WHERE stream = '${HOUSE_STREAM}') - ${p.scan} + 1`),
  digestMemberReceipts: def("member", ["member", "session"], (p) =>
    "SELECT w.id AS wire_id, w.layer, rv.cadence, r.status, r.reason, r.names_evaluated, r.names_absent, r.hits, r.hits_capped FROM ff_wire w " +
    `JOIN ff_receipt r ON r.wire_id = w.id AND r.session = ${p.session} AND r.version = (SELECT MAX(v.version) FROM ff_wire_version v WHERE v.wire_id = w.id AND v.effective_session <= ${p.session}) ` +
    `JOIN ff_wire_version rv ON rv.wire_id = r.wire_id AND rv.version = r.version ` +
    `WHERE w.member_id = ${p.member} AND w.layer = 'member' AND w.status IN ('armed', 'paused') LIMIT 64`),
  digestHouseReceipts: def("member", ["member", "session"], (p) =>
    "SELECT w.id AS wire_id, w.layer, rv.cadence, r.status, r.reason, r.names_evaluated, r.names_absent, r.hits, r.hits_capped FROM ff_wire w " +
    `JOIN ff_receipt r ON r.wire_id = w.id AND r.session = ${p.session} AND r.version = (SELECT MAX(v.version) FROM ff_wire_version v WHERE v.wire_id = w.id AND v.effective_session <= ${p.session}) ` +
    `JOIN ff_wire_version rv ON rv.wire_id = r.wire_id AND rv.version = r.version ` +
    `WHERE w.member_id IS NULL AND w.layer = 'house' AND w.status IN ('armed', 'paused') AND NOT EXISTS (SELECT 1 FROM ff_house_off o WHERE o.member_id = ${p.member} AND o.wire_id = w.id) LIMIT 32`),
  digestMemberRecords: def("member", ["member"], (p) =>
    "SELECT w.id AS wire_id, w.title, r.firings, r.sessions, (SELECT session FROM ff_hit WHERE wire_id = w.id ORDER BY seq DESC LIMIT 1) AS last_session " +
    "FROM ff_wire w JOIN ff_record r ON r.wire_id = w.id AND r.version = w.current_version AND r.period = 'all' " +
    `WHERE w.member_id = ${p.member} AND w.layer = 'member' AND w.status = 'armed' LIMIT 64`),
  houseRecords: def("house", [], () =>
    "SELECT w.id AS wire_id, r.version, r.period, r.firings, r.sessions, r.budget, r.placebo, r.placebo_n, r.confirmation, r.confirm_n, r.lat_p50_s, r.lat_p95_s, r.coverage, r.null_reasons, r.updated_at " +
    "FROM ff_wire w JOIN ff_record r ON r.wire_id = w.id AND r.version = w.current_version AND r.period = 'all' WHERE w.member_id IS NULL AND w.layer = 'house' LIMIT 32"),
  exportHits: def("member", ["member", "stream", "limit"], (p) =>
    "SELECT h.hit_id, h.wire_id, h.wire_version, h.seq, h.stream, w.layer, v.template, h.symbol, h.session, h.session_label, h.fired_at, h.data_as_of, h.evaluator, v.sentence, h.evidence_json " +
    "FROM ff_hit h JOIN ff_wire w ON w.id = h.wire_id LEFT JOIN ff_wire_version v ON v.wire_id = h.wire_id AND v.version = h.wire_version " +
    `WHERE h.stream = ${p.stream} AND (h.stream = ${p.member} OR h.stream = '${HOUSE_STREAM}') AND h.state = 'delivered' AND h.withdrawn_at IS NULL ` +
    `AND (h.stream = ${p.member} OR ${optedOutSql(p)}) ORDER BY h.seq DESC LIMIT ${p.limit}`),
  runsPrune: def("system", ["before"], (p) => `DELETE FROM ff_run WHERE session < ${p.before}`),

  hitInsert: def("system", [
    "hitId", "wire", "version", "subject", "symbol", "sector", "dedupe", "session", "label", "firedAt", "asOf", "evaluator", "evaluatorVersion", "evidence", "state",
    "wireCap", "memberCap", "monotoneDays", "force", "runId", "token", "runCap",
  ], (p) =>
    "INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) " +
    `SELECT COALESCE(w.member_id, '${HOUSE_STREAM}'), COALESCE((SELECT MAX(seq) FROM ff_hit WHERE stream = COALESCE(w.member_id, '${HOUSE_STREAM}')), 0) + 1, ${p.hitId}, w.id, ${p.version}, w.member_id, ` +
    `${p.subject}, ${p.symbol}, ${p.sector}, ${p.dedupe}, ${p.session}, ${p.label}, ${p.firedAt}, ${p.asOf}, ${p.evaluator}, ${p.evaluatorVersion}, ${p.evidence}, ${p.state} ` +
    `FROM ff_wire w WHERE w.id = ${p.wire} AND w.status = 'armed' AND w.member_id IS NOT '${HOUSE_STREAM}' ` +
    `AND EXISTS (SELECT 1 FROM ff_wire_version v WHERE v.wire_id = w.id AND v.version = ${p.version} AND v.effective_session <= ${p.session}) ` +
    `AND NOT EXISTS (SELECT 1 FROM ff_wire_version v2 WHERE v2.wire_id = w.id AND v2.version > ${p.version} AND v2.effective_session <= ${p.session}) ` +
    `AND NOT EXISTS (SELECT 1 FROM ff_hit WHERE wire_id = w.id AND dedupe_key = ${p.dedupe}) ` +
    `AND (SELECT count(*) FROM (SELECT session FROM ff_hit WHERE wire_id = w.id ORDER BY seq DESC LIMIT ${p.wireCap}) WHERE session = ${p.session}) < ${p.wireCap} ` +
    `AND (w.member_id IS NULL OR (SELECT count(*) FROM (SELECT session FROM ff_hit WHERE stream = w.member_id ORDER BY seq DESC LIMIT ${p.memberCap}) WHERE session = ${p.session}) < ${p.memberCap}) ` +
    `AND (${p.force} = 1 OR COALESCE((SELECT session FROM ff_hit WHERE stream = COALESCE(w.member_id, '${HOUSE_STREAM}') ORDER BY seq DESC LIMIT 1), '0000-00-00') <= date(${p.session}, '+' || ${p.monotoneDays} || ' day')) ` +
    `AND (${p.runId} IS NULL OR (SELECT hits_written FROM ff_run WHERE id = ${p.runId} AND status = 'running' AND attempts = ${p.token}) < ${p.runCap}) ON CONFLICT DO NOTHING`),
  hitCount: def("system", ["runId", "token"], (p) =>
    `UPDATE ff_run SET hits_written = hits_written + 1 WHERE id = ${p.runId} AND status = 'running' AND attempts = ${p.token} AND changes() > 0`),
  hitWithdraw: def("system", ["hitId", "now", "reason"], (p) => `UPDATE ff_hit SET withdrawn_at = ${p.now}, withdrawn_reason = ${p.reason} WHERE hit_id = ${p.hitId} AND withdrawn_at IS NULL`),
  stateUpsert: def("system", ["wire", "subject", "version", "phase", "cnt", "lastSession", "coolUntil", "detector", "fenceId", "fenceToken"], (p) =>
    "INSERT INTO ff_state (wire_id, subject, version, phase, cnt, last_session, cool_until, detector_json) " +
    `SELECT ${p.wire}, ${p.subject}, ${p.version}, ${p.phase}, ${p.cnt}, ${p.lastSession}, ${p.coolUntil}, ${p.detector} WHERE ${fenceSql(p)} ` +
    "ON CONFLICT(wire_id, subject) DO UPDATE SET version = excluded.version, phase = excluded.phase, cnt = excluded.cnt, last_session = excluded.last_session, " +
    "cool_until = excluded.cool_until, detector_json = excluded.detector_json WHERE ff_state.version IS NOT excluded.version OR ff_state.phase IS NOT excluded.phase " +
    "OR ff_state.cnt IS NOT excluded.cnt OR ff_state.cool_until IS NOT excluded.cool_until OR ff_state.detector_json IS NOT excluded.detector_json"),
  stateDrop: def("system", ["wire", "subject", "fenceId", "fenceToken"], (p) => `DELETE FROM ff_state WHERE wire_id = ${p.wire} AND subject = ${p.subject} AND ${fenceSql(p)}`),
  receiptUpsert: def("system", [
    "wire", "version", "session", "status", "reason", "looks", "looksExpected", "namesEvaluated", "namesAbsent", "absent", "hits", "hitsCapped", "late", "evaluatedAt", "runRef", "cutoff", "fenceId", "fenceToken",
  ], (p) =>
    "INSERT INTO ff_receipt (wire_id, version, session, status, reason, looks, looks_expected, names_evaluated, names_absent, absent_json, hits, hits_capped, late, evaluated_at, upgraded_at, run_id) " +
    `SELECT ${p.wire}, ${p.version}, ${p.session}, ${p.status}, ${p.reason}, ${p.looks}, ${p.looksExpected}, ${p.namesEvaluated}, ${p.namesAbsent}, ${p.absent}, ${p.hits}, ${p.hitsCapped}, ${p.late}, ${p.evaluatedAt}, NULL, ${p.runRef} WHERE ${fenceSql(p)} ` +
    "ON CONFLICT(wire_id, version, session) DO UPDATE SET status = excluded.status, reason = excluded.reason, looks = excluded.looks, looks_expected = excluded.looks_expected, " +
    "names_evaluated = excluded.names_evaluated, names_absent = excluded.names_absent, absent_json = excluded.absent_json, hits = excluded.hits, hits_capped = excluded.hits_capped, " +
    `late = 1, evaluated_at = excluded.evaluated_at, upgraded_at = excluded.evaluated_at, run_id = excluded.run_id WHERE ff_receipt.status = 'not_evaluated' AND excluded.status = 'evaluated' AND excluded.evaluated_at < ${p.cutoff}`),
  recordUpsert: def("system", [
    "wire", "version", "period", "firings", "sessions", "budget", "placebo", "placeboN", "confirmation", "confirmN", "p50", "p95", "coverage", "nullReasons", "now", "fenceId", "fenceToken",
  ], (p) =>
    "INSERT INTO ff_record (wire_id, version, period, firings, sessions, budget, placebo, placebo_n, confirmation, confirm_n, lat_p50_s, lat_p95_s, coverage, null_reasons, updated_at) " +
    `SELECT ${p.wire}, ${p.version}, ${p.period}, ${p.firings}, ${p.sessions}, ${p.budget}, ${p.placebo}, ${p.placeboN}, ${p.confirmation}, ${p.confirmN}, ${p.p50}, ${p.p95}, ${p.coverage}, ${p.nullReasons}, ${p.now} WHERE ${fenceSql(p)} ` +
    "ON CONFLICT(wire_id, version, period) DO UPDATE SET firings = excluded.firings, sessions = excluded.sessions, budget = excluded.budget, placebo = excluded.placebo, placebo_n = excluded.placebo_n, " +
    "confirmation = excluded.confirmation, confirm_n = excluded.confirm_n, lat_p50_s = excluded.lat_p50_s, lat_p95_s = excluded.lat_p95_s, coverage = excluded.coverage, null_reasons = excluded.null_reasons, updated_at = excluded.updated_at " +
    "WHERE ff_record.firings IS NOT excluded.firings OR ff_record.sessions IS NOT excluded.sessions OR ff_record.budget IS NOT excluded.budget OR ff_record.placebo IS NOT excluded.placebo " +
    "OR ff_record.placebo_n IS NOT excluded.placebo_n OR ff_record.confirmation IS NOT excluded.confirmation OR ff_record.confirm_n IS NOT excluded.confirm_n OR ff_record.lat_p50_s IS NOT excluded.lat_p50_s " +
    "OR ff_record.lat_p95_s IS NOT excluded.lat_p95_s OR ff_record.coverage IS NOT excluded.coverage OR ff_record.null_reasons IS NOT excluded.null_reasons"),
  runClaim: def("system", ["id", "kind", "session", "slot", "leaseUntil", "now", "version", "attemptsMax"], (p) =>
    "INSERT INTO ff_run (id, kind, session, slot, status, attempts, lease_until, started_at, version) " +
    `VALUES (${p.id}, ${p.kind}, ${p.session}, ${p.slot}, 'running', 1, ${p.leaseUntil}, ${p.now}, ${p.version}) ` +
    "ON CONFLICT(id) DO UPDATE SET status = 'running', attempts = ff_run.attempts + 1, lease_until = excluded.lease_until, started_at = excluded.started_at, error = NULL, version = excluded.version " +
    `WHERE (ff_run.status IN ('pending', 'failed') OR (ff_run.status = 'running' AND ff_run.lease_until < ${p.now})) AND ff_run.attempts < ${p.attemptsMax}`),
  runFinish: def("system", ["id", "token", "now", "wires", "names", "unknown", "rowsRead", "rowsWritten"], (p) =>
    `UPDATE ff_run SET status = 'done', finished_at = ${p.now}, error = NULL, lease_until = NULL, wires_evaluated = ${p.wires}, names_evaluated = ${p.names}, unknown_count = ${p.unknown}, ` +
    `rows_read = ${p.rowsRead}, rows_written = ${p.rowsWritten} WHERE id = ${p.id} AND status = 'running' AND attempts = ${p.token}`),
  runFail: def("system", ["id", "token", "error"], (p) => `UPDATE ff_run SET status = 'failed', error = ${p.error}, lease_until = NULL WHERE id = ${p.id} AND status = 'running' AND attempts = ${p.token}`),
  runTick: def("system", [
    "id", "session", "slot", "slots", "status", "now", "finished", "error", "wires", "names", "hits", "unknown", "rowsRead", "rowsWritten", "version",
  ], (p) =>
    "INSERT INTO ff_run (id, kind, session, slot, slots, status, attempts, started_at, finished_at, error, wires_evaluated, names_evaluated, hits_written, unknown_count, rows_read, rows_written, version) " +
    `VALUES (${p.id}, 'live', ${p.session}, ${p.slot}, ${p.slots}, ${p.status}, 1, ${p.now}, ${p.finished}, ${p.error}, ${p.wires}, ${p.names}, ${p.hits}, ${p.unknown}, ${p.rowsRead}, ${p.rowsWritten}, ${p.version}) ` +
    "ON CONFLICT(id) DO UPDATE SET slot = excluded.slot, slots = excluded.slots, status = excluded.status, attempts = ff_run.attempts + 1, started_at = excluded.started_at, " +
    "finished_at = COALESCE(excluded.finished_at, ff_run.finished_at), error = excluded.error, wires_evaluated = excluded.wires_evaluated, names_evaluated = excluded.names_evaluated, " +
    "hits_written = ff_run.hits_written + excluded.hits_written, unknown_count = excluded.unknown_count, rows_read = ff_run.rows_read + excluded.rows_read, " +
    "rows_written = ff_run.rows_written + excluded.rows_written, version = excluded.version WHERE excluded.started_at >= COALESCE(ff_run.started_at, 0)"),
});

function fenceSql(p) {
  return `(${p.fenceId} IS NULL OR EXISTS (SELECT 1 FROM ff_run WHERE id = ${p.fenceId} AND status = 'running' AND attempts = ${p.fenceToken}))`;
}

const bound = (D1, statement, values) => D1.prepare(statement.text).bind(...statement.names.map((n) => {
  if (!Object.hasOwn(values, n) || values[n] === undefined) throw new TypeError("ff-store: " + n + " is not bound");
  return values[n];
}));

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const changesOf = (result) => (result && result.meta ? Number(result.meta.changes) || 0 : 0);
const rowsOf = (result) => (result && Array.isArray(result.results) ? result.results : []);
const bytesOf = (text) => new TextEncoder().encode(text).length;
const points = (text) => [...text].length;
const milli = (x) => Math.round(x * 1000);

export function namesOf(astJson) {
  const body = parseJson(astJson);
  const scope = body && typeof body === "object" ? body.scope : null;
  return scope && scope.kind === "names" && Array.isArray(scope.symbols) ? scope.symbols.filter((s) => typeof s === "string") : [];
}

export function validateCompiled(rec) {
  const out = [];
  const bad = (code) => out.push(code);
  if (rec === null || typeof rec !== "object") return ["not_object"];
  const v = rec.version;
  if (v === null || typeof v !== "object") return ["no_version"];
  if (!TEMPLATE_IDS.includes(v.template) && v.template !== "custom") bad("template");
  if (v.cadence !== "nightly" && v.cadence !== "live") bad("cadence");
  if (!["names", "sector", "universe"].includes(v.scope_kind)) bad("scope_kind");
  if (v.control !== "fact" && v.control !== "bh") bad("control");
  if (v.control === "bh") {
    if (typeof v.exp_week !== "number" || !Number.isFinite(v.exp_week) || v.exp_week < 0 || Math.abs(v.exp_week * 1000 - milli(v.exp_week)) > 1e-6) bad("exp_week");
  } else if (v.exp_week !== null && v.exp_week !== undefined) bad("exp_week");
  if (typeof v.clause_hash !== "string" || !/^[0-9a-f]{10}$/.test(v.clause_hash)) bad("clause_hash");
  if (typeof v.ast_hash !== "string" || !/^[0-9a-f]{64}$/.test(v.ast_hash)) bad("ast_hash");
  if (typeof v.ast_json !== "string" || bytesOf(v.ast_json) > LIMITS.astBytes) bad("ast_json");
  else {
    const body = parseJson(v.ast_json);
    if (body === null || typeof body !== "object" || Array.isArray(body)) bad("ast_json");
    else {
      if (body.cadence !== v.cadence) bad("ast_cadence");
      if (!body.scope || body.scope.kind !== v.scope_kind) bad("ast_scope");
      if (body.control !== undefined) bad("ast_control");
    }
  }
  if (typeof v.sentence !== "string" || points(v.sentence) < 1 || points(v.sentence) > LIMITS.sentenceChars) bad("sentence");
  if (!Number.isInteger(v.registry_version) || v.registry_version < 1) bad("registry_version");
  const symbols = rec.symbols;
  if (!Array.isArray(symbols) || symbols.length > LIMITS.symbolsMax || new Set(symbols).size !== symbols.length || !symbols.every((s) => typeof s === "string" && new RegExp(SYMBOL_RE).test(s))) bad("symbols");
  else if (v.scope_kind !== "names" ? symbols.length !== 0 : symbols.length < 1) bad("symbols_scope");
  else if (v.scope_kind === "names" && typeof v.ast_json === "string") {
    const names = namesOf(v.ast_json);
    if (JSON.stringify([...symbols].sort()) !== JSON.stringify([...names].sort())) bad("symbols_ast");
  }
  return out;
}

export function evidenceProblems(text) {
  if (typeof text !== "string" || text.length === 0 || bytesOf(text) > LIMITS.evidenceBytes) return "size";
  const value = parseJson(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "shape";
  const banned = new Set(EVIDENCE_REJECT_KEYS);
  const walk = (x) => {
    if (x === null || typeof x !== "object") return false;
    if (Array.isArray(x)) return x.some(walk);
    return Object.keys(x).some((k) => banned.has(k) || /^(ret|pnl)/.test(k) || walk(x[k]));
  };
  return walk(value) ? "price" : null;
}

export function validateHit(h) {
  const out = [];
  if (!/^[a-z2-7]{20}$/.test(String(h.hit_id))) out.push("hit_id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(h.session))) out.push("session");
  if (!["delivered", "held"].includes(h.state)) out.push("state");
  if (!["nightly", "live"].includes(h.evaluator)) out.push("evaluator");
  if (!["member", "house"].includes(h.layer)) out.push("layer");
  if (!["nightly", "live"].includes(h.cadence)) out.push("cadence");
  if (!Number.isInteger(h.wire_version) || h.wire_version < 1) out.push("version");
  const e = evidenceProblems(h.evidence_json);
  if (e) out.push("evidence_" + e);
  return out;
}

export function encodeCursor(c) {
  return btoa(JSON.stringify({ v: 1, h: c.h, m: c.m })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor(text) {
  if (text === null || text === undefined || text === "") return { h: Number.MAX_SAFE_INTEGER, m: Number.MAX_SAFE_INTEGER, first: true };
  if (typeof text !== "string" || text.length > 120 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    const value = JSON.parse(raw);
    if (!value || value.v !== 1 || !Number.isSafeInteger(value.h) || !Number.isSafeInteger(value.m) || value.h < 0 || value.m < 0) return null;
    return { h: value.h, m: value.m, first: false };
  } catch {
    return null;
  }
}

export function mergeStreams(memberRows, houseRows, limit) {
  const out = [];
  let m = 0;
  let h = 0;
  const first = (a, b) => (a.fired_at !== b.fired_at ? a.fired_at > b.fired_at : a.stream !== b.stream ? a.stream > b.stream : a.seq > b.seq);
  while (out.length < limit && (m < memberRows.length || h < houseRows.length)) {
    const a = memberRows[m];
    const b = houseRows[h];
    if (b === undefined || (a !== undefined && first(a, b))) { out.push(a); m += 1; } else { out.push(b); h += 1; }
  }
  return { rows: out, taken: { member: m, house: h } };
}

export const guardBinds = (member, over = {}) => ({
  member,
  skip: over.skip === undefined ? null : over.skip,
  armedMax: over.armedMax === undefined ? LIMITS.armedMemberWires : over.armedMax,
  chkUniverse: over.universe ? 1 : 0,
  universeMax: LIMITS.universeMemberWires,
  chkLive: over.live ? 1 : 0,
  liveMax: LIMITS.liveMemberWires,
  chkBudget: over.anomaly ? 1 : 0,
  newMilli: over.anomaly ? milli(over.exp || 0) : 0,
  defaultB: LIMITS.budgetDefault,
  runId: over.runId === undefined ? "none" : over.runId,
  softCap: over.softCap === undefined ? FF_STORE_LIMITS.softWireCap : over.softCap,
});

const capacityBinds = (member, runId, skip = null) => ({ member, skip, defaultB: LIMITS.budgetDefault, runId: runId || "none" });

export function createFfStore({ ensureFf, statements = SQL }) {
  const S = statements;
  const db = async (env) => {
    if (!env.DB) return null;
    await ensureFf(env);
    return env.DB;
  };

  return Object.freeze({
    async member(env, id, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      let row = await bound(D1, S.memberGet, { member: id }).first();
      if (!row) {
        await bound(D1, S.memberInit, { member: id, now, defaultB: LIMITS.budgetDefault }).run();
        row = await bound(D1, S.memberGet, { member: id }).first();
      }
      return row || null;
    },

    async healthMember(env, id, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const switchRead = bound(D1, S.memberSwitch, { member: id }).first().then(
        (row) => ({ state: row ? row.state : "on", unreadable: false }),
        () => ({ state: "on", unreadable: true }),
      );
      const [results, memberSwitch] = await Promise.all([D1.batch([bound(D1, S.memberGet, { member: id }), bound(D1, S.maxSeq, { member: id })]).catch(() => null), switchRead]);
      if (results === null) return null;
      let member = rowsOf(results[0])[0] || null;
      if (!member) {
        await bound(D1, S.memberInit, { member: id, now, defaultB: LIMITS.budgetDefault }).run();
        member = (await bound(D1, S.memberGet, { member: id }).first()) || null;
      }
      return { member, memberMax: Number((rowsOf(results[1])[0] || {}).seq) || 0, memberSwitch };
    },

    async healthShared(env, { live }) {
      const D1 = await db(env);
      if (!D1) return null;
      const readSwitches = async () => {
        try {
          return { rows: rowsOf(await bound(D1, S.switches, {}).all()), unreadable: false };
        } catch {
          return { rows: [], unreadable: true };
        }
      };
      try {
        const [results, switches] = await Promise.all([
          D1.batch([bound(D1, S.houseMaxSeq, {}), bound(D1, S.nightlyLatest, {}), ...(live ? [bound(D1, S.liveLatest, {})] : [])]),
          readSwitches(),
        ]);
        const nightlyLatest = rowsOf(results[1])[0] || null;
        let nightlyDone = nightlyLatest && nightlyLatest.status === "done" ? nightlyLatest : null;
        if (nightlyLatest && !nightlyDone) nightlyDone = (await bound(D1, S.nightlyDone, {}).first()) || null;
        return { houseMax: Number((rowsOf(results[0])[0] || {}).seq) || 0, nightlyLatest, nightlyDone, live: live ? rowsOf(results[2])[0] || null : null, switches };
      } catch {
        return null;
      }
    },

    async readCursors(env, id, { readSeq, houseReadSeq, now }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        bound(D1, S.memberInit, { member: id, now, defaultB: LIMITS.budgetDefault }),
        bound(D1, S.advance, { member: id, readSeq, houseReadSeq, now }),
        bound(D1, S.memberGet, { member: id }),
        bound(D1, S.maxSeq, { member: id }),
        bound(D1, S.houseMaxSeq, {}),
      ]);
      const member = rowsOf(results[2])[0] || null;
      if (!member) return null;
      return { member, max: { member: Number((rowsOf(results[3])[0] || {}).seq) || 0, house: Number((rowsOf(results[4])[0] || {}).seq) || 0 } };
    },

    async switches(env) {
      const D1 = await db(env);
      if (!D1) return { rows: [], unreadable: true };
      try {
        return { rows: rowsOf(await bound(D1, S.switches, {}).all()), unreadable: false };
      } catch {
        return { rows: [], unreadable: true };
      }
    },

    async memberSwitch(env, id) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return { state: "on", unreadable: true };
      try {
        const row = await bound(D1, S.memberSwitch, { member: id }).first();
        return { state: row ? row.state : "on", unreadable: false };
      } catch {
        return { state: "on", unreadable: true };
      }
    },

    async note(env, id, wireId) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return (await bound(D1, S.noteGet, { member: id, id: wireId }).first()) || null;
    },

    async runRow(env, runId) {
      const D1 = await db(env);
      if (!D1) return null;
      return (await bound(D1, S.runGet, { id: runId }).first()) || null;
    },

    async listWires(env, id, { status, limit }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const pair = status === "retired" ? ["retired", "retired"] : status === "armed" ? ["armed", "armed"] : status === "paused" ? ["paused", "paused"] : ["armed", "paused"];
      const results = await D1.batch([
        bound(D1, S.wireList, { member: id, statusA: pair[0], statusB: pair[1], limit: Math.min(limit || FF_STORE_LIMITS.listMax, FF_STORE_LIMITS.listMax) }),
        bound(D1, S.memberGet, { member: id }),
      ]);
      return { rows: rowsOf(results[0]), member: rowsOf(results[1])[0] || null };
    },

    async getWire(env, id, wireId) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        bound(D1, S.wireGet, { member: id, id: wireId }),
        bound(D1, S.wireVersions, { member: id, id: wireId, limit: FF_STORE_LIMITS.versionsListed }),
        bound(D1, S.noteGet, { member: id, id: wireId }),
      ]);
      const wire = rowsOf(results[0])[0];
      if (!wire) return undefined;
      return { wire, versions: rowsOf(results[1]), note: rowsOf(results[2])[0] || null };
    },

    async wireVersion(env, id, wireId, version) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return (await bound(D1, S.wireVersion, { member: id, id: wireId, version }).first()) || null;
    },

    async capacity(env, id, { runId, skip = null } = {}) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return await bound(D1, S.capacity, capacityBinds(id, runId, skip)).first();
    },

    async createWire(env, id, spec, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const v = spec.version;
      const guard = guardBinds(id, { universe: v.scope_kind === "universe", live: v.cadence === "live", anomaly: v.control === "bh", exp: v.exp_week || 0, runId: spec.runId });
      const results = await D1.batch([
        bound(D1, S.wireInsert, { ...guard, id: spec.id, title: spec.title, now, origin: spec.origin || null }),
        bound(D1, S.versionFirst, {
          member: id, id: spec.id, template: v.template, cadence: v.cadence, scopeKind: v.scope_kind, control: v.control, expWeek: v.exp_week === undefined ? null : v.exp_week,
          clauseHash: v.clause_hash, astJson: v.ast_json, astHash: v.ast_hash, sentence: v.sentence, registryVersion: v.registry_version, effective: spec.effectiveSession, now,
        }),
        bound(D1, S.symbolsFirst, { member: id, id: spec.id, symbols: JSON.stringify(spec.symbols || []) }),
        bound(D1, S.wireGet, { member: id, id: spec.id }),
        bound(D1, S.versionOne, { member: id, id: spec.id }),
        bound(D1, S.capacity, capacityBinds(id, spec.runId)),
      ]);
      return { created: changesOf(results[0]) > 0, row: rowsOf(results[3])[0] || null, first: rowsOf(results[4])[0] || null, cap: rowsOf(results[5])[0] || null };
    },

    async adjustWire(env, id, spec, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const v = spec.version;
      const next = spec.expect + 1;
      const guard = guardBinds(id, {
        skip: spec.id, armedMax: FF_STORE_LIMITS.unboundedArmed, universe: v.scope_kind === "universe", live: v.cadence === "live", anomaly: v.control === "bh", exp: v.exp_week || 0,
        softCap: FF_STORE_LIMITS.unboundedArmed,
      });
      const key = { member: id, id: spec.id, expect: spec.expect, next, astHash: v.ast_hash };
      const results = await D1.batch([
        bound(D1, S.versionNext, {
          ...guard, id: spec.id, next, template: v.template, cadence: v.cadence, scopeKind: v.scope_kind, control: v.control, expWeek: v.exp_week === undefined ? null : v.exp_week,
          clauseHash: v.clause_hash, astJson: v.ast_json, astHash: v.ast_hash, sentence: v.sentence, registryVersion: v.registry_version, effective: spec.effectiveSession, now,
          expect: spec.expect, verCap: LIMITS.versionsPerWirePerSession, verFloor: spec.expect - LIMITS.versionsPerWirePerSession,
        }),
        bound(D1, S.symbolsDrop, { ...key, names: JSON.stringify(spec.drop || []) }),
        bound(D1, S.symbolsAdd, { ...key, names: JSON.stringify(spec.add || []) }),
        bound(D1, S.stateClear, { ...key, clear: spec.clauseChanged ? 1 : 0 }),
        bound(D1, S.wireAdvance, { ...key, title: spec.title }),
        bound(D1, S.wireGet, { member: id, id: spec.id }),
        bound(D1, S.capacity, capacityBinds(id, spec.runId)),
      ]);
      return { advanced: changesOf(results[4]) > 0, versionWritten: changesOf(results[0]) > 0, row: rowsOf(results[5])[0] || null, cap: rowsOf(results[6])[0] || null };
    },

    async retitleWire(env, id, wireId, title) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([bound(D1, S.wireTitle, { member: id, id: wireId, title }), bound(D1, S.wireGet, { member: id, id: wireId })]);
      return { changed: changesOf(results[0]) > 0, row: rowsOf(results[1])[0] || null };
    },

    async setStatus(env, id, spec, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const read = bound(D1, S.wireGet, { member: id, id: spec.id });
      const cap = bound(D1, S.capacity, capacityBinds(id, spec.runId));
      if (spec.to === "retired") {
        const results = await D1.batch([bound(D1, S.statusRetire, { member: id, id: spec.id, now }), read, cap]);
        return { changed: changesOf(results[0]) > 0, row: rowsOf(results[1])[0] || null, cap: rowsOf(results[2])[0] || null };
      }
      if (spec.to === "paused") {
        const results = await D1.batch([bound(D1, S.statusPause, { member: id, id: spec.id, now }), read, cap]);
        return { changed: changesOf(results[0]) > 0, row: rowsOf(results[1])[0] || null, cap: rowsOf(results[2])[0] || null };
      }
      const v = spec.version;
      const guard = guardBinds(id, {
        skip: spec.id, universe: v.scope_kind === "universe", live: v.cadence === "live", anomaly: v.control === "bh", exp: v.exp_week || 0, runId: spec.runId,
      });
      const results = await D1.batch([bound(D1, S.statusArm, { ...guard, id: spec.id, now, from: spec.from, expect: spec.expect }), read, cap]);
      return { changed: changesOf(results[0]) > 0, row: rowsOf(results[1])[0] || null, cap: rowsOf(results[2])[0] || null };
    },

    async houseList(env, id) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return rowsOf(await bound(D1, S.houseList, { member: id }).all());
    },

    async houseRead(env, id) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([bound(D1, S.houseList, { member: id }), bound(D1, S.houseRecords, {})]);
      return { rows: rowsOf(results[0]), records: rowsOf(results[1]) };
    },

    async exportRead(env, id, { limit }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        bound(D1, S.exportHits, { member: id, stream: id, limit }),
        bound(D1, S.exportHits, { member: id, stream: HOUSE_STREAM, limit }),
      ]);
      return { member: rowsOf(results[0]), house: rowsOf(results[1]) };
    },

    async houseGet(env, id, wireId) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return (await bound(D1, S.houseGet, { member: id, id: wireId }).first()) || undefined;
    },

    async houseSet(env, id, wireId, follow, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        follow ? bound(D1, S.houseFollow, { member: id, id: wireId }) : bound(D1, S.houseLeave, { member: id, id: wireId, now }),
        bound(D1, S.houseGet, { member: id, id: wireId }),
      ]);
      return { changed: changesOf(results[0]) > 0, row: rowsOf(results[1])[0] || null };
    },

    async hitsPage(env, id, { state, cursor, limit, now }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const head = await D1.batch([bound(D1, S.memberGet, { member: id }), bound(D1, S.maxSeq, { member: id }), bound(D1, S.houseMaxSeq, {})]);
      let member = rowsOf(head[0])[0] || null;
      if (!member) {
        await bound(D1, S.memberInit, { member: id, now, defaultB: LIMITS.budgetDefault }).run();
        member = (await bound(D1, S.memberGet, { member: id }).first()) || null;
      }
      const heads = { m: Number((rowsOf(head[1])[0] || {}).seq) || 0, h: Number((rowsOf(head[2])[0] || {}).seq) || 0 };
      if (state === "pinned" || state === "archived") {
        const marked = rowsOf(await bound(D1, S.hitsMarked, { member: id, mark: state === "pinned" ? "pinned" : "dismissed", limit }).all());
        return { member: [], house: [], marked, scan: 0, heads, cursors: member };
      }
      const unread = state === "unread";
      const scan = limit * FF_STORE_LIMITS.scanFactor;
      const readSeq = member ? member.read_seq : 0;
      const houseReadSeq = member ? member.house_read_seq : 0;
      const results = await D1.batch([
        bound(D1, unread ? S.hitsMemberUnread : S.hitsMember, { member: id, before: cursor.m, after: readSeq, scan, limit }),
        bound(D1, unread ? S.hitsHouseUnread : S.hitsHouse, { member: id, before: cursor.h, after: houseReadSeq, scan, limit }),
      ]);
      return { member: rowsOf(results[0]), house: rowsOf(results[1]), marked: null, scan, heads, cursors: member };
    },

    async streamFloor(env, id, { house, unread, before, after, scan }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const statement = house ? (unread ? S.floorHouseUnread : S.floorHouse) : (unread ? S.floorMemberUnread : S.floorMember);
      const row = await bound(D1, statement, { member: id, before, after, scan }).first();
      return { floor: row && row.floor_seq !== null ? Number(row.floor_seq) : null, n: row ? Number(row.n) || 0 : 0 };
    },

    async hitGet(env, id, hitId) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return (await bound(D1, S.hitGet, { member: id, hitId }).first()) || undefined;
    },

    async hitMark(env, id, hitId, change, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        bound(D1, S.markSet, {
          member: id, hitId, setMark: change.mark === undefined ? 0 : 1, mark: change.mark === undefined ? null : change.mark,
          setFeedback: change.feedback === undefined ? 0 : 1, feedback: change.feedback === undefined ? null : change.feedback, now,
        }),
        bound(D1, S.markGet, { member: id, hitId }),
      ]);
      const row = rowsOf(results[1])[0];
      return row === undefined ? undefined : { mark: row.mark, feedback: row.feedback };
    },

    async mute(env, id, symbol, on, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        on ? bound(D1, S.muteAdd, { member: id, symbol, now, max: LIMITS.mutesPerMember }) : bound(D1, S.muteDrop, { member: id, symbol }),
        bound(D1, S.muteGet, { member: id, symbol }),
      ]);
      return { muted: rowsOf(results[1]).length > 0, changed: changesOf(results[0]) > 0 };
    },

    async noteSet(env, id, wireId, body, now) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([bound(D1, S.noteSet, { member: id, id: wireId, body, now }), bound(D1, S.noteGet, { member: id, id: wireId })]);
      return rowsOf(results[1])[0] || undefined;
    },

    async noteDrop(env, id, wireId) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return changesOf(await bound(D1, S.noteDrop, { member: id, id: wireId }).run());
    },

    async symbolWires(env, id, symbol, { limit }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        bound(D1, S.symbolWires, { member: id, symbol, subject: "n:" + symbol, limit }),
        bound(D1, S.symbolLastHit, { member: id, symbol }),
        bound(D1, S.muteGet, { member: id, symbol }),
      ]);
      return { wires: rowsOf(results[0]), lastHit: rowsOf(results[1])[0] || null, muted: rowsOf(results[2]).length > 0 };
    },

    async receipts(env, id, { wireId, session, limit }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return rowsOf(await bound(D1, S.receipts, { member: id, id: wireId, session: session || null, limit }).all());
    },

    async records(env, id, { wireId, version, week }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      return rowsOf(await bound(D1, S.records, { member: id, id: wireId, version, week }).all());
    },

    async digestRead(env, id, { session, memberRows, houseRows, memberScan, houseScan }) {
      assertMember(id);
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        bound(D1, S.digestMemberHits, { member: id, limit: memberRows, scan: memberScan }),
        bound(D1, S.digestHouseHits, { member: id, limit: houseRows, scan: houseScan }),
        bound(D1, S.digestMemberReceipts, { member: id, session }),
        bound(D1, S.digestHouseReceipts, { member: id, session }),
        bound(D1, S.digestMemberRecords, { member: id }),
        bound(D1, S.houseRecords, {}),
        bound(D1, S.runGet, { id: "nightly:" + session }),
        bound(D1, S.runGet, { id: "live:" + session }),
        bound(D1, S.digestEdgeMember, { member: id, scan: memberScan }),
        bound(D1, S.digestEdgeHouse, { scan: houseScan }),
      ]);
      const edge = (result) => {
        const row = rowsOf(result)[0];
        return row ? row.session : null;
      };
      return {
        memberHits: rowsOf(results[0]), houseHits: rowsOf(results[1]), memberReceipts: rowsOf(results[2]), houseReceipts: rowsOf(results[3]),
        memberRecords: rowsOf(results[4]), houseRecords: rowsOf(results[5]), nightly: rowsOf(results[6])[0] || null, live: rowsOf(results[7])[0] || null,
        memberEdge: edge(results[8]), houseEdge: edge(results[9]),
      };
    },

    async writeHits(env, hits, { run = null, force = false } = {}) {
      const D1 = await db(env);
      if (!D1) return null;
      const out = [];
      const runCap = LIMITS.hitsGlobalPerSession + LIMITS.hitsPerHouseWirePerSession.nightly * 8 + LIMITS.hitsPerHouseWirePerSession.live;
      for (let i = 0; i < hits.length; i += 40) {
        const group = hits.slice(i, i + 40);
        const statements = [];
        for (const h of group) {
          const problems = validateHit(h);
          if (problems.length) throw new TypeError("ff-store: hit refused: " + problems.join(","));
          const wireCap = h.layer === "house" ? LIMITS.hitsPerHouseWirePerSession[h.cadence] : LIMITS.hitsPerMemberWirePerSession;
          statements.push(bound(D1, S.hitInsert, {
            hitId: h.hit_id, wire: h.wire_id, version: h.wire_version, subject: h.subject, symbol: h.symbol === undefined ? null : h.symbol, sector: h.sector === undefined ? null : h.sector,
            dedupe: h.dedupe_key, session: h.session, label: h.session_label, firedAt: h.fired_at, asOf: h.data_as_of, evaluator: h.evaluator, evaluatorVersion: h.evaluator_version,
            evidence: h.evidence_json, state: h.state, wireCap, memberCap: LIMITS.hitsPerMemberPerSession, monotoneDays: FF_STORE_LIMITS.hitMonotoneDays, force: force ? 1 : 0,
            runId: run ? run.id : null, token: run ? run.token : null, runCap,
          }));
          if (run) statements.push(bound(D1, S.hitCount, { runId: run.id, token: run.token }));
        }
        const results = await D1.batch(statements);
        const step = run ? 2 : 1;
        for (let j = 0; j < group.length; j++) out.push(changesOf(results[j * step]) > 0);
      }
      return out;
    },

    async withdrawHit(env, hitId, reason, now) {
      const D1 = await db(env);
      if (!D1) return null;
      return changesOf(await bound(D1, S.hitWithdraw, { hitId, now, reason }).run());
    },

    async writeStates(env, changes, fence = null) {
      const D1 = await db(env);
      if (!D1) return null;
      const f = { fenceId: fence ? fence.id : null, fenceToken: fence ? fence.token : null };
      for (let i = 0; i < changes.length; i += 40) {
        await D1.batch(changes.slice(i, i + 40).map((c) => (c.drop
          ? bound(D1, S.stateDrop, { wire: c.wire_id, subject: c.subject, ...f })
          : bound(D1, S.stateUpsert, {
            wire: c.wire_id, subject: c.subject, version: c.version, phase: c.phase, cnt: c.cnt, lastSession: c.last_session,
            coolUntil: c.cool_until === undefined ? null : c.cool_until, detector: c.detector_json === undefined ? null : c.detector_json, ...f,
          }))));
      }
      return changes.length;
    },

    async writeReceipts(env, receipts, { cutoff, fence = null }) {
      const D1 = await db(env);
      if (!D1) return null;
      const f = { fenceId: fence ? fence.id : null, fenceToken: fence ? fence.token : null };
      for (let i = 0; i < receipts.length; i += 40) {
        await D1.batch(receipts.slice(i, i + 40).map((r) => bound(D1, S.receiptUpsert, {
          wire: r.wire_id, version: r.version, session: r.session, status: r.status, reason: r.reason === undefined ? null : r.reason, looks: r.looks || 0,
          looksExpected: r.looks_expected === undefined ? null : r.looks_expected, namesEvaluated: r.names_evaluated || 0, namesAbsent: r.names_absent || 0,
          absent: r.absent_json === undefined ? null : r.absent_json, hits: r.hits || 0, hitsCapped: r.hits_capped || 0, late: r.late ? 1 : 0,
          evaluatedAt: r.evaluated_at === undefined ? null : r.evaluated_at, runRef: r.run_id === undefined ? null : r.run_id, cutoff, ...f,
        })));
      }
      return receipts.length;
    },

    async writeRecords(env, records, fence = null) {
      const D1 = await db(env);
      if (!D1) return null;
      const f = { fenceId: fence ? fence.id : null, fenceToken: fence ? fence.token : null };
      for (let i = 0; i < records.length; i += 40) {
        await D1.batch(records.slice(i, i + 40).map((r) => bound(D1, S.recordUpsert, {
          wire: r.wire_id, version: r.version, period: r.period, firings: r.firings, sessions: r.sessions, budget: r.budget === undefined ? null : r.budget,
          placebo: r.placebo === undefined ? null : r.placebo, placeboN: r.placebo_n === undefined ? null : r.placebo_n,
          confirmation: r.confirmation === undefined ? null : r.confirmation, confirmN: r.confirm_n === undefined ? null : r.confirm_n,
          p50: r.lat_p50_s === undefined ? null : r.lat_p50_s, p95: r.lat_p95_s === undefined ? null : r.lat_p95_s, coverage: r.coverage === undefined ? null : r.coverage,
          nullReasons: r.null_reasons === undefined ? null : r.null_reasons, now: r.updated_at, ...f,
        })));
      }
      return records.length;
    },

    async claimRun(env, spec) {
      const D1 = await db(env);
      if (!D1) return null;
      const results = await D1.batch([
        bound(D1, S.runClaim, { id: spec.id, kind: spec.kind, session: spec.session, slot: spec.slot, leaseUntil: spec.leaseUntil, now: spec.now, version: spec.version, attemptsMax: spec.attemptsMax }),
        bound(D1, S.runGet, { id: spec.id }),
      ]);
      const row = rowsOf(results[1])[0] || null;
      return changesOf(results[0]) > 0 && row ? { claimed: true, token: row.attempts, row } : { claimed: false, token: null, row };
    },

    async finishRun(env, runId, spec) {
      const D1 = await db(env);
      if (!D1) return null;
      const result = spec.error
        ? await bound(D1, S.runFail, { id: runId, token: spec.token, error: String(spec.error).slice(0, 240) }).run()
        : await bound(D1, S.runFinish, { id: runId, token: spec.token, now: spec.now, wires: spec.wires, names: spec.names, unknown: spec.unknown, rowsRead: spec.rowsRead, rowsWritten: spec.rowsWritten }).run();
      return changesOf(result) > 0;
    },

    async tickRun(env, spec) {
      const D1 = await db(env);
      if (!D1) return null;
      const failed = Boolean(spec.error);
      const result = await bound(D1, S.runTick, {
        id: spec.id, session: spec.session, slot: spec.slot, slots: spec.slots, status: failed ? "failed" : "done", now: spec.now, finished: failed ? null : spec.now,
        error: failed ? String(spec.error).slice(0, 240) : null, wires: spec.wires, names: spec.names, hits: spec.hits, unknown: spec.unknown,
        rowsRead: spec.rowsRead, rowsWritten: spec.rowsWritten, version: spec.version,
      }).run();
      return changesOf(result) > 0;
    },

    async pruneRuns(env, before) {
      const D1 = await db(env);
      if (!D1) return null;
      return changesOf(await bound(D1, S.runsPrune, { before }).run());
    },
  });
}

