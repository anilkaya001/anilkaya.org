import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMutated } from "./truth/mutants.mjs";
import { HttpError, json } from "../server/http.js";
import * as ROUTES from "../server/routes/flows-flowlab.js";
import * as BUILD from "../server/flowlab.js";
import { OPS, BUDGETS } from "../shared/flows-vendor-ops.js";
import { route, routes, memoryCache, tokenBucket, envFor, token } from "./lib/sc-world.mjs";
import { FLOWS_COOKIE } from "../shared/flows-auth.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-flowlab.json"), "utf8"));
const N = FX.worlds.normal;

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const NOW = Date.parse("2026-10-23T15:00:00Z");
const NEXT = Date.parse("2026-10-26T15:00:00Z");
const SAT = Date.parse("2026-10-24T15:00:00Z");
const LATE = Date.parse("2026-10-24T01:30:00Z");
const SESSION = { username: "owner" };
const MEMBER = { username: "member" };
const UUID = "a0a0a0a0-0000-4000-8000-000000000001";
const READ_KEYS = ["bytes", "cap", "class", "ms", "op", "status"];
const opOf = (id) => OPS.find((o) => o.id === id);

function feedOf(world = N) {
  return (p, q = {}) => {
    const has = (s) => p.includes(s);
    if (p === "/api/screener/option-contracts") return world["contract-screener"];
    if (has("/volume-profile")) return world["contract-profile"];
    if (has("/intraday") && has("/api/option-contract/")) return world["contract-intraday"];
    if (p.startsWith("/api/option-contract/") && p.endsWith("/flow")) return world["contract-flow"];
    if (p.startsWith("/api/option-trades/flow-alerts/")) return world["flow-alert-trades"];
    if (p.endsWith("/legs")) return world["multi-leg-legs"];
    if (p === "/api/option-trades/multi-leg") return world["multi-leg"];
    if (p.startsWith("/api/option-trades/exchange-breakdown/")) return q && q.by_trade_code ? world["exchange-breakdown-codes"] : world["exchange-breakdown"];
    if (p.endsWith("/flow-per-strike-intraday")) return world["strike-flow-intraday"];
    if (p.endsWith("/flow-per-strike")) return world["flow-per-strike"];
    if (p.endsWith("/flow-per-expiry")) return world["flow-per-expiry"];
    if (p.startsWith("/api/group-flow/")) return world["group-greek-flow-expiry"];
    if (p.includes("/greek-flow/")) return world["greek-flow-expiry"];
    if (p.endsWith("/option/stock-price-levels")) return world["option-price-levels"];
    if (p.startsWith("/api/darkpool/") && p.endsWith("/price-levels")) return world["darkpool-levels"];
    if (p === "/api/lit-flow/recent") return world["lit-recent"];
    if (p.startsWith("/api/lit-flow/")) return world["lit-ticker"];
    throw new Error("unexpected feed path " + p + JSON.stringify(q));
  };
}

const tagged = (e, kind, extra = {}) => Object.assign(e, { cause: { kind, status: null, bytes: null, cap: null, ms: 7, ...extra } });
const tooBig = (bytes) => tagged(new HttpError(502, "chain_too_large", "x"), "too_large", { bytes });
const upstream = (status) => tagged(Object.assign(new HttpError(status === 429 ? 429 : 502, status === 429 ? "chain_rate_limited" : "chain_upstream", "x"), { upstream: status }), status === 429 ? "limited" : "status", { status });
const unparsable = (bytes) => tagged(new HttpError(502, "chain_upstream", "x"), "unparsable", { bytes });
const unreachable = () => tagged(new HttpError(502, "chain_upstream", "x"), "network");
const timedOut = () => tagged(new HttpError(504, "chain_timeout", "x"), "timeout");
const unconfigured = () => tagged(new HttpError(503, "chain_unconfigured", "x"), "unconfigured");
const failOn = (suffix, make) => (p, q) => { if (p.endsWith(suffix)) throw make(); return feedOf()(p, q); };

class Refused extends Error {}

async function harness(R, B, { allowCalls = Infinity, allowMember = Infinity, feed = feedOf(), clock = NOW, readServed = null } = {}) {
  const stats = { member: 0, calls: 0, feed: [], cache: new Map(), served: [], reads: [], reports: [] };
  const vendorGate = () => {
    const g = async () => true;
    g.member = async () => stats.member++ < allowMember;
    g.call = async () => stats.calls++ < allowCalls;
    return g;
  };
  const serveCachedVendorRead = async ({ cacheKey, gate, build, ttlSeconds, ttlOf = null, failKey = null, failTtlSeconds = 0, flights = null }) => {
    const k = cacheKey.url;
    const entry = { key: k, ttl: ttlSeconds, failKey: failKey ? failKey.url : null, failTtl: failTtlSeconds, flights: !!flights, kept: null };
    stats.reads.push(entry);
    if (stats.cache.has(k)) return json(stats.cache.get(k));
    if (gate && !(await gate.member())) throw HttpError.of("rate_limited");
    const vf = async (p, q, o) => {
      if (gate && !(await gate.call())) throw new Refused();
      stats.feed.push({ path: p, query: q, opts: o });
      return feed(p, q, o);
    };
    let payload;
    try { payload = await build(vf); } catch (e) { if (e instanceof Refused) throw HttpError.of("rate_limited"); throw e; }
    const own = typeof ttlOf === "function" ? Number(ttlOf(payload)) : NaN;
    entry.kept = Number.isFinite(own) && own > 0 ? Math.min(own, ttlSeconds) : ttlSeconds;
    stats.cache.set(k, payload);
    return json(payload);
  };
  const builders = B.createFlowlab({ isRefusal: (e) => e instanceof Refused, report: (r) => stats.reports.push(r) });
  const readNightly = async (env, key) => {
    stats.served.push(key);
    return readServed ? readServed(env, key) : { payload: JSON.stringify({ key, v: 1 }), updatedAt: 1, fresh: null };
  };
  const rows = R.flowsFlowlabRows({
    vendorGate, serveCachedVendorRead, readServed: readNightly,
    passthrough: (stored) => new Response(stored.payload, { status: 200, headers: { "Content-Type": "application/json" } }),
    builders, now: () => clock, isOwner: (env, u) => u === "owner", flights: new Map(),
  });
  const call = async (name, qs, { env = { FLOWS_FLOWLAB: "on" }, session = SESSION, host = "https://lab.test" } = {}) => {
    const row = rows.find((r) => r.path === "/api/flows/flowlab/" + name);
    const url = new URL(host + row.path + (qs ? "?" + qs : ""));
    try {
      const res = await row.handler({ request: new Request(url), env, url, ctx: { waitUntil() {} }, session });
      const body = await res.json();
      return { status: res.status, body, headers: res.headers };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, code: e.code, body: null, details: e.details || null };
      throw e;
    }
  };
  return { stats, call, rows };
}

const storedAt = (session, extra = {}) => async (env, key) => ({ payload: JSON.stringify({ key, v: 1, sessionDate: session, ...extra }), updatedAt: 1, fresh: { session } });
const readShape = (r) => !!r && JSON.stringify(Object.keys(r).sort()) === JSON.stringify(READ_KEYS);

const C = encodeURIComponent(FX.contract);

