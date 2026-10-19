import { OPS } from "./flows-vendor-ops.js";

export const OTHER_OP = "other";

export const LATENCY_EDGES_MS = Object.freeze([50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600]);

export const CALL_CLASSES = Object.freeze(["2xx", "3xx", "4xx", "429", "5xx", "timeout", "network"]);

export const FAIL_SAMPLES = 3;

export const FAIL_CODES_MAX = 8;

export const FAILS_MAX_OPS = 12;

export const FAILS_BUDGET_BYTES = 2048;

export const SHAPES = Object.freeze(["plain", "list", "dot", "slash", "digit", "long", "other"]);

const ESCAPE = /[.*+?^$()|[\]\\]/g;

const MATCHERS = OPS.map((op, order) => ({
  id: op.id,
  order,
  wild: (op.path.match(/\{[a-z_]+\}/g) || []).length,
  slot: op.path.split("/").indexOf("{ticker}"),
  re: new RegExp("^" + op.path.replace(ESCAPE, "\\$&").replace(/\{[a-z_]+\}/g, "[^/]+") + "$"),
})).sort((a, b) => a.wild - b.wild || a.order - b.order);

const bareOf = (path) => String(path === null || path === undefined ? "" : path).split("?")[0].replace(/\/+$/, "");

const matcherOf = (bare) => {
  for (const m of MATCHERS) if (m.re.test(bare)) return m;
  return null;
};

export function opIdOf(path) {
  const m = matcherOf(bareOf(path));
  return m ? m.id : OTHER_OP;
}

export function tickerOf(path, params) {
  const p = params && typeof params === "object" ? params : {};
  for (const k of ["ticker_symbol", "ticker", "tickers"]) {
    const v = p[k];
    if (Array.isArray(v) && v.length) return v.join(",");
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  const bare = bareOf(path);
  const m = matcherOf(bare);
  if (!m || m.slot < 0) return null;
  const seg = bare.split("/")[m.slot];
  try {
    return seg ? decodeURIComponent(seg) : null;
  } catch {
    return null;
  }
}

export function shapeOf(ticker) {
  if (ticker === null || ticker === undefined) return null;
  const t = String(ticker).trim().toUpperCase();
  if (!t) return null;
  if (t.includes(",")) return "list";
  if (/^[A-Z]{1,5}$/.test(t)) return "plain";
  if (/^[A-Z]+\.[A-Z]+$/.test(t)) return "dot";
  if (t.includes("/")) return "slash";
  if (/\d/.test(t)) return "digit";
  if (/^[A-Z]{6,}$/.test(t)) return "long";
  return "other";
}

export function pageOf(params) {
  const p = params && typeof params === "object" ? params : {};
  for (const k of ["offset", "page"]) {
    const v = Number(p[k]);
    if (p[k] !== undefined && p[k] !== null && p[k] !== "" && Number.isSafeInteger(v) && v >= 0) return v;
  }
  return 0;
}

export function codeOf(status, kind) {
  if (kind === "timeout" || kind === "network" || kind === "parse") return kind;
  const s = Number(status);
  if (!Number.isInteger(s) || s < 100) return "network";
  return String(s);
}

export function classOf(status, kind) {
  if (kind === "timeout" || kind === "network") return kind;
  if (kind === "parse") return "network";
  const s = Number(status);
  if (!Number.isInteger(s) || s < 100) return "network";
  if (s === 429) return "429";
  if (s >= 500) return "5xx";
  if (s >= 400) return "4xx";
  if (s >= 300) return "3xx";
  return "2xx";
}

const bucketOf = (ms) => {
  for (let i = 0; i < LATENCY_EDGES_MS.length; i++) if (ms <= LATENCY_EDGES_MS[i]) return i;
  return LATENCY_EDGES_MS.length;
};

const finite = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

const noteOf = (note) => {
  const out = {};
  if (!note || typeof note !== "object") return out;
  if (SHAPES.includes(note.t)) out.t = note.t;
  for (const k of ["pg", "a"]) {
    const v = Number(note[k]);
    if (note[k] !== undefined && note[k] !== null && Number.isSafeInteger(v) && v >= 0) out[k] = v;
  }
  return out;
};

export function createCallMeter({ maxOps = 128 } = {}) {
  const ops = new Map();
  const total = { n: 0, ms: 0, bytes: 0, bad: 0 };
  const failed = new Map();

  const entry = (id) => {
    let e = ops.get(id);
    if (!e) {
      if (id !== OTHER_OP && ops.size >= maxOps) return entry(OTHER_OP);
      e = { id, n: 0, ms: 0, maxMs: 0, bytes: 0, classes: {}, codes: {}, first: [], buckets: new Array(LATENCY_EDGES_MS.length + 1).fill(0) };
      ops.set(id, e);
    }
    return e;
  };

  return {
    record({ path, op, ms, bytes, status, kind, note } = {}) {
      const id = op || opIdOf(path);
      const e = entry(id);
      const took = finite(ms) === null ? 0 : Math.round(finite(ms));
      const size = finite(bytes) === null ? 0 : Math.round(finite(bytes));
      const cls = classOf(status, kind);
      e.n++;
      e.ms += took;
      e.maxMs = Math.max(e.maxMs, took);
      e.bytes += size;
      e.classes[cls] = (e.classes[cls] || 0) + 1;
      e.buckets[bucketOf(took)]++;
      total.n++;
      total.ms += took;
      total.bytes += size;
      if (cls !== "2xx") total.bad++;
      if (cls === "2xx") return cls;
      const code = codeOf(status, kind);
      const key = code in e.codes || Object.keys(e.codes).length < FAIL_CODES_MAX ? code : OTHER_OP;
      e.codes[key] = (e.codes[key] || 0) + 1;
      if (e.first.length < FAIL_SAMPLES) e.first.push({ code, ms: took, ...noteOf(note) });
      const line = e.id + " " + key;
      failed.set(line, (failed.get(line) || 0) + 1);
      return cls;
    },

    totals() {
      return { ...total };
    },

    fails() {
      return Object.fromEntries(failed);
    },

    snapshot() {
      const byOp = {};
      for (const [id, e] of ops) {
        byOp[id] = { n: e.n, ms: e.ms, maxMs: e.maxMs, bytes: e.bytes, classes: { ...e.classes }, codes: { ...e.codes }, first: e.first.map((f) => ({ ...f })), buckets: e.buckets.slice() };
      }
      return { total: { ...total }, ops: byOp };
    },

    reset() {
      ops.clear();
      failed.clear();
      total.n = total.ms = total.bytes = total.bad = 0;
    },
  };
}

export function quantileMs(buckets, q) {
  const n = buckets.reduce((a, b) => a + b, 0);
  if (!n) return null;
  const want = Math.max(1, Math.ceil(q * n));
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    seen += buckets[i];
    if (seen >= want) return i < LATENCY_EDGES_MS.length ? LATENCY_EDGES_MS[i] : null;
  }
  return null;
}

