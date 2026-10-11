import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const has = (list, text) => list.some((p) => p.includes(text));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const clone = (x) => JSON.parse(JSON.stringify(x));

const TABLE = JSON.parse(read("tests/fixtures-approval/home-composition.json"));
const OVERVIEW_JS = read("assets/js/flows-overview.js");
const WEIGHT_SRC = read("tests/flows-weight.mjs");
const FIX = JSON.parse(read("scripts/render-preview.fixtures.json"));

const DECISIONS = ["keep", "merge", "retire", "defer"];
const ROW_ID = /^[A-Z]\d?-\d+$/;
const EFFECT = /^(now|with:[A-Z]\d?-\d+)$/;

function pageFacts(html, js) {
  const start = html.indexOf('class="ui-grid hm-grid"');
  const end = html.indexOf('class="flows-foot hm-foot"');
  const grid = start >= 0 && end > start ? html.slice(start, end) : "";
  const ids = [...grid.matchAll(/<section\b[^>]*?\sid="([^"]+)"/g)].map((m) => m[1]);
  const hero = ids.filter((i) => i === TABLE.hero.id);
  const modules = ids.filter((i) => i !== TABLE.hero.id);
  const referenced = (token) => html.includes(`id="${token}"`) || js.includes(`"${token}"`) || js.includes(`'${token}'`) || js.includes(`#${token}`);
  return { hero: hero.length === 1, modules, referenced };
}

