import { HttpError } from "./http.js";
import { pathFor } from "../shared/flows-vendor-ops.js";
import {
  FLOWLAB_LIMITS, presetParams, parseOsi, reduceScreen, reduceContract, reduceAlert, reduceStructures, reduceLegs, reduceStrikes, reduceRecent,
  reduceGreek, reduceLadders, reduceLit, reduceVenues,
} from "../shared/flows-flowlab.js";
import { easternInstant, sessionOpen } from "../shared/flows-freshness.js";

export const FLOWLAB_CALLS = Object.freeze({
  screen: 1, core: 3, alert: 1, structure: 1, legs: 1, strikes: 1, recent: 1, greek: 1, levels: 2, lit: 1, venues: 1, group: 1, litMarket: 1,
});

export const MAX_BYTES = 524288;

export const DEADLINE_MS = 8000;

export const HARD_FAILURES = Object.freeze({
  timeout: () => HttpError.of("chain_timeout"),
  failed: () => HttpError.of("chain_upstream"),
  limited: () => HttpError.of("chain_rate_limited"),
});

export function whyOf(error) {
  const code = error && error.code;
  const upstream = error && error.upstream;
  if (code === "chain_timeout") return "timeout";
  if (code === "chain_rate_limited" || upstream === 429) return "limited";
  if (upstream === 404) return "empty";
  if (upstream === 401 || upstream === 402 || upstream === 403 || upstream === 422) return "plan";
  return "failed";
}

