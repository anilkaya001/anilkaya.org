import { HttpError, json, requireTicker, internalKey } from "../http.js";
import { eventRiskOpen } from "../../shared/flows-er-switch.js";
import { shapeQuote } from "../../shared/flows-er-quote.js";
import { pathFor } from "../../shared/flows-vendor-ops.js";

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

export function stripOwner(stored) {
  if (!stored.payload.includes('"owner":{')) return stored;
  const body = parse(stored.payload);
  if (!body || !body.feed || typeof body.feed !== "object") return stored;
  const feed = { ...body.feed };
  delete feed.owner;
  return { ...stored, payload: JSON.stringify({ ...body, feed }) };
}

export function stripEr(stored) {
  if (!stored.payload.includes('"er":{')) return stored;
  const body = parse(stored.payload);
  if (!body || !("er" in body)) return stored;
  const rest = { ...body };
  delete rest.er;
  return { ...stored, payload: JSON.stringify(rest) };
}

export function flowsEventRiskRows(deps) {
  const { readServed, passthrough, storeGone, isOwner, vendorGate, serveCachedVendorRead, now = Date.now } = deps;

  const eventrisk = async ({ env, ctx, url, session }) => {
    const owner = isOwner(env, session.username);
    if (!eventRiskOpen(env, owner)) throw HttpError.of("eventrisk_off");
    const part = url.searchParams.get("part");
    if (part !== null && !PARTS.includes(part)) throw HttpError.of("invalid_part");
    if (part === "quote") {
      const ticker = requireTicker(url);
      return serveCachedVendorRead({
        env, ctx, cacheKey: internalKey("eventrisk", "quote/" + ticker), wantsRefresh: false, ttlSeconds: QUOTE_TTL_S, gate: vendorGate(env, session),
        build: async (fetchVendor) => shapeQuote(ticker, await fetchVendor(pathFor("stock-quote", { ticker }), {}, {}), now()),
      });
    }
    if (part === "sectors") {
      const stored = await readServed(env, "er-sectors");
      return stored === null ? json(PENDING) : passthrough(stored);
    }
    if (url.searchParams.has("t")) {
      const ticker = requireTicker(url);
      const stored = await readServed(env, "card-x:" + ticker);
      if (stored === null) return json({ t: ticker, status: "pending" });
      const card = parse(stored.payload);
      if (!card) throw storeGone();
      const parts = card.dx && card.dx.parts ? card.dx.parts : null;
      const fin = parts && parts.financials && !parts.financials.shed ? parts.financials : null;
      return json({ t: ticker, sessionDate: card.sessionDate || null, earnings: card.earnings || null, er: card.er || null, fin }, 200,
        { "X-Payload-Updated": String(stored.updatedAt || 0) });
    }
    const stored = await readServed(env, "eventrisk");
    if (stored === null) return json(PENDING);
    return passthrough(owner ? stored : stripOwner(stored));
  };

  return [
    { id: "flows.eventrisk", path: "/api/flows/eventrisk", methods: ["GET"], auth: "flows", handler: eventrisk },
  ];
}
