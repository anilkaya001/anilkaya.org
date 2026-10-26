import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as PAGES from "../shared/flows-pages.js";
import * as FX from "./lib/oracle-fixtures.mjs";
import { absentRecord } from "../server/routes/flows-oracle.js";
import { launch, open, settle, waitOracle, ROOT, harnessHtml } from "./lib/oracle-world.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.ORACLE_SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const VIEWS = [[1440, 820], [1024, 768], [390, 844], [320, 640]];
const MINUS = "\u2212";

const money = (n) => (n < 0 ? MINUS : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
const plus = (n) => (n > 0 ? "+" : n < 0 ? MINUS : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");

const RECORDS = { SYO001: FX.record(), SYO002: FX.CALM(), SYO003: FX.CONFLICT(), SYO004: FX.STALE(), SYO005: FX.BUILDING(), "*": FX.record() };

async function boot(browser, o = {}) {
  const w = await open(browser, { records: RECORDS, topBody: FX.top(), ...o });
  if (o.wait === false) { await w.page.clock.runFor(3000); await sleep(1500); await w.page.clock.runFor(1000); } else await waitOracle(w.page);
  await settle(w.page, 600);
  return w;
}

const flow = (page, rows) => page.evaluate((r) => window.__fl({ rows: r, at: Date.now() }), rows);
const TICKER_URL = (t) => `/flows/ticker/?t=${t}`;
const surgeRows = (t, n = 6, each = 160000) => Array.from({ length: n }, (_, i) => FX.row(t, 2 + i * 4, { prem: each, k: 60 + i }));

async function geometry(page) {
  return page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const host = document.getElementById("fxOracle");
    return {
      vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth,
      orb: r(host.querySelector(".orc-orb")), sheet: host.querySelector(".orc-sheet") && !host.querySelector(".orc-sheet").hidden ? r(host.querySelector(".orc-sheet")) : null,
      pill: r(host.querySelector(".orc-pill")), tabs: r(document.getElementById("fxTabs")),
      list: r(host.querySelector(".orc-list")), listScroll: host.querySelector(".orc-list") ? host.querySelector(".orc-list").scrollHeight : 0,
    };
  });
}

async function audit(page, view) {
  const fails = [];
  const need = (c, m) => { if (!c) fails.push(m); };
  await page.click(".orc-orb");
  await sleep(500);
  const g = await geometry(page);
  need(g.sheet !== null, "the sheet opens");
  if (g.sheet) {
    need(g.sheet.y >= 0 && g.sheet.x >= 0 && g.sheet.r <= g.vw + 0.5 && g.sheet.b <= g.vh + 0.5, `the sheet stays inside the viewport at ${view}`);
    need(g.sheet.h <= g.vh - 24 + 0.5, `the sheet is shorter than the viewport at ${view}`);
  }
  if (g.tabs && g.tabs.h > 0) need(g.orb.b <= g.tabs.y + 0.5, `the orb stays above the tab bar at ${view}`);
  let trapped = true;
  const inside = () => page.evaluate(() => document.querySelector(".orc-sheet").contains(document.activeElement));
  for (let i = 0; i < 24 && trapped; i++) { await page.keyboard.press("Tab"); trapped = await inside(); }
  for (let i = 0; i < 6 && trapped; i++) { await page.keyboard.press("Shift+Tab"); trapped = await inside(); }
  need(trapped, "Tab never leaves the sheet");
  const inert = await page.evaluate(() => [...document.querySelectorAll("#flowsMain, #fxSide, #fxBar")].every((n) => n.inert));
  need(inert, "the page behind the sheet is inert");
  await page.keyboard.press("Escape");
  await sleep(150);
  await page.clock.runFor(400);
  need(await page.evaluate(() => { const c = document.querySelector(".orc-badge-v"); return !c || /[\u25B2\u25BC]/.test(c.textContent); }), "a verdict badge carries a glyph and a word, not colour alone");
  const closed = await page.evaluate(() => ({ hidden: document.querySelector(".orc-sheet").hidden, focus: document.activeElement && document.activeElement.classList.contains("orc-orb"), inert: document.getElementById("flowsMain").inert }));
  need(closed.hidden, "Escape closes the sheet");
  need(closed.focus, "focus returns to the orb");
  need(!closed.inert, "the page is live again");
  return fails;
}

const browser = await launch();

