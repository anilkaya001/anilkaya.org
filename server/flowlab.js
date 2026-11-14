import { HttpError } from "./http.js";
import { pathFor, opById } from "../shared/flows-vendor-ops.js";
import {
  FLOWLAB_LIMITS, GROUPS, HARD_REASONS, presetParams, parseOsi, reduceScreen, reduceContract, reduceAlert, reduceStructures, reduceLegs, reduceStrikes,
  reduceStrikeDay, reduceExpiries, reduceGreek, reduceLadders, reduceLit, reduceVenues, thirdFridayExpiry, groupEntry, orderGroups,
} from "../shared/flows-flowlab.js";
import { easternInstant, sessionOpen } from "../shared/flows-freshness.js";

export const FLOWLAB_CALLS = Object.freeze({
  screen: 1, core: 3, alert: 1, structure: 1, legs: 1, strikes: 2, recent: 1, greek: 1, levels: 2, lit: 1, venues: 1, group: 1, litMarket: 1, groups: 25, venuesUniverse: 1,
});

export const MAX_BYTES = 524288;

export const DEADLINE_MS = 8000;

export const STRIKES_DEADLINE_MS = 12000;

export const GROUPS_WIDTH = 5;

export const GROUPS_DEADLINE_MS = 6000;

export const GROUPS_BUDGET_MS = 10000;

export const LIT_LIMIT = 200;

export const LIT_MIN_PREMIUM = 500000;

export const VENUES_UNIVERSE_LIMIT = 100;

export const STRIKE_FILTER = "Volume";

export const capOf = (id) => Math.max(MAX_BYTES, opById(id).maxBytes || 0);

export const READ_CLASSES = Object.freeze(["too_large", "status_5xx", "status_4xx", "unparsable", "timeout", "network", "limited", "plan", "empty", "unconfigured"]);

const causeOf = (error) => (error && error.cause && typeof error.cause === "object" ? error.cause : null);

const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

function statusOf(error) {
  if (Number.isInteger(error && error.upstream)) return error.upstream;
  const cause = causeOf(error);
  return cause && Number.isInteger(cause.status) ? cause.status : null;
}

export function classOf(error) {
  const cause = causeOf(error);
  const kind = cause && typeof cause.kind === "string" ? cause.kind : null;
  const code = error && error.code;
  const status = statusOf(error);
  if (code === "chain_unconfigured" || kind === "unconfigured") return "unconfigured";
  if (code === "chain_timeout" || kind === "timeout") return "timeout";
  if (code === "chain_too_large" || kind === "too_large") return "too_large";
  if (code === "chain_rate_limited" || status === 429) return "limited";
  if (status === 404) return "empty";
  if (status === 401 || status === 402 || status === 403) return "plan";
  if (status !== null && status >= 500) return "status_5xx";
  if (status !== null && status >= 400) return "status_4xx";
  if (kind === "unparsable") return "unparsable";
  return "network";
}

const WHY_OF_CLASS = Object.freeze({ too_large: "cap", timeout: "timeout", limited: "limited", plan: "plan", empty: "empty" });

export const whyOf = (error) => WHY_OF_CLASS[classOf(error)] || "failed";

const STATUS_CLASSES = Object.freeze(["status_5xx", "status_4xx", "limited", "plan", "empty"]);

export function readOf(id, error, cap, ms) {
  const cause = causeOf(error);
  const cls = classOf(error);
  return { op: id, class: cls, status: STATUS_CLASSES.includes(cls) ? statusOf(error) : null, bytes: count(cause && cause.bytes), cap, ms: count(cause && cause.ms) ?? count(ms) };
}

export const HARD_CODES = Object.freeze({ timeout: "chain_timeout", cap: "chain_too_large", limited: "chain_rate_limited", failed: "chain_upstream" });

export function hardError(why, read) {
  const code = read && read.class === "unconfigured" ? "chain_unconfigured" : HARD_CODES[why] || "chain_upstream";
  return HttpError.of(code, undefined, undefined, read ? { read } : undefined);
}

const hard = (r) => !!r && !r.ok && HARD_REASONS.includes(r.why);

const slim = (r) => (r.ok ? { ok: true, x: r.x } : { ok: false, why: r.why, read: r.read || null, ...(r.date ? { date: r.date } : {}) });

