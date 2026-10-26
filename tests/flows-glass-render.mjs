import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { workerSource } from "./lib/source-scan.mjs";
import { openGlass, openLensRig, openStaticShell, scrollRims, measureLens, lensMutants, settle, applyMode, clearMode, measureText, measureMaterial, low, MUTANTS, patchOf, PAGE_KINDS, VIEWPORTS, MODES, PROBE_INKS, PROBE_NUMS } from "./lib/glass-world.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows.css"), "utf8");

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const BAND_BUDGET = [30, 35, 51];
const BODY_BUDGET = [23, 28, 45];
const AURORA_POOLS = 3;
const BLUE_POOL = "0";
const XL = VIEWPORTS[0];
const L = VIEWPORTS[1];
const within = (px, budget) => px.every((v, i) => v <= budget[i]);
const vpTag = (vp) => `${vp.width}x${vp.height}`;

const pageTime = [];
const t0 = Date.now();

function contrastChecks(runs, tag, { minRuns = 30 } = {}) {
  ok(runs.length >= minRuns, `${tag}: the page has text to measure (${runs.length} runs)`);
  eq(low(runs), [], `${tag}: every visible text run is at least 4.5:1 over the brightest pixel under it, or 3:1 at 24 px and above or 18.66 px at weight 600, measured from a screenshot with the ink made transparent`);
}

function materialChecks(material, tag) {
  const { runs, tiles, pools } = material;
  ok(pools >= AURORA_POOLS + 1, `${tag}: the ground declares the three aurora pools and the sky glow (${pools} radial centres read from --ground)`);
  eq(low(runs), [], `${tag}: every probe ink of the contrast budget table (${PROBE_INKS.map((x) => x[1]).join(", ")} and the three .ui-num gradients) clears its ratio in the top band and the body of a glass tile placed on every pool centre`);
  for (const [name] of [...PROBE_INKS, ...PROBE_NUMS]) ok(runs.some((r) => r.probeInk === name), `${tag}: the ${name} probe ink was measured`);
  const gradients = runs.filter((r) => r.gradient);
  ok(gradients.length >= PROBE_NUMS.length * AURORA_POOLS, `${tag}: the .ui-num gradients were measured stop by stop (${gradients.length} runs)`);
  const over = [];
  for (const t of tiles.filter((x) => x.pool === BLUE_POOL)) {
    if (!within(t.band, BAND_BUDGET)) over.push(`pool ${t.pool} band rgb(${t.band.join(",")}) over the budget rgb(${BAND_BUDGET.join(",")})`);
    if (!within(t.body, BODY_BUDGET)) over.push(`pool ${t.pool} body rgb(${t.body.join(",")}) over the budget rgb(${BODY_BUDGET.join(",")})`);
  }
  eq(over, [], `${tag}: the composited tile body and top band on the blue aurora pool, the brightest backdrop the budget was worked for, stay inside its figures`);
  return tiles;
}

const browser = await launch();

async function open(kind, viewport, extra = {}) {
  const t = Date.now();
  const world = await openGlass(browser, { kind, viewport, ...extra });
  await settle(world.page);
  pageTime.push(Date.now() - t);
  return world;
}

