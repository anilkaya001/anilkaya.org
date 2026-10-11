import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const MARKET = PAGES.marketPage({ username: "test" });
const TICKER = PAGES.tickerPage({ username: "test" });
const KEEP = new Set(["flows-index.js"]);

async function mount(page, html, route) {
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      if (f.endsWith(".js") && !KEEP.has(path.basename(f))) return r.fulfill({ contentType: "text/javascript", body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://example.test" + route);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.addStyleTag({ content: ".ui-mod { min-height: 320px; }" });
  page._errors = errors;
}

const chips = (page) => page.evaluate(() => Array.from(document.querySelectorAll("#fxIndex a"), (a) => ({
  href: a.getAttribute("href"), text: a.textContent, current: a.getAttribute("aria-current") })));

const settle = async (page, ms = 320) => {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => new Promise((res) => { const y = scrollY; requestAnimationFrame(() => requestAnimationFrame(() => res(y === scrollY))); }), null, { timeout: 5000 });
  await page.waitForTimeout(120);
};

const browser = await chromium.launch();

for (const [name, html] of [["market", MARKET], ["ticker", TICKER]]) {
  ok(/<nav class="fx-index" id="fxIndex" aria-label="On this page" hidden><\/nav>/.test(html), `${name} ships the empty, hidden index in its HTML`);
  ok(html.indexOf('id="fxIndex"') < html.indexOf(name === "market" ? 'class="ui-grid mk-grid"' : 'id="ftGrid"'), `${name} places it above the modules it indexes`);
  ok(/<script src="\/assets\/js\/flows-index\.js\?v=\d+" defer><\/script>/.test(html), `${name} loads the index script deferred`);
  ok(html.includes("/assets/css/flows-index.css?v="), `${name} loads the index sheet`);
}
for (const [name, fn] of Object.entries(PAGES)) {
  if (!/Page$/.test(name) || ["marketPage", "tickerPage"].includes(name) || typeof fn !== "function") continue;
  const html = String(fn({ username: "test", ticker: "AAPL" }));
  ok(!html.includes("fxIndex") && !html.includes("flows-index"), `${name} carries no index`);
}
{
  const src = fs.readFileSync(path.join(ROOT, "assets/js/flows-index.js"), "utf8");
  ok(!/innerHTML|insertAdjacentHTML|eval\(|document\.write/.test(src), "the index script writes text and attributes only");
  ok(fs.statSync(path.join(ROOT, "assets/js/flows-index.js")).size < 2700, "and stays under 2.7 KB raw");
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await mount(page, MARKET, "/flows/market/");
  await settle(page);
  const expected = await page.evaluate(() => Array.from(document.querySelectorAll("#flowsMain .ui-mod[id]"), (s) => {
    const t = s.querySelector(".ui-mod-t");
    return { id: s.id, text: t.textContent.trim() };
  }));
  ok(expected.length >= 20, `the market page has its modules (${expected.length})`);
  const got = await chips(page);
  eq(got.map((c) => c.href), expected.map((e) => "#" + e.id), "a chip for every module, in page order, each pointing at its id");
  eq(got.map((c) => c.text), expected.map((e) => e.text), "named by the module's own title");
  ok(await page.evaluate(() => !document.getElementById("fxIndex").hidden), "the index is shown");
  ok(await page.evaluate(() => document.getElementById("fxIndex").getAttribute("aria-label") === "On this page"), "and named for assistive technology");

  const pos = await page.evaluate(() => {
    const n = document.getElementById("fxIndex");
    const before = n.getBoundingClientRect().top;
    window.scrollTo({ top: 900, behavior: "instant" });
    return { before };
  });
  await settle(page, 200);
  ok(await page.evaluate(() => scrollY) > 0, "the page scrolls");
  const stuck = await page.evaluate(() => {
    const r = document.getElementById("fxIndex").getBoundingClientRect();
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 56;
    return { top: Math.round(r.top), bar, bottom: Math.round(r.bottom) };
  });
  eq(stuck.top, stuck.bar, "scrolled away from its slot the index sticks directly under the bar");

  const target = expected.find((e) => e.text === "Volatility");
  await page.click(`#fxIndex a[href="#${target.id}"]`);
  await settle(page, 400);
  const landed = await page.evaluate((id) => {
    const nav = document.getElementById("fxIndex").getBoundingClientRect();
    const sec = document.getElementById(id).getBoundingClientRect();
    return { navBottom: Math.round(nav.bottom), top: Math.round(sec.top) };
  }, target.id);
  ok(landed.top >= landed.navBottom - 1, `a jump lands the module below the sticky index, not under it (${landed.top} against ${landed.navBottom})`);
  const after = await chips(page);
  const lit = after.filter((c) => c.current);
  eq(lit.map((c) => c.text), ["Volatility"], "and exactly that chip is marked as the current location");
  eq(lit[0].current, "location", "with aria-current=location");

  const third = expected.find((e) => e.text === "Expiry");
  await page.evaluate((id) => { location.hash = "#" + id; }, third.id);
  await settle(page, 400);
  eq((await chips(page)).filter((c) => c.current).map((c) => c.text), ["Expiry"], "a jump by address alone marks its target, even beside a sibling that shares the reading line");
  const second = expected.find((e) => e.text === "Breadth");
  await page.evaluate((id) => { document.getElementById(id).scrollIntoView({ block: "start", behavior: "instant" }); }, second.id);
  await settle(page, 400);
  eq((await chips(page)).filter((c) => c.current).map((c) => c.text), ["Breadth"], "scrolling elsewhere moves the mark");
  eq(page._errors, [], "no page error");
  await ctx.close();
}

for (const [w, h, touch] of [[320, 700, true], [390, 800, true], [768, 900, false], [1440, 900, false]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await mount(page, MARKET, "/flows/market/");
  await settle(page);
  const m = await page.evaluate(() => {
    const n = document.getElementById("fxIndex");
    const a = Array.from(n.querySelectorAll("a"));
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollable: n.scrollWidth > n.clientWidth,
      minH: Math.min(...a.map((x) => x.getBoundingClientRect().height)),
      coarse: matchMedia("(pointer: coarse)").matches,
      navW: Math.round(n.getBoundingClientRect().width),
    };
  });
  ok(m.overflow <= 0, `${w}px: the page does not scroll sideways (${m.overflow})`);
  if (w <= 390) ok(m.scrollable, `${w}px: the chips scroll inside their own strip`);
  ok(m.minH >= (m.coarse ? 44 : 32), `${w}px: chips are tall enough to hit (${m.minH}px, coarse ${m.coarse})`);
  await page.evaluate(() => { const l = Array.from(document.querySelectorAll("#fxIndex a")).pop(); document.getElementById(l.getAttribute("href").slice(1)).scrollIntoView({ block: "start", behavior: "instant" }); });
  await settle(page, 400);
  const seen = await page.evaluate(() => {
    const n = document.getElementById("fxIndex").getBoundingClientRect();
    const c = document.querySelector('#fxIndex a[aria-current="location"]');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return r.left >= n.left - 1 && r.right <= n.right + 1;
  });
  ok(seen === true, `${w}px: the current chip is scrolled into view inside the strip`);
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await mount(page, MARKET, "/flows/market/");
  await settle(page);
  await page.keyboard.press("Tab");
  let guard = 0;
  while (guard++ < 80 && !(await page.evaluate(() => document.activeElement && document.activeElement.closest && document.activeElement.closest("#fxIndex")))) await page.keyboard.press("Tab");
  const f = await page.evaluate(() => {
    const e = document.activeElement;
    const cs = getComputedStyle(e);
    return { inIndex: !!e.closest("#fxIndex"), outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  ok(f.inIndex, "the chips are reachable by keyboard");
  ok(f.outline !== "none" && f.width > 0, "and show a focus ring");
  await page.keyboard.press("Enter");
  await settle(page, 300);
  ok(await page.evaluate(() => location.hash.length > 1), "Enter follows the chip");
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await mount(page, TICKER, "/flows/ticker/?t=AAPL");
  await settle(page);
  ok(await page.evaluate(() => document.getElementById("fxIndex").hidden), "the ticker's index stays hidden while the dossier has drawn nothing");
  const add = (id, title, extra = "") => page.evaluate(([id, title, extra]) => {
    const g = document.getElementById("ftGrid");
    g.hidden = false;
    const s = document.createElement("section");
    s.className = "ui-card ui-mod ft-m";
    s.id = id;
    s.innerHTML = `<header class="ui-mod-h"><h2 class="ui-mod-t" id="${id}-t">${title}<button type="button">why</button></h2></header><div style="height:420px"></div>${extra}`;
    g.append(s);
  }, [id, title, extra]);
  await add("m-worlds", "Two worlds");
  await add("m-gamma", "Gamma");
  await settle(page);
  ok(await page.evaluate(() => document.getElementById("fxIndex").hidden), "two modules are not worth an index");
  await add("m-vol", "Volatility");
  await add("m-flow", "Flow");
  await settle(page);

  eq((await chips(page)).map((c) => c.text), ["Two worlds", "Gamma", "Volatility", "Flow"], "modules drawn by the page appear as chips, without the text of the buttons inside their titles");
  eq((await chips(page)).map((c) => c.href), ["#m-worlds", "#m-gamma", "#m-vol", "#m-flow"], "pointing at the ids the ticker's own hash jump already understands");
  const first = await page.evaluate(() => { window.__chip = document.querySelector("#fxIndex a"); return true; });
  await page.evaluate(() => {
    const old = document.getElementById("m-gamma");
    const s = old.cloneNode(true);
    old.replaceWith(s);
  });
  await settle(page);
  ok(await page.evaluate(() => window.__chip === document.querySelector("#fxIndex a")), "a module redrawn in place with the same title leaves the chips untouched");
  await page.evaluate(() => {
    const s = document.getElementById("m-gamma");
    s.querySelector(".ui-mod-t").firstChild.nodeValue = "Dealer gamma";
    document.getElementById("ftGrid").append(s);
  });
  await settle(page);
  eq((await chips(page)).map((c) => c.text), ["Two worlds", "Volatility", "Flow", "Dealer gamma"], "a moved or renamed module is followed");
  await page.evaluate(() => { document.getElementById("ftGrid").hidden = true; });
  await settle(page);
  ok(await page.evaluate(() => document.getElementById("fxIndex").hidden), "hiding the grid hides the index");
  await page.evaluate(() => { document.getElementById("ftGrid").hidden = false; document.getElementById("m-flow").remove(); });
  await settle(page);
  eq((await chips(page)).map((c) => c.text), ["Two worlds", "Volatility", "Dealer gamma"], "and a module the page removes drops out");
  eq(page._errors, [], "no page error");
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await mount(page, TICKER, "/flows/ticker/?t=AAPL");
  await settle(page);
  await page.evaluate(() => {
    window.__shift = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shift += e.value; }).observe({ type: "layout-shift", buffered: false });
    const hero = document.getElementById("ftHero");
    hero.hidden = false;
    hero.style.minHeight = "1400px";
    const g = document.getElementById("ftGrid");
    g.hidden = false;
    for (const [id, t] of [["m-a", "Alpha"], ["m-b", "Beta"], ["m-c", "Gamma"], ["m-d", "Delta"]]) {
      const s = document.createElement("section");
      s.className = "ui-card ui-mod ft-m";
      s.id = id;
      s.innerHTML = `<header class="ui-mod-h"><h2 class="ui-mod-t">${t}</h2></header><div style="height:300px"></div>`;
      g.append(s);
    }
  });
  await settle(page);
  ok(!(await page.evaluate(() => document.getElementById("fxIndex").hidden)), "modules drawn in one pass show the index");
  ok(await page.evaluate(() => window.__shift) < 0.01, "and it appears in the frame that draws them, so nothing already on screen moves");
  eq(page._errors, [], "below a hero taller than the screen, where the strip is far from its stuck position, it still builds its reading line without error");
  await page.evaluate(() => document.getElementById("m-c").scrollIntoView({ block: "start", behavior: "instant" }));
  await settle(page, 400);
  eq((await chips(page)).filter((c) => c.current).map((c) => c.text), ["Gamma"], "and marks the module at the line once scrolled to it");
  await ctx.close();
}

await browser.close();
console.log(`✓ flows-index: ${checks} assertions — the section index lists the modules the page drew, in order, under their own titles; sticks under the bar; marks the one at the reading line; follows redraws, renames, removals and a hidden grid; and holds at 320, 390, 768 and 1440 with no sideways scroll and hit areas that fit a thumb`);
