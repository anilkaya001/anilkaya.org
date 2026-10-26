import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "../shared/flows-reports.js";
import * as C from "../shared/flows-calendar.js";
import * as H from "../shared/flows-horizon.js";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-calendar.json"), "utf8"));
const HOLIDAYS = new Set(FIX.holidays);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const between = (a, b) => {
  let n = 0;
  for (let ms = Date.parse(a + "T00:00:00Z") + 86400000; ms <= Date.parse(b + "T00:00:00Z"); ms += 86400000) {
    const w = new Date(ms).getUTCDay();
    if (w !== 0 && w !== 6 && !HOLIDAYS.has(day(ms))) n++;
  }
  return n;
};

const hist = (date, time, extra = {}) => ({ report_date: date, report_time: time, source: "company", ...extra });
const rdAt = (rows, asOf) => R.rdOf(R.observeHistory(rows, asOf), asOf);
const cal = (route, date, asOf, ...symbols) => R.observeCalendar(symbols.map((symbol) => ({ symbol, report_date: date })), route, date, asOf);
const fixtureOf = (ticker, date, timing, origin = "history") => ({ asOf: "2026-03-09", rows: new Map([[ticker, { date, timing, origin, next: null }]]) });

{
  eq(R.timingOf("premarket"), "before-open", "premarket is before the open");
  eq(R.timingOf(" AMC "), "after-close", "amc, trimmed and in any case, is after the close");
  eq(R.timingOf("bmo"), "before-open", "bmo is before the open");
  eq(R.timingOf("postmarket"), "after-close", "postmarket is after the close");
  eq(R.timingOf("intraday"), "unknown", "a word the vendor does not use is not stated");
  eq(R.timingOf(null), "unknown", "null is not stated");
  eq(R.timingOf("unknown"), "unknown", "and neither is the vendor's own unknown");
}

{
  deep([rdAt([hist("2026-03-02", "premarket")], "2026-03-02")], [{ rd: 0, why: null }], "a report before the open on a Monday is rd 0 that Monday");
  deep([rdAt([hist("2026-03-02", "premarket")], "2026-03-03")], [{ rd: 1, why: null }], "and 1 the next day");

  const prior = hist("2025-12-04", "premarket");
  const fri = hist("2026-03-06", "postmarket");
  const friDay = rdAt([prior, fri], "2026-03-06");
  deep(friDay, { rd: between("2025-12-04", "2026-03-06"), why: null }, "on the Friday of an after-close report the new report has not reacted: rd is the age of the one before");
  eq(friDay.rd, 62, "which is 62 sessions");
  deep(rdAt([prior, fri], "2026-03-09"), { rd: 0, why: null }, "on the Monday it is rd 0");
  deep(rdAt([prior, fri], "2026-03-10"), { rd: 1, why: null }, "and 1 on the Tuesday");
  deep(rdAt([fri], "2026-03-06"), { rd: null, why: "none" }, "with no earlier report on file the Friday is none, not zero");

  deep(rdAt([hist("2025-11-26", "postmarket")], "2025-11-28"), { rd: 0, why: null }, "after the close on the Wednesday before Thanksgiving reacts on the Friday, the early close, rd 0");
  deep(rdAt([hist("2025-11-26", "postmarket")], "2025-12-01"), { rd: 1, why: null }, "and rd 1 on the Monday");
  deep(rdAt([hist("2025-11-26", "postmarket")], "2025-11-27"), { rd: null, why: "none" }, "on Thanksgiving itself it has not reacted");
  deep(rdAt([hist("2026-04-02", "postmarket")], "2026-04-06"), { rd: 0, why: null }, "after the close the Thursday before Good Friday reacts on the Monday");
  for (const t of ["premarket", "postmarket", "unknown", null]) {
    deep(rdAt([hist("2026-03-07", t)], "2026-03-09"), { rd: 0, why: null }, `a Saturday-dated report (${t}) reacts on the Monday and is certain whatever its time`);
  }
  deep(rdAt([hist("2026-02-16", "premarket")], "2026-02-17"), { rd: 0, why: null }, "a premarket report dated on Presidents Day reacts on the Tuesday");

  deep(rdAt([hist("2026-03-04", "unknown")], "2026-03-10"), { rd: null, why: "timing", rdMax: 4 }, "a report with no stated time 4 sessions back is not given an rd, only that it is at most 4 old");
  deep(rdAt([hist("2026-03-10", "unknown")], "2026-03-10"), { rd: null, why: "timing", rdMax: 0 }, "and one dated today is at most 0 old");
  deep(rdAt([hist("2026-03-06", " AMC ")], "2026-03-09"), { rd: 0, why: null }, "amc with stray spaces and capitals is after the close");
  deep(rdAt([hist("2026-03-06", "intraday")], "2026-03-09"), { rd: null, why: "timing", rdMax: 1 }, "intraday is not stated");
  eq(R.span("2026-03-06", "unknown").certain, false, "an unknown time on a session day spans two sessions");
}

