import assert from "node:assert/strict";
import { buildContext, contextLines, contextFacts, promptForNeuron, parseNeuronOutput, vetIdeas,
         deterministicSummary, contextFingerprint, publicContext, guardFacts, numeralsOf,
         regimeState, stateIdea, stateSentence, stateChip, STATES, STATE_STRUCTURES, STATE_LINES, STATE_WORD,
         NEURON_CONTEXT_VERSION, NEURON_MAX_IDEAS, NEURON_STRUCTURES,
         engineContext, engineFallback, promptForEngine, parseEngineOutput, vetEngineReply, verdictHolds, claimHolds,
         VERDICTS, VERDICT_WORD, CLAIM_RELS, VET_CODES } from "../shared/flows-neuron.js";
import { TICKER_PANELS, SENTINEL_KEYS } from "../shared/flows-panels.js";
import { guardAnswer, selectFacts, buildFactIndex } from "../shared/flows-ask.js";
import { modelName, neuronProvenance } from "../shared/flows-pages.js";
import { variation, cardVariationInput } from "../shared/flows-variation.js";
import { gammaReading } from "../shared/flows-neuron.js";
import { aggressorGamma } from "../shared/flows-features.js";
import { buildCard } from "../shared/flows-card.js";
import fs from "node:fs";
import { aiText, modelInput, askModels, aiChain, aiCallSignature, retryableGuard, repliedGuard, modelRates,
         spendShape, fallbackNote, emptyNote, intradayFloorMs, AI_LENGTH_RETRY_MS, AI_INTRADAY_REFRESH_MS } from "../shared/flows-ai.js";
import { readFileSync } from "node:fs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b})`); checks++; };

const CARD = {
  ticker: "SYN1", nm: "Synthetic One", sector: "Energy", sessionDate: "2026-09-15",
  generatedAt: "2026-09-16T08:00:00.000Z", depth: "board",
  score: 58, conviction: 92,
  conv: { agreement: 1, breadth: 3, coverage: 1, persistence: 0.58, gate: 1.43 },
  quality: { otmShare: 0.6, vegaTilt: 0.24 },
  regime: { label: "short", labelFrom: "book", labelValue: -3.4e5, crossings: 0, flowGamma: -2.1e6, flowLabel: "short",
    bookGammaRaw: -3.4e5, bookShare: -0.42 }, strikeSumCrossing: 68.32, atr: 1.48,
  fam: { F: 59, P: 32, D: 58, V: 51, O: 71 },
  panels: {
    gamma: { status: "ok", spot: 70.22, flowPeakLong: 67, flowPeakShort: 70, strikes: 40,
      lead: { say: "Dealer gamma for SYN1 is short at spot 70.22; the call wall is at 67.00 and the put wall at 70.00." } },
    levels: { status: "ok", spot: 70.22, atr: 1.48,
      levels: [{ kind: "put_wall", label: "Put wall", px: 70, distPct: -0.003, distAtr: -0.15 },
        { kind: "max_pain", label: "Max pain", px: 72.5, distPct: 0.032, distAtr: 1.54 },
        { kind: "call_wall", label: "Call wall", px: 67, distPct: -0.046, distAtr: -2.18 }],
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
  eq(ctx.features.length, panelKeys.length + 3,
     "one feature per registry panel plus the standing, the volatility model and the implied state, so nothing on the card is outside Neuron's view");
  eq(ctx.features[ctx.features.length - 1].key, "state", "and the implied state is the last line, read after every feature it is computed from");
  for (const k of panelKeys) ok(ctx.features.some((f) => f.key === k), `feature ${k} is present whatever its status`);
  eq(ctx.stale, false, "the card describes the last closed session, so it is not stale");
  const by = new Map(ctx.features.map((f) => [f.key, f]));
  eq(by.get("standing").robustness, 3, "conviction 92 with the gate cleared and full coverage is robust");
  {
    const gated = JSON.parse(JSON.stringify(CARD));
    gated.conv.gate = 0.4;
    const st = buildContext(gated, { expectedSession: "2026-09-15" }).features.find((f) => f.key === "standing");
    ok(st.robustness === 2 && /quality gate/.test(st.why),
       `a failed gate drops the standing to fair and the reason names the gate, not a conviction band (${st.why})`);
  }
  ok(by.get("levels").figures.maxPain === "72.50" && by.get("levels").figures.callWall === "67.00",
     "every level on the card is a quotable figure, printed as the page prints it, so an invalidation at max pain can pass the guard");
  ok(numeralsOf(ctx).has("72.50"), "and the max-pain level is in the numerals a model may quote");
  eq(by.get("gamma").robustness, 2,
     "a gamma ladder over 40 strikes is fair, not robust: it is one session's directionalized volume, " +
     "the gamma dealers added today, and no longer described as the standing book");
  ok(/added today/.test(by.get("gamma").why) && !/clearing snapshot/.test(by.get("gamma").why),
     `and its reason names what it reads (${by.get("gamma").why})`);
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
  ok(/^n3\./.test(fp), "the fingerprint carries the protocol version, now 3 for the engine facts and structures");
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
    title: "Put wall break", structure: "put debit spread", direction: "bearish",
    thesis: "The put wall at 70.00 sits 0.3% below spot 70.22 and dealer gamma is short.",
    rests_on: ["gamma", "levels"], invalidation: "a close above 70.00", horizon: "10 sessions",
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
    { ...good, title: "Against the state", structure: "put credit spread", direction: "bullish", invalidation: "a close below 70.00" },
  ] }) + "\n```");
  ok(parsed !== null && parsed.summary.startsWith("SYN1 scored"), "a fenced JSON answer is parsed");
  const v = vetIdeas(parsed.ideas, ctx);
  const titles = v.ideas.map((i) => i.title);
  ok(titles.includes("Put wall break"), "the idea that rests on two robust features is kept");
  ok(!titles.includes("Against the state") && v.refused.some((r) => /avoid list/.test(r)),
     "an idea whose structure the implied state rules out is refused with the state named");
  ok(!titles.includes("Prophecy"), "an idea that claims what happens next is refused");
  ok(!titles.includes("Invented"), "an idea naming a figure the card does not carry is refused");
  ok(!titles.includes("Thin"), "an idea resting on one feature is refused");
  ok(!titles.includes("Withheld"), "an idea resting on a withheld feature is refused");
  ok(!titles.includes("Unknown"), "an idea resting on a feature the card does not have is refused");
  ok(!titles.includes("Odd"), "a structure outside the list is refused");
  ok(v.ideas.length <= NEURON_MAX_IDEAS, "at most three ideas survive");
  eq(v.ideas[0].title, "Put wall break", "and the most robust idea ranks first");
  const weak = v.ideas.find((i) => i.title === "Weak");
  ok(weak === undefined || weak.robustness === 1, "an idea resting on the congress feature is graded by that weakest leg");
  ok(v.refused.length >= 6 && v.refused.every((r) => typeof r === "string" && r.includes(":")),
     "every refusal names the idea and the reason");
  ok(v.ideas.every((i) => guardAnswer([i.title, i.thesis, i.invalidation, i.horizon].join(" "),
       guardFacts(ctx), { smallIntegers: false }).ok),
     "every surviving idea passes the same guard the summary passes");
  ok(!guardFacts(ctx).some((f) => /robustness \d of 3|r21|week52Pos/.test(f.say)),
     "and the guard's fact set carries readings and figure values only, never the grade head or a digit-bearing key name");
  {
    const bracketed = vetIdeas([{ ...good, rests_on: ["[gamma]", " [Levels] "] }], ctx);
    ok(bracketed.ideas.length === 1 && bracketed.ideas[0].restsOn.join(",") === "gamma,levels",
       "keys written with the brackets the context shows, or in another case, still resolve to the features");
    const doubled = vetIdeas([{ ...good, rests_on: ["gamma", "gamma"] }], ctx);
    ok(doubled.ideas.length === 0 && /fewer than two/.test(doubled.refused[0]), "the same key twice is one feature");
    const twice = vetIdeas([good, { ...good, title: "Put wall break again" }], ctx);
    eq(twice.ideas.length, 1, "an idea that repeats a kept one in structure, direction and invalidation is dropped");
    const crossed = vetIdeas([{ ...good, structure: "long call", direction: "bearish" }], ctx);
    ok(crossed.ideas.length === 0 && /long call is not bearish/.test(crossed.refused[0]),
       "a structure whose payoff contradicts its stated direction is refused with the contradiction named");
    const painful = vetIdeas([{ ...good, invalidation: "a close above max pain at 72.50" }], ctx);
    eq(painful.ideas.length, 1, "an invalidation at max pain, quoted as the card prints it, passes");
  }

  eq(parseNeuronOutput("not json at all"), null, "prose instead of JSON parses to null");
  eq(parseNeuronOutput(""), null, "and so does an empty answer");
  const loose = parseNeuronOutput("Here you go: {\"summary\": \"x\", \"ideas\": []} thanks");
  ok(loose !== null && loose.summary === "x" && loose.ideas.length === 0, "a JSON object wrapped in chatter is still found");

  const plain = deterministicSummary(ctx);
  ok(guardAnswer(plain, guardFacts(ctx), { smallIntegers: false }).ok,
     "the deterministic summary passes the guard by construction");
  ok(/^The greeks imply a squeeze state for SYN1 with flow bearish/.test(plain),
     "and leads with the implied state, then the most robust features' own sentences");
  ok(plain.includes("Net selling over 390 minutes") && !plain.includes("Dealer gamma for SYN1"),
     "which follow it — the tape's sentence now, since the strike ladder is graded fair as the gamma " +
     "dealers added today and no longer outranks the robust readings");
  const staleCtx = buildContext(CARD, { expectedSession: "2026-09-16" });
  const stalePlain = deterministicSummary(staleCtx);
  ok(/capped at weak/.test(stalePlain) && stalePlain.includes("Dealer gamma for SYN1"),
     "a stale card's fallback names the cap and still quotes the readings, instead of claiming the card publishes none");
  ok(guardAnswer(stalePlain, guardFacts(staleCtx), { smallIntegers: false }).ok, "and passes the guard too");
}

