import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { loadMutated } from "./truth/mutants.mjs";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import * as LEG from "../scripts/flows-legs/flowlab.mjs";
import * as SECTION from "../scripts/flows-nightly/sections/flowlab.mjs";
import { STAGES } from "../scripts/flows-nightly/stages.mjs";
import { validate } from "../shared/flows-contracts.js";
import { productById } from "../shared/flows-products.js";
import { FLOWLAB_KEYS as KEYS } from "../scripts/flows-legs/flowlab.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-flowlab.json"), "utf8"));
const N = FX.worlds.normal;

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SESSION = FX.session;
const AT = "2026-10-23T21:45:00.000Z";

function vendorOf(world = N, { refuse = [], calls = [], screener = null } = {}) {
  return async (p, q) => {
    calls.push({ path: p, params: q });
    if (p === "/api/option-trades/optionable-tickers") return world["optionable-roots"];
    if (p.startsWith("/api/option-trades/exchange-breakdown/")) return q.by_trade_code ? world["exchange-breakdown-codes"] : world["exchange-breakdown"];
    if (p === "/api/screener/option-contracts") return screener || world["contract-screener"];
    if (p.startsWith("/api/group-flow/")) {
      const g = decodeURIComponent(p.split("/")[3]);
      if (refuse.includes(g)) throw new Error(p + " -> HTTP 403");
      return world["group-greek-flow-expiry"];
    }
    if (p === "/api/analytics/window") return world["analytics-window"];
    if (p === "/api/analytics/sliding") return world["analytics-sliding"];
    throw new Error(p + " -> HTTP 404");
  };
}

const ALERTS = [{ t: "SPY", prem: 5e6 }, { t: "SYX101", prem: 4e6 }, { t: "SYX202", prem: 3e6 }, { t: "SYX101", prem: 1e6 }];