{
  const asOf = "2026-03-02";
  deep(rdAt([hist("2025-10-07", "premarket")], asOf), { rd: 99, why: null }, "rd 99 is kept: a premarket report on 7 October 2025 is 99 sessions before 2 March 2026");
  eq(between("2025-10-07", asOf), 99, "by an independent count from the exchange's holiday list");
  deep(rdAt([hist("2025-10-06", "postmarket")], asOf), { rd: 99, why: null }, "after the close on 6 October is the same session, 99");
  deep(rdAt([hist("2025-10-06", "premarket")], asOf), { rd: null, why: "over" }, "premarket on 6 October is 100: null, over, never 99 standing in for it");
  eq(between("2025-10-06", asOf), 100, "which the independent count agrees with");
  deep(rdAt([hist("2025-10-06", "unknown")], asOf), { rd: null, why: "timing", rdMax: 100 }, "an unknown time across the line keeps its interval: 99 or 100");
  deep(rdAt([hist("2025-10-03", "unknown")], asOf), { rd: null, why: "over" }, "and one so old that even its younger candidate is over 99 is over");
}

{
  deep(rdAt([hist("2026-02-20", "postmarket", { source: "estimation" })], "2026-03-02"), { rd: null, why: "none" }, "an estimation row with no figures is not a report");
  deep(rdAt([hist("2026-02-20", "postmarket", { source: "estimation", actual_eps: "0.42" })], "2026-03-02"), { rd: 5, why: null }, "the same row with an actual figure is");
  deep(rdAt([hist("2026-02-20", "postmarket", { source: "estimation", post_earnings_move_1d: "0.03" })], "2026-03-02"), { rd: 5, why: null }, "and so is one with a measured move");
  eq(R.isReport({ source: "estimation", actual_eps: null, post_earnings_move_1d: null, report_date: "2026-02-20" }), false, "null figures do not count");
  eq(R.isReport({ source: "company" }), false, "no date is no report");
}

const asOf9 = "2026-03-09";
{
  const log = [];
  const a = R.mergeObservations([cal("premarket", "2026-03-09", asOf9, "ZQAL"), new Map([["ZQAL", R.observeHistory([hist("2026-03-09", "unknown")], asOf9)]])], log);
  eq(R.rdOf(a.get("ZQAL"), asOf9).rd, 0, "tonight's calendar and a history row with no time agree on the day: rd 0");
  eq(a.get("ZQAL").origin, "calendar", "and the calendar's stated time wins");
  eq(log.length, 1, "the disagreement over the time is logged");
  const b = R.mergeLedger(
    { asOf: "2026-03-06", rows: new Map([["ZQBM", { date: "2026-03-04", timing: "before-open", origin: "calendar", next: null }]]) },
    new Map([["ZQBM", R.observeHistory([hist("2026-03-05", "premarket")], asOf9)]]),
    { asOf: asOf9, universe: ["ZQBM"] });
  eq(b.cells.get("ZQBM").rd, 3, "a calendar entry kept on the ledger beats tonight's history row for the same report one session later: rd 3, where latest-wins gives 2");
  eq(b.log.length, 1, "and the disagreement is logged");
  const c = R.mergeLedger(
    { asOf: "2026-03-06", rows: new Map([["ZQCN", { date: "2026-03-03", timing: "before-open", origin: "history", next: null }]]) },
    new Map([["ZQCN", R.observeHistory([hist("2026-03-04", "premarket")], asOf9)]]),
    { asOf: asOf9, universe: ["ZQCN"] });
  eq(c.cells.get("ZQCN").rd, 3, "of two history rows for one report the fresh one wins");
  const d = R.mergeLedger(
    { asOf: "2026-03-06", rows: new Map([["ZQDP", { date: "2025-12-04", timing: "before-open", origin: "history", next: "2026-03-06" }]]) },
    cal("afterhours", "2026-03-06", asOf9, "ZQDP"),
    { asOf: asOf9, universe: ["ZQDP"], covered: new Set(["2026-03-09"]) });
  eq(d.cells.get("ZQDP").rd, 0, "a report a quarter later is a new report whatever its source: rd 0");
  eq(d.log.length, 0, "and no disagreement");
}

