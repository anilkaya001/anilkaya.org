import { METRICS, PAYLOADS, REGISTRY_VERSION, LIMITS, metricById } from "../../shared/ff-contract.js";
import { robustZ, scaledInt } from "../../shared/ff-stats.js";
import { priorSessions } from "../../shared/ff-session.js";
import { unpackSeries } from "../../shared/flows-positioning.js";
import { CARRY_FIELDS } from "./ff-carry.mjs";

export const FF_METRICS_VERSION = 1;

export const FF_METRICS_KEY = PAYLOADS.metrics.key;

export const FF_METRICS_CAP = PAYLOADS.metrics.maxBytes;

export const CLEAR_AHEAD = 10;

export const PAST_MOVES = LIMITS.maxPastReports;

export const SECTOR_SET_MIN_DAYS = 18;

export const SKEW_BAND_PT = 0.5;

export const THIN_CONTRACTS = LIMITS.thinContracts;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const finite = (x) => typeof x === "number" && Number.isFinite(x);

export const times100 = (v) => Number((v * 100).toPrecision(12));

const isDay = (d) => typeof d === "string" && DAY_RE.test(d);

const DAY_MS = 86400000;

export const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

const SHIPPED = Object.freeze(METRICS.filter((m) => m.status === "ready" || m.status === "limited").map((m) => m.id));

const NAME_SHIPPED = Object.freeze(SHIPPED.filter((id) => metricById(id).subject === "ticker"));

const SECTOR_SHIPPED = Object.freeze(SHIPPED.filter((id) => metricById(id).subject === "sector"));

export function parseHist(payload) {
  if (!payload || typeof payload !== "object" || !isDay(payload.d0) || !Array.isArray(payload.dd)) return null;
  const v = payload.volume;
  if (!v || typeof v !== "object") return null;
  const base = Date.parse(payload.d0 + "T00:00:00Z");
  const days = payload.dd.map((o) => (Number.isInteger(o) && o >= 0 ? new Date(base + o * DAY_MS).toISOString().slice(0, 10) : null));
  const series = {};
  for (const key of ["np", "vol", "pc"]) {
    const values = unpackSeries(v[key]);
    if (!values.length) {
      series[key] = new Map();
      continue;
    }
    if (values.length !== days.length) return null;
    const m = new Map();
    days.forEach((d, i) => {
      if (d !== null && finite(values[i])) m.set(d, values[i]);
    });
    series[key] = m;
  }
  return { asOf: isDay(v.asOf) ? v.asOf : null, session: isDay(payload.sessionDate) ? payload.sessionDate : null, ...series };
}

class Column {
  constructor(id, length) {
    this.id = id;
    this.metric = metricById(id);
    this.vals = new Array(length).fill(null);
    this.reasons = new Array(length).fill(null);
    this.n = this.metric.kind === "anomaly" ? new Array(length).fill(null) : null;
    this.floored = this.metric.kind === "anomaly" ? new Array(length).fill(0) : null;
  }

  put(i, value) {
    const q = scaledInt(value, this.metric.unit);
    this.vals[i] = q;
    this.reasons[i] = null;
  }

  miss(i, reason) {
    this.vals[i] = null;
    this.reasons[i] = reason;
  }

  baseline(i, n, floored = false) {
    if (this.n) this.n[i] = Number.isInteger(n) ? n : null;
    if (this.floored) this.floored[i] = floored ? 1 : 0;
  }
}

function runsOf(indexes) {
  const out = [];
  let i = 0;
  while (i < indexes.length) {
    let j = i;
    while (j + 1 < indexes.length && indexes[j + 1] === indexes[j] + 1) j++;
    if (j - i >= 2) out.push([indexes[i], indexes[j]]);
    else for (let k = i; k <= j; k++) out.push(indexes[k]);
    i = j + 1;
  }
  return out;
}

export function whyOf(reasons) {
  const by = new Map();
  reasons.forEach((r, i) => {
    if (r === null || r === undefined) return;
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(i);
  });
  const out = {};
  for (const reason of [...by.keys()].sort()) if (reason !== "missing") out[reason] = runsOf(by.get(reason));
  return out;
}

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

function trim(values) {
  let end = values.length;
  while (end > 0 && values[end - 1] === null) end--;
  return end === values.length ? values : values.slice(0, end);
}

