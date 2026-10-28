import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../shared/flows-floor-funds.js";
import { LIVE_KEYS } from "../shared/flows-live.js";
import { shapeFunds } from "../shared/flows-floor-funds-live.js";
import { opById, pathFor, OPS } from "../shared/flows-vendor-ops.js";
import { runFundsLeg } from "../scripts/flows-legs/funds.mjs";
import { fakeFundsRead, FUNDS_FAKE_SCREENER_GAPS, FUNDS_FAKE_EMPTY_ROOT } from "../scripts/flows-legs/funds-fake.mjs";
import { CALL_COST } from "../scripts/flows-nightly/vendor-params.mjs";
import { STAGES } from "../scripts/flows-nightly/stages.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import { nightlyEmit, emitFiles, emitRead } from "./lib/nightly-emit.mjs";
import { nightlyFunds, liveFunds, screenerBody, FUNDS_SESSION } from "./lib/funds-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const S = FUNDS_SESSION;
const E = "2026-09-28";

const PAGE = fs.readFileSync(path.join(ROOT, "assets/js/flows-market-floor.js"), "utf8");
const grab = (name) => {
  const m = new RegExp("const " + name + " = ([\\s\\S]*?);\\n").exec(PAGE);
  assert.ok(m, "the page declares " + name);
  return new Function("return " + m[1])();
};

{
  eq(L.allTickers().length, 77, "the table holds 77 tickers: 4 index funds, 11 sector funds and 62 others");
  eq(L.readList().length, 72, "READ LIST: seventy-two tickers are read, the five weekly roots never on their own");
  ok(Object.keys(L.ROOT_ALIAS).every((t) => !L.readList().includes(t) && L.allTickers().includes(t)), "no weekly root is read alone, and each is still on the floor");
  same(L.readList().slice(0, 4), ["SPY", "QQQ", "IWM", "DIA"], "the index funds lead the list");
  same(Object.values(L.FLOOR_FUNDS.other).map((l) => l.length), [11, 14, 11, 6, 8, 12], "the other classes hold 11, 14, 11, 6, 8 and 12");
  ok(new Set(L.allTickers()).size === 77, "no ticker is listed twice");
  same(grab("FUNDS"), [...L.FLOOR_FUNDS.funds], "THE PAGE'S TABLE EQUALS THE LEAF, TOKEN FOR TOKEN: index funds");
  same(grab("SECTOR_ETFS").map((x) => x[0]), [...L.FLOOR_FUNDS.etf], "sector funds");
  same(grab("OTHER"), JSON.parse(JSON.stringify(L.FLOOR_FUNDS.other)), "other classes");
  same(grab("ROOT_ALIAS"), { ...L.ROOT_ALIAS }, "weekly roots");
  same(grab("FUND_WHY"), { ...L.FUND_WHY }, "and the reason sentences");
  for (const [k, sentence] of Object.entries(L.FUND_WHY)) ok(sentence.split(/\s+/).length <= 14 && !/vendor|tape|forecast|unusual/i.test(sentence), `the ${k} sentence is short and uses the house words`);
  eq(L.floorFundsMode({ FLOWS_FLOOR_FUNDS: "on" }), "on", "the switch: on");
  eq(L.floorFundsMode({ FLOWS_FLOOR_FUNDS: "owner" }), "owner", "owner");
  eq(L.floorFundsMode({ FLOWS_FLOOR_FUNDS: "onn" }), "off", "a misspelt value fails closed");
  eq(L.floorFundsMode({}), "off", "an unset value is off for the page");
  eq(L.nightlyFundsOn({}), true, "and on for the nightly");
  eq(L.nightlyFundsOn({ FLOWS_FLOOR_FUNDS: "off" }), false, "off turns the nightly's reads off");
  eq(L.nightlyFundsOn({ FLOWS_FLOOR_FUNDS: "onn" }), true, "any other value is on there");
}