{
  const ctx = buildContext(CARD, { expectedSession: "2026-09-15" });
  const st = ctx.state;
  ok(STATES.includes(st.state) && st.state === "squeeze" && st.direction === "bearish" && st.flow === "bearish",
     `short gamma at spot with a one-sided selling tape and the put wall 0.15 ATR below, no flip between, is a squeeze toward that wall (${st.chip})`);
  ok(st.target && st.target.kind === "put_wall" && st.target.px === 70, "the wall the flow leans toward is the target");
  eq(st.confidence, 2,
     "confidence starts at the positioning grade — fair, because the walls read off today's flow ladder — and " +
     "keeps it, the book's net sitting at 42% of its gross, over the 20% marginal line");
  ok(st.invalidation && st.invalidation.kind === "max_pain" && st.invalidation.px === 72.5,
     "the state ends past the nearest level on the other side of the flow");
  ok(st.horizon && st.horizon.kind === "priced_sessions" && st.horizon.value === 10, "and runs over the priced-move window");
  assert.deepEqual(st.preferred, STATE_STRUCTURES.bear.fair.preferred, "a bearish squeeze with unreadable premium prefers the fair bear structures"); checks++;
  ok(st.avoid.includes("put credit spread") && st.avoid.includes("iron condor"), "and rules out the structures that pay against it");
  ok(st.drivers.some((d) => d.key === "path" && d.vote === -1) && st.drivers.some((d) => d.key === "standing" && d.weight === 1),
     "the tape votes with its full grade and the card's own score is a tie-breaker of weight one, since it is built from the same tape");
  const feat = ctx.features.find((f) => f.key === "state");
  ok(feat && feat.status === "ok" && feat.robustness === 2 && /read from gamma, levels, path, standing/.test(feat.why),
     "the state is a feature graded by its confidence, its reason naming the drivers");
  ok(/^IMPLIED STATE for SYN1: squeeze, flow bearish \(confidence 2 of 3\)\./.test(feat.say) && /Avoid: iron condor/.test(feat.say),
     "its reading opens with the state and closes with the structures it prefers and rules out");
  eq(feat.say, stateSentence(st, "SYN1"), "and is the state sentence itself");
  eq(st.chip, stateChip(st), "the chip is derived from the same object");
  ok(guardAnswer(feat.say, guardFacts(ctx), { smallIntegers: false }).ok, "the state sentence passes the guard by construction");
  const idea = stateIdea(ctx);
  ok(idea && idea.fromState === true && idea.structure === st.preferred[0] && idea.direction === "bearish",
     "the state writes its own idea in the first preferred structure with the state's direction");
  ok(idea.rests_on[0] === "state" && idea.rests_on.includes("gamma") && idea.rests_on.includes("levels") && idea.rests_on.includes("path") && !idea.rests_on.includes("standing"),
     "resting on the state, its positioning and the tape that voted, never on the tie-breaker when the tape voted");
  const own = vetIdeas([idea], ctx);
  ok(own.ideas.length === 1 && own.refused.length === 0 && own.ideas[0].robustness === 2 && own.ideas[0].fromState === true,
     "and that idea passes the same vetting the model's ideas pass, graded by its weakest leg");
  ok(/pays if spot holds below the max pain at 72\.50/.test(idea.thesis) && /^a close above the max pain at 72\.50$/.test(idea.invalidation),
     "with a conditional payoff and an invalidation at the level the state ends at");
  const v = vetIdeas([idea, { ...idea, title: "Model twin", fromState: false }], ctx);
  ok(v.ideas.length === 1 && v.ideas[0].fromState === true, "the state's idea outranks a model idea it ties with");
  {
    const strong = { title: "Wall break", structure: "put debit spread", direction: "bearish", thesis: "Dealer gamma is short at spot 70.22.",
      rests_on: ["path", "standing"], invalidation: "a close above 72.50", horizon: "10 sessions" };
    const led = vetIdeas([strong, idea], ctx);
    ok(led.ideas.length === 2 && led.ideas[0].fromState === true && led.ideas[1].robustness === 3,
       "the state's idea leads the list even when a model idea outgrades it, so the provenance line that names the first idea as the state's own is true");
  }
  {
    const tied = JSON.parse(JSON.stringify(CARD));
    tied.panels.displacement = { status: "ok", gapAtr: 1.2, oiCentroid: 69, volCentroid: 70.8, spot: 70.22 };
    tied.panels.oiDeltas = { status: "ok", rows: [{ cp: "C", diff: 900 }, { cp: "P", diff: 100 }] };
    tied.panels.path.persistence = 0.7;
    tied.panels.path.minutes = 200;
    const ts = regimeState(tied, { expectedSession: "2026-09-15" });
    const votes = ts.drivers.filter((d) => d.axis === "flow" && d.vote !== 0).map((d) => d.key + ":" + d.vote);
    ok(votes.includes("path:-1") && votes.includes("oiDeltas:1") && votes.includes("standing:1") && ts.flow === "bullish" && !ts.drivers.some((d) => d.key === "path" && d.split),
       `when the tape's votes tie the card's score breaks the tie (${votes.join(", ")} -> ${ts.flow})`);
    ok(!votes.some((v) => v.startsWith("displacement")),
       "and displacement casts no vote: its centroid gap weighs calls and puts by magnitude, so buying and selling move it alike");
    const disp = ts.drivers.find((d) => d.key === "displacement");
    ok(disp && disp.axis === "horizon" && disp.weight === 0 && /casts no vote/.test(disp.reading),
       `it is read on the horizon axis at weight 0 instead (${disp && disp.reading})`);
    const decided = JSON.parse(JSON.stringify(tied));
    decided.panels.oiDeltas.rows = [{ cp: "C", diff: 100 }, { cp: "P", diff: 900 }];
    const ds = regimeState(decided, { expectedSession: "2026-09-15" });
    ok(ds.flow === "bearish" && ds.confidence === 2,
       "and when they agree the score is not counted, so a tie-breaker cannot turn a decided vote into a split");
    const onlyScore = JSON.parse(JSON.stringify(CARD));
    onlyScore.panels.path.persistence = 0.5;
    const os = regimeState(onlyScore, { expectedSession: "2026-09-15" });
    ok(os.flow === "bullish", "with no tape vote at all the score alone gives the flow its side");
  }
  {
    const puts = JSON.parse(JSON.stringify(CARD));
    puts.panels.aggressor = { status: "ok", reported: 100, unreported: 0, bars: [{ k: 68, net: -300 }, { k: 70, net: -226 }, { k: 72, net: 40 }],
      lead: { say: "Puts were taken at the offer.", n: { ladderNetExact: 486 } } };
    const as = regimeState(puts, { expectedSession: "2026-09-15" });
    const ag = as.drivers.find((d) => d.key === "aggressor");
    ok(ag && ag.vote === -1 && /nets 486 contracts to the put side/.test(ag.reading),
       `a ladder netting to the put side votes bearish and says so, signed from the bars rather than from the lead's absolute figure (${ag && ag.reading})`);
  }
  {
    const weak = JSON.parse(JSON.stringify(CARD));
    weak.panels.gamma.strikes = 12;
    weak.regime = { label: "long", crossings: 1, spotGammaShare: 0.1 };
    weak.panels.levels.levels = [{ kind: "zero_gamma", label: "Zero-gamma level", px: 71.6, distAtr: 0.97 }, { kind: "max_pain", label: "Max pain", px: 72.5, distAtr: 1.54 }];
    const wctx = buildContext(weak, { expectedSession: "2026-09-15" });
    eq(wctx.state.confidence, 0, "a marginal ladder near the flip on a thin profile is a state at confidence 0");
    const call = vetIdeas([{ title: "Upside", structure: "long call", direction: "bullish", thesis: "Dealer gamma is long at spot 70.22.",
      rests_on: ["gamma", "levels"], invalidation: "a close below 71.60", horizon: "10 sessions" }], wctx);
    ok(call.ideas.length === 1, "and a state the summary does not stand on does not refuse the model's structures either");
  }
  {
    const behind = JSON.parse(JSON.stringify(CARD));
    behind.panels.path.netPremium = 19251664;
    behind.panels.levels.levels = [
      { kind: "call_wall", label: "Call wall", px: 67, distAtr: -2.18 },
      { kind: "zero_gamma", label: "Zero-gamma level", px: 71.6, distAtr: 0.97 },
      { kind: "put_wall", label: "Put wall", px: 66, distAtr: -2.85 },
    ];
    const bs = regimeState(behind, { expectedSession: "2026-09-15" });
    ok(bs.state === "amplifying" && bs.flow === "bullish" && bs.bound === null && !bs.notes.some((n) => /lies between/.test(n)),
       "a wall behind spot is never 'between' spot and the flip, so the zone is unbounded rather than bounded at a flip the wall does not face");
  }
  {
    const vol = JSON.parse(JSON.stringify(CARD));
    vol.panels.levels.levels.push({ kind: "zero_gamma", label: "Zero-gamma level", px: 70.4, distAtr: 0.12 });
    vol.panels.path.persistence = 0.5;
    const vctx = buildContext(vol, { expectedSession: "2026-09-15" });
    const vi = stateIdea(vctx);
    ok(vctx.state.state === "transitional" && vi && vi.structure === "long strangle",
       `spot on the flip with no side prefers a long strangle (${vctx.state.state}, ${vi && vi.structure})`);
    ok(/pays if spot closes outside the priced range 67\.20 to 73\.24; it loses if spot holds inside it through the horizon/.test(vi.thesis) &&
       /^spot held inside the priced range 67\.20 to 73\.24 through the horizon$/.test(vi.invalidation),
       "and a long-volatility structure pays when spot leaves the range, never when it stays, with the invalidation written the same way round");
    ok(vetIdeas([vi], vctx).ideas.length === 1, "and that idea passes the guard, the range ends being figures the state sentence carries");
  }
  const pub = publicContext(ctx);
  ok(pub.state && pub.state.state === "squeeze" && pub.state.chip === st.chip && pub.state.word === STATE_WORD.squeeze &&
     Array.isArray(pub.state.drivers) && pub.state.drivers.every((d) => typeof d.reading === "string"),
     "the public context carries the state, its chip, its word and its drivers' readings for the page");
  ok(/8\. The line \[state\]/.test(promptForNeuron(ctx).system), "the prompt tells the model the state line is authoritative");

  const pinned = JSON.parse(JSON.stringify(CARD));
  pinned.regime = { label: "long", labelFrom: "book", crossings: 1, spotGammaShare: 0.6, bookGammaRaw: 4.1e5, bookShare: 0.6 };
  pinned.panels.levels.levels = [
    { kind: "max_pain", label: "Max pain", px: 70.5, distAtr: 0.19 },
    { kind: "zero_gamma", label: "Zero-gamma level", px: 66.1, distAtr: -2.78 },
    { kind: "call_wall", label: "Call wall", px: 72, distAtr: 1.2 },
  ];
  pinned.panels.calendar = { status: "ok", schedule: [{ expiry: "2026-09-18", days: 3, share: 0.4 }], frontLoad: 0.4, halfLifeExpiry: "2026-10-16", halfLifeDays: 31 };
  const ps = regimeState(pinned, { expectedSession: "2026-09-15" });
  ok(ps.state === "pinned" && ps.direction === null && ps.flow === "bearish" && ps.target && ps.target.kind === "max_pain",
     `long gamma at spot with max pain inside half an ATR is pinned, with no side of its own but the flow still named (${ps.chip})`);
  eq(ps.confidence, 2,
     "a strong book and a far flip cost nothing, and the grade tops out at fair: the walls and the ladder's " +
     "zero-crossing read off today's flow ladder, not the standing book, so a state resting on them is never robust");
  ok(ps.horizon.kind === "expiry" && ps.horizon.value === "2026-09-18", "the horizon is the front expiry when it carries a quarter of the book's gamma");
  ok(ps.invalidation.kind === "zero_gamma" && /Pinned · long gamma in the book, max pain 70\.50, flow bearish/.test(ps.chip), "the pin ends at the flip");
  assert.deepEqual(ps.preferred, STATE_STRUCTURES.pinned.fair.preferred, "and prefers the range structures"); checks++;

  const squeeze = JSON.parse(JSON.stringify(CARD));
  squeeze.regime = { label: "short", crossings: 1, spotGammaShare: -0.5 };
  squeeze.panels.path.netDelta = 90000;
  squeeze.panels.path.netPremium = 12000000;
  squeeze.panels.levels.levels = [
    { kind: "call_wall", label: "Call wall", px: 72, distAtr: 1.2 },
    { kind: "put_wall", label: "Put wall", px: 68, distAtr: -1.5 },
    { kind: "zero_gamma", label: "Zero-gamma level", px: 66.1, distAtr: -2.78 },
  ];
  const sq = regimeState(squeeze, { expectedSession: "2026-09-15" });
  ok(sq.state === "squeeze" && sq.direction === "bullish" && sq.target && sq.target.kind === "call_wall" && sq.target.px === 72,
     `short gamma with a one-sided buying tape and the call wall inside 1.5 ATR ahead, no flip between, is a squeeze toward that wall (${sq.chip})`);
  ok(sq.invalidation.kind === "put_wall", "invalidated past the put wall behind it");
  assert.deepEqual(sq.preferred, STATE_STRUCTURES.bull.fair.preferred, "and prefers the bull structures"); checks++;
  const between = JSON.parse(JSON.stringify(squeeze));
  between.panels.levels.levels[2] = { kind: "zero_gamma", label: "Zero-gamma level", px: 71, distAtr: 0.53 };
  const bt = regimeState(between, { expectedSession: "2026-09-15" });
  ok(bt.state === "amplifying" && bt.bound && bt.bound.px === 71 && /to the flip 71\.00/.test(bt.chip),
     "with the flip between spot and the wall the short-gamma zone ends at the flip, so it is amplifying bounded there, not a squeeze");
  const onFlip = JSON.parse(JSON.stringify(between));
  onFlip.panels.levels.levels[2].distAtr = 0.2;
  const tf = regimeState(onFlip, { expectedSession: "2026-09-15" });
  ok(tf.state === "transitional" && tf.invalidation.kind === "zero_gamma" && tf.preferred.includes("call debit spread") && !tf.preferred.includes("no position"),
       "spot inside half an ATR of the flip is transitional, leaning the way the flow votes, and a resolved lean drops the no-position placeholder that would contradict it");

  const bookOnly = JSON.parse(JSON.stringify(CARD));
  bookOnly.panels.gamma = { status: "unavailable", reason: "no ladder" };
  const bo = regimeState(bookOnly, { expectedSession: "2026-09-15" });
  ok(bo.state !== "undetermined" && bo.drivers.some((d) => d.key === "gamma" && /open-interest book is short/.test(d.reading)),
     "with the flow ladder unavailable the open-interest book alone still reads a state");
  const blind = JSON.parse(JSON.stringify(CARD));
  blind.panels.gamma = { status: "unavailable", reason: "no ladder" };
  blind.regime = { label: "short", crossings: 0 };
  const un = regimeState(blind, { expectedSession: "2026-09-15" });
  ok(un.state === "undetermined" && un.confidence === 0 && /gamma positioning is unavailable and premium is unreadable/.test(un.notes[0]),
     "no gamma and no readable premium implies no state, and the note says which silence it is");
  ok(stateIdea(buildContext(blind, { expectedSession: "2026-09-15" })) === null, "and an undetermined state writes no idea");
  blind.panels.pricedMove = { ...blind.panels.pricedMove, iv30: 0.5, rv30: 0.36, rvForward: 0.36, rvForwardGrade: 3, richnessFrom: "forward", vrpTrailing: 0.14, ivRank: 0.8 };
  const rich = regimeState(blind, { expectedSession: "2026-09-15" });
  ok(rich.state === "premium-rich" && rich.premium === "rich" && rich.confidence >= 1 && /positioning withheld/.test(rich.chip),
     "readable rich premium without positioning is a premium-rich state that says positioning is withheld");
  assert.deepEqual(rich.preferred, STATE_STRUCTURES["premium-rich"].preferred, "and prefers short-premium structures"); checks++;
  eq(rich.invalidation.kind, "priced_low", "invalidated at the priced range end on the side the flow leans");

  const pinnedCard = JSON.parse(JSON.stringify(CARD));
  pinnedCard.panels.pricedMove = { ...pinnedCard.panels.pricedMove, iv30: 0.033, rv30: 0.3727, rvForward: 0.3727, rvForwardGrade: 3, richnessFrom: "forward", vrpTrailing: -0.3397,
    ivRank: 0, ivMomentum: -0.249, richness: "event-pinned",
    pin: { signals: ["collapse", "floor", "ratio"], moveRatio: 0.089, weekAgoIv: 0.282, lastRange: 0.0021, rangeRatio: 0.09 } };
  const cheapCard = JSON.parse(JSON.stringify(pinnedCard));
  cheapCard.panels.pricedMove.richness = "cheap";
  delete cheapCard.panels.pricedMove.pin;
  const cheapSt = regimeState(cheapCard, { expectedSession: "2026-09-15" });
  const pinnedSt = regimeState(pinnedCard, { expectedSession: "2026-09-15" });
  eq(cheapSt.premium, "cheap", "unflagged, a 3.3% implied against 37.3% realised reads as cheap premium");
  eq(pinnedSt.premium, "pinned",
     "flagged as pinned by an event (WBD 2026-09-21), the same numbers read as a pin, not as cheap premium");
  ok(pinnedSt.drivers.filter((d) => d.axis === "premium").every((d) => d.vote === 0 && d.weight === 0),
     "and no premium driver votes — realised volatility that holds the deal's jump is not the yardstick");
  ok(!pinnedSt.preferred.includes("long straddle") && !pinnedSt.preferred.includes("long strangle") &&
     pinnedSt.avoid.includes("long straddle") && pinnedSt.avoid.includes("long strangle"),
     `a pinned name never prefers a long straddle or strangle, and rules both out (${pinnedSt.preferred.join(", ")})`);
  ok(pinnedSt.preferred.length > 0, "while still naming what it does prefer");

  const staleSt = regimeState(CARD, { expectedSession: "2026-09-16" });
  ok(staleSt.stale === true && staleSt.confidence <= 1 && /capped/.test(stateSentence(staleSt, "SYN1")),
     "a card behind the last closed session caps the state's confidence at weak and says so");
  ok(contextFingerprint(ctx) !== contextFingerprint(buildContext(squeeze, { expectedSession: "2026-09-15" })),
     "the fingerprint moves when the state moves, so a changed state is re-read");
  ok(STATE_LINES.FLIP_ON_ATR === 0.5 && STATE_LINES.WALL_NEAR_ATR === 1.5 && STATE_LINES.VRP_RELATIVE === 0.1,
     "the lines the states are cut at are published constants, not literals in the branches");
}

