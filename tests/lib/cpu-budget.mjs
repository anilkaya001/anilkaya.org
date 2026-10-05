export const CPU_CLOCK = typeof process.threadCpuUsage === "function" ? "thread-cpu" : "wall";

export function cpuNow() {
  if (CPU_CLOCK === "thread-cpu") { const c = process.threadCpuUsage(); return (c.user + c.system) / 1000; }
  return Number(process.hrtime.bigint()) / 1e6;
}

export function cpuClock() {
  return { clock: CPU_CLOCK, cpu: cpuNow };
}

export function clockResolution({ now = cpuNow, samples = 5, spinLimit = 5e6 } = {}) {
  let best = Infinity;
  for (let s = 0; s < samples; s++) {
    const t0 = now();
    let t1 = t0;
    for (let i = 0; i < spinLimit && t1 === t0; i++) t1 = now();
    if (t1 > t0) best = Math.min(best, t1 - t0);
  }
  return Number.isFinite(best) ? best : 0;
}

export function referenceKernel() {
  let acc = 0;
  const xs = new Float64Array(2048);
  for (let i = 0; i < xs.length; i++) xs[i] = Math.sin(i * 0.37) * 3;
  for (let rep = 0; rep < 60; rep++) {
    for (let i = 0; i < xs.length; i++) {
      const z = xs[i] + rep * 1e-3;
      const t = 1 / (1 + 0.2316419 * Math.abs(z));
      const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
      acc += Math.exp(-0.5 * z * z) * 0.3989422804014327 * poly + Math.log(1 + Math.abs(z)) * Math.sqrt(1 + z * z);
    }
    xs.sort();
  }
  return acc;
}

export function summarize(windows) {
  if (!windows.length || windows.length % 2) throw new Error("cpu-budget: an even, non-zero number of windows is required");
  const sorted = windows.slice().sort((a, b) => a - b);
  const n = sorted.length;
  return {
    windows: windows.slice(),
    mean: windows.reduce((a, b) => a + b, 0) / n,
    median: (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    p95: sorted[Math.min(n - 1, Math.floor(0.95 * n))],
    min: sorted[0],
    max: sorted[n - 1],
  };
}

const windowOf = (fn, perWindow, now) => {
  const t0 = now();
  for (let i = 0; i < perWindow; i++) fn();
  return (now() - t0) / perWindow;
};

export function measure(fn, { windows = 16, perWindow = 5, warmup = 40, now = cpuNow } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const out = [];
  for (let w = 0; w < windows; w++) out.push(windowOf(fn, perWindow, now));
  return summarize(out);
}

export function compare(subject, {
  reference = referenceKernel, windows = 16, perWindow = 5, warmup = 40, now = cpuNow, resolutionMs,
} = {}) {
  for (let i = 0; i < warmup; i++) { subject(); reference(); }
  const s = [], r = [];
  for (let w = 0; w < windows; w++) {
    if (w % 2) { r.push(windowOf(reference, perWindow, now)); s.push(windowOf(subject, perWindow, now)); }
    else { s.push(windowOf(subject, perWindow, now)); r.push(windowOf(reference, perWindow, now)); }
  }
  const resolution = resolutionMs ?? clockResolution({ now });
  const floorMs = resolution / perWindow;
  const subjectStats = summarize(s), referenceStats = summarize(r);
  if (!(referenceStats.median > 2 * floorMs)) {
    throw new Error(`cpu-budget: the reference measures ${referenceStats.median.toFixed(3)} ms a run, within twice the clock's floor of ${floorMs.toFixed(3)} ms (resolution ${resolution.toFixed(3)} ms over ${perWindow} runs); raise perWindow`);
  }
  return {
    clock: now === cpuNow ? CPU_CLOCK : "injected",
    perWindow, resolutionMs: resolution, floorMs,
    subject: subjectStats, reference: referenceStats,
    ratio: { median: subjectStats.median / referenceStats.median, worst: subjectStats.p95 / referenceStats.median },
  };
}

export function checkBudget(result, { median, worst, floorMs = result.floorMs } = {}) {
  const failures = [];
  const ref = result.reference.median;
  const limit = (ratio) => Math.max(ratio * ref, floorMs);
  if (median !== undefined && !(result.subject.median <= limit(median))) {
    failures.push(`median ${result.subject.median.toFixed(3)} ms is ${result.ratio.median.toFixed(2)}x the reference (${ref.toFixed(3)} ms), over ${median}x and over the floor of ${floorMs.toFixed(3)} ms`);
  }
  if (worst !== undefined && !(result.subject.p95 <= limit(worst))) {
    failures.push(`costliest window ${result.subject.p95.toFixed(3)} ms is ${result.ratio.worst.toFixed(2)}x the reference (${ref.toFixed(3)} ms), over ${worst}x and over the floor of ${floorMs.toFixed(3)} ms`);
  }
  return { ok: failures.length === 0, failures };
}

export function assertBudget(result, limits, label = "subject") {
  const { ok, failures } = checkBudget(result, limits);
  if (!ok) throw new Error(`cpu-budget: ${label} on the ${result.clock} clock: ${failures.join("; ")}`);
  return result;
}
