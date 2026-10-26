import { HttpError, json, readJSON, requireSameOrigin, requireTicker, fixtureRefused } from "../http.js";
import { logFailure } from "../log.js";
import { memberAllowed, memberId } from "../../shared/flows-access.js";
import { HOUSE_STREAM, LIMITS, base32Lower } from "../../shared/ff-contract.js";
import { phaseAt } from "../../shared/flows-freshness.js";
import {
  FF_STORE_LIMITS, MEMBER_ID_RE, decodeCursor, encodeCursor, mergeStreams, namesOf, validateCompiled,
} from "../ff-store.js";
import {
  API_VERSION, absent, hitDetailView, hitRowView, houseView, limitsFrom, limitsView, receiptView, recordView, symbolView, versionView, wireView,
} from "../ff-records.js";
import { ROUTE_FLAGS, dueNightly, etagOf, flagOn, modeOf, readHealth, switchState, unreadView } from "../ff-health.js";
import { previewView } from "../ff-preview.js";
import { DIGEST, buildDigest, digestSession } from "../ff-digest.js";
import { EXPORT, buildExport, exportRange } from "../ff-export.js";

export const WIRE_ID_RE = /^w-[a-z2-7]{16}$/;
export const HOUSE_ID_RE = /^h-t\d\d[a-z]?$/;
export const HIT_ID_RE = /^[a-z2-7]{20}$/;
export const KEY_RE = /^[\x21-\x7e]{1,128}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const WEEK_RE = /^\d{4}-W\d{2}$/;
export const RETRY_AFTER_S = 60;
export const SWITCH_TTL_MS = 30000;
export const HITS_PAGE = Object.freeze({ default: 12, max: 30 });
export const COMPILE_CODES = Object.freeze(["ff_grammar_invalid", "ff_grammar_precision", "ff_metric_unavailable", "ff_symbol_outside_universe", "ff_scope_reserved"]);
export const LIMITER_BINDINGS = Object.freeze({ write: "FF_WRITE", heavy: "FF_HEAVY", health: "FF_HEALTH" });

const E = (code, message, details, headers) => HttpError.of(code, message, headers, details);

const textOk = (value, max) => typeof value === "string" && [...value.trim()].length >= 1 && [...value.trim()].length <= max;

const only = (body, allowed) => {
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) throw E("ff_grammar_invalid", "The request carries a field this route does not take: " + k.slice(0, 40), { field: k.slice(0, 40) });
  }
};

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const wireRef = (value) => typeof value === "string" && (WIRE_ID_RE.test(value) || HOUSE_ID_RE.test(value));

export async function derivedWireId(member, key) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([member, key]))));
  return "w-" + base32Lower(digest).slice(0, 16);
}

