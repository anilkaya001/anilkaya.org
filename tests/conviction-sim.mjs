export const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const normal = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
export const logistic = (z) => 1 / (1 + Math.exp(-z));

export function weekdays(count, start = "2026-01-05") {
  const out = [];
  let t = Date.parse(start + "T00:00:00Z");
  while (out.length < count) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

export function simulate({ sessions, perSide = 50, a = -0.2, b = 0, sessionSd = 0, bthEffect = 0, seed = 1, lead = 12, edge = 0.03, drift = 0 }) {
  const rnd = mulberry(seed);
  const cal = weekdays(sessions + lead);
  const closes = new Map();
  const boards = [];
  for (let s = 0; s < sessions; s++) {
    const d = cal[s];
    const u = sessionSd ? sessionSd * normal(rnd) : 0;
    const market = 0.002 * normal(rnd);
    const shift = drift ? drift * normal(rnd) : 0;
    for (const side of ["long", "short"]) {
      const sign = side === "long" ? 1 : -1;
      const rows = [];
      for (let i = 0; i < perSide; i++) {
        const t = `${side[0].toUpperCase()}${s}_${i}`;
        const cnv = Math.min(99, Math.max(1, Math.round(20 + 75 * rnd() + shift)));
        const bth = 2 + Math.floor(5 * rnd());
        const hit = rnd() < logistic(a + b * (cnv / 100) + bthEffect * (bth - 4) + u);
        const r = market + sign * (hit ? edge : -edge);
        rows.push({ t, px: 100, cnv, bth, agr: bth - 1 });
        const series = new Map();
        for (const h of [5, 10]) series.set(cal[s + h], 100 * (1 + r));
        closes.set(t, series);
      }
      boards.push({ d, side, rows });
    }
  }
  return { boards, closes, cal };
}
