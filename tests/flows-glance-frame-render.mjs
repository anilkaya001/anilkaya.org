import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import * as F from "./dossier-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };
const SHOTS = process.env.GLANCE_SHOTS || "";

const card = F.card(F.T);
const T = card.ticker;
const AT = "2026-10-02T14:30:00.000Z";
const MINUS = String.fromCharCode(0x2212);
const SRC_JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
const SRC_CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-ticker.css"), "utf8");
const PAGE_HTML = FLOWS_PAGES.tickerPage({ username: "test", scenes: true });
const cite = (id, label, display, o = {}) => ({ id, label, display, asOf: "2026-10-02T14:24:00.000Z", kind: id.split(".")[0], grade: 3, ...o });

const READ = {
  version: 1, status: "ready", ticker: T, generated: true, label: "Model wording", model: "@cf/zai-org/glm-4.7-flash", modelName: "Glm 4.7 Flash", neurons: 56, tokens: { in: 5400, out: 700 },
  provenance: "Model wording by Glm 4.7 Flash. It cost 56 neurons.", note: null, why: null, fingerprint: "d1.abc", asOf: AT, session: "2026-10-01", generatedAt: "2026-10-02T14:31:00.000Z",
  coverage: { ok: 9, partial: 2, withheld: 0, pending: 1 }, tags: [],
  sections: {
    identity: null,
    now: { text: "Dealers are holding the name near $127, and option flow leans bullish into the report.", cites: [cite("price.last", "Last price", "$127.40")] },
    drivers: [
      { text: "Dealers are long gamma, +$854M per 1% move, so their hedging damps moves.", cites: [cite("options.gex", "Gamma book", "+$854M per 1%"), cite("options.hedge", "Hedging", MINUS + "$1.11B", { asOf: "2026-10-02T00:10:00.000Z" })] },
      { text: "Below the $124 flip the book turns short gamma and the pinned read breaks.", cites: [cite("options.flip", "Flip", "124.00")] },
    ],
    tensions: [{ text: "Analysts lean buy while insiders sold.", cites: [cite("analysts.buy", "Analysts", "64% buy"), cite("insiders.net", "Insiders", MINUS + "$92.9M")] }],
    unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about revenue.", missing: ["fundamentals"] }],
    watch: [{ text: "Report Nov 2 after the close.", cites: [cite("events.next", "Report", "Nov 2")] }],
  },
  refused: [],
};
const CITES = 7;
const ONE_SIDED = clone(READ);
ONE_SIDED.sections.tensions = [{ text: "Flow leans to puts while price is stretched.", cites: [cite("flow.lean", "Lean", MINUS + "0.47")] }];
const FALLBACK = { ...clone(READ), status: "fallback", generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, why: "cooldown", provenance: "Deterministic reading." };
const GENERATING = { ...clone(FALLBACK), status: "generating", why: "generating" };
const BOXED = { version: 1, status: "generating", ticker: T, generated: false, provenance: "The dossier is being assembled.", note: "The dossier for " + T + " is still being assembled.", why: "assembling", asOf: null, coverage: { ok: 0, partial: 0, withheld: 0, pending: 0 }, tags: [], sections: { identity: null, now: null, drivers: [], tensions: [], unknown: [], watch: [] }, refused: [] };
const ABSENT = { ...clone(BOXED), status: "absent", why: "nothing", note: "Nothing is held for " + T + " that a reading can be written from.", asOf: AT, sections: { identity: null, now: null, drivers: [], tensions: [], unknown: [{ text: "Headlines are pending.", missing: ["news"] }], watch: [] } };
const UNAVAILABLE = { ...clone(ABSENT), status: "unavailable", why: "store", note: "The reading could not be read." };
const HOSTILE = clone(READ);
HOSTILE.sections.now = { text: "Price <img src=x onerror=\"window.__pwned=1\"> <script>window.__pwned=2</script> **bold**", cites: [cite("price.last", "<b>Last</b>", "<img src=x onerror=\"window.__pwned=3\">")] };

