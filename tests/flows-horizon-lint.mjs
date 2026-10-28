import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const GENERATED = /(bundle|curriculum|lab-suite|stage-manifest|review-manifest|skill-manifest|course-points|course-seo|stage-catalog|review-catalog|course-catalog|skill-catalog|project-catalog|\.min\.)/;
const HOME = "shared/flows-horizon.js";

const REASONS = {
  month: "the span of a statistic's own window, a trailing return or a model horizon of one trading month: 21 sessions is 30 calendar days at 252 sessions a year, and none of these is the distance to an earnings report",
  clock: "the hour 21 of a clock, a cron expression or a dated fixture, not a count of sessions",
  dte: "a structure's window in days to expiry",
  chart: "a chart range or the number of closes a sparkline draws",
  repeat: "a spaced-repetition interval of the Lab, in days",
  record: "a forward-return horizon of the board record",
  pace: "the sessions a name needs to reach the board's dead band at its present pace",
  glyph: "a coordinate of an icon path",
  sql: "a number in the Worker's SQL",
  age: "an age or a filing window in calendar days (the failures-to-deliver window, a stored part's maximum age), not a count of sessions",
};

const ALLOWED = [
  ["assets/js/flows-ask.js", 1, "month"],
  ["assets/js/flows-board.js", 1, "pace"],
  ["assets/js/flows-moves.js", 4, "chart"],
  ["assets/js/flows-pos.js", 1, "age"],
  ["assets/js/flows-strategy.js", 1, "dte"],
  ["assets/js/flows-ticker.js", 1, "chart"],
  ["assets/js/flows-voldesk.js", 2, "month"],
  ["assets/js/mastery.js", 1, "repeat"],
  ["assets/js/skill-mastery.js", 1, "repeat"],
  ["scripts/flows-legs/dispersion.mjs", 2, "month"],
  ["scripts/flows-legs/flow.mjs", 1, "month"],
  ["scripts/flows-legs/live-day.mjs", 10, "clock"],
  ["scripts/flows-legs/vol-fake.mjs", 2, "month"],
  ["scripts/flows-legs/vol.mjs", 2, "month"],
  ["scripts/flows-legs/witness.mjs", 3, "clock"],
  ["scripts/flows-nightly/clock.mjs", 1, "clock"],
  ["scripts/flows-nightly/fixtures.mjs", 1, "clock"],
  ["scripts/flows-nightly/rank.mjs", 2, "month"],
  ["scripts/flows-nightly/sections/record.mjs", 1, "record"],
  ["scripts/flows-quant-pipeline.mjs", 2, "month"],
  ["shared/ff-contract.js", 2, "dte"],
  ["shared/flows-card.js", 3, "month"],
  ["shared/flows-catalysts.js", 1, "clock"],
  ["shared/flows-dispersion.js", 1, "month"],
  ["shared/flows-dossier.js", 1, "month"],
  ["shared/flows-fact-ids.js", 10, "month"],
  ["shared/flows-garch.js", 1, "month"],
  ["shared/flows-glossary.js", 1, "month"],
  ["shared/flows-live-worker.js", 1, "clock"],
  ["shared/flows-neuron-screen.js", 1, "month"],
  ["shared/flows-neuron.js", 6, "month"],
  ["shared/flows-pages.js", 1, "glyph"],
  ["shared/flows-pos-short.js", 2, "age"],
  ["shared/flows-quant-structures.js", 13, "dte"],
  ["shared/flows-quant-world.js", 2, "month"],
  ["shared/flows-reading.js", 5, "month"],
  ["shared/flows-record.js", 2, "record"],
  ["shared/flows-targets.js", 3, "record"],
  ["shared/flows-variation.js", 1, "month"],
  ["shared/flows-vendor-extras.js", 2, "age"],
  ["shared/flows-vol.js", 12, "month"],
  ["shared/flows-voldesk-copy.js", 2, "month"],
  ["shared/flows-voldesk.js", 1, "month"],
  ["shared/mastery.js", 1, "repeat"],
  ["shared/skill-mastery.js", 1, "repeat"],
  ["worker.js", 2, "sql"],
];

