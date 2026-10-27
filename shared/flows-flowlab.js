import { centsOf, CLASSIFIED_FLOOR_CENTS } from "./flows-sides.js";
import { classifyPrint, hasFlag } from "./flows-tape-stats.js";
import { horizonEnd, isSession, sessionsBetween, previousSession } from "./flows-calendar.js";
import { etDayOf } from "./flows-quant-time.js";

export const FLOWLAB_MODES = Object.freeze(["on", "owner"]);

export function flowlabMode(env, owner) {
  const mode = String((env && env.FLOWS_FLOWLAB) || "").trim().toLowerCase();
  if (mode === "on") return "on";
  return mode === "owner" && owner === true ? "on" : "off";
}

export const analyticsOn = (env) => String((env && env.FLOWS_FLOWLAB_ANALYTICS) || "").trim().toLowerCase() === "on";

export const nightlyOn = (env) => String((env && env.FLOWS_FLOWLAB_NIGHTLY) || "").trim().toLowerCase() !== "off";

export const FLOWLAB_LIMITS = Object.freeze({
  screenLimit: 250,
  minVolume: 200,
  printsListed: 50,
  outlierMinPrints: 20,
  outlierMultiple: 10,
  strikeRows: 24,
  bucketMinutes: 15,
  bucketCount: 26,
  structuresMax: 5,
  litMarket: 40,
  litTicker: 100,
  venuesUniverse: 500,
  codesTop: 6,
  maxBins: 48,
  valueAreaNum: 7,
  valueAreaDen: 10,
  firstAggressiveRatio: 3,
  firstAggressiveShareDen: 10,
  coverageNum: 2,
  coverageDen: 5,
  leanFloorCents: CLASSIFIED_FLOOR_CENTS,
  screenPerPreset: 120,
});

export const REASONS = Object.freeze(["unshaped", "empty", "plan", "limited", "failed", "timeout", "cap"]);

export const PRESETS = Object.freeze({
  premium: Object.freeze({ order: "premium" }),
  voi: Object.freeze({ order: "volume_oi_ratio", vol_greater_oi: "true", min_premium: "100000" }),
  sweep: Object.freeze({ order: "premium", min_sweep_volume_ratio: "0.5" }),
  floor: Object.freeze({ order: "premium", min_floor_volume_ratio: "0.3" }),
  opening: Object.freeze({ order: "premium", min_days_of_oi_increases: "2" }),
  earnings: Object.freeze({ order: "premium" }),
});

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

export const NIGHTLY_PRESETS = Object.freeze(["premium", "voi", "sweep"]);

export const GROUPS = Object.freeze([
  "airline", "bank", "basic materials", "china", "communication services", "consumer cyclical", "consumer defensive", "crypto", "cyber",
  "energy", "financial services", "gas", "gold", "healthcare", "industrials", "mag7", "oil", "real estate", "refiners", "reit", "semi",
  "silver", "technology", "uranium", "utilities",
]);

export const NAME_VIEWS = Object.freeze(["strikes", "recent", "greek", "levels", "lit"]);

export const CONTRACT_PARTS = Object.freeze(["core", "alert", "structure", "legs"]);

export const NIGHTLY_KEYS = Object.freeze(["screen", "venues", "groups", "roots", "corr"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);

const nonNegInt = (v) => isInt(v) && v >= 0;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayMs = (day) => (typeof day === "string" && DAY_RE.test(day) ? Date.parse(day + "T00:00:00Z") : NaN);

export function daysBetween(from, to) {
  const a = dayMs(from);
  const b = dayMs(to);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
}

const instantMs = (v) => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? (v < 1e12 ? v * 1000 : v) : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  const spaced = t.includes("T") ? t : t.replace(" ", "T");
  const iso = /[+-]\d{2}$/.test(spaced) ? spaced + ":00" : spaced;
  const ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + "Z");
  return Number.isFinite(ms) ? ms : null;
};

export const toMs = instantMs;

const body = (b) => {
  if (b === null || b === undefined) return null;
  return b;
};

function rowsIn(b) {
  const x = body(b);
  if (Array.isArray(x)) return x;
  if (isObj(x) && Array.isArray(x.data)) return x.data;
  return null;
}

function objIn(b, needs) {
  const x = body(b);
  if (!isObj(x)) return null;
  if (needs.some((k) => Object.hasOwn(x, k))) return x;
  if (isObj(x.data) && needs.some((k) => Object.hasOwn(x.data, k))) return x.data;
  return null;
}

const OSI = /^([A-Z][A-Z0-9]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function osiOf(ticker, expiry, cp, strike) {
  if (typeof ticker !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(ticker)) return null;
  if (typeof expiry !== "string" || !DAY_RE.test(expiry)) return null;
  const right = String(cp).toUpperCase();
  if (right !== "C" && right !== "P") return null;
  const k = typeof strike === "string" ? Number(strike) : strike;
  if (typeof k !== "number" || !Number.isFinite(k) || k < 0) return null;
  const milli = Math.round(k * 1000);
  if (!Number.isSafeInteger(milli) || milli > 99999999) return null;
  return ticker.toUpperCase() + expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10) + right + String(milli).padStart(8, "0");
}

export function parseOsi(text) {
  if (typeof text !== "string") return null;
  const m = OSI.exec(text);
  if (!m) return null;
  const year = 2000 + Number(m[2]);
  const expiry = `${year}-${m[3]}-${m[4]}`;
  const ms = dayMs(expiry);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== expiry) return null;
  const milli = Number(m[6]);
  return { root: m[1], expiry, cp: m[5].toLowerCase(), strike: milli / 1000, milli };
}

