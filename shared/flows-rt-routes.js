import { RT_OBJECT_NAME, RT_TOPIC_KEYS, TICKER_RE, rtSwitches, rtIsOwner, rtAdmits } from "./flows-rt.js";

const RT_PATHS = Object.freeze(["/api/rt/ws", "/api/rt/snap", "/api/rt/status"]);

export function rtTopics(raw) {
  if (raw === null || raw === "") return { ok: true, topics: RT_TOPIC_KEYS.slice() };
  const out = [];
  for (const k of String(raw).split(",")) {
    const x = k.trim();
    if (!RT_TOPIC_KEYS.includes(x)) return { ok: false };
    if (!out.includes(x)) out.push(x);
  }
  return out.length ? { ok: true, topics: out } : { ok: false };
}

export async function serveRt(request, env, url, { json, HttpError, getSession, requireSameOrigin }) {
  const sw = rtSwitches(env);
  if (sw.mode !== "on") throw new HttpError(404, "rt_off", "The real-time rail is off");
  const ns = env.PULSE;
  if (!ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") {
    throw new HttpError(404, "rt_off", "The real-time rail has no Durable Object binding");
  }
  const path = url.pathname;
  if (!RT_PATHS.includes(path)) throw new HttpError(404, "not_found", "API route not found");
  if (request.method !== "GET") throw new HttpError(405, "method_not_allowed", "Method not allowed", { Allow: "GET" });
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized", "Authentication required");
  if (path === "/api/rt/status") {
    if (!rtIsOwner(sw, session.username)) throw new HttpError(403, "forbidden", "Owner only");
  } else if (!rtAdmits(sw, session.username)) {
    throw new HttpError(403, "rt_forbidden", "Real-time access is limited to the owner");
  }
  const asked = rtTopics(url.searchParams.get("k"));
  if (!asked.ok) throw new HttpError(400, "invalid_topic", "Unknown topic");
  const stub = ns.get(ns.idFromName(RT_OBJECT_NAME), sw.hint ? { locationHint: sw.hint } : undefined);
  const target = new URL("https://pulse.internal" + path.slice("/api/rt".length));
  let res;
  try {
    if (path === "/api/rt/ws") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        throw new HttpError(426, "upgrade_required", "Expected a WebSocket upgrade", { Upgrade: "websocket" });
      }
      requireSameOrigin(request);
      const f = String(url.searchParams.get("f") || "").trim().toUpperCase();
      if (f && !TICKER_RE.test(f)) throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      target.searchParams.set("k", asked.topics.join(","));
      if (f) target.searchParams.set("f", f);
      const headers = new Headers(request.headers);
      for (const name of Array.from(headers.keys())) if (name.toLowerCase().startsWith("x-rt-")) headers.delete(name);
      headers.delete("Cookie");
      headers.set("X-RT-User", session.username);
      headers.set("X-RT-Exp", String(session.exp));
      res = await stub.fetch(new Request(target, { method: "GET", headers }));
    } else {
      if (path === "/api/rt/snap") target.searchParams.set("k", asked.topics.join(","));
      res = await stub.fetch(new Request(target, { method: "GET" }));
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "rt_unavailable", "The real-time rail is unavailable", { "Retry-After": "5" });
  }
  if (path !== "/api/rt/status") return res;
  const body = await res.json().catch(() => null);
  if (!body) throw new HttpError(503, "rt_unavailable", "The real-time rail is unavailable", { "Retry-After": "5" });
  return json({
    ...body,
    worker: { mode: sw.mode, audience: sw.audience, users: sw.users, hint: sw.hint, binding: true },
  });
}
