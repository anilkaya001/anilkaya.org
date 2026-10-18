import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { launch } from "./lib/browser.mjs";
import { openMarket, alertsFixture, universeFixture, NAMES, SESSION } from "./lib/market-fixtures.mjs";
import { nightlyEmit, emitRead } from "./lib/nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-market-river.js"), "utf8");
const JS = "/assets/js/flows-market-river.js";
const RICH_DAY = "2026-08-24";

const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const etMinute = (ms) => { const p = ET_HM.formatToParts(new Date(ms)); const g = (k) => Number(p.find((x) => x.type === k).value); return g("hour") * 60 + g("minute"); };
const trt = (ms) => { const m = Math.floor(((ms / 60000) % 1440 + 1440 + 180) % 1440); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const FUNDS = new Set(["SPY", "QQQ", "IWM", "DIA"]);
const sideOf = (r) => {
  if (typeof r.askPrem !== "number" || typeof r.bidPrem !== "number" || r.askPrem === r.bidPrem) return "nx";
  const ask = r.askPrem > r.bidPrem;
  return r.cp === "C" ? (ask ? "up" : "down") : (ask ? "down" : "up");
};
function expected(alerts, universe) {
  const sec = new Map(universe.t.map((t, i) => [t, universe.sec[i] >= 0 ? universe.sectors[universe.sec[i]] : null]));
  const windows = alerts.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.prem > 0 && Number.isFinite(Date.parse(r.spanStart))).map(({ r, i }) => ({ i, t: r.t, lane: FUNDS.has(r.t) ? "Index funds" : sec.get(r.t) || "No sector", ms: Date.parse(r.spanStart), minute: etMinute(Date.parse(r.spanStart)), prem: r.prem, side: sideOf(r) }));
  const lanes = new Map();
  for (const w of windows) { const l = lanes.get(w.lane) || { name: w.lane, prem: 0, n: 0 }; l.prem += w.prem; l.n++; lanes.set(w.lane, l); }
  const order = [...lanes.values()].sort((a, b) => b.prem - a.prem || (a.name < b.name ? -1 : 1)).map((l) => l.name);
  const pMax = Math.max(...windows.map((w) => w.prem));
  const openMs = Math.min(...windows.map((w) => w.ms - (w.minute - 570) * 60000));
  return { windows, order, lanes, pMax, openMs, total: windows.reduce((a, w) => a + w.prem, 0) };
}
function camera({ cx, cy, scale, yaw, pitch, dist }) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (x, y, z) => {
    const X = x * cyw + z * syw;
    let Z = -x * syw + z * cyw;
    const Y = y * cp + Z * sp;
    Z = Z * cp - y * sp;
    const k = dist / (dist + Z);
    return { x: cx + X * k * scale, y: cy - Y * k * scale, k };
  };
}