const STUB = `(() => {
  const UI = window.FlowsUI;
  window.__glance = { mounts: [], ranges: [], destroyed: 0 };
  const mount = (card, hosts, opts) => {
    window.__glance.mounts.push({ ticker: card.ticker, keys: Object.keys(opts).sort().join(), range: opts.range, hasReading: !!opts.reading, hosts: Object.keys(hosts).sort().join() });
    hosts.chart.textContent = "chart";
    for (let i = 0; i < 6; i++) { const c = document.createElement("section"); c.className = "ui-card"; c.dataset.claims = "1 3"; c.textContent = "card " + i; hosts.cards.append(c); }
    return { setRange(r) { window.__glance.ranges.push(r); }, update(n) { (window.__glance.updates = window.__glance.updates || []).push({ keys: Object.keys(n).sort().join(), claims: (n.claims || []).map((c) => c.id).join() }); }, destroy() { window.__glance.destroyed++; } };
  };
  window.FlowsUI = Object.freeze({ ...UI, tickerGlance: Object.freeze({ mount }) });
  document.addEventListener("ft:focus", (e) => { (window.__focus = window.__focus || []).push(e.detail); });
})();`;
const LAB_STUB = `(() => { window.__labLoaded = (window.__labLoaded || 0) + 1; window.FlowsUI = Object.freeze({ ...window.FlowsUI, moveLab: Object.freeze({ mount(h) { h.dataset.mounted = "1"; } }) }); })();`;

const counts = { lab: 0 };

