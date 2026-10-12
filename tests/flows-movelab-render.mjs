import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import { buildUniverse, projectUniverse, projectionColumns, UNIVERSE_COLUMNS } from "../shared/flows-cross.js";
import { frequencyText, rarityText, sigmaProfile, sigmaRef } from "../shared/flows-targets.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker-movelab.js"), "utf8");
const TICKER_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WHEN = { premarket: "before the open", afterhours: "after the close" };
const SESSIONS = 252;

const PAGE = FLOWS_PAGES.tickerPage({ username: "u" });
ok(/<i hidden data-defer="movelab" data-src="\/assets\/js\/flows-ticker-movelab\.js\?v=\d+" id="ftMoveLab"><\/i>/.test(PAGE), "the ticker page declares the move lab as one hidden, versioned deferred file");
ok(!/<script[^>]+flows-ticker-movelab/.test(PAGE), "and does not ship it as a script");
ok(!/data-defer="scenes"/.test(PAGE) && /data-defer="scenes"/.test(FLOWS_PAGES.tickerPage({ username: "u", scenes: true })), "the scenes switch is independent of the move lab");
ok(/\.defer\("movelab", \{ when: "visible"/.test(TICKER_SRC) && !/data-defer="movelab"/.test(TICKER_SRC), "the controller defers the group when its module nears the viewport and declares nothing itself");
ok(!/sigma|σ|standard deviation/i.test(SRC) && !/sigma|σ|standard deviation/i.test(TICKER_SRC.slice(TICKER_SRC.indexOf("function buildMoveLab"), TICKER_SRC.indexOf("function buildScenes"))), "no sigma wording in the module or in its stub");

function load(src) {
  const win = { FlowsUI: { h: () => ({}), F: { day: (d) => d }, DASH: "—", infoButton: () => ({}), tag: () => ({}) } };
  vm.runInNewContext(src, { window: win, Math, Number, Array, Object, String, Set, JSON, Date, Promise, Error, fetch: () => Promise.reject(new Error("no network")) }, { filename: "flows-ticker-movelab.js" });
  return win.FlowsUI.moveLab;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

const dayText = (iso) => MONTHS[+iso.slice(5, 7) - 1] + " " + +iso.slice(8, 10);
const halfUp = (num, den) => (2n * BigInt(num) + BigInt(den)) / (2n * BigInt(den));
const dollars = (spotCents, sigInt, k, dir) => {
  const cents = halfUp(BigInt(spotCents) * (100000n + BigInt(dir) * BigInt(k) * BigInt(sigInt)), 100000n);
  return "$" + Number(cents / 100n).toLocaleString("en-US") + "." + String(cents % 100n).padStart(2, "0");
};
const usdOf = (cents) => "$" + Number(BigInt(cents) / 100n).toLocaleString("en-US") + "." + String(BigInt(cents) % 100n).padStart(2, "0");
const pctOf = (units, perUnit) => {
  const h = halfUp(BigInt(units), BigInt(perUnit));
  return (h / 100n) + "." + String(h % 100n).padStart(2, "0") + "%";
};
const sigText = (sigInt, k = 1) => pctOf(k * sigInt, 10);
const fracText = (fiveDecimals) => pctOf(fiveDecimals, 10);

const weekdays = (endIso, count) => {
  const out = [];
  let t = Date.parse(endIso + "T00:00:00Z");
  while (out.length < count) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    t -= 864e5;
  }
  return out;
};

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function series({ end, sigInt, plan, closes = 253, start = 100 }) {
  const sig = sigInt / 1e5;
  const mags = [];
  for (const [mult, count] of plan) for (let i = 0; i < count; i++) mags.push(mult);
  const rnd = lcg(7);
  for (let i = mags.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mags[i], mags[j]] = [mags[j], mags[i]]; }
  const dates = weekdays(end, closes);
  let c = start;
  const rows = [[dates[0], c]];
  for (let i = 1; i < dates.length; i++) {
    c *= Math.exp((i % 2 ? 1 : -1) * mags[(i - 1) % mags.length] * sig);
    rows.push([dates[i], c]);
  }
  return rows;
}

function oracleCounts(rows, sigInt, ks, breaks = []) {
  const bars = rows.map(([d, c]) => ({ d, c }));
  const r = sigmaRef(bars, { keep: true, breaks });
  const out = {};
  for (const k of ks) {
    const hits = r.returns.filter((x) => Math.abs(x) * 1e5 >= k * sigInt).length;
    out[k] = { n: r.returns.length, hits: r.returns.length === SESSIONS ? hits : Math.round((hits * SESSIONS) / r.returns.length) };
  }
  return out;
}

function universeFor(entries, { omit = [] } = {}) {
  const rows = entries.map((e, i) => ({ ticker: e.t, marketcap: 1e12 - i * 1e9, sector: "Technology" }));
  const sigma = new Map(entries.filter((e) => e.sig !== null && e.sig !== undefined).map((e) => [e.t, { s: e.sig, f2: e.f2 === undefined ? null : e.f2, f3: e.f3 === undefined ? null : e.f3 }]));
  const days = { key: "ed", unit: "sessions", scale: 1, prio: 2, get: (r) => { const e = entries.find((x) => x.t === r.ticker); return e && e.ed !== undefined ? e.ed : null; } };
  const columns = [...UNIVERSE_COLUMNS.filter((c) => ["sig", "f2", "f3"].includes(c.key)), days].filter((c) => !omit.includes(c.key));
  const u = buildUniverse(rows, { sessionDate: "2026-08-24", generatedAt: "2026-08-24T21:45:00Z", columns, sigma });
  return projectUniverse(u, projectionColumns("ed,f2,f3,sig,t"));
}

const API = load(SRC);

function hitsOf() {
  const out = [];
  for (let n = 0; n <= SESSIONS; n++) {
    const want = frequencyText({ route: "empirical", hits: n, sessions: SESSIONS });
    if (API.frequency(n) !== want) out.push(`frequency(${n}) is ${API.frequency(n)} where the leaf says ${want}`);
  }
  return out;
}

function modelFailures(M) {
  const bad = [];
  const note = (c, m) => { if (!c) bad.push(m); };
  for (let n = 0; n <= SESSIONS; n++) {
    const want = frequencyText({ route: "empirical", hits: n, sessions: SESSIONS });
    note(M.frequency(n) === want, `frequency(${n}) reads ${M.frequency(n)}, the leaf says ${want}`);
  }
  note(M.frequency(-1) === null && M.frequency(253) === null && M.frequency(1.5) === null && M.frequency(NaN) === null, "a count outside 0 to 252 or not whole has no sentence");
  note(/^rarer than 1 in 250 sessions for this name over the last year$/.test(M.frequency(1)), "one hit in 252 reads rarer than 1 in 250, never 1 in 252");
  note(/^rarer than 1 in 250 sessions.*fewer than 1 in 80 at 95%$/.test(M.frequency(0)), "zero hits reads rarer than 1 in 250 with the 95% bound");
  note(M.frequency(2) === "about 1 in 126 sessions for this name over the last year", "two hits in 252 is about 1 in 126");
  note(/\(95% interval 1 in \d+ to 1 in \d+\)$/.test(M.frequency(5)) && !/interval/.test(M.frequency(4)), "the interval starts at five hits");
  for (const [k, sig, hits] of [[2, 0.0123, 11], [3, 0.0456, 5], [1, 0.02, 80], [4, 0.0087, 0], [3, 0.011, 1]]) {
    const leaf = rarityText({ k, sigmaRef: sig, route: "empirical", hits, sessions: SESSIONS });
    note(leaf.endsWith("; " + M.frequency(hits)), `the leaf's rarity text for ${k} typical days ends in this module's sentence for ${hits} hits`);
  }
  note(M.fmt.pct(0.0123) === "1.23%" && M.fmt.pct(0.05) === "5.00%" && M.fmt.pct(0.04) === "4.00%" && M.fmt.pct(0.00005) === "0.01%", "a fraction prints as a percent of the price: 0.0123 is 1.23%, not 0.01%");
  note(M.fmt.usd(1234.5) === "$1,234.50" && M.fmt.usd(0.5) === "$0.50" && M.fmt.usd(101.215) === "$101.22" && M.fmt.usd(1234567.891) === "$1,234,567.89", "prices carry the dollar sign, cents and thousands");

  const spots = [18650, 123456, 999, 100, 4567890];
  const sigs = [1230, 80, 2500 - 1, 455, 1215, 3];
  for (const spotCents of spots) for (const sigInt of sigs) {
    const spot = spotCents / 100, sig = sigInt / 1e5;
    const row = { sig, f2: 11, f3: 5, ed: null, why: null };
    const m = plain(M.model({ ticker: "T", spot, asOf: "2026-08-24", closes: [], implied: null, report: null }, row));
    note(m.why === null && m.ladder.length === 4, `${spotCents}/${sigInt}: a ladder of four sizes is built`);
    if (m.ladder.length !== 4) continue;
    m.ladder.forEach((r, i) => {
      const k = i + 1;
      note(r.k === k, "sizes run 1 to 4");
      note(M.fmt.pct(r.move) === sigText(sigInt, k), `${spotCents}/${sigInt}: ${k} typical days prints ${M.fmt.pct(r.move)}, the exact figure is ${sigText(sigInt, k)}`);
      note(M.fmt.usd(r.up) === dollars(spotCents, sigInt, k, 1), `${spotCents}/${sigInt}: up at ${k} prints ${M.fmt.usd(r.up)}, the exact figure is ${dollars(spotCents, sigInt, k, 1)}`);
      note(M.fmt.usd(r.down) === dollars(spotCents, sigInt, k, -1), `${spotCents}/${sigInt}: down at ${k} prints ${M.fmt.usd(r.down)}, the exact figure is ${dollars(spotCents, sigInt, k, -1)}`);
      note(r.up > spot && r.down < spot && r.down > 0, "up is above spot, down is below it and above zero");
      note(Math.abs((r.up - spot) - (spot - r.down)) < 1e-9 * spot, "the two steps from spot are equal");
    });
    note(m.ladder[1].count.basis === "nightly" && m.ladder[1].count.hits === 11 && m.ladder[2].count.hits === 5, "two and three typical days read the nightly counts");
    note(m.ladder[0].count.hits === undefined && m.ladder[3].count.hits === undefined, "one and four typical days with no closes on the card are withheld, never zero");
    note(/no daily closes/.test(m.ladder[0].count.why), "and say why");
  }

  const rows = series({ end: "2026-08-24", sigInt: 1230, plan: [[4.6, 4], [3.4, 3], [2.4, 7], [1.4, 30], [0.4, 208]] });
  const want = oracleCounts(rows, 1230, [1, 2, 3, 4]);
  note(want[1].hits === 44 && want[2].hits === 14 && want[3].hits === 7 && want[4].hits === 4 && want[1].n === 252, "the planted history has 44, 14, 7 and 4 days at 1, 2, 3 and 4 typical days");
  const base = { ticker: "T", spot: 100, asOf: "2026-08-24", closes: rows, breaks: [], implied: null, report: null };
  const full = plain(M.model(base, { sig: 0.0123, f2: 11, f3: 5, ed: null, why: null }));
  note(full.ladder.map((r) => r.count.hits).join(",") === "44,11,5,4", "counts: the card's for 1 and 4, the nightly's for 2 and 3");
  note(full.ladder.map((r) => r.count.basis).join(",") === "card,nightly,nightly,card", "and each says where it came from");
  note(full.ladder[0].count.n === 252 && full.ladder[0].count.how === frequencyText({ route: "empirical", hits: 44, sessions: SESSIONS }), "a full year is counted as it stands and described by the leaf's sentence");
  const noPub = plain(M.model(base, { sig: 0.0123, f2: null, f3: null, ed: null, why: null }));
  note(noPub.ladder.map((r) => r.count.hits).join(",") === "44,14,7,4", "with no nightly count, two and three typical days are counted on the card");
  const short = rows.slice(-231);
  const wantShort = oracleCounts(short, 1230, [1, 4]);
  const scaled = plain(M.model({ ...base, closes: short }, { sig: 0.0123, f2: null, f3: null, ed: null, why: null }));
  note(scaled.ladder[0].count.n === 230 && scaled.ladder[0].count.hits === wantShort[1].hits && scaled.ladder[3].count.hits === wantShort[4].hits, "230 returns are scaled to 252 by the same rule as the nightly count");
  const tooShort = plain(M.model({ ...base, closes: rows.slice(-150) }, { sig: 0.0123, f2: 4, f3: 1, ed: null, why: null }));
  note(tooShort.ladder[0].count.hits === undefined && /149 usable daily returns/.test(tooShort.ladder[0].count.why), "under 200 returns the card gives no count and says how many it has");
  note(tooShort.ladder[1].count.hits === 4 && tooShort.ladder[2].count.hits === 1, "while the nightly counts still stand");
  const brk = rows[100][0];
  const withBreak = oracleCounts(rows, 1230, [1, 4], [brk]);
  const brkModel = plain(M.model({ ...base, breaks: [brk] }, { sig: 0.0123, f2: null, f3: null, ed: null, why: null }));
  note(brkModel.ladder[0].count.hits === withBreak[1].hits && brkModel.ladder[0].count.n === withBreak[1].n, "returns across a data break are left out, as the nightly leaves them");
  const gapped = rows.filter((_, i) => i < 100 || i > 105);
  const wantGap = oracleCounts(gapped, 1230, [1], []);
  const gapModel = plain(M.model({ ...base, closes: gapped }, { sig: 0.0123, f2: null, f3: null, ed: null, why: null }));
  note(gapModel.ladder[0].count.n === wantGap[1].n, "a gap of more than four calendar days drops that return");

  const exactSig = Math.LN2 / 4;
  const days = weekdays("2026-08-24", 253);
  let level = 100;
  const exact = days.map((d, i) => {
    if (i > 0) level *= i === 100 ? 2 : i === 101 ? 0.5 : Math.exp((i % 2 ? 1 : -1) * 0.1 * exactSig);
    return [d, level];
  });
  const edge = plain(M.model({ ...base, closes: exact }, { sig: exactSig, f2: null, f3: null, ed: null, why: null }));
  note(edge.ladder.map((r) => r.count.hits).join(",") === "2,2,2,2" && edge.ladder[3].count.n === 252, "a day that moves exactly four typical days counts at four typical days");

  const walk = (seed, n, scale) => {
    const r = lcg(seed);
    let c = 100;
    return weekdays("2026-08-24", n).map((d, i) => {
      if (i) c *= Math.exp((r() + r() + r() + r() - 2) * 1.7 * scale * (r() < 0.04 ? 3.5 : 1));
      return [d, c];
    });
  };
  for (const [seed, n, scale] of [[11, 300, 0.012], [12, 253, 0.02], [13, 231, 0.006]]) {
    const hist = walk(seed, n, scale);
    const p = sigmaProfile(hist.map(([d, c]) => ({ d, c })));
    note(p.ok === true, `the nightly's own profile reads the ${n}-close history`);
    if (!p.ok) continue;
    const rets = M.returnsOf(hist, []);
    note(M.counted(rets, p.s, 2).hits === p.f2 && M.counted(rets, p.s, 3).hits === p.f3, `${n} closes: this module's count at two and three typical days is the nightly's f2 (${p.f2}) and f3 (${p.f3}) on a history with no report days`);
  }

  const none = plain(M.model({ ticker: "T", spot: 100 }, { sig: null, f2: null, f3: null, ed: null, why: "No typical daily move is published for T." }));
  note(none.ladder.length === 0 && none.why === "No typical daily move is published for T.", "no typical day withholds the ladder with the reason it was given");
  note(plain(M.model({ ticker: "T", spot: null }, { sig: 0.01, f2: 1, f3: 1, ed: null, why: null })).ladder.length === 0, "no price withholds the ladder");
  note(plain(M.model({ ticker: "T", spot: 0 }, { sig: 0.01 })).ladder.length === 0 && plain(M.model({ ticker: "T", spot: -5 }, { sig: 0.01 })).ladder.length === 0, "a price of zero or below is no price");
  note(plain(M.model({ ticker: "T", spot: 100 }, { sig: 0 })).ladder.length === 0 && plain(M.model({ ticker: "T", spot: 100 }, { sig: -0.01 })).ladder.length === 0, "a typical day of zero or below is withheld, never printed as a flat ladder");
  note(plain(M.model({ ticker: "T", spot: 100 }, { sig: 0.25 })).ladder.length === 0 && plain(M.model({ ticker: "T", spot: 100 }, { sig: 0.249 })).ladder.length === 4, "a typical day of a quarter of the price or more is outside any plausible range and is withheld");
  note(/outside any plausible range/.test(plain(M.model({ ticker: "T", spot: 100 }, { sig: 1.2 })).why), "a figure of 1.2 read as a fraction is refused, not printed as 120%");
  note(plain(M.model({ ticker: "T", spot: 100 }, { sig: 0.249, f2: 1 })).ladder.every((r) => r.down > 0), "even at the ceiling no level falls to zero or below");
  note(plain(M.model({ ticker: "T", spot: 100 }, null)).ladder.length === 0, "no universe row at all withholds the ladder");

  const imp = (extra) => plain(M.model({ ticker: "T", spot: 100, implied: extra }, { sig: 0.01 })).implied;
  note(imp({ move: 0.024, low: 97.6, high: 102.4, rule: "the nearest end-of-week expiry", asOf: "2026-08-24" }).move === 0.024, "the market's move is carried as given");
  note(imp(null).why && imp({ why: "No quote." }).why === "No quote." && imp({ move: 0 }).why && imp({ move: -0.02 }).why, "an absent, zero or negative implied move is withheld with a reason");

  const rep = (report, ed, why) => plain(M.model({ ticker: "T", spot: 100, report, reportWhy: why }, { sig: 0.01, ed })).report;
  note(rep({ d: "2026-09-08", sessions: 21 }, null).state === "inside" && rep({ d: "2026-09-09", sessions: 22 }, null).state === "outside", "a report 21 sessions away is inside the window and 22 is outside it");
  note(rep({ d: "2026-09-08", sessions: 1 }, null).state === "inside", "tomorrow is inside");
  note(rep(null, 21).state === "inside" && rep(null, 22).state === "outside" && rep(null, 0).state === "inside", "tonight's universe supplies the distance when the card has no date");
  note(rep({ d: "2026-09-08", sessions: 30 }, 5).sessions === 30, "the card's own distance wins over the universe's");
  note(rep({ d: "2026-09-08", sessions: null, gate: true }, null).state === "inside", "a name inside the earnings gate is inside");
  note(rep(null, null, "Not built.").state === "unknown" && rep(null, null, "Not built.").why === "Not built.", "no date and no distance is unknown with the reason the card gave");
  note(rep({ d: "2026-09-08", sessions: null }, null).state === "unknown", "a date with no distance is unknown, not outside");
  note(rep({ d: "2026-09-08", sessions: 4, em: 0.0618 }, null).em === 0.0618 && rep({ d: "2026-09-08", sessions: 4, em: 0 }, null).em === null, "a report move of zero is not a move");

  const col = (rowIn) => plain(M.rowOf(rowIn.u, rowIn.t));
  const u = universeFor([{ t: "AAA", sig: 0.0123, f2: 11, f3: 5, ed: 7 }, { t: "BBB", sig: null, f2: null, f3: null, ed: null }, { t: "CCC", sig: 0.031, f2: 9, f3: 0, ed: 40 }]);
  const a = col({ u, t: "AAA" });
  note(Math.abs(a.sig - 0.0123) < 1e-12 && a.f2 === 11 && a.f3 === 5 && a.ed === 7 && a.why === null, "a row is read from the projection with each column's own scale");
  const c = col({ u, t: "CCC" });
  note(c.f3 === 0 && c.f2 === 9, "a published zero is a zero, not a gap");
  note(col({ u, t: "BBB" }).sig === null && /needs 200 clean sessions/.test(col({ u, t: "BBB" }).why), "a null typical day is withheld with the history rule");
  note(/is not in tonight's screened universe/.test(col({ u, t: "ZZZ" }).why), "a name outside the universe says so");
  const noSig = col({ u: universeFor([{ t: "AAA", sig: 0.01 }], { omit: ["sig", "f2", "f3"] }), t: "AAA" });
  note(noSig.sig === null && /does not publish a typical daily move yet/.test(noSig.why), "an absent column is the nightly's, said as such");
  note(/has not published yet/.test(col({ u: { status: "pending" }, t: "AAA" }).why) && /unavailable: over budget/.test(col({ u: { status: "unavailable", reason: "over_budget" }, t: "AAA" }).why) && /could not be read/.test(col({ u: null, t: "AAA" }).why), "a pending, refused or unreadable universe is named");
  for (const [name, bu] of [["unreadable", null], ["pending", { status: "pending" }], ["refused", { status: "unavailable", reason: "over_budget" }], ["without the name", u]]) {
    const g = col({ u: bu, t: name === "without the name" ? "ZZZ" : "AAA" });
    note(g.sig === null && g.f2 === null && g.f3 === null && g.ed === null && typeof g.why === "string", `a ${name} universe gives no figure at all, not a zero`);
    note(plain(M.model({ ticker: "T", spot: 100 }, g)).ladder.length === 0, `and a ladder is not built from a ${name} universe`);
  }
  return bad;
}

const failures = modelFailures(API);
eq(failures, [], "the model passes its exact answers");
eq(hitsOf(), [], "every count from 0 to 252 reads as the leaf's sentence");

const MUTANTS = [
  ["const move = k * sig;", "const move = (k * sig) / 100;", "the typical day taken as a percent in the levels"],
  ["const pctText = (x) => r2(x * 100).toFixed(2) + \"%\";", "const pctText = (x) => r2(x).toFixed(2) + \"%\";", "the typical day printed as if already a percent"],
  ["out.ladder.push({ k, move, up: spot * (1 + move), down: spot * (1 - move), count });", "out.ladder.push({ k, move, up: spot * (1 - move), down: spot * (1 + move), count });", "up and down levels swapped"],
  ["if (hits === 0 || SESSIONS / hits > FLOOR_N) {", "if (hits === 0) {", "the 1 in 250 floor missing"],
  ["const FLOOR_N = 250;", "const FLOOR_N = 500;", "the floor at 1 in 500"],
  ["const SIG_CEILING = 0.25;", "const SIG_CEILING = 5;", "no ceiling on the typical day"],
  ["const sig = pos(r.sig);", "const sig = num(r.sig) === null ? 0 : r.sig;", "a missing typical day read as zero"],
  ["if (r >= k * sig) hits++;", "if (r > k * sig) hits++;", "a day exactly that size not counted"],
  ["hits: returns.length === SESSIONS ? hits : Math.round((hits * SESSIONS) / returns.length)", "hits: hits", "short history not scaled to 252"],
  ["|| gap > MAX_GAP_DAYS) continue;", ") continue;", "gaps of a week kept as daily returns"],
  ["broken.has(a.d) || broken.has(b.d) || ", "", "returns across a data break kept"],
  ["const EVENT_SESSIONS = 21;", "const EVENT_SESSIONS = 30;", "a wider report window"],
  ["if (gate || (sessions !== null && sessions <= EVENT_SESSIONS)) return", "if (gate || (sessions !== null && sessions < EVENT_SESSIONS)) return", "the 21st session outside the window"],
  ["if (pub !== null && Number.isInteger(pub) && pub >= 0 && pub <= SESSIONS)", "if (false)", "the nightly counts ignored"],
  ["const sessions = r && num(r.sessions) !== null ? Number(r.sessions) : ed;", "const sessions = ed !== null ? ed : r ? num(r.sessions) : null;", "the universe's distance over the card's"],
  ["if (hits < 5) return core;", "if (hits < 1) return core;", "an interval from one hit"],
  ["const PUBLISHED = { 2: \"f2\", 3: \"f3\" };", "const PUBLISHED = { 2: \"f3\", 3: \"f2\" };", "the two nightly counts crossed"],
  ["const gone = (why) => ({ sig: null, f2: null, f3: null, ed: null, why });", "const gone = (why) => ({ sig: 0.01, f2: 0, f3: 0, ed: null, why });", "an unreadable universe read as a flat typical day"],
];
for (const [from, to, why] of MUTANTS) {
  ok(SRC.includes(from), `the planted build "${why}" targets a line that exists`);
  ok(SRC.split(from).length === 2, `and exactly once`);
  const src = SRC.replace(from, to);
  ok(src !== SRC, `the planted build "${why}" changes the module`);
  const bad = modelFailures(load(src));
  ok(bad.length > 0, `the exact answers fail the planted build "${why}"`);
}

const EMIT_DIR = nightlyEmit();
const cards = fs.readdirSync(EMIT_DIR).filter((f) => /^-card-[A-Z][A-Z0-9.\-]*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(EMIT_DIR, f), "utf8")));
const BASE = cards.find((c) => c.ticker === "AAPL" && c.panels && c.panels.pricedMove && c.panels.pricedMove.status === "ok" && c.panels.context && c.panels.context.candles);
ok(BASE, "the emitter produced a full card with a priced move and daily closes");
const BASE_X = JSON.parse(fs.readFileSync(path.join(EMIT_DIR, "-card-x-AAPL.json"), "utf8"));
const SESSION = BASE.sessionDate;

