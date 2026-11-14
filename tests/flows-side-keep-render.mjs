import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FLOWS_NAV, FLOWS_PAGES, fireNav, ownerNav, positioningNav, sideShell } from "../shared/flows-pages.js";
import { flowlabShell } from "../shared/flows-flowlab-shell.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://side.test";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 820 };
const PAGES = { "/flows/long/": () => FLOWS_PAGES.sidePage({ username: "member", side: "long" }), "/flows/short/": () => FLOWS_PAGES.sidePage({ username: "member", side: "short" }) };

const RAIL_PATH = "/flows/rail/";
const RAIL_SIZES = [{ width: 1920, height: 1080 }, { width: 1440, height: 820 }, { width: 1024, height: 768 }];
const RAIL_SHORT = { width: 1280, height: 600 };
const RAIL_KEYS = FLOWS_NAV.flatMap((g) => g.items.map((i) => i.href));
const railPage = (owner) => {
  const full = positioningNav(fireNav(flowlabShell(FLOWS_PAGES.sidePage({ username: "member", side: "long" }), "long", true), true, "long"), true, "long");
  return owner ? ownerNav(full) : full;
};

let checks = 0;

const swap = (src, from, to) => {
  if (src.split(from).length !== 2) throw new Error("mutant anchor not found exactly once: " + from);
  return src.replace(from, () => to);
};

const VARIANTS = {
  "the choice is never written to the cookie": { js: (src) => swap(src, '+v + "; Max-Age=31536000"', '+v + "; Max-Age=0"') },
  "the server ignores the cookie": { shell: (html) => html },
  "the script forgets the cookie on load": { js: (src) => swap(src, "let sidePref = sideKeep();", "let sidePref = null;") },
  "Escape closes for this page only": { js: (src) => swap(src, 'if (e.key === "Escape") closeDrawer(true, true);', 'if (e.key === "Escape") closeDrawer(true, false);') },
  "the button never learns the state": { js: (src) => swap(src, 'if (btn) btn.setAttribute("aria-expanded", on);', "") },
  "the rail keeps its roomy rhythm at every height": { css: (src) => swap(src, "grid-auto-rows: minmax(26px, 34px);", "grid-auto-rows: 34px;") },
  "the rail fits by hiding an entry": { css: (src) => src + "\n.flows-rail a[data-pos-nav] { display: none; }\n" },
  "a short window squeezes rows under their floor": { css: (src) => swap(src, ".rail-items:has(> :nth-child(8)) { min-height: 215px; }", "") + "\n.rail-items { min-height: 0; }\n.flows-rail a { min-height: 0; }\n.rail-items { grid-auto-rows: minmax(0, 34px); }\n" },
};

