import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import * as R from "../shared/flows-rotation.js";
import { rotationBody, rotationMode, rotationOpen, flowsRotationRows, ROTATION_ROW_CEILING } from "../server/routes/flows-rotation.js";
import { rotationSeries, rotationCard } from "./lib/rotation-fixture.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const HTML = PAGES.FLOWS_PAGES.rotationPage({ username: "test" });
const JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-rotation.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-rotation.css"), "utf8");
const MINUS = "−", DASH = "—";
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/;
const FORBID = /\b(buy|sell|will rise|will fall|tape|vendor)\b/i;

const cardsOf = (S) => new Map(Object.entries(S).map(([t, s]) => [t, rotationCard(s)]));
const SERIES = rotationSeries({ drift: { GLD: 0.002, COPX: -0.002 } });
const BODY = rotationBody(cardsOf(SERIES));
const SHORT = (() => { const S = rotationSeries(); S.SIL = { d: S.SIL.d.slice(-150), c: S.SIL.c.slice(-150) }; delete S.IAU; return rotationBody(cardsOf(S)); })();

{
  eq(BODY.status, "ok", "ROUTE BODY: twelve stored cards make a plane");
  eq(BODY.funds.length, 12, "of twelve funds");
  const P = R.plane(SERIES);
  for (const f of BODY.funds) {
    const g = P.funds.find((x) => x.t === f.t);
    for (const k of Object.keys(f.tails)) f.tails[k].forEach((pt, i) => {
      assert.ok(Math.abs(pt[0] - g.tails[k][i].x) <= 5.1e-5 && Math.abs(pt[1] - g.tails[k][i].y) <= 5.1e-5, "the route rounds the leaf's point to four places and no further");
    });
    checks++;
  }
  eq(SHORT.absent.map((a) => a.t).sort(), ["IAU", "SIL"], "a fund with no card and one with too few closes are set aside");
  eq(SHORT.absent.find((a) => a.t === "IAU").say, R.ROTATION_WHY.no_card, "each with the leaf's own sentence");
  ok(JSON.stringify(BODY).length < 40 * 1024, "the answer stays under 40 KiB");
  eq(ROTATION_ROW_CEILING, 12, "the route reads at most twelve rows");
  eq([rotationMode({}), rotationMode({ FLOWS_ROTATION: "on" }), rotationMode({ FLOWS_ROTATION: "ON " }), rotationMode({ FLOWS_ROTATION: "off" }), rotationMode({ FLOWS_ROTATION: "onn" })], ["owner", "on", "on", "off", "owner"], "SWITCH: unset or misspelt is owner only");
  ok(rotationOpen({ FLOWS_ROTATION: "on" }, false) && !rotationOpen({ FLOWS_ROTATION: "onn" }, false) && rotationOpen({}, true) && !rotationOpen({ FLOWS_ROTATION: "off" }, true), "and a member is admitted only by the exact word on");
  let trips = 0, asked = null;
  const store = { readMany: async (env, keys) => { trips++; asked = keys; return new Map(Object.entries(SERIES).map(([t, s]) => ["card:" + t, { payload: JSON.stringify(rotationCard(s)) }])); } };
  const [row] = flowsRotationRows({ store, isOwner: () => false });
  eq([row.path, row.methods, row.auth], ["/api/flows/rotation", ["GET"], "flows"], "ROUTE: one GET row behind the Flows session");
  const res = await row.handler({ env: { FLOWS_ROTATION: "on" }, ctx: null, session: { username: "m" } });
  eq(await res.json(), JSON.parse(JSON.stringify(BODY)), "the handler answers the plane of the stored cards");
  eq([trips, asked.length, asked[0]], [1, 12, "card:SPY"], "in one trip of twelve primary keys");
  let refused = null;
  try { await row.handler({ env: { FLOWS_ROTATION: "off" }, ctx: null, session: { username: "m" } }); } catch (e) { refused = e; }
  ok(refused && refused.status === 404 && trips === 1, "switched off it is a 404 before any read");
  let gone = null;
  try { await flowsRotationRows({ store: { readMany: async () => null } })[0].handler({ env: { FLOWS_ROTATION: "on" }, ctx: null, session: { username: "m" } }); } catch (e) { gone = e; }
  ok(gone && gone.status === 503, "an unreadable store is a 503, never an empty plane");
}