async function battery(R, B) {
  const bad = [];
  const need = (cond, tag) => { if (!cond) bad.push(tag); };
  const safe = async (tag, f) => { try { await f(); } catch (e) { bad.push(tag + " threw " + String(e && e.message).slice(0, 100)); } };

  await safe("modes", async () => {
    const h = await harness(R, B);
    const routesList = ["screen?preset=premium", "contract?c=" + C, "name?t=SYX101&view=strikes", "group?g=mag7&exp=2026-11-20", "lit", "venues?t=SYX101", "nightly?k=roots", "nightly?k=groups"];
    for (const q of routesList) {
      const [name, qs] = q.split("?");
      const off = await h.call(name, qs, { env: {} });
      need(off.status === 404 && off.code === "flowlab_off", "gate: absent switch is flowlab_off for " + q + " (" + off.status + ")");
      const typo = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "onn" }, session: SESSION });
      need(typo.status === 404 && typo.code === "flowlab_off", "gate: a misspelled switch is off even for the owner on " + q);
      const owner = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "owner" }, session: MEMBER });
      need(owner.status === 404 && owner.code === "flowlab_off", "gate: owner mode refuses a member on " + q + " with 404 and not 403");
      const own = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "owner" }, session: SESSION });
      need(own.status === 200, "gate: owner mode admits the owner on " + q + " (" + own.status + ")");
      const on = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "on" }, session: MEMBER });
      need(on.status === 200, "gate: on admits a member on " + q + " (" + on.status + ")");
    }
    need(h.stats.feed.length > 0, "gate: the open reads reached the feed");
    need(h.stats.reads.every((r) => r.flights && r.failKey && r.failKey.includes("flowlab-fail")), "gate: every read joins a flight and keeps a failure mark");
  });

  await safe("validation", async () => {
    const cases = [
      ["screen", "preset=nope", "invalid_preset"], ["screen", "", "invalid_preset"], ["screen", "preset=premium&t=bad!", "invalid_ticker"],
      ["contract", "c=nope", "invalid_contract"], ["contract", "", "invalid_contract"], ["contract", "c=" + C + "&d=2026-10-27", "invalid_contract"],
      ["contract", "c=" + C + "&d=2026-02-30", "invalid_contract"], ["contract", "c=" + C + "&part=nope", "invalid_contract"],
      ["contract", "c=" + C + "&part=alert", "invalid_alert"], ["contract", "c=" + C + "&part=legs&id=x", "invalid_alert"],
      ["name", "t=SYX101&view=nope", "invalid_view"], ["name", "view=strikes", "invalid_ticker"], ["name", "t=SYX101&view=greek", "invalid_expiry"],
      ["name", "t=SYX101&view=greek&exp=2026-13-40", "invalid_expiry"],
      ["group", "g=nope&exp=2026-11-20", "invalid_group"], ["group", "g=mag7", "invalid_expiry"], ["venues", "", "invalid_ticker"],
      ["nightly", "k=nope", "invalid_view"], ["nightly", "", "invalid_view"],
    ];
    for (const [name, qs, code] of cases) {
      const h = await harness(R, B);
      const out = await h.call(name, qs);
      need(out.status === 400 && out.code === code, `validation: ${name}?${qs} is 400 ${code} (${out.status} ${out.code})`);
      need(h.stats.member === 0 && h.stats.calls === 0 && h.stats.feed.length === 0, `validation: ${name}?${qs} costs no token and no call`);
    }
    const fixture = await harness(R, B);
    const refused = await fixture.call("contract", "c=" + C, { host: "https://flows.example" });
    need(refused.status === 400 && refused.code === "invalid_contract", "validation: a fixture root is refused off a test host");
  });

  await safe("screen", async () => {
    const h = await harness(R, B);
    const out = await h.call("screen", "preset=voi");
    need(out.status === 200 && out.body.v === 1 && out.body.part === "screen" && out.body.session === "2026-10-23" && out.body.calls === 1, "screen: envelope");
    need(out.body.asOf === new Date(NOW).toISOString(), "screen: asOf is the read");
    need(out.body.x.rows.length === N["contract-screener"].data.length && out.body.x.minVolume === 200, "screen: rows and the minimum volume");
    const q = h.stats.feed[0].query;
    need(h.stats.feed[0].path === "/api/screener/option-contracts" && q.limit === "250" && q.order === "volume_oi_ratio" && q.vol_greater_oi === "true" && q.min_premium === "100000", "screen: the voi preset query");
    need(q.date === "2026-10-23" && !("ticker_symbol" in q), "screen: the session date and no ticker");
    const t = await harness(R, B);
    await t.call("screen", "preset=premium&t=syx101");
    need(t.stats.feed[0].query.ticker_symbol === "SYX101", "screen: a ticker is uppercased and passed");
    const e = await harness(R, B);
    await e.call("screen", "preset=earnings");
    need(/^\d+$/.test(e.stats.feed[0].query.max_earnings_dte), "screen: the earnings preset carries a day count");
    const k = await harness(R, B);
    await k.call("screen", "preset=premium");
    await k.call("screen", "preset=premium");
    need(k.stats.feed.length === 1, "screen: a repeat is served from the cache");
    const other = await harness(R, B, { clock: NEXT });
    const monday = await other.call("screen", "preset=premium");
    need(monday.body.session === "2026-10-26", "screen: a Monday read is Monday's session");
    const closed = await harness(R, B, { clock: SAT });
    const sat = await closed.call("screen", "preset=premium");
    need(sat.body.session === "2026-10-23" && sat.body.closed === true, "screen: a Saturday read is Friday's session, marked closed");
  });

  await safe("cache-day", async () => {
    const h = await harness(R, B);
    await h.call("screen", "preset=premium");
    const n1 = h.stats.feed.length;
    h.stats.cache.forEach((v, k) => { if (!/2026-10-23/.test(k)) bad.push("cache-day: key lacks the day " + k); });
    const next = await harness(R, B, { clock: NEXT });
    next.stats.cache = h.stats.cache;
    const again = await next.call("screen", "preset=premium");
    need(next.stats.feed.length === 1 && again.body.session === "2026-10-26", "cache-day: a new session day reads the feed again, not yesterday's copy (" + n1 + "," + next.stats.feed.length + ")");
  });

  await safe("core", async () => {
    const h = await harness(R, B);
    const out = await h.call("contract", "c=" + C);
    need(out.status === 200 && out.body.part === "core" && out.body.calls === 3, "core: three calls");
    need(h.stats.calls === 3 && h.stats.member === 1, "core: three feed tokens and one member token (" + h.stats.calls + "," + h.stats.member + ")");
    eq(h.stats.feed.map((f) => f.path), [`/api/option-contract/${FX.contract}/flow`, `/api/option-contract/${FX.contract}/intraday`, `/api/option-contract/${FX.contract}/volume-profile`], "core: the three paths in order");
    need(out.body.x.prints.ok && out.body.x.minutes.ok && out.body.x.profile.ok && out.body.partial === undefined, "core: three blocks");
    let open = 0;
    let peak = 0;
    const slow = await harness(R, B, { feed: async (p, q) => { open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 5)); open--; return feedOf()(p, q); } });
    await slow.call("contract", "c=" + C);
    need(peak === 3, "core: the three reads run together (" + peak + " at once)");
    const refused = await harness(R, B, { allowCalls: 1 });
    const r = await refused.call("contract", "c=" + C);
    need(r.status === 429 && r.code === "rate_limited", "core: a refusal in the middle is rate_limited");
    need(refused.stats.feed.length === 1, "core: a refused call reaches no feed (" + refused.stats.feed.length + ")");
    const plan = await harness(R, B, { feed: failOn("/intraday", () => upstream(403)) });
    const p = await plan.call("contract", "c=" + C);
    need(p.status === 200 && p.body.x.prints.ok && p.body.x.minutes.ok === false && p.body.x.minutes.why === "plan" && p.body.x.profile.ok, "core: one block's plan refusal leaves the others");
    need(readShape(p.body.x.minutes.read) && p.body.x.minutes.read.class === "plan" && p.body.x.minutes.read.status === 403 && p.body.x.minutes.read.op === "contract-intraday", "core: the failed block carries its read");
    need(p.body.partial === undefined && plan.stats.reads[0].kept === plan.stats.reads[0].ttl, "core: a plan refusal is settled and kept as long as the rest");
    const big = await harness(R, B, { feed: failOn("/intraday", () => tooBig(700000)) });
    const pb = await big.call("contract", "c=" + C + "&d=2026-10-22");
    need(pb.status === 200 && pb.body.partial === true && pb.body.x.minutes.read.class === "too_large" && pb.body.x.minutes.read.bytes === 700000, "core: a block past its cap is named and the copy is partial");
    need(big.stats.reads[0].ttl === ROUTES.TTL.past && big.stats.reads[0].kept === ROUTES.TTL.failLive, "core: a partial copy of a past day lives 60 s, not a day (" + big.stats.reads[0].kept + ")");
    const timeout = await harness(R, B, { feed: () => { throw timedOut(); } });
    const t = await timeout.call("contract", "c=" + C);
    need(t.status === 504 && t.code === "chain_timeout" && timeout.stats.cache.size === 0, "core: every call timing out is a 504 and is not kept");
    need(t.details && readShape(t.details.read) && t.details.read.class === "timeout", "core: the 504 carries its read");
    const day = await harness(R, B);
    const past = await day.call("contract", "c=" + C + "&d=2026-10-22");
    need(past.status === 200 && past.body.session === "2026-10-22" && past.body.closed === true && day.stats.feed[0].query.date === "2026-10-22", "core: a past date is read for that date");
  });

  await safe("parts", async () => {
    const h = await harness(R, B);
    const a = await h.call("contract", `c=${C}&part=alert&id=${UUID}`);
    need(a.status === 200 && a.body.part === "alert" && a.body.calls === 1 && h.stats.feed[0].path === `/api/option-trades/flow-alerts/${UUID}`, "parts: alert");
    const l = await h.call("contract", `c=${C}&part=legs&id=${UUID}`);
    need(l.status === 200 && l.body.part === "legs" && l.body.x.confirmed === true && h.stats.feed[1].path === `/api/option-trades/multi-leg/${UUID}/legs`, "parts: legs confirm the contract");
    const s = await h.call("contract", `c=${C}&part=structure`);
    const q = h.stats.feed[2].query;
    need(s.status === 200 && s.body.calls === 1 && h.stats.feed[2].path === "/api/option-trades/multi-leg" && q.ticker_symbol === "SYX101" && q.limit === 100 && /T/.test(q.newer_than) && q.newer_than < q.older_than, "parts: structure asks the ticker and the session window");
    need(s.body.x.list.every((c) => c.state === "candidate") && s.body.x.searched === N["multi-leg"].data.length, "parts: a structure is a candidate and the search is counted");
  });

  await safe("name", async () => {
    const counts = B.FLOWLAB_CALLS;
    const runs = [["strikes", "name?t=SYX101&view=strikes", counts.strikes], ["recent", "name?t=SYX101&view=recent", counts.recent], ["greek", "name?t=SYX101&view=greek&exp=2026-11-20", counts.greek], ["levels", "name?t=SYX101&view=levels", counts.levels], ["lit", "name?t=SYX101&view=lit", counts.lit]];
    for (const [view, q, n] of runs) {
      const h = await harness(R, B);
      const [name, qs] = q.split("?");
      const out = await h.call(name, qs);
      need(out.status === 200 && out.body.x !== null, "name: " + view + " answers");
      need(h.stats.calls === n && out.body.calls === n, `name: ${view} makes ${n} call(s) (${h.stats.calls})`);
      need(h.stats.feed.every((f) => f.opts.maxBytes === Math.max(B.MAX_BYTES, opOf(f.path.endsWith("/flow-per-strike-intraday") ? "strike-flow-intraday" : "contract-flow").maxBytes) || !f.path.endsWith("/flow-per-strike-intraday")), "name: " + view + " reads with its registry cap");
    }
    const h = await harness(R, B);
    const st = await h.call("name", "t=SYX101&view=strikes");
    eq(h.stats.feed.map((f) => f.path), ["/api/stock/SYX101/flow-per-strike", "/api/stock/SYX101/flow-per-strike-intraday"], "name: strikes reads the day and the minutes");
    need(h.stats.feed[0].query.date === "2026-10-23" && h.stats.feed[1].query.date === "2026-10-23" && h.stats.feed[1].query.filter === "Volume", "name: strikes asks the session and the volume filter");
    need(h.stats.feed[1].opts.maxBytes === opOf("strike-flow-intraday").maxBytes && h.stats.feed[1].opts.maxBytes > 2 * 1048576 && h.stats.feed[1].opts.deadlineMs === B.STRIKES_DEADLINE_MS, "name: the minute read takes its registry cap and its own deadline");
    need(st.body.x.map.ok && st.body.x.rail.ok && st.body.x.map.x.centerSource === "day" && st.body.x.center === st.body.x.rail.x.center, "name: the map is centred on the day's median");
    need(!st.body.t || st.body.t === "SYX101", "name: the ticker is the one asked");
    const half = await harness(R, B, { feed: failOn("/flow-per-strike-intraday", () => tooBig(2283112)) });
    const hs = await half.call("name", "t=SYX101&view=strikes");
    need(hs.status === 200 && hs.body.partial === true && hs.body.x.rail.ok && hs.body.x.map.ok === false && hs.body.x.map.why === "cap", "name: strikes with the minutes past the cap keeps the day");
    need(readShape(hs.body.x.map.read) && hs.body.x.map.read.class === "too_large" && hs.body.x.map.read.bytes === 2283112 && hs.body.x.map.read.op === "strike-flow-intraday", "name: the failed half names its class and size");
    const both = await harness(R, B, { feed: (p, q) => { if (p.includes("/flow-per-strike")) throw tooBig(2283112); return feedOf()(p, q); } });
    const hb = await both.call("name", "t=SYX101&view=strikes");
    need(hb.status === 502 && hb.code === "chain_too_large" && hb.details && hb.details.read.class === "too_large", "name: strikes with both halves past the cap is chain_too_large, never chain_upstream (" + hb.code + ")");
    const r = await harness(R, B);
    const rr = await r.call("name", "t=SYX101&view=recent");
    need(r.stats.feed[0].path === "/api/stock/SYX101/flow-per-expiry" && Object.keys(r.stats.feed[0].query || {}).length === 0, "name: recent reads flow per expiry with no parameters");
    need(rr.body.x.rows.length === N["flow-per-expiry"].length && rr.body.x.rows.every((q) => typeof q.netC === "number" || typeof q.why === "string"), "name: every expiry row has a net or its reason");
    const g = await harness(R, B);
    const gr = await g.call("name", "t=SYX101&view=greek&exp=2026-11-20");
    need(g.stats.feed[0].path === "/api/stock/SYX101/greek-flow/2026-11-20" && g.stats.feed[0].query.date === "2026-10-23" && gr.body.x.early === 0, "name: greek flow asks the expiry and the session");
    const lv0 = await harness(R, B);
    await lv0.call("name", "t=SYX101&view=levels");
    eq(lv0.stats.feed.map((f) => f.path), ["/api/stock/SYX101/option/stock-price-levels", "/api/darkpool/SYX101/price-levels"], "name: levels read the option and the off-exchange price levels");
    need(lv0.stats.feed.every((f) => f.query.date === "2026-10-23"), "name: levels ask the session");
    const lv = await harness(R, B, { feed: failOn("/price-levels", () => upstream(403)) });
    const out = await lv.call("name", "t=SYX101&view=levels");
    need(out.status === 200 && out.body.x.reads.stock.why === "plan" && out.body.x.reads.stock.read.class === "plan" && out.body.x.reads.stock.read.status === 403 && out.body.x.reads.options === null && out.body.x.stockRead === false, "name: levels with one side refused still shows the other");
    const lb = await harness(R, B, { clock: LATE, feed: failOn("/price-levels", () => tooBig(1800000)) });
    const lbo = await lb.call("name", "t=SYX101&view=levels");
    need(lbo.status === 200 && lbo.body.partial === true && lbo.body.x.reads.stock.read.class === "too_large", "name: levels with the stock side past its cap is partial");
    need(lb.stats.reads[0].ttl === ROUTES.TTL.settled && lb.stats.reads[0].kept === ROUTES.TTL.failRest, "name: a partial copy lives 300 s after the close, not six hours (" + lb.stats.reads[0].kept + ")");
    const gg0 = await harness(R, B);
    const gg = await gg0.call("group", "g=mag7&exp=2026-11-20");
    need(gg.status === 200 && gg.body.calls === 1 && gg0.stats.feed[0].path === "/api/group-flow/mag7/greek-flow/2026-11-20" && gg.body.x.net !== null, "name: a group read");
    const l = await harness(R, B);
    const ll = await l.call("lit", "");
    const lq = l.stats.feed[0].query;
    need(ll.status === 200 && ll.body.calls === 1 && ll.body.x.list.length === N["lit-recent"].data.length, "name: the market lit list keeps every print read");
    need(lq.limit === 200 && lq.min_premium === "500000" && lq.date === "2026-10-23" && ll.body.minPremium === 500000 && ll.body.limit === 200, "name: lit asks for the newest 200 over $500K");
    need(ll.body.x.below === 0 && ll.body.x.list.every((q) => q.premC >= 50000000), "name: lit holds its list to the floor it asked for");
    const v = await harness(R, B);
    const vv = await v.call("venues", "t=SYX101");
    const vq = v.stats.feed[0].query;
    need(vv.status === 200 && vv.body.calls === 1 && v.stats.feed[0].path === "/api/option-trades/exchange-breakdown/2026-10-23" && vq["ticker[]"] === "SYX101", "name: venues for one ticker today");
    need(vq.by_trade_code === "true" && vv.body.x.tickers[0].top.length > 0 && vv.body.x.tickers[0].exchanges.length > 0, "name: venues give the exchange split and the codes from one read");
  });

  await safe("classes", async () => {
    const cap = Math.max(B.MAX_BYTES, opOf("flow-per-expiry").maxBytes);
    const cases = [
      ["too_large", () => tooBig(600001), 502, "chain_too_large", null, 600001],
      ["status_5xx", () => upstream(503), 502, "chain_upstream", 503, null],
      ["status_4xx", () => upstream(400), 502, "chain_upstream", 400, null],
      ["status_4xx", () => upstream(422), 502, "chain_upstream", 422, null],
      ["unparsable", () => unparsable(4321), 502, "chain_upstream", null, 4321],
      ["timeout", () => timedOut(), 504, "chain_timeout", null, null],
      ["network", () => unreachable(), 502, "chain_upstream", null, null],
      ["limited", () => upstream(429), 429, "chain_rate_limited", 429, null],
      ["unconfigured", () => unconfigured(), 503, "chain_unconfigured", null, null],
    ];
    for (const [cls, make, status, code, upstreamStatus, bytes] of cases) {
      const h = await harness(R, B, { feed: failOn("/flow-per-expiry", make) });
      const out = await h.call("name", "t=SYX101&view=recent");
      const tag = cls + (upstreamStatus ? " " + upstreamStatus : "");
      need(out.status === status && out.code === code, "classes: " + tag + " answers " + status + " " + code + " (" + out.status + " " + out.code + ")");
      const read = out.details && out.details.read;
      need(readShape(read), "classes: " + tag + " carries its read, whose keys are " + READ_KEYS.join(","));
      need(read && read.class === cls && read.op === "flow-per-expiry" && read.status === upstreamStatus && read.bytes === bytes && read.cap === cap && Number.isInteger(read.ms), "classes: " + tag + " read holds only the class, status, size, cap and time (" + JSON.stringify(read) + ")");
      need(h.stats.cache.size === 0, "classes: " + tag + " is not kept as a copy");
      need(h.stats.reports.length === 1 && h.stats.reports[0] === read, "classes: " + tag + " is reported once");
    }
    for (const [cls, status] of [["plan", 403], ["plan", 401], ["empty", 404]]) {
      const h = await harness(R, B, { feed: failOn("/flow-per-expiry", () => upstream(status)) });
      const out = await h.call("name", "t=SYX101&view=recent");
      need(out.status === 200 && out.body.why === (cls === "plan" ? "plan" : "empty") && out.body.x === null, "classes: " + status + " is a settled " + cls + " answer");
      need(readShape(out.body.read) && out.body.read.class === cls && out.body.read.status === status, "classes: " + status + " names its class in the body");
      need(h.stats.reports.length === (cls === "empty" ? 0 : 1), "classes: " + status + (cls === "empty" ? " is not reported" : " is reported"));
    }
    const text = JSON.stringify((await (await harness(R, B, { feed: failOn("/flow-per-expiry", () => tooBig(1)) })).call("name", "t=SYX101&view=recent")).details);
    need(!/\/api\/|uw\.test|http/i.test(text), "classes: the read never carries a path or a host");
  });

  await safe("nightly", async () => {
    const h = await harness(R, B);
    for (const k of ["screen", "roots"]) {
      const out = await h.call("nightly", "k=" + k);
      need(out.status === 200 && out.body.key === "flowlab-" + k, "nightly: " + k + " is the stored key");
    }
    need(h.stats.feed.length === 0 && h.stats.member === 0 && h.stats.calls === 0, "nightly: no feed call and no token");
    const c = await harness(R, B);
    const co = await c.call("nightly", "k=corr");
    need(co.status === 200 && co.body.status === "off" && c.stats.served.length === 0, "nightly: relations off answers off with no store read");
    const con = await c.call("nightly", "k=corr", { env: { FLOWS_FLOWLAB: "on", FLOWS_FLOWLAB_ANALYTICS: "on" } });
    need(con.body.key === "flowlab-corr" && c.stats.feed.length === 0, "nightly: relations on reads the stored key");
    const pend = await harness(R, B, { readServed: async () => null });
    const p = await pend.call("nightly", "k=roots");
    need(p.status === 200 && p.body.status === "pending", "nightly: an unwritten key is pending");

    const g = await harness(R, B);
    const go = await g.call("nightly", "k=groups");
    need(go.status === 200 && go.body.source === "read" && go.body.sessionDate === "2026-10-23" && go.body.expiry === "2026-11-20" && Object.keys(go.body.groups).length === 25, "nightly: an open market reads the groups now");
    need(g.stats.feed.length === 25 && g.stats.member === 1 && g.stats.calls === 25 && g.stats.served.length === 0, "nightly: 25 charged calls, one member token and no store read while open (" + [g.stats.feed.length, g.stats.member, g.stats.served.length] + ")");
    need(g.stats.feed.every((f) => f.path.endsWith("/greek-flow/2026-11-20") && f.query.date === "2026-10-23" && f.opts.deadlineMs === B.GROUPS_DEADLINE_MS), "nightly: every group read asks the monthly expiry, the session and its deadline");
    need(Object.values(go.body.groups).every((q) => q.status === "ok") && go.body.partial === undefined, "nightly: every group read");
    need(g.stats.reads[0].ttl === ROUTES.TTL.groupsLive && g.stats.reads[0].key.includes("od/groups/2026-10-23"), "nightly: the groups copy lives five minutes in the session");
    await g.call("nightly", "k=groups");
    need(g.stats.feed.length === 25, "nightly: a second member reads the copy");

    const cs = await harness(R, B, { clock: SAT, readServed: storedAt("2026-10-23", { groups: {} }) });
    const cso = await cs.call("nightly", "k=groups");
    need(cso.body.key === "flowlab-groups" && cs.stats.feed.length === 0 && cs.stats.served.length === 1, "nightly: a closed market with tonight's key reads it and calls nothing");
    const co2 = await harness(R, B, { clock: SAT, readServed: storedAt("2026-10-22", { groups: {} }) });
    const old = await co2.call("nightly", "k=groups");
    need(old.body.source === "read" && old.body.sessionDate === "2026-10-23" && co2.stats.feed.length === 25, "nightly: an older key is read again from the feed");

    const rf = await harness(R, B, { allowCalls: 10 });
    const rfo = await rf.call("nightly", "k=groups");
    const statuses = Object.values(rfo.body.groups).map((q) => q.status);
    need(rfo.status === 200 && statuses.filter((q) => q === "ok").length === 10 && statuses.filter((q) => q === "limited").length === 15 && rf.stats.feed.length === 10, "nightly: refused groups after 10 calls leave 10 read and 15 limited (" + statuses.filter((q) => q === "ok").length + ")");
    need(rfo.body.partial === true && rf.stats.reads[0].kept === ROUTES.TTL.failLive, "nightly: refused groups make a partial copy that lives 60 s (" + rf.stats.reads[0].kept + ")");

    const none = await harness(R, B, { allowCalls: 0, readServed: storedAt("2026-10-22", { groups: {} }) });
    const nr = await none.call("nightly", "k=groups");
    need(nr.status === 200 && nr.body.key === "flowlab-groups" && nr.headers.get("X-Flowlab-Held") === "rate_limited", "nightly: a refused read falls back to the stored copy and says so");
    const fail = await harness(R, B, { feed: () => { throw upstream(503); }, readServed: async () => null });
    const fr = await fail.call("nightly", "k=groups");
    need(fr.status === 502 && fr.code === "chain_upstream" && fr.details && fr.details.read.class === "status_5xx", "nightly: a failed read with nothing stored names its class");
    const fb = await harness(R, B, { feed: () => { throw upstream(503); }, readServed: storedAt("2026-10-22", { groups: {} }) });
    const fbo = await fb.call("nightly", "k=groups");
    need(fbo.status === 200 && fbo.headers.get("X-Flowlab-Held") === "chain_upstream", "nightly: a failed read falls back to the stored copy and says so");

    const vu = await harness(R, B);
    const vo = await vu.call("nightly", "k=venues");
    need(vo.status === 200 && vo.body.source === "read" && Array.isArray(vo.body.tickers) && vo.body.limit === 100, "nightly: venues with no ticker are read now");
    need(vu.stats.feed.length === 1 && vu.stats.feed[0].query.limit === 100 && !("by_trade_code" in vu.stats.feed[0].query), "nightly: venues with no ticker is one call at limit 100 without codes");
    need(vu.stats.reads[0].ttl === ROUTES.TTL.venuesLive, "nightly: the venues copy lives two minutes in the session");
  });

  await safe("budgets", async () => {
    eq({ ...B.FLOWLAB_CALLS }, { ...BUDGETS.flowlab.memberCallsPerRead }, "budgets: the constant equals the registry's");
  });

  return bad;
}

