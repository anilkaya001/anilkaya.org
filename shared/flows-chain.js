import {
  parseOptionSymbol, ivConvention, priceSale, ivSurface,
  SURFACE_MAX_EXPIRIES, SURFACE_MAX_ROWS,
} from "./flows-premium.js";
import { buildUnusualRows, describeOiBasis } from "./flows-unusual.js";

import { panelLead, saidMagnitude } from "./flows-card.js";

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

export const CHAIN_PAGE_SIZE = 500;

export const SKEW_MONEYNESS = 0.10;

export const SKEW_TOLERANCE = 0.04;

export const SKEW_MIN_DAYS = 7;

export const TERM_MIN_DAYS = 7;
export const TERM_FAR_DAYS = 45;

export const ATM_IV_CEILING = 3.0;

export const TOP_CONTRACTS = 10;
export const AGGRESSOR_STRIKES = 30;

const dead = (reason) => ({ status: "unavailable", reason });

export function serialiseSurface(surface) {
  if (!surface || surface.status !== "ok") {
    return { status: "unavailable", reason: (surface && surface.reason) || "no surface was built" };
  }
  const iv = [], skew = [], traded = [], strike = [];
  for (const row of surface.grid) {
    iv.push(row.map((c) => (c ? round(c.iv, 4) : null)));
    skew.push(row.map((c) => (c ? round(c.skew, 4) : null)));

    traded.push(row.map((c) => (c ? (c.traded === true ? 1 : c.traded === false ? 0 : null) : null)));
    strike.push(row.map((c) => (c ? round(c.strike, 2) : null)));
  }
  return {
    status: "ok",
    ivBasis: surface.ivBasis || null,
    step: surface.step,
    atmBand: surface.atmBand,
    rows: surface.rows.map((r) => round(r.m, 4)),
    expiries: surface.expiries.map((e) => ({
      expiry: e.expiry, days: e.days,
      atmIv: round(e.atmIv, 4),
      atmM: round(e.atmM, 4),
      atmStrike: round(e.atmStrike, 2),
      atmReason: e.atmReason,
      fresh: e.fresh, stale: e.stale, unknownAge: e.unknownAge,
    })),
    iv, skew, traded, strike,
    placed: surface.placed, fresh: surface.fresh, stale: surface.stale,
    unknownAge: surface.unknownAge, crowded: surface.crowded,
    levelled: surface.levelled,
    expiriesShown: surface.expiriesShown, expiriesTotal: surface.expiriesTotal,
    rowsShown: surface.rowsShown, rowsTotal: surface.rowsTotal,
    skewCap: round(surface.skewCap, 4), clipped: surface.clipped,
  };
}

function preferOutOfTheMoney(priced) {
  const byKey = new Map();
  let collisions = 0;
  for (const p of priced) {
    const m = numOrNull(p.moneyness);
    if (m === null || !p.expiry || !(p.strike > 0)) continue;
    const key = p.expiry + "@" + p.strike;
    const held = byKey.get(key);
    if (!held) { byKey.set(key, p); continue; }
    collisions++;
    const lm = Math.log1p(m);

    const wantType = lm < 0 ? "P" : lm > 0 ? "C" : null;
    let better;
    if (wantType) better = p.type === wantType && held.type !== wantType;
    else {
      const pf = p.ivTraded === true, hf = held.ivTraded === true;
      better = pf !== hf ? pf : p.type === "C" && held.type !== "C";
    }
    if (better) byKey.set(key, p);
  }
  return { kept: [...byKey.values()], collisions };
}

function wingAt(priced, targetM, tol, type) {
  let best = null;
  for (const p of priced) {
    if (type && p.type !== type) continue;
    const m = numOrNull(p.moneyness);
    const iv = numOrNull(p.iv);
    if (m === null || iv === null || !(iv > 0)) continue;
    const lm = Math.log1p(m);
    const d = Math.abs(lm - targetM);
    if (d > tol) continue;
    const fresh = p.ivTraded === true;
    let better;
    if (best === null) better = true;
    else if (fresh !== best.fresh) better = fresh;
    else if (d !== best.d) better = d < best.d;
    else better = p.strike < best.strike;
    if (better) best = { d, fresh, iv, m: lm, strike: p.strike, type: p.type, traded: p.ivTraded };
  }
  return best;
}

