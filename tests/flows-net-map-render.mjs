import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { openMarket, alertsFixture, universeFixture, NAMES } from "./lib/market-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9), msg + ` (${a} against ${b})`); checks++; };
const MAP = "/assets/js/flows-net-map.js";
const SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-net-map.js"), "utf8");

const KIND = { ca: "Calls · ask side", pb: "Puts · bid side", pa: "Puts · ask side", cb: "Calls · bid side" };
const SECTOR_OF = new Map(NAMES.map((n) => [n[0], n[1] || "No sector in the universe"]));
const LEAN = { ca: "Bullish", pb: "Bullish", cb: "Bearish", pa: "Bearish" };

function expectedOf(alerts) {
  const kinds = { ca: 0, pb: 0, pa: 0, cb: 0 };
  const byName = new Map(), bySector = new Map(), byLean = { Bullish: 0, Bearish: 0 };
  let total = 0, flagged = 0, windows = 0;
  const paths = new Map();
  for (const r of alerts.rows) {
    if (!(r.prem > 0)) continue;
    windows++;
    flagged += r.prem;
    const a = r.askPrem || 0, b = r.bidPrem || 0;
    const k = a + b > r.prem ? r.prem / (a + b) : 1;
    const parts = [[r.cp === "C" ? "ca" : "pa", a * k], [r.cp === "C" ? "cb" : "pb", b * k]];
    for (const [kind, v] of parts) {
      if (!(v > r.prem * 1e-9)) continue;
      kinds[kind] += v;
      total += v;
      byName.set(r.t, (byName.get(r.t) || 0) + v);
      const sec = SECTOR_OF.get(r.t);
      bySector.set(sec, (bySector.get(sec) || 0) + v);
      byLean[LEAN[kind]] += v;
      const key = kind + "|" + sec + "|" + r.t + "|" + LEAN[kind];
      paths.set(key, (paths.get(key) || 0) + v);
    }
  }
  return { total, flagged, windows, kinds, byName, bySector, byLean, paths: [...paths.entries()].sort((x, y) => y[1] - x[1]) };
}

async function sceneOf(page) {
  return page.evaluate(() => {
    const api = window.FlowsUI.netMap.of(document.getElementById("mkNet"));
    const sc = api.scene();
    const M = api.model();
    const labels = {};
    for (const g of document.querySelectorAll("#mkNet .nm-chip")) {
      const lb = g.querySelector(".nm-lb"), fg = g.querySelector(".nm-fg");
      labels[g.dataset.id] = { label: lb.textContent, fig: fg.textContent, aria: g.getAttribute("aria-label"), title: g.querySelector("title").textContent, lbw: lb.getComputedTextLength(), fgw: fg.getComputedTextLength(), two: lb.getAttribute("y") !== fg.getAttribute("y"), other: g.classList.contains("is-other") };
    }
    return { sc, labels, total: M.total, layers: M.layers.map((l) => l.map((n) => ({ id: n.id, v: n.v, label: n.label, full: n.full || null, members: n.members, share: n.share }))), read: api.readout() };
  });
}

