import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { FIXTURE_ROSTER } from "./lib/fixture-roster.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import { moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const SESSION_SECRET = "desk-audit-session-secret-abcdefghijklmnopqrstuvwxyz";
globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };
const emptyD1 = {
  prepare() { const st = { bind: () => st, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return st; },
  batch: async (list) => list.map(() => ({ results: [] })),
};
const token = await signFlowsSession(FIXTURE_ROSTER[0], SESSION_SECRET, 3600, sessionEpoch({ SESSION_SECRET }));
const envFor = (extra = {}) => ({
  DB: emptyD1, SESSION_SECRET, UW_API_KEY: "test-key", UW_BASE: "http://uw.test",
  FLOWS_CREDENTIALS: JSON.stringify({ [FIXTURE_ROSTER[0]]: "x".repeat(43) }), ...extra,
});

const realFetch = globalThis.fetch;
async function route(worker, path, world, envExtra = {}) {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.href || input.url);
    calls.push(url.pathname + url.search);
    const ticker = (url.pathname.match(/\/api\/stock\/([^/]+)\//) || [])[1];
    const body = world(url, ticker ? decodeURIComponent(ticker) : "");
    if (body === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const req = new Request("https://desk-audit.test" + path, { headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } });
    const res = await worker.fetch(req, envFor(envExtra), { waitUntil() {} });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { res, body, calls };
  } finally { globalThis.fetch = realFetch; }
}

const T = "SYX101";
const chainRows = (expiry) => [
  { option_symbol: `${T}${expiry}P00170000`, nbbo_bid: "2.50", nbbo_ask: "2.60", implied_volatility: "0.28", open_interest: "1200", volume: "340", delta: "-0.3", gamma: "0.02", theta: "-0.1", vega: "0.3" },
  { option_symbol: `${T}${expiry}C00190000`, nbbo_bid: "3.20", nbbo_ask: "3.35", implied_volatility: "0.26", open_interest: "950", volume: "400", delta: "0.4", gamma: "0.02", theta: "-0.1", vega: "0.3" },
  { option_symbol: `${T}${expiry}C00180000`, nbbo_bid: "6.50", nbbo_ask: "6.60", implied_volatility: "0.27", open_interest: "900", volume: "10", delta: "0.6", gamma: "0.02", theta: "-0.1", vega: "0.3" },
  { option_symbol: `${T}${expiry}P00180000`, nbbo_bid: "3.10", nbbo_ask: "3.20", implied_volatility: "0.27", open_interest: "900", volume: "10", delta: "-0.4", gamma: "0.02", theta: "-0.1", vega: "0.3" },
];
const BARS = [
  { date: "2026-08-25", market_time: "po", close: "190.00" },
  { date: "2026-08-25", market_time: "r", close: "183.40" },
  { date: "2026-08-24", market_time: "r", close: "180.00" },
];
const INFO = { data: { next_earnings_date: "2026-12-30", announce_time: "premarket", issue_type: "Common Stock" } };
const worldOf = ({ state, bars = BARS, chain = chainRows("260918"), info = INFO }) => (url) => {
  if (url.pathname.endsWith("/option-contracts")) return { data: chain };
  if (url.pathname.includes("/ohlc/")) return { data: bars };
  if (url.pathname.endsWith("/stock-state")) return state === null ? undefined : state;
  if (url.pathname.endsWith("/info")) return info;
  if (url.pathname.endsWith("/expiry-breakdown")) return { data: [{ expires: "2026-09-18", chains: 10, open_interest: 100, volume: 5 }] };
  return undefined;
};
const REGULAR = { data: { close: "183.40", prev_close: "179.10", market_time: "regular", tape_time: "2026-08-25T18:06:00Z" } };
const NOW = "2026-08-25T18:10:00Z";

const worker = (await import("../worker.js?desk-audit=1")).default;

{
  const world = (state) => worldOf({ state });
  for (const [label, prev, want] of [["missing", undefined, null], ["zero", "0", null], ["negative", "-1", null], ["empty", "", null], ["text", "abc", null], ["NaN", "NaN", null], ["a real close", "179.10", 179.1]]) {
    const state = { data: { close: "183.40", market_time: "regular", tape_time: "2026-08-25T18:06:00Z", ...(prev === undefined ? {} : { prev_close: prev }) } };
    const chain = await route(worker, `/api/flows/chain?t=${T}&refresh=1`, world(state), { UW_NOW: NOW });
    const ctx = await route(worker, `/api/flows/strategy?t=${T}&refresh=1`, world(state), { UW_NOW: NOW });
    eq([chain.res.status, chain.body.prevClose], [200, want], `chain route, previous close ${label}: ${want === null ? "no figure (null), never the spot" : "the vendor's own"}`);
    eq([ctx.res.status, ctx.body.prevClose], [200, want], `strategy context, previous close ${label}: the same`);
  }

  const src = moduleSource("worker.js");
  ok(!/prevClose: numOrNull\(live && live\.prev_close\)/.test(src) && !/prev_close\) \?\? print\.spot/.test(src), "neither builder falls back to the spot for a missing previous close");
}

