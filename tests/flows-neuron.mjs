import assert from "node:assert/strict";
import { buildContext, contextLines, contextFacts, promptForNeuron, parseNeuronOutput, vetIdeas,
         deterministicSummary, contextFingerprint, publicContext, guardFacts, numeralsOf,
         regimeState, stateIdea, stateSentence, stateChip, STATES, STATE_STRUCTURES, STATE_LINES, STATE_WORD,
         NEURON_CONTEXT_VERSION, NEURON_MAX_IDEAS, NEURON_STRUCTURES } from "../shared/flows-neuron.js";
import { TICKER_PANELS, SENTINEL_KEYS } from "../shared/flows-panels.js";
import { guardAnswer, selectFacts, buildFactIndex } from "../shared/flows-ask.js";
import { neuronProvenance } from "../shared/flows-pages.js";

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
      levels: [{ kind: "put_wall", label: "Put wall", px: 70, distPct: -0.003, distAtr: 0.15 },
        { kind: "max_pain", label: "Max pain", px: 72.5, distPct: 0.032, distAtr: 1.54 },
        { kind: "call_wall", label: "Call wall", px: 67, distPct: -0.046, distAtr: 2.18 }],
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
  ok(/^n2\./.test(fp), "the fingerprint carries the protocol version, now 2 for the state line");
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
  ok(/^The greeks imply an amplifying state for SYN1 with flow bearish/.test(plain),
     "and leads with the implied state, then the most robust features' own sentences");
  ok(plain.includes("Dealer gamma for SYN1"), "which follow it");
  const staleCtx = buildContext(CARD, { expectedSession: "2026-09-16" });
  const stalePlain = deterministicSummary(staleCtx);
  ok(/capped at weak/.test(stalePlain) && stalePlain.includes("Dealer gamma for SYN1"),
     "a stale card's fallback names the cap and still quotes the readings, instead of claiming the card publishes none");
  ok(guardAnswer(stalePlain, guardFacts(staleCtx), { smallIntegers: false }).ok, "and passes the guard too");
}

