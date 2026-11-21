import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { launch } from "./lib/browser.mjs";
import { COPY_BANNED, templateById } from "../shared/ff-contract.js";
import { fireBody, fireRegistry } from "../shared/ff-pages-fire.js";
import { firePage } from "../shared/flows-pages.js";
import { FEED_TEMPLATES, feedTemplateRows } from "../shared/flows-er-feed-templates.js";
import { ER_COPY } from "../shared/flows-er-copy.js";
import { mount as mountRaw, SIZES, ROOT, pageHtml, registry } from "./lib/ff-d-world.mjs";

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
const FEED_JS = "assets/js/flows-er-fire.js";
const FIRE_JS = "assets/js/flows-ff-fire.js";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const plant = (file, from, to) => {
  const src = read(file);
  if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once in " + file + ": " + from.slice(0, 70));
  return { path: file, body: src.replace(from, to) };
};
const glyph = (name) => `<svg class="ui-g" aria-hidden="true" focusable="false"><use href="#g-${name}"/></svg>`;
const leafAst = (id) => !!(templateById(id) || {}).ast;
const BANNED = new RegExp("\\b(" + COPY_BANNED.join("|") + ")\\b", "i");

function browserCopy(src) {
  const ctx = { window: { FlowsUI: Object.freeze({}) }, document: {}, fetch: () => Promise.reject(new Error("no")) };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.FlowsUI.ffFeed;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function randomFeed(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  if (r() < 0.06) return pick([null, undefined, {}, { status: "pending" }, "x"]);
  const ids = ["trading_state", "earnings", "economic_release", "fda", "flow_alerts", "chain_oi_change", "news", "dividends"];
  const types = ids.filter(() => r() < 0.7).map((id) => ({ id, can: pick([true, false, null, undefined, "yes"]), perDay: pick([50, 0, 3, null, 2.5, -1, "50", 1e20]) }));
  const fieldsOf = { trading_state: ["state", "reason", "time"], flow_alert: ["total_premium", "volume_oi_ratio", "dte", "side"], option_contract: ["oi_change", "volume"] };
  const targets = Object.keys(fieldsOf).filter(() => r() < 0.75).map((id) => ({
    id,
    fields: r() < 0.1 ? null : fieldsOf[id].filter(() => r() < 0.85).map((f) => (r() < 0.5 ? [f, "number"] : f)),
  }));
  return { status: pick(["ok", "ok", "ok", "unavailable"]), types: r() < 0.05 ? "bad" : types, grammar: r() < 0.08 ? null : { targets } };
}

async function mainFireBody() {
  let text;
  try { text = execFileSync("git", ["show", "origin/main:shared/ff-pages-fire.js"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "er-fire-"));
  const file = path.join(dir, "ff-pages-fire.mjs");
  fs.writeFileSync(file, text.replace('from "./ff-contract.js"', 'from ' + JSON.stringify(pathToFileURL(path.join(ROOT, "shared/ff-contract.js")).href)));
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

{
  const today = fireBody(glyph, registry);
  eq(fireBody(glyph, registry, { feed: false }), today, "WITH THE FEED OFF THE FIRE BODY IS BYTE FOR BYTE THE BODY WITHOUT THE OPTION");
  eq(firePage({ username: "x", feed: false }), firePage({ username: "x" }), "and so is the whole Fire page");
  ok(!/ffxSeg|ffxFeedTpls|data-defer="er-fire"|ffxFeedFoot/.test(today), "and it carries no part of the feed group");
  const main = await mainFireBody();
  if (main && main.fireBody.length >= 1) {
    ok(main.fireBody(glyph, main.fireRegistry()) === today, "the body with the feed off equals the body on origin/main");
  }
  const on = fireBody(glyph, registry, { feed: true, feedSrc: "/assets/js/flows-er-fire.js?v=1" });
  ok(on.includes('role="radiogroup"') && (on.match(/role="radio"/g) || []).length === 2, "with the feed on the Start header holds a two-segment radio group");
  ok(on.includes('<i hidden data-defer="er-fire" data-src="/assets/js/flows-er-fire.js?v=1"></i>'), "and declares the deferred group with its versioned file");
  ok(/<ul class="ffx-tpls ffx-feed" id="ffxFeedTpls"[^>]*hidden><\/ul>/.test(on), "and a second list in the same panel, hidden until chosen");
  ok(firePage({ username: "x", feed: true }).includes('data-src="/assets/js/flows-er-fire.js?v='), "the page passes the versioned file");
}

{
  const src = read(FEED_JS);
  const f = browserCopy(src);
  eq(f.TEMPLATES.map((t) => ({ ...t, fields: [...t.fields] })), FEED_TEMPLATES.map((t) => ({ ...t, fields: [...t.fields] })), "the browser's template table equals the leaf's");
  eq({ ...f.COPY.states }, { ...ER_COPY.fire.states }, "the state words equal the copy module's");
  eq([f.COPY.readOnly, f.COPY.useClosest, f.COPY.limitNone], [ER_COPY.fire.readOnly, ER_COPY.fire.useClosest, ER_COPY.fire.limitNone], "and so do the chip, the button and the missing limit");
  const r = seeded(20261115);
  let same = 0;
  for (let i = 0; i < 200; i++) {
    const feed = randomFeed(r);
    const a = JSON.stringify(f.rows(feed, leafAst));
    const b = JSON.stringify(feedTemplateRows(feed));
    if (a === b) same++;
    else if (same === i) ok(false, "browser rows equal the leaf for " + JSON.stringify(feed));
  }
  eq(same, 200, "THE BROWSER COPY OF feedTemplateRows EQUALS THE LEAF OVER 200 RANDOM FEED BLOCKS");
  const words = [...Object.values(f.COPY).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v))), ...f.TEMPLATES.flatMap((t) => [t.title, t.differs])];
  ok(words.every((w) => !BANNED.test(w)), "no sentence of the group uses a banned word");
  ok(words.every((w) => !/\btape\b|\bvendor\b/i.test(w)), "and none says tape or vendor");
  eq(f.meta({ perDay: null, fields: null, fieldsWhy: "not in the feed's grammar" }), "— limit not stated · — fields not in the feed's grammar", "a missing limit and a missing grammar are dashes with their reasons");
  eq(f.meta({ perDay: 50, fields: ["state", "reason"] }), "up to 50 a day · state, reason", "a stated limit and fields are printed");
  eq(f.ownerLine({ configs: [{}, {}], fired: { earnings: 2, trading_state: 1 } }).text, "Your feed account: 2 alert definitions, 3 fired in 14 days", "the owner line counts definitions and firings");
  eq(f.ownerLine({ configs: null, fired: null }).text, "Your feed account: — alert definitions not read, — firings not read", "an unread part is a dash, never zero");
  eq(f.ownerLine(null), null, "no owner block, no owner line");
  for (const [name, from, to] of [
    ["the unread test dropped", ' && feed.status !== "unavailable"', ""],
    ["a can of null read as ready", 'entry.can === true ? "ready"', 'entry.can !== false ? "ready"'],
    ["a fractional limit kept", "Number.isSafeInteger(entry.perDay)", "Number.isFinite(entry.perDay)"],
  ]) {
    const bad = browserCopy(src.split(from).length === 2 ? src.replace(from, to) : (() => { throw new Error("anchor " + name); })());
    const rr = seeded(7);
    let diff = false;
    for (let i = 0; i < 200 && !diff; i++) { const feed = randomFeed(rr); diff = JSON.stringify(bad.rows(feed, leafAst)) !== JSON.stringify(feedTemplateRows(feed)); }
    ok(diff, "PLANTED WRONG BUILD, " + name + ": the browser copy differs from the leaf and the check fails it");
  }
}