const sizeOf = (v) => JSON.stringify(v).length;

export function fitFails(list, { maxOps = FAILS_MAX_OPS, budgetBytes = FAILS_BUDGET_BYTES } = {}) {
  const kept = list.slice(0, maxOps).map((f) => ({ ...f, codes: { ...f.codes }, first: f.first.map((x) => ({ ...x })) }));
  while (kept.length && sizeOf(kept) > budgetBytes) {
    let i = kept.length - 1;
    while (i >= 0 && !kept[i].first.length) i--;
    if (i >= 0) kept[i].first.pop();
    else kept.pop();
  }
  return { fails: kept, omitted: list.length - kept.length };
}

export function summarize(snapshot, { top = 5 } = {}) {
  const ops = Object.entries((snapshot && snapshot.ops) || {}).map(([id, e]) => ({
    op: id, n: e.n, avgMs: e.n ? Math.round(e.ms / e.n) : 0, maxMs: e.maxMs, p95Ms: quantileMs(e.buckets, 0.95),
    kb: Math.round(e.bytes / 1024), bad: e.n - (e.classes["2xx"] || 0), classes: e.classes,
  }));
  ops.sort((a, b) => b.avgMs * b.n - a.avgMs * a.n || (a.op < b.op ? -1 : 1));
  const t = (snapshot && snapshot.total) || { n: 0, ms: 0, bytes: 0, bad: 0 };
  const mix = ops.map((o) => ({ op: o.op, n: o.n, bad: o.bad })).sort((a, b) => b.n - a.n || (a.op < b.op ? -1 : 1)).slice(0, 8);
  const failing = Object.entries((snapshot && snapshot.ops) || {})
    .map(([id, e]) => ({ op: id, n: e.n, bad: e.n - ((e.classes || {})["2xx"] || 0), codes: { ...(e.codes || {}) }, first: (e.first || []).map((f) => ({ ...f })) }))
    .filter((f) => f.bad > 0)
    .sort((a, b) => b.bad - a.bad || (a.op < b.op ? -1 : 1));
  const fit = fitFails(failing);
  return {
    n: t.n, ms: t.ms, kb: Math.round(t.bytes / 1024), bad: t.bad, slowest: ops.slice(0, top), mix,
    fails: fit.fails, ...(fit.omitted ? { failsOmitted: fit.omitted } : {}),
  };
}

export function wireDelta(before, after) {
  const b = before || { n: 0, ms: 0, bytes: 0, bad: 0 };
  const a = after || b;
  return { n: a.n - b.n, ms: a.ms - b.ms, bytes: a.bytes - b.bytes, bad: a.bad - b.bad };
}

export function failsDelta(before, after) {
  const b = before || {};
  const out = [];
  for (const [line, n] of Object.entries(after || {})) {
    const d = n - (b[line] || 0);
    if (d > 0) out.push([line, d]);
  }
  return out.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}

export function failLine(delta) {
  return (delta || []).map(([line, n]) => `${line}: ${n}`).join(", ");
}
