import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as NS from "../shared/ff-contract.js";
import { FF_SCHEMA_SQL, FF_TABLES } from "../shared/ff-schema.js";
import { ERRORS } from "../server/errors.js";
import { createRouter } from "../server/router.js";
import { productOf, productById, PAYLOAD_CAP_BYTES } from "../shared/flows-products.js";
import { FRESH_CLASSES } from "../shared/flows-freshness.js";
import { TRT_OFFSET_MIN, TRT_LABEL, boundaries } from "../shared/flows-time.js";
import { fixtureNameIn } from "../shared/flows-fixture-names.js";
import { ROOT, trackedFiles } from "./lib/suite-registry.mjs";
import { FF_PLANNED, FF_BUDGET_PARAMS, FF_ROW_COSTS, FF_TABLE_ROW_COSTS, ffRows } from "./lib/d1-budget-ff.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const text = (rel) => readFileSync(new URL(rel, new URL("../", import.meta.url)), "utf8");
const fixtures = JSON.parse(text("tests/fixtures-ff-contract.json"));
const tracked = trackedFiles(ROOT);

const world = () => structuredClone(Object.fromEntries(Object.entries(NS).filter(([, v]) => typeof v !== "function")));
const sha = (s) => createHash("sha256").update(s, "utf8").digest();
const word = (s, w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(s);
const bannedIn = (s, banned) => banned.filter((w) => word(s, w));
const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const multiple = (x, step) => Math.abs(x / step - Math.round(x / step)) < 1e-9;
const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");

const refBase32 = (bytes) => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const pad = (5 - ((bytes.length * 8) % 5)) % 5;
  n <<= BigInt(pad);
  const groups = (bytes.length * 8 + pad) / 5;
  let out = "";
  for (let i = groups - 1; i >= 0; i--) out += "abcdefghijklmnopqrstuvwxyz234567"[Number((n >> BigInt(5 * i)) & 31n)];
  return out;
};

