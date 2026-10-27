import { LIMITS, STALENESS, ABSENT_REASONS, EVIDENCE_REJECT_KEYS, REGISTRY_VERSION, subjectKey, canonicalJson } from "./ff-contract.js";
import { sessionLabel, addSessions, sessionsBetween, nightlyAsOf } from "./ff-session.js";
import { scaledInt, unscaled, holdsEntry, holdsAt, bhCutoff } from "./ff-stats.js";
import { hitId, keyFor } from "./ff-ids.js";

export const ENGINE_VERSION = "ff-engine/1";

const REASONS = Object.freeze(["", ...ABSENT_REASONS]);
const CODE = Object.freeze(Object.fromEntries(REASONS.map((r, i) => [r, i])));
const PRECEDENCE = Object.freeze([
  "missing", "stale", "not_carded", "not_in_live_set", "record_truncated", "event_inside_window", "sector_coverage", "short_history",
  "unit_unverified", "out_of_range", "thin", "warming",
]);
const RANK = new Uint8Array(REASONS.length);
PRECEDENCE.forEach((r, i) => { RANK[CODE[r]] = i; });
const SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;
const OCC_MAX = 40;
const SECTOR_OK = (s) => typeof s === "string" && s.length >= 1 && s.length <= 40 && !/[:|]/.test(s);
const NAN = NaN;
const TRUE = 1;
const FALSE = 0;
const UNKNOWN = 2;

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const better = (a, b) => (a === 0 ? b : b === 0 ? a : RANK[a] <= RANK[b] ? a : b);

function buildCol(metric, vals, len, why, nb, fl, stale, present) {
  const ints = new Float64Array(len).fill(NAN);
  const code = new Uint8Array(len);
  if (!present) {
    code.fill(CODE.missing);
    return { ints, code, nb: null, fl: null, dead: CODE.missing };
  }
  if (stale) {
    code.fill(stale);
    return { ints, code, nb: null, fl: null, dead: stale };
  }
  const lo = metric.range[0];
  const hi = metric.range[1];
  const anomaly = metric.kind === "anomaly";
  for (let i = 0; i < len; i++) {
    const v = vals ? vals[i] : null;
    if (!finite(v)) continue;
    if (v < lo || v > hi) {
      code[i] = CODE.out_of_range;
      continue;
    }
    if (anomaly && nb && Number.isInteger(nb[i]) && nb[i] < LIMITS.baselineMin) {
      code[i] = CODE.warming;
      continue;
    }
    ints[i] = scaledInt(v, metric.unit);
  }
  if (why && typeof why === "object") {
    for (const reason of Object.keys(why)) {
      const c = CODE[reason] || CODE.missing;
      const list = why[reason];
      if (!Array.isArray(list)) continue;
      for (const i of list) if (Number.isInteger(i) && i >= 0 && i < len && Number.isNaN(ints[i]) && code[i] === 0) code[i] = c;
    }
  }
  return { ints, code, nb: nb || null, fl: fl || null, dead: 0 };
}

export function prepare(snap) {
  if (snap && snap.prepared === true) return snap;
  if (!snap || typeof snap !== "object" || (snap.kind !== "nightly" && snap.kind !== "live")) throw new TypeError("snapshot: kind is nightly or live");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snap.session || "")) throw new TypeError("snapshot: session is YYYY-MM-DD");
  const symbols = Array.isArray(snap.symbols) ? snap.symbols : [];
  const n = symbols.length;
  const rawSector = Array.isArray(snap.sector) ? snap.sector : [];
  const sectorOf = new Array(n);
  const symIdx = new Map();
  const bySector = new Map();
  const good = [];
  const badNames = [];
  for (let i = 0; i < n; i++) {
    const sym = symbols[i];
    const s = rawSector[i];
    sectorOf[i] = SECTOR_OK(s) ? s : null;
    if (typeof sym !== "string" || !SYMBOL_RE.test(sym)) {
      badNames.push(typeof sym === "string" ? sym.slice(0, 16) : "?");
      continue;
    }
    good.push(i);
    symIdx.set(sym, i);
    if (sectorOf[i] !== null) {
      if (!bySector.has(s)) bySector.set(s, []);
      bySector.get(s).push(i);
    }
  }
  const rows = Array.isArray(snap.windows) ? snap.windows : [];
  const wkeys = new Array(rows.length);
  const wsym = new Int32Array(rows.length);
  for (let w = 0; w < rows.length; w++) {
    const r = rows[w];
    wsym[w] = r && symIdx.has(r.symbol) ? symIdx.get(r.symbol) : -1;
    try {
      wkeys[w] = r && typeof r.symbol === "string" && SYMBOL_RE.test(r.symbol) && typeof r.occ === "string" && r.occ.length <= OCC_MAX ? subjectKey("c", r.symbol, r.occ) : null;
    } catch {
      wkeys[w] = null;
    }
  }
  const sect = snap.sectors && Array.isArray(snap.sectors.names) ? snap.sectors : null;
  const sectIdx = new Map();
  if (sect) sect.names.forEach((s, i) => sectIdx.set(s, i));
  const now = finite(snap.now) ? snap.now : Date.now();
  return {
    prepared: true,
    kind: snap.kind,
    session: snap.session,
    asOf: finite(snap.asOf) ? snap.asOf : snap.kind === "nightly" ? nightlyAsOf(snap.session) : now,
    now,
    look: Number.isInteger(snap.look) ? snap.look : 0,
    evaluator: snap.evaluator || snap.kind,
    evaluatorVersion: snap.evaluatorVersion || ENGINE_VERSION,
    n,
    symbols,
    sectorOf,
    symIdx,
    bySector,
    good: badNames.length ? Int32Array.from(good) : null,
    badNames,
    win: { rows, count: rows.length, symIdx: wsym, keys: wkeys },
    sect,
    sectIdx,
    sources: snap.sources && typeof snap.sources === "object" ? snap.sources : {},
    truncated: snap.truncated && typeof snap.truncated === "object" ? snap.truncated : {},
    raw: snap,
    tick: new Map(),
    sectCols: new Map(),
    winCols: new Map(),
    bh: new Map(),
    keyN: new Array(n),
  };
}