const FEED = {
  status: "ok",
  types: [
    { id: "trading_state", can: true, perDay: 50 },
    { id: "earnings", can: false, perDay: null },
    { id: "economic_release", can: null, perDay: 10 },
    { id: "flow_alerts", can: true, perDay: 25 },
    { id: "chain_oi_change", can: true, perDay: 5 },
  ],
  grammar: { targets: [
    { id: "trading_state", fields: [["state", "string"], ["reason", "string"]] },
    { id: "flow_alert", fields: [["total_premium", "number"], ["dte", "number"]] },
    { id: "option_contract", fields: [["oi_change", "number"]] },
  ] },
};
const OWNER = { configs: [{ k: "a1", type: "trading_state", status: "active", label: "Halts on my names", keys: ["symbols"] }, { k: "b2", type: "earnings", status: null, label: "Reports", keys: [] }], fired: { trading_state: 2, earnings: 1 } };
const FEED_HTML = pageHtml(fireBody(glyph, registry, { feed: true, feedSrc: "/assets/js/flows-er-fire.js" }));

async function geometry(page) {
  return page.evaluate(() => {
    const bad = [];
    const root = document.querySelector(".flows-main");
    const sw = document.documentElement.scrollWidth > innerWidth + 1;
    const sh = document.documentElement.scrollHeight > innerHeight + 1;
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    for (const e of root.querySelectorAll("#ffxFire .ffx-panel")) {
      if (!vis(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1) bad.push("panel outside the screen: " + e.id);
    }
    for (const e of root.querySelectorAll("#ffxTpl *")) {
      if (!vis(e)) continue;
      const cs = getComputedStyle(e);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) bad.push("inner scroll " + e.className);
      if (cs.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1 && !e.title && !e.closest("[title]")) bad.push("truncated with no title: " + (e.textContent || "").slice(0, 40));
      let p = e.parentElement;
      while (p && p !== root) {
        const pc = getComputedStyle(p);
        if (pc.overflow === "hidden" || pc.overflowY === "hidden" || pc.overflowX === "hidden") {
          const a = e.getBoundingClientRect();
          const b = p.getBoundingClientRect();
          if (a.bottom > b.bottom + 1.5 || a.top < b.top - 1.5 || a.right > b.right + 1.5 || a.left < b.left - 1.5) {
            if (cs.textOverflow !== "ellipsis") bad.push("leaves " + p.className + ": " + e.className + " " + (e.textContent || "").slice(0, 30));
          }
          break;
        }
        p = p.parentElement;
      }
    }
    return { sw, sh, bad };
  });
}