async function mount(page, read, o = {}) {
  counts.lab = 0;
  const queue = (o.queue || []).slice();
  const neuron = { status: "ok", scope: T, summary: "Pinned near $127, flow leaning bullish into the report.", ideas: [], tier: "priced", code: null, why: null, ...(o.neuron || {}), read };
  const api = {
    card: o.card || card, summary: neuron, "card-x": { status: "pending" }, hist: { status: "pending" }, tape: { status: "pending" }, meta: { status: "pending" }, events: { status: "pending", rows: [] },
    now: { serverNow: Date.parse(card.generatedAt || "2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card.sessionDate, trading: false, endsAt: null }, keys: {} },
  };
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/assets/js/flows-ticker-glance.js") return route.fulfill({ contentType: "text/javascript", body: o.noGlance ? "" : STUB });
    if (u.pathname === "/assets/js/flows-ticker-movelab.js") { counts.lab++; return route.fulfill({ contentType: "text/javascript", body: LAB_STUB }); }
    if (u.pathname === "/assets/js/flows-ticker.js" && o.js) return route.fulfill({ contentType: "text/javascript", body: o.js(SRC_JS) });
    if (u.pathname === "/assets/css/flows-ticker.css" && o.css) return route.fulfill({ contentType: "text/css", body: o.css(SRC_CSS) });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      const next = key === "summary" && queue.length ? queue.shift() : null;
      const body = next ? { ...neuron, read: next } : key === "board" ? { status: "pending", rows: [] } : api[key] === undefined ? { status: "pending" } : api[key];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.goto("https://example.test/flows/ticker/?t=" + encodeURIComponent(T));
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name\u2026"; }, null, { timeout: 15000 });
  await page.waitForTimeout(250);
}

const visibleText = (sel) => (page) => page.evaluate((s) => { const c = document.querySelector(s).cloneNode(true); c.querySelectorAll(".visually-hidden").forEach((n) => n.remove()); return c.textContent.replace(/\s+/g, " ").trim(); }, sel);
const railText = visibleText("#ftReadRail");
const frameText = visibleText("#ftGlance");

async function scenario(page) {
  const r = {};
  const vp = page.viewportSize();
  const geo = await page.evaluate(() => {
    const b = (s) => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, height: x.height, left: x.left, right: x.right }; };
    const rail = document.getElementById("ftReadRail");
    return { strip: b("#ftStrip"), main: b("#ftGMain"), chart: b("#ftGlanceChart"), rail: b("#ftReadRail"), cards: b("#ftGlanceCards"), dock: b("#ftDock"), hero: b("#ftHero"), railFits: rail.scrollHeight <= rail.clientHeight + 1, sy: scrollY, scrollW: document.documentElement.scrollWidth };
  });
  r.geoFits = !!geo.strip && !!geo.dock && [geo.hero, geo.strip, geo.main, geo.cards, geo.dock].every((x) => x && x.bottom <= vp.height + 0.5 && x.top >= 0) && geo.sy === 0;
  r.railFits = geo.railFits;
  r.chartLeftOfRail = geo.chart.right <= geo.rail.left + 0.5 && Math.abs(geo.chart.top - geo.rail.top) < 60;
  r.noOverflow = geo.scrollW <= vp.width;

  const claims = await page.$$eval("#ftReadRail .ft-claim", (bs) => bs.map((b) => b.dataset.claim));
  r.claimIds = claims.join(",") === "1,2,3,4";
  await page.evaluate(() => { window.__focus = []; });
  await page.hover('#ftReadRail .ft-claim[data-claim="3"]');
  await page.waitForTimeout(80);
  const hov = await page.evaluate(() => ({ log: window.__focus.slice(), foot: document.querySelector(".ft-foot-cs") ? document.querySelector(".ft-foot-cs").dataset.claim : null, text: document.querySelector(".ft-foot").textContent, on: [...document.querySelectorAll(".ft-claim.is-on")].map((b) => b.dataset.claim), focus: document.getElementById("ftReadRail").dataset.focus }));
  r.hoverEmits = hov.log.length === 1 && hov.log[0].id === "3" && hov.log[0].source === "claim";
  r.footSwaps = hov.foot === "3" && /Flip/.test(hov.text) && /124\.00/.test(hov.text) && hov.on.join() === "3" && hov.focus === "3";
  await page.mouse.move(5, 400);
  await page.waitForTimeout(80);
  const left = await page.evaluate(() => ({ log: window.__focus.slice(), cs: !!document.querySelector(".ft-foot-cs"), text: document.querySelector(".ft-foot").textContent, focus: document.getElementById("ftReadRail").dataset.focus }));
  r.leaveEmitsNull = left.log.length === 2 && left.log[1].id === null;
  r.footReverts = !left.cs && /sources/.test(left.text) && left.focus === "";
  await page.evaluate(() => { window.__focus = []; document.querySelector('#ftReadRail .ft-claim[data-claim="2"]').focus(); });
  await page.waitForTimeout(60);
  const foc = await page.evaluate(() => ({ log: window.__focus.slice(), foot: document.querySelector(".ft-foot-cs") && document.querySelector(".ft-foot-cs").dataset.claim }));
  r.focusEmits = foc.log.length >= 1 && foc.log[0].id === "2" && foc.foot === "2";
  await page.evaluate(() => document.activeElement.blur());
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: "1", source: "mark" } })));
  const ext = await page.evaluate(() => ({ foot: document.querySelector(".ft-foot-cs") && document.querySelector(".ft-foot-cs").dataset.claim, on: [...document.querySelectorAll(".ft-claim.is-on")].map((b) => b.dataset.claim).join() }));
  r.markDrivesRail = ext.foot === "1" && ext.on === "1";
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: null, source: "mark" } })));

  await page.click("#ftAllCites");
  const pop = await page.evaluate(() => { const p = document.querySelector(".ft-pop"); return p ? { n: p.querySelectorAll("li").length, text: p.textContent, role: p.getAttribute("role"), times: [...p.querySelectorAll("li i")].map((i) => i.textContent) } : null; });
  r.allCitesPop = !!pop && pop.n === CITES && pop.times.every((t) => /^\d\d:\d\d TRT$/.test(t)) && /options\.gex/.test(pop.text) && /\+\$854M per 1%/.test(pop.text);
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => ({ pop: !!document.querySelector(".ft-pop"), foc: document.activeElement && document.activeElement.id }));
  r.popEsc = !closed.pop && closed.foc === "ftAllCites";
  await page.click("#ftUnknown");
  const unk = await page.evaluate(() => { const p = document.querySelector(".ft-pop"); return p ? p.textContent : ""; });
  r.unknownPop = /Fundamentals are withheld/.test(unk) && /fundamentals/.test(unk);
  await page.keyboard.press("Escape");

  const rt = await railText(page), ft = await frameText(page);
  r.noModelInRail = !/Glm|glm|neurons|56|@cf/.test(rt);
  r.noAgreeWording = !/\b(agree|agrees|agreed|against|unknown)\b/i.test(ft) && !/\d+ of \d+ packets/.test(ft);
  r.noBar = (await page.$$eval("#ftStrip *", (n) => n.filter((e) => /cov|bar|segment/i.test(String(e.className)) || e.getAttribute("role") === "img" || e.getAttribute("role") === "meter" || e.tagName === "PROGRESS" || e.tagName === "METER").length)) === 0;
  r.stripParts = await page.evaluate(() => { const s = document.getElementById("ftStrip"); return !!s.querySelector(".ft-neuron") && /Neuron/.test(s.querySelector(".ft-strip-k").textContent) && /Pinned near/.test(s.querySelector(".ft-strip-line").textContent) && /Engine/.test(s.querySelector(".ft-eng").textContent) && s.children.length === 3; });
  r.oneLine = await page.evaluate(() => { const l = document.querySelector(".ft-strip-line"); return l.getBoundingClientRect().height < 24 && getComputedStyle(l).textOverflow === "ellipsis"; });

  const dockBtns = await page.$$eval("#ftDock .ft-dock-b", (b) => b.map((x) => x.dataset.mod));
  r.dockList = dockBtns.includes("m-movelab") && dockBtns.length >= 3 && dockBtns.includes("m-tape");
  r.gridHiddenByDefault = await page.evaluate(() => document.getElementById("ftGrid").hidden && document.getElementById("ftDive").hidden && document.getElementById("ftVerdict").getClientRects().length === 0 && document.querySelectorAll("#ftStrip .ft-strip-line").length === 1);
  r.ideasTab = dockBtns[0] === "m-ideas" && await page.evaluate(() => !!document.querySelector("#m-ideas #ftVerdict .ft-ideas"));
  await page.click("#ftDock .ft-dock-a");
  r.allShows = await page.evaluate(() => !document.getElementById("ftGrid").hidden && !document.getElementById("ftDive").hidden && /Back to one screen/.test(document.querySelector("#ftDock .ft-dock-a").textContent));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1800);
  const before = await page.evaluate(() => { const g = document.getElementById("ftGrid"); const t = document.getElementById("m-tape"); const x = t.getBoundingClientRect(); return { gh: g.getBoundingClientRect().height, th: x.height, tt: x.top - g.getBoundingClientRect().top, labs: window.__labLoaded || 0, order: [...g.children].map((c) => c.id || c.className).join("|"), tops: [...g.children].map((c) => Math.round(c.getBoundingClientRect().top - g.getBoundingClientRect().top)).join() }; });
  r.labNotYet = counts.lab === 0;
  await page.click('#ftDock .ft-dock-b[data-mod="m-tape"]');
  await page.waitForTimeout(150);
  const open = await page.evaluate(() => {
    const s = document.querySelector(".ft-sheet");
    const ph = document.querySelector('.ft-ph[data-for="m-tape"]');
    const b = s && s.getBoundingClientRect();
    const fm = document.getElementById("flowsMain");
    return { dialog: !!s && s.getAttribute("role") === "dialog" && s.getAttribute("aria-modal") === "true", modIn: !!s && s.querySelector("#m-tape") !== null, ph: ph ? ph.getBoundingClientRect().height : -1, inert: fm.inert, focusIn: !!s && s.contains(document.activeElement), bottom: b && b.bottom, height: b && b.height, selected: s ? [...s.querySelectorAll('.ft-sheet-tab')].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.dataset.mod) : [], pressed: document.querySelector('#ftDock [data-mod="m-tape"]').getAttribute("aria-pressed"), dup: document.querySelectorAll("#m-tape").length };
  });
  r.sheetOpens = open.dialog && open.modIn && open.dup === 1 && open.selected.join() === "m-tape" && open.pressed === "true";
  r.sheetGeometry = open.bottom <= vp.height && open.height <= Math.max(470, vp.height * 0.5) + 1 && open.height >= 300;
  r.placeholder = Math.abs(open.ph - before.th) < 1.5;
  r.behindInert = open.inert === true && open.focusIn;
  let trapped = true;
  for (let i = 0; i < 24; i++) { await page.keyboard.press("Tab"); const inside = await page.evaluate(() => document.querySelector(".ft-sheet").contains(document.activeElement)); trapped = trapped && inside; }
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Shift+Tab"); const inside = await page.evaluate(() => document.querySelector(".ft-sheet").contains(document.activeElement)); trapped = trapped && inside; }
  r.focusTrapped = trapped;
  await page.evaluate(() => document.querySelector('.ft-sheet-tab[aria-selected="true"]').focus());
  const tabs = await page.$$eval('.ft-sheet-tab', (t) => t.map((x) => x.dataset.mod));
  await page.keyboard.press("ArrowRight");
  const arrow = await page.evaluate(() => ({ sel: [...document.querySelectorAll('.ft-sheet-tab')].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.dataset.mod).join(), mod: document.querySelector(".ft-sheet-b > .ft-m") && document.querySelector(".ft-sheet-b > .ft-m").id, foc: document.activeElement.dataset.mod, tape: document.querySelector("#m-tape").closest(".ft-sheet") === null }));
  const nextTab = tabs[(tabs.indexOf("m-tape") + 1) % tabs.length];
  r.arrowRight = arrow.sel === nextTab && arrow.mod === nextTab && arrow.foc === nextTab && arrow.tape;
  await page.keyboard.press("ArrowLeft");
  const back = await page.evaluate(() => document.querySelector(".ft-sheet-b > .ft-m").id);
  r.arrowLeft = back === "m-tape";
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const g = document.getElementById("ftGrid"); const t = document.getElementById("m-tape"); const x = t.getBoundingClientRect();
    return { sheet: !!document.querySelector(".ft-sheet"), scrim: !!document.querySelector(".ft-scrim"), gh: g.getBoundingClientRect().height, th: x.height, tt: x.top - g.getBoundingClientRect().top, inGrid: t.parentNode === g, ph: document.querySelectorAll(".ft-ph").length, inert: document.getElementById("flowsMain").inert, foc: document.activeElement && document.activeElement.dataset && document.activeElement.dataset.mod, order: [...g.children].map((c) => c.id || c.className).join("|"), tops: [...g.children].map((c) => Math.round(c.getBoundingClientRect().top - g.getBoundingClientRect().top)).join() };
  });
  r.escCloses = !after.sheet && !after.scrim && after.inert === false;
  r.focusReturned = after.foc === "m-tape";
  r.moduleRestored = after.inGrid && after.ph === 0 && after.order === before.order;
  r.noShift = Math.abs(after.gh - before.gh) < 2 && Math.abs(after.tt - before.tt) < 2 && Math.abs(after.th - before.th) < 3;

  await page.click('#ftDock .ft-dock-b[data-mod="m-movelab"]');
  await page.waitForTimeout(500);
  r.labLoadsOnOpen = counts.lab >= 1;
  await page.mouse.click(300, 60);
  await page.waitForTimeout(100);
  r.scrimCloses = (await page.evaluate(() => !document.querySelector(".ft-sheet"))) && (await page.evaluate(() => document.getElementById("m-movelab").parentNode === document.getElementById("ftGrid")));

  await page.click('#ftGRange [role="tab"]:nth-child(3)');
  await page.waitForFunction(() => window.__glance.ranges.length > 0, null, { timeout: 4000 }).catch(() => {});
  const g = await page.evaluate(() => window.__glance);
  r.rangeWired = g.ranges.join() === "3M" && g.mounts.length >= 1 && g.mounts[0].range === "1M" && g.mounts[0].hasReading && g.mounts[0].keys === "cardX,claims,expiry,range,reading,summary,tape" && g.mounts[0].hosts === "cards,chart" && g.mounts[0].ticker === T;
  await page.click("#ftDock .ft-dock-a");
  r.allToggles = await page.evaluate(() => document.getElementById("ftGrid").hidden && document.getElementById("ftDive").hidden && /Every module, as one page/.test(document.querySelector("#ftDock .ft-dock-a").textContent));
  r.moduleGridKept = await page.evaluate(() => { const ids = [...document.querySelectorAll("#ftGrid > .ui-mod")].map((m) => m.id); return ids.length >= 6 && ids.includes("m-signal") && ids.includes("m-gamma") && document.getElementById("ftDive").textContent === "Dive" && !!document.getElementById("fxIndex"); });
  return r;
}

