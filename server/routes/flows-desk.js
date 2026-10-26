import { HttpError, internalKey, requireTicker } from "../http.js";
import { RANK_KEYS, SC_DEFAULTS, SC_LIMITS, isRealDate, numOrNull } from "../../shared/flows-premium.js";

const EXPIRY_YEARS = [2000, 2100];

const validExpiry = (text) => {
  if (!isRealDate(text)) return false;
  const year = Number(text.slice(0, 4));
  return year >= EXPIRY_YEARS[0] && year <= EXPIRY_YEARS[1];
};

const inRange = (v, [lo, hi]) => v !== null && v >= lo && v <= hi;

function shortCallTerms(url) {
  const read = (name, fallback, limits) => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    const v = numOrNull(raw);
    if (!inRange(v, limits)) throw HttpError.of("invalid_terms");
    return Math.round(v * 1e4) / 1e4;
  };
  return { haircut: read("h", SC_DEFAULTS.haircut, SC_LIMITS.haircut), floor: read("f", SC_DEFAULTS.floor, SC_LIMITS.floor) };
}

const row = (name, handler) => ({ id: "flows." + name, path: "/api/flows/" + name, methods: ["GET"], auth: "flows", handler });

export function flowsDeskRows(deps) {
  const { vendorGate, serveCachedVendorRead, buildChainPayload, buildStrategyContext, buildStrategyExpiry, quoteResponse } = deps;

  const chain = async ({ env, ctx, url, session }) => {
    const ticker = requireTicker(url);

    const rawStrategy = url.searchParams.get("strategy");
    const strategy = rawStrategy === "csp" || rawStrategy === "cc" || rawStrategy === "sc" ? rawStrategy : "both";
    const rawRank = url.searchParams.get("rank");
    const rankBy = RANK_KEYS.includes(rawRank) ? rawRank : "annualized";
    const terms = strategy === "sc" ? shortCallTerms(url) : null;
    const key = strategy === "sc" ? `${ticker}?strategy=sc&h=${terms.haircut}&f=${terms.floor}` : `${ticker}?strategy=${strategy}&rank=${rankBy}`;

    return serveCachedVendorRead({
      env,
      ctx,
      cacheKey: internalKey("chain", key),
      wantsRefresh: url.searchParams.get("refresh") === "1",
      gate: vendorGate(env, session),
      build: (vf) => buildChainPayload(env, ctx, vf, { ticker, strategy, rankBy, limit: 120, ...(terms ? { terms, refresh: url.searchParams.get("refresh") === "1" } : {}) }),
    });
  };

  const strategy = async ({ env, ctx, url, session }) => {
    const ticker = requireTicker(url);
    const rawExpiry = url.searchParams.get("expiry");

    if (rawExpiry !== null && !validExpiry(rawExpiry)) {
      throw new HttpError(400, "invalid_expiry", "Expiry must be a real date, YYYY-MM-DD, between 2000 and 2100");
    }
    const expiry = rawExpiry === null ? null : rawExpiry;
    const engine = expiry !== null && url.searchParams.get("engine") === "1";

    return serveCachedVendorRead({
      env,
      ctx,
      cacheKey: internalKey("strategy", `${ticker}${expiry ? "/" + expiry : ""}${engine ? "?engine=1" : ""}`),
      wantsRefresh: url.searchParams.get("refresh") === "1",
      gate: vendorGate(env, session),
      build: (vf) => (expiry
        ? buildStrategyExpiry(env, ctx, vf, ticker, expiry, { engine })
        : buildStrategyContext(env, ctx, vf, ticker)),
    });
  };

  const live = async ({ env, ctx, url, session }) => {
    const ticker = requireTicker(url);
    return quoteResponse(env, ctx, ticker, vendorGate(env, session));
  };

  return [
    row("chain", chain),
    row("strategy", strategy),
    row("live", live),
  ];
}