function staleCode(P, metric) {
  const src = metric.source[P.kind];
  if (!src) return CODE.missing;
  const s = P.sources[src.key];
  if (P.kind === "live") {
    if (!s || !finite(s.asOf)) return CODE.missing;
    if (s.session !== P.session) return CODE.stale;
    const limit = s.tier === 1 ? STALENESS.tier1S : metric.maxAgeS;
    return (P.now - s.asOf) / 1000 > limit ? CODE.stale : 0;
  }
  if (!s) return 0;
  const gap = sessionsBetween(s.session, P.session);
  return gap === null || gap > metric.maxAgeSessions ? CODE.stale : 0;
}

function colFor(P, metric) {
  const id = metric.id;
  if (metric.subject === "window") {
    let c = P.winCols.get(id);
    if (!c) {
      const rows = P.win.rows;
      const vals = rows.map((r) => (r && r.cols ? r.cols[id] : null));
      const present = rows.some((r) => r && r.cols && Object.prototype.hasOwnProperty.call(r.cols, id));
      const why = {};
      rows.forEach((r, i) => {
        const reason = r && r.why && r.why[id];
        if (reason) (why[reason] || (why[reason] = [])).push(i);
      });
      c = buildCol(metric, vals, rows.length, why, null, null, staleCode(P, metric), present || rows.length === 0);
      P.winCols.set(id, c);
    }
    return c;
  }
  if (metric.subject === "sector") {
    let c = P.sectCols.get(id);
    if (!c) {
      const s = P.sect;
      const len = s ? s.names.length : 0;
      c = buildCol(metric, s && s.cols ? s.cols[id] : null, len, s && s.why ? s.why[id] : null, s && s.n ? s.n[id] : null, s && s.floored ? s.floored[id] : null,
        staleCode(P, metric), !!(s && s.cols && Object.prototype.hasOwnProperty.call(s.cols, id)));
      P.sectCols.set(id, c);
    }
    return c;
  }
  let c = P.tick.get(id);
  if (!c) {
    const raw = P.raw;
    c = buildCol(metric, raw.cols ? raw.cols[id] : null, P.n, raw.why ? raw.why[id] : null, raw.n ? raw.n[id] : null, raw.floored ? raw.floored[id] : null,
      staleCode(P, metric), !!(raw.cols && Object.prototype.hasOwnProperty.call(raw.cols, id)));
    P.tick.set(id, c);
  }
  return c;
}

export const stateKey = (wireId, subject) => wireId + "\u0000" + subject;

export function unpackState(row) {
  let det = {};
  if (row.detector_json) {
    try {
      det = JSON.parse(row.detector_json) || {};
    } catch {
      det = {};
    }
  }
  return {
    phase: row.phase,
    cnt: Number.isInteger(row.cnt) ? row.cnt : 0,
    lastSession: row.last_session || null,
    coolUntil: row.cool_until || null,
    c: typeof det.c === "string" ? det.c : null,
    unseen: det.f === 0,
    t: Number.isInteger(det.t) ? det.t : null,
  };
}

