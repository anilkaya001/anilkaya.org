import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { openHome, openDock, FITS, PAGES } from "./lib/home-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSITION = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-approval/home-composition.json"), "utf8"));
const AREA_ID = COMPOSITION.areaIds;

let checks = 0;
const ONLY = process.env.ONESCREEN_ONLY ? new RegExp(process.env.ONESCREEN_ONLY) : null;
const SOFT = process.env.ONESCREEN_SOFT === "1";
let soft = 0;
const ok = (cond, msg) => {
  if (SOFT && !cond) { soft++; console.log("FAIL", msg); return; }
  assert.ok(cond, msg);
  checks++;
};
const eq = (a, b, msg) => {
  if (SOFT) {
    try { assert.deepEqual(a, b); } catch { soft++; console.log("FAIL", msg, "\n  ", JSON.stringify(a).slice(0, 1800)); return; }
  } else assert.deepEqual(a, b, msg);
  checks++;
};
const want = (name) => !ONLY || ONLY.test(name);
const VP = process.env.ONESCREEN_VP ? new Set(process.env.ONESCREEN_VP.split(",")) : null;
const wantVp = (w, h, extra) => !VP || VP.has(w + "x" + h + (extra && extra.dock ? "+dock" : ""));

const JS = "/assets/js/flows-overview.js";
const CSS = "/assets/css/flows-home.css";

const TABLE = [
  [1920, 1080, "xl"], [1920, 969, "xl"], [1920, 937, "xl"], [1920, 929, "xl"], [1920, 900, "xl"], [2560, 1440, "xl"],
  [1920, 1080, "l", { dock: true }],
  [1680, 1050, "l"], [1600, 900, "l"], [1440, 900, "l"], [1440, 820, "l"], [1366, 768, "l"],
  [1280, 800, "m"], [1024, 768, "m"], [1280, 720, "m"],
  [1440, 820, "s", { dock: true }],
  [768, 1024, "s"], [390, 844, "s"], [375, 667, "s"], [320, 568, "s"],
];

for (const [fit, list] of Object.entries(FITS)) {
  for (const [w, h] of list) ok(TABLE.some(([tw, th, tf, o]) => tw === w && th === h && tf === fit && !(o && o.dock)), `the fixture's ${fit} viewport ${w}x${h} is in the suite's table`);
}
eq(PAGES, ["now", "flow", "names", "glance"], "the pager has the four pages the plan names");

const GRID = {
  xl: { gap: 12, cols: [...Array(7).fill(1), ...Array(5).fill(1.05)], strip: [60, 0.085, 92], top: [412, 0.47], rows: ["lead", "strip", "fr", "strip", "strip"] },
  l: { gap: 10, cols: Array(12).fill(1), strip: [56, 0.09, 80], top: [250, 0.4], rows: ["lead", "strip", "fr", "fr", "strip", "strip"] },
  m: { gap: 8, cols: Array(12).fill(1), strip: [52, 0.09, 76], top: [232, 0.4], rows: ["lead", "strip", "fr", "fr", "strip"] },
};

const S_AREAS = {
  net: { hmHero: [1, 1, 9, 3], hmVerdict: [9, 1, 13, 3], hmNet: [1, 1, 8, 3], hmAlerts: [8, 1, 13, 3], hmBull: [1, 1, 7, 3], hmBear: [7, 1, 13, 3], hmLean: [1, 1, 4, 2], hmWatch: [1, 2, 4, 3], hmLeaders: [4, 1, 7, 2], hmMetals: [4, 2, 7, 3], hmChg: [7, 1, 10, 2], hmVol: [7, 2, 10, 3], hmEvents: [10, 1, 13, 2], hmNews: [10, 2, 13, 3] },
  noNet: { hmHero: [1, 1, 9, 3], hmVerdict: [9, 1, 13, 3], hmAlerts: [1, 1, 8, 3], hmLean: [8, 1, 13, 3], hmBull: [1, 1, 7, 3], hmBear: [7, 1, 13, 3], hmWatch: [1, 1, 4, 3], hmLeaders: [4, 1, 7, 2], hmMetals: [4, 2, 7, 3], hmChg: [7, 1, 10, 2], hmVol: [7, 2, 10, 3], hmEvents: [10, 1, 13, 2], hmNews: [10, 2, 13, 3] },
};

const clampN = (lo, v, hi) => Math.max(lo, Math.min(hi, v));

function tracks(total, gap, weights) {
  const free = total - gap * (weights.length - 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (free * w) / sum);
}

function expectedRects(fit, stage, net) {
  const g = GRID[fit];
  const H = stage.h;
  const strip = clampN(g.strip[0], H * g.strip[1], g.strip[2]);
  const top = Math.max(g.top[0], H * g.top[1]);
  const fixed = g.rows.map((r) => (r === "lead" ? top - strip - g.gap : r === "strip" ? strip : null));
  const frs = fixed.filter((x) => x === null).length;
  const used = fixed.reduce((a, b) => a + (b || 0), 0) + g.gap * (g.rows.length - 1);
  const heights = fixed.map((x) => (x === null ? (H - used) / frs : x));
  const widths = tracks(stage.w, g.gap, g.cols);
  const grid = (net ? COMPOSITION.layouts[fit].areas : COMPOSITION.layouts[fit].noNet).map((r) => r.trim().split(/\s+/));
  const out = {};
  const edge = (arr, i) => arr.slice(0, i).reduce((a, b) => a + b, 0) + g.gap * i;
  grid.forEach((row, y) => row.forEach((name, x) => {
    const b = out[name] || (out[name] = { x0: x, x1: x, y0: y, y1: y });
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }));
  const rects = {};
  for (const [name, b] of Object.entries(out)) {
    rects[AREA_ID[name]] = { x: stage.x + edge(widths, b.x0), y: stage.y + edge(heights, b.y0), w: edge(widths, b.x1 + 1) - edge(widths, b.x0) - g.gap, h: edge(heights, b.y1 + 1) - edge(heights, b.y0) - g.gap };
  }
  return { rects, strip, columns: widths, gap: g.gap, colEdges: widths.map((_, i) => stage.x + edge(widths, i)) };
}

