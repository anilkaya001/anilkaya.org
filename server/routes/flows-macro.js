import { HttpError, json, internalKey, edgeCache } from "../http.js";
import { FX_PAIRS } from "../../shared/flows-macro.js";
import { LIVE_PARTS, MACRO_LIVE_TTL_S } from "../../shared/flows-macro-live.js";

export const MACRO_TTL_S = 300;

export const MACRO_PARTS = Object.freeze(["rates", "economy", "commodities", "fx", "crypto", "futures", "movers", "seasonality", "odds", "pm"]);

export const MACRO_ROW_CEILING = 1;

const parse = (text) => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export function project(payload, part, sector) {
  if (part === null) return payload;
  if (part === "pm") {
    const sectors = payload.sectors && typeof payload.sectors === "object" ? payload.sectors : {};
    if (sector === null) {
      return { v: payload.v, session: payload.session, generatedAt: payload.generatedAt, ...(payload.fixture ? { fixture: true } : {}), investors: payload.investors, sectors: Object.fromEntries(Object.entries(sectors).map(([k, s]) => [k, { status: s.status, listed: s.listed, profiled: s.profiled, complete: s.complete }])), basis: payload.basis };
    }
    return { v: payload.v, session: payload.session, generatedAt: payload.generatedAt, ...(payload.fixture ? { fixture: true } : {}), sector, entry: sectors[sector], investors: payload.investors, basis: payload.basis };
  }
  return { v: payload.v, session: payload.session, generatedAt: payload.generatedAt, ...(payload.fixture ? { fixture: true } : {}), [part]: payload[part], basis: payload.basis };
}

export function flowsMacroRows(deps) {
  const { readServed, passthrough, macroOn, macroLiveOn, serveCachedVendorRead, vendorGate, buildNow, nightlyFreshHeaders, isOwner = () => false } = deps;

  const gateOn = (env, session) => macroOn(env, isOwner(env, session && session.username));
  const liveOn = (env, session) => macroLiveOn(env, isOwner(env, session && session.username));

  const macro = async ({ env, ctx, url, session }) => {
    if (!gateOn(env, session)) throw HttpError.of("macro_off");
    const raw = url.searchParams.get("part");
    const part = raw === null || raw === "" ? null : raw;
    if (part !== null && !MACRO_PARTS.includes(part)) throw HttpError.of("invalid_part");
    const asked = url.searchParams.get("sector");
    const sector = asked === null || asked === "" ? null : asked;
    if (sector !== null && part !== "pm") throw HttpError.of("invalid_part");
    const cacheKey = internalKey("macro", (part || "all") + "/" + (sector === null ? "" : encodeURIComponent(sector)));
    const hit = await edgeCache.get(cacheKey);
    if (hit) {
      const text = await hit.text().catch(() => "");
      const kept = parse(hit.headers.get("X-Nightly-Meta") || "");
      if (parse(text)) {
        return new Response(text, { status: 200, headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Payload-Updated": hit.headers.get("X-Payload-Updated") || "0",
          ...(kept ? nightlyFreshHeaders({ fresh: kept }) : {}),
        } });
      }
    }
    const key = part === "pm" ? "pm" : "macro";
    const stored = await readServed(env, key);
    if (stored === null) return json({ status: "pending", why: "not_published" }, 200, { "X-Fresh-State": "pending" });
    const payload = parse(stored.payload);
    if (payload === null) return json({ status: "unreadable", why: "not_published" }, 200, { "X-Fresh-State": "pending" });
    if (part === "pm" && sector !== null && !(payload.sectors && Object.hasOwn(payload.sectors, sector))) throw HttpError.of("invalid_part");
    const body = JSON.stringify(project(payload, part, sector));
    const kept = new Response(body, { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "max-age=" + MACRO_TTL_S,
      "X-Payload-Updated": String(stored.updatedAt || 0),
      "X-Nightly-Meta": JSON.stringify(stored.fresh || {}),
    } });
    const put = edgeCache.put(cacheKey, kept);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put); else await put;
    return passthrough({ payload: body, updatedAt: stored.updatedAt, fresh: stored.fresh });
  };

  const now = async ({ env, ctx, url, session }) => {
    if (!gateOn(env, session)) throw HttpError.of("macro_off");
    if (!liveOn(env, session)) throw HttpError.of("macro_live_off");
    const part = url.searchParams.get("part");
    if (!LIVE_PARTS.includes(part)) throw HttpError.of("invalid_part");
    let pair = null;
    if (part === "fx") {
      pair = url.searchParams.get("pair");
      if (!FX_PAIRS.includes(pair)) throw HttpError.of("invalid_pair");
    }
    const cacheKey = internalKey("macro-now", part + (pair ? "/" + pair : ""));
    let symbols = null;
    const build = async (vf) => {
      if (part === "board" || part === "futures") {
        const stored = await readServed(env, "macro").catch(() => null);
        const payload = stored ? parse(stored.payload) : null;
        const products = payload && payload.futures && payload.futures.products ? payload.futures.products : null;
        symbols = products ? Object.fromEntries(Object.entries(products).filter(([, p]) => p && typeof p.sym === "string").map(([k, p]) => [k, p.sym])) : null;
      }
      return buildNow(env, vf, { part, pair, symbols });
    };
    return serveCachedVendorRead({ env, ctx, cacheKey, wantsRefresh: false, ttlSeconds: MACRO_LIVE_TTL_S, build, gate: vendorGate(env, session) });
  };

  return [
    { id: "flows.macro", path: "/api/flows/macro", methods: ["GET"], auth: "flows", handler: macro },
    { id: "flows.macro.now", path: "/api/flows/macro/now", methods: ["GET"], auth: "flows", handler: now },
  ];
}
