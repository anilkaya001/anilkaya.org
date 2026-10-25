import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { openMarket, alertsFixture, universeFixture } from "./lib/market-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => { assert.ok(a === b || (a !== null && b !== null && Math.abs(a - b) <= tol), msg + ` (${a} against ${b})`); checks++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const FIXTURE = JSON.parse(read("tests/fixtures-relations.json"));
const REL = "/assets/js/flows-relations.js";
const SRC = read("assets/js/flows-relations.js");

{
  ok(FIXTURE.provenance.numpy && FIXTURE.provenance.scipy && /^[0-9a-f]{64}$/.test(FIXTURE.provenance.script_sha256), "THE FIXTURE NAMES THE NUMPY AND SCIPY VERSIONS AND THE GENERATOR'S SHA-256");
  const sha = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tests/gen-relations-fixtures.py"))).digest("hex");
  eq(sha, FIXTURE.provenance.script_sha256, "and the generator has not changed since the fixture was written");
  ok(!/\bsigma\b|forecast(?!\.)/i.test(SRC.replace(/Not a forecast\./g, "")), "the module's copy claims no forecast");
}

async function modelOf(page, rows, opts) {
  return page.evaluate(({ rows, opts }) => window.FlowsUI.relations.model(rows, opts), { rows, opts });
}

function compare(model, exp, label) {
  eq(model.status, "ok", label + ": enough windows, bins and names for a reading");
  eq(model.bins, exp.bins, label + ": the bin count");
  eq(model.windows, exp.windows, label + ": the window count");
  eq(model.names.map((n) => n.t), exp.names, label + ": the names kept, by flagged premium");
  for (const L of ["A", "L", "P"]) {
    const got = new Map(model.pairs[L].map((p) => [p.a + "|" + p.b, p]));
    eq(got.size, exp.pairs[L].length, label + ` ${L}: the number of pairs`);
    for (const x of exp.pairs[L]) {
      const p = got.get(x.a + "|" + x.b);
      ok(p, label + ` ${L}: pair ${x.a} ${x.b} is present`);
      near(p.r, x.r, 1e-9, label + ` ${L} ${x.a}/${x.b} r against numpy.corrcoef`);
      near(p.lo, x.lo, 1e-9, label + ` ${L} ${x.a}/${x.b} lower Fisher bound against scipy`);
      near(p.hi, x.hi, 1e-9, label + ` ${L} ${x.a}/${x.b} upper Fisher bound against scipy`);
      near(p.r1, x.r1, 1e-9, label + ` ${L} ${x.a}/${x.b} first-half r`);
      near(p.r2, x.r2, 1e-9, label + ` ${L} ${x.a}/${x.b} second-half r`);
      eq(p.passed, x.passed, label + ` ${L} ${x.a}/${x.b} passed`);
      eq(p.stable, x.stable, label + ` ${L} ${x.a}/${x.b} stable`);
    }
  }
}

async function modelVerdict(browser, patch) {
  const { context, page } = await openMarket(browser, { patch });
  try {
    await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.relations, null, { timeout: 15000 });
    for (const c of FIXTURE.cases) compare(await modelOf(page, c.rows, {}), c.expected, c.label);
    return true;
  } catch (error) {
    return false;
  } finally {
    await context.close();
  }
}

const browser = await launch();

