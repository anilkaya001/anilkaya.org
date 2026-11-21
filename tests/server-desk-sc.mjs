import assert from "node:assert/strict";
import { gatherPages, chainCacheGet, chainCachePut, singleFlight, SC_MAX_PAGES, SC_WAVE, SC_PAGE_SIZE, SC_CHAIN_TTL_MS, SC_CHAIN_KEEP } from "../server/desk-sc.js";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

class Refused extends Error {}
const refused = (error) => error instanceof Refused;
const unwrap = (r) => (Array.isArray(r) ? r : (r && r.data) || []);
const rowsOf = (n, tag) => Array.from({ length: n }, (_, i) => ({ option_symbol: `${tag}-${i}` }));
const FULL = SC_PAGE_SIZE;

function world(sizes, { fail = new Set(), refuse = new Set() } = {}) {
  const asked = [];
  const inflight = { now: 0, max: 0 };
  const page = async (n) => {
    asked.push(n);
    inflight.now++;
    inflight.max = Math.max(inflight.max, inflight.now);
    await Promise.resolve();
    await Promise.resolve();
    inflight.now--;
    if (refuse.has(n)) throw new Refused();
    if (fail.has(n)) throw new Error("page " + n);
    return { data: rowsOf(n <= sizes.length ? sizes[n - 1] : 0, "p" + n) };
  };
  return { page, asked, inflight };
}

const run = async (mod, sizes, extra = {}, opts = {}) => {
  const w = world(sizes, extra);
  const out = await mod.gatherPages({ first: { data: rowsOf(sizes[0], "p1") }, page: w.page, unwrap, refused, ...opts });
  return { ...out, asked: w.asked, inflight: w.inflight };
};

const real = await import("../server/desk-sc.js");
const R = (...a) => run(real, ...a);

{
  const out = await R([120]);
  eq([out.rows.length, out.pages, out.failed, out.truncated, out.budget, out.asked], [120, 1, 0, false, false, []], "a short first page is the whole chain and asks for nothing more");
}

{
  const out = await R([FULL, FULL, 40]);
  eq([out.rows.length, out.pages, out.failed, out.truncated], [FULL * 2 + 40, 5, 0, false], "two full pages and a short one: the wave that found the short page was four calls wide, so five calls in all");
  eq(out.asked, [2, 3, 4, 5], "the first wave asks for four pages at once, and the short page ends the loop");
}

{
  const out = await R([FULL, FULL, FULL, FULL, FULL, FULL, FULL, 7]);
  eq([out.pages, out.truncated, out.rows.length], [9, false, FULL * 7 + 7], "seven full pages and a short eighth: two waves, not truncated");
  eq(out.asked, [2, 3, 4, 5, 6, 7, 8, 9], "waves are four pages wide");
  ok(out.inflight.max === SC_WAVE, `at most ${SC_WAVE} pages are in flight at once (${out.inflight.max})`);
}

{
  const out = await R(new Array(60).fill(FULL));
  eq(out.pages, SC_MAX_PAGES, "a chain that never ends stops at the page ceiling");
  eq(out.truncated, true, "and is reported as truncated");
  eq(out.rows.length, SC_MAX_PAGES * FULL, "with exactly the ceiling's rows");
  eq(Math.max(...out.asked), SC_MAX_PAGES, "no page past the ceiling was asked for");
  eq(out.asked.length, SC_MAX_PAGES - 1, "one feed call for each page after the first");
}

{
  const four = await R([FULL, FULL, FULL, FULL], {}, { maxPages: 4 });
  eq([four.pages, four.truncated], [4, true], "a ceiling of four with four full pages is truncated");
  const exact = await R([FULL, FULL, FULL, 10], {}, { maxPages: 4 });
  eq([exact.pages, exact.truncated], [4, false], "a ceiling of four with a short fourth page is the whole chain");
  const one = await R([FULL], {}, { maxPages: 1 });
  eq([one.pages, one.truncated, one.asked], [1, true, []], "a ceiling of one reads the first page only and says the chain was cut");
}

{
  const out = await R(new Array(6).fill(FULL), { fail: new Set([3]) });
  eq(out.failed, 1, "a page that fails (not a refusal) is counted");
  eq(out.truncated, false, "and ends the loop without calling the chain truncated");
  ok(out.rows.length >= FULL * 2, "the pages before it are kept");
  eq(out.asked.length, 4, "no wave is started after a failed page");
}

{
  const out = await R(new Array(6).fill(FULL), { refuse: new Set([4]) });
  eq(out.budget, true, "a refusal by the rate limiter mid-build is reported as the budget running out");
  ok(out.rows.length >= FULL * 2, "and the rows already read are kept, not thrown away");
  eq(out.failed, 0, "it is not counted as a failed page");
  eq(out.truncated, false, "and the chain is not called truncated by the page ceiling");
  const early = await R(new Array(6).fill(FULL), { refuse: new Set([2]) });
  eq([early.budget, early.rows.length], [true, FULL * 4], "a refusal on one page of a wave keeps the pages of that wave that were served");
}

