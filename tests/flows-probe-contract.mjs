import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as probe from "../scripts/flows-probe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const throwsLike = (fn, pattern, msg) => { assert.throws(fn, pattern, msg); checks++; };

const printedLabels = (lines) => lines.flatMap((l) => {
  const set = /^ {3}(?:fields|values) (.*?)  /.exec(l);
  const at = /^ {3}envelope .* rows \d+ at (.*)$/.exec(l);
  return set ? [set[1]] : at ? [at[1]] : [];
});
const DIGIT_RUN = /\d{4}/;

const KEY = "uwkey-7f3c9e1a-SECRET-4b2d-8e6f-0a1b2c3d4e5f";
const SESSION = "2026-09-22";
const list = probe.loadList();

{
  const byTier = { used: new Set(), 1: new Set(), 2: new Set() };
  const opTier = new Map();
  for (const p of list.probes) {
    byTier[p.tier].add(p.op);
    if (opTier.has(p.op)) eq(opTier.get(p.op), p.tier, `${p.op} carries one tier across its probes`);
    opTier.set(p.op, p.tier);
  }
  eq(byTier.used.size, 75, "every one of the 75 operations a production call site reads is probed and labelled used: the 38 labelled before and the 37 the nightly legs read that were still filed under Tiers 1 and 2");
  eq(byTier["1"].size, 1, "the one Tier 1 operation of the adoption plan that no code reads yet is probed");
  eq(byTier["2"].size, 11, "the three Tier 2 operations no code reads yet are probed, plus the eight entitlement probes, and Tier 3 is left out");
  for (const [op, names] of Object.entries(list.expect)) {
    eq(new Set(names).size, names.length, `${op}: the documented names are listed once each`);
  }
  ok(list.expect["/api/stock/{ticker}/greek-exposure/expiry"].includes("call_gex"),
     "the name that once differed from the spec, call_gex, is among the names the probe checks");

  const base = { id: "a", tier: "used", op: "/api/a", path: "/api/a" };
  throwsLike(() => probe.validateList({ version: 1, probes: [base, base] }), /duplicate id a/,
     "a duplicate id is refused");
  throwsLike(() => probe.validateList({ version: 1, probes: [{ ...base, tier: "3" }] }), /tier/,
     "a Tier 3 probe is refused; the list is trimmed to what is built on");
  throwsLike(() => probe.validateList({ version: 1, probes: [
    { ...base, id: "b", path: "/api/x/{s}", bind: { s: { from: "c", field: "f" } } },
    { ...base, id: "c" },
  ] }), /not an earlier probe/, "a probe cannot bind a value from a probe that runs after it");
  throwsLike(() => probe.validateList({ version: 1, probes: [
    base, { ...base, id: "b", bind: { s: { from: "a", field: "f" } } },
  ] }), /never uses it/, "a bound name must appear in the path it fills");
  throwsLike(() => probe.validateList({ version: 1, probes: [base], expect: { "/api/zzz": ["x"] } }),
     /no probe exercises/, "an expectation for an operation no probe calls is refused");
  throwsLike(() => probe.validateList({ version: 1, probes: [{ ...base, query: { n: 5 } }] }),
     /strings/, "query values are strings, so the URL is exactly what the list says");
  throwsLike(() => probe.validateList({ version: 1, probes: [base], liveOnly: ["/api/zzz"] }), /liveOnly/,
     "a live-only operation no probe calls is refused");
  throwsLike(() => probe.validateList({ version: 1, probes: [base], entitlement: ["/api/a"] }), /read by the code/,
     "an operation the code reads cannot be an entitlement question: its refusal is a failure");
  throwsLike(() => probe.validateList({ version: 1, probes: [{ ...base, tier: "2" }], entitlement: ["/api/a"], gated: { "/api/a": 403 } }),
     /both gated/, "an operation is either expected-gated or an open entitlement question, not both");
  throwsLike(() => probe.validateList({ version: 1, probes: [base], enums: { "/api/a": { f: ["x", "X"] } } }), /distinct/,
     "documented enum tokens are distinct regardless of case, since they are counted case-blind");
  throwsLike(() => probe.validateList({ version: 1, probes: [base], enums: { "/api/a": { f: ["a-b"] } } }), /distinct documented tokens/,
     "a documented token is one code of letters, digits and underscores, since a value is split on anything else");
  throwsLike(() => probe.validateList({ version: 1, probes: [{ ...base, tier: "2" }, { ...base, id: "b" }], entitlement: ["/api/a"] }),
     /read by the code/, "MIXED TIERS: one used probe of an operation is enough to refuse it as an entitlement question, whatever tier the last probe carries");
}