{
  console.log("  text contrast, every page at every viewport:");
  for (const kind of PAGE_KINDS) for (const vp of VIEWPORTS) {
    const { context, page, errors } = await open(kind, vp);
    const runs = await measureText(page);
    const tag = `${kind} ${vpTag(vp)}`;
    contrastChecks(runs, tag);
    const minimum = runs.reduce((m, r) => Math.min(m, r.ratio), 99);
    const worst = runs.reduce((w, r) => (r.ratio < w.ratio ? r : w), runs[0]);
    console.log(`    ${tag.padEnd(18)} ${String(runs.length).padStart(3)} runs, minimum ${minimum} (${worst.path.split(" > ").pop()} "${worst.text}" ${worst.size}px/${worst.weight})`);
    if (vp === XL || vp === L) {
      const side = await page.evaluate(() => {
        const s = document.querySelector(".fx-side");
        const c = getComputedStyle(s);
        const r = s.getBoundingClientRect();
        const brand = document.querySelector(".fx-side .ff-brand");
        const br = brand && brand.getBoundingClientRect();
        return { position: c.position, radius: parseFloat(c.borderTopLeftRadius), top: r.top, left: r.left, height: r.height, vh: innerHeight, blur: c.backdropFilter, bg: c.backgroundImage, brandShown: !!br && br.bottom <= innerHeight && br.height > 0 && getComputedStyle(brand).visibility === "visible" };
      });
      eq(side.position, "sticky", `${tag}: the sidebar is sticky in the grid`);
      ok(side.top === 10 && side.left === 10 && Math.abs(side.height - (side.vh - 20)) <= 1 && side.radius >= 20, `${tag}: the sidebar floats 10 px in from the top and the left, 20 px short of the viewport, with rounded corners (top ${side.top}, left ${side.left}, height ${side.height} of ${side.vh}, radius ${side.radius})`);
      ok(/blur\(24px\)/.test(side.blur) && /linear-gradient/.test(side.bg), `${tag}: the sidebar is glass: blurred backdrop and the sheen`);
      ok(side.brandShown, `${tag}: the brand mark stays inside the floating sidebar`);
    }
    if (vp === L) {
      const tile = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".ui-card, .ft-strip, .ft-rail, .ft-gchart")].filter((c) => !c.classList.contains("hm-hero")).filter((c) => { const r = c.getBoundingClientRect(); return r.width > 40 && r.height > 20 && getComputedStyle(c).visibility === "visible"; });
        const c = cards[0];
        if (!c) return null;
        const cs = getComputedStyle(c);
        const rim = getComputedStyle(c, "::before");
        return { n: cards.length, blur: cs.backdropFilter, bg: cs.backgroundImage, shadow: cs.boxShadow, rimBg: rim.backgroundImage, rimMask: rim.maskComposite || rim.webkitMaskComposite, rimPos: rim.position, rimEvents: rim.pointerEvents, rimContent: rim.content };
      });
      ok(tile && tile.n > 0, `${tag}: the page shows glass tiles (${tile && tile.n})`);
      ok(/blur\(24px\)/.test(tile.blur) && /saturate\(1\.8\)|saturate\(180%\)/.test(tile.blur), `${tag}: a tile blurs its backdrop at 24 px and saturate 180% (${tile.blur})`);
      ok(/linear-gradient/.test(tile.bg), `${tag}: a tile carries the top sheen`);
      ok((tile.shadow.match(/inset/g) || []).length >= 3 && /16px 40px -16px|40px -16px/.test(tile.shadow), `${tag}: a tile carries the inner edge, the caustic and the three-step lift (${tile.shadow.split("),").length} shadows)`);
      ok(tile.rimContent !== "none" && tile.rimPos === "absolute" && tile.rimEvents === "none" && /linear-gradient\(150deg/.test(tile.rimBg) && /exclude|xor/.test(tile.rimMask), `${tag}: the specular rim is a masked ring drawn by ::before (${tile.rimMask})`);
      const chrome = await page.evaluate(() => {
        const read = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { bg: c.backgroundColor, blur: c.backdropFilter, shadow: c.boxShadow }; };
        const root = getComputedStyle(document.documentElement);
        return { search: read(".fx-search"), ask: read(".ak-dock-tab"), fresh: read("#fxFresh"), seg: read(".ui-seg"), knob: read(".ui-seg-knob"), site: read(".fx-site"), siteNow: read(".fx-site a[aria-current]"), ctl: root.getPropertyValue("--glass-ctl").trim(), knobTok: root.getPropertyValue("--glass-knob").trim(), track: root.getPropertyValue("--glass-track").trim() };
      });
      const rgbaOf = (s) => s.replace(/\s+/g, "");
      for (const [name, c] of [["search", chrome.search], ["ask", chrome.ask], ["fresh", chrome.fresh]]) {
        if (!c) continue;
        ok(rgbaOf(c.bg) === rgbaOf(chrome.ctl) && /blur\(12px\)/.test(c.blur) && /inset/.test(c.shadow), `${tag}: the bar's ${name} control is a glass control (${c.bg}, ${c.blur})`);
      }
      const lens = await page.evaluate(() => ({ supports: CSS.supports("backdrop-filter", 'url("#fx-lens")'), token: getComputedStyle(document.documentElement).getPropertyValue("--glass-lens").trim(), surfaces: [document.querySelector(".ak-dock-head"), ...document.querySelectorAll(".ui-seg-knob")].map((e) => getComputedStyle(e).backdropFilter), filters: document.querySelectorAll("#fx-lens").length }));
      eq(lens.filters, 1, `${tag}: the page carries exactly one #fx-lens filter`);
      ok(lens.surfaces.length >= 1 && lens.surfaces.every((v) => (lens.supports ? /^url\("#fx-lens"\) blur\(12px\) saturate\((1\.6|160%)\)$/ : /^blur\(12px\) saturate\((1\.6|160%)\)$/).test(v)), `${tag}: the dock head and every segmented knob (${lens.surfaces.length}) carry --glass-lens: ${lens.supports ? "the lens, then blur 12 and saturate 160%" : "plain blur 12 and saturate 160%, the engine having no url() backdrop filter"} (${[...new Set(lens.surfaces)].join(" | ")})`);
      ok(chrome.site && chrome.siteNow, `${tag}: the sidebar has its site switcher with a current link`);
      ok(rgbaOf(chrome.site.bg) === rgbaOf(chrome.track) && /inset/.test(chrome.site.shadow), `${tag}: the sidebar's site switcher is the glass well of the segmented control (${chrome.site.bg})`);
      ok(rgbaOf(chrome.siteNow.bg) === rgbaOf(chrome.knobTok) && /inset/.test(chrome.siteNow.shadow), `${tag}: and its current link is the glass knob (${chrome.siteNow.bg})`);
      if (chrome.seg) {
        ok(rgbaOf(chrome.seg.bg) === rgbaOf(chrome.track) && /inset/.test(chrome.seg.shadow), `${tag}: the segmented track is the glass well (${chrome.seg.bg})`);
        ok(chrome.knob && rgbaOf(chrome.knob.bg) === rgbaOf(chrome.knobTok), `${tag}: the segmented knob is the glass knob (${chrome.knob && chrome.knob.bg})`);
      }
    }
    eq(errors, [], `${tag}: no page error`);
    await context.close();
  }
}

