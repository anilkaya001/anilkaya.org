import fs from "node:fs";
import path from "node:path";
import { createLiveLedger } from "../../shared/flows-ledger-live.js";
import { mulberry32, between } from "./sfc-rng.mjs";
import { mountLive, liveWorld, serverBook, streamRow, HTML, HTML_OFF, NOW, ROOT } from "./ledger-live-world.mjs";

export const MINUS = "−", DASH = "—";
export const SIZES = [[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [390, 844], [390, 664]];
export const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;

export const LIVE_JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-sfc-live.js"), "utf8");
export const CTL_JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-sfc.js"), "utf8");
export const LIVE_CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-sfc-live.css"), "utf8");

export const once = (text, from, to) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error("plant did not apply: " + JSON.stringify(from.slice(0, 60)) + " matched " + n);
  return text.replace(from, () => to);
};

export const PERF_HOOK = `
(() => {
  let hidden = false;
  let held = [];
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => (hidden ? (held.push(fn), -1) : raf(fn));
  window.__setHidden = (v) => {
    hidden = v;
    document.dispatchEvent(new Event("visibilitychange"));
    if (!v) { const list = held; held = []; for (const fn of list) raf(fn); }
  };
  window.__muts = [];
  window.__mutAt = [];
  window.__watch = (selectors) => {
    window.__muts = [];
    window.__mutAt = [];
    const obs = new MutationObserver((list) => { const t = performance.now(); for (const m of list) { window.__muts.push(m); window.__mutAt.push(t); } });
    for (const sel of selectors) for (const el of document.querySelectorAll(sel)) obs.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__obs = obs;
  };
  window.__unwatch = () => { if (window.__obs) { const rest = window.__obs.takeRecords(); const t = performance.now(); for (const m of rest) { window.__muts.push(m); window.__mutAt.push(t); } window.__obs.disconnect(); window.__obs = null; } };
})();
`;

export const statusOf = (page) => page.evaluate(() => window.FlowsUI.ledgerLive.status());

export async function mount(browser, w, h, o = {}) {
  const m = await mountLive(browser, w, h, { ...o, context: { ...(o.context || {}) } });
  return m;
}

export async function mountHooked(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: o.reduced === false ? "no-preference" : "reduce" });
  await ctx.addInitScript(PERF_HOOK);
  const m = await mountLive(browser, w, h, { ...o, newContext: ctx });
  return m;
}

export const shownLedger = (page) => page.evaluate(() => [...document.querySelectorAll(".sf-lt tbody tr:not(.sub)")].map((tr) => [...tr.children].map((c) => ({ t: c.textContent.trim(), s: c.dataset.s || null }))));

export const expectedLedger = (view) => {
  const L = view.ledger;
  const flat = [...L.rows.slice(0, 10), L.net, L.rows[10]];
  return flat.map((row) => [row.group ? row.short : row.label, ...row.cells.map((c) => (c.s === "blank" ? "" : c.t))]);
};

export const num = (t) => (t === "~0" || t === "0" || t === "" || t === DASH ? 0 : (t.startsWith(MINUS) ? -1 : 1) * Number(t.replace(MINUS, "").replace(/[,+]/g, "").replace(".", "")));

export const audit = (page) => page.evaluate(() => {
  const out = [];
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const se = document.scrollingElement;
  if (se.scrollHeight > innerHeight) out.push("page scrolls vertically " + se.scrollHeight + " over " + innerHeight);
  if (se.scrollWidth > innerWidth) out.push("page scrolls sideways " + se.scrollWidth + " over " + innerWidth);
  for (const host of document.querySelectorAll(".sf-mat, .sf-body, .sf-fl")) if (vis(host) && host.scrollHeight > host.clientHeight + 1) out.push("rows clipped in " + host.id);
  const live = document.getElementById("sfLive");
  const title = document.querySelector(".sf-title");
  if (live && title) {
    const a = live.getBoundingClientRect(), b = title.getBoundingClientRect();
    if (a.right > b.right + 1 || a.left < b.left - 1 || a.bottom > b.bottom + 1) out.push("the strip leaves the title row");
    const btn = live.querySelector("button");
    if (btn.scrollWidth > btn.clientWidth + 1 && getComputedStyle(btn).overflow !== "visible") out.push("the strip text is cut");
    const r = btn.getBoundingClientRect();
    if (r.height < 43.5 && matchMedia("(pointer: coarse)").matches) out.push("the strip target is under 44 px");
  }
  return out;
});

export function expected(world, base, steps) {
  const live = createLiveLedger();
  live.applyBase(base);
  for (const s of steps) { live.put(s.rows, { at: s.readAt }); live.setRead(s.readAt); live.settle(); }
  return live;
}

export class Sim {
  constructor(m) {
    this.m = m;
    this.rnd = mulberry32(99);
    this.i = 0;
    this.readAt = NOW - 100000;
    this.steps = [];
    this.base = serverBook(m.world);
    this.frames = 1;
  }

  rows(n, over = {}) {
    return Array.from({ length: n }, () => streamRow(this.m.world, this.rnd, this.i++, this.readAt, over));
  }

  async send(rows, { gap = 1000, quiet = false } = {}) {
    this.readAt += gap;
    const { m } = this;
    await m.page.clock.setFixedTime(new Date(this.readAt + 50));
    m.R.now = this.readAt + 50;
    const frame = m.R.delta(rows, { readAt: this.readAt });
    this.steps.push({ rows, readAt: this.readAt });
    m.R.send(frame);
    this.frames++;
    const want = this.frames;
    await m.page.waitForFunction((n) => window.FlowsUI.ledgerLive.status().counts.frames >= n, want, { timeout: 8000 });
    await m.page.waitForFunction(() => !window.FlowsUI.ledgerLive.status().painting, null, { timeout: 8000 });
    await m.page.waitForTimeout(quiet ? 20 : 40);
  }

  mirror() {
    return expected(this.m.world, this.base, this.steps);
  }
}