const CONSTANTS = [
  ["assets/js/flows-board.js", "EARNINGS_SOON_DAYS", 20, "the board's mark for a report close enough to leave it by the earnings gate, in calendar days; the gate itself is EARNINGS_GATE_DAYS"],
  ["scripts/flows-legs/market.mjs", "EARNINGS_WINDOW_SESSIONS", 10, "the sessions of the earnings calendar the market leg reads for the Events page, a read size and not a horizon"],
  ["scripts/flows-legs/market.mjs", "EARNINGS_WINDOW_CAP", 60, "the call budget of that read"],
  ["scripts/flows-nightly/vendor-params.mjs", "EARNINGS_GATE_DAYS", 12, "the earnings gate of the boards and the desk, in calendar days: a gate on a position, owned by the board rows"],
  ["shared/flows-catalysts.js", "FDA_HORIZON_DAYS", 120, "how far ahead the FDA calendar is read"],
  ["shared/flows-features.js", "HORIZON_SESSIONS", 10, "the momentum horizon of the feature set"],
  [HOME, "HORIZON_SESSIONS", 21, "the one earnings horizon"],
  ["shared/flows-quant-card.js", "EVENT_FIT_AFTER_DAYS", 80, "the first expiry the event fit may use"],
  ["shared/flows-quant-density.js", "MIN_HORIZON_SESSIONS", 1, "the shortest horizon a density is fitted for"],
  ["shared/flows-reading.js", "EVENT_PRICED_SESSIONS", 5, "the tag line for an event that is priced into the nearest expiry"],
  ["shared/flows-reading.js", "EVENT_NEAR_SESSIONS", 10, "the tag line for a near event"],
];

const LITERAL = /(?<![\w.$-])21(?![\w.-])/g;
const COMPARE = /\b(?:ed|sdte|edte|sessions|eventSessions|windowSessions)\b\s*(?:<=?|>=?)\s*(?:[2-9]|\d{2,})\b/g;
const DECLARED = /\b([A-Za-z_]*(?:EARN|Earn|earn|EVENT|Event|event|REPORT|APART|HORIZON|Horizon|horizon)[A-Za-z_]*(?:SESSIONS|DAYS|WINDOW|GATE|Sessions|Days|Window|Gate|HORIZON|Horizon)[A-Za-z_]*|[A-Za-z_]*(?:SESSIONS|DAYS|WINDOW|Sessions|Days|Window)[A-Za-z_]*(?:EARN|EVENT|Earn|Event)[A-Za-z_]*)\s*[:=]\s*(\d+)\b/g;

