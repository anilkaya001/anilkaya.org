import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARTS, LINES, CHECKLIST, BILLING_SWITCH, LIMITERS, PAID_CAP_NEURONS, QUARTER_DAYS,
  evaluate, realContext, parseChecklist, parseToml, tokensOf, dayNumber, paidSurfaces, readbackProblems, render,
} from "../scripts/launch-readiness.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-11-20T12:00:00Z");

const prodToml = (extra = "", vars = "") => `name = "anilkaya"
[[d1_databases]]
binding = "DB"
database_name = "iewt"
database_id = "73c8c626-e971-44da-b8c1-21d6062cb9f2"
${LIMITERS.map((n, i) => `[[ratelimits]]\nname = "${n}"\nnamespace_id = "${1100 + i}"\nsimple = { limit = 30, period = 60 }\n`).join("")}
[[durable_objects.bindings]]
name = "PULSE"
class_name = "Pulse"
[vars]
FLOWS_AI_DAILY_CAP_NEURONS = "${PAID_CAP_NEURONS}"
FLOWS_TIER2 = "worker"
${vars}
${extra}`;

const stagingToml = `name = "anilkaya-staging"
[[d1_databases]]
binding = "DB"
database_name = "iewt-staging"
[[durable_objects.bindings]]
name = "PULSE"
class_name = "Pulse"
`;

const READBACKS = [
  ["1a", "2026-10-10", "owner", "plan=paid; invoice", ""],
  ["2a", "2026-11-02", "owner", "classes=A+B+C+D; vendor email reply", ""],
  ["2b", "2026-11-02", "owner", "price=49 tiers=1", ""],
  ["3a", "2026-11-03", "owner", "counsel=ranked-ideas; counsel's letter", ""],
  ["6a", "2026-11-04", "owner", "ruleset=test-required; rulesets API readback", ""],
  ["7a", "2026-11-05", "agent", "revocation=closed-within-refresh", "flows-rt"],
  ["8a", "2026-11-06", "agent", "status=members-view", "flows-reads"],
  ["8b", "2026-11-06", "owner", "alerts=delivered", ""],
  ["9a", "2026-11-10", "owner", "drill=restore; Time Travel to a scratch database", ""],
];

const sheetText = (rows = READBACKS, classes = "A, B, C, D") => `# Launch checklist
Classes shown to members: ${classes}

## Recorded readbacks

| Part | Date (UTC) | By | Evidence | Suite |
|---|---|---|---|---|
${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}
`;

function build({ rows = READBACKS, classes, files = {}, words, suites, scripts, mutate } = {}) {
  const f = {
    "wrangler.toml": prodToml(),
    "wrangler.staging.toml": stagingToml,
    ".github/workflows/regression.yml": "jobs:\n  fast:\n    runs-on: x\n  test:\n    needs: [fast]\n",
    "schema.sql": "CREATE TABLE IF NOT EXISTS accounts (id TEXT);\nCREATE TABLE audit_log (id INTEGER);\nCREATE TABLE users (id TEXT);\n",
    "worker.js": `const a = "/api/account"; const b = "/api/account/export"; const c = "/auth/refresh"; ${LIMITERS.map((n) => `memberAllowed(env.${n}, s);`).join(" ")}`,
    "shared/session.js": "const claims = { sub, role, plan, ent, sv, exp, rexp };",
    "legal/privacy/index.html": "", "legal/terms/index.html": "", "legal/disclaimer/index.html": "",
    [CHECKLIST]: sheetText(rows, classes),
    ...files,
  };
  if (mutate) mutate(f);
  const names = suites || ["flows-rt", "flows-reads"];
  const ctx = {
    now: NOW,
    read: (rel) => (rel in f ? f[rel] : null),
    exists: (rel) => rel in f,
    suites: names,
    scripts: scripts || names.map((n) => "test:" + n),
    verdictWords: words || { a: "Rich premium", b: "Cheap convexity", c: "Term roll" },
    schemaText: () => f["schema.sql"] + "\n" + (f["migrations/0001.sql"] || ""),
    workerSource: () => f["worker.js"],
  };
  return { f, ctx };
}

const lineOf = (res, id) => res.lines.find((l) => l.id === id);
const partOf = (res, id) => res.lines.flatMap((l) => l.parts).find((p) => p.id === id);

