import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { loadFixtures, buildFrames, captureHtml, indexHtml, VIEWPORTS } from "../scripts/approval-frames.mjs";
import { FRAME_INFO_JS, textProblems, seamProblems, conservationProblems, scaleProblems, labelProblems, gateOf } from "../scripts/approval-checks.mjs";
import { networkScene } from "../scripts/approval-scene.mjs";
import { skylineScene, terrainScene, surfaceScene, relationsScene, essvi, pText } from "../scripts/approval-worlds.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const has = (list, text) => list.some((p) => p.includes(text));

const SEAM = "Bands do not connect across names: calls and puts, and bullish and bearish, are two ways to split the same dollars.";
const LIVE = "Live: motion is a real arrival or your own hand.";
const AMBIENT = "Ambient: pulses and breathing encode premium by speed and density, not individual trades; labelled ambient motion, not data";
const fx = loadFixtures();
const { world, copy } = fx;

{
  const ps = fx.placements.placements;
  eq(ps.map((p) => p.id), ["p1", "p2", "p3", "p4", "p5", "p6"], "six placements, in the order the plan names them");
  eq(ps.map((p) => p.n), [1, 2, 3, 4, 5, 6], "numbered one to six");
  for (const p of ps) {
    ok(p.title && p.purpose.length > 120 && p.useTest.length > 30, `${p.id} has a title, a paragraph of what it is for and the use test that keeps it`);
    eq(p.viewports, ["1440x900", "390x844"], `${p.id} is rendered at 1440x900 and 390x844`);
    ok(p.states.length >= 1 && p.releases.length >= 1, `${p.id} names its states and the rows it releases`);
    ok(p.id in fx.answers.recorded, `${p.id} has an answer slot`);
  }
  eq(ps[0].states, ["default", "replay", "arrival"], "placement 1 shows the default session, the after-hours replay and a live arrival");
  eq(Object.keys(fx.answers.recorded), ps.map((p) => p.id), "the answer slots are exactly the placements");
  const valid = (a) => a === null || a === "yes" || (Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === "string" && x.trim()));
  ok(Object.values(fx.answers.recorded).every(valid), "a slot holds null, \"yes\" or a list of changes and nothing else");
  ok(fx.answers.motion.recorded === null || ["live", "ambient", "both"].includes(fx.answers.motion.recorded), "and OD-V1's answer is null, live, ambient or both");
  eq(fx.answers.decision, "OD-39", "the answers record OD-39");

  const sup = fx.superseded.frames;
  eq(sup.length, 35, "THE PACK LISTS THE 35 SUPERSEDED FRAMES");
  eq(new Set(sup).size, 35, "by distinct file name");
  eq(sup.filter((n) => n.startsWith("v1-concepts/")).length, 26, "26 from the first concept round");
  eq(sup.filter((n) => n.startsWith("v2/concepts/")).length, 9, "and 9 from the second");
  ok(sup.every((n) => /\.png$/.test(n)), "all of them PNG files");

  const frames = buildFrames(fx);
  const idx = indexHtml(fx, frames);
  for (const n of sup) ok(idx.includes(n), `the index lists the superseded frame ${n}`);
  for (const p of ps) ok(idx.includes(`data-answer="${p.id}"`), `the index carries an answer form for ${p.id}`);
  ok(/capture-live-ambient\.webm/.test(idx) && idx.includes(LIVE) && idx.includes(AMBIENT), "and the capture with the sentence of what Live and Ambient each mean");

  const rows = Object.keys(fx.gates.rows);
  for (const p of ps) for (const r of p.releases) ok(fx.gates.rows[r] && fx.gates.rows[r].includes(p.id), `${r} is gated on ${p.id}`);
  const blank = { ...fx.answers, recorded: Object.fromEntries(Object.keys(fx.answers.recorded).map((k) => [k, null])) };
  for (const r of rows) eq(gateOf(r, fx.gates, blank), "gated", `A ROW THAT NAMES OD-39 STAYS GATED WITH NO ANSWER: ${r}`);
  for (const r of rows) {
    const need = fx.gates.rows[r].map((p) => fx.answers.recorded[p]);
    const want = need.some((a) => a === null) ? "gated" : need.every((a) => a === "yes") ? "released" : "changes";
    eq(gateOf(r, fx.gates, fx.answers), want, `and the committed answers resolve ${r} to ${want}, a missing one never read as a yes`);
  }
  const answered = (map) => ({ ...blank, recorded: { ...blank.recorded, ...map } });
  eq(gateOf("F-36", fx.gates, answered({ p1: "yes" })), "released", "a yes on placement 1 releases the scene core");
  eq(gateOf("F-09", fx.gates, answered({ p1: "yes" })), "released", "and the Home network's visible pull request");
  eq(gateOf("F-57", fx.gates, answered({ p1: "yes" })), "gated", "but not the Moves page, which waits for its own answer");
  eq(gateOf("F-57", fx.gates, answered({ p2: "yes" })), "released", "which a yes on placement 2 releases");
  eq(gateOf("F-95", fx.gates, answered({ p3: ["lower the plane label"] })), "changes", "a list of changes is neither a yes nor a missing answer");
  eq(gateOf("F-98", fx.gates, answered({ p1: "yes", p2: "yes", p3: "yes", p4: "yes", p5: "yes" })), "gated", "a yes elsewhere never releases Relations");
  let threw = "";
  try { gateOf("F-999", fx.gates, blank); } catch (e) { threw = String(e.message); }
  ok(/no placement in gates\.json/.test(threw), "a row that names OD-39 with no placement fails instead of resolving");
  threw = "";
  try { gateOf("F-36", fx.gates, { ...blank, recorded: {} }); } catch (e) { threw = String(e.message); }
  ok(/no answer slot/.test(threw), "and a placement with no answer slot fails");
}