for (const [w, h] of VIEWS) {
  const t = await boot(browser, { width: w, height: h });
  const fails = await audit(t.page, `${w}x${h}`);
  eq(fails, [], `the sheet and the orb behave at ${w}x${h}`);
  const g = await geometry(t.page);
  ok(g.orb.w === 52 && g.orb.h === 52, `the orb is 52 px at ${w}`);
  ok(g.orb.r <= g.vw && g.orb.b <= g.vh && g.orb.x >= 0, `the orb is inside the viewport at ${w}`);
  eq(g.scrollW <= g.vw, true, `no sideways scroll at ${w}`);
  const noScrollBefore = await t.page.evaluate(() => document.documentElement.scrollHeight);
  ok(noScrollBefore <= h + 1, `the orb adds no document height at ${w}x${h} (${noScrollBefore})`);
  await t.close();
}

{
  const off = await open(browser, { html: harnessHtml({ mode: "off" }), records: RECORDS, topBody: FX.top() });
  await settle(off.page, 4000);
  eq(await off.page.evaluate(() => !document.getElementById("fxOracle") && !document.querySelector('i[data-defer="oracle"]')), true, "with the switch off the page carries no markup");
  eq(off.log.oracleHits, 0, "with the switch off there is no request");
  eq(off.log.requests.some((r) => /flows-oracle/.test(r)), false, "and no file");
  await off.close();
  eq(PAGES.oracleShell("<html></body></html>", "off", "overview"), "<html></body></html>", "oracleShell off is the identity");
  eq(PAGES.oracleShell("<html></body></html>", "", "overview"), "<html></body></html>", "and so is an unknown mode");
}

{
  const quiet = await boot(browser, { cookies: [{ name: "fn_oracle", value: "quiet", path: "/flows" }] });
  await flow(quiet.page, surgeRows("SYO001"));
  await settle(quiet.page, 400);
  await flow(quiet.page, []);
  await settle(quiet.page, 400);
  const s = await quiet.page.evaluate(() => ({ pill: document.querySelector("#fxOracle").classList.contains("has-pill"), badge: document.querySelector(".orc-badge").hidden, count: document.querySelector(".orc-badge").textContent }));
  eq([s.pill, s.badge], [false, false], "the count-only preference shows the count and no pill");
  await quiet.close();
  const off = await boot(browser, { cookies: [{ name: "fn_oracle", value: "off", path: "/flows" }], wait: false });
  eq(await off.page.evaluate(() => document.getElementById("fxOracle").hidden), true, "the hidden preference removes the orb");
  await off.page.keyboard.press("Alt+Shift+KeyN");
  await settle(off.page, 300);
  eq(await off.page.evaluate(() => document.getElementById("fxOracle").hidden), false, "Alt+Shift+N brings it back");
  await off.close();
}

