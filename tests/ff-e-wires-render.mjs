import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch } from "./lib/browser.mjs";
import { COPY_BANNED, LIMITS } from "../shared/ff-contract.js";
import { mount as mountRaw, SIZES, ROOT, DASH, makeState, makeWire, limitsOf, health, tickerHtml } from "./lib/ff-e-wires-world.mjs";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const PLANTS_ONLY = process.argv.includes("--plants");
const SKIP_PLANTS = process.argv.includes("--no-plants");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

let checks = 0;
let failures = [];
let stopFast = false;
const ok = (c, m) => { checks++; if (!c) { failures.push(m); if (stopFast) throw new Error("stop"); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
let FILES = [];
const mount = (b, w, h, o = {}) => mountRaw(b, w, h, { files: FILES, ...o });
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BANNED = new RegExp("\\b(" + COPY_BANNED.join("|") + ")\\b", "i");
const WIRES_JS = "assets/js/flows-ff-wires.js";
const MARK_JS = "assets/js/flows-ff-mark.js";
const MARK_CSS = "assets/css/flows-ff-mark.css";
const PANEL_JS = "assets/js/flows-ff-name-panel.js";
const INBOX_CSS = "assets/css/flows-ff-inbox.css";
const plantAll = (file, pairs) => {
  let src = read(file);
  for (const [from, to] of pairs) {
    if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once in " + file + ": " + from.slice(0, 70));
    src = src.replace(from, to);
  }
  return { path: file, body: src };
};
const plant = (file, from, to) => {
  const src = read(file);
  if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once in " + file + ": " + from.slice(0, 70));
  return { path: file, body: src.replace(from, to) };
};

const fits = (page) => page.evaluate(() => {
  const de = document.documentElement;
  const out = { pageScroll: de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1, scrollers: [], clipped: [], untitled: [] };
  for (const n of document.querySelectorAll(".flows-main *")) {
    if (n.closest("dialog:not([open]), [hidden], .visually-hidden")) continue;
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1) && !n.closest("dialog")) out.scrollers.push(n.className || n.tagName);
    if (cs.textOverflow === "ellipsis" && n.scrollWidth > n.clientWidth + 1 && !n.getAttribute("title") && !n.closest("[title]")) out.untitled.push(n.className + ": " + n.textContent.slice(0, 40));
    if (n.closest("dialog") || n.closest("svg") || n.children.length || !n.textContent.trim()) continue;
    const a = n.getBoundingClientRect();
    if (!a.height) continue;
    for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === "hidden" || getComputedStyle(p).overflow === "hidden") {
        const b = p.getBoundingClientRect();
        if (a.bottom > b.bottom + 1 || a.top < b.top - 1) { out.clipped.push(n.className + ": " + n.textContent.slice(0, 30)); break; }
      }
    }
  }
  return out;
});

const ANIM = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  return n ? n.getAnimations().filter((a) => a.playState === "running").length : -1;
}, sel);

