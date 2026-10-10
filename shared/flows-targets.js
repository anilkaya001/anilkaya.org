export const TARGETS_VERSION = 1;

export const CLOCKS = Object.freeze({
  "sess-v0": Object.freeze({ id: "sess-v0", omegaW: 0 }),
});

export const CLOCK_DEFAULT = "sess-v0";

export const SIGMA_REF_WINDOW = 252;
export const SIGMA_REF_MIN = 200;
export const SIGMA_REF_SCALE = 1.4826;
export const SIGMA_REF_REL_SE = 0.1;
export const MAX_GAP_DAYS = 4;

export const QUANTILES = Object.freeze([0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.975, 0.99, 0.995]);

export const EMPIRICAL_SESSIONS = 252;
export const EMPIRICAL_FLOOR_N = 250;
export const SCAN_P_FLOOR = 0.00002;
export const WILSON_MIN_EVENTS = 5;

export const THRESHOLD_SOURCES = Object.freeze({
  sigma_ref: Object.freeze({ gradeCap: 3, label: "typical-day scale" }),
  sigma_q1: Object.freeze({ gradeCap: 3, label: "options-implied one-session scale" }),
  iv30_ex: Object.freeze({ gradeCap: 1, label: "from 30-day IV" }),
  fixed: Object.freeze({ gradeCap: 3, label: "fixed percent" }),
});

export const REFUSED_SOURCES = Object.freeze({
  implied_move_perc: "the vendor's implied_move_perc is a 0.85-straddle to the nearest Friday, a band of about 50%, and is never a one-day move or a threshold unit",
});

const freezeDeep = (x) => {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freezeDeep(v);
  }
  return x;
};

function buildTable() {
  const rows = [];
  const add = (row) => rows.push(row);
  for (const k of [2, 3, 4]) {
    for (const h of [1, 5]) {
      for (const dir of ["", "up", "dn"]) {
        add({
          id: `move.k${k}.h${h}${dir ? "." + dir : ""}`, kind: "event", family: "sigma-ref", unit: "indicator",
          scale: "sigma_ref", k, h, side: dir === "up" ? "up" : dir === "dn" ? "down" : "both", source: "sigma_ref",
          rule: dir === "up" ? "r >= k * sigmaRef * sqrt(hEff)" : dir === "dn" ? "r <= -k * sigmaRef * sqrt(hEff)" : "|r| >= k * sigmaRef * sqrt(hEff)",
        });
      }
    }
  }
  for (const k of [1, 1.5, 2]) {
    add({
      id: `move.im${k}.h1`, kind: "event", family: "sigma-q1", unit: "indicator", scale: "sigma_q1", k, h: 1, side: "both",
      source: "sigma_q1", fallback: "iv30_ex", rule: "|r| >= k * sigmaQ1, sigmaQ1 the event-inclusive one-session implied SD",
    });
  }
  for (const x of [5, 10, 20]) {
    for (const h of [1, 5]) {
      add({
        id: `move.x${x}.h${h}`, kind: "event", family: "percent", unit: "indicator", scale: "fixed", x, h, side: "both",
        source: "fixed", rule: "simple return up by x percent or down by x percent: r >= ln(1 + x/100) or r <= ln(1 - x/100)",
      });
    }
  }
  add({ id: "move.earn.im", kind: "event", family: "earnings", unit: "indicator", scale: "sigma_q1", h: 1, side: "both",
    source: "sigma_q1", rule: "|r_impact| >= sigmaQE, sigmaQE^2 = jumpQ^2 + diffQ^2 of the impact session" });
  add({ id: "move.earn.ratio", kind: "ratio", family: "earnings", unit: "ratio", scale: "none", h: 1, side: "both",
    source: "track", rule: "|m| / M within one track, vendor or platform, never mixed" });
  for (const h of [1, 5, 21]) {
    add({ id: `move.ret.h${h}`, kind: "quantiles", family: "return", unit: "log return", h, quantiles: QUANTILES,
      gradeCap: h === 21 ? 1 : 3, shown: h === 21 ? "more horizons" : "default" });
  }
  add({ id: "move.live.res", kind: "reading", family: "live", unit: "z", note: "a detection reading, never a registered target" });
  for (const h of [1, 5]) {
    add({ id: `move.z63.h${h}`, kind: "sensitivity", family: "z63", unit: "indicator", h, note: "sensitivity only, never shown to readers" });
  }
  return rows;
}

export const TARGETS = freezeDeep(buildTable());

export const TARGET_BY_ID = Object.freeze(Object.fromEntries(TARGETS.map((t) => [t.id, t])));

export const isTarget = (id) => typeof id === "string" && Object.hasOwn(TARGET_BY_ID, id);