{
  const { context, page, errors } = await openMarket(browser);
  await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.relations, null, { timeout: 15000 });
  for (const c of FIXTURE.cases) compare(await modelOf(page, c.rows, {}), c.expected, c.label);
  eq((await modelOf(page, FIXTURE.cases[0].rows, {})).params, FIXTURE.params, "THE MODULE'S DEFAULTS ARE THE PARAMETERS THE FIXTURE WAS WRITTEN WITH");
  const thin = await modelOf(page, FIXTURE.cases[0].rows.slice(0, 12), {});
  eq(thin.status, "thin", "TOO FEW WINDOWS IS NAMED THIN, NOT DRAWN");
  ok(/windows over/.test(thin.reason) && /relations need/.test(thin.reason), "and its reason says how many windows, bins and names it had and how many it needs");
  eq((await modelOf(page, [], null)).status, "quiet", "no rows is quiet");
  {
    const five = FIXTURE.cases[0].expected.names.slice(0, 5), six = FIXTURE.cases[0].expected.names.slice(0, 6);
    const few = await modelOf(page, FIXTURE.cases[0].rows.filter((r) => five.includes(r.t)), { minWindows: 1 });
    ok(few.status === "ok" && few.names.length === 5 && few.pairs.P.length === 0 && /needs at least 6 names/.test(few.pReason), "BEYOND THE MARKET NEEDS FOUR OTHER NAMES TO STAND FOR THE MARKET: five names give no pairs and say why (" + few.pReason + ")");
    ok(few.pairs.A.length === 10 && few.pairs.L.length === 10, "and the other two relations are unaffected by it");
    const enough = await modelOf(page, FIXTURE.cases[0].rows.filter((r) => six.includes(r.t)), { minWindows: 1 });
    ok(enough.pReason === null && enough.pairs.P.length === 15, "six names give the third relation, 15 pairs");
  }
  eq((await modelOf(page, [{ t: "X", prem: 0, spanStart: "2026-09-29T14:00:00.000Z" }, { t: "Y", prem: 5, spanStart: "nope" }, { prem: 5 }], null)).status, "quiet", "rows with no premium, no time or no name are not windows");
  const flat = [];
  for (let i = 0; i < 50; i++) for (const t of ["AA", "BB", "CC", "DD"]) flat.push({ t, cp: "C", prem: 1000, askPrem: 600, bidPrem: 100, spanStart: new Date(Date.parse("2026-09-29T14:00:00Z") + i * 600000).toISOString() });
  const constant = await modelOf(page, flat, null);
  ok(constant.pairs.A.every((p) => p.r === null && p.passed === false), "A CONSTANT SERIES HAS NO CORRELATION: null, never a zero or a pass");
  await page.evaluate(() => window.FlowsUI.relations.fisher(0.5, 3));
  eq(await page.evaluate(() => window.FlowsUI.relations.fisher(0.5, 3)), null, "a Fisher interval needs at least four bins");
  eq(errors, [], "no page error");
  await context.close();
}

