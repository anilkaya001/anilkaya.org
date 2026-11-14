import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FLOWS_PAGES, ownerNav, brandMark } from "../shared/flows-pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://brand.test";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const SHOTS = process.env.BRAND_SHOTS || "";
const STOP = ["faster", "fastest", "best", "guarantee", "guaranteed", "never wrong", "outperform", "returns", "alpha"];
const MARK = "Fire & Forget";
const ORANGE = "rgb(217, 116, 27)";
const REAL = new Set(["/assets/js/flows-ui.js", "/assets/js/flows-fresh.js"]);
const CLOCK0 = Date.parse("2026-11-13T15:00:00Z");
const MOTION = /^(?:ff-|fx-beat)/;

let checks = 0;

const pagesFor = (variant) => {
  const member = FLOWS_PAGES.overviewPage({ username: "member" });
  const pages = {
    member,
    owner: ownerNav(member),
    status: FLOWS_PAGES.statusPage({ username: "owner" }),
    about: FLOWS_PAGES.aboutPage(),
  };
  if (variant.pages) for (const k of Object.keys(pages)) pages[k] = variant.pages(pages[k], k);
  return pages;
};

const serve = (variant, pages, key, real) => async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/assets/")) {
    const f = path.join(ROOT, u.pathname);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    if (u.pathname.endsWith(".js")) {
      if (!real || !REAL.has(u.pathname)) return route.fulfill({ contentType: "text/javascript", body: "" });
      const src = fs.readFileSync(f, "utf8");
      return route.fulfill({ contentType: "text/javascript", body: variant.js ? variant.js(src, u.pathname) : src });
    }
    if (u.pathname.endsWith("/flows.css") && variant.css) return route.fulfill({ contentType: "text/css", body: variant.css(fs.readFileSync(f, "utf8")) });
    return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
  }
  if (u.pathname === "/page") return route.fulfill({ contentType: "text/html; charset=utf-8", body: pages[key()] });
  return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
};

