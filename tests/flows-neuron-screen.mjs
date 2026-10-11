import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screenReading, screenTexts, SCREEN_INPUTS, SCREEN_LINES, SCREEN_LIMITS, SCREEN_WHY } from "../shared/flows-neuron-screen.js";
import { regimeState, STATE_STRUCTURES, STATE_LINES } from "../shared/flows-neuron.js";
import { guardAnswer } from "../shared/flows-ask.js";
import { buildUniverse, universeValue, decodeColumn } from "../shared/flows-cross.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b})`); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SESSION = "2026-09-15";
const BASE = Object.freeze({
  px: 100, iv30: 0.3, ivp: 50, ts: 0, vrp: 0, rv20: 0.3, gexAdv: 0.03, dex: 2, vanna: 0.004, charm: -3, im5: 0.03, im30: 0.08,
  ed: null, tilt: 0.05, dDelta: 0, si: 0.03,
});
const read = (over = {}, extra = {}) => screenReading({
  ticker: "SYN", u: { ...BASE, ...over }, pct: { gexAdv: 70, si: 40 }, sector: "Energy", sessionDate: SESSION, expectedSession: SESSION, ...extra,
});
const factOf = (r, key) => r.facts.find((f) => f.key === key);

{
  const s252 = Math.sqrt(252);
  near(s252, 15.874507866, 1e-8, "the square root of 252 sessions, worked by hand");
  const r = read({ gexAdv: 0.0222, iv30: 0.339 }, {});
  const daily = 0.339 / 15.874507866 * 100;
  near(factOf(r, "hedge").value, 0.0222 * daily * 100, 2e-3,
    "HEDGING FOR A TYPICAL DAY: 0.0222 of average daily dollar volume per 1% move, times the implied daily move 0.339 / sqrt(252) = 2.1355%, is 4.74% of a day's dollar volume");
  eq(factOf(r, "hedge").text, "4.7%", "printed to one decimal");
  eq(factOf(r, "gamma").text, "+2.22%", "and the gamma itself as the vendor's fraction times 100, signed");
  eq(r.gamma, "long", "a positive vendor gamma is long: dealers hold the book long on the vendor's convention");
  eq(read({ gexAdv: -0.0222 }).gamma, "short", "and a negative one is short");
  eq(factOf(read({ gexAdv: -0.0222 }), "gamma").text, "−2.22%", "signed with U+2212, never a hyphen");
  const move = 0.3 / 15.874507866 * 100;
  eq(read({ gexAdv: 0.0099 / move * 0.999 }).gamma, "flat", "a book whose hedging for one implied daily move is under 1% of a day's dollar volume is flat");
  eq(read({ gexAdv: 0.0101 / move }).gamma, "long", "and just over the 1% line it is read");
  eq(read({ gexAdv: -0.0101 / move }).gamma, "short", "on either sign");
  eq(read({ gexAdv: 0 }).gamma, "flat", "an exactly zero book is flat, not long");
  eq(read({ iv30: null }).gamma, null, "with no implied volatility to size a day's hedging the sign is not read");
  ok(read({ iv30: null }).withheld.some((w) => w.key === "gexAdv" && /no implied volatility/.test(w.reason)), "and the reason is named");
  eq(read({ gexAdv: 0.03 }).state, "pinned", "long gamma is the pinned state");
  eq(read({ gexAdv: -0.03 }).state, "amplifying", "short gamma is the amplifying state");
  eq(read({ gexAdv: 0.03 }).confidence, 1, "a read state carries confidence one and never more");
}

