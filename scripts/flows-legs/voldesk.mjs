import { read, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import { parseSymbol } from "../../shared/flows-quant-card.js";
import { failureOf } from "./extras.mjs";
import {
  FUND_TICKERS, CORR_TICKERS, CORR_WINDOWS, CHARACTER_LIMIT,
  auditName, buildVa, carryVa, chooseExpiry, corrMatrix, ivrvFund, rowsOfBody, reduceCharacterTop, futuresCurve, stanceExtract, termFund,
  intOf, auditCap, ROW_OPS,
} from "../../shared/flows-voldesk.js";

export const AUDIT_READS = Object.freeze([
  "greeks", "option-chains", "atm-chains", "oi-per-expiry", "volume-oi-expiry", "greek-exposure-strike", "greek-exposure-strike-expiry", "option-stance",
]);

export function chainFor(rows, truncated) {
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const p = parseSymbol(r.option_symbol);
    const oi = intOf(r.open_interest, "open_interest");
    if (!p || oi.v === null) continue;
    out.push({ expiry: p.expiry, K: p.strike, type: p.type, oi: oi.v, symbol: r.option_symbol });
  }
  return { rows: out, truncated: Boolean(truncated) };
}

export function rotate({ funds = FUND_TICKERS, names = [], priorSession = () => null, liquidity = () => 0, cap }) {
  const fixed = [...new Set(funds)];
  const rest = [...new Set(names)].filter((t) => !fixed.includes(t));
  const never = rest.filter((t) => !priorSession(t)).sort((a, b) => liquidity(b) - liquidity(a) || (a < b ? -1 : 1));
  const seen = rest.filter((t) => priorSession(t)).sort((a, b) => (priorSession(a) < priorSession(b) ? -1 : priorSession(a) > priorSession(b) ? 1 : (a < b ? -1 : 1)));
  return { fixed, rotating: [...never, ...seen].slice(0, Math.max(0, cap)) };
}

export async function readPriorVa(names, { readPrior, pool = null, width = 4 } = {}) {
  const priors = new Map();
  const failed = new Set();
  if (typeof readPrior !== "function") return { priors, failed };
  const work = async (t) => {
    const res = await readPrior(t);
    if (res && res.payload && typeof res.payload === "object") priors.set(t, res.payload.va && typeof res.payload.va === "object" ? res.payload.va : null);
    else if (res && res.absent) priors.set(t, null);
    else failed.add(t);
  };
  const list = [...new Set(names)];
  if (pool) await pool(list, work, { width });
  else for (const t of list) await work(t);
  return { priors, failed };
}

export async function runVolAudit({
  uw, session, now, funds = FUND_TICKERS, names = [], cardOf, chainOf, priorVa = new Map(), liquidity = () => 0,
  deadline = null, pool = null, width = 1, cap = auditCap(), log = () => {},
} = {}) {
  const priorSession = (t) => {
    const va = priorVa.get(t);
    return va && va.session ? va.session : null;
  };
  const plan = rotate({ funds, names, priorSession, liquidity, cap });
  const list = [...plan.fixed, ...plan.rotating];
  const vas = new Map();
  const stance = new Map();
  const skipped = { engine: 0, chain: 0, deadline: 0 };
  const ops = {};
  let calls = 0;
  const bump = (id, key) => {
    ops[id] = ops[id] || { n: 0, bad: 0, fail: 0 };
    ops[id][key]++;
  };
  const feed = async (id, path, params) => {
    calls++;
    const res = await read(uw, path, params, { envelope: true });
    if (!res.ok) {
      bump(id, "n");
      bump(id, "fail");
      return { why: failureOf(res) };
    }
    bump(id, "n");
    const rows = rowsOfBody(res.body);
    return rows || { why: "absent", raw: res.body };
  };
  const work = async (t) => {
    if (pastDeadline(deadline)) { skipped.deadline++; return; }
    const card = cardOf(t);
    const engine = card && card.engine && Array.isArray(card.engine.expiries) ? card.engine : null;
    const chosen = engine ? chooseExpiry(engine.expiries) : null;
    if (!chosen) { skipped.engine++; return; }
    const chain = chainOf(t);
    if (!chain) { skipped.chain++; return; }
    const day = { date: session };
    const greeks = await feed("greeks", pathFor("greeks", { ticker: t }), { expiry: chosen.expiry, ...day });
    const chains = await feed("option-chains", pathFor("option-chains", { ticker: t }), { ...day });
    const atm = await feed("atm-chains", pathFor("atm-chains", { ticker: t }), { "expirations[]": [chosen.expiry] });
    const oiExpiry = await feed("oi-per-expiry", pathFor("oi-per-expiry", { ticker: t }), {});
    const volOi = await feed("volume-oi-expiry", pathFor("volume-oi-expiry", { ticker: t }), { ...day });
    const exStrike = await feed("greek-exposure-strike", pathFor("greek-exposure-strike", { ticker: t }), { ...day });
    const exStrikeExpiry = await feed("greek-exposure-strike-expiry", pathFor("greek-exposure-strike-expiry", { ticker: t }), { expiry: chosen.expiry, ...day });
    calls++;
    const sres = await read(uw, pathFor("option-stance", { ticker: t }), { stance: "sell_premium", limit: 20, ...day }, { envelope: true });
    bump("option-stance", "n");
    if (sres.ok) stance.set(t, stanceExtract(sres.body, t, session));
    else bump("option-stance", "fail");
    const audit = auditName({ card, chain, greeks, chains, atm, oiExpiry, volOi, exStrike, exStrikeExpiry, session });
    vas.set(t, buildVa(audit, { at: now, session }));
  };
  if (pool) await pool(list, work, { width, stopEarly: () => pastDeadline(deadline) });
  else for (const t of list) await work(t);
  for (const va of vas.values()) {
    for (const r of va.rows) {
      const id = ROW_OPS[r[0]];
      if (id && typeof r[6] === "string" && (r[6].startsWith("type:") || r[6].startsWith("range:"))) bump(id, "bad");
    }
  }
  log(`  vol audit: ${vas.size} of ${list.length} name(s) audited in ${calls} call(s)` +
    (skipped.engine ? `, ${skipped.engine} without an engine fit` : "") + (skipped.chain ? `, ${skipped.chain} without a chain read` : "") +
    (skipped.deadline ? `, ${skipped.deadline} past the deadline` : ""));
  return { vas, stance, skipped, ops, calls, planned: list.length, plan };
}

