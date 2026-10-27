import { LIMITS, METRICS, PAYLOADS, SWITCHES } from "../shared/ff-contract.js";
import { ENGINE_VERSION, evaluateSafe } from "../shared/ff-engine.js";
import { compileWire } from "../shared/ff-grammar.js";
import { compileHouse, HOUSE_WIRES, houseRows } from "../shared/ff-house.js";
import { unscaled } from "../shared/ff-stats.js";
import { isSession, marketPhase, nightlyDeadline, nightlyFinal, prevSession, sessionOf } from "../shared/ff-session.js";

export const EVAL_VERSION = "ff-eval/1";

export const EVAL_LIMITS = Object.freeze({
  wires: LIMITS.armedMemberWiresGlobal + 64,
  states: 200000,
  hits: 20000,
  firstLooks: 5000,
  leaseMs: 600000,
  attempts: 3,
  liveRows: 180,
  gapWires: LIMITS.armedMemberWiresGlobal + 64,
});

export const EVAL_SQL = Object.freeze({
  armed: "SELECT w.id, w.member_id, w.title, w.current_version AS version, v.template, v.cadence, v.ast_json, v.sentence, v.effective_session " +
    "FROM ff_wire w JOIN ff_wire_version v ON v.wire_id = w.id AND v.version = w.current_version " +
    `WHERE w.layer = 'member' AND w.status = 'armed' AND v.cadence = ? ORDER BY w.id LIMIT ${EVAL_LIMITS.wires}`,
  states: "SELECT wire_id, subject, version, phase, cnt, last_session, cool_until, detector_json FROM ff_state " +
    `ORDER BY wire_id, subject LIMIT ${EVAL_LIMITS.states}`,
  hits: `SELECT wire_id, member_id, dedupe_key FROM ff_hit WHERE session = ? LIMIT ${EVAL_LIMITS.hits}`,
  firstLooks: `SELECT wire_id, version, MIN(session) AS session FROM ff_receipt WHERE status = 'evaluated' GROUP BY wire_id, version LIMIT ${EVAL_LIMITS.firstLooks}`,
  memberSwitches: "SELECT scope, target, state, reason FROM ff_switches WHERE scope = 'member' AND state <> 'on' LIMIT 500",
  houseWire: "INSERT OR IGNORE INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, origin, created_at) VALUES (?, 'house', NULL, ?, 'armed', ?, ?, NULL, ?)",
  houseVersion: "INSERT OR IGNORE INTO ff_wire_version (wire_id, version, template, cadence, scope_kind, control, exp_week, clause_hash, ast_json, ast_hash, sentence, registry_version, effective_session, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
  armedIds: `SELECT w.id, v.version FROM ff_wire w JOIN ff_wire_version v ON v.wire_id = w.id AND v.version = w.current_version WHERE w.status = 'armed' AND v.cadence = 'nightly' ORDER BY w.id LIMIT ${EVAL_LIMITS.gapWires}`,
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const isDay = (d) => typeof d === "string" && DAY_RE.test(d);
const DAY_MS = 86400000;
const daysBetween = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS);
const rowsOf = (result) => (result && Array.isArray(result.results) ? result.results : []);
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function expandRuns(list, length) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (Number.isInteger(item)) {
      if (item >= 0 && item < length) out.push(item);
    } else if (Array.isArray(item) && item.length === 2 && Number.isInteger(item[0]) && Number.isInteger(item[1]) && item[0] <= item[1]) {
      for (let i = Math.max(0, item[0]); i <= Math.min(length - 1, item[1]); i++) out.push(i);
    }
  }
  return out;
}

const descale = (list, unit, length) => {
  const out = new Array(length).fill(null);
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < Math.min(length, list.length); i++) out[i] = Number.isInteger(list[i]) ? unscaled(list[i], unit) : null;
  return out;
};