{
  const spec = new Set([...fs.readFileSync(path.join(ROOT, "docs/uw-openapi.yaml"), "utf8")
    .matchAll(/^ {2}(\/api\/[^\s:]+):$/gm)].map((m) => m[1]));
  ok(spec.size > 200, `the committed spec's operations are read from docs/uw-openapi.yaml (${spec.size})`);
  const listOps = [...new Set(list.probes.map((p) => p.op))];
  deep(listOps.filter((op) => !spec.has(op)).sort(), [...list.liveOnly].sort(),
    "LIVE ONLY: every probed operation the committed spec lacks is named in liveOnly, and nothing else is");
  deep(list.liveOnly.slice().sort(), ["/api/market/daily-report", "/api/stock/{ticker}/interpolated-iv/distribution",
    "/api/stock/{ticker}/volatility/context", "/api/stock/{ticker}/volatility/option-sentiment",
    "/api/stock/{ticker}/volatility/term-structure/distribution", "/api/volatility/option-sentiment/top"],
    "the five live-only operations the nightly reads, and the volatility context the reading wants");

  const files = spawnSync("git", ["ls-files", "worker.js", "shared", "scripts"], { cwd: ROOT, encoding: "utf8" }).stdout
    .split("\n").filter((f) => /\.m?js$/.test(f))
    .filter((f) => !/fake|live-day\.mjs$|flows-probe\.mjs$|flows-ws-probe\.mjs$/.test(f));
  ok(files.length > 40 && files.includes("worker.js") && files.includes("scripts/flows-pipeline.mjs"),
    `the production sources are scanned: worker.js, shared/ and scripts/ less the fakes and the probes (${files.length} files)`);
  const OWN = /^\/api\/(flows|rt|me|bootstrap|progress|stats|mastery|placement|v2|markets|auth)(\/|$)|^\/api\/?$/;
  const sites = new Map();
  const note = (tok, at) => { if (!OWN.test(tok)) sites.set(tok, [...(sites.get(tok) || []), at]); };
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    const routes = [...text.matchAll(/route: "([a-z-]+)"/g)].map((m) => m[1]);
    text.split("\n").forEach((line, i) => {
      if (!line.includes("/api/")) return;
      const s = line.replace(/\$\{[^}]*\}/g, "{X}").replace(/"\s*\+\s*[A-Za-z_][\w.()]*\s*\+\s*"/g, "{X}")
        .replace(/"\s*\+\s*[A-Za-z_][\w.()]*\s*(?=[,)])/g, '{X}"');
      for (const m of s.matchAll(/["'`](\/api\/[A-Za-z0-9_{}./:-]*)/g)) {
        const tok = m[1].split("?")[0].replace(/\/+$/, "");
        if (line.includes("${step.route}")) for (const r of new Set(routes)) note(tok.replace("{X}", r), `${f}:${i + 1}`);
        else note(tok, `${f}:${i + 1}`);
      }
    });
  }
  const segs = (p) => p.split("/");
  const fits = (op, tok) => {
    const a = segs(op);
    const b = segs(tok);
    return a.length === b.length && a.every((x, i) => (/^\{[^}]+\}$/.test(x) ? b[i] !== "" : x === b[i]));
  };
  const opOf = (tok) => listOps.filter((op) => fits(op, tok))
    .sort((x, y) => (x.match(/\{/g) || []).length - (y.match(/\{/g) || []).length)[0] || null;
  const tierOf = new Map(list.probes.map((p) => [p.op, p.tier]));
  const read = new Set();
  const unprobed = [];
  for (const [tok, at] of sites) {
    const op = opOf(tok);
    if (!op || tierOf.get(op) !== "used") unprobed.push(`${tok} (${at[0]}${op ? ", tier " + tierOf.get(op) : ""})`);
    else read.add(op);
  }
  deep(unprobed, [], "USED IS TRUE: every vendor path a production call site names has a probe labelled used");
  ok(sites.has("/api/earnings/premarket") && sites.has("/api/earnings/afterhours"),
    "including the two earnings calendars the events leg names through ${step.route}");
  deep(listOps.filter((op) => tierOf.get(op) === "used" && !read.has(op)), [],
    "and no operation is labelled used that no production call site reads");
  eq(read.size, 75, "75 operations are read in production");

  const entitled = list.entitlement;
  deep(entitled.slice().sort(), ["/api/congress/unusual-trades", "/api/futures/{contract}/stats", "/api/lit-flow/{ticker}",
    "/api/option-trades", "/api/stock/{ticker}/flow-per-strike-intraday", "/api/stock/{ticker}/quote",
    "/api/stock/{ticker}/stock-volume-price-levels", "/api/stock/{ticker}/volatility/context"],
    "ENTITLEMENT: the order-flow, quote, volatility-context, futures and unusual-congress routes are asked, not assumed");
  const tickers = ["AAPL", "NVDA"];
  const expanded = probe.expandProbes(list, tickers);
  const asked = expanded.filter((p) => entitled.includes(p.op)).map((p) => p.id);
  deep(asked, ["option-trades:AAPL", "option-trades:NVDA", "lit-flow:AAPL", "lit-flow:NVDA", "quote:AAPL", "quote:NVDA",
    "flow-per-strike-intraday:AAPL", "flow-per-strike-intraday:NVDA", "stock-volume-price-levels:AAPL",
    "stock-volume-price-levels:NVDA", "volatility-context:AAPL", "volatility-context:NVDA", "futures-stats", "congress-unusual"],
    "each per-name route is asked for AAPL and NVDA, the gold future and the unusual congressional trades once");
  ok(expanded.filter((p) => entitled.includes(p.op)).every((p) => p.entitlement && !p.gated),
    "and each carries the entitlement mark into its run");
  eq(expanded.length + 1, 170, "a weekly strict run is 169 list calls plus the session call: 14 more than the 156 before");
  ok(list.enums["/api/option-trades"].report_flags.includes("intermarket_sweep") &&
     list.enums["/api/option-trades"].upstream_condition_detail.includes("isoi"),
    "the sweep question is asked of both encodings the spec documents: report_flags and the OPRA code isoi");
  deep(Object.keys(list.enums["/api/lit-flow/{ticker}"]), ["trade_code", "sale_cond_codes", "ext_hour_sold_codes", "trade_settlement"],
    "and every enum the spec documents on a lit print is counted");
}

{
  deep(probe.dateTokens(SESSION), {
    date: "2026-09-22", "next-session": "2026-09-23", weekly: "2026-09-25",
    monthly: "2026-10-16", monthly2: "2026-11-20", "gold-front": "GCZ6",
  }, "one session date yields the weekly, the two monthlies, the next session and the front gold contract");
  for (const [day, want, why] of [
    ["2026-10-05", "GCZ6", "in October the front gold contract is December's, the one the list named by hand"],
    ["2026-11-20", "GCZ6", "ten days before December's first notice day it is still December"],
    ["2026-11-25", "GCZ6", "five days before the first notice day (Monday 2026-11-30) it is still December"],
    ["2026-11-26", "GCG7", "four days before it, the probe rolls to February"],
    ["2026-12-29", "GCG7", "so the probe never asks for GCZ6 once it has expired around 2026-12-29"],
    ["2027-01-26", "GCJ7", "February's notice day (Friday 2027-01-29) is three days out, so April"],
    ["2027-06-30", "GCQ7", "June delivered, August is the front"],
    ["2029-07-10", "GCQ9", "the year digit is the year's last digit"],
  ]) eq(probe.goldFront(day), want, `GOLD ROLL ${day}: ${why}`);
  eq(probe.lastWeekdayOf(2027, 1), "2027-01-29", "the first notice day is the last weekday of the month before delivery");
  eq(probe.lastWeekdayOf(2026, 5), "2026-05-29", "a month ending on a Sunday steps back to its Friday");
  eq(probe.thirdFriday(2026, 10), "2026-10-16", "third Friday of a month starting on Thursday");
  eq(probe.thirdFriday(2026, 5), "2026-05-15", "third Friday of a month starting on Friday");
  eq(probe.thirdFriday(2025, 4), "2025-04-18", "third Friday of a month starting on Tuesday");
  eq(probe.monthlyAtLeast("2026-10-02", 14), "2026-10-16", "exactly fourteen days out still counts");
  eq(probe.monthlyAtLeast("2026-10-03", 14), "2026-11-20", "thirteen days out rolls to the next monthly");
  eq(probe.fridayAfter("2026-09-25"), "2026-10-02", "the weekly after a Friday session is the next Friday");
  eq(probe.nextWeekday("2026-09-25"), "2026-09-28", "the session after a Friday is the Monday");
  eq(probe.addDays(SESSION, -365), "2025-09-22", "a year back is calendar days, not sessions");

  const guess = (iso) => probe.sessionGuess(new Date(iso));
  eq(guess("2026-09-22T19:59:00Z"), "2026-09-21", "15:59 Eastern: today is not complete yet");
  eq(guess("2026-09-22T20:00:00Z"), "2026-09-22", "16:00 Eastern: today is complete");
  eq(guess("2026-09-23T02:00:00Z"), "2026-09-22", "22:00 Eastern is still the Eastern day, not the UTC one");
  eq(guess("2026-09-26T18:00:00Z"), "2026-09-25", "a Saturday reads Friday");
  eq(guess("2026-09-28T13:00:00Z"), "2026-09-25", "Monday before the open reads Friday");
  eq(guess("2026-12-15T20:30:00Z"), "2026-12-14", "15:30 EST in winter is before the close");
  eq(guess("2026-12-15T21:00:00Z"), "2026-12-15", "16:00 EST in winter is the close");

  const candles = [{ start_time: "2026-09-21T13:30:00Z" }, { start_time: "2026-09-22T13:30:00Z" }];
  eq(probe.sessionFromCandles(candles, new Date("2026-09-22T19:00:00Z")), "2026-09-21",
     "an intraday candle for today is not a complete session");
  eq(probe.sessionFromCandles(candles, new Date("2026-09-22T20:05:00Z")), "2026-09-22",
     "after the close today's candle is the session");
  eq(probe.sessionFromCandles([...candles].reverse(), new Date("2026-09-23T13:32:00Z")), "2026-09-22",
     "row order does not matter");
  eq(probe.sessionFromCandles([{ date: "2026-09-18" }], new Date("2026-09-23T13:32:00Z")), "2026-09-18",
     "a candle dated only by `date` is read like the pipeline reads it");
  eq(probe.sessionFromCandles([], new Date()), null, "no candles, no session");
}

{
  const tickers = ["AAPL", "NVDA"];
  const dates = probe.dateTokens(SESSION);
  const all = probe.expandProbes(list, tickers).map((p) => probe.finalizeProbe(p, dates));
  const url = (id) => {
    const p = all.find((x) => x.id === id);
    assert.ok(p, `probe ${id} exists`);
    return probe.buildUrl(probe.DEFAULT_BASE, p.path, p.query);
  };
  for (const p of all) {
    const left = (p.path + JSON.stringify(p.query)).match(/\{[A-Za-z0-9-]+\}/g) || [];
    deep(left, Object.keys(p.bind).map((n) => `{${n}}`),
         `${p.id}: every token is filled except the ones bound at run time`);
  }
  const perTicker = new Map();
  for (const p of all.filter((x) => x.ticker)) perTicker.set(p.base, (perTicker.get(p.base) || 0) + 1);
  ok([...perTicker.values()].every((n) => n === tickers.length), "every per-name probe runs once per ticker");
  eq(new Set(all.map((p) => p.id)).size, all.length, "expanded ids are unique");

  eq(url("spot-exposures-expiry-strike:AAPL"),
     "https://api.unusualwhales.com/api/stock/AAPL/spot-exposures/expiry-strike?expirations%5B%5D=2026-09-25" +
     "&expirations%5B%5D=2026-10-16&expirations%5B%5D=2026-11-20&date=2026-09-22&limit=500",
     "an array parameter is sent as repeated keys, as the pipeline sends it");
  ok(url("screener-tickers").includes("ticker=AAPL%2CNVDA"), "a batch probe carries the whole ticker list once");
  ok(url("insider-transactions").includes("start_date=2026-06-22&end_date=2026-09-22"), "a quarter back");
  ok(url("shorts-data:NVDA").endsWith("/api/shorts/NVDA/data?newer_than=2026-09-15"), "a week back");
  ok(url("etf-flow-spy").includes("start_date=2025-09-22"), "a year back");
  ok(url("earnings-premarket").includes("date=2026-09-23"), "premarket reads the next session");
  ok(url("multi-leg-session").includes("newer_than=2026-09-22T14%3A30%3A00Z"),
     "a timestamp token fills inside a longer string");
  ok(url("rr-skew-25:AAPL").includes("expiry=2026-10-16&delta=25") &&
     url("rr-skew-025:AAPL").includes("delta=0.25"), "both readings of the ambiguous delta are sent");
  eq(all.find((p) => p.id === "contract-historic:NVDA").bind.symbol.from, "option-contracts:NVDA",
     "a bound value comes from the same ticker's source probe");

  const picked = probe.selectProbes(probe.expandProbes(list, tickers), "contract-historic").map((p) => p.id);
  deep(picked, ["option-contracts:AAPL", "option-contracts:NVDA", "contract-historic:AAPL", "contract-historic:NVDA"],
       "a filtered probe pulls in the probe its bound value comes from, in list order");
  deep(probe.selectProbes(probe.expandProbes(list, tickers), " max-pain:nvda , sector-etfs").map((p) => p.id),
       ["max-pain:NVDA", "sector-etfs"], "the filter is case-blind, comma-separated and matches expanded ids");
  eq(probe.needsSession(probe.selectProbes(probe.expandProbes(list, tickers), "seasonality")), false,
     "an undated probe needs no session");
  eq(probe.needsSession(probe.selectProbes(probe.expandProbes(list, tickers), "greek-flow")), true,
     "a dated probe needs one");
}

{
  eq(probe.buildUrl("https://x.test", "/api/a", { a: "", b: null, c: undefined, d: "1", e: ["x", "", null, "y"], f: 0 }),
     "https://x.test/api/a?d=1&e=x&e=y&f=0", "empty values are skipped, zero is kept, arrays repeat");
  deep(probe.vendorHeaders("K"), { Authorization: "Bearer K", Accept: "application/json" },
       "the probe sends exactly the pipeline's two vendor headers");

  const src = fs.readFileSync(path.join(ROOT, "scripts/flows-pipeline.mjs"), "utf8");
  const baseLine = /const BASE = process\.env\.(\w+) \|\| "([^"]+)"/.exec(src);
  ok(baseLine, "the pipeline still names its vendor base URL in one line");
  eq(baseLine[1], probe.BASE_ENV, "the probe honours the pipeline's base-URL override");
  eq(baseLine[2], probe.DEFAULT_BASE, "and defaults to the same vendor host");
  const start = src.indexOf("async function uw(");
  ok(start > 0, "the pipeline's vendor helper is still uw()");
  const uwBody = src.slice(start, src.indexOf("\n}\n", start));
  ok(/Authorization:\s*"Bearer "\s*\+\s*process\.env\.UW_API_KEY/.test(uwBody),
     "the pipeline authenticates with the same Bearer header the probe sends");
  ok(/Accept:\s*"application\/json"/.test(uwBody), "and asks for the same content type");
  ok(!/User-Agent/i.test(uwBody),
     "and sets no User-Agent, so the probe sets none either: the vendor sees the runtime default from both");
  ok(/url\.searchParams\.append\(k, String\(item\)\)/.test(uwBody) &&
     /url\.searchParams\.set\(k, String\(v\)\)/.test(uwBody),
     "the pipeline builds arrays and scalars into the query the way buildUrl does");
}

