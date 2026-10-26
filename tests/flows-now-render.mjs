import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { ROOT } from "./lib/market-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const TOKEN = "0123456789abcdef";
const DASH = "\u2014";
const HTML = PAGES.nowPage({ username: "test" });
const SCRIPT = (HTML.match(/\/assets\/js\/[^"'?\s]*now[^"'?\s]*\.js/) || [""])[0];
ok(SCRIPT && fs.existsSync(path.join(ROOT, SCRIPT)), "nowPage loads its script from /assets/js/: " + SCRIPT);
const T0 = 1767225600;
const ROWS = [
  ["NVDA", "C", 140, "2026-06-19", 4200000, 3400000, 800000],
  ["TSLA", "P", 250, "2026-05-15", 900000, 700000, 200000],
  ["AAPL", "C", 230, "2026-07-17", 2600000, 400000, 2200000],
  ["NVDA", "P", 120, "2026-06-19", 3100000, 500000, 2600000],
  ["SPY", "P", 540, "2026-04-17", 7800000, 6000000, 1800000],
  ["MSFT", "C", 450, "2026-09-18", 1500000, 750000, 750000],
  ["AMD", "P", 160, "2026-05-15", 640000, 100000, 540000],
  ["META", "C", 600, "2026-08-21", 1150000, 1000000, 150000],
  ["QQQ", "C", 480, "2026-04-17", 5300000, 1200000, 4100000],
  ["AMZN", "P", 210, "2026-06-19", 380000, 300000, 80000],
  ["GOOGL", "C", 190, "2026-12-18", 2050000, null, null],
  ["IWM", "P", 220, "2026-05-15", null, 30000, 10000],
].map(([t, cp, k, exp, prem, askPrem, bidPrem], i) => {
  const r = { t, cp, k, exp, spanStart: T0 + i * 1500 + 37 };
  if (prem !== null) r.prem = prem;
  if (askPrem !== null) r.askPrem = askPrem;
  if (bidPrem !== null) r.bidPrem = bidPrem;
  return r;
});
const ALERTS = { rows: ROWS };
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); };
function leanWord(r) {
  if (!(r.prem > 0)) return DASH;
  const a = r.askPrem >= 0 ? r.askPrem : null;
  const b = r.bidPrem >= 0 ? r.bidPrem : null;
  if (a === null || b === null) return DASH;
  const k = a + b > r.prem ? r.prem / (a + b) : 1;
  const sided = (a + b) * k;
  const share = sided ? (a * k) / sided : null;
  if (share === null) return DASH;
  const whole = (v) => +(v * 100).toFixed(0);
  const at = whole(sided / r.prem) < 50 ? "" : whole(share) >= 65 ? "ask" : whole(share) <= 35 ? "bid" : "";
  if (!at) return "Side not stated";
  const call = r.cp === "C";
  return (call && at === "ask") || (!call && at === "bid") ? "Bullish" : "Bearish";
}
const SORTED = ROWS.map((r, i) => ({ r, i }))
  .sort((a, b) => ((b.r.prem > 0 ? b.r.prem : -1) - (a.r.prem > 0 ? a.r.prem : -1)) || a.i - b.i)
  .map(({ r }) => ({ key: [r.t, r.cp, r.k, r.exp, r.spanStart].join("|"), t: r.t, lean: leanWord(r), time: hhmm(r.spanStart * 1000 + 3 * 3600e3), utc: hhmm(r.spanStart * 1000) }));
eq(SORTED.slice(0, 4).map((x) => x.t), ["SPY", "QQQ", "NVDA", "NVDA"], "the fixture's independent sort puts the largest premiums first");
ok(SORTED.every((x) => x.time !== x.utc), "every fixture window reads differently in TRT and UTC, so a UTC build cannot pass");
const SIZES = [[1440, 820, false], [1024, 768, false], [390, 844, true]];

const browser = await launch();

async function open({ viewport = { width: 1440, height: 820 }, coarse = false, alerts = ALERTS, alertsStatus = 200, patch = null, hash = "" } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: coarse, isMobile: coarse, reducedMotion: "reduce" });
  await context.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (patch && patch[u.pathname]) {
        let src = fs.readFileSync(f, "utf8");
        for (const [from, to] of patch[u.pathname]) src = src.replaceAll(from, to);
        return route.fulfill({ body: src, contentType: MIME[path.extname(f)] });
      }
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname === "/api/flows/flowalerts") {
      if (alertsStatus !== 200) return route.fulfill({ status: alertsStatus, contentType: "application/json", body: "{}" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(alerts) });
    }
    if (u.pathname.startsWith("/api/flows/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending", rows: [] }) });
    if (u.pathname === "/peer.html") return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="en"><title>peer</title></html>' });
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://example.test/flows/now/" + hash);
  return { context, page, errors };
}

