import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guardAnswer } from "../shared/flows-ask.js";
import { loadCore, CHEAP, RICH, row, NOW } from "./lib/oracle-fixtures.mjs";

const SRC = readFileSync(new URL("../assets/js/flows-oracle-core.js", import.meta.url), "utf8");
const MIN = 60000;
const MINUS = "−";

const NORM = { premiumMedian: 60000, premiumP90: 4000000, sizeMedian: 40, sizeP90: 150, winN: 40 };
const ctxOf = (over = {}) => ({ norm: NORM, sector: null, sectorEtf: null, earnings: null, ...over });
const USUAL = NORM.premiumP90 * 30 / 390;
const BAR = Math.max(3 * USUAL, 500000);

function battery(src) {
  const core = loadCore(src);
  const { live, words, fmt } = core;
  const out = [];
  const check = (cond, msg) => { if (!cond) out.push(msg); };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
  const run = (rows, context, now = NOW, opts = { live: true }, state = live.createState()) => ({ state, msgs: live.detect(state, rows, context, now, opts) });
  const kinds = (r, k) => r.msgs.filter((m) => m.kind === k);
  const six = (t, each, over = {}) => Array.from({ length: 6 }, (_, i) => row(t, 2 + i * 4, { prem: each, k: 60 + i, ...over }));

  eq([fmt.money(1250000), fmt.money(850000), fmt.money(307692), fmt.money(999), fmt.money(-4500), fmt.money(null)], ["$1.3M", "$850K", "$308K", "$999", `${MINUS}$5K`, "—"], "money");
  eq([fmt.cents(68.1), fmt.cents(-0.5), fmt.cents(null)], ["$68.10", `${MINUS}$0.50`, "—"], "cents");
  eq([fmt.signedWhole(41), fmt.signedWhole(-1234.4), fmt.signedWhole(0), fmt.whole(7015)], ["+$41", `${MINUS}$1,234`, "$0", "$7,015"], "whole");
  eq([fmt.expiryText("2026-11-20"), fmt.expiryText("2026-01-05"), fmt.strikeText(65), fmt.strikeText(62.5), fmt.times(3.12), fmt.times(32.5)], ["Nov 20", "Jan 5", "65", "62.5", "3.1×", "33×"], "text");
  eq(fmt.trt(Date.parse("2026-10-14T21:52:00Z")), "00:52 TRT", "trt adds three hours");

  eq(words.callSay(CHEAP), {
    head: "The 65 call for Nov 20 looks cheap.",
    why: "The market prices it at 38.8 vol; the model's fair level is 42.1. That is 3.3 vol points under, worth about $42 a contract.",
    gain: "Held to expiry the model puts the average result at +$41 a contract, with a 46% chance of a profit. Break-even is $68.10.",
  }, "cheap words");
  eq(words.callSay(RICH).gain, "Selling it collects about $4.85. The model puts the average result at +$28 a contract. It puts the chance of keeping the credit at 71%. A loss is capped at $7,015.", "rich words");
  eq(words.callSay({ ...RICH, maxLoss: null }).gain.endsWith("A loss can grow past what the position collects."), true, "unbounded loss is said");
  eq(words.callSay({ ...CHEAP, ev: null, pop: null, breakeven: null }).gain, "Held to expiry the model puts the average result at — a contract, with — chance of a profit. Break-even is —.", "null is a dash, never a zero");
  eq(words.callSay({ ...CHEAP, marketIv: null }).why.startsWith("The market prices it at \u2014 vol; the model's fair level is 42.1. That is \u2014 vol points under"), true, "a missing vol is a dash");
  eq(words.callSay({ ...CHEAP, verdict: "sideways" }), null, "an unknown verdict says nothing");

  const banned = /\b(will|would|should|could|expect|expects|likely|going to|predict|recommend|advise|guaranteed|buy|sell)\b/i;
  const texts = [words.MODEL_IMPLIED, ...Object.values(words.STANCE_LINES).flat()];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 400; i++) {
    const c = { ...(rnd() < 0.5 ? CHEAP : RICH), strike: Math.round(rnd() * 400) / 2, marketIv: 0.1 + rnd(), fairIv: 0.1 + rnd(), edgeUsd: (rnd() - 0.5) * 400, ev: (rnd() - 0.5) * 2000, pop: rnd(), mid: rnd() * 30, breakeven: rnd() * 300, maxLoss: rnd() < 0.3 ? null : rnd() * 9000 };
    const s = words.callSay(c);
    texts.push(s.head, s.why, s.gain);
  }
  const msgs = [];
  for (const k of ["surge", "repeat", "flip", "cluster", "sweeps", "size", "sector"]) {
    msgs.push(words.liveSay({ kind: k, ticker: "SYO001", prem: 960000, usual: 307692, k: 3.1, minutes: 30, strike: 65, side: "call", expiry: "2026-11-20", n: 4, l: 0.5, earlier: -0.5, now: "bullish", before: "bearish", share: 0.8, size: 900, sector: "Technology", names: ["SYO001", "SYO002"], event: true, sessions: 3 }));
  }
  texts.push(...msgs);
  for (const t of texts) {
    check(!banned.test(t), `banned word in: ${t}`);
    check(guardAnswer(t, [{ say: t }], { smallIntegers: false, modals: true }).forecast === false, `ask guard finds a forecast word in: ${t}`);
    for (const sentence of t.split(/(?<=[.!?])\s+/)) check(sentence.split(/\s+/).length <= 24, `sentence too long: ${sentence}`);
    check(!/\b(at ask|at bid|NOW|unusual|alert|screen|rare)\b/i.test(t), `lint word in: ${t}`);
  }
  check(words.liveSay({ kind: "flip", ticker: "A", l: 0.5, earlier: -0.5, now: "bullish", before: "bearish", minutes: 30 }).includes("by the site's convention. Calls on the ask side and puts on the bid side are read as bullish, the reverse as bearish."), "the flip repeats the convention");
  eq(words.CONVICTION_WORDS, ["No view", "Faint", "Leaning", "Clear"], "conviction words");
  eq(Object.keys(words.STANCE_LINES).sort(), ["down", "mixed", "none", "up"], "stance lean keys");
  check(Object.values(words.STANCE_LINES).every((a) => a.length === 4), "sixteen stance lines");

  const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" });
  let bad = 0, openCount = 0;
  for (let t = Date.parse("2026-02-20T00:00:00Z"); t < Date.parse("2026-11-20T00:00:00Z"); t += 15 * MIN) {
    const p = Object.fromEntries(ET.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const mins = (+p.hour % 24) * 60 + +p.minute;
    const open = !["Sat", "Sun"].includes(p.weekday) && mins >= 570 && mins < 960;
    const s = live.sessionOf(t);
    if (s.open !== open || (open && s.minutes !== mins - 570)) bad++;
    if (open) openCount++;
  }
  check(bad === 0 && openCount > 3000, `the Eastern session arithmetic equals the zone at every quarter hour (${bad} wrong)`);

  const surge = run(six("SYO001", 160000), ctxOf());
  eq(kinds(surge, "surge").length, 1, "surge fires at 960K");
  const sm = kinds(surge, "surge")[0];
  eq(sm && sm.say, `SYO001 has ${fmt.money(960000)} of flagged options flow across 6 windows in the last 30 minutes. The bar for this name is ${fmt.money(BAR)}.`, "surge words say what was measured: the sum, the windows and the bar, with no pace and no multiple");
  check(!/pace|usual|typical|\bx\b|\u00D7/.test(sm.say), "and the surge carries no multiple of a usual pace, which the ledger (a single window's p90) cannot support");
  eq(sm.facts.map((f) => f.label), ["Flagged premium, 30 min", "Bar for this name"], "and its two facts are the sum and the bar");
  eq(sm && sm.strength, 1, "surge strength 1");
  eq(kinds(run(six("SYO001", 153000), ctxOf()), "surge").length, 0, "surge silent below the bar");
  eq(kinds(run(six("SYO001", 225000), ctxOf({ norm: { ...NORM, premiumP90: 5850000 } })), "surge").length, 1, "surge fires exactly at the bar");
  eq(kinds(run(six("SYO001", 70000), ctxOf({ norm: { ...NORM, premiumP90: 1000000 } })), "surge").length, 0, "the 500K floor holds a small name");
  eq(kinds(run(six("SYO001", 83334), ctxOf({ norm: { ...NORM, premiumP90: 1000000 } })), "surge").length, 1, "and is met at 500K");
  eq(kinds(run(six("SYO001", 224999), ctxOf({ norm: { ...NORM, premiumP90: 5850000 } })), "surge").length, 0, "and not a dollar under it");
  eq(kinds(run(six("SYO001", Math.ceil(2 * BAR / 6)), ctxOf()), "surge")[0].strength, 2, "surge strength 2 at twice the bar");
  eq(kinds(run(six("SYO001", Math.ceil(3 * BAR / 6)), ctxOf()), "surge")[0].strength, 3, "surge strength 3 at three times the bar");
  eq(kinds(run(six("SYO001", 160000).slice(0, 2).concat(six("SYO001", 1000).slice(2)), ctxOf()), "surge").length, 0, "surge needs the premium, not the count");
  const ev = ctxOf({ earnings: { sessions: 3, inWindow: true } });
  eq(kinds(run(six("SYO001", Math.ceil(BAR * 1.2 / 6)), ev), "surge").length, 0, "an event multiplies the bar by 1.5");
  const evm = kinds(run(six("SYO001", Math.ceil(BAR * 1.5 / 6)), ev), "surge")[0];
  check(evm && evm.say.endsWith(" A report is 3 sessions away."), "the event is named in the text");

  eq(run(six("SYO001", 160000), ctxOf({ norm: { ...NORM, winN: 19 } })).msgs.length, 0, "a thin norm is silent");
  eq(run(six("SYO001", 160000), ctxOf({ norm: null })).msgs.length, 0, "no norm is silent");
  eq(run(six("SYO001", 160000), null).msgs.length, 0, "no context is silent");
  eq(run(six("SYO001", 160000), { SYO001: ctxOf() }).msgs.length >= 1, true, "a context map is read by ticker");
  eq(run(six("SYO001", 160000).slice(0, 4), ctxOf()).msgs.length, 0, "fewer than five windows seen is silent");

  const shifted = (now) => Array.from({ length: 6 }, (_, i) => ({ ...row("SYO001", 0, { prem: 160000, k: 60 + i }), spanStart: new Date(now - (2 + i * 4) * MIN).toISOString() }));
  eq(run(shifted(Date.parse("2026-10-14T13:49:00Z")), ctxOf(), Date.parse("2026-10-14T13:49:00Z")).msgs.length, 0, "silent 19 minutes into the session");
  eq(run(shifted(Date.parse("2026-10-14T13:50:00Z")), ctxOf(), Date.parse("2026-10-14T13:50:00Z")).msgs.length >= 1, true, "speaks at 20 minutes");
  eq(run(shifted(Date.parse("2026-10-14T21:00:00Z")), ctxOf(), Date.parse("2026-10-14T21:00:00Z")).msgs.length, 0, "silent after the close");
  eq(run(shifted(Date.parse("2026-10-17T15:30:00Z")), ctxOf(), Date.parse("2026-10-17T15:30:00Z")).msgs.length, 0, "silent on a weekend");
  eq(run(six("SYO001", 160000), ctxOf(), NOW, { live: false }).msgs.length, 0, "a stale feed fires nothing");
  const kept = run(six("SYO001", 160000), ctxOf(), NOW, { live: false });
  eq(live.detect(kept.state, [], ctxOf(), NOW, { live: true }).length >= 1, true, "rows read while stale still count once the feed is live");
  eq(run(six("SYO001", 160000), ctxOf(), NOW, { live: true, refuses: (t) => t === "SYO001" }).msgs.length, 0, "a refused name is skipped");

  const dup = live.createState();
  const rows = six("SYO001", 160000);
  live.detect(dup, rows, ctxOf(), NOW, { live: false });
  live.detect(dup, rows, ctxOf(), NOW, { live: false });
  eq(dup.byName.get("SYO001").length, 6, "a window with a known id is counted once");

  const rep = (each, n = 3) => [...Array.from({ length: n }, (_, i) => row("SYO001", 3 + i * 4, { prem: each })), row("SYO001", 14, { prem: 10000, k: 90 }), row("SYO001", 16, { prem: 10000, k: 91 }), row("SYO001", 18, { prem: 10000, k: 92 })];
  eq(kinds(run(rep(90000), ctxOf()), "repeat").length, 1, "repeat fires at 270K");
  eq(kinds(run(rep(90000), ctxOf()), "repeat")[0].say, "Flow keeps returning to the 65 call for Nov 20: 3 flagged windows in 20 minutes, $270K in all.", "repeat words");
  eq(kinds(run(rep(83000), ctxOf()), "repeat").length, 0, "repeat silent at 249K");
  eq(kinds(run(rep(130000, 2), ctxOf()), "repeat").length, 0, "repeat needs three prints");

  const lean = (mins, ask, bid, prem, cp = "C") => mins.map((m) => row("SYO001", m, { prem, askPrem: ask, bidPrem: bid, cp, k: 60 + m }));
  const flipRows = [...lean([80, 60, 40], 20000, 180000, 200000), ...lean([4, 14, 24], 150000, 10000, 160000)];
  const fl = kinds(run(flipRows, ctxOf()), "flip");
  eq(fl.length, 1, "flip fires");
  eq(fl[0] && fl[0].say, `SYO001 flow has turned bullish in the last 30 minutes, by the site's convention. Calls on the ask side and puts on the bid side are read as bullish, the reverse as bearish. The lean is +88 of 100, after leaning bearish earlier (${MINUS}80).`, "flip words");
  eq(fl[0] && fl[0].strength, 3, "flip strength");
  eq(kinds(run([...lean([80, 60, 40], 180000, 20000, 200000), ...lean([4, 14, 24], 150000, 10000, 160000)], ctxOf()), "flip").length, 0, "flip needs the earlier lean to differ in sign");
  eq(kinds(run([...lean([60, 40], 20000, 180000, 200000), ...lean([4, 14, 24], 150000, 10000, 160000)], ctxOf()), "flip").length, 0, "flip needs forty-five minutes of earlier flow");
  eq(kinds(run([...lean([80, 60, 40], 20000, 180000, 200000), ...lean([4, 14, 24], 120000, 5000, 130000)], ctxOf()), "flip").length, 0, "flip needs 400K sided");
  eq(kinds(run([...lean([80, 60, 40], 20000, 180000, 200000), ...lean([4, 14, 24], 200000, 10000, 1200000)], ctxOf()), "flip").length, 0, "flip is silent when sided premium covers under half");
  eq(kinds(run([...lean([80, 60, 40], 20000, 180000, 200000), ...lean([4, 14, 24], 100000, 70000, 160000)], ctxOf()), "flip").length, 0, "flip needs a lean of 0.4");
  const putFlip = kinds(run([...lean([80, 60, 40], 180000, 20000, 200000, "P"), ...lean([4, 14, 24], 20000, 150000, 160000, "P")], ctxOf()), "flip")[0];
  eq(putFlip && putFlip.say.includes("turned bullish"), true, "puts at the bid are bullish");

  const clu = (b) => [row("SYO001", 5, { prem: 50000, exp: "2026-10-16", k: 80 }), row("SYO001", 9, { prem: 50000, exp: "2026-10-16", k: 81 }), row("SYO001", 7, { prem: b / 2, exp: "2026-11-20", k: 82 }), row("SYO001", 12, { prem: b / 2, exp: "2026-11-20", k: 83 }), row("SYO001", 50, { prem: 1000, exp: "2026-11-20", k: 84 })];
  eq(kinds(run(clu(320000), ctxOf()), "cluster")[0] && kinds(run(clu(320000), ctxOf()), "cluster")[0].say, "Most of SYO001's flow is landing in the Nov 20 expiry: 76% of $320K.", "cluster words");
  eq(kinds(run(clu(299000), ctxOf()), "cluster").length, 0, "cluster silent below 300K");
  eq(kinds(run(clu(120000), ctxOf()), "cluster").length, 0, "cluster silent below a 60 per cent share");

  const sw = (n, ask, bid) => [...Array.from({ length: n }, (_, i) => row("SYO001", 1 + i * 2, { prem: 100000, askPrem: ask, bidPrem: bid, sweep: true, k: 60 + i })), ...Array.from({ length: 5 - Math.min(n, 5) }, (_, i) => row("SYO001", 40 + i, { prem: 1000, k: 90 + i }))];
  eq(kinds(run(sw(5, 70000, 30000), ctxOf()), "sweeps")[0] && kinds(run(sw(5, 70000, 30000), ctxOf()), "sweeps")[0].say, "SYO001 has 5 fast, multi-exchange windows in 10 minutes, mostly on the ask side. $500K.", "sweep words");
  eq(kinds(run(sw(3, 70000, 30000), ctxOf()), "sweeps").length, 0, "sweeps need four");
  eq(kinds(run(sw(5, 64400, 35600), ctxOf()), "sweeps").length, 0, "sweeps need 65 per cent as printed");
  eq(kinds(run(sw(5, 64600, 35400), ctxOf()), "sweeps").length, 1, "64.6 prints as 65 and passes");
  eq(kinds(run(sw(5, 100000, 0).map((r) => ({ ...r, prem: 50000 })), ctxOf()), "sweeps").length, 0, "sweeps need 300K");
  eq(kinds(run(sw(5, 7000, 3000), ctxOf()), "sweeps").length, 0, "a sweep burst with 10 per cent of its premium sided is not 'mostly on the ask side'");
  eq(kinds(run(sw(5, 33000, 16000), ctxOf()), "sweeps").length, 0, "nor at 49 per cent sided");
  eq(kinds(run(sw(5, 35000, 15000), ctxOf()), "sweeps").length, 1, "but a half-sided burst with 70 per cent of it on the ask is");
  eq(kinds(run(sw(5, 33000, 22000), ctxOf()), "sweeps").length, 0, "a 55 per cent sided burst with 60 per cent of that on the ask names no side: both halves of the rule are needed");

  const big = (size, prem) => [row("SYO001", 6, { prem, size, k: 65 }), ...Array.from({ length: 4 }, (_, i) => row("SYO001", 20 + i, { prem: 10000, size: 10, k: 70 + i }))];
  eq(kinds(run(big(750, 250000), ctxOf()), "size")[0] && kinds(run(big(750, 250000), ctxOf()), "size")[0].say, "SYO001 has one window of 750 contracts in the 65 call for Nov 20, $250K. That is 5.0× the name's usual large window.", "size words");
  for (const kind of ["repeat", "sweeps", "size", "surge"]) {
    const sayings = kinds(run(kind === "repeat" ? rep(90000) : kind === "sweeps" ? sw(5, 70000, 30000) : kind === "size" ? big(750, 250000) : six("SYO001", 160000), ctxOf()), kind).map((m) => m.say + " " + m.facts.map((f) => f.label).join(" "));
    check(sayings.length >= 1 && sayings.every((t) => !/\b(someone|prints?|trader|buyer|seller|whale|bought|sold|traded)\b/i.test(t)), kind + " names a window, not a print, an actor or a trade: " + sayings.join(" | "));
  }
  eq(kinds(run(big(749, 250000), ctxOf()), "size").length, 0, "size silent below 5 times p90");
  eq(kinds(run(big(750, 249999), ctxOf()), "size").length, 0, "size silent below 250K");
  eq(kinds(run(big(499, 250000), ctxOf({ norm: { ...NORM, sizeP90: 50 } })), "size").length, 0, "size has a floor of 500 contracts");

  const sector = (n, each) => {
    const names = Array.from({ length: n }, (_, i) => `SYO00${i + 1}`);
    const context = Object.fromEntries(names.map((t) => [t, ctxOf({ sector: "Technology", sectorEtf: "XLK" })]));
    return { rows: names.flatMap((t) => six(t, each / 6)), context };
  };
  let sc = sector(4, 1300000);
  const sec = kinds(run(sc.rows, sc.context), "sector");
  eq(sec.length, 1, "sector fires once");
  eq(sec[0] && sec[0].say, "4 names in Technology are all seeing heavy options flow together: SYO001, SYO002, SYO003.", "sector words");
  eq(sec[0] && sec[0].etf, "XLK", "sector carries its fund");
  sc = sector(3, 1700000);
  eq(kinds(run(sc.rows, sc.context), "sector").length, 0, "sector needs four names");
  sc = sector(4, 1200000);
  eq(kinds(run(sc.rows, sc.context), "sector").length, 0, "sector needs 5M");
  const dupe = sector(4, 1300000);
  dupe.rows = dupe.rows.concat(dupe.rows.map((r) => ({ ...r, id: r.id + "x" })).filter((r) => r.t === "SYO001"));
  eq(kinds(run(dupe.rows, dupe.context), "sector").length, 1, "a name counted twice does not make a fifth");
  sc = sector(3, 1700000);
  sc.rows = sc.rows.concat(six("SYO001", 300000).map((r) => ({ ...r, id: r.id + "y" })));
  eq(kinds(run(sc.rows, sc.context), "sector").length, 0, "one name twice is still three names");

  const crowd = Array.from({ length: 8 }, (_, i) => `SYO0${10 + i}`);
  const cr = run(crowd.flatMap((t) => six(t, 200000)), Object.fromEntries(crowd.map((t) => [t, ctxOf()])));
  eq(cr.msgs.length, 6, "six messages at most in thirty minutes");
  eq(cr.state.quiet, 2, "the rest are counted");

  const first = run(six("SYO001", 160000), ctxOf());
  eq(first.msgs.length >= 1, true, "first firing");
  const again = live.detect(first.state, [], ctxOf(), NOW + 5 * MIN, { live: true });
  eq(again.filter((m) => m.kind === "surge").length, 0, "no repeat inside the cooldown at the same strength");
  const richer = live.detect(first.state, six("SYO001", 400000).map((r) => ({ ...r, id: r.id + "z", spanStart: new Date(NOW + 5 * MIN - 3 * MIN).toISOString() })), ctxOf(), NOW + 5 * MIN, { live: true });
  eq(richer.filter((m) => m.kind === "surge").length, 1, "a higher strength speaks inside the cooldown");
  const later = live.detect(first.state, six("SYO001", 160000).map((r) => ({ ...r, id: r.id + "w", spanStart: new Date(NOW + 40 * MIN - 3 * MIN).toISOString() })), ctxOf(), NOW + 40 * MIN, { live: true });
  eq(later.filter((m) => m.kind === "surge").length, 1, "and again after the cooldown");
  eq(first.msgs[0].id, `SYO001:${first.msgs[0].kind}:${Math.floor(NOW / (30 * MIN))}`, "message ids carry the bucket");
  return out;
}

