import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import { cardX as fixtureCardX } from "./dossier-fixtures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); checks++; };

const SRC_PATH = path.join(ROOT, "assets/js/flows-ticker-glance.js");
const SRC = fs.readFileSync(SRC_PATH, "utf8");
ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(/.test(SRC), "the glance module holds no literal colour");
ok(!/getComputedStyle|cssVar\(/.test(SRC), "and reads no computed colour: every paint is a class on a token");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-ticker.css"), "utf8");
const GLANCE_CSS = CSS.split("\n").filter((l) => /\.ftg-/.test(l)).join("\n");
ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(GLANCE_CSS), "and the .ftg- rules hold no literal colour");
ok(!/min-width:\s*(?:6[0-4]\d|1[01]\d\d)px[^}]*max-width|max-width:\s*(?:640|1100)px/.test(GLANCE_CSS), "no .ftg- rule writes a width as both a min and a max");

const EMIT = nightlyEmit();
const cards = fs.readdirSync(EMIT).filter((f) => /^-card-[A-Z][A-Z0-9.\-]*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(EMIT, f), "utf8")));
const card0 = cards.find((c) => c.ticker === "AAPL") || cards.find((c) => c.panels && c.panels.pricedMove && c.panels.pricedMove.status === "ok" && c.panels.gamma && c.panels.gamma.status === "ok" && c.panels.context && c.panels.context.candles && c.panels.context.candles.length > 100);
const card = JSON.parse(JSON.stringify(card0));
delete card.engine;
card.panels.surface = { status: "unavailable" };
ok(card && card.panels.pricedMove.status === "ok" && card.panels.gamma.status === "ok" && card.panels.context.candles.length > 100, "the dry-run emit holds a card with a priced move, gamma by strike and a year of closes");
const clone = (x) => JSON.parse(JSON.stringify(x));

const SIM_SESSIONS = 6;
function makeX() {
  const x = clone(fixtureCardX(card.ticker));
  x.earnings.next = { d: "2026-08-31", when: "postmarket", source: "company", confirmed: true, sessions: SIM_SESSIONS };
  x.earnings.impliedNext = { em: 0.042 };
  x.earnings.medianAbsMove = 0.01;
  x.cone = { status: "ok", iv30: 0.4003, slope30_90: 0.02 };
  x.term = { status: "ok", expiries: [7, 14, 30, 60, 90, 180].map((d, i) => ({ dte: d, iv: [0.36, 0.38, 0.4003, 0.41, 0.42, 0.43][i] })), eventMove: { sd: 0.042 } };
  x.skew = { status: "ok", rr25: 0.005, z: 0.4 };
  x.vrp = { status: "ok", exAnte: { vrp: 0.096 }, hitRate: 0.6 };
  x.nope = { status: "ok", close: 0.968 };
  x.short.volume = { status: "ok", ratio: 0.54, z: 2.2, mean60: 0.46, path: Array.from({ length: 24 }, (_, i) => [`2026-07-${String(i + 1).padStart(2, "0")}`, 0.44 + 0.01 * ((i * 7) % 11)]) };
  return x;
}
const X = makeX();
const READING = { status: "ready", sections: {
  now: { text: "n", cites: [{ id: "options.engine.gex.book" }, { id: "options.engine.hedge.up1sd" }] },
  drivers: [{ text: "d1", cites: [{ id: "options.engine.level.flip" }] }, { text: "d2", cites: [{ id: "options.engine.move.event" }, { id: "earnings.next" }] }],
  tensions: [{ text: "t", cites: [{ id: "positioning.insider.net90" }] }], watch: [], unknown: [],
} };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const BLANK = /\/assets\/js\/(flows-ticker|flows-fresh|flows-rt|flows-index|flows-quant-read\.bundle)\.js$/;
const HTML = FLOWS_PAGES.tickerPage({ username: "u" });
const browser = await chromium.launch();

async function boot(vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: o.reduced ? "reduce" : "no-preference", hasTouch: !!o.touch, isMobile: !!o.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/assets/js/flows-ticker-glance.js") return route.fulfill({ contentType: "text/javascript", body: o.src || SRC });
    if (BLANK.test(u.pathname)) return route.fulfill({ contentType: "text/javascript", body: "" });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/ticker/?t=" + card.ticker);
  await page.evaluate(({ chartW, pad }) => {
    const wrap = document.createElement("div");
    wrap.id = "wrap";
    wrap.style.cssText = `padding:0 ${pad}px;box-sizing:border-box;width:100vw`;
    const row = document.createElement("div");
    row.style.cssText = "display:grid;gap:16px;grid-template-columns:" + (chartW ? chartW + "px minmax(0,1fr)" : "minmax(0,1fr)");
    const chart = Object.assign(document.createElement("div"), { id: "ftGlanceChart" });
    const rail = document.createElement("div");
    row.append(chart);
    if (chartW) row.append(rail);
    const cardsEl = Object.assign(document.createElement("div"), { id: "ftGlanceCards" });
    cardsEl.style.marginTop = "12px";
    wrap.append(row, cardsEl);
    document.body.replaceChildren(wrap);
  }, { chartW: o.chartW || 0, pad: o.pad === undefined ? 20 : o.pad });
  await page.addScriptTag({ url: "https://example.test/assets/js/flows-ticker-glance.js" });
  await page.evaluate(({ card, x, reading, range, tape }) => {
    window.__g = window.FlowsUI.tickerGlance.mount(card, { chart: document.getElementById("ftGlanceChart"), cards: document.getElementById("ftGlanceCards") }, { reading, range, cardX: x, tape });
  }, { card: o.card || card, x: o.x === undefined ? X : o.x, reading: o.reading || null, range: o.range || "1M", tape: o.tape || null });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  page.__errors = errors;
  page.__ctx = ctx;
  return page;
}
const cutCard = (fn) => { const c = clone(card); fn(c); return c; };

async function fixtureAnswers(page) {
  return page.evaluate(({ card, x }) => {
    const G = window.FlowsUI.tickerGlance, F = window.FlowsUI.F;
    const m = G.model(card, "1M", { cardX: x });
    return { m, F: { score: F.signed(card.score), net: F.money(card.panels.path.netPremium, true), pct: F.pct(card.panels.context.week52Pos, 0), em: F.pct(0.042, 1) } };
  }, { card, x: X });
}