async function battery(leg, section) {
  const bad = [];
  const need = (cond, tag) => { if (!cond) bad.push(tag); };
  const safe = async (tag, f) => { try { await f(); } catch (e) { bad.push(tag + " threw " + String(e && e.message).slice(0, 120)); } };

  await safe("plan", async () => {
    const calls = [];
    const out = await leg.readFlowlab({ vendor: vendorOf(N, { calls }), sessionDate: SESSION, generatedAt: AT, cap: 40, env: {}, alertRows: ALERTS });
    need(out.calls === 30 && calls.length === 30, "plan: roots 1, venues 1, screen 3 and 25 groups make 30 calls (" + out.calls + ")");
    need(Object.keys(out.payloads).sort().join() === [...KEYS].sort().join(), "plan: five keys built");
    need(out.payloads["flowlab-corr"].status === "off", "plan: the correlation key says off while the switch is off");
    need(calls.every((c) => !c.path.startsWith("/api/analytics")), "plan: analytics read with the switch off");
    need(out.detail.flCalls === 30 && out.detail.flSkipped === 0, "plan: detail names calls and skips");
    for (const key of KEYS) {
      const v = validate(key, { ...out.payloads[key], fixture: true }, { allowSynthetic: true });
      need(v.ok, "plan: " + key + " validates (" + JSON.stringify(v.structural) + ")");
      need(JSON.stringify(out.payloads[key]).length <= productById(key).capBytes, "plan: " + key + " is under its cap");
      need(out.payloads[key].session === SESSION && out.payloads[key].sessionDate === SESSION && out.payloads[key].v === 1, "plan: " + key + " carries its session");
    }
    const roots = out.payloads["flowlab-roots"];
    need(roots.list === "SYX101|SYX202|SYX303|SYX404|SYX505" && roots.n === 5, "plan: roots are the sorted unique list");
    const first = calls[0];
    need(first.path === "/api/option-trades/optionable-tickers", "plan: roots are read first");
    need(calls[1].path === `/api/option-trades/exchange-breakdown/${SESSION}` && !("by_trade_code" in calls[1].params) && calls.filter((c) => c.path.startsWith("/api/option-trades/exchange-breakdown/")).length === 1, "plan: venues read the session once, without trade codes");
    need(calls.slice(2, 5).map((c) => c.params.order).join() === "premium,volume_oi_ratio,premium" && calls.slice(2, 5).every((c) => c.params.limit === "250"), "plan: three presets");
    const groups = out.payloads["flowlab-groups"];
    need(Object.keys(groups.groups).length === 25 && Object.values(groups.groups).every((g) => g.status === "ok" && g.bars.length === 13), "plan: 25 groups of 13 bars");
    need(groups.expiry === "2026-11-20", "plan: the group expiry is the third Friday (" + groups.expiry + ")");
    need(groups.groups.mag7.bars.every((b) => b.d === null || Number.isFinite(b.d)), "plan: bars are numbers or null");
    need(out.payloads["flowlab-venues"].tickers.length === 3 && !("codes" in out.payloads["flowlab-venues"]), "plan: venues without the whole universe's codes");
  });

  await safe("cap", async () => {
    const t0 = Date.parse("2026-10-23T22:00:00Z");
    need(leg.callCeiling(t0 + 1, () => t0) === 40 && leg.callCeiling(null, () => t0) === 40, "cap: Flow Lab's own allowance is forty calls a night");
    need(leg.callCeiling(t0, () => t0) === 0 && leg.callCeiling(t0 - 1, () => t0) === 0, "cap: past the run's deadline nothing is read");
    const out = await leg.readFlowlab({ vendor: vendorOf(), sessionDate: SESSION, generatedAt: AT, cap: 10, env: {} });
    need(out.calls === 5 && out.skipped.length === 1 && out.skipped[0].section === "groups" && out.skipped[0].why === "cap", "cap: groups are skipped for the cap when ten calls remain (" + out.calls + ")");
    need(!out.payloads["flowlab-groups"] && out.detail.flSkipped === 1, "cap: nothing is published for the skipped section");
    const none = await leg.readFlowlab({ vendor: vendorOf(), sessionDate: SESSION, generatedAt: AT, cap: 0, env: {} });
    need(none.calls === 0 && none.skipped.length === 4, "cap: a zero remainder reads nothing");
  });

  await safe("failure", async () => {
    const out = await leg.readFlowlab({ vendor: vendorOf(N, { refuse: ["uranium"] }), sessionDate: SESSION, generatedAt: AT, cap: 40, env: {} });
    const g = out.payloads["flowlab-groups"].groups;
    need(g.uranium.status === "plan" && !("bars" in g.uranium) && !("callC" in g.uranium), "failure: a refused group keeps its reason and no figures");
    need(g.mag7.status === "ok", "failure: the other groups stand");
    need(out.reasons.groups && /1 of 25/.test(out.reasons.groups), "failure: the reasons name the count");
    const all = await leg.readFlowlab({ vendor: vendorOf(N, { refuse: FX.group ? ["airline", "bank", "basic materials", "china", "communication services", "consumer cyclical", "consumer defensive", "crypto", "cyber", "energy", "financial services", "gas", "gold", "healthcare", "industrials", "mag7", "oil", "real estate", "refiners", "reit", "semi", "silver", "technology", "uranium", "utilities"] : [] }), sessionDate: SESSION, generatedAt: AT, cap: 40, env: {} });
    need(!all.payloads["flowlab-groups"] && all.failures.some((f) => f.startsWith("groups:")), "failure: every group refused publishes nothing and says so");
    const dead = await leg.readFlowlab({ vendor: async () => { throw new Error("HTTP 503"); }, sessionDate: SESSION, generatedAt: AT, cap: 40, env: {} });
    need(Object.keys(dead.payloads).join() === "flowlab-corr", "failure: a dead feed publishes only the off key");
    const empty = await leg.readFlowlab({ vendor: vendorOf(FX.worlds.empty), sessionDate: SESSION, generatedAt: AT, cap: 40, env: {} });
    need(!empty.payloads["flowlab-roots"] && !empty.payloads["flowlab-screen"], "failure: empty answers publish no key");
    const odd = await leg.readFlowlab({ vendor: vendorOf(FX.worlds.unshaped), sessionDate: SESSION, generatedAt: AT, cap: 40, env: {} });
    need(!odd.payloads["flowlab-roots"], "failure: an unshaped roots answer publishes nothing");
  });

  await safe("analytics", async () => {
    const calls = [];
    const on = await leg.readFlowlab({ vendor: vendorOf(N, { calls }), sessionDate: SESSION, generatedAt: AT, cap: 40, env: { FLOWS_FLOWLAB_ANALYTICS: "on" }, alertRows: ALERTS });
    need(calls.filter((c) => c.path.startsWith("/api/analytics")).length === 2 && on.calls === 32, "analytics: two more calls under the switch (" + on.calls + ")");
    const asked = calls.filter((c) => c.path.startsWith("/api/analytics"));
    need(asked.every((c) => /^(\d+month|full|\d{4}-\d{2}-\d{2})$/.test(c.params.range) && c.params.calculations === c.params.calculations.toUpperCase() && c.params.calculations === "CORRELATION"), "analytics: the range and the calculation take the documented forms (" + asked.map((c) => c.params.range + "/" + c.params.calculations).join() + ")");
    const corr = on.payloads["flowlab-corr"];
    need(corr.status === "ok" && corr.symbols.join() === "SPY,SYX101,SYX202" && corr.window.symbols.length === 3 && corr.sliding.symbols.length === 3, "analytics: the matrix of the three flow names");
    need(calls.find((c) => c.path === "/api/analytics/window").params.symbols === "SPY,SYX101,SYX202", "analytics: symbols by flagged premium");
    const few = await leg.readFlowlab({ vendor: vendorOf(), sessionDate: SESSION, generatedAt: AT, cap: 40, env: { FLOWS_FLOWLAB_ANALYTICS: "on" }, alertRows: ALERTS.slice(0, 1) });
    need(few.payloads["flowlab-corr"].status === "empty", "analytics: fewer than three names is empty");
    const odd = await leg.readFlowlab({ vendor: vendorOf(FX.worlds.unshaped), sessionDate: SESSION, generatedAt: AT, cap: 40, env: { FLOWS_FLOWLAB_ANALYTICS: "on" }, alertRows: ALERTS });
    need(odd.payloads["flowlab-corr"].status === "unshaped", "analytics: an unexpected shape is unshaped, not a matrix");
  });

  await safe("fit", async () => {
    const rows = [];
    for (let i = 0; i < 250; i++) rows.push({ ...N["contract-screener"].data[i % 5], option_symbol: `SYX101261120C${String(100000 + i * 1000).padStart(8, "0")}`, strike: String(100 + i) });
    const out = await leg.readFlowlab({ vendor: vendorOf(N, { screener: { data: rows } }), sessionDate: SESSION, generatedAt: AT, cap: 40, env: {} });
    const s = out.payloads["flowlab-screen"];
    need(JSON.stringify(s).length <= productById("flowlab-screen").capBytes, "fit: the screen key stays under its cap (" + JSON.stringify(s).length + ")");
    need(s.presets.premium.rows.length > 0 && s.presets.premium.rows.length <= 250, "fit: rows are kept, trimmed from the tail");
  });

  await safe("section", async () => {
    const puts = [];
    const notes = [];
    const stages = { run: async (id, fn, onError) => { try { return await fn(); } catch (e) { onError(e); return null; } }, detail: (d) => notes.push(d), skip: (id, why) => notes.push({ skipped: why }) };
    const ctx = { stages, vendor: vendorOf(), sessionDate: SESSION, generatedAt: AT, marketLegs: { extras: { calls: 2000 } } };
    const t0 = Date.now();
    await section.runFlowlabWith(ctx, { env: { FLOWS_EXTRAS_CAP: "2000" }, put: async (k, v) => { puts.push(k); }, store: { flowalerts: { rows: ALERTS } }, pool: null, startedAt: t0, now: () => t0 + 60000 });
    need(notes[0] && notes[0].flCalls === 30 && notes[0].flSkipped === 0, "section: Flow Lab keeps its own allowance whatever the extras spent (" + JSON.stringify(notes[0]) + ")");
    need(puts.join() === "flowlab-roots,flowlab-venues,flowlab-screen,flowlab-groups,flowlab-corr", "section: published keys in order");
    const late = [];
    await section.runFlowlabWith({ ...ctx, stages: { ...stages, detail: (d) => late.push(d) } }, { env: {}, put: async () => {}, store: { flowalerts: null }, pool: null, startedAt: t0, now: () => t0 + 91 * 60000 });
    need(late[0] && late[0].flCalls === 0 && late[0].flSkipped === 4, "section: past the run's deadline the stage reads nothing (" + JSON.stringify(late[0]) + ")");
    const off = [];
    await section.runFlowlabWith({ ...ctx, stages: { ...stages, skip: (id, why) => off.push([id, why]), run: async () => { throw new Error("must not run"); } } }, { env: { FLOWS_FLOWLAB_NIGHTLY: "off" } });
    need(off.length === 1 && off[0][0] === "flowlab", "section: FLOWS_FLOWLAB_NIGHTLY=off skips the stage");
    const failed = [];
    const dead = { ...ctx, vendor: async () => { throw new Error("HTTP 503"); }, stages: { ...stages, detail: () => {} } };
    await section.runFlowlabWith(dead, { env: {}, put: async (k) => failed.push(k), store: { flowalerts: null } });
    need(failed.join() === "flowlab-corr", "section: a dead feed writes only the off key and the stage does not throw");
  });

  return bad;
}