async function open(browser, w, h, o = {}) {
  const assets = [];
  const m = await mountRaw(browser, w, h, {
    html: o.html || FEED_HTML,
    js: o.js,
    css: o.css,
    context: o.context,
    api: async ({ path: p, json, r }) => {
      if (p === "/api/flows/eventrisk") {
        const answer = typeof o.feed === "function" ? o.feed() : o.feed === undefined ? { status: 200, body: { v: 1, feed: FEED } } : o.feed;
        if (answer.hang) return new Promise(() => {});
        return r.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) }).then(() => true);
      }
      void json;
      return undefined;
    },
  });
  m.page.on("request", (req) => { const u = new URL(req.url()); if (u.pathname.startsWith("/assets/")) assets.push(u.pathname); });
  m.assets = assets;
  return m;
}

const fetchedFeed = (page) => page.evaluate(() => performance.getEntriesByType("resource").some((e) => /flows-er-fire\.js/.test(e.name)));
const boxOf = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 10) / 10); }, sel);
const chooseFeed = async (page) => { await page.click('#ffxSeg [data-seg="feed"]'); await page.waitForSelector("#ffxFeedTpls .ffx-fli", { timeout: 8000 }); await page.waitForTimeout(150); };
const PAGE_OWN = (p) => p === "/api/flows/meta" || p.startsWith("/api/ff/");
const feedCalls = (calls) => calls.filter((c) => c.path === "/api/flows/eventrisk").length;

