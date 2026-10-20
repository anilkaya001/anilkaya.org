import assert from "node:assert/strict";
import * as K from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsRtRows } from "../server/routes/flows-rt.js";
import { serveRt, RT_PATHS } from "../shared/flows-rt-routes.js";
import { FIXTURE_MEMBER } from "./lib/fixture-roster.mjs";
import { workerSource, expect, absent, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const forwarded = [];
const stub = {
  fetch: async (req) => {
    const u = new URL(req.url);
    forwarded.push([u.pathname, u.search, req.headers.get("X-RT-User")]);
    return new Response(JSON.stringify({ running: false, topics: {}, path: u.pathname }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
};
const ns = { idFromName: (n) => ({ n }), get: () => stub };
const ENVS = {
  on: { FLOWS_RT_MODE: "on", PULSE: ns, FLOWS_RT_USERS: "anilkaya", FLOWS_RT_HINT: "enam" },
  off: { FLOWS_RT_MODE: "off", PULSE: ns },
  unset: { PULSE: ns },
  nobinding: { FLOWS_RT_MODE: "on" },
  members: { FLOWS_RT_MODE: "on", PULSE: ns, FLOWS_RT_AUDIENCE: "members", FLOWS_RT_USERS: "anilkaya" },
};
const USERS = [null, { username: "anilkaya", exp: 1790780000000 }, { username: FIXTURE_MEMBER, exp: 1790780000000 }];
const WS = { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==", "Sec-WebSocket-Version": "13" };
const HEADERS = [{}, WS, { ...WS, Origin: "https://evil.example" }, { ...WS, Origin: "https://anilkaya.org", "X-RT-User": "forged", Cookie: "flows_session=x" }];
const PATHS = [...RT_PATHS, "/api/rt/", "/api/rt/zz", "/api/rt/ws/", "/api/rt/WS", "/api/rt", "/api/rt/status/x"];
const QUERIES = ["", "?k=px", "?k=px,fl,gx,mk,nw", "?k=zz", "?k=", "?f=nvda", "?f=%40%40", "?k=px&f=NVDA"];
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const scenario = (user) => {
  const log = [];
  const serve = (request, env, url) => serveRt(request, env, url, {
    json: K.json, HttpError: K.HttpError, requireSameOrigin: K.requireSameOrigin,
    getSession: async () => { log.push("session"); return user; },
  });
  return { log, serve };
};

const view = (e) => ({ status: e.status, code: e.code, message: e.message, headers: e.headers });
async function outcome(run) {
  try {
    const res = await run();
    if (res === null) return { fell: true };
    return { status: res.status, headers: [...res.headers].sort(), body: await res.text() };
  } catch (e) {
    if (e instanceof K.HttpError) return { threw: view(e) };
    throw e;
  }
}

const chain = (path, request, env, url, serve) => (path.startsWith("/api/rt/") ? serve(request, env, url) : null);

const table = createRouter(flowsRtRows({ serveRt: scenario(null).serve }));
eq(table.rows.map((r) => r.path), [...RT_PATHS], "the family is the rail's three paths, in the rail's own order");
ok(table.rows.every((r) => r.auth === "none" && r.methods.length === 1 && r.methods[0] === "*"), "every row decides its own method and its own session: the rail answers its kill switch before it looks at either");
eq(table.rows.map((r) => r.id), ["flows.rt.ws", "flows.rt.snap", "flows.rt.status"], "ids are namespaced by the path");

let compared = 0;
let reached = 0;
for (const path of PATHS) {
  for (const q of QUERIES) {
    for (const method of METHODS) {
      for (const [envName, env] of Object.entries(ENVS)) {
        for (const user of USERS) {
          for (const headers of HEADERS) {
            if (path !== RT_PATHS[0] && headers !== HEADERS[0] && headers !== HEADERS[1]) continue;
            const mk = () => {
              const sc = scenario(user);
              const url = new URL("https://anilkaya.org" + path + q);
              return { sc, request: new Request(url, { method, headers }), url };
            };
            const a = mk();
            const b = mk();
            const router = createRouter(flowsRtRows({ serveRt: a.sc.serve }));
            const viaRouter = await outcome(() => router.handle({ request: a.request, env, url: a.url, ctx: {} }, { flows: async () => assert.fail("the rail rows never consult the Flows gate") }));
            const key = `${method} ${path}${q} ${envName} ${user && user.username} ${Object.keys(headers).length}`;
            if (RT_PATHS.includes(path)) {
              const want = await outcome(() => chain(path, b.request, env, b.url, b.sc.serve));
              eq(viaRouter, want, key);
              eq(a.sc.log, b.sc.log, key + ": the same session reads");
              reached++;
            } else {
              eq(viaRouter, { fell: true }, key + ": a path that is not a row falls through to the chain");
              eq(a.sc.log, [], key + ": and reads no session");
            }
            compared++;
          }
        }
      }
    }
  }
}
ok(compared >= 5000 && reached >= 3000, `every path, query, method, environment, member and header set was compared with the code it replaced: ${compared} (${reached} on a row)`);

{
  const sc = scenario(USERS[1]);
  const router = createRouter(flowsRtRows({ serveRt: sc.serve }));
  const call = (path, method = "GET") => router.handle({ request: new Request("https://anilkaya.org" + path, { method }), env: ENVS.on, url: new URL("https://anilkaya.org" + path), ctx: {} }, { flows: async () => null });
  forwarded.length = 0;
  const snap = await call("/api/rt/snap?k=px,fl");
  eq([snap.status, snap.headers.get("X-RT-Poll-Ms"), snap.headers.get("X-RT-Poll-Cap-Ms")], [200, "5000", "0"], "the owner's snapshot is served with the owner's poll interval and no cap");
  eq(forwarded, [["/snap", "?k=px%2Cfl", null]], "and forwarded to the one named object with the topics normalised");
  eq(sc.log, ["session"], "the session is read once");
  const off = await (async () => { try { await router.handle({ request: new Request("https://anilkaya.org/api/rt/status", { method: "OPTIONS" }), env: ENVS.off, url: new URL("https://anilkaya.org/api/rt/status"), ctx: {} }, {}); } catch (e) { return view(e); } })();
  eq([off.status, off.code], [404, "rt_off"], "with the rail off even OPTIONS is the kill switch's 404, not a 405 from the router");
  const post = await (async () => { try { await call("/api/rt/snap", "POST"); } catch (e) { return view(e); } })();
  eq([post.status, post.code, post.headers.Allow], [405, "method_not_allowed", "GET"], "with it on, POST is the rail's own 405 naming GET");
}

{
  const w = workerSource();
  const text = moduleSource("worker.js");
  expect(w, /\}\s*\}\),\s*flowsRtRows\(\{ serveRt: rtServe \}\)\);/, { min: 1, max: 1, why: "the Worker's one table takes the rail family after the pages" });
  expect(text, /\bserveRt\(/, { min: 1, max: 1, why: "the Worker names the rail's handler in one call, bound once" });
  expect(text, /const rtServe = \(request, env, url\) => serveRt\(request, env, url, \{ json, HttpError, requireSameOrigin, getSession: \(\) => currentFlowsUser\(request, env\) \}\);/, { min: 1, max: 1, why: "with the helpers the chain's branch had" });
  expect(text, /if \(path\.startsWith\("\/api\/rt\/"\)\) \{\s*return rtServe\(request, env, url\);\s*\}/, { min: 1, max: 1, why: "the prefix branch stays in the chain for every path that is not a row, so an unknown /api/rt/ path is still the kill switch's 404 or a JSON not_found" });
  absent(text, /path === "\/api\/rt\//, { anchor: /path\.startsWith\("\/api\/rt\/"\)/, why: "no rail path is a literal branch of the chain any more" });
  const src = moduleSource("server/routes/flows-rt.js");
  ok(!/from "\.\.\/\.\.\/worker\.js"|cloudflare:|\bfetch\(|\benv\.\w+/.test(src), "the family imports neither the Worker nor the platform and reads no binding: the handler is injected");
  ok(!/\bnew HttpError\b|\bjson\(/.test(src), "and answers nothing itself");
  ok(/export const RT_PATHS = Object\.freeze\(\["\/api\/rt\/ws", "\/api\/rt\/snap", "\/api\/rt\/status"\]\);/.test(moduleSource("shared/flows-rt-routes.js")), "the three paths are declared once, beside the handler that serves them");
}

console.log("server-rt: " + checks + " checks");