const base = await battery(LEG, SECTION);
assert.deepEqual(base, [], "the shipped leg and stage pass their battery:\n" + base.join("\n"));
checks++;

const legPlants = [
  [30, "groups published with a failed group as zeros", [["groups[g] = groupEntry(res.ok ? reduceGreek(res.body, { group: true, expiry }) : res, openMs);", "groups[g] = res.ok ? groupEntry(reduceGreek(res.body, { group: true, expiry }), openMs) : { status: \"plan\", bars: [], callC: 0, putC: 0 };"]], "keeps its reason and no figures"],
  [32, "analytics read with the switch off", [["if (section === \"analytics\" && !analytics) continue;", ""]], "analytics read with the switch off"],
  [71, "analytics asks an undocumented range", [["export const CORR_RANGE = \"3month\";", "export const CORR_RANGE = \"3M\";"]], "documented forms"],
  [72, "analytics asks a lower-case calculation", [["export const CORR_CALC = \"CORRELATION\";", "export const CORR_CALC = \"correlation\";"]], "documented forms"],
  [73, "venues read the whole universe's codes again", [["const ex = await get(pathFor(\"exchange-breakdown\", { date: sessionDate }), { limit: FLOWLAB_LIMITS.venuesUniverse });", "const ex = await get(pathFor(\"exchange-breakdown\", { date: sessionDate }), { limit: FLOWLAB_LIMITS.venuesUniverse });\n      await get(pathFor(\"exchange-breakdown\", { date: sessionDate }), { limit: 500, by_trade_code: \"true\" });"]], "make 30 calls"],
  [74, "no allowance past the deadline", [["return Number.isFinite(deadline) && now() >= deadline ? 0 : NIGHTLY_MAX;", "return NIGHTLY_MAX;"]], "past the run's deadline nothing is read"],
];

