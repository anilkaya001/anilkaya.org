import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { networkScene, networkSvg, networkRows, COLOR, esc, money, r1, cubic } from "./approval-scene.mjs";
import { skylineScene, skylineSvg, lollipopSvg, terrainScene, terrainSvg, gridSvg, surfaceScene, surfaceSvg, heatSvg, relationsScene, relationsSvg, pText } from "./approval-worlds.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = path.join(ROOT, "tests/fixtures-approval");
const readJson = (name) => JSON.parse(readFileSync(path.join(FX, name), "utf8"));

export const VIEWPORTS = { "1440": { w: 1440, h: 900, phone: false }, "390": { w: 390, h: 844, phone: true } };

export function loadFixtures() {
  return { placements: readJson("placements.json"), answers: readJson("answers.json"), gates: readJson("gates.json"), superseded: readJson("superseded-frames.json"), world: readJson("world.json"), copy: readJson("copy.json") };
}

const CSS = `:root{--l1:#f5f5f7;--l2:#b4b6c4;--l3:#9a9cad;--sep:rgba(255,255,255,.075);--mat:rgba(24,26,32,.58);--accent:#0a84ff;--ink:#409cff;--up:#30d158;--down:#ff453a;--warn:#ff9f0a;--gold:#ffd60a;--f:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Helvetica Neue",system-ui,sans-serif}
*{box-sizing:border-box}html,body{margin:0}
body{background:#07090e;color:var(--l1);font:14px/1.45 var(--f);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;background:radial-gradient(60% 40% at 70% -10%,rgba(10,132,255,.14),transparent 70%);pointer-events:none}
a{color:inherit}
.app{position:relative;display:grid;grid-template-columns:216px minmax(0,1fr);min-height:100vh}
.phone .app{grid-template-columns:minmax(0,1fr)}
.rail{padding:18px 12px;border-right:1px solid var(--sep);background:rgba(10,12,18,.62)}
.phone .rail{display:none}
.brand{display:flex;align-items:center;gap:10px;padding:0 8px 12px;font-size:17px;font-weight:700}
.brand-mark{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#0a84ff,#5e5ce6);font-size:15px}
.nav-label{padding:12px 8px 3px;color:var(--l3);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.rail nav a{display:block;padding:7px 10px;border-radius:8px;color:var(--l2);text-decoration:none}
.rail nav a[aria-current=page]{background:rgba(255,255,255,.09);color:var(--l1)}
.topbar{display:flex;align-items:center;gap:12px;padding:12px 24px;border-bottom:1px solid var(--sep)}
.phone .topbar{padding:12px 16px}
.topbar .brand{display:none;padding:0}
.phone .topbar .brand{display:flex}
.spacer{flex:1}
.pill{display:inline-flex;align-items:center;gap:7px;min-height:30px;padding:0 12px;border-radius:15px;background:var(--mat);box-shadow:inset 0 0 0 1px rgba(255,255,255,.075);color:var(--l2);font-size:12.5px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--l3)}
.page{padding:22px 24px 48px;max-width:1280px}
.phone .page{padding:16px 16px 24px}
.phone th,.phone td{padding:7px 4px;font-size:12.5px}
.sample{display:inline-block;margin-bottom:8px;padding:2px 9px;border-radius:10px;background:rgba(255,159,10,.14);color:#ffb340;font-size:11.5px;font-weight:600}
h1{margin:0 0 6px;font-size:28px;line-height:1.15;letter-spacing:-.01em}
.phone h1{font-size:24px}
h2{margin:0;font-size:15px;font-weight:600}
.header-sentence{margin:0 0 14px;color:var(--l2);font-size:15px}
.card{margin:0 0 16px;padding:18px 20px;border-radius:14px;background:var(--mat);box-shadow:inset 0 0 0 1px rgba(255,255,255,.075)}
.phone .card{padding:14px 12px}
.card-h{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-bottom:12px}
.card-h .spacer{flex:1 1 auto}
.seg{display:inline-flex;padding:2px;border-radius:9px;background:rgba(255,255,255,.07)}
.seg span{padding:5px 11px;border-radius:7px;color:var(--l2);font-size:12.5px}
.seg span[aria-pressed=true]{background:rgba(255,255,255,.16);color:var(--l1)}
.tag{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 10px;border-radius:12px;background:rgba(255,255,255,.08);color:var(--l2);font-size:12px}
.tag.live{color:#7ee2a0}.tag.amb{color:#9ecbff}
.chip{display:inline-flex;align-items:center;min-height:24px;padding:0 10px;border-radius:12px;background:rgba(255,255,255,.08);color:var(--l1);font-size:12px}
.note{margin:8px 0 0;color:var(--l3);font-size:12.5px;max-width:92ch}
.note b{color:var(--l2);font-weight:600}
.seam{margin:10px 0 0;color:var(--l1);font-size:13.5px;font-weight:500}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-top:10px;color:var(--l2);font-size:12px}
.legend svg{display:block;overflow:visible}
.scene{display:block;border-radius:12px}
.hero{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 22px}
.hero .big{font-size:34px;font-weight:700;letter-spacing:-.02em}
.phone .hero .big{font-size:28px}
.hero .cap{color:var(--l2);font-size:13px}
.up{color:var(--up)}.down{color:var(--down)}.gold{color:var(--gold)}.l2{color:var(--l2)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:7px 8px;border-top:1px solid var(--sep);text-align:left;font-weight:400}
thead th{border-top:0;color:var(--l3);font-size:12px}
th[scope=row]{font-weight:600}
td.num,th.num{text-align:right}
.badge{display:inline-flex;align-items:center;min-height:20px;padding:0 8px;border-radius:10px;font-size:11.5px;font-weight:600}
.badge-alert{background:rgba(255,69,58,.18);color:#ff8a82}
.badge-screen{background:rgba(10,132,255,.2);color:#9ecbff}
.badge-large{background:rgba(255,255,255,.1);color:var(--l2)}
.group{margin:14px 0 4px;color:var(--l3);font-size:11.5px;letter-spacing:.07em;text-transform:uppercase}
.state{margin:0 0 14px;padding:12px 14px;border-radius:12px;background:rgba(255,159,10,.1);box-shadow:inset 0 0 0 1px rgba(255,159,10,.3);color:#ffcf80;font-size:13.5px}
.empty{padding:34px 14px;text-align:center;color:var(--l2);font-size:15px}
.sectors{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.tile{padding:9px 10px;border-radius:10px;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.tile b{display:block;font-size:13px}.tile span{font-size:12.5px}
.tabs{display:flex;gap:6px;margin-bottom:12px}
.tabs span{padding:6px 12px;border-radius:9px;color:var(--l2);font-size:13px}
.tabs span[aria-current=page]{background:rgba(255,255,255,.12);color:var(--l1)}
.cols{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}
.phone .cols{grid-template-columns:minmax(0,1fr)}
details summary{cursor:pointer;color:var(--l2);font-size:13px;padding:6px 0}
.tabbar{display:none}
.phone .tabbar{display:flex;justify-content:space-around;padding:8px 6px 18px;background:rgba(10,12,18,.92);border-top:1px solid var(--sep)}
.tabbar a{padding:4px 6px;color:var(--l2);font-size:11.5px;text-decoration:none}
.tabbar a[aria-current=page]{color:var(--l1)}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.phone .two{grid-template-columns:minmax(0,1fr)}
.caption{margin:0 0 10px;color:var(--l2);font-size:13.5px}
@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
@keyframes flare{from{r:12;opacity:.9}to{r:46;opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

const NAV = [
  ["Today", ["Home", "Watchlist", "Notifications"]],
  ["Live", ["Moves", "Flow"]],
  ["Discover", ["Bullish", "Bearish", "Near the edge", "Events", "Political"]],
  ["", ["Market"]],
  ["Tools", ["Strategy", "Premium desk", "Ask"]],
  ["Record", ["Track", "History", "Status"]],
];
const TABS = ["Home", "Watchlist", "Search", "Flow", "More"];

const rail = (active) => `<aside class="rail"><div class="brand"><span class="brand-mark" aria-hidden="true">ε</span><span>Flows</span></div><nav aria-label="Flows">${NAV.map(([g, items]) => `${g ? `<div class="nav-label">${g}</div>` : ""}${items.map((i) => `<a href="#"${i === active ? ' aria-current="page"' : ""}>${i}</a>`).join("")}`).join("")}</nav></aside>`;
const tabbar = (active) => `<nav class="tabbar" aria-label="Sections">${TABS.map((t) => `<a href="#"${t === active ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>`;

export function pageHtml({ title, placement, state, vp, active, phoneActive, body, head = "" }) {
  const v = VIEWPORTS[vp];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>${head}</head>
<body class="${v.phone ? "phone" : ""}" data-placement="${placement}" data-state="${state}" data-viewport="${vp}"><div class="app">${rail(active)}<div class="main"><header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">ε</span><span>Flows</span></div><span class="spacer"></span><span class="pill"><span class="dot"></span>Sample · not live</span></header><main class="page">${body}</main></div></div>${tabbar(phoneActive || active)}</body></html>`;
}

const seg = (items, active, label) => `<span class="seg" role="group" aria-label="${esc(label)}">${items.map((i) => `<span aria-pressed="${i === active}">${esc(i)}</span>`).join("")}</span>`;
const sample = () => `<span class="sample">Sample data · concept</span>`;

function networkLegend(scene) {
  const r = (v) => (6 + 28 * Math.sqrt(v / scene.vMax)) * (scene.vertical ? 0.5 : 1);
  const circles = [5, 20, 60].filter((v) => v <= scene.vMax * 1.01).map((v) => ({ v, r: r(v) }));
  const bw = (v) => Math.min(42, Math.max(1.25, v * 0.75)) * (scene.vertical ? 0.6 : 1);
  const bands = [2, 10, 40].map((v) => ({ v, w: bw(v) }));
  const sw = circles.reduce((a, c) => a + c.r * 2 + 54, 0);
  const sv = `<svg width="${Math.ceil(sw)}" height="${Math.ceil(Math.max(...circles.map((c) => c.r)) * 2 + 4)}" role="img" aria-label="Sphere scale: area is premium">${(() => { let x = 0; return circles.map((c) => { const cx = x + c.r; x += c.r * 2 + 54; return `<circle cx="${r1(cx)}" cy="${Math.ceil(Math.max(...circles.map((q) => q.r)))}" r="${r1(c.r)}" fill="none" stroke="#9a9cad"/><text x="${r1(cx + c.r + 6)}" y="${Math.ceil(Math.max(...circles.map((q) => q.r))) + 4}" font-size="11.5" fill="#b4b6c4">${money(c.v)}</text>`; }).join(""); })()}</svg>`;
  const bv = `<svg width="${bands.length * 78}" height="46" role="img" aria-label="Band scale: width is premium">${bands.map((b, i) => `<rect x="${i * 78}" y="${r1(23 - b.w / 2)}" width="30" height="${r1(b.w)}" fill="#8aa4d6" fill-opacity="0.6"/><text x="${i * 78 + 36}" y="27" font-size="11.5" fill="#b4b6c4">${money(b.v)}</text>`).join("")}</svg>`;
  return `<div class="legend"><span>Sphere area is premium</span>${sv}<span>Band width is premium</span>${bv}</div>`;
}

function tideStrip(W) {
  const pts = [0, 6, 14, 10, 22, 30, 26, 40, 52, 47, 61, 70, 66, 78, 90];
  const x = (i) => 8 + (i / (pts.length - 1)) * (W - 16), y = (v) => 52 - v * 0.5;
  const d = pts.map((v, i) => (i ? "L" : "M") + r1(x(i)) + " " + r1(y(v))).join("");
  return `<svg class="tide" viewBox="0 0 ${W} 70" width="100%" role="img" aria-label="Market tide over the session; the network holds data from 10:02" xmlns="http://www.w3.org/2000/svg" font-family="Inter,system-ui,sans-serif"><defs><pattern id="h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/></pattern></defs><rect x="8" y="6" width="${r1(x(2) - 8)}" height="48" fill="url(#h)" opacity=".7"/><path d="${d}" fill="none" stroke="#388cf0" stroke-width="2"/><text x="${r1(x(2) + 8)}" y="20" font-size="11.5" fill="#b4b6c4">network data held since 10:02</text><text x="8" y="66" font-size="10.5" fill="#9a9cad">09:30</text><text x="${W - 8}" y="66" text-anchor="end" font-size="10.5" fill="#9a9cad">15:41</text></svg>`;
}

export function homeFrame(fx, vp, state) {
  const v = VIEWPORTS[vp], world = fx.world, copy = fx.copy;
  const compact = v.phone;
  const arrival = state === "arrival", replay = state === "replay";
  const scene = networkScene(world, { compact, pulses: replay, yaw: compact ? 0 : -5, names: 10 });
  const litNode = arrival ? "name:" + world.network.arrival.name : null;
  const lit = litNode ? [litNode, ...scene.bands.filter((b) => b.from === litNode || b.to === litNode).map((b) => b.id)] : null;
  const svg = networkSvg(scene, { lit, flare: litNode, aria: `Flow network of flagged option premium, ${money(scene.total)} across four layers: Side, Sector, Name and Lean. Sphere area and band width are premium in dollars.` });
  const rows = networkRows(world, { names: 10 });
  const tableRows = [...rows.keep, rows.other].map((n) => `<tr><th scope="row">${esc(n.label)}</th>${compact ? "" : `<td class="num">${money(n.calls)}</td><td class="num">${money(n.puts)}</td>`}<td class="num">${money(n.bull)}</td><td class="num">${money(n.bear)}</td><td class="num">${money(n.unsided)}</td><td class="num">${money(n.total)}</td></tr>`).join("");
  const a = world.network.arrival;
  const mu = rows.keep.find((n) => n.id === a.name);
  const arrivalNote = arrival && mu ? `<p class="state" role="status">${a.name}: a flagged window of ${money(a.premium)} calls arrived at ${a.at} ET. Its neighbourhood is lit: the bands entering ${a.name} from Tech (${money(mu.total)}) and the bands leaving it for Bullish ${money(mu.bull)}, Bearish ${money(mu.bear)} and Unsided ${money(mu.unsided)}. They are two splits of the same dollars; no single dollar is traced through.</p>` : "";
  const tag = replay ? `<span class="tag amb">ambient</span>` : `<span class="tag live">Live</span>`;
  const replayLine = replay ? `<p class="note"><b>replay of ${world.network.replayOf}, flagged windows; ambient motion, not data.</b> The session is closed; the scene replays the last session's flagged windows at 60x.</p>` : "";
  const body = `${sample()}<h1>Home</h1>
<section class="card" aria-label="Market tide"><div class="hero"><span class="big up">+$412M</span><span class="cap">Market tide: net call premium minus net put premium, vendor market tide, read 15:41:07 ET</span></div></section>
<section class="card" aria-labelledby="nh"><div class="card-h"><h2 id="nh">Flow network</h2>${tag}<span class="spacer"></span>${seg(["All sided premium", "Flagged"], "All sided premium", "Data")} ${compact ? "" : seg(["Session", "Since you opened", "Last 30 min"], "Session", "Window")}</div>
${replayLine}${arrivalNote}
${svg}
${networkLegend(scene)}
<p class="seam">${esc(copy.seam)}</p>
<p class="note">${esc(copy.askSide)}</p>
<p class="note">${esc(copy.motion.live)} ${esc(copy.motion.ambient)}</p>
${compact ? `<p class="note"><span class="chip">3D</span> The 2D twin is the default on a phone; the 3D scene is one tap away.</p>` : ""}
${tideStrip(compact ? 316 : 1096)}
<details open><summary>Per-name table, in the order of the Name layer</summary><table aria-label="Premium by name"><thead><tr><th>Name</th>${compact ? "" : '<th class="num">Calls</th><th class="num">Puts</th>'}<th class="num">Bullish</th><th class="num">Bearish</th><th class="num">Unsided</th><th class="num">Total</th></tr></thead><tbody>${tableRows}</tbody></table></details></section>`;
  return { html: pageHtml({ title: `Flows concept: Home network, ${state}, ${vp}`, placement: "p1", state, vp, active: "Home", body }), scene, labels: scene.labels, solids: scene.nodes.map((n) => ({ id: n.id, circle: { x: n.x, y: n.y, r: n.r } })) };
}

const alertCountLine = (copy, n) => copy.canonical.alertCount.replace("{n}", String(n)).replace("{alerts}", n === 1 ? "alert" : "alerts");

export function movesFrame(fx, vp, state) {
  const v = VIEWPORTS[vp], world = fx.world, copy = fx.copy.canonical;
  const rows = world.moves.rows;
  const demoted = state === "paused" ? rows.filter((r) => r.state === "alert" && r.t === "SMCI").map((r) => ({ ...r, state: "screen" })) : [];
  const alerts = state === "empty" ? [] : rows.filter((r) => r.state === "alert" && !demoted.some((d) => d.t === r.t));
  const screens = state === "empty" ? [] : [...demoted, ...rows.filter((r) => r.state === "screen")];
  const large = state === "empty" ? [] : rows.filter((r) => r.state === "large");
  const none = state === "empty" ? [] : rows.filter((r) => r.state === "none");
  const sg = (x) => (x.chg >= 0 ? "▲ +" : "▼ −") + Math.abs(x.chg).toFixed(1) + "%";
  const row = (r, badge) => `<tr data-state="${r.state}"><th scope="row">${esc(r.t)}</th><td class="${r.chg >= 0 ? "up" : "down"}">${sg(r)}</td>${v.phone ? "" : `<td class="num">${r.zT >= 0 ? "+" : "−"}${Math.abs(r.zT).toFixed(1)}</td><td>${esc(r.p || "—")}</td><td>${esc(r.flow)}</td>`}<td>${badge}</td>${v.phone ? "" : `<td class="l2">${esc(r.why)}</td>`}</tr>`;
  const head = v.phone ? "<tr><th>Name</th><th>Move</th><th>Status</th></tr>" : "<tr><th>Name</th><th>Move</th><th class=\"num\">Rarity</th><th>Scan p</th><th>Flow</th><th>Status</th><th>Context</th></tr>";
  const grp = (label, list, badge) => (list.length ? `<tr><td colspan="${v.phone ? 3 : 7}" class="group">${esc(label)}</td></tr>${list.map((r) => row(r, badge)).join("")}` : "");
  const list = state === "empty"
    ? `<p class="empty" role="status">${esc(copy.empty)}</p>`
    : `<table aria-label="Names ranked by rarity against their own norm"><thead>${head}</thead><tbody>${grp("Alerts, in the order they fired", alerts, `<span class="badge badge-alert">${esc(copy.alertBadge)}</span>`)}${grp("Screen", screens, `<span class="badge badge-screen">${esc(copy.screenBadge)}</span>`)}${grp("Large, not tested", large, `<span class="badge badge-large">Large</span>`)}${grp("Not tested, with the reason", none, `<span class="badge badge-large">Not tested</span>`)}</tbody></table>`;
  const sectors = world.moves.sectors.map(([t, name, c]) => `<div class="tile"><b>${t}</b><span class="${c >= 0 ? "up" : "down"}">${c >= 0 ? "▲ +" : "▼ −"}${Math.abs(c).toFixed(2)}%</span><br><span class="l2">${esc(name)}</span></div>`).join("");
  const body = `${sample()}<h1>Moves</h1>
<p class="header-sentence">${esc(copy.header)}</p>
${state === "paused" ? `<p class="state" role="status">${esc(copy.paused)}</p>` : ""}
<p class="note" style="margin:0 0 14px"><b>${esc(alertCountLine(fx.copy, alerts.length))}</b></p>
<div class="card-h">${seg(["Own", "Total"], "Own", "Yardstick")} ${seg(["Implied SDs", "Repricing"], "Implied SDs", "Unit")}<span class="spacer"></span><span class="chip">How it's tested</span></div>
<section class="card" aria-labelledby="nl"><div class="card-h"><h2 id="nl">Now</h2><span class="tag">Sorted by rarity</span></div>${list}</section>
<section class="card" aria-labelledby="sc"><div class="card-h"><h2 id="sc">Sectors</h2></div><div class="sectors">${sectors}</div></section>
<p class="note">Gate preview: the words Screen and Alert (provisional) are shown as they will read once their gates hold. Before then the page ranks names and says no error rate has been measured.</p>`;
  return { html: pageHtml({ title: `Flows concept: Moves, ${state}, ${vp}`, placement: "p2", state, vp, active: "Moves", body }) };
}

export function skylineFrame(fx, vp) {
  const v = VIEWPORTS[vp], world = fx.world;
  let fig, draw = {};
  if (v.phone) fig = lollipopSvg(world, { aria: "Names ranked by rarity with the selection line" });
  else {
    const sc = skylineScene(world, { w: 1124, h: 560, cx: 430 });
    fig = skylineSvg(sc, { aria: "Move skyline: prism height is rarity, tile colour is direction, the gold plane is the selection line" });
    draw = { labels: sc.labels, solids: sc.solids, bounds: { w: sc.W, h: sc.H }, scene: sc };
  }
  const callers = world.skyline.rows.filter((r) => r.h >= world.skyline.hStar);
  const body = `${sample()}<h1>Moves</h1>
<div class="tabs" role="group" aria-label="View"><span>Now</span><span aria-current="page">Skyline</span><span>Map</span></div>
<p class="header-sentence">Height is rarity; floor colour is direction.</p>
<section class="card" aria-labelledby="sk"><div class="card-h"><h2 id="sk">${v.phone ? "Sorted by rarity" : "Move skyline"}</h2><span class="tag">${v.phone ? "2D list" : "3D, desktop only"}</span></div>
${fig}
<p class="note">${v.phone ? "On a phone the 2D sorted list with the selection line stands in; the 3D skyline is desktop only." : "Height is rarity in decades of the scan p, solid down to the deepest audited p and hatched beyond it as extrapolated. The floor is the Map's tiles coloured by direction: ▲ up, ▼ down. The gold plane is the selection line; names above it are called out in the margin, never labelled on the prisms."}</p>
<table aria-label="Names above the selection line"><thead><tr><th>Name</th><th>Move</th><th>Rarity</th></tr></thead><tbody>${callers.map((r) => `<tr><th scope="row">${r.t}</th><td class="${r.dir > 0 ? "up" : "down"}">${r.dir > 0 ? "▲ +" : "▼ −"}${Math.abs(r.chg).toFixed(1)}%</td><td>${pText(r.h)}</td></tr>`).join("")}</tbody></table></section>`;
  return { html: pageHtml({ title: `Flows concept: Moves skyline, ${vp}`, placement: "p3", state: "default", vp, active: "Moves", body }), ...draw };
}

export function terrainFrame(fx, vp) {
  const v = VIEWPORTS[vp], world = fx.world, tr = world.terrain, conv = fx.copy.convention;
  const sc = terrainScene(world, {});
  const fig = v.phone ? gridSvg(sc, { aria: "Dealer gamma by strike and expiry" }) : terrainSvg(sc, { aria: "Dealer gamma terrain by strike and expiry, on the vendor's convention" });
  const body = `${sample()}<h1>${tr.underlying} terrain</h1>
<div class="tabs" role="group" aria-label="Mode"><span>Overview</span><span>Move</span><span aria-current="page">Terrain</span><span>Surface</span></div>
<div class="card-h"><span class="tag">Gamma ${esc(conv)}</span><span class="tag">Book: open interest as of ${esc(tr.bookAsOf)}</span><span class="tag">Spot: ${tr.underlying} ${tr.spot.toFixed(2)} as of ${esc(tr.spotStamp)}</span></div>
<section class="card" aria-labelledby="tt"><div class="card-h"><h2 id="tt">Dealer gamma, dollars per 1% move</h2><span class="spacer"></span>${seg(["Book", "Traded", "Flow"], "Book", "Layer")}</div>
${fig}
<p class="note">${v.phone ? "On a phone the 2D grid stands in: strike across, expiry down." : "Strike (log-moneyness) across, expiry down the depth at the square root of time. Blue is positive dealer gamma and orange negative, " + esc(conv) + ". The bold white line is the zero-gamma strike of each expiry; contours are solid above zero and dashed below. The gold line on the back wall is the book summed over expiries, with its flip. The spot plane carries its own vendor stamp."}</p></section>`;
  return { html: pageHtml({ title: `Flows concept: terrain, ${vp}`, placement: "p4", state: "default", vp, active: "", body }) };
}

export function surfaceFrame(fx, vp) {
  const v = VIEWPORTS[vp], world = fx.world;
  const sc = surfaceScene(world, {});
  const fig = v.phone ? heatSvg(sc, { aria: "Implied volatility by strike and tenor" }) : surfaceSvg(sc, { aria: "Implied volatility surface on the eSSVI contract" });
  const body = `${sample()}<h1>${world.surface.underlying} surface</h1>
<div class="tabs" role="group" aria-label="Mode"><span>Overview</span><span>Move</span><span>Terrain</span><span aria-current="page">Surface</span></div>
<div class="card-h"><span class="tag">eSSVI fit</span><span class="tag">Fitted, not quoted</span></div>
<section class="card" aria-labelledby="st"><div class="card-h"><h2 id="st">Implied volatility by strike and expiry</h2><span class="spacer"></span>${seg(["k / ∜theta", "ln(K/F)"], "k / ∜theta", "Axis")}</div>
${fig}
<p class="note">${v.phone ? "On a phone the heatmap view stands in." : "The mesh is evaluated from the fitted slices. Outside each slice's quoted range the surface is translucent and hatched: extrapolated, shape assumed. Dots are quotes with bid-ask IV whiskers, red when the mid lies outside its spread. The dotted ridge is the earnings step; the ring marks a seam where the calendar audit fails."}</p></section>`;
  return { html: pageHtml({ title: `Flows concept: surface, ${vp}`, placement: "p5", state: "default", vp, active: "", body }) };
}

export function relationsFrame(fx, vp, state) {
  const v = VIEWPORTS[vp], world = fx.world;
  const empty = state === "empty";
  const sc = relationsScene(world, v.phone ? { w: 358, h: 420, compact: true, empty } : { w: 1124, h: 560, empty });
  const fig = relationsSvg(sc, { compact: v.phone, aria: "Names on a ring by sector with tested edges" });
  const edges = empty ? [] : sc.edges;
  const body = `${sample()}<h1>Relations</h1>
<div class="card-h"><span class="tag">Names moved together beyond the market</span></div>
<section class="card" aria-labelledby="rt"><div class="card-h"><h2 id="rt">Tested edges, one layer at a time</h2><span class="spacer"></span>${seg(["Moved together", "Partial correlation", "Flow followed flow"], "Moved together", "Layer")}</div>
${fig}
<p class="note">${empty ? "Nothing passed its test this week, so nothing is drawn." : "Each edge is drawn only if it passed its test; its label is the date-block bootstrap stability, and opacity has three steps (0.9 and above, 0.7 to 0.9, 0.5 to 0.7; below 0.5 is not drawn). Co-occurrence, not cause. Flow followed by flow is owner only and off by default."}</p>
${edges.length ? `<table aria-label="Tested edges"><thead><tr><th>Edge</th><th class="num">Stability</th></tr></thead><tbody>${edges.map((e) => `<tr><th scope="row">${e.a} and ${e.b}</th><td class="num">${e.stab.toFixed(2)}</td></tr>`).join("")}</tbody></table>` : ""}</section>`;
  return { html: pageHtml({ title: `Flows concept: relations, ${state}, ${vp}`, placement: "p6", state, vp, active: "Market", body }) };
}

export function buildFrames(fx) {
  const frames = [];
  for (const p of fx.placements.placements) {
    for (const vpSpec of p.viewports) {
      const vp = vpSpec.split("x")[0];
      for (const state of p.states) {
        const f = p.id === "p1" ? homeFrame(fx, vp, state) : p.id === "p2" ? movesFrame(fx, vp, state) : p.id === "p3" ? skylineFrame(fx, vp) : p.id === "p4" ? terrainFrame(fx, vp) : p.id === "p5" ? surfaceFrame(fx, vp) : relationsFrame(fx, vp, state);
        frames.push({ id: `${p.id}-${p.slug}-${state}-${vp}`, placement: p.id, state, vp, ...f });
      }
    }
  }
  return frames;
}

const sceneSource = readFileSync(path.join(ROOT, "scripts/approval-scene.mjs"), "utf8").replace(/^export /gm, "");

export function captureHtml(fx) {
  const copy = fx.copy;
  const world = fx.world;
  const style = `${CSS}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.pane h2{margin:0 0 8px}
.pane .scene{width:100%}
.say{margin:10px 0 0;color:var(--l1);font-size:14px;max-width:110ch}
#clock{position:fixed;right:14px;bottom:10px;color:var(--l3);font-size:12px}`;
  const script = `${sceneSource}
const WORLD = ${JSON.stringify({ network: world.network })};
const arrivals = [["name:MU", 4], ["name:NVDA", 11], ["name:AMZN", 17]];
const ambientHost = document.getElementById("ambient"), liveHost = document.getElementById("live");
let frozen = null;
function sceneAt(t, ambient) {
  const sway = ambient ? 8 * Math.sin(2 * Math.PI * t / 40) : 0;
  return networkScene(WORLD, { pulses: ambient, yaw: -5 + sway });
}
function pulsesSvg(sc, t) {
  const out = [];
  for (const p of sc.pulses) {
    const b = sc.bands[p.band];
    const u = (p.phase + t / p.period) % 1;
    const a = Math.min(u, 1 - (p.to - p.from));
    const seg = [];
    for (let i = 0; i <= 6; i++) seg.push(cubic(b.p0, b.c1, b.c2, b.p1, a + (p.to - p.from) * i / 6).map((x) => Math.round(x * 10) / 10));
    out.push('<polyline points="' + seg.map((q) => q.join(",")).join(" ") + '" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="2.4" stroke-linecap="round"/>');
  }
  return '<g class="pulses" filter="url(#glow)">' + out.join("") + "</g>";
}
function paint(t) {
  const amb = sceneAt(t, true);
  const svg = networkSvg(amb, { aria: "Ambient network", noPulses: true }).replace('<g class="nodes">', pulsesSvg(amb, t) + '<g class="nodes">');
  ambientHost.innerHTML = svg;
  const live = sceneAt(t, false);
  let lit = null, flare = null;
  for (const [id, at] of arrivals) if (t >= at && t < at + 1.5) { flare = id; lit = [id].concat(live.bands.filter((b) => b.from === id || b.to === id).map((b) => b.id)); }
  liveHost.innerHTML = networkSvg(live, { lit, flare, aria: "Live network" });
  document.getElementById("clock").textContent = "t = " + t.toFixed(1) + " s";
}
window.__paint = paint;
const t0 = performance.now();
function loop() { if (frozen === null) paint(((performance.now() - t0) / 1000) % 20); requestAnimationFrame(loop); }
window.__freeze = (t) => { frozen = t; paint(t); };
if (new URLSearchParams(location.search).has("t")) window.__freeze(Number(new URLSearchParams(location.search).get("t")));
else loop();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Flows concept: Home network, Live and Ambient side by side</title><style>${style}</style></head>
<body><main class="page" style="max-width:1440px"><span class="sample">Sample data · concept</span><h1>The Home network: Live and Ambient, side by side</h1>
<p class="header-sentence">The same sample session. Left: Live. Right: Ambient.</p>
<div class="pair"><section class="card pane"><div class="card-h"><h2>Live</h2><span class="tag live">members' default</span></div><div id="live"></div></section><section class="card pane"><div class="card-h"><h2>Ambient</h2><span class="tag amb">ambient</span></div><div id="ambient"></div></section></div>
<p class="say"><b>${esc(copy.motion.live)}</b> <b>${esc(copy.motion.ambient)}</b></p>
<p class="note">Live stays still until a window arrives (here at 4 s, 11 s and 17 s); the arrival flares its name and lights the bands entering and leaving it. Ambient carries pulses along every band, spheres breathing in their rank phase and a sway of eight degrees over forty seconds, and says what it is. Reduced motion stops both.</p>
<p id="clock"></p></main><script>${script}</script></body></html>`;
}

export function indexHtml(fx, frames) {
  const ans = fx.answers.recorded;
  const sections = fx.placements.placements.map((p) => {
    const mine = frames.filter((f) => f.placement === p.id);
    return `<section class="card" id="${p.id}"><div class="card-h"><h2>${p.n}. ${esc(p.title)}</h2><span class="tag">${esc(p.for)}</span></div>
<p class="caption">${esc(p.purpose)}</p><p class="note"><b>Use test.</b> ${esc(p.useTest)}</p>
<div class="two">${mine.map((f) => `<figure style="margin:0"><img src="${f.id}.png" alt="${esc(p.title)}, ${f.state}, ${f.vp} px" style="width:100%;border-radius:10px"><figcaption class="note">${f.state}, ${f.vp} px wide</figcaption></figure>`).join("")}</div>
<form class="card-h" data-answer="${p.id}" style="margin-top:12px"><span class="chip">Answer ${p.n}</span><label><input type="radio" name="a${p.n}" value="yes"> Yes</label><label><input type="radio" name="a${p.n}" value="changes"> Changes</label><input type="text" name="n${p.n}" placeholder="the changes, as a list" aria-label="Changes to placement ${p.n}" style="min-width:260px"><span class="note" style="margin:0">Recorded: ${ans[p.id] === null ? "no answer yet; the rows it releases stay gated" : esc(JSON.stringify(ans[p.id]))}</span></form></section>`;
  }).join("");
  const sup = fx.superseded.frames.map((n) => `<li><code>${esc(n)}</code></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Flows approval pack</title><style>${CSS}</style></head><body><div class="app" style="grid-template-columns:1fr"><main class="page" style="max-width:1280px"><span class="sample">Sample data · concept</span><h1>Approval pack: six placements</h1>
<p class="header-sentence">Re-rendered from the 2026-10-05 19:20 direction. Answer each placement: yes, or a list of changes.</p>
<section class="card"><div class="card-h"><h2>The Home network in motion</h2></div><p class="caption">${esc(fx.copy.motion.live)} ${esc(fx.copy.motion.ambient)}</p><video src="capture-live-ambient.webm" controls muted loop style="width:100%;border-radius:10px"></video><p class="note"><a href="capture-live-ambient.html">The capture page</a>, ${esc(fx.answers.motion.decision)}: until you answer, your account loads Live and Ambient together and members load Live.</p></section>
${sections}
<section class="card" id="superseded"><div class="card-h"><h2>Superseded frames</h2></div><p class="caption">These ${fx.superseded.frames.length} frames predate the 19:20 direction and show what it rejected. They are not what is asked of you.</p><ul class="note" style="columns:2">${sup}</ul></section></main></div></body></html>`;
}

export async function renderApproval({ out, chromium, capture = false, log = () => {} }) {
  const fx = loadFixtures();
  mkdirSync(out, { recursive: true });
  const frames = buildFrames(fx);
  const browser = await chromium.launch();
  const info = [];
  try {
    for (const f of frames) {
      const v = VIEWPORTS[f.vp];
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      await page.setContent(f.html);
      await page.screenshot({ path: path.join(out, f.id + ".png"), fullPage: true });
      writeFileSync(path.join(out, f.id + ".html"), f.html);
      info.push({ id: f.id, errors: errs });
      log(f.id);
      await ctx.close();
    }
    writeFileSync(path.join(out, "capture-live-ambient.html"), captureHtml(fx));
    if (capture) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
      const page = await ctx.newPage();
      await page.goto("file://" + path.join(out, "capture-live-ambient.html"));
      await page.waitForTimeout(20500);
      const video = page.video();
      await ctx.close();
      await video.saveAs(path.join(out, "capture-live-ambient.webm"));
      log("capture-live-ambient.webm");
    }
    writeFileSync(path.join(out, "index.html"), indexHtml(fx, frames));
  } finally {
    await browser.close();
  }
  return { frames, info };
}