const beats = async (browser, variant, pages, need, opts = {}) => {
  const tag = opts.reduced ? " (reduced motion)" : "";
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 }, reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", serve(variant, pages, () => "member", true));
  await page.clock.install({ time: CLOCK0 });
  await page.clock.pauseAt(CLOCK0 + 1000);
  await page.goto(ORIGIN + "/page");
  await page.waitForFunction(() => window.FlowsUI && typeof window.FlowsUI.freshness === "function" && typeof window.FlowsUI.freshFrom === "function");
  const look = () => page.evaluate((re) => {
    const rx = new RegExp(re);
    const fx = document.getElementById("fxFresh");
    const anims = document.getAnimations().filter((a) => rx.test(a.animationName || ""));
    return {
      beat: fx.dataset.beat || null, state: fx.dataset.state, pulse: window.FlowsUI.freshness.pulse(),
      running: anims.filter((a) => a.playState === "running").map((a) => a.animationName),
      once: anims.every((a) => a.effect.getTiming().iterations === 1),
      core: getComputedStyle(document.querySelector(".fx-side .ff-core") || document.querySelector(".ff-core")).fill,
    };
  }, MOTION.source);
  const call = (o) => page.evaluate((x) => {
    const UI = window.FlowsUI;
    const exp = UI.freshness.market().expected;
    const arg = { source: x.source };
    if (x.updatedAt !== undefined) { arg.sessionDate = exp; arg.updatedAt = x.updatedAt; }
    if (x.ff) arg.ff = UI.freshFrom({ state: x.ff.state, updatedAt: x.ff.updatedAt, staleAt: x.ff.staleAt, readAt: x.ff.readAt }, { serverNow: Date.now() });
    return UI.freshness(arg);
  }, o);
  const settle = async () => {
    await Promise.race([page.evaluate((re) => Promise.all(document.getAnimations().filter((a) => new RegExp(re).test(a.animationName || "") && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => 0))), MOTION.source).catch(() => 0), new Promise((r) => setTimeout(r, 3000))]);
  };

  const st0 = await call({ source: "board", updatedAt: 1000 });
  need(["live", "fresh", "closed"].includes(st0), "the pill reads a breathing state after the first write" + tag + " (" + st0 + ")");
  let v = await look();
  need(v.beat === null && v.pulse.beats === 0, "the first sight of a key is not a beat" + tag);
  need(v.running.length === 0, "nothing moves after the first sight" + tag);
  for (let i = 0; i < 6; i++) await page.clock.runFor(10 * 60 * 1000);
  v = await look();
  need(v.beat === null && v.pulse.beats === 0, "an hour on a paused clock with no new stamp fires no beat" + tag);
  need(v.running.length === 0, "an hour with no new stamp moves nothing" + tag);
  await call({ source: "board", updatedAt: 1000 });
  await call({ source: "board", updatedAt: 900 });
  await call({ source: "other", updatedAt: 5000 });
  v = await look();
  need(v.beat === null && v.pulse.beats === 0, "a re-read, an older stamp and another key's first sight fire no beat" + tag);

  await call({ source: "board", updatedAt: 2000 });
  v = await look();
  need(v.beat === "a" && v.pulse.beats === 1 && v.pulse.source === "board", "a new stamp fires exactly one beat" + tag);
  need(v.pulse.beatAt === CLOCK0 + 1000 + 60 * 60 * 1000, "the beat is stamped at the read" + tag);
  need(v.once, "every beat animation runs once" + tag);
  if (opts.reduced) need(v.running.length === 0, "under reduced motion a beat is a static state" + tag);
  else need(v.running.includes("ff-beat-a") && v.running.includes("fx-beat-a"), "the flame and the pill beat on a new stamp" + tag);
  await settle();
  for (let i = 0; i < 6; i++) await page.clock.runFor(10 * 60 * 1000);
  v = await look();
  need(v.running.length === 0 && v.pulse.beats === 1 && v.beat === "a", "after the beat everything rests and no beat follows" + tag);

  await call({ source: "strips", ff: { state: "fresh", updatedAt: 7000, staleAt: CLOCK0 + 864e5 } });
  v = await look();
  need(v.pulse.beats === 1, "a heartbeat entry's first sight is not a beat" + tag);
  await call({ source: "strips", ff: { state: "fresh", updatedAt: 8000, staleAt: CLOCK0 + 864e5 } });
  v = await look();
  need(v.pulse.beats === 2 && v.beat === "b" && v.pulse.source === "strips", "a heartbeat entry whose write advanced beats once" + tag);
  if (!opts.reduced) need(v.running.includes("ff-beat-b"), "the second beat restarts the flame" + tag);
  await settle();
  const said = await page.evaluate(() => (window.FlowsUI.freshness.details().facts.find((f) => f[0] === "Pulse") || [])[1] || "");
  need(/^Last beat \d\d:\d\d TRT: a new write of Live prices was read\.$/.test(said), "the details name the last beat in TRT and its key" + tag + " (" + said + ")");

  await call({ source: "dead", ff: { state: "stale" } });
  v = await look();
  need(v.state === "stale", "a stale source turns the pill stale" + tag);
  need(v.core !== ORANGE, "a stale pill puts the flame out" + tag);
  await call({ source: "board", updatedAt: 3000 });
  v = await look();
  need(v.pulse.beats === 2 && v.beat === "b" && v.running.length === 0, "a new stamp while stale is not a beat" + tag);
  const why = await page.evaluate(() => (window.FlowsUI.freshness.details().facts.find((f) => f[0] === "Pulse") || [])[1] || "");
  need(/^Not breathing: /.test(why), "a stale pill says why it is not breathing" + tag + " (" + why + ")");
  need(!/\b(?:ET|EST|EDT|UTC|GMT)\b/.test(said + why), "the pulse names TRT only" + tag);
  need(errors.length === 0, "no page error" + tag + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
};

const once = (src, x, y) => {
  if (src.split(x).length !== 2) throw new Error("anchor not found exactly once: " + x.slice(0, 60));
  return src.replace(x, y);
};