const S = card.panels.pricedMove.spot;
const pm = card.panels.pricedMove;
const Hs = pm.sessions;
const qUp = Math.log(pm.impliedHigh / S), qDn = Math.log(S / pm.impliedLow), pUp = Math.log(pm.realizedHigh / S), pDn = Math.log(S / pm.realizedLow);

{
  const page = await boot({ width: 1440, height: 900 }, { chartW: 868 });
  const ans = await fixtureAnswers(page);
  const m = ans.m;
  eq(m.hist.length, 21, "1M is 20 sessions back and today: 21 closes");
  eq(m.F, 20, "and 20 sessions forward");
  near(m.S, S, 1e-9, "the cone is anchored at the card's spot");
  const tE = SIM_SESSIONS + 0.5;
  eq(m.event.h, tE, "a report after the close steps the cone half a session after the report session");
  eq(m.event.q, 0.042, "the step uses the card's implied event move");
  eq(m.event.p, 0.01, "and the realised history's median absolute move");
  const exp = (hh, dd, J, sign) => S * Math.exp(sign * Math.sqrt(hh * dd + (J ? J * J : 0)));
  let maxErr = 0;
  for (const o of m.q) {
    const jump = o.h > tE ? 0.042 : 0;
    if (o.h !== tE) maxErr = Math.max(maxErr, Math.abs(o.up - exp(o.h, qUp * qUp / Hs, jump, 1)) / S, Math.abs(o.lo - exp(o.h, qDn * qDn / Hs, jump, -1)) / S);
  }
  ok(maxErr < 1e-12, `every Q point is spot * exp(+-sqrt(h * d + jump^2)) with d the priced variance per session (${maxErr})`);
  const noEvent = clone(m.q.filter((o) => o.h < tE));
  near(Math.log(noEvent.find((o) => o.h === 6).up / S) / Math.log(noEvent.find((o) => o.h === 2).up / S), Math.sqrt(6 / 2), 1e-9, "before the report the half-width grows with the square root of time (6 against 2 sessions)");
  const pair = m.q.filter((o) => o.h === tE);
  eq(pair.length, 2, "the report is two points at one time: the cone before and after the jump");
  near(Math.log(pair[1].up / S) ** 2 - Math.log(pair[0].up / S) ** 2, 0.042 * 0.042, 1e-12, "and the squared log half-width jumps by the implied event move squared");
  const pp = m.p.filter((o) => o.h === tE);
  near(Math.log(pp[1].up / S) ** 2 - Math.log(pp[0].up / S) ** 2, 0.01 * 0.01, 1e-12, "the real-world cone steps by the realised median squared");
  near(Math.log(m.p.find((o) => o.h === 5).up / S) ** 2, 5 * pUp * pUp / Hs, 1e-12, "and P's variance grows linearly in sessions from the realised range");
  ok(m.p[m.p.length - 1].up < m.q[m.q.length - 1].up, "the card's realised band is narrower than its implied band");
  eq(m.q.length, 23, "21 integer sessions plus the two points at the step");

  const far = await page.evaluate(({ card, x }) => {
    const G = window.FlowsUI.tickerGlance.model, y = JSON.parse(JSON.stringify(x));
    y.earnings.next.sessions = 30;
    const a = G(card, "1M", { cardX: y });
    y.earnings.next.sessions = 20; y.earnings.next.when = "premarket";
    const b = G(card, "1M", { cardX: y });
    return { e: a.event, n: a.q.length, why: a.why.event, b: b.event && b.event.h };
  }, { card, x: X });
  eq(far.e, null, "a report beyond the 20-session horizon draws no step");
  eq(far.n, 21, "and the cone has no extra point");
  ok(/30 sessions away, past the month shown/.test(far.why), "and says why");
  eq(far.b, 19.5, "a report before the open steps half a session before its session");

  const lay = await page.evaluate(({ card, x }) => {
    const G = window.FlowsUI.tickerGlance.model, mm = G(card, "1M", { cardX: x });
    const L = G.layout(mm, 868, 344);
    return { labels: L.labels, bars: L.bars, g: mm.bars, profW: L.profW, score: L.score, rows: mm.score.rows, levels: mm.levels, y: mm.levels.map((l) => L.y(l.px)), plotB: L.plotB, top: L.top };
  }, { card, x: X });
  const ys = lay.labels.map((l) => l.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) ok(ys[i] - ys[i - 1] >= 12 - 1e-6, `labels ${i - 1} and ${i} are at least one label height apart (${ys[i] - ys[i - 1]})`);
  for (const l of lay.labels) ok(Math.abs(l.y - l.want) <= (lay.labels.length - 1) * 12 + 1e-6, `${l.kind}'s label sits within (n - 1) label heights of its level (${Math.abs(l.y - l.want)})`);
  ok(lay.labels.length >= 4, "the real card's four nearby levels and spot are all labelled");
  const gmax = Math.max(...lay.g.map((b) => Math.abs(b.g)));
  for (const b of lay.bars) near(b.w, Math.abs(b.g) / gmax * lay.profW * 0.95, 1e-9, "gamma bar width is proportional to |g|");
  const k0 = lay.bars.find((b) => b.g > 0);
  ok(k0 && lay.bars.some((b) => b.g < 0), "the card has both long and short strikes");
  near(lay.bars.find((b) => b.g === k0.g).w / k0.w, 1, 1e-9, "the same g draws the same width");
  const sk = lay.score;
  for (const b of sk.bars) if (b) near(b.h, Math.max(1, Math.abs(b.v) * sk.k), 1e-9, "score bar height is |score| times one scale");
  eq(sk.bars.filter(Boolean).length, lay.rows.filter((r) => r.v !== null).length, "one bar for each scored session, none for an unscored one");

  const rnd = (() => { let a = 12345; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; })();
  const pageCluster = await page.evaluate(({ seeds }) => {
    const c = window.FlowsUI.tickerGlance.model.cluster, bad = [];
    for (const wants of seeds) {
      const ys2 = c(wants, 12, 8, 260);
      const order = wants.map((w, i) => i).sort((a, b) => wants[a] - wants[b] || a - b).map((i) => ys2[i]);
      for (let i = 1; i < order.length; i++) if (order[i] - order[i - 1] < 12 - 1e-6) bad.push("overlap");
      if (Math.min(...ys2) < 8 - 1e-6 || Math.max(...ys2) > 260 + 1e-6) bad.push("bounds");
      ys2.forEach((y, i) => { if (Math.abs(y - wants[i]) > (wants.length - 1) * 12 + 1e-6) bad.push("distance"); });
    }
    return bad;
  }, { seeds: Array.from({ length: 200 }, () => Array.from({ length: 2 + Math.floor(rnd() * 5) }, () => 8 + rnd() * 250)) });
  eq(pageCluster, [], "200 random label sets never overlap, stay in bounds and stay within (n - 1) heights of their levels");

  const d = await page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    const svg = document.querySelector(".ftg-svg");
    const r = svg.getBoundingClientRect();
    return { w: r.width, h: r.height, gl: q(".ftg-svg .ftg-gl").map((n) => +n.getAttribute("width")), gs: q(".ftg-svg .ftg-gs").map((n) => +n.getAttribute("width")), sp: q(".ftg-svg .ftg-sp").length, sn: q(".ftg-svg .ftg-sn").length, today: q(".is-today").length, desc: document.getElementById(svg.getAttribute("aria-describedby")).textContent, name: svg.getAttribute("aria-label"), tab: svg.tabIndex, role: svg.getAttribute("role"), q: q(".ftg-svg .ftg-q").length, p: q(".ftg-svg .ftg-p").length,
      vals: q(".ftg-sv").map((n) => n.textContent), gv: (q(".ftg-gv")[0] || {}).textContent, marks: q(".ftg-mk").length, claims: q("[data-claims]").length, legend: document.querySelector(".ftg-legend").textContent, labels: q(".ftg-lt").map((n) => n.textContent) };
  });
  ok(d.w === 868 && d.h > 300 && d.h < 400, `at 1440 wide the chart is the 868 px cell by ${d.h} px (area ${(d.w * d.h / 1e3).toFixed(0)}k px2)`);
  eq(d.gl.length, lay.bars.filter((b) => b.g > 0).length, "long gamma is one blue bar per positive strike");
  eq(d.gs.length, lay.bars.filter((b) => b.g < 0).length, "short gamma is one hatched bar per negative strike");
  eq(d.gl.map((w) => Math.round(w * 1e6) / 1e6), lay.bars.filter((b) => b.g > 0).map((b) => Math.max(1, Math.round(b.w * 1e6) / 1e6)), "and the long widths on screen are the model's");
  eq(d.q, 2, "Q draws an upper and a lower edge");
  eq(d.p, 2, "P draws an upper and a lower edge");
  eq(d.today, 1, "only the last score bar is emphasised");
  eq(d.marks, 0, "without a reading there are no numbered marks");
  eq(d.claims, 0, "and no layer carries a claim");
  ok(d.desc.includes("on the vendor's convention (dealers long calls, short puts)") && /plus or minus/.test(d.desc), "the description names the dealer convention and both moves");
  ok(/closing at/.test(d.desc) && /Call wall/.test(d.desc) && /Put wall/.test(d.desc) && /Flip/.test(d.desc) && /Max pain/.test(d.desc) && /report/.test(d.desc), "and the close, the walls, the flip, max pain and the report");
  ok(d.role === "img" && d.tab === 0 && d.name.length > 30, "the chart is one named tab stop");
  ok(d.gv.includes("$") && d.gv.includes("per 1%"), `the gamma header prints the book figure (${d.gv})`);
  ok(!/[^\S ]0\.00|\bNaN\b|undefined/.test(d.legend + d.desc), "no NaN or undefined reaches the legend or the description");
  ok(d.labels.some((t) => /^Call /.test(t)) && d.labels.some((t) => /^Flip /.test(t)), "levels are labelled on the right edge");
  eq(page.__errors, [], "no page error");

  await page.locator(".ftg-svg").focus();
  const r0 = await page.evaluate(() => document.querySelector(".ftg-readout").textContent);
  ok(r0.includes(await page.evaluate((px) => window.FlowsUI.F.px(px), S)), `focusing the chart reads today's price (${r0})`);
  await page.keyboard.press("ArrowLeft");
  const r1 = await page.evaluate(() => document.querySelector(".ftg-readout").textContent);
  ok(r1 !== r0 && /\d/.test(r1), `ArrowLeft moves to the previous session (${r1})`);
  const prevClose = card.panels.context.candles[card.panels.context.candles.length - 2][4];
  ok(r1.includes(await page.evaluate((px) => window.FlowsUI.F.px(px), prevClose)), "and reads that session's own close");
  await page.keyboard.press("End");
  const r2 = await page.evaluate(() => document.querySelector(".ftg-readout").textContent);
  ok(/\+20 sessions/.test(r2) && /Q /.test(r2) && /P /.test(r2), `End reaches the last forward session with both ranges (${r2})`);
  ok(await page.evaluate(() => document.querySelector(".ftg-readout").getAttribute("aria-live") === "polite"), "the readout is a polite live region");
  await page.keyboard.press("Home");
  const r3 = await page.evaluate(() => document.querySelector(".ftg-readout").textContent);
  eq(r3.split(" · ")[0], await page.evaluate((d) => window.FlowsUI.F.day(d), card.panels.context.candles[card.panels.context.candles.length - 21][0]), "Home reaches the first session of the window");
  await page.keyboard.press("Escape");
  eq(await page.evaluate(() => document.querySelector(".ftg-readout").textContent), "", "Escape clears the crosshair");

  const pxPts = () => page.evaluate(() => (document.querySelector(".ftg-px").getAttribute("d").match(/,/g) || []).length);
  eq(await pxPts(), 21, "the 1M price line has 21 points");
  await page.evaluate(() => window.__g.setRange("3M"));
  eq(await pxPts(), 64, "3M is 63 sessions back: 64 points");
  await page.evaluate(() => window.__g.setRange("6M"));
  eq(await pxPts(), 127, "6M is 127 points");
  await page.evaluate(() => window.__g.setRange("1Y"));
  eq(await pxPts(), Math.min(253, card.panels.context.candles.length), "1Y is 252 sessions back, or every close the card holds");
  await page.evaluate(() => window.__g.setRange("1M"));
  eq(await pxPts(), 21, "and back to 1M");
  await page.evaluate(() => window.__g.setRange("bogus"));
  eq(await pxPts(), 21, "an unknown range changes nothing");
  await page.context().close();
}

