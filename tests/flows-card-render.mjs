import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildSurface, buildPath } from "../shared/flows-card.js";
import * as FLOWS_PAGES from "../shared/flows-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCRATCH = await mkdtemp(path.join(os.tmpdir(), "flows-render-"));
execFileSync(process.execPath, [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", SCRATCH + path.sep],
  { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const read = (f) => JSON.parse(fs.readFileSync(path.join(SCRATCH, f), "utf8"));

const emitted = fs.readdirSync(SCRATCH).filter((f) => /^-card-[A-Z][A-Z0-9.\-]*\.json$/.test(f)).sort();
ok(emitted.length > 0, `the dry run emitted cards to sweep (${SCRATCH})`);
const cards = emitted.map(read);
const okP = (c, k) => c.panels && c.panels[k] && c.panels[k].status === "ok";
const base = cards.find((c) => c.depth !== "index" && ["gamma", "levels", "surface", "path", "pricedMove"].every((k) => okP(c, k)));
ok(base, "an emitted card carries the gamma, levels, surface, path and priced-move panels the fixtures ride on");
const companion = (kind, t) => { const f = path.join(SCRATCH, "-" + kind + "-" + t + ".json"); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { status: "pending" }; };

const TICKER_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
const PAGE_HTML = FLOWS_PAGES.tickerPage({ username: "test" });
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };

{
  const glued = [...TICKER_SRC.matchAll(/class: "([^"]*)" \+ \(([^()?]+)\? "([^"]*)" : "([^"]*)"\)/g)]
    .filter((m) => m[1] !== "" && !/ $/.test(m[1]) && [m[3], m[4]].some((b) => b !== "" && !/^ /.test(b)))
    .map((m) => m[0]);
  eq(glued.length, 0,
     `every class string joined to a conditional class keeps a space between the two (${glued.join(" | ") || "none glued"}) ` +
     "— the old page glued \"ft-hero-v\" to \"is-pos\" into the one class ft-hero-vis-pos, which matched no rule, " +
     "and seven sites lost their colour at once");
}

async function mount(page, card, o = {}) {
  const api = {
    card, summary: { status: "quiet", scope: card.ticker, summary: null, ideas: [] },
    "card-x": o.cardX || companion("card-x", card.ticker), hist: o.hist || companion("hist", card.ticker),
    tape: { status: "pending" }, meta: { status: "pending" }, events: { status: "pending", rows: [] },
    now: { serverNow: Date.parse(card.generatedAt || "2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card.sessionDate, trading: false, endsAt: null }, keys: {} },
  };
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      const body = key === "board" ? { status: "pending", rows: [] } : api[key] === undefined ? { status: "pending" } : api[key];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  if (!page._clocked) {
    page._clocked = true;
    await page.clock.setFixedTime(new Date(Date.parse(card.generatedAt || card.sessionDate + "T21:00:00Z") + 3600e3));
  }
  await page.goto("https://example.test/flows/ticker/?t=" + encodeURIComponent(card.ticker));
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name…"; }, null, { timeout: 15000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(200);
  await settle(page);
}

async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (t && Number.isFinite(t.endTime)) { try { a.finish(); } catch {} }
    }
  });
  await page.waitForTimeout(60);
}

async function pickView(page, mod, label) {
  const i = await page.evaluate(({ mod, label }) => [...document.querySelectorAll("#" + mod + " .ui-seg-i")].findIndex((b) => b.textContent.trim() === label), { mod, label });
  if (i < 0) return false;
  const already = await page.evaluate(({ mod, i }) => {
    const box = document.querySelector("#" + mod + " .ft-cbox");
    if (box && box.firstElementChild) box.firstElementChild.dataset.stale = "1";
    return document.querySelectorAll("#" + mod + " .ui-seg-i")[i].getAttribute("aria-selected") === "true";
  }, { mod, i });
  if (already) await page.evaluate((mod) => { const box = document.querySelector("#" + mod + " .ft-cbox"); if (box && box.firstElementChild) delete box.firstElementChild.dataset.stale; }, mod);
  else {
    await page.locator("#" + mod + " .ui-seg-i").nth(i).click();
    await page.waitForFunction((mod) => { const box = document.querySelector("#" + mod + " .ft-cbox"); return !box || (box.firstElementChild && !box.firstElementChild.dataset.stale); }, mod, { timeout: 5000 });
  }
  await page.waitForTimeout(40);
  await settle(page);
  return true;
}

async function modInfo(page, id) {
  return page.evaluate((id) => {
    const b = document.querySelector("#" + id + " .ui-mod-h .ui-info");
    if (!b) return null;
    window.FlowsUI.openInfo(b);
    const t = document.getElementById("fxPop").innerText;
    window.FlowsUI.closeInfo();
    return t;
  }, id);
}