function expectedS(stage, net) {
  const gap = 8;
  const colW = (stage.w - gap) / 2;
  const rowH = (stage.h - gap * 11) / 12;
  const rects = {};
  for (const [id, [r0, c0, r1, c1]] of Object.entries(net ? S_AREAS.net : S_AREAS.noNet)) {
    rects[id] = { x: stage.x + (c0 - 1) * (colW + gap), y: stage.y + (r0 - 1) * (rowH + gap), w: (c1 - c0) * colW + (c1 - c0 - 1) * gap, h: (r1 - r0) * rowH + (r1 - r0 - 1) * gap };
  }
  return rects;
}

const FACTS = () => {
  const d = document.documentElement;
  const stage = document.getElementById("hmStage");
  const sr = stage.getBoundingClientRect();
  const cs = getComputedStyle(stage);
  const tiles = [...stage.children].filter((e) => e.tagName === "SECTION");
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && !e.inert; };
  const name = (e) => e.id || String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(" ")[0] || e.tagName.toLowerCase();
  const clip = [];
  const skip = (e, m) => e.closest("dialog") || e.closest("[hidden]") || e.closest("details:not([open])") || e.closest(".visually-hidden") || e.closest(".fn-lede, .fn-legend, .fn-paths, .ui-roll, .hm-open, .nm-read") || (e.closest("svg") && e.tagName.toLowerCase() !== "svg") || !m.contains(e);
  for (const m of tiles) {
    if (!vis(m)) continue;
    const r = m.getBoundingClientRect();
    const bw = parseFloat(getComputedStyle(m).borderLeftWidth) || 0;
    for (const e of m.querySelectorAll("*")) {
      if (skip(e, m)) continue;
      const own = getComputedStyle(e);
      if (own.visibility === "hidden" || own.display === "none") continue;
      const q = e.getBoundingClientRect();
      if (!q.width || !q.height || (q.width <= 1 && q.height <= 1)) continue;
      if (!/^(svg|canvas|img|button|input|a)$/i.test(e.tagName) && ![...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
      let box = { top: r.top + bw, left: r.left + bw, right: r.right - bw, bottom: r.bottom - bw };
      for (let a = e.parentElement; a && a !== m.parentElement; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (a === m) break;
        if (a.matches(".fn-stage, .nm-stage, .fn-hits")) { const t = a.getBoundingClientRect(); box = { top: Math.max(box.top, t.top), left: Math.max(box.left, t.left), right: Math.min(box.right, t.right), bottom: Math.min(box.bottom, t.bottom) }; break; }
        if (o.overflowY !== "visible" || o.overflowX !== "visible") {
          if (o.webkitLineClamp !== "none" || o.textOverflow === "ellipsis") continue;
          const t = a.getBoundingClientRect();
          box = { top: Math.max(box.top, t.top), left: Math.max(box.left, t.left), right: Math.min(box.right, t.right), bottom: Math.min(box.bottom, t.bottom) };
        }
      }
      const cut = Math.max(q.bottom > box.bottom + 1.5 && q.top < box.bottom - 1.5 ? q.bottom - box.bottom : 0, q.right > box.right + 1.5 && q.left < box.right - 1.5 ? q.right - box.right : 0, q.top < box.top - 1.5 && q.bottom > box.top + 1.5 ? box.top - q.top : 0, q.left < box.left - 1.5 && q.right > box.left + 1.5 ? box.left - q.left : 0);
      if (cut) clip.push(m.id + ">" + e.tagName.toLowerCase() + "." + name(e) + ":" + Math.round(cut));
    }
  }
  const inner = [...document.querySelectorAll("#hm *, dialog.hm-sheet *")].filter((e) => !e.closest("dialog:not([open])") && !e.closest(".visually-hidden") && getComputedStyle(e).visibility !== "hidden" && e.clientHeight > 4 && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map((e) => e.id || e.className).slice(0, 4);
  const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const worst = (b) => {
    const bb = b.getBoundingClientRect().bottom;
    let w = null;
    for (const e of b.querySelectorAll("*")) { const q = e.getBoundingClientRect(); if (q.height && q.bottom > bb + 0.5 && (!w || q.bottom > w.q.bottom)) w = { e, q }; }
    return w ? String(w.e.className && w.e.className.baseVal !== undefined ? w.e.className.baseVal : w.e.className).split(" ")[0] + "@" + Math.round(w.q.bottom - bb) : "nothing";
  };
  const blank = tiles.filter((t) => vis(t)).filter((t) => { const h2 = t.querySelector("h2"); const q = h2 && h2.getBoundingClientRect(); return !q || !q.height; }).map((t) => t.id);
  const hidden = tiles.filter((t) => vis(t) && !t.classList.contains("is-glance")).map((t) => t.querySelector(":scope > .hm-body")).filter((b) => b && b.clientHeight > 0 && b.scrollHeight > b.clientHeight + 1).map((b) => b.id + ":" + (b.scrollHeight - b.clientHeight) + " by " + worst(b)).filter((x) => !x.endsWith(" by nothing"));
  return {
    hidden, blank,
    fit: stage.dataset.fit, cssFit: cs.getPropertyValue("--hm-fit").trim(), page: stage.dataset.page,
    sh: d.scrollHeight, ih: innerHeight, sw: d.scrollWidth, iw: innerWidth,
    inner, clip, h1: document.querySelectorAll("h1").length, h2: document.querySelectorAll("h2").length,
    stage: rect(stage), strip: parseFloat(cs.getPropertyValue("--strip")) || 0,
    tiles: tiles.map((t) => ({ id: t.id, rect: rect(t), visible: vis(t), inert: !!t.inert, visibility: getComputedStyle(t).visibility, overflow: getComputedStyle(t).overflow, page: t.dataset.page || "" })),
    chips: [...document.querySelectorAll("#ccVerdict .ui-gchip")].map(rect),
    pager: !document.getElementById("hmPager").hidden && getComputedStyle(document.getElementById("hmPager")).display !== "none",
  };
};

const CONTENT = () => {
  const shown = (e) => !e.hidden && !e.closest("[hidden]") && getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().height > 0;
  const count = (sel) => [...document.querySelectorAll(sel)].filter(shown).length;
  const big = [...document.querySelectorAll(".hm-big")].map((b) => {
    const v = b.querySelector(".hm-big-v"), c = b.querySelector(".hm-big-c");
    const tile = b.closest("section");
    return { id: tile ? tile.id : b.id, v: v ? v.textContent.trim() : null, c: c ? c.textContent.trim() : "", mark: !!b.querySelector(".hm-mark[data-info]"), markShown: [...b.querySelectorAll(".hm-mark[data-info]")].some(shown), shown: shown(b), glance: !!(tile && tile.classList.contains("is-glance")) };
  });
  const line = (sel) => { const t = [...document.querySelectorAll(sel)].filter(shown).map((e) => Math.round(e.getBoundingClientRect().top)); return { n: t.length, one: t.length > 0 && Math.max(...t) - Math.min(...t) <= 4 }; };
  const net = document.querySelector("#hmNetHost .fn-stage");
  return {
    cells: count("#ccLean .hm-cell"),
    flag: count("#ccAlerts .hm-arow"), bull: count("#ccBull .hm-lrow"), bear: count("#ccBear .hm-lrow"), lead: count("#ccLeaders .hm-qrow"),
    big, vol: line("#ccVol .ui-metric"), chg: line("#ccChgStats .ui-metric"), evt: line("#ccEvents .ui-row"), wtch: line("#ccWatch .ui-row"),
    stage3d: net ? net.clientHeight : 0, canvas: !!document.querySelector("#hmNetHost canvas"),
    small: [...document.querySelectorAll(".hm-all, .hm-sheet-x, .hm-pager button, .hm-ask, .hm-more, .hm-hero-open, .hm-open:not(.hm-hero-open)")].filter(shown).filter((b) => !(b.classList.contains("hm-open") && b.getBoundingClientRect().height > 100)).map((b) => ({ n: (b.className || b.tagName).split(" ")[0] + ":" + (b.textContent || "").trim().slice(0, 12), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, strip: !!b.closest("section") && b.closest("section").getBoundingClientRect().height < 80 })),
  };
};

const NUMERAL = /^([A-Z.]{1,5}\s)?[≥≤+\u2212-]?\$?[\d.,]+[%KMBT]?(\/\d+)?(\s?[a-z]{1,4})?$/;
const DASH = "—";

async function settle(page, { net, fit }) {
  await page.waitForTimeout(1400);
  if (net && fit !== "s") {
    const want = await page.evaluate(() => document.querySelector("#hmNet").classList.contains("is-glance") ? "glance" : "any");
    if (want !== "glance") await page.waitForFunction(() => document.querySelector("#hmNetHost canvas, #hmNetHost .nm"), null, { timeout: 20000 }).catch(() => {});
  }
  await page.waitForTimeout(900);
}

async function measure(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => 0))));
  let f = await page.evaluate(FACTS);
  for (let n = 0; n < 6 && (f.clip.length || f.inner.length || f.hidden.length); n++) { await page.waitForTimeout(300); f = await page.evaluate(FACTS); }
  return f;
}