const refZ = ({ x, median, mad, floor }) => {
  const scale = Math.max(1.4826 * mad, floor);
  return { z: (x - median) / scale, floored: 1.4826 * mad < floor };
};
const refT5Upper = (t) => {
  const th = Math.atan(t / Math.sqrt(5));
  return 1 - (0.5 + (1 / Math.PI) * (th + Math.sin(th) * Math.cos(th) * (1 + (2 / 3) * Math.cos(th) ** 2)));
};
const refHealth = ({ phase, liveAgeS, nightlyLate, error }, R) => {
  if (nightlyLate === null || (phase === "open" && liveAgeS === null)) return "unknown";
  if (nightlyLate >= R.nightlyDownLateSessions || (phase === "open" && liveAgeS > R.degradedMaxAgeS)) return "down";
  if (nightlyLate >= R.nightlyDegradedLateSessions || error || (phase === "open" && liveAgeS > R.liveMaxAgeFactor * R.liveCadenceS)) return "degraded";
  return phase === "open" ? "live" : "resting";
};
const refEdge = (v, flaw = null) => {
  const hits = [];
  let phase = "armed";
  let count = 0;
  let sawFalse = false;
  let coolUntil = -Infinity;
  const cool = flaw === "no-cooldown" ? 0 : (v.cooldown || 0) + (flaw === "cooldown-off-by-one" ? 1 : 0);
  const truth = (x) => (v.op === ">=" ? x >= v.x : x <= v.x);
  const holds = (x) => (v.op === ">=" ? x >= v.x - v.h : x <= v.x + v.h);
  v.looks.forEach((x, i) => {
    if (x === null) return;
    const session = v.sessions ? v.sessions[i] : i;
    if (flaw === "level") {
      if (truth(x)) hits.push(i);
      return;
    }
    if (phase === "firing") {
      if (!holds(x)) { phase = "armed"; count = 0; sawFalse = true; }
      return;
    }
    if (!truth(x)) { count = 0; sawFalse = true; return; }
    if (session < coolUntil) {
      if (flaw === "quiet-counts") count += 1;
      return;
    }
    count += 1;
    if (count < v.persist) return;
    if (v.edge === "state" && !sawFalse) return;
    hits.push(i);
    phase = "firing";
    count = 0;
    coolUntil = session + cool;
  });
  return hits;
};
const refLabel = (day, asOfMs) => {
  const b = boundaries(day);
  if (asOfMs < b.open.ms) return "pre-open";
  if (asOfMs === b.close.ms) return "close";
  if (asOfMs > b.close.ms) return "post-close";
  const m = Math.floor((asOfMs - b.open.ms) / 60000);
  return m < 60 ? `open+${m}m` : `open+${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

const RANK = { ready: 0, limited: 1, warming: 2, hidden: 3 };
const VERDICT = { ready: "available", limited: "limited", warming: "warming", hidden: "hidden" };

function astProblems(body, w, { derived = false } = {}) {
  const out = [];
  const add = (code) => out.push(code);
  if (body === null || typeof body !== "object" || Array.isArray(body)) return ["grammar_invalid"];
  const keys = Object.keys(body).sort();
  const want = [...w.AST_GRAMMAR.body, ...(derived ? ["d"] : [])].sort();
  if (JSON.stringify(keys) !== JSON.stringify(want)) {
    add(keys.some((k) => w.AST_GRAMMAR.rejectedFromClient.includes(k)) ? "client_derived_field" : "grammar_invalid");
    return out;
  }
  if (body.v !== w.AST_VERSION) add("grammar_invalid");
  if (w.CADENCES_RESERVED.includes(body.cadence)) add("scope_reserved");
  else if (!w.CADENCES.includes(body.cadence)) add("grammar_invalid");
  const scope = body.scope || {};
  if (w.SCOPE_KINDS_RESERVED.includes(scope.kind)) add("scope_reserved");
  else if (!w.SCOPE_KINDS.includes(scope.kind)) add("grammar_invalid");
  else if (JSON.stringify(Object.keys(scope).sort()) !== JSON.stringify([...w.AST_GRAMMAR.scope[scope.kind]].sort())) add("grammar_invalid");
  if (scope.kind === "names") {
    const s = scope.symbols;
    if (!Array.isArray(s) || s.length < 1 || s.length > w.LIMITS.symbolsMax || new Set(s).size !== s.length || JSON.stringify([...s].sort()) !== JSON.stringify(s)
      || !s.every((x) => new RegExp(w.SYMBOL_RE).test(x))) add("grammar_invalid");
  }
  if (!Array.isArray(body.all) || body.all.length < w.LIMITS.clausesMin || body.all.length > w.LIMITS.clausesMax) { add("grammar_invalid"); return out; }
  const perMetric = {};
  const subjects = new Set();
  const sources = new Set();
  let anomaly = false;
  for (const c of body.all) {
    if (!c || JSON.stringify(Object.keys(c).sort()) !== JSON.stringify([...w.AST_GRAMMAR.clause].sort())) { add("grammar_invalid"); continue; }
    const m = w.METRICS.find((x) => x.id === c.m);
    if (!m) { add("grammar_invalid"); continue; }
    if (!["ready", "limited"].includes(m.status) || !m.cadence.includes(body.cadence)) add("metric_unavailable");
    if (!w.OPS.includes(c.op)) add("grammar_invalid");
    if (typeof c.x !== "number" || !Number.isFinite(c.x) || c.x < m.range[0] || c.x > m.range[1]) add("grammar_invalid");
    else if (!multiple(c.x, w.UNITS[m.unit].xStep)) add("grammar_precision");
    perMetric[c.m] = (perMetric[c.m] || 0) + 1;
    subjects.add(m.subject);
    if (m.kind === "anomaly") anomaly = true;
    const src = m.source[body.cadence];
    if (src) sources.add(src.key);
  }
  if (Object.values(perMetric).some((n) => n > w.LIMITS.clausesPerMetric)) add("grammar_invalid");
  if (subjects.has("sector") && subjects.size > 1) add("grammar_invalid");
  if (body.cadence === "live" && (anomaly || sources.size > 1)) add("grammar_invalid");
  const range = body.cadence === "live" ? w.LIMITS.persistLive : w.LIMITS.persistNightly;
  if (!Number.isInteger(body.persist) || body.persist < range[0] || body.persist > range[1]) add("grammar_invalid");
  const cd = body.cooldown;
  if (!cd || typeof cd !== "object" || JSON.stringify(Object.keys(cd).sort()) !== JSON.stringify([...w.AST_GRAMMAR.cooldown].sort())
    || cd.unit !== w.LIMITS.cooldownUnit || !(w.LIMITS.cooldownChoices[body.cadence] || []).includes(cd.n)) add("grammar_invalid");
  return out;
}

function contractProblems(w, repo) {
  const out = [];
  const bad = (code, detail = "") => out.push(`${code} ${detail}`.trim());
  const uniq = (list) => new Set(list).size === list.length;
  const metricRe = new RegExp(w.METRIC_ID_RE);

  for (const v of [w.FF_CONTRACT_VERSION, w.REGISTRY_VERSION, w.AST_VERSION]) if (!Number.isInteger(v) || v < 1) bad("version");
  for (const name of ["LAYERS", "CADENCES", "CADENCES_RESERVED", "EVALUATORS", "SCOPE_KINDS", "SCOPE_KINDS_RESERVED", "CONTROLS", "CONTROLS_RESERVED",
    "WIRE_STATUS", "HIT_STATE", "HIT_MARK", "HIT_FEEDBACK", "RECEIPT_STATUS", "CONFIRM_STATUS", "RUN_STATUS", "SWITCH_STATE", "SWITCH_SCOPES",
    "ABSENT_REASONS", "RECEIPT_REASONS", "OPS", "COPY_BANNED", "DIGEST_QUADRANTS", "EVIDENCE_REJECT_KEYS", "EXPORT_COLUMNS"]) {
    if (!Array.isArray(w[name]) || !w[name].length || !uniq(w[name])) bad("enum", name);
  }
  if (w.CADENCES.some((c) => w.CADENCES_RESERVED.includes(c))) bad("reserved_overlap", "cadence");
  if (w.SCOPE_KINDS.some((c) => w.SCOPE_KINDS_RESERVED.includes(c))) bad("reserved_overlap", "scope");
  if (w.CONTROLS.some((c) => w.CONTROLS_RESERVED.includes(c))) bad("reserved_overlap", "control");

  for (const [u, spec] of Object.entries(w.UNITS)) {
    if (!(spec.step > 0) || !(spec.xStep > 0) || !multiple(spec.xStep, spec.step)) bad("unit_step", u);
  }
  if (JSON.stringify(Object.keys(w.UNITS).sort()) !== JSON.stringify(["bool", "contracts", "days", "pct", "pctile", "ratio", "sessions", "sigma", "usd", "vol_pt"])) bad("unit_set");
  if (w.UNITS.sigma.step !== 0.01) bad("sigma_step");

  const ids = w.METRICS.map((m) => m.id);
  if (!uniq(ids)) bad("metric_duplicate");
  for (const m of w.METRICS) {
    if (!metricRe.test(m.id)) bad("metric_id", m.id);
    if (!w.UNITS[m.unit]) bad("metric_unit", m.id);
    if (!w.METRIC_SUBJECTS.includes(m.subject)) bad("metric_subject", m.id);
    if (!["fact", "anomaly"].includes(m.kind) || !["state", "event"].includes(m.edge)) bad("metric_kind", m.id);
    if (!m.cadence.length || !m.cadence.every((c) => w.CADENCES.includes(c))) bad("metric_cadence", m.id);
    if (!w.METRIC_STATUS.includes(m.status)) bad("metric_status", m.id);
    if (!(m.range[0] < m.range[1])) bad("metric_range", m.id);
    if (m.id.endsWith(".z20") || m.id.endsWith(".zvov")) {
      if (m.kind !== "anomaly" || m.cadence.join() !== "nightly" || m.nullLaw !== "t5" || !m.baseline) bad("metric_anomaly", m.id);
    } else if (m.kind !== "fact" || m.nullLaw !== null || m.baseline !== null) bad("metric_fact", m.id);
    if (m.baseline && m.baseline.kind === "hist" && (m.baseline.window !== w.LIMITS.baselineWindow || m.baseline.min !== w.LIMITS.baselineMin)) bad("metric_baseline", m.id);
    if (m.kind === "anomaly" && m.edge !== "event") bad("metric_edge", m.id);
    if (m.subject === "sector" && !m.id.startsWith("sector.")) bad("metric_subject_prefix", m.id);
    if (m.subject === "window" && !m.id.startsWith("contract.")) bad("metric_subject_prefix", m.id);
    if (m.status !== "ready" && !m.reason) bad("metric_reason", m.id);
    if ((m.status === "warming" || m.status === "hidden") && !m.unlock) bad("metric_unlock", m.id);
    for (const c of m.cadence) {
      const src = m.source[c];
      if (m.status === "hidden") { if (src) bad("metric_hidden_source", m.id); continue; }
      if (!src) { if (m.status !== "warming") bad("metric_source", `${m.id} ${c}`); continue; }
      if (!(productById(src.key) || repo.knownKeys.includes(src.key))) bad("metric_source_key", `${m.id} ${src.key}`);
    }
    if (m.cadence.includes("live") && m.maxAgeS !== w.STALENESS.tier2S) bad("metric_stale", m.id);
    if (m.maxAgeSessions > w.STALENESS.slowFieldMaxAgeSessions) bad("metric_stale_sessions", m.id);
    if (bannedIn(`${m.label} ${m.reason || ""}`, w.COPY_BANNED).length) bad("metric_copy", m.id);
  }
  if (w.STALENESS.tier2S !== 2 * FRESH_CLASSES.breadth.cadenceS) bad("tier2_stale");
  if (w.STALENESS.tier1S !== 2 * FRESH_CLASSES.market.cadenceS + 120) bad("tier1_stale");

  if (JSON.stringify(w.TEMPLATES.map((t) => t.id)) !== JSON.stringify(["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10"])) bad("template_ids");
  const houseIds = w.TEMPLATES.flatMap((t) => t.house);
  if (!uniq(houseIds) || !houseIds.every((h) => /^h-t\d\d[a-z]?$/.test(h))) bad("house_ids");
  for (const t of w.TEMPLATES) {
    if (bannedIn(`${t.title} ${t.note}`, w.COPY_BANNED).length) bad("template_copy", t.id);
    if (!t.house.every((h) => h.startsWith("h-t" + t.id.slice(1)))) bad("template_house_number", t.id);
    const hidden = t.ast === null;
    if (hidden !== (t.house.length === 0)) bad("template_hidden_house", t.id);
    if (hidden) continue;
    const clauses = t.ast.all;
    const ms = clauses.map((c) => w.METRICS.find((m) => m.id === c.m));
    if (ms.some((m) => !m)) { bad("template_metric", t.id); continue; }
    const derived = ms.some((m) => m.kind === "anomaly") ? "bh" : "fact";
    if (t.control !== derived) bad("template_control", `${t.id} ${t.control} ${derived}`);
    if (t.ast.cadence !== t.cadence) bad("template_cadence", t.id);
    if (!t.ast.cooldown || t.ast.cooldown.n !== w.LIMITS.cooldownDefault[t.cadence]) bad("template_cooldown", t.id);
    if (!ms.every((m) => m.cadence.includes(t.cadence))) bad("template_metric_cadence", t.id);
    if (t.cadence === "live" && t.control !== "fact") bad("template_live_fact", t.id);
    const status = ms.map((m) => m.status).sort((a, b) => RANK[b] - RANK[a])[0];
    const problems = astProblems(t.ast, w);
    if (RANK[status] <= RANK.limited) { if (problems.length) bad("template_ast", `${t.id} ${problems.join()}`); }
    else if (!problems.includes("metric_unavailable")) bad("template_warming_savable", t.id);
    for (const v of t.variants || []) {
      const body = { ...t.ast, all: v.clauses };
      if (astProblems(body, w).length) bad("template_variant", v.id);
      if (!t.house.includes(v.id)) bad("template_variant_house", v.id);
      if (bannedIn(v.sentence, w.COPY_BANNED).length) bad("template_copy", v.id);
    }
    if (t.catchup && (t.cadence !== "live" || ms.some((m) => m.edge !== "event"))) bad("template_catchup", t.id);
  }

  if (!(w.LIMITS.clausesMax <= 8 && w.LIMITS.symbolsMax <= 25 && w.LIMITS.armedMemberWires <= 50 && w.LIMITS.universeMemberWires <= 5)) bad("limits_ceiling");
  if (w.LIMITS.persistNightly[0] < 1 || w.LIMITS.persistLive[1] > 4) bad("limits_persist");
  if (!w.LIMITS.budgetChoices.includes(w.LIMITS.budgetDefault)) bad("limits_budget");
  if (w.LIMITS.evidenceBytes !== 4096 || w.LIMITS.astBytes !== 4096) bad("limits_bytes");
  if (w.LIMITS.baselineMin > w.LIMITS.baselineWindow || w.LIMITS.bhQ !== 0.05 || w.LIMITS.madScale !== 1.4826) bad("limits_stats");
  const cc = w.LIMITS.cooldownChoices;
  if (JSON.stringify(w.LIMITS.cooldownDefault) !== JSON.stringify({ live: 1, nightly: 5 }) || w.LIMITS.cooldownUnit !== "session"
    || JSON.stringify(cc.live) !== JSON.stringify([1]) || !cc.nightly.includes(w.LIMITS.cooldownDefault.nightly)
    || JSON.stringify(cc.nightly) !== JSON.stringify([...cc.nightly].sort((a, b) => a - b)) || !cc.nightly.includes(1)) bad("limits_cooldown");
  const hc = w.LIMITS;
  if (!(hc.hitsPerMemberWirePerSession <= hc.hitsPerMemberPerSession && hc.hitsPerMemberPerSession <= hc.hitsGlobalPerSession)
    || !(hc.hitsPerHouseWirePerSession.nightly >= 1 && hc.hitsPerHouseWirePerSession.live >= 1)) bad("limits_hit_caps");
  if (w.BUDGET.worstHitBytesPerSession !== (hc.hitsGlobalPerSession + hc.hitsPerHouseWirePerSession.nightly * w.TEMPLATES.filter((t) => t.cadence === "nightly").flatMap((t) => t.house).length
    + hc.hitsPerHouseWirePerSession.live * w.TEMPLATES.filter((t) => t.cadence === "live").flatMap((t) => t.house).length) * hc.evidenceBytes) bad("budget_worst_bytes");
  if (w.AST_GRAMMAR.rejectedFromClient.includes("cooldown") || !w.AST_GRAMMAR.body.includes("cooldown")) bad("grammar_cooldown");

  const keysExist = ["states", "pages", "slots", "attributes", "tokens"].every((k) => Array.isArray(w.HOOKS[k]));
  if (!keysExist) bad("hooks_shape");
  else {
    if (!w.HOOKS.attributes.every((a) => /^data-ff-[a-z]+$/.test(a)) || !uniq(w.HOOKS.attributes)) bad("hooks_attributes");
    if (!w.HOOKS.tokens.every((a) => /^--ff-[a-z-]+$/.test(a)) || !uniq(w.HOOKS.tokens)) bad("hooks_tokens");
    if (!Object.keys(w.HOOKS.events).every((e) => /^ff:[a-z]+$/.test(e))) bad("hooks_events");
    if (JSON.stringify(w.HOOKS.states) !== JSON.stringify([...w.HEALTH_STATES, w.HEALTH_UNKNOWN])) bad("hooks_states");
    if (JSON.stringify(w.HOOKS.viewports) !== JSON.stringify([[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [1024, 660], [390, 844], [390, 664]])) bad("hooks_viewports");
    if (w.HOOKS.classPrefix !== "ffx-") bad("hooks_prefix");
    if (!w.HOOKS.flowsUiProperties.every((p) => /^ff[A-Z][A-Za-z]+$/.test(p))) bad("hooks_properties");
    const tokenUsers = w.HOOKS.tokens.filter((t) => !t.startsWith("--ff-")).length;
    if (tokenUsers) bad("hooks_token_prefix");
    if (w.HOOKS.breathes.only !== "live" || w.HOOKS.breathes.reducedMotion !== "never") bad("hooks_breath");
  }
  if (Object.entries(w.HEALTH).some(([s, h]) => h.breathes !== (s === "live"))) bad("health_breath");
  if (JSON.stringify(Object.keys(w.HEALTH)) !== JSON.stringify([...w.HEALTH_STATES, w.HEALTH_UNKNOWN])) bad("health_states");
  for (const v of fixtures.health) if (refHealth(v, w.HEALTH_RULES) !== v.want) bad("health_vector", JSON.stringify(v));

  if (w.TIME.offsetMin !== TRT_OFFSET_MIN || w.TIME.zone !== TRT_LABEL) bad("time_zone");
  const labelRe = new RegExp(w.TIME.sessionLabelRe);
  for (const l of ["pre-open", "open+12m", "open+1h05m", "close", "post-close"]) if (!labelRe.test(l)) bad("label_grammar", l);
  for (const l of ["open+5", "open 12m", "closed", "16:42", "open+1h5m"]) if (labelRe.test(l)) bad("label_grammar_loose", l);
  if (NS.sessionLabelText("16:42", "open+12m") !== "16:42 TRT · open+12m") bad("label_text");

  const rapi = w.ROUTES.api;
  if (!uniq(rapi.map((r) => r.id)) || !uniq(rapi.map((r) => r.path))) bad("route_duplicate");
  for (const r of rapi) {
    if (!/^\/api\/ff\/[a-z]+$/.test(r.path)) bad("route_path", r.path);
    if (!["flows", "none"].includes(r.auth)) bad("route_auth", r.path);
    if (r.auth === "none" && r.id !== "ff-run") bad("route_open", r.path);
  }
  if (w.ROUTES.memberFrom !== "session" || w.ROUTES.family !== "ff") bad("route_member");
  if (rapi.some((r) => /member/i.test(r.note))) bad("route_member_param");
  for (const p of w.ROUTES.pages) {
    if (!/^\/flows\/[a-z]+\/$/.test(p.path)) bad("page_path", p.path);
    if (p.bare !== p.path.slice(0, -1)) bad("page_bare", p.path);
  }
  if (!uniq(w.ROUTES.pages.map((p) => p.path))) bad("page_duplicate");
  for (const e of Object.keys(w.ERROR_CODES)) {
    const entry = repo.errors[e];
    if (!entry) bad("error_missing", e);
    else if (entry[0] !== w.ERROR_CODES[e][0] || entry[1] !== w.ERROR_CODES[e][1]) bad("error_differs", e);
    if (!e.startsWith("ff_")) bad("error_prefix", e);
    if (bannedIn(w.ERROR_CODES[e][1], w.COPY_BANNED).length) bad("error_copy", e);
  }
  for (const k of Object.keys(repo.errors)) if (k.startsWith("ff_") && !w.ERROR_CODES[k]) bad("error_unlisted", k);

  for (const [name, p] of Object.entries(w.PAYLOADS)) {
    if (typeof p !== "object") continue;
    if (!/^ff-[a-z]+$/.test(p.key) || p.maxBytes > PAYLOAD_CAP_BYTES || p.maxBytes > 98304) bad("payload", name);
    if (productOf(p.key)) bad("payload_registered", name);
  }

  const lanes = Object.entries(w.LANES);
  const owned = new Map();
  for (const [letter, lane] of lanes) {
    if (!lane.prefix.startsWith("ff-") || !lane.prefix.endsWith("-")) bad("lane_prefix", letter);
    for (const f of lane.files) {
      if (owned.has(f)) bad("lane_overlap", f);
      owned.set(f, letter);
      if (w.SHARED_EDITS.files.includes(f)) bad("lane_owns_shared", f);
      if (w.PHASE0_FILES.includes(f)) bad("lane_owns_phase0", f);
    }
  }
  if (!uniq(lanes.map(([, l]) => l.prefix))) bad("lane_prefix_overlap");
  if (lanes.some(([, l]) => lanes.some(([, o]) => o !== l && o.prefix.startsWith(l.prefix) && o.prefix !== l.prefix))) bad("lane_prefix_nesting");
  if (w.SHARED_EDITS.owner !== "G") bad("shared_owner");
  const ownerOf = (file) => {
    if (w.PHASE0_FILES.includes(file)) return "phase0";
    if (owned.has(file)) return owned.get(file);
    const base = file.split("/").pop();
    for (const [letter, lane] of lanes) {
      const p = lane.prefix;
      if (new RegExp(`^(tests/(lib/)?${p}[a-z0-9-]*\\.mjs|tests/fixtures-${p}[a-z0-9-]*\\.json|tests/suites/${p}[a-z0-9-]*\\.json|docs/ff/${p}[a-z0-9-]*\\.md)$`).test(file)) return letter;
    }
    if (file === "tests/lib/d1-budget-ff.mjs") return "B";
    if (/^docs\/ff\/[a-z-]+\.md$/.test(file) && base) return "docs";
    return null;
  };
  const namespace = (f) => /(^|\/)(ff-|flows-ff-|fixtures-ff-|d1-budget-ff)/.test(f) || f.startsWith("docs/ff/") || f === "server/routes/flows-ff.js" || /0026_ff\.sql$/.test(f);
  for (const f of repo.tracked.filter(namespace)) if (!ownerOf(f)) bad("unowned_ff_file", f);
  for (const f of w.PHASE0_FILES) if (!repo.tracked.includes(f)) bad("phase0_missing", f);

  for (const f of repo.ffSources) for (const p of forbiddenProblems(f.path, f.text, w)) bad(p, f.path);
  for (const p of docProblems(w, repo.inventory, repo.contractDoc)) bad(p);

  if (w.RECORD.priceScoring !== false) bad("record_price");
  if (!new RegExp(w.SCHEMA_BANNED_COLUMN_RE).test("ref_px") || new RegExp(w.SCHEMA_BANNED_COLUMN_RE).test("session")) bad("price_column_regex");
  if (w.EXPORT_COLUMNS.some((c) => new RegExp(w.SCHEMA_BANNED_COLUMN_RE).test(c))) bad("export_price_column");
  if (w.ID_RULES.evaluatorInKey !== false || w.ID_RULES.hitIdLength !== 20 || w.ID_RULES.clauseHashLength !== 10) bad("id_rules");
  if (new Set(w.ID_RULES.base32).size !== 32) bad("base32");
  return out;
}

const MODEL_BINDINGS = ["AI"];

function forbiddenProblems(file, source, w) {
  const out = [];
  const isTest = file.startsWith("tests/") || file === "shared/ff-contract.js";
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    for (const banned of w.FORBIDDEN.imports) if (spec.split("/").pop() === banned.split("/").pop()) out.push("forbidden_import");
  }
  if (!isTest) {
    for (const t of w.FORBIDDEN.sourceTokens) if (source.includes(t)) out.push("forbidden_token");
    for (const b of MODEL_BINDINGS) if (new RegExp(`\\b(?:env|self|globalThis|this)\\s*\\.\\s*${b}\\b|\\[\\s*["']${b}["']\\s*\\]`).test(source)) out.push("forbidden_token");
    if (/\bfetch\(/.test(source) && !w.FORBIDDEN.fetchAllowedIn.includes(file)) out.push("forbidden_fetch");
  }
  return out;
}

function sqlProblems(statements) {
  const out = [];
  const bad = (c) => out.push(c);
  let db;
  try {
    db = new DatabaseSync(":memory:");
    for (const s of statements) db.exec(s);
  } catch (e) {
    return ["schema_does_not_build " + e.message];
  }
  const fails = (sql, ...args) => { try { db.prepare(sql).run(...args); return false; } catch { return true; } };
  const now = 1780000000000;
  const member = "member01";
  const wire = "w-abcdefghij234567";
  const versionSql = "INSERT INTO ff_wire_version (wire_id, version, template, cadence, scope_kind, control, exp_week, clause_hash, ast_json, ast_hash, sentence, registry_version, effective_session, created_at) VALUES (?,1,'T03','live','universe','fact',0,?,'{}',?,'s',1,'2026-03-09',?)";
  const hex64 = "a".repeat(64);
  if (fails("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, created_at) VALUES (?,?,?,?,?,?,1,?)", wire, "member", member, "t", "armed", now, now)) bad("wire_insert_member");
  if (!fails("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, created_at) VALUES ('w-short','member','member01','t','armed',?,1,?)", now, now)) bad("wire_id_shape_open");
  if (!fails("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, created_at) VALUES ('h-t01','house','member01','t','armed',?,1,?)", now, now)) bad("house_with_member_open");
  if (fails("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, created_at) VALUES ('h-t07a','house',NULL,'t','armed',?,1,?)", now, now)) bad("house_insert");
  if (!fails("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, created_at) VALUES ('h-x01','house',NULL,'t','armed',?,1,?)", now, now)) bad("house_id_shape_open");
  if (fails(versionSql, wire, "0123456789", hex64, now)) bad("version_insert");
  if (!fails("UPDATE ff_wire_version SET sentence = 'x' WHERE wire_id = ?", wire)) bad("version_updatable");
  if (!fails("DELETE FROM ff_wire_version WHERE wire_id = ?", wire)) bad("version_deletable");

  const hit = "INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) " +
    "SELECT ?1, COALESCE((SELECT MAX(seq) FROM ff_hit WHERE stream = ?1), 0) + 1, ?2, ?3, 1, ?4, 'n:AAA', 'AAA', NULL, ?5, '2026-03-09', 'open+12m', ?6, ?6, 'live', 'e1', '{}', 'delivered' " +
    "WHERE NOT EXISTS (SELECT 1 FROM ff_hit WHERE wire_id = ?3 AND dedupe_key = ?7)";
  const put = (stream, id, w, mem, key) => db.prepare(hit).run(stream, id, w, mem, key, now, key).changes;
  const a = put(member, "a".repeat(20), wire, member, "n:AAA:2026-03-09:0123456789");
  const b = put(member, "b".repeat(20), wire, member, "n:BBB:2026-03-09:0123456789");
  const dup = put(member, "c".repeat(20), wire, member, "n:AAA:2026-03-09:0123456789");
  const c = put(member, "d".repeat(20), wire, member, "n:CCC:2026-03-09:0123456789");
  const house = put("house", "e".repeat(20), "h-t07a", null, "n:AAA:2026-03-09");
  if (a !== 1 || b !== 1 || dup !== 0 || c !== 1 || house !== 1) bad("hit_dedupe");
  if (!fails("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES ('member01', 40, ?, ?, 1, 'member01', 'n:AAA', ?, '2026-03-09', 'close', 1, 1, 'nightly', 'e', '{}', 'delivered')", "j".repeat(20), wire, "n:AAA:2026-03-09:0123456789")) bad("hit_dedupe_unique_open");
  const seqs = db.prepare("SELECT stream, seq FROM ff_hit ORDER BY stream, seq").all().map((r) => `${r.stream}:${r.seq}`);
  if (JSON.stringify(seqs) !== JSON.stringify(["house:1", "member01:1", "member01:2", "member01:3"])) bad("hit_seq_not_gapless");
  if (!fails("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES ('house', 2, ?, 'h-t01', 1, 'member01', 'u', 'k', '2026-03-09', 'close', 1, 1, 'nightly', 'e', '{}', 'delivered')", "f".repeat(20))) bad("hit_stream_open");
  if (!fails("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES ('member01', 9, ?, 'h-t01', 1, NULL, 'u', 'k', '2026-03-09', 'close', 1, 1, 'nightly', 'e', '{}', 'delivered')", "g".repeat(20))) bad("hit_member_null_open");
  if (!fails("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES ('house', 9, ?, 'h-t01', 1, NULL, 'u', 'k', '2026-03-09', 'close', 1, 1, 'nightly', 'e', ?, 'delivered')", "h".repeat(20), "x".repeat(4097))) bad("hit_evidence_unbounded");
  if (!fails("UPDATE ff_hit SET evidence_json = '{}' WHERE hit_id = ?", "a".repeat(20))) bad("hit_updatable");
  if (!fails("UPDATE ff_hit SET dedupe_key = 'z' WHERE hit_id = ?", "a".repeat(20))) bad("hit_key_updatable");
  if (!fails("DELETE FROM ff_hit WHERE hit_id = ?", "a".repeat(20))) bad("hit_deletable");
  if (fails("UPDATE ff_hit SET withdrawn_at = 5, withdrawn_reason = 'bad data' WHERE hit_id = ?", "a".repeat(20))) bad("hit_withdraw_blocked");
  if (!fails("UPDATE ff_hit SET withdrawn_at = 5 WHERE hit_id = ?", "b".repeat(20))) bad("hit_withdraw_half_open");
  if (!fails("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES ('house', 7, ?, 'h-t02', 1, NULL, 'u', 'k', '2026-03-09', 'close', 1, 1, 'nightly', 'e', '{}', 'delivered')", "a".repeat(20))) bad("hit_id_not_unique");

  if (!fails("INSERT INTO ff_receipt (wire_id, version, session, status) VALUES ('h-t01', 1, '2026-03-09', 'not_evaluated')")) bad("receipt_silent_failure_open");
  if (fails("INSERT INTO ff_receipt (wire_id, version, session, status, reason) VALUES ('h-t01', 1, '2026-03-09', 'not_evaluated', 'run_late')")) bad("receipt_insert");
  if (!fails("INSERT INTO ff_receipt (wire_id, version, session, status) VALUES ('h-t01', 1, '2026-03-09', 'evaluated')")) bad("receipt_key_open");
  if (!fails("INSERT INTO ff_confirm (hit_id, status, share, reason, filled_at) VALUES (?, 'unobservable', 0, 'absent', 5)", "a".repeat(20))) bad("confirm_zero_open");
  if (fails("INSERT INTO ff_confirm (hit_id, status, share, reason, filled_at) VALUES (?, 'unobservable', NULL, 'absent', 5)", "a".repeat(20))) bad("confirm_insert");
  if (!fails("INSERT INTO ff_record (wire_id, version, period, updated_at) VALUES ('h-t01', 1, '2026-12', 5)")) bad("record_period_open");
  if (fails("INSERT INTO ff_record (wire_id, version, period, updated_at) VALUES ('h-t01', 1, '2026-W11', 5)")) bad("record_insert");
  if (!fails("INSERT INTO ff_member (member_id, budget_b, created_at) VALUES ('member01', 3, 5)")) bad("budget_choice_open");
  if (!fails("INSERT INTO ff_house_off (member_id, wire_id, created_at) VALUES ('member01', 'w-abcdefghij234567', 5)")) bad("house_off_member_wire_open");
  if (!fails("INSERT INTO ff_wire_symbol (member_id, symbol, wire_id) VALUES ('member01', 'aapl', 'w-abcdefghij234567')")) bad("symbol_case_open");
  if (!fails("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('galaxy', 'x', 'on', 'r', 5)")) bad("switch_scope_open");
  if (!fails("INSERT INTO ff_run (id, kind, session, slot, status) VALUES ('nightly:2026-03-09', 'nightly', '2026-03-09', 'N', 'sleeping')")) bad("run_status_open");
  return out;
}

function docProblems(w, inventory, contractDoc) {
  const out = [];
  const bad = (code, detail = "") => out.push(`${code} ${detail}`.trim());
  const invRows = (heading) => {
    const at = inventory.indexOf(heading);
    if (at < 0) return [];
    const blockText = inventory.slice(at).split(/\n## /)[0];
    return blockText.split("\n").filter((l) => /^\| `?[A-Za-z]/.test(l) && !/^\| (Metric id|Template|Store) /.test(l)).map((l) => l.split("|").map((c) => c.trim()).filter(Boolean));
  };
  const invMetric = Object.fromEntries(invRows("## Metric inventory").map((r) => [r[0].replace(/`/g, ""), r[r.length - 1]]));
  if (JSON.stringify(Object.keys(invMetric).sort()) !== JSON.stringify([...w.METRICS.map((m) => m.id)].sort())) bad("inventory_metric_set");
  for (const m of w.METRICS) if (invMetric[m.id] !== VERDICT[m.status]) bad("inventory_metric_status", m.id);
  const invTemplate = Object.fromEntries(invRows("## Templates: what ships").map((r) => [r[0], r[4]]));
  for (const t of w.TEMPLATES) {
    const status = t.ast === null ? "hidden" : t.ast.all.map((c) => (w.METRICS.find((m) => m.id === c.m) || { status: "hidden" }).status).sort((a, b) => RANK[b] - RANK[a])[0];
    if (invTemplate[t.id] !== VERDICT[status]) bad("inventory_template_verdict", t.id);
  }
  const needles = [
    ...w.ROUTES.api.map((r) => r.path), ...w.ROUTES.pages.map((p) => p.path), ...FF_TABLES, ...Object.keys(w.ERROR_CODES), ...w.HOUSE_IDS,
    ...Object.keys(w.LANES).map((l) => `Lane ${l}`), "Lane G", ...w.HOOKS.tokens, ...w.HOOKS.attributes,
    w.PAYLOADS.metrics.key, w.PAYLOADS.carry.key, w.PAYLOADS.calibration.key, ...Object.keys(w.HOOKS.events), w.SWITCHES.master.var, ...w.SWITCHES.routes,
    ...Array.from({ length: 15 }, (_, i) => `**H${i + 1}**`),
  ];
  for (const n of needles) if (!contractDoc.includes(n)) bad("doc_missing", n);
  return out;
}

const repo = () => ({
  knownKeys: ["ff-carry"],
  inventory: text("docs/ff/inventory.md"),
  contractDoc: text("docs/ff/contract.md"),
  errors: ERRORS,
  tracked,
  ffSources: tracked.filter((f) => /^(shared\/ff-|server\/ff-|server\/routes\/flows-ff|scripts\/flows-legs\/ff-|scripts\/flows-nightly\/sections\/ff|assets\/js\/flows-ff-)[\w-]*\.(m?js)$/.test(f))
    .map((path) => ({ path, text: text(path) })),
});

const real = contractProblems(world(), repo());
eq(real, [], "the contract holds");
ok(Object.isFrozen(NS.METRICS) && Object.isFrozen(NS.METRICS[0]) && Object.isFrozen(NS.LIMITS) && Object.isFrozen(NS.ROUTES.api[0]), "the contract is frozen to the leaves");

for (const f of ["shared/ff-contract.js", "shared/ff-schema.js"]) {
  const src = text(f);
  ok(!/^\s*import\s|^\s*export\s[^=]*from\s/m.test(src), `${f} imports nothing: it is a leaf`);
  ok(!/\/\/|\/\*/.test(src.replace(/https?:\/\/\S+/g, "")), `${f} carries no comments`);
  ok(fixtureNameIn(src) === null, `${f} holds no fixture ticker`);
  ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(src), `${f} holds no colour literal`);
}

