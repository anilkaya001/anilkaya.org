import fs from "node:fs";
import path from "node:path";
import * as PAGES from "../../shared/flows-pages.js";
import { nightlyEmit, emitRead } from "./nightly-emit.mjs";
import { openHome } from "./home-fixtures.mjs";
import { openMarket, ROOT } from "./market-fixtures.mjs";
import { mount as mountLedger } from "./sfc-render-world.mjs";

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
export const ORIGIN = "https://example.test";
export const NOW = Date.parse("2026-08-24T22:25:00.000Z");
export const PAGE_KINDS = ["home", "long", "market", "ticker", "ledger"];
export const VIEWPORTS = [{ width: 1920, height: 1080 }, { width: 1440, height: 820 }, { width: 390, height: 844 }];
export const MODES = ["default", "reduced-transparency", "contrast-more", "no-backdrop", "forced"];

const READ = {
  version: 1, status: "fallback", ticker: "NVDA", generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, tokens: null,
  provenance: "Deterministic reading: assembled from templates over the dossier's facts.", note: null, why: "cooldown",
  fingerprint: "d1.abc", asOf: new Date(NOW).toISOString(), session: "2026-08-24", generatedAt: null, coverage: { ok: 8, partial: 2, withheld: 2, pending: 0 },
  tags: [{ code: "dealer-pinned", label: "Dealers pinning", sentence: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", evidence: ["options.state"] }],
  sections: {
    identity: { text: "NVIDIA designs graphics processors and data-centre accelerators.", cites: [{ id: "identity.description", label: "Company description", display: "profile", asOf: new Date(NOW).toISOString(), kind: "identity", grade: 2 }] },
    now: { text: "The last price is $127.40, +1.27% from the previous close.", cites: [{ id: "price.last", label: "Last price", display: "$127.40", asOf: new Date(NOW).toISOString(), kind: "price", grade: 3 }] },
    drivers: [{ text: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", cites: [{ id: "options.state", label: "Implied dealer state", display: "pinned", asOf: new Date(NOW).toISOString(), kind: "options", grade: 2 }] }],
    tensions: [], watch: [], unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about revenue.", missing: ["fundamentals"] }],
  },
  refused: [],
};

let emitDir = null;
const emitted = (key) => { if (!emitDir) emitDir = nightlyEmit(); return emitRead(emitDir, key); };

function answer(route, u) {
  const q = u.searchParams;
  switch (route) {
    case "board": return emitted("board:" + (q.get("side") || "long"));
    case "card": return emitted("card:" + q.get("t")) || { status: "pending" };
    case "card-x": return emitted("card-x:" + q.get("t")) || { status: "pending" };
    case "hist": return emitted("hist:" + q.get("t")) || { status: "pending" };
    case "summary": return { status: "ok", scope: q.get("t") || "", summary: null, ideas: [], tier: "family", code: null, why: "x", read: READ };
    case "lk": case "now": return { serverNow: NOW, keys: {} };
    case "universe": return emitted("universe") || { status: "pending" };
    default: return emitted(route) || { status: "pending" };
  }
}

async function openEmit(browser, { kind, viewport, patch, reduced }) {
  if (!emitDir) emitDir = nightlyEmit();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const html = kind === "long" ? PAGES.FLOWS_PAGES.sidePage({ username: "test", side: "long" }) : PAGES.FLOWS_PAGES.tickerPage({ username: "test" });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/flows/")) {
      const body = answer(u.pathname.slice("/api/flows/".length), u) || { status: "pending" };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.clock.install({ time: NOW });
  await page.goto(ORIGIN + (kind === "long" ? "/flows/long/" : "/flows/ticker/?t=NVDA"));
  return { context, page, errors };
}

export async function openGlass(browser, { kind, viewport = VIEWPORTS[1], patch = null, reduced = false } = {}) {
  if (!PAGE_KINDS.includes(kind)) throw new Error("glass-world: unknown page " + kind);
  if (kind === "home") return openHome(browser, { viewport, patch, reduced });
  if (kind === "market") return openMarket(browser, { rich: true, viewport, patch, reduced });
  if (kind === "ledger") return openLedger(browser, { viewport, patch, reduced });
  return openEmit(browser, { kind, viewport, patch, reduced });
}

async function openLedger(browser, { viewport, patch, reduced }) {
  const m = await mountLedger(browser, viewport.width, viewport.height, { patch, settle: 300, context: { deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference" } });
  return { context: m.ctx, page: m.page, errors: m.errors };
}

export async function settle(page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 24 && stable < 3; i++) {
    await page.waitForTimeout(150);
    const size = await page.evaluate(() => document.getElementsByTagName("*").length + document.body.innerText.length);
    if (size === last) stable++; else stable = 0;
    last = size;
  }
  await page.evaluate(() => { for (const a of document.getAnimations()) { try { if (a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); } catch {} } });
  await page.waitForTimeout(120);
}

export async function applyMode(page, mode) {
  if (mode === "default") return;
  if (mode === "reduced-transparency") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  } else if (mode === "contrast-more") {
    await page.emulateMedia({ contrast: "more" });
  } else if (mode === "no-backdrop") {
    await page.evaluate((css) => { const s = document.createElement("style"); s.dataset.glassMode = "no-backdrop"; s.textContent = css; document.head.append(s); }, ":root { --mat-regular: var(--glass-solid); --mat-thick: var(--glass-solid-thick); --mat-chrome: var(--glass-solid-chrome); --mat-side: var(--glass-solid-chrome); --mat-thin: var(--glass-solid); }");
  } else if (mode === "forced") {
    await page.emulateMedia({ forcedColors: "active" });
  } else {
    throw new Error("glass-world: unknown mode " + mode);
  }
  await page.waitForTimeout(250);
}

export async function clearMode(page, mode) {
  if (mode === "default") return;
  if (mode === "reduced-transparency") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "no-preference" }] });
  } else if (mode === "contrast-more") {
    await page.emulateMedia({ contrast: "no-preference" });
  } else if (mode === "no-backdrop") {
    await page.evaluate(() => document.querySelector("style[data-glass-mode='no-backdrop']")?.remove());
  } else if (mode === "forced") {
    await page.emulateMedia({ forcedColors: "none" });
  } else {
    throw new Error("glass-world: unknown mode " + mode);
  }
  await page.waitForTimeout(150);
}

