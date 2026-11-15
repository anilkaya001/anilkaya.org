import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { OPS, opById, pathFor, BUDGETS } from "../shared/flows-vendor-ops.js";
import * as IPO from "../shared/flows-ipo.js";
import { readCatalysts, assembleCatalysts, ipoEnabled, IPO_NIGHTLY_SWITCH } from "../scripts/flows-legs/events.mjs";
import { CALL_COST, callModel, NOMINAL_SHAPE } from "../scripts/flows-nightly/vendor-params.mjs";
import { loadMutated } from "./truth/mutants.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-intel.json"), "utf8"));
const SPEC = fs.readFileSync(path.join(ROOT, "docs/uw-openapi.yaml"));
const S = FIX.provenance.session;

{
  eq(FIX.provenance.generator, "tests/gen-intel-fixtures.py", "the fixtures name their generator");
  ok(/synthetic/.test(FIX.provenance.nature) && /not vendor data/.test(FIX.provenance.nature) && /not observed on the wire/.test(FIX.provenance.nature), "and say they are synthetic, spec-derived and not observed on the wire");
  eq(FIX.provenance.specSha256, createHash("sha256").update(SPEC).digest("hex"), "THE FIXTURES WERE BUILT TO THIS SPEC: if docs/uw-openapi.yaml moved, run python3 tests/gen-intel-fixtures.py and read the diff");
  eq(FIX.provenance.generatorSha256, createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tests/gen-intel-fixtures.py"))).digest("hex"), "and by this generator: a changed generator was rerun");
  const tickers = JSON.stringify(FIX.bodies).match(/"ticker":"([^"]+)"/g).map((m) => m.slice(10, -1));
  ok(tickers.length > 5 && tickers.every((t) => /^SY[A-Z]\d{3}$/.test(t)), "every ticker in the fixtures is in the invented namespace");
  for (const [id, op] of Object.entries(FIX.ops)) {
    const e = opById(id);
    eq(e.op, op, `${id}: the registry entry is the operation the generator read the schema of`);
    const documented = new Set(FIX.documented[id]);
    eq(e.reads.filter((n) => !documented.has(n)), [], `${id}: every field the read list names is one the spec documents`);
  }
  eq(OPS.filter((e) => e.planned).map((e) => e.id).sort(), ["listings", "potus-schedule"], "THE PLANNED REGISTRY: listings and the President's schedule are registered ahead of a reader");
  ok(!opById("ipo-calendar").planned && opById("ipo-calendar").limiter === null, "the IPO calendar is read, and only by the nightly: it takes no member token");
  eq(pathFor("ipo-calendar"), "/api/calendar/ipo", "its path comes from the registry");
  eq(CALL_COST.ipo, 1, "THE CALL MODEL COUNTS IT: one call a night");
  eq(callModel(NOMINAL_SHAPE).legs.ipo, 1, "and the nominal night carries it as its own leg");
  ok(!Object.values(BUDGETS).some((b) => b && typeof b === "object" && "ipo" in b), "no per-minute budget moves: the call is part of the nightly's paced run");
}

