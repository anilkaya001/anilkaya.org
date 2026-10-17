export const NIGHT = "2026-10-16";
export const GENERATED_AT = "2026-10-16T21:31:53.908Z";
const T = 1e12;

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SECTORS = ["Technology", "Financials", "Health Care", "Energy", "Utilities", "Industrials"];

export const SPECIAL = [
  ["SPY", 0.006, 0.16, 90, "Funds", 40 * T, 0.0065, 14, 3],
  ["QQQ", 0.011, 0.22, 90, "Funds", 20 * T, 0.0085, 11, 2],
  ["BIGUP", 0.094, 0.4, 60, "Technology", 3 * T, 0.02, 20, 4],
  ["BIGDN", -0.081, 0.35, 60, "Financials", 0.8 * T, 0.03, 12, 2],
  ["MIDUP", 0.052, 0.3, 60, "Technology", 1.2 * T, 0.02, 9, 0],
  ["EARNUP", 0.12, 0.3, 5, "Technology", 0.4 * T, 0.02, 20, 4],
  ["EARNDN", -0.09, 0.4, 21, "Financials", 0.15 * T, 0.03, 12, 2],
  ["FLAT", 0, 0.3, 60, "Utilities", 0.05 * T, 0.01, 30, 5],
  ["NOIV", 0.2, null, 60, "Utilities", 0.1 * T, 0.02, 9, 1],
  ["NOSIG", 0.07, 0.3, 60, "Energy", 0.2 * T, null, null, null],
  ["NOCAP", -0.06, 0.3, 60, "Energy", null, 0.02, 9, 1],
  ["NOSEC", 0.045, 0.25, 60, null, 0.05 * T, 0.015, 15, 3],
  ["EDGE", 0.15, 0.2, 60, "Industrials", 0.02 * T, 0.01, 8, 1],
];

export function names(n = 640, seed = 7) {
  const rnd = mulberry32(seed);
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) * 1.4142; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const sig = 0.008 + rnd() * 0.03;
    const iv = 0.18 + rnd() * 0.6;
    const chg = Math.round(gauss() * sig * 1.1 * 1e4) / 1e4;
    const ed = rnd() < 0.08 ? Math.floor(rnd() * 21) + 1 : rnd() < 0.5 ? 40 + Math.floor(rnd() * 20) : null;
    const cap = Math.round(Math.exp(Math.log(2e9) + rnd() * 7) / 1e8) * 1e8;
    const f2 = Math.floor(rnd() * 22), f3 = Math.floor(rnd() * 6);
    out.push(["N" + String(i).padStart(3, "0"), chg, Math.round(iv * 1e4) / 1e4, ed, SECTORS[i % SECTORS.length], cap, Math.round(sig * 1e5) / 1e5, f2, f3]);
  }
  return [...SPECIAL, ...out];
}

export function universe(list, o = {}) {
  const sectors = [...new Set(list.map((n) => n[4]).filter(Boolean))];
  const body = {
    status: "ok", sessionDate: o.session || NIGHT, generatedAt: GENERATED_AT, t: list.map((n) => n[0]),
    cols: {
      chg: list.map((n) => Math.round(n[1] * 1e4)),
      iv30p: list.map((n) => (n[2] === null ? null : Math.round(n[2] * 1e4))),
      ed: list.map((n) => n[3]),
      sig: list.map((n) => (n[6] === null || n[6] === undefined ? null : Math.round(n[6] * 1e5))),
      f2: list.map((n) => (n[7] === undefined ? null : n[7])),
      f3: list.map((n) => (n[8] === undefined ? null : n[8])),
    },
    units: { chg: ["frac", 1e4], iv30p: ["frac", 1e4], ed: ["sessions", 1], sig: ["fraction", 1e5], f2: ["days per 252", 1], f3: ["days per 252", 1] },
  };
  if (!o.noSec) { body.sectors = sectors; body.sec = list.map((n) => (n[4] ? sectors.indexOf(n[4]) : null)); }
  if (!o.noCap) { body.cols.mcap = list.map((n) => (n[5] === null ? null : Math.round(n[5] / 1e8))); body.units.mcap = ["usd", 1e-8]; }
  return body;
}

export function decoded(body) {
  const sec = body.sec || [];
  return body.t.map((t, i) => ({
    t,
    chg: body.cols.chg[i] / body.units.chg[1],
    iv: body.cols.iv30p[i] === null ? null : body.cols.iv30p[i] / body.units.iv30p[1],
    ed: body.cols.ed[i],
    sig: body.cols.sig[i] === null ? null : body.cols.sig[i] / body.units.sig[1],
    f2: body.cols.f2[i], f3: body.cols.f3[i],
    cap: body.cols.mcap && body.cols.mcap[i] !== null ? body.cols.mcap[i] / body.units.mcap[1] : null,
    sector: body.sectors && sec[i] !== null && sec[i] !== undefined ? body.sectors[sec[i]] : null,
  }));
}

export const CARD = (t, o = {}) => ({
  v: 1, ticker: t, sessionDate: "2026-10-16", conviction: 64, regime: { label: "long", flowLabel: "short" },
  x: { vol: { iv30Pct: 0.4234, iv30: 0.318 } },
  panels: {
    premiumTrack: { status: "ok", rows: [{ d: "2026-10-15", p: -4400079 }, { d: "2026-10-16", p: 12500000 }] },
    scoreOverlay: { status: "ok", rows: Array.from({ length: o.closes === undefined ? 30 : o.closes }, (_, i) => ({ d: new Date(Date.parse("2026-10-16T00:00:00Z") - (29 - i) * 864e5).toISOString().slice(0, 10), close: 100 + i * 0.5 + (i % 3) })) },
    surface: { spot: 115 },
  },
});