export function flowsFfRows(deps) {
  const { store, flowsStore, core, readClock, readLiveRows = null, cache = null, runAuth = null, evaluate = null, firstCheck = null, now = Date.now } = deps;

  const reply = (body, status = 200, headers) => json({ v: API_VERSION, serverNow: now(), ...body }, status, headers);

  const clockOf = async (env) => (await Promise.resolve(readClock ? readClock(env.DB) : null).catch(() => null)) || null;

  const globalSwitches = async (env, at) => {
    const hit = cache && cache.get("ff-switches");
    if (hit && at - hit.at < SWITCH_TTL_MS) return hit.value;
    const value = await store.switches(env);
    if (cache && !value.unreadable) cache.set("ff-switches", { at, value });
    return value;
  };

  const throttle = async (ctx, binding) => {
    if (!(await memberAllowed(ctx.env[binding], ctx.session))) throw HttpError.of("rate_limited", undefined, { "Retry-After": String(RETRY_AFTER_S) });
  };

  const enter = async (ctx, spec) => {
    const { request, env, session } = ctx;
    const member = memberId(session);
    if (member === null || !MEMBER_ID_RE.test(member) || member === HOUSE_STREAM) throw HttpError.of("forbidden");
    const mode = modeOf(env);
    if (mode === "off") throw E("ff_off", "Fire & Forget is off: the master switch is not on", { reason: "mode_off" });
    for (const name of spec.flags) {
      if (!flagOn(env, ROUTE_FLAGS[name])) throw E("ff_off", "Fire & Forget is off: this part is switched off", { reason: "route_off", route: name });
    }
    if (spec.mutate) requireSameOrigin(request);
    if (spec.limiter) await throttle(ctx, spec.limiter);
    if (!env.DB) throw HttpError.of("store_unreadable");
    const at = now();
    if (spec.channel) {
      const switches = await globalSwitches(env, at);
      if (switchState(switches.rows, "channel", spec.channel) === "off") throw E("ff_off", "Fire & Forget is off: this channel is switched off", { reason: "channel_off", channel: spec.channel });
    }
    return { member, mode, at };
  };

  const requireArming = async (ctx, member) => {
    for (const name of ["wires", "fire"]) {
      if (!flagOn(ctx.env, ROUTE_FLAGS[name])) throw E("ff_off", "Fire & Forget is off: this part is switched off", { reason: "route_off", route: name });
    }
    const [switches, mine] = await Promise.all([globalSwitches(ctx.env, now()), store.memberSwitch(ctx.env, member)]);
    if (switches.unreadable) throw E("ff_off", "Fire & Forget is off for new wires: the switches could not be read", { reason: "switches_unreadable" });
    if (mine.unreadable) throw E("ff_off", "Fire & Forget is off for new wires: the switches could not be read", { reason: "switches_unreadable" });
    if (mine.state === "off") throw E("ff_off", "Fire & Forget is off for your account", { reason: "member_off" });
  };

  const payloadReads = new WeakMap();

  const loadPayloads = (ctx, extra = []) => {
    let pending = payloadReads.get(ctx);
    if (!pending) {
      pending = flowsStore.readMany(ctx.env, ["universe", ...extra]);
      payloadReads.set(ctx, pending);
    }
    return pending;
  };

  const warm = (ctx, extra = []) => {
    loadPayloads(ctx, extra).catch(() => {});
  };

  const universeOf = async (ctx) => {
    const rows = await loadPayloads(ctx);
    const row = rows && rows.get("universe");
    const payload = row && typeof row.payload === "string" ? parseJson(row.payload) : null;
    if (!payload || !Array.isArray(payload.t) || !payload.t.every((t) => typeof t === "string")) throw HttpError.of("store_unreadable");
    return { symbols: new Set(payload.t), sectors: new Set(Array.isArray(payload.sectors) ? payload.sectors.filter((s) => typeof s === "string") : []) };
  };

  const compileBody = async (ctx, ast, templateHint, at) => {
    if (ast === null || typeof ast !== "object" || Array.isArray(ast)) throw E("ff_grammar_invalid", "The wire is missing its definition");
    const scope = ast.scope;
    if (scope && scope.kind === "names" && Array.isArray(scope.symbols)) {
      for (const s of scope.symbols) if (typeof s === "string" && fixtureRefused(ctx.url, s)) throw HttpError.of("invalid_ticker");
    }
    const universe = await universeOf(ctx);
    const compiled = await core.compile({ body: ast, templateHint, universe, now: at });
    if (!compiled || compiled.ok !== true) {
      const code = compiled ? compiled.code : null;
      if (!COMPILE_CODES.includes(code)) {
        logFailure("error", "ff compile refused with an unknown code", { route: "/api/ff/wires", code: String(code).slice(0, 40) });
        throw HttpError.of("internal_error");
      }
      throw E(code, undefined, compiled.detail === undefined ? undefined : { detail: String(compiled.detail).slice(0, 80) });
    }
    const problems = validateCompiled(compiled);
    if (problems.length) {
      logFailure("error", "ff compile returned a record the store refuses", { route: "/api/ff/wires", problems: problems.join(",") });
      throw HttpError.of("internal_error");
    }
    return compiled;
  };

  const runIdOf = (at) => {
    const due = dueNightly(at, null);
    return due ? "nightly:" + due : "none";
  };

  const capacityError = (cap, version) => {
    const used = { armed: Number(cap.armed), universe: Number(cap.universe), live: Number(cap.live), budget: Number(cap.milli) / 1000 };
    if (Number(cap.evaluated) >= FF_STORE_LIMITS.softWireCap) {
      return E("ff_wire_limit", "The evaluator is at capacity; try again after the next nightly run", { limit: "capacity", max: FF_STORE_LIMITS.softWireCap });
    }
    if (used.armed >= LIMITS.armedMemberWires) return E("ff_wire_limit", undefined, { limit: "armed", used: used.armed, max: LIMITS.armedMemberWires });
    if (version.scope_kind === "universe" && used.universe >= LIMITS.universeMemberWires) {
      return E("ff_wire_limit", "You already have " + LIMITS.universeMemberWires + " universe-wide wires; narrow this one or retire another", { limit: "universe", used: used.universe, max: LIMITS.universeMemberWires });
    }
    if (version.cadence === "live" && used.live >= LIMITS.liveMemberWires) {
      return E("ff_wire_limit", "You already have " + LIMITS.liveMemberWires + " live wires; retire one first", { limit: "live", used: used.live, max: LIMITS.liveMemberWires });
    }
    if (version.control === "bh") {
      return E("ff_budget_exceeded", undefined, { used: used.budget, adding: version.exp_week, max: Number(cap.budget_b), choices: LIMITS.budgetChoices });
    }
    return E("ff_wire_limit", undefined, { limit: "unknown" });
  };

  const limitsAfter = async (env, member, at, known) => {
    const cap = known || (await store.capacity(env, member, { runId: runIdOf(at) }));
    if (!cap) throw HttpError.of("store_unreadable");
    return limitsView(cap, Number(cap.budget_b));
  };

  const wireReply = async (ctx, member, at, row, replayed, status = 200, cap = null) =>
    reply({ wire: wireView(row, { now: at, detail: true }), replayed, limits: await limitsAfter(ctx.env, member, at, cap) }, status);

  const noteView = (row) => (row ? { body: row.body, updatedAt: row.updated_at, label: "Your note" } : absent("no_record", "no note"));

  const health = async (ctx) => {
    const { member, at } = await enter(ctx, { flags: [], limiter: LIMITER_BINDINGS.health, mutate: false });
    const result = await readHealth({ env: ctx.env, store, readClock, cache, now: at, member });
    if (!result) throw HttpError.of("store_unreadable");
    const etag = etagOf(result.view);
    const headers = { ETag: etag, Vary: "Cookie" };
    const offered = ctx.request.headers.get("If-None-Match");
    const same = (t) => t.trim().replace(/^W\//, "") === etag.replace(/^W\//, "");
    if (offered !== null && offered.split(",").some(same)) return new Response(null, { status: 304, headers });
    return json(result.view, 200, headers);
  };

  const wiresGet = async (ctx) => {
    const { member, at } = await enter(ctx, { flags: ["wires"], limiter: null, mutate: false });
    const asked = ctx.url.searchParams.get("id");
    if (asked !== null) {
      if (!WIRE_ID_RE.test(asked)) throw HttpError.of("ff_wire_not_found");
      const found = await store.getWire(ctx.env, member, asked);
      if (!found) throw HttpError.of("ff_wire_not_found");
      return reply({ wire: wireView(found.wire, { now: at, detail: true }), versions: found.versions.map((v) => versionView(v, at)), note: noteView(found.note) });
    }
    const raw = ctx.url.searchParams.get("status");
    const status = raw === null || raw === "" || raw === "live" ? "live" : ["armed", "paused", "retired"].includes(raw) ? raw : null;
    if (status === null) throw E("ff_grammar_invalid", "status must be live, armed, paused or retired");
    const listed = await store.listWires(ctx.env, member, { status, limit: FF_STORE_LIMITS.listMax });
    if (!listed) throw HttpError.of("store_unreadable");
    const budgetB = listed.member ? listed.member.budget_b : LIMITS.budgetDefault;
    return reply({ status, wires: listed.rows.map((r) => wireView(r, { now: at })), limits: status === "retired" ? null : limitsFrom(listed.rows, budgetB) });
  };

  const create = async (ctx, member, at) => {
    const { request, env } = ctx;
    const body = await readJSON(request);
    only(body, ["ast", "template", "title", "origin"]);
    const key = request.headers.get("Idempotency-Key");
    if (key !== null && !KEY_RE.test(key)) throw E("ff_grammar_invalid", "Idempotency-Key must be 1 to 128 printable characters");
    if (body.title !== undefined && !textOk(body.title, 80)) throw E("ff_grammar_invalid", "The title must be 1 to 80 characters");
    if (body.template !== undefined && typeof body.template !== "string") throw E("ff_grammar_invalid", "The template must be a template id");
    const compiled = await compileBody(ctx, body.ast, body.template || null, at);
    let origin = null;
    if (body.origin !== undefined) {
      if (typeof body.origin !== "string" || !HOUSE_ID_RE.test(body.origin)) throw E("ff_grammar_invalid", "origin must be a house wire id");
      const house = await store.houseGet(env, member, body.origin);
      if (!house) throw HttpError.of("ff_wire_not_found");
      origin = body.origin + "@" + house.current_version;
      if (!house.off && house.ast_hash === compiled.version.ast_hash) throw HttpError.of("ff_house_duplicate");
    }
    const title = body.title !== undefined ? body.title.trim() : [...compiled.version.sentence].slice(0, 80).join("");
    const effectiveSession = core.effectiveSession(at);
    const runId = runIdOf(at);
    let id = key !== null ? await derivedWireId(member, key) : core.newWireId();
    for (let attempt = 0; attempt < 2; attempt++) {
      const made = await store.createWire(env, member, { id, title, version: compiled.version, symbols: compiled.symbols, effectiveSession, origin, runId }, at);
      if (!made) throw HttpError.of("store_unreadable");
      if (made.created) return wireReply(ctx, member, at, made.row, false, 201, made.cap);
      if (made.row) {
        if (made.first && made.first.ast_hash === compiled.version.ast_hash) return wireReply(ctx, member, at, made.row, true, 200, made.cap);
        throw E("attempt_conflict", "This idempotency key was already used for a different wire");
      }
      const refused = capacityError(made.cap || (await store.capacity(env, member, { runId })), compiled.version);
      if (refused.details && refused.details.limit === "unknown" && key === null && attempt === 0) {
        id = core.newWireId();
        continue;
      }
      throw refused;
    }
    throw HttpError.of("internal_error");
  };

  const move = async (ctx, member, at, body) => {
    const { env } = ctx;
    const id = typeof body.id === "string" && HOUSE_ID_RE.test(body.id) ? null : body.id;
    if (id === null) throw HttpError.of("ff_house_readonly");
    if (typeof id !== "string" || !WIRE_ID_RE.test(id)) throw HttpError.of("ff_wire_not_found");
    const to = body.status;
    if (!["retired", "paused", "armed"].includes(to)) throw E("ff_grammar_invalid", "status must be armed, paused or retired");
    const found = await store.getWire(env, member, id);
    if (!found) throw HttpError.of("ff_wire_not_found");
    const row = found.wire;
    if (row.status === to) return wireReply(ctx, member, at, row, true);
    if (to === "paused" && row.status === "retired") throw E("ff_grammar_invalid", "A retired wire must be restored before it can be paused");
    if (to === "retired" || to === "paused") {
      const done = await store.setStatus(env, member, { id, to, runId: runIdOf(at) }, at);
      if (!done) throw HttpError.of("store_unreadable");
      return wireReply(ctx, member, at, done.row, false, 200, done.cap);
    }
    await requireArming(ctx, member);
    const runId = runIdOf(at);
    const done = await store.setStatus(env, member, { id, to: "armed", from: row.status, expect: row.current_version, version: row, runId }, at);
    if (!done) throw HttpError.of("store_unreadable");
    if (!done.changed) {
      if (done.row && done.row.status === "armed") return wireReply(ctx, member, at, done.row, true, 200, done.cap);
      throw capacityError(done.cap || (await store.capacity(env, member, { runId })), row);
    }
    return wireReply(ctx, member, at, done.row, false, 200, done.cap);
  };

  const adjust = async (ctx, member, at, body) => {
    const { env } = ctx;
    if (typeof body.id === "string" && HOUSE_ID_RE.test(body.id)) throw HttpError.of("ff_house_readonly");
    if (typeof body.id !== "string" || !WIRE_ID_RE.test(body.id)) throw HttpError.of("ff_wire_not_found");
    const id = body.id;
    if (body.version !== undefined && (!Number.isInteger(body.version) || body.version < 1)) throw E("ff_grammar_invalid", "version must be a version number", { field: "version" });
    if (body.title !== undefined && !textOk(body.title, 80)) throw E("ff_grammar_invalid", "The title must be 1 to 80 characters");
    if (body.ast !== undefined) warm(ctx);
    const found = await store.getWire(env, member, id);
    if (!found) throw HttpError.of("ff_wire_not_found");
    const row = found.wire;
    const titleOnly = async () => {
      const kept = body.title === undefined ? { row } : await store.retitleWire(env, member, id, body.title.trim());
      return wireReply(ctx, member, at, kept.row, true);
    };
    if (body.ast === undefined) return titleOnly();
    if (row.status === "retired") throw E("ff_grammar_invalid", "A retired wire must be restored before it can be adjusted");
    if (body.ast !== null && typeof body.ast === "object" && body.ast.cadence !== undefined && body.ast.cadence !== row.cadence) {
      throw E("ff_grammar_invalid", "A wire cannot change its cadence; arm a new wire instead", { field: "cadence" });
    }
    await requireArming(ctx, member);
    const compiled = await compileBody(ctx, body.ast, body.template || row.template, at);
    const v = compiled.version;
    if (v.ast_hash === row.ast_hash) return titleOnly();
    if (body.version === undefined) throw E("ff_grammar_invalid", "The version you are adjusting from is required", { field: "version", current: row.current_version });
    if (body.version !== row.current_version) throw E("ff_version_immutable", "This wire changed since you opened it; reload it and adjust again", { current: row.current_version });
    const before = namesOf(row.ast_json);
    const after = compiled.symbols;
    const effectiveSession = core.effectiveSession(at);
    const done = await store.adjustWire(env, member, {
      id, expect: row.current_version, title: body.title === undefined ? row.title : body.title.trim(), version: v, effectiveSession,
      drop: before.filter((n) => !after.includes(n)), add: after.filter((n) => !before.includes(n)), clauseChanged: v.clause_hash !== row.clause_hash, runId: runIdOf(at),
    }, at);
    if (!done) throw HttpError.of("store_unreadable");
    if (done.advanced) return wireReply(ctx, member, at, done.row, false, 200, done.cap);
    const again = await store.getWire(env, member, id);
    if (again && again.wire.current_version !== row.current_version) throw E("ff_version_immutable", "This wire changed since you opened it; reload it and adjust again", { current: again.wire.current_version });
    const sameSession = (again || found).versions.filter((x) => x.effective_session === effectiveSession).length;
    if (sameSession >= LIMITS.versionsPerWirePerSession) {
      throw E("rate_limited", "This wire has been adjusted " + LIMITS.versionsPerWirePerSession + " times for this session; try again next session", { limit: "versions", max: LIMITS.versionsPerWirePerSession }, { "Retry-After": String(RETRY_AFTER_S * 60) });
    }
    throw capacityError(await store.capacity(env, member, { runId: runIdOf(at), skip: id }), v);
  };

  const wiresWrite = async (ctx) => {
    if (ctx.request.method === "POST") {
      const gate = await enter(ctx, { flags: ["wires", "fire"], limiter: LIMITER_BINDINGS.write, mutate: true });
      warm(ctx);
      await requireArming(ctx, gate.member);
      return create(ctx, gate.member, gate.at);
    }
    const gate = await enter(ctx, { flags: [], limiter: LIMITER_BINDINGS.write, mutate: true });
    const body = await readJSON(ctx.request);
    only(body, ["id", "version", "status", "title", "ast", "template"]);
    if (body.status !== undefined && (body.ast !== undefined || body.title !== undefined)) throw E("ff_grammar_invalid", "Change the status or the wire, not both at once");
    return body.status !== undefined ? move(ctx, gate.member, gate.at, body) : adjust(ctx, gate.member, gate.at, body);
  };

  const houseGet = async (ctx) => {
    const { member, at } = await enter(ctx, { flags: ["wires"], limiter: null, mutate: false });
    const asked = ctx.url.searchParams.get("id");
    if (asked !== null) {
      if (!HOUSE_ID_RE.test(asked)) throw HttpError.of("ff_wire_not_found");
      const row = await store.houseGet(ctx.env, member, asked);
      if (!row) throw HttpError.of("ff_wire_not_found");
      const records = await store.records(ctx.env, member, { wireId: asked, version: row.current_version, week: "none" });
      const note = await store.note(ctx.env, member, asked);
      return reply({ wire: houseView(row, (records || []).find((r) => r.period === "all") || null, at), note: noteView(note) });
    }
    const read = await store.houseRead(ctx.env, member);
    if (!read) throw HttpError.of("store_unreadable");
    const records = new Map(read.records.map((r) => [r.wire_id, r]));
    return reply({ wires: read.rows.map((r) => houseView(r, records.get(r.id) || null, at)) });
  };

  const housePost = async (ctx) => {
    const first = await enter(ctx, { flags: [], limiter: LIMITER_BINDINGS.write, mutate: true });
    const body = await readJSON(ctx.request);
    only(body, ["id", "follow"]);
    if (typeof body.follow !== "boolean") throw E("ff_grammar_invalid", "follow must be true or false");
    if (typeof body.id !== "string" || !HOUSE_ID_RE.test(body.id)) throw HttpError.of("ff_wire_not_found");
    if (body.follow) await requireArming(ctx, first.member);
    const done = await store.houseSet(ctx.env, first.member, body.id, body.follow, first.at);
    if (!done) throw HttpError.of("store_unreadable");
    if (!done.row) throw HttpError.of("ff_wire_not_found");
    return reply({ wire: houseView(done.row, null, first.at), changed: done.changed });
  };

  const hitsGet = async (ctx) => {
    const { member, at, mode } = await enter(ctx, { flags: ["inbox"], limiter: null, mutate: false, channel: "inbox" });
    const asked = ctx.url.searchParams.get("id");
    if (asked !== null) {
      if (!HIT_ID_RE.test(asked) || mode === "shadow") throw HttpError.of("ff_hit_not_found");
      const row = await store.hitGet(ctx.env, member, asked);
      if (!row) throw HttpError.of("ff_hit_not_found");
      const mine = await store.member(ctx.env, member, at);
      return reply({ hit: hitDetailView(row, { memberId: member, readSeq: mine ? mine.read_seq : 0, houseReadSeq: mine ? mine.house_read_seq : 0, now: at }) });
    }
    const rawState = ctx.url.searchParams.get("state");
    const state = rawState === null || rawState === "" ? "all" : rawState;
    if (!["all", "unread", "pinned", "archived"].includes(state)) throw E("ff_cursor_invalid", "state must be all, unread, pinned or archived");
    const cursor = decodeCursor(ctx.url.searchParams.get("cursor"));
    if (cursor === null) throw HttpError.of("ff_cursor_invalid");
    const rawLimit = ctx.url.searchParams.get("limit");
    const wanted = rawLimit === null ? HITS_PAGE.default : Number(rawLimit);
    if (!Number.isInteger(wanted) || wanted < 1) throw E("ff_cursor_invalid", "limit must be a whole number from 1 to " + HITS_PAGE.max);
    const limit = Math.min(wanted, HITS_PAGE.max);
    if (!cursor.first || state === "pinned" || state === "archived") await throttle(ctx, LIMITER_BINDINGS.heavy);
    if (mode === "shadow") return reply({ state, hits: [], next: null, more: false, heads: cursor.first ? { h: 0, m: 0 } : null, shadow: true });
    const page = await store.hitsPage(ctx.env, member, { state, cursor, limit, now: at });
    if (!page) throw HttpError.of("store_unreadable");
    const readSeq = page.cursors ? page.cursors.read_seq : 0;
    const houseReadSeq = page.cursors ? page.cursors.house_read_seq : 0;
    const view = (row) => hitRowView(row, { memberId: member, readSeq, houseReadSeq, now: at });
    const heads = cursor.first ? { h: page.heads.h, m: page.heads.m } : null;
    if (page.marked) return reply({ state, hits: page.marked.map(view), next: null, more: false, heads });
    const merged = mergeStreams(page.member, page.house, limit);
    const advance = async (house, rows, taken, before, after) => {
      if (taken < rows.length) return { cursor: taken > 0 ? rows[taken - 1].seq : before, more: true };
      if (rows.length === limit) return { cursor: rows[rows.length - 1].seq, more: true };
      if ((house ? page.heads.h : page.heads.m) === 0 || before <= 1) return { cursor: before, more: false };
      const floor = await store.streamFloor(ctx.env, member, { house, unread: state === "unread", before, after, scan: page.scan });
      if (floor && floor.n >= page.scan && floor.floor !== null) return { cursor: floor.floor, more: true };
      return { cursor: before, more: false };
    };
    const [m, h] = await Promise.all([
      advance(false, page.member, merged.taken.member, cursor.m, readSeq),
      advance(true, page.house, merged.taken.house, cursor.h, houseReadSeq),
    ]);
    const more = m.more || h.more;
    return reply({ state, hits: merged.rows.map(view), next: more ? encodeCursor({ h: h.cursor, m: m.cursor }) : null, more, heads });
  };

  const hitsWrite = async (ctx) => {
    const { member, at, mode } = await enter(ctx, { flags: ["inbox"], limiter: LIMITER_BINDINGS.write, mutate: true, channel: "inbox" });
    const body = await readJSON(ctx.request);
    only(body, ["id", "mark", "feedback"]);
    if (typeof body.id !== "string" || !HIT_ID_RE.test(body.id)) throw HttpError.of("ff_hit_not_found");
    const change = {};
    if (body.mark !== undefined) {
      if (body.mark !== null && !["pinned", "dismissed"].includes(body.mark)) throw E("ff_grammar_invalid", "mark must be pinned, dismissed or null");
      change.mark = body.mark;
    }
    if (body.feedback !== undefined) {
      if (body.feedback !== null && !["useful", "noise"].includes(body.feedback)) throw E("ff_grammar_invalid", "feedback must be useful, noise or null");
      change.feedback = body.feedback;
    }
    if (Object.keys(change).length === 0) throw E("ff_grammar_invalid", "Send a mark, a feedback or both");
    if (mode === "shadow") throw HttpError.of("ff_hit_not_found");
    const done = await store.hitMark(ctx.env, member, body.id, change, at);
    if (!done) throw HttpError.of("ff_hit_not_found");
    return reply({ id: body.id, mark: done.mark || null, feedback: done.feedback || null });
  };

  const readWrite = async (ctx) => {
    const { member, at, mode } = await enter(ctx, { flags: ["inbox"], limiter: LIMITER_BINDINGS.write, mutate: true, channel: "inbox" });
    const body = await readJSON(ctx.request);
    only(body, ["all", "readSeq", "houseReadSeq"]);
    const whole = (v) => v === undefined || (Number.isSafeInteger(v) && v >= 0);
    if (!whole(body.readSeq) || !whole(body.houseReadSeq) || (body.all !== undefined && typeof body.all !== "boolean")) throw HttpError.of("ff_cursor_invalid");
    if (body.all !== true && body.readSeq === undefined && body.houseReadSeq === undefined) throw HttpError.of("ff_cursor_invalid");
    if (mode === "shadow") return reply({ cursors: { readSeq: 0, houseReadSeq: 0 }, unread: unreadView({ memberMax: 0, houseMax: 0, member: null, shadow: true }) });
    const done = await store.readCursors(ctx.env, member, {
      readSeq: body.all === true ? Number.MAX_SAFE_INTEGER : body.readSeq === undefined ? 0 : body.readSeq,
      houseReadSeq: body.all === true ? Number.MAX_SAFE_INTEGER : body.houseReadSeq === undefined ? 0 : body.houseReadSeq,
      now: at,
    });
    if (!done) throw HttpError.of("store_unreadable");
    return reply({
      cursors: { readSeq: done.member.read_seq, houseReadSeq: done.member.house_read_seq },
      unread: unreadView({ memberMax: done.max.member, houseMax: done.max.house, member: done.member, shadow: false }),
    });
  };

  const preview = async (ctx) => {
    const { at } = await enter(ctx, { flags: ["fire"], limiter: LIMITER_BINDINGS.heavy, mutate: true });
    warm(ctx, ["ff-metrics"]);
    const body = await readJSON(ctx.request);
    only(body, ["ast", "template"]);
    const compiled = await compileBody(ctx, body.ast, body.template || null, at);
    const rows = await loadPayloads(ctx, ["ff-metrics"]);
    const row = rows && rows.get("ff-metrics");
    const metrics = row && typeof row.payload === "string" ? parseJson(row.payload) : null;
    let live = null;
    if (compiled.version.cadence === "live" && readLiveRows) {
      const got = await readLiveRows(ctx.env.DB, ["live:alerts", "live:strips"], at).catch(() => null);
      live = got ? got.rows : null;
    }
    const universe = await universeOf(ctx);
    const clockRow = await clockOf(ctx.env);
    const effectiveSession = core.effectiveSession(at);
    const result = metrics === null || !Array.isArray(metrics.t)
      ? { status: "unavailable", reason: "missing", subjects: [] }
      : await core.preview({ compiled, snapshot: { metrics, live }, universe, now: at });
    const firstCheckAt = firstCheck ? firstCheck({ cadence: compiled.version.cadence, now: at, effectiveSession, clockRow }) : null;
    return reply({ preview: previewView({ compiled, result, now: at, effectiveSession, clockRow, firstCheckAt }) });
  };

  const visibleWire = async (env, member, wire) => (HOUSE_ID_RE.test(wire) ? Boolean(await store.houseGet(env, member, wire)) : Boolean(await store.getWire(env, member, wire)));

  const receipts = async (ctx) => {
    const { member, at } = await enter(ctx, { flags: ["wires"], limiter: LIMITER_BINDINGS.heavy, mutate: false });
    const wire = ctx.url.searchParams.get("wire");
    if (!wireRef(wire)) throw HttpError.of("ff_wire_not_found");
    const session = ctx.url.searchParams.get("session");
    if (session !== null && !DAY_RE.test(session)) throw E("ff_cursor_invalid", "session must be YYYY-MM-DD");
    const asked = Number(ctx.url.searchParams.get("limit") || 30);
    const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, 60) : 30;
    const rows = await store.receipts(ctx.env, member, { wireId: wire, session, limit });
    if (!rows) throw HttpError.of("store_unreadable");
    if (rows.length === 0 && !(await visibleWire(ctx.env, member, wire))) throw HttpError.of("ff_wire_not_found");
    return reply({ wire, receipts: rows.map((r) => receiptView(r, at)) });
  };

  const records = async (ctx) => {
    const { member, at } = await enter(ctx, { flags: ["wires"], limiter: LIMITER_BINDINGS.heavy, mutate: false });
    const wire = ctx.url.searchParams.get("wire");
    if (!wireRef(wire)) throw HttpError.of("ff_wire_not_found");
    const week = ctx.url.searchParams.get("week");
    if (week !== null && !WEEK_RE.test(week)) throw E("ff_cursor_invalid", "week must be YYYY-Www");
    let version = Number(ctx.url.searchParams.get("version"));
    if (!Number.isInteger(version) || version < 1) {
      const found = HOUSE_ID_RE.test(wire) ? await store.houseGet(ctx.env, member, wire) : ((await store.getWire(ctx.env, member, wire)) || {}).wire;
      if (!found) throw HttpError.of("ff_wire_not_found");
      version = found.current_version;
    }
    const rows = await store.records(ctx.env, member, { wireId: wire, version, week: week || "none" });
    if (!rows) throw HttpError.of("store_unreadable");
    if (rows.length === 0 && !(await visibleWire(ctx.env, member, wire))) throw HttpError.of("ff_wire_not_found");
    return reply({ wire, version, all: recordView(rows.find((r) => r.period === "all") || null, at), week: week ? recordView(rows.find((r) => r.period === week) || null, at) : null });
  };

  const symbol = async (ctx) => {
    const { member, at } = await enter(ctx, { flags: ["wires", "inbox"], limiter: LIMITER_BINDINGS.heavy, mutate: false });
    const ticker = requireTicker(ctx.url, "t");
    const found = await store.symbolWires(ctx.env, member, ticker, { limit: 3 });
    if (!found) throw HttpError.of("store_unreadable");
    const ph = phaseAt(at, null);
    return reply({ panel: symbolView(found, ticker, at, ph ? ph.session || ph.lastClosed : null) });
  };

  const digest = async (ctx) => {
    const { member, at } = await enter(ctx, { flags: ["inbox"], limiter: LIMITER_BINDINGS.heavy, mutate: false, channel: "inbox" });
    const clockRow = await clockOf(ctx.env);
    const picked = digestSession({ asked: ctx.url.searchParams.get("d"), now: at, clockRow });
    if (!picked.ok) {
      if (picked.code === "malformed") throw E("ff_cursor_invalid", "d must be a session date, YYYY-MM-DD");
      if (picked.code === "window") throw E("ff_export_range", "That session is outside the digest window of " + DIGEST.windowSessions + " sessions", { latest: picked.latest });
      throw HttpError.of("store_unreadable");
    }
    const read = await store.digestRead(ctx.env, member, {
      session: picked.session, memberRows: DIGEST.memberRows, houseRows: DIGEST.houseRows, memberScan: DIGEST.memberScan, houseScan: DIGEST.houseScan,
    });
    if (!read) throw HttpError.of("store_unreadable");
    return reply({ digest: buildDigest({ member, session: picked.session, now: at, read, clockRow }), latest: picked.latest });
  };

  const exportCsv = async (ctx) => {
    const { member } = await enter(ctx, { flags: ["export"], limiter: LIMITER_BINDINGS.heavy, mutate: false, channel: "export" });
    const range = exportRange(ctx.url.searchParams.get("from"), ctx.url.searchParams.get("to"));
    if (!range.ok) throw E("ff_export_range", range.code === "range" ? "Choose a range of " + EXPORT.maxDays + " days or fewer" : "from and to must be session dates, YYYY-MM-DD");
    const read = await store.exportRead(ctx.env, member, { limit: EXPORT.rowsPerStream });
    if (!read) throw HttpError.of("store_unreadable");
    const built = buildExport({ range, read });
    return new Response(built.body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="fire-and-forget-hits-' + range.from + "_" + range.to + '.csv"',
        "X-FF-Rows": String(built.rows),
        "X-FF-Complete": built.complete ? "1" : "0",
      },
    });
  };

  const mute = async (ctx) => {
    const gate = await enter(ctx, { flags: [], limiter: LIMITER_BINDINGS.write, mutate: true });
    const body = await readJSON(ctx.request);
    only(body, ["symbol", "mute"]);
    if (typeof body.mute !== "boolean") throw E("ff_grammar_invalid", "mute must be true or false");
    const probe = new URL(ctx.url);
    probe.searchParams.set("t", typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "");
    const name = requireTicker(probe, "t");
    const done = await store.mute(ctx.env, gate.member, name, body.mute, gate.at);
    if (!done) throw HttpError.of("store_unreadable");
    if (body.mute && !done.muted) throw E("ff_wire_limit", "You have muted " + LIMITS.mutesPerMember + " names; unmute one first", { limit: "mutes", max: LIMITS.mutesPerMember });
    return reply({ symbol: name, muted: done.muted });
  };

  const note = async (ctx) => {
    const gate = await enter(ctx, { flags: [], limiter: LIMITER_BINDINGS.write, mutate: true });
    if (ctx.request.method === "DELETE") {
      const wire = ctx.url.searchParams.get("wire");
      if (!wireRef(wire)) throw HttpError.of("ff_wire_not_found");
      await store.noteDrop(ctx.env, gate.member, wire);
      return reply({ wire, note: noteView(null) });
    }
    const body = await readJSON(ctx.request);
    only(body, ["wire", "body"]);
    if (!wireRef(body.wire)) throw HttpError.of("ff_wire_not_found");
    if (typeof body.body !== "string") throw E("ff_grammar_invalid", "The note must be text");
    const length = [...body.body].length;
    if (length < 1) throw E("ff_grammar_invalid", "The note is empty; delete it instead");
    if (length > LIMITS.noteChars) throw E("ff_note_too_long", undefined, { length, max: LIMITS.noteChars });
    const saved = await store.noteSet(ctx.env, gate.member, body.wire, body.body, gate.at);
    if (!saved) throw HttpError.of("ff_wire_not_found");
    return reply({ wire: body.wire, note: noteView(saved) });
  };

  const run = async ({ request, env, url, ctx }) => {
    if (modeOf(env) === "off") throw E("ff_off", "Fire & Forget is off: the master switch is not on", { reason: "mode_off" });
    const kind = runAuth ? await runAuth(request, env, url) : null;
    if (!kind) throw HttpError.of("unauthorized");
    const body = await readJSON(request);
    only(body, ["cadence", "session"]);
    if (!["nightly", "live"].includes(body.cadence) || typeof body.session !== "string" || !DAY_RE.test(body.session)) throw E("ff_grammar_invalid", "cadence and session are required");
    if (typeof evaluate !== "function") throw HttpError.of("ff_evaluator_unavailable");
    const outcome = await evaluate({ env, ctx, cadence: body.cadence, session: body.session, kind, now: now() });
    return reply({ run: outcome === undefined ? null : outcome });
  };

  const by = (get, write) => (ctx) => (ctx.request.method === "GET" ? get(ctx) : write(ctx));

  return [
    { id: "ff-health", path: "/api/ff/health", methods: ["GET"], auth: "flows", handler: health },
    { id: "ff-wires", path: "/api/ff/wires", methods: ["GET", "POST", "PATCH"], auth: "flows", handler: by(wiresGet, wiresWrite) },
    { id: "ff-house", path: "/api/ff/house", methods: ["GET", "POST"], auth: "flows", handler: by(houseGet, housePost) },
    { id: "ff-hits", path: "/api/ff/hits", methods: ["GET", "POST"], auth: "flows", handler: by(hitsGet, hitsWrite) },
    { id: "ff-read", path: "/api/ff/read", methods: ["POST"], auth: "flows", handler: readWrite },
    { id: "ff-preview", path: "/api/ff/preview", methods: ["POST"], auth: "flows", handler: preview },
    { id: "ff-receipts", path: "/api/ff/receipts", methods: ["GET"], auth: "flows", handler: receipts },
    { id: "ff-records", path: "/api/ff/records", methods: ["GET"], auth: "flows", handler: records },
    { id: "ff-symbol", path: "/api/ff/symbol", methods: ["GET"], auth: "flows", handler: symbol },
    { id: "ff-digest", path: "/api/ff/digest", methods: ["GET"], auth: "flows", handler: digest },
    { id: "ff-export", path: "/api/ff/export", methods: ["GET"], auth: "flows", handler: exportCsv },
    { id: "ff-mute", path: "/api/ff/mute", methods: ["POST"], auth: "flows", handler: mute },
    { id: "ff-note", path: "/api/ff/note", methods: ["PUT", "DELETE"], auth: "flows", handler: note },
    { id: "ff-run", path: "/api/ff/run", methods: ["POST"], auth: "none", handler: run },
  ];
}
