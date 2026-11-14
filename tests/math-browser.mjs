import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bootModules } from "./lib/ui-boot.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-browser.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-browser-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

function judge() {
  const bad = [];
  const say = (m) => { if (bad.length < 6) bad.push(m); };
  const near = (got, want, what, tol = 1e-9) => {
    if (want === null || want === undefined) { if (got !== null && got !== undefined) say(`${what}: ${got} where there is none`); return; }
    if (got === null || got === undefined || !Number.isFinite(got) || !(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)))) say(`${what}: ${got} against ${want}`);
  };
  const same = (got, want, what) => { if ((got ?? null) !== (want ?? null)) say(`${what}: ${got} against ${want}`); };
  return { bad, near, same, say };
}

const A = FX.alerts;
const alertsIn = () => ({ rows: JSON.parse(JSON.stringify(A.rows)), sessionDate: A.session });
const universeIn = () => JSON.parse(JSON.stringify(A.universe));

function floor(patches) {
  const j = judge();
  const UI = bootModules(["flows-ui.js", "flows-market-floor.js"], patches).window.FlowsUI;
  const m = UI.floor.model(alertsIn(), { universe: universeIn() });
  j.same(m.total, A.floor.total, "floor total");
  const seen = new Set();
  for (const t of m.tiles) {
    const e = A.floor.tiles[t.id];
    if (!e) { if (t.n) j.say(`floor: an unexpected class ${t.id} holds windows`); if (t.share !== null) j.say(`floor: the empty class ${t.id} has a share`); continue; }
    seen.add(t.id);
    j.same(t.n, e.n, `floor ${t.id} windows`);
    j.same(t.prem, e.prem, `floor ${t.id} premium`);
    for (const k of ["up", "down", "nx", "net", "share"]) j.near(t[k], e[k], `floor ${t.id} ${k}`);
    j.same(t.vol, e.vol, `floor ${t.id} contracts`);
    j.same(t.volN, e.volN, `floor ${t.id} windows with a count`);
    j.near(t.lean.ratio, e.ratio, `floor ${t.id} lean`);
    if (e.cat !== null) j.same(t.lean.cat, e.cat, `floor ${t.id} lean word`);
    j.near(UI.floor.valueOf(t, "lean"), e.net, `floor ${t.id} lean height`);
    j.same(UI.floor.valueOf(t, "volume"), e.volN ? e.vol : null, `floor ${t.id} volume height`);
  }
  for (const id of Object.keys(A.floor.tiles)) if (!seen.has(id)) j.say(`floor: the class ${id} is missing`);
  const shares = m.tiles.reduce((s, t) => s + (t.share || 0), 0);
  j.near(shares, 1, "floor shares sum to one");
  return j.bad;
}

function river(patches) {
  const j = judge();
  const UI = bootModules(["flows-ui.js", "flows-market-river.js"], patches).window.FlowsUI;
  const m = UI.river.model(alertsIn(), { universe: universeIn() });
  j.same(m.total, A.river.total, "river total");
  j.same(m.pMax, A.river.pMax, "river largest window");
  j.same(m.lanes.length, Object.keys(A.river.lanes).length, "river lanes");
  for (const l of m.lanes) {
    const e = A.river.lanes[l.name];
    if (!e) { j.say(`river: an unexpected lane ${l.name}`); continue; }
    j.same(l.n, e.n, `river ${l.name} windows`);
    j.same(l.prem, e.prem, `river ${l.name} premium`);
    for (const k of ["up", "down", "nx"]) j.near(l[k], e[k], `river ${l.name} ${k}`);
  }
  m.windows.forEach((w, i) => j.same(w.side, A.river.sides[i], `river window ${i} side`));
  for (let i = 1; i < m.lanes.length; i++) if (m.lanes[i].prem > m.lanes[i - 1].prem) j.say("river: the lanes are not ordered by premium");
  return j.bad;
}

