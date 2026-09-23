import {
  vnum, vstr, isoDay, addDays, sessionsBetween, easternDayOfInstant, ownZ, zScores, mean,
  SILENCE,
} from "./flows-cross.js";

export const SHORT_INTEREST_MAX_AGE_DAYS = 45;

export const SHORT_AVAILABLE_CAP = 10_000_000;

export const HTB_FEE = 0.03;

export const SVR_WINDOW = 60;

export const SVR_MIN = 40;

export const INSIDER_DAYS = 90;

export const CLUSTER_DAYS = 30;

export const CLUSTER_MIN = 3;

export const INSIDER_DOTS = 40;

export function latestShortInterest(rows, { sessionDate = null, maxAgeDays = SHORT_INTEREST_MAX_AGE_DAYS } = {}) {
  const best = new Map();
  let future = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const t = vstr(r.symbol) || vstr(r.ticker);
    const d = isoDay(r.market_date);
    if (!t || !d) continue;
    if (sessionDate && d > sessionDate) { future++; continue; }
    const prev = best.get(t);
    if (!prev || d > prev.date) {
      best.set(t, {
        date: d,
        si: vnum(r.si_float),
        siSynth: vnum(r.si_float_with_synth_long_pct_of_total_shares),
        dtc: vnum(r.days_to_cover),
        shares: vnum(r.short_interest),
        float: vnum(r.total_float),
      });
    }
  }
  const floor = sessionDate ? addDays(sessionDate, -maxAgeDays) : null;
  for (const [t, v] of best) {
    v.stale = floor ? v.date < floor : null;
    v.ageDays = sessionDate ? Math.round((Date.parse(sessionDate) - Date.parse(v.date)) / 86400000) : null;
    best.set(t, v);
  }
  return { byTicker: best, future };
}

export function borrowSummary(rows, { sessionDate = null, dfeeSessions = 5, pathDays = 10 } = {}) {
  const snaps = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const ts = vstr(r.timestamp);
    const ms = ts ? Date.parse(ts) : NaN;
    if (!Number.isFinite(ms)) continue;
    const day = easternDayOfInstant(ts);
    if (!day || (sessionDate && day > sessionDate)) continue;
    const feePct = vnum(r.fee_rate);
    const rebatePct = vnum(r.rebate_rate);
    snaps.push({
      ms, day,
      fee: feePct === null ? null : feePct / 100,
      rebate: rebatePct === null ? null : rebatePct / 100,
      avail: vnum(r.short_shares_available),
    });
  }
  if (!snaps.length) return { status: "quiet", reason: SILENCE.absent };
  snaps.sort((a, b) => a.ms - b.ms);
  const byDay = new Map();
  for (const s of snaps) byDay.set(s.day, s);
  const days = [...byDay.keys()].sort();
  const lastDay = days[days.length - 1];
  const last = byDay.get(lastDay);
  const back = days.length > dfeeSessions ? byDay.get(days[days.length - 1 - dfeeSessions]) : null;
  const censored = last.avail !== null && last.avail >= SHORT_AVAILABLE_CAP;
  return {
    status: "ok",
    asOf: new Date(last.ms).toISOString(),
    day: lastDay,
    sameSession: sessionDate ? lastDay === sessionDate : null,
    fee: last.fee,
    rebate: last.rebate,
    avail: last.avail,
    availCensored: censored,
    dFee5: back && back.fee !== null && last.fee !== null ? last.fee - back.fee : null,
    dFee5From: back ? back.day : null,
    htb: last.fee === null ? null : last.fee >= HTB_FEE,
    htbAt: HTB_FEE,
    snapshots: snaps.length,
    path: days.slice(-pathDays).map((d) => {
      const s = byDay.get(d);
      return [d, s.fee === null ? null : Number(s.fee.toFixed(6)), s.avail];
    }),
    units: { fee: "fraction per year", rebate: "fraction per year", avail: "shares (10,000,000 reads as a cap)" },
  };
}

export function shortVolumeSummary(rows, { sessionDate = null, window = SVR_WINDOW, min = SVR_MIN } = {}) {
  const list = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = isoDay(r && r.market_date);
    if (!d || (sessionDate && d > sessionDate)) continue;
    const ratio = vnum(r.short_volume_ratio);
    const sv = vnum(r.short_volume), tv = vnum(r.total_volume);
    const derived = ratio !== null ? ratio : sv !== null && tv !== null && tv > 0 ? sv / tv : null;
    list.push({ d, ratio: derived, sv, tv });
  }
  list.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (!list.length) return { status: "quiet", reason: SILENCE.absent };
  const latest = list[list.length - 1];
  const prior = list.slice(0, -1).slice(-window).map((x) => x.ratio);
  const z = ownZ(prior, latest.ratio, { min });
  return {
    status: "ok",
    date: latest.d,
    sameSession: sessionDate ? latest.d === sessionDate : null,
    ratio: latest.ratio,
    shortVolume: latest.sv,
    totalVolume: latest.tv,
    mean60: z.mean, sd60: z.sd, z: z.z, n: z.n, reason: z.reason,
    avg5: mean(list.slice(-5).map((x) => x.ratio)),
    path: list.slice(-20).map((x) => [x.d, x.ratio === null ? null : Number(x.ratio.toFixed(4))]),
    rule: "z of the latest FINRA short-volume ratio against the 60 sessions before it; a 40-50% baseline is market-making, not short interest",
  };
}

