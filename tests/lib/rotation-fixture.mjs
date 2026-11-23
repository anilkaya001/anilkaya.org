import { ROTATION_FUNDS } from "../../shared/flows-rotation.js";

export function rotationDays(n = 251, from = "2025-11-21") {
  const days = [];
  let d = Date.parse(from + "T00:00:00Z");
  while (days.length < n) {
    const x = new Date(d);
    if (x.getUTCDay() % 6) days.push(x.toISOString().slice(0, 10));
    d += 86400000;
  }
  return days;
}

export function rotationSeries({ n = 251, seed = 7, drift = {} } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  const days = rotationDays(n);
  const out = {};
  ROTATION_FUNDS.forEach((f, i) => {
    let p = 40 + i * 17;
    out[f.t] = { d: days.slice(), c: days.map(() => Number((p *= Math.exp(rnd() * 0.02 + (drift[f.t] || 0))).toFixed(4))) };
  });
  return out;
}

export function rotationCard(series) {
  return { panels: { context: { candleKeys: ["date", "open", "high", "low", "close", "volume"], candles: series.d.map((d, i) => [d, series.c[i], series.c[i], series.c[i], series.c[i], 1000]) } } };
}