const base = await battery(ROUTES, BUILD);
assert.deepEqual(base, [], "the shipped routes and builders pass their own battery:\n" + base.join("\n"));
checks++;

const PLANTS = [
  [21, "member token before validation", "server/routes/flows-flowlab.js", [["const contract = async (rc) => {\n    const { env, url, session } = rc;\n    gate(env, session);", "const contract = async (rc) => {\n    const { env, url, session } = rc;\n    gate(env, session);\n    await vendorGate(env, session).member();"]], "costs no token"],
  [22, "cache key omits the day", "server/routes/flows-flowlab.js", [["`screen/${preset}/${ticker || \"*\"}/${clock.day}`", "`screen/${preset}/${ticker || \"*\"}`"]], "cache-day"],
  [23, "core charged once", "server/flowlab.js", [["read(vf, st, opById(\"contract-intraday\"), { id: c }, query),\n      read(vf, st, opById(\"contract-profile\"), { id: c }, query),", "read(vf, st, opById(\"contract-flow\"), { id: c }, { ...query, limit: 100 }),\n      read(vf, st, opById(\"contract-flow\"), { id: c }, { ...query, limit: 100 }),"]], "three paths in order"],
  [24, "refusal swallowed", "server/flowlab.js", [["if (isRefusal(error)) throw error;\n      const r = readOf", "const r = readOf"]], "refusal in the middle is rate_limited"],
  [25, "switch read after the session", "server/routes/flows-flowlab.js", [["throw HttpError.of(\"flowlab_off\");\n  };\n\n  const serve", "throw HttpError.of(\"forbidden\");\n  };\n\n  const serve"]], "404 and not 403"],
  [26, "owner mode admits a member", "server/routes/flows-flowlab.js", [["flowlabMode(env, isOwner(env, session.username)) !== \"on\"", "flowlabMode(env, true) !== \"on\""]], "owner mode refuses a member"],
  [27, "misspelled switch admits the owner", "server/routes/flows-flowlab.js", [["flowlabMode(env, isOwner(env, session.username)) !== \"on\"", "!String(env.FLOWS_FLOWLAB || \"\").trim().toLowerCase().startsWith(\"o\")"]], "misspelled switch is off"],
  ["28a", "nightly route builds while a same-session key is stored", "server/routes/flows-flowlab.js", [["if (held && held.fresh && held.fresh.session === clock.day) return passthrough(held);", ""]], "tonight's key reads it and calls nothing"],
  ["28b", "nightly route builds outside the gate", "server/routes/flows-flowlab.js", [["return await serve(rc, clock, `od/${k}/${clock.day}`, nightlyTtlFor(clock, k), build);", "return await serveCachedVendorRead({ env, ctx: rc.ctx, cacheKey: internalKey(\"flowlab\", `od/${k}/${clock.day}`), wantsRefresh: false, gate: null, ttlSeconds: nightlyTtlFor(clock, k), build });"]], "one member token"],
  [46, "chain_too_large filed as failed", "server/flowlab.js", [["if (code === \"chain_too_large\" || kind === \"too_large\") return \"too_large\";", ""]], "never chain_upstream"],
  [47, "details dropped when the error is rebuilt", "server/flowlab.js", [["return HttpError.of(code, undefined, undefined, read ? { read } : undefined);", "return HttpError.of(code);"]], "carries its read"],
  [48, "a url key added to read", "server/flowlab.js", [["return { op: id, class: cls,", "return { op: id, url: \"/api/stock/\" + id, class: cls,"]], "carries its read, whose keys"],
  [50, "a failure copy kept for the success TTL", "server/routes/flows-flowlab.js", [["failTtlSeconds: failTtlFor(clock),", "failTtlSeconds: ttl,"]], "failure mark"],
  [51, "registry caps ignored", "server/flowlab.js", [["export const capOf = (id) => Math.max(MAX_BYTES, opById(id).maxBytes || 0);", "export const capOf = () => MAX_BYTES;"]], "registry cap"],
  [52, "422 filed as plan", "server/flowlab.js", [["if (status === 401 || status === 402 || status === 403) return \"plan\";", "if (status === 401 || status === 402 || status === 403 || status === 422) return \"plan\";"]], "status_4xx 422"],
  [53, "strikes read with no filter", "server/flowlab.js", [["{ date: session, filter: STRIKE_FILTER }", "{ date: session }"]], "volume filter"],
  [54, "recent reads the wrong operation", "server/flowlab.js", [["const res = await read(vf, st, opById(\"flow-per-expiry\"), { ticker: t });", "const res = await read(vf, st, opById(\"flow-per-strike\"), { ticker: t });"]], "flow per expiry"],
  [55, "stock levels without the session", "server/flowlab.js", [["read(vf, st, opById(\"darkpool-levels\"), { ticker: t }, { date: session }),", "read(vf, st, opById(\"darkpool-levels\"), { ticker: t }),"]], "levels ask the session"],
  [56, "a partial copy kept for the success TTL", "server/routes/flows-flowlab.js", [["ttlOf: (payload) => (payload && payload.partial === true ? failTtlFor(clock) : null),", "ttlOf: () => null,"]], "partial copy"],
  [57, "core read one after another", "server/flowlab.js", [["const [flow, intraday, profile] = await Promise.all([\n      read(vf, st, opById(\"contract-flow\"), { id: c }, { ...query, limit: 100 }),\n      read(vf, st, opById(\"contract-intraday\"), { id: c }, query),\n      read(vf, st, opById(\"contract-profile\"), { id: c }, query),\n    ]);", "const flow = await read(vf, st, opById(\"contract-flow\"), { id: c }, { ...query, limit: 100 });\n    const intraday = await read(vf, st, opById(\"contract-intraday\"), { id: c }, query);\n    const profile = await read(vf, st, opById(\"contract-profile\"), { id: c }, query);"]], "run together"],
  [58, "venue codes not asked", "server/flowlab.js", [["{ \"ticker[]\": t, by_trade_code: \"true\" }", "{ \"ticker[]\": t }"]], "codes from one read"],
  [59, "venues universe at the nightly's size with codes", "server/flowlab.js", [["{ limit: VENUES_UNIVERSE_LIMIT }", "{ limit: 500, by_trade_code: \"true\" }"]], "limit 100"],
  [60, "relations off read from the store", "server/routes/flows-flowlab.js", [["if (k === \"corr\" && !analyticsOn(env)) return plain({ status: \"off\" });", ""]], "relations off"],
  [61, "lit asks the default page", "server/flowlab.js", [["{ date: session, limit: LIT_LIMIT, min_premium: String(LIT_MIN_PREMIUM) }", "{ date: session, limit: 100 }"]], "newest 200 over"],
  [62, "a fallback that does not say so", "server/routes/flows-flowlab.js", [["out.headers.set(\"X-Flowlab-Held\", error.code);", ""]], "says so"],
  [63, "refused groups called whole", "server/flowlab.js", [["const partial = statuses.some((q) => q === \"limited\" || q === \"timeout\" || q === \"failed\" || q === \"cap\");", "const partial = false;"]], "partial copy that lives 60 s"],
  [64, "a 404 reported as a failure", "server/flowlab.js", [["if (r.class !== \"empty\") report(r);", "report(r);"]], "is not reported"],
];

