import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMutated } from "./truth/mutants.mjs";
import { HttpError, json } from "../server/http.js";
import * as ROUTES from "../server/routes/flows-flowlab.js";
import * as BUILD from "../server/flowlab.js";
import { OPS, BUDGETS } from "../shared/flows-vendor-ops.js";
import { chainWorld, route, routes, memoryCache, tokenBucket } from "./lib/sc-world.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-flowlab.json"), "utf8"));
const N = FX.worlds.normal;

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const NOW = Date.parse("2026-10-23T15:00:00Z");
const NEXT = Date.parse("2026-10-26T15:00:00Z");
const SESSION = { username: "owner" };
const MEMBER = { username: "member" };
const UUID = "a0a0a0a0-0000-4000-8000-000000000001";

function feedOf(world = N) {
  return (p, q) => {
    const has = (s) => p.includes(s);
    if (p === "/api/screener/option-contracts") return world["contract-screener"];
    if (has("/volume-profile")) return world["contract-profile"];
    if (has("/intraday") && has("/api/option-contract/")) return world["contract-intraday"];
    if (p.startsWith("/api/option-contract/") && p.endsWith("/flow")) return world["contract-flow"];
    if (p.startsWith("/api/option-trades/flow-alerts/")) return world["flow-alert-trades"];
    if (p.endsWith("/legs")) return world["multi-leg-legs"];
    if (p === "/api/option-trades/multi-leg") return world["multi-leg"];
    if (p.startsWith("/api/option-trades/exchange-breakdown/")) return world["exchange-breakdown"];
    if (p.endsWith("/flow-per-strike-intraday")) return world["strike-flow-intraday"];
    if (p.endsWith("/flow-recent")) return world["flow-recent"];
    if (p.startsWith("/api/group-flow/")) return world["group-greek-flow-expiry"];
    if (p.includes("/greek-flow/")) return world["greek-flow-expiry"];
    if (p.endsWith("/option/stock-price-levels")) return world["option-price-levels"];
    if (p.endsWith("/stock-volume-price-levels")) return world["stock-price-levels"];
    if (p === "/api/lit-flow/recent") return world["lit-recent"];
    if (p.startsWith("/api/lit-flow/")) return world["lit-ticker"];
    throw new Error("unexpected feed path " + p + JSON.stringify(q));
  };
}

class Refused extends Error {}

async function harness(R, B, { allowCalls = Infinity, allowMember = Infinity, feed = feedOf(), clock = NOW, readServed = null } = {}) {
  const stats = { member: 0, calls: 0, feed: [], cache: new Map(), served: [] };
  const vendorGate = () => {
    const g = async () => true;
    g.member = async () => stats.member++ < allowMember;
    g.call = async () => stats.calls++ < allowCalls;
    return g;
  };
  const serveCachedVendorRead = async ({ cacheKey, gate, build }) => {
    const k = cacheKey.url;
    if (stats.cache.has(k)) return json(stats.cache.get(k));
    if (!(await gate.member())) throw HttpError.of("rate_limited");
    const vf = async (p, q, o) => {
      if (!(await gate.call())) throw new Refused();
      stats.feed.push({ path: p, query: q, opts: o });
      return feed(p, q);
    };
    let payload;
    try { payload = await build(vf); } catch (e) { if (e instanceof Refused) throw HttpError.of("rate_limited"); throw e; }
    stats.cache.set(k, payload);
    return json(payload);
  };
  const builders = B.createFlowlab({ isRefusal: (e) => e instanceof Refused });
  const readNightly = readServed || (async (env, key) => { stats.served.push(key); return { payload: JSON.stringify({ key, v: 1 }), updatedAt: 1, fresh: null }; });
  const rows = R.flowsFlowlabRows({
    vendorGate, serveCachedVendorRead, readServed: readNightly,
    passthrough: (stored) => new Response(stored.payload, { status: 200, headers: { "Content-Type": "application/json" } }),
    builders, now: () => clock, isOwner: (env, u) => u === "owner",
  });
  const call = async (name, qs, { env = { FLOWS_FLOWLAB: "on" }, session = SESSION, host = "https://lab.test" } = {}) => {
    const row = rows.find((r) => r.path === "/api/flows/flowlab/" + name);
    const url = new URL(host + row.path + (qs ? "?" + qs : ""));
    try {
      const res = await row.handler({ request: new Request(url), env, url, ctx: { waitUntil() {} }, session });
      const body = await res.json();
      return { status: res.status, body };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, code: e.code, body: null };
      throw e;
    }
  };
  return { stats, call, rows };
}

