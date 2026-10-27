import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch } from "./lib/browser.mjs";
import { COPY_BANNED } from "../shared/ff-contract.js";
import { mount as mountRaw, SIZES, ROOT, previewFor, limits, UNIVERSE, HTML } from "./lib/ff-d-world.mjs";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let checks = 0;
const failures = [];
let stopFast = false;
const ok = (c, m) => { checks++; if (!c) { failures.push(m); if (stopFast) throw new Error("stop"); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
let PATCH = {};
const mount = (b, w, h, o = {}) => mountRaw(b, w, h, { ...PATCH, ...o });
const DASH = "—";
const BANNED = new RegExp("\\b(" + COPY_BANNED.join("|") + ")\\b", "i");
const MINUTES = /\b\d{1,2}:\d{2}(?!\d)(?!:)(?! TRT)/;
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const FIRE_JS = "assets/js/flows-ff-fire.js";
const PREVIEW_JS = "assets/js/flows-ff-preview.js";
const COMPOSER_JS = "assets/js/flows-ff-composer.js";
const FIRE_CSS = "assets/css/flows-ff-fire.css";
const plant = (file, from, to) => {
  const src = read(file);
  if (src.split(from).length !== 2) throw new Error("plant anchor must occur exactly once in " + file + ": " + from.slice(0, 70));
  return { path: file, body: src.replace(from, to) };
};

const visibleText = (page) => page.evaluate(() => {
  const out = [];
  const walk = document.createTreeWalker(document.querySelector(".flows-main"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const e = n.parentElement;
    if (!e || e.closest("script,style,[hidden],dialog:not([open]),.visually-hidden")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const t = n.textContent.trim();
    if (t) out.push(t);
  }
  return out.join(" | ");
});

async function setScopeNames(page, text) {
  await page.click('[data-k="scope-names"]');
  await page.fill('[data-k="names"]', text);
  await page.press('[data-k="names"]', "Enter");
}

async function addConditions(page, ids) {
  for (const id of ids) {
    await page.selectOption('#ffxComposer [data-k="add"]', id);
  }
}

const EIGHT = ["flow.net_premium.z20", "flow.volume.z20", "flow.pc_volume.z20", "earn.implied_ratio", "vol.iv.30d.chg1d", "vol.iv.30d.zvov", "vol.rr25.30d"];

async function tab(page, w, v) {
  if (w < 1100) await page.click('#ffxTabs [data-v="' + v + '"]');
}

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
    for (const e of root.querySelectorAll("#ffxFire *")) {
      if (!vis(e) || e.closest("dialog")) continue;
      const cs = getComputedStyle(e);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) bad.push("inner scroll " + e.className);
      if (cs.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1 && !e.title && !e.closest("[title]")) bad.push("truncated with no title: " + (e.textContent || "").slice(0, 40));
      if (cs.webkitLineClamp !== "none" && cs.webkitLineClamp && e.scrollHeight > e.clientHeight + 1 && !e.title) bad.push("clamped with no title: " + e.className);
      let p = e.parentElement;
      while (p && p !== root) {
        const pc = getComputedStyle(p);
        if (pc.overflow === "hidden" || pc.overflowY === "hidden") {
          const a = e.getBoundingClientRect();
          const b = p.getBoundingClientRect();
          if (a.bottom > b.bottom + 1.5 || a.top < b.top - 1.5 || a.right > b.right + 1.5 || a.left < b.left - 1.5) {
            if (!(cs.textOverflow === "ellipsis" || e.closest(".cut"))) bad.push("leaves " + p.className + ": " + e.className + " " + (e.textContent || "").slice(0, 30));
          }
          break;
        }
        p = p.parentElement;
      }
    }
    return { sw, sh, bad };
  });
}

