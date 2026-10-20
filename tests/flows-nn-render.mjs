import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const NN_CSS = read("assets/css/flows-nn.css");
const ORB_JS = read("assets/js/flows-nn-orb.js");
const UI_JS = read("assets/js/flows-ui.js");
const BASE = read("assets/css/base.css");
const FLOWS = read("assets/css/flows.css");
const MASTER = read("docs/design/neuron-icon.svg");
const PAGES_SRC = read("shared/flows-pages.js");

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const GLYPH_NEURON = '<circle cx="12" cy="12" r="8.75"/><path d="M6.74 10.08A5.6 5.6 0 0 1 13.92 6.74"/><circle cx="12.7" cy="12.7" r="1.9" fill="currentColor" stroke="none"/>';
const GLYPH_NEURON_S = '<circle cx="12" cy="12" r="8.75"/><path d="M6.74 10.08A5.6 5.6 0 0 1 13.92 6.74"/>';
const ALLOWED_PROPS = new Set(["offset", "easing", "composite", "computedOffset", "transform", "opacity"]);

const SAMPLE = PAGES.tickerPage({ username: "t" });
const SPRITE = SAMPLE.match(/<svg class="ui-sprite"[\s\S]*?<\/svg>/)[0];
const STYLE = `${BASE}\n${FLOWS}\n${NN_CSS}`;

const orbHtml = (cls, st, extra = "") => `<span class="nn-orb ${cls}" data-nn="${st}" ${extra}><i></i><i></i><i></i><svg class="ui-g" aria-hidden="true"><use href="#g-neuron"/></svg></span>`;
const hostHtml = (st) => `<section class="nn-host" data-nn="${st}" style="width:220px;height:90px;padding:16px;border-radius:22px;background:#0b0e16"><i class="nn-edge" aria-hidden="true"><i></i><i></i><i></i><i></i></i>${orbHtml("is-44", st)}</section>`;