const INSPECT = () => {
  const host = document.getElementById("mkRiver");
  const api = window.FlowsUI.river && window.FlowsUI.river.of(host);
  if (!api) return { none: true, state: host && host.querySelector(".mk-rv") ? host.querySelector(".mk-rv").dataset.state : null, text: host ? host.textContent : "" };
  const M = api.model(), SC = api.scene();
  const wrap = host.querySelector(".mk-rv");
  const canvas = host.querySelector("canvas");
  const cr = canvas.getBoundingClientRect();
  const mod = document.getElementById("mkRiverCard").getBoundingClientRect();
  return {
    state: wrap.dataset.state, read: host.querySelector(".mk-rv-read").textContent, empty: host.querySelector(".mk-rv-empty").textContent, note: host.querySelector(".mk-rv-note").textContent,
    label: canvas.getAttribute("aria-label"), paints: api.paints(), reduced: api.reduced(),
    canvas: { w: cr.width, h: cr.height, left: cr.left, top: cr.top }, mod: { bottom: mod.bottom, right: mod.right },
    page: { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth },
    model: M && { session: M.session, openMs: M.openMs, readMs: M.readMs, total: M.total, pMax: M.pMax, dropped: M.dropped, tideWhy: M.tideWhy, marketTideWhy: M.marketTideWhy, steps: M.steps, lanes: M.lanes.map((l) => ({ name: l.name, k: l.k, prem: l.prem, n: l.n, tide: l.tide, path: l.path, tideWhy: l.tideWhy })) },
    scene: SC && { cam: SC.cam, xr: SC.xr, zr: SC.zr, openMs: SC.openMs, endMs: SC.endMs, phone: SC.phone, secMax: SC.secMax, nowZ: SC.nowZ, tide: Boolean(SC.tide),
      spheres: SC.spheres.map((s) => ({ i: s.w.i, t: s.w.t, lane: s.w.lane, ms: s.w.ms, prem: s.w.prem, side: s.w.side, x: s.x, z: s.z, r: s.r, px: s.px, py: s.py, pr: s.pr })),
      tiles: SC.tiles.map((t) => ({ lane: t.lane, k: t.k, v: t.v, pts: t.pts })), ticks: SC.ticks.map((t) => ({ ms: t.ms, text: t.text })) },
    labels: api.labels().labels, dropped: api.labels().dropped.length,
    hits: [...host.querySelectorAll(".mk-rv-hit")].map((a) => ({ t: a.dataset.t, i: Number(a.dataset.i), tab: a.tabIndex, href: a.getAttribute("href"), w: a.getBoundingClientRect().width, label: a.getAttribute("aria-label") })),
    lanesUi: [...host.querySelectorAll(".mk-rv-lane")].map((b) => b.dataset.lane),
    tables: [...host.querySelectorAll(".mk-rv-t")].map((t) => ({ caption: t.querySelector("caption").textContent, rows: [...t.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent)) })),
  };
};
const PIXELS = (pts) => {
  const canvas = document.querySelector("#mkRiver canvas");
  const g = canvas.getContext("2d");
  const dpr = canvas.width / canvas.getBoundingClientRect().width;
  return pts.map(([x, y]) => [...g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data]);
};