{
  console.log("  the material on the aurora pools (a glass tile with every budget ink on each pool centre):");
  for (const vp of VIEWPORTS) {
    const { context, page } = await open("home", vp);
    const material = await measureMaterial(page);
    const tiles = materialChecks(material, `material ${vpTag(vp)}`);
    const worst = (name) => material.runs.filter((r) => r.probeInk === name).reduce((m, r) => Math.min(m, r.ratio), 99);
    console.log(`    ${vpTag(vp).padEnd(10)} label-3 ${worst("label-3")}, down ${worst("down")}, accent ${worst("accent")}, ice ${worst("ice")}, num-down ${worst("num-down")}; pools ${tiles.map((t) => `${t.pool}: band rgb(${t.band.join(",")}) body rgb(${t.body.join(",")})`).join("; ")}`);
    await context.close();
  }
}

{
  console.log("  the fallbacks, every page at 1440x820:");
  for (const kind of PAGE_KINDS) {
    const { context, page, errors } = await open(kind, L);
    for (const mode of MODES.filter((m) => m !== "default")) {
      await applyMode(page, mode);
      const tag = `${kind} ${mode}`;
      const runs = await measureText(page);
      contrastChecks(runs, tag);
      if (mode === "reduced-transparency" || mode === "contrast-more") {
        const t = await page.evaluate((m) => {
          const root = getComputedStyle(document.documentElement);
          const card = document.querySelector(".ui-card, .ft-strip, .ft-gchart");
          const rim = card && getComputedStyle(card, "::before");
          return { matches: matchMedia(m === "reduced-transparency" ? "(prefers-reduced-transparency: reduce)" : "(prefers-contrast: more)").matches, aur: root.getPropertyValue("--aur-1").trim(), sheen: root.getPropertyValue("--glass-sheen").trim(), ctl: root.getPropertyValue("--glass-ctl").trim(), fill3: root.getPropertyValue("--fill-3").trim(), knob: root.getPropertyValue("--glass-knob").trim(), fill1: root.getPropertyValue("--fill-1").trim(), caustic: root.getPropertyValue("--glass-caustic").trim(), rimBg: rim ? rim.backgroundImage : null, blur: card ? getComputedStyle(card).backdropFilter : null, ground: root.getPropertyValue("--ground").trim(), lensToken: root.getPropertyValue("--glass-lens").trim(), lens: [document.querySelector(".ak-dock-head"), ...document.querySelectorAll(".ui-seg-knob")].map((e) => getComputedStyle(e).backdropFilter) };
        }, mode);
        ok(t.matches, `${tag}: the media feature is emulated`);
        eq(t.aur, "transparent", `${tag}: the aurora pools are transparent`);
        eq(t.sheen, "linear-gradient(transparent, transparent)", `${tag}: the sheen is flat`);
        eq(t.ctl, t.fill3, `${tag}: the bar controls fall back to --fill-3`);
        eq(t.knob, t.fill1, `${tag}: the knob falls back to --fill-1`);
        eq(t.caustic, "0 0 0 transparent", `${tag}: the caustic is off`);
        ok(t.rimBg && /^linear-gradient\(rgba\(255, 255, 255, 0\.24\), rgba\(255, 255, 255, 0\.24\)\)$/.test(t.rimBg), `${tag}: the rim is a solid --sep-strong line (${t.rimBg})`);
        eq(t.blur, "none", `${tag}: no backdrop blur`);
        eq([t.lensToken, ...new Set(t.lens)], ["none", "none"], `${tag}: the lens drops with the blur (the token and every refracting surface compute none)`);
        ok(!/radial-gradient/.test(t.ground), `${tag}: the ground is flat`);
        if (kind === "home") {
          const material = await measureMaterial(page);
          eq(low(material.runs), [], `${tag}: every budget ink clears its ratio on the opaque material`);
          const uneven = material.tiles.filter((x) => x.band.some((v, i) => Math.abs(v - x.body[i]) > 1)).map((x) => `pool ${x.pool} band rgb(${x.band.join(",")}) body rgb(${x.body.join(",")})`);
          eq(uneven, [], `${tag}: with the sheen flat the top band and the body of a tile paint the same pixels`);
        }
      }
      if (mode === "no-backdrop") {
        const t = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const card = document.querySelector(".ui-card.ui-mod") || document.querySelector(".ui-card, .ft-strip, .ft-gchart");
          return { reg: root.getPropertyValue("--mat-regular").trim(), solid: root.getPropertyValue("--glass-solid").trim(), side: root.getPropertyValue("--mat-side").trim(), chrome: root.getPropertyValue("--glass-solid-chrome").trim(), bg: card ? getComputedStyle(card).backgroundColor : null };
        });
        eq(t.reg, t.solid, `${tag}: --mat-regular is the opaque solid`);
        eq(t.side, t.chrome, `${tag}: --mat-side is the opaque chrome`);
        ok(/^rgb\(/.test(t.bg || ""), `${tag}: a tile paints an opaque colour (${t.bg})`);
        if (kind === "home") {
          const material = await measureMaterial(page);
          eq(low(material.runs), [], `${tag}: every budget ink clears its ratio on the solid material`);
        }
      }
      if (mode === "forced") {
        const t = await page.evaluate(() => {
          const probe = document.createElement("span");
          probe.style.color = "CanvasText"; probe.style.backgroundColor = "Highlight"; probe.textContent = "x";
          document.body.append(probe);
          const canvasText = getComputedStyle(probe).color, highlight = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const cards = [...document.querySelectorAll(".ui-card, .ft-strip, .ft-rail, .ft-gchart")].filter((c) => c.getBoundingClientRect().width > 0 && getComputedStyle(c).visibility === "visible");
          const rims = [...document.querySelectorAll(".ui-card, .ft-strip, .ft-rail, .ft-gchart")].map((c) => getComputedStyle(c, "::before").display);
          const knob = document.querySelector(".ui-seg-knob");
          const num = document.querySelector(".ui-num");
          return { matches: matchMedia("(forced-colors: active)").matches, canvasText, highlight, cards: cards.length, borders: cards.map((c) => { const s = getComputedStyle(c); return s.borderTopStyle + " " + s.borderTopWidth + " " + s.borderTopColor; }), rims, knob: knob ? getComputedStyle(knob).backgroundColor : null, numFill: num ? getComputedStyle(num).webkitTextFillColor : null, numBg: num ? getComputedStyle(num).backgroundImage : null, lensToken: getComputedStyle(document.documentElement).getPropertyValue("--glass-lens").trim(), lens: [document.querySelector(".ak-dock-head"), ...document.querySelectorAll(".ui-seg-knob")].map((e) => getComputedStyle(e).backdropFilter) };
        });
        ok(t.matches, `${tag}: forced colours are emulated`);
        ok(t.cards > 0, `${tag}: the page has tiles to check (${t.cards})`);
        eq([...new Set(t.borders)], [`solid 1px ${t.canvasText}`], `${tag}: every glass tile has a 1 px CanvasText border`);
        eq([...new Set(t.rims)], ["none"], `${tag}: every rim computes display: none`);
        eq([t.lensToken, ...new Set(t.lens)], ["none", "none"], `${tag}: the lens is dropped (the token and every refracting surface compute none)`);
        if (t.knob !== null) eq(t.knob, t.highlight, `${tag}: the selected segment is Highlight`);
        if (t.numFill !== null) ok(t.numFill === t.canvasText && t.numBg === "none", `${tag}: .ui-num paints CanvasText with no gradient`);
      }
      eq(errors, [], `${tag}: no page error`);
      await clearMode(page, mode);
    }
    await context.close();
  }
}

