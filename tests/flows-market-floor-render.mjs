import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { launch } from "./lib/browser.mjs";
import { openMarket, alertsFixture, universeFixture, SESSION } from "./lib/market-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-market-floor.js"), "utf8");
const JS = "/assets/js/flows-market-floor.js";
const SHOTS = process.env.FLOOR_SHOTS || null;

const FUNDS = ["SPY", "QQQ", "IWM", "DIA"];
const ETFS = new Map([["XLK", "Tech"], ["XLC", "Comms"], ["XLY", "Cyclicals"], ["XLF", "Financials"], ["XLV", "Health care"], ["XLI", "Industrials"], ["XLP", "Staples"], ["XLE", "Energy"], ["XLB", "Materials"], ["XLU", "Utilities"], ["XLRE", "Real estate"]]);
const OTHERS = new Map([["TLT", "Bonds"], ["HYG", "Bonds"], ["GLD", "Commodities"], ["SLV", "Commodities"], ["VXX", "Volatility"], ["IBIT", "Crypto"], ["EEM", "International"]]);
const SHORT = { "Technology": "Tech", "Consumer Cyclical": "Cyclicals", "Communication Services": "Comms", "Financial Services": "Financials", "Consumer Defensive": "Defensives", "Basic Materials": "Materials", "Real Estate": "Real estate", "Healthcare": "Health care" };
const GROUPS = ["funds", "etf", "other", "stocks"];
const GROUP_LABEL = { funds: "Index funds", etf: "Sector ETFs", other: "Other funds", stocks: "Stocks by sector" };
const NAMES = [
  ["NVDA", "Technology", 1.0, 0.7], ["TSLA", "Consumer Cyclical", 0.92, 0.45], ["AAPL", "Technology", 0.5, 0.62], ["AMZN", "Consumer Cyclical", 0.46, 0.66],
  ["META", "Communication Services", 0.42, 0.7], ["MSFT", "Technology", 0.4, 0.58], ["AMD", "Technology", 0.36, 0.64], ["GOOGL", "Communication Services", 0.27, 0.6],
  ["COIN", "Financial Services", 0.2, 0.6], ["JPM", "Financial Services", 0.15, 0.4], ["XOM", "Energy", 0.14, 0.35], ["LLY", "Healthcare", 0.14, 0.5],
  ["BA", "Industrials", 0.11, 0.42], ["WMT", "Consumer Defensive", 0.06, 0.6], ["FCX", "Basic Materials", 0.05, 0.6], ["NEE", "Utilities", 0.04, 0.5],
  ["SPY", null, 3.2, 0.35], ["QQQ", null, 1.9, 0.42], ["IWM", null, 0.9, 0.3], ["DIA", null, 0.25, 0.5],
  ["XLK", null, 0.7, 0.6], ["XLF", null, 0.5, 0.4], ["XLE", null, 0.35, 0.3], ["XLV", null, 0.2, 0.55], ["XLY", null, 0.3, 0.62], ["XLP", null, 0.1, 0.5], ["XLI", null, 0.12, 0.5],
  ["TLT", null, 0.3, 0.25], ["HYG", null, 0.12, 0.4], ["GLD", null, 0.4, 0.7], ["SLV", null, 0.22, 0.75], ["VXX", null, 0.18, 0.8], ["IBIT", null, 0.3, 0.68], ["EEM", null, 0.1, 0.5],
];
const MEASURES = ["premium", "volume", "lean"];
const MLABEL = { premium: "Premium", volume: "Volume", lean: "Net lean" };