{
  const { context, page, errors } = await openMarket(browser, { alerts: alertsFixture({ n: 220, seed: 5 }), universe: universeFixture() });
  await page.click("#mkT-relations");
  await page.waitForSelector("#mkRelations .rl-node", { timeout: 15000 });
  const m = await page.evaluate(() => {
    const api = window.FlowsUI.relations.of(document.getElementById("mkRelations"));
    const M = api.model();
    return { names: M.names.map((n) => n.t), nodes: [...document.querySelectorAll("#mkRelations .rl-node")].map((n) => n.dataset.t), labels: [...document.querySelectorAll("#mkRelations .rl-node .rl-lb")].map((n) => n.textContent), sectors: [...document.querySelectorAll("#mkRelations .rl-node .rl-sc")].map((n) => n.textContent), stats: document.querySelector("#mkRelations .rl-stats").textContent, read: document.querySelector("#mkRelations .rl-read").textContent, note: document.querySelector("#mkRelations .rl-note").textContent, pairs: document.querySelectorAll("#mkRelations .rl-pair").length, drawn: document.querySelectorAll("#mkRelations .rl-edge").length, stable: M.pairs.A.filter((p) => p.stable).length };
  });
  eq(m.nodes.sort(), m.names.slice().sort(), "EVERY NAME THE MODEL KEPT IS A NODE AND EVERY NODE IS LABELLED WITH ITS TICKER");
  eq(m.labels.slice().sort(), m.names.slice().sort(), "the label is the ticker");
  ok(m.sectors.length === m.names.length && m.sectors.every((s) => s && s.length > 1), "and every node carries its sector, or No sector, in words");
  eq(m.drawn, m.stable, "only pairs that passed in both halves are drawn, one curve each");
  ok(/windows/.test(m.stats) && /bins/.test(m.stats) && /read \d\d:\d\d TRT/.test(m.stats), "the stats line has windows, bins and the read time in TRT: " + m.stats);
  ok(/pass by chance/.test(m.note) && /not a forecast/i.test(m.note), "the note says how many pairs would pass by chance and that it is not a forecast");
  ok(/(?:fewer than one of these \d+ is expected|up to about \d+ of these \d+ are expected) to pass by chance alone/.test(m.note), "and states it as an upper figure, 6 in 100, which the null grid in flows-lean holds: " + m.note);
  await page.click("#mkRelations .rl-seg button[data-l='P']");
  const pm = await page.evaluate(() => ({ note: document.querySelector("#mkRelations .rl-note").textContent, lead: document.querySelector("#mkRelations .rl-read").textContent, drawn: document.querySelectorAll("#mkRelations .rl-edge").length, stable: window.FlowsUI.relations.of(document.getElementById("mkRelations")).model().pairs.P.filter((p) => p.stable).length }));
  ok(/not stock-price moves/.test(pm.note) && /daily closes/.test(pm.note), "THE THIRD RELATION SAYS IT REMOVES THE SHARED FLOW BURST, NOT PRICE MOVES, AND THAT PRICE LAYERS NEED DAILY CLOSES");
  eq(pm.drawn, pm.stable, "and draws only its own stable pairs");
  ok(!/\b(tape|unusual|alert|screen|rare|sigma|radar)\b/i.test(pm.note + pm.lead + SRC.match(/Beyond the market[^}]*/)[0]), "and uses none of the barred words");
  ok(pm.note.split(/(?<=\.)\s+/).filter((t) => t.split(/\s+/).length > 14 && /beyond|removes|closes/.test(t)).length === 0, "and its sentences stay within fourteen words");
  await page.click("#mkRelations .rl-seg button[data-l='A']");
  ok(/pairs? pass/.test(m.read), "the readout says how many pairs pass");
  {
    const head = await page.evaluate(() => (document.querySelector("#mkRelations .rl-lh") || { textContent: "" }).textContent);
    ok(/^(None of \d+ tested pairs pass|\d+ pairs? pass(?:es)?, of \d+ tested)/.test(head.trim()), "THE LIST HEADER SAYS HOW MANY PASS OF HOW MANY WERE TESTED, NOT 'TESTED PAIRS' FOR THE ONES THAT PASSED: " + head);
  }
  await page.click("#mkRelations .rl-node");
  const sel = await page.evaluate(() => ({ read: document.querySelector("#mkRelations .rl-read").textContent, on: document.querySelectorAll("#mkRelations .rl-node.is-sel").length }));
  eq(sel.on, 1, "a click selects one node");
  ok(/\(.+\):/.test(sel.read), "and the readout names it with its sector: " + sel.read);
  await page.click("#mkRelations .rl-seg button[data-l='L']");
  eq(await page.evaluate(() => document.querySelector("#mkRelations .rl-seg button[data-l='L']").getAttribute("aria-pressed")), "true", "the second relation can be chosen");
  const held = await page.evaluate((rows) => {
      const api = window.FlowsUI.relations.of(document.getElementById("mkRelations"));
      api.take({ rows, sessionDate: "2026-09-29", readAt: "2026-09-29T20:00:00.000Z" }, null);
      api.layer("P");
      return { empty: (document.querySelector("#mkRelations .nm-empty") || { textContent: "" }).textContent, edges: document.querySelectorAll("#mkRelations .rl-edge").length, pairs: document.querySelectorAll("#mkRelations .rl-pair").length, read: document.querySelector("#mkRelations .rl-read").textContent };
    }, FIXTURE.cases[0].rows.filter((r) => FIXTURE.cases[0].expected.names.slice(0, 5).includes(r.t)));
    ok(/needs at least 6 names/.test(held.empty) && held.edges === 0 && held.pairs === 0 && /needs at least 6 names/.test(held.read), "WITH TOO FEW OTHER NAMES THE THIRD RELATION SAYS SO AND DRAWS NOTHING: " + JSON.stringify(held));

  const shape = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok(shape.sh <= shape.ih + 1 && shape.sw <= shape.iw, "the Relations tab does not scroll the page");
  eq(errors, [], "no page error");
  await context.close();
}