export const targetFor = (id) => (isTarget(id) ? TARGET_BY_ID[id] : null);

export const factId = (id) => (isTarget(id) && id.startsWith("move.") ? "move.p." + id.slice("move.".length) : null);

export const EVENT_TARGETS = Object.freeze(TARGETS.filter((t) => t.kind === "event").map((t) => t.id));

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  for (const w of [hi, lo]) bytes.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export const digestOf = (table) => sha256Hex(canonical({
  clocks: CLOCKS, defaultClock: CLOCK_DEFAULT, window: SIGMA_REF_WINDOW, min: SIGMA_REF_MIN, scale: SIGMA_REF_SCALE,
  maxGapDays: MAX_GAP_DAYS, quantiles: QUANTILES, sources: THRESHOLD_SOURCES, refused: Object.keys(REFUSED_SOURCES),
  table,
}));

export const targetsHash = () => digestOf(TARGETS);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const digit = (d, i) => {
  const c = d.charCodeAt(i) - 48;
  return c >= 0 && c <= 9 ? c : NaN;
};

const MONTH_DAYS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

const dayNumber = (d) => {
  if (typeof d !== "string" || d.length !== 10 || d.charCodeAt(4) !== 45 || d.charCodeAt(7) !== 45) return NaN;
  const y = digit(d, 0) * 1000 + digit(d, 1) * 100 + digit(d, 2) * 10 + digit(d, 3);
  const m = digit(d, 5) * 10 + digit(d, 6);
  const dd = digit(d, 8) * 10 + digit(d, 9);
  if (!(m >= 1 && m <= 12) || !(dd >= 1)) return NaN;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (dd > (m === 2 && leap ? 29 : MONTH_DAYS[m - 1])) return NaN;
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + dd - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};

const dayString = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

const weekdayOf = (n) => (((n + 4) % 7) + 7) % 7;

const BEFORE_OPEN = /^(?:bmo|pre-?market|pre|before.?(?:the.?)?open|before market open)$/i;
const AFTER_CLOSE = /^(?:amc|post-?market|post|after.?(?:the.?)?close|after market close)$/i;

export function reportTiming(reportTime) {
  const t = typeof reportTime === "string" ? reportTime.trim() : "";
  if (BEFORE_OPEN.test(t)) return "before-open";
  if (AFTER_CLOSE.test(t)) return "after-close";
  return "unknown";
}

function nextSessionAfter(day, sessions) {
  const n = dayNumber(day);
  if (!Number.isFinite(n)) return null;
  if (Array.isArray(sessions) && sessions.length) {
    for (const s of sessions) if (typeof s === "string" && s > day) return s;
    return null;
  }
  let m = n + 1;
  while (weekdayOf(m) === 0 || weekdayOf(m) === 6) m++;
  return dayString(m);
}

function sessionOnOrAfter(day, sessions) {
  const n = dayNumber(day);
  if (!Number.isFinite(n)) return null;
  if (Array.isArray(sessions) && sessions.length) {
    for (const s of sessions) if (typeof s === "string" && s >= day) return s;
    return null;
  }
  let m = n;
  while (weekdayOf(m) === 0 || weekdayOf(m) === 6) m++;
  return dayString(m);
}

export function impactSession(reportDate, reportTime, sessions = null) {
  const timing = reportTiming(reportTime);
  if (!DAY_RE.test(String(reportDate))) return { sessions: [], timing, certain: false };
  const same = sessionOnOrAfter(reportDate, sessions);
  const next = nextSessionAfter(reportDate, sessions);
  if (timing === "before-open") return { sessions: same ? [same] : [], timing, certain: true };
  if (timing === "after-close") return { sessions: next ? [next] : [], timing, certain: true };
  return { sessions: [...new Set([same, next].filter(Boolean))], timing, certain: false };
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export function madScale(values) {
  const sorted = Float64Array.from(values.every(Number.isFinite) ? values : values.filter(Number.isFinite)).sort();
  if (!sorted.length) return null;
  const m = median(sorted);
  const dev = new Float64Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) dev[i] = Math.abs(sorted[i] - m);
  return SIGMA_REF_SCALE * median(dev.sort());
}