eq(FF_SCHEMA_SQL.filter((s) => /^CREATE TABLE/.test(s)).map((s) => s.match(/EXISTS (\w+)/)[1]), [...FF_TABLES], "FF_TABLES lists the tables of the DDL in order");
ok(FF_TABLES.every((t) => t.startsWith("ff_")), "every FF table is prefixed");
const migration = text("migrations/0026_ff.sql");
ok(!/--|\/\*/.test(migration), "the migration carries no comments");
const norm = (s) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ ,/g, ",").replace(/;$/, "").trim();
const migrated = migration.split(/;\n/).map((s) => s.trim()).filter(Boolean).map(norm);
eq(migrated, FF_SCHEMA_SQL.map(norm), "the migration is the DDL constant statement for statement");
const schemaSql = text("schema.sql");
for (const s of FF_SCHEMA_SQL) ok(norm(schemaSql).includes(norm(s)), "schema.sql carries: " + s.slice(0, 48));
ok(schemaSql.indexOf("CREATE TABLE IF NOT EXISTS ff_wire ") > schemaSql.indexOf("flows_quarantine"), "schema.sql adds the FF block after the Flows tables");
const db = new DatabaseSync(":memory:");
for (const s of FF_SCHEMA_SQL) db.exec(s);
for (const t of FF_TABLES) {
  for (const col of db.prepare(`PRAGMA table_info(${t})`).all()) {
    ok(!new RegExp(NS.SCHEMA_BANNED_COLUMN_RE).test(col.name), `${t}.${col.name}: no price column of any kind`);
    if (/_at$/.test(col.name)) eq(col.type, "INTEGER", `${t}.${col.name}: a time is epoch milliseconds`);
  }
}
eq(sqlProblems(FF_SCHEMA_SQL), [], "the tables enforce their rules: dedupe, gapless seq per stream, frozen hits and versions, closed enums");