const roleOf = (r) => (r.is_officer === true ? "O" : r.is_director === true ? "D"
  : r.is_ten_percent_owner === true ? "T" : null);

export function insiderSummary(rows, {
  sessionDate = null, days = INSIDER_DAYS, clusterDays = CLUSTER_DAYS, clusterMin = CLUSTER_MIN,
  dotCap = INSIDER_DOTS,
} = {}) {
  const seen = new Set();
  const txs = [];
  const from = sessionDate ? addDays(sessionDate, -days) : null;
  let future = 0, otherCodes = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const id = vstr(r.id) || (Array.isArray(r.ids) && r.ids.length ? String(r.ids.join(",")) : null);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const d = isoDay(r.transaction_date);
    const f = isoDay(r.filing_date);
    if (!d) continue;
    if (sessionDate && (d > sessionDate || (f && f > sessionDate))) { future++; continue; }
    if (from && d <= from) continue;
    const code = vstr(r.transaction_code);
    if (code !== "P" && code !== "S") { otherCodes++; continue; }
    const amount = vnum(r.amount);
    const price = vnum(r.price);
    const shares = amount === null ? null : (code === "S" ? -1 : 1) * Math.abs(amount);
    const usd = shares !== null && price !== null && price > 0 ? shares * price : null;
    txs.push({
      d, f, code, amount: shares, price, usd,
      who: vstr(r.reporter_cik) || vstr(r.owner_name),
      role: roleOf(r),
      plan: r.is_10b5_1 === true,
    });
  }
  const sum = (list) => list.reduce((a, x) => (x.usd === null ? a : a + x.usd), 0);
  const sideSum = (list) => (!list.length ? 0 : list.some((x) => x.usd !== null) ? sum(list) : null);
  const priced = txs.filter((x) => x.usd !== null);
  const buys = txs.filter((x) => x.code === "P");
  const sells = txs.filter((x) => x.code === "S");
  const buyers = new Set(buys.map((x) => x.who).filter(Boolean));

  let cluster = false, clusterBuyers = 0, clusterFrom = null;
  const sortedBuys = buys.filter((x) => x.who).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  for (let i = 0; i < sortedBuys.length; i++) {
    const end = addDays(sortedBuys[i].d, clusterDays - 1);
    const inWin = new Set();
    for (let j = i; j < sortedBuys.length && sortedBuys[j].d <= end; j++) inWin.add(sortedBuys[j].who);
    if (inWin.size > clusterBuyers) { clusterBuyers = inWin.size; clusterFrom = sortedBuys[i].d; }
    if (inWin.size >= clusterMin) cluster = true;
  }

  const dots = priced.slice().sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd)).slice(0, dotCap)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
    .map((x) => [x.d, Math.round(x.usd), x.code, x.role, x.plan ? 1 : 0]);
  const lastFiling = txs.reduce((m, x) => (x.f && (!m || x.f > m) ? x.f : m), null);
  return {
    status: txs.length ? "ok" : "quiet",
    ...(txs.length ? {} : { reason: SILENCE.absent }),
    days,
    from, to: sessionDate,
    n: txs.length,
    unpriced: txs.length - priced.length,
    net90: priced.length ? sum(priced) : null,
    net90ExPlan: priced.length ? sum(priced.filter((x) => !x.plan)) : null,
    buys90: sideSum(buys),
    sells90: sideSum(sells),
    buyCount: buys.length,
    sellCount: sells.length,
    buyers: buyers.size,
    cluster,
    clusterBuyers,
    clusterFrom: cluster ? clusterFrom : null,
    clusterRule: `${clusterMin} or more distinct buyers inside ${clusterDays} calendar days`,
    planShare: sells.length ? sells.filter((x) => x.plan).length / sells.length : null,
    lastFiling,
    future,
    otherCodes,
    dots,
    dotCols: ["transaction date", "signed usd", "code P|S", "role O|D|T|null", "10b5-1 plan 1|0"],
  };
}

export function groupInsiderRows(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = vstr(r && r.ticker);
    if (!t) continue;
    if (!out.has(t)) out.set(t, []);
    out.get(t).push(r);
  }
  return out;
}

export function squeezePressure(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const zs = {
    si: zScores(list.map((e) => (Number.isFinite(e.si) ? e.si : null))),
    dtc: zScores(list.map((e) => (Number.isFinite(e.dtc) ? e.dtc : null))),
    fee: zScores(list.map((e) => (Number.isFinite(e.fee) ? e.fee : null))),
  };
  const out = new Map();
  list.forEach((e, i) => {
    const parts = [zs.si[i], zs.dtc[i], zs.fee[i]];
    out.set(e.t, {
      zSi: parts[0], zDtc: parts[1], zFee: parts[2],
      pressure: parts.every((v) => v !== null) ? parts[0] + parts[1] + parts[2] : null,
      n: list.length,
    });
  });
  return out;
}

export function sessionsSince(day, sessionDate) {
  return sessionsBetween(day, sessionDate);
}
