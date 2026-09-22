import assert from "node:assert/strict";
import { buildContext, contextLines, contextFacts, promptForNeuron, parseNeuronOutput, vetIdeas,
         deterministicSummary, contextFingerprint, publicContext, NEURON_CONTEXT_VERSION,
         NEURON_MAX_IDEAS, NEURON_STRUCTURES } from "../shared/flows-neuron.js";
import { TICKER_PANELS, SENTINEL_KEYS } from "../shared/flows-panels.js";
import { guardAnswer, selectFacts, buildFactIndex } from "../shared/flows-ask.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const CARD = {
  ticker: "SYN1", nm: "Synthetic One", sector: "Energy", sessionDate: "2026-09-15",
  generatedAt: "2026-09-16T08:00:00.000Z", depth: "board",
  score: 58, conviction: 92,
  conv: { agreement: 1, breadth: 3, coverage: 1, persistence: 0.58, gate: 1.43 },
  quality: { otmShare: 0.6, vegaTilt: 0.24 },
  regime: { label: "short", crossings: 0 }, gammaFlip: 68.32, atr: 1.48,
  fam: { F: 59, P: 32, D: 58, V: 51, O: 71 },
  panels: {
    gamma: { status: "ok", spot: 70.22, callWall: 67, putWall: 70, strikes: 40,
      lead: { say: "Dealer gamma for SYN1 is short at spot 70.22; the call wall is at 67.00 and the put wall at 70.00." } },
    levels: { status: "ok", spot: 70.22, atr: 1.48,
      lead: { say: "Nearest: put wall at 70.00, 0.3% below spot 70.22 — 0.15σ." } },
    pricedMove: { status: "ok", impliedMove: 0.043, impliedLow: 67.2, impliedHigh: 73.24, sessions: 10,
      lead: { say: "Options price a ±4.3% move over 10 sessions — 67.20 to 73.24." } },
    ivSurface: { status: "ok", placed: 50, fresh: 30, lead: { say: "The smile is bid on the put wing." } },
    path: { status: "ok", minutes: 390, persistence: 0.78, netPremium: -19251664,
      lead: { say: "Net selling over 390 minutes — 78% of minutes ran with it." } },
    aggressor: { status: "quiet", reason: "no aggressor split was reported" },
    darkpool: { status: "unavailable", reason: "the feed could not be read" },
    congress: { status: "ok", total: 3, buys: 1, sells: 2, lead: { say: "Congress disclosed 3 trades in this name." } },
    context: { status: "ok", r21: 0.012, week52Pos: 0.27,
      lead: { say: "Sitting at 27% of its 52-week range." },
      garch: { status: "ok", dist: "skewt", converged: true, lastVol: 25.8, nextVol: 25.1, longRunVol: 24.9, nu: 6.1, lambda: -0.21,
        persistence: 0.98, n: 251 } },
  },
};

