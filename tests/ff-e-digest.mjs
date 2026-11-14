import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { launch } from "./lib/browser.mjs";
import { COPY_BANNED, DIGEST_QUADRANTS } from "../shared/ff-contract.js";
import { FLOWS_PAGES } from "../shared/flows-pages.js";
import { DIGEST_CALIBRATION_LINE, DIGEST_SHADOW_LINE, DIGEST_COLUMNS } from "../shared/ff-pages-inbox.js";
import { DASH, ROOT, SIZES, busy, digest, group, house, mount, quadrant, EMPTY_RECEIPTS } from "./lib/ff-e-digest-world.mjs";

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const JS = "assets/js/flows-ff-digest.js";
const CSS = "assets/css/flows-ff-inbox.css";
const BANNED = new RegExp("\\b(" + COPY_BANNED.join("|") + ")\\b", "i");
const CLOCK = /\b\d{1,2}:\d{2}(?!\d)(?!:)(?! TRT)/;

function plant(file, from, to) {
  const src = read(file);
  if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once in " + file + ": " + from.slice(0, 80));
  return { path: file, body: src.replace(from, to) };
}

function loadModel(src) {
  const ctx = { window: { FlowsUI: Object.freeze({}) }, Object, Array, JSON, String, Number };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.FlowsUI.ffDigest;
}

function modelBattery(src, count = false) {
  const bad = [];
  const t = (c, m) => { if (count) checks++; if (!c) bad.push(m); };
  const api = loadModel(src);
  if (!api || typeof api.model !== "function") return ["no model"];
  const shadowEmpty = api.model(digest(), { shadow: true });
  t(shadowEmpty.quadrants.length === 4, "four quadrants");
  t(shadowEmpty.quadrants.map((q) => q.id).join() === DIGEST_QUADRANTS.join(), "quadrant order is the contract's");
  t(shadowEmpty.quadrants.every((q) => q.count === "0 delivered" && /held/.test(q.empty)), "shadow says held, not an empty list: " + JSON.stringify(shadowEmpty.quadrants[0]));
  const plain = api.model(digest(), { shadow: false });
  t(plain.quadrants.every((q) => q.count === "0 hits" && q.empty === "No hit in this session."), "a delivered zero is a real zero");
  t(plain.quadrants.every((q) => q.receipts === "14 evaluated, 1 not evaluated: run_late"), "receipts line carried verbatim");
  t(plain.quadrants[0].run === "run ok, finished Fri 14 Nov · 00:41 TRT", "run line: " + plain.quadrants[0].run);
  const noRun = api.model(digest({ quadrants: { "house-nightly": quadrant("house-nightly", [], { run: { v: null, text: DASH, reason: "not_measured", reasonText: "no run recorded for this session" } }) } }), {});
  t(noRun.quadrants[0].run === DASH + " no run recorded for this session", "absent run is a dash with its reason: " + noRun.quadrants[0].run);
  const noRc = api.model(digest({ receipts: EMPTY_RECEIPTS }), {});
  t(noRc.quadrants.every((q) => q.receiptsAbsent === true), "absent receipts flagged");
  const g = api.model(digest({ quadrants: { "yours-live": quadrant("yours-live", [group(7, 9), group(8, 2, { sentence: { v: null, text: DASH, reason: "no_sentence", reasonText: "the stored hit carries no sentence" } })]) } }), {});
  const q = g.quadrants[3];
  t(q.total === 11 && q.count === "11 hits", "total counts every hit: " + q.count);
  t(q.groups[0].more === 6 && q.groups[0].hits.length === 3 && q.groups[0].count === 9, "a grouped wire keeps three and counts the rest");
  t(q.groups[0].rarity === "1 in 12 sessions" && q.groups[0].rarityAbsent === null, "rarity present");
  t(q.groups[1].rarity === DASH + " under 20 sessions of history" && q.groups[1].rarityAbsent === "short_history", "short history rarity is a dash with its reason: " + q.groups[1].rarity);
  t(q.groups[1].hits[0].sentence === DASH + " the stored hit carries no sentence" && q.groups[1].hits[0].sentenceAbsent === "no_sentence", "absent sentence");
  t(q.groups[0].hits[0].sentence.indexOf(q.groups[0].hits[0].symbol) !== 0 && /^Net premium/.test(q.groups[0].hits[0].sentence), "sentence drops the leading symbol it repeats: " + q.groups[0].hits[0].sentence);
  const inc = api.model(digest({ quadrants: { "yours-live": quadrant("yours-live", [], { complete: false }) } }), {});
  t(/^— not measured: the stored hits do not reach back/.test(inc.quadrants[3].incomplete || "") && !BANNED.test(inc.quadrants[3].incomplete), "incomplete window said in the page's own words");
  const r = api.recordModel(house());
  t(r.following === 3, "three followed");
  t(r.lines[0].figure === "0 firings in 9 sessions", "a zero firing count is a real zero: " + r.lines[0].figure);
  t(r.lines[1].figure === "3 firings in 36 sessions" && r.lines[3].figure === "1 firing in 22 sessions", "firings: " + r.lines[1].figure + " / " + r.lines[3].figure);
  t(r.lines[2].figure === DASH + " no record yet" && r.lines[2].figureAbsent === "no_record", "no record is a dash, never zero: " + r.lines[2].figure);
  t(!/\b0\b/.test(r.lines[2].figure), "absent record carries no zero");
  t(api.model({}, {}) === null && api.recordModel({}) === null, "unreadable bodies are null");
  return bad;
}

