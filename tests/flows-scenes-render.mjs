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
ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(/.test(SCENES_SRC), "the scenes module holds no literal colour: every colour is read from a computed custom property");
ok(/cssVar\("--surface-1"\)/.test(SCENES_SRC), "and the canvas ground is the theme's --surface-1");
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
  const hs = m.fitted.map((f) => f.half).sort((a, b) => a - b);
  note(Math.abs(m.kmax - (hs[5] + hs[6]) / 2) < 1e-12, "the drawn money range is the median fitted range, so no slice is stretched past its own");
  note(M.surface({ engine: null, ivSurface: { rows: [-0.5, 0.2], expiries: [{ expiry: "x", days: 5 }], iv: [[0.3], [0.2]] } }, STUB_FQ).kmax === 0.5, "with no fitted slice the range is the widest measured money");
  note(m.mesh.length === 11, "one mesh strip joins each neighbouring pair of the twelve fitted slices");
  m.mesh.forEach((q, n) => {
    const a = m.fitted[n], b = m.fitted[n + 1];
    const ea = eng.expiries.find((x) => x.dte === a.dte), eb = eng.expiries.find((x) => x.dte === b.dte);
    const c = Math.min(a.half, b.half, m.kmax);
    note(q.d0 === a.dte && q.d1 === b.dte, "a strip spans its two slices");
    note(Math.abs(q.k[0] + c) < 1e-12 && Math.abs(q.k[24] - c) < 1e-12, "and only the money range both slices cover");
    note(q.k.every((k, i) => Math.abs(q.iv0[i] - (ea.atm + 0.3 * k + 0.5 * k * k)) < 1e-12 && Math.abs(q.iv1[i] - (eb.atm + 0.3 * k + 0.5 * k * k)) < 1e-12), "each mesh vertex is the engine slice's own volatility");
  });
  const none = M.surface({ engine: null, ivSurface: null }, STUB_FQ);
  note(none.mesh.length === 0, "no slices, no mesh");
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
  const tradedGrid = [[-2, 5], [4, null], [1, -3]];
  const tr = M.terrain({ gamma: { strikes: [10, 20, 30], expiries: ["2026-09-04", "2026-09-11"], oi: null, grid: tradedGrid, spot: 21 } });
  note(tr && tr.basis === "traded" && tr.ridge === false, "a card with no open-interest book draws the traded grid");
  note(tr.verts.every((v) => (tradedGrid[v.i][v.j] === null ? v.g === null : v.g === tradedGrid[v.i][v.j])), "and every traded cell is the card's own");
  note(tr.gaps === 1 && Math.abs(tr.zeros[0][0] - (10 + (10 * -2) / (-2 - 4))) < 1e-9, "its gap is a gap and its crossing is the linear root");
  const bothGrids = M.terrain({ gamma: { strikes: [10, 20, 30], expiries: ["a", "b"], oi: { gamma: [[1, 1], [1, 1], [1, 1]] }, grid: tradedGrid, spot: 21 } });
  note(bothGrids.basis === "book", "the open-interest book wins when both are on the card");
  const spare = M.terrain({ gamma: { strikes: [10, 20, 30], expiries: ["a", "b"], oi: { gamma: [[null, null], [null, null], [null, null]] }, grid: tradedGrid, spot: 21 } });
  note(spare.basis === "traded", "an all-gap book falls back to the traded grid");
  const ridge = M.terrain({ gamma: { strikes: [10, 20, 30, 40], expiries: ["2026-09-04"], grid: [[3], [-1], [-2], [5]], spot: 25 } });
  note(ridge.ridge === true && ridge.verts.length === 4 && ridge.zeros[0].length === 2 && Math.abs(ridge.zeros[0][0] - 17.5) < 1e-9 && Math.abs(ridge.zeros[0][1] - (30 + 20 / 7)) < 1e-9, "one expiry is a ridge with its crossings at 17.5 and 32.86");
  note(M.terrain({ gamma: { strikes: [10, 20], expiries: ["a"], grid: [[null], [null]] } }) === null, "a traded grid with nothing measured gives no terrain");
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
  ["surface", "const c = Math.min(a.half, b.half, kmax);", "const c = Math.max(a.half, b.half, kmax);", "mesh over the wider range"],
  ["surface", "iv1.push(num(FQ.sliceVolK(slices[i + 1], kk)));", "iv1.push(num(FQ.sliceVolK(slices[i], kk)));", "mesh far edge from the near slice"],
  ["terrain", "const basis = measured(book) ? \"book\" : measured(traded) ? \"traded\" : null;", "const basis = measured(book) ? \"book\" : null;", "no traded fallback"],
  ["terrain", "const basis = measured(book) ? \"book\" : measured(traded) ? \"traded\" : null;", "const basis = measured(traded) ? \"traded\" : measured(book) ? \"book\" : null;", "traded preferred over the book"],
  ["terrain", "ridge: ne === 1,", "ridge: false,", "ridge not named"],
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
  let bad;
  try { bad = (kind === "surface" ? surfaceFailures : terrainFailures)(load(src)); } catch (e) { bad = ["threw"]; }
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
    if (process.env.SCENES_SHOTS) for (const id of ["m-surface", "m-terrain"]) await page.locator("#" + id).screenshot({ path: path.join(process.env.SCENES_SHOTS, `${id}-${w}.png`) });
    const info = await page.evaluate(() => {
      const out = {};
      for (const id of ["m-surface", "m-terrain"]) {
        const sec = document.getElementById(id);
        const cv = sec.querySelector("canvas");
        const ctx2 = cv.getContext("2d");
        const px = ctx2.getImageData(0, 0, cv.width, cv.height).data;
        let lit = 0;
        for (let i = 0; i < px.length; i += 4 * 7) if (px[i + 3] > 0 && (px[i] + px[i + 1] + px[i + 2]) > 30) lit++;
        let x0 = cv.width, x1 = -1;
        for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
          const i = (y * cv.width + x) * 4;
          if (px[i + 3] > 200 && Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
        }
        out[id] = { bg: [px[0], px[1], px[2], px[3]], token: getComputedStyle(document.body).getPropertyValue("--surface-1").trim(), span: x1 < 0 ? 0 : (x1 - x0) / cv.width, ch: cv.getBoundingClientRect().height,
          labels: (cv.dataset.labels || "").split("|"), label: cv.getAttribute("aria-label"), role: cv.getAttribute("role"), tab: cv.tabIndex, w: cv.getBoundingClientRect().width, lit,
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
    for (const id of ["m-surface", "m-terrain"]) {
      const want = [1, 3, 5].map((k) => parseInt(info[id].token.slice(k, k + 2), 16));
      ok(/^#[0-9a-f]{6}$/i.test(info[id].token) && info[id].bg.every((v, n) => Math.abs(v - (n < 3 ? want[n] : 255)) <= 1), `${w}px: ${id} canvas is the theme's --surface-1 token (${info[id].token}), not a grey card`);
      near(info[id].ch, w < 560 ? 320 : 420, 1, `${w}px: ${id} canvas height`);
      ok(info[id].span >= 0.55, `${w}px: ${id} mesh spans ${(info[id].span * 100).toFixed(0)}% of the canvas width, at least 55%`);
    }
    const sl = info["m-surface"].labels;
    ok(sl.includes("ATM"), `${w}px: surface prints the money-ness origin`);
    ok(w < 560 || ["Strike ÷ forward", "Days to expiry", "Implied vol, vol points"].every((t) => sl.includes(t)), `${w}px: and its axis titles where there is room`);
    ok(/Axes: strike as a share of the forward/.test(info["m-surface"].text) && /Axes: strike along the front/.test(info["m-terrain"].text), `${w}px: both modules state their axes in words`);
    const dayTicks = sl.filter((t) => /^\d+d$/.test(t)).map((t) => parseInt(t, 10));
    const wantDays = new Set(card.engine.expiries.filter((e) => e.smile && e.forward && e.dte > 0).map((e) => e.dte).concat(card.panels.ivSurface.expiries.map((e) => e.days)));
    ok(dayTicks.length >= 3 && dayTicks.every((d) => wantDays.has(d)) && dayTicks.includes(Math.min(...wantDays)) && dayTicks.includes(Math.max(...wantDays)), `${w}px: expiry ticks are real expiries in days and reach both ends (${dayTicks})`);
    const volTicks = sl.filter((t) => /^\d+(\.\d)?$/.test(t)).map(Number);
    const mIv = card.panels.ivSurface.iv.flat().filter((v) => v > 0);
    ok(volTicks.length >= 3 && Math.min(...volTicks) <= Math.min(...mIv) * 100 && Math.max(...volTicks) >= Math.max(...mIv) * 100, `${w}px: volatility ticks in vol points bracket the measured readings (${volTicks})`);
    ok(sl.filter((t) => /^\d+%$/.test(t)).length >= 2, `${w}px: strike ticks print as a share of the forward`);
    const tl = info["m-terrain"].labels;
    ok(tl.includes("0") && (w < 560 || ["Strike", "Expiry (MM-DD)"].every((t) => tl.includes(t))) && P.surface.expiries.filter((e, i, a) => w >= 560 || i === a.length - 1).every((e) => tl.includes(e.slice(5, 10))), `${w}px: terrain prints its axes, its expiry dates and the zero height`);
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
  const clone = (c) => JSON.parse(JSON.stringify(c));
  async function variant(card2, w, hgt, fn) {
    const vctx = await browser.newContext({ viewport: { width: w, height: hgt } });
    const vp = await vctx.newPage();
    const errs = [];
    vp.on("pageerror", (e) => errs.push(String(e)));
    await mount(vp, FLOWS_PAGES.tickerPage({ username: "u", scenes: true }), card2, []);
    await vp.locator("#m-terrain").scrollIntoViewIfNeeded();
    await vp.waitForFunction(() => { const t = document.getElementById("m-terrain"); return t && (t.querySelector("canvas") || t.querySelector(".ui-silent")); }, null, { timeout: 15000 });
    await fn(vp);
    eq(errs, [], `${w}px: no page errors in the variant`);
    await vctx.close();
  }
  const gapCard = clone(card);
  gapCard.panels.surface = { status: "unavailable", reason: "no expiry-strike gamma" };
  gapCard.panels.ivSurface = { status: "unavailable", reason: "none" };
  gapCard.engine = null;
  await variant(gapCard, 390, 844, async (vp) => {
    const txt = await vp.evaluate(() => document.getElementById("m-terrain").textContent);
    ok(/no strike-by-expiry gamma/.test(txt) && /no expiry-strike gamma/.test(txt), "a card with no gamma grid at all withholds the terrain and gives the card's reason in plain words");
    ok((await vp.locator("#m-terrain .ui-silent button").count()) === 1, "with a Why");
    ok(!(await vp.$("#m-terrain canvas")), "and draws nothing");
  });

  const independent = (grid, strikes) => {
    const mags = grid.flat().filter((v) => v !== null && v !== 0).map(Math.abs).sort((a, b) => a - b);
    const cap = mags[Math.round(0.98 * (mags.length - 1))];
    const ne = grid[0].length;
    const net = Array.from({ length: ne }, (_, j) => { let t = 0, any = false; for (const r of grid) if (r[j] !== null) { t += r[j]; any = true; } return any ? t : null; });
    const zeros = Array.from({ length: ne }, (_, j) => { const at = []; for (let i = 0; i + 1 < grid.length; i++) { const a = grid[i][j], b = grid[i + 1][j]; if (a !== null && b !== null && a * b < 0) at.push(strikes[i] + (strikes[i + 1] - strikes[i]) * (a / (a - b))); } return at; });
    return { cap, net, zeros };
  };
  const tradedCard = clone(card);
  tradedCard.panels.surface.oi = null;
  const traded = tradedCard.panels.surface;
  ok(traded.grid.length > 3 && traded.grid.flat().some((v) => v !== null), "the emitted card carries a traded strike-by-expiry grid");
  for (const [w, hgt] of [[1440, 900], [390, 844]]) {
    await variant(tradedCard, w, hgt, async (vp) => {
      await vp.waitForSelector("#m-terrain canvas", { timeout: 15000 });
      const got = await vp.evaluate(({ card2 }) => {
        const sec = document.getElementById("m-terrain");
        const cv = sec.querySelector("canvas");
        const px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        let lit = 0, x0 = cv.width, x1 = -1;
        for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
          const i = (y * cv.width + x) * 4;
          if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 40) { lit++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
        }
        const m = window.FlowsUI.scenes.model.terrain({ gamma: card2.panels.surface });
        return { text: sec.textContent, labels: cv.dataset.labels.split("|"), lit, span: (x1 - x0) / cv.width, rows: sec.querySelectorAll("tbody tr").length, cols: sec.querySelectorAll("thead th").length,
          m: { basis: m.basis, cap: m.cap, net: m.net, zeros: m.zeros, ridge: m.ridge } };
      }, { card2: tradedCard });
      const ref = independent(traded.grid, traded.strikes);
      eq(got.m.basis, "traded", `${w}px: with no open-interest book the terrain is the traded grid`);
      near(got.m.cap, ref.cap, 1e-9, `${w}px: its scale is the independent 98th percentile`);
      ok(got.m.net.every((v, j) => (v === null ? ref.net[j] === null : Math.abs(v - ref.net[j]) <= Math.abs(ref.net[j]) * 1e-12 + 1e-9)), `${w}px: per-expiry nets equal the independent sums`);
      ok(got.m.zeros.every((z, j) => z.length === ref.zeros[j].length && z.every((v, n) => Math.abs(v - ref.zeros[j][n]) < 1e-9)), `${w}px: sign changes equal the independent roots`);
      ok(got.text.includes(DEALER_CLAUSE) && /Gamma traded today/.test(got.text) && /no dollar unit/.test(got.text), `${w}px: the traded terrain keeps the clause, names itself and states that no dollar unit is published`);
      eq([got.rows, got.cols], [traded.strikes.length + 1, traded.expiries.length + 1], `${w}px: the traded table is strikes by expiries plus a net row`);
      ok(got.lit > 200 && got.span >= 0.55, `${w}px: the traded terrain fills ${(got.span * 100).toFixed(0)}% of the canvas width`);
      ok(got.labels.includes("0") && (w < 560 || (got.labels.includes("Strike") && got.labels.includes("Gamma traded") && traded.expiries.every((e) => got.labels.includes(e.slice(5, 10))))), `${w}px: traded terrain prints its axes`);
    });
  }
  const ridgeCard = clone(card);
  const rs = ridgeCard.panels.surface;
  rs.oi = null;
  rs.expiries = rs.expiries.slice(0, 1);
  rs.grid = rs.grid.map((r) => r.slice(0, 1));
  await variant(ridgeCard, 1440, 900, async (vp) => {
    await vp.waitForSelector("#m-terrain canvas", { timeout: 15000 });
    const got = await vp.evaluate(() => { const sec = document.getElementById("m-terrain"); const cv = sec.querySelector("canvas"); const px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 0; i < px.length; i += 28) if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 40) lit++; return { text: sec.textContent, lit, cols: sec.querySelectorAll("thead th").length }; });
    ok(/drawn as a ridge/.test(got.text) && /single ridge/.test(got.text), "one expiry on the card is drawn as a ridge and says so");
    ok(got.lit > 100 && got.cols === 2, "and the ridge has drawn pixels and a one-expiry table");
  });
} finally {
  await browser.close();
}
console.log(`flows-scenes-render: ${checks} checks`);