function geometry(f, fit, net, label) {
  const bad = [];
  const want = net ? 14 : 13;
  if (f.fit !== fit || f.cssFit !== fit) bad.push(`${label}: the fit is ${f.fit}/${f.cssFit}, not ${fit}`);
  if (f.sh > f.ih + 1) bad.push(`${label}: the page scrolls (${f.sh} against ${f.ih})`);
  if (f.sw > f.iw) bad.push(`${label}: the page scrolls sideways`);
  if (f.inner.length) bad.push(`${label}: something scrolls inside itself: ${f.inner.join(", ")}`);
  if (f.clip.length) bad.push(`${label}: content is cut by its tile: ${f.clip.slice(0, 5).join(", ")}`);
  if (f.blank.length) bad.push(`${label}: a shown tile paints no title: ${f.blank.join(", ")}`);
  if (f.hidden.length) bad.push(`${label}: a body keeps content out of sight with no Show all to reach it: ${f.hidden.join(", ")}`);
  if (f.h1 !== 1) bad.push(`${label}: ${f.h1} h1`);
  if (f.h2 <= 5) bad.push(`${label}: only ${f.h2} h2`);
  const ids = f.tiles.map((t) => t.id);
  if (ids.length !== want) bad.push(`${label}: ${ids.length} tiles, not ${want}`);
  for (const t of f.tiles) if (t.overflow === "visible") bad.push(`${label}: ${t.id} lets its content overflow`);
  if (fit === "s") {
    const mine = f.tiles.filter((t) => t.page === f.page);
    const exp = expectedS(f.stage, net);
    if (f.pager !== true) bad.push(`${label}: the pager is not shown`);
    for (const t of f.tiles) {
      if (t.page !== f.page) {
        if (t.visibility !== "hidden" || !t.inert || !(t.rect.h > 0)) bad.push(`${label}: ${t.id} on another page is ${t.visibility}${t.inert ? "" : " and not inert"} at ${Math.round(t.rect.h)} px`);
      } else if (!t.visible) bad.push(`${label}: ${t.id} on page ${f.page} is not shown`);
      const e = exp[t.id];
      if (!e) bad.push(`${label}: no expected box for ${t.id}`);
      else if (t.page === f.page && (Math.abs(t.rect.x - e.x) > 1 || Math.abs(t.rect.y - e.y) > 1 || Math.abs(t.rect.w - e.w) > 1 || Math.abs(t.rect.h - e.h) > 1)) bad.push(`${label}: ${t.id} is ${JSON.stringify(t.rect, (k, v) => (typeof v === "number" ? Math.round(v) : v))}, the grid says ${JSON.stringify(e, (k, v) => (typeof v === "number" ? Math.round(v) : v))}`);
    }
    if (!mine.length) bad.push(`${label}: page ${f.page} holds no tile`);
    return bad;
  }
  if (f.pager) bad.push(`${label}: the pager is shown at ${fit}`);
  const exp = expectedRects(fit, f.stage, net);
  const vr = { x: 0, y: 0, w: f.iw, h: f.ih };
  for (const t of f.tiles) {
    if (!t.visible) { bad.push(`${label}: ${t.id} is not visible`); continue; }
    const e = exp.rects[t.id];
    if (!e) { bad.push(`${label}: no expected box for ${t.id}`); continue; }
    for (const k of ["x", "y", "w", "h"]) if (Math.abs(t.rect[k] - e[k]) > 1) { bad.push(`${label}: ${t.id} ${k} is ${t.rect[k].toFixed(1)}, the grid says ${e[k].toFixed(1)}`); break; }
    if (t.rect.x < f.stage.x - 1 || t.rect.y < f.stage.y - 1 || t.rect.x + t.rect.w > f.stage.x + f.stage.w + 1 || t.rect.y + t.rect.h > f.stage.y + f.stage.h + 1) bad.push(`${label}: ${t.id} leaves the stage`);
    if (t.rect.x + t.rect.w > vr.w + 1 || t.rect.y + t.rect.h > vr.h + 1) bad.push(`${label}: ${t.id} leaves the viewport`);
  }
  for (let i = 0; i < f.tiles.length; i++) for (let j = i + 1; j < f.tiles.length; j++) {
    const a = f.tiles[i].rect, b = f.tiles[j].rect;
    if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) bad.push(`${label}: ${f.tiles[i].id} and ${f.tiles[j].id} intersect`);
  }
  if (fit === "xl") {
    if (f.chips.length !== 5) bad.push(`${label}: ${f.chips.length} KPI cells, not 5`);
    f.chips.forEach((c, i) => {
      if (Math.abs(c.x - exp.colEdges[i]) > 0.5 || Math.abs(c.w - exp.columns[i]) > 0.5) bad.push(`${label}: KPI cell ${i + 1} is at ${c.x.toFixed(1)} wide ${c.w.toFixed(1)}, the columns say ${exp.colEdges[i].toFixed(1)} wide ${exp.columns[i].toFixed(1)}`);
      if (Math.abs(c.h - exp.strip) > 0.5) bad.push(`${label}: the KPI row is ${c.h.toFixed(1)} tall, the strip row is ${exp.strip.toFixed(1)}`);
    });
  }
  return bad;
}

