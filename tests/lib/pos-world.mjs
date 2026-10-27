import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPositioning, fitPositioning } from "../../shared/flows-pos-build.js";
import { trackFilers } from "../../shared/flows-pos-13f.js";
import * as PAGES from "../../shared/flows-pages.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-positioning-vendor.json"), "utf8"));
export const SESSION = "2026-10-26";
export const GENERATED_AT = "2026-10-26T22:41:00.000Z";
export const NOW_MS = Date.parse(GENERATED_AT);
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

export const universe = () => Object.fromEntries(FIX.world.universe.map((u) => [u.t, u.sec]));

export function psParts(now = NOW_MS) {
  const ps = {};
  for (const t of Object.keys(universe())) {
    const ftd = FIX.ops.ftds.byTicker[t].data.map((r) => [r.date, Number(r.quantity), r.price ? Math.round(Number(r.price) * 100) : null]);
    const part = { ftd: { at: now, rv: 1, x: { ok: true, rows: ftd } } };
    const v = FIX.ops["short-venues"].byTicker[t];
    if (v) {
      const byDay = {};
      for (const r of v.data) (byDay[r.date] ||= []).push(r);
      const days = Object.keys(byDay).sort().reverse();
      part.svx = { at: now, rv: 1, x: { ok: true, days: days.map((d) => [d, byDay[d].reduce((a, r) => a + r.short_volume, 0), byDay[d].reduce((a, r) => a + r.total_volume, 0)]), last: { date: days[0], venues: byDay[days[0]].map((r) => [r.exchange_name, r.market_center, r.short_volume, r.total_volume]) } } };
    }
    const ibs = FIX.ops["insider-bs"].byTicker[t].data.map((r) => [r.filing_date, r.purchases, r.sells]);
    part.ibs = { at: now, rv: 1, x: { ok: true, rows: ibs, notional: { withheld: "unit" } } };
    const ins = FIX.ops.insiders.byTicker[t].data;
    part.ins = { at: now, rv: 1, x: { ok: true, persons: ins.filter((r) => r.is_person).length, entities: ins.filter((r) => !r.is_person).length, total: ins.length } };
    ps[t] = part;
  }
  return ps;
}

export function payload(o = {}) {
  const ops = FIX.ops;
  const list = ops["inst-list"].body.data;
  const tracked = trackFilers(list, null, SESSION);
  const sectorsByCik = {}, activityByCik = {};
  for (const t of tracked) {
    sectorsByCik[t.cik] = ops["inst-sectors"].byName[t.name].data;
    if (ops["inst-activity"].byName[t.name]) activityByCik[t.cik] = ops["inst-activity"].byName[t.name].data;
  }
  const insiderBySector = Object.fromEntries(Object.entries(ops["insider-sector"].bySector).map(([s, b]) => [s, b.data]));
  const u = universe();
  const p = buildPositioning({
    sessionDate: SESSION, generatedAt: GENERATED_AT, now: NOW_MS, universe: u, list, latest: ops["inst-latest"].body.data,
    sectorsByCik, activityByCik, insiderBySector, psByTicker: psParts(), advByTicker: Object.fromEntries(Object.keys(u).map((t) => [t, 8000000])),
    calls: 61, fixture: true, ...o,
  });
  return fitPositioning(p);
}

export const drillBody = (t) => {
  const parts = psParts()[t];
  return { t, sessionDate: SESSION, ps: parts ? { v: 1, status: "ok", parts } : null, ...(parts ? {} : { why: "absent" }) };
};

export const html = () => PAGES.positioningPage({ username: "test" });

export async function openPos(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(o.context || {}) });
  const page = await ctx.newPage();
  if (o.now) await page.clock.setFixedTime(new Date(o.now));
  const errors = [];
  const asked = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const body = o.body === undefined ? payload() : o.body;
  const doc = o.html || html();
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/assets/")) {
      if (o.js && u.pathname === "/assets/js/flows-pos.js") return r.fulfill({ contentType: "text/javascript", body: o.js });
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
    if (u.pathname === "/api/flows/positioning") {
      const t = u.searchParams.get("t");
      if (t) {
        if (o.drillFail && !asked.filter((a) => a.includes("t=" + t)).slice(1).length) return r.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return r.fulfill({ contentType: "application/json", body: JSON.stringify(drillBody(t)) });
      }
      return r.fulfill({ status: o.status || 200, contentType: "application/json", headers: { "X-Payload-Updated": String(NOW_MS) }, body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (u.pathname === "/flows/ticker/") return r.fulfill({ contentType: "text/html", body: "<title>ticker</title><p>ticker stub</p>" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: doc });
  });
  await page.goto("https://example.test/flows/positioning/");
  await page.waitForSelector(o.ready === false ? "#posRotCardB .pos-state" : "#pos[data-ready]", { timeout: 15000 });
  await page.waitForTimeout(o.settle === undefined ? 350 : o.settle);
  return { ctx, page, errors, asked };
}

export const SIZES = Object.freeze([[1920, 1080], [1440, 820], [1024, 768], [390, 844]]);