const sumSafe = (a, b) => {
  const s = a + b;
  if (!Number.isSafeInteger(s)) throw new RangeError("a sum left the safe integers");
  return s;
};

const ratio = (n, d) => (d > 0 ? n / d : null);

function volumeField(row, name) {
  const v = row[name];
  if (v === undefined || v === null) return { ok: true, value: null };
  return nonNegInt(v) ? { ok: true, value: v } : { ok: false, field: name };
}

export function askBounds(r) {
  const { vol, ask, bid, mid, none, premC } = r;
  if (!(vol > 0)) return { lo: null, hi: null, stated: null, show: false, why: "no-volume" };
  if (ask === null || bid === null || mid === null || none === null) return { lo: null, hi: null, stated: null, show: false, why: "noSides" };
  const sided = ask + bid + mid;
  const stated = sided / vol;
  const base = { lo: ask / vol, hi: (ask + none) / vol, stated };
  if (!(premC > 0)) return { ...base, lo: null, hi: null, show: false, why: "noPremium" };
  if (ask + bid === 0 && mid === 0) return { ...base, lo: null, hi: null, show: false, why: "noSides" };
  if (FLOWLAB_LIMITS.coverageDen * sided < FLOWLAB_LIMITS.coverageNum * vol) return { ...base, lo: null, hi: null, show: false, why: "lowCoverage" };
  if (premC < FLOWLAB_LIMITS.leanFloorCents) return { ...base, lo: null, hi: null, show: false, why: "smallClassified" };
  return { ...base, show: true, why: null };
}

export function leanOf(bounds, cp, vol, ask, none) {
  if (!bounds.show) return null;
  const buy = 2 * ask > vol ? 1 : 2 * (ask + none) < vol ? -1 : 0;
  if (buy === 0) return 0;
  return cp === "p" ? -buy : buy;
}

export function ratiosOf(r) {
  const out = {
    voi: r.oi > 0 ? r.vol / r.oi : null,
    voiWhy: r.oi > 0 ? null : "no-oi",
    nameShare: r.tickerVol > 0 ? r.vol / r.tickerVol : null,
    nameShareWhy: r.tickerVol > 0 ? null : "no-name-volume",
    sweepShare: r.vol > 0 && r.sweep !== null ? r.sweep / r.vol : null,
    floorShare: r.vol > 0 && r.floor !== null ? r.floor / r.vol : null,
    crossShare: r.vol > 0 && r.cross !== null ? r.cross / r.vol : null,
    multiShare: r.vol > 0 && r.multi !== null && r.stockMulti !== null ? (r.multi + r.stockMulti) / r.vol : null,
    shareWhy: r.vol > 0 ? null : "no-volume",
    avgFill: r.vol > 0 ? r.premC / (r.vol * 100) : null,
    avgFillWhy: r.vol > 0 ? null : "no-volume",
  };
  const b = askBounds(r);
  out.stated = b.stated;
  out.askLo = b.show ? b.lo : null;
  out.askHi = b.show ? b.hi : null;
  out.askWhy = b.show ? null : b.why;
  out.lean = leanOf(b, r.cp, r.vol, r.ask, r.none);
  return out;
}

export const RANK_KEYS = Object.freeze(["premium", "voi", "nameShare", "askLo", "sweepShare"]);

const rankValue = (row, key) => (key === "premium" ? row.premC : row.ratios[key === "askLo" ? "askLo" : key]);

export function rankScreen(rows, key) {
  const k = RANK_KEYS.includes(key) ? key : "premium";
  const list = Array.isArray(rows) ? rows : [];
  const have = [];
  const lack = [];
  for (const row of list) {
    const v = rankValue(row, k);
    (typeof v === "number" && Number.isFinite(v) ? have : lack).push(row);
  }
  const byPremium = (a, b) => (b.premC - a.premC) || (a.c < b.c ? -1 : a.c > b.c ? 1 : 0);
  have.sort((a, b) => {
    const x = rankValue(a, k);
    const y = rankValue(b, k);
    return (y - x) || byPremium(a, b);
  });
  lack.sort(byPremium);
  return { rows: [...have, ...lack], unranked: lack.length };
}

export function presetParams(preset, { ticker = null, asOf = null } = {}) {
  const base = PRESETS[preset];
  if (!base) return null;
  const q = { ...base, limit: String(FLOWLAB_LIMITS.screenLimit), order_direction: "desc", min_volume: String(FLOWLAB_LIMITS.minVolume) };
  if (preset === "earnings") {
    const end = horizonEnd(asOf);
    const days = end === null ? null : daysBetween(asOf, end);
    if (days === null) return null;
    q.max_earnings_dte = String(days);
    q.min_earnings_dte = "0";
  }
  if (ticker) q.ticker_symbol = ticker;
  if (asOf) q.date = asOf;
  return q;
}

function typeFail(why) {
  return { ok: false, why: "type:" + why };
}