const SPEC = {
  ticker: "AAPL", spotCents: 123456, sigInt: 1230, f2: 11, f3: 5, ed: 10,
  plan: [[4.6, 4], [3.4, 3], [2.4, 7], [1.4, 30], [0.4, 208]],
  movePerc: 0.02402, rule: "the nearest end-of-week expiry",
  next: { d: "2026-09-08", when: "afterhours", source: "company", confirmed: true, sessions: 10 }, em: 0.0618,
};

function worldFor(over = {}) {
  const s = { ...SPEC, ...over };
  const card = JSON.parse(JSON.stringify(BASE));
  const closes = s.closes === undefined ? series({ end: SESSION, sigInt: s.sigInt || 1230, plan: s.plan }) : s.closes;
  card.panels.context.candles = closes === null ? [] : closes.map(([d, c]) => [d, c, c, c, c, 1000000]);
  card.panels.context.breaks = s.breaks;
  if (s.pm === null) delete card.panels.pricedMove;
  else if (s.pm) card.panels.pricedMove = s.pm;
  else {
    const spot = s.spotCents / 100;
    const m = Math.round(s.movePerc * 1e5) / 1e5;
    Object.assign(card.panels.pricedMove, { status: "ok", spot, movePerc: m, low: Number((spot * (1 - m)).toFixed(2)), high: Number((spot * (1 + m)).toFixed(2)), horizonRule: s.rule, asOf: SESSION });
  }
  const cx = JSON.parse(JSON.stringify(BASE_X));
  if (s.cardX === null) cx.earnings = { status: "unavailable", reason: "unreadable" };
  else {
    cx.earnings.next = s.next === undefined ? null : s.next;
    cx.earnings.impliedNext = s.next && s.em ? { em: s.em, d: s.next.d, when: s.next.when } : null;
  }
  const entries = s.entries || [{ t: "MSFT", sig: 0.01, f2: 3, f3: 1, ed: 30 }, { t: s.ticker, sig: s.sig === undefined ? s.sigInt / 1e5 : s.sig, f2: s.f2, f3: s.f3, ed: s.ed }, { t: "NVDA", sig: 0.02, f2: 7, f3: 2, ed: 12 }];
  const universe = s.universe === undefined ? universeFor(entries, { omit: s.omit || [] }) : s.universe;
  return { spec: s, card, cardX: cx, universe, hits: 0, queue: s.queue || null };
}