{
  const d = factOf(read({ dex: 3.3 }), "dex");
  eq(d.text, "+3.30", "dealer delta prints as a multiple of average daily dollar volume, signed");
  ok(d.grade === 1 && /no direction is read/.test(d.note), "graded weak, and its note says no direction is read from it");
  ok(/positive by construction/.test(d.note) && /documents no sign convention/.test(d.note), "and says why: the vendor documents no sign for this field");
  eq(read({ dex: -1.5 }).state, read({ dex: 6 }).state, "the sign and size of dealer delta never move the state");
  same(read({ dex: -1.5 }).families, read({ dex: 6 }).families, "or the families");
  const v = factOf(read({ vanna: 0.0065 }), "vanna");
  eq(v.text, "+0.65%", "vanna prints as a percent of average daily dollar volume, signed");
  eq(factOf(read({ vanna: -0.0065 }), "vanna").text, "−0.65%", "with the minus sign kept");
  ok(v.grade <= 1 && /not read/.test(v.note) && /no sign convention/.test(v.note), "graded weak, with the unverified put-leg sign said and nothing read from it");
  eq(read({ vanna: 0.02 }).state, read({ vanna: -0.02 }).state, "vanna never moves the state");
  const c = factOf(read({ charm: -6.4 }), "charm");
  eq(c.grade, 0, "charm is graded zero: shown, not read");
  eq(c.text, "negative", "and prints its sign only");
  ok(!/\d/.test(c.display), "no magnitude of a figure whose unit is undocumented is printed: " + c.display);
  eq(factOf(read({ charm: 12 }), "charm").text, "positive", "a positive vendor charm reads positive");
  eq(read({ charm: 12 }).state, read({ charm: -12 }).state, "and never moves the state");
  same(read({ charm: 12 }).families, read({ charm: -12 }).families, "or the families");
}

{
  const rel = (iv, rv) => ({ iv30: iv, rv20: rv, vrp: iv - rv });
  eq(read(rel(0.332, 0.30)).premium, "rich", "implied 10.7% over realised is rich: (0.332 - 0.300) / 0.300 = +0.1067 against the +0.10 line");
  eq(read(rel(0.334, 0.30)).premium, "rich", "and 11.3% is rich");
  eq(read(rel(0.328, 0.30)).premium, "fair", "9.3% is fair");
  eq(read(rel(0.268, 0.30)).premium, "cheap", "implied 10.7% under realised is cheap");
  eq(read(rel(0.272, 0.30)).premium, "fair", "9.3% under is fair");
  near(factOf(read(rel(0.33, 0.30)), "premium").value, 10, 1e-3, "the premium prints as a percent of realised volatility");
  eq(read({ iv30: 0.334, vrp: 0.034, rv20: null }).premium, "rich", "with no realised column it is implied less the premium: 0.334 - 0.034 = 0.300, so +11.3% of realised");
  eq(read({ vrp: null }).premium, null, "no premium column, no premium reading");
  eq(read({ rv20: 0, vrp: 0.1, iv30: 0.1 }).premium, null, "and no positive realised volatility to divide by, no reading");
  eq(read({ ...rel(0.36, 0.30), gexAdv: null }).state, "premium-rich", "rich premium with no gamma is the premium-rich state");
  eq(read({ ...rel(0.24, 0.30), gexAdv: null }).state, "premium-cheap", "cheap premium with no gamma is the premium-cheap state");
  eq(read({ gexAdv: null }).state, "undetermined", "fair premium and no gamma is undetermined");
  const ivpLow = read({ ...rel(0.36, 0.30), ivp: 20 });
  ok(ivpLow.conflicts.length === 1 && ivpLow.idea.kind === "none" && /disagree/.test(ivpLow.noIdeaReason),
    "rich to realised volatility at the 20th percentile of its own year is a conflict, and the idea is No position with the reason");
  ok(ivpLow.confidence === 0 && ivpLow.families.length === 0, "with no family named");
  ok(read({ ...rel(0.36, 0.30), ivp: 26 }).conflicts.length === 0, "the 26th percentile is over the 25th-percentile line");
  ok(read({ ...rel(0.24, 0.30), ivp: 80 }).conflicts.length === 1, "cheap to realised at the 80th percentile is the mirror conflict");
  ok(read({ ...rel(0.24, 0.30), ivp: 74 }).conflicts.length === 0, "and 74 is under the 75th-percentile line");
  const ivpFact = factOf(read({ ivp: 37 }), "ivp");
  eq(ivpFact.label, "Vendor 1-year IV percentile (tenor not documented)", "the percentile's label says it is the vendor's and that its tenor is not documented");
  ok(/tenor no document held for it states/.test(ivpFact.unit) && ivpFact.display.endsWith(ivpFact.unit), "its unit says the same and is printed with the figure");
  ok(/not read as the 30-day figure/.test(ivpFact.note) && !/past year of 30-day/.test(ivpFact.unit + ivpFact.note), "and its note no longer claims the percentile ranks 30-day implied volatility");
  eq(ivpFact.text, "37th", "the figure prints as before");
  ok(ivpFact.grade === 1, "and stays graded weak");
  eq(read({ ivp: null }).withheld.find((w) => w.key === "ivp").label, "Vendor 1-year IV percentile (tenor not documented)", "a withheld percentile carries the same label");
  eq(read({ ts: 0.05 }).facts.find((f) => f.key === "term").note.includes("front is bid"), true, "a 30-day over 90-day slope over +3% says the front is bid");
  eq(read({ ts: -0.05 }).facts.find((f) => f.key === "term").note.includes("back is bid"), true, "and under -3% the back is bid");
}