export function sigmaRef(bars, {
  splits = [], breaks = [], reports = [], eventSessions = null, clock = CLOCK_DEFAULT,
  window = SIGMA_REF_WINDOW, min = SIGMA_REF_MIN, keep = false,
} = {}) {
  const clockDef = CLOCKS[clock];
  const base = { id: "sigma_ref", clock, omegaW: clockDef ? clockDef.omegaW : null, window, min, relSE: SIGMA_REF_REL_SE };
  if (!clockDef) return { ...base, ok: false, sigmaRef: null, n: 0, reason: "clock", excluded: null };
  let list = [];
  let numbers = [];
  let ordered = true;
  for (const b of Array.isArray(bars) ? bars : []) {
    if (!b) continue;
    const n = dayNumber(b.d);
    if (!Number.isFinite(n)) continue;
    if (numbers.length && n < numbers[numbers.length - 1]) ordered = false;
    list.push(b);
    numbers.push(n);
  }
  if (!ordered) {
    const idx = list.map((_, i) => i).sort((a, b) => numbers[a] - numbers[b]);
    list = idx.map((i) => list[i]);
    numbers = idx.map((i) => numbers[i]);
  }
  const dates = list.map((b) => b.d);
  const splitList = (Array.isArray(splits) ? splits : []).filter((x) => x && Number.isFinite(dayNumber(x.d)) && Number(x.ratio) > 0);
  const closes = list.map((b) => {
    let c = Number(b.c);
    for (const x of splitList) if (b.d < x.d) c /= Number(x.ratio);
    return c;
  });
  const breakDays = new Set(Array.isArray(breaks) ? breaks : []);
  const events = new Set(Array.isArray(eventSessions) ? eventSessions : []);
  const uncertainDays = new Set();
  for (const r of Array.isArray(reports) ? reports : []) {
    const hit = impactSession(r && r.date, r && r.time, dates);
    for (const s of hit.sessions) events.add(s);
    if (!hit.certain) for (const s of hit.sessions) uncertainDays.add(s);
  }
  const first = Math.max(1, list.length - window);
  const excluded = { event: 0, split: 0, break: 0, gap: 0, invalid: 0 };
  const kept = [];
  const omega = clockDef.omegaW;
  for (let i = first; i < list.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (!(a > 0) || !(b > 0) || a === Infinity || b === Infinity) { excluded.invalid++; continue; }
    const prev = list[i - 1];
    const here = list[i];
    if (here.brk === true || prev.brk === true || (breakDays.size && (breakDays.has(here.d) || breakDays.has(prev.d)))) { excluded.break++; continue; }
    const gapDays = numbers[i] - numbers[i - 1];
    if (!(gapDays >= 1) || gapDays > MAX_GAP_DAYS) { excluded.gap++; continue; }
    if (here.split === true || prev.split === true) { excluded.split++; continue; }
    if (events.size && events.has(here.d)) { excluded.event++; continue; }
    const r = Math.log(b / a);
    kept.push(omega === 0 ? r : r / Math.sqrt(1 + (gapDays - 1) * omega));
  }
  const n = kept.length;
  const common = { ...base, n, sessions: list.length - first, excluded, uncertainEvents: uncertainDays.size, ...(keep ? { returns: kept } : {}) };
  if (n < min) return { ...common, ok: false, sigmaRef: null, reason: "history" };
  const s = madScale(kept);
  if (!(s > 0)) return { ...common, ok: false, sigmaRef: null, reason: "degenerate" };
  return { ...common, ok: true, sigmaRef: s, reason: null };
}

export const cardField = (result) => (result && result.ok
  ? { s: Math.round(result.sigmaRef * 1e5) / 1e5, n: result.n, k: result.clock }
  : null);

export function tallyReasons(results) {
  const out = { forecast: 0, notForecast: {} };
  for (const r of Array.isArray(results) ? results : []) {
    if (r && r.ok) out.forecast++;
    else {
      const why = r && r.reason ? r.reason : "unknown";
      out.notForecast[why] = (out.notForecast[why] || 0) + 1;
    }
  }
  return out;
}

export const hEff = (h, nW = 0, omegaW = 0) => h + nW * omegaW;

export function acceptSource(source) {
  if (typeof source === "string" && Object.hasOwn(REFUSED_SOURCES, source)) return { ok: false, reason: REFUSED_SOURCES[source] };
  if (typeof source === "string" && Object.hasOwn(THRESHOLD_SOURCES, source)) return { ok: true, reason: null, ...THRESHOLD_SOURCES[source] };
  return { ok: false, reason: "unknown threshold source" };
}

export function threshold(id, ctx = {}) {
  const def = targetFor(id);
  if (!def || def.kind !== "event") return { ok: false, reason: "not an event target" };
  const source = ctx.source === undefined ? def.source : ctx.source;
  const accepted = acceptSource(source);
  if (!accepted.ok) return { ok: false, reason: accepted.reason };
  if (def.scale === "fixed") {
    const up = Math.log(1 + def.x / 100);
    const down = Math.log(1 - def.x / 100);
    return { ok: true, up, down, source, grade: accepted.gradeCap };
  }
  const unit = def.scale === "sigma_ref" ? ctx.sigmaRef : ctx.sigmaQ1;
  if (!Number.isFinite(unit) || !(unit > 0)) return { ok: false, reason: "no scale" };
  const h = def.scale === "sigma_ref" ? hEff(def.h, ctx.nW || 0, ctx.omegaW || 0) : 1;
  const edge = def.k * unit * Math.sqrt(h);
  const fallback = source === "iv30_ex" ? THRESHOLD_SOURCES.iv30_ex : null;
  return { ok: true, up: edge, down: -edge, source, grade: fallback ? fallback.gradeCap : accepted.gradeCap, label: fallback ? fallback.label : null };
}