const idv = fixtures.ids;
eq(refBase32(sha("abc")).slice(0, 20), idv.base32.base32, "base32 of sha256(abc) is the RFC 4648 text");
eq(NS.base32Lower(sha("abc")), refBase32(sha("abc")), "the contract's base32 equals the BigInt reference");
for (const k of idv.keys) {
  const key = NS.dedupeKey({ layer: k.layer, subject: k.subject, session: k.session, clauseHash: k.clauseHash, revision: k.revision });
  eq(key, k.key, "dedupe key: " + k.key);
  const wire = k.layer === "house" ? (k.subject.startsWith("s:") ? "h-t08" : "h-t05") : idv.memberWire;
  eq(refBase32(sha(wire + "|" + key)).slice(0, 20), k.hitId, "hit id: " + k.hitId);
  eq(NS.hitIdInput(wire, key), wire + "|" + key, "hit id input");
}
eq(NS.clauseCanon(idv.clauses), idv.clauseCanon, "clause canon");
eq(NS.clauseCanon(idv.reversed), idv.clauseCanon, "clause order does not move the clause canon");
eq(sha(NS.clauseCanon(idv.clauses)).toString("hex").slice(0, 10), idv.clauseHash, "clause hash");
eq(sha(NS.canonicalJson(idv.bodyDerived)).toString("hex"), idv.astHash, "ast hash");
ok(NS.canonicalJson({ b: 1, a: 2 }) === NS.canonicalJson({ a: 2, b: 1 }), "key order does not move the canonical JSON");
for (const v of fixtures.canonical) eq(NS.canonicalJson(v.value), v.want, "canonical JSON " + v.want);
for (const bad of [() => NS.canonicalJson({ x: NaN }), () => NS.canonicalJson({ x: Infinity }), () => NS.subjectKey("n", "A:B"), () => NS.subjectKey("n", "A|B"), () => NS.subjectKey("c", "A", ""),
  () => NS.dedupeKey({ layer: "member", subject: "n:A", session: "2026-03-09" }), () => NS.dedupeKey({ layer: "house", subject: "n:A", session: "2026-03-09", clauseHash: "0123456789" }),
  () => NS.dedupeKey({ layer: "house", subject: "n:A", session: "2026-03-09", revision: 1000 }), () => NS.dedupeKey({ layer: "house", subject: "n:A", session: "20260309" })]) {
  assert.throws(bad); checks++;
}
eq(NS.subjectKey("u"), "u", "the universe subject");

