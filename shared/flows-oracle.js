import { impliedVolB76 } from "./flows-quant-bs.js";
import { factEntry } from "./flows-fact-ids.js";
import { sessionsBetween } from "./flows-cross.js";
import { callSay, STANCE_LINES, MODEL_IMPLIED, BUILDING_LINES, calmLine } from "./flows-oracle-words.js";

export const ORACLE_VERSION = 1;
export const ORACLE_BYTE_CAP = 6144;
export const STATES = Object.freeze(["calm", "building", "signal", "conflict", "stale"]);
export const STATE_WHY = Object.freeze(["ok", "no-card", "screen", "grade", "no-engine", "event.window", "premium.conflict", "expired", "behind1", "disagree", "thin-norm"]);
export const LIMITS = Object.freeze([
  "Calls are priced on the nightly card and are not re-priced during the session.",
  "Fair value is the engine's real-world law against its fitted prices, not a forecast.",
  "No track record of shown calls exists yet.",
]);
export const ASSUMPTIONS = Object.freeze({
  law: "The engine's real-world law sets the fair price; the fitted smile sets the market-implied price.",
  european: "Contracts are treated as European and held to expiry, with continuous carry.",
  spread: "The spread cost is the quoted bid to ask range, halved.",
});

export const THRESHOLDS = Object.freeze({
  edgeVol: 0.02,
  edgeUsd: 15,
  edgeOverSpread: 1.5,
  minMid: 0.05,
  maxSpreadOverMid: 0.5,
  minLiquidity: 10,
  minDte: 14,
  minGrade: 2,
  maxCalls: 3,
  maxCites: 12,
  maxBasis: 6,
});

const LOT = 100;

const VERDICT_OF_SIDE = Object.freeze({ "1": "cheap", "-1": "rich" });
const ACTION_OF_SIDE = Object.freeze({ "1": "pay", "-1": "collect" });
const IDEA_LEAN = Object.freeze({ bull: "up", bear: "down", neutral: "none", state: "none" });
const STATE_LEAN = Object.freeze({ bullish: "up", bearish: "down" });
const LEAN_TABLE = Object.freeze({
  up: Object.freeze({ up: "up", down: "mixed", none: "up" }),
  down: Object.freeze({ up: "mixed", down: "down", none: "down" }),
  none: Object.freeze({ up: "up", down: "down", none: "none" }),
});
const SINGLE_LEG = Object.freeze(["long-call", "long-put", "short-put"]);
const BASE_PANELS = Object.freeze(["context", "pricedMove", "levels", "gamma"]);
const PASS = Object.freeze(["ok", "quiet", "none"]);

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clampGrade = (g) => (fin(g) ? Math.max(0, Math.min(3, Math.floor(g))) : 0);
const r4 = (v) => (fin(v) ? Math.round(v * 1e4) / 1e4 : null);
const r2 = (v) => (fin(v) ? Math.round(v * 100) / 100 : null);

export function engineOf(card, cardX) {
  const own = card && isObj(card.engine) && Array.isArray(card.engine.structures) ? card.engine : null;
  if (own) return own;
  return cardX && isObj(cardX.engine) && Array.isArray(cardX.engine.structures) ? cardX.engine : null;
}

function factIds(block, prefixes) {
  const facts = block && Array.isArray(block.facts) ? block.facts : [];
  const out = [];
  for (const f of facts) {
    const id = f && typeof f.id === "string" ? f.id : null;
    if (id && factEntry(id) && prefixes.some((p) => id.startsWith(p)) && !out.includes(id)) out.push(id);
  }
  return out;
}

function citeOf(block, id, asOf) {
  const facts = Array.isArray(block.facts) ? block.facts : [];
  const f = facts.find((x) => x && x.id === id);
  const entry = factEntry(id);
  return {
    id, label: entry ? entry.meaning : id,
    display: f && fin(f.v) ? String(f.v) : null, asOf, grade: f && fin(f.g) ? clampGrade(f.g) : null,
  };
}