function encodeColumns(columns, length) {
  const cols = {};
  const n = {};
  const f = {};
  const why = {};
  for (const col of columns) {
    cols[col.id] = trim(col.vals);
    if (col.n) {
      n[col.id] = trim(col.n);
      const hot = [];
      col.floored.forEach((flag, i) => {
        if (flag === 1) hot.push(i);
      });
      if (hot.length) f[col.id] = hot;
    }
    const w = whyOf(col.reasons);
    if (Object.keys(w).length) why[col.id] = w;
  }
  return { cols, n, f, why, length };
}

export function baselineOf(series, days) {
  return days.map((d) => {
    const v = series.get(d);
    return finite(v) ? v : null;
  });
}

export function robustColumn(col, i, { x, series, days, floor, zSpace }) {
  const r = robustZ({ x, baseline: baselineOf(series, days), floor, zSpace });
  col.baseline(i, r.n, r.floored);
  if (r.z === null) {
    col.miss(i, r.reason === "warming" || r.reason === "thin" || r.reason === "out_of_range" ? r.reason : "missing");
    return r;
  }
  col.put(i, r.z);
  return r;
}

function thinSeries(volMap, pcMap) {
  const out = new Map();
  for (const [d, pc] of pcMap) {
    const vol = volMap.get(d);
    if (!finite(vol) || !finite(pc) || !(pc > 0)) continue;
    const calls = vol / (1 + pc);
    const puts = (vol * pc) / (1 + pc);
    if (calls >= THIN_CONTRACTS && puts >= THIN_CONTRACTS) out.set(d, pc);
  }
  return out;
}

function histColumns(session, days, hist, cols, i) {
  const np = cols["flow.net_premium"];
  const zn = cols["flow.net_premium.z20"];
  const zv = cols["flow.volume.z20"];
  const zp = cols["flow.pc_volume.z20"];
  const all = [np, zn, zv, zp];
  if (!hist) {
    for (const c of all) c.miss(i, "missing");
    return null;
  }
  if (hist.asOf !== session) {
    for (const c of all) c.miss(i, "stale");
    return null;
  }
  const today = hist.np.get(session);
  if (finite(today)) np.put(i, today);
  else np.miss(i, "missing");
  const spec = (id) => metricById(id).baseline;
  if (finite(today)) robustColumn(zn, i, { x: today, series: hist.np, days, floor: spec(zn.id).floor, zSpace: spec(zn.id).zSpace });
  else zn.miss(i, "missing");
  const vol = hist.vol.get(session);
  if (finite(vol)) robustColumn(zv, i, { x: vol, series: hist.vol, days, floor: spec(zv.id).floor, zSpace: spec(zv.id).zSpace });
  else zv.miss(i, "missing");
  const clean = thinSeries(hist.vol, hist.pc);
  const pc = hist.pc.get(session);
  if (!finite(pc) || !finite(vol)) zp.miss(i, "missing");
  else if (!clean.has(session)) zp.miss(i, "thin");
  else robustColumn(zp, i, { x: pc, series: clean, days, floor: spec(zp.id).floor, zSpace: spec(zp.id).zSpace });
  return hist;
}

export function impliedRatio(cardX, session) {
  const t = cardX && cardX.term;
  if (!t || t.status !== "ok") return { reason: "missing" };
  if (t.asOf !== session) return { reason: "stale" };
  const move = t.eventMove;
  const implied = move ? move.meanAbs : null;
  if (!finite(implied) || !(implied > 0)) return { reason: "missing" };
  const e = cardX.earnings;
  const rows = e && Array.isArray(e.events) ? e.events : [];
  const moves = [];
  for (const row of rows) {
    if (moves.length >= PAST_MOVES) break;
    const m = Array.isArray(row) ? row[3] : null;
    if (finite(m)) moves.push(Math.abs(m));
  }
  if (moves.length < LIMITS.minPastReports) return { reason: "short_history", n: moves.length };
  const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
  if (!(mean > 0)) return { reason: "thin", n: moves.length };
  return { value: implied / mean, n: moves.length };
}

