import { normaliseLeg, expiryProfile, payoffValue } from "../../shared/flows-quant-engine.js";
import { wilson, logScore } from "../../shared/flows-stats.js";

export const CALIB_KEY = "calib";
export const CALIB_VERSION = 1;
export const NEEDED_N_EFF = 100;
export const BINS = 10;
export const LOOKBACK_DAYS = 100;
export const READ_WINDOW_MAX_DAYS = 200;
export const ORPHAN_CALL_CAP = 15;
export const LOST_AFTER_DAYS = 14;
export const ICC_FLOOR = 0.1;
export const ICC_FLOOR_UNTIL = 20;
export const PROFIT_TOL = 1e-9;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x) => (fin(x) ? x : null);
const round = (x, d) => (fin(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

const dayMs = (d) => Date.parse(d + "T00:00:00Z");
export const isDay = (d) => typeof d === "string" && DAY_RE.test(d) && Number.isFinite(dayMs(d)) && new Date(dayMs(d)).toISOString().slice(0, 10) === d;
export const addDays = (d, n) => new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY_MS);

export function weekdaysBefore(from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const w = new Date(dayMs(d)).getUTCDay();
    if (w !== 0 && w !== 6) out.push(d);
  }
  return out;
}

export function isoWeek(day) {
  const t = new Date(dayMs(day));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return year + "-W" + String(week).padStart(2, "0");
}

export function ideaRecord(block, ticker) {
  if (!block || !Array.isArray(block.ideas) || !block.ideas.length || !Array.isArray(block.structures)) return null;
  const s = block.structures.find((x) => x && x.id === block.ideas[0]);
  if (!s || typeof s.family !== "string" || !s.family || !Array.isArray(s.legs) || !s.legs.length) return null;
  const fill = num(s.price && s.price.fill);
  const spot = num(block.spot);
  if (fill === null || spot === null || typeof s.expiry !== "string" || !isDay(s.expiry)) return null;
  const legs = [];
  for (const l of s.legs) {
    if (!l || (l.type !== "C" && l.type !== "P" && l.type !== "S")) return null;
    const side = l.side > 0 ? 1 : l.side < 0 ? -1 : 0;
    const qty = fin(l.qty) && l.qty > 0 ? l.qty : 0;
    if (!side || !qty) return null;
    if (l.type === "S") legs.push(["S", null, side, qty, null]);
    else {
      if (!fin(l.k) || typeof l.expiry !== "string" || !isDay(l.expiry)) return null;
      legs.push([l.type, l.k, side, qty, l.expiry]);
    }
  }
  const prob = s.prob || {};
  const ev = s.ev || {};
  return {
    t: String(ticker), family: s.family, dir: typeof s.dir === "string" ? s.dir : null, grade: num(s.grade),
    expiry: s.expiry, dte: num(s.dte), legs, fill,
    mid: num(s.price && s.price.mid), natural: num(s.price && s.price.natural), spot,
    div: num(s.carry && s.carry.dividend),
    popQ: num(prob.popQ), popP: num(prob.popP), pMaxQ: num(prob.pMaxProfitQ), pMaxP: num(prob.pMaxProfitP),
    touchQ: Array.isArray(prob.touchShortQ) ? prob.touchShortQ.map(num) : [],
    evQ: num(ev.q), evP: num(ev.p), capital: num(s.capital && s.capital.value),
  };
}

export function legsKey(legs) {
  return legs.map((l) => [l[4] || "", l[0], l[1] === null ? "" : l[1], l[2] > 0 ? "+" : "-", l[3]].join(":")).sort().join(";");
}

export const identityOf = (rec) => [rec.t, rec.family, legsKey(rec.legs), rec.expiry].join("|");

export function archiveRow(thin, record) {
  const row = { t: record ? record.t : thin.t, id: thin.id, structure: thin.structure, dir: thin.dir, grade: thin.grade };
  if (record) {
    const { t, family, dir, grade, ...rest } = record;
    row.trial = rest;
  }
  return row;
}

export function archivePayload(ideaRows, { sessionDate, generatedAt, built = 0 }) {
  const rows = ideaRows.slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return { v: 2, status: rows.length ? "ok" : "quiet", sessionDate, generatedAt, built, n: rows.length, rows };
}

