import { readFileSync } from "node:fs";
import { limiter } from "./ff-b-kit.mjs";
import { coreDouble } from "./ff-b-core.mjs";
import { alice, bob, astOf, seedHit, seedRun, NOW, PREV_SESSION, HOST } from "./ff-b-world.mjs";

const MUTATING = (id, hitId) => [
  ["POST", "/api/ff/wires", { ast: astOf() }],
  ["PATCH", "/api/ff/wires", { id, title: "x" }],
  ["POST", "/api/ff/house", { id: "h-t01", follow: false }],
  ["POST", "/api/ff/hits", { id: hitId, mark: "pinned" }],
  ["POST", "/api/ff/read", { all: true }],
  ["POST", "/api/ff/preview", { ast: astOf() }],
  ["POST", "/api/ff/mute", { symbol: "SYA101", mute: true }],
  ["PUT", "/api/ff/note", { wire: id, body: "x" }],
  ["DELETE", "/api/ff/note?wire=" + id, undefined],
];

const READS = [
  "/api/ff/health", "/api/ff/wires", "/api/ff/house", "/api/ff/hits", "/api/ff/digest", "/api/ff/symbol?t=SYA101", "/api/ff/export?from=2026-10-20&to=2026-10-27",
];

const seedOne = async (api) => {
  const made = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  const hit = seedHit(api.world.f, { stream: "alice.one", wire: made.body.wire.id, symbol: "SYA101", key: "g1" });
  return { id: made.body.wire.id, hitId: hit.hitId };
};

export async function sameOrigin(c, build) {
  const api = build();
  const { id, hitId } = await seedOne(api);
  const before = JSON.stringify(api.world.f.db.prepare("SELECT (SELECT count(*) FROM ff_wire) a, (SELECT count(*) FROM ff_mute) b, (SELECT count(*) FROM ff_note) c, (SELECT count(*) FROM ff_hit_mark) d, (SELECT count(*) FROM ff_house_off) e").get());
  for (const [method, path, body] of MUTATING(id, hitId)) {
    const label = method + " " + path.split("?")[0];
    const foreign = await api.call(method, path, { body, user: alice, origin: "https://evil.test" });
    c.eq([foreign.status, foreign.error && foreign.error.code], [403, "forbidden"], "origin: " + label + " from another origin is forbidden");
    c.eq(foreign.written, 0, "origin: " + label + " from another origin writes nothing");
    const nullOrigin = await api.call(method, path, { body, user: alice, origin: "null" });
    c.eq(nullOrigin.status, 403, "origin: " + label + " with the null origin is forbidden");
    const port = await api.call(method, path, { body, user: alice, origin: HOST + ":8443" });
    c.eq(port.status, 403, "origin: " + label + " from another port is forbidden");
    for (const site of ["cross-site", "same-site", "none"]) {
      const r = await api.call(method, path, { body, user: alice, headers: { "Sec-Fetch-Site": site } });
      c.eq(r.status, 403, "origin: " + label + " with Sec-Fetch-Site " + site + " is forbidden");
    }
    const subdomain = await api.call(method, path, { body, user: alice, origin: "https://evil.flows.test" });
    c.eq(subdomain.status, 403, "origin: " + label + " from a subdomain is forbidden");
    const good = await api.call(method, path, { body, user: alice, headers: { "Sec-Fetch-Site": "same-origin" } });
    c.ok(good.status < 500 && good.status !== 403, "origin: " + label + " from the same origin passes the gate", good.status);
    const bare = await api.call(method, path, { body, user: alice, origin: null });
    c.ok(bare.status !== 403, "origin: " + label + " with no origin header at all passes the gate, as a server-to-server client", bare.status);
  }
  const after = JSON.stringify(api.world.f.db.prepare("SELECT (SELECT count(*) FROM ff_wire) a, (SELECT count(*) FROM ff_mute) b, (SELECT count(*) FROM ff_note) c, (SELECT count(*) FROM ff_hit_mark) d, (SELECT count(*) FROM ff_house_off) e").get());
  c.ok(before !== "" && after !== "", "origin: the tables are readable afterwards");
  for (const path of READS) {
    const r = await api.call("GET", path, { user: alice, origin: "https://evil.test" });
    c.eq(r.status, 200, "origin: a read " + path.split("?")[0] + " does not check the origin");
  }
  const cross = build();
  const x = await cross.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice, origin: "https://evil.test" });
  c.eq(cross.world.f.db.prepare("SELECT count(*) AS n FROM ff_wire").get().n, 0, "origin: a cross-origin create made no wire");
  c.eq(x.status, 403, "origin: and was forbidden");
}