function measure({ id, vw }) {
  const host = document.getElementById(id);
  const svgs = [...host.querySelectorAll("svg")].filter((s) => !s.closest(".ui-g, .ui-info, .ui-state, .ui-seg, button") && s.getBoundingClientRect().width > 40);
  let minText = Infinity, clipped = null;
  for (const svg of svgs) {
    const box = svg.getBoundingClientRect();
    for (const t of svg.querySelectorAll("text")) {
      const r = t.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.height < minText) minText = r.height;
      if (!clipped && (r.left < box.left - 2 || r.right > box.right + 2)) clipped = t.textContent;
    }
  }
  return {
    empty: ![...host.children].filter((c) => !c.classList.contains("ui-mod-h")).some((c) => c.innerText.trim().length > 2 || c.querySelector("svg, .ui-silent")),
    minText: minText === Infinity ? null : Math.round(minText * 10) / 10, clipped,
    widths: svgs.map((s) => Math.round(s.getBoundingClientRect().width)),
    scales: svgs.map((s) => [Number((s.getAttribute("viewBox") || "").split(/\s+/)[2]), s.getBoundingClientRect().width]),
    par: svgs.map((s) => s.getAttribute("preserveAspectRatio") || "(default)"),
    overflow: document.documentElement.scrollWidth > vw,
  };
}

async function walk(page, vw) {
  const out = [];
  const mods = await page.evaluate(() => [...document.querySelectorAll("#ftGrid .ui-mod[id]")].map((m) => m.id));
  for (const id of mods) {
    const labels = await page.evaluate((id) => [...document.querySelectorAll("#" + id + " .ui-seg-i")].map((b) => b.textContent.trim()), id);
    for (const label of labels.length ? labels : [null]) {
      if (label) await pickView(page, id, label);
      out.push({ id, label, ...(await page.evaluate(measure, { id, vw })) });
    }
  }
  return out;
}

function surfaceFixture() {
  const rows = [];
  const expiries = ["2026-08-28", "2026-09-04", "2026-09-18", "2026-10-16"];
  for (let i = 0; i < 25; i++) {
    const k = 90 + i;
    for (const [j, e] of expiries.entries()) {
      if (k === 97 && e === "2026-09-04") continue;
      let g = 3e6 * Math.exp(-Math.pow((k - 100) / 4.5, 2)) / (1 + j * 0.8) * (k >= 100 ? 1 : -1);
      if (k === 103 && j === 0) g = 9e9;
      if (k === 98 && e === "2026-09-18") g = 0;
      rows.push({ strike: String(k), expiry: e, call_gamma_ask: String(g * 0.6), call_gamma_bid: String(g * 0.4), put_gamma_ask: "0", put_gamma_bid: "0" });
    }
  }
  return buildSurface(rows, { spot: 100.4, asOf: "2026-08-25" });
}

function onSurface(panel) {
  const card = clone(base);
  card.panels.surface = panel;
  card.panels.pricedMove = { ...card.panels.pricedMove, spot: 100.4 };
  card.panels.levels = { ...card.panels.levels, status: "ok", spot: 100.4,
    levels: [{ kind: "call_wall", label: "Call wall", px: 104 }, { kind: "put_wall", label: "Put wall", px: 95 }, { kind: "zero_gamma", label: "Zero-gamma level", px: 99.5 }] };
  return card;
}

