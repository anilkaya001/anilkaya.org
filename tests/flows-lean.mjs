import vm from "node:vm";
import { readFileSync } from "node:fs";

const JS = new URL("../assets/js/", import.meta.url);
const FILES = ["flows-ui.js", "flows-market-floor.js", "flows-market-river.js", "flows-relations.js", "flows-net.js"];
const SRC = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, JS), "utf8")]));
const NOW_SRC = readFileSync(new URL("flows-now.js", JS), "utf8");
const nowRule = (UI) => {
  const a = NOW_SRC.indexOf("  function sideOf(cp) {"), b = NOW_SRC.indexOf("  function shape(rows) {");
  if (a < 0 || b < a) throw new Error("the Now list's lean rule moved");
  const box = vm.createContext({ window: { FlowsUI: UI } });
  vm.runInContext(NOW_SRC.slice(a, b) + "\nthis.rule = (r) => leanOf(r, sideOf(r.cp));", box);
  return box.rule;
};

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

function boot(patches = {}) {
  const PX = new Proxy(function () {}, { get: () => PX, apply: () => PX });
  const win = { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), addEventListener() {}, location: { pathname: "/flows/" } };
  const ctx = {
    window: win,
    document: { getElementById: () => null, documentElement: {}, addEventListener() {}, styleSheets: [], createElement: () => ({ getContext: () => PX, style: {}, width: 0, height: 0 }) },
    Intl, console, setTimeout, clearTimeout, requestAnimationFrame: (f) => f(), navigator: {}, performance: { now: () => 0 },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  win.window = win;
  Object.assign(win, ctx);
  vm.createContext(ctx);
  for (const f of FILES) {
    let text = SRC[f];
    for (const [from, to] of patches[f] || []) {
      if (!text.includes(from)) throw new Error("mutant anchor missing in " + f + ": " + from.slice(0, 60));
      text = text.replace(from, to);
    }
    vm.runInContext('"use strict";\n' + text, ctx);
  }
  return ctx.window.FlowsUI;
}

const stated = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
function refSplit(r) {
  if (!(r.prem > 0)) return null;
  const A = stated(r.askPrem), B = stated(r.bidPrem), a0 = A || 0, b0 = B || 0, k = a0 + b0 > r.prem ? r.prem / (a0 + b0) : 1;
  const a = a0 * k, b = b0 * k, none = Math.max(0, r.prem - a - b);
  if (r.cp !== "C" && r.cp !== "P") return { up: 0, down: 0, nx: a + b + none, both: A !== null && B !== null, a, b };
  return r.cp === "C" ? { up: a, down: b, nx: none, both: A !== null && B !== null, a, b } : { up: b, down: a, nx: none, both: A !== null && B !== null, a, b };
}
function refWindow(r) {
  const s = refSplit(r);
  if (!s || (r.cp !== "C" && r.cp !== "P") || !s.both || s.a + s.b === 0) return "nx";
  const cls = +(((s.a + s.b) / r.prem) * 100).toFixed(0), share = +((s.a / (s.a + s.b)) * 100).toFixed(0);
  if (cls < 50) return "nx";
  const ask = share >= 65, bid = share <= 35;
  if (!ask && !bid) return "nx";
  return r.cp === "C" ? (ask ? "up" : "down") : (ask ? "down" : "up");
}

const row = (t, cp, prem, askPrem, bidPrem, over = {}) => ({ t, cp, prem, askPrem, bidPrem, size: 100, exp: "2026-10-23", k: 100, spanStart: "2026-10-16T15:00:00.000Z", ...over });

const KNOWN = [
  ["call, 510k ask against 490k bid", row("SYX101", "C", 1e6, 510e3, 490e3), { up: 510e3, down: 490e3, nx: 0, net: 20e3 }, "nx"],
  ["put mirror of it", row("SYX101", "P", 1e6, 510e3, 490e3), { up: 490e3, down: 510e3, nx: 0, net: -20e3 }, "nx"],
  ["call, 300k ask, 100k bid, 600k between", row("SYX101", "C", 1e6, 300e3, 100e3), { up: 300e3, down: 100e3, nx: 600e3, net: 200e3 }, "nx"],
  ["call, 800k ask, 100k bid", row("SYX101", "C", 1e6, 800e3, 100e3), { up: 800e3, down: 100e3, nx: 100e3, net: 700e3 }, "up"],
  ["put, 800k ask, 100k bid", row("SYX101", "P", 1e6, 800e3, 100e3), { up: 100e3, down: 800e3, nx: 100e3, net: -700e3 }, "down"],
  ["call with only its ask side stated", row("SYX101", "C", 1e6, 900e3, null), { up: 900e3, down: 0, nx: 100e3, net: 900e3 }, "nx"],
  ["sides past the premium are scaled back", row("SYX101", "C", 1e6, 1.5e6, 0.5e6), { up: 750e3, down: 250e3, nx: 0, net: 500e3 }, "up"],
  ["no call or put", row("SYX101", null, 1e6, 900e3, 100e3), { up: 0, down: 0, nx: 1e6, net: 0 }, "nx"],
];

