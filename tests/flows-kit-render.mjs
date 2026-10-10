import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://kit.test";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const VERSION = fs.readFileSync(path.join(ROOT, "assets/version.txt"), "utf8").trim();

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const STATES = [
  ["loading", "Loading"], ["quiet", "Quiet"], ["partial", "Partial"], ["pending", "Pending"],
  ["stale", "Stale"], ["withheld", "Withheld"], ["unavailable", "Unavailable"], ["signedOut", "Signed out"],
  ["quota", "Quota reached"], ["plan", "Plan"], ["held", "Held"], ["live", "Live"], ["fresh", "Fresh"], ["closed", "Closed"],
];
const BODY = {
  loading: '<span class="ds-sk"></span><span class="ds-sk"></span><span class="ds-sk"></span>',
  quiet: "Nothing to report in this window.",
  partial: "3 of 5 sources answered.",
  pending: "Waiting for the first reading.",
  stale: "Last updated 41 minutes ago.",
  withheld: "Withheld: the vendor does not state the unit.",
  unavailable: 'The source did not answer. <button class="ds-btn" type="button">Retry</button>',
  signedOut: 'Sign in to read this module. <a class="ds-btn" href="#in">Sign in</a>',
  quota: "Today's reads are used. Resets at 00:00 UTC.",
  plan: 'This module is on the next plan. <a class="ds-btn" href="#plans">See plans</a>',
  held: "Previous reading, kept while a new one is written.",
  live: "Updating as it trades.",
  fresh: "Read 12 seconds ago.",
  closed: "Market closed. Showing the 16:00 close.",
};

const TOKENS = [
  "--surface-0", "--surface-1", "--surface-2", "--surface-3", "--lift-1", "--lift-2", "--lift-3", "--focus-ring", "--min-hit",
  "--row-h", "--cell-px", "--mod-pad", "--t-data", "--t-data-sm", "--t-overline",
  "--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5",
  "--up", "--down", "--up-mark", "--down-mark", "--s-blue", "--s-orange", "--g-long", "--g-short", "--lvl-call", "--lvl-put",
];