async function layoutAt(browser, w, h) {
  const m = await mount(browser, w, h, {
    api: ({ method, path: p, body, json }) => {
      if (p === "/api/ff/preview") {
        const many = body.ast.scope.kind === "names" ? body.ast.scope.symbols.length : 40;
        const view = previewFor(body.ast);
        if (body.ast.scope.kind !== "names") view.subjects = view.subjects.concat(Array.from({ length: many }, (_, i) => ({ ...view.subjects[0], symbol: "SYN" + (200 + i) })));
        return json(view);
      }
      void method;
    },
  });
  const { page } = m;
  const here = `${w}x${h} `;
  await page.click('[data-template="T01"]');
  await tab(page, w, "wire");
  await addConditions(page, EIGHT.slice(0, 3));
  await page.waitForTimeout(600);
  for (const view of w < 1100 ? ["start", "wire", "now"] : ["all"]) {
    if (view !== "all") await page.click('#ffxTabs [data-v="' + view + '"]');
    await page.waitForTimeout(250);
    const g = await geometry(page);
    ok(!g.sw && !g.sh, here + view + " one screen (page scroll " + JSON.stringify(g) + ")");
    eq(g.bad, [], here + view + " nothing clipped, scrolling or truncated without a title");
  }
  await tab(page, w, "wire");
  await page.click('[data-k="scope-names"]');
  await page.fill('[data-k="names"]', Array.from({ length: 25 }, (_, i) => "SYN" + (100 + i)).join(", "));
  await page.press('[data-k="names"]', "Enter");
  await page.waitForSelector('#ffxPreview[data-state="ok"]', { state: "attached" });
  await page.waitForTimeout(300);
  const cut = await page.evaluate(() => document.querySelector("#ffxComposer .ffx-c").getAttribute("data-cut"));
  ok(Number(cut) >= 0, here + "composer reports its cut");
  for (const view of w < 1100 ? ["wire", "now"] : ["all"]) {
    if (view !== "all") await page.click('#ffxTabs [data-v="' + view + '"]');
    await page.waitForTimeout(300);
    const g = await geometry(page);
    ok(!g.sw && !g.sh, here + view + " 8 conditions and 25 names: one screen (" + JSON.stringify({ sw: g.sw, sh: g.sh }) + ")");
    eq(g.bad, [], here + view + " 8 conditions and 25 names: nothing clipped (" + here + ")");
  }
  const hits = await page.evaluate(() => [document.querySelectorAll("#ffxPreview .ffx-sr").length, [...document.querySelectorAll("#ffxPreview .ffx-sr")].filter((r) => r.classList.contains("cut")).length]);
  ok(hits[0] === 25, here + "the preview lists the 25 names it read (" + hits[0] + ")");
  await tab(page, w, "wire");
  await page.waitForTimeout(100);
  eq(m.errors, [], here + "no page error");
  await m.ctx.close();
}

