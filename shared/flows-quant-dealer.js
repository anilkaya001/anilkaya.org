const fin = (v) => typeof v === "number" && Number.isFinite(v);

const INV_SQRT_2PI = 0.3989422804014327;

function expNegHalfSq(x) {
  const ax = Math.abs(x);
  const xs = Math.trunc(ax * 16) / 16;
  return Math.exp(-xs * xs / 2) * Math.exp(-(ax - xs) * (ax + xs) / 2);
}

function kernels(contracts, r, q) {
  const n = contracts.length;
  const c1 = new Float64Array(n), c2 = new Float64Array(n), lk = new Float64Array(n), w = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const c = contracts[i];
    if (!(c.K > 0) || !(c.sigma > 0) || !(c.T > 0)) continue;
    const nu = c.sigma * Math.sqrt(c.T);
    const sgn = c.type === "C" ? 1 : -1;
    c1[m] = 1 / nu;
    c2[m] = (r - q + c.sigma * c.sigma / 2) * c.T / nu;
    lk[m] = Math.log(c.K);
    w[m] = sgn * c.oi * Math.exp(-q * c.T) * INV_SQRT_2PI / nu;
    m++;
  }
  return { c1, c2, lk, w, m };
}

function profileValue(k, x) {
  if (!(x > 0)) return 0;
  const lx = Math.log(x);
  let g = 0;
  for (let j = 0; j < k.m; j++) {
    const d1 = k.c1[j] * (lx - k.lk[j]) + k.c2[j];
    g += k.w[j] * (Number.isFinite(d1) ? expNegHalfSq(d1) : 0);
  }
  return g * x;
}

export function polishRoot(f, a, fa, b, fb, tol) {
  let side = 0;
  for (let n = 0; n < 60 && Math.abs(b - a) > tol; n++) {
    const c = (a * fb - b * fa) / (fb - fa);
    const fc = f(c);
    if (fc === 0) return c;
    if ((fc < 0) === (fb < 0)) { b = c; fb = fc; if (side === 1) fa /= 2; side = 1; }
    else { a = c; fa = fc; if (side === -1) fb /= 2; side = -1; }
  }
  return (a * fb - b * fa) / (fb - fa);
}

export function zeroCrossings(grid, values, at, tol) {
  const out = [];
  let last = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === 0) continue;
    if (last >= 0 && (values[i] < 0) !== (values[last] < 0)) {
      out.push(i - last > 1 ? grid[last + 1] : polishRoot(at, grid[last], values[last], grid[i], values[i], tol));
    }
    last = i;
  }
  return out;
}

export function gammaProfile(input) {
  const { spot, contracts } = input;
  const points = input.points || 121, span = input.span || 0.15;
  const r = fin(input.r) ? input.r : 0, q = fin(input.q) ? input.q : 0;
  const k = kernels(contracts, r, q);
  const at = (x) => profileValue(k, x);
  const grid = [], gex = [];
  for (let i = 0; i < points; i++) {
    const x = spot * (1 - span + 2 * span * i / (points - 1));
    grid.push(x); gex.push(at(x));
  }
  const flips = zeroCrossings(grid, gex, at, 1e-10 * spot);
  flips.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b);
  return { grid, gex, flip: flips.length ? flips[0] : null, flips, at };
}