function tableProblems(t, facts, weightSrc) {
  const p = [];
  const ids = t.modules.map((m) => m.id);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) p.push(`${id} is decided twice`);
    seen.add(id);
  }
  for (const id of facts.modules) if (!seen.has(id)) p.push(`the page renders ${id} and the table makes no decision about it`);
  for (const id of seen) if (!facts.modules.includes(id)) p.push(`the table decides ${id} and the page does not render it`);
  if (new Set(facts.modules).size !== facts.modules.length) p.push("the page renders a module id twice");
  if (!facts.hero) p.push(`the page renders no ${t.hero.id}`);
  if (facts.modules.length !== 12) p.push(`the page renders ${facts.modules.length} modules, the decision is about twelve`);
  const titles = new Set();
  for (const m of t.modules) {
    if (!DECISIONS.includes(m.decision)) p.push(`${m.id}: decision ${m.decision} is not one of ${DECISIONS.join(", ")}`);
    if (typeof m.reason !== "string" || m.reason.length < 60) p.push(`${m.id}: no reason of a sentence or more`);
    if (!EFFECT.test(m.effect || "")) p.push(`${m.id}: effect ${m.effect} is not now or with:<row>`);
    if (typeof m.rendered !== "boolean") p.push(`${m.id}: rendered is not a boolean`);
    if (titles.has(m.title)) p.push(`${m.id}: title ${m.title} is used twice`);
    titles.add(m.title);
    if ((m.decision === "keep" || m.decision === "defer") && (m.effect !== "now" || m.rendered !== true)) p.push(`${m.id}: a ${m.decision} stands now and stays rendered`);
    if (m.decision === "merge" && (!m.into || m.rendered !== true)) p.push(`${m.id}: a merge names where it goes and stays rendered as a brief`);
    if (m.decision === "retire" && (!m.into || !m.link || m.rendered !== false)) p.push(`${m.id}: a retire names where it goes, keeps a link and is not rendered afterwards`);
    if (m.decision !== "keep" && m.decision !== "defer" && m.effect === "now" && m.decision === "merge" && !m.into) p.push(`${m.id}: merge without a target`);
    const expectPresent = m.effect === "now" ? m.rendered : true;
    const present = [m.id, m.bodyId].some((token) => facts.referenced(token));
    if (expectPresent && !facts.referenced(m.id)) p.push(`${m.id}: decided to stand but the page has no render of it`);
    if (!expectPresent && present) p.push(`${m.id}: retired and still rendered (${m.id} or ${m.bodyId} is in the page or its script)`);
    if (m.effect !== "now" && !present) p.push(`${m.id}: retired before ${m.effect.slice(5)} landed what replaces it`);
  }
  const wantDeferred = t.modules.filter((m) => m.decision === "defer").map((m) => m.id).sort();
  if (JSON.stringify([...t.deferred].sort()) !== JSON.stringify(wantDeferred)) p.push(`the deferred list ${[...t.deferred].sort()} is not the modules decided defer ${wantDeferred}`);
  if (new Set(t.deferred).size !== t.deferred.length) p.push("the deferred list names a module twice");
  if (!/^[a-z][a-z-]+$/.test(t.deferGroup || "")) p.push("no defer group name");
  const block = /const DEFERRED = \{([\s\S]*?)\n\};/.exec(weightSrc);
  const entry = block && /overviewPage:\s*\{([\s\S]*?)\}\s*,?\s*(?:\n\s*\w+:|$)/.exec(block[1]);
  if (entry && entry[1].includes(t.deferGroup)) {
    const mods = /modules:\s*\[([^\]]*)\]/.exec(entry[1]);
    if (!mods) p.push(`DEFERRED.overviewPage names ${t.deferGroup} and lists no modules`);
    else {
      const got = [...mods[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]).sort();
      if (JSON.stringify(got) !== JSON.stringify([...t.deferred].sort())) p.push(`DEFERRED.overviewPage lists ${got}, the table defers ${[...t.deferred].sort()}`);
    }
  } else if (!/overviewPage:\s*"F-08 part a"/.test(weightSrc)) p.push("tests/flows-weight.mjs neither defers the Home modules nor names F-08 part a as the relief row for overviewPage");
  const known = new Set([t.hero.id, ...ids, ...Object.keys(t.slots)]);
  const order = t.order;
  if (new Set(order).size !== order.length) p.push("the order names an id twice");
  for (const id of known) if (!order.includes(id)) p.push(`the order leaves out ${id}`);
  for (const id of order) if (!known.has(id)) p.push(`the order names ${id}, which is neither the hero, a module nor a slot`);
  if (order[0] !== t.hero.id) p.push("the tide hero is not first");
  const firstDeferred = Math.min(...t.deferred.map((id) => order.indexOf(id)));
  for (const id of order) if (!t.deferred.includes(id) && order.indexOf(id) > firstDeferred) p.push(`${id} comes after the deferred chunk begins`);
  for (const [name, s] of Object.entries(t.slots)) {
    for (const vp of Object.keys(t.layouts)) if (!Number.isInteger(s.heightPx[vp]) || s.heightPx[vp] <= 0) p.push(`slot ${name} has no height at ${vp}`);
    if (!ROW_ID.test(s.row)) p.push(`slot ${name} names no row`);
  }
  const mv = t.slots.moves;
  for (const vp of Object.keys(t.layouts)) if (mv.heightPx[vp] !== mv.headPx + mv.rows * mv.rowPx) p.push(`the Moves band at ${vp} is not ${mv.rows} rows of ${mv.rowPx} px under a ${mv.headPx} px header`);
  if (mv.rows !== 8) p.push("the Moves band is not eight rows");
  const aids = new Set();
  for (const a of t.additions) {
    if (aids.has(a.id)) p.push(`addition ${a.id} is placed twice`);
    aids.add(a.id);
    if (!ROW_ID.test(a.row)) p.push(`addition ${a.id} names no row`);
    if (!["slot", "inside", "overlay"].includes(a.kind)) p.push(`addition ${a.id}: kind ${a.kind}`);
    if (a.kind === "inside" && !known.has(a.in)) p.push(`addition ${a.id} sits inside ${a.in}, which is neither a module nor a slot`);
    if (a.kind === "inside" && (!a.reason || a.reason.length < 20)) p.push(`addition ${a.id} gives no reason`);
    if (a.kind === "slot" && !t.slots[a.id]) p.push(`addition ${a.id} is a slot with no slot entry`);
  }
  for (const s of Object.keys(t.slots)) if (!aids.has(s)) p.push(`slot ${s} is not among the additions`);
  for (const [vp, l] of Object.entries(t.layouts)) {
    const placed = [...l.fit.flat(), l.peek];
    if (new Set(placed).size !== placed.length) p.push(`${vp}: an id is placed twice in the fold`);
    for (const id of placed) {
      if (!known.has(id)) p.push(`${vp}: ${id} is in the fold and is not the hero, a module or a slot`);
      if (t.deferred.includes(id)) p.push(`${vp}: ${id} is deferred and cannot be in the fold`);
      const m = t.modules.find((x) => x.id === id);
      if (m && m.decision === "retire") p.push(`${vp}: ${id} is retired and cannot be in the fold`);
    }
    if (`${l.width}x${l.height}` !== vp) p.push(`${vp}: the layout is for ${l.width}x${l.height}`);
    if (!l.fit.length || l.fit.some((r) => !r.length)) p.push(`${vp}: an empty row in the fold`);
  }
  return p;
}