{
  const ctx = buildContext(CARD, { expectedSession: "2026-09-15" });
  const st = ctx.state;
  ok(STATES.includes(st.state) && st.state === "amplifying" && st.direction === "bearish" && st.flow === "bearish",
     `short gamma at spot with a one-sided selling tape and no wall ahead is an amplifying state with flow bearish (${st.chip})`);
  eq(st.confidence, 2, "confidence starts at the positioning grade and loses one because the spot share of the ladder is unpublished");
  ok(st.invalidation && st.invalidation.kind === "put_wall" && st.invalidation.px === 70,
     "the state ends past the nearest level on the other side of the flow");
  ok(st.horizon && st.horizon.kind === "priced_sessions" && st.horizon.value === 10, "and runs over the priced-move window");
  assert.deepEqual(st.preferred, STATE_STRUCTURES.bear.fair.preferred, "a bearish amplifying state with unreadable premium prefers the fair bear structures"); checks++;
  ok(st.avoid.includes("put credit spread") && st.avoid.includes("iron condor"), "and rules out the structures that pay against it");
  ok(st.drivers.some((d) => d.key === "path" && d.vote === -1) && st.drivers.some((d) => d.key === "standing" && d.weight === 1),
     "the tape votes with its full grade and the card's own score is a tie-breaker of weight one, since it is built from the same tape");
  const feat = ctx.features.find((f) => f.key === "state");
  ok(feat && feat.status === "ok" && feat.robustness === 2 && /read from gamma, path, standing/.test(feat.why),
     "the state is a feature graded by its confidence, its reason naming the drivers");
  ok(/^IMPLIED STATE for SYN1: amplifying, flow bearish \(confidence 2 of 3\)\./.test(feat.say) && /Avoid: iron condor/.test(feat.say),
     "its reading opens with the state and closes with the structures it prefers and rules out");
  eq(feat.say, stateSentence(st, "SYN1"), "and is the state sentence itself");
  eq(st.chip, stateChip(st), "the chip is derived from the same object");
  ok(guardAnswer(feat.say, guardFacts(ctx), { smallIntegers: false }).ok, "the state sentence passes the guard by construction");
  const idea = stateIdea(ctx);
  ok(idea && idea.fromState === true && idea.structure === st.preferred[0] && idea.direction === "bearish",
     "the state writes its own idea in the first preferred structure with the state's direction");
  ok(idea.rests_on[0] === "state" && idea.rests_on.includes("gamma") && idea.rests_on.includes("path") && !idea.rests_on.includes("standing"),
     "resting on the state, its positioning and the tape that voted, never on the tie-breaker when the tape voted");
  const own = vetIdeas([idea], ctx);
  ok(own.ideas.length === 1 && own.refused.length === 0 && own.ideas[0].robustness === 2 && own.ideas[0].fromState === true,
     "and that idea passes the same vetting the model's ideas pass, graded by its weakest leg");
  ok(/pays if spot holds below the put wall at 70\.00/.test(idea.thesis) && /^a close above the put wall at 70\.00$/.test(idea.invalidation),
     "with a conditional payoff and an invalidation at the level the state ends at");
  const v = vetIdeas([idea, { ...idea, title: "Model twin", fromState: false }], ctx);
  ok(v.ideas.length === 1 && v.ideas[0].fromState === true, "the state's idea outranks a model idea it ties with");
  const pub = publicContext(ctx);
  ok(pub.state && pub.state.state === "amplifying" && pub.state.chip === st.chip && pub.state.word === STATE_WORD.amplifying &&
     Array.isArray(pub.state.drivers) && pub.state.drivers.every((d) => typeof d.reading === "string"),
     "the public context carries the state, its chip, its word and its drivers' readings for the page");
  ok(/8\. The line \[state\]/.test(promptForNeuron(ctx).system), "the prompt tells the model the state line is authoritative");

  const pinned = JSON.parse(JSON.stringify(CARD));
  pinned.regime = { label: "long", crossings: 1, spotGammaShare: 0.6 };
  pinned.panels.levels.levels = [
    { kind: "max_pain", label: "Max pain", px: 70.5, distAtr: 0.19 },
    { kind: "gamma_flip", label: "Gamma flip", px: 66.1, distAtr: -2.78 },
    { kind: "call_wall", label: "Call wall", px: 72, distAtr: 1.2 },
  ];
  pinned.panels.calendar = { status: "ok", schedule: [{ expiry: "2026-09-18", days: 3, share: 0.4 }], frontLoad: 0.4, halfLifeExpiry: "2026-10-16", halfLifeDays: 31 };
  const ps = regimeState(pinned, { expectedSession: "2026-09-15" });
  ok(ps.state === "pinned" && ps.direction === null && ps.flow === "bearish" && ps.target && ps.target.kind === "max_pain",
     `long gamma at spot with max pain inside half an ATR is pinned, with no side of its own but the flow still named (${ps.chip})`);
  eq(ps.confidence, 3, "a strong share and a far flip cost nothing");
  ok(ps.horizon.kind === "expiry" && ps.horizon.value === "2026-09-18", "the horizon is the front expiry when it carries a quarter of the book's gamma");
  ok(ps.invalidation.kind === "gamma_flip" && /Pinned · long gamma at spot, max pain 70\.50, flow bearish/.test(ps.chip), "the pin ends at the flip");
  assert.deepEqual(ps.preferred, STATE_STRUCTURES.pinned.fair.preferred, "and prefers the range structures"); checks++;

  const squeeze = JSON.parse(JSON.stringify(CARD));
  squeeze.regime = { label: "short", crossings: 1, spotGammaShare: -0.5 };
  squeeze.panels.path.netDelta = 90000;
  squeeze.panels.path.netPremium = 12000000;
  squeeze.panels.levels.levels = [
    { kind: "call_wall", label: "Call wall", px: 72, distAtr: 1.2 },
    { kind: "put_wall", label: "Put wall", px: 68, distAtr: -1.5 },
    { kind: "gamma_flip", label: "Gamma flip", px: 66.1, distAtr: -2.78 },
  ];
  const sq = regimeState(squeeze, { expectedSession: "2026-09-15" });
  ok(sq.state === "squeeze" && sq.direction === "bullish" && sq.target && sq.target.kind === "call_wall" && sq.target.px === 72,
     `short gamma with a one-sided buying tape and the call wall inside 1.5 ATR ahead, no flip between, is a squeeze toward that wall (${sq.chip})`);
  ok(sq.invalidation.kind === "put_wall", "invalidated past the put wall behind it");
  assert.deepEqual(sq.preferred, STATE_STRUCTURES.bull.fair.preferred, "and prefers the bull structures"); checks++;
  const between = JSON.parse(JSON.stringify(squeeze));
  between.panels.levels.levels[2] = { kind: "gamma_flip", label: "Gamma flip", px: 71, distAtr: 0.53 };
  const bt = regimeState(between, { expectedSession: "2026-09-15" });
  ok(bt.state === "amplifying" && bt.bound && bt.bound.px === 71 && /to the flip 71\.00/.test(bt.chip),
     "with the flip between spot and the wall the short-gamma zone ends at the flip, so it is amplifying bounded there, not a squeeze");
  const onFlip = JSON.parse(JSON.stringify(between));
  onFlip.panels.levels.levels[2].distAtr = 0.2;
  const tf = regimeState(onFlip, { expectedSession: "2026-09-15" });
  ok(tf.state === "transitional" && tf.invalidation.kind === "gamma_flip" && tf.preferred.includes("call debit spread"),
     "spot inside half an ATR of the flip is transitional, leaning the way the flow votes");

  const blind = JSON.parse(JSON.stringify(CARD));
  blind.panels.gamma = { status: "unavailable", reason: "no ladder" };
  const un = regimeState(blind, { expectedSession: "2026-09-15" });
  ok(un.state === "undetermined" && un.confidence === 0 && /gamma positioning is unavailable and premium is unreadable/.test(un.notes[0]),
     "no gamma and no readable premium implies no state, and the note says which silence it is");
  ok(stateIdea(buildContext(blind, { expectedSession: "2026-09-15" })) === null, "and an undetermined state writes no idea");
  blind.panels.pricedMove = { ...blind.panels.pricedMove, iv30: 0.5, rv30: 0.36, vrp: 0.14, ivRank: 0.8 };
  const rich = regimeState(blind, { expectedSession: "2026-09-15" });
  ok(rich.state === "premium-rich" && rich.premium === "rich" && rich.confidence >= 1 && /positioning withheld/.test(rich.chip),
     "readable rich premium without positioning is a premium-rich state that says positioning is withheld");
  assert.deepEqual(rich.preferred, STATE_STRUCTURES["premium-rich"].preferred, "and prefers short-premium structures"); checks++;
  eq(rich.invalidation.kind, "priced_low", "invalidated at the priced range end on the side the flow leans");

  const staleSt = regimeState(CARD, { expectedSession: "2026-09-16" });
  ok(staleSt.stale === true && staleSt.confidence <= 1 && /capped/.test(stateSentence(staleSt, "SYN1")),
     "a card behind the last closed session caps the state's confidence at weak and says so");
  ok(contextFingerprint(ctx) !== contextFingerprint(buildContext(squeeze, { expectedSession: "2026-09-15" })),
     "the fingerprint moves when the state moves, so a changed state is re-read");
  ok(STATE_LINES.FLIP_ON_ATR === 0.5 && STATE_LINES.WALL_NEAR_ATR === 1.5 && STATE_LINES.VRP_RELATIVE === 0.1,
     "the lines the states are cut at are published constants, not literals in the branches");
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
}

console.log(`✓ flows-neuron: ${checks} assertions — a context that carries every registry panel plus the ` +
  "standing and the volatility model, each graded 0 to 3 from the card's own coverage and quality fields " +
  "and capped at weak when the card is behind the last closed session; one line per feature so the model " +
  "is told what it cannot lean on; a prompt that keeps the guard's two rules and names the verbs it " +
  "refuses; ideas parsed from JSON and vetted one by one — two known features at least, none withheld, " +
  "a listed structure, every figure quoted, no claim about what happens next — and ranked by their " +
  "weakest leg; a greeks-implied state (pinned, amplifying, squeeze, on the flip, premium rich or cheap, " +
  "undetermined) read from positioning, flow votes and premium, with the structures it prefers and rules out, " +
  "its own vetted idea first, and the assistant's selector reaching the same facts for the page's own name");