export async function methodsAndBodies(c, build) {
  const api = build();
  const { id } = await seedOne(api);
  const table = [
    ["/api/ff/health", ["GET"]], ["/api/ff/wires", ["GET", "POST", "PATCH"]], ["/api/ff/house", ["GET", "POST"]], ["/api/ff/hits", ["GET", "POST"]], ["/api/ff/read", ["POST"]],
    ["/api/ff/preview", ["POST"]], ["/api/ff/receipts", ["GET"]], ["/api/ff/records", ["GET"]], ["/api/ff/symbol", ["GET"]], ["/api/ff/digest", ["GET"]], ["/api/ff/export", ["GET"]],
    ["/api/ff/mute", ["POST"]], ["/api/ff/note", ["PUT", "DELETE"]], ["/api/ff/run", ["POST"]],
  ];
  const all = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  for (const [path, allowed] of table) {
    for (const method of all.filter((m) => !allowed.includes(m))) {
      const r = await api.call(method, path, { body: method === "GET" || method === "DELETE" ? undefined : {}, user: alice });
      c.eq([r.status, r.error && r.error.code], [405, "method_not_allowed"], "methods: " + method + " " + path + " is a 405");
      c.ok(allowed.every((m) => (r.headers.allow || "").includes(m)), "methods: " + path + " names its methods in Allow", r.headers.allow);
      c.eq(r.trips, 0, "methods: " + method + " " + path + " reads nothing");
    }
  }
  for (const path of ["/api/ff/wires/", "/api/ff/wires/" + id, "/api/ff/wires%2F", "/api/ff", "/api/ff/", "/api/ff/unknown", "/api/ff/Wires", "/api/ff/wires/x/y"]) {
    const r = await api.call("GET", path, { user: alice });
    c.ok(r.unrouted === true, "paths: " + path + " matches no row, the router matches exact paths", r.status);
  }
  const head = await api.call("HEAD", "/api/ff/wires", { user: alice });
  c.eq(head.status, 405, "methods: HEAD is not offered");

  for (const [path, method] of [["/api/ff/wires", "POST"], ["/api/ff/hits", "POST"], ["/api/ff/read", "POST"], ["/api/ff/preview", "POST"], ["/api/ff/mute", "POST"], ["/api/ff/note", "PUT"], ["/api/ff/house", "POST"], ["/api/ff/wires", "PATCH"]]) {
    const label = method + " " + path;
    const noType = await api.call(method, path, { raw: "{}", user: alice, headers: { "Content-Type": "text/plain" } });
    c.eq([noType.status, noType.error && noType.error.code], [415, "unsupported_media_type"], "bodies: " + label + " needs application/json");
    const bad = await api.call(method, path, { raw: "{not json", user: alice });
    c.eq([bad.status, bad.error && bad.error.code], [400, "invalid_json"], "bodies: " + label + " refuses malformed JSON");
    const arr = await api.call(method, path, { raw: "[1,2]", user: alice });
    c.eq(arr.status, 400, "bodies: " + label + " refuses an array");
    const big = await api.call(method, path, { raw: JSON.stringify({ ast: astOf(), pad: "x".repeat(17000) }), user: alice });
    c.eq(big.status, 413, "bodies: " + label + " refuses a body over 16 KiB");
    const empty = await api.call(method, path, { raw: "", user: alice });
    c.ok(empty.status === 400, "bodies: " + label + " refuses an empty body", empty.status);
    const extra = await api.call(method, path, { body: { zzz: 1 }, user: alice });
    c.eq([extra.status, extra.error && extra.error.code], [400, "ff_grammar_invalid"], "bodies: " + label + " refuses a field it does not take");
  }
  const form = await api.call("POST", "/api/ff/wires", { raw: "ast=1", user: alice, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  c.eq(form.status, 415, "bodies: a form post is refused");
  const charset = await api.call("POST", "/api/ff/mute", { raw: JSON.stringify({ symbol: "SYA101", mute: true }), user: alice, headers: { "Content-Type": "application/json; charset=utf-8" } });
  c.eq(charset.status, 200, "bodies: a charset parameter is fine");
  const idemLong = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice, headers: { "Idempotency-Key": "k".repeat(129) } });
  c.eq(idemLong.status, 400, "bodies: an idempotency key over 128 characters is refused");
  const idemOk = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB201"] } }) }, user: alice, headers: { "Idempotency-Key": "k".repeat(128) } });
  c.eq(idemOk.status, 201, "bodies: and one of 128 is fine");
  const ids = ["", "w-", "w-ABCDEFGHIJKLMNOP", "w-abcdefghijklmnop1", "w-abcdefghijklmno", "x-abcdefghijklmnop", "' OR 1=1 --", "w-abcdefghijklmn0p", "h-t1", "h-t011"];
  for (const bad of ids) {
    const get = await api.call("GET", "/api/ff/wires?id=" + encodeURIComponent(bad), { user: alice });
    c.eq(get.status, 404, "ids: " + JSON.stringify(bad) + " as a wire id");
    const hit = await api.call("GET", "/api/ff/hits?id=" + encodeURIComponent(bad), { user: alice });
    c.ok(hit.status === 404 || hit.status === 200, "ids: " + JSON.stringify(bad) + " as a hit id", hit.status);
  }
}