async function behaviours(browser) {
  let state = { wires: limits(), arms: 0 };
  const m = await mount(browser, 1440, 820, {
    api: async ({ method, path: p, body, headers, json }) => {
      if (p === "/api/ff/wires" && method === "GET") return json({ v: 1, status: "live", wires: [], limits: state.wires });
      if (p === "/api/ff/wires" && method === "POST") {
        state.arms++;
        if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
        state.lastBody = body;
        state.lastKey = headers["idempotency-key"];
        (state.keys = state.keys || []).push(headers["idempotency-key"]);
        if (state.fail) return json({ error: { code: state.fail.code, message: state.fail.message, details: state.fail.details } }, state.fail.status);
        state.wires = limits({ armed: { used: 4, max: 50 } });
        return json({ v: 1, wire: { id: "w-" + "b".repeat(16), title: body.title, version: 1, effectiveText: "Takes effect from the 2026-10-27 session" }, replayed: false, limits: state.wires }, 201);
      }
    },
  });
  const { page } = m;
  const text = () => visibleText(page);
  ok((await text()).includes("3 of 50 wires armed · 1 of 5 live · false alarms 0.4 of 2 a week"), "the header reads the member's limits from the API");
  ok((await page.textContent('[data-rate="T01"]')) === "House: 1 in 12 sessions", "a house record is printed as the API words it");
  ok((await page.textContent('[data-rate="T02"]')).startsWith(DASH + " under 20 sessions"), "a house record that is not measured is a dash with its reason");
  ok(!(await page.textContent("#ffxTpls")).includes("T04") && (await page.locator(".ffx-trow").count()) === 9, "a blank wire and eight templates, none warming or hidden");
  ok((await text()).includes(DASH + " Add a condition") === false, "no stray dash in the picker");

  await page.click('[data-k="arm"]', { force: true });
  ok(state.arms === 0, "arming a wire with no names sends nothing");
  ok((await page.textContent(".ffx-out")).startsWith(DASH + " choose at least one name"), "and says why with a dash");
  ok((await page.getAttribute("#ffxPreview", "data-state")) === "idle", "the preview waits until the wire can be read");

  await page.click('[data-template="T01"]');
  await page.waitForSelector('#ffxPreview[data-state="ok"]');
  ok((await page.getAttribute('[data-template="T01"]', "aria-pressed")) === "true" && (await page.getAttribute('[data-template="blank"]', "aria-pressed")) === "false", "the chosen template is pressed");
  const pv = m.calls.filter((c) => c.path === "/api/ff/preview").pop();
  eq(pv.body.template, "T01", "the template id travels with the preview");
  eq(Object.keys(pv.body).sort(), ["ast", "template"], "the preview body names no member and nothing else");
  eq(pv.body.ast.all[0], { m: "flow.net_premium.z20", op: ">=", x: 3 }, "the preview body is the wire as shown");
  ok((await text()).includes("5 of 5 names hold this now"), "the preview headline is the API's count");
  ok((await text()).includes("first check Tue 27 Oct · 00:30 TRT (scheduled)"), "the first check is the API's text, in TRT");
  ok((await text()).includes("False alarms a week | " + DASH + " a fact wire has no statistical test") || (await text()).includes("a fact wire has no statistical test"), "an unmeasured rate is a dash with its reason");
  const sentence = await page.textContent("#ffx-sentence");
  ok(sentence.startsWith("When net premium z ≥ 3.00 SD") && sentence.endsWith("then quiet for 5 sessions."), "the sentence is built from the conditions");

  await page.fill('[data-k="x0"]', "3.13");
  await page.press('[data-k="x0"]', "Tab");
  ok((await page.inputValue('[data-k="x0"]')) === "3.25", "a threshold off the grid snaps to it");
  await page.focus('[data-k="x0"]');
  await page.press('[data-k="x0"]', "ArrowUp");
  ok((await page.inputValue('[data-k="x0"]')) === "3.50", "arrow up steps one grid unit");
  ok(await page.evaluate(() => document.activeElement.getAttribute("data-k") === "x0"), "focus stays on the threshold after a step");
  await page.click('[data-k="dec0"]');
  await page.click('[data-k="dec0"]');
  ok((await page.inputValue('[data-k="x0"]')) === "3.00", "the minus button steps down");
  await page.fill('[data-k="x0"]', "abc");
  await page.press('[data-k="x0"]', "Tab");
  ok((await page.inputValue('[data-k="x0"]')) === "3.00", "text that is not a number is refused and the value stays");
  await page.fill('[data-k="x0"]', "999");
  await page.press('[data-k="x0"]', "Tab");
  ok((await page.inputValue('[data-k="x0"]')) === "50.00", "a value past the range is clamped");
  await page.fill('[data-k="x0"]', "3");
  await page.press('[data-k="x0"]', "Tab");

  await page.waitForSelector('#ffxPreview[data-state="ok"]');
  await page.click('[data-k="arm"]', { force: true });
  await page.waitForSelector('.ffx-out[data-state="ok"]');
  eq(state.arms, 1, "one arm request");
  eq(Object.keys(state.lastBody).sort(), ["ast", "template", "title"], "the arm body names no member");
  eq(state.lastBody.template, "T01", "the template id is the hint");
  ok(state.lastBody.title.length > 0 && state.lastBody.title.length <= 80, "the title fits 80 characters");
  ok(/^[0-9a-f-]{16,}$/.test(state.lastKey), "an Idempotency-Key is sent");
  const done = await page.textContent(".ffx-out");
  ok(done.includes("Armed. Takes effect from the 2026-10-27 session."), "the confirmation says when it takes effect");
  eq(await page.getAttribute('.ffx-out a[href^="/flows/wires/"]', "href"), "/flows/wires/?wire=w-bbbbbbbbbbbbbbbb", "the wire links to the Wires page by query");
  ok((await page.getAttribute('.ffx-out a[href="/flows/inbox/"]', "href")) === "/flows/inbox/", "and to the Inbox");
  await page.waitForFunction(() => document.querySelector("#ffxCap").textContent.startsWith("4 of 50"));
  ok(true, "the header limits refresh after arming");

  state.delay = 400;
  await page.click('[data-k="inc0"]');
  await page.waitForSelector('#ffxPreview[data-state="ok"]');
  const armsBefore = state.arms;
  await page.evaluate(() => { const b = document.querySelector('[data-k="arm"]'); b.click(); b.click(); b.click(); });
  await page.waitForSelector('.ffx-out[data-state="ok"]');
  eq(state.arms - armsBefore, 1, "three quick clicks on Arm send one request");
  state.delay = 0;
  state.fail = { status: 409, code: "ff_wire_limit", message: "limit", details: { limit: "live" } };
  await page.click('[data-k="x0"]');
  await page.click('[data-k="inc0"]');
  await page.waitForSelector('#ffxPreview[data-state="ok"]');
  await page.click('[data-k="arm"]', { force: true });
  await page.waitForSelector('.ffx-out[data-state="error"]');
  ok((await page.textContent(".ffx-out")).startsWith(DASH + " you have the most live wires allowed. Retire a wire first."), "a wire limit names which limit");
  const k1 = state.lastKey;
  await page.click('[data-k="arm"]', { force: true });
  await page.waitForFunction((n) => document.querySelector(".ffx-out").getAttribute("data-state") === "error", 0);
  eq(state.lastKey, k1, "a retry of the same wire reuses its Idempotency-Key");
  await page.click('[data-k="inc0"]');
  await page.click('[data-k="arm"]', { force: true });
  await page.waitForTimeout(200);
  ok(state.lastKey !== k1, "an edited wire gets a new key");
  for (const [fail, want] of [
    [{ status: 409, code: "ff_budget_exceeded", message: "m", details: { used: 1.9, adding: 0.4, max: 2 } }, DASH + " the weekly false-alarm budget is spent (1.9 of 2). Loosen or retire a wire."],
    [{ status: 409, code: "ff_house_duplicate", message: "This is the house wire. Adjust it or turn the house wire off." }, DASH + " This is the house wire. Adjust it or turn the house wire off."],
    [{ status: 422, code: "ff_symbol_outside_universe", message: "That name is not in the universe, so no wire can watch it" }, DASH + " That name is not in the universe, so no wire can watch it"],
    [{ status: 429, code: "rate_limited", message: "x" }, DASH + " too many changes just now. Try again in a minute."],
  ]) {
    state.fail = fail;
    await page.click('[data-k="arm"]', { force: true });
    await page.waitForFunction((c) => document.querySelector(".ffx-out [data-ff-absent]") && document.querySelector(".ffx-out [data-ff-absent]").getAttribute("data-ff-absent") === c, fail.code);
    eq(await page.textContent(".ffx-out"), want, "error " + fail.code);
  }
  state.fail = null;
  const text2 = await text();
  ok(!BANNED.test(text2.replace(/\bTRT\b/g, "")), "no banned word on the page after the flows: " + (BANNED.exec(text2) || [""])[0]);
  ok(!MINUTES.test(text2), "every clock time on the page ends in TRT");
  ok(!/\btape\b/i.test(text2), "the page never says tape");
  ok((await page.evaluate(() => document.getAnimations().length)) === 0, "reduced motion leaves nothing animating");
  const hosts = new Set(m.calls.map((c) => c.path));
  ok([...hosts].every((p) => ["/api/ff/wires", "/api/ff/house", "/api/ff/preview", "/api/flows/universe", "/api/flows/meta"].includes(p)), "only the four routes (and the shell's own meta read) are called: " + [...hosts].join(" "));
  ok(m.calls.filter((c) => c.method !== "GET").every((c) => c.path.startsWith("/api/ff/")), "every mutation goes to /api/ff");
  eq(m.errors, [], "no page error");
  await m.ctx.close();
}

