import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as PAGES from "../shared/flows-pages.js";
import * as FX from "./lib/oracle-fixtures.mjs";
import { launch, open, settle, waitOracle, ROOT, harnessHtml } from "./lib/oracle-world.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RECORDS = { SYO001: FX.record(), SYO002: FX.CALM(), SYO003: FX.CONFLICT(), SYO004: FX.STALE(), SYO005: FX.BUILDING(), "*": FX.record() };
const flow = (page, rows) => page.evaluate((r) => window.__fl({ rows: r, at: Date.now() }), rows);
const TICKER_URL = (t) => `/flows/ticker/?t=${t}`;
const surgeRows = (t, n = 6, each = 160000) => Array.from({ length: n }, (_, i) => FX.row(t, 2 + i * 4, { prem: each, k: 60 + i }));

const browser = await launch();
try {
async function restoreProbe(mutate, only) {
  const fails = [];
  const need = (c, m) => { if (!c) fails.push(m); };
  const want = (k) => !only || only.includes(k);
  const off = [{ name: "fn_oracle", value: "off", path: "/flows" }];
  const read = (page) => page.evaluate(() => {
    const host = document.getElementById("fxOracle"), orb = host.querySelector(".orc-orb"), b = host.querySelector(".orc-restore");
    const r = b && !b.hidden ? b.getBoundingClientRect() : null;
    const t = b ? b.querySelector(".orc-restore-t") : null, u = b ? b.querySelector(".orc-restore-u") : null;
    const live = host.querySelector('[role="status"]'), toast = host.querySelector(".orc-toast");
    return { pref: host.getAttribute("data-pref"), orb: orb.hidden, restore: !!r, undo: b ? b.classList.contains("is-undo") : false,
      text: t && !t.hidden ? t.textContent : "", undoText: u && !u.hidden ? u.textContent : "", name: b ? b.getAttribute("aria-label") : null,
      focus: document.activeElement === b, orbFocus: document.activeElement === orb, status: live ? live.textContent : "", toast: !!(toast && !toast.hidden),
      box: r ? { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } : null, vw: innerWidth, vh: innerHeight, cookies: document.cookie };
  });
  const press = async (page, sel, why) => {
    if (!(await page.isVisible(sel))) { fails.push(why); return false; }
    await page.click(sel, { timeout: 5000 });
    return true;
  };
  const hide = async (page, from) => {
    await page.click(".orc-orb");
    await sleep(400);
    if (from) { await page.click(`.orc-pref-b[data-pref="${from}"]`); await settle(page, 200); }
    await page.click('.orc-pref-b[data-pref="off"]');
    await settle(page, 300);
  };
  const ready = async (page) => { await page.clock.runFor(3000); await sleep(1200); await page.clock.runFor(1000); await settle(page, 300); };
  const home = () => PAGES.oracleShell(PAGES.overviewPage({ username: "test" }), "on", "overview");
  if (want("core") || want("core0")) for (const [width, height] of want("core") ? [[1440, 820], [390, 844]] : [[1440, 820]]) {
    const w = await open(browser, { width, height, touch: width < 768, mutate, records: RECORDS, topBody: FX.top() });
    await waitOracle(w.page);
    await settle(w.page, 300);
    await hide(w.page);
    const a = await read(w.page);
    need(a.pref === "off" && a.orb && a.restore, `${width}: choosing Hidden removes the orb and leaves a restore control`);
    need(a.undo && a.text === "Neuron hidden" && a.undoText === "Undo" && a.name === "Neuron hidden. Undo", `${width}: for ten seconds the control says the Neuron is hidden and offers Undo: ${a.text} ${a.undoText}`);
    need(a.focus, `${width}: and focus moves to it`);
    need(a.status === "Neuron hidden. Undo brings it back.", `${width}: and hiding is announced: ${a.status}`);
    need(/fn_oracle_prev=on/.test(a.cookies), `${width}: the choice before hiding is remembered`);
    need(a.box && a.box.r <= a.vw + 0.5 && a.box.b <= a.vh + 0.5 && a.box.h >= (width < 768 ? 44 : 36) - 0.5, `${width}: the control sits inside the viewport at a usable size`);
    if (!(await press(w.page, ".orc-restore", `${width}: there is a visible control to undo the hide`))) { await w.close(); continue; }
    await settle(w.page, 300);
    const b = await read(w.page);
    need(b.pref === "on" && !b.orb && !b.restore, `${width}: Undo brings the Neuron back as it was`);
    need(b.orbFocus, `${width}: and hands focus to the orb`);
    if (!want("core")) { await w.close(); continue; }
    await hide(w.page);
    await w.page.clock.runFor(10600);
    await settle(w.page, 200);
    const c = await read(w.page);
    need(c.restore && !c.undo && c.text === "" && c.name === "Show the Neuron", `${width}: after ten seconds a small button stays, named Show the Neuron`);
    need(c.box && c.box.w >= (width < 768 ? 44 : 36) - 0.5 && c.box.h >= (width < 768 ? 44 : 36) - 0.5, `${width}: a target a finger or a pointer can hit`);
    if (!(await press(w.page, ".orc-restore", `${width}: the small restore button can be pressed`))) { await w.close(); continue; }
    await settle(w.page, 300);
    const d = await read(w.page);
    need(d.pref === "on" && !d.orb, `${width}: pressing it brings the Neuron back as it was`);
    need(d.orbFocus && d.status === "Neuron shown.", `${width}: and hands focus to the orb, saying so: ${d.status}`);
    await w.close();
  }
  if (want("undo")) {
    const w = await open(browser, { mutate, records: RECORDS, topBody: FX.top() });
    await waitOracle(w.page);
    await settle(w.page, 300);
    await w.page.click(".orc-orb");
    await sleep(400);
    const now = () => w.page.evaluate(() => Date.now());
    const before = await now();
    await w.page.click('.orc-pref-b[data-pref="off"]');
    const after = await now();
    await w.page.clock.pauseAt(new Date(after + 2000));
    const early = before + 9500 - (after + 2000);
    need(early > 0, `hiding took ${after - before} ms of page time, too long to look at Undo at 9.5 s`);
    if (early > 0) await w.page.clock.runFor(early);
    const a = await read(w.page);
    need(a.undo && a.name === "Neuron hidden. Undo" && a.focus, `Undo is still offered nine and a half seconds after hiding: ${a.name}`);
    await w.page.clock.runFor(after + 10100 - Math.max(before + 9500, after + 2000));
    const b = await read(w.page);
    need(b.restore && !b.undo && b.name === "Show the Neuron", `and gives way to the small button once the ten seconds are over: ${b.name}`);
    await w.page.clock.resume();
    await w.close();
  }
  if (want("count")) {
    const w = await open(browser, { mutate, records: RECORDS, topBody: FX.top() });
    await waitOracle(w.page);
    await settle(w.page, 300);
    await hide(w.page, "quiet");
    need(/fn_oracle_prev=quiet/.test((await read(w.page)).cookies), "hiding from Count remembers Count");
    if (await press(w.page, ".orc-restore", "Undo is offered after hiding from Count")) {
      await settle(w.page, 300);
      const b = await read(w.page);
      need(b.pref === "quiet" && b.orbFocus, `Undo after hiding from Count gives Count back with focus on the orb: ${b.pref}`);
    }
    await w.close();
  }
  if (want("capped")) {
    const capped = await open(browser, { mode: "quiet", mutate, records: RECORDS, topBody: FX.top(), cookies: [{ name: "fn_oracle", value: "on", path: "/flows" }] });
    await waitOracle(capped.page);
    await settle(capped.page, 300);
    await hide(capped.page);
    if (await press(capped.page, ".orc-restore", "a page that caps the Neuron at Count still offers Undo")) {
      await settle(capped.page, 300);
      const e = await read(capped.page);
      need(e.pref === "quiet" && /(^|; )fn_oracle=on(;|$)/.test(e.cookies), `a page that caps the Neuron at Count does not overwrite the reader's Pill: ${e.pref} ${e.cookies}`);
    }
    await capped.close();
  }
  if (want("shortcut") || want("stored")) {
    const cookies = [...off, { name: "fn_oracle_prev", value: "quiet", path: "/flows" }];
    if (want("stored")) {
    const q = await open(browser, { mutate, records: RECORDS, topBody: FX.top(), cookies });
    await ready(q.page);
    if (await press(q.page, ".orc-restore", "a stored Hidden choice still shows a restore button")) {
      await settle(q.page, 300);
      need((await read(q.page)).pref === "quiet", "a reader who hid it from Count gets Count back");
    }
    await q.close();
    }
    if (want("shortcut")) {
    const k = await open(browser, { mutate, records: RECORDS, topBody: FX.top(), cookies });
    await ready(k.page);
    await k.page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await k.page.keyboard.press("Alt+Shift+KeyN");
    await settle(k.page, 300);
    const s = await read(k.page);
    need(s.pref === "quiet" && !s.orb && s.orbFocus, `Alt+Shift+N gives back the mode chosen before hiding and focuses the orb: ${s.pref}`);
    await k.close();
    }
  }
  if (want("tabs")) {
    const a = await open(browser, { mutate, records: RECORDS, topBody: FX.top() });
    const second = await a.context.newPage();
    await second.clock.install({ time: new Date("2026-10-14T15:30:00Z") });
    await second.goto("http://oracle.test/flows/unusual/", { waitUntil: "load" });
    await waitOracle(a.page);
    await waitOracle(second);
    await settle(a.page, 300);
    await settle(second, 300);
    await hide(a.page, "quiet");
    const stale = await second.isVisible(".orc-orb");
    need(stale, "a second tab opened before the change still shows its orb");
    if (stale) await hide(second);
    need(/fn_oracle_prev=quiet/.test(await a.page.evaluate(() => document.cookie)), "hiding again in that second tab does not overwrite the mode the reader chose");
    if (await press(a.page, ".orc-restore", "the first tab still offers its restore")) {
      await settle(a.page, 300);
      need((await read(a.page)).pref === "quiet", "and Undo in the first tab gives Count back");
    }
    await second.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle(second, 300);
    const b = await read(second);
    need(b.pref === "quiet" && !b.orb && !b.restore, `a tab that comes back into view takes up the current choice: ${b.pref}`);
    await a.close();
  }
  if (want("cover") || want("cover1")) for (const [width, height] of want("cover") ? [[1920, 1080], [1024, 768]] : [[1920, 1080]]) {
    const w = await open(browser, { width, height, url: "/flows/", slug: "overview", html: home(), mutate, records: RECORDS, topBody: FX.top(), reduced: true });
    await waitOracle(w.page);
    await settle(w.page, 1500);
    await w.page.evaluate(() => document.querySelector(".orc-orb").focus());
    await w.page.keyboard.press("Enter");
    await settle(w.page, 300);
    await w.page.evaluate(() => document.querySelector('.orc-pref-b[data-pref="off"]').focus());
    await w.page.keyboard.press("Enter");
    await settle(w.page, 300);
    const pill = (await read(w.page)).box;
    need(!!pill, `${width}: hiding from the keyboard leaves the Undo control`);
    for (let i = 0; i < 3 && pill; i++) {
      await w.page.keyboard.press("Shift+Tab");
      await settle(w.page, 200);
      const hit = await w.page.evaluate((p) => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const r = a.getBoundingClientRect();
        if (!(r.left < p.r && r.right > p.x && r.top < p.b && r.bottom > p.y)) return null;
        const e = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return e === a || a.contains(e) ? null : (a.id || a.className || a.tagName) + " under " + (e ? e.className || e.tagName : "nothing");
      }, pill);
      need(!hit, `${width}: a control that keyboard focus moves to is not hidden under the Undo control (WCAG 2.4.11): ${hit}`);
    }
    await w.close();
  }
  if (want("dead") || want("dead1")) for (const [width, height] of want("dead") ? [[1440, 820], [390, 844]] : [[1440, 820]]) {
    const w = await open(browser, { width, height, touch: width < 768, mutate, records: RECORDS, topBody: FX.top(), cookies: off });
    await ready(w.page);
    const g = await w.page.evaluate(() => {
      const b = document.querySelector(".orc-restore").getBoundingClientRect();
      const e = document.elementFromPoint(b.right - 50, b.bottom - 50);
      return { inside: !!(e && e.closest("#fxOracle")), at: e ? String(e.className || e.tagName) : null };
    });
    need(!g.inside, `${width}: with the Neuron hidden the corner around its button takes no clicks (${g.at})`);
    await w.close();
  }
  if (want("sheet")) {
    const w = await open(browser, { mutate, records: RECORDS, topBody: FX.top(), cookies: off });
    await ready(w.page);
    await w.page.evaluate(() => window.FlowsUI.oracle.open());
    await settle(w.page, 400);
    need(!(await w.page.isVisible(".orc-restore")), "while a sheet opens over a hidden Neuron its restore button is out of the way");
    await w.page.keyboard.press("Escape");
    await settle(w.page, 400);
    const r = await read(w.page);
    need(r.restore && r.focus, "and closing the sheet hands focus to that button");
    await w.close();
  }
  if (want("chord")) {
    const w = await open(browser, { mutate, records: RECORDS, topBody: FX.top(), cookies: [...off, { name: "fn_oracle_prev", value: "quiet", path: "/flows" }] });
    await ready(w.page);
    await w.page.evaluate(() => window.FlowsUI.oracle.open());
    await settle(w.page, 400);
    await w.page.keyboard.press("Alt+Shift+KeyN");
    await settle(w.page, 300);
    const s = await w.page.evaluate(() => {
      const sheet = document.querySelector(".orc-sheet"), a = document.activeElement;
      return { open: !!sheet && !sheet.hidden, inside: !!(sheet && a && sheet.contains(a)), pref: document.getElementById("fxOracle").getAttribute("data-pref") };
    });
    need(s.pref === "quiet" && s.open && s.inside, `Alt+Shift+N with the sheet open brings the Neuron back and keeps focus inside the sheet: ${JSON.stringify(s)}`);
    await w.page.keyboard.press("Escape");
    await settle(w.page, 400);
    need((await read(w.page)).orbFocus, "and closing the sheet then hands focus to the orb");
    await w.close();
  }
  if (want("toast")) {
    const html = harnessHtml({ mode: "on", slug: "ticker", active: "ticker" });
    const w = await open(browser, { width: 390, height: 844, touch: true, url: TICKER_URL("SYO001"), slug: "ticker", html, mutate, records: RECORDS, topBody: FX.top() });
    await waitOracle(w.page);
    await settle(w.page, 400);
    await flow(w.page, surgeRows("SYO001"));
    await sleep(300);
    need((await read(w.page)).toast, "a signal on a phone shows its toast");
    await w.page.evaluate(() => window.FlowsUI.oracle.open());
    await sleep(400);
    await w.page.click('.orc-pref-b[data-pref="off"]');
    await settle(w.page, 300);
    need(!(await read(w.page)).toast, "choosing Hidden takes the toast away with the orb");
    await w.close();
  }
  if (want("strips") || want("home")) {
    const w = await open(browser, { url: "/flows/", slug: "overview", html: home(), mutate, records: RECORDS, topBody: FX.top(), cookies: off });
    await ready(w.page);
    const strip = await w.page.evaluate(() => (document.getElementById("orcHome") || {}).textContent || "");
    need(strip.includes("Hidden. The button in the corner shows it again.") && !strip.includes("Reading"), `the Home strip says the Neuron is hidden rather than reading forever: ${strip}`);
    await w.close();
  }
  if (want("strips")) {
    const u = await open(browser, { mutate, records: RECORDS, topBody: FX.top(), cookies: off });
    await ready(u.page);
    const band = await u.page.evaluate(() => (document.getElementById("orcBand") || {}).textContent || "");
    need(band.includes("Hidden. The button in the corner shows it again."), `the Unusual band says the Neuron is hidden: ${band}`);
    await u.close();
  }
  return fails;
}

