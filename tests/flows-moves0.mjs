import { showTab } from "./lib/market-fixtures.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as M from "../shared/flows-moves0.js";
import * as PAGES from "../shared/flows-pages.js";
import { targetFor } from "../shared/flows-targets.js";
import { revealBelow } from "./lib/below-fold.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, "utf8");

const SQRT252 = 15.874507866387544;

{
  near(M.ivDays(-0.031, 0.35), -0.031 * SQRT252 / 0.35, 1e-12, "the definition worked by hand: chg / (iv30p / sqrt(252))");
  near(M.ivDays(-0.031, 0.35), -1.4062, 5e-4, "chg -3.1% on iv30p 35% is -1.4062 IV-days");
  eq(M.signedIvDays(M.ivDays(-0.031, 0.35)), "−1.4", "and prints as minus 1.4");
  eq(M.signedIvDays(M.ivDays(0.0, 0.35)), "0.0", "a flat day prints 0.0 with no sign");
  eq(M.signedIvDays(M.ivDays(0.0231, 0.3)), "+1.2", "a positive move carries a plus");
  near(M.ivDays(0.01, 0.2) * 0.2 / SQRT252, 0.01, 1e-15, "the inverse recovers the change");
  eq(M.ivDays(-0.08, 0.4) < M.ivDays(-0.08, 0.55), true, "a lower prior IV makes the same move more extreme: -3.2 against -2.3");
  near(M.ivDays(-0.08, 0.4), -3.1749, 5e-4, "the plan's worked example: -8% on a 40-point IV is -3.2");
  near(M.ivDays(-0.08, 0.55), -2.3090, 5e-4, "and -2.3 on the post-move 55-point IV");
  eq(M.UNIT, "IV-days", "the unit is IV-days");
  ok(M.registered && targetFor(M.MOVE_ID) && targetFor(M.MOVE_ID).source === "sigma_q1", "the definition names the registered target move.im1.h1");
}

{
  for (const iv of [null, undefined, 0, -0.2, NaN, Infinity, "0.35", {}]) eq(M.ivDays(-0.03, iv), null, `iv30p ${String(iv)} gives no value, never zero`);
  for (const c of [null, undefined, NaN, Infinity, "0.01"]) eq(M.ivDays(c, 0.3), null, `chg ${String(c)} gives no value, never zero`);
  eq(M.moveOf({ t: "AAA", chg: -0.05, iv30p: null }), null, "a name with iv30p null has no move");
  eq(M.moveOf({ t: "AAA", chg: -0.05, iv30p: 0 }), null, "a name with iv30p zero has no move");
  eq(M.moveOf({ t: "AAA", chg: -0.05, iv30p: -1 }), null, "a name with iv30p negative has no move");
  eq(M.moveOf({ t: "", chg: -0.05, iv30p: 0.3 }), null, "a row with no ticker has no move");
  eq(M.moveOf(null), null, "and a null row has none");
  const rows = [
    { t: "NOIV", chg: -0.2, iv30p: null }, { t: "ZERO", chg: 0.3, iv30p: 0 }, { t: "NEG", chg: 0.3, iv30p: -0.4 },
    { t: "OK", chg: 0.03, iv30p: 0.3 },
  ];
  const up = M.rankMoves(rows, "up");
  deep(up.clean.map((x) => x.t), ["OK"], "a name with iv30p null or not positive is absent from the list");
  deep(M.rankMoves(rows, "down").clean.map((x) => x.t), [], "and from the other side");
  const ctx = M.context(rows);
  eq(ctx.ranked, 1, "and from the context population");
}

