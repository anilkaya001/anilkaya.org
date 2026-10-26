import { mulberry32, pick, between, chance } from "./sfc-rng.mjs";

export const SECTOR_NAMES = Object.freeze([
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services",
  "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
]);

export const WORLD_FUNDS = Object.freeze(["SPY", "QQQ", "IWM", "DIA", "XLK", "XLE", "GLD", "TLT", "SPX", "VIX", "IBIT", "EEM"]);

export const SESSION = "2026-10-23";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export const fixtureName = (i) => "SY" + LETTERS[i % LETTERS.length] + String(100 + ((i * 37) % 900));

const decimal = (rnd, magnitude, places = 2, floor = 1) => {
  const dollars = Math.floor(floor * Math.exp(rnd() * magnitude));
  let frac = "";
  for (let i = 0; i < places; i++) frac += Math.floor(rnd() * 10);
  return dollars + "." + frac;
};

const centsString = (cents) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + Math.floor(abs / 100) + "." + String(abs % 100).padStart(2, "0");
};

const parts = (s) => {
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
};

const isoAt = (day, minutes) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes + 4 * 60)).toISOString();
};

export function makeWorld(seed, { tickers = null, perName = 60, pathologies = true, session = SESSION, magnitude = 13, tight = false, floor = 1 } = {}) {
  const rnd = mulberry32(seed);
  const count = tickers ?? between(rnd, 1, 40);
  const names = [];
  const taken = new Set();
  for (let i = 0; names.length < count && i < 5000; i++) {
    const n = chance(rnd, 0.12) ? pick(rnd, WORLD_FUNDS) : chance(rnd, 0.08) ? "GONE" + between(rnd, 0, 9) : fixtureName(Math.floor(rnd() * 100000));
    if (taken.has(n)) continue;
    taken.add(n);
    names.push(n);
  }
  const universe = { t: [], sectors: [...SECTOR_NAMES], sec: [], cols: { mcap: [] }, units: { mcap: ["usd", 1e-8] } };
  for (const n of names) {
    if (n.startsWith("GONE") && chance(rnd, 0.7)) continue;
    universe.t.push(n);
    universe.sec.push(chance(rnd, 0.9) ? between(rnd, 0, SECTOR_NAMES.length - 1) : null);
    universe.cols.mcap.push(chance(rnd, 0.9) ? between(rnd, 1, 4000000) : chance(rnd, 0.5) ? null : 0);
  }
  const rows = [];
  for (const n of names) {
    const windows = between(rnd, 0, perName);
    for (let i = 0; i < windows; i++) {
      const cp = chance(rnd, 0.5) ? "C" : "P";
      const zero = pathologies && chance(rnd, 0.02);
      const premCents = zero ? 0 : parts(decimal(rnd, magnitude, 2, floor));
      const askCents = tight ? Math.floor(premCents * (0.4 + 0.55 * rnd())) : Math.floor(premCents * rnd() * 0.8);
      const bidCents = tight ? Math.floor((premCents - askCents) * (0.9 + 0.1 * rnd())) : Math.floor((premCents - askCents) * rnd() * 0.9);
      const raw = { prem: centsString(premCents), askPrem: centsString(askCents), bidPrem: centsString(bidCents), px: decimal(rnd, 5, 2) };
      if (raw.px.startsWith("0.")) raw.px = "1.25";
      if (pathologies) {
        if (chance(rnd, 0.03)) raw.askPrem = null;
        if (chance(rnd, 0.03)) raw.bidPrem = null;
        if (chance(rnd, 0.01)) raw.prem = null;
        if (chance(rnd, 0.015) && raw.prem !== null) raw.askPrem = centsString(parts(raw.prem) + 1 + Math.floor(rnd() * 5000));
        if (chance(rnd, 0.02)) raw.askPrem = "-5.00";
        if (chance(rnd, 0.04) && raw.prem !== null) raw.prem = raw.prem + String(between(rnd, 1, 99)).padStart(2, "0");
        if (chance(rnd, 0.03)) raw.px = null;
      }
      const minute = between(rnd, 9 * 60 + 30, 16 * 60 + 15);
      const row = {
        t: n, oc: n + "261120" + cp + String(between(rnd, 1, 400) * 1000).padStart(8, "0"), cp, k: between(rnd, 5, 600),
        exp: pick(rnd, [session, "2026-10-30", "2026-11-20", "2027-01-15"]),
        prem: raw.prem === null ? null : Number(raw.prem), askPrem: raw.askPrem === null ? null : Number(raw.askPrem),
        bidPrem: raw.bidPrem === null ? null : Number(raw.bidPrem),
        floor: pick(rnd, [true, false, null, false]), single: pick(rnd, [true, false, null, true, true]),
        size: pathologies && !tight && chance(rnd, 0.03) ? null : between(rnd, 1, 5000), px: raw.px === null ? null : Number(raw.px),
        ivStart: pathologies && chance(rnd, 0.06) ? null : 0.1 + rnd(), ivEnd: pathologies && chance(rnd, 0.06) ? null : 0.1 + rnd(),
        spanStart: isoAt(session, minute), spanEnd: isoAt(session, minute + between(rnd, 0, 20)),
        d: pathologies && chance(rnd, tight ? 0.01 : 0.07) ? null : (cp === "P" ? -1 : 1) * between(rnd, 0, 1000000),
      };
      if (pathologies) {
        if (chance(rnd, 0.02)) row.cp = null;
        if (chance(rnd, 0.02)) { row.spanStart = isoAt("2026-10-22", minute); row.spanEnd = row.spanStart; }
      }
      row.raw = raw;
      rows.push(row);
      if (pathologies && chance(rnd, 0.04)) rows.push({ ...row, raw: { ...raw } });
    }
  }
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const tide = {};
  for (const sector of SECTOR_NAMES) {
    tide[sector] = pathologies && chance(rnd, 0.12) ? null : {
      calls: Math.round((rnd() - 0.4) * 9e10),
      puts: Math.round((rnd() - 0.5) * 9e10),
    };
  }
  return { seed, session, rows, universe, tide };
}
