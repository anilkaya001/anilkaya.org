const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const fin = (v) => (Number.isFinite(v) ? v : null);

export function tradingCalendar(dateSets) {
  const all = new Set();
  for (const set of dateSets || []) {
    for (const d of set || []) {
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) all.add(d);
    }
  }
  return [...all].sort();
}

export function forwardClose(closesByTicker, calendar, calendarIdx, ticker, d, k, breaks = null) {
  const i = calendarIdx.get(d);
  if (i === undefined) return { state: "lost" };
  const j = i + k;
  if (j >= calendar.length) return { state: "unclosed" };
  const date = calendar[j];
  const cuts = breaks instanceof Map ? breaks.get(ticker) : null;
  if (Array.isArray(cuts) && cuts.some((b) => typeof b === "string" && b > d && b <= date)) return { state: "lost" };
  const exit = fin(closesByTicker.get(ticker)?.get(date));
  return exit === null ? { state: "lost" } : { state: "ok", exit, date };
}

export function scoreSessionAt(rowsBySide, closesByTicker, calendar, calendarIdx, d, k, breaks = null) {
  let names = 0, lost = 0, hits = 0, measured = 0;
  let unclosed = false;
  const legs = {};
  for (const side of ["long", "short"]) {
    const rows = rowsBySide[side] || [];
    let sum = 0, m = 0;
    for (const row of rows) {
      names++;
      const entry = fin(row && row.px);
      if (entry === null || entry <= 0) { lost++; continue; }
      const fc = forwardClose(closesByTicker, calendar, calendarIdx, row.t, d, k, breaks);
      if (fc.state === "unclosed") { unclosed = true; continue; }
      if (fc.state === "lost") { lost++; continue; }
      const r = fc.exit / entry - 1;
      sum += r; m++; measured++;
      if (side === "long" ? r > 0 : r < 0) hits++;
    }
    legs[side] = m ? sum / m : null;
  }
  if (unclosed) return { state: "unclosed" };
  return {
    state: "ok",
    long: legs.long,
    short: legs.short,

    ls: legs.long !== null && legs.short !== null ? legs.long - legs.short : null,
    hit: measured ? hits / measured : null,

    hits,
    measured,
    lost,
    names,
  };
}

export function scoreSessions(datedBoards, closesByTicker, calendar, {
  horizons = [1, 5, 10, 21],
  statedK = 10,
  maxSessions = 30,
  epoch = null,
  breaks = null,
} = {}) {
  const calendarIdx = new Map(calendar.map((d, i) => [d, i]));

  const byDate = new Map();
  for (const b of datedBoards || []) {
    if (!b || typeof b.d !== "string" || (b.side !== "long" && b.side !== "short")) continue;
    if (!byDate.has(b.d)) byDate.set(b.d, {});
    byDate.get(b.d)[b.side] = Array.isArray(b.rows) ? b.rows : [];
  }
  const dates = [...byDate.keys()].sort();

  const inEpoch = (d) => !epoch || d >= epoch;
  const currentDates = dates.filter(inEpoch);
  const priorDates = dates.filter((d) => !inEpoch(d));

  const meanOver = (subset, k) => {
    const spreads = [];
    let hits = 0, measured = 0, hitSessions = 0;
    for (const d of subset) {
      const s = scoreSessionAt(byDate.get(d), closesByTicker, calendar, calendarIdx, d, k, breaks);
      if (s.state !== "ok") continue;
      if (s.ls !== null) spreads.push(s.ls);
      if (s.measured > 0) {
        hits += s.hits; measured += s.measured; hitSessions++;
      }
    }
    const n = spreads.length;
    const mean = n ? spreads.reduce((a, b) => a + b, 0) / n : null;
    let sd = null;
    if (n > 1) {
      const ss = spreads.reduce((a, b) => a + (b - mean) * (b - mean), 0);
      sd = Math.sqrt(ss / (n - 1));
    }
    return {
      ls: mean === null ? null : round(mean, 4),
      n,

      sd: sd === null ? null : round(sd, 4),
      se: sd === null ? null : round(sd / Math.sqrt(n), 4),
      hit: measured ? round(hits / measured, 4) : null,
      hitN: measured,
      hitSessions,
    };
  };

  const horizonRows = horizons.map((k) => {
    const cur = meanOver(currentDates, k);
    const row = {
      k, ls: cur.ls, n: cur.n, sd: cur.sd, se: cur.se,

      hit: cur.hit, hitN: cur.hitN, hitSessions: cur.hitSessions,
    };

    if (priorDates.length) {
      const before = meanOver(priorDates, k);
      row.prior = before.ls;
      row.priorN = before.n;
      row.priorSd = before.sd;
      row.priorSe = before.se;
      row.priorHit = before.hit;
      row.priorHitN = before.hitN;
      row.priorHitSessions = before.hitSessions;
    }
    return row;
  });

  const sessions = [];
  for (const d of [...dates].reverse()) {
    const s = scoreSessionAt(byDate.get(d), closesByTicker, calendar, calendarIdx, d, statedK, breaks);
    if (s.state !== "ok") continue;
    const row = {
      d,
      long: round(s.long, 4),
      short: round(s.short, 4),
      ls: round(s.ls, 4),
      hit: round(s.hit, 2),

      measured: s.measured,
      lost: s.lost,
      names: s.names,
    };

    if (epoch) row.pre = d < epoch;
    sessions.push(row);
    if (sessions.length >= maxSessions) break;
  }

  return {
    retained: dates.length,
    firstSession: dates.length ? dates[0] : null,
    lastSession: dates.length ? dates[dates.length - 1] : null,
    horizons: horizonRows,
    sessions,

    epoch: epoch || null,
    epochRetained: epoch ? currentDates.length : null,
    priorRetained: epoch ? priorDates.length : null,

    preShown: epoch ? sessions.filter((r) => r.pre).length : null,
  };
}