const collectRuns = () => {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const seen = (window.__glassSeen ||= new WeakSet());
  const forced = matchMedia("(forced-colors: active)").matches;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "OPTION", "TEXTAREA"]);
  const rgba = (() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    return (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  })();
  const stopsOf = (img) => {
    const out = [];
    for (const m of img.matchAll(/rgba?\([^)]*\)/g)) { const c = rgba(m[0]); if (c[3] > 0) out.push(c); }
    return out;
  };
  const inter = (a, b) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  };
  const pathOf = (el) => {
    const bits = [];
    for (let a = el, n = 0; a && a !== document.body && n < 5; a = a.parentElement, n++) {
      bits.unshift(a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") + (a.classList.length ? "." + [...a.classList].slice(0, 2).join(".") : ""));
    }
    return bits.join(" > ");
  };
  const runs = [];
  const nodes = (window.__glassNodes = []);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.data.trim() || seen.has(node)) continue;
    const el = node.parentElement;
    if (!el || SKIP.has(el.tagName) || el.closest("svg, math")) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    if (el.closest(":disabled, [aria-disabled='true'], [inert]")) continue;
    let opacity = 1;
    let clip = { x: 0, y: 0, w: vw, h: vh };
    let fixed = false;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const c = getComputedStyle(a);
      opacity *= parseFloat(c.opacity) || 0;
      if (c.position === "fixed" || c.position === "sticky") fixed = true;
      if ((c.overflowX !== "visible" || c.overflowY !== "visible") || c.contain.includes("paint") || c.clipPath !== "none") {
        const r = a.getBoundingClientRect();
        const next = inter(clip, { x: r.left, y: r.top, w: r.width, h: r.height });
        if (!next) { clip = null; break; }
        clip = next;
      }
    }
    if (!clip || opacity < 0.05) continue;
    const cs = getComputedStyle(el);
    const colour = rgba(cs.color);
    const fill = forced ? colour : rgba(cs.webkitTextFillColor);
    let ink = fill[3] > 0 ? fill : colour;
    let stops = null;
    if (fill[3] === 0 && colour[3] === 0) continue;
    if (fill[3] === 0 && cs.webkitBackgroundClip === "text") { stops = stopsOf(cs.backgroundImage); if (!stops.length) continue; ink = null; el.setAttribute("data-glass-grad", ""); }
    else if (fill[3] === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [];
    for (const r of range.getClientRects()) {
      const box = inter(clip, { x: r.left, y: r.top, w: r.width, h: r.height });
      if (box && box.w >= 2 && box.h >= 2) rects.push({ x: Math.ceil(box.x), y: Math.ceil(box.y), w: Math.floor(box.w) - 1, h: Math.floor(box.h) - 1 });
    }
    const boxes = rects.filter((r) => r.w >= 1 && r.h >= 1);
    if (!boxes.length) continue;
    seen.add(node);
    nodes.push(node);
    const whole = range.getBoundingClientRect();
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    runs.push({ raw: [whole.left, whole.top, whole.width, whole.height], text: node.data.replace(/\s+/g, " ").trim().slice(0, 40), path: pathOf(el), size, weight, need: size >= 24 || (size >= 18.66 && weight >= 600) ? 3 : 4.5, ink, stops, opacity, boxes, fixed, probeInk: el.dataset.ink || null, pool: el.closest("[data-pool]") ? el.closest("[data-pool]").dataset.pool : null, row: el.closest("[data-row]") ? el.closest("[data-row]").dataset.row : null });
  }
  return runs;
};