{
  const wanted = { spot: 183.4 };
  const state = (marketTime, close, tape) => ({ data: { close, prev_close: "179.10", market_time: marketTime, tape_time: tape } });
  const probes = [
    ["after the close", state("postmarket", "190.00", "2026-08-25T21:30:00Z"), "2026-08-25T22:00:00Z"],
    ["before the open", state("premarket", "181.00", "2026-08-26T11:00:00Z"), "2026-08-26T12:00:00Z"],
    ["a Saturday", state("postmarket", "190.00", "2026-08-25T21:30:00Z"), "2026-08-29T15:00:00Z"],
  ];
  for (const [label, st, now] of probes) {
    const bars = now.startsWith("2026-08-29") || now.startsWith("2026-08-26") ? [{ date: "2026-08-25", market_time: "r", close: "183.40" }, { date: "2026-08-25", market_time: "po", close: "190.00" }] : BARS;
    const world = worldOf({ state: st, bars, chain: chainRows("260918") });
    const ctx = await route(worker, `/api/flows/strategy?t=${T}&refresh=1`, world, { UW_NOW: now });
    const eng = await route(worker, `/api/flows/strategy?t=${T}&expiry=2026-09-18&engine=1&refresh=1`, world, { UW_NOW: now });
    eq(ctx.body.spot, wanted.spot, `${label}: the context route prices off the regular close`);
    eq(eng.body.engine.status, "ok", `${label}: the engine runs`);
    eq(eng.body.engine.spot, wanted.spot, `${label}: AND SO DOES THE ENGINE (the lab priced every structure off the 190.00 extended-hours print against option quotes struck at the close)`);
    eq(eng.body.engine.spotSource, "regular-close", `${label}: named as the regular close`);
    eq(eng.calls.filter((c) => c.includes("/ohlc/")).length, 1, `${label}: one bars read, only because the state is not a regular print`);
  }
  const live = await route(worker, `/api/flows/strategy?t=${T}&expiry=2026-09-18&engine=1&refresh=1`, worldOf({ state: REGULAR }), { UW_NOW: NOW });
  eq(live.body.engine.spot, 183.4, "in the regular session the engine uses the live print");
  eq(live.body.engine.spotSource, "stock-state", "and says so");
  eq(live.calls.filter((c) => c.includes("/ohlc/")).length, 0, "with no bars read at all");
  const none = await route(worker, `/api/flows/strategy?t=${T}&expiry=2026-09-18&engine=1&refresh=1`, worldOf({ state: { data: { close: "190", market_time: "postmarket", tape_time: "2026-08-25T21:30:00Z" } }, bars: [{ date: "2026-08-25", market_time: "po", close: "190.00" }] }), { UW_NOW: "2026-08-25T22:00:00Z" });
  eq([none.body.engine.status, /regular-session price/.test(none.body.engine.reason)], ["unavailable", true], "with no regular-session price anywhere the engine says it is unavailable and why, rather than pricing off an extended-hours print");
  eq(none.body.engine.spotSource, null, "and names no spot source");
}

