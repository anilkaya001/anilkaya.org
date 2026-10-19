import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { opsBody } from "../../server/ops.js";
import { LIVE_KEYS } from "../../shared/flows-live.js";
import * as PAGES from "../../shared/flows-pages.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const NOW = Date.parse("2026-10-12T18:41:07Z");
export const DAY = "2026-10-12";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };

const lag = (n, p50, p95, max) => ({ n, p50, p95, max });
const lag90 = (n, p50, p90, max) => ({ n, p50, p90, max });
const topic = (o) => ({
  sq: 400, demanded: true, hasData: true, held: 157, frames: 400, bytes: 900000, polls: 400, lastFrameAt: NOW - 2100, lastFrameAgeMs: 2100,
  lastOkAt: NOW - 2100, fails: 0, lastError: null, emptyFrames: 30, lagMs: lag(0, null, null, null), rowLagMs: null, rttMs: lag(0, null, null, null), itemLagMs: null, ...o,
});

export const RAIL = {
  running: true, ep: NOW - 3 * 36e5, startedAt: NOW - 3 * 36e5, session: DAY, now: NOW, unobservedMs: 0,
  phase: { phase: "rth", trading: true, day: DAY },
  upstream: {
    kind: "composite", asked: "socket", pausedUntil: null, n429: 0, vendor: { at: NOW - 4000, daily: 21400, minuteRemaining: 1000000, minuteResetMs: 60000, tokenLimit: null },
    topics: { px: { via: "socket" }, fl: { via: "socket" }, mk: { via: "rest" }, nw: { via: "socket" }, gx: { via: "socket" } },
    socket: {
      running: true, connected: true, connecting: false, host: "api.unusualwhales.com", hours: "session", since: NOW - 3 * 36e5, channels: 11, joined: 11, acked: 10,
      refused: { "gex:AMD": "refused" }, lastMsgAt: NOW - 120, retryAt: null, failures: 0, lastError: null, messages: 412000, bytes: 88000000, reconnects: 1, frames: 9000,
    },
  },
  sockets: { n: 3, byUser: { anilkaya: 2, member2: 1 }, userCap: 3, max: 40 },
  calls: { minuteTotal: 26, perMinute: 240 }, degraded: null,
  killSwitches: { FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "members", FLOWS_RT_UPSTREAM: "socket" },
  topics: {
    px: topic({ lagMs: lag(256, 1800, 4900, 9100), rowLagMs: lag(256, 2600, 41000, 190000), rttMs: lag(256, 610, 1400, 3900), calls: { minute: 12, hour: 720 },
      time: { demandedMs: 108e5, liveMs: 104e5, vendorLagMs: 3e5, oursMs: 1e5 }, window: { klass: "rt", liveMs: 15000, staleMs: 60000 }, fresh: { state: "live" } }),
    fl: topic({ itemLagMs: lag(180, 2300, 7400, 15000), rttMs: lag(256, 520, 1100, 2400), calls: { minute: 0, hour: 0 },
      time: { demandedMs: 108e5, liveMs: 106e5, vendorLagMs: 0, oursMs: 2e5 }, window: { klass: "rt", liveMs: 15000, staleMs: 60000 }, fresh: { state: "live" } }),
    gx: topic({ lagMs: lag(40, 21000, 50000, 61000), calls: { minute: 4, hour: 240 },
      time: { demandedMs: 5e6, liveMs: 4.8e6, vendorLagMs: 2e5, oursMs: 0 }, window: { klass: "rtSlow", liveMs: 90000, staleMs: 180000 }, fresh: { state: "live" } }),
    mk: topic({ lagMs: lag(256, 31000, 58000, 70000), rttMs: lag(256, 700, 1500, 3000), calls: { minute: 6, hour: 360 },
      time: { demandedMs: 108e5, liveMs: 1e7, vendorLagMs: 8e5, oursMs: 0 }, window: { klass: "rtSlow", liveMs: 330000, staleMs: 420000 }, fresh: { state: "live" } }),
    nw: topic({ itemLagMs: lag(30, 40000, 210000, 600000), calls: { minute: 2, hour: 120 },
      time: { demandedMs: 108e5, liveMs: 108e5, vendorLagMs: 0, oursMs: 0 }, window: { klass: "rtNews", liveMs: 75000, staleMs: 300000 }, fresh: { state: "live" } }),
  },
};

export const META = {
  generatedAt: "2026-10-12T00:30:00.000Z", sessionDate: "2026-10-09", universe: 670, cardsBuilt: 500, cardsFailed: 2, cardsSkipped: 8, apiCalls: 4100,
  health: { failures: 1, warnings: 2, first: ["cards: 2 failed"] },
  vendor: { n: 24100, ms: 9e6, kb: 90000, bad: 40, slowest: [], mix: [{ op: "option-contracts", n: 9800, bad: 12 }, { op: "ohlc-1d", n: 5200, bad: 3 }, { op: "flow-per-strike", n: 3100, bad: 0 }, { op: "stock-state", n: 1500, bad: 25 }] },
  callStats: { retries: 14, rateLimited: 2, failures: 1, timedOut: 0, networkMs: 810000, permitWaitMs: 12000, rateLimitWaitMs: 3000 },
  stages: [
    { id: "universe", status: "ok", ms: 4200, calls: 12, keys: 1, cpu: 900 },
    { id: "roster", status: "failed", ms: 900, calls: 3, keys: 0, why: "vendor 5xx", cpu: 120 },
  ],
};