const frames = buildFrames(fx);
eq(frames.length, 22, "22 frames: three states of the Home network and of Moves, one each of the skyline, terrain and surface, two of Relations, at two widths");
eq(new Set(frames.map((f) => f.id)).size, 22, "each with its own name");


{
  const infoOf = (over = {}) => ({ docTitle: "Moves", text: "", aria: [], titles: [], alts: [], nav: ["Home", "Moves", "Flow"], headings: [{ tag: "h1", text: "Moves" }], header: [], chips: [], badges: [], og: [], ...over });
  eq(textProblems(infoOf()), [], "a clean frame passes the text lint");
  ok(has(textProblems(infoOf({ text: "Calls at ask $45M" })), "at ask"), "A FRAME CARRYING \"at ask\" FAILS");
  ok(has(textProblems(infoOf({ aria: ["Puts at bid"] })), "at ask"), "and so does \"at bid\" in an aria-label");
  ok(has(textProblems(infoOf({ text: "NOW" })), "NOW"), "A \"NOW\" BADGE FAILS");
  ok(has(textProblems(infoOf({ badges: [{ text: "NOW", row: "screen" }] })), "NOW"), "on a Screen row too");
  ok(has(textProblems(infoOf({ badges: [{ text: "Alert (provisional)", row: "screen" }] })), "Screen row"), "a Screen row carrying another badge fails");
  ok(has(textProblems(infoOf({ headings: [{ tag: "h1", text: "FDR 10% over 670 names" }] })), "FDR"), "'FDR' IN A HEADLINE FAILS");
  ok(has(textProblems(infoOf({ nav: ["Home", "Unusual"] })), "Unusual"), "'Unusual' AS A NAV LABEL FAILS");
  ok(has(textProblems(infoOf({ docTitle: "Flows: Radar" })), "Radar"), "a title that says Radar fails");
  ok(has(textProblems(infoOf({ header: ["one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"] })), "15 words"), "a header sentence of fifteen words fails");
  ok(has(textProblems(infoOf({ chips: ["a chip of four words"] })), "chip"), "and a chip of four words");
}