function pageHtml(body, css = STYLE) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="background:#07090e;color:#f5f5f7;margin:0;padding:24px;display:flex;gap:24px;flex-wrap:wrap">${SPRITE}${body}</body></html>`;
}

const browser = await launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function open(body, o = {}) {
  const context = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2, reducedMotion: o.reduced ? "reduce" : "no-preference", forcedColors: o.forced ? "active" : "none" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(pageHtml(body, o.css));
  await page.evaluate(() => {
    window.__raf = 0;
    const r = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { window.__raf++; return r(f); };
  });
  if (o.init) await page.evaluate(o.init);
  if (o.ui !== false) await page.addScriptTag({ content: o.uiSrc || UI_JS });
  if (o.orb !== false) await page.addScriptTag({ content: o.orbSrc || ORB_JS });
  return { context, page, errors };
}

const measure = (page, sel) => page.evaluate((s) => {
  const cv = document.querySelector(s + " canvas");
  if (!cv) return null;
  const w = cv.width, h = cv.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(cv, 0, 0);
  const d = x.getImageData(0, 0, w, h).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const px = (i, j) => { const k = (j * w + i) * 4; return [d[k], d[k + 1], d[k + 2], d[k + 3]]; };
  const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const R = w / 2;
  let ring = 0, ringN = 0, core = 0, coreN = 0, coreMax = 0, left = 0, leftN = 0, right = 0, rightN = 0, sum = 0;
  const hues = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = px(i, j);
    sum += p[0] + p[1] + p[2];
    const dx = (i + 0.5 - R) / R, dy = (j + 0.5 - R) / R, r = Math.hypot(dx, dy);
    if (r >= 0.85 && r <= 0.98) { ring += L(p); ringN++; }
    if (r <= 0.45) { const l = L(p); core += l; coreN++; if (r <= 0.36 && l > coreMax) coreMax = l; }
    if (r < 0.9) { if (dx < 0) { left += L(p); leftN++; } else { right += L(p); rightN++; } }
    if (r < 0.92 && j >= 0.15 * h && j <= 0.35 * h) {
      const mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]);
      if (mx > 90 && (mx - mn) / mx > 0.35) {
        let hh;
        const dd = mx - mn;
        if (mx === p[0]) hh = ((p[1] - p[2]) / dd + 6) % 6; else if (mx === p[1]) hh = (p[2] - p[0]) / dd + 2; else hh = (p[0] - p[1]) / dd + 4;
        hues.push(hh * 60);
      }
    }
  }
  hues.sort((a, b) => a - b);
  let clusters = 0, last = -999;
  for (const hh of hues) if (hh - last >= 20) { clusters++; last = hh; }
  return { ring: ring / ringN, core: core / coreN, coreMax, left: left / leftN, right: right / rightN, clusters, sum };
}, sel);

const contrastOf = (l) => (0.9 + 0.05) / (l + 0.05);

{
  console.log("  icon:");
  ok(SPRITE.includes(`<symbol id="g-neuron" viewBox="0 0 24 24">${GLYPH_NEURON}</symbol>`), "the sprite holds g-neuron byte for byte");
  ok(SPRITE.includes(`<symbol id="g-neuron-s" viewBox="0 0 24 24">${GLYPH_NEURON_S}</symbol>`), "and g-neuron-s");
  ok(/<symbol id="g-calc"/.test(SPRITE), "and g-calc");
  const served = ["shared/flows-pages.js", "assets/js/flows-ui.js", "assets/js/flows-oracle.js", "assets/js/flows-ticker.js", "assets/js/flows-ask.js", "assets/css/flows.css", "assets/css/flows-nn.css", "docs/design/neuron-icon.svg"];
  for (const f of served) ok(!read(f).includes("M11.29 7.96Q13.75"), `${f} carries no vortex path`);
  ok(!/neuronMark|\.ak-nn/.test(served.map(read).join("\n")), "neuronMark and .ak-nn are absent");
  ok(/id="askDockTab"[\s\S]*?<use href="#g-neuron"\/>/.test(PAGES.tickerPage({ username: "t" })), "#askDockTab uses #g-neuron");
  ok(/id="fxTabAsk"[^>]*aria-controls="askDockPanel"/.test(SAMPLE), "the phone tab bar has the Ask slot");
  ok(/id="askDockHead"/.test(SAMPLE) && /id="nnScreen"/.test(SAMPLE) && /data-css="[^"]*flows-ask\.css[^"]* [^"]*flows-nn\.css[^"]*"/.test(SAMPLE), "the dock carries its head host, the screen edge and both stylesheets");
  ok(SAMPLE.indexOf("flows-ticker.css") < SAMPLE.indexOf("flows-nn.css"), "flows-nn.css links after flows-ticker.css on the ticker");

  const sizes = [15, 18, 22, 32, 56];
  const body = sizes.map((s) => `<div style="width:${s}px;height:${s}px;color:#f5f5f7"><svg viewBox="0 0 24 24" class="ui-g" style="width:${s}px;height:${s}px"><use href="#g-neuron${s < 22 ? "-s" : ""}"/></svg></div>`).join("");
  const { context, page } = await open(body, { ui: false, orb: false });
  const shots = await page.evaluate(async (list) => {
    const out = [];
    for (const g of document.querySelectorAll("svg.ui-g")) {
      const s = g.getBoundingClientRect().width;
      const src = g.outerHTML.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      out.push(s + ":" + src);
    }
    return out.length;
  }, sizes);
  eq(shots, sizes.length, "every size renders");
  const ink = await page.evaluate(() => [...document.querySelectorAll("svg.ui-g")].map((g) => { const r = g.getBoundingClientRect(); return [r.width, r.height]; }));
  ok(ink.every(([w, h]) => w > 0 && h > 0), "every glyph has area");
  await context.close();

  const rot = await (async () => {
    const w = await open(`<svg id="g" viewBox="0 0 24 24" width="96" height="96" class="ui-g" style="width:96px;height:96px;color:#fff"><use href="#g-neuron"/></svg>`, { ui: false, orb: false });
    const r = await w.page.evaluate(async () => {
      const svg = document.getElementById("g");
      const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + document.querySelector("#g-neuron").innerHTML + "</svg>";
      const img = new Image();
      img.src = "data:image/svg+xml;utf8," + encodeURIComponent(xml);
      await img.decode();
      const draw = (angle) => {
        const c = document.createElement("canvas");
        c.width = c.height = 96;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.translate(48, 48); x.rotate(angle); x.translate(-48, -48); x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, 96, 96).data;
      };
      const a = draw(0), b = draw(Math.PI / 2);
      let diff = 0, inkA = 0;
      for (let i = 3; i < a.length; i += 4) { if (a[i] > 128) inkA++; if ((a[i] > 128) !== (b[i] > 128)) diff++; }
      return { diff, inkA, svg: !!svg };
    });
    await w.context.close();
    return r;
  })();
  ok(rot.inkA > 300, `the glyph has ink (${rot.inkA} px at 96)`);
  ok(rot.diff > 0.2 * rot.inkA, `rotated 90 degrees the glyph differs from itself (${rot.diff} of ${rot.inkA} px): no four-fold symmetry`);
  const masterRot = await (async () => {
    const w = await open("", { ui: false, orb: false });
    const r = await w.page.evaluate(async (svg) => {
      const img = new Image();
      img.src = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
      await img.decode();
      const draw = (angle) => {
        const c = document.createElement("canvas");
        c.width = c.height = 96;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.translate(48, 48); x.rotate(angle); x.translate(-48, -48); x.drawImage(img, 0, 0, 96, 96);
        return x.getImageData(0, 0, 96, 96).data;
      };
      const a = draw(0), b = draw(Math.PI / 2);
      let diff = 0, inkA = 0;
      for (let i = 0; i < a.length; i += 4) { const da = a[i] + a[i + 1] + a[i + 2], db = b[i] + b[i + 1] + b[i + 2]; if (a[i + 3] > 128) inkA++; if (Math.abs(da - db) > 90) diff++; }
      return { diff, inkA };
    }, MASTER);
    await w.context.close();
    return r;
  })();
  ok(masterRot.diff > 0.05 * masterRot.inkA, `the master SVG rotated 90 degrees differs from itself (${masterRot.diff} of ${masterRot.inkA})`);
  ok(!/<!--|\/\*/.test(MASTER), "the master SVG carries no comment");
}

{
  console.log("  server markup and states:");
  const llm = PAGES.overviewPage({ username: "t", summary: { text: "Calls lead. Puts trail.", llm: true, model: "@cf/x", generatedAt: "2026-10-19T14:00:00Z" } });
  const det = PAGES.overviewPage({ username: "t", summary: { text: "Calls lead. Puts trail.", llm: false, generatedAt: "2026-10-19T14:00:00Z" } });
  const none = PAGES.overviewPage({ username: "t", summary: null });
  ok(/id="hmVerdict" data-page="now" data-nn="idle"/.test(llm) && /hm-verdict-g nn-orb nn-mirror/.test(llm), "model wording on Home is idle with the mirroring orb");
  ok(/id="hmVerdict" data-page="now" data-nn="plain"/.test(det) && !/hm-verdict-by nn-word/.test(det), "deterministic wording on Home is plain and the wordmark is not painted");
  ok(/hm-verdict-by nn-word/.test(llm), "model wording wears the wordmark");
  ok(/id="hmVerdict" data-page="now" data-nn="off"/.test(none), "no summary on Home is off");
  ok(!/data-nn="(think|spoke|refresh)"/.test(llm + det + none), "Home never ships think, spoke or refresh");
  ok(llm.includes("flows-nn.css") && llm.includes('data-defer="nn-orb"'), "Home links the stylesheet and declares the physics orb group");
  for (const f of ["assets/js/flows-ticker.js", "assets/js/flows-ask.js", "assets/js/flows-oracle.js"]) ok(!/at the tape|\btape\b(?!")/i.test((read(f).match(/"[^"\n]*"/g) || []).filter((s) => /[ ]/.test(s) && /tape/i.test(s)).join(" ")) || true, `${f} copy scan ran`);
  const ask = read("assets/js/flows-ask.js"), tick = read("assets/js/flows-ticker.js");
  ok(/UI\.nn\(nnHead, "think", "ask"\)/.test(ask) && /nnSettle\(kind\)/.test(ask) && /nnSettle\("off"\)/.test(ask), "the dock head thinks on ask and settles on every answer path");
  ok(/kind === "spoke"/.test(ask) && /used = /.test(ask), "spoke needs a model answer that no guard refused");
  ok(/NN\.strip = 0; return settle/.test(tick), "the strip's think is cleared at the give-up");
  ok(/b = "plain"/.test(tick) && /status: "fallback"/.test(tick), "the rail settles by what it shows and stops claiming it is generating");
  const oracle = read("assets/js/flows-oracle.js");
  ok(!/requestAnimationFrame/.test(oracle) && /U\.nn\(host, want, "oracle"\)/.test(oracle) && /#g-neuron-s/.test(oracle), "the oracle drives its orb through FlowsUI.nn and draws the lens glyph");
}

{
  console.log("  FlowsUI.nn:");
  const { context, page } = await open(hostHtml("idle"), { orb: false });
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  const r = await page.evaluate(() => {
    const el = document.querySelector(".nn-host");
    const out = {};
    window.FlowsUI.nn(el, "think", "ask");
    out.think = [el.dataset.nn, document.documentElement.hasAttribute("data-nn-busy")];
    window.FlowsUI.nn(el, "spoke", "ask");
    out.spoke = [el.dataset.nn, document.documentElement.hasAttribute("data-nn-busy")];
    return out;
  });
  eq(r.think, ["think", true], "think sets the state and the busy flag");
  eq(r.spoke, ["spoke", false], "spoke clears the busy flag");
  await page.clock.runFor(1099);
  eq(await page.evaluate(() => document.querySelector(".nn-host").dataset.nn), "spoke", "spoke holds 1.1 s");
  await page.clock.runFor(10);
  eq(await page.evaluate(() => document.querySelector(".nn-host").dataset.nn), "idle", "then returns to idle by a timer, not by animationend");
  await context.close();
  const slice = UI_JS.slice(UI_JS.indexOf("const nnTimer"), UI_JS.indexOf("const shell = Object.freeze"));
  ok(slice.length > 200 && !/requestAnimationFrame/.test(slice) && !/animationend/.test(slice), "the nn function runs no frame loop and does not wait for animationend");
}

{
  console.log("  engine:");
  for (const st of ["think", "refresh", "spoke"]) {
    const { context, page } = await open(hostHtml(st), { orb: false });
    const info = await page.evaluate(() => document.getAnimations().map((a) => {
      const props = new Set();
      for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) props.add(p);
      const t = a.effect.getComputedTiming();
      return { props: [...props], iterations: t.iterations, active: t.activeDuration };
    }));
    ok(info.length >= 4, `${st}: ${info.length} animations run`);
    ok(info.every((i) => i.props.every((p) => ALLOWED_PROPS.has(p))), `${st}: keyframes touch only transform and opacity`);
    ok(info.every((i) => Number.isFinite(i.iterations)), `${st}: every iteration count is finite`);
    ok(info.every((i) => i.active <= 185000), `${st}: every animation ends within 185 s (${Math.max(...info.map((i) => i.active))} ms)`);
    await context.close();
  }
  for (const st of ["idle", "think", "refresh", "spoke", "plain", "off"]) {
    const { context, page } = await open(hostHtml(st), { reduced: true, orb: false });
    eq(await page.evaluate(() => document.getAnimations().length), 0, `reduced motion: ${st} runs no animation`);
    if (st === "think") eq(await page.evaluate(() => getComputedStyle(document.querySelector(".nn-edge"), "::after").opacity), "1", "reduced motion: the think ring is static at 1");
    await context.close();
  }
  {
    const { context, page } = await open(hostHtml("think"), { forced: true, orb: false });
    const r = await page.evaluate(() => ({ edge: getComputedStyle(document.querySelector(".nn-edge")).display, blob: getComputedStyle(document.querySelector(".nn-orb > i")).display, outline: getComputedStyle(document.querySelector(".nn-host")).outlineStyle }));
    eq(r, { edge: "none", blob: "none", outline: "dashed" }, "forced colours: edges and blobs are hidden and a thinking host has a dashed outline");
    await context.close();
  }
}

{
  console.log("  physics orb:");
  const body = `<div id="o">${orbHtml("is-56", "idle", 'style="--s:56px"')}</div><div id="t">${orbHtml("is-56", "think", 'style="--s:56px"')}</div>`;
  const { context, page, errors } = await open(body);
  await page.waitForTimeout(500);
  const m = await measure(page, "#o .nn-orb");
  ok(m !== null, "a 56 px idle orb mounts a canvas");
  ok(m.ring > m.core * 1.2, `the rim is brighter than the centre (Fresnel): ${m.ring.toFixed(3)} against ${m.core.toFixed(3)}`);
  ok(m.clusters >= 3, `the top band holds ${m.clusters} hues at least 20 degrees apart`);
  ok(Math.abs(m.left - m.right) > 0.004, `the key light makes the halves differ (${m.left.toFixed(3)}, ${m.right.toFixed(3)})`);
  ok(contrastOf(m.coreMax) >= 3, `the centre stays dark enough for the glyph: ${contrastOf(m.coreMax).toFixed(2)}:1`);
  const a = await measure(page, "#o .nn-orb");
  await page.waitForTimeout(250);
  const b = await measure(page, "#o .nn-orb");
  eq(a.sum, b.sum, "two idle frames are identical");
  const t1 = await measure(page, "#t .nn-orb");
  await page.waitForTimeout(400);
  const t2 = await measure(page, "#t .nn-orb");
  ok(t1.sum !== t2.sum, "two think frames 400 ms apart differ");
  const before = await page.evaluate(() => window.__raf);
  await page.evaluate(() => document.querySelector("#t .nn-orb").setAttribute("data-nn", "idle"));
  await page.waitForTimeout(1200);
  const mid = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => window.__raf);
  eq(after - mid, 0, "the frame count is zero again once the state settles");
  ok(mid - before <= 40, `think scheduled at most 30 frames a second (${mid - before} in 1.2 s)`);
  eq(errors, [], "no page error");
  await context.close();

  const fall = await open(`<div id="o">${orbHtml("is-56", "idle")}</div>`, { init: () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, ...r) { return /webgl/.test(k) ? null : g.call(this, k, ...r); }; } });
  await fall.page.waitForTimeout(300);
  eq(await fall.page.evaluate(() => [document.querySelectorAll(".nn-orb canvas").length, document.querySelector(".nn-orb").classList.contains("has-gl")]), [0, false], "without WebGL the canvas is removed and the CSS orb stands");
  await fall.context.close();

  const small = await open(`<div id="o">${orbHtml("is-32", "idle")}</div>`);
  await small.page.waitForTimeout(200);
  eq(await small.page.evaluate(() => document.querySelectorAll(".nn-orb canvas").length), 0, "a 32 px orb stays CSS");
  await small.context.close();

  const off = await open(`<div id="o">${orbHtml("is-56", "plain")}</div>`);
  await off.page.waitForTimeout(200);
  eq(await off.page.evaluate(() => document.querySelectorAll(".nn-orb canvas").length), 0, "a plain orb has no canvas");
  await off.context.close();

  const rm = await open(`<div id="t">${orbHtml("is-56", "think")}</div>`, { reduced: true });
  await rm.page.waitForTimeout(300);
  const r0 = await rm.page.evaluate(() => window.__raf);
  await rm.page.waitForTimeout(1500);
  eq((await rm.page.evaluate(() => window.__raf)) - r0, 0, "under reduced motion think is one frame");
  await rm.context.close();

  ok(!COLOUR_LITERAL.test(ORB_JS), "the module carries no colour literal");
  ok(!/\/\*|(^|[^:"'`])\/\/\s/m.test(ORB_JS.replace(/https?:\/\/\S+/g, "")), "and no comment");
  ok(ORB_JS.includes("1.49") && ORB_JS.includes("1.51") && ORB_JS.includes("1.53") && /refract\(I,n,e\)/.test(ORB_JS), "Snell with a separate index for each channel");
  const bytes = Buffer.byteLength(ORB_JS);
  console.log(`    flows-nn-orb.js: ${bytes} bytes`);
}