const CARD_IDS = ["signal", "volatility", "flow", "positioning", "earnings", "range"];
{
  const page = await boot({ width: 1440, height: 900 }, { chartW: 868 });
  const got = await page.evaluate(() => [...document.querySelectorAll(".ftg-card")].map((n) => ({ id: n.dataset.card, f: n.querySelector(".ftg-f").textContent, tone: n.querySelector(".ftg-f").dataset.tone, u: n.querySelector(".ftg-u").textContent, sub: n.querySelector(".ftg-sub").textContent, foot: n.querySelector(".ftg-foot").textContent, h: n.getBoundingClientRect().height, w: n.getBoundingClientRect().width, tab: n.tabIndex, d: document.getElementById(n.getAttribute("aria-describedby")).textContent, t: n.querySelector("h3").textContent, svgs: n.querySelectorAll("svg").length, rows: n.querySelectorAll(".ftg-fam").length, chips: [...n.querySelectorAll(".ftg-chip")].map((c) => c.textContent) })));
  const fmt = await page.evaluate(({ card }) => { const F = window.FlowsUI.F, c = card.panels; return {
    score: F.signed(card.score), net: F.money(c.path.netPremium, true), nd: F.num(c.path.netDelta, true), p52: F.pct(c.context.week52Pos, 0), r5: F.pct(c.context.r5, 1, true), r21: F.pct(c.context.r21, 1, true),
    iv: F.pct(0.4003, 1), vrp: F.signed(9.6, 1), cg: c.congress, fams: ["F", "P", "D", "V", "O"].map((k) => (card.fam[k] === null || card.fam[k] === undefined ? null : F.num(card.fam[k], k === "F" || k === "P" || k === "D"))),
    nope: F.pct(0.968, 1, true), day: F.day("2026-08-31"), sv: F.pct(0.54, 0), z: F.signed(2.2, 1), mean: F.pct(0.46, 0) }; }, { card });
  eq(got.map((g) => g.id), CARD_IDS, "six cards in the canvas's order");
  const by = Object.fromEntries(got.map((g) => [g.id, g]));
  eq(by.signal.f, fmt.score, `Signal prints the card's score (${by.signal.f})`);
  ok(by.signal.f.startsWith("−") && by.signal.tone === "down", "a negative score uses the U+2212 minus and the down tone");
  ok(by.signal.sub === "conviction " + card.conviction + " of 100", `and the card's conviction (${by.signal.sub})`);
  eq(by.signal.rows, 5, "five components");
  eq(by.volatility.f, fmt.iv, "Volatility prints the 30-day implied volatility");
  ok(by.volatility.sub === "IV rank " + Math.round(pm.ivRank * 100), `and the card's IV rank (${by.volatility.sub})`);
  ok(by.volatility.foot.includes("+9.6 pts") && by.volatility.foot.includes("skew +0.5") && by.volatility.foot.includes("upward term"), `with premium over realised, skew and the term direction (${by.volatility.foot})`);
  eq(by.flow.f, fmt.net, "Flow prints the session's net premium");
  ok(by.flow.foot.includes("Net delta " + fmt.nd) && by.flow.foot.includes("NOPE " + fmt.nope), `with net delta and NOPE (${by.flow.foot})`);
  eq(by.positioning.f, fmt.sv, "Positioning prints the short-volume ratio");
  eq(by.positioning.u, "z " + fmt.z, "and its z");
  ok(by.positioning.foot.includes("Float 2.1%") && by.positioning.foot.includes("borrow 0.31%") && by.positioning.foot.includes("insiders −$225K"), `with float, borrow and insiders (${by.positioning.foot})`);
  eq(by.earnings.f, fmt.day, "Earnings prints the next report date");
  eq(by.earnings.u, "in 6 sessions", "and the sessions away");
  ok(by.earnings.sub === "after the close", "after the close");
  ok(by.earnings.foot.startsWith("Priced ±4.2%") && by.earnings.foot.includes("realised ±1.0%") && /\d of 8 beat it/.test(by.earnings.foot), `with priced, realised and the beat count (${by.earnings.foot})`);
  const evs = X.earnings.events.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-8);
  const beat = evs.filter((r) => Math.abs(r[3]) > r[2]).length;
  ok(by.earnings.foot.includes(beat + " of 8 beat it"), `and the count agrees with the card's rows (${beat})`);
  eq(by.range.f, fmt.p52, "Range prints the 52-week position");
  eq(by.range.chips[0], "1W " + fmt.r5, "its 1W chip is the card's five-session return");
  eq(by.range.chips[1], "1M " + fmt.r21, "its 1M chip is the card's 21-session return");
  ok(/^3M [+−]\d/.test(by.range.chips[2]), `and a 3M chip from the closes (${by.range.chips[2]})`);
  ok(by.range.foot.includes("Congress —") === false && by.range.foot.includes("4 sells") && by.range.foot.includes("Technology"), `with Congress and the sector (${by.range.foot})`);
  for (const g of got) {
    ok(g.tab === 0, `${g.id}: a focusable region`);
    ok(g.h === 200, `${g.id}: 200 px tall at 1440 (${g.h})`);
    ok(g.w > 190, `${g.id}: wide enough for six across (${g.w})`);
    ok(g.d.includes(g.t) && g.d.includes(g.f), `${g.id}: a hidden description with the figure`);
    ok(g.svgs >= 1 || g.id === "signal", `${g.id}: one chart`);
    ok(g.foot.length > 10, `${g.id}: a footer line`);
  }
  eq(new Set(got.map((g) => Math.round(g.w))).size <= 2, true, "the six cards share the row evenly");
  await page.context().close();
}