{
  const state = (tape) => ({ data: { close: "183.40", prev_close: "179.10", market_time: "regular", tape_time: tape } });
  const run = async (announce, date, now) => {
    const r = await route(worker, `/api/flows/chain?t=${T}&refresh=1`, worldOf({ state: state(now.replace(/:\d\d:\d\dZ$/, ":00Z")), info: { data: { next_earnings_date: date, announce_time: announce, issue_type: "Common Stock" } } }), { UW_NOW: now });
    return { crosses: [...new Set(r.body.rows.map((x) => x.crossesEarnings))], earnings: r.body.earnings, status: r.res.status };
  };
  const after = await run("premarket", "2026-08-25", "2026-08-25T18:10:00Z");
  eq(after.crosses, [null], "a pre-market report on the day, read at 14:10 ET: every line is undetermined, not 'crosses'");
  eq([after.earnings.precedesSale, after.earnings.past], [true, false], "the payload says the report precedes the sale, and is not past");
  const early = await run("premarket", "2026-08-25", "2026-08-25T12:00:00Z");
  eq([early.crosses, early.earnings.precedesSale], [[null], true], "read at 08:00 ET it is the same: the first sale still follows the report");
  const day = await run("premarket", "2026-08-26", "2026-08-25T18:10:00Z");
  eq([day.crosses, day.earnings.precedesSale], [[true], false], "the day before, the report is ahead of the sale and the line crosses");
  const evening = await run("afterhours", "2026-08-25", "2026-08-25T18:10:00Z");
  eq([evening.crosses, evening.earnings.precedesSale], [[true], false], "an after-close report tonight is ahead of a sale made now");
  const stale = await run("premarket", "2026-08-20", "2026-08-25T18:10:00Z");
  eq([stale.crosses, stale.earnings.past, stale.earnings.precedesSale], [[null], true, true], "a vendor date already past stays undetermined, flagged past");
}

{
  const probes = {
    prev: async (w) => {
      const state = { data: { close: "183.40", market_time: "regular", tape_time: "2026-08-25T18:06:00Z" } };
      const a = await route(w, `/api/flows/chain?t=${T}&refresh=1`, worldOf({ state }), { UW_NOW: NOW });
      const b = await route(w, `/api/flows/strategy?t=${T}&refresh=1`, worldOf({ state }), { UW_NOW: NOW });
      return [a.body.prevClose, b.body.prevClose].filter((v) => v !== null);
    },
    engine: async (w) => {
      const state = { data: { close: "190.00", prev_close: "179.10", market_time: "postmarket", tape_time: "2026-08-25T21:30:00Z" } };
      const r = await route(w, `/api/flows/strategy?t=${T}&expiry=2026-09-18&engine=1&refresh=1`, worldOf({ state }), { UW_NOW: "2026-08-25T22:00:00Z" });
      return r.body.engine && r.body.engine.spot === 183.4 ? [] : [r.body.engine && r.body.engine.spot];
    },
    report: async (w) => {
      const state = { data: { close: "183.40", prev_close: "179.10", market_time: "regular", tape_time: "2026-08-25T18:06:00Z" } };
      const info = { data: { next_earnings_date: "2026-08-25", announce_time: "premarket", issue_type: "Common Stock" } };
      const r = await route(w, `/api/flows/chain?t=${T}&refresh=1`, worldOf({ state, info }), { UW_NOW: NOW });
      return r.body.rows.every((x) => x.crossesEarnings === null) ? [] : ["crosses"];
    },
  };
  for (const [name, probe] of Object.entries(probes)) eq(await probe(worker), [], `the shipped Worker passes the ${name} probe`);
  const MUTANTS = [
    ["chain previous close falls back to the spot", "prev", [["prevClose: positiveOrNull(live && live.prev_close),\n    strategy, ...ranked,", "prevClose: positiveOrNull(live && live.prev_close) ?? print.spot,\n    strategy, ...ranked,"]]],
    ["strategy previous close falls back to the spot", "prev", [["prevClose: positiveOrNull(live && live.prev_close),\n\n    expiries,", "prevClose: positiveOrNull(live && live.prev_close) ?? print.spot,\n\n    expiries,"]]],
    ["the engine prices off the raw live close", "engine", [["const spot = print === null ? null : print.spot;", "const spot = numOrNull(stateOf(liveState) && stateOf(liveState).close);"]]],
    ["the report is judged without the read time", "report", [["crossesEarnings(row.expiry, earnDate, info.announceTime, { asOf, readMs })", "crossesEarnings(row.expiry, earnDate, info.announceTime, { asOf })"]]],
  ];
  let n = 0;
  for (const [title, kind, edits] of MUTANTS) {
    const mod = await loadMutated("worker.js", edits);
    const bad = await probes[kind](mod.default);
    ok(bad.length > 0, `PLANTED WRONG BUILD IS CAUGHT (${kind}): ${title}`);
    n++;
  }
  eq(n, MUTANTS.length, "every planted Worker build was run");
}