{
  const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures-variation-cards.json", import.meta.url), "utf8"));
  const B = fixtures.B;
  eq(B.regime.label, "short", "the live B card was published short, from the running sum below spot");
  ok(B.regime.netGamma > 0, `while the gamma it carries nets long (${B.regime.netGamma})`);
  const read = gammaReading(B);
  eq(read.label, "short", "the Neuron reads B's regime as the card labels it, short, and never swaps in the flow's sign (defect 5)");
  eq(read.from, "label", "attributed to the card's label, because this legacy card carries no number for it");
  ok(/which is flow and is not read as the book/.test(read.sentence), `while the flow's +161.6k is named as flow (${read.sentence})`);
  const bs = regimeState(B, { expectedSession: B.sessionDate });
  ok(bs.state !== "pinned" && !/long gamma/.test(bs.chip), `so B no longer reads Pinned, long gamma beside a card that says short (${bs.chip})`);
  eq(bs.gammaLabel, "short", "the state carries the label it read");
  const g = bs.drivers.find((d) => d.key === "gamma");
  ok(g && g.robustness === 1 && /without the number/.test(g.reading),
     `and the gamma driver is graded weak and says the number is missing (${g && g.reading})`);
  ok(/running sum below spot sits at \u221252%/.test(g.reading),
     "the running sum below spot is still published, as where the ladder sits rather than as the label");

  const opts = { probe: { call: "raw", put: "raw" }, kc: { status: "ok", value: 50, n: 326, iqrRatio: 0.22 },
    unit: { family: "share", used: "share" }, vannaScale: { status: "agree", ratio: 1, n: 5 } };
  const withVar = JSON.parse(JSON.stringify(B));
  withVar.panels.variation = variation(cardVariationInput(withVar), opts);
  const ctx = buildContext(withVar, { expectedSession: B.sessionDate });
  const f = ctx.features.find((x) => x.key === "variation");
  ok(f && f.status === "ok", "the Neuron context carries the hedging panel");
  eq(f.robustness, 1, "graded weak when only the gamma added today is on the card");
  ok(f.figures.gammaPerSigma === withVar.panels.variation.gammaPerSigma && f.figures.sigmaSource === "realized",
     "with its figures quotable");
  const hedge = ctx.state.drivers.filter((d) => d.axis === "hedge");
  ok(hedge.length >= 2 && hedge.every((d) => d.weight === 0), "the hedge drivers ride along at weight 0");
  const booked = JSON.parse(JSON.stringify(B));
  booked.regime.bookGammaRaw = 2e4;
  booked.panels.variation = variation(cardVariationInput(booked), opts);
  const bookedDrift = booked.panels.variation.variance && booked.panels.variation.variance.driftInSd;
  ok(bookedDrift !== null && Math.abs(bookedDrift) >= STATE_LINES.DRIFT_SD,
     `a booked copy of B carries a drift past the ${STATE_LINES.DRIFT_SD} sd line (${bookedDrift})`);
  const bookedHedge = buildContext(booked, { expectedSession: B.sessionDate }).state.drivers.filter((d) => d.axis === "hedge");
  ok(bookedHedge.length && bookedHedge.every((d) => d.weight === 0 && d.vote === 0),
     "and even past it the hedge drivers carry no vote: a reading that says 'no vote' must not hand the model a vote of ±1");
  ok(hedge.some((d) => d.key === "vanna" && /call \u2212 put/.test(d.reading)) && hedge.some((d) => d.key === "charm"),
     "vanna and charm are read netted, call \u2212 put");
  ok(!ctx.state.drivers.some((d) => /not netted/.test(d.reading)),
     "and the old 'not netted on this card' readings are gone");
  const sentence = stateSentence(ctx.state, "B");
  ok(/Hedging: time alone moves dealer hedges to buy \$2\.00M over the session/.test(sentence),
     `the state sentence gains a Hedging clause (${sentence.slice(sentence.indexOf("Hedging"), sentence.indexOf("Hedging") + 90)})`);

  const alternating = (n) => {
    const spot = 50 + n / 2 + 0.5;
    const strikes = Array.from({ length: n }, (_, i) => ({ strike: 50 + i, call_gamma_ask: i % 2 ? -9 : 10,
      call_gamma_bid: 0, put_gamma_ask: 0, put_gamma_bid: 0 }));
    const g = aggressorGamma(strikes, { spot });
    const card = buildCard({ ticker: "ALT", row: { close: String(spot) }, strikes, ticks: [], expiries: [],
      features: { spot, atr: 1.5, netGamma: g.netGamma, gammaGross: g.gross, gRegime: "long", gRegimeFrom: "flow", gammaFlip: g.flip },
      generatedAt: "2026-09-15T21:00:00Z", sessionDate: "2026-09-15" });
    return { card, read: gammaReading(card), state: regimeState(card, { expectedSession: "2026-09-15" }) };
  };
  const drawn = alternating(60), packed = alternating(120);
  ok(!drawn.card.panels.gamma.bucketed && packed.card.panels.gamma.bucketed,
     "a 60-strike ladder is drawn bar for bar and a 120-strike one is bucketed in pairs for display");
  near(drawn.read.strength, 30 / 570, 1e-12, "strikes alternating +10/−9 net 5% of the ladder's gross");
  near(packed.read.strength, drawn.read.strength, 1e-12,
       "and twice the ladder at the same per-strike share reads the same 5%, where the bucketed bars cancelled each pair into a 100% reading");
  eq(packed.state.confidence, drawn.state.confidence,
     `so display bucketing cannot lift the state's confidence across the idea gate (${drawn.state.confidence} and ${packed.state.confidence})`);
  const legacy = JSON.parse(JSON.stringify(packed.card));
  delete legacy.regime.flowGross;
  eq(gammaReading(legacy).strength, null,
     "a card published before the ladder's gross was carried reads no strength off bucketed bars, rather than an inflated one");

  const grade = (mutate) => {
    const c = JSON.parse(JSON.stringify(withVar));
    mutate(c);
    return buildContext(c, { expectedSession: B.sessionDate }).features.find((x) => x.key === "variation").robustness;
  };
  eq(grade((c) => { c.panels.variation.robustness = { r: 3, why: "all present" }; }), 3,
     "a panel with the book, a converged skewed t, a vol-of-vol and a charm scale grades robust");
  eq(grade((c) => { c.panels.variation = { status: "unavailable", reason: "no gamma" }; }), 0,
     "a silent panel is withheld");

  const vol = JSON.parse(JSON.stringify(CARD));
  vol.panels.pricedMove = { ...vol.panels.pricedMove, iv30: 0.576, rv30: 0.55, rvForward: 0.55, rvForwardGrade: 3, richnessFrom: "forward", vrpTrailing: 0.026, ivMomentum: 0.071 };
  const momentum = regimeState(vol, { expectedSession: "2026-09-15" }).drivers.find((d) => d.sub === "ivMomentum");
  ok(momentum && /rose 7\.1 points over the week/.test(momentum.reading) && !/month/.test(momentum.reading),
     `the one-week change is called a week (${momentum && momentum.reading})`);
  const hiVol = JSON.parse(JSON.stringify(vol));
  hiVol.panels.pricedMove.ivMomentum = 0.04;
  ok(!regimeState(hiVol, { expectedSession: "2026-09-15" }).drivers.some((d) => d.sub === "ivMomentum"),
     "four points on a 58-vol name is 7% of its level and does not fire");
  const loVol = JSON.parse(JSON.stringify(vol));
  loVol.panels.pricedMove = { ...loVol.panels.pricedMove, iv30: 0.2, rv30: 0.19, rvForward: 0.19, rvForwardGrade: 3, richnessFrom: "forward", vrpTrailing: 0.01, ivMomentum: 0.04 };
  ok(regimeState(loVol, { expectedSession: "2026-09-15" }).drivers.some((d) => d.sub === "ivMomentum"),
     "the same four points on a 20-vol name is 20% of its level and does: the line scales with the name");
  ok(STATE_LINES.IV_MOMENTUM_REL === 0.1 && STATE_LINES.TERM_FRONT_BID_REL === 0.08 && STATE_LINES.GARCH_GAP_REL === 0.12,
     "the three volatility lines are relative to the name's own level");

  const avg = JSON.parse(JSON.stringify(CARD));
  avg.panels.pricedMove = { ...avg.panels.pricedMove, iv30: 0.30, rv30: 0.25, rvForward: 0.25, rvForwardGrade: 3, richnessFrom: "forward", vrpTrailing: 0.05 };
  avg.panels.context.garch = { ...avg.panels.context.garch, nextVol: 29, avg21Vol: 25 };
  const gd = regimeState(avg, { expectedSession: "2026-09-15" }).drivers.find((d) => d.key === "garch");
  ok(gd && /average over the next 21 sessions is 25\.0%/.test(gd.reading) && gd.vote === 1,
     `30-day implied volatility is compared with the GARCH average over the same horizon, not the one-step level (${gd && gd.reading})`);
}

