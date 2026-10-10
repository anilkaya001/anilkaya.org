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
let NOW = TUE_1330;

const fresh = (klass, state, reason, readAt, staleAt, session = "2026-09-29", cadence = 900) => ({
  "X-Fresh-State": state, "X-Fresh-Reason": reason, "X-Fresh-Class": klass, "X-Fresh-Read-At": iso(readAt), "X-Fresh-Source": "actions",
  "X-Fresh-Cadence": String(cadence), "X-Fresh-Session": session, "X-Fresh-Live-Until": iso(readAt + 1200000), "X-Fresh-Stale-At": iso(staleAt),
  "X-Fresh-Phase": "rth", "X-Fresh-Phase-Ends": RTH.endsAt,
});

async function mount(page, { html, url, answer, at = TUE_1330 }) {
  const asked = [];
  page._asked = asked;
  NOW = at;
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
  await page.clock.install({ time: new Date(at) });
  await page.goto("https://example.test" + url);
  await settle(page);
}

const settle = async (page) => {
  await page.waitForTimeout(150);
  for (let i = 0; i < 200 && page._inflight > 0; i++) await page.waitForTimeout(50);
  await page.waitForTimeout(150);
};
const tick = async (page, ms) => { NOW += ms; await page.clock.runFor(ms); await settle(page); };
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
    const TICKERS = ["NVDA", "AMD"];
    const board = {
      side: "long", generatedAt: "2026-09-28T21:30:00.000Z", sessionDate: "2026-09-28", status: "ok", universe: 264, enriched: 60,
      rows: TICKERS.map((t, i) => ({ t, r: i + 1, s: 90 - i * 7, cnv: 80, px: 100 + i, chg: 0.01, purity: 0.02, sector: "Technology",
        gRegime: "long", gFlipDist: -0.1, netPrem: 1e7, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 })),
    };
    const serverAt = TUE_1330;
    const readAt = serverAt - 60000;
    const ahead = 50 * 60000;
    const stripsBody = { v: 1, key: "live:strips", status: "ok", session: "2026-09-29", fields: ["px", "chg"], rows: { NVDA: [200, 0.05], AMD: [201, 0.06] },
      fresh: { readAt: iso(readAt), session: "2026-09-29", cadenceS: 900, source: "actions", writer: "flows-live" } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, {
      html: PAGES.sidePage({ username: "test", side: "long" }), url: "/flows/long/", at: serverAt + ahead,
      answer: (key) => (key.startsWith("board?side=long") ? { body: board }
        : key.startsWith("lk?k=strips") ? { headers: { ...fresh("breadth", "live", "cadence", readAt, readAt + 2700000), "X-Server-Now": String(NOW - ahead) }, body: stripsBody } : null),
    });
    const dots = () => page.evaluate(() => [...document.querySelectorAll("#flowsBody .bd-px")].map((n) => n.classList.contains("is-live")));
    const polls = () => page._asked.filter((k) => k.startsWith("lk?k=strips")).length;
    eq((await dots()).join(), "true,true",
      "A BROWSER CLOCK 50 MINUTES AHEAD OF THE SERVER: a read the server calls live for another 44 minutes keeps its dots (the board compared its own clock with the server's absolute stale line and dropped them at once)");
    const before = polls();
    await tick(page, 3 * 60000);
    eq(polls() - before, 0, "and is not asked again every minute as if it had lapsed");
    await tick(page, 12 * 60000 + 1000);
    eq(polls() - before, 1, "but at the 15 minute cadence, the server's clock deciding how much of the window is left");
    eq((await dots()).join(), "true,true", "with the dots still on");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }

  {
    const stamp = () => ({ readAt: iso(NOW - 60000), session: "2026-09-29", cadenceS: 900, liveUntil: iso(NOW + 1140000), staleAt: iso(NOW + 2640000), source: "actions", updatedAt: 1 });
    const nightly = { state: "fresh", reason: "session", klass: "nightly", readAt: iso(TUE_1330 - 7 * 3600000), session: "2026-09-28", cadenceS: 0,
      staleAt: iso(TUE_1330 + 20 * 3600000), source: "nightly", updatedAt: 1 };
    const beat = () => ({ body: { serverNow: NOW, expected: "2026-09-28", phase: RTH, keys: {
      "live:market": { state: "live", reason: "cadence", klass: "market", ...stamp() }, "live:breadth": { state: "live", reason: "cadence", klass: "breadth", ...stamp() },
      "live:strips": { state: "live", reason: "cadence", klass: "breadth", ...stamp() }, "live:focus": { state: "live", reason: "cadence", klass: "market", ...stamp() },
      "live:news": { state: "live", reason: "cadence", klass: "breadth", ...stamp() }, pulse: nightly, focus: nightly } } });
    const alertsAt = TUE_1330 - 60000;
    const alerts = { headers: { ...fresh("breadth", "live", "cadence", alertsAt, alertsAt + 2700000), "X-Live-Overlay": "live:alerts" },
      body: { status: "ok", sessionDate: "2026-09-29", generatedAt: iso(alertsAt), rows: [] } };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, {
      html: PAGES.overviewPage({ username: "test" }), url: "/flows/",
      answer: (key) => (key.startsWith("now") ? beat() : key.startsWith("flowalerts") ? alerts : null),
    });
    ok(page._asked.some((k) => k.startsWith("flowalerts")), "the home page reads the flow alerts, served from the live overlay");
    ok(["live", "fresh"].includes((await pill(page)).state), `and opens on a current pill (${JSON.stringify(await pill(page))})`);
    for (const min of [10, 20, 30, 40, 50, 60]) {
      await tick(page, 10 * 60000);
      const now = await pill(page);
      ok(now.state !== "stale", `AN HOUR INTO THE SESSION on a healthy live layer the pill is not stale at +${min} minutes, though the alerts were read once at load and their 45 minute window has passed (${JSON.stringify(now)})`);
    }
    ok(page._asked.filter((k) => k.startsWith("flowalerts")).length === 1, "with the alerts region fetched once, as the page has always done");
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
  {
    const board = {
      side: "long", generatedAt: "2026-09-28T21:30:00.000Z", sessionDate: "2026-09-28", status: "ok", universe: 264, enriched: 60,
      rows: ["NVDA", "AMD"].map((t, i) => ({ t, r: i + 1, s: 90 - i * 7, cnv: 80, px: 100 + i, chg: 0.01, purity: 0.02, sector: "Technology",
        gRegime: "long", gFlipDist: -0.1, netPrem: 1e7, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 })),
    };
    const answer = (key) => (key.startsWith("board?side=long") ? { body: board } : null);
    const html = PAGES.sidePage({ username: "test", side: "long" });
    const noPopover = () => {
      for (const k of ["popover", "showPopover", "hidePopover", "togglePopover"]) delete HTMLElement.prototype[k];
      const m = Element.prototype.matches;
      Element.prototype.matches = function (sel) {
        if (/:popover-open/.test(sel)) throw new DOMException("'" + sel + "' is not a valid selector.", "SyntaxError");
        return m.call(this, sel);
      };
    };
    const tapAll = async (page) => {
      await page.click("#fxFresh");
      const infos = await page.$$("#flowsMain [data-info]");
      for (const b of infos.slice(0, 6)) { await b.scrollIntoViewIfNeeded(); await b.click(); }
      await page.mouse.click(5, 400);
      await page.keyboard.press("Escape");
      return infos.length;
    };
    const look = (page) => page.evaluate(() => {
      const o = document.getElementById("fxOld"), r = o && o.getBoundingClientRect();
      const l = o && o.querySelector(".fx-fresh-l"), lr = l && l.getBoundingClientRect();
      return {
        old: o ? { text: o.textContent, shown: o.innerText, title: o.title, w: r.width, right: r.right, tag: o.tagName, labelW: lr.width, labelRight: lr.right } : null,
        pop: !!document.getElementById("fxPop"),
        expanded: [...document.querySelectorAll('[aria-expanded="true"][data-info], #fxFresh[aria-expanded="true"]')].length,
        over: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
        vw: innerWidth,
      };
    });

    for (const width of [1280, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(noPopover);
      await mount(page, { html, url: "/flows/long/", answer });
      ok(await page.evaluate(() => !("popover" in HTMLElement.prototype) && typeof HTMLElement.prototype.showPopover === "undefined"), "the emulated browser has no Popover API");
      const n = await tapAll(page);
      ok(n > 0, `the board offers disclosures to tap (${n})`);
      const seen = await look(page);
      eq(errors.length, 0, `A BROWSER WITHOUT THE POPOVER API: tapping the freshness pill and ${Math.min(n, 6)} disclosures, a tap outside and Escape throw nothing at ${width} px (${errors.join("; ")})`);
      ok(seen.old && seen.old.w > 0 && seen.old.labelW > 0 && /Old browser/.test(seen.old.shown), `THE BAR SAYS SO: the old-browser banner is shown with its label at ${width} px (${JSON.stringify(seen.old)})`);
      ok(seen.old.labelRight <= seen.vw, `and the label sits inside the viewport at ${width} px (right edge ${seen.old.labelRight})`);
      ok(/older than Flows supports/.test(seen.old.title) && /older than Flows supports/.test(seen.old.text), "and carries the sentence, visible to a pointer as its title and to a screen reader as text");
      eq(seen.old.tag, "SPAN", "the banner is not a control: there is nothing behind it to open");
      if (width === 1280) {
        const paint = () => page.evaluate(() => { const s = getComputedStyle(document.getElementById("fxOld")); return [s.color, s.backgroundColor, s.cursor].join(" "); });
        const rest = await paint();
        await page.hover("#fxOld");
        eq(await paint(), rest, "and a pointer over it changes neither its colour, its background nor its cursor");
      }
      ok(seen.old.right <= seen.vw, `the banner sits inside the viewport at ${width} px (right edge ${seen.old.right})`);
      eq(seen.over, 0, `and the page does not scroll sideways at ${width} px`);
      eq(seen.pop, false, "no popover element is made where it cannot be shown");
      eq(seen.expanded, 0, "and no trigger is left claiming it is expanded");
      await page.close();
    }

    const gated = (key) => (key.startsWith("board?side=long") ? { status: 401, body: { error: { code: "unauthorized", message: "Authentication required" } } } : null);
    const edges = (page) => page.evaluate(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width }; };
      const g = document.getElementById("fxGate"), o = document.getElementById("fxOld");
      return {
        vw: innerWidth, gate: box(g), gateLabel: box(g && g.querySelector(".fx-fresh-l")), gateText: g ? g.innerText : null,
        old: box(o), oldLabel: box(o && o.querySelector(".fx-fresh-l")), gated: document.getElementById("fxBar").classList.contains("is-gated"),
      };
    });
    for (const popover of [false, true]) {
      for (const width of [320, 375, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        if (!popover) await page.addInitScript(noPopover);
        await page.addInitScript((t) => { try { sessionStorage.setItem("flows:gate", String(t)); } catch {} }, TUE_1330);
        await mount(page, { html, url: "/flows/long/", answer: gated });
        const e = await edges(page);
        const who = popover ? "WITH the Popover API" : "WITHOUT the Popover API";
        ok(e.gate && e.gate.w > 0, `SIGNED OUT ${who} at ${width} px: the sign-in gate is shown (${JSON.stringify(e)})`);
        ok(/sign in/.test(e.gateText) && e.gateLabel.w > 0, `and it reads "sign in" at ${width} px (${JSON.stringify(e.gateText)})`);
        ok(e.gate.right <= e.vw && e.gateLabel.right <= e.vw, `and the whole gate, its link included, sits inside the viewport at ${width} px (right edge ${e.gate.right} of ${e.vw})`);
        eq(e.gated, true, "the bar knows a gate is shown");
        if (popover) eq(e.old, null, "and no old-browser banner competes with it");
        else {
          ok(e.old.w > 0 && e.old.right <= e.gate.left, `the old-browser glyph stays beside the gate, not under it (${JSON.stringify(e.old)})`);
          eq(e.oldLabel.w, 0, `and gives the gate its label's room at ${width} px`);
        }
        eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
        await page.close();
      }
    }

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, { html, url: "/flows/long/", answer });
    eq(await page.evaluate(() => !!document.getElementById("fxOld")), false, "A BROWSER WITH THE POPOVER API shows no old-browser banner");
    const b = await page.$("#flowsMain [data-info]");
    await b.click();
    ok(await page.evaluate(() => document.getElementById("fxPop").matches(":popover-open")), "and a tapped disclosure still opens its popover");
    await page.keyboard.press("Escape");
    eq(await page.evaluate(() => document.getElementById("fxPop").matches(":popover-open")), false, "which Escape still closes");
    eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
    await page.close();
  }
  {
    const board = {
      side: "long", generatedAt: "2026-09-28T21:30:00.000Z", sessionDate: "2026-09-28", status: "ok", universe: 264, enriched: 60,
      rows: ["NVDA", "AMD", "MSFT"].map((t, i) => ({ t, r: i + 1, s: 90 - i * 7, cnv: 80, px: 100 + i, chg: 0.01, purity: 0.02, sector: "Technology",
        gRegime: "long", gFlipDist: -0.1, netPrem: 1e7, fam: { F: 10, P: 20, D: 30, V: 40, O: 50 }, edte: 20 })),
    };
    const answer = (key) => (key.startsWith("board?side=long") ? { body: board } : null);
    const html = PAGES.sidePage({ username: "test", side: "long" });
    const lostFrom = (before, after) => before.all.filter((k) => !after.all.includes(k));
    const state = (page) => page.evaluate(() => {
      const dock = document.getElementById("askDock");
      const panel = document.getElementById("askDockPanel");
      const sel = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';
      const behind = [...document.querySelectorAll(sel)].filter((el) => {
        if (dock.contains(el) || el.closest("[inert]") || el.disabled || el.tabIndex < 0) return false;
        if (!el.getClientRects().length || getComputedStyle(el).visibility === "hidden") return false;
        return true;
      });
      const a = document.activeElement;
      return {
        open: dock.classList.contains("is-open"), hidden: panel.hidden,
        role: panel.getAttribute("role"), modal: panel.getAttribute("aria-modal"),
        behind: behind.length, sample: behind.slice(0, 4).map((el) => el.id || el.tagName + "." + el.className),
        all: behind.map((el) => el.id || el.getAttribute("href") || el.tagName + "." + el.className + "." + (el.textContent || "").trim().slice(0, 20)),
        inert: ["fxSide", "fxBar", "flowsMain", "fxTabs"].filter((id) => { const n = document.getElementById(id); return n && n.inert; }),
        skipInert: document.querySelector(".flows-skip").inert,
        anyInert: document.querySelectorAll("[inert]").length,
        focusIn: !!a && dock.contains(a), focus: a ? (a.id || a.tagName) : null,
        pop: (() => { const p = document.getElementById("fxPop"); return !!(p && p.matches(":popover-open")); })(),
        pal: (() => { const d = document.getElementById("fxPal"); return !!(d && d.open); })(),
      };
    });

    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, { html, url: "/flows/long/", answer });
      const before = await state(page);
      ok(before.behind >= 10 && !before.open, `THE ASK DOCK AT 390 PX: closed, the page offers ${before.behind} tabbable elements, so the count below is measuring something`);
      eq(before.role, "dialog", "the panel is announced as a dialog below 1200 px, before it is ever opened");
      const opener = await page.evaluate(() => {
        const a = [...document.querySelectorAll("#flowsMain a[href]")].find((n) => n.getClientRects().length);
        a.focus();
        return a === document.activeElement ? a.getAttribute("href") : null;
      });
      ok(opener, "a link in the page holds the focus before the dock opens");
      await page.keyboard.press("?");
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === "askQ", null, { timeout: 8000 });
      const open = await state(page);
      ok(open.open && !open.hidden, "\"?\" opens the dock at 390 px, where its tab is not drawn");
      eq(open.role, "dialog", "and the open panel is a dialog");
      eq(open.modal, "true", "a modal one: aria-modal is true");
      eq(open.behind, 0, `ZERO TABBABLE ELEMENTS BEHIND THE OPEN DOCK at 390 px, where the complementary panel left every one of them reachable: ${JSON.stringify(open.sample)}`);
      eq(open.inert.join(","), "fxSide,fxBar,flowsMain,fxTabs", "because the rail, the bar, the page and the tab bar are inert");
      eq(open.skipInert, true, "and the skip link with them");
      const walk = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        walk.push(await page.evaluate(() => {
          const a = document.activeElement;
          const dock = document.getElementById("askDock");
          return !a || a === document.body || a === document.documentElement ? "page" : dock.contains(a) ? "dock" : (a.id || a.tagName);
        }));
      }
      ok(walk.every((w) => w === "dock" || w === "page") && walk.filter((w) => w === "dock").length >= 20,
         `thirty presses of Tab never leave the dock for the page behind it (${walk.join(" ")})`);

      await page.focus("#askQ");
      await page.evaluate(() => window.FlowsUI.openInfo(document.querySelector(".ak-dock-close"), { title: "A note", lead: "Opened from inside the dock." }));
      ok((await state(page)).pop, "an explanation popover opened from inside the dock is open");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
      const afterPop = await state(page);
      ok(!afterPop.pop && afterPop.open, `ESCAPE CLOSES THE POPOVER FIRST and leaves the dock open (${JSON.stringify(afterPop)})`);
      eq(afterPop.behind, 0, `with the page behind it still inert (${JSON.stringify(afterPop.sample)})`);

      await page.focus("#askQ");
      await page.keyboard.press("Control+k");
      await page.waitForFunction(() => { const d = document.getElementById("fxPal"); return !!(d && d.open); }, null, { timeout: 5000 });
      await page.keyboard.press("Escape");
      const afterPal = await state(page);
      ok(!afterPal.pal && afterPal.open, `Escape in the search palette closes the palette and not the dock under it (${JSON.stringify(afterPal)})`);

      await page.focus("#askQ");
      await page.keyboard.press("Escape");
      const shut = await state(page);
      ok(!shut.open && shut.hidden, "a second Escape closes the dock");
      eq(shut.anyInert, 0, "and gives the page back: nothing is left inert");
      const lost = lostFrom(before, shut);
      eq(lost.length, 0, `every element that was tabbable before the dock opened is tabbable again (${shut.behind} now, ${before.behind} before; lost ${JSON.stringify(lost)}; new ${JSON.stringify(shut.all.filter((k) => !before.all.includes(k)))})`);
      eq(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("href")), opener,
         "and the focus returns to the link that held it, not to a tab that is not drawn at this width");

      await page.evaluate(() => [...document.querySelectorAll("#flowsMain a[href]")].find((n) => n.getClientRects().length).focus());
      await page.keyboard.press("?");
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === "askQ", null, { timeout: 5000 });
      await page.click(".ak-dock-close");
      const closed = await state(page);
      ok(!closed.open && lostFrom(before, closed).length === 0 && closed.focus !== "BODY", `the close button gives the page and the focus back the same way (${JSON.stringify(closed)})`);
      eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
      await page.close();
    }

    {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, { html, url: "/flows/long/", answer });
      const before = await state(page);
      await page.click("#askDockTab");
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === "askQ", null, { timeout: 8000 });
      const open = await state(page);
      ok(open.role === "dialog" && open.modal === "true" && open.behind === 0, `AT 1100 PX the side sheet over its scrim is a modal dialog too (${JSON.stringify(open)})`);
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.waitForTimeout(100);
      eq((await state(page)).behind, 0, "and stays one when the window crosses the drawer's 1025 px line, which used to clear the inert flag on the page");
      await page.keyboard.press("Escape");
      const shut = await state(page);
      ok(!shut.open && lostFrom(before, shut).length === 0, "Escape closes it and gives the page back");
      eq(shut.focus, "askDockTab", "with the focus on the tab that opened it");
      eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
      await page.close();
    }

    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, { html, url: "/flows/long/", answer });
      const before = await state(page);
      await page.click("#askDockTab");
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === "askQ", null, { timeout: 8000 });
      const open = await state(page);
      eq(open.role, "complementary", "AT 1280 PX the open dock stays a side panel beside a usable page");
      eq(open.modal, null, "with no aria-modal");
      eq(open.anyInert, 0, "and nothing on the page is inert");
      ok(open.behind >= 20, `the page beside it stays reachable by Tab (${open.behind} elements)`);
      ok(await page.evaluate(() => {
        const a = [...document.querySelectorAll("#flowsMain a[href]")].find((n) => n.getClientRects().length);
        a.focus();
        return document.activeElement === a;
      }), "a link in the page beside the open panel takes the focus");
      await page.keyboard.press("Escape");
      ok((await state(page)).open, "Escape pressed in the page does not close the side panel");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(100);
      const narrowed = await state(page);
      ok(narrowed.role === "dialog" && narrowed.modal === "true" && narrowed.behind === 0 && narrowed.focusIn,
         `narrowed to 390 px while open, it becomes the modal dialog and takes the focus (${JSON.stringify(narrowed)})`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(100);
      const widened = await state(page);
      ok(widened.open && widened.role === "complementary" && widened.modal === null && widened.anyInert === 0 && widened.behind >= 20,
         `widened back to 1280 px, it is a side panel again and the page is live (${JSON.stringify(widened)})`);
      await page.focus("#askQ");
      await page.keyboard.press("Escape");
      ok(!(await state(page)).open, "and Escape inside it still closes it");
      eq(errors.length, 0, `nothing threw (${errors.join("; ")})`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`flows-readers-render: ${checks} checks passed`);
