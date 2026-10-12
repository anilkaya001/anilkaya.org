import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import { flowsPageRows } from "../server/routes/flows-pages.js";
import { DEALER_CLAUSE } from "../shared/flows-reading.js";
import { chromium } from "playwright";
import { nightlyEmit } from "./lib/nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); checks++; };

const SCENES_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker-scenes.js"), "utf8");
const TOML = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");

ok(/^FLOWS_SCENES\s*=\s*"on"/m.test(TOML), "wrangler.toml ships the scenes switch on for every member (the owner's decision of 2026-10-12)");
ok(!/id="ftScenes"/.test(FLOWS_PAGES.tickerPage({ username: "m" })), "the ticker page carries no scenes group by default");
ok(/id="ftScenes"/.test(FLOWS_PAGES.tickerPage({ username: "m", scenes: true })), "and carries it when asked");
ok(/data-defer="scenes" data-src="\/assets\/js\/flows-ticker-scenes\.js\?v=\d+"/.test(FLOWS_PAGES.tickerPage({ username: "m", scenes: true })), "as one versioned deferred file");

async function pageFor(env, owner) {
  const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => owner, scenesOn: (e) => {
    const mode = String((e && e.FLOWS_SCENES) || "").trim().toLowerCase();
    return mode === "on" || (mode === "owner" && owner);
  } });
  const row = rows.find((r) => r.path === "/flows/ticker/");
  const res = await row.handler({ request: new Request("https://x.test/flows/ticker/"), env, url: new URL("https://x.test/flows/ticker/"), ctx: {} });
  return res.text();
}
for (const [env, owner, want] of [[{}, true, false], [{ FLOWS_SCENES: "off" }, true, false], [{ FLOWS_SCENES: "owner" }, false, false], [{ FLOWS_SCENES: "owner" }, true, true],
  [{ FLOWS_SCENES: " OWNER " }, true, true], [{ FLOWS_SCENES: "members" }, true, false], [{ FLOWS_SCENES: "on" }, true, true], [{ FLOWS_SCENES: "on" }, false, true], [{ FLOWS_SCENES: " ON " }, false, true], [{ FLOWS_SCENES: "" }, true, false]]) {
  eq(/id="ftScenes"/.test(await pageFor(env, owner)), want, `scenes for owner=${owner} env=${JSON.stringify(env)} is ${want}`);
}

function load(src) {
  const win = { FlowsUI: { h: () => ({}), F: {}, cssVar: () => "#000", DASH: "—" } };
  vm.runInNewContext(src, { window: win, document: {}, Math, Number, Array, Object, String, Set, JSON }, { filename: "flows-ticker-scenes.js" });
  return win.FlowsUI.scenes.model;
}

const STUB_FQ = {
  sliceFromSummary: (e) => ({ T: e.T, e }),
  sliceVolK: (s, k) => (Number.isFinite(k) ? s.e.atm + 0.3 * k + 0.5 * k * k : null),
};
const expiry = (n) => ({ expiry: `2026-09-${String(n).padStart(2, "0")}`, dte: n * 3, T: (n * 3) / 365, atm: 0.2 + n * 0.01, smile: { method: "svi" }, forward: { F: 100 } });