export function carriedVa(t, audited, prior, session) {
  if (audited.has(t)) return audited.get(t);
  return carryVa(prior.get(t) || null, session);
}

export async function runVolDesk({
  uw, session, shapes = null, deadline = null, log = () => {},
} = {}) {
  const ops = {};
  let calls = 0;
  const get = async (id, path, params) => {
    if (pastDeadline(deadline)) { ops[id] = ops[id] || { n: 0, bad: 0, fail: 0, why: "deadline" }; return { why: "failed" }; }
    calls++;
    const res = await read(uw, path, params, { envelope: true });
    ops[id] = ops[id] || { n: 0, bad: 0, fail: 0 };
    ops[id].n++;
    if (!res.ok) { ops[id].fail++; return { why: failureOf(res) }; }
    return { body: res.body };
  };
  const term = {};
  const ivrv = {};
  for (const t of FUND_TICKERS) {
    const got = await get("term-structure", pathFor("term-structure", { ticker: t }), { date: session });
    term[t] = got.body === undefined ? termFund(got, { session }) : termFund(rowsOfBody(got.body), { session });
  }
  for (const t of FUND_TICKERS) {
    const real = await get("vol-realized", pathFor("vol-realized", { ticker: t }), { date: session });
    const stats = await get("vol-stats", pathFor("vol-stats", { ticker: t }), { date: session });
    ivrv[t] = ivrvFund(real.body === undefined ? real : rowsOfBody(real.body), stats.body === undefined ? stats : stats.body, session);
  }
  const vix = await get("vix-term", pathFor("vix-term"), { history_days: 90 });
  const futures = vix.body === undefined
    ? { status: vix.why === "plan" ? "plan" : "failed", why: vix.why, points: [], spot: null, roll30: null }
    : futuresCurve(vix.body, shapes, session);
  const chars = [];
  for (const [sort, dir] of [["half_life", "asc"], ["hurst", "desc"]]) {
    const got = await get("vol-character-top", pathFor("vol-character-top"), { date: session, limit: CHARACTER_LIMIT, sort, dir });
    chars.push(got.body === undefined ? { status: got.why === "plan" ? "plan" : "failed", why: got.why, rows: [] } : reduceCharacterTop(got.body, shapes));
  }
  const matrix = { tickers: [...CORR_TICKERS] };
  for (const w of CORR_WINDOWS) {
    const got = await get("market-correlations", pathFor("market-correlations"), { tickers: CORR_TICKERS.join(","), interval: w.toLowerCase() });
    matrix[w] = got.body === undefined ? corrMatrix(got, CORR_TICKERS) : corrMatrix(rowsOfBody(got.body), CORR_TICKERS);
  }
  log(`  voldesk: ${calls} market call(s); futures ${futures.status}, character ${chars.map((c) => c.status).join("/")}`);
  return { term, ivrv, futures, chars, matrix, ops, calls };
}