export function trialOf(row) {
  if (!row || typeof row !== "object" || typeof row.t !== "string" || typeof row.id !== "string" || !row.trial || typeof row.trial !== "object") return null;
  const x = row.trial;
  if (!Array.isArray(x.legs) || !x.legs.length || !fin(x.fill) || typeof x.expiry !== "string" || !isDay(x.expiry)) return null;
  for (const l of x.legs) {
    if (!Array.isArray(l) || l.length !== 5 || !["C", "P", "S"].includes(l[0]) || !(l[2] === 1 || l[2] === -1) || !(fin(l[3]) && l[3] > 0)) return null;
    if (l[0] !== "S" && (!fin(l[1]) || !isDay(l[4]))) return null;
  }
  return { t: row.t, family: row.id, dir: row.dir === undefined ? null : row.dir, grade: num(row.grade), ...x };
}

const engineLegs = (trial) => trial.legs.map((l) => normaliseLeg({
  type: l[0], K: l[0] === "S" ? undefined : l[1], side: l[2], qty: l[3], ...(l[0] === "S" ? { div: trial.div || 0 } : {}),
}));

const inProfit = (x, intervals) => intervals.some(([a, b]) => x > a && (b === null || x < b));
const inMax = (x, intervals) => intervals.some(([a, b]) => x >= a - PROFIT_TOL && (b === null || x <= b + PROFIT_TOL));

export function closeFor(bars, expiry, runDate) {
  const usable = bars.filter((b) => b && isDay(b.d) && b.d <= runDate && fin(b.c)).sort((a, b) => (a.d < b.d ? -1 : 1));
  const exact = usable.find((b) => b.d === expiry);
  if (exact) return exact;
  const after = usable.some((b) => b.d > expiry);
  if (!after) return null;
  let last = null;
  for (const b of usable) if (b.d < expiry) last = b;
  return last;
}

export function resolveTrial(trial, series, runDate) {
  const front = [...new Set(trial.legs.filter((l) => l[0] !== "S").map((l) => l[4]))];
  const base = { id: identityOf(trial), t: trial.t, family: trial.family, d: trial.archived, expiry: trial.expiry, week: isoWeek(trial.expiry), popP: trial.popP, popQ: trial.popQ };
  if (front.length > 1) return { ...base, status: "excluded", why: "multi-expiry" };
  if (front.length === 1 && front[0] !== trial.expiry) return { ...base, status: "excluded", why: "expiry-mismatch" };
  if (!(trial.expiry > trial.archived)) return { ...base, status: "excluded", why: "expired-on-archive" };
  if (trial.expiry > runDate) return { ...base, status: "pending", why: "not-due" };
  if (!series || !Array.isArray(series.bars)) return { ...base, status: "pending", why: "no-bars" };
  const breaks = Array.isArray(series.breaks) ? series.breaks : [];
  if (breaks.some((b) => isDay(b) && b > trial.archived && b <= trial.expiry)) return { ...base, status: "excluded", why: "price-break" };
  const hit = closeFor(series.bars, trial.expiry, runDate);
  if (!hit || !(hit.d > trial.archived)) return { ...base, status: "pending", why: "no-close" };
  const legs = engineLegs(trial);
  const prof = expiryProfile(legs, trial.fill);
  const pnl = payoffValue(legs, hit.c) - trial.fill;
  const shorts = legs.filter((l) => l.side < 0 && l.type !== "S");
  let touched = null;
  if (shorts.length) {
    const window = series.bars.filter((b) => b && isDay(b.d) && b.d > trial.archived && b.d <= hit.d);
    touched = shorts.some((l) => window.some((b) => (l.type === "C" ? fin(b.h) && b.h >= l.K : fin(b.l) && b.l <= l.K))) ? 1 : 0;
  }
  return {
    ...base, status: "resolved", closeDate: hit.d, close: hit.c,
    profit: inProfit(hit.c, prof.profitIntervals) ? 1 : 0,
    reachedMax: prof.profitUnbounded || !prof.maxProfitAt.length ? null : inMax(hit.c, prof.maxProfitAt) ? 1 : 0,
    touched, pnl: round(pnl, 4),
  };
}