export function reduceScreen(response, ctx = {}) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const session = ctx.session || null;
  const rows = [];
  let dropped = 0;
  let firstBad = null;
  const bad = (f) => { dropped++; if (firstBad === null) firstBad = f; };
  for (const row of list) {
    if (!isObj(row)) { bad("row"); continue; }
    const osi = parseOsi(row.option_symbol);
    if (!osi) { bad("option_symbol"); continue; }
    const prem = centsOf(row.premium);
    if (prem === null) { bad("premium"); continue; }
    const vol = row.volume;
    if (!nonNegInt(vol)) { bad("volume"); continue; }
    const oi = row.open_interest === null || row.open_interest === undefined ? 0 : row.open_interest;
    if (!nonNegInt(oi)) { bad("open_interest"); continue; }
    let failed = null;
    const side = {};
    for (const [name, key] of [["ask", "ask_side_volume"], ["bid", "bid_side_volume"], ["mid", "mid_volume"], ["none", "no_side_volume"], ["sweep", "sweep_volume"], ["floor", "floor_volume"], ["multi", "multileg_volume"], ["stockMulti", "stock_multi_leg_volume"], ["cross", "cross_volume"], ["tickerVol", "ticker_vol"], ["trades", "trades"]]) {
      const f = volumeField(row, key);
      if (!f.ok) { failed = key; break; }
      side[name] = f.value;
    }
    if (failed) { bad(failed); continue; }
    const strike = row.strike === undefined ? osi.strike : Number(row.strike);
    if (!Number.isFinite(strike)) { bad("strike"); continue; }
    const px = row.stock_price === undefined || row.stock_price === null ? null : centsOf(row.stock_price);
    const expiry = typeof row.expiry === "string" && DAY_RE.test(row.expiry) ? row.expiry : osi.expiry;
    const base = { c: row.option_symbol, cp: osi.cp, vol, oi, premC: prem.cents, ...side };
    const ratios = ratiosOf(base);
    const fill = instantMs(row.last_fill);
    rows.push({
      c: row.option_symbol,
      t: osi.root,
      cp: osi.cp,
      k: strike,
      e: expiry,
      dte: session ? daysBetween(session, expiry) : null,
      px: px === null ? null : px.cents,
      vol,
      oi,
      premC: prem.cents,
      ratios,
      flags: { sweep: (side.sweep || 0) > 0, floor: (side.floor || 0) > 0, multi: (side.multi || 0) + (side.stockMulti || 0) > 0, cross: (side.cross || 0) > 0 },
      ed: typeof row.next_earnings_date === "string" && DAY_RE.test(row.next_earnings_date) ? row.next_earnings_date : null,
      lastFill: fill,
    });
  }
  if (!rows.length) return typeFail(firstBad || "row");
  const ranked = rankScreen(rows, ctx.rank || "premium");
  return {
    ok: true,
    x: {
      asOf: ctx.asOf || null,
      date: ctx.date || session,
      preset: ctx.preset || null,
      rows: ranked.rows,
      n: rows.length,
      unranked: ranked.unranked,
      dropped,
      minVolume: FLOWLAB_LIMITS.minVolume,
    },
  };
}

const median2 = (sorted) => {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] * 2 : sorted[n / 2 - 1] + sorted[n / 2];
};

function reducePrints(response, ctx) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const out = [];
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row)) { dropped++; continue; }
    const at = instantMs(row.executed_at);
    const prem = centsOf(row.premium);
    const px = centsOf(row.price);
    if (at === null || prem === null || px === null || !nonNegInt(row.size)) { dropped++; continue; }
    const bid = row.nbbo_bid === null || row.nbbo_bid === undefined ? null : centsOf(row.nbbo_bid);
    const ask = row.nbbo_ask === null || row.nbbo_ask === undefined ? null : centsOf(row.nbbo_ask);
    const multi = (nonNegInt(row.multi_vol) && row.multi_vol > 0) || (nonNegInt(row.stock_multi_vol) && row.stock_multi_vol > 0);
    const cls = classifyPrint({
      id: row.id,
      price: row.price,
      nbbo_bid: row.nbbo_bid,
      nbbo_ask: row.nbbo_ask,
      size: row.size,
      premium: row.premium,
      tags: row.tags,
      report_flags: row.report_flags,
      canceled: row.canceled === true,
      option_type: row.option_type,
      is_multi_leg: multi,
      executed_at: row.executed_at,
    });
    out.push({
      id: typeof row.id === "string" ? row.id : null,
      at,
      px: px.cents,
      size: row.size,
      premC: prem.cents,
      bid: bid === null ? null : bid.cents,
      ask: ask === null ? null : ask.cents,
      venue: typeof row.exchange === "string" ? row.exchange : null,
      side: row.canceled === true ? 0 : cls.side,
      tier: cls.tier,
      canceled: row.canceled === true,
      multi,
      alertId: typeof row.flow_alert_id === "string" && row.flow_alert_id ? row.flow_alert_id : null,
      sweep: hasFlag(cls.flags, "sweep"),
    });
  }
  if (!out.length) return typeFail("executed_at");
  out.sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const live = out.filter((p) => !p.canceled);
  const sums = { n: live.length, canceled: out.length - live.length, size: 0, premC: 0, ask: 0, bid: 0, mid: 0, none: 0 };
  for (const p of live) {
    sums.size = sumSafe(sums.size, p.size);
    sums.premC = sumSafe(sums.premC, p.premC);
    if (p.side > 0) sums.ask = sumSafe(sums.ask, p.size);
    else if (p.side < 0) sums.bid = sumSafe(sums.bid, p.size);
    else if (p.tier === "m") sums.mid = sumSafe(sums.mid, p.size);
    else sums.none = sumSafe(sums.none, p.size);
  }
  const alertIds = [...new Set(out.map((p) => p.alertId).filter(Boolean))];
  let outliers;
  if (live.length >= FLOWLAB_LIMITS.outlierMinPrints) {
    const sizes = live.map((p) => p.size).sort((a, b) => a - b);
    const m2 = median2(sizes);
    outliers = { ok: true, median2: m2, items: live.filter((p) => 2 * p.size >= FLOWLAB_LIMITS.outlierMultiple * m2).map((p) => p.id || String(p.at)) };
  } else outliers = { ok: false, why: "few-prints" };
  return { ok: true, x: { list: out.slice(0, FLOWLAB_LIMITS.printsListed), n: out.length, dropped, sums, alertIds, outliers } };
}

