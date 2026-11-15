import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as P13 from "../shared/flows-pos-13f.js";
import * as PI from "../shared/flows-pos-insider.js";
import * as PS from "../shared/flows-pos-short.js";
import * as PL from "../shared/flows-pol-layers.js";
import { loadMutated } from "./truth/mutants.mjs";
import * as COPY from "../shared/flows-pos-copy.js";
import { FORECAST_ALT, guardText } from "../shared/flows-ask.js";
import { positioningBody } from "../shared/flows-page-positioning.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ORACLE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-positioning-oracle.json"), "utf8"));
ok(ORACLE.provenance.generator === "tests/gen-positioning-oracle.py" && /synthetic/.test(ORACLE.provenance.nature), "the oracle names its generator and says it is synthetic");
ok(ORACLE.provenance.calendarSha256 === createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tests/fixtures-calendar.json"))).digest("hex"), "THE ORACLE WAS BUILT FROM THIS CALENDAR FIXTURE: if it moved, run python3 tests/gen-positioning-oracle.py");
ok(ORACLE.provenance.scriptSha256 === createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tests/gen-positioning-oracle.py"))).digest("hex"), "and by this script: run python3 tests/gen-positioning-oracle.py after a change");

const SECTORS = P13.SECTOR_ORDER;
const near = (a, b, tol) => (a === null || b === null ? a === b : Math.abs(a - b) <= tol);
const Q = "2026-09-30", PQ = "2026-06-30", OLD = "2026-03-31";

function rotationBattery(M, take = ORACLE.rotation.length) {
  const fails = [];
  const miss = (what) => { if (fails.length < 6) fails.push(what); };
  ORACLE.rotation.slice(0, take).forEach((w, wi) => {
    const tracked = [], ledger = {};
    w.filers.forEach((f, i) => {
      const cik = String(1000 + i);
      tracked.push({ cik, name: "F" + i, hf: false, total: 1, kept: false });
      if (f.kind === "unread") { ledger[cik] = { rows: [], qs: [] }; return; }
      const qs = f.kind === "notFiled" ? [PQ, OLD] : [Q, PQ];
      ledger[cik] = { rows: f.cells.map((c) => c.slice()), qs };
    });
    const r = M.rotation(tracked, ledger);
    const e = w.expect;
    if (!e.compared) { if (r.filers.compared !== 0) miss(`world ${wi}: nothing to compare`); return; }
    if (r.filers.compared !== e.compared || r.filers.notFiled !== e.notFiled || r.filers.unread !== e.unread) miss(`world ${wi}: filer counts ${JSON.stringify(r.filers)}`);
    let sumNow = 0, sumPrior = 0, sumD = 0;
    r.sectors.forEach((s, i) => {
      const x = e.sectors[i];
      sumNow += s.wNow; sumPrior += s.wPrior; sumD += s.dW;
      if (!near(s.wNow, x.wNow, 0.0100001) || !near(s.wPrior, x.wPrior, 0.0100001)) miss(`world ${wi} ${s.s}: weights ${s.wNow} ${s.wPrior} against ${x.wNow} ${x.wPrior}`);
      if (Math.abs(s.dW - (s.wNow - s.wPrior)) > 1e-9) miss(`world ${wi} ${s.s}: the change is not the difference of the printed weights`);
      if (!near(s.dW, x.dW, 0.0200001)) miss(`world ${wi} ${s.s}: change ${s.dW} against ${x.dW}`);
      for (const k of ["inc", "dec", "closed", "pos", "valueNow", "valuePrior", "n"]) if (s[k] !== x[k]) miss(`world ${wi} ${s.s}: ${k} ${s[k]} against ${x[k]}`);
      if (!near(s.breadth, x.breadth, 0.00005 + 1e-12)) miss(`world ${wi} ${s.s}: breadth ${s.breadth} against ${x.breadth}`);
    });
    if (Math.abs(sumNow - 100) > 1e-6 || Math.abs(sumPrior - 100) > 1e-6 || Math.abs(sumD) > 1e-9) miss(`world ${wi}: the columns do not foot: ${sumNow} ${sumPrior} ${sumD}`);
  });
  return fails;
}

const insiderRows = (rows) => Object.fromEntries(Object.entries(rows).map(([s, list]) => [s, list.map((r) => ({ date: r[0], buy_sell: r[1], transactions: r[2], uniq_insiders: r[3], volume: r[4], premium: "250000.50", avg_price: "12.5" }))]));

function insiderBattery(M) {
  const fails = [];
  const miss = (what) => { if (fails.length < 6) fails.push(what); };
  ORACLE.insiders.forEach((w, wi) => {
    const r = M.insiderFlow(insiderRows(w.rows));
    const e = w.expect;
    if (e === null) { if (r.status !== "unavailable") miss(`world ${wi}: no sector read`); return; }
    const wk = (x) => (x ? [x.from, x.to, x.sessions].join("|") : null);
    if (wk(r.window) !== wk(e.window)) { miss(`world ${wi}: window ${JSON.stringify(r.window)} against ${JSON.stringify(e.window)}`); return; }
    if (!e.window) return;
    if (r.sectors.length !== e.sectors.length) { miss(`world ${wi}: ${r.sectors.length} sectors against ${e.sectors.length}`); return; }
    r.sectors.forEach((s, i) => {
      const x = e.sectors[i];
      for (const k of ["s", "buyers", "sellers", "buyTx", "sellTx", "buyVol", "sellVol", "gaps"]) if (s[k] !== x[k]) miss(`world ${wi} ${s.s}: ${k} ${s[k]} against ${x[k]}`);
      if (!near(s.net, x.net, 0.00005 + 1e-12)) miss(`world ${wi} ${s.s}: net ${s.net} against ${x.net}`);
      const missing = s.days.map((d, k) => (d[1] === null ? k : -1)).filter((k) => k >= 0);
      if (JSON.stringify(missing) !== JSON.stringify(x.missing) || s.days.length !== x.len) miss(`world ${wi} ${s.s}: the missing days`);
      if (JSON.stringify(s.days[0]) !== JSON.stringify(x.first) || JSON.stringify(s.days[s.days.length - 1]) !== JSON.stringify(x.last)) miss(`world ${wi} ${s.s}: the ends of the window`);
    });
  });
  return fails;
}

const NOW = Date.parse("2026-10-26T22:00:00Z");

function shortBattery(M) {
  const fails = [];
  const miss = (what) => { if (fails.length < 6) fails.push(what); };
  ORACLE.short.forEach((w, wi) => {
    const names = w.names.map((n) => ({
      t: n.t, sec: n.sec,
      ftd: { at: NOW, x: { rows: n.ftd } },
      svx: n.hasSvx ? { at: NOW, x: { days: n.svx.days, last: { date: n.svx.date, venues: n.svx.venues } } } : null,
    }));
    const adv = Object.fromEntries(w.names.map((n) => [n.t, n.adv]));
    const f = M.ftdView(names, adv, NOW);
    const e = w.expect;
    if (f.asOf !== e.asOfFtd) miss(`world ${wi}: asOf`);
    f.sectors.forEach((s, i) => {
      const x = e.ftdSectors[i];
      for (const k of ["notional", "heavy", "n", "unread"]) if (s[k] !== x[k]) miss(`world ${wi} ${s.s}: ${k} ${s[k]} against ${x[k]}`);
    });
    for (const x of e.ftdRows) {
      const row = f.top.find((r) => r.t === x.t);
      const all = names.find((n) => n.t === x.t);
      void all;
      if (x.share !== null) {
        if (!row) { if (f.top.length < 40) miss(`world ${wi} ${x.t}: missing from the top list`); continue; }
        if (!near(row.share, x.share, 0.00005 + 1e-12) || row.notional !== x.notional || row.q !== x.q || row.date !== x.date) miss(`world ${wi} ${x.t}: ${JSON.stringify(row)} against ${JSON.stringify(x)}`);
      } else if (row) miss(`world ${wi} ${x.t}: ranked with no share`);
    }
    const v = M.venueView(names, NOW);
    if (!w.names.some((n) => n.hasSvx)) return;
    for (const [venue, m] of Object.entries(e.mix)) {
      const got = v.mix.find((x) => x.x === venue);
      if (!got || got.short !== m.short || got.total !== m.total || !near(got.share, m.share, 0.00005 + 1e-12)) miss(`world ${wi} ${venue}: venue mix ${JSON.stringify(got)} against ${JSON.stringify(m)}`);
    }
    for (const s of v.sectors) {
      const x = e.venueSectors[s.s];
      if (!x) { if (s.n !== 0) miss(`world ${wi} ${s.s}: a sector with no names`); continue; }
      if (s.short !== x.short || s.total !== x.total || s.n !== x.n || !near(s.ratio, x.ratio, 0.00005 + 1e-12)) miss(`world ${wi} ${s.s}: sector ratio ${JSON.stringify(s)} against ${JSON.stringify(x)}`);
    }
    for (const x of e.top) {
      const got = v.top.find((r) => r.t === x.t);
      if (x.ratio === null) continue;
      if (!got) { if (v.top.length < 40) miss(`world ${wi} ${x.t}: missing from the volume list`); continue; }
      if (!near(got.ratio, x.ratio, 0.00005 + 1e-12) || !near(got.ratio10, x.ratio10, 0.00005 + 1e-12)) miss(`world ${wi} ${x.t}: ratios ${got.ratio} ${got.ratio10} against ${x.ratio} ${x.ratio10}`);
    }
  });
  return fails;
}

const rawRow = (txn, filed, o = {}) => ({
  politician_id: "p-1", name: "Zed Qux", ticker: "SYX101", transaction_date: txn, filed_at_date: filed, txn_type: "Purchase", amounts: "$1,001 - $15,000", ...o,
});

function layerBattery(M) {
  const fails = [];
  const miss = (what) => { if (fails.length < 6) fails.push(what); };
  ORACLE.lag.forEach((c, i) => {
    const out = M.lateRows([["cg", [rawRow(c.from, c.to, { ticker: "SYX1" + String(i % 90).padStart(2, "0") })]]]);
    const r = out.rows[0];
    if (!r) { miss(`lag ${c.from} ${c.to}: the row was dropped`); return; }
    if (r.lagS !== c.n) miss(`lag ${c.from} ${c.to}: ${r.lagS} sessions against ${c.n}`);
    if (r.lagD !== c.days) miss(`lag ${c.from} ${c.to}: ${r.lagD} days against ${c.days}`);
    if (r.over45 !== (c.days > 45)) miss(`lag ${c.from} ${c.to}: past 45 is ${r.over45}`);
    if (!/^[A-Z?]{1,2}$/.test(r.who) || r.who !== "ZQ") miss(`lag ${c.from} ${c.to}: initials ${JSON.stringify(r.who)}`);
  });
  for (const [name, want] of ORACLE.initials) if (M.initialsOf(name) !== want) miss(`initials of ${JSON.stringify(name)}: ${M.initialsOf(name)} against ${want}`);
  ORACLE.chart.forEach((w, wi) => {
    w.cases.forEach((c, ci) => {
      const id = `10000000-0000-4000-8000-${String(wi * 10 + ci).padStart(12, "0")}`;
      const raw = { id, ticker: "SYX101", transaction_date: c.txn, filing_date: "2026-10-20", transaction_type: "Purchase", amount: "$1,001 - $15,000", politician_name: "Zed Qux", politician_id: "p-1", unusual_activity_tags: ["unusually_large_trade", "planted_unknown_tag"] };
      const chart = { spy_prices: w.spy.map((p) => ({ date: p[0], close: p[1] })), trades: [{ id, price_at_trade: c.p0, price_current: c.p1 }] };
      const out = M.unusualRows([[raw], []], chart);
      const r = out.rows[0];
      if (!r) { miss(`chart ${wi}.${ci}: dropped`); return; }
      if (!near(r.r, c.r, 1e-4 + 1e-12) || !near(r.rSpy, c.rSpy, 1e-4 + 1e-12) || !near(r.ex, c.ex, 2e-4 + 1e-12)) miss(`chart ${wi}.${ci}: ${r.r} ${r.rSpy} ${r.ex} against ${c.r} ${c.rSpy} ${c.ex}`);
      if (JSON.stringify(r.tags) !== JSON.stringify(["ul", "other"])) miss(`chart ${wi}.${ci}: the tags ${JSON.stringify(r.tags)}`);
      if (!/^[A-Z?]{1,2}$/.test(r.who)) miss(`chart ${wi}.${ci}: a name leaked ${JSON.stringify(r.who)}`);
    });
  });
  return fails;
}

function handBattery(M13) {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 6) fails.push(m); };
  need(M13.quarterBefore("2026-09-30") === "2026-06-30" && M13.quarterBefore("2026-03-31") === "2025-12-31" && M13.quarterBefore("2026-06-30") === "2026-03-31" && M13.quarterBefore("2026-12-31") === "2026-09-30", "quarterBefore");
  need(M13.dollarsOf("1234567.49") === 1234567 && M13.dollarsOf("1234567.50") === 1234568 && M13.dollarsOf("0.49") === 0 && M13.dollarsOf("abc") === null && M13.dollarsOf("-5") === null, "dollarsOf rounds half up and refuses a negative or a word");
  const row = (cik, name, hf, total, filed = "2026-10-14") => ({ cik, name, is_hedge_fund: hf, total_value: String(total), filing_date: filed, date: "2026-09-30" });
  const list = [];
  for (let i = 0; i < 50; i++) list.push(row(String(100 + i), "HF" + i, true, 1000 - i));
  for (let i = 0; i < 30; i++) list.push(row(String(300 + i), "LP" + i, false, 900 - i));
  list.push(row("100", "dup", true, 5));
  const t = M13.trackFilers(list, null, "2026-10-26");
  need(t.length === 60 && t.filter((f) => f.hf).length === 40 && t.filter((f) => !f.hf).length === 20, "the 40 largest hedge funds and the 20 largest of the rest");
  need(new Set(t.map((f) => f.cik)).size === 60 && t[0].cik === "100" && t[0].name === "HF0", "de-duplicated by cik, largest first, the first sight kept");
  const prior = { filerLedger: { 999: { n: "Gone", h: true, t: 7, f: "2026-09-01", r: "2026-06-30" }, 998: { n: "Old", h: false, t: 7, f: "2026-06-01", r: "2026-03-31" } } };
  const t2 = M13.trackFilers(list.slice(0, 30), prior, "2026-10-26");
  need(t2.some((f) => f.cik === "999" && f.kept === true) && !t2.some((f) => f.cik === "998"), "a filer that left the list is kept for ninety days from its filing and then dropped");
  const ledger = { 100: { rows: [[0, 0, 1, 1, 0, 0, 0]], qs: [Q, PQ], f: "2026-10-14", rd: "2026-10-20" }, 101: { rows: [[0, 0, 1, 1, 0, 0, 0]], qs: [Q, PQ], f: "2026-07-14", rd: "2026-09-01" }, 102: { rows: [[0, 0, 1, 1, 0, 0, 0]], qs: [Q, PQ], f: "2026-07-14", rd: "2026-10-01" } };
  const tr = [{ cik: "100", total: 9, filed: "2026-10-14" }, { cik: "101", total: 8, filed: "2026-07-14" }, { cik: "102", total: 7, filed: "2026-07-14" }, { cik: "103", total: 6, filed: "2026-10-14" }, { cik: "104", total: 99, filed: "2026-10-14", kept: true }, { cik: "105", total: 5, filed: "2026-10-20" }, { cik: "106", total: 4, filed: "2026-07-14" }];
  ledger[106] = { rows: [[0, 0, 1, 1, 0, 0, 0]], qs: [Q, PQ], f: "2026-07-14", rd: "2026-10-20" };
  ledger[105] = { rows: [[0, 0, 1, 1, 0, 0, 0]], qs: [Q, PQ], f: "2026-10-14", rd: "2026-10-26" };
  const plan = M13.planFilers(tr, ledger, "2026-10-27").map((f) => f.cik);
  need(JSON.stringify(plan) === JSON.stringify(["103", "105", "101", "102"]), "the plan reads an unread filer first, a new filing next, the oldest read after that, nothing read within twenty days, and no kept filer: " + plan.join(","));
  const many = Array.from({ length: 60 }, (_, i) => ({ cik: String(i), total: 100 - i, filed: "2026-10-14" }));
  need(M13.planFilers(many, {}, "2026-10-27").length === 40, "at most forty a night");
  return fails;
}