{
  const prov = (guard, llm = false) => neuronProvenance({ text: "x", llm, model: "m", guard });
  ok(/could not be parsed/.test(prov("ideas:unparsable")),
     "a reply the parser could not read is named as such in the provenance, never served as the model's wording");
  ok(/ideas without a summary/.test(prov("summary:empty")),
     "a parsed reply that lacked a summary is named as such, not as a model that answered with nothing");
  ok(/answered with nothing/.test(prov("unreachable:empty")), "which stays the wording for an empty transport reply");
  ok(/^Wording by m;/.test(prov("ideas:2 refused", true)),
     "and a model summary that survived the guard is attributed to the model whatever happened to its ideas");
  eq(neuronProvenance({ text: "x", llm: true, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }),
     "Wording by Llama 3.3 70B; figures measured by the pipeline.",
     "a Workers AI id is printed as the model's name, not as the vendor path a reader cannot parse");
  eq(modelName("@cf/qwen/qwen2.5-coder-32b-instruct"), "Qwen2.5 Coder 32B", "the humanised name keeps the size and drops the serving flags");
  eq(modelName(null), "a language model", "and no id at all is a language model");
  eq(prov("unreachable:allowance"), "Deterministic reading: the day’s free model allowance is spent, resetting 00:00 UTC.",
     "the writers store askFailure().why, so a spent allowance is named by that word and not only by the numeric code nothing writes");
  eq(prov("unreachable:capacity"), "Deterministic reading: the model had no capacity, and nothing was spent.",
     "a capacity refusal is named as one");
  eq(prov("unreachable:plan"), "Deterministic reading: the configured model is not available on this plan.",
     "and a plan fault as a configuration fault");
  ok(/allowance is spent/.test(prov("unreachable:3036")), "the numeric codes stay as aliases for rows written before the words");
  eq(prov("unreachable:length"), "Deterministic reading: the model spent its whole answer budget before writing any text.",
     "a reply cut off at the token cap with no content is told apart from a model that answered with nothing");
  eq(prov("unreachable:unreachable"), "Deterministic reading: the model did not answer.", "and an unstated failure keeps the plain wording");
  eq(prov("unreachable:reparse:capacity"),
     "Deterministic reading: the model’s reply carried no usable summary, and asking it again found no capacity.",
     "A REPARSE REFUSED FOR CAPACITY IS NAMED AS ONE, not frozen as the model's unparsable output: the first reply was billed, " +
     "so it never reads \"nothing was spent\"");
  ok(/allowance spent/.test(prov("unreachable:reparse:allowance")) && /asking it again failed\.$/.test(prov("unreachable:reparse:unreachable")),
     "and every other refusal of the second request keeps its own words");
  ok(retryableGuard("unreachable:reparse:capacity", 0) && retryableGuard("unreachable:reparse:unreachable", 0),
     "so the Neuron route re-reads the card after NEURON_RETRY_MS instead of serving a transient refusal until the next card");
}