function surfaceFailures(M) {
  const bad = [];
  const note = (c, m) => { if (!c) bad.push(m); };
  const eng = { expiries: [] };
  for (let n = 1; n <= 20; n++) eng.expiries.push(expiry(n));
  eng.expiries.push({ expiry: "2026-12-01", dte: 90, T: 90 / 365, smile: null, forward: { F: 100 } });
  const iv = { rows: [-0.1, 0, 0.1], expiries: [{ expiry: "2026-09-04", days: 12 }, { expiry: "2026-09-07", days: 21 }], iv: [[0.31, null], [0.28, 0.27], [0.3, 0]] };
  const m = M.surface({ engine: eng, ivSurface: iv }, STUB_FQ);
  note(m.fitted.length === 12, "at most twelve fitted slices");
  note(m.fitted[0].dte === 3 && m.fitted[11].dte === 60, "the nearest and the furthest expiry are kept");
  for (const f of m.fitted) {
    const e = eng.expiries.find((x) => x.dte === f.dte);
    note(Math.abs(f.half - 2 * e.atm * Math.sqrt(e.T)) < 1e-12, `fitted range is exactly two root total variances at ${f.dte}d`);
    note(Math.abs(f.pts[0].k + f.half) < 1e-12 && Math.abs(f.pts[24].k - f.half) < 1e-12, "and the curve stops at that range");
    note(f.pts.every((p) => Math.abs(p.k) <= f.half + 1e-12), "no fitted point beyond the range");
    note(f.pts.every((p) => Math.abs(p.iv - (e.atm + 0.3 * p.k + 0.5 * p.k * p.k)) < 1e-12), "every fitted point is the engine slice's own volatility");
    note(Math.abs(f.atm - e.atm) < 1e-12, "the at-the-money reading is the slice's");
  }
  note(m.measured.length === 4, "measured points keep only positive finite readings");
  note(m.gaps === 2, "and the unquoted cells are counted as gaps, not zeros");
  note(m.measured.every((p) => p.iv > 0), "no measured zero");
  const r12 = m.rows.find((r) => r.days === 12);
  note(r12 && r12.n === 3 && r12.lo === 0.28 && r12.hi === 0.31, "the table row for 12d reads its measured range");
  const none = M.surface({ engine: null, ivSurface: null }, STUB_FQ);
  note(none.fitted.length === 0 && none.measured.length === 0, "no engine and no grid gives nothing");
  return bad;
}

function terrainFailures(M) {
  const bad = [];
  const note = (c, m) => { if (!c) bad.push(m); };
  const strikes = [100, 104, 108, 112];
  const expiries = ["2026-09-04", "2026-09-11", "2026-09-18"];
  const oi = [[-2e8, 1e8, null], [6e8, -3e8, 4e8], [3e8, null, 2e8], [-1e8, -2e8, 5e8]];
  const m = M.terrain({ gamma: { strikes, expiries, oi: { gamma: oi }, spot: 106.5, asOf: "2026-08-24" }, asOf: "x" });
  note(m !== null, "model builds");
  if (!m) return bad;
  const mags = [];
  for (const row of oi) for (const v of row) if (v !== null && v !== 0) mags.push(Math.abs(v));
  mags.sort((a, b) => a - b);
  const cap = mags[Math.round(0.98 * (mags.length - 1))];
  note(m.cap === cap, "the scale is the 98th percentile magnitude");
  for (const v of m.verts) {
    const g = oi[v.i][v.j];
    if (g === null) { note(v.h === null && v.g === null, "a gap stays a gap"); continue; }
    note(v.g === g, "vertex gamma is the input");
    const raw = g / cap;
    note(Math.abs(raw) > m.clip ? v.h === Math.sign(raw) * m.clip : Math.abs(v.h - raw) < 1e-15, "vertex height equals gamma times the scale exactly");
  }
  note(m.gaps === 2, "two pairs not returned");
  note(m.zeros[0].length === 2 && Math.abs(m.zeros[0][0] - 101) < 1e-9 && Math.abs(m.zeros[0][1] - 111) < 1e-9, "the first expiry crosses zero at 101 and 111 by linear roots");
  note(m.zeros[1].length === 1 && Math.abs(m.zeros[1][0] - 101) < 1e-9, "the second crosses once, at 101");
  note(m.zeros[2].length === 0, "no crossing is invented across a gap");
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const col = (j) => sum(oi.map((r) => r[j]).filter((v) => v !== null));
  note(m.net.every((v, j) => Math.abs(v - col(j)) < 1e-3), "per-expiry net equals the sum of the measured cells");
  note(Math.abs(sum(m.net) - sum(oi.flat().filter((v) => v !== null))) < 1e-3, "and the total conserves the grid");
  note(m.outside === null && m.spotAt === 106.5, "spot inside the grid stands where it is");
  const out = M.terrain({ gamma: { strikes, expiries, oi: { gamma: oi }, spot: 130 }, asOf: null });
  note(out.outside === "above" && out.spotAt === 112, "spot beyond the grid is clamped and named");
  const below = M.terrain({ gamma: { strikes, expiries, oi: { gamma: oi }, spot: 90 }, asOf: null });
  note(below.outside === "below" && below.spotAt === 100, "and below");
  note(M.terrain({ gamma: { strikes, expiries, oi: null } }) === null, "no open-interest book gives no terrain");
  note(M.terrain({ gamma: { strikes, expiries, oi: { gamma: [[null, null, null], [null, null, null], [null, null, null], [null, null, null]] } } }) === null, "an all-gap book gives no terrain");
  const flat = M.terrain({ gamma: { strikes: [1, 2, 3], expiries: ["a"], oi: { gamma: [[-1], [0], [1]] }, spot: 2 } });
  note(flat.zeros[0].length === 0, "a measured zero is not a sign change");
  const heap = Array.from({ length: 61 }, (_, i) => [i === 60 ? 1000 : 1]);
  const wide = M.terrain({ gamma: { strikes: heap.map((_, i) => i + 1), expiries: ["a"], oi: { gamma: heap }, spot: 1 } });
  note(wide.clipped === 1 && wide.verts[60].h === wide.clip, "a cell far past the scale is drawn at the limit and counted");
  return bad;
}