const sectionPlants = [
  [29, "the extras remainder bounds the stage", [["const cap = callCeiling(deadline, now);", "const cap = Math.max(0, Math.min(40, 2000 - ((ctx.marketLegs && ctx.marketLegs.extras && ctx.marketLegs.extras.calls) || 0)));"]], "own allowance whatever the extras spent"],
];

for (const [n, title, transforms, expect] of legPlants) {
  const mod = await loadMutated("scripts/flows-legs/flowlab.mjs", transforms);
  const problems = await battery(mod, SECTION);
  ok(problems.length > 0, `PLANTED BUILD ${n} (${title}) must fail the battery`);
  ok(problems.some((p) => p.includes(expect)), `PLANTED BUILD ${n} fails its named check (${expect}): ${problems.slice(0, 3).join(" | ")}`);
}

for (const [n, title, transforms, expect] of sectionPlants) {
  const mod = await loadMutated("scripts/flows-nightly/sections/flowlab.mjs", transforms);
  const problems = await battery(LEG, mod);
  ok(problems.length > 0, `PLANTED BUILD ${n} (${title}) must fail the battery`);
  ok(problems.some((p) => p.includes(expect)), `PLANTED BUILD ${n} fails its named check (${expect}): ${problems.slice(0, 3).join(" | ")}`);
}

