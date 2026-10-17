import { HttpError, internalKey, edgeCache } from "../http.js";
import { expectedNightlySession } from "../../shared/flows-freshness.js";
import { GLOBAL_KEYS, NAME_KINDS } from "../../shared/flows-products.js";
import { verifyCoverage } from "../../shared/flows-coverage.js";

const on = (value) => typeof value === "string" && value.trim().toLowerCase() === "on";

export const COVERAGE_TTL_S = 60;

export const COVERAGE_ROW_CEILING = 2 + GLOBAL_KEYS.length + 2001;

const parse = (stored) => {
  if (stored === null || typeof stored.payload !== "string") return null;
  try {
    const value = JSON.parse(stored.payload);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

export function flowsPipelineRows(deps) {
  const { store, ensureFlowsTables, readClock, isOwner, vendorCalls = () => null, now = Date.now } = deps;

  const coverage = async ({ env, ctx, session }) => {
    if (!on(env.FLOWS_COVERAGE)) throw HttpError.of("coverage_off");
    if (!isOwner(env, session.username)) throw HttpError.of("forbidden");
    if (!env.DB) throw HttpError.of("store_unreadable");
    const key = internalKey("coverage", "v1");
    const hit = await edgeCache.get(key);
    if (hit) {
      const text = await hit.text().catch(() => "");
      if (text) return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "X-Coverage-Cache": "hit" } });
    }
    await ensureFlowsTables(env);
    const at = now();
    const [clock, universe, roster, globals, listing] = await Promise.all([
      Promise.resolve(readClock(env.DB)).catch(() => null),
      store.read(env, "universe"),
      store.read(env, "roster"),
      store.metadata(env, GLOBAL_KEYS.slice()),
      store.listing(env, NAME_KINDS.slice()),
    ]);
    const universeBody = parse(universe);
    if (universeBody === null) throw HttpError.of("store_unreadable");
    const report = verifyCoverage({
      universe: universeBody,
      roster: parse(roster),
      listing,
      globals,
      expected: expectedNightlySession(at, clock),
    });
    const calls = vendorCalls(env);
    const text = JSON.stringify({ ...report, asOf: at, rows: { ceiling: COVERAGE_ROW_CEILING }, ...(calls ? { calls } : {}) });
    const kept = new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=" + COVERAGE_TTL_S } });
    const put = edgeCache.put(key, kept);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
    else await put;
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "X-Coverage-Cache": "miss" } });
  };

  return [
    { id: "flows.coverage", path: "/api/flows/coverage", methods: ["GET"], auth: "flows", handler: coverage },
  ];
}
