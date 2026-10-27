import { HttpError, json, requireTicker, internalKey } from "../http.js";
import { eventRiskOpen } from "../../shared/flows-er-switch.js";
import { shapeQuote } from "../../shared/flows-er-quote.js";
import { stripOwner } from "../../shared/flows-er-strip.js";

export const QUOTE_TTL_S = 15;
export const EVENTRISK_ROW_CEILING = 1;

const PENDING = Object.freeze({ status: "pending" });
const PARTS = Object.freeze(["sectors", "quote"]);

const parse = (text) => {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export function flowsEventRiskRows(deps) {
  const { readFlowsPayload, recallLastGood, passthrough, storeGone, isOwner, vendorGate, serveCachedVendorRead, quotePath, now = Date.now } = deps;

  const load = async (env, key) => {
    const trace = {};
    const stored = await readFlowsPayload(env, key, trace);
    return { stored, failed: trace.failed === true };
  };

  const eventrisk = async ({ request, env, ctx, url, session }) => {
    const owner = isOwner(env, session.username);
    if (!eventRiskOpen(env, owner)) throw HttpError.of("eventrisk_off");
    const part = url.searchParams.get("part");
    if (part !== null && !PARTS.includes(part)) throw HttpError.of("invalid_part");
    if (part === "quote") {
      const ticker = requireTicker(url);
      return serveCachedVendorRead({
        env, ctx, cacheKey: internalKey("eventrisk", "quote/" + ticker), wantsRefresh: false, ttlSeconds: QUOTE_TTL_S, gate: vendorGate(env, session),
        build: async (fetchFeed) => shapeQuote(ticker, await fetchFeed(quotePath(ticker), {}, {}), now()),
      });
    }
    if (part === "sectors") {
      const { stored, failed } = await load(env, "er-sectors");
      if (stored !== null) return passthrough(stored);
      const kept = failed ? await recallLastGood(request, url) : null;
      if (kept) return kept;
      if (failed) throw storeGone();
      return json(PENDING);
    }
    if (url.searchParams.has("t")) {
      const ticker = requireTicker(url);
      const { stored, failed } = await load(env, "card-x:" + ticker);
      if (stored === null) {
        const kept = failed ? await recallLastGood(request, url) : null;
        if (kept) return kept;
        if (failed) throw storeGone();
        return json({ t: ticker, status: "pending" });
      }
      const card = parse(stored.payload);
      if (!card) throw storeGone();
      const parts = card.dx && card.dx.parts ? card.dx.parts : null;
      const fin = parts && parts.financials && !parts.financials.shed ? parts.financials : null;
      return json({ t: ticker, sessionDate: card.sessionDate || null, earnings: card.earnings || null, er: card.er || null, fin }, 200,
        { "X-Payload-Updated": String(stored.updatedAt || 0) });
    }
    const { stored, failed } = await load(env, "eventrisk");
    if (stored === null) {
      if (failed) throw storeGone();
      return json(PENDING);
    }
    return passthrough(owner ? stored : stripOwner(stored));
  };

  return [
    { id: "flows.eventrisk", path: "/api/flows/eventrisk", methods: ["GET"], auth: "flows", handler: eventrisk },
  ];
}