{
  const pinned = JSON.parse(JSON.stringify(CARD));
  pinned.regime = { label: "long", crossings: 1, spotGammaShare: 0.6, labelFrom: "book", bookGamma: 1.2e8, bookShare: 0.6 };
  pinned.panels.levels.levels = [
    { kind: "max_pain", label: "Max pain", px: 70.5, distAtr: 0.19 },
    { kind: "zero_gamma", label: "Zero-gamma level", px: 66.1, distAtr: -2.78 },
    { kind: "call_wall", label: "Call wall", px: 72, distAtr: 1.2 },
  ];
  pinned.panels.calendar = { status: "ok", schedule: [{ expiry: "2026-09-18", days: 3, share: 0.4 }], frontLoad: 0.4, halfLifeExpiry: "2026-10-16", halfLifeDays: 31 };
  const pctx = buildContext(pinned, { expectedSession: "2026-09-15" });
  const pidea = stateIdea(pctx);
  eq(pidea.structure, "iron condor", "a pinned card's own idea is the first range structure, an iron condor");
  ok(/ An iron condor pays if spot stays inside the priced range, with the zero-gamma level at 66\.10 as the line that ends the state\.$/.test(pidea.thesis),
     `the article agrees with the structure and the neutral payoff names the flip as the line that ends the state (${pidea.thesis.slice(-110)})`);
  ok(!/ A iron condor|range against the/.test(pidea.thesis), "never 'A iron condor', never 'inside the priced range against the gamma flip'");
  eq(vetIdeas([pidea], pctx).ideas.length, 1, "and the reworded idea still passes the same vetting");
}

