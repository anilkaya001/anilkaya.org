import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../../shared/flows-auth.js";
import { memoClock } from "../../shared/flows-live-worker.js";
import { LIVE_KEYS } from "../../shared/flows-live.js";
import { fakeD1 } from "./d1-fake.mjs";
import { FIXTURE_MEMBER, FIXTURE_MEMBER_2, FIXTURE_OWNER } from "./fixture-roster.mjs";

export const HOST = "https://flows.test";
export const SECRET = "ff-mount-session-secret-abcdefghijklmnopqrstuvwxyz";
export const INGEST_TOKEN = "ff-mount-ingest-token-abcdefghijklmnopqrstuvwxyz";
export const LIVE_TOKEN = "ff-mount-live-token-abcdefghijklmnopqrstuvwxyz";
export const OWNER = FIXTURE_OWNER;
export const MEMBER = FIXTURE_MEMBER;
export const MEMBER_2 = FIXTURE_MEMBER_2;
export const HOUSEKEEPING_CRON = "*/30 * * * *";
export const FF_ON = Object.freeze({ FF_MODE: "shadow", FF_ROUTE_WIRES: "on", FF_ROUTE_INBOX: "on", FF_ROUTE_FIRE: "on", FF_ROUTE_EXPORT: "on" });

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const RealDate = Date;

export function pinClock(start) {
  const clock = { at: start };
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.at); }
    static now() { return clock.at; }
  };
  clock.set = (at) => { clock.at = typeof at === "string" ? RealDate.parse(at) : at; memoClock(null, 0); return clock.at; };
  clock.restore = () => { globalThis.Date = RealDate; };
  memoClock(null, 0);
  return clock;
}

export function quiet() {
  const real = { error: console.error, warn: console.warn, fetch: globalThis.fetch };
  const lines = [];
  const out = { lines, outbound: 0 };
  const take = (level) => (line) => {
    let entry = null;
    try { entry = JSON.parse(line); } catch { entry = { event: String(line) }; }
    lines.push({ level, ...entry });
  };
  console.error = take("error");
  console.warn = take("warn");
  globalThis.fetch = async () => { out.outbound++; return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } }); };
  out.events = (name) => lines.filter((l) => l.event === name);
  out.restore = () => { console.error = real.error; console.warn = real.warn; globalThis.fetch = real.fetch; };
  return out;
}

export function mountEnv(D1, extra = {}) {
  return {
    DB: D1, SESSION_SECRET: SECRET, FLOWS_PEPPER: "ff-mount-pepper", FLOWS_READ_MODE: "off", FLOWS_INGEST_TOKEN: INGEST_TOKEN,
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    FLOWS_CREDENTIALS: JSON.stringify({ [OWNER]: "x".repeat(43), [MEMBER]: "y".repeat(43), [MEMBER_2]: "z".repeat(43) }),
    ...FF_ON, ...extra,
  };
}

export const store = (options) => fakeD1({ latencyMs: 0, ...options });

export const sessionCookie = async (name) => FLOWS_COOKIE + "=" + (await signFlowsSession(name, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })));

let instance = 0;

export const loadWorker = async () => (await import("../../worker.js?ffmount=" + (++instance) + "-" + process.pid)).default;

const settle = (list) => Promise.all(list.map((p) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve("pending"), 400))])));

export async function send(worker, env, path, { method = "GET", body, as = MEMBER, headers = {}, host = HOST, bearer = null, wait = true } = {}) {
  const h = { "Sec-Fetch-Site": "same-origin", ...headers };
  if (as) h.cookie = await sessionCookie(as);
  if (bearer) h.Authorization = "Bearer " + bearer;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const background = [];
  const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).then(() => "settled", () => "rejected")) };
  const res = await worker.fetch(new Request(host + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  const done = wait ? await settle(background) : [];
  return { res, status: res.status, json, text, background: done, code: json && json.error ? json.error.code : null };
}

export async function fire(worker, env, at, cron = HOUSEKEEPING_CRON) {
  const background = [];
  const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).then(() => "settled", () => "rejected")) };
  let threw = null;
  try {
    await worker.scheduled({ cron, scheduledTime: at }, env, ctx);
  } catch (error) {
    threw = error;
  }
  return { guards: background.length, settled: await settle(background), threw };
}

export function liveAlerts(rows, { readAt, session }) {
  const iso = new RealDate(readAt).toISOString();
  return {
    v: 2, key: "live:alerts", session, generatedAt: iso, sessionDate: session, readAt: iso, readDay: session,
    fresh: { v: 1, readAt: iso, vendorAt: iso, source: LIVE_KEYS["live:alerts"].writer, cadenceS: LIVE_KEYS["live:alerts"].cadenceS, session, writer: "flows-live" },
    rows, seen: rows.length, status: rows.length ? "ok" : "quiet",
  };
}

export const windowRow = (t, over = {}) => ({
  t, oc: t + "261120C00100000", cp: "C", k: 100, exp: "2026-11-20", prem: 2500000, size: 400, trades: 5, askPrem: 1500000, bidPrem: 500000,
  sweep: false, floor: false, single: true, opening: true, oi: 1000, voi: 2.5, px: 95, spanStart: "2026-10-27T15:10:00.000Z", spanEnd: "2026-10-27T15:12:00.000Z",
  rule: "RepeatedHits", ruleId: "r1", st: null, ...over,
});

export const ffSql = (f, from = 0) => f.trips.slice(from).flatMap((t) => t.sqls).filter((sql) => /\bff_[a-z_]+/.test(sql));