async function mountWorld(page, world, trace) {
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (trace) trace.push(u.pathname);
      if (world.serve && world.serve[path.basename(u.pathname)]) return route.fulfill({ contentType: "text/javascript", body: world.serve[path.basename(u.pathname)] });
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      if (key === "universe") {
        world.hits++;
        if (trace) trace.push(u.pathname + u.search);
        const step = world.queue ? world.queue.shift() : null;
        if (step === 500) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(world.universe) });
      }
      const body = key === "card" ? world.card : key === "card-x" ? world.cardX
        : key === "now" ? { serverNow: Date.parse(SESSION + "T22:00:00Z"), phase: { phase: "closed", session: SESSION, trading: false, endsAt: null }, keys: {} } : { status: "pending" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.clock.setFixedTime(new Date(Date.parse(BASE.generatedAt || SESSION + "T21:00:00Z") + 3600e3));
  await page.goto("https://example.test/flows/ticker/?t=" + world.spec.ticker);
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name…"; }, null, { timeout: 20000 });
}

async function reveal(page) {
  await page.locator("#m-movelab").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const st = document.querySelector("#m-movelab .ft-ml-st");
    return !!st && st.textContent.length > 0 && !/Reading the nightly universe/.test(st.textContent);
  }, null, { timeout: 15000 });
  await page.evaluate(() => Promise.all(document.getElementById("m-movelab").getAnimations({ subtree: true }).map((a) => a.finished.catch(() => null))));
}