{
  const pages = readFileSync(new URL("../shared/flows-pages.js", import.meta.url), "utf8");
  const copy = new Map();
  const from = pages.indexOf('<div id="dkCopy" hidden>');
  const block = pages.slice(from, pages.indexOf("</div>", from));
  ok(from > 0 && block.length > 5000, "the desk's own copy block was isolated");
  for (const m of block.matchAll(/<p data-k="([a-z0-9.-]+)">([\s\S]*?)<\/p>/g)) copy.set(m[1], new Set([...m[2].matchAll(/\{(\w+)\}/g)].map((x) => x[1])));
  ok(copy.size > 80, "the desk's copy block was read: " + copy.size + " keys");
  const used = [];
  for (const file of ["flows-desk.js", "flows-desk-calls.js"]) {
    const src = readFileSync(new URL("../assets/js/" + file, import.meta.url), "utf8");
    for (const m of src.matchAll(/\bT\("([a-z0-9.-]+)"(,\s*\{)?/g)) {
      const vars = [];
      if (m[2]) {
        let depth = 1, top = "";
        for (let i = m.index + m[0].length; i < src.length && depth > 0; i++) {
          const ch = src[i];
          if (ch === "{" || ch === "(" || ch === "[") depth++;
          else if (ch === "}" || ch === ")" || ch === "]") depth--;
          if (depth === 1) top += ch;
        }
        for (const part of top.split(",")) { const name = part.trim().match(/^(\w+)\s*(:|$)/); if (name) vars.push(name[1]); }
      }
      used.push({ file, key: m[1], vars });
    }
  }
  ok(used.length > 100, "the desk's copy lookups were found: " + used.length);
  const prefix = (u) => u.key.endsWith("-");
  const missing = used.filter((u) => (prefix(u) ? ![...copy.keys()].some((k) => k.startsWith(u.key)) : !copy.has(u.key))).map((u) => u.file + ":" + u.key);
  eq(missing, [], "every copy key the desk asks for exists in the page, so no sentence can render empty");
  const unfilled = used.filter((u) => !prefix(u) && copy.has(u.key) && [...copy.get(u.key)].some((v) => !u.vars.includes(v))).map((u) => u.file + ":" + u.key + " lacks " + [...copy.get(u.key)].filter((v) => !u.vars.includes(v)).join(","));
  eq(unfilled, [], "and every {placeholder} in a sentence is supplied where the sentence is used, so none prints as a brace");
}

console.log(`✓ flows-desk-audit: ${checks} assertions — the chain and strategy routes against stubbed vendor bodies: no previous close is a null and never the spot, the strategy engine prices off the regular close after hours with one bars read only when the state is not a regular print, and a report that precedes every possible sale is undetermined and says so`);