export function packState(wire, subject, s) {
  let det = '{"c":"' + wire.clauseHash + '"';
  if (s.unseen) det += ',"f":0';
  if (Number.isInteger(s.t)) det += ',"t":' + s.t;
  det += "}";
  return {
    wire_id: wire.id, subject, version: wire.version, phase: s.phase, cnt: s.cnt, last_session: s.lastSession,
    cool_until: s.coolUntil || null, detector_json: det,
  };
}

function indexState(rows) {
  const by = new Map();
  if (!rows) return by;
  const list = rows instanceof Map ? Array.from(rows.values()) : rows;
  for (const r of list) {
    if (!r || typeof r.wire_id !== "string") continue;
    let m = by.get(r.wire_id);
    if (!m) by.set(r.wire_id, (m = new Map()));
    m.set(r.subject, r);
  }
  return by;
}

function bhFor(P, wire, keys, scopeSig) {
  const sig = scopeSig && wire.subjectKind !== "c" ? scopeSig + "|" + wire.clauses.filter((c) => c.kind === "anomaly").map((c) => c.m + c.op).sort().join(",") : null;
  if (sig) {
    const hit = P.bh.get(sig);
    if (hit) return hit;
  }
  const out = bhCutoff(keys, wire.q);
  if (sig) P.bh.set(sig, out);
  return out;
}

function elementsOf(wire, P) {
  const scope = wire.scope;
  const absent = [];
  if (wire.subjectKind === "s") {
    const s = P.sect;
    if (!s) return { els: new Int32Array(0), absent, sig: "s" };
    if (scope.kind === "universe") return { els: null, count: s.names.length, absent, sig: "s:u" };
    const i = P.sectIdx.get(scope.sector);
    return { els: i === undefined ? new Int32Array(0) : Int32Array.of(i), absent, sig: "s:" + scope.sector };
  }
  if (wire.subjectKind === "c") {
    const w = P.win;
    const out = [];
    const names = scope.kind === "names" ? new Set(scope.symbols) : null;
    for (let i = 0; i < w.count; i++) {
      const row = w.rows[i];
      if (!row || w.keys[i] === null) {
        absent.push(row && typeof row.symbol === "string" ? row.symbol : "?");
        continue;
      }
      if (names && !names.has(row.symbol)) continue;
      if (scope.kind === "sector" && !(w.symIdx[i] >= 0 && P.sectorOf[w.symIdx[i]] === scope.sector)) continue;
      out.push(i);
    }
    return { els: Int32Array.from(out), absent, sig: null };
  }
  if (scope.kind === "universe") return { els: P.good, count: P.n, absent: P.badNames, sig: "u" };
  if (scope.kind === "sector") return { els: Int32Array.from(P.bySector.get(scope.sector) || []), absent, sig: "s:" + scope.sector };
  const out = [];
  for (const s of scope.symbols) {
    const i = P.symIdx.get(s);
    if (i === undefined) absent.push(s);
    else out.push(i);
  }
  return { els: Int32Array.from(out), absent, sig: "n:" + scope.symbols.join(",") };
}

function subjectInfo(wire, P, el) {
  if (wire.subjectKind === "n") {
    const key = P.keyN[el] || (P.keyN[el] = "n:" + P.symbols[el]);
    return { key, symbol: P.symbols[el], sector: P.sectorOf[el] || null, occ: null };
  }
  if (wire.subjectKind === "s") return { key: "s:" + P.sect.names[el], symbol: null, sector: P.sect.names[el], occ: null };
  const row = P.win.rows[el];
  const si = P.win.symIdx[el];
  return { key: P.win.keys[el], symbol: row.symbol, sector: si >= 0 ? P.sectorOf[si] || null : null, occ: row.occ };
}

function scoreWire(wire, P, els, count) {
  const cl = wire.clauses;
  const nc = cl.length;
  const cols = cl.map((c) => colFor(P, c.metric));
  const via = cl.map((c) => wire.subjectKind === "c" && c.subject === "ticker");
  const T = new Uint8Array(count);
  const H = new Uint8Array(count);
  const R = new Uint8Array(count);
  const K = new Int32Array(count);
  const M = new Int32Array(count);
  const A = new Uint8Array(count);
  const anomaly = wire.anomaly.length > 0;
  const lead = wire.lead;
  for (let j = 0; j < count; j++) {
    const el = els ? els[j] : j;
    let anyF = 0;
    let anyU = 0;
    let hF = 0;
    let reason = 0;
    let known = 1;
    let key = 2147483647;
    let margin = 0;
    for (let k = 0; k < nc; k++) {
      const c = cl[k];
      const col = cols[k];
      const ci = via[k] ? P.win.symIdx[el] : el;
      const v = ci >= 0 ? col.ints[ci] : NAN;
      if (v !== v) {
        anyU = 1;
        reason = better(reason, ci < 0 ? CODE.not_carded : col.code[ci] || CODE.missing);
        if (c.kind === "anomaly") known = 0;
        continue;
      }
      if (!holdsEntry(c.op, v, c.xi)) anyF = 1;
      if (!holdsAt(c.op, v, c.xi, c.h20)) hF = 1;
      if (c.kind === "anomaly") {
        const e = c.op === ">=" ? v : -v;
        if (e < key) key = e;
      }
      if (k === lead) margin = c.op === ">=" ? v - c.xi : c.op === "<=" ? c.xi - v : 0;
    }
    T[j] = anyF ? FALSE : anyU ? UNKNOWN : TRUE;
    H[j] = hF ? FALSE : anyU ? UNKNOWN : TRUE;
    R[j] = reason;
    A[j] = anomaly && known ? 1 : 0;
    K[j] = anomaly && known ? key : 0;
    M[j] = anomaly ? (known ? key : 0) : margin;
  }
  return { T, H, R, K, M, A };
}