const browser = await chromium.launch();
try {
  const errors = [];
  const newPage = async (w, h, touch) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!touch, isMobile: !!touch });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return p;
  };

  const sizes = {};
  for (const [w, h] of [[1440, 820], [1024, 768], [1920, 1080]]) {
    const page = await newPage(w, h);
    await mount(page, READ);
    const r = await scenario(page);
    for (const [k, v] of Object.entries(r)) ok(v === true, `${w}x${h}: ${k}`);
    const fit = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sy: (scrollTo(0, 9999), scrollY) }));
    ok(fit.sh <= fit.ih && fit.sy === 0, `${w}x${h}: the page fits one screen with no document scroll (scrollHeight ${fit.sh} of ${fit.ih})`);
    sizes[w] = await page.evaluate(() => ({ chart: document.getElementById("ftGlanceChart").getBoundingClientRect().height, cards: document.getElementById("ftGlanceCards").getBoundingClientRect().height }));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `glance-${w}.png`) }); }
    await page.close();
  }
  ok(sizes[1920].chart > sizes[1440].chart + 100 && sizes[1920].cards > sizes[1440].cards + 20, `1920 grows the chart (${sizes[1440].chart} to ${sizes[1920].chart}) and the cards (${sizes[1440].cards} to ${sizes[1920].cards})`);

  {
    const page = await newPage(1440, 820);
    const st = async (read, o) => { await mount(page, read, o); return page.evaluate(() => { const r = document.getElementById("ftReadRail"); const c = r.cloneNode(true); c.querySelectorAll(".visually-hidden").forEach((n) => n.remove()); return { text: c.textContent.replace(/\s+/g, " "), status: r.dataset.status || null, claims: r.querySelectorAll(".ft-claim").length, pills: r.querySelectorAll(".ui-pill").length, hidden: r.hidden, src: (document.getElementById("ftReadSrc") || {}).textContent || "" }; }); };
    let s = await st(GENERATING);
    ok(/being written/.test(s.text) && s.claims === 4 && !/Deterministic reading/.test(s.text), "generating: a quiet being-written line over the deterministic text");
    s = await st(FALLBACK);
    ok(/Deterministic reading/.test(s.text) && s.claims === 4 && !/Model wording/.test(s.text), "fallback: the Deterministic reading label sits in the footnote line");
    ok(await page.evaluate(() => /Deterministic reading/.test(document.querySelector(".ft-foot").textContent)), "fallback: the label is in the footnote line only");
    s = await st(BOXED);
    ok(/still being assembled/.test(s.text) && s.claims === 0 && s.pills === 1, "generating with no sections: the note and a state pill");
    s = await st(ABSENT);
    ok(/Nothing is held/.test(s.text) && s.claims === 0 && s.pills === 1 && /What is not known/.test(s.text), "absent: a quiet state chip with the reason and the unknown list");
    s = await st(UNAVAILABLE);
    ok(/could not be read/.test(s.text) && s.claims === 0 && s.pills === 1, "unavailable: a state chip with the reason");
    s = await st(null);
    ok(/No reading is available/.test(s.text) && s.claims === 0 && !s.hidden, "no read object: a quiet line, never a blank rail");
    s = await st(READ);
    ok(/Model wording/.test(s.src) && s.src.length > 0 && !/Model wording/.test(s.text), "provenance is one visually hidden sentence, not rail text");
    s = await st(ONE_SIDED);
    ok(await page.evaluate(() => !!document.querySelector(".ft-dis-one") && !document.querySelector(".ft-dis-row")), "a tension with one cite is a single row");
    await st(READ);
    ok(await page.evaluate(() => !!document.querySelector(".ft-dis-row") && document.querySelectorAll(".ft-dis-c").length === 2), "a tension citing two opposed figures is two chips");
    await mount(page, GENERATING, { queue: [GENERATING, READ] });
    await page.waitForFunction(() => document.getElementById("ftReadRail").dataset.status === "ready", null, { timeout: 20000 });
    const up = await page.evaluate(() => ({ n: window.__glance.mounts.length, u: window.__glance.updates || [] }));
    ok(up.n === 1 && up.u.length >= 1 && up.u[up.u.length - 1].claims === "1,2,3,4" && up.u[up.u.length - 1].keys === "card,cardX,claims,expiry,reading,summary,tape", "a reading that lands late updates the mounted chart with the rail's own claim ids, without a second mount");
    const noGl = await newPage(1440, 820);
    await mount(noGl, READ, { noGlance: true });
    ok((await noGl.evaluate(() => document.getElementById("ftGlanceChart").childElementCount)) === 0, "without the chart module the call is guarded and the frame still stands");
    await noGl.close();
    await mount(page, HOSTILE);
    const hs = await page.evaluate(() => ({ bad: document.querySelectorAll("#ftReadRail img, #ftReadRail script, #ftReadRail [onerror]").length, pwned: window.__pwned }));
    ok(hs.bad === 0 && hs.pwned === undefined, "model text never becomes markup in the rail");
    await page.close();
  }

  for (const w of [390, 320]) {
    const page = await newPage(w, 800, true);
    await mount(page, READ);
    const m = await page.evaluate(() => {
      const ol = document.querySelector(".ft-claims");
      const li = [...ol.children].map((x) => x.getBoundingClientRect().width);
      const dock = [...document.querySelectorAll("#ftDock .ft-dock-b, #ftDock .ft-dock-a")].map((b) => b.getBoundingClientRect().height);
      const claim = [...document.querySelectorAll(".ft-claim")].map((b) => b.getBoundingClientRect().height);
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, region: ol.getAttribute("role"), label: ol.getAttribute("aria-label"), snap: getComputedStyle(ol).scrollSnapType, scrolls: ol.scrollWidth > ol.clientWidth, li, dock, claim, cols: getComputedStyle(document.getElementById("ftGlanceCards")).display, tab: ol.tabIndex, order: ["ftStrip", "ftGMain", "ftGlanceCards", "ftDock"].map((id) => document.getElementById(id).getBoundingClientRect().top) };
    });
    const ov = await page.evaluate(() => {
      const r = (q) => { const n = document.querySelector(q); if (!n) return null; if (!n.firstChild || n.firstChild.nodeType !== 3) return n.getBoundingClientRect(); const g = document.createRange(); g.selectNodeContents(n); const a = n.getBoundingClientRect(), b = g.getBoundingClientRect(); return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }; };
      const hit = (x, y) => x && y && x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5;
      const eng = r("#ftStrip .ft-eng");
      return { eng: !!eng, k: hit(eng, r("#ftStrip .ft-strip-k")), line: hit(eng, r("#ftStrip .ft-strip-line")), icon: hit(eng, r("#ftStrip .ft-neuron")), inside: eng && eng.right <= innerWidth };
    });
    ok(ov.eng && !ov.k && !ov.line && !ov.icon && ov.inside, `${w}: the engine chip overlaps neither the Neuron eyebrow, the headline nor the icon (${JSON.stringify(ov)})`);
    const aside = JSON.parse(JSON.stringify(card));
    aside.engine = { expiries: [], ...(aside.engine || {}), structures: [], noTrade: { code: "edge.none", why: "No structure cleared." } };
    await mount(page, READ, { card: aside, neuron: { context: { state: { confidence: 1 } } } });
    const ov2 = await page.evaluate(() => {
      const r = (q) => { const n = document.querySelector(q); if (!n) return null; if (!n.firstChild || n.firstChild.nodeType !== 3) return n.getBoundingClientRect(); const g = document.createRange(); g.selectNodeContents(n); const a = n.getBoundingClientRect(), b = g.getBoundingClientRect(); return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }; };
      const hit = (x, y) => x && y && x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5;
      const eng = r("#ftStrip .ft-eng");
      return { word: document.querySelector("#ftStrip .ft-eng").textContent, k: document.querySelector("#ftStrip .ft-strip-k").textContent, hitK: hit(eng, r("#ftStrip .ft-strip-k")), hitLine: hit(eng, r("#ftStrip .ft-strip-line")), hitIcon: hit(eng, r("#ftStrip .ft-neuron")), inside: eng.right <= innerWidth && eng.left >= 0 };
    });
    ok(/stand aside/.test(ov2.word) && /confidence 1 of 2/i.test(ov2.k), `${w}: the stand-aside case carries its chip and the confidence eyebrow (${ov2.word} / ${ov2.k})`);
    ok(!ov2.hitK && !ov2.hitLine && !ov2.hitIcon && ov2.inside, `${w}: Engine: stand aside wraps clear of the confidence eyebrow and the headline (${JSON.stringify(ov2)})`);
    await mount(page, READ);
    ok(m.sw <= m.iw, `${w}: no horizontal page overflow (${m.sw} of ${m.iw})`);
    ok(m.region === "region" && /swipe/.test(m.label) && m.tab === 0 && /x mandatory/.test(m.snap) && m.scrolls, `${w}: claims are a labelled, focusable, scroll-snapped region that scrolls`);
    ok(m.li.length === 4 && m.li.every((x) => Math.abs(x - 300) < 1), `${w}: each claim card is 300 px wide`);
    ok(m.dock.every((x) => x >= 44) && m.claim.every((x) => x >= 44), `${w}: dock and claim targets are at least 44 px`);
    ok(m.cols === "block", `${w}: the cards host is a plain block, so the glance module is the only grid that lays the cards out`);
    ok(m.order.every((v, i, a) => !i || v > a[i - 1]), `${w}: verdict, chart and reading, cards, dock stack in order`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `glance-${w}.png`) });
    await page.close();
  }

  {
    const page = await newPage(1100, 820);
    await mount(page, READ);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, chart: document.getElementById("ftGlanceChart").getBoundingClientRect().right, rail: document.getElementById("ftReadRail").getBoundingClientRect().left }));
    ok(m.sw <= m.iw && m.chart <= m.rail + 1, "1100 px: the glance layout holds beside the rail with no overflow");
    await page.close();
    const p2 = await newPage(800, 800);
    await mount(p2, READ);
    const k = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, stacked: document.getElementById("ftReadRail").getBoundingClientRect().top >= document.getElementById("ftGlanceChart").getBoundingClientRect().bottom - 1 }));
    ok(k.sw <= k.iw && k.stacked, "800 px: below 900 the frame stacks the chart over the reading");
    await p2.close();
  }

  const MUTANTS = [
    ["claim ids off by one", { js: (s) => s.replace("({ ...c, id: String(i + 1) })", "({ ...c, id: String(i + 2) })") }, ["claimIds", "hoverEmits", "footSwaps"]],
    ["footnote does not swap", { js: (s) => s.replace('b.classList.toggle("is-on", b.dataset.claim === hit);\n    paintFoot();', 'b.classList.toggle("is-on", b.dataset.claim === hit);') }, ["footSwaps"]],
    ["sheet does not restore the module", { js: (s) => s.replace("if (back && slot) slot.replaceWith(back);\n    else if (slot) slot.remove();", "if (slot) slot.remove();") }, ["moduleRestored", "noShift", "scrimCloses"]],
    ["an invented agree and against count", { js: (s) => s.replace('h("span", { class: "ft-eng" }, engineWord(card, n)));', 'h("span", { class: "ft-eng" }, engineWord(card, n)), h("span", { class: "ft-x" }, "5 agree \\u00b7 2 against"));') }, ["noAgreeWording", "stripParts"]],
    ["a coverage bar is present", { js: (s) => s.replace('h("span", { class: "ft-eng" }, engineWord(card, n)));', 'h("span", { class: "ft-eng" }, engineWord(card, n)), h("div", { class: "ft-cov-bar" }, h("i")));') }, ["noBar", "stripParts"]],
    ["focus is not returned", { js: (s) => s.replace("if (o) o.focus({ preventScroll: true });", "") }, ["focusReturned"]],
    ["hover does not dispatch", { js: (s) => s.replace('b.addEventListener("mouseenter", () => emitFocus(c.id, "claim"));', "") }, ["hoverEmits", "footSwaps"]],
    ["the all-sources list has no times", { js: (s) => s.replace('c.asOf ? F.time(c.asOf) : "no source time"', '"no source time"') }, ["allCitesPop"]],
    ["the page behind stays live", { js: (s) => s.replace("for (const n of behind) n.inert = true;", "") }, ["behindInert"]],
    ["Escape does not close the sheet", { js: (s) => s.replace("e.preventDefault(); e.stopPropagation(); closeSheet(false); return;", "return;") }, ["escCloses"]],
    ["the model name is printed in the rail", { js: (s) => s.replace('"as of " + F.time(read.asOf) }) : null));', '"as of " + F.time(read.asOf) + " " + read.modelName + " " + read.neurons + " neurons" }) : null));') }, ["noModelInRail"]],
    ["the layout outgrows the viewport", { css: (s) => s.replace("--ft-main-h: clamp(340px, calc(100dvh - 224px - var(--ft-cards-h)), 720px);", "--ft-main-h: 900px;") }, ["geoFits"]],
    ["the placeholder is not kept", { js: (s) => s.replace('style: { height: m.getBoundingClientRect().height + "px" }', "style: { height: '0px' }") }, ["placeholder", "noShift"]],
    ["the dock opens no tab list", { js: (s) => s.replace('if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;\n        e.preventDefault();\n        const n = tabs', 'if (true) return;\n        const n = tabs') }, ["arrowRight"]],
  ];
  for (const [name, o, expect] of MUTANTS) {
    const page = await newPage(1440, 820);
    let failed = [];
    try {
      const src = o.js ? o.js(SRC_JS) : SRC_JS, css = o.css ? o.css(SRC_CSS) : SRC_CSS;
      ok(src !== SRC_JS || css !== SRC_CSS, `planted build "${name}" changed the source`);
      await mount(page, READ, o);
      const r = await scenario(page);
      failed = Object.entries(r).filter(([, v]) => v !== true).map(([k]) => k);
    } catch (e) { failed = ["threw: " + String(e.message).split("\n")[0]]; }
    ok(failed.length > 0 && expect.some((k) => failed.includes(k) || failed[0].startsWith("threw")), `planted build "${name}" fails the suite (${failed.join(", ")})`);
    await page.close();
  }

  const mine = errors.filter((e) => !/flows-ticker: (buildGamma|buildFlow) failed/.test(e));
  ok(mine.length === 0, "no page error or console error across the run: " + mine.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}
console.log(`flows-glance-frame-render: ${checks} checks passed`);