{
  const w = await boot(browser, { url: TICKER_URL("SYO001"), slug: "ticker" });
  await w.page.evaluate(() => { window.__quotes = {}; });
  const html = harnessHtml({ mode: "on", slug: "ticker", active: "ticker", body: `<section id="ftHero"><div id="ftReadRail" style="display:flex;flex-direction:column;width:360px;height:300px"><p class="ft-rail-lead">The reading.</p><div class="ft-foot">foot</div></div></section>` });
  await w.close();
  const g = await open(browser, { url: TICKER_URL("SYO001"), slug: "ticker", html, records: RECORDS, topBody: FX.top() });
  await waitOracle(g.page);
  await settle(g.page, 600);
  const gl = await g.page.evaluate(() => { const b = document.querySelector("#ftReadRail .orc-glance"); const f = document.querySelector("#ftReadRail .ft-foot"); return b ? { text: b.textContent, before: b.nextElementSibling === f, h: b.getBoundingClientRect().height } : null; });
  ok(gl && gl.before, "the glance block sits above the footer line");
  ok(gl.h <= 44.5 && gl.h >= 43.5, "and is one fixed line of 44 px");
  ok(gl.text.includes("The 65 call for Nov 20 looks cheap."), "it carries the lead call's headline");
  ok(gl.text.includes("Up") && gl.text.includes("Leaning"), "and the stance chip");
  await g.page.click("#ftReadRail .orc-gl-b");
  await sleep(450);
  const sheet = await g.page.evaluate(() => ({ open: !document.querySelector(".orc-sheet").hidden, cards: document.querySelectorAll(".orc-sec[aria-label='SYO001'] .orc-card").length, hl: [...document.querySelectorAll(".orc-sec[aria-label='SYO001'] .orc-hl")].map((n) => n.textContent) }));
  eq(sheet.open, true, "the glance opens the sheet");
  eq(sheet.cards, 2, "the name's section holds its two calls");
  eq(sheet.hl, ["The 65 call for Nov 20 looks cheap.", "The 75 put for Nov 20 looks rich."], "head sentences are the record's own");
  if (SHOTS) await g.page.screenshot({ path: path.join(SHOTS, "ticker-sheet-1440.png") });

  const figs = await g.page.evaluate(() => [...document.querySelectorAll(".orc-sec[aria-label='SYO001'] .orc-card")].map((c) => [...c.querySelectorAll(".orc-fig dd")].map((d) => d.textContent)));
  eq(figs[0], [plus(41), "46%", "$68.10"], "the cheap call's three figures");
  eq(figs[1], [plus(28), "71%", "$70.15"], "the rich call's three figures");
  const text = await g.page.evaluate(() => document.querySelector(".orc-sheet").innerText);
  ok(!/\b(ET|EST|EDT|UTC|GMT|Eastern)\b/.test(text), "no other zone is named");
  ok(/TRT/.test(text), "times are TRT");
  ok(text.includes("Model-implied, not a quote and not advice."), "the model-implied line is under every call");
  eq(await g.page.evaluate(() => [...document.querySelectorAll(".orc-sec[aria-label='SYO001'] .orc-card")].every((c) => c.querySelector(".orc-fine").textContent.startsWith("Model-implied"))), true, "on every card");
  await g.page.click(".orc-sec[aria-label='SYO001'] .orc-card .orc-tog");
  await sleep(500);
  const det = await g.page.evaluate(() => { const c = document.querySelector(".orc-sec[aria-label='SYO001'] .orc-card"); return { open: c.dataset.open, rows: [...c.querySelectorAll(".orc-row")].map((r) => r.textContent) }; });
  eq(det.open, "1", "Show why opens the details");
  ok(det.rows.some((r) => r.startsWith("Market vol38.8")) && det.rows.some((r) => r.startsWith("Fair vol42.1")), "market and fair vol");
  ok(det.rows.some((r) => r.startsWith("Largest gainNot capped")), "an unbounded gain is said, not printed as a number");
  ok(det.rows.some((r) => r.startsWith("Quote$3.00 / $3.20")), "the quote");
  await g.close();
}

for (const [key, rec, want] of [["SYO002", FX.CALM(), "Nothing stands out."], ["SYO005", FX.BUILDING(), "There is no card for this name yet"], ["SYO002", FX.record({ ticker: "SYO002", state: "calm", calls: [], stance: { lean: "up", conviction: 0, basis: [], line: "No view on direction for this name." } }), "Nothing stands out."]]) {
  const html = harnessHtml({ mode: "on", slug: "ticker", active: "ticker", body: `<section id="ftHero"><div id="ftReadRail" style="display:flex;flex-direction:column;width:360px;height:300px"><p class="ft-rail-lead">The reading.</p><div class="ft-foot">foot</div></div></section>` });
  const g = await open(browser, { url: TICKER_URL(key), slug: "ticker", html, records: { ...RECORDS, [key]: rec }, topBody: FX.top() });
  await waitOracle(g.page);
  await settle(g.page, 600);
  const gl = await g.page.evaluate(() => { const b = document.querySelector("#ftReadRail .orc-glance"); return b ? { text: b.textContent, chip: b.querySelector(".orc-chip").textContent, lean: b.querySelector(".orc-chip").dataset.lean, i: b.querySelectorAll(".orc-chip i").length } : null; });
  ok(gl, `${key} ${rec.stance.lean}/${rec.stance.conviction}: the glance block is drawn`);
  eq((gl.text.match(/No view/g) || []).length, 1, `${key} ${rec.stance.lean}/${rec.stance.conviction}: a name with no view says No view once, not three times (${gl.text})`);
  ok(gl.chip.endsWith("No view") && gl.i === 0 && gl.lean === "none", `and the chip carries no second conviction word nor a lean it does not hold (${gl.chip})`);
  ok(gl.text.includes(want), `the line says why there is no view instead (${gl.text})`);
  await g.close();
}