function content(c, spec, label, { rich, net }) {
  const bad = [];
  const { w, h, fit, dock } = spec;
  const leanShown = fit !== "s" || (!net && spec.page === "flow");
  if (rich && leanShown && c.cells !== 11) bad.push(`${label}: Sectors shows ${c.cells} cells, not 11`);
  if (rich && fit !== "s") {
    const want = dock ? [2, 2, 2, 2] : w === 1920 && h === 1080 ? [5, 5, 5, 6] : w === 1920 && h === 969 ? [4, 4, 4, 5] : [2, 2, 2, 2];
    const got = [c.flag, c.bull, c.bear, c.lead];
    ["Flagged", "Bullish", "Bearish", "Leaders"].forEach((n, i) => { if (got[i] < want[i]) bad.push(`${label}: ${n} shows ${got[i]} rows, at least ${want[i]}`); });
  }
  if (rich && fit === "xl" && net && c.canvas && c.stage3d < 300) bad.push(`${label}: the 3D stage is ${c.stage3d} px tall, under 300`);
  if (rich && fit === "xl" && net && !c.canvas) bad.push(`${label}: the 3D scene did not mount at xl`);
  for (const b of c.big) {
    if (!b.shown && !(b.glance || fit === "s")) continue;
    if (b.c.split(/\s+/).filter(Boolean).length > 6) bad.push(`${label}: ${b.id} caption "${b.c}" is over six words`);
    if (b.v === DASH) { if (!b.mark) bad.push(`${label}: ${b.id} is a dash with no reason attached`); }
    else if (!NUMERAL.test(b.v || "")) bad.push(`${label}: ${b.id} numeral "${b.v}" is not a figure`);
  }
  if (rich && fit === "xl") {
    if (!c.vol.one || c.vol.n < 4) bad.push(`${label}: Volatility is not a one-line strip (${c.vol.n} metrics)`);
    if (!c.chg.one || c.chg.n < 3) bad.push(`${label}: What changed is not a one-line strip (${c.chg.n} metrics)`);
  }
  return bad;
}

function targets(c, coarse, label) {
  const bad = [];
  for (const s of c.small) {
    if (s.h < 24 && s.w < 24) bad.push(`${label}: ${s.n} is ${Math.round(s.w)}x${Math.round(s.h)}, under 24 px`);
    else if (s.h < 24) bad.push(`${label}: ${s.n} is ${Math.round(s.h)} px tall, under 24`);
    if (coarse && !s.strip && s.h < 43.5) bad.push(`${label}: ${s.n} is ${Math.round(s.h)} px tall on a coarse pointer`);
  }
  return bad;
}

const browser = await launch();

async function visit(spec, opts) {
  const [w, h, fit, extra] = spec;
  const coarse = Boolean(opts.coarse);
  const net = opts.net !== false;
  const label = `${w}x${h}${extra && extra.dock ? "+dock" : ""}${net ? "" : " no-net"}${coarse ? " coarse" : ""}${opts.rich ? "" : " pending"}`;
  const { context, page, errors } = await openHome(browser, { viewport: { width: w, height: h }, rich: Boolean(opts.rich), net, coarse, reduced: Boolean(opts.reduced), dock: Boolean(extra && extra.dock), alerts: opts.alerts || null, overrides: opts.overrides || {} });
  await settle(page, { net, fit });
  const bad = [];
  let f, c;
  for (const pg of fit === "s" ? PAGES : [null]) {
    if (pg && pg !== "now") {
      await page.click(`#hmPager button[data-page="${pg}"]`);
      await page.waitForTimeout(pg === "glance" ? 2400 : 1600);
    }
    f = await measure(page);
    const at = pg ? `${label} ${pg}` : label;
    bad.push(...geometry(f, fit, net, at));
    c = await page.evaluate(CONTENT);
    bad.push(...content(c, { w, h, fit, dock: Boolean(extra && extra.dock), page: pg }, at, { rich: Boolean(opts.rich), net }));
    bad.push(...targets(c, coarse, at));
  }
  if (errors.length) bad.push(`${label}: page error ${errors[0]}`);
  return { bad, page, context, label, f, c };
}

