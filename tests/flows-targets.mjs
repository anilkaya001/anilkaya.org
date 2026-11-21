import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "../shared/flows-targets.js";
import * as CPU from "./lib/cpu-budget.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b})`); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "shared/flows-targets.js"), "utf8");

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekdays = (start, count) => {
  const out = [];
  let d = start;
  while (out.length < count) {
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
};

const barsFrom = (returns, { start = "2025-01-02", close0 = 100, dates = null } = {}) => {
  const days = dates || weekdays(start, returns.length + 1);
  let c = close0;
  return days.map((d, i) => {
    if (i > 0) c *= Math.exp(returns[i - 1]);
    return { d, c };
  });
};

const alternating = (n, a = 0.01) => Array.from({ length: n }, (_, i) => (i % 2 ? -a : a));

{
  const r = T.sigmaRef(barsFrom(alternating(252)), { keep: true });
  eq(r.ok, true, "252 clean returns forecast");
  near(r.sigmaRef, 1.4826 * 0.01, 1e-12, "HAND-WORKED: 126 returns of +1% and 126 of -1% have median 0, every absolute deviation 0.01, MAD 0.01, so sigmaRef is 1.4826 x 0.01");
  eq(r.n, 252, "all 252 returns are used");
  deep([r.clock, r.omegaW, r.id], ["sess-v0", 0, "sigma_ref"], "and the result carries its clock version, sess-v0, with the weekend variance 0");
  eq(r.returns.length, 252, "the kept returns are available to a caller that asks for them");
  const long = T.sigmaRef(barsFrom(alternating(400)));
  eq(long.sessions, 252, "a longer history is cut to the trailing 252 sessions");
  near(long.sigmaRef, r.sigmaRef, 1e-12, "and gives the same scale on the same pattern");
}

{
  const returns = alternating(252);
  const days = weekdays("2025-01-02", 253);
  const reports = [
    { date: days[40], time: "premarket" },
    { date: days[100], time: "postmarket" },
    { date: days[160], time: "bmo" },
    { date: days[220], time: "amc" },
  ];
  const impact = [days[40], days[101], days[160], days[221]];
  for (const d of impact) returns[days.indexOf(d) - 1] = 0.06;
  const bars = barsFrom(returns, { dates: days });
  const without = T.sigmaRef(bars, { reports, keep: true });
  eq(without.excluded.event, 4, "AN EARNINGS SESSION IS EXCLUDED: the session of a before-open report and the session after an after-close report, four in all");
  eq(without.n, 248, "leaving 248 returns");
  ok(without.returns.every((x) => Math.abs(Math.abs(x) - 0.01) < 1e-12), "none of the 0.06 returns is among them");
  near(without.sigmaRef, 1.4826 * 0.01, 1e-9, "so the scale is the clean pattern's");
  const included = T.sigmaRef(bars, { reports: [] });
  eq(included.n, 252, "REVERT-PROOF: with the event sessions left in, all 252 returns count");
  near(included.sigmaRef, 1.4826 * 0.02, 1e-9, "and sigmaRef is twice as large, so the exclusion is what keeps the unit typical");
  ok(Math.abs(included.sigmaRef - without.sigmaRef) > 0.005, "including the earnings session changes sigmaRef");
  const unknown = T.sigmaRef(bars, { reports: [{ date: days[100], time: "unconfirmed" }] });
  eq(unknown.excluded.event, 2, "a report with no stated timing excludes both candidate sessions");
  eq(unknown.uncertainEvents, 2, "and says that it could not tell which");
}

{
  const returns = alternating(252);
  const days = weekdays("2025-01-02", 253);
  const bars = barsFrom(returns, { dates: days });
  const splitDay = days[120];
  const split = bars.map((b) => ({ ...b, c: b.d >= splitDay ? b.c / 2 : b.c }));
  const raw = T.sigmaRef(split, { keep: true });
  ok(raw.returns.some((x) => Math.abs(x - Math.log(0.5) - 0.01) < 0.02 && x < -0.6), "an unadjusted two-for-one split shows as a return near -69%");
  const adjusted = T.sigmaRef(split, { splits: [{ d: splitDay, ratio: 2 }], keep: true });
  ok(adjusted.returns.every((x) => Math.abs(Math.abs(x) - 0.01) < 1e-9), "A SPLIT IS ADJUSTED: with the ratio given, every return is back to the pattern's +-1%");
  eq(adjusted.n, 252, "and the split day's return is kept, not thrown away");
  near(adjusted.sigmaRef, 1.4826 * 0.01, 1e-9, "so the scale is unchanged by the split");
  const flagged = split.map((b) => (b.d === splitDay ? { ...b, split: true } : b));
  const unknownRatio = T.sigmaRef(flagged, { keep: true });
  eq(unknownRatio.excluded.split, 2, "a split the store flags but gives no ratio for excludes the returns into and out of that bar");
}

{
  const returns = alternating(252);
  const days = weekdays("2025-01-02", 253);
  const bars = barsFrom(returns, { dates: days });
  const broken = bars.map((b, i) => (i === 90 ? { ...b, brk: true } : b));
  const r = T.sigmaRef(broken);
  deep([r.excluded.break, r.n], [2, 250], "A BREAK IS EXCLUDED: a bar flagged as a trading break takes the return into it and the return out of it");
  const listed = T.sigmaRef(bars, { breaks: [days[50]] });
  eq(listed.excluded.break, 2, "and so does a date listed as a break");
  const holey = bars.filter((_, i) => i < 100 || i > 105);
  const gap = T.sigmaRef(holey);
  eq(gap.excluded.gap, 1, "a hole of more than four calendar days is a gap, not a return");
  const holidayWeekend = T.sigmaRef(barsFrom([0.01, -0.01, 0.01], { dates: ["2025-01-02", "2025-01-03", "2025-01-07", "2025-01-08"] }), { min: 1 });
  eq(holidayWeekend.excluded.gap, 0, "while a long weekend of four calendar days is a normal return");
}

{
  const returns = alternating(252);
  const days = weekdays("2025-01-02", 253);
  const bars = barsFrom(returns, { dates: days });
  const reportsFor = (n) => Array.from({ length: n }, (_, i) => ({ date: days[10 + i * 4 + (i % 2)], time: "premarket" }));
  const ok200 = T.sigmaRef(bars, { reports: reportsFor(52) });
  deep([ok200.n, ok200.ok, ok200.reason], [200, true, null], "TWO HUNDRED RETURNS is the least a name can be forecast on");
  const short = T.sigmaRef(bars, { reports: reportsFor(53) });
  deep([short.n, short.ok, short.sigmaRef, short.reason], [199, false, null, "history"], "199 RETURNS IS NOT FORECAST: no sigmaRef is invented, and the reason is named");
  const none = T.sigmaRef([], {});
  deep([none.ok, none.reason, none.n], [false, "history", 0], "an empty history is not forecast either");
  const flat = T.sigmaRef(barsFrom(Array.from({ length: 252 }, () => 0)));
  deep([flat.ok, flat.reason], [false, "degenerate"], "a name whose close never moved has no scale, so it is not forecast");
  const tally = T.tallyReasons([ok200, short, none, flat, short]);
  deep(tally, { forecast: 1, notForecast: { history: 3, degenerate: 1 } }, "and the names that are not forecast are counted with the reason");
  const bad = T.sigmaRef(bars, { clock: "sess-v9" });
  deep([bad.ok, bad.reason], [false, "clock"], "a clock version the table does not know is refused");
  ok(Object.isFrozen(T.CLOCKS) && Object.isFrozen(T.CLOCKS["sess-v0"]) && T.CLOCKS["sess-v0"].omegaW === 0,
    "sess-v0 is frozen with a weekend variance of 0; a later estimate is a new clock id, never a change to this one");
}

{
  const sessions = ["2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07"];
  deep(T.impactSession("2026-10-02", "premarket", sessions).sessions, ["2026-10-02"], "IMPACT SESSION: a before-open report moves its own session");
  deep(T.impactSession("2026-10-02", "postmarket", sessions).sessions, ["2026-10-06"], "an after-close report moves the next session on the calendar it is given, here past a closed Monday");
  deep(T.impactSession("2026-10-02", "postmarket").sessions, ["2026-10-05"], "and with no calendar, the next weekday");
  deep(T.impactSession("2026-10-03", "premarket").sessions, ["2026-10-05"], "a before-open report dated on a Saturday takes the Monday");
  const unsure = T.impactSession("2026-10-02", "", sessions);
  deep([unsure.sessions, unsure.certain, unsure.timing], [["2026-10-02", "2026-10-06"], false, "unknown"], "a report with no stated timing may have moved either, and is marked uncertain");
  deep(T.impactSession("not a date", "bmo").sessions, [], "a malformed date moves nothing");
  deep(["BMO", "amc", "Before Open", "After Close", "", null, "tbd"].map(T.reportTiming),
    ["before-open", "after-close", "before-open", "after-close", "unknown", "unknown", "unknown"], "the timing words the store holds map to three states");
}

{
  const ids = T.TARGETS.map((t) => t.id);
  eq(new Set(ids).size, ids.length, "every target id is unique");
  eq(ids.length, 35, "THE TABLE: eighteen sigma multiples, three implied, six percent, two earnings, three return sets, one reading and two sensitivities");
  for (const k of [2, 3, 4]) for (const h of [1, 5]) for (const s of ["", ".up", ".dn"]) ok(T.isTarget(`move.k${k}.h${h}${s}`), `move.k${k}.h${h}${s} is registered`);
  for (const id of ["move.im1.h1", "move.im1.5.h1", "move.im2.h1", "move.x5.h1", "move.x10.h5", "move.x20.h5", "move.earn.im", "move.earn.ratio", "move.ret.h1", "move.ret.h5", "move.ret.h21", "move.live.res"]) {
    ok(T.isTarget(id), `${id} is registered`);
  }
  ok(!T.isTarget("move.k5.h1") && !T.isTarget("move.p.k3.h1") && !T.isTarget("move.k3.h2") && !T.isTarget(null), "and nothing else is");
  deep(T.QUANTILES, [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.975, 0.99, 0.995], "the return quantiles are the fifteen of the union");
  ok(["move.ret.h1", "move.ret.h5", "move.ret.h21"].every((id) => T.TARGET_BY_ID[id].quantiles === T.QUANTILES), "and every return target uses that one list");
  deep([T.TARGET_BY_ID["move.ret.h21"].gradeCap, T.TARGET_BY_ID["move.ret.h5"].gradeCap, T.TARGET_BY_ID["move.ret.h21"].shown], [1, 3, "more horizons"], "h = 21 is registered at grade 1 and shown behind more horizons");
  eq(T.factId("move.k3.h1"), "move.p.k3.h1", "a forecast fact is move.p. plus the target's suffix");
  eq(T.factId("move.im1.5.h1"), "move.p.im1.5.h1", "including the implied multiples");
  eq(T.factId("move.zzz"), null, "and an id that is not a target has none");
  ok(Object.isFrozen(T.TARGETS) && Object.isFrozen(T.TARGETS[0]) && Object.isFrozen(T.QUANTILES), "the table is frozen");
  deep(T.EVENT_TARGETS.length, 28, "twenty-eight of the targets are events");
  deep([T.TARGET_BY_ID["move.live.res"].kind, T.TARGET_BY_ID["move.z63.h1"].kind], ["reading", "sensitivity"], "the live residual is a reading and the 63-day score a sensitivity, neither a target");
  ok(!T.validateRecord({ target: "move.live.res" }).ok && !T.validateRecord({ target: "move.z63.h1" }).ok && !T.validateRecord({ target: "move.k9.h1" }).ok,
    "a record for a reading, a sensitivity or an unregistered id is refused");
}

{
  const ctx = { sigmaRef: 0.02, sigmaQ1: 0.03 };
  near(T.threshold("move.k3.h1", ctx).up, 0.06, 1e-12, "THRESHOLDS: three typical days at a 2% scale is 6%");
  near(T.threshold("move.k3.h5", ctx).up, 0.06 * Math.sqrt(5), 1e-12, "over five sessions the edge widens with the square root of the horizon");
  near(T.threshold("move.k2.h5", { ...ctx, nW: 2, omegaW: 0.5 }).up, 2 * 0.02 * Math.sqrt(5 + 2 * 0.5), 1e-12, "and with a weekend variance on the clock, hEff = h + nW x omegaW");
  near(T.hEff(5, 2, 0.5), 6, 1e-12, "hEff is h plus the weekend days times their variance");
  near(T.threshold("move.im1.5.h1", ctx).up, 1.5 * 0.03, 1e-12, "an implied multiple is on the options-implied one-session scale");
  const from30 = T.threshold("move.im2.h1", { sigmaQ1: 0.028, source: "iv30_ex" });
  deep([from30.ok, from30.grade, from30.label], [true, 1, "from 30-day IV"], "the fallback to the 30-day volatility is graded 1 at most and labelled as such");
  const vendor = T.threshold("move.im1.h1", { sigmaQ1: 0.5, source: "implied_move_perc" });
  ok(!vendor.ok && /0\.85-straddle/.test(vendor.reason), "A SOURCE TAGGED implied_move_perc IS REFUSED: it is a band to the nearest Friday, never a one-day scale");
  ok(!T.validateRecord({ target: "move.im1.h1", source: "implied_move_perc" }).ok, "and a record that carries it is refused");
  ok(T.validateRecord({ target: "move.im1.h1", source: "sigma_q1", clock: "sess-v0" }).ok, "while the registered sources pass");
  ok(!T.validateRecord({ target: "move.k3.h1", source: "mystery" }).ok && !T.validateRecord({ target: "move.k3.h1", clock: "sess-v7" }).ok, "an unknown source or clock version is refused");
  ok(!T.threshold("move.k3.h1", { sigmaRef: null }).ok && !T.threshold("move.k3.h1", { sigmaRef: 0 }).ok && !T.threshold("move.im1.h1", {}).ok, "a missing or non-positive scale gives no threshold");
  const earn = T.threshold("move.earn.im", { sigmaQE: 0.05 });
  deep([earn.ok, earn.up, earn.down], [true, 0.05, -0.05], "THE EARNINGS TARGET has a scale and a multiple of one: its edge is the event-inclusive impact-session SD, sigmaQE");
  eq(T.resolves("move.earn.im", 0.2, { sigmaQE: 0.05 }), 1, "and a 20% impact-session move resolves it");
  eq(T.resolves("move.earn.im", 0.01, { sigmaQE: 0.05 }), 0, "while a 1% one does not");
  deep([T.threshold("move.earn.im", { sigmaQ1: 0.05 }).ok, T.resolves("move.earn.im", 0.2, { sigmaQ1: 0.05 })], [false, null], "a one-session scale is not the impact-session scale: with no sigmaQE it is refused and resolves to nothing");
  const valid = { sigmaRef: 0.02, sigmaQ1: 0.03, sigmaQE: 0.05 };
  for (const id of T.EVENT_TARGETS) {
    const t = T.threshold(id, valid);
    ok(t.ok === true && Number.isFinite(t.up) && Number.isFinite(t.down) && t.up > 0 && t.down < 0, `EVERY EVENT TARGET RESOLVES: ${id} has finite edges from a valid context`);
    ok(T.resolves(id, 0.9, valid) !== null && T.resolves(id, 0, valid) === 0, `${id} resolves a huge move and a flat day`);
    if (T.TARGET_BY_ID[id].scale !== "fixed") {
      const refused = T.threshold(id, {});
      ok(refused.ok === false && typeof refused.reason === "string" && refused.reason.length > 0 && T.resolves(id, 0.9, {}) === null, `${id} with no scale is refused with a reason and resolves to nothing`);
    }
  }
  const x = T.threshold("move.x20.h1");
  near(x.up, Math.log(1.2), 1e-12, "a 20% move up is a log return of ln 1.2");
  near(x.down, Math.log(0.8), 1e-12, "and a 20% move down one of ln 0.8");
  eq(T.resolves("move.x20.h1", Math.log(1.25)), 1, "a 25% rise is a 20% event");
  eq(T.resolves("move.x20.h1", Math.log(0.79)), 1, "a 21% fall is a 20% event");
  eq(T.resolves("move.x20.h1", Math.log(0.85)), 0, "a 15% fall is not");
  eq(T.resolves("move.k3.h1.up", -0.2, ctx), 0, "an up target does not resolve on a fall");
  eq(T.resolves("move.k3.h1.dn", -0.2, ctx), 1, "a down target does");
  eq(T.resolves("move.k3.h1", -0.0600001, ctx), 1, "the two-sided target resolves at the edge");
  eq(T.resolves("move.k3.h1", 0.0599, ctx), 0, "and just inside it does not");
  eq(T.resolves("move.k3.h1", NaN, ctx), null, "a missing outcome resolves to nothing, not to no event");
  near(T.earnRatio({ m: -0.08, M: 0.05, track: "vendor" }), 1.6, 1e-12, "the earnings ratio is |m| / M within a named track");
  deep([T.earnRatio({ m: 0.1, M: 0.05 }), T.earnRatio({ m: 0.1, M: 0, track: "platform" })], [null, null], "and has no value with no track or no scale");
}

{
  const wilsonByHand = (x, n, z) => {
    const a = 1 + z * z / n;
    const b = -2 * x / n - z * z / n;
    const c = (x / n) * (x / n);
    const disc = Math.sqrt(b * b - 4 * a * c);
    return { lo: (-b - disc) / (2 * a), hi: (-b + disc) / (2 * a) };
  };
  const w = T.wilson(10, 252);
  const hand = wilsonByHand(10, 252, 1.96);
  near(w.lo, hand.lo, 1e-9, "WILSON: the lower bound of 10 events in 252 sessions solves the score equation");
  near(w.hi, hand.hi, 1e-9, "and so does the upper bound");
  deep([T.wilson(-1, 10), T.wilson(11, 10), T.wilson(1, 0)], [null, null, null], "an impossible count has no interval");

  eq(T.rarityText({ k: 3, sigmaRef: 0.027, route: "empirical", hits: 4 }), "a 3x typical-day move: typical day 2.7%; about 1 in 63 sessions for this name over the last year",
    "THE READER RULE: a multiple is printed with the typical day and how often such days occur for that name");
  eq(T.rarityText({ k: 3, sigmaRef: 0.027, route: "empirical", hits: 10 }),
    `a 3x typical-day move: typical day 2.7%; about 1 in 25 sessions for this name over the last year (95% interval 1 in ${Math.round(1 / hand.hi)} to 1 in ${Math.round(1 / hand.lo)})`,
    "with its Wilson interval once there are five events");
  eq(T.rarityText({ k: 4, sigmaRef: 0.027, route: "empirical", hits: 0 }),
    "a 4x typical-day move: typical day 2.7%; rarer than 1 in 250 sessions for this name over the last year, and fewer than 1 in 80 at 95%",
    "an empirical count of none floors at rarer than 1 in 250 with the one-sided 95% bound of about 1.2% beside it");
  eq(T.rarityText({ k: 4, sigmaRef: 0.027, route: "empirical", hits: 1 }), "a 4x typical-day move: typical day 2.7%; rarer than 1 in 250 sessions for this name over the last year",
    "and so does one event in 252, whose 1 in 252 is past the floor");
  eq(T.rarityText({ k: 1.5, sigmaRef: 0.1234, route: "empirical", hits: 20 }).startsWith("a 1.5x typical-day move: typical day 12%;"), true, "a fractional multiple and a large typical day print plainly");
  eq(T.rarityText({ k: 3, sigmaRef: 0.027, route: "empirical", hits: 4, sessions: 200 }), null, "fewer than 252 sessions of evidence prints no frequency, so it prints no multiple");
  eq(T.rarityText({ k: 3, sigmaRef: 0.027 }), null, "a multiple with no frequency at all is not printed");
  eq(T.rarityText({ k: 3, sigmaRef: null, route: "empirical", hits: 4 }), null, "nor one with no typical day");
  eq(T.rarityText({ k: 3, sigmaRef: 0.027, route: "model", p: 1e-6 }), null, "a model frequency with no audited limit prints nothing");
  eq(T.rarityText({ k: 4, sigmaRef: 0.027, route: "model", p: 0.01, pFloor: 1e-4, rung: "A" }),
    "a 4x typical-day move: typical day 2.7%; about 1 in 100 sessions, model, rung A", "the model route prints its own frequency, its route and its rung");
  eq(T.rarityText({ k: 5, sigmaRef: 0.027, route: "model", p: 1e-7, pFloor: 1e-4 }),
    "a 5x typical-day move: typical day 2.7%; rarer than the audited limit of 1 in 10000 sessions, model",
    "and beyond the audited limit it says so instead of printing 1 in 10,000,000");

  const printedN = (text) => [...text.matchAll(/1 in (\d+)/g)].map((m) => Number(m[1]));
  let texts = 0;
  for (let hits = 0; hits <= 60; hits++) {
    const text = T.rarityText({ k: 3, sigmaRef: 0.02, route: "empirical", hits });
    texts++;
    ok(text !== null && !/sigma|\u03c3/i.test(text) && /1 in \d+/.test(text), `${hits} hits: every multiple carries a frequency and never the word sigma`);
    ok(printedN(text).every((n) => n <= T.EMPIRICAL_FLOOR_N || /at 95%/.test(text) || hits >= 5), `${hits} hits: no empirical N past its floor of ${T.EMPIRICAL_FLOOR_N}`);
    if (hits < 5) ok(printedN(text).every((n) => n <= T.EMPIRICAL_FLOOR_N || n === 80), `${hits} hits: below five events the only large number is the 95% bound of 80`);
    if (hits >= 1) ok(printedN(text)[0] <= T.EMPIRICAL_FLOOR_N, `${hits} hits: the first printed N is within the floor`);
  }
  for (const sessions of [253, 300, 500, 1000]) {
    for (const hits of [0, 1, 5, 10]) deep(T.rarityText({ k: 3, sigmaRef: 0.02, route: "empirical", hits, sessions }), null, `${hits} hits in ${sessions} sessions prints nothing: the empirical route is a year of ${T.EMPIRICAL_SESSIONS} sessions and no other`);
  }
  deep(T.frequencyText({ route: "empirical", hits: 5, sessions: 1000 }), null, "so five events in 1000 sessions cannot print an interval past the floor");
  const edge = T.frequencyText({ route: "model", p: 0.00399, pFloor: 0.00399 });
  ok(printedN(edge).every((n) => n <= Math.floor(1 / 0.00399)), "p equal to pFloor prints an N no larger than the floored limit");
  for (const [p, pf] of [[0.00399, 0.00399], [0.004, 0.00399], [0.00401, 0.00399], [0.0039, 0.00399], [1 / 250.5, 1 / 250.5]]) {
    const text = T.frequencyText({ route: "model", p, pFloor: pf });
    ok(printedN(text).every((n) => n <= Math.floor(1 / pf)) || /rarer than/.test(text), `p ${p} against pFloor ${pf}: the printed N never passes floor(1/pFloor)`);
  }
  const pFloor = 1e-4;
  for (const p of [0.5, 0.1, 0.01, 0.002, 0.00011, 0.0001, 0.00009, 1e-5, 1e-8]) {
    const text = T.rarityText({ k: 4, sigmaRef: 0.02, route: "model", p, pFloor });
    texts++;
    ok(text !== null && printedN(text).every((n) => n <= 1 / pFloor), `p ${p}: a printed model N never exceeds the audited floor of 1 in ${1 / pFloor}`);
    ok(!/sigma|\u03c3/i.test(text), `p ${p}: no sigma`);
  }
  ok(texts > 60, `${texts} rarity texts swept`);
  eq(T.scanPText(0.0000019), "p below 0.00002", "A SCAN p is never printed as 1 in N: beyond what the null table resolves it prints p below 0.00002");
  eq(T.scanPText(0.0013), "p 0.0013", "and above it prints the p");
  ok(!/1 in/.test(T.scanPText(1e-9)) && !/1 in/.test(T.scanPText(0.04)), "never as a frequency");
  eq(T.scanPText(-1), null, "a negative p prints nothing");

  const literals = (src) => [...src.matchAll(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)].map((m) => m[0]);
  const body = (name) => {
    const at = SOURCE.indexOf(`function ${name}(`);
    ok(at >= 0, `${name} is in the source`);
    let depth = 0;
    let i = SOURCE.indexOf("{", SOURCE.indexOf(")", at));
    const from = i;
    for (; i < SOURCE.length; i++) {
      if (SOURCE[i] === "{") depth++;
      else if (SOURCE[i] === "}" && --depth === 0) break;
    }
    return SOURCE.slice(from, i + 1);
  };
  for (const fn of ["rarityText", "frequencyText", "multipleText", "pctText", "scanPText"]) {
    const bad = literals(body(fn)).filter((s) => /sigma|\u03c3/i.test(s));
    deep(bad, [], `SOURCE SCAN: no string literal in ${fn} says sigma`);
  }
  ok(/typical-day move/.test(body("multipleText")), "the multiple is spelled as a typical-day move");
  ok(!/1 in \$\{[^}]*\}[^`]*scan/i.test(body("scanPText")), "and the scan p has no 1-in-N template");
}

{
  ok(!/^\s*import\s/m.test(SOURCE) && !/\bimport\s*\(/.test(SOURCE) && !/\brequire\s*\(/.test(SOURCE), "THE LEAF imports nothing: the Worker, the pipeline and the ledger can all read it without a cycle");
  ok(!/\/\/|\/\*/.test(SOURCE.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\^?[^/\n]+\/[gimsuy]*\.test|\/\^[^/\n]*\/i?/g, "")), "and carries no comments");
}

{
  const HISTORY = Object.freeze({ 1: "58c47b52126a134316e17773967383014549bf195243f131b7b3ad9cec925a94" });
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "\u03c3 \u20ac \ud83d\ude00", JSON.stringify(T.TARGETS)]) {
    eq(T.sha256Hex(text), createHash("sha256").update(text, "utf8").digest("hex"), `SHA-256 agrees with the platform's on ${text.length} characters`);
  }
  eq(Object.keys(HISTORY).map(Number).sort((a, b) => b - a)[0], T.TARGETS_VERSION, "THE DEFINITION HASH: the newest pinned version is the module's version");
  eq(T.targetsHash(), HISTORY[T.TARGETS_VERSION], "and the table's hash is the one pinned for it: a definition changed without a version bump fails here");
  const changed = T.TARGETS.map((t) => (t.id === "move.k3.h1" ? { ...t, k: 3.5 } : t));
  ok(T.digestOf(changed) !== HISTORY[T.TARGETS_VERSION], "a changed multiple gives another hash");
  const reworded = T.TARGETS.map((t) => (t.id === "move.k3.h1" ? { ...t, rule: t.rule + " " } : t));
  ok(T.digestOf(reworded) !== HISTORY[T.TARGETS_VERSION], "and so does a changed rule");
  ok(T.digestOf(T.TARGETS.slice().reverse()) !== HISTORY[T.TARGETS_VERSION], "and a reordered table");
  eq(T.digestOf(T.TARGETS), T.targetsHash(), "the hash is deterministic");
}

{
  const bars = barsFrom(alternating(252));
  const one = T.sigmaRef(bars);
  const field = T.cardField(one);
  ok(JSON.stringify(field).length <= 40, `ABOUT 40 BYTES A CARD: ${JSON.stringify(field)} is ${JSON.stringify(field).length} bytes`);
  deep([field.n, field.k], [252, "sess-v0"], "the card field carries the count and the clock version");
  eq(T.cardField({ ok: false }), null, "a name that is not forecast has no field");

  let seed = 20261011;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const days = weekdays("2025-01-02", 253);
  const universe = Array.from({ length: 670 }, () => barsFrom(Array.from({ length: 252 }, () => (rnd() - 0.5) * 0.06), { dates: days }));
  const reports = [{ date: days[60], time: "premarket" }, { date: days[120], time: "postmarket" }, { date: days[180], time: "premarket" }, { date: days[230], time: "postmarket" }];
  const run = () => { for (const b of universe) T.sigmaRef(b, { reports }); };
  const measured = CPU.compare(run, { windows: 8, perWindow: 2, warmup: 3 });
  ok(universe.map((b) => T.sigmaRef(b, { reports })).every((r) => r.ok), "670 names of noise all forecast");
  const verdict = CPU.checkBudget(measured, { median: 16, worst: 24 });
  ok(verdict.ok, `NIGHTLY CPU: 670 names take ${measured.subject.median.toFixed(1)} ms of ${measured.clock} CPU, ${measured.ratio.median.toFixed(1)}x the reference kernel (budget 16x, about 50 ms where the reference runs in 3 ms); ${verdict.failures.join("; ")}`);
}

{
  const mk = (n) => { let c = 100; const out = [{ d: "2025-01-01", c }]; const day = Date.UTC(2025, 0, 1); for (let i = 1; i <= n; i++) { c *= Math.exp(i % 10 === 0 ? 0.05 : i % 2 ? 0.01 : -0.01); out.push({ d: new Date(day + i * 86400000).toISOString().slice(0, 10), c }); } return out; };
  const bars = mk(252);
  const prof = T.sigmaProfile(bars);
  const ref = T.sigmaRef(bars, { keep: true });
  ok(prof.ok && prof.s === ref.sigmaRef && prof.n === ref.returns.length, "sigmaProfile carries sigmaRef and its count");
  const hits = (k) => Math.round((ref.returns.filter((x) => Math.abs(x) >= k * ref.sigmaRef).length * 252) / ref.returns.length);
  eq(prof.f2, hits(2), "f2 is the count of returns at or beyond 2 scales, per 252");
  eq(prof.f3, hits(3), "f3 likewise at 3");
  ok(prof.f2 > 0 && prof.f3 <= prof.f2, "the 5 percent days are beyond 2 scales and 3 is never more than 2");
  const short = T.sigmaProfile(mk(150));
  ok(!short.ok && short.reason === "history", "under 200 returns the name is not forecast, with the reason");
}

console.log(`\u2713 flows-targets: ${checks} assertions \u2014 the canonical large-move table frozen and hashed (a definition changed without a version bump fails), sigmaRef worked by hand on a pattern whose median absolute deviation is known, an earnings session, a split, a break and a data gap each excluded or adjusted as written with a revert-proof that keeping the earnings session doubles the scale, 199 returns refused and 200 accepted with the reason counted, impactSession for a before-open, an after-close and an unstated report, thresholds for every family with the vendor's implied_move_perc refused, the reader rule's frequency beside every multiple with each printed N within its route's floor and a scan p never printed as 1 in N, a source scan that no rarity string says sigma, and 670 names inside the nightly's CPU budget`);