{
  deep(R.reactionPlan("2026-02-17", "2026-02-13").map((s) => [s.route, s.date]), [["premarket", "2026-02-17"], ["afterhours", "2026-02-13"]], "after Presidents Day the reaction reads are Tuesday's premarket and Friday's after-hours, not Monday's");
  deep(R.reactionPlan("2026-04-06", "2026-04-02").map((s) => [s.route, s.date]), [["premarket", "2026-04-06"], ["afterhours", "2026-04-02"]], "after Good Friday it is Thursday's after-hours");
  deep(R.reactionPlan("2025-11-28", "2025-11-26").map((s) => [s.route, s.date]), [["premarket", "2025-11-28"], ["afterhours", "2025-11-26"]], "after Thanksgiving it is Wednesday's");
  deep(R.reactionPlan("2026-03-09", null).map((s) => [s.route, s.date]), [["premarket", "2026-03-09"], ["afterhours", "2026-03-06"]], "with no ledger one night is read");
  deep(R.reactionPlan("2026-03-09", "2026-03-05").map((s) => [s.route, s.date, s.day]), [
    ["premarket", "2026-03-06", "2026-03-06"], ["afterhours", "2026-03-05", "2026-03-06"],
    ["premarket", "2026-03-09", "2026-03-09"], ["afterhours", "2026-03-06", "2026-03-09"]], "after a skipped night both nights are read, oldest first");
  const long = R.reactionPlan("2026-03-09", "2026-02-25");
  deep([...new Set(long.map((s) => s.day))], ["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09"], "a gap of 8 sessions is backfilled for the last 5 only");
  eq(R.reactionPlan("2026-03-08", null).length, 0, "a Sunday is not a session and has no plan");
  eq(R.reactionPlan("2026-03-09", "2026-03-09").length, 2, "a ledger of the same day still reads the one night");
}

{
  const u = ["ZQAL", "ZQBM", "ZQCN"];
  const prior = {
    asOf: "2026-03-05",
    rows: new Map([
      ["ZQAL", { date: "2026-03-05", timing: "before-open", origin: "history", next: "2026-06-04" }],
      ["ZQBM", { date: "2025-12-10", timing: "before-open", origin: "history", next: "2026-03-06" }],
      ["ZQCN", { date: "2025-12-12", timing: "after-close", origin: "history", next: "2026-03-09" }],
    ]),
  };
  const plan = R.reactionPlan("2026-03-09", prior.asOf);
  const steps = plan.map((s) => ({ ...s, ok: true, cut: s.route === "premarket" && s.day === "2026-03-06" }));
  const cov = R.coveredDays(steps);
  deep([[...cov.covered], cov.cut], [["2026-03-09"], ["2026-03-06"]], "a day whose premarket read came back full is not covered and is named");
  const fresh = cal("premarket", "2026-03-06", "2026-03-09", "ZQDX");
  const m = R.mergeLedger(prior, fresh, { asOf: "2026-03-09", universe: u, covered: cov.covered, next: new Map([["ZQAL", "2026-06-04"]]) });
  eq(m.cells.get("ZQAL").rd, 2, "a report on the stored ledger from 5 March is rd 2 on 9 March");
  deep(m.cells.get("ZQBM"), { rd: null, why: "unconfirmed" }, "a name whose next report fell on a day whose reads were cut, with no sighting since, is unconfirmed");
  ok(!m.ledger.rows.has("ZQBM"), "and loses its stale entry");
  eq(m.cells.get("ZQCN").rd, between("2025-12-15", "2026-03-09"), "a name whose next report fell on a covered day, and was not seen there, keeps its report");
  const gone = R.mergeLedger(prior, new Map(), { asOf: "2026-03-09", universe: ["ZQAL"], covered: new Set() });
  deep([...gone.ledger.rows.keys()], ["ZQAL"], "a name that left the universe is dropped from the ledger");
  const fresh2 = R.mergeLedger(prior, new Map(), { asOf: "2026-03-09", universe: ["ZQAL", "ZQEQ"], covered: new Set() });
  deep(fresh2.cells.get("ZQEQ"), { rd: null, why: "none" }, "a new name has no report: none");
  const filled = R.mergeLedger(fresh2.ledger, new Map([["ZQEQ", R.observeHistory([hist("2026-02-26", "postmarket")], "2026-03-09")]]), { asOf: "2026-03-09", universe: ["ZQAL", "ZQEQ"] });
  eq(filled.cells.get("ZQEQ").rd, between("2026-02-27", "2026-03-09"), "and is filled once a history read sees it, its after-close report of 26 February reacting on the 27th");
  const noPrior = R.mergeLedger({ asOf: null, rows: new Map() }, new Map(), { asOf: "2026-03-09", universe: ["ZQAL"] });
  deep(noPrior.cells.get("ZQAL"), { rd: null, why: "none" }, "with no ledger at all nothing is unconfirmed, only unknown");
  const old = R.mergeLedger({ asOf: "2026-03-05", rows: new Map([["ZQAL", { date: "2025-10-06", timing: "before-open", origin: "history", next: null }]]) }, new Map(), { asOf: "2026-03-09", universe: ["ZQAL"] });
  deep(old.cells.get("ZQAL"), { rd: null, why: "over" }, "an entry that has aged past 99 sessions is over");
  ok(!old.ledger.rows.has("ZQAL"), "and is pruned");
}