export function resolves(id, r, ctx = {}) {
  const def = targetFor(id);
  if (!def || def.kind !== "event" || !Number.isFinite(r)) return null;
  const t = threshold(id, ctx);
  if (!t.ok) return null;
  const up = r >= t.up;
  const down = r <= t.down;
  if (def.side === "up") return up ? 1 : 0;
  if (def.side === "down") return down ? 1 : 0;
  return up || down ? 1 : 0;
}

export function earnRatio({ m, M, track } = {}) {
  if (track !== "vendor" && track !== "platform") return null;
  if (!Number.isFinite(m) || !Number.isFinite(M) || !(M > 0)) return null;
  return Math.abs(m) / M;
}

export function validateRecord(record) {
  const r = record && typeof record === "object" ? record : {};
  if (!isTarget(r.target)) return { ok: false, reason: "unregistered target" };
  const def = TARGET_BY_ID[r.target];
  if (def.kind === "reading" || def.kind === "sensitivity") return { ok: false, reason: def.note };
  if (r.source !== undefined) {
    const accepted = acceptSource(r.source);
    if (!accepted.ok) return { ok: false, reason: accepted.reason };
  }
  if (def.kind === "event" && typeof r.clock === "string" && !Object.hasOwn(CLOCKS, r.clock)) return { ok: false, reason: "unknown clock version" };
  return { ok: true, reason: null };
}

export function wilson(hits, n, z = 1.96) {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n <= 0 || hits < 0 || hits > n) return null;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (c - h) / d), hi: Math.min(1, (c + h) / d) };
}

const oneIn = (p) => Math.max(1, Math.round(1 / p));

function pctText(x) {
  return (x * 100).toFixed(x * 100 >= 10 ? 0 : 1) + "%";
}

function multipleText(k) {
  return `a ${Number.isInteger(k) ? k : k.toFixed(1)}x typical-day move`;
}

export function frequencyText({ route, hits, sessions = EMPIRICAL_SESSIONS, p, rung = null, pFloor = null } = {}) {
  if (route === "empirical") {
    if (!Number.isFinite(hits) || !Number.isFinite(sessions) || sessions < EMPIRICAL_SESSIONS || hits < 0 || hits > sessions) return null;
    const w = wilson(hits, sessions);
    const n = hits > 0 ? 1 / (hits / sessions) : Infinity;
    if (n > EMPIRICAL_FLOOR_N) {
      const upper = 1 - Math.pow(0.05, 1 / sessions);
      return hits === 0
        ? `rarer than 1 in ${EMPIRICAL_FLOOR_N} sessions for this name over the last year, and fewer than 1 in ${Math.floor(1 / upper / 10) * 10} at 95%`
        : `rarer than 1 in ${EMPIRICAL_FLOOR_N} sessions for this name over the last year`;
    }
    const core = `about 1 in ${oneIn(hits / sessions)} sessions for this name over the last year`;
    if (hits >= WILSON_MIN_EVENTS) return `${core} (95% interval 1 in ${oneIn(w.hi)} to 1 in ${oneIn(w.lo)})`;
    return core;
  }
  if (route === "model") {
    if (!(Number.isFinite(p) && p > 0 && p < 1) || !(Number.isFinite(pFloor) && pFloor > 0)) return null;
    const label = rung ? `, model, rung ${rung}` : ", model";
    if (p < pFloor) return `rarer than the audited limit of 1 in ${Math.floor(1 / pFloor)} sessions${label}`;
    return `about 1 in ${oneIn(p)} sessions${label}`;
  }
  return null;
}

export function rarityText({ k, sigmaRef: s, ...freq } = {}) {
  if (!(Number.isFinite(k) && k > 0) || !(Number.isFinite(s) && s > 0)) return null;
  const how = frequencyText(freq);
  if (how === null) return null;
  return `${multipleText(k)}: typical day ${pctText(s)}; ${how}`;
}

export function scanPText(p) {
  if (!(Number.isFinite(p) && p >= 0)) return null;
  if (p < SCAN_P_FLOOR) return "p below 0.00002";
  return "p " + (p < 0.001 ? p.toExponential(1) : p.toPrecision(2));
}