{
  eq(dayNumber("2026-10-10") - dayNumber("2026-10-09"), 1, "dayNumber counts days");
  eq(dayNumber("2026-02-30"), null, "a day that does not exist is refused");
  eq(dayNumber("2026-1-10"), null, "and a date that is not zero-padded");
  eq(dayNumber(undefined), null, "and no date");
  eq(tokensOf("plan=paid; invoice (price=49, tiers=2) classes=A+B"), { plan: "paid", price: "49", tiers: "2", classes: "A+B" }, "tokens are read from free text");
  eq(tokensOf("planned=paid xplan=free"), { planned: "paid", xplan: "free" }, "a token is a whole word");
  const t = parseToml(prodToml());
  eq((t.arrays.ratelimits || []).map((r) => r.name), [...LIMITERS], "the toml reader lists the limiters");
  eq(t.tables.vars.FLOWS_TIER2, "worker", "and the vars");
  eq(t.arrays["durable_objects.bindings"][0].name, "PULSE", "and a dotted array table");
  eq(parseToml("# c\n[vars]\nA = \"x\" # tail\nB = \"y\"").tables.vars, { A: "x", B: "y" }, "a quoted value stops at its closing quote");
  const sheet = parseChecklist(sheetText());
  eq(sheet.classes, ["A", "B", "C", "D"], "the declared classes are read");
  eq(sheet.readbacks.length, READBACKS.length, "every readback row is read");
  eq(sheet.errors, [], "with no malformed row");
  eq(parseChecklist("## Recorded readbacks\n| Part | a |\n|---|---|\n| 1a | x |\n").errors.length, 1, "a readback row of the wrong width is reported");
}

{
  const { ctx } = build();
  const res = evaluate(ctx);
  ok(res.ready, "a tree with every part satisfied is ready");
  eq(res.lines.map((l) => l.ok), LINES.map(() => true), "every one of the ten lines is true");
  eq(res.lines.length, 10, "there are ten lines");
  ok(res.lines.every((l) => l.parts.length >= 1), "every line owns at least one part");
  ok(partOf(res, "6c").status === "dropped" && partOf(res, "6c").why === "OD-02 (c)", "the dropped promotion part counts as dropped by its decision");
  eq(paidSurfaces(ctx), [], "the green fixture has no paid surface");
  ok(!res.violation, "so there is no violation");
  ok(/READY: every line is true/.test(render(res)), "and the report says READY");
  eq(readbackProblems(res.sheet, ctx), [], "every fixture readback row is valid");
}