{
  const raw = { call_premium: "208699280", put_premium: 125472872, call_volume: 1071546, put_volume: "666386", bullish_premium: "152015294", bearish_premium: "138449839", date: "2023-09-08" };
  same(L.shapeFundRow(raw, "screener"), { src: "screener", d: "2023-09-08", cp: 208699280, pp: 125472872, cv: 1071546, pv: 666386, bu: 152015294, be: 138449839 }, "SHAPE: strings and numbers are read exactly");
  const gap = L.shapeFundRow({ call_premium: "5" }, "screener");
  ok(gap.pp === null && gap.cv === null && gap.pv === null && gap.bu === null && gap.be === null && gap.cp === 5, "a field the feed did not carry is null, never zero");
  const zero = L.shapeFundRow({ call_premium: 0, put_premium: "0", call_volume: 0 }, "screener");
  ok(zero.cp === 0 && zero.pp === 0 && zero.cv === 0 && zero.pv === null, "a field the feed answered with zero stays a measured zero");
  const neg = L.shapeFundRow({ call_premium: -4, put_premium: "-1", call_volume: "abc", put_volume: Number.NaN }, "screener");
  ok(neg.cp === null && neg.pp === null && neg.cv === null && neg.pv === null, "a negative, unreadable or non-finite figure is null");
  same(neg.bad, ["cp", "pp", "cv", "pv"], "and the refused fields are kept by name");
  eq(L.shapeFundRow(null, "screener"), null, "a row that is not an object shapes to nothing");
  eq(L.shapeFundRow([], "screener"), null, "and an array is not a row");
  eq(L.shapeFundRow({ call_premium: "12.6" }, "screener").cp, 13, "a fractional premium rounds to the dollar");
}

const row = (src, date, cp = 100) => ({ src, date, cp });
const asked = (cases) => {
  const screener = cases.screener ? { rows: [{ ticker: "TLT", call_premium: cases.screener.cp, put_premium: 1, call_volume: 1, put_volume: 1, bullish_premium: 1, bearish_premium: 1 }], date: cases.screener.date } : null;
  const sectorEtfs = cases.sector ? { rows: [{ ticker: "TLT", call_premium: cases.sector.cp, put_premium: 2, call_volume: 2, put_volume: 2, bullish_premium: 2, bearish_premium: 2 }], date: cases.sector.date } : null;
  const volume = new Map();
  if (cases.volume) volume.set("TLT", { data: [{ date: cases.volume.date, call_premium: cases.volume.cp, put_premium: 3, call_volume: 3, put_volume: 3, bullish_premium: 3, bearish_premium: 3 }] });
  return L.fundActivity({ session: S, readAt: S + "T20:00:00Z", screener, sectorEtfs, volume, reasons: new Map(cases.reasons || []) }).rows.TLT;
};

{
  const cur = (src, cp) => row(src, S, cp), old = (src, cp) => row(src, E, cp);
  const table = [
    ["a current screener row alone", { screener: cur("s", 11) }, "screener", 11],
    ["a current sector row alone", { sector: cur("e", 12) }, "sector-etfs", 12],
    ["a current volume row alone", { volume: cur("v", 13) }, "options-volume", 13],
    ["screener and sector", { screener: cur("s", 11), sector: cur("e", 12) }, "screener", 11],
    ["screener and volume", { screener: cur("s", 11), volume: cur("v", 13) }, "screener", 11],
    ["sector and volume", { sector: cur("e", 12), volume: cur("v", 13) }, "sector-etfs", 12],
    ["all three", { screener: cur("s", 11), sector: cur("e", 12), volume: cur("v", 13) }, "screener", 11],
    ["an earlier screener row against a current volume row", { screener: old("s", 11), volume: cur("v", 13) }, "options-volume", 13],
    ["an earlier screener row against a current sector row", { screener: old("s", 11), sector: cur("e", 12) }, "sector-etfs", 12],
  ];
  for (const [name, cases, src, cp] of table) {
    const r = asked(cases);
    ok(r.src === src && r.cp === cp && !r.why, `PRECEDENCE: ${name} gives ${src}`);
  }
  eq(asked({ screener: old("s", 11) }).why, "stale", "PRECEDENCE: an earlier session's row alone is stale, with no figures");
  eq(asked({ screener: old("s", 11), sector: old("e", 12), volume: old("v", 13) }).why, "stale", "PRECEDENCE: all earlier is stale");
  eq(asked({}).why, "no_row", "PRECEDENCE: nothing read is no_row");
  eq(asked({ reasons: [["TLT", "over_cap"]] }).why, "over_cap", "and the reason a read was withheld is kept");
  ok(asked({ screener: cur("s", 11) }).d === undefined, "a row dated the session carries no date of its own");
  eq(asked({ volume: { src: "v", date: E, cp: 4 }, sector: cur("e", 12) }).src, "sector-etfs", "an earlier volume row never beats a current one");
}