export function skewCross(cardX, session) {
  const s = cardX && cardX.skew;
  if (!s || s.status !== "ok") return { reason: "missing" };
  const ser = s.series;
  if (!ser || !Array.isArray(ser.d) || !Array.isArray(ser.rr25) || ser.d.length !== ser.rr25.length) return { reason: "missing" };
  const last = ser.d.length - 1;
  if (last < 1) return { reason: "short_history" };
  if (ser.d[last] !== session) return { reason: "stale" };
  const cur = ser.rr25[last];
  const prev = ser.rr25[last - 1];
  if (!finite(cur) || !finite(prev)) return { reason: "missing" };
  const asPoints = (v) => Math.round(-v * 1000) / 10;
  const a = asPoints(cur);
  const b = asPoints(prev);
  return { value: a > 0 && b <= -SKEW_BAND_PT ? 1 : 0, now: a, before: b };
}

export function ivVolOfVol(cardX, session) {
  const d = cardX && cardX.ivDyn;
  if (!d || d.status !== "ok") return { reason: "missing" };
  if (d.asOf !== session) return { reason: "stale" };
  if (!finite(d.volOfVol)) return { reason: "short_history" };
  return { vov: d.volOfVol, changes: Number.isInteger(d.changes) ? d.changes : null };
}

function engineFact(card, id, session) {
  if (!card || card.sessionDate !== session) return { reason: card ? "stale" : "missing" };
  const facts = card.engine && Array.isArray(card.engine.facts) ? card.engine.facts : null;
  if (!facts) return { reason: "missing" };
  const fact = facts.find((f) => f && f.id === id);
  if (!fact || !finite(fact.v)) return { reason: "missing" };
  if (!(fact.g >= 2)) return { reason: "thin" };
  return { value: fact.v };
}

function earnColumns(session, universe, universeIndex, cardX, cols, i) {
  const sess = cols["earn.sessions"];
  const clear = cols["earn.clear_10"];
  const conf = cols["earn.confirmed"];
  const iv1 = cols["vol.iv.30d.chg1d"];
  const zvov = cols["vol.iv.30d.zvov"];
  const ratio = cols["earn.implied_ratio"];
  const u = universeIndex;
  const fresh = universe.sessionDate === session;
  const cell = (key) => {
    if (u < 0) return { reason: "missing" };
    if (!fresh) return { reason: "stale" };
    const arr = universe.cols && universe.cols[key];
    const unit = universe.units && universe.units[key];
    if (!Array.isArray(arr) || !Array.isArray(unit)) return { reason: "missing" };
    const raw = arr[u];
    return finite(raw) && finite(unit[1]) && unit[1] !== 0 ? { value: raw / unit[1] } : { reason: "missing" };
  };
  const ed = cell("ed");
  if (ed.reason) {
    sess.miss(i, ed.reason);
    clear.miss(i, ed.reason);
  } else {
    sess.put(i, ed.value);
    clear.put(i, ed.value > CLEAR_AHEAD ? 1 : 0);
  }
  const d = cell("dIv1d");
  if (d.reason) {
    iv1.miss(i, d.reason);
    zvov.miss(i, d.reason);
  } else {
    iv1.put(i, times100(d.value));
    const v = ivVolOfVol(cardX, session);
    if (v.reason) {
      zvov.miss(i, v.reason);
    } else {
      const floor = metricById("vol.iv.30d.zvov").baseline.floor.abs;
      const scale = Math.max(v.vov, floor);
      zvov.put(i, d.value / scale);
      zvov.baseline(i, v.changes, v.vov < floor);
      if (v.changes !== null && v.changes < LIMITS.baselineMin) zvov.miss(i, "warming");
    }
  }
  const nx = cardX && cardX.earnings && cardX.earnings.next;
  if (!cardX) conf.miss(i, "missing");
  else if (cardX.sessionDate !== session) conf.miss(i, "stale");
  else if (!nx || typeof nx.confirmed !== "boolean") conf.miss(i, "missing");
  else conf.put(i, nx.confirmed ? 1 : 0);
  if (!cardX) ratio.miss(i, "missing");
  else {
    const r = impliedRatio(cardX, session);
    if (r.reason) ratio.miss(i, r.reason);
    else ratio.put(i, r.value);
  }
}

function skewColumns(session, card, cardX, cols, i) {
  const rr = cols["vol.rr25.30d"];
  const x0 = cols["vol.rr25.30d.x0"];
  const f = engineFact(card, "skew.rr25.30", session);
  if (f.reason) rr.miss(i, f.reason);
  else rr.put(i, times100(f.value));
  if (!cardX) x0.miss(i, "missing");
  else if (cardX.sessionDate !== session) x0.miss(i, "stale");
  else {
    const c = skewCross(cardX, session);
    if (c.reason) x0.miss(i, c.reason);
    else x0.put(i, c.value);
  }
}