{
  const text = HTML.slice(HTML.indexOf('<div class="rt" id="rt">'), HTML.indexOf("</dialog>", HTML.indexOf('id="rtInfoDlg"'))).replace(/<[^>]+>/g, " ");
  eq((HTML.match(/<h1[ >]/g) || []).length, 1, "PAGE: one h1");
  ok(/<h1 id="fxTitle">Rotation<\/h1>/.test(HTML) && /data-flows-page="rotation"/.test(HTML), "the heading says Rotation and the page owns the one-screen hook");
  ok(/href="\/flows\/rotation\/"[^>]*aria-current="page"/.test(HTML), "the rail marks Rotation on its own page");
  ok(/href="\/flows\/rotation\/"/.test(PAGES.FLOWS_PAGES.marketPage({ username: "t" })), "and every other page links it");
  ok(/\/assets\/js\/flows-rotation\.js\?v=\d+/.test(HTML) && /\/assets\/css\/flows-rotation\.css\?v=\d+/.test(HTML), "script and sheet are versioned");
  ok(/data-lens="flows"[^>]*disabled[^>]*title="Flow history not stored yet"/.test(HTML), "the Flows lens is disabled with its reason");
  ok(!COLOUR.test(JS) && !COLOUR.test(CSS), "no colour literal in the script or the sheet");
  ok(!/\/\/ |\/\*/.test(JS) && !/\/\*/.test(CSS), "no comment in either");
  ok(!/localStorage|sessionStorage|innerHTML/.test(JS), "no browser storage and no innerHTML");
  ok(!FORBID.test(text) && !/\b(buy|sell|tape|vendor)\b/i.test(JS), "no advice, provider or banned word in the copy");
  ok(/^FLOWS_ROTATION = "on"$/m.test(fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8")), "the switch ships on");
  const c = {};
  vm.createContext(c);
  vm.runInContext(JS, c);
  const T = c.__RotationTest;
  eq([...T.QUADS], [...R.ROTATION_QUADRANTS], "the page's quadrant names are the leaf's");
  for (const [x, y] of [[1, 1], [1, -1], [-1, -1], [-1, 1], [0, 0], [0, -1], [-0.0001, 0]]) eq(T.quadOf([x, y]), R.quadOf({ x, y }), `the page's quadrant rule is the leaf's at ${x}, ${y}`);
  eq([T.signed(1.234), T.signed(-0.5), T.signed(0), T.signed(null), T.signed(NaN)], ["+1.23", MINUS + "0.50", "0.00", DASH, DASH], "figures carry a sign, the true minus, and a dash when absent");
}

const browser = await launch();
async function mount(w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", hasTouch: Boolean(o.touch) });
  const page = await ctx.newPage();
  const errors = [], asked = [];
  let hits = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-rotation.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      return fs.existsSync(f) ? r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" }) : r.fulfill({ status: 404, body: "" });
    }
    if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
    if (u.pathname === "/api/flows/rotation") {
      hits++;
      if (o.failOnce && hits === 1) return r.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return r.fulfill({ status: o.status || 200, contentType: "application/json", body: JSON.stringify(o.body || BODY) });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/flows/rotation/");
  await page.waitForSelector("#rt[data-ready]", { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors, asked };
}

const read = (page) => page.evaluate(() => {
  const svg = document.querySelector("#rtPlot svg");
  const num = (e, a) => Number(e.getAttribute(a));
  const ax = [...svg.querySelectorAll(".rt-ax")];
  const v = ax.find((l) => l.getAttribute("x1") === l.getAttribute("x2")), h = ax.find((l) => l.getAttribute("y1") === l.getAttribute("y2"));
  const ticksX = [...svg.querySelectorAll(".rt-tick[text-anchor=middle]")].map((t) => ({ x: num(t, "x"), s: t.textContent }));
  const ticksY = [...svg.querySelectorAll(".rt-tick[text-anchor=end]")].map((t) => ({ y: num(t, "y") - 4, s: t.textContent }));
  const dots = [...svg.querySelectorAll(".rt-dot")].map((g) => ({ t: g.dataset.t, q: g.dataset.q, robust: g.dataset.robust, x: num(g.firstChild, "cx"), y: num(g.firstChild, "cy"), label: g.getAttribute("aria-label"), fill: getComputedStyle(g.firstChild).fill }));
  const labs = [...svg.querySelectorAll(".rt-lab")].map((t) => { const b = t.getBBox(); return { t: t.dataset.t, x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; });
  const rows = [...document.querySelectorAll("#rtList button.rt-row")].map((b) => ({ t: b.dataset.t, cells: [...b.children].map((c) => c.textContent), pressed: b.getAttribute("aria-pressed") }));
  const abs = [...document.querySelectorAll("#rtList .rt-row.abs")].map((b) => b.textContent);
  return { x0: num(v, "x1"), y0: num(h, "y1"), ticksX, ticksY, dots, labs, rows, abs, tails: svg.querySelectorAll(".rt-tail").length,
    state: (document.getElementById("rtState") || {}).textContent || null, kv: [...document.querySelectorAll("#rtCard dd")].map((d) => d.textContent),
    card: (document.querySelector("#rtCard h2") || {}).textContent || null, stamp: document.getElementById("rtStamp").textContent, week: document.getElementById("rtWkT").textContent,
    status: document.getElementById("rtStatus").textContent, quads: [...svg.querySelectorAll(".rt-qn")].map((t) => t.textContent) };
});

const fits = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  const out = [];
  const vis = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  for (const panel of document.querySelectorAll(".rt-panel")) {
    if (!vis(panel)) continue;
    const pr = panel.getBoundingClientRect();
    if (pr.bottom > innerHeight + 0.5 || pr.right > innerWidth + 0.5) out.push("panel off screen: " + panel.id);
    for (const el of panel.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) out.push(panel.id + " clips " + (el.className.baseVal !== undefined ? el.className.baseVal : el.className) + " " + (el.textContent || "").slice(0, 20));
    }
  }
  return { v: se.scrollHeight <= innerHeight, h: se.scrollWidth <= innerWidth, out: out.slice(0, 6) };
});

const fmt = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "") + Math.abs(v).toFixed(2);
const scaleOf = (ticks, key) => {
  const pts = ticks.map((t) => ({ p: t[key], v: Number(t.s.replace(MINUS, "-").replace("+", "")) }));
  const a = pts[0], b = pts[pts.length - 1];
  return (v) => a.p + ((v - a.v) / (b.v - a.v)) * (b.p - a.p);
};

