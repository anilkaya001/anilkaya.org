import { HttpError, json, requireTicker } from "../http.js";
import { positioningMode } from "../../shared/flows-pos-switch.js";

const PENDING = Object.freeze({ status: "pending" });

const parseObject = (text) => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export function flowsPositioningRows(deps) {
  const { readServed, passthrough, storeGone, isOwner = () => false } = deps;

  const positioning = async ({ env, url, session }) => {
    if (!positioningMode(env, isOwner(env, session && session.username))) throw HttpError.of("positioning_off");
    if (url.searchParams.has("t")) {
      const ticker = requireTicker(url);
      const stored = await readServed(env, "card-x:" + ticker);
      if (stored === null) return json({ t: ticker, sessionDate: null, ps: null, why: "absent" });
      const card = parseObject(stored.payload);
      if (!card) throw storeGone();
      const ps = card.ps && typeof card.ps === "object" ? card.ps : null;
      return json({ t: ticker, sessionDate: typeof card.sessionDate === "string" ? card.sessionDate : null, ps, ...(ps ? {} : { why: "absent" }) }, 200,
        { "X-Payload-Updated": String(stored.updatedAt || 0) });
    }
    const stored = await readServed(env, "positioning");
    if (stored === null) return json(PENDING);
    return passthrough(stored);
  };

  return [{ id: "flows.positioning", path: "/api/flows/positioning", methods: ["GET"], auth: "flows", handler: positioning }];
}