function applyBh(wire, P, sc, count, sig) {
  if (!wire.anomaly.length) return null;
  const keys = [];
  for (let j = 0; j < count; j++) if (sc.A[j]) keys.push(sc.K[j]);
  const fam = bhFor(P, wire, keys, sig);
  for (let j = 0; j < count; j++) {
    if (!sc.A[j]) continue;
    if (fam.cutoff === null || sc.K[j] < fam.cutoff) sc.T[j] = FALSE;
  }
  return fam;
}

function foldWindows(wire, P, els, sc) {
  const map = new Map();
  for (let j = 0; j < els.length; j++) {
    const key = P.win.keys[els[j]];
    const t = sc.T[j];
    const h = sc.H[j];
    let a = map.get(key);
    if (!a) {
      a = { key, t, h, reason: sc.R[j], rank: t === TRUE ? sc.M[j] : -2147483648, el: els[j], best: t === TRUE ? j : -1, count: 1, js: [j] };
      map.set(key, a);
      continue;
    }
    a.js.push(j);
    a.t = a.t === TRUE || t === TRUE ? TRUE : a.t === UNKNOWN || t === UNKNOWN ? UNKNOWN : FALSE;
    a.h = a.h === TRUE || h === TRUE ? TRUE : a.h === UNKNOWN || h === UNKNOWN ? UNKNOWN : FALSE;
    a.reason = better(a.reason, sc.R[j]);
    if (t === TRUE) {
      const spanA = P.win.rows[a.el].spanStart;
      const spanB = P.win.rows[els[j]].spanStart;
      if (a.best < 0 || sc.M[j] > a.rank || (sc.M[j] === a.rank && spanB < spanA)) {
        a.rank = sc.M[j];
        a.el = els[j];
        a.best = j;
      }
    }
  }
  return Array.from(map.values()).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

function evidenceFor(wire, P, el, jIndex, sc, fam, info, usesSym) {
  const clauses = wire.clauses.map((c) => {
    const col = colFor(P, c.metric);
    const ci = wire.subjectKind === "c" && c.subject === "ticker" ? P.win.symIdx[el] : el;
    const vi = col.ints[ci];
    const out = {
      m: c.m, label: c.label, unit: c.unit, subject: c.subject, op: c.op, x: c.x, value: unscaled(vi, c.unit), ok: true,
    };
    if (c.kind === "anomaly") {
      if (col.nb && Number.isInteger(col.nb[ci])) {
        out.n = col.nb[ci];
        out.window = LIMITS.baselineWindow;
      }
      if (col.fl && col.fl[ci] === 1) out.floored = true;
    }
    return out;
  });
  const e = {
    v: 1, wire: wire.id, version: wire.version, layer: wire.layer, subject: info.key, session: P.session, asOf: P.asOf, firedAt: P.now,
    evaluator: P.evaluator, evaluatorVersion: P.evaluatorVersion, registryVersion: wire.registryVersion, look: P.look, persist: wire.persist,
    cooldown: wire.cooldown, edge: wire.edge, wireSentence: wire.sentence, lead: wire.lead, clauses,
  };
  if (info.symbol) e.symbol = info.symbol;
  if (info.sector) e.sector = info.sector;
  if (info.occ) e.occ = info.occ;
  if (fam && sc.A[jIndex]) e.bh = { m: fam.m, k: fam.k, q: wire.q, e: sc.K[jIndex], cutoff: fam.cutoff };
  const srcs = [];
  const seen = new Set();
  for (const c of wire.clauses) {
    const src = c.metric.source[P.kind];
    if (!src || seen.has(src.key)) continue;
    seen.add(src.key);
    const s = P.sources[src.key];
    if (s) srcs.push({ key: src.key, session: s.session, asOf: s.asOf });
  }
  if (srcs.length) e.sources = srcs;
  return e;
}

export function checkEvidence(e) {
  const bad = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, path));
    else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (EVIDENCE_REJECT_KEYS.some((r) => k === r || (r === "ret" && k.startsWith("ret")) || (r === "pnl" && k.startsWith("pnl")))) bad.push(path + "." + k);
        walk(v[k], path + "." + k);
      }
    }
  };
  walk(e, "$");
  return bad;
}