const sideOf = (r) => {
  if (typeof r.askPrem !== "number" || typeof r.bidPrem !== "number" || r.askPrem === r.bidPrem) return "nx";
  const ask = r.askPrem > r.bidPrem;
  return r.cp === "C" ? (ask ? "up" : "down") : (ask ? "down" : "up");
};
function expected(alerts, universe) {
  const uniOk = Boolean(universe && universe.status === "ok");
  const sec = new Map();
  if (uniOk) universe.t.forEach((t, i) => sec.set(t, universe.sec[i] >= 0 ? universe.sectors[universe.sec[i]] : null));
  const tiles = new Map();
  const add = (group, key, label, row) => {
    const id = group + ":" + key;
    if (!tiles.has(id)) tiles.set(id, { id, group, label, n: 0, prem: 0, up: 0, down: 0, vol: 0, volN: 0, names: new Map() });
    const t = tiles.get(id);
    t.n++; t.prem += row.prem;
    const s = sideOf(row);
    if (s === "up") t.up += row.prem; else if (s === "down") t.down += row.prem;
    if (typeof row.size === "number") { t.vol += row.size; t.volN++; }
    const nm = t.names.get(row.t) || { t: row.t, prem: 0 };
    nm.prem += row.prem;
    t.names.set(row.t, nm);
  };
  for (const t of FUNDS) tiles.set("funds:" + t, { id: "funds:" + t, group: "funds", label: t, n: 0, prem: 0, up: 0, down: 0, vol: 0, volN: 0, names: new Map() });
  for (const [t] of ETFS) tiles.set("etf:" + t, { id: "etf:" + t, group: "etf", label: t, n: 0, prem: 0, up: 0, down: 0, vol: 0, volN: 0, names: new Map() });
  let total = 0, count = 0;
  for (const r of alerts.rows) {
    if (!(r.prem > 0)) continue;
    total += r.prem; count++;
    if (FUNDS.includes(r.t)) add("funds", r.t, r.t, r);
    else if (ETFS.has(r.t)) add("etf", r.t, r.t, r);
    else if (OTHERS.has(r.t)) add("other", OTHERS.get(r.t), OTHERS.get(r.t), r);
    else {
      const s = !uniOk ? "Sector unread" : sec.get(r.t) || "No sector";
      add("stocks", s, SHORT[s] || s, r);
    }
  }
  const list = [...tiles.values()];
  const ETF_ORDER = [...ETFS.keys()];
  const ordered = [];
  for (const g of GROUPS) {
    const ts = list.filter((t) => t.group === g);
    if (g === "funds") ts.sort((a, b) => FUNDS.indexOf(a.label) - FUNDS.indexOf(b.label));
    else if (g === "etf") ts.sort((a, b) => ETF_ORDER.indexOf(a.label) - ETF_ORDER.indexOf(b.label));
    else ts.sort((a, b) => b.prem - a.prem || (a.label < b.label ? -1 : 1));
    ordered.push(...ts);
  }
  for (const t of ordered) {
    t.net = t.up - t.down;
    t.share = t.n ? t.prem / total : null;
    const r = t.prem ? t.net / t.prem : null;
    t.lean = r === null ? null : Math.abs(r) < 0.1 ? "mixed" : r > 0 ? "up" : "down";
    t.value = { premium: t.n ? t.prem : null, volume: t.volN ? t.vol : null, lean: t.n ? t.net : null };
    t.nameList = [...t.names.values()].sort((a, b) => b.prem - a.prem || (a.t < b.t ? -1 : 1));
  }
  const groups = GROUPS.filter((g) => ordered.some((t) => t.group === g));
  return { tiles: ordered, groups, total, count, byId: new Map(ordered.map((t) => [t.id, t])) };
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
  const host = document.getElementById("mkFloor");
  const api = window.FlowsUI.floor && window.FlowsUI.floor.of(host);
  if (!api) return { none: true, text: host ? host.textContent : "" };
  const M = api.model(), SC = api.scene();
  const wrap = host.querySelector(".mk-fl");
  const canvas = host.querySelector("canvas");
  const cr = canvas.getBoundingClientRect();
  const mod = document.getElementById("mkFloorCard").getBoundingClientRect();
  const side = host.querySelector(".mk-fl-side");
  return {
    state: wrap.dataset.state, read: host.querySelector(".mk-fl-read").textContent, empty: host.querySelector(".mk-fl-empty").textContent, legend: host.querySelector(".mk-fl-leg").textContent,
    label: canvas.getAttribute("aria-label"), paints: api.paints(), reduced: api.reduced(), measure: api.measure_(),
    canvas: { w: cr.width, h: cr.height, left: cr.left, top: cr.top }, mod: { bottom: mod.bottom, right: mod.right },
    page: { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth },
    model: M && { total: M.total, count: M.count, uniOk: M.uniOk, groups: M.groups.map((g) => ({ id: g.id, n: g.n, prem: g.prem, vol: g.vol, share: g.share })),
      tiles: M.tiles.map((t) => ({ id: t.id, group: t.group, label: t.label, n: t.n, prem: t.prem, vol: t.vol, volN: t.volN, net: t.net, share: t.share, lean: t.lean && t.lean.cat, top: t.top.map((x) => x.t), names: t.nameList.map((x) => [x.t, x.prem]) })) },
    scene: SC && { cam: SC.cam, view: SC.view, hmax: SC.hmax, vMax: SC.vMax, sMax: SC.sMax, xr: SC.xr, zr: SC.zr, phone: SC.phone, lines: SC.lines, heads: SC.heads.map((x) => x.id),
      tiles: SC.tiles.map((s) => ({ id: s.id, row: s.row, col: s.col, x: s.x, z: s.z, v: s.v, h: s.h, lean: s.lean, stripe: s.stripe, px: s.px, py: s.py, bx: s.bx, by: s.by, pz: s.pz, box: s.box })) },
    labels: api.labels().labels, dropped: api.labels().dropped,
    hits: [...host.querySelectorAll(".mk-fl-hit")].map((b) => ({ id: b.dataset.id, tab: b.tabIndex, w: b.getBoundingClientRect().width, hh: b.getBoundingClientRect().height, label: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed") })),
    side: side ? { hidden: side.hidden, head: (side.querySelector("h3") || {}).textContent || "", items: [...side.querySelectorAll(".mk-fl-list li")].map((li) => li.children[0].textContent), hrefs: [...side.querySelectorAll(".mk-fl-list a")].map((a) => a.getAttribute("href")), more: (side.querySelector(".mk-fl-sn") || {}).textContent || "" } : null,
    tables: [...host.querySelectorAll(".mk-fl-t")].map((t) => ({ caption: t.querySelector("caption").textContent, rows: [...t.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent)) })),
    seg: [...document.querySelectorAll("#mkFloorCard .ui-seg-i")].map((b) => [b.textContent, b.getAttribute("aria-selected")]),
  };
};
const PIXELS = (pts) => {
  const canvas = document.querySelector("#mkFloor canvas");
  const g = canvas.getContext("2d");
  const dpr = canvas.width / canvas.getBoundingClientRect().width;
  return pts.map(([x, y]) => [...g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data]);
};
const FMT = (spec) => spec.map(([kind, v]) => (kind === "money" ? window.FlowsUI.F.money(v) : kind === "signed" ? window.FlowsUI.F.money(v, true) : window.FlowsUI.F.num(v)));

function verify(f, EXP, measure, { phone = false, orbit = false } = {}) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(m); };
  if (f.none) return ["the floor did not mount: " + f.text.slice(0, 80)];
  need(f.state === "ok", "state is " + f.state);
  const SC = f.scene, M = f.model;
  if (!SC || !M) return bad.concat(["no scene"]);
  need(f.measure === measure, "the measure is " + f.measure + " not " + measure);
  need(M.tiles.map((t) => t.id).join("|") === EXP.tiles.map((t) => t.id).join("|"), "tile order " + M.tiles.map((t) => t.id).join("|") + " is not " + EXP.tiles.map((t) => t.id).join("|"));
  need(Math.abs(M.total - EXP.total) < 1 && M.count === EXP.count, "total " + M.total + "/" + M.count + " against " + EXP.total + "/" + EXP.count);
  for (const t of M.tiles) {
    const e = EXP.byId.get(t.id);
    if (!e) { bad.push("tile " + t.id + " is not expected"); continue; }
    need(t.group === e.group && t.label === e.label && t.n === e.n && Math.abs(t.prem - e.prem) < 1e-6 && t.volN === e.volN && Math.abs(t.vol - e.vol) < 1e-6 && Math.abs(t.net - e.net) < 1e-6, "tile " + t.id + " sums " + [t.n, t.prem, t.vol, t.net] + " against " + [e.n, e.prem, e.vol, e.net]);
    need((t.share === null && e.share === null) || Math.abs(t.share - e.share) < 1e-9, "tile " + t.id + " share " + t.share + " against " + e.share);
    need((t.lean || null) === e.lean, "tile " + t.id + " lean " + t.lean + " against " + e.lean);
    need(t.names.map((x) => x[0]).join() === e.nameList.map((x) => x.t).join(), "tile " + t.id + " names are not ranked by premium");
    need(t.top.join() === e.nameList.slice(0, 3).map((x) => x.t).join(), "tile " + t.id + " top names");
  }
  for (const g of M.groups) {
    const es = EXP.tiles.filter((t) => t.group === g.id);
    need(Math.abs(g.prem - es.reduce((a, t) => a + t.prem, 0)) < 1e-6 && g.n === es.reduce((a, t) => a + t.n, 0), "group " + g.id + " sums");
    const hasVol = es.some((t) => t.volN);
    need((g.vol === null) === !hasVol && (g.vol === null || Math.abs(g.vol - es.reduce((a, t) => a + t.vol, 0)) < 1e-6), "group " + g.id + " volume");
  }
  need(M.groups.map((g) => g.id).join() === EXP.groups.join(), "group order " + M.groups.map((g) => g.id));
  const vals = EXP.tiles.map((t) => t.value[measure]).filter((v) => v !== null).map(Math.abs);
  const vMax = vals.length ? Math.max(...vals) : 0;
  const sMax = Math.max(0, ...EXP.tiles.map((t) => t.share || 0));
  need(Math.abs(SC.vMax - vMax) < 1e-6, "scale " + SC.vMax + " against " + vMax);
  const cam = camera(SC.cam);
  let hBad = 0, nullBad = 0, projBad = 0, stripeBad = 0, leanBad = 0, xBad = 0;
  for (const s of SC.tiles) {
    const e = EXP.byId.get(s.id);
    if (!e) continue;
    const v = e.value[measure];
    if (v === null) { if (s.v !== null || s.h !== 0) nullBad++; } else {
      if (s.v === null || Math.abs(s.v - v) > 1e-6) hBad++;
      if (Math.abs(s.h - (Math.abs(v) / vMax) * SC.hmax) > 1e-9) hBad++;
    }
    const tp = cam(s.x, s.h, s.z), bp = cam(s.x, 0, s.z);
    if (Math.abs(tp.x - s.px) > 0.01 || Math.abs(tp.y - s.py) > 0.01 || Math.abs(bp.x - s.bx) > 0.01 || Math.abs(bp.y - s.by) > 0.01) projBad++;
    if (e.share === null ? s.stripe !== null : sMax === 0 || Math.abs(s.stripe - e.share / sMax) > 1e-9) stripeBad++;
    if ((s.lean || null) !== e.lean) leanBad++;
    const line = EXP.tiles.filter((t) => t.group === e.group);
    if (!phone && Math.abs(s.x - (line.indexOf(e) - (line.length - 1) / 2)) > 1e-9) xBad++;
  }
  need(!hBad, hBad + " pillars are not at their measure's height on one scale");
  need(!nullBad, nullBad + " tiles with no value are not a flat dash");
  need(!projBad, projBad + " pillars are not where the camera puts them");
  need(!stripeBad, stripeBad + " share stripes are wrong");
  need(!leanBad, leanBad + " tiles carry the wrong lean");
  need(!xBad, xBad + " tiles are off their column");
  need(SC.heads.join() === EXP.groups.join(), "row headers " + SC.heads);
  const rowsOf = (g) => [...new Set(SC.tiles.filter((s) => s.id.startsWith(g + ":")).map((s) => s.row))];
  need(EXP.groups.every((g, i) => i === 0 || Math.min(...rowsOf(g)) > Math.max(...rowsOf(EXP.groups[i - 1]))), "rows are not in group order from the back");
  for (const s of SC.tiles) for (const u of SC.tiles) if (s.row < u.row && !(s.z > u.z)) { bad.push("an earlier row is not further back"); break; }
  const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  let over = 0, out = 0;
  f.labels.forEach((a, i) => { f.labels.forEach((b, j) => { if (j > i && hit(a.box, b.box)) over++; }); if (a.box[0] < 0 || a.box[1] < 0 || a.box[2] > f.canvas.w + 0.5 || a.box[3] > f.canvas.h + 0.5) out++; });
  need(!over, over + " label pairs overlap");
  need(!out, out + " labels leave the canvas");
  if (!phone && !orbit) {
    for (const t of EXP.tiles) need(f.labels.some((x) => x.text === t.label), "tile " + t.label + " has no label");
    for (const g of EXP.groups) need(f.labels.some((x) => x.text === GROUP_LABEL[g]), "row " + g + " has no header");
    const top = EXP.tiles.filter((t) => t.value[measure] !== null).sort((a, b) => Math.abs(b.value[measure]) - Math.abs(a.value[measure]))[0];
    need(f.labels.some((x) => /^[−$]?[\d.]+[KMB]?$|^\$/.test(x.text) && x.prio >= 8), "the tallest pillar has no value label");
    void top;
  }
  need(f.hits.length === EXP.tiles.length && f.hits.filter((x) => x.tab === 0).length === 1, "hit targets " + f.hits.length + ", in tab order " + f.hits.filter((x) => x.tab === 0).length);
  const lead = EXP.tiles.filter((t) => t.value[measure] !== null).sort((a, b) => Math.abs(b.value[measure]) - Math.abs(a.value[measure]) || (a.id < b.id ? -1 : 1))[0];
  need(!lead || f.hits.find((x) => x.tab === 0).id === lead.id, "the one tab stop is not the tallest pillar");
  need(f.hits.every((x) => x.w >= 24 && x.hh >= 24 && x.label.includes(GROUP_LABEL[(x.id.split(":")[0])])), "a hit target is small or unlabelled");
  const best = EXP.groups.map((g) => ({ g, p: EXP.tiles.filter((t) => t.group === g).reduce((a, t) => a + t.prem, 0) })).sort((a, b) => b.p - a.p)[0];
  if (f.side && !f.side.hidden && /^Classes by/.test(f.side.head)) {
    const rk = EXP.tiles.filter((t) => t.value[measure] !== null).sort((a, b) => Math.abs(b.value[measure]) - Math.abs(a.value[measure]) || (a.id < b.id ? -1 : 1)).map((t) => t.label);
    need(f.side.items.join() === rk.slice(0, f.side.items.length).join() && f.side.items.length >= 3, "the side list is not ranked by the measure: " + f.side.items);
  }
  need(f.read.startsWith("Most premium: " + GROUP_LABEL[best.g]), "the readout at rest does not lead with " + GROUP_LABEL[best.g] + ": " + f.read);
  need(/by convention/.test(f.legend) && /Bullish/.test(f.legend) && /Bearish/.test(f.legend) && /Mixed/.test(f.legend), "the legend does not state the convention");
  need(!/\bat ask\b|\bat the ask\b|\bat bid\b|\bat the bid\b/i.test(f.legend + f.read + f.label), "vendor wording");
  need(f.page.sh <= f.page.ih + 1 && f.page.sw <= f.page.iw, "the page scrolls " + JSON.stringify(f.page));
  need(f.canvas.top + f.canvas.h <= f.mod.bottom + 1 && f.canvas.left + f.canvas.w <= f.mod.right + 1, "the canvas leaves its module");
  for (const s of SC.tiles) need(s.box[0] >= -1 && s.box[2] <= f.canvas.w + 1 && s.box[3] <= f.canvas.h + 1, "tile " + s.id + " leaves the canvas " + s.box.map(Math.round));
  return bad;
}