const readPage = () => {
  const root = document.querySelector("#m-movelab");
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
  const blocks = {};
  for (const b of root.querySelectorAll(".ft-ml-blk")) blocks[b.querySelector("h3").textContent] = b;
  const ladder = blocks["Size ladder"], implied = blocks["The options market's own number"], report = blocks["Earnings report"];
  return {
    title: txt(root.querySelector(".ui-mod-t")),
    base: txt(root.querySelector(".ft-ml-base p")),
    rows: [...root.querySelectorAll(".ft-ml-row")].map((li) => ({
      k: li.dataset.k, head: txt(li.querySelector(".ft-ml-k")), move: txt(li.querySelector(".ft-ml-mv")),
      up: txt(li.querySelector('dd[data-tone="up"]')), down: txt(li.querySelector('dd[data-tone="down"]')),
      labels: [...li.querySelectorAll("dt")].map(txt), n: txt(li.querySelector(".ft-ml-n")), bold: txt(li.querySelector(".ft-ml-n b")), how: txt(li.querySelector(".ft-ml-how")),
    })),
    ladderWhy: txt(ladder && ladder.querySelector(".ft-ml-why")),
    retry: !!(ladder && ladder.querySelector("button.ft-scene-btn")),
    impliedBig: txt(implied && implied.querySelector(".ft-ml-big")),
    impliedCap: txt(implied && implied.querySelector("p.ft-ml-cap")),
    impliedWhy: txt(implied && implied.querySelector(".ft-ml-why")),
    reportState: report ? report.dataset.state : null,
    reportHead: txt(report && report.querySelector(".ft-ml-h")),
    reportBig: txt(report && report.querySelector(".ft-ml-big")),
    reportCaps: report ? [...report.querySelectorAll(".ft-ml-cap")].map(txt) : [],
    reportFlag: txt(report && report.querySelector(".ft-ml-flag")),
    reportTag: !!(report && report.querySelector(".ui-tag")),
    reportWhy: txt(report && report.querySelector(".ft-ml-why")),
    not: txt(root.querySelector(".ft-ml-not")),
    status: txt(root.querySelector(".ft-ml-st")),
    all: txt(root.querySelector(".ft-ml-in")),
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    boxScrollW: root.querySelector(".ft-ml").scrollWidth, boxClientW: root.querySelector(".ft-ml").clientWidth,
    rowCols: root.querySelector(".ft-ml-rows") ? getComputedStyle(root.querySelector(".ft-ml-rows")).gridTemplateColumns.split(" ").length : 0,
    mainCols: getComputedStyle(root.querySelector(".ft-ml-cols")).gridTemplateColumns.split(" ").length,
    isSlot: root.querySelector(".ft-ml").classList.contains("is-slot"),
    infoButtons: root.querySelectorAll(".ft-ml button.ui-info").length,
  };
};