{
  const records = { ...RECORDS, SYO001: FX.record({ calls: [{ ...FX.CHEAP, ev: null, pop: null, breakeven: null, say: undefined }] }) };
  const w = await open(browser, { url: TICKER_URL("SYO001"), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }), records, topBody: FX.top() });
  await waitOracle(w.page);
  await w.page.click(".orc-orb");
  await sleep(500);
  const figs = await w.page.evaluate(() => [...document.querySelectorAll(".orc-sec[aria-label='SYO001'] .orc-fig")].map((f) => f.textContent));
  eq(figs.map((f) => f.slice(0, f.indexOf("\u2014") + 1)), ["Average result\u2014", "Chance of profit\u2014", "Break-even\u2014"], "a missing figure is a dash and never a zero");
  ok(figs.every((f) => !/\$0(?![\d,.])|(?<![\d.])0%/.test(f)), "no zero stands in for a null");
  await w.close();
}

for (const [name, key, wantState, wantWord] of [["calm", "SYO002", "calm", "No view"], ["signal", "SYO001", "signal", "Leaning"], ["conflict", "SYO003", "conflict", "Mixed"], ["stale", "SYO004", "stale", "Leaning"], ["building", "SYO005", "calm", "No view"]]) {
  const w = await boot(browser, { url: TICKER_URL(key), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }) });
  await w.page.evaluate(() => { window.__flState.state = "closed"; window.FlowsUI.oracle.mount({}).update(); });
  await w.page.evaluate(() => window.FlowsUI.oracle.open());
  await sleep(500);
  const st = await w.page.evaluate(() => ({ s: document.getElementById("fxOracle").dataset.state, chip: document.querySelector(".orc-sec[aria-label] .orc-chip") && document.querySelector(".orc-sec .orc-chip").textContent }));
  if (name !== "stale" && name !== "building") eq(st.s, wantState, `${name} state`);
  ok(st.chip && st.chip.includes(wantWord), `${name} chip says ${wantWord}`);
  const body = await w.page.evaluate(() => document.querySelector(".orc-list").innerText);
  if (name === "calm") ok(body.includes("Nothing stands out."), "a calm name says so");
  if (name === "building") ok(body.includes("There is no card for this name yet") && body.includes("thin-norm: Too little history") || body.includes("norm: Too little history for this name."), "a building name says what is missing");
  if (name === "conflict") ok(body.includes("disagree"), "a conflict names the disagreement");
  if (SHOTS) await w.page.screenshot({ path: path.join(SHOTS, `state-${name}-1440.png`) });
  await w.close();
}

async function unbuiltChecks(mutate, why = null) {
  const fails = [];
  const need = (c, m) => { if (!c) fails.push(m); };
  const at = Date.parse("2026-10-14T15:30:00Z");
  const records = { ...RECORDS, SYO006: { ...absentRecord("SYO006", at, why), ...(why ? { why } : {}) } };
  const w = await open(browser, { mutate, url: TICKER_URL("SYO006"), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }), records, topBody: FX.top() });
  await waitOracle(w.page);
  await settle(w.page, 400);
  await w.page.evaluate(() => window.FlowsUI.oracle.open());
  await sleep(500);
  const sec = await w.page.evaluate(() => { const n = document.querySelector(".orc-sec[aria-label='SYO006']"); return n ? n.innerText : ""; });
  const sub = await w.page.evaluate(() => document.querySelector(".orc-sub").textContent);
  if (SHOTS && !Object.keys(mutate).length) await w.page.screenshot({ path: path.join(SHOTS, `unbuilt-${why || "ok"}-1440.png`) });
  need(sec.includes("Building: the Neuron has not written a view of SYO006 yet."), "an unbuilt view says it is being built");
  need(!/There is no card|no chain to price/.test(sec), "and never that a carded name has no card");
  need(!/Grade \d of 3|Priced on|Ideas:|absent|screen/.test(sec + sub), "and prints no grade, session, ideas source or raw reason");
  need(!/No view/.test(sec), "and no stance chip");
  if (why === "store") need(sec.includes("could not be read") && sec.includes("Retry"), "a failed read offers Retry");
  else need(sec.includes("the next nightly lands about Oct 15, 01:30 TRT."), "it names the next nightly in TRT, with the date when it is not today");
  need(!/\b(ET|EST|EDT|UTC)\b/.test(sec), "and no other zone");
  await w.close();
  return fails;
}

