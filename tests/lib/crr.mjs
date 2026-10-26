export function americanCRR({ S, K, r, sigma, T, type, div = null, steps = 160, american = true }) {
  const n = steps;
  const dt = T / n;
  const u = Math.exp(sigma * Math.sqrt(dt)), d = 1 / u;
  const disc = Math.exp(-r * dt);
  const p = (Math.exp(r * dt) - d) / (u - d);
  const pv = (t) => (div && t < div.t ? div.amount * Math.exp(-r * (div.t - t)) : 0);
  const Sstar = S - pv(0);
  const sign = type === "C" ? 1 : -1;
  const vals = new Float64Array(n + 1);
  for (let j = 0; j <= n; j++) {
    const s = Sstar * Math.pow(u, 2 * j - n) + pv(T);
    vals[j] = Math.max(0, sign * (s - K));
  }
  for (let i = n - 1; i >= 0; i--) {
    const t = i * dt;
    const extra = pv(t);
    for (let j = 0; j <= i; j++) {
      const cont = disc * (p * vals[j + 1] + (1 - p) * vals[j]);
      if (!american) { vals[j] = cont; continue; }
      const s = Sstar * Math.pow(u, 2 * j - i) + extra;
      const ex = sign * (s - K);
      vals[j] = cont > ex ? cont : ex;
    }
  }
  return vals[0];
}

export function europeanForward({ S, r, T, div = null }) {
  const pv = div && div.t < T ? div.amount * Math.exp(-r * div.t) : 0;
  return (S - pv) * Math.exp(r * T);
}