{
  const doc = fs.readFileSync(path.join(ROOT, "docs/vendor-coverage.md"), "utf8");
  const spec = [...SPEC.toString("utf8").matchAll(/^ {2}(\/api\/[^\s:]+):$/gm)].map((m) => m[1]);
  const status = (p) => { const e = OPS.filter((o) => o.op === p); return !e.length ? "unused" : e.every((o) => o.planned) ? "planned" : "used"; };
  const fams = new Map();
  for (const p of spec) { const f = p.split("/")[2]; const v = fams.get(f) || { used: 0, planned: 0, unused: 0 }; v[status(p)]++; fams.set(f, v); }
  const rows = new Map([...doc.matchAll(/^\| ([a-z_-]+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/gm)].map((m) => [m[1], m.slice(2).map(Number)]));
  eq([...rows.keys()].sort(), [...fams.keys()].sort(), "THE CENSUS TABLE NAMES EVERY FAMILY OF THE SPEC once");
  for (const [f, v] of fams) eq(rows.get(f), [v.used + v.planned + v.unused, v.used, v.planned, v.unused], `${f}: the census row is the count from the spec and the registry`);
  const total = [...fams.values()].reduce((a, v) => [a[0] + v.used + v.planned + v.unused, a[1] + v.used, a[2] + v.planned, a[3] + v.unused], [0, 0, 0, 0]);
  ok(doc.includes(`| **Total** | **${total[0]}** | **${total[1]}** | **${total[2]}** | **${total[3]}** |`), `and the total row is ${total.join(", ")}`);
  for (const f of [...fams].filter(([, v]) => v.unused).map(([f]) => f)) ok(new RegExp("^- `" + f + "` \\(" + fams.get(f).unused + "\\): ", "m").test(doc), `${f}: every family with an unused operation has its one-line reason and count`);
}

const shaped = () => IPO.shapeIpoCalendar(FIX.bodies["ipo-calendar"], { sessionDate: S });

{
  const out = shaped();
  eq(out.status, "ok", "the fixture calendar reads");
  eq(out.rows.map((r) => r.t), ["SYX501", "SYX502", "SYX503", "SYX504", "SYX505", "SYX508"], "WORKED ANSWER: six listings inside the horizon, earliest first and by ticker on a shared day");
  eq(out.rows.map((r) => r.dd), [2, 2, 11, 19, 25, 40], "each with its whole calendar days from the session");
  eq([out.read, out.inWindow, out.kept, out.undated, out.past, out.outside, out.duplicate, out.unnamed], [10, 6, 6, 1, 1, 1, 1, 0], "the counts: ten read, one undated, one already past, one beyond 92 days, one duplicate");
  eq(out.rows[0], { t: "SYX501", name: "Synthetic Holdings Alpha", ex: "NASDAQ", d: "2026-10-29", dd: 2, lo: 14, hi: 16, cur: "USD", why: null }, "a priced row keeps both ends and its currency");
  eq(out.rows[1].cur, "USD", "a lower-case currency code is read as the code");
  eq([out.rows[2].lo, out.rows[2].hi, out.rows[2].why], [null, null, "unpriced"], "a row with no range keeps no figure and says so");
  eq([out.rows[3].lo, out.rows[3].hi, out.rows[3].cur, out.rows[3].why], [null, null, null, "currency"], "a range with no currency is withheld, never printed as dollars");
  eq([out.rows[4].lo, out.rows[4].hi, out.rows[4].why], [null, null, "range"], "a range whose ends are out of order is withheld");
  eq([out.rows[5].lo, out.rows[5].hi, out.rows[5].cur], [4, 5, "EUR"], "a range in another currency keeps that currency");
  eq([out.unpriced, out.range, out.currency], [1, 1, 1], "and each withheld range is counted by its reason");
  eq(out.horizonDays, IPO.IPO_HORIZON_DAYS, "the horizon travels with the section");
}

{
  const one = (r) => IPO.shapeIpoCalendar({ data: { ipos: [r] } }, { sessionDate: S });
  const base = { ticker: "SYX700", name: "Synthetic Edge", exchange: "NYSE", ipo_date: S, price_range_low: 10, price_range_high: 10, currency: "USD" };
  eq(one(base).rows[0].dd, 0, "a listing dated on the session is inside, at zero days");
  eq([one(base).rows[0].lo, one(base).rows[0].hi], [10, 10], "a range with equal ends is a fixed price and is kept");
  eq(one({ ...base, ipo_date: "2027-01-27" }).rows[0].dd, 92, "the last day of the horizon is inside");
  eq(one({ ...base, ipo_date: "2027-01-28" }).outside, 1, "the day after it is outside");
  eq(one({ ...base, ipo_date: "2026-10-26" }).past, 1, "the day before the session is past");
  eq(one({ ...base, ipo_date: "2026-02-30" }).undated, 1, "an impossible date is undated, never read as a near one");
  eq(one({ ...base, ipo_date: "2026-11-02T13:30:00Z" }).rows[0].d, "2026-11-02", "a timestamp is read as its day");
  eq(one({ ...base, price_range_low: 0 }).rows[0].why, "range", "a zero end is not a price");
  eq(one({ ...base, price_range_low: "12" }).rows[0].why, "range", "a string end is not a number the schema states");
  eq(one({ ...base, price_range_high: Infinity }).rows[0].why, "range", "an infinite end is refused");
  eq(one({ ...base, currency: "dollars" }).rows[0].why, "currency", "a currency that is not a three-letter code is no currency");
  eq(one({ ...base, ticker: "brk.b" }).rows[0].t, "BRK.B", "a ticker is upper-cased");
  eq(one({ ...base, ticker: "<b>X</b>" }).rows[0].t, null, "and a ticker with markup is dropped, the row kept by its name");
  eq(one({ ...base, name: "<script>alert(1)</script>Synthetic" }).rows[0].name.includes("<"), false, "a name is cleaned of markup before it is stored");
  eq(one({ ...base, ticker: null, name: null }).unnamed, 1, "a row with neither a ticker nor a name is counted and dropped");
  eq(IPO.shapeIpoCalendar({ data: { ipos: [] } }, { sessionDate: S }).status, "quiet", "an empty calendar is quiet, not unavailable");
  eq(IPO.shapeIpoCalendar({ data: { ipos: [] } }, { sessionDate: S }).reason, "absent", "with the absent reason");
  for (const bad of [null, [], {}, { data: [] }, { data: { ipos: "x" } }, "text"]) {
    eq(IPO.shapeIpoCalendar(bad, { sessionDate: S }).status, "unavailable", `a body shaped ${JSON.stringify(bad)} is unavailable, never quiet`);
  }
  const many = { data: { ipos: Array.from({ length: 60 }, (_, i) => ({ ...base, ticker: "SYX" + (800 + i), ipo_date: "2026-11-" + String(1 + (i % 28)).padStart(2, "0") })) } };
  const capped = IPO.shapeIpoCalendar(many, { sessionDate: S });
  eq([capped.kept, capped.inWindow, capped.rows.length], [IPO.IPO_ROWS, 60, IPO.IPO_ROWS], "the row cap keeps the earliest and counts the rest");
  ok(capped.rows.every((r, i, a) => i === 0 || a[i - 1].d <= r.d), "and the kept rows are in date order");
  const noSession = IPO.shapeIpoCalendar(FIX.bodies["ipo-calendar"], {});
  ok(noSession.rows.every((r) => r.dd === null) && noSession.past === 0, "without a session date no day count is invented");
}

{
  eq(ipoEnabled({}), true, "the nightly read ships on");
  eq(ipoEnabled({ [IPO_NIGHTLY_SWITCH]: "off" }), false, "and off is the one word that stops it");
  eq(ipoEnabled({ [IPO_NIGHTLY_SWITCH]: " OFF " }), false, "in any case");
  eq(ipoEnabled({ [IPO_NIGHTLY_SWITCH]: "of" }), true, "a misspelling keeps the read on");
  const asked = [];
  const uw = async (p, params, opts) => {
    asked.push([p, opts]);
    if (p === "/api/calendar/ipo") return FIX.bodies["ipo-calendar"];
    return [];
  };
  const raw = await readCatalysts(uw, { sessionDate: S, earningsTickers: [], ipo: true });
  eq(asked.filter(([p]) => p === "/api/calendar/ipo").length, 1, "THE LEG READS IT ONCE A NIGHT");
  eq(asked.find(([p]) => p === "/api/calendar/ipo")[1], { envelope: true }, "with the envelope kept, so the shaper sees the documented data object");
  const add = assembleCatalysts(raw, { sessionDate: S }).additions;
  eq(add.ipo, shaped(), "the events additions carry the shaped calendar");
  const off = [];
  const rawOff = await readCatalysts(async (p) => { off.push(p); return []; }, { sessionDate: S, earningsTickers: [], ipo: false });
  eq(off.filter((p) => p === "/api/calendar/ipo").length, 0, "SWITCHED OFF, NO CALL");
  eq(assembleCatalysts(rawOff, { sessionDate: S }).additions.ipo, { status: "unavailable", reason: "not_read", why: "off" }, "and the section says it was not read because the switch is off");
  const rawFail = await readCatalysts(async (p) => { if (p === "/api/calendar/ipo") throw Object.assign(new Error("HTTP 503"), { status: 503 }); return []; }, { sessionDate: S, earningsTickers: [], ipo: true });
  const failed = assembleCatalysts(rawFail, { sessionDate: S }).additions.ipo;
  eq([failed.status, failed.reason], ["unavailable", "unreadable"], "a failed read is unavailable with its reason, never quiet");
  const late = assembleCatalysts(await readCatalysts(uw, { sessionDate: S, earningsTickers: [], deadline: Date.now() - 1, ipo: true }), { sessionDate: S }).additions.ipo;
  eq([late.status, late.reason], ["unavailable", "not_read"], "past the run deadline the calendar is not read and says so");
}

const MUTANTS = [
  { name: "the horizon end refused", file: "shared/flows-ipo.js", from: "if (end && d > end)", to: "if (end && d >= end)" },
  { name: "past listings kept", file: "shared/flows-ipo.js", from: "if (start && d < start) { counts.past++; continue; }", to: "" },
  { name: "a range with no currency printed", file: "shared/flows-ipo.js", from: "if (cur === null) return { lo: null, hi: null, cur: null, why: \"currency\" };", to: "" },
  { name: "an unordered range kept", file: "shared/flows-ipo.js", from: "lo === null || hi === null || lo > hi", to: "lo === null || hi === null" },
  { name: "a zero end read as a price", file: "shared/flows-ipo.js", from: "Number.isFinite(v) && v > 0", to: "Number.isFinite(v) && v >= 0" },
  { name: "duplicates kept", file: "shared/flows-ipo.js", from: "if (seen.has(key)) { counts.duplicate++; continue; }", to: "" },
  { name: "an unshaped body read as quiet", file: "shared/flows-ipo.js", from: "if (list === null) return { status: \"unavailable\", reason: SILENCE.unreadable, why: \"unshaped\" };", to: "if (list === null) return { status: \"quiet\", rows: [] };" },
  { name: "names stored uncleaned", file: "shared/flows-ipo.js", from: "const name = cleanLabel(r.name, IPO_NAME_CAP);", to: "const name = vstr(r.name);" },
  { name: "rows by ticker, not date", file: "shared/flows-ipo.js", from: "out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : ", to: "out.sort((a, b) => (false ? -1 : false ? 1 : " },
  { name: "a ninety-day horizon", file: "shared/flows-ipo.js", from: "export const IPO_HORIZON_DAYS = 92;", to: "export const IPO_HORIZON_DAYS = 90;" },
];

async function verdict(mod) {
  try {
    const out = mod.shapeIpoCalendar(FIX.bodies["ipo-calendar"], { sessionDate: S });
    const exp = shaped();
    assert.deepEqual(out, exp);
    const one = (r) => mod.shapeIpoCalendar({ data: { ipos: [r] } }, { sessionDate: S });
    const base = { ticker: "SYX700", name: "<i>Synthetic</i> Edge", exchange: "NYSE", ipo_date: "2027-01-27", price_range_low: 10, price_range_high: 12, currency: "USD" };
    assert.equal(one(base).rows.length, 1);
    assert.equal(one(base).rows[0].name.includes("<"), false);
    assert.equal(one({ ...base, price_range_low: 0 }).rows[0].why, "range");
    assert.equal(mod.shapeIpoCalendar({ data: {} }, { sessionDate: S }).status, "unavailable");
    const order = mod.shapeIpoCalendar({ data: { ipos: [{ ...base, ticker: "SYX111", ipo_date: "2026-11-01" }, { ...base, ticker: "SYX999", ipo_date: "2026-10-28" }] } }, { sessionDate: S });
    assert.deepEqual(order.rows.map((r) => r.t), ["SYX999", "SYX111"]);
    return "pass";
  } catch {
    return "fail";
  }
}

{
  eq(await verdict(IPO), "pass", "the battery passes the correct build");
  eq(await verdict(await loadMutated("shared/flows-ipo.js", [], { salt: 1 })), "pass", "and the same build loaded as a copy");
  let salt = 2;
  for (const m of MUTANTS) {
    const mod = await loadMutated(m.file, [[m.from, m.to]], { salt: salt++ });
    eq(await verdict(mod), "fail", `PLANTED: ${m.name} fails the battery`);
  }
  const legMutant = await loadMutated("scripts/flows-legs/events.mjs", [["raw.ipo = ipo ? await get(pathFor(\"ipo-calendar\"), {}, { envelope: true }) :", "raw.ipo = ipo ? await get(pathFor(\"ipo-calendar\"), {}) :"]], { salt: salt++ });
  const unwrapped = async (p, params, opts) => (p === "/api/calendar/ipo" ? (opts && opts.envelope ? FIX.bodies["ipo-calendar"] : FIX.bodies["ipo-calendar"].data) : []);
  const leg = legMutant.assembleCatalysts(await legMutant.readCatalysts(unwrapped, { sessionDate: S, earningsTickers: [], ipo: true }), { sessionDate: S }).additions.ipo;
  ok(leg.status !== "ok", "PLANTED: a leg that drops the envelope reads the unwrapped body as unshaped, and the shaped calendar is lost");
  const offMutant = await loadMutated("scripts/flows-legs/events.mjs", [["!== \"off\";", "!== \"no\";"]], { salt: salt++ });
  ok(offMutant.ipoEnabled({ [IPO_NIGHTLY_SWITCH]: "off" }) === true, "PLANTED: a switch that ignores off is caught by the switch table");
}

console.log(`✓ flows-ipo: ${checks} assertions — the IPO calendar registered from the spec with its read list, spec-derived fixtures with invented tickers, the two planned operations, one nightly call in the call model, the shaper's horizon, dates, ranges, currencies, names and caps worked by hand, the leg's switch, envelope, failure and deadline, and ${MUTANTS.length + 2} planted wrong builds that each fail`);