const good = battery(SRC);
assert.deepEqual(good, [], "the shipped core passes its own battery:\n" + good.join("\n"));
let checks = 1;

const MUTANTS = [
  ["no warm-up", (s) => s.replace("sess.minutes < T.warmMin", "false")],
  ["no cooldown", (s) => s.replace("now - prior.at < T.cooldownMin * MIN && c.strength <= prior.strength", "false")],
  ["no global cap", (s) => s.replace("state.fired.length >= T.cap", "false")],
  ["norm optional", (s) => s.replace("if (!norm) continue;", "if (!norm) norm = {};")],
  ["thin norm accepted", (s) => s.replace("ctx.norm.winN >= 20", "ctx.norm.winN >= 0")],
  ["stale feed fires", (s) => s.replace("o.live !== true", "false")],
  ["closed session fires", (s) => s.replace("if (!sess.open || sess.minutes < T.warmMin) return out;", "if (sess.minutes !== null && sess.minutes < T.warmMin) return out;")],
  ["surge strict", (s) => s.replace("if (P >= bar)", "if (P > bar)")],
  ["surge floor gone", (s) => s.replace("Math.max(T.surgeMult * usual, T.surgeFloor)", "T.surgeMult * usual")],
  ["event multiplier gone", (s) => s.replace("var mult = ev ? T.eventMult : 1;", "var mult = 1;")],
  ["repeat needs two", (s) => s.replace("repeatN: 3", "repeatN: 2")],
  ["flip same lean allowed", (s) => s.replace("Math.sign(el.l) !== Math.sign(recentLean.l)", "true")],
  ["flip coverage ignored", (s) => s.replace("recentLean.coverage >= T.coverage &&", "")],
  ["flip earlier span ignored", (s) => s.replace("spanMin >= T.flipEarlierMin &&", "")],
  ["flip lean sign swapped", (s) => s.replace("(ca + pb - cb - pa) / sided", "(cb + pa - ca - pb) / sided")],
  ["cluster counts the nearest expiry", (s) => s.replace("e !== todayExp &&", "")],
  ["sweep share floor", (s) => s.replace("sweepAsk: 65", "sweepAsk: 50")],
  ["sweep coverage ignored", (s) => s.replace("Math.round(100 * (ask + bid) / P3) >= 50 && ", "")],
  ["sweep share truncated", (s) => s.replace("Math.round(100 * ask / (ask + bid)) >= T.sweepAsk", "Math.floor(100 * ask / (ask + bid)) >= T.sweepAsk")],
  ["size floor gone", (s) => s.replace("Math.max(T.sizeMult * sp90, T.sizeFloor)", "T.sizeMult * sp90")],
  ["sector counts rows", (s) => s.replace("bySector.get(s.sector).set(s.t, s);", "bySector.get(s.sector).set(s.t + Math.random(), s);")],
  ["sector floor gone", (s) => s.replace("P >= T.sectorFloor", "true")],
  ["no dedupe by id", (s) => s.replace("if (state.seen.has(key)) continue;", "")],
  ["fixture names allowed", (s) => s.replace("if (refuse(r.t)) continue;", "")],
  ["minus sign dropped", (s) => s.replace('var NEG = Object.freeze({ "-1": MINUS,', 'var NEG = Object.freeze({ "-1": "",')],
  ["null read as zero", (s) => s.replace('return x === null ? DASH : (x * 100).toFixed(1);', 'return (x || 0) === 0 ? "0.0" : (x * 100).toFixed(1);')],
  ["eastern offset fixed", (s) => s.replace("return ms >= start && ms < end ? -4 : -5;", "return -5;")],
  ["surge claims a pace", (s) => s.replace('" has " + money(m.prem) + " of flagged options flow across " + m.n + " windows in the last " + m.minutes +\n        " minutes. The bar for this name is " + money(m.bar) + "."', '" options flow is running " + times(m.prem / m.bar) + " its usual pace: " + money(m.prem) + " in the last " + m.minutes + " minutes."')],
  ["a repeat names someone", (s) => s.replace('"Flow keeps returning to the "', '"Someone keeps coming back to the "')],
  ["a window called a print", (s) => s.replace('" flagged windows in "', '" prints in "')],
  ["a window called one print", (s) => s.replace('m.ticker + " has one window of "', '"One print on " + m.ticker + ": "')],
  ["advice word in a stance line", (s) => s.replace("Leaning up. Options pricing", "Leaning up. You should expect options pricing")],
  ["convention dropped from the flip", (s) => s.replace('" minutes, " + CONVENTION + ". " + CONVENTION_NOTE + " The lean is "', '" minutes. The lean is "')],
];