const utf8Length = (s) => new TextEncoder().encode(s).length;

function evidenceJson(e) {
  let text = canonicalJson(e);
  if (utf8Length(text) <= LIMITS.evidenceBytes) return text;
  const slim = { ...e };
  delete slim.sources;
  delete slim.wireSentence;
  text = canonicalJson(slim);
  if (utf8Length(text) > LIMITS.evidenceBytes) throw new RangeError("evidence is over " + LIMITS.evidenceBytes + " bytes");
  return text;
}

function newState(over) {
  return { phase: "armed", cnt: 0, lastSession: null, coolUntil: null, unseen: false, t: null, ...over };
}

function stepSubject(wire, P, env, { row, t, h, key }) {
  const live = wire.cadence === "live";
  const s = P.session;
  const res = { skip: false, mismatch: false, hit: false, next: undefined };
  let prev = null;
  if (row) {
    prev = unpackState(row);
    if (prev.c !== wire.clauseHash) {
      res.mismatch = true;
      prev = null;
    }
  }
  if (prev) {
    if (!live && prev.lastSession !== null && prev.lastSession >= s) {
      res.skip = true;
      return res;
    }
    if (live && prev.lastSession === s && prev.t !== null && P.look <= prev.t) {
      res.skip = true;
      return res;
    }
    if (live && prev.lastSession !== s) prev = { ...prev, cnt: 0, t: null };
  }
  const unseenStart = wire.edge === "state" && (res.mismatch || env.fresh);
  const cur = prev || newState({ unseen: unseenStart });
  const tick = live ? P.look : null;
  if (live && t !== UNKNOWN) {
    const dk = keyFor({ layer: wire.layer, subject: key, session: s, clauseHash: wire.clauseHash });
    if (env.existing.has(wire.id + "|" + dk)) {
      res.next = row ? null : undefined;
      res.quiet = true;
      return res;
    }
  }
  if (cur.phase === "firing") {
    if (h !== FALSE) return res;
    res.next = cur.coolUntil && cur.coolUntil > s ? newState({ phase: "cooling", coolUntil: cur.coolUntil, lastSession: s }) : null;
    return res;
  }
  const quiet = cur.phase === "cooling" && cur.coolUntil !== null && s < cur.coolUntil;
  if (t === UNKNOWN) {
    if (res.mismatch || (!row && cur.unseen)) res.next = newState({ phase: "pending", cnt: 0, lastSession: s, unseen: true, t: tick });
    return res;
  }
  if (t === FALSE) {
    if (!quiet) res.next = null;
    return res;
  }
  if (quiet) return res;
  const cnt = Math.min((cur.phase === "pending" ? cur.cnt : 0) + 1, wire.persist);
  if (cnt < wire.persist || (wire.edge === "state" && cur.unseen)) {
    res.next = newState({ phase: "pending", cnt, lastSession: s, unseen: cur.unseen, t: tick });
    return res;
  }
  res.hit = true;
  res.next = live ? null : newState({ phase: "firing", coolUntil: addSessions(s, wire.cooldown), lastSession: s });
  return res;
}

const changed = (row, next, live) => {
  if (!row) return true;
  const a = unpackState(row);
  return a.phase !== next.phase || a.cnt !== next.cnt || (a.coolUntil || null) !== (next.coolUntil || null) || a.unseen !== next.unseen || a.c === null
    || (live && a.lastSession !== next.lastSession);
};