function verify(f, EXP, { tiles = null, phone = false } = {}) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(m); };
  if (f.none) return ["the river did not mount: " + (f.state || "") + " " + f.text.slice(0, 80)];
  need(f.state === "ok", "state is " + f.state);
  const SC = f.scene, M = f.model;
  if (!SC || !M) return bad.concat(["no scene"]);
  need(M.lanes.map((l) => l.name).join("|") === EXP.order.join("|"), "lane order " + M.lanes.map((l) => l.name).join("|") + " is not by flagged premium " + EXP.order.join("|"));
  for (const l of M.lanes) { const e = EXP.lanes.get(l.name); need(e && Math.abs(e.prem - l.prem) < 1 && e.n === l.n, "lane " + l.name + " sums " + l.prem + "/" + l.n + " against " + (e && e.prem + "/" + e.n)); }
  need(SC.spheres.length === EXP.windows.length, SC.spheres.length + " spheres for " + EXP.windows.length + " windows");
  need(Math.abs(M.openMs - EXP.openMs) < 1, "open at " + M.openMs + " not " + EXP.openMs);
  const cam = camera(SC.cam);
  const LW = 2 * SC.xr / M.lanes.length;
  const zOf = (ms) => SC.zr - 2 * SC.zr * (ms - SC.openMs) / (SC.endMs - SC.openMs);
  const byI = new Map(EXP.windows.map((w) => [w.i, w]));
  let rBad = 0, zBad = 0, laneBad = 0, projBad = 0, sideBad = 0;
  const big = SC.spheres.find((s) => s.prem === EXP.pMax);
  for (const s of SC.spheres) {
    const w = byI.get(s.i);
    if (!w) { bad.push("sphere " + s.i + " has no window"); continue; }
    if (w.side !== s.side) sideBad++;
    const k = M.lanes.find((l) => l.name === w.lane).k;
    if (!(s.x >= -SC.xr + LW * k - 1e-9 && s.x <= -SC.xr + LW * (k + 1) + 1e-9)) laneBad++;
    if (Math.abs(s.z - zOf(w.ms)) > 1e-9) zBad++;
    if (big && Math.abs(s.r / big.r - (0.03 + 0.12 * Math.sqrt(w.prem / EXP.pMax)) / (0.03 + 0.12)) > 1e-9) rBad++;
    const q = cam(s.x, s.r, s.z);
    if (Math.abs(q.x - s.px) > 0.01 || Math.abs(q.y - s.py) > 0.01 || Math.abs(s.r * q.k * SC.cam.scale - s.pr) > 0.01) projBad++;
  }
  need(!sideBad, sideBad + " spheres carry the wrong side");
  need(!laneBad, laneBad + " spheres sit outside their lane");
  need(!zBad, zBad + " spheres are not at their minute");
  need(!rBad, rBad + " sphere radii are not 0.03 + 0.12 sqrt(premium / largest)");
  need(!projBad, projBad + " spheres are not where the camera puts them");
  for (const s of SC.spheres) for (const u of SC.spheres) if (s.lane === u.lane && s.ms > u.ms && !(s.z < u.z)) { bad.push("a later window is not nearer the front"); break; }
  need(SC.nowZ !== null && Math.abs(SC.nowZ - zOf(Math.min(M.readMs, SC.endMs))) < 1e-9, "the now line is not at the last read");
  need(f.labels.some((l) => l.text === "read " + trt(M.readMs) + " TRT"), "the last read is not stamped in TRT (" + trt(M.readMs) + ")");
  for (const t of SC.ticks) need(t.text === trt(t.ms) && t.ms % 3600000 === 0, "tick " + t.text + " is not the TRT hour " + trt(t.ms));
  const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  let over = 0, out = 0;
  f.labels.forEach((a, i) => { f.labels.forEach((b, j) => { if (j > i && hit(a.box, b.box)) over++; }); if (a.box[0] < 0 || a.box[1] < 0 || a.box[2] > f.canvas.w + 0.5 || a.box[3] > f.canvas.h + 0.5) out++; });
  need(!over, over + " label pairs overlap");
  need(!out, out + " labels leave the canvas");
  if (!phone) for (const l of M.lanes) need(f.labels.some((x) => x.text === ({ "Technology": "Tech", "Consumer Cyclical": "Cyclicals", "Communication Services": "Comms", "Financial Services": "Financials", "Consumer Defensive": "Defensives", "Basic Materials": "Materials", "Real Estate": "Real estate" }[l.name] || l.name)), "lane " + l.name + " has no header label");
  const topN = EXP.windows.slice().sort((a, b) => b.prem - a.prem || a.i - b.i).slice(0, phone ? 7 : 12);
  for (const w of topN) need(f.labels.some((x) => x.text.startsWith(w.t + " $")) || f.dropped > 0, "largest window " + w.t + " unlabelled");
  need(f.hits.length === Math.min(40, EXP.windows.length) && f.hits[0].i === topN[0].i && f.hits.filter((h) => h.tab === 0).length === 1, "hit targets: " + f.hits.length + ", first " + (f.hits[0] && f.hits[0].t) + ", in tab order " + f.hits.filter((h) => h.tab === 0).length);
  need(f.hits.every((h) => h.w >= 28 && /^\/flows\/ticker\/\?t=/.test(h.href) && h.label.includes("TRT") && h.label.includes("$")), "a hit target is small, unlinked or unlabelled");
  need(f.lanesUi.join("|") === EXP.order.join("|"), "lane buttons");
  need(f.read.startsWith("Largest window: " + topN[0].t) && f.read.includes(trt(topN[0].ms) + " TRT"), "the readout at rest is not the largest window: " + f.read);
  need(f.tables.length === 2 && f.tables[0].rows.length === EXP.order.length && f.tables[0].rows.map((r) => r[0]).join("|") === EXP.order.join("|") && f.tables[1].rows.length === Math.min(40, EXP.windows.length), "the table twin");
  need(/TRT/.test(f.label) && !/ET\b|Eastern|UTC/.test(f.label + f.note + f.read), "a zone other than TRT is named");
  need(f.page.sh <= f.page.ih + 1 && f.page.sw <= f.page.iw, "the page scrolls " + JSON.stringify(f.page));
  need(f.canvas.top + f.canvas.h <= f.mod.bottom + 1 && f.canvas.left + f.canvas.w <= f.mod.right + 1, "the canvas leaves its module");
  if (tiles) {
    const { steps, rows, etf } = tiles;
    need(M.steps.length === steps.length && M.steps.every((s, i) => s === steps[i]), "the floor steps are not the breadth key's " + steps.length);
    for (const l of M.lanes) {
      const want = l.name === "Index funds" ? steps.map((_, k) => ["SPY", "QQQ", "IWM", "DIA"].filter((T) => etf[T] && etf[T].status === "ok").reduce((a, T) => a + etf[T].net[k], 0)) : rows[l.name] && rows[l.name].status === "ok" ? rows[l.name].net : null;
      const got = SC.tiles.filter((t) => t.lane === l.name).sort((a, b) => a.k - b.k).map((t) => t.v);
      if (want === null) need(got.every((v) => v === null) && typeof l.tideWhy === "string" && l.tideWhy.length > 8, "lane " + l.name + " should carry no tide, with a reason");
      else need(got.length === want.length && got.every((v, k) => Math.abs(v - want[k]) < 0.5) && Math.abs(l.tide - want[want.length - 1]) < 0.5, "lane " + l.name + " tiles are not the sector's tide path");
    }
    need(M.tideWhy === null, "tide why " + M.tideWhy);
  } else need(SC.tiles.every((t) => t.v === null) && typeof M.tideWhy === "string", "with no breadth key the floors must carry no tide and say why");
  return bad;
}

