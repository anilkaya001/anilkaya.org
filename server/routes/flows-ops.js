import { HttpError, json } from "../http.js";
import { readOps } from "../ops.js";

const on = (value) => typeof value === "string" && value.trim().toLowerCase() === "on";

export function flowsOpsRows(deps) {
  const { ensureFlowsTables, isOwner, meter, now = Date.now } = deps;

  const ops = async ({ env, url, session }) => {
    if (!on(env.FLOWS_OPS)) throw HttpError.of("ops_off");
    if (!isOwner(env, session.username)) throw HttpError.of("forbidden");
    const asked = url.searchParams.get("part");
    const part = asked === "ai" || asked === "coverage" ? asked : null;
    return json(await readOps(env, { ensureFlowsTables, now, meter }, { part }));
  };

  return [
    { id: "flows.ops", path: "/api/flows/ops", methods: ["GET"], auth: "flows", handler: ops },
  ];
}