const PENDING = { "board?side=long": { status: "pending", rows: [] }, "board?side=short": { status: "pending", rows: [] }, "board?side=watch": { status: "pending", rows: [] }, events: { status: "pending", rows: [] }, news: { status: "pending", rows: [] }, pulse: { status: "pending" }, market: { status: "pending" }, "sector-premium": { status: "pending" }, scoretrack: { status: "pending" }, flowalerts: { status: "pending", rows: [] } };

const POOL = Number(process.env.ONESCREEN_POOL || 3);
async function pool(list, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      try { out[i] = await fn(list[i], i); } catch (error) { out[i] = [[String(error && error.message).split("\n")[0], "no error", "a check threw"]]; }
    }
  }));
  return out;
}

async function pagerChecks(coarse) {
  const log = [];
  const { page, context, errors } = await openHome(browser, { viewport: { width: 390, height: 844 }, coarse, rich: true, onRoute: async (route, u) => { if (u.pathname === "/assets/js/flows-overview-below.js") log.push(Date.now()); return false; } });
  await page.waitForTimeout(2500);
  const bad = [];
  const b = await page.evaluate(() => [...document.querySelectorAll("#hmPager button")].map((x) => ({ p: x.dataset.page, h: x.getBoundingClientRect().height, cur: x.getAttribute("aria-current") })));
  if (b.map((x) => x.p).join() !== PAGES.join()) bad.push("the pager buttons are " + b.map((x) => x.p));
  if (coarse && b.some((x) => x.h < 43.5)) bad.push("a pager button is under 44 px: " + b.map((x) => x.h));
  if (log.length) bad.push("the lower chunk was requested before the Glance page opened");
  const cur = () => page.evaluate(() => ({ page: document.getElementById("hmStage").dataset.page, hash: location.hash, focus: document.activeElement.dataset.page || "", status: document.getElementById("flowsStatus").textContent }));
  await page.focus('#hmPager button[data-page="now"]');
  await page.keyboard.press("ArrowRight");
  let s = await cur();
  if (s.page !== "flow" || s.focus !== "flow" || s.hash !== "#page=flow") bad.push("ArrowRight did not move to Flow: " + JSON.stringify(s));
  if (!/Page 2 of 4: Flow/.test(s.status)) bad.push("the change is not announced: " + s.status);
  await page.keyboard.press("End");
  s = await cur();
  if (s.page !== "glance") bad.push("End did not reach Glance");
  await page.waitForTimeout(500);
  if (!log.length) bad.push("the Glance page did not ask for the lower chunk");
  await page.keyboard.press("ArrowRight");
  s = await cur();
  if (s.page !== "now") bad.push("the pager does not wrap forward");
  await page.keyboard.press("ArrowLeft");
  s = await cur();
  if (s.page !== "glance") bad.push("the pager does not wrap back");
  await page.keyboard.press("Home");
  s = await cur();
  if (s.page !== "now") bad.push("Home did not reach Now");
  const rov = await page.evaluate(() => [...document.querySelectorAll("#hmPager button")].filter((x) => x.tabIndex === 0).length);
  if (rov !== 1) bad.push(rov + " pager buttons are in the tab order");
  const swipe = async (dx) => {
    await page.evaluate((d) => {
      const t = document.getElementById("hmHero");
      const mk = (type, x) => new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 300, bubbles: true, pointerType: "touch" });
      t.dispatchEvent(mk("pointerdown", 200));
      t.dispatchEvent(mk("pointerup", 200 + d));
    }, dx);
    return (await cur()).page;
  };
  if ((await swipe(-120)) !== "flow") bad.push("a swipe left did not turn to Flow");
  if ((await swipe(-120)) !== "names") bad.push("a second swipe left did not turn to Names");
  if ((await swipe(120)) !== "flow") bad.push("a swipe right did not turn back");
  if ((await swipe(-20)) !== "flow") bad.push("a short drag turned the page");
  await page.click('#hmPager button[data-page="names"]');
  s = await cur();
  if (s.page !== "names" || s.hash !== "#page=names") bad.push("clicking Names did not write #page=names: " + JSON.stringify(s));
  const inert = await page.evaluate(() => [...document.querySelectorAll("#hmStage > section")].filter((t) => t.dataset.page !== "names").every((t) => t.inert && getComputedStyle(t).visibility === "hidden" && t.getBoundingClientRect().height > 0));
  if (!inert) bad.push("a tile on another page is visible, interactive or has no height");
  if (errors.length) bad.push("page error " + errors[0]);
  await context.close();
  return bad;
}
async function sheetChecks(spec, opener, name, { net = true, patch = null } = {}) {
  const [w, h] = spec;
  const { page, context, errors } = await openHome(browser, { viewport: { width: w, height: h }, rich: true, net, coarse: w < 500, patch });
  await page.waitForTimeout(2800);
  const bad = [];
  const tile = await page.evaluate((sel) => {
    const b = [...document.querySelectorAll(sel)].find((x) => { const r = x.getBoundingClientRect(); return !x.hidden && r.width > 0 && r.height > 0 && !x.closest("[inert]") && getComputedStyle(x).visibility !== "hidden"; });
    if (!b) return null;
    const m = b.closest("#hmStage > section");
    b.dataset.pick = "1";
    window.__keep = m;
    const r = m.getBoundingClientRect();
    return { id: m.id, area: getComputedStyle(m).gridArea, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, index: [...m.parentElement.children].indexOf(m), hiddenRows: [...m.querySelectorAll(".hm-arow, .hm-lrow, .hm-qrow, .ui-row")].filter((x) => x.hidden).length, rows: [...m.querySelectorAll(".hm-arow, .hm-lrow, .hm-qrow, .ui-row")].length };
  }, opener);
  if (!tile) { await context.close(); return [`${name}: no visible ${opener}`]; }
  await page.click("[data-pick]");
  await page.waitForSelector("dialog.hm-sheet[open]", { timeout: 5000 });
  await page.waitForTimeout(500);
  const open = await page.evaluate((id) => {
    const dlg = document.querySelector("dialog.hm-sheet");
    const m = document.getElementById(id);
    const ph = document.querySelector("#hmStage > .hm-ph");
    const cs = getComputedStyle(dlg);
    const r = dlg.getBoundingClientRect();
    return {
      same: m === window.__keep && dlg.contains(m), ph: !!ph, phArea: ph ? ph.style.gridArea : null, phRect: ph ? (() => { const q = ph.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; })() : null,
      radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundImage, shadow: cs.boxShadow, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight,
      hiddenRows: [...m.querySelectorAll(".hm-arow, .hm-lrow, .hm-qrow, .ui-row")].filter((x) => x.hidden).length, rows: [...m.querySelectorAll(".hm-arow, .hm-lrow, .hm-qrow, .ui-row")].length,
      labelled: dlg.getAttribute("aria-labelledby"), sh: document.documentElement.scrollHeight,
    };
  }, tile.id);
  if (!open.same) bad.push(`${name}: the sheet does not hold the same ${tile.id} element`);
  if (!open.ph) bad.push(`${name}: no placeholder keeps the grid area`);
  else {
    if (open.phArea !== tile.area) bad.push(`${name}: the placeholder area is "${open.phArea}", not "${tile.area}"`);
    for (const k of ["x", "y", "w", "h"]) if (Math.abs(open.phRect[k] - tile.rect[k]) > 1) { bad.push(`${name}: the placeholder ${k} is ${open.phRect[k]}, the tile was ${tile.rect[k]}`); break; }
  }
  if (open.radius < 12) bad.push(`${name}: the sheet has no rounded glass (radius ${open.radius})`);
  if (open.bg === "none") bad.push(`${name}: the sheet has no material`);
  if (open.shadow === "none") bad.push(`${name}: the sheet has no edge`);
  if (open.w > open.iw + 1 || open.h > open.ih + 1) bad.push(`${name}: the sheet is larger than the screen`);
  if (open.sh > open.ih + 1) bad.push(`${name}: opening the sheet scrolls the page`);
  if (open.hiddenRows) bad.push(`${name}: the sheet keeps ${open.hiddenRows} rows hidden`);
  if (open.rows < tile.rows) bad.push(`${name}: the sheet holds ${open.rows} rows of ${tile.rows}`);
  if (!open.labelled) bad.push(`${name}: the sheet has no name`);
  for (let k = 0; k < 4 && (await page.evaluate(() => document.querySelectorAll("dialog[open]").length)); k++) {
    await page.focus("dialog.hm-sheet .hm-sheet-x").catch(() => {});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
  }
  const back = await page.evaluate((id) => {
    const m = document.getElementById(id);
    return { same: m === window.__keep, parent: m.parentElement.id, index: [...m.parentElement.children].indexOf(m), ph: document.querySelectorAll(".hm-ph").length, open: document.querySelectorAll("dialog[open]").length };
  }, tile.id);
  if (!back.same || back.parent !== "hmStage") bad.push(`${name}: Escape did not return the element to the stage`);
  if (back.index !== tile.index) bad.push(`${name}: the element came back at ${back.index}, not ${tile.index}`);
  if (back.ph || back.open) bad.push(`${name}: a placeholder or dialog is left behind`);
  if (errors.length) bad.push(`${name}: page error ${errors[0]}`);
  await context.close();
  return bad;
}
async function provokeNofit(page) {
  await page.evaluate(() => {
    const heat = document.querySelector("#ccLean .hm-heat");
    heat.style.height = "900px";
    const mark = document.createElement("i");
    mark.hidden = true;
    heat.parentElement.append(mark);
  });
  await page.waitForTimeout(700);
  return page.evaluate(() => [...document.querySelectorAll("#ccLean .hm-cell")].filter((c) => !c.hidden && !c.hasAttribute("data-fit")).length);
}