function capRank(a, b) {
  return a.rankIn - b.rankIn || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function makeHit(c, P, env) {
  const { wire, info } = c;
  return {
    stream: wire.stream, hit_id: c.id, wire_id: wire.id, wire_version: wire.version, member_id: wire.memberId,
    subject: c.subject, symbol: info.symbol, sector: info.sector, dedupe_key: c.dk, session: P.session,
    session_label: sessionLabel(P.session, P.asOf), fired_at: P.now, data_as_of: P.asOf, evaluator: P.evaluator,
    evaluator_version: P.evaluatorVersion, evidence_json: evidenceJson(evidenceFor(wire, P, c.el, c.j, c.sc, c.fam, info)),
    state: env.hold || wire.switch === "hold" ? "held" : "delivered",
  };
}

export function capHits(hits, capUsed = {}) {
  const used = {
    wire: capUsed.wire instanceof Map ? capUsed.wire : new Map(Object.entries(capUsed.wire || {})),
    member: capUsed.member instanceof Map ? capUsed.member : new Map(Object.entries(capUsed.member || {})),
    global: Number.isInteger(capUsed.global) ? capUsed.global : 0,
  };
  const byWire = new Map();
  for (const h of hits) {
    if (!byWire.has(h.wire.id)) byWire.set(h.wire.id, []);
    byWire.get(h.wire.id).push(h);
  }
  const kept = [];
  const capped = [];
  for (const [id, list] of byWire) {
    list.sort((a, b) => b.rank - a.rank || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
    const w = list[0].wire;
    const cap = w.layer === "house" ? LIMITS.hitsPerHouseWirePerSession[w.cadence] : LIMITS.hitsPerMemberWirePerSession;
    const room = Math.max(0, cap - (used.wire.get(id) || 0));
    list.forEach((h, i) => {
      h.rankIn = i;
      if (i < room) {
        h.id = hitId(h.wire.id, h.dk);
        kept.push(h);
      } else capped.push(h);
    });
  }
  const members = new Map();
  const houses = [];
  for (const h of kept) {
    if (h.wire.layer === "house") houses.push(h);
    else {
      if (!members.has(h.wire.memberId)) members.set(h.wire.memberId, []);
      members.get(h.wire.memberId).push(h);
    }
  }
  const afterMember = [];
  for (const [id, list] of members) {
    list.sort(capRank);
    const room = Math.max(0, LIMITS.hitsPerMemberPerSession - (used.member.get(id) || 0));
    list.forEach((h, i) => {
      h.rankIn = i;
      (i < room ? afterMember : capped).push(h);
    });
  }
  afterMember.sort(capRank);
  const room = Math.max(0, LIMITS.hitsGlobalPerSession - used.global);
  const finalMembers = [];
  afterMember.forEach((h, i) => (i < room ? finalMembers : capped).push(h));
  return { kept: [...houses, ...finalMembers], capped };
}

function receiptFor(wire, P, r) {
  const absentTotal = r.absentN;
  const entries = Array.from(r.absent.entries()).sort((a, b) => b[1] - a[1] || RANK[CODE[a[0]]] - RANK[CODE[b[0]]]);
  let samples = true;
  const build = (withSamples) => {
    const o = {};
    for (const [reason, count] of entries) {
      o[reason] = withSamples && r.samples.get(reason) ? { n: count, sample: r.samples.get(reason).slice().sort().slice(0, 5) } : { n: count };
    }
    return JSON.stringify(o);
  };
  let json = build(samples);
  if (json.length > 2048) {
    samples = false;
    json = build(false);
  }
  return {
    wire_id: wire.id, version: wire.version, session: P.session, status: r.status, reason: r.reason, looks: 1, looks_expected: null,
    names_evaluated: r.names, names_absent: absentTotal, absent_json: absentTotal ? json : null, hits: r.hits, hits_capped: r.capped, late: 0,
    evaluated_at: r.status === "evaluated" ? P.now : null, run_id: null, mode: wire.cadence === "live" ? "accumulate" : "replace",
    state_mismatch: r.mismatch, duplicates: r.dup,
  };
}

function notEvaluated(wire, P, reason) {
  return receiptFor(wire, P, { status: "not_evaluated", reason, names: 0, absentN: 0, absent: new Map(), samples: new Map(), hits: 0, capped: 0, mismatch: 0, dup: 0 });
}

function runWire(wire, P, env) {
  const deadCols = wire.clauses.map((c) => colFor(P, c.metric).dead);
  if (deadCols.every((d) => d !== 0)) return { receipt: notEvaluated(wire, P, deadCols.includes(CODE.missing) ? "source_missing" : "source_stale") };
  const { els, count: cnt, absent: lost, sig } = elementsOf(wire, P);
  const count = els ? els.length : cnt;
  const sc = scoreWire(wire, P, els, count);
  const fam = applyBh(wire, P, sc, count, sig);
  const rows = env.state.get(wire.id) || null;
  const firstLook = env.firstLook.get(wire.id + "@" + wire.version);
  const fresh = wire.cadence === "live" ? firstLook == null : firstLook == null || firstLook === P.session;
  const freshState = fresh && wire.edge === "state";
  const stepEnv = { existing: env.existing, fresh };
  const r = { status: "evaluated", reason: null, names: 0, absentN: 0, absent: new Map(), samples: new Map(), hits: 0, capped: 0, mismatch: 0, dup: 0 };
  const addAbsent = (reason, symbol) => {
    r.absentN++;
    r.absent.set(reason, (r.absent.get(reason) || 0) + 1);
    if (symbol) {
      let list = r.samples.get(reason);
      if (!list) r.samples.set(reason, (list = []));
      if (list.length < 40) list.push(symbol);
    }
  };
  for (const sym of lost) addAbsent(wire.subjectKind === "c" ? "missing" : "not_carded", sym);
  const out = { hits: [], upserts: [], deletes: [], stat: r };
  const settle = (key, row, t, h, el, j, info, rankV) => {
    const step = stepSubject(wire, P, stepEnv, { row, t, h, key });
    if (step.skip) return;
    if (step.mismatch) r.mismatch++;
    if (step.hit) {
      const inf = info || subjectInfo(wire, P, el);
      const dk = keyFor({ layer: wire.layer, subject: key, session: P.session, clauseHash: wire.clauseHash });
      if (env.existing.has(wire.id + "|" + dk)) r.dup++;
      else out.hits.push({ wire, rank: rankV, rankIn: 0, subject: key, dk, el, j, info: inf, sc, fam, id: null });
    }
    if (step.next === null) {
      if (row) out.deletes.push({ wire_id: wire.id, subject: key });
    } else if (step.next !== undefined) {
      if (changed(row, step.next, wire.cadence === "live")) out.upserts.push(packState(wire, key, step.next));
    } else if (step.mismatch && row) out.deletes.push({ wire_id: wire.id, subject: key });
  };
  if (wire.subjectKind === "c") {
    const seen = new Set();
    for (const a of foldWindows(wire, P, els, sc)) {
      const info = subjectInfo(wire, P, a.el);
      seen.add(a.key);
      if (a.t === UNKNOWN) addAbsent(REASONS[a.reason || CODE.missing], info.symbol);
      else r.names++;
      const row = rows ? rows.get(a.key) || null : null;
      if (!row && a.t !== TRUE && !freshState) continue;
      settle(a.key, row, a.t, a.h, a.el, a.best >= 0 ? a.best : a.js[0], info, a.rank);
    }
    if (rows && wire.cadence === "live") for (const key of rows.keys()) if (!seen.has(key)) addAbsent("not_in_live_set", null);
  } else {
    for (let j = 0; j < count; j++) {
      const t = sc.T[j];
      const el = els ? els[j] : j;
      if (t === UNKNOWN) addAbsent(REASONS[sc.R[j] || CODE.missing], wire.subjectKind === "n" ? P.symbols[el] : P.sect.names[el]);
      else r.names++;
      if (!rows && t !== TRUE && !freshState) continue;
      const info = subjectInfo(wire, P, el);
      const row = rows ? rows.get(info.key) || null : null;
      if (!row && t !== TRUE && !freshState) continue;
      settle(info.key, row, t, sc.H[j], el, j, info, sc.M[j]);
    }
  }
  if (!r.names && r.absentN) {
    const only = Array.from(r.absent.keys());
    if (only.length === 1 && (only[0] === "stale" || only[0] === "missing")) return { receipt: notEvaluated(wire, P, only[0] === "stale" ? "source_stale" : "source_missing") };
  }
  if (wire.clauses.some((c) => c.metric.source[P.kind] && P.truncated[c.metric.source[P.kind].key] === true)) r.reason = "record_truncated";
  return out;
}

export function evaluate(snapshot, wires, options = {}) {
  const P = prepare(snapshot);
  const env = {
    state: indexState(options.state),
    existing: options.existingKeys instanceof Set ? options.existingKeys : new Set(options.existingKeys || []),
    firstLook: options.firstLook instanceof Map ? options.firstLook : new Map(Object.entries(options.firstLook || {})),
    hold: options.mode === "shadow",
  };
  const ordered = wires.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version));
  const receipts = [];
  const errors = [];
  const upserts = [];
  const deletes = [];
  const raw = [];
  const perWire = new Map();
  for (const wire of ordered) {
    if (wire.status !== "armed") continue;
    if (wire.effectiveSession && P.session < wire.effectiveSession) continue;
    const eligible = wire.cadence === P.kind || (wire.catchup === true && P.kind === "nightly");
    if (!eligible) continue;
    if (wire.blocked) {
      receipts.push(notEvaluated(wire, P, wire.blocked));
      continue;
    }
    if (wire.switch === "off") {
      receipts.push(notEvaluated(wire, P, "switch_off"));
      continue;
    }
    try {
      const out = runWire(wire, P, env);
      if (out.receipt) {
        receipts.push(out.receipt);
        continue;
      }
      perWire.set(wire.id, { wire, out });
      raw.push(...out.hits);
    } catch (err) {
      errors.push({ wire_id: wire.id, error: String(err && err.message ? err.message : err).slice(0, 160) });
      receipts.push(notEvaluated(wire, P, "evaluator_error"));
    }
  }
  const { kept, capped } = capHits(raw, options.capUsed);
  const failed = new Set();
  for (const h of kept) {
    if (failed.has(h.wire.id)) continue;
    try {
      h.row = makeHit(h, P, env);
    } catch (err) {
      failed.add(h.wire.id);
      errors.push({ wire_id: h.wire.id, error: String(err && err.message ? err.message : err).slice(0, 160) });
    }
  }
  const keptBy = new Map();
  const cappedBy = new Map();
  for (const h of kept) if (!failed.has(h.wire.id)) keptBy.set(h.wire.id, (keptBy.get(h.wire.id) || 0) + 1);
  for (const h of capped) cappedBy.set(h.wire.id, (cappedBy.get(h.wire.id) || 0) + 1);
  for (const [id, { wire, out }] of perWire) {
    if (failed.has(id)) {
      receipts.push(notEvaluated(wire, P, "evaluator_error"));
      continue;
    }
    out.stat.hits = keptBy.get(id) || 0;
    out.stat.capped = cappedBy.get(id) || 0;
    receipts.push(receiptFor(wire, P, out.stat));
    upserts.push(...out.upserts);
    deletes.push(...out.deletes);
  }
  const bySubject = (a, b) => (a.wire_id < b.wire_id ? -1 : a.wire_id > b.wire_id ? 1 : a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);
  const hits = kept.filter((h) => !failed.has(h.wire.id)).map((h) => h.row).sort((a, b) => bySubject(a, b));
  upserts.sort(bySubject);
  deletes.sort(bySubject);
  receipts.sort((a, b) => (a.wire_id < b.wire_id ? -1 : a.wire_id > b.wire_id ? 1 : a.version - b.version));
  return {
    hits,
    capped: capped.map((h) => ({ wire_id: h.wire.id, subject: h.subject })).sort(bySubject),
    receipts,
    state: { upserts, deletes },
    errors,
    stats: {
      wires: ordered.length, receipts: receipts.length, hits: hits.length, capped: capped.length, errors: errors.length,
      unknown: receipts.reduce((n, r) => n + r.names_absent, 0),
    },
  };
}