async function audit(page, exp, label) {
  const bad = [];
  const { sc, labels, total, layers, read } = await sceneOf(page);
  const note = (m) => bad.push(label + ": " + m);
  if (Math.abs(total - exp.total) > 1e-6 * exp.total) note("total premium is not the independent sum");
  layers.forEach((l, i) => { const s = l.reduce((a, n) => a + n.v, 0); if (Math.abs(s - exp.total) > 1e-6 * exp.total) note("layer " + i + " does not sum to the total"); });
  for (const n of layers[2]) {
    if (n.id === "n:~") continue;
    const t = n.id.slice(2);
    if (Math.abs(n.v - exp.byName.get(t)) > 1e-6 * n.v) note("name " + t + " is not its independent sum");
    if (!labels["n:" + t] || labels["n:" + t].label !== t) note("name chip " + t + " is not labelled with its ticker");
  }
  const kept = layers[2].filter((n) => n.id !== "n:~").length;
  const top = [...exp.byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, kept).map((e) => e[0]);
  if (JSON.stringify(layers[2].filter((n) => n.id !== "n:~").map((n) => n.id.slice(2))) !== JSON.stringify(top)) note("the names kept are not the largest by premium, in order");
  const other = layers[2].find((n) => n.id === "n:~");
  if (exp.byName.size > kept) {
    if (!other) note("names beyond the cap have no Other chip");
    else {
      if (other.members.length !== exp.byName.size - kept) note("Other names does not list every folded name");
      const rest = [...exp.byName.entries()].filter((e) => !top.includes(e[0])).reduce((a, e) => a + e[1], 0);
      if (Math.abs(other.v - rest) > 1e-6 * rest) note("Other names is not the sum of the folded names");
    }
  }
  const kindVals = Object.entries(exp.kinds).filter((e) => e[1] > 0);
  eqCheck(layers[1].map((n) => Math.round(n.v)).sort((a, b) => a - b), kindVals.map((e) => Math.round(e[1])).sort((a, b) => a - b), () => note("the side chips are not the five independent side sums"));
  for (const [k, v] of kindVals) { const c = labels["i:" + k]; if (!c || c.label !== KIND[k]) note("side chip " + k + " is not labelled '" + KIND[k] + "'"); else void v; }
  const leanVals = Object.entries(exp.byLean).filter((e) => e[1] > 0);
  eqCheck(layers[3].map((n) => Math.round(n.v)).sort((a, b) => a - b), leanVals.map((e) => Math.round(e[1])).sort((a, b) => a - b), () => note("the lean chips are not the independent lean sums"));
  const secVals = [...exp.bySector.values()].sort((a, b) => b - a);
  const named = layers[0].filter((n) => n.id !== "s:~");
  const expTop = secVals.slice(0, named.length).map(Math.round).sort((a, b) => a - b);
  eqCheck(named.map((n) => Math.round(n.v)).sort((a, b) => a - b), expTop, () => note("the sector chips are not the largest independent sector sums"));
  for (const n of named) {
    const c = labels[n.id];
    if (n.full && n.full !== n.label && !(c.label === n.full || c.label === n.label)) note("sector chip " + n.id + " carries neither its full nor its short name");
    if (n.full && n.full !== n.label && c.label === n.label && !c.title.includes(n.full)) note("sector chip " + n.id + " is abbreviated with no full name in its title");
  }
  for (const [id, c] of Object.entries(labels)) {
    const node = sc.chips.find((x) => x.id === id);
    if (!c.label || !c.fig) note("chip " + id + " has no label or no figure");
    if (!/^\$?[\d.,]+[KMB]?|—/.test(c.fig) || !/%|<1%/.test(c.fig)) note("chip " + id + " figure lacks a dollar amount and a share: " + c.fig);
    const node2 = layers.flat().find((n) => n.id === id);
    const frac = node2.v / exp.total;
    const want = frac > 0 && frac < 0.005 ? "<1%" : Math.round(frac * 100) + "%";
    if (!c.fig.endsWith(want)) note("chip " + id + " prints a share of " + c.fig + " where the independent share is " + want);
    if (!c.aria || !c.aria.includes(c.label.replace(/ \(\d+\)$/, "")) || !/%/.test(c.aria)) note("chip " + id + " has no complete accessible name");
    const room = node.w - 18;
    const need = c.two ? Math.max(c.lbw, c.fgw) : c.lbw + c.fgw + 8;
    if (need > room + 0.5) note("chip " + id + " text is wider than its chip (" + Math.round(need) + " against " + Math.round(room) + ")");
    if (c.other && !/folds in/.test(c.aria)) note("Other chip " + id + " does not say what it folds in");
  }
  const byLayer = new Map();
  for (const c of sc.chips) { if (!byLayer.has(c.layer)) byLayer.set(c.layer, []); byLayer.get(c.layer).push(c); }
  for (const [, cs] of byLayer) {
    cs.sort((a, b) => a.y - b.y);
    for (let i = 0; i < cs.length; i++) {
      if (cs[i].y < 22 || cs[i].y + cs[i].h > sc.h + 0.5 || cs[i].x < -0.5 || cs[i].x + cs[i].w > sc.w + 0.5) note("chip " + cs[i].id + " leaves the scene");
      if (i && cs[i].y < cs[i - 1].y + cs[i - 1].h - 0.01) note("chips " + cs[i - 1].id + " and " + cs[i].id + " overlap");
    }
  }
  if (!sc.phone) {
    const xs = [...new Set(sc.chips.map((c) => Math.round(c.x)))].sort((a, b) => a - b);
    if (xs.length !== 4) note("the scene has " + xs.length + " columns, not four");
    for (const b of sc.bands) {
      const want = Math.max(1.4, b.v * sc.k);
      if (Math.abs(b.w - want) > 1e-6) note("band " + b.a + " to " + b.b + " is not drawn at its premium");
    }
  }
  if (!/ of \$[\d.,]+[KMB]? sided premium, \d+%|<1%/.test(read) || !/ from /.test(read) || !/ to /.test(read) || !/window/.test(read) || !/convention/.test(read)) note("the readout does not state share, from, to, windows and the convention: " + read);
  if (exp.byLean) {
    const stats = await page.evaluate(() => document.querySelector("#mkNet .nm-stats").textContent);
    const F = exp.flagged, bull = exp.byLean.Bullish, bear = exp.byLean.Bearish;
    const lo = Math.floor((bull / F) * 100 + 1e-9), hi = Math.ceil(((F - bear) / F) * 100 - 1e-9);
    const blo = Math.floor((bear / F) * 100 + 1e-9), bhi = Math.ceil(((F - bull) / F) * 100 - 1e-9);
    if (!stats.includes(lo + "\u2013" + hi + "% bullish") || !stats.includes(blo + "\u2013" + bhi + "% bearish")) note("the stats line does not print the lean as a range from the sided premium: " + stats);
    if (!stats.includes("sided of") || !stats.includes(Math.round((exp.total / F) * 100) + "%")) note("the stats line does not print the sided coverage: " + stats);
    if (/unsided|unattributed/i.test(stats)) note("the stats line names an unsided bucket");
  }
  return bad;
}
const eqCheck = (a, b, fail) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(); };