for (const v of fixtures.robust) {
  const r = refZ(v);
  ok(Math.abs(r.z - v.z) < 5e-5, "robust z " + v.name);
  eq(r.floored, v.floored, "floored " + v.name);
  const shown = Math.round(r.z * 100) / 100;
  eq(shown, v.shown, "displayed " + v.name);
  eq(shown >= 3, v.fires, "fires " + v.name);
}
for (const v of fixtures.t5) ok(Math.abs(refT5Upper(v.t) - v.upper) < 1e-4, "t5 tail at " + v.t);
for (const v of fixtures.edge) eq(refEdge(v), v.hitsAt, "edge: " + v.name);
for (const flaw of ["level", "no-cooldown", "quiet-counts", "cooldown-off-by-one"]) {
  ok(fixtures.edge.some((v) => JSON.stringify(refEdge(v, flaw)) !== JSON.stringify(v.hitsAt)), `the edge vectors tell a "${flaw}" state machine from the ruled one`);
}
ok(fixtures.edge.filter((v) => v.cooldown).length >= 6, "the cooldown has its own vectors");
for (const v of fixtures.sessions) {
  const b = boundaries(v.day);
  eq([b.open.trt, b.close.trt], [v.openTrt, v.closeTrt], "session boundaries in TRT on " + v.day);
}
for (const v of fixtures.labels) eq(refLabel(v.day, Date.parse(v.asOf)), v.label, "session label " + v.label);
for (const v of fixtures.labels) ok(new RegExp(NS.TIME.sessionLabelRe).test(v.label), "label grammar " + v.label);
{
  const rows = NS.ROUTES.api.map((r) => ({ id: r.id, path: r.path, methods: r.methods, auth: r.auth, handler: () => null }));
  const router = createRouter(rows);
  eq(router.rows.length, NS.ROUTES.api.length, "the real router accepts every FF row");
}