function callFrom(s, block, ctx) {
  const T = THRESHOLDS;
  if (!isObj(s) || !SINGLE_LEG.includes(s.family) || !Array.isArray(s.legs) || s.legs.length !== 1) return { skip: "shape" };
  const l = s.legs[0];
  if (!isObj(l) || (l.type !== "C" && l.type !== "P") || !fin(l.k)) return { skip: "shape" };
  const ex = Array.isArray(block.expiries) ? block.expiries.find((e) => e && e.expiry === s.expiry) : null;
  if (!ex || !isObj(ex.smile) || !isObj(ex.forward)) return { skip: "no-slice" };
  if (ex.smile.method !== "svi") return { skip: "fit" };
  if (ex.smile.checks && ex.smile.checks.ok === false) return { skip: "fit" };
  if (!fin(s.dte) || s.dte < T.minDte) return { skip: "dte" };
  const edge = isObj(s.ev) ? s.ev.edge : null;
  const evP = isObj(s.ev) ? s.ev.p : null;
  const popP = isObj(s.prob) ? s.prob.popP : null;
  const need = [edge, evP, popP, l.iv, l.model, l.mid, l.bid, l.ask, ex.forward.F, ex.forward.D, ex.T];
  if (!need.every(fin)) return { skip: "inputs" };
  if (!(l.bid > 0) || !(l.ask >= l.bid) || !(l.mid >= T.minMid) || !((l.ask - l.bid) < l.mid * T.maxSpreadOverMid)) return { skip: "quote" };
  if (!((fin(l.oi) && l.oi >= T.minLiquidity) || (fin(l.vol) && l.vol >= T.minLiquidity))) return { skip: "liquidity" };
  const sideKey = String(Math.sign(l.side));
  const verdict = VERDICT_OF_SIDE[sideKey];
  const action = ACTION_OF_SIDE[sideKey];
  if (!verdict || !(edge > 0)) return { skip: "no-edge" };
  const fairPrice = l.model + l.side * edge / LOT;
  const fairIv = impliedVolB76(ex.forward.F, ex.forward.D, l.k, ex.T, fairPrice, l.type, l.iv);
  if (!fin(fairIv)) return { skip: "fair-iv" };
  const edgeVol = l.iv - fairIv;
  const spreadCost = (l.ask - l.bid) * LOT / 2;
  const clears = Math.abs(edgeVol) >= T.edgeVol && edge >= T.edgeUsd && spreadCost > 0 && edge / spreadCost >= T.edgeOverSpread;
  if (!clears) return { skip: "threshold" };
  const fitGrade = ex.smile.n >= 8 ? 3 : 2;
  const grade = Math.min(clampGrade(s.grade), fitGrade, ctx.gradeCap);
  if (grade < T.minGrade) return { skip: "grade" };
  const event = isObj(block.event) && typeof block.event.date === "string" && s.expiry >= block.event.date;
  const be = Array.isArray(s.breakevens) && fin(s.breakevens[0]) ? s.breakevens[0] : null;
  const call = {
    id: ctx.ticker + ":" + s.expiry + ":" + l.k + ":" + l.type,
    strike: l.k, side: l.type, expiry: s.expiry, dte: s.dte, verdict, action,
    marketIv: r4(l.iv), fairIv: r4(fairIv), edgeVol: r4(edgeVol), edgeUsd: r2(edge),
    mid: r2(l.mid), bid: r2(l.bid), ask: r2(l.ask), spreadPct: fin(l.spreadRel) ? r4(l.spreadRel) : null,
    ev: r2(evP), pop: r4(popP), breakeven: be === null ? null : r2(be),
    maxLoss: s.lossUnbounded === true || !fin(s.maxLoss) ? null : r2(Math.abs(s.maxLoss)),
    maxGain: s.profitUnbounded === true || !fin(s.maxProfit) ? null : r2(s.maxProfit),
    lossUnbounded: s.lossUnbounded === true,
    event, grade,
    assumptions: ["law", "european", "spread"],
    say: null,
    cites: factIds(block, ["iv.", "skew."]).slice(0, 3),
  };
  call.say = callSay(call);
  return { call, expiry: s.expiry };
}