async function audit(page, body, norm, vel, week, label) {
  const d = await read(page);
  const X = scaleOf(d.ticksX, "x"), Y = scaleOf(d.ticksY, "y");
  ok(Math.abs(X(0) - d.x0) < 0.6 && Math.abs(Y(0) - d.y0) < 0.6, `${label}: the axes cross at zero on the ticks' own scale`);
  ok(Y(1) < Y(-1) && X(1) > X(-1), `${label}: a larger change is higher on the screen and a wider gap is further right`);
  const key = norm + "|" + vel;
  for (const f of body.funds) {
    const p = f.tails[key][week];
    const dot = d.dots.find((o) => o.t === f.t);
    assert.ok(dot, `${label}: ${f.t} is drawn`);
    assert.ok(Math.abs(dot.x - X(p[0])) < 0.75 && Math.abs(dot.y - Y(p[1])) < 0.75, `${label}: ${f.t} sits at its gap and change (${dot.x}, ${dot.y}) against (${X(p[0])}, ${Y(p[1])})`);
    const quads = body.conventions.map((c) => R.quadOf({ x: f.tails[c.norm + "|" + c.vel][week][0], y: f.tails[c.norm + "|" + c.vel][week][1] }));
    const robust = quads.every((q) => q === quads[0]);
    const q = R.quadOf({ x: p[0], y: p[1] });
    assert.equal(dot.q, String(q), `${label}: ${f.t} carries its quadrant`);
    assert.equal(dot.robust, robust ? "1" : "0", `${label}: ${f.t} is filled only when all six windows agree`);
    const row = d.rows.find((r) => r.t === f.t);
    assert.deepEqual(row.cells, [f.t, robust ? R.ROTATION_QUADRANTS[quads[0]] : "Window-dependent", fmt(p[0]), fmt(p[1])], `${label}: ${f.t}'s row prints its state, gap and change`);
    assert.ok(dot.label.includes(fmt(p[0])) && dot.label.includes(robust ? R.ROTATION_QUADRANTS[q] : "depends on the window"), `${label}: ${f.t}'s spoken label says the same`);
    checks += 5;
  }
  const order = d.rows.map((r) => Number(r.cells[2].replace(MINUS, "-")));
  ok(order.every((v, i) => i === 0 || v <= order[i - 1]), `${label}: the list runs from the widest gap above its norm down`);
  for (let i = 0; i < d.labs.length; i++) for (let j = i + 1; j < d.labs.length; j++) {
    const a = d.labs[i], b = d.labs[j];
    assert.ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), `${label}: labels ${a.t} and ${b.t} overlap`);
  }
  checks++;
  eq(d.quads, [...R.ROTATION_QUADRANTS], `${label}: the four corners carry the leaf's names`);
  return d;
}