const IC_EXCLUDE = new Set(["r", "px", "skew", "term", "atmIv", "skewDays"]);

export function featureColumnsOf(row) {
  const out = {};
  for (const key of Object.keys(row || {})) {
    if (IC_EXCLUDE.has(key)) continue;
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (key === "fam" && v && typeof v === "object") {
      for (const f of Object.keys(v)) {
        if (typeof v[f] === "number" && Number.isFinite(v[f])) out["fam." + f] = v[f];
      }
    } else if (key === "pr" && Array.isArray(v)) {
      v.forEach((x, i) => {
        if (typeof x === "number" && Number.isFinite(x)) out["pr." + i] = x;
      });
    }
  }
  return out;
}

export const IC_SESSION_MIN_N = 20;

export const IC_RANK_OVERLAPS = 3;

export const IC_VOL_WINDOW = 21;
export const IC_VOL_MIN_RETURNS = 10;

export function entryVol(row, closesByTicker, calendar, calendarIdx, d, {
  hrSessions = 10, window = IC_VOL_WINDOW, minReturns = IC_VOL_MIN_RETURNS, breaks = null,
} = {}) {
  const hr = fin(row && row.hr);
  if (hr !== null && hr > 0 && hrSessions > 0) return hr / Math.sqrt(hrSessions);
  const i = calendarIdx.get(d);
  const series = closesByTicker && row ? closesByTicker.get(row.t) : null;
  if (i === undefined || !series) return null;
  const cuts = breaks instanceof Map ? breaks.get(row.t) : null;
  const rets = [];
  for (let j = i; j > Math.max(0, i - window); j--) {
    const from = calendar[j - 1], to = calendar[j];
    if (Array.isArray(cuts) && cuts.some((b) => b > from && b <= to)) continue;
    const a = fin(series.get(from)), b = fin(series.get(to));
    if (a === null || b === null || a <= 0 || b <= 0) continue;
    rets.push(Math.log(b / a));
  }
  if (rets.length < minReturns) return null;
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  const v = rets.reduce((x, y) => x + (y - m) * (y - m), 0) / (rets.length - 1);
  return v > 0 ? Math.sqrt(v) : null;
}

