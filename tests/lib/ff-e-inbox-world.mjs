import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flowsDocument } from "../../shared/flows-pages.js";
import { INBOX_DESCRIPTION, INBOX_SCRIPTS, INBOX_STYLES, inboxBody } from "../../shared/ff-pages-inbox.js";
import { base32Lower, canonicalJson, HOUSE_STREAM } from "../../shared/ff-contract.js";
import { hitDetailView, hitRowView, receiptView } from "../../server/ff-records.js";
import { assessHealth, healthView, unreadView } from "../../server/ff-health.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const glyph = (name) => `<svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-${name}"/></svg>`;

export const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
export const MEMBER = "m-syntest";
export const SIZES = [[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [1024, 660], [390, 844], [390, 664]];
export const STANDARD = [[1920, 1080], [1440, 820], [1024, 768], [390, 844]];

export function pageHtml({ shadow = false } = {}) {
  return flowsDocument({ title: "Inbox", description: INBOX_DESCRIPTION, active: "inbox", username: "test", chrome: false, styles: INBOX_STYLES, scripts: INBOX_SCRIPTS, body: inboxBody(glyph, { shadow }) });
}

export const hitId = (i) => base32Lower(new Uint8Array(Array.from({ length: 13 }, (_, k) => (i * 37 + k * 11 + 5) & 255))).slice(0, 20);

const SESSIONS = ["2026-11-09", "2026-11-06", "2026-11-05", "2026-11-04"];
const sym = (i) => "SY" + "ABCDEFGHJKLM"[i % 12] + String(100 + (i % 900)).padStart(3, "0");

export function evidenceOf(i, over = {}) {
  const clauses = [
    { m: "flow.net_premium.z20", label: "net premium z", unit: "sigma", subject: "ticker", op: ">=", x: 3, value: 3 + (i % 7) * 0.13, ok: true, n: 15 + (i % 6), window: 20, ...(i % 4 === 0 ? { floored: true } : {}) },
    { m: "earn.sessions", label: "sessions to the next report", unit: "sessions", subject: "ticker", op: "<=", x: 10, value: 1 + (i % 9), ok: true },
    { m: "contract.premium", label: "window premium", unit: "usd", subject: "window", op: ">=", x: 1000000, value: 1234567 + i * 98765, ok: true },
    { m: "vol.iv.30d.chg1d", label: "30-day implied volatility change", unit: "vol_pt", subject: "ticker", op: ">=", x: 4, value: 4.25 + i * 0.1, ok: true },
  ];
  return {
    v: 1, wire: "h-t01", version: 1, layer: "house", subject: "n:" + sym(i), session: SESSIONS[0], asOf: NOW - 3600000, firedAt: NOW - 3500000,
    evaluator: "nightly", evaluatorVersion: 1, registryVersion: 1, look: 1, persist: 1, cooldown: { unit: "session", n: 5 }, edge: "event",
    wireSentence: "When net premium z ≥ 3.00σ, on any name in the universe.", lead: 0, clauses, symbol: sym(i),
    bh: { m: 40, k: 3, q: 0.05, e: 0.01, cutoff: 0.02 }, sources: [{ key: "hist", session: SESSIONS[0], asOf: NOW - 3600000 }], ...over,
  };
}

const WIRES = [
  { id: "w-abcdefghijklmnop", title: "Net premium spike on my names", house: false, version: 2, current: 3 },
  { id: "h-t01", title: "Earnings run-up", house: true, version: 1, current: 1 },
  { id: "h-t05", title: "Vol break without a catalyst", house: true, version: 1, current: 1 },
  { id: "w-qrstuvwxyz234567", title: "Large short-dated windows", house: false, version: 1, current: 1 },
];

export function hitRows(n, { readSeq = 0, houseReadSeq = 0, groupOf = 0, withdrawn = [] } = {}) {
  const rows = [];
  let m = 0;
  let h = 0;
  for (let i = 0; i < n; i++) {
    const w = i < groupOf ? WIRES[1] : WIRES[i % WIRES.length];
    const house = w.house;
    const seq = house ? ++h : ++m;
    const session = i < groupOf ? SESSIONS[0] : SESSIONS[Math.min(SESSIONS.length - 1, Math.floor(i / 6))];
    const asOf = NOW - 3600000 - i * 60000;
    rows.push({
      hit_id: hitId(i), stream: house ? HOUSE_STREAM : MEMBER, member_id: house ? null : MEMBER, seq,
      wire_id: w.id, title: w.title, wire_version: w.version, current_version: w.current, wire_status: "armed", template: house ? "T01" : null,
      symbol: sym(i), subject: "n:" + sym(i), sector: null, session, session_label: "close",
      data_as_of: asOf, fired_at: asOf + 95000 + i * 1000, evaluator: "nightly", evaluator_version: 1,
      sentence: sym(i) + " net premium z crossed above " + ["3.00", "3.13", "3.26", "3.39", "3.52", "3.65", "3.78"][i % 7] + "σ (≥ 3.00σ) · close",
      version_sentence: "The wire as it was at version " + w.version + ": net premium z at or above 3.00σ on " + sym(i) + ".",
      key_text: "3.13σ", withdrawn_at: withdrawn.includes(i) ? NOW - 600000 : null, withdrawn_reason: withdrawn.includes(i) ? "source_missing" : null,
      mark: null, feedback: null, evidence_json: canonicalJson(evidenceOf(i)),
    });
  }
  const view = (r) => hitRowView(r, { memberId: MEMBER, readSeq, houseReadSeq, now: NOW });
  const heads = { m, h };
  return { rows, view, heads, detail: (r) => hitDetailView(r, { memberId: MEMBER, readSeq, houseReadSeq, now: NOW }) };
}

export function receiptsFor(wire, kinds = ["evaluated", "not_evaluated", "evaluated", "evaluated", "evaluated", "evaluated"]) {
  return kinds.map((k, i) => receiptView({
    wire_id: wire, version: 1, session: ["2026-11-09", "2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02"][i], status: k,
    reason: k === "evaluated" ? null : "run_late", looks: 1, names_evaluated: 670, names_absent: 3, absent_json: null, hits: k === "evaluated" ? i + 1 : 0,
    hits_capped: i === 0 ? 2 : 0, late: 0, evaluated_at: NOW - i * 86400000, upgraded_at: null,
  }, NOW));
}

export function health({ mode = "on", memberMax = 12, houseMax = 9, readSeq = 3, houseReadSeq = 2, nightly = true } = {}) {
  const nightlyDone = nightly ? { session: "2026-11-09", status: "done", finished_at: Date.UTC(2026, 10, 9, 22, 31, 0) } : null;
  const assessed = assessHealth({ now: NOW, clockRow: null, runs: { nightlyLatest: nightlyDone, nightlyDone, live: null } });
  const env = { FF_MODE: mode, FF_ROUTE_INBOX: "on", FF_ROUTE_WIRES: "on", FF_ROUTE_FIRE: "on", FF_ROUTE_EXPORT: "on" };
  return healthView({
    now: NOW, env, assessed, rows: { nightlyDone, live: null, memberMax, houseMax },
    switches: { rows: [], unreadable: false }, memberRow: { read_seq: readSeq, house_read_seq: houseReadSeq }, memberSwitch: { state: "on", unreadable: false },
  });
}

export { unreadView };

export function apiFor({ total = 40, groupOf = 0, shadowApi = false, withdrawn = [], healthView: hv = health(), receipts = null, pageSize = 30 } = {}) {
  const world = hitRows(total, { groupOf, withdrawn });
  const byId = new Map(world.rows.map((r) => [r.hit_id, r]));
  const state = { read: null, marks: {} };
  return {
    world, state,
    handle: ({ method, path: p, query, body, json }) => {
      const q = new URLSearchParams(query);
      if (p === "/api/ff/health") return json({ ...hv });
      if (p === "/api/ff/hits" && method === "GET") {
        if (q.get("id")) {
          const r = byId.get(q.get("id"));
          if (!r) return json({ error: { code: "ff_hit_not_found", message: "No such hit" } }, 404);
          return json({ v: 1, serverNow: NOW, hit: world.detail({ ...r, ...(state.marks[r.hit_id] || {}) }) });
        }
        if (shadowApi) return json({ v: 1, serverNow: NOW, state: q.get("state") || "all", hits: [], next: null, more: false, heads: { h: 0, m: 0 }, shadow: true });
        const from = q.get("cursor") ? Number(q.get("cursor")) : 0;
        const rows = world.rows.slice(from, from + pageSize).map((r) => world.view({ ...r, ...(state.marks[r.hit_id] || {}) }));
        const more = from + pageSize < world.rows.length;
        return json({ v: 1, serverNow: NOW, state: q.get("state") || "all", hits: rows, next: more ? String(from + pageSize) : null, more, heads: from === 0 ? world.heads : null });
      }
      if (p === "/api/ff/hits" && method === "POST") {
        state.marks[body.id] = { ...(state.marks[body.id] || {}), ...("mark" in body ? { mark: body.mark } : {}), ...("feedback" in body ? { feedback: body.feedback } : {}) };
        return json({ v: 1, id: body.id, mark: state.marks[body.id].mark || null, feedback: state.marks[body.id].feedback || null });
      }
      if (p === "/api/ff/read") {
        state.read = body;
        return json({ v: 1, cursors: { readSeq: body.readSeq, houseReadSeq: body.houseReadSeq }, unread: unreadView({ memberMax: world.heads.m, houseMax: world.heads.h, member: { read_seq: body.readSeq, house_read_seq: body.houseReadSeq }, shadow: false }) });
      }
      if (p === "/api/ff/receipts") return json({ v: 1, wire: q.get("wire"), receipts: receipts || receiptsFor(q.get("wire")) });
      return undefined;
    },
  };
}

export async function mount(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: o.dsf || 1, ...(o.context || {}) });
  ctx.setDefaultTimeout(o.timeout || 6000);
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.addInitScript(() => {
    window.__ffEvents = [];
    for (const n of ["ff:read", "ff:unread", "ff:health"]) document.addEventListener(n, (e) => window.__ffEvents.push({ name: n, detail: e.detail }));
  });
  await page.route("**/*", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (p.startsWith("/assets/")) {
      for (const x of [o.js, o.js2, o.css]) if (x && p.endsWith(path.basename(x.path))) return r.fulfill({ contentType: p.endsWith(".css") ? "text/css" : "text/javascript", body: x.body });
      const f = path.join(ROOT, p);
      if (!fs.existsSync(f)) return r.fulfill({ status: 200, contentType: MIME[path.extname(p)] || "text/plain", body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (p.startsWith("/api/")) {
      let body = null;
      try { body = req.postDataJSON(); } catch { body = null; }
      calls.push({ method: req.method(), path: p, query: u.search, body });
      if (o.api) {
        const hit = await o.api({ method: req.method(), path: p, query: u.search, body, r, json: (b, s) => json(r, b, s).then(() => true) });
        if (hit !== undefined) return hit;
      }
      return json(r, { error: { code: "not_found", message: "Not found" } }, 404);
    }
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || pageHtml({ shadow: o.shadow === true }) });
  });
  await page.goto("https://example.test/flows/inbox/" + (o.search || ""));
  await page.waitForSelector("#ffxInbox", { state: "attached", timeout: 15000 });
  if (o.wait !== false) await page.waitForFunction(() => { const s = document.getElementById("ffxIbState"); return s && s.getAttribute("data-state") !== "loading"; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(o.settle === undefined ? 400 : o.settle);
  return { ctx, page, errors, calls };
}