{
  eq(await unbuiltChecks({}), [], "an unbuilt view reads as building, with the next nightly in TRT");
  eq(await unbuiltChecks({}, "store"), [], "an unreadable store is a read failure with Retry");
  const MUTANTS = [
    ["the old no-card wording", { "flows-oracle.js": (t) => t.replace('if (rec && rec.stateWhy === "unbuilt") {', "if (false) {") }],
    ["the raw reason printed", { "flows-oracle.js": (t) => t.replace("return unbuiltBlock(box, t, rec);", 'box.append(h("p", null, "— oracle: absent")); return unbuiltBlock(box, t, rec);') }],
    ["an Eastern due time", { "flows-oracle.js": (t) => t.replace('return (d === U.F.trtDay(Date.now()) ? "" : U.F.day(d) + ", ") + U.F.time(v);', 'return "21:30 ET";') }],
  ];
  for (const [name, mutate] of MUTANTS) ok((await unbuiltChecks(mutate)).length > 0, `planted wrong build "${name}" is caught`);
}

{
  const w = await boot(browser, { oracle: "absent", url: TICKER_URL("SYO001"), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }) });
  await w.page.click(".orc-orb");
  await sleep(500);
  const t = await w.page.evaluate(() => document.querySelector(".orc-list").innerText);
  ok(t.includes("Neuron is resting") && t.includes("Retry"), "a missing route is an honest resting state with Retry, not an error wall");
  eq(w.log.errors, [], "and no page error");
  eq(await w.page.evaluate(() => document.getElementById("fxOracle").dataset.state), "watching", "the orb is not an error badge");
  w.state.oracle = "ok";
  await w.page.click(".orc-list .orc-retry");
  await sleep(500);
  ok((await w.page.evaluate(() => document.querySelector(".orc-list").innerText)).includes("The 65 call for Nov 20 looks cheap."), "Retry reads the view once the route answers");
  await w.close();
  const f = await boot(browser, { oracle: "failed" });
  await f.page.evaluate(() => { window.__flState.state = "closed"; window.FlowsUI.oracle.open(); });
  await sleep(500);
  ok((await f.page.evaluate(() => document.querySelector(".orc-list").innerText)).includes("The read failed."), "a failed read says it failed");
  await f.close();
}

{
  const html = harnessHtml({ mode: "on", slug: "ticker", active: "ticker" });
  const w = await open(browser, { url: TICKER_URL("SYO001"), slug: "ticker", html, records: RECORDS, topBody: FX.top() });
  await waitOracle(w.page);
  await settle(w.page, 400);
  await flow(w.page, surgeRows("SYO001"));
  await sleep(300);
  const s1 = await w.page.evaluate(() => ({ s: window.FlowsUI.oracle.state(), badge: document.querySelector(".orc-badge").textContent, pill: document.querySelector(".orc-pill-t").textContent, host: document.getElementById("fxOracle").dataset.state, label: document.querySelector(".orc-orb").getAttribute("aria-label"), has: document.getElementById("fxOracle").classList.contains("has-pill") }));
  eq(s1.s.messages.length >= 1, true, "a scripted flow stream produces a message");
  eq(s1.host, "signal", "the orb turns to signal");
  eq(s1.has, true, "the pill opens");
  ok(s1.pill.startsWith("SYO001 \u00B7 heavy flow"), "the pill carries the ticker and the short kind");
  ok(/^Neuron, \d+ new, press to open$/.test(s1.label), "the accessible name carries the count");
  const spend = s1.s.messages.filter((m) => m.kind === "surge")[0];
  const expectedP = 960000;
  eq(spend.say, `SYO001 has $960K of flagged options flow across 6 windows in the last 30 minutes. The bar for this name is $${Math.round(Math.max(3 * 4000000 * 30 / 390, 500000) / 1000)}K.`, "the message is the independent computation: the sum, the windows and the bar, with no pace");


  const before = await w.page.evaluate(() => window.FlowsUI.oracle.state().messages.length);
  await w.page.evaluate(() => { window.__flState.state = "stale"; });
  await flow(w.page, Array.from({ length: 6 }, (_, i) => FX.row("SYO001", 1 + i, { prem: 900000, k: 70 + i, sweep: true, size: 900 })));
  await sleep(300);
  await flow(w.page, []);
  eq(await w.page.evaluate(() => window.FlowsUI.oracle.state().messages.length), before, "a stale feed produces no message");
  await w.page.evaluate(() => { window.__flState.state = "live"; });

  const hostile = '<img src=x onerror="window.__pwn=1">';
  await flow(w.page, surgeRows(hostile));
  await w.page.evaluate(() => window.FlowsUI.oracle.open());
  await sleep(500);
  eq(await w.page.evaluate(() => window.__pwn === undefined && !document.querySelector(".orc-sheet img")), true, "a hostile ticker never reaches innerHTML");
  const live = await w.page.evaluate(() => document.querySelector(".orc-sec[aria-label='Right now']").innerText);
  ok(live.includes("SYO001 has $960K of flagged options flow across 6 windows"), "the sheet lists the message under Right now");
  ok(/\d\d:\d\d TRT/.test(live), "with a TRT time");
  if (SHOTS) await w.page.screenshot({ path: path.join(SHOTS, "live-sheet-1440.png") });
  await w.close();
}

