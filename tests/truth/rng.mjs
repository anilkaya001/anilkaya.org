import { createHash } from "node:crypto";

export function lgamma(x) {
  if (!(x > 0)) return NaN;
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const y = x - 1;
  let a = c[0];
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

export function seedWords(seed) {
  const h = createHash("sha256").update(String(seed)).digest();
  return [h.readUInt32BE(0), h.readUInt32BE(4), h.readUInt32BE(8), h.readUInt32BE(12)];
}

export function sfc32(a, b, c, d) {
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  return next;
}

export function makeRng(seed) {
  const [a, b, c, d] = seedWords(seed);
  const next = sfc32(a, b, c, d);
  for (let i = 0; i < 15; i++) next();
  let spare = null;
  const rng = {
    seed: String(seed),
    next,
    uniform() { return (next() + 0.5) / 4294967296; },
    normal() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u, v, s;
      do { u = 2 * rng.uniform() - 1; v = 2 * rng.uniform() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      const f = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * f;
      return u * f;
    },
    gamma(shape) {
      if (shape < 1) return rng.gamma(shape + 1) * Math.pow(rng.uniform(), 1 / shape);
      const d1 = shape - 1 / 3, c1 = 1 / Math.sqrt(9 * d1);
      for (;;) {
        let x, v;
        do { x = rng.normal(); v = 1 + c1 * x; } while (v <= 0);
        v = v * v * v;
        const u = rng.uniform();
        if (u < 1 - 0.0331 * x * x * x * x) return d1 * v;
        if (Math.log(u) < 0.5 * x * x + d1 * (1 - v + Math.log(v))) return d1 * v;
      }
    },
    studentUnit(nu) {
      const g = 2 * rng.gamma(nu / 2);
      return (rng.normal() / Math.sqrt(g / nu)) * Math.sqrt((nu - 2) / nu);
    },
    poisson(lambda) {
      if (!(lambda > 0)) return 0;
      if (lambda < 10) {
        const limit = Math.exp(-lambda);
        let k = 0, p = 1;
        do { k++; p *= rng.uniform(); } while (p > limit);
        return k - 1;
      }
      const slam = Math.sqrt(lambda), loglam = Math.log(lambda);
      const b = 0.931 + 2.53 * slam, a = -0.059 + 0.02483 * b;
      const invalpha = 1.1239 + 1.1328 / (b - 3.4), vr = 0.9277 - 3.6224 / (b - 2);
      for (;;) {
        const u = rng.uniform() - 0.5, v = rng.uniform();
        const us = 0.5 - Math.abs(u);
        const k = Math.floor(((2 * a) / us + b) * u + lambda + 0.43);
        if (us >= 0.07 && v <= vr) return k;
        if (k < 0 || (us < 0.013 && v > us)) continue;
        if (Math.log(v) + Math.log(invalpha) - Math.log(a / (us * us) + b) <= -lambda + k * loglam - lgamma(k + 1)) return k;
      }
    },
    negBin(mean, dispersion) {
      if (!(mean > 0)) return 0;
      if (!(dispersion > 0) || !Number.isFinite(dispersion)) return rng.poisson(mean);
      return rng.poisson(rng.gamma(dispersion) * (mean / dispersion));
    },
    bernoulli(p) { return rng.uniform() < p; },
    int(n) { return Math.min(n - 1, Math.floor(rng.uniform() * n)); },
    child(label) { return makeRng(rng.seed + "|" + label); },
  };
  return rng;
}

export function gammaQ(a, x) {
  if (!(x > 0)) return 1;
  const g = lgamma(a);
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 1000; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-16) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - g));
  }
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - g) * h;
}

export function normalSurvival(x) {
  const q = 0.5 * gammaQ(0.5, (x * x) / 2);
  return x >= 0 ? q : 1 - q;
}

export function normalCdf(x) { return normalSurvival(-x); }

export function normalQuantile(p) {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425;
  let x;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5, r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  for (let i = 0; i < 2; i++) {
    const e = normalCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}