export async function anonymousAndRun(c, build) {
  const api = build();
  for (const path of READS) {
    const r = await api.call("GET", path, { user: null });
    c.eq([r.status, r.error && r.error.code], [401, "unauthorized"], "anonymous: " + path.split("?")[0] + " is unauthorized");
    c.eq(r.trips, 0, "anonymous: and reads nothing");
  }
  for (const [method, path, body] of MUTATING("w-aaaaaaaaaaaaaaaa", "a".repeat(20))) {
    const r = await api.call(method, path, { body, user: null });
    c.eq(r.status, 401, "anonymous: " + method + " " + path.split("?")[0] + " is unauthorized");
  }
  const noAuth = await api.call("POST", "/api/ff/run", { body: { cadence: "nightly", session: PREV_SESSION }, user: null });
  c.eq([noAuth.status, noAuth.error && noAuth.error.code], [401, "unauthorized"], "run: without a runner credential it is unauthorized");

  const calls = [];
  const wired = build({
    deps: {
      runAuth: async (request) => (request.headers.get("Authorization") === "Bearer nightly-token" ? "nightly" : request.headers.get("Authorization") === "Bearer live-token" ? "live" : null),
      evaluate: async (args) => { calls.push(args); return { accepted: true, cadence: args.cadence, session: args.session, kind: args.kind }; },
    },
  });
  const good = await wired.call("POST", "/api/ff/run", { body: { cadence: "nightly", session: PREV_SESSION }, user: null, headers: { Authorization: "Bearer nightly-token" } });
  c.eq([good.status, good.body.run], [200, { accepted: true, cadence: "nightly", session: PREV_SESSION, kind: "nightly" }], "run: a valid credential starts the evaluation");
  c.eq(calls.length, 1, "run: the evaluator was called once");
  c.eq(calls[0].now, NOW, "run: with the server's clock");
  const bad = await wired.call("POST", "/api/ff/run", { body: { cadence: "nightly", session: PREV_SESSION }, user: null, headers: { Authorization: "Bearer wrong" } });
  c.eq(bad.status, 401, "run: a wrong credential is unauthorized");
  const cookieOnly = await wired.call("POST", "/api/ff/run", { body: { cadence: "nightly", session: PREV_SESSION }, user: alice });
  c.eq(cookieOnly.status, 401, "run: a member session is not a runner credential");
  c.eq(calls.length, 1, "run: and neither refused call reached the evaluator");
  for (const body of [{}, { cadence: "weekly", session: PREV_SESSION }, { cadence: "nightly", session: "2026-13-45x" }, { cadence: "nightly", session: PREV_SESSION, extra: 1 }, { cadence: "nightly" }]) {
    const r = await wired.call("POST", "/api/ff/run", { body, user: null, headers: { Authorization: "Bearer nightly-token" } });
    c.eq([r.status, r.error && r.error.code], [400, "ff_grammar_invalid"], "run: " + JSON.stringify(body) + " is refused");
  }
  const live = await wired.call("POST", "/api/ff/run", { body: { cadence: "live", session: PREV_SESSION }, user: null, headers: { Authorization: "Bearer live-token" } });
  c.eq(live.body.run.kind, "live", "run: the credential's kind is passed on");
  const off = build({ world: { env: { FF_MODE: "off" } }, deps: { runAuth: async () => "nightly", evaluate: async () => ({}) } });
  const refused = await off.call("POST", "/api/ff/run", { body: { cadence: "nightly", session: PREV_SESSION }, user: null, headers: { Authorization: "Bearer nightly-token" } });
  c.eq([refused.status, refused.body.reason], [404, "mode_off"], "run: the master switch stops it");
  const none = build({ deps: { runAuth: async () => "nightly" } });
  const missing = await none.call("POST", "/api/ff/run", { body: { cadence: "nightly", session: PREV_SESSION }, user: null });
  c.eq([missing.status, missing.error && missing.error.code], [503, "ff_evaluator_unavailable"], "run: with no evaluator wired it says so");
}