const launchSettled = async () => {
  let last;
  for (let i = 0; i < 4; i++) {
    let b;
    try {
      b = await launch();
      const probe = await b.newPage();
      await probe.setContent("<p>ready</p>");
      await probe.close();
      return b;
    } catch (e) {
      last = e;
      await b?.close().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw last;
};
const browser = await launchSettled();
try {
  const results = [];
  for (const f of frames) {
    const v = VIEWPORTS[f.vp];
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(f.html);
    const info = await page.evaluate(FRAME_INFO_JS);
    results.push({ f, info, errors });
    await ctx.close();
  }
  for (const { f, info, errors } of results) {
    eq(textProblems(info), [], `${f.id}: the DOM text lint finds nothing (no "at ask", no NOW, no FDR headline, no Unusual nav, header and chips inside their word budgets)`);
    ok(info.overflow <= 0, `${f.id}: no horizontal overflow (${info.overflow} px)`);
    eq(errors, [], `${f.id}: no page errors`);
    ok(/Sample data · concept/.test(info.text), `${f.id}: carries the sample-data marker`);
    ok(info.nav.includes("Flow") && info.nav.includes("Moves") && !info.nav.some((n) => /Unusual|Radar/.test(n)), `${f.id}: the rail says Moves and Flow`);
  }
  const textOf = (id) => results.find((r) => r.f.id === id).info.text;

  for (const r of results.filter((x) => x.f.placement === "p1")) {
    const t = r.info.text, k = r.f.id;
    ok(t.includes(SEAM), `${k}: THE LEGEND LINE SAYS BANDS DO NOT CONNECT ACROSS NAMES, in the plan's words`);
    ok(t.includes("Ask side and bid side are the vendor's split") && t.includes("ask-side calls and bid-side puts are drawn bullish"), `${k}: ask side and bid side are the vendor's words`);
    ok(t.includes(LIVE) && t.includes(AMBIENT), `${k}: says what Live and Ambient each mean, in the plan's words`);
    ok(/network data held since 10:02/.test(r.info.text) || r.info.aria.some((a) => /holds data from 10:02/.test(a)), `${k}: the time strip says what the network has held`);
    if (r.f.state === "replay") ok(/replay of 2026-10-08, flagged windows; ambient motion, not data/.test(t) && /ambient/.test(t), `${k}: the replay is labelled as ambient motion, not data`);
    else ok(!/replay of/.test(t), `${k}: only the replay state carries the replay label`);
    if (r.f.state === "arrival") ok(/no single dollar is traced through/.test(t), `${k}: the arrival says its two splits are not one path`);
  }

  for (const r of results.filter((x) => x.f.placement === "p2")) {
    const t = r.info.text, k = r.f.id, c = copy.canonical;
    ok(t.includes(c.header), `${k}: THE HEADER SENTENCE IS THE CANONICAL ONE`);
    ok(t.includes("Design rate, averaged over sessions: at most 1 in 10 is expected to be false, if the model of each name is right."), `${k}: the alert count line carries the design-rate sentence verbatim`);
    ok(/\d price alerts? today \(provisional\)\./.test(t), `${k}: and says provisional`);
    ok(!/measured rate/.test(t), `${k}: and never says "measured rate" before there is one`);
    if (r.f.state === "now") {
      ok(r.info.badges.some((b) => b.text === c.alertBadge) && r.info.badges.some((b) => b.text === c.screenBadge), `${k}: the Alert (provisional) and Screen badges are the canonical words`);
      ok(r.info.badges.filter((b) => b.row === "screen").every((b) => b.text === c.screenBadge), `${k}: every Screen row carries exactly the Screen badge`);
    }
    if (r.f.state === "paused") {
      ok(t.includes(c.paused), `${k}: THE PAUSED STATE IS THE CANONICAL CHIP`);
      ok(r.info.badges.filter((b) => b.text === c.screenBadge).length === 3, `${k}: the Now list keeps showing Screen rows beside it, the small cap among them`);
      ok(r.info.badges.filter((b) => b.text === c.alertBadge).length === 1 && /\b1 price alert today/.test(t), `${k}: and the one alert that is not a small cap`);
    }
    if (r.f.state === "empty") ok(t.includes(c.empty) && !r.info.badges.length, `${k}: THE EMPTY STATE IS THE CANONICAL SENTENCE and no badge is shown`);
    ok(!/\bunusual\b/i.test(t), `${k}: the word unusual does not appear before its gate`);
  }

  for (const r of results.filter((x) => x.f.placement === "p3")) {
    ok(/no measured rate yet \(design 10%\)/.test(r.info.text) || r.info.text.includes("no measured rate yet (design 10%)"), `${r.f.id}: the selection line says there is no measured rate yet`);
    ok(!/\b1 in \d/.test(r.info.text), `${r.f.id}: a scan p is never printed as 1 in N`);
    ok(/p below 0\.0000\d/.test(r.info.text), `${r.f.id}: a scan p is printed as "p below"`);
    ok(!/FDR/.test(r.info.text), `${r.f.id}: no FDR headline`);
  }
  for (const r of results.filter((x) => x.f.placement === "p4")) {
    ok(r.info.text.includes(copy.convention), `${r.f.id}: THE DEALER CLAUSE IS ON THE CHIP`);
    ok(/Book: open interest as of/.test(r.info.text) && /Spot: SPY .* as of 15:41:07 ET/.test(r.info.text), `${r.f.id}: two as-of chips, the book's and the spot's`);
  }
  for (const r of results.filter((x) => x.f.placement === "p5")) ok(/extrapolated/.test(r.info.text) || r.info.aria.length, `${r.f.id}: names the extrapolated region`);
  for (const r of results.filter((x) => x.f.placement === "p6")) {
    ok(/Names moved together beyond the market/.test(r.info.text), `${r.f.id}: names the layer it shows`);
    if (r.f.state === "default") ok(/Co-occurrence, not cause/.test(r.info.text), `${r.f.id}: says co-occurrence, not cause`);
    else ok(/Nothing passed its test this week/.test(r.info.text), `${r.f.id}: the empty state says nothing passed`);
  }
  ok(/No stable links this week/.test(frames.find((f) => f.id === "p6-relations-empty-1440").html), "and the designed empty state is drawn as text");

  const net = (opts) => networkScene(world, opts);
  for (const [name, opts] of [["1440", { yaw: -5 }], ["1440 replay", { yaw: -5, pulses: true }], ["1440 swayed", { yaw: 3, pulses: true }], ["390", { compact: true }], ["390 replay", { compact: true, pulses: true }]]) {
    const sc = net(opts);
    eq(seamProblems(sc), [], `THE DRAW LIST HAS NO CURVE THROUGH A NAME NODE AND NO PULSE ACROSS TWO BANDS (${name})`);
    eq(conservationProblems(sc), [], `every layer carries the same total and every node's inflow equals its outflow (${name})`);
    eq(scaleProblems(sc), [], `sphere area and band width follow premium on one scale (${name})`);
    eq(labelProblems(sc.labels, sc.nodes.map((n) => ({ id: n.id, circle: { x: n.x, y: n.y, r: n.r } })), { w: sc.W, h: sc.H }), [], `no chip overlaps a sphere or another chip, and none leaves the frame (${name})`);
    eq(sc.layers.map((l) => l.length > 0), [true, true, true, true], `four layers (${name})`);
    ok(sc.pulses.length === 0 === !opts.pulses, `pulses only where Ambient asks for them (${name}: ${sc.pulses.length})`);
  }
  {
    const live = net({ yaw: -5 }), amb = net({ yaw: -5, pulses: true });
    eq(live.pulses.length, 0, "Live at rest draws no pulse");
    ok(amb.pulses.length > amb.bands.length, "Ambient draws at least one pulse on every band and up to four on the big ones");
    const biggest = Math.max(...amb.bands.map((b) => b.v));
    const periods = amb.pulses.map((p) => p.period);
    ok(Math.min(...periods) >= 2.4 - 0.01 && Math.max(...periods) <= 7 + 0.01, "pulse periods run from 2.4 s for the largest band to 7 s for the smallest");
    eq(amb.pulses.filter((p) => p.band === amb.bands.find((b) => b.v === biggest).id).length, 4, "four pulses on the largest band");
    const names = live.nodes.filter((n) => n.kind === "name");
    ok(names.every((n) => live.bands.filter((b) => b.to === n.id).every((b) => b.layer === 1) && live.bands.filter((b) => b.from === n.id).every((b) => b.layer === 2)), "every band into a Name node comes from the Sector layer and every band out of it goes to the Lean layer: the node is the seam");
    const tech = live.nodes.find((n) => n.id === "name:NVDA");
    ok(live.bands.filter((b) => b.to === tech.id).reduce((a, b) => a + b.v, 0) > 0 && live.bands.filter((b) => b.from === tech.id).length === 3, "a name takes its premium in once and sends it out three ways: bullish, bearish and unsided");
  }

  {
    const sc = net({ yaw: -5, pulses: true });
    const through = { ...sc, bands: [...sc.bands, { id: 999, from: "side:calls", to: "lean:bull", layer: 0, v: 1, w: 3, p0: [0, 0], p1: [1, 1], pts: sc.nodes.filter((n) => n.id === "name:NVDA").map((n) => [n.x, n.y]).concat([[0, 0]]), color: "#fff" }] };
    const p = seamProblems(through);
    ok(has(p, "band 999 runs from layer 0 to layer 3") && has(p, "crosses the Name node name:NVDA"), "A BAND THAT RUNS THROUGH A NAME FAILS: it joins layers that are not neighbours and crosses the node");
    const a = sc.bands.find((b) => b.layer === 1), b = sc.bands.find((x) => x.layer === 2);
    const two = { ...sc, pulses: [...sc.pulses, { id: "bad", band: a.id, from: 0.2, to: 0.7, period: 3, phase: 0, pts: [a.pts[10], a.pts[20], b.pts[3], b.pts[8]] }] };
    ok(has(seamProblems(two), "spans two bands"), "A PULSE THAT SPANS TWO BANDS FAILS");
    const far = { ...sc, nodes: sc.nodes.map((n) => (n.id === "name:NVDA" ? { ...n, x: n.x - 400 } : n)) };
    ok(seamProblems(far).length > 0, "and a name moved onto a band fails it");
    const wrong = { ...sc, bands: sc.bands.map((x, i) => (i === 0 ? { ...x, w: x.w * 2 } : x)) };
    ok(scaleProblems(wrong).length > 0, "a band whose width is not its premium fails the scale check");
    const leak = { ...sc, nodes: sc.nodes.map((n) => (n.id === "sec:tech" ? { ...n, v: n.v * 1.1 } : n)) };
    ok(conservationProblems(leak).length > 0, "a node that creates money fails the conservation check");
  }

  {
    const sc = skylineScene(world);
    const callers = world.skyline.rows.filter((r) => r.h >= world.skyline.hStar).map((r) => r.t).sort();
    eq(sc.callouts.map((c) => c.id).sort(), callers, "the margin callouts are exactly the names above the plane");
    eq(sc.labels.map((l) => l.id).sort(), callers, "and the only labels in the scene: none sits on a prism");
    eq(labelProblems(sc.labels, sc.solids, { w: sc.W, h: sc.H }, sc.leaders), [], "A LABEL THAT OVERLAPS A PRISM FAILS THE PLACER'S TEST: no callout touches a prism or another callout, and no leader line crosses another leader or another name's prism, on the fixture");
    ok(sc.leaders.length >= 2, `the fixture has ${sc.leaders.length} leaders, enough for the crossing check to mean something`);
    const crossed = sc.leaders.map((l, i) => (i === 0 ? { ...l, path: [l.path[0], sc.leaders[1].path[1], sc.leaders[1].path[2]] } : i === 1 ? { ...l, path: [l.path[0], sc.leaders[0].path[1], sc.leaders[0].path[2]] } : l));
    ok(labelProblems(sc.labels, sc.solids, { w: sc.W, h: sc.H }, crossed).some((x) => /^leader .* crosses leader/.test(x)) || sc.leaders[0].path[0][1] === sc.leaders[1].path[0][1], "two leaders sent to each other's slots are caught as crossing");
    const moved = sc.labels.map((l, i) => (i === 0 ? { ...l, x: sc.prisms[0].top.x - 20, y: sc.prisms[0].top.y + 5, w: 120, h: 30 } : l));
    ok(labelProblems(moved, sc.solids, { w: sc.W, h: sc.H }).length > 0, "a label moved onto a prism is caught");
    ok(sc.prisms.every((p) => p.h >= 2), "only names with h of 2 decades or more become prisms");
    ok(sc.prisms.filter((p) => p.extrapolated).every((p) => p.h > 4.3) && sc.prisms.some((p) => p.extrapolated), "prisms past the deepest audited p are marked extrapolated");
    ok(sc.prisms.length <= 20, "at most twenty prisms at tier 1");
    eq(sc.callouts.every((c) => c.text.includes("p below")), true, "every callout prints the scan p as \"p below\"");
    eq(pText(4.7), "p below 0.00002", "4.7 decades prints as p below 0.00002");
    ok(sc.tiles.length === 40 && sc.tiles.every((t) => t.dir === 1 || t.dir === -1), "forty floor tiles, each coloured by a direction");
  }

  {
    const sc = terrainScene(world);
    eq(sc.zeros.length, world.terrain.expiries.length, "a zero-gamma line per expiry");
    ok(sc.zeros.every((z) => z.pts.length >= 1), "each of them crosses zero on the strike axis");
    ok(sc.flip && sc.flipPt, "the back-wall profile has its flip");
    ok(sc.contours.filter((c) => c.level < 0).every((c) => c.dashed) && sc.contours.filter((c) => c.level > 0).every((c) => !c.dashed), "contours are solid above zero and dashed below");
    ok(sc.contours.some((c) => c.segs.length > 0), "and there are contours to draw");
    eq(sc.spotK, 0, "the spot plane sits at the money");
  }

  {
    const sc = surfaceScene(world);
    const sl = world.surface.slices;
    ok(sl.every((s, i) => !i || s.theta > sl[i - 1].theta), "total variance at the money increases with expiry: no calendar arbitrage between the fitted slices");
    for (const s of sl) {
      let convex = true, positive = true;
      for (let k = -0.3; k <= 0.3001; k += 0.02) {
        const w = essvi(k, s.theta, s.rho, s.psi), a = essvi(k - 0.01, s.theta, s.rho, s.psi), b = essvi(k + 0.01, s.theta, s.rho, s.psi);
        if (!(w > 0)) positive = false;
        if (a + b - 2 * w < -1e-12) convex = false;
      }
      ok(positive && convex, `the fitted slice at ${s.label} has positive, convex total variance in strike`);
    }
    ok(sc.cells.some((c) => !c.inside) && sc.cells.some((c) => c.inside), "the mesh has a quoted region and a hatched extrapolated one");
    ok(sc.dots.length <= sl.length * 9, "at most nine quote dots a slice");
    ok(sc.dots.some((d) => d.outside), "a quote whose mid lies outside its spread is marked");
    ok(sc.ridge.length > 5 && sc.seam, "the event ridge and the seam are drawn");
  }

  {
    const sc = relationsScene(world);
    const all = world.relations.edges;
    ok(all.some((e) => e.stab < 0.5) && sc.edges.every((e) => e.stab >= 0.5), "EDGES BELOW A STABILITY OF 0.5 ARE NOT DRAWN");
    ok(sc.edges.length === all.filter((e) => e.stab >= 0.5).length, "and every edge at or above it is");
    for (const e of sc.edges) eq(e.op, e.stab >= 0.9 ? 0.85 : e.stab >= 0.7 ? 0.55 : 0.3, `an edge of stability ${e.stab} takes one of the three opacity steps`);
    ok(sc.edges.every((e) => !e.lag), "the layer drawn carries no lag: only the flow layer has one");
    ok(world.relations.community.caption.split(" ").length <= 6, "a community's caption is at most six words");
    eq(relationsScene(world, { empty: true }).edges.length, 0, "the empty state draws no edge");
  }

  {
    const html = captureHtml(fx);
    ok(html.includes(LIVE) && html.includes(AMBIENT), "the capture page carries the sentence of what Live and Ambient each mean");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "approval-")), "capture.html");
    fs.writeFileSync(file, html);
    await page.goto("file://" + file + "?t=1");
    await page.waitForSelector("#live svg .node");
    const snap = (t) => page.evaluate((t) => { window.__freeze(t); const pos = (id) => [...document.querySelectorAll(id + " .node circle:first-child")].slice(0, 6).map((c) => c.getAttribute("cx") + "," + c.getAttribute("cy")).join("|"); return { live: pos("#live"), amb: pos("#ambient"), livePulses: document.querySelectorAll("#live .pulses").length, ambPulses: document.querySelectorAll("#ambient .pulses polyline").length, flare: document.querySelectorAll("#live .flare").length, dim: document.querySelectorAll('#live .band[fill-opacity="0.06"]').length, svgs: document.querySelectorAll("#live svg, #ambient svg").length }; }, t);
    const a = await snap(1), b = await snap(10), c = await snap(4.5);
    eq(a.svgs, 2, "the capture shows two scenes side by side");
    eq(a.live, b.live, "LIVE IS STILL BETWEEN ARRIVALS: its spheres do not move between 1 s and 10 s");
    ok(a.amb !== b.amb, "AMBIENT SWAYS: its spheres are in different places at 1 s and 10 s");
    eq([a.livePulses, a.flare], [0, 0], "Live carries no pulse and no flare at 1 s");
    ok(a.ambPulses > 50, `Ambient carries pulses along its bands (${a.ambPulses})`);
    eq(c.flare, 1, "a real arrival flares its name in Live at 4.5 s");
    ok(c.dim > 0, "and dims every band but the arriving name's neighbourhood");
    eq(errors, [], "and nothing throws");
    await ctx.close();
  }
} finally {
  await browser.close();
}