const SUITES = {
  async layout(b) {
    const big = makeState({ wires: Array.from({ length: 25 }, (_, i) => makeWire(i, { status: i % 5 === 3 ? "paused" : "armed", version: 3 + (i % 8), names: 1 + (i % 25) })) });
    for (const [w, h] of SIZES) {
      for (const view of w < 1100 ? ["list", "wire"] : ["both"]) {
        const m = await mount(b, w, h, { state: big, search: "?wire=" + big.wires[7].id });
        if (view !== "both") { await m.page.click(view === "list" ? "#ffxWrTabList" : "#ffxWrTabWire"); await m.page.waitForTimeout(250); }
        const f = await fits(m.page);
        ok(!f.pageScroll, `layout ${w}x${h} ${view}: no page scroll`);
        eq(f.scrollers, [], `layout ${w}x${h} ${view}: no scrolling container`);
        eq(f.clipped, [], `layout ${w}x${h} ${view}: no text cut by an overflow-hidden parent`);
        eq(f.untitled, [], `layout ${w}x${h} ${view}: every truncated line carries a title`);
        if (view !== "wire") {
          const shown = await m.page.$$eval("#ffxWrList .ffx-wr-li:not(.ffx-cut)", (x) => x.length);
          const total = await m.page.$$eval("#ffxWrList .ffx-wr-li", (x) => x.length);
          ok(shown >= 1 && total === big.wires.length, `layout ${w}x${h}: the list holds every wire and shows at least one (${shown} of ${total})`);
          if (shown < total) eq(await m.page.textContent("#ffxWrMore"), "+" + (total - shown) + " more", `layout ${w}x${h}: the cut rows are counted`);
          ok(shown === total || !(await m.page.$eval("#ffxWrAll", (x) => x.hidden)), `layout ${w}x${h}: a cut list offers Show all`);
        }
        eq(m.errors, [], `layout ${w}x${h}: no page error`);
        await m.ctx.close();
      }
    }
    const m = await mount(b, 1440, 820, { state: big });
    await m.page.click("#ffxWrAll");
    eq(await m.page.$$eval("#ffxWrAllDlg[open] .ffx-wr-li", (x) => x.length), big.wires.length, "show all: the dialog lists every wire");
    await m.ctx.close();
  },

  async listAndDetail(b) {
    const st = makeState();
    const m = await mount(b, 1440, 820, { state: st, search: "?wire=" + st.wires[1].id });
    const l = limitsOf(st.wires);
    eq(await m.page.textContent("#ffxWrCap"), `${l.armed.used} of ${LIMITS.armedMemberWires} wires armed · ${l.live.used} of ${LIMITS.liveMemberWires} live · ${l.universe.used} of ${LIMITS.universeMemberWires} universe-wide · false alarms 0.4 of 2 a week`, "caption: the limits the Fire page states, from the API");
    eq(await m.page.$$eval("#ffxWrList .ffx-wr-row", (x) => x.map((r) => r.getAttribute("data-ff-wire"))), st.wires.filter((w) => w.status !== "retired").map((w) => w.id), "list: every wire in use, retired ones apart");
    eq(await m.page.getAttribute(`#ffxWrList [data-ff-wire="${st.wires[1].id}"]`, "aria-current"), "true", "deep link: ?wire= selects that wire");
    const vers = await m.page.$$eval("#ffxWrDetail .ffx-wr-v", (x) => x.map((v) => [v.getAttribute("data-version"), v.querySelector(".ffx-wr-vs").textContent]));
    eq(vers, st.wires[1].versions.slice().reverse().map((v) => [String(v.version), v.sentence]), "history: every version newest first, each with its own sentence (H12)");
    ok(vers.length > 1 && vers[0][1] !== vers[1][1], "history: an old version keeps the sentence it was armed under");
    const exp = await m.page.$eval("#ffxWrDetail .ffx-wr-facts", (dl) => { const dts = [...dl.querySelectorAll("dt")]; const i = dts.findIndex((d) => d.textContent === "False alarms a week"); const dd = dl.querySelectorAll("dd")[i]; return [dd.textContent, dd.getAttribute("data-ff-absent")]; });
    eq(exp, [DASH + " no expected false alarms: a fact wire has no statistical test", "not_measured"], "absent: the false-alarm rate is a dash with its reason, never zero");
    const text = await m.page.$eval(".flows-main", (n) => n.innerText);
    ok(!BANNED.test(text) && !/\btape\b/i.test(text), "copy: no banned word on the page");
    ok(!/\b0 false alarms\b/.test(text), "copy: no zero for an absent figure");
    for (const t of text.match(/\b\d{1,2}:\d{2}\b(?! TRT)/g) || []) ok(false, "every time ends in TRT: " + t);
    await m.page.addScriptTag({ content: AXE });
    const axe = await m.page.evaluate(() => window.axe.run(".flows-main", { runOnly: ["wcag2a", "wcag2aa"], rules: { "color-contrast": { enabled: false } } }));
    eq(axe.violations.map((v) => v.id), [], "axe: no violation");
    await m.ctx.close();
  },

  async actions(b) {
    const st = makeState();
    const m = await mount(b, 1440, 820, { state: st, search: "?wire=" + st.wires[0].id });
    await m.page.click('#ffxWrDetail [data-k="pause"]');
    await m.page.waitForSelector('#ffxWrDetail [data-k="arm"]');
    const patch = m.calls.filter((c) => c.method === "PATCH");
    eq(patch.map((c) => c.body), [{ id: st.wires[0].id, status: "paused" }], "pause: one PATCH that pauses the wire, and nothing else");
    ok(!JSON.stringify(patch[0].body).includes("member"), "pause: no member id is sent");
    eq(await m.page.getAttribute(`#ffxWrList [data-ff-wire="${st.wires[0].id}"]`, "data-status"), "paused", "pause: the row says paused");
    await m.page.click('#ffxWrDetail [data-k="arm"]');
    await m.page.waitForSelector('#ffxWrDetail [data-k="pause"]');
    eq(m.calls.filter((c) => c.method === "PATCH").at(-1).body, { id: st.wires[0].id, status: "armed" }, "arm: the PATCH arms it");
    await m.page.click('#ffxWrDetail [data-k="retire"]');
    await m.page.waitForSelector('#ffxWrDetail [data-k="restore"]');
    eq(m.calls.filter((c) => c.method === "PATCH").at(-1).body, { id: st.wires[0].id, status: "retired" }, "retire: the PATCH retires it");
    ok(!(await m.page.$(`#ffxWrList [data-ff-wire="${st.wires[0].id}"]`)), "retire: it leaves the In use list");
    await m.page.click('#ffxWrDetail [data-k="restore"]');
    await m.page.waitForSelector('#ffxWrDetail [data-k="pause"]');
    eq(m.calls.filter((c) => c.method === "PATCH").at(-1).body, { id: st.wires[0].id, status: "armed" }, "restore: a retired wire is restored by arming it");
    await m.page.click('#ffxWrFilters [data-f="retired"]');
    await m.page.waitForSelector("#ffxWrList .ffx-wr-row");
    eq(await m.page.$$eval("#ffxWrList .ffx-wr-row", (x) => x.map((r) => r.getAttribute("data-ff-wire"))), [st.wires[4].id], "retired filter: lists only the retired wires");
    eq(m.errors, [], "actions: no page error");
    await m.ctx.close();

    const full = makeState();
    full.limits = limitsOf(full.wires, { armed: { used: 50, max: 50 } });
    const f = await mount(b, 1440, 820, { state: full, search: "?wire=" + full.wires[2].id });
    eq(await f.page.getAttribute('#ffxWrDetail [data-k="arm"]', "aria-disabled"), "true", "limit: at 50 of 50 arming is disabled");
    await f.page.click('#ffxWrDetail [data-k="arm"]', { force: true });
    await f.page.waitForTimeout(200);
    eq(f.calls.filter((c) => c.method === "PATCH").length, 0, "limit: the disabled arm sends nothing");
    ok(/^— 50 of 50 wires are armed\./.test(await f.page.textContent("#ffxWrDetail .ffx-wr-out")), "limit: and says which limit, as a dash with its reason");
    await f.ctx.close();

    const lw = makeState({ wires: [makeWire(0, { status: "paused", cadence: "live" }), makeWire(1)] });
    lw.limits = limitsOf(lw.wires, { live: { used: 5, max: 5 } });
    const g = await mount(b, 1440, 820, { state: lw, search: "?wire=" + lw.wires[0].id });
    ok(/5 of 5 live wires are armed/.test(await g.page.textContent("#ffxWrDetail .ffx-wr-out")), "limit: a paused live wire at 5 of 5 live cannot be armed and says so");
    await g.ctx.close();

    const r = await mount(b, 1440, 820, { state: makeState(), search: "?wire=" + makeState().wires[1].id, api: async (c) => (c.method === "PATCH" ? c.json({ error: { code: "ff_wire_limit", message: "limit", details: { limit: "live" } } }, 409) : undefined) });
    await r.page.click('#ffxWrDetail [data-k="pause"]');
    await r.page.waitForFunction(() => /most live wires/.test(document.querySelector("#ffxWrDetail .ffx-wr-out").textContent));
    ok(true, "error: ff_wire_limit names the limit");
    await r.ctx.close();

    const off = await mount(b, 1440, 820, { api: async (c) => (c.path === "/api/ff/wires" ? c.json({ error: { code: "ff_off", message: "off", details: { reason: "route_off" } } }, 404) : undefined) });
    eq([await off.page.getAttribute("#ffxWrState", "data-ff-absent"), await off.page.textContent("#ffxWrState")], ["ff_off", DASH + " Wires are unavailable: route off"], "off: an off route is a dash with its reason, never an empty list");
    await off.ctx.close();
  },

  async house(b) {
    const m = await mount(b, 1440, 820, { search: "?wire=h-t05" });
    await m.page.waitForSelector('#ffxWrDetail [data-k="follow"]');
    eq(await m.page.getAttribute("#ffxWires", "data-filter"), "house", "house: a house deep link opens the House list");
    const fires = await m.page.$eval("#ffxWrDetail .ffx-wr-facts", (dl) => { const i = [...dl.querySelectorAll("dt")].findIndex((d) => d.textContent === "Fires"); return dl.querySelectorAll("dd")[i].textContent; });
    eq(fires, DASH + " under 20 sessions of history", "house: a record too short is a dash with its reason");
    ok(!(await m.page.$('#ffxWrDetail [data-k="adjust"]')), "house: a house wire offers no edit");
    await m.page.click('#ffxWrDetail [data-k="follow"]');
    await m.page.waitForTimeout(400);
    eq(m.calls.filter((c) => c.method === "POST" && c.path === "/api/ff/house").map((c) => c.body), [{ id: "h-t05", follow: true }], "house: turning it on posts follow");
    await m.ctx.close();
  },

  async adjust(b) {
    const st = makeState();
    const m = await mount(b, 1440, 820, { state: st, search: "?wire=" + st.wires[1].id });
    await m.page.click('#ffxWrDetail [data-k="adjust"]');
    await m.page.waitForSelector("dialog.ffx-sheet[open]", { timeout: 15000 });
    eq(await m.page.textContent("dialog.ffx-sheet[open] h2"), "Adjust wire", "adjust: the Fire sheet opens on the wire");
    ok(m.assets.includes("/assets/js/flows-ff-fire.js") && m.assets.includes("/assets/js/flows-ff-composer.js"), "adjust: the sheet's scripts load as their deferred group");
    await m.page.click('dialog.ffx-sheet[open] [data-close]');
    eq(m.errors, [], "adjust: no page error");
    await m.ctx.close();
  },

  async mark(b) {
    for (const [state, breathes] of [["live", true], ["resting", false], ["degraded", false], ["down", false], ["unknown", false]]) {
      const m = await mount(b, 1440, 820, { motion: true, state: makeState({ health: health(state) }) });
      await m.page.waitForFunction((s) => document.querySelector(".ffx-mark") && document.querySelector(".ffx-mark").getAttribute("data-ff-state") === s, state, { timeout: 10000 });
      await m.page.waitForTimeout(200);
      eq((await ANIM(m.page, ".ffx-mark-ring")) > 0, breathes, `mark ${state}: breathes only when live (H8)`);
      eq(await m.page.getAttribute(".ffx-mark", "href"), "/flows/wires/", `mark ${state}: links to the Wires page`);
      await m.ctx.close();
    }
    const r = await mount(b, 1440, 820, { state: makeState({ health: health("live") }) });
    await r.page.waitForFunction(() => document.querySelector(".ffx-mark[data-ff-state=live]"), null, { timeout: 10000 });
    eq(await ANIM(r.page, ".ffx-mark-ring"), 0, "mark: under reduced motion the live ring is still");
    await r.ctx.close();

    const unread = { house: 2, member: 1, total: 3, capped: false, label: "3" };
    const e = await mount(b, 1440, 820, {
      state: makeState({ health: health("resting", { unread }) }),
      before: (page) => page.addInitScript(() => { window.__ff = []; for (const n of ["ff:health", "ff:unread"]) document.addEventListener(n, (ev) => window.__ff.push([n, ev.detail])); }),
    });
    await e.page.waitForFunction(() => window.__ff && window.__ff.length >= 2, null, { timeout: 10000 });
    const evs = await e.page.evaluate(() => window.__ff);
    eq(evs.find((x) => x[0] === "ff:unread")[1], { house: 2, member: 1, total: 3 }, "mark: emits ff:unread with the counts");
    eq(evs.find((x) => x[0] === "ff:health")[1].state, "resting", "mark: emits ff:health with the state");
    eq([await e.page.textContent(".ffx-mark-n"), await e.page.$eval(".ffx-mark-n", (n) => n.hidden)], ["3", false], "mark: the unread count is shown");
    ok(/Resting · nightly 00:41 TRT/.test(await e.page.getAttribute(".ffx-mark", "title")), "mark: the API's line in TRT is its title");
    await e.ctx.close();

    const down = await mount(b, 1440, 820, { state: makeState({ health: "fail" }) });
    await down.page.waitForFunction(() => document.querySelector(".ffx-mark[data-ff-state=down]"), null, { timeout: 10000 });
    ok(true, "mark: an unreachable health endpoint is down on the client");
    await down.ctx.close();

    const p = await mount(b, 1440, 820, {
      state: makeState({ health: health("resting", { pollAfterS: 60 }) }),
      before: (page) => page.clock.install({ time: new Date("2026-11-13T21:00:00Z") }),
    });
    await p.page.waitForFunction(() => document.querySelector(".ffx-mark[data-ff-state=resting]"), null, { timeout: 10000 });
    const n0 = p.calls.filter((c) => c.path === "/api/ff/health").length;
    await p.page.clock.runFor(61000);
    await p.page.waitForTimeout(300);
    const n1 = p.calls.filter((c) => c.path === "/api/ff/health").length;
    eq(n1 - n0, 1, "mark: polls again after the API's pollAfterS");
    ok(/ff-1/.test(p.calls.filter((c) => c.path === "/api/ff/health").at(-1).headers["if-none-match"] || ""), "mark: the repeat carries the ETag");
    await p.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await p.page.clock.runFor(300000);
    await p.page.waitForTimeout(300);
    eq(p.calls.filter((c) => c.path === "/api/ff/health").length, n1, "mark: a hidden tab polls nothing");
    await p.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await p.page.waitForTimeout(300);
    eq(p.calls.filter((c) => c.path === "/api/ff/health").length, n1 + 1, "mark: and reads once on return");
    await p.ctx.close();
  },

  async namePanel(b) {
    const go = (st, w = 1440, h = 820) => mount(b, w, h, { html: tickerHtml(), at: "/flows/ticker/", search: "?t=SYA101", state: st, waitFor: ".ffx-np, [data-ff-slot=name-panel][hidden]" });
    const none = await go(makeState());
    eq([await none.page.textContent(".ffx-np"), await none.page.getAttribute(".ffx-np", "href")], ["Arm a wire", "/flows/fire/?symbol=SYA101"], "name panel: with no wire it offers Fire on this name");
    eq(none.calls.filter((c) => c.path === "/api/ff/symbol").map((c) => c.query), ["?t=SYA101"], "name panel: one read of the member's wires on this name");
    await none.ctx.close();
    const id = "w-abcdefghijklaaaa";
    const hit = await go(makeState({ symbol: { symbol: "SYA101", wires: [{ id: "w-abcdefghijklbaaa", title: "Calm", status: "armed", state: "armed", cadence: "live" }, { id, title: "Hot", status: "armed", state: "hit", cadence: "nightly" }], armed: 2, muted: false, line: "2 armed" } }));
    eq([await hit.page.textContent(".ffx-np"), await hit.page.getAttribute(".ffx-np", "href"), await hit.page.getAttribute(".ffx-np", "data-kind")], ["2 wires armed · hit today", "/flows/wires/?wire=" + id, "hit"], "name panel: armed wires with a hit today link to the wire that hit");
    await hit.ctx.close();
    const busy = await go(makeState({ symbol: { status: 429, code: "rate_limited" } }));
    eq([await busy.page.textContent(".ffx-np"), await busy.page.getAttribute(".ffx-np", "data-ff-absent")], [DASH + " wires not read", "rate_limited"], "name panel: a refused read is a dash with its reason, never zero wires");
    await busy.ctx.close();
    const off = await go(makeState({ symbol: { status: 404, code: "ff_off" } }));
    eq(await off.page.$eval("[data-ff-slot=name-panel]", (n) => n.hidden), true, "name panel: hidden while Fire & Forget is off");
    await off.ctx.close();
    for (const [w, h] of [[1440, 820], [390, 844]]) {
      const m = await go(makeState(), w, h);
      const f = await fits(m.page);
      ok(!f.pageScroll, `name panel ${w}x${h}: no page scroll`);
      await m.ctx.close();
    }
  },
};

