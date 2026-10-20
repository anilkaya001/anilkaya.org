import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import * as L from "../shared/flows-political.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const HTML = PAGES.politicalPage({ username: "test" });
const JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-political.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-political.css"), "utf8");
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const COLOUR_FN = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/;
const FORBID_WORDS = /\b(unusual|alert|alerts|screen|rare|sigma)\b|\bat (the )?(ask|bid)\b/i;
const forbidden = (t) => FORBID_WORDS.test(t) || /\bNOW\b/.test(t);
const MINUS = "\u2212", DASH = "\u2014";
const DAY = 864e5;

const WIN = 90, ASOF = "2026-10-16", MINF = 3;
const READ_AT = "2026-10-16T21:33:09.239Z";

const row = (t, bought, sold, filers, lag, o = {}) => ({
  t, asset: null, bought, boughtLo: Math.round(bought * 0.45), boughtHi: Math.round(bought * 1.55), sold,
  buys: Math.max(1, Math.round(filers * 1.4)), sells: sold ? Math.max(1, Math.round(filers / 2)) : 0, filers,
  medianLagDays: lag, openBands: 0, openFloor: 0, ownerKnown: 4, selfFiled: 2, freshBuys: filers > 3 ? 1 : 0, ...o,
});
const RAW = [
  row("ALFA", 15441003, 24001.5, 3, 29), row("BRVO", 4389004.5, 855004, 10, 24), row("CLDR", 3671000, 0, 5, 33),
  row("DUNE", 3101000, 0, 4, 18), row("ECHO", 3002000, 0, 3, 41), row("FJRD", 2973000, 0, 1, 60),
  row("GLEN", 834000, 0, 1, 12), row("HALO", 801000, 90000, 2, 22), row("IRIS", 762000, 0, 2, 70),
  row("JUNO", 751000, 0, 2, 25), row("KILO", 742000, 0, 2, 31), row("LIMA", 1170000, 839000, 5, 29),
  row("MIKE", 400000, 300000, 3, 15), row("NOVA", 350000, 50000, 4, 50), row("OSLO", 310000, 0, 3, 8),
  row("PERU", 290000, 0, 1, 90), row("QUAY", 250000, 20000, 2, 120), row("RUBY", 200000, 0, 6, null),
  row("SAGE", 150000, 0, 3, 14), row("TALL", 120000, 0, 2, 9), row("UNIT", 100000, 0, 1, 5),
  row("VEGA", 90000, 0, 3, 36, { openBands: 1, openFloor: 50000 }),
  row("WREN", 200000, 3000000, 2, 27), row("XRAY", 500000, 900000, 4, 33), row("YARD", 300000, 400000, 2, 20),
  row("ZEST", 1000000, 1600000, 3, 45), row("AMBR", 50000, 600000, 1, 10), row("BOLT", 400000, 500000, 3, 12),
  row("SPY", 3000000, 0, 1, 30), row("IWM", 1200000, 0, 2, 15), row("XLE", 100000, 2000000, 1, 40),
];
const WHO = [["Dana Whitfield", "house"], ["Omar Haddad", "senate"], ["Lee Tran", "executive"], ["Priya Raman", "house"]];
const RECENT = Array.from({ length: 24 }, (_, i) => {
  const [who, memberType] = WHO[i % 4];
  const named = i % 2 === 0 || i === 5;
  const side = i % 7 === 3 ? null : i % 3 === 0 ? "sell" : "buy";
  const day = (n) => new Date(Date.parse(ASOF + "T00:00:00Z") - n * DAY).toISOString().slice(0, 10);
  return {
    who, id: "id" + (i % 4), memberType, t: named ? RAW[(i * 3) % 22].t : null, asset: null, executedBy: "self", side,
    txnType: side === "buy" ? "Purchase" : side === "sell" ? "Sale" : "Receive", lo: 1001 + i * 1000, hi: 15000 + i * 5000,
    mid: 8000 + i * 3000, openBand: false, txnDate: day(5 + i), filedDate: day(Math.floor(i / 3)), lagDays: 5 + i - Math.floor(i / 3),
    reporter: who, notes: named ? null : "Treasury Note " + (i + 1) + " [GS]",
  };
});
const PAYLOAD = {
  v: 2, generatedAt: "2026-10-16T21:31:53.908Z", sessionDate: "2026-10-16", readAt: READ_AT,
  carded: ["ALFA", "BRVO", "CLDR", "DUNE"], window: { from: "2026-07-18", to: "2026-10-16", days: WIN },
  source: { route: "recent-trades (date ladder)", pages: 8, pageLimit: 200, paginated: true, windowed: true },
  notes: L.POLITICAL_NOTES,
  buyers: { status: "ok", rows: [], seen: 0, cap: 25, shed: 0 },
  assets: { status: "ok", rows: RAW, seen: RAW.length, cap: 25, shed: 0 },
  clusters: { status: "ok", rows: RAW.filter((r) => r.filers >= MINF), seen: 0, cap: 25, shed: 0, minFilers: MINF, namesSeen: 279 },
  recent: { status: "ok", rows: RECENT, seen: 24, cap: 24, shed: 0 },
  filings: 1322, unusable: 0, latestFiled: ASOF, freshFilings: 8,
  holders: { status: "unavailable", reason: "not requested this run" },
};
const day = (n) => new Date(Date.parse(ASOF + "T00:00:00Z") - n * DAY).toISOString().slice(0, 10);
const CARDS = {
  ALFA: {
    v: 1, ticker: "ALFA", sessionDate: "2026-10-16", conviction: 64, regime: { label: "long", flowLabel: "short" },
    x: { vol: { iv30Pct: 0.4234, iv30: 0.318 } },
    panels: {
      premiumTrack: { status: "ok", rows: [{ d: day(3), p: -4400079 }, { d: day(2), p: 12500000 }, { d: day(1), p: -59700000 }, { d: day(0), p: null }] },
      scoreOverlay: { status: "ok", rows: [{ d: day(60), close: 180 }, { d: day(40), close: 200 }, { d: day(20), close: 210 }, { d: day(1), close: 220 }] },
      surface: { spot: 231 },
      congress: {
        status: "ok", asOf: ASOF,
        trades: [
          { member: "Dana Whitfield", chamber: "house", side: "buy", txnDate: day(50), filedDate: day(20), amountLow: 15001, amountHigh: 50000 },
          { member: "Dana Whitfield", chamber: "house", side: "buy", txnDate: day(30), filedDate: day(10), amountLow: 50001, amountHigh: 100000 },
          { member: "Omar Haddad", chamber: "senate", side: "sell", txnDate: day(25), filedDate: day(8), amountLow: 1001, amountHigh: 15000 },
          { member: "Lee Tran", chamber: "executive", side: "buy", txnDate: day(15), filedDate: day(2), amountLow: 250001, amountHigh: 500000 },
        ],
      },
    },
  },
  BRVO: { v: 1, ticker: "BRVO", sessionDate: "2026-10-15", panels: { premiumTrack: { status: "quiet", rows: [] }, scoreOverlay: { status: "ok", rows: [] }, surface: {} } },
  CLDR: { v: 1, ticker: "CLDR", sessionDate: "2026-10-16", conviction: 51, regime: { label: "short", flowLabel: "long" }, x: { vol: { iv30Pct: 0.9, iv30: 0.5 } }, panels: { premiumTrack: { status: "ok", rows: [{ d: day(1), p: 0 }] }, scoreOverlay: { status: "ok", rows: [] }, surface: { spot: 10 } } },
};

