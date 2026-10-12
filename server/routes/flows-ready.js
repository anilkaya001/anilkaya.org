import { HttpError, json } from "../http.js";
import { readiness, healthOf, READY_KEYS } from "../../shared/flows-ready.js";

const on = (value) => typeof value === "string" && value.trim().toLowerCase() === "on";

export function flowsReadyRows(deps) {
  const { store, ensureFlowsTables, readClock, railReadiness, isOwner, now = Date.now } = deps;

  const ready = async ({ env, session }) => {
    if (!on(env.FLOWS_READY)) throw HttpError.of("ready_off");
    if (!env.DB) throw HttpError.of("store_unreadable");
    await ensureFlowsTables(env);
    const at = now();
    const owner = isOwner(env, session.username);
    const [clock, keys, rail] = await Promise.all([
      readClock(env.DB),
      store.metadata(env, READY_KEYS.slice()),
      owner ? railReadiness(env) : Promise.resolve(undefined),
    ]);
    return json({ ...readiness({ clock, keys, rail }, at), owner });
  };

  const health = async ({ env }) => {
    if (!on(env.FLOWS_HEALTH)) throw HttpError.of("health_off");
    return json(healthOf(now()));
  };

  return [
    { id: "flows.ready", path: "/api/flows/ready", methods: ["GET"], auth: "flows", handler: ready },
    { id: "health", path: "/api/health", methods: ["GET"], auth: "none", handler: health },
  ];
}
