import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flowsDocument } from "../../shared/flows-pages.js";
import { FIRE_DESCRIPTION, FIRE_SCRIPTS, FIRE_STYLES, fireBody, fireRegistry } from "../../shared/ff-pages-fire.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MINUS = "−";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

const glyph = (name) => `<svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-${name}"/></svg>`;

export const registry = fireRegistry();

export function pageHtml(body = fireBody(glyph, registry)) {
  return flowsDocument({ title: "Fire", description: FIRE_DESCRIPTION, active: "fire", username: "test", chrome: false, styles: FIRE_STYLES, scripts: FIRE_SCRIPTS, body });
}

export const HTML = pageHtml();

export const SIZES = [[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [1024, 660], [390, 844], [390, 664]];

export const UNIVERSE = {
  status: "ok", n: 12,
  t: ["SYN101", "SYN102", "SYN103", "SYN104", "SYN105", "SYN106", "SYN107", "SYN108", "SYN109", "SYN110", "SYN111", "SYN112"],
  sectors: ["Energy", "Financials", "Technology"],
};

const TRT = (text) => text;

export function previewFor(ast, over = {}) {
  const names = ast.scope.kind === "names" ? ast.scope.symbols : UNIVERSE.t.slice(0, over.hold === undefined ? 5 : over.hold);
  const subjects = names.map((s, i) => {
    const verdict = ast.scope.kind === "names" ? (i % 3 === 2 ? "unknown" : i % 3 === 1 ? "false" : "true") : "true";
    return {
      symbol: s, subject: "n:" + s, verdict, wouldHit: verdict === "true" ? true : verdict === "false" ? false : null,
      reason: verdict === "unknown" ? "stale" : null, reasonText: verdict === "unknown" ? "— stale" : null,
      clauses: ast.all.map((c) => ({ metric: c.m, label: c.m, op: c.op, threshold: c.x, thresholdText: String(c.x), value: verdict === "unknown" ? null : c.x + 1, valueText: verdict === "unknown" ? "—" : String(c.x + 1), ok: verdict === "true" })),
    };
  });
  const hold = subjects.filter((s) => s.verdict === "true").length;
  const unk = subjects.filter((s) => s.verdict === "unknown").length;
  return {
    v: 1, serverNow: 1793000000000, status: "ok", reason: null, reasonText: null, sentence: "x", template: null, cadence: ast.cadence, control: "fact",
    expWeek: { v: null, text: "—", reason: "not_measured", reasonText: "a fact wire has no statistical test" },
    evaluator: { kind: ast.cadence, text: "x", firstCheck: { ms: 1, text: TRT("Tue 27 Oct · 00:30 TRT"), scheduled: true, label: "first check Tue 27 Oct · 00:30 TRT (scheduled)" }, effectiveSession: "2026-10-27" },
    freshness: { session: "2026-10-26", asOf: { ms: 1, text: "Mon 26 Oct · 23:00 TRT" }, stale: false, expected: "2026-10-26" },
    coverage: { subjects: subjects.length, evaluated: subjects.length - unk, wouldHit: hold, unknown: unk, reasons: unk ? { stale: unk } : {} },
    subjects, truncated: false, slots: {},
    ...over.view,
  };
}

export function limits(over = {}) {
  return { armed: { used: 3, max: 50 }, universe: { used: 0, max: 5 }, live: { used: 1, max: 5 }, budget: { used: 0.4, max: 2, choices: [1, 2, 5] }, ...over };
}

export function houseWires() {
  const mk = (id, rarity) => ({ id, layer: "house", title: id, rarity });
  return [
    mk("h-t01", { v: 12, text: "1 in 12 sessions" }),
    mk("h-t02", { v: null, text: "—", reason: "short_history", reasonText: "under 20 sessions of history" }),
    mk("h-t03", { v: 4, text: "1 in 4 sessions" }),
    mk("h-t05", { v: 30, text: "1 in 30 sessions" }),
  ];
}

export async function mount(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(o.context || {}) });
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/*", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (p.startsWith("/assets/")) {
      if (o.js && p.endsWith(path.basename(o.js.path))) return r.fulfill({ contentType: "text/javascript", body: o.js.body });
      if (o.css && p.endsWith(path.basename(o.css.path))) return r.fulfill({ contentType: "text/css", body: o.css.body });
      const f = path.join(ROOT, p);
      if (!fs.existsSync(f)) return r.fulfill({ status: 200, contentType: MIME[path.extname(p)] || "text/plain", body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (p.startsWith("/api/")) {
      let body = null;
      try { body = req.postDataJSON(); } catch { body = null; }
      calls.push({ method: req.method(), path: p, query: u.search, body, headers: req.headers() });
      if (o.api) {
        const hit = await o.api({ method: req.method(), path: p, query: u.search, body, headers: req.headers(), r, json: (b, s) => json(r, b, s) });
        if (hit !== undefined) return hit;
      }
      if (p === "/api/flows/universe") return json(r, UNIVERSE);
      if (p === "/api/ff/wires" && req.method() === "GET") return json(r, { v: 1, status: "live", wires: [], limits: limits() });
      if (p === "/api/ff/house") return json(r, { v: 1, wires: houseWires() });
      if (p === "/api/ff/preview") return json(r, previewFor(body.ast));
      if (p === "/api/ff/wires" && req.method() === "POST") {
        return json(r, { v: 1, wire: { id: "w-" + "a".repeat(16), title: body.title, version: 1, effectiveText: "Takes effect from the 2026-10-27 session" }, replayed: false, limits: limits({ armed: { used: 4, max: 50 } }) }, 201);
      }
      if (p === "/api/ff/wires" && req.method() === "PATCH") return json(r, { v: 1, wire: { id: body.id, version: 2, effectiveText: "Takes effect from the 2026-10-27 session" }, replayed: false, limits: limits() });
      return json(r, { error: { code: "not_found", message: "Not found" } }, 404);
    }
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || HTML });
  });
  await page.goto("https://example.test/flows/fire/" + (o.search || ""));
  await page.waitForSelector("#ffxFire .ffx-c", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(o.settle === undefined ? 700 : o.settle);
  return { ctx, page, errors, calls };
}