{
  ok(STAGES.some((s) => s.id === "flowlab" && s.isolation === "isolated" && s.needs.join() === "compute" && s.publishes.join() === KEYS.join()), "the stage table declares the isolated flowlab stage with its five keys");
  const ids = STAGES.map((s) => s.id);
  ok(ids.indexOf("flowlab") > ids.indexOf("oracle-publish") && ids.indexOf("flowlab") < ids.indexOf("roster"), "after compute and before the roster");
}

const emitDir = nightlyEmit();
const emitted = (dir) => {
  const out = {};
  for (const key of KEYS) {
    const file = path.join(dir, "-" + key + ".json");
    out[key] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  }
  return out;
};

{
  const e = emitted(emitDir);
  for (const key of KEYS) {
    ok(e[key] !== null, "the dry run writes " + key);
    ok(e[key].fixture === true, "and stamps it fixture: true");
    ok(validate(key, e[key], { allowSynthetic: true }).ok, "and it validates");
    ok(validate(key, e[key]).structural.some((s) => s.code === "synthetic_refused"), key + " is refused outside a test for being synthetic");
  }
  ok(e["flowlab-corr"].status === "off", "the dry run's correlation key is off");
  const meta = JSON.parse(fs.readFileSync(path.join(emitDir, "-meta.json"), "utf8"));
  const stage = meta.stages.find((s) => s.id === "flowlab");
  ok(stage && stage.status === "ok" && stage.flCalls === 30 && stage.flSkipped === 0, "meta records the stage with its call count: " + JSON.stringify(stage));
  const refused = e["flowlab-groups"].groups.uranium;
  ok(refused.status === "plan" && !("bars" in refused), "the dry run's refused group is a reason and no figures");
  const names = JSON.stringify(e);
  ok(!/SPY/.test(JSON.stringify(e["flowlab-venues"])) && /SYX/.test(names), "the dry run names invented tickers only");
}

{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "flowlab-plant-"));
  try {
    for (const dir of ["scripts", "shared", "docs", "assets"]) {
      if (fs.existsSync(path.join(ROOT, dir))) cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true, filter: (src) => !/node_modules|assets[\\/](img|fonts|data)/.test(src) });
    }
    const store = path.join(tmp, "scripts/flows-nightly/store.mjs");
    const text = readFileSync(store, "utf8");
    const from = "(plain ? { ...payload, fixture: true } : payload)";
    ok(text.split(from).length === 2, "the stamp site is unique");
    writeFileSync(store, text.replace(from, "payload"));
    const dir = path.join(tmp, "emit");
    const e = emitted(nightlyEmit({ root: tmp, dir }));
    ok(KEYS.every((k) => e[k] !== null && e[k].fixture !== true), "PLANTED BUILD 31 (dry-run payload without fixture: true) is visible as an unstamped payload");
    ok(!KEYS.every((k) => e[k] && e[k].fixture === true), "PLANTED BUILD 31 fails the stamp check of the dry run");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`flows-flowlab-nightly: ${checks} checks`);