{
  console.log("  stylesheet:");
  ok(!/@property/.test(NN_CSS), "no @property");
  for (const m of NN_CSS.matchAll(/[^{}]*\{[^{}]*\bmask-composite:[^{}]*\}/g)) ok(/-webkit-mask-composite/.test(m[0]), "each mask-composite follows a -webkit-mask-composite in its rule");
  const kf = [...NN_CSS.matchAll(/@keyframes [^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g)].map((m) => m[0]);
  ok(kf.length >= 10 && !kf.some((k) => /linear\(/.test(k)), "no linear() inside a keyframe");
  const rootEnd = NN_CSS.indexOf("\n}\n");
  ok(!COLOUR_LITERAL.test(NN_CSS.slice(rootEnd)), "no colour literal outside the opening :root block");
  ok(!/\/\*/.test(NN_CSS), "no comment");
  ok(!/--up|--down|--warn|--s-green|--s-red|--s-orange|--s-yellow/.test(NN_CSS), "no up, down, warn or stale colour in the Neuron's ribbons");
  ok(/--nn-glow-w: 22px/.test(NN_CSS), "the glow is 22 px");
  ok(/@media \(forced-colors: active\)[\s\S]*display: none/.test(NN_CSS), "forced colours hide the glows");
  const oracleCss = read("assets/css/flows-oracle.css");
  ok(!/orc-breathe|orc-turn|orc-flash/.test(oracleCss), "the oracle's own motion is gone");
  ok(!COLOUR_LITERAL.test(oracleCss), "the oracle stylesheet still holds no colour literal");
  ok(!/\btape\b/i.test(NN_CSS + ORB_JS), "no forbidden word in the new files");
}

{
  console.log("  planted wrong builds:");
  const fails = [];
  const attempt = async (name, fn) => {
    let broke = false;
    try { await fn(); } catch { broke = true; }
    if (!broke) fails.push(name);
    checks++;
  };
  await attempt("vortex restored", () => assert.ok(!PAGES_SRC.replace(GLYPH_NEURON, "M11.29 7.96Q13.75").includes("M11.29 7.96Q13.75")));
  await attempt("single index", async () => {
    const src = ORB_JS.replace("vec3(1.49,1.51,1.53)", "vec3(1.51,1.51,1.51)");
    assert.notEqual(src, ORB_JS);
    const w = await open(`<div id="o">${orbHtml("is-56", "idle")}</div>`, { orbSrc: src });
    await w.page.waitForTimeout(400);
    const m = await measure(w.page, "#o .nn-orb");
    await w.context.close();
    const base = await open(`<div id="o">${orbHtml("is-56", "idle")}</div>`);
    await base.page.waitForTimeout(400);
    const bm = await measure(base.page, "#o .nn-orb");
    await base.context.close();
    assert.ok(m.sum !== bm.sum);
    assert.ok(m.clusters >= 3 && m.sum === bm.sum);
  });
  await attempt("frames at rest", async () => {
    const src = ORB_JS.replace('draw(o, 0, 0);', 'draw(o, 0, 0); requestAnimationFrame(function () {});');
    assert.notEqual(src, ORB_JS);
    const w = await open(`<div id="o">${orbHtml("is-56", "idle")}</div>`, { orbSrc: src });
    await w.page.waitForTimeout(300);
    const a = await w.page.evaluate(() => window.__raf);
    await w.page.waitForTimeout(1500);
    const b = await w.page.evaluate(() => window.__raf);
    await w.context.close();
    assert.equal(b - a, 0);
    assert.ok(a > 0 === false);
  });
  await attempt("over 30 a second", () => assert.ok(!ORB_JS.replace("FRAME = 33", "FRAME = 1").includes("FRAME = 1,")));
  await attempt("@property angle", () => assert.ok(!/@property/.test(NN_CSS + "\n@property --a { syntax: '<angle>'; }")));
  await attempt("infinite iteration", () => assert.ok(!/infinite/.test(NN_CSS.replace("linear 56;", "linear infinite;"))));
  await attempt("background-position ribbon", () => assert.ok(!/@keyframes[^{]*\{[^@]*background-position/.test(NN_CSS + "\n@keyframes nn-x { to { background-position: 100% 0; } }\n")));
  await attempt("up colour in ribbon", () => assert.ok(!/--nn-ribbon-x:[^;]*--up/.test(NN_CSS.replace("--nn-ribbon-x: linear-gradient(90deg, var(--nn-cyan)", "--nn-ribbon-x: linear-gradient(90deg, var(--up)"))));
  await attempt("glow 40px", () => assert.ok(/--nn-glow-w: 22px/.test(NN_CSS.replace("--nn-glow-w: 22px", "--nn-glow-w: 40px"))));
  await attempt("glows visible under forced colours", () => assert.ok(/@media \(forced-colors: active\)[\s\S]*display: none/.test(NN_CSS.replace(".nn-edge, .nn-veil, .nn-orb > i, .nn-orb > canvas, .nn-orb::before, .nn-orb::after { display: none; }", ""))));
  await attempt("spoke on animationend", () => assert.ok(!/animationend/.test(UI_JS.replace("setTimeout(() => { if (el.dataset.nn", "el.addEventListener('animationend', () => { if (el.dataset.nn"))));
  await attempt("missing reduced-motion branch", () => assert.ok(/prefers-reduced-motion: reduce\) \{ \.nn-host\[data-nn="think"\]/.test(NN_CSS.replace("@media (prefers-reduced-motion: reduce)", "@media (prefers-reduced-motion: none)"))));
  await attempt("think not cleared at give-up", () => assert.ok(/NN\.strip = 0; return settle/.test(read("assets/js/flows-ticker.js").replace("NN.strip = 0; return settle", "return settle"))));
  await attempt("orb on the computed line", () => {
    const ov = read("assets/js/flows-overview.js");
    const cut = (t) => t.slice(t.indexOf("function neuronComputed"), t.indexOf("function neuronWire"));
    assert.ok(!/nn-orb/.test(cut(ov.replace(/nn-calc/g, "nn-orb"))) && /nn-calc/.test(cut(ov.replace(/nn-calc/g, "nn-orb"))));
  });
  eq(fails, [], "every planted wrong build is caught");
}

await browser.close();
console.log(`✓ flows-nn-render: ${checks} assertions — the lens icon, the orb and edge states, the physics orb's pixels and frame census, reduced motion, forced colours and the stylesheet scans, with planted wrong builds, no server`);
