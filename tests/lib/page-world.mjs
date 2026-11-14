import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { liveEntry, phaseView } from "../../shared/flows-live-worker.js";
import { phaseAt, expectedNightlySession, freshHeaders } from "../../shared/flows-freshness.js";
import { fulfilFf } from "./ff-u-world.mjs";
import { realisticWorld, respondWith } from "./sfc-render-world.mjs";
import { payloadFor as voldeskPayload } from "./voldesk-world.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
export const NOW = Date.parse("2026-08-24T15:25:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

let ledgerAnswer = null;
export const dir = mkdtempSync(path.join(tmpdir(), "flows-pages-"));
try {
  execFileSync("node", [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", path.join(dir, "p.json")], { stdio: "pipe" });
} catch (error) {
  console.error("the pipeline itself failed to run, so no page can be rendered against its emit");
  console.error(String(error.stdout || "") + String(error.stderr || ""));
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

const emitted = (name) => {
  const flat = path.join(dir, "p-" + name.replace(":", "-") + ".json");
  if (existsSync(flat)) return JSON.parse(readFileSync(flat, "utf8"));
  const raw = path.join(dir, "p-" + name + ".json");
  return existsSync(raw) ? JSON.parse(readFileSync(raw, "utf8")) : null;
};

const liveFile = (key) => emitted("live-" + (key.startsWith("live:") ? key.slice(5) : key));

const entryFor = (payload) => {
  const f = payload && payload.fresh;
  if (!f) return null;
  return liveEntry({ readAt: Date.parse(f.readAt), session: f.session, cadenceS: f.cadenceS, source: f.source }, Date.parse(f.readAt), NOW, null);
};

const nightlyEntry = (p) => {
  if (!p) return { state: "pending", reason: "unpublished", klass: "nightly" };
  const meta = { readAt: Date.parse(p.generatedAt || p.readAt || "2026-08-24T22:00:00Z"), session: p.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
  return liveEntry(meta, meta.readAt, NOW, null);
};

const READ = {
  version: 1, status: "fallback", ticker: "NVDA", generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, tokens: null,
  provenance: "Deterministic reading: assembled from templates over the dossier's facts.", note: null, why: "cooldown",
  fingerprint: "d1.abc", asOf: iso(NOW), session: "2026-08-24", generatedAt: null, coverage: { ok: 8, partial: 2, withheld: 2, pending: 0 },
  tags: [{ code: "dealer-pinned", label: "Dealers pinning", sentence: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", evidence: ["options.state"] }],
  sections: {
    identity: { text: "NVIDIA designs graphics processors and data-centre accelerators.", cites: [{ id: "identity.description", label: "Company description", display: "profile", asOf: iso(NOW), kind: "identity", grade: 2 }] },
    now: { text: "The last price is $127.40, +1.27% from the previous close.", cites: [{ id: "price.last", label: "Last price", display: "$127.40", asOf: iso(NOW), kind: "price", grade: 3 }] },
    drivers: [{ text: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", cites: [{ id: "options.state", label: "Implied dealer state", display: "pinned", asOf: iso(NOW), kind: "options", grade: 2 }] }],
    tensions: [], watch: [], unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about revenue.", missing: ["fundamentals"] }],
  },
  refused: [],
};

function answer(route, u) {
  const q = u.searchParams;
  switch (route) {
    case "board": return emitted("board-" + (q.get("side") || "long"));
    case "market": case "events": case "scoretrack": case "meta": case "flowalerts": case "pulse": case "news":
    case "political": case "positioning": case "unusual": case "movers": case "universe": case "regime": case "ideas": case "focus": case "roster": case "record": case "brief":
      return emitted(route) || { status: "pending" };
    case "sectors": return emitted("sector-trix") || { status: "pending", rows: [] };
    case "sector-premium": return emitted("sector-premium") || { status: "pending", sectors: [] };
    case "card": return emitted("card-" + q.get("t")) || { status: "pending" };
    case "card-x": return emitted("card-x-" + q.get("t")) || { status: "pending" };
    case "hist": return emitted("hist-" + q.get("t")) || { status: "pending" };
    case "flowlab/nightly": return emitted("flowlab-" + q.get("k")) || { status: "pending" };
    case "flowlab/screen": case "flowlab/contract": case "flowlab/name": case "flowlab/group": case "flowlab/lit": case "flowlab/venues":
      return { v: 1, asOf: new Date(NOW).toISOString(), session: null, part: route.slice(8), calls: 1, why: "empty", x: null };
    case "ai-usage": return { spend: { neurons: 4200, cap: 30000, calls: 40 } };
    case "ledger": { ledgerAnswer ||= respondWith(realisticWorld()); return ledgerAnswer(u); }
    case "summary": return { status: "ok", scope: q.get("t") || "", summary: null, ideas: [], tier: "family", code: null, why: "x", read: READ };
    case "lk": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",")) {
        const p = liveFile("live:" + k);
        keys[k] = p ? { status: "ok", payload: p, updatedAt: Date.parse(p.fresh.readAt), fresh: entryFor(p) } : { status: "pending", fresh: { state: "pending", reason: "unpublished", klass: "market" } };
      }
      return { serverNow: NOW, phase: phaseView(phaseAt(NOW, null)), keys };
    }
    case "now": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",").filter(Boolean)) {
        const id = k.startsWith("live:") ? k : "live:" + k;
        const p = liveFile(id);
        keys[id] = p ? entryFor(p) : { state: "pending", reason: "unpublished", klass: "market" };
      }
      for (const k of String(q.get("n") || "").split(",").filter(Boolean)) keys[k] = nightlyEntry(emitted(k.replace(":", "-")));
      return { serverNow: NOW, tier1: { at: iso(NOW - 120000), okAt: iso(NOW - 120000), why: null }, clock: null,
        expected: expectedNightlySession(NOW, null), phase: phaseView(phaseAt(NOW, null)), keys };
    }
    case "voldesk": return voldeskPayload("ok");
    default: return null;
  }
}

export const SPECS = [
  { id: "login", fn: "loginPage", url: "/flows/login/", dock: false },
  { id: "about", fn: "aboutPage", url: "/flows/about/", dock: false },
  { id: "glossary", fn: "glossaryPage", url: "/flows/glossary/", dock: false },
  { id: "overview", fn: "overviewPage", url: "/flows/" },
  { id: "long", fn: "sidePage", args: { side: "long" }, url: "/flows/long/" },
  { id: "short", fn: "sidePage", args: { side: "short" }, url: "/flows/short/" },
  { id: "watch", fn: "watchPage", url: "/flows/watch/" },
  { id: "market", fn: "marketPage", args: { voldesk: true }, url: "/flows/market/" },
  { id: "network", fn: "networkPage", url: "/flows/network/" },
  { id: "now", fn: "nowPage", url: "/flows/now/" },

  { id: "unusual", fn: "unusualPage", url: "/flows/unusual/" },
  { id: "events", fn: "eventsPage", url: "/flows/events/" },
  { id: "moves", fn: "movesPage", url: "/flows/moves/" },
  { id: "political", fn: "politicalPage", url: "/flows/political/" },
  { id: "political-layers", fn: "politicalPage", args: { layers: true }, url: "/flows/political/" },
  { id: "positioning", fn: "positioningPage", url: "/flows/positioning/" },
  { id: "strategy", fn: "strategyPage", url: "/flows/strategy/?t=NVDA" },
  { id: "desk", fn: "deskPage", url: "/flows/desk/" },
  { id: "ticker", fn: "tickerPage", url: "/flows/ticker/?t=NVDA" },
  { id: "ledger", fn: "ledgerPage", url: "/flows/ledger/" },
  { id: "flowlab", fn: "flowlabPage", url: "/flows/flowlab/" },
  { id: "macro", fn: "macroPage", url: "/flows/macro/" },
  { id: "status", fn: "statusPage", url: "/flows/status/" },
  { id: "fire", fn: "firePage", args: { shadow: true }, url: "/flows/fire/" },
  { id: "inbox", fn: "ffPendingPage", args: { page: "inbox", shadow: true }, url: "/flows/inbox/" },
];


export async function mount(page, html, url, patch = null) {
  const asked = [];
  let inflight = 0;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"rt_off"}}' });
    if (u.pathname.startsWith("/api/ff/")) return fulfilFf(route, NOW);
    if (u.pathname.startsWith("/api/flows/")) {
      const r = u.pathname.slice("/api/flows/".length);
      asked.push(r);
      const body = answer(r, u) || { status: "pending" };
      let headers = { "X-Server-Now": String(NOW) };
      if (body && body.generatedAt && body.sessionDate) {
        const meta = { readAt: Date.parse(body.generatedAt), session: body.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
        try { headers = { ...headers, ...freshHeaders(meta, NOW, null).headers, "X-Payload-Updated": String(Date.parse(body.generatedAt)) }; } catch {}
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/") || u.pathname === "/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  const track = (r) => { if (/\/api\/flows\//.test(r.url())) inflight += r._d; };
  page.on("request", (r) => { r._d = 1; track(r); });
  page.on("requestfinished", (r) => { r._d = -1; track(r); });
  page.on("requestfailed", (r) => { r._d = -1; track(r); });
  await page.clock.install({ time: new Date(NOW) });
  await page.goto("https://example.test" + url, { waitUntil: "load" });
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }" });
  await page.waitForTimeout(400);
  let stable = 0;
  let last = -1;
  for (let i = 0; i < 160 && stable < 4; i++) {
    await page.waitForTimeout(100);
    const size = await page.evaluate(() => document.getElementsByTagName("*").length + document.body.innerText.length);
    if (inflight === 0 && size === last) stable++;
    else stable = 0;
    last = size;
  }
  return asked;
}

export const dropEmit = () => rmSync(dir, { recursive: true, force: true });