const PLANTS = [
  { name: "arm sent at the limit", suite: "actions", files: () => [plant(WIRES_JS, "    var blocked = house ? null : limitBlock(limits, w);", "    var blocked = null;")] },
  { name: "history renders the current sentence for every version", suite: "listAndDetail", files: () => [plant(WIRES_JS, 'el("span", { class: "ffx-wr-vs", text: v.sentence || DASH + " no sentence stored" })', 'el("span", { class: "ffx-wr-vs", text: (current && current.wire.sentence) || v.sentence })')] },
  { name: "absent false-alarm rate printed as zero", suite: "listAndDetail", files: () => [plant(WIRES_JS, '    var exp = figureText(w.expWeek, "not measured");', '    var exp = { text: "0", absent: null };')] },
  { name: "retire sends pause", suite: "actions", files: () => [plant(WIRES_JS, 'status: k === "pause" ? "paused" : k === "retire" ? "retired" : "armed"', 'status: k === "pause" || k === "retire" ? "paused" : "armed"')] },
  { name: "the list renders every row and never fits", suite: "layout", files: () => [plant(WIRES_JS, "      var r = K ? K.fit.rows(list, { keep: 1 }) : { cut: 0, total: lis.length };", "      var r = { cut: 0, total: lis.length };")] },
  { name: "deep link ignored", suite: "listAndDetail", files: () => [plant(WIRES_JS, '        var wanted = selected || (new URLSearchParams(location.search).get("wire") || "");', '        var wanted = selected;')] },
  { name: "the mark breathes in every state", suite: "mark", files: () => [plant(MARK_CSS, '  .ffx-mark[data-ff-state="live"] .ffx-mark-ring { animation: ffx-breathe 4.2s ease-in-out infinite; }', "  .ffx-mark .ffx-mark-ring { animation: ffx-breathe 4.2s ease-in-out infinite; }")] },
  { name: "the mark breathes under reduced motion", suite: "mark", files: () => [plant(MARK_CSS, "@media (prefers-reduced-motion: no-preference) {", "@media all {")] },
  { name: "the mark polls while hidden", suite: "mark", files: () => [plantAll(MARK_JS, [["      if (document.hidden) { owed = true; return; }\n", ""], ["        if (timer) { clearTimeout(timer); timer = 0; owed = true; }\n", ""]])] },
  { name: "an unreachable endpoint reads as resting", suite: "mark", files: () => [plant(MARK_JS, '      paint("down", "health not read"', '      paint("resting", "health not read"')] },
  { name: "the mark drops the unread event", suite: "mark", files: () => [plant(MARK_JS, '        if (v.unread) K.hooks.emit("ff:unread"', '        if (false) K.hooks.emit("ff:unread"')] },
  { name: "the name panel offers Fire without the name", suite: "namePanel", files: () => [plant(PANEL_JS, 'href: "/flows/fire/?symbol=" + encodeURIComponent(symbol)', 'href: "/flows/fire/"')] },
  { name: "the name panel reads a refusal as no wire", suite: "namePanel", files: () => [plant(PANEL_JS, '        absent(slot, err && err.code ? err.code : "error", errLine(err));', '        paint(slot, model({ wires: [] }, symbol));')] },
];

const browser = await launch();
let exit = 0;
try {
  if (!PLANTS_ONLY) {
    for (const [name, fn] of Object.entries(SUITES).filter(([n]) => !ONLY || ONLY.split(",").includes(n))) {
      try { await fn(browser); } catch (e) { failures.push(name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); }
    }
    for (const f of failures.slice(0, 40)) console.log("FAIL " + f);
    console.log(`ff-e-wires-render: ${checks - failures.length} of ${checks} checks hold`);
    if (failures.length) exit = 1;
  }
  if (!SKIP_PLANTS && exit === 0) {
    const survived = [];
    for (const p of PLANTS) {
      FILES = p.files();
      failures = [];
      stopFast = true;
      try { await SUITES[p.suite](browser); } catch (e) { if (!failures.length) failures.push("threw: " + String(e && e.message)); }
      stopFast = false;
      FILES = [];
      if (!failures.length) survived.push(p.name);
    }
    for (const s of survived) console.log("SURVIVED " + s);
    console.log(`ff-e-wires-render: ${PLANTS.length - survived.length} of ${PLANTS.length} planted wrong builds fail`);
    if (survived.length) exit = 1;
  }
} finally {
  await browser.close();
}
process.exit(exit);
