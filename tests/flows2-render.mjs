import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { bootUI } from "./lib/ui-boot.mjs";
import { nightlyEmit, emitRead } from "./lib/nightly-emit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const HTML = PAGES.FLOWS_PAGES.flows2Page({ username: "test" });
const JS = fs.readFileSync(path.join(ROOT, "assets/js/flows2.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows2.css"), "utf8");
const DASH = "—";
const KEYS = ["market", "pulse", "regime", "flowalerts", "movers", "brief", "news", "events"];
const F = bootUI().F;
const dir = nightlyEmit();
const EMIT = Object.fromEntries(KEYS.map((k) => [k, emitRead(dir, k)]));

{
  eq((HTML.match(/<h1[ >]/g) || []).length, 1, "PAGE: one h1");
  ok(/data-flows-page="flows2"/.test(HTML) && /<a href="\/flows\/2\/">Flows 2<\/a><a href="\/flows\/about\/">/.test(PAGES.FLOWS_PAGES.marketPage({ username: "t" })), "the page owns its hook and every page links it from the sidebar's footer row");
  ok(/\/assets\/js\/flows2\.js\?v=\d+/.test(HTML) && /\/assets\/css\/flows2\.css\?v=\d+/.test(HTML), "script and sheet are versioned");
  ok(!/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/.test(JS) && !/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/.test(CSS), "no colour literal in the script or the sheet");
  ok(!/\/\/ |\/\*/.test(JS) && !/\/\*/.test(CSS) && !/localStorage|sessionStorage|innerHTML/.test(JS), "no comment, no browser storage, no innerHTML");
  const copy = HTML.slice(HTML.indexOf('<div class="f2" id="f2">')).replace(/<[^>]+>/g, " ") + JS;
  ok(!/\b(tape|vendor|sample|forecast)\b/i.test(copy), "no banned word and no sample label on the live page");
  ok(/An alert is a short window of trading the feed flagged as unusual/.test(HTML), "the Alerts pane says what an alert is");
  ok(/^FLOWS_2 = "on"$/m.test(fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8")), "the switch ships on");
}

const browser = await launch();
async function mount(w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", hasTouch: w < 500, timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  const errors = [], asked = [], hits = {};
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows2.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      return fs.existsSync(f) ? r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" }) : r.fulfill({ status: 404, body: "" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const k = u.pathname.slice(11);
      if (KEYS.includes(k)) {
        asked.push(k);
        hits[k] = (hits[k] || 0) + 1;
        if (o.fail === k && hits[k] === 1) return r.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        const body = o.bodies && k in o.bodies ? o.bodies[k] : EMIT[k];
        return r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      }
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/flows/2/");
  await page.waitForSelector("#f2[data-ready]", { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors, asked };
}

const text = (page, id) => page.evaluate((i) => document.getElementById(i).textContent, id);
const rows = (page, id) => page.evaluate((i) => [...document.querySelectorAll("#" + i + " .f2-row")].map((r) => ({ cells: [...r.children].map((c) => c.textContent), href: r.getAttribute("href"), w: [...r.children].map((c) => c.scrollWidth <= c.clientWidth + 1) })), id);
const fits = (page) => page.evaluate(() => {
  const se = document.scrollingElement, out = [];
  const vis = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  for (const pane of document.querySelectorAll(".f2-pane")) {
    if (!vis(pane)) continue;
    const pr = pane.getBoundingClientRect();
    if (pr.bottom > innerHeight + 0.5 || pr.right > innerWidth + 0.5) out.push("pane off screen: " + pane.dataset.a);
    for (const el of pane.querySelectorAll("*")) {
      if (!vis(el) || el.closest("svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) out.push(pane.dataset.a + " clips " + el.className + " " + (el.textContent || "").slice(0, 24));
    }
  }
  return { v: se.scrollHeight <= innerHeight, h: se.scrollWidth <= innerWidth, out: out.slice(0, 6) };
});

async function audit(page, E, label) {
  const m = E.market, s = m.session;
  const hero = await text(page, "f2hero");
  assert.ok(hero.startsWith(F.money(s.total, false)), `${label}: the headline is the whole session's premium, ${F.money(s.total, false)}: ${hero.slice(0, 40)}`);
  assert.ok(hero.includes("Calls" + F.money(s.stocks.calls + s.funds.calls, false)) && hero.includes("Puts" + F.money(s.stocks.puts + s.funds.puts, false)), `${label}: calls and puts are the stock and fund parts added`);
  assert.ok(s.stocks.calls + s.stocks.puts + s.funds.calls + s.funds.puts === s.total, `${label}: and the parts foot to the headline`);
  assert.ok(hero.includes(F.money(m.premium.net, true)) && hero.includes(m.breadth.bull + " / " + m.breadth.bear), `${label}: net premium and the breadth count are the payload's`);
  const pts = E.pulse.tide.points.slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const last = pts[pts.length - 1];
  const tide = await text(page, "f2tide");
  assert.ok(tide.startsWith(F.money(last.callPrem - last.putPrem, true)), `${label}: the tide's figure is the last reading's calls less puts, not a sum of readings: ${tide.slice(0, 30)}`);
  assert.ok(tide.includes(F.time(Date.parse(last.t))) && / TRT/.test(tide), `${label}: stamped in TRT`);
  const geo = await page.evaluate(() => { const l = document.querySelector("#f2tide .f2-line"), z = document.querySelector("#f2tide .f2-zero"); return l ? { p: l.getAttribute("points").split(" ").map((x) => x.split(",").map(Number)), z: Number(z.getAttribute("y1")) } : null; });
  if (geo) {
    assert.equal(geo.p.length, pts.length, `${label}: one point per reading`);
    const v = pts.map((p) => p.callPrem - p.putPrem);
    const iMax = v.indexOf(Math.max(...v)), iMin = v.indexOf(Math.min(...v));
    assert.ok(geo.p[iMax][1] <= Math.min(...geo.p.map((q) => q[1])) + 0.11 && geo.p[iMin][1] >= Math.max(...geo.p.map((q) => q[1])) - 0.11, `${label}: the highest reading is drawn highest and the lowest lowest`);
    for (let i = 0; i < v.length; i++) assert.ok((v[i] >= 0) === (geo.p[i][1] <= geo.z + 0.11), `${label}: reading ${i} is on its side of the zero line`);
  }
  const sec = await rows(page, "f2map");
  const want = E.regime.sectors.rows.filter((r) => r.status === "ok" && typeof r.net === "number").sort((a, b) => b.net - a.net);
  assert.deepEqual(sec.map((r) => [r.cells[0], r.cells[2]]), want.map((r) => [r.sector, F.money(r.net, true)]), `${label}: sectors in order of net premium, each with its signed figure`);
  const al = await rows(page, "f2sig");
  const top = E.flowalerts.rows.filter((r) => r.prem > 0).sort((a, b) => b.prem - a.prem).slice(0, 7);
  assert.deepEqual(al.map((r) => [r.cells[0], r.cells[2], r.cells[3], r.href]), top.map((r) => [r.t, r.askPrem === null || r.bidPrem === null || r.askPrem === r.bidPrem ? "Unsided" : r.askPrem > r.bidPrem ? "Ask side" : "Bid side", F.money(r.prem, false), "/flows/ticker/?t=" + r.t]), `${label}: the seven largest alerts by premium, sided only where one side is larger`);
  const mv = await rows(page, "f2mov");
  assert.deepEqual(mv.map((r) => r.cells), [...E.movers.risers.slice(0, 5), ...E.movers.fallers.slice(0, 5)].map((r) => [r.t, F.pct(r.chg, 1, true)]), `${label}: five risers and five fallers with their change`);
  assert.ok(mv.every((r) => r.w.every(Boolean)), `${label}: no mover's ticker is cut short`);
  const br = await rows(page, "f2brief");
  assert.deepEqual(br.map((r) => r.cells[0]), E.brief.today.facts.slice(0, 5).map((f) => f.say), `${label}: the brief's sentences are the stored ones`);
  const nw = await rows(page, "f2news");
  assert.deepEqual(nw.map((r) => r.cells[0]), E.news.rows.slice(0, 5).map((r) => r.headline), `${label}: the first five headlines`);
  const nx = await rows(page, "f2next");
  const ev = E.events.rows.slice().sort((a, b) => (a.d === b.d ? (a.t < b.t ? -1 : 1) : a.d < b.d ? -1 : 1)).slice(0, 7);
  assert.deepEqual(nx.map((r) => r.cells), ev.map((r) => [r.t, F.day(r.d), r.im === null ? DASH : "±" + F.pct(r.im, 1)]), `${label}: the next reports by date, each with its implied move or a dash`);
  const vol = await text(page, "f2vol");
  assert.ok(vol.includes(F.pct(m.vol.iv30dMedian, 1)) && vol.includes(F.pct(m.vol.ivRankMedian, 0)) && vol.includes(m.vol.iv30dQuoted + " names quoted"), `${label}: the volatility medians and their coverage`);
  checks += 14;
}

{
  const m = await mount(1440, 820);
  eq(m.errors, [], "DESKTOP: no page error");
  eq(m.asked.slice().sort(), KEYS.slice().sort(), "eight requests, one per stored payload, and no other");
  await audit(m.page, EMIT, "1440");
  eq(await fits(m.page), { v: true, h: true, out: [] }, "no page scroll and nothing clipped at 1440x820");
  ok((await text(m.page, "f2Stamp")).includes(F.day(EMIT.market.sessionDate)), "the stamp names the session");
  await m.ctx.close();
}
for (const [w, h] of [[1024, 768], [390, 844], [320, 640]]) {
  const m = await mount(w, h);
  eq(m.errors, [], `${w}x${h}: no page error`);
  await audit(m.page, EMIT, `${w}x${h}`);
  for (const v of w < 900 ? ["a", "b", "c"] : ["a"]) {
    if (w < 900) await m.page.click(`#f2Seg button[data-v="${v}"]`);
    eq(await fits(m.page), { v: true, h: true, out: [] }, `${w}x${h} view ${v}: no page scroll and nothing clipped`);
  }
  await m.ctx.close();
}

{
  const none = { ...EMIT.market, session: { stocks: { calls: null, puts: null, n: null, of: null }, funds: null, total: null }, premium: { net: null }, breadth: {}, pcr: {}, vol: {} };
  const m = await mount(1440, 820, { bodies: { market: none, pulse: { status: "pending" }, flowalerts: { ...EMIT.flowalerts, rows: [] }, events: { ...EMIT.events, rows: EMIT.events.rows.slice(0, 3).map((r) => ({ ...r, im: null })) } } });
  const hero = await text(m.page, "f2hero");
  ok(hero.startsWith(DASH) && !/\$0|\b0 \/ 0\b/.test(hero), "ABSENT: a missing session total is a dash, never a zero: " + hero.slice(0, 60));
  ok(/Not published yet/.test(await text(m.page, "f2tide")), "a pending payload says so");
  ok(/No alert has been published/.test(await text(m.page, "f2sig")), "an empty alert list says so");
  ok((await rows(m.page, "f2next")).every((r) => r.cells[2] === DASH), "a report with no implied move shows a dash");
  ok((await text(m.page, "f2vol")).includes(DASH), "missing volatility medians are dashes");
  await m.ctx.close();
  const f = await mount(1440, 820, { fail: "movers" });
  ok(/could not be read/.test(await text(f.page, "f2mov")) && (await f.page.$("#f2mov .f2-retry")) !== null, "FAILED: one failed read marks its own pane and offers Retry");
  ok((await rows(f.page, "f2map")).length > 0, "while every other pane still draws");
  await f.page.click("#f2mov .f2-retry");
  await f.page.waitForSelector("#f2mov .f2-row");
  ok((await rows(f.page, "f2mov")).length === 10, "and Retry fills it");
  await f.ctx.close();
}

const MUTANTS = [
  ["tide-summed-again", [["    return out.sort((a, b) => a.at - b.at);", "    let run = 0;\n    return out.sort((a, b) => a.at - b.at).map((p) => ({ at: p.at, v: (run += p.v) }));"]]],
  ["tide-upside-down", [["((hi - v) / span)", "((v - lo) / span)"]]],
  ["stocks-only-headline-parts", [["const calls = fu ? sumOr(st.calls, fu.calls) : num(st.calls)", "const calls = num(st.calls)"]]],
  ["sectors-unsorted", [[".slice().sort((a, b) => b.net - a.net);", ";"]]],
  ["alerts-by-arrival", [[".slice().sort((a, b) => b.prem - a.prem).slice(0, n);", ".slice(0, n);"]]],
  ["equal-sides-called-ask", [["if (a === null || b === null || a === b) return \"Unsided\";", "if (a === null || b === null) return \"Unsided\";"]]],
  ["sign-dropped", [["num(v) === null ? DASH : F.money(v, Boolean(signed))", "num(v) === null ? DASH : F.money(v, false)"]]],
  ["events-by-ticker", [["(a.d === b.d ? (a.t < b.t ? -1 : 1) : a.d < b.d ? -1 : 1)", "(a.t < b.t ? -1 : 1)"]]],
];
const TIED = { ...EMIT, flowalerts: { ...EMIT.flowalerts, rows: EMIT.flowalerts.rows.map((r, i) => (i === EMIT.flowalerts.rows.indexOf(EMIT.flowalerts.rows.slice().sort((a, b) => b.prem - a.prem)[0]) ? { ...r, askPrem: 5, bidPrem: 5 } : r)).reverse() }, regime: { ...EMIT.regime, sectors: { ...EMIT.regime.sectors, rows: EMIT.regime.sectors.rows.slice().sort((x, y) => (x.sector < y.sector ? -1 : 1)) } } };
{
  const m = await mount(1440, 820, { bodies: { flowalerts: TIED.flowalerts, regime: TIED.regime } });
  await audit(m.page, TIED, "equal sides");
  await m.ctx.close();
}
for (const [name, transforms] of MUTANTS) {
  let js = JS;
  for (const [a, b] of transforms) { assert.equal(js.split(a).length, 2, `mutant ${name} applies once`); js = js.replace(a, () => b); }
  let why = null;
  const m = await mount(1440, 820, { js, bodies: { flowalerts: TIED.flowalerts, regime: TIED.regime } });
  try { await audit(m.page, TIED, name); } catch (e) { why = String(e.message).slice(0, 100); }
  await m.ctx.close();
  console.log(`  planted ${name}: ${why || "NOT CAUGHT"}`);
  ok(why !== null, `THE PLANTED WRONG BUILD "${name}" FAILS`);
}

await browser.close();
console.log(`flows2-render: ${checks} checks passed`);