function anchored(patch) {
  for (const [file, edits] of Object.entries(patch)) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const [from] of edits) ok(src.includes(from), "the planted wrong build's anchor is in " + file + ": " + from.slice(0, 60));
  }
  return patch;
}

const drawn = (page) => page.waitForSelector("#pwHost tbody tr", { timeout: 20000 }).then(() => page.waitForTimeout(400)).then(() => true).catch(() => false);

const layout = (page) => page.evaluate(() => {
  const host = document.getElementById("pwHost");
  const hr = host.getBoundingClientRect();
  const de = document.documentElement;
  const inHost = (r) => r.top >= hr.top - 1 && r.bottom <= hr.bottom + 1 && r.left >= hr.left - 1 && r.right <= hr.right + 1;
  const off = [...document.body.querySelectorAll("*")].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== "hidden" && (r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.left < -1 || r.top < -1);
  }).filter((e) => !e.closest(".flows-skip, .visually-hidden")).map((e) => e.tagName + (e.id ? "#" + e.id : "")).slice(0, 4);
  const more = host.querySelector(".pw-more");
  const first = host.querySelector("tbody tr");
  const back = [...document.querySelectorAll("a")].find((a) => /Back to Unusual/i.test(a.textContent));
  return {
    sh: de.scrollHeight, ih: innerHeight, sw: de.scrollWidth, iw: innerWidth, off,
    strays: [...host.querySelectorAll("tr, .pw-more, .pw-empty")].filter((e) => !inHost(e.getBoundingClientRect())).length,
    over: Math.max(host.scrollHeight - host.clientHeight, host.scrollWidth - host.clientWidth),
    gap: more ? hr.bottom - more.getBoundingClientRect().bottom : null, rowH: first ? first.getBoundingClientRect().height : 0,
    rows: [...host.querySelectorAll("tbody tr")].map((tr) => ({ key: tr.dataset.key, cells: [...tr.cells].map((c) => c.textContent.trim()) })),
    count: (document.getElementById("pwCount") || {}).textContent || "", status: (document.getElementById("pwStatus") || {}).textContent || "",
    back: back ? back.getAttribute("href") : null,
  };
});

function screenProblems(s, tag) {
  const bad = [];
  if (s.sh > s.ih + 1) bad.push(tag + ": the page scrolls (" + s.sh + " against " + s.ih + ")");
  if (s.sw > s.iw + 1) bad.push(tag + ": the page scrolls sideways (" + s.sw + " against " + s.iw + ")");
  if (s.off.length) bad.push(tag + ": elements leave the screen: " + s.off.join(" "));
  if (s.strays) bad.push(tag + ": " + s.strays + " rows leave the list's module");
  if (s.over > 1) bad.push(tag + ": the list scrolls inside its module");
  return bad;
}