const panel = surfaceFixture();
ok(panel.status === "ok", "the fixture builds a surface");
eq(panel.clipped, 1, "the fixture clips exactly one cell");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await mount(page, onSurface(panel));
  ok(await pickView(page, "m-gamma", "Grid"), "the Gamma module offers the grid as one of its views when the card carries a surface");
  const r = await page.evaluate(() => {
    const box = document.querySelector("#m-gamma .ft-cbox");
    const svg = box.querySelector("svg");
    if (!svg) return { error: "no svg" };
    const q = (sel) => svg.querySelectorAll(sel).length;
    const n = (el, a) => Number(el.getAttribute(a));
    const signed = [...svg.querySelectorAll(".ft-gv.is-pos, .ft-gv.is-neg")];
    const cellR = signed[0].getBoundingClientRect();
    const gs = svg.querySelector(".ft-gs");
    const leg = document.querySelector("#m-gamma .ft-leg-row");
    const hatch = leg.querySelector(".ui-key > i.ft-hatch");
    const label = svg.querySelector(".ft-gy");
    return {
      signed: signed.length, voids: q(".ft-gv.is-void"), zeros: q(".ft-gv.is-zero"), zeroDots: q(".ft-gz"),
      zeroSigned: q(".ft-gv.is-zero.is-pos, .ft-gv.is-zero.is-neg"), negs: q(".ft-gv.is-neg"), hatches: q(".ft-gh"), clips: q(".ft-gc"),
      shades: signed.map((c) => Number(c.getAttribute("fill-opacity"))),
      clipBoxes: [...svg.querySelectorAll(".ft-gc")].map((l) => [Math.abs(n(l, "x2") - n(l, "x1")), Math.abs(n(l, "y2") - n(l, "y1"))]),
      cellW: cellR.width + 2, cellH: cellR.height + 2,
      spot: q(".ft-gs"), callWall: q(".ft-gw.is-call"), putWall: q(".ft-gw.is-put"),
      spotRow: gs ? [n(gs, "y"), n(gs, "y") + n(gs, "height")] : null,
      wallYs: [...svg.querySelectorAll(".ft-gw")].map((c) => n(c, "cy")),
      prices: [...svg.querySelectorAll(".ft-gy")].map((t) => ({ text: t.textContent, y: n(t, "y") })),
      exps: q(".ft-gx"),
      aria: svg.getAttribute("aria-label") || "",
      ramp: [...leg.querySelectorAll(".ft-ramp-s > i")].map((i) => Number(getComputedStyle(i).opacity)),
      rampText: (leg.querySelector(".ft-ramp") || {}).textContent || "",
      hatchKey: hatch ? getComputedStyle(hatch).backgroundImage : "",
      legend: leg.innerText,
      svgW: svg.getBoundingClientRect().width, boxW: box.clientWidth, vb: Number(svg.getAttribute("viewBox").split(/\s+/)[2]),
      labelPx: label ? label.getBoundingClientRect().height : 0,
      overflow: document.documentElement.scrollWidth > 320,
    };
  });
  ok(!r.error, "the grid renders an svg");
  eq(r.signed + r.zeros + r.voids, panel.strikes.length * panel.expiries.length, "drawn cells plus voids reconcile against the grid");
  ok(r.voids >= 1, "the pair the vendor did not return is drawn as an explicit void");
  eq(r.hatches, r.negs, "every short-gamma cell carries the hatch that encodes sign without hue");
  eq(r.clips, panel.clipped, "every cell past the colour cap is marked, and only those");
  ok(new Set(r.shades).size > 3, `magnitude is encoded in opacity, not flattened (${new Set(r.shades).size} levels)`);
  eq(r.zeros, 1, "the pair the vendor measured at exactly zero is drawn as its own kind of cell");
  eq(r.zeroSigned, 0, "and carries NO sign class — zero is neither long nor short gamma");
  ok(r.zeroDots >= 1, "with a mark of its own, so it cannot be mistaken for a void");
  {
    const mags = [];
    for (let i = panel.strikes.length - 1; i >= 0; i--) for (const v of panel.grid[i]) if (v !== null && v !== 0) mags.push(Math.abs(v));
    eq(r.shades.length, mags.length, "every shaded cell pairs with a magnitude on the grid");
    const sorted = mags.slice().sort((a, b) => a - b);
    const d1 = sorted[Math.floor(sorted.length * 0.1)], d9 = sorted[Math.floor(sorted.length * 0.9)];
    const bulk = r.shades.filter((_, i) => mags[i] >= d1 && mags[i] <= d9);
    const spread = Math.max(...bulk) - Math.min(...bulk);
    ok(spread >= 0.4, `the shading spends its range on the cells rather than on the outlier (interdecile opacity spread ${spread.toFixed(3)} over ${bulk.length} cells)`);
    const pairs = mags.map((m, i) => [m, r.shades[i]]).sort((a, b) => a[0] - b[0]);
    let inversions = 0;
    for (let i = 1; i < pairs.length; i++) if (pairs[i][1] < pairs[i - 1][1] - 1e-9) inversions++;
    eq(inversions, 0, "and a bigger cell is never drawn paler than a smaller one");
  }
  eq(r.ramp.length, 5, "the shading key draws the ramp in five steps");
  eq(new Set(r.ramp).size, 5, "each step at its own shade");
  ok(r.ramp.every((v, i, a) => i === 0 || v > a[i - 1]), `the key runs pale to dark in the order the cells do (${r.ramp.join(", ")})`);
  ok(/repeating-linear-gradient/.test(r.hatchKey), "the short-gamma key draws the texture itself rather than naming a colour for it — a legend whose sign key is a hue is a legend a greyscale reader cannot use");
  ok(/Off scale/.test(r.legend), "and the key names the off-scale slash");
  const gInfo = await modInfo(page, "m-gamma");
  const ends = /^(.+) – (.+) Γ$/.exec(r.rampText.trim());
  ok(ends, `the ramp states both of its ends (${r.rampText})`);
  ok(ends && gInfo.includes("from " + ends[1] + " up to " + ends[2] + " Γ"), "and both are numbers the disclosure states too, so picture and prose cannot drift");
  ok(/Shade steps by a factor of (1\.5|2|3|5|10) from/.test(gInfo), "the disclosure names the step factor, so a shade converts to a number");
  ok(/Colour is capped at /.test(gInfo), "and says the colour scale is capped");
  ok(/1 cell exceeds it \(peak [^)]+\) and is drawn at full strength with a slash/.test(gInfo), "one clipped cell is described in the singular, with the peak it hides");
  ok(/strike/.test(r.aria) && /expir/.test(r.aria), `the grid has an accessible label naming both of its axes (${r.aria.slice(0, 80)})`);
  ok(/hatched/.test(r.aria), "and says what the hatch means, since a screen reader cannot see it");
  eq(r.exps, panel.expiries.length, "every expiry column is labelled");
  ok(r.prices.length >= 3, "the price ladder is labelled");
  ok(r.prices.length <= Math.ceil(panel.strikes.length / 2) + 3, `the price rail is sparse rather than exhaustive (${r.prices.length} labels for ${panel.strikes.length} strikes)`);
  {
    const ys = r.prices.map((p) => p.y).sort((a, b) => a - b);
    let tightest = Infinity;
    for (let i = 1; i < ys.length; i++) tightest = Math.min(tightest, ys[i] - ys[i - 1]);
    ok(tightest >= 11, `and no two prices are drawn on top of each other (closest pair ${tightest} units apart)`);
  }
  ok(r.spotRow && r.prices.some((p) => p.y > r.spotRow[0] && p.y < r.spotRow[1]), "spot's row is labelled inside that budget, never thinned out");
  for (const y of r.wallYs) ok(r.prices.some((p) => Math.abs(p.y - 3.5 - y) < 2), `and so is each wall's row (${y})`);
  for (const [dx, dy] of r.clipBoxes) {
    ok(dx <= r.cellW + 0.5 && dy <= r.cellH + 0.5, `the off-scale mark stays inside its own cell (${dx.toFixed(1)}x${dy.toFixed(1)} in a ${r.cellW.toFixed(1)}x${r.cellH.toFixed(1)} cell)`);
    ok(Math.abs(dx - dy) < 0.5, "and is a slash at 45 degrees rather than the cell's diagonal");
  }
  eq(r.spot, 1, "spot is drawn");
  eq(r.callWall, 1, "the call wall is marked");
  eq(r.putWall, 1, "the put wall is marked");
  ok(Math.abs(r.svgW - r.boxW) <= 1, `the grid fills its module rather than a fixed canvas (${r.svgW} in ${r.boxW})`);
  ok(Math.abs(r.vb - r.svgW) < 1, "and one viewBox unit is one CSS pixel");
  ok(r.labelPx >= 8, `axis type renders at its intended size, not scaled down (${r.labelPx}px)`);
  ok(r.cellH >= 6.5, `cells stay tall enough to be cells (${r.cellH}px)`);
  ok(r.cellW >= 6.5, `and wide enough (${r.cellW}px)`);
  eq(r.overflow, false, "and nothing overflows a 320px viewport");

  {
    const p2 = clone(panel);
    p2.clipped = 2;
    p2.grid[0][0] = p2.scaleCap * 40;
    p2.grid[1][0] = p2.scaleCap * 40;
    await mount(page, onSurface(p2));
    await pickView(page, "m-gamma", "Grid");
    const clips = await page.evaluate(() => document.querySelectorAll("#m-gamma .ft-cbox .ft-gc").length);
    ok(/2 cells exceed it \(peak [^)]+\) and are drawn at full strength with a slash/.test(await modInfo(page, "m-gamma")), "two clipped cells are described in the plural");
    ok(clips >= 2, "and both are actually marked on the grid");
  }

  {
    const p3 = clone(panel);
    delete p3.scaleCap; delete p3.peak; delete p3.clipped;
    await mount(page, onSurface(p3));
    await pickView(page, "m-gamma", "Grid");
    const none = await page.evaluate(() => ({
      cells: document.querySelectorAll("#m-gamma .ft-cbox .ft-gv").length,
      ramp: document.querySelectorAll("#m-gamma .ft-ramp").length,
      clips: document.querySelectorAll("#m-gamma .ft-cbox .ft-gc").length,
      legend: document.querySelector("#m-gamma .ft-leg-row").innerText,
    }));
    const t = await modInfo(page, "m-gamma");
    ok(none.cells > 0, "a surface published before the colour scale existed still draws its grid");
    eq(none.ramp, 0, "and no shading key, because there is no ramp to label");
    eq(none.clips, 0, "and marks nothing off-scale against a cap it does not have");
    ok(!/Off scale/.test(none.legend), "nor names an off-scale mark in its key");
    ok(/before the colour scale existed, so shade carries no magnitude here/.test(t), "saying shade carries no magnitude here, so a flat grid is not read as uniform gamma");
    ok(!/capped at —|NaN|undefined/.test(t), "with no em-dashed or NaN cap sentence left behind");
  }

  {
    const bare = onSurface(panel);
    delete bare.panels.surface;
    await mount(page, bare);
    await pickView(page, "m-gamma", "Grid");
    const g = await page.evaluate(() => { const box = document.querySelector("#m-gamma .ft-cbox"); return { silent: !!box.querySelector(".ui-silent"), svg: !!box.querySelector("svg:not(.ui-g)") }; });
    eq(g.silent, true, "a card with no surface panel reports the grid unavailable");
    eq(g.svg, false, "and draws no chart at all rather than an empty grid");
  }
  eq(errors.length, 0, `the grid renders throw nothing (${errors.join("; ")})`);

  {
    const t0 = Date.parse("2026-08-24T13:30:00Z");
    const ticks = Array.from({ length: 390 }, (_, i) => ({ tape_time: new Date(t0 + i * 60000).toISOString(), net_delta: String(i > 260 ? 800 : 60),
      net_call_premium: String(i < 200 ? 4000 : 0), net_put_premium: String(i < 200 ? 0 : 5000) }));
    const pth = buildPath(ticks, { sessionDate: "2026-08-24" });
    ok(pth.status === "ok" && pth.persistence !== null, "the path fixture builds, signature and all");
    ok(pth.centroid > 0.55, "and its centroid is late enough that a hardcoded mid-session rule would miss");
    const card = clone(base);
    card.panels.path = pth;
    await mount(page, card);
    ok(await pickView(page, "m-flow", "Session"), "the Flow module offers the session path");
    const p = await page.evaluate(() => {
      const svg = document.querySelector("#m-flow .ft-cbox svg");
      const pd = svg.querySelector(".ft-pd"), pp = svg.querySelector(".ft-pp"), pc = svg.querySelector(".ft-pc"), pz = svg.querySelector(".ft-pz");
      const ys = (el) => (el.getAttribute("d").match(/-?[\d.]+/g) || []).map(Number).filter((_, i) => i % 2 === 1);
      const mid = Number(pz.getAttribute("y1"));
      const reach = (el) => Math.max(...ys(el).map((y) => Math.abs(y - mid)));
      const end = svg.querySelector(".ft-ppe");
      return { pdD: pd && pd.getAttribute("d"), ppD: pp && pp.getAttribute("d"), pdDash: pd && pd.getAttribute("stroke-dasharray"), ppDash: pp && pp.getAttribute("stroke-dasharray"),
        pdFill: pd && pd.getAttribute("fill"), ppFill: pp && pp.getAttribute("fill"), disc: svg.querySelectorAll(".ft-pde").length, square: svg.querySelectorAll(".ft-ppe").length,
        hollow: end ? end.getAttribute("fill") !== end.getAttribute("stroke") : false,
        reachD: pd ? reach(pd) : null, reachP: pp ? reach(pp) : null, cx: pc ? Number(pc.getAttribute("x1")) : null,
        vb: Number(svg.getAttribute("viewBox").split(/\s+/)[2]), aria: svg.getAttribute("aria-label") || "",
        legend: document.querySelector("#m-flow .ft-leg-row").innerText, swatches: document.querySelectorAll("#m-flow .ft-leg-row .ui-key > i.is-ln").length };
    });
    ok(p.ppD && p.ppD.length > 20, "the cumulative-premium leg is drawn at all");
    ok(p.pdD && p.pdD !== p.ppD, "and it is its OWN series — the two legs do not share a path");
    ok(p.ppDash && !p.pdDash, `the premium leg is dashed and the delta leg is not, so the two survive greyscale (delta ${p.pdDash}, premium ${p.ppDash})`);
    eq(p.disc, 1, "the delta leg ends in a filled disc");
    eq(p.square, 1, "and the premium leg in a square");
    ok(p.hollow, "a hollow one — a second non-colour channel");
    eq(p.pdFill, "none", "the delta leg sets fill:none as an attribute, not only in CSS");
    eq(p.ppFill, "none", "and so does the premium leg");
    ok(/Delta ±[\d.,]+[KMB]?/.test(p.legend), `the legend states the delta leg's scale (${p.legend.replace(/\n/g, " | ")})`);
    ok(/Premium ±\$[\d.,]+[KMB]?/.test(p.legend), "and the premium leg's scale in its own units");
    ok(p.swatches >= 2, "and draws the strokes themselves as swatches rather than naming colours");
    ok(p.reachD !== null && p.reachP !== null && Math.abs(p.reachD - p.reachP) <= 0.5, `each leg is scaled by its own extreme and both reach full deflection (delta ${p.reachD}, premium ${p.reachP})`);
    const wantX = 10 + pth.centroid * (p.vb - 20);
    ok(Math.abs(p.cx - wantX) <= 1, `the centroid rule is drawn at the minute it measures (${p.cx} against ${wantX.toFixed(1)} for a centroid of ${pth.centroid.toFixed(3)})`);
    ok(/premium/.test(p.aria), "the accessible label mentions both legs");
    const t = await modInfo(page, "m-flow");
    eq((/\nMinutes with the direction\n([^\n]*)\n/.exec(t) || [])[1], Math.round(pth.persistence * 100) + "%", "persistence is printed, not merely computed");
    eq((/\nBusiest 5% of minutes\n([^\n]*)\n/.exec(t) || [])[1], Math.round(pth.concentration * 100) + "%", "and so is concentration");
    eq((/\nWeighted mean minute\n([^\n]*)\n/.exec(t) || [])[1], Math.round(pth.centroid * 100) + "%", "and the weighted mean minute");
    ok(/uniform session would put there/.test(t), "the reading states concentration against its own 5% baseline rather than a chosen threshold");
    ok(/50% for a tape with no direction/.test(t), "and persistence against the coin-flip baseline");
    ok(/scaled to its own extreme/.test(t), "and says each leg is scaled to its own extreme, so the two heights are not compared");
  }

  {
    const t0 = Date.parse("2026-08-24T13:30:00Z");
    const flat = buildPath(Array.from({ length: 90 }, (_, i) => ({ tape_time: new Date(t0 + i * 60000).toISOString(), net_delta: "120", net_call_premium: "0", net_put_premium: "0" })), { sessionDate: "2026-08-24" });
    const card = clone(base);
    card.panels.path = flat;
    await mount(page, card);
    await pickView(page, "m-flow", "Session");
    const f = await page.evaluate(() => ({ pp: document.querySelectorAll("#m-flow .ft-pp").length, pd: document.querySelectorAll("#m-flow .ft-pd").length, legend: document.querySelector("#m-flow .ft-leg-row").innerText }));
    eq(f.pd, 1, "a session with no premium still draws its delta leg");
    eq(f.pp, 0, "and draws NO premium leg rather than a flat line at the axis");
    ok(/no net premium in either direction/.test(await modInfo(page, "m-flow")), "the disclosure says why the leg is absent instead of leaving a reader to read the axis");
    ok(!/Premium/.test(f.legend), "and the legend offers no key for a leg it did not draw — a scale stated for an absent series is the same false measurement as the flat line itself");
  }

  {
    const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-flows-v1-card.json"), "utf8"));
    eq(v1.v, 1, "the legacy fixture is still a v1 card");
    ok(!("persistence" in v1.panels.path), "which carries no path signature");
    ok(!v1.quality, "and no quality pair");
    await mount(page, v1);
    await pickView(page, "m-flow", "Session");
    const rules = await page.evaluate(() => document.querySelectorAll("#m-flow .ft-pc").length);
    const t = await modInfo(page, "m-flow");
    const fact = (k) => (new RegExp("\\n" + k + "\\n([^\\n]*)\\n").exec(t) || [])[1];
    eq(fact("Minutes with the direction"), "—", "a pre-signature card shows an em dash for persistence, not a zero");
    eq(fact("Busiest 5% of minutes"), "—", "nor a zero concentration");
    eq(fact("Weighted mean minute"), "—", "nor a confident midday centroid");
    eq(rules, 0, "and draws no centroid rule at a position it does not know");
    ok(/built before the path signature was published/.test(t), "and says so, rather than leaving three em dashes unexplained");
    ok(fact("Net premium") && !fact("Net premium").startsWith("—"), "while the premium total, which v1 did publish, still renders");
    const sig = await modInfo(page, "m-signal");
    ok(!/OTM share of directional flow/.test(sig), "a card with no quality pair shows no quality readings");
    const q = sig.slice(sig.indexOf("Quality"));
    ok(/built before the volatility and quality readings became gauges/.test(q), "and the disclosure explains the suppression reasons were not measured rather than printing zeros");
    ok(!/\b0%/.test(q.slice(0, q.indexOf("\n", q.indexOf("gauges")))), "with no zero anywhere in that explanation — zero is the BEST reading of both");
  }

  {
    const qOf = async (quality) => { const c = clone(base); c.quality = quality; await mount(page, c); return modInfo(page, "m-signal"); };
    const fact = (t, k) => (new RegExp("\\n" + k + "\\n([^\\n]*)\\n").exec(t) || [])[1];
    const live = await qOf({ otmShare: 0.71, vegaTilt: 1.34 });
    const clean = await qOf({ otmShare: 0.08, vegaTilt: 0.02 });
    const none = await qOf({ otmShare: null, vegaTilt: null });
    eq(fact(live, "OTM share of directional flow"), "71%", "the OTM share of directional flow is printed, not folded into the quality gauge");
    eq(fact(live, "Vega flow per unit delta"), "1.34", "and so is vega flow per unit of delta flow");
    eq(fact(clean, "OTM share of directional flow"), "8%", "a near-money book reads differently from a lottery-ticket one");
    ok(live !== clean, "so two names with the same quality gauge no longer say the same thing");
    ok(/lottery tickets/.test(live) && /trading VOLATILITY/.test(live), "each reading is named as the suppression reason it is");
    eq(fact(none, "OTM share of directional flow"), "—", "no directional flow to divide by is an em dash, never 0 — zero is the TOP of that column");
    eq(fact(none, "Vega flow per unit delta"), "—", "and likewise the vega tilt");
    ok(/no directional view/.test(none), "with the reason stated: a vanishing delta flow is no view, not infinite vol conviction");
  }

  {
    const ladder = [100, 110, 120, 130, 140, 145, 150, 155, 160, 162.5, 165, 167.5, 170, 172.5, 175, 180, 185, 190, 200, 210, 220, 240, 260, 270];
    const gaps = ladder.slice(1).map((k, i) => k - ladder[i]);
    ok(Math.max(...gaps) > 3 * Math.min(...gaps), `the fixture ladder is genuinely non-uniform (steps ${Math.min(...gaps)} to ${Math.max(...gaps)}), so a by-index and a by-price mapping CANNOT agree by construction`);
    const card = clone(base);
    card.panels.gamma = { ...card.panels.gamma, status: "ok", spot: 171, bars: ladder.map((k, i) => ({ k, g: (i % 2 ? 1 : -1) * (1000 + 37 * i) })) };
    card.panels.pricedMove = { ...card.panels.pricedMove, spot: 171 };
    card.panels.levels = { ...card.panels.levels, status: "ok", spot: 171, levels: [{ kind: "zero_gamma", label: "Zero-gamma level", px: 170 }, { kind: "call_wall", label: "Call wall", px: 190 }, { kind: "put_wall", label: "Put wall", px: 150 }] };
    card.regime = { ...(card.regime || {}), spotGammaShare: -0.93, flipSide: "short_below", bandMin: 100, bandMax: 270 };
    await page.setViewportSize({ width: 1280, height: 1000 });
    await mount(page, card);
    ok(await pickView(page, "m-gamma", "Today"), "the Gamma module draws today's ladder");
    const g = await page.evaluate(() => {
      const svg = document.querySelector("#m-gamma .ft-cbox svg");
      const n = (el, a) => Number(el.getAttribute(a));
      const mid = n(svg.querySelector("line.base"), "y1");
      const bars = [...svg.querySelectorAll("rect.grow")].map((b) => ({ cx: n(b, "x") + n(b, "width") / 2, top: n(b, "y"), bot: n(b, "y") + n(b, "height"), fill: b.getAttribute("fill") })).sort((a, b) => a.cx - b.cx);
      const rule = svg.querySelector('line[stroke-dasharray="2 3"]');
      return { mid, bars, rule: rule ? n(rule, "x1") : null };
    });
    ok(g.bars.length >= 3, `the panel drew ${g.bars.length} bars`);
    let fit = null;
    for (let j = 0; j + g.bars.length <= ladder.length && !fit; j++) {
      const ks = ladder.slice(j, j + g.bars.length);
      const b = (g.bars[g.bars.length - 1].cx - g.bars[0].cx) / (ks[ks.length - 1] - ks[0]);
      const a = g.bars[0].cx - b * ks[0];
      if (ks.every((k, i) => Math.abs(a + b * k - g.bars[i].cx) < 0.6)) fit = { a, b, ks };
    }
    ok(fit, "the bars sit at their strikes' prices on one linear axis — the drawn run of the ladder is recovered exactly from the bar centres");
    const cxs = g.bars.map((b) => b.cx), steps = cxs.slice(1).map((x, i) => x - cxs[i]);
    ok(Math.max(...steps) > 1.5 * Math.min(...steps), "and they are NOT evenly spaced, which a by-index mapping would draw");
    ok(fit && g.rule !== null && Math.abs(g.rule - (fit.a + fit.b * 170)) < 1.5,
       `the gamma-flip rule at a price that IS a listed strike lands on that strike's own bar (off by ${fit && g.rule !== null ? Math.abs(g.rule - (fit.a + fit.b * 170)).toFixed(1) : "?"}px). Under a mapping by index it sat 4.8 bar rows away, pointing at a different strike`);
    const fills = [...new Set(g.bars.map((b) => b.fill))];
    eq(fills.length, 2, "the two-sided ladder draws both signs");
    for (const f of fills) {
      const side = g.bars.filter((b) => b.fill === f).map((b) => (Math.abs(b.bot - g.mid) < 0.6 ? "up" : Math.abs(b.top - g.mid) < 0.6 ? "down" : "?"));
      ok(side.every((x) => x === side[0] && x !== "?"), `every bar of one sign sits on one side of the baseline (${f}: ${side[0]}), so sign survives without hue`);
    }
    const bar = g.bars[Math.floor(g.bars.length / 2)];
    await page.locator("#m-gamma .ft-cbox svg").scrollIntoViewIfNeeded();
    const box = await page.locator("#m-gamma .ft-cbox svg").boundingBox();
    await page.mouse.move(box.x + bar.cx, box.y + (bar.top + bar.bot) / 2);
    await page.waitForFunction(() => { const r = document.querySelector("#m-gamma .ui-readout.is-on"); return Boolean(r && r.textContent); },
      null, { timeout: 5000 }).catch(() => null);
    const readout = await page.evaluate(() => (document.querySelector("#m-gamma .ui-readout.is-on") || {}).textContent || "");
    ok(/Γ/.test(readout) && /Strike/.test(readout), `the bars carry no graduated magnitude axis to misread; the exact value is read by scrubbing (${readout})`);

    const lines = async (share) => { const c = clone(card); c.regime.spotGammaShare = share; await mount(page, c); const t = await modInfo(page, "m-gamma"); return t.slice(t.indexOf("\nToday\n"), t.indexOf("\nGrid\n")); };
    const deep = await lines(-0.93), shallow = await lines(-0.05), absent = await lines(null);
    ok(deep !== shallow, "a book 0.93 of peak short at spot and one 0.05 of peak short no longer render identically");
    ok(/Today's trading left dealers short gamma immediately below 170\.00/.test(deep), "the ladder's crossing is named as today's flow rather than the book, with its side");
    ok(/summed up to spot, is 0\.93 of this ladder's peak and short/.test(deep), "the at-spot magnitude is stated with its sign attached");
    ok(/0\.05 of this ladder's peak/.test(shallow), "for both readings");
    ok(/share of this ladder's peak rather than a dollar figure/.test(deep), "and what makes it comparable across names is said");
    ok(/Measured over strikes 100\.00 – 270\.00 only/.test(deep), "the band the ladder was measured over is stated");
    ok(!/0\.00 of|NaN|undefined/.test(absent), "a card whose spot lies outside the measured band manufactures no reading");
    ok(/not published on this card/.test(absent) && /edge rung/.test(absent), "and says why the reading is missing");
    const lead = (absent.split("\n").find((l) => /^Where spot sits/.test(l)) || "").split(":")[0];
    ok(lead && !/\d/.test(lead), `the absence carries no digit at all ("${lead}") — a reader who sees a number where a reason belongs has been told something the book never said`);
    await page.setViewportSize({ width: 320, height: 900 });
  }
  eq(errors.length, 0, `the fixture renders throw nothing (${errors.join("; ")})`);

  const sample = cards.filter((c) => c.depth !== "index").slice(0, 5);
  ok(sample.length >= 3, `the sweep has real emitted cards to paint (${sample.length})`);
  for (const [vw, vh, list] of [[320, 900, sample], [1280, 1000, sample.slice(0, 2)]]) {
    await page.setViewportSize({ width: vw, height: vh });
    for (const card of list) {
      const errs = [];
      const onErr = (e) => errs.push(String(e));
      page.on("pageerror", onErr);
      await mount(page, card);
      const swept = await walk(page, vw);
      page.off("pageerror", onErr);
      const who = card.ticker + "@" + vw;
      eq(errs.length, 0, `${who}: painting a real emitted card, every view of every module, throws nothing (${errs.join("; ")})`);
      ok(swept.length >= 20, `${who}: the sweep measured the views rather than skipping them (${swept.length})`);
      for (const p of swept) {
        const at = `${who} ${p.id}${p.label ? "/" + p.label : ""}`;
        ok(!p.empty, `${at}: renders either content or an explicit silence`);
        for (const par of p.par) ok(par !== "none", `${at}: no chart stretches — preserveAspectRatio="none" scales x and y apart, so the width stays right while the drawing inside is distorted`);
        if (p.minText !== null) ok(p.minText >= 8, `${at}: axis type renders at its intended size, not scaled down (${p.minText}px)`);
        ok(!p.clipped, `${at}: draws no text outside its own canvas (${p.clipped || ""})`);
        for (const w of p.widths) ok(w > 0 && w <= vw, `${at}: sizes its drawing to the viewport rather than past it (${w}px)`);
        for (const [vb, css] of p.scales) if (vb > 0 && css > 0) ok(Math.abs(vb - css) < 1, `${at}: one viewBox unit is one CSS pixel (viewBox ${vb} in ${css.toFixed(2)}px)`);
        eq(p.overflow, false, `${at}: overflows nothing at ${vw}px`);
      }
    }
  }
  await page.close();

  console.log(`✓ flows-card-render: ${checks} assertions — grid cells reconcile against the surface, sign survives without hue on the grid and on the ladder, ` +
    "the shading ramp spends its range on the cells and is drawn as a key the disclosure agrees with, not measured and measured at nothing are told apart, " +
    "the price rail is a ruler rather than a wall of digits, the flip lands on its own strike on a non-uniform ladder, both path legs are drawn on stated scales, " +
    "the path signature, the quality pair and the dealer-gamma share at spot reach the reader, and a pre-surface, pre-scale, pre-signature card degrades");
} finally {
  await browser.close();
  await rm(SCRATCH, { recursive: true, force: true });
}