function reduceMinutes(response) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const mins = [];
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row)) { dropped++; continue; }
    const m = instantMs(row.start_time);
    if (m === null) { dropped++; continue; }
    const vols = {};
    let ok = true;
    for (const [n, key] of [["va", "volume_ask_side"], ["vb", "volume_bid_side"], ["vm", "volume_mid_side"], ["vn", "volume_no_side"], ["vMulti", "volume_multi"], ["vSm", "volume_stock_multi"]]) {
      const f = volumeField(row, key);
      if (!f.ok || f.value === null) { ok = false; break; }
      vols[n] = f.value;
    }
    if (!ok) { dropped++; continue; }
    const cents = (v) => (v === null || v === undefined ? null : (centsOf(v) || { cents: null }).cents);
    const prem = (v) => (v === null || v === undefined ? 0 : (centsOf(v) || { cents: 0 }).cents);
    const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    mins.push({
      m, o: cents(row.open), h: cents(row.high), l: cents(row.low), c: cents(row.close), ivL: num(row.iv_low), ivH: num(row.iv_high),
      ...vols, pa: prem(row.premium_ask_side), pb: prem(row.premium_bid_side), pm: prem(row.premium_mid_side), pn: prem(row.premium_no_side),
    });
  }
  if (!mins.length) return typeFail("start_time");
  mins.sort((a, b) => a.m - b.m);
  let cumNet = 0;
  let cumVol = 0;
  let first = null;
  const cum = [];
  for (const q of mins) {
    cumNet = sumSafe(cumNet, q.va - q.vb);
    cumVol = sumSafe(cumVol, q.va + q.vb + q.vm + q.vn);
    cum.push(cumNet);
    if (first === null && q.va > 0 && q.va >= FLOWLAB_LIMITS.firstAggressiveRatio * q.vb && FLOWLAB_LIMITS.firstAggressiveShareDen * q.va >= cumVol) first = q.m;
  }
  return { ok: true, x: { list: mins, cum, firstAggressive: first, dropped } };
}

export function vwapCents(levels) {
  let num = 0n;
  let den = 0n;
  for (const l of levels) {
    num += BigInt(l.px) * BigInt(l.v);
    den += BigInt(l.v);
  }
  if (den === 0n) return null;
  return Number((2n * num + den) / (2n * den));
}

export function valueArea(levels) {
  const total = levels.reduce((s, l) => s + l.v, 0);
  if (!levels.length || total <= 0) return null;
  let poc = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i].v > levels[poc].v) poc = i;
  let lo = poc;
  let hi = poc;
  let have = levels[poc].v;
  while (FLOWLAB_LIMITS.valueAreaDen * have < FLOWLAB_LIMITS.valueAreaNum * total && (lo > 0 || hi < levels.length - 1)) {
    const down = lo > 0 ? levels[lo - 1].v : -1;
    const up = hi < levels.length - 1 ? levels[hi + 1].v : -1;
    if (up >= down) { hi++; have += levels[hi].v; } else { lo--; have += levels[lo].v; }
  }
  return { poc: levels[poc].px, lo: levels[lo].px, hi: levels[hi].px, v: have, of: total };
}

function reduceProfile(response, ctx) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const levels = [];
  let dropped = 0;
  let offDate = 0;
  for (const row of list) {
    if (!isObj(row)) { dropped++; continue; }
    const px = centsOf(row.price);
    if (px === null) { dropped++; continue; }
    if (typeof row.date === "string" && ctx && ctx.date && row.date !== ctx.date) { offDate++; continue; }
    const f = {};
    let ok = true;
    for (const [n, key] of [["v", "volume"], ["va", "ask_vol"], ["vb", "bid_vol"], ["vm", "mid_vol"], ["vSweep", "sweep_vol"], ["vFloor", "floor_vol"], ["vMulti", "multi_vol"], ["vCross", "cross_vol"], ["n", "transactions"]]) {
      const g = volumeField(row, key);
      if (!g.ok || g.value === null) { ok = false; break; }
      f[n] = g.value;
    }
    if (!ok) { dropped++; continue; }
    levels.push({ px: px.cents, ...f });
  }
  if (!levels.length) return typeFail("price");
  levels.sort((a, b) => a.px - b.px);
  const total = levels.reduce((s, l) => sumSafe(s, l.v), 0);
  const area = valueArea(levels);
  const shareOf = (k) => ratio(levels.reduce((s, l) => s + l[k], 0), total);
  return {
    ok: true,
    x: {
      levels,
      total,
      poc: area ? area.poc : null,
      valueArea: area,
      vwapC: vwapCents(levels),
      shares: { sweep: shareOf("vSweep"), floor: shareOf("vFloor"), multi: shareOf("vMulti"), cross: shareOf("vCross") },
      dropped,
      offDate,
    },
  };
}

export function reduceContract({ flow = null, intraday = null, profile = null } = {}, ctx = {}) {
  const prints = flow === null ? { ok: false, why: "unread" } : reducePrints(flow, ctx);
  const minutes = intraday === null ? { ok: false, why: "unread" } : reduceMinutes(intraday);
  const prof = profile === null ? { ok: false, why: "unread" } : reduceProfile(profile, ctx);
  const any = prints.ok || minutes.ok || prof.ok;
  if (!any) return { ok: false, why: [prints, minutes, prof].map((p) => p.why).find((w) => w !== "unread" && w !== "empty") || "empty" };
  return { ok: true, x: { c: ctx.c || null, prints, minutes, profile: prof } };
}

