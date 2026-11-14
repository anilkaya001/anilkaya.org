import { HttpError, internalKey, requireTicker, fixtureRefused } from "../http.js";
import { flowlabMode, analyticsOn, parseOsi, PRESET_IDS, GROUPS, NAME_VIEWS, CONTRACT_PARTS, NIGHTLY_KEYS } from "../../shared/flows-flowlab.js";
import { phaseAt, easternDay, easternInstant, PHASE_MINUTES } from "../../shared/flows-freshness.js";
import { isRealDate } from "../../shared/flows-premium.js";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const TTL = Object.freeze({ live: 60, rest: 300, settled: 21600, past: 86400, failLive: 60, failRest: 300, groupsLive: 300, venuesLive: 120 });

const HOUR_MS = 3600000;

const row = (name, handler) => ({ id: "flows.flowlab." + name, path: "/api/flows/flowlab/" + name, methods: ["GET"], auth: "flows", handler });

export function readClock(now) {
  const phase = phaseAt(now);
  if (!phase) return null;
  const live = phase.phase === "rth";
  const day = phase.phase === "post" || live ? phase.session : phase.lastClosed;
  const today = easternDay(now);
  const before = typeof day === "string" && day < today;
  const sameDay = day === phase.day && Number.isFinite(phase.close);
  const optionsFinal = before || (sameDay && now >= phase.close + HOUR_MS);
  const stockFinal = before || (sameDay && now >= easternInstant(day, PHASE_MINUTES.postEnd));
  return { day, today, live, closed: !live, phase: phase.phase, optionsFinal, stockFinal };
}

export const ttlFor = (clock, day, kind = "options") => {
  if (day < clock.day) return TTL.past;
  if (clock.live) return TTL.live;
  return (kind === "stock" ? clock.stockFinal : clock.optionsFinal) ? TTL.settled : TTL.rest;
};

export const failTtlFor = (clock) => (clock.live ? TTL.failLive : TTL.failRest);

export const nightlyTtlFor = (clock, k) => {
  if (clock.live) return k === "groups" ? TTL.groupsLive : TTL.venuesLive;
  return clock.optionsFinal ? TTL.settled : TTL.rest;
};

const expiryOf = (url) => {
  const raw = url.searchParams.get("exp");
  if (raw === null || !DAY.test(raw) || !isRealDate(raw)) throw HttpError.of("invalid_expiry");
  return raw;
};

