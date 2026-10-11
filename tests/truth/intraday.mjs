import { makeRng } from "./rng.mjs";
import { w3bSession } from "./worlds.mjs";

export const W9_DEFAULTS = Object.freeze({
  seed: "w9",
  names: 670,
  sectors: 11,
  sessions: 120,
  cadence: 1,
  innovation: "t",
  nuRange: Object.freeze([4, 8]),
  nuSet: null,
  sectorSigns: false,
  gapNu: 0,
  garch: Object.freeze({ alpha: 0.05, beta: 0.93 }),
  dayGarch: Object.freeze({ alpha: 0.08, beta: 0.9 }),
  marketRho: 0.15,
  sectorRho: 0.3,
  betaDrift: 0.2,
  gapShare: 0.25,
  clockDecay: 30,
  clockPeak: 2.2,
  seasonalError: 0.1,
  scaleError: 0,
  scaleErrorLaw: "normal",
  regimeScale: false,
  hotRate: 0,
  hotFactor: 2.2,
  jumpRate: 0,
  jumpSizes: Object.freeze([3, 4, 6, 8]),
  jumpSpreads: Object.freeze([1, 15, 60]),
  factorJumpRate: 0,
  factorJumpSize: 4,
  eventRate: 0,
  eventSize: 3,
  badTickRate: 0,
  badTickSizes: Object.freeze([5, 20]),
  staleByBucket: Object.freeze([0, 0, 0]),
  headlineRate: 0,
  headlineTieProbability: 0.7,
  headlineLeads: Object.freeze([-15, 0, 10]),
  headlineCausedProbability: 0,
  flowAnomalies: 0,
  volCluster: Object.freeze({ sd: 0, halfLife: 30 }),
  serial: Object.freeze({ kappa: 0, memory: 20 }),
  bounce: Object.freeze({ half: 0, every: 5 }),
  dayTypes: Object.freeze(["normal"]),
  keepTruth: false,
  plantJumps: null,
  paths: true,
});

export const FOMC_MINUTE = 270;

export const W9_WORLDS = Object.freeze({
  W9: Object.freeze({ id: "W9", title: "the intraday multi-name world", family: "calibration" }),
  W9o: Object.freeze({ id: "W9o", title: "the out-of-family intraday world", family: "out-of-family" }),
});
export const SCALE_ERROR_LAWS = Object.freeze(["normal", "t3", "contaminated"]);

function pickNu(o, u) {
  if (o.nuSet) return o.nuSet[Math.min(o.nuSet.length - 1, Math.floor(u * o.nuSet.length))];
  return Math.min(o.nuRange[1], o.nuRange[0] + Math.floor(u * (o.nuRange[1] - o.nuRange[0] + 1)));
}

function law(rng, kind) {
  if (kind === "t3") return rng.studentUnit(3);
  if (kind === "contaminated") return (rng.uniform() < 0.9 ? 0.6 * rng.normal() : 2.2 * rng.normal()) / Math.sqrt(0.9 * 0.36 + 0.1 * 4.84);
  return rng.normal();
}

export function clockShape(minutes, decay, peak) {
  const u = new Float64Array(minutes);
  let total = 0;
  for (let m = 0; m < minutes; m++) {
    u[m] = 1 + (peak - 1) * (Math.exp(-m / decay) + Math.exp(-(minutes - 1 - m) / decay));
    total += u[m];
  }
  for (let m = 0; m < minutes; m++) u[m] /= total;
  return u;
}

export function w9World(opts = {}) {
  const o = { ...W9_DEFAULTS, ...opts };
  const rng = makeRng(`${o.seed}|world`);
  const N = o.names;
  const names = [];
  for (let i = 0; i < N; i++) {
    const r = rng.child(`name${i}`);
    const bucket = Math.floor(i / o.sectors) % 3;
    names.push({
      id: i,
      ticker: "N" + String(i).padStart(3, "0"),
      sector: i % o.sectors,
      bucket,
      sigma0: 0.012 * Math.exp(0.45 * r.normal() + 0.25 * bucket),
      beta0: Math.min(1.8, Math.max(0.4, 1 + 0.3 * r.normal())),
      nu: pickNu(o, r.uniform()),
      bounceName: o.bounce.half > 0 && i % o.bounce.every === 0,
      sign: 1,
    });
  }
  if (o.sectorSigns) {
    const rs = rng.child("sector-signs");
    for (let i = 0; i < N; i++) names[i].sign = rs.uniform() < 0.5 ? -1 : 1;
  }
  const marketScale = new Float64Array(o.sessions);
  {
    const r = rng.child("daygarch");
    let h = 1;
    for (let d = 0; d < o.sessions; d++) {
      const s = Math.sqrt(h);
      marketScale[d] = s;
      const e = s * r.normal();
      h = (1 - o.dayGarch.alpha - o.dayGarch.beta) + o.dayGarch.alpha * e * e + o.dayGarch.beta * h;
    }
  }
  const sorted = Float64Array.from(marketScale).sort();
  const stressLine = sorted[Math.floor(0.8 * (sorted.length - 1))];
  return { opts: o, names, marketScale, stressLine, session: (d) => w9Session(o, names, marketScale, stressLine, d) };
}