{
  const redact = probe.makeRedactor(KEY);
  eq(redact(`x ${KEY} y ${KEY}`), `x ${probe.REDACTED} y ${probe.REDACTED}`, "every occurrence is redacted");
  eq(redact("Authorization: Bearer abc.def-123"), `Authorization: Bearer ${probe.REDACTED}`,
     "any bearer credential is redacted, the key or not");
  eq(probe.makeRedactor("")("abc"), "abc", "an empty secret redacts nothing and mangles nothing");
  const odd = 'k"e\\y/with?quote&0123456789';
  const r2 = probe.makeRedactor(odd);
  for (const form of [odd, JSON.stringify(odd).slice(1, -1), encodeURIComponent(odd)]) {
    ok(!r2(`<${form}>`).includes(form), `the ${form === odd ? "raw" : "escaped"} form of the key is redacted`);
  }

  const row = { pad: "x".repeat(670), echo: KEY, px: "187.25" };
  const analysed = probe.analyse({ id: "s", tier: "used", op: "/x", expect: null },
    { url: "https://x.test/s", status: 200, ms: 1, text: JSON.stringify({ data: [row] }) }, redact);
  ok(!("sample" in analysed) && probe.SAMPLE_CHARS === undefined, "no sample row is kept or printed: the log is public");
  const printed = probe.renderBlock(analysed).join("\n");
  ok(!printed.includes("187.25") && !printed.includes("xxxx") && !printed.includes(KEY.slice(0, 8)),
     "so neither a vendor value nor the key reaches the block");
  eq(probe.vendorError({ rows: [{ px: "187.25" }], n: 3 }, "", redact), "body {rows:[1],n:num}",
     "an error body with no message is described by its shape, not printed");
}

{
  for (const [v, want] of [["1.25", true], ["-0.5", true], [".5", true], ["2.5e6", true], ["1e-3", true],
    [" 12 ", true], ["", false], ["1,000", false], ["NaN", false], ["Infinity", false], ["0x10", false],
    ["2026-09-22", false], [12, false]]) {
    eq(probe.isNumericString(v), want, `${JSON.stringify(v)} ${want ? "is" : "is not"} a numeric string`);
  }
  const rows = [
    { a: "1.25", b: 3, c: null, d: "2026-09-22", e: "2.5e6", f: "", g: true, h: { x: 1 }, i: [1] },
    { a: "abc", b: 4, c: "7" },
    { a: "-0.5", b: 5, c: 1 },
    { a: "3", b: 6 },
    { a: ".5", b: 7 },
    { a: "9", b: 8, late: 1 },
  ];
  const u = probe.unionKeys(rows);
  eq(u.sampled, 6, "every row is typed, up to the 500 a probe asks for, so a fill count means something");
  eq(probe.unionKeys(rows, 5).sampled, 5, "and the cap holds");
  deep(u.fields.map((f) => probe.formatField(f, u.objects)),
       ["a:str#|str", "b:num", "c:null|str#|num?(2/6)", "d:str?(1/6)", "e:str#?(1/6)", "f:str?(0/6)", "g:bool?(1/6)",
        "h:obj?(1/6)", "i:arr?(1/6)", "late:num?(1/6)"],
       "each key carries every JS type seen, str# for a number sent as a string, ? when some rows lack it, and " +
         "(n/m) when only n of m rows fill it: null, an empty string and an empty list are not filled");
  deep(probe.unionKeys(["A", "B", 3]).scalars, ["str", "num"], "scalar rows are typed as values");
}