{
  const { context, page } = await openMarket(browser, { alertsStatus: 500 });
  await page.click("#mkT-relations");
  await page.waitForFunction(() => { const e = document.querySelector("#mkRelations .nm-empty"); return !!e && !/^Reading/.test(e.textContent || ""); }, null, { timeout: 15000 });
  const said = await page.evaluate(() => document.querySelector("#mkRelations .nm-empty").textContent);
  ok(/Unavailable/.test(said) && /HTTP 500/.test(said), "A FAILED READ SAYS SO WITH ITS REASON, NOT 'NO RELATIONS': " + said);
  await context.close();
}
{
  const { context, page } = await openMarket(browser, { alerts: { ...alertsFixture(), rows: alertsFixture().rows.slice(0, 6) } });
  await page.click("#mkT-relations");
  await page.waitForFunction(() => { const e = document.querySelector("#mkRelations .nm-empty"); return !!e && !/^Reading/.test(e.textContent || ""); }, null, { timeout: 15000 });
  const said = await page.evaluate(() => document.querySelector("#mkRelations .nm-empty").textContent);
  ok(/Not enough to relate/.test(said) && /relations need 40 windows/.test(said), "too few windows says how many are needed: " + said);
  const once = await page.evaluate(() => {
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden"; };
    const all = [...document.querySelectorAll("#mkRelations p, #mkRelations .rl-stats")].filter((el) => shown(el) && /Not enough to relate/.test(el.textContent));
    const stats = document.querySelector("#mkRelations .rl-stats");
    return { visible: all.length, stats: stats.textContent, read: document.querySelector("#mkRelations .rl-read").textContent };
  });
  eq(once.visible, 1, `THE THIN STATE PRINTS ITS SENTENCE ONCE ON SCREEN, NOT IN THE BANNER AND THE RING BOTH (${JSON.stringify(once)})`);
  ok(await page.evaluate(() => document.querySelector("#mkRelations .nm-empty").getAttribute("role") === "status"), "and the one sentence is the status a screen reader hears");
  ok(!/\u2014|—/.test(once.stats), "and the stats slot beside the switch is empty, not a bare dash");
  await context.close();
}
{
  const { context, page } = await openMarket(browser, { alerts: { status: "pending", rows: [] } });
  await page.click("#mkT-relations");
  await page.waitForFunction(() => /not published/.test((document.querySelector("#mkRelations .nm-empty") || {}).textContent || ""), null, { timeout: 15000 });
  ok(/not published/.test(await page.evaluate(() => document.querySelector("#mkRelations .nm-empty").textContent)), "a feed the pipeline has not published is named as such");
  await context.close();
}

for (const [w, h] of [[1440, 820], [1024, 768], [390, 844]]) {
  const { context, page } = await openMarket(browser, { viewport: { width: w, height: h }, coarse: w < 500 });
  await page.click("#mkT-relations");
  await page.waitForSelector("#mkRelations .rl-seg", { timeout: 15000 });
  const measure = () => page.evaluate(() => {
    const host = document.getElementById("mkRelations").getBoundingClientRect();
    const mod = document.getElementById("mkRelationsCard").getBoundingClientRect();
    const visible = [...document.querySelectorAll("#mkRelations .rl-node, #mkRelations .rl-pair")].filter((n) => n.getBoundingClientRect().width > 0);
    const outside = visible.filter((n) => { const r = n.getBoundingClientRect(); return r.left < mod.left - 1 || r.right > mod.right + 1 || r.bottom > mod.bottom + 1 || r.top < mod.top - 1; }).length;
    const small = [...document.querySelectorAll("#mkRelations button")].filter((b) => b.getBoundingClientRect().width > 0 && (matchMedia("(pointer: coarse)").matches ? b.getBoundingClientRect().height < 43.5 : false)).length;
    return { sh: document.documentElement.scrollHeight, ih: innerHeight, outside, small, nodes: visible.length };
  });
  let g = await measure();
  for (let i = 0; i < 8 && g.outside; i++) { await page.waitForTimeout(250); g = await measure(); }
  ok(g.sh <= g.ih + 1, `${w}: no page scroll`);
  eq(g.outside, 0, `${w}: no node or pair row outside the module`);
  eq(g.small, 0, `${w}: coarse targets are 44 px`);
  ok(g.nodes > 0, `${w}: something is drawn`);
  if (w < 900) {
    await page.click("#mkRelations .rl-panes button[data-p='pairs']");
    ok(await page.evaluate(() => document.querySelectorAll("#mkRelations .rl-pair").length > 0 || !!document.querySelector("#mkRelations .rl-none")), `${w}: the Pairs pane lists the pairs or says none passed`);
  }
  await context.close();
}