export function icTable(datedBoards, closesByTicker, calendar, {
  k = 10,
  minN = 20,
  pearson,
  percentileRank,

  epoch = null,

  horizons = null,
  breaks = null,

  sessionMinN = IC_SESSION_MIN_N,
  rankOverlaps = IC_RANK_OVERLAPS,
  through = null,
  hrSessions = 10,
} = {}) {
  if (typeof pearson !== "function" || typeof percentileRank !== "function") {
    throw new Error("icTable needs the pearson and percentileRank helpers");
  }
  const cal = typeof through === "string" && through
    ? calendar.filter((d) => d <= through) : calendar;
  const calendarIdx = new Map(cal.map((d, i) => [d, i]));

  const ks = [k, ...(Array.isArray(horizons) ? horizons : [])]
    .filter((h) => Number.isInteger(h) && h > 0);
  const kSet = [...new Set(ks)];

  const pairsByKey = new Map();
  const bucketFor = (key, h, pre) => {
    let byH = pairsByKey.get(key);
    if (!byH) { byH = new Map(); pairsByKey.set(key, byH); }
    let cell = byH.get(h);
    if (!cell) {
      cell = { cur: { xs: [], ys: [] }, pre: { xs: [], ys: [] }, sessions: new Map() };
      byH.set(h, cell);
    }
    return cell;
  };

  const seenInSession = new Set();
  let unscaled = 0;

  for (const b of datedBoards || []) {
    if (!b || typeof b.d !== "string") continue;
    const pre = Boolean(epoch) && b.d < epoch;
    for (const row of Array.isArray(b.rows) ? b.rows : []) {
      const entry = fin(row && row.px);
      if (entry === null || entry <= 0) continue;
      const cols = featureColumnsOf(row);
      const keys = Object.keys(cols);
      if (!keys.length) continue;

      const once = !pre && !seenInSession.has(b.d + "|" + row.t);
      if (once) seenInSession.add(b.d + "|" + row.t);
      let sigma;
      for (const h of kSet) {
        const fc = forwardClose(closesByTicker, cal, calendarIdx, row.t, b.d, h, breaks);
        if (fc.state !== "ok") continue;
        const y = fc.exit / entry - 1;
        if (once && sigma === undefined) {
          sigma = entryVol(row, closesByTicker, cal, calendarIdx, b.d, { hrSessions, breaks });
          if (sigma === null) unscaled++;
        }
        for (const key of keys) {
          const cell = bucketFor(key, h, pre);
          const p = pre ? cell.pre : cell.cur;
          p.xs.push(cols[key]); p.ys.push(y);
          if (!once || sigma === null) continue;
          let s = cell.sessions.get(b.d);
          if (!s) { s = { xs: [], zs: [], rs: [] }; cell.sessions.set(b.d, s); }
          s.xs.push(cols[key]); s.zs.push(y / (sigma * Math.sqrt(h))); s.rs.push(y);
        }
      }
    }
  }

  const coefficient = (pair) => {
    const n = pair ? pair.xs.length : 0;
    if (n < minN) return { ic: null, n, reason: `fewer than ${minN} measured pairs` };
    const rho = pearson(percentileRank(pair.xs), percentileRank(pair.ys));
    if (!Number.isFinite(rho)) return { ic: null, n, reason: "no variation to rank" };
    return { ic: round(rho, 3), n };
  };

  const perSession = (cell, h) => {
    const rankedFrom = rankOverlaps * h;
    const dates = cell ? [...cell.sessions.keys()].sort() : [];
    const ics = [], mkts = [];
    let deep = 0;
    for (const d of dates) {
      const s = cell.sessions.get(d);
      if (s.xs.length < sessionMinN) continue;
      deep++;
      const rho = pearson(percentileRank(s.xs), percentileRank(s.zs));
      if (!Number.isFinite(rho)) continue;
      ics.push(rho);
      mkts.push(s.rs.reduce((a, v) => a + v, 0) / s.rs.length);
    }
    const n = ics.length;
    if (!n) {
      return {
        icMean: null, icSd: null, icSessions: 0, icPos: null, icMkt: null, icT: null,
        ranked: false, rankedFrom,
        icReason: deep
          ? "no variation to rank in any session"
          : `no session reached ${sessionMinN} measured names`,
      };
    }
    const mean = ics.reduce((a, v) => a + v, 0) / n;
    const sd = n > 1
      ? Math.sqrt(ics.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1)) : null;
    const mkt = n >= 3 ? pearson(ics, mkts) : NaN;
    const ranked = n >= rankedFrom;
    const t = ranked && sd !== null && sd > 0 ? mean / (sd / Math.sqrt(n / h)) : null;
    const out = {
      icMean: round(mean, 3),
      icSd: sd === null ? null : round(sd, 3),
      icSessions: n,
      icPos: round(ics.filter((v) => v > 0).length / n, 3),
      icMkt: Number.isFinite(mkt) ? round(mkt, 3) : null,
      icT: t === null ? null : round(t, 2),
      ranked,
      rankedFrom,
    };
    if (!ranked) {
      out.rankReason = `${n} scored session${n === 1 ? "" : "s"} against the ${rankedFrom} ` +
        `a ${h}-session horizon needs before a mean is ranked`;
    }
    return out;
  };

  const cols = [...pairsByKey.keys()].map((key) => {
    const byH = pairsByKey.get(key);
    const stated = coefficient(byH.get(k) && byH.get(k).cur);
    const out = { key, ic: stated.ic, n: stated.n };
    if (stated.reason) out.reason = stated.reason;
    Object.assign(out, perSession(byH.get(k), k));

    if (epoch) {
      const before = byH.get(k) && byH.get(k).pre;
      if (before && before.xs.length) {
        const prior = coefficient(before);
        out.priorIc = prior.ic;
        out.priorN = prior.n;
        if (prior.reason) out.priorReason = prior.reason;
      }
    }

    if (kSet.length > 1) {
      const curve = kSet.slice().sort((a, b) => a - b).map((h) => {
        const c = coefficient(byH.get(h) && byH.get(h).cur);
        const s = perSession(byH.get(h), h);
        return { k: h, ic: c.ic, n: c.n, icMean: s.icMean, icSessions: s.icSessions };
      });
      out.curve = curve;
      let peak = null;
      for (const point of curve) {
        if (point.ic === null) continue;
        if (peak === null || Math.abs(point.ic) > Math.abs(peak.ic)) peak = point;
      }

      out.icPeak = peak ? peak.ic : null;
      out.icPeakK = peak ? peak.k : null;
    }
    return out;
  });

  const tier = (c) => (c.ranked ? 0 : c.icMean !== null ? 1 : 2);
  const strength = (c) => (tier(c) < 2 ? Math.abs(c.icMean) : c.ic === null ? -1 : Math.abs(c.ic));
  cols.sort((a, b) => (tier(a) - tier(b)) || (strength(b) - strength(a)) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const table = {
    k, minN, cols,
    sessionMinN,
    rankedFrom: rankOverlaps * k,
    ranked: cols.filter((c) => c.ranked).length,
    unscaled,
  };
  if (cal !== calendar) table.through = through;

  if (epoch) table.epoch = epoch;
  if (kSet.length > 1) table.horizons = kSet.slice().sort((a, b) => a - b);
  return table;
}