function decodeMetrics(m) {
  const length = Array.isArray(m.t) ? m.t.length : 0;
  const cols = {};
  const n = {};
  const floored = {};
  const why = {};
  for (const id of Object.keys(m.cols || {})) {
    const metric = METRICS.find((x) => x.id === id);
    if (!metric || metric.subject !== "ticker") continue;
    cols[id] = descale(m.cols[id], metric.unit, length);
    if (metric.kind === "anomaly") {
      n[id] = new Array(length).fill(null);
      const src = (m.n || {})[id];
      if (Array.isArray(src)) for (let i = 0; i < Math.min(length, src.length); i++) n[id][i] = Number.isInteger(src[i]) ? src[i] : null;
      floored[id] = new Array(length).fill(0);
      for (const i of expandRuns((m.f || {})[id], length)) floored[id][i] = 1;
    }
    const w = (m.why || {})[id];
    if (w && typeof w === "object") {
      why[id] = {};
      for (const reason of Object.keys(w)) why[id][reason] = expandRuns(w[reason], length);
    }
  }
  return { length, cols, n, floored, why };
}

function decodeSectors(m) {
  const s = m.sectors;
  if (!s || !Array.isArray(s.names) || !s.names.length) return null;
  const length = s.names.length;
  const out = { names: s.names, cols: {}, n: {}, floored: {}, why: {} };
  for (const id of Object.keys(s.cols || {})) {
    const metric = METRICS.find((x) => x.id === id);
    if (!metric || metric.subject !== "sector") continue;
    out.cols[id] = descale(s.cols[id], metric.unit, length);
    if (metric.kind === "anomaly") {
      out.n[id] = new Array(length).fill(null);
      const src = (s.n || {})[id];
      if (Array.isArray(src)) for (let i = 0; i < Math.min(length, src.length); i++) out.n[id][i] = Number.isInteger(src[i]) ? src[i] : null;
      out.floored[id] = new Array(length).fill(0);
      for (const i of expandRuns((s.f || {})[id], length)) out.floored[id][i] = 1;
    }
    const w = (s.why || {})[id];
    if (w && typeof w === "object") {
      out.why[id] = {};
      for (const reason of Object.keys(w)) out.why[id][reason] = expandRuns(w[reason], length);
    }
  }
  return out;
}