export function callsFor(card, cardX, { ticker, gradeCap = 3 } = {}) {
  const block = engineOf(card, cardX);
  if (!block) return { calls: [], skipped: { "no-engine": 1 } };
  const skipped = {};
  const found = [];
  for (const s of block.structures) {
    const r = callFrom(s, block, { ticker, gradeCap });
    if (r.call) found.push(r);
    else skipped[r.skip] = (skipped[r.skip] || 0) + 1;
  }
  const expiries = [...new Set(found.map((f) => f.expiry))].sort().slice(0, 2);
  const kept = found.filter((f) => expiries.includes(f.expiry)).map((f) => f.call);
  kept.sort((a, b) => b.edgeUsd - a.edgeUsd || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { calls: kept.slice(0, THRESHOLDS.maxCalls), skipped };
}

export function stanceOf(card, cardX, withheldBase) {
  const block = engineOf(card, cardX);
  if (!block) return { lean: "none", conviction: 0, basis: [], line: STANCE_LINES.none[0] };
  const lead = block.structures.find((s) => s && Array.isArray(block.ideas) && s.id === block.ideas[0]) || null;
  const ideaLean = lead && Object.hasOwn(IDEA_LEAN, lead.dir) ? IDEA_LEAN[lead.dir] : "none";
  const st = isObj(block.state) ? block.state : {};
  const stateLean = Object.hasOwn(STATE_LEAN, st.direction) ? STATE_LEAN[st.direction] : "none";
  const lean = LEAN_TABLE[ideaLean][stateLean];
  const leadGrade = lead ? clampGrade(lead.grade) : 0;
  const stateGrade = clampGrade(Math.round(fin(st.confidence) ? st.confidence : 0));
  const baseGrade = Math.max(0, 3 - Math.floor(withheldBase / 2));
  let conviction = lean === "none" ? 0 : Math.min(leadGrade || stateGrade, stateGrade || leadGrade, baseGrade);
  if (lean === "mixed") conviction = Math.min(conviction, 1);
  const basis = factIds(block, ["iv.", "skew.", "move.", "gex", "dealer"]).slice(0, THRESHOLDS.maxBasis);
  return { lean, conviction, basis, line: STANCE_LINES[lean][conviction] };
}

function withheldOf(card, block) {
  const out = [];
  if (!card) out.push({ k: "card", reason: "absent" });
  if (card && !block) out.push({ k: "engine", reason: "absent" });
  const panels = card && isObj(card.panels) ? card.panels : {};
  for (const name of BASE_PANELS) {
    const p = panels[name];
    if (!isObj(p) || !PASS.includes(p.status)) out.push({ k: "panel." + name, reason: isObj(p) && p.status === "pending" ? "budget" : "absent" });
  }
  return out;
}

export function contextOf(card, cardX, block, { sector = null, sectorEtf = null, flowNorm = null, session = null } = {}) {
  const panels = card && isObj(card.panels) ? card.panels : {};
  const ctxPanel = isObj(panels.context) ? panels.context : {};
  const lv = block && isObj(block.levels) ? block.levels : null;
  const ev = block && isObj(block.event) && typeof block.event.date === "string" ? block.event : null;
  const sessions = ev && session ? sessionsBetween(session, ev.date) : null;
  const norm = isObj(flowNorm) && fin(flowNorm.winN) && flowNorm.winN >= 20
    ? { premiumMedian: flowNorm.premiumMedian, premiumP90: flowNorm.premiumP90, winN: flowNorm.winN, sizeMedian: flowNorm.sizeMedian, sizeP90: flowNorm.sizeP90 }
    : null;
  return {
    norm,
    leanBase: { callShare: isObj(flowNorm) && fin(flowNorm.callShare) ? flowNorm.callShare : null },
    ivRank: fin(ctxPanel.ivRank) ? ctxPanel.ivRank : null,
    ivRankGrade: fin(ctxPanel.ivRank) ? 1 : null,
    earnings: ev ? { sessions, inWindow: fin(sessions) && sessions <= 21 } : null,
    sector: typeof sector === "string" && sector ? sector : null,
    sectorEtf: typeof sectorEtf === "string" && sectorEtf ? sectorEtf : null,
    walls: lv ? { call: fin(lv.callWall) ? lv.callWall : null, put: fin(lv.putWall) ? lv.putWall : null, flip: fin(lv.flip) ? lv.flip : null } : null,
    spot: block && fin(block.spot) ? block.spot : null,
    spotAsOf: block && typeof block.asOf === "string" ? block.asOf : null,
  };
}

function stateOf({ card, block, calls, stance, grade, behind, noteNorm }) {
  if (!card) return ["building", "no-card"];
  if (behind >= 2) return ["stale", "expired"];
  if (!block) return ["building", "no-engine"];
  if (behind === 1) return ["stale", "behind1"];
  if (grade < THRESHOLDS.minGrade) return ["building", "grade"];
  if (calls.length && stance.lean === "mixed") return ["conflict", "disagree"];
  if (calls.length && stance.conviction >= 2) return ["signal", "ok"];
  return ["calm", noteNorm ? "thin-norm" : "ok"];
}

const base = (ticker, session, now) => ({
  v: ORACLE_VERSION, ticker, session, sessionDate: session, generatedAt: new Date(now).toISOString(),
});

export function buildOracle({ ticker, session, card = null, cardX = null, sector = null, sectorEtf = null, flowNorm = null, expectedSession = null, now = Date.now() }) {
  const block = engineOf(card, cardX);
  const cardSession = card && typeof card.sessionDate === "string" ? card.sessionDate : null;
  const behind = cardSession && expectedSession ? Math.max(0, sessionsBetween(cardSession, expectedSession) || 0) : 0;
  const gradeCap = behind >= 1 ? 1 : 3;
  const withheld = withheldOf(card, block);
  const baseMissing = withheld.filter((w) => w.k.startsWith("panel.")).length;
  const { calls: rawCalls } = card && block && behind < 2 ? callsFor(card, cardX, { ticker, gradeCap }) : { calls: [] };
  const calls = rawCalls;
  const stance = behind >= 2 ? { lean: "none", conviction: 0, basis: [], line: STANCE_LINES.none[0] } : stanceOf(card, cardX, baseMissing);
  const lead = block && Array.isArray(block.ideas) ? block.structures.find((s) => s && s.id === block.ideas[0]) : null;
  const grade = !block ? 0 : Math.min(gradeCap, clampGrade(calls.length ? Math.max(...calls.map((c) => c.grade)) : lead ? lead.grade : 2));
  const context = contextOf(card, cardX, block, { sector, sectorEtf, flowNorm, session: cardSession || session });
  if (!context.norm) withheld.push({ k: "flow.norm", reason: "null" });
  if (context.sector === null) withheld.push({ k: "sector", reason: "absent" });
  const [state, stateWhy] = stateOf({ card, block, calls, stance, grade, behind, noteNorm: !context.norm });
  const ideas = !card ? "screen" : behind >= 2 ? "expired" : !block ? "unpriceable" : block.ideas && block.ideas.length ? "priced" : "stand-aside";
  const cites = [];
  for (const id of [...stance.basis, ...calls.flatMap((c) => c.cites)]) {
    if (!cites.some((c) => c.id === id) && cites.length < THRESHOLDS.maxCites && block) cites.push(citeOf(block, id, block.asOf || null));
  }
  const shownCalls = state === "stale" && stateWhy === "expired" ? [] : calls;
  const record = {
    ...base(ticker, session, now),
    cardSession, cardAsOf: block && typeof block.asOf === "string" ? block.asOf : null,
    engineVersion: ORACLE_VERSION,
    state, stateWhy, grade,
    stance,
    context,
    calls: shownCalls,
    withheld,
    limits: LIMITS.slice(),
    provenance: { source: "engine", cardKey: "card:" + ticker, cardxKey: "card-x:" + ticker, ideas, cites },
    fresh: { asOf: block && typeof block.asOf === "string" ? block.asOf : cardSession, ageS: null, klass: "nightly", liveUntil: null },
    modelImplied: MODEL_IMPLIED,
    line: state === "calm" ? calmLine(ticker) : state === "building" || state === "stale" ? BUILDING_LINES[stateWhy] : stance.line,
  };
  return fit(record);
}

export function screenOracle({ ticker, session, sector = null, now = Date.now() }) {
  const withheld = [{ k: "card", reason: "absent" }, { k: "engine", reason: "absent" }];
  return fit({
    ...base(ticker, session, now),
    cardSession: null, cardAsOf: null, engineVersion: ORACLE_VERSION,
    state: "building", stateWhy: "screen", grade: 0,
    stance: { lean: "none", conviction: 0, basis: [], line: STANCE_LINES.none[0] },
    context: contextOf(null, null, null, { sector, session }),
    calls: [], withheld, limits: LIMITS.slice(),
    provenance: { source: "engine", cardKey: null, cardxKey: null, ideas: "screen", cites: [] },
    fresh: { asOf: session, ageS: null, klass: "nightly", liveUntil: null },
    modelImplied: MODEL_IMPLIED,
    line: BUILDING_LINES.screen,
  });
}

const bytesOf = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

export function fit(record, cap = ORACLE_BYTE_CAP) {
  const shed = [];
  const out = { ...record };
  const steps = [
    ["assumptions", () => { out.calls = out.calls.map((c) => ({ ...c, assumptions: [] })); }],
    ["cites", () => { out.provenance = { ...out.provenance, cites: out.provenance.cites.slice(0, 4) }; out.calls = out.calls.map((c) => ({ ...c, cites: [] })); }],
    ["calls>2", () => { out.calls = out.calls.slice(0, 2); }],
    ["calls>1", () => { out.calls = out.calls.slice(0, 1); }],
    ["norm", () => { out.context = { ...out.context, norm: null }; }],
  ];
  for (const [name, run] of steps) {
    if (bytesOf(out) <= cap) break;
    run();
    shed.push(name);
  }
  return shed.length ? Object.defineProperty(out, "shed", { value: shed, enumerable: false }) : out;
}

export function staleView(record, expectedSession) {
  if (!isObj(record) || typeof record.session !== "string" || typeof expectedSession !== "string") return record;
  const behind = Math.max(0, sessionsBetween(record.session, expectedSession) || 0);
  if (behind === 0 || record.state === "building") return record;
  if (behind >= 2) {
    return { ...record, state: "stale", stateWhy: "expired", grade: 0, calls: [], line: BUILDING_LINES.expired,
      stance: { lean: "none", conviction: 0, basis: [], line: STANCE_LINES.none[0] } };
  }
  return {
    ...record, state: "stale", stateWhy: "behind1", grade: Math.min(1, record.grade), line: BUILDING_LINES.behind1,
    calls: record.calls.map((c) => ({ ...c, grade: Math.min(1, c.grade) })),
    stance: { ...record.stance, conviction: Math.min(1, record.stance.conviction) },
  };
}

export function topHeader(record) {
  const c = record.calls && record.calls[0] ? record.calls[0] : null;
  return {
    t: record.ticker, state: record.state, stance: { lean: record.stance.lean, conviction: record.stance.conviction },
    topCall: c ? { id: c.id, strike: c.strike, side: c.side, expiry: c.expiry, verdict: c.verdict, edgeUsd: c.edgeUsd, head: c.say.head } : null,
    sector: record.context.sector,
  };
}

export function rankTop(records, { limit = 40, perSector = 6 } = {}) {
  const scored = records
    .filter((r) => (r.state === "signal" || r.state === "conflict") && r.calls.length)
    .map((r) => ({ r, score: r.calls[0].edgeUsd * Math.max(1, r.stance.conviction) }))
    .sort((a, b) => b.score - a.score || (a.r.ticker < b.r.ticker ? -1 : 1));
  const used = new Map();
  const out = [];
  for (const { r } of scored) {
    const key = r.context.sector || "";
    const n = used.get(key) || 0;
    if (n >= perSector) continue;
    used.set(key, n + 1);
    out.push(topHeader(r));
    if (out.length >= limit) break;
  }
  return out;
}
