import { HttpError, json, requireTicker, internalKey, edgeCache } from "../http.js";
import { projectionColumns, projectUniverse } from "../../shared/flows-cross.js";
import * as FLOWS_ASK from "../../shared/flows-ask.js";
import * as FLOWS_LIVE from "../../shared/flows-live-worker.js";

const PENDING = Object.freeze({ status: "pending" });
const PENDING_ROWS = Object.freeze({ status: "pending", rows: Object.freeze([]) });
const PENDING_SECTORS = Object.freeze({ status: "pending", sectors: Object.freeze([]) });
const PENDING_RECORD = Object.freeze({ status: "pending", horizons: Object.freeze([]), sessions: 0 });

const NIGHTLY = Object.freeze([
  ["market", "market", PENDING],
  ["events", "events", PENDING],
  ["scoretrack", "scoretrack", PENDING],
  ["meta", "meta", PENDING],
  ["political", "political", PENDING],
  ["unusual", "unusual", PENDING],
  ["movers", "movers", PENDING_ROWS],
  ["sectors", "sector:trix", PENDING_ROWS],
  ["sector-premium", "sector:premium", PENDING_SECTORS],
  ["universe", "universe", PENDING],
  ["regime", "regime", PENDING],
  ["ideas", "ideas", PENDING],
  ["focus", "focus", PENDING],
  ["roster", "roster", PENDING],
  ["record", "record", PENDING_RECORD],
]);

const OVERLAID = Object.freeze(["flowalerts", "pulse", "news"]);
const CARDS = Object.freeze(["card", "card-x", "hist"]);
const BOARD_SIDES = Object.freeze(["short", "watch"]);
const UNIVERSE_COLS_TTL_S = 300;
const parseObject = (text) => { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch { return null; } };

const row = (name, handler) => ({ id: "flows." + name, path: "/api/flows/" + name, methods: ["GET"], auth: "flows", handler });

export function flowsReadRows(deps) {
  const { readServed, readFlowsPayload, readWithOverlay, passthrough, recallLastGood, storeGone, absentKey, cardWithEngine,
    briefWithLive, nightlyFreshHeaders, splitEngineMark } = deps;

  const nightly = (key, pending) => async ({ env }) => {
    const stored = await readServed(env, key);
    if (stored === null) return json(pending);
    return passthrough(stored);
  };

  const universeColumns = async ({ env, ctx, url }) => {
    const wanted = projectionColumns(url.searchParams.get("cols"));
    if (!wanted) throw HttpError.of("invalid_cols");
    const key = internalKey("universe-cols", wanted.join(","));
    const headersOf = (updatedAt, fresh) => ({
      "Content-Type": "application/json; charset=utf-8",
      "X-Payload-Updated": String(updatedAt || 0),
      ...nightlyFreshHeaders({ fresh }),
    });
    const hit = await edgeCache.get(key);
    if (hit) {
      const text = await hit.text().catch(() => "");
      const meta = parseObject(hit.headers.get("X-Nightly-Meta") || "");
      if (parseObject(text) && meta) return new Response(text, { status: 200, headers: headersOf(hit.headers.get("X-Payload-Updated"), meta) });
    }
    const stored = await readServed(env, "universe");
    if (stored === null) return json(PENDING);
    const universe = parseObject(stored.payload);
    if (!universe) return json({ status: "unreadable" });
    const text = JSON.stringify(projectUniverse(universe, wanted));
    const kept = new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "max-age=" + UNIVERSE_COLS_TTL_S, "X-Payload-Updated": String(stored.updatedAt || 0),
      "X-Nightly-Meta": JSON.stringify(stored.fresh || {}) } });
    const put = edgeCache.put(key, kept);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
    else await put;
    return new Response(text, { status: 200, headers: headersOf(stored.updatedAt, stored.fresh) });
  };

  const overlaid = (name) => async ({ env }) => {
    const { stored, overlaid: live, failed } = await readWithOverlay(env, name);
    if (live) return live;
    if (failed) throw storeGone();
    if (stored === null) return json(name === "news" ? PENDING_ROWS : PENDING);
    return passthrough(stored);
  };

  const servedView = (key) => async ({ env }) => {
    const stored = await readServed(env, key);
    if (stored === null) return json(PENDING);
    let view;
    try {
      view = JSON.parse(stored.payload);
      delete view.state;
    } catch {
      throw storeGone();
    }
    return passthrough({ ...stored, payload: JSON.stringify(view) });
  };

  const board = async ({ request, env, url }) => {
    const raw = url.searchParams.get("side");
    const side = BOARD_SIDES.includes(raw) ? raw : "long";
    const trace = {};
    const stored = await readFlowsPayload(env, "board:" + side, trace);
    if (stored === null) {
      const kept = trace.failed ? await recallLastGood(request, url) : null;
      if (kept) return kept;
      return json(trace.failed
        ? { side, rows: [], generatedAt: null, status: "pending", reason: "read-failed" }
        : { side, rows: [], generatedAt: null, status: "pending" });
    }
    return passthrough(stored);
  };

  const card = (kind) => async ({ env, ctx, url, session }) => {
    const ticker = requireTicker(url);
    const stored = await readServed(env, kind + ":" + ticker);
    if (stored === null) return absentKey(env, ctx, kind, ticker, session);
    if (!stored.payload.includes(splitEngineMark)) return passthrough(stored);
    const trace = {};
    const merged = await cardWithEngine(env, ticker, stored, trace);
    if (trace.failed) throw storeGone();
    if (!merged.card) return passthrough(stored);
    return json(merged.card, 200, { "X-Payload-Updated": String(stored.updatedAt || 0) });
  };

  const brief = async ({ env }) => {
    const stored = await readServed(env, "brief");
    if (stored === null) {
      return json({ status: "pending", today: null, yesterday: null, next: null,
        facts: [], silences: { pending: [], unreadable: [], quiet: [], unavailable: [] } });
    }
    let index = null;
    try { index = JSON.parse(stored.payload); } catch { index = null; }
    if (!index || typeof index !== "object" || Array.isArray(index)) return passthrough(stored);
    const live = await briefWithLive(env, index);
    return json({ ...live.index, session: FLOWS_ASK.briefAge(live.index, new Date(), FLOWS_LIVE.memoizedClock()) }, 200,
      { "X-Payload-Updated": String(stored.updatedAt || 0), ...nightlyFreshHeaders(stored),
        ...(live.overlay ? { "X-Live-Overlay": live.overlay } : {}) });
  };

  return [
    row("board", board),
    row("calib", servedView("calib")),
    row("dispersion", servedView("dispersion")),
    ...NIGHTLY.map(([name, key, pending]) => {
      const plain = nightly(key, pending);
      return row(name, name === "universe" ? (rc) => (rc.url.searchParams.has("cols") ? universeColumns(rc) : plain(rc)) : plain);
    }),
    ...OVERLAID.map((name) => row(name, overlaid(name))),
    ...CARDS.map((kind) => row(kind, card(kind))),
    row("brief", brief),
  ];
}