const ESTL = { accF: "Accumulating \u00b7 bounds agree", accM: "Leans accumulating", mix: "Mixed", redM: "Leans reducing" };
const usdT = (v, signed = false) => {
  const a = Math.abs(v);
  const t = [[1e9, 2, "B"], [1e6, 1, "M"], [1e3, 0, "K"]].find((u) => a >= u[0]);
  return (v < 0 ? MINUS : signed && v > 0 ? "+" : "") + "$" + (t ? (a / t[0]).toFixed(t[1]) + t[2] : a.toFixed(0));
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayT = (s) => MON[+s.slice(5, 7) - 1] + " " + +s.slice(8, 10);
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wdT = (s) => WD[new Date(s + "T00:00:00Z").getUTCDay()] + " " + dayT(s);
const fundsOf = (rows) => rows.filter((r) => L.FUND_TICKERS.includes(r.t));

const expectOf = (r) => {
  const net = r.bought - r.sold, g = r.bought + r.sold;
  const lo = r.boughtLo - 2 * r.sold, hi = r.boughtHi - r.sold / 8;
  const share = g > 0 ? net / g : 0, open = r.openBands > 0;
  const st = !open && lo > 0 ? "accF" : share >= 0.2 ? "accM" : share <= -0.2 ? "redM" : "mix";
  return { r, t: r.t, net, g, lo, hi, share, st, lag: r.medianLagDays, filers: r.filers, fund: L.FUND_TICKERS.includes(r.t) };
};
const EXP = RAW.map(expectOf);
const poolOf = (funds) => EXP.filter((x) => funds || !x.fund);
const TABS = {
  acc: (x) => x.net > 0, red: (x) => x.net < 0, cvg: (x) => x.filers >= MINF,
};
const ORDER = {
  acc: (a, b) => b.net - a.net, red: (a, b) => a.net - b.net, cvg: (a, b) => b.filers - a.filers || b.r.bought - a.r.bought,
};
const rowsFor = (tab, funds = false) => poolOf(funds).filter(TABS[tab]).sort(ORDER[tab]);

const mount = async (browser, w, h, o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(o.context || {}) });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date("2026-10-16T22:30:00Z"));
  const errors = [];
  const asked = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cardHits = {};
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-political.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
    if (u.pathname === "/assets/css/flows-political.css" && o.css) return r.fulfill({ contentType: "text/css", body: o.css });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
    if (u.pathname === "/api/flows/political") {
      if (o.political === "fail") return r.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(o.payload || PAYLOAD), headers: { "X-Payload-Updated": String(Date.parse(READ_AT)) } });
    }
    if (u.pathname === "/api/flows/card") {
      const t = u.searchParams.get("t");
      cardHits[t] = (cardHits[t] || 0) + 1;
      if (o.cardFail && o.cardFail === t && cardHits[t] === 1) return r.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      const c = CARDS[t];
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(c || { status: "absent" }) });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (u.pathname === "/flows/ticker/") return r.fulfill({ contentType: "text/html", body: "<title>ticker</title><p>ticker stub</p>" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || HTML });
  });
  await page.goto("https://example.test/flows/political/");
  await page.waitForFunction(() => document.querySelector(".pl-tile") || (document.getElementById("plNote") && !document.getElementById("plNote").hidden), null, { timeout: 15000 });
  await page.waitForTimeout(150);
  return { ctx, page, errors, asked, cardHits };
};

const fit = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  const inner = (el) => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5); };
  const dl = document.querySelector("dialog[open]");
  return { v: se.scrollHeight <= innerHeight, h: se.scrollWidth <= innerWidth, dlg: dl ? inner(dl) : true, sh: se.scrollHeight, ih: innerHeight, sw: se.scrollWidth, iw: innerWidth };
});

const clipped = (page) => page.evaluate(() => {
  const out = [];
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  for (const panel of document.querySelectorAll(".pl-panel")) {
    if (!vis(panel)) continue;
    const pr = panel.getBoundingClientRect();
    for (const el of panel.querySelectorAll("*")) {
      if (!vis(el) || el.closest("svg") && el.tagName !== "svg") continue;
      if (el.closest(".pl-listbox, .pl-map")) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1 || r.left < pr.left - 1 || r.top < pr.top - 1) out.push(panel.id + ":" + el.className + ":" + Math.round(r.bottom - pr.bottom));
      if ((el.matches(".kv, .pl-tk, .pl-st, .pl-chip, .pl-trow .bd span") && el.scrollWidth > el.clientWidth + 1)) out.push("text " + el.className + ":" + el.textContent.slice(0, 20));
    }
    for (const box of panel.querySelectorAll(".pl-listbox, .pl-map")) {
      if (!vis(box)) continue;
      const br = box.getBoundingClientRect();
      for (const c of box.children) { const r = c.getBoundingClientRect(); if (r.bottom > br.bottom + 1 || r.right > br.right + 1) out.push("child of " + box.id + " " + c.className + " " + Math.round(r.bottom - br.bottom)); }
    }
  }
  for (const el of document.querySelectorAll(".pl-chip, .pl-stamp")) if (vis(el) && el.scrollWidth > el.clientWidth + 1 && !el.matches(".pl-stamp")) out.push("chip " + el.textContent);
  return out;
});

const tilesOf = (page) => page.evaluate(() => {
  const host = document.getElementById("plMap");
  return { W: host.clientWidth, H: host.clientHeight, tiles: Array.from(document.querySelectorAll(".pl-tile"), (b) => {
    const s = b.style;
    const ring = b.querySelector("svg.ring");
    const cs = ring ? ring.querySelectorAll("circle") : [];
    return {
      t: b.dataset.t, cls: b.className.replace("pl-tile", "").trim(), w: parseFloat(s.width), h: parseFloat(s.height), x: parseFloat(s.left), y: parseFloat(s.top),
      aria: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed"), tab: b.tabIndex, text: b.innerText,
      blind: ring ? parseFloat(ring.dataset.blind) : null, dash: cs[1] ? cs[1].getAttribute("stroke-dasharray") : null,
      iv: parseFloat(s.getPropertyValue("--i")),
    };
  }) };
});