{
  const stripped = [
    ["signal", (c) => { c.score = null; c.conviction = null; c.fam = {}; c.panels.scoreOverlay = { status: "unavailable" }; }, null],
    ["volatility", (c) => { c.panels.pricedMove = { status: "unavailable" }; c.panels.volContext = { status: "unavailable" }; c.panels.skewTerm = { status: "unavailable" }; }, (x) => { delete x.cone; delete x.term; delete x.vrp; delete x.skew; }],
    ["flow", (c) => { c.panels.path = { status: "unavailable" }; }, null],
    ["positioning", null, (x) => { x.short = { status: "unavailable" }; x.insiders = { status: "unavailable" }; }],
    ["earnings", null, (x) => { x.earnings = { status: "unavailable" }; }],
    ["range", (c) => { c.panels.context = { status: "unavailable" }; }, null],
  ];
  for (const [id, cf, xf] of stripped) {
    const c = cutCard((cc) => { if (cf) cf(cc); });
    const x = clone(X);
    if (xf) xf(x);
    const page = await boot({ width: 1440, height: 900 }, { chartW: 868, card: c, x });
    const g = await page.evaluate((cid) => { const n = document.querySelector(`[data-card="${cid}"]`); return { f: n.querySelector(".ftg-f").textContent, u: n.querySelector(".ftg-u").textContent, foot: n.querySelector(".ftg-foot").textContent, miss: n.dataset.missing, charts: n.querySelectorAll(".ftg-cb svg, .ftg-fam .ftg-fb").length }; }, id);
    eq(g.f, "—", `${id}: with its input removed the figure is an em dash`);
    ok(g.miss === "1" && g.foot.length > 15 && !/^[+−-]?\$?0/.test(g.f), `${id}: and the footer says why (${g.foot})`);
    ok(g.u === "", `${id}: with no unit printed beside a dash`);
    eq(g.charts, 0, `${id}: and no chart is drawn from nothing`);
    eq(page.__errors, [], `${id}: absent input throws nothing`);
    await page.context().close();
  }
  const bare = cutCard((c) => { c.panels = { context: c.panels.context }; c.regime = {}; c.score = null; });
  const page = await boot({ width: 1440, height: 900 }, { chartW: 868, card: bare, x: {} });
  const d = await page.evaluate(() => ({ q: document.querySelectorAll(".ftg-svg .ftg-q, .ftg-svg .ftg-p").length, bars: document.querySelectorAll(".ftg-svg .ftg-gl, .ftg-svg .ftg-gs").length, score: document.querySelectorAll(".ftg-svg .ftg-sp, .ftg-svg .ftg-sn").length, legend: document.querySelector(".ftg-legend").textContent, desc: document.getElementById(document.querySelector(".ftg-svg").getAttribute("aria-describedby")).textContent, gh: document.querySelectorAll(".ftg-gh").length, lines: document.querySelectorAll(".ftg-lv").length }));
  eq(d.q, 0, "no priced move: no cone is drawn");
  eq(d.bars, 0, "no gamma by strike: no bar is drawn");
  eq(d.gh, 0, "and no header over an empty profile");
  eq(d.score, 0, "no score history: no bar is drawn");
  ok(/priced move/.test(d.legend) && /gamma/i.test(d.legend) && /score history/.test(d.legend), `each absence is named in the legend row (${d.legend})`);
  ok(!/\b0\.00\b|NaN/.test(d.legend + d.desc), "never a zero or a NaN");
  ok(/closing at/.test(d.desc), "the price line still draws from the closes");
  await page.context().close();
}

