import { read, rowsOf, chunks, pastDeadline, freshStamp } from "./common.mjs";
import { buildUniverse, addDays, vstr } from "../../shared/flows-cross.js";

export const HARVEST_LIMIT = 500;

export const HARVEST_MAX_PAGES = 4;

export const INDEX_TICKERS = Object.freeze(["SPY", "QQQ", "IWM"]);

export const SHORT_BATCH = 50;

export const SHORT_LOOKBACK_DAYS = 45;

export const SHORT_LIMIT = 500;

export const INSIDER_BATCH = 25;

export const INSIDER_LOOKBACK_DAYS = 92;

export const INSIDER_MAX_PAGES = 3;

export const INSIDER_LIMIT = 500;

export async function harvestScreener(uw, {
  filters = {}, date = null, limit = HARVEST_LIMIT, maxPages = HARVEST_MAX_PAGES,
} = {}) {
  const byTicker = new Map();
  const errors = [];
  const readAt = new Date().toISOString();
  let pages = 0, calls = 0, truncated = false, repeated = false;
  for (let page = 0; page < maxPages; page++) {
    const res = await read(uw, "/api/screener/stocks", {
      ...filters,
      order: "marketcap",
      order_direction: "desc",
      limit,
      offset: page,
      ...(date ? { date } : {}),
    });
    calls++;
    if (!res.ok) { errors.push(res.error); break; }
    const list = rowsOf(res.body);
    pages++;
    let added = 0;
    for (const r of list) {
      if (!r || typeof r.ticker !== "string" || !r.ticker) continue;
      if (!byTicker.has(r.ticker)) { byTicker.set(r.ticker, r); added++; }
    }
    if (list.length < limit) break;
    if (!added) { repeated = true; break; }
    if (page === maxPages - 1) truncated = true;
  }
  return {
    rows: [...byTicker.values()],
    pages, calls, truncated, repeated, errors, limit, readAt,
    dated: !!date,
    offset: "page index (probe 2026-09-23: offset=1 returned the next page, not row 2)",
  };
}

export const HOLDINGS_PATH = "/api/etfs/QQQ/holdings";

export async function readHoldings(uw, { path = HOLDINGS_PATH } = {}) {
  const res = await read(uw, path, {}, { envelope: true });
  return { ...res, rows: res.ok ? rowsOf(res.body) : null, path, calls: 1 };
}

export function withPrefetched(uw, prefetched = new Map()) {
  const wrapped = async (path, params = {}, opts = {}) => {
    const hit = prefetched.get(path);
    if (hit && (!params || !Object.keys(params).length)) {
      if (!hit.ok) throw new Error(hit.error || `${path} -> read failed`);
      if (opts && opts.envelope) return hit.body;
      return Array.isArray(hit.body) ? hit.body : (hit.body && hit.body.data) || [];
    }
    return uw(path, params, opts);
  };
  return Object.assign(wrapped, uw);
}

export async function screenerByTicker(uw, tickers, { date = null } = {}) {
  const want = [...new Set((tickers || []).filter((t) => typeof t === "string" && t))];
  if (!want.length) return { rows: new Map(), missing: [], calls: 0, ok: true, error: null };
  const res = await read(uw, "/api/screener/stocks", {
    ticker: want.join(","), limit: HARVEST_LIMIT, ...(date ? { date } : {}),
  });
  const rows = new Map();
  if (res.ok) for (const r of rowsOf(res.body)) if (r && want.includes(r.ticker) && !rows.has(r.ticker)) rows.set(r.ticker, r);
  return {
    rows, ok: res.ok, gated: !!res.gated, error: res.ok ? null : res.error,
    missing: want.filter((t) => !rows.has(t)), calls: 1,
  };
}

export async function fetchMissingMembers(uw, wanted, heldTickers, { date = null } = {}) {
  const held = heldTickers instanceof Set ? heldTickers : new Set(heldTickers || []);
  const absent = [...new Set(wanted || [])].filter((t) => !held.has(t)).sort();
  if (!absent.length) return { asked: [], rows: [], missing: [], calls: 0, ok: true, error: null };
  const got = await screenerByTicker(uw, absent, { date });
  return { asked: absent, rows: [...got.rows.values()], missing: got.missing, calls: got.calls, ok: got.ok, error: got.error };
}

export async function readFocusRows(uw, tickers, { date = null, readAt = () => new Date().toISOString() } = {}) {
  const got = await screenerByTicker(uw, tickers, { date });
  return { ...got, readAt: readAt() };
}

export async function readIndexRows(uw, { date = null, tickers = INDEX_TICKERS } = {}) {
  const res = await read(uw, "/api/screener/stocks", {
    ticker: tickers.join(","), limit: HARVEST_LIMIT, ...(date ? { date } : {}),
  });
  const rows = new Map();
  if (res.ok) for (const r of rowsOf(res.body)) if (r && tickers.includes(r.ticker)) rows.set(r.ticker, r);
  return {
    rows,
    status: res.ok ? (rows.size ? "ok" : "quiet") : "unavailable",
    missing: tickers.filter((t) => !rows.has(t)),
    error: res.ok ? null : res.error,
    calls: 1,
  };
}