export const emptyAcc = () => ({ bins: Array.from({ length: BINS }, () => [0, 0, 0, 0, 0]), ll: 0 });

export function emptyState() {
  return { clusters: {}, popP: emptyAcc(), popQ: emptyAcc(), noPopP: 0, resolved: 0, lost: 0, excluded: {}, pending: [] };
}

function foldProb(acc, p, y) {
  if (!fin(p) || p < 0 || p > 1 || !(y === 0 || y === 1)) return false;
  const b = acc.bins[Math.min(BINS - 1, Math.floor(p * BINS))];
  b[0] += 1; b[1] += p; b[2] += y; b[3] += p * p; b[4] += p * y;
  acc.ll += logScore([p], [y]);
  return true;
}

export function foldOutcome(state, o) {
  const c = state.clusters[o.week] || (state.clusters[o.week] = [0, 0]);
  c[0] += 1; c[1] += o.profit;
  state.resolved += 1;
  foldProb(state.popQ, o.popQ, o.profit);
  if (!foldProb(state.popP, o.popP, o.profit)) state.noPopP += 1;
}

export function iccOf(clusters) {
  const ks = Object.values(clusters).filter((c) => c[0] > 0);
  const K = ks.length;
  const N = ks.reduce((s, c) => s + c[0], 0);
  if (K < 2 || N <= K) return null;
  const S = ks.reduce((s, c) => s + c[1], 0);
  const yb = S / N;
  let ssb = 0, ssw = 0, m2 = 0;
  for (const [m, s] of ks) { const yk = s / m; ssb += m * (yk - yb) * (yk - yb); ssw += s * (1 - yk); m2 += m * m; }
  const msb = ssb / (K - 1), msw = ssw / (N - K), m0 = (N - m2 / N) / (K - 1);
  const den = msb + (m0 - 1) * msw;
  return den > 0 ? (msb - msw) / den : null;
}

export function effectiveCount(clusters) {
  const ks = Object.values(clusters).filter((c) => c[0] > 0);
  const n = ks.reduce((s, c) => s + c[0], 0);
  if (!n) return { n: 0, k: 0, icc: null, rho: null, floored: false, nEff: 0, deff: 1 };
  const icc = iccOf(clusters);
  const floored = icc === null || ks.length < ICC_FLOOR_UNTIL;
  const rho = icc === null ? ICC_FLOOR : ks.length < ICC_FLOOR_UNTIL ? Math.max(icc, ICC_FLOOR) : Math.min(1, Math.max(0, icc));
  const nEff = ks.reduce((s, [m]) => s + m / (1 + (m - 1) * rho), 0);
  return { n, k: ks.length, icc, rho, floored, nEff, deff: n / nEff };
}

export function modelView(acc, deff) {
  const N = acc.bins.reduce((s, b) => s + b[0], 0);
  if (!N) return null;
  const sy = acc.bins.reduce((s, b) => s + b[2], 0);
  const spp = acc.bins.reduce((s, b) => s + b[3], 0);
  const spy = acc.bins.reduce((s, b) => s + b[4], 0);
  const base = sy / N;
  let rel = 0, res = 0, within = 0, cov = 0;
  const bins = acc.bins.map((b, i) => {
    const lo = i / BINS, hi = (i + 1) / BINS;
    if (!b[0]) return { lo, hi, n: 0, p: null, y: null, ci: null };
    const pBar = b[1] / b[0], yBar = b[2] / b[0];
    rel += b[0] * (pBar - yBar) * (pBar - yBar);
    res += b[0] * (yBar - base) * (yBar - base);
    within += b[3] - b[0] * pBar * pBar;
    cov += b[4] - pBar * b[2];
    const ci = wilson(yBar, b[0] / Math.max(1, deff));
    return { lo, hi, n: b[0], p: round(pBar, 4), y: round(yBar, 4), ci: ci ? [round(ci[0], 4), round(ci[1], 4)] : null };
  });
  return {
    n: N, base: round(base, 4), brier: round((spp - 2 * spy + sy) / N, 6), logScore: round(acc.ll / N, 6),
    reliability: round(rel / N, 6), resolution: round(res / N, 6), uncertainty: round(base * (1 - base), 6),
    withinBin: round(within / N, 6), withinCovariance: round(cov / N, 6), bins,
  };
}