const bud = ffRows();
for (const p of FF_PLANNED) {
  const key = p.id.split(".")[1];
  eq([p.written, p.read], bud[key], p.id + " is derived from the declared parameters");
  ok(p.id.startsWith("ff.") && typeof p.row === "string" && p.source.length > 60, p.id + " names its row and its source");
}
eq(FF_PLANNED.length, 4, "four FF budget rows");
ok(FF_BUDGET_PARAMS.wiresPerMember <= NS.LIMITS.armedMemberWires && FF_BUDGET_PARAMS.symbolsPerWire <= NS.LIMITS.symbolsMax, "the budget plans inside the limits");
eq(FF_BUDGET_PARAMS.houseWires, NS.HOUSE_IDS.length, "the budget counts the house wires the contract registers");
eq(FF_BUDGET_PARAMS.hitsNightlyHouse, 80, "the nightly house hits are the caps of the eight nightly house wires");
ok(FF_BUDGET_PARAMS.hitsLiveHouse === NS.LIMITS.hitsPerHouseWirePerSession.live, "and the live house hits are the cap of the live house wire");
ok(FF_PLANNED.reduce((n, p) => n + p.written, 0) < 3300 && FF_PLANNED.reduce((n, p) => n + p.read, 0) < 100000, "Fire & Forget stays inside the headroom the daily ledger leaves it");

const tableCosts = (statements) => {
  const mem = new DatabaseSync(":memory:");
  for (const sql of statements) mem.exec(sql);
  const wr = new Map(mem.prepare("PRAGMA table_list").all().map((r) => [r.name, r.wr === 1]));
  return Object.fromEntries(FF_TABLES.map((t) => [t, 1 + mem.prepare(`PRAGMA index_list(${t})`).all().filter((i) => !(wr.get(t) && i.origin === "pk")).length]));
};
eq(tableCosts(FF_SCHEMA_SQL), FF_TABLE_ROW_COSTS, "rows written per insert, derived from the DDL (the row plus every index entry), are the costs the budget prices");
eq([FF_ROW_COSTS.hit, FF_ROW_COSTS.receipt, FF_ROW_COSTS.record, FF_ROW_COSTS.state, FF_ROW_COSTS.confirm, FF_ROW_COSTS.runWrite, FF_ROW_COSTS.archiveInsert],
  [FF_TABLE_ROW_COSTS.ff_hit, FF_TABLE_ROW_COSTS.ff_receipt, FF_TABLE_ROW_COSTS.ff_record, FF_TABLE_ROW_COSTS.ff_state, FF_TABLE_ROW_COSTS.ff_confirm, FF_TABLE_ROW_COSTS.ff_run, FF_TABLE_ROW_COSTS.ff_arch],
  "and the per-event costs are those table costs");
