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
const CSS = read("assets/css/flows-home.css");
const WEIGHT_SRC = read("tests/flows-weight.mjs");
const FIX = JSON.parse(read("scripts/render-preview.fixtures.json"));

const DECISIONS = ["keep", "merge", "retire", "defer"];
const ROW_ID = /^[A-Z]\d?-\d+$/;
const EFFECT = /^(now|with:[A-Z]\d?-\d+)$/;

function pageFacts(html, js) {
  const start = html.indexOf('id="hmStage"');
  const end = html.indexOf('data-defer="home-below"');
  const grid = start >= 0 && end > start ? html.slice(start, end) : "";
  const ids = [...grid.matchAll(/<section\b[^>]*?\sid="([^"]+)"/g)].map((m) => m[1]);
  const hero = ids.filter((i) => i === TABLE.hero.id);
  const modules = ids.filter((i) => i !== TABLE.hero.id);
  const referenced = (token) => html.includes(`id="${token}"`) || js.includes(`"${token}"`) || js.includes(`'${token}'`) || js.includes(`#${token}`);
  return { hero: hero.length === 1, modules, referenced };
}

function tableProblems(t, facts, weightSrc, css = CSS, js = OVERVIEW_JS) {
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
    if (!Object.keys(s.heightPx).length) p.push(`slot ${name} has no height`);
    for (const [vp, px] of Object.entries(s.heightPx)) if (!Number.isInteger(px) || px <= 0) p.push(`slot ${name} has no height at ${vp}`);
    if (!ROW_ID.test(s.row)) p.push(`slot ${name} names no row`);
  }
  const mv = t.slots.moves;
  for (const vp of Object.keys(mv.heightPx)) if (mv.heightPx[vp] !== mv.headPx + mv.rows * mv.rowPx) p.push(`the Moves band at ${vp} is not ${mv.rows} rows of ${mv.rowPx} px under a ${mv.headPx} px header`);
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
  p.push(...layoutProblems(t, css));
  p.push(...amendmentProblems(t, js));
  return p;
}

const cells = (rows) => rows.map((r) => r.trim().split(/\s+/));

function rectProblems(name, grid, columns) {
  const p = [];
  if (grid.some((r) => r.length !== columns)) p.push(`${name}: a row does not have ${columns} columns`);
  const boxes = new Map();
  grid.forEach((r, y) => r.forEach((a, x) => {
    const b = boxes.get(a) || { x0: x, x1: x, y0: y, y1: y, n: 0 };
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.n++;
    boxes.set(a, b);
  }));
  for (const [a, b] of boxes) if (b.n !== (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)) p.push(`${name}: ${a} is not one rectangle`);
  return p;
}

function cssAreas(css, fit) {
  const start = css.indexOf(`--hm-fit: ${fit};`);
  if (start < 0) return null;
  const end = css.indexOf("\n}\n", start);
  const block = css.slice(start, end > 0 ? end : undefined);
  const grab = (from) => {
    const at = block.indexOf("grid-template-areas:", from);
    if (at < 0) return null;
    return [...block.slice(at, block.indexOf(";", at)).matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/).join(" "));
  };
  const net = grab(0);
  const nonet = block.indexOf(":not([data-net])");
  return { areas: net, noNet: nonet < 0 ? null : grab(nonet) };
}

function layoutProblems(t, css) {
  const p = [];
  const ids = t.areaIds;
  const all = Object.keys(ids);
  if (Object.values(ids).join() !== ["hmHero", "hmVerdict", "hmNet", "hmAlerts", "hmLean", "hmBull", "hmBear", "hmWatch", "hmLeaders", "hmMetals", "hmChg", "hmVol", "hmEvents", "hmNews"].join()) p.push("the area names do not map to the fourteen modules in order");
  for (const fit of ["xl", "l", "m"]) {
    const l = t.layouts[fit];
    if (!l) { p.push(`no ${fit} layout`); continue; }
    for (const [name, rows, want] of [[fit, l.areas, all], [fit + " without the network", l.noNet, all.filter((a) => a !== "net")]]) {
      const grid = cells(rows || []);
      p.push(...rectProblems(name, grid, l.columns));
      const got = [...new Set(grid.flat())];
      for (const a of want) if (!got.includes(a)) p.push(`${name}: ${a} (${ids[a]}) is not on the first screen`);
      for (const a of got) if (!want.includes(a)) p.push(`${name}: ${a} is placed and is not a module of this layout`);
    }
    const mine = cssAreas(css, fit);
    if (!mine) p.push(`${fit}: flows-home.css has no --hm-fit: ${fit} block`);
    else {
      if (JSON.stringify(mine.areas) !== JSON.stringify(l.areas.map((r) => r.trim().split(/\s+/).join(" ")))) p.push(`${fit}: the stylesheet's grid-template-areas differ from the table`);
      if (JSON.stringify(mine.noNet) !== JSON.stringify(l.noNet.map((r) => r.trim().split(/\s+/).join(" ")))) p.push(`${fit}: the stylesheet's grid-template-areas without the network differ from the table`);
    }
    for (const id of t.deferred) if (!cells(l.areas).flat().includes(Object.keys(ids).find((k) => ids[k] === id))) p.push(`${fit}: ${id} is deferred and the first screen of this fit does not show it`);
  }
  const s = t.layouts.s;
  if (!s) return [...p, "no s layout"];
  for (const [name, pages, want] of [["s", s.pages, Object.values(ids)], ["s without the network", { ...s.pages, ...s.noNetPages }, Object.values(ids).filter((x) => x !== "hmNet")]]) {
    const got = Object.values(pages).flat();
    if (new Set(got).size !== got.length) p.push(`${name}: a module is on two pages`);
    for (const id of want) if (!got.includes(id)) p.push(`${name}: ${id} is on no page`);
    for (const id of got) if (!want.includes(id)) p.push(`${name}: ${id} is on a page and is not a module of this layout`);
  }
  if (Object.keys(s.pages).join() !== "now,flow,names,glance") p.push("the S pages are not now, flow, names and glance in order");
  return p;
}

