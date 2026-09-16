export function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export const SHARES_PER_CONTRACT = 100;

export const DAYS_PER_YEAR = 365;

const OPTION_SYMBOL_RE = /^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/;

export function parseOptionSymbol(symbol) {
  if (typeof symbol !== "string") return null;
  const m = OPTION_SYMBOL_RE.exec(symbol.trim().toUpperCase());
  if (!m) return null;
  const [, ticker, yy, mm, dd, type, strikeDigits] = m;
  const month = Number(mm), day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const strike = Number(strikeDigits) / 1000;
  if (!(strike > 0)) return null;

  return { ticker, expiry: `20${yy}-${mm}-${dd}`, type, strike };
}

export function daysToExpiry(expiry, asOf) {
  const a = Date.parse(String(asOf).slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(String(expiry).slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function median(values) {
  const ok = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!ok.length) return null;
  const mid = ok.length >> 1;
  return ok.length % 2 ? ok[mid] : (ok[mid - 1] + ok[mid]) / 2;
}

export const IV_PERCENT_THRESHOLD = 5;

export function ivConvention(rawValues) {
  const m = median(rawValues.map(numOrNull).filter((v) => v !== null && v > 0));
  if (m === null) return { divisor: 1, basis: "no implied vol on this chain" };
  if (m > IV_PERCENT_THRESHOLD) return { divisor: 100, basis: `median ${m.toFixed(2)} reads as percent` };
  return { divisor: 1, basis: `median ${m.toFixed(4)} reads as a fraction` };
}

export function priceSale(row, { spot, asOf, ivDivisor = 1, parsed: given = null } = {}) {

  const parsed = given && typeof given === "object" && typeof given.expiry === "string"
    ? given
    : parseOptionSymbol(row && row.option_symbol);
  if (!parsed) return null;
  if (!(spot > 0)) return null;

  const bid = numOrNull(row.nbbo_bid);
  const ask = numOrNull(row.nbbo_ask);

  if (bid === null || !(bid > 0)) return null;
  if (ask === null || !(ask >= bid)) return null;

  const strategy = parsed.type === "P" ? "csp" : "cc";
  const days = daysToExpiry(parsed.expiry, asOf);
  if (days === null || days < 0) return null;

  const premium = bid * SHARES_PER_CONTRACT;
  const mid = (bid + ask) / 2;
  const spread = mid > 0 ? (ask - bid) / mid : null;

  const collateral = strategy === "csp"
    ? parsed.strike * SHARES_PER_CONTRACT
    : spot * SHARES_PER_CONTRACT;
  const yieldOnCollateral = collateral > 0 ? premium / collateral : null;

  const annualized = yieldOnCollateral !== null && days > 0
    ? yieldOnCollateral * (DAYS_PER_YEAR / days)
    : null;

  const breakeven = strategy === "csp" ? parsed.strike - bid : spot - bid;

  const ivRaw = numOrNull(row.implied_volatility);
  const iv = ivRaw !== null && ivRaw > 0 ? ivRaw / ivDivisor : null;
  const sigma = iv !== null && days > 0 ? iv * Math.sqrt(days / DAYS_PER_YEAR) : null;
  const logToBreakeven = breakeven > 0 ? Math.log(spot / breakeven) : null;
  const cushionSigmas = sigma !== null && sigma > 0 && logToBreakeven !== null
    ? logToBreakeven / sigma
    : null;

  const capSigmas = strategy === "cc" && sigma !== null && sigma > 0 && parsed.strike > 0
    ? Math.log(parsed.strike / spot) / sigma
    : null;
  const assignedReturn = strategy === "cc"
    ? (parsed.strike - spot + bid) / spot
    : null;

  const oi = numOrNull(row.open_interest);
  const prevOi = numOrNull(row.prev_oi);

  return {
    symbol: row.option_symbol,
    ticker: parsed.ticker,
    expiry: parsed.expiry,
    type: parsed.type,
    strike: parsed.strike,
    strategy,
    days,
    bid, ask, mid, spread,
    premium,
    collateral,
    yieldOnCollateral,
    annualized,
    annualizedIsConvention: true,
    breakeven,
    cushionSigmas,
    capSigmas,
    assignedReturn,
    moneyness: parsed.strike / spot - 1,
    iv,

    ivTraded: (() => {
      const v = numOrNull(row.volume);
      return v === null ? null : v > 0;
    })(),
    oi,
    oiChange: oi !== null && prevOi !== null ? oi - prevOi : null,
    volume: numOrNull(row.volume),

    askVolume: numOrNull(row.ask_volume),
    bidVolume: numOrNull(row.bid_volume),
  };
}

export const DEFAULT_GATES = Object.freeze({

  maxSpread: 0.15,

  minOi: 100,

  minPremium: 5,
  minDays: 1,
  maxDays: 400,
});

export const RANK_KEYS = Object.freeze(["annualized", "premium", "yieldOnCollateral", "cushionSigmas"]);

export function rankChain(contracts, {
  spot, asOf, gates = {}, rankBy = "annualized", limit = 120, strategy = "both",
  ticker = null,
} = {}) {
  const g = { ...DEFAULT_GATES, ...gates };
  const list = Array.isArray(contracts) ? contracts : [];
  const { divisor, basis } = ivConvention(list.map((r) => r && r.implied_volatility));

  const gated = {
    unpriceable: 0, nonStandard: 0, spread: 0, openInterest: 0,
    premium: 0, expiry: 0, strategy: 0,
  };

  const want = typeof ticker === "string" && ticker ? ticker.trim().toUpperCase() : null;
  const rows = [];

  const forSurface = [];

  for (const raw of list) {
    const p = priceSale(raw, { spot, asOf, ivDivisor: divisor });
    if (!p) { gated.unpriceable++; continue; }

    if (want !== null && p.ticker !== want) { gated.nonStandard++; continue; }
    forSurface.push(p);
    if (strategy !== "both" && p.strategy !== strategy) { gated.strategy++; continue; }
    if (p.days < g.minDays || p.days > g.maxDays) { gated.expiry++; continue; }
    if (p.premium < g.minPremium) { gated.premium++; continue; }
    if (p.oi === null || p.oi < g.minOi) { gated.openInterest++; continue; }
    if (p.spread === null || p.spread > g.maxSpread) { gated.spread++; continue; }
    rows.push(p);
  }

  const key = RANK_KEYS.includes(rankBy) ? rankBy : "annualized";

  rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });

  return {
    rows: rows.slice(0, limit),
    gated,
    screened: list.length,
    priced: rows.length,
    ivBasis: basis,
    rankedBy: key,
    gates: g,

    ivSurface: ivSurface(forSurface, { ivBasis: basis }),
  };
}