{
  const cases = [
    [{ data: [{ a: 1 }], date: "2026-09-22" }, "data[]", 1, "{data:[1],date:str}"],
    [[{ a: 1 }, { a: 2 }], "[]", 2, "[2]"],
    [{ si: [{ x: 1 }] }, "si[]", 1, "{si:[1]}"],
    [{ chains: [{ x: 1 }], ticker: "AAPL" }, "chains[]", 1, "{chains:[1],ticker:str}"],
    [{ data: { latest: { v: 1, w: 2 }, history: [{ d: 1 }, { d: 2 }] } }, "data.history[]", 2,
     "{data:{latest:{2},history:[2]}}"],
    [{ data: { call_wall: "250", put_wall: "200" } }, "data", 1, "{data:{2}}"],
    [{ alert: { id: "x" }, has_more: false, trades: [{ p: 1 }] }, "trades[]", 1,
     "{alert:{id:str},has_more:bool,trades:[1]}"],
    [{ data: [] }, "data[]", 0, "{data:[0]}"],
    [{ call_wall: "250" }, "$", 1, "{1}"],
    [null, "none", 0, "null"],
  ];
  for (const [body, label, count, shape] of cases) {
    const located = probe.locateRows(body);
    eq(probe.rowsLabel(located), label, `${JSON.stringify(body)}: rows are found at ${label}`);
    eq(located.rows.length, count, `${JSON.stringify(body)}: ${count} rows`);
    eq(probe.envelopeShape(body, located), shape, `${JSON.stringify(body)}: envelope ${shape}`);
  }
  const labels = (body) => probe.fieldSets(body).map((s) => s.label);
  deep(labels({ data: { latest: { v: 1 }, history: [{ d: 1 }] } }), ["data.history[]", "data.latest"],
       "an object beside the rows is typed too, so {latest, history} shows both halves");
  deep(labels({ data: [{ group: "all", data: [{ t: 1, v: "2" }] }] }), ["data[]", "data[].data[]"],
       "rows nested inside rows are typed one level down");
  deep(labels({ alert: { id: "x" }, trades: [{ p: 1 }] }), ["trades[]", "alert"],
       "the flow-alert shape types its alert and its trades");

  const expect = ["call_gex", "put_gex", "expiry"];
  const body = { data: [{ call_gamma: "1.5", put_gex: "-2", expiry: "2026-10-16" }] };
  const analysed = probe.analyse({ id: "g", tier: "used", op: "/g", expect },
    { url: "https://x.test/g", status: 200, ms: 1, text: JSON.stringify(body) }, probe.makeRedactor(KEY));
  deep(analysed.spec.unseen, ["call_gex"], "a documented name the live rows do not carry is reported unseen");
  deep(analysed.spec.undocumented, ["call_gamma"], "and the name they carry instead is reported undocumented");
  eq(analysed.cls, "ok", "a body with rows is ok");
  const empty = probe.analyse({ id: "e", tier: "used", op: "/e", expect: null },
    { url: "https://x.test/e", status: 200, ms: 1, text: '{"data":[],"date":"2026-09-22"}' }, probe.makeRedactor(KEY));
  eq(empty.cls, "empty", "a 200 with no rows is empty, not ok");
  const half = probe.analyse({ id: "h", tier: "used", op: "/h", expect: null },
    { url: "https://x.test/h", status: 200, ms: 1, text: '{"data":{"latest":{"v":1},"history":[]}}' }, probe.makeRedactor(KEY));
  eq(half.cls, "ok", "an empty history beside a filled latest is not empty");
  const text = probe.analyse({ id: "t", tier: "used", op: "/t", expect: null },
    { url: "https://x.test/t", status: 200, ms: 1, text: "<html>" }, probe.makeRedactor(KEY));
  eq(text.cls, "empty", "a 200 that is not JSON counts as empty");

  const csv = "ticker,price,size\nAAPL,187.25,400\nNVDA,121.10,900\n";
  const csvResult = probe.analyse({ id: "c", tier: "2", op: "/c", expect: null },
    { url: "https://x.test/c", status: 200, ms: 1, bytes: csv.length, text: csv }, probe.makeRedactor(KEY));
  const csvBlock = probe.renderBlock(csvResult).join("\n");
  for (const value of ["AAPL", "187.25", "400", "121.10", "900", "ticker,price"]) {
    ok(!csvBlock.includes(value), `NOT JSON: a 200 CSV body's ${value} reaches no printed line`);
  }
  ok(csvBlock.includes(`body ${csv.length} B, not JSON: no part of it is printed`),
    "a 2xx body that does not parse is described by its size alone");
  const page = probe.analyse({ id: "p", tier: "2", op: "/p", expect: null },
    { url: "https://x.test/p", status: 502, ms: 1, text: "<html>Bad gateway</html>" }, probe.makeRedactor(KEY));
  ok(probe.renderBlock(page).join("\n").includes("error <html>Bad gateway</html>"),
    "while a non-2xx error page is still clipped into the block, since it is the vendor's own error and not its data");

  const keyed = { data: { "187.50": 1200, "190.00": 800, as_of: "2026-09-22" } };
  const keyedResult = probe.analyse({ id: "k", tier: "2", op: "/k", expect: null },
    { url: "https://x.test/k", status: 200, ms: 1, text: JSON.stringify(keyed) }, probe.makeRedactor(KEY));
  const keyedBlock = probe.renderBlock(keyedResult).join("\n");
  ok(!keyedBlock.includes("187.50") && !keyedBlock.includes("190.00") && !keyedBlock.includes("1200"),
    "VALUE KEYS: a body keyed by price prints no price, as a field name or in the envelope");
  ok(keyedBlock.includes("<2 value-shaped keys>") && keyedBlock.includes("as_of:str"),
    "the value-shaped keys are counted and the named keys beside them still typed");
  const onlyValues = probe.analyse({ id: "v", tier: "2", op: "/v", expect: null },
    { url: "https://x.test/v", status: 200, ms: 1, text: JSON.stringify({ data: { "187.50": 1200 } }) }, probe.makeRedactor(KEY));
  eq(onlyValues.cls, "ok", "a body keyed by values alone still arrived: it is ok, not empty");
  ok(probe.renderBlock(onlyValues).includes("   spec not compared: the list holds no documented names for this operation"),
    "an operation with no expect list says the list holds none, not that the spec documents no shape");
  const leaky = [
    [{ data: { "2026-10-02": { close: "187.50" }, "2026-10-03": { close: "188.10" } } },
      "data.<2 value-shaped keys>", "a body keyed by date under data folds its rows into one set"],
    [{ "2026-10-02": [{ close: "1" }], meta: 1 }, "<value-shaped key>[]", "rows found under a date are located without naming it"],
    [{ data: { "2026-10-02": [{ close: "1" }] } }, "data.<value-shaped key>[]", "and so are rows under a date inside data"],
    [{ data: [{ close: "1", AAPL261016C00200000: { bid: "1.2" } }] }, "data[].<1 value-shaped key>",
      "an object under a contract inside a row is typed under a counted label"],
    [{ data: [{ close: "1", "2026-10-02": [{ bid: "1.2" }] }] }, "data[].<1 value-shaped key>[]",
      "rows under a date inside a row are typed under a counted label"],
    [{ data: [{ close: "1" }], "187.50": { size: 3 } }, "<1 value-shaped key>", "an envelope object under a price is typed under a counted label"],
  ];
  for (const [body, label, why] of leaky) {
    const result = probe.analyse({ id: "l", tier: "2", op: "/l", expect: ["close"] },
      { url: "https://x.test/l", status: 200, ms: 1, text: JSON.stringify(body) }, probe.makeRedactor(KEY));
    const printed = probe.renderBlock(result);
    ok(printedLabels(printed).includes(label), `LABELS: ${why} (${label})`);
    const leaked = printed.filter((l) => ["2026-10-02", "2026-10-03", "187.50", "188.10", "AAPL261016C00200000"].some((v) => l.includes(v)));
    deep(leaked, [], `LABELS: ${JSON.stringify(body)} prints no date, price or contract as a set or row label`);
    deep(printedLabels(printed).filter((l) => DIGIT_RUN.test(l)), [], `LABELS: no printed label of ${JSON.stringify(body)} has four digits in a row`);
  }
  deep(probe.fieldSets({ data: { AAPL: { close: "1" }, "2026-10-02": { close: "2" }, "2026-10-03": { close: "3" } }, x: { a: 1 } })
    .map((s) => s.label), ["data", "x", "data.AAPL", "data.<2 value-shaped keys>"],
    "a name-shaped key keeps its own set, and the value-shaped keys beside it share one counted set");
  const specOps = new Set([...fs.readFileSync(path.join(ROOT, "docs/uw-openapi.yaml"), "utf8")
    .matchAll(/^ {2}(\/api\/[^\s:]+):$/gm)].map((m) => m[1]));
  deep(list.entitlement.filter((op) => specOps.has(op) && !list.expect[op]), [],
    "EXPECT: every entitlement operation the committed spec documents has its documented names listed, so a missing one is named UNSEEN");
  ok(list.expect["/api/lit-flow/{ticker}"].includes("nbbo_bid_quantity") && list.expect["/api/option-trades"].includes("report_flags"),
    "among them the NBBO sizes P2-35 asks about and the report flags C-26 asks about");
  ok(Object.keys(list.reads).every((op) => !list.entitlement.includes(op)),
    "and none of them is in reads: their drift is informational, never a strict failure");
  eq(probe.envelopeShape({ data: [{ a: 1 }], levels: { "187.50": 1, "190.00": 2 }, "2026-09-22": 3 }),
    "{data:[1],levels:{<2 value-shaped keys>},<1 value-shaped key>}",
    "the envelope collapses them the same way");
  eq(probe.vendorError({ errors: { "AAPL261016C00200000": "bad" }, rows: [] }, "", probe.makeRedactor(KEY)),
    "body {errors:{<1 value-shaped key>},rows:[0]}",
    "and so does an error body described by its shape, where a key with a run of four digits (a contract, a date) counts as a value");
  ok(["implied_move_365", "macd_12_26_9", "rv_1d_last_12q", "eps_growth_16q", "call_gex"].every(probe.isNameShaped) &&
     !["187.50", "AAPL261016C00200000", "2026-09-22", "x-y"].some(probe.isNameShaped),
    "the spec's own digit-bearing names stay names (none of its 945 property names has four digits in a row)");
}