function foldProblems(t, vp, m) {
  const p = [];
  const l = t.layouts[vp];
  const height = (id) => (m.heights[id] !== undefined ? m.heights[id] : t.slots[id].heightPx[vp]);
  let y = m.headBottom;
  for (const row of l.fit) {
    y += Math.max(...row.map(height));
    if (y > l.height) p.push(`${vp}: ${row.join(" + ")} ends at ${y} px, below the ${l.height} px fold`);
    y += m.gap;
  }
  if (y > l.height - l.peekPx) p.push(`${vp}: ${l.peek} starts at ${y} px and shows ${l.height - y} px, under the ${l.peekPx} px a reader needs to see it is there`);
  return { problems: p, peekTop: y };
}

const html = PAGES.overviewPage({ username: "x", summary: FIX.summary });
const htmlPending = PAGES.overviewPage({ username: "x", summary: null });

{
  const facts = pageFacts(html, OVERVIEW_JS);
  eq(tableProblems(TABLE, facts, WEIGHT_SRC), [], "the table decides exactly the modules the page renders, each once, and every rule of the table holds");
  eq(facts.modules, ["hmMetals", "hmLeaders", "hmVerdict", "hmBull", "hmBear", "hmChg", "hmVol", "hmLean", "hmAlerts", "hmEvents", "hmWatch", "hmNews"], "overviewPage renders the twelve modules the plan names, in this order");
  eq(pageFacts(htmlPending, OVERVIEW_JS).modules, facts.modules, "and the same twelve while the Neuron summary is still pending");
  eq(TABLE.modules.length, 12, "twelve decisions");
  eq(TABLE.modules.map((m) => [m.id, m.decision]), [
    ["hmMetals", "keep"], ["hmLeaders", "keep"], ["hmVerdict", "keep"], ["hmBull", "merge"], ["hmBear", "merge"], ["hmChg", "defer"],
    ["hmVol", "defer"], ["hmLean", "keep"], ["hmAlerts", "retire"], ["hmEvents", "defer"], ["hmWatch", "retire"], ["hmNews", "defer"],
  ], "the proposal of the plan: Metals, Leaders and the verdict stay, Bullish and Bearish merge into the network's Lean output, Flagged and Nearly in retire, What changed, Volatility, Reporting and Headlines defer");
  eq(TABLE.deferred, ["hmChg", "hmVol", "hmEvents", "hmNews"], "the deferred chunk F-08 cuts holds exactly What changed, Volatility, Reporting and Headlines");
  ok(TABLE.modules.every((m) => facts.referenced(m.bodyId)), "every module's body id is still the one the page and its script use");
  ok(TABLE.modules.filter((m) => m.effect !== "now").every((m) => facts.referenced(m.id)), "a retirement that waits for its replacement leaves the module rendered until then");
  eq(TABLE.layouts["1440x900"].fit, [["hmHero", "network", "moves"], ["hmVerdict"]], "at 1440x900 the tide, the network and the Moves band share the first row and the verdict sits under them");
  eq(TABLE.layouts["390x844"].fit, [["hmHero"]], "at 390x844 only the tide is wholly above the fold and the network peeks under it");
  eq(TABLE.layouts["390x844"].peek, "network", "the stacked network is what a phone reader sees begin");
}