export const SPEND = {
  spend: {
    day: DAY, calls: 268, tokensIn: 1200000, tokensOut: 140000, allowanceNeurons: 10000, neurons: 14900, remaining: 0, assumesSoleSpender: true,
    byModel: [{ model: "@cf/zai-org/glm-4.7-flash", calls: 262, tokensIn: 1180000, tokensOut: 138000, neurons: 11500 }, { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", calls: 6, tokensIn: 20000, tokensOut: 2000, neurons: 943 }],
  },
  cap: { neurons: 30000, calls: 2500, readShare: 0.75, readsStopAt: 22500, allowanceNeurons: 10000 },
};

export const READY = { ok: true, phase: "rth", minutesToOpen: null, opens: { ms: Date.parse("2026-10-12T13:30:00Z") }, blockers: [] };

const iso = (ms) => new Date(ms).toISOString();
export const HEARTBEAT = {
  v: 1, key: "live:heartbeat", session: DAY,
  fresh: { v: 1, readAt: iso(NOW - 240000), vendorAt: null, source: "actions", cadenceS: 900, session: DAY, writer: "actions@live" },
  run: {
    origin: "schedule", startedAt: iso(NOW - 300000), finishedAt: iso(NOW - 240000), durationMs: 60000, calls: 44, failedCalls: 1, keys: {}, errors: [], notes: [],
    names: 157, quoteLag: lag90(157, 4, 11, 120), quoteAhead: { n: 0, maxS: 0 },
  },
};

const T = (hh, mm) => iso(Date.parse(DAY + "T" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":00Z"));
const times = [[13, 31], [13, 46], [14, 1], [14, 16], [14, 31], [14, 46], [15, 1], [15, 16], [15, 31], [15, 46], [16, 1], [16, 16], [16, 31], [16, 46], [17, 1], [17, 16], [17, 31], [17, 46], [18, 1], [18, 16], [18, 31]];
export const SERIES = {
  v: 1, key: "live:strips:series", session: DAY,
  fresh: { v: 1, readAt: iso(NOW - 240000), vendorAt: null, source: "actions", cadenceS: 900, session: DAY, writer: "actions@live" },
  t: times.map(([a, b]) => T(a, b)),
  lag: {
    p50: times.map((_, i) => 3 + (i % 4)), p90: times.map((_, i) => 8 + (i % 7) * 2 + (i === 9 ? 1400 : 0)), max: times.map((_, i) => 60 + i * 13 + (i === 9 ? 1500 : 0)),
    ahead: times.map(() => 0),
  },
};

function ledgerRow(over = {}) {
  return {
    day: DAY, ticks: 190, t1_last_at: NOW - 60000, t1_gap_ms: 300000, t1_gap_end: NOW - 3000000, t1_ok: 180, t1_fail: 3, t1_ok_at: NOW - 60000, t1_ok_gap_ms: 600000,
    t1_ok_gap_end: NOW - 3000000, focus_ok: 120, focus_partial: 4, focus_fail: 1, focus_ok_at: NOW - 120000, focus_gap_ms: 900000, focus_gap_end: NOW - 8000000,
    t2_passes: 21, t2_first_at: NOW - 18000000, t2_last_at: NOW - 240000, t2_gap_ms: 1800000, t2_gap_end: NOW - 9000000, t2_calls: 920, t2_failed: 6,
    stale_ticks: 2, stale_over_s: 140, stale_key: "live:breadth", nightly_at: null, nightly_runs: 0, updated_at: NOW - 60000,
    t1_calls: 366, focus_calls: 125, uw_daily_max: 21400, uw_daily_at: NOW - 60000, ...over,
  };
}

export const COVERAGE_ROWS = [
  { id: "universe", updated_at: NOW - 66e5, bytes: 100609, session: "2026-10-09" },
  { id: "meta", updated_at: NOW - 66e5, bytes: 9400, session: "2026-10-09" },
  { id: "board:long", updated_at: NOW - 66e5, bytes: 61800, session: "2026-10-09" },
  { id: "board:short", updated_at: NOW - 66e5, bytes: 58800, session: "2026-10-09" },
  { id: "market", updated_at: NOW - 66e5, bytes: 42100, session: "2026-10-09" },
  { id: "events", updated_at: NOW - 66e5, bytes: 22800, session: "2026-10-09" },
  { id: "political", updated_at: NOW - 66e5, bytes: 30400, session: "2026-10-08" },
  { id: "unusual", updated_at: NOW - 66e5, bytes: 51200, session: null },
  { id: "regime", updated_at: NOW - 66e5, bytes: 3100, session: "2026-10-09" },
  { id: "deepen", updated_at: NOW - 66e5, bytes: 30720, session: "2026-10-09",
    summary: JSON.stringify({ carded: 612, universe: 856, tonight: 530, oldest: "2026-10-05", planned: 530, read: 530, calls: 24100, dailySeen: 31200, dayLine: 60000, minuteLine: 500 }) },
];

export function opsFor(over = {}, { part = null } = {}) {
  const clock = {
    id: 1, day: DAY, trading: 1, early_close: 0, tier1_at: NOW - 60000, tier1_ok_at: NOW - 60000, tier1_why: "written", dispatch_why: "refused:403", summary_at: NOW - 120000,
    closed_days: "[]", uw_daily: 21400, uw_daily_at: NOW - 60000, ...(over.clock || {}),
  };
  const live = Object.keys(LIVE_KEYS).map((id, i) => {
    const readAt = NOW - (i + 1) * 20000;
    return { id, read_at: readAt, session: DAY, cadence_s: LIVE_KEYS[id].cadenceS, source: LIVE_KEYS[id].writer === "actions" ? "actions" : "worker",
      writer: LIVE_KEYS[id].writer === "actions" ? "actions@live" : "worker@tier1", updated_at: readAt, vendor_at: i === 4 ? null : iso(readAt - 5000) };
  });
  const usage = { calls: 268, tokens_in: 1200000, tokens_out: 140000 };
  const models = [{ model: "@cf/zai-org/glm-4.7-flash", calls: 262, tokens_in: 1180000, tokens_out: 138000 }, { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", calls: 6, tokens_in: 20000, tokens_out: 2000 }];
  const counters = [];
  for (const surface of ["board", "neuron", "ask", "read"]) {
    counters.push({ day: DAY, surface, model: "@cf/zai-org/glm-4.7-flash", outcome: "clean", reason: "", n: 40, ms_sum: 48000, ms_max: 3100 });
    counters.push({ day: DAY, surface, model: "@cf/zai-org/glm-4.7-flash", outcome: "refused", reason: "forecast", n: 6, ms_sum: 9000, ms_max: 2800 });
    counters.push({ day: DAY, surface, model: "@cf/zai-org/glm-4.7-flash", outcome: "budget", reason: "", n: 1, ms_sum: 0, ms_max: 0 });
  }
  const ring = Array.from({ length: 8 }, (_, i) => ({ surface: ["board", "neuron", "ask", "read"][i % 4], slot: i, at: NOW - i * 600000, model: "@cf/zai-org/glm-4.7-flash", reason: "refused:forecast", culprit: "will rise" }));
  const results = [
    { results: over.ledger === null ? [] : [ledgerRow(over.ledgerRow || {})] }, { results: [clock] }, { results: live }, { results: [usage] }, { results: models },
    ...(part === "ai" ? [{ results: counters }, { results: ring }] : []),
    ...(part === "coverage" ? [{ results: over.coverage || COVERAGE_ROWS }] : []),
  ];
  return opsBody({ FLOWS_ASK_MODEL: "@cf/zai-org/glm-4.7-flash", FLOWS_ASK_NEURONS: "5500,36400", FLOWS_ASK_FALLBACK_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", FLOWS_ASK_FALLBACK_NEURONS: "26668,204805", FLOWS_AI_DAILY_CAP_NEURONS: "30000", FLOWS_AI_DAILY_CAP_CALLS: "2500", FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "members", FLOWS_RT_UPSTREAM: "socket",
    FLOWS_RT_SOCKET_HOURS: "session", FLOWS_READ_MODE: "on", FLOWS_LIVE_MODE: "actions", FLOWS_OPS: "on", FLOWS_READY: "on", FLOWS_HEALTH: "on", ...(over.env || {}) }, NOW, results, { part, meter: over.meter || null });
}

export const world = () => ({
  "/api/rt/status": { body: RAIL },
  "/api/flows/meta": { body: META },
  "/api/flows/ai-usage": { body: SPEND },
  "/api/flows/ready": { body: READY },
  "/api/flows/ops": { body: opsFor() },
  "/api/flows/ops?part=ai": { body: opsFor({}, { part: "ai" }) },
  "/api/flows/ops?part=coverage": { body: opsFor({}, { part: "coverage" }) },
  "/api/flows/lk?k=heartbeat": { body: HEARTBEAT },
  "/api/flows/lk?k=strips:series": { body: SERIES },
});

export async function serve(page, worldMap, { asked = [], errors = [], username = "anilkaya", headers = {}, serverNow = () => NOW + 40 } = {}) {
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/flows/status/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGES.ownerNav(PAGES.statusPage({ username })) });
    if (u.pathname.startsWith("/api/")) {
      const key = u.pathname + u.search;
      asked.push(key);
      const entry = worldMap[key];
      if (!entry) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not found" } }) });
      return route.fulfill({ status: entry.status || 200, contentType: "application/json", headers: { "X-Server-Now": String(serverNow()), ...headers }, body: JSON.stringify(entry.body) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
}