export function evaluateSafe(snapshot, wires, options) {
  try {
    return { ok: true, result: evaluate(snapshot, wires, options), error: null };
  } catch (err) {
    return { ok: false, result: null, error: String(err && err.message ? err.message : err).slice(0, 240) };
  }
}

export function replayDecision(evidence) {
  const out = { ok: true, reasons: [] };
  for (const c of evidence.clauses) {
    const vi = scaledInt(c.value, c.unit);
    const xi = scaledInt(c.x, c.unit);
    if (vi === null || xi === null || !holdsEntry(c.op, vi, xi)) {
      out.ok = false;
      out.reasons.push(c.m);
    }
  }
  if (evidence.bh && !(evidence.bh.cutoff !== null && evidence.bh.e >= evidence.bh.cutoff)) {
    out.ok = false;
    out.reasons.push("bh");
  }
  return out;
}

export function preview(snapshot, wire, { limit = 25 } = {}) {
  const P = prepare(snapshot);
  const { els, count: cnt, absent: lost, sig } = elementsOf(wire, P);
  const count = els ? els.length : cnt;
  const sc = scoreWire(wire, P, els, count);
  applyBh(wire, P, sc, count, sig);
  const rows = [];
  let known = 0;
  let unknown = lost.length;
  const reasons = {};
  let would = 0;
  for (let j = 0; j < count; j++) {
    const t = sc.T[j];
    if (t === UNKNOWN) {
      unknown++;
      const r = REASONS[sc.R[j] || CODE.missing];
      reasons[r] = (reasons[r] || 0) + 1;
      continue;
    }
    known++;
    if (t !== TRUE) continue;
    would++;
    const el = els ? els[j] : j;
    rows.push({ el, j, m: sc.M[j] });
  }
  rows.sort((a, b) => b.m - a.m || a.el - b.el);
  const shown = rows.slice(0, limit).map((r) => {
    const info = subjectInfo(wire, P, r.el);
    return { subject: info.key, symbol: info.symbol, sector: info.sector, values: wire.clauses.map((c) => {
      const col = colFor(P, c.metric);
      return { m: c.m, value: unscaled(col.ints[wire.subjectKind === "c" && c.subject === "ticker" ? P.win.symIdx[r.el] : r.el], c.unit) };
    }) };
  });
  return { subjects: count + lost.length, evaluated: known, unknown, reasons, wouldHit: would, rows: shown };
}

export const REGISTRY = REGISTRY_VERSION;