const kitHtml = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kit</title>
<link rel="stylesheet" href="/assets/css/base.css?v=${VERSION}">
<link rel="stylesheet" href="/assets/css/flows.css?v=${VERSION}">
<style>
.kit { display: grid; gap: 16px; padding: 16px; max-width: 1320px; margin: 0 auto; }
.kit-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
.kit-bar { display: flex; flex-wrap: wrap; gap: 12px; }
.kit h2 { font: 600 17px / 1.3 var(--font-text); color: var(--label-1); margin: 0; }
</style></head>
<body class="flows-body"><main class="kit">
<h2>States</h2>
<div class="kit-grid" id="states">
${STATES.map(([s, label]) => `<section class="ds-mod" data-s="${s}" data-kit="state" style="--ds-reserve:96px">
<div class="ds-head"><span class="ds-ov">Net premium</span><span class="ds-st" data-s="${s}"><i></i>${label}</span></div>
<div class="ds-body">${BODY[s]}</div>
<div class="ds-foot"><span>Source nightly</span><span>As of 16:00 ET</span><span>Grade 2</span></div>
</section>`).join("\n")}
</div>
<h2>Density</h2>
<section class="ds-mod" id="compact" data-density="compact">
<div class="ds-head"><span class="ds-ov">Compact rows</span></div>
<div class="ds-body">
<div class="ds-row"><span>NVDA</span><span class="ds-sg" data-dir="up"><i></i>+1.8%</span></div>
<div class="ds-row"><span>AAPL</span><span class="ds-sg" data-dir="down"><i></i>−0.6%</span></div>
<div class="ds-row"><span>MSFT</span><span class="ds-sg" data-dir="flat"><i></i>0.0%</span></div>
</div>
<div class="kit-bar"><button class="ds-btn" type="button">Export</button><button class="ds-btn" type="button">Filter</button><a class="ds-btn" href="#more">More</a></div>
</section>
<section class="ds-mod" id="roomy">
<div class="ds-head"><span class="ds-ov">Default rows</span></div>
<div class="ds-body">
<div class="ds-row"><span>NVDA</span><span class="ds-sg" data-dir="up"><i></i>+1.8%</span></div>
<div class="ds-row"><span>AAPL</span><span class="ds-sg" data-dir="down"><i></i>−0.6%</span></div>
</div>
<div class="kit-bar"><button class="ds-btn" type="button">Export</button><button class="ds-btn" type="button">Filter</button></div>
</section>
</main></body></html>`;

const KIT = kitHtml();

const serve = async (page) => {
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/kit") return route.fulfill({ contentType: "text/html; charset=utf-8", body: KIT });
    return route.fulfill({ status: 404, body: "" });
  });
};

const srgbToLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const linToSrgb = (c) => { c = Math.min(1, Math.max(0, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const hex = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(h.trim()); if (!m) throw new Error("not a hex colour: " + h); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
const simulate = (rgb, kind) => {
  const lin = rgb.map(srgbToLin);
  const M = kind ? MACHADO[kind] : null;
  const out = M ? M.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]) : lin;
  return out.map(linToSrgb);
};
const toLab = (rgb) => {
  const [r, g, b] = rgb.map(srgbToLin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE2000 = (a, b) => {
  const [L1, a1, b1] = a, [L2, a2, b2] = b;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (y, x) => { if (x === 0 && y === 0) return 0; const h = Math.atan2(y, x) / rad; return h < 0 ? h + 360 : h; };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * rad / 2);
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) { hm = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
};
const minCvd = (x, y) => {
  const out = {};
  for (const kind of ["protan", "deutan", "tritan"]) out[kind] = deltaE2000(toLab(simulate(hex(x), kind)), toLab(simulate(hex(y), kind)));
  out.normal = deltaE2000(toLab(hex(x)), toLab(hex(y)));
  return { ...out, min: Math.min(out.protan, out.deutan, out.tritan) };
};

eq(Math.round(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]) * 10000) / 10000, 2.0425, "the ΔE2000 implementation reproduces Sharma's published pair 1");
eq(Math.round(deltaE2000([50, 2.5, 0], [73, 25, -18]) * 10000) / 10000, 27.1492, "the ΔE2000 implementation reproduces Sharma's published pair 17");

const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows.css"), "utf8");
const DOC = fs.readFileSync(path.join(ROOT, "docs/flows-design-system.md"), "utf8");

{
  ok(!/\/\*/.test(CSS), "flows.css carries no comment");
  const root = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("\n}\n", CSS.indexOf(":root {")));
  for (const t of TOKENS) ok(new RegExp("\\n\\s*" + t + ":").test(root), `${t} is declared on :root`);
  ok(/\[data-density="compact"\] \{ --row-h: 32px/.test(CSS), "compact density is a 32 px row");
  ok(/@media \(pointer: coarse\) \{ \[data-density="compact"\] \{ --row-h: 44px/.test(CSS), "compact density gives way to 44 px rows on a coarse pointer");
  ok(/@media \(forced-colors: active\)[^{]*\{[^@]*\.ds-mod/.test(CSS), "forced-colors rules cover the kit");
  ok(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ds-sk/.test(CSS), "reduced motion stills the kit's animations");

  const after = CSS.slice(CSS.indexOf(".ds-mod {"));
  const selectors = [...after.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map((m) => m[2]).filter((s) => s && !/^\d|^to$|^from$|^50%$/.test(s));
  const topLevel = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of sel) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } out.push(cur.trim()); return out; };
  const stray = selectors.flatMap(topLevel).filter((part) => !/^[^\[]*\.ds-|^:is\(\.ds-/.test(part));
  eq(stray, [], "every rule added after the tokens is namespaced under .ds-, so nothing on an existing page changes until it adopts a class");
  ok(selectors.length >= 40, `the namespaced rules were found (${selectors.length})`);

  for (const [s, label] of STATES) ok(DOC.includes("`" + s + "`") && DOC.includes(label), `docs/flows-design-system.md names the ${s} state`);
  for (const t of TOKENS.filter((t) => !/^--(up|down|up-mark|down-mark|s-blue|s-orange|g-long|g-short|lvl-call|lvl-put|lift-3)$/.test(t))) {
    ok(DOC.includes("`" + t + "`"), `docs/flows-design-system.md documents ${t}`);
  }
}

const PAIRS = [
  { a: "--up", b: "--down", cue: "sign" },
  { a: "--up-mark", b: "--down-mark", cue: "sign" },
  { a: "--lvl-call", b: "--lvl-put", cue: "sign" },
  { a: "--g-long", b: "--g-short", cue: "label" },
  { a: "--s-blue", b: "--s-orange", cue: "label" },
];

const browser = await launch();

const inPage = {
  contrastReport: () => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat([1]); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const ground = rgba(getComputedStyle(document.documentElement).getPropertyValue("--ground-base") || "#07090e");
    const bgOf = (el) => {
      const chain = [];
      for (let n = el; n; n = n.parentElement) chain.unshift(n);
      let bg = ground[3] === 1 ? ground : [7, 9, 14, 1];
      for (const n of chain) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) bg = over(c, bg); }
      return bg;
    };
    const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
    const rows = [];
    for (const el of document.querySelectorAll(".kit *")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const bg = bgOf(el);
      const fg = over(rgba(cs.color), bg);
      rows.push({ tag: el.tagName.toLowerCase() + "." + (el.className || ""), text: el.textContent.trim().slice(0, 28), ratio: ratio(fg, bg), opacity: opacityOf(el), size: parseFloat(cs.fontSize) });
    }
    return rows;
  },
  overflow: () => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll(".kit *")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) bad.push(el.tagName + "." + el.className + " " + Math.round(r.left) + ".." + Math.round(r.right));
    }
    return { scroll: document.documentElement.scrollWidth, client: vw, bad };
  },
  hitReport: () => {
    const sel = ".kit a[href], .kit button";
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const xs = [-1, 0, 1].map((k) => Math.min(Math.max(cx + k * (22 - 2), 1), document.documentElement.clientWidth - 1));
      const ys = [-1, 0, 1].map((k) => cy + k * (22 - 2));
      const miss = [];
      for (const y of ys) for (const x of xs) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit))) miss.push(Math.round(x - cx) + "," + Math.round(y - cy) + (hit ? ":" + hit.tagName + "." + hit.className : ":none"));
      }
      out.push({ text: el.textContent.trim(), w: r.width, h: r.height, miss });
    }
    return out;
  },
  glyphs: () => [...document.querySelectorAll('#states .ds-st')].map((st) => {
    const i = st.querySelector("i");
    const c = getComputedStyle(i);
    const sig = ["width", "height", "borderTopStyle", "borderTopWidth", "borderRadius", "backgroundImage", "clipPath", "transform", "boxShadow", "animationName"].map((k) => c[k]);
    sig.push(c.backgroundColor === "rgba(0, 0, 0, 0)" ? "transparent" : "fill");
    return { s: st.dataset.s, label: st.textContent.trim(), sig: sig.join("|"), tone: getComputedStyle(st).color };
  }),
};

const openKit = async (opts, emulate) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (emulate) await page.emulateMedia(emulate);
  await serve(page);
  await page.goto(ORIGIN + "/kit");
  await page.evaluate(() => document.fonts && document.fonts.ready);
  return { ctx, page, errors };
};

const contrastChecks = (rows, mode) => {
  ok(rows.length >= 60, `${mode}: the kit has text to measure (${rows.length} nodes)`);
  const low = rows.filter((r) => r.ratio < 4.5).map((r) => `${r.tag} "${r.text}" ${r.ratio.toFixed(2)}`);
  eq(low, [], `${mode}: every text node is at least 4.5:1 over its composited surface`);
  eq(rows.filter((r) => r.opacity < 1).map((r) => r.tag), [], `${mode}: no text sits under an ancestor with opacity below 1, so the measured colour is the painted one`);
  eq(rows.filter((r) => r.size < 11).map((r) => `${r.tag} ${r.size}px`), [], `${mode}: nothing is set below the 11 px floor`);
};

for (const width of [320, 390, 768, 1440]) {
  const { ctx, page, errors } = await openKit({ viewport: { width, height: 900 } });
  const tag = `${width}px`;

  const ov = await page.evaluate(inPage.overflow);
  ok(ov.scroll <= ov.client, `${tag}: the page does not scroll sideways (${ov.scroll} in ${ov.client})`);
  eq(ov.bad, [], `${tag}: no element leaves the viewport`);

  contrastChecks(await page.evaluate(inPage.contrastReport), tag);

  const ids = await page.evaluate(() => [...document.querySelectorAll(".kit a[href], .kit button")].map((e) => e.textContent.trim()));
  const seen = [];
  for (let i = 0; i < ids.length; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, offset: parseFloat(cs.outlineOffset), vis: el.matches(":focus-visible"), left: r.left, right: r.right };
    });
    seen.push(f.text);
    ok(f.vis && f.style !== "none" && f.width >= 2, `${tag}: "${f.text}" shows a focus outline of at least 2 px (${f.style} ${f.width}px)`);
    ok(f.left - f.offset - f.width >= -0.5 && f.right + f.offset + f.width <= width + 0.5, `${tag}: the focus ring of "${f.text}" stays inside the viewport`);
  }
  eq(seen, ids, `${tag}: Tab visits every control once, in document order`);

  const hits = await page.evaluate(inPage.hitReport);
  ok(hits.length === 8, `${tag}: the kit has controls to measure (${hits.length})`);
  for (const h of hits) eq(h.miss, [], `${tag}: the 44 x 44 px area around "${h.text}" resolves to it by elementFromPoint (${Math.round(h.w)} x ${Math.round(h.h)} drawn)`);


  eq(errors, [], `${tag}: no console or page error`);
  await ctx.close();
}

{
  const { ctx, page } = await openKit({ viewport: { width: 1440, height: 900 } });

  const g = await page.evaluate(inPage.glyphs);
  eq(g.map((x) => x.s), STATES.map(([s]) => s), "the kit renders the fourteen states in the stated order");
  eq(g.map((x) => x.label), STATES.map(([, l]) => l), "every state chip carries its name as text, so colour and shape are never the only cue");
  eq(new Set(g.map((x) => x.sig)).size, STATES.length, "all fourteen state glyphs are drawn differently from one another");

  const mods = await page.evaluate(() => [...document.querySelectorAll('#states [data-kit="state"]')].map((m) => ({
    s: m.dataset.s, chip: m.querySelector(".ds-st").dataset.s, h: m.querySelector(".ds-body").getBoundingClientRect().height,
    border: getComputedStyle(m).borderTopStyle, rule: getComputedStyle(m).boxShadow, foot: !!m.querySelector(".ds-foot"),
  })));
  eq(mods.map((m) => m.s), mods.map((m) => m.chip), "each module's state and its chip agree");
  ok(mods.find((m) => m.s === "loading").h >= 96, "a loading module reserves its stated height before any content arrives");
  for (const s of ["pending", "withheld", "quiet"]) eq(mods.find((m) => m.s === s).border, "dashed", `a ${s} module is drawn with a dashed edge`);
  for (const m of mods) {
    ok(m.rule.includes("inset"), `the ${m.s} module carries its state rule`);
    ok(m.foot, `the ${m.s} module ends in a provenance footer`);
  }
  const toneOf = Object.fromEntries(g.map((x) => [x.s, x.tone]));
  ok(new Set([toneOf.live, toneOf.stale, toneOf.unavailable, toneOf.fresh]).size === 4, "live, stale, unavailable and fresh take four different tones");

  const cue = await page.evaluate(() => {
    const read = (d) => { const e = document.querySelector('#roomy .ds-sg[data-dir="' + d + '"]'); return { text: e.textContent.trim(), clip: getComputedStyle(e.querySelector("i")).clipPath, color: getComputedStyle(e).color }; };
    return { up: read("up"), down: read("down") };
  });
  ok(cue.up.text.startsWith("+") && cue.down.text.startsWith("−"), "a rise is printed with + and a fall with U+2212, so direction does not rest on colour");
  ok(cue.up.clip !== "none" && cue.down.clip !== "none" && cue.up.clip !== cue.down.clip, "a rise and a fall are drawn as different shapes");
  ok(cue.up.color !== cue.down.color, "a rise and a fall also differ in colour");

  const tokenValue = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const report = [];
  for (const p of PAIRS) {
    const a = await tokenValue(p.a), b = await tokenValue(p.b);
    const d = minCvd(a, b);
    report.push(`${p.a}/${p.b} normal ${d.normal.toFixed(1)} protan ${d.protan.toFixed(1)} deutan ${d.deutan.toFixed(1)} tritan ${d.tritan.toFixed(1)}`);
    if (d.min < 20) ok(p.cue === "sign", `${p.a} against ${p.b}: ΔE2000 ${d.min.toFixed(1)} under the worst of three simulations is under 20, and its stated cue (${p.cue}) is not the printed sign and shape the kit verifies above`);
    else checks++;
  }
  console.log("  colour-vision separation (CIEDE2000, Machado severity 1):\n    " + report.join("\n    "));

  const rows = await page.evaluate(() => {
    const m = (id) => [...document.querySelectorAll(id + " .ds-row")].map((r) => r.getBoundingClientRect().height);
    return { compact: m("#compact"), roomy: m("#roomy") };
  });
  ok(rows.compact.every((h) => h >= 31.5 && h <= 33), `compact rows are 32 px on a fine pointer (${rows.compact.join(", ")})`);
  ok(rows.roomy.every((h) => h >= 43.5), `default rows are 44 px (${rows.roomy.join(", ")})`);
  const btns = await page.evaluate(() => [...document.querySelectorAll("#compact .ds-btn")].map((b) => b.getBoundingClientRect().height));
  ok(btns.every((h) => h >= 31.5 && h <= 33), `compact controls draw at 32 px (${btns.join(", ")}) and reach 44 px through their hit area, proved at every width above`);

  await ctx.close();
}

{
  const { ctx, page } = await openKit({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  ok(coarse, "the touch context reports a coarse pointer");
  const m = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("#compact .ds-row")].map((r) => r.getBoundingClientRect().height),
    btns: [...document.querySelectorAll("#compact .ds-btn")].map((b) => b.getBoundingClientRect().height),
  }));
  ok(m.rows.every((h) => h >= 43.5) && m.btns.every((h) => h >= 43.5), `compact density gives way to 44 px rows and controls on a coarse pointer (${m.rows.concat(m.btns).join(", ")})`);
  await ctx.close();
}

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const glyphVisible = async (page, mode) => {
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; }" });
  const states = await page.evaluate(() => [...document.querySelectorAll("#states .ds-st")].map((s) => s.dataset.s));
  const dead = [];
  for (const s of states) {
    const loc = page.locator(`#states .ds-st[data-s="${s}"] > i`);
    await loc.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
    await frames(page);
    const box = await loc.boundingBox();
    const clip = { x: Math.max(0, box.x - 1), y: Math.max(0, box.y - 1), width: box.width + 2, height: box.height + 2 };
    const shown = await page.screenshot({ clip, animations: "disabled" });
    await loc.evaluate((e) => { e.style.visibility = "hidden"; });
    await frames(page);
    const hidden = await page.screenshot({ clip, animations: "disabled" });
    await loc.evaluate((e) => { e.style.visibility = ""; });
    await frames(page);
    if (Buffer.compare(shown, hidden) === 0) dead.push(s);
  }
  eq(dead, [], `${mode}: every state glyph paints something`);
};