{
  const prior = {
    asOf: "2026-03-09",
    rows: new Map([
      ["ZQAL", { date: "2026-03-09", timing: "before-open", origin: "calendar", next: null }],
      ["ZQBM", { date: "2026-02-17", timing: "after-close", origin: "history", next: "2026-04-28" }],
      ["ZQCN", { date: "2026-03-04", timing: "unknown", origin: "history", next: null }],
    ]),
  };
  const wire = R.encodeLedger(prior);
  deep(wire, { v: 1, asOf: "2026-03-09", t: ["ZQAL", "ZQBM", "ZQCN"], d: [0, 20, 5], w: [3, 2, 0], n: [null, 50, null] }, "the wire form: sorted tickers, calendar-day offsets back from the ledger's day, a code for time and origin, and the next date as an offset forward");
  deep(R.decodeLedger(JSON.parse(JSON.stringify(wire))), prior, "decodes back to the same rows");
  deep(R.decodeLedger({ ...wire, v: 2 }).rows.size, 0, "a wrong version is empty and never throws");
  eq(R.decodeLedger(null).asOf, null, "null is empty");
  eq(R.decodeLedger({ v: 1, asOf: "nope", t: [] }).rows.size, 0, "a bad day is empty");
  eq(R.decodeLedger({ v: 1, asOf: "2026-03-09", t: ["A", 5, ""], d: [1], w: [], n: [] }).rows.size, 1, "a malformed entry is skipped, the good one kept");
  const bytes = JSON.stringify(R.encodeLedger({
    asOf: "2026-03-09",
    rows: new Map(Array.from({ length: 1000 }, (_, i) => ["SYX" + String(i).padStart(3, "0"), { date: "2026-02-17", timing: "after-close", origin: "history", next: "2026-04-28" }])),
  })).length;
  ok(bytes < 22000, `the ledger of 1,000 names is ${bytes} bytes`);
}

{
  const cells = new Map([
    ["A", { rd: 0 }], ["B", { rd: 40 }], ["C", { rd: null, why: "none" }], ["D", { rd: null, why: "over" }],
    ["E", { rd: null, why: "unconfirmed" }], ["F", { rd: null, why: "timing", rdMax: 3 }], ["G", { rd: null, why: "timing", rdMax: 0 }], ["H", { rd: null, why: "timing", rdMax: 7 }],
  ]);
  const b = R.basisOf(cells, { asOf: "2026-03-09", from: "2026-03-06", cutDays: ["2026-03-09"] });
  deep([b.known, b.none, b.over, b.timing, b.unconfirmed, b.unstated, b.cut], [2, 1, 1, 3, ["E"], { F: 3, G: 0 }, ["2026-03-09"]], "the basis counts every null by its reason and lists the unstated names that are still inside the window, including one dated today");
  eq(R.cellOf(null, "X").why, "none", "no reports at all reads as none");
}