const NOT_TEXT = "What this is not: not a forecast, not a probability and not a price target. The levels are today's price moved by a multiple of a past typical day, the counts say how often that happened and not how often it will, and the options figure is what the market charges, not what it predicts.";

function expectFull(world, got, w) {
  const bad = [];
  const note = (c, m) => { if (!c) bad.push(`${w}px: ${m}`); };
  const s = world.spec;
  const rows = series({ end: SESSION, sigInt: s.sigInt, plan: s.plan });
  const cardCounts = oracleCounts(rows, s.sigInt, [1, 2, 3, 4]);
  note(got.title === "Move lab", "the module is titled Move lab");
  note(got.base === `Typical daily move ${sigText(s.sigInt)} from ${usdOf(s.spotCents)}, the card's price for ${dayText(SESSION)}`, `the base line reads ${got.base}`);
  note(got.rows.length === 4 && got.rows.map((r) => r.k).join(",") === "1,2,3,4", "four sizes, one to four");
  got.rows.forEach((r, i) => {
    const k = i + 1;
    note(r.head === `${k}× a typical day ±${sigText(s.sigInt, k)}`, `size ${k} heads as ${r.head}`);
    note(r.move === "±" + sigText(s.sigInt, k), `size ${k} moves ${r.move}`);
    note(r.up === dollars(s.spotCents, s.sigInt, k, 1), `size ${k} goes up to ${r.up}, exactly ${dollars(s.spotCents, s.sigInt, k, 1)}`);
    note(r.down === dollars(s.spotCents, s.sigInt, k, -1), `size ${k} goes down to ${r.down}, exactly ${dollars(s.spotCents, s.sigInt, k, -1)}`);
    note(r.labels.join("|") === "Rise to|Fall to", `size ${k} labels its two levels`);
    const published = k === 2 ? s.f2 : k === 3 ? s.f3 : null;
    const hits = published !== null ? published : cardCounts[k].hits;
    note(r.bold === `${hits} per 252 sessions`, `size ${k} counts ${r.bold}, expected ${hits} per 252 sessions`);
    note(r.how === frequencyText({ route: "empirical", hits, sessions: SESSIONS }), `size ${k} says "${r.how}"`);
    const basis = published !== null ? "nightly count, report days left out" : `counted on this card's closes${cardCounts[k].n === SESSIONS ? "" : ` (${cardCounts[k].n} returns, scaled)`}, report days kept in`;
    note(r.n === `${hits} per 252 sessions ${basis}`, `size ${k} names its basis: ${r.n}`);
  });
  const m = Math.round(s.movePerc * 1e5);
  note(got.impliedBig === `±${fracText(m)} to ${s.rule}`, `the market's move reads ${got.impliedBig}`);
  const lo = Math.round(s.spotCents * (1 - m / 1e5)), hi = Math.round(s.spotCents * (1 + m / 1e5));
  note(got.impliedCap === `That prices ${usdOf(lo)} to ${usdOf(hi)} around ${usdOf(s.spotCents)}. It is the market's number, not a forecast of where the price goes.`, `the market's range reads ${got.impliedCap}`);
  note(got.reportState === "inside", "a report 10 sessions away is inside the window");
  note(got.reportTag && /Event-contaminated/.test(got.reportHead), "and is tagged event-contaminated");
  note(got.reportBig === `${dayText(s.next.d)}, ${s.next.sessions} sessions away, ${WHEN[s.next.when]}, confirmed`, `the report reads ${got.reportBig}`);
  note(got.reportCaps.some((c) => c === `The options market prices ±${fracText(Math.round(s.em * 1e5))} for the report. That is its number, not a forecast.`), "the market's report move is printed as its number");
  note(/^Event-contaminated: .*not an ordinary day\./.test(got.reportFlag || ""), "and the flag says why");
  note(got.not === NOT_TEXT, "the what-this-is-not line is there, verbatim");
  note(!/sigma|σ|standard deviation/i.test(got.all), "no sigma wording is printed");
  note(!/\bat (the )?(ask|bid)\b|\bNOW\b/i.test(got.all), "the vendor-term lint passes");
  note(got.scrollW <= got.clientW && got.boxScrollW <= got.boxClientW, `no horizontal overflow (page ${got.scrollW} of ${got.clientW}, module ${got.boxScrollW} of ${got.boxClientW})`);
  note(got.rowCols === (w < 640 ? 1 : 2), `the ladder is ${w < 640 ? "one column" : "two columns"} at ${w} px, not ${got.rowCols}`);
  note(got.mainCols === (w >= 1100 ? 2 : 1), `the blocks are ${w >= 1100 ? "side by side" : "stacked"} at ${w} px, not ${got.mainCols} columns`);
  note(!got.isSlot, "the reserved slot is released once the module is drawn");
  note(got.infoButtons === 4, "four information buttons: typical day, counts, market number, report");
  note(got.status === "Move lab ready.", "the status line announces the module");
  return bad;
}