{
  eq(probe.retryAfterMs("2", 1), 2000, "Retry-After in seconds is honoured");
  eq(probe.retryAfterMs("120", 1), probe.MAX_RETRY_AFTER_MS, "and capped");
  eq(probe.retryAfterMs(null, 1), 2000, "absent, the wait doubles per attempt");
  eq(probe.retryAfterMs(null, 2), 4000, "and doubles again");
  eq(probe.retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", 1), 2000, "a date form falls back to the doubling");

  const wrapped = probe.wrapLabelled("   limits ", Array.from({ length: 12 }, (_, i) => `x-uw-counter-${i}=${i}`), 60);
  ok(wrapped.length > 1 && wrapped[0].startsWith("   limits x-uw-counter-0=0"), "a long row wraps");
  ok(wrapped.slice(1).every((l) => l.startsWith(" ".repeat("   limits ".length)) && !l.includes("limits")),
     "and its continuation lines are indented under the first token, not labelled again");
  eq(probe.wrapLabelled("   ok      14  ", [])[0], "   ok      14", "an empty row keeps its label and drops the gap");

  let t = 0;
  const pace = probe.makePacer(probe.MIN_GAP_MS, { now: () => t, sleep: async (ms) => { t += ms; } });
  const starts = [];
  await pace(); starts.push(t);
  await pace(); starts.push(t);
  t += 400;
  await pace(); starts.push(t);
  deep(starts, [0, 250, 650], "call starts are at least 250 ms apart, and a slow call is not charged twice");
}

function fakeHeaders(entries) {
  return new Headers(entries);
}

function fakeVendor({ clockStep = 40 } = {}) {
  const state = { t: 0, calls: [], sleeps: [], tideAttempts: 0 };
  const reply = (status, body, headers = {}) => ({
    status,
    headers: fakeHeaders({ "content-type": "application/json", ...headers }),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  state.fetch = async (url, init) => {
    state.calls.push({ url, at: state.t, headers: init.headers });
    state.t += clockStep;
    const u = new URL(url);
    const p = u.pathname;
    if (p === "/api/stock/SPY/ohlc/1d") {
      return reply(200, { data: [{ start_time: "2026-09-21T13:30:00Z" }, { start_time: "2026-09-22T13:30:00Z" }] });
    }
    if (p.endsWith("/greek-flow")) {
      return reply(200, { data: [{ timestamp: "2026-09-22T14:00:00Z", dir_delta_flow: "12.5", echo: KEY }] }, {
        "x-ratelimit-remaining": "117",
        "x-uw-daily-req-count": "42",
        "x-ratelimit-debug": "y".repeat(60) + KEY,
        "x-echo-auth": "Bearer " + KEY,
      });
    }
    if (p === "/api/stock/AAPL/option-contracts") {
      return reply(200, { data: [
        { option_symbol: "AAPL261016C00250000", open_interest: 10 },
        { option_symbol: "AAPL261016C00200000", open_interest: "90000" },
      ] });
    }
    if (p === "/api/stock/NVDA/option-contracts") return reply(200, { data: [] });
    if (p.startsWith("/api/option-contract/")) return reply(200, { chains: [{ date: "2026-09-22", iv: "0.31" }] });
    if (p === "/api/volatility/vix-term-structure") {
      return reply(403, { code: "volatility_scope_required", message: "needs the volatility add-on" });
    }
    if (p === "/api/market/daily-report") return reply(500, `Internal error while reading token ${KEY}`);
    if (p === "/api/market/fda-calendar") throw new TypeError("fetch failed");
    if (p === "/api/market/market-tide") {
      state.tideAttempts += 1;
      if (state.tideAttempts === 1) return reply(429, { message: "slow down" }, { "retry-after": "2" });
      return reply(200, { data: [{ net_call_premium: "1", date: SESSION }] });
    }
    return reply(404, { message: "no route" });
  };
  state.now = () => state.t;
  state.sleep = async (ms) => { state.sleeps.push(ms); state.t += ms; };
  return state;
}

const mini = probe.validateList({
  version: 1,
  probes: [
    { id: "flow", tier: "used", op: "/api/stock/{ticker}/greek-flow", path: "/api/stock/{t}/greek-flow", query: { date: "{date}" } },
    { id: "chain", tier: "used", op: "/api/stock/{ticker}/option-contracts", path: "/api/stock/{t}/option-contracts", query: { limit: "500" } },
    { id: "historic", tier: "2", op: "/api/option-contract/{id}/historic", path: "/api/option-contract/{symbol}/historic",
      query: { limit: "60" }, bind: { symbol: { from: "chain", field: "option_symbol", maxBy: "open_interest" } } },
    { id: "gated", tier: "1", op: "/api/volatility/vix-term-structure", path: "/api/volatility/vix-term-structure" },
    { id: "broken", tier: "1", op: "/api/market/daily-report", path: "/api/market/daily-report", query: { date: "{date}" } },
    { id: "offline", tier: "2", op: "/api/market/fda-calendar", path: "/api/market/fda-calendar" },
    { id: "limited", tier: "used", op: "/api/market/market-tide", path: "/api/market/market-tide", query: { date: "{date}" } },
  ],
  expect: {
    "/api/stock/{ticker}/greek-flow": ["timestamp", "dir_delta_flow", "call_gex"],
    "/api/stock/{ticker}/option-contracts": ["option_symbol", "open_interest"],
  },
});

{
  const vendor = fakeVendor();
  const lines = [];
  const run = await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL", "NVDA"], filter: "", list: mini },
    { fetch: vendor.fetch, log: (line) => lines.push(line), now: vendor.now, sleep: vendor.sleep,
      clock: () => new Date("2026-09-23T13:32:00Z") });
  const out = lines.join("\n");

  for (const line of lines) {
    assert.ok(!line.includes(KEY), `a printed line carries the key: ${line}`);
    assert.ok(!line.includes(KEY.slice(0, 12)), `a printed line carries part of the key: ${line}`);
  }
  checks++;
  ok(lines.length > 20, "and the run printed enough lines for that to mean something");
  ok(!/x-echo-auth=/.test(out), "a header that is not a rate-limit header never has its value printed");
  ok(out.includes("x-ratelimit-remaining=117") && out.includes("x-uw-daily-req-count=42"),
     "rate-limit headers are printed, including the vendor's own x-uw- counters");
  ok(out.includes(`x-ratelimit-debug=${"y".repeat(60)}${probe.REDACTED}`),
     "a rate-limit header value is redacted before its 80-character clip, so the clip cannot cut the key in half");

  for (const call of vendor.calls) {
    deep(call.headers, { Authorization: "Bearer " + KEY, Accept: "application/json" },
         "every call sends the pipeline's auth and accept headers and nothing else");
  }
  const gaps = vendor.calls.slice(1).map((c, i) => c.at - vendor.calls[i].at);
  ok(gaps.every((g) => g >= probe.MIN_GAP_MS), `calls are at least 250 ms apart (${gaps.join(", ")})`);

  eq(run.session, SESSION, "the session is the latest complete SPY daily candle");
  eq(vendor.calls[0].url, "https://vendor.test/api/stock/SPY/ohlc/1d?timeframe=1M",
     "the session is resolved first, with the call the pipeline makes for it");
  ok(vendor.calls.some((c) => c.url === "https://vendor.test/api/stock/AAPL/greek-flow?date=2026-09-22"),
     "dated probes read that session");
  ok(vendor.calls.some((c) => c.url === "https://vendor.test/api/option-contract/AAPL261016C00200000/historic?limit=60"),
     "the bound contract is the largest open interest, even when the vendor sends it as a string");

  const cls = Object.fromEntries(run.results.map((r) => [r.id, r.cls]));
  deep(cls, {
    "session:SPY": "ok", "flow:AAPL": "ok", "flow:NVDA": "ok", "chain:AAPL": "ok", "chain:NVDA": "empty",
    "historic:AAPL": "ok", "historic:NVDA": "skipped", gated: "4xx", broken: "5xx", offline: "network", limited: "ok",
  }, "each probe lands in its class");
  eq(run.results.find((r) => r.id === "limited").limited, 1, "a 429 is retried and counted");
  ok(vendor.sleeps.includes(2000), "after waiting the Retry-After the vendor asked for");
  eq(run.code, 0, "an informational run with failures still exits 0");

  ok(out.includes("spec 1 of 3 documented names UNSEEN"), "a documented name the vendor did not send is flagged");
  ok(/^ {3}drift +2 {2}flow:AAPL \(1 unseen\) {2}flow:NVDA \(1 unseen\)$/m.test(out),
     "and the summary names every probe that drifted");
  ok(/== chain:NVDA[^\n]*\n(?: {3}[^\n]*\n)*? {3}spec unchecked: no rows arrived/.test(out) &&
     !/chain:NVDA \(\d+ unseen\)/.test(out),
     "an empty answer is not drift: no rows is not evidence that a name was renamed");
  ok(/== chain:AAPL[^\n]*\n(?: {3}[^\n]*\n)*? {3}spec all 2 documented names seen/.test(out),
     "a probe whose names all arrived says so");
  ok(/^ {3}4xx +1 {2}gated 403 volatility_scope_required$/m.test(out), "a plan refusal is summarised with its code");
  ok(out.includes("code=volatility_scope_required"), "and its block prints the vendor's code");
  ok(/^ {3}skipped +1 {2}historic:NVDA \(no option_symbol from chain:NVDA\)$/m.test(out),
     "an unresolvable binding is skipped with its reason, not called with a hole in the path");
  ok(out.includes("envelope {chains:[1]}  rows 1 at chains[]"), "rows under chains are found and counted");
  ok(out.includes("fields data[]  3 keys over 1 of 1 sampled") &&
     out.includes("timestamp:str  dir_delta_flow:str#  echo:str"), "the key union is printed with types");
  ok(!out.includes("   sample "), "no sample row is printed");
  for (const value of ["12.5", "2026-09-22T14:00:00Z", "AAPL261016C00200000", "0.31", "90000"]) {
    ok(!out.includes(value), `the vendor value ${value} reaches no printed line`);
  }
  ok(out.includes("GET /api/option-contract/{symbol}/historic?limit=60"),
     "a path filled from a vendor row is printed with its template name, not the contract the vendor sent");
  const names = ["timestamp", "dir_delta_flow", "echo", "option_symbol", "open_interest", "date", "iv", "net_call_premium", "start_time"];
  const valueAfterName = new RegExp(`\\b(${names.join("|")})"?\\s*[:=]\\s*"?[-+.]?\\d`);
  deep(lines.filter((l) => !l.startsWith("   GET ") && valueAfterName.test(l)), [],
    "VALUE-FREE: no printed line has a digit-bearing value after a field name (the request line prints our own query, " +
      "and the one vendor value it could carry, a bound contract, is checked above)");
  deep(printedLabels(lines).filter((l) => DIGIT_RUN.test(l)), [],
    "VALUE-FREE: no fields, values or rows-at label carries a run of four digits (a date, a price, a contract)");
  ok(/^== summary {2}session 2026-09-22 {2}10 calls {2}1 x 429/m.test(out), "the summary counts calls and 429s");
  for (const cls of ["ok", "empty", "4xx", "5xx"]) {
    ok(new RegExp(`^ {3}${cls} +\\d+`, "m").test(out), `the summary always shows the ${cls} row`);
  }
}

{
  const vendor = fakeVendor();
  const auth = async (url, init) => {
    await vendor.fetch(url, init);
    return { status: 401, headers: new Headers(), text: async () => JSON.stringify({ reason: "malformed_token" }) };
  };
  const lines = [];
  const run = await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL"], filter: "", list: mini },
    { fetch: auth, log: (l) => lines.push(l), now: vendor.now, sleep: vendor.sleep,
      clock: () => new Date("2026-09-23T13:32:00Z") });
  eq(run.code, 1, "when every call fails the key is broken, and the probe exits 1");
  ok(lines.some((l) => l.includes("reason=malformed_token")), "and prints the vendor's reason");
  eq(run.session, SESSION, "a failed session probe falls back to the Eastern calendar");

  const echoed = [];
  await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL"], filter: `gated,${KEY}`, date: SESSION, list: mini },
    { fetch: vendor.fetch, log: (l) => echoed.push(l), now: vendor.now, sleep: vendor.sleep });
  ok(echoed.length > 3 && echoed.every((l) => !l.includes(KEY)) && echoed[0].includes(probe.REDACTED),
     "the printer redacts every line as it leaves, so text that never passed a field-level redaction is covered too");

  const offline = await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL"], filter: "flow", date: SESSION, list: mini },
    { fetch: async () => { throw new TypeError("fetch failed"); }, log: () => {}, now: vendor.now, sleep: vendor.sleep });
  eq(offline.code, 1, "a run where nothing answered exits 1");
}