const run = async (browser, variant = {}) => {
  const fails = [];
  const need = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
  const pages = pagesFor(variant);
  if (variant.real) {
    await beats(browser, variant, pages, need);
    await beats(browser, variant, pages, need, { reduced: true });
    return fails;
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  let current = "member";
  await page.route("**/*", serve(variant, pages, () => current, false));
  const open = async (key, w = 1440, h = 820, opts = {}) => {
    current = key;
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ reducedMotion: opts.reduced ? "reduce" : "no-preference", colorScheme: opts.dark ? "dark" : "light", forcedColors: opts.forced ? "active" : "none" });
    await page.goto(ORIGIN + "/page");
    if (opts.state) {
      await page.evaluate((s) => {
        let el = document.getElementById("fxFresh");
        if (!el) { el = document.createElement("button"); el.id = "fxFresh"; document.body.append(el); }
        el.dataset.state = s;
      }, opts.state);
    }
  };
  const brand = (sel = ".ff-brand") => page.evaluate((q) => {
    const el = document.querySelector(q);
    if (!el) return null;
    const cs = getComputedStyle(el.querySelector(".ff-core"));
    const r = el.getBoundingClientRect();
    const w = el.querySelector(".ff-word");
    return {
      href: el.getAttribute("href"), label: el.getAttribute("aria-label"), text: w.textContent.replace(/\s+/g, " ").trim(),
      anim: cs.animationName, fill: cs.fill, w: r.width, h: r.height, tag: el.tagName, sup: !!w.querySelector("sup"),
      glyphHidden: el.querySelector(".ff-glyph").getAttribute("aria-hidden"),
    };
  }, sel);

  await open("member", 1440, 820, { state: "live" });
  const m = await brand();
  need(m && m.tag === "A", "member sidebar brand is a link");
  need(m && m.href === "/flows/about/", "member link goes to About");
  need(m && m.text === MARK + "™", "wordmark text is Fire & Forget with a trade-mark sign");
  need(m && m.sup, "trade-mark sign is superscript");
  need(m && m.label && m.label.startsWith(MARK) && /Read about it/.test(m.label), "accessible name leads with the visible words");
  need(m && m.glyphHidden === "true", "glyph is hidden from assistive tech");
  need(m && m.anim === "none", "at rest the mark is still while the pill is live");
  need(m && m.fill === ORANGE, "a live pill keeps the flame orange");

  for (const st of ["fresh", "closed"]) {
    await open("member", 1440, 820, { state: st });
    const b = await brand();
    need(b.anim === "none" && b.fill === ORANGE, "still and lit at rest when " + st);
  }
  for (const st of ["stale", "pending"]) {
    await open("member", 1440, 820, { state: st });
    const b = await brand();
    need(b.anim === "none", "still when " + st);
    need(b.fill !== ORANGE, "the flame is visibly out when " + st);
  }
  for (const beat of ["a", "b"]) {
    await open("member", 1440, 820, { state: "live" });
    await page.evaluate((v) => { document.getElementById("fxFresh").dataset.beat = v; }, beat);
    const b = await brand();
    need(b.anim === "ff-beat-" + beat, "a beat " + beat + " runs on the flame");
    need(await page.evaluate(() => getComputedStyle(document.getElementById("fxFresh")).animationName) === "fx-beat-" + beat, "a beat " + beat + " runs on the pill");
    need(await page.evaluate(() => document.getAnimations().filter((a) => /^(?:ff-|fx-beat)/.test(a.animationName || "")).every((a) => a.effect.getTiming().iterations === 1)), "a beat " + beat + " runs once");
  }
  await open("member", 1440, 820, { state: "live", reduced: true });
  await page.evaluate(() => { document.getElementById("fxFresh").dataset.beat = "a"; });
  need((await brand()).anim === "none", "a beat is static under reduced motion");
  need(await page.evaluate(() => getComputedStyle(document.getElementById("fxFresh")).animationName) === "none", "the pill does not ring under reduced motion");
  await open("member", 1440, 820, { state: "live", forced: true });
  need((await brand()).fill !== ORANGE, "forced colors drop the orange");

  await open("owner", 1440, 820, { state: "live" });
  const o = await brand();
  need(o && o.href === "/flows/status/#view=coverage", "owner link goes to coverage");
  need(o && /Open data coverage/.test(o.label), "owner name says coverage");

  await open("status", 1440, 820, { state: "live" });
  const sts = await page.evaluate(() => [...document.querySelectorAll(".ff-brand")].map((e) => ({ inTitle: !!e.closest(".st-title"), href: e.getAttribute("href") })));
  need(sts.some((x) => x.inTitle), "status header carries the mark");
  need(sts.some((x) => x.href === "/flows/status/#view=coverage"), "status sidebar links to coverage");

  await open("about", 1440, 820);
  const ab = await page.evaluate(() => ({
    head: !!document.querySelector(".fx-doc-h .ff-brand"),
    para: document.querySelector("#aFire")?.parentElement.innerText || "",
    anim: getComputedStyle(document.querySelector(".ff-core")).animationName,
  }));
  need(ab.head, "About header carries the mark");
  need(/Fire & Forget™/.test(ab.para) && /does not promise/.test(ab.para), "About paragraph states what it does not promise");
  need(!STOP.some((w) => ab.para.toLowerCase().includes(w)) && !/\d\s?%/.test(ab.para), "About paragraph makes no performance claim");
  need(ab.anim === "none", "About page has no pill, so the mark is still");

  if (!variant.name) {
    await beats(browser, variant, pages, need);
    await beats(browser, variant, pages, need, { reduced: true });
  }

  for (const w of [320, 390, 768, 1440]) {
    for (const key of ["about", "status"]) {
      await open(key, w, w < 700 ? 844 : 820, { state: "live" });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      need(sw <= 0, `${key} has no sideways scroll at ${w}`);
      const b = await brand(".fx-doc-h .ff-brand, .st-title .ff-brand");
      need(b && b.w > 40 && b.h >= 14, `${key} mark has size at ${w}`);
      if (SHOTS && !variant.name) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${key}-${w}.png`) });
      }
    }
  }
  for (const dark of [false, true]) {
    await open("member", 1440, 820, { state: "live", dark });
    const ratio = await page.evaluate(() => {
      const el = document.querySelector(".ff-brand");
      const parse = (c) => { const n = c.match(/[\d.]+/g).map(Number); return { r: n[0], g: n[1], b: n[2], a: n[3] === undefined ? 1 : n[3] }; };
      let bg = { r: 255, g: 255, b: 255 };
      const stack = [];
      for (let n = el; n; n = n.parentElement) stack.push(getComputedStyle(n).backgroundColor);
      for (const c of stack.reverse()) {
        const p = parse(c);
        if (p.a > 0) bg = { r: p.r * p.a + bg.r * (1 - p.a), g: p.g * p.a + bg.g * (1 - p.a), b: p.b * p.a + bg.b * (1 - p.a) };
      }
      const f = parse(getComputedStyle(el).color);
      const fg = { r: f.r * f.a + bg.r * (1 - f.a), g: f.g * f.a + bg.g * (1 - f.a), b: f.b * f.a + bg.b * (1 - f.a) };
      const L = (c) => {
        const t = [c.r, c.g, c.b].map((x) => { const y = x / 255; return y <= 0.03928 ? y / 12.92 : ((y + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
      };
      const a = L(fg);
      const b = L(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    need(ratio >= 4.5, `wordmark contrast ${ratio.toFixed(2)} in ${dark ? "dark" : "light"}`);
    if (SHOTS && !variant.name) await page.screenshot({ path: path.join(SHOTS, `member-${dark ? "dark" : "light"}.png`) });
  }
  await ctx.close();
  return fails;
};

const MUTANTS = {
  "timer-driven beat": { real: true, js: (s, p) => (p.endsWith("/flows-ui.js") ? once(s, "  function pulse(src) {\n", "  setInterval(() => pulse(\"timer\"), 5e3);\n  function pulse(src) {\n") : s) },
  "beat on first sight": { real: true, js: (s, p) => (p.endsWith("/flows-ui.js") ? once(s, "    return prev !== undefined;\n", "    return true;\n") : s) },
  "beat on a re-read": { real: true, js: (s, p) => (p.endsWith("/flows-ui.js") ? once(s, "if (prev !== undefined && stamp <= prev) return false;", "if (prev !== undefined && stamp < prev) return false;") : s) },
  "beat while stale": { real: true, js: (s, p) => (p.endsWith("/flows-ui.js") ? once(s, "    if (!BEATS.has(freshState().state)) return;\n", "") : s) },
  "beat never drawn": { real: true, js: (s, p) => (p.endsWith("/flows-ui.js") ? once(s, '    if (b) b.dataset.beat = FRESH.beats % 2 ? "a" : "b";\n', "") : s) },
  "breathes forever": { css: (s) => once(s, "ff-beat-a 1.2s ease-out 1;", "ff-beat-a 1.2s ease-out infinite;") },
  "breathes at rest on a live pill": { css: (s) => s + '\nbody:has(#fxFresh[data-state="live"]) .ff-core { animation: ff-beat-a 3.2s ease-in-out infinite; }\n' },
  "stale flame stays lit": { css: (s) => once(s, 'body:has(#fxFresh:is([data-state="stale"], [data-state="pending"])) .ff-core { fill: var(--label-3); }\n', "") },
  "ignores reduced motion": { css: (s) => once(s, '@media (prefers-reduced-motion: no-preference) {\n  body:has(#fxFresh[data-beat="a"])', '@media all {\n  body:has(#fxFresh[data-beat="a"])') },
  "no forced-colors rule": { css: (s) => s.replace(".ff-core { fill: CanvasText; }", "") },
  "owner gets the member link": { pages: (h, k) => (k === "owner" ? h.replace('href="/flows/status/#view=coverage"', 'href="/flows/about/"').replace("Open data coverage", "Read about it") : h) },
  "trade-mark sign dropped": { pages: (h) => h.replaceAll("<sup>&#8482;</sup>", "") },
  "accessible name loses the words": { pages: (h) => h.replaceAll('aria-label="Fire &amp; Forget. ', 'aria-label="Pipeline. ') },
  "glyph exposed": { pages: (h) => h.replaceAll('viewBox="0 0 16 16" aria-hidden="true"', 'viewBox="0 0 16 16"') },
  "about promises performance": { pages: (h, k) => (k === "about" ? h.replace("does not promise", "does not promise, but gives the best returns, and") : h) },
  "status header missing": { pages: (h, k) => (k === "status" ? h.replace(/(<h1 id="fxTitle">Status<\/h1>\s*)<span class="ff-brand">.*?<\/span><\/span>/s, "$1") : h) },
  "wordmark too faint": { css: (s) => s.replace("  color: var(--label-3);\n  font: 600 12px / 1.2", "  color: rgba(128, 128, 128, 0.4);\n  font: 600 12px / 1.2") },
};

const browser = await chromium.launch();
let bad = 0;
try {
  const base = await run(browser);
  if (base.length) { console.log("FAIL correct build:\n  " + base.join("\n  ")); bad++; } else console.log("ok correct build");
  for (const [name, v] of Object.entries(MUTANTS)) {
    const f = await run(browser, { ...v, name });
    if (f.length) console.log("ok planted fails: " + name);
    else { console.log("FAIL planted passes: " + name); bad++; }
  }
  if (!brandMark(null).includes("ff-brand") || brandMark(null).includes("<a ")) { console.log("FAIL static brand markup"); bad++; }
  let pills = 0;
  for (const [name, f] of Object.entries(FLOWS_PAGES)) {
    if (typeof f !== "function") continue;
    let html;
    try { html = f({ username: "member" }); } catch { continue; }
    if (typeof html !== "string" || !html.includes('id="fxFresh"')) continue;
    pills++;
    checks++;
    if (!/\/assets\/css\/flows\.css\?v=/.test(html) || !/\/assets\/js\/flows-ui\.js\?v=/.test(html) || !html.includes("ff-brand")) { console.log("FAIL " + name + " has a pill without the pulse"); bad++; }
  }
  checks++;
  if (pills < 15) { console.log("FAIL only " + pills + " pages with a pill were checked"); bad++; } else console.log("ok " + pills + " pages with a pill carry the pulse");
} finally { await browser.close(); }
console.log(`${checks} checks`);
process.exit(bad ? 1 : 0);