export const SURFACE_MAX_EXPIRIES = 8;

export const SURFACE_MAX_ROWS = 17;

export const SURFACE_ROW_STEPS = Object.freeze([0.005, 0.01, 0.02, 0.025, 0.05, 0.10]);

export const ATM_BAND_LOG = 0.10;

export const SKEW_CAP_QUANTILE = 0.9;
export const SKEW_CAP_FLOOR = 0.01;

function rowOf(m, step) {
  const k = Math.round(Math.abs(m) / step);
  return m < 0 ? -k : k;
}

export function ivSurface(priced, {
  maxExpiries = SURFACE_MAX_EXPIRIES,
  maxRows = SURFACE_MAX_ROWS,
  ivBasis = null,
} = {}) {
  const empty = (reason) => ({
    status: "empty", reason, ivBasis,
    expiries: [], rows: [], grid: [],
    step: null, atmBand: ATM_BAND_LOG,
    placed: 0, fresh: 0, stale: 0, unknownAge: 0, crowded: 0, levelled: 0,
    expiriesShown: 0, expiriesTotal: 0, rowsShown: 0, rowsTotal: 0,
    skewCap: null, clipped: 0,
  });

  const list = Array.isArray(priced) ? priced : [];
  const usable = [];
  for (const p of list) {
    if (!p) continue;
    const iv = numOrNull(p.iv);

    if (iv === null || !(iv > 0)) continue;
    const mn = numOrNull(p.moneyness);
    if (mn === null || !(mn > -1)) continue;

    usable.push({ src: p, iv, m: Math.log1p(mn) });
  }
  if (!usable.length) return empty("no contract on this chain carries both a quoted implied volatility and a strike");

  const med = median(usable.map((u) => u.iv));
  if (med !== null && med > IV_PERCENT_THRESHOLD) {
    return empty(`implied volatility reached the surface on a percent scale (median ${med.toFixed(2)}); ` +
      "the per-chain convention did not run, and drawing this would be wrong by 100x");
  }

  const byExpiry = new Map();
  for (const u of usable) {
    const key = u.src.expiry;
    if (!key) continue;
    let e = byExpiry.get(key);
    if (!e) { e = { expiry: key, days: numOrNull(u.src.days), items: [] }; byExpiry.set(key, e); }
    e.items.push(u);
  }
  const allExpiries = Array.from(byExpiry.values()).sort((a, b) => {
    if (a.days !== null && b.days !== null && a.days !== b.days) return a.days - b.days;
    return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0;
  });
  if (!allExpiries.length) return empty("no contract on this chain carries a usable expiry");

  let columns = allExpiries;
  if (allExpiries.length > maxExpiries) {
    const picked = new Set();
    for (let i = 0; i < maxExpiries; i++) {
      picked.add(Math.round((i * (allExpiries.length - 1)) / (maxExpiries - 1)));
    }
    columns = Array.from(picked).sort((a, b) => a - b).map((i) => allExpiries[i]);
  }

  let lo = Infinity, hi = -Infinity;
  for (const e of columns) for (const u of e.items) { if (u.m < lo) lo = u.m; if (u.m > hi) hi = u.m; }

  let step = SURFACE_ROW_STEPS[SURFACE_ROW_STEPS.length - 1];
  for (const candidate of SURFACE_ROW_STEPS) {
    if (rowOf(hi, candidate) - rowOf(lo, candidate) + 1 <= maxRows) { step = candidate; break; }
  }
  let rowLo = rowOf(lo, step), rowHi = rowOf(hi, step);
  const rowsTotal = rowHi - rowLo + 1;

  if (rowsTotal > maxRows) {
    const half = Math.floor(maxRows / 2);
    rowLo = Math.max(rowLo, -half);
    rowHi = Math.min(rowHi, rowLo + maxRows - 1);
  }
  const rowIndices = [];
  for (let k = rowHi; k >= rowLo; k--) rowIndices.push(k);

  for (const e of columns) {
    let ref = null, anyFresh = false, nearestFresh = null;
    for (const u of e.items) {
      if (u.src.ivTraded !== true) continue;
      anyFresh = true;
      if (nearestFresh === null || Math.abs(u.m) < Math.abs(nearestFresh.m)) nearestFresh = u;
      if (Math.abs(u.m) > ATM_BAND_LOG) continue;
      const closer = ref === null || Math.abs(u.m) < Math.abs(ref.m) ||
        (Math.abs(u.m) === Math.abs(ref.m) && u.src.strike < ref.src.strike);
      if (closer) ref = u;
    }
    e.atmIv = ref ? ref.iv : null;
    e.atmM = ref ? ref.m : null;
    e.atmStrike = ref ? ref.src.strike : null;
    e.atmType = ref ? ref.src.type : null;
    e.atmReason = ref ? null
      : !anyFresh
        ? "nothing on this expiry traded today, so it has no level this surface will vouch for"
        : `the nearest contract that traded today is ${(Math.abs(nearestFresh.m) * 100).toFixed(1)}% ` +
          `from the money, outside the ${(ATM_BAND_LOG * 100).toFixed(0)}% band an at-the-money quote may sit in`;
    e.fresh = 0; e.stale = 0; e.unknownAge = 0;
  }

  const grid = rowIndices.map(() => columns.map(() => null));
  const rowAt = new Map();
  rowIndices.forEach((k, i) => rowAt.set(k, i));

  let placed = 0, fresh = 0, stale = 0, unknownAge = 0, crowded = 0, dropped = 0;
  columns.forEach((e, col) => {
    for (const u of e.items) {
      const k = rowOf(u.m, step);
      const rowIdx = rowAt.get(k);
      if (rowIdx === undefined) { dropped++; continue; }
      const centre = k * step;
      const held = grid[rowIdx][col];
      if (held === null) {
        grid[rowIdx][col] = { pick: u, crowd: 1 };
        continue;
      }

      held.crowd++;
      crowded++;
      const a = u, b = held.pick;
      const af = a.src.ivTraded === true, bf = b.src.ivTraded === true;
      let better;
      if (af !== bf) better = af;
      else {
        const ad = Math.abs(a.m - centre), bd = Math.abs(b.m - centre);
        better = ad !== bd ? ad < bd : a.src.strike < b.src.strike;
      }
      if (better) held.pick = a;
    }
  });

  const skews = [];
  grid.forEach((row) => {
    row.forEach((slot, col) => {
      if (slot === null) return;
      const u = slot.pick, e = columns[col];
      const traded = u.src.ivTraded === true ? true : u.src.ivTraded === false ? false : null;
      if (traded === true) { fresh++; e.fresh++; }
      else if (traded === false) { stale++; e.stale++; }
      else { unknownAge++; e.unknownAge++; }
      placed++;
      const skew = e.atmIv !== null ? u.iv - e.atmIv : null;
      if (skew !== null) skews.push(Math.abs(skew));
      row[col] = {
        iv: u.iv,
        skew,
        m: u.m,
        strike: u.src.strike,
        type: u.src.type,
        expiry: e.expiry,
        traded,
        volume: numOrNull(u.src.volume),
        oi: numOrNull(u.src.oi),
        crowd: slot.crowd,
      };
    });
  });

  let skewCap = null, clipped = 0;
  if (skews.length) {
    const sorted = skews.slice().sort((a, b) => a - b);
    const at = sorted[Math.floor(SKEW_CAP_QUANTILE * (sorted.length - 1))];
    skewCap = Math.max(SKEW_CAP_FLOOR, at);
    for (const s of skews) if (s > skewCap) clipped++;
  }

  return {
    status: "ok",
    reason: null,

    ivBasis,
    step,
    atmBand: ATM_BAND_LOG,
    rows: rowIndices.map((k) => ({ k, m: k * step })),
    expiries: columns.map((e) => ({
      expiry: e.expiry, days: e.days,
      atmIv: e.atmIv, atmM: e.atmM, atmStrike: e.atmStrike, atmType: e.atmType,
      atmReason: e.atmReason,
      fresh: e.fresh, stale: e.stale, unknownAge: e.unknownAge,
    })),
    grid,
    placed, fresh, stale, unknownAge, crowded, dropped,
    levelled: columns.filter((e) => e.atmIv !== null).length,
    expiriesShown: columns.length,
    expiriesTotal: allExpiries.length,
    rowsShown: rowIndices.length,
    rowsTotal,
    skewCap, clipped,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(s) {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === s;
}

const AFTER_CLOSE = new Set(["postmarket", "afterhours", "aftermarket", "after_hours"]);
const BEFORE_OPEN = new Set(["premarket", "beforeopen", "before_open"]);

export function crossesEarnings(expiry, earningsDate, announceTime) {

  if (!isRealDate(expiry)) return null;
  if (!isRealDate(earningsDate)) return null;

  if (earningsDate < expiry) return true;
  if (earningsDate > expiry) return false;

  const token = String(announceTime || "").trim().toLowerCase().replace(/[\s-]/g, "");
  if (BEFORE_OPEN.has(token)) return true;
  if (AFTER_CLOSE.has(token)) return false;
  return null;
}

export function sizeToBuyingPower(row, buyingPower) {
  const bp = numOrNull(buyingPower);
  if (bp === null || !(bp > 0)) return null;
  if (!row || !(row.collateral > 0) || !(row.premium > 0)) return null;

  const contracts = Math.floor(bp / row.collateral);
  const deployed = contracts * row.collateral;
  return {
    contracts,

    affordable: contracts > 0,
    collectible: contracts * row.premium,
    deployed,
    idle: bp - deployed,

    yieldOnDeployed: deployed > 0 ? (contracts * row.premium) / deployed : null,
  };
}

export function planBuyingPower(rows, buyingPower) {
  const bp = numOrNull(buyingPower);
  const list = Array.isArray(rows) ? rows : [];
  if (bp === null || !(bp > 0)) {
    return { buyingPower: null, rows: list.map((r) => ({ ...r, sizing: null })), affordable: 0, best: null };
  }
  const out = list.map((r) => ({ ...r, sizing: sizeToBuyingPower(r, bp) }));
  const affordable = out.filter((r) => r.sizing && r.sizing.affordable);

  let best = null;
  for (const r of affordable) {
    if (best === null || r.sizing.collectible > best.sizing.collectible) best = r;
  }
  return { buyingPower: bp, rows: out, affordable: affordable.length, best };
}