function sectorBlock(session, days, order, sectorOf, hists) {
  const names = [];
  for (const s of sectorOf) if (s !== null && !names.includes(s)) names.push(s);
  names.sort();
  const z = new Column("sector.net_premium.z20", names.length);
  const b = new Column("sector.breadth_pos", names.length);
  const members = new Array(names.length).fill(0);
  names.forEach((sector, k) => {
    const chosen = [];
    for (let j = 0; j < order.length; j++) {
      if (sectorOf[j] !== sector) continue;
      const h = hists[j];
      if (!h || h.asOf !== session || !finite(h.np.get(session))) continue;
      let have = 0;
      for (const d of days) if (finite(h.np.get(d))) have++;
      if (have >= SECTOR_SET_MIN_DAYS) chosen.push(h);
    }
    members[k] = chosen.length;
    if (chosen.length < LIMITS.minConstituents) {
      z.miss(k, "sector_coverage");
      b.miss(k, "sector_coverage");
      return;
    }
    const sum = (d) => {
      let total = 0;
      for (const h of chosen) {
        const v = h.np.get(d);
        if (!finite(v)) return null;
        total += v;
      }
      return total;
    };
    const baseline = new Map();
    for (const d of days) {
      const v = sum(d);
      if (v !== null) baseline.set(d, v);
    }
    const spec = metricById(z.id).baseline;
    robustColumn(z, k, { x: sum(session), series: baseline, days, floor: spec.floor, zSpace: spec.zSpace });
    const positive = chosen.filter((h) => h.np.get(session) > 0).length;
    b.put(k, positive / chosen.length);
  });
  return { names, columns: [z, b], members };
}

export function confirmCarry(carried, cardOf, session) {
  const rows = [];
  for (const w of carried && Array.isArray(carried.windows) ? carried.windows : []) {
    if (!w || typeof w.t !== "string" || typeof w.oc !== "string") continue;
    const card = cardOf(w.t);
    const panel = card && card.sessionDate === session && card.panels ? card.panels.oiDeltas : null;
    let share = null;
    if (panel && panel.status === "ok" && Array.isArray(panel.rows) && finite(w.size) && w.size > 0) {
      const hit = panel.rows.find((r) => r && r.oc === w.oc);
      if (hit && finite(hit.currOi) && finite(hit.prevOi)) share = Math.min(1, Math.max(0, hit.currOi - hit.prevOi) / w.size);
    }
    rows.push({ ...w, oic: share === null ? null : scaledInt(share, "ratio") });
  }
  return { rows, from: carried ? carried.from : null, reason: carried ? carried.reason : "missing" };
}

export function carryColumns(rows) {
  const out = { n: rows.length };
  for (const f of CARRY_FIELDS) out[f] = rows.map((r) => (r[f] === undefined ? null : r[f]));
  out.oic = rows.map((r) => (Number.isInteger(r.oic) ? r.oic : null));
  return out;
}

export function carryRows(block) {
  if (!block || typeof block !== "object" || !Number.isInteger(block.n)) return [];
  const rows = [];
  for (let i = 0; i < block.n; i++) {
    const row = {};
    for (const f of CARRY_FIELDS) row[f] = Array.isArray(block[f]) && block[f][i] !== undefined ? block[f][i] : null;
    row.oic = Array.isArray(block.oic) && Number.isInteger(block.oic[i]) ? block.oic[i] : null;
    rows.push(row);
  }
  return rows;
}