function wingMiss(priced, targetM, tol, type) {
  let listed = 0, unpriced = 0;
  let nearest = null, nearestM = null, nearestStrike = null;
  for (const p of priced) {
    if (type && p.type !== type) continue;
    const m = numOrNull(p.moneyness);
    if (m === null) continue;
    listed++;
    const lm = Math.log1p(m);
    const d = Math.abs(lm - targetM);
    const iv = numOrNull(p.iv);
    if (iv === null || !(iv > 0)) {

      if (d <= tol) unpriced++;
      continue;
    }
    if (nearest === null || d < nearest) {
      nearest = d; nearestM = round(lm, 4); nearestStrike = round(p.strike, 2);
    }
  }
  return { listed, unpriced, nearest: nearest === null ? null : round(nearest, 4),
    nearestM, nearestStrike };
}

export function summariseSkewMisses(misses, { tolerance = SKEW_TOLERANCE } = {}) {
  const list = Array.isArray(misses) ? misses.filter(Boolean) : [];
  let unlisted = 0, unpriced = 0, inside = 0;
  const gaps = [];
  for (const m of list) {
    for (const w of [m.put, m.call]) {
      if (!w || !w.listed) { unlisted++; continue; }
      if (w.nearest === null || w.nearest === undefined) { unpriced++; continue; }

      if (w.nearest <= tolerance) { inside++; continue; }
      gaps.push(w.nearest);
    }
  }
  gaps.sort((a, b) => a - b);
  return {
    names: list.length,
    wings: list.length * 2,
    unlisted, unpriced, inside,
    outside: gaps.length,
    gaps,
    tolerance,

    wouldCatch: (t) => gaps.filter((g) => g <= t).length,
  };
}

