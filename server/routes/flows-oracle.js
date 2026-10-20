import { HttpError, json, requireTicker, fixtureRefused } from "../http.js";
import { expectedNightlySession, easternDay, isTradingDay, sessionClose, shiftDay } from "../../shared/flows-freshness.js";
import { staleView } from "../../shared/flows-oracle.js";
import { MODEL_IMPLIED, BUILDING_LINES } from "../../shared/flows-oracle-words.js";
import { productById, TARGET_BY_MIN } from "../../shared/flows-products.js";

export const ORACLE_BATCH_MAX = 12;
export const ORACLE_TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const modeOf = (env) => {
  const v = String((env && env.FLOWS_ORACLE) || "").trim().toLowerCase();
  return v === "on" || v === "owner" ? v : "off";
};

const parse = (stored) => {
  if (stored === null || stored === undefined || typeof stored.payload !== "string") return null;
  try {
    const value = JSON.parse(stored.payload);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

export function nextViewAt(at) {
  const ms = Number(at);
  if (!Number.isFinite(ms)) return null;
  const product = productById("oracle");
  const after = (product && Number.isFinite(product.targetByMin) ? product.targetByMin : TARGET_BY_MIN) * 60000;
  let d = easternDay(ms);
  for (let i = 0; d && i < 14; i++) {
    if (isTradingDay(d)) {
      const due = sessionClose(d) + after;
      if (due > ms) return new Date(due).toISOString();
    }
    d = shiftDay(d, 1);
  }
  return null;
}

export function absentRecord(ticker, at, why) {
  return {
    v: 1, ticker, session: null, sessionDate: null, generatedAt: null, cardSession: null, cardAsOf: null, engineVersion: 1,
    state: "building", stateWhy: "unbuilt", grade: null, due: nextViewAt(at),
    stance: null, context: null, calls: [], withheld: why === "store" ? [{ k: "view", reason: "failed" }] : [],
    limits: [], provenance: { source: "engine", cardKey: null, cardxKey: null, ideas: null, cites: [] },
    fresh: { asOf: null, ageS: null, klass: "nightly", liveUntil: null }, modelImplied: MODEL_IMPLIED, line: BUILDING_LINES.unbuilt,
    ...(why ? { why } : {}),
  };
}

export function flowsOracleRows(deps) {
  const { store, ensureFlowsTables, isOwner, nightlyFreshHeaders, recallLastGood, now = Date.now } = deps;

  const gate = (env, session) => {
    const mode = modeOf(env);
    if (mode === "off") throw HttpError.of("oracle_off");
    if (mode === "owner" && !isOwner(env, session.username)) throw HttpError.of("oracle_off");
  };

  const expected = () => expectedNightlySession(now());

  const view = (stored, ticker) => {
    const record = parse(stored);
    if (record === null || record.ticker !== ticker) return null;
    return staleView(record, expected());
  };

  const oracle = async ({ request, env, url, session }) => {
    gate(env, session);
    if (url.searchParams.has("top")) return top({ env });
    if (url.searchParams.has("ts")) return many({ request, env, url });
    const ticker = requireTicker(url);
    const trace = {};
    const stored = await store.read(env, "oracle:" + ticker, trace);
    if (stored === null && trace.failed) {
      const kept = await recallLastGood(request, url);
      if (kept) return kept;
      return json({ ...absentRecord(ticker, now(), "store"), why: "store" });
    }
    const record = stored === null ? null : view(stored, ticker);
    if (record === null) return json(absentRecord(ticker, now(), null));
    return json(record, 200, nightlyFreshHeaders(stored));
  };

  const many = async ({ request, env, url }) => {
    const raw = String(url.searchParams.get("ts") || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    const list = [...new Set(raw)];
    if (!list.length || list.length > ORACLE_BATCH_MAX) throw HttpError.of("too_many_keys");
    for (const t of list) if (!ORACLE_TICKER_RE.test(t) || fixtureRefused(url, t)) throw HttpError.of("invalid_ticker");
    const found = await store.readMany(env, list.map((t) => "oracle:" + t));
    if (found === null) {
      const kept = await recallLastGood(request, url);
      if (kept) return kept;
      return json({ v: 1, records: Object.fromEntries(list.map((t) => [t, null])), why: "store" });
    }
    const records = {};
    let newest = null;
    for (const t of list) {
      const stored = found.get("oracle:" + t) || null;
      records[t] = stored === null ? null : view(stored, t);
      if (stored !== null && newest === null) newest = stored;
    }
    return json({ v: 1, records }, 200, newest ? nightlyFreshHeaders(newest) : {});
  };

  const top = async ({ env }) => {
    const trace = {};
    const stored = await store.read(env, "oracle-top", trace);
    if (trace.failed) throw HttpError.of("store_unreadable");
    const body = parse(stored);
    if (body === null) return json({ v: 1, session: expected(), generatedAt: null, items: [], status: "pending" });
    const items = Array.isArray(body.items) ? body.items : [];
    return json({ v: 1, session: body.session || null, generatedAt: body.generatedAt || null, items }, 200, nightlyFreshHeaders(stored));
  };

  return [
    { id: "flows.oracle", path: "/api/flows/oracle", methods: ["GET"], auth: "flows", handler: oracle },
  ];
}