{
  const glm = "@cf/zai-org/glm-4.7-flash";
  const llama = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const env = { FLOWS_ASK_MODEL: glm, FLOWS_ASK_FALLBACK_MODEL: llama,
    FLOWS_ASK_NEURONS: "5500,36400", FLOWS_ASK_FALLBACK_NEURONS: "26668,204805" };
  const msgs = [{ role: "user", content: "x" }];

  const gIn = modelInput(glm, msgs, { maxTokens: 1024, temperature: 0.2 });
  same(gIn.chat_template_kwargs, { enable_thinking: false },
    "the reasoning model is asked NOT to think: on 09-22 every call spent the whole cap (29 of 31 at exactly 1024 tokens) inside its reasoning");
  ok(gIn.max_completion_tokens === 1024 && !("max_tokens" in gIn),
    "and its cap is max_completion_tokens, the field its schema documents, not the deprecated max_tokens");
  const lIn = modelInput(llama, msgs, { maxTokens: 1400, temperature: 0.05 });
  ok(lIn.max_tokens === 1400 && !("chat_template_kwargs" in lIn) && !("max_completion_tokens" in lIn),
    "the instruct fallback gets the classic text-generation input its own schema lists, and nothing it does not");

  const reasoningOnly = { choices: [{ finish_reason: "length", message: { content: null, reasoning_content: "Let me think about 42..." } }],
    usage: { prompt_tokens: 12500, completion_tokens: 1024 } };
  same(aiText(reasoningOnly), { text: null, finish: "length", reasoned: true },
    "a reply that is all reasoning and stopped at the cap is no text, with the stop and the reasoning named");
  eq(aiText({ choices: [{ finish_reason: "stop", message: { content: "Answer.", reasoning_content: "thought" } }] }).text, "Answer.",
    "content is the answer when there is some");
  same(aiText({ choices: [{ finish_reason: "length", message: { content: "<think>still going" } }] }),
    { text: null, finish: "length", reasoned: true }, "an unclosed inline think block is reasoning, never the answer");
  eq(aiText({ choices: [{ finish_reason: "stop", message: { content: "<think>a</think> Said." } }] }).text, "Said.",
    "and a closed one is cut off the answer");
  eq(aiText({ response: "Plain." }).text, "Plain.", "the classic `response` field still reads");
  eq(aiText(null).text, null, "and a missing reply is no text");

  const fake = (script) => {
    const calls = [];
    return { calls, run: async (model, input) => {
      calls.push({ model, input });
      const step = script[calls.length - 1];
      if (step instanceof Error) throw step;
      return step;
    } };
  };
  const billed = [];
  const onUsage = async (model, usage) => { billed.push([model, usage && usage.completion_tokens]); };

  const rescued = fake([reasoningOnly, { response: "Fallback wording.", usage: { prompt_tokens: 12500, completion_tokens: 40 } }]);
  const r1 = await askModels(rescued, aiChain(env), msgs, { maxTokens: 1024, temperature: 0.2 }, onUsage);
  eq(r1.text, "Fallback wording.", "an empty primary is retried once on the instruct fallback, whose text is served");
  eq(r1.model, llama, "and the row records the model that WROTE it, so the provenance names Llama 3.3 70B, not GLM");
  eq(modelName(r1.model), "Llama 3.3 70B", "which is how modelName() prints it");
  eq(r1.guard, null, "a rescued call carries no failure guard");
  same(billed, [[glm, 1024], [llama, 40]], "and BOTH calls are billed to the model that consumed them");
  same(rescued.calls.map((c) => c.model), [glm, llama], "in that order, the fallback exactly once");
  same(fallbackNote(r1), { from: glm, stop: "length", reasoned: true }, "the answer can say which model came back empty and why");

  const bothEmpty = fake([reasoningOnly, { response: "   " }]);
  eq((await askModels(bothEmpty, aiChain(env), msgs, {})).guard, "unreachable:length",
    "when neither writes text and one stopped at the cap the guard is unreachable:length, not unreachable:empty");
  const plainEmpty = fake([{ choices: [{ finish_reason: "stop", message: { content: "" } }] }, { response: "" }]);
  eq((await askModels(plainEmpty, aiChain(env), msgs, {})).guard, "unreachable:empty", "and an honest empty stays unreachable:empty");

  const spent = fake([new Error("AiError: 3036: account limit")]);
  const r2 = await askModels(spent, aiChain(env), msgs, {});
  ok(r2.guard === "unreachable:allowance" && r2.failure.why === "allowance" && spent.calls.length === 1,
    "a spent allowance is account-wide, so it is reported and the fallback is NOT asked to fail the same way");
  const busy = fake([reasoningOnly, new Error("AiError: 3040: capacity")]);
  const r3 = await askModels(busy, aiChain(env), msgs, {});
  ok(r3.guard === "unreachable:length" && r3.model === glm && r3.failure.why === "capacity",
    "A FALLBACK THAT FAILS AFTER A BILLED EMPTY PRIMARY STORES THE PRIMARY'S STOP, not its own failure: " +
    "unreachable:capacity is retried every cron tick, and each retry pays the primary's 1,024 thinking " +
    "tokens again — a fallback that kept failing spent 10,178 of the 10,000 daily neurons over 96 ticks " +
    "on one fingerprint in the review's day simulation; the failure itself still travels for the Ask note");
  const broke = fake([reasoningOnly, new Error("AiError: 5021: context window limit (24000)")]);
  eq((await askModels(broke, aiChain(env), msgs, {})).guard, "unreachable:length",
    "and so does a fallback that cannot take the prompt at all, a failure that never clears on retry");
  const plainThenBusy = fake([{ choices: [{ finish_reason: "stop", message: { content: "" } }] }, new Error("AiError: 3040: capacity")]);
  eq((await askModels(plainThenBusy, aiChain(env), msgs, {})).guard, "unreachable:empty",
    "a primary that stopped empty without hitting the cap is an unreachable:empty, which the same facts never retry");
  const spentAfter = fake([reasoningOnly, new Error("AiError: 3036: account limit")]);
  eq((await askModels(spentAfter, aiChain(env), msgs, {})).guard, "unreachable:allowance",
    "while a spent allowance keeps its own name: every retry of it fails at the primary for free");
  const honestEmpty = { choices: [{ finish_reason: "stop", message: { content: "" } }] };
  const cappedEmpty = { response: "", finish_reason: "length", usage: { prompt_tokens: 12500, completion_tokens: 1024 } };
  eq(emptyNote((await askModels(fake([reasoningOnly, { response: "" }]), aiChain(env), msgs, {})).attempts),
    "The model spent its whole answer budget before writing any text, and the fallback model asked after it answered with no text",
    "THE ASK NOTE NAMES EACH MODEL'S OWN STOP: a primary at the cap and a fallback that answered empty no longer read " +
    "\"and so did the fallback\", which blamed the fallback for a budget it never reached");
  eq(emptyNote((await askModels(fake([honestEmpty, cappedEmpty]), aiChain(env), msgs, {})).attempts),
    "The model answered with no text, and the fallback model asked after it spent its whole answer budget before writing any text",
    "and the reverse no longer blames the primary for the fallback's cap");
  eq(emptyNote((await askModels(fake([reasoningOnly, cappedEmpty]), aiChain(env), msgs, {})).attempts),
    "The model spent its whole answer budget before writing any text, and so did the fallback model asked after it",
    "two models at the cap keep the shared sentence");
  eq(emptyNote((await askModels(fake([honestEmpty, { response: "" }]), aiChain(env), msgs, {})).attempts),
    "The model answered with no text, and so did the fallback model asked after it", "and so do two honest empties");
  eq(emptyNote((await askModels(fake([reasoningOnly, new Error("AiError: 3040: capacity")]), aiChain(env), msgs, {})).attempts),
    "The model spent its whole answer budget before writing any text",
    "a fallback that failed to run is not described as a stop: the Ask note names its failure separately");
  ok(repliedGuard("invented") && repliedGuard("unreachable:length") && repliedGuard("unreachable:empty") &&
     !repliedGuard("unreachable:capacity") && !repliedGuard(null),
    "a guard written after a model replied (and was billed) is told apart from one written after a refusal to run");

  ok(retryableGuard("unreachable:allowance", 0) && retryableGuard("unreachable:capacity", 0),
    "a failure that genuinely returns is retried");
  ok(!retryableGuard("unreachable:empty", Infinity), "an empty on the same facts and configuration is not");
  ok(!retryableGuard("unreachable:length", AI_LENGTH_RETRY_MS - 1) && retryableGuard("unreachable:length", AI_LENGTH_RETRY_MS),
    "a length stop is retried, never frozen, but only after an hour so a model that keeps thinking cannot spend the day's allowance every tick");
  ok(!retryableGuard(null, Infinity) && !retryableGuard("invented", Infinity), "and a guard refusal is final");
  ok(intradayFloorMs(0, "unreachable:length") === AI_LENGTH_RETRY_MS && intradayFloorMs(0, "unreachable:empty") === AI_LENGTH_RETRY_MS,
    "THE ONE-HOUR FLOOR HOLDS WHEN ONLY THE INTRADAY READ TIME MOVED: the brief's alert fact carries its read time, so the summary " +
    "fingerprint changes every tick and a length or empty stop was re-asked of both models every 45 minutes, 9 asks and 3,960 " +
    "neurons over a 26-tick session in the review's simulation, against 7 asks and 3,080 at the hour");
  ok(intradayFloorMs(1, null) === AI_INTRADAY_REFRESH_MS && intradayFloorMs(0, "invented") === AI_INTRADAY_REFRESH_MS &&
     intradayFloorMs(0, "forecast") === AI_INTRADAY_REFRESH_MS && AI_INTRADAY_REFRESH_MS === 45 * 60 * 1000,
    "while a written summary, accepted or refused, keeps the 45-minute intraday refresh");

  same(aiChain({ FLOWS_ASK_MODEL: "", FLOWS_ASK_FALLBACK_MODEL: llama }), [],
    "no configured primary means no model at all: the fallback is a retry, not a replacement");
  same(aiChain({ FLOWS_ASK_MODEL: llama, FLOWS_ASK_FALLBACK_MODEL: llama }), [llama], "and a fallback equal to the primary is not asked twice");
  ok(aiCallSignature(env) !== aiCallSignature({ FLOWS_ASK_MODEL: glm }) && /^ai2\./.test(aiCallSignature(env)),
    "the call signature moves with the configuration, so an unreachable:empty stored under the old one is regenerated once, not frozen forever");

  ok(modelRates(env, glm).outPerM === 36400 && modelRates(env, llama).outPerM === 204805 && modelRates(env, "@cf/x/y") === null,
    "each model is billed at its own published rate, and an unconfigured one at none");
  const s1 = spendShape(env, "2026-09-22", 33, 413240, 32536,
    [{ model: glm, calls: 1, tokensIn: 12500, tokensOut: 20 }, { model: llama, calls: 1, tokensIn: 12500, tokensOut: 20 }]);
  eq(s1.neurons, Math.ceil(((413240 - 25000) * 5500 + (32536 - 40) * 36400 + 12500 * 5500 + 20 * 36400 + 12500 * 26668 + 20 * 204805) / 1e6),
    "the day's neurons are each model's tokens at its own rate, with calls recorded before the split billed at the primary's, the only model called then");
  eq(s1.byModel[1].neurons, Math.ceil((12500 * 26668 + 20 * 204805) / 1e6), "and the split is published per model");
  eq(spendShape(env, "d", 1, 10, 10, [{ model: "@cf/old/model", calls: 1, tokensIn: 10, tokensOut: 10 }]).neurons, null,
    "a model with no configured rate makes the day's spend unknown rather than a guess");
  eq(spendShape(env, "d", 0, 0, 0, null).neurons, null, "and so does a split that could not be read");
  eq(spendShape(env, "d", 0, 0, 0, []).neurons, 0, "while a day with no calls is a measured zero");

  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  ok(/FLOWS_ASK_FALLBACK_MODEL = "@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast"/.test(toml) &&
     /FLOWS_ASK_FALLBACK_NEURONS = "26668,204805"/.test(toml),
    "the fallback is a non-reasoning instruct model configured beside its published neuron rate");
  const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  eq((worker.match(/env\.AI\.run\(/g) || []).length, 0,
    "no call site reaches the binding directly: all three go through askModels, so none can drop the thinking switch or the fallback");
  eq((worker.match(/askModels\(env\.AI/g) || []).length, 4, "and all four call sites (summary, Neuron, Neuron over the engine, Ask) use it");
  ok(!/max_tokens/.test(worker), "the worker no longer carries a max_tokens literal of its own");
  ok(/if \(attempt > 0\) \{\s*if \(said\.failure\) refused = "unreachable:reparse:" \+ said\.failure\.why;\s*break;/.test(worker) &&
     /verdict\.ok \? "ideas:unparsable" : refused \|\| "ideas:unparsable"/.test(worker) &&
     /guard = refused \|\| "summary:empty";/.test(worker),
    "NEURON KEEPS A THROWN REPARSE AS A RETRYABLE GUARD: a capacity blip on the second request used to write ideas:unparsable " +
    "or summary:empty, which the same card never retries, where origin/main retried the same failure after five minutes");
  ok((worker.match(/emptyNote\(said\.attempts\)/g) || []).length === 2 && !/so did the fallback model asked after it/.test(worker),
    "both Ask notes about an empty reply are built from emptyNote over the attempts, not from the chain's combined guard");
  ok(/const meter = afterCall \|\| base\.spend;/.test(worker) && /meter\.remaining > 0/.test(worker) &&
     /spend: meter, note: say/.test(worker) && !/spend\.remaining > 0/.test(worker),
    "THE ALLOWANCE NOTE READS THE METER AFTER THE PRIMARY'S BILLED CALL: with 99 credits left, a primary at the cap that " +
    "used them and a fallback refused for the allowance read \"still showed 99 of 10,000 unspent, which means something " +
    "other than this site drew on the same account\" beside a meter at 0, blaming another spender for this site's own call");
  ok(/sameCall && \(prior\.llm \|\| repliedGuard\(prior\.guard\)\) && intradayOnly/.test(worker),
    "THE INTRADAY SUMMARY THROTTLE COVERS EVERY BILLED REPLY, not only an accepted one: with the fallback " +
    "writing, a refused summary on facts that move every tick cost 13,021 neurons over a 26-tick session in " +
    "the review's simulation, against 4,507 when the text was accepted and the 45-minute throttle held");
  ok(/ageMs < intradayFloorMs\(prior\.llm, prior\.guard\)\) return;/.test(worker) && !/ageMs < 45 \* 60 \* 1000/.test(worker),
    "and the worker's intraday throttle takes its floor from intradayFloorMs, not a literal of its own");
  ok(/prior\.fingerprint\.endsWith\("\|" \+ signature\)/.test(worker),
    "and a change of model configuration still regenerates on the next tick, throttle or not");
}

{
  eq(NEURON_CONTEXT_VERSION, 3, "the context protocol is version 3: numbered engine facts and priced structures");
  const leg = (type, k, side, qty = 1) => ({ type, k, side, qty });
  const st = (id, family, risk, dir, legs, grade, rules, prob, ev, maxProfit, maxLoss) => ({
    id, family, risk, dir, expiry: "2026-10-16", dte: 30, sessions: 22, legs, grade, gradeWhy: grade < 3 ? ["fit.in-spread"] : [],
    rules, prob: { popQ: prob[0], popP: prob[1] }, ev: { q: ev[0], p: ev[1], edge: ev[1] - ev[0] }, maxProfit, maxLoss,
    profitUnbounded: false, lossUnbounded: risk === "undefined", score: grade / 10,
  });
  const ENGINE = {
    v: 1, engine: "q1", asOf: "2026-09-15T20:00:00.000Z", spot: 100, atr: 2.5,
    facts: [
      { id: "iv.cm.30", v: 0.32, u: "vol", g: 3 },
      { id: "iv.cm.90", v: 0.29, u: "vol", g: 2 },
      { id: "iv.pct.30", v: 0.82, u: "frac", g: 2 },
      { id: "garch.avg.21", v: 0.27, u: "vol", g: 3 },
      { id: "vrp.rel.21", v: 0.18, u: "frac", g: 3 },
      { id: "vrp.var.21", v: 0.0295, u: "var", g: 3 },
      { id: "skew.rr25.30.pct", v: 0.9, u: "frac", g: 2, x: true },
      { id: "term.front.7_30", v: 0.02, u: "frac", g: 2 },
      { id: "level.putWall", v: 95, u: "px", g: 3, atr: -2 },
      { id: "level.callWall", v: 105, u: "px", g: 3, atr: 2 },
      { id: "level.flip", v: 97, u: "px", g: 3, atr: -1.2 },
      { id: "level.magnet", v: 100.5, u: "px", g: 2, atr: 0.2 },
      { id: "level.maxPain", v: 104.9, u: "px", g: 2, atr: 1.96 },
      { id: "gex.book", v: 1.2e6, u: "usdPer1pct", g: 3 },
      { id: "move.event.ratio", v: null, u: "ratio", g: 0, why: "event.none" },
      { id: "iv.mom.5", v: -0.012, u: "vol", g: 1 },
    ],
    state: { state: "pinned", direction: null, confidence: 2, premium: "rich",
      preferred: ["iron condor", "call credit spread", "put credit spread"], avoid: ["long straddle", "long strangle", "long call", "long put"] },
    levels: { callWall: 105, putWall: 95, magnet: 100.5, flip: 97, maxPain: 104.9 },
    structures: [
      st("S1", "put-credit-spread", "defined", "bull", [leg("P", 95, -1), leg("P", 90, 1)], 3, ["state.pinned", "vrp.rich", "iv.high"],
        [0.72, 0.78], [-3, 21], 140, -360),
      st("S2", "iron-condor", "defined", "neutral", [leg("P", 95, -1), leg("P", 90, 1), leg("C", 105, -1), leg("C", 110, 1)], 2,
        ["state.pinned", "vrp.rich"], [0.55, 0.61], [-6, 18], 210, -290),
      st("S3", "short-strangle", "undefined", "neutral", [leg("P", 92, -1), leg("C", 108, -1)], 3, ["vrp.rich", "iv.high"],
        [0.8, 0.84], [-2, 30], 260, null),
      st("S4", "long-straddle", "defined", "neutral", [leg("P", 100, 1), leg("C", 100, 1)], 1, ["vrp.rich−"],
        [0.31, 0.28], [-8, -40], null, -780),
      st("S5", "long-calendar", "defined", "neutral", [leg("C", 100, -1), leg("C", 100, 1)], 2, ["term.backwardation"],
        [0.46, 0.5], [2, 9], 300, -250),
    ],
    ideas: ["S1", "S2", "S5"], noTrade: null, priced: 24, families: [],
  };
  const ecard = JSON.parse(JSON.stringify(CARD));
  ecard.engine = ENGINE;
  const ectx = buildContext(ecard, { expectedSession: "2026-09-15" });
  ok(ectx.engine && ectx.engine.facts.length === ENGINE.facts.length && ectx.engine.structures.length === 5,
     "a card with an engine block gives the context every numbered fact and the five published structures");
  same(ectx.engine.ideas, ["S1", "S2", "S5"], "and the engine's own ranking, by id");
  const eLines = contextLines(ectx);
  ok(eLines.some((l) => /^\s+vrp\.rel\.21 = 0\.18 frac \(g 3\)$/.test(l)),
     "each fact is one line as id = value unit (grade), so the model copies ids and never needs to compute");
  ok(eLines.some((l) => /^\s+S1 put-credit-spread defined 2026-10-16 −P95 \+P90: popQ 0\.72, popP 0\.78/.test(l)),
     "each structure is one line with its legs, both chances of profit and its grade");
  ok(/\.e5$/.test(contextFingerprint(ectx)), "the fingerprint moves with the engine's structures");
  ok(engineContext(CARD) === null && !/\.e\d+$/.test(contextFingerprint(buildContext(CARD, { expectedSession: "2026-09-15" }))),
     "a card without an engine block has no engine context and keeps the plain fingerprint");
  ok(engineContext({ ...CARD, engine: { status: "split", key: "card-x:SYN1", bytes: 40000 } }) === null,
     "an unresolved card-x pointer is not an engine: the Worker merges it or the reader goes without");

  const { system, user } = promptForEngine(ectx);
  ok(/NO digits anywhere except inside the ids/.test(system) && VERDICTS.every((v) => system.includes(v)) &&
     CLAIM_RELS.every((r) => system.includes(r)),
     "the engine prompt allows digits only inside copied ids and names every verdict code and relation");
  ok(user.includes("S1 put-credit-spread") && user.includes("vrp.rel.21 = 0.18"), "and hands the model the facts and structures");
  same(parseEngineOutput("```json\n{\"verdict\":\"stand-aside\"}\n```"), { verdict: "stand-aside" }, "a fenced JSON reply parses");
  eq(parseEngineOutput("no json here"), null, "and prose is not a reply");

  const good = { verdict: "harvest-rich-premium",
    claims: [{ a: "iv.cm.30", rel: "gt", b: "garch.avg.21" }, { a: "spot", rel: "between", b: "level.putWall", c: "level.callWall" },
      { a: "vrp.rel.21", rel: "rich" }, { a: "level.magnet", rel: "near", b: "spot" }, { a: "iv.mom.5", rel: "falling" }],
    ideas: [{ structure: "S2", verdict: "pin-at-level", because: ["level.magnet", "gex.book"] },
      { structure: "S1", verdict: "harvest-rich-premium", because: ["vrp.rel.21", "iv.pct.30"] }] };
  const v = vetEngineReply(good, ectx);
  ok(v.ok && v.refused.length === 0, `a reply of ids, codes and true claims is accepted whole (${JSON.stringify(v.refused)})`);
  same(v.ideas.map((i) => [i.structure, i.verdict, i.grade, i.from]), [["S2", "pin-at-level", 2, "model"], ["S1", "harvest-rich-premium", 2, "model"]],
       "each idea keeps its structure and verdict, ranked no higher than its weakest fact or its own grade");
  eq(v.claims.length, 5, "and every true claim is kept");
  eq(v.verdict, "harvest-rich-premium", "with the overall verdict, because a kept structure satisfies it");

  const code = (reply) => vetEngineReply(reply, ectx).refused.map((r) => r.code);
  same(code({ ideas: [{ structure: "S1", verdict: "harvest-rich-premium", because: ["vrp.rel.21", "iv.pct.30"], note: "sells 95 puts" }] }),
       ["digit"], "a digit outside a copied id refuses the whole reply: the model does not write numbers");
  same(code({ verdict: "stand-aside", confidence: 3 }), ["digit"], "so does a bare number in any field");
  same(code({ ideas: [{ structure: "S9", because: ["vrp.rel.21", "iv.pct.30"] }] }), ["unknown-id"],
       "an unknown structure id is refused as unknown, not as a digit: digits are allowed inside id fields and checked there");
  same(code({ ideas: [{ structure: "S1", because: ["vrp.rel.21", "vol.of.vol"] }] }), ["unknown-id"], "so is an unknown fact id in because");
  same(code({ ideas: [{ structure: "S1", because: ["vrp.rel.21", "move.event.ratio"] }] }), ["withheld"],
       "a because that leans on a withheld fact is refused as withheld");
  same(code({ ideas: [{ structure: "S4", because: ["vrp.rel.21", "iv.pct.30"] }] }), ["avoid"],
       "a structure whose family the state avoids is refused");
  {
    const zero = JSON.parse(JSON.stringify(ecard));
    zero.engine.structures[1].grade = 0;
    const zctx = buildContext(zero, { expectedSession: "2026-09-15" });
    same(vetEngineReply({ ideas: [{ structure: "S2", verdict: "pin-at-level", because: ["level.magnet", "gex.book"] }] }, zctx).refused.map((r) => r.code),
      ["withheld"], "an idea on a structure the engine graded 0 (a leg failed the liquidity gate, or no model) is refused as withheld, not kept at grade 0");
  }
  same(code({ ideas: [{ structure: "S3", because: ["vrp.rel.21", "iv.pct.30"] }] }), ["undefined-first"],
       "an undefined-risk first idea is refused while a defined-risk structure is listed");
  same(code({ ideas: [{ structure: "S5", verdict: "buy-cheap-convexity", because: ["vrp.rel.21", "term.front.7_30"] }] }),
       ["verdict-false"], "a verdict whose preconditions fail on the facts is refused: premium is rich, not cheap");
  same(code({ ideas: [{ structure: "S1", because: ["vrp.rel.21", "iv.pct.30"] }, { structure: "S1", because: ["vrp.rel.21", "iv.pct.30"] }] }),
       ["dup"], "a repeated structure is refused");
  same(code({ claims: [{ a: "iv.cm.30", rel: "lt", b: "garch.avg.21" }] }), ["claim-false"],
       "a false comparison is refused after the server evaluates it on the facts");
  same(code({ claims: [{ a: "iv.cm.30", rel: "gt", b: "level.flip" }] }), ["claim-false"], "so is a comparison across units");
  same(code({ claims: [{ a: "level.maxPain", rel: "near", b: "spot" }] }), ["claim-false"],
       "near is half an ATR for prices, so max pain 1.96 ATR away is not near");
  same(code({ claims: [{ a: "iv.pct.30", rel: "cheap" }] }), ["claim-false"], "a percentile at 0.82 is not cheap");
  same(code({ verdict: "event-overpriced" }), ["verdict-false"], "an event verdict with no event ratio is refused");
  same(code({ verdict: "sell-fast" }), ["schema"], "an unknown verdict code is a schema refusal");
  same(code({ ideas: "S1" }), ["schema"], "and a reply of the wrong shape is refused as schema");
  ok(VET_CODES.every((c) => typeof c === "string") && ["schema", "digit", "unknown-id", "avoid", "verdict-false", "claim-false",
    "withheld", "undefined-first", "dup"].every((c) => VET_CODES.includes(c)), "every refusal code is published");
  ok(!vetEngineReply({ ideas: [{ structure: "S4", because: ["vrp.rel.21", "iv.pct.30"] }] }, ectx).ok,
     "a reply whose every idea is refused is not ok, so the Worker falls back to the engine ranking");

  ok(verdictHolds("pin-at-level", ENGINE.structures[1] && { ...ectx.engine.structures[1] }, ectx.engine),
     "pin-at-level holds for the condor: the state is pinned and a short strike sits within half an ATR of the magnet");
  ok(verdictHolds("fade-to-wall", ectx.engine.structures[0], ectx.engine),
     "fade-to-wall holds for the put credit spread: its short 95 is at the put wall, between it and spot");
  ok(!verdictHolds("fade-to-wall", ectx.engine.structures[1], ectx.engine), "and never for a family that is not a credit spread");
  ok(verdictHolds("sell-skew", null, ectx.engine) === false, "a structure verdict needs its structure");
  ok(claimHolds({ a: "spot", rel: "gt", b: "level.flip" }, ectx.engine).ok, "spot is a price fact for claims");

  const fb = engineFallback(ectx);
  same(fb.ideas.map((i) => i.structure), ENGINE.ideas.slice(0, 3),
       "with no model, the deterministic path is exactly the engine's ranking");
  ok(fb.ideas.every((i) => i.from === "engine" && i.because.length === 2 && i.grade <= 3), "each idea marked as the engine's, resting on two facts");
  ok(fb.ideas.every((i) => i.verdict === null || verdictHolds(i.verdict, ectx.engine.structures.find((x) => x.id === i.structure), ectx.engine)),
     "and every verdict it attaches is one whose preconditions hold");
  eq(fb.ideas[0].verdict, "harvest-rich-premium", "the put credit spread reads as harvesting rich premium");
  same(fb.ideas[0].because, ["vrp.rel.21", "level.magnet"],
       "and rests on the facts with the largest affinity contribution: rich VRP at grade 3 adds 2, the pinned state at " +
       "confidence 2 adds 4/3 and comes before the IV percentile's equal 4/3 in rule order");
  const asReply = { verdict: fb.verdict, ideas: fb.ideas.map(({ structure, verdict, because }) => ({ structure, verdict, because })) };
  const fv = vetEngineReply(asReply, ectx);
  ok(fv.ok && fv.refused.length === 0, `the fallback, written as a model would write it, passes the same vetting (${JSON.stringify(fv.refused)})`);
  const aside = JSON.parse(JSON.stringify(ecard));
  aside.engine.ideas = []; aside.engine.noTrade = { code: "no-edge", closest: "S2" };
  const w = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  ok(/if \(ctx\.engine\) return generateEngineNeuron\(/.test(w) && /FLOWS_NEURON\.engineFallback\(ctx\)/.test(w) &&
     /FLOWS_NEURON\.vetEngineReply\(parsed, ctx\)/.test(w) && /\{ v: 3, verdict: res\.verdict, claims: res\.claims, ideas: res\.ideas, refused: res\.refused \}/.test(w),
     "the Worker takes the engine path whenever the card carries an engine, vets the reply, and stores the protocol-3 object " +
     "with the engine ranking whenever no model answers or every answer is refused");
  const af = engineFallback(buildContext(aside, { expectedSession: "2026-09-15" }));
  ok(af.verdict === "stand-aside" && af.ideas.length === 0, "an engine that stands aside falls back to stand-aside with no ideas");
  ok(Object.keys(VERDICT_WORD).length === VERDICTS.length, "every verdict code has a word for the page");
}

console.log(`✓ flows-neuron: ${checks} assertions — a context that carries every registry panel plus the ` +
  "standing and the volatility model, each graded 0 to 3 from the card's own coverage and quality fields " +
  "and capped at weak when the card is behind the last closed session; one line per feature so the model " +
  "is told what it cannot lean on; a prompt that keeps the guard's two rules and names the verbs it " +
  "refuses; ideas parsed from JSON and vetted one by one — two known features at least, none withheld, " +
  "a listed structure, every figure quoted, no claim about what happens next — and ranked by their " +
  "weakest leg; a greeks-implied state (pinned, amplifying, squeeze, on the flip, premium rich or cheap, " +
  "undetermined) read from positioning, flow votes and premium, with the structures it prefers and rules out, " +
  "its own vetted idea first, and the assistant's selector reaching the same facts for the page's own name; and protocol 3, " +
  "where the engine's numbered facts and priced structures are the only numbers and the model returns ids, verdict codes and " +
  "relation claims — digits, unknown ids, withheld facts, avoided families, false verdicts, false claims, an undefined-risk " +
  "first idea and repeats each refused under their own code, and with no model the engine's own ranking");