async function paintProblems({ viewport, coarse = false, patch = null }) {
  const bad = [];
  const tag = viewport.width + "x" + viewport.height;
  const { context, page, errors } = await open({ viewport, coarse, patch });
  try {
    if (!(await drawn(page))) { bad.push(tag + ": no row was drawn from the fixture"); return bad; }
    const s = await layout(page);
    bad.push(...screenProblems(s, tag));
    const n = s.rows.length;
    const total = SORTED.length;
    const want = SORTED.slice(0, n);
    if (!n) bad.push(tag + ": no row fits");
    if (JSON.stringify(s.rows.map((r) => r.key)) !== JSON.stringify(want.map((w) => w.key))) bad.push(tag + ": the rows are not the largest premiums first: " + s.rows.map((r) => r.cells[0]).join(" "));
    s.rows.forEach((r, i) => {
      if (r.cells[5] !== want[i].lean) bad.push(tag + ": row " + (i + 1) + " leans " + r.cells[5] + ", not " + want[i].lean);
      if (r.cells[6] !== want[i].time) bad.push(tag + ": row " + (i + 1) + " shows " + r.cells[6] + ", not TRT " + want[i].time + (r.cells[6] === want[i].utc ? " (it is UTC)" : ""));
    });
    const said = n === total ? total + " windows" : n + " of " + total + " shown";
    if (s.count !== said) bad.push(tag + ": the count says " + s.count + ", not " + said);
    if (n < total && (s.gap === null || s.gap > s.rowH + 4)) bad.push(tag + ": another row would fit below the " + n + " shown");
    if (s.back !== "/flows/unusual/") bad.push(tag + ": Back to Unusual points to " + s.back);
    if (errors.length) bad.push(tag + ": page errors " + errors.join(" | "));
  } finally {
    await context.close();
  }
  return bad;
}

const tick = (m) => { const a = m && m.s ? Object.values(m.s).find((x) => x && x.kind === "ticker") : null; return a ? a.value : null; };

async function linkProblems() {
  const bad = [];
  const { context, page, errors } = await open({ hash: "#l=w=" + TOKEN });
  try {
    if (!(await drawn(page))) { bad.push("no row was drawn"); return bad; }
    const peer = await context.newPage();
    await peer.goto("https://example.test/peer.html");
    await peer.evaluate((token) => {
      window.__got = [];
      window.__bc = new BroadcastChannel("flows-link:" + token);
      window.__bc.onmessage = (e) => window.__got.push(e.data);
    }, TOKEN);
    const T = "NVDA";
    const expect = await page.evaluate((t) => document.querySelectorAll(`#pwHost tbody tr[data-t="${t}"]`).length, T);
    if (expect !== 2) bad.push("the two " + T + " windows are not both shown: " + expect);
    let lit = 0;
    for (let i = 0; i < 60 && lit !== expect; i++) {
      await peer.evaluate((t) => window.__bc.postMessage({ v: 1, id: "peer0001", s: { A: { kind: "ticker", value: t, source: "peer" } } }), T);
      await page.waitForTimeout(250);
      lit = await page.evaluate((t) => { const sel = [...document.querySelectorAll("#pwHost tbody tr.is-sel")]; return sel.every((tr) => tr.dataset.t === t) ? sel.length : -1; }, T);
    }
    if (lit !== expect) bad.push("a selection of " + T + " from the peer did not highlight its " + expect + " rows: " + lit);
    await page.waitForTimeout(1200);
    const echoed = await peer.evaluate(() => window.__got.length);
    if (echoed) bad.push("the window sent the peer's selection back " + echoed + " time(s)");
    const wait = async (v) => { for (let i = 0; i < 20; i++) { if ((await peer.evaluate(() => window.__got)).some((m) => tick(m) === v)) break; await page.waitForTimeout(250); } await page.waitForTimeout(800); };
    await page.click('#pwHost tbody tr[data-t="SPY"] td:nth-child(2)');
    await wait("SPY");
    await page.focus('#pwHost tbody tr[data-t="QQQ"]');
    await page.keyboard.press("Enter");
    await wait("QQQ");
    const got = (await peer.evaluate(() => window.__got)).map(tick);
    if (got.filter((v) => v === "SPY").length !== 1) bad.push("a click on SPY reached the peer " + got.filter((v) => v === "SPY").length + " times, not once");
    if (got.filter((v) => v === "QQQ").length !== 1) bad.push("Enter on QQQ reached the peer " + got.filter((v) => v === "QQQ").length + " times, not once");
    if (got.length !== 2) bad.push("the window sent the peer more than the two picks: " + JSON.stringify(got));
    if (errors.length) bad.push("page errors " + errors.join(" | "));
  } finally {
    await context.close();
  }
  return bad;
}

