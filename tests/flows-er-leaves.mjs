import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadMutated } from "./truth/mutants.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-er.json"), "utf8"));
const B = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-eventrisk.json"), "utf8")).bodies;
const SESSION = "2026-10-26";
const BASE = "36c1ea1";

let checks = 0;

const real = {
  eps: await import("../shared/flows-er-eps.js"),
  score: await import("../shared/flows-er-score.js"),
  cal: await import("../shared/flows-er-calendar.js"),
  pulse: await import("../shared/flows-er-pulse.js"),
  policy: await import("../shared/flows-er-policy.js"),
  feed: await import("../shared/flows-er-feed.js"),
  tpl: await import("../shared/ff-feed-templates.js"),
  payload: await import("../shared/flows-er-payload.js"),
  ops: await import("../shared/flows-vendor-ops.js"),
};

const FILES = {
  eps: "shared/flows-er-eps.js", score: "shared/flows-er-score.js", cal: "shared/flows-er-calendar.js", pulse: "shared/flows-er-pulse.js",
  policy: "shared/flows-er-policy.js", feed: "shared/flows-er-feed.js", tpl: "shared/ff-feed-templates.js", payload: "shared/flows-er-payload.js",
  ops: "shared/flows-vendor-ops.js",
};

const near = (a, b) => (a === null || b === null || a === undefined || b === undefined ? a === b : typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 : false);