export function medianStrike(rows) {
  const w = rows.map((r) => ({ k: r.k, v: r.callVol + r.putVol })).filter((r) => r.v > 0).sort((a, b) => a.k - b.k);
  const total = w.reduce((s, r) => s + r.v, 0);
  if (!total) return null;
  let acc = 0;
  for (const r of w) {
    acc += r.v;
    if (2 * acc >= total) return r.k;
  }
  return null;
}

export function reduceStrikes(response, ctx = {}) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const openMs = Number.isFinite(ctx.openMs) ? ctx.openMs : null;
  if (openMs === null) return { ok: false, why: "unshaped" };
  const width = FLOWLAB_LIMITS.bucketMinutes * 60000;
  const rows = [];
  let dropped = 0;
  let outside = 0;
  for (const row of list) {
    if (!isObj(row)) { dropped++; continue; }
    const at = instantMs(row.timestamp);
    const k = Number(row.strike);
    const f = {};
    let ok = at !== null && Number.isFinite(k);
    if (ok) {
      for (const [n, key] of [["ca", "call_volume_ask_side"], ["cb", "call_volume_bid_side"], ["pa", "put_volume_ask_side"], ["pb", "put_volume_bid_side"], ["callVol", "call_volume"], ["putVol", "put_volume"]]) {
        const g = volumeField(row, key);
        if (!g.ok || g.value === null) { ok = false; break; }
        f[n] = g.value;
      }
    }
    if (!ok) { dropped++; continue; }
    const b = Math.floor((at - openMs) / width);
    if (b < 0 || b >= FLOWLAB_LIMITS.bucketCount) { outside++; continue; }
    rows.push({ k, b, ...f });
  }
  if (!rows.length) return dropped ? typeFail("timestamp") : { ok: false, why: "empty" };
  let spot = Number.isFinite(ctx.spot) && ctx.spot > 0 ? ctx.spot : null;
  let spotSource = spot === null ? null : "card";
  if (spot === null) {
    spot = medianStrike(rows);
    spotSource = spot === null ? "none" : "median";
  }
  const ks = [...new Set(rows.map((r) => r.k))];
  const near = spot === null ? ks.slice().sort((a, b) => a - b) : ks.slice().sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b);
  const strikes = near.slice(0, FLOWLAB_LIMITS.strikeRows).sort((a, b) => a - b);
  const index = new Map(strikes.map((k, i) => [k, i]));
  const cells = strikes.map(() => new Array(FLOWLAB_LIMITS.bucketCount).fill(null));
  for (const r of rows) {
    const i = index.get(r.k);
    if (i === undefined) continue;
    const s = (r.ca - r.cb) - (r.pa - r.pb);
    cells[i][r.b] = (cells[i][r.b] === null ? 0 : cells[i][r.b]) + s;
  }
  const cum = cells.map((line) => line.reduce((s, v) => s + (v === null ? 0 : v), 0));
  const buckets = [];
  for (let b = 0; b < FLOWLAB_LIMITS.bucketCount; b++) buckets.push(openMs + b * width);
  return { ok: true, x: { strikes, buckets, cells, cum, spot, spotSource, rows: rows.length, dropped, outside, shown: strikes.length, of: ks.length } };
}

export function reduceAlert(response) {
  const b = objIn(response, ["alert", "trades"]);
  if (!b) return { ok: false, why: "unshaped" };
  if (!isObj(b.alert) || !Array.isArray(b.trades)) return { ok: false, why: "unshaped" };
  const a = b.alert;
  const prem = a.total_premium === undefined || a.total_premium === null ? null : centsOf(a.total_premium);
  const alert = {
    rule: typeof a.alert_rule === "string" ? a.alert_rule : null,
    chain: typeof a.option_chain === "string" ? a.option_chain : null,
    premC: prem === null ? null : prem.cents,
    size: nonNegInt(a.total_size) ? a.total_size : null,
    at: instantMs(a.created_at),
    sweep: a.has_sweep === true ? true : a.has_sweep === false ? false : null,
    floor: a.has_floor === true ? true : a.has_floor === false ? false : null,
    multi: a.has_multileg === true ? true : a.has_multileg === false ? false : null,
  };
  const trades = [];
  let dropped = 0;
  for (const t of b.trades) {
    if (!isObj(t)) { dropped++; continue; }
    const at = instantMs(t.executed_at);
    if (at === null || !nonNegInt(t.size)) { dropped++; continue; }
    const px = t.price === undefined || t.price === null ? null : centsOf(t.price);
    const p = t.premium === undefined || t.premium === null ? null : centsOf(t.premium);
    const bid = t.nbbo_bid === undefined || t.nbbo_bid === null ? null : centsOf(t.nbbo_bid);
    const ask = t.nbbo_ask === undefined || t.nbbo_ask === null ? null : centsOf(t.nbbo_ask);
    trades.push({ at, pxC: px === null ? null : px.cents, size: t.size, premC: p === null ? null : p.cents, bid: bid === null ? null : bid.cents, ask: ask === null ? null : ask.cents, venue: typeof t.exchange === "string" ? t.exchange : null });
  }
  trades.sort((x, y) => y.at - x.at);
  if (!trades.length && dropped) return typeFail("executed_at");
  return { ok: true, x: { alert, trades, more: b.has_more === true, dropped } };
}