export function buildMetrics({ sessionDate, generatedAt, universe, histOf, cardXOf, cardOf, carried = null }) {
  if (!isDay(sessionDate)) throw new TypeError("ff-metrics: the session is a date");
  if (!universe || universe.status !== "ok" || !Array.isArray(universe.t) || !universe.t.length) {
    return { payload: null, reason: "universe_unavailable", stats: null };
  }
  const uIndex = new Map(universe.t.map((t, i) => [t, i]));
  const histCache = new Map();
  const cardXCache = new Map();
  const cardCache = new Map();
  const memo = (cache, fn, t) => {
    if (!cache.has(t)) cache.set(t, fn(t) || null);
    return cache.get(t);
  };
  const hist = (t) => memo(histCache, (x) => parseHist(histOf(x)), t);
  const cardX = (t) => memo(cardXCache, cardXOf, t);
  const card = (t) => memo(cardCache, cardOf, t);
  const carded = [];
  const rest = [];
  for (const t of universe.t) {
    const has = histOf(t) || cardXOf(t);
    (has ? carded : rest).push(t);
  }
  const order = [...carded, ...rest];
  const days = priorSessions(sessionDate, LIMITS.baselineWindow);
  const columns = NAME_SHIPPED.map((id) => new Column(id, order.length));
  const cols = Object.fromEntries(columns.map((c) => [c.id, c]));
  const hists = new Array(order.length).fill(null);
  const sectorOf = order.map((t) => {
    const u = uIndex.get(t);
    const k = universe.sec && Number.isInteger(universe.sec[u]) ? universe.sec[u] : null;
    return k !== null && universe.sectors && typeof universe.sectors[k] === "string" ? universe.sectors[k] : null;
  });
  order.forEach((t, i) => {
    const isCarded = i < carded.length;
    if (isCarded) hists[i] = histColumns(sessionDate, days, hist(t), cols, i);
    else {
      for (const id of ["flow.net_premium", "flow.net_premium.z20", "flow.volume.z20", "flow.pc_volume.z20"]) cols[id].miss(i, "not_carded");
    }
    const x = isCarded ? cardX(t) : null;
    earnColumns(sessionDate, universe, uIndex.has(t) ? uIndex.get(t) : -1, x, cols, i);
    skewColumns(sessionDate, isCarded ? card(t) : null, x, cols, i);
    if (!isCarded) {
      for (const id of ["vol.rr25.30d", "vol.rr25.30d.x0", "vol.iv.30d.zvov", "earn.confirmed", "earn.implied_ratio"]) {
        if (cols[id].vals[i] === null) cols[id].reasons[i] = "not_carded";
      }
    }
  });
  const sect = sectorBlock(sessionDate, days, order, sectorOf, hists);
  const names = encodeColumns(columns, order.length);
  const confirmed = confirmCarry(carried, (t) => cardOf(t), sessionDate);
  const sectors = sect.names.length
    ? {
      names: sect.names,
      of: sectorOf.map((x) => (x === null ? null : sect.names.indexOf(x))),
      members: sect.members,
      ...(() => {
        const e = encodeColumns(sect.columns, sect.names.length);
        return { cols: e.cols, n: e.n, f: e.f, why: e.why };
      })(),
    }
    : null;
  let rows = confirmed.rows;
  const build = () => ({
    v: FF_METRICS_VERSION,
    sessionDate,
    generatedAt,
    registryVersion: REGISTRY_VERSION,
    t: order,
    cols: names.cols,
    n: names.n,
    f: names.f,
    why: names.why,
    sectors,
    windows: { carry: { from: confirmed.from, reason: confirmed.reason, ...carryColumns(rows) }, carded: carded.length },
  });
  let payload = build();
  let bytes = JSON.stringify(payload).length;
  let cut = 0;
  while (bytes > FF_METRICS_CAP && rows.length) {
    const drop = Math.max(1, Math.ceil(rows.length / 10));
    rows = rows.slice(0, rows.length - drop);
    cut += drop;
    payload = build();
    bytes = JSON.stringify(payload).length;
  }
  if (bytes > FF_METRICS_CAP) throw new RangeError("ff-metrics is " + bytes + " bytes, over its " + FF_METRICS_CAP + " byte cap with no carried window left to shed");
  if (cut) payload.windows.cut = cut;
  const stats = {
    names: order.length, carded: carded.length, bytes, carry: rows.length, carryCut: cut,
    columns: Object.fromEntries(columns.map((c) => [c.id, c.vals.filter((v) => v !== null).length])),
    sectors: sect.names.length,
  };
  return { payload, reason: null, stats };
}

export async function requestRun({ url, token, session, cadence = "nightly", fetchImpl = fetch, timeoutMs = 15000 }) {
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "User-Agent": "anilkaya-flows-pipeline/1 (+https://github.com/anilkaya001/anilkaya.org)" },
    body: JSON.stringify({ cadence, session }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, body: text.slice(0, 240) };
}

export const SHIPPED_METRICS = SHIPPED;

export const NAME_METRICS = NAME_SHIPPED;

export const SECTOR_METRICS = SECTOR_SHIPPED;