export const RECORD_NOTES = {
  method: "spearman = pearson(percentileRank(feature), percentileRank(forward return)), " +
    "measured WITHIN each session on the return scaled by the name's own daily volatility " +
    "at entry, r / (σ·√k), and averaged across sessions; the pooled coefficient beside it " +
    "ranks every session's raw pairs together and is secondary. Returns are close-to-close " +
    "price returns from each row's published px, raw, not side-signed",
  perSession: "one rank correlation pooled across sessions scores a volatility feature on " +
    "which way the market went: in a session that rose, the volatile names sit at the top " +
    "of the return ranking, and in one that fell, at the bottom. Each session is therefore " +
    `ranked on its own, once it holds ${IC_SESSION_MIN_N} measured names, and the table ` +
    "reports the mean of those session coefficients, their standard deviation, the share " +
    "that were positive, and the correlation between each session's coefficient and that " +
    "session's mean forward return. A feature whose session coefficient tracks the " +
    "market's return is a bet on direction, not a ranking signal, whatever its mean",
  ranking: "k-session windows that start on consecutive sessions overlap, so N scored " +
    "sessions hold about N/k independent readings. A feature is ranked, and carries a " +
    "t-statistic of mean / (sd / √(N/k)), only from " + IC_RANK_OVERLAPS + "k scored " +
    "sessions; below that its mean is printed unranked and no t is computed. An exit " +
    "dated after the last completed session is not scored: a bar still trading is not a close",
  selection: "archived rows are the published extremes only, so these are ICs conditional " +
    "on selection, not universe ICs",
  overlap: "consecutive sessions share most of a multi-session window, so n counts rows, " +
    "not independent observations — at the 10-session horizon the effective sample is " +
    "roughly n/10",
  calendar: "the trading calendar is the union of observed close dates; a k-session " +
    "horizon walks that calendar, never calendar days",
  attrition: "a name with no close at the exit date, or whose vendor price history breaks " +
    "between entry and exit (an unadjusted split or a re-listed series), is counted in `lost` " +
    "and excluded from every mean — never scored as zero and never scored across the break",
  epoch: "the selection rule that decides which names a board publishes changed on the " +
    "stated date; sessions before it were drawn from a different pool, so their mean is " +
    "reported separately rather than averaged into the current one — same headings, " +
    "same units, a different population",
  dispersion: "every horizon mean carries the sample standard deviation of the session " +
    "spreads behind it and the standard error of that mean, sd / sqrt(n). The standard " +
    "error is a SPREAD, not a test: consecutive sessions share most of a multi-session " +
    "window, so the overlap deflation above applies to it too and no t-statistic or " +
    "p-value is computed from it. A single session has no measured dispersion and " +
    "reports none rather than reporting zero",
  pooled: "the hit rate on each horizon row is pooled over NAMES — every measured name " +
    "on both boards across the scored sessions, counted once each, and summed from the " +
    "per-session counts rather than averaged from the per-session rates, which would " +
    "weight a session that measured four names like one that measured two hundred. Its " +
    "denominator is hitN and counts names; n beside it counts sessions, and the two are " +
    "different quantities. The populations either side of the selection epoch are pooled " +
    "separately: one hit rate averaged across both would belong to neither",
};