{
  eq(read({ ed: 21 }).idea.kind, "none", "AN EARNINGS REPORT INSIDE THE 21 SESSIONS a 30-day implied volatility spans names no family");
  ok(/earnings report 21 sessions away/.test(read({ ed: 21 }).noIdeaReason), "and says so");
  eq(read({ ed: 22 }).idea.kind, "family", "a report 22 sessions away does not");
  eq(read({ ed: 0 }).idea.kind, "none", "a report tonight after the close is inside it");
  const r = read({ ed: 5, iv30: 0.36, rv20: 0.3, vrp: 0.06 });
  eq(r.premium, null, "and the premium is not read as rich or cheap when the report sits inside the implied volatility");
  eq(factOf(r, "premium").grade, 0, "the fact is still shown, graded zero");
  eq(factOf(read({ ed: 1 }), "event").unit, "session away", "one session is singular");
  eq(read({ ed: 5 }).state, "pinned", "the state is still read; the event only silences the idea");
  eq(SCREEN_LINES.EVENT_WINDOW_SESSIONS, Math.round(30 * 252 / 365), "21 is the trading days in 30 calendar days: 30 x 252 / 365 = 20.7");
}

{
  const tiltOnly = (t, d) => read({ gexAdv: -0.03, tilt: t, dDelta: d });
  eq(tiltOnly(0.3, 0.01).lean, "bullish", "a tilt over +25% with buying delta flow leans bullish");
  eq(tiltOnly(-0.3, -0.01).lean, "bearish", "and the mirror leans bearish");
  eq(tiltOnly(0.3, -0.01).lean, null, "a tilt the delta flow contradicts casts no vote");
  ok(tiltOnly(0.3, -0.01).notes.some((n) => /opposite ways/.test(n)), "and the disagreement is named");
  eq(tiltOnly(0.24, 0.01).lean, null, "a tilt under the 25% line is not decisive");
  eq(tiltOnly(0.25, 0.01).lean, "bullish", "and exactly at it is");
  eq(tiltOnly(0.3, null).lean, "bullish", "a decisive tilt with no delta reading still leans");
  eq(tiltOnly(0.3, 0).lean, "bullish", "and a zero delta flow does not veto it");
  same(tiltOnly(0.3, 0.01).families, STATE_STRUCTURES.bull.fair.preferred, "short gamma leaning bullish takes the bull row of the consolidated table");
  same(tiltOnly(-0.3, -0.01).families, STATE_STRUCTURES.bear.fair.preferred, "leaning bearish takes the bear row");
  eq(tiltOnly(0.05, 0).idea.kind, "family", "short gamma with an undecided flow and fair premium still has a preferred family");
  same(tiltOnly(0.05, 0).families, STATE_STRUCTURES.shortNoSide.fair.preferred.filter((x) => x !== "no position"), "the no-side row, with No position removed from the families");
  eq(read({ gexAdv: 0.03, tilt: 0.4, dDelta: 0.01 }).idea.direction, "neutral", "a pinned book takes no side from the flow");
  eq(SCREEN_LINES.TILT_DECISIVE, STATE_LINES.AGGRESSOR_SHARE, "the tilt line is the card's own aggressor-share line, not a second copy");
  eq(SCREEN_LINES.VRP_RELATIVE, STATE_LINES.VRP_RELATIVE, "and the premium line is the card's own");
}

