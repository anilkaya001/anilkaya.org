import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../../shared/flows-auth.js";
import { FIXTURE_ROSTER } from "./fixture-roster.mjs";

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

export const SESSION_SECRET = "sc-world-session-secret-abcdefghijklmnopqrstuvwxyz";

const emptyD1 = {
  prepare() { const st = { bind: () => st, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return st; },
  batch: async (list) => list.map(() => ({ results: [] })),
};

export const token = await signFlowsSession(FIXTURE_ROSTER[0], SESSION_SECRET, 3600, sessionEpoch({ SESSION_SECRET }));

export const envFor = (extra = {}) => ({
  DB: emptyD1, SESSION_SECRET, UW_API_KEY: "test-key", UW_BASE: "http://uw.test",
  FLOWS_CREDENTIALS: JSON.stringify({ [FIXTURE_ROSTER[0]]: "x".repeat(43) }), ...extra,
});

export function chainWorld(chain, { pageSize = 500, bars = null, state = null, info = null, refuseAfter = null, onChainCall = null } = {}) {
  const day = chain.asOf;
  const barRows = bars || [
    { date: day, market_time: "r", close: chain.spot.toFixed(2) },
    { date: day, market_time: "po", close: chain.spot.toFixed(2) },
  ];
  const tape = new Date(chain.readMs - 60000).toISOString();
  const stateRow = state || { data: { close: chain.spot.toFixed(2), prev_close: (chain.spot * 0.99).toFixed(2), market_time: "regular", tape_time: tape } };
  const infoRow = info || { data: { next_earnings_date: "2027-06-30", announce_time: "premarket", issue_type: "Common Stock" } };
  const calls = [];
  const world = (url) => {
    if (url.pathname.endsWith("/option-contracts")) {
      const page = Number(url.searchParams.get("page") || 1);
      calls.push({ kind: "chain", page, params: Object.fromEntries(url.searchParams) });
      if (onChainCall) onChainCall(page);
      const from = (page - 1) * pageSize;
      return { data: chain.rows.slice(from, from + pageSize) };
    }
    if (url.pathname.includes("/ohlc/")) { calls.push({ kind: "ohlc" }); return { data: barRows }; }
    if (url.pathname.endsWith("/stock-state")) { calls.push({ kind: "state" }); return stateRow; }
    if (url.pathname.endsWith("/info")) { calls.push({ kind: "info" }); return infoRow; }
    return undefined;
  };
  return { world, calls };
}

const realFetch = globalThis.fetch;

export async function route(worker, path, world, envExtra = {}) {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.href || input.url);
    const ticker = (url.pathname.match(/\/api\/stock\/([^/]+)\//) || [])[1];
    const body = world(url, ticker ? decodeURIComponent(ticker) : "");
    if (body === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const req = new Request("https://sc-world.test" + path, { headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } });
    const pending = [];
    const res = await worker.fetch(req, envFor(envExtra), { waitUntil(p) { pending.push(p); } });
    const text = await res.text();
    await Promise.allSettled(pending);
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { res, body, bytes: text.length };
  } finally { globalThis.fetch = realFetch; }
}