{
  const page = await boot({ width: 1440, height: 900 }, { chartW: 868, reading: READING });
  const st = await page.evaluate(() => {
    const out = {};
    for (const n of document.querySelectorAll("[data-claims]")) out[(n.dataset.layer || n.dataset.card) + (n.dataset.mark ? n.dataset.mark : "")] = n.getAttribute("data-claims");
    return { out, marks: [...document.querySelectorAll(".ftg-mk")].map((n) => n.dataset.mark), badges: [...document.querySelectorAll(".ftg-card")].map((n) => [n.dataset.card, n.querySelectorAll(".ftg-badge").length]) };
  });
  eq(st.out.gamma, "1", "the gamma profile evidences claim 1, which cites the gex book");
  eq(st.out.flip, "2", "the flip line evidences claim 2");
  eq(st.out.event, "3", "the report step evidences claim 3");
  eq(st.out.positioning, "4", "the positioning card evidences claim 4");
  eq(st.out.earnings, "3", "the earnings card follows the event facts");
  eq(st.out.cone, "", "the cone, which no cite touches, evidences nothing");
  eq(st.out.walls, "", "and neither do the walls");
  eq(st.out.score, "", "nor the score bars");
  eq(st.out.signal, "", "nor the Signal card");
  eq(st.marks, ["1", "2", "3", "4"].filter((i) => i !== "4"), "marks stand on the layers they evidence: 1, 2 and 3 (claim 4 has only a card)");
  eq(st.badges.find((b) => b[0] === "positioning")[1], 1, "the positioning card carries claim 4's badge");
  await page.evaluate(() => { window.__ev = []; document.addEventListener("ft:focus", (e) => window.__ev.push([e.detail.id, e.detail.source, e.bubbles])); });
  const states = () => page.evaluate(() => { const o = { hot: [], dim: [] }; for (const n of document.querySelectorAll("[data-ftg-state]")) o[n.dataset.ftgState].push((n.dataset.layer || n.dataset.card) + (n.dataset.mark || "")); return { hot: o.hot.sort(), dim: o.dim.sort(), withClaims: [...document.querySelectorAll("[data-claims]")].length, noClaimsState: [...document.querySelectorAll("[data-ftg-state]:not([data-claims])")].length }; });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: "2", source: "claim" } })));
  let s2 = await states();
  ok(s2.hot.length >= 2 && s2.hot.every((k) => k === "flip" || k === "mark2"), `claim 2 keeps its evidence: ${s2.hot.join(",")}`);
  eq(s2.hot.length + s2.dim.length, s2.withClaims, "everything that declares claims is either kept or stepped back");
  ok(s2.dim.includes("gamma") && s2.dim.includes("cone") && s2.dim.includes("event") && s2.dim.includes("score") && s2.dim.includes("signal"), "the other layers and cards step back");
  eq(s2.noClaimsState, 0, "the price line and the grid never dim");
  const pxOpacity = await page.evaluate(() => getComputedStyle(document.querySelector(".ftg-px")).opacity);
  eq(pxOpacity, "1", "the price line stays at full strength");
  await page.waitForTimeout(350);
  const dimOp = await page.evaluate(() => getComputedStyle(document.querySelector('[data-layer="cone"]')).opacity);
  ok(+dimOp <= 0.5, `a dimmed layer is faded (${dimOp})`);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".ftg-tag")).display !== "none"), "the flip's hedging sentence appears with claim 2");
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: "4", source: "claim" } })));
  s2 = await states();
  ok(s2.hot.includes("positioning") && s2.dim.includes("flip"), "claim 4 keeps the positioning card and steps the chart back");
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: null, source: "claim" } })));
  s2 = await states();
  eq(s2.hot.length + s2.dim.length, 0, "null restores every layer and card");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".ftg-tag")).display === "none"), "and hides the sentence again");

  await page.evaluate(() => { window.__ev.length = 0; });
  await page.locator('.ftg-mk[data-mark="2"]').dispatchEvent("mouseenter");
  await page.locator('.ftg-mk[data-mark="2"]').dispatchEvent("mouseleave");
  const ev = await page.evaluate(() => window.__ev);
  eq(ev, [["2", "mark", true], [null, "mark", true]], "a mark dispatches a bubbling ft:focus with its id, then null");
  await page.evaluate(() => { window.__ev.length = 0; });
  await page.locator('[data-card="positioning"]').focus();
  await page.locator('[data-card="positioning"]').blur();
  eq(await page.evaluate(() => window.__ev.map((e) => [e[0], e[1]])), [["4", "card"], [null, "card"]], "a card dispatches its first claim on focus and null on blur");
  await page.evaluate(() => { window.__ev.length = 0; });
  await page.locator('[data-card="signal"]').focus();
  eq(await page.evaluate(() => window.__ev.length), 0, "a card that evidences no claim dispatches nothing");
  await page.evaluate(() => window.__g.update({ reading: null }));
  eq(await page.evaluate(() => document.querySelectorAll(".ftg-mk, [data-claims]").length), 0, "update with no reading removes every mark and claim");
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: "2", source: "claim" } })));
  const quiet = await states();
  eq(quiet.hot.length + quiet.dim.length, 0, "and a focus event then dims nothing");
  await page.evaluate(() => window.__g.update({ reading: window.__r || null, claims: [{ id: "1", cites: ["options.engine.level.callWall"] }] }));
  eq(await page.evaluate(() => [...document.querySelectorAll(".ftg-mk")].map((n) => n.dataset.mark)), ["1"], "explicit claims override the derivation and mark the walls");
  await page.evaluate(() => window.__g.destroy());
  eq(await page.evaluate(() => document.querySelectorAll(".ftg-chart, .ftg-cards-in").length), 0, "destroy removes the chart and the cards");
  await page.context().close();
}