const browser = await launch();
try {
  for (const [w, h] of SIZES) {
    const here = `${w}x${h} `;
    const m = await open(browser, w, h);
    const { page } = m;
    ok(!(await fetchedFeed(page)), here + "the feed group is not fetched before it is chosen");
    eq(feedCalls(m.calls), 0, here + "and the eventrisk route is not read");
    const seg = await boxOf(page, "#ffxSeg");
    const head = await boxOf(page, "#ffxTpl > .ffx-ph");
    ok(seg[1] >= head[1] - 0.5 && seg[1] + seg[3] <= head[1] + head[3] + 0.5, here + "the segment sits inside the Start panel's header (" + JSON.stringify([seg, head]) + ")");
    const panel = await boxOf(page, "#ffxTpl");
    const flowsList = await boxOf(page, "#ffxTpls");
    let g = await geometry(page);
    ok(!g.sw && !g.sh, here + "one screen before the choice");
    eq(g.bad, [], here + "nothing clipped before the choice");
    const before = m.calls.length;
    await chooseFeed(page);
    eq(await boxOf(page, "#ffxTpl"), panel, here + "THE START PANEL DOES NOT MOVE OR CHANGE HEIGHT WHEN THE LIST SWAPS");
    const feedList = await boxOf(page, "#ffxFeedTpls");
    eq([feedList[0], feedList[1], feedList[2]], [flowsList[0], flowsList[1], flowsList[2]], here + "the feed list takes the Flows list's box");
    eq(await page.evaluate(() => document.getElementById("ffxTpls").hidden), true, here + "and the Flows list is hidden");
    eq(await page.locator("#ffxFeedTpls .ffx-fli").count(), 6, here + "six feed rows");
    g = await geometry(page);
    ok(!g.sw && !g.sh, here + "ONE SCREEN WITH THE FEED LIST (" + JSON.stringify({ sw: g.sw, sh: g.sh }) + ")");
    eq(g.bad, [], here + "nothing in the Start panel clipped, scrolling or cut without a title");
    const after = m.calls.slice(before).map((c) => c.path).filter((p) => !PAGE_OWN(p));
    eq(after, ["/api/flows/eventrisk"], here + "the only request the group makes is the eventrisk route");
    await page.click('#ffxSeg [data-seg="flows"]');
    await page.click('#ffxSeg [data-seg="feed"]');
    await page.waitForTimeout(150);
    eq(feedCalls(m.calls), 1, here + "and it is read once however often the segment turns");
    await m.ctx.close();
  }

  {
    const m = await open(browser, 1440, 820);
    const { page } = m;
    await page.focus('#ffxSeg [data-seg="flows"]');
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector("#ffxFeedTpls .ffx-fli");
    eq(await page.evaluate(() => [document.activeElement.getAttribute("data-seg"), document.querySelector('#ffxSeg [data-seg="feed"]').getAttribute("aria-checked"), document.getElementById("ffxFeedTpls").hidden]), ["feed", "true", false], "ArrowRight chooses the feed and moves focus to it");
    await page.keyboard.press("ArrowLeft");
    eq(await page.evaluate(() => [document.activeElement.getAttribute("data-seg"), document.getElementById("ffxTpls").hidden, document.getElementById("ffxFeedTpls").hidden]), ["flows", false, true], "ArrowLeft goes back to the Flows list");
    await page.keyboard.press("End");
    eq(await page.evaluate(() => document.activeElement.getAttribute("data-seg")), "feed", "End reaches the last segment");
    await page.keyboard.press("Home");
    eq(await page.evaluate(() => document.activeElement.getAttribute("data-seg")), "flows", "Home the first");
    eq(await page.evaluate(() => [...document.querySelectorAll("#ffxSeg [role=radio]")].map((b) => b.tabIndex)), [0, -1], "one tab stop in the group");

    await page.click('#ffxSeg [data-seg="feed"]');
    const want = feedTemplateRows(FEED);
    const got = await page.evaluate(() => [...document.querySelectorAll("#ffxFeedTpls .ffx-fli")].map((li) => ({
      id: li.getAttribute("data-feed"), title: li.querySelector(".ffx-fli-t").textContent, state: li.querySelector(".ffx-fli-s").getAttribute("data-state"),
      chip: li.querySelector(".ffx-fli-s").textContent, meta: li.querySelector(".ffx-fli-mt").textContent, differs: li.querySelector(".ffx-fli-d").textContent,
      ro: li.querySelector(".ffx-fli-r").textContent, action: li.querySelector(".ffx-link") ? [li.querySelector(".ffx-link").tagName, li.querySelector(".ffx-link").textContent, li.querySelector(".ffx-link").getAttribute("href")] : null,
    })));
    eq(got.map((r) => r.id), want.map((r) => r.id), "the rows are the six feed templates in order");
    eq(got.map((r) => r.state), want.map((r) => r.state), "EACH STATE IS THE LEAF'S STATE FOR THE STUB PAYLOAD");
    eq(got.map((r) => r.chip), want.map((r) => ER_COPY.fire.states[r.state]), "and its chip prints the copy's word");
    eq(new Set(want.map((r) => r.state)).size, 4, "the stub reaches four states (ready, plan, unstated, unlisted)");
    ok(got.every((r) => r.ro === "Read-only"), "every row carries the Read-only chip");
    eq(got.map((r) => r.title), want.map((r) => r.title), "titles");
    eq(got.map((r) => r.differs), want.map((r) => r.differs), "and what differs as the row's second line");
    eq(got[0].meta, "up to 50 a day · state, reason", "F01 prints its limit and its field names");
    eq(got[1].meta, "— limit not stated · no fields to test", "F02's missing limit is the dash");
    eq(got[4].meta, "up to 25 a day · — fields not in the feed's grammar", "F05 whose grammar lacks a field says so");
    eq(got.map((r) => r.action), [
      ["A", "Open the Halts view", "/flows/events/#view=halts"],
      ["BUTTON", "Use closest Flows template", null],
      ["A", "Open the Macro view", "/flows/events/#view=macro"],
      ["A", "Open the FDA view", "/flows/events/#view=fda"],
      ["BUTTON", "Use closest Flows template", null],
      ["BUTTON", "Use closest Flows template", null],
    ], "F01, F03 and F04 link to their Events view and the rest offer their closest template");
    ok(await page.evaluate(() => ![...document.querySelectorAll("#ffxFeedTpls button, #ffxFeedTpls a")].some((b) => /\b(arm|save|send|create)\b/i.test(b.textContent))), "NO ROW CAN BE ARMED, SAVED OR SENT");
    eq(await page.textContent("#ffxFeedFoot"), "Read-only: these are the feed's own alert types. Nothing here is armed or sent.", "a member's footer is the read-only line");
    eq(await page.locator("#ffxFeedFoot button").count(), 0, "with no Show all");

    await page.click('#ffxFeedTpls [data-feed="F02"] button');
    await page.waitForTimeout(200);
    eq(await page.evaluate(() => [document.querySelector('#ffxSeg [data-seg="flows"]').getAttribute("aria-checked"), document.getElementById("ffxTpls").hidden, document.getElementById("ffxFeedTpls").hidden, document.querySelector('[data-template="T07a"]').getAttribute("aria-pressed")]), ["true", false, true, "true"], "USE CLOSEST SELECTS T07 IN THE FLOWS LIST AND SWITCHES THE SEGMENT BACK");
    await page.click('#ffxSeg [data-seg="feed"]');
    await page.click('#ffxFeedTpls [data-feed="F06"] button');
    await page.waitForTimeout(200);
    eq(await page.getAttribute('[data-template="T02"]', "aria-pressed"), "true", "and F06 selects T02");
    eq(feedCalls(m.calls), 1, "still one read of the route");
    await m.ctx.close();
  }

  {
    const m = await open(browser, 1440, 820, { feed: { status: 200, body: { v: 1, feed: { ...FEED, owner: OWNER } } } });
    await chooseFeed(m.page);
    eq(await m.page.evaluate(() => document.getElementById("ffxFeedFoot").firstChild.textContent), "Your feed account: 2 alert definitions, 3 fired in 14 days", "AN OWNER'S FOOTER COUNTS THE ACCOUNT'S DEFINITIONS AND FIRINGS");
    await m.page.click("#ffxFeedFoot button");
    await m.page.waitForSelector("#ffxFeedCfg[open]");
    eq(await m.page.evaluate(() => [...document.querySelectorAll("#ffxFeedCfg tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent))), [["Halts on my names", "trading state", "Active", "symbols"], ["Reports", "earnings", "— status not stated", "— none"]], "Show all opens a dialog of the configs with a dash for each missing part");
    await m.page.keyboard.press("Escape");
    await m.page.waitForTimeout(150);
    eq(await m.page.locator("#ffxFeedCfg").count(), 0, "Escape closes it");
    const g = await geometry(m.page);
    eq(g.bad, [], "the owner footer fits");
    await m.ctx.close();
  }

  for (const [w, h] of [[390, 664], [1024, 660]]) {
    const m = await open(browser, w, h, { feed: { status: 200, body: { v: 1, feed: { ...FEED, owner: OWNER } } } });
    await chooseFeed(m.page);
    const g = await geometry(m.page);
    ok(!g.sw && !g.sh, `${w}x${h} the owner footer keeps one screen`);
    eq(g.bad, [], `${w}x${h} and clips nothing`);
    ok(await m.page.isVisible("#ffxFeedFoot"), `${w}x${h} the footer stays on a short screen`);
    await m.ctx.close();
  }

  {
    const m = await open(browser, 1440, 820, { feed: { status: 200, body: { status: "pending" } } });
    await chooseFeed(m.page);
    eq(await m.page.evaluate(() => [...document.querySelectorAll("#ffxFeedTpls .ffx-fli-s")].map((c) => c.textContent)), Array(6).fill("Not read yet"), "a payload not yet written reads Not read yet on every row");
    await m.ctx.close();
  }
  {
    const m = await open(browser, 1440, 820, { feed: { status: 404, body: { error: { code: "eventrisk_off", message: "off" } } } });
    await m.page.click('#ffxSeg [data-seg="feed"]');
    await m.page.waitForSelector("#ffxFeedTpls .ffx-fli-w:not(:empty)");
    await m.page.waitForFunction(() => !/Reading/.test(document.querySelector("#ffxFeedTpls").textContent));
    eq(await m.page.textContent("#ffxFeedTpls"), "The event-risk console is off for this account, so the feed's alert types are not read.", "the console off is said, with no Retry");
    await m.ctx.close();
  }
  {
    let n = 0;
    const m = await open(browser, 1440, 820, { feed: () => (++n === 1 ? { status: 500, body: { error: { code: "internal", message: "x" } } } : { status: 200, body: { v: 1, feed: FEED } }) });
    await m.page.click('#ffxSeg [data-seg="feed"]');
    await m.page.waitForSelector("#ffxFeedTpls .ffx-fli-w button");
    ok(/did not answer/.test(await m.page.textContent("#ffxFeedTpls")), "a failed read says so");
    await m.page.click("#ffxFeedTpls .ffx-fli-w button");
    await m.page.waitForSelector("#ffxFeedTpls .ffx-fli");
    eq(feedCalls(m.calls), 2, "and Retry reads it again");
    await m.ctx.close();
  }
  const noT07 = { ...registry, templates: registry.templates.filter((t) => t.id !== "T07") };
  const NO_T07_HTML = pageHtml(fireBody(glyph, noT07, { feed: true, feedSrc: "/assets/js/flows-er-fire.js" }));
  {
    const m = await open(browser, 1440, 820, { html: NO_T07_HTML });
    await chooseFeed(m.page);
    eq(await m.page.locator('#ffxFeedTpls [data-feed="F02"] .ffx-link').count(), 0, "a closest template the page cannot offer gets no button");
    await m.ctx.close();
  }

  const PLANTS = [
    ["a row with an Arm button", { js: plant(FEED_JS, "    li.append(head, d, ro, mt);\n", '    li.append(head, d, ro, mt);\n    { const arm = el("button", "ffx-link", "Arm"); arm.type = "button"; li.append(arm); }\n') }, async (m) => {
      await chooseFeed(m.page);
      return m.page.evaluate(() => ![...document.querySelectorAll("#ffxFeedTpls button, #ffxFeedTpls a")].some((b) => /\b(arm|save|send|create)\b/i.test(b.textContent)));
    }],
    ["a request to a feed path", { js: plant(FEED_JS, "    load();\n  }\n", '    load();\n    fetch("/api/alerts/configs").catch(() => {});\n  }\n') }, async (m) => {
      const before = m.calls.length;
      await chooseFeed(m.page);
      await m.page.waitForTimeout(200);
      return JSON.stringify(m.calls.slice(before).map((c) => c.path).filter((p) => !PAGE_OWN(p))) === JSON.stringify(["/api/flows/eventrisk"]);
    }],
    ["the owner footer for a member", { js: plant(FEED_JS, "    if (!owner || typeof owner !== \"object\") return null;\n", "    if (!owner || typeof owner !== \"object\") owner = {};\n") }, async (m) => {
      await chooseFeed(m.page);
      return (await m.page.textContent("#ffxFeedFoot")) === "Read-only: these are the feed's own alert types. Nothing here is armed or sent.";
    }],
    ["closest kept for a template the page cannot offer", { html: NO_T07_HTML, js: plant(FEED_JS, "const closest = t.closest && hasAst(t.closest) ? t.closest : null;", "const closest = t.closest || null;") }, async (m) => {
      await chooseFeed(m.page);
      return (await m.page.locator('#ffxFeedTpls [data-feed="F02"] .ffx-link').count()) === 0;
    }],
    ["the segment fetches the group at load", { js: plant(FIRE_JS, "    var asked = false;\n", "    var asked = false;\n    window.FlowsUI.defer(\"er-fire\");\n") }, async (m) => !(await fetchedFeed(m.page))],
    ["the closest button that never switches back", { js: plant(FIRE_JS, "      choose(\"flows\", true);\n      row.click();\n", "      row.click();\n") }, async (m) => {
      await chooseFeed(m.page);
      await m.page.click('#ffxFeedTpls [data-feed="F02"] button');
      await m.page.waitForTimeout(200);
      return m.page.evaluate(() => !document.getElementById("ffxTpls").hidden && document.getElementById("ffxFeedTpls").hidden);
    }],
    ["feed rows that grow the panel", { css: plant("assets/css/flows-ff-fire.css", ".ffx-feed { grid-auto-rows: minmax(44px, 64px); }\n.ffx-fli {", ".ffx-feed { grid-auto-rows: minmax(44px, 64px); }\n.ffx-tpl:has(.ffx-feed:not([hidden])) { min-height: 1400px; }\n.ffx-fli {") }, async (m) => {
      const panel = await boxOf(m.page, "#ffxTpl");
      await chooseFeed(m.page);
      const g = await geometry(m.page);
      return JSON.stringify(await boxOf(m.page, "#ffxTpl")) === JSON.stringify(panel) && !g.sh;
    }],
  ];
  for (const [name, o, check] of PLANTS) {
    const m = await open(browser, 1440, 820, { ...o, html: o.html });
    const passed = await check(m).catch(() => false);
    await m.ctx.close();
    ok(!passed, "PLANTED WRONG BUILD, " + name + ": the check fails it");
  }
} finally {
  await browser.close();
}

if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error("✗ " + f);
  console.error(`flows-er-fire-render: ${failures.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`✓ flows-er-fire-render: ${checks} checks — the Fire page's From the feed segment at ${SIZES.length} sizes: the group fetched only when chosen, the list swapped in the Start panel's own box with no scroll and nothing clipped, the keyboard, the leaf's state for each row and the copy's word, the view links and the closest template selected with the segment switched back, the owner footer and its dialog for an owner only, the pending, off and failed states, one read of /api/flows/eventrisk and no other request, the browser copy equal to the leaf over 200 random feeds, the body byte for byte with the feed off, and planted wrong builds that each fail`);
