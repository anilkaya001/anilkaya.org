import { readMembers, memberOf } from "./flows-auth.js";
import { fixtureHost, isFixtureTicker } from "./flows-fixture-names.js";
import { RT_OBJECT_NAME, RT_TOPIC_KEYS, RT_DEFAULT_TOPICS, RT_LIMITS, TICKER_RE, rtSwitches, rtIsOwner, rtAdmits } from "./flows-rt.js";
import { eventRiskHalts, eventRiskOpen } from "./flows-er-switch.js";

export const RT_PATHS = Object.freeze(["/api/rt/ws", "/api/rt/snap", "/api/rt/status"]);

export function rtTopics(raw) {
  if (raw === null || raw === "") return { ok: true, topics: RT_DEFAULT_TOPICS.slice() };
  const out = [];
  for (const k of String(raw).split(",")) {
    const x = k.trim();
    if (!RT_TOPIC_KEYS.includes(x)) return { ok: false };
    if (!out.includes(x)) out.push(x);
  }
  return out.length ? { ok: true, topics: out } : { ok: false };
}

export const haltsAdmitted = (env, owner) => eventRiskHalts(env) && eventRiskOpen(env, owner === true);

export function gateTopics(topics, admitted) {
  if (!topics.includes("ht") || admitted) return { ok: true, topics, dropped: null };
  if (topics.length === 1) return { ok: false };
  return { ok: true, topics: topics.filter((k) => k !== "ht"), dropped: "ht" };
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
  const parsed = rtTopics(url.searchParams.get("k"));
  if (!parsed.ok) throw new HttpError(400, "invalid_topic", "Unknown topic");
  const asked = path === "/api/rt/status" ? { ...parsed, dropped: null } : gateTopics(parsed.topics, haltsAdmitted(env, rtIsOwner(sw, session.username)));
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
      if (f && (!TICKER_RE.test(f) || (isFixtureTicker(f) && !fixtureHost(url.hostname)))) throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      target.searchParams.set("k", asked.topics.join(","));
      if (f) target.searchParams.set("f", f);
      const headers = new Headers(request.headers);
      for (const name of Array.from(headers.keys())) if (name.toLowerCase().startsWith("x-rt-")) headers.delete(name);
      headers.delete("Cookie");
      headers.set("X-RT-User", session.username);
      headers.set("X-RT-Exp", String(session.exp));
      const member = memberOf(readMembers(env.FLOWS_CREDENTIALS), session.username);
      headers.set("X-RT-Uep", String(member ? member.epoch : 0));
      res = await stub.fetch(new Request(target, { method: "GET", headers }));
    } else {
      if (path === "/api/rt/snap") {
        target.searchParams.set("k", asked.topics.join(","));
        const f = String(url.searchParams.get("f") || "").trim().toUpperCase();
        if (f && (!TICKER_RE.test(f) || (isFixtureTicker(f) && !fixtureHost(url.hostname)))) throw new HttpError(400, "invalid_ticker", "Unknown ticker");
        if (f) target.searchParams.set("f", f);
      }
      res = await stub.fetch(new Request(target, { method: "GET" }));
      if (path === "/api/rt/snap" && res.ok) {
        const owner = rtIsOwner(sw, session.username);
        res = new Response(res.body, res);
        res.headers.set("X-RT-Poll-Ms", String(owner ? RT_LIMITS.pollOwnerMs : RT_LIMITS.pollMemberMs));
        res.headers.set("X-RT-Poll-Cap-Ms", String(owner ? 0 : RT_LIMITS.pollMemberCapMs));
        if (asked.dropped) res.headers.set("X-RT-Dropped", asked.dropped);
      }
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

const RAIL_WAIT_MS = 1500;

export async function railReadiness(env) {
  const sw = rtSwitches(env);
  const ns = env && env.PULSE;
  if (sw.mode !== "on" || !ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") return { mode: "off", reachable: true };
  try {
    const stub = ns.get(ns.idFromName(RT_OBJECT_NAME), sw.hint ? { locationHint: sw.hint } : undefined);
    const asked = stub.fetch(new Request("https://pulse.internal/status", { method: "GET" })).then((res) => (res.ok ? res.json() : null));
    const body = await Promise.race([asked, new Promise((resolve) => setTimeout(() => resolve(null), RAIL_WAIT_MS))]);
    if (!body || typeof body !== "object") return { mode: "on", reachable: false };
    return { mode: "on", reachable: true, degraded: !!body.degraded, rosterError: !!(body.roster && body.roster.error) };
  } catch {
    return { mode: "on", reachable: false };
  }
}
