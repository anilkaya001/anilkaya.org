import { HttpError, json, readJSON, requireSameOrigin } from "../http.js";
import { logFailure } from "../log.js";
import { fixtureHost } from "../../shared/flows-fixture-names.js";
import { memberAllowed, memberId } from "../../shared/flows-access.js";
import { open, pickSecret, seal, secretUsable } from "../../shared/flows-member-crypto.js";
import { DAY_MS, MEMBER_ID_RE, MEMBER_LIMITS, etagOf, modeOf, normalizeWatchlist, parseIfMatch } from "../../shared/flows-member-state.js";
import { sinceModel } from "../../shared/flows-since.js";
import { EXPORT_PAGES, EXPORT_FORMATS, EXPORT_SOURCES, buildExport, exportFileName, pageHold } from "../../shared/flows-export-build.js";
import { REASONS } from "../../shared/flows-columns.js";

export const MEMBER_PERIOD_S = 60;

const parseJson = (value) => {
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const payloadOf = (map, key) => {
  const row = map && map.get(key);
  return row && typeof row.payload === "string" ? parseJson(row.payload) : null;
};

export function flowsMeRows(deps) {
  const { store, flowsStore, readLiveRows, isOwner, now = Date.now } = deps;

  const gate = async (ctx, { limiter, flag, write }) => {
    const { request, env, session } = ctx;
    const id = memberId(session);
    if (id === null || !MEMBER_ID_RE.test(id)) throw HttpError.of("unauthorized");
    requireSameOrigin(request);
    if (write && request.headers.get("Origin") === null && request.headers.get("Sec-Fetch-Site") === null) throw HttpError.of("forbidden", "Same-origin request required");
    const mode = modeOf(env[flag]);
    if (mode === "off") throw HttpError.of(flag === "FLOWS_EXPORTS" ? "exports_off" : "member_state_off");
    if (mode === "owner" && !isOwner(env, id)) throw HttpError.of("forbidden");
    if (!(await memberAllowed(env[limiter], session))) throw HttpError.of("rate_limited", undefined, { "Retry-After": String(MEMBER_PERIOD_S) });
    if (!env.DB) throw HttpError.of("store_unreadable");
    return id;
  };

  const secretsOf = (env) => [env.MEMBER_STATE_KEY, env.MEMBER_STATE_KEY_PREV];

  const stateView = async (env, row, id) => {
    const version = row ? row.version : 0;
    const base = { member: id, version, maxNames: MEMBER_LIMITS.watchlistMax };
    const sealed = row !== null && row.ct !== null;
    if (!secretUsable(env.MEMBER_STATE_KEY)) {
      return { ...base, mode: "device-only", reason: "key_absent", watchlist: null, unreadable: sealed };
    }
    if (row !== null && row.deviceOnly) return { ...base, mode: "device-only", reason: "member_choice", watchlist: null, unreadable: false };
    if (!sealed) return { ...base, mode: "server", reason: null, watchlist: null, unreadable: false };
    let watchlist = null;
    let unreadable = false;
    try {
      const secret = await pickSecret(secretsOf(env), row.kid);
      if (secret === null) throw new Error("kid");
      watchlist = await open(secret, id, version, row.iv, row.ct);
    } catch {
      unreadable = true;
      logFailure("error", "member state unreadable", { route: "/api/me/state", code: "unreadable" });
    }
    return { ...base, mode: "server", reason: null, watchlist, unreadable };
  };

  const reply = (body, status = 200) => json(body, status, { ETag: etagOf(body.version) });

  const stale = (row) => {
    const version = row ? row.version : 0;
    return HttpError.of("stale_version", undefined, { ETag: etagOf(version) }, { version });
  };

  const universeNames = async (env) => {
    const row = await flowsStore.read(env, "universe");
    const payload = row && typeof row.payload === "string" ? parseJson(row.payload) : null;
    if (!payload || !Array.isArray(payload.t) || payload.t.length === 0 || !payload.t.every((t) => typeof t === "string")) return null;
    return new Set(payload.t);
  };

  const getState = async (ctx) => {
    const id = await gate(ctx, { limiter: "MEMBER_STATE_READ", flag: "FLOWS_MEMBER_STATE", write: false });
    const row = await store.read(ctx.env, id);
    if (row === undefined) throw HttpError.of("store_unreadable");
    return reply(await stateView(ctx.env, row, id));
  };

  const putState = async (ctx) => {
    const { request, env, url } = ctx;
    const id = await gate(ctx, { limiter: "MEMBER_STATE_WRITE", flag: "FLOWS_MEMBER_STATE", write: true });
    const precondition = parseIfMatch(request.headers.get("If-Match"));
    if (precondition.state === "missing") throw HttpError.of("precondition_required");
    if (precondition.state === "invalid") throw HttpError.of("invalid_precondition");
    const expected = precondition.version;
    const body = await readJSON(request);
    const keys = Object.keys(body).sort().join(",");
    const toDevice = keys === "deviceOnly" && body.deviceOnly === true;
    const toServer = keys === "deviceOnly,watchlist" && body.deviceOnly === false && Array.isArray(body.watchlist);
    if (!toDevice && !toServer) throw HttpError.of("invalid_watchlist");
    const t = now();
    if (toDevice) {
      const wrote = await store.put(env, id, { expected, kid: null, iv: null, ct: null, deviceOnly: true, now: t });
      if (wrote === undefined) throw HttpError.of("store_unreadable");
      if (!wrote.ok) throw stale(wrote.row);
      return reply(await stateView(env, wrote.row, id));
    }
    if (!secretUsable(env.MEMBER_STATE_KEY)) throw HttpError.of("member_state_unavailable");
    const known = await universeNames(env);
    if (known === null) throw HttpError.of("store_unreadable");
    const checked = normalizeWatchlist(body.watchlist, { known, fixtureHost: fixtureHost(url.hostname) });
    if (!checked.ok) {
      const details = checked.code === "too_many"
        ? { limit: MEMBER_LIMITS.watchlistMax, distinct: checked.distinct }
        : checked.code === "rejected" ? { rejected: checked.rejected, rejectedCount: checked.rejectedCount } : undefined;
      throw HttpError.of("invalid_watchlist", undefined, undefined, details);
    }
    const sealed = await seal(env.MEMBER_STATE_KEY, id, expected + 1, checked.names);
    const wrote = await store.put(env, id, { expected, kid: sealed.kid, iv: sealed.iv, ct: sealed.ct, deviceOnly: false, now: t });
    if (wrote === undefined) throw HttpError.of("store_unreadable");
    if (!wrote.ok) throw stale(wrote.row);
    return reply(await stateView(env, wrote.row, id));
  };

  const deleteState = async (ctx) => {
    const id = await gate(ctx, { limiter: "MEMBER_STATE_WRITE", flag: "FLOWS_MEMBER_STATE", write: true });
    const removed = await store.remove(ctx.env, id);
    if (removed === undefined) throw HttpError.of("store_unreadable");
    return json({
      deleted: { state: removed.state },
      kept: {
        exports: removed.exports,
        untilMs: removed.lastExportMs === null ? null : removed.lastExportMs + MEMBER_LIMITS.exportLogDays * DAY_MS,
        reason: "export record, kept 90 days",
      },
    });
  };

  const visit = async (ctx) => {
    const id = await gate(ctx, { limiter: "MEMBER_STATE_WRITE", flag: "FLOWS_MEMBER_STATE", write: true });
    const at = now();
    const seen = await store.visit(ctx.env, id, at);
    if (seen === undefined) throw HttpError.of("store_unreadable");
    const row = seen.row;
    return json({
      visit: {
        startedMs: row ? row.visitMs : null, lastSeenMs: row ? row.seenMs : null,
        previousEndedMs: row ? row.prevSeenMs : null, firstVisit: row === null || row.prevSeenMs === null, newVisit: seen.newVisit,
      },
    });
  };

  const gather = async (env, keys) => {
    const rows = await flowsStore.readMany(env, keys);
    if (rows === null) throw HttpError.of("store_unreadable");
    return rows;
  };

  const since = async (ctx) => {
    const { env } = ctx;
    const id = await gate(ctx, { limiter: "MEMBER_STATE_READ", flag: "FLOWS_MEMBER_STATE", write: false });
    const row = await store.read(env, id);
    if (row === undefined) throw HttpError.of("store_unreadable");
    const rows = await gather(env, ["universe", "scoretrack", "events", "flowalerts"]);
    const at = now();
    let alerts = payloadOf(rows, "flowalerts");
    const live = await readLiveRows(env.DB, ["live:alerts"], at).catch(() => null);
    const liveRow = live && Array.isArray(live.rows) ? live.rows.find((r) => r.id === "live:alerts") : null;
    const liveBody = liveRow && typeof liveRow.payload === "string" ? parseJson(liveRow.payload) : null;
    const nightlySession = alerts && typeof alerts.sessionDate === "string" ? alerts.sessionDate.slice(0, 10) : "";
    if (liveBody && typeof liveRow.session === "string" && liveRow.session >= nightlySession) alerts = liveBody;
    return json(sinceModel({
      now: at, prevSeenMs: row ? row.prevSeenMs : null,
      universe: payloadOf(rows, "universe"), track: payloadOf(rows, "scoretrack"), events: payloadOf(rows, "events"), alerts,
    }));
  };

  const pagesView = () => Object.fromEntries(EXPORT_PAGES.map((page) => {
    const hold = pageHold(page);
    return [page, hold === null ? { open: true } : { open: false, hold: hold.reason, why: REASONS[hold.reason] }];
  }));

  const exportsLog = async (ctx) => {
    const { env } = ctx;
    const id = await gate(ctx, { limiter: "MEMBER_STATE_READ", flag: "FLOWS_EXPORTS", write: false });
    const at = now();
    const list = await store.listExports(env, id, at);
    const used = await store.exportsInWindow(env, id, at);
    if (list === undefined || used === undefined) throw HttpError.of("store_unreadable");
    const frees = used >= MEMBER_LIMITS.exportsPer24h ? await store.exportFrees(env, id, at, used, MEMBER_LIMITS.exportsPer24h) : null;
    return json({
      exports: list, retentionDays: MEMBER_LIMITS.exportLogDays,
      window: { used, cap: MEMBER_LIMITS.exportsPer24h, freesAtMs: frees },
      pages: pagesView(), formats: EXPORT_FORMATS, serverNow: at,
    });
  };

  const limited = async (env, id, at, used) => {
    const frees = await store.exportFrees(env, id, at, used, MEMBER_LIMITS.exportsPer24h);
    const seconds = frees === null || frees === undefined ? MEMBER_PERIOD_S : Math.max(1, Math.ceil((frees - at) / 1000));
    return HttpError.of("export_limit", undefined, { "Retry-After": String(seconds) }, { freesAtMs: frees === undefined ? null : frees });
  };

  const exportFile = async (ctx) => {
    const { env } = ctx;
    const id = await gate(ctx, { limiter: "MEMBER_EXPORT", flag: "FLOWS_EXPORTS", write: true });
    const body = await readJSON(ctx.request);
    const keys = Object.keys(body).sort().join(",");
    if (keys !== "format,page" || !EXPORT_PAGES.includes(body.page) || !EXPORT_FORMATS.includes(body.format)) throw HttpError.of("invalid_export");
    const hold = pageHold(body.page);
    if (hold !== null) throw HttpError.of("export_held", undefined, undefined, { hold: hold.reason });
    const at = now();
    const used = await store.exportsInWindow(env, id, at);
    if (used === undefined) throw HttpError.of("store_unreadable");
    if (used >= MEMBER_LIMITS.exportsPer24h) throw await limited(env, id, at, used);
    const rows = await gather(env, EXPORT_SOURCES[body.page]);
    const sources = Object.fromEntries(EXPORT_SOURCES[body.page].map((key) => [key, payloadOf(rows, key)]));
    const built = buildExport(body.page, sources, { now: at, format: body.format });
    const logged = await store.logExport(env, id, { page: body.page, rows: built.rows.length, cols: built.header, now: at, cap: MEMBER_LIMITS.exportsPer24h });
    if (logged === undefined) throw HttpError.of("store_unreadable");
    if (!logged) throw await limited(env, id, at, MEMBER_LIMITS.exportsPer24h);
    return new Response(built.body, {
      status: 200,
      headers: {
        "Content-Type": built.type,
        "Content-Disposition": 'attachment; filename="' + exportFileName(body.page, built.meta.asofDay, body.format) + '"',
        "X-Export-Rows": String(built.rows.length),
        "X-Export-Available": String(built.meta.available),
        "X-Export-Truncated": built.meta.truncated ? "1" : "0",
        "X-Export-Method": built.meta.methodVersion,
        "X-Content-Type-Options": "nosniff",
      },
    });
  };

  return [
    { id: "me.state", path: "/api/me/state", methods: ["GET", "PUT", "DELETE"], auth: "flows",
      handler: (ctx) => (ctx.request.method === "GET" ? getState(ctx) : ctx.request.method === "PUT" ? putState(ctx) : deleteState(ctx)) },
    { id: "me.visit", path: "/api/me/visit", methods: ["POST"], auth: "flows", handler: visit },
    { id: "me.since", path: "/api/me/since", methods: ["GET"], auth: "flows", handler: since },
    { id: "me.exports", path: "/api/me/exports", methods: ["GET"], auth: "flows", handler: exportsLog },
    { id: "me.export", path: "/api/me/export", methods: ["POST"], auth: "flows", handler: exportFile },
  ];
}