{
  const page = await boot({ width: 1440, height: 900 }, { chartW: 868 });
  const ev = await page.evaluate(() => window.FlowsUI.tickerGlance.model.evidence([{ id: "1", cites: ["options.engine.gex.book", "options.engine.level.flip"] }, { id: "2", cites: ["options.engine.level.callWall"] }, { id: "3", cites: ["options.engine.move.mad.2026-09-01"] }, { id: "4", cites: ["options.engine.move.event", "options.engine.iv.cm.30", "flow.net", "price.close"] }]));
  eq(ev.mark, { 1: "flip", 2: "walls", 3: "cone", 4: "event" }, "marks go to the first layer a claim evidences: flip, then event, gamma, walls, cone");
  eq(ev.by.volatility, ["4"], "the implied-volatility fact lights the Volatility card");
  eq(ev.by.flow, ["4"], "a flow fact lights the Flow card");
  eq(ev.by.range, ["4"], "a price fact lights the Range card");
  eq(ev.by.cone, ["3", "4"], "a move.mad fact and a constant-maturity IV fact light the cone");
  const cl = await page.evaluate(() => window.FlowsUI.tickerGlance.model.claims({ sections: { now: { cites: [{ id: "dossier:AAPL/options.engine.level.flip" }] }, drivers: [{ cites: [] }, { cites: ["x"] }], tensions: [], watch: [{ cites: [{ id: "a" }] }, { cites: [{ id: "b" }] }, { cites: [{ id: "c" }] }, { cites: [{ id: "d" }] }] } }));
  eq(cl.map((c) => c.id), ["1", "2", "3", "4"], "claims are numbered in reading order, now first, and capped at four");
  eq(cl[0].cites, ["options.engine.level.flip"], "a dossier prefix is stripped from a cite");
  await page.context().close();
}

const SHOTS = process.env.GLANCE_SHOTS || "/tmp/claude-0/glance-shots";
fs.mkdirSync(SHOTS, { recursive: true });
for (const [vp, chartW, pad, name] of [[{ width: 1440, height: 820 }, 868, 20, "1440x820"], [{ width: 1920, height: 1080 }, 1160, 20, "1920x1080"]]) {
  const page = await boot(vp, { chartW, pad, reading: READING });
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const c = r(".ftg-svg"), k = r(".ftg-cards-in"), lg = r(".ftg-lrow"); return { w: c.width, h: c.height, bottom: k.bottom, lbottom: lg.bottom, cols: getComputedStyle(document.querySelector(".ftg-cards-in")).gridTemplateColumns.split(" ").length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cardH: document.querySelector(".ftg-card").getBoundingClientRect().height, cardW: document.querySelector(".ftg-card").getBoundingClientRect().width }; });
  eq(m.cols, 6, `${name}: six cards across`);
  ok(m.sw <= m.cw, `${name}: no horizontal overflow`);
  if (name === "1440x820") {
    ok(m.w === 868 && m.h >= 330 && m.h <= 360, `${name}: the chart is ${m.w} by ${m.h}`);
    ok(m.bottom <= vp.height - 40, `${name}: chart, legend and the 200 px cards fit one screen under the header (cards end at ${Math.round(m.bottom)})`);
    ok(m.cardH === 200, `${name}: cards are 200 px`);
  } else {
    ok(m.w === 1160 && m.h > 440 && m.h <= 520, `${name}: the chart grows to ${m.w} by ${m.h}`);
    ok(m.bottom <= vp.height, `${name}: and still fits the screen with its cards (${Math.round(m.bottom)})`);
    ok(m.cardW > 280, `${name}: the cards grow wider (${m.cardW})`);
  }
  await page.screenshot({ path: path.join(SHOTS, `glance-${name}.png`) });
  eq(page.__errors, [], `${name}: no page error`);
  await page.context().close();
}

