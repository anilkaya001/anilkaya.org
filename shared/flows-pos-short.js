import { SECTOR_ORDER, daysBetween, isDay } from "./flows-pos-13f.js";

export const SHORT = Object.freeze({ heavyShare: 0.005, ftdWindowDays: 21, topN: 40, svxMaxS: 3 * 86400, ftdMaxS: 21 * 86400 });

const isInt = Number.isSafeInteger;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

export function halfAway(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

function newestFtd(part) {
  if (!part || !part.x || !Array.isArray(part.x.rows)) return null;
  let best = null;
  for (const r of part.x.rows) {
    if (!Array.isArray(r) || !isDay(r[0]) || !isInt(r[1]) || r[1] < 0) continue;
    if (best === null || r[0] > best[0]) best = r;
  }
  return best;
}

export function ftdView(names, adv, now) {
  const rows = [];
  let asOf = null;
  for (const n of names) {
    const r = newestFtd(n.ftd);
    if (!r) continue;
    const pxC = isInt(r[2]) && r[2] > 0 ? r[2] : null;
    const a = adv && adv[n.t];
    const advOk = typeof a === "number" && Number.isFinite(a) && a > 0 ? a : null;
    rows.push({
      t: n.t, sec: n.sec || null, date: r[0], q: r[1], pxC,
      notional: pxC === null ? null : halfAway((r[1] * pxC) / 100),
      adv: advOk, share: advOk === null ? null : r4(r[1] / advOk),
    });
    if (asOf === null || r[0] > asOf) asOf = r[0];
  }
  if (!rows.length) return { asOf: null, names: 0, sectors: [], top: [], unpriced: 0 };
  const sectors = [];
  for (const s of SECTOR_ORDER) {
    const inSector = names.filter((n) => n.sec === s);
    const mine = rows.filter((r) => r.sec === s);
    const newest = mine.reduce((m, r) => (m === null || r.date > m ? r.date : m), null);
    const fresh = newest === null ? [] : mine.filter((r) => daysBetween(r.date, newest) <= SHORT.ftdWindowDays);
    const priced = fresh.filter((r) => r.notional !== null);
    sectors.push({
      s,
      notional: priced.length ? priced.reduce((a, r) => a + r.notional, 0) : null,
      heavy: fresh.filter((r) => r.share !== null && r.share >= SHORT.heavyShare).length,
      n: priced.length,
      unread: inSector.length - fresh.length,
      unpriced: fresh.length - priced.length,
    });
  }
  const top = rows.filter((r) => r.share !== null)
    .sort((a, b) => (b.share - a.share) || ((b.notional || 0) - (a.notional || 0)) || (a.t < b.t ? -1 : 1))
    .slice(0, SHORT.topN);
  return { asOf, names: rows.length, sectors, top, unpriced: rows.filter((r) => r.notional === null).length };
}

function usable(part, now) {
  if (!part || !part.x || !Array.isArray(part.x.days) || !part.x.last || !Array.isArray(part.x.last.venues)) return false;
  return !(typeof part.at === "number" && now - part.at > SHORT.svxMaxS * 1000);
}

export function venueView(names, now) {
  const mix = new Map();
  const sec = new Map(SECTOR_ORDER.map((s) => [s, { short: 0, total: 0, n: 0 }]));
  const top = [];
  let asOf = null;
  let count = 0;
  for (const n of names) {
    const p = n.svx;
    if (!p || !p.x || !p.x.last) continue;
    const last = p.x.last;
    if (!isDay(last.date)) continue;
    const venues = last.venues.filter((v) => Array.isArray(v) && isInt(v[2]) && isInt(v[3]) && v[2] >= 0 && v[3] >= 0);
    if (!venues.length) continue;
    count++;
    if (asOf === null || last.date > asOf) asOf = last.date;
    const short = venues.reduce((a, v) => a + v[2], 0);
    const total = venues.reduce((a, v) => a + v[3], 0);
    for (const v of venues) {
      const m = mix.get(v[0]) || { short: 0, total: 0 };
      m.short += v[2]; m.total += v[3];
      mix.set(v[0], m);
    }
    const days = Array.isArray(p.x.days) ? p.x.days.filter((d) => Array.isArray(d) && isInt(d[1]) && isInt(d[2])) : [];
    const s10 = days.reduce((a, d) => a + d[1], 0);
    const t10 = days.reduce((a, d) => a + d[2], 0);
    if (usable(p, now) && sec.has(n.sec)) {
      const c = sec.get(n.sec);
      c.short += short; c.total += total; c.n++;
    }
    top.push({ t: n.t, sec: n.sec || null, ratio: total > 0 ? r4(short / total) : null, ratio10: t10 > 0 ? r4(s10 / t10) : null, venues: venues.length, total });
  }
  if (!count) return { asOf: null, names: 0, mix: [], sectors: [], top: [] };
  const sumShort = [...mix.values()].reduce((a, m) => a + m.short, 0);
  const mixOut = [...mix.entries()]
    .map(([x, m]) => ({ x, short: m.short, total: m.total, share: sumShort > 0 ? r4(m.short / sumShort) : null }))
    .sort((a, b) => (b.short - a.short) || (a.x < b.x ? -1 : 1));
  const sectors = SECTOR_ORDER.map((s) => {
    const c = sec.get(s);
    return { s, short: c.n ? c.short : null, total: c.n ? c.total : null, ratio: c.n && c.total > 0 ? r4(c.short / c.total) : null, n: c.n };
  });
  const ranked = top.filter((r) => r.ratio !== null)
    .sort((a, b) => (b.ratio - a.ratio) || (b.total - a.total) || (a.t < b.t ? -1 : 1))
    .slice(0, SHORT.topN)
    .map(({ total, ...rest }) => rest);
  return { asOf, names: count, mix: mixOut, sectors, top: ranked };
}

export function shortView(names, adv, now) {
  const ftd = ftdView(names, adv, now);
  const venues = venueView(names, now);
  if (!ftd.names && !venues.names) return { status: "pending", why: "unread", ftd, venues };
  return { status: ftd.names && venues.names ? "ok" : "partial", ftd, venues };
}