{
  const w = await open(browser, { url: TICKER_URL("SYO001"), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }), records: RECORDS, topBody: FX.top() });
  await waitOracle(w.page);
  await w.page.evaluate(() => {
    window.__ann = [];
    const live = document.querySelector("#fxOracle [role=status]");
    new MutationObserver(() => window.__ann.push(Date.now())).observe(live, { childList: true, characterData: true, subtree: true });
  });
  for (const each of [160000, 150000, 500000]) {
    await flow(w.page, surgeRows("SYO001", 6, each));
    await w.page.clock.runFor(900);
  }
  await w.page.clock.runFor(6000);
  const ann = await w.page.evaluate(() => window.__ann.length);
  ok(ann >= 1 && ann <= 3, `announcements are throttled to one every five seconds (${ann})`);
  eq(await w.page.evaluate(() => window.__vib), 0, "the device never vibrates on its own");
  await w.close();
}

{
  const w = await boot(browser, { reduced: true, url: TICKER_URL("SYO001"), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }) });
  await flow(w.page, surgeRows("SYO001"));
  await w.page.click(".orc-orb");
  await sleep(400);
  const anims = await w.page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".orc")).length);
  eq(anims, 0, "under reduced motion nothing in the Neuron animates");
  await w.close();
  const m = await boot(browser, { url: TICKER_URL("SYO001"), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }) });
  const before = await m.page.evaluate(() => window.__raf);
  await sleep(2500);
  const after = await m.page.evaluate(() => window.__raf);
  eq(after - before, 0, "the idle paint census is zero: the Neuron runs no frame loop");
  await m.close();
}

