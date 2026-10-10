import { HttpError, internalKey, requireTicker } from "../http.js";
import { RANK_KEYS } from "../../shared/flows-premium.js";

const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}$/;

const row = (name, handler) => ({ id: "flows." + name, path: "/api/flows/" + name, methods: ["GET"], auth: "flows", handler });

export function flowsDeskRows(deps) {
  const { vendorGate, serveCachedVendorRead, buildChainPayload, buildStrategyContext, buildStrategyExpiry, quoteResponse } = deps;

  const chain = async ({ env, ctx, url, session }) => {
    const ticker = requireTicker(url);

    const rawStrategy = url.searchParams.get("strategy");
    const strategy = rawStrategy === "csp" || rawStrategy === "cc" ? rawStrategy : "both";
    const rawRank = url.searchParams.get("rank");
    const rankBy = RANK_KEYS.includes(rawRank) ? rawRank : "annualized";

    return serveCachedVendorRead({
      env,
      ctx,
      cacheKey: internalKey("chain", `${ticker}?strategy=${strategy}&rank=${rankBy}`),
      wantsRefresh: url.searchParams.get("refresh") === "1",
      gate: vendorGate(env, session),
      build: (vf) => buildChainPayload(env, ctx, vf, { ticker, strategy, rankBy, limit: 120 }),
    });
  };

  const strategy = async ({ env, ctx, url, session }) => {
    const ticker = requireTicker(url);
    const rawExpiry = url.searchParams.get("expiry");

    if (rawExpiry !== null && !EXPIRY_RE.test(rawExpiry)) {
      throw new HttpError(400, "invalid_expiry", "Expiry must be YYYY-MM-DD");
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
