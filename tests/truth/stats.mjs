export const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };

export const variance = (a) => {
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
  return s / (a.length - 1);
};

export const sd = (a) => Math.sqrt(variance(a));

export function quantile(a, p) {
  const s = Float64Array.from(a).sort();
  const x = p * (s.length - 1);
  const lo = Math.floor(x), hi = Math.ceil(x);
  return s[lo] + (s[hi] - s[lo]) * (x - lo);
}

export const median = (a) => quantile(a, 0.5);

export function autocorrelation(x, lag) {
  const m = mean(x);
  let num = 0, den = 0;
  for (let t = 0; t < x.length; t++) {
    den += (x[t] - m) * (x[t] - m);
    if (t >= lag) num += (x[t] - m) * (x[t - lag] - m);
  }
  return num / den;
}

export function ksUniform(u) {
  const s = Float64Array.from(u).sort();
  let d = 0;
  for (let i = 0; i < s.length; i++) d = Math.max(d, Math.abs((i + 1) / s.length - s[i]), Math.abs(s[i] - i / s.length));
  return d;
}

export function wilson(k, n, z = 1.96) {
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function binomialSe(p, n) { return Math.sqrt((p * (1 - p)) / n); }