function net(patches) {
  const j = judge();
  const UI = bootModules(["flows-ui.js", "flows-net.js"], patches).window.FlowsUI;
  const secOf = new Map(A.universe.t.map((t, i) => [t, A.universe.sec[i] === null ? null : A.universe.sectors[A.universe.sec[i]]]));
  for (const out of ["lean", "dte"]) {
    const m = UI.net.model(JSON.parse(JSON.stringify(A.rows)), { out, session: A.session, sectorOf: (t) => (secOf.has(t) ? secOf.get(t) : null) });
    const e = A.net;
    j.same(m.windows, e.windows, `network ${out} windows`);
    j.same(m.flagged, e.flagged, `network ${out} flagged premium`);
    j.near(m.total, e.total, `network ${out} sided premium`);
    j.near(m.lean.bull, e.bull, `network ${out} bullish`);
    j.near(m.lean.bear, e.bear, `network ${out} bearish`);
    j.near(m.lean.nx, e.nx, `network ${out} no side`);
    for (const k of ["share", "bullLo", "bullHi", "bearLo", "bearHi"]) j.near(m.cover[k], e[k], `network ${out} ${k}`);
    j.near(m.lean.bull + m.lean.bear + m.lean.nx, e.flagged, `network ${out}: bullish, bearish and no side add to the flagged premium`);
    m.layers.forEach((l, i) => j.near(l.reduce((s, n) => s + n.v, 0), e.total, `network ${out} layer ${i} sum`));
    m.edges.forEach((h, i) => j.near(h.reduce((s, x) => s + x.v, 0), e.total, `network ${out} hop ${i} sum`));
    j.near(m.paths.reduce((s, p) => s + p.v, 0), e.total, `network ${out} path sum`);
    for (const l of m.layers.slice(0, 3)) for (const n of l) {
      const outv = m.edges[n.layer].filter((x) => x.a === n.id).reduce((s, x) => s + x.v, 0);
      j.near(outv, n.v, `network ${out} node ${n.id} outgoing`);
    }
    j.same(m.top.length, Object.keys(e.top).length, `network ${out} name and side rows`);
    for (const r of m.top) j.near(r.v, e.top[r.t + "|" + r.k], `network ${out} ${r.t} ${r.k}`);
    j.near(m.layers.flat().filter((n) => n.layer === 3).reduce((s, n) => s + n.share, 0), 1, `network ${out} last layer shares`);
  }
  return j.bad;
}

function relations(patches) {
  const j = judge();
  const UI = bootModules(["flows-ui.js", "flows-relations.js"], patches).window.FlowsUI;
  const m = UI.relations.model(JSON.parse(JSON.stringify(A.rows)));
  const e = A.relations;
  j.same(m.status, "ok", "relations status");
  j.same(m.bins, e.bins, "relations bins");
  j.same(m.windows, e.windows, "relations windows");
  j.same(m.names.map((n) => n.t).join("|"), e.names.join("|"), "relations kept names");
  for (const s of m.series || []) {
    s.A.forEach((v, b) => j.near(v, e.A[s.t][b], `relations ${s.t} premium bin ${b}`));
    s.L.forEach((v, b) => j.near(v, e.L[s.t][b], `relations ${s.t} lean bin ${b}`));
  }
  for (const layer of ["A", "L", "P"]) {
    j.same(m.pairs[layer].length, Object.keys(e.pairs[layer]).length, `relations ${layer} pairs`);
    for (const p of m.pairs[layer]) {
      const w = e.pairs[layer][p.a + "|" + p.b] || e.pairs[layer][p.b + "|" + p.a];
      if (!w) { j.say(`relations ${layer}: an unexpected pair ${p.a} ${p.b}`); continue; }
      for (const k of ["r", "lo", "hi", "r1", "r2"]) j.near(p[k], w[k], `relations ${layer} ${p.a} ${p.b} ${k}`, 1e-8);
      if (w.passed !== null) j.same(p.passed, w.passed, `relations ${layer} ${p.a} ${p.b} passed`);
      if (w.stable !== null) j.same(p.stable, w.stable, `relations ${layer} ${p.a} ${p.b} stable`);
      if (p.lo !== null && !(p.lo <= p.r && p.r <= p.hi)) j.say(`relations ${layer} ${p.a} ${p.b}: r outside its interval`);
    }
  }
  return j.bad;
}

