import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { FLOWS_COOKIE, FLOWS_USERNAMES, LEARN_AUDIENCE, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { signSession } from "../shared/session.js";
import { memoClock } from "../shared/flows-live-worker.js";
import { COURSE_BY_SLUG } from "../shared/course-seo.js";
import { workerSource, slice, expect, count, treeFiles, moduleSource } from "./lib/source-scan.mjs";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { flowsReadRows } from "../server/routes/flows-read.js";
import { createRouter } from "../server/router.js";

const FIXTURE_PATH = new URL("./fixtures-route-matrix.json", import.meta.url);
const WRITE = process.argv.includes("--write");
const NOW_ISO = "2026-09-25T13:00:00.000Z";
const SESSION_SECRET = "route-matrix-session-secret-abcdefghijklmnopqrstuvwxyz";
const INGEST_TOKEN = "route-matrix-ingest-token-abcdefghijklmnopqrstuvwxyz";
const BUDGET_MS = 30000 * (Number(process.env.TIMEOUT_SCALE) > 0 ? Number(process.env.TIMEOUT_SCALE) : 1);

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const RealDate = Date;
const PINNED = RealDate.parse(NOW_ISO);
function pinClock() {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(PINNED); }
    static now() { return PINNED; }
  };
  return () => { globalThis.Date = RealDate; };
}

const realFetch = globalThis.fetch;
let outbound = 0;
const realConsole = { error: console.error, warn: console.warn, log: console.log };

const OWNER = "anilkaya";
const MEMBER = FLOWS_USERNAMES.find((n) => n !== OWNER);
const LAB_ID = "g_route_matrix_user";
const SECURITY = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "X-Permitted-Cross-Domain-Policies": "none",
};
const FRESH_VALUE = ["State", "Reason", "Class", "Source", "Cadence", "Phase"];
const FRESH_PRESENT = ["Read-At", "Live-Until", "Stale-At", "Phase-Ends", "Last-Good"];

const FLOWS_API = ["board", "market", "events", "scoretrack", "meta", "flowalerts", "pulse", "news", "lk", "now", "tape", "political",
  "unusual", "movers", "sectors", "sector-premium", "universe", "regime", "ideas", "focus", "roster", "ai-usage", "summary", "dossier",
  "live", "brief", "ask", "record", "card", "card-x", "hist", "chain", "strategy", "ingest"];
const FLOWS_PAGES_SLASH = ["", "long", "short", "watch", "market", "history", "desk", "strategy", "ask", "ticker", "unusual", "events", "track", "political"];
const FLOWS_PAGES_BARE = ["long", "short", "desk", "watch", "history", "market", "ticker", "unusual", "events", "track", "political", "strategy", "ask"];
const LEGACY = ["/lab/course", "/lab/course.html", "/lab/course/", "/lab/lesson", "/lab/lesson.html", "/lab/lesson/"];
const SLUGS = Object.keys(COURSE_BY_SLUG);

const MUTATING = new Set(["/auth/logout", "/api/v2/progress", "/api/v2/attempt", "/api/v2/preferences", "/api/v2/project",
  "/api/progress", "/api/stats", "/api/placement", "/api/mastery", "/flows/login", "/flows/logout", "/api/flows/ask", "/api/flows/ingest"]);

const rows = [];
const row = (path, extra = {}) => rows.push({ path, ...extra });
const LIGHT = { principals: ["anon", "owner"], methods: ["GET", "HEAD", "POST"] };
const light = (path, extra = {}) => row(path, { ...LIGHT, ...extra });

for (const p of ["/auth/google", "/auth/callback", "/auth/logout", "/auth/zz"]) row(p);
for (const p of ["/api/me", "/api/markets", "/api/v2/bootstrap", "/api/v2/progress", "/api/v2/attempt", "/api/v2/preferences", "/api/v2/project",
  "/api/bootstrap", "/api/progress", "/api/stats", "/api/placement", "/api/mastery", "/api/zz"]) row(p);