const runsHeld = (raws) => {
  const nodes = window.__glassNodes || [];
  if (nodes.length !== raws.length) return false;
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].isConnected) return false;
    const range = document.createRange();
    range.selectNodeContents(nodes[i]);
    const r = range.getBoundingClientRect();
    const was = raws[i];
    if (Math.abs(r.left - was[0]) > 0.75 || Math.abs(r.top - was[1]) > 0.75 || Math.abs(r.width - was[2]) > 0.75 || Math.abs(r.height - was[3]) > 0.75) return false;
  }
  return true;
};

const forgetRuns = () => { for (const n of window.__glassNodes || []) window.__glassSeen.delete(n); };

const judgeRuns = async ({ png, runs }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + png; });
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, a, bottom) => [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
  const out = [];
  for (const run of runs) {
    let bright = null, bl = -1;
    for (const b of run.boxes) {
      const x = Math.max(0, Math.min(cv.width - 1, b.x)), y = Math.max(0, Math.min(cv.height - 1, b.y));
      const w = Math.max(1, Math.min(cv.width - x, b.w)), h = Math.max(1, Math.min(cv.height - y, b.h));
      const d = cx.getImageData(x, y, w, h).data;
      for (let i = 0; i < d.length; i += 4) {
        const l = lum([d[i], d[i + 1], d[i + 2]]);
        if (l > bl) { bl = l; bright = [d[i], d[i + 1], d[i + 2]]; }
      }
    }
    if (!bright) continue;
    const inks = run.stops ? run.stops.map((s) => over(s, s[3] * run.opacity, bright)) : [over(run.ink, run.ink[3] * run.opacity, bright)];
    const r = Math.min(...inks.map((c) => ratio(c, bright)));
    out.push({ ...run, boxes: undefined, bg: bright, ratio: Math.round(r * 100) / 100, gradient: !!run.stops });
  }
  return out;
};

const PROBE = "[data-glass-probe] *, [data-glass-probe] *::before, [data-glass-probe] *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; text-shadow: none !important; } [data-glass-probe] [data-glass-grad] { background-image: none !important; }";

