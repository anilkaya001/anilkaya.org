import { mean, median, sampleSd, wilson, tCritical975 } from "./flows-stats.js";
import { EARNINGS_MIN_EVENTS } from "./flows-catalysts.js";
import { vnum } from "./flows-cross.js";
import { roundTo } from "./flows-er-eps.js";

export const VERDICTS = Object.freeze(["rich", "cheap", "inline", "few"]);
export const POOL_MIN_NAMES = 5;

const num = (v) => vnum(v);

export function scoreEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let missing = 0;
  let zeros = 0;
  const xs = [];
  const ln = [];
  const ratios = [];
  const abs = [];
  let beats = 0;
  for (const ev of list) {
    const em = Array.isArray(ev) ? num(ev[2]) : null;
    const m1d = Array.isArray(ev) ? num(ev[3]) : null;
    if (em === null || m1d === null || !(em > 0)) { missing++; continue; }
    const a = Math.abs(m1d);
    abs.push(a);
    ratios.push(a / em);
    if (a > em) beats++;
    if (a === 0) { zeros++; continue; }
    xs.push(Math.log(a / em));
    ln.push(Math.log(a));
  }
  const used = xs.length;
  const n = used + zeros;
  let meanLog = null;
  let lo = null;
  let hi = null;
  if (used >= 1) meanLog = mean(xs);
  if (used >= 2) {
    const half = tCritical975(used - 1) * sampleSd(xs) / Math.sqrt(used);
    lo = meanLog - half;
    hi = meanLog + half;
  }
  const verdict = used < EARNINGS_MIN_EVENTS ? "few" : hi < 0 ? "rich" : lo > 0 ? "cheap" : "inline";
  const beat = n ? beats / n : null;
  const w = beat === null ? null : wilson(beat, n);
  let hitN = 0;
  let hits = 0;
  for (const ev of list) {
    const ls = Array.isArray(ev) ? num(ev[6]) : null;
    if (ls === null) continue;
    hitN++;
    if (ls > 0) hits++;
  }
  const sdLn = ln.length >= 2 ? sampleSd(ln) : null;
  return {
    hist: {
      n, used, zeros, missing,
      medR: n ? roundTo(median(ratios), 6) : null,
      beat: beat === null ? null : roundTo(beat, 6),
      beatLo: w ? roundTo(w[0], 6) : null,
      beatHi: w ? roundTo(w[1], 6) : null,
      meanLog: meanLog === null ? null : roundTo(meanLog, 4),
      lo: lo === null ? null : roundTo(lo, 4),
      hi: hi === null ? null : roundTo(hi, 4),
      verdict,
      mv: n ? roundTo(median(abs), 6) : null,
      hit: hitN ? roundTo(hits / hitN, 6) : null,
      hitN,
    },
    meanLn: ln.length ? mean(ln) : null,
    sdLn,
    mvRaw: n ? median(abs) : null,
  };
}

export function todayOf(emNow, scored) {
  const em = num(emNow);
  const mv = scored.mvRaw;
  const todayR = em !== null && mv !== null && mv > 0 ? roundTo(em / mv, 6) : null;
  const h = scored.hist;
  const todayZ = em !== null && em > 0 && h.used >= EARNINGS_MIN_EVENTS && scored.sdLn !== null && scored.sdLn > 0
    ? roundTo((Math.log(em) - scored.meanLn) / scored.sdLn, 4) : null;
  return { todayR, todayZ };
}

export function concordance(evs) {
  let w = 0;
  let a = 0;
  let f = 0;
  let n = 0;
  for (const ev of Array.isArray(evs) ? evs : []) {
    const m = Array.isArray(ev) ? num(ev[2]) : null;
    const s = Array.isArray(ev) ? num(ev[3]) : null;
    if (m === null || s === null) continue;
    n++;
    if (m === 0 || s === 0) f++;
    else if (Math.sign(m) === Math.sign(s)) w++;
    else a++;
  }
  const dec = w + a;
  const ci = dec >= 4 ? wilson(w / dec, dec) : null;
  return { n, with: w, against: a, flat: f, lo: ci ? roundTo(ci[0], 6) : null, hi: ci ? roundTo(ci[1], 6) : null };
}

export function pooledVerdict(rows) {
  const counts = { rich: 0, cheap: 0, inline: 0, few: 0 };
  const means = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const h = r && r.hist;
    if (!h || !VERDICTS.includes(h.verdict)) continue;
    counts[h.verdict]++;
    if (h.used >= EARNINGS_MIN_EVENTS && h.meanLog !== null) means.push(h.meanLog);
  }
  const n = means.length;
  if (n < 2) return { n, ...counts, meanLog: n ? roundTo(mean(means), 4) : null, lo: null, hi: null };
  const m = mean(means);
  const half = tCritical975(n - 1) * sampleSd(means) / Math.sqrt(n);
  return { n, ...counts, meanLog: roundTo(m, 4), lo: roundTo(m - half, 4), hi: roundTo(m + half, 4) };
}