export function stampOf(v) {
  if (finite(v) && v > 0) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function otmPct(cp, k, px) {
  if (!finite(k) || !finite(px) || !(px > 0) || !(k > 0)) return null;
  if (cp === "C") return ((k - px) / px) * 100;
  if (cp === "P") return ((px - k) / px) * 100;
  return null;
}

export function windowOf(row, day) {
  if (!row || typeof row.t !== "string" || typeof row.oc !== "string") return null;
  const cols = {};
  if (finite(row.prem)) cols["contract.premium"] = row.prem;
  if (isDay(row.exp) && isDay(day)) {
    const d = daysBetween(day, row.exp);
    if (d >= 0) cols["contract.dte"] = d;
  }
  const otm = otmPct(row.cp, row.k, row.px);
  if (otm !== null) cols["contract.otm_pct"] = otm;
  if (finite(row.voi)) cols["contract.vol_oi"] = row.voi;
  return { symbol: row.t, occ: row.oc, spanStart: stampOf(row.spanStart), cols };
}

export function nightlyWindows(flowalerts, carry, session) {
  const out = [];
  const rows = flowalerts && Array.isArray(flowalerts.rows) ? flowalerts.rows : [];
  const day = isDay(flowalerts && flowalerts.day) ? flowalerts.day : isDay(flowalerts && flowalerts.sessionDate) ? flowalerts.sessionDate : session;
  for (const row of rows) {
    const w = windowOf(row, day);
    if (w) out.push(w);
  }
  const n = carry && Number.isInteger(carry.n) ? carry.n : 0;
  const from = carry && isDay(carry.from) ? carry.from : null;
  for (let i = 0; i < n && from; i++) {
    const at = (f) => (Array.isArray(carry[f]) ? carry[f][i] : undefined);
    const t = at("t");
    const oc = at("oc");
    const oic = Array.isArray(carry.oic) ? carry.oic[i] : null;
    if (typeof t !== "string" || typeof oc !== "string") continue;
    const cols = {};
    if (finite(at("prem"))) cols["contract.premium"] = at("prem");
    if (finite(at("voi"))) cols["contract.vol_oi"] = at("voi");
    const w = { symbol: t, occ: oc, spanStart: stampOf(at("spanStart")), cols, why: {} };
    if (Number.isInteger(oic)) cols["contract.oi_confirm"] = unscaled(oic, "ratio");
    else w.why["contract.oi_confirm"] = "unobservable";
    out.push(w);
  }
  return out;
}

export function nightlySnapshot({ session, now, metrics, flowalerts }) {
  const fresh = metrics && Array.isArray(metrics.t) && isDay(metrics.sessionDate);
  const m = fresh ? decodeMetrics(metrics) : { length: 0, cols: {}, n: {}, floored: {}, why: {} };
  const sources = {};
  if (fresh) {
    const at = { session: metrics.sessionDate, asOf: Date.parse(metrics.generatedAt) || now };
    for (const key of ["hist", "universe", "card-x", "card", "ff-carry"]) sources[key] = at;
  }
  const alertsDay = flowalerts && (isDay(flowalerts.day) ? flowalerts.day : isDay(flowalerts.sessionDate) ? flowalerts.sessionDate : null);
  if (alertsDay) sources.flowalerts = { session: alertsDay, asOf: Date.parse(flowalerts.readAt || flowalerts.generatedAt) || now };
  const carry = fresh && metrics.windows && metrics.windows.carry ? metrics.windows.carry : null;
  const sectorIndex = fresh && Array.isArray(metrics.sectors && metrics.sectors.names) ? metrics.sectors : null;
  const sector = fresh
    ? metrics.t.map((_, i) => {
      const k = sectorIndex && Array.isArray(sectorIndex.of) ? sectorIndex.of[i] : null;
      return Number.isInteger(k) ? sectorIndex.names[k] : null;
    })
    : [];
  return {
    v: 1, kind: "nightly", session, asOf: undefined, now, look: 0, evaluator: "nightly", evaluatorVersion: ENGINE_VERSION,
    sources, symbols: fresh ? metrics.t : [], sector, cols: m.cols, n: m.n, floored: m.floored, why: m.why,
    windows: nightlyWindows(flowalerts, carry, session), sectors: fresh ? decodeSectors(metrics) : null, truncated: {},
  };
}

export function liveSnapshot({ session, now, alerts, look = 0 }) {
  const rows = alerts && Array.isArray(alerts.rows) ? alerts.rows : [];
  const day = alerts && isDay(alerts.day) ? alerts.day : null;
  const readAt = alerts ? Date.parse(alerts.readAt || alerts.generatedAt) : NaN;
  const windows = [];
  for (const row of rows) {
    const w = windowOf(row, day || session);
    if (w) windows.push(w);
  }
  const sources = {};
  if (day && Number.isFinite(readAt)) sources["live:alerts"] = { session: day, asOf: readAt, tier: alerts.tier === 1 ? 1 : 2 };
  return {
    v: 1, kind: "live", session, asOf: Number.isFinite(readAt) ? readAt : now, now, look, evaluator: "live", evaluatorVersion: ENGINE_VERSION,
    sources, symbols: [], sector: [], cols: {}, n: {}, floored: {}, why: {}, windows, sectors: null,
    truncated: rows.length >= EVAL_LIMITS.liveRows ? { "live:alerts": true } : {},
  };
}

export function resolveSwitch(wire, rows) {
  const rank = { on: 0, hold: 1, off: 2 };
  let state = "on";
  for (const r of rows || []) {
    const hit = r.scope === "evaluator" || (r.scope === "template" && r.target === wire.template) || (r.scope === "wire" && r.target === wire.id)
      || (r.scope === "member" && wire.memberId && r.target === wire.memberId) || (r.scope === "house" && wire.layer === "house" && (r.target === wire.id || r.target === "*"));
    if (hit && rank[r.state] > rank[state]) state = r.state;
  }
  return state;
}

export function compileRows(rows, switchRows) {
  const out = [];
  for (const r of rows) {
    const body = parseJson(r.ast_json);
    if (!body) continue;
    const spec = {
      id: r.id, layer: "member", memberId: r.member_id, version: r.version, body, title: r.title, sentence: r.sentence, effectiveSession: r.effective_session, status: "armed",
    };
    try {
      const wire = compileWire({ ...spec, switch: resolveSwitch({ id: r.id, memberId: r.member_id, layer: "member", template: r.template }, switchRows) });
      out.push(wire);
    } catch {
      out.push(null);
    }
  }
  return out.filter(Boolean);
}

export function compileHouseSet(switchRows) {
  return HOUSE_WIRES.map((entry) => compileHouse(entry, { switch: resolveSwitch({ id: entry.id, layer: "house", template: entry.template }, switchRows) }));
}

export function capUsedOf(rows) {
  const wire = new Map();
  const member = new Map();
  for (const r of rows) {
    wire.set(r.wire_id, (wire.get(r.wire_id) || 0) + 1);
    if (r.member_id) member.set(r.member_id, (member.get(r.member_id) || 0) + 1);
  }
  return { wire, member, global: rows.length };
}

export function firstLooksOf(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.wire_id + "@" + r.version, r.session);
  return m;
}

