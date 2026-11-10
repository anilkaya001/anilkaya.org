#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeReport } from "./report.mjs";
import { strategyWorld } from "./strategy-world.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `node survey.mjs --repo <checkout> [options]

  --repo <dir>        repository checkout to measure (default: $ORB_REPO, else the current directory)
  --out <dir>         where inventory.json and summary.md go (default: this script's directory)
  --only <regex>      page ids to run (overview, long, short, watch, market, network, now, desk, strategy,
                      ticker, moves, flowlab, unusual, ledger, events, political, status, fire)
  --sizes <list>      default 1920x1080,1440x820,1024x768,390x844,320x568 (under 768 px wide is a phone:
                      touch and a coarse pointer)
  --views default     measure the default view only (default: every page-level tab and sub-tab)
  --no-dock           skip the Ask-dock states
  --no-scroll         skip the scroll-end position of pages that scroll
  --no-check          skip the check that the Hidden button and the 10 s chip match the hooked states
  --jobs <n>          pages measured at once (default 2)
  --step <px>         sampling grid in CSS px (default 2; each sample stands for step x step px)
  --as owner|member   who views the member pages (default member; Status is always the owner)
  --env main|286      main = wrangler.toml as it is plus FLOWS_ORACLE=on; 286 (default) = also the
                      switches PR #286 opens to every member (ledger, ledger live, flow lab, exports)
  --emit-dir <dir>    keep the dry-run emit there between runs (default: a temporary directory, removed)
  --shots <dir>       save JPEG crops of the bottom-right corner (default view: rest, pill or toast, undo, restore;
                      with the dock open: rest and pill)
  --shots-views all   also shoot every tab view
  --merge <file>      fold this run's pages into an existing inventory.json (same page and size are replaced)
  --summarize <file>  rewrite summary.md from an existing inventory.json and exit`;

function parseArgs(argv) {
  const o = { views: "all", dock: true, scroll: true, check: true, jobs: 2, step: 2, as: "member", env: "286" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error("missing value for " + a); return v; };
    if (a === "--repo") o.repo = val();
    else if (a === "--out") o.out = val();
    else if (a === "--only") o.only = new RegExp(val());
    else if (a === "--sizes") o.sizes = val();
    else if (a === "--views") o.views = val();
    else if (a === "--no-dock") o.dock = false;
    else if (a === "--no-scroll") o.scroll = false;
    else if (a === "--no-check") o.check = false;
    else if (a === "--jobs") o.jobs = Math.max(1, Number(val()) || 1);
    else if (a === "--step") o.step = Math.max(1, Number(val()) || 2);
    else if (a === "--as") o.as = val();
    else if (a === "--env") o.env = val();
    else if (a === "--emit-dir") o.emitDir = val();
    else if (a === "--shots") o.shots = val();
    else if (a === "--shots-views") o.shotsViews = val();
    else if (a === "--summarize") o.summarize = val();
    else if (a === "--merge") o.merge = val();
    else if (a === "--help" || a === "-h") { console.log(USAGE); process.exit(0); }
    else throw new Error("unknown argument " + a + "\n\n" + USAGE);
  }
  return o;
}

const ARGS = parseArgs(process.argv.slice(2));
const OUT = path.resolve(ARGS.out || HERE);

if (ARGS.summarize) {
  const inv = JSON.parse(fs.readFileSync(ARGS.summarize, "utf8"));
  writeReport(inv, OUT);
  console.log("summary written to " + path.join(OUT, "summary.md"));
  process.exit(0);
}

const REPO = path.resolve(ARGS.repo || process.env.ORB_REPO || process.cwd());
if (!fs.existsSync(path.join(REPO, "shared/flows-pages.js")) || !fs.existsSync(path.join(REPO, "server/routes/flows-pages.js"))) {
  console.error("not a checkout of the site: " + REPO + "\n\n" + USAGE);
  process.exit(2);
}
if (!fs.existsSync(path.join(REPO, "tests/node_modules/playwright"))) {
  console.error("tests/node_modules/playwright is missing in " + REPO + " (link it to a checkout that has it)");
  process.exit(2);
}
{
  let rev = null;
  try { rev = JSON.parse(fs.readFileSync(path.join(REPO, "tests/node_modules/playwright-core/browsers.json"), "utf8")).browsers.find((b) => b.name === "chromium-headless-shell").revision; } catch {}
  const has = (d) => !!d && fs.existsSync(d) && (!rev || fs.existsSync(path.join(d, "chromium_headless_shell-" + rev)));
  const found = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/tmp/claude-0/pw", "/opt/pw-browsers"].find(has);
  if (found) process.env.PLAYWRIGHT_BROWSERS_PATH = found;
}

const at = (rel) => pathToFileURL(path.join(REPO, rel)).href;
const req = createRequire(path.join(REPO, "tests/package.json"));
const PW = await import(pathToFileURL(req.resolve("playwright")).href);
const chromium = PW.chromium || (PW.default && PW.default.chromium);
const PAGES = await import(at("shared/flows-pages.js"));
const { flowsPageRows } = await import(at("server/routes/flows-pages.js"));
const { absentRecord } = await import(at("server/routes/flows-oracle.js"));
const { nightlyEmit } = await import(at("tests/lib/nightly-emit.mjs"));
const { liveEntry, phaseView } = await import(at("shared/flows-live-worker.js"));
const { phaseAt, expectedNightlySession, freshHeaders } = await import(at("shared/flows-freshness.js"));
const SFC = await import(at("tests/lib/sfc-render-world.mjs"));
const FLOWLAB = await import(at("tests/lib/flowlab-world.mjs"));
const STATUS = await import(at("tests/lib/status-world.mjs"));
const FIRE = await import(at("tests/lib/ff-d-world.mjs"));
const DESK = await import(at("tests/desk-fixtures.mjs"));

const IN_PAGE = fs.readFileSync(path.join(HERE, "in-page.js"), "utf8");
const FIX = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/render-preview.fixtures.json"), "utf8"));
const ORIGIN = "https://survey.test";
const OWNER = "anilkaya";
const MEMBER = "member";
const NOW = Date.parse("2026-08-24T15:25:00.000Z");
const FLOWLAB_NOW = Date.parse("2026-10-23T15:30:00Z");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain", ".mp4": "video/mp4", ".vtt": "text/vtt", ".jpg": "image/jpeg" };
const KILL_MOTION = "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }";
const HOOK_ANCHOR = "  var api = Object.freeze({";
const HOOK = "  window.__orcHook = { S: S, paint: paint, paintOrb: paintOrb, showToast: showToast, dropToast: dropToast, setOpen: setOpen, setPref: setPref };\n";
const SIZES = (ARGS.sizes || "1920x1080,1440x820,1024x768,390x844,320x568").split(",").map((s) => s.trim().split("x").map(Number));
const PILL_CAP = 300;

const oracleSrc = fs.readFileSync(path.join(REPO, "assets/js/flows-oracle.js"), "utf8");
if (oracleSrc.split(HOOK_ANCHOR).length !== 2) {
  console.error("the hook anchor is not found exactly once in assets/js/flows-oracle.js; update HOOK_ANCHOR in survey.mjs");
  process.exit(2);
}
const ORACLE_HOOKED = oracleSrc.replace(HOOK_ANCHOR, () => HOOK + HOOK_ANCHOR);

function wranglerVars() {
  const text = fs.readFileSync(path.join(REPO, "wrangler.toml"), "utf8");
  const vars = {};
  let on = false;
  for (const line of text.split("\n")) {
    if (/^\s*\[/.test(line)) { on = /^\s*\[vars\]\s*$/.test(line); continue; }
    if (!on) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}
const OVERLAY_286 = { FLOWS_LEDGER: "on", FLOWS_LEDGER_LIVE: "on", FLOWS_FLOWLAB: "on", FLOWS_FLOWLAB_ANALYTICS: "on", FLOWS_EXPORTS: "on" };
const ENV = { ...wranglerVars(), ...(ARGS.env === "main" ? {} : OVERLAY_286), FLOWS_ORACLE: "on" };

let emitDir = ARGS.emitDir ? path.resolve(ARGS.emitDir) : null;
let ownEmit = null;
if (!emitDir) {
  ownEmit = fs.mkdtempSync(path.join(os.tmpdir(), "orb-survey-emit-"));
  emitDir = ownEmit;
}
const cleanup = () => { if (ownEmit) { try { fs.rmSync(ownEmit, { recursive: true, force: true }); } catch {} ownEmit = null; } };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

console.log("emit: building the pipeline's dry-run emit (about a minute when not cached)");
nightlyEmit({ dir: emitDir, root: REPO });

const readEmit = (key) => {
  for (const name of ["-" + key.replace(":", "-") + ".json", "-" + key + ".json"]) {
    const f = path.join(emitDir, name);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return null;
};
const liveFile = (key) => readEmit("live-" + (key.startsWith("live:") ? key.slice(5) : key));
const iso = (ms) => new Date(ms).toISOString();

const entryFor = (payload, now) => {
  const f = payload && payload.fresh;
  if (!f) return null;
  return liveEntry({ readAt: Date.parse(f.readAt), session: f.session, cadenceS: f.cadenceS, source: f.source }, Date.parse(f.readAt), now, null);
};
const nightlyEntry = (p, now) => {
  if (!p) return { state: "pending", reason: "unpublished", klass: "nightly" };
  const meta = { readAt: Date.parse(p.generatedAt || p.readAt || "2026-08-24T22:00:00Z"), session: p.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
  return liveEntry(meta, meta.readAt, now, null);
};

const READ = {
  version: 1, status: "fallback", ticker: "NVDA", generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, tokens: null,
  provenance: "Deterministic reading: assembled from templates over the dossier's facts.", note: null, why: "cooldown",
  fingerprint: "d1.abc", asOf: iso(NOW), session: "2026-08-24", generatedAt: null, coverage: { ok: 8, partial: 2, withheld: 2, pending: 0 },
  tags: [{ code: "dealer-pinned", label: "Dealers pinning", sentence: "The implied dealer state is pinned on the convention (dealers long calls, short puts).", evidence: ["options.state"] }],
  sections: {
    identity: { text: "NVIDIA designs graphics processors and data-centre accelerators.", cites: [{ id: "identity.description", label: "Company description", display: "profile", asOf: iso(NOW), kind: "identity", grade: 2 }] },
    now: { text: "The last price is $127.40, +1.27% from the previous close.", cites: [{ id: "price.last", label: "Last price", display: "$127.40", asOf: iso(NOW), kind: "price", grade: 3 }] },
    drivers: [{ text: "The implied dealer state is pinned on the convention (dealers long calls, short puts).", cites: [{ id: "options.state", label: "Implied dealer state", display: "pinned", asOf: iso(NOW), kind: "options", grade: 2 }] }],
    tensions: [], watch: [], unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about revenue.", missing: ["fundamentals"] }],
  },
  refused: [],
};

let ledgerAnswer = null;
function answer(route, u, now) {
  const q = u.searchParams;
  switch (route) {
    case "board": return readEmit("board-" + (q.get("side") || "long"));
    case "market": case "events": case "scoretrack": case "meta": case "flowalerts": case "pulse": case "news": case "reports":
    case "political": case "unusual": case "movers": case "universe": case "regime": case "ideas": case "focus": case "roster": case "record": case "brief": case "calib": case "dispersion":
      return readEmit(route) || { status: "pending" };
    case "sectors": return readEmit("sector-trix") || { status: "pending", rows: [] };
    case "sector-premium": return readEmit("sector-premium") || { status: "pending", sectors: [] };
    case "card": return readEmit("card-" + q.get("t")) || { status: "pending" };
    case "card-x": return readEmit("card-x-" + q.get("t")) || { status: "pending" };
    case "hist": return readEmit("hist-" + q.get("t")) || { status: "pending" };
    case "flowlab/nightly": return readEmit("flowlab-" + q.get("k")) || { status: "pending" };
    case "ai-usage": return { spend: { neurons: 4200, cap: 30000, calls: 40 } };
    case "ledger": {
      if (q.get("part") === "book") return { __status: 404, error: { code: "ledger_live_off", message: "off" } };
      ledgerAnswer ||= SFC.respondWith(SFC.realisticWorld());
      return ledgerAnswer(u);
    }
    case "summary": return { status: "ok", scope: q.get("t") || "", summary: null, ideas: [], tier: "family", code: null, why: "x", read: READ };
    case "lk": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",").filter(Boolean)) {
        const p = liveFile("live:" + k);
        keys[k] = p ? { status: "ok", payload: p, updatedAt: Date.parse(p.fresh.readAt), fresh: entryFor(p, now) } : { status: "pending", fresh: { state: "pending", reason: "unpublished", klass: "market" } };
      }
      return { serverNow: now, phase: phaseView(phaseAt(now, null)), keys };
    }
    case "now": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",").filter(Boolean)) {
        const id = k.startsWith("live:") ? k : "live:" + k;
        const p = liveFile(id);
        keys[id] = p ? entryFor(p, now) : { state: "pending", reason: "unpublished", klass: "market" };
      }
      for (const k of String(q.get("n") || "").split(",").filter(Boolean)) keys[k] = nightlyEntry(readEmit(k.replace(":", "-")), now);
      return { serverNow: now, tier1: { at: iso(now - 120000), okAt: iso(now - 120000), why: null }, clock: null, expected: expectedNightlySession(now, null), phase: phaseView(phaseAt(now, null)), keys };
    }
    default: return null;
  }
}

function oracleAnswer(u, now) {
  if (u.searchParams.has("top")) {
    const top = readEmit("oracle-top");
    if (!top) return { v: 1, session: expectedNightlySession(now, null), generatedAt: null, items: [], status: "pending" };
    return { v: 1, session: top.session || null, generatedAt: top.generatedAt || null, items: Array.isArray(top.items) ? top.items : [] };
  }
  if (u.searchParams.has("ts")) {
    const list = [...new Set(String(u.searchParams.get("ts")).split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 12);
    return { v: 1, records: Object.fromEntries(list.map((t) => [t, readEmit("oracle-" + t)])) };
  }
  const t = String(u.searchParams.get("t") || "").trim().toUpperCase();
  return readEmit("oracle-" + t) || absentRecord(t, now, null);
}

const DAYMS = 86400000;
function deskChain(ticker, strategy) {
  const spot = 100, asOf = "2026-08-24", vol = 0.34;
  const lines = [];
  for (const expiry of ["2026-08-28", "2026-09-04", "2026-09-18", "2026-10-16", "2026-11-20"]) {
    const years = (Date.parse(expiry) - Date.parse(asOf)) / DAYMS / 365;
    for (const step of [0.88, 0.92, 0.95, 0.97, 0.99, 1, 1.01, 1.03, 1.05, 1.08, 1.12]) {
      const strike = Math.round(spot * step * 2) / 2;
      const c = DESK.callValue(spot, strike, vol * (1 + 0.15 * Math.abs(Math.log(strike / spot))), years);
      const p = c - spot + strike * Math.exp(-0.04 * years);
      if (strategy === "csp" && step <= 1) lines.push({ type: "P", strike, expiry, bid: Math.max(0.06, Math.round(p * 100 - 1) / 100) });
      if (strategy !== "csp" && step >= 1) lines.push({ type: "C", strike, expiry, bid: Math.max(0.06, Math.round(c * 100 - 1) / 100) });
    }
  }
  return DESK.chain({ ticker, spot, asOf, lines, engine: DESK.engineBlock(ticker, asOf, 50), source: "stock-state" });
}

let strategyState = null;
const strategyApi = async () => (strategyState ||= await strategyWorld(REPO, { now: NOW }));

let flowlabNightly = null;
const flowlabBodies = async () => (flowlabNightly ||= await FLOWLAB.nightlyBodies(FLOWLAB.FX.worlds.normal, { analytics: true }));

const STATUS_WORLD = STATUS.world();

const SPECS = [
  { id: "overview", slug: "", url: "/flows/", views: ["#hmPager"] },
  { id: "long", slug: "long", url: "/flows/long/" },
  { id: "short", slug: "short", url: "/flows/short/" },
  { id: "watch", slug: "watch", url: "/flows/watch/" },
  { id: "market", slug: "market", url: "/flows/market/", views: ["#mkTabs", "#mkSub"] },
  { id: "network", slug: "network", url: "/flows/network/" },
  { id: "now", slug: "now", url: "/flows/now/" },
  { id: "desk", slug: "desk", url: "/flows/desk/?t=NVDA", views: ["#dkTabs"], note: "opened with ?t=NVDA so the frontier and lines are drawn from a synthetic chain",
    api: (u) => (u.pathname === "/api/flows/chain" ? deskChain(u.searchParams.get("t") || "SYX101", u.searchParams.get("strategy") || "csp") : undefined) },
  { id: "strategy", slug: "strategy", url: "/flows/strategy/?t=NVDA",
    api: async (u) => (u.pathname === "/api/flows/strategy" ? (await strategyApi()).answer(u) : undefined),
    note: "/api/flows/strategy is the Worker's own route run in-process (worker.fetch) against a stubbed feed on a .test host with a dummy key, so no network call is made" },
  { id: "ticker", slug: "ticker", url: "/flows/ticker/?t=NVDA" },
  { id: "moves", slug: "moves", url: "/flows/moves/", views: ["#mvSeg5"] },
  { id: "flowlab", slug: "flowlab", url: "/flows/flowlab/#t=SYX101", views: ["#flTabs", "#flMods"], clock: FLOWLAB_NOW, note: "opened with #t=SYX101 so the per-name views read the Flow Lab fixture world",
    api: async (u) => {
      if (u.pathname === "/api/flows/universe") return { t: FLOWLAB.FX.tickers };
      if (!u.pathname.startsWith("/api/flows/flowlab/")) return undefined;
      const name = u.pathname.replace("/api/flows/flowlab/", "");
      if (name === "nightly") return (await flowlabBodies())["flowlab-" + u.searchParams.get("k")] || { status: "pending" };
      return FLOWLAB.memberBody(u.pathname + u.search, FLOWLAB.FX.worlds.normal, FLOWLAB_NOW + 4.25 * 3600000);
    } },
  { id: "unusual", slug: "unusual", url: "/flows/unusual/", views: ["#fdTabs"] },
  { id: "ledger", slug: "ledger", url: "/flows/ledger/", views: ["#sfTabs"] },
  { id: "events", slug: "events", url: "/flows/events/", views: ["#fdTabs"] },
  { id: "political", slug: "political", url: "/flows/political/", views: ["#plSeg5"] },
  { id: "status", slug: "status", url: "/flows/status/", views: ["#stTabs", "#stSub"], owner: true, clock: STATUS.NOW,
    api: (u) => {
      const hit = STATUS_WORLD[u.pathname + u.search];
      return hit ? hit.body : undefined;
    } },
  { id: "fire", slug: "fire", url: "/flows/fire/", views: ["#ffxTabs"], unserved: true, clock: Date.now(),
    note: "shared/ff-pages-fire.js builds the page but no route serves it on this commit; it is rendered as tests/lib/ff-d-world.mjs builds it",
    api: (u, request) => {
      const method = request.method();
      if (u.pathname === "/api/flows/universe") return FIRE.UNIVERSE;
      if (u.pathname === "/api/ff/wires" && method === "GET") return { v: 1, status: "live", wires: [], limits: FIRE.limits() };
      if (u.pathname === "/api/ff/house") return { v: 1, wires: FIRE.houseWires() };
      if (u.pathname === "/api/ff/preview") { let body = null; try { body = request.postDataJSON(); } catch {} return body && body.ast ? FIRE.previewFor(body.ast) : { __status: 400, error: { code: "bad_request" } }; }
      if (u.pathname.startsWith("/api/ff/")) return { __status: 404, error: { code: "not_found", message: "Not found" } };
      return undefined;
    } },
];
const GONE = [{ id: "ask", note: "/flows/ask/ redirects to /flows/ (FLOWS_GONE_SLUGS); the Ask surface is the dock, measured as the dock states on every page at 768 px and wider" }];

const sceneOn = (env, username) => {
  const m = String(env.FLOWS_SCENES || "").trim().toLowerCase();
  return m === "on" || (m === "owner" && username === OWNER);
};

async function renderHtml(spec) {
  if (spec.id === "fire") return { html: PAGES.oracleShell(FIRE.pageHtml(), "on", "fire"), status: 200, user: "test" };
  const user = spec.owner || ARGS.as === "owner" ? OWNER : MEMBER;
  const rows = flowsPageRows({
    currentFlowsUser: async () => ({ username: user }),
    readFlowsSummary: async () => FIX.summary,
    isOwner: (env, username) => username === OWNER,
    scenesOn: (env, username) => sceneOn(env, username),
  });
  const url = new URL(spec.url, ORIGIN);
  const row = rows.find((r) => r.path === url.pathname);
  if (!row) return { html: null, status: 0, user };
  const realNow = Date.now;
  const now = spec.clock === undefined ? NOW : spec.clock === null ? realNow() : spec.clock;
  Date.now = () => now;
  try {
    const res = await row.handler({ request: new Request(url), env: ENV, url, ctx: {}, session: null });
    return { html: res.status === 200 ? await res.text() : null, status: res.status, user };
  } catch (error) {
    return { html: null, status: error && error.status ? error.status : 500, user, error: String(error && error.message || error) };
  } finally {
    Date.now = realNow;
  }
}

const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });

function router(spec, html, track) {
  const now = spec.clock === undefined ? NOW : spec.clock === null ? Date.now() : spec.clock;
  return async (route) => {
    const request = route.request();
    const u = new URL(request.url());
    const p = u.pathname;
    if (p.startsWith("/assets/")) {
      if (spec.id === "fire" && p === "/assets/js/flows-ff-client.js") return route.fulfill({ contentType: "text/javascript", body: FIRE.CLIENT_DOUBLE });
      if (p === "/assets/js/flows-oracle.js") return route.fulfill({ contentType: "text/javascript", body: ORACLE_HOOKED });
      const f = path.join(REPO, p);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    let own;
    if (p.startsWith("/api/") && spec.api) own = await spec.api(u, request);
    if (own === undefined && p.startsWith("/api/rt/")) return json(route, { error: { code: "rt_off", message: "off" } }, 404);
    if (own === undefined && p.startsWith("/api/me/")) return json(route, { error: { code: "member_state_off", message: "off" } }, 404);
    if (p.startsWith("/api/")) {
      track.asked.push(p + u.search);
      let body = own;
      if (body === undefined && p === "/api/flows/oracle") body = oracleAnswer(u, now);
      if (body === undefined && p.startsWith("/api/flows/")) body = answer(p.slice("/api/flows/".length), u, now);
      if (body === undefined || body === null) body = { status: "pending" };
      const status = body && body.__status ? body.__status : 200;
      if (body && body.__status) { body = { ...body }; delete body.__status; }
      let headers = { "X-Server-Now": String(now) };
      if (body && body.generatedAt && body.sessionDate) {
        const meta = { readAt: Date.parse(body.generatedAt), session: body.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
        try { headers = { ...headers, ...freshHeaders(meta, now, null).headers, "X-Payload-Updated": String(Date.parse(body.generatedAt)) }; } catch {}
      }
      return json(route, body, status, headers);
    }
    if (p.startsWith("/flows/") || p === "/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, track, { min = 400, max = 16000, need = 4 } = {}) {
  await page.waitForTimeout(min);
  let stable = 0, last = -1;
  const t0 = Date.now();
  while (Date.now() - t0 < max && stable < need) {
    await page.waitForTimeout(100);
    const size = await page.evaluate(() => document.getElementsByTagName("*").length + (document.body ? document.body.innerText.length : 0)).catch(() => -2);
    if (track.inflight <= 0 && size === last) stable++;
    else stable = 0;
    last = size;
  }
}

async function waitOracle(page) {
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => !!(window.__orcHook && document.querySelector("#fxOracle .orc-orb") && !document.getElementById("fxOracle").hidden)).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

const STATE_SETS = { desk: ["rest", "pill", "badge", "undo", "restore"], phone: ["rest", "badge", "toast", "undo", "restore"] };

async function driveAll(page, phone, prefix = "") {
  const out = {};
  for (const st of phone ? STATE_SETS.phone : STATE_SETS.desk) {
    out[prefix + st] = await page.evaluate(([s, o]) => window.__orbSurvey.drive(s, o), [st, { pillWidth: PILL_CAP, ticker: "GOOGL", kind: "cluster" }]);
  }
  await page.evaluate(() => window.__orbSurvey.drive("rest"));
  return out;
}

const sameBox = (a, b) => !!a && !!b && ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) <= 0.6);

async function realPath(page, hooked) {
  const res = { ok: false };
  try {
    await page.evaluate(() => window.__orbSurvey.drive("rest"));
    await page.locator("#fxOracle .orc-orb").click({ timeout: 4000 });
    await page.waitForSelector("#fxOracle.is-open", { timeout: 4000 });
    await page.locator('#fxOracle .orc-pref-b[data-pref="off"]').click({ timeout: 4000 });
    await page.waitForTimeout(200);
    const undo = await page.evaluate(() => window.__orbSurvey.parts());
    if (page.clock) await page.clock.runFor(10100).catch(async () => { await sleep(10100); });
    await page.waitForTimeout(200);
    const restore = await page.evaluate(() => window.__orbSurvey.parts());
    const hu = (hooked.undo || []).find((p) => p.part === "undo"), ru = undo.find((p) => p.part === "undo");
    const hr = (hooked.restore || []).find((p) => p.part === "restore"), rr = restore.find((p) => p.part === "restore");
    res.undo = { hooked: hu || null, real: ru || null, match: sameBox(hu, ru) };
    res.restore = { hooked: hr || null, real: rr || null, match: sameBox(hr, rr) };
    await page.locator("#fxOracle .orc-restore").click({ timeout: 4000 });
    await page.waitForTimeout(200);
    res.back = (await page.evaluate(() => window.__orbSurvey.parts())).some((p) => p.part === "orb");
    res.ok = res.undo.match && res.restore.match && res.back;
  } catch (error) {
    res.error = String(error && error.message || error).split("\n")[0].slice(0, 300);
  }
  try {
    await page.evaluate(() => { const H = window.__orcHook; if (H && H.S.open) H.setOpen(false); document.cookie = "fn_oracle=on; Path=/flows"; window.__orbSurvey.drive("rest"); });
  } catch {}
  return res;
}

async function measure(page, states, step) {
  const sample = await page.evaluate(([s, st]) => window.__orbSurvey.sample({ states: s, step: st }), [states, step]);
  const corner = await page.evaluate(() => window.__orbSurvey.corner());
  const scrollInfo = await page.evaluate(() => window.__orbSurvey.scrollInfo());
  return { sample, corner, scrollInfo };
}

async function shoot(page, file, phone, states) {
  if (!ARGS.shots) return;
  fs.mkdirSync(ARGS.shots, { recursive: true });
  const vp = page.viewportSize();
  const w = Math.min(vp.width, 760), h = Math.min(vp.height, 420);
  const clip = { x: vp.width - w, y: vp.height - h, width: w, height: h };
  for (const st of states || (phone ? ["rest", "toast", "undo", "restore"] : ["rest", "pill", "undo", "restore"])) {
    await page.evaluate(([s, o]) => window.__orbSurvey.drive(s, o), [st, { pillWidth: PILL_CAP, ticker: "GOOGL", kind: "cluster" }]);
    await page.screenshot({ path: path.join(ARGS.shots, `${file}-${st}.jpg`), type: "jpeg", quality: 72, clip });
  }
  await page.evaluate(() => window.__orbSurvey.drive("rest"));
}

async function runJob(browser, spec, html, size) {
  const [width, height] = size;
  const phone = width < 768;
  const sizeName = width + "x" + height;
  const t0 = Date.now();
  const job = { page: spec.id, size: sizeName, phone, runs: [], errors: [], parts: null, reach: null, check: null };
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone, reducedMotion: "reduce" });
  const track = { inflight: 0, asked: [] };
  try {
    await context.addInitScript({ content: IN_PAGE });
    const page = await context.newPage();
    page.on("pageerror", (e) => job.errors.push(String(e).split("\n")[0].slice(0, 240)));
    const bump = (d) => (r) => { if (/\/api\//.test(r.url())) track.inflight += d; };
    page.on("request", bump(1));
    page.on("requestfinished", bump(-1));
    page.on("requestfailed", bump(-1));
    await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
    await page.route("**/*", router(spec, html, track));
    const now = spec.clock === undefined ? NOW : spec.clock;
    if (now !== null) await page.clock.install({ time: new Date(now) });
    await page.goto(ORIGIN + spec.url, { waitUntil: "load", timeout: 60000 });
    await page.addStyleTag({ content: KILL_MOTION });
    await settle(page, track);
    job.mounted = await waitOracle(page);
    if (!job.mounted) { job.errors.push("the Neuron never mounted"); return job; }
    await settle(page, track, { min: 300, need: 3 });
    job.reach = await page.evaluate(() => window.__orbSurvey.reach());
    const states = await driveAll(page, phone);
    job.parts = states;
    if (ARGS.check) job.check = await realPath(page, states);
    await settle(page, track, { min: 200, need: 2, max: 6000 });
    const file = `${spec.id}-${sizeName}`;
    await shoot(page, file, phone);

    const one = async (view) => {
      const m = await measure(page, states, ARGS.step);
      job.runs.push({ view, pos: "top", dock: false, ...m });
      if (ARGS.scroll && m.scrollInfo.y) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await settle(page, track, { min: 300, need: 2, max: 6000 });
        const e = await measure(page, states, ARGS.step);
        job.runs.push({ view, pos: "end", dock: false, ...e });
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page, track, { min: 150, need: 2, max: 4000 });
      }
    };

    await one("default");

    if (ARGS.dock && !phone) {
      try {
        const tab = page.locator("#askDockTab");
        if (await tab.count()) {
          await tab.click({ timeout: 4000 });
          await page.waitForSelector(".ak-dock.is-open", { timeout: 4000 });
          await settle(page, track, { min: 400, need: 3 });
          const dockStates = await driveAll(page, false, "dock:");
          const m = await measure(page, dockStates, ARGS.step);
          const modal = await page.evaluate(() => matchMedia("(max-width: 1199.98px)").matches);
          job.runs.push({ view: "default", pos: "top", dock: true, dockModal: modal, dockParts: dockStates, ...m });
          await shoot(page, `${file}-dock`, false, ["rest", "pill"]);
          const close = page.locator(".ak-dock-close");
          if (await close.count()) await close.click({ timeout: 4000 }).catch(() => {});
          await page.waitForFunction(() => !document.body.classList.contains("has-dock-open"), null, { timeout: 4000 }).catch(() => {});
          await settle(page, track, { min: 300, need: 3 });
        }
      } catch (error) {
        job.errors.push("dock: " + String(error && error.message || error).split("\n")[0].slice(0, 200));
      }
    }

    if (ARGS.views !== "default" && spec.views) {
      const [l1, l2] = spec.views;
      const tabsOf = (sel) => page.evaluate((s) => window.__orbSurvey.tabs(s), sel);
      const click = async (sel, key) => {
        const ok = await page.evaluate(([s, k]) => window.__orbSurvey.clickTab(s, k), [sel, key]);
        if (ok) await settle(page, track, { min: 450, need: 3, max: 10000 });
        return ok;
      };
      const label = (t) => t.label || t.key;
      const visitSubs = async (prefix) => {
        if (!l2) return;
        const subs = await tabsOf(l2);
        for (const b of subs.filter((x) => !x.selected)) {
          if (!(await click(l2, b.key))) continue;
          const name = (prefix ? prefix + " › " : "") + label(b);
          if (ARGS.shotsViews === "all") await shoot(page, `${file}-${name.replace(/\W+/g, "_")}`, phone);
          await one(name);
        }
      };
      const top = await tabsOf(l1);
      const first = top.find((x) => x.selected);
      await visitSubs(first ? label(first) : "");
      for (const a of top.filter((x) => !x.selected)) {
        if (!(await click(l1, a.key))) continue;
        if (ARGS.shotsViews === "all") await shoot(page, `${file}-${label(a).replace(/\W+/g, "_")}`, phone);
        await one(label(a));
        await visitSubs(label(a));
      }
    }
  } catch (error) {
    job.errors.push(String(error && error.message || error).split("\n")[0].slice(0, 300));
  } finally {
    job.asked = [...new Set(track.asked)].slice(0, 80);
    job.ms = Date.now() - t0;
    await context.close().catch(() => {});
  }
  return job;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

function gitHead() {
  try { return execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
}

const specs = SPECS.filter((s) => !ARGS.only || ARGS.only.test(s.id));
const pages = [];
const htmlOf = new Map();
for (const spec of specs) {
  const r = await renderHtml(spec);
  pages.push({ id: spec.id, slug: spec.slug, url: spec.url, served: !spec.unserved && r.status === 200, status: r.status, user: r.user, owner: !!spec.owner, views: spec.views || [], note: spec.note || null, error: r.error || null });
  if (r.html) htmlOf.set(spec.id, r.html);
  else console.log(`page ${spec.id}: not rendered (status ${r.status}${r.error ? ", " + r.error : ""})`);
}
for (const g of GONE) pages.push({ id: g.id, served: false, status: 308, note: g.note, views: [] });

const browser = await chromium.launch();
const jobs = [];
for (const spec of specs) if (htmlOf.has(spec.id)) for (const size of SIZES) jobs.push([spec, size]);
console.log(`measuring ${jobs.length} page and size pairs, ${ARGS.jobs} at a time`);
const started = Date.now();
let done = 0;
const results = await pool(jobs, ARGS.jobs, async ([spec, size]) => {
  const r = await runJob(browser, spec, htmlOf.get(spec.id), size);
  done++;
  const hits = r.runs.reduce((n, run) => n + Object.values(run.sample.states).reduce((m, s) => m + s.hits.filter((h) => h.layer === "under").length, 0), 0);
  console.log(`[${done}/${jobs.length}] ${spec.id} ${size.join("x")}: ${r.runs.length} views, ${hits} hits, ${(r.ms / 1000).toFixed(1)} s${r.errors.length ? ", errors: " + r.errors.slice(0, 2).join(" | ") : ""}`);
  return r;
});
await browser.close();

let inventory = {
  meta: {
    generatedAt: new Date().toISOString(),
    repo: REPO, commit: gitHead(),
    command: "node " + path.join(HERE, "survey.mjs") + " " + process.argv.slice(2).join(" "),
    sizes: SIZES.map((s) => s.join("x")),
    states: { desktop: STATE_SETS.desk, phone: STATE_SETS.phone, dock: STATE_SETS.desk.map((s) => "dock:" + s) },
    step: ARGS.step, pillWidth: PILL_CAP, viewer: ARGS.as, envMode: ARGS.env,
    env: Object.fromEntries(Object.entries(ENV).filter(([k]) => /^FLOWS_(ORACLE|LEDGER|LEDGER_LIVE|FLOWLAB|FLOWLAB_ANALYTICS|EXPORTS|MEMBER_STATE|HOME_NET|SCENES|MOVES|FLOOR_FUNDS|RT_MODE|RT_AUDIENCE|FRONT_DOOR)$/.test(k))),
    clock: { default: iso(NOW), flowlab: iso(FLOWLAB_NOW), status: iso(STATUS.NOW), fire: "wall clock" },
    origin: ORIGIN, elapsedS: Math.round((Date.now() - started) / 1000),
  },
  pages,
  jobs: results,
};
if (ARGS.merge) {
  const base = JSON.parse(fs.readFileSync(ARGS.merge, "utf8"));
  const key = (j) => j.page + " " + j.size;
  const fresh = new Map(results.map((j) => [key(j), j]));
  const jobs = base.jobs.map((j) => fresh.get(key(j)) || j);
  for (const j of results) if (!base.jobs.some((b) => key(b) === key(j))) jobs.push(j);
  const pageIds = new Set(pages.map((p) => p.id));
  inventory = {
    meta: { ...base.meta, sizes: [...new Set([...base.meta.sizes, ...inventory.meta.sizes])], merged: [...(base.meta.merged || []), { at: inventory.meta.generatedAt, commit: inventory.meta.commit, command: inventory.meta.command, pages: [...pageIds], sizes: inventory.meta.sizes, elapsedS: inventory.meta.elapsedS }] },
    pages: [...base.pages.filter((p) => !pageIds.has(p.id)), ...pages],
    jobs,
  };
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "inventory.json"), JSON.stringify(inventory, null, 1));
writeReport(inventory, OUT);
console.log(`inventory: ${path.join(OUT, "inventory.json")}\nsummary: ${path.join(OUT, "summary.md")}\n${Math.round((Date.now() - started) / 1000)} s`);
cleanup();
