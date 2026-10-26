import { loadMutated } from "./truth/mutants.mjs";
import { T, ok, killed } from "./lib/member-batteries.mjs";
import { formatBattery, columnsBattery, windowsBattery, buildBattery, calendarBattery } from "./lib/member-export-batteries.mjs";
import { exportRouteBattery, exportCapBattery, exportWindowBattery, exportTruncationBattery } from "./lib/member-route-batteries.mjs";
import { EXPORT_ROUTE_MUTANTS } from "./lib/member-route-mutants.mjs";

const quiet = console.error;
console.error = () => {};

const MOD = {
  format: await import("../shared/flows-export-format.js"),
  windows: await import("../shared/flows-member-windows.js"),
  build: await import("../shared/flows-export-build.js"),
  calendar: await import("../shared/flows-member-calendar.js"),
  crypto: await import("../shared/flows-member-crypto.js"),
  state: await import("../shared/flows-member-state.js"),
  store: await import("../server/member-store.js"),
  route: await import("../server/routes/flows-me.js"),
};

formatBattery(MOD.format);
await columnsBattery((extra) => loadMutated("shared/flows-columns.js", extra));
windowsBattery(MOD.windows);
buildBattery(MOD.build);
calendarBattery(MOD.calendar);

const routeBatteries = async (modules) => {
  await exportRouteBattery(modules);
  await exportCapBattery(modules);
  await exportWindowBattery(modules);
  await exportTruncationBattery(modules);
};

await routeBatteries(MOD);

const COLUMN_MUTANTS = [
  ["a vendor column accepted", [['if (col.prov !== "own" && col.prov !== "agg") throw new Error("export: vendor column " + page + "." + key);', ""]]],
  ["an unregistered column accepted", [['if (hits.length !== 1) throw new Error("export: unregistered or ambiguous " + page + "." + key);\n    const col = hits[0];', 'const col = hits[0] || { page, key, label: key, unit: "label", prov: "own", source: "x", dp: null, minN: 0, hold: null, note: "" };']]],
  ["the forbidden pair live", [['if (live.has(a) && live.has(b)) throw', "if (false) throw"]]],
  ["no hold ever active", [["const active = (c) => c.hold !== null && Object.hasOwn(holds, c.hold);", "const active = () => false;"]]],
  ["the page hold ignored", [['if (hold !== null) throw Object.assign(new Error("export: page held " + page), { code: "held", hold });', ""]]],
  ["an aggregate without a minimum accepted", [['if (col.prov === "agg" && !(col.minN >= 1)) throw new Error("export: agg without minN " + key);', ""]]],
  ["an undeclared hold accepted", [['if (col.hold !== null && !Object.hasOwn(HOLDS, col.hold)) throw new Error("export: unknown hold " + key);', ""]]],
  ["two windows enough", [["export const MIN_WINDOWS = 3;", "export const MIN_WINDOWS = 2;"]]],
  ["a reason grammar that allows anything", [["export const REASON_GRAMMAR = /^[A-Za-z0-9 ]{1,48}$/;", "export const REASON_GRAMMAR = /^.*$/;"]]],
  ["the vendor premium registered as own", [['C("*", k, k, "label", "vendor", "a field of the vendor\'s row")', 'C("*", k, k, "label", k === "prem" ? "own" : "vendor", "a field of the vendor\'s row")']]],
];

for (const [label, transforms] of COLUMN_MUTANTS) {
  ok(await killed(() => columnsBattery((extra) => loadMutated("shared/flows-columns.js", [...transforms, ...extra]))), "PLANTED " + label + " fails the columns battery");
}

const FORMAT_MUTANTS = [
  ["ratios truncated", [["(2n * n * s + d) / (2n * d)", "(n * s) / d"]]],
  ["a negative zero written", [["/^-0(?:\\.0*)?$/.test(t) ? t.slice(1) : t", "t"]]],
  ["formula cells not defanged", [['TRIGGER.test(s) ? "\'" + s : s', "s"]]],
  ["a tab not a formula trigger", [["const TRIGGER = /^[=+\\-@\\t\\r]/;", "const TRIGGER = /^[=+\\-@]/;"]]],
  ["a comma not quoted", [['/[",\\r\\n]/.test(v)', '/["\\r\\n]/.test(v)']]],
  ["a quote not doubled", [["v.replaceAll('\"', '\"\"')", "v"]]],
  ["an absent entry without its terminator", [['key + ":" + reason + ";"', 'key + ":" + reason']]],
  ["an ascii hyphen for the dash", [['export const DASH = "—";', 'export const DASH = "-";']]],
  ["a negative numerator allowed", [["if (d <= 0n || n < 0n) throw", "if (d <= 0n) throw"]]],
];