async function previewStates(browser) {
  const m = await mount(browser, 1440, 820, {
    api: ({ path: p, body, json }) => {
      if (p !== "/api/ff/preview") return undefined;
      if (body.ast.scope.symbols.includes("SYN101") && body.ast.scope.symbols.length === 1) return json(previewFor(body.ast, { view: { status: "unavailable", reason: "source_missing", reasonText: DASH + " source missing" } }));
      if (body.ast.scope.symbols.includes("SYN102")) return json(previewFor(body.ast, { view: { coverage: { subjects: 1, evaluated: 0, wouldHit: 0, unknown: 1, reasons: { stale: 1 } }, subjects: [] } }));
      if (body.ast.scope.symbols.includes("SYN103")) return json({ error: { code: "ff_off", message: "Fire is off", details: { reason: "route_off" } } }, 404);
      return undefined;
    },
  });
  const { page } = m;
  await page.click('[data-template="T01"]');
  await setScopeNames(page, "SYN101");
  await page.waitForSelector('#ffxPreview[data-state="unavailable"]');
  let t = await page.textContent("#ffxPreview");
  ok(t.includes(DASH + " source missing") && !/\b0 of\b/.test(t), "an unavailable read is a dash and a reason, never a zero count");
  await setScopeNames(page, "SYN102");
  await page.waitForSelector('#ffxPreview[data-state="ok"]');
  t = await page.textContent("#ffxPreview");
  ok(t.includes(DASH + " no name could be read") && t.includes("1 unknown: stale 1") && !/0 of 0/.test(t) && !t.includes("0 names"), "no name read is a dash, not 0 of 0");
  await setScopeNames(page, "SYN103");
  await page.waitForSelector('#ffxPreview[data-state="error"]');
  ok((await page.textContent("#ffxPreview")).includes(DASH + " could not read now: Fire is off"), "a failed preview says so");
  const before = m.calls.filter((c) => c.path === "/api/ff/preview").length;
  await page.click(".ffx-retry");
  await page.waitForFunction((n) => true, 0);
  await page.waitForTimeout(150);
  ok(m.calls.filter((c) => c.path === "/api/ff/preview").length === before + 1, "Retry asks again");
  await m.ctx.close();
}

async function stale(browser) {
  let n = 0;
  const m = await mount(browser, 1440, 820, {
    api: async ({ path: p, body, json }) => {
      if (p !== "/api/ff/preview") return undefined;
      n++;
      const slow = body.ast.scope.symbols[0] === "SYN101";
      if (slow) await new Promise((r) => setTimeout(r, 1500));
      return json(previewFor(body.ast, { hold: 1, view: { coverage: { subjects: 1, evaluated: 1, wouldHit: slow ? 1 : 0, unknown: 0, reasons: {} } } }));
    },
  });
  const { page } = m;
  await page.click('[data-template="T01"]');
  await setScopeNames(page, "SYN101");
  await page.waitForTimeout(700);
  await setScopeNames(page, "SYN102");
  await page.waitForTimeout(2600);
  const t = await page.textContent("#ffxPreview");
  ok(t.includes("0 of 1 name hold this now") || t.includes("0 of 1 names hold this now"), "a late answer for an older wire never replaces the newer one: " + t.slice(0, 60));
  ok(n >= 2, "both reads were made");
  await m.ctx.close();
}