{
  const rows = [
    { t: "A", chg: -0.08, iv30p: 0.4, iv30: 0.56, im: 0.9, ed: 40 },
    { t: "C", chg: -0.04, iv30p: 0.23, iv30: 0.23, im: 0.05, ed: 40 },
    { t: "D", chg: -0.01, iv30p: 0.3, iv30: 0.3, im: 0.02, ed: 40 },
  ];
  const prior = M.rankMoves(rows, "down").clean.map((x) => x.t);
  deep(prior, ["A", "C", "D"], "THE TIMING FIXTURE: the name whose IV rose 40% after the move ranks on the IV struck at the previous close");
  const wrongCurrent = rows.map((r) => ({ t: r.t, m: M.ivDays(r.chg, r.iv30) })).sort((a, b) => a.m - b.m).map((x) => x.t);
  deep(wrongCurrent, ["C", "A", "D"], "and a build that divides by the current IV ranks it second, so the fixture has teeth");
  near(M.moveOf(rows[0]).m, -3.1749, 5e-4, "its value is the prior-close one");
  const impliedMove = rows.map((r) => ({ t: r.t, m: r.chg / r.im })).sort((a, b) => a.m - b.m).map((x) => x.t);
  ok(impliedMove.join() !== prior.join(), "a build that used implied_move_perc as the unit orders them differently, so the fixture catches it");
  const twin = rows.map((r) => ({ ...r, im: 123 }));
  deep(M.rankMoves(twin, "down").clean.map((x) => x.m), M.rankMoves(rows, "down").clean.map((x) => x.m), "the vendor's implied move changes nothing");
  deep(M.rankMoves(rows.map((r) => ({ ...r, iv30: 9 })), "down").clean.map((x) => x.m), M.rankMoves(rows, "down").clean.map((x) => x.m), "and neither does the current IV");
  const src = read("shared/flows-moves0.js");
  ok(!/implied_move|\.im\b|\biv30\b(?!p)/.test(src), "the module never reads the implied move or a current IV");
}

{
  const rows = [
    { t: "CLEAN1", chg: 0.01, iv30p: 0.3, ed: 22 },
    { t: "CLEAN2", chg: 0.002, iv30p: 0.3, ed: null },
    { t: "EDGE", chg: 0.09, iv30p: 0.3, ed: 21 },
    { t: "TODAY", chg: 0.2, iv30p: 0.3, ed: 0 },
    { t: "NEXT", chg: 0.5, iv30p: 0.3, ed: 1 },
  ];
  const up = M.rankMoves(rows, "up");
  deep(up.clean.map((x) => x.t), ["CLEAN1", "CLEAN2"], "a name with ed 21 or fewer is never in the clean list, whatever its size");
  deep(up.apart.map((x) => x.t), ["NEXT", "TODAY", "EDGE"], "it is ranked apart, by its own size");
  eq(M.eventInside(21), true, "ed 21 is inside the window");
  eq(M.eventInside(22), false, "ed 22 is not");
  eq(M.eventInside(null), false, "an unknown ed is not treated as an event");
  eq(M.moveOf(rows[2]).grade, 0, "an event name is grade 0");
  eq(M.moveOf(rows[0]).grade, 1, "a clean name is grade 1");
  const ctx = M.context(rows);
  eq(ctx.apart, 3, "the context counts the names set apart");
  eq(ctx.ranked, 2, "and ranks only the clean names");
}

{
  const rows = [
    { t: "P", chg: 0.1, iv30p: 0.3 },
    { t: "Q", chg: -0.02, iv30p: 0.2 },
    { t: "R", chg: 0.001, iv30p: 0.25 },
    { t: "S", chg: 0.06, iv30p: 0.18 },
  ];
  const ms = rows.map((r) => Math.abs(r.chg * SQRT252 / r.iv30p)).sort((a, b) => a - b);
  const want = (ms[1] + ms[2]) / 2;
  const ctx = M.context(rows);
  near(ctx.median, want, 1e-12, "the median |m| is the median of the prior-close IV-days");
  eq(ctx.beyond, 2, "and the names beyond 3 are counted strictly");
  eq(M.context([{ t: "X", chg: 3 * 0.3 / SQRT252, iv30p: 0.3 }]).beyond, 0, "a move of exactly 3 is not beyond 3");
  const wrong = rows.map((r) => Math.abs(r.chg * SQRT252 / (r.iv30p * 1.4))).sort((a, b) => a - b);
  ok(Math.abs((wrong[1] + wrong[2]) / 2 - ctx.median) > 0.1, "a median on a current IV 40% higher differs, so the fixture has teeth");
  eq(M.contextLine(ctx), `Median |m| ${want.toFixed(1)} IV-days; 2 of 4 beyond 3.`, "the line reads as the plan words it");
  eq(M.contextLine(M.context([])), null, "an empty population prints no line");
  eq(M.median([]), null, "an empty median is null");
  eq(M.median([3, 1, 2]), 2, "an odd median");
  eq(M.median([4, 1, 2, 3]), 2.5, "an even median");
}