let killed = 0;
for (const [name, mutate] of MUTANTS) {
  const mutated = mutate(SRC);
  assert.notEqual(mutated, SRC, `mutant "${name}" did not change the source`);
  let fails;
  try { fails = battery(mutated); } catch (e) { fails = [String(e)]; }
  assert.ok(fails.length > 0, `planted wrong build "${name}" passed the battery`);
  killed++;
  checks++;
}

for (const f of ["worker.js", "shared/flows-pages.js", "server/routes/flows-pages.js", "server/routes/flows-oracle.js", "scripts/flows-nightly/sections/oracle.mjs", "scripts/flows-legs/oracle.mjs", "assets/js/flows-oracle.js", "assets/js/flows-oracle-boot.js", "assets/js/flows-oracle-core.js"]) {
  assert.ok(!/flows-oracle-live/.test(readFileSync(new URL("../" + f, import.meta.url), "utf8")), f + " references the reference leaf or its bundle, which the pages do not load and which differs from the served core");
  checks++;
}

const forbidden = [/\?\s*"[+]"\s*:/, /\?\s*MINUS\s*:/, /\bcolor:\s*#/i, /rgba?\(/];
for (const re of forbidden) assert.ok(!re.test(SRC), `the core has no two-arm sign pick or colour literal: ${re}`);
checks += forbidden.length;

console.log(`flows-oracle-core: ${checks} checks, ${killed} planted wrong builds killed`);