export function chainScalars(pricedByExpiry, surface, {
  targetM = SKEW_MONEYNESS,
  tol = SKEW_TOLERANCE,
  minDays = SKEW_MIN_DAYS,
  termFarDays = TERM_FAR_DAYS,
} = {}) {
  const byExpiry = new Map();
  for (const e of pricedByExpiry.values()) byExpiry.set(e.expiry, e);

  const levels = (surface && surface.status === "ok" ? surface.expiries : [])
    .filter((e) => e.days !== null && e.atmIv !== null)
    .sort((a, b) => a.days - b.days);
  const anyColumn = (surface && surface.status === "ok" ? surface.expiries : [])
    .filter((e) => e.days !== null)
    .sort((a, b) => a.days - b.days);

  const nearLevel = levels.find((e) => e.days >= minDays) || null;
  const farLevel = levels.find((e) => nearLevel && e.days >= Math.max(termFarDays, nearLevel.days + 1)) || null;

  let skew = null, skewBasis = null, skewExpiry = null;
  for (const col of anyColumn) {
    if (col.days < minDays) continue;
    const e = byExpiry.get(col.expiry);
    if (!e) continue;
    const put = wingAt(e.priced, -targetM, tol, "P");
    const call = wingAt(e.priced, targetM, tol, "C");
    if (!put || !call) continue;
    skew = put.iv - call.iv;
    skewExpiry = col;
    skewBasis = {
      expiry: col.expiry, days: col.days,
      putM: round(put.m, 4), putStrike: round(put.strike, 2), putIv: round(put.iv, 4),
      putType: put.type,
      putTraded: put.traded === true ? 1 : put.traded === false ? 0 : null,
      callM: round(call.m, 4), callStrike: round(call.strike, 2), callIv: round(call.iv, 4),
      callType: call.type,
      callTraded: call.traded === true ? 1 : call.traded === false ? 0 : null,
    };
    break;
  }

  const reachedFloor = anyColumn.some((e) => e.days >= minDays);

  let skewMiss = null;
  if (skew === null && reachedFloor) {
    const col = anyColumn.find((e) => e.days >= minDays);
    const e = col ? byExpiry.get(col.expiry) : null;
    if (e) {
      skewMiss = {
        expiry: col.expiry, days: col.days,
        put: wingMiss(e.priced, -targetM, tol, "P"),
        call: wingMiss(e.priced, targetM, tol, "C"),
      };
    }
  }

  const missClause = (side, w) => {
    if (!w) return `${side}: not measured`;
    if (!w.listed) return `${side}: no contract of that type listed on this expiry`;
    if (w.nearest === null) {
      return `${side}: ${w.listed} listed, none carrying an implied volatility`;
    }
    return `${side}: nearest priced strike ${w.nearestStrike} at ln(K/S) ${w.nearestM}, ` +
      `${w.nearest} away from the target (window is ${tol})` +
      (w.unpriced ? `, and ${w.unpriced} inside the window carried no implied volatility` : "");
  };

  const skewReason = skew !== null ? null
    : !reachedFloor ? `no listed expiry on this chain reached ${minDays} days`
      : `no expiry past ${minDays} days quoted BOTH a put within ${tol} of ` +
        `ln(K/S) = −${targetM} and a call within ${tol} of +${targetM}` +
        (skewMiss
          ? `. On ${skewMiss.expiry} (${skewMiss.days}d) — ` +
            missClause("put wing", skewMiss.put) + "; " +
            missClause("call wing", skewMiss.call) +
            ". A miss inside a tick of the window is a ladder-spacing problem a wider " +
            "tolerance would fix; an unpriced wing is not, and is a fact about coverage."
          : "");

  const rawAtm = nearLevel ? nearLevel.atmIv : null;
  const overCeiling = rawAtm !== null && rawAtm > ATM_IV_CEILING;
  const atmIv = overCeiling ? null : rawAtm;
  const atmReason = atmIv !== null ? null
    : overCeiling
      ? `the at-the-money reading was ${rawAtm.toFixed(2)} (${(rawAtm * 100).toFixed(0)}% ` +
        `annualised), past the ${ATM_IV_CEILING} ceiling this module will vouch for — the ` +
        "per-chain percent convention and the surface's tripwire share one threshold and " +
        "fail together, so a chain quoting in this band is not distinguishable from a " +
        "mis-scaled one"
      : !reachedFloor ? `no listed expiry on this chain reached ${minDays} days`
        : "no expiry past the floor carried an at-the-money contract that traded today";

  const farOver = farLevel && farLevel.atmIv > ATM_IV_CEILING;
  const term = nearLevel && farLevel && !overCeiling && !farOver
    ? farLevel.atmIv - nearLevel.atmIv : null;
  const termReason = term !== null ? null
    : overCeiling || farOver ? atmReason || "an at-the-money level was past the stated ceiling"
      : !nearLevel ? atmReason
        : `no levelled expiry reached ${termFarDays} days, so there is no far leg to difference`;

  return {
    skew: round(skew, 4),
    skewReason,
    skewBasis,

    skewMiss,
    term: round(term, 4),
    termReason,
    termBasis: term !== null
      ? { near: nearLevel.expiry, nearDays: nearLevel.days, nearAtm: round(nearLevel.atmIv, 4),
          far: farLevel.expiry, farDays: farLevel.days, farAtm: round(farLevel.atmIv, 4) }
      : null,
    atmIv: round(atmIv, 4),
    atmExpiry: nearLevel ? nearLevel.expiry : null,
    atmReason,
    relation: `skew = put iv(ln K/S = −${targetM}) − call iv(ln K/S = +${targetM}) on the nearest ` +
      `expiry at or past ${minDays} days carrying both wings; nearest listed strike within ` +
      `${tol} of each target, freshness before distance, no interpolation. ` +
      `+ means the put wing is bid over the call wing. ` +
      `term = at-the-money iv at the nearest levelled expiry past ${termFarDays} days ` +
      `minus the nearest past ${minDays} days, both levels the surface's own.`,
    choice: true,
  };
}

export function buildSkewTerm(surface, scalars) {
  if (!surface || surface.status !== "ok") {
    return dead((surface && surface.reason) || "no surface was built for this chain");
  }
  const points = surface.expiries.map((e) => ({
    expiry: e.expiry,
    days: e.days,
    atmIv: round(e.atmIv, 4),
    reason: e.atmIv === null ? e.atmReason : null,
  }));
  const levelled = points.filter((p) => p.atmIv !== null).length;
  return {
    status: "ok",
    points,
    levelled,
    atmBand: surface.atmBand,
    ...scalars,
  };
}

function asParsedPairs(rows, given) {
  if (Array.isArray(given)) return given;
  return (rows || []).map((row) => ({ p: parseOptionSymbol(row && row.option_symbol), row }));
}