{
  const extra = [];
  const late = await harness(ROUTES, BUILD, { clock: LATE, feed: failOn("/flow-per-expiry", () => upstream(503)) });
  await late.call("name", "t=SYX101&view=recent");
  extra.push(late.stats.reads[0].failTtl === ROUTES.TTL.failRest && late.stats.reads[0].ttl === ROUTES.TTL.settled ? null : "failure mark lives " + late.stats.reads[0].failTtl);
  ok(extra.every((x) => x === null), "the failure mark lives 300 s after the close while a copy lives six hours: " + extra.join());
}

const failMarkCheck = async (R, B) => {
  const late = await harness(R, B, { clock: LATE, feed: failOn("/flow-per-expiry", () => upstream(503)) });
  await late.call("name", "t=SYX101&view=recent");
  return late.stats.reads[0].failTtl === ROUTES.TTL.failRest ? [] : ["failure mark lives " + late.stats.reads[0].failTtl + " s"];
};

for (const [n, title, target, transforms, expect] of PLANTS) {
  const routeMod = target.includes("routes") ? await loadMutated(target, transforms) : ROUTES;
  const buildMod = target.includes("routes") ? BUILD : await loadMutated(target, transforms);
  const problems = [...(await battery(routeMod, buildMod)), ...(await failMarkCheck(routeMod, buildMod))];
  ok(problems.length > 0, `PLANTED BUILD ${n} (${title}) must fail the battery`);
  ok(problems.some((p) => p.includes(expect)), `PLANTED BUILD ${n} fails its named check (${expect}): ${problems.slice(0, 3).join(" | ")}`);
}