const MODEL = load(SCENES_SRC);
eq(surfaceFailures(MODEL), [], "the surface model passes its known answers");
eq(terrainFailures(MODEL), [], "the terrain model passes its known answers");

const MUTANTS = [
  ["surface", "half = 2 * Math.sqrt(atm * atm * T)", "half = Math.sqrt(atm * atm * T)", "range of one root variance"],
  ["surface", "FQ.sliceVolK(slice, k)", "FQ.sliceVolK(slice, -k)", "mirrored smile"],
  ["surface", "if (v !== null && v > 0 && num(m)", "if (v !== null && num(m)", "measured zero kept"],
  ["surface", "const step = list.length > MAX_SLICES", "const step = list.length > 40", "no slice cap"],
  ["terrain", "const scale = 1 / cap", "const scale = 2 / cap", "doubled height"],
  ["terrain", "a * b < 0) at.push", "a * b <= 0) at.push", "crossing invented at zero"],
  ["terrain", "((sf.strikes[i + 1] - sf.strikes[i]) * a) / (a - b)", "((sf.strikes[i + 1] - sf.strikes[i]) * a) / (a + b)", "wrong root"],
  ["terrain", "const g = sf.strikes.map((_, i) => sf.expiries.map((__, j) => num(oi[i] && oi[i][j])));", "const g = sf.strikes.map((_, i) => sf.expiries.map((__, j) => num(oi[i] && oi[i][j]) ?? 0));", "gap read as zero"],
  ["terrain", "const outside = spot === null ? null : spot < lo ? \"below\" : spot > hi ? \"above\" : null;", "const outside = null;", "spot never clamped"],
  ["terrain", "(s === null ? 0 : s) + g[i][j]", "(s === null ? 0 : s) + Math.abs(g[i][j])", "net of magnitudes"],
];
for (const [kind, from, to, why] of MUTANTS) {
  ok(SCENES_SRC.includes(from), `the planted build "${why}" targets a line that exists`);
  const src = SCENES_SRC.replace(from, to);
  ok(src !== SCENES_SRC, `the planted build "${why}" changes the module`);
  const bad = (kind === "surface" ? surfaceFailures : terrainFailures)(load(src));
  ok(bad.length > 0, `the known answers fail the planted build "${why}"`);
}

