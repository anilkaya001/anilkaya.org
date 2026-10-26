process.env.TZ = "America/New_York";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import * as L from "../shared/flows-flow-net.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const plain = (x) => JSON.parse(JSON.stringify(x));

const SRC_PATH = "assets/js/flows-ticker-network.js";
const CSS_PATH = "assets/css/flows-ticker-network.css";
const SRC = fs.readFileSync(path.join(ROOT, SRC_PATH), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, CSS_PATH), "utf8");
const TICKER_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
const LEAF_SRC = fs.readFileSync(path.join(ROOT, "shared/flows-flow-net.js"), "utf8");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/;
const COPY = /\bat (the )?(ask|bid)\b|\btape\b/i;

function loadPage(src) {
  const sb = { globalThis: null, Math, Number, Array, Object, String, Set, Map, JSON, Date, Promise, Error, Boolean };
  sb.globalThis = sb;
  vm.runInNewContext(src, sb, { filename: "flows-ticker-network.js" });
  return sb.__FlowNetTest;
}
const API = loadPage(SRC);

const PAGE = FLOWS_PAGES.tickerPage({ username: "u" });
ok(/<i hidden data-defer="network" data-src="\/assets\/js\/flows-ticker-network\.js\?v=\d+" data-css="\/assets\/css\/flows-ticker-network\.css\?v=\d+" id="ftNetwork"><\/i>/.test(PAGE), "the ticker page declares the flow network as one hidden, versioned deferred file with its own sheet");
ok(!/<script[^>]+flows-ticker-network/.test(PAGE) && !/<link[^>]+flows-ticker-network/.test(PAGE), "and ships neither a script nor a stylesheet for it");
ok(/\.defer\("network", \{ when: "visible"/.test(TICKER_SRC) && !/data-defer="network"/.test(TICKER_SRC), "the controller defers the group when its module nears the viewport and declares nothing itself");
ok(/"m-network", "Flow network"/.test(TICKER_SRC) && /id: "m-network", title: "Flow network"/.test(TICKER_SRC), "the dock names the module and the controller builds it");
ok(!/Not built for this name\.", "m-tape"/.test(TICKER_SRC) && !/"m-network": "Not built for this name\."/.test(TICKER_SRC), "the dock no longer says the flow network is not built");
ok(!COLOUR.test(CSS), "the sheet holds no colour literal: tokens only");
ok(COLOUR.test(CSS + "\n.x { color: #fff; }"), "and the scan catches a planted literal");
ok(!COLOUR.test(SRC) && !COPY.test(SRC) && !COPY.test(CSS) && !COPY.test(LEAF_SRC), "no colour literal, no ask-or-bid phrase the copy lint bans and no word tape in the module, its sheet or its leaf");
ok(!/(^|[^:\w])\/\/[^\n]*|\/\*/.test(SRC.replace(/https?:\/\/\S+/g, "")) && !/\/\*/.test(CSS) && !/(^|[^:\w])\/\/ /.test(LEAF_SRC), "no comment in any of the three files");
ok(!/\bglobalThis\.|(?<![\w.])window\.[A-Za-z]+\s*=(?!=)/.test(SRC.replace(/globalThis\.__FlowNetTest/, "").replace("window.FlowsUI = Object.freeze(Object.assign({}, UI,", "")), "no new global");
ok(!/\blean\b/i.test(SRC.replace("No lean on this page", "")), "the module assigns no lean: the word appears only in the line that says there is none");
ok(!/bullish|bearish/i.test(SRC + CSS), "and uses neither the bullish nor the bearish word");
ok(!/--up\b|--down\b|--up-mark|--down-mark/.test(CSS), "nor the lean colours");

{
  eq(L.calendarDays("2025-03-07", "2025-03-14"), 7, "seven calendar days across the March change of clocks");
  eq(L.calendarDays("2025-03-07", "2025-03-15"), 8, "and eight");
  eq(API.daysBetween("2025-03-07", "2025-03-14"), 7, "the page counts them the same in the New York zone");
  eq(API.daysBetween("2025-03-07", "2025-03-15"), 8, "and does not lose a day to local time");
  eq(API.daysBetween("2025-10-31", "2025-11-03"), 3, "nor across the November change of clocks");
  eq(API.daysBetween("2025-11-03", "2025-10-31"), -3, "and an expiry before the session is negative");
  eq(API.daysBetween("2025-13-40", "2025-11-03") === null || Number.isFinite(API.daysBetween("2025-13-40", "2025-11-03")), true, "a malformed day is never NaN");
  eq(API.daysBetween("soon", "2025-11-03"), null, "a word is not a day");
  for (const [d, want] of [[0, "exp:d0"], [1, "exp:w1"], [7, "exp:w1"], [8, "exp:m1"], [31, "exp:m1"], [32, "exp:far"], [400, "exp:far"], [-1, null], [1.5, null], [null, null]]) {
    eq(L.expiryBucket(d), want, "the leaf buckets " + d + " days as " + want);
    eq(API.bucketOf(d), want, "and the page does");
  }
  const sigma = 0.30;
  const cases = [
    ["C", 102, 100, sigma, 30, "mny:near"], ["C", 103, 100, sigma, 30, "mny:otm"], ["P", 103, 100, sigma, 30, "mny:itm"],
    ["C", 97, 100, sigma, 30, "mny:itm"], ["P", 97, 100, sigma, 30, "mny:otm"],
    ["C", 101, 100, sigma, 0, "mny:otm"], ["C", 100.3, 100, sigma, 0, "mny:near"], ["P", 99, 100, sigma, 0, "mny:otm"],
    ["C", 105, 100, sigma, 400, "mny:near"], ["C", 112, 100, sigma, 400, "mny:otm"], ["C", 88, 100, sigma, 400, "mny:itm"],
    ["C", 102.5, 100, null, 30, "mny:near"], ["C", 102.6, 100, null, 30, "mny:otm"], ["P", 102.6, 100, null, 30, "mny:itm"], ["C", 97.4, 100, null, 30, "mny:itm"],
  ];
  for (const [cp, k, s, sg, d, want] of cases) {
    eq(L.moneyness(cp, k, s, sg, d), want, `${cp} ${k} on ${s} at vol ${sg} and ${d} days is ${want}`);
    eq(API.moneyOf(cp, k, s, sg, d), want, "and the page agrees");
  }
  near(0.30 * Math.sqrt(30 / 365), 0.0860, 5e-4, "hand check: 30 days at 30% is a standard deviation of 8.6% of spot");
  ok(Math.abs(Math.log(102 / 100)) / (0.30 * Math.sqrt(30 / 365)) < 0.25 && Math.abs(Math.log(103 / 100)) / (0.30 * Math.sqrt(30 / 365)) > 0.25, "102 is inside a quarter of it and 103 is outside");
  near(0.30 * Math.sqrt(1 / 365), 0.0157, 5e-4, "a same-day window at 30% has a standard deviation of 1.6% of spot, so a 2.5% band would call it all near");
  const TERM2 = [{ dte: 7, vol: 0.25 }, { dte: 30, vol: 0.45 }];
  near(L.volFor(18, TERM2, 0.4).vol, 0.41725, 1e-4, "hand worked: a window 18 days out between a 7-day row at 25% and a 30-day row at 45% has 0.4172 of volatility, not the nearer row's 0.25");
  near(L.volFor(18, TERM2, 0.4).vol, Math.sqrt((0.0625 * 7 + (0.2025 * 30 - 0.0625 * 7) * (11 / 23)) / 18), 1e-12, "which is linear total variance: 3.1337 over 18 days");
  eq(L.volFor(7, TERM2, 0.4).vol, 0.25, "at a listed expiry the row's own volatility");
  eq(L.volFor(30, TERM2, 0.4).vol, 0.45, "at the other");
  eq(L.volFor(3, TERM2, 0.4).vol, 0.25, "before the first row it is held flat");
  eq(L.volFor(90, TERM2, 0.4).vol, 0.45, "and after the last");
  ok(Math.abs(L.volFor(18, TERM2, 0.4).vol - L.volFor(19, TERM2, 0.4).vol) < 0.01, "and it moves smoothly across the midpoint of the two rows, where nearest-row would jump from 0.25 to 0.45");
  eq(L.volFor(18, [{ dte: 30, vol: 0.45 }, { dte: 7, vol: 0.25 }], 0.4).vol, L.volFor(18, TERM2, 0.4).vol, "whatever order the rows come in");
  eq(L.volFor(18, [{ dte: 0, vol: 0.9 }, ...TERM2], 0.4).vol, L.volFor(18, TERM2, 0.4).vol, "a zero-day row is dropped");
  eq(L.volFor(10, [], 0.4).vol, 0.4, "with no term the thirty-day vol");
  eq(L.volFor(10, null, null), null, "with neither, nothing");
  near(API.volAt(18, TERM2, 0.4), 0.41725, 1e-4, "the page interpolates the same way");
  eq(API.volAt(7, TERM2, 0.4), 0.25, "and returns the listed row at its own expiry");
  eq(API.volAt(30, TERM2, 0.4), 0.45, "and at the other");
  ok(Math.abs(API.volAt(18, TERM2, 0.4) - API.volAt(19, TERM2, 0.4)) < 0.01, "and is continuous across the midpoint");
  eq(API.volAt(18, [{ dte: 0, vol: 0.9 }, ...TERM2], 0.4), API.volAt(18, TERM2, 0.4), "and drops a zero-day row");
  eq(L.moneyness("C", 97.5, 100, null, 5), "mny:near", "the fixed band: 97.5 on a spot of 100 is exactly 2.5% below and near");
  eq(L.moneyness("C", 102.5, 100, null, 5), "mny:near", "and 102.5 exactly 2.5% above is near too, though 102.5 / 100 - 1 and 97.5 / 100 - 1 are not equal and opposite in floating point");
  eq(API.moneyOf("C", 97.5, 100, null, 5), "mny:near", "the page agrees below");
  eq(API.moneyOf("C", 102.5, 100, null, 5), "mny:near", "and above");
  eq(L.moneyness("C", 102.6, 100, null, 5), "mny:otm", "past the band a call above spot is out of the money");
  eq(L.shares([334, 333, 333]), [34, 33, 33], "the largest node never prints the smaller figure: 334, 333 and 333 are 34, 33 and 33, where cumulative rounding printed 33, 34 and 33");
  eq(plain(API.pctsOf([334, 333, 333])), [34, 33, 33], "the page agrees");
  eq(plain(API.pctsOf([0.2, 99.8])), [0, 100], "a node can round to nothing");
  eq(API.daysBetween("2025-01-10", "2025-13-45"), null, "a day that is not a date is never normalised into one");
  eq(API.daysBetween("2025-02-30", "2025-03-04"), null, "nor February 30");
  eq(L.calendarDays("2025-02-30", "2025-03-04"), null, "in the leaf either");
  eq(API.daysBetween("2024-02-29", "2024-03-01"), 1, "but the leap day is real");
  for (const values of [[1, 1, 1], [1, 2, 3, 4], [33, 33, 34], [0.5, 0.25, 0.25], [7, 3], [1, 1, 1, 1, 1, 1, 1]]) {
    eq(L.shares(values).reduce((a, x) => a + x, 0), 100, "the shares of " + values.join("/") + " add to exactly 100");
    eq(plain(API.pctsOf(values)), L.shares(values), "and the page's equal the leaf's");
  }
  {
    let s = 20261027;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    let kept = 0;
    for (let t = 0; t < 3000; t++) {
      const n = 1 + Math.floor(rnd() * 8);
      const values = Array.from({ length: n }, () => (rnd() < 0.15 ? Math.floor(rnd() * 3) + 1 : rnd() * 1000 + 1));
      const out = L.shares(values);
      eq(out.reduce((a, x) => a + x, 0), 100, "the shares add to 100");
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (values[a] > values[b] && out[a] < out[b]) { ok(false, "a larger node printed a smaller share: " + values.join("/") + " gave " + out.join("/")); }
      kept++;
      eq(plain(API.pctsOf(values)), out, "the page's shares equal the leaf's");
    }
    ok(kept === 3000, "and a larger node never prints a smaller share, over 3000 random columns");
  }
  eq(L.shares([0, 0]), [null, null], "an empty column has no shares");
}

const SESSION = "2026-08-24";
const dot = (p, cp, k, e, a = 0.5, sw = false, op = false) => ({ m: 100, p, cp, k, e, a, sw, op });
const CTX = { session: SESSION, spot: 100, iv30: 0.3, term: null };
const mk = (dots, extra = {}) => ({ status: "ok", asOf: SESSION, n: dots.length, complete: true, prem: dots.reduce((a, d) => a + d.p, 0), dots, ...extra });
const WORLD = mk([
  dot(1000000, "C", 100, "2026-08-24", 1, true, true), dot(2000000, "P", 98, "2026-08-28", 0.25, false, true), dot(3000000, "C", 110, "2026-09-04", 0, true, false),
  dot(500000, "P", 90, "2026-10-30", 0.75, false, false), dot(1500000, "C", 101, "2026-08-31", 0.5, false, false), dot(800000, "P", 108, "2026-09-18", 0.6, true, true),
]);

{
  const net = L.buildNet(WORLD, CTX);
  eq(net.state, "ok", "six windows make a map");
  eq(net.windows, 6, "all six are drawn");
  near(net.total, 8800000, 1e-6, "the drawn premium is the sum of the windows");
  eq(net.cover, 1, "and they are all of the name's flagged premium");
  eq(net.columns.map((c) => c.key), ["side", "expiry", "money", "flags"], "four columns in order");
  for (const c of net.columns) {
    near(c.nodes.reduce((a, n) => a + n.v, 0), net.total, 1e-6, "the " + c.key + " column adds to the total");
    eq(c.nodes.reduce((a, n) => a + n.pct, 0), 100, "and its shares to exactly 100");
  }
  net.bands.forEach((list, j) => near(list.reduce((a, b) => a + b.v, 0), net.total, 1e-6, "hop " + j + " adds to the total"));
  const side = Object.fromEntries(net.columns[0].nodes.map((n) => [n.id, n.v]));
  near(side["side:ca"], 1000000 * 1 + 1500000 * 0.5, 1e-6, "calls on the ask side: the first window's whole premium and half of the fifth");
  near(side["side:cr"], 3000000 + 1500000 * 0.5, 1e-6, "calls, rest: the third whole and the other half of the fifth");
  near(side["side:pa"], 2000000 * 0.25 + 500000 * 0.75 + 800000 * 0.6, 1e-6, "puts on the ask side by each window's own ask share");
  near(side["side:pr"], 2000000 * 0.75 + 500000 * 0.25 + 800000 * 0.4, 1e-6, "puts, rest");
  const exp = Object.fromEntries(net.columns[1].nodes.map((n) => [n.id, n.v]));
  near(exp["exp:d0"], 1000000, 1e-6, "the same-day window is its own bucket");
  near(exp["exp:w1"], 2000000 + 1500000, 1e-6, "four and seven days are in one to seven");
  near(exp["exp:m1"], 3000000 + 800000, 1e-6, "eleven and twenty-five days are in eight to thirty-one");
  near(exp["exp:far"], 500000, 1e-6, "and sixty-seven is beyond");
  const mn = Object.fromEntries(net.columns[2].nodes.map((n) => [n.id, n.v]));
  eq(Object.keys(mn).sort(), ["mny:itm", "mny:near", "mny:otm"], "all three strike nodes are used");
  ok(!net.paths.some((p) => p.ids.length !== 4), "every path has four stops");
  const bad = L.buildNet(mk([dot(1e6, "C", 100, "2026-08-24", 0.5, true, true)]), CTX);
  eq(bad.state, "thin", "one window is too few for a map");
  eq(L.buildNet(WORLD, { ...CTX, spot: null }).columns.map((c) => c.key), ["side", "expiry", "flags"], "with no spot the strike column is not drawn, not guessed");
  eq(L.buildNet(WORLD, { ...CTX, spot: null }).basis, "none", "and the basis says so");
  eq(L.buildNet(WORLD, { ...CTX, iv30: null }).basis, "fixed", "with a spot and no volatility the band is the fixed 2.5% and says so");
  ok(L.buildNet(WORLD, { ...CTX, iv30: null }).columns[2].nodes.every((n) => /2\.5%/.test(n.label)), "its nodes name the 2.5%, not near the money");
  eq(L.buildNet(WORLD, CTX).basis, "iv30", "with only the 30-day volatility the band is scaled by it and the basis says so");
  eq(L.buildNet(WORLD, { ...CTX, term: [{ dte: 7, vol: 0.25 }, { dte: 30, vol: 0.45 }] }).basis, "term", "with the term structure it is interpolated and the basis says so");
  eq(L.buildNet(WORLD, { ...CTX, term: [{ dte: 0, vol: 0.25 }], iv30: null }).basis, "fixed", "a term of zero-day rows is no term");
  eq(L.buildNet(mk([]), CTX).state, "quiet", "no windows is quiet");
  eq(L.buildNet({ status: "quiet" }, CTX).state, "quiet", "a quiet record is quiet");
  eq(L.buildNet(undefined, CTX).state, "unavailable", "no record is unavailable, never an empty map");
  const noSession = L.buildNet({ status: "ok", n: 6, complete: true, prem: 8.8e6, dots: WORLD.dots }, { spot: 100, iv30: 0.3 });
  eq(noSession.state, "unavailable", "windows with no session date cannot be placed: unavailable, not quiet");
  ok(/no session date/.test(noSession.reason), "and the reason names the missing date: " + noSession.reason);
  const bad2 = L.buildNet(mk(WORLD.dots.map((d) => ({ ...d, cp: "X" }))), CTX);
  eq(bad2.state, "unavailable", "windows that all fail are unavailable");
  ok(/missing or invalid price, side, strike or expiry/.test(bad2.reason), "with the reason that names the side as well: " + bad2.reason);
  eq(L.buildNet({ status: "unavailable", why: "store." }, CTX).reason, "The flagged windows are not available: store.", "a reason that ends in a full stop does not print two");
  eq(L.buildNet({ ...WORLD, complete: undefined }, CTX).complete, null, "a record that does not say whether it is complete is not called complete");
  eq(L.buildNet({ ...WORLD, prem: -5 }, CTX).cover, null, "a negative premium is not stated, and is not blamed on the windows");
  eq(L.buildNet({ ...WORLD, prem: -5 }, CTX).state, "ok", "so the map still draws");
  const tiny = L.buildNet(mk(Array.from({ length: 5 }, () => dot(20.22, "C", 100, "2026-08-28", 0.5, true, true)), { prem: 100 }), CTX);
  ok(tiny.gap >= 0, "the width of the warning is never negative: " + tiny.gap);
  eq(L.buildNet({ ...WORLD, asOf: "2026-08-21" }, CTX).state, "stale", "windows of another session are stale");
  eq(L.buildNet({ ...WORLD, prem: 1000 }, CTX).state, "inconsistent", "windows that add to more than the name's premium are refused");
  const half = L.buildNet({ ...WORLD, prem: 17600000 }, CTX);
  near(half.cover, 0.5, 1e-9, "coverage is premium over premium: half");
  eq(half.coverNote, "wide", "half is wide");
  eq(half.gap, 50, "and the name-wide share can differ by up to fifty points");
  eq(L.buildNet({ ...WORLD, prem: 40000000 }, CTX).coverNote, "largest", "under half it is the largest windows only");
  eq(L.buildNet({ ...WORLD, n: 49 }, CTX).cover, 1, "the count of windows is not the coverage");
  const nulls = L.buildNet(mk([...WORLD.dots, { ...dot(400000, "C", 100, "2026-08-28", 0.5, true, true), a: null }, { ...dot(300000, "P", 100, "2026-08-28", 0.5, true, true), sw: undefined }]), CTX);
  eq(nulls.excluded.unattributed, 1, "a window with no ask share is counted");
  eq(nulls.excluded.unflagged, 1, "and one with no flag is counted");
  ok(nulls.columns[3].nodes.some((n) => n.id === "flg:u" && n.v === 300000), "and its premium sits in flags not read, not in neither flag");
  near(nulls.columns[0].nodes.find((n) => n.id === "side:cr").v, WORLD.dots[2].p + 1500000 * 0.5 + 400000, 1e-6, "the window with no ask share is all in the rest, never coerced to the ask side");
  const excl = L.buildNet(mk([...WORLD.dots, dot(700000, "C", 100, "2026-08-20"), dot(100000, "C", 100, "soon")]), CTX);
  eq(excl.excluded.window, 2, "an expiry before the session and a malformed one are excluded");
  for (const c of excl.columns) near(c.nodes.reduce((a, n) => a + n.v, 0), excl.total, 1e-6, "and every column still adds to the total: " + c.key);
  const r = L.readoutFor(net, "side:pa");
  near(r.v, 2000000 * 0.25 + 500000 * 0.75 + 800000 * 0.6, 1e-6, "the readout of puts on the ask side is those windows' premium");
  eq(r.others.map((o) => o.key), ["expiry", "money", "flags"], "with the other three columns");
  for (const o of r.others) near(o.rows.reduce((a, x) => a + x.v, 0), r.v, 1e-6, "each distribution is over the selected windows only: " + o.key);
  const chained = net.bands[0].filter((b) => b.a === "side:pa");
  ok(r.others[0].rows.length === chained.length && r.others[0].rows.every((x) => Math.abs(x.v - chained.find((b) => b.b === x.id).v) < 1e-6), "for the first hop the joint is the band, as it must be");
  const second = net.bands[1].filter((b) => b.a === "exp:m1").reduce((a, b) => a + b.v, 0);
  near(second, 3800000, 1e-6, "the second hop carries the whole of the expiry node, whatever side it came from");
  const joint = L.readoutFor(net, "side:pa").others[1].rows.find((x) => x.id === "mny:near");
  const chain = L.readoutFor(net, "side:pa").others[0].rows.reduce((a, row) => a + row.v * (net.bands[1].filter((b) => b.a === row.id && b.b === "mny:near").reduce((s, b) => s + b.v, 0) / net.columns[1].nodes.find((n) => n.id === row.id).v), 0);
  ok(joint === undefined ? chain > 0 : Math.abs(joint.v - chain) > 1, "and the joint over the windows differs from the chained product of the bands, which is why the readout uses the windows");
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function randomWorld(r) {
  const n = Math.floor(r() * 40);
  const days = (k) => new Date(Date.UTC(2026, 7, 24) + k * 864e5).toISOString().slice(0, 10);
  const dots = [];
  for (let i = 0; i < n; i++) {
    dots.push({
      m: Math.floor(r() * 390), p: r() < 0.03 ? null : r() < 0.02 ? -5 : Math.round(r() * 3e6 + 1e4),
      cp: r() < 0.03 ? "X" : r() < 0.5 ? "C" : "P", k: r() < 0.04 ? (r() < 0.5 ? null : 0) : Math.round((60 + r() * 80) * 100) / 100,
      e: r() < 0.04 ? "nonsense" : days(Math.floor(r() * (r() < 0.3 ? 3 : 500)) - (r() < 0.04 ? 5 : 0)),
      a: r() < 0.06 ? null : r() < 0.03 ? 1.4 : Math.round(r() * 1000) / 1000,
      sw: r() < 0.05 ? undefined : r() < 0.4, op: r() < 0.05 ? null : r() < 0.5,
    });
  }
  const sum = dots.reduce((a, d) => a + (d.p > 0 ? d.p : 0), 0);
  const prem = r() < 0.1 ? null : r() < 0.05 ? Math.round(sum * 0.5) : Math.round(sum * (1 + r() * 2.5));
  const ctx = {
    session: SESSION, spot: r() < 0.1 ? null : 100, iv30: r() < 0.15 ? null : 0.15 + r() * 0.6,
    term: r() < 0.3 ? null : [{ dte: 5, vol: 0.2 + r() * 0.5 }, { dte: 33, vol: 0.2 + r() * 0.4 }, { dte: 180, vol: 0.2 + r() * 0.3 }],
  };
  const status = r() < 0.04 ? "quiet" : r() < 0.03 ? "pending" : "ok";
  return { alerts: { status, asOf: r() < 0.04 ? "2026-08-21" : SESSION, n: n + Math.floor(r() * 30), complete: r() < 0.7, prem, dots }, ctx };
}

const BATTERY = [];
{
  const r = lcg(20261026);
  for (let i = 0; i < 600; i++) BATTERY.push(randomWorld(r));
  BATTERY.push({ alerts: WORLD, ctx: CTX }, { alerts: WORLD, ctx: { ...CTX, spot: null } }, { alerts: WORLD, ctx: { ...CTX, iv30: null } });
  const edge = [
    dot(1e6, "C", 100, "2025-03-15", 0.5, true, true), dot(1e6, "P", 100, "2025-03-14", 0.5, true, true), dot(1e6, "C", 100, "2025-03-07", 0.5, true, true),
    dot(1e6, "C", 105, "2025-04-30", 0.5, false, false), dot(1e6, "P", 95, "2025-03-10", 0.5, false, false), dot(1e6, "C", 100.2, "2025-03-07", 0.5, false, true),
  ];
  BATTERY.push({ alerts: { ...mk(edge), asOf: "2025-03-07" }, ctx: { session: "2025-03-07", spot: 100, iv30: 0.3, term: null } });
  const spots = [97.5, 102.5, 102.6, 97.4, 100].map((k) => dot(1e6, "C", k, "2026-08-28", 0.5, true, true));
  BATTERY.push({ alerts: mk(spots), ctx: { session: SESSION, spot: 100, iv30: null, term: null } });
  BATTERY.push({ alerts: mk([...spots, dot(1e6, "P", 100, "2026-13-45", 0.5, true, true), dot(1e6, "P", 100, "2026-02-30", 0.5, true, true)]), ctx: { session: SESSION, spot: 100, iv30: 0.3, term: [{ dte: 0, vol: 0.9 }, { dte: 7, vol: 0.25 }, { dte: 30, vol: 0.45 }] } });
  BATTERY.push({ alerts: mk(Array.from({ length: 6 }, (_, i) => dot(1e6, i % 2 ? "C" : "P", 100 + i, "2026-09-11", 0.5, true, true))), ctx: { session: SESSION, spot: 100, iv30: 0.3, term: [{ dte: 7, vol: 0.25 }, { dte: 30, vol: 0.45 }] } });
  BATTERY.push({ alerts: { status: "ok", n: 6, complete: true, prem: 8.8e6, dots: WORLD.dots }, ctx: { spot: 100, iv30: 0.3 } });
  BATTERY.push({ alerts: { status: "unavailable", why: "store." }, ctx: CTX });
  BATTERY.push({ alerts: { ...WORLD, complete: undefined }, ctx: CTX });
  BATTERY.push({ alerts: { ...WORLD, prem: -5 }, ctx: CTX });
  BATTERY.push({ alerts: mk(Array.from({ length: 5 }, () => dot(20.22, "C", 100, "2026-08-28", 0.5, true, true)), { prem: 100 }), ctx: CTX });
  BATTERY.push({ alerts: mk(Array.from({ length: 6 }, (_, i) => dot(3340 + (i < 1 ? 0 : -1), "C", 100, "2026-08-28", 0.5, true, true)), { prem: 20000 }), ctx: CTX });
  BATTERY.push({ alerts: mk([dot(1, "C", 100, "2026-08-24", 0.5, true, true), dot(1, "C", 100, "2026-08-24", 0.5, true, true), dot(1, "C", 100, "2026-08-24", 0.5, true, true), dot(1, "C", 100, "2026-08-24", 0.5, true, true), dot(1, "C", 100, "2026-08-24", 0.5, true, true)]), ctx: CTX });
}

const compare = (A) => {
  const bad = [];
  BATTERY.forEach((w, i) => {
    let a, b;
    try { a = plain(A.model(w.alerts, w.ctx)); b = plain(L.buildNet(w.alerts, w.ctx)); } catch (e) { bad.push("world " + i + " threw: " + String(e.message).split("\n")[0]); return; }
    try { assert.deepStrictEqual(a, b); } catch { bad.push("world " + i + " differs from the leaf"); return; }
    if (a.state === "ok" || a.state === "thin") {
      for (const c of a.columns) {
        if (Math.abs(c.nodes.reduce((s, n) => s + n.v, 0) - a.total) > 1e-6 * Math.max(1, a.total)) bad.push("world " + i + " column " + c.key + " does not add to the total");
        if (c.nodes.reduce((s, n) => s + n.pct, 0) !== 100) bad.push("world " + i + " column " + c.key + " shares do not add to 100");
        for (const m of c.nodes) for (const n of c.nodes) if (m.v > n.v && m.pct < n.pct) bad.push("world " + i + " column " + c.key + ": a larger node prints a smaller share");
      }
      a.bands.forEach((list, j) => { if (Math.abs(list.reduce((s, x) => s + x.v, 0) - a.total) > 1e-6 * Math.max(1, a.total)) bad.push("world " + i + " hop " + j + " does not add to the total"); });
      if (a.cover !== null && Math.abs(a.cover - a.total / a.prem) > 1e-12) bad.push("world " + i + " coverage is not premium over premium");
      for (const c of a.columns) for (const n of c.nodes.slice(0, 2)) {
        let x, y;
        try { x = plain(A.readout(a, n.id)); y = plain(L.readoutFor(b, n.id)); } catch (e) { bad.push("world " + i + " readout threw"); continue; }
        try { assert.deepStrictEqual(x, y); } catch { bad.push("world " + i + " readout of " + n.id + " differs from the leaf"); }
      }
    }
  });
  return bad;
};

{
  const bad = compare(API);
  eq(bad.slice(0, 3), [], "the page's model equals the leaf over " + BATTERY.length + " worlds, and every column, hop, share and readout holds");
  const states = new Map();
  for (const w of BATTERY) { const s = API.model(w.alerts, w.ctx).state; states.set(s, (states.get(s) || 0) + 1); }
  ok(["ok", "thin", "quiet", "stale", "pending", "inconsistent"].every((s) => (states.get(s) || 0) > 0), "the worlds reach every state: " + [...states].map((x) => x.join("=")).join(" "));
}

const MUTANTS = [
  ["the card's ask share used for the side column", "const ask = ok ? p * a : 0;", "const ask = ok ? p * (num(alerts.askShare) === null ? 0.5 : alerts.askShare) : 0;"],
  ["a missing ask share not counted", "if (!ok) excluded.unattributed++;", ""],
  ["a missing ask share read as zero and the premium dropped", "const ask = ok ? p * a : 0;", "const ask = ok ? p * a : -1;"],
  ["a missing flag read as neither", ": \"flg:u\";", ": \"flg:n\";"],
  ["an ask share past one accepted", "const ok = a !== null && a >= 0 && a <= 1;", "const ok = a !== null && a >= 0;"],
  ["moneyness not scaled by the expiry", "(sigma * Math.sqrt(Math.max(days, 1) / DAYS_PER_YEAR))", "sigma"],
  ["no one-day floor", "Math.max(days, 1) / DAYS_PER_YEAR", "days / DAYS_PER_YEAR"],
  ["calls and puts swapped", "(cp === \"C\") === (z < 0)", "(cp === \"P\") === (z < 0)"],
  ["the nearer expiry's volatility instead of the interpolated one", "return Math.sqrt((wa + ((wb - wa) * (t - a.dte)) / (b.dte - a.dte)) / t);", "return t - a.dte < b.dte - t ? a.vol : b.vol;"],
  ["volatility interpolated in vol, not in total variance", "return Math.sqrt((wa + ((wb - wa) * (t - a.dte)) / (b.dte - a.dte)) / t);", "return a.vol + ((b.vol - a.vol) * (t - a.dte)) / (b.dte - a.dte);"],
  ["coverage by window count", "const cover = prem !== null && prem > 0 ? total / prem : null;", "const cover = prem !== null && prem > 0 && num(alerts.n) ? drawn / alerts.n : null;"],
  ["the fixed band at three percent", "const FIXED_BAND = 0.025;", "const FIXED_BAND = 0.03;"],
  ["the fixed band by a ratio, asymmetric at the edge", "if (Math.abs(z) <= FIXED_BAND * spot) return \"mny:near\";", "if (Math.abs(k / spot - 1) <= FIXED_BAND) return \"mny:near\";"],
  ["the near band at half a deviation", "const NEAR_Z = 0.25;", "const NEAR_Z = 0.5;"],
  ["local time for the day count", "return Math.round((y - x) / 864e5);", "return Math.floor((new Date(+b[1], +b[2] - 1, +b[3]) - new Date(+a[1], +a[2] - 1, +a[3])) / 864e5);"],
  ["a day that is not a date normalised into one", "if (new Date(x).toISOString().slice(0, 10) !== a[0] || new Date(y).toISOString().slice(0, 10) !== b[0]) return null;", ""],
  ["the leftover units handed to the first nodes", "y[0] - x[0] || y[1] - x[1] || x[2] - y[2]", "x[2] - y[2]"],
  ["no leftover units handed out", "for (let j = 0; left > 0 && j < order.length; j++, left--) out[order[j][2]]++;", ""],
  ["a window with no placeable expiry kept in some columns", "cp === null || bucket === null || (spot", "cp === null || (spot"],
  ["the readout ignores the selection", "for (const x of mine) sums.set(x.nodes[c.index]", "for (const x of net.parts) sums.set(x.nodes[c.index]"],
  ["a strike of zero placed", "(spot !== null && !(k > 0))", "(spot !== null && k === null)"],
  ["the same-day bucket folded into the week", "d === 0 ? \"exp:d0\" : d <= 7", "d <= 7 ? \"exp:w1\" : d <= 7"],
  ["windows with no session date called quiet", "return { state: \"unavailable\", reason: day === null", "return { state: \"quiet\", reason: day === null"],
  ["an unfinished record called complete", "complete: typeof alerts.complete === \"boolean\" ? alerts.complete : null,", "complete: alerts.complete !== false,"],
  ["a negative premium believed", "const prem = num(alerts.prem) !== null && alerts.prem >= 0 ? alerts.prem : null;", "const prem = num(alerts.prem);"],
  ["the warning's width allowed to go negative", "Math.max(0, Math.round(100 * (1 - cover)))", "Math.round(100 * (1 - cover))"],
  ["a reason that ends in a full stop printed twice", ".replace(/[.\\s]+$/, \"\")", ""],
  ["the readout's share not the chip's", "pct: node.pct, v: mine.reduce", "pct: Math.round((mine.reduce((s, x) => s + x.v, 0) / net.total) * 100), v: mine.reduce"],
];
for (const [name, from, to] of MUTANTS) {
  ok(SRC.split(from).length === 2, "the planted build changes the module exactly once: " + name);
  const mutated = loadPage(SRC.replace(from, to));
  const bad = compare(mutated);
  ok(bad.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (first: " + bad[0] + ")");
}

const EMIT = nightlyEmit();
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EMIT, f), "utf8"));
const T = "AAPL";
const card = rd(`-card-${T}.json`);
const CARD_X = rd(`-card-x-${T}.json`);
const SUMMARY = { status: "quiet", scope: T, summary: null, ideas: [], tier: "family", code: null, why: "x", read: { version: 1, status: "absent", ticker: T, generated: false, label: "Deterministic reading", provenance: "", note: null, why: null, coverage: { ok: 0, partial: 0, withheld: 0, pending: 0 }, tags: [], sections: { identity: null, now: null, drivers: [], tensions: [], watch: [], unknown: [] }, refused: [] } };
const NOW = { serverNow: Date.parse("2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card.sessionDate, trading: false, endsAt: null }, keys: {} };

const browser = await chromium.launch();
const SHOTS = process.env.NET_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function open(w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(w < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
  const cx = o.cardX === undefined ? CARD_X : o.cardX;
  let release;
  const gate = new Promise((r) => { release = r; });
  const asked = [];
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/assets/js/flows-ticker-network.js" && o.src) return route.fulfill({ contentType: "text/javascript", body: o.src });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"rt_off"}}' });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      asked.push(key);
      if (key === "card-x" && o.holdCardX) await gate;
      const body = key === "card" ? (o.card || card) : key === "card-x" ? cx : key === "summary" ? SUMMARY : key === "now" ? NOW : key === "hist" ? { status: "absent" } : { status: "pending" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/ticker/?t=" + T);
  await page.waitForSelector("#ftGrid > #m-network", { state: "attached", timeout: 20000 });
  return { ctx, page, errors, asked, release };
}

const openModule = async (page) => {
  await page.click('.ft-dock-b[data-mod="m-network"]');
  await page.waitForSelector(".ft-sheet-b .fnw", { timeout: 15000 });
  await page.waitForTimeout(250);
};

const stateOf = async (page) => {
  const state = await page.$eval(".fnw", (e) => e.dataset.state);
  const silent = await page.$(".fnw .ui-silent");
  if (!silent) return { state, reason: null, text: await page.$eval(".fnw", (e) => e.textContent) };
  await page.click(".fnw .ui-silent button");
  await page.waitForSelector("#fxPop:not([hidden])", { timeout: 3000 }).catch(() => {});
  const reason = await page.evaluate(() => { const p = document.getElementById("fxPop"); return p ? p.textContent : ""; });
  await page.keyboard.press("Escape");
  return { state, reason, text: "" };
};

const fmtMoney = (page, v) => page.evaluate((x) => window.FlowsUI.F.money(x), v);

const MODEL_CTX = () => {
  const vc = card.panels.volContext;
  return { session: card.sessionDate, spot: card.panels.pricedMove.spot, iv30: vc.iv30, term: vc.term.rows };
};

{
  const NET = L.buildNet(CARD_X.alerts, MODEL_CTX());
  eq(NET.state, "ok", "the emit's AAPL record makes a map");
  for (const [w, h] of [[1440, 820], [1024, 768], [390, 844]]) {
    const { ctx, page, errors } = await open(w, h);
    const btn = await page.$('.ft-dock-b[data-mod="m-network"]');
    ok(btn && (await btn.getAttribute("aria-disabled")) !== "true", w + ": the dock's Flow network button is live");
    await openModule(page);
    const st = await page.evaluate(() => { const f = document.querySelector(".fnw"); return { state: f.dataset.state, link: !!document.querySelector('link[href*="flows-ticker-network.css"]'), seg: !!f.querySelector(".ui-seg") }; });
    eq(st.state, "ok", w + ": the module is drawn");
    ok(st.link, w + ": its sheet loaded from the group's data-css");
    const wide = w >= 720;
    const view = await page.evaluate(() => ({ stage: !document.querySelector(".fnw-stage").hidden, table: !document.querySelector(".fnw-table").hidden, chips: document.querySelectorAll(".fnw-chip").length, narrow: !document.querySelector(".fnw-cover[hidden]") }));
    if (wide) {
      ok(view.stage && !view.table, w + ": the map is shown");
      eq(view.chips, NET.columns.reduce((a, c) => a + c.nodes.length, 0), w + ": one chip for every node of the model");
      const chips = await page.$$eval(".fnw-chip", (els) => els.map((e) => ({ id: e.dataset.id, text: e.innerText.replace(/\s+/g, " ").trim(), label: e.getAttribute("aria-label"), l: parseFloat(e.style.left), t: parseFloat(e.style.top), w: parseFloat(e.style.width), h: parseFloat(e.style.height) })));
      for (const c of NET.columns) for (const n of c.nodes) {
        const chip = chips.find((x) => x.id === n.id);
        ok(chip && chip.text === n.label + " " + (await fmtMoney(page, n.v)) + " · " + (n.pct === 0 ? "<1%" : n.pct + "%"), w + ": the chip for " + n.id + " prints its label, its premium and its share: " + (chip && chip.text));
      }
      const paths = await page.$$eval(".fnw-bands path", (els) => els.map((e) => ({ d: e.getAttribute("d"), sw: parseFloat(e.getAttribute("stroke-width")), cls: e.getAttribute("class") })));
      eq(paths.length, NET.bands.reduce((a, l) => a + l.length, 0), w + ": one band for every pair of nodes");
      const edges = paths.map((p) => { const m = /^M([\d.\-]+),([\d.\-]+)C[\d.\-]+,[\d.\-]+ [\d.\-]+,[\d.\-]+ ([\d.\-]+),([\d.\-]+)$/.exec(p.d); return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], sw: p.sw }; });
      let off = 0;
      const flat = NET.bands.flat();
      flat.forEach((b, i) => {
        const a = chips.find((x) => x.id === b.a), z = chips.find((x) => x.id === b.b);
        const e = edges[i];
        if (Math.abs(e.x1 - (a.l + a.w)) > 0.5 || Math.abs(e.x2 - z.l) > 0.5 || e.y1 < a.t - 1 || e.y1 > a.t + a.h + 1 || e.y2 < z.t - 1 || e.y2 > z.t + z.h + 1) off++;
      });
      eq(off, 0, w + ": every band starts on the right edge of its source chip and ends on the left edge of its target, inside both");
      const scale = flat.map((b, i) => (b.v * 1 > 0 ? edges[i].sw / b.v : 0)).filter((x, i) => edges[i].sw > 1.26);
      ok(scale.length > 3 && Math.max(...scale) - Math.min(...scale) < 1e-9 * Math.max(...scale) + 1e-12, w + ": band width is proportional to premium on one scale");
      const first = NET.columns[0].nodes.slice().sort((a, b) => b.v - a.v)[0];
      eq(await page.$eval('.fnw-chip[aria-pressed="true"]', (e) => e.dataset.id), first.id, w + ": the largest side node is selected at rest");
      const want = await page.evaluate((r) => window.FlowsUI.flowNet.sentence(r), L.readoutFor(NET, first.id));
      eq(await page.$eval(".fnw-read", (e) => e.textContent), want, w + ": the readout is the sentence of the leaf's readout");
      const pick = NET.columns[1].nodes[NET.columns[1].nodes.length - 1];
      await page.click('.fnw-chip[data-id="' + pick.id + '"]');
      eq(await page.$eval('.fnw-chip[aria-pressed="true"]', (e) => e.dataset.id), pick.id, w + ": a click selects a chip");
      const r2 = L.readoutFor(NET, pick.id);
      eq(await page.$eval(".fnw-read", (e) => e.textContent), await page.evaluate((r) => window.FlowsUI.flowNet.sentence(r), r2), w + ": and the readout follows");
      const fills = await page.$$eval(".fnw-chip", (els) => els.map((e) => [e.dataset.id, parseFloat(e.querySelector(".fnw-fill").style.width)]));
      for (const c of NET.columns) for (const n of c.nodes) {
        const col = NET.columns.indexOf(c);
        const idx = NET.columns.find((x) => x.nodes.some((m) => m.id === pick.id)).index;
        let part = 0;
        for (const x of NET.parts) if (x.nodes[idx] === pick.id && x.nodes[c.index] === n.id) part += x.v;
        const f = fills.find((q) => q[0] === n.id)[1];
        ok(Math.abs(f - Math.round(Math.min(1, part / n.v) * 100)) < 0.01, w + ": the selected windows' slice of " + n.id + " is drawn at " + Math.round(Math.min(1, part / n.v) * 100) + "% (" + f + ")");
        void col;
      }
      await page.focus('.fnw-chip[data-id="' + pick.id + '"]');
      await page.keyboard.press("ArrowRight");
      const moved = await page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
      ok(moved && moved !== pick.id && NET.columns[2].nodes.some((n) => n.id === moved), w + ": the arrow key moves to the next column and selects it");
      eq(await page.$eval('.fnw-chip[aria-pressed="true"]', (e) => e.dataset.id), moved, w + ": the selection follows focus");
    } else {
      ok(!view.stage && view.table && view.narrow, w + ": a narrow module shows the table and says why");
    }
    if (SHOTS && wide) await page.screenshot({ path: path.join(SHOTS, "net-map-" + w + ".png") });
    await page.evaluate(() => { const b = document.querySelectorAll(".fnw .ui-seg-i")[1]; if (b) b.click(); });
    await page.waitForTimeout(150);
    const tbl = await page.evaluate(() => ({ shown: !document.querySelector(".fnw-table").hidden, rows: document.querySelectorAll(".fnw-tbl tbody tr").length, heads: [...document.querySelectorAll(".fnw-tbl thead th")].map((e) => e.textContent), first: [...document.querySelectorAll(".fnw-tbl tbody tr")[0].children].map((e) => e.textContent), more: document.querySelector(".fnw-more") ? document.querySelector(".fnw-more").textContent : null }));
    ok(tbl.shown, w + ": the table view shows");
    eq(tbl.rows, Math.min(12, NET.paths.length), w + ": twelve paths at first");
    eq(tbl.heads, [...NET.columns.map((c) => c.title), "Premium", "Share"], w + ": one heading per column, then the premium and the share");
    const labels = new Map(NET.columns.flatMap((c) => c.nodes.map((n) => [n.id, n.label])));
    eq(tbl.first, [...NET.paths[0].ids.map((id) => labels.get(id)), await fmtMoney(page, NET.paths[0].v), Math.round((NET.paths[0].v / NET.total) * 100) + "%"], w + ": the largest path's row is the leaf's");
    if (NET.paths.length > 12) {
      eq(tbl.more, "Show all " + NET.paths.length + " paths", w + ": a button offers the rest");
      await page.click(".fnw-more");
      eq(await page.$$eval(".fnw-tbl tbody tr", (e) => e.length), NET.paths.length, w + ": and shows every path");
    }
    const face = await page.$eval(".fnw-face", (e) => e.textContent);
    for (const line of Object.values(L.FACE_LINES)) ok(face.includes(line), w + ": the face carries: " + line.slice(0, 50));
    ok(face.includes("No lean on this page"), w + ": and says there is no lean");
    const cover = await page.$eval(".fnw-cover", (e) => e.textContent);
    ok(/^The \d+ largest of the name's \d+ flagged windows, \d+% of its flagged premium\./.test(cover) || /^All \d+ flagged windows/.test(cover), w + ": the coverage line is stated: " + cover);
    const sc = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - document.documentElement.clientWidth, y: document.documentElement.scrollHeight - innerHeight }));
    ok(sc.x <= 0, w + ": no sideways scroll (" + sc.x + ")");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "net-" + w + ".png") });
    ok(errors.length === 0, w + ": no page error " + errors.join(" | "));
    await ctx.close();
  }
}