{
  console.log("  reduced motion: nothing of the material animates");
  const { context, page } = await open("long", L, { reduced: true });
  const anim = await page.evaluate(async () => {
    const seg = document.querySelector(".ui-seg-i:not([aria-selected='true'])");
    if (seg) { seg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); seg.click(); }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sel = ".ui-card, .ft-strip, .ft-rail, .ft-gchart, .ui-seg, .ui-seg-knob, .fx-side, .fx-search, .ak-dock-tab, #fxFresh";
    const targets = new Set(document.querySelectorAll(sel));
    const alive = document.getAnimations().filter((a) => a.effect && targets.has(a.effect.target));
    return { total: alive.length, names: alive.map((a) => (a.animationName || a.transitionProperty || "") + (a.effect.pseudoElement || "")), seg: !!seg };
  });
  eq(anim.total, 0, `reduced motion: no animation or transition runs on a glass tile, its rim, the segmented control and its knob, the sidebar or a bar control (${anim.names.join(", ")})`);
  await context.close();
}

const trial = async (name, run) => {
  let failed = null;
  try { await run(); } catch (error) { failed = String(error.message || error).split("\n")[0].slice(0, 160); }
  ok(failed !== null, `PLANTED WRONG BUILD "${name}" is caught`);
  console.log(`    ${name}: ${failed ? "caught (" + failed + ")" : "NOT CAUGHT"}`);
};