const battery = (m) => ({
  rotation: rotationBattery(m.P13 || P13),
  insider: insiderBattery(m.PI || PI),
  short: shortBattery(m.PS || PS),
  layers: layerBattery(m.PL || PL),
  hand: handBattery(m.P13 || P13),
});
const failures = (b) => Object.values(b).flat();

{
  const b = battery({});
  eq(failures(b), [], "THE LEAVES AGREE WITH THE EXACT ORACLE: rotation, breadth, insider windows and nets, failure notional and share, pooled short ratios, venue shares, session lags, returns and initials");
  ok(ORACLE.rotation.length === 300 && ORACLE.rotation.some((w) => w.expect.compared > 0 && w.expect.notFiled > 0) && ORACLE.rotation.some((w) => w.expect.unread > 0), "and the worlds include filers that have not filed and filers that were not read");
  ok(ORACLE.lag.some((c) => c.n === null) && ORACLE.lag.some((c) => c.days === 45) && ORACLE.lag.some((c) => c.days === 46), "the lag cases include a date outside the calendar and the 45th and 46th days");
}

{
  const hand = (name, value, p = "shared/flows-pos-13f.js") => [name, p, value];
  const PLANTS = [
    ["rotation by summed dollars instead of mean weights", "shared/flows-pos-13f.js", [["meanNow[s] += (100 * (a ? a.value : 0)) / u.vNow;", "meanNow[s] += (100 * (a ? a.value : 0)) / (used.reduce((x, y) => x + y.vNow, 0) / used.length);"]], "P13"],
    ["the two quarters swapped", "shared/flows-pos-13f.js", [["const now = slice(e, 0);", "const now = slice(e, 1);"], ["const before = slice(e, 1);", "const before = slice(e, 0);"]], "P13"],
    ["breadth over inc plus dec instead of positions", "shared/flows-pos-13f.js", [["Math.round(((g.inc - g.dec) / g.pos) * 1e4) / 1e4", "Math.round(((g.inc - g.dec) / (g.inc + g.dec)) * 1e4) / 1e4"]], "P13"],
    ["the change rounded per cell so the column does not foot", "shared/flows-pos-13f.js", [["dW: Math.round((table.cells[i][0] - table.cells[i][1])) / 100,", "dW: Math.round((a[i] / 1e6 - b[i] / 1e6) * 100) / 100,"]], "P13"],
    ["a kept filer dropped the night it leaves the list", "shared/flows-pos-13f.js", [["if (age === null || age > TRACK.keepDays) continue;", "continue;"]], "P13"],
    ["the quarter before computed as ninety days", "shared/flows-pos-13f.js", [["export function quarterBefore(day) {", "export function quarterBefore(day) {\n  if (isDay(day)) return addDays(day, -91);"]], "P13"],
    ["a dollar string truncated instead of rounded", "shared/flows-pos-13f.js", [["const whole = (c.cents + 50) / 100;", "const whole = c.cents / 100;"]], "P13"],
    ["the plan reading the newest first", "shared/flows-pos-13f.js", [["picked.sort((a, b) => (a.g - b.g) ||", "picked.sort((a, b) => (b.g - a.g) ||"]], "P13"],
    ["the insider window per sector instead of the common one", "shared/flows-pos-insider.js", [["const from = mins.sort().pop();", "const from = mins.sort()[0];"]], "PI"],
    ["a missing insider date read as zero", "shared/flows-pos-insider.js", [["if (!c) { gaps++; out.push([d, null, null]); continue; }", "if (!c) { out.push([d, 0, 0]); continue; }"]], "PI"],
    ["an unread filer read as a zero-weight book in the mean", "shared/flows-pos-13f.js", [["arr.map((v) => (v / used.length) * MICRO)", "arr.map((v) => (v / tracked.length) * MICRO)"]], "P13"],
    ["insider volume including the premium field", "shared/flows-pos-insider.js", [["vol: r.volume };", "vol: r.volume + Number(r.premium || 0) };"]], "PI"],
    ["the insider net not normalised", "shared/flows-pos-insider.js", [["const net = buyers + sellers > 0 ? Math.round(((buyers - sellers) / (buyers + sellers)) * 1e4) / 1e4 : null;", "const net = buyers + sellers > 0 ? buyers - sellers : null;"]], "PI"],
    ["a failure notional with a missing price as zero", "shared/flows-pos-short.js", [["notional: pxC === null ? null : halfAway((r[1] * pxC) / 100),", "notional: halfAway((r[1] * (pxC || 0)) / 100),"]], "PS"],
    ["a share against an advance of zero", "shared/flows-pos-short.js", [["Number.isFinite(a) && a > 0 ? a : null;", "Number.isFinite(a) && a >= 0 ? a : null;"]], "PS"],
    ["heavy at five per cent instead of half a per cent", "shared/flows-pos-short.js", [["heavyShare: 0.005", "heavyShare: 0.05"]], "PS"],
    ["the ten-day ratio as a mean of ratios", "shared/flows-pos-short.js", [["ratio10: t10 > 0 ? r4(s10 / t10) : null", "ratio10: t10 > 0 ? r4(days.reduce((a, d) => a + (d[2] ? d[1] / d[2] : 0), 0) / days.length) : null"]], "PS"],
    ["the venue share over total volume", "shared/flows-pos-short.js", [["share: sumShort > 0 ? r4(m.short / sumShort) : null", "share: sumShort > 0 ? r4(m.short / [...mix.values()].reduce((a, x) => a + x.total, 0)) : null"]], "PS"],
    ["the sector ratio as the mean of the names", "shared/flows-pos-short.js", [["ratio: c.n && c.total > 0 ? r4(c.short / c.total) : null", "ratio: c.n && c.total > 0 ? r4(c.short / c.total / 2) : null"]], "PS"],
    ["the lag in weekdays", "shared/flows-pol-layers.js", [["lagS: sessionsBetween(row.txnDate, row.filedDate),", "lagS: Math.round(daysBetween(row.txnDate, row.filedDate) * 5 / 7),"]], "PL"],
    ["the lag from filing to trade", "shared/flows-pol-layers.js", [["lagS: sessionsBetween(row.txnDate, row.filedDate),", "lagS: sessionsBetween(row.filedDate, row.txnDate),"]], "PL"],
    ["past 45 as at least 45", "shared/flows-pol-layers.js", [["lagD !== null && lagD > LAYER_CAPS.over45", "lagD !== null && lagD >= LAYER_CAPS.over45"]], "PL"],
    ["the excess return with its sign flipped", "shared/flows-pol-layers.js", [["ex: r !== null && rSpy !== null ? r4(r - rSpy) : null,", "ex: r !== null && rSpy !== null ? r4(rSpy - r) : null,"]], "PL"],
    ["a non-positive price kept", "shared/flows-pol-layers.js", [["Number.isFinite(v) && v > 0 ? v : null;", "Number.isFinite(v) && v !== 0 ? v : null;"]], "PL"],
    ["an unknown tag printed as the feed's text", "shared/flows-pol-layers.js", [["UNUSUAL_TAGS[t].code : \"other\";", "UNUSUAL_TAGS[t].code : t;"]], "PL"],
    ["initials from the first two words", "shared/flows-pol-layers.js", [["words[0][0].toUpperCase() + words[words.length - 1][0].toUpperCase()", "words[0][0].toUpperCase() + words[1][0].toUpperCase()"]], "PL"],
    ["a full name stored", "shared/flows-pol-layers.js", [["who: initialsOf(row.who || (idNames && row.id ? idNames[row.id] : null)),", "who: row.who || (idNames && row.id ? idNames[row.id] : null),"]], "PL"],
  ];
  void hand;
  for (const [title, file, transforms, key] of PLANTS) {
    const mod = await loadMutated(file, transforms);
    const b = battery({ [key]: mod });
    ok(failures(b).length > 0, "PLANTED WRONG BUILD FAILS: " + title);
  }
  eq(PLANTS.length >= 25, true, "at least twenty-five wrong builds are planted in the leaves");
}

