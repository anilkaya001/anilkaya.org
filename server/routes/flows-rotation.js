import { HttpError, json, internalKey, edgeCache } from "../http.js";
import { ROTATION_FUNDS, ROTATION_WHY, closesOf, plane } from "../../shared/flows-rotation.js";

export const ROTATION_TTL_S = 900;

export const ROTATION_ROW_CEILING = ROTATION_FUNDS.length;

const parse = (text) => {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

const round = (v) => Math.round(v * 10000) / 10000;

export const rotationMode = (env) => {
  const raw = String((env && env.FLOWS_ROTATION) ?? "owner").trim().toLowerCase();
  return raw === "on" || raw === "off" ? raw : "owner";
};

export const rotationOpen = (env, owner) => {
  const mode = rotationMode(env);
  return mode === "on" || (mode === "owner" && owner === true);
};

export function rotationBody(cards) {
  const series = {};
  for (const f of ROTATION_FUNDS) {
    const card = cards.get(f.t);
    if (card) series[f.t] = closesOf(card) || { d: [], c: [] };
  }
  const p = plane(series);
  const funds = p.funds.map((f) => ({
    ...f,
    tails: Object.fromEntries(Object.entries(f.tails).map(([k, tail]) => [k, tail.map((pt) => (pt ? [round(pt.x), round(pt.y)] : null))])),
  }));
  const absent = Object.entries(p.absent).map(([t, why]) => ({ t, group: ROTATION_FUNDS.find((f) => f.t === t).group, why, say: ROTATION_WHY[why] }));
  return { ...p, funds, absent };
}

export function flowsRotationRows(deps) {
  const { store, isOwner = () => false } = deps;

  const rotation = async ({ env, ctx, session }) => {
    if (!rotationOpen(env, isOwner(env, session && session.username))) throw HttpError.of("rotation_off");
    const key = internalKey("rotation", "plane");
    const hit = await edgeCache.get(key);
    if (hit) return new Response(hit.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "X-Rotation-Cache": "hit" } });
    const stored = await store.readMany(env, ROTATION_FUNDS.map((f) => "card:" + f.t));
    if (stored === null) throw HttpError.of("store_unreadable");
    const cards = new Map();
    for (const f of ROTATION_FUNDS) {
      const row = stored.get("card:" + f.t);
      const card = row && typeof row.payload === "string" ? parse(row.payload) : null;
      if (card) cards.set(f.t, card);
    }
    const text = JSON.stringify(rotationBody(cards));
    const keep = edgeCache.put(key, new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=" + ROTATION_TTL_S } }));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(keep);
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "X-Rotation-Cache": "miss" } });
  };

  return [{ id: "flows.rotation", path: "/api/flows/rotation", methods: ["GET"], auth: "flows", handler: rotation }];
}