function amendmentProblems(t, js) {
  const p = [];
  const a = (t.amendments || []).find((x) => x.id === "F-08a");
  if (!a) return ["the F-08 amendment of 2026-10-19 is not recorded"];
  if (!/see everything/.test(a.request)) p.push("the F-08 amendment does not cite the owner's request");
  if (a.chunkAt.xl !== "after-load" || a.chunkAt.l !== "after-load" || a.chunkAt.m !== "after-load" || a.chunkAt.s !== "glance-page") p.push("the F-08 amendment does not say when the chunk is asked for at each fit");
  if (!/else \{ for \(const m of stage\.children\) m\.inert = false; askLower\(\); \}/.test(js)) p.push("the script does not ask for the lower modules at the xl, l and m fits");
  if (!/if \(fitNow === "s" && page === "glance"\) askLower\(\);/.test(js)) p.push("the script does not hold the chunk back at S until the Glance page opens");
  if (!/UI\.defer\("home-below", \{ when: "visible", el: \$\("hmChg"\)/.test(js)) p.push("the chunk is not asked for through the visible trigger on What changed");
  return p;
}

const html = PAGES.overviewPage({ username: "x", summary: FIX.summary });
const htmlPending = PAGES.overviewPage({ username: "x", summary: null });

{
  const facts = pageFacts(html, OVERVIEW_JS);
  eq(tableProblems(TABLE, facts, WEIGHT_SRC), [], "the table decides exactly the modules the page renders, each once, and every rule of the table holds");
  eq(facts.modules, ["hmVerdict", "hmAlerts", "hmLean", "hmBull", "hmBear", "hmWatch", "hmLeaders", "hmMetals", "hmChg", "hmVol", "hmEvents", "hmNews"], "overviewPage renders the twelve modules the plan names, in this order");
  eq(pageFacts(htmlPending, OVERVIEW_JS).modules, facts.modules, "and the same twelve while the Neuron summary is still pending");
  eq(TABLE.modules.length, 12, "twelve decisions");
  eq(TABLE.modules.map((m) => [m.id, m.decision]), [
    ["hmMetals", "keep"], ["hmLeaders", "keep"], ["hmVerdict", "keep"], ["hmBull", "merge"], ["hmBear", "merge"], ["hmChg", "defer"],
    ["hmVol", "defer"], ["hmLean", "keep"], ["hmAlerts", "retire"], ["hmEvents", "defer"], ["hmWatch", "retire"], ["hmNews", "defer"],
  ], "the proposal of the plan: Metals, Leaders and the verdict stay, Bullish and Bearish merge into the network's Lean output, Flagged and Nearly in retire, What changed, Volatility, Reporting and Headlines defer");
  eq(TABLE.deferred, ["hmChg", "hmVol", "hmEvents", "hmNews"], "the deferred chunk F-08 cuts holds exactly What changed, Volatility, Reporting and Headlines");
  ok(TABLE.modules.every((m) => facts.referenced(m.bodyId)), "every module's body id is still the one the page and its script use");
  ok(TABLE.modules.filter((m) => m.effect !== "now").every((m) => facts.referenced(m.id)), "a retirement that waits for its replacement leaves the module rendered until then");
  eq(Object.keys(TABLE.layouts), ["xl", "l", "m", "s"], "the plan has four fits: xl, l, m and s");
  eq(TABLE.layouts.xl.areas[0], "hero hero hero hero hero neu neu net net net net net", "at the xl fit the tide spans five columns, the Neuron two and the network five");
  eq(TABLE.layouts.l.areas[2], "net net net net net net bull bull bull bear bear bear", "at the l fit the network is a map tile under the tide");
  eq(Object.keys(TABLE.layouts.s.pages), ["now", "flow", "names", "glance"], "the s fit pages are now, flow, names and glance");
  eq(TABLE.amendments[0].id, "F-08a", "the F-08 amendment of 2026-10-19 is recorded with the owner's request");
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

  const weightWith = WEIGHT_SRC;
  ok(/overviewPage: \{ groups: \{ "home-below": "\/assets\/js\/flows-overview-below\.js", "home-net": "\/assets\/js\/flows-net\.js", "home-netmap": "\/assets\/js\/flows-net-map\.js", "nn-orb": "\/assets\/js\/flows-nn-orb\.js" \}, modules: \["hmChg", "hmVol", "hmEvents", "hmNews"\] \},/.test(weightWith), "the weight test defers the four modules to flows-overview-below.js as the home-below group");
  eq(bad(() => {}, () => facts, weightWith), [], "THE BELOW-THE-FOLD LIST EQUALS THE MODULE SET F-08 DEFERS: the entry lists the same four and passes");
  const weightWrong = weightWith.replace('modules: ["hmChg", "hmVol", "hmEvents", "hmNews"]', 'modules: ["hmChg", "hmVol", "hmEvents", "hmNews", "hmLean"]');
  ok(weightWrong !== weightWith, "the injection of a fifth module found its anchor");
  ok(has(bad(() => {}, () => facts, weightWrong), "DEFERRED.overviewPage lists"), "an entry that lists a fifth module fails");
  const weightShort = weightWith.replace('modules: ["hmChg", "hmVol", "hmEvents", "hmNews"]', 'modules: ["hmChg", "hmVol", "hmNews"]');
  ok(has(bad(() => {}, () => facts, weightShort), "DEFERRED.overviewPage lists"), "an entry that lists only three fails");
  const weightBare = weightWith.replace(', modules: ["hmChg", "hmVol", "hmEvents", "hmNews"]', "");
  ok(weightBare !== weightWith, "the removal of the module list found its anchor");
  ok(has(bad(() => {}, () => facts, weightBare), "lists no modules"), "an entry that names the group and lists no modules fails");
  const weightNone = weightWith.replace(/\n  overviewPage: \{ groups: \{ "home-below"[^\n]*\n/, "\n");
  ok(weightNone !== weightWith, "the removal of the Home entry found its anchor");
  ok(has(bad(() => {}, () => facts, weightNone), "neither defers"), "with no entry and no pointer to F-08 part a it fails");

  ok(has(bad((t) => { t.layouts.xl.areas[3] = t.layouts.xl.areas[3].replace("vol vol vol", "chg chg chg"); }), "xl: vol (hmVol) is not on the first screen"), "A MODULE LEFT OFF THE XL FIRST SCREEN FAILS");
  ok(has(bad((t) => { t.layouts.l.noNet[0] = t.layouts.l.noNet[0].replace("hero hero", "hero neu"); }), "l without the network: hero is not one rectangle"), "an area that is not one rectangle fails");
  ok(has(bad((t) => { t.layouts.m.areas[1] = "hero hero hero hero hero hero news news news news news"; }), "m: a row does not have 12 columns"), "a row of the wrong width fails");
  ok(has(bad((t) => { t.layouts.xl.areas[0] = t.layouts.xl.areas[0].replace("neu neu", "neu hero"); }), "stylesheet's grid-template-areas differ from the table"), "a table that the stylesheet does not match fails");
  ok(has(bad((t) => { t.layouts.s.pages.glance.pop(); }), "s: hmNews is on no page"), "a module on no page of the phone fit fails");
  ok(has(bad((t) => { t.layouts.s.pages.now.push("hmNews"); }), "s: a module is on two pages"), "a module on two pages fails");
  ok(has(bad((t) => { t.amendments = []; }), "the F-08 amendment of 2026-10-19 is not recorded"), "a table without the amendment fails");
  ok(has(bad((t) => { t.amendments[0].chunkAt.s = "after-load"; }), "when the chunk is asked for"), "an amendment that asks for the chunk early at S fails");
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
  await page.waitForFunction(() => document.querySelector("#ccMetals") && document.querySelector("#ccMetals").children.length > 0 && document.querySelector("#ccLean") && document.querySelector("#ccLean").children.length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate((heroId) => {
    const rect = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), height: Math.round(r.height) }; };
    const sections = [...document.querySelectorAll("#hmStage > section")];
    const heights = {};
    for (const s of sections) heights[s.id] = rect(s).height;
    return {
      ids: sections.map((s) => s.id),
      heights,
      scrolls: document.documentElement.scrollHeight - innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, TABLE.hero.id);
  await page.close();
  return { ...m, errors };
}

const browser = await launch();
try {
  for (const layout of Object.values(TABLE.layouts)) {
    const vp = layout.viewport;
    const m = await render(browser, vp.split("x").map(Number), html);
    eq(m.errors, [], `${vp}: the fixture render raises no page error`);
    eq([...m.ids].sort(), [TABLE.hero.id, ...pageFacts(html, OVERVIEW_JS).modules].sort(), `${vp}: the rendered stage is the hero and the twelve modules the table decides`);
    ok(m.ids.filter((i) => i !== TABLE.hero.id).every((i) => TABLE.modules.some((x) => x.id === i)), `${vp}: every rendered module has a decision`);
    ok(m.overflowX <= 0, `${vp}: no horizontal scroll`);
    ok(m.scrolls <= 0, `${vp}: the page does not scroll: every module is on the one screen`);
  }
} finally {
  await browser.close();
}

console.log(`flows-home-composition: ${checks} checks passed`);