export async function measureText(page, { scrollSteps = 3 } = {}) {
  await page.evaluate(() => { window.__glassSeen = new WeakSet(); window.scrollTo(0, 0); });
  const all = [];
  for (let step = 0; step <= scrollSteps; step++) {
    let judged = null;
    for (let attempt = 0; attempt < 6 && judged === null; attempt++) {
      const runs = await page.evaluate(collectRuns);
      if (!runs.length) { judged = []; break; }
      await page.evaluate((css) => {
        const s = document.createElement("style");
        s.id = "glassProbeStyle";
        s.textContent = css;
        document.head.append(s);
        document.documentElement.setAttribute("data-glass-probe", "");
      }, PROBE);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const png = (await page.screenshot({ type: "png", animations: "disabled", caret: "hide" })).toString("base64");
      await page.evaluate(() => { document.documentElement.removeAttribute("data-glass-probe"); document.getElementById("glassProbeStyle")?.remove(); for (const e of document.querySelectorAll("[data-glass-grad]")) e.removeAttribute("data-glass-grad"); });
      if (await page.evaluate(runsHeld, runs.map((r) => r.raw))) judged = await page.evaluate(judgeRuns, { png, runs });
      else { await page.evaluate(forgetRuns); await page.waitForTimeout(300); }
    }
    if (judged === null) throw new Error("glass-world: the layout kept moving, so no text run could be placed on its pixels");
    for (const j of judged) all.push({ ...j, step });
    const more = await page.evaluate(() => {
      const vh = document.documentElement.clientHeight;
      const max = document.documentElement.scrollHeight - vh;
      if (window.scrollY + 1 >= max) return false;
      window.scrollTo(0, Math.min(max, window.scrollY + vh));
      return true;
    });
    if (!more) break;
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return all;
}

export function low(runs) {
  return runs.filter((r) => r.ratio < r.need).map((r) => `${r.path} "${r.text}" ${r.ratio}:1 (needs ${r.need}, ${r.size}px/${r.weight}${r.gradient ? ", gradient" : ""}, over rgb(${r.bg.join(",")}))`);
}

const SHEEN = "rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 30%";
export const MUTANTS = {
  "label-3 back at 0.52 with the sheen at 0.065": [["--label-3: rgba(235, 235, 245, 0.58);", "--label-3: rgba(235, 235, 245, 0.52);"], [SHEEN, "rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0) 30%"]],
  "mat-regular alpha 0.50": [["--mat-regular: rgba(16, 18, 26, 0.72);", "--mat-regular: rgba(16, 18, 26, 0.50);"]],
  "aurora alphas doubled": [["--aur-1: rgba(64, 120, 255, 0.16);", "--aur-1: rgba(64, 120, 255, 0.32);"], ["--aur-2: rgba(150, 100, 255, 0.11);", "--aur-2: rgba(150, 100, 255, 0.22);"], ["--aur-3: rgba(60, 200, 240, 0.07);", "--aur-3: rgba(60, 200, 240, 0.14);"]],
  "the reduced-transparency additions deleted": [["    --aur-1: transparent;\n    --aur-2: transparent;\n    --aur-3: transparent;\n    --glass-sheen: linear-gradient(transparent, transparent);\n    --glass-rim: linear-gradient(var(--sep-strong), var(--sep-strong));\n    --glass-caustic: 0 0 0 transparent;\n    --glass-ctl: var(--fill-3);\n    --glass-knob: var(--fill-1);\n", ""]],
  "the rim visible under forced colours": [["  .ui-card::before, .ft-strip::before, .ft-rail::before, .ft-gchart::before { display: none; }\n", ""]],
  "a sheen of 0.08 reaching 60%": [[SHEEN, "rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 60%"]],
};
export const patchOf = (name) => ({ "/assets/css/flows.css": MUTANTS[name] });

export const PROBE_INKS = [["label-1", "--label-1"], ["label-2", "--label-2"], ["label-3", "--label-3"], ["down", "--down"], ["accent", "--accent-ink"], ["up", "--up"]];
export const PROBE_NUMS = [["ice", null], ["num-up", "up"], ["num-down", "down"]];

const mountProbe = ({ inks, nums }) => {
  const ground = getComputedStyle(document.documentElement).getPropertyValue("--ground");
  const pools = [...ground.matchAll(/at (\d+)% (\d+)%/g)].map((m) => [Number(m[1]) / 100, Number(m[2]) / 100]);
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const W = Math.min(340, vw - 16), H = 112;
  const host = document.createElement("div");
  host.id = "glassProbeHost";
  const style = document.createElement("style");
  style.id = "glassProbeHostStyle";
  style.textContent = "#glassProbeHost { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; } #glassProbeHost .ui-card { position: absolute; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; padding: 4px 10px 8px; font: 400 13px / 1.3 var(--font-text); } #glassProbeHost .gp-row { display: flex; gap: 10px; white-space: nowrap; } #glassProbeHost .gp-num { font-weight: 600; } body > :not(#glassProbeHost) { display: none !important; }";
  document.head.append(style);
  const row = (cls) => {
    const r = document.createElement("div");
    r.className = "gp-row";
    for (const [name, token] of inks) { const s = document.createElement("span"); s.style.color = `var(${token})`; s.dataset.ink = name; s.textContent = name === "down" ? "−4.9%" : name === "up" ? "+4.9%" : name; r.append(s); }
    if (cls === "num") {
      r.replaceChildren();
      for (const [name, tone] of nums) { const s = document.createElement("span"); s.className = "ui-num gp-num"; if (tone) s.dataset.tone = tone; s.dataset.ink = name; s.textContent = tone === "down" ? "−12.5" : "+12.5"; r.append(s); }
    }
    return r;
  };
  const placed = [];
  pools.forEach(([px, py], i) => {
    const tile = document.createElement("div");
    tile.className = "ui-card";
    tile.dataset.pool = String(i);
    const x = Math.max(8, Math.min(vw - W - 8, px * vw - W / 2));
    let y = Math.max(8, Math.min(vh - H - 8, py * vh - H / 2));
    const hits = (yy) => placed.some((p) => Math.abs(p.x - x) < W + 8 && Math.abs(p.y - yy) < H + 8);
    for (let n = 0; n < 6 && hits(y); n++) y = y + H + 8 <= vh - H - 8 ? y + H + 8 : y - H - 8;
    placed.push({ x, y });
    tile.style.left = x + "px"; tile.style.top = y + "px"; tile.style.width = W + "px"; tile.style.height = H + "px";
    for (const kind of ["band", "num", "body"]) { const r = row(kind); r.dataset.row = kind; tile.append(r); }
    host.append(tile);
  });
  document.body.append(host);
  return pools.length;
};

export async function measureMaterial(page) {
  const pools = await page.evaluate(mountProbe, { inks: PROBE_INKS, nums: PROBE_NUMS });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => { window.__glassSeen = new WeakSet(); });
  const runs = await page.evaluate(collectRuns);
  const own = runs.filter((r) => r.path.includes("glassProbeHost"));
  await page.evaluate((css) => {
    const s = document.createElement("style");
    s.id = "glassProbeStyle";
    s.textContent = css;
    document.head.append(s);
    document.documentElement.setAttribute("data-glass-probe", "");
  }, PROBE);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = (await page.screenshot({ type: "png", animations: "disabled", caret: "hide" })).toString("base64");
  await page.evaluate(() => {
    document.documentElement.removeAttribute("data-glass-probe");
    for (const id of ["glassProbeStyle", "glassProbeHost", "glassProbeHostStyle"]) document.getElementById(id)?.remove();
    for (const e of document.querySelectorAll("[data-glass-grad]")) e.removeAttribute("data-glass-grad");
  });
  const judged = await page.evaluate(judgeRuns, { png, runs: own });
  const tiles = [];
  for (const j of judged) {
    let t = tiles.find((x) => x.pool === j.pool);
    if (!t) { t = { pool: j.pool, band: [0, 0, 0], num: [0, 0, 0], body: [0, 0, 0] }; tiles.push(t); }
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    if (lum(j.bg) > lum(t[j.row])) t[j.row] = j.bg;
  }
  return { pools, runs: judged.map((j) => ({ ...j, probe: true })), tiles };
}