const browser = await launch();
const alerts = alertsFixture(), universe = universeFixture();
const EXP = expected(alerts, universe);
{
  const html = PAGES.marketPage({ username: "u", owner: true, scenes: true });
  ok(html.indexOf('id="mkP-floor"') < html.indexOf('id="mkP-session"') && html.indexOf('id="mkP-session"') < html.indexOf('id="mkP-tide"') && /data-defer="river"/.test(html), "THE SESSION IS THE MARKET PAGE'S SECOND VIEW, LOADED AS THE river DEFER GROUP");
  ok(!/\/\/|\/\*/.test(SRC.replace(/"[^"\n]*"|'[^'\n]*'/g, "")), "no comment in the module");
  ok(EXP.windows.length === 160 && EXP.order.length >= 8, "the fixture: " + EXP.windows.length + " windows in " + EXP.order.length + " lanes");
  console.log("  lanes by hand: " + EXP.order.map((n) => n + " " + Math.round(EXP.lanes.get(n).prem / 1e5) / 10 + "M").join(", "));
}
async function open(o = {}) {
  const r = await openMarket(browser, { hash: "#view=session", ...o });
  await r.page.waitForFunction(() => { const h = document.getElementById("mkRiver"); return h && window.FlowsUI.river && window.FlowsUI.river.of(h) && window.FlowsUI.river.of(h).scene() !== null || (h && h.querySelector(".mk-rv") && h.querySelector(".mk-rv").dataset.state !== "pending" && h.querySelector(".mk-rv").dataset.state !== "ok"); }, null, { timeout: 15000 }).catch(() => {});
  await r.page.waitForTimeout(400);
  return r;
}
try {
  for (const [w, h] of [[1440, 820], [1024, 768], [390, 844]]) {
    const { context, page, errors } = await open({ viewport: { width: w, height: h }, coarse: w < 500 });
    const f = await page.evaluate(INSPECT);
    eq(verify(f, EXP, { phone: w < 640 }), [], `${w}x${h}: EVERY SPHERE IS AT ITS MINUTE IN ITS LANE WITH AREA ITS PREMIUM, LABELS DO NOT OVERLAP, THE PAGE DOES NOT SCROLL`);
    eq(errors, [], `${w}: no page error`);
    console.log(`  ${w}: ${f.scene.spheres.length} spheres, ${f.labels.length} labels drawn, ${f.dropped} dropped, canvas ${Math.round(f.canvas.w)}x${Math.round(f.canvas.h)}`);
    if (w === 1440) {
      await page.focus('.mk-rv-hit[tabindex="0"]');
      const act = await page.evaluate(() => document.activeElement.className);
      const first = await page.evaluate(() => ({ t: document.activeElement.dataset.t, read: document.querySelector(".mk-rv-read").textContent }));
      const top = EXP.windows.slice().sort((a, b) => b.prem - a.prem || a.i - b.i);
      eq(first.t, top[0].t, "THE ONE HIT IN THE TAB ORDER IS THE LARGEST WINDOW (" + act + ")");
      ok(first.read.startsWith(top[0].t) && first.read.includes("$"), "and the readout names it: " + first.read);
      await page.keyboard.press("ArrowRight");
      eq(await page.evaluate(() => document.activeElement.dataset.t), top[1].t, "ArrowRight moves to the second largest");
      await page.keyboard.press("End");
      const last = await page.evaluate(() => Number(document.activeElement.dataset.rank));
      eq(last, Math.min(40, top.length) - 1, "End reaches the last hit target");
      await page.keyboard.press("Home");
      eq(await page.evaluate(() => document.activeElement.dataset.t), top[0].t, "Home returns to the first");
      const sel = await page.evaluate(() => { const a = document.activeElement; return { href: a.getAttribute("href"), paints: window.FlowsUI.river.of(document.getElementById("mkRiver")).paints() }; });
      eq(sel.href, "/flows/ticker/?t=" + top[0].t, "Enter would open the name's ticker page: the hit is a link");
      await page.keyboard.press("Escape");
      ok((await page.evaluate(() => document.querySelector(".mk-rv-read").textContent)).startsWith("Largest window"), "Escape clears the selection");
      await page.click(".mk-rv-tb");
      const dlgState = await page.evaluate(() => { const d = document.querySelector(".mk-rv-dlg"); return { open: d.open, tables: d.querySelectorAll(".mk-rv-t").length, fits: d.getBoundingClientRect().height <= innerHeight + 1 }; });
      eq(dlgState, { open: true, tables: 2, fits: true }, "THE TABLES BUTTON OPENS THE TWIN IN A DIALOG THAT FITS THE SCREEN");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      eq(await page.evaluate(() => ({ open: document.querySelector(".mk-rv-dlg").open, hidden: document.querySelector(".mk-rv-tables").hidden })), { open: false, hidden: true }, "and Escape closes it, hiding the tables again");
      const before = await page.evaluate(() => window.FlowsUI.river.of(document.getElementById("mkRiver")).paints());
      await page.waitForTimeout(2000);
      const after = await page.evaluate(() => window.FlowsUI.river.of(document.getElementById("mkRiver")).paints());
      eq(after, before, "PAINT CENSUS AT REST IS ZERO over two seconds");
      await page.locator(".mk-rv-lane").first().click();
      const laneRead = await page.evaluate(() => document.querySelector(".mk-rv-read").textContent);
      ok(laneRead.startsWith(({ "Technology": "Tech" }[EXP.order[0]] || EXP.order[0]) + " lane") && laneRead.includes("windows") && laneRead.includes("no tide"), "a lane header reads the lane's totals and says it has no tide: " + laneRead);
      const cpu = await page.evaluate(() => {
        const api = window.FlowsUI.river.of(document.getElementById("mkRiver"));
        const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 500; const g = cv.getContext("2d");
        const ref = () => { const t0 = performance.now(); for (let r = 0; r < 20; r++) { for (let i = 0; i < 160; i++) { g.beginPath(); g.arc(20 + (i * 37) % 1160, 20 + (i * 53) % 460, 12, 0, 6.283); g.fillStyle = "rgb(" + (i % 255) + ",120,90)"; g.fill(); } for (let i = 0; i < 60; i++) { g.font = "11px sans-serif"; g.fillText("label " + i, (i * 97) % 1100, 20 + (i * 13) % 460); } } return (performance.now() - t0) / 20; };
        const s = [], rr = [];
        for (let k = 0; k < 4; k++) { s.push(api.measure(30)); rr.push(ref()); }
        const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
        return { subject: med(s), ref: med(rr) };
      });
      console.log(`  frame cost: ${cpu.subject.toFixed(2)} ms a paint (reference canvas workload ${cpu.ref.toFixed(2)} ms, ratio ${(cpu.subject / cpu.ref).toFixed(2)})`);
      ok(cpu.subject <= Math.max(12, cpu.ref * 3), "A PAINT COSTS AT MOST THREE TIMES THE REFERENCE CANVAS WORKLOAD (floor 12 ms): " + cpu.subject.toFixed(2) + " against " + cpu.ref.toFixed(2));
    }
    await context.close();
  }

  {
    const { context, page } = await open({ reduced: true });
    const f = await page.evaluate(INSPECT);
    ok(f.reduced, "the page reads reduced motion");
    eq(verify(f, EXP), [], "UNDER REDUCED MOTION THE SAME STILL FRAME IS DRAWN");
    await context.close();
  }

  {
    const dir = nightlyEmit();
    const lb = emitRead(dir, "live-breadth");
    const richAlerts = JSON.parse(JSON.stringify(alerts).replaceAll(SESSION, RICH_DAY));
    richAlerts.rows.push({ ...richAlerts.rows[0], t: "SYX901", prem: 450000, askPrem: 300000, bidPrem: 100000 });
    const E2 = expected(richAlerts, universe);
    const { context, page } = await open({ rich: true, alerts: richAlerts });
    const f = await page.evaluate(INSPECT);
    const steps = lb.sectors.t.map((s) => Date.parse(s));
    eq(verify(f, E2, { tiles: { steps, rows: lb.sectors.rows, etf: lb.etf } }), [], "WITH THE LIVE BREADTH KEY FOR THE SESSION, EVERY LANE FLOOR TILE IS THE SECTOR'S NET TIDE AT THAT STEP, THE INDEX LANE THE FUNDS' SUM");
    ok(f.scene.tide, "the market tide of the same session stands on the wall");
    const cam = camera(f.scene.cam);
    const cen = (t) => { const q = t.pts.map((p) => cam(p[0], p[1], p[2])); return [q.reduce((a, b) => a + b.x, 0) / 4, q.reduce((a, b) => a + b.y, 0) / 4]; };
    const clear = (t) => { const c = cen(t); return f.scene.spheres.every((s) => Math.hypot(s.px - c[0], s.py - c[1]) > s.pr * 2 + 6); };
    const laneMax = new Map(f.model.lanes.map((l) => [l.name, l.path ? Math.max(1, ...l.path.filter((v) => typeof v === "number").map(Math.abs)) : 1]));
    const strong = f.scene.tiles.filter((t) => t.v !== null && Math.abs(t.v) > laneMax.get(t.lane) * 0.6 && clear(t));
    const pos = strong.filter((t) => t.v > 0).slice(0, 6), neg = strong.filter((t) => t.v < 0).slice(0, 6);
    const nul = f.scene.tiles.filter((t) => t.v === null && clear(t)).slice(0, 4);
    const px = await page.evaluate(PIXELS, [...pos, ...neg, ...nul].map(cen));
    const P = px.slice(0, pos.length), N = px.slice(pos.length, pos.length + neg.length), Z = px.slice(pos.length + neg.length);
    ok(P.length >= 3 && P.every((c) => c[1] > c[0] + 10), "A STRONG POSITIVE TIDE TILE IS GREEN ON THE FLOOR: " + JSON.stringify(P.map((c) => c.slice(0, 3))));
    ok(N.length >= 1 && N.every((c) => c[0] > c[1] + 10), "a strong negative tide tile is red: " + JSON.stringify(N.map((c) => c.slice(0, 3))));
    ok(Z.length >= 1 && Z.every((c) => Math.abs(c[0] - c[1]) < 14 && Math.abs(c[2] - c[1]) < 30), "a lane with no tide is slate, never a colour: " + JSON.stringify(Z.map((c) => c.slice(0, 3))));
    const laneBtn = page.locator('.mk-rv-lane[data-lane="Technology"]');
    await laneBtn.click();
    const read = await page.evaluate(() => document.querySelector(".mk-rv-read").textContent);
    ok(read.includes("net option tide ") && !read.includes("no tide"), "the Tech lane readout names its tide: " + read);
    await context.close();
  }

  {
    const { context, page } = await open({ alertsStatus: 500 });
    const f = await page.evaluate(INSPECT);
    ok(f.state === "unavailable" && /^Unavailable: /.test(f.empty) && /HTTP 500/.test(f.empty), "A FAILED FEED IS AN UNAVAILABLE STATE WITH ITS REASON: " + f.empty);
    await context.close();
  }
  {
    const { context, page } = await open({ alerts: { v: 1, status: "pending" } });
    const f = await page.evaluate(INSPECT);
    ok(f.state === "pending" && /^Pending: /.test(f.empty), "a pending feed says so: " + f.empty);
    await context.close();
  }
  {
    const { context, page } = await open({ alerts: { ...alerts, rows: [] } });
    const f = await page.evaluate(INSPECT);
    ok(f.state === "quiet" && /No flagged window/.test(f.empty) && /not a forecast/.test(f.empty), "an empty feed is a quiet reading, not a forecast: " + f.empty);
    await context.close();
  }
  {
    const noUni = { status: "pending" };
    const { context, page } = await open({ universe: noUni });
    const f = await page.evaluate(INSPECT);
    ok(f.state === "ok" && f.model.lanes.length === 2 && f.model.lanes.some((l) => l.name === "Sector unread") && f.model.lanes.some((l) => l.name === "Index funds"), "WITHOUT THE UNIVERSE EVERY NAME BUT THE FUNDS IS IN A Sector unread LANE: " + f.model.lanes.map((l) => l.name));
    await context.close();
  }

  const MUTANTS = [
    ["sphere radius linear in premium", "R0 + R1 * Math.sqrt(p / (M.pMax || 1))", "R0 + R1 * (p / (M.pMax || 1))"],
    ["the open at the front", "zr - (2 * zr * (ms - M.openMs)) / (endMs - M.openMs)", "-zr + (2 * zr * (ms - M.openMs)) / (endMs - M.openMs)"],
    ["lanes in name order", ".sort((a, c) => c.prem - a.prem || (a.name < c.name ? -1 : 1))", ".sort((a, c) => (a.name < c.name ? -1 : 1))"],
    ["a null tide painted as a value", "if (t.v === null) {", "if (false) {"],
    ["sides swapped", 'return r.cp === "C" ? (askSide ? "up" : "down") : (askSide ? "down" : "up");', 'return r.cp === "C" ? (askSide ? "down" : "up") : (askSide ? "up" : "down");'],
    ["labels never declutter", "if (kept.some((k) => hit(k.box, box))) { out.dropped.push(it.text); continue; }", "if (false) { continue; }"],
    ["no now line", "if (SC.now) {", "if (false) {"],
    ["TRT off by an hour", "+ 1440 + 180) % 1440", "+ 1440 + 120) % 1440"],
    ["a sphere drawn off its projection", "px: q.x, py: q.y,", "px: q.x + 6, py: q.y,"],
    ["windows of another lane", "const lane = M.lanes.find((l) => l.name === w.lane);", "const lane = M.lanes[0];"],
    ["the funds lane from one fund", "return steps.map((_, k) => e.reduce((a, x) => (a === null || !isNum(x.net[k]) ? null : a + x.net[k]), 0));", "return steps.map((_, k) => e[0].net[k]);"],
    ["a window without a premium drawn", "if (!r || typeof r.t !== \"string\" || !isNum(r.prem) || !(r.prem > 0)) { dropped++; return; }", "if (!r || typeof r.t !== \"string\") { dropped++; return; }"],
  ];
  const dir = nightlyEmit();
  const lb = emitRead(dir, "live-breadth");
  const steps = lb.sectors.t.map((s) => Date.parse(s));
  const richAlerts = JSON.parse(JSON.stringify(alerts).replaceAll(SESSION, RICH_DAY));
  richAlerts.rows.push({ ...richAlerts.rows[0], prem: null }, { ...richAlerts.rows[0], t: "SYX901", prem: 450000, askPrem: 300000, bidPrem: 100000 });
  const E2 = expected(richAlerts, universe);
  for (const [name, from, to] of MUTANTS) {
    ok(SRC.includes(from), `mutant "${name}" anchors on the served module`);
    let why = null, context = null;
    try {
      const r = await open({ rich: true, alerts: richAlerts, patch: { [JS]: [[from, to]] } });
      context = r.context;
      const f = await r.page.evaluate(INSPECT);
      const bad = verify(f, E2, { tiles: { steps, rows: lb.sectors.rows, etf: lb.etf } });
      why = bad[0] || null;
      if (!why && !f.none) {
        const cam = camera(f.scene.cam);
        const cen = (t) => { const q = t.pts.map((p) => cam(p[0], p[1], p[2])); return [q.reduce((a, b) => a + b.x, 0) / 4, q.reduce((a, b) => a + b.y, 0) / 4]; };
        const clear = (t) => { const c = cen(t); return f.scene.spheres.every((s) => Math.hypot(s.px - c[0], s.py - c[1]) > s.pr * 2 + 6); };
        const nul = f.scene.tiles.filter((t) => t.v === null && clear(t)).slice(0, 4).map(cen);
        const Z = await r.page.evaluate(PIXELS, nul);
        if (!Z.every((c) => Math.abs(c[0] - c[1]) < 14)) why = "a lane with no tide is coloured";
      }
    } catch (e) { why = "threw: " + String(e.message).split("\n")[0]; }
    console.log("  planted " + name + ": " + (why || "NOT CAUGHT").slice(0, 120));
    ok(why !== null, `THE PLANTED WRONG BUILD "${name}" FAILS THE KNOWN-ANSWER CHECKS`);
    if (context) await context.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-market-river-render: ${checks} checks passed`);