{
  eq(await restoreProbe({}), [], "hiding the Neuron offers Undo, leaves a small restore button, and restoring returns the mode chosen before");
  const SRC = { "flows-oracle.js": fs.readFileSync(path.join(ROOT, "assets/js/flows-oracle.js"), "utf8"), "flows-oracle.css": fs.readFileSync(path.join(ROOT, "assets/css/flows-oracle.css"), "utf8") };
  const SAVE = 'if (raw !== "off") setCookie("fn_oracle_prev", PREF[raw] > 0 ? raw : "on");';
  for (const [name, file, from, to, only] of [
    ["hiding with no way back", "flows-oracle.js", "    restore.hidden = !off || S.open;\n", "    restore.hidden = true;\n", ["core0"]],
    ["restore always lands on Count", "flows-oracle.js", 'setPref(PREF[p] > 0 ? p : "on");', 'setPref("quiet");', ["core0"]],
    ["no undo window", "flows-oracle.js", "S.undoUntil = Date.now() + UNDO_MS;", "S.undoUntil = 0;", ["core0"]],
    ["no focus after a restore", "flows-oracle.js", "    say(\"Neuron shown.\");\n    if (!S.open) { try { orb.focus(); } catch (e) {   } }\n", "    say(\"Neuron shown.\");\n", ["core0"]],
    ["hiding is not announced", "flows-oracle.js", '      say("Neuron hidden. Undo brings it back.");\n', "", ["core0"]],
    ["the saved mode is always Pill", "flows-oracle.js", SAVE, 'setCookie("fn_oracle_prev", "on");', ["count"]],
    ["a capped page saves its cap as the reader's choice", "flows-oracle.js", SAVE, 'setCookie("fn_oracle_prev", was);', ["capped"]],
    ["the shortcut ignores the saved mode", "flows-oracle.js", "{ e.preventDefault(); restorePref(); }", '{ e.preventDefault(); setPref("on"); }', ["shortcut"]],
    ["a stale tab overwrites the saved mode", "flows-oracle.js", SAVE, 'setCookie("fn_oracle_prev", PREF[raw] > 0 ? raw : was);', ["tabs"]],
    ["a tab never takes up the current choice", "flows-oracle.js", '    document.addEventListener("visibilitychange", onVis);\n', "", ["tabs"]],
    ["the Undo pill outlives focus", "flows-oracle.js", '    restore.addEventListener("focusout", function () { if (S.undoUntil > Date.now()) { S.undoUntil = 0; clearTimeout(S.undoTimer); paintOrb(); } });\n', "", ["cover1"]],
    ["the hidden corner takes clicks", "flows-oracle.css", '.orc[data-pref="off"]:not(.is-open) { width: 0; height: 0; }\n', "", ["dead1"]],
    ["the restore button sits over an open sheet", "flows-oracle.js", "    restore.hidden = !off || S.open;\n", "    restore.hidden = !off;\n", ["sheet"]],
    ["the toast outlives Hidden", "flows-oracle.js", 'if (S.pref === "off") { setOpen(false); dropToast(); }', 'if (S.pref === "off") { setOpen(false); }', ["toast"]],
    ["a one-second Undo", "flows-oracle.js", "  var UNDO_MS = 10000;", "  var UNDO_MS = 1000;", ["undo"]],
    ["a restore pulls focus out of an open sheet", "flows-oracle.js", "    if (!S.open) { try { orb.focus(); } catch (e) {   } }\n", "    try { orb.focus(); } catch (e) {   }\n", ["chord"]],
    ["the Home strip keeps reading", "flows-oracle.js", '    if (S.pref === "off") { el.append(h("span", { class: "orc-home-t" }, HIDDEN_TEXT)); return; }\n', "", ["home"]],
  ]) {
    eq(SRC[file].split(from).length - 1, 1, `planted wrong build "${name}" finds its line exactly once`);
    ok((await restoreProbe({ [file]: (t) => t.replace(from, to) }, only)).length > 0, `planted wrong build "${name}" is caught`);
  }
}
} finally {
  await browser.close();
}
console.log(`flows-oracle-restore-render: ${checks} checks`);
