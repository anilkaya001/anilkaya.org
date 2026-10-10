import { indexWeights, buildDispersion } from "../../shared/flows-dispersion.js";
import { isoWeek, isDay, daysBetween } from "./calibration.mjs";

export const DISPERSION_KEY = "dispersion";
export const WEEKLY_CALL_CAP = 100;
export const STALE_DAYS = 5;
export const KEEP_SESSIONS = 70;

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const round = (x) => Math.round(x * 1e4) / 1e4;

export async function runDispersion({
  sessionDate, generatedAt, stocks, asOfHoldings = null, indexIv, ivOf, eventOf, barsFor, fetchBars, prior, publish, weeklyCap = WEEKLY_CALL_CAP,
}) {
  if (!isDay(sessionDate)) return { state: "skipped", line: `  dispersion: session date ${JSON.stringify(sessionDate)} is not a date, nothing built` };
  const members = indexWeights(stocks);
  if (!members.length) return { state: "skipped", line: "  dispersion: the index holdings listed no weighted stock, so nothing was built" };
  const week = isoWeek(sessionDate);
  const kept = prior && prior.v === 1 && prior.state && prior.state.closes && Array.isArray(prior.state.closes.dates) ? prior.state : null;
  let calls = kept && kept.week === week && fin(kept.calls) ? kept.calls : 0;
  const series = new Map();
  const held = new Set();
  const breaks = new Map();
  const noteBreaks = (t, got) => {
    const list = got && Array.isArray(got.breaks) ? got.breaks.filter((d) => typeof d === "string") : [];
    if (list.length) breaks.set(t, list);
  };
  const cut = (bars) => bars.filter((b) => b && typeof b.d === "string" && b.d <= sessionDate && fin(b.c)).slice(-KEEP_SESSIONS).map((b) => [b.d, b.c]);
  for (const m of members) {
    const got = await barsFor(m.t);
    const s = got && Array.isArray(got.bars) ? cut(got.bars) : [];
    if (s.length) { series.set(m.t, s); held.add(m.t); noteBreaks(m.t, got); }
  }
  const cachedOf = (t) => {
    const c = kept && kept.closes.c ? kept.closes.c[t] : null;
    if (!Array.isArray(c)) return null;
    const out = [];
    kept.closes.dates.forEach((d, i) => { if (fin(c[i]) && d <= sessionDate) out.push([d, c[i]]); });
    return out.length ? out : null;
  };
  const stored = new Map();
  const keptBreaks = kept && kept.closes.k && typeof kept.closes.k === "object" ? kept.closes.k : {};
  let fetched = 0, failed = 0, deferred = 0;
  for (const m of members) {
    if (held.has(m.t)) continue;
    const old = cachedOf(m.t);
    const fresh = old && daysBetween(old[old.length - 1][0], sessionDate) <= STALE_DAYS;
    if (fresh) { series.set(m.t, old); stored.set(m.t, old); if (Array.isArray(keptBreaks[m.t])) breaks.set(m.t, keptBreaks[m.t]); continue; }
    if (calls >= weeklyCap) {
      deferred += 1;
      if (old) { series.set(m.t, old); stored.set(m.t, old); if (Array.isArray(keptBreaks[m.t])) breaks.set(m.t, keptBreaks[m.t]); }
      continue;
    }
    calls += 1;
    fetched += 1;
    let got = null;
    try { got = await fetchBars(m.t); } catch { got = null; }
    const s = got && Array.isArray(got.bars) ? cut(got.bars) : [];
    if (s.length) { series.set(m.t, s); stored.set(m.t, s); noteBreaks(m.t, got); } else {
      failed += 1;
      if (old) { series.set(m.t, old); stored.set(m.t, old); if (Array.isArray(keptBreaks[m.t])) breaks.set(m.t, keptBreaks[m.t]); }
    }
  }
  const dates = [...new Set([...stored.values()].flatMap((s) => s.map((p) => p[0])))].sort().slice(-KEEP_SESSIONS);
  const c = {};
  for (const [t, s] of stored) {
    const at = new Map(s);
    c[t] = dates.map((d) => (at.has(d) ? round(at.get(d)) : null));
  }
  const k = {};
  for (const t of stored.keys()) {
    const live = (breaks.get(t) || []).filter((d) => dates.length && d >= dates[0]);
    if (live.length) k[t] = live;
  }
  const row = buildDispersion({
    sessionDate, generatedAt, source: "qqq-holdings:" + (asOfHoldings || "undated"),
    indexIv: fin(indexIv) ? indexIv : null,
    members: members.map((m) => ({ t: m.t, w: m.w, iv: ivOf(m.t), event: Boolean(eventOf(m.t)) })),
    series, breaks,
  });
  row.holdings = { listed: members.length, asOf: asOfHoldings };
  row.calls = { fetched, failed, deferred, week, weekly: calls, cap: weeklyCap };
  row.state = { week, calls, closes: { dates, c, k } };
  try {
    await publish(DISPERSION_KEY, row);
  } catch (error) {
    return { state: "lost", row, line: `  dispersion: ${DISPERSION_KEY} NOT PUBLISHED — ${error && error.message ? error.message : error}` };
  }
  const r21 = row.realised[21], r63 = row.realised[63];
  const show = (x) => (fin(x) ? x.toFixed(2) : "none");
  return {
    state: "published", row, fetched, failed, deferred,
    line: `  dispersion: ${row.status}; implied correlation ${show(row.implied.rho)}${row.implied.why ? ` (${row.implied.why})` : ""}, realised ${show(r21.rho)} over 21 sessions and ${show(r63.rho)} over 63, as of ${row.asOf || "no date"}; ` +
      `${members.length} members, ${held.size} from this run's candles, ${fetched} close fetches this run${failed ? ` (${failed} failed)` : ""}${deferred ? `, ${deferred} deferred to next week` : ""}, ${calls} of ${weeklyCap} this week`,
  };
}