async function pageBattery(browser, o = {}) {
  const bad = [];
  const t = (c, m) => { if (o.count) checks++; if (!c) bad.push(m); };
  const files = o.files || [];
  const sizes = o.sizes || SIZES;
  for (const [w, h] of sizes) {
    for (const [name, opts] of [["shadow", {}], ["busy", { shadow: false, digest: busy() }]]) {
      const views = w < 900 ? ["house", "yours", "record"] : ["all"];
      for (const v of views) {
        const { ctx, page, errors } = await mount(browser, w, h, { ...opts, files });
        const tag = name + " " + w + "x" + h + " " + v;
        if (v !== "all") {
          await page.click('#ffxDigTabs [data-v="' + v + '"]');
          await page.waitForTimeout(120);
        }
        const g = await page.evaluate(() => {
          const out = [];
          const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest(".visually-hidden"); };
          const de = document.documentElement;
          if (de.scrollHeight > innerHeight + 1) out.push("page scroll " + de.scrollHeight);
          if (de.scrollWidth > innerWidth + 1) out.push("sideways scroll " + de.scrollWidth);
          const tabs = document.getElementById("fxTabs");
          const floor = tabs && vis(tabs) && getComputedStyle(tabs).position === "fixed" ? tabs.getBoundingClientRect().top : innerHeight;
          for (const e of document.querySelectorAll("#ffxDigest .ffx-panel")) {
            if (!vis(e)) continue;
            const r = e.getBoundingClientRect();
            if (r.bottom > floor + 1 || r.right > innerWidth + 1) out.push("panel off screen or under the tab bar: " + e.id + " " + Math.round(r.bottom) + ">" + Math.round(floor));
          }
          for (const e of document.querySelectorAll("#ffxDigest *")) {
            if (!vis(e)) continue;
            const cs = getComputedStyle(e);
            if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) out.push("inner scroll " + e.className);
            if (cs.overflow === "hidden" && e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== "ellipsis") out.push("cut with no ellipsis: " + e.textContent.slice(0, 40));
            if (cs.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1 && !e.title) out.push("truncated with no title: " + e.textContent.slice(0, 40));
          }
          for (const e of document.querySelectorAll("#ffxDigest .ffx-dig-g, #ffxDigest .ffx-dig-rc, #ffxDigest .ffx-dig-qh")) {
            if (!vis(e)) continue;
            const box = (e.closest(".ffx-dig-q") || e.closest(".ffx-panel")).getBoundingClientRect();
            const r = e.getBoundingClientRect();
            if (r.bottom > box.bottom + 1 || r.top < box.top - 1) out.push("a row leaves its quadrant: " + e.textContent.slice(0, 40));
          }
          for (const list of document.querySelectorAll("#ffxDigest .ffx-dig-list")) {
            if (!vis(list)) continue;
            if (list.scrollHeight > list.clientHeight + 1) out.push("list overflows its box: " + (list.closest("[data-q]") || list).id + " " + list.scrollHeight + ">" + list.clientHeight);
          }
          for (const n of document.querySelectorAll("#ffxDigest [data-ff-absent]")) {
            if (/(^|\s)0(\s|$)/.test(n.textContent)) out.push("an absent figure holds a zero: " + n.textContent);
            if (n.textContent.trim().indexOf("—") !== 0) out.push("an absent figure without the dash: " + n.textContent);
          }
          const text = [];
          const walk = document.createTreeWalker(document.getElementById("ffxDigest"), NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) { const p = n.parentElement; if (p && vis(p)) text.push(n.textContent.trim()); }
          const qs = [...document.querySelectorAll("#ffxDigest [data-q]")].filter(vis).map((q) => ({
            id: q.getAttribute("data-q"), n: q.querySelector('[data-k="n"]').textContent, rc: q.querySelector('[data-k="rc"]').textContent,
            empty: q.querySelector('[data-k="empty"]').hidden ? null : q.querySelector('[data-k="empty"]').textContent,
            all: q.querySelector('[data-k="all"]').hidden ? null : q.querySelector('[data-k="all"]').textContent,
            groups: q.querySelectorAll(".ffx-dig-g:not(.ffx-cut)").length, cut: q.querySelectorAll(".ffx-dig-g.ffx-cut").length,
          }));
          const banner = document.getElementById("ffxDigBanner");
          const cal = document.getElementById("ffxDigCal");
          return { out, text: text.filter(Boolean).join(" | "), qs, banner: vis(banner) ? banner.textContent : null, cal: cal && vis(cal) ? cal.textContent : null, calAbsent: cal ? cal.getAttribute("data-ff-absent") : null, recs: document.querySelectorAll("#ffxDigRecs .ffx-dig-g").length };
        });
        for (const m of g.out) t(false, tag + ": " + m);
        t(errors.length === 0, tag + ": page errors " + errors.join("; "));
        t(!BANNED.test(g.text), tag + ": banned copy word in " + (g.text.match(BANNED) || [])[0]);
        t(!CLOCK.test(g.text), tag + ": a clock time without TRT: " + (g.text.match(CLOCK) || [])[0]);
        t(!/\bvendor\b/i.test(g.text) && !/\btape\b/i.test(g.text), tag + ": vendor or tape in reader copy");
        if (name === "shadow") t(g.banner === DIGEST_SHADOW_LINE, tag + ": shadow banner " + g.banner);
        else t(g.banner === null, tag + ": no shadow banner when on");
        const want = v === "all" ? DIGEST_QUADRANTS : v === "record" ? [] : DIGEST_COLUMNS.find((c) => c.id === v).quadrants;
        t(JSON.stringify(g.qs.map((q) => q.id)) === JSON.stringify(want), tag + ": quadrants shown " + JSON.stringify(g.qs.map((q) => q.id)));
        for (const q of g.qs) {
          t(q.rc.startsWith("14 evaluated, 1 not evaluated: run_late · run ok, finished Fri 14 Nov · 00:41 TRT"), tag + " " + q.id + ": receipts line " + q.rc);
          if (name === "shadow") {
            t(q.n === "0 delivered" && q.empty === "No hit delivered: in shadow every hit is held.", tag + " " + q.id + ": shadow empty state " + q.n + " / " + q.empty);
          } else {
            t(q.empty === null && /^\d+ hits?$/.test(q.n), tag + " " + q.id + ": count " + q.n);
            t(q.groups >= 1, tag + " " + q.id + ": at least one group shown");
            t(q.cut === 0 ? q.all === null : q.all === "Show all " + (q.groups + q.cut), tag + " " + q.id + ": Show all names the full count (" + q.all + ", " + q.groups + "+" + q.cut + ")");
          }
        }
        if (v === "all" || v === "record") {
          t(g.cal === DIGEST_CALIBRATION_LINE && g.calAbsent === "not_released", tag + ": calibration not released");
          t(g.recs >= 1, tag + ": record rows");
        }
        await ctx.close();
      }
    }
  }
  return bad;
}