const LENS_RIG_CSS = "#lensRig { position: fixed; left: 24px; top: 24px; z-index: 2147483000; display: grid; gap: 24px; padding: 20px; background: #07090e; } #lensRig[data-lens='off'] { --glass-lens: none; } #lensRig[data-lens='on'] { --glass-lens: url(\"#fx-lens\"); } #lensRig .ui-seg { background-color: #000; background-image: repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 10px); } #lensRig .ui-seg-i { color: transparent; } #lensRig .ui-seg-knob { transition: none; } #lensGrid { position: relative; width: 220px; height: 70px; background-image: repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 10px); } #lensProbe { position: absolute; inset: 5px 30px; } #lensRig[data-lens='on'] #lensProbe { -webkit-backdrop-filter: url(#lensProbeFx); backdrop-filter: url(#lensProbeFx); }";

const buildLensRig = (css) => {
  const host = document.createElement("div");
  host.id = "lensRig";
  host.dataset.lens = "prod";
  host.innerHTML = '<div class="ui-seg" id="lensSeg"><span class="ui-seg-knob" aria-hidden="true"></span><button class="ui-seg-i" type="button" role="tab" aria-selected="true">Reading window</button><button class="ui-seg-i" type="button" role="tab" aria-selected="false">Other</button></div><div id="lensGrid"><div id="lensProbe"></div></div><svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="lensProbeFx" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feFlood flood-color="rgb(200,128,128)" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter></svg>';
  const style = document.createElement("style");
  style.id = "lensRigStyle";
  style.textContent = css;
  document.head.append(style);
  document.body.append(host);
  const first = host.querySelector(".ui-seg-i");
  const knob = host.querySelector(".ui-seg-knob");
  knob.style.left = first.offsetLeft + "px";
  knob.style.width = first.offsetWidth + "px";
  const seg = host.querySelector(".ui-seg");
  seg.style.backgroundPositionX = (((first.offsetLeft + 5) % 10) + 10) % 10 + "px";
};