function suite(UI) {
  for (const [name, r, want, side] of KNOWN) {
    const alerts = { rows: [r], sessionDate: "2026-10-16", readAt: "2026-10-16T20:00:00.000Z" };
    const floor = UI.floor.model(alerts, {});
    const tile = floor.tiles.find((t) => t.n === 1);
    ok(tile && ["up", "down", "nx"].every((k) => near(tile[k], want[k])) && near(tile.net, want.net), "Floor " + name + ": " + (tile && JSON.stringify([tile.up, tile.down, tile.nx, tile.net])) + " against " + JSON.stringify(want));
    const river = UI.river.model(alerts, {});
    const lane = river.lanes[0];
    ok(lane && ["up", "down", "nx"].every((k) => near(lane[k], want[k])), "River lane " + name + ": " + (lane && JSON.stringify([lane.up, lane.down, lane.nx])) + " against " + JSON.stringify(want));
    ok(river.windows[0].side === side, "River sphere " + name + ": " + river.windows[0].side + " against " + side);
    const net = UI.net.model([r], { names: 10 });
    ok(near(net.lean.bull, want.up) && near(net.lean.bear, want.down) && near(net.lean.nx, want.nx), "Network " + name + ": " + JSON.stringify(net.lean) + " against " + JSON.stringify(want));
    const rel = UI.relations.model([r], { minWindows: 1, minBins: 1, minActive: 1 });
    ok(rel.series.length === 1 && near(rel.series[0].L.reduce((x, y) => x + y, 0), want.net), "Relations " + name + ": lean series sums to " + (rel.series[0] && rel.series[0].L.reduce((x, y) => x + y, 0)) + " against " + want.net);
  }
  const tile = (net, prem) => {
    const rows = [row("SYX101", "C", prem, prem / 2 + net / 2, prem / 2 - net / 2)];
    return UI.floor.model({ rows, sessionDate: "2026-10-16" }, {}).tiles.find((t) => t.n === 1);
  };
  ok(tile(99e3, 1e6).lean.cat === "mixed" && tile(100e3, 1e6).lean.cat === "up" && tile(-100e3, 1e6).lean.cat === "down" && tile(-99e3, 1e6).lean.cat === "mixed", "Floor holds the 10% band from both sides");
}

function corpus(n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const names = ["SPY", "QQQ", "XLK", "XLF", "SYX101", "SYX102", "SYX103", "SYX104", "SYX105", "SYX106", "SYX107", "SYX108", "SYX109", "SYX110", "SYX111", "SYX112", "VXX", "SYX113"];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const prem = Math.round(50e3 + rnd() ** 2 * 3e6);
    const mode = rnd();
    const ask = mode < 0.08 ? null : Math.round(prem * rnd() * (mode > 0.95 ? 1.4 : 0.9));
    const bid = mode > 0.08 && mode < 0.16 ? null : Math.round(prem * rnd() * (mode > 0.95 ? 1.4 : 0.9) * (rnd() < 0.2 ? 0.1 : 1));
    const cp = rnd() < 0.03 ? null : rnd() < 0.5 ? "C" : "P";
    const minute = Math.floor(rnd() * 380);
    rows.push({ t: names[Math.floor(rnd() * names.length)], cp, prem, askPrem: ask, bidPrem: bid, size: 10 + Math.floor(rnd() * 900), exp: "2026-10-" + (17 + Math.floor(rnd() * 14)), k: 90 + Math.floor(rnd() * 20),
      spanStart: new Date(Date.UTC(2026, 9, 16, 13, 30) + minute * 60000).toISOString() });
  }
  return rows;
}