for (const [w, hgt, cw, name, touch] of [[390, 844, 330, "390x844", true], [320, 700, 260, "320x700", true]]) {
  const page = await boot({ width: w, height: hgt }, { chartW: 0, pad: (w - cw) / 2, reading: READING, touch });
  const m = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const c = r(".ftg-svg"); const tiles = [...document.querySelectorAll(".ftg-card")].map((n) => n.getBoundingClientRect()); return { w: c.width, h: c.height, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, tiles: tiles.map((t) => [t.width, t.height, Math.round(t.left)]), vis: [...document.querySelectorAll(".ftg-cb, .ftg-foot, .ftg-sub")].filter((n) => getComputedStyle(n).display !== "none").length, labels: document.querySelectorAll(".ftg-lt").length, marks: [...document.querySelectorAll(".ftg-mk-hit")].map((n) => n.getBoundingClientRect().width), flip: document.querySelectorAll(".ftg-lv-gamma_flip").length, fig: [...document.querySelectorAll(".ftg-f")].map((n) => n.textContent), titles: [...document.querySelectorAll(".ftg-ch h3")].map((n) => n.textContent) }; });
  ok(m.sw <= m.cw, `${name}: no horizontal overflow (${m.sw} against ${m.cw})`);
  if (w === 390) ok(Math.round(m.w) === 330 && Math.round(m.h) === 178, `${name}: the chart is 330 by 178 as in the phone design (${m.w} x ${m.h})`);
  else ok(m.w === cw && m.h > 130, `${name}: the chart fits its 260 px section (${m.w} x ${m.h})`);
  eq(m.tiles.length, 6, `${name}: six tiles`);
  ok(m.tiles.every((t) => t[1] === 68), `${name}: each tile is 68 px tall`);
  eq(new Set(m.tiles.map((t) => t[2])).size, 2, `${name}: in two columns`);
  eq(m.vis, 0, `${name}: tiles show a title, a figure and a unit only`);
  ok(m.marks.length === 2 && m.marks.every((x) => x >= 44), `${name}: the flip and report marks have 44 px touch targets; the gamma mark waits for a profile (${m.marks})`);
  eq(m.labels, 1, `${name}: no right-edge column on a phone: only the flip is labelled, inside the plot`);
  ok(m.flip >= 2, `${name}: the flip is drawn and labelled in the plot`);
  ok(m.fig.length === 6 && m.titles.join() === "Signal,Volatility,Flow,Positioning,Earnings,Range", `${name}: tiles carry the six titles`);
  if (w === 390) await page.screenshot({ path: path.join(SHOTS, `glance-${name}.png`), fullPage: true });
  eq(page.__errors, [], `${name}: no page error`);
  await page.context().close();
}

for (const [w, expectCols] of [[700, 2], [770, 3], [900, 6]]) {
  const page = await boot({ width: w + 40, height: 900 }, { chartW: 0, pad: 20 });
  const m = await page.evaluate(() => ({ cols: getComputedStyle(document.querySelector(".ftg-cards-in")).gridTemplateColumns.split(" ").length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.querySelector(".ftg-card").getBoundingClientRect().height, gamma: document.querySelectorAll(".ftg-gl").length }));
  eq(m.cols, expectCols, `${w}px container: ${expectCols} card columns`);
  ok(m.sw <= m.cw && m.h === 200, `${w}px container: full-width chart, no overflow, 200 px cards`);
  await page.context().close();
}

{
  const page = await boot({ width: 1440, height: 900 }, { chartW: 868, reduced: true, reading: READING });
  const m = await page.evaluate(() => ({ anim: document.getAnimations().length, td: getComputedStyle(document.querySelector(".ftg-card")).transitionDuration, cone: getComputedStyle(document.querySelector('[data-layer="cone"]')).transitionDuration }));
  eq(m.anim, 0, "reduced motion: nothing animates");
  eq(m.td, "0s", "reduced motion: no card transition");
  eq(m.cone, "0s", "reduced motion: no layer transition");
  await page.context().close();
}
{
  const page = await boot({ width: 1440, height: 900 }, { chartW: 868 });
  const td = await page.evaluate(() => getComputedStyle(document.querySelector(".ftg-card")).transitionDuration);
  eq(td, "0.2s", "with motion allowed a card steps back over 0.2 s");
  await page.context().close();
}

