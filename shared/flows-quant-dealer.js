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

export function gammaProfile(input) {
  const { spot, contracts } = input;
  const points = input.points || 121, span = input.span || 0.15;
  const r = fin(input.r) ? input.r : 0, q = fin(input.q) ? input.q : 0;
  const grid = [], gex = [];
  const { c1, c2, lk, w, m } = kernels(contracts, r, q);
  for (let i = 0; i < points; i++) {
    const x = spot * (1 - span + 2 * span * i / (points - 1));
    let g = 0;
    if (x > 0) {
      const lx = Math.log(x);
      for (let j = 0; j < m; j++) {
        const d1 = c1[j] * (lx - lk[j]) + c2[j];
        g += w[j] * (Number.isFinite(d1) ? expNegHalfSq(d1) : 0);
      }
      g *= x;
    }
    grid.push(x); gex.push(g);
  }
  const flips = [];
  for (let i = 1; i < points; i++) {
    if ((gex[i - 1] < 0) !== (gex[i] < 0)) {
      const t = gex[i - 1] / (gex[i - 1] - gex[i]);
      flips.push(grid[i - 1] + t * (grid[i] - grid[i - 1]));
    }
  }
  flips.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b);
  return { grid, gex, flip: flips.length ? flips[0] : null, flips };
}