{
  const ids = ["contract-screener", "contract-flow", "contract-intraday", "contract-profile", "flow-alert-trades", "multi-leg-legs", "exchange-breakdown", "strike-flow-intraday", "flow-per-strike", "flow-per-expiry", "greek-flow-expiry", "group-greek-flow-expiry", "option-price-levels", "darkpool-levels", "lit-recent", "lit-ticker", "multi-leg"];
  const e = OPS.filter((o) => ids.includes(o.id));
  ok(e.length === ids.length && e.every((o) => o.limiter === "ondemand"), "every operation a member route calls carries the on-demand limiter");
  ok(!OPS.some((o) => o.id === "flow-recent" || o.id === "stock-price-levels"), "the two retired reads are out of the registry");
  const n = OPS.filter((o) => ["optionable-roots", "analytics-window", "analytics-sliding"].includes(o.id));
  ok(n.length === 3 && n.every((o) => o.limiter === null), "the nightly-only operations carry no limiter");
  ok(opOf("strike-flow-intraday").maxBytes >= 2 * 1048576 && opOf("group-greek-flow-expiry").maxBytes >= 1048576, "the registry caps cover the bodies the probe measured");
}

const flowWorld = (url) => {
  try { return feedOf()(url.pathname, Object.fromEntries(url.searchParams)); } catch { return undefined; }
};