row("/flows");
light("/flows/login/");
row("/flows/login", { body: "form" });
row("/flows/logout");
for (const name of FLOWS_PAGES_SLASH) light("/flows/" + name + (name ? "/" : ""));
for (const name of FLOWS_PAGES_BARE) light("/flows/" + name);
for (const name of ["long", "short", "watch", ""]) light("/flows/" + name + (name ? "/" : "") + "?t=NVDA");
light("/flows/zz/");
light("/flows/zz");
for (const name of FLOWS_API) {
  if (name === "ingest") row("/api/flows/ingest", { principals: ["anon", "member", "owner", "lab", "ingest"] });
  else row("/api/flows/" + name);
}
for (const q of ["board?side=short", "summary?t=NVDA", "dossier?t=NVDA", "card?t=NVDA", "hist?t=NVDA", "chain?t=NVDA", "strategy?t=NVDA",
  "lk?k=market,strips", "now?n=board:long,meta", "tape?t=NVDA"]) light("/api/flows/" + q, { principals: ["anon", "member"] });
row("/api/flows/zz");
light("/api/flows/zz/yy", { principals: ["anon", "member"] });
for (const envName of ["pulse-absent", "off", "on"]) {
  for (const p of ["/api/rt/ws", "/api/rt/snap", "/api/rt/status", "/api/rt/snap?k=px,zz", "/api/rt/zz"]) row(p, { env: envName });
}
row("/api/rt/ws", { env: "on", headers: { Upgrade: "websocket" }, tag: "upgrade" });
for (const p of LEGACY) { light(p, { principals: ["anon"] }); light(p + "?m=ols", { principals: ["anon"] }); light(p + "?m=nope", { principals: ["anon"] }); }
for (const slug of SLUGS.slice(0, 3)) { light("/lab/" + slug + "/", { principals: ["anon"] }); light("/lab/" + slug, { principals: ["anon"] }); }
light("/lab/zz/", { principals: ["anon"] });
light("/lab/zz", { principals: ["anon"] });
light("/lab/", { principals: ["anon"] });
light("/", { principals: ["anon"] });
light("/index.html", { principals: ["anon"] });
light("/articles/", { principals: ["anon"] });
light("/assets/css/base.css?v=1", { principals: ["anon"] });
light("/assets/css/base.css", { principals: ["anon"] });
light("/robots.txt", { principals: ["anon"] });

const PRINCIPALS = ["anon", "member", "owner", "lab"];
const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"];

function seed(f) {
  const NIGHTLY = { v: 1, sessionDate: "2026-09-24", generatedAt: "2026-09-25T00:10:00.000Z" };
  for (const key of ["board:long", "board:short", "board:watch", "market", "scoretrack", "sector:premium", "news", "regime", "focus", "meta"]) {
    f.put(key, { ...NIGHTLY, rows: [] });
  }
  f.put("events", { ...NIGHTLY, rows: [] });
  f.put("flowalerts", { v: 2, ...NIGHTLY, readAt: NIGHTLY.generatedAt, rows: [], status: "quiet" });
  f.put("pulse", { ...NIGHTLY, totals: { calls: 1 }, tide: { status: "ok", points: [] } });
  f.put("universe", { ...NIGHTLY, n: 2, t: ["NVDA", "LITE"], sectors: ["Technology"], sec: [0, 0],
    units: { px: ["usd", 100] }, cols: { px: [17000, 7252] }, pct: { px: [90, 50] } });
  f.put("roster", { v: 1, sessionDate: "2020-01-02", depth: { NVDA: "focus" } });
  f.put("card:NVDA", { ...NIGHTLY, ticker: "NVDA", panels: {}, score: 61, conviction: 70 });
  f.db.exec("INSERT INTO users (id, email, name, created_at, signed_in_at) VALUES ('" + LAB_ID + "', 'matrix@example.test', 'Matrix', 1790380000000, 1790380000000)");
  f.db.exec("INSERT INTO learning_sync (user_id, generation) VALUES ('" + LAB_ID + "', 0)");
  f.db.exec("INSERT INTO stats (user_id, points, streak, last, updated_at) VALUES ('" + LAB_ID + "', 0, 0, NULL, 1790380000000)");
}