export function buildTopContracts(rows, {
  spot, ivDivisor = 1, limit = TOP_CONTRACTS,

  parsed: given = null,
} = {}) {
  const parsed = [];
  for (const { p, row } of asParsedPairs(rows, given)) {
    if (!p) continue;
    const volume = numOrNull(row.volume);
    if (volume === null || !(volume > 0)) continue;
    const ivRaw = numOrNull(row.implied_volatility);
    const oi = numOrNull(row.open_interest);
    const prevOi = numOrNull(row.prev_oi);
    const ask = numOrNull(row.ask_volume);
    const bid = numOrNull(row.bid_volume);
    parsed.push({
      k: round(p.strike, 2),
      expiry: p.expiry,
      cp: p.type,
      vol: volume,
      oi,

      doi: oi !== null && prevOi !== null ? oi - prevOi : null,
      bidPx: round(numOrNull(row.nbbo_bid), 2),
      askPx: round(numOrNull(row.nbbo_ask), 2),
      iv: ivRaw !== null && ivRaw > 0 ? round(ivRaw / ivDivisor, 4) : null,

      aggr: ask !== null && bid !== null ? ask - bid : null,
      m: spot > 0 ? round(Math.log(p.strike / spot), 4) : null,
    });
  }
  if (!parsed.length) return dead("no contract on this chain reported volume today");
  parsed.sort((a, b) => b.vol - a.vol);
  const shown = parsed.slice(0, limit);

  const top = shown[0];
  const volTotal = shown.reduce((a, r) => a + r.vol, 0);
  const v = saidMagnitude(top.vol);
  const share = volTotal > 0 ? Math.round((top.vol / volTotal) * 100) : null;
  const aggrClause = top.aggr === null
    ? " (the vendor reported no aggressor split on that line)"
    : top.aggr === 0
      ? ", with its two sides exactly balanced"
      : (() => { const a = saidMagnitude(top.aggr);
        return `, net ${a.shown}${a.suffix} contracts ` +
          (top.aggr > 0 ? "taken at the offer" : "sold into the bid"); })();
  const lead = panelLead(
    `${top.cp === "P" ? "Put" : "Call"} ${top.k} expiring ${top.expiry} carried ` +
    `the day: ${v.shown}${v.suffix} contracts` +
    (share === null ? "" : `, ${share}% of the volume in the ${shown.length} ` +
      `row${shown.length === 1 ? "" : "s"} below`) + aggrClause + ".",
    {

      expiry: top.expiry,
      right: top.cp === "P" ? "Put" : "Call",
      strike: top.k,
      shownVol: v.shown,
      topVolume: top.vol,
      sharePct: share,
      rows: shown.length,
      aggrShown: top.aggr === null || top.aggr === 0
        ? null : saidMagnitude(top.aggr).shown,
      aggr: top.aggr,
    });
  return {
    status: "ok",
    lead,
    rows: shown,
    shown: shown.length,
    total: parsed.length,
    aggressorReported: shown.filter((r) => r.aggr !== null).length,
    relation: "aggr = ask_volume − bid_volume, in contracts, as the vendor counted each " +
      "print against the side of the book it hit; not dollarised",
  };
}