const C = encodeURIComponent(FX.contract);

async function battery(R, B) {
  const bad = [];
  const need = (cond, tag) => { if (!cond) bad.push(tag); };
  const safe = async (tag, f) => { try { await f(); } catch (e) { bad.push(tag + " threw " + String(e && e.message).slice(0, 100)); } };

  await safe("modes", async () => {
    const h = await harness(R, B);
    const routesList = ["screen?preset=premium", "contract?c=" + C, "name?t=SYX101&view=strikes", "group?g=mag7&exp=2026-11-20", "lit", "venues?t=SYX101", "nightly?k=roots"];
    for (const q of routesList) {
      const [name, qs] = q.split("?");
      const off = await h.call(name, qs, { env: {} });
      need(off.status === 404 && off.code === "flowlab_off", "gate: absent switch is flowlab_off for " + name + " (" + off.status + ")");
      const typo = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "onn" }, session: SESSION });
      need(typo.status === 404 && typo.code === "flowlab_off", "gate: a misspelled switch is off even for the owner on " + name);
      const owner = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "owner" }, session: MEMBER });
      need(owner.status === 404 && owner.code === "flowlab_off", "gate: owner mode refuses a member on " + name + " with 404 and not 403");
      const own = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "owner" }, session: SESSION });
      need(own.status === 200, "gate: owner mode admits the owner on " + name + " (" + own.status + ")");
      const on = await h.call(name, qs, { env: { FLOWS_FLOWLAB: "on" }, session: MEMBER });
      need(on.status === 200, "gate: on admits a member on " + name + " (" + on.status + ")");
    }
    need(h.stats.feed.length > 0, "gate: the open reads reached the feed");
  });

  await safe("validation", async () => {
    const cases = [
      ["screen", "preset=nope", "invalid_preset"], ["screen", "", "invalid_preset"], ["screen", "preset=premium&t=bad!", "invalid_ticker"],
      ["contract", "c=nope", "invalid_contract"], ["contract", "", "invalid_contract"], ["contract", "c=" + C + "&d=2026-10-27", "invalid_contract"],
      ["contract", "c=" + C + "&d=2026-02-30", "invalid_contract"], ["contract", "c=" + C + "&part=nope", "invalid_contract"],
      ["contract", "c=" + C + "&part=alert", "invalid_alert"], ["contract", "c=" + C + "&part=legs&id=x", "invalid_alert"],
      ["name", "t=SYX101&view=nope", "invalid_view"], ["name", "view=strikes", "invalid_ticker"], ["name", "t=SYX101&view=greek", "invalid_expiry"],
      ["name", "t=SYX101&view=greek&exp=2026-13-40", "invalid_expiry"], ["name", "t=SYX101&view=strikes&spot=abc", "invalid_view"],
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
    const closed = await harness(R, B, { clock: Date.parse("2026-10-24T15:00:00Z") });
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
    need(out.body.x.prints.ok && out.body.x.minutes.ok && out.body.x.profile.ok, "core: three blocks");
    const refused = await harness(R, B, { allowCalls: 1 });
    const r = await refused.call("contract", "c=" + C);
    need(r.status === 429 && r.code === "rate_limited", "core: a refusal in the middle is rate_limited");
    need(refused.stats.calls === 2 && refused.stats.feed.length === 1, "core: the third call is not attempted after a refusal (" + refused.stats.calls + ")");
    const plan = await harness(R, B, { feed: (p, q) => { if (p.endsWith("/intraday")) { const e = new HttpError(502, "chain_upstream", "x"); e.upstream = 403; throw e; } return feedOf()(p, q); } });
    const p = await plan.call("contract", "c=" + C);
    need(p.status === 200 && p.body.x.prints.ok && p.body.x.minutes.ok === false && p.body.x.minutes.why === "plan" && p.body.x.profile.ok, "core: one block's plan refusal leaves the others");
    const timeout = await harness(R, B, { feed: () => { throw new HttpError(504, "chain_timeout", "x"); } });
    const t = await timeout.call("contract", "c=" + C);
    need(t.status === 504 && t.code === "chain_timeout" && timeout.stats.cache.size === 0, "core: every call timing out is a 504 and is not kept");
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
    need(s.body.x.list.every((c) => c.state === "candidate"), "parts: a structure is a candidate until its legs are read");
  });

  await safe("name", async () => {
    const counts = BUILD.FLOWLAB_CALLS;
    const runs = [["strikes", "name?t=SYX101&view=strikes&spot=120", counts.strikes], ["recent", "name?t=SYX101&view=recent", counts.recent], ["greek", "name?t=SYX101&view=greek&exp=2026-11-20", counts.greek], ["levels", "name?t=SYX101&view=levels", counts.levels], ["lit", "name?t=SYX101&view=lit", counts.lit]];
    for (const [view, q, n] of runs) {
      const h = await harness(R, B);
      const [name, qs] = q.split("?");
      const out = await h.call(name, qs);
      need(out.status === 200 && out.body.x !== null, "name: " + view + " answers");
      need(h.stats.calls === n && out.body.calls === n, `name: ${view} makes ${n} call(s) (${h.stats.calls})`);
    }
    const h = await harness(R, B);
    await h.call("name", "t=SYX101&view=strikes&spot=120.4");
    need(h.stats.feed[0].path === "/api/stock/SYX101/flow-per-strike-intraday" && h.stats.feed[0].query.date === "2026-10-23", "name: strikes path and date");
    const lv = await harness(R, B, { feed: (p, q) => { if (p.endsWith("/stock-volume-price-levels")) { const e = new HttpError(502, "chain_upstream", "x"); e.upstream = 403; throw e; } return feedOf()(p, q); } });
    const out = await lv.call("name", "t=SYX101&view=levels");
    need(out.status === 200 && out.body.x.reads.stock === "plan" && out.body.x.reads.options === null && out.body.x.stockRead === false, "name: levels with one side refused still shows the other");
    const g = await harness(R, B);
    const gg = await g.call("group", "g=mag7&exp=2026-11-20");
    need(gg.status === 200 && gg.body.calls === 1 && g.stats.feed[0].path === "/api/group-flow/mag7/greek-flow/2026-11-20" && gg.body.x.net !== null, "name: a group read");
    const l = await harness(R, B);
    const ll = await l.call("lit", "");
    need(ll.status === 200 && ll.body.calls === 1 && ll.body.x.list.length === 40, "name: the market lit list");
    const v = await harness(R, B);
    const vv = await v.call("venues", "t=SYX101");
    need(vv.status === 200 && vv.body.calls === 1 && v.stats.feed[0].path === "/api/option-trades/exchange-breakdown/2026-10-23" && v.stats.feed[0].query["ticker[]"] === "SYX101", "name: venues for one ticker today");
  });

  await safe("nightly", async () => {
    const h = await harness(R, B);
    for (const k of ["screen", "venues", "groups", "roots", "corr"]) {
      const out = await h.call("nightly", "k=" + k);
      need(out.status === 200 && out.body.key === "flowlab-" + k, "nightly: " + k + " is the stored key");
    }
    need(h.stats.feed.length === 0 && h.stats.member === 0 && h.stats.calls === 0, "nightly: no feed call and no token");
    const pend = await harness(R, B, { readServed: async () => null });
    const p = await pend.call("nightly", "k=roots");
    need(p.status === 200 && p.body.status === "pending", "nightly: an unwritten key is pending");
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
  [23, "core charged once", "server/flowlab.js", [["const intraday = await read(vf, st, pathFor(\"contract-intraday\", { id: c }), query);\n    const profile = await read(vf, st, pathFor(\"contract-profile\", { id: c }), query);", "const intraday = flow;\n    const profile = flow;"]], "three calls"],
  [24, "refusal swallowed", "server/flowlab.js", [["if (isRefusal(error)) throw error;\n      return { ok: false, why: whyOf(error) };", "return { ok: false, why: whyOf(error) };"]], "third call is not attempted"],
  [25, "switch read after the session", "server/routes/flows-flowlab.js", [["throw HttpError.of(\"flowlab_off\");\n  };\n\n  const serve", "throw HttpError.of(\"forbidden\");\n  };\n\n  const serve"]], "404 and not 403"],
  [26, "owner mode admits a member", "server/routes/flows-flowlab.js", [["flowlabMode(env, isOwner(env, session.username)) !== \"on\"", "flowlabMode(env, true) !== \"on\""]], "owner mode refuses a member"],
  [27, "misspelled switch admits the owner", "server/routes/flows-flowlab.js", [["flowlabMode(env, isOwner(env, session.username)) !== \"on\"", "!String(env.FLOWS_FLOWLAB || \"\").trim().toLowerCase().startsWith(\"o\")"]], "misspelled switch is off"],
  [28, "nightly route makes a feed call", "server/routes/flows-flowlab.js", [["const stored = await readServed(env, \"flowlab-\" + k);", "await serve({ env, ctx: null, url, session }, \"n/ping\", 60, (vf) => vf(\"/api/screener/option-contracts\", {}, {}));\n    const stored = await readServed(env, \"flowlab-\" + k);"]], "no feed call and no token"],
];

for (const [n, title, target, transforms, expect] of PLANTS) {
  const routeMod = target.includes("routes") ? await loadMutated(target, transforms) : ROUTES;
  const buildMod = target.includes("routes") ? BUILD : await loadMutated(target, transforms);
  const problems = await battery(routeMod, buildMod);
  ok(problems.length > 0, `PLANTED BUILD ${n} (${title}) must fail the battery`);
  ok(problems.some((p) => p.includes(expect)), `PLANTED BUILD ${n} fails its named check (${expect}): ${problems.slice(0, 3).join(" | ")}`);
}

{
  const e = OPS.filter((o) => ["contract-screener", "contract-flow", "contract-intraday", "contract-profile", "flow-alert-trades", "multi-leg-legs", "exchange-breakdown", "strike-flow-intraday", "flow-recent", "greek-flow-expiry", "group-greek-flow-expiry", "option-price-levels", "stock-price-levels", "lit-recent", "lit-ticker", "multi-leg"].includes(o.id));
  ok(e.length === 16 && e.every((o) => o.limiter === "ondemand"), "every operation a member route calls carries the on-demand limiter");
  const n = OPS.filter((o) => ["optionable-roots", "analytics-window", "analytics-sliding"].includes(o.id));
  ok(n.length === 3 && n.every((o) => o.limiter === null), "the nightly-only operations carry no limiter");
  ok(OPS.filter((o) => Object.keys(FX.ops).includes(o.id)).every((o) => o.klass !== "tape"), "no Flow Lab entry uses the other intraday class");
}

const flowWorld = (ch) => (url) => {
  const p = url.pathname;
  const has = (s) => p.includes(s);
  if (p === "/api/screener/option-contracts") return N["contract-screener"];
  if (has("/volume-profile")) return N["contract-profile"];
  if (has("/intraday") && has("/api/option-contract/")) return N["contract-intraday"];
  if (p.startsWith("/api/option-contract/") && p.endsWith("/flow")) return N["contract-flow"];
  return undefined;
};

let instance = 0;
const freshWorker = async () => (await import(`../worker.js?flowlab=${++instance}`)).default;
const pin = { UW_NOW: new Date(NOW).toISOString() };
const asOwner = { FLOWS_RT_USERS: "member.alpha" };

{
  const worker = await freshWorker();
  const off = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld(), { ...pin, FLOWS_FLOWLAB: "off" });
  eq([off.res.status, off.body.error && off.body.error.code], [404, "flowlab_off"], "worker: off is a JSON 404");
  eq(off.res.headers.get("Cache-Control"), "no-store", "worker: errors are no-store");
  const bare = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld(), { ...pin });
  eq(bare.res.status, 404, "worker: an absent switch is off");
  const member = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld(), { ...pin, FLOWS_FLOWLAB: "owner" });
  eq([member.res.status, member.body.error.code], [404, "flowlab_off"], "worker: owner mode refuses a member");
  const own = await route(worker, "/api/flows/flowlab/screen?preset=premium", flowWorld(), { ...pin, FLOWS_FLOWLAB: "owner", ...asOwner });
  eq([own.res.status, own.body.part, own.res.headers.get("X-Chain-Cache")], [200, "screen", "miss"], "worker: owner mode admits the owner");
  const cache = memoryCache();
  const world = flowWorld();
  const [first, second] = await routes(worker, ["/api/flows/flowlab/screen?preset=voi"], world, { ...pin, FLOWS_FLOWLAB: "on" }, { cache }).then(async (a) => [a[0], (await routes(worker, ["/api/flows/flowlab/screen?preset=voi"], world, { ...pin, FLOWS_FLOWLAB: "on" }, { cache }))[0]]);
  eq([first.res.headers.get("X-Chain-Cache"), second.res.headers.get("X-Chain-Cache")], ["miss", "hit"], "worker: the second read is the cached copy");
  eq(second.body.x.rows.length, N["contract-screener"].data.length, "worker: and carries the rows");
  const post = await fetchPost(worker);
  eq(post, 405, "worker: a POST is 405");
  const bucket = tokenBucket(1);
  const refused = await route(worker, "/api/flows/flowlab/contract?c=" + C, world, { ...pin, FLOWS_FLOWLAB: "on", UW_ONDEMAND: bucket });
  eq([refused.res.status, refused.body.error && refused.body.error.code], [429, "rate_limited"], "worker: the site budget running out in the middle of a core read is a 429 with no kept copy");
  ok(refused.res.headers.get("Retry-After") === "60", "worker: with Retry-After");
  eq(bucket.used, 2, "worker: the third call was never charged");
  const nightly = await route(worker, "/api/flows/flowlab/nightly?k=roots", world, { ...pin, FLOWS_FLOWLAB: "on" });
  ok(nightly.res.status === 200 || nightly.res.status === 503, "worker: the nightly read answers or says the store is gone (" + nightly.res.status + ")");
  const bad = await route(worker, "/api/flows/flowlab/contract?c=nope", world, { ...pin, FLOWS_FLOWLAB: "on" });
  eq([bad.res.status, bad.body.error.code], [400, "invalid_contract"], "worker: a bad contract is refused before any call");
}

async function fetchPost(worker) {
  const { token } = await import("./lib/sc-world.mjs");
  const { FLOWS_COOKIE } = await import("../shared/flows-auth.js");
  const res = await worker.fetch(new Request("https://sc-world.test/api/flows/flowlab/screen?preset=premium", { method: "POST", headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } }), (await import("./lib/sc-world.mjs")).envFor({ FLOWS_FLOWLAB: "on" }), { waitUntil() {} });
  return res.status;
}

console.log(`server-flowlab: ${checks} checks`);