{
  const { ctx, page } = await openKit({ viewport: { width: 390, height: 844 } });
  await glyphVisible(page, "default colours");
  await ctx.close();
}

{
  const { ctx, page, errors } = await openKit({ viewport: { width: 390, height: 844 } }, { forcedColors: "active" });
  await page.keyboard.press("Tab");
  const f = await page.evaluate(() => { const c = getComputedStyle(document.activeElement); return { style: c.outlineStyle, width: parseFloat(c.outlineWidth), color: c.outlineColor }; });
  ok(f.style !== "none" && f.width >= 2, "forced colors: a focused control keeps its outline");
  const forced = await page.evaluate(() => matchMedia("(forced-colors: active)").matches);
  ok(forced, "Chromium reports forced-colors: active");
  const edges = await page.evaluate(() => [...document.querySelectorAll("#states .ds-mod, #states .ds-st, .kit .ds-btn")].map((e) => {
    const c = getComputedStyle(e);
    return { cls: e.className, w: parseFloat(c.borderTopWidth), style: c.borderTopStyle, color: c.borderTopColor, bg: c.backgroundColor };
  }));
  ok(edges.length === 36, `forced colors: ${edges.length} modules, chips and buttons measured`);
  eq(edges.filter((e) => !(e.w >= 1 && e.style !== "none" && e.color !== "rgba(0, 0, 0, 0)")).map((e) => e.cls), [], "forced colors: every module, chip and button keeps a visible edge");
  contrastChecks(await page.evaluate(inPage.contrastReport), "forced colors");
  await glyphVisible(page, "forced colors");

  const sk = await page.evaluate(() => { const e = document.querySelector(".ds-sk"); const c = getComputedStyle(e); return { bg: c.backgroundColor, parent: getComputedStyle(e.closest(".ds-mod")).backgroundColor }; });
  ok(sk.bg !== sk.parent, "forced colors: a loading bar is told apart from the surface behind it");

  eq(errors, [], "forced colors: no console or page error");
  await ctx.close();
}

{
  const { ctx, page } = await openKit({ viewport: { width: 390, height: 844 } }, { reducedMotion: "reduce" });
  const anim = await page.evaluate(() => [".ds-sk", '.ds-st[data-s="loading"] > i'].map((s) => getComputedStyle(document.querySelector(s)).animationName));
  eq(anim, ["none", "none"], "reduced motion: the skeleton and the loading glyph stand still");
  await ctx.close();
}

{
  const { ctx, page } = await openKit({ viewport: { width: 390, height: 844 } });
  const anim = await page.evaluate(() => [".ds-sk", '.ds-st[data-s="loading"] > i'].map((s) => getComputedStyle(document.querySelector(s)).animationName));
  ok(anim.every((a) => a !== "none"), "with motion allowed, the skeleton and the loading glyph animate");
  await ctx.close();
}

await browser.close();
console.log(`✓ flows-kit-render: ${checks} assertions — the design system's tokens, fourteen states, colour-vision rule, forced-colors rules and hit areas, drawn from the shipped stylesheets at 320, 390, 768 and 1440 px with no server`);