const assetsFake = {
  async fetch(request) {
    const url = new URL(request.url);
    const html = !/\.(css|js|json|txt|svg|woff2)$/.test(url.pathname);
    return new Response("asset " + url.pathname, {
      status: 200,
      headers: { "Content-Type": html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "X-Fake-Assets": "1" },
    });
  },
};
const pulseFake = {
  idFromName: (name) => name,
  get: () => ({
    async fetch(request) {
      return new Response(JSON.stringify({ ok: true, path: new URL(request.url).pathname }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  }),
};

function envFor(label, D1, tokens) {
  const base = {
    DB: D1, ASSETS: assetsFake, SESSION_SECRET, FLOWS_PEPPER: "route-matrix-pepper",
    FLOWS_INGEST_TOKEN: INGEST_TOKEN, FLOWS_READ_MODE: "off",
    FLOWS_CREDENTIALS: JSON.stringify({ [OWNER]: "x".repeat(43), [MEMBER]: "y".repeat(43) }),
  };
  if (label === "pulse-absent") return { ...base, FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "members" };
  if (label === "off") return { ...base, FLOWS_RT_MODE: "off", PULSE: pulseFake };
  if (label === "on") return { ...base, FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "owner", PULSE: pulseFake };
  return base;
}

function headersFor(principal, tokens, method, mode, rowHeaders) {
  const h = { "Sec-Fetch-Site": "same-origin", ...(rowHeaders || {}) };
  if (principal === "member") h.cookie = FLOWS_COOKIE + "=" + tokens.member;
  if (principal === "owner") h.cookie = FLOWS_COOKIE + "=" + tokens.owner;
  if (principal === "lab") { h.cookie = "session=" + tokens.lab; h["X-IEWT-Owner"] = LAB_ID; }
  if (principal === "ingest") h.Authorization = "Bearer " + INGEST_TOKEN;
  if (method === "PUT" || method === "DELETE") h["X-IEWT-Generation"] = "0";
  if (mode === "cross") { h["Sec-Fetch-Site"] = "cross-site"; h.Origin = "https://evil.example"; }
  if (mode === "mismatch") h["X-IEWT-Owner"] = "g_someone_else";
  return h;
}

function cookiesOf(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return list.map((c) => {
    const [first, ...attrs] = c.split(";").map((x) => x.trim());
    const eqAt = first.indexOf("=");
    const name = first.slice(0, eqAt);
    const value = first.slice(eqAt + 1);
    return name + "=" + (value === "" ? "<empty>" : "<set>") + (attrs.length ? ";" + attrs.join(";") : "");
  }).join(" ");
}

function summarize(res, text) {
  const out = [String(res.status)];
  const add = (key, value) => { if (value !== null && value !== undefined && value !== "") out.push(key + "=" + value); };
  const ct = res.headers.get("Content-Type");
  add("allow", res.headers.get("Allow"));
  add("ct", ct);
  add("cc", res.headers.get("Cache-Control"));
  add("loc", res.headers.get("Location"));
  if (ct && /json/.test(ct)) {
    try { const j = JSON.parse(text); add("code", j && j.error && j.error.code); } catch { add("code", "!json"); }
  }
  const bad = Object.keys(SECURITY).filter((n) => res.headers.get(n) !== SECURITY[n]);
  add("sec", bad.length ? "MISSING:" + bad.join(",") : "ok");
  for (const n of FRESH_VALUE) add("f" + n, res.headers.get("X-Fresh-" + n));
  for (const n of FRESH_PRESENT) if (res.headers.has("X-Fresh-" + n)) add("has", n);
  if (res.headers.has("X-Server-Now")) add("has", "Server-Now");
  add("cookie", cookiesOf(res));
  return out.join(" ");
}

async function drive() {
  const results = new Map();
  const restoreClock = pinClock();
  console.error = console.warn = () => {};
  globalThis.fetch = async () => { outbound++; return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } }); };
  const started = performance.now();
  let instance = 0;
  let requests = 0;
  try {
    const tokens = {
      owner: await signFlowsSession(OWNER, SESSION_SECRET, 3600, sessionEpoch({ SESSION_SECRET })),
      member: await signFlowsSession(MEMBER, SESSION_SECRET, 3600, sessionEpoch({ SESSION_SECRET })),
      lab: await signSession({ sub: LAB_ID, email: "matrix@example.test", name: "Matrix", aud: LEARN_AUDIENCE, exp: PINNED + 3600000 }, SESSION_SECRET),
    };
    for (const r of rows) {
      const worker = (await import("../worker.js?matrix=" + (++instance))).default;
      const label = r.env || "base";
      for (const principal of r.principals || PRINCIPALS) {
        for (const method of r.methods || METHODS) {
          const modes = MUTATING.has(r.path.split("?")[0]) && method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && principal !== "anon" && principal !== "ingest"
            ? ["default", "cross", "mismatch"] : ["default"];
          for (const mode of modes) {
            const f = fakeD1({ latencyMs: 0 });
            seed(f);
            memoClock(null, 0);
            const init = { method, headers: headersFor(principal, tokens, method, mode, r.headers) };
            if (method !== "GET" && method !== "HEAD") {
              init.body = r.body === "form" ? "username=" + OWNER + "&password=wrong" : "{}";
              init.headers["Content-Type"] = r.body === "form" ? "application/x-www-form-urlencoded" : "application/json";
            }
            const background = [];
            const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) };
            const res = await worker.fetch(new Request("https://anilkaya.org" + r.path, init), envFor(r.env, f.D1), ctx);
            const text = await res.text();
            await Promise.race([Promise.all(background), new Promise((resolve) => setTimeout(resolve, 1500))]);
            requests++;
            const key = [label, principal, method + (mode === "default" ? "" : "/" + mode), r.path + (r.tag ? "#" + r.tag : "")].join(" ");
            if (results.has(key)) throw new Error("route-matrix: duplicate request key " + key);
            results.set(key, summarize(res, text));
          }
        }
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    console.error = realConsole.error;
    console.warn = realConsole.warn;
    restoreClock();
  }
  return { results, requests, elapsedMs: performance.now() - started };
}