export function reduceStructures(response, ctx = {}) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  const osi = parseOsi(ctx.c);
  if (!osi) return { ok: false, why: "unshaped" };
  const out = [];
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row) || typeof row.id !== "string") { dropped++; continue; }
    const at = instantMs(row.executed_at);
    if (at === null) { dropped++; continue; }
    if (typeof row.ticker === "string" && row.ticker.toUpperCase() !== osi.root) continue;
    if (ctx.session && etDayOf(at) !== ctx.session) continue;
    const strikes = Array.isArray(row.strikes) ? row.strikes.map(Number) : [];
    if (!strikes.some((k) => Number.isFinite(k) && Math.round(k * 1000) === osi.milli)) continue;
    const tot = row.total_premium === undefined || row.total_premium === null ? null : centsOf(row.total_premium);
    const net = row.net_premium === undefined || row.net_premium === null ? null : centsOf(row.net_premium, { signed: true });
    out.push({
      id: row.id,
      strategy: typeof row.strategy === "string" ? row.strategy : null,
      code: typeof row.code === "string" ? row.code : null,
      legs: nonNegInt(row.leg_count) ? row.leg_count : null,
      at,
      premC: tot === null ? null : tot.cents,
      netC: net === null ? null : net.cents,
      direction: typeof row.direction === "string" ? row.direction : null,
      size: nonNegInt(row.size) ? row.size : null,
      state: "candidate",
    });
  }
  out.sort((a, b) => ((b.premC === null ? -1 : b.premC) - (a.premC === null ? -1 : a.premC)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ok: true, x: { list: out.slice(0, FLOWLAB_LIMITS.structuresMax), found: out.length, dropped } };
}

export function reduceLegs(response, ctx = {}) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const legs = [];
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row)) { dropped++; continue; }
    const sym = typeof row.option_symbol === "string" ? row.option_symbol.replace(/\s+/g, "") : "";
    const osi = parseOsi(sym);
    if (!osi || !nonNegInt(row.size)) { dropped++; continue; }
    const px = row.price === undefined || row.price === null ? null : centsOf(row.price);
    const prem = row.premium === undefined || row.premium === null ? null : centsOf(row.premium, { signed: true });
    const num = (v) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    legs.push({
      c: sym,
      cp: osi.cp,
      k: osi.strike,
      e: osi.expiry,
      side: typeof row.side === "string" ? row.side : null,
      size: row.size,
      pxC: px === null ? null : px.cents,
      premC: prem === null ? null : prem.cents,
      delta: num(row.delta),
      theta: num(row.theta),
    });
  }
  if (!legs.length) return typeFail("option_symbol");
  const wanted = typeof ctx.c === "string" ? ctx.c.replace(/\s+/g, "") : null;
  return { ok: true, x: { legs, confirmed: wanted !== null && legs.some((l) => l.c === wanted), dropped } };
}

export function reduceRecent(response) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const rows = [];
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row) || typeof row.expiry !== "string" || !DAY_RE.test(row.expiry)) { dropped++; continue; }
    const cents = {};
    let ok = true;
    for (const [n, key] of [["callC", "call_premium"], ["putC", "put_premium"], ["callAskC", "call_premium_ask_side"], ["callBidC", "call_premium_bid_side"], ["putAskC", "put_premium_ask_side"], ["putBidC", "put_premium_bid_side"], ["callOtmC", "call_otm_premium"], ["putOtmC", "put_otm_premium"]]) {
      const v = row[key] === undefined || row[key] === null ? null : centsOf(row[key], { signed: true });
      if (row[key] !== undefined && row[key] !== null && v === null) { ok = false; break; }
      cents[n] = v === null ? null : v.cents;
    }
    const counts = {};
    for (const [n, key] of [["callV", "call_volume"], ["putV", "put_volume"], ["callTr", "call_trades"], ["putTr", "put_trades"]]) {
      const g = volumeField(row, key);
      if (!g.ok) { ok = false; break; }
      counts[n] = g.value;
    }
    if (!ok) { dropped++; continue; }
    rows.push({ e: row.expiry, ...cents, ...counts, netC: cents.callC !== null && cents.putC !== null ? cents.callC - cents.putC : null });
  }
  if (!rows.length) return typeFail("expiry");
  rows.sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : 0));
  return { ok: true, x: { rows, dropped } };
}

const GREEK_FIELDS = Object.freeze([["dirDelta", "dir_delta_flow"], ["dirVega", "dir_vega_flow"], ["totDelta", "total_delta_flow"], ["totVega", "total_vega_flow"], ["otmDirDelta", "otm_dir_delta_flow"], ["otmDirVega", "otm_dir_vega_flow"]]);

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export function relative(values) {
  let max = 0;
  for (const v of values) if (v !== null && Math.abs(v) > max) max = Math.abs(v);
  if (max === 0) return null;
  return values.map((v) => (v === null ? null : v / max));
}

