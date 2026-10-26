import { HttpError, json, internalKey, edgeCache, fixtureRefused } from "../http.js";
import { ledgerView, parseScope } from "../../shared/flows-sfc-view.js";
import { PERIODS } from "../../shared/flows-sfc.js";
import { freshHeaders, pendingHeaders } from "../../shared/flows-freshness.js";
import { liveMeta } from "../../shared/flows-live-worker.js";
import { logFailure } from "../log.js";

export const LEDGER_TTL_S = 30;

export const LEDGER_ROW_CEILING = 6;

const parse = (text) => {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

export function flowsLedgerRows(deps) {
  const { store, ensureFlowsTables, readLiveRows, now = Date.now, view: build = ledgerView } = deps;

  const gather = async (env, at) => {
    if (!env.DB) throw HttpError.of("store_unreadable");
    await ensureFlowsTables(env);
    const [stored, live] = await Promise.all([store.readMany(env, ["flowalerts", "universe"]), readLiveRows(env.DB, ["live:alerts", "live:breadth"], at)]);
    if (stored === null || live === null) throw HttpError.of("store_unreadable");
    const byId = new Map(live.rows.map((r) => [r.id, r]));
    const take = (row) => {
      if (!row || typeof row.payload !== "string") return null;
      const payload = parse(row.payload);
      if (payload === undefined) throw HttpError.of("store_unreadable");
      return payload;
    };
    const nightlyRow = stored.get("flowalerts") || null;
    const universeRow = stored.get("universe") || null;
    const nightlyPayload = nightlyRow ? parse(nightlyRow.payload) : null;
    const universe = universeRow ? parse(universeRow.payload) : null;
    if (nightlyPayload === undefined || universe === undefined) throw HttpError.of("store_unreadable");
    const alertsRow = byId.get("live:alerts") || null;
    const breadthRow = byId.get("live:breadth") || null;
    const alerts = take(alertsRow);
    const breadth = take(breadthRow);
    return {
      live: alerts ? { payload: alerts, readAt: Number(alertsRow.read_at), session: alertsRow.session } : null,
      nightly: nightlyPayload ? { payload: nightlyPayload, updatedAt: nightlyRow.updatedAt } : null,
      breadth: breadth ? { payload: breadth } : null,
      universe,
      clock: live.clock,
      alertsRow,
      updated: Math.max(0, ...[alertsRow && Number(alertsRow.updated_at), breadthRow && Number(breadthRow.updated_at), nightlyRow && nightlyRow.updatedAt].filter((v) => Number.isFinite(v))),
    };
  };

  const headersOf = (read, at) => {
    const base = read.alertsRow
      ? freshHeaders(liveMeta({ readAt: Number(read.alertsRow.read_at), session: read.alertsRow.session, cadenceS: Number(read.alertsRow.cadence_s), source: read.alertsRow.source }), at, read.clock).headers
      : pendingHeaders("breadth", at, read.clock);
    return { ...base, "X-Payload-Updated": String(read.updated) };
  };

  const ledger = async ({ env, ctx, url }) => {
    const scope = parseScope(url.searchParams.get("scope"));
    if (scope === null) throw HttpError.of("invalid_scope");
    if (scope.kind === "name" && fixtureRefused(url, scope.name)) throw HttpError.of("invalid_ticker");
    const raw = url.searchParams.get("period");
    const period = raw === null || raw === "" ? null : PERIODS.includes(raw) ? raw : undefined;
    if (period === undefined) throw HttpError.of("invalid_period");
    const key = internalKey("ledger", encodeURIComponent(scope.key) + "/" + (period || "auto"));
    const hit = await edgeCache.get(key);
    if (hit) {
      const text = await hit.text().catch(() => "");
      const kept = parse(hit.headers.get("X-Ledger-Headers") || "");
      if (parse(text) && kept) return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", ...kept, "X-Server-Now": String(now()), "X-Ledger-Cache": "hit" } });
    }
    const at = now();
    const read = await gather(env, at);
    const view = build({ now: at, scope, period, live: read.live, nightly: read.nightly, breadth: read.breadth, universe: read.universe, clock: read.clock });
    const headers = headersOf(read, at);
    if (view.withheld) logFailure("error", "ledger closure failed", { route: "/api/flows/ledger", scope: scope.key, failed: view.checks.failed, reason: view.withheld.reason });
    if (view.status === "failed") return json(view, 200, headers);
    const text = JSON.stringify(view);
    const kept = new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=" + LEDGER_TTL_S, "X-Ledger-Headers": JSON.stringify(headers) } });
    const put = edgeCache.put(key, kept);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put); else await put;
    return json(view, 200, headers);
  };

  return [{ id: "flows.ledger", path: "/api/flows/ledger", methods: ["GET"], auth: "flows", handler: ledger }];
}