const STATES = [
  ["a failed read", { alertsStatus: 500 }, "unavailable", [/Unavailable/, /HTTP 500/]],
  ["an unpublished feed", { alerts: { status: "pending", rows: [] } }, "pending", [/Pending/, /not published/]],
  ["an empty read", { alerts: { rows: [] } }, "empty", [/Nothing flagged/, /quiet market/]],
];

async function stateProblems() {
  const bad = [];
  for (const [name, opts, state, says] of STATES) {
    const { context, page, errors } = await open(opts);
    try {
      const seen = await page.waitForFunction(([st, pats]) => {
        const p = document.querySelector(`#pwHost .pw-empty[data-empty="${st}"]`);
        return Boolean(p && pats.every((s) => new RegExp(s).test(p.textContent)));
      }, [state, says.map((r) => r.source)], { timeout: 15000 }).then(() => true).catch(() => false);
      if (!seen) { bad.push(name + " does not say what it is with its reason: " + (await page.evaluate(() => document.getElementById("pwHost").textContent)).slice(0, 120)); continue; }
      const s = await layout(page);
      if (!says.every((r) => r.test(s.status))) bad.push(name + ": the status line does not carry the reason: " + s.status);
      if (s.count !== DASH) bad.push(name + ": the count shows " + s.count + ", not an em dash");
      if (s.rows.length) bad.push(name + ": rows are drawn");
      bad.push(...screenProblems(s, name));
      if (errors.length) bad.push(name + ": page errors " + errors.join(" | "));
    } finally {
      await context.close();
    }
  }
  return bad;
}

const WIDE = { width: 1440, height: 820 };
const MUTANTS = [
  ["the rows are sorted smallest premium first", () => paintProblems({ viewport: WIDE, patch: anchored({ [SCRIPT]: [["return y.p - x.p;", "return x.p - y.p;"]] }) })],
  ["the lean words are swapped", () => paintProblems({ viewport: WIDE, patch: anchored({ [SCRIPT]: [['? "bullish" : "bearish"', '? "bearish" : "bullish"']] }) })],
  ["times are shown in UTC", () => paintProblems({ viewport: WIDE, patch: anchored({ [SCRIPT]: [['timeZone: "Europe/Istanbul", hour: "2-digit"', 'timeZone: "UTC", hour: "2-digit"']] }) })],
];

try {
  for (const [w, h, coarse] of SIZES) {
    eq(await paintProblems({ viewport: { width: w, height: h }, coarse }), [], `${w}x${h}: THE FLAGGED WINDOWS FILL ONE SCREEN, LARGEST PREMIUM FIRST, LEAN BY CONVENTION, TIMES IN TRT, BACK TO MARKET ON THE NETWORK`);
  }
  eq(await linkProblems(), [], "A TICKER FROM THE PEER HIGHLIGHTS ITS ROWS WITH NO ECHO, AND A CLICK OR ENTER ON A ROW REACHES THE PEER ONCE");
  eq(await stateProblems(), [], "A FAILED, AN UNPUBLISHED AND AN EMPTY FEED EACH SAY WHAT THEY ARE WITH THEIR REASON AND NO ZERO COUNT");
  for (const [name, run] of MUTANTS) ok((await run()).length > 0, `PLANTED WRONG BUILD FAILS: ${name}`);
} finally {
  await browser.close();
}

console.log(`flows-now-render: ${checks} checks, the flagged windows painted at 1440x820, 1024x768 and 390x844, linked to a peer window without echo, three feed states, and ${MUTANTS.length} planted wrong builds`);