function w9Session(o, names, marketScale, stressLine, d) {
  const N = names.length;
  const root = makeRng(`${o.seed}|session|${d}`);
  const type = o.dayTypes[d % o.dayTypes.length];
  const minutes = type === "earlyClose" ? 210 : 390;
  const gapShare = type === "cpi" ? Math.min(0.5, 2 * o.gapShare) : o.gapShare;
  const intraday = (1 - gapShare) * (type === "earlyClose" ? 210 / 390 : 1);
  const shape = clockShape(minutes, o.clockDecay, o.clockPeak);
  const clockTrue = new Float64Array(minutes);
  for (let m = 0; m < minutes; m++) clockTrue[m] = intraday * shape[m];
  const clockForecast = new Float64Array(minutes);
  {
    const r = root.child("seasonal");
    let s = 0, total = 0;
    for (let m = 0; m < minutes; m++) {
      if (m % 15 === 0) s = o.seasonalError * r.normal();
      clockForecast[m] = shape[m] * Math.exp(s);
      total += clockForecast[m];
    }
    for (let m = 0; m < minutes; m++) clockForecast[m] = (clockForecast[m] / total) * intraday;
  }
  const stress = marketScale[d] > stressLine;
  const rErr = root.child("scale-error");
  const sigmaTrue = new Float64Array(N), sigmaForecast = new Float64Array(N), scaleLogError = new Float64Array(N), hot = new Uint8Array(N);
  const sEff = o.scaleError * (o.regimeScale ? (stress ? 1.9 : 0.8) : 1);
  for (let i = 0; i < N; i++) {
    const base = names[i].sigma0 * marketScale[d] * Math.exp(0.2 * rErr.normal());
    const isHot = o.hotRate > 0 && rErr.uniform() < o.hotRate;
    const e = sEff * law(rErr, o.scaleErrorLaw) + (isHot ? Math.log(o.hotFactor) : 0);
    hot[i] = isHot ? 1 : 0;
    scaleLogError[i] = e;
    sigmaForecast[i] = base;
    sigmaTrue[i] = base * Math.exp(e);
  }
  if (!o.paths) return { day: d, type, minutes, names: N, stress, marketScale: marketScale[d], sigmaTrue, sigmaForecast, scaleLogError, hot, clockTrue, clockForecast, gapShare, labels: null };
  const rBase = root.child("base");
  const lf = Math.sqrt(o.marketRho), ls = Math.sqrt((1 - o.marketRho) * o.sectorRho), li = Math.sqrt((1 - o.marketRho) * (1 - o.sectorRho));
  const a = Math.pow(2, -1 / o.volCluster.halfLife), aSerial = Math.exp(-1 / o.serial.memory), aBeta = Math.exp(-1 / 120);
  const trueInc = new Float64Array(N * minutes);
  const gap = new Float64Array(N);
  const fm = new Float64Array(minutes);
  const factorJumps = [];
  {
    const r = root.child("factor-jumps");
    if (o.factorJumpRate > 0 && r.uniform() < o.factorJumpRate) factorJumps.push({ minute: 5 + r.int(minutes - 10), size: (r.uniform() < 0.5 ? -1 : 1) * o.factorJumpSize });
    if (type === "fomc") factorJumps.push({ minute: FOMC_MINUTE, size: (r.uniform() < 0.5 ? -1 : 1) * 1.5, scheduled: true });
  }
  const events = [];
  const rEvent = root.child("events");
  const vstate = new Float64Array(N), hstate = new Float64Array(N), hist = new Float64Array(N), bstate = new Float64Array(N), garchH = new Float64Array(N).fill(1), garchE = new Float64Array(N);
  const sectorG = new Float64Array(o.sectors);
  const gapDraw = root.child("gap");
  for (let i = 0; i < N; i++) {
    let g = Math.sqrt(gapShare) * sigmaTrue[i] * (o.gapNu > 0 ? gapDraw.studentUnit(o.gapNu) : gapDraw.normal());
    if (o.eventRate > 0 && rEvent.uniform() < o.eventRate) {
      const size = o.eventSize * (rEvent.uniform() < 0.5 ? -1 : 1) * (0.7 + 0.6 * rEvent.uniform());
      g += size * sigmaTrue[i];
      events.push({ name: i, minute: 0, size, kind: "scheduled-gap" });
    }
    gap[i] = g;
  }
  const fomcAfter = type === "fomc" ? FOMC_MINUTE : -1;
  for (let m = 0; m < minutes; m++) {
    const fact = o.innovation === "t" ? rBase.studentUnit(5) : rBase.normal();
    fm[m] = fact;
    for (let s = 0; s < o.sectors; s++) sectorG[s] = o.innovation === "t" ? rBase.studentUnit(5) : rBase.normal();
    const stressNow = fomcAfter >= 0 && m >= fomcAfter && m < fomcAfter + 10 ? 2.2 : 1;
    for (let i = 0; i < N; i++) {
      const nm = names[i];
      let eps;
      if (o.innovation === "t") eps = rBase.studentUnit(nm.nu);
      else if (o.innovation === "garch") {
        eps = Math.sqrt(garchH[i]) * rBase.normal();
        garchH[i] = (1 - o.garch.alpha - o.garch.beta) + o.garch.alpha * eps * eps + o.garch.beta * garchH[i];
      } else eps = rBase.normal();
      bstate[i] = aBeta * bstate[i] + Math.sqrt(1 - aBeta * aBeta) * rBase.normal();
      const b = nm.beta0 * (1 + o.betaDrift * bstate[i]);
      let z = (lf * b * fact + ls * nm.sign * sectorG[nm.sector] + li * eps) / Math.sqrt(o.marketRho * b * b + 1 - o.marketRho);
      if (o.serial.kappa !== 0) { z += o.serial.kappa * hist[i]; hist[i] = aSerial * hist[i] + (1 - aSerial) * z * 10; }
      let vm = 1;
      if (o.volCluster.sd > 0) {
        vstate[i] = a * vstate[i] + o.volCluster.sd * Math.sqrt(1 - a * a) * rBase.normal();
        vm = Math.exp(vstate[i] - (o.volCluster.sd * o.volCluster.sd) / 2);
      }
      trueInc[i * minutes + m] = sigmaTrue[i] * Math.sqrt(clockTrue[m]) * vm * z * stressNow;
    }
  }
  for (const fj of factorJumps) {
    for (let i = 0; i < N; i++) trueInc[i * minutes + fj.minute] += fj.size * sigmaTrue[i] * Math.sqrt(o.marketRho) * names[i].beta0;
  }
  const jumps = [];
  {
    const r = root.child("jumps");
    const plan = o.plantJumps ? o.plantJumps.filter((j) => j.day === undefined || j.day === d) : null;
    if (plan) for (const j of plan) jumps.push({ ...j });
    else if (o.jumpRate > 0) {
      for (let i = 0; i < N; i++) {
        const k = r.poisson(o.jumpRate);
        for (let c = 0; c < k; c++) {
          const spread = o.jumpSpreads[r.int(o.jumpSpreads.length)];
          const size = (r.uniform() < 0.5 ? -1 : 1) * o.jumpSizes[r.int(o.jumpSizes.length)];
          const start = 5 + r.int(Math.max(1, minutes - spread - 10));
          jumps.push({ name: i, start, spread, size });
        }
      }
    }
    for (const j of jumps) for (let m = j.start; m < Math.min(minutes, j.start + j.spread); m++) trueInc[j.name * minutes + m] += (j.size * sigmaTrue[j.name]) / j.spread;
  }
  const observed = new Float64Array(N * minutes);
  const badTicks = [];
  {
    const rTick = root.child("ticks"), rStale = root.child("stale"), rBounce = root.child("bounce");
    for (let i = 0; i < N; i++) {
      const nm = names[i];
      const pStale = o.staleByBucket[nm.bucket];
      const tickAt = o.badTickRate > 0 && rTick.uniform() < o.badTickRate ? 3 + rTick.int(minutes - 6) : -1;
      let cumTrue = 0, cumObs = 0;
      for (let m = 0; m < minutes; m++) {
        cumTrue += trueInc[i * minutes + m];
        let px = cumTrue;
        if (nm.bounceName) {
          const q = rBounce.uniform() < 0.5 ? -1 : 1;
          px += o.bounce.half * q;
        }
        if (m === tickAt) {
          const local = sigmaTrue[i] * Math.sqrt(clockTrue[m]);
          const mult = o.badTickSizes[0] + (o.badTickSizes[1] - o.badTickSizes[0]) * rTick.uniform();
          const sign = rTick.uniform() < 0.5 ? -1 : 1;
          px += sign * mult * local;
          badTicks.push({ name: i, minute: m, localSds: sign * mult });
        }
        const stale = pStale > 0 && m < minutes - 1 && rStale.uniform() < pStale;
        if (!stale) { observed[i * minutes + m] = px - cumObs; cumObs = px; }
      }
    }
  }
  const headlines = [];
  {
    const r = root.child("headlines");
    for (let i = 0; i < N; i++) {
      const k = o.headlineRate > 0 ? r.poisson(o.headlineRate * (names[i].bucket === 0 ? 2 : 1)) : 0;
      for (let c = 0; c < k; c++) headlines.push({ name: i, minute: r.int(minutes), kind: "independent" });
    }
    jumps.forEach((j, idx) => {
      if (o.headlineRate > 0 && r.uniform() < o.headlineTieProbability) {
        const lead = o.headlineLeads[r.int(o.headlineLeads.length)];
        headlines.push({ name: j.name, minute: Math.min(minutes - 1, Math.max(0, j.start + lead)), kind: "tied", jump: idx, lead });
      }
    });
    if (o.headlineCausedProbability > 0) {
      for (let i = 0; i < N; i++) {
        const local = sigmaTrue[i];
        let acc = 0;
        for (let m = 0; m < minutes; m++) {
          acc += trueInc[i * minutes + m] - (m >= 5 ? trueInc[i * minutes + m - 5] : 0);
          if (Math.abs(acc) > 0.4 * local && r.uniform() < o.headlineCausedProbability) {
            headlines.push({ name: i, minute: Math.min(minutes - 1, m + 1 + r.int(10)), kind: "caused" });
            acc = 0;
            m += 10;
          }
        }
      }
    }
  }
  const flowAnomalies = [];
  {
    const r = root.child("flow");
    for (let c = 0; c < o.flowAnomalies; c++) flowAnomalies.push({ name: r.int(N), start: 30 + r.int(Math.max(1, minutes - 90)), multiplier: [2, 3, 5][r.int(3)] });
  }
  const bars = Math.floor(minutes / o.cadence);
  const inc = new Float64Array(N * bars);
  for (let i = 0; i < N; i++) for (let m = 0; m < bars * o.cadence; m++) inc[i * bars + Math.floor(m / o.cadence)] += observed[i * minutes + m];
  return {
    day: d, type, minutes, bars, cadence: o.cadence, names: N, inc, gap, stress, marketScale: marketScale[d], gapShare,
    sigmaTrue, sigmaForecast, scaleLogError, hot, clockTrue, clockForecast, factor: fm,
    trueInc: o.keepTruth ? trueInc : null, observed: o.keepTruth ? observed : null,
    labels: { jumps, badTicks, headlines, events, flowAnomalies, factorJumps },
    flowCounts: (i, extra = {}) => {
      const anomaly = flowAnomalies.find((f) => f.name === i);
      const lam = (20000 / 390 / 3) * (names[i].bucket === 0 ? 3 : names[i].bucket === 1 ? 1 : 0.3);
      return w3bSession({ seed: `${o.seed}|flow|${d}|${i}`, names: 1, lambda: lam, sdDay: 0.25, surgeMultiplier: anomaly ? anomaly.multiplier : 1, surgeStart: anomaly ? anomaly.start : 1e9, ...extra }).names[0].counts;
    },
  };
}

export const W9_OUT_OF_FAMILY = Object.freeze({
  innovation: "garch",
  scaleError: 0.2,
  scaleErrorLaw: "t3",
  regimeScale: true,
  hotRate: 0.03,
  hotFactor: 2.2,
  volCluster: Object.freeze({ sd: 0.5, halfLife: 30 }),
  serial: Object.freeze({ kappa: 0.02, memory: 20 }),
  bounce: Object.freeze({ half: 0.0005, every: 5 }),
  badTickRate: 0.05,
  staleByBucket: Object.freeze([0, 0.1, 0.4]),
  dayTypes: Object.freeze(["normal", "normal", "fomc", "normal", "cpi", "normal", "earlyClose", "normal"]),
});

export function w9OutOfFamily(opts = {}) {
  return w9World({ ...W9_OUT_OF_FAMILY, ...opts });
}