function universeOf(rows) {
  const col = (k) => rows.map((r) => r[k]);
  return { status: "ok", t: rows.map((r) => r.t), hz: 21, sessionDate: "2026-11-02", sec: rows.map(() => 0), sectors: ["Technology"],
    cols: { chg: col("chg"), iv30p: col("iv"), sig: col("sig"), f2: col("f2"), f3: col("f3") },
    units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], sig: ["fraction", 1e5], f2: ["days per 252", 1], f3: ["days per 252", 1] } };
}

function skyline(patches) {
  const j = judge();
  const UI = bootModules(["flows-ui.js", "flows-skyline.js"], patches).window.FlowsUI;
  const M = FX.moves;
  const m = UI.skyline.model(universeOf(M.rows));
  const byT = new Map(M.rows.map((r, i) => [r.t, M.expect[i]]));
  const want = M.expect.filter((e) => e.m !== null && Math.abs(e.m) >= 2).length;
  j.same(m.beyond, want, "skyline names at or beyond two IV-days");
  j.same(m.n, M.expect.filter((e) => e.m !== null).length, "skyline priced names");
  j.same(m.prisms.length, Math.min(40, want), "skyline prisms");
  const cut = M.expect.filter((e) => e.m !== null && Math.abs(e.m) >= 2).map((e) => Math.abs(e.m)).sort((a, b) => b - a)[Math.min(40, want) - 1];
  for (const p of m.prisms) {
    const e = byT.get(p.t);
    j.near(p.m, e.m, `skyline ${p.t} IV-days`);
    j.same(p.dir, e.m > 0 ? 1 : -1, `skyline ${p.t} direction`);
    if (p.h < cut - 1e-9) j.say(`skyline ${p.t}: a smaller move was drawn ahead of a larger one`);
    if (e.edge) continue;
    if (e.state === "tested") {
      if (!p.often) { j.say(`skyline ${p.t}: no count where one is published`); continue; }
      j.same(p.often.level, e.level, `skyline ${p.t} level`);
      j.same(p.often.hits, e.hits, `skyline ${p.t} hits`);
      j.same(p.often.floored, e.hits === 0 || 252 / e.hits > 250, `skyline ${p.t} floor`);
      j.near(p.often.n, e.hits === 0 || 252 / e.hits > 250 ? 250 : 252 / e.hits, `skyline ${p.t} one in N`);
      if (!p.often.text.endsWith("; " + e.text)) j.say(`skyline ${p.t}: sentence "${p.often.text}" against "${e.text}"`);
    } else if (p.often) j.say(`skyline ${p.t}: a count where there is none (${e.state})`);
  }
  return j.bad;
}

function moves(patches) {
  const j = judge();
  const T = bootModules(["flows-moves.js"], patches, { noDocument: true }).__MovesTest;
  const M = FX.moves;
  const rows = M.rows.map((r) => ({ t: r.t, chg: r.chg / 1e4, sig: r.sig === null ? null : r.sig / 1e5, f2: r.f2, f3: r.f3, event: false }));
  const run = T.sigRun(rows, 0.1);
  j.same(run.m, M.m, "moves names counted in the correction");
  let flagged = 0, edges = 0;
  run.items.forEach((it, i) => {
    const e = M.expect[i], r = M.rows[i];
    j.near(T.ivDays(r.chg / 1e4, r.iv === null ? null : r.iv / 1e3), e.m, `moves ${r.t} IV-days`);
    j.near(it.z, e.z, `moves ${r.t} typical days`);
    if (e.edge) { edges++; return; }
    j.same(it.state, e.state, `moves ${r.t} state`);
    j.near(it.p, e.p, `moves ${r.t} p`);
    if (e.state !== "tested") return;
    j.same(it.level, e.level, `moves ${r.t} level`);
    j.near(it.adj, e.adj, `moves ${r.t} adjusted p`);
    if (e.flag !== null) j.same(it.flag, e.flag, `moves ${r.t} flag`);
    if (it.flag) flagged++;
    const rp = T.rarityParts(rows[i]);
    if (!rp || !rp.text.endsWith("; " + e.text)) j.say(`moves ${r.t}: sentence "${rp && rp.text}" against "${e.text}"`);
  });
  if (!edges) j.same(flagged, M.flagged, "moves flagged names");
  return j.bad;
}