export function batchSilence(kind, { res = null, why = null } = {}) {
  if (kind === "deadline") return { status: "unavailable", reason: "not_read", why: why || "the run deadline passed before this batch was read" };
  if (kind === "truncated") {
    return { status: "unavailable", reason: "unreadable", detail: why || "the batch reached the vendor's row limit before this name" };
  }
  return {
    status: "unavailable", reason: res && res.gated ? "plan_gated" : "unreadable",
    http: res ? res.status ?? null : null, detail: why || (res && res.error) || "the batch read failed",
  };
}

export async function readShortInterest(uw, tickers, {
  sessionDate = null, batch = SHORT_BATCH, lookbackDays = SHORT_LOOKBACK_DAYS, deadline = null,
} = {}) {
  const rows = [];
  const unread = new Map();
  let calls = 0, truncated = 0, unfiltered = 0, failed = 0;
  const min = sessionDate ? addDays(sessionDate, -lookbackDays) : null;
  for (const group of chunks([...new Set(tickers)], batch)) {
    if (pastDeadline(deadline)) {
      for (const t of group) unread.set(t, batchSilence("deadline"));
      continue;
    }
    const res = await read(uw, "/api/short_screener", {
      tickers: group.join(","),
      limit: SHORT_LIMIT,
      ...(min ? { min_market_date: min } : {}),
      ...(sessionDate ? { max_market_date: sessionDate } : {}),
    });
    calls++;
    if (!res.ok) {
      failed++;
      for (const t of group) unread.set(t, batchSilence("failed", { res }));
      continue;
    }
    const list = rowsOf(res.body);
    if (list.length >= SHORT_LIMIT) {
      truncated++;
      const named = new Set(list.map((r) => r && (vstr(r.symbol) || vstr(r.ticker))).filter(Boolean));
      for (const t of group) if (!named.has(t)) unread.set(t, batchSilence("truncated"));
    }
    if (min && list.some((r) => r && typeof r.market_date === "string" && r.market_date < min)) unfiltered++;
    rows.push(...list);
  }
  return {
    rows, calls, truncated, failed, unread,
    minHonoured: calls - failed > 0 ? unfiltered === 0 : null,
    lookbackDays,
  };
}

export async function readInsiders(uw, tickers, {
  sessionDate = null, batch = INSIDER_BATCH, lookbackDays = INSIDER_LOOKBACK_DAYS,
  maxPages = INSIDER_MAX_PAGES, deadline = null,
} = {}) {
  const rows = [];
  const seen = new Set();
  const unread = new Map();
  const partial = new Set();
  let calls = 0, failed = 0, capped = 0, repeated = 0;
  const start = sessionDate ? addDays(sessionDate, -lookbackDays) : null;
  for (const group of chunks([...new Set(tickers)], batch)) {
    let more = true;
    for (let page = 0; more && page < maxPages; page++) {
      if (pastDeadline(deadline)) {
        more = false;
        for (const t of group) {
          if (page === 0) unread.set(t, batchSilence("deadline"));
          else partial.add(t);
        }
        break;
      }
      const res = await read(uw, "/api/insider/transactions", {
        ticker_symbol: group.join(","),
        "form_types[]": ["4"],
        "transaction_codes[]": ["P", "S"],
        ...(start ? { start_date: start } : {}),
        ...(sessionDate ? { end_date: sessionDate } : {}),
        limit: INSIDER_LIMIT,
        ...(page ? { page } : {}),
      }, { envelope: true });
      calls++;
      if (!res.ok) {
        failed++;
        for (const t of group) {
          if (page === 0) unread.set(t, batchSilence("failed", { res }));
          else partial.add(t);
        }
        break;
      }
      const list = rowsOf(res.body);
      let added = 0;
      for (const r of list) {
        const id = r && (vstr(r.id) || (Array.isArray(r.ids) ? r.ids.join(",") : null));
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        rows.push(r);
        added++;
      }
      const hasMore = !!(res.body && res.body.has_more === true);
      more = hasMore && added > 0;
      if (hasMore && !added) repeated++;
      if (hasMore && (!added || page === maxPages - 1)) {
        capped++;
        for (const t of group) partial.add(t);
      }
    }
  }
  return { rows, calls, failed, capped, repeated, unread, partial, lookbackDays };
}

export function harvestBlock(h) {
  const errors = Array.isArray(h.errors) ? h.errors.length : Number.isFinite(h.errors) ? h.errors : 0;
  return {
    calls: h.calls ?? null, pages: h.pages ?? null, limit: h.limit ?? null,
    truncated: !!h.truncated, repeated: !!h.repeated, errors, dated: !!h.dated,
    rows: Array.isArray(h.rows) ? h.rows.length : 0, source: h.source || "harvest",
    complete: !h.truncated && !h.repeated && errors === 0,
  };
}

export function universePayload(rows, {
  sessionDate, generatedAt, harvest, screened, readAt,
} = {}) {
  return buildUniverse(rows, {
    sessionDate, generatedAt, screened,
    harvest: harvest ? harvestBlock(harvest) : null,
    fresh: freshStamp({ readAt, session: sessionDate }),
  });
}