{
  const real = await loadMutated("shared/flows-reports.js", [], { salt: 1 });
  const battery = (m) => {
    try {
      const r = (rows, asOf) => m.rdOf(m.observeHistory(rows, asOf), asOf);
      if (r([hist("2026-03-06", "postmarket"), hist("2025-12-04", "premarket")], "2026-03-06").rd !== 62) return false;
      if (r([hist("2026-03-06", "postmarket")], "2026-03-09").rd !== 0) return false;
      if (r([hist("2025-11-26", "postmarket")], "2025-11-28").rd !== 0) return false;
      if (r([hist("2026-03-07", "unknown")], "2026-03-09").rd !== 0) return false;
      if (r([hist("2026-03-06", " AMC ")], "2026-03-09").rd !== 0) return false;
      if (r([hist("2026-03-06", "bmo")], "2026-03-06").rd !== 0) return false;
      if (r([hist("2026-03-04", "unknown")], "2026-03-10").rd !== null) return false;
      if (r([hist("2025-10-07", "premarket")], "2026-03-02").rd !== 99) return false;
      if (r([hist("2025-10-06", "premarket")], "2026-03-02").rd !== null) return false;
      if (r([hist("2026-02-20", "postmarket", { source: "estimation" })], "2026-03-02").rd !== null) return false;
      const b = m.mergeLedger(
        { asOf: "2026-03-06", rows: new Map([["Z", { date: "2026-03-04", timing: "before-open", origin: "calendar", next: null }]]) },
        new Map([["Z", m.observeHistory([hist("2026-03-05", "premarket")], "2026-03-09")]]), { asOf: "2026-03-09", universe: ["Z"] });
      if (b.cells.get("Z").rd !== 3) return false;
      const plan = m.reactionPlan("2026-03-09", "2026-03-05");
      if (plan.length !== 4 || plan[1].date !== "2026-03-05") return false;
      if (m.reactionPlan("2026-02-17", "2026-02-13")[1].date !== "2026-02-13") return false;
      const cov = m.coveredDays(plan.map((s) => ({ ...s, ok: true, cut: s.day === "2026-03-06" && s.route === "premarket" })));
      if (cov.covered.has("2026-03-06") || !cov.covered.has("2026-03-09")) return false;
      const prior = { asOf: "2026-03-05", rows: new Map([["Y", { date: "2025-12-10", timing: "before-open", origin: "history", next: "2026-03-06" }]]) };
      const g = m.mergeLedger(prior, new Map(), { asOf: "2026-03-09", universe: ["Y"], covered: new Set(["2026-03-09"]) });
      if (g.cells.get("Y").why !== "unconfirmed") return false;
      const aged = m.mergeLedger({ asOf: "2026-03-05", rows: new Map([["Z", { date: "2025-10-06", timing: "before-open", origin: "history", next: null }]]) }, new Map(), { asOf: "2026-03-09", universe: ["Z"] });
      if (aged.ledger.rows.has("Z") || aged.cells.get("Z").why !== "over") return false;
      const w = m.encodeLedger({ asOf: "2026-03-09", rows: new Map([["Z", { date: "2026-02-17", timing: "after-close", origin: "history", next: "2026-04-28" }]]) });
      if (w.d[0] !== 20 || w.w[0] !== 2 || w.n[0] !== 50) return false;
      const ledger = m.decodeLedger(w);
      const cw = m.decodeLedger(m.encodeLedger({ asOf: "2026-03-09", rows: new Map([["Z", { date: "2026-03-09", timing: "before-open", origin: "calendar", next: null }]]) }));
      return ledger.rows.get("Z").date === "2026-02-17" && cw.rows.get("Z").origin === "calendar" && cw.rows.get("Z").timing === "before-open";
    } catch {
      return false;
    }
  };
  ok(battery(real), "the unmutated copy passes the battery the wrong builds are held to");
  const builds = [
    ["bmo and amc not recognised", [["bmo: \"before-open\", postmarket: \"after-close\", amc: \"after-close\"", "postmarket: \"after-close\""]]],
    ["an estimation row with no figures counted", [["return row.source === \"company\" || (row.actual_eps", "return row.source !== \"\" || (row.actual_eps"]]],
    ["a report after the close counted on its own date", [["const first = impactSession(date, timing === \"after-close\" ? \"postmarket\" : \"premarket\");", "const first = impactSession(date, \"premarket\");"], ["const last = impactSession(date, timing === \"before-open\" ? \"premarket\" : \"postmarket\");", "const last = impactSession(date, \"premarket\");"]]],
    ["latest wins whatever the source", [["if (Math.abs(gap) <= SAME_REPORT && rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;", ""]]],
    ["history beats the calendar", [["(o.origin === \"calendar\" ? 2 : 0)", "(o.origin === \"calendar\" ? -2 : 0)"]]],
    ["an unstated time given an rd", [["if (!o.certain) return Math.max(hi - 1, 0) > RD_MAX ? { rd: null, why: \"over\" } : { rd: null, why: \"timing\", rdMax: hi };", "if (!o.certain) return { rd: hi, why: null };"]]],
    ["rd past 99 kept", [["return hi > RD_MAX ? { rd: null, why: \"over\" } : { rd: hi, why: null };", "return { rd: hi, why: null };"]]],
    ["rd 99 refused", [["return hi > RD_MAX ? { rd: null, why: \"over\" }", "return hi >= RD_MAX ? { rd: null, why: \"over\" }"]]],
    ["no backfill after a skipped night", [["const gap = Math.min(Math.max(raw === null ? 1 : raw, 1), BACKFILL_MAX);", "const gap = 1;"]]],
    ["the reaction read of the previous weekday, not the previous session", [["const before = day ? addSessions(day, -1) : null;", "const before = day ? (new Date(Date.parse(day + \"T00:00:00Z\") - 86400000).toISOString().slice(0, 10)) : null;"]]],
    ["a cut calendar day counted as covered", [["if (s.ok && !s.cut) e.ok++;", "if (s.ok) e.ok++;"]]],
    ["a stale entry kept after a skipped report day", [["const gap = due && before.asOf && due.early > before.asOf && due.early <= asOf && !coveredDays.has(due.early);", "const gap = false;"]]],
    ["the ledger never pruned past 99 sessions", [["if (cells.get(t).why === \"over\") kept = null;", ""]]],
    ["the ledger's offsets counted forward", [["d: t.map((k) => (r(k).date ? base - dayNum(r(k).date) : null)),", "d: t.map((k) => (r(k).date ? dayNum(r(k).date) - base : null)),"]]],
    ["calendar origin lost on the wire", [["CODES.indexOf(r(k).timing) + (r(k).origin === \"calendar\" ? 2 : 0)", "CODES.indexOf(r(k).timing)"]]],
  ];
  let salt = 2;
  for (const [title, transforms] of builds) {
    const bad = await loadMutated("shared/flows-reports.js", transforms, { salt: salt++ });
    ok(!battery(bad), `PLANTED WRONG BUILD, ${title}: the battery fails it`);
  }
  const state = (mut) => ({ s: (row, hz, j) => mut.earningsState(row, hz, j) });
  const hz = await loadMutated("shared/flows-horizon.js", [], { salt: 50 });
  const bad1 = await loadMutated("shared/flows-horizon.js", [["if (whole(rd) && rd >= 0) ages.push(rd + j);", "if (rd <= 99) ages.push(rd + j);"]], { salt: 51 });
  eq(hz.earningsState({ ed: 5, rd: null }, 21, 0), "ahead", "a null rd is no age at all");
  eq(bad1.earningsState({ ed: 5, rd: null }, 21, 0), "reaction", "PLANTED WRONG BUILD, null <= 99: a name with no rd becomes a reaction");
  const bad2 = await loadMutated("shared/flows-horizon.js", [["if (whole(ed) && ed >= 0 && ed <= j) ages.push(j - ed);", ""]], { salt: 52 });
  eq(bad2.earningsState({ ed: 1, rd: null }, 21, 1), "clear", "PLANTED WRONG BUILD, rd plus the elapsed sessions alone: a name whose next report lands today is not seen");
  eq(state(hz).s({ ed: 1, rd: null }, 21, 1), "reaction", "while the real one tags it");
  ok(H.RD_MAX === R.RD_RECENT * 19 + 4, "the rd ceiling stays 99");
}

console.log(`✓ flows-reports: ${checks} assertions — the last report of a name read from history rows and the date-scoped calendars with its impact session (premarket on a Monday, after the close on a Friday, before Thanksgiving and Good Friday, on a Saturday and on Presidents Day), unknown times kept as intervals and never defaulted, rd 99 kept and 100 refused against an independent count, estimation rows refused without a figure, the precedence of a stated time and of the calendar, the ledger's skipped night, cut calendar day, universe churn and wire round trip, and 16 planted wrong builds`);