{
  const breaks = {
    "1a": { rows: READBACKS.filter((r) => r[0] !== "1a"), lines: [1] },
    "1b-cap": { files: { "wrangler.toml": prodToml("", "").replace(`"${PAID_CAP_NEURONS}"`, '"9000"') }, lines: [1] },
    "1a-free-but-30000": { rows: READBACKS.map((r) => (r[0] === "1a" ? ["1a", "2026-10-10", "owner", "plan=free", ""] : r)), lines: [1] },
    "1a-bad-plan": { rows: READBACKS.map((r) => (r[0] === "1a" ? ["1a", "2026-10-10", "owner", "plan=gold", ""] : r)), lines: [1] },
    "2a": { rows: READBACKS.filter((r) => r[0] !== "2a"), lines: [2] },
    "2a-lacks-class-D": { rows: READBACKS.map((r) => (r[0] === "2a" ? ["2a", "2026-11-02", "owner", "classes=A+B+C", ""] : r)), lines: [2] },
    "2a-class-declared-E": { classes: "A, B, C, D, E", lines: [2] },
    "2a-no-classes-declared": { classes: "", lines: [2] },
    "2b": { rows: READBACKS.filter((r) => r[0] !== "2b"), lines: [2] },
    "2b-no-tiers": { rows: READBACKS.map((r) => (r[0] === "2b" ? ["2b", "2026-11-02", "owner", "price=49", ""] : r)), lines: [2] },
    "3a": { rows: READBACKS.filter((r) => r[0] !== "3a"), lines: [3] },
    "3b-imperative": { words: { a: "Buy cheap convexity", b: "Term roll" }, lines: [3] },
    "3b-stand": { words: { a: "Stand aside" }, lines: [3] },
    "3b-empty": { words: {}, lines: [3] },
    "4a-no-audit": { files: { "schema.sql": "CREATE TABLE accounts (id TEXT);" }, lines: [4] },
    "4b-no-export": { files: { "worker.js": prodWorker().replace('"/api/account/export"', "") }, lines: [4] },
    "4b-no-refresh": { files: { "worker.js": prodWorker().replace('"/auth/refresh"', "") }, lines: [4] },
    "4c-no-terms": { mutate: (f) => { delete f["legal/terms/index.html"]; }, lines: [4] },
    "4d-no-rexp": { files: { "shared/session.js": "const claims = { sub, role, plan, ent, sv, exp };" }, lines: [4] },
    "5a-no-prefs": { files: { "wrangler.toml": prodToml().replace(/\[\[ratelimits\]\]\nname = "PREFS_WRITE"[^\[]*/, "") }, lines: [5] },
    "5a-unread": { files: { "worker.js": prodWorker().replace("memberAllowed(env.LOGIN_NAME, s);", "") }, lines: [5] },
    "6a": { rows: READBACKS.filter((r) => r[0] !== "6a"), lines: [6] },
    "6b-no-test-job": { files: { ".github/workflows/regression.yml": "jobs:\n  fast:\n    runs-on: x\n" }, lines: [6] },
    "6b-no-staging": { mutate: (f) => { delete f["wrangler.staging.toml"]; }, lines: [6] },
    "6b-shared-d1": { files: { "wrangler.staging.toml": stagingToml.replace("iewt-staging", "iewt") }, lines: [6] },
    "6b-no-pulse": { files: { "wrangler.staging.toml": stagingToml.replace('name = "PULSE"', 'name = "OTHER"') }, lines: [6] },
    "7a": { rows: READBACKS.filter((r) => r[0] !== "7a"), lines: [7] },
    "7a-no-suite": { rows: READBACKS.map((r) => (r[0] === "7a" ? ["7a", "2026-11-05", "agent", "revocation=closed-within-refresh", ""] : r)), lines: [7] },
    "7a-unregistered-suite": { rows: READBACKS.map((r) => (r[0] === "7a" ? ["7a", "2026-11-05", "agent", "revocation=closed-within-refresh", "flows-nothing"] : r)), lines: [7] },
    "8a": { rows: READBACKS.filter((r) => r[0] !== "8a"), lines: [8] },
    "8b": { rows: READBACKS.filter((r) => r[0] !== "8b"), lines: [8] },
    "9a": { rows: READBACKS.filter((r) => r[0] !== "9a"), lines: [9] },
    "9a-stale": { rows: READBACKS.map((r) => (r[0] === "9a" ? ["9a", "2026-08-01", "owner", "drill=restore", ""] : r)), lines: [9] },
    "9a-future": { rows: READBACKS.map((r) => (r[0] === "9a" ? ["9a", "2026-12-01", "owner", "drill=restore", ""] : r)), lines: [9] },
    "9a-wrong-token": { rows: READBACKS.map((r) => (r[0] === "9a" ? ["9a", "2026-11-10", "owner", "drill=planned", ""] : r)), lines: [9] },
    "9a-nobody": { rows: READBACKS.map((r) => (r[0] === "9a" ? ["9a", "2026-11-10", "", "drill=restore", ""] : r)), lines: [9] },
    "9a-bad-date": { rows: READBACKS.map((r) => (r[0] === "9a" ? ["9a", "2026-02-30", "owner", "drill=restore", ""] : r)), lines: [9] },
  };
  for (const [name, b] of Object.entries(breaks)) {
    const { ctx } = build(b);
    const res = evaluate(ctx);
    ok(!res.ready, `${name}: the tree is no longer ready`);
    eq(res.lines.filter((l) => !l.ok).map((l) => l.id), b.lines, `${name}: exactly line ${b.lines.join(", ")} turns false`);
    ok(/NOT READY/.test(render(res)), `${name}: and the report says NOT READY`);
  }
}

function prodWorker() {
  return build().f["worker.js"];
}

{
  const noTier2 = build({ files: { "wrangler.toml": prodToml().replace('FLOWS_TIER2 = "worker"', 'FLOWS_TIER2 = "actions"') } });
  eq(lineOf(evaluate(noTier2.ctx), 10).ok, false, "line 10 is false when Tier 2 is on Actions and no exclusion is recorded");
  const excluded = build({
    files: { "wrangler.toml": prodToml().replace('FLOWS_TIER2 = "worker"', 'FLOWS_TIER2 = "actions"') },
    rows: [...READBACKS, ["10b", "2026-11-11", "owner", "live-classes=excluded; plan text", ""]],
  });
  eq(lineOf(evaluate(excluded.ctx), 10).ok, true, "line 10 is true when the live classes are excluded from the plan instead");
  const unset = build({ files: { "wrangler.toml": prodToml().replace('FLOWS_TIER2 = "worker"', "") } });
  eq(lineOf(evaluate(unset.ctx), 10).ok, false, "an unset FLOWS_TIER2 is not worker");
  eq(lineOf(evaluate(build().ctx), 10).ok, true, "and worker alone satisfies it");
}

{
  const newer = build({ rows: [...READBACKS, ["9a", "2026-11-15", "owner", "drill=planned", ""]] });
  eq(lineOf(evaluate(newer.ctx), 9).ok, true, "a newer row that is invalid does not hide an older valid one");
  const older = build({ rows: [...READBACKS.filter((r) => r[0] !== "9a"), ["9a", "2026-07-01", "owner", "drill=restore", ""], ["9a", "2026-11-12", "owner", "drill=restore", ""]] });
  eq(lineOf(evaluate(older.ctx), 9).ok, true, "a stale drill beside a current one counts the current one");
  eq(partOf(evaluate(older.ctx), "9a").why.startsWith("2026-11-12"), true, "and the report names the newest valid row");
  const edge = build({ rows: READBACKS.map((r) => (r[0] === "9a" ? ["9a", "2026-08-20", "owner", "drill=restore", ""] : r)) });
  eq(dayNumber("2026-11-20") - dayNumber("2026-08-20"), QUARTER_DAYS, "the fixture date is exactly a quarter old");
  eq(lineOf(evaluate(edge.ctx), 9).ok, true, "so a drill exactly 92 days old still counts");
  const over = build({ rows: READBACKS.map((r) => (r[0] === "9a" ? ["9a", "2026-08-19", "owner", "drill=restore", ""] : r)) });
  eq(lineOf(evaluate(over.ctx), 9).ok, false, "and one 93 days old does not");
  const noPlanFirst = build({ rows: READBACKS.filter((r) => r[0] !== "1a") });
  ok(/plan is not recorded/.test(partOf(evaluate(noPlanFirst.ctx), "1b").why), "the cap is not judged without a recorded plan");
}

{
  const green = build();
  const probes = {
    "shared/plans.js": (f) => { f["shared/plans.js"] = ""; },
    "subscriptions table": (f) => { f["migrations/0001.sql"] = "CREATE TABLE subscriptions (id TEXT);"; },
    "billing_events table": (f) => { f["schema.sql"] += "CREATE TABLE billing_events (id TEXT);"; },
    "billing route": (f) => { f["worker.js"] += ' route("/api/billing/webhook");'; },
    "switch on": (f) => { f["wrangler.toml"] = prodToml("", `${BILLING_SWITCH} = "on"`); },
    "switch odd": (f) => { f["wrangler.toml"] = prodToml("", `${BILLING_SWITCH} = "yes"`); },
  };
  for (const [name, mutate] of Object.entries(probes)) {
    const withGreen = build({ mutate });
    eq(paidSurfaces(withGreen.ctx).length, 1, `${name}: is detected as a paid surface`);
    ok(!evaluate(withGreen.ctx).violation, `${name}: with every line true it is allowed`);
    const notReady = build({ mutate, rows: READBACKS.filter((r) => r[0] !== "6a") });
    const res = evaluate(notReady.ctx);
    ok(res.violation, `${name}: with a line false it is a violation`);
    ok(/VIOLATION/.test(render(res)), `${name}: and the report says so`);
  }
  const off = build({ mutate: (f) => { f["wrangler.toml"] = prodToml("", `${BILLING_SWITCH} = "off"`); }, rows: [] });
  eq(paidSurfaces(off.ctx), [], `${BILLING_SWITCH}=off is not a paid surface`);
  ok(!evaluate(off.ctx).violation && !evaluate(off.ctx).ready, "and a not-ready tree with the switch off is no violation");
  ok(!evaluate(green.ctx).violation, "the green tree is never a violation");
}

{
  const bad = build({
    rows: [
      ...READBACKS,
      ["9a", "2026-12-01", "owner", "drill=restore", ""],
      ["4c", "2026-11-01", "owner", "pages=live", ""],
      ["7a", "2026-11-05", "agent", "revocation=closed-within-refresh", "flows-nothing"],
      ["6c", "2026-11-01", "owner", "dropped", ""],
    ],
  });
  const problems = readbackProblems(parseChecklist(bad.f[CHECKLIST]), bad.ctx);
  eq(problems.length, 4, "an audit of the recorded rows names every one that would be ignored or misfiled");
  ok(problems.some((p) => /future/.test(p)) && problems.some((p) => /not a readback part/.test(p)) && problems.some((p) => /not registered/.test(p)), "with the reason for each");
}

const real = await realContext(ROOT, NOW);
const doc = readFileSync(path.join(ROOT, CHECKLIST), "utf8");
const sheet = parseChecklist(doc);

{
  eq(sheet.errors, [], "the committed checklist has no malformed table row");
  eq(sheet.parts.map((p) => [p.id, Number(p.line), p.kind, p.text]), PARTS.map((p) => [p.id, p.line, p.kind, p.text]), "the checklist's parts table equals the parts the script reads, in order, word for word");
  for (const line of LINES) ok(doc.includes(`${line.id}. ${line.title}`), `the checklist states line ${line.id} as the script reads it`);
  ok(sheet.classes.length >= 1 && sheet.classes.every((c) => /^[A-D]$/.test(c)), "the checklist declares the data classes shown to members");
  const six = sheet.parts.find((p) => p.id === "6c");
  ok(six && six.kind === "dropped" && /OD-02 \(c\)/.test(six.text) && /OD-02 \(c\)/.test(doc), "the dropped promotion part names the owner decision in both places");
  eq(readbackProblems(sheet, { ...real, now: NOW }), [], "every recorded readback is valid: none is silently ignored");
  ok(!/\bTODO\b|\bTBD\b/.test(doc), "the checklist has no placeholder");
}

{
  const res = evaluate(real, new Date());
  eq(res.lines.length, 10, "the real tree is read against ten lines");
  eq(partOf(res, "1a").ok, true, "the owner's plan readback is recorded");
  eq(partOf(res, "1b").ok, true, "and the cap in wrangler.toml matches the recorded plan");
  ok(res.lines.every((l) => typeof l.ok === "boolean" && l.parts.every((p) => ["met", "open", "dropped"].includes(p.status))), "every part has a verdict");
  eq(paidSurfaces(real), [], "the tree has no paid surface");
  ok(!res.violation, "and so admits no paying member while any line is false");
  const rows = parseToml(real.read("wrangler.toml")).tables.vars || {};
  ok(rows[BILLING_SWITCH] === undefined || rows[BILLING_SWITCH] === "off", `${BILLING_SWITCH} is absent or off in wrangler.toml`);
  for (const p of PARTS.filter((x) => x.kind === "readback" && x.suite)) ok(typeof p.check === "function", `${p.id}: a suite-backed readback is checked`);
  ok(real.suites.includes("launch-readiness") && real.scripts.includes("test:launch-readiness"), "this suite is registered");
}

{
  const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/launch-readiness.mjs")], { cwd: ROOT, encoding: "utf8" });
  const res = evaluate(real, new Date());
  eq(run.status, res.ready ? 0 : 1, "the script exits 1 until every line is true");
  ok(/TRUE\s+1\./.test(run.stdout) && /(?:NOT )?READY/.test(run.stdout), "and prints each line with its verdict");
  const json = spawnSync(process.execPath, [path.join(ROOT, "scripts/launch-readiness.mjs"), "--json"], { cwd: ROOT, encoding: "utf8" });
  const parsed = JSON.parse(json.stdout);
  eq(parsed.lines.length, 10, "--json prints the ten lines");
  eq(parsed.ready, res.ready, "and the same verdict");
}

console.log(`✓ launch-readiness: ${checks} checks`);