export function createFlowlab({ isRefusal = () => false, report = () => {} } = {}) {
  const start = () => ({ calls: 0 });

  const read = async (vf, st, op, params, query = {}, deadlineMs = DEADLINE_MS) => {
    const id = op.id;
    const path = pathFor(id, params);
    const cap = capOf(id);
    const began = Date.now();
    st.calls += 1;
    try {
      return { ok: true, body: await vf(path, query, { deadlineMs, maxBytes: cap }) };
    } catch (error) {
      if (isRefusal(error)) throw error;
      const r = readOf(id, error, cap, Date.now() - began);
      if (r.class !== "empty") report(r);
      return { ok: false, why: whyOf(error), read: r };
    }
  };

  const head = (st, part, session, now, extra) => ({ v: 1, asOf: new Date(now).toISOString(), session, part, calls: st.calls, ...extra });

  const soft = (r) => ({ why: r.why, ...(r.read ? { read: r.read } : {}), ...(r.date ? { date: r.date } : {}), ...(r.missing ? { missing: r.missing } : {}) });

  const finish = (st, part, session, now, extra, result, key = "x") => {
    if (result.ok) return { ...head(st, part, session, now, extra), [key]: result.x };
    if (HARD_REASONS.includes(result.why)) throw hardError(result.why, result.read);
    return { ...head(st, part, session, now, extra), ...soft(result), [key]: null };
  };

  const firstHard = (...reads) => reads.find(hard) || null;

  const buildScreen = async (vf, { preset, ticker = null, session, now, closed = false }) => {
    const st = start();
    const query = presetParams(preset, { ticker, asOf: session });
    if (query === null) throw HttpError.of("invalid_preset");
    const res = await read(vf, st, opById("contract-screener"), {}, query, 12000);
    const out = res.ok
      ? reduceScreen(res.body, { session, preset, asOf: new Date(now).toISOString(), date: session })
      : res;
    return finish(st, "screen", session, now, { preset, ticker, closed }, out);
  };

  const buildContractCore = async (vf, { c, session, now, closed = false }) => {
    const st = start();
    const query = { date: session };
    const [flow, intraday, profile] = await Promise.all([
      read(vf, st, opById("contract-flow"), { id: c }, { ...query, limit: 100 }),
      read(vf, st, opById("contract-intraday"), { id: c }, query),
      read(vf, st, opById("contract-profile"), { id: c }, query),
    ]);
    const reduced = reduceContract({
      flow: flow.ok ? flow.body : null, intraday: intraday.ok ? intraday.body : null, profile: profile.ok ? profile.body : null,
    }, { c, date: session });
    const reads = [flow, intraday, profile];
    if (!reduced.ok) return finish(st, "core", session, now, { c, closed }, reads.find((r) => !r.ok) || { ok: false, why: reduced.why });
    const x = reduced.x;
    ["prints", "minutes", "profile"].forEach((k, i) => { if (!reads[i].ok) x[k] = slim(reads[i]); });
    const partial = !!firstHard(...reads);
    return { ...head(st, "core", session, now, { c, closed, ...(partial ? { partial } : {}) }), x };
  };

  const buildAlert = async (vf, { id, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, opById("flow-alert-trades"), { id });
    return finish(st, "alert", session, now, { id, closed }, res.ok ? reduceAlert(res.body) : res);
  };

  const dayWindow = (session) => ({ newer_than: new Date(easternInstant(session, 0)).toISOString(), older_than: new Date(easternInstant(session, 1440)).toISOString() });

  const buildStructure = async (vf, { c, session, now, closed = false }) => {
    const st = start();
    const osi = parseOsi(c);
    const res = await read(vf, st, opById("multi-leg"), {}, { ticker_symbol: osi.root, limit: 100, ...dayWindow(session) });
    return finish(st, "structure", session, now, { c, closed }, res.ok ? reduceStructures(res.body, { c, session }) : res);
  };

  const buildLegs = async (vf, { id, c, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, opById("multi-leg-legs"), { id });
    return finish(st, "legs", session, now, { id, c, closed }, res.ok ? reduceLegs(res.body, { c }) : res);
  };

  const twoParts = (st, session, now, extra, reads, parts, x) => {
    if (!parts.some((p) => p.ok)) {
      const h = firstHard(...reads);
      if (h) throw hardError(h.why, h.read);
      return { ...head(st, "name", session, now, extra), ...soft(parts.find((p) => p.why !== "empty") || parts[0]), x: null };
    }
    const partial = !!firstHard(...reads);
    return { ...head(st, "name", session, now, { ...extra, ...(partial ? { partial } : {}) }), x };
  };

  const buildNameView = async (vf, { t, view, exp = null, session, now, closed = false }) => {
    const st = start();
    const extra = { t, view, closed, ...(exp ? { exp } : {}) };
    if (view === "strikes") {
      const [day, minute] = await Promise.all([
        read(vf, st, opById("flow-per-strike"), { ticker: t }, { date: session }),
        read(vf, st, opById("strike-flow-intraday"), { ticker: t }, { date: session, filter: STRIKE_FILTER }, STRIKES_DEADLINE_MS),
      ]);
      const rail = day.ok ? reduceStrikeDay(day.body, { session }) : day;
      const center = rail.ok ? rail.x.center : null;
      const map = minute.ok ? reduceStrikes(minute.body, { openMs: sessionOpen(session), session, center }) : minute;
      return twoParts(st, session, now, extra, [day, minute], [map, rail], { map: slim(map), rail: slim(rail), center });
    }
    if (view === "recent") {
      const res = await read(vf, st, opById("flow-per-expiry"), { ticker: t });
      return finish(st, "name", session, now, extra, res.ok ? reduceExpiries(res.body, { session }) : res);
    }
    if (view === "greek") {
      const res = await read(vf, st, opById("greek-flow-expiry"), { ticker: t, expiry: exp }, { date: session });
      return finish(st, "name", session, now, extra, res.ok ? reduceGreek(res.body, { expiry: exp, openMs: sessionOpen(session) }) : res);
    }
    if (view === "levels") {
      const [options, stock] = await Promise.all([
        read(vf, st, opById("option-price-levels"), { ticker: t }, { date: session }),
        read(vf, st, opById("darkpool-levels"), { ticker: t }, { date: session }),
      ]);
      const reduced = reduceLadders({ options: options.ok ? options.body : null, stock: stock.ok ? stock.body : null }, { session });
      if (!reduced.ok) {
        const h = firstHard(options, stock);
        if (h) throw hardError(h.why, h.read);
        const first = [options, stock].find((r) => !r.ok) || reduced;
        return { ...head(st, "name", session, now, extra), ...soft(first), x: null };
      }
      const x = reduced.x;
      x.reads = {
        options: options.ok ? x.optionWhy : { why: options.why, read: options.read },
        stock: stock.ok ? x.stockWhy : { why: stock.why, read: stock.read },
      };
      delete x.optionWhy;
      delete x.stockWhy;
      const partial = !!firstHard(options, stock);
      return { ...head(st, "name", session, now, { ...extra, ...(partial ? { partial } : {}) }), x };
    }
    const res = await read(vf, st, opById("lit-ticker"), { ticker: t }, { date: session, limit: FLOWLAB_LIMITS.litTicker });
    return finish(st, "name", session, now, extra, res.ok ? reduceLit(res.body, { mode: "ticker" }) : res);
  };

  const buildGroup = async (vf, { g, exp, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, opById("group-greek-flow-expiry"), { flow_group: g, expiry: exp }, { date: session });
    return finish(st, "group", session, now, { g, exp, closed }, res.ok ? reduceGreek(res.body, { group: true, expiry: exp }) : res);
  };

  const buildGroups = async (vf, { session, now, closed = false }) => {
    const st = start();
    const expiry = thirdFridayExpiry(session);
    const extra = { closed, source: "read" };
    if (!expiry) return { ...head(st, "groups", session, now, extra), sessionDate: session, why: "unshaped", groups: null };
    const openMs = sessionOpen(session);
    const began = Date.now();
    const entries = {};
    const queue = [...GROUPS];
    let refused = null;
    let failure = null;
    const lane = async () => {
      while (queue.length) {
        const g = queue.shift();
        if (refused) { entries[g] = { status: "limited" }; continue; }
        if (Date.now() - began > GROUPS_BUDGET_MS) { entries[g] = { status: "timeout" }; continue; }
        let res;
        try {
          res = await read(vf, st, opById("group-greek-flow-expiry"), { flow_group: g, expiry }, { date: session }, GROUPS_DEADLINE_MS);
        } catch (error) {
          if (!isRefusal(error)) throw error;
          refused = error;
          entries[g] = { status: "limited" };
          continue;
        }
        if (!failure && hard(res)) failure = res;
        entries[g] = groupEntry(res.ok ? reduceGreek(res.body, { group: true, expiry }) : res, openMs);
      }
    };
    await Promise.all(Array.from({ length: GROUPS_WIDTH }, lane));
    const groups = orderGroups(entries);
    const statuses = Object.values(groups).map((q) => q.status);
    if (!statuses.includes("ok")) {
      if (refused) throw refused;
      if (failure) throw hardError(failure.why, failure.read);
    }
    const partial = statuses.some((q) => q === "limited" || q === "timeout" || q === "failed" || q === "cap");
    return { ...head(st, "groups", session, now, { ...extra, ...(partial ? { partial } : {}) }), sessionDate: session, expiry, groups };
  };

  const buildLitMarket = async (vf, { session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, opById("lit-recent"), {}, { date: session, limit: LIT_LIMIT, min_premium: String(LIT_MIN_PREMIUM) });
    return finish(st, "lit", session, now, { closed, minPremium: LIT_MIN_PREMIUM, limit: LIT_LIMIT }, res.ok ? reduceLit(res.body, { mode: "market", minPremiumC: LIT_MIN_PREMIUM * 100 }) : res);
  };

  const buildVenuesToday = async (vf, { t, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, opById("exchange-breakdown"), { date: session }, { "ticker[]": t, by_trade_code: "true" });
    return finish(st, "venues", session, now, { t, closed }, res.ok ? reduceVenues(res.body, { ticker: t, codes: true }) : res);
  };

  const buildVenuesUniverse = async (vf, { session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, opById("exchange-breakdown"), { date: session }, { limit: VENUES_UNIVERSE_LIMIT });
    const out = res.ok ? reduceVenues(res.body, {}) : res;
    const extra = { closed, source: "read", sessionDate: session };
    if (out.ok) return { ...head(st, "venues", session, now, extra), tickers: out.x.tickers, limit: VENUES_UNIVERSE_LIMIT };
    if (HARD_REASONS.includes(out.why)) throw hardError(out.why, out.read);
    return { ...head(st, "venues", session, now, extra), ...soft(out), tickers: null };
  };

  return { buildScreen, buildContractCore, buildAlert, buildStructure, buildLegs, buildNameView, buildGroup, buildGroups, buildLitMarket, buildVenuesToday, buildVenuesUniverse };
}