function crossModule(UI, rows) {
  const ref = new Map();
  const tot = { up: 0, down: 0, nx: 0, net: 0 };
  for (const r of rows) {
    const s = refSplit(r);
    const e = ref.get(r.t) || { up: 0, down: 0, nx: 0, net: 0, prem: 0 };
    for (const k of ["up", "down", "nx"]) { e[k] += s[k]; tot[k] += s[k]; }
    e.net += s.up - s.down; tot.net += s.up - s.down; e.prem += r.prem;
    ref.set(r.t, e);
  }
  const alerts = { rows, sessionDate: "2026-10-16", readAt: "2026-10-16T20:00:00.000Z" };
  const floor = UI.floor.model(alerts, {});
  const fl = { up: 0, down: 0, nx: 0 };
  for (const t of floor.tiles) {
    for (const k of ["up", "down", "nx"]) fl[k] += t[k];
    for (const nm of t.nameList) {
      const e = ref.get(nm.t);
      ok(e && near(nm.up, e.up) && near(nm.down, e.down) && near(nm.nx, e.nx), "Floor name " + nm.t + " splits " + [nm.up, nm.down, nm.nx].map(Math.round) + " against " + (e && [e.up, e.down, e.nx].map(Math.round)));
    }
    ok(near(t.up + t.down + t.nx, t.prem), "Floor tile " + t.id + " splits add to its premium");
  }
  ok(["up", "down", "nx"].every((k) => near(fl[k], tot[k])), "Floor totals " + JSON.stringify(fl) + " against " + JSON.stringify(tot));

  const river = UI.river.model(alerts, {});
  const rv = { up: 0, down: 0, nx: 0 };
  for (const l of river.lanes) for (const k of ["up", "down", "nx"]) rv[k] += l[k];
  ok(["up", "down", "nx"].every((k) => near(rv[k], tot[k])), "River lane totals " + JSON.stringify(rv) + " against " + JSON.stringify(tot));
  for (const w of river.windows) ok(w.side === refWindow(rows[w.i]), "River sphere " + w.i + " side " + w.side + " against " + refWindow(rows[w.i]));

  const now = nowRule(UI);
  for (const w of river.windows) {
    const k = now(rows[w.i]).key;
    ok((k === "bullish" ? "up" : k === "bearish" ? "down" : "nx") === w.side, "River sphere " + w.i + " is " + w.side + " where the Now list says " + k);
  }

  const net = UI.net.model(rows, { names: 24 });
  ok(near(net.lean.bull, tot.up) && near(net.lean.bear, tot.down) && near(net.lean.nx, tot.nx), "Network lean totals " + JSON.stringify(net.lean) + " against " + JSON.stringify(tot));

  const rel = UI.relations.model(rows, { minWindows: 1, minBins: 1, minActive: 1, names: 24 });
  for (const s of rel.series) {
    const e = ref.get(s.t);
    ok(e && near(s.L.reduce((a, b) => a + b, 0), e.net), "Relations lean series of " + s.t + " sums to " + s.L.reduce((a, b) => a + b, 0) + " against " + (e && e.net));
  }
  ok(rel.series.length >= 10, "Relations kept " + rel.series.length + " names");
}

function nullWorld(seedStart, K, B, phi) {
  let s = seedStart >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const rows = [];
  for (let k = 0; k < K; k++) {
    let e = gauss();
    for (let b = 0; b < B; b++) {
      e = phi * e + Math.sqrt(1 - phi * phi) * gauss();
      if (rnd() >= 0.8) continue;
      const prem = Math.round(100000 * Math.exp(0.8 * e));
      rows.push({ t: "SYX" + (100 + k), cp: rnd() < 0.5 ? "C" : "P", prem, askPrem: Math.round(prem * (0.3 + 0.4 * rnd())), bidPrem: Math.round(prem * 0.5 * rnd()), spanStart: new Date(Date.UTC(2026, 9, 16, 13, 30) + b * 600000 + 1000).toISOString() });
    }
  }
  return rows;
}

function relationsNull(UI) {
  for (const [K, phi] of [[6, 0], [12, 0], [12, 0.6], [24, 0]]) {
    let sum = 0, n = 0, stable = 0;
    const reps = K === 24 ? 25 : 60;
    for (let rep = 0; rep < reps; rep++) {
      const m = UI.relations.model(nullWorld(1000 * K + rep + Math.round(phi * 10), K, 39, phi), { minWindows: 1, minBins: 1, minActive: 1, names: K });
      for (const p of m.pairs.P) { sum += p.r; n++; if (p.stable) stable++; }
    }
    ok(Math.abs(sum / n) < 0.02, "Beyond the market on K=" + K + " unrelated names (phi " + phi + ") averages r " + (sum / n).toFixed(3) + ", not 0; conditioning on a sum that contains the pair gives -1/(K-1)");
    ok(stable / n <= 0.07, "and shows " + (100 * stable / n).toFixed(1) + "% of unrelated pairs as relations, against the 5% the page's sentence promises (the biased version showed 21% at K=6)");
  }
}

function run(patches) {
  failures.length = 0;
  const UI = boot(patches);
  suite(UI);
  for (const seed of [1, 2, 3]) crossModule(UI, corpus(300, seed));
  relationsNull(UI);
  return failures.slice();
}

const base = run({});
if (base.length) { console.error(base.slice(0, 12).join("\n")); console.error("flows-lean: " + base.length + " failures"); process.exit(1); }