async function offState(browser) {
  const m = await mount(browser, 1440, 820, {
    api: ({ method, path: p, json }) => {
      if (p === "/api/ff/wires" && method === "GET") return json({ error: { code: "ff_off", message: "Fire & Forget is off", details: { reason: "route_off", route: "fire" } } }, 404);
      if (p === "/api/ff/house") return json({ error: { code: "ff_off", message: "Fire & Forget is off", details: { reason: "route_off" } } }, 404);
      return undefined;
    },
  });
  const { page } = m;
  const cap = await page.textContent("#ffxCap");
  ok(cap === DASH + " Fire is unavailable: route off", "an off route is a dash with its reason in the header: " + cap);
  ok(!(await page.locator("#ffxBanner").isHidden()), "and a banner");
  ok((await page.textContent('[data-rate="T01"]')) === DASH + " unavailable", "house records are a dash, not a zero");
  await page.click('[data-template="T01"]');
  await setScopeNames(page, "SYN101");
  await page.click('[data-k="arm"]', { force: true });
  await page.waitForTimeout(200);
  ok(m.calls.filter((c) => c.method === "POST" && c.path === "/api/ff/wires").length === 0, "nothing is armed while Fire is off");
  ok((await page.textContent(".ffx-out")).startsWith(DASH + " Fire is unavailable"), "and the button says why");
  await m.ctx.close();
}

async function conditionDialog(browser) {
  const m = await mount(browser, 1024, 660, {});
  const { page } = m;
  await page.click('[data-template="T01"]');
  await page.click('#ffxTabs [data-v="wire"]');
  await addConditions(page, EIGHT.slice(0, 4));
  await page.waitForTimeout(500);
  const cut = Number(await page.getAttribute("#ffxComposer .ffx-c", "data-cut"));
  ok(cut >= 1, "eight conditions at 1024x660 are cut to fit (" + cut + ")");
  ok(await page.isVisible("#ffxComposer .ffx-more"), "an edit-all control is shown");
  const label = await page.textContent("#ffxComposer .ffx-more");
  ok(label === "+" + cut + " more · edit all", "it names how many are hidden: " + label);
  await page.click("#ffxComposer .ffx-more");
  ok((await page.locator("dialog.ffx-dlg-cond[open] .ffx-cl").count()) === 8, "the dialog lists all eight");
  await page.click('dialog.ffx-dlg-cond[open] [data-k="rm7"]');
  await page.waitForTimeout(200);
  ok((await page.locator("dialog.ffx-dlg-cond[open] .ffx-cl").count()) === 7, "a condition can be removed inside the dialog");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  eq((await page.evaluate(() => document.querySelectorAll("#ffxComposer .ffx-cl").length)), 7, "the page list follows");
  await m.ctx.close();
}

async function previewDialog(browser) {
  const m = await mount(browser, 1024, 660, {
    api: ({ path: p, body, json }) => {
      if (p === "/api/ff/preview") return json(previewFor(body.ast));
      return undefined;
    },
  });
  const { page } = m;
  await page.click('[data-template="T01"]');
  await page.click('#ffxTabs [data-v="wire"]');
  await setScopeNames(page, Array.from({ length: 25 }, (_, i) => "SYN" + (100 + i)).join(" "));
  await page.click('#ffxTabs [data-v="now"]');
  await page.waitForSelector('#ffxPreview[data-state="ok"]');
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({ cut: document.querySelectorAll("#ffxPreview .ffx-sr.cut").length, btn: document.querySelector("#ffxPreview .ffx-all").hidden, label: document.querySelector("#ffxPreview .ffx-all").textContent }));
  ok(info.cut > 0 && !info.btn && info.label === "Show all 25", "a short screen fits the list and offers Show all: " + JSON.stringify(info));
  await page.click("#ffxPreview .ffx-all");
  ok((await page.locator("dialog[open] .ffx-slist-all .ffx-sr").count()) === 25, "the dialog lists every name");
  await page.keyboard.press("Escape");
  await m.ctx.close();
}