{
  const facts = (r) => r.facts.map((f) => f.key).sort();
  const cases = [
    [["gexAdv"], ["gamma", "hedge"]], [["iv30"], ["hedge", "premium"]], [["dex"], ["dex"]], [["vanna"], ["vanna"]], [["charm"], ["charm"]],
    [["vrp"], ["premium"]], [["ivp"], ["ivp"]], [["ts"], ["term"]], [["im5"], ["move5"]], [["im30"], ["move30"]], [["ed"], ["event"]],
    [["tilt"], ["tilt"]], [["dDelta"], ["delta"]], [["si"], ["short"]],
  ];
  const whole = facts(read());
  eq(whole.length, 13, "a complete row prints thirteen facts");
  eq(read().withheld.length, 1, "and withholds the one input it lacks (an earnings date)");
  for (const [drop, gone] of cases) {
    if (drop[0] === "iv30") continue;
    const partial = { ...BASE, ...(drop[0] === "ed" ? {} : { ed: 30 }) };
    delete partial[drop[0]];
    const r = screenReading({ ticker: "SYN", u: partial, pct: {}, sessionDate: SESSION, expectedSession: SESSION });
    const w = r.withheld.find((x) => x.key === drop[0]);
    ok(w && /not in tonight's universe payload/.test(w.reason), `${drop[0]} missing from the payload is withheld and says the column was not published`);
    for (const g of gone) ok(!r.facts.some((f) => f.key === g) || drop[0] === "iv30", `and no ${g} fact is printed without its input`);
    const nulled = screenReading({ ticker: "SYN", u: { ...partial, [drop[0]]: null }, pct: {}, sessionDate: SESSION, expectedSession: SESSION });
    const w2 = nulled.withheld.find((x) => x.key === drop[0]);
    ok(w2 && /carried no value/.test(w2.reason), `${drop[0]} set to null is withheld and says the vendor row carried no value`);
    ok(nulled.facts.every((f) => Number.isFinite(f.value) || typeof f.value === "string"), `${drop[0]} null leaves no NaN or undefined behind`);
  }
  {
    const noIv = { ...BASE, ed: 30 };
    delete noIv.iv30;
    const r = screenReading({ ticker: "SYN", u: noIv, pct: {}, sessionDate: SESSION, expectedSession: SESSION });
    same(r.withheld.map((w) => w.key).sort(), ["gexAdv", "vrp"], "with no implied volatility the two facts built on it are withheld, and nothing else");
    ok(!r.facts.some((f) => f.key === "gamma" || f.key === "hedge" || f.key === "premium"), "and neither is printed");
  }
  const all = screenReading({ ticker: "SYN", u: {}, pct: {}, sessionDate: SESSION, expectedSession: SESSION });
  eq(all.status, "unavailable", "a row with none of the inputs is unavailable, not quiet");
  eq(all.state, "undetermined", "with no state");
  eq(all.facts.length, 0, "no fact");
  same(all.withheld.map((w) => w.key).sort(), ["charm", "dDelta", "dex", "ed", "gexAdv", "ivp", "im30", "im5", "si", "tilt", "ts", "vanna", "vrp"].sort(), "and every input withheld, each under its own key");
  eq(all.idea.kind, "none", "the idea is No position");
  ok(all.noIdeaReason && /Nothing in the screener row implies a state/.test(all.noIdeaReason), "with the reason in words");
  eq(all.tier, "screen", "still the screen tier");
  const junk = screenReading({ ticker: "SYN", u: { gexAdv: "0.03", iv30: NaN, vrp: Infinity, ed: undefined, tilt: {} }, pct: null, sessionDate: SESSION });
  eq(junk.state, "undetermined", "strings, NaN, Infinity and objects are not numbers and never reach a fact");
  eq(screenReading(null).tier, "screen", "null input still returns a reading");
  eq(screenReading(undefined).status, "unavailable", "and so does undefined");
}

{
  const cardFor = ({ gamma, prem, lean }) => {
    const rv = prem === "rich" ? 0.25 : prem === "cheap" ? 0.35 : 0.30;
    const card = { ticker: "SYN", sessionDate: SESSION, score: 0, conviction: 0, panels: {
      pricedMove: { status: "ok", iv30: 0.30, rv30: rv, vrpTrailing: 0.30 - rv, sessions: 21 } } };
    if (gamma !== 0) card.regime = { labelFrom: "book", labelValue: gamma, bookGammaRaw: gamma, bookGamma: gamma * 1e6, bookShare: 0.5 };
    if (lean !== 0) card.panels.path = { status: "ok", netDelta: lean * 1000, netPremium: lean * 1e6, persistence: 0.8, minutes: 390 };
    return card;
  };
  const screenFor = ({ gamma, prem, lean }) => {
    const rv = prem === "rich" ? 0.25 : prem === "cheap" ? 0.35 : 0.30;
    return read({
      gexAdv: gamma === 0 ? null : gamma * 0.03, iv30: 0.30, rv20: rv, vrp: 0.30 - rv,
      tilt: lean * 0.4, dDelta: lean * 0.01, ivp: 50, ed: null,
    });
  };
  let grid = 0, offered = 0;
  for (const gamma of [1, -1, 0]) for (const prem of ["rich", "cheap", "fair"]) for (const lean of [1, -1, 0]) {
    const spec = { gamma, prem, lean };
    const state = regimeState(cardFor(spec), {});
    const screen = screenFor(spec);
    const tag = `gamma ${gamma} premium ${prem} lean ${lean}`;
    eq(screen.state, state.state, `PARITY WITH regimeState, ${tag}: the same state (${state.state})`);
    eq(screen.premium, state.premium, `${tag}: the same premium reading`);
    same(screen.families.length ? screen.families : screen.idea.structures, screen.idea.kind === "family" ? state.preferred.filter((x) => x !== "no position") : [],
      `${tag}: the screen's families are regimeState's preferred structures, No position removed`);
    if (screen.idea.kind === "family") same(screen.avoid, state.avoid, `${tag}: and its avoid list is regimeState's`);
    eq(screen.confidence <= 1, true, `${tag}: confidence never above one`);
    if (screen.idea.kind === "family") offered++;
    grid++;
  }
  eq(grid, 27, "twenty-seven synthetic states compared");
  eq(offered, 23, "twenty-three of them offer a family (nine pinned, six leaning short, two undecided short, six premium-only) and four stand aside: short gamma with rich premium and no side, and gamma unread with fair premium three times");
  ok(regimeState(cardFor({ gamma: 1, prem: "fair", lean: 0 }), {}).confidence >= 1, "regimeState reads confidence too on the same card, so the comparison is between two live readings");
}

{
  const chain = fs.readFileSync(path.join(ROOT, "tests/fixtures-flows-legs-probe.json"), "utf8");
  const row = JSON.parse(chain).specScreenerRow.row;
  const uni = buildUniverse([row], { sessionDate: row.date });
  const u = {};
  for (const k of Object.keys(uni.cols)) u[k] = universeValue(uni, "NVDA", k);
  const r = screenReading({ ticker: "NVDA", u, pct: {}, sessionDate: row.date, expectedSession: row.date, sector: "Technology" });
  eq(r.gamma, "long", "THE VENDOR'S OWN NVDA ROW, through the universe and the reading: gamma $614,273,906.59 per 1% is positive, so long");
  near(factOf(r, "gamma").value, 614273906.59 / (130548356.35 * 212.32) * 100, 0.006, "2.22% of average daily dollar volume, worked from the row");
  eq(r.premium, "cheap", "implied 33.9% against realised 44.2% is -23% of realised: cheap");
  near(factOf(r, "premium").value, (0.339 - 0.442) / 0.442 * 100, 0.4, "-23.3%, worked by hand");
  eq(r.state, "pinned", "so the state is pinned");
  same(r.families, ["calendar spread"], "and the pinned, cheap row of the consolidated table prefers a calendar spread alone");
  ok(r.conflicts.length === 0, "with the 8.4th-percentile implied volatility agreeing with a cheap premium");
  eq(factOf(r, "dex").text, "+3.30", "dealer delta 3.30 times a day's dollar volume");
  eq(factOf(r, "charm").text, "negative", "charm negative in the vendor's sign");
  eq(factOf(r, "move30").text, "±6.6%", "and the 30-day priced move");
  eq(r.lean, null, "the row's tilt (+12%) is under the line and its delta flow is negative: no lean");
}

{
  const samples = [];
  for (const g of [0.05, -0.05, 0.002, null]) for (const rel of [0.2, -0.2, 0, null]) for (const ed of [3, 40, null]) for (const tilt of [0.4, -0.4, 0.05]) {
    samples.push(read({ gexAdv: g, ...(rel === null ? { vrp: null } : { vrp: rel * 0.3, rv20: 0.3, iv30: 0.3 + rel * 0.3 }), ed, tilt, dDelta: tilt / 20 }));
  }
  samples.push(read({}, { sessionDate: "2026-09-10" }), read({}, { sessionDate: "2026-09-14" }), read({ ivp: 10, vrp: 0.1, iv30: 0.4, rv20: 0.3 }));
  ok(samples.length > 140, `${samples.length} readings swept for wording`);
  const banned = /\b(will|should|expect\w*|likely|going to|forecast\w*|predict\w*|anticipat\w*|poised|target\w*|odds|would|could|might|may)\b/i;
  let sentences = 0, families = 0;
  for (const r of samples) {
    const say = [{ say: r.facts.map((f) => [f.label, f.display, f.note].join(" ")).join("\n") + "\n" + [r.sessionDate, "2026-09-15"].join(" ") }];
    for (const t of screenTexts(r)) {
      sentences++;
      ok(!banned.test(t), `no forecast, modal or target word in: ${t.slice(0, 90)}`);
      const v = guardAnswer(t, say, { smallIntegers: false, modals: true });
      ok(v.forecast === false, `the ask guard finds no forecast verb in: ${t.slice(0, 90)}`);
    }
    for (const t of [r.summary, r.idea.text, r.noIdeaReason].filter(Boolean)) {
      const v = guardAnswer(t, say, { smallIntegers: false, modals: true });
      ok(v.ok, `every numeral in the summary, the idea and the reason is one a fact prints (${(v.rejected || []).join(", ")}) in: ${t.slice(0, 80)}`);
    }
    ok(r.summary.includes(SCREEN_LIMITS), "every summary says what was not read");
    ok(r.why === SCREEN_WHY && r.priced === false, "and marks itself unpriced with the reason");
    if (r.idea.kind === "family") {
      families++;
      ok(/soft tilt, not a signal for one name/.test(r.summary) && /soft tilt, not a signal for one name/.test(r.idea.text), "a family idea says it is a soft tilt and not a signal for one name");
      ok(r.families.length > 0 && r.families.every((x) => x !== "no position"), "and names structure families only, never No position");
      ok(!/strike|\d+\s?(?:call|put)\b/.test(r.idea.text.replace(SCREEN_LIMITS, "")), "it names no strike");
    } else {
      ok(r.noIdeaReason && r.noIdeaReason.length > 20 && r.summary.includes("No position."), "No position always carries a reason in words");
    }
    for (const f of r.facts) {
      ok(f.unit && f.unit.length > 3 && f.display.endsWith(f.unit), `fact ${f.key} is never printed without its unit: ${f.display.slice(0, 70)}`);
      ok(f.grade === 0 || f.grade === 1, `fact ${f.key} is graded 0 or 1, never above (${f.grade})`);
    }
    ok(r.confidence === 0 || r.confidence === 1, "confidence is zero or one");
    ok(r.families.every((x) => typeof x === "string"), "families are names");
  }
  ok(sentences > 3000 && families > 20, `${sentences} sentences from ${families} family readings, none a forecast`);
}

{
  const code = (r) => r.noIdeaCode;
  eq(code(read({})), null, "a reading that offers a family carries no no-idea code");
  eq(code(read({ ed: 5 })), "event.window", "the earnings window is the code event.window");
  eq(code(read({ vrp: 0.1, iv30: 0.4, rv20: 0.3, ivp: 10 })), "premium.conflict", "a rich premium at a low percentile is premium.conflict");
  eq(code(read({ gexAdv: -0.03, tilt: 0.05, vrp: 0.05, iv30: 0.3, rv20: 0.25 })), "table.no-side", "short gamma, rich premium and no lean is table.no-side");
  eq(code(read({ gexAdv: null, vrp: null })), "state.undetermined", "no gamma and no premium is state.undetermined");
  eq(code(screenReading({ ticker: "SYN", u: {}, pct: {}, sessionDate: SESSION, expectedSession: SESSION })), "screen.no-inputs", "a row with none of the inputs is screen.no-inputs");
  eq(code(read({}, { sessionDate: "2026-09-11" })), "expired.sessions", "and an old row is expired.sessions");
  eq(read({}).limits, SCREEN_LIMITS, "every reading carries the sentence that says what was not read, on its own for a client to print");
}

{
  const cur = read({}, {});
  eq(cur.tier, "screen", "a row for the expected session is the screen tier");
  eq(cur.stale, false, "and is not stale");
  const one = read({}, { sessionDate: "2026-09-14" });
  eq(one.tier, "screen", "a row one session behind is still the screen tier");
  eq(one.behind, 1, "it says it is one behind");
  eq(one.stale, true, "stale");
  ok(one.notes.some((n) => /a session old/.test(n)), "and says so");
  const two = read({}, { sessionDate: "2026-09-11" });
  eq(two.behind, 2, "Friday to Tuesday is two sessions");
  eq(two.tier, "expired", "two sessions behind is EXPIRED");
  eq(two.idea.kind, "none", "the facts stay and the idea goes");
  ok(two.facts.length >= 10 && two.families.length === 0 && two.confidence === 0, "facts kept, no family, confidence zero");
  ok(/2 sessions before the last close/.test(two.noIdeaReason) && /^Expired/.test(two.summary), "and it says why in the first words");
  eq(read({}, { behind: 5 }).tier, "expired", "an explicit count of sessions behind is honoured");
}

{
  const r = read({}, {});
  const bytes = JSON.stringify(r).length;
  ok(bytes < 8 * 1024, `a full screen reading is ${bytes} bytes, under 8 KiB`);
  const src = fs.readFileSync(path.join(ROOT, "shared/flows-neuron-screen.js"), "utf8");
  ok(!/\/\/|\/\*/.test(src.replace(/https?:\/\//g, "")), "the module carries no comments");
  ok(/^import .* from "\.\/flows-neuron\.js";\nimport .* from "\.\/flows-quant-structures\.js";\nimport .* from "\.\/flows-cross\.js";\n/.test(src), "and imports the consolidated table, the bucket lines and the session counter, nothing else");
  const neuron = fs.readFileSync(path.join(ROOT, "shared/flows-neuron.js"), "utf8");
  ok(!/flows-neuron-screen/.test(neuron), "flows-neuron.js does not import the screen module back: no cycle");
  const cross = fs.readFileSync(path.join(ROOT, "shared/flows-cross.js"), "utf8");
  ok(!/flows-neuron/.test(cross), "and neither does the universe");
}

console.log(`✓ flows-neuron-screen: ${checks} assertions — a reading from the screener row alone for a name that has no card: book-gamma sign and size worked by hand against the implied daily move, dealer delta and vanna shown as the vendor's numbers with no direction claimed, charm as a sign only, a premium axis on the card's own lines with the earnings-window and percentile conflicts that turn it into No position, a flow lean that needs the tilt and the delta flow to agree, the same state and structure families as regimeState across twenty-seven synthetic states, every input withheld with its reason when null or unpublished, the vendor's own NVDA row end to end, an expired reading at two sessions, and every emitted sentence free of forecast and modal words, with a unit on every fact`);