async function planted(name, edits, specs, extra = {}) {
  const bad = [];
  if (extra.sheet) {
    const patch = {};
    for (const [file, from, to] of edits) (patch[file] = patch[file] || []).push([from, to]);
    return sheetChecks(specs[0], extra.sheet, name, { patch });
  }
  for (const spec of specs) {
    const [w, h, fit, o] = spec;
    const patch = {};
    for (const [file, from, to] of edits) (patch[file] = patch[file] || []).push([from, to]);
    let chunkSeen = false;
    const onRoute = async (route, u) => { if (u.pathname === "/assets/js/flows-overview-below.js") chunkSeen = true; return false; };
    const { context, page, errors } = await openHome(browser, { viewport: { width: w, height: h }, rich: !extra.pending, coarse: w < 500, dock: Boolean(o && o.dock), patch, overrides: extra.pending ? PENDING : {}, onRoute });
    try {
      await settle(page, { net: true, fit });
      const f = await measure(page);
      bad.push(...geometry(f, fit, true, `${w}x${h}`));
      const c = await page.evaluate(CONTENT);
      bad.push(...content(c, { w, h, fit, dock: Boolean(o && o.dock) }, `${w}x${h}`, { rich: !extra.pending, net: true }));
      if (extra.pending) {
        const zero = await page.evaluate(() => [...document.querySelectorAll(".hm-big-v")].filter((e) => e.textContent.trim() === "0").map((e) => e.closest("section").id));
        if (zero.length) bad.push("an unpublished feed is painted 0 in " + zero.join(", "));
      }
      if (extra.s) {
        await page.waitForTimeout(2500);
        if (chunkSeen) bad.push("the lower chunk was requested at s before Glance opened");
      }
      if (extra.nofit) {
        const shown = await provokeNofit(page);
        if (shown !== 11) bad.push(`the fitter trimmed the heat map to ${shown} cells`);
      }
      if (errors.length) bad.push("page error " + errors[0]);
    } catch (error) {
      bad.push("threw: " + error.message.split("\n")[0]);
    }
    await context.close();
  }
  return bad;
}