{
  const facts = pageFacts(html, OVERVIEW_JS);
  const bad = (mutate, factsOf = () => facts, weight = WEIGHT_SRC) => { const t = clone(TABLE); mutate(t); return tableProblems(t, factsOf(), weight); };

  const extra = html.replace('<section class="ui-card ui-mod hm-mod" id="hmNews"', '<section class="ui-card ui-mod hm-mod" id="hmThirteenth" aria-labelledby="x"></section>\n<section class="ui-card ui-mod hm-mod" id="hmNews"');
  ok(extra !== html, "the injection for the thirteenth module found its anchor");
  const withExtra = tableProblems(TABLE, pageFacts(extra, OVERVIEW_JS), WEIGHT_SRC);
  ok(has(withExtra, "the page renders hmThirteenth and the table makes no decision about it"), "A MODULE ADDED TO overviewPage WITHOUT A DECISION FAILS");
  ok(has(withExtra, "the page renders 13 modules"), "and the count of thirteen is named");

  const dropped = html.replace(/<section class="ui-card ui-mod hm-mod[^"]*" id="hmVol"[\s\S]*?<\/section>/, "");
  ok(dropped !== html, "the removal of a module found its anchor");
  ok(has(tableProblems(TABLE, pageFacts(dropped, OVERVIEW_JS), WEIGHT_SRC), "decides hmVol and the page does not render it"), "a decision about a module the page no longer renders fails");

  ok(has(bad((t) => t.modules.push(clone(t.modules[0]))), "hmMetals is decided twice"), "A MODULE DECIDED TWICE FAILS");
  ok(has(bad((t) => { t.modules.pop(); }), "the page renders hmNews and the table makes no decision about it"), "a module left undecided fails");
  ok(has(bad((t) => { t.modules[0].decision = "hide"; }), "decision hide"), "a decision outside keep, merge, retire and defer fails");
  ok(has(bad((t) => { t.modules[0].reason = "ok"; }), "no reason"), "a decision with no reason fails");
  ok(has(bad((t) => { t.modules[8].effect = "now"; }), "retired and still rendered"), "A RETIRED MODULE THAT THE PAGE STILL RENDERS FAILS");
  const noMarkup = html.replace(/<section class="ui-card ui-mod hm-mod[^"]*" id="hmAlerts"[\s\S]*?<\/section>/, "");
  ok(noMarkup !== html, "the removal of the Flagged markup found its anchor");
  ok(has(bad((t) => { t.modules[8].effect = "now"; }, () => pageFacts(noMarkup, OVERVIEW_JS)), "retired and still rendered"), "a retired module whose markup is gone but whose body id its script still fills fails");
  eq(bad((t) => { t.modules[8].effect = "now"; }, () => pageFacts(html.replace(/<section class="ui-card ui-mod hm-mod[^"]*" id="hmAlerts"[\s\S]*?<\/section>/, ""), OVERVIEW_JS.replace(/ccAlerts/g, "ccGone").replace(/hmAlerts/g, "hmGone"))).filter((x) => x.startsWith("hmAlerts")), [], "and a retired module with no render in the page or its script passes");
  ok(has(bad((t) => { t.modules[8].effect = "with:F-09"; }, () => pageFacts(html.replace(/<section class="ui-card ui-mod hm-mod[^"]*" id="hmAlerts"[\s\S]*?<\/section>/, ""), OVERVIEW_JS.replace(/ccAlerts/g, "ccGone").replace(/hmAlerts/g, "hmGone"))), "retired before F-09 landed"), "a module removed before the row that replaces it fails");
  ok(has(bad((t) => { t.modules[0].effect = "later"; }), "effect later"), "an effect other than now or a row fails");
  ok(has(bad((t) => { t.modules[3].into = ""; }), "names where it goes"), "a merge with no target fails");
  ok(has(bad((t) => { t.modules[8].link = ""; }), "keeps a link"), "a retire with no link fails");
  ok(has(bad((t) => { t.modules[5].decision = "keep"; }), "is not the modules decided defer"), "a defer decision that is not in the deferred list fails");
  ok(has(bad((t) => { t.deferred.push("hmLean"); }), "is not the modules decided defer"), "a deferred list that names a module not decided defer fails");
  ok(has(bad((t) => { t.deferred = t.deferred.slice(1); }), "is not the modules decided defer"), "a deferred list missing a deferred module fails");

  const weightWith = WEIGHT_SRC.replace("unusualPage: { groups: { net: \"/assets/js/flows-net.js\" } },", "unusualPage: { groups: { net: \"/assets/js/flows-net.js\" } },\n  overviewPage: { groups: { \"home-below\": \"/assets/js/flows-overview-below.js\" }, modules: [\"hmChg\", \"hmVol\", \"hmEvents\", \"hmNews\"] },");
  ok(weightWith !== WEIGHT_SRC, "the injection of a DEFERRED entry for the Home page found its anchor");
  eq(bad(() => {}, () => facts, weightWith), [], "THE BELOW-THE-FOLD LIST EQUALS THE MODULE SET F-08 DEFERS: an entry that lists the same four passes");
  const weightWrong = weightWith.replace('modules: ["hmChg", "hmVol", "hmEvents", "hmNews"]', 'modules: ["hmChg", "hmVol", "hmEvents", "hmNews", "hmLean"]');
  ok(has(bad(() => {}, () => facts, weightWrong), "DEFERRED.overviewPage lists"), "an entry that lists a fifth module fails");
  const weightShort = weightWith.replace('modules: ["hmChg", "hmVol", "hmEvents", "hmNews"]', 'modules: ["hmChg", "hmVol", "hmNews"]');
  ok(has(bad(() => {}, () => facts, weightShort), "DEFERRED.overviewPage lists"), "an entry that lists only three fails");
  const weightBare = weightWith.replace(', modules: ["hmChg", "hmVol", "hmEvents", "hmNews"]', "");
  ok(has(bad(() => {}, () => facts, weightBare), "lists no modules"), "an entry that names the group and lists no modules fails");
  ok(has(bad(() => {}, () => facts, WEIGHT_SRC.replace('overviewPage: "F-08 part a"', 'overviewPage: "none"')), "neither defers"), "with no entry and no pointer to F-08 part a it fails");

  ok(has(bad((t) => { t.layouts["1440x900"].fit[1].push("hmChg"); }), "hmChg is deferred and cannot be in the fold"), "a deferred module in the fold fails");
  ok(has(bad((t) => { t.layouts["1440x900"].peek = "hmAlerts"; }), "hmAlerts is retired and cannot be in the fold"), "a retired module in the fold fails");
  ok(has(bad((t) => { t.layouts["390x844"].fit.push(["network"]); }), "an id is placed twice in the fold"), "an id placed twice in a fold fails");
  ok(has(bad((t) => { t.order.push("hmNew"); }), "neither the hero, a module nor a slot"), "an unknown id in the order fails");
  ok(has(bad((t) => { t.order = t.order.filter((x) => x !== "moves"); }), "the order leaves out moves"), "a slot missing from the order fails");
  ok(has(bad((t) => { t.order = [...t.order.slice(1), t.order[0]]; }), "the tide hero is not first"), "the hero not first fails");
  ok(has(bad((t) => { const i = t.order.indexOf("hmChg"); t.order.splice(i, 1); t.order.splice(3, 0, "hmChg"); }), "comes after the deferred chunk begins"), "a first-paint module after the deferred chunk begins fails");
  ok(has(bad((t) => { t.slots.moves.heightPx["1440x900"] = 300; }), "the Moves band at 1440x900"), "a Moves band whose height is not eight rows fails");
  ok(has(bad((t) => { t.slots.moves.rows = 6; }), "not eight rows"), "a band of six rows fails");
  ok(has(bad((t) => { t.additions.push({ id: "x", kind: "inside", in: "hmGhost", row: "F-99", reason: "inside a thing that does not exist" }); }), "hmGhost"), "an addition inside a module that does not exist fails");
  ok(has(bad((t) => { t.additions = t.additions.filter((a) => a.id !== "network"); }), "slot network is not among the additions"), "a slot with no addition fails");
  ok(has(bad((t) => { t.additions.push(clone(t.additions[0])); }), "addition network is placed twice"), "an addition placed twice fails");
}

{
  const t = clone(TABLE);
  const measured = (headBottom, gap, heights) => ({ headBottom, gap, heights });
  const good = foldProblems(t, "1440x900", measured(153, 20, { hmHero: 403, hmVerdict: 105, hmMetals: 340 }));
  eq(good.problems, [], "on the heights measured at a3ce932 the 1440x900 fold holds the tide row and the verdict");
  eq(good.peekTop, 701, "and Metals begins at 701 px, 199 px of it above the fold");
  const slotTall = clone(t);
  slotTall.slots.network.heightPx["1440x900"] = 700;
  ok(has(foldProblems(slotTall, "1440x900", measured(153, 20, { hmHero: 403, hmVerdict: 105 })).problems, "below the 900 px fold"), "A SLOT TALLER THAN THE FOLD ALLOWS FAILS");
  ok(has(foldProblems(t, "1440x900", measured(153, 20, { hmHero: 403, hmVerdict: 400 })).problems, "starts at"), "a verdict that grows until Metals no longer shows fails");
  ok(has(foldProblems(t, "1440x900", measured(153, 20, { hmHero: 900, hmVerdict: 105 })).problems, "below the 900 px fold"), "a hero that grows past the fold fails");
  ok(has(foldProblems(t, "390x844", measured(153, 16, { hmHero: 700 })).problems, "starts at"), "a phone tide so tall that the network does not peek fails");
  const phone = foldProblems(t, "390x844", measured(153, 16, { hmHero: 552 }));
  eq(phone.problems, [], "on the heights measured at a3ce932 the 390x844 fold holds the tide and the network peeks");
  eq(phone.peekTop, 721, "and the stacked network begins at 721 px, 123 px of it above the fold");
  const wide = clone(t);
  wide.layouts["390x844"].fit.push(["network"]);
  ok(has(foldProblems(wide, "390x844", measured(153, 16, { hmHero: 552 })).problems, "below the 844 px fold"), "asking the phone fold to hold the tide and the whole 300 px network fails");
}

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

async function render(browser, [width, height], pageHtml) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX.overview).find((x) => key.includes(x));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX.overview[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: pageHtml });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector("#ccMetals") && document.querySelector("#ccMetals").children.length > 0 && document.querySelector("#ccNews") && document.querySelector("#ccNews").children.length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate((heroId) => {
    const rect = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), height: Math.round(r.height) }; };
    const grid = document.querySelector(".hm-grid");
    const sections = [...grid.children].filter((e) => e.tagName === "SECTION");
    const hero = document.getElementById(heroId);
    const head = document.querySelector(".hm-head");
    const heights = {};
    const tops = {};
    for (const s of sections) { const r = rect(s); heights[s.id] = r.height; tops[s.id] = r.top; }
    const next = sections.find((s) => s !== hero);
    return {
      ids: sections.map((s) => s.id),
      heights, tops,
      headBottom: rect(head).bottom,
      gap: tops[next.id] - rect(hero).bottom,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, TABLE.hero.id);
  await page.close();
  return { ...m, errors };
}

const browser = await launch();
try {
  for (const [vp, layout] of Object.entries(TABLE.layouts)) {
    const m = await render(browser, [layout.width, layout.height], html);
    eq(m.errors, [], `${vp}: the fixture render raises no page error`);
    eq(m.ids, [TABLE.hero.id, ...pageFacts(html, OVERVIEW_JS).modules], `${vp}: the rendered grid is the hero and the twelve modules the table decides`);
    ok(m.ids.filter((i) => i !== TABLE.hero.id).every((i) => TABLE.modules.some((x) => x.id === i)), `${vp}: every rendered module has a decision`);
    ok(m.overflowX <= 0, `${vp}: no horizontal scroll`);
    ok(m.headBottom > 0 && m.gap >= 8 && m.gap <= 40, `${vp}: the head ends at ${m.headBottom} px and modules sit ${m.gap} px apart`);
    const f = foldProblems(TABLE, vp, m);
    eq(f.problems, [], `${vp}: the modules and slots the table puts above the fold fit it, and ${layout.peek} begins at ${f.peekTop} px (${layout.height - f.peekTop} px above the fold)`);
    console.log(`  ${vp}: head ends ${m.headBottom} px, gap ${m.gap} px, fold rows ${layout.fit.map((r) => r.join("+")).join(" / ")}, ${layout.peek} begins at ${f.peekTop} px; measured ${Object.entries(m.heights).map(([k, v]) => k + " " + v).join(", ")}`);
    for (const row of layout.fit) for (const id of row) if (m.heights[id] !== undefined) ok(m.heights[id] > 40, `${vp}: ${id} renders with a body (${m.heights[id]} px)`);
    for (const id of TABLE.deferred) ok(m.tops[id] > layout.height, `${vp}: the deferred ${id} begins below the fold (${m.tops[id]} px)`);
    const firstPaintBelow = TABLE.modules.filter((x) => x.decision !== "defer" && !layout.fit.flat().includes(x.id) && x.id !== layout.peek);
    ok(firstPaintBelow.length > 0, `${vp}: first-paint modules below the fold exist, so the split is not the fold`);
    const mutated = clone(TABLE);
    mutated.slots.network.heightPx[vp] = 2000;
    mutated.layouts[vp].fit = [[...(vp === "1440x900" ? ["hmHero", "network", "moves"] : ["hmHero", "network"])]];
    ok(foldProblems(mutated, vp, m).problems.length > 0, `${vp}: the render-based fold check fails on a network slot too tall for the fold`);
  }
} finally {
  await browser.close();
}

console.log(`flows-home-composition: ${checks} checks passed`);