{
  const rows = [
    { t: "U1", chg: 0.01, iv30p: 0.3 }, { t: "U2", chg: 0.04, iv30p: 0.3 }, { t: "U3", chg: 0.04, iv30p: 0.3 },
    { t: "D1", chg: -0.03, iv30p: 0.3 }, { t: "D2", chg: -0.05, iv30p: 0.3 }, { t: "Z", chg: 0, iv30p: 0.3 },
  ];
  deep(M.rankMoves(rows, "up").clean.map((x) => x.t), ["U2", "U3", "U1"], "risers run largest first and ties break by ticker");
  deep(M.rankMoves(rows, "down").clean.map((x) => x.t), ["D2", "D1"], "fallers run most negative first");
  ok(!M.rankMoves(rows, "up").clean.some((x) => x.t === "Z") && !M.rankMoves(rows, "down").clean.some((x) => x.t === "Z"), "a flat name is on neither list");
  deep(M.rankMoves(null, "up"), { clean: [], apart: [] }, "no rows rank to empty lists");
}

{
  const forbidden = new RegExp("\\b(?:" + M.FORBIDDEN_WORDS.join("|") + ")\\w*", "i");
  const lines = [...M.HEADER_SENTENCES, M.contextLine({ median: 0.6, beyond: 14, ranked: 640 })];
  for (const s of lines) {
    ok(M.wordCount(s) <= M.HEADER_WORDS_MAX, `"${s}" has ${M.wordCount(s)} words, at most ${M.HEADER_WORDS_MAX}`);
    ok(!forbidden.test(s), `"${s}" uses none of unusual, alert, screen or rare`);
  }
  eq(M.LINE, "A ranking, not a test: no error rate measured.", "the one line of copy is the plan's");
  eq(M.CAPTION, "IV as of the previous close.", "and the caption names the IV used");
  ok(forbidden.test("a rare move") && forbidden.test("Unusual") && forbidden.test("screened") && forbidden.test("alerts"), "the lint catches each forbidden word and its forms");
  deep(M.FORBIDDEN_WORDS.slice().sort(), ["alert", "rare", "screen", "unusual"], "the forbidden list is the plan's four");
}

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const TUE_1330 = Date.parse("2026-09-29T13:30:00-04:00");
const RTH = { phase: "rth", session: "2026-09-29", trading: true, lastClosed: "2026-09-28", endsAt: "2026-09-29T20:00:00.000Z" };
const iso = (ms) => new Date(ms).toISOString();
let NOW = TUE_1330;

const stamp = () => ({ readAt: iso(NOW - 60000), session: "2026-09-29", cadenceS: 900, liveUntil: iso(NOW + 1140000), staleAt: iso(NOW + 2640000), source: "actions", updatedAt: 1 });
const entry = (payload, upd = 1) => (payload ? { status: "ok", payload, updatedAt: upd, fresh: { state: "live", reason: "cadence", klass: "breadth", ...stamp(), updatedAt: upd } } : { status: "pending" });