const MUTANTS = [
  ["the .hm is no size container, so the dock cannot re-flow it", [[CSS, "container: hm / size; --hm-head: 44px;", "--hm-head: 44px;"]], [[1920, 1080, "l", { dock: true }], [1440, 820, "l"]]],
  ["a viewport media query stands in for the container query", [[CSS, "@container hm (", "@media ("], [CSS, "@container hm not (", "@media not all and ("]], [[1920, 1080, "l", { dock: true }], [1440, 820, "s", { dock: true }]]],
  ["a tile lets its content overflow", [[CSS, ".hm-stage > * { min-width: 0; min-height: 0; overflow: hidden; }", ".hm-stage > * { min-width: 0; min-height: 0; overflow: visible; }"]], [[1440, 820, "l"]]],
  ["the fitter trims the heat map", [[JS, ", [data-nofit]\"))", "\"))"]], [[1440, 820, "l"]], { nofit: true }],
  ["the sheet holds a clone", [[JS, "sheet.replaceChildren(close, mod);", "sheet.replaceChildren(close, mod.cloneNode(true));"]], [[1440, 820, "l"]], { sheet: "#hmAlerts .hm-all, #hmBull .hm-all, #hmLeaders .hm-all" }],
  ["the pages of the pager are display none", [[CSS, ".hm-stage > [data-page] { visibility: hidden; }", ".hm-stage > [data-page] { display: none; }"]], [[390, 844, "s"]]],
  ["the KPI row is taller than the strip row", [[CSS, "grid-template-rows: minmax(0, 1fr) var(--strip);", "grid-template-rows: minmax(0, 1fr) calc(var(--strip) + 6px);"]], [[1920, 1080, "xl"]]],
  ["an absent numeral is painted 0", [[JS, "v.textContent = none ? DASH : value;", "v.textContent = none ? \"0\" : value;"]], [[1440, 820, "l"]], { pending: true }],
  ["the XL columns are all 1fr, so the network host falls short", [[CSS, "repeat(7, minmax(0, 1fr)) repeat(5, minmax(0, 1.05fr))", "repeat(12, minmax(0, 1fr))"]], [[1920, 1080, "xl"]]],
  ["the --top floor is gone", [[CSS, "--top: max(412px, calc(var(--hm-h) * 0.47));", "--top: calc(var(--hm-h) * 0.47);"]], [[1920, 929, "xl"]]],
  ["the fitter keeps three rows at least", [[JS, "const FIT_MIN = 2;", "const FIT_MIN = 3;"]], [[1440, 820, "l"]]],
  ["the lower chunk is asked for at s before Glance", [[JS, "else { for (const m of stage.children) m.inert = false; askLower(); }", "else { for (const m of stage.children) m.inert = false; }\n    askLower();"]], [[390, 844, "s"]], { s: true }],
  ["the L block never sets --hm-fit", [[CSS, "--hm-fit: l; --gap: 10px;", "--gap: 10px;"]], [[1440, 820, "l"]]],
];