for (const [label, transforms] of FORMAT_MUTANTS) {
  ok(await killed(async () => formatBattery(await loadMutated("shared/flows-export-format.js", transforms))), "PLANTED " + label + " fails the format battery");
}

const WINDOW_MUTANTS = [
  ["the first duplicate kept", [["if (a !== null && (b === null || a > b)) best.set(key, r);", ""]]],
  ["windows without a contract merged", [['"\\u0000" + (typeof r.spanEnd === "string" ? r.spanEnd : "") : "row" + i;', '"\\u0000" + (typeof r.spanEnd === "string" ? r.spanEnd : "") : "row";']]],
  ["duplicates kept inside a ticker", [["for (const [t, list] of by) by.set(t, dedupeWindows(list));", ""]]],
  ["a missing sweep flag read as false", [["else if (s !== false) sweepMissing = true;", ""]]],
  ["a missing floor flag read as false", [["else if (f !== false) floorMissing = true;", ""]]],
  ["a record that says nothing taken as complete", [["return shed === null || shed > 0;", "return shed !== null && shed > 0;"]]],
  ["the payload date ahead of the record date", [["dayOf(isObj(flow.record) ? flow.record.date : null) || dayOf(flow.sessionDate)", "dayOf(flow.sessionDate) || dayOf(isObj(flow.record) ? flow.record.date : null)"]]],
  ["only the top shed count read", [["return top === null && rec === null ? null : Math.max(top === null ? 0 : top, rec === null ? 0 : rec);", "return top === null ? null : top;"]]],
  ["a lower-case symbol accepted", [["const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;", "const TICKER = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/;"]]],
];

for (const [label, transforms] of WINDOW_MUTANTS) {
  ok(await killed(async () => windowsBattery(await loadMutated("shared/flows-member-windows.js", transforms))), "PLANTED " + label + " fails the windows battery");
}

const CALENDAR_MUTANTS = [
  ["the horizon exclusive", [["sessionsUntil <= HORIZON_SESSIONS", "sessionsUntil < HORIZON_SESSIONS"]]],
  ["a past report inside the horizon", [["sessionsUntil >= 0 && ", ""]]],
  ["a missing count inside the horizon", [["Number.isFinite(sessionsUntil) && sessionsUntil >= 0", "!(sessionsUntil < 0)"]]],
  ["a horizon of 20", [["export const HORIZON_SESSIONS = 21;", "export const HORIZON_SESSIONS = 20;"]]],
  ["the window horizon exclusive", [["n !== null && n >= 0 && n <= HORIZON_SESSIONS", "n !== null && n >= 0 && n < HORIZON_SESSIONS"]]],
];

for (const [label, transforms] of CALENDAR_MUTANTS) {
  ok(await killed(async () => calendarBattery(await loadMutated("shared/flows-member-calendar.js", transforms))), "PLANTED " + label + " fails the calendar battery");
}

