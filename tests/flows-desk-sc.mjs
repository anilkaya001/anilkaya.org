import assert from "node:assert/strict";
import { makeChain, coherentRegression } from "./lib/sc-chain.mjs";
import { chainWorld, route, routes, memoryCache, tokenBucket } from "./lib/sc-world.mjs";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

let instance = 0;
const freshWorker = async (rel = "../worker.js") => (await import(`${rel}?desk-sc=${++instance}`)).default;
const pinned = (ch) => ({ UW_NOW: new Date(ch.readMs).toISOString() });
const pathOf = (ch, extra = "") => `/api/flows/chain?t=${ch.ticker}&strategy=sc${extra}`;
const chainCalls = (calls) => calls.filter((c) => c.kind === "chain");

{
  const ch = coherentRegression();
  const worker = await freshWorker();
  const { world, calls } = chainWorld(ch);
  const out = await route(worker, pathOf(ch), world, pinned(ch));
  eq(out.res.status, 200, "the Short calls route answers");
  const row = out.body.rows.find((r) => r.symbol === ch.xSymbol);
  ok(!!row, "the call that ranks first on delta-adjusted collateral, at vendor row 1,200 on the third page, is in the answer");
  ok(row && (row.pk & 2) === 2, "marked as a delta-adjusted pick");
  eq(chainCalls(calls).map((c) => c.page), [1, 2, 3, 4, 5], "the first page, then one wave of four that ran past the end of a 1,500-row chain");
  eq(out.body.cut.pages, 5, "and the cut says how many calls were made");
  eq(out.body.strategy, "sc", "the payload names its strategy");
  ok(out.body.cut.nRaw === ch.rows.length, "the cut counts every contract read");
  ok(out.body.rows.length === out.body.cut.nOut && out.body.rows.length <= 480, "the rows sent are the rows counted and under the cap");
  eq(out.body.rankedBy, "annualized", "ranked on the annualised ratio");
  ok(Array.isArray(out.body.fwd) && out.body.fwd.length > 0, "forward records travel with the rows");
  ok(out.body.rows.every((r) => r.pk >= 1 && r.pk <= 7), "every row carries its convention bits");

  const old = chainWorld(ch);
  const oldOut = await route(await freshWorker(), `/api/flows/chain?t=${ch.ticker}&strategy=cc`, old.world, pinned(ch));
  eq(oldOut.res.status, 200, "the covered-call route answers on the same chain");
  ok(!oldOut.body.rows.some((r) => r.symbol === ch.xSymbol), "and does not carry that call: it ranks on the stock price and cuts at 120");
  ok(chainCalls(old.calls).length <= 2, "having read two pages at most");
}