function movelab(patches) {
  const j = judge();
  const UI = bootModules(["flows-ui.js", "flows-ticker-movelab.js"], patches).window.FlowsUI;
  FX.moves.frequency.forEach((text, hits) => j.same(UI.moveLab.frequency(hits), text, `move lab sentence for ${hits} hits`));
  FX.movelab.forEach((c, i) => {
    [1, 2, 3, 4].forEach((k, q) => {
      const g = UI.moveLab.counted(c.returns, c.sig, k);
      if (c.hits[q] === null) { if (!g.why) j.say(`move lab ${i}: a count on ${c.n} returns`); return; }
      j.same(g.hits, c.hits[q], `move lab ${i} count at ${k} typical days`);
      j.same(g.n, c.n, `move lab ${i} returns`);
    });
  });
  return j.bad;
}

function glance(patches) {
  const j = judge();
  const UI = bootModules(["flows-ui.js", "flows-ticker-glance.js"], patches).window.FlowsUI;
  FX.glance.forEach((c, i) => {
    const m = UI.tickerGlance.model(c.card, "1M", { cardX: c.cardX });
    for (const [name, got, want] of [["implied", m.q, c.q], ["realised", m.p, c.p]]) {
      if (!got) { j.say(`glance ${i}: no ${name} range`); continue; }
      j.same(got.length, want.length, `glance ${i} ${name} steps`);
      got.forEach((s, k) => {
        if (!want[k]) return;
        j.near(s.h, want[k][0], `glance ${i} ${name} step ${k} session`);
        j.near(s.up, want[k][1], `glance ${i} ${name} step ${k} upper`, 1e-10);
        j.near(s.lo, want[k][2], `glance ${i} ${name} step ${k} lower`, 1e-10);
      });
    }
    j.near(m.event ? m.event.h : null, c.eventH, `glance ${i} report session`);
    j.near(m.event ? m.event.q : null, c.eventQ, `glance ${i} implied report step`, 1e-12);
    j.near(m.event ? m.event.p : null, c.eventP, `glance ${i} realised report step`, 1e-10);
  });
  return j.bad;
}

const BLOCKS = [
  ["the Floor's class sums, shares, lean and heights", floor],
  ["the Session river's lane sums and each window's side", river],
  ["the flow network's totals, lean range and conservation through every layer, hop, path and node", net],
  ["Relations: bins, kept names, Pearson, Fisher interval, halves and the partial layer", relations],
  ["the skyline's IV-days, level, count and sentence", skyline],
  ["the Moves field's typical days, IV-days, p, Benjamini-Hochberg and sentence", moves],
  ["the Move lab's sentence for all 253 counts and its counts on card closes", movelab],
  ["the glance chart's implied and realised ranges and the report step", glance],
];
for (const [name, run] of BLOCKS) eq(run({}).join("; "), "", `the page model equals the exact oracle: ${name}`);

ok(Object.values(A.floor.tiles).some((t) => t.cat === "mixed") && Object.values(A.floor.tiles).some((t) => t.volN < t.n), "the floor cases hold a mixed class and windows with no contract count");
ok(["up", "down", "nx"].every((s) => A.river.sides.includes(s)), "the river cases hold every side");
ok(["A", "L", "P"].every((l) => Object.values(A.relations.pairs[l]).some((p) => p.passed === true) && Object.values(A.relations.pairs[l]).some((p) => p.passed === false)),
  "each Relations layer holds a pair that passes and one that does not");
ok(FX.moves.expect.some((e) => e.flag === true) && FX.moves.expect.some((e) => e.flag === false) && FX.moves.expect.some((e) => e.state === "below"),
  "the Moves cases hold a flagged name, a tested one that is not, and one below two typical days");
ok(FX.glance.some((c) => c.eventP !== null) && FX.glance.some((c) => c.eventH !== null && c.eventP === null) && FX.glance.some((c) => c.eventH === null),
  "the glance cases hold a realised step, a report with none and no report");