export function reduceGreek(response, ctx = {}) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const group = ctx.group === true;
  const rows = [];
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row)) { dropped++; continue; }
    const at = instantMs(row.timestamp);
    if (at === null) { dropped++; continue; }
    const rec = { t: at };
    let ok = true;
    for (const [n, key] of GREEK_FIELDS) {
      const v = row[key];
      if (v === undefined || v === null) { rec[n] = null; continue; }
      if (typeof v !== "string" || !DECIMAL.test(v.trim())) { ok = false; break; }
      rec[n] = Number(v);
    }
    if (!ok) { dropped++; continue; }
    if (group) {
      const c = typeof row.net_call_premium === "string" && DECIMAL.test(row.net_call_premium.trim()) ? centsOf(row.net_call_premium, { signed: true }) : null;
      const p = typeof row.net_put_premium === "string" && DECIMAL.test(row.net_put_premium.trim()) ? centsOf(row.net_put_premium, { signed: true }) : null;
      if (c === null || p === null) { dropped++; continue; }
      rec.callC = c.cents;
      rec.putC = p.cents;
    }
    rec.tx = nonNegInt(row.transactions) ? row.transactions : null;
    rec.vol = nonNegInt(row.volume) ? row.volume : null;
    rows.push(rec);
  }
  if (!rows.length) return typeFail("timestamp");
  rows.sort((a, b) => a.t - b.t);
  const t = rows.map((r) => r.t);
  const series = {};
  const rel = {};
  for (const [n] of GREEK_FIELDS) {
    series[n] = rows.map((r) => r[n]);
    rel[n] = relative(series[n]);
  }
  const bucket = 30 * 60000;
  const signs = [];
  const sums = new Map();
  for (const r of rows) {
    const b = Math.floor(r.t / bucket) * bucket;
    const s = sums.get(b) || { t: b, delta: 0, vega: 0 };
    s.delta += r.dirDelta || 0;
    s.vega += r.dirVega || 0;
    sums.set(b, s);
  }
  for (const s of [...sums.values()].sort((a, b) => a.t - b.t)) signs.push({ t: s.t, delta: Math.sign(s.delta), vega: Math.sign(s.vega) });
  const net = group ? { callC: rows.reduce((s, r) => s + r.callC, 0), putC: rows.reduce((s, r) => s + r.putC, 0) } : null;
  return { ok: true, x: { t, series, rel, signs, unit: null, expiry: ctx.expiry || null, net, dropped } };
}

const WIDTHS_C = Object.freeze([1, 2, 5, 10, 25, 50, 100, 250, 500]);

export function ladderWidth(loC, hiC) {
  for (const w of WIDTHS_C) {
    const bins = Math.floor(hiC / w) - Math.floor(loC / w) + 1;
    if (bins <= FLOWLAB_LIMITS.maxBins) return w;
  }
  return WIDTHS_C[WIDTHS_C.length - 1];
}

export function reduceLadders({ options = null, stock = null } = {}, ctx = {}) {
  const o = options === null ? null : rowsIn(options);
  const s = stock === null ? null : rowsIn(stock);
  if (o === null && s === null) return { ok: false, why: "unshaped" };
  const opt = [];
  const stk = [];
  let dropped = 0;
  for (const row of o || []) {
    const px = isObj(row) ? centsOf(row.price) : null;
    if (px === null || !nonNegInt(row.call_volume) || !nonNegInt(row.put_volume)) { dropped++; continue; }
    opt.push({ px: px.cents, call: row.call_volume, put: row.put_volume });
  }
  for (const row of s || []) {
    const px = isObj(row) ? centsOf(row.price) : null;
    if (px === null || !nonNegInt(row.lit_vol) || !nonNegInt(row.off_vol)) { dropped++; continue; }
    stk.push({ px: px.cents, lit: row.lit_vol, off: row.off_vol });
  }
  if (!opt.length && !stk.length) return dropped ? typeFail("price") : { ok: false, why: "empty" };
  const all = [...opt, ...stk].map((r) => r.px);
  const w = ladderWidth(Math.min(...all), Math.max(...all));
  const bins = new Map();
  const at = (px) => {
    const lo = Math.floor(px / w) * w;
    if (!bins.has(lo)) bins.set(lo, { lo, call: null, put: null, lit: null, off: null });
    return bins.get(lo);
  };
  const add = (a, v) => (a === null ? v : a + v);
  for (const r of opt) { const b = at(r.px); b.call = add(b.call, r.call); b.put = add(b.put, r.put); }
  for (const r of stk) { const b = at(r.px); b.lit = add(b.lit, r.lit); b.off = add(b.off, r.off); }
  const list = [...bins.values()].sort((a, b) => a.lo - b.lo).map((b) => ({ ...b, offShare: b.lit !== null && b.off !== null && b.lit + b.off > 0 ? b.off / (b.lit + b.off) : null }));
  let lit = 0;
  let off = 0;
  for (const b of list) { lit += b.lit || 0; off += b.off || 0; }
  return { ok: true, x: { w, bins: list, offShare: lit + off > 0 ? off / (lit + off) : null, spot: Number.isFinite(ctx.spot) ? ctx.spot : null, optionRead: o !== null, stockRead: s !== null, dropped } };
}

export function reduceLit(response, ctx = {}) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const rows = [];
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row)) { dropped++; continue; }
    const at = instantMs(row.executed_at);
    const px = centsOf(row.price);
    const prem = centsOf(row.premium);
    if (at === null || px === null || prem === null || !nonNegInt(row.size) || typeof row.ticker !== "string") { dropped++; continue; }
    rows.push({
      at, t: row.ticker, px: px.cents, size: row.size, premC: prem.cents,
      venue: typeof row.market_center === "string" ? row.market_center : null,
      canceled: row.canceled === true,
      code: typeof row.trade_code === "string" ? row.trade_code : null,
      cond: typeof row.sale_cond_codes === "string" ? row.sale_cond_codes : null,
    });
  }
  if (!rows.length) return typeFail("executed_at");
  const market = ctx.mode === "market";
  if (market) rows.sort((a, b) => (b.premC - a.premC) || (b.at - a.at) || (a.t < b.t ? -1 : 1));
  else rows.sort((a, b) => (b.at - a.at) || (b.premC - a.premC));
  const cap = market ? FLOWLAB_LIMITS.litMarket : FLOWLAB_LIMITS.litTicker;
  const live = rows.filter((r) => !r.canceled);
  const sums = { n: live.length, canceled: rows.length - live.length, size: live.reduce((s, r) => sumSafe(s, r.size), 0), premC: live.reduce((s, r) => sumSafe(s, r.premC), 0) };
  return { ok: true, x: { list: rows.slice(0, cap), n: rows.length, dropped, sums, mode: market ? "market" : "ticker" } };
}