const railText = (page) => page.evaluate(() => {
  const g = (sel) => { const e = document.querySelector("#plRail " + sel); return e ? e.innerText : null; };
  const kv = (sel) => Array.from(document.querySelectorAll("#plRail " + sel + " .kv"), (e) => [e.children[0].textContent, e.children[1].textContent]);
  return {
    big: g(".big"), st: g(".pl-st"), why: g(".why"), dollars: kv(".first"), ctx: kv(".ctx"),
    ctxSub: g(".ctx .sub"), ctxHead: g(".ctx h3"), evSub: g(".ev .sub"), evHead: g(".ev h3"), monos: Array.from(document.querySelectorAll("#plRail .pl-mono"), (e) => e.textContent.replace(/\s+/g, " ").trim()),
    open: document.querySelector("#plRail .pl-open") ? document.querySelector("#plRail .pl-open").getAttribute("href") : null,
    stNote: g("#plStNote"), svgLabel: document.getElementById("plSvg") ? document.getElementById("plSvg").getAttribute("aria-label") : null,
  };
});

const strip = (page) => page.evaluate(() => {
  const svg = document.querySelector("#plSvg svg");
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const band = svg.querySelector("rect.band");
  return { W: vb.width, H: vb.height, band: band ? { x: parseFloat(band.getAttribute("x")), w: parseFloat(band.getAttribute("width")) } : null,
    tris: Array.from(svg.querySelectorAll("polygon.tri"), (p) => ({ k: p.classList.contains("buy") ? "buy" : "sell", txn: p.dataset.txn, filed: p.dataset.filed, pts: p.getAttribute("points") })) };
});

const settled = (page) => page.waitForFunction(() => { const e = document.querySelector("#plRail .ctx"); return !e || !e.offsetParent || !/appears here/.test(e.innerText); }, null, { timeout: 5000 }).catch(() => {});
const settleCtx = (page, want) => page.waitForFunction((w) => { const e = document.querySelector("#plRail .ctx"); return e && (w ? e.innerText.includes(w) : !/appears here/.test(e.innerText)); }, want || null, { timeout: 5000 });