const browser = await chromium.launch();
try {
  for (const w of [1440, 768, 390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w > 700 ? 900 : 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const trace = [];
    const world = worldFor();
    await mountWorld(page, world, trace);
    ok(!trace.some((p) => /flows-ticker-movelab/.test(p)) && world.hits === 0, `${w}px: nothing of the move lab loads, and no universe is read, while the module is below the fold`);
    await reveal(page);
    ok(trace.some((p) => /flows-ticker-movelab\.js/.test(p)) && world.hits === 1, `${w}px: the file and one universe read arrive once the module is near`);
    ok(trace.some((p) => p === "/api/flows/universe?cols=ed,f2,f3,sig,t"), `${w}px: and the read asks for the five columns, sorted`);
    const got = await page.evaluate(readPage);
    eq(expectFull(world, got, w), [], `${w}px: every printed figure matches the independent computation`);
    eq(errors, [], `${w}px: no page errors`);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const world = worldFor();
    await mountWorld(page, world, null);
    await reveal(page);
    const got = await page.evaluate(readPage);
    eq(expectFull(world, got, 1440), [], "the main world reads right at 1440");
    const reps = await page.evaluate(() => [...document.querySelectorAll("#m-movelab .ft-ml-row dd")].map((n) => n.textContent));
    eq(reps.length, 8, "eight levels, an up and a down for each size");
    await page.evaluate(() => document.getElementById("m-movelab").scrollIntoView());
    const idx = await page.evaluate(() => [...document.querySelectorAll("#fxIndex a")].map((a) => a.textContent.trim()));
    ok(idx.some((x) => /Move lab/.test(x)), "the section index lists the module");
    await ctx.close();
  }

  const scenario = async (name, over, check, width = 1440) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const world = worldFor(over);
    await mountWorld(page, world, null);
    await reveal(page);
    const got = await page.evaluate(readPage);
    await check(got, world, page);
    ok(!/\$0\.00|\b0\.00%|NaN|undefined|Infinity/.test(got.all), `${name}: nothing prints a zero price, a zero move, NaN or undefined`);
    eq(errors, [], `${name}: no page errors`);
    await ctx.close();
  };

  await scenario("no typical day column", { omit: ["sig", "f2", "f3"] }, (got) => {
    eq(got.rows.length, 0, "no ladder rows when the nightly run publishes no typical daily move");
    eq(got.ladderWhy, "— The nightly run does not publish a typical daily move yet.", "the reason is printed");
    ok(!got.retry, "and no retry is offered for a thing a retry cannot change");
    ok(got.impliedBig !== null && got.reportState === "inside", "the market's number and the report row still stand");
    ok(/Typical daily move —/.test(got.base), "the base line shows a dash, not a zero");
  });

  await scenario("typical day null for the name", { sig: null, f2: null, f3: null }, (got) => {
    eq(got.rows.length, 0, "no ladder for a name with no typical day");
    ok(/No typical daily move is published for AAPL: it needs 200 clean sessions of history/.test(got.ladderWhy), "the history rule is the reason");
  });

  await scenario("name not in the universe", { entries: [{ t: "MSFT", sig: 0.01, f2: 3, f3: 1, ed: 30 }] }, (got) => {
    eq(got.rows.length, 0, "no ladder for a name outside the universe");
    ok(/AAPL is not in tonight's screened universe/.test(got.ladderWhy), "and the reason names the universe");
  });

  await scenario("universe pending", { universe: { status: "pending" } }, (got) => {
    eq(got.rows.length, 0, "no ladder while tonight's universe is pending");
    ok(/has not published yet/.test(got.ladderWhy), "and says so");
  });

  await scenario("implausible typical day", { sig: 1.2 }, (got) => {
    eq(got.rows.length, 0, "a figure of 1.2 is withheld");
    ok(/outside any plausible range/.test(got.ladderWhy), "with the reason");
  });

  await scenario("no nightly counts", { f2: null, f3: null }, (got, world) => {
    const rows = series({ end: SESSION, sigInt: 1230, plan: SPEC.plan });
    const want = oracleCounts(rows, 1230, [1, 2, 3, 4]);
    eq(got.rows.map((r) => r.bold), [1, 2, 3, 4].map((k) => `${want[k].hits} per 252 sessions`), "all four sizes are counted on the card's closes");
    ok(got.rows.every((r) => /counted on this card's closes, report days kept in$/.test(r.n)), "each says so");
  });

  await scenario("a short history on the card", { f2: null, f3: null, closes: series({ end: SESSION, sigInt: 1230, plan: SPEC.plan }).slice(-231) }, (got) => {
    const want = oracleCounts(series({ end: SESSION, sigInt: 1230, plan: SPEC.plan }).slice(-231), 1230, [1, 2, 3, 4]);
    eq(got.rows.map((r) => r.bold), [1, 2, 3, 4].map((k) => `${want[k].hits} per 252 sessions`), "230 returns are scaled to 252 as the nightly scales them");
    ok(got.rows.every((r) => /counted on this card's closes \(230 returns, scaled\), report days kept in$/.test(r.n)), "and each says it was scaled from 230");
  });

  await scenario("no closes on the card", { closes: null }, (got) => {
    eq(got.rows.map((r) => r.bold), [null, "11 per 252 sessions", "5 per 252 sessions", null], "one and four typical days have no count, two and three keep the nightly's");
    ok(/^— This card carries no daily closes/.test(got.rows[0].n) && /^— This card carries no daily closes/.test(got.rows[3].n), "and say why");
    ok(got.rows[0].how === null && got.rows[3].how === null, "with no frequency sentence under a missing count");
    ok(got.rows.every((r) => /^\$[\d,]+\.\d\d$/.test(r.up) && /^\$[\d,]+\.\d\d$/.test(r.down)), "the levels still print");
  });

  await scenario("no nightly counts and no closes", { f2: null, f3: null, closes: null }, (got) => {
    ok(got.rows.every((r) => r.bold === null && /^— /.test(r.n)), "every size is withheld with a reason");
    ok(/No nightly count is published for this name, and this card carries no daily closes/.test(got.rows[1].n), "and two and three say the nightly count is missing too");
  });

  await scenario("a count of zero and a count of one", { f2: 0, f3: 1 }, (got) => {
    eq(got.rows[1].how, "rarer than 1 in 250 sessions for this name over the last year, and fewer than 1 in 80 at 95%", "zero reads rarer than 1 in 250 with the bound");
    eq(got.rows[2].how, "rarer than 1 in 250 sessions for this name over the last year", "one reads rarer than 1 in 250, never 1 in 252");
    eq(got.rows[1].bold, "0 per 252 sessions", "and the zero is printed as a published zero");
  });

  await scenario("no priced move", { pm: null }, (got) => {
    ok(got.impliedBig === null && /^— /.test(got.impliedWhy), "the market's number is withheld with a reason");
    eq(got.rows.length, 4, "the ladder does not depend on it");
  });

  await scenario("a priced move with no quoted implied move", { pm: { status: "ok", spot: 1234.56, impliedMove: 0.05, movePerc: null, asOf: SESSION } }, (got) => {
    ok(got.impliedBig === null && /vendor quoted no implied move/.test(got.impliedWhy), "a modelled band is not passed off as the market's quoted move");
  });

  await scenario("report outside the window", { next: { d: "2026-10-30", when: "premarket", source: "company", confirmed: false, sessions: 22 }, em: 0.05, ed: 22 }, (got) => {
    eq(got.reportState, "outside", "22 sessions away is outside");
    ok(!got.reportTag && got.reportFlag === null, "no event flag");
    eq(got.reportBig, "Oct 30, 22 sessions away, before the open, estimated", "the date and distance still print");
    ok(got.reportCaps.includes("More than 21 sessions away, so it is not flagged here."), "and it says why it is not flagged");
  });

  await scenario("report on the 21st session", { next: { d: "2026-09-23", when: "afterhours", source: "company", confirmed: true, sessions: 21 }, em: null }, (got) => {
    eq(got.reportState, "inside", "21 sessions away is inside");
    ok(got.reportTag && got.reportFlag !== null, "and flagged");
    ok(/^— The card carries no implied report move\.$/.test(got.reportWhy), "an absent report move is withheld with its reason");
  });

  await scenario("no report on the calendar", { next: null, ed: null }, (got) => {
    eq(got.reportState, "unknown", "no date is unknown");
    eq(got.reportWhy, "— No upcoming report on the calendar.", "with the card's reason");
  });

  await scenario("report distance from tonight's universe", { next: null, ed: 6 }, (got) => {
    eq(got.reportState, "inside", "six sessions away from the universe is inside");
    eq(got.reportBig, "6 sessions away, date not on the card", "and prints the distance, with no invented date");
  });

  await scenario("no earnings read at all", { cardX: null, next: null, ed: null }, (got) => {
    eq(got.reportState, "unknown", "an unreadable earnings record is unknown");
    ok(/^— .{10,}/.test(got.reportWhy), "with a reason");
    eq(got.rows.length, 4, "the ladder stands");
  });

  await scenario("a break and a gap in the closes", { breaks: [{ date: series({ end: SESSION, sigInt: 1230, plan: SPEC.plan })[100][0] }], f2: null, f3: null }, (got) => {
    const rows = series({ end: SESSION, sigInt: 1230, plan: SPEC.plan });
    const want = oracleCounts(rows, 1230, [1, 4], [rows[100][0]]);
    eq([got.rows[0].bold, got.rows[3].bold], [`${want[1].hits} per 252 sessions`, `${want[4].hits} per 252 sessions`], "the break is left out of the count");
  });

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const world = worldFor({ queue: [500] });
    await mountWorld(page, world, null);
    await reveal(page);
    let got = await page.evaluate(readPage);
    eq(got.rows.length, 0, "a failed universe read draws no ladder");
    ok(/The nightly universe could not be read, so the typical daily move is not available\./.test(got.ladderWhy), "and says what failed");
    ok(got.retry, "and offers Retry");
    ok(got.impliedBig !== null && got.reportState === "inside", "the other two blocks still stand");
    eq(world.hits, 1, "one read so far");
    await page.locator("#m-movelab button.ft-scene-btn").focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("#m-movelab .ft-ml-row", { timeout: 10000 });
    got = await page.evaluate(readPage);
    eq(world.hits, 2, "Retry from the keyboard reads the universe again");
    eq(expectFull(world, got, 1440), [], "and the ladder then reads right");
    const active = await page.evaluate(() => document.activeElement && (document.activeElement.className || document.activeElement.tagName));
    ok(/ft-ml-in/.test(String(active)), "focus lands on the module rather than on a removed button");
    const again = await page.evaluate(() => { const b = document.querySelector("#m-movelab button.ft-scene-btn"); return !!b; });
    ok(!again, "the Retry button is gone once the read worked");
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const world = worldFor({ queue: [500] });
    await mountWorld(page, world, null);
    await reveal(page);
    const hits = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("#m-movelab button")) {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const miss = [];
        for (const dy of [-20, 0, 20]) for (const dx of [-20, 0, 20]) {
          const hit = document.elementFromPoint(Math.min(Math.max(cx + dx, 1), document.documentElement.clientWidth - 1), cy + dy);
          if (!hit || !(el === hit || el.contains(hit))) miss.push(dx + "," + dy + (hit ? ":" + hit.tagName + "." + hit.className : ":none"));
        }
        out.push({ label: el.getAttribute("aria-label") || el.textContent.trim(), miss, h: r.height });
      }
      return out;
    });
    ok(hits.length >= 4, `the module has ${hits.length} controls to reach`);
    for (const x of hits) eq(x.miss, [], `a 44 px area around "${x.label}" resolves to it on a touch screen`);
    const retry = hits.find((x) => x.label === "Retry");
    ok(retry && retry.h >= 44, "Retry is at least 44 px tall on a touch screen");
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await mountWorld(page, worldFor(), null);
    await reveal(page);
    await page.locator("#m-movelab .ui-mod-t").evaluate((n) => { n.setAttribute("tabindex", "-1"); n.focus(); });
    for (const label of ["About the typical daily move", "About the counts", "About the options market's number", "About the report row"]) {
      await page.keyboard.press("Tab");
      const at = await page.evaluate(() => { const a = document.activeElement; return a && a.closest("#m-movelab") ? a.getAttribute("aria-label") : "outside"; });
      eq(at, label, `Tab reaches "${label}" in reading order`);
      await page.keyboard.press("Enter");
      await page.waitForSelector("#fxPop:popover-open", { timeout: 5000 });
      const pop = await page.evaluate(() => ({ title: document.getElementById("fxPopT").textContent, body: document.getElementById("fxPopB").textContent }));
      ok(pop.title.length > 0 && pop.body.length > 20, `Enter opens an explanation titled "${pop.title}"`);
      ok(!/sigma|\u03c3|standard deviation/i.test(pop.title + pop.body), "which uses no sigma wording");
      await page.keyboard.press("Escape");
      await page.waitForFunction((l) => document.activeElement && document.activeElement.getAttribute("aria-label") === l, label, { timeout: 5000 });
      const back = await page.evaluate(() => ({ closed: !document.getElementById("fxPop").matches(":popover-open"), label: document.activeElement && document.activeElement.getAttribute("aria-label") }));
      ok(back.closed && back.label === label, `Escape closes it and returns focus to "${label}"`);
    }
    await ctx.close();
  }

  const contrastReport = () => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat([1]); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const ground = rgba(getComputedStyle(document.documentElement).getPropertyValue("--ground-base") || "#07090e");
    const bgOf = (el) => {
      const chain = [];
      for (let n = el; n; n = n.parentElement) chain.unshift(n);
      let bg = ground[3] === 1 ? ground : [7, 9, 14, 1];
      for (const n of chain) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) bg = over(c, bg); }
      return bg;
    };
    const rows = [];
    for (const el of document.querySelectorAll("#m-movelab .ft-ml *")) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || el.closest(".visually-hidden")) continue;
      const bg = bgOf(el);
      rows.push({ tag: el.tagName.toLowerCase() + "." + (el.className || ""), text: el.textContent.trim().slice(0, 28), ratio: ratio(over(rgba(cs.color), bg), bg), size: parseFloat(cs.fontSize) });
    }
    return rows;
  };
  for (const [name, options, motion] of [["light scheme", { colorScheme: "light" }, "no-preference"], ["dark scheme", { colorScheme: "dark" }, "reduce"], ["more contrast", { contrast: "more" }, "no-preference"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: motion, ...options });
    const page = await ctx.newPage();
    await mountWorld(page, worldFor(), null);
    await reveal(page);
    const rows = await page.evaluate(contrastReport);
    ok(rows.length >= 40, `${name}: the module has text to measure (${rows.length} nodes)`);
    eq(rows.filter((r) => r.ratio < 4.5).map((r) => `${r.tag} "${r.text}" ${r.ratio.toFixed(2)}`), [], `${name}: every text node is at least 4.5:1 over its composited surface`);
    eq(rows.filter((r) => r.size < 11).map((r) => `${r.tag} ${r.size}px`), [], `${name}: nothing is set below the 11 px floor`);
    if (motion === "reduce") eq(await page.evaluate(() => document.querySelector("#m-movelab .ft-ml").getAnimations({ subtree: true }).filter((a) => a.playState === "running").length), 0, `${name}: reduced motion leaves nothing in the module animating`);
    const tone = await page.evaluate(() => [getComputedStyle(document.querySelector('#m-movelab dd[data-tone="up"]')).color, getComputedStyle(document.querySelector('#m-movelab dd[data-tone="down"]')).color]);
    ok(tone[0] !== tone[1], `${name}: up and down levels are told apart by colour as well as by their labels`);
    await ctx.close();
  }

  const dom = async (serve) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const world = worldFor({ f2: 0, f3: 1 });
    world.serve = { "flows-ticker-movelab.js": serve };
    await mountWorld(page, world, null);
    await reveal(page);
    const got = await page.evaluate(readPage);
    await ctx.close();
    return expectFull(world, got, 1440);
  };
  for (const [from, to, why] of MUTANTS.slice(0, 5)) {
    const bad = await dom(SRC.replace(from, to));
    ok(bad.length > 0, `the page checks fail the planted build "${why}" (${bad.length} findings)`);
  }
} finally {
  await browser.close();
}

console.log(`✓ flows-movelab-render: ${checks} assertions`);