{
  const map = new Map();
  chainCachePut(map, "AAA", { rows: [1] }, 1000);
  eq(chainCacheGet(map, "AAA", 1000 + SC_CHAIN_TTL_MS - 1).rows, [1], "a copy younger than the TTL is served");
  eq(chainCacheGet(map, "AAA", 1000 + SC_CHAIN_TTL_MS), null, "at the TTL it is gone");
  eq(map.size, 0, "and is removed");
  chainCachePut(map, "AAA", { rows: [1] }, 0);
  chainCachePut(map, "BBB", { rows: [2] }, 0);
  chainCachePut(map, "CCC", { rows: [3] }, 0);
  eq([...map.keys()], ["BBB", "CCC"], `only the newest ${SC_CHAIN_KEEP} tickers are kept`);
  chainCachePut(map, "BBB", { rows: [4] }, 5);
  chainCachePut(map, "DDD", { rows: [5] }, 5);
  eq([...map.keys()], ["BBB", "DDD"], "a refreshed ticker counts as the newest");
}

{
  const flights = new Map();
  let ran = 0;
  const release = [];
  const slow = () => new Promise((resolve) => { ran++; release.push(() => resolve("done")); });
  const a = singleFlight(flights, "k", slow);
  const b = singleFlight(flights, "k", slow);
  const c = singleFlight(flights, "other", async () => "other");
  await Promise.resolve();
  await Promise.resolve();
  eq(ran, 1, "two callers of one key share one run");
  eq(await c, "other", "another key runs on its own");
  release[0]();
  eq([await a, await b], ["done", "done"], "both get the one result");
  eq(flights.size, 0, "and the flight is forgotten once it settles");
  const bad = singleFlight(flights, "k", async () => { throw new Error("boom"); });
  let seen = null;
  try { await bad; } catch (e) { seen = e.message; }
  eq(seen, "boom", "a failure reaches every waiter");
  eq(flights.size, 0, "and does not leave the key locked");
  eq(await singleFlight(flights, "k", async () => "again"), "again", "so the next call runs afresh");
}

{
  const MUTANTS = [
    ["no page ceiling", [["while (more && pages < maxPages) {", "while (more) {"], ["const n = Math.min(wave, maxPages - pages);", "const n = wave;"]], "the ceiling"],
    ["waves one page wide", [["const n = Math.min(wave, maxPages - pages);", "const n = 1;"]], "the wave width"],
    ["truncation never reported", [["truncated: more && pages >= maxPages", "truncated: false"]], "the truncation flag"],
    ["a failed page does not end the loop", [["if (part === null) { failed++; more = false; continue; }", "if (part === null) { failed++; continue; }"]], "the failed page"],
    ["a refusal is a failed page", [["(refused(e) ? REFUSED : null)", "null"]], "the refusal"],
    ["a refusal is thrown away with the rows", [["if (part === REFUSED) { budget = true; more = false; continue; }", "if (part === REFUSED) throw new Error(\"refused\");"]], "the kept rows"],
    ["cache never expires", [["if (now - hit.at >= SC_CHAIN_TTL_MS) { map.delete(key); return null; }", ""]], "the TTL"],
    ["cache keeps everything", [["while (map.size > SC_CHAIN_KEEP) map.delete(map.keys().next().value);", ""]], "the eviction"],
    ["flight is never forgotten", [["if (flights.get(key) === promise) flights.delete(key);", ""]], "the flight"],
  ];
  const probes = async (mod) => {
    const bad = [];
    const never = await run(mod, new Array(60).fill(FULL));
    if (never.pages !== SC_MAX_PAGES || never.truncated !== true) bad.push("ceiling or truncation");
    const w = await run(mod, [FULL, FULL, FULL, FULL, FULL, FULL, FULL, 7]);
    if (JSON.stringify(w.asked) !== JSON.stringify([2, 3, 4, 5, 6, 7, 8, 9])) bad.push("wave");
    const f = await run(mod, new Array(6).fill(FULL), { fail: new Set([3]) });
    if (f.failed !== 1 || f.asked.length !== 4) bad.push("failed page");
    const r = await run(mod, new Array(6).fill(FULL), { refuse: new Set([4]) });
    if (r.budget !== true || r.failed !== 0 || r.rows.length < FULL * 2) bad.push("refusal");
    const one = await run(mod, [FULL], {}, { maxPages: 1 });
    if (one.asked.length !== 0 || one.truncated !== true) bad.push("single page");
    const map = new Map();
    mod.chainCachePut(map, "A", { rows: [] }, 0);
    if (mod.chainCacheGet(map, "A", SC_CHAIN_TTL_MS + 1) !== null) bad.push("ttl");
    mod.chainCachePut(map, "A", { rows: [] }, 0);
    mod.chainCachePut(map, "B", { rows: [] }, 0);
    mod.chainCachePut(map, "C", { rows: [] }, 0);
    if (map.size > SC_CHAIN_KEEP) bad.push("eviction");
    const flights = new Map();
    await mod.singleFlight(flights, "k", async () => { throw new Error("x"); }).catch(() => null);
    if (flights.size !== 0) bad.push("flight");
    return bad;
  };
  eq(await probes(real), [], "the unmutated module passes every probe the planted builds are judged by");
  for (const [name, transforms, what] of MUTANTS) {
    let bad;
    try { bad = await probes(await loadMutated("server/desk-sc.js", transforms, { salt: checks })); } catch (e) { bad = ["threw " + e.message]; }
    ok(bad.length > 0, `planted wrong build "${name}" is caught (${what}): ${bad.join(", ") || "NOT CAUGHT"}`);
  }
}

console.log(`server-desk-sc: ${checks} checks`);
