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
const LIVE = ':is([data-state="live"], [data-state="fresh"], [data-state="closed"])';

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

const run = async (browser, variant = {}) => {
  const fails = [];
  const need = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
  const pages = pagesFor(variant);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  let current = "member";
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (u.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: "" });
      if (u.pathname.endsWith("/flows.css") && variant.css) return route.fulfill({ contentType: "text/css", body: variant.css(fs.readFileSync(f, "utf8")) });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === "/page") return route.fulfill({ contentType: "text/html; charset=utf-8", body: pages[current] });
    return route.fulfill({ status: 404, body: "" });
  });
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
  need(m && m.anim === "ff-breathe", "breathes while the freshness pill is live");

  for (const st of ["fresh", "closed"]) {
    await open("member", 1440, 820, { state: st });
    need((await brand()).anim === "ff-breathe", "breathes when " + st);
  }
  for (const st of ["stale", "pending", "unavailable"]) {
    await open("member", 1440, 820, { state: st });
    need((await brand()).anim === "none", "still when " + st);
  }
  await open("member", 1440, 820, { state: "live", reduced: true });
  need((await brand()).anim === "none", "static under reduced motion");
  await open("member", 1440, 820, { state: "live", forced: true });
  need((await brand()).fill !== "rgb(217, 116, 27)", "forced colors drop the orange");

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
  "animates while stale": { css: (s) => s.replaceAll(LIVE, "") },
  "ignores reduced motion": { css: (s) => s.replace("@media (prefers-reduced-motion: no-preference) {\n  body:has(#fxFresh", "@media all {\n  body:has(#fxFresh") },
  "no forced-colors rule": { css: (s) => s.replace(".ff-core { fill: CanvasText; }", "") },
  "animates only when stale": { css: (s) => s.replaceAll(LIVE, '[data-state="stale"]') },
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
} finally { await browser.close(); }
console.log(`${checks} checks`);
process.exit(bad ? 1 : 0);
