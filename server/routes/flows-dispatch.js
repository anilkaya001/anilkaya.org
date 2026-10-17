import { HttpError, json, requireSameOrigin } from "../http.js";

export function flowsDispatchRows(deps) {
  const { ensureFlowsTables, check, record, isOwner, claim, now } = deps;

  const dispatchCheck = async ({ request, env, session }) => {
    requireSameOrigin(request);
    if (!isOwner(env, session.username)) throw HttpError.of("owner_only");
    const at = now ? now() : Date.now();
    if (!claim(at)) throw HttpError.of("rate_limited", undefined, { "Retry-After": "60" });
    const result = await check(env);
    let recorded = false;
    if (result.outcome) {
      try {
        await ensureFlowsTables(env);
        recorded = await record(env, result.outcome, at);
      } catch {
        recorded = false;
      }
    }
    return json({
      ok: result.read.why === "ok" && result.dispatch.sent === true,
      read: result.read,
      dispatch: result.dispatch,
      recorded,
      repo: result.repo,
      workflow: result.workflow,
      at: new Date(at).toISOString(),
    });
  };

  return [
    { id: "flows.dispatch-check", path: "/api/flows/dispatch-check", methods: ["POST"], auth: "flows", handler: dispatchCheck },
  ];
}