export async function openStaticShell(browser, name, { patch = null, viewport = VIEWPORTS[1] } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  const html = String(PAGES.FLOWS_PAGES[name]({ username: "test", ticker: "AAPL", net: true, scenes: false }));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/") && /\.(css|woff2)$/.test(u.pathname)) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(ORIGIN + "/flows/x/");
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

export const scrollRims = () => [...document.querySelectorAll(".ui-card, .ft-strip, .ft-rail, .ft-gchart")].filter((c) => {
  const s = getComputedStyle(c);
  return /auto|scroll/.test(s.overflowY + s.overflowX) && getComputedStyle(c, "::before").content !== "none";
}).map((c) => c.id || c.className);

export async function openLensRig(browser, { htmlPatch = null, patch = null, viewport = VIEWPORTS[1] } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  let html = PAGES.FLOWS_PAGES.sidePage({ username: "test", side: "long" });
  for (const [from, to] of htmlPatch || []) {
    if (!html.includes(from)) throw new Error("mutant anchor missing: " + from.slice(0, 60));
    html = html.replaceAll(from, to);
  }
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/") && /\.(css|woff2)$/.test(u.pathname)) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(ORIGIN + "/flows/long/");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(buildLensRig, LENS_RIG_CSS);
  await page.waitForTimeout(150);
  return { context, page, html };
}

const lineShifts = async ({ ref, lens }) => {
  const dec = async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, img.width, img.height);
  };
  const A = await dec(ref), B = await dec(lens);
  const W = A.width;
  const prof = (im) => {
    const y0 = Math.floor(im.height * 0.35), y1 = Math.max(y0 + 1, Math.ceil(im.height * 0.65));
    const out = new Array(im.width).fill(0);
    for (let x = 0; x < im.width; x++) {
      let sum = 0;
      for (let y = y0; y < y1; y++) { const i = (y * im.width + x) * 4; sum += 0.2126 * im.data[i] + 0.7152 * im.data[i + 1] + 0.0722 * im.data[i + 2]; }
      out[x] = sum / (y1 - y0);
    }
    return out;
  };
  const pa = prof(A), pb = prof(B);
  const floor = (p) => p.slice().sort((a, b) => a - b)[Math.floor(p.length * 0.25)];
  const fa = floor(pa), fb = floor(pb);
  const centroid = (p, f, lo, hi) => {
    let sw = 0, sx = 0;
    for (let x = Math.max(0, lo); x <= Math.min(W - 1, hi); x++) { const w = Math.max(0, p[x] - f - 12); sw += w; sx += w * x; }
    return sw > 0 ? sx / sw : null;
  };
  const peaks = (p, f) => {
    const out = [];
    let last = -9;
    for (let x = 1; x < W - 1; x++) if (p[x] - f > 80 && p[x] >= p[x - 1] && p[x] > p[x + 1] && x - last > 3) { out.push(centroid(p, f, x - 2, x + 2)); last = x; }
    return out;
  };
  const ra = peaks(pa, fa), rb = peaks(pb, fb);
  const lines = [];
  for (const c0 of ra) {
    let best = null;
    for (const c1 of rb) if (Math.abs(c1 - c0) <= 6 && (best === null || Math.abs(c1 - c0) < Math.abs(best - c0))) best = c1;
    lines.push({ x: Math.round(c0 * 100) / 100, edge: Math.min(c0, W - 1 - c0), left: c0, mid: Math.abs(c0 - (W - 1) / 2), shift: best === null ? null : Math.round((best - c0) * 100) / 100 });
  }
  return { width: W, lines };
};