const run = async (browser, variant = {}) => {
  const fails = [];
  const need = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
  const shell = variant.shell || sideShell;
  const served = [];
  const route = async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      if (u.pathname.endsWith("/flows-ui.js")) return r.fulfill({ contentType: "text/javascript", body: variant.js ? variant.js(fs.readFileSync(f, "utf8")) : fs.readFileSync(f, "utf8") });
      if (u.pathname.endsWith(".js")) return r.fulfill({ contentType: "text/javascript", body: "" });
      if (u.pathname.endsWith("/flows.css") && variant.css) return r.fulfill({ contentType: "text/css", body: variant.css(fs.readFileSync(f, "utf8")) });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname === RAIL_PATH) {
      const cookie = (await r.request().allHeaders()).cookie || "";
      return r.fulfill({ contentType: "text/html; charset=utf-8", body: sideShell(railPage(u.searchParams.get("as") === "owner"), cookie) });
    }
    if (PAGES[u.pathname]) {
      const cookie = (await r.request().allHeaders()).cookie || "";
      const body = shell(PAGES[u.pathname](), cookie);
      served.push({ path: u.pathname, cookie, cls: /<body class="([^"]*)"/.exec(body)[1] });
      return r.fulfill({ contentType: "text/html; charset=utf-8", body });
    }
    return r.fulfill({ status: 404, body: "" });
  };
  const fresh = async (viewport, opts = {}) => {
    const ctx = await browser.newContext({ viewport, reducedMotion: opts.reduced ? "reduce" : "no-preference", javaScriptEnabled: opts.js !== false });
    if (opts.cookie !== undefined) await ctx.addCookies([{ name: "fx_side", value: opts.cookie, domain: "side.test", path: "/flows" }]);
    ctx.setDefaultTimeout(4000);
    const page = await ctx.newPage();
    await page.route("**/*", route);
    return { ctx, page };
  };
  const read = (page) => page.evaluate(() => {
    const side = document.getElementById("fxSide"), btn = document.getElementById("fxSideBtn"), main = document.getElementById("flowsMain"), scrim = document.getElementById("fxScrim");
    const r = side.getBoundingClientRect(), cs = getComputedStyle(side), m = main.getBoundingClientRect(), a = document.activeElement;
    return {
      shown: cs.visibility === "visible" && r.right > 1 && r.left >= -1, expanded: btn.getAttribute("aria-expanded"), inert: main.inert === true,
      scrim: getComputedStyle(scrim).display !== "none" && getComputedStyle(scrim).pointerEvents === "auto",
      cookie: (/(?:^|; )fx_side=([01])/.exec(document.cookie) || [])[1] ?? null, main: [Math.round(m.left), Math.round(m.width)],
      focus: a ? (a.id || (a.closest("#fxSide") ? "in-side:" + a.getAttribute("href") : a.tagName)) : null, duration: cs.transitionDuration, cls: document.body.className,
    };
  });
  const settled = (page, shown) => page.waitForFunction((want) => {
    const side = document.getElementById("fxSide"), r = side.getBoundingClientRect();
    const is = getComputedStyle(side).visibility === "visible" && r.right > 1 && r.left >= -1;
    return is === want && side.getAnimations().length === 0;
  }, shown, { timeout: 5000 }).then(() => true, () => false);
  const go = async (page, p) => { await page.goto(ORIGIN + p); await page.waitForFunction(() => document.getElementById("fxSideBtn").getAttribute("aria-expanded") !== null && document.readyState === "complete"); await page.waitForTimeout(80); };

  const rail = (page) => page.evaluate(() => {
    const el = document.querySelector("#fxSide .flows-rail"), box = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll("a")].map((a) => { const r = a.getBoundingClientRect(), cs = getComputedStyle(a); return { href: a.getAttribute("href"), top: r.top, bottom: r.bottom, h: r.height, shown: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 }; });
    const heads = [...el.querySelectorAll(".rail-group")].map((p) => { const r = p.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    const marks = [...rows, ...heads].sort((a, b) => a.top - b.top);
    let overlap = 0;
    for (let i = 1; i < marks.length; i++) overlap = Math.max(overlap, marks[i - 1].bottom - marks[i].top);
    return { over: el.scrollHeight - el.clientHeight, rows, overlap, inside: rows.every((r) => r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5), low: Math.min(...rows.map((r) => r.h)), high: Math.max(...rows.map((r) => r.h)), brand: (document.querySelector("#fxSide .ff-brand") || { getAttribute: () => null }).getAttribute("href") };
  });
  for (const as of ["member", "owner"]) {
    for (const size of [...RAIL_SIZES, RAIL_SHORT]) {
      const { ctx, page } = await fresh(size, { cookie: size.width > 1024 ? undefined : "1" });
      await page.goto(ORIGIN + RAIL_PATH + "?as=" + as);
      await page.waitForFunction(() => document.readyState === "complete");
      await page.evaluate(() => document.fonts.ready);
      const r = await rail(page);
      const at = as + " at " + size.width + "x" + size.height + ": ";
      need(r.rows.map((x) => x.href).join(" ") === RAIL_KEYS.join(" "), at + "the rail lists every entry of FLOWS_NAV, in order, with every switched page open");
      need(r.rows.every((x) => x.shown), at + "and none of them is hidden");
      need(r.brand === (as === "owner" ? "/flows/status/#view=coverage" : "/flows/about/"), at + "the footer is this reader's");
      need(r.overlap <= 0.5, at + "no entry overlaps the next entry or a group heading (" + r.overlap.toFixed(1) + " px)");
      need(r.low >= 26 - 0.01, at + "no row is squeezed under 26 px (" + r.low.toFixed(1) + ")");
      need(r.high - r.low <= 0.75, at + "every row has the same height");
      if (size === RAIL_SHORT) need(r.over > 0, at + "a window too short for the floor scrolls the rail instead of squeezing it");
      else {
        need(r.over <= 0, at + "THE RAIL DOES NOT SCROLL (" + r.over + " px over)");
        need(r.inside, at + "and every entry sits inside it");
      }
      if (size.height >= 1080) need(Math.abs(r.high - 34) <= 0.01, at + "where there is room a row keeps its 34 px");
      await ctx.close();
    }
  }

  {
    const { ctx, page } = await fresh(NARROW);
    await go(page, "/flows/long/");
    let s = await read(page);
    need(!s.shown && s.expanded === "false" && s.cookie === null && !s.inert, "narrow, no cookie: the sidebar starts closed and the button says so");
    await page.click("#fxSideBtn");
    need(await settled(page, true), "the toolbar button opens the sidebar");
    await page.waitForTimeout(80);
    s = await read(page);
    need(s.expanded === "true", "an open sidebar is aria-expanded true");
    need(s.cookie === "1", "opening it writes fx_side=1");
    need(s.inert && s.scrim, "the page behind an open drawer is inert under the scrim");
    need(String(s.focus).startsWith("in-side:"), "focus moves into the opened sidebar");
    const before = served.length;
    await page.click('#fxSide .flows-rail a[href="/flows/short/"]');
    await page.waitForURL(ORIGIN + "/flows/short/");
    await page.waitForFunction(() => document.readyState === "complete");
    await page.waitForTimeout(120);
    const hit = served.slice(before).find((x) => x.path === "/flows/short/");
    need(hit && /fx_side=1/.test(hit.cookie), "the next page's request carries the cookie");
    need(hit && /\bhas-side-open\b/.test(hit.cls), "the next page is served with the sidebar already open in its markup");
    s = await read(page);
    need(s.shown && s.expanded === "true" && s.inert && s.cookie === "1", "after choosing a destination the sidebar is still open on the next page");
    need(s.focus === "in-side:/flows/short/", "and focus rests on the current page's link inside it");
    await page.click('#fxSide .flows-rail a[href="/flows/long/"]');
    await page.waitForURL(ORIGIN + "/flows/long/");
    await page.waitForFunction(() => document.readyState === "complete");
    await page.waitForTimeout(120);
    s = await read(page);
    need(s.shown && s.expanded === "true", "and on the page after that");
    await page.keyboard.press("Escape");
    need(await settled(page, false), "Escape closes it");
    s = await read(page);
    need(s.expanded === "false" && !s.inert && s.focus === "fxSideBtn", "Escape hands focus back to the button and frees the page");
    need(s.cookie === null, "an explicit close at the narrow default clears the cookie");
    await go(page, "/flows/short/");
    s = await read(page);
    need(!s.shown && s.expanded === "false", "once closed with Escape it stays closed on the next page");
    await page.click("#fxSideBtn");
    await settled(page, true);
    await page.mouse.click(380, 600);
    need(await settled(page, false), "a click outside, on the scrim, closes it");
    need((await read(page)).cookie === null, "and that close is remembered");
    await page.click("#fxSideBtn");
    await settled(page, true);
    await page.evaluate(() => document.getElementById("fxSideBtn").click());
    need(await settled(page, false), "the toggle closes it");
    need((await read(page)).cookie === null, "and that close is remembered too");
    await page.click("#fxSideBtn");
    await settled(page, true);
    await page.evaluate(() => window.FlowsUI.shell.closeSidebar());
    await settled(page, false);
    need((await read(page)).cookie === "1", "a close the page makes for itself does not change what the reader chose");
    await ctx.close();
  }

  {
    const plain = await fresh(NARROW, { js: false });
    await plain.page.goto(ORIGIN + "/flows/long/");
    const base = await read(plain.page);
    need(!base.shown, "no script, no cookie: closed");
    await plain.ctx.close();
    const kept = await fresh(NARROW, { js: false, cookie: "1" });
    await kept.page.goto(ORIGIN + "/flows/long/");
    const s = await read(kept.page);
    need(s.shown && s.scrim, "no script, cookie 1: the first paint already has the sidebar open, so there is no closed flash");
    need(s.main[0] === base.main[0] && s.main[1] === base.main[1], "and the page under it sits exactly where it would without it");
    await kept.ctx.close();
  }

  {
    const { ctx, page } = await fresh(NARROW, { cookie: "1" });
    await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
    await go(page, "/flows/long/");
    await page.waitForTimeout(300);
    need((await page.evaluate(() => window.__cls)) < 0.01, "a page that loads with the sidebar kept open shifts nothing");
    await ctx.close();
  }

  {
    const { ctx, page } = await fresh(NARROW, { reduced: true, cookie: "1" });
    await go(page, "/flows/long/");
    let s = await read(page);
    need(s.shown && s.expanded === "true", "reduced motion: the kept sidebar is open");
    need(s.duration.split(",").every((d) => parseFloat(d) === 0), "reduced motion: the sidebar does not slide");
    await page.keyboard.press("Escape");
    s = await read(page);
    need(!s.shown && s.expanded === "false", "reduced motion: Escape closes it at once");
    await ctx.close();
  }

  {
    const { ctx, page } = await fresh(WIDE);
    await go(page, "/flows/long/");
    let s = await read(page);
    need(s.shown && s.expanded === "true" && s.cookie === null && !s.inert, "wide, no cookie: the sidebar is shown and the button says so");
    const open = s.main;
    await page.click("#fxSideBtn");
    s = await read(page);
    need(!s.shown && s.expanded === "false" && s.cookie === "0", "wide: the toggle collapses it and writes fx_side=0");
    const before = served.length;
    await go(page, "/flows/short/");
    const hit = served.slice(before).find((x) => x.path === "/flows/short/");
    need(hit && /\bis-side-collapsed\b/.test(hit.cls), "wide: the next page is served collapsed");
    s = await read(page);
    need(!s.shown && s.expanded === "false", "wide: and stays collapsed");
    await page.click("#fxSideBtn");
    s = await read(page);
    need(s.shown && s.expanded === "true" && s.cookie === null, "wide: the toggle brings it back and clears the cookie");
    need(s.main[0] === open[0] && s.main[1] === open[1], "wide: the page returns to where it was");
    await ctx.close();
    const kept = await fresh(WIDE, { js: false, cookie: "0" });
    await kept.page.goto(ORIGIN + "/flows/long/");
    need(!(await read(kept.page)).shown, "wide, no script, cookie 0: the first paint is already collapsed");
    await kept.ctx.close();
    const one = await fresh(WIDE, { cookie: "1" });
    await go(one.page, "/flows/long/");
    s = await read(one.page);
    need(s.shown && s.expanded === "true" && !s.inert && !/\bhas-side-open\b/.test(s.cls), "wide, cookie 1: shown as a rail, never as a drawer over an inert page");
    await one.ctx.close();
  }
  return fails;
};