{
  const m = await mount(1440, 820);
  eq(m.errors, [], "DESKTOP: no page error");
  eq(m.asked, ["/api/flows/rotation"], "one request, to the rotation route, and no other");
  const last = BODY.weeks.length - 1;
  const d = await audit(m.page, BODY, 126, 10, last, "default");
  ok(d.stamp.includes("Fri 6 Nov 2026") && d.stamp.includes("251 sessions") && d.stamp.includes("12 funds"), "the stamp names the last close, the sessions and the funds");
  eq(d.dots.length, 12, "twelve dots");
  eq(d.tails, 12, "each with its weekly path");
  const far = BODY.funds.slice().sort((a, b) => Math.abs(b.tails["126|10"][last][0]) - Math.abs(a.tails["126|10"][last][0]))[0];
  eq(d.card, far.t, "the fund farthest from its norm is selected at rest");
  const gld = BODY.funds.find((f) => f.t === d.card);
  eq(d.kv[0], fmt(gld.tails["126|10"][last][0]) + " log %", "the card prints its gap");
  eq(d.kv[3], gld.close.toFixed(2), "and its last stored close");
  const up = d.dots.find((o) => o.q === "0" && o.robust === "1"), hollow = d.dots.find((o) => o.robust === "0");
  ok(up && hollow && up.fill !== hollow.fill && /rgba?\(0, 0, 0, 0\)|transparent/.test(hollow.fill), "a window-dependent dot is hollow and an agreed one is filled");
  eq(await fits(m.page), { v: true, h: true, out: [] }, "no page scroll and nothing clipped at 1440x820");

  await m.page.click('#rtNorm button[data-v="63"]');
  await m.page.click('#rtVel button[data-v="21"]');
  await audit(m.page, BODY, 63, 21, last, "norm 63, velocity 21");
  eq(await m.page.getAttribute('#rtNorm button[data-v="63"]', "aria-pressed"), "true", "the pressed window is marked");
  await m.page.click("#rtPrev");
  await m.page.click("#rtPrev");
  const back = await audit(m.page, BODY, 63, 21, last - 2, "two weeks back");
  eq(back.week, "Fri 23 Oct 2026", "the week label is that week's last session");
  eq(back.tails, 12, "paths end at the chosen week");
  ok(await m.page.isDisabled("#rtNext") === false && await m.page.isDisabled('#rtLens button[data-lens="flows"]'), "the Flows lens cannot be pressed");
  await m.page.fill("#rtWeek", "0");
  await m.page.dispatchEvent("#rtWeek", "input");
  const first = await audit(m.page, BODY, 63, 21, 0, "first week");
  eq(first.tails, 0, "the first week has no path behind it");
  ok(await m.page.isDisabled("#rtPrev"), "and no earlier week to step to");

  await m.page.focus('.rt-dot[data-t="SPY"]');
  await m.page.keyboard.press("Enter");
  const sel = await read(m.page);
  eq([sel.card, sel.rows.find((r) => r.t === "SPY").pressed], ["SPY", "true"], "KEYBOARD: Enter on a dot selects its fund, in the card and the list");
  eq(await m.page.evaluate(() => document.activeElement.dataset.t), "SPY", "and focus stays on that dot");
  await m.page.click('#rtList button[data-t="COPX"]');
  eq((await read(m.page)).card, "COPX", "a list row selects too");
  eq(await m.page.getAttribute("#rtCard a.link", "href"), "/flows/ticker/?t=COPX", "the card links the fund's page");
  await m.page.click("#rtInfoBtn");
  ok(await m.page.evaluate(() => document.getElementById("rtInfoDlg").open && /states, not a forecast/.test(document.getElementById("rtInfoB").textContent)), "the info dialog opens and says what the page is not");
  await m.page.keyboard.press("Escape");
  await m.ctx.close();
}

for (const [w, h] of [[1024, 768], [390, 844], [320, 640]]) {
  const m = await mount(w, h, { touch: w < 500 });
  eq(m.errors, [], `${w}x${h}: no page error`);
  await audit(m.page, BODY, 126, 10, BODY.weeks.length - 1, `${w}x${h}`);
  eq(await fits(m.page), { v: true, h: true, out: [] }, `${w}x${h}: no page scroll and nothing clipped on the plane`);
  if (w < 900) {
    await m.page.click('#rtSeg3 button[data-v="funds"]');
    eq(await fits(m.page), { v: true, h: true, out: [] }, `${w}x${h}: the Funds panel fits`);
    await m.page.click('#rtList button[data-t="QQQ"]');
    eq(await m.page.getAttribute("#rtStage", "data-view"), "detail", "a tapped row opens Detail on a phone");
    eq(await fits(m.page), { v: true, h: true, out: [] }, `${w}x${h}: the Detail panel fits`);
    const small = await m.page.evaluate(() => [...document.querySelectorAll(".rt-seg3 button, .rt-seg button, .rt-step")].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 43.5)).length);
    eq(small, 0, "touch targets are 44 px tall");
  }
  await m.ctx.close();
}