{
  const ch = makeChain(5, { rows: 20000 });
  ok(ch.rows.length > 12 * 500, `a chain of ${ch.rows.length} rows is longer than twelve pages`);
  const run = async (env) => {
    const { world, calls } = chainWorld(ch);
    const out = await route(await freshWorker(), pathOf(ch, "&refresh=1"), world, { ...pinned(ch), ...env });
    return { out, calls: chainCalls(calls) };
  };
  const dflt = await run({});
  eq(dflt.calls.map((c) => c.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "twelve pages by default");
  eq([dflt.out.body.cut.pages, dflt.out.body.cut.truncated, dflt.out.body.truncated], [12, true, true], "reported as truncated");
  ok(dflt.out.body.cut.shed.some((x) => x.why === "input-ceiling" && x.n === 12), "and shed for the input ceiling");
  ok(dflt.out.body.cut.nRaw === 12 * 500, "twelve full pages were ranked");
  ok(dflt.out.body.rows.length <= 480, "no more than 480 rows leave the Worker");
  ok(dflt.out.bytes < 400 * 1024, `the payload is ${(dflt.out.bytes / 1024).toFixed(0)} KiB`);
  for (const [value, pages] of [["24", 24], ["4", 4], ["1", 1], ["12", 12]]) {
    const got = await run({ FLOWS_DESK_SC_PAGES: value });
    eq(got.calls.length, pages, `FLOWS_DESK_SC_PAGES=${value} reads ${pages} pages`);
  }
  for (const value of ["0", "-3", "25", "abc", "", "1.5e1x", "99"]) {
    const got = await run({ FLOWS_DESK_SC_PAGES: value });
    eq(got.calls.length, value === "1.5e1x" ? 1 : 12, `FLOWS_DESK_SC_PAGES=${JSON.stringify(value)} falls back to the default`);
  }
  const params = dflt.calls.map((c) => c.params);
  ok(params.every((p) => p.exclude_zero_oi_chains === "true" && p.min_dte === "0" && p.max_dte === "401" && p.limit === "500"), "every page asks for 500 contracts across zero to 401 days, without zero-open-interest chains");
  ok(params.every((p) => !("maybe_otm_only" in p)), "and never narrows to the out-of-the-money side: the pre-rank needs both");
  ok(!("page" in params[0]) && params.slice(1).every((p, i) => p.page === String(i + 2)), "the first page carries no page number and the rest count up");
}

{
  const ch = makeChain(7, { rows: 6000 });
  const worker = await freshWorker();
  const { world, calls } = chainWorld(ch);
  const cache = memoryCache();
  const first = await routes(worker, [pathOf(ch)], world, pinned(ch), { cache });
  const n = calls.length;
  ok(n > 4, `the first read made ${n} vendor calls`);
  const second = await routes(worker, [pathOf(ch, "&h=1&f=0.5")], world, pinned(ch), { cache });
  eq(calls.length, n, "other terms are answered from the snapshot: no vendor call at all");
  eq(second[0].body.cut.terms, { h: 1, f: 0.5 }, "and the cut names the new terms, not the cached ones");
  eq(first[0].body.cut.terms, { h: 0.3, f: 0.1 }, "while the first answer kept its own");
  ok(JSON.stringify(first[0].body.rows.map((r) => r.pk)) !== JSON.stringify(second[0].body.rows.map((r) => r.pk)) || first[0].body.rows.length !== second[0].body.rows.length, "the two answers are two rankings");
  const third = await routes(worker, [pathOf(ch)], world, pinned(ch), { cache });
  eq(calls.length, n, "the first terms again come from the stored answer");
  eq(third[0].res.headers.get("X-Chain-Cache"), "hit", "and say so");
  eq(JSON.stringify(third[0].body.rows), JSON.stringify(first[0].body.rows), "byte for byte");
  const fourth = await routes(worker, [pathOf(ch, "&h=1&f=0.5")], world, pinned(ch), { cache });
  eq(fourth[0].res.headers.get("X-Chain-Cache"), "hit", "each set of terms has its own stored answer");
  eq(fourth[0].body.cut.terms, { h: 1, f: 0.5 }, "and it is the right one");
  const refreshed = await routes(worker, [pathOf(ch, "&refresh=1")], world, pinned(ch), { cache });
  ok(refreshed[0].res.headers.get("X-Chain-Cache") === "throttled" || calls.length > n, "a refresh inside the floor is throttled to the stored copy, outside it reads again");
}

{
  const ch = makeChain(8, { rows: 6000 });
  const worker = await freshWorker();
  const { world, calls } = chainWorld(ch);
  await routes(worker, [pathOf(ch)], world, pinned(ch));
  const n = calls.length;
  await routes(worker, [pathOf(ch, "&refresh=1&h=0.5")], world, pinned(ch));
  ok(calls.length > n, "a refresh drops the snapshot and reads the vendor again");
  const m = calls.length;
  await routes(worker, [pathOf(ch, "&h=0.4")], world, pinned(ch));
  eq(calls.length, m, "and the snapshot it made serves the next terms");
  const real = Date.now;
  try {
    Date.now = () => real() + 61000;
    await routes(worker, [pathOf(ch, "&h=0.45")], world, pinned(ch));
    ok(calls.length > m, "a snapshot older than sixty seconds is read again");
  } finally { Date.now = real; }
}

{
  const ch = makeChain(9, { rows: 6000 });
  const worker = await freshWorker();
  const { world, calls } = chainWorld(ch);
  const got = await routes(worker, [pathOf(ch, "&h=0.3"), pathOf(ch, "&h=0.31"), pathOf(ch, "&h=0.32")], world, pinned(ch), { latencyMs: 8 });
  ok(got.every((g) => g.res.status === 200), "three simultaneous reads of one name with three sets of terms all answer");
  const pages = chainCalls(calls).map((c) => c.page).sort((a, b) => a - b);
  eq(new Set(pages).size, pages.length, "and each page was read once, not once per caller");
  eq(got.map((g) => g.body.cut.terms.h), [0.3, 0.31, 0.32], "each with its own terms");
}

{
  const ch = makeChain(10, { rows: 6000 });
  const worker = await freshWorker();
  const { world } = chainWorld(ch);
  for (const qs of ["&h=abc", "&h=0.04", "&h=1.01", "&f=-0.1", "&f=0.51", "&h=", "&f="]) {
    const out = await route(worker, pathOf(ch, qs), world, pinned(ch));
    eq([out.res.status, out.body.error && out.body.error.code], [400, "invalid_terms"], `${qs} is refused`);
  }
}

{
  const ch = makeChain(12, { rows: 6000 });
  const bucket = tokenBucket(7);
  const { world, calls } = chainWorld(ch);
  const worker = await freshWorker();
  const out = await route(worker, pathOf(ch), world, { ...pinned(ch), UW_ONDEMAND: bucket });
  eq(out.res.status, 200, "when the site's vendor budget runs out in the middle of a read the answer is still given");
  ok(out.body.rows.length > 0, "with the rows the pages already read produced");
  ok(out.body.cut.shed.some((x) => x.why === "budget"), "and the cut says the budget ran out");
  ok(out.body.cut.pages < 12, `after ${out.body.cut.pages} pages rather than the ceiling`);
  const again = chainWorld(ch);
  const full = await route(worker, pathOf(ch, "&h=0.31"), again.world, pinned(ch));
  ok(chainCalls(again.calls).length > 0, "the partial read was not kept as a snapshot: the next terms read the vendor again");
  ok(full.body.cut.nRaw > out.body.cut.nRaw, "and rank more of the chain");
  const none = await route(await freshWorker(), pathOf(ch), chainWorld(ch).world, { ...pinned(ch), UW_ONDEMAND: tokenBucket(0) });
  eq([none.res.status, none.body.error && none.body.error.code], [429, "rate_limited"], "a budget that is spent before the first page is a 429 for the member");
  void calls;
}

{
  const ch = makeChain(13, { rows: 3000 });
  const { world } = chainWorld(ch);
  const worker = await freshWorker();
  const sc = await route(worker, pathOf(ch), world, pinned(ch));
  const cc = await route(worker, `/api/flows/chain?t=${ch.ticker}&strategy=cc`, world, pinned(ch));
  const both = await route(worker, `/api/flows/chain?t=${ch.ticker}`, world, pinned(ch));
  eq([cc.body.strategy, both.body.strategy], ["cc", "both"], "the other strategies are served as before");
  ok(cc.body.cut === undefined && both.body.cut === undefined, "and carry no cut");
  ok(Array.isArray(cc.body.forwards) && Array.isArray(cc.body.fwd) && Array.isArray(sc.body.fwd), "the covered-call route gains forward records beside its forwards list");
  const a = cc.body.forwards.map((f) => f.expiry), b = cc.body.fwd.map((f) => f.expiry);
  eq(a, b, "for the same expiries");
}

{
  const scenarios = {
    ceiling: async (w) => {
      const ch = coherentRegression();
      const { world } = chainWorld(ch);
      const out = await route(w, pathOf(ch), world, pinned(ch));
      return !out.body.rows.some((r) => r.symbol === ch.xSymbol);
    },
    snapshot: async (w) => {
      const ch = makeChain(7, { rows: 3000 });
      const { world, calls } = chainWorld(ch);
      await routes(w, [pathOf(ch)], world, pinned(ch));
      const n = calls.length;
      await routes(w, [pathOf(ch, "&h=0.6")], world, pinned(ch));
      return calls.length > n;
    },
    flight: async (w) => {
      const ch = makeChain(9, { rows: 3000 });
      const { world, calls } = chainWorld(ch);
      await routes(w, [pathOf(ch, "&h=0.3"), pathOf(ch, "&h=0.31")], world, pinned(ch), { latencyMs: 8 });
      const pages = chainCalls(calls).map((c) => c.page);
      return new Set(pages).size !== pages.length;
    },
    narrowing: async (w) => {
      const ch = makeChain(7, { rows: 600 });
      const { world, calls } = chainWorld(ch);
      await route(w, pathOf(ch), world, pinned(ch));
      return chainCalls(calls).some((c) => "maybe_otm_only" in c.params);
    },
    partial: async (w) => {
      const ch = makeChain(12, { rows: 6000 });
      const first = await route(w, pathOf(ch), chainWorld(ch).world, { ...pinned(ch), UW_ONDEMAND: tokenBucket(7) });
      const again = chainWorld(ch);
      await route(w, pathOf(ch, "&h=0.31"), again.world, pinned(ch));
      return first.body.cut.shed.some((x) => x.why === "budget") && chainCalls(again.calls).length === 0;
    },
    refresh: async (w) => {
      const ch = makeChain(8, { rows: 3000 });
      const { world, calls } = chainWorld(ch);
      await routes(w, [pathOf(ch)], world, pinned(ch));
      const n = calls.length;
      await routes(w, [pathOf(ch, "&refresh=1&h=0.5")], world, pinned(ch));
      return calls.length === n;
    },
    terms: async (w) => {
      const ch = makeChain(7, { rows: 3000 });
      const out = await route(w, pathOf(ch, "&h=0.6&f=0.2"), chainWorld(ch).world, pinned(ch));
      return out.body.cut.terms.h !== 0.6;
    },
    ttl: async (w) => {
      const ch = makeChain(8, { rows: 3000 });
      const { world, calls } = chainWorld(ch);
      await routes(w, [pathOf(ch)], world, pinned(ch));
      const n = calls.length;
      const real = Date.now;
      try {
        Date.now = () => real() + 61000;
        await routes(w, [pathOf(ch, "&h=0.45")], world, pinned(ch));
      } finally { Date.now = real; }
      return calls.length === n;
    },
  };
  for (const [name, scenario] of Object.entries(scenarios)) eq(await scenario(await freshWorker()), false, `the correct build passes the ${name} scenario`);
  const mutants = [
    ["the page ceiling is two", "ceiling", [["? v : SC_PAGES_DEFAULT;", "? v : 2;"]]],
    ["the snapshot is never reused", "snapshot", [["let snap = chainCacheGet(state.scChains, ticker, Date.now());", "let snap = null;"]]],
    ["no single flight", "flight", [["snap = await singleFlight(state.scFlights, ticker, () => readShortCallSnapshot(env, ctx, vf, ticker));", "snap = await readShortCallSnapshot(env, ctx, vf, ticker);"]]],
    ["the out-of-the-money narrowing is back", "narrowing", [["exclude_zero_oi_chains: \"true\",\n    min_dte: 0,", "maybe_otm_only: \"true\",\n    exclude_zero_oi_chains: \"true\",\n    min_dte: 0,"]]],
    ["a partial read is kept as a snapshot", "partial", [["if (!snap.budget && snap.failed === 0) chainCachePut(state.scChains, ticker, snap, Date.now());", "chainCachePut(state.scChains, ticker, snap, Date.now());"]]],
    ["a refresh keeps the snapshot", "refresh", [["if (refresh) state.scChains.delete(ticker);", ""]]],
    ["the terms are ignored by the ranking", "terms", [["terms: { h: terms.haircut, f: terms.floor }", "terms: { h: 0.3, f: 0.1 }"]]],
    ["the snapshot lives for ten minutes", "ttl", [["chainCacheGet(state.scChains, ticker, Date.now())", "chainCacheGet(state.scChains, ticker, Date.now() - 540000)"]]],
  ];
  const survived = [];
  for (const [title, name, transforms] of mutants) {
    const mod = (await loadMutated("worker.js", transforms, { salt: ++instance })).default;
    if (!(await scenarios[name](mod))) survived.push(title);
    checks++;
  }
  eq(survived, [], `all ${mutants.length} planted wrong builds of the Short calls route are caught`);
}

console.log(`flows-desk-sc: ${checks} checks`);