const LENS_SURFACES = [".ui-seg-knob", ".ak-dock-head", ".hm-pager button[aria-current]", ".hm-ask"];

async function lensChecks(page, tag) {
  const state = await page.evaluate(() => ({ supports: CSS.supports("backdrop-filter", 'url("#fx-lens")'), knob: getComputedStyle(document.querySelector(".ui-seg-knob")).backdropFilter, head: getComputedStyle(document.querySelector(".ak-dock-head")).backdropFilter }));
  const want = state.supports ? /^url\("#fx-lens"\) blur\(12px\) saturate\((1\.6|160%)\)$/ : /^blur\(12px\) saturate\((1\.6|160%)\)$/;
  for (const [name, v] of [["knob", state.knob], ["dock head", state.head]]) {
    ok(want.test(v), `${tag}: the ${name} computes ${state.supports ? "the lens, then blur 12 and saturate 160%" : "plain blur 12 and saturate 160%, the engine having no url() backdrop filter"} (${v})`);
  }
  if (!state.supports) {
    console.log(`    ${tag}: this engine does not parse backdrop-filter: url("#fx-lens"), so @supports keeps the plain blur and the lens is recorded as its fallback`);
    return { bends: false };
  }
  const probe = await measureLens(page, "probe");
  const moved = probe.lines.filter((l) => l.shift !== null && Math.abs(l.shift) >= 2);
  if (moved.length < 3) {
    console.log(`    ${tag}: a control filter moved ${moved.length} of ${probe.lines.length} probe lines, so this engine parses the lens and does not bend a backdrop with it: the lens is recorded as its fallback`);
    return { bends: false };
  }
  const knob = await measureLens(page, "knob");
  const edge = knob.lines.filter((l) => l.edge >= 4 && l.edge <= 12);
  const centre = knob.lines.filter((l) => l.mid <= knob.width * 0.2);
  ok(edge.length >= 1, `${tag}: the grid has a line within 12 px of the knob's rim (${edge.length})`);
  ok(centre.length >= 3, `${tag}: the grid has lines across the knob's middle (${centre.length})`);
  const rim = edge.map((l) => Math.abs(l.shift === null ? 0 : l.shift));
  const mid = centre.map((l) => Math.abs(l.shift === null ? 99 : l.shift));
  ok(Math.min(...rim) >= 2, `${tag}: every grid line within 12 px of the knob's rim moves at least 2 px (${edge.map((l) => l.shift).join(", ")})`);
  ok(Math.max(...mid) < 0.5, `${tag}: no grid line in the middle fifth either side of the knob's centre moves 0.5 px (${centre.map((l) => l.shift).join(", ")})`);
  return { bends: true, rim, mid };
}