{
  const m = await mount(1440, 820, { body: SHORT });
  const d = await read(m.page);
  eq(d.dots.length, 10, "ABSENT: ten funds drawn when two are set aside");
  ok(d.abs.length === 2 && d.abs.some((t) => t.includes("IAU") && t.includes(DASH) && t.includes(R.ROTATION_WHY.no_card)) && d.abs.some((t) => t.includes("SIL") && t.includes(R.ROTATION_WHY.short)), "each listed with a dash and its reason, never a zero");
  eq(await fits(m.page), { v: true, h: true, out: [] }, "and the list still fits");
  await m.ctx.close();
  const none = await mount(1440, 820, { body: { v: 1, status: "unavailable", why: "too_few", funds: [], absent: [], dates: [], weeks: [] } });
  ok(/Too few funds have stored closes/.test((await read0(none.page)).plot) && (await none.page.$$(".rt-dot")).length === 0, "UNAVAILABLE: too few funds says so and draws nothing");
  await none.ctx.close();
  const off = await mount(1440, 820, { status: 404 });
  ok(/switched off/.test((await read0(off.page)).plot), "OFF: a 404 says the page is switched off");
  await off.ctx.close();
  const fail = await mount(1440, 820, { failOnce: true });
  ok(/could not be read/.test((await read0(fail.page)).plot) && (await fail.page.$(".rt-retry")) !== null, "FAILED: a 503 says so and offers Retry");
  await fail.page.click(".rt-retry");
  await fail.page.waitForSelector('#rt[data-ready="ok"]');
  eq((await read(fail.page)).dots.length, 12, "and Retry draws the plane");
  await fail.ctx.close();
}

async function read0(page) { return page.evaluate(() => ({ plot: document.getElementById("rtPlot").textContent })); }

const MUTANTS = [
  ["wrong-convention-read", [['const key = () => S.norm + "|" + S.vel;', 'const key = () => S.norm + "|10";']]],
  ["y-axis-upside-down", [["((ry.max - v) / (2 * ry.max))", "((v + ry.max) / (2 * ry.max))"]]],
  ["robust-from-default", [["robust: quads[0] !== null && quads.every((q) => q === quads[0])", "robust: quads[0] !== null"]]],
  ["quadrant-swapped", [["(p[1] >= 0 ? 3 : 2)", "(p[1] >= 0 ? 2 : 3)"]]],
  ["week-ignored", [["const pointOf = (f) => f.tails[key()][S.week];", "const pointOf = (f) => f.tails[key()][f.tails[key()].length - 1];"]]],
  ["ascii-minus", [['const MINUS = "\u2212", DASH', 'const MINUS = "-", DASH']]],
  ["absent-as-zero", [['r.append(el("b", "", a.t), el("span", "q", DASH + " " + a.say));', 'r.append(el("b", "", a.t), el("span", "q", "0.00"));']]],
  ["list-unsorted", [["return (pb ? pb[0] : -Infinity) - (pa ? pa[0] : -Infinity);", "return 0;"]]],
  ["labels-pile-up", [["if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;", ""]]],
];
for (const [name, transforms] of MUTANTS) {
  let js = JS;
  for (const [a, b] of transforms) { assert.equal(js.split(a).length, 2, `mutant ${name} applies once`); js = js.replace(a, () => b); }
  let why = null;
  const m = await mount(1440, 820, { js, body: name === "absent-as-zero" ? SHORT : BODY });
  try {
    if (name === "absent-as-zero") {
      const d = await read(m.page);
      assert.ok(d.abs.every((t) => t.includes(DASH)), "an absent fund shows a dash");
    } else {
      await m.page.click('#rtNorm button[data-v="63"]');
      await m.page.click('#rtVel button[data-v="21"]');
      await m.page.click("#rtPrev");
      await audit(m.page, BODY, 63, 21, BODY.weeks.length - 2, name);
    }
  } catch (e) { why = String(e.message).slice(0, 110); }
  await m.ctx.close();
  console.log(`  planted ${name}: ${why || "NOT CAUGHT"}`);
  ok(why !== null, `THE PLANTED WRONG BUILD "${name}" FAILS`);
}

await browser.close();
console.log(`flows-rotation-render: ${checks} checks passed`);
