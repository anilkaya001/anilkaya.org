import { SECTOR_ORDER, isDay } from "./flows-pos-13f.js";

export const INSIDER_DAYS = 60;

const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

function dayMap(rows) {
  const by = new Map();
  let bad = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isDay(r.date) || (r.buy_sell !== "buy" && r.buy_sell !== "sell")) { bad++; continue; }
    if (![r.transactions, r.uniq_insiders, r.volume].every(isCount)) { bad++; continue; }
    const cell = by.get(r.date) || { buy: null, sell: null };
    cell[r.buy_sell] = { tx: r.transactions, ins: r.uniq_insiders, vol: r.volume };
    by.set(r.date, cell);
  }
  return { by, bad };
}

export function insiderFlow(bySector, days = INSIDER_DAYS) {
  const maps = new Map();
  let bad = 0;
  for (const s of SECTOR_ORDER) {
    const rows = bySector && bySector[s];
    if (!Array.isArray(rows)) continue;
    const m = dayMap(rows);
    bad += m.bad;
    if (m.by.size) maps.set(s, m.by);
  }
  const unread = SECTOR_ORDER.filter((s) => !maps.has(s));
  if (!maps.size) return { status: "unavailable", why: "failed", window: null, sectors: [], unread, bad };
  const mins = [...maps.values()].map((m) => [...m.keys()].sort()[0]);
  const maxes = [...maps.values()].map((m) => [...m.keys()].sort().pop());
  const from = mins.sort().pop();
  const to = maxes.sort()[0];
  const union = new Set();
  for (const m of maps.values()) for (const d of m.keys()) if (d >= from && d <= to) union.add(d);
  const window = [...union].sort().slice(-days);
  if (!window.length) return { status: "quiet", why: "window", window: null, sectors: [], unread, bad };
  const sectors = [];
  for (const s of SECTOR_ORDER) {
    const m = maps.get(s);
    if (!m) continue;
    let buyers = 0, sellers = 0, buyTx = 0, sellTx = 0, buyVol = 0, sellVol = 0, gaps = 0;
    const out = [];
    for (const d of window) {
      const c = m.get(d);
      if (!c) { gaps++; out.push([d, null, null]); continue; }
      const b = c.buy ? c.buy.ins : 0;
      const x = c.sell ? c.sell.ins : 0;
      buyers += b; sellers += x;
      buyTx += c.buy ? c.buy.tx : 0; sellTx += c.sell ? c.sell.tx : 0;
      buyVol += c.buy ? c.buy.vol : 0; sellVol += c.sell ? c.sell.vol : 0;
      out.push([d, b, x]);
    }
    const net = buyers + sellers > 0 ? Math.round(((buyers - sellers) / (buyers + sellers)) * 1e4) / 1e4 : null;
    sectors.push({ s, buyers, sellers, buyTx, sellTx, buyVol, sellVol, net, gaps, days: out });
  }
  return {
    status: unread.length ? "partial" : "ok",
    window: { from: window[0], to: window[window.length - 1], sessions: window.length },
    sectors, unread, bad,
  };
}

export function insiderNet(sectors) {
  let buyers = 0, sellers = 0, parts = 0;
  for (const s of Array.isArray(sectors) ? sectors : []) { buyers += s.buyers; sellers += s.sellers; parts++; }
  if (!parts || buyers + sellers === 0) return { net: null, parts };
  return { net: Math.round(((buyers - sellers) / (buyers + sellers)) * 1e4) / 1e4, parts };
}