async function behaviourBattery(browser, files = [], count = false) {
  const bad = [];
  const t = (c, m) => { if (count) checks++; if (!c) bad.push(m); };
  {
    const { ctx, page, calls } = await mount(browser, 1440, 820, { shadow: false, digest: busy(), files, search: "?d=2026-11-12" });
    t(calls.some((c) => c.path === "/api/ff/digest" && c.query === "?d=2026-11-12"), "the address session reaches the API: " + JSON.stringify(calls.map((c) => c.path + c.query)));
    const btn = page.locator('#ffxDig-house-nightly [data-k="all"]');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(150);
      const n = await page.evaluate(() => ({ open: document.getElementById("ffxDigAll").open, rows: document.querySelectorAll("#ffxDigAllList .ffx-dig-g").length, title: document.getElementById("ffxDigAllT").textContent }));
      t(n.open && n.rows === 40 && n.title === "House · Nightly: all hits", "Show all lists every group: " + JSON.stringify(n));
      await page.keyboard.press("Escape");
    } else t(false, "Show all hidden on a busy quadrant");
    const cap = await page.textContent("#ffxDigCap");
    t(cap === "Session 2026-11-13 · computed when read", "caption " + cap);
    await ctx.close();
  }
  {
    const { ctx, page } = await mount(browser, 390, 844, { files });
    await page.focus("#ffxDigTabHouse");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(80);
    let s = await page.evaluate(() => ({ view: document.getElementById("ffxDigest").getAttribute("data-view"), sel: document.querySelector('#ffxDigTabs [aria-selected="true"]').getAttribute("data-v"), focus: document.activeElement.id }));
    t(JSON.stringify(s) === JSON.stringify({ view: "yours", sel: "yours", focus: "ffxDigTabYours" }), "arrow key moves to Yours: " + JSON.stringify(s));
    await page.keyboard.press("End");
    await page.waitForTimeout(80);
    s = await page.evaluate(() => document.getElementById("ffxDigest").getAttribute("data-view"));
    t(s === "record", "End moves to Record: " + s);
    await ctx.close();
  }
  {
    let n = 0;
    const d = () => (++n === 1 ? { status: 503, body: { error: { code: "store_unreadable", message: "the store could not be read" } } } : digest());
    const { ctx, page, calls } = await mount(browser, 1440, 820, { files, digest: d, house: { status: 503, body: { error: { code: "store_unreadable", message: "the store could not be read" } } } });
    const s = await page.evaluate(() => ({
      cap: document.getElementById("ffxDigCap").textContent, capAbsent: document.getElementById("ffxDigCap").getAttribute("data-ff-absent"),
      retry: !document.getElementById("ffxDigRetry").hidden, n: document.querySelector('#ffxDig-house-nightly [data-k="n"]').textContent,
      rec: document.getElementById("ffxDigRecs").textContent,
    }));
    t(s.cap === DASH + " the store could not be read" && s.capAbsent === "store_unreadable", "failed digest caption " + JSON.stringify(s));
    t(s.retry, "Retry offered");
    t(s.n.startsWith(DASH + " unavailable"), "quadrant says unavailable, never an empty list: " + s.n);
    t(s.rec.startsWith(DASH + " the record is unavailable"), "record unavailable: " + s.rec);
    await page.click("#ffxDigRetry");
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.querySelector('#ffxDig-house-nightly [data-k="n"]').textContent);
    t(after === "0 delivered" && calls.filter((c) => c.path === "/api/ff/digest").length === 2, "Retry reads again: " + after);
    await ctx.close();
  }
  {
    const { ctx, page } = await mount(browser, 1440, 820, { files, search: "?d=2025-01-02", digest: { status: 400, body: { error: { code: "ff_export_range", message: "That session is outside the digest window of 10 sessions" }, latest: "2026-11-13" } } });
    const s = await page.evaluate(() => ({ latest: !document.getElementById("ffxDigLatest").hidden, retry: !document.getElementById("ffxDigRetry").hidden, cap: document.getElementById("ffxDigCap").textContent }));
    t(s.latest && !s.retry && s.cap === DASH + " that session is outside the digest window", "out of window offers the latest session: " + JSON.stringify(s));
    await ctx.close();
  }
  {
    const { ctx, page } = await mount(browser, 1440, 820, { files, digest: digest({ session: "2026-11-12", latest: "2026-11-13" }) });
    const s = await page.evaluate(() => ({ latest: !document.getElementById("ffxDigLatest").hidden, cap: document.getElementById("ffxDigCap").textContent }));
    t(s.latest && s.cap === "Session 2026-11-12 · the latest is 2026-11-13 · computed when read", "an older session links the latest: " + JSON.stringify(s));
    await ctx.close();
  }
  return bad;
}