export function buildAggressor(rows, {
  spot, maxStrikes = AGGRESSOR_STRIKES, parsed: given = null,
} = {}) {
  const byStrike = new Map();
  const allStrikes = new Set();
  let reported = 0, unreported = 0;
  for (const { p, row } of asParsedPairs(rows, given)) {
    if (!p) continue;
    allStrikes.add(p.strike);
    const ask = numOrNull(row.ask_volume);
    const bid = numOrNull(row.bid_volume);

    const volume = numOrNull(row.volume);
    if (ask === null || bid === null) { if (volume === null || volume > 0) unreported++; continue; }
    if (ask === 0 && bid === 0 && !volume) continue;
    reported++;
    const k = p.strike;
    if (!byStrike.has(k)) {
      byStrike.set(k, { k, net: 0, vol: 0, volKnown: 0, volMissing: 0, calls: 0, puts: 0 });
    }
    const cell = byStrike.get(k);

    const signed = (ask - bid) * (p.type === "P" ? -1 : 1);
    cell.net += signed;
    if (volume === null) cell.volMissing++;
    else {
      cell.vol += volume; cell.volKnown++;
      if (p.type === "P") cell.puts += volume; else cell.calls += volume;
    }
  }
  if (!byStrike.size) {
    return dead(unreported
      ? `the vendor reported no aggressor split on any of the ${unreported} contracts that traded`
      : "no contract on this chain carried an aggressor split");
  }

  let ladder = [...byStrike.values()].sort((a, b) => a.k - b.k);

  const total = allStrikes.size;
  const measuredStrikes = ladder.length;

  if (spot > 0 && ladder.length > maxStrikes) {
    ladder = ladder
      .slice()
      .sort((a, b) => Math.abs(Math.log(a.k / spot)) - Math.abs(Math.log(b.k / spot)))
      .slice(0, maxStrikes)
      .sort((a, b) => a.k - b.k);
  } else if (ladder.length > maxStrikes) {
    ladder = ladder.slice(0, maxStrikes);
  }

  const aggrLead = (() => {
    const bars = ladder.map((c) => Math.round(c.net));
    const net = bars.reduce((a, n) => a + n, 0);

    const cut = ladder.length < measuredStrikes
      ? (spot > 0 ? " drawn nearest the money" : " drawn from the low-strike end")
      : " drawn";
    const nonZero = bars.filter((n) => n !== 0);
    if (!nonZero.length) {
      return panelLead(
        `Every one of the ${ladder.length} strike` +
        `${ladder.length === 1 ? "" : "s"}${cut} nets exactly zero: at each one, ` +
        `the call and put aggressor cancel.`,
        { strikes: ladder.length, ladderNet: 0 });
    }
    let bi = 0;
    for (let i = 1; i < bars.length; i++) {
      if (Math.abs(bars[i]) > Math.abs(bars[bi])) bi = i;
    }
    const heavy = ladder[bi], heavyNet = bars[bi];
    const hm = saidMagnitude(heavyNet);
    const heavySide = heavyNet > 0 ? "call" : "put";

    const said = (n) => `${round(heavy.k, 2)}, ${hm.shown}${hm.suffix} contracts ` +
      `net to the ${heavySide} side`;
    const contrast = (netSide) => netSide === heavySide
      ? `heaviest at ${said()}`
      : `the heaviest single strike went the other way: ${said()}`;
    if (net === 0) {
      return panelLead(
        `The ${ladder.length} strike${ladder.length === 1 ? "" : "s"}${cut} net ` +
        `exactly zero: the call and put aggressor cancel across them — ` +
        `heaviest at ${said()}.`,
        { strikes: ladder.length, ladderNet: 0, strike: round(heavy.k, 2),
          topNet: hm.shown, topNetExact: Math.abs(heavyNet) });
    }
    const nm = saidMagnitude(net);
    return panelLead(
      `${net > 0 ? "Calls" : "Puts"} were taken at the offer here: the ` +
      `${ladder.length} strike${ladder.length === 1 ? "" : "s"}${cut} net ` +
      `${nm.shown}${nm.suffix} contracts to the ${net > 0 ? "call" : "put"} ` +
      `side — ${contrast(net > 0 ? "call" : "put")}.`,
      { strikes: ladder.length, ladderNet: nm.shown, ladderNetExact: Math.abs(net),
        strike: round(heavy.k, 2), topNet: hm.shown,
        topNetExact: Math.abs(heavyNet) });
  })();

  return {
    status: "ok",
    lead: aggrLead,
    bars: ladder.map((c) => ({
      k: round(c.k, 2),
      net: Math.round(c.net),

      vol: c.volKnown ? Math.round(c.vol) : null,

      calls: c.volKnown ? Math.round(c.calls) : null,
      puts: c.volKnown ? Math.round(c.puts) : null,
      volMissing: c.volMissing || 0,
    })),
    shown: ladder.length,
    measuredStrikes,
    total,
    strikesUnreported: Math.max(0, total - measuredStrikes),
    reported,
    unreported,
    relation: "net = Σ (ask_volume − bid_volume) per strike, in contracts, signed by " +
      "what the buyer is long: calls +, puts −. Contracts with no reported split are " +
      "excluded and counted, never summed as zero; `total` counts strikes on the chain, " +
      "not strikes that reported",
  };
}