let engineBends = null;

{
  console.log("  refraction on four surfaces:");
  const SHELL = /<body class="flows-body has-rail"/;
  const shells = [];
  for (const [name, fn] of Object.entries(PAGES.FLOWS_PAGES)) {
    if (typeof fn !== "function" || !/Page$/.test(name)) continue;
    const html = String(fn({ username: "tester", ticker: "AAPL", net: true, scenes: name === "tickerPage" }));
    const lens = (html.match(/id="fx-lens"/g) || []).length;
    const sprite = html.includes('id="g-home"');
    eq(lens, sprite ? 1 : 0, `${name}: #fx-lens is emitted once on a page with the glyph sprite and nowhere else`);
    if (sprite) {
      shells.push(name);
      ok(/<\/symbol><\/svg>\s*<svg class="ui-sprite"[^>]*><filter id="fx-lens"/.test(html), `${name}: the filter follows the glyph sprite directly`);
      ok(SHELL.test(html), `${name}: and sits in a shell page`);
    }
  }
  ok(shells.length >= 12, `the lens reached every shell page (${shells.length} pages)`);

  const html = PAGES.FLOWS_PAGES.sidePage({ username: "tester", side: "long" });
  const filter = /<filter id="fx-lens"([^>]*)>(.*?)<\/filter>/s.exec(html);
  ok(filter, "the page carries the filter");
  ok(/x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"/.test(filter[1]), "the filter region is the box plus 5% on every side, in sRGB so the map is not linearised");
  ok(/<feImage href="([^"]+)" preserveAspectRatio="none" result="m"\/>/.test(filter[2]), "the map is an feImage stretched with preserveAspectRatio none");
  eq(/<feImage href="([^"]+)"/.exec(filter[2])[1], PAGES.lensMap(), "the data URI is lensMap() and nothing else, so the test rebuilds what the page ships");
  ok(/<feDisplacementMap in="SourceGraphic" in2="m" scale="14" xChannelSelector="R" yChannelSelector="G"\/>/.test(filter[2]), "the displacement reads red for x and green for y at scale 14");
  const map = decodeURIComponent(PAGES.lensMap().slice("data:image/svg+xml,".length));
  eq([...map.matchAll(/stop-color="rgb\((\d+),(\d+),(\d+)\)"/g)].map((m) => [m[1], m[2], m[3]].join(",")), ["40,0,0", "128,0,0", "128,0,0", "216,0,0", "0,40,0", "0,128,0", "0,128,0", "0,216,0"], "the map is flat at 128 across the middle and runs to 40 and 216 at the rim, red along x and green along y");
  ok(/mix-blend-mode:screen/.test(map), "the two ramps are summed with screen, so each keeps its own channel");

  const csp = /"img-src ([^"]+)"/.exec(workerSource());
  ok(csp && /(^|\s)data:(\s|$)/.test(csp[1]), "the page's CSP lets img-src load a data: URI, which is how the lens's displacement map reaches feImage in production");
  const kitAt = CSS.indexOf(".ds-mod {");
  const first = CSS.slice(0, kitAt);
  ok(/\n  --glass-lens: blur\(12px\) saturate\(160%\);\n/.test(first), "outside the gate --glass-lens is the plain blur 12 and saturate 160% of the bar controls");
  ok(/@supports \(backdrop-filter: url\("#fx-lens"\)\) \{\n  :root \{ --glass-lens: url\("#fx-lens"\) blur\(12px\) saturate\(160%\); \}\n\}/.test(first), "the lens is let in by @supports on the property and its value, never by an engine test");
  const reduced = /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{[^@]*?\n\}/.exec(first);
  ok(reduced && /--glass-lens: none;/.test(reduced[0]), "reduced transparency and high contrast drop the lens in the block that drops the blur");
  ok(first.indexOf('@supports (backdrop-filter: url("#fx-lens"))') < first.indexOf("@media (prefers-reduced-transparency"), "the gate comes before the reduced-transparency block, so none wins");
  const forced = first.slice(first.lastIndexOf("@media (forced-colors: active)"));
  ok(/:root \{ --glass-lens: none; \}/.test(forced), "forced colours drop the lens");
  const users = [];
  const SHEETS = fs.readdirSync(path.join(ROOT, "assets/css")).filter((f) => f.endsWith(".css"));
  for (const f of SHEETS) {
    const text = fs.readFileSync(path.join(ROOT, "assets/css", f), "utf8");
    for (const m of text.matchAll(/([^{}]+)\{[^{}]*backdrop-filter: var\(--glass-lens\)[^{}]*\}/g)) users.push(...m[1].split(",").map((x) => x.trim()).filter(Boolean));
    if (f !== "flows.css") ok(!/#fx-lens/.test(text), `${f} names no lens filter`);
  }
  eq(users.filter((x) => !LENS_SURFACES.includes(x)), [], "only the four named surfaces take the lens (the knob, the dock head, the pager's selected button and the Neuron tile's pill)");
  ok(users.includes(".ui-seg-knob") && users.includes(".ak-dock-head"), "the knob and the dock head, the two that exist in this lane, take it");
  const writes = [...first.matchAll(/(?<=[;{]\s*)(-webkit-)?backdrop-filter: var\(--glass-lens\)/g)].length;
  eq(writes, 4, "each of the two surfaces writes the -webkit- pair and the standard property, and nothing else");

  {
    const { context, page } = await openLensRig(browser);
    const result = await lensChecks(page, "lens rig");
    engineBends = result.bends;
    if (result.bends) console.log(`    lens rig: rim lines moved ${result.rim.join(", ")} px, middle lines ${result.mid.join(", ")} px`);
    await context.close();
  }
  for (const mode of ["reduced-transparency", "contrast-more", "forced"]) {
    const { context, page } = await openLensRig(browser);
    await applyMode(page, mode);
    const v = await page.evaluate(() => ({ token: getComputedStyle(document.documentElement).getPropertyValue("--glass-lens").trim(), knob: getComputedStyle(document.querySelector(".ui-seg-knob")).backdropFilter, head: getComputedStyle(document.querySelector(".ak-dock-head")).backdropFilter }));
    eq([v.token, v.knob, v.head], ["none", "none", "none"], `lens rig ${mode}: the token, the knob and the dock head compute none`);
    await context.close();
  }
}

{
  console.log("  scroll containers carry no rim:");
  const names = Object.keys(PAGES.FLOWS_PAGES).filter((n) => /Page$/.test(n) && typeof PAGES.FLOWS_PAGES[n] === "function" && String(PAGES.FLOWS_PAGES[n]({ username: "tester", ticker: "AAPL", net: true })).includes('id="g-home"'));
  ok(names.length >= 12, `every shell page is swept (${names.length})`);
  for (const name of names) {
    const { context, page } = await openStaticShell(browser, name);
    try {
      eq(await page.evaluate(scrollRims), [], `${name}: no tile that scrolls draws a rim`);
    } finally { await context.close(); }
  }
}

{
  console.log("  planted wrong builds (each must fail the checks above):");
  for (const name of ["label-3 back at 0.52 with the sheen at 0.065", "mat-regular alpha 0.50", "aurora alphas doubled", "a sheen of 0.08 reaching 60%"]) {
    await trial(name, async () => {
      const { context, page } = await open("home", XL, { patch: patchOf(name) });
      try {
        const material = await measureMaterial(page);
        const over = material.tiles.filter((t) => t.pool === BLUE_POOL && (!within(t.band, BAND_BUDGET) || !within(t.body, BODY_BUDGET))).map((t) => `pool ${t.pool} band rgb(${t.band.join(",")}) body rgb(${t.body.join(",")})`);
        assert.deepEqual(low(material.runs).concat(over), [], "contrast and budget");
        assert.deepEqual(low(await measureText(page)), [], "contrast and budget");
      } finally { await context.close(); }
    });
  }
  await trial("the reduced-transparency additions deleted", async () => {
    const { context, page } = await open("home", L, { patch: patchOf("the reduced-transparency additions deleted") });
    try {
      await applyMode(page, "reduced-transparency");
      const t = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--aur-1").trim());
      const material = await measureMaterial(page);
      const uneven = material.tiles.filter((x) => x.band.some((v, i) => Math.abs(v - x.body[i]) > 1));
      assert.ok(t === "transparent" && uneven.length === 0, `aurora ${t}, uneven tiles ${uneven.length}`);
    } finally { await context.close(); }
  });
  await trial("the rim visible under forced colours", async () => {
    const { context, page } = await open("long", L, { patch: patchOf("the rim visible under forced colours") });
    try {
      await applyMode(page, "forced");
      const rims = await page.evaluate(() => [...document.querySelectorAll(".ui-card, .ft-strip, .ft-rail, .ft-gchart")].map((c) => getComputedStyle(c, "::before").display));
      assert.deepEqual([...new Set(rims)], ["none"], "rims");
    } finally { await context.close(); }
  });
  const lensM = lensMutants(PAGES.lensMap);
  for (const [name, opts] of Object.entries(lensM)) {
    const gate = /reduced|forced/.test(name);
    if (!gate && !engineBends) {
      checks++;
      console.log(`    ${name}: not run, this engine does not bend a backdrop with the lens`);
      continue;
    }
    await trial(name, async () => {
      const { context, page } = await openLensRig(browser, opts);
      try {
        if (gate) {
          await applyMode(page, /forced/.test(name) ? "forced" : "reduced-transparency");
          const v = await page.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue("--glass-lens").trim(), getComputedStyle(document.querySelector(".ui-seg-knob")).backdropFilter]);
          assert.deepEqual(v, ["none", "none"], "the lens is dropped");
        } else {
          const r = await lensChecks(page, "planted lens");
          assert.ok(r.bends, "the lens bends the backdrop");
        }
      } finally { await context.close(); }
    });
  }
  eq(Object.keys(MUTANTS).length + Object.keys(lensM).length + 1, 14, "fourteen planted wrong builds are declared and each was run");
}