{
  const vendor = fakeVendor();
  const lines = [];
  await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL"], filter: "gated", list: mini },
    { fetch: vendor.fetch, log: (l) => lines.push(l), now: vendor.now, sleep: vendor.sleep,
      clock: () => new Date("2026-09-23T13:32:00Z") });
  deep(vendor.calls.map((c) => new URL(c.url).pathname), ["/api/volatility/vix-term-structure"],
       "an undated selection spends no call on resolving the session");

  const dry = await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL", "NVDA"], filter: "", dryRun: true, date: SESSION, list: mini },
    { fetch: async () => { throw new Error("a dry run called the vendor"); }, log: (l) => lines.push(l) });
  eq(dry.code, 0, "a dry run exits 0");
  ok(lines.some((l) => l === "flow:NVDA  [used]  GET https://vendor.test/api/stock/NVDA/greek-flow?date=2026-09-22"),
     "a dry run prints every URL");
  ok(lines.some((l) => l.includes("{symbol} = option_symbol of the max-open_interest row of chain:AAPL")),
     "and says where each bound value will come from");
  ok(lines.every((l) => !l.includes(KEY)), "and never the key");

  await assert.rejects(probe.runProbe({ key: "", tickers: ["AAPL"], list: mini }, { log: () => {} }),
    probe.UsageError, "a live run without a key is a usage error, not a run of 401s");
  await assert.rejects(probe.runProbe({ key: KEY, dryRun: true, tickers: ["AAPL"], filter: "zzz", list: mini }, { log: () => {} }),
    /no probe matches/, "a filter that selects nothing is a usage error");
  checks += 2;
}

{
  const strictList = probe.validateList({ ...mini,
    reads: { "/api/stock/{ticker}/greek-flow": ["timestamp", "dir_delta_flow", "call_gex"],
      "/api/stock/{ticker}/option-contracts": ["option_symbol", "open_interest"] },
    gated: { "/api/volatility/vix-term-structure": 403 } });
  const vendor = fakeVendor();
  const lines = [];
  const run = await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL", "NVDA"], filter: "", strict: true, list: strictList },
    { fetch: vendor.fetch, log: (l) => lines.push(l), now: vendor.now, sleep: vendor.sleep,
      clock: () => new Date("2026-09-23T13:32:00Z") });
  deep(run.strict.failures.slice().sort(), ["DRIFT flow:AAPL: call_gex did not arrive", "DRIFT flow:NVDA: call_gex did not arrive",
    "FAIL broken 500", "FAIL offline no response"],
  "STRICT (the weekly schedule): a field the code reads that did not arrive, a 5xx and an unanswered call are failures");
  ok(run.strict.notes.some((n) => n.startsWith("gated 403: gated, as expected")),
    "while the plan-gated VIX curve's 403 is expected and only noted");
  eq(run.code, 1, "so the strict run exits 1, which turns the scheduled workflow red and emails the owner");
  ok(lines.at(-1).startsWith("== exit 1: strict: 4 unexpected refusal(s)"), "and says why on its last line");
  ok(lines.every((l) => !l.includes(KEY)), "and never prints the key");

  const clean = await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL", "NVDA"], filter: "chain,gated", strict: true,
      date: SESSION, list: strictList },
    { fetch: vendor.fetch, log: () => {}, now: vendor.now, sleep: vendor.sleep });
  ok(clean.code === 0 && clean.strict.failures.length === 0,
    "a strict run whose reads all arrived and whose only refusal is the expected one exits 0 — and an empty answer " +
      "(chain:NVDA) is not drift");
  const planned = probe.strictVerdict([{ id: "gated", op: "/api/volatility/vix-term-structure", cls: "ok", status: 200 }],
    strictList);
  ok(planned.failures.length === 0 && /the plan changed/.test(planned.notes[0]),
    "an expected-gated call that starts answering is noted as a plan change, not a failure");
  throwsLike(() => probe.validateList({ ...mini, reads: { "/api/zzz": ["x"] } }), /no probe exercises/,
    "a read list for an operation no probe calls is refused");
  throwsLike(() => probe.validateList({ ...mini, reads: { "/api/stock/{ticker}/greek-flow": ["a", "a"] } }), /distinct/,
    "and a read list with a name twice");
  throwsLike(() => probe.validateList({ ...mini, gated: { "/api/volatility/vix-term-structure": 200 } }), /4xx/,
    "an expected-gated status is a 4xx");

  const reads = list.reads;
  const L = await import("../shared/flows-live.js");
  const readsOf = (op) => new Set(reads[op] || []);
  const stripSources = L.STRIP_FIELDS.map(([, field]) => field).filter(Boolean);
  ok(stripSources.every((f) => readsOf("/api/screener/stocks").has(f)),
    `THE STRICT READ LIST covers every screener field the live strip reads (${stripSources.length} of them)`);
  ok(["timestamp", "net_call_premium", "net_put_premium", "net_volume"].every((f) =>
    readsOf("/api/market/market-tide").has(f) && readsOf("/api/market/{sector}/sector-tide").has(f) &&
    readsOf("/api/market/{ticker}/etf-tide").has(f) && readsOf("/api/net-flow/expiry").has(f)),
  "and every tide field Tier 1 and Tier 2 read");
  ok(["gamma_per_one_percent_move_oi", "gamma_per_one_percent_move_vol", "gamma_per_one_percent_move_dir", "price",
    "start_time"].every((f) => readsOf("/api/stock/{ticker}/spot-exposures").has(f)), "and the spot-gamma fields");
  const SEEN_OUTSIDE_SPEC = {
    "/api/market/sector-etfs": ["last"], "/api/market/{ticker}/etf-tide": ["underlying_price"],
    "/api/stock/{ticker}/spot-exposures": ["start_time"],
    "/api/option-trades/flow-alerts": ["start_time", "end_time", "iv_start", "iv_end"],
    "/api/etfs/{ticker}/holdings": ["type", "weight"],
    "/api/institution/{ticker}/ownership": ["units_changed"],
  };
  for (const [op, names] of Object.entries(reads)) {
    const documented = new Set(list.expect[op] || []);
    const undocumented = names.filter((n) => !documented.has(n));
    ok(undocumented.every((n) => (SEEN_OUTSIDE_SPEC[op] || []).includes(n)),
      `${op}: every name the code reads is one the spec documents, or one a probe run saw arrive (2026-09-23; units_changed in the 2026-10-04 weekly run, 37223455933) ` +
      `(${undocumented.join(", ") || "none outside the spec"})`);
  }
  deep(list.gated, { "/api/volatility/vix-term-structure": 403, "/api/politician-portfolios/holders/{ticker}": 422 },
    "EXPECTED REFUSALS are the two the 2026-09-23 probe recorded: the VIX curve needs the volatility add-on (403) and " +
      "politician holders is enterprise-only (422); the company profile and forward estimates answered 200 in the " +
      "2026-10-04 weekly run (37223455933), so they are no longer expected to refuse");
}