{
  const ctx = buildContext(CARD, { expectedSession: "2026-09-15" });
  const panelKeys = TICKER_PANELS.filter((p) => !SENTINEL_KEYS.has(p.key)).map((p) => p.key);
  eq(ctx.version, NEURON_CONTEXT_VERSION, "the context carries its protocol version");
  eq(ctx.features.length, panelKeys.length + 2,
     "one feature per registry panel plus the standing and the volatility model, so nothing on the card is outside Neuron's view");
  for (const k of panelKeys) ok(ctx.features.some((f) => f.key === k), `feature ${k} is present whatever its status`);
  eq(ctx.stale, false, "the card describes the last closed session, so it is not stale");
  const by = new Map(ctx.features.map((f) => [f.key, f]));
  eq(by.get("standing").robustness, 3, "conviction 92 with the gate cleared and full coverage is robust");
  eq(by.get("gamma").robustness, 3, "a gamma profile over 40 strikes is robust");
  eq(by.get("ivSurface").robustness, 2, "a surface with 30 of 50 fresh quotes is fair, because a fifth or more are stale");
  eq(by.get("path").robustness, 3, "a full session with a one-sided persistence is robust");
  eq(by.get("aggressor").robustness, 1, "a quiet panel is weak: measured, but nothing to lean on");
  eq(by.get("aggressor").status, "quiet", "and its status stays quiet, never collapsed into unavailable");
  eq(by.get("darkpool").robustness, 0, "an unavailable panel is withheld");
  eq(by.get("congress").robustness, 1, "disclosures filed weeks late are weak whatever they say");
  eq(by.get("garch").robustness, 3, "a converged fit is robust");
  ok(/skew -0.21/.test(by.get("garch").say) && /heavier left tail/.test(by.get("garch").say),
     "the volatility feature quotes the fitted skew and reads its sign");
  ok(by.get("calendar").robustness === 0 && by.get("calendar").status === "unavailable",
     "a panel the card does not carry is withheld and named unavailable");
  eq(ctx.coverage.features, ctx.features.length, "coverage counts every feature");
  eq(ctx.coverage.read + ctx.coverage.quiet + ctx.coverage.withheld, ctx.features.length,
     "and read, quiet and withheld partition them");
  eq(ctx.coverage.robust, ctx.features.filter((f) => f.robustness === 3).length, "the robust count is the count of grade 3");

  const lines = contextLines(ctx);
  eq(lines.length, ctx.features.length, "one context line per feature, silences included");
  ok(lines.every((l) => /^\[[a-zA-Z]+\] /.test(l)), "every line opens with the feature's bracketed key");
  ok(lines.some((l) => /\[darkpool\].*withheld|\[darkpool\].*unavailable/.test(l)),
     "a withheld feature is still a line, so the model is told what it cannot lean on");
  ok(lines.find((l) => l.startsWith("[standing]")).includes("Figures: score 58, conviction 92"),
     "the standing line carries the score and conviction as figures");

  const older = JSON.parse(JSON.stringify(CARD));
  older.panels.context.garch = { status: "ok", converged: true, lastVol: 25.8, nextVol: 25.1, longRunVol: 24.9,
    nu: 1.3, persistence: 0.98, n: 251 };
  const pre = buildContext(older, { expectedSession: "2026-09-15" }).features.find((f) => f.key === "garch");
  eq(pre.robustness, 2, "a converged fit published before the skewed t is fair, not robust");
  ok(!/tail shape|with skew/.test(pre.say) && /predates the skewed t/.test(pre.say),
     "and its reading names no shape or skew it never fitted, saying instead that the density predates the skewed t");
  ok(pre.figures.nu === null && pre.figures.lambda === null && pre.figures.skewt === false,
     "with the shape and skew figures withheld rather than read off a different density");

  const stale = buildContext(CARD, { expectedSession: "2026-09-16" });
  eq(stale.stale, true, "a card behind the last closed session is stale");
  ok(stale.features.every((f) => f.robustness <= 1), "and every grade is capped at weak");
  ok(stale.features.find((f) => f.key === "gamma").why.includes("capped"), "with the cap named in the reason");

  const fp = contextFingerprint(ctx);
  ok(/^n1\./.test(fp), "the fingerprint carries the protocol version");
  ok(fp !== contextFingerprint(stale), "and moves when the cap changes the grades");
  ok(fp === contextFingerprint(buildContext(JSON.parse(JSON.stringify(CARD)), { expectedSession: "2026-09-15" })),
     "and is stable across a deep copy of the same card");

  const pub = publicContext(ctx);
  ok(pub.features.every((f) => !("figures" in f) && !("say" in f) && typeof f.robustnessWord === "string"),
     "the public context carries grades and reasons, never the figures or leads a page already draws");

  const p = promptForNeuron(ctx);
  ok(/NEVER write a number/.test(p.system) && /NEVER say what the market is going to do/.test(p.system),
     "the prompt keeps the two rules the guard enforces");
  ok(/will, should, expect, expected, likely, going to, forecast or predict/.test(p.system),
     "and names the forecast verbs the guard refuses");
  ok(NEURON_STRUCTURES.every((s) => p.system.includes(s)), "every permitted structure is listed");
  ok(p.user.includes("[gamma]") && p.user.includes("robustness 3 of 3"), "the user turn carries the graded lines");
  ok(!/Question:/.test(p.user), "and asks no question: Neuron reads, it is not asked");

  const facts = contextFacts(ctx);
  ok(facts.every((f) => f.source === "card:SYN1" && f.topic.includes("SYN1") && typeof f.say === "string"),
     "context facts wear the card's source and the name as a topic");
  eq(facts.length, ctx.features.filter((f) => f.say).length, "one fact per feature with a reading");
  const index = buildFactIndex({});
  const pool = { ...index, facts: (index.facts || []).concat(facts) };
  const sel = selectFacts(pool, "what is the gamma picture", { subject: { tickers: ["SYN1"] } });
  ok(sel.picked.some((f) => f.id === "neuron:SYN1/gamma"),
     "the assistant's selector reaches a Neuron fact for the page's own name");
}

