import { RT_PATHS } from "../../shared/flows-rt-routes.js";

export function flowsRtRows(deps) {
  const { serveRt } = deps;
  return RT_PATHS.map((path) => ({
    id: "flows.rt." + path.slice("/api/rt/".length),
    path,
    methods: ["*"],
    auth: "none",
    handler: ({ request, env, url }) => serveRt(request, env, url),
  }));
}