let instance = 0;
const freshWorker = async () => (await import(`../worker.js?flowlab=${++instance}`)).default;
const pin = { UW_NOW: new Date(NOW).toISOString() };
const pinLate = { UW_NOW: new Date(LATE).toISOString() };
const asOwner = { FLOWS_RT_USERS: "member.alpha" };

async function raw(worker, paths, respond, envExtra = {}, { cache = null, concurrent = false } = {}) {
  const priorCaches = globalThis.caches;
  const priorFetch = globalThis.fetch;
  if (cache) globalThis.caches = { default: cache };
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.href || input.url);
    seen.push({ url, init });
    return respond(url, init);
  };
  const one = async (p) => {
    const req = new Request("https://sc-world.test" + p, { headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } });
    const pending = [];
    const res = await worker.fetch(req, envFor({ FLOWS_FLOWLAB: "on", ...envExtra }), { waitUntil(q) { pending.push(q); } });
    const text = await res.text();
    await Promise.allSettled(pending);
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { res, body, text };
  };
  try {
    const out = concurrent ? await Promise.all(paths.map(one)) : [];
    if (!concurrent) for (const p of paths) out.push(await one(p));
    return { out, seen };
  } finally {
    globalThis.fetch = priorFetch;
    if (cache) { if (priorCaches === undefined) delete globalThis.caches; else globalThis.caches = priorCaches; }
  }
}