{
  const ctx = buildContext(CARD, { expectedSession: "2026-09-15" });
  const good = {
    title: "Put wall credit", structure: "put credit spread", direction: "bullish",
    thesis: "The put wall at 70.00 sits 0.3% below spot 70.22 and dealer gamma is short.",
    rests_on: ["gamma", "levels"], invalidation: "a close below 70.00", horizon: "10 sessions",
  };
  const parsed = parseNeuronOutput("```json\n" + JSON.stringify({ summary: "SYN1 scored 58 with conviction 92 of 100.", ideas: [
    good,
    { ...good, title: "Prophecy", thesis: "It will rise past 70.22." },
    { ...good, title: "Invented", thesis: "A 9.9% move is priced." },
    { ...good, title: "Thin", rests_on: ["gamma"] },
    { ...good, title: "Withheld", rests_on: ["gamma", "darkpool"] },
    { ...good, title: "Unknown", rests_on: ["gamma", "moon"] },
    { ...good, title: "Odd", structure: "naked call" },
    { ...good, title: "Weak", rests_on: ["congress", "gamma"] },
    { ...good, title: "Quiet leg", rests_on: ["aggressor", "gamma"] },
  ] }) + "\n```");
  ok(parsed !== null && parsed.summary.startsWith("SYN1 scored"), "a fenced JSON answer is parsed");
  const v = vetIdeas(parsed.ideas, ctx);
  const titles = v.ideas.map((i) => i.title);
  ok(titles.includes("Put wall credit"), "the idea that rests on two robust features is kept");
  ok(!titles.includes("Prophecy"), "an idea that claims what happens next is refused");
  ok(!titles.includes("Invented"), "an idea naming a figure the card does not carry is refused");
  ok(!titles.includes("Thin"), "an idea resting on one feature is refused");
  ok(!titles.includes("Withheld"), "an idea resting on a withheld feature is refused");
  ok(!titles.includes("Unknown"), "an idea resting on a feature the card does not have is refused");
  ok(!titles.includes("Odd"), "a structure outside the list is refused");
  ok(v.ideas.length <= NEURON_MAX_IDEAS, "at most three ideas survive");
  eq(v.ideas[0].title, "Put wall credit", "and the most robust idea ranks first");
  const weak = v.ideas.find((i) => i.title === "Weak");
  ok(weak === undefined || weak.robustness === 1, "an idea resting on the congress feature is graded by that weakest leg");
  ok(v.refused.length >= 6 && v.refused.every((r) => typeof r === "string" && r.includes(":")),
     "every refusal names the idea and the reason");
  ok(v.ideas.every((i) => guardAnswer([i.title, i.thesis, i.invalidation, i.horizon].join(" "),
       contextLines(ctx).map((say) => ({ say })), { smallIntegers: false }).ok),
     "every surviving idea passes the same guard the summary passes");

  eq(parseNeuronOutput("not json at all"), null, "prose instead of JSON parses to null");
  eq(parseNeuronOutput(""), null, "and so does an empty answer");
  const loose = parseNeuronOutput("Here you go: {\"summary\": \"x\", \"ideas\": []} thanks");
  ok(loose !== null && loose.summary === "x" && loose.ideas.length === 0, "a JSON object wrapped in chatter is still found");

  const plain = deterministicSummary(ctx);
  ok(guardAnswer(plain, contextLines(ctx).map((say) => ({ say })), { smallIntegers: false }).ok,
     "the deterministic summary passes the guard by construction");
  ok(plain.includes("Dealer gamma for SYN1"), "and is built from the most robust features' own sentences");
}

console.log(`✓ flows-neuron: ${checks} assertions — a context that carries every registry panel plus the ` +
  "standing and the volatility model, each graded 0 to 3 from the card's own coverage and quality fields " +
  "and capped at weak when the card is behind the last closed session; one line per feature so the model " +
  "is told what it cannot lean on; a prompt that keeps the guard's two rules and names the verbs it " +
  "refuses; ideas parsed from JSON and vetted one by one — two known features at least, none withheld, " +
  "a listed structure, every figure quoted, no claim about what happens next — and ranked by their " +
  "weakest leg; the assistant's selector reaching the same facts for the page's own name");
