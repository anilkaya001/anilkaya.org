import { OPS } from "../../shared/flows-vendor-ops.js";

export const ORIGIN = "http://sim.vendor.test";

const parts = (p) => p.split("/").filter(Boolean);

export function truthOp(pathname) {
  const want = parts(pathname);
  let best = null;
  for (const op of OPS) {
    const have = parts(op.path);
    if (have.length !== want.length) continue;
    let literal = 0;
    let fits = true;
    for (let i = 0; i < have.length; i++) {
      if (/^\{[a-z_]+\}$/.test(have[i])) continue;
      if (have[i] !== want[i]) { fits = false; break; }
      literal++;
    }
    if (fits && (best === null || literal > best.literal)) best = { id: op.id, literal };
  }
  return best ? best.id : "other";
}

export const fault = Object.freeze({
  ok: (rows = 3) => ({ kind: "ok", rows }),
  empty: () => ({ kind: "empty" }),
  http: (status) => ({ kind: "http", status }),
  rate: (retryAfter = 1) => ({ kind: "rate", retryAfter }),
  stall: () => ({ kind: "stall" }),
  slow: (ms) => ({ kind: "slow", ms }),
  malformed: () => ({ kind: "malformed" }),
});

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ i, v: 1 + i }));

export function classOfFault(f, deadlineMs) {
  switch (f.kind) {
    case "ok":
    case "empty": return "2xx";
    case "slow": return f.ms >= deadlineMs ? "timeout" : "2xx";
    case "http": return f.status >= 500 ? "5xx" : f.status === 429 ? "429" : "4xx";
    case "rate": return "429";
    case "stall": return "timeout";
    case "malformed": return "network";
    default: return "network";
  }
}

export function codeOfFault(f, deadlineMs) {
  switch (f.kind) {
    case "ok":
    case "empty": return null;
    case "slow": return f.ms >= deadlineMs ? "timeout" : null;
    case "http": return String(f.status);
    case "rate": return "429";
    case "stall": return "timeout";
    case "malformed": return "parse";
    default: return "network";
  }
}

export function createVendor({ time, scripts }) {
  const requests = [];
  const seen = new Map();

  const respond = (f) => {
    const json = { "Content-Type": "application/json" };
    switch (f.kind) {
      case "ok": { const body = JSON.stringify({ data: rowsOf(f.rows) }); return new Response(body, { status: 200, headers: { ...json, "Content-Length": String(body.length) } }); }
      case "slow": { const body = JSON.stringify({ data: rowsOf(1) }); return new Response(body, { status: 200, headers: { ...json, "Content-Length": String(body.length) } }); }
      case "empty": { const body = JSON.stringify({ data: [] }); return new Response(body, { status: 200, headers: { ...json, "Content-Length": String(body.length) } }); }
      case "http": return new Response("{}", { status: f.status, headers: json });
      case "rate": return new Response("{}", { status: 429, headers: { ...json, "Retry-After": String(f.retryAfter) } });
      case "malformed": return new Response("<html>not json</html>", { status: 200, headers: json });
      default: throw new Error("the simulator has no response for " + f.kind);
    }
  };

  const fetchFake = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== ORIGIN) throw new Error("the simulator refuses a request to " + url.origin);
    const script = scripts.get(url.pathname) || [fault.ok(1)];
    const n = seen.get(url.pathname) || 0;
    seen.set(url.pathname, n + 1);
    const f = script[Math.min(n, script.length - 1)];
    const signal = init.signal || null;
    const op = truthOp(url.pathname);
    const long = op === "option-contracts" || (op === "ohlc-1d" && url.searchParams.get("timeframe") === "2Y");
    const record = { at: time.now(), path: url.pathname, op, n, fault: f, deadline: long ? 45000 : 30000 };
    requests.push(record);
    if (signal && signal.aborted) throw signal.reason;
    if (f.kind === "stall") {
      return new Promise((resolve, reject) => {
        if (signal) signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (f.kind === "slow") {
      return new Promise((resolve, reject) => {
        const id = time.set(() => resolve(respond(f)), f.ms);
        if (signal) signal.addEventListener("abort", () => { time.clear(id); reject(signal.reason); }, { once: true });
      });
    }
    return respond(f);
  };

  return {
    fetch: fetchFake,
    requests,
    attemptsOn: (pathname) => seen.get(pathname) || 0,
    codes() {
      const out = {};
      for (const r of requests) {
        const code = codeOfFault(r.fault, r.deadline);
        if (code === null) continue;
        out[r.op] = out[r.op] || {};
        out[r.op][code] = (out[r.op][code] || 0) + 1;
      }
      return out;
    },
    classes() {
      const out = {};
      for (const r of requests) {
        const cls = classOfFault(r.fault, r.deadline);
        out[r.op] = out[r.op] || {};
        out[r.op][cls] = (out[r.op][cls] || 0) + 1;
      }
      return out;
    },
  };
}