export function settleHits(result, written, wires) {
  const layer = new Map(wires.map((w) => [w.id, w]));
  const wrote = new Map();
  const kept = new Map();
  result.hits.forEach((h, i) => {
    kept.set(h.wire_id, (kept.get(h.wire_id) || 0) + 1);
    if (written[i]) wrote.set(h.wire_id, (wrote.get(h.wire_id) || 0) + 1);
  });
  return result.receipts.map((r) => {
    const k = kept.get(r.wire_id) || 0;
    if (!k || r.version !== (layer.get(r.wire_id) || {}).version) return r;
    const w = wrote.get(r.wire_id) || 0;
    return { ...r, hits: w, hits_capped: r.hits_capped + (k - w) };
  });
}

export function hitRows(result, wires) {
  const by = new Map(wires.map((w) => [w.id, w]));
  return result.hits.map((h) => {
    const wire = by.get(h.wire_id);
    return { ...h, layer: wire.layer, cadence: wire.cadence };
  });
}

export function createEvaluator({ store, flowsStore, now = Date.now, mode = (env) => env.FF_MODE, keys = {} }) {
  const modeOf = (env) => {
    const m = mode(env);
    return m === SWITCHES.master.on ? "on" : m === SWITCHES.master.shadow ? "shadow" : "off";
  };

  async function ensureHouse(env, at) {
    const D1 = env.DB;
    const statements = [];
    for (const entry of HOUSE_WIRES) {
      const { wire, version } = houseRows(entry, at);
      statements.push(D1.prepare(EVAL_SQL.houseWire).bind(wire.id, wire.title, wire.status_at, wire.current_version, wire.created_at));
      statements.push(D1.prepare(EVAL_SQL.houseVersion).bind(
        version.wire_id, version.version, version.template, version.cadence, version.scope_kind, version.control, version.clause_hash, version.ast_json, version.ast_hash,
        version.sentence, version.registry_version, version.effective_session, version.created_at,
      ));
    }
    if (statements.length) await D1.batch(statements);
  }

  async function context(env, cadence, session) {
    const D1 = env.DB;
    const [armed, states, hits, looks, members] = await D1.batch([
      D1.prepare(EVAL_SQL.armed).bind(cadence),
      D1.prepare(EVAL_SQL.states),
      D1.prepare(EVAL_SQL.hits).bind(session),
      D1.prepare(EVAL_SQL.firstLooks),
      D1.prepare(EVAL_SQL.memberSwitches),
    ]);
    const sw = await store.switches(env);
    return { armed: rowsOf(armed), states: rowsOf(states), hits: rowsOf(hits), looks: rowsOf(looks), switches: { ...sw, rows: [...sw.rows, ...rowsOf(members)] } };
  }

  async function runWith(env, { cadence, session, snapshot, at, run }) {
    const ctx = await context(env, cadence, session);
    if (ctx.switches.unreadable) return { status: "off", reason: "switches_unreadable" };
    const evalSwitch = resolveSwitch({ id: "-", layer: "house", template: "-" }, ctx.switches.rows.filter((r) => r.scope === "evaluator"));
    if (evalSwitch === "off") return { status: "off", reason: "switch_off" };
    const wires = [...compileRows(ctx.armed, ctx.switches.rows), ...compileHouseSet(ctx.switches.rows)];
    const wireIds = new Set(wires.map((w) => w.id));
    const state = ctx.states.filter((s) => wireIds.has(s.wire_id));
    const existingKeys = new Set(ctx.hits.map((h) => h.wire_id + "|" + h.dedupe_key));
    const out = evaluateSafe(snapshot, wires, {
      state, existingKeys, firstLook: firstLooksOf(ctx.looks), capUsed: capUsedOf(ctx.hits), mode: modeOf(env) === "shadow" || evalSwitch === "hold" ? "shadow" : "on",
    });
    if (!out.ok) return { status: "failed", error: out.error };
    const result = out.result;
    const fence = run ? { id: run.id, token: run.token } : null;
    const rows = hitRows(result, wires);
    const written = rows.length ? await store.writeHits(env, rows, { run: fence }) : [];
    const changes = [...result.state.upserts, ...result.state.deletes.map((d) => ({ ...d, drop: true }))];
    if (changes.length) await store.writeStates(env, changes, fence);
    const receipts = settleHits(result, written, wires).map((r) => ({ ...r, run_id: run ? run.id : null, evaluated_at: r.status === "evaluated" ? at : null, looks_expected: cadence === "nightly" ? 1 : r.looks_expected }));
    const cutoff = cadence === "nightly" ? nightlyFinal(session) : at + DAY_MS;
    if (receipts.length) await store.writeReceipts(env, receipts, { cutoff, fence });
    return {
      status: "done", result, wires: wires.length, hitsWritten: written.filter(Boolean).length, receipts: receipts.length, errors: result.errors, unknown: result.stats.unknown,
      names: snapshot.symbols.length,
    };
  }

  return Object.freeze({
    modeOf,

    async nightly(env, { session, at = now() } = {}) {
      if (modeOf(env) === "off") return { status: "off", reason: "mode_off" };
      if (!isSession(session)) return { status: "refused", reason: "session" };
      if (!env.DB) return { status: "off", reason: "no_store" };
      const id = "nightly:" + session;
      const claim = await store.claimRun(env, { id, kind: "nightly", session, slot: "n", leaseUntil: at + EVAL_LIMITS.leaseMs, now: at, version: EVAL_VERSION, attemptsMax: EVAL_LIMITS.attempts });
      if (!claim || !claim.claimed) return { status: "not_claimed", run: claim ? claim.row : null };
      const run = { id, token: claim.token };
      try {
        await ensureHouse(env, at);
        const stored = await flowsStore.readMany(env, [PAYLOADS.metrics.key, keys.flowalerts || "flowalerts"]);
        const pick = (k) => {
          const e = stored.get(k);
          return e && e.payload ? (typeof e.payload === "string" ? parseJson(e.payload) : e.payload) : null;
        };
        const snapshot = nightlySnapshot({ session, now: at, metrics: pick(PAYLOADS.metrics.key), flowalerts: pick(keys.flowalerts || "flowalerts") });
        const out = await runWith(env, { cadence: "nightly", session, snapshot, at, run });
        if (out.status !== "done") {
          await store.finishRun(env, id, { token: run.token, error: out.error || out.reason || out.status });
          return out;
        }
        await store.finishRun(env, id, { token: run.token, now: at, wires: out.wires, names: out.names, unknown: out.unknown, rowsRead: 0, rowsWritten: 0 });
        return out;
      } catch (error) {
        const text = error && error.message ? String(error.message) : String(error);
        await store.finishRun(env, id, { token: run.token, error: text }).catch(() => null);
        return { status: "failed", error: text.slice(0, 240) };
      }
    },

    async live(env, { at = now(), alerts = null, look = 0, slot = "t0" } = {}) {
      if (modeOf(env) === "off") return { status: "off", reason: "mode_off" };
      if (!env.DB) return { status: "off", reason: "no_store" };
      const session = sessionOf(at);
      if (!session || marketPhase(at) !== "open") return { status: "closed", reason: "market_closed" };
      const source = alerts || (await (async () => {
        const stored = await flowsStore.readMany(env, ["live:alerts"]);
        const e = stored.get("live:alerts");
        return e && e.payload ? (typeof e.payload === "string" ? parseJson(e.payload) : e.payload) : null;
      })());
      const snapshot = liveSnapshot({ session, now: at, alerts: source, look });
      try {
        const out = await runWith(env, { cadence: "live", session, snapshot, at, run: null });
        if (out.status === "done") {
          await store.tickRun(env, {
            id: "live:" + session, session, slot, slots: null, now: at, wires: out.wires, names: out.names, hits: out.hitsWritten, unknown: out.unknown, rowsRead: 0, rowsWritten: 0, version: EVAL_VERSION,
          });
        }
        return out;
      } catch (error) {
        const text = error && error.message ? String(error.message) : String(error);
        await store.tickRun(env, { id: "live:" + session, session, slot, slots: null, now: at, error: text, wires: 0, names: 0, hits: 0, unknown: 0, rowsRead: 0, rowsWritten: 0, version: EVAL_VERSION }).catch(() => null);
        return { status: "failed", error: text.slice(0, 240) };
      }
    },

    async gap(env, { at = now() } = {}) {
      if (modeOf(env) === "off") return { status: "off", reason: "mode_off" };
      if (!env.DB) return { status: "off", reason: "no_store" };
      const today = sessionOf(at);
      let expected = today && at >= nightlyDeadline(today) ? today : null;
      if (!expected) {
        const anchor = today ? prevSession(today) : (() => {
          const d = new Date(at).toISOString().slice(0, 10);
          return isSession(d) ? d : prevSession(d);
        })();
        expected = anchor && at >= nightlyDeadline(anchor) ? anchor : null;
      }
      if (!expected) return { status: "none", reason: "before_deadline" };
      const run = await store.runRow(env, "nightly:" + expected);
      if (run && run.status === "done") return { status: "none", session: expected, reason: "ran" };
      if (run && run.status === "running" && run.lease_until && run.lease_until > at) return { status: "none", session: expected, reason: "running" };
      const reason = run && run.status === "failed" ? "run_failed" : "run_late";
      const ids = rowsOf(await env.DB.prepare(EVAL_SQL.armedIds).all());
      const house = HOUSE_WIRES.filter((e) => e.effectiveSession <= expected).map((e) => ({ wire_id: e.id, version: e.version }));
      const receipts = [...ids.map((r) => ({ wire_id: r.id, version: r.version })), ...house].map((r) => ({
        ...r, session: expected, status: "not_evaluated", reason, looks: 0, looks_expected: 1, names_evaluated: 0, names_absent: 0, hits: 0, hits_capped: 0, late: 0, evaluated_at: null, run_id: null,
      }));
      if (receipts.length) await store.writeReceipts(env, receipts, { cutoff: nightlyFinal(expected) });
      return { status: "flagged", session: expected, reason, receipts: receipts.length };
    },
  });
}
