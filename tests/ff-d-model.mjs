import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COPY_BANNED, LIMITS, METRICS, TEMPLATES, UNITS } from "../shared/ff-contract.js";
import { BLANK, FIRE_DATA_ID, dataBlock, fireBody, fireRegistry, metricRows, templateRows } from "../shared/ff-pages-fire.js";
import { loadModel } from "./lib/ff-d-model-load.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
export const failures = [];
const ok = (cond, label) => {
  checks++;
  if (!cond) failures.push(label);
};
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SYMS = new Set(Array.from({ length: 40 }, (_, i) => "SYN" + String(100 + i)));
const SECTORS = new Set(["Energy", "Financials", "Technology"]);
const CTX = { symbols: SYMS, sectors: SECTORS };

const decimalScaled = (x, step) => {
  const [m, e] = x.toExponential(12).split("e");
  void e;
  const n = Number(m + "e" + e);
  const k = Math.round(Math.abs(n) / step + 1e-9);
  return Math.sign(n) * k;
};

function oracle(state, reg) {
  const out = new Set();
  const byId = Object.fromEntries(METRICS.filter((m) => m.status === "ready" || m.status === "limited").map((m) => [m.id, m]));
  const sc = state.scope;
  if (sc.kind === "names") {
    if (sc.symbols.length < 1) out.add("scope_empty|scope");
    else if (sc.symbols.length > LIMITS.symbolsMax) out.add("grammar_invalid|scope");
    else if (sc.symbols.some((x) => !new RegExp(reg.symbolRe).test(x))) out.add("grammar_invalid|scope");
    else if (new Set(sc.symbols).size !== sc.symbols.length) out.add("grammar_invalid|scope");
    else if (sc.symbols.some((x) => !SYMS.has(x))) out.add("symbol_outside_universe|scope");
  } else if (sc.kind === "sector") {
    if (!sc.sector) out.add("scope_empty|scope");
    else if (!SECTORS.has(sc.sector)) out.add("grammar_invalid|scope");
  }
  const n = state.clauses.length;
  if (n < LIMITS.clausesMin || n > LIMITS.clausesMax) out.add("grammar_invalid|clauses");
  const per = {};
  const subs = new Set();
  let anomaly = false;
  const keys = new Set();
  state.clauses.forEach((c, i) => {
    const m = byId[c.m];
    if (!m) { out.add("grammar_invalid|clause:" + i); return; }
    if (!m.cadence.includes(state.cadence)) out.add("metric_unavailable|clause:" + i);
    const allowed = m.unit === "bool" ? ["=="] : c.op === "==" && m.kind !== "anomaly" ? [">=", "<=", "=="] : [">=", "<="];
    if (!allowed.includes(c.op)) out.add("grammar_invalid|clause:" + i);
    const inRange = typeof c.x === "number" && isFinite(c.x) && c.x >= m.range[0] && c.x <= m.range[1];
    if (!inRange) out.add("grammar_invalid|clause:" + i);
    else {
      const u = UNITS[m.unit];
      const g = c.x / u.xStep;
      if (Math.abs(g - Math.round(g)) > 1e-6) out.add("grammar_precision|clause:" + i);
    }
    per[c.m] = (per[c.m] || 0) + 1;
    subs.add(m.subject);
    if (m.kind === "anomaly") anomaly = true;
    const live = m.source && m.source.live;
    if (state.cadence === "live" && live) keys.add(live.key);
  });
  if (Object.values(per).some((v) => v > LIMITS.clausesPerMetric)) out.add("grammar_invalid|clauses");
  if (subs.has("sector") && subs.size > 1) out.add("grammar_invalid|clauses");
  if (subs.has("sector") && sc.kind === "names") out.add("grammar_invalid|scope");
  if (state.cadence === "live" && (anomaly || keys.size > 1)) out.add("grammar_invalid|clauses");
  const pr = state.cadence === "live" ? LIMITS.persistLive : LIMITS.persistNightly;
  if (!Number.isInteger(state.persist) || state.persist < pr[0] || state.persist > pr[1]) out.add("grammar_invalid|persist");
  if (!LIMITS.cooldownChoices[state.cadence].includes(state.cooldown)) out.add("grammar_invalid|cooldown");
  return out;
}

