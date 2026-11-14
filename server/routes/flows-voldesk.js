import { HttpError, json } from "../http.js";

const modeOf = (env) => {
  const v = env && typeof env.FLOWS_VOLDESK === "string" ? env.FLOWS_VOLDESK : "";
  return v === "on" || v === "owner" ? v : "off";
};

export const VOLDESK_PENDING = Object.freeze({ status: "pending", why: "not_published" });

export function flowsVoldeskRows(deps) {
  const { store, isOwner, passthrough, recallLastGood, storeGone } = deps;

  const voldesk = async ({ request, env, url, session }) => {
    const mode = modeOf(env);
    if (mode === "off" || (mode === "owner" && !isOwner(env, session.username))) throw HttpError.of("voldesk_off");
    if (url.searchParams.has("part")) throw HttpError.of("invalid_part");
    const trace = {};
    const stored = await store.read(env, "voldesk", trace);
    if (stored === null && trace.failed) {
      const kept = await recallLastGood(request, url);
      if (kept) return kept;
      throw storeGone();
    }
    if (stored === null) return json(VOLDESK_PENDING, 200, { "X-Fresh-State": "pending" });
    return passthrough(stored);
  };

  return [
    { id: "flows.voldesk", path: "/api/flows/voldesk", methods: ["GET"], auth: "flows", handler: voldesk },
  ];
}
