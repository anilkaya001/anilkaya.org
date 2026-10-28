import { HttpError, internalKey, requireTicker, fixtureRefused } from "../http.js";
import { flowlabMode, parseOsi, PRESET_IDS, GROUPS, NAME_VIEWS, CONTRACT_PARTS, NIGHTLY_KEYS } from "../../shared/flows-flowlab.js";
import { phaseAt, easternDay } from "../../shared/flows-freshness.js";
import { isRealDate } from "../../shared/flows-premium.js";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const TTL = Object.freeze({ live: 60, rest: 300, past: 86400 });

const row = (name, handler) => ({ id: "flows.flowlab." + name, path: "/api/flows/flowlab/" + name, methods: ["GET"], auth: "flows", handler });

export function readClock(now) {
  const phase = phaseAt(now);
  if (!phase) return null;
  const live = phase.phase === "rth";
  const day = phase.phase === "post" || live ? phase.session : phase.lastClosed;
  return { day, today: easternDay(now), live, closed: !live, phase: phase.phase };
}

export const ttlFor = (clock, day) => (day < clock.day ? TTL.past : clock.live ? TTL.live : TTL.rest);

const expiryOf = (url) => {
  const raw = url.searchParams.get("exp");
  if (raw === null || !DAY.test(raw) || !isRealDate(raw)) throw HttpError.of("invalid_expiry");
  return raw;
};

export function flowsFlowlabRows(deps) {
  const { vendorGate, serveCachedVendorRead, readServed, passthrough, isOwner, builders, now = () => Date.now() } = deps;

  const gate = (env, session) => {
    if (flowlabMode(env, isOwner(env, session.username)) !== "on") throw HttpError.of("flowlab_off");
  };

  const serve = ({ env, ctx, url, session }, key, ttl, build) => serveCachedVendorRead({
    env,
    ctx,
    cacheKey: internalKey("flowlab", key),
    wantsRefresh: url.searchParams.get("refresh") === "1",
    gate: vendorGate(env, session),
    ttlSeconds: ttl,
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
    return serve(rc, `screen/${preset}/${ticker || "*"}/${clock.day}`, ttlFor(clock, clock.day),
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
    return serve(rc, key, ttl, (vf) => {
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
    let spot = null;
    if (view === "strikes" || view === "levels") {
      const raw = url.searchParams.get("spot");
      if (raw !== null) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0 || n >= 1e6) throw HttpError.of("invalid_view");
        spot = Math.round(n);
      }
    }
    const { ms, clock } = clockOf(env);
    const key = `n/${t}/${view}${exp ? "/" + exp : ""}${spot ? "/s" + spot : ""}/${clock.day}`;
    return serve(rc, key, ttlFor(clock, clock.day),
      (vf) => builders.buildNameView(vf, { t, view, exp, spot, session: clock.day, now: ms, closed: clock.closed }));
  };

  const group = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const g = url.searchParams.get("g");
    if (!GROUPS.includes(g)) throw HttpError.of("invalid_group");
    const exp = expiryOf(url);
    const { ms, clock } = clockOf(env);
    return serve(rc, `g/${g}/${exp}/${clock.day}`, ttlFor(clock, clock.day),
      (vf) => builders.buildGroup(vf, { g, exp, session: clock.day, now: ms, closed: clock.closed }));
  };

  const lit = async (rc) => {
    const { env, session } = rc;
    gate(env, session);
    const { ms, clock } = clockOf(env);
    return serve(rc, `lit/${clock.day}`, ttlFor(clock, clock.day),
      (vf) => builders.buildLitMarket(vf, { session: clock.day, now: ms, closed: clock.closed }));
  };

  const venues = async (rc) => {
    const { env, url, session } = rc;
    gate(env, session);
    const t = requireTicker(url);
    const { ms, clock } = clockOf(env);
    return serve(rc, `v/${t}/${clock.day}`, ttlFor(clock, clock.day),
      (vf) => builders.buildVenuesToday(vf, { t, session: clock.day, now: ms, closed: clock.closed }));
  };

  const nightly = async ({ env, url, session }) => {
    gate(env, session);
    const k = url.searchParams.get("k");
    if (!NIGHTLY_KEYS.includes(k)) throw HttpError.of("invalid_view");
    const stored = await readServed(env, "flowlab-" + k);
    if (stored === null) return new Response(JSON.stringify({ status: "pending" }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
    return passthrough(stored);
  };

  return [row("screen", screen), row("contract", contract), row("name", name), row("group", group), row("lit", lit), row("venues", venues), row("nightly", nightly)];
}