{
  const r = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const f of ["assets/css/flows-oracle.css", "assets/js/flows-oracle.js", "assets/js/flows-oracle-core.js"]) {
    const src = r(f);
    ok(!/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(src.replace(/&#\d+;/g, "")), `${f} carries no hex colour`);
    ok(!/\brgba?\(|\bhsla?\(/.test(src), `${f} carries no colour function`);
    ok(!/\/\*|(^|[^:"'`])\/\/\s/m.test(src.replace(/https?:\/\/\S+/g, "")), `${f} carries no comment`);
  }
  const css = r("assets/css/flows-oracle.css");
  ok(!/transition[^;{}]*\b(height|width|top|left|right|bottom|max-height)\b/.test(css), "no transition runs on a layout property");
  ok(!/\bkeyframes[^{]*\{[^}]*\b(height|width|top|left)\b/.test(css.replace(/\n/g, " ")), "no keyframe moves a layout property");
  ok(/@supports \(backdrop-filter: blur\(1px\)\)/.test(css) && /forced-colors/.test(css) && /prefers-reduced-transparency/.test(css) && /prefers-reduced-motion/.test(css), "glass is guarded, with solid, forced-colour, reduced-transparency and reduced-motion branches");
  const js = r("assets/js/flows-oracle.js");
  ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(js), "the module writes text, never markup");
  ok(!/localStorage|sessionStorage/.test(js), "and uses no browser storage");
  ok(!/requestAnimationFrame/.test(js), "and runs no frame loop");
  ok(!/\b(America\/New_York|Eastern|EST|EDT)\b/.test(js), "names no other zone");
  ok(!/America\//.test(r("assets/js/flows-oracle-core.js")), "the core names no zone either");
}

async function probe(mutate) {
  const fails = [];
  const need = (c, m) => { if (!c) fails.push(m); };
  const nullEv = FX.record({ calls: [FX.record().calls[0], { ...FX.RICH, ev: null, pop: null, breakeven: null, say: undefined }] });
  const w = await open(browser, { width: 390, height: 844, touch: true, mutate, url: TICKER_URL("SYO001"), slug: "ticker", html: harnessHtml({ mode: "on", slug: "ticker", active: "ticker" }), records: { ...RECORDS, SYO001: nullEv }, topBody: FX.top() });
  await waitOracle(w.page);
  await settle(w.page, 300);
  await w.page.evaluate(() => {
    window.__ann = [];
    new MutationObserver(() => window.__ann.push(1)).observe(document.querySelector("#fxOracle [role=status]"), { childList: true, characterData: true, subtree: true });
  });
  for (const each of [160000, 150000, 500000]) {
    await flow(w.page, surgeRows("SYO001", 6, each));
    await w.page.clock.runFor(900);
  }
  await w.page.clock.runFor(4000);
  need((await w.page.evaluate(() => window.__ann.length)) <= 2, "one announcement per five seconds");
  need((await w.page.evaluate(() => window.__vib)) === 0, "no vibration on its own");
  const before = await w.page.evaluate(() => window.FlowsUI.oracle.state().messages.length);
  await w.page.evaluate(() => { window.__flState.state = "stale"; });
  await flow(w.page, Array.from({ length: 6 }, (_, i) => FX.row("SYO001", 1 + i, { prem: 900000, k: 70 + i, sweep: true, size: 900 })));
  await sleep(300);
  await flow(w.page, []);
  need((await w.page.evaluate(() => window.FlowsUI.oracle.state().messages.length)) === before, "a stale feed says nothing");
  await w.page.evaluate(() => { window.__flState.state = "live"; });
  fails.push(...await audit(w.page, "390 probe"));
  await w.page.click(".orc-orb");
  await sleep(500);
  const figs = await w.page.evaluate(() => [...document.querySelectorAll(".orc-sec[aria-label='SYO001'] .orc-card")].slice(-1)[0].querySelector(".orc-figs").textContent);
  need(!/\$0(?![\d,.])|(?<![\d.])0%/.test(figs) && figs.includes("\u2014"), "a null result is a dash");
  const text = await w.page.evaluate(() => document.querySelector(".orc-sheet").innerText);
  need(/TRT/.test(text) && !/\b(ET|EST|EDT|UTC)\b/.test(text), "only TRT is named");
  const src = await w.page.evaluate(async () => (await Promise.all(["/assets/css/flows-oracle.css", "/assets/js/flows-oracle.js", "/assets/js/flows-oracle-core.js"].map((u) => fetch(u + "?v=0").then((r) => r.text())))).join("\n"));
  need(!/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(src.replace(/&#\d+;/g, "")), "no hex colour");
  need(!/transition[^;{}]*\b(height|width|top|left|right|bottom|max-height)\b/.test(src), "no transition on a layout property");
  await w.close();
  return fails;
}

{
  const good = await probe({});
  eq(good, [], "the shipped build passes every probe");
  const MUTANTS = [
    ["a sheet taller than the viewport", { "flows-oracle.css": (t) => t.replace("    max-height: 70dvh;\n    padding-bottom", "    height: 140dvh;\n    max-height: none;\n    padding-bottom") }],
    ["an orb over the tab bar", { "flows-oracle.css": (t) => t.replace("bottom: calc(var(--tab-h) + var(--safe-b) + 12px);", "bottom: 4px;") }],
    ["no focus trap", { "flows-oracle.js": (t) => t.replace('if (e.key === "Tab") { trapKeys(e); return; }', "") }],
    ["a colour literal", { "flows-oracle.css": (t) => t + "\n.orc-badge { color: #ff0000; }\n" }],
    ["a spring on height", { "flows-oracle.css": (t) => t.replace("transition: transform 260ms var(--orc-ease), opacity 260ms linear; }", "transition: transform 260ms var(--orc-ease), opacity 260ms linear, height 300ms linear; }") }],
    ["an announcement per message", { "flows-oracle.js": (t) => t.replace("if (now - S.announceAt >= 5000) {", "if (true) {") }],
    ["a vibration on load", { "flows-oracle.js": (t) => t.replace("function mount() {", "function mount() { navigator.vibrate(8);") }],
    ["a zero for a null result", { "flows-oracle.js": (t) => t.replace("Number.isFinite(c.ev) ? K.signedWhole(c.ev) : DASH", "K.signedWhole(c.ev || 0)") }],
    ["an Eastern clock", { "flows-oracle-core.js": (t) => t.replace('two(d.getUTCMinutes()) + " TRT"', 'two(d.getUTCMinutes()) + " ET"') }],
    ["a verdict with no glyph", { "flows-oracle.js": (t) => t.replace('h("span", { "aria-hidden": "true" }, VERDICT_GLYPH[verdict]), ', "") }],
    ["a page left live behind the sheet", { "flows-oracle.js": (t) => t.replace("setInert(true);", "") }],
    ["a stale feed still speaking", { "flows-oracle.js": (t) => t.replace('live: fresh && S.pref !== "off"', "live: true") }],
  ];
  for (const [name, mutate] of MUTANTS) {
    const fails = await probe(mutate);
    ok(fails.length > 0, `planted wrong build "${name}" is caught`);
  }
}

async function sheetFit(mutate) {
  const fails = [];
  const need = (c, m) => { if (!c) fails.push(m); };
  for (const [width, height] of [[390, 844], [1440, 820]]) {
    const w = await open(browser, { width, height, touch: width < 768, mutate, slug: "political", oracle: "absent" });
    await waitOracle(w.page);
    await settle(w.page, 300);
    await w.page.click(".orc-orb");
    await sleep(500);
    const m = await w.page.evaluate(() => {
      const s = document.querySelector(".orc-sheet"), l = s.querySelector(".orc-list"), kids = [...l.children].filter((c) => c.getBoundingClientRect().height > 0);
      const cs = getComputedStyle(l);
      const content = kids.length ? kids[kids.length - 1].getBoundingClientRect().bottom + parseFloat(getComputedStyle(kids[kids.length - 1]).marginBottom) - kids[0].getBoundingClientRect().top + parseFloat(getComputedStyle(kids[0]).marginTop) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const lab = document.getElementById("orcPrefL"), seg = s.querySelector(".orc-pref");
      const lr = lab ? lab.getBoundingClientRect() : null;
      return { sheet: s.getBoundingClientRect().height, list: l.clientHeight, content, vh: innerHeight,
        label: lab && lr.width > 0 && getComputedStyle(lab).visibility !== "hidden" ? lab.textContent : null,
        labelledBy: seg ? seg.getAttribute("aria-labelledby") : null, inSheet: !!(lab && s.contains(lab)),
        buttons: seg ? [...seg.querySelectorAll("button")].map((b) => b.textContent) : [] };
    });
    need(m.list <= m.content + 8, `${width}: the sheet is sized to what it holds, with no empty band (list ${Math.round(m.list)} px for ${Math.round(m.content)} px of content)`);
    need(m.sheet <= m.vh * 0.7 + 1, `${width}: and never taller than its cap`);
    need(m.label === "Show the Neuron as" && m.labelledBy === "orcPrefL" && m.inSheet, `${width}: the preference control carries a visible label that names what it sets: ${m.label}`);
    need(JSON.stringify(m.buttons) === JSON.stringify(["Pill", "Count", "Hidden"]), `${width}: its three choices read as answers to that label: ${m.buttons.join(", ")}`);
    await w.close();
  }
  return fails;
}

{
  eq(await sheetFit({}), [], "the resting sheet fits its content at 390 and 1440 and its preference control is labelled");
  for (const [name, mutate] of [
    ["a fixed-height phone sheet", { "flows-oracle.css": (t) => t.replace("    max-height: 70dvh;\n    padding-bottom", "    height: 70dvh;\n    max-height: 70dvh;\n    padding-bottom") }],
    ["a preference with no visible label", { "flows-oracle.js": (t) => t.replace('h("span", { class: "orc-pref-l", id: "orcPrefL" }, "Show the Neuron as"), ', "") }],
  ]) ok((await sheetFit(mutate)).length > 0, `planted wrong build "${name}" is caught`);
}

await browser.close();
console.log(`flows-oracle-render: ${checks} checks`);