{
  const tape = probe.validateList({
    version: 1,
    probes: [
      { id: "trades", tier: "2", op: "/api/option-trades", path: "/api/option-trades", query: { ticker_symbol: "{t}", limit: "50" } },
      { id: "prints", tier: "2", op: "/api/lit-flow/{ticker}", path: "/api/lit-flow/{t}", query: { limit: "50" } },
      { id: "future", tier: "2", op: "/api/futures/{contract}/stats", path: "/api/futures/{gold-front}/stats" },
      { id: "tide", tier: "used", op: "/api/market/market-tide", path: "/api/market/market-tide" },
    ],
    entitlement: ["/api/option-trades", "/api/lit-flow/{ticker}", "/api/futures/{contract}/stats"],
    enums: {
      "/api/option-trades": { report_flags: ["intermarket_sweep", "odd_lot"], upstream_condition_detail: ["auto", "isoi", "slan"] },
      "/api/lit-flow/{ticker}": { trade_code: ["intermarket_sweep", "derivative_priced"] },
    },
  });
  const trades = Array.from({ length: 50 }, (_, i) => ({
    id: `9f1c${String(4000 + i)}-trade`, price: (3.17 + i / 100).toFixed(2), size: 41 + i, premium: String(13004 + i * 7),
    report_flags: i < 3 ? ["intermarket_sweep"] : i < 5 ? ["odd_lot", "cross_trade"] : [],
    upstream_condition_detail: i < 2 ? "slan,isoi" : i < 38 ? "auto" : i === 38 ? "slan isoi" : i === 39 ? "auto|isoi" : i < 45 ? "zzzq" : null,
  }));
  const prints = Array.from({ length: 50 }, (_, i) => ({
    tracking_id: 718843880 + i, price: String(211.37 + i), size: 100 + i,
    nbbo_bid_quantity: i < 48 ? 300 + i : null, nbbo_ask_quantity: i < 46 ? 500 + i : "",
    trade_code: i === 7 ? "intermarket_sweep" : null,
  }));
  let t = 0;
  const calls = [];
  const fetchTape = async (url) => {
    calls.push(url);
    t += 40;
    const p = new URL(url).pathname;
    const reply = (status, body) => ({ status, headers: new Headers({ "x-uw-daily-req-count": "57" }),
      text: async () => JSON.stringify(body) });
    if (p === "/api/option-trades") return reply(200, { data: trades });
    if (p === "/api/lit-flow/AAPL") return reply(200, { data: prints });
    if (p === "/api/lit-flow/NVDA") return reply(403, { code: "lit_flow_scope_required", message: "plan" });
    if (p.startsWith("/api/futures/")) return reply(403, { code: "futures_addon_required", message: "add-on" });
    return reply(200, { data: [{ net_call_premium: "1.5", timestamp: "2026-09-22T19:55:00Z" }] });
  };
  const lines = [];
  const run = await probe.runProbe(
    { key: KEY, base: "https://vendor.test", tickers: ["AAPL", "NVDA"], filter: "", strict: true, date: SESSION, list: tape },
    { fetch: fetchTape, log: (l) => lines.push(l), now: () => t, sleep: async (ms) => { t += ms; } });
  const out = lines.join("\n");
  eq(calls.length, 6, "two names for each per-name route, the future and the tide once");
  ok(out.includes("report_flags∋intermarket_sweep: 3/50") && out.includes("report_flags∋odd_lot: 2/50"),
    "ENUM TOKENS: a list field is counted per documented token, in the plan's own form report_flags∋intermarket_sweep: 3/50");
  ok(out.includes("report_flags undocumented: 2/50"), "a row carrying a token the spec does not document is counted, and the token is not printed");
  ok(!out.includes("cross_trade"), "so an undocumented token never appears");
  ok(out.includes("upstream_condition_detail∋isoi: 4/50") && out.includes("upstream_condition_detail∋auto: 37/50") &&
     out.includes("upstream_condition_detail∋slan: 3/50") && out.includes("upstream_condition_detail undocumented: 5/50"),
    "a compound OPRA code is split on any separator, comma, space or pipe, so slan,isoi, slan isoi and auto|isoi count once " +
      "for each code, and an unknown code is counted, not printed");
  ok(!out.includes("zzzq"), "the unknown code itself is not printed");
  ok(out.includes("tokens upstream_condition_detail  filled in 45 of 50 rows"), "the field's own fill is stated beside its tokens");
  ok(out.includes("trade_code∋intermarket_sweep: 1/50"), "the lit print's trade code is counted the same way");
  ok(out.includes("nbbo_bid_quantity:num|null(48/50)") && out.includes("nbbo_ask_quantity:num|str(46/50)"),
    "FILL RATES: how often a print carries the NBBO sizes is a count of rows, the question P2-35 needs answered");
  for (const value of ["3.17", "13004", "211.37", "718843880", "9f1c4000", "300", "1.5", "2026-09-22T19:55:00Z"]) {
    ok(!out.includes(value), `the vendor value ${value} reaches no printed line`);
  }
  const names = ["id", "price", "size", "premium", "report_flags", "upstream_condition_detail", "tracking_id",
    "nbbo_bid_quantity", "nbbo_ask_quantity", "trade_code", "net_call_premium", "timestamp"];
  const valueAfterName = new RegExp(`\\b(${names.join("|")})"?\\s*[:=]\\s*"?[-+.]?\\d`);
  deep(lines.filter((l) => !l.startsWith("   GET ") && valueAfterName.test(l)), [],
    "VALUE-FREE: no digit-bearing value follows a field name; a count follows a documented token instead");
  deep(printedLabels(lines).filter((l) => DIGIT_RUN.test(l)), [],
    "VALUE-FREE: no fields, values or rows-at label carries a run of four digits");
  ok(/^ {3}entitled +3 {2}trades:AAPL 200 \(50 rows, [\d.]+ KB\)/m.test(out) &&
     /trades:NVDA 200 \(50 rows, [\d.]+ KB\)/.test(out) && /prints:AAPL 200 \(50 rows, [\d.]+ KB\)/.test(out),
    "the summary says which entitlement routes answered, with their row counts and sizes");
  ok(/^ {3}refused +2 {2}prints:NVDA 403 lit_flow_scope_required {2}future 403 futures_addon_required$/m.test(out),
    "and which refused, with the vendor's code");
  deep(run.strict.failures, [], "STRICT: a refusal of an entitlement route is a finding, not a failure, so the weekly run stays green");
  ok(run.strict.notes.includes("future 403 futures_addon_required: refused, an entitlement or parameter answer; read the code"),
    "and it is noted as a refusal to read by its code, not asserted to be the plan: a parameter refusal answers 4xx too");
  ok(calls.some((u) => u.endsWith("/api/futures/GCZ6/stats")), "the gold contract is the front month of the session, December 2026 on 2026-09-22");
  const limited = probe.strictVerdict([{ id: "quote:AAPL", op: "/api/stock/{ticker}/quote", cls: "4xx", status: 429, limited: 3, entitlement: true }], tape);
  deep(limited, { failures: ["FAIL quote:AAPL 429 still rate-limited after 3 retries: no answer to read"], notes: [] },
    "RATE LIMIT: a 429 still refused after the retries is no answer to the entitlement question, so it fails rather than read as one");
  deep(probe.renderSummary([{ id: "quote:AAPL", cls: "4xx", status: 429, entitlement: true, limited: 3 }], { session: SESSION, elapsedMs: 1 })
    .filter((l) => l.trimStart().startsWith("refused")), ["   refused    0  "].map((l) => l.trimEnd()),
    "and the summary does not list it as refused");
  eq(run.code, 0, "the strict run exits 0");
  ok(lines.every((l) => !l.includes(KEY)), "and never prints the key");
  const hard = probe.strictVerdict([{ id: "prints:NVDA", op: "/api/lit-flow/{ticker}", cls: "5xx", status: 502, entitlement: true }], tape);
  deep(hard.failures, ["FAIL prints:NVDA 502"], "a 5xx from an entitlement route is still a failure: the vendor broke, the plan did not answer");
  ok(out.includes("x-uw-daily-req-count counts every caller of the key") && out.includes(".mcp.json"),
    "THE ACCOUNTING says the daily counter includes every caller, an agent session's vendor MCP server among them");
}