{
  const missing = Array.from({ length: 30 }, (_, i) => "T" + i);
  const plan = L.planFallback(missing);
  eq(plan.read.length, 24, "THE CAP: thirty missing funds give twenty-four fallback reads");
  eq(plan.overCap.length, 6, "and six over the cap");
  same(plan.read, missing.slice(0, 24), "in list order");
  const body = { data: screenerBody(S).data.filter((r) => !L.readList().slice(20, 50).includes(r.ticker)) };
  const calls = [];
  const uw = async (p, q) => {
    calls.push(p);
    if (p === "/api/screener/stocks") return body;
    return fakeFundsRead(p, q, S);
  };
  const block = await runFundsLeg({ session: S, readAt: S + "T21:00:00Z", uw });
  eq(calls.filter((p) => /options-volume/.test(p)).length, 24, "THE LEG: the fallback read twenty-four funds and no more");
  eq(Object.values(block.rows).filter((r) => r.why === "over_cap").length, 6, "the other six are over_cap");
  eq(block.counts.read, 66, "sixty-six of seventy-two funds were read");
  eq(block.status, "ok", "which is ok");
}

{
  const calls = [];
  const uw = async (p, q) => { calls.push(p); return fakeFundsRead(p, q, S); };
  const block = await runFundsLeg({ session: S, readAt: S + "T21:00:00Z", uw });
  eq(block.status, "ok", "the leg on the fake feed is ok");
  eq(calls.filter((p) => p === "/api/screener/stocks").length, 1, "one screener call reads every fund");
  eq(calls.filter((p) => /options-volume/.test(p)).length, 4, "four fallback reads: three screener gaps and the empty root");
  eq(calls.filter((p) => /\/info$/.test(p)).length, 12, "twelve funds are given a fresh description");
  eq(calls.filter((p) => /\/weights$/.test(p)).length, 12, "twelve weights");
  eq(calls.filter((p) => /in-outflow$/.test(p)).length, 12, "and twelve share-change reads");
  eq(calls.filter((p) => /ticker-exchanges/.test(p)).length, 1, "the directory is read once");
  eq(block.counts.fromVolume, 3, "three funds come from the per-fund read");
  eq(block.rows[FUNDS_FAKE_EMPTY_ROOT].why, "no_row", "the empty root is no_row");
  ok(FUNDS_FAKE_SCREENER_GAPS.every((t) => block.rows[t].src === "options-volume"), "and the screener gaps are filled by the per-fund read");
  const total = calls.length;
  ok(total <= CALL_COST.funds, `the leg's ${total} calls are inside the ${CALL_COST.funds} the budget counts`);
  const second = await runFundsLeg({ session: S, readAt: S + "T21:05:00Z", uw, prior: block });
  ok(Object.keys(second.meta).length >= 12, "the next night carries the descriptions it already has");
  const dirCalls = [];
  await runFundsLeg({ session: S, readAt: S + "T21:05:00Z", uw: async (p, q) => { dirCalls.push(p); return fakeFundsRead(p, q, S); }, prior: block });
  eq(dirCalls.filter((p) => /ticker-exchanges/.test(p)).length, 0, "and does not read the directory again inside a week");
  const off = [];
  const b = await runFundsLeg({ session: S, readAt: S + "T21:00:00Z", uw: async (p) => { off.push(p); return {}; }, mode: "off" });
  same(b, { v: 1, status: "off" }, "the switch off publishes the off block");
  eq(off.length, 0, "and makes no call");
  const refused = await runFundsLeg({
    session: S, readAt: S + "T21:00:00Z",
    uw: async (p, q) => {
      if (/options-volume/.test(p)) { const t = decodeURIComponent(/stock\/([^/]+)/.exec(p)[1]); throw new Error(p + " -> HTTP " + (t === "UNG" ? 429 : 500)); }
      return fakeFundsRead(p, q, S);
    },
  });
  eq(refused.rows.UNG.why, "refused", "a refused per-fund read is refused");
  eq(refused.rows.SIL.why, "failed", "and a failing one is failed");
  const deadCalls = [];
  const dead = await runFundsLeg({ session: S, readAt: S + "T21:00:00Z", uw: async (p) => { deadCalls.push(p); throw new Error("/api -> HTTP 503"); } });
  eq(deadCalls.filter((p) => p === "/api/market/sector-etfs").length, 1, "a screener that fails sends the leg to the sector fund rows once");
  ok(deadCalls.length <= CALL_COST.funds, `and its worst night, ${deadCalls.length} calls with every fallback taken, is inside the ${CALL_COST.funds} the budget counts`);
  ok(dead.status === "unavailable" && dead.counts.read === 0, "a feed that answers nothing is unavailable, never a wall of zeros");
  ok(Object.values(dead.rows).every((r) => r.alias || r.why), "and every row says why");
  const old = { ...block, dir: { at: "2026-09-10", absent: ["TBT"] } };
  const withDir = await runFundsLeg({ session: S, readAt: S + "T21:00:00Z", uw: async (p, q) => (p === "/api/screener/stocks" ? { data: screenerBody(S).data.filter((r) => r.ticker !== "TBT") } : fakeFundsRead(p, q, S)), prior: { ...old, dir: { at: S, absent: ["TBT"] } } });
  eq(withDir.rows.TBT.src, "options-volume", "a directory that lists a fund as absent still lets a real row stand");
}