const browser = await launch();
const alerts = alertsFixture({ n: 320, seed: 5, names: NAMES });
const universe = universeFixture(NAMES);
const EXP = expected(alerts, universe);
{
  const html = PAGES.marketPage({ username: "u", owner: true, scenes: true });
  ok(/data-view="floor"/.test(html) && html.indexOf('id="mkP-floor"') < html.indexOf('id="mkP-session"') && html.indexOf('id="mkP-session"') < html.indexOf('id="mkP-tide"') && /data-defer="floor"/.test(html), "THE FLOOR IS THE MARKET PAGE'S FIRST AND DEFAULT VIEW, LOADED AS THE floor DEFER GROUP, WITH THE SESSION KEPT AS THE SECOND TAB");
  ok(/id="mkT-floor"[^>]*aria-selected="true"/.test(html) && /id="mkT-session"[^>]*aria-selected="false"/.test(html), "the Floor tab is the selected one");
  ok(/id="mkP-session"[^>]* inert/.test(html) && !/id="mkP-floor"[^>]* inert/.test(html), "the Session panel is inert and the Floor panel is not");
  ok(!/\/\/|\/\*/.test(SRC.replace(/"[^"\n]*"|'[^'\n]*'/g, "")), "no comment in the module");
  ok(!/#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i.test(SRC.replace(/"#[0-9a-f]{3,6}"|'rgba?\(' ?|"rgba?\(" ?/gi, "").replace(/get\("--[a-z0-9-]+", "[^"]*"\)/g, "").replace(/rgba?\("[^"]*"/g, "")), "no colour literal outside token fallbacks");
  ok(EXP.count > 250 && EXP.groups.length === 4 && EXP.tiles.filter((t) => t.group === "etf" && !t.n).length >= 3, "the fixture: " + EXP.count + " windows, " + EXP.tiles.length + " classes, some ETFs with none flagged");
  console.log("  groups by hand: " + EXP.groups.map((g) => GROUP_LABEL[g] + " " + Math.round(EXP.tiles.filter((t) => t.group === g).reduce((a, t) => a + t.prem, 0) / 1e5) / 10 + "M").join(", "));
}
async function open(o = {}) {
  const r = await openMarket(browser, { alerts, universe, ...o });
  await r.page.waitForFunction(() => { const h = document.getElementById("mkFloor"); return h && window.FlowsUI.floor && window.FlowsUI.floor.of(h) && (window.FlowsUI.floor.of(h).scene() !== null || (h.querySelector(".mk-fl") && h.querySelector(".mk-fl").dataset.state !== "pending" && h.querySelector(".mk-fl").dataset.state !== "ok")); }, null, { timeout: 15000 }).catch(() => {});
  await r.page.waitForTimeout(300);
  return r;
}
const pick = async (page, m) => { await page.locator("#mkFloorCard .ui-seg-i", { hasText: MLABEL[m] }).click(); await page.waitForFunction((k) => window.FlowsUI.floor.of(document.getElementById("mkFloor")).measure_() === k, m, { timeout: 8000 }); await page.waitForTimeout(450); };
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png") }); } };
try {
  for (const [w, h] of [[1440, 820], [1024, 768], [390, 844]]) {
    const { context, page, errors } = await open({ viewport: { width: w, height: h }, coarse: w < 500 });
    for (const m of MEASURES) {
      if (m !== "premium") await pick(page, m);
      const f = await page.evaluate(INSPECT);
      eq(verify(f, EXP, m, { phone: w < 640 }), [], `${w}x${h} ${m}: EVERY PILLAR IS AT ITS CLASS'S HEIGHT ON ONE SCALE, COLOURED BY LEAN, LABELS DO NOT OVERLAP, THE PAGE DOES NOT SCROLL`);
      await shot(page, `floor-${m}-${w}`);
      if (m === "premium") console.log(`  ${w}: ${f.scene.tiles.length} pillars on ${f.scene.lines} lines, ${f.labels.length} labels drawn, ${f.dropped.length} dropped, canvas ${Math.round(f.canvas.w)}x${Math.round(f.canvas.h)}, side ${f.side && !f.side.hidden}`);
    }
    await pick(page, "premium");
    const f0 = await page.evaluate(INSPECT);
    eq(f0.side.hidden, w < 800, `${w}: the side list shows only where the module is wide enough`);
    eq(errors, [], `${w}: no page error`);
    await context.close();
  }

  {
    const { context, page } = await open({});
    const f = await page.evaluate(INSPECT);
    const rank = EXP.tiles.filter((t) => t.value.premium !== null).sort((a, b) => b.value.premium - a.value.premium || (a.id < b.id ? -1 : 1));
    eq(f.side.items.slice(0, 5), rank.slice(0, 5).map((t) => t.label), "THE SIDE LIST RANKS THE CLASSES BY THE CHOSEN MEASURE");
    eq(f.seg, [["Premium", "true"], ["Volume", "false"], ["Net lean", "false"]], "the height switch starts on Premium");
    await pick(page, "volume");
    const fv = await page.evaluate(INSPECT);
    const rankV = EXP.tiles.filter((t) => t.value.volume !== null).sort((a, b) => b.value.volume - a.value.volume || (a.id < b.id ? -1 : 1));
    eq(fv.side.items.slice(0, 5), rankV.slice(0, 5).map((t) => t.label), "the side list follows the Volume measure");
    await pick(page, "lean");
    const fl = await page.evaluate(INSPECT);
    const rankL = EXP.tiles.filter((t) => t.value.lean !== null).sort((a, b) => Math.abs(b.value.lean) - Math.abs(a.value.lean) || (a.id < b.id ? -1 : 1));
    eq(fl.side.items.slice(0, 5), rankL.slice(0, 5).map((t) => t.label), "and Net lean");
    await pick(page, "premium");

    const lead = rank[0];
    await page.focus('.mk-fl-hit[tabindex="0"]');
    eq(await page.evaluate(() => document.activeElement.dataset.id), lead.id, "THE ONE HIT IN THE TAB ORDER IS THE TALLEST PILLAR");
    ok((await page.evaluate(() => document.querySelector(".mk-fl-read").textContent)).startsWith(lead.label), "and the readout names it");
    const order = EXP.tiles.map((t) => t.id);
    const at = order.indexOf(lead.id);
    await page.keyboard.press("ArrowRight");
    eq(await page.evaluate(() => document.activeElement.dataset.id), order[at + 1], "ArrowRight moves to the next class");
    await page.keyboard.press("End");
    eq(await page.evaluate(() => document.activeElement.dataset.id), order[order.length - 1], "End reaches the last class");
    await page.keyboard.press("Home");
    eq(await page.evaluate(() => document.activeElement.dataset.id), order[0], "Home returns to the first");
    await page.keyboard.press("Enter");
    let g = await page.evaluate(INSPECT);
    eq(g.hits.filter((x) => x.pressed === "true").map((x) => x.id), [order[0]], "Enter selects the class");
    ok(g.read.startsWith(EXP.byId.get(order[0]).label) && /top names/.test(g.read), "and the readout gives its lines: " + g.read);
    await page.keyboard.press("Escape");
    g = await page.evaluate(INSPECT);
    ok(g.read.startsWith("Most premium") && g.hits.every((x) => x.pressed === "false"), "Escape clears the selection");
    const stock = EXP.tiles.filter((t) => t.group === "stocks").sort((a, b) => b.prem - a.prem)[0];
    await page.focus(`.mk-fl-hit[data-id="${stock.id}"]`);
    await page.keyboard.press("Enter");
    g = await page.evaluate(INSPECT);
    eq(g.side.head, stock.label, "SELECTING A CLASS DRILLS THE SIDE LIST TO ITS NAMES");
    eq(g.side.items.slice(0, 8), stock.nameList.slice(0, 8).map((x) => x.t), "the names are ranked by flagged premium");
    ok(g.side.hrefs.every((u) => /^\/flows\/ticker\/\?t=[A-Z]+$/.test(u)), "each name links to its ticker page");
    await page.locator(".mk-fl-x").click();
    g = await page.evaluate(INSPECT);
    ok(/Classes by/.test(g.side.head), "Back to classes returns to the ranking");
    await page.locator('.mk-fl-hit[data-id="funds:SPY"]').click({ force: true });
    g = await page.evaluate(INSPECT);
    ok(g.hits.some((x) => x.pressed === "true") && g.side.head !== "" && !/Classes by/.test(g.side.head), "a click selects a pillar and drills");
    await shot(page, "floor-selected-1440");
    await page.keyboard.press("Escape");

    const v0 = (await page.evaluate(INSPECT)).scene.view;
    await page.mouse.move(700, 560);
    await page.mouse.down();
    await page.mouse.move(760, 540, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(5, 5);
    const v1 = (await page.evaluate(INSPECT));
    ok(v1.scene.view.yaw > v0.yaw + 0.05 && v1.scene.view.pitch < v0.pitch - 0.01, "A DRAG ORBITS THE CAMERA: yaw " + v0.yaw.toFixed(3) + " to " + v1.scene.view.yaw.toFixed(3));
    eq(verify(v1, EXP, "premium", { orbit: true }), [], "after an orbit every pillar is still where the camera puts it with no label overlap");
    eq(v1.hits.filter((x) => x.pressed === "true").length, 0, "a drag does not select a pillar");
    await page.focus('.mk-fl-hit[tabindex="0"]');
    await page.keyboard.press("Shift+ArrowLeft");
    const v2 = (await page.evaluate(INSPECT)).scene.view;
    ok(v2.yaw < v1.scene.view.yaw - 0.03, "Shift and an arrow orbit from the keyboard");
    await page.locator(".mk-fl-rc").click();
    const v3 = (await page.evaluate(INSPECT)).scene.view;
    ok(Math.abs(v3.yaw - v0.yaw) < 1e-9 && Math.abs(v3.pitch - v0.pitch) < 1e-9, "Recentre returns to the opening view");
    for (let i = 0; i < 60; i++) await page.evaluate(() => window.FlowsUI.floor.of(document.getElementById("mkFloor")).orbit(10, 10));
    const vc = (await page.evaluate(INSPECT)).scene.view;
    ok(vc.yaw <= 40.0001 * Math.PI / 180 && vc.pitch <= 62.0001 * Math.PI / 180, "the orbit is clamped");
    await page.locator(".mk-fl-rc").click();

    await page.click(".mk-fl-tb");
    const dlg = await page.evaluate(() => { const d = document.querySelector(".mk-fl-dlg"); return { open: d.open, tables: d.querySelectorAll(".mk-fl-t").length, fits: d.getBoundingClientRect().height <= innerHeight + 1 }; });
    eq(dlg, { open: true, tables: 2, fits: true }, "THE TABLES BUTTON OPENS THE TWIN IN A DIALOG THAT FITS THE SCREEN");
    const tb = await page.evaluate(INSPECT);
    const ranked = EXP.tiles.slice().sort((a, b) => b.prem - a.prem || (a.id < b.id ? -1 : 1));
    eq(tb.tables[0].rows.map((r) => r[0]), ranked.map((t) => t.label), "the class table lists every class by flagged premium");
    const fmt = await page.evaluate(FMT, ranked.flatMap((t) => [["money", t.prem]]));
    ok(ranked.every((t, i) => (t.n ? tb.tables[0].rows[i][2] === fmt[i] : tb.tables[0].rows[i][2] === "—")), "each premium cell is the formatted sum, a dash where nothing was flagged");
    eq(tb.tables[1].rows.map((r) => r[0]), EXP.tiles.flatMap((t) => t.nameList).sort((a, b) => b.prem - a.prem || (a.t < b.t ? -1 : 1)).slice(0, 40).map((x) => x.t), "the names table holds the largest names by flagged premium");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    eq(await page.evaluate(() => ({ open: document.querySelector(".mk-fl-dlg").open, hidden: document.querySelector(".mk-fl-tables").hidden })), { open: false, hidden: true }, "and Escape closes it");

    const before = await page.evaluate(() => window.FlowsUI.floor.of(document.getElementById("mkFloor")).paints());
    await page.waitForTimeout(2000);
    eq(await page.evaluate(() => window.FlowsUI.floor.of(document.getElementById("mkFloor")).paints()), before, "PAINT CENSUS AT REST IS ZERO over two seconds");

    const f2 = await page.evaluate(INSPECT);
    const pts = [];
    const want = [];
    const nearer = (s) => f2.scene.tiles.filter((u) => u.pz < s.pz);
    for (const s of f2.scene.tiles) {
      const e = EXP.byId.get(s.id);
      if (!e || s.v === null || s.h < 0.9 || !e.lean || e.lean === "mixed") continue;
      const pt = [s.bx - 4, (s.by + s.py) / 2];
      if (nearer(s).some((u) => pt[0] >= u.box[0] && pt[0] <= u.box[2] && pt[1] >= u.box[1] && pt[1] <= u.box[3])) continue;
      pts.push(pt); want.push(e.lean);
    }
    const px = await page.evaluate(PIXELS, pts);
    ok(px.length >= 2 && px.every((c, i) => (want[i] === "up" ? c[1] > c[0] + 8 : c[0] > c[1] + 8)), "A TALL BULLISH PILLAR IS GREEN AND A BEARISH ONE RED ON THE CANVAS: " + JSON.stringify(px.map((c, i) => [want[i], c.slice(0, 3)])));
    const dash = f2.scene.tiles.filter((s) => s.v === null && !f2.scene.tiles.some((u) => u.pz < s.pz && s.bx >= u.box[0] && s.bx <= u.box[2] && s.by >= u.box[1] && s.by <= u.box[3]));
    const dpx = await page.evaluate(PIXELS, dash.map((s) => [s.bx, s.by]));
    ok(dpx.length >= 1 && dpx.every((c) => Math.abs(c[0] - c[1]) < 22 && Math.abs(c[2] - c[1]) < 40), "a class with nothing flagged is a neutral dashed tile, never a colour: " + JSON.stringify(dpx.map((c) => c.slice(0, 3))));
    const cpu = await page.evaluate(() => {
      const api = window.FlowsUI.floor.of(document.getElementById("mkFloor"));
      const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 500; const g = cv.getContext("2d");
      const ref = () => { const t0 = performance.now(); for (let r = 0; r < 20; r++) { for (let i = 0; i < 160; i++) { g.beginPath(); g.arc(20 + (i * 37) % 1160, 20 + (i * 53) % 460, 12, 0, 6.283); g.fillStyle = "rgb(" + (i % 255) + ",120,90)"; g.fill(); } for (let i = 0; i < 60; i++) { g.font = "11px sans-serif"; g.fillText("label " + i, (i * 97) % 1100, 20 + (i * 13) % 460); } } return (performance.now() - t0) / 20; };
      const s = [], rr = [];
      for (let k = 0; k < 4; k++) { s.push(api.measure(30)); rr.push(ref()); }
      const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
      return { subject: med(s), ref: med(rr) };
    });
    console.log(`  frame cost: ${cpu.subject.toFixed(2)} ms a paint (reference canvas workload ${cpu.ref.toFixed(2)} ms, ratio ${(cpu.subject / cpu.ref).toFixed(2)})`);
    ok(cpu.subject <= Math.max(6, cpu.ref * 2), "A PAINT COSTS AT MOST TWICE THE REFERENCE CANVAS WORKLOAD (floor 6 ms; target under 2 ms): " + cpu.subject.toFixed(2) + " against " + cpu.ref.toFixed(2));
    await context.close();
  }

  {
    const { context, page } = await open({ reduced: true });
    const f = await page.evaluate(INSPECT);
    ok(f.reduced, "the page reads reduced motion");
    eq(verify(f, EXP, "premium"), [], "UNDER REDUCED MOTION THE SAME STILL FRAME IS DRAWN");
    await context.close();
  }

  {
    const part = JSON.parse(JSON.stringify(alerts));
    part.rows = part.rows.map((r) => (r.t === "GLD" || r.t === "TLT" || r.t === "HYG" ? { ...r, size: null } : r));
    const E = expected(part, universe);
    const { context, page } = await open({ alerts: part });
    await pick(page, "volume");
    const f = await page.evaluate(INSPECT);
    eq(verify(f, E, "volume"), [], "A CLASS WITH NO CONTRACT COUNT IS A DASH ON THE VOLUME VIEW, A CLASS WITH SOME IS SUMMED FROM THOSE");
    const com = E.byId.get("other:Commodities"), bonds = E.byId.get("other:Bonds");
    ok(com.volN > 0 && com.volN < com.n && bonds.n > 0 && bonds.volN === 0, "the fixture has a partly counted class and an uncounted one");
    ok(f.scene.tiles.find((s) => s.id === "other:Commodities").v !== null, "the partly counted class still has a height");
    ok(/from \d+ of \d+ windows/.test(f.hits.find((x) => x.id === "other:Commodities").label), "and says how many windows the volume comes from");
    ok(f.scene.tiles.find((s) => s.id === "other:Bonds").v === null && /no contract count carried/.test(f.hits.find((x) => x.id === "other:Bonds").label), "Bonds: value null, reason spoken");
    ok(/no flagged window/.test(f.hits.find((x) => x.id === "etf:XLU").label), "an ETF with nothing flagged says so");
    await shot(page, "floor-volume-partial-1440");
    await context.close();
  }

  {
    const { context, page } = await open({ universe: { status: "pending" } });
    const f = await page.evaluate(INSPECT);
    const E = expected(alerts, { status: "pending" });
    eq(verify(f, E, "premium"), [], "WITHOUT THE UNIVERSE EVERY STOCK IS IN ONE Sector unread TILE AND THE FUNDS ARE STILL THEIR OWN CLASSES");
    ok(f.model.tiles.some((t) => t.id === "stocks:Sector unread") && f.model.tiles.filter((t) => t.group === "stocks").length === 1, "one unread stocks tile");
    await context.close();
  }
  {
    const { context, page } = await open({ alertsStatus: 500 });
    const f = await page.evaluate(INSPECT);
    ok(f.state === "unavailable" && /^Unavailable: /.test(f.empty) && /HTTP 500/.test(f.empty), "A FAILED FEED IS AN UNAVAILABLE STATE WITH ITS REASON: " + f.empty);
    await shot(page, "floor-unavailable-1440");
    await context.close();
  }
  {
    const { context, page } = await open({ alerts: { v: 1, status: "pending" } });
    const f = await page.evaluate(INSPECT);
    ok(f.state === "pending" && /^Pending: /.test(f.empty), "a pending feed says so: " + f.empty);
    await shot(page, "floor-pending-1440");
    await context.close();
  }
  {
    const { context, page } = await open({ alerts: { ...alerts, rows: [] } });
    const f = await page.evaluate(INSPECT);
    ok(f.state === "quiet" && /No flagged window/.test(f.empty) && /not a forecast/.test(f.empty), "an empty feed is a quiet reading, not a forecast: " + f.empty);
    await shot(page, "floor-empty-1440");
    await context.close();
  }
  {
    const { context, page } = await open({ viewport: { width: 390, height: 844 }, coarse: true });
    const f = await page.evaluate(INSPECT);
    ok(f.scene.lines > f.scene.heads.length, "ON A PHONE THE LONG ROWS WRAP INTO SHORTER LINES: " + f.scene.lines + " lines for " + f.scene.heads.length + " groups");
    ok(f.hits.every((x) => x.w >= 43.9 && x.hh >= 43.9), "every hit target is at least 44 px on a coarse pointer");
    await page.locator('.mk-fl-hit[data-id="funds:SPY"]').click({ force: true });
    const g = await page.evaluate(INSPECT);
    ok(g.hits.some((x) => x.pressed === "true") && /SPY/.test(g.read), "a tap selects a pillar and the readout names it: " + g.read);
    await shot(page, "floor-selected-390");
    await context.close();
  }

  const MUTANTS = [
    ["volume ignored for height", 'if (measure === "volume") return t.volN ? t.vol : null;', "if (false) return null;"],
    ["a class with no count drawn as zero", "return t.volN ? t.vol : null;", "return t.vol;"],
    ["an empty class drawn as zero", 'return t.n ? (measure === "lean" ? t.net : t.prem) : null;', 'return t.n ? (measure === "lean" ? t.net : t.prem) : 0;'],
    ["net lean height is premium", 'return t.n ? (measure === "lean" ? t.net : t.prem) : null;', "return t.n ? t.prem : null;"],
    ["height not linear in the measure", "(Math.abs(v) / vMax) * hmax", "Math.sqrt(Math.abs(v) / vMax) * hmax"],
    ["sector ETFs counted as index funds", 'else if (ETF_OF.has(T)) tile = tiles.get("etf:" + T);', 'else if (ETF_OF.has(T)) tile = tiles.get("funds:SPY");'],
    ["sides swapped", 'return r.cp === "C" ? (askSide ? "up" : "down") : (askSide ? "down" : "up");', 'return r.cp === "C" ? (askSide ? "down" : "up") : (askSide ? "up" : "down");'],
    ["share of the wrong total", "t.share = total > 0 && t.n ? t.prem / total : null;", "t.share = total > 0 && t.n ? t.prem / (2 * total) : null;"],
    ["stocks split by sector without the universe", 'const sec = !uniOk ? STOCK_UNREAD : secOf.get(T) || STOCK_NONE;', "const sec = secOf.get(T) || STOCK_NONE;", { status: "pending" }],
    ["a pillar drawn off its projection", "Object.assign(s, { ped, px: top.x,", "Object.assign(s, { ped, px: top.x + 6,"],
    ["the side list ranked upward", "Math.abs(valueOf(b, measure)) - Math.abs(valueOf(a, measure)) || (a.id < b.id ? -1 : 1));\n      const list", "Math.abs(valueOf(a, measure)) - Math.abs(valueOf(b, measure)) || (a.id < b.id ? -1 : 1));\n      const list"],
    ["labels never declutter", "if (kept.some((k) => hit(k, box))) { out.dropped.push(it.text); continue; }", "if (false) { continue; }"],
    ["a window without a premium counted", "if (!r || typeof r.t !== \"string\" || !isNum(r.prem) || !(r.prem > 0)) { dropped++; return; }", "if (!r || typeof r.t !== \"string\") { dropped++; return; }"],
    ["names ranked by name", "t.nameList = [...t.names.values()].map((x) => ({ ...x, net: x.up - x.down, lean: leanOf(x.up - x.down, x.prem) })).sort((a, b) => b.prem - a.prem || (a.t < b.t ? -1 : 1));", "t.nameList = [...t.names.values()].map((x) => ({ ...x, net: x.up - x.down, lean: leanOf(x.up - x.down, x.prem) })).sort((a, b) => (a.t < b.t ? -1 : 1));"],
  ];
  const MA = JSON.parse(JSON.stringify(alerts));
  MA.rows = MA.rows.map((x) => (x.t === "GLD" ? { ...x, size: null } : x));
  MA.rows.push({ ...MA.rows[0], prem: null });
  for (const [name, from, to, uni] of MUTANTS) {
    ok(SRC.includes(from), `mutant "${name}" anchors on the served module`);
    const U = uni || universe, E = expected(MA, U);
    let why = null, context = null;
    try {
      const r = await open({ patch: { [JS]: [[from, to]] }, alerts: MA, universe: U });
      context = r.context;
      for (const m of MEASURES) {
        if (why) break;
        if (m !== "premium") await pick(r.page, m);
        why = verify(await r.page.evaluate(INSPECT), E, m)[0] || null;
      }
    } catch (e) { why = "threw: " + String(e.message).split("\n")[0]; }
    console.log("  planted " + name + ": " + (why || "NOT CAUGHT").slice(0, 120));
    ok(why !== null, `THE PLANTED WRONG BUILD "${name}" FAILS THE KNOWN-ANSWER CHECKS`);
    if (context) await context.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-market-floor-render: ${checks} checks passed`);