export function buildChainPanels(chainRows, {
  spot, asOf, ticker = null,

  requestedExpiry = null,

  stage = null,
} = {}) {
  const all = Array.isArray(chainRows) ? chainRows : [];
  const truncated = all.length >= CHAIN_PAGE_SIZE;

  const pairs = all.map((row) => ({ p: parseOptionSymbol(row && row.option_symbol), row }));

  const parsedRows = ticker ? pairs.filter((x) => x.p && x.p.ticker === ticker) : pairs;
  const rows = ticker ? parsedRows.map((x) => x.row) : all;
  const foreignRows = all.length - rows.length;
  if (!rows.length) {
    const reason = foreignRows
      ? `every one of the ${foreignRows} contracts the vendor returned belongs to an ` +
        `adjusted series, not to ${ticker}`
      : "the vendor returned no contracts for this symbol";
    return {
      status: "unavailable", reason, truncated: false, rowsSeen: 0,
      ivSurface: dead(reason), skewTerm: dead(reason),
      topContracts: dead(reason), aggressor: dead(reason),
      scalars: { skew: null, term: null, atmIv: null },
    };
  }
  if (!(spot > 0)) {
    const reason = "no spot price was resolved for this name, so no moneyness could be measured";
    return {
      status: "unavailable", reason, truncated, rowsSeen: rows.length,
      ivSurface: dead(reason), skewTerm: dead(reason),
      topContracts: dead(reason), aggressor: dead(reason),
      scalars: { skew: null, term: null, atmIv: null },
    };
  }

  const conv = ivConvention(rows.map((r) => numOrNull(r && r.implied_volatility)));
  const priced = [];
  for (const pair of parsedRows) {
    const p = priceSale(pair.row, { spot, asOf, ivDivisor: conv.divisor, parsed: pair.p });
    if (p) priced.push(p);
  }

  const { kept, collisions } = preferOutOfTheMoney(priced);

  const surface = ivSurface(kept, { ivBasis: conv.basis });
  const serial = serialiseSurface(surface);

  const byExpiry = new Map();
  for (const p of kept) {
    if (!p.expiry) continue;
    if (!byExpiry.has(p.expiry)) byExpiry.set(p.expiry, { expiry: p.expiry, days: p.days, priced: [] });
    byExpiry.get(p.expiry).priced.push(p);
  }
  let scalars = chainScalars(byExpiry, surface);

  const answersRequest = requestedExpiry !== null &&
    surface.expiries.length === 1 && surface.expiries[0].expiry === requestedExpiry;

  if (truncated && !answersRequest) {
    const why = `the vendor returned a full page of ${CHAIN_PAGE_SIZE} contracts in no ` +
      "documented order, so this is an arbitrary subset of the book and \"the nearest " +
      "expiry\" cannot be identified within it";
    scalars = {
      ...scalars,
      skew: null, skewReason: why, skewBasis: null,
      term: null, termReason: why, termBasis: null,
      atmIv: null, atmReason: why, atmExpiry: null,
    };
  }

  return {
    status: "ok",
    reason: null,
    truncated,

    identifiedExpiry: answersRequest ? requestedExpiry : null,

    rowsReturned: all.length,

    rowsSeen: rows.length,

    pricedRows: priced.length,

    surfacedRows: kept.length,
    strikeCollisions: collisions,
    foreignRows,
    ivBasis: conv.basis,
    ivSurface: serial,
    skewTerm: buildSkewTerm(serial, scalars),
    topContracts: buildTopContracts(rows, { spot, ivDivisor: conv.divisor, parsed: parsedRows }),
    aggressor: buildAggressor(rows, { spot, parsed: parsedRows }),

    unusualRows: buildUnusualRows(rows, {
      ticker, spot, ivDivisor: conv.divisor, sessionDate: asOf, truncated,
      stage, parsed: parsedRows,
    }),
    ivDivisor: conv.divisor,

    oiBasis: describeOiBasis(rows),

    scalars: {
      skew: scalars.skew, term: scalars.term, atmIv: scalars.atmIv,
      skewDays: scalars.skewBasis ? scalars.skewBasis.days : null,
      atmDays: scalars.termBasis ? scalars.termBasis.nearDays : null,
    },
  };
}

export { SURFACE_MAX_EXPIRIES, SURFACE_MAX_ROWS };