const src = workerSource();

{
  const literals = new Set();
  for (const m of src.matchAll(/\bpath === "(\/[^"]*)"/g)) literals.add(m[1]);
  for (const m of src.matchAll(/^\s+"(\/flows\/[a-z/]*)": \(u/gm)) literals.add(m[1]);
  for (const m of slice(src, "const LEGACY_COURSE_PATHS = new Set([", "]);").matchAll(/"(\/lab\/[^"]+)"/g)) literals.add(m[1]);
  expect(src, /\bpath === "\//, { min: 40, why: "the route chain is scanned, not an empty match" });
  const table = createRouter(flowsReadRows(new Proxy({}, { get: () => () => null }))).rows;
  ok(table.length >= 20, "the router table holds the flows-read family: " + table.length + " rows");
  for (const r of table) literals.add(r.path);
  ok(literals.size >= 70, "the chain and the table together declare every route literal: " + literals.size);
  const covered = new Set(rows.map((r) => r.path.split("?")[0]));
  const missing = [...literals].filter((p) => !covered.has(p));
  eq(missing.length, 0, "EVERY ROUTE LITERAL IN THE WORKER IS A ROW OF THE MATRIX; missing: " + missing.join(", "));
  const prefixes = [...src.matchAll(/\bpath\.startsWith\("(\/[^"]*)"\)/g)].map((m) => m[1]);
  ok(new Set(prefixes).size >= 5, "the prefix families are found in the source");
  for (const prefix of new Set(prefixes)) {
    ok([...covered].some((p) => p.startsWith(prefix) && /zz/.test(p)) || prefix === "/flows/" && covered.has("/flows/zz/"),
      "prefix family " + prefix + " has a row with an unknown tail");
  }
  ok(rows.filter((r) => r.env).length >= 15, "the rail is covered with PULSE absent, the switch off and the rail on");
}

{
  const state = count(moduleSource("worker.js"), /^const state = createState\(\);$/gm);
  eq(state, 1, "worker.js holds exactly one top-level `const state = createState()`");
  const lines = moduleSource("worker.js").split("\n");
  const mutable = lines.filter((l) => /^(let|var) /.test(l) || /^const [A-Za-z_0-9]+ = new (Map|WeakMap|WeakSet|Set)\(\)/.test(l));
  eq(mutable.length, 0, "worker.js declares no top-level mutable state outside createState (the shared/ memos stay shared): " + mutable.join(" | "));
  const serverFiles = treeFiles("server");
  for (const file of serverFiles) {
    const text = moduleSource(file);
    ok(!/^(let|var) /m.test(text) && !/^(const|export const) [A-Za-z_0-9]+ = new (Map|WeakMap|WeakSet|Set|Array)\(/m.test(text),
      file + " declares no top-level mutable state");
  }
  const probe = "const a = 1;\nlet b = 2;\nconst c = new Map();\n";
  eq(probe.split("\n").filter((l) => /^(let|var) /.test(l) || /^const [A-Za-z_0-9]+ = new (Map|WeakMap|WeakSet|Set)\(\)/.test(l)).length, 2,
    "and the scan itself recognises a top-level let and a top-level Map");
  ok(/function createState\(\) \{\s*return \{[\s\S]*?marketRevalidation: null[\s\S]*?lastGoodStamped: new Map\(\)[\s\S]*?flowsSchemaReady: false[\s\S]*?\};\s*\}/.test(src),
    "createState returns the market flight, the last-good stamps and the schema flag");
}

const { results, requests, elapsedMs } = await drive();

const cell = (label, principal, method, path) => results.get([label, principal, method, path].join(" "));
const status = (c) => Number(String(c).split(" ")[0]);
const codeOf = (c) => (/ code=(\S+)/.exec(c) || [])[1];

ok(requests >= 1700, "the matrix drives about 1,750 or more in-process requests (" + requests + ")");
eq(results.size, requests, "and every request has its own cell");
ok(elapsedMs < BUDGET_MS, "in under " + BUDGET_MS / 1000 + " seconds (" + Math.round(elapsedMs) + " ms)");

const unknown = cell("base", "anon", "GET", "/api/flows/zz");
eq(status(unknown), 401, "ORDER, Flows API: an anonymous GET on an unknown route is 401, the session check before the 404");
eq(codeOf(unknown), "unauthorized", "with the unauthorized code");
eq(status(cell("base", "member", "GET", "/api/flows/zz")), 404, "and a member gets the 404 only after the session passed");
eq(codeOf(cell("base", "member", "GET", "/api/flows/zz")), "not_found", "with the not_found code");
eq(status(cell("base", "anon", "POST", "/api/flows/zz")), 405, "and the method check comes before the session check: an anonymous POST is 405");
eq(status(cell("base", "anon", "GET", "/api/zz")), 404, "any other unknown API route is 404 before any session is read");
eq(status(cell("base", "anon", "GET", "/api/me")), 200, "the signed-out /api/me is 200");
eq(status(cell("base", "lab", "GET", "/api/flows/board")), 401, "a Lab session is not a Flows session");
eq(status(cell("base", "member", "GET", "/api/flows/board")), 200, "a Flows member reads a seeded board");
eq(status(cell("base", "anon", "GET", "/flows")), 308, "/flows redirects to its slash form");
eq(status(cell("pulse-absent", "owner", "GET", "/api/rt/snap")), 404, "the rail without a PULSE binding is a 404");
eq(codeOf(cell("pulse-absent", "owner", "GET", "/api/rt/snap")), "rt_off", "with the rt_off code");
eq(status(cell("off", "owner", "GET", "/api/rt/snap")), 404, "the rail switched off is a 404 even with the binding");
eq(status(cell("on", "anon", "GET", "/api/rt/snap")), 401, "the rail on: an anonymous reader is 401");
eq(status(cell("on", "member", "GET", "/api/rt/snap")), 403, "a member is refused while the audience is the owner");
eq(status(cell("on", "owner", "GET", "/api/rt/snap")), 200, "and the owner reads through the object");
eq(status(cell("base", "anon", "GET", "/lab/ordinary-least-squares/")), 200, "a course page renders through the asset fake");
eq(status(cell("base", "anon", "GET", "/lab/course?m=ols")), 308, "a legacy course URL is a 308");

const sorted = Object.fromEntries([...results.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
const render = () => "{\n" + Object.entries(sorted).map(([k, v]) => "  " + JSON.stringify(k) + ": " + JSON.stringify(v)).join(",\n") + "\n}\n";
const document = () => '{"clock":"' + NOW_ISO + '","requests":' + requests + ',"cells":' + render().trimEnd() + "}\n";

if (WRITE) {
  writeFileSync(FIXTURE_PATH, document());
  console.log("route-matrix: wrote " + requests + " cells to tests/fixtures-route-matrix.json");
  process.exit(0);
}

ok(existsSync(FIXTURE_PATH), "the committed snapshot exists (node route-matrix.mjs --write regenerates it in a PR that moves no code)");
const golden = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
eq(golden.clock, NOW_ISO, "the snapshot was taken on the pinned clock");
const differ = [];
for (const key of new Set([...Object.keys(golden.cells), ...results.keys()])) {
  if (golden.cells[key] !== results.get(key)) differ.push(key + "\n    snapshot: " + golden.cells[key] + "\n    now:      " + results.get(key));
}
if (differ.length) {
  console.log(differ.slice(0, 25).join("\n"));
  throw new Error("route-matrix: " + differ.length + " of " + requests + " cells differ from the snapshot");
}
checks++;

console.log("route-matrix: " + checks + " checks, " + requests + " requests in " + Math.round(elapsedMs) + " ms, " + outbound + " outbound attempts refused");