async function mount(page, { html, url, answer }) {
  const asked = [];
  page._asked = asked;
  NOW = TUE_1330;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = decodeURIComponent(u.pathname.slice("/api/flows/".length) + u.search);
      asked.push(key);
      const a = answer(key, u) || { body: { status: "pending" } };
      return route.fulfill({ status: a.status || 200, contentType: "application/json", headers: { "X-Server-Now": String(NOW), ...(a.headers || {}) }, body: JSON.stringify(a.body) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  page._inflight = 0;
  const done = (r) => { if (/\/api\/flows\//.test(r.url())) page._inflight--; };
  page.on("request", (r) => { if (/\/api\/flows\//.test(r.url())) page._inflight++; });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  await page.clock.install({ time: new Date(TUE_1330) });
  await page.goto("https://example.test" + url);
  if (/flows\/market/.test(url)) await page.click("#mkT-extremes");
  await settle(page);
}

const settle = async (page) => {
  await page.waitForTimeout(150);
  for (let i = 0; i < 200 && page._inflight > 0; i++) await page.waitForTimeout(50);
  await page.waitForTimeout(150);
};
const tick = async (page, ms) => { NOW += ms; await page.clock.runFor(ms); await settle(page); };

const FIELDS = ["px", "prev", "chg", "iv30", "iv30p", "im"];
const ROSTER = [
  { t: "AAA", chg: -0.08, iv30: 0.56, iv30p: 0.4, im: 0.9, ed: 40 },
  { t: "CCC", chg: -0.04, iv30: 0.23, iv30p: 0.23, im: 0.05, ed: 40 },
  { t: "DDD", chg: -0.01, iv30: 0.3, iv30p: 0.3, im: 0.02, ed: null },
  { t: "UUU", chg: 0.05, iv30: 0.25, iv30p: 0.25, im: 0.4, ed: 30 },
  { t: "VVV", chg: 0.02, iv30: 0.3, iv30p: 0.3, im: 0.9, ed: 40 },
  { t: "NOIV", chg: 0.09, iv30: 0.3, iv30p: null, im: 0.01, ed: 40 },
  { t: "ZERO", chg: -0.05, iv30: 0.3, iv30p: 0, im: 0.01, ed: 40 },
  { t: "EVT", chg: -0.2, iv30: 0.6, iv30p: 0.3, im: 0.5, ed: 5 },
];
const stripsOf = (rows, session = "2026-09-29") => ({
  v: 1, key: "live:strips", status: "ok", session, fields: FIELDS,
  rows: Object.fromEntries(rows.map((r) => [r.t, [100, 100 / (1 + r.chg), r.chg, r.iv30, r.iv30p, r.im]])),
  fresh: { readAt: iso(NOW - 60000), session, cadenceS: 900, source: "actions", writer: "flows-live" },
});
const universeOf = (rows, { day = "2026-09-28", iv = false } = {}) => ({
  status: "ok", v: 1, sessionDate: day, generatedAt: iso(TUE_1330 - 20 * 3600000), n: rows.length, screened: rows.length,
  t: rows.map((r) => r.t),
  cols: { chg: rows.map((r) => Math.round(r.chg * 1e4)), ed: rows.map((r) => r.ed), ...(iv ? { iv30p: rows.map((r) => (r.iv30p === null || r.iv30p === undefined ? null : Math.round(r.iv30p * 1e3))) } : {}) },
  units: { chg: ["fraction", 1e4], ed: ["sessions", 1], ...(iv ? { iv30p: ["vol", 1e3] } : {}) },
});
const MOVERS = {
  status: "ok", sessionDate: "2026-09-28", universe: 600, ranked: 590, priced: 500, unrankedChange: 10, unrankedPremium: 100,
  risers: [{ t: "RAWUP", chg: 0.2 }, { t: "RAWUP2", chg: 0.1 }], fallers: [{ t: "RAWDN", chg: -0.2 }],
  premium: { bullish: [{ t: "CALL", netPrem: 5e6 }], bearish: [{ t: "PUT", netPrem: -5e6 }] },
};

const NUM = (t) => t.replace(/−/g, "-");
const forbidden = new RegExp("\\b(?:" + M.FORBIDDEN_WORDS.join("|") + ")", "i");

const marketAnswer = (state) => (key) => {
  if (key.startsWith("movers")) return { body: MOVERS };
  if (key === "universe") return { body: universeOf(state.universe || ROSTER, state.uniOpts || {}) };
  if (key.startsWith("lk?k=")) {
    const ks = key.slice(5).split(",");
    if (ks.length === 1) return ks[0] === "strips" && state.strips ? { body: state.strips } : null;
    return { body: { serverNow: NOW, phase: RTH, keys: Object.fromEntries(ks.map((k) => [k, k === "strips" && state.strips ? entry(state.strips, state.upd) : entry(null)])) } };
  }
  if (key.startsWith("now")) return { body: { serverNow: NOW, expected: "2026-09-28", phase: RTH, keys: { "live:strips": { state: "live", reason: "cadence", klass: "breadth", ...stamp(), updatedAt: state.upd } } } };
  return null;
};

const readLists = (page) => page.evaluate(() => {
  const cols = [...document.querySelectorAll("#mktMovers .mk-movers-col")];
  const one = (c) => ({
    head: (c.querySelector(".mk-movers-h") || {}).textContent,
    clean: [...c.querySelectorAll(":scope > ul.mk-movers:not(.is-apart) li")].map((li) => [li.querySelector(".mk-mv-t").textContent, li.querySelector(".mk-mv-v").textContent]),
    apart: [...c.querySelectorAll(":scope > ul.is-apart li")].map((li) => [li.querySelector(".mk-mv-t").textContent, li.querySelector(".mk-mv-v").textContent]),
    apartCaption: (c.querySelector(".mk-apart") || {}).textContent || null,
  });
  const seg = [...document.querySelectorAll("#mktMovers .mk-lens .ui-seg-i")].map((b) => [b.textContent, b.getAttribute("aria-selected")]);
  const notes = [...document.querySelectorAll("#mktMovers .mk-lens-note p")].map((p) => p.textContent);
  return { cols: cols.map(one), seg, notes, text: document.getElementById("mktMovers").textContent };
});

const expectedLists = (rows) => {
  const moves = rows.map((r) => ({ t: r.t, chg: r.chg, iv30p: r.iv30p, ed: r.ed }));
  return { up: M.rankMoves(moves, "up"), down: M.rankMoves(moves, "down"), ctx: M.contextLine(M.context(moves)) };
};
const shape = (x) => x.map((m) => [m.t, NUM(M.signedIvDays(m.m))]);

const browser = revealBelow(await chromium.launch());
try {
  {
    const state = { strips: stripsOf(ROSTER), upd: 1 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    const want = expectedLists(ROSTER);
    deep(got.seg, [["Raw change", "false"], ["In IV-days", "true"]], "THE OWNER'S ACCOUNT OPENS ON IV-DAYS");
    deep(got.cols[0].clean.map((r) => [r[0], NUM(r[1])]), shape(want.up.clean), "Risers are the roster's rows ranked by the move against the prior-close IV");
    deep(got.cols[1].clean.map((r) => [r[0], NUM(r[1])]), shape(want.down.clean), "Fallers likewise, in the leaf's order and to the leaf's digit");
    deep(got.cols[1].clean.map((r) => r[0]), ["AAA", "CCC", "DDD"], "THE TIMING FIXTURE ON THE PAGE: the name whose IV rose 40% after the move ranks first, on the IV struck at the previous close");
    deep(got.cols[0].clean.map((r) => r[0]), ["UUU", "VVV"], "Risers: only names with a prior-close IV");
    ok(![...got.cols[0].clean, ...got.cols[1].clean, ...got.cols[0].apart, ...got.cols[1].apart].some((r) => ["NOIV", "ZERO"].includes(r[0])), "a name with iv30p null or zero is on no list, never a zero (NOIV, the largest raw riser, is absent)");
    deep(got.cols[1].apart.map((r) => r[0]), ["EVT"], "a name with earnings inside 30 days is ranked apart");
    ok(!got.cols[1].clean.some((r) => r[0] === "EVT"), "and never beside the clean names");
    eq(got.cols[1].apartCaption, M.APART, "under the caption that says why");
    eq(got.notes[0], want.ctx, "THE MEDIAN LINE is computed on the prior-close IV, by the leaf's arithmetic");
    eq(got.notes[1], "Live roster, session 2026-09-29: 6 names.", "the source and the population are named");
    eq(got.notes[2], M.CAPTION + " " + M.LINE, "and the caption names the IV and the line says it is a ranking, not a test");
    eq(got.notes[3], M.GRADE_NOTE, "and the grade is said once: the IV is the 30-day IV, with no surface");
    ok(page._asked.some((k) => /^now\?.*strips/.test(k)), "the owner's heartbeat reads the live rows from the first beat");
    for (const n of got.notes) ok(!forbidden.test(n), `"${n}" uses none of the forbidden words`);
    ok(M.wordCount(got.notes[0]) <= M.HEADER_WORDS_MAX, "and the context line is within 14 words");
    ok(!forbidden.test(got.text.replace(/screened/g, "")), "the module's text uses none of unusual, alert, screen or rare");
    ok(!/RAWUP|RAWDN/.test(got.cols[0].clean.concat(got.cols[1].clean).flat().join(" ")), "no raw-change name leaks into the IV-days lists");
    ok(got.cols[2].head.includes("Calls") && got.cols[3].head.includes("Puts"), "Calls and Puts are untouched");

await showTab(page, "#mktMovers");
    await page.click("#mktMovers .mk-lens .ui-seg-i:nth-child(2)");
    await page.waitForFunction(() => !document.querySelector("#mktMovers li[data-t]"), null, { timeout: 15000 });
    await settle(page);
    const raw = await readLists(page);
    deep(raw.seg, [["Raw change", "true"], ["In IV-days", "false"]], "the switch goes back to raw change");
    const rawNames = await page.evaluate(() => [...document.querySelectorAll("#mktMovers .mk-movers-col")].map((c) => [...c.querySelectorAll("li .mk-mv-t")].map((n) => n.textContent)));
    deep(rawNames.slice(0, 2), [["RAWUP", "RAWUP2"], ["RAWDN"]], "MARKET'S EXTREMES KEEPS ITS RAW LISTS when the lens is off");
    eq(raw.notes.length, 0, "and prints none of the IV-days copy");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }

  {
    const state = { strips: stripsOf(ROSTER), upd: 1 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "member", owner: false }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    deep(got.seg, [["Raw change", "true"], ["In IV-days", "false"]], "MEMBERS OPEN ON RAW CHANGE");
    ok(!page._asked.some((k) => /^lk\?k=.*strips/.test(k)), "and the live rows are not fetched for a lens nobody asked for");
    ok(page._asked.some((k) => /^now\?/.test(k)) && !page._asked.some((k) => /^now\?.*strips/.test(k)), "THE HEARTBEAT OF A MEMBER WITH THE LENS OFF does not read live:strips, so that key cannot move the pill of a page that does not use it");
await showTab(page, "#mktMovers");
    await page.click("#mktMovers .mk-lens .ui-seg-i:nth-child(3)");
    await page.waitForSelector("#mktMovers li[data-t]", { timeout: 15000 });
    await settle(page);
    ok(page._asked.some((k) => /^now\?.*strips/.test(k)), "and choosing IV-days adds it to the heartbeat");
    const on = await readLists(page);
    ok(page._asked.some((k) => k === "lk?k=strips"), "choosing IV-days reads the live rows once");
    deep(on.cols[1].clean.map((r) => r[0]), ["AAA", "CCC", "DDD"], "and ranks them");
    await page.close();
  }

  {
    const state = { strips: stripsOf(ROSTER), upd: 1 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const order = async () => (await readLists(page)).cols[1].clean.map((r) => r[0]);
    deep(await order(), ["AAA", "CCC", "DDD"], "before the update");
    const moved = ROSTER.map((r) => (r.t === "DDD" ? { ...r, chg: -0.3 } : r));
    state.strips = stripsOf(moved);
    state.upd = 2;
    await page.hover("#mktMovers .mk-movers-col:nth-child(2) li");
    await tick(page, 31000);
    ok(page._asked.filter((k) => k === "lk?k=strips").length >= 1, "the heartbeat reads the changed live rows");
    deep(await order(), ["AAA", "CCC", "DDD"], "THE ORDER IS HELD while the pointer is on the list, though DDD now leads");
    await page.mouse.move(2, 2);
    await settle(page);
    deep(await order(), ["DDD", "AAA", "CCC"], "and it moves when the pointer leaves");
    await page.close();
  }

  {
    const state = { strips: null, upd: 1, uniOpts: { iv: false } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    await tick(page, 5000);
    const got = await readLists(page);
    eq(page._asked.filter((k) => /^lk\?k=.*strips/.test(k) && !k.includes("market")).length, 1, "WITH THE LIVE ROWS PENDING the lens asks for them once and does not loop on the answer");
    ok(got.cols[0].clean.length === 0 && got.cols[1].clean.length === 0, "and ranks nothing");
    eq(await page.evaluate(() => document.querySelectorAll("#mktMovers .mk-movers-col")[0].querySelectorAll(".ui-silent").length), 1, "saying so in place of the list, not a zero");
    await page.close();
  }

  {
    const EDGE = [
      { t: "E21", chg: -0.1, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 21 },
      { t: "E22", chg: -0.09, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 22 },
      { t: "E0", chg: -0.08, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 0 },
      { t: "U21", chg: 0.1, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 21 },
      { t: "U22", chg: 0.09, iv30: 0.3, iv30p: 0.3, im: 0.1, ed: 22 },
    ];
    const state = { strips: stripsOf(EDGE), upd: 1, universe: EDGE };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    deep(got.cols[1].clean.map((r) => r[0]), ["E22"], "A NAME 22 SESSIONS FROM EARNINGS is among the clean names");
    deep(got.cols[1].apart.map((r) => r[0]), ["E21", "E0"], "and one 21 sessions from them is ranked apart, as is one reporting today");
    deep(got.cols[0].clean.map((r) => r[0]), ["U22"], "on the risers' side likewise");
    deep(got.cols[0].apart.map((r) => r[0]), ["U21"], "ed 21 never ranks beside the clean names");
    await page.close();
  }

  {
    const TAIL = [
      { t: "TA1", chg: -0.15, iv30p: 0.3, ed: 30 }, { t: "TA2", chg: 0.12, iv30p: 0.28, ed: null }, { t: "TA3", chg: -0.02, iv30p: 0.35, ed: 60 },
      { t: "TA4", chg: 0.3, iv30p: 0.45, ed: 3 }, { t: "TA5", chg: 0.07, iv30p: null, ed: 50 },
    ];
    const ALL = ROSTER.concat(TAIL);
    const state = { strips: stripsOf(ROSTER, "2026-09-29"), upd: 1, universe: ALL, uniOpts: { day: "2026-09-29", iv: true } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    const want = expectedLists(ALL);
    deep(got.cols[1].clean.map((r) => r[0]), want.down.clean.map((m) => m.t).slice(0, 8), "AFTER THE NIGHTLY LANDS the lens ranks the whole universe, names outside the roster included");
    ok(got.cols[1].clean.some((r) => r[0] === "TA1") && got.cols[0].clean.some((r) => r[0] === "TA2"), "TA1 and TA2 are not roster names and rank");
    deep(got.cols[0].apart.map((r) => r[0]), ["TA4"], "a tail name with earnings in 3 sessions is ranked apart");
    ok(![...got.cols[0].clean, ...got.cols[1].clean].some((r) => r[0] === "TA5"), "and one with no prior-close IV is absent");
    eq(got.notes[0], want.ctx, "the median line is over the whole population, on the prior-close IV");
    eq(got.notes[1], "Nightly, session 2026-09-29: " + (ALL.length - 3) + " names.", "and names its source and population");
    await page.close();
  }

  {
    const TAIL = [{ t: "TA1", chg: -0.15, iv30p: 0.3, ed: 30 }];
    const state = { strips: stripsOf(ROSTER, "2026-09-29"), upd: 1, universe: ROSTER.concat(TAIL), uniOpts: { day: "2026-09-28", iv: true } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    const got = await readLists(page);
    ok(!got.cols[1].clean.some((r) => r[0] === "TA1"), "DURING THE SESSION yesterday's tail is never ranked beside today's roster");
    eq(got.notes[1], "Live roster, session 2026-09-29: " + (ROSTER.length - 2) + " names.", "the live rows are ranked alone and the source is named");
    await page.close();
  }

  {
    const state = { strips: null, upd: 1, universe: ROSTER, uniOpts: { day: "2026-09-28", iv: true } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, { html: PAGES.marketPage({ username: "test", owner: true }), url: "/flows/market/", answer: marketAnswer(state) });
    await tick(page, 5000);
    const got = await readLists(page);
    deep(got.cols[1].clean.map((r) => r[0]), ["AAA", "CCC", "DDD"], "WITH THE LIVE ROWS UNAVAILABLE the nightly's rows are ranked and say so");
    eq(got.notes[1], "Nightly, session 2026-09-28: " + (ROSTER.length - 2) + " names.", "under the nightly's session");
    eq(page._asked.filter((k) => k === "lk?k=strips").length, 1, "and the live rows were asked for once");
    await page.close();
  }

  {
    const NIGHT = "2026-09-28";
    const focus = {
      status: "ok", sessionDate: NIGHT, generatedAt: iso(TUE_1330 - 20 * 3600000), readAt: iso(TUE_1330 - 20 * 3600000),
      fields: ["px", "prev", "chg", "net", "lean", "iv30"],
      groups: [{ id: "mag7", kind: "leaders", label: "Mag 7", tickers: ["AAA", "CCC", "NOIV"], lead: "AAA" }],
      rows: { AAA: [92, 100, -0.08, 1e6, 0.1, 0.56], CCC: [96, 100, -0.04, 2e6, 0.2, 0.23], NOIV: [109, 100, 0.09, 1e6, 0.1, 0.3] },
      closes: { AAA: [100, 92], CCC: [100, 96], NOIV: [100, 109] },
    };
    const proj = {
      status: "ok", v: 1, sessionDate: NIGHT, generatedAt: iso(TUE_1330 - 20 * 3600000), n: 3, projection: ["chg", "ed", "iv30p", "sec", "t"], absent: [],
      t: ["AAA", "CCC", "NOIV"], sectors: ["Tech"], sec: [0, 0, 0],
      cols: { chg: [-800, -400, 900], iv30p: [400, 230, null], ed: [4, 40, 40] },
      units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], ed: ["sessions", 1] },
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, {
      html: PAGES.overviewPage({ username: "test" }), url: "/flows/",
      answer: (key) => (key.startsWith("focus") ? { body: focus } : key.startsWith("universe?cols=") ? { body: proj }
        : key.startsWith("now") ? { body: { serverNow: NOW, expected: NIGHT, phase: RTH, keys: {} } } : null),
    });
    await page.waitForSelector("#ccLeaders a[data-ticker] .hm-qd", { timeout: 15000 });
    await settle(page);
    const got = await page.evaluate(() => ({
      head: document.querySelector("#ccLeaders .hm-qhead").textContent,
      rows: Object.fromEntries([...document.querySelectorAll("#ccLeaders a.hm-qrow")].map((r) => [r.dataset.ticker, { d: r.querySelector(".hm-qd").firstChild.textContent, e: Boolean(r.querySelector(".hm-qd-e")), iv: r.querySelector(".hm-qiv").textContent }])),
    }));
    ok(got.head.endsWith("IV-days"), "Home's Leaders gain an IV-days column beside IV 30d");
    eq(NUM(got.rows.AAA.d), NUM(M.signedIvDays(M.ivDays(-0.08, 0.4))), "AAA: its nightly day change over the IV struck at the previous close, -3.2");
    eq(got.rows.AAA.e, true, "AAA reports in 4 sessions, so its value carries the event mark");
    eq(NUM(got.rows.CCC.d), NUM(M.signedIvDays(M.ivDays(-0.04, 0.23))), "CCC likewise");
    eq(got.rows.CCC.e, false, "and its earnings are 40 sessions away, so no mark");
    eq(got.rows.NOIV.d, "—", "a name with no prior-close IV is a dash, never 0.0");
    eq(got.rows.AAA.iv, "56.0%", "the existing IV 30d column still prints the current IV");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }

  {
    const NIGHT = "2026-09-28";
    const names = ["AAA", "CCC", "UUU", "NOIV", "E21", "E22"];
    const focus = {
      status: "ok", sessionDate: NIGHT, generatedAt: iso(TUE_1330 - 20 * 3600000), readAt: iso(TUE_1330 - 20 * 3600000),
      fields: ["px", "prev", "chg", "net", "lean", "iv30"],
      groups: [{ id: "mag7", kind: "leaders", label: "Mag 7", tickers: names, lead: "AAA" }],
      rows: Object.fromEntries(names.map((t) => [t, [100, 100, 0, 0, 0, 0.3]])), closes: Object.fromEntries(names.map((t) => [t, [100, 100]])),
    };
    const strips = stripsOf(ROSTER.filter((r) => names.includes(r.t)).concat([
      { t: "E21", chg: -0.05, iv30: 0.3, iv30p: 0.25, im: 0.1 }, { t: "E22", chg: -0.05, iv30: 0.3, iv30p: 0.25, im: 0.1 },
    ]));
    const proj = {
      status: "ok", v: 1, sessionDate: NIGHT, n: 6, projection: ["chg", "ed", "iv30p", "sec", "t"], absent: [],
      t: names, sectors: ["Tech"], sec: [0, 0, 0, 0, 0, 0],
      cols: { chg: [0, 0, 0, 0, 0, 0], iv30p: [111, 111, 111, 111, 111, 111], ed: [40, 40, 40, 40, 21, 22] }, units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], ed: ["sessions", 1] },
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, {
      html: PAGES.overviewPage({ username: "test" }), url: "/flows/",
      answer: (key) => {
        if (key.startsWith("focus")) return { body: focus };
        if (key.startsWith("universe?cols=")) return { body: proj };
        if (key.startsWith("lk?k=")) {
          const ks = key.slice(5).split(",");
          return { body: { serverNow: NOW, phase: RTH, keys: Object.fromEntries(ks.map((k) => [k, k === "strips" ? entry(strips) : entry(null)])) } };
        }
        if (key.startsWith("now")) return { body: { serverNow: NOW, expected: NIGHT, phase: RTH, keys: {} } };
        return null;
      },
    });
    await page.waitForSelector("#ccLeaders a[data-ticker] .hm-qd", { timeout: 15000 });
    await settle(page);
    const got = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#ccLeaders a.hm-qrow")].map((r) => [r.dataset.ticker, [r.dataset.src, r.querySelector(".hm-qd").firstChild.textContent, Boolean(r.querySelector(".hm-qd-e"))]])));
    eq(got.AAA[0], "live", "the live rows are read as live");
    eq(NUM(got.AAA[1]), NUM(M.signedIvDays(M.ivDays(-0.08, 0.4))), "and a live row divides by the strip's own prior-close IV, not the nightly column's 11.1 points nor the current IV");
    eq(NUM(got.UUU[1]), NUM(M.signedIvDays(M.ivDays(0.05, 0.25))), "UUU likewise");
    eq(got.NOIV[0], "live", "NOIV is read from the live rows");
    eq(got.NOIV[1], "—", "A LIVE ROW WITH NO STRIP IV is a dash: last night's 11.1 points are never paired with today's change");
    eq(got.E21[2], true, "a name 21 sessions from earnings carries the event mark");
    eq(got.E22[2], false, "and one 22 sessions from them does not");
    eq(NUM(got.E22[1]), NUM(M.signedIvDays(M.ivDays(-0.05, 0.25))), "E22 is read on its strip IV");
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`✓ flows-moves0: ${checks} assertions — the IV-days definition worked by hand, the timing fixture ranked on the previous close's IV in the leaf and on the page, a current-IV build and an implied-move build caught, earnings names ranked apart, absent IV never zero, the median line on the prior-close IV, the copy lint, the owner and member defaults, raw lists kept when the lens is off, the order held under the pointer, and Home's Leaders column`);