async function keyboardAndTargets(browser) {
  const m = await mount(browser, 390, 844, { context: { hasTouch: true, isMobile: true } });
  const { page } = m;
  const t = await page.evaluate(() => [...document.querySelectorAll("#ffxFire button, #ffxFire select, #ffxFire input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; }).map((e) => [e.className || e.tagName, Math.round(e.getBoundingClientRect().height)]));
  const small = t.filter(([, h]) => h < 44);
  eq(small, [], "start tab: every touch target is 44 px tall or more");
  await page.click('#ffxTabs [data-v="wire"]');
  await page.waitForTimeout(200);
  const t2 = await page.evaluate(() => [...document.querySelectorAll("#ffxFire button, #ffxFire select, #ffxFire input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; }).map((e) => [e.className || e.tagName, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]));
  eq(t2.filter(([, , h]) => h < 44), [], "wire tab: every touch target is 44 px tall or more");
  eq(t2.filter(([c, w]) => w < 44 && !/ffx-(names|sel|in|x|pv)/.test(c) && !/ffx-m|ffx-op/.test(c)), [], "wire tab: buttons are 44 px wide or more");
  await m.ctx.close();

  const k = await mount(browser, 1440, 820, {});
  const kp = k.page;
  await kp.focus('[data-template="blank"]');
  await kp.keyboard.press("Tab");
  const focused = await kp.evaluate(() => document.activeElement.getAttribute("data-template"));
  eq(focused, "T01", "Tab moves down the template list");
  await kp.keyboard.press("Enter");
  await kp.waitForTimeout(200);
  ok((await kp.getAttribute('[data-template="T01"]', "aria-pressed")) === "true", "Enter picks a template");
  await kp.focus('[data-k="reset"]');
  await kp.keyboard.press("Shift+Tab");
  ok(await kp.evaluate(() => document.activeElement.getAttribute("data-k") === "arm"), "Shift+Tab reaches the Arm button");
  const ring = await kp.evaluate(() => { const cs = getComputedStyle(document.activeElement); return [cs.outlineStyle, cs.outlineWidth]; });
  ok(ring[0] !== "none" && ring[1] !== "0px", "the focused control shows a ring");
  await kp.click("#ffxInfoBtn");
  ok(await kp.evaluate(() => document.getElementById("ffxInfo").open), "the info dialog opens");
  await kp.keyboard.press("Escape");
  ok(await kp.evaluate(() => document.activeElement.id === "ffxInfoBtn"), "Escape closes it and returns focus");
  eq(k.errors, [], "no page error");
  await k.ctx.close();

  const n = await mount(browser, 390, 844, {});
  await n.page.focus("#ffxTabs [aria-selected=true]");
  await n.page.keyboard.press("ArrowRight");
  ok((await n.page.getAttribute("#ffxFire", "data-view")) === "wire" && (await n.page.getAttribute("#ffxTabs [data-v=wire]", "aria-selected")) === "true", "arrow keys move across the tabs");
  await n.page.keyboard.press("End");
  eq(await n.page.getAttribute("#ffxFire", "data-view"), "now", "End goes to the last tab");
  await n.ctx.close();
}

async function sheetAndAdjust(browser) {
  const m = await mount(browser, 1440, 820, {
    api: ({ method, path: p, body, json }) => {
      if (p === "/api/ff/wires" && method === "PATCH") { (m.patch = m.patch || []).push(body); return json({ v: 1, wire: { id: body.id, version: 3, effectiveText: "Takes effect from the 2026-10-27 session" }, replayed: false, limits: limits() }); }
      return undefined;
    },
  });
  const { page } = m;
  await page.evaluate(() => window.FlowsUI.ffFire.openFireSheet({ symbol: "SYN104", template: "T03" }));
  await page.waitForSelector("dialog.ffx-sheet[open]");
  ok((await page.inputValue('dialog.ffx-sheet [data-k="names"]')) === "SYN104", "the sheet opens with the name chosen");
  ok((await page.locator("dialog.ffx-sheet .ffx-cl").count()) === 3 || (await page.locator("dialog.ffx-sheet .ffx-cl").count()) >= 3, "and the template's conditions");
  await page.click("dialog.ffx-sheet [data-close]");
  await page.waitForTimeout(150);
  eq(await page.locator("dialog.ffx-sheet").count(), 0, "closing removes the sheet");
  const ast = { v: 1, cadence: "nightly", scope: { kind: "universe" }, all: [{ m: "contract.premium", op: ">=", x: 1000000 }], persist: 1, cooldown: { unit: "session", n: 5 } };
  await page.evaluate((a) => window.FlowsUI.ffFire.openFireSheet({ wire: { id: "w-" + "c".repeat(16), version: 2, title: "t", ast: a, template: "custom" } }), ast);
  await page.waitForSelector("dialog.ffx-sheet[open]");
  ok((await page.getAttribute('dialog.ffx-sheet [data-cad="live"]', "aria-disabled")) === "true", "an adjusted wire cannot change its cadence");
  ok((await page.textContent("dialog.ffx-sheet h2")) === "Adjust wire", "the sheet says it adjusts");
  await page.click('dialog.ffx-sheet [data-k="inc0"]');
  await page.waitForSelector('dialog.ffx-sheet #ffxPreview, dialog.ffx-sheet .ffx-prev-host[data-state="ok"]');
  await page.click('dialog.ffx-sheet [data-k="arm"]');
  await page.waitForSelector('dialog.ffx-sheet .ffx-out[data-state="ok"]');
  eq(m.patch.length, 1, "one PATCH");
  eq(Object.keys(m.patch[0]).sort(), ["ast", "id", "version"], "it carries the base version and no member");
  eq(m.patch[0].version, 2, "the base version is the one opened");
  eq(m.patch[0].ast.all[0].x, 1010000, "the edited threshold is sent");
  ok((await page.textContent("dialog.ffx-sheet .ffx-out")).startsWith("Saved. Takes effect"), "the sheet confirms");
  const bad = await page.evaluate(() => window.FlowsUI.ffFire.openFireSheet.length >= 0);
  ok(bad, "openFireSheet is on FlowsUI.ffFire");
  await m.ctx.close();

  const q = await mount(browser, 1440, 820, { search: "?symbol=SYN107" });
  ok((await q.page.inputValue('[data-k="names"]')) === "SYN107", "?symbol= prefills the names");
  await q.ctx.close();
}

async function axeNow(page) {
  await page.addScriptTag({ content: AXE });
  const res = await page.evaluate(() => window.axe.run(document.querySelector("#ffxFire"), { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"], rules: { "color-contrast": { enabled: true } } }));
  return res.violations.map((x) => x.id + ": " + x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; "));
}

async function axeCheck(browser) {
  for (const [w, h] of [[1440, 820], [390, 844]]) {
    const m = await mount(browser, w, h, {});
    const views = w < 1100 ? ["start", "wire", "now"] : ["all"];
    for (const v of views) {
      if (v !== "all") await m.page.click('#ffxTabs [data-v="' + v + '"]');
      await m.page.waitForTimeout(150);
      eq(await axeNow(m.page), [], `${w}x${h} ${v} axe, blank wire`);
    }
    await tab(m.page, w, "start");
    await m.page.click('[data-template="T01"]');
    await setScopeNames(m.page, "SYN101, SYN102");
    await m.page.waitForSelector('#ffxPreview[data-state="ok"]', { state: "attached" });
    await m.page.waitForTimeout(300);
    for (const v of views) {
      if (v !== "all") await m.page.click('#ffxTabs [data-v="' + v + '"]');
      await m.page.waitForTimeout(150);
      eq(await axeNow(m.page), [], `${w}x${h} ${v} axe, populated wire`);
    }
    await m.ctx.close();
  }
}

const SCENARIOS = {
  layout: async (b) => { for (const [w, h] of SIZES) await layoutAt(b, w, h); },
  behaviours, previewStates, stale, offState, conditionDialog, previewDialog, keyboardAndTargets, sheetAndAdjust, axeCheck,
};

const PLANTS = [
  ["a preview with no name read prints 0 of 0", ["previewStates"], () => ({ js: plant(PREVIEW_JS, 'DASH + " no name could be read"', '"0 names hold this now"') })],
  ["the arm request sends no Idempotency-Key", ["behaviours"], () => ({ js: plant(FIRE_JS, 'net.post("/api/ff/wires", body, { "Idempotency-Key": keyed })', 'net.post("/api/ff/wires", body, {})') })],
  ["the arm button ignores the reasons", ["behaviours"], () => ({ js: plant(FIRE_JS, 'if (arm.getAttribute("aria-disabled") === "true") {\n        if (reasons.length)', 'if (false) {\n        if (reasons.length)') })],
  ["a new key is never made for an edited wire", ["behaviours"], () => ({ js: plant(FIRE_JS, "onChange: function (state, reasons) {\n        keyed = null;", "onChange: function (state, reasons) {") })],
  ["the member is sent in the arm body", ["behaviours"], () => ({ js: plant(FIRE_JS, "var body = { ast: ast, title: model.title(state) };", 'var body = { ast: ast, title: model.title(state), member_id: "x" };') })],
  ["the template hint is dropped", ["behaviours"], () => ({ js: plant(FIRE_JS, 'if (h) body.template = h;', "void 0;") })],
  ["a double click arms twice", ["behaviours"], () => ({ js: plant(FIRE_JS, "busy = true;\n      arm.setAttribute(\"aria-disabled\", \"true\");", "busy = false;") })],
  ["a wire limit loses its name", ["behaviours"], () => ({ js: plant(FIRE_JS, 'return DASH + " you have " + (which || "reached a wire limit") + ". Retire a wire first.";', 'return DASH + " reached a wire limit. Retire a wire first.";') })],
  ["the header limits are not refreshed after arming", ["behaviours"], () => ({ js: plant(FIRE_JS, "onDone: function () { loadCap(); },", "onDone: function () {},") })],
  ["a late preview replaces the newer one", ["stale"], () => ({ js: plant(PREVIEW_JS, "if (mine === ticket) show(view);", "show(view);") })],
  ["a failed preview is silent", ["previewStates"], () => ({ js: plant(PREVIEW_JS, 'if (mine === ticket) { last = null; failed(err); }', "if (mine === ticket) { last = null; }") })],
  ["Retry does nothing", ["previewStates"], () => ({ js: plant(PREVIEW_JS, 'if (again) run(again[0], again[1], 0);', "void 0;") })],
  ["an off route is a zero in the header", ["offState"], () => ({ js: plant(FIRE_JS, 'cap.textContent = errText(err);', 'cap.textContent = "0 of 0 wires armed";') })],
  ["arming goes ahead while Fire is off", ["offState"], () => ({ js: plant(FIRE_JS, 'if (err.code === "ff_off") {\n          banner.hidden = false;\n          banner.textContent = errText(err);\n          wb.disable(errText(err));\n        }', "") })],
  ["house records are zeros when unread", ["offState"], () => ({ js: plant(FIRE_JS, 'n.textContent = DASH + " " + (err.code === "ff_off" ? "unavailable" : "not read");', 'n.textContent = "0";') })],
  ["hidden conditions are not cut", ["layout"], () => ({ js: plant(COMPOSER_JS, 'rows[i].classList.add("cut");', "void 0;") })],
  ["a panel taller than the screen", ["layout"], () => ({ css: plant(FIRE_CSS, "border-radius: var(--r-lg); display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }", "border-radius: var(--r-lg); display: flex; flex-direction: column; min-height: 1200px; min-width: 0; overflow: hidden; }") })],
  ["the edit-all control is never offered", ["conditionDialog"], () => ({ js: plant(COMPOSER_JS, 'more.hidden = cut === 0 && !dlg.open;', "more.hidden = true;") })],
  ["Show all is never offered", ["previewDialog"], () => ({ js: plant(PREVIEW_JS, "showAll.hidden = cut === 0;", "showAll.hidden = true;") })],
  ["controls are small on a touch screen", ["keyboardAndTargets"], () => ({ css: plant(FIRE_CSS, ".ffx-sel, .ffx-in, .ffx-st, .ffx-rm, .ffx-bool, .ffx-seg button, .ffx-link { min-height: 44px; }", ".ffx-sel, .ffx-in, .ffx-st, .ffx-rm, .ffx-bool, .ffx-seg button, .ffx-link { min-height: 24px; }") })],
  ["the focus ring is removed", ["keyboardAndTargets"], () => ({ css: plant(FIRE_CSS, ":where(.ffx, .ffx-dlg) :focus-visible { outline: var(--focus-ring); outline-offset: 2px; }", ":where(.ffx, .ffx-dlg) :focus-visible { outline: none !important; }") })],
  ["the tabs ignore the arrow keys", ["keyboardAndTargets"], () => ({ js: plant(FIRE_JS, 'var j = e.key === "ArrowRight" ? i + 1 :', 'var j = e.key === "ArrowRightX" ? i + 1 :') })],
  ["an adjusted wire can change cadence", ["sheetAndAdjust"], () => ({ js: plant(FIRE_JS, "lockCadence: !!adjust,", "lockCadence: false,") })],
  ["an adjust sends no base version", ["sheetAndAdjust"], () => ({ js: plant(FIRE_JS, "net.patch(\"/api/ff/wires\", { id: adjust.id, version: adjust.version, ast: ast })", "net.patch(\"/api/ff/wires\", { id: adjust.id, ast: ast })") })],
  ["the symbol is not prefilled", ["sheetAndAdjust"], () => ({ js: plant(FIRE_JS, "if (symbol && /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) wb.setSymbol(symbol);", "") })],
  ["the info dialog loses focus return", ["keyboardAndTargets"], () => ({ js: plant(FIRE_JS, 'document.getElementById("ffxInfoBtn").addEventListener("click", function () { info.showModal(); });', 'document.getElementById("ffxInfoBtn").addEventListener("click", function () { info.show(); });') })],
  ["a contrast failure", ["axeCheck"], () => ({ css: plant(FIRE_CSS, ".ffx-wait { margin: 0; padding: 8px 12px; font: var(--t-footnote); color: var(--ff-absent, var(--label-3)); }", ".ffx-wait { margin: 0; padding: 8px 12px; font: var(--t-footnote); color: var(--label-4); }") })],
];

const only = process.env.FF_D_ONLY ? process.env.FF_D_ONLY.split(",") : null;
const browser = await launch();
for (const [name, fn] of Object.entries(SCENARIOS)) {
  if ((only && !only.includes(name)) || process.env.FF_D_SKIPPROD) continue;
  const before = failures.length;
  try { await fn(browser); } catch (err) { failures.push(name + " threw: " + err.message.split("\n").slice(0, 4).join(" / ")); }
  console.log((failures.length === before ? "ok   " : "FAIL ") + name);
}
const production = failures.splice(0);
let survivors = 0;
if (process.env.FF_D_PLANTS && production.length === 0) {
  const wanted = process.env.FF_D_PLANT ? process.env.FF_D_PLANT.split(",").map(Number) : null;
  for (const [index, [name, scenarios, opts]] of PLANTS.entries()) {
    if (wanted && !wanted.includes(index)) continue;
    let applied;
    try { applied = opts(); } catch (err) {
      survivors++;
      console.log("PLANT DID NOT APPLY: " + name + ": " + err.message);
      continue;
    }
    let killed = false;
    stopFast = true;
    for (const s of scenarios) {
      const mark = failures.length;
      PATCH = applied;
      try { await SCENARIOS[s](browser); } catch (err) { failures.push("threw"); }
      PATCH = {};
      if (failures.length > mark) killed = true;
      failures.length = mark;
    }
    stopFast = false;
    if (!killed) { survivors++; console.log("SURVIVED: " + name); }
    else console.log("killed   " + index + " " + name);
  }
  console.log(PLANTS.length + " planted wrong builds, " + survivors + " survived");
}
await browser.close();
console.log(production.slice(0, 40).join("\n"));
console.log(checks + " checks, " + production.length + " failed");
process.exit(production.length || survivors ? 1 : 0);