const jobs = [];
if (want("table")) for (const spec of TABLE) {
  if (!wantVp(spec[0], spec[1], spec[3])) continue;
  jobs.push(async () => {
    const r = await visit(spec, { rich: true, coarse: spec[0] < 500 });
    await r.context.close();
    return [[r.bad, [], `${r.label}: THE HOME IS ONE SCREEN AT ${spec[2].toUpperCase()}: every tile in its grid area, nothing clipped, no page scroll, no inner scroll`]];
  });
}
if (want("nonet")) for (const spec of [[1920, 1080, "xl"], [1440, 820, "l"], [1024, 768, "m"], [390, 844, "s"]]) {
  jobs.push(async () => {
    const r = await visit(spec, { rich: true, net: false, coarse: spec[0] < 500 });
    await r.context.close();
    return [[r.bad, [], `${r.label}: WITH THE NETWORK SWITCH OFF THE OTHER THIRTEEN TILES STILL FILL ONE SCREEN`]];
  });
}
if (want("coarse")) for (const spec of [[1024, 768, "m"], [768, 1024, "s"], [320, 568, "s"]]) {
  jobs.push(async () => {
    const r = await visit(spec, { rich: true, coarse: true });
    await r.context.close();
    return [[r.bad, [], `${r.label}: AND ON A COARSE POINTER THE CONTROLS ARE 44 PX`]];
  });
}
if (want("pending")) {
  for (const spec of [[1920, 1080, "xl"], [1440, 820, "l"], [1024, 768, "m"], [390, 844, "s"]]) {
    jobs.push(async () => {
      const r = await visit(spec, { rich: false, overrides: PENDING });
      const zero = await r.page.evaluate(() => [...document.querySelectorAll(".hm-big-v")].filter((e) => e.textContent.trim() === "0").map((e) => e.closest("section").id));
      await r.context.close();
      return [[r.bad, [], `${r.label}: WITH THE FEEDS PENDING THE HOME STILL FITS AND SAYS SO`], [zero, [], `${r.label}: and no numeral is a 0 for a figure that was never published`]];
    });
  }
  jobs.push(async () => {
    const { page, context, errors } = await openHome(browser, { viewport: { width: 390, height: 844 }, coarse: true, overrides: PENDING });
    await page.waitForTimeout(2000);
    await page.click('#hmPager button[data-page="glance"]');
    await page.waitForTimeout(1200);
    const states = await page.evaluate(() => [...document.querySelectorAll('#hmStage > [data-page="glance"].is-glance')].map((m) => ({ id: m.id, mark: !!m.querySelector(".hm-mark[data-info], .hm-hush [data-info], .ui-state") })));
    await context.close();
    return [[states.length >= 6, true, `THE GLANCE PAGE HOLDS ITS TILES AS GLANCE FACES (${states.length})`], [states.filter((x) => !x.mark).map((x) => x.id), [], "and a pending glance tile shows its state chip, never a bare dash"], [errors, [], "no page error"]];
  });
}
if (want("reduced")) {
  jobs.push(async () => {
    const { page, context } = await openHome(browser, { viewport: { width: 1440, height: 820 }, rich: true, reduced: true });
    await page.waitForTimeout(3000);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#hmStage") && (a.transitionProperty || a.animationName !== undefined)).map((a) => (a.effect.target.id || a.effect.target.className) + ":" + (a.animationName || a.transitionProperty)));
    await context.close();
    return [[running, [], "UNDER REDUCED MOTION NOTHING IN THE STAGE ANIMATES OR TRANSITIONS"]];
  });
}
if (want("pager")) jobs.push(async () => [[await pagerChecks(true), [], "THE S PAGER: FOUR 44 PX BUTTONS, ARROWS WRAP, HOME AND END, A SWIPE TURNS THE PAGE, #page= IS WRITTEN, INACTIVE TILES ARE INERT AND LAID OUT HIDDEN, AND ONLY GLANCE ASKS FOR THE LOWER CHUNK"]]);
if (want("hash")) {
  for (const [hash, expect] of [["#page=names", "names"], ["#page=glance", "glance"], ["#page=nonsense", "now"], ["#view=session", "now"], ["#view=flow", "flow"], ["#view=names", "names"], ["#view=focus", "glance"], ["#view=moves", "glance"], ["#view=calendar", "glance"], ["#view=nonsense", "now"]]) {
    jobs.push(async () => {
      const { page, context } = await openHome(browser, { viewport: { width: 390, height: 844 }, coarse: true, hash });
      await page.waitForTimeout(1200);
      const at = await page.evaluate(() => document.getElementById("hmStage").dataset.page);
      const cur = await page.evaluate(() => [...document.querySelectorAll("#hmPager [aria-current=true]")].map((b) => b.dataset.page));
      await context.close();
      return [[at, expect, `AN ADDRESS WITH ${hash} OPENS THE ${expect.toUpperCase()} PAGE AT S`], [cur, [expect], `and the pager marks it (${hash})`]];
    });
  }
  jobs.push(async () => {
    const { page, context } = await openHome(browser, { viewport: { width: 390, height: 844 }, coarse: true, hash: "#page=flow" });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { location.hash = "#page=names"; });
    await page.waitForTimeout(300);
    const at = await page.evaluate(() => document.getElementById("hmStage").dataset.page);
    await context.close();
    return [[at, "names", "following another address changes the page"]];
  });
  for (const [w, h] of [[1440, 820], [1920, 1080]]) {
    jobs.push(async () => {
      const { page, context } = await openHome(browser, { viewport: { width: w, height: h }, rich: true, hash: "#view=calendar" });
      await page.waitForTimeout(2000);
      const got = await page.evaluate(() => [document.getElementById("hmStage").dataset.fit, document.querySelectorAll("#hmPager:not([hidden])").length, document.querySelectorAll("#hmStage > section[inert]").length]);
      await context.close();
      return [[got, [w === 1920 ? "xl" : "l", 0, 0], `A LEGACY #view= ADDRESS AT ${w} PAGES NOTHING: every tile stays on the one screen`]];
    });
  }
}
if (want("sheet")) {
  const ALL = "#hmAlerts .hm-all, #hmBull .hm-all, #hmBear .hm-all, #hmLeaders .hm-all";
  jobs.push(async () => [[await sheetChecks([1440, 820], ALL, "Show all at 1440"), [], "SHOW ALL MOVES THE SAME ELEMENT INTO THE SHEET, THE PLACEHOLDER KEEPS ITS AREA, THE FITTER UNHIDES THE ROWS, AND ESCAPE RETURNS THE ELEMENT"]]);
  jobs.push(async () => [[await sheetChecks([1024, 768], "#hmNet .hm-open", "Open at 1024"), [], "OPEN MOVES THE SAME GLANCE TILE INTO THE SHEET AND ESCAPE RETURNS IT"]]);
  jobs.push(async () => [[await sheetChecks([1440, 820], "#hmNeuronMore", "More at 1440"), [], "MORE MOVES THE SAME NEURON TILE INTO THE SHEET AND ESCAPE RETURNS IT"]]);
  jobs.push(async () => [[await sheetChecks([1440, 820], ALL, "Show all without the network", { net: false }), [], "THE SHEET IS STYLED AND WORKS WITH THE NETWORK SWITCH OFF"]]);
  jobs.push(async () => [[await sheetChecks([390, 844], '#hmStage[data-page="now"] #hmVerdict .hm-more', "More at 390"), [], "AND AT S THE SHEET SLIDES UP AS THE SAME ELEMENT"]]);
}
if (want("nofit")) {
  jobs.push(async () => {
    const { page, context } = await openHome(browser, { viewport: { width: 1440, height: 820 }, rich: true });
    await page.waitForTimeout(2500);
    const shown = await provokeNofit(page);
    await context.close();
    return [[shown, 11, "THE SECTORS HEAT MAP IS NEVER TRIMMED: with its body forced to overflow the fitter still leaves all 11 cells"]];
  });
}

for (const triples of await pool(jobs, (j) => j())) for (const [a, b, m] of triples) eq(a, b, m);

if (want("dock")) {
  const { page, context, errors } = await openHome(browser, { viewport: { width: 1920, height: 1080 }, rich: true });
  await page.waitForTimeout(3500);
  eq(await page.evaluate(() => document.getElementById("hmStage").dataset.fit), "xl", "before the dock the Home is at xl");
  await openDock(page);
  const t0 = Date.now();
  await page.waitForFunction(() => document.getElementById("hmStage").dataset.fit === "l", null, { timeout: 5000 });
  const took = Date.now() - t0;
  ok(took <= 400, `OPENING THE ASK DOCK AT 1920 RE-FLOWS THE HOME TO L WITHIN 400 MS OF THE TRANSITION (${took} ms)`);
  await page.waitForTimeout(1500);
  const g = await page.evaluate(FACTS);
  eq(geometry(g, "l", true, "dock"), [], "and the L grid is exact under the dock");
  eq(errors, [], "no page error across the dock");
  await context.close();
}

if (want("mutants")) {
  const picked = MUTANTS.filter(([name]) => !ONLY || ONLY.test("mutants " + name));
  const results = await pool(picked, async ([name, edits, specs, extra]) => [[(await planted(name, edits, specs, extra || {})).length > 0, true, `PLANTED WRONG BUILD IS CAUGHT BY THE BENTO SWEEP: ${name}`]]);
  for (const triples of results) for (const [a, b, m] of triples) eq(a, b, m);
}

await browser.close();
if (soft) console.log(`flows-home-onescreen: ${soft} soft failures`);
console.log(`flows-home-onescreen: ${checks} checks, ${TABLE.length} viewports, the pager, the sheet, the dock and ${MUTANTS.length} planted wrong builds`);