const EMIT_DIR = nightlyEmit();
const cards = fs.readdirSync(EMIT_DIR).filter((f) => /^-card-[A-Z][A-Z0-9.\-]*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(EMIT_DIR, f), "utf8")));
const card = cards.find((c) => c.engine && Array.isArray(c.engine.expiries) && c.engine.expiries.some((e) => e.smile && e.forward) &&
  c.panels && c.panels.ivSurface && c.panels.ivSurface.status === "ok" && c.panels.surface && c.panels.surface.status === "ok" && c.panels.surface.oi && c.panels.surface.oi.gamma);
ok(card, "the emitter produced a card with a smile, a measured grid and an open-interest book");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };

async function mount(page, html, cardBody, trace) {
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (trace) trace.push(u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      const body = key === "card" ? cardBody : key === "now" ? { serverNow: Date.parse("2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card.sessionDate, trading: false, endsAt: null }, keys: {} } : { status: "pending" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.clock.setFixedTime(new Date(Date.parse(card.generatedAt || card.sessionDate + "T21:00:00Z") + 3600e3));
  await page.goto("https://example.test/flows/ticker/?t=" + card.ticker);
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name…"; }, null, { timeout: 20000 });
}

const browser = await chromium.launch();
try {
  for (const [w, hgt] of [[1440, 900], [390, 844], [320, 700]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const trace = [];
    await mount(page, FLOWS_PAGES.tickerPage({ username: "u", scenes: true }), card, trace);
    ok(!trace.some((p) => /flows-ticker-scenes/.test(p)), `${w}px: nothing of the scenes loads while the modules are far below the fold`);
    await page.locator("#m-surface").scrollIntoViewIfNeeded();
    await page.waitForSelector("#m-surface canvas", { timeout: 15000 });
    await page.locator("#m-terrain").scrollIntoViewIfNeeded();
    await page.waitForSelector("#m-terrain canvas", { timeout: 15000 });
    ok(trace.some((p) => /flows-ticker-scenes/.test(p)), `${w}px: the group loads once a module comes near`);
    const info = await page.evaluate(() => {
      const out = {};
      for (const id of ["m-surface", "m-terrain"]) {
        const sec = document.getElementById(id);
        const cv = sec.querySelector("canvas");
        const ctx2 = cv.getContext("2d");
        const px = ctx2.getImageData(0, 0, cv.width, cv.height).data;
        let lit = 0;
        for (let i = 0; i < px.length; i += 4 * 7) if (px[i + 3] > 0 && (px[i] + px[i + 1] + px[i + 2]) > 30) lit++;
        out[id] = { label: cv.getAttribute("aria-label"), role: cv.getAttribute("role"), tab: cv.tabIndex, w: cv.getBoundingClientRect().width, lit,
          rows: sec.querySelectorAll("table tbody tr").length, cols: sec.querySelectorAll("table thead th").length, text: sec.textContent, cap: sec.querySelector(".ft-scene-cap") ? sec.querySelector(".ft-scene-cap").innerText : "" };
      }
      out.scrollW = document.documentElement.scrollWidth;
      out.clientW = document.documentElement.clientWidth;
      return out;
    });
    ok(info.scrollW <= info.clientW, `${w}px: no horizontal overflow (${info.scrollW} against ${info.clientW})`);
    for (const id of ["m-surface", "m-terrain"]) {
      ok(info[id].role === "img" && info[id].label.length > 60 && info[id].tab === 0, `${w}px: ${id} canvas is described and focusable`);
      ok(info[id].lit > 200, `${w}px: ${id} canvas has drawn pixels (${info[id].lit})`);
      ok(info[id].w <= w, `${w}px: ${id} canvas fits the viewport`);
      ok(info[id].rows > 0, `${w}px: ${id} has a table alternative`);
    }
    const P = card.panels;
    eq(info["m-terrain"].rows, P.surface.strikes.length + 1, `${w}px: terrain table has one row per strike and a net row`);
    eq(info["m-terrain"].cols, P.surface.expiries.length + 1, `${w}px: and one column per expiry`);
    ok(info["m-terrain"].text.includes("dollars per 1% move") && info["m-terrain"].text.includes(DEALER_CLAUSE), `${w}px: terrain names its unit and the dealer convention`);
    ok(/Fitted; quoted range not published/.test(info["m-surface"].cap), `${w}px: surface captions the fitted range`);
    ok(!/\bat (the )?(ask|bid)\b|\bNOW\b/i.test(info["m-surface"].text + info["m-terrain"].text), `${w}px: copy passes the vendor-term lint`);
    if (w === 1440) {
      const gaps = P.surface.oi.gamma.flat().filter((v) => v === null).length;
      eq(info["m-terrain"].text.split("—").length - 1 >= gaps, true, "every gap prints as a dash in the table");
      const measured = await page.evaluate(({ card }) => {
        const FQ = window.FlowsQuant;
        const M = window.FlowsUI.scenes.model.surface({ engine: card.engine, ivSurface: card.panels.ivSurface }, FQ);
        return M.fitted.map((f) => { const e = card.engine.expiries.find((x) => x.dte === f.dte); return [f.atm, FQ.sliceVolK(FQ.sliceFromSummary(e), 0), f.half, f.pts.map((p) => [p.k, p.iv, FQ.sliceVolK(FQ.sliceFromSummary(e), p.k)])]; });
      }, { card });
      ok(measured.length > 0, "the real bundle yields fitted slices for the emitted card");
      for (const [a, b, half, pts] of measured) {
        near(a, b, 1e-12, "fitted at-the-money volatility is the bundle's");
        for (const [k, iv, ref] of pts) { ok(Math.abs(k) <= half + 1e-12, "no fitted point beyond two root total variances"); near(iv, ref, 1e-12, "each fitted point is the bundle's own"); }
      }
      const before = await page.evaluate(() => document.querySelector("#m-terrain canvas").toDataURL().length + ":" + document.querySelector("#m-terrain canvas").toDataURL().slice(-200));
      await page.locator("#m-terrain canvas").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      const after = await page.evaluate(() => document.querySelector("#m-terrain canvas").toDataURL().length + ":" + document.querySelector("#m-terrain canvas").toDataURL().slice(-200));
      ok(before !== after, "the arrow keys turn the terrain");
    }
    eq(errors, [], `${w}px: no page errors`);
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const trace = [];
  await mount(page, FLOWS_PAGES.tickerPage({ username: "u" }), card, trace);
  ok(!(await page.$("#m-surface")) && !(await page.$("#m-terrain")), "without the switch the ticker has neither scene module");
  ok(!trace.some((p) => /flows-ticker-scenes/.test(p)), "and requests nothing of them");
  await ctx.close();
  const gapCard = JSON.parse(JSON.stringify(card));
  gapCard.panels.surface.oi = null;
  gapCard.panels.ivSurface = { status: "unavailable", reason: "none" };
  gapCard.engine = null;
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await mount(p2, FLOWS_PAGES.tickerPage({ username: "u", scenes: true }), gapCard, []);
  await p2.locator("#m-terrain").scrollIntoViewIfNeeded().catch(() => {});
  await p2.waitForFunction(() => /open-interest/.test((document.getElementById("m-terrain") || { textContent: "" }).textContent), null, { timeout: 15000 }).catch(() => {});
  const txt = await p2.evaluate(() => (document.getElementById("m-terrain") || { textContent: "" }).textContent + (document.getElementById("m-surface") || { textContent: "" }).textContent);
  ok(/no open-interest book/.test(txt), txt.slice(0, 300) + " :: " + "a card without the book withholds the terrain with its reason");
  await ctx2.close();
} finally {
  await browser.close();
}
console.log(`flows-scenes-render: ${checks} checks`);
