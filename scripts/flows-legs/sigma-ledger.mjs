import { sigmaProfile } from "../../shared/flows-targets.js";

export const SIGMA_LEDGER_VERSION = 1;
export const SIGMA_ROTATE = 240;
export const SIGMA_MAX_AGE_DAYS = 45;

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const dayN = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);

export function readLedger(prior) {
  const l = prior && prior.sigmaLedger;
  const out = new Map();
  if (!l || l.v !== SIGMA_LEDGER_VERSION || !Array.isArray(l.t)) return out;
  for (let i = 0; i < l.t.length; i++) {
    const s = l.s[i] / 1e5;
    if (typeof l.t[i] === "string" && Number.isFinite(s) && s > 0 && isDay(l.d[i])) {
      out.set(l.t[i], { s, n: l.n[i], f2: l.f2[i], f3: l.f3[i], d: l.d[i] });
    }
  }
  return out;
}

export const SIGMA_SHORT_RETRY_DAYS = 20;

export function writeLedger(entries, short = new Map()) {
  const t = [...entries.keys()].sort();
  return {
    v: SIGMA_LEDGER_VERSION,
    t,
    s: t.map((k) => Math.round(entries.get(k).s * 1e5)),
    n: t.map((k) => entries.get(k).n),
    f2: t.map((k) => entries.get(k).f2),
    f3: t.map((k) => entries.get(k).f3),
    d: t.map((k) => entries.get(k).d),
    x: [...short].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  };
}

export async function runSigmaLedger({
  sessionDate, universe, fresh, prior, fetchBars, rotate = SIGMA_ROTATE, maxAgeDays = SIGMA_MAX_AGE_DAYS, stop = () => false,
}) {
  const held = readLedger(prior);
  const entries = new Map();
  const shortHeld = new Map();
  const today = isDay(sessionDate) ? dayN(sessionDate) : null;
  const age = (e) => (today === null ? 0 : today - dayN(e.d));
  for (const [t, e] of held) if (universe.has(t) && age(e) <= maxAgeDays) entries.set(t, e);
  const ledgerX = prior && prior.sigmaLedger && Array.isArray(prior.sigmaLedger.x) ? prior.sigmaLedger.x : [];
  for (const row of ledgerX) {
    if (Array.isArray(row) && universe.has(row[0]) && isDay(row[1]) && (today === null || today - dayN(row[1]) < SIGMA_SHORT_RETRY_DAYS)) shortHeld.set(row[0], row[1]);
  }
  let freshN = 0;
  for (const [t, r] of fresh) {
    if (!universe.has(t) || !r || !r.ok || !isDay(sessionDate)) continue;
    entries.set(t, { s: r.s, n: r.n, f2: r.f2, f3: r.f3, d: sessionDate });
    freshN++;
  }
  const todo = [...universe]
    .filter((t) => !fresh.has(t) && !shortHeld.has(t))
    .map((t) => ({ t, e: entries.get(t) || null }))
    .sort((a, b) => (a.e ? dayN(a.e.d) : -1) - (b.e ? dayN(b.e.d) : -1) || (a.t < b.t ? -1 : 1))
    .slice(0, Math.max(0, rotate));
  let read = 0;
  let failed = 0;
  let short = 0;
  const reasons = {};
  for (const { t } of todo) {
    if (stop() || !fetchBars) break;
    let got = null;
    try { got = await fetchBars(t); } catch { got = null; }
    if (!got) { failed++; continue; }
    read++;
    const r = sigmaProfile(got.bars, { breaks: got.breaks });
    if (r.ok) entries.set(t, { s: r.s, n: r.n, f2: r.f2, f3: r.f3, d: sessionDate });
    else {
      short++;
      const why = r.reason || "unknown";
      reasons[why] = (reasons[why] || 0) + 1;
      entries.delete(t);
      shortHeld.set(t, sessionDate);
    }
  }
  const dates = [...entries.values()].map((e) => e.d).sort();
  const sigma = new Map([...entries].map(([t, e]) => [t, { ok: true, s: e.s, n: e.n, f2: e.f2, f3: e.f3 }]));
  return {
    sigma,
    ledger: writeLedger(entries, shortHeld),
    basis: {
      universe: universe.size, covered: entries.size, fresh: freshN, rotated: read, failed, short, held: shortHeld.size, reasons,
      oldest: dates.length ? dates[0] : null, maxAgeDays, rotate,
    },
  };
}