export function createFlowlab({ isRefusal = () => false } = {}) {
  const start = () => ({ calls: 0 });

  const read = async (vf, st, path, query = {}, deadlineMs = DEADLINE_MS) => {
    st.calls += 1;
    try {
      return { ok: true, body: await vf(path, query, { deadlineMs, maxBytes: MAX_BYTES }) };
    } catch (error) {
      if (isRefusal(error)) throw error;
      return { ok: false, why: whyOf(error) };
    }
  };

  const head = (st, part, session, now, extra) => ({ v: 1, asOf: new Date(now).toISOString(), session, part, calls: st.calls, ...extra });

  const finish = (st, part, session, now, extra, result, key = "x") => {
    if (result.ok) return { ...head(st, part, session, now, extra), [key]: result.x };
    const hard = HARD_FAILURES[result.why];
    if (hard) throw hard();
    return { ...head(st, part, session, now, extra), why: result.why, [key]: null };
  };

  const failureOf = (...reads) => reads.map((r) => (r && !r.ok ? r.why : null));

  const buildScreen = async (vf, { preset, ticker = null, session, now, closed = false }) => {
    const st = start();
    const query = presetParams(preset, { ticker, asOf: session });
    if (query === null) throw HttpError.of("invalid_preset");
    const res = await read(vf, st, pathFor("contract-screener"), query, 12000);
    const out = res.ok
      ? reduceScreen(res.body, { session, preset, asOf: new Date(now).toISOString(), date: session })
      : res;
    return finish(st, "screen", session, now, { preset, ticker, closed }, out);
  };

  const buildContractCore = async (vf, { c, session, now, closed = false }) => {
    const st = start();
    const query = { date: session };
    const flow = await read(vf, st, pathFor("contract-flow", { id: c }), { ...query, limit: 100 });
    const intraday = await read(vf, st, pathFor("contract-intraday", { id: c }), query);
    const profile = await read(vf, st, pathFor("contract-profile", { id: c }), query);
    const reduced = reduceContract({
      flow: flow.ok ? flow.body : null, intraday: intraday.ok ? intraday.body : null, profile: profile.ok ? profile.body : null,
    }, { c, date: session });
    const fails = failureOf(flow, intraday, profile);
    if (!reduced.ok) {
      const first = fails.find((w) => w) || reduced.why;
      return finish(st, "core", session, now, { c, closed }, { ok: false, why: first });
    }
    const x = reduced.x;
    ["prints", "minutes", "profile"].forEach((k, i) => { if (fails[i]) x[k] = { ok: false, why: fails[i] }; });
    return { ...head(st, "core", session, now, { c, closed }), x };
  };

  const buildAlert = async (vf, { id, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, pathFor("flow-alert-trades", { id }));
    return finish(st, "alert", session, now, { id, closed }, res.ok ? reduceAlert(res.body) : res);
  };

  const dayWindow = (session) => ({ newer_than: new Date(easternInstant(session, 0)).toISOString(), older_than: new Date(easternInstant(session, 1440)).toISOString() });

  const buildStructure = async (vf, { c, session, now, closed = false }) => {
    const st = start();
    const osi = parseOsi(c);
    const res = await read(vf, st, pathFor("multi-leg"), { ticker_symbol: osi.root, limit: 100, ...dayWindow(session) });
    return finish(st, "structure", session, now, { c, closed }, res.ok ? reduceStructures(res.body, { c, session }) : res);
  };

  const buildLegs = async (vf, { id, c, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, pathFor("multi-leg-legs", { id }));
    return finish(st, "legs", session, now, { id, c, closed }, res.ok ? reduceLegs(res.body, { c }) : res);
  };

  const buildNameView = async (vf, { t, view, exp = null, session, now, spot = null, closed = false }) => {
    const st = start();
    const extra = { t, view, closed, ...(exp ? { exp } : {}) };
    if (view === "strikes") {
      const res = await read(vf, st, pathFor("strike-flow-intraday", { ticker: t }), { date: session }, 12000);
      return finish(st, "name", session, now, extra, res.ok ? reduceStrikes(res.body, { openMs: sessionOpen(session), spot }) : res);
    }
    if (view === "recent") {
      const res = await read(vf, st, pathFor("flow-recent", { ticker: t }));
      return finish(st, "name", session, now, extra, res.ok ? reduceRecent(res.body) : res);
    }
    if (view === "greek") {
      const res = await read(vf, st, pathFor("greek-flow-expiry", { ticker: t, expiry: exp }), { date: session });
      return finish(st, "name", session, now, extra, res.ok ? reduceGreek(res.body, { expiry: exp }) : res);
    }
    if (view === "levels") {
      const options = await read(vf, st, pathFor("option-price-levels", { ticker: t }), { date: session });
      const stock = await read(vf, st, pathFor("stock-price-levels", { ticker: t }), { date: session });
      const reduced = reduceLadders({ options: options.ok ? options.body : null, stock: stock.ok ? stock.body : null }, { spot });
      const fails = failureOf(options, stock);
      if (!reduced.ok) return finish(st, "name", session, now, extra, { ok: false, why: fails.find((w) => w) || reduced.why });
      reduced.x.reads = { options: fails[0], stock: fails[1] };
      return finish(st, "name", session, now, extra, reduced);
    }
    const res = await read(vf, st, pathFor("lit-ticker", { ticker: t }), { date: session, limit: FLOWLAB_LIMITS.litTicker });
    return finish(st, "name", session, now, extra, res.ok ? reduceLit(res.body, { mode: "ticker" }) : res);
  };

  const buildGroup = async (vf, { g, exp, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, pathFor("group-greek-flow-expiry", { flow_group: g, expiry: exp }), { date: session });
    return finish(st, "group", session, now, { g, exp, closed }, res.ok ? reduceGreek(res.body, { group: true, expiry: exp }) : res);
  };

  const buildLitMarket = async (vf, { session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, pathFor("lit-recent"), { date: session, limit: 100 });
    return finish(st, "lit", session, now, { closed }, res.ok ? reduceLit(res.body, { mode: "market" }) : res);
  };

  const buildVenuesToday = async (vf, { t, session, now, closed = false }) => {
    const st = start();
    const res = await read(vf, st, pathFor("exchange-breakdown", { date: session }), { "ticker[]": t, limit: 100 });
    return finish(st, "venues", session, now, { t, closed }, res.ok ? reduceVenues(res.body, { ticker: t }) : res);
  };

  return { buildScreen, buildContractCore, buildAlert, buildStructure, buildLegs, buildNameView, buildGroup, buildLitMarket, buildVenuesToday };
}