const streamOf = (chunks) => new ReadableStream({ pull(c) { if (chunks.length) c.enqueue(new TextEncoder().encode(chunks.shift())); else c.close(); } });

async function workerChecks(load, label) {
  const lines = [];
  const prior = [console.warn, console.log, console.error];
  console.warn = console.log = console.error = (...a) => { lines.push(a.map(String).join(" ")); };
  try {
    return await workerBattery(load, label, lines);
  } finally {
    [console.warn, console.log, console.error] = prior;
  }
}

async function workerBattery(load, label, lines) {
  const bad = [];
  const need = (cond, tag) => { if (!cond) bad.push(label + ": " + tag); };
  const recent = "/api/flows/flowlab/name?t=SYX101&view=recent";
  const cap = Math.max(BUILD.MAX_BYTES, opOf("flow-per-expiry").maxBytes);
  const stubs = [
    ["declared size past the cap", () => new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": String(cap + 1) } }), 502, "chain_too_large", "too_large", null, cap + 1],
    ["counted size past the cap", () => new Response(streamOf(["[", " ".repeat(cap), "]"]), { status: 200, headers: { "content-type": "application/json" } }), 502, "chain_too_large", "too_large", null, "over"],
    ["503 text", () => new Response("upstream down", { status: 503, headers: { "content-type": "text/plain" } }), 502, "chain_upstream", "status_5xx", 503, null],
    ["400 JSON", () => new Response(JSON.stringify({ error: "bad date" }), { status: 400, headers: { "content-type": "application/json" } }), 502, "chain_upstream", "status_4xx", 400, null],
    ["422 JSON", () => new Response(JSON.stringify({ error: "bad" }), { status: 422, headers: { "content-type": "application/json" } }), 502, "chain_upstream", "status_4xx", 422, null],
    ["invalid JSON", () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }), 502, "chain_upstream", "unparsable", null, 9],
    ["rejected fetch", () => Promise.reject(new TypeError("fetch failed")), 502, "chain_upstream", "network", null, null],
    ["429", () => new Response("{}", { status: 429 }), 429, "chain_rate_limited", "limited", 429, null],
  ];
  for (const [name, respond, status, code, cls, upstreamStatus, bytes] of stubs) {
    const worker = await load();
    const { out: [r] } = await raw(worker, [recent], respond, pin, { cache: memoryCache() });
    need(r.res.status === status && r.body && r.body.error && r.body.error.code === code, name + " answers " + status + " " + code + " (" + r.res.status + " " + (r.body && r.body.error && r.body.error.code) + ")");
    const read = r.body && r.body.read;
    need(readShape(read) && read.class === cls && read.status === upstreamStatus && read.op === "flow-per-expiry" && read.cap === cap, name + " names its class in the body (" + JSON.stringify(read) + ")");
    need(bytes === "over" ? read && read.bytes > cap : read && read.bytes === bytes, name + " counts its bytes (" + (read && read.bytes) + ")");
    need(!/uw\.test|test-key|\/api\/stock|Bearer|Authorization/i.test(r.text), name + " body names no host, path or key");
  }
  {
    const worker = await load();
    let pulled = 0;
    const chunks = ["[", " ".repeat(cap), " ".repeat(cap), " ".repeat(cap), "]"];
    const body = () => new ReadableStream({ pull(c) { pulled++; const q = chunks.shift(); if (q === undefined) c.close(); else c.enqueue(new TextEncoder().encode(q)); } });
    const { out: [r] } = await raw(worker, [recent], () => new Response(body(), { status: 200, headers: { "content-type": "application/json" } }), pin);
    need(r.body && r.body.error && r.body.error.code === "chain_too_large" && pulled <= 3, "the body is read no further than the cap (" + pulled + " chunks pulled)");
  }
  {
    const prior = AbortSignal.timeout;
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
    try {
      const worker = await load();
      const { out: [r] } = await raw(worker, [recent], (url, init) => (init && init.signal && init.signal.aborted ? Promise.reject(init.signal.reason) : new Promise(() => {})), pin);
      need(r.res.status === 504 && r.body.error.code === "chain_timeout" && r.body.read && r.body.read.class === "timeout", "an abort is chain_timeout with its class (" + r.res.status + ")");
    } finally { AbortSignal.timeout = prior; }
  }
  {
    const worker = await load();
    const cache = memoryCache();
    const fail = () => new Response("down", { status: 503, headers: { "content-type": "text/plain" } });
    const { out, seen } = await raw(worker, [recent, recent], fail, pinLate, { cache });
    need(seen.length === 1, "no feed call while the failure is marked (" + seen.length + " calls)");
    need(out[1].res.status === 502 && out[1].body.read && out[1].body.read.class === "status_5xx" && out[1].body.read.status === 503, "the marked failure keeps its class");
    const mark = [...cache.store.entries()].find(([k]) => k.includes("flowlab-fail"));
    need(mark && mark[1].headers.get("Cache-Control") === "max-age=" + ROUTES.TTL.failRest, "the failure mark lives 300 s after the close (" + (mark && mark[1].headers.get("Cache-Control")) + ")");
  }
  {
    const worker = await load();
    const cache = memoryCache();
    await raw(worker, [recent], (url) => new Response(JSON.stringify(flowWorld(url)), { status: 200, headers: { "content-type": "application/json" } }), pin, { cache });
    const [k, v] = [...cache.store.entries()].find(([key]) => key.includes("/n/SYX101/recent/"));
    const aged = new Headers(v.headers);
    aged.set("X-Chain-Stored", String(Math.floor(Date.now() / 1000) - 600));
    cache.store.set(k, new Response(await v.clone().text(), { headers: aged }));
    const { out: [r] } = await raw(worker, [recent], () => new Response("down", { status: 503 }), pin, { cache });
    need(r.res.status === 200 && r.res.headers.get("X-Fresh-State") === "stale" && r.res.headers.get("X-Fresh-Reason") === "status_5xx", "a failure keeps the last copy and names its class (" + r.res.status + " " + r.res.headers.get("X-Fresh-Reason") + ")");
  }
  {
    const worker = await load();
    const cache = memoryCache();
    const levels = "/api/flows/flowlab/name?t=SYX101&view=levels";
    await raw(worker, [levels], (url) => (url.pathname.startsWith("/api/darkpool/") ? new Response("down", { status: 503 }) : new Response(JSON.stringify(flowWorld(url)), { status: 200, headers: { "content-type": "application/json" } })), pinLate, { cache });
    const entry = [...cache.store.entries()].find(([key]) => key.includes("/n/SYX101/levels/"));
    need(entry && entry[1].headers.get("X-Chain-Ttl") === String(ROUTES.TTL.failRest), "a partial copy is stored with its own short life (" + (entry && entry[1].headers.get("X-Chain-Ttl")) + ")");
  }
  {
    const worker = await load();
    const cache = memoryCache();
    let calls = 0;
    const respond = async (url) => {
      calls++;
      await new Promise((r) => setTimeout(r, 15));
      return new Response(JSON.stringify(flowWorld(url)), { status: 200, headers: { "content-type": "application/json" } });
    };
    const groups = "/api/flows/flowlab/nightly?k=groups";
    const slowGate = { limit: async () => { await new Promise((r) => setTimeout(r, 20)); return { success: true }; } };
    const { out } = await raw(worker, [groups, groups], respond, { ...pin, MEMBER_VENDOR: slowGate }, { cache, concurrent: true });
    need(calls === 25, "two members at once make 25 calls in all (" + calls + ")");
    need(out.every((q) => q.res.status === 200 && q.body.source === "read" && Object.keys(q.body.groups).length === 25), "both members get every group");
    need(out.map((q) => q.res.headers.get("X-Chain-Cache")).sort().join() === "joined,miss", "one member reads and the other joins (" + out.map((q) => q.res.headers.get("X-Chain-Cache")) + ")");
  }
  {
    const worker = await load();
    const from = lines.length;
    await raw(worker, [recent, "/api/flows/flowlab/name?t=SYX202&view=recent"], () => new Response("down", { status: 503 }), pin);
    const logged = lines.slice(from).filter((q) => q.includes("flowlab read failed"));
    need(logged.length === 1 && /status_5xx/.test(logged[0]) && /flow-per-expiry/.test(logged[0]), "a failed read is logged once per operation and class (" + logged.length + ")");
    need(logged.every((q) => !/uw\.test|test-key|SYX/.test(q)), "the log names no host, key or ticker");
  }
  return bad;
}