{
  const within = probe.tokenCounts([
    { c: "isoi_late" }, { c: "slan,isoi" }, { c: "auto" }, { c: "extended_hours_trade_late_or_out_of_sequence" },
  ], { c: ["isoi", "slan", "auto", "extended_hours_trade", "extended_hours_trade_late_or_out_of_sequence"] })[0];
  deep(within.counts, [["isoi", 1], ["slan", 1], ["auto", 1], ["extended_hours_trade", 0],
    ["extended_hours_trade_late_or_out_of_sequence", 1]], "exact tokens are counted per row");
  deep(within.within, [["isoi", 1]],
    "CONTAINS: a code inside an undocumented compound token is counted beside the exact count, and a documented longer token " +
      "is not read as containing a shorter one");
  ok(probe.formatTokens(within).includes("c∋*isoi*: 1/4") && probe.formatTokens(within).includes("c undocumented: 1/4"),
    "printed as c∋*isoi*, while the compound token itself is still only counted as undocumented");

  const symbol = "AAPL261016C00200000";
  const bindList = probe.validateList({
    version: 1,
    probes: [
      { id: "chain", tier: "used", op: "/api/stock/{ticker}/option-contracts", path: "/api/stock/{t}/option-contracts" },
      { id: "historic", tier: "used", op: "/api/option-contract/{id}/historic", path: "/api/option-contract/{symbol}/historic",
        bind: { symbol: { from: "chain", field: "option_symbol" } } },
    ],
  });
  let clock = 0;
  const fetchBound = async (url) => {
    clock += 10;
    const p = new URL(url).pathname;
    if (p.endsWith("/option-contracts")) {
      return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: [{ option_symbol: symbol }] }) };
    }
    return { status: 422, headers: new Headers(),
      text: async () => JSON.stringify({ code: "bad_symbol", message: `contract ${symbol} (${encodeURIComponent(symbol)}) is not listed` }) };
  };
  const bound = [];
  await probe.runProbe({ key: KEY, base: "https://vendor.test", tickers: ["AAPL"], filter: "", date: SESSION, list: bindList },
    { fetch: fetchBound, log: (l) => bound.push(l), now: () => clock, sleep: async (ms) => { clock += ms; } });
  const boundOut = bound.join("\n");
  ok(!boundOut.includes(symbol) && boundOut.includes("message=contract {symbol} ({symbol}) is not listed"),
    "BOUND VALUES: a vendor error that echoes the bound contract prints its template name instead, raw or URL-encoded");
}

{
  deep(probe.parseTickers(""), ["AAPL", "NVDA"], "no tickers means the default pair");
  deep(probe.parseTickers(" aapl, nvda ,AAPL"), ["AAPL", "NVDA"], "tickers are trimmed, uppercased and deduplicated");
  deep(probe.parseTickers("BRK.B spy"), ["BRK.B", "SPY"], "a class share and a space separator are accepted");
  throwsLike(() => probe.parseTickers("../etc"), probe.UsageError, "a path cannot pass as a ticker");
  throwsLike(() => probe.parseTickers("A,B,C,D,E,F,G,H,I,J,K"), /at most 10/, "the ticker list is bounded");
  deep(probe.parseArgs(["--dry-run", "--tickers", "spy", "--filter=skew", "--date", "2026-09-18"], {}),
       { dryRun: true, strict: false, tickers: ["SPY"], filter: "skew", date: "2026-09-18", list: probe.LIST_PATH },
       "flags parse in both spellings");
  deep(probe.parseArgs([], { FLOWS_PROBE_TICKERS: "tsla", FLOWS_PROBE_FILTER: "gex", FLOWS_PROBE_STRICT: "1" }),
       { dryRun: false, strict: true, tickers: ["TSLA"], filter: "gex", date: "", list: probe.LIST_PATH },
       "the workflow's inputs arrive through the environment, never through the shell, strict among them");
  eq(probe.parseArgs(["--strict"], {}).strict, true, "and --strict is the same switch by hand");
  throwsLike(() => probe.parseArgs(["--date", "2026-02-30"], {}), /YYYY-MM-DD/, "an impossible date is refused");
  throwsLike(() => probe.parseArgs(["--bogus"], {}), /unknown argument/, "an unknown flag is refused");
  throwsLike(() => probe.parseArgs(["--tickers"], {}), /needs a value/, "a flag without its value is refused");
}

{
  const script = path.join(ROOT, "scripts/flows-probe.mjs");
  const env = { ...process.env, UW_API_KEY: KEY, FLOWS_PROBE_TICKERS: "msft", FLOWS_PROBE_FILTER: "" };
  const dry = spawnSync(process.execPath, [script, "--dry-run", "--filter", "info,max-pain", "--date", SESSION],
    { cwd: ROOT, env, encoding: "utf8" });
  eq(dry.status, 0, `the CLI dry run exits 0 (${dry.stderr})`);
  ok(dry.stdout.includes("info:MSFT  [used]  GET https://api.unusualwhales.com/api/stock/MSFT/info"),
     "the CLI reads its tickers from the environment the workflow sets");
  ok(dry.stdout.includes("max-pain:MSFT") && !dry.stdout.includes("greek-flow"), "and filters");
  ok(!dry.stdout.includes(KEY) && !dry.stderr.includes(KEY), "and never prints the key it was given");

  const bare = { ...process.env };
  delete bare.UW_API_KEY;
  const live = spawnSync(process.execPath, [script], { cwd: ROOT, env: bare, encoding: "utf8" });
  eq(live.status, 2, "a live run without UW_API_KEY exits 2 before any call");
  ok(live.stderr.includes("UW_API_KEY is not set"), "and says why");
}

{
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/flows-probe.yml"), "utf8");
  const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\npermissions:"));
  const crons = [...on.matchAll(/cron: "([^"]+)"/g)].map((m) => m[1]);
  deep(crons, ["23 14 * * 0"],
    "THE PROBE IS A WEEKLY MONITOR now (Sunday 14:23 UTC, off the hour GitHub drops most), not only a hand-run " +
      "measurement: 170 calls a week against a 100M-call plan, so vendor drift turns a run red within a week");
  ok(/^\s*workflow_dispatch:/m.test(on) && !/push|pull_request/.test(on), "and it can still be dispatched by hand");
  ok(/FLOWS_PROBE_STRICT: \$\{\{ \(github\.event_name == 'schedule' \|\| inputs\.strict\) && '1' \|\| '' \}\}/.test(wf),
    "the scheduled run is always strict; a dispatched one is strict only when asked");
  ok(/tickers:[\s\S]*?default: "AAPL,NVDA"/.test(on), "tickers default to AAPL,NVDA");
  ok(/filter:[\s\S]*?required: false/.test(on), "the filter is optional");
  ok(/^permissions:\n {2}contents: read\n/m.test(wf), "the job can read the repository and nothing else");
  ok(/timeout-minutes: 20\b/.test(wf), "and is bounded at 20 minutes");
  const pipelineWf = fs.readFileSync(path.join(ROOT, ".github/workflows/flows-pipeline.yml"), "utf8");
  const usesOf = (text) => [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  ok(usesOf(wf).length === 2 && usesOf(wf).every((u) => usesOf(pipelineWf).includes(u)) &&
     usesOf(wf).every((u) => /@[0-9a-f]{40}$/.test(u)) && /node-version: 22\b/.test(wf) &&
     /persist-credentials: false/.test(wf),
  "with the same SHA-pinned checkout and setup-node and Node major as flows-pipeline.yml, keeping no credential");
  ok(/UW_API_KEY: \$\{\{ secrets\.UW_API_KEY \}\}/.test(wf), "the key comes from the repository secret");
  ok(/FLOWS_PROBE_TICKERS: \$\{\{ inputs\.tickers \}\}/.test(wf) && /FLOWS_PROBE_FILTER: \$\{\{ inputs\.filter \}\}/.test(wf),
     "the inputs reach the script through the environment");
  const runs = [...wf.matchAll(/^\s*run: (.*)$/gm)].map((m) => m[1]);
  deep(runs, ["node scripts/flows-probe.mjs"],
       "and never through the shell: no ${{ }} is interpolated into a run line, so an input cannot inject a command");
}

console.log(`✓ flows-probe: ${checks} assertions — a probe list whose used label is true (every vendor path a ` +
  `production call site names is probed as used, and nothing else is), the live-only operations named, the eight ` +
  `entitlement routes asked for AAPL and NVDA (a refusal a finding, not a failure), output that names keys, types, ` +
  `fill counts and documented enum tokens and never a vendor value, every token filled from one session date (weekly, both monthlies, ` +
  `the next session, calendar look-backs) with the session itself read from SPY's daily candles the way the ` +
  `pipeline reads it, the pipeline's base URL, Bearer header, missing User-Agent and array encoding held in parity ` +
  `by reading the pipeline's own source, bound values taken from the largest open interest and skipped rather than ` +
  `guessed when absent and printed by their template name, rows found under data, si, chains, trades or a ` +
  `{latest, history} object, a key union typed over every row with numbers-as-strings marked, the spec's documented names diffed against what arrived so a ` +
  `renamed field like call_gex is named in the summary, calls paced 250 ms apart with a 429 retried on its ` +
  `Retry-After, exit 1 only when nothing answered — or, strict, on an unexpected refusal or a field the code reads ` +
  `that did not arrive — a weekly strict workflow whose inputs reach the script through the environment and never ` +
  `the shell, and the key absent from every printed line — raw, escaped, URL-encoded, ` +
  `echoed in a header, or cut in half by a clip`);