{
  const plan = L.rotationPlan({ prior: {}, today: S });
  eq(plan.length, 12, "ROTATION: a cold start reads twelve funds");
  const prior = {};
  for (const t of L.readList().slice(0, 40)) prior[t] = { at: "2026-09-27T20:00:00Z" };
  for (const t of L.readList().slice(40, 50)) prior[t] = { at: "2026-09-01T20:00:00Z" };
  const never = L.rotationPlan({ prior, today: S });
  same(never, L.readList().slice(50).sort().slice(0, 12), "a fund never described is read before any that is only old");
  for (const t of L.readList().slice(50)) prior[t] = { at: "2026-09-28T20:00:00Z" };
  const next = L.rotationPlan({ prior, today: S });
  same(next.slice(0, 10).sort(), L.readList().slice(40, 50).sort(), "the oldest descriptions are read first");
  ok(next.length === 10 && !next.some((t) => L.readList().indexOf(t) < 40), "and a fresh one is not read again");
  const carry = L.carryMeta(prior, S);
  eq(carry.size, 62, "a description under fourteen days old is carried and the ten older ones are dropped");
  const days = new Set();
  const sim = {};
  for (let d = 0; d < 14; d++) {
    const day = new Date(Date.parse(S + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
    for (const t of L.rotationPlan({ prior: sim, today: day })) sim[t] = { at: day + "T20:00:00Z" };
    days.add(day);
  }
  eq(Object.keys(sim).length, 72, "a fortnight of nights reaches every fund");
  const small = L.metaFrom({ at: S, info: { data: { name: "A Fund", etf_company: "Co", aum: "1", holdings_count: 5, expense_ratio: "0.1" } } });
  same(Object.keys(small).sort(), ["at", "issuer", "n", "name"], "the description keeps the name, issuer and holdings, and withholds the amount whose unit is not stated");
  const full = L.metaFrom({ at: S, weights: { sector: [{ sector: "Tech", weight: "0.5" }, { sector: "Other", weight: "0.4" }, { sector: "Energy", weight: "0.1" }], country: [{ country: "US", weight: "0.9" }] }, flow: { data: [{ date: "2026-09-26", change: -5 }, { date: "2026-09-27", change: 12 }] } });
  same(full.sec, [["Tech", 0.5], ["Energy", 0.1]], "the top sectors leave out Other");
  same(full.flow, { d: "2026-09-27", sh: 12 }, "and the latest share change is the newest date's");
  eq(L.metaFrom({ at: S }), null, "a description with nothing in it is no description");
}

{
  const block = nightlyFunds();
  const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
  const tight = L.fitFunds(block, 6000);
  ok(bytes(tight) <= 6000 || Object.keys(tight.meta).length === 0, "FIT: a block over its budget sheds descriptions first");
  same(Object.keys(tight.rows), Object.keys(block.rows), "and never sheds a row");
  const ats = Object.keys(block.meta);
  const shedAll = L.fitFunds({ ...block, meta: Object.fromEntries(ats.map((t, i) => [t, { at: "2026-09-" + String(10 + i).padStart(2, "0") + "T00:00:00Z", name: "x".repeat(400) }])) }, 6500);
  const kept = Object.keys(shedAll.meta);
  ok(kept.length < ats.length && kept.every((t) => ats.indexOf(t) >= ats.length - kept.length), "the oldest descriptions go first");
  const huge = L.fitFunds({ ...block, rows: block.rows }, 10);
  same(huge.meta, {}, "past the last description the meta is empty and the rows still stand");
  eq(Object.keys(huge.rows).length, 77, "all seventy-seven rows are still there");
}

{
  const nightly = nightlyFunds();
  const live = liveFunds();
  eq(live.key, "live:funds", "LIVE: the builder names its key");
  ok(LIVE_KEYS["live:funds"] && LIVE_KEYS["live:funds"].writer === "worker" && LIVE_KEYS["live:funds"].klass === "market" && LIVE_KEYS["live:funds"].maxBytes === 16 * 1024, "the key is registered for the Worker's funds tick, on the market clock, under 16 KiB");
  let compared = 0;
  for (const [t, r] of Object.entries(nightly.rows)) if (r.src === "screener") { same(live.rows[t], r, `LIVE: ${t} has the nightly's figures`); compared++; }
  ok(compared >= 60, `LIVE: ${compared} funds compared`);
  ok(Buffer.byteLength(JSON.stringify(live)) < 16 * 1024, "and the row is under its cap");
  for (const t of Object.keys(L.ROOT_ALIAS)) eq(live.rows[t].alias, L.ROOT_ALIAS[t], `${t} is counted under its parent live too`);
  const empty = shapeFunds({ data: [] }, { at: 1, session: S, writer: "w" });
  ok(Object.values(empty.rows).every((r) => r.alias || r.why === "no_row"), "an empty answer is no_row for every fund, never zero");
}

{
  const e = opById("etf-info"), w = opById("etf-weights"), d = opById("ticker-exchanges"), v = opById("options-volume");
  eq(pathFor("etf-info", { ticker: "SPY" }), "/api/etfs/SPY/info", "REGISTRY: the ETF information path");
  eq(pathFor("etf-weights", { ticker: "SPY" }), "/api/etfs/SPY/weights", "weights");
  eq(d.path, "/api/stock-directory/ticker-exchanges", "and the directory");
  ok([e, w, d].every((x) => x.klass === "slow" && x.limiter === null && x.reads.length), "each is a slow, engine-only read with the fields it reads named");
  same(v.reads, ["date", "call_premium", "put_premium", "call_volume", "put_volume", "bullish_premium", "bearish_premium"], "options-volume names the fields the fallback reads");
  eq(OPS.length, 113, "the registry holds 113 operations: the eighty-two with the fund reads, the eighteen the Flow Lab reads and the thirteen the volatility desk reads");
  const stage = STAGES.map((s) => s.id);
  ok(stage.indexOf("funds") === stage.indexOf("market") - 1, "STAGE: funds runs immediately before market");
  eq(STAGES.find((s) => s.id === "funds").isolation, "isolated", "and is isolated, so a failure leaves the market payload as it was");
  same(STAGES.find((s) => s.id === "funds").publishes, [], "it publishes nothing of its own");
}

{
  const dir = nightlyEmit();
  const market = emitRead(dir, "market");
  const f = market.funds;
  eq(f.status, "ok", "THE DRY EMIT: market.funds is ok");
  eq(f.counts.listed, 72, "seventy-two funds are listed");
  const must = [...L.FLOOR_FUNDS.funds, ...L.FLOOR_FUNDS.etf, ...Object.values(L.FLOOR_FUNDS.other).flat().filter((t) => !L.ROOT_ALIAS[t] && t !== FUNDS_FAKE_EMPTY_ROOT)];
  eq(must.length, 71, "seventy-one funds are expected to have figures");
  for (const t of must) {
    const r = f.rows[t];
    ok(r && ["cp", "pp", "cv", "pv", "bu", "be"].every((k) => Number.isInteger(r[k])), `${t} has all six figures`);
  }
  eq(f.rows[FUNDS_FAKE_EMPTY_ROOT].why, "no_row", `the one exception is ${FUNDS_FAKE_EMPTY_ROOT}, a root the fixture feed deliberately leaves empty`);
  for (const [t, parent] of Object.entries(L.ROOT_ALIAS)) eq(f.rows[t].alias, parent, `${t} names ${parent}`);
  const size = Buffer.byteLength(JSON.stringify(f));
  ok(size <= L.FUNDS_BLOCK_BYTES, `the block is ${size} bytes, under its ${L.FUNDS_BLOCK_BYTES}`);
  console.log(`  funds block: ${size} bytes with ${Object.keys(f.meta).length} descriptions; the market payload is ${Buffer.byteLength(JSON.stringify(market))} bytes`);
  ok(market.fixture === true && f.rows.SPY.src === "screener", "and the payload says it is a fixture");
  ok(f.rows.SPXW.alias === "SPX" && !("cp" in f.rows.SPXW), "a weekly root carries no figures of its own");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "floor-funds-off-"));
  process.env.FLOWS_FLOOR_FUNDS = "off";
  let off;
  try { off = nightlyEmit({ dir: tmp }); } finally { delete process.env.FLOWS_FLOOR_FUNDS; }
  try {
    same(emitRead(off, "market").funds, { v: 1, status: "off" }, "SWITCH OFF: market.funds is the off block");
    const hash = (d, file) => createHash("sha256").update(fs.readFileSync(path.join(d, file))).digest("hex");
    const files = emitFiles(dir);
    ok(!files.includes("-live-funds.json") && !emitFiles(off).includes("-live-funds.json"), "live:funds is the Worker's funds tick's key, so the dry live pass writes it under neither setting");
    same(emitFiles(off), files, "every other file is written");
    const moved = emitFiles(off).filter((x) => hash(dir, x) !== hash(off, x));
    same(moved.filter((x) => !x.startsWith("-live-") && x !== "-market.json" && x !== "-meta.json"), [], "no nightly payload but the market moved by a single byte");
    same(moved.filter((x) => x.startsWith("-live-")), [], "and no live key moved: the pass makes no fund read under either setting");
    const a = { ...emitRead(dir, "market") }, b = { ...emitRead(off, "market") };
    delete a.funds; delete b.funds;
    same(a, b, "and the market payload is otherwise the same");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

{
  const detect = (m) => {
    const list = m.readList();
    if (list.length !== 72 || !list.includes("SPY") || !list.includes("XLRE") || !list.includes("EWG")) return "READ LIST: a fund is missing from the read or a root is read alone";
    if (list.some((t) => ["SPXW", "NDXP", "RUTW", "VIXW", "MRUT"].includes(t))) return "ALIAS: a weekly root is read on its own";
    const blank = m.shapeFundRow({ call_premium: "5" }, "screener");
    if (blank.pp !== 0 && blank.pp !== null) return "SHAPE: unexpected";
    if (blank.pp === 0) return "SHAPE: a missing field was written as zero";
    const mk = (date, cp) => ({ rows: [{ ticker: "TLT", call_premium: cp, put_premium: 1, call_volume: 1, put_volume: 1, bullish_premium: 1, bearish_premium: 1 }], date });
    const vol = new Map([["TLT", { data: [{ date: S, call_premium: 9, put_premium: 1, call_volume: 1, put_volume: 1, bullish_premium: 1, bearish_premium: 1 }] }]]);
    const r = m.fundActivity({ session: S, readAt: S + "T20:00:00Z", screener: mk(E, 5), volume: vol }).rows.TLT;
    if (r.src !== "options-volume") return "PRECEDENCE: an earlier session's row beat a current one";
    const p = m.planFallback(Array.from({ length: 30 }, (_, i) => "T" + i));
    if (p.read.length !== 24 || p.overCap.length !== 6) return "THE CAP: the fallback read more than twenty-four funds";
    const block = nightlyFunds();
    const fit = m.fitFunds(JSON.parse(JSON.stringify(block)), 6000);
    if (Object.keys(fit.rows).length !== 77) return "FIT: the fit shed rows before descriptions";
    if (m.floorFundsMode({ FLOWS_FLOOR_FUNDS: "onn" }) !== "off") return "SWITCH: a misspelt value turned the page on";
    return null;
  };
  eq(detect(L), null, "THE CORRECT BUILD PASSES EVERY CHECK OF THE DETECTOR");
  const MUTANTS = [
    ["fund-dropped-from-read", [["return allTickers().filter((t) => !Object.prototype.hasOwnProperty.call(ROOT_ALIAS, t));", "return allTickers().filter((t) => !Object.prototype.hasOwnProperty.call(ROOT_ALIAS, t)).slice(1);"]], /READ LIST/],
    ["zero-for-missing", [["    out[k] = a.v;\n", "    out[k] = a.v === null ? 0 : a.v;\n"]], /SHAPE/],
    ["alias-read-alone", [["return allTickers().filter((t) => !Object.prototype.hasOwnProperty.call(ROOT_ALIAS, t));", "return allTickers();"]], /READ LIST|ALIAS/],
    ["stale-wins", [["const cur = cands.filter((c) => c.d === session);", "const cur = cands;"]], /PRECEDENCE/],
    ["cap-ignored", [["return { read: missing.slice(0, cap), overCap: missing.slice(cap) };", "return { read: missing, overCap: [] };"]], /THE CAP/],
    ["meta-sheds-rows", [["    delete meta[t];\n", "    delete block.rows[Object.keys(block.rows)[0]];\n    delete meta[t];\n"]], /FIT/],
    ["switch-fails-open", [["return raw === \"on\" || raw === \"owner\" ? raw : \"off\";", "return raw === \"off\" ? \"off\" : raw === \"owner\" ? raw : \"on\";"]], /SWITCH/],
  ];
  for (const [name, transforms, expect] of MUTANTS) {
    const m = await loadMutated("shared/flows-floor-funds.js", transforms);
    const why = detect(m);
    console.log(`  planted ${name}: ${why || "NOT CAUGHT"}`);
    ok(why !== null && expect.test(why), `THE PLANTED WRONG BUILD "${name}" FAILS ITS NAMED CHECK`);
  }
}

{
  const tree = ["shared/flows-floor-funds.js", "shared/flows-floor-funds-live.js", "scripts/flows-legs/funds.mjs", "shared/flows-live.js", "scripts/flows-legs/live.mjs"];
  const reads = tree.filter((f) => /\/api\/(etfs|stock-directory|screener|stock\/)/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  same(reads, [], "NO CALL SITE SPELLS A FUND PATH: the registry is the only place");
  const worker = fs.readFileSync(path.join(ROOT, "server/routes/flows-pages.js"), "utf8");
  ok(/floorFundsMode\(env\)/.test(worker) && /funds: floorFundsOn\(env, owner\)/.test(worker), "THE ROUTE passes the switch to the market page");
  const pages = fs.readFileSync(path.join(ROOT, "shared/flows-pages.js"), "utf8");
  ok(/data-funds="on"/.test(pages), "and the page carries it as data-funds");
  const toml = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  ok(/^FLOWS_FLOOR_FUNDS = "on"$/m.test(toml), "wrangler.toml ships the switch on");
  const ops = fs.readFileSync(path.join(ROOT, "server/ops.js"), "utf8");
  ok(ops.includes('"FLOWS_FLOOR_FUNDS"'), "and the Status page lists it");
  ok(!/vendor|\btape\b|unusual whales/i.test(PAGE.replace(/\/\/.*$/gm, "")), "THE SERVED FLOOR NEVER NAMES THE PROVIDER, ITS VENDOR OR THE TAPE");
}

console.log(`flows-floor-funds: ${checks} checks passed`);