const shipped = await workerChecks(freshWorker, "worker");
assert.deepEqual(shipped, [], "the shipped Worker passes:\n" + shipped.join("\n"));
checks++;

const WORKER_PLANTS = [
  [49, "the whole body read before the cap", [["read = await readCapped(response, maxBytes);", "read = { text: await response.text() };\n      read.bytes = read.text.length;\n      if (read.bytes > maxBytes) read = { over: read.bytes };"]], "read no further than the cap"],
  [65, "no failure mark", [["if (failKey && cache && failTtlSeconds > 0) {", "if (false) {"]], "no feed call while the failure is marked"],
  [66, "a failure keeps no copy", [["if (failKey && hit) return kept(readClassOf(error) || error.code);", "if (false) return kept(readClassOf(error) || error.code);"]], "keeps the last copy"],
  [67, "no single flight", [["flowsFlowlabRows({ vendorGate, serveCachedVendorRead, readServed, passthrough, builders: FLOWLAB_BUILDERS, now: chainReadMs, flights: state.flowlabFlights,", "flowsFlowlabRows({ vendorGate, serveCachedVendorRead, readServed, passthrough, builders: FLOWLAB_BUILDERS, now: chainReadMs,"]], "25 calls in all"],
  [68, "a log line on every failure", [["const FLOWLAB_LOG_EVERY_MS = 600000;", "const FLOWLAB_LOG_EVERY_MS = 0;"]], "logged once"],
  [69, "a declared size taken on trust", [["if (Number.isFinite(declared) && declared > maxBytes) {", "if (false) {"]], "declared size past the cap answers"],
  [70, "the flight registered after the member gate", [["  const flight = (async () => {\n    if (gate && !(await gate.member())) return { refused: true };\n    try {", "  if (gate && !(await gate.member())) return refuse();\n  const flight = (async () => {\n    try {"]], "one member reads and the other joins"],
];

let salt = 0;
for (const [n, title, transforms, expect] of WORKER_PLANTS) {
  const problems = await workerChecks(async () => (await loadMutated("worker.js", transforms, { salt: ++salt })).default, "planted " + n);
  ok(problems.length > 0, `PLANTED BUILD ${n} (${title}) must fail the Worker checks`);
  ok(problems.some((p) => p.includes(expect)), `PLANTED BUILD ${n} fails its named check (${expect}): ${problems.slice(0, 3).join(" | ")}`);
}

{
  const worker = await freshWorker();
  const off = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld, { ...pin, FLOWS_FLOWLAB: "off" });
  eq([off.res.status, off.body.error && off.body.error.code], [404, "flowlab_off"], "worker: off is a JSON 404");
  eq(off.res.headers.get("Cache-Control"), "no-store", "worker: errors are no-store");
  const bare = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld, { ...pin });
  eq(bare.res.status, 404, "worker: an absent switch is off");
  const member = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld, { ...pin, FLOWS_FLOWLAB: "owner" });
  eq([member.res.status, member.body.error.code], [404, "flowlab_off"], "worker: owner mode refuses a member");
  const own = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld, { ...pin, FLOWS_FLOWLAB: "owner", ...asOwner });
  eq([own.res.status, own.body.part, own.res.headers.get("X-Chain-Cache")], [200, "screen", "miss"], "worker: owner mode admits the owner");
  const cache = memoryCache();
  const [first] = await routes(worker, ["/api/flows/flowlab/screen?preset=voi"], flowWorld, { ...pin, FLOWS_FLOWLAB: "on" }, { cache });
  const [second] = await routes(worker, ["/api/flows/flowlab/screen?preset=voi"], flowWorld, { ...pin, FLOWS_FLOWLAB: "on" }, { cache });
  eq([first.res.headers.get("X-Chain-Cache"), second.res.headers.get("X-Chain-Cache")], ["miss", "hit"], "worker: the second read is the cached copy");
  eq(second.body.x.rows.length, N["contract-screener"].data.length, "worker: and carries the rows");
  const post = await fetchPost(worker);
  eq(post, 405, "worker: a POST is 405");
  const bucket = tokenBucket(1);
  const refused = await route(worker, "/api/flows/flowlab/contract?c=" + C, flowWorld, { ...pin, FLOWS_FLOWLAB: "on", UW_ONDEMAND: bucket });
  eq([refused.res.status, refused.body.error && refused.body.error.code], [429, "rate_limited"], "worker: the site budget running out in the middle of a core read is a 429 with no kept copy");
  ok(refused.res.headers.get("Retry-After") === "60", "worker: with Retry-After");
  ok(bucket.used === 3, "worker: the three reads ask the budget together and one is charged (" + bucket.used + ")");
  const strikes = await route(worker, "/api/flows/flowlab/name?t=SYX101&view=strikes", flowWorld, { ...pin, FLOWS_FLOWLAB: "on" });
  ok(strikes.res.status === 200 && strikes.body.x.map.ok && strikes.body.x.rail.ok, "worker: strikes answers with both halves");
  const big = await raw(worker, ["/api/flows/flowlab/name?t=SYX101&view=strikes"], (url) => {
    if (url.pathname.endsWith("/flow-per-strike-intraday")) {
      const rows = N["strike-flow-intraday"].data;
      const many = [];
      while (JSON.stringify(many).length < 1500000) many.push(...rows);
      return new Response(JSON.stringify({ data: many }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(flowWorld(url)), { status: 200, headers: { "content-type": "application/json" } });
  }, pin);
  ok(big.out[0].res.status === 200 && big.out[0].body.x.map.ok, "worker: a 1.5 MB minute body fits the registry cap and draws the map");
  const nightly = await route(worker, "/api/flows/flowlab/nightly?k=roots", flowWorld, { ...pin, FLOWS_FLOWLAB: "on" });
  ok(nightly.res.status === 200 || nightly.res.status === 503, "worker: the nightly read answers or says the store is gone (" + nightly.res.status + ")");
  const corr = await route(worker, "/api/flows/flowlab/nightly?k=corr", flowWorld, { ...pin, FLOWS_FLOWLAB: "on" });
  eq([corr.res.status, corr.body.status], [200, "off"], "worker: relations answer off while the switch is off");
  const bad = await route(worker, "/api/flows/flowlab/contract?c=nope", flowWorld, { ...pin, FLOWS_FLOWLAB: "on" });
  eq([bad.res.status, bad.body.error.code], [400, "invalid_contract"], "worker: a bad contract is refused before any call");
}

async function fetchPost(worker) {
  const res = await worker.fetch(new Request("https://sc-world.test/api/flows/flowlab/screen?preset=premium", { method: "POST", headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } }), envFor({ FLOWS_FLOWLAB: "on" }), { waitUntil() {} });
  return res.status;
}

console.log(`server-flowlab: ${checks} checks`);