{
  const kitAt = CSS.indexOf(".ds-mod {");
  const forcedBlock = CSS.slice(CSS.lastIndexOf("@media (forced-colors: active)", kitAt), kitAt);
  ok(/\.ui-card::before, \.ft-strip::before, \.ft-rail::before, \.ft-gchart::before \{ display: none; \}/.test(forcedBlock), "the forced-colours block hides the four rims");
  ok(/\.ui-num \{ background: none; -webkit-text-fill-color: CanvasText; \}/.test(forcedBlock), "and paints .ui-num in CanvasText");
  const first = CSS.slice(0, CSS.indexOf(".ds-mod {"));
  ok(/-webkit-mask: linear-gradient\(var\(--mask-on\) 0 0\) content-box, linear-gradient\(var\(--mask-on\) 0 0\);\n\s*-webkit-mask-composite: xor;\n\s*mask: /.test(first), "the rim writes -webkit-mask and -webkit-mask-composite before mask and mask-composite, the Safari 17 order");
  ok(!/@property/.test(CSS), "no @property");
  const keyframes = [...CSS.matchAll(/@keyframes [^{]+\{[^@]*?\n\}/g)].map((m) => m[0]);
  ok(!keyframes.some((k) => /linear\(/.test(k)), "no linear() inside a keyframe");
  const pairs = [...CSS.matchAll(/(?<=[;{]\s*)backdrop-filter: ([^;}]+)/g)];
  ok(pairs.length >= 12, `the stylesheet declares backdrop-filter in ${pairs.length} places`);
  for (const m of pairs) {
    const before = CSS.slice(Math.max(0, m.index - 200), m.index);
    ok(before.includes("-webkit-backdrop-filter: " + m[1].trim()), `backdrop-filter: ${m[1].trim()} is paired with -webkit-backdrop-filter before it`);
  }
}

await browser.close();
const ms = Date.now() - t0;
console.log(`✓ flows-glass-render: ${checks} assertions — Home, the long board, Market and the ticker at 1920x1080, 1440x820 and 390x844 from fixtures with no server: every visible text run measured against the brightest pixel under it with the ink made transparent, the material probed with every budget ink on the aurora pools, the floating sidebar, the tile layers, the bar controls and the segmented knob, the three fallbacks and forced colours, reduced motion, the lens that refracts four surfaces behind @supports, measured on a hairline grid, and fourteen planted wrong builds each caught; ${Math.round(ms / 1000)} s, ${Math.round(pageTime.reduce((a, b) => a + b, 0) / pageTime.length)} ms a page`);