{
  const forecast = new RegExp("\\b(?:" + FORECAST_ALT + ")\\b", "i");
  const barred = /\b(?:vendor|tape|unusual whales)\b/i;
  ok(COPY.ALL_SENTENCES.length >= 33, "the copy module holds every sentence the page and the layers print: " + COPY.ALL_SENTENCES.length);
  for (const sentence of COPY.ALL_SENTENCES) {
    ok(sentence.split(/[;.]/).every((clause) => COPY.wordCount(clause) <= 14), `at most fourteen words in each clause: ${sentence}`);
    ok(sentence === "Nothing here is advice or a forecast." || !forecast.test(guardText(sentence)), `no forecast or modal word: ${sentence}`);
    ok(!barred.test(sentence), `no provider name, vendor or tape: ${sentence}`);
  }
  eq(COPY.INFO_SENTENCES.length, 11, "the info dialog holds the eleven sentences of the specification");
  const pos = fs.readFileSync(path.join(ROOT, "assets/js/flows-pos.js"), "utf8");
  const pol = fs.readFileSync(path.join(ROOT, "assets/js/flows-political.js"), "utf8");
  const html = positioningBody((g) => g, ["2026-10-26"]);
  for (const sentence of [...Object.values(COPY.WHY), ...Object.values(COPY.STATE_SENTENCES), ...Object.values(COPY.FOOTERS)]) ok(pos.includes(JSON.stringify(sentence)), `THE BROWSER'S COPY EQUALS THE LEAF'S (flows-pos.js): ${sentence}`);
  for (const sentence of COPY.INFO_SENTENCES) ok(html.includes(sentence.replace(/'/g, "&#39;")), `the served page prints the info sentence: ${sentence}`);
  for (const sentence of Object.values(COPY.LAYER_SENTENCES)) ok(pol.includes(JSON.stringify(sentence)), `THE BROWSER'S COPY EQUALS THE LEAF'S (flows-political.js): ${sentence}`);
  for (const [file, text] of [["flows-pos.js", pos], ["flows-pos.css", fs.readFileSync(path.join(ROOT, "assets/css/flows-pos.css"), "utf8")], ["page", html]]) {
    ok(!/\bTape\b|\btape\b|plTape/.test(text), `no tape in ${file}`);
    ok(!/vendor|unusual whales/i.test(text), `no vendor or provider name in ${file}`);
  }
}

{
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "assets/js/flows-political.js"), "utf8"), sandbox);
  const browser = sandbox.__PoliticalTest.initials;
  const given = ["Nancy", "Paul", "Maria", "José", "Zoë", "Renée", "O'Neil", "Van Der Berg", "Ana-Maria", "Li", "Wu"];
  const family = ["Pelosi", "Ryan", "Cantwell", "García", "Müller", "Smith-Jones", "de la Cruz", "Nguyen", "Brown"];
  const marks = ["", "Hon. ", "Rep. ", "Sen. ", "Dr. ", "Mrs. ", "Representative ", "Senator "];
  const tails = ["", " Jr.", " Sr.", " III", " II", " IV"];
  const names = [];
  for (let i = 0; names.length < 300; i++) names.push(marks[i % marks.length] + given[i % given.length] + (i % 5 === 0 ? " " + given[(i * 3) % given.length] : "") + " " + family[(i * 7) % family.length] + tails[i % tails.length]);
  names.push("", "   ", "Hon.", "Cher", "Jr.", "123", null, undefined, 42, "X Æ A-12");
  for (const n of names) eq(browser(n), PL.initialsOf(n), `THE BROWSER'S INITIALS EQUAL THE LEAF'S: ${JSON.stringify(n)}`);
}

console.log(`✓ flows-pos-leaves: ${checks} assertions — every pure positioning leaf held to an exact rational oracle over 300 rotation worlds, 50 insider worlds, 100 short worlds, the exchange calendar's session lags, returns against the index and initials, plus the hand cases of the tracked set and the read plan, and ${25}+ planted wrong builds that each fail`);