export function calibRow(state, { sessionDate, generatedAt, through, firstArchive, eligible }) {
  const eff = effectiveCount(state.clusters);
  const measured = eff.nEff >= NEEDED_N_EFF;
  const pending = state.pending.length;
  const terminal = state.resolved + pending + state.lost;
  return {
    v: CALIB_VERSION, status: terminal || eligible ? "ok" : "quiet", sessionDate, generatedAt, through, firstArchive,
    needed: NEEDED_N_EFF, measured, nEff: round(eff.nEff, 2), n: eff.n, clusters: eff.k, icc: round(eff.icc, 4), rho: round(eff.rho, 4), rhoFloored: eff.floored,
    counts: {
      resolved: state.resolved, pending, lost: state.lost, excluded: state.excluded, noPopP: state.noPopP,
      unresolvedShare: terminal ? round((pending + state.lost) / terminal, 4) : null,
    },
    popP: measured ? modelView(state.popP, eff.deff) : null,
    popQ: measured ? modelView(state.popQ, eff.deff) : null,
    note: "popP is the model's real-world chance of profit at the archived fill, European payoff at expiry, early assignment ignored; popQ is the risk-neutral chance and is not meant to match frequencies, its gap measures the risk premium. Ideas expiring in one ISO week share one market path and count as one cluster.",
    state,
  };
}

async function readAll(keys, readKey, width = 6) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += width) {
    const chunk = keys.slice(i, i + width);
    const got = await Promise.all(chunk.map((k) => readKey(k)));
    chunk.forEach((k, j) => out.set(k, got[j]));
  }
  return out;
}

export function readWindow({ sessionDate, through, firstArchive }) {
  const anchor = through && through < sessionDate ? through : sessionDate;
  let from = addDays(anchor, -LOOKBACK_DAYS);
  if (firstArchive && firstArchive > from) from = firstArchive;
  const floor = addDays(sessionDate, -READ_WINDOW_MAX_DAYS);
  if (from < floor) from = floor;
  return weekdaysBefore(from, sessionDate);
}