const MUTANTS = [
  ["Floor puts the whole window on its majority side", { "flows-market-floor.js": [["tile.up += up; tile.down += down; tile.nx += nx;", "const side = up > down ? 'up' : down > up ? 'down' : 'nx'; tile[side] += r.prem;"], ["nm.up += up; nm.down += down; nm.nx += nx;", "nm[up > down ? 'up' : down > up ? 'down' : 'nx'] += r.prem;"]] }],
  ["Floor reads puts like calls", { "flows-market-floor.js": [['up = r.cp === "C" ? sp.ask : r.cp === "P" ? sp.bid : 0', 'up = sp.ask']] }],
  ["Floor counts unsided premium as bullish", { "flows-market-floor.js": [["nx = r.prem - up - down;", "nx = 0; tile.up += r.prem - up - down;"]] }],
  ["Floor has no band", { "flows-market-floor.js": [["const LEAN_EDGE = 0.1,", "const LEAN_EDGE = 0,"]] }],
  ["River lanes put the whole window on its majority side", { "flows-market-river.js": [["l.up += w.split.up; l.down += w.split.down; l.nx += w.split.nx;", "l[w.side] += w.prem;"]] }],
  ["River reads puts like calls", { "flows-market-river.js": [['up = r.cp === "C" ? sp.ask : r.cp === "P" ? sp.bid : 0', 'up = sp.ask']] }],
  ["River sphere by bare majority", { "flows-market-river.js": [['const side = r.cp === "C" || r.cp === "P" ? UI.F.askShare([r]).side : null;', 'const x = UI.F.askSplit(r); const side = r.cp === "C" || r.cp === "P" ? (x.ask > x.bid ? "ask" : x.bid > x.ask ? "bid" : null) : null;']] }],
  ["River sphere ignores a window half unsided", { "flows-ui.js": [['side: share === null || w(classified) < 50 ? "thin" :', 'side: share === null ? "thin" :']] }],
  ["sides past the premium not scaled back", { "flows-ui.js": [["k = a + b > p ? p / (a + b) : 1;", "k = 1;"]] }],
  ["River sphere swaps puts", { "flows-market-river.js": [['side === "ask" ? (r.cp === "C" ? "up" : "down") : side === "bid" ? (r.cp === "C" ? "down" : "up") : "nx"', 'side === "ask" ? "up" : side === "bid" ? "down" : "nx"']] }],
  ["Relations lean is the sign of the window", { "flows-relations.js": [['const lean = sp ? (r.cp === "C" ? sp.ask - sp.bid : sp.bid - sp.ask) : 0;', 'const lean = sp ? Math.sign(r.cp === "C" ? sp.ask - sp.bid : sp.bid - sp.ask) * prem : 0;']] }],
  ["Relations conditions on a sum that contains the pair", { "flows-relations.js": [["const factor = cond ? sum.map((v, b) => v - zs[i][b] - zs[j][b]) : null;", "const factor = cond ? sum : null;"]] }],
  ["Relations lean ignores puts", { "flows-relations.js": [['const lean = sp ? (r.cp === "C" ? sp.ask - sp.bid : sp.bid - sp.ask) : 0;', 'const lean = sp && r.cp === "C" ? sp.ask - sp.bid : 0;']] }],
];

const TICKER_SRC = readFileSync(new URL("flows-ticker.js", JS), "utf8");
const askRule = (src) => /F\.askSaid\(al && \{ share: al\.askShare, classified: al\.sidedShare \}\)/.test(src) && /card written before the sided share/.test(src) && /no window states both sides/.test(src) && !/\["Ask side", F\.pct\(al && al\.askShare/.test(src) && /al\.sidedShare >= 0\.495 \? al\.askShare : null/.test(src);
checks++;
if (!askRule(TICKER_SRC)) { console.error("the ticker's alert card prints its ask side through F.askSaid with the sided share, and withholds the figure from a card that predates it"); process.exit(1); }
checks++;
if (askRule(TICKER_SRC.replace(/\[F\.askLabel, al && al\.sidedShare === undefined[^\n]*?F\.askSaid\(al && \{ share: al\.askShare, classified: al\.sidedShare \}\)\],/, '["Ask side", F.pct(al && al.askShare, 0)],'))) { console.error("the ask-side scan does not catch the old ask-over-premium print"); process.exit(1); }

let killed = 0;
const alive = [];
for (const [name, patches] of MUTANTS) {
  let f;
  try { f = run(patches); } catch (e) { f = ["threw: " + e.message]; }
  if (f.length) killed++; else alive.push(name);
}
if (alive.length) { console.error("planted wrong builds that passed: " + alive.join(", ")); process.exit(1); }
console.log(`flows-lean: ${checks} checks, ${killed} planted wrong builds killed`);