{
  const { ctx, page } = await open(1440, 820, { cardX: { ...CARD_X, alerts: undefined } });
  await openModule(page);
  const t = await stateOf(page);
  ok(t.state === "unavailable" && /carries no flagged-window record/.test(t.reason), "a card-x with no flagged-window record is unavailable, with its reason, never an empty map: " + t.reason);
  await ctx.close();
}

{
  const { ctx, page } = await open(1440, 820, { cardX: { ...CARD_X, alerts: { ...CARD_X.alerts, asOf: "2026-08-21" } } });
  await openModule(page);
  const t = await stateOf(page);
  ok(t.state === "stale" && /not the card's session/.test(t.reason), "windows of another session are stale, and the reason names both days: " + t.reason);
  await ctx.close();
}

{
  const { ctx, page } = await open(1440, 820, { cardX: { ...CARD_X, alerts: { status: "quiet", why: "empty" } } });
  await openModule(page);
  const t = await stateOf(page);
  ok(t.state === "quiet" && /No window of this name was flagged/.test(t.reason), "a quiet record is quiet with its reason: " + t.reason);
  await ctx.close();
}

{
  const few = { ...CARD_X, alerts: { ...CARD_X.alerts, n: 3, prem: CARD_X.alerts.dots.slice(0, 3).reduce((a, d) => a + d.p, 0), dots: CARD_X.alerts.dots.slice(0, 3) } };
  const { ctx, page } = await open(1440, 820, { cardX: few });
  await openModule(page);
  const t = await page.$eval(".fnw", (e) => ({ state: e.dataset.state, thin: !!document.querySelector(".fnw-thin"), table: !document.querySelector(".fnw-table").hidden, stage: !document.querySelector(".fnw-stage").hidden, seg: !!document.querySelector(".fnw .ui-seg") }));
  ok(t.state === "thin" && t.thin && t.table && !t.stage && !t.seg, "three windows draw the table only, with the sentence that there are too few for a map " + JSON.stringify(t));
  await ctx.close();
}

{
  const { ctx, page, release } = await open(1440, 820, { holdCardX: true });
  await page.waitForTimeout(400);
  const btn = await page.$('.ft-dock-b[data-mod="m-network"]');
  ok(btn !== null, "the dock names the Flow network while the dossier is still loading");
  release();
  await page.waitForTimeout(400);
  await ctx.close();
}

{
  const wide = { ...CARD_X, alerts: { ...CARD_X.alerts, prem: Math.round(CARD_X.alerts.dots.reduce((a, d) => a + d.p, 0) * 1.8) } };
  const { ctx, page } = await open(1440, 820, { cardX: wide });
  await openModule(page);
  const warn = await page.$eval(".fnw-warn", (e) => ({ hidden: e.hidden, text: e.textContent }));
  ok(!warn.hidden && /can differ by up to 44 points/.test(warn.text), "under three quarters coverage the module warns by how many points the name-wide share can differ: " + warn.text);
  await ctx.close();
  const low = { ...CARD_X, alerts: { ...CARD_X.alerts, prem: Math.round(CARD_X.alerts.dots.reduce((a, d) => a + d.p, 0) * 3) } };
  const o = await open(1440, 820, { cardX: low });
  await openModule(o.page);
  const w2 = await o.page.$eval(".fnw-warn", (e) => e.textContent);
  ok(/^The largest windows only:/.test(w2), "under half it says the largest windows only: " + w2);
  await o.ctx.close();
}

const DOM_MUTANTS = [
  ["the selected chip not marked", "el.setAttribute(\"aria-pressed\", String(n.id === S.sel));", "el.setAttribute(\"aria-pressed\", \"false\");"],
  ["the readout not following a click", "el.addEventListener(\"click\", () => { S.sel = n.id; paintSel(); });", "el.addEventListener(\"click\", () => { S.sel = n.id; });"],
  ["bands start at the target's edge", "const x1 = pa.x + pa.w, x2 = pb.x, mx = (x1 + x2) / 2;", "const x1 = pa.x, x2 = pb.x, mx = (x1 + x2) / 2;"],
  ["band width not on one scale", "const w = Math.max(1.25, b.v * geo.scale);", "const w = Math.max(1.25, Math.sqrt(b.v) * geo.scale * 40);"],
  ["the table not offered the rest", "if (more) more.addEventListener(\"click\", () => { t.querySelector(\"tbody\").replaceChildren(...rows(true)); more.remove(); });", ""],
  ["the coverage line dropped", "const cover = h(\"p\", { class: \"fnw-cover\" }, coverLine(net));", "const cover = h(\"p\", { class: \"fnw-cover\" }, \"\");"],
];
for (const [name, from, to] of DOM_MUTANTS) {
  ok(SRC.split(from).length === 2, "the planted build changes the module exactly once: " + name);
  let caught = false;
  const { ctx, page } = await open(1440, 820, { src: SRC.replace(from, to) });
  try {
    await openModule(page);
    const NET = L.buildNet(CARD_X.alerts, MODEL_CTX());
    const first = NET.columns[0].nodes.slice().sort((a, b) => b.v - a.v)[0];
    const pick = NET.columns[1].nodes[NET.columns[1].nodes.length - 1];
    const pressed0 = await page.$$eval('.fnw-chip[aria-pressed="true"]', (e) => e.length);
    if (pressed0 !== 1) caught = true;
    await page.click('.fnw-chip[data-id="' + pick.id + '"]');
    const want = await page.evaluate((r) => window.FlowsUI.flowNet.sentence(r), L.readoutFor(NET, pick.id));
    if ((await page.$eval(".fnw-read", (e) => e.textContent)) !== want) caught = true;
    const paths = await page.$$eval(".fnw-bands path", (els) => els.map((e) => ({ d: e.getAttribute("d"), sw: parseFloat(e.getAttribute("stroke-width")) })));
    const chips = await page.$$eval(".fnw-chip", (els) => els.map((e) => ({ id: e.dataset.id, l: parseFloat(e.style.left), w: parseFloat(e.style.width) })));
    const flat = NET.bands.flat();
    flat.forEach((b, i) => { const m = /^M([\d.\-]+),/.exec(paths[i] ? paths[i].d : ""); const a = chips.find((x) => x.id === b.a); if (!m || Math.abs(+m[1] - (a.l + a.w)) > 0.5) caught = true; });
    const scale = flat.map((b, i) => (paths[i] ? paths[i].sw / b.v : 0)).filter((x, i) => paths[i] && paths[i].sw > 1.26);
    if (!(scale.length > 3 && Math.max(...scale) - Math.min(...scale) < 1e-9 * Math.max(...scale) + 1e-12)) caught = true;
    await page.evaluate(() => { const b = document.querySelectorAll(".fnw .ui-seg-i")[1]; if (b) b.click(); });
    if ((await page.$(".fnw-more")) !== null) { await page.click(".fnw-more"); if ((await page.$$eval(".fnw-tbl tbody tr", (e) => e.length)) !== NET.paths.length) caught = true; }
    if (!/^The \d+ largest|^All \d+/.test(await page.$eval(".fnw-cover", (e) => e.textContent))) caught = true;
    void first;
  } catch (e) { caught = true; }
  ok(caught, "PLANTED WRONG BUILD CAUGHT: " + name);
  await ctx.close();
}

await browser.close();
console.log(`✓ flows-flow-net-render: ${checks} assertions — the ticker's Flow network: the dock button is live and opens a four-column map of the name's own flagged windows (side by the vendor's ask-side attribution with no lean, expiry in calendar days from exchange dates, strike against the session spot scaled by the window's own expiry and volatility or a stated 2.5% band, sweep and opening flags), every column, hop and share adding to the total and to exactly 100, the page's model equal to the leaf's over ${BATTERY.length} worlds, every band on its chips' edges on one scale, a readout from the selected windows' joint, the coverage and its warning, the table twin, the states, and ${MUTANTS.length + DOM_MUTANTS.length} planted wrong builds that each fail`);
