import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as PAGES from "../shared/flows-pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const TUE_1330 = Date.parse("2026-09-29T13:30:00-04:00");
const RTH = { phase: "rth", session: "2026-09-29", trading: true, lastClosed: "2026-09-28", endsAt: "2026-09-29T20:00:00.000Z" };
const iso = (ms) => new Date(ms).toISOString();

const fresh = (klass, state, reason, readAt, staleAt, session = "2026-09-29", cadence = 900) => ({
  "X-Fresh-State": state, "X-Fresh-Reason": reason, "X-Fresh-Class": klass, "X-Fresh-Read-At": iso(readAt), "X-Fresh-Source": "actions",
  "X-Fresh-Cadence": String(cadence), "X-Fresh-Session": session, "X-Fresh-Live-Until": iso(readAt + 1200000), "X-Fresh-Stale-At": iso(staleAt),
  "X-Fresh-Phase": "rth", "X-Fresh-Phase-Ends": RTH.endsAt, "X-Server-Now": String(readAt),
});

async function mount(page, { html, url, answer, at = TUE_1330 }) {
  const asked = [];
  page._asked = asked;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      asked.push(key);
      const got = answer(key, u);
      const a = got || { body: { status: "pending" } };
      return route.fulfill({ status: a.status || 200, contentType: "application/json", headers: a.headers || {}, body: JSON.stringify(a.body) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  page._inflight = 0;
  const done = (r) => { if (/\/api\/flows\//.test(r.url())) page._inflight--; };
  page.on("request", (r) => { if (/\/api\/flows\//.test(r.url())) page._inflight++; });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  await page.clock.install({ time: new Date(at) });
  await page.goto("https://example.test" + url);
  await settle(page);
}

const settle = async (page) => {
  await page.waitForTimeout(150);
  for (let i = 0; i < 200 && page._inflight > 0; i++) await page.waitForTimeout(50);
  await page.waitForTimeout(150);
};
const tick = async (page, ms) => { await page.clock.runFor(ms); await settle(page); };
const pill = (page) => page.evaluate(() => { const b = document.getElementById("fxFresh"); return b ? { state: b.dataset.state, label: b.dataset.label } : null; });

const browser = await chromium.launch();
try {
  {
    const TICKERS = ["NVDA", "AMD", "MSFT", "AAPL"];
    const board = {
      side: "long", generatedAt: "2026-09-28T21:30:00.000Z", sessionDate: "2026-09-28", status: "ok", universe: 264, enriched: 60,
      rows: TICKERS.map((t, i) => ({ t, r: i + 1, s: 90 - i * 7, cnv: 80 - i * 3, px: 100 + i, chg: 0.01 * (i + 1), purity: 0.02, sector: "Technology",
        gRegime: "long", gFlipDist: -0.1, netPrem: 1e7 - i * 1e5, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 + i })),
    };
    const strips = (readAt, verdict, staleAt) => ({
      headers: fresh("breadth", verdict, verdict === "stale" ? "behind" : "cadence", readAt, staleAt),
      body: { v: 1, key: "live:strips", status: "ok", session: "2026-09-29", fields: ["px", "chg"],
        rows: Object.fromEntries(TICKERS.map((t, i) => [t, [200 + i, 0.05 * (i + 1)]])),
        fresh: { readAt: iso(readAt), session: "2026-09-29", cadenceS: 900, source: "actions", writer: "flows-live" } },
    });
    const state = { strips: null };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    state.strips = strips(TUE_1330 - 60000, "live", TUE_1330 - 60000 + 2700000);
    await mount(page, {
      html: PAGES.sidePage({ username: "test", side: "long" }), url: "/flows/long/",
      answer: (key) => (key.startsWith("board?side=long") ? { body: board } : key.startsWith("lk?k=strips") ? state.strips : null),
    });
    const rows = () => page.evaluate(() => [...document.querySelectorAll("#flowsBody .bd-row")].map((r) => {
      const px = r.querySelector(".bd-px");
      return { t: (r.textContent.match(/\b(NVDA|AMD|MSFT|AAPL)\b/) || [])[1], px: px ? px.textContent.trim() : null, live: !!(px && px.classList.contains("is-live")) };
    }));
    let now = await rows();
    eq(now.length, 4, "the board draws its four rows");
    ok(now.every((r) => r.live) && now[0].px === "200.00", `A LIVE READ INSIDE ITS WINDOW paints the intraday price with the live dot (${JSON.stringify(now[0])})`);
    ok(["live", "fresh"].includes((await pill(page)).state), `and the pill is not stale (${JSON.stringify(await pill(page))})`);
    const before = page._asked.filter((k) => k.startsWith("lk?k=strips")).length;

    state.strips = strips(TUE_1330 - 60000, "stale", TUE_1330 - 60000 + 2700000);
    await tick(page, 16 * 60000);
    ok(page._asked.filter((k) => k.startsWith("lk?k=strips")).length > before, "the board polls again at the cadence");
    now = await rows();
    ok(now.every((r) => !r.live) && now[0].px === "100.00" && now[1].px === "101.00",
      `THE SERVER SAYS STALE: the dots are gone and every price is the board's own again, the intraday one no longer presented as current (${JSON.stringify(now.slice(0, 2))})`);
    const lapsed = await pill(page);
    eq(lapsed.state, "stale", "and the pill turns stale");
    eq(lapsed.label, "Stale", "under its own word, not the board's session date (the board's session is current; a source is not)");

    state.strips = strips(TUE_1330 + 17 * 60000, "live", TUE_1330 + 17 * 60000 + 2700000);
    await tick(page, 61000);
    now = await rows();
    ok(now.every((r) => r.live) && now[0].px === "200.00", "A RECOVERED LOOP brings the dots and the prices back within one minute of the lapse ending (a lapsed board polls every 60 s)");
    ok(["live", "fresh"].includes((await pill(page)).state), "and the pill with them");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }

  {
    const TICKERS = ["NVDA", "AMD"];
    const board = {
      side: "long", generatedAt: "2026-09-28T21:30:00.000Z", sessionDate: "2026-09-28", status: "ok", universe: 264, enriched: 60,
      rows: TICKERS.map((t, i) => ({ t, r: i + 1, s: 90 - i * 7, cnv: 80, px: 100 + i, chg: 0.01, purity: 0.02, sector: "Technology",
        gRegime: "long", gFlipDist: -0.1, netPrem: 1e7, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 })),
    };
    const readAt = TUE_1330 - 60000;
    const stripsBody = { v: 1, key: "live:strips", status: "ok", session: "2026-09-29", fields: ["px", "chg"], rows: { NVDA: [200, 0.05], AMD: [201, 0.06] },
      fresh: { readAt: iso(readAt), session: "2026-09-29", cadenceS: 900, source: "actions", writer: "flows-live" } };
    const staleAt = readAt + 1200000;
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, {
      html: PAGES.sidePage({ username: "test", side: "long" }), url: "/flows/long/",
      answer: (key) => (key.startsWith("board?side=long") ? { body: board }
        : key.startsWith("lk?k=strips") ? { headers: fresh("breadth", "fresh", "cadence", readAt, staleAt), body: stripsBody } : null),
    });
    const dots = () => page.evaluate(() => [...document.querySelectorAll("#flowsBody .bd-px")].map((n) => n.classList.contains("is-live")));
    eq((await dots()).join(), "true,true", "a read that goes stale at 13:49 ET is live at 13:30");
    const polls = () => page._asked.filter((k) => k.startsWith("lk?k=strips")).length;
    const before = polls();
    await tick(page, 15 * 60000 + 1000);
    eq(polls() - before, 1, "it is asked once at the 15 minute cadence, at 13:45");
    await tick(page, 3 * 60000);
    eq(polls() - before, 1, "and not again before its window closes at 13:49");
    eq((await dots()).join(), "true,true", "the dots hold until then");
    await tick(page, 60000);
    eq(polls() - before, 2, "THE NEXT POLL LANDS JUST AFTER THE STALE LINE (13:49), not a whole cadence later at 14:00, so a dot never outlives the server's own verdict by minutes");
    eq((await dots()).join(), "false,false", "and the dots are gone though that answer's own header still says fresh: its stale line passed on the clock");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }

  {
    const newsRows = (n, from) => Array.from({ length: n }, (_, i) => ({ headline: "wire headline " + i, source: "wire", createdAt: iso(from - i * 180000), createdAtMs: from - i * 180000,
      major: false, sentiment: "neutral", tickers: ["SPY"], tags: [] }));
    const readAt = TUE_1330 - 120000;
    const live = (at, extra = {}) => ({
      headers: fresh("breadth", "live", "cadence", at, at + 2700000),
      body: { v: 1, key: "live:news", status: "ok", generatedAt: iso(at), sessionDate: "2026-09-29", readAt: iso(at), readDay: "2026-09-29", refreshed: "intraday",
        cadenceMinutes: 15, live: { key: "live:news", session: "2026-09-29" }, rows: newsRows(5, at - 60000), requested: 100, returned: 100, kept: 5, cap: 60, capped: false, shed: 0,
        atVendorLimit: true, unusable: 0, undatedKept: 0, undatedSeen: 0, newest: iso(at - 60000), oldest: iso(at - 60000 - 720000), ordered: true, reason: null, ...extra },
    });
    const nightly = {
      headers: fresh("nightly", "fresh", "session", TUE_1330 - 7 * 3600000, TUE_1330 + 20 * 3600000, "2026-09-28", 0),
      body: { v: 1, generatedAt: iso(TUE_1330 - 7 * 3600000), sessionDate: "2026-09-28", readAt: iso(TUE_1330 - 7 * 3600000), refreshed: "nightly",
        cadence: "once each weekday after the close", staleBy: "the next weekday's close", rows: newsRows(5, TUE_1330 - 7 * 3600000), requested: 100, returned: 100, kept: 5,
        cap: 60, capped: false, shed: 0, atVendorLimit: true, unusable: 0, undatedKept: 0, undatedSeen: 0, status: "ok", reason: null },
    };
    const st = { news: live(readAt), regime: null, upd: 1 };
    const beat = () => ({ body: { serverNow: Date.now(), expected: "2026-09-28", phase: RTH, keys: {
      "live:news": { state: "live", reason: "cadence", klass: "breadth", readAt: iso(readAt), session: "2026-09-29", cadenceS: 900, liveUntil: iso(readAt + 1200000), staleAt: iso(readAt + 2700000), source: "actions", updatedAt: st.upd },
    } } });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, {
      html: PAGES.overviewPage({ username: "test" }), url: "/flows/",
      answer: (key) => (key.startsWith("news") ? st.news : key.startsWith("regime") ? st.regime : key.startsWith("now") ? { ...beat(), body: { ...beat().body, serverNow: readAt + 120000 } } : null),
    });
    await page.waitForSelector("#ccNews .hm-news-open", { timeout: 15000 });
    await page.click("#ccNews .hm-news-open");
    await page.waitForSelector("#fxPopB .cc-nw-note");
    const said = await page.evaluate(() => ({ note: document.querySelector("#fxPopB .cc-nw-note").textContent, sub: (document.getElementById("ccNewsSub").getAttribute("aria-label") || "") + " | " + document.getElementById("ccNewsSub").textContent,
      pop: document.getElementById("fxPopB").innerText }));
    ok(/Fetched at .*, 2 min ago\./.test(said.note), `the live headlines say when they were fetched (${said.note.slice(0, 80)})`);
    ok(/re-read every 15 minutes while the market is open/.test(said.note), "and say they are re-read every 15 minutes while the market is open");
    ok(!/once-a-day/.test(said.note) && !/never a live tape/.test(said.note) && !/once each weekday/.test(said.note),
      "THE 'ONCE-A-DAY READ AND NEVER A LIVE TAPE' SENTENCE IS GONE for a feed that is re-read intraday (it was printed under headlines fetched minutes ago)");
    ok(/Intraday snapshot/.test(said.pop), `the coverage line calls it an intraday snapshot, not 'cadence not specified' (${said.pop.slice(-160).replace(/\s+/g, " ")})`);
    await page.keyboard.press("Escape");

    const news0 = page._asked.filter((k) => /^news/.test(k)).length;
    const nowQ = page._asked.filter((k) => /^now\?/.test(k));
    ok(nowQ.length >= 1 && /k=[^&]*\bnews\b/.test(decodeURIComponent(nowQ[0])), `THE HEARTBEAT WATCHES THE NEWS KEY (${decodeURIComponent(nowQ[0] || "")})`);
    st.upd = 2;
    st.news = live(TUE_1330 + 600000, { rows: newsRows(5, TUE_1330 + 540000).map((r) => ({ ...r, headline: "second read " + r.headline })) });
    await tick(page, 31000);
    await tick(page, 1000);
    ok(page._asked.filter((k) => /^news/.test(k)).length > news0, "when the key's update stamp moves the card re-reads /api/flows/news");
    const repainted = await page.evaluate(() => document.querySelector("#ccNews .hm-news-open .hm-news-h").textContent);
    ok(/second read/.test(repainted), `and repaints the card with the newer headlines (${repainted})`);

    st.regime = { headers: fresh("nightly", "stale", "behind", TUE_1330 - 6 * 86400000, TUE_1330, "2026-09-22", 0), body: { status: "ok", sessionDate: "2026-09-22", generatedAt: iso(TUE_1330 - 6 * 86400000) } };
    await page.reload();
    await settle(page);
    const stale = await pill(page);
    eq(stale.state, "stale", "A NIGHTLY REGION THE SERVER CALLS STALE turns the home page's pill stale (it read Live: only the boards and the tide were ever compared)");
    st.regime = { headers: fresh("nightly", "fresh", "session", TUE_1330 - 7 * 3600000, TUE_1330 + 20 * 3600000, "2026-09-28", 0), body: { status: "ok", sessionDate: "2026-09-28", generatedAt: iso(TUE_1330 - 7 * 3600000) } };
    await page.reload();
    await settle(page);
    ok((await pill(page)).state !== "stale", "while the same region current leaves it alone");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-readers-render: ${checks} checks passed`);