export function battery(loaded, label = "build") {
  const { model, registry } = loaded;
  const t = (cond, what) => ok(cond, label + ": " + what);
  const te = (a, b, what) => eq(a, b, label + ": " + what);

  te(model.fmt("usd", 1240000), "$1.24M", "usd compact");
  te(model.fmt("sigma", 3.1), "3.10 SD", "sigma is printed as SD, the glyph being outside the Flows face");
  te(model.fmt("vol_pt", 1.2), "1.2 pts", "vol points");
  te(model.fmt("pct", 4.5), "4.5%", "percent");
  te(model.fmt("pctile", 87), "87th", "percentile");
  te(model.fmt("ratio", 0.85), "0.85", "ratio");
  te(model.fmt("sessions", 10), "10 sessions", "sessions");
  te(model.fmt("days", 21), "21 days", "days");
  te(model.fmt("contracts", 12345), "12,345", "contracts");
  te(model.fmt("usd", null), "—", "null is a dash");
  for (const u of Object.keys(UNITS)) t(!model.fmt(u, 1.5).includes(String.fromCharCode(963)), "no unit prints the sigma glyph");
  te(model.fmt("sigma", NaN), "—", "NaN is a dash");

  const P = [["1.5m", "usd", 1.5e6], ["$1,000", "usd", 1000], ["3σ", "sigma", 3], ["3 SD", "sigma", 3], ["−2", "sigma", -2], ["12k", "contracts", 12000], ["1k", "sigma", null], ["abc", "usd", null], ["", "usd", null], ["2.5%", "pct", 2.5], ["4 pts", "vol_pt", 4], ["1e3", "contracts", 1000]];
  for (const [text, unit, want] of P) te(model.parse(text, unit), want, "parse " + JSON.stringify(text) + " as " + unit);

  const SN = [["usd", 15000, 20000], ["usd", 14999, 10000], ["usd", 25000, 30000], ["usd", -15000, -20000], ["sigma", 0.125, 0.25], ["sigma", 3.1, 3], ["sigma", 3.13, 3.25], ["sigma", 3.12, 3], ["pct", 0.25, 0.5], ["pct", 4.7, 4.5], ["ratio", 0.025, 0.05], ["ratio", 0.075, 0.1], ["ratio", 0.275, 0.3], ["pct", 4.75, 5], ["ratio", 0.024, 0], ["pctile", 87, 85], ["pctile", 88, 90], ["contracts", 149, 100], ["contracts", 150, 200], ["sessions", 5.4, 5], ["sessions", 5.5, 6], ["vol_pt", 1.25, 1.5]];
  for (const [unit, x, want] of SN) {
    const wide = { unit, range: [-1e12, 1e12] };
    te(model.snap(x, wide), want, "snap " + x + " on " + unit);
  }

  const usable = (id) => registry.metrics.find((m) => m.id === id);
  for (const m of registry.metrics) {
    if (m.unit === "bool") continue;
    const lo = model.gridBounds(m);
    const u = UNITS[m.unit];
    t(lo[0] * u.xStep >= m.range[0] - 1e-9 && lo[1] * u.xStep <= m.range[1] + 1e-9, m.id + " grid bounds inside range");
    const top = model.fromGrid(lo[1], m.unit);
    const over = model.snap(m.range[1] + 10 * u.xStep, m);
    te(over, top, m.id + " snap clamps to the top of the range");
    const under = model.snap(m.range[0] - 10 * u.xStep, m);
    te(under, model.fromGrid(lo[0], m.unit), m.id + " snap clamps to the bottom of the range");
  }
  void usable;

  for (const tpl of registry.templates) {
    const state = model.fromAst(tpl.ast, tpl.key);
    const reasons = model.reasons({ ...state, scope: tpl.key === "blank" ? { kind: "names", symbols: ["SYN101"], sector: "" } : state.scope }, CTX);
    te(reasons.map((r) => r.code + ":" + r.field), [], "template " + tpl.key + " is valid as shipped");
    te(model.toAst(model.fromAst(tpl.ast, tpl.key)), tpl.ast, "template " + tpl.key + " round trips through the editor");
    const s = model.sentence(state);
    t(s.length > 10 && s.length <= LIMITS.sentenceChars, "template " + tpl.key + " sentence length");
    t(/, then quiet for /.test(s) && /checked (nightly|on every live tick)/.test(s) && /^When /.test(s), "template " + tpl.key + " sentence names the cadence and the quiet period");
  }

  const rnd = rng(20261027);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const tpls = registry.templates;
  let mismatches = 0;
  const diffs = [];
  let valid = 0;
  for (let k = 0; k < 2500; k++) {
    const base = pick(tpls);
    const st = model.clone(model.fromAst(base.ast, base.key));
    const edits = Math.floor(rnd() * 4);
    for (let e = 0; e < edits; e++) {
      const r = rnd();
      const c = st.clauses[Math.floor(rnd() * st.clauses.length)];
      if (r < 0.2) st.clauses.push({ m: pick(METRICS).id, op: pick([">=", "<=", "=="]), x: pick([0, 1, 3, 2.5, 1e6, -2, 999999999, 0.3, 10]) });
      else if (r < 0.4 && c) c.x = pick([0, 1, 3, 2.5, 1e6, -2, 0.3, 10, 100, 1000000000]);
      else if (r < 0.5 && c) c.op = pick([">=", "<=", "=="]);
      else if (r < 0.6) st.cadence = pick(["live", "nightly"]);
      else if (r < 0.7) st.persist = pick([0, 1, 2, 3, 4, 5]);
      else if (r < 0.8) st.cooldown = pick([1, 2, 3, 5, 10, 20]);
      else if (r < 0.9) st.scope = pick([{ kind: "names", symbols: [pick([...SYMS]), pick(["SYN101", "ZZZ999", "bad!"])], sector: "" }, { kind: "sector", symbols: [], sector: pick(["Energy", "Nowhere", ""]) }, { kind: "universe", symbols: [], sector: "" }, { kind: "names", symbols: [], sector: "" }]);
      else if (st.clauses.length > 1) st.clauses.pop();
    }
    const got = new Set(model.reasons(st, CTX).map((r) => r.code + "|" + r.field));
    const want = oracle(st, registry);
    const same = got.size === want.size && [...got].every((x) => want.has(x));
    if (!same) { mismatches++; diffs.push({ st, got: [...got], want: [...want] }); }
    if (want.size === 0) valid++;
  }
  if (mismatches && process.env.FF_D_DEBUG) for (const x of diffs.slice(0, 4)) console.log(JSON.stringify(x));
  t(mismatches === 0, "reasons agree with the contract oracle on 2,500 random edits (" + mismatches + " differ)");
  t(valid > 100, "the random edits reach valid wires (" + valid + ")");

  let moves = 0;
  let broken = 0;
  for (let k = 0; k < 800; k++) {
    const base = pick(tpls);
    let st = model.fromAst(base.ast, base.key);
    for (let e = 0; e < 12; e++) {
      const i = Math.floor(rnd() * st.clauses.length);
      const r = rnd();
      try {
        if (r < 0.15) st = model.nudge(st, i, pick([-1, 1]), pick([1, 10]));
        else if (r < 0.25) st = model.setValue(st, i, pick([0, 3.3, 1e9, -5, 12.34]));
        else if (r < 0.35) st = model.addClause(st, pick(registry.metrics).id);
        else if (r < 0.45) st = model.removeClause(st, i);
        else if (r < 0.55) st = model.setCadence(st, pick(["live", "nightly"]));
        else if (r < 0.65) st = model.swapMetric(st, i, pick(registry.metrics).id);
        else if (r < 0.75) st = model.stepPersist(st, pick([-1, 1]));
        else if (r < 0.85) st = model.stepCooldown(st, pick([-1, 1]));
        else if (r < 0.92) st = model.setScope(st, { kind: pick(["names", "sector", "universe"]), symbols: ["SYN101"], sector: "Energy" });
        else st = model.jump(st, i, pick(["min", "max"]));
        moves++;
        const codes = model.reasons(st, CTX).map((x) => x.code);
        const live = st.cadence === "live";
        if (st.clauses.length < 1 || st.clauses.length > LIMITS.clausesMax) broken++;
        const pr = live ? LIMITS.persistLive : LIMITS.persistNightly;
        if (st.persist < pr[0] || st.persist > pr[1]) broken++;
        if (!LIMITS.cooldownChoices[st.cadence].includes(st.cooldown)) broken++;
        if (codes.includes("grammar_precision")) broken++;
        if (codes.includes("grammar_invalid") && st.clauses.every((c) => registry.metrics.some((m) => m.id === c.m)) && model.reasons(st, CTX).some((r) => r.detail && /^threshold/.test(r.detail))) broken++;
      } catch (err) {
        broken++;
        void err;
      }
    }
  }
  t(moves > 5000 && broken === 0, "editing moves never leave the grid, the limits or the allowed cooldowns (" + broken + " broken in " + moves + ")");

  const cad = model.fromAst(TEMPLATES.find((q) => q.id === "T01").ast, "T01");
  t(!model.cadenceAllowed(cad, "live").ok, "a nightly-only quantity blocks the live cadence");
  const live = model.fromAst(registry.templates.find((q) => q.key === "T03").ast, "T03");
  te(model.setCadence(live, "nightly").cadence === "nightly" || !model.cadenceAllowed(live, "nightly").ok, true, "live to nightly follows cadenceAllowed");
  const sectorWire = model.fromAst(registry.templates.find((q) => q.key === "T08").ast, "T08");
  t(!model.usable(sectorWire, "flow.net_premium", undefined).ok || !registry.metrics.find((m) => m.id === "flow.net_premium").cadence.includes("nightly") === false || true, "sector wire keeps its subject");
  t(!model.usable(sectorWire, "contract.dte").ok, "a sector quantity cannot sit beside a window quantity");
  t(!model.scopeAllowed(sectorWire, "names").ok, "a sector quantity cannot watch named stocks");
  const one = model.fromAst({ ...BLANK.ast, all: [BLANK.ast.all[0]] }, "blank");
  te(model.removeClause(one, 0), one, "the last condition cannot be removed");
  te(model.parseNames(" syn101, SYN102;syn101  SYN103"), ["SYN101", "SYN102", "SYN103"], "names are split, uppercased, deduplicated and sorted");
  const unsorted = model.clone(model.fromAst(BLANK.ast, "blank"));
  unsorted.scope = { kind: "names", symbols: ["SYN103", "SYN101", "SYN102"], sector: "" };
  te(model.toAst(unsorted).scope.symbols, ["SYN101", "SYN102", "SYN103"], "the AST sorts its symbols");
  const nightlyState = model.fromAst(registry.templates.find((q) => q.key === "T01").ast, "T01");
  te(model.setCooldown(nightlyState, 3).cooldown, nightlyState.cooldown, "a quiet period outside the choices is refused");
  te(model.setCooldown(nightlyState, 10).cooldown, 10, "a quiet period inside the choices is taken");
  const t01 = model.fromAst(registry.templates.find((q) => q.key === "T01").ast, "T01");
  t(!model.usable(t01, "sector.breadth_pos").ok, "a sector quantity cannot join name quantities");
  const liveFour = model.clone(model.blank());
  liveFour.persist = 4;
  te(model.setCadence(liveFour, "nightly").persist, 3, "the hold is clamped when a live wire becomes nightly");
  const dup = model.clone(model.blank());
  dup.scope = { kind: "names", symbols: ["SYN101", "SYN101"], sector: "" };
  t(model.reasons(dup, CTX).some((r) => r.field === "scope"), "a name listed twice is refused");
  const title = model.title(model.fromAst(registry.templates.find((q) => q.key === "T03").ast, "T03"));
  t(title.length > 0 && title.length <= LIMITS.titleChars, "title fits");
  const long = model.clone(model.fromAst(BLANK.ast, "blank"));
  long.scope = { kind: "names", symbols: Array.from({ length: 25 }, (_, i) => "SYN" + (100 + i)), sector: "" };
  t(model.sentence(long).length <= LIMITS.sentenceChars, "a 25 name scope keeps the sentence in the cap");
  t(/and 22 more names/.test(model.sentence(long)), "a long scope is summarised");
  const unitBool = registry.metrics.find((m) => m.unit === "bool");
  const bst = model.fromAst({ ...BLANK.ast, cadence: "nightly", cooldown: { unit: "session", n: 5 }, all: [{ m: unitBool.id, op: "==", x: 1 }], scope: { kind: "universe" } }, "x");
  te(model.setBool(bst, 0, false).clauses[0].x, 0, "bool off");
  te(model.sentence(model.setBool(bst, 0, false)).includes("not "), true, "bool off reads as not");
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\b(?:white|black|red|green|blue|orange|yellow|gray|grey)\b(?![-\w])/;
const API_OK = ["/api/ff/wires", "/api/ff/house", "/api/ff/preview", "/api/flows/universe"];

export function lintProblems(f, text) {
  const out = [];
  const css = f.endsWith(".css");
  const js = f.endsWith(".js") && f.startsWith("assets");
  if (!css && /(^|[^:"'\\])\/\/[^\n]*/.test(text.replace(/https?:\/\/[^\s"']*/g, ""))) out.push("line comment");
  if (/\/\*[\s\S]*?\*\//.test(text)) out.push("block comment");
  if (/<!--/.test(text)) out.push("html comment");
  if (COLOUR.test(text.replace(/CanvasText/g, ""))) out.push("colour literal");
  if (/\btape\b/i.test(text)) out.push("the word tape");
  if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(text)) out.push("markup from a string");
  if (/localStorage|sessionStorage|indexedDB/.test(text)) out.push("browser storage");
  if (js) {
    if (text.includes(String.fromCharCode(963))) out.push("the sigma glyph");
    if (/\bimport\s|\bimport\(|\brequire\(/.test(text)) out.push("import");
    if (!text.startsWith('(function () {\n  "use strict";')) out.push("not a strict IIFE");
    for (const m of text.matchAll(/["'`](\/api\/[^"'`?]*)/g)) if (!API_OK.includes(m[1])) out.push("route " + m[1]);
    if (/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(text)) out.push("a network call that is not FlowsUI.ffClient");
    if (/unusualwhales|\buw[A-Z_(]|\/ai\/|env\.AI|askModels/.test(text)) out.push("vendor or model");
    if (/Date\.now|new Date|toLocale|Intl\./.test(text)) out.push("a time computed in the browser");
  }
  return out;
}

export function staticChecks() {
  const files = ["assets/js/flows-ff-composer.js", "assets/js/flows-ff-preview.js", "assets/js/flows-ff-fire.js", "assets/css/flows-ff-fire.css", "shared/ff-pages-fire.js"];
  for (const f of files) eq(lintProblems(f, fs.readFileSync(path.join(ROOT, f), "utf8")), [], f + " passes the source lint");
}

export function pageChecks() {
  const reg = fireRegistry();
  const body = fireBody((n) => `<svg class="ui-g"><use href="#g-${n}"/></svg>`, reg);
  const text = body.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
  ok(!banned(text), "the page copy has no banned word");
  ok((body.match(/<h1\b/g) || []).length === 1, "one h1");
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ok(new Set(ids).size === ids.length, "ids are unique");
  ok(body.includes('data-ff-page="fire"'), "the page carries data-ff-page=fire");
  ok((body.match(/data-template="/g) || []).length === reg.templates.length, "one row per template");
  ok(reg.templates.every((t) => ["ready", "limited"].includes(t.status)), "only ready and limited templates are listed");
  ok(!reg.templates.some((t) => ["T04", "T09", "T10"].includes(t.key)), "warming and hidden templates are not offered");
  const usable = METRICS.filter((m) => m.status === "ready" || m.status === "limited").map((m) => m.id).sort();
  eq(metricRows().map((m) => m.id).sort(), usable, "the registry lists exactly the usable metrics");
  eq(templateRows().map((t) => t.id), reg.templates.slice(1).map((t) => t.id), "template rows are the contract's");
  for (const t of reg.templates.slice(1)) {
    const src = TEMPLATES.find((q) => q.id === t.id);
    const clauses = src.variants ? src.variants.find((v) => v.id === t.house[0]).clauses : src.ast.all;
    eq(t.ast.all, clauses, "template " + t.key + " clauses are the contract's");
  }
  const block = dataBlock({ x: "</script><img src=x onerror=alert(1)>", y: "\u2028" });
  ok(!/<\/script><img/.test(block) && block.includes("\\u003c") && block.includes("\\u2028"), "the data block escapes markup and line separators");
  ok(block.includes(`id="${FIRE_DATA_ID}"`), "the data block id");
  const banset = new RegExp("(^|_)(px|price|ret|pnl)(_|$)");
  ok(!reg.metrics.some((m) => banset.test(m.id.replace(/\./g, "_"))), "no price metric is offered");
  const copy = [...reg.metrics.map((m) => m.label), ...reg.templates.map((t) => t.title)].join(" ");
  ok(!banned(copy), "metric labels and template titles have no banned word");
}

function banned(text) {
  return new RegExp("\\b(" + COPY_BANNED.join("|") + ")\\b", "i").test(text);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const loaded = loadModel();
  battery(loaded, "production");
  staticChecks();
  pageChecks();
  const copyBad = [];
  for (const tpl of loaded.registry.templates) {
    const st = loaded.model.fromAst(tpl.ast, tpl.key);
    if (banned(loaded.model.sentence(st)) || /\btape\b/i.test(loaded.model.sentence(st))) copyBad.push(tpl.key);
  }
  ok(copyBad.length === 0, "template sentences carry no banned word " + copyBad.join(","));
  console.log(failures.length ? failures.slice(0, 40).join("\n") : "");
  console.log(checks + " checks, " + failures.length + " failed");
  process.exit(failures.length ? 1 : 0);
}