const BUILD_MUTANTS = [
  ["ask share over total premium", [["values.ask_share = ratioDigits(A, A + B, 4);", "values.ask_share = ratioDigits(A, T, 4);"]]],
  ["three windows too few", [["p.totals.n < MIN_WINDOWS) { absentAll", "p.totals.n <= MIN_WINDOWS) { absentAll"]]],
  ["the floor share on sweep premium", [["ratioDigits(p.floorT, p.totals.T, 4)", "ratioDigits(p.sweepT, p.totals.T, 4)"]]],
  ["the sweep share on floor premium", [["ratioDigits(p.sweepT, p.totals.T, 4)", "ratioDigits(p.floorT, p.totals.T, 4)"]]],
  ["a missing sweep flag counted as no sweep", [["if (p.sweepMissing) { values.sweep_share = null; why.sweep_share = \"sweep_partial\"; } else", "if (false) { values.sweep_share = null; why.sweep_share = \"sweep_partial\"; } else"]]],
  ["a missing floor flag counted as no floor", [["if (p.floorMissing) { values.negotiated_share = null; why.negotiated_share = \"floor_partial\"; } else", "if (false) { values.negotiated_share = null; why.negotiated_share = \"floor_partial\"; } else"]]],
  ["the lean reversed", [["values.lean = r.side;", 'values.lean = r.side === "buyers" ? "sellers" : r.side === "sellers" ? "buyers" : r.side;']]],
  ["a band edge belonging to the band below", [["totalCents < BAND_EDGES_CENTS[i]", "totalCents <= BAND_EDGES_CENTS[i]"]]],
  ["the band of the ask premium", [["bandOf(cells.p.totals.T)", "bandOf(cells.p.totals.A)"]]],
  ["the tail of the order kept on truncation", [["built.rows.slice(0, limit)", "built.rows.slice(-limit)"]]],
  ["no truncation by default", [["limit = MAX_ROWS", "limit = 1000000"]]],
  ["a cut CSV that does not say so", [["...(cutLine === null ? [] : [cutLine])", ""]]],
  ["the cut note padded one cell short", [['...header.slice(1).map(() => "")', '...header.slice(2).map(() => "")']]],
  ["the cut note ungrouped", [['replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",")', 'replace(/x^/g, ",")']]],
  ["a note on an exact fit", [["const truncated = available > shown.length;", "const truncated = available >= shown.length;"]]],
  ["a flow record of another session joined", [["const sameSession = flowOk && flowSession(flow) === session;", "const sameSession = flowOk;"]]],
  ["the newest source dates the file", [["Math.min(...instants)", "Math.max(...instants)"]]],
  ["the file dated in UTC", [["trtDay(asofMs)", "new Date(asofMs).toISOString().slice(0, 10)"]]],
  ["negative numbers defanged", [["col.dp === null ? String(value) : fixed(value, col.dp);\n  return col.unit", "col.dp === null ? String(value) : textCell(fixed(value, col.dp));\n  return col.unit"]]],
  ["an absent cell written as zero", [["if (value === null || value === undefined) return DASH;", 'if (value === null || value === undefined) return "0";']]],
  ["a held column left out of the absent cell", [["entries.push([c.key, REASONS[c.held.reason]]);", ""]]],
  ["no byte order mark", [['"\\uFEFF" + [header.join(",")', "[header.join(\",\")"]]],
  ["lines ending in a bare line feed", [['.join("\\r\\n") + "\\r\\n"', '.join("\\n") + "\\n"']]],
  ["the order of the universe kept", [["rows.sort(byTicker);\n  const sources = [{ name: \"universe\"", "const sources = [{ name: \"universe\""]]],
  ["events in ticker order", [["rows.sort((a, b) => a.until - b.until || byTicker(a, b));", "rows.sort(byTicker);"]]],
  ["an undated event at zero sessions", [["const until = num(r.sdte);", "const until = num(r.sdte) ?? 0;"]]],
  ["a capped record shown as complete", [["    if (cap) {", "    if (false) {"]]],
  ["a board of another session used", [["if (dayOf(b.sessionDate) !== session) { other = true; continue; }", ""]]],
  ["buys minus sells reversed", [["net_n: buys - sells,", "net_n: sells - buys,"]]],
  ["the held columns ignored", [["if (holds !== undefined) options.holds = holds;", ""]]],
  ["a vendor field leaking into a row", [["const values = { ticker, sig: null, rd: null };", "const values = { ticker, sig: null, rd: null, px: 1 };"]]],
  ["an absent value without a reason", [["if (z.z === null) { values.move_z = null; why.move_z = z.why; } else values.move_z = z.z;", "if (z.z === null) { values.move_z = null; } else values.move_z = z.z;"]]],
  ["a reason outside the table", [["why.move_z = z.why;", 'why.move_z = "because";']]],
  ["the simple return instead of the log return", [["const z = moveZ(c === undefined ? null : c, sg === undefined ? null : sg);", "const z = { z: c === null || c === undefined || !(sg > 0) ? null : c / sg, why: \"no_change\" };"]]],
  ["the sort of a political page by buys", [["rows.sort(byTicker);\n  return { rows, sources: [{ name: \"political\"", "rows.sort((a, b) => b.values.buys_n - a.values.buys_n);\n  return { rows, sources: [{ name: \"political\""]]],
];

for (const [label, transforms] of BUILD_MUTANTS) {
  ok(await killed(async () => buildBattery(await loadMutated("shared/flows-export-build.js", transforms))), "PLANTED " + label + " fails the build battery");
}

for (const [kind, label, transforms] of EXPORT_ROUTE_MUTANTS) {
  const modules = { ...MOD };
  if (kind === "route") modules.route = await loadMutated("server/routes/flows-me.js", transforms);
  else modules.store = await loadMutated("server/member-store.js", transforms);
  ok(await killed(() => routeBatteries(modules)), "PLANTED " + label + " fails the export route batteries");
}

console.error = quiet;
console.log("flows-member-export: " + T.checks + " checks");