async function legendOf(page) {
  return page.evaluate(() => document.querySelector("#mkNet .nm-legend").textContent);
}

const browser = await launch();
const ALERTS = alertsFixture({ n: 170, seed: 23 });
const EXP = expectedOf(ALERTS);

async function open(opts = {}) {
  const r = await openMarket(browser, { alerts: ALERTS, ...opts });
  await r.page.click("#mkT-network");
  await r.page.waitForSelector("#mkNet .nm-chip, #mkNet .nm-empty", { timeout: 20000 });
  await r.page.waitForTimeout(400);
  return r;
}

for (const [w, h] of [[1440, 820], [1024, 768]]) {
  const { context, page, errors } = await open({ viewport: { width: w, height: h } });
  const bad = await audit(page, EXP, `${w} lean`);
  eq(bad, [], `${w}: EVERY CHIP, BAND AND READOUT IS IDENTIFIED AND EQUALS THE INDEPENDENT SUMS`);
  const lg = await legendOf(page);
  ok(/Chip base and band colour/.test(lg) && /Band width/.test(lg) && /Dashed chip/.test(lg) && /Figure/.test(lg) && /convention/.test(lg), `${w}: the legend names the colour, band width, Other and figure encodings and the lean convention`);
  ok(!/\bat (the )?(ask|bid)\b/i.test(lg), `${w}: no vendor term in the legend`);
  const heads = await page.evaluate(() => [...document.querySelectorAll("#mkNet .nm-cap")].map((t) => t.textContent));
  eq(heads.length, 4, `${w}: four captions`);
  ok(heads.every((t) => /\$[\d.]+[KMB]/.test(t)), `${w}: every caption carries the same total`);
  ok(new Set(heads.map((t) => t.split("·")[1])).size === 1, `${w}: and the totals are identical`);
  const read0 = await page.evaluate(() => document.querySelector("#mkNet .nm-read").textContent);
  const first = Object.entries(EXP.byName).length || [...EXP.byName.entries()].sort((a, b) => b[1] - a[1])[0];
  const topName = [...EXP.byName.entries()].sort((a, b) => b[1] - a[1])[0];
  ok(read0.startsWith(topName[0]), `${w}: the readout is never empty: the largest name, ${topName[0]}, is selected at rest (${read0.slice(0, 60)})`);
  void first;
  const chipIds = await page.evaluate(() => [...document.querySelectorAll("#mkNet .nm-chip")].map((g) => g.dataset.id));
  const pick = chipIds.find((id) => id.startsWith("n:") && id !== "n:~" && !read0.startsWith(id.slice(2)));
  await page.click(`#mkNet .nm-chip[data-id="${pick}"]`);
  const read1 = await page.evaluate(() => document.querySelector("#mkNet .nm-read").textContent);
  ok(read1.startsWith(pick.slice(2)), `${w}: a click selects ${pick} and the readout follows`);
  const want = EXP.byName.get(pick.slice(2));
  ok(read1.includes(" of $") && new RegExp("\\b" + Math.round((want / EXP.total) * 100) + "%").test(read1), `${w}: with its share of the total, ${Math.round((want / EXP.total) * 100)}%`);
  const lit = await page.evaluate(() => ({ on: document.querySelectorAll("#mkNet .nm-band.is-on").length, off: document.querySelectorAll("#mkNet .nm-band.is-off").length }));
  ok(lit.on > 0 && lit.off > 0, `${w}: the selected node's paths are lit and the rest stepped back`);
  await page.focus(`#mkNet .nm-chip[data-id="${pick}"]`);
  await page.keyboard.press("ArrowDown");
  const moved = await page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  ok(moved && moved !== pick, `${w}: ArrowDown moves to the next name chip (${moved})`);
  await page.keyboard.press("ArrowRight");
  eq(await page.evaluate(() => document.activeElement.classList.contains("l3")), true, `${w}: ArrowRight moves to the next layer`);
  await page.keyboard.press("Enter");
  ok(await page.evaluate(() => document.querySelector("#mkNet .nm-chip.is-sel") !== null), `${w}: Enter selects`);
  if (w === 1440) {
    await page.click('#mkNet .nm-chip[data-id="n:~"]');
    const r2 = await page.evaluate(() => document.querySelector("#mkNet .nm-read").textContent);
    ok(/Show members/.test(r2), `${w}: OTHER NAMES SAYS HOW TO SEE ITS MEMBERS`);
    await page.click("#mkNet .nm-read .nm-link");
    await page.waitForSelector("#mkNet dialog[open] table");
    const rows = await page.evaluate(() => [...document.querySelectorAll("#mkNet dialog[open] tbody tr")].map((tr) => [tr.children[0].textContent, tr.children[1].textContent]));
    const memberN = EXP.byName.size - (await sceneOf(page)).layers[2].filter((n) => n.id !== "n:~").length;
    eq(rows.length, memberN, `${w}: the member list has every folded name`);
    ok(rows.every((r) => EXP.byName.has(r[0])), `${w}: each member is a real name with its premium (${rows[0].join(" ")})`);
    const dh = await page.evaluate(() => document.querySelector("#mkNet dialog[open]").getBoundingClientRect().height);
    ok(dh <= 820, `${w}: the dialog fits the viewport`);
    await page.keyboard.press("Escape");
    await page.click('#mkNet .nm-chip[data-id="s:~"]').catch(() => null);
    await page.click("#mkNet .nm-seg button[data-mode='dte']");
    const bad2 = await audit(page, { ...EXP, byLean: null, kinds: EXP.kinds }, `${w} expiry`).catch((e) => ["expiry audit threw " + e.message]);
    const caps = await page.evaluate(() => [...document.querySelectorAll("#mkNet .nm-cap")].map((t) => t.textContent.split(" ")[0]));
    eq(caps, ["Sector", "Side", "Name", "Expiry"], `${w}: the fourth caption names the expiry`);
    const exp4 = await page.evaluate(() => window.FlowsUI.netMap.of(document.getElementById("mkNet")).model().layers[3].map((n) => n.label));
    ok(exp4.every((l) => ["0DTE", "1–7 days", "8–31 days", "32+ days", "No expiry"].includes(l)), `${w}: expiry chips are labelled with their bucket: ${exp4.join(", ")}`);
    ok(bad2.every((m) => !/layer 3|sum/.test(m)), `${w}: expiry layer sums to the total`);
    await page.click("#mkNet .nm-seg button[data-mode='lean']");
    await page.click("#mkNet .nm-seg button[data-view='table']");
    const tb = await page.evaluate(() => ({ heads: [...document.querySelectorAll("#mkNet .nm-stage .nm-tbl thead th")].map((t) => t.textContent), rows: [...document.querySelectorAll("#mkNet .nm-stage .nm-tbl tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent)), more: document.querySelector("#mkNet .nm-stage .nm-link") && document.querySelector("#mkNet .nm-stage .nm-link").textContent, sh: document.documentElement.scrollHeight, ih: innerHeight }));
    eq(tb.heads, ["Sector", "Side", "Name", "Lean", "Premium", "Share"], `${w}: THE TABLE TWIN CARRIES THE SAME IDENTIFICATION: sector, side, name, lean, premium, share`);
    ok(tb.rows.length >= 4 && tb.rows.every((r) => r.every((c) => c.length > 0)), `${w}: no empty identification cell`);
    const topPath = EXP.paths[0];
    const [kk, , nm, ln] = topPath[0].split("|");
    eq(tb.rows[0].slice(0, 4).map((c) => c.replace(/ \(\d+\)$/, "")).join("|"), [tb.rows[0][0], KIND[kk], nm, ln].join("|"), `${w}: the first table row is the largest path`);
    ok(tb.more && /Show all \d+/.test(tb.more), `${w}: the table lists the top paths and offers Show all (${tb.more})`);
    ok(tb.sh <= tb.ih + 1, `${w}: the table view does not scroll the page`);
    await page.click("#mkNet .nm-stage .nm-link");
    await page.waitForSelector("#mkNet dialog[open] tbody tr");
    const all = await page.evaluate(() => [...document.querySelectorAll("#mkNet dialog[open] tbody tr")].map((tr) => tr.children[4].textContent));
    ok(all.length > tb.rows.length, `${w}: Show all lists more paths than the table`);
    await page.keyboard.press("Escape");
  }
  eq(errors, [], `${w}: no page error`);
  await context.close();
}

{
  const { context, page, errors } = await open({ viewport: { width: 390, height: 844 }, coarse: true });
  const segs = await page.evaluate(() => [...document.querySelectorAll("#mkNet .nm-layers button")].map((b) => b.textContent));
  eq(segs, ["Sector", "Side", "Name", "Lean"], "390: the four layers are a switch, not a squeeze");
  for (const [i, name] of segs.entries()) {
    await page.click(`#mkNet .nm-layers button:nth-child(${i + 1})`);
    const n = await page.evaluate(() => [...document.querySelectorAll("#mkNet .nm-chip")].map((g) => [g.querySelector(".nm-lb").textContent, g.querySelector(".nm-fg").textContent, g.getBoundingClientRect().left >= 0 && g.getBoundingClientRect().right <= innerWidth]));
    ok(n.length > 0 && n.every((c) => c[0] && c[1] && c[2]), `390: layer ${name} shows every chip with its label and figure inside the screen (${n.length})`);
  }
  await page.click(`#mkNet .nm-layers button:nth-child(3)`);
  await page.click('#mkNet .nm-chip[data-id="n:~"]');
  ok(/Show members/.test(await page.evaluate(() => document.querySelector("#mkNet .nm-read").textContent)), "390: Other names opens its members here too");
  const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, small: [...document.querySelectorAll("#mkNet button")].filter((b) => b.getBoundingClientRect().height && b.getBoundingClientRect().height < 43.5).length, leg: document.querySelector("#mkNet .nm-legend button").textContent }));
  ok(m.sh <= m.ih + 1 && m.sw <= m.iw, "390: no page scroll");
  eq(m.small, 0, "390: every control is 44 px");
  await page.click("#mkNet .nm-legend button");
  await page.waitForSelector("#mkNet dialog[open] .nm-lgl");
  const lg = await page.evaluate(() => document.querySelector("#mkNet dialog[open] .nm-lgl").textContent);
  ok(/Chip base and band colour/.test(lg) && /Band width/.test(lg) && /Dashed chip/.test(lg) && /Figure/.test(lg) && /convention/.test(lg), "390: the legend dialog names every encoding");
  eq(errors, [], "390: no page error");
  await context.close();
}

{
  const cases = [
    [{ alertsStatus: 500 }, /Unavailable/, /HTTP 500/, "a failed read"],
    [{ alerts: { status: "pending", rows: [] } }, /Reading|not published/, /not published/, "a feed the pipeline has not published"],
    [{ alerts: { ...ALERTS, rows: [] } }, /Nothing flagged/, /quiet market/, "an empty read"],
  ];
  for (const [opts, a, b, name] of cases) {
    const { context, page } = await openMarket(browser, opts);
    await page.click("#mkT-network");
    await page.waitForSelector("#mkNet .nm-empty", { timeout: 15000 });
    const said = await page.evaluate(() => document.querySelector("#mkNet .nm-empty").textContent);
    ok(a.test(said) && b.test(said), `${name} says what it is, with its reason: ${said.slice(0, 80)}`);
    ok(await page.evaluate(() => document.querySelectorAll("#mkNet .nm-chip").length === 0), `${name} draws no chip`);
    await context.close();
  }
}

const MUTANTS = [
  ["the bullish range counts unsided premium as bullish", [["band(M.cover.bullLo, M.cover.bullHi)", "band(M.cover.bullLo, 1)"]]],
  ["the sided coverage dropped from the stats line", [[" sided of \" + money(M.flagged) + \" flagged (\" + pct(M.cover.share) + \") \u00b7 lean \"", " flagged \u00b7 lean \""]]],
  ["sector names always abbreviated", [["if (full && ctxW(full, \"600 12px\") <= avail) label = full;", ""]]],
  ["Other chips have no member drill", [["if (r.d.other) readEl.append", "if (false) readEl.append"]]],
  ["the readout drops where the premium goes", [["parts.push(\"to \" + d.to);", ""]]],
  ["the readout drops where it comes from", [["parts.push(\"from \" + d.from);", ""]]],
  ["share printed at twice its value", [["const fig = money(d.v) + \" \\u00b7 \" + pct(d.share);", "const fig = money(d.v) + \" \\u00b7 \" + pct(d.share * 2);"]]],
  ["labels cut to six characters", [["const t = chipText(d, G, nd.w - 18);", "const t = chipText(d, G, nd.w - 18); t.label = t.label.slice(0, 6);"]]],
  ["bands all one width", [["const sw = (e) => Math.max(1.4, e.v * k);", "const sw = (e) => 3;"]]],
  ["the legend loses the band width key", [["h(\"span\", { class: \"nm-lg\" }, h(\"i\", { class: \"nm-sw s-band\"", "h(\"span\", { class: \"nm-lg\", hidden: true }, h(\"i\", { class: \"nm-sw s-band\""]]],
  ["chips overlap", [["const gap = 5;", "const gap = -9;"]]],
  ["the largest name is not selected at rest", [["const defaultSel = () => (M.layers[2][0] ? M.layers[2][0].id : M.layers[0][0] ? M.layers[0][0].id : null);", "const defaultSel = () => (M.layers[2][1] ? M.layers[2][1].id : null);"]]],
  ["the table twin drops the sector", [["[\"Sector\", \"Side\", \"Name\", LAYER[mode][3], \"Premium\", \"Share\"].map((c, i) => h(\"th\"", "[\"Sector\", \"Side\", \"Name\", LAYER[mode][3], \"Premium\", \"Share\"].filter((c) => c !== \"Sector\").map((c, i) => h(\"th\""]]],
];

async function mutantFails(name, edits) {
  const { context, page } = await openMarket(browser, { alerts: ALERTS, patch: { [MAP]: edits } });
  try {
    await page.click("#mkT-network");
    await page.waitForSelector("#mkNet .nm-chip, #mkNet .nm-empty", { timeout: 20000 });
    await page.waitForTimeout(400);
    const bad = await audit(page, EXP, name);
    const read = await page.evaluate(() => document.querySelector("#mkNet .nm-read").textContent);
    const lg = await legendOf(page);
    const hasOther = await page.evaluate(() => !!document.querySelector('#mkNet .nm-chip[data-id="n:~"]'));
    if (hasOther) {
      await page.click('#mkNet .nm-chip[data-id="n:~"]');
      if (!/Show members/.test(await page.evaluate(() => document.querySelector("#mkNet .nm-read").textContent))) bad.push("no drill");
    }
    if (!/Band width/.test(await page.evaluate(() => [...document.querySelectorAll("#mkNet .nm-lg:not([hidden])")].map((e) => e.textContent).join(" ")))) bad.push("legend lost band width");
    await page.click("#mkNet .nm-seg button[data-view='table']");
    const heads = await page.evaluate(() => [...document.querySelectorAll("#mkNet .nm-stage .nm-tbl thead th")].map((t) => t.textContent));
    if (heads.length !== 6) bad.push("table lost a column");
    void lg;
    if (!read.startsWith([...EXP.byName.entries()].sort((a, b) => b[1] - a[1])[0][0])) bad.push("the largest name is not selected at rest");
    return bad.length > 0;
  } finally {
    await context.close();
  }
}
for (const [name, edits] of MUTANTS) ok(await mutantFails(name, edits), `PLANTED WRONG BUILD FAILS THE IDENTIFICATION AUDIT: ${name}`);

near(EXP.flagged, ALERTS.rows.reduce((a, r) => a + r.prem, 0), "the independent flagged total is the sum of the windows' premium");
ok(EXP.total < EXP.flagged, "and the sided total is the part of it with a stated side");
ok(!/\bat (the )?(ask|bid)\b/i.test(SRC), "no vendor term in the module's source");

await browser.close();
console.log(`flows-net-map-render: ${checks} checks, every chip, band and readout of the Market flow network identified against independent sums at 1440, 1024 and 390 px, its table twin and legend, and ${MUTANTS.length} planted wrong builds`);