const costPlant = (name, mutate) => {
  const statements = [...FF_SCHEMA_SQL];
  mutate(statements);
  ok(JSON.stringify(tableCosts(statements)) !== JSON.stringify(FF_TABLE_ROW_COSTS), `planted wrong schema "${name}" changes a priced row cost`);
};
costPlant("an index nobody priced on receipts", (s) => s.push("CREATE INDEX IF NOT EXISTS ff_receipt_by_status ON ff_receipt (status)"));
costPlant("hits as a rowid table", (s) => { const i = s.findIndex((x) => /CREATE TABLE IF NOT EXISTS ff_hit \(/.test(x)); s[i] = s[i].replace(" WITHOUT ROWID", ""); });
costPlant("receipts as a rowid table", (s) => { const i = s.findIndex((x) => /CREATE TABLE IF NOT EXISTS ff_receipt \(/.test(x)); s[i] = s[i].replace(" WITHOUT ROWID", ""); });
costPlant("the run index back", (s) => s.push("CREATE INDEX IF NOT EXISTS ff_run_by_kind ON ff_run (kind, finished_at)"));
costPlant("the layer index back", (s) => s.push("CREATE INDEX IF NOT EXISTS ff_wire_by_layer ON ff_wire (layer, status)"));

const plant = (name, mutate, expect) => {
  const w = world();
  const r = repo();
  mutate(w, r);
  const found = contractProblems(w, r);
  ok(found.some((p) => p.startsWith(expect)), `planted wrong build "${name}" is caught as ${expect}; got ${JSON.stringify(found.slice(0, 3))}`);
};
const metric = (w, id) => w.METRICS.find((m) => m.id === id);
const tmpl = (w, id) => w.TEMPLATES.find((t) => t.id === id);

plant("a duplicated metric id", (w) => { w.METRICS.push(structuredClone(w.METRICS[0])); }, "metric_duplicate");
plant("a metric id with a unit spelling", (w) => { metric(w, "flow.net_premium").id = "flow.net_premium_usd.lvl"; }, "metric_id");
plant("an anomaly metric that is not nightly", (w) => { metric(w, "flow.net_premium.z20").cadence = ["nightly", "live"]; }, "metric_anomaly");
plant("a live z form", (w) => { metric(w, "flow.volume.z20").cadence = ["live"]; }, "metric_anomaly");
plant("a fact metric with a null law", (w) => { metric(w, "earn.sessions").nullLaw = "t5"; }, "metric_fact");
plant("a z metric on a 10-session window", (w) => { metric(w, "flow.net_premium.z20").baseline.window = 10; }, "metric_baseline");
plant("a hidden metric that still has a source", (w) => { metric(w, "desk.win_cc").source.nightly = { key: "card", path: "x" }; }, "metric_hidden_source");
plant("a warming metric with no reason", (w) => { metric(w, "flow.put_premium").reason = null; }, "metric_reason");
plant("a hidden metric with no unlock", (w) => { metric(w, "oi.strike_share").unlock = null; }, "metric_unlock");
plant("a metric read from a key nobody holds", (w) => { metric(w, "earn.sessions").source.nightly = { key: "nowhere", path: "x" }; }, "metric_source_key");
plant("a live metric that goes stale at the wrong age", (w) => { metric(w, "contract.dte").maxAgeS = 90; }, "metric_stale");
plant("a banned word in a label", (w) => { metric(w, "contract.premium").label = "bullish window premium"; }, "metric_copy");
plant("the word tape in a reason", (w) => { metric(w, "vol.rr25.30d").reason = "read from the tape"; }, "metric_copy");
plant("a sigma step of 0.1", (w) => { w.UNITS.sigma.step = 0.1; }, "sigma_step");
plant("a threshold step that is not a multiple", (w) => { w.UNITS.usd.xStep = 1500; }, "unit_step");
plant("a unit outside the closed set", (w) => { w.UNITS.bps = { step: 1, xStep: 1 }; }, "unit_set");
plant("T01 without the BH control", (w) => { tmpl(w, "T01").control = "fact"; }, "template_control");
plant("a live template with an anomaly clause", (w) => { tmpl(w, "T03").ast.all.push({ m: "flow.net_premium.z20", op: ">=", x: 3 }); tmpl(w, "T03").control = "bh"; }, "template_live_fact");
plant("a template threshold off the step", (w) => { tmpl(w, "T01").ast.all[0].x = 3.1; }, "template_ast");
plant("a template clause on a metric that does not exist", (w) => { tmpl(w, "T06").ast.all[0].m = "vol.skew.flip"; }, "template_metric");
plant("T09 given an AST", (w) => { tmpl(w, "T09").ast = tmpl(w, "T06").ast; }, "template_hidden_house");
plant("a house id from the wrong template", (w) => { tmpl(w, "T05").house = ["h-t06"]; }, "template_house_number");
plant("an inventory that calls a warming template available", (w, r) => { r.inventory = r.inventory.replace(/(\| T04 \|[^\n]*\| )warming( \|)/, "$1available$2"); }, "inventory_template_verdict");
plant("an inventory that calls a hidden metric ready", (w, r) => { r.inventory = r.inventory.replace(/(\| `desk\.win_cc` \|[^\n]*\| )hidden( \|?)/, "$1available$2"); }, "inventory_metric_status");
plant("an inventory that forgets a metric", (w, r) => { r.inventory = r.inventory.replace(/\n\| `flow\.volume\.z20` [^\n]*/, ""); }, "inventory_metric_set");
plant("a contract document that forgets a table", (w, r) => { r.contractDoc = r.contractDoc.split("ff_confirm").join("ff_c"); }, "doc_missing");
plant("a contract document that forgets an acceptance test", (w, r) => { r.contractDoc = r.contractDoc.replace("**H13**", "H13"); }, "doc_missing");
plant("a missing template", (w) => { w.TEMPLATES.pop(); }, "template_ids");
plant("an or in T07 expressed as one clause list", (w) => { tmpl(w, "T07").variants[0].clauses.push({ m: "earn.implied_ratio", op: "<=", x: 0.7 }); tmpl(w, "T07").variants[0].clauses.push({ m: "earn.implied_ratio", op: ">=", x: 1.5 }); }, "template_variant");
plant("a catch-up pass on a state metric", (w) => { tmpl(w, "T03").ast.all.push({ m: "earn.sessions", op: "<=", x: 10 }); }, "template_catchup");
plant("a limit above the ruled ceiling", (w) => { w.LIMITS.clausesMax = 12; }, "limits_ceiling");
plant("a budget choice outside 1, 2, 5", (w) => { w.LIMITS.budgetDefault = 3; }, "limits_budget");
plant("evidence beyond 4 KiB", (w) => { w.LIMITS.evidenceBytes = 8192; }, "limits_bytes");
plant("a FDR level other than 5 per cent", (w) => { w.LIMITS.bhQ = 0.1; }, "limits_stats");
plant("a resting mark that breathes", (w) => { w.HEALTH.resting.breathes = true; }, "health_breath");
plant("a health rule that waits too long", (w) => { w.HEALTH_RULES.liveMaxAgeFactor = 3; }, "health_vector");
plant("a missing unknown state", (w) => { delete w.HEALTH.unknown; }, "health_states");
plant("a TRT offset of two hours", (w) => { w.TIME.offsetMin = 120; }, "time_zone");
plant("a session label without its unit", (w) => { w.TIME.sessionLabelRe = "^(pre-open|open\\+\\d+|close|post-close)$"; }, "label_grammar_loose");
plant("a route with a path parameter", (w) => { w.ROUTES.api[1].path = "/api/ff/wires/:id"; }, "route_path");
plant("a route that takes the member from the request", (w) => { w.ROUTES.api[2].note = "pass member in the query"; }, "route_member_param");
plant("an open route that is not the run route", (w) => { w.ROUTES.api[0].auth = "none"; }, "route_open");
plant("two routes on one path", (w) => { w.ROUTES.api[1].path = w.ROUTES.api[0].path; }, "route_duplicate");
plant("an error code missing from the table", (w) => { w.ERROR_CODES.ff_new_thing = [400, "New"]; }, "error_missing");
plant("an error status that differs", (w) => { w.ERROR_CODES.ff_wire_not_found = [400, "No such wire"]; }, "error_differs");
plant("an unlisted error code in the table", (w, r) => { r.errors = { ...r.errors, ff_extra: [400, "Extra"] }; }, "error_unlisted");
plant("a payload key that is already registered", (w) => { w.PAYLOADS.metrics.key = "universe"; }, "payload");
plant("a payload over the 96 KiB ceiling", (w) => { w.PAYLOADS.metrics.maxBytes = 120000; }, "payload");
plant("a file owned by two lanes", (w) => { w.LANES.B.files.push(w.LANES.A.files[0]); }, "lane_overlap");
plant("a lane that owns a shared file", (w) => { w.LANES.D.files.push("worker.js"); }, "lane_owns_shared");
plant("two lanes with one prefix", (w) => { w.LANES.E.prefix = w.LANES.D.prefix; }, "lane_prefix_overlap");
plant("an unowned file in the FF namespace", (w, r) => { r.tracked = [...r.tracked, "assets/js/flows-ff-rogue.js"]; }, "unowned_ff_file");
plant("an unowned test in the FF namespace", (w, r) => { r.tracked = [...r.tracked, "tests/ff-x-rogue.mjs"]; }, "unowned_ff_file");
plant("a missing Phase 0 file", (w, r) => { r.tracked = r.tracked.filter((f) => f !== "docs/ff/inventory.md"); }, "phase0_missing");
plant("a lane file that imports the vendor client", (w, r) => { r.ffSources = [{ path: "server/ff-eval.js", text: 'import { uwFetch } from "../shared/flows-vendor-core.js";\n' }]; }, "forbidden_import");
plant("a lane file that calls fetch", (w, r) => { r.ffSources = [{ path: "shared/ff-engine.js", text: "const r = await fetch(url);\n" }]; }, "forbidden_fetch");
plant("a lane file that touches the model binding", (w, r) => { r.ffSources = [{ path: "server/ff-preview.js", text: "const x = env.AI;\n" }]; }, "forbidden_token");
plant("a lane file that reads the model binding by key", (w, r) => { r.ffSources = [{ path: "server/ff-preview.js", text: "const x = env[\"AI\"];\n" }]; }, "forbidden_token");
plant("a lane file that asks the capped model helper", (w, r) => { r.ffSources = [{ path: "server/ff-records.js", text: "await cappedAi(env, null, {});\n" }]; }, "forbidden_token");
plant("a price column in the record", (w) => { w.RECORD.priceScoring = true; }, "record_price");
plant("a price column in the export", (w) => { w.EXPORT_COLUMNS.push("ref_px"); }, "export_price_column");
plant("the evaluator in the hit key", (w) => { w.ID_RULES.evaluatorInKey = true; }, "id_rules");
plant("a 15-character hit id", (w) => { w.ID_RULES.hitIdLength = 15; }, "id_rules");
plant("a repeated base32 letter", (w) => { w.ID_RULES.base32 = "b" + w.ID_RULES.base32.slice(1); }, "base32");
plant("a hook attribute off the namespace", (w) => { w.HOOKS.attributes.push("data-flows-x"); }, "hooks_attributes");
plant("a token off the namespace", (w) => { w.HOOKS.tokens.push("--flows-live"); }, "hooks_tokens");
plant("a missing viewport", (w) => { w.HOOKS.viewports.pop(); }, "hooks_viewports");
plant("a nightly default cooldown of one session", (w) => { w.LIMITS.cooldownDefault.nightly = 1; }, "limits_cooldown");
plant("a live default cooldown of five sessions", (w) => { w.LIMITS.cooldownDefault.live = 5; }, "limits_cooldown");
plant("a cooldown choice outside the list", (w) => { w.LIMITS.cooldownDefault.nightly = 7; }, "limits_cooldown");
plant("a live cooldown that spans sessions", (w) => { w.LIMITS.cooldownChoices.live = [1, 2]; }, "limits_cooldown");
plant("a house wire with no hit cap", (w) => { w.LIMITS.hitsPerHouseWirePerSession.nightly = 0; }, "limits_hit_caps");
plant("a member cap above the global fuse", (w) => { w.LIMITS.hitsPerMemberPerSession = 900; }, "limits_hit_caps");
plant("a worst-case size that forgets the house wires", (w) => { w.BUDGET.worstHitBytesPerSession = 500 * 4096; }, "budget_worst_bytes");
plant("a cooldown the client may not send", (w) => { w.AST_GRAMMAR.rejectedFromClient.push("cooldown"); }, "grammar_cooldown");
plant("a template without its default cooldown", (w) => { delete tmpl(w, "T01").ast.cooldown; }, "template_cooldown");
plant("a template with a cooldown of the other cadence", (w) => { tmpl(w, "T03").ast.cooldown.n = 5; }, "template_cooldown");
plant("a page path without its trailing slash", (w) => { w.ROUTES.pages[0].path = "/flows/fire"; }, "page_path");
plant("a page whose bare form is another page", (w) => { w.ROUTES.pages[0].bare = "/flows/inbox"; }, "page_bare");
plant("a mark that breathes under reduced motion", (w) => { w.HOOKS.breathes.reducedMotion = "allowed"; }, "hooks_breath");

const sqlPlant = (name, mutate, expect) => {
  const statements = [...FF_SCHEMA_SQL];
  mutate(statements);
  const found = sqlProblems(statements);
  ok(found.some((p) => p.startsWith(expect)), `planted wrong schema "${name}" is caught as ${expect}; got ${JSON.stringify(found.slice(0, 3))}`);
};
const drop = (re) => (s) => { const i = s.findIndex((x) => re.test(x)); s.splice(i, 1); };
const swap = (re, from, to) => (s) => { const i = s.findIndex((x) => re.test(x)); s[i] = s[i].replace(from, to); };
sqlPlant("a hit table that can be updated", drop(/TRIGGER IF NOT EXISTS ff_hit_frozen/), "hit_updatable");
sqlPlant("a hit table that can be deleted", drop(/TRIGGER IF NOT EXISTS ff_hit_kept/), "hit_deletable");
sqlPlant("a version table that can be updated", drop(/TRIGGER IF NOT EXISTS ff_wire_version_frozen/), "version_updatable");
sqlPlant("a version table that can be deleted", drop(/TRIGGER IF NOT EXISTS ff_wire_version_kept/), "version_deletable");
sqlPlant("a hit without a unique dedupe key", swap(/CREATE TABLE IF NOT EXISTS ff_hit \(/, "UNIQUE (wire_id, dedupe_key), ", ""), "hit_dedupe_unique_open");
sqlPlant("a hit id that is not unique", swap(/CREATE TABLE IF NOT EXISTS ff_hit \(/, "UNIQUE (hit_id), ", ""), "hit_id_not_unique");
sqlPlant("a hit that may name another stream", swap(/CREATE TABLE IF NOT EXISTS ff_hit \(/, "CHECK ((member_id IS NULL AND stream = 'house') OR (member_id IS NOT NULL AND stream = member_id)), ", ""), "hit_stream_open");
sqlPlant("a hit with unbounded evidence", swap(/CREATE TABLE IF NOT EXISTS ff_hit \(/, "CHECK (length(evidence_json) <= 4096)", "CHECK (length(evidence_json) >= 0)"), "hit_evidence_unbounded");
sqlPlant("a withdrawal that needs no reason", swap(/CREATE TABLE IF NOT EXISTS ff_hit \(/, ", CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL))", ""), "hit_withdraw_half_open");
sqlPlant("a frozen trigger that also blocks withdrawal", swap(/TRIGGER IF NOT EXISTS ff_hit_frozen/, "state ON ff_hit", "state, withdrawn_at, withdrawn_reason ON ff_hit"), "hit_withdraw_blocked");
sqlPlant("a house wire with a member", swap(/CREATE TABLE IF NOT EXISTS ff_wire \(/, "layer = 'house' AND member_id IS NULL AND", "layer = 'house' AND"), "house_with_member_open");
sqlPlant("a member wire id of any shape", swap(/CREATE TABLE IF NOT EXISTS ff_wire \(/, "length(id) = 18 AND ", ""), "wire_id_shape_open");
sqlPlant("a receipt that can fail silently", swap(/CREATE TABLE IF NOT EXISTS ff_receipt \(/, ", CHECK (status = 'evaluated' OR reason IS NOT NULL)", ""), "receipt_silent_failure_open");
sqlPlant("a confirmation that counts unobservable as zero", swap(/CREATE TABLE IF NOT EXISTS ff_confirm \(/, ", CHECK (status = 'confirmed' OR status = 'not_confirmed' OR (share IS NULL AND reason IS NOT NULL))", ""), "confirm_zero_open");
sqlPlant("a record period of any text", swap(/CREATE TABLE IF NOT EXISTS ff_record \(/, "period = 'all' OR period GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'", "length(period) > 0"), "record_period_open");
sqlPlant("a budget of any size", swap(/CREATE TABLE IF NOT EXISTS ff_member \(/, "budget_b IN (1, 2, 5)", "budget_b > 0"), "budget_choice_open");
sqlPlant("a run with any status", swap(/CREATE TABLE IF NOT EXISTS ff_run \(/, "status IN ('pending', 'running', 'done', 'failed', 'superseded')", "length(status) > 0"), "run_status_open");
sqlPlant("a switch scope of any name", swap(/CREATE TABLE IF NOT EXISTS ff_switches \(/, "scope IN ('evaluator', 'template', 'house', 'wire', 'member', 'channel')", "length(scope) > 0"), "switch_scope_open");
sqlPlant("a table that does not build", swap(/CREATE TABLE IF NOT EXISTS ff_mute \(/, "PRIMARY KEY (member_id, symbol)", "PRIMARY KEY (member_id, nowhere)"), "schema_does_not_build");

const ast0 = () => structuredClone(NS.TEMPLATES.find((t) => t.id === "T03").ast);
const astPlant = (name, mutate, expect, derived = false) => {
  const body = ast0();
  mutate(body);
  ok(astProblems(body, world(), { derived }).includes(expect), `planted wrong wire "${name}" is refused as ${expect}`);
};
eq(astProblems(ast0(), world()), [], "the T03 default is a valid live wire");
astPlant("a client that sends control", (b) => { b.control = "fact"; }, "client_derived_field");
astPlant("a client that sends the hysteresis", (b) => { b.h = 0.5; }, "client_derived_field");
astPlant("a cooldown the member cannot choose", (b) => { b.cooldown = { unit: "session", n: 3 }; }, "grammar_invalid");
astPlant("a cooldown of zero sessions", (b) => { b.cooldown = { unit: "session", n: 0 }; }, "grammar_invalid");
astPlant("a cooldown counted in minutes", (b) => { b.cooldown = { unit: "minute", n: 5 }; }, "grammar_invalid");
astPlant("a bare cooldown number", (b) => { b.cooldown = 5; }, "grammar_invalid");
astPlant("a missing cooldown", (b) => { delete b.cooldown; }, "grammar_invalid");
astPlant("a live wire that stays quiet for five sessions", (b) => { b.cooldown = { unit: "session", n: 5 }; }, "grammar_invalid");
astPlant("a cooldown with a stray key", (b) => { b.cooldown = { unit: "session", n: 1, until: "2026-03-09" }; }, "grammar_invalid");
astPlant("a delivery list", (b) => { b.deliver = ["inbox"]; }, "client_derived_field");
astPlant("a threshold off the step", (b) => { b.all[0].x = 20.5; }, "grammar_precision");
astPlant("a threshold above the range", (b) => { b.all[1].x = 5000; }, "grammar_invalid");
astPlant("an operator outside the three", (b) => { b.all[0].op = "<"; }, "grammar_invalid");
astPlant("a metric that is warming", (b) => { b.all.push({ m: "flow.put_premium", op: ">=", x: 2000000 }); }, "metric_unavailable");
astPlant("a hidden metric", (b) => { b.all.push({ m: "desk.win_cc", op: ">=", x: 70 }); }, "metric_unavailable");
astPlant("a nightly metric in a live wire", (b) => { b.all.push({ m: "earn.sessions", op: "<=", x: 10 }); }, "metric_unavailable");
astPlant("an anomaly in a live wire", (b) => { b.all.push({ m: "flow.net_premium.z20", op: ">=", x: 3 }); }, "metric_unavailable");
astPlant("three clauses on one metric", (b) => { b.all.push({ m: "contract.dte", op: ">=", x: 1 }, { m: "contract.dte", op: ">=", x: 2 }); }, "grammar_invalid");
astPlant("nine clauses", (b) => { for (let i = 0; i < 6; i++) b.all.push({ m: i % 2 ? "contract.premium" : "contract.vol_oi", op: ">=", x: i + 1 }); }, "grammar_invalid");
astPlant("an empty clause list", (b) => { b.all = []; }, "grammar_invalid");
astPlant("the rail cadence", (b) => { b.cadence = "rail"; }, "scope_reserved");
astPlant("a watchlist scope", (b) => { b.scope = { kind: "watchlist" }; }, "scope_reserved");
astPlant("unsorted symbols", (b) => { b.scope = { kind: "names", symbols: ["BBB", "AAA"] }; }, "grammar_invalid");
astPlant("twenty-six symbols", (b) => { b.scope = { kind: "names", symbols: Array.from({ length: 26 }, (_, i) => "A" + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26))).sort() }; }, "grammar_invalid");
astPlant("a lowercase symbol", (b) => { b.scope = { kind: "names", symbols: ["aapl"] }; }, "grammar_invalid");
astPlant("persistence above the live ceiling", (b) => { b.persist = 5; }, "grammar_invalid");
astPlant("a sector metric mixed with a ticker metric", (b) => { b.cadence = "nightly"; b.all = [{ m: "sector.breadth_pos", op: ">=", x: 0.6 }, { m: "earn.sessions", op: "<=", x: 10 }]; }, "grammar_invalid");
astPlant("a derived block from the client", (b) => { b.d = { rv: 1 }; }, "grammar_invalid");

ok(!/\/\/|\/\*/.test(text("tests/ff-contract.mjs").replace(/https?:\/\/\S+/g, "")), "this suite carries no comments");

console.log(`ff-contract: ${checks} checks passed`);
