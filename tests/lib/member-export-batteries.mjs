import { ok, eq } from "./member-batteries.mjs";
import * as X from "./member-export-world.mjs";

export function parseCsv(text) {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\r" && t[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export const DASH = "—";
export const NOW = Date.parse("2026-10-24T06:41:00.000Z");
const FIXED = (x, dp) => { const t = x.toFixed(dp); return /^-0(\.0*)?$/.test(t) ? t.slice(1) : t; };
const zOf = (chg, sig) => Math.log(1 + chg) / sig;

export const HEAD_MOVES = ["asof_trt", "method_version", "ticker", "sig", "move_z", "rd", "ask_share", "ask_share_lo", "ask_share_hi", "coverage", "lean", "absent"];
export const HEAD_UNUSUAL = ["asof_trt", "method_version", "ticker", "windows_n", "premium_band", "ask_share", "ask_share_lo", "ask_share_hi", "coverage", "negotiated_share", "sweep_share", "score", "absent"];

export function formatBattery(F) {
  eq(F.ratioDigits(1, 3, 4), "0.3333", "one third");
  eq(F.ratioDigits(2, 3, 4), "0.6667", "two thirds rounds up");
  eq(F.ratioDigits(1005, 100000, 4), "0.0101", "0.01005 rounds half up to 0.0101");
  eq(F.ratioDigits(5, 10, 0), "1", "a half rounds up at zero places");
  eq(F.ratioDigits(0, 5, 4), "0.0000", "zero");
  eq(F.ratioDigits(7, 7, 4), "1.0000", "one");
  eq(F.ratioDigits(123456789012345n, 1000000000000000n, 4), "0.1235", "a large exact ratio");
  let threw = 0;
  for (const bad of [[1, 0], [-1, 2]]) { try { F.ratioDigits(bad[0], bad[1], 4); } catch { threw += 1; } }
  eq(threw, 2, "a zero denominator and a negative numerator are refused");
  eq(F.fixed(-0.001, 2), "0.00", "a negative zero is written 0.00");
  eq(F.fixed(-3.21, 2), "-3.21", "a negative number keeps its sign");
  eq(F.fixed(0, 2), "0.00", "zero");
  eq(["=1+1", "+x", "-x", "@x", "\tx", "plain"].map(F.textCell), ["'=1+1", "'+x", "'-x", "'@x", "'\tx", "plain"], "a text cell that starts like a formula is defanged");
  eq(F.textCell("a,b"), '"a,b"', "a comma quotes");
  eq(F.textCell('say "hi"'), '"say ""hi"""', "a quote doubles");
  eq([F.textCell(" x"), F.textCell("x ")], ['" x"', '"x "'], "a leading or trailing space quotes");
  eq(F.textCell("line\nbreak"), '"line\nbreak"', "a newline quotes");
  eq(F.absentCell([["sig", "held pending licence review"], ["rd", "report distance not published yet"]]), "sig:held pending licence review;rd:report distance not published yet;", "the absent cell lists key and reason with a semicolon after each");
  eq(F.absentCell([]), "", "and is empty when nothing is absent");
  eq(F.DASH, DASH, "the em dash");
}

export async function columnsBattery(load) {
  const C = await load([]);
  const bad = async (extra) => { try { (await load(extra)).plan("moves"); return false; } catch { return true; } };
  eq(C.plan("moves").map((c) => c.key), HEAD_MOVES, "the Moves header is the envelope, the allowlist and the absent column");
  eq(C.plan("unusual").map((c) => c.key), HEAD_UNUSUAL, "and the Unusual header");
  for (const page of Object.keys(C.PAGE_HOLDS)) {
    let held = null;
    try { C.plan(page); } catch (e) { held = e.code; }
    eq(held, "held", page + " is held");
  }
  eq(C.plan("events", { pageHolds: {}, holds: {} }).map((c) => c.key), ["asof_trt", "method_version", "ticker", "event_type", "sessions_until", "rd", "contamination", "absent"], "a held page builds once its hold is lifted");
  eq(C.plan("political", { pageHolds: {}, holds: {} }).map((c) => c.key).slice(2, 5), ["ticker", "transactions_n", "buys_n"], "and so does Political");
  let pair = false;
  try { C.plan("moves", { holds: {} }); } catch (e) { pair = /forbidden pair/.test(e.message); }
  ok(pair, "sig and move_z are never live together");
  ok(C.plan("moves", { holds: {}, forbidden: [] }).every((c) => c.held === null), "unless the owner lifts both holds and the rule");
  const live = C.plan("moves");
  eq([live.find((c) => c.key === "sig").held.reason, live.find((c) => c.key === "rd").held.reason, live.find((c) => c.key === "move_z").held], ["held_licence", "held_event_dates", null], "sig and rd are held, move_z is live");
  const vendorNames = ["px", "chg", "mcap", "iv30p", "total_premium", "prem", "strike", "expiry", "span_start", "span_end", "event_date", "implied_move", "sector", "amount_lo", "amount_hi", "filer"];
  ok(vendorNames.every((k) => C.COLUMNS.filter((c) => c.key === k).every((c) => c.prov === "vendor") && C.COLUMNS.some((c) => c.key === k)), "the sixteen vendor fields are registered as vendor, so that the builder can refuse them");
  ok(C.COLUMNS.filter((c) => c.prov === "vendor").length === vendorNames.length, "and nothing else is");
  for (const page of Object.keys(C.ALLOW)) {
    for (const key of C.ALLOW[page]) {
      const hits = C.COLUMNS.filter((c) => c.key === key && (c.page === "*" || c.page === page));
      eq([hits.length, ["own", "agg"].includes(hits[0] && hits[0].prov)], [1, true], page + "." + key + " is registered once and is own or agg");
    }
  }
  ok(C.COLUMNS.every((c) => !c.source.includes("<") && C.UNITS.includes(c.unit)), "no source is a placeholder and every unit is known");
  ok(Object.values(C.REASONS).every((r) => /^[A-Za-z0-9 ]{1,48}$/.test(r)), "every reason text is plain words, whatever the module's own grammar says");
  ok(["a;b", "a:b", "", "a".repeat(49), "a,b", "a\nb"].every((t) => !C.REASON_GRAMMAR.test(t)) && C.REASON_GRAMMAR.test("sided premium under 250k USD"), "and the grammar refuses the separators the absent cell uses");
  ok(C.REASONS.few_windows.includes(String(C.MIN_WINDOWS)), "and the few-windows reason names the minimum the builder applies");
  ok(C.COLUMNS.filter((c) => c.prov === "agg" && c.key !== "windows_n" && c.page !== "political").every((c) => c.minN >= C.MIN_WINDOWS), "every flow aggregate but the count needs at least three windows");
  ok(await bad([['moves: Object.freeze(["ticker", "sig",', 'moves: Object.freeze(["px", "ticker", "sig",']]), "a vendor column in an allowlist fails the build");
  ok(await bad([['moves: Object.freeze(["ticker", "sig",', 'moves: Object.freeze(["ticker", "ask_share_zz", "sig",'], ['C("*", "ask_share_lo",', 'C("*", "ask_share_zz", "x", "fraction", "agg", "x", { dp: 4 }),\n  C("*", "ask_share_lo",']]), "an aggregate without a minimum window count fails the build");
  ok(await bad([['C("moves", "move_z", "Move in typical moves", "z", "own", "ln(1 + universe.cols.chg) over universe.cols.sig", { dp: 2 })', 'C("moves", "move_z", "Move in typical moves", "z", "own", "ln(1 + universe.cols.chg) over universe.cols.sig", { dp: 2, hold: "zz" })']]), "a column that names a hold nobody declared fails the build");
  ok(await bad([['moves: Object.freeze(["ticker", "sig",', 'moves: Object.freeze(["zz_unregistered", "ticker", "sig",']]), "and so does an unregistered one");
}

export function windowsBattery(Wn) {
  const row = (extra) => ({ t: "SYA001", oc: "SYA001261120C00100000", spanStart: "2026-10-23T14:10:00.000Z", spanEnd: "2026-10-23T14:12:00.000Z", prem: 1000000, askPrem: 600000, bidPrem: 100000, single: true, sweep: false, floor: false, ...extra });
  const dup = Wn.dedupeWindows([row({ rule: "a", prem: 900000 }), row({ rule: "b", prem: 1000000 }), row({ rule: "c", prem: 800000 }), row({ oc: "SYA001261120C00105000", rule: "d" })]);
  eq(dup.map((r) => [r.rule, r.prem]), [["b", 1000000], ["d", 1000000]], "windows that share contract and span are one, the largest premium kept");
  eq(Wn.dedupeWindows([row({ oc: null }), row({ oc: null })]).length, 2, "windows without a contract or span are never merged");
  const p = Wn.pooled([row({ sweep: true }), row({ floor: true, oc: "x1" }), row({ sweep: null, oc: "x2" })]);
  eq([p.totals.n, p.sweepT, p.floorT, p.sweepMissing, p.floorMissing], [3, 100000000, 100000000, true, false], "a missing sweep flag is flagged, not counted as false");
  const q = Wn.pooled([row({ floor: undefined }), row({ oc: "x3" })]);
  eq([q.floorMissing, q.sweepMissing], [true, false], "and an absent floor flag is flagged");
  eq([Wn.capped({ shed: 0, record: { shed: 0 } }), Wn.capped({ shed: 3 }), Wn.capped({ shed: 0, record: { shed: 2 } }), Wn.capped({}), Wn.capped(null)], [false, true, true, true, true], "a record is capped when it shed anything, or says nothing");
  eq([Wn.flowSession({ record: { date: "2026-10-23" }, sessionDate: "2026-10-22" }), Wn.flowSession({ sessionDate: "2026-10-22T00:00:00Z" }), Wn.flowSession(null)], ["2026-10-23", "2026-10-22", null], "the record's date wins over the payload's");
  eq(Wn.windowsByTicker({ rows: [row({}), row({ t: "SYA002", oc: "z" }), { t: "bad name" }] }).size, 2, "windows group by valid ticker");
  eq(Wn.windowsByTicker({ rows: [row({ rule: "a" }), row({ rule: "b" }), row({ t: "SYA002", rule: "c" })] }).get("SYA001").length, 1, "and are deduplicated inside a ticker");
  eq(Wn.windowsByTicker({ rows: [row({ t: "SYA001" }), row({ t: "SYA002" })] }, (r) => r.t === "SYA002").size, 1, "and a filter keeps only what it names");
  eq(Wn.tickerOf("sya001"), null, "a lower-case symbol is not a ticker");
  eq([Wn.tickerOf("SYA001"), Wn.tickerOf("BRK.B"), Wn.tickerOf("A".repeat(11)), Wn.tickerOf(7), Wn.tickerOf("")], ["SYA001", "BRK.B", null, null, null], "ticker grammar");
  eq([Wn.dayOf("2026-10-23T21:45:00Z"), Wn.dayOf("26-10-23"), Wn.dayOf(null)], ["2026-10-23", null, null], "day grammar");
  eq([Wn.shedOf({ shed: 2, record: { shed: 5 } }), Wn.shedOf({ shed: 0 }), Wn.shedOf({})], [5, 0, null], "the larger shed count wins and none is null");
}

const rowOf = (j, t) => j.rows.find((r) => r.ticker === t);

export function buildBattery(B) {
  const body = (page, src, extra = {}) => JSON.parse(B.buildExport(page, src, { now: NOW, format: "json", ...extra }).body);
  const src = X.sources();
  const j = body("moves", src);
  eq(j.meta.columns.map((c) => c.key), HEAD_MOVES, "the Moves JSON lists the header");
  eq([j.meta.page, j.meta.method_version, j.meta.session_date, j.meta.rows, j.meta.available, j.meta.truncated], ["moves", "flows-export-1", X.SESSION, 8, 8, false], "and the page, version, session and counts");
  eq(j.meta.asof_trt, "2026-10-24 00:10 TRT", "the as-of is the oldest source in TRT: the universe at 21:10 UTC is 00:10 the next day");
  eq(j.rows.map((r) => r.ticker), X.UNIVERSE_ROWS.map((r) => r.t).sort(), "rows are in ticker order");
  ok(j.rows.every((r) => r.asof_trt === j.meta.asof_trt && r.method_version === "flows-export-1"), "every row starts with the same as-of and the method version");
  const a = rowOf(j, "SYA001");
  const flow = X.oracleFlow(X.FLOW_ROWS.filter((r) => r.t === "SYA001"));
  eq(a.sig, null, "sig is held, so it is absent and not computed");
  eq(a.move_z, Number(FIXED(zOf(0.06, 0.02), 2)), "move_z is the log return over the typical move: 2.91, where the simple ratio says 3.00");
  eq([a.ask_share, a.ask_share_lo, a.ask_share_hi, a.coverage, a.lean], [Number(flow.share), Number(flow.lo), Number(flow.hi), Number(flow.coverage), flow.lean], "the flow cells are the ratio of sums from integer cents");
  eq([flow.share, flow.lo, flow.hi, flow.coverage, flow.lean], ["0.6622", "0.4900", "0.7500", "0.7400", "undetermined"], "which are 0.6622, 0.49, 0.75 and 0.74 for the five windows of SYA001, worked by hand");
  ok(a.ask_share_lo <= a.ask_share && a.ask_share <= a.ask_share_hi, "the share lies between its bounds");
  ok(Math.abs((a.ask_share_hi - a.ask_share_lo) - (1 - a.coverage)) < 2e-4, "and the bounds are as far apart as the premium without a stated side");
  eq(a.absent, "sig:held pending licence review;rd:held until event dates are cleared;", "the absent cell names exactly the held columns");
  const two = rowOf(j, "SYA002");
  eq([two.ask_share, two.ask_share_lo, two.ask_share_hi, two.coverage, two.lean], [null, null, null, null, null], "two windows are fewer than three: every flow cell is absent");
  eq(two.absent, "sig:held pending licence review;rd:held until event dates are cleared;ask_share:fewer than 3 flagged windows;ask_share_lo:fewer than 3 flagged windows;ask_share_hi:fewer than 3 flagged windows;coverage:fewer than 3 flagged windows;lean:fewer than 3 flagged windows;", "with the reason, in column order");
  eq(two.move_z, Number(FIXED(zOf(-0.0502, 0.015), 2)), "a fall keeps its sign");
  const none = rowOf(j, "SYA003");
  eq([none.move_z, none.ask_share], [null, null], "no typical move and no windows are absent");
  ok(none.absent.includes("move_z:under 200 sessions of history;") && none.absent.includes("ask_share:no flagged windows;"), "with their reasons");
  const zero = rowOf(j, "SYA004");
  ok(zero.absent.includes("move_z:typical move is zero;") && zero.move_z === null, "a zero typical move is absent, never Infinity");
  const d4 = X.oracleFlow(X.FLOW_ROWS.filter((r) => r.t === "SYA004"));
  eq([zero.ask_share, zero.coverage, zero.lean], [Number(d4.share), Number(d4.coverage), d4.lean], "sided premium of $260,000 clears the $250,000 floor");
  const five = rowOf(j, "SYA005");
  ok(five.absent.includes("move_z:no day change;") && five.move_z === null, "no day change is absent");
  ok(rowOf(j, "SYA006").absent.includes("move_z:no day change;"), "and a -100 percent day change has no log");
  const csv = B.buildExport("moves", src, { now: NOW, format: "csv" });
  ok(csv.body.charCodeAt(0) === 0xfeff, "the CSV starts with a byte order mark");
  ok(!B.buildExport("moves", src, { now: NOW, format: "json" }).body.startsWith("﻿"), "the JSON does not");
  ok(csv.body.endsWith("\r\n") && !/(^|[^\r])\n/.test(csv.body), "CSV lines end CRLF, the last one too");
  const grid = parseCsv(csv.body);
  eq(grid[0], HEAD_MOVES, "the CSV header is the keys");
  eq(grid.length, 9, "and there are eight data rows");
  for (const r of grid.slice(1)) {
    const entries = r[r.length - 1].split(";").filter(Boolean).map((e) => e.split(":")[0]);
    const dashes = r.slice(0, -1).map((c, i) => (c === DASH ? HEAD_MOVES[i] : null)).filter(Boolean);
    eq(entries, dashes, r[2] + ": one absent entry for every dash cell, in column order");
    ok(/^(?:[a-z][a-z0-9_]*:[A-Za-z0-9 ]{1,48};)*$/.test(r[r.length - 1]), r[2] + ": the absent cell follows its grammar");
  }
  eq(grid.find((r) => r[2] === "SYA002")[4], FIXED(zOf(-0.0502, 0.015), 2), "a negative number is written bare, not defanged");
  eq(csv.meta.asofDay, "2026-10-24", "the file date is the TRT date of the as-of instant, not the UTC date 2026-10-23");
  eq(B.exportFileName("moves", csv.meta.asofDay, "csv"), "flows-moves-2026-10-24-TRT.csv", "the file name");
  eq(csv.meta.available, 8, "the available count");

  const u = body("unusual", src);
  eq(u.meta.columns.map((c) => c.key), HEAD_UNUSUAL, "the Unusual header");
  eq(u.rows.map((r) => r.ticker), ["SYA001", "SYA002", "SYA004", "SYA005", "SYA006"], "one row for each name with a valid window, in ticker order");
  eq(u.meta.asof_trt, "2026-10-24 00:30 TRT", "the as-of is the oldest of the record (21:45 UTC) and the boards (21:30 UTC)");
  const us = rowOf(u, "SYA001");
  eq([us.windows_n, us.premium_band, us.negotiated_share, us.sweep_share, us.score], [5, "5M-25M", Number(flow.floor), Number(flow.sweep), 58], "SYA001: five windows, $5.0M in the 5M-25M band, a 50% floor share and a 70% sweep share, board score 58");
  eq([flow.floor, flow.sweep], ["0.5000", "0.7000"], "worked by hand");
  eq(us.absent, "", "nothing is absent");
  const ub = rowOf(u, "SYA002");
  eq([ub.windows_n, ub.premium_band, ub.negotiated_share, ub.sweep_share, ub.ask_share], [2, null, null, null, null], "SYA002 has two windows: the count is shown and every aggregate is absent");
  ok(ub.absent.includes("premium_band:fewer than 3 flagged windows;") && ub.absent.includes("negotiated_share:fewer than 3 flagged windows;"), "with the reason");
  eq(ub.score, 12, "its board score");
  const uf = rowOf(u, "SYA006");
  ok(uf.negotiated_share === null && uf.sweep_share === null && uf.absent.includes("negotiated_share:floor flag missing on some windows;") && uf.absent.includes("sweep_share:sweep flag missing on some windows;"), "a missing floor or sweep flag makes the share absent, not smaller");
  ok(uf.score === null && uf.absent.includes("score:not on the board;"), "a name not on a board has no score");
  eq(rowOf(u, "SYA005").score, -40, "a short-board score keeps its sign");
  eq(rowOf(u, "SYA004").premium_band, "<1M", "270k of premium is in the under-1M band");
  eq([99999999, 100000000, 499999999, 500000000, 2499999999, 2500000000, 9999999999, 10000000000].map(B.bandOf), ["<1M", "1M-5M", "1M-5M", "5M-25M", "5M-25M", "25M-100M", "25M-100M", "100M+"], "band edges are lower-inclusive, in cents");

  const capped = body("unusual", { ...src, flowalerts: X.flowPayload(X.FLOW_ROWS, { shed: 4, record: { date: X.SESSION, shed: 4 } }) });
  const c1 = rowOf(capped, "SYA001");
  eq([c1.windows_n, c1.premium_band], [null, null], "a record that shed windows shows no count or band");
  ok(c1.absent.includes("windows_n:night record hit its cap;") && c1.ask_share !== null, "but keeps the shares of what it kept");
  const missingShed = body("unusual", { ...src, flowalerts: { ...X.flowPayload(), shed: undefined, record: { date: X.SESSION } } });
  eq(rowOf(missingShed, "SYA001").windows_n, null, "a record that does not say what it shed is treated as capped");
  const stale = body("unusual", { ...src, "board:long": { ...X.boardPayload("long", [{ t: "SYA001", s: 58 }]), sessionDate: "2026-10-22" }, "board:short": null });
  ok(rowOf(stale, "SYA001").score === null && rowOf(stale, "SYA001").absent.includes("score:board score is from another session;"), "a board of another session contributes nothing");
  const dup = body("unusual", { ...src, flowalerts: X.flowPayload([...X.FLOW_ROWS, { ...X.FLOW_ROWS[0], rule: "other-rule", prem: 900000 }]) });
  eq(rowOf(dup, "SYA001").windows_n, 5, "a window flagged under two rules is counted once");
  const some = (n) => X.flowPayload(Array.from({ length: n }, (_, i) => X.win("SYA010", 400000 + i * 1000, 200000, 100000)));
  eq(rowOf(body("unusual", { flowalerts: some(2) }), "SYA010").ask_share, null, "two windows: absent");
  eq(typeof rowOf(body("unusual", { flowalerts: some(3) }), "SYA010").ask_share, "number", "three windows: present");
  const moves = body("moves", { ...src, flowalerts: X.flowPayload(X.FLOW_ROWS, { sessionDate: "2026-10-22", record: { date: "2026-10-22", shed: 0 } }) });
  const m1 = rowOf(moves, "SYA001");
  ok(m1.ask_share === null && m1.absent.includes("ask_share:flow record is from another session;"), "a flow record from another session is not joined to the universe");
  eq(moves.meta.asof_trt, "2026-10-24 00:10 TRT", "and does not set the as-of");
  ok(rowOf(body("moves", { ...src, flowalerts: null }), "SYA001").absent.includes("ask_share:flow record did not load;"), "a flow record that did not load says so");
  const earlier = body("moves", { ...src, flowalerts: X.flowPayload(X.FLOW_ROWS, { generatedAt: "2026-10-23T20:00:00.000Z" }) });
  eq(earlier.meta.asof_trt, "2026-10-23 23:00 TRT", "the as-of is the earliest of the sources: a record made at 20:00 UTC is 23:00 TRT the same day");
  const big = [{ t: "SYC000", cols: { sig: 0.02, chg: 0.2, ed: null } }, ...Array.from({ length: 1000 }, (_, i) => ({ t: "SYB" + String(999 - i).padStart(3, "0"), cols: { sig: 0.02, chg: 0.001, ed: null } }))];
  const wj = JSON.parse(B.buildExport("moves", { universe: X.columnStore(big), flowalerts: null }, { now: NOW, format: "json" }).body);
  eq([wj.meta.rows, wj.meta.available, wj.meta.truncated, wj.rows[0].ticker, wj.rows[999].ticker], [1000, 1001, true, "SYB000", "SYB999"], "1,001 names given in reverse are cut to the first 1,000 in ticker order, after sorting, and the cut is stated");
  const exact = JSON.parse(B.buildExport("moves", { universe: X.columnStore(big.slice(1)), flowalerts: null }, { now: NOW, format: "json" }).body);
  eq([exact.meta.rows, exact.meta.available, exact.meta.truncated], [1000, 1000, false], "exactly 1,000 names are not truncated");
  const small = JSON.parse(B.buildExport("moves", { universe: X.columnStore(big), flowalerts: null }, { now: NOW, format: "json", limit: 3 }).body);
  eq([small.rows.map((r) => r.ticker), small.meta.truncated], [["SYB000", "SYB001", "SYB002"], true], "a lower limit takes the head of the order");
  const ev = X.eventsPayload([{ t: "SYA201", sdte: 21, d: "2026-11-23" }, { t: "SYA202", sdte: 22, d: "2026-11-24" }, { t: "SYA203", sdte: null, d: null }, { t: "SYA204", sdte: 0, d: "2026-10-23" }]);
  const ej = JSON.parse(B.buildExport("events", { events: ev, universe: X.columnStore(X.UNIVERSE_ROWS) }, { now: NOW, format: "json", holds: {}, pageHolds: {} }).body);
  eq(ej.rows.map((r) => [r.ticker, r.sessions_until, r.contamination, r.event_type]), [["SYA204", 0, true, "earnings"], ["SYA201", 21, true, "earnings"], ["SYA202", 22, false, "earnings"], ["SYA203", null, null, "earnings"]], "events are ordered by sessions until, flag the 21-session horizon inclusive, and leave an undated one absent");
  ok(ej.rows[3].absent.includes("sessions_until:no session count for the event;") && ej.rows[0].absent.includes("rd:report distance not published yet;"), "with reasons");
  const hj = JSON.parse(B.buildExport("events", { events: ev }, { now: NOW, format: "json", pageHolds: {} }).body);
  ok(hj.rows[1].absent.includes("sessions_until:held until event dates are cleared;") && hj.rows[1].sessions_until === null && hj.rows[1].contamination === null, "a held column is absent even on a page whose hold is lifted");
  let heldPage = null;
  try { B.buildExport("events", { events: ev }, { now: NOW }); } catch (e) { heldPage = e.code; }
  eq(heldPage, "held", "the Events page is refused while it is held");
  const pol = JSON.parse(B.buildExport("political", { political: X.politicalPayload([{ t: "SYA301", buys: 5, sells: 2 }, { t: "SYA300", buys: 1, sells: 0 }]) }, { now: NOW, format: "json", holds: {}, pageHolds: {} }).body);
  eq(pol.rows.map((r) => [r.ticker, r.transactions_n, r.buys_n, r.sells_n, r.net_n]), [["SYA300", 1, 1, 0, 1], ["SYA301", 7, 5, 2, 3]], "Political counts, ordered by ticker and not by dollars");
  ok(pol.rows[0].absent.includes("house_n:chamber not carried in the feed;") && pol.meta.notes.some((n) => /net_n leans positive/.test(n)), "chambers are absent and the sell-only gap is stated");
  let unknown = false;
  try { B.buildExport("sector", {}, { now: NOW }); } catch { unknown = true; }
  ok(unknown, "a page that is not registered is refused");
  let leans = 0;
  let shares = 0;
  for (const seed of [3, 7, 11, 19, 23, 41, 59, 77, 101, 131, 257, 1009]) {
    const rnd = X.randomWindows(seed, X.UNIVERSE_ROWS.map((r) => r.t));
    const rj = JSON.parse(B.buildExport("unusual", { flowalerts: X.flowPayload(rnd) }, { now: NOW, format: "json" }).body);
    ok(rj.rows.length >= 4, "the random world has several names");
    for (const row of rj.rows) {
      const o = X.oracleFlow(rnd.filter((r) => r.t === row.ticker));
      if (o.n < 3) { eq([row.windows_n, row.ask_share], [o.n, null], row.ticker + ": under three windows"); continue; }
      eq([row.ask_share_lo, row.ask_share_hi, row.coverage, row.negotiated_share, row.sweep_share].map((x) => x.toFixed(4)), [o.lo, o.hi, o.coverage, o.floor, o.sweep], row.ticker + ": bounds, coverage and shares from integer cents");
      if (o.shareNull === null) { eq(row.ask_share.toFixed(4), o.share, row.ticker + ": ask share"); shares += 1; }
      else eq(row.ask_share, null, row.ticker + ": ask share absent (" + o.shareNull + ")");
    }
    const rm = JSON.parse(B.buildExport("moves", { universe: X.columnStore(X.UNIVERSE_ROWS), flowalerts: X.flowPayload(rnd) }, { now: NOW, format: "json" }).body);
    for (const row of rm.rows) {
      const o = X.oracleFlow(rnd.filter((r) => r.t === row.ticker));
      if (o.n < 3) { eq([row.lean, row.ask_share], [null, null], row.ticker + ": under three windows has no lean"); continue; }
      if (o.shareNull === null) { eq(row.lean, o.lean, row.ticker + ": lean from integer cents"); leans += 1; } else eq(row.lean, null, row.ticker + ": no lean (" + o.shareNull + ")");
    }
  }
  ok(leans >= 12 && shares >= 12, "the random worlds reach a lean and a share for many names (" + leans + ", " + shares + ")");
}

export function calendarBattery(K) {
  eq([K.HORIZON_SESSIONS, K.contaminated(0), K.contaminated(21), K.contaminated(22), K.contaminated(-1)], [21, true, true, false, false], "the horizon is 21 sessions, both ends inclusive");
  eq([K.contaminated(null), K.contaminated(undefined), K.contaminated(NaN), K.contaminated(Infinity), K.contaminated("3")], [false, false, false, false, false], "a missing or non-numeric count is never inside the horizon");
  eq([K.withinHorizon("2026-10-23", "2026-10-23"), K.withinHorizon("2026-10-23", "2026-11-23"), K.withinHorizon("2026-10-23", "2026-11-24"), K.withinHorizon("2026-10-23", "2026-10-22")], [true, true, false, false], "21 sessions after Friday 23 October is Monday 23 November, 22 is the next day, and the past is outside");
  eq(K.sessionsBetween("2026-10-23", "2026-10-26"), 1, "the adapter hands out the calendar's own counter");
}
