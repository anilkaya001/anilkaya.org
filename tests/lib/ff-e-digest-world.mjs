import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flowsDocument } from "../../shared/flows-pages.js";
import { DIGEST_DESCRIPTION, DIGEST_SCRIPTS, DIGEST_STYLES, digestBody } from "../../shared/ff-pages-inbox.js";
import { CLIENT_DOUBLE } from "./ff-d-world.mjs";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const glyph = (name) => `<svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-${name}"/></svg>`;
export const DASH = "—";
export const SIZES = [[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [1024, 660], [390, 844], [390, 664]];

export const pageHtml = (shadow) => flowsDocument({ title: "Digest", description: DIGEST_DESCRIPTION, active: "digest", username: "test", chrome: false, styles: DIGEST_STYLES, scripts: DIGEST_SCRIPTS, body: digestBody(glyph, { shadow }) });

const TITLES = {
  "house-nightly": "House · Nightly", "house-live": "House · Live", "yours-nightly": "Yours · Nightly", "yours-live": "Yours · Live",
};

const sym = (i) => "SY" + String.fromCharCode(65 + (i % 26)) + String(100 + (i % 900)).padStart(3, "0");

export function hit(i, o = {}) {
  return {
    id: "h" + String(i).padStart(19, "0"),
    kind: o.kind || "yours",
    wire: { id: o.wire || "w-aaaaaaaaaaaaaaaa", title: o.title || "Wire", version: 1 },
    symbol: sym(i),
    session: "2026-11-13",
    sessionLabel: "close",
    at: { ms: 1, text: "00:30 TRT · close" },
    sentence: o.sentence === undefined ? sym(i) + " Net premium z crossed above 3.12 (>= 3.00) · close · 00:30 TRT" : o.sentence,
    key: "3.12",
    withdrawn: o.withdrawn || null,
  };
}

export function group(w, n, o = {}) {
  const grouped = n > 3;
  const hits = Array.from({ length: grouped ? 3 : n }, (_, i) => hit(w * 100 + i, { wire: "w-" + String(w).padStart(16, "b"), title: o.title || "Wire " + w, sentence: o.sentence, withdrawn: o.withdrawn }));
  return {
    wire: { id: "w-" + String(w).padStart(16, "b"), title: o.title || "Wire " + w },
    count: n,
    rarity: o.rarity || (w % 2 ? { v: 12, text: "1 in 12 sessions" } : { v: null, text: DASH, reason: "short_history", reasonText: "under 20 sessions of history" }),
    rarityRank: 0,
    grouped,
    hits,
    more: grouped ? n - 3 : 0,
  };
}

export function quadrant(id, groups = [], o = {}) {
  return {
    id,
    title: TITLES[id],
    complete: o.complete !== false,
    incomplete: o.complete === false ? { v: null, text: DASH, reason: "not_measured", reasonText: "the newest stored hits do not reach back past this session, so the list may be short" } : null,
    hits: groups,
    total: groups.reduce((s, g) => s + g.count, 0),
    receipts: o.receipts || { evaluated: 14, notEvaluated: 1, line: "14 evaluated, 1 not evaluated: run_late" },
    run: o.run === undefined ? { status: "ok", finishedAt: { ms: 1, text: "Fri 14 Nov · 00:41 TRT" }, names: { v: 812, text: "812" } } : o.run,
  };
}

export function digest(o = {}) {
  const q = o.quadrants || {};
  return {
    v: 1, serverNow: 1793000000000, latest: o.latest || "2026-11-13",
    digest: {
      v: 1, serverNow: 1793000000000, session: o.session || "2026-11-13",
      quadrants: ["house-nightly", "house-live", "yours-nightly", "yours-live"].map((id) => q[id] || quadrant(id, [], { receipts: o.receipts })),
      hygiene: { silent: o.silent || [] },
      complete: o.complete !== false,
    },
  };
}

export const EMPTY_RECEIPTS = { evaluated: 0, notEvaluated: 0, line: DASH + " no receipts for this session" };

export function busy() {
  const many = (base, n) => Array.from({ length: n }, (_, i) => group(base + i, (i % 5) + 1));
  return digest({
    quadrants: {
      "house-nightly": quadrant("house-nightly", many(1, 40)),
      "house-live": quadrant("house-live", many(60, 30)),
      "yours-nightly": quadrant("yours-nightly", many(120, 50).concat([group(199, 9, { title: "A wire title long enough that it cannot fit any column of this page at any width we test" })])),
      "yours-live": quadrant("yours-live", many(200, 30), { complete: false }),
    },
    silent: Array.from({ length: 6 }, (_, i) => ({ wire: { id: "w-" + i, title: "Quiet wire " + i }, sessions: 40, lastHit: { v: null, text: DASH, reason: "no_hits" }, text: "No hit in 30 or more sessions" })),
  });
}

export function house(o = {}) {
  const rec = (firings, sessions) => ({
    period: "all", firings: { v: firings, text: String(firings) }, sessions: { v: sessions, text: String(sessions) },
    calibration: { budget: { v: null, text: DASH, reason: "no_record", reasonText: "no record yet" } },
  });
  const wires = o.wires || [
    { id: "h-t01", title: "Opening flow surge", cadence: "nightly", following: true, record: rec(0, 9), rarity: { v: null, text: DASH, reason: "short_history", reasonText: "under 20 sessions of history" } },
    { id: "h-t02", title: "Implied vol jump", cadence: "nightly", following: true, record: rec(3, 36), rarity: { v: 12, text: "1 in 12 sessions" } },
    { id: "h-t03", title: "Flagged window size", cadence: "live", following: false, record: { v: null, text: DASH, reason: "no_record", reasonText: "no record yet" }, rarity: { v: null, text: DASH, reason: "short_history", reasonText: "under 20 sessions of history" } },
    { id: "h-t05", title: "Earnings ratio", cadence: "nightly", following: true, record: rec(1, 22), rarity: { v: 22, text: "1 in 22 sessions" } },
  ];
  return { v: 1, serverNow: 1793000000000, wires };
}

export async function mount(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: o.scale || 1 });
  ctx.setDefaultTimeout(o.timeout || 6000);
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const shadow = o.shadow !== false;
  await page.route("**/*", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (p.startsWith("/assets/")) {
      if (p === "/assets/js/flows-ff-client.js") return r.fulfill({ contentType: "text/javascript", body: CLIENT_DOUBLE });
      for (const f of o.files || []) if (p.endsWith(path.basename(f.path))) return r.fulfill({ contentType: MIME[path.extname(f.path)], body: f.body });
      const f = path.join(ROOT, p);
      if (!fs.existsSync(f)) return r.fulfill({ status: 200, contentType: MIME[path.extname(p)] || "text/plain", body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (p.startsWith("/api/")) {
      calls.push({ method: req.method(), path: p, query: u.search });
      if (p === "/api/ff/digest") {
        const d = typeof o.digest === "function" ? o.digest(u) : o.digest;
        if (d && d.status) return json(r, d.body, d.status);
        return json(r, d || digest());
      }
      if (p === "/api/ff/house") {
        const d = o.house;
        if (d && d.status) return json(r, d.body, d.status);
        return json(r, d || house());
      }
      return json(r, { error: { code: "not_found", message: "Not found" } }, 404);
    }
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || pageHtml(shadow) });
  });
  await page.goto("https://example.test/flows/digest/" + (o.search || ""));
  await page.waitForFunction(() => !document.querySelector("#ffxDigest [aria-busy=true]"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(o.settle === undefined ? 300 : o.settle);
  return { ctx, page, errors, calls };
}