{
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "approval-pack-"));
  const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/render-preview.mjs"), "--approval", "--out", out], { encoding: "utf8", timeout: 180000, env: process.env });
  eq(run.status, 0, `the existing render script renders the pack from fixtures (${(run.stderr || "").slice(-300)})`);
  const dir = path.join(out, "approval");
  const files = fs.readdirSync(dir);
  ok(frames.every((f) => files.includes(f.id + ".png") && files.includes(f.id + ".html")), "a PNG and the page for each of the 22 frames");
  ok(files.includes("index.html") && files.includes("capture-live-ambient.html"), "the index and the Live and Ambient capture page");
  ok(frames.every((f) => fs.statSync(path.join(dir, f.id + ".png")).size > 4000), "and none of the frames is empty");
  ok(!fs.readdirSync(ROOT).includes("assets-approval"), "no file under assets/ or shared/ is part of the pack");
}

console.log(`✓ approval-frames: ${checks} assertions — six placements and their answer slots with every row that names OD-39 gated until it is answered, the 35 superseded frames listed by name, 22 frames rendered from fixtures through the existing render script with a DOM text lint (at ask, NOW, an FDR headline, an Unusual nav label, header and chip word budgets, the canonical strings verbatim), the Home network's draw list with no curve through a Name node and no pulse across two bands in Live and in Ambient, conservation and the one scale, label placement against prisms and spheres, and the Live and Ambient capture`);