function scanned(read, list) {
  return list.filter((f) => /\.(js|mjs)$/.test(f) && (/^(shared|server|scripts|assets\/js)\//.test(f) || f === "worker.js") && !GENERATED.test(f)).map((f) => [f, read(f)]);
}

export function lint(files) {
  const problems = [];
  const allowed = new Map(ALLOWED.map(([f, n]) => [f, n]));
  for (const [f, text] of files) {
    const n = f === HOME ? 0 : (text.match(LITERAL) || []).length;
    const want = allowed.get(f) || 0;
    if (n !== want) problems.push(`${f}: ${n} literal 21${n === 1 ? "" : "s"}, ${want} allowed`);
    const cmp = text.match(COMPARE) || [];
    if (cmp.length) problems.push(`${f}: a distance to a report compared with a number: ${cmp[0]}`);
  }
  const declared = [];
  for (const [f, text] of files) {
    for (const m of text.matchAll(DECLARED)) declared.push([f, m[1], Number(m[2])]);
  }
  const key = (a) => a.join("|");
  const have = new Set(declared.map(key));
  const want = new Set(CONSTANTS.map(([f, name, value]) => key([f, name, value])));
  for (const k of have) if (!want.has(k)) problems.push(`a constant for an earnings window or horizon that is not on the list: ${k}`);
  for (const k of want) if (!have.has(k)) problems.push(`a listed constant that is gone or changed: ${k}`);
  return problems;
}

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const files = scanned((f) => fs.readFileSync(path.join(ROOT, f), "utf8"), tracked);
ok(files.length > 250, `the scan reads ${files.length} source files`);
ok(files.some(([f]) => f === HOME) && files.some(([f]) => f === "worker.js") && files.some(([f]) => f === "assets/js/flows-moves.js"), "and includes the horizon leaf, the Worker and a page");
eq(lint(files), [], "no source file but the horizon leaf holds the earnings horizon: every other 21 is a named, unrelated window and every earnings constant is on the list");

for (const [f, n, why] of ALLOWED) {
  ok(Object.hasOwn(REASONS, why) && n >= 1, `${f} has ${n} of a listed kind: ${why}`);
  ok(files.some(([g]) => g === f), `${f} is in the tree`);
}
for (const [f, name] of CONSTANTS) ok(files.some(([g, text]) => g === f && text.includes(name)), `${f} still declares ${name}`);

const base = new Map(files);
const plant = (name, f, transform, expect) => {
  const text = base.get(f);
  const changed = transform(text);
  ok(changed !== text, `the planted build "${name}" changes ${f}`);
  const list = files.map(([g, t]) => (g === f ? [g, changed] : [g, t]));
  const problems = lint(list);
  ok(problems.length > 0 && (!expect || problems.some((p) => expect.test(p))), `PLANTED WRONG BUILD CAUGHT: ${name} (${problems[0]})`);
};

plant("a horizon constant in a page", "assets/js/flows-skyline.js", (t) => t.replace("const MIN = 2;", "const MIN = 2;\n  const EVENT = 21;"), /literal 21/);
plant("a horizon constant in a leaf", "shared/flows-moves0.js", (t) => t.replace("export const EVENT_SESSIONS = HORIZON_SESSIONS;", "export const EVENT_SESSIONS = 21;"), /literal 21/);
plant("the horizon in copy", "shared/flows-pages.js", (t) => t.replace("Earnings within ${HORIZON_SESSIONS} sessions", "Earnings within 21 sessions"), /literal 21/);
plant("the horizon in a comparison", "shared/flows-oracle.js", (t) => t.replace("sessions <= HORIZON_SESSIONS", "sessions <= 21"), /literal 21/);
plant("another window in a comparison", "shared/flows-oracle.js", (t) => t.replace("sessions <= HORIZON_SESSIONS", "sessions <= 30").replace("inWindow: fin(sessions) && 30", "inWindow: fin(sessions) && 30"), null);
plant("a distance to a report compared with a number", "assets/js/flows-overview.js", (t) => `${t}\nconst late = v.ed <= 30;\n`, /compared with a number/);
plant("a new earnings constant", "shared/flows-neuron-screen.js", (t) => `${t}\nexport const REPORT_WINDOW_DAYS = 28;\n`, /not on the list/);
plant("a listed constant changed", "scripts/flows-nightly/vendor-params.mjs", (t) => t.replace(/EARNINGS_GATE_DAYS = 12/, "EARNINGS_GATE_DAYS = 14"), /gone or changed/);
plant("the horizon leaf copied into a worker module", "shared/flows-events.js", (t) => `${t}\nconst HORIZON = 21;\n`, /literal 21/);
plant("a stale allowance", "shared/flows-vol.js", (t) => t.replace(/(?<![\w.$-])21(?![\w.-])/, "22"), /allowed/);
plant("a second use in an allowed file", "shared/flows-vol.js", (t) => `${t}\nexport const LATE = 21;\n`, /allowed/);

const unrelated = files.filter(([f]) => f !== HOME).map(([, t]) => (t.match(LITERAL) || []).length).reduce((a, b) => a + b, 0);
ok(unrelated === ALLOWED.reduce((a, [, n]) => a + n, 0), `the ${unrelated} remaining 21s are all accounted for`);

console.log(`✓ flows-horizon-lint: ${checks} assertions, no server: no source file outside shared/flows-horizon.js holds the earnings horizon as a number, no distance to a report is compared with one, every constant for an earnings window or gate is on a reviewed list, the ${unrelated} other 21s in ${ALLOWED.length} files are named unrelated windows with a count each (so a new one fails), and 11 planted wrong builds`);