export async function runCalibration({ sessionDate, generatedAt, readKey, record, publish, barsFor, fetchBars, orphanCap = ORPHAN_CALL_CAP }) {
  if (!isDay(sessionDate)) return { state: "skipped", line: `  calibration: session date ${JSON.stringify(sessionDate)} is not a date, nothing resolved` };
  const cur = await readKey(CALIB_KEY);
  if (cur.failed) return { state: "skipped", line: `  calibration: ${CALIB_KEY} could not be read (HTTP ${cur.status || 0}), so nothing was resolved tonight and no outcome was written` };
  const prior = cur.payload && cur.payload.v === CALIB_VERSION && cur.payload.state ? cur.payload : null;
  const state = prior ? structuredClone(prior.state) : emptyState();
  const through = prior ? prior.through : null;
  if (through && through >= sessionDate) {
    return { state: "unchanged", line: `  calibration: ${CALIB_KEY} already covers ${through}, so ${sessionDate} adds nothing` };
  }
  const dates = readWindow({ sessionDate, through, firstArchive: prior ? prior.firstArchive : null });
  const reads = await readAll(dates.map((d) => `ideas:${d}`), readKey);
  const unreadable = dates.filter((d) => reads.get(`ideas:${d}`).failed);
  if (unreadable.length) {
    return { state: "skipped", line: `  calibration: ${unreadable.length} of ${dates.length} archived ideas row(s) could not be read (first ${unreadable[0]}), so tonight resolves nothing rather than lose an idea that expires in the gap` };
  }
  const seen = new Map();
  let first = prior ? prior.firstArchive : null;
  let malformed = 0, outside = 0;
  for (const d of dates) {
    const got = reads.get(`ideas:${d}`);
    if (got.absent || !got.payload) continue;
    const payload = got.payload;
    if (payload.sessionDate !== d || d >= sessionDate || !Array.isArray(payload.rows)) { outside += 1; continue; }
    if (!first || d < first) first = d;
    for (const row of payload.rows) {
      const trial = trialOf(row);
      if (!trial) { if (row && row.trial === undefined) continue; malformed += 1; continue; }
      trial.archived = d;
      const id = identityOf(trial);
      if (!seen.has(id)) seen.set(id, trial);
    }
  }
  const pendingIds = new Set(state.pending.map((p) => identityOf(p)));
  const due = [...state.pending];
  for (const [id, trial] of seen) {
    if (pendingIds.has(id)) continue;
    if (trial.expiry <= sessionDate && (!through || trial.expiry > through)) due.push(trial);
  }
  due.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const cache = new Map();
  const tried = new Set();
  let fetched = 0, fetchFailed = 0;
  const heldBars = async (t) => {
    if (!cache.has(t)) cache.set(t, (await barsFor(t)) || null);
    return cache.get(t);
  };
  const outcomes = [];
  const stillPending = [];
  for (const trial of due) {
    let o = resolveTrial(trial, await heldBars(trial.t), sessionDate);
    if (o.status === "pending" && !tried.has(trial.t) && fetched < orphanCap) {
      tried.add(trial.t);
      fetched += 1;
      let got = null;
      try { got = await fetchBars(trial.t); } catch { got = null; }
      if (got && Array.isArray(got.bars)) {
        cache.set(trial.t, got);
        o = resolveTrial(trial, got, sessionDate);
      } else fetchFailed += 1;
    }
    if (o.status === "pending") {
      if (daysBetween(trial.expiry, sessionDate) > LOST_AFTER_DAYS) outcomes.push({ ...o, status: "lost" });
      else stillPending.push(trial);
    } else outcomes.push(o);
  }
  const terminal = outcomes.filter((o) => o.status !== "pending");
  for (const o of terminal) {
    if (o.status === "resolved") foldOutcome(state, o);
    else if (o.status === "lost") state.lost += 1;
    else state.excluded[o.why] = (state.excluded[o.why] || 0) + 1;
  }
  state.pending = stillPending;
  let ledger = null;
  if (terminal.length) {
    ledger = await record("ideas-out", {
      v: 1, status: "ok", sessionDate, generatedAt, n: terminal.length,
      note: "Outcomes resolved on this run. A resolved row freezes the close, the profit and max-profit flags and whether a short strike was touched on daily highs and lows (a lower bound on continuous monitoring). Excluded rows are named, never dropped silently.",
      rows: terminal,
    });
    if (ledger.state === "lost" || ledger.state === "capped" || ledger.state === "skipped") {
      return { state: "skipped", line: `  calibration: ${terminal.length} outcome(s) resolved but not recorded (${ledger.state}), so ${CALIB_KEY} was left as it was and tonight repeats tomorrow\n${ledger.line}` };
    }
  }
  const row = calibRow(state, { sessionDate, generatedAt, through: sessionDate, firstArchive: first, eligible: seen.size > 0 });
  try {
    await publish(CALIB_KEY, row);
  } catch (error) {
    return { state: "lost", line: `  calibration: ${CALIB_KEY} NOT PUBLISHED — ${error && error.message ? error.message : error}` };
  }
  const said = `${terminal.filter((o) => o.status === "resolved").length} resolved, ${terminal.filter((o) => o.status === "excluded").length} excluded, ${terminal.filter((o) => o.status === "lost").length} lost, ${stillPending.length} waiting for a close`;
  return {
    state: "published", row, outcomes: terminal, fetched, fetchFailed, malformed, outside, reads: dates.length + 1, ledger,
    line: `  calibration: ${said}; orphan closes fetched ${fetched}${fetchFailed ? ` (${fetchFailed} failed)` : ""}; n ${row.n}, effective n ${row.nEff} of ${NEEDED_N_EFF} needed` +
      (row.counts.unresolvedShare === null ? "" : `, unresolved share ${(row.counts.unresolvedShare * 100).toFixed(1)}%`) +
      (malformed || outside ? `; ${malformed} malformed and ${outside} out-of-window archive row(s) skipped` : ""),
  };
}