const unit = () => {
  const fails = [];
  const need = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
  const page = FLOWS_PAGES.sidePage({ username: "member", side: "long" });
  need(sideShell(page, "") === page && sideShell(page, null) === page, "no cookie: the page is byte for byte what it was");
  for (const c of ["fx_side=2", "xfx_side=1", "fx_side=", "fx_side=11", "fx_side=on", "fn_ambient=1"]) need(sideShell(page, c) === page, "ignored: " + c);
  need(sideShell(page, "a=b; fx_side=1; c=d").includes('<body class="flows-body has-rail has-side-open"'), "fx_side=1 among other cookies opens it");
  need(sideShell(page, "fx_side=0").includes('<body class="flows-body has-rail is-side-collapsed"'), "fx_side=0 collapses it");
  need(sideShell(page, "fx_side=1").length === page.length + " has-side-open".length, "one class is all it adds");
  for (const name of ["loginPage", "aboutPage", "glossaryPage"]) { const html = FLOWS_PAGES[name](); need(sideShell(html, "fx_side=1") === html, name + " has no sidebar and is untouched"); }
  return fails;
};

const browser = await chromium.launch();
const attempt = async (variant) => {
  const ctxs = browser.contexts().length;
  try { return await run(browser, variant); }
  catch (e) { for (const c of browser.contexts().slice(ctxs)) await c.close(); return ["stopped: " + String(e.message).split("\n")[0]]; }
};
let failed = false;
try {
  const u = unit();
  if (u.length) { failed = true; console.error("✗ sideShell\n  " + u.join("\n  ")); }
  const good = await attempt();
  if (good.length) { failed = true; console.error("✗ the shipped build\n  " + good.join("\n  ")); }
  else console.log("✓ the shipped build keeps the sidebar open across pages and closes only when told");
  for (const [name, variant] of Object.entries(VARIANTS)) {
    const f = await attempt(variant);
    checks++;
    if (!f.length) { failed = true; console.error("✗ planted wrong build survived: " + name); }
    else console.log(`✓ planted wrong build fails (${f.length}): ${name}`);
  }
} finally {
  await browser.close();
}
console.log(`${failed ? "✗" : "✓"} flows-side-keep-render: ${checks} checks`);
process.exit(failed ? 1 : 0);