async function coreFailures(src) {
  const bad = [];
  const note = (c, m) => { if (!c) bad.push(m); };
  let page;
  try {
    page = await boot({ width: 1440, height: 900 }, { chartW: 868, src, reading: READING });
    const r = await page.evaluate(({ card, x }) => {
      const G = window.FlowsUI.tickerGlance, M = G.model, m = M(card, "1M", { cardX: x });
      const L = M.layout(m, 868, 344);
      const ys = L.labels.map((l) => l.y).sort((a, b) => a - b);
      const bare = M.cards({ ticker: "A", panels: {} }, {});
      const noScore = JSON.parse(JSON.stringify(card)); noScore.score = null; noScore.conviction = null;
      const cs = M.cards(noScore, { cardX: x });
      const neg = M.cards(card, { cardX: x })[0];
      return {
        h5: m.q.find((o) => o.h === 2), h14: m.q.find((o) => o.h === 6), pair: m.q.filter((o) => o.h === m.event.h), n: m.q.length, gap: ys.slice(1).map((y, i) => y - ys[i]),
        bars: L.bars.map((b) => [b.g, b.w]), mg: m.bars.map((b) => Math.abs(b.g)), sbars: L.score.bars.filter(Boolean).map((b) => [b.v, b.h]), k: L.score.k, gmax: L.profW,
        longs: [...document.querySelectorAll(".ftg-svg .ftg-gl")].length, shorts: [...document.querySelectorAll(".ftg-svg .ftg-gs")].length, signalTone: neg.fig.tone, signalFig: cs[0].fig.text, signalMissing: cs[0].missing, hist: m.hist.length,
        marksBare: 0, clusterOverlap: (() => { const ys2 = M.cluster([100, 101, 102, 103], 12, 0, 400).sort((a, b) => a - b); return Math.min(...ys2.slice(1).map((y, i) => y - ys2[i])); })(), bareFig: bare.map((c) => c.fig.text), bareFoot: bare.map((c) => c.foot),
        gammaClaims: document.querySelector('[data-layer="gamma"]').getAttribute("data-claims"), coneClaims: document.querySelector('[data-layer="cone"]').getAttribute("data-claims"), marks: document.querySelectorAll(".ftg-mk").length,
      };
    }, { card, x: X });
    note(Math.abs(Math.log(r.h14.up / S) / Math.log(r.h5.up / S) - Math.sqrt(6 / 2)) < 1e-9, "cone half-width is not the square root of time");
    note(r.pair.length === 2 && r.n === 23 && Math.abs(Math.log(r.pair[1].up / S) ** 2 - Math.log(r.pair[0].up / S) ** 2 - 0.042 ** 2) < 1e-9, "the report step is missing or the wrong size");
    note(r.clusterOverlap >= 12 - 1e-6 && r.gap.every((g) => g >= 12 - 1e-6), "level labels overlap");
    const gmax = Math.max(...r.mg);
    note(r.bars.every((b) => Math.abs(b[1] - Math.abs(b[0]) / gmax * r.gmax * 0.95) < 1e-9), "gamma bar widths are not proportional");
    note(r.sbars.every((b) => Math.abs(b[1] - Math.max(1, Math.abs(b[0]) * r.k)) < 1e-9), "score bar heights are not proportional");
    note(r.longs === r.bars.filter((b) => b[0] > 0).length && r.shorts === r.bars.filter((b) => b[0] < 0).length, "long and short gamma are swapped");
    note(r.signalTone === "down", "a negative score is not in the down tone");
    note(r.signalFig === "—" && r.signalMissing === true, "an absent score is not an em dash");
    note(r.bareFig.every((f) => f === "—"), "an empty card prints something other than dashes");
    note(r.bareFoot.every((f) => f.length > 10), "an empty card gives no reason in its footer");
    note(r.gammaClaims === "1" && r.coneClaims === "", "layers carry the wrong claims");
    await boot2(page, bad, note);
  } catch (e) {
    bad.push("threw: " + String(e).slice(0, 80));
  } finally {
    if (page) await page.context().close();
  }
  return bad;
}
async function boot2(page, bad, note) {
  const st = () => page.evaluate(() => ({ s: [...document.querySelectorAll("[data-ftg-state]")].length, hot: [...document.querySelectorAll('[data-ftg-state="hot"]')].map((n) => n.dataset.layer || n.dataset.card) }));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: "2", source: "claim" } })));
  const on = await st();
  note(on.hot.length > 0 && on.hot.every((k) => k === "flip" || k === "mark"), "a claim lights layers it does not evidence");
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id: null, source: "claim" } })));
  note((await st()).s === 0, "the dim is not restored on null");
  await page.evaluate(() => window.__g.update({ reading: null }));
  note(await page.evaluate(() => document.querySelectorAll(".ftg-mk").length) === 0, "marks are shown without a reading");
  const nopx = await page.evaluate(() => { window.__g.setRange("3M"); return (document.querySelector(".ftg-px").getAttribute("d").match(/,/g) || []).length; });
  note(nopx === 64, "the range control does not change the history length");
}

const MUTANTS = [
  ["cone linear in time", "const sUp = Math.sqrt(hh * b.dUp + (ev ? J * J : 0)), sDn = Math.sqrt(hh * b.dDn + (ev ? J * J : 0));", "const sUp = hh * Math.sqrt(b.dUp) * 1.2 + (ev ? J : 0), sDn = hh * Math.sqrt(b.dDn) * 1.2 + (ev ? J : 0);"],
  ["event step missing", "const tE = event ? event.h : null;", "const tE = null;"],
  ["labels overlapping", "if (a.top + a.n * gap > b.top + 1e-9) {", "if (false) {"],
  ["short and long gamma swapped", 'class: b.g > 0 ? "ftg-gl" : "ftg-gs"', 'class: b.g > 0 ? "ftg-gs" : "ftg-gl"'],
  ["wrong sign colour", 'const tone = (v) => (num(v) === null || v === 0 ? "flat" : v > 0 ? "up" : "down");', 'const tone = (v) => (num(v) === null || v === 0 ? "flat" : v > 0 ? "down" : "up");'],
  ["zero shown for an absent score", "fig: score === null ? fig(DASH) : fig(F.signed(score), tone(score))", "fig: fig(F.signed(score || 0), tone(score))"],
  ["marks shown without a reading", "st.claims = st.opts.reading || st.opts.claims ? claimsOf(st.opts.reading, st.opts.claims) : [];", 'st.claims = claimsOf(st.opts.reading, st.opts.claims || [{ id: "1", cites: ["options.engine.level.flip"] }]);'],
  ["dim not restored", 'if (id === null) n.removeAttribute("data-ftg-state");\n        else n.setAttribute', 'if (id !== null) n.setAttribute'],
  ["every layer lit by every claim", "by[k] = claims.filter((c) => c.cites.some((id) => EVIDENCE[k].test(id))).map((c) => c.id);", "by[k] = claims.map((c) => c.id);"],
  ["gamma widths not proportional", "w: Math.abs(b.g) / mx * profW * 0.95", "w: Math.sqrt(Math.abs(b.g) / mx) * profW * 0.95"],
  ["score bar height flat", "h: Math.max(1, Math.abs(r.v) * k), v: r.v", "h: 6, v: r.v"],
  ["range control ignored", 'const N = RANGES[range] || RANGES["1M"];', 'const N = RANGES["1M"];'],
  ["absent cards not dashed", "foot: score === null ? \"No score was published on this card.\"", "foot: score === null ? \"\""],
];
const baseline = await coreFailures(SRC);
eq(baseline, [], "the shipped module passes every core check");
for (const [why, from, to] of MUTANTS) {
  const src = SRC.replace(from, to);
  ok(src !== SRC, `the planted build "${why}" changes the module`);
  const bad = await coreFailures(src);
  ok(bad.length > 0, `the core checks fail the planted build "${why}" (${bad[0] || "nothing failed"})`);
}

await browser.close();
console.log(`flows-glance-render: ${checks} assertions - the ticker glance chart and six instrument cards`);