const plain = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export function flowsFlowlabRows(deps) {
  const { vendorGate, serveCachedVendorRead, readServed, passthrough, isOwner, builders, now = () => Date.now(), flights = null } = deps;

  const gate = (env, session) => {
    if (flowlabMode(env, isOwner(env, session.username)) !== "on") throw HttpError.of("flowlab_off");
  };

  const serve = ({ env, ctx, url, session }, clock, key, ttl, build) => serveCachedVendorRead({
    env,
    ctx,
    cacheKey: internalKey("flowlab", key),
    wantsRefresh: url.searchParams.get("refresh") === "1",
    gate: vendorGate(env, session),
    ttlSeconds: ttl,
    ttlOf: (payload) => (payload && payload.partial === true ? failTtlFor(clock) : null),
    failKey: internalKey("flowlab-fail", key),
    failTtlSeconds: failTtlFor(clock),
    flights,
    build,
  });

  const clockOf = (env) => {
    const ms = now(env);
    const clock = readClock(ms);
    if (!clock) throw HttpError.of("internal_error");
    return { ms, clock };
  };

  const screen = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const preset = url.searchParams.get("preset");
    if (!PRESET_IDS.includes(preset)) throw HttpError.of("invalid_preset");
    const ticker = url.searchParams.has("t") ? requireTicker(url) : null;
    const { ms, clock } = clockOf(env);
    return serve(rc, clock, `screen/${preset}/${ticker || "*"}/${clock.day}`, ttlFor(clock, clock.day),
      (vf) => builders.buildScreen(vf, { preset, ticker, session: clock.day, now: ms, closed: clock.closed }));
  };

  const contract = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const c = url.searchParams.get("c");
    const osi = parseOsi(c);
    if (!osi || fixtureRefused(url, osi.root)) throw HttpError.of("invalid_contract");
    const part = url.searchParams.has("part") ? url.searchParams.get("part") : "core";
    if (!CONTRACT_PARTS.includes(part)) throw HttpError.of("invalid_contract");
    const { ms, clock } = clockOf(env);
    let day = clock.day;
    if (url.searchParams.has("d")) {
      const d = url.searchParams.get("d");
      if (!DAY.test(d) || !isRealDate(d) || d > clock.today) throw HttpError.of("invalid_contract");
      day = d;
    }
    const id = url.searchParams.get("id");
    if ((part === "alert" || part === "legs") && (typeof id !== "string" || !UUID.test(id))) throw HttpError.of("invalid_alert");
    const ttl = ttlFor(clock, day);
    const closed = clock.closed || day < clock.day;
    const key = `c/${c}/${day}/${part}${part === "alert" || part === "legs" ? "/" + id.toLowerCase() : ""}`;
    return serve(rc, clock, key, ttl, (vf) => {
      if (part === "core") return builders.buildContractCore(vf, { c, session: day, now: ms, closed });
      if (part === "alert") return builders.buildAlert(vf, { id, session: day, now: ms, closed });
      if (part === "legs") return builders.buildLegs(vf, { id, c, session: day, now: ms, closed });
      return builders.buildStructure(vf, { c, session: day, now: ms, closed });
    });
  };

  const name = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const t = requireTicker(url);
    const view = url.searchParams.get("view");
    if (!NAME_VIEWS.includes(view)) throw HttpError.of("invalid_view");
    const exp = view === "greek" ? expiryOf(url) : null;
    const { ms, clock } = clockOf(env);
    const key = `n/${t}/${view}${exp ? "/" + exp : ""}/${clock.day}`;
    const kind = view === "levels" || view === "lit" ? "stock" : "options";
    return serve(rc, clock, key, ttlFor(clock, clock.day, kind),
      (vf) => builders.buildNameView(vf, { t, view, exp, session: clock.day, now: ms, closed: clock.closed }));
  };

  const group = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const g = url.searchParams.get("g");
    if (!GROUPS.includes(g)) throw HttpError.of("invalid_group");
    const exp = expiryOf(url);
    const { ms, clock } = clockOf(env);
    return serve(rc, clock, `g/${g}/${exp}/${clock.day}`, ttlFor(clock, clock.day),
      (vf) => builders.buildGroup(vf, { g, exp, session: clock.day, now: ms, closed: clock.closed }));
  };

  const lit = async (rc) => {
    const { env, session } = rc;
    gate(env, session);
    const { ms, clock } = clockOf(env);
    return serve(rc, clock, `lit/${clock.day}`, ttlFor(clock, clock.day, "stock"),
      (vf) => builders.buildLitMarket(vf, { session: clock.day, now: ms, closed: clock.closed }));
  };

  const venues = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const t = requireTicker(url);
    const { ms, clock } = clockOf(env);
    return serve(rc, clock, `v/${t}/${clock.day}`, ttlFor(clock, clock.day),
      (vf) => builders.buildVenuesToday(vf, { t, session: clock.day, now: ms, closed: clock.closed }));
  };

  const nightly = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const k = url.searchParams.get("k");
    if (!NIGHTLY_KEYS.includes(k)) throw HttpError.of("invalid_view");
    if (k === "corr" && !analyticsOn(env)) return plain({ status: "off" });
    if (k !== "groups" && k !== "venues") {
      const stored = await readServed(env, "flowlab-" + k);
      if (stored === null) return plain({ status: "pending" });
      return passthrough(stored);
    }
    const { ms, clock } = clockOf(env);
    let held = null;
    if (clock.closed) {
      held = await readServed(env, "flowlab-" + k);
      if (held && held.fresh && held.fresh.session === clock.day) return passthrough(held);
    }
    const build = k === "groups"
      ? (vf) => builders.buildGroups(vf, { session: clock.day, now: ms, closed: clock.closed })
      : (vf) => builders.buildVenuesUniverse(vf, { session: clock.day, now: ms, closed: clock.closed });
    try {
      return await serve(rc, clock, `od/${k}/${clock.day}`, nightlyTtlFor(clock, k), build);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      const earlier = held || (await readServed(env, "flowlab-" + k).catch(() => null));
      if (!earlier) throw error;
      const out = passthrough(earlier);
      out.headers.set("X-Flowlab-Held", error.code);
      return out;
    }
  };

  return [row("screen", screen), row("contract", contract), row("name", name), row("group", group), row("lit", lit), row("venues", venues), row("nightly", nightly)];
}