export async function noVendorCalls(c, build) {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    seen.push(String(input && input.url ? input.url : input));
    throw new Error("no network in this suite");
  };
  try {
    const api = build({ world: { env: { UW_API_KEY: "SENTINEL-vendor-key-9c1", UW_BASE: "https://uw.test" } } });
    const { id, hitId } = await seedOne(api);
    const text = [];
    for (const [method, path, body] of [
      ...MUTATING(id, hitId),
      ["GET", "/api/ff/wires", undefined], ["GET", "/api/ff/hits", undefined], ["GET", "/api/ff/health", undefined], ["GET", "/api/ff/digest", undefined], ["GET", "/api/ff/house", undefined],
      ["GET", "/api/ff/symbol?t=SYA101", undefined], ["GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", undefined], ["GET", "/api/ff/receipts?wire=" + id, undefined], ["GET", "/api/ff/records?wire=" + id, undefined],
    ]) {
      const r = await api.call(method, path, { body, user: alice });
      text.push(r.text);
    }
    const live = build();
    live.world.core.setSession("2026-10-27");
    const lv = await live.call("POST", "/api/ff/preview", { body: { ast: { v: 1, cadence: "live", scope: { kind: "names", symbols: ["SYA101"] }, all: [{ m: "contract.dte", op: "<=", x: 21 }, { m: "contract.premium", op: ">=", x: 1000000 }], persist: 1 } }, user: alice });
    text.push(lv.text);
    c.eq(seen, [], "vendor: no route makes a network call");
    c.ok(!text.join("\n").includes("SENTINEL-vendor-key-9c1"), "vendor: the vendor key appears in no reply");
  } finally {
    globalThis.fetch = realFetch;
  }
  const files = ["server/ff-store.js", "server/ff-health.js", "server/ff-preview.js", "server/ff-records.js", "server/ff-digest.js", "server/ff-export.js", "server/routes/flows-ff.js"];
  for (const f of files) {
    const src = readFileSync(new URL("../../" + f, import.meta.url), "utf8");
    c.ok(!/\bfetch\s*\(|uwFetch|UW_API_KEY|UW_BASE|unusualwhales|\bAI\b\s*[.\[]|env\.AI/.test(src), "vendor: " + f + " reaches for neither the network, the vendor key nor a model");
  }
}

export async function ringLimiter(c, build) {
  const seen = [];
  const heavy = limiter(2, seen);
  const api = build({ world: { env: { FF_HEAVY: heavy } } });
  const { id } = await seedOne(api);
  const codes = [];
  for (const path of ["/api/ff/receipts?wire=" + id, "/api/ff/records?wire=" + id, "/api/ff/symbol?t=SYA101", "/api/ff/digest", "/api/ff/export?from=2026-10-20&to=2026-10-27"]) codes.push((await api.call("GET", path, { user: alice })).status);
  c.eq(codes, [200, 200, 429, 429, 429], "limiter: the heavy reads share one budget per member");
  const refused = await api.call("GET", "/api/ff/digest", { user: alice });
  c.eq([refused.error.code, refused.headers["retry-after"], refused.trips], ["rate_limited", "60", 0], "limiter: a refusal carries Retry-After and reads nothing");
  c.ok(seen.every((k) => k === "alice.one"), "limiter: keyed by the session member", [...new Set(seen)]);

  const write = limiter(3);
  const w = build({ world: { env: { FF_WRITE: write } } });
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await w.call("POST", "/api/ff/mute", { body: { symbol: "SYA10" + (i % 3 + 1), mute: true }, user: alice })).status);
  c.eq(results, [200, 200, 200, 429, 429], "limiter: ten writes a minute is the write budget, here three");
  const reads = await w.call("GET", "/api/ff/wires", { user: alice });
  c.eq(reads.status, 200, "limiter: reads are never counted against the write budget");
  const hitsFirst = build({ world: { env: { FF_HEAVY: limiter(0) } } });
  const first = await hitsFirst.call("GET", "/api/ff/hits", { user: alice });
  c.eq(first.status, 200, "limiter: the inbox's first page is never throttled");
  const page = await hitsFirst.call("GET", "/api/ff/hits?cursor=" + Buffer.from(JSON.stringify({ v: 1, h: 5, m: 5 })).toString("base64url"), { user: alice });
  c.eq([page.status, page.error && page.error.code], [429, "rate_limited"], "limiter: paging back goes through the heavy limiter");
  const pinned = await hitsFirst.call("GET", "/api/ff/hits?state=pinned", { user: alice });
  c.eq(pinned.status, 429, "limiter: and so do the pinned and archived lists");
}

export async function storeFailures(c, build) {
  const api = build();
  const { id } = await seedOne(api);
  api.world.f.fail(/FROM ff_wire w JOIN ff_wire_version/);
  let threw = false;
  try {
    await api.call("GET", "/api/ff/wires", { user: alice });
  } catch (e) {
    threw = /refused/.test(String(e.message));
  }
  c.eq(threw, true, "store: a failed read propagates to the Worker's own handler, which maps it to a 503 or 500");
  const create = build();
  create.world.f.fail(/INSERT INTO ff_wire \(/);
  let createThrew = false;
  try {
    await create.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  } catch {
    createThrew = true;
  }
  c.eq([createThrew, create.world.f.db.prepare("SELECT count(*) AS n FROM ff_wire").get().n, create.world.f.db.prepare("SELECT count(*) AS n FROM ff_wire_symbol").get().n], [true, 0, 0], "store: a create whose first statement fails leaves nothing behind");
  const noDb = build();
  const r = await noDb.call("GET", "/api/ff/wires", { user: alice, env: { DB: undefined } });
  c.eq([r.status, r.error && r.error.code], [503, "store_unreadable"], "store: no D1 binding is store_unreadable");
  void id;
}