function nearDeep(a, b, where) {
  if (a === null || b === null || a === undefined || b === undefined || typeof a !== "object" || typeof b !== "object") {
    assert.ok(typeof a === "number" && typeof b === "number" ? near(a, b) : a === b || (a == null && b == null), `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a)) {
    assert.ok(Array.isArray(b) && a.length === b.length, `${where}: length ${a.length} vs ${b && b.length}`);
    a.forEach((x, i) => nearDeep(x, b[i], `${where}[${i}]`));
    return;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  assert.deepEqual(ka, kb, `${where}: keys`);
  for (const k of ka) nearDeep(a[k], b[k], `${where}.${k}`);
}

async function modsWith(over) {
  const out = { ...real };
  for (const [k, transforms] of Object.entries(over || {})) out[k] = await loadMutated(FILES[k], transforms);
  return out;
}

function battery(m) {
  const fails = [];
  const chk = (name, fn) => {
    try { fn(); checks++; } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      fails.push(name);
    }
  };

  chk("hist", () => {
    for (const [i, c] of FX.hist.entries()) {
      const s = m.score.scoreEvents(c.events);
      nearDeep(s.hist, c.hist, `hist[${i}]`);
      const t = m.score.todayOf(c.emNow, s);
      nearDeep(t.todayR, c.todayR, `todayR[${i}]`);
      nearDeep(t.todayZ, c.todayZ, `todayZ[${i}]`);
    }
  });
  chk("concordance", () => {
    for (const [i, c] of FX.conc.entries()) nearDeep(m.score.concordance(c.rows), c.expect, `conc[${i}]`);
  });
  chk("pooled", () => {
    for (const [i, c] of FX.pooled.entries()) nearDeep(m.score.pooledVerdict(c.hists.map((h) => ({ hist: h }))), c.expect, `pooled[${i}]`);
  });
  chk("hundredths", () => {
    for (const c of FX.hundredths) assert.equal(m.eps.hundredthsOf(c.s), c.h, `hundredths ${JSON.stringify(c.s)}`);
  });
  chk("surprise", () => {
    for (const c of FX.surprise) {
      const got = c.rep === null || c.est === null ? null : m.eps.surpriseOf(c.rep, c.est);
      assert.ok(near(got, c.sx), `surprise ${c.rep} ${c.est}: ${got} vs ${c.sx}`);
    }
  });
  chk("reduce", () => {
    for (const [i, c] of FX.reduce.entries()) {
      const r = m.eps.reduceStockEarnings({ data: c.data });
      if (!c.expect.length) { assert.equal(r.fail, "empty", `reduce[${i}] empty`); continue; }
      nearDeep(r.rows, c.expect, `reduce[${i}]`);
    }
  });
  chk("join", () => {
    for (const [i, c] of FX.join.entries()) nearDeep(m.eps.joinSurprise(c.events, c.eps, c.fin), c.expect, `join[${i}]`);
  });
  chk("impact", () => {
    for (const c of FX.impact) assert.equal(m.cal.impactInstant(c.d, c.when), c.at, `impact ${c.d} ${c.when}`);
    assert.equal(m.cal.impactInstant("2026-10-26", null), null);
    assert.equal(m.cal.impactInstant("1999-01-01", "pre"), null);
  });
  chk("phase", () => {
    for (const c of FX.phase) {
      assert.equal(m.cal.phaseOf(c.ms), c.phase, `phase ${c.at}`);
      assert.equal(m.cal.phaseOf(c.at), c.phase, `phase iso ${c.at}`);
    }
    assert.equal(m.cal.phaseOf(null), null);
  });

  chk("natr", () => {
    const n = m.pulse.natrRead(B["tech-natr"].SYE001);
    assert.equal(n.ok, true);
    assert.equal(n.natrAt, "2026-10-25");
    assert.ok(n.natr > 1.2 && n.natr < 5, "the newest point wins over the older 9.9999");
    assert.deepEqual(m.pulse.natrRead(B["tech-natr"].SYE006), { fail: "unit" });
    assert.deepEqual(m.pulse.natrRead({ data: [] }), { fail: "empty" });
    assert.deepEqual(m.pulse.natrRead({ data: [{ date: "2026-10-25", values: { OTHER: "1" } }] }), { fail: "unshaped" });
    assert.equal(m.pulse.natrRead({ data: [{ date: "2026-10-25", values: { natr: "0" } }] }).natr, 0);
    assert.deepEqual(m.pulse.natrRead({ data: [{ date: "2026-10-25", values: { NATR: "-1" } }] }), { fail: "unit" });
  });
  chk("pulse", () => {
    const p = m.pulse.pulseRead(B["stock-options-pulse"].SYE001);
    assert.deepEqual({ ...p }, { ok: true, at: "2026-10-26T14:00:00.000Z", calls: 9, puts: 20, ratio: 2.2222 });
    assert.ok(!/sntm/.test(JSON.stringify(p)), "the sentiment scores are never stored");
    const z = m.pulse.pulseRead(B["stock-options-pulse"].SYE007);
    assert.equal(z.ratio, null);
    assert.equal(z.calls, 0);
    assert.equal(z.puts, 5);
    const noTime = m.pulse.pulseRead({ data: { intraday: [{ trd_dt: "2026-10-26", hr_min: "junk", call_txn: 2, put_txn: 3 }] } });
    assert.equal(noTime.at, null);
    assert.equal(noTime.calls, 2);
    assert.deepEqual(m.pulse.pulseRead(null), { fail: "unshaped" });
  });

  chk("schedule", () => {
    const reads = Object.values(B["potus-schedule"]).map((rows) => ({ body: { data: rows } }));
    const r = m.policy.scheduleRows(reads, SESSION);
    assert.ok(r.rows.length >= 8 && r.rows.length <= 40);
    const noZone = r.rows.find((x) => x.text && x.text.includes("carries no zone"));
    assert.equal(noZone.at, null, "a time with no zone is not a time");
    assert.equal(noZone.phase, null);
    const rth = r.rows.find((x) => x.at === "2026-10-26T15:00:00.000Z");
    assert.equal(rth.phase, "rth");
    const post = r.rows.find((x) => x.at === "2026-10-26T22:30:00.000Z");
    assert.equal(post.phase, "post");
    assert.ok(post.text && !/ignore/i.test(post.text), "the instruction-shaped sentence is dropped: " + post.text);
    assert.ok(r.rows.every((x) => !("url" in x) && !("video_url" in x)));
    const dates = r.rows.map((x) => x.d);
    assert.deepEqual(dates, dates.slice().sort(), "ordered by date");
    const day0 = r.rows.filter((x) => x.d === SESSION);
    const idxNull = day0.findIndex((x) => x.at === null);
    assert.ok(day0.slice(idxNull).every((x) => x.at === null), "a null time is last within its date");
    const dup = m.policy.scheduleRows([...reads, ...reads], SESSION);
    assert.equal(dup.rows.length, r.rows.length, "the same entry from two reads is one");
  });
  chk("posts", () => {
    const universe = new Set(["SYE004"]);
    const r = m.policy.postRows(B["potus-posts"], SESSION, universe);
    assert.ok(r.rows.every((x) => x.at >= r.from));
    assert.ok(!r.rows.some((x) => /old invented post/.test(x.text)), "a post outside five sessions is left out");
    assert.equal(r.dropped, 1, "the chat-marker post is dropped whole and counted");
    assert.ok(!r.rows.some((x) => /http|im_start/.test(x.text)));
    const cut = r.rows.find((x) => x.cut === 1);
    assert.ok(cut && cut.text.length <= 280);
    const first = r.rows[0];
    assert.deepEqual(first.tags.slice().sort(), ["energy", "trade"]);
    assert.deepEqual(first.tickers, ["SYE004"], "a cashtag outside the universe is not kept");
    const crypto = r.rows.find((x) => x.tags.includes("crypto"));
    assert.ok(crypto);
    const pre = m.policy.postRows([{ timestamp: Date.parse("2026-10-26T12:00:00Z"), post: "Notice about the Fed and rates today" }], SESSION, universe);
    assert.equal(pre.rows[0].phase, "pre");
    assert.deepEqual(pre.rows[0].tags, ["rates"]);
    const bad = m.policy.postRows([{ timestamp: 5, post: "x" }, { timestamp: "7", post: "y" }, null], SESSION, universe);
    assert.equal(bad.rows.length, 0);
    assert.equal(bad.dropped, 3);
    assert.deepEqual(m.policy.tagsOf("No keyword here"), []);
    assert.deepEqual(m.policy.tagsOf("An import of goods"), ["trade"]);
    assert.deepEqual(m.policy.tagsOf("The portfolio"), [], "whole words only");
  });

  chk("ipo", () => {
    const r = m.cal.ipoRows(B["calendar-ipo"], SESSION);
    assert.ok(r.rows.every((x) => x.d >= SESSION));
    assert.ok(r.rows.every((x, i, a) => i === 0 || a[i - 1].d < x.d || (a[i - 1].d === x.d && a[i - 1].t <= x.t)), "ordered by date then ticker");
    const bad = r.rows.find((x) => x.badRange === 1);
    assert.ok(bad && bad.lo === 2000 && bad.hi === 1800, "a reversed range is flagged and not swapped");
    const nulls = r.rows.find((x) => x.lo === null && x.hi === null);
    assert.ok(nulls, "null prices stay null, never 0");
    assert.ok(!r.rows.some((x) => x.t === null), "an issue with no ticker is dropped and counted");
    assert.ok(r.dropped >= 1);
    assert.ok(r.rows.every((x) => Number.isInteger(x.s) && x.s >= 0));
    assert.ok(r.rows.every((x) => x.name === null || !/[<>]/.test(x.name)));
    assert.ok(r.rows.every((x) => x.cur === null || /^[A-Z]{3}$/.test(x.cur)));
    assert.deepEqual(m.cal.ipoRows(null, SESSION).rows, []);
  });
  chk("listed", () => {
    const r = m.cal.listedRows(B["listings-active"], SESSION);
    assert.ok(r.rows.length > 0 && r.rows.every((x) => x.d <= SESSION && x.d > "2026-09-26"));
    assert.ok(r.rows.every((x, i, a) => i === 0 || a[i - 1].d >= x.d));
  });
  chk("delisted", () => {
    const reads = Object.entries(B["listings-delisted"]).map(([date, body]) => ({ date, body }));
    const r = m.cal.delistedRows(reads, new Set(["SYE001"]));
    assert.equal(r.rows.length, 18);
    assert.equal(r.rows.filter((x) => x.u === 1).length, 3);
    assert.equal(r.days.length, 3);
    const dup = m.cal.delistedRows([...reads, ...reads], []);
    assert.equal(dup.rows.length, 18, "de-duplicated by ticker and date");
  });

  chk("filters", () => {
    const f = m.feed.reduceFilters(B["alerts-filters"]);
    assert.equal(f.ok, true);
    assert.equal(f.unknownTypes, 1);
    assert.deepEqual(f.types.map((t) => t.id).sort(), ["chain_oi_change", "earnings", "economic_release", "fda", "flow_alerts", "trading_state"]);
    const ts = f.types.find((t) => t.id === "trading_state");
    assert.equal(ts.can, true);
    assert.equal(ts.perDay, 50);
    assert.deepEqual(ts.fields, ["state", "reason", "symbols"]);
    assert.equal(ts.target, "trading_state");
    assert.equal(f.types.find((t) => t.id === "chain_oi_change").can, false);
    assert.equal(f.types.find((t) => t.id === "fda").can, true);
    assert.equal(f.types.find((t) => t.id === "fda").perDay, null);
    assert.deepEqual(f.types.find((t) => t.id === "flow_alerts").fields, ["total_premium", "volume_oi_ratio", "dte"]);
    assert.deepEqual(m.feed.reduceFilters({ data: {}, noti_type_descriptions: {} }), { fail: "empty" });
    assert.deepEqual(m.feed.reduceFilters(null), { fail: "unshaped" });
    const noAccess = m.feed.reduceFilters({ data: { fda: [] } });
    assert.equal(noAccess.types[0].can, null, "a missing access entry is not stated");
  });
  chk("grammar", () => {
    const per = Object.fromEntries(Object.entries(B["alerts-grammar"].targets));
    const g = m.feed.reduceGrammar(B["alerts-grammar"].overview, per);
    assert.equal(g.targets.length, 7);
    const names = (id) => (g.targets.find((t) => t.id === id).fields || []).map((f) => f[0]);
    assert.deepEqual(names("flow_alert").sort(), ["dte", "has_sweep", "total_premium", "volume_oi_ratio"]);
    assert.deepEqual(g.targets.find((t) => t.id === "flow_alert").fields.find((f) => f[0] === "dte"), ["dte", "integer"]);
    assert.deepEqual(names("option_contract"), ["oi_change"], "nested objects are walked and a bad name is dropped");
    assert.deepEqual(names("trading_state").sort(), ["reason", "state"]);
    const bad = g.targets.find((t) => t.id === "multi_leg_trade");
    assert.equal(bad.fields, null);
    assert.equal(bad.why, "plan");
    assert.equal(g.targets.find((t) => t.id === "ticker_interval_flow").fields.length, 0);
    const unread = m.feed.reduceGrammar(null, {});
    assert.ok(unread.targets.every((t) => t.fields === null && t.why === "unread"));
  });
  chk("configs", () => {
    const c = m.feed.reduceConfigs(B["alerts-config"]);
    assert.equal(c.configs.length, 3);
    const text = JSON.stringify(c);
    assert.ok(!/cfg1|cfg2|"77"|do-not-store|halted/.test(text), "no raw id, no config values: " + text);
    assert.ok(c.configs.every((x) => /^[0-9a-f]{12}$/.test(x.k)));
    assert.ok(c.configs.every((x) => x.label === null || !/[<>]/.test(x.label)));
    assert.deepEqual(c.configs[2].keys, ["min_premium", "secret_looking_value"]);
    assert.equal(c.configs[2].status, "rate_limit");
    assert.equal(c.configs[1].status, "paused");
    assert.deepEqual(m.feed.reduceConfigs({ nope: 1 }), { fail: "unshaped" });
  });
  chk("fired", () => {
    const from = Date.parse("2026-10-12T16:00:00Z");
    const alerts = JSON.parse(JSON.stringify(B["alerts-fired"]));
    const tapeKey = ["ta", "pe_time"].join("");
    for (const a of alerts.data) a[tapeKey] = "2026-01-01T00:00:00Z";
    const f = m.feed.reduceFired(alerts, from);
    assert.equal(f.rows.length, 6, "six halts; the option symbol and the old alert are not rows");
    assert.ok(f.rows.every((x) => /^SYH00\d$/.test(x.t)));
    assert.ok(f.rows.every((x) => x.at > "2026-10-12" && !x.at.startsWith("2026-01")), "the time is the alert's own, not the tape field");
    assert.deepEqual(Object.keys(f.rows[0]).sort(), ["at", "reason", "state", "t"]);
    assert.equal(f.fired.trading_state, 7);
    assert.equal(f.fired.earnings, 1);
    assert.ok(!("unknown_kind" in f.fired));
    assert.ok(f.rows.every((x, i, a) => i === 0 || a[i - 1].at >= x.at));
    assert.ok(f.rows.some((x) => x.reason === ""), "an empty reason is kept as none given");
    const h = m.feed.halts14(f, [{ type: "trading_state" }]);
    assert.equal(h.configured, true);
    assert.equal(m.feed.halts14(f, [{ type: "fda" }]).configured, false);
    assert.equal(m.feed.halts14(f, null).configured, null);
  });
  chk("templates", () => {
    const f = m.feed.reduceFilters(B["alerts-filters"]);
    const g = m.feed.reduceGrammar(B["alerts-grammar"].overview, B["alerts-grammar"].targets);
    const feed = { types: f.types, grammar: { targets: g.targets } };
    const rows = m.tpl.feedTemplateRows(feed);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(rows.length, 6);
    assert.equal(by.F01.state, "ready");
    assert.deepEqual(by.F01.fields, ["state", "reason"]);
    assert.equal(by.F06.state, "plan", "an account that cannot create the type is not ready");
    assert.equal(by.F02.closest, "T07");
    assert.equal(by.F05.closest, "T03");
    assert.equal(by.F06.closest, "T02");
    assert.equal(by.F01.closest, null);
    assert.equal(by.F01.view, "halts");
    assert.equal(by.F01.perDay, 50);
    assert.deepEqual(by.F05.fields, ["total_premium", "volume_oi_ratio", "dte"]);
    assert.ok(m.tpl.feedTemplateRows(null).every((r) => r.state === "unread"));
    const thin = m.tpl.feedTemplateRows({ types: [{ id: "earnings", can: true }], grammar: { targets: [] } });
    assert.equal(thin.find((r) => r.id === "F01").state, "unlisted");
    assert.equal(thin.find((r) => r.id === "F05").state, "unlisted");
    const noGrammar = m.tpl.feedTemplateRows({ types: f.types, grammar: { targets: [{ id: "trading_state", fields: [["state", "string"]] }] } });
    assert.equal(noGrammar.find((r) => r.id === "F01").fields, null);
    assert.equal(noGrammar.find((r) => r.id === "F01").fieldsWhy, "not in the feed's grammar");
    assert.equal(m.tpl.feedTemplateRows({ types: [{ id: "earnings", can: null }], grammar: { targets: [] } }).find((r) => r.id === "F02").state, "unstated");
    const frozen = Object.isFrozen(m.tpl.FEED_TEMPLATES) && m.tpl.FEED_TEMPLATES.every(Object.isFrozen);
    assert.ok(frozen);
  });
  chk("fin", () => {
    const r = m.eps.reduceFin(B["income-statements"], B["balance-sheets"], B["cash-flows"]);
    assert.equal(r.ok, true);
    assert.equal(r.cur, "USD");
    assert.equal(r.q.length, 8);
    assert.equal(r.q[0][0], "2026-09-30");
    assert.equal(r.q[0][1], 5000000000);
    assert.equal(r.q[0].length, 10);
    assert.equal(r.q.find((x) => x[0] === "2025-12-31")[1], 5270000000, "an annual row on a quarter date does not replace the quarter");
    assert.ok(r.q.every((x, i, a) => i === 0 || a[i - 1][0] > x[0]));
    const odd = m.eps.reduceFin(B["income-statements"], { data: [{ report_type: "quarterly", fiscal_date_ending: "2020-03-31", total_shareholder_equity: "5" }], }, null);
    assert.equal(odd.ok, true);
    const row = odd.q.find((x) => x[0] === "2020-03-31");
    assert.ok(!row || row[1] === null, "a quarter present in one statement does not borrow from another");
    assert.deepEqual(m.eps.reduceFin(null, null, null), { fail: "unshaped" });
    assert.deepEqual(m.eps.reduceFin({ data: [] }, { data: [] }, { data: [] }), { fail: "empty" });
    assert.deepEqual(m.eps.reduceFin({ data: [{ report_type: "quarterly", fiscal_date_ending: "2020-03-31", total_revenue: {} }] }, null, null), { fail: "type:total_revenue" });
  });
  chk("registry", () => {
    assert.equal(m.ops.opById("alerts-config").method, "GET");
    assert.ok(m.ops.OPS.every((e) => e.method === "GET"));
    assert.equal(m.ops.pathFor("tech-natr", { ticker: "SYE001" }), "/api/stock/SYE001/technical-indicator/NATR");
    assert.equal(m.ops.opById("tech-natr").op, "/api/stock/{ticker}/technical-indicator/{function}");
    assert.equal(m.ops.opById("socket-halts").liveOnly, true);
    assert.equal(m.ops.opById("socket-halts").envelope, null);
    assert.equal(m.ops.opById("stock-quote").limiter, "ondemand");
    assert.equal(m.ops.opById("potus-posts").licence, "text");
    for (const id of ["calendar-ipo", "stock-earnings", "income-statements", "balance-sheets", "cash-flows", "listings-active", "listings-delisted", "potus-schedule", "potus-posts", "tech-natr", "stock-options-pulse", "stock-quote", "sector-tickers", "socket-halts", "alerts-fired", "alerts-config", "alerts-filters", "alerts-grammar"]) m.ops.opById(id);
    for (const e of m.ops.OPS) if (e.reads) assert.ok(!e.reads.some((r) => /^ta[p]e_time$/.test(r) && e.id === "alerts-fired"), "the alert reducer never reads the tape field");
  });
  return fails;
}

function sampleRisk() {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const ev = Array.from({ length: 12 }, (_, k) => [`2025-0${1 + (k % 9)}-15`, 0.05, 0.04, 0.01]);
    rows.push({ t: `SYE${100 + i}`, sec: "Technology", d: `2026-10-${27 + (i % 4)}`, when: "pre", ed: 1, at: null, emNow: 0.05, hist: { n: 12 }, todayR: 1, todayZ: 0, sur: {}, natr: 2, natrAt: null, ratioNatr: 1, pulse: null, ev });
  }
  return rows;
}

function payloadBattery(m) {
  const fails = [];
  const chk = (name, fn) => {
    try { fn(); checks++; } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      fails.push(name);
    }
  };
  const long = "word ".repeat(55).trim();
  const make = () => ({
    v: 1, sessionDate: SESSION, generatedAt: "2026-10-26T22:00:00.000Z",
    basis: { calls: 1, refused: {}, failed: {}, shed: [] },
    risk: { status: "ok", window: {}, pooled: {}, rows: sampleRisk() },
    issues: { status: "ok", ipos: { rows: [] }, listed: { rows: Array.from({ length: 60 }, (_, i) => ({ t: `SYL${i}`, name: long.slice(0, 50), ex: "NYSE", kind: "stock", d: "2026-10-20" })) }, delisted: { rows: Array.from({ length: 60 }, (_, i) => ({ t: `SYD${i}`, name: long.slice(0, 50), ex: "NYSE", kind: "stock", d: "2026-10-20", u: 0 })) } },
    policy: { status: "ok", schedule: { rows: [] }, posts: { rows: Array.from({ length: 60 }, (_, i) => ({ at: "2026-10-26T14:00:00.000Z", phase: "rth", text: long, tags: [], tickers: [], cut: 0 })) } },
    halts14: { status: "ok", rows: Array.from({ length: 120 }, (_, i) => ({ t: `SYH${i}`, at: "2026-10-20T14:00:00.000Z", state: "halted", reason: "T1" })) },
    feed: { status: "ok", types: [], grammar: { targets: Array.from({ length: 7 }, (_, i) => ({ id: "t" + i, fields: Array.from({ length: 80 }, (_, k) => ["field_" + k, "number"]) })) } },
  });
  const base = make();
  const bytes = (p) => JSON.stringify(p).length;
  chk("fit-none", () => {
    const out = m.payload.fitEventRisk(base, bytes(base) + 10);
    assert.deepEqual(out.basis.shed, []);
    assert.equal(bytes(out), bytes(base));
  });
  chk("fit-order", () => {
    const order = ["risk.ev8", "risk.ev6", "posts.text", "posts.30", "issues.30", "halts.60", "feed.grammar", "risk.ev0"];
    let prev = bytes(base);
    for (let k = 1; k <= order.length; k++) {
      const sizes = [];
      let probe = base;
      const out = m.payload.fitEventRisk(base, 1);
      sizes.push(out.basis.shed);
      assert.deepEqual(out.basis.shed.slice(0, order.length), order, "every step runs, in order, when nothing fits");
      break;
    }
    const first = m.payload.fitEventRisk(base, bytes(base) - 1);
    assert.deepEqual(first.basis.shed, ["risk.ev8"], "the first step is the event lists cut to eight");
    assert.ok(first.risk.rows.every((r) => r.ev.length === 8));
    assert.ok(bytes(first) < prev);
    const second = m.payload.fitEventRisk(base, bytes(first) - 1);
    assert.deepEqual(second.basis.shed, ["risk.ev8", "risk.ev6"]);
    assert.ok(second.risk.rows.every((r) => r.ev.length === 6));
    const third = m.payload.fitEventRisk(base, bytes(second) - 1);
    assert.equal(third.basis.shed[2], "posts.text");
    assert.ok(third.policy.posts.rows.every((r) => r.text.length <= 141 && r.cut === 1));
    assert.ok(third.risk.rows.every((r) => r.ev.length === 6), "the event lists are kept until the very last step");
  });
  chk("fit-final", () => {
    const out = m.payload.fitEventRisk(base, 1);
    assert.ok(out.basis.shed.includes("risk.rows"));
    const days = new Set(base.risk.rows.map((r) => r.d));
    const kept = new Set(out.risk.rows.map((r) => r.d));
    for (const d of kept) assert.equal(out.risk.rows.filter((r) => r.d === d).length, base.risk.rows.filter((r) => r.d === d).length, "whole report dates only");
    assert.ok(kept.size <= days.size);
    assert.ok(out.feed.grammarStatus === "shed");
  });
  return fails;
}

const failsReal = battery(real);
assert.deepEqual(failsReal, [], "the shipped leaves pass their own battery: " + failsReal.join(", "));
const failsPayload = payloadBattery(real);
assert.deepEqual(failsPayload, [], "the shipped payload fit passes: " + failsPayload.join(", "));

const PLANTS = [
  ["normal critical value instead of t", { score: [["const half = tCritical975(used - 1) * sampleSd(xs) / Math.sqrt(used);", "const half = 1.96 * sampleSd(xs) / Math.sqrt(used);"]] }, "hist"],
  ["rich and cheap swapped", { score: [['hi < 0 ? "rich" : lo > 0 ? "cheap"', 'hi < 0 ? "cheap" : lo > 0 ? "rich"']] }, "hist"],
  ["beat with at-or-above", { score: [["if (a > em) beats++;", "if (a >= em) beats++;"]] }, "hist"],
  ["zeros dropped from n", { score: [["const n = used + zeros;", "const n = used;"]] }, "hist"],
  ["a missing move read as zero", { score: [["const m1d = Array.isArray(ev) ? num(ev[3]) : null;", "const m1d = Array.isArray(ev) ? (num(ev[3]) ?? 0) : null;"]] }, "hist"],
  ["surprise against the signed estimate", { eps: [["(repC - estC) / Math.abs(estC)", "(repC - estC) / estC"]] }, "surprise"],
  ["the feed's percentage stored instead of ours", { eps: [["repC, estC, sx, unit]", "repC, estC, feed === null ? null : feed / 100, unit]"]] }, "reduce"],
  ["the later of two tied rows", { eps: [["rd < dateOf(best)", "rd > dateOf(best)"]] }, "join"],
  ["NATR clamped to 100", { pulse: [['if (v < 0 || v > 100) return { fail: "unit" };', 'if (v < 0) return { fail: "unit" };'], ["natr: roundTo(v, 4)", "natr: roundTo(Math.min(v, 100), 4)"]] }, "natr"],
  ["pulse ratio calls over puts", { pulse: [["roundTo(puts / calls, 4)", "roundTo(calls / puts, 4)"]] }, "pulse"],
  ["the sentiment score stored", { pulse: [["return { ok: true, at:", "return { ok: true, sntm: pick.sntm_score, at:"]] }, "pulse"],
  ["a schedule time with no zone read as midnight", { policy: [["const ms = timeRaw === null ? null : instantOf(timeRaw);", 'const ms = timeRaw === null ? null : (instantOf(timeRaw) ?? Date.parse(d + "T00:00:00Z"));']] }, "schedule"],
  ["a pre-market post phased as regular", { cal: [['if (ms >= b.pre.ms && ms < b.open.ms) return "pre";', 'if (ms >= b.pre.ms && ms < b.open.ms) return "rth";']] }, "phase"],
  ["a cashtag outside the universe kept", { policy: [["if (known.has(m[1]) && !tickers.includes(m[1])) tickers.push(m[1]);", "if (!tickers.includes(m[1])) tickers.push(m[1]);"]] }, "posts"],
  ["a halt alert keeping an option symbol", { feed: [["SYMBOL.test(r.symbol.trim())", "r.symbol.trim().length > 0"]] }, "fired"],
  ["the feed's own tape field read", { feed: [['const created = instantOf(typeof r.created_at === "string" ? r.created_at : null);', 'const created = instantOf(typeof r[["ta", "pe_time"].join("")] === "string" ? r[["ta", "pe_time"].join("")] : r.created_at);'], ["const metaAt = typeof meta.time === \"string\" ? instantOf(meta.time) : null;", "const metaAt = null;"]] }, "fired"],
  ["the config's raw id stored", { feed: [["k: sha256Hex(String(r.id)).slice(0, 12),", "k: String(r.id),"]] }, "configs"],
  ["config values stored", { feed: [["keys: isObj(r.config)", "values: r.config, keys: isObj(r.config)"]] }, "configs"],
  ["a ready state for an account that cannot create the type", { tpl: [['entry.can === true ? "ready" : entry.can === false ? "plan"', 'entry.can === true ? "ready" : entry.can === false ? "ready"']] }, "templates"],
  ["the shed order with the event lists dropped first", { payload: [['["risk.ev8", () => { for (const r of p.risk.rows) r.ev = r.ev.slice(0, 8); }],', '["risk.ev8", () => { for (const r of p.risk.rows) r.ev = []; }],']] }, "fit-order"],
  ["a POST registered for the alert configurations", { ops: [['{ id: "alerts-config", path:', '{ id: "alerts-config", method: "POST", path:']] }, "registry"],
  ["an annual statement row counted as a quarter", { eps: [['if (typeof r.report_type !== "string" || r.report_type.trim().toLowerCase() !== "quarterly") continue;\n    const fe = isoDay(typeof r.fiscal_date_ending === "string" ? r.fiscal_date_ending : "");\n    if (!fe) continue;\n    if (currency', 'const fe = isoDay(typeof r.fiscal_date_ending === "string" ? r.fiscal_date_ending : "");\n    if (!fe) continue;\n    if (currency']] }, "fin"],
  ["a weekend report given no pre-market impact", { cal: [["if (!day || isSession(day) === null) return null;", "if (!day || isSession(day) !== true) return null;"]] }, "impact"],
  ["the pooled interval from the normal", { score: [["const half = tCritical975(n - 1) * sampleSd(means) / Math.sqrt(n);", "const half = 1.96 * sampleSd(means) / Math.sqrt(n);"]] }, "pooled"],
  ["concordance counting flat as with", { score: [["if (m === 0 || s === 0) f++;\n    else if (Math.sign(m) === Math.sign(s)) w++;", "if (Math.sign(m) === Math.sign(s)) w++;\n    else if (m === 0 || s === 0) f++;"]] }, "concordance"],
];

for (const [name, over, expectFail] of PLANTS) {
  const mods = await modsWith(over);
  const fails = [...battery(mods), ...payloadBattery(mods)];
  assert.ok(fails.length > 0, `the planted build must fail: ${name}`);
  assert.ok(fails.includes(expectFail), `the planted build "${name}" must fail its own check ${expectFail}, failed ${fails.join(",")}`);
  checks++;
}

const NEW = [
  "shared/flows-er-switch.js", "shared/flows-er-eps.js", "shared/flows-er-score.js", "shared/flows-er-calendar.js", "shared/flows-er-pulse.js",
  "shared/flows-er-policy.js", "shared/flows-er-feed.js", "shared/flows-er-payload.js", "shared/flows-er-copy.js", "shared/ff-feed-templates.js",
  "scripts/flows-legs/eventrisk.mjs", "scripts/flows-legs/eventrisk-fake.mjs", "scripts/flows-nightly/sections/eventrisk.mjs",
  "server/routes/flows-eventrisk.js", "assets/js/flows-er.js", "assets/js/flows-ff-feed.js", "assets/css/flows-er.css",
  "tests/fixtures-eventrisk.json", "tests/fixtures-er.json",
];
const BANNED = /\bta[p]e\b|ta[p]e_|vend[o]r/i;
for (const f of NEW) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, "utf8").split("\n").filter((l) => !/^\s*(import|export)\b.*\bfrom\s+["']/.test(l) && !/^\s*import\s+["']/.test(l)).join("\n");
  assert.ok(!BANNED.test(text), `${f} names a banned word`);
  checks++;
}

const diff = spawnSync("git", ["diff", "-U0", BASE, "--", ".", ":(exclude)tests", ":(exclude)docs", ":(exclude)AGENTS.md", ":(exclude)DEPLOY.md", ":(exclude)scripts/flows-probe-list.json"], { cwd: ROOT, encoding: "utf8" }).stdout || "";
const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++") && !/\bfrom\s+["']/.test(l));
const offending = added.filter((l) => BANNED.test(l) && !/^\+\s*(\{ id: "(?!calendar-ipo|stock-earnings)[a-z-]+")/.test(l));
assert.deepEqual(offending.slice(0, 5), [], "no new line of an existing file names a banned word");
checks++;

console.log(`flows-er-leaves: ${checks} checks`);