function serverChecks() {
  const on = FLOWS_PAGES.digestPage({ username: "x", shadow: false });
  const sh = FLOWS_PAGES.digestPage({ username: "x", shadow: true });
  ok(on.includes('data-ff-page="digest"') && sh.includes('data-ff-page="digest"'), "page carries the digest hook");
  ok(sh.includes(DIGEST_SHADOW_LINE) && !on.includes(DIGEST_SHADOW_LINE), "shadow line only in shadow");
  ok(on.includes('data-flows-page="digest"'), "body names the page");
  ok(!on.includes("not released yet"), "the digest is no longer the not-released placeholder");
  ok(on.includes(DIGEST_CALIBRATION_LINE.replace(/&/g, "&amp;")) || on.includes(DIGEST_CALIBRATION_LINE), "calibration not released line served");
  for (const id of DIGEST_QUADRANTS) ok(on.includes('id="ffxDig-' + id + '"'), "quadrant " + id + " served");
  const routes = read("server/routes/flows-pages.js");
  ok(/slug: "digest", ff: "inbox", render: [^\n]*FLOWS_PAGES\.digestPage\(\{ username, shadow: ffMode\(env\) === "shadow" \}\)/.test(routes), "the page row renders digestPage with the shadow switch");
  const js = read(JS);
  ok(!/\bfetch\(/.test(js), "no fetch( in the digest script");
  ok(!/\/\/|\/\*/.test(js.replace(/https?:\/\//g, "")), "no comments in the digest script");
  ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(read(CSS)), "no colour literal in the digest sheet");
  ok(!/new Date|toLocale|getHours|Intl\./.test(js), "no time computed in the browser");
}

const PLANTS = [
  { id: "render-every-row", kind: "page", files: [plant(JS, "var got = K && K.fit ? K.fit.rows(list, { keep: 1 }) : { cut: 0 };", "var got = { cut: 0 };"), plant(CSS, ".ffx-dig-q .ffx-dig-list { flex: 1 1 auto; }", ".ffx-dig-q .ffx-dig-list { flex: none; }")] },
  { id: "absent-rarity-as-zero", kind: "model", src: plant(JS, 'var rarity = said(g.rarity, "under 20 sessions of history");', 'var rarity = g.rarity && g.rarity.v !== null ? said(g.rarity) : { text: "0", reason: "short_history" };').body },
  { id: "absent-record-as-zero", kind: "model", src: plant(JS, '      figure = said(rec, "no record yet");', '      figure = { text: "0 firings in 0 sessions", reason: null };').body },
  { id: "shadow-not-said", kind: "model", src: plant(JS, 'count: shadow && total === 0 ? "0 delivered" : plural(total, "hit", "hits"),', 'count: plural(total, "hit", "hits"),').body },
  { id: "receipts-dropped", kind: "page", files: [plant(JS, 'put(part(q, "rc"), m.receipts + " · " + m.run, m.receiptsAbsent ? "no_receipts" : null);', 'put(part(q, "rc"), m.run);')] },
  { id: "session-ignored", kind: "behaviour", files: [plant(JS, 'return "/api/ff/digest" + (d ? "?d=" + encodeURIComponent(d) : "");', 'return "/api/ff/digest";')] },
  { id: "no-phone-gutter", kind: "page", sizes: [[390, 844]], files: [plant(CSS, '  .flows-body[data-flows-page="digest"] .flows-main { padding-bottom: calc(var(--tab-h) + var(--safe-b) + var(--sp-3)); }\n', "")] },
  { id: "tabs-dead", kind: "page", sizes: [[390, 844]], files: [plant(JS, "    if (t) setView(t.getAttribute(\"data-v\"));", "    void t;")] },
  { id: "retry-missing", kind: "behaviour", files: [plant(JS, "    retry.hidden = err && (err.code === \"ff_export_range\" || err.code === \"ff_cursor_invalid\");", "    retry.hidden = true;")] },
  { id: "group-total-from-shown", kind: "model", src: plant(JS, 'count: typeof g.count === "number" ? g.count : (g.hits || []).length,', "count: (g.hits || []).length,").body },
  { id: "show-all-cut-only", kind: "behaviour", files: [plant(JS, "    m.groups.forEach(function (g) { allList.appendChild(groupItem(g)); });\n    allDlg.showModal();", "    m.groups.slice(0, 3).forEach(function (g) { allList.appendChild(groupItem(g)); });\n    allDlg.showModal();")] },
];

const only = process.env.FF_E_ONLY || "";
serverChecks();
const realModel = modelBattery(read(JS), true);
for (const m of realModel) failures.push("model: " + m);
const browser = await launch();
try {
  if (!only || only === "page") for (const m of await pageBattery(browser, { count: true })) failures.push(m);
  if (!only || only === "behaviour") for (const m of await behaviourBattery(browser, [], true)) failures.push(m);
  if (!only || only === "plants") {
    for (const p of PLANTS) {
      let got;
      try {
        if (p.kind === "model") got = modelBattery(p.src);
        else if (p.kind === "page") got = await pageBattery(browser, { files: p.files, sizes: p.sizes || [[1440, 820], [390, 664]] });
        else got = await behaviourBattery(browser, p.files);
      } catch (e) {
        got = ["threw: " + String(e && e.message).split("\n")[0]];
      }
      ok(got.length > 0, "planted build " + p.id + " passed");
      console.log((got.length > 0 ? "killed " : "SURVIVED ") + p.id + (got.length ? ": " + got[0].slice(0, 120) : ""));
    }
  }
} finally {
  await browser.close();
}

for (const f of failures.slice(0, 40)) console.log("FAIL " + f);
console.log((failures.length ? "✗" : "✓") + " ff-e-digest: " + checks + " assertions, " + failures.length + " failed");
process.exit(failures.length ? 1 : 0);
