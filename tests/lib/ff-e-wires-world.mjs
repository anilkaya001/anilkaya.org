import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLOWS_PAGES, flowsDocument, ffSlots } from "../../shared/flows-pages.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DASH = "—";
export const SIZES = [[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [1024, 660], [390, 844], [390, 664]];
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

export const wiresHtml = (o = {}) => ffSlots(FLOWS_PAGES.wiresPage({ username: "test", shadow: o.shadow !== false }), { mark: true, panel: true, slug: "wires" });

export const tickerHtml = () => ffSlots(flowsDocument({
  title: "Ticker", active: "ticker", username: "test", chrome: false, styles: ["/assets/css/flows-ticker.css"],
  body: '<section class="ft-hero" id="ftHero"><div class="ft-hero-in"><div class="ft-id"><div class="ft-name"><h1 class="ft-t" id="ftHeroT" data-fx-title>SYA101</h1><span class="ft-sub" id="ftHeroSub">Synthetic Co</span><span class="ft-flags" id="ftHeroFlags"></span></div></div></div></section>',
}), { mark: true, panel: true, slug: "ticker" });

const TRT = (d) => d + " · 16:40 TRT";
const names = (n, from = 0) => Array.from({ length: n }, (_, i) => "SYA" + String(101 + from + i));
const idOf = (i) => "w-" + ("abcdefghijklmnop".slice(0, 12) + String.fromCharCode(97 + (i % 26)) + "aaa").slice(0, 16);

export function makeWire(i, over = {}) {
  const cadence = over.cadence || (i % 3 === 0 ? "live" : "nightly");
  const scope = over.scope || (i % 4 === 1 ? { kind: "universe" } : { kind: "names", symbols: names(over.names || 3, i) });
  const version = over.version || 1 + (i % 3);
  const sentence = (v) => "When SYA" + (101 + i) + " net premium crosses $" + (v * 250) + "K on the " + cadence + " read (version " + v + ")";
  return {
    id: over.id || idOf(i), layer: "member", title: over.title || "Wire " + (i + 1) + " on " + (scope.kind === "names" ? scope.symbols.join(", ") : "the universe"),
    status: over.status || "armed", statusAt: { ms: 1, text: TRT("Mon 2 Nov") }, version, template: null, cadence,
    cadenceText: cadence === "live" ? "Checked every 15 min in the session (Tier 2)" : "Checked once a night, after the close",
    scope, scopeText: scope.kind === "names" ? scope.symbols.join(", ") : "Every name in the universe", control: "fact",
    expWeek: over.expWeek || { v: null, text: DASH, reason: "not_measured", reasonText: "no expected false alarms: a fact wire has no statistical test" },
    sentence: sentence(version), origin: null, effectiveSession: "2026-11-02", effectiveText: "Takes effect from the 2026-11-02 session",
    createdAt: { ms: 1, text: TRT("Mon 2 Nov") }, versionAt: { ms: 1, text: TRT("Mon 2 Nov") },
    ast: { v: 1, cadence, scope, all: [{ m: "flow.net_premium", op: ">=", x: version * 250000 }], persist: 1, cooldown: { unit: "session", n: cadence === "live" ? 1 : 5 } },
    versions: Array.from({ length: version }, (_, k) => ({ version: k + 1, template: null, cadence, scopeKind: scope.kind, control: "fact", sentence: sentence(k + 1), effectiveSession: "2026-10-2" + (k + 1), createdAt: { ms: 1, text: TRT("Tue 2" + (k + 1) + " Oct") } })),
  };
}

export function limitsOf(wires, over = {}) {
  const armed = wires.filter((w) => w.status === "armed");
  return {
    armed: { used: armed.length, max: 50 }, universe: { used: armed.filter((w) => w.scope.kind === "universe").length, max: 5 },
    live: { used: armed.filter((w) => w.cadence === "live").length, max: 5 }, budget: { used: 0.4, max: 2, choices: [1, 2, 5] }, ...over,
  };
}

const view = (w) => { const { ast, versions, ...rest } = w; void ast; void versions; return rest; };

export function houseWires() {
  return [
    { id: "h-t01", layer: "house", title: "Earnings run-up", status: "armed", version: 1, cadence: "nightly", cadenceText: "Checked once a night, after the close", scope: { kind: "universe" }, scopeText: "Every name in the universe", sentence: "When a name reports within ten sessions and its flow runs hot", expWeek: { v: 0.3, text: "0.3" }, following: true, rarity: { v: 12, text: "1 in 12 sessions" }, effectiveSession: "2026-11-02", effectiveText: "Takes effect from the 2026-11-02 session" },
    { id: "h-t05", layer: "house", title: "Vol break without a catalyst", status: "armed", version: 1, cadence: "nightly", cadenceText: "Checked once a night, after the close", scope: { kind: "universe" }, scopeText: "Every name in the universe", sentence: "When implied volatility jumps with no report near", expWeek: { v: 0.2, text: "0.2" }, following: false, rarity: { v: null, text: DASH, reason: "short_history", reasonText: "under 20 sessions of history" }, effectiveSession: "2026-11-02", effectiveText: "Takes effect from the 2026-11-02 session" },
  ];
}

export function health(state = "resting", over = {}) {
  return {
    v: 1, serverNow: 1, state, healthy: state === "live" || state === "resting", breathes: state === "live", reason: state === "degraded" ? "live_late" : null,
    reasonText: state === "unknown" ? "no nightly run recorded yet" : null,
    line: { live: "Live · checked 2 min ago", resting: "Resting · nightly 00:41 TRT", degraded: "Degraded · live loop 7 min late", down: "Down · no heartbeat since 17:35 TRT", unknown: DASH + " health unavailable: no nightly run recorded yet" }[state],
    phase: state === "live" || state === "degraded" ? "open" : "closed", session: "2026-11-13", mode: "shadow",
    checkedAt: { ms: 1, text: "Fri 13 Nov · 00:41 TRT" }, evaluator: { nightly: { session: "2026-11-13", status: "ok" }, live: { session: null, status: null } },
    unread: { house: 0, member: 0, total: 0, capped: false, label: "0" }, routes: {}, switchesReadable: true, pollAfterS: 60, ...over,
  };
}

export function makeState(o = {}) {
  const wires = o.wires || Array.from({ length: o.count === undefined ? 6 : o.count }, (_, i) => makeWire(i, { status: i === 2 ? "paused" : i === 4 ? "retired" : "armed" }));
  return { wires, limits: o.limits || null, house: o.house || houseWires(), health: o.health || health(), symbol: o.symbol || null };
}

export async function mount(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: o.motion ? "no-preference" : "reduce", ...(o.context || {}) });
  ctx.setDefaultTimeout(o.timeout || 8000);
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  const st = o.state || makeState();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const json = (r, body, status = 200, headers = {}) => r.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
  const assets = [];
  await page.route("**/*", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (p.startsWith("/assets/")) {
      assets.push(p);
      const swap = (o.files || []).find((f) => p.endsWith(path.basename(f.path)));
      if (swap) return r.fulfill({ contentType: MIME[path.extname(p)] || "text/plain", body: swap.body });
      const f = path.join(ROOT, p);
      if (!fs.existsSync(f)) return r.fulfill({ status: 200, contentType: MIME[path.extname(p)] || "text/plain", body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (p.startsWith("/api/")) {
      let body = null;
      try { body = req.postDataJSON(); } catch { body = null; }
      const call = { method: req.method(), path: p, query: u.search, body, headers: req.headers() };
      calls.push(call);
      if (o.api) {
        const hit = await o.api({ ...call, r, st, json: (b, s, hd) => json(r, b, s, hd).then(() => true) });
        if (hit !== undefined) return hit;
      }
      const limits = () => st.limits || limitsOf(st.wires);
      if (p === "/api/ff/health") {
        if (st.health === "fail") return r.abort("failed");
        if (st.health && st.health.status) return json(r, { error: { code: st.health.code, message: st.health.message || "refused" } }, st.health.status, st.health.headers || {});
        return json(r, st.health, 200, { ETag: 'W/"ff-1"' });
      }
      if (p === "/api/ff/wires" && req.method() === "GET") {
        const id = u.searchParams.get("id");
        if (id) {
          const wire = st.wires.find((x) => x.id === id);
          if (!wire) return json(r, { error: { code: "ff_wire_not_found", message: "No such wire" } }, 404);
          return json(r, { v: 1, wire: { ...view(wire), ast: wire.ast }, versions: wire.versions.slice(), note: null });
        }
        const status = u.searchParams.get("status") || "live";
        const rows = st.wires.filter((x) => (status === "retired" ? x.status === "retired" : x.status !== "retired"));
        return json(r, { v: 1, status, wires: rows.map(view), limits: status === "retired" ? null : limits() });
      }
      if (p === "/api/ff/wires" && req.method() === "PATCH") {
        const wire = st.wires.find((x) => x.id === body.id);
        if (!wire) return json(r, { error: { code: "ff_wire_not_found", message: "No such wire" } }, 404);
        if (body.status) wire.status = body.status;
        return json(r, { v: 1, wire: view(wire), replayed: false, limits: limits() });
      }
      if (p === "/api/ff/house" && req.method() === "GET") {
        const id = u.searchParams.get("id");
        if (id) {
          const hw = st.house.find((x) => x.id === id);
          return hw ? json(r, { v: 1, wire: hw, note: null }) : json(r, { error: { code: "ff_wire_not_found", message: "No such wire" } }, 404);
        }
        return json(r, { v: 1, wires: st.house });
      }
      if (p === "/api/ff/house" && req.method() === "POST") {
        const hw = st.house.find((x) => x.id === body.id);
        hw.following = body.follow;
        return json(r, { v: 1, wire: hw, changed: true });
      }
      if (p === "/api/ff/symbol") {
        if (st.symbol && st.symbol.status) return json(r, { error: { code: st.symbol.code, message: st.symbol.message || "refused" } }, st.symbol.status);
        return json(r, { v: 1, panel: st.symbol || { symbol: "SYA101", wires: [], armed: 0, lastHit: { v: null, text: DASH, reason: "no_hits" }, muted: false, line: "No armed wire names SYA101" } });
      }
      if (p === "/api/flows/universe") return json(r, { status: "ok", t: names(40), sectors: ["Energy", "Technology"] });
      if (p === "/api/ff/preview") return json(r, { v: 1, preview: { status: "unavailable", reason: "missing", reasonText: DASH + " missing", subjects: [], coverage: {} } });
      return json(r, { error: { code: "not_found", message: "Not found" } }, 404);
    }
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || wiresHtml(o) });
  });
  if (o.before) await o.before(page);
  await page.goto("https://example.test" + (o.at || "/flows/wires/") + (o.search || ""));
  if (o.wait !== false) await page.waitForSelector(o.waitFor || "#ffxWrList .ffx-wr-row, #ffxWrState:not([data-ff-absent=\"reading\"])", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(o.settle === undefined ? 500 : o.settle);
  return { ctx, page, errors, calls, st, assets };
}