const MUTANTS = [
  ["Fisher interval uses n - 2", [["se = 1 / Math.sqrt(n - k - 3);", "se = 1 / Math.sqrt(n - k - 2);"]]],
  ["no factor removal", [["const corr = cond ? (x, y, f) => partial(x, y, f) : (x, y) => pearson(x, y);", "const corr = (x, y) => pearson(x, y);"]]],
  ["partial interval uses n - 3", [["fisher(r, B, cond ? 1 : 0)", "fisher(r, B, 0)"]]],
  ["factor is only the first name", [["const factor = cond ? sum.map((v, b) => v - zs[i][b] - zs[j][b]) : null;", "const factor = cond ? zs[0] : null;"]]],
  ["factor contains the pair itself", [["const factor = cond ? sum.map((v, b) => v - zs[i][b] - zs[j][b]) : null;", "const factor = cond ? sum : null;"]]],
  ["factor leaves out only the first name of the pair", [["const factor = cond ? sum.map((v, b) => v - zs[i][b] - zs[j][b]) : null;", "const factor = cond ? sum.map((v, b) => v - zs[i][b]) : null;"]]],

  ["factor built from the lean series", [["const zs = cand.map((s) => standardise(s.A));", "const zs = cand.map((s) => standardise(s.L));"]]],
  ["partial sign flipped", [["return pearson(residual(x, f), residual(y, f));", "const q = pearson(residual(x, f), residual(y, f)); return q === null ? null : -q;"]]],
  ["residual keeps the factor slope", [["return x.map((v, i) => v - mx - b * (f[i] - mf));", "return x.map((v, i) => v - mx - 0.5 * b * (f[i] - mf));"]]],
  ["bins of five minutes", [["binMin: 10", "binMin: 5"]]],
  ["lean sign not flipped for puts", [["r.cp === \"C\" ? sp.ask - sp.bid : sp.bid - sp.ask", "sp.ask - sp.bid"]]],
  ["passed ignores the interval", [["(ci[0] > 0 || ci[1] < 0) && Math.abs(r) >= P.minCorr", "Math.abs(r) >= P.minCorr"]]],
  ["a bin keeps only its last window", [["s.A[b] += p.prem;", "s.A[b] = p.prem;"]]],
  ["stable ignores the halves", [["const sameSign = r1 !== null && r2 !== null && Math.sign(r1) === Math.sign(r) && Math.sign(r2) === Math.sign(r);", "const sameSign = true;"]]],
  ["names kept by count instead of premium", [["b.prem - a.prem || (a.t < b.t ? -1 : 1)).slice(0, P.names)", "b.active.size - a.active.size || (a.t < b.t ? -1 : 1)).slice(0, P.names)"]]],
];
{
  const five = FIXTURE.cases[0].expected.names.slice(0, 5);
  const { context, page } = await openMarket(browser, { patch: { [REL]: [["if (cond && base.pReason) continue;", ""]] } });
  await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.relations, null, { timeout: 15000 });
  const m = await modelOf(page, FIXTURE.cases[0].rows.filter((r) => five.includes(r.t)), { minWindows: 1 });
  ok(m.pairs.P.length !== 0, "PLANTED WRONG BUILD FAILS THE FEW-NAMES CHECK: the third relation drawn with too few other names");
  await context.close();
}
for (const [name, edits] of MUTANTS) {
  ok(!(await modelVerdict(browser, { [REL]: edits })), `PLANTED WRONG BUILD FAILS THE NUMPY AND SCIPY FIXTURE: ${name}`);
}

const PAGE_MUTANTS = [
  ["draws pairs that did not pass", "const { shown } = pairsList();\n      const lit", "const shown = M.pairs[layer];\n      const lit", /drawn/],
  ["the chance sentence is gone", "\" to pass by chance alone. Not a forecast.\"", "\". Not a forecast.\"", /chance/],
];
for (const [name, from, to] of PAGE_MUTANTS) {
  const { context, page } = await openMarket(browser, { patch: { [REL]: [[from, to]] }, alerts: alertsFixture({ n: 220, seed: 5 }) }).catch(() => ({ context: null }));
  if (!context) { ok(true, `PLANTED WRONG BUILD CANNOT EVEN BE BUILT: ${name}`); continue; }
  await page.click("#mkT-relations");
  await page.waitForSelector("#mkRelations .rl-node", { timeout: 15000 });
  const bad = await page.evaluate(() => {
    const api = window.FlowsUI.relations.of(document.getElementById("mkRelations"));
    const M = api.model();
    return { drawn: document.querySelectorAll("#mkRelations .rl-edge").length, stable: M.pairs.A.filter((p) => p.stable).length, note: document.querySelector("#mkRelations .rl-note").textContent };
  });
  ok(bad.drawn !== bad.stable || !/pass by chance/.test(bad.note), `PLANTED WRONG BUILD FAILS THE PAGE CHECKS: ${name}`);
  await context.close();
}

await browser.close();
console.log(`flows-relations-render: ${checks} checks, flow co-movement against numpy and scipy on three seeded worlds, the honest states, three viewports and ${MUTANTS.length + PAGE_MUTANTS.length} planted wrong builds`);