export function reduceVenues(response, ctx = {}) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const codes = ctx.mode === "codes";
  const order = [];
  const by = new Map();
  let dropped = 0;
  for (const row of list) {
    if (!isObj(row) || typeof row.underlying_symbol !== "string") { dropped++; continue; }
    const key = codes ? row.trade_code : row.exchange;
    const prem = row.premium === undefined || row.premium === null ? null : centsOf(row.premium);
    if (typeof key !== "string" || !nonNegInt(row.contracts) || !nonNegInt(row.trade_count) || prem === null) { dropped++; continue; }
    const t = row.underlying_symbol;
    if (ctx.ticker && t !== ctx.ticker) continue;
    if (!by.has(t)) {
      if (!ctx.ticker && by.size >= FLOWLAB_LIMITS.venuesUniverse) continue;
      by.set(t, new Map());
      order.push(t);
    }
    const m = by.get(t);
    const cur = m.get(key) || { x: key, trades: 0, contracts: 0, premC: 0, callTrades: 0, putTrades: 0 };
    cur.trades = sumSafe(cur.trades, row.trade_count);
    cur.contracts = sumSafe(cur.contracts, row.contracts);
    cur.premC = sumSafe(cur.premC, prem.cents);
    cur.callTrades = sumSafe(cur.callTrades, nonNegInt(row.call_trades) ? row.call_trades : 0);
    cur.putTrades = sumSafe(cur.putTrades, nonNegInt(row.put_trades) ? row.put_trades : 0);
    m.set(key, cur);
  }
  if (!by.size) return dropped ? typeFail("contracts") : { ok: false, why: "empty" };
  const tickers = order.map((t) => {
    const rows = [...by.get(t).values()].sort((a, b) => (b.contracts - a.contracts) || (a.x < b.x ? -1 : 1));
    const total = rows.reduce((s, r) => sumSafe(s, r.contracts), 0);
    let hhiN = 0n;
    for (const r of rows) hhiN += BigInt(r.contracts) * BigInt(r.contracts);
    const hhiD = BigInt(total) * BigInt(total);
    const out = { t, total, hhiN: hhiN.toString(), hhiD: hhiD.toString(), hhi: total > 0 ? Number(hhiN) / Number(hhiD) : null };
    if (codes) out.top = rows.slice(0, FLOWLAB_LIMITS.codesTop).map((r) => ({ code: r.x, contracts: r.contracts, share: total > 0 ? r.contracts / total : null }));
    else out.exchanges = rows;
    return out;
  });
  return { ok: true, x: { tickers, dropped } };
}

export const ROOT_RE = /^[A-Z][A-Z0-9.]{0,9}$/;

export function reduceRoots(response) {
  const list = rowsIn(response);
  if (list === null) return { ok: false, why: "unshaped" };
  if (list.length === 0) return { ok: false, why: "empty" };
  const seen = new Set();
  let dropped = 0;
  for (const v of list) {
    if (typeof v === "string" && ROOT_RE.test(v)) seen.add(v);
    else dropped++;
  }
  if (!seen.size) return typeFail("ticker");
  const sorted = [...seen].sort();
  return { ok: true, x: { n: sorted.length, list: sorted.join("|"), dropped } };
}

export const rootListed = (list, ticker) => typeof list === "string" && typeof ticker === "string" && ("|" + list + "|").includes("|" + ticker + "|");

export function reduceAnalytics(response, ctx = {}) {
  const b = objIn(response, ["meta", "payload"]);
  if (!b || !isObj(b.payload)) return { ok: false, why: "unshaped" };
  const symbols = Array.isArray(ctx.symbols) ? ctx.symbols : [];
  const keys = Object.keys(b.payload);
  if (!keys.length || keys.some((k) => !symbols.includes(k))) return { ok: false, why: "unshaped" };
  const correlation = ctx.calc === "correlation";
  const cellOk = (v) => typeof v === "number" && Number.isFinite(v) && (!correlation || (v >= -1 && v <= 1));
  const payload = {};
  for (const k of keys) {
    const v = b.payload[k];
    if (Array.isArray(v)) {
      if (!v.every(cellOk)) return { ok: false, why: "unshaped" };
      payload[k] = v.slice();
    } else if (isObj(v)) {
      const inner = {};
      for (const [k2, x] of Object.entries(v)) {
        if (!cellOk(x)) return { ok: false, why: "unshaped" };
        inner[k2] = x;
      }
      payload[k] = inner;
    } else return { ok: false, why: "unshaped" };
  }
  return { ok: true, x: { symbols: keys.slice().sort(), payload, meta: isObj(b.meta) ? b.meta : null } };
}

export function thirdFridayExpiry(session) {
  const parts = /^(\d{4})-(\d{2})-/.exec(session || "");
  if (!parts) return null;
  const pick = (y, m) => {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const d = 1 + ((5 - first + 7) % 7) + 14;
    const friday = new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
    return isSession(friday) === false ? previousSession(friday) : friday;
  };
  const y = Number(parts[1]);
  const m = Number(parts[2]) - 1;
  const here = pick(y, m);
  const gap = here ? sessionsBetween(session, here) : null;
  if (gap !== null && gap >= 5) return here;
  return m === 11 ? pick(y + 1, 0) : pick(y, m + 1);
}