export async function measureLens(page, target) {
  const sel = target === "probe" ? "#lensProbe" : ".ui-seg-knob";
  const shoot = async (state) => {
    await page.evaluate((st) => { document.getElementById("lensRig").dataset.lens = st; }, state);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const box = await page.evaluate((q) => { const r = document.querySelector("#lensRig " + q).getBoundingClientRect(); const x = Math.floor(r.left); return { x, y: Math.floor(r.top), width: Math.ceil(r.right) - x, height: Math.ceil(r.height) }; }, sel);
    return (await page.screenshot({ clip: box, type: "png", animations: "disabled" })).toString("base64");
  };
  const ref = await shoot("off");
  const lens = await shoot("on");
  const out = await page.evaluate(lineShifts, { ref, lens });
  await page.evaluate(() => { document.getElementById("lensRig").dataset.lens = "prod"; });
  return out;
}

const FLAT_MAP = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="rgb(128,128,0)"/></svg>');
const swap = (map, from, to) => map.replaceAll(encodeURIComponent(from), encodeURIComponent(to));
export const lensMutants = (lensMap) => ({
  "the displacement map is flat": { htmlPatch: [[lensMap(), FLAT_MAP]] },
  "the map pushes the middle of the box": { htmlPatch: [[lensMap(), swap(lensMap(), "rgb(128,0,0)", "rgb(176,0,0)")]] },
  "the map is gentle at the rim": { htmlPatch: [[lensMap(), swap(swap(lensMap(), "rgb(40,0,0)", "rgb(110,0,0)"), "rgb(216,0,0)", "rgb(146,0,0)")]] },
  "the lens filter is not emitted": { htmlPatch: [[/<svg class="ui-sprite"[^>]*><filter id="fx-lens".*?<\/filter><\/svg>/s.exec(PAGES.FLOWS_PAGES.sidePage({ username: "test", side: "long" }))[0], ""]] },
  "the @supports gate is gone": { patch: { "/assets/css/flows.css": [["@supports (backdrop-filter: url(\"#fx-lens\")) {\n  :root { --glass-lens: url(\"#fx-lens\") blur(12px) saturate(160%); }\n}\n\n", ""]] } },
  "the lens survives reduced transparency": { patch: { "/assets/css/flows.css": [["    --glass-knob: var(--fill-1);\n    --glass-lens: none;\n", "    --glass-knob: var(--fill-1);\n"]] } },
  "the lens survives forced colours": { patch: { "/assets/css/flows.css": [["  :root { --glass-lens: none; }\n  .ui-card, .ft-strip", "  .ui-card, .ft-strip"]] } },
});