const PLANTS = [
  ["the Floor nets puts like calls", floor, { "flows-market-floor.js": [["down = r.cp === \"C\" ? sp.bid : r.cp === \"P\" ? sp.ask : 0, nx", "down = sp.bid, nx"]] }],
  ["the Floor's share is of the largest class", floor, { "flows-market-floor.js": [["t.share = total > 0 && t.n ? t.prem / total : null;", "t.share = total > 0 && t.n ? t.prem / Math.max(...list.map((x) => x.prem)) : null;"]] }],
  ["the river gives a window to its majority side whatever the share", river, { "flows-ui.js": [["w(share) >= 65 ? \"ask\" : w(share) <= 35 ? \"bid\"", "w(share) > 50 ? \"ask\" : w(share) < 50 ? \"bid\""]] }],
  ["the network counts unsided premium as bullish", net, { "flows-net.js": [["push(cp === \"C\" ? \"ca\" : \"pa\", a);", "push(cp === \"C\" ? \"ca\" : \"pa\", a + Math.max(0, prem - a - b));"]] }],
  ["the network's bullish high bound forgets the unsided premium", net, { "flows-net.js": [["bullHi: (flagged - lean.bear) / flagged", "bullHi: lean.bull / flagged"]] }],
  ["Relations uses the population interval width", relations, { "flows-relations.js": [["se = 1 / Math.sqrt(n - k - 3)", "se = 1 / Math.sqrt(n)"]] }],
  ["Relations' partial layer keeps the pair in its own factor", relations, { "flows-relations.js": [["sum.map((v, b) => v - zs[i][b] - zs[j][b])", "sum.map((v) => v)"]] }],
  ["Relations bins by five minutes", relations, { "flows-relations.js": [["binMin: 10", "binMin: 5"]] }],
  ["the skyline divides by the current scale of 365 days", skyline, { "flows-skyline.js": [["const SQ = Math.sqrt(252);", "const SQ = Math.sqrt(365);"]] }],
  ["the skyline reads the two-day count for a three-day move", skyline, { "flows-skyline.js": [["const hits = level === 3 ? r.f3 : r.f2;\n    if (!Number.isInteger(hits) || hits < 0 || hits > SESSIONS) return { why: \"scale\" };", "const hits = r.f2;\n    if (!Number.isInteger(hits) || hits < 0 || hits > SESSIONS) return { why: \"scale\" };"]] }],
  ["Moves forgets the add-one in p", moves, { "flows-moves.js": [["p: (hits + 1) / (SESSIONS + 1) };", "p: hits / SESSIONS };"]] }],
  ["Moves corrects over the tested names only", moves, { "flows-moves.js": [["items.forEach((it, i) => { if (it.p !== null) idx.push(i); });", "items.forEach((it, i) => { if (it.state === \"tested\") idx.push(i); });"]] }],
  ["the Move lab drops the floor", movelab, { "flows-ticker-movelab.js": [["if (hits === 0 || SESSIONS / hits > FLOOR_N) {", "if (hits === 0) {"]] }],
  ["the Move lab does not scale a short history", movelab, { "flows-ticker-movelab.js": [["returns.length === SESSIONS ? hits : Math.round((hits * SESSIONS) / returns.length)", "hits"]] }],
  ["the glance ranges widen with time, not its square root", glance, { "flows-ticker-glance.js": [["const sUp = Math.sqrt(hh * b.dUp + (ev ? J * J : 0))", "const sUp = hh * Math.sqrt(b.dUp) + (ev ? J : 0)"]] }],
  ["the glance realised step keeps the ordinary session in", glance, { "flows-ticker-glance.js": [["const extra = Math.max(0, second - (pb.dUp + pb.dDn) / 2);", "const extra = Math.max(0, second);"]] }],
  ["the glance turns an expected move into a deviation with no factor", glance, { "flows-ticker-glance.js": [["return em === null ? null : em * SD_OVER_MEAN_ABS;", "return em;"]] }],
];
for (const [name, run, patches] of PLANTS) ok(run(patches).length > 0, `PLANTED WRONG BUILD FAILS: ${name}`);

console.log(`math-browser: ${checks} ✓`);