async function exercise(browser, js, full) {
  const bad = [];
  const chk = (c, m) => { checks++; if (!c) bad.push(m); };
  const { ctx, page, errors, asked, cardHits } = await mount(browser, 1440, 820, { js });
  chk(errors.length === 0, "no page error: " + errors.join("; "));

  const sweep = await page.evaluate((ts) => ts.map((t) => { const r = document.querySelector('.pl-tile[data-t="' + t + '"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }), ["ALFA", "BRVO", "CLDR", "DUNE", "ECHO"]);
  for (const [x, y] of sweep) await page.mouse.move(x, y);
  await page.waitForTimeout(450);
  chk(Object.values(cardHits).reduce((a, b) => a + b, 0) <= 2, "sweeping the pointer across five tiles asks for the card it rests on, not one per tile: " + JSON.stringify(cardHits));
  await page.mouse.move(5, 5);

  const stamp = await page.locator("#plStamp").innerText();
  const readTrt = new Date(Date.parse(READ_AT) + 3 * 36e5);
  const want = "As disclosed through " + wdT(ASOF) + " \u00b7 read " + MON[readTrt.getUTCMonth()] + " " + readTrt.getUTCDate() + " " + String(readTrt.getUTCHours()).padStart(2, "0") + ":" + String(readTrt.getUTCMinutes()).padStart(2, "0") + " TRT \u00b7 " + WIN + "-day window";
  chk(stamp.replace(/\s+/g, " ") === want, "the stamp reads the disclosure date and the read time in TRT: " + stamp);

  const counts = await page.evaluate(() => Array.from(document.querySelectorAll("#plTabs button"), (b) => [b.dataset.id, b.querySelector("em").textContent, b.getAttribute("aria-selected")]));
  for (const [id, n] of counts) chk(n === String(rowsFor(id).length), "tab " + id + " counts the funds-hidden rows: " + n + " vs " + rowsFor(id).length);

  for (const tab of ["acc", "red", "cvg"]) {
    await page.click("#plTab-" + tab);
    await page.waitForTimeout(80);
    const expRows = rowsFor(tab);
    const { W, H, tiles } = await tilesOf(page);
    const top = expRows.slice().sort((a, b) => b.g - a.g).slice(0, 18);
    chk(JSON.stringify(tiles.map((t) => t.t).sort()) === JSON.stringify(top.map((t) => t.t).sort()), tab + ": the tiles are the largest disclosed names, funds hidden");
    const sum = top.reduce((s, x) => s + Math.sqrt(x.g), 0);
    for (const t of tiles) {
      const e = EXP.find((x) => x.t === t.t);
      const area = (t.w + 3) * (t.h + 3);
      const wantA = (Math.sqrt(e.g) / sum) * W * H;
      chk(Math.abs(area - wantA) <= wantA * 1e-4 + 0.5, tab + " " + t.t + ": tile area is its share of the square roots of disclosed dollars (" + area.toFixed(1) + " vs " + wantA.toFixed(1) + ")");
      chk(t.cls.split(" ")[0] === e.st, tab + " " + t.t + ": the state class is " + e.st + " not " + t.cls);
      chk(t.aria === t.t + ", " + ESTL[e.st] + ", net " + usdT(e.net, true) + " estimated, " + e.filers + (e.filers === 1 ? " distinct filer" : " distinct filers"), tab + " " + t.t + ": the aria label carries the state, the signed net and the breadth: " + t.aria);
      chk(Math.abs(t.iv - Math.min(1, Math.abs(e.share))) < 0.006, tab + " " + t.t + ": intensity is the midpoint share");
      if (e.lag === null) chk(t.blind === null, t.t + ": no ring without a lag");
      else if (t.blind !== null) {
        const f = Math.min(1, e.lag / WIN);
        chk(Math.abs(t.blind - f) < 6e-5, t.t + ": ring is the median lag over the window, clamped at one (" + t.blind + " vs " + f + ")");
        const c = 2 * Math.PI * 8;
        chk(t.dash === (c * f).toFixed(1) + " " + c.toFixed(1), t.t + ": the ring dash is the circumference times that share: " + t.dash);
      }
      if (e.share <= -0.2 || tab === "red") chk(!/bounds agree|Firm reducing/.test(t.aria), t.t + ": a sale is never firm");
    }
    chk(tiles.filter((t) => t.tab === 0).length === 1 && tiles.filter((t) => t.pressed === "true").length === 1, tab + ": one tab stop, one selected tile");
    chk(!tiles.some((t) => t.cls.includes("redF")), tab + ": no tile is firm reducing");
  }
  const reducingStates = EXP.filter((x) => x.net < 0 && !x.fund).map((x) => x.st);
  chk(reducingStates.includes("redM") && !reducingStates.includes("accF"), "the fixture holds a name whose high bound is below zero and the page still calls it a lean");
  await page.click("#plTab-acc");

  await page.click('.pl-tile[data-t="LIMA"]');
  await settleCtx(page).catch(() => {});
  let rt = await railText(page);
  const lima = EXP.find((x) => x.t === "LIMA");
  chk(rt.big === "LIMA" && rt.st.replace(/\s+/g, " ").includes("Mixed"), "the rail names the selection and its state");
  chk(JSON.stringify(rt.dollars) === JSON.stringify([["Buys", usdT(lima.r.bought)], ["Range", usdT(lima.r.boughtLo) + "\u2013" + usdT(lima.r.boughtHi)], ["Sells mid", usdT(lima.r.sold)], ["Net mid", usdT(lima.net, true)], ["Net low bound", usdT(lima.lo, true)]]), "disclosed dollars: buys, range, sells, net and the low bound (low = bought low - 2 x sold): " + JSON.stringify(rt.dollars));
  chk(rt.open === "/flows/ticker/?t=LIMA", "the rail opens the ticker page");

  await page.click('.pl-tile[data-t="ALFA"]');
  await page.waitForFunction(() => /Conviction/.test(document.querySelector("#plRail .ctx").innerText) && !/appears here/.test(document.querySelector("#plRail .ctx").innerText), null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => /64/.test(document.querySelector("#plRail .ctx").innerText), null, { timeout: 3000 }).catch(() => {});
  rt = await railText(page);
  const c = CARDS.ALFA;
  const nb = c.panels.congress.trades.filter((x) => x.side === "buy").sort((a, b) => (a.txnDate < b.txnDate ? 1 : -1))[0];
  const p0 = c.panels.scoreOverlay.rows.filter((r) => r.d <= nb.txnDate).pop().close;
  const since = c.panels.surface.spot / p0 - 1;
  const sinceT = (since > 0 ? "+" : since < 0 ? MINUS : "") + Math.abs(since * 100).toFixed(1) + "%";
  const ctxWant = [["Conviction", "64 /100"], ["IV rank", "42 \u00b7 IV 31.8%"], ["Dealer \u03b3 book", "Long"], ["Dealer \u03b3 flow", "Short"], ["Premium C\u2212P", MINUS + "$59.7M"], ["Price since", sinceT]];
  chk(JSON.stringify(rt.ctx) === JSON.stringify(ctxWant), "Flows context reads the card: conviction, IV rank, both dealer gammas, the last net premium and the price since the newest buy: " + JSON.stringify(rt.ctx) + " vs " + JSON.stringify(ctxWant));
  chk(/card Oct 16/.test(rt.ctxHead), "the card date is printed");
  chk(rt.monos.length === 3 && /From the card's disclosure list: 4 filings, 3 filers\. House 1 \u00b7 Senate 1 \u00b7 Exec 1\./.test(rt.evSub), "evidence names filers by initials and splits House, Senate and Executive apart: " + rt.evSub);
  chk(rt.monos.some((m) => /^LT\s?E/.test(m)) && !rt.monos.some((m) => /^LT\s?H/.test(m)), "an executive filer is marked E, never counted as a chamber");
  const st = await strip(page);
  chk(st && st.tris.length === 4, "the strip draws every filing in the window");
  if (st) {
    const asMs = Date.parse(ASOF + "T00:00:00Z"), start = asMs - 90 * DAY, end = asMs + DAY * 0.5, Lm = 4, Rm = 6;
    const xs = (d) => Lm + ((d - start) / (end - start)) * (st.W - Lm - Rm);
    const alfa = EXP.find((x) => x.t === "ALFA");
    const bx = Math.max(Lm, xs(asMs - alfa.lag * DAY));
    chk(st.band && Math.abs(st.band.x - bx) < 0.01 && Math.abs(st.band.x + st.band.w - (st.W - Rm)) < 0.01, "the blind window starts median-lag days before the cut and runs to the edge: " + JSON.stringify(st.band) + " vs " + bx);
    const buys = st.tris.filter((t) => t.k === "buy").length;
    chk(buys === 3 && st.tris.length - buys === 1, "buys point up and sales down by the filing's own side");
  }

  await page.click('.pl-tile[data-t="BRVO"]');
  await page.waitForFunction(() => /Not on the card/.test(document.querySelector("#plRail .ctx").innerText), null, { timeout: 5000 }).catch(() => {});
  rt = await railText(page);
  chk(rt.ctx.every(([k, v]) => v === DASH || v.startsWith(DASH + " ")), "a card with no volatility, regime or premium shows a dash for each, never a zero: " + JSON.stringify(rt.ctx));
  chk(/Not on the card: conviction, IV rank, dealer gamma, net premium\./.test(rt.ctxSub || ""), "and names what the card lacked: " + rt.ctxSub);

  await page.click('.pl-tile[data-t="DUNE"]');
  await page.waitForFunction(() => /No Flows card/.test(document.querySelector("#plRail .ctx").innerText), null, { timeout: 5000 }).catch(() => {});
  rt = await railText(page);
  chk(rt.ctx.every(([, v]) => v === DASH) && /No Flows card/.test(rt.ctxSub), "no card at all: every value is a dash with its reason: " + rt.ctxSub);
  chk(/names not in feed|rows/.test(rt.evHead), "evidence says whether names are in the feed");

  chk(asked.filter((a) => a === "/api/flows/political").length === 1, "the political row is read once");
  chk(asked.every((a) => a === "/api/flows/political" || /^\/api\/flows\/card\?t=[A-Z]+$/.test(a)), "no request beyond the political row and one card per name: " + asked.join(","));
  chk(Object.values(cardHits).every((n) => n === 1), "a card is asked once per name and then remembered: " + JSON.stringify(cardHits));

  if (!full) { await ctx.close(); return bad; }

  await page.click("#plTab-cvg");
  await page.focus('.pl-tile[tabindex="0"]');
  const sel0 = await page.evaluate(() => document.activeElement.dataset.t);
  const centre = (t) => page.evaluate((x) => { const b = document.querySelector('.pl-tile[data-t="' + x + '"]'); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, t);
  let prev = await centre(sel0);
  const moved = [];
  for (const [key, axis, sign] of [["ArrowRight", 0, 1], ["ArrowDown", 1, 1], ["ArrowLeft", 0, -1], ["ArrowUp", 1, -1]]) {
    await page.keyboard.press(key);
    const t = await page.evaluate(() => document.activeElement.dataset.t);
    const pr = await page.evaluate(() => document.querySelector('.pl-tile[aria-pressed="true"]').dataset.t);
    const now = await centre(t);
    if (t !== sel0 || moved.length) moved.push(t);
    chk(pr === t, key + ": the focused tile is the selected one");
    chk(t === sel0 || (now[axis] - prev[axis]) * sign > 0, key + ": focus moves that way by geometry (" + sel0 + "->" + t + ")");
    prev = now;
  }
  chk(new Set(moved).size >= 2, "arrow keys visit different tiles");
  const hit = await page.evaluate(() => document.activeElement.dataset.t);
  await Promise.all([page.waitForURL((u) => u.pathname === "/flows/ticker/"), page.keyboard.press("Enter")]).catch(() => bad.push("Enter did not open the ticker page"));
  chk(page.url().endsWith("/flows/ticker/?t=" + hit), "Enter opens the ticker page for the focused tile: " + page.url());
  await ctx.close();
  return bad;
}

const ORACLE_HTML = PAGES.oracleShell(HTML, "on", "political");
const WHISKERS = "Whiskers give the low to high bound.";

const layoutOf = (page) => page.evaluate(() => {
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const orb = document.querySelector(".orc-orb");
  const o = orb && vis(orb) ? orb.getBoundingClientRect() : null;
  const under = [];
  if (o) {
    for (const el of document.querySelectorAll(".pl *")) {
      if (el.children.length || !vis(el) || !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.right > o.left && r.left < o.right && r.bottom > o.top && r.top < o.bottom) under.push(el.className + ":" + el.textContent.trim().slice(0, 24));
    }
  }
  const wide = [];
  for (const el of document.querySelectorAll(".pl-title, .pl-stamp, .pl-chips, .pl-chip, .pl-ph, .pl-seg, .pl-foot, .pl-acts, .pl-rhead, .pl-rc h3, .pl-seg5")) {
    if (vis(el) && el.scrollWidth > el.clientWidth + 1) wide.push(el.className + ":" + el.textContent.trim().slice(0, 24));
  }
  for (const b of document.querySelectorAll(".pl-seg button, .pl-seg5 button")) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect();
    if (r.left < p.left - 1 || r.right > p.right + 1) wide.push("tab cut:" + b.textContent.trim());
  }
  const fn = document.getElementById("plFnote");
  const pl = document.getElementById("pl");
  return {
    orb: !!o, under, wide, plW: pl.getBoundingClientRect().width,
    switch: vis(document.getElementById("plSeg5")),
    dock: document.body.classList.contains("has-dock-open"),
    fnote: fn && vis(fn) ? { text: fn.textContent, cut: fn.scrollHeight > fn.clientHeight + 1 } : null,
    tiles: document.querySelectorAll("#plMap .pl-tile").length,
  };
});

async function layoutProblems(browser, o = {}) {
  const bad = [];
  const chk = (c, m) => { checks++; if (!c) bad.push(m); };
  const scenes = [
    { w: 1440, h: 820, dock: false, ctx: {} },
    { w: 1440, h: 820, dock: true, ctx: {} },
    { w: 1180, h: 820, dock: false, ctx: {} },
    { w: 1920, h: 1080, dock: true, ctx: {} },
    { w: 390, h: 844, dock: false, ctx: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ];
  for (const sc of scenes) {
    const tag = sc.w + "x" + sc.h + (sc.dock ? " with the Ask dock open" : "");
    const { ctx, page, errors } = await mount(browser, sc.w, sc.h, { context: sc.ctx, html: ORACLE_HTML, js: o.js, css: o.css });
    await page.waitForFunction(() => document.querySelector(".orc-orb"), null, { timeout: 10000 }).catch(() => bad.push(tag + ": the orb never mounted"));
    if (sc.dock) {
      await page.click("#askDockTab");
      await page.waitForFunction(() => document.body.classList.contains("has-dock-open"), null, { timeout: 5000 }).catch(() => bad.push(tag + ": the dock did not open"));
      await page.waitForTimeout(300);
    }
    let L0 = await layoutOf(page);
    chk(L0.orb, tag + ": the orb is on the page");
    const compact = L0.plW < 900;
    chk(L0.switch === compact, tag + ": the panel switch shows exactly when the page is under 900 px wide (" + Math.round(L0.plW) + " px, switch " + L0.switch + ")");
    const views = compact ? ["stocks", "tape", "detail"] : ["stocks"];
    for (const v of views) {
      if (compact) { await page.click('#plSeg5 [data-v="' + v + '"]'); await page.waitForTimeout(150); }
      const tabs = v === "stocks" ? ["acc", "red", "cvg"] : [null];
      for (const tab of tabs) {
        for (const view of v === "stocks" ? ["map", "list"] : [null]) {
          if (tab) { await page.click("#plTab-" + tab); await page.click('#plViewSeg [data-view="' + view + '"]'); await page.waitForTimeout(120); }
          const label = tag + " " + v + (tab ? " " + tab + " " + view : "");
          await settled(page);
          const L = await layoutOf(page);
          const f = await fit(page);
          chk(f.v && f.h, label + ": the page does not scroll (" + f.sh + " of " + f.ih + ", " + f.sw + " of " + f.iw + ")");
          const cl = await clipped(page);
          chk(cl.length === 0, label + ": nothing clipped or past its panel: " + cl.slice(0, 3).join(", "));
          chk(L.wide.length === 0, label + ": no title, stamp, tab, caption or rail heading is cut: " + L.wide.slice(0, 3).join(", "));
          chk(L.under.length === 0, label + ": nothing the reader needs sits under the orb: " + L.under.join(", "));
          if (L.fnote) {
            chk(!L.fnote.cut, label + ": the caption is shown whole, not cut with an ellipsis: " + L.fnote.text);
            chk(view === "list" ? L.fnote.text.endsWith(WHISKERS) : !/whisker/i.test(L.fnote.text), label + ": the caption names whiskers only where the list draws them: " + L.fnote.text);
          }
          if (view === "map") chk(L.tiles === Math.min(compact ? 12 : 18, rowsFor(tab).length), label + ": " + (compact ? "the compact layout draws at most 12 tiles" : "the wide layout draws at most 18 tiles") + " (" + L.tiles + ")");
        }
      }
    }
    chk(errors.length === 0, tag + ": no page error: " + errors.join("; "));
    await ctx.close();
  }
  return bad;
}

const LAYOUT_MUTANTS = [
  ["the compact layout keyed to the viewport again", "css", "@container pl (max-width: 899.98px) {\n  .pl-title {", "@media (max-width: 899px) {\n  .pl-title {"],
  ["the context reasons printed in the narrow desktop column", "css", ".pl-rc.ctx .kv small.why { display: none; }", ""],
  ["no end space for the orb in the switch layout", "css", ".flows-body:has(#fxOracle:not([hidden])) .pl-acts, .flows-body:has(#fxOracle:not([hidden])) .pl-rc.ev { padding-inline-end: 56px; }", ""],
  ["the selection bar running under the orb", "css", ".flows-body:has(#fxOracle:not([hidden])) .pl-selbar { width: calc(100% - 72px); }", ""],
  ["the caption clamped to two lines", "css", "-webkit-line-clamp: 3;", "-webkit-line-clamp: 2;"],
  ["the tile cap keyed to the viewport again", "js", "const mobile = () => { const pl = document.getElementById(\"pl\"); return pl ? pl.getBoundingClientRect().width < 900 : matchMedia(\"(max-width:899px)\").matches; };", "const mobile = () => matchMedia(\"(max-width:899px)\").matches;"],
  ["whiskers named under the map", "js", "tabNote(tab, false)", "tabNote(tab, true)"],
];

const browser = await launch();

{
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(JS, sandbox);
  const T = sandbox.__PoliticalTest;
  ok(T && typeof T.netBounds === "function", "the page exposes its pure functions only where there is no document");
  eq([...T.FUNDS].sort(), [...L.FUND_TICKERS].sort(), "the page's fund list equals the leaf's");
  const rows = [...RAW, { ...RAW[0], boughtLo: null }, { ...RAW[0], sold: undefined }, { ...RAW[1], openBands: 2 }, { t: "Z", bought: 0, boughtLo: 0, boughtHi: 0, sold: 0, openBands: 0 }, { ...RAW[2], bought: 1e9, boughtLo: 9e8, boughtHi: 11e8, sold: 1e8 }];
  for (const r of rows) {
    const a = T.netBounds(r), b = L.netBounds(r);
    eq(a && { mid: a.mid, lo: a.lo, hi: a.hi }, b, "netBounds equals the leaf for " + r.t);
    eq(T.stateOf(r), L.stateOf(r), "stateOf equals the leaf for " + r.t);
    eq(T.weight(r, "usd"), L.treemapWeight(r, "usd"), "weight usd");
    eq(T.weight(r, "fil"), L.treemapWeight(r, "fil"), "weight filers");
  }
  for (const lag of [null, 0, 12, 90, 200, -3]) eq(T.blind(lag, 90), L.blindShare(lag, 90), "blind share for " + lag);
  eq(T.blind(10, null), null, "no window, no share");
  eq(T.stateOf({ bought: 1e6, boughtLo: 5e5, boughtHi: 15e5, sold: 0, openBands: 0 }), "accF", "a clean buy is firm");
  eq(T.stateOf({ bought: 1e6, boughtLo: 5e5, boughtHi: 15e5, sold: 0, openBands: 1 }), "accM", "an open band is never firm");
  eq(T.stateOf({ bought: 10, boughtLo: 5, boughtHi: 15, sold: 1e7, openBands: 0 }), "redM", "no sale is ever firm");
  const tm = T.squarify([{ v: 4 }, { v: 3 }, { v: 2 }, { v: 1 }], 0, 0, 100, 50);
  ok(Math.abs(tm.reduce((s, z) => s + z.w * z.h, 0) - 5000) < 1e-6, "the squarified tiles fill the box exactly");
  for (const z of tm) ok(Math.abs(z.w * z.h - (z.i.v / 10) * 5000) < 1e-6, "each tile's area is its share of the weights");
}

{
  ok(!COLOUR_LITERAL.test(CSS) && !COLOUR_FN.test(JS.replace(/&#39;/g, "")), "neither the sheet nor the script holds a colour literal: tokens only");
  ok(COLOUR_LITERAL.test(CSS + "\n.x { color: #fff; }") && COLOUR_LITERAL.test(CSS + "\n.x { background: rgba(0, 0, 0, 0.5); }"), "and the scan catches a planted literal");
  ok(!/(^|[^-\w])transition\b/.test(CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "")), "every transition sits inside no-preference");
  ok(!forbidden(HTML.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<aside class="ak-dock"[\s\S]*?<\/aside>/, "").replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "")), "no forbidden word in the page's own text");
  ok(forbidden("an unusual screen") && forbidden("a NOW badge") && forbidden("at the ask") && !forbidden("now that it is open"), "and the lint catches planted words and lets the ordinary word through");
  ok(/\/assets\/js\/flows-political\.js\?v=\d+/.test(HTML) && /\/assets\/css\/flows-political\.css\?v=\d+/.test(HTML), "script and sheet are versioned");
  ok(/data-fx-hero/.test(HTML) && (HTML.match(/<h1[ >]/g) || []).length === 1, "one h1");
  ok(/Ranges, not amounts/.test(HTML) && /No party in feed/.test(HTML) && /Not advice/.test(HTML), "the three chips are in the served HTML");
  eq((HTML.match(/party in feed|party not in feed/gi) || []).length, 1, "the party chip is one string at every width, not a long and a short wording");
  ok(!/\bglobalThis\.|(?<![\w.])window\.[A-Za-z]+\s*=(?!=)/.test(JS.replace(/globalThis\.__PoliticalTest/, "")), "no new global");
  ok(!/\bredF\b/.test(JS + CSS) && !/Firm reducing|Reducing \\u00b7 bounds agree/.test(JS), "the code has no firm-reducing state at all");
}

const VIEWPORTS = [[1440, 820, {}], [1024, 768, {}], [390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]];
for (const [w, h, extra] of VIEWPORTS) {
  const { ctx, page, errors, asked } = await mount(browser, w, h, { context: extra });
  const phone = w < 900;
  eq(await page.evaluate(() => matchMedia("(pointer:coarse)").matches), phone, w + ": the phone context is a coarse pointer and the others are not");
  const states = [];
  const check = async (label) => {
    await settled(page);
    const f = await fit(page);
    ok(f.v && f.h, w + "x" + h + " " + label + ": the page does not scroll (" + f.sh + " of " + f.ih + ", " + f.sw + " of " + f.iw + ")");
    ok(f.dlg, w + "x" + h + " " + label + ": an open dialog sits inside the viewport");
    const cl = await clipped(page);
    eq(cl, [], w + "x" + h + " " + label + ": nothing clipped or past its panel");
    states.push(label);
  };
  const views = phone ? ["stocks", "tape", "detail"] : ["stocks"];
  for (const v of views) {
    if (phone) { await page.click('#plSeg5 [data-v="' + v + '"]'); await page.waitForTimeout(120); }
    if (v === "stocks") {
      for (const tab of ["acc", "red", "cvg"]) {
        for (const view of ["map", "list"]) {
          await page.click("#plTab-" + tab);
          await page.click('#plViewSeg [data-view="' + view + '"]');
          await page.waitForTimeout(100);
          await check(v + " " + tab + " " + view);
        }
      }
      await page.click('#plViewSeg [data-view="map"]');
      await page.click("#plTab-acc");
      await page.click('#plSizeSeg [data-size="fil"]');
      await page.waitForTimeout(80);
      await check("filers sizing");
      const { W, H, tiles } = await tilesOf(page);
      const rowsAll = rowsFor("acc");
      const cap = phone ? 12 : 18;
      const wf = (x) => x.filers + Math.sqrt(x.g) / 4e3;
      const top = rowsAll.slice().sort((a, b) => b.filers - a.filers || b.g - a.g).slice(0, cap);
      const sum = top.reduce((s, x) => s + wf(x), 0);
      for (const t of tiles) { const e = EXP.find((x) => x.t === t.t); const a = (t.w + 3) * (t.h + 3); ok(Math.abs(a - (wf(e) / sum) * W * H) <= 1e-3 * a + 1e-3, w + " filers sizing: " + t.t + " area follows its filers"); }
      await page.click('#plSizeSeg [data-size="usd"]');
      if (phone) {
        const small = (await tilesOf(page)).tiles.filter((t) => Math.min(t.w, t.h) < 44).map((t) => t.t);
        eq(small, [], "phone tiles are at least 44 px on each side");
      }
      await page.click('#plFundBtn');
      await page.waitForTimeout(80);
      const withFunds = await page.evaluate(() => Array.from(document.querySelectorAll("#plTabs em"), (e) => e.textContent));
      eq(withFunds, ["acc", "red", "cvg"].map((t) => String(rowsFor(t, true).length)), w + ": including funds changes the counts");
      await page.click('#plFundBtn');
      const fundText = await page.locator("#plFundBtn").innerText();
      eq(fundText, fundsOf(RAW).length + " funds hidden \u00b7 Include", "the fund toggle says how many are hidden");
      await page.click("#plAllBtn");
      await page.waitForTimeout(80);
      eq(await page.locator("#plAllG button").count(), rowsFor("acc").length, w + ": Show all lists every name in the tab");
      eq(await page.locator("#plAllT").innerText(), "Accumulating: all " + rowsFor("acc").length + " stocks", "the dialog title");
      await check("show all dialog");
      if (!phone) {
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowDown");
        const f = await page.evaluate(() => document.activeElement.closest("#plAllG") !== null);
        ok(f, "arrows move inside the dialog grid");
      }
      await page.keyboard.press("Escape");
      await page.click("#plInfoBtn");
      await page.waitForTimeout(80);
      const info = await page.locator("#plInfoB").innerText();
      for (const n of [L.POLITICAL_NOTES.unit, L.POLITICAL_NOTES.lag, L.POLITICAL_NOTES.refusals]) ok(info.replace(/\s+/g, " ").includes(n), "the info dialog carries the payload's own honesty note");
      ok(/no name is ever called a firm reduction/.test(info) && /no party field/.test(info), "and says sales are midpoints only and party is not in the feed");
      await check("info dialog");
      await page.keyboard.press("Escape");
    }
    if ((phone && v === "tape") || (!phone && v === "stocks")) {
      const named = RECENT.filter((r) => r.t);
      const shown = await page.locator("#plTapeList .pl-trow").count();
      const rh = phone ? 44 : 36;
      const fits = await page.evaluate((x) => Math.max(4, Math.floor(document.getElementById("plTapeList").clientHeight / x)), rh);
      eq(shown, Math.min(named.length, fits), "the tape shows only filings that name a stock, as many as fit");
      eq(await page.locator("#plTapeNote").innerText(), "24 latest \u00b7 " + named.length + " name a stock", "its note counts both");
      await page.click("#plTapeAll");
      await page.waitForTimeout(80);
      eq(await page.locator("#plTapeL li").count(), 24, "the tape dialog lists every filing");
      const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll("#plTapeL li b"), (e) => e.textContent).filter((t) => /Treasury/.test(t)).length);
      eq(unnamed, 24 - named.length, "an unnamed filing shows its asset text");
      await check("tape dialog");
      await page.keyboard.press("Escape");
    }
    await check(v);
  }
  if (phone) {
    const bad = await page.evaluate(() => Array.from(document.querySelectorAll(".pl-seg5 button, .pl-panel button, .pl-open, .pl-ibtn"), (b) => { const r = b.getBoundingClientRect(); return r.width && r.height && Math.min(r.width, r.height) < 43.5 && !b.closest("[hidden]") && getComputedStyle(b).display !== "none" && !b.matches(".pl-tile") ? b.className + ":" + b.textContent.slice(0, 12) + ":" + Math.round(r.height) : null; }).filter(Boolean));
    eq(bad, [], "coarse pointer: every control in view is 44 px");
  }
  eq(errors, [], w + ": no page error");
  eq(asked.filter((a) => !/^\/api\/flows\/(political|card\?t=[A-Z]+)$/.test(a)), [], w + ": no request beyond the political row and cards");
  await ctx.close();
}

{
  const { ctx, page, errors } = await mount(browser, 1440, 820);
  eq(await page.evaluate(() => document.getAnimations().length), 0, "reduced motion: nothing animates");
  await page.click("#plTab-red");
  const reducing = await page.evaluate(() => Array.from(document.querySelectorAll("#plTabs button"), (b) => b.getAttribute("aria-selected")));
  eq(reducing, ["false", "true", "false"], "the Reducing tab is selected");
  await page.focus("#plTab-red");
  await page.keyboard.press("ArrowRight");
  eq(await page.evaluate(() => document.activeElement.dataset.id), "cvg", "ArrowRight moves to Convergence and focuses it");
  await page.keyboard.press("Home");
  eq(await page.evaluate(() => document.activeElement.dataset.id), "acc", "Home returns to Accumulating");
  await page.keyboard.press("End");
  eq(await page.evaluate(() => document.activeElement.dataset.id), "cvg", "End goes to Convergence");
  await page.click("#plTab-acc");
  await page.click('#plViewSeg [data-view="list"]');
  await page.waitForTimeout(100);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll("#plList .pl-row"), (r) => r.dataset.t));
  const nrows = names.length;
  eq(names, rowsFor("acc").slice(0, nrows).map((x) => x.t), "the list is ranked by net, largest first");
  const nums = await page.evaluate(() => Array.from(document.querySelectorAll("#plList .pl-row"), (r) => r.querySelector(".pl-num").innerText.replace(/\s+/g, " ")));
  ok(nums.slice(0, 3).every((t, i) => t.includes(usdT(rowsFor("acc")[i].net, true)) && t.includes(usdT(rowsFor("acc")[i].lo) + " to " + usdT(rowsFor("acc")[i].hi))), "each row prints the signed net and its low to high range: " + nums[0]);
  await page.click('.pl-bh [data-sort="filers"]');
  const byF = await page.evaluate(() => Array.from(document.querySelectorAll("#plList .pl-row"), (r) => r.dataset.t));
  eq(byF.slice(0, nrows - 1), rowsFor("acc").sort(ORDER.cvg).slice(0, nrows - 1).map((x) => x.t), "sorting by filers");
  await page.click('.pl-bh [data-sort="lag"]');
  const byL = await page.evaluate(() => Array.from(document.querySelectorAll("#plList .pl-row"), (r) => r.dataset.t));
  eq(byL.slice(0, nrows - 1), rowsFor("acc").sort((a, b) => (b.lag || 0) - (a.lag || 0) || b.g - a.g).slice(0, nrows - 1).map((x) => x.t), "sorting by still blind");
  await page.click('.pl-bh [data-sort="net"]');
  await page.focus('#plList .pl-row[tabindex="0"]');
  await page.keyboard.press("ArrowDown");
  const sel1 = await page.evaluate(() => document.querySelector('#plList .pl-row[aria-selected="true"]').dataset.t);
  eq(sel1, names[1], "ArrowDown in the list selects the next row");
  await page.keyboard.press("End");
  eq(await page.evaluate(() => document.activeElement.dataset.t), names[nrows - 1], "End goes to the last row");
  await page.keyboard.press("Home");
  eq(await page.evaluate(() => document.activeElement.dataset.t), names[0], "Home to the first");
  await page.click('#plViewSeg [data-view="map"]');
  const visible = await page.evaluate(() => document.querySelector("main").innerText + " " + Array.from(document.querySelectorAll("dialog")).map((d) => d.textContent).join(" "));
  ok(!forbidden(visible), "no forbidden word anywhere on the page");
  const hyphenMinus = await page.evaluate(() => /(^|[\s(])-\$?\d/.test(document.getElementById("pl").innerText));
  ok(!hyphenMinus, "no hyphen stands in for a minus sign");
  eq(errors, [], "no page error");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, 820, { cardFail: "CLDR" });
  await page.click('.pl-tile[data-t="CLDR"]');
  await page.waitForFunction(() => /could not be read/.test(document.querySelector("#plRail .ctx").innerText), null, { timeout: 5000 });
  const failed = await railText(page);
  ok(failed.ctx.every(([, v]) => v === DASH) && /The Flows card for CLDR could not be read \(HTTP 500\)\. The filings are unaffected\./.test(failed.ctxSub), "a failed card read is a stated failure with every value a dash: " + failed.ctxSub);
  eq(await page.locator("#plRail .pl-rc.first .kv").count(), 5, "and the filings half of the rail is untouched");
  await page.click('#plRail [data-retry="CLDR"]');
  await page.waitForFunction(() => /51 \/100/.test(document.querySelector("#plRail .ctx").innerText), null, { timeout: 5000 });
  const again = await railText(page);
  eq(again.ctx[0], ["Conviction", "51 /100"], "Retry reads the card again");
  eq(again.ctx[4], ["Premium C\u2212P", "$0"], "and a premium of exactly zero is printed as zero, not as a dash");
  await ctx.close();
}

{
  const unreadable = await mount(browser, 1440, 820, { political: "fail" });
  const t = await unreadable.page.locator("#plNote").innerText();
  ok(/could not be loaded: HTTP 500/.test(t), "an unreadable payload is a stated failure: " + t);
  eq(await unreadable.page.evaluate(() => document.getElementById("plNote").dataset.empty), "unavailable", "marked unavailable");
  ok(!/Loading/.test(await unreadable.page.locator("main").innerText()), "and nothing still says loading");
  ok((await fit(unreadable.page)).v, "and the page still fits");
  await unreadable.ctx.close();
  const pending = await mount(browser, 1440, 820, { payload: { v: 2, status: "pending" } });
  ok(/No disclosure window has been read yet/.test(await pending.page.locator("#plNote").innerText()), "a pending payload says so");
  await pending.ctx.close();
  const quiet = await mount(browser, 1440, 820, { payload: { ...PAYLOAD, assets: { status: "quiet", rows: [] }, clusters: { status: "quiet", rows: [] } } });
  ok(/held no purchase/.test(await quiet.page.locator("#plNote").innerText()), "an empty window says it held nothing to rank");
  await quiet.ctx.close();
}

{
  const bad = await exercise(browser, undefined, true);
  eq(bad, [], "the page passes the whole exercise: " + bad.slice(0, 3).join(" | "));
}

{
  const bad = await layoutProblems(browser);
  eq(bad, [], "with the orb mounted and the Ask dock open or closed, at 1920, 1440, 1180 and 390 px, the page fits, nothing is cut and nothing sits under the orb: " + bad.slice(0, 3).join(" | "));
  for (const [name, kind, from, to] of LAYOUT_MUTANTS) {
    const src = kind === "css" ? CSS : JS;
    ok(src.split(from).length === 2, "the planted layout build changes the " + kind + " exactly once: " + name);
    const problems = await layoutProblems(browser, kind === "css" ? { css: src.replace(from, to) } : { js: src.replace(from, to) }).catch((e) => ["threw: " + String(e.message).split("\n")[0]]);
    ok(problems.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (" + problems.length + " failures, first: " + problems[0] + ")");
  }
}

const MUTANTS = [
  ["2 x sold replaced by sold", "return { mid: B - S, lo: lo - 2 * S, hi: hi - S / 8 };", "return { mid: B - S, lo: lo - S, hi: hi - S / 8 };"],
  ["sold bound used as the bought bound", "return { mid: B - S, lo: lo - 2 * S, hi: hi - S / 8 };", "return { mid: B - S, lo: lo - 2 * B, hi: hi - S / 8 };"],
  ["the Accumulating tab counts sellers", "{ id: \"acc\", label: \"Accumulating\", f: (x) => x.net > 0,", "{ id: \"acc\", label: \"Accumulating\", f: (x) => x.net < 0,"],
  ["funds counted", "fund: FUNDS.has(String(r.t).toUpperCase()),", "fund: false,"],
  ["low and high bound swapped in the rail", "kv(\"Net low bound\", smoney(x.lo))", "kv(\"Net low bound\", smoney(x.hi))"],
  ["an executive counted as a chamber", "const chOf = (m) => (m === \"senate\" ? \"S\" : m === \"executive\" ? \"E\" : \"H\");", "const chOf = (m) => (m === \"senate\" ? \"S\" : \"H\");"],
  ["tile area linear in dollars", "Math.sqrt(g) / 4e3 : Math.sqrt(g);", "Math.sqrt(g) / 4e3 : g;"],
  ["a missing conviction shown as zero", "cf.conviction === null ? gap(\"not on the card\") : cf.conviction + \" /100\"", "cf.conviction === null ? \"0 /100\" : cf.conviction + \" /100\""],
  ["the read time printed in UTC", "fday(day) + \" \" + F.time(readAt)", "fday(day) + \" \" + new Date(readAt).toISOString().slice(11, 16) + \" UTC\""],
  ["a firm reduction resurrected", "if (share <= -0.2) return \"redM\";", "if (b.hi < 0 && !open) return \"redF\"; if (share <= -0.2) return \"redM\";"],
  ["the ring drawn as the unfiled share's complement", "(c * f).toFixed(1)", "(c * (1 - f)).toFixed(1)"],
  ["the blind window twice as long", "const bx = Math.max(L, xs(asMs - x.lag * DAY));", "const bx = Math.max(L, xs(asMs - x.lag * DAY * 2));"],
  ["Convergence off by one", "f: (x) => x.filers >= minFilers,", "f: (x) => x.filers > minFilers,"],
  ["a hyphen for a minus", "const smoney = (v) => usd(v, true);", "const smoney = (v) => usd(v, true).replace(\"\\u2212\", \"-\");"],
  ["every hover asks for a card at once", "if (now) run(); else cardTimer = setTimeout(() => { if (S.sel === t) run(); }, 220);", "run();"],
];
for (const [name, from, to] of MUTANTS) {
  ok(JS.split(from).length === 2, "the planted build changes the module exactly once: " + name);
  const mutated = JS.replace(from, to);
  const problems = await exercise(browser, mutated, false).catch((e) => ["threw: " + String(e.message).split("\n")[0]]);
  ok(problems.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (" + problems.length + " failures, first: " + problems[0] + ")");
}

await browser.close();
console.log(`✓ flows-political-render: ${checks} assertions — the Political page in Chromium against a synthetic payload of the real shape, no server: no page scroll, no clipped cell and every dialog inside the viewport at 1440x820, 1024x768 and 390x844 in every tab, view and panel; tile areas equal to the square roots of disclosed dollars and to filers; states, rings and bounds equal to independent sums with no firm reduction anywhere; the strip's blind window; Flows context read from the card with dashes and reasons, a failure and a Retry; the keyboard; 44 px targets; reduced motion; the stamp in TRT; the page's pure functions equal to the leaf's; no colour literal, no forbidden word, no hyphen minus; the page with the orb mounted and the Ask dock open or closed at 1920, 1440, 1180 and 390 px, laid out by its own width with nothing cut and nothing under the orb; and ${MUTANTS.length + LAYOUT_MUTANTS.length} planted wrong builds that each fail`);
