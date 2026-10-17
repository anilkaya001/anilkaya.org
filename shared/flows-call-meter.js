import { OPS } from "./flows-vendor-ops.js";

export const OTHER_OP = "other";

export const LATENCY_EDGES_MS = Object.freeze([50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600]);

export const CALL_CLASSES = Object.freeze(["2xx", "3xx", "4xx", "429", "5xx", "timeout", "network"]);

const ESCAPE = /[.*+?^$()|[\]\\]/g;

const MATCHERS = OPS.map((op, order) => ({
  id: op.id,
  order,
  wild: (op.path.match(/\{[a-z_]+\}/g) || []).length,
  re: new RegExp("^" + op.path.replace(ESCAPE, "\\$&").replace(/\{[a-z_]+\}/g, "[^/]+") + "$"),
})).sort((a, b) => a.wild - b.wild || a.order - b.order);

export function opIdOf(path) {
  const bare = String(path === null || path === undefined ? "" : path).split("?")[0].replace(/\/+$/, "");
  for (const m of MATCHERS) if (m.re.test(bare)) return m.id;
  return OTHER_OP;
}

export function classOf(status, kind) {
  if (kind === "timeout" || kind === "network") return kind;
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

export function createCallMeter({ maxOps = 128 } = {}) {
  const ops = new Map();
  const total = { n: 0, ms: 0, bytes: 0, bad: 0 };

  const entry = (id) => {
    let e = ops.get(id);
    if (!e) {
      if (id !== OTHER_OP && ops.size >= maxOps) return entry(OTHER_OP);
      e = { n: 0, ms: 0, maxMs: 0, bytes: 0, classes: {}, buckets: new Array(LATENCY_EDGES_MS.length + 1).fill(0) };
      ops.set(id, e);
    }
    return e;
  };

  return {
    record({ path, op, ms, bytes, status, kind } = {}) {
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
      return cls;
    },

    totals() {
      return { ...total };
    },

    snapshot() {
      const byOp = {};
      for (const [id, e] of ops) byOp[id] = { n: e.n, ms: e.ms, maxMs: e.maxMs, bytes: e.bytes, classes: { ...e.classes }, buckets: e.buckets.slice() };
      return { total: { ...total }, ops: byOp };
    },

    reset() {
      ops.clear();
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

export function summarize(snapshot, { top = 5 } = {}) {
  const ops = Object.entries((snapshot && snapshot.ops) || {}).map(([id, e]) => ({
    op: id, n: e.n, avgMs: e.n ? Math.round(e.ms / e.n) : 0, maxMs: e.maxMs, p95Ms: quantileMs(e.buckets, 0.95),
    kb: Math.round(e.bytes / 1024), bad: e.n - (e.classes["2xx"] || 0), classes: e.classes,
  }));
  ops.sort((a, b) => b.avgMs * b.n - a.avgMs * a.n || (a.op < b.op ? -1 : 1));
  const t = (snapshot && snapshot.total) || { n: 0, ms: 0, bytes: 0, bad: 0 };
  return { n: t.n, ms: t.ms, kb: Math.round(t.bytes / 1024), bad: t.bad, slowest: ops.slice(0, top) };
}

export function wireDelta(before, after) {
  const b = before || { n: 0, ms: 0, bytes: 0, bad: 0 };
  const a = after || b;
  return { n: a.n - b.n, ms: a.ms - b.ms, bytes: a.bytes - b.bytes, bad: a.bad - b.bad };
}
