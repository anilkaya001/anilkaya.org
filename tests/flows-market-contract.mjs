import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";
import { marketAggregate, MARKET_NOTES } from "../shared/flows-market.js";

import { REFRESH_CADENCE_MINUTES } from "../shared/flows-freshness.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

const seenSilences = new Map();
const sawSilence = (kind, text) => { if (kind) seenSilences.set(kind, text); };

{
  const row = (t, over) => Object.assign({
    ticker: t,
    net_call_premium: "1000", net_put_premium: "400",
    call_volume: "100", put_volume: "50",
    call_premium: "900", put_premium: "300",
    call_volume_ask_side: "60", call_volume_bid_side: "40",
    put_volume_ask_side: "20", put_volume_bid_side: "30",
    iv30d: "0.30",
  }, over);

  const rows = [
    row("A"),
    row("B", { net_call_premium: "100", net_put_premium: "900" }),
    row("C", { net_call_premium: "0", net_put_premium: undefined }),
    row("D", { net_call_premium: undefined, net_put_premium: undefined }),
    row("E", { net_call_premium: "500", net_put_premium: "500" }),
  ];
  const tilts = new Map([["A", { ivRank: 0.2 }], ["B", { ivRank: 0.8 }]]);
  const m = marketAggregate(rows, tilts, { screened: 9 });

  eq(m.n, 5, "n is the eligible population handed in");
  eq(m.screened, 9, "and the screened count rides along, because 5 of 9 and 5 of 500 differ");

  eq(m.premium.priced, 3, "only rows quoting BOTH legs are priced");
  eq(m.premium.oneLegged, 1, "the one-legged row is counted, not folded in");
  eq(m.breadth.unpriced, 2, "and both it and the no-leg row are excluded from every total");
  eq(m.breadth.flat, 1,
     "`flat` is ONE — the row that genuinely quoted equal legs. The one-legged row is NOT " +
     "flat: a name whose put side was never quoted is not a name whose sides were equal");
  eq(m.premium.net, -200, "net premium sums only the priced rows: +600 − 800 + 0");
  eq(m.premium.netPositive, 600, "positives and negatives are reported apart");
  eq(m.premium.netNegative, 800, "so a near-zero net cannot hide two large opposing flows");
  eq(m.breadth.bull, 1, "one name net bought");
  eq(m.breadth.bear, 1, "one net sold");

  near(m.premium.tilt, -200 / 1400, 1e-4, "premium tilt is dollar-weighted");
  eq(m.breadth.tilt, 0, "breadth tilt is equal-weighted, and here the two DISAGREE");
  ok(m.premium.tilt !== m.breadth.tilt,
     "which is the reading the page exists to show: the same ratio under two weightings");

  const lopsided = [
    { ticker: "X", call_volume: "100", put_volume: "50" },
    { ticker: "Y", call_volume: "900" },
    { ticker: "Z", put_volume: "700" },
  ];
  const j = marketAggregate(lopsided, new Map());
  near(j.pcr.volume, 0.5, 1e-9,
       "the put/call ratio is a ratio of sums over ONE population — the name quoting only " +
       "calls and the name quoting only puts are both excluded, rather than inflating " +
       "one side of a fraction whose halves then describe different markets");
  eq(j.pcr.quotedVolume, 1, "and the population size is published, so the reader can judge it");

  near(m.vol.ivRankMedian, 0.5, 1e-9, "the IV-rank median is a FRACTION in [0,1]");
  ok(m.vol.ivRankMedian <= 1,
     "never the raw 0..100 column — one quantity on two scales, a factor of a hundred apart, " +
     "is the defect that published '1352% of its year'");
  eq(m.vol.ivRankQuoted, 2, "over the names whose tilt carried one");

  const skew = marketAggregate(
    [row("P", { iv30d: "0.20" }), row("Q", { iv30d: "0.30" }), row("R", { iv30d: "9.00" })],
    new Map());
  near(skew.vol.iv30dMedian, 0.30, 1e-9,
       "the implied-vol level is a MEDIAN: one name at 900% would own a mean and the column " +
       "exists to say where the middle of the universe sits");

  const whale = marketAggregate([
    row("W", { net_call_premium: "1000000", net_put_premium: "0" }),
    row("a"), row("b"), row("c"), row("d"), row("e"), row("f"),
  ], new Map());
  ok(whale.premium.topShare > 0.9,
     `one dominant print drives topShare to ${whale.premium.topShare} — without it, ` +
     "'the universe bought calls' and 'one name bought calls' are the same sentence");

  const empty = marketAggregate([{ ticker: "N" }], new Map());
  eq(empty.premium.net, null, "a universe that quoted no premium publishes null, not 0");
  eq(empty.premium.tilt, null, "and no tilt");
  eq(empty.breadth.tilt, null, "and no breadth tilt");
  eq(empty.pcr.volume, null, "and no ratio");
  eq(empty.aggressor.callLift, null, "and no lift");
  eq(empty.vol.iv30dMedian, null, "and no volatility level");
  eq(empty.n, 1, "though the population is still reported");
  eq(marketAggregate(null).n, 0, "no input is no population rather than a throw");

  ok(MARKET_NOTES.population.includes("SCREENED UNIVERSE"),
     "the published prose names the population in the words the page must use");
  ok(/never .*the market|not.*over the market/i.test(MARKET_NOTES.population),
     "and explicitly refuses the phrase 'the market'");
  ok(MARKET_NOTES.presence.includes("BOTH"),
     "and states the presence rule, beside the arithmetic that implements it");
}

const TRIX_FULL_SCALE_BP = 50;
const scaleTrix = (bp) =>
  Number((50 + 50 * Math.max(-1, Math.min(1, bp / TRIX_FULL_SCALE_BP))).toFixed(1));

const sectorRow = (sector, etf, trixBp) => ({
  sector, etf, trixBp,
  trix: scaleTrix(trixBp),
  clamped: Math.abs(trixBp) >= TRIX_FULL_SCALE_BP,
});

const SECTOR_FIXTURE = [
  sectorRow("Technology", "XLK", 6.25),
  sectorRow("Financials", "XLF", 0),
  sectorRow("Energy", "XLE", -4.13),
  sectorRow("Utilities", "XLU", -71.4),
  { sector: "Real Estate", etf: "XLRE", trix: null, trixBp: null, clamped: null,
    reason: "31 usable XLRE closes of 31 returned; 106 are needed" },
];

{
  for (const r of SECTOR_FIXTURE) {
    if (r.trixBp === null) { eq(r.trix, null, `${r.etf} publishes both readings null together`); continue; }
    eq(r.trix, scaleTrix(r.trixBp),
       `${r.etf}: the fixture's trix is exactly what the published relation makes of its trixBp`);
    ok(r.trix >= 0 && r.trix <= 100,
       `${r.etf}: trix ${r.trix} is inside the 0..100 the publisher can emit — the old fixture ` +
       "wrote 12.5 and −8.25, and a renderer testing `trix >= 0` for a sign passed against both");
  }
  eq(scaleTrix(0), 50, "no momentum is FIFTY on this scale, which is why `trix` cannot carry a sign");
  eq(scaleTrix(-71.4), 0, "and a reading past the band saturates at the rail rather than going negative");
}

{
  const src = readFileSync(new URL("../assets/js/flows-market.js", import.meta.url), "utf8");

  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/([^:])\/\/[^\n]*/g, "$1");
  ok(!/REFRESH_CADENCE_MINUTES/.test(code),
     "assets/js/flows-market.js keeps no cadence constant of its own. A browser IIFE cannot " +
     "import shared/, which is why the number travels on the payload now instead of being " +
     "restated somewhere nothing can keep it true");
  ok(/pulseStamp\(\s*pulse\.readAt,\s*pulse\.refreshed,\s*pulse\.cadenceMinutes\s*\)/.test(code),
     "and the stamp is handed the cadence off the payload the page already fetched, rather " +
     "than a second request or a second literal");
  ok(/function pulseStamp\(readAt, refreshed, cadenceMinutes\)/.test(code),
     "which pulseStamp takes as an argument instead of closing over a module constant — a " +
     "closed-over copy is the shape this change removed, and it would pass every page " +
     "assertion below while quietly disagreeing with the cron");
}

const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const TOKEN = "market-token-aaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const auth = { Cookie: "flows_session=" + token };
const put = (key, bodyObj) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(bodyObj),
});

const NEW_KEYS = /\/api\/flows\/(regime|universe|now|lk)(\?|$)/;
const errors = [];
const GLYPH = { pending: "#g-pending", unreadable: "#g-stop", unavailable: "#g-unavailable", quiet: "#g-quiet" };
const MODULES = ["mkTideCard", "mkBreadthCard", "mkTapeCard", "mkEtfSPYCard", "mkEtfQQQCard", "mkEtfIWMCard",
  "mkSecTidesCard", "mkSectorsCard", "mkGroupsCard", "mkExpiryCard", "mkVolCard", "mkRadarCard", "mkAdvCard",
  "mkVolumeCard", "mkAgainstCard", "mkMoversCard", "mkOiCard", "mkDarkCard", "mkImpactCard", "mkInsidersCard",
  "mkSeasonCard"];
const FEEDS = ["mkTide", "mkVolume", "mkOi", "mkImpact", "mkInsiders", "mkDark", "mkSeason"];

const browser = await chromium.launch();

async function openMarket({ stub = true, routes = [], viewport } = {}) {
  const page = await browser.newPage(viewport ? { viewport } : undefined);
  await page.context().addCookies([{ name: "flows_session", value: token, url: server.baseURL }]);
  page.on("pageerror", (e) => errors.push(e.message));
  if (stub) {
    await page.route(NEW_KEYS, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ status: "pending" }) }));
  }
  for (const [pattern, handler] of routes) await page.route(pattern, handler);
  await page.goto(url("/flows/market/"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const s = document.getElementById("mktStatus");
    return s && !/^Loading the session/.test(s.textContent) &&
      document.querySelector("#mkVolume > *") && document.querySelector("#mktAgainst > *");
  }, null, { timeout: 15000 });
  return page;
}

const POP_READ = `(() => {
  const pop = document.getElementById("fxPop");
  const body = document.getElementById("fxPopB");
  if (!pop || !body) return null;
  const lead = body.querySelector(":scope > .ui-lead");
  const kids = Array.from(body.children).filter((n) => !n.classList.contains("ui-pop-sub"));
  const facts = {};
  for (const dt of body.querySelectorAll(":scope > dl > dt")) {
    facts[dt.textContent.trim()] = dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : "";
  }
  const sections = {};
  for (const h4 of body.querySelectorAll(":scope > h4")) {
    const lines = [];
    for (let n = h4.nextElementSibling; n && n.tagName === "P"; n = n.nextElementSibling) lines.push(n.textContent.trim());
    sections[h4.textContent.trim()] = lines.join(" ");
  }
  const table = body.querySelector("table");
  return {
    open: pop.matches(":popover-open"),
    title: document.getElementById("fxPopT").textContent.trim(),
    lead: lead ? lead.textContent.trim() : "",
    leadFirst: kids.length > 0 && kids[0] === lead,
    leadBeforeTable: !table || (lead && Boolean(lead.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)),
    text: body.textContent,
    facts, sections,
    heads: Array.from(body.querySelectorAll("thead th"), (th) => th.textContent.trim()),
    rows: Array.from(body.querySelectorAll("tbody tr"), (tr) => Array.from(tr.children, (td) => td.textContent.trim())),
  };
})()`;

async function why(pg, sel) {
  const clicked = await pg.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const pop = document.getElementById("fxPop");
    if (pop && pop.matches(":popover-open")) pop.hidePopover();
    el.click();
    return true;
  }, sel);
  const out = clicked ? await pg.evaluate(POP_READ) : null;
  await pg.evaluate(() => {
    const pop = document.getElementById("fxPop");
    if (pop && pop.matches(":popover-open")) pop.hidePopover();
  });
  return out;
}
const cardWhy = (pg, id) => why(pg, "#" + id + " .ui-mod-h > .ui-info");

async function silenceAt(pg, sel) {
  const base = await pg.evaluate((s) => {
    const p = document.querySelector(s);
    if (!p) return null;
    const use = p.querySelector("svg use");
    return { kind: p.getAttribute("data-empty"), word: (p.querySelector(".ui-silent-t") || {}).textContent || "",
             glyph: use ? use.getAttribute("href") : null };
  }, sel);
  if (!base) return null;
  const pop = await why(pg, sel + "[data-info], " + sel + " [data-info]");
  return { ...base, text: pop ? pop.lead : "" };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso) => MON[+iso.slice(5, 7) - 1] + " " + +iso.slice(8, 10);


try {

  {
    const anon = await fetch(url("/api/flows/market"), { redirect: "manual" });
    eq(anon.status, 401, "the market level needs a session like every other flows API");
    const pending = await (await fetch(url("/api/flows/market"), { headers: auth })).json();
    eq(pending.status, "pending", "an unpublished market level reports pending, not an error");

    const page = await openMarket();
    const text = await page.textContent("#mktStatus");
    ok(/no session has been measured yet/i.test(text || ""),
       "and the page says so as a fact about the store rather than rendering an empty chart");
    const bare = await page.evaluate((mods) => {
      const kindOf = (sel) => (document.querySelector(sel) ? document.querySelector(sel).getAttribute("data-empty") : null);
      return {
        cards: mods.filter((id) => { const c = document.getElementById(id); return c && !c.hidden && c.getBoundingClientRect().height > 0; }).length,
        filled: mods.filter((id) => { const c = document.getElementById(id); return c && c.querySelector(".ui-mod-h ~ *") && c.querySelector(".ui-mod-h ~ *").textContent.trim(); }).length,
        status: document.getElementById("mktStatus").getAttribute("data-empty"),
        meta: kindOf("#mkMeta [data-empty]"),
        tilt: kindOf("#mktTilt [data-empty]"),
        breadth: kindOf("#mktBreadth [data-empty]"),
        tape: kindOf("#mktTape [data-empty]"),
        sectors: kindOf("#mktSectors [data-empty]"),
        movers: kindOf("#mktMovers [data-empty]"),
        pulse: kindOf("#mkVolume [data-empty]"),
        against: kindOf("#mktAgainst [data-empty]"),
        charts: document.querySelectorAll("#mkTide svg[role=img], #mkVolume svg[role=img]").length,
      };
    }, MODULES);

    eq(bare.cards, MODULES.length,
       "every module is drawn, each holding a pending line, rather than no module at all — a " +
       "section that vanishes for a reason the reader cannot see is the worst of the silences");
    eq(bare.filled, MODULES.length, "and not one of them is an empty card: each says which silence it is in");
    eq(bare.status, "pending", "the status line carries the pending mark, not bare prose");
    eq(bare.meta, "pending", "and so does the caption under the title, where a sighted reader looks for the session");
    for (const region of ["tilt", "breadth", "tape", "sectors", "movers", "pulse", "against"]) {
      eq(bare[region], "pending",
         `the ${region} region is tagged pending — an unpublished key, which is neither a ` +
         "failed request nor a payload missing a field");
    }
    const tilt = await silenceAt(page, "#mktTilt [data-empty]");
    sawSilence(tilt.kind, tilt.text);
    eq(tilt.glyph, GLYPH.pending,
       "the pending line's mark is the dotted pending ring — the glyph a published payload missing a field wears is another");
    eq(tilt.word, "Pending", "and one word on the surface, so the kind is legible before anything is opened");
    ok(/has not published the market level yet/.test(tilt.text),
       `naming the key that is pending, one tap away (${tilt.text})`);
    eq(bare.charts, 0, "and no chart is drawn from a pulse that was never published");
    await page.close();
  }

  const dayStamp = (offsetDays) =>
    new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
  const FRESH_SESSION = dayStamp(1);

  const payload = {
    v: 2, generatedAt: new Date().toISOString(), sessionDate: FRESH_SESSION, status: "ok",
    n: 200, screened: 260,
    premium: {
      netPositive: 1_000_000_000, netNegative: 3_000_000_000, net: -2_000_000_000,
      priced: 180, oneLegged: 7, tilt: -0.5, topShare: 0.62,
    },
    breadth: { bull: 120, bear: 55, flat: 5, unpriced: 20, tilt: 0.3714 },
    pcr: { volume: 0.812, premium: 0.744, quotedVolume: 190, quotedPremium: 185 },
    aggressor: {
      callAsk: 900, callBid: 600, putAsk: 400, putBid: 700,
      callLift: 0.6, putLift: 0.3636, quoted: 175,
    },
    vol: { iv30dMedian: 0.3412, iv30dQuoted: 178, ivRankMedian: 0.4102, ivRankQuoted: 200 },
    notes: MARKET_NOTES,
  };
  eq((await put("market", payload)).status, 200, "the ingest route accepts the market key");

  await put("sector:trix", {
    v: 2, status: "ok", measured: 4,
    span: 15, price: "log", seriesSessions: 42, warmupSessions: 63,

    scaling: {
      rule: "fixed-clamp", choice: true, neutral: 50,
      fullScaleBp: TRIX_FULL_SCALE_BP,
      relation: "trix = 50 + 50 * clamp(trixBp / fullScaleBp, -1, +1)",
    },
    basis: "SPDR Select Sector ETFs, not GICS index levels",
    sectors: SECTOR_FIXTURE,
  });

  await put("movers", {
    v: 2, status: "ok",
    universe: 260, cap: 15, ranked: 254, priced: 250, unrankedChange: 6, unrankedPremium: 10,
    risers: [{ t: "AAA", chg: 0.081, netPrem: 1e7 }].concat(
      ["AB2", "AC3", "AD4", "AE5", "AF6", "AG7", "AH8", "AI9"].map((t, i) => (
        { t, chg: 0.07 - i * 0.005, netPrem: 1e6 }))),
    fallers: [{ t: "BBB", chg: -0.064, netPrem: -2e7 }],
    premium: { bullish: [{ t: "CCC", netPrem: 5e8 }], bearish: [{ t: "DDD", netPrem: -6e8 }] },
  });

  await put("board:long", {
    v: 2, side: "long", status: "ok", sessionDate: FRESH_SESSION,
    rows: [{ t: "EEE", r: 1 }, { t: "FFF", r: 2 }, { t: "DDD", r: 3 }],
  });
  await put("board:short", {
    v: 2, side: "short", status: "ok", sessionDate: FRESH_SESSION,
    rows: [{ t: "GGG", r: 1 }, { t: "HHH", r: 2 }],
  });

  const totalsRows = [];
  for (let i = 0; i < 20; i++) {
    totalsRows.push({
      date: dayStamp(i + 1),
      callPrem: 1e9, putPrem: (20 - i) * 4e7,
      callVol: 5_000_000, putVol: 3_000_000,
    });
  }

  const FIXTURE_CADENCE = 20;
  ok(FIXTURE_CADENCE !== REFRESH_CADENCE_MINUTES,
     `the pulse fixture's cadence (${FIXTURE_CADENCE}) is not the one the Worker's cron ships ` +
     `with (${REFRESH_CADENCE_MINUTES}), which is what makes the stamp assertions below able ` +
     "to tell a payload read from a mirrored constant");

  const pulsePayload = (over) => Object.assign({
    v: 2, generatedAt: new Date().toISOString(), sessionDate: FRESH_SESSION,
    readAt: new Date().toISOString(), refreshed: "intraday", cadenceMinutes: FIXTURE_CADENCE,
    tide: {
      status: "ok", seen: 5, cap: 480, shed: 0,
      points: [
        { t: FRESH_SESSION + "T13:30:00Z", callPrem: 1.0e8, putPrem: -4.0e7 },
        { t: FRESH_SESSION + "T14:00:00Z", callPrem: 1.4e8, putPrem: -5.0e7 },

        { t: FRESH_SESSION + "T14:30:00Z", callPrem: null, putPrem: -6.0e7 },
        { t: FRESH_SESSION + "T15:00:00Z", callPrem: 1.1e8, putPrem: -5.5e7 },
        { t: FRESH_SESSION + "T15:30:00Z", callPrem: 0.9e8, putPrem: -7.0e7 },
      ],
    },
    totals: { status: "ok", rows: totalsRows, seen: 20, cap: 20, shed: 0 },
    oiChange: {
      status: "ok", seen: 4, cap: 20, shed: 0,
      rows: [

        { t: "AAA", cp: "C", k: 150, exp: "2026-09-18", diff: 0, ratio: 0,
          currOi: 12000, prevOi: 12000, vol: 3400 },
        { t: "BBB", cp: "P", k: 80, exp: "2026-10-16", diff: -2500, ratio: -0.2174,
          currOi: 9000, prevOi: 11500, vol: 1200 },
        { t: "OIA", cp: "P", k: 140, exp: "2026-09-25", diff: 22693, ratio: 3241.857,
          currOi: 22700, prevOi: 7, vol: 30100 },
        { t: "OIB", cp: "P", k: 20, exp: "2026-10-30", diff: 153780, ratio: 1025.2,
          currOi: 153930, prevOi: 150, vol: 5200 },
      ],
    },
    netImpact: {
      status: "ok", seen: 2, cap: 20, shed: 0,
      rows: [{ t: "CCC", netPrem: 5e8 }, { t: "DDD", netPrem: -6e8 }],
    },
    insiders: { status: "quiet", rows: [], seen: 0, cap: 12, shed: 0 },
    darkpool: { status: "unavailable", reason: "the venue feed answered 502", rows: [] },
    seasonality: {
      status: "ok", seen: 2, cap: 12, shed: 0,
      rows: [
        { month: 1, avg: 0, positivePct: 0.5, median: 0.005, min: -0.03, max: 0.04, years: 20 },
        { month: 2, avg: -0.0125, positivePct: 0.415, years: 20 },
      ],
    },
    notes: { refusals: "No feed here supports intent or identity." },
  }, over || {});
  eq((await put("pulse", pulsePayload())).status, 200, "the ingest route accepts the pulse key");
  {
    const served = await fetch(url("/api/flows/pulse"), { headers: auth });
    await served.text();
    eq(served.headers.get("x-fresh-class"), "nightly",
       "the served pulse carries its freshness as headers the page can compare clocks against, derived " +
       "from the payload's own session and read stamp without the Worker parsing it");
    eq(served.headers.get("x-fresh-session"), FRESH_SESSION, "naming the session it describes");
    eq(served.headers.get("x-live-overlay"), null,
       "and with no live:market row there is no overlay: the nightly pulse is served as written");
  }

  const page = await openMarket();

  const read = await page.evaluate(() => {
    const chartOf = (sel) => {
      const g = document.querySelector(sel);
      if (!g) return null;
      const vb = g.getAttribute("viewBox").split(/\s+/).map(Number);
      const r = g.getBoundingClientRect();
      const par = g.preserveAspectRatio.baseVal;
      return { vbW: vb[2], vbH: vb[3], width: g.getAttribute("width"), rectW: Number(r.width.toFixed(3)),
               rectH: Number(r.height.toFixed(3)), hostW: Math.round(g.parentNode.clientWidth),
               align: par.align, meet: par.meetOrSlice };
    };
    const ds = (id) => (document.getElementById(id) || { dataset: {} }).dataset;
    const bars = [...document.querySelectorAll("#mktTilt .mk-bar")].map((b) => ({
      cls: b.className, width: b.style.width, left: b.style.left,
    }));
    const up = window.FlowsUI.cssVar("--up"), down = window.FlowsUI.cssVar("--down");
    const tideSvg = document.querySelector("#mkTide svg[role=img]");
    const paths = tideSvg ? [...tideSvg.querySelectorAll("path.ln")] : [];
    const ticks = [...document.querySelectorAll("#mkVolume svg text.mk-vol-x")]
      .map((t) => ({ x: Number(t.getAttribute("x")), text: t.textContent })).sort((a, b) => a.x - b.x);
    return {
      status: document.getElementById("mktStatus").textContent,
      meta: document.getElementById("mkMeta").textContent,
      stale: {
        hidden: document.getElementById("mktStale").hidden,
        text: document.getElementById("mktStale").textContent,
        bodyClass: document.body.className,
        pill: document.querySelectorAll("#mkStalePill .mk-pill").length,
      },
      tiltLead: ds("mktTilt").lead || "",
      verdict: (document.querySelector("#mktTilt .mk-verdict") || {}).textContent || "",
      breadthLead: ds("mktBreadth").lead || "",
      foot: document.getElementById("mktFoot").textContent,
      tape: [...document.querySelectorAll("#mktTape .ui-metric")].map((m) => ({
        k: m.dataset.metric, label: m.querySelector(".ui-metric-l").textContent.trim(),
        v: m.querySelector(".ui-metric-v").textContent.trim(), n: m.dataset.pop,
      })),
      bars,
      sectors: [...document.querySelectorAll("#mktSectors .mk-sector-k")].map((n) => n.firstChild.textContent),
      sectorEtfs: [...document.querySelectorAll("#mktSectors .mk-sector-k")]
        .map((n) => (n.querySelector(".mk-sector-etf") || {}).textContent || null),
      sectorRows: [...document.querySelectorAll("#mktSectors .mk-sector:not(.is-unsettled)")].map((li) => {
        const bar = li.querySelector(".mk-bar");
        return {
          name: li.querySelector(".mk-sector-k").firstChild.textContent,
          value: (li.querySelector(".mk-sector-v") || {}).textContent,
          cls: bar ? bar.className : null,
          width: bar ? bar.style.width : null,
          left: bar ? bar.style.left : null,
          aria: li.querySelector(".mk-track") ? li.querySelector(".mk-track").getAttribute("aria-label") : null,
        };
      }),
      unsettled: [...document.querySelectorAll("#mktSectors .mk-sector.is-unsettled")].map((li) => ({
        name: li.querySelector(".mk-sector-k").firstChild.textContent,
        etf: (li.querySelector(".mk-sector-etf") || {}).textContent || null,
        kind: li.querySelector("[data-empty]") ? li.querySelector("[data-empty]").getAttribute("data-empty") : null,
        bars: li.querySelectorAll(".mk-bar").length,
        values: li.querySelectorAll(".mk-sector-v").length,
        dash: (li.querySelector(".mk-unset") || {}).textContent || "",
      })),
      movers: [...document.querySelectorAll("#mktMovers .mk-mv-t")].map((n) => n.textContent),
      moverLinks: document.querySelectorAll("#mktMovers a").length,
      moverHeads: [...document.querySelectorAll("#mktMovers .mk-movers-h")].map((h) => ({
        title: h.firstChild.textContent, said: h.getAttribute("title"),
        cut: (h.querySelector(".mk-movers-n") || {}).textContent || null,
      })),
      moverPop: ds("mktMovers").pop || "",
      moverPopEmpty: document.querySelector("#mktMovers > [data-empty]")
        ? document.querySelector("#mktMovers > [data-empty]").getAttribute("data-empty") : null,
      stackTotal: [...document.querySelectorAll("#mktBreadth .mk-seg")]
        .reduce((s, i) => s + parseFloat(i.style.width || "0"), 0),
      againstCard: Boolean(document.getElementById("mkAgainstCard")),
      againstMetric: (document.querySelector("#mktAgainst .ui-metric .ui-metric-v") || {}).textContent || "",
      againstTickers: [...document.querySelectorAll("#mktAgainst .mk-mv-t")].map((n) => n.textContent),
      againstEmpties: document.querySelectorAll("#mktAgainst [data-empty]").length,
      pulseStamp: document.getElementById("mkPulseStamp").textContent,
      pulseRank: ds("mkVolume").rank || "",
      oi: [...document.querySelectorAll("#mkOi .mk-oirow")].map((r) => [...r.querySelectorAll(".ui-row-v")].map((v) => v.textContent)),
      oiTitles: [...document.querySelectorAll("#mkOi .mk-growth")].map((v) => v.getAttribute("title")),
      seaValues: [...document.querySelectorAll(".mk-sea-v")].map((n) => n.textContent),
      seaShares: [...document.querySelectorAll(".mk-sea-p")].map((n) => n.textContent),
      tide: tideSvg ? {
        calls: paths.filter((p) => p.getAttribute("stroke") === up).map((p) => p.getAttribute("d")),
        puts: paths.filter((p) => p.getAttribute("stroke") === down)
          .map((p) => ({ d: p.getAttribute("d"), dash: p.getAttribute("stroke-dasharray") })),
        lone: [...tideSvg.querySelectorAll("circle")].filter((c) => c.getAttribute("r") === "1.6").length,
        legend: (document.querySelector("#mkTide .ui-legend") || {}).textContent || "",
        legs: [...document.querySelectorAll("#mkTideLegs .ui-metric")].map((m) =>
          [m.querySelector(".ui-metric-l").textContent.trim(), m.querySelector(".ui-metric-v").textContent.trim()]),
      } : null,
      ticks,
      charts: [chartOf("#mkTide svg[role=img]"), chartOf("#mkVolume svg[role=img]")],
      dossiers: [...document.querySelectorAll(".mk-dossier")].map((a) => a.getAttribute("href")),
    };
  });

  const breadthWhy = await cardWhy(page, "mkBreadthCard");
  const sectorWhy = await cardWhy(page, "mkSectorsCard");
  const againstWhy = await cardWhy(page, "mkAgainstCard");
  const moversWhy = await cardWhy(page, "mkMoversCard");
  const tapeWhy = await cardWhy(page, "mkTapeCard");
  const volumeWhy = await cardWhy(page, "mkVolumeCard");
  const sayAll = (d) => [d.lead, ...Object.values(d.sections), d.text].join(" ");

  ok(/disagree/i.test(read.verdict),
     `two tilts of opposite sign are reported AS a disagreement on the surface (${read.verdict}) — ` +
     "breadth without size is a different session from size without breadth, and no single number can say which");
  ok(/disagree/i.test(breadthWhy.lead), "and in the module's own finding");

  for (const [where, d] of [["breadth", breadthWhy], ["sector", sectorWhy], ["against", againstWhy]]) {
    ok(d.leadFirst === true,
       `the ${where} module's finding is the FIRST thing in its disclosure — a lead that sits ` +
       "under the marks it describes is a note, whatever class it carries");
  }
  ok(/leaned/.test(read.tiltLead) && /DISAGREE/.test(read.tiltLead),
     `the tilt's finding names both directions (${read.tiltLead})`);
  ok(/%/.test(read.breadthLead) && /five largest names/.test(read.breadthLead),
     `the breadth finding carries the concentration figure (${read.breadthLead})`);
  ok(/sectors settled a reading/.test(sectorWhy.lead),
     `the sector finding carries the settled count with its denominator (${sectorWhy.lead})`);
  ok(/published board names/.test(againstWhy.lead),
     `the against finding carries the join count with its denominator (${againstWhy.lead})`);
  for (const [where, d] of [["breadth", breadthWhy], ["sector", sectorWhy], ["against", againstWhy]]) {
    ok(typeof d.sections["Read with care"] === "string" && d.sections["Read with care"].length > 0,
       `the ${where} module's caveats sit under their own "Read with care" heading — a caveat that ` +
       "reads as method is a caveat nobody weighs");
  }
  ok(/not as the universe/.test(breadthWhy.sections["Read with care"]),
     `and the concentration warning is one of them (${breadthWhy.sections["Read with care"]})`);
  ok(/CAPPED extremes/.test(againstWhy.sections["Read with care"]),
     `as is the cap on both mover lists (${againstWhy.sections["Read with care"]})`);
  ok(/same band every session/.test(sectorWhy.sections["Read with care"]),
     `as is what the sector axis can be compared against (${sectorWhy.sections["Read with care"].slice(0, 80)})`);

  eq(read.bars.length, 2, "both weightings are drawn");
  const pos = read.bars.find((b) => /is-pos/.test(b.cls));
  const neg = read.bars.find((b) => /is-neg/.test(b.cls));
  ok(pos && pos.left === "50%",
     "the positive bar starts at the centre rule and grows right");
  ok(neg && parseFloat(neg.left) < 50,
     `the negative bar starts LEFT of centre (${neg && neg.left}) — position carries the sign, ` +
     "so the reading survives greyscale and colour blindness");
  near(parseFloat(neg.width), 25, 0.01,
       "and its width is the magnitude on a FIXED [-1,1] axis: −0.5 fills half the half-axis. " +
       "Scaling to the data would draw a 0.03 session as a decisive one");

  const breadthNote = sayAll(breadthWhy);
  ok(/62\.0%|62%/.test(breadthNote), "the top-five share is stated");
  ok(/five names/i.test(breadthNote) && /not as the universe/i.test(breadthNote),
     "and when it exceeds half, the note says to read the total as those names");
  ok(/7/.test(breadthNote) && /one leg/i.test(breadthNote),
     "the one-legged count reaches the reader rather than vanishing into `unpriced`");

  eq(read.tape.length, 7, "seven aggregate readings");
  ok(read.tape.every((r) => r.n && r.n !== ""),
     "and every one names the population it was measured over — two ratios over different " +
     "sets of names are not comparable and must not look it");
  eq(tapeWhy.rows.length, 7, "and the tape's disclosure tabulates the seven against their populations");
  ok(tapeWhy.rows.every((r) => r[2] && r[2] !== ""), "with a Names column on every row");
  ok(read.tape.every((r) => r.label.split(/\s+/).length <= 3),
     `each reading is labelled in three words or fewer on the surface (${read.tape.map((r) => r.label).join(" | ")})`);
  const iv = read.tape.find((r) => /IV rank/i.test(r.k));
  ok(iv && /41\.0%/.test(iv.v),
     `the IV-rank median renders as a percentage of the fraction (${iv && iv.v}), not as the ` +
     "raw 0..100 column — 0.4102 is 41.0%, never 0.4%");

  near(read.stackTotal, 100, 0.01,
       "the breadth segments sum to 100% of the priced population, so the bar is a " +
       "part-to-whole reading rather than three unrelated widths");

  assert.deepEqual(read.sectors, ["Technology", "Financials", "Energy", "Utilities", "Real Estate"],
    "the settled sectors are ranked by the RAW reading, high to low — ranking on `trix` " +
    "instead ties every saturated sector at 100 and then orders them arbitrarily — and " +
    "the unsettled sector is listed last, by name"); checks++;
  eq(read.unsettled.length, 1, "exactly one row is the unsettled kind");
  const xlre = read.unsettled[0];
  eq(xlre.name, "Real Estate", "it is the sector the fixture could not settle");
  eq(xlre.etf, "XLRE", "with its ticker");
  eq(xlre.bars, 0, "and NO bar: a flat bar at zero would read as measured neutrality");
  eq(xlre.values, 0, "and no number, because there is none");
  ok(/^—/.test(xlre.dash), "only the em dash where the number would be");
  eq(xlre.kind, "unavailable",
     "tagged unavailable — the payload was published and this reading is not on it — " +
     "which is neither a failed request nor a quiet market");
  const xlreWhy = await silenceAt(page, "#mktSectors .mk-sector.is-unsettled [data-empty]");
  ok(/31 usable XLRE closes of 31 returned; 106 are needed/.test(xlreWhy.text),
     `holding the payload's own reason verbatim, one tap away (${xlreWhy.text})`);
  eq(xlreWhy.glyph, GLYPH.unavailable, "under the unavailable glyph");
  sawSilence(xlre.kind, xlreWhy.text);
  const sectorNote = sayAll(sectorWhy);
  ok(/4 of 5 sectors settled a reading/.test(sectorNote),
     `the note states the settled population with its denominator (${sectorNote.slice(0, 60)})`);
  ok(/1 of 5 sectors had too little history to settle/.test(sectorNote) &&
     /listed without a bar/.test(sectorNote),
     "and counts the unsettled one against the same denominator, saying it is listed rather " +
     "than omitted");
  ok(!/omitted/.test(sectorNote),
     "and no longer claims an omission, since nothing is omitted any more");

  assert.deepEqual(read.sectorEtfs, ["XLK", "XLF", "XLE", "XLU", "XLRE"],
    "every row, the unsettled one included, carries its ETF ticker beside the sector name"); checks++;

  const sec = (name) => read.sectorRows.find((r) => r.name === name);
  const xlk = sec("Technology"), xlf = sec("Financials");
  const xle = sec("Energy"), xlu = sec("Utilities");

  read.sectorRows.forEach((r) => {
    ok(/ bp$/.test(r.value),
       `${r.name} states its unit (${r.value}) — a bare number under a caption naming a ` +
       "different unit is how this panel published a clamp score as basis points");
  });

  eq(xle.value, "−4.13 bp",
     "THE HEADLINE REGRESSION: Energy is negative and prints as negative. Under the old " +
     "renderer this row was the clamp score 45.9 with a plus in front of it, in the " +
     "positive tone, on a bar growing right from the centre rule");
  ok(parseFloat(xle.left) < 50,
     `and its bar starts LEFT of the centre rule (${xle.left}) — position, not hue, carries ` +
     "the sign");
  ok(/is-neg/.test(xle.cls), "with the negative class agreeing, as confirmation and not as the channel");
  near(parseFloat(xle.width), 4.13, 0.01,
       "and its width is |−4.13| against the published ±50 bp band on the half-axis");

  eq(xlk.value, "+6.25 bp", "the positive sector keeps its plus");
  eq(xlk.left, "50%", "and grows right from the centre rule");
  near(parseFloat(xlk.width), 6.25, 0.01, "at |6.25| of the same fixed band");

  eq(xlf.value, "0.00 bp",
     "a sector measured at exactly zero prints UNSIGNED — not '+0.00'. A displayed zero " +
     "must mean 'measured zero', and a plus in front of it is the confident-zero defect " +
     "one level up from the arithmetic");
  eq(xlf.left, "50%", "it sits ON the centre rule");
  near(parseFloat(xlf.width), 0, 0.001, "with no width at all");
  ok(/is-flat/.test(xlf.cls) && !/is-pos/.test(xlf.cls),
     `and is classed neither way (${xlf.cls}) — 'is-pos' on a measured zero is a lie in the ` +
     "DOM even when nothing paints");

  near(parseFloat(xlu.width), 50, 0.01,
       "a sector past the published band fills the half-axis rather than overflowing it");
  eq(xlu.value, "−71.40 bp",
     "and the number beside it is the TRUE reading, not the rail it was drawn at");
  ok(/1 sector sits beyond that band/.test(sectorNote),
     `and the caption counts the saturated readings (${sectorNote})`);

  ok(/left of the zero rule/.test(xle.aria || ""),
     `the negative row's aria-label says which side of the rule it is on (${xle.aria})`);
  ok(/at the zero rule/.test(xlf.aria || ""),
     `and the measured zero says it is AT the rule (${xlf.aria})`);

  ok(/−50 to \+50 bp/.test(sectorNote),
     `the caption names the payload's own band (${sectorNote})`);
  ok(/same band every session/.test(sectorNote),
     "and says the axis is comparable across days");
  ok(!/never with another day/.test(sectorNote),
     "and no longer carries the session-scaled caveat, which was true of the old max-scaled " +
     "axis and is false of this one");
  ok(/basis points per session/i.test(sectorNote),
     "the unit is named in the caption as well as on every row");
  ok(/SPDR Select Sector ETFs/.test(sectorNote),
     "and the payload's own basis line reaches the reader: these are eleven tradeable " +
     "baskets, not GICS index levels");

  eq(read.moverLinks, 0,
     "no ticker in the extremes is a link: movers ranks the whole screened universe while a " +
     "detail card exists only for the names the board went deep on, so a link would " +
     "reliably lead nowhere");
  ok(read.movers.includes("AAA") && read.movers.includes("DDD"),
     "all four mover lists reach the page — eleven vendor calls a run stop being dark");

  const head = (t) => read.moverHeads.find((h) => h.title === t);
  eq(head("Risers").cut, " · 8 of 9",
     "a column cut to eight of nine ranked names says so beside its title");
  eq(head("Fallers").cut, " · 1 of 1",
     "and a column that prints its whole ranking says that too, in the same form");
  ok(/largest risers/i.test(head("Risers").said || ""),
     `and a one-word title still carries what it ranks in full (${head("Risers").said})`);
  ok(!read.movers.includes("AI9"),
     "the ninth riser is the one cut, which is what makes the 8 of 9 a measurement");
  const moverNote = sayAll(moversWhy);
  ok(/254 of 260 screened names could be ranked by change and 250 by net premium/.test(moverNote),
     `the population line reads the publisher's own denominators (${read.moverPop})`);
  ok(/6 quoted no change and 10 no net premium, and those names are in no column/.test(moverNote),
     "and accounts for the names in no column out loud rather than deducting them silently");
  eq(read.moverPopEmpty, null,
     "with no silence mark on the module's population, because the payload carried it");

  ok(/that quoted both legs\. A rank over 20 sessions/.test(read.pulseRank),
     `the size rank ends in a full stop before the caveat begins (${read.pulseRank.slice(-200)})`);
  eq(volumeWhy.lead, read.pulseRank, "and it is the volume module's finding, first in its disclosure");
  ok(volumeWhy.leadFirst && volumeWhy.leadBeforeTable, "above the per-session table it summarises");

  const totalsTicks = read.ticks;
  ok(totalsTicks.length >= 3, `the totals chart labels at least three sessions (${totalsTicks.length})`);
  totalsTicks.slice(1).forEach((t, i) => {
    ok(t.x - totalsTicks[i].x >= 40,
       `x ticks "${totalsTicks[i].text}" and "${t.text}" are ${(t.x - totalsTicks[i].x).toFixed(1)}px ` +
       "apart — never under 40px, where two labels overprint");
  });
  eq(totalsTicks[totalsTicks.length - 1].text, dayLabel(dayStamp(1)),
     "and the newest session keeps its label, so the tick dropped was the one crowding it");

  ok(/screened universe/i.test(read.foot),
     "the footer states the population in the payload's own words");
  ok(/both/i.test(read.foot),
     "and the presence rule, so a reader knows what was excluded from the totals");
  ok(/screened universe/i.test(tapeWhy.text),
     "and the tape's disclosure carries the same population sentence, where a sighted reader finds it");
  ok(!/\bthe market\b/i.test(read.status),
     "and the status line never calls this population 'the market'");
  ok(/200 screened names/.test(read.status) && /260/.test(read.status),
     "reporting both the eligible count and what the ladder returned");
  ok(/200 screened/.test(read.meta), `and the caption states the eligible count (${read.meta})`);

  eq(read.stale.hidden, true,
     "a session written yesterday raises no stale banner");
  ok(!/is-stale/.test(read.stale.bodyClass),
     "and the page is not dimmed");
  eq(read.stale.pill, 0, "and the caption wears no stale pill");

  ok(read.againstCard, "the against module is drawn rather than hidden");
  eq(read.againstMetric, "1 of 5", "and leads with the join count against its population");
  assert.deepEqual(read.againstTickers, ["DDD #3"],
    "the one long-board name sitting in the largest net put premium is named, with its " +
    "board rank beside it — a contradiction on the name ranked first is different news " +
    "from one on the name ranked twenty-fifth"); checks++;
  eq(read.againstEmpties, 1,
     "and the side with no overlap gets its own silence rather than an empty column");
  const againstEmpty = await silenceAt(page, "#mktAgainst [data-empty]");
  eq(againstEmpty.kind, "quiet",
     "tagged QUIET: both inputs were read and the intersection is genuinely empty, which " +
     "is a fact about the session and not a failure to measure it");
  ok(/No short-board name/.test(againstEmpty.text),
     `and the sentence names which side was empty (${againstEmpty.text})`);
  sawSilence(againstEmpty.kind, againstEmpty.text);
  const againstNote = sayAll(againstWhy);
  ok(/1 of 5 published board names \(3 long, 2 short\)/.test(againstNote),
     `THE DENOMINATOR TRAVELS WITH THE COUNT (${againstWhy.lead}) — "one name against the ` +
     'tape" is unreadable without the population it came out of');
  ok(/CAPPED extremes/.test(againstNote),
     "and the note refuses the inverse reading: the mover lists are capped, so a name " +
     "absent from them has not been shown to agree with the tape");

  eq(read.charts.filter(Boolean).length, 2,
     "two charts are drawn: the intraday tide, and the sessions the totals feed returned");
  read.charts.forEach((g, i) => {
    eq(String(g.vbW), g.width,
       `chart ${i}: the width attribute equals the viewBox width, so one viewBox unit is ` +
       "one CSS pixel and nothing is scaled");
    ok(g.align === 6 && g.meet === 1, `chart ${i}: the aspect rule in force is xMidYMid meet`);
    ok(Math.abs(g.vbW - g.hostW) <= 1,
       `chart ${i}: the width was measured from a VISIBLE host (${g.vbW} vs ${g.hostW}) — ` +
       "a hidden element reports clientWidth 0 and the chart silently falls back");
    eq(g.rectW, g.vbW,
       `chart ${i}: the DRAWN width is exactly the viewBox width (${g.rectW} vs ${g.vbW}) — ` +
       "one viewBox unit is one CSS pixel in the rendered box, not merely in the markup");
    eq(g.rectH, g.vbH,
       `chart ${i}: and the drawn height too, so nothing is scaled on either axis`);
    ok(g.rectW <= g.hostW,
       `chart ${i}: and the drawing never exceeds the host it was measured from ` +
       `(${g.rectW} in ${g.hostW}), which is what keeps a pinned pixel width from ` +
       "pushing a 320px viewport sideways");
  });

  eq(read.tide.calls.length, 2,
     "the call line is drawn in TWO segments because one bucket was never sent: a null is " +
     "not measured, and bridging it would invent a reading");
  ok(read.tide.calls.every((d) => (d.match(/M/g) || []).length === 1),
     "each segment a single run, so the gap is a gap and not a jump inside one path");
  eq(read.tide.puts.length, 1,
     "while the put line, which quoted every bucket, is one unbroken segment");
  eq(read.tide.puts[0].dash, "3 3",
     "dashed, so the pair is told apart by a dash pattern as well as by hue");
  ok(/Net calls/.test(read.tide.legend) && /Net puts/.test(read.tide.legend),
     `and both series are named in words on the legend (${read.tide.legend})`);
  eq(read.tide.lone, 0, "and no lone bucket is left on a series whose gap has neighbours on both sides");
  const legs = Object.fromEntries(read.tide.legs);
  eq(legs.Net, "+$160.0M", "the tide leads with the last net: calls minus puts at the newest bucket");
  eq(legs.Calls, "+$90.0M", "then the call leg");
  eq(legs.Puts, "−$70.0M", "and the put leg with U+2212");

  ok(/44\.4% of the two-sided total/.test(read.pulseRank),
     `put premium is stated as a SHARE (${read.pulseRank}) — raw sums are not comparable ` +
     "across sessions that differ in level before they differ in lean");
  ok(/the 1st highest of the 20 sessions/.test(read.pulseRank),
     "with its rank and its denominator, which is what lets anything here be called unusual");
  ok(/most put-leaning session in the window/.test(read.pulseRank),
     "and the extreme is named when the newest session is the extreme");
  ok(/ordinal claim and nothing more/.test(read.pulseRank),
     "while the note refuses the sigma the window is far too short to support");

  eq(read.oi[0][0], "0",
     "an open-interest change measured at exactly zero prints '0', never '+0' — the row " +
     "reports that the contract's open interest did not move, which is a measurement");
  eq(read.oi[1][0], "−2,500", "while a real fall keeps its minus and its grouping");

  eq(read.oi[0][1], "0%",
     "a growth of exactly zero prints '0%' — unsigned for the same reason the count is, " +
     "but STILL CARRYING ITS UNIT, because a bare 0 in a column beside a contract count " +
     "is the ambiguity this pair was split to remove");
  eq(read.oi[1][1], "−21.7%",
     "and the ratio is multiplied into a percent and CARRIES THE PERCENT SIGN, so it " +
     "can never again be read as a number of contracts");
  eq(read.oi[2][1], "new",
     "a contract that grew from 7 contracts reads 'new', not '+324,186%': a percentage " +
     "of a base under a hundred contracts is noise, and the change column already " +
     "carries the magnitude");
  ok(/From 7 contracts/.test(read.oiTitles[2] || ""), `and says what 'new' means behind it (${read.oiTitles[2]})`);
  eq(read.oi[3][1], "×1,026",
     "and ten-fold growth or more from a real base prints the multiple of the prior " +
     "snapshot, 1 + ratio = current / previous, rather than a five-digit percent");
  eq(read.seaValues[0], "0.00%",
     "a seasonal average of exactly zero prints '0.00%', never '+0.00%'");
  eq(read.seaValues[1], "−1.25%",
     "and a negative month keeps the U+2212 minus — read as the FRACTION the vendor sends (avg_change −0.0125 is " +
     "−1.25%), because a production read carried averages between −0.26 and +0.19 and positive-month shares between " +
     "0.44 and 0.71, which only a fraction explains; the old renderer printed them as −0.01%");
  deep(read.seaShares, ["50%", "42%"], "and the share of months that closed higher is a fraction made a percent too");

  const dark = await silenceAt(page, "#mkDark [data-empty]");
  const ins = await silenceAt(page, "#mkInsiders [data-empty]");
  eq(dark.kind, "unavailable", "a feed that could not be read is UNAVAILABLE");
  ok(/502/.test(dark.text),
     "and names the reason the payload gave rather than a generic apology");
  eq(ins.kind, "quiet",
     "while a feed that answered with nothing is QUIET — a fact about the tape, not an outage");
  eq(ins.glyph, GLYPH.quiet, "under the quiet glyph, which no other kind wears");
  sawSilence(dark.kind, dark.text);
  sawSilence(ins.kind, ins.text);

  ok(new RegExp("refreshes about every " + FIXTURE_CADENCE + " minutes").test(read.pulseStamp),
     `a read inside one cadence may claim the intraday refresh (${read.pulseStamp}), and ` +
     `the interval it claims is the PAYLOAD'S — ${FIXTURE_CADENCE}, which is not the ` +
     `${REFRESH_CADENCE_MINUTES} that shared/flows-freshness.js holds. A renderer mirroring ` +
     "that constant would print 15 here and pass every other assertion in this block");
  ok(!/\d{4}/.test(read.pulseStamp.replace(new RegExp(FIXTURE_CADENCE + " minutes"), "")),
     "and carries no calendar date, because the read is from today");
  const tideWhy = await cardWhy(page, "mkTideCard");
  eq(tideWhy.lead, read.pulseStamp, "and the tide's disclosure leads with that same stamp, where a sighted reader asks");

  deep(read.dossiers, ["/flows/ticker/?t=SPY", "/flows/ticker/?t=QQQ", "/flows/ticker/?t=IWM"],
    "each index ETF module is an entry point to that fund's dossier on the ticker page");

  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(500);
  const narrow = await page.evaluate((mods) => {
    const vw = window.innerWidth;
    return {
      over: document.documentElement.scrollWidth - vw,
      past: mods.map((id) => {
        const n = document.getElementById(id);
        return [id, n ? Math.round(n.getBoundingClientRect().right) - vw : null];
      }),
      chartWidths: [...document.querySelectorAll(".mk-grid svg[role=img]")]
        .map((g) => Number(g.getAttribute("width"))),
    };
  }, MODULES);
  ok(narrow.over <= 1,
     `THE PAGE AS SHIPPED has no horizontal overflow at 320px (${narrow.over}px), with every ` +
     "module drawn from a full store — tests/regression.mjs walks this route but cannot " +
     "publish a payload, so it has only ever measured the EMPTY page");
  for (const [id, past] of narrow.past) {
    ok(past !== null && past <= 1, `and the ${id} module's own right edge is inside the viewport (${past}px past)`);
  }
  ok(narrow.chartWidths.length >= 2, `the charts are measured at 320px (${narrow.chartWidths.length})`);
  narrow.chartWidths.forEach((w) => {
    ok(w <= 320,
       `each chart REPAINTED at the narrow width (${w}) rather than being scaled down from ` +
       "the width it was first measured at");
  });

  await page.close();

  {
    const failing = await openMarket({ routes: [
      ["**/api/flows/sectors", (route) => route.abort()],
      ["**/api/flows/movers", (route) => route.abort()],
      ["**/api/flows/pulse", (route) => route.abort()],
    ] });

    const dead = {};
    for (const [k, sel] of [["sectors", "#mktSectors [data-empty]"], ["movers", "#mktMovers [data-empty]"],
      ["against", "#mktAgainst [data-empty]"], ["pulse", "#mkVolume [data-empty]"], ["tide", "#mkTide [data-empty]"]]) {
      dead[k] = await silenceAt(failing, sel);
    }
    const drawn = await failing.evaluate((feeds) => ({
      cards: ["mkSectorsCard", "mkMoversCard", "mkAgainstCard", "mkVolumeCard"].map((id) => {
        const c = document.getElementById(id);
        return Boolean(c && !c.hidden && c.getBoundingClientRect().height > 0);
      }),
      feeds: feeds.map((id) => (document.querySelector("#" + id + " [data-empty]") || {}).getAttribute
        ? document.querySelector("#" + id + " [data-empty]").getAttribute("data-empty") : null),
      charts: document.querySelectorAll("#mkTide svg[role=img], #mkVolume svg[role=img]").length,
    }), FEEDS);

    ok(drawn.cards.every(Boolean), "a failed fetch still draws its module, every one of them");
    eq(dead.sectors.kind, "unreadable",
       "tagged UNREADABLE — a request that never came back is this page's failure to read, " +
       "and it wore the dagger of 'published without this field' until the two were told apart");
    eq(dead.sectors.glyph, GLYPH.unreadable,
       "under the stop glyph this page reserves for the one silence whose remedy is reload");
    eq(dead.sectors.word, "Unreadable", "and the word on the surface says so");
    sawSilence(dead.sectors.kind, dead.sectors.text);
    ok(/did not come back/.test(dead.sectors.text),
       `and says the REQUEST failed (${dead.sectors.text})`);
    ok(!/has not published/.test(dead.sectors.text),
       "and does NOT claim the pipeline never published the key — a confident statement " +
       "about the pipeline manufactured by a request that never arrived");
    ok(/not a statement about what the payload holds/.test(dead.sectors.text),
       "stating in so many words that this is a read failure and not a reading");

    eq(dead.movers.kind, "unreadable",
       "and the movers module is DRAWN rather than deleted, with the same tag");
    ok(/did not come back/.test(dead.movers.text), "and the same distinction in words");

    eq(dead.pulse.kind, "unreadable",
       "and the whole pulse family is drawn: seven feeds and two charts used to disappear " +
       "together on a failed request, with no sentence left where they had been");
    ok(/did not come back/.test(dead.pulse.text),
       `naming the request rather than the pipeline (${dead.pulse.text})`);
    deep(drawn.feeds, FEEDS.map(() => "unreadable"),
       "every one of the seven feed modules, the tide included, says it could not be read");
    eq(dead.tide.kind, "unreadable", "the tide says so too, rather than calling an unread feed unavailable");
    eq(drawn.charts, 0,
       "with no chart left standing from a payload the page no longer holds");

    ok(/premium extremes/.test(dead.against.text),
       `and the join module names WHICH of its two inputs failed (${dead.against.text})`);

    await failing.close();
  }

  {
    const broken = await openMarket({ routes: [
      ["**/api/flows/market", (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "upstream" })],
    ] });

    const tiltSil = await silenceAt(broken, "#mktTilt [data-empty]");
    const refused = await broken.evaluate((mods) => {
      const kind = (sel) => (document.querySelector(sel) ? document.querySelector(sel).getAttribute("data-empty") : null);
      return {
        status: { kind: document.getElementById("mktStatus").getAttribute("data-empty"),
                  text: document.getElementById("mktStatus").textContent },
        meta: kind("#mkMeta [data-empty]"),
        breadth: kind("#mktBreadth [data-empty]"),
        tape: kind("#mktTape [data-empty]"),
        cards: mods.filter((id) => { const c = document.getElementById(id); return c && !c.hidden && c.getBoundingClientRect().height > 0; }).length,
        sectorRows: document.querySelectorAll("#mktSectors .mk-sector").length,
        moverNames: [...document.querySelectorAll("#mktMovers .mk-mv-t")].map((n) => n.textContent),
        charts: document.querySelectorAll("#mkTide svg[role=img], #mkVolume svg[role=img]").length,
        staleHidden: document.getElementById("mktStale").hidden,
      };
    }, MODULES);

    eq(tiltSil.kind, "unreadable",
       "the market key's failure is painted where the level would have been, as unreadable");
    ok(/HTTP 500/.test(tiltSil.text),
       `carrying the status the request came back with (${tiltSil.text})`);
    eq(tiltSil.glyph, GLYPH.unreadable, "under the stop glyph, which no other kind wears");
    eq(refused.breadth, "unreadable", "the breadth region says the same");
    eq(refused.tape, "unreadable",
       "and so does the tape, inside its own module rather than as a header over nothing");
    eq(refused.status.kind, "unreadable",
       "the status line carries the mark too, instead of the bare prose it used to hold");
    eq(refused.meta, "unreadable", "and so does the caption");
    ok(/did not come back: HTTP 500/.test(refused.status.text),
       `and names the request rather than the pipeline (${refused.status.text})`);
    eq(refused.cards, MODULES.length,
       "every module is drawn: most of them never read this key and paint from " +
       "their own settled payloads");
    ok(refused.sectorRows >= 4,
       `the sector list is drawn from its own payload (${refused.sectorRows} rows)`);
    ok(refused.moverNames.includes("AAA"), "the extremes are drawn from theirs");
    eq(refused.charts, 2, "and the pulse draws both its charts");
    eq(refused.staleHidden, true,
       "while no stale verdict is passed on a payload that never arrived — an age cannot " +
       "be measured on nothing");
    sawSilence(tiltSil.kind, tiltSil.text);

    await broken.close();
  }

  {
    await put("market", Object.assign({}, payload, { sessionDate: dayStamp(9) }));

    await put("pulse", pulsePayload({
      readAt: new Date(Date.now() - 26 * 3600000).toISOString(),
      refreshed: "intraday",

      tide: {
        status: "ok", seen: 5, cap: 480, shed: 0,
        points: [
          { t: dayStamp(9) + "T13:30:00Z", callPrem: null, putPrem: -4.0e7 },
          { t: dayStamp(9) + "T14:00:00Z", callPrem: 1.4e8, putPrem: -5.0e7 },
          { t: dayStamp(9) + "T14:30:00Z", callPrem: null, putPrem: -6.0e7 },
          { t: dayStamp(9) + "T15:00:00Z", callPrem: 1.1e8, putPrem: -5.5e7 },
          { t: dayStamp(9) + "T15:30:00Z", callPrem: 1.2e8, putPrem: -7.0e7 },
        ],
      },
      totals: {
        status: "ok", seen: 3, cap: 20, shed: 0,
        rows: [
          { date: dayStamp(1), callPrem: null, putPrem: 8e8, callVol: 1e6, putVol: 2e6 },
          { date: dayStamp(2), callPrem: null, putPrem: 7e8, callVol: 1e6, putVol: 2e6 },
          { date: dayStamp(3), callPrem: null, putPrem: 6e8, callVol: 1e6, putVol: 2e6 },
        ],
      },
    }));

    const old = await openMarket();
    await old.waitForSelector("#mktStale:not([hidden])", { state: "attached" });

    const aged = await old.evaluate(() => {
      const up = window.FlowsUI.cssVar("--up");
      const svg = document.querySelector("#mkTide svg[role=img]");
      return {
        stale: document.getElementById("mktStale").textContent,
        staleKind: document.getElementById("mktStale").dataset.stale || null,
        bodyClass: document.body.className,
        pill: document.querySelectorAll("#mkStalePill .mk-pill[data-state=stale]").length,
        stamp: document.getElementById("mkPulseStamp").textContent,
        rank: document.getElementById("mkVolume").dataset.rank || "",
        calls: svg ? [...svg.querySelectorAll("path.ln")].filter((p) => p.getAttribute("stroke") === up).map((p) => p.getAttribute("d")) : [],
        lone: svg ? [...svg.querySelectorAll("circle")].filter((c) => c.getAttribute("r") === "1.6" && c.getAttribute("fill") === up)
          .map((c) => ({ cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")) })) : [],
      };
    });

    ok(/more than four days old/.test(aged.stale),
       `a session nine days old raises the banner (${aged.stale})`);
    ok(/not advancing/.test(aged.stale),
       "and names the failure: the pipeline is running, its data is not moving. A dead " +
       "pipeline is the other failure and has the other remedy");
    ok(/is-stale/.test(aged.bodyClass), "and the page marks itself stale for the stylesheet");
    eq(aged.pill, 1, "and the caption wears the stale pill, whose disclosure carries the same sentence");
    const pillWhy = await why(old, "#mkStalePill .mk-pill");
    eq(pillWhy.lead, aged.stale.trim(), "word for word");
    eq(aged.staleKind, "session",
       "WHICH of the two outages is stamped on the element, not only spelled in the prose: " +
       "a dead pipeline and a frozen upstream send the reader to two different people, and " +
       "a test should not have to parse a sentence to tell them apart");
    ok(/These numbers describe the/.test(aged.stale),
       `and the sentence is flows-ui.js's sentence to the word (${aged.stale}) — six routes ` +
       "wording one outage six ways is exactly why that function was lifted out of the renderers");
    ok(new RegExp("describe the " + dayStamp(9) + " session").test(aged.stale),
       `and it names the session it aged (${aged.stale}). The shape gate that now stands in ` +
       "front of this parse rejects anything that is not YYYY-MM-DD, and a guard that had " +
       "bought its silence by refusing real dates too would show up here as a banner that " +
       "stopped firing on a well-formed nine-day-old session");

    eq(aged.calls.length, 1,
       `the call line draws its one real segment (${aged.calls.length})`);
    eq(aged.lone.length, 1,
       "and the lone bucket whose neighbours were both null is drawn too, as a dot in the " +
       "series' own colour. A one-sample run used to emit a bare moveto — a path that moves " +
       "and never paints — so a bucket the vendor did send disappeared from the chart " +
       "entirely. The gap rule exists to stop a missing reading being invented, not to make " +
       "a taken one vanish");
    ok(aged.calls.length === 1 && (aged.calls[0].match(/M/g) || []).length === 1,
       "and the dot is not joined to the segment beside it, which would bridge two buckets");

    ok(!/refreshes about every/.test(aged.stamp),
       `a read 26 hours old no longer claims the intraday refresh (${aged.stamp})`);
    ok(/hours ago|days ago/.test(aged.stamp), "it says how old it is instead");
    ok(/not keeping it current/.test(aged.stamp),
       "and says the refresh is not doing its job, which is the reader's actual question");
    ok(/\d/.test(aged.stamp.split("Read ")[1] || ""),
       "with the calendar date beside the clock, because the read is not from today");

    ok(/cannot be ranked against the others/.test(aged.rank),
       `a window where no session quoted both legs publishes no rank (${aged.rank})`);
    ok(!/highest of/.test(aged.rank),
       "rather than falling back to a middle position, which would be a rank computed " +
       "from a quantity that was never measured");

    await old.close();
  }

  {
    const MALFORMED_SESSION = dayStamp(9).slice(0, 7);
    const leniently = Date.parse(MALFORMED_SESSION + "T21:00:00Z");
    ok(Number.isFinite(leniently),
       `"${MALFORMED_SESSION}T21:00:00Z" still parses in this engine, to ` +
       `${new Date(leniently).toISOString()}. The whole trap is that it does: if a future ` +
       "V8 began rejecting it, this fixture would stop exercising the guard it was written " +
       "for and would go on passing");
    ok(Date.now() - leniently > 4 * 86400000,
       "and the day it invents is more than four days old, so the ungated parse reaches the " +
       "session branch rather than falling past it — a malformed date that happened to parse " +
       "to something recent would pass against the very renderer this block exists to pin");

    await put("market", Object.assign({}, payload, { sessionDate: MALFORMED_SESSION }));

    const shaped = await openMarket();
    const bad = await shaped.evaluate(() => {
      const s = document.getElementById("mktStale");
      return {
        hidden: s ? s.hidden : null,
        text: s ? s.textContent : null,
        kind: s ? s.getAttribute("data-stale") : "no element",
        bodyClass: document.body.className,
        status: (document.getElementById("mktStatus") || {}).textContent || "",
        pill: document.querySelectorAll("#mkStalePill .mk-pill").length,
      };
    });
    await shaped.close();

    ok(bad.status.includes(MALFORMED_SESSION),
       `the payload under test is the one on screen (${bad.status}) — a hidden banner proves ` +
       "nothing about the shape gate if the page is still showing some earlier session");
    eq(bad.hidden, true,
       `a session date of "${MALFORMED_SESSION}" raises NO banner: it is not a date the ` +
       "publisher can emit, so it dates nothing. The old mirror parsed it to the first of " +
       "that month and announced a frozen upstream over a level written minutes ago");
    eq(bad.text, "",
       "and no sentence is left in the element either — hidden text is still text, and this " +
       "one would name a session nobody published");
    eq(bad.kind, null,
       "with no data-stale kind stamped on it, so nothing reading the element rather than " +
       "the prose can take a verdict out of a payload that carried no readable date");
    eq(bad.pill, 0, "and no stale pill in the caption");
    ok(!/is-stale/.test(bad.bodyClass),
       `and the page does not dim itself (${bad.bodyClass || "no body class"})`);
  }

  {
    await put("market", {
      v: 2, generatedAt: new Date().toISOString(), sessionDate: FRESH_SESSION, status: "ok",
      n: 140, screened: 200,
      premium: { netPositive: 5e8, netNegative: 5e8, net: 0, priced: 100, oneLegged: 3,
                 tilt: 0, topShare: 0.2 },

      breadth: { bull: 60, flat: 4, unpriced: 12, tilt: 0.2 },
      pcr: { volume: 0.9, premium: 0.9, quotedVolume: 100, quotedPremium: 100 },
      aggressor: { callLift: 0.5, putLift: 0.5, quoted: 100 },
      vol: { iv30dMedian: 0.3, iv30dQuoted: 100, ivRankMedian: 0.5, ivRankQuoted: 100 },
      notes: MARKET_NOTES,
    });

    await put("movers", {
      v: 2, status: "ok",
      fallers: [],
      premium: { bullish: [{ t: "GGG", netPrem: 4e8 }, { t: "ZZZ", netPrem: 3e8 }] },
    });

    await put("pulse", pulsePayload({

      cadenceMinutes: null,
      totals: {
        status: "ok", seen: 5, cap: 20, shed: 0,
        rows: [
          { date: dayStamp(1), callPrem: 6e8, putPrem: 6e8, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(2), callPrem: null, putPrem: 5e8, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(3), callPrem: 1e9, putPrem: 1e9, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(4), callPrem: null, putPrem: 4e8, callVol: 1e6, putVol: 1e6 },
          { date: dayStamp(5), callPrem: 8e8, putPrem: 2e8, callVol: 1e6, putVol: 1e6 },
        ],
      },
    }));

    await put("sector:trix", {
      v: 2, status: "ok", measured: 3,
      span: 15, price: "log", seriesSessions: 42, warmupSessions: 63,
      basis: "SPDR Select Sector ETFs, not GICS index levels",
      sectors: [
        { sector: "Technology", etf: "XLK", trixBp: 6.25, trix: scaleTrix(6.25) },
        { sector: "Energy", etf: "XLE", trixBp: -4.13, trix: scaleTrix(-4.13) },
        { sector: "Materials", etf: "XLB", trixBp: null, trix: 62.5 },
      ],
    });

    const half = await openMarket();

    const part = await half.evaluate(() => {
      const col = (hostId) => [...document.querySelectorAll("#" + hostId + " .mk-movers-col")]
        .map((c) => ({
          title: c.querySelector(".mk-movers-h").firstChild.textContent,
          said: c.getAttribute("aria-label"),
          kind: c.querySelector("[data-empty]") ? c.querySelector("[data-empty]").getAttribute("data-empty") : null,
          names: [...c.querySelectorAll(".mk-mv-t")].map((n) => n.textContent),
        }));
      return {
        breadth: {
          kind: document.querySelector("#mktBreadth [data-empty]")
            ? document.querySelector("#mktBreadth [data-empty]").getAttribute("data-empty") : null,
          segments: document.querySelectorAll("#mktBreadth .mk-seg").length,
          aria: document.querySelector("#mktBreadth .mk-stack")
            ? document.querySelector("#mktBreadth .mk-stack").getAttribute("aria-label") : null,
        },
        tiltNote: (document.querySelector("#mktTilt .mk-tilt") || { dataset: {} }).dataset.note || "",
        tiltVerdict: [document.getElementById("mktTilt").dataset.lead || "", document.getElementById("mktTilt").dataset.note || ""]
          .filter((one) => one.trim()).join(" "),
        verdictPill: (document.querySelector("#mktTilt .mk-verdict") || {}).textContent || "",
        movers: col("mktMovers"),
        against: col("mktAgainst"),
        rank: document.getElementById("mkVolume").dataset.rank || "",
        stamp: document.getElementById("mkPulseStamp").textContent,
        moverPop: document.querySelector("#mktMovers > [data-empty]")
          ? document.querySelector("#mktMovers > [data-empty]").getAttribute("data-empty") : null,
        sectorBars: [...document.querySelectorAll("#mktSectors .mk-sector")].map((li) => ({
          name: li.querySelector(".mk-sector-k").firstChild.textContent,
          width: li.querySelector(".mk-bar") ? li.querySelector(".mk-bar").style.width : null,
        })),
      };
    });

    eq(part.breadth.segments, 0,
       "a breadth split missing one of its three counts draws NO segments: two parts of an " +
       "unknown whole summing to 100% is a total this session never measured");
    eq(part.breadth.kind, "unavailable",
       "and the absence is tagged as a failure to produce a reading, not as a quiet market");
    const breadthSil = await silenceAt(half, "#mktBreadth [data-empty]");
    ok(/net sold/.test(breadthSil.text),
       `naming WHICH count never arrived (${breadthSil.text})`);
    eq(part.breadth.aria, null,
       'and no aria-label announces "0 names net sold" to the one reader who cannot check ' +
       "the bar against the numbers beside it");
    ok(/— sold/.test(part.tiltNote),
       `the tilt row's population reads the em dash for the count nobody published ` +
       `(${part.tiltNote}) — "0 sold" is Number(null) === 0 wearing newer syntax, and a ` +
       "session where nothing was sold must not look like a field that was never written");
    ok(!/0 sold/.test(part.tiltNote), "which is exactly what it used to print");
    const tiltRowWhy = await cardWhy(half, "mkBreadthCard");
    ok(tiltRowWhy.text.includes(part.tiltNote), "and that population line is read out in the module's disclosure");

    ok(/exactly level/.test(part.tiltVerdict),
       `a weighting that came back exactly level is reported as level (${part.tiltVerdict})`);
    ok(/neither agree nor disagree/.test(part.tiltVerdict),
       "and the pair is neither agreeing nor disagreeing, which is the third sentence this " +
       "note owed and did not have");
    ok(!/agree in sign/.test(part.tiltVerdict),
       "never \"Both weightings agree in sign\", which is what it used to say about a " +
       "session where one of the two had no sign at all");
    eq(part.verdictPill, "Level on one side", "and the surface says it in four words");

    const mv = (t) => part.movers.find((c) => c.title === t);
    eq(mv("Risers").kind, "unavailable",
       "a ranking the payload never published is UNAVAILABLE");
    const risersSil = await silenceAt(half, "#mktMovers .mk-movers-col:nth-child(1) [data-empty]");
    ok(/never measured/.test(risersSil.text),
       "and says so rather than implying no name qualified");
    eq(mv("Fallers").kind, "quiet",
       "while a ranking that was taken and came back empty is QUIET — one untagged " +
       '"Nothing ranked." used to be the whole vocabulary for both');
    eq(mv("Puts").kind, "unavailable",
       "and the missing premium extreme is unavailable too");
    assert.deepEqual(mv("Calls").names, ["GGG", "ZZZ"],
      "while the one ranking that did arrive is drawn"); checks++;

    eq(part.moverPop, "unavailable",
       "the missing denominators are a marked silence under the columns");
    const popSil = await silenceAt(half, "#mktMovers > [data-empty]");
    ok(/no count of the screened names it ranked/.test(popSil.text),
       `naming what is missing (${popSil.text})`);
    sawSilence(popSil.kind, popSil.text);

    const ag = (t) => part.against.find((c) => c.title === t);
    eq(ag("Long in puts").said, "Long board, in the largest net PUT premium",
       "a three-word column title still names its whole join to assistive tech");
    eq(ag("Long in puts").kind, "unavailable",
       "the side whose premium ranking was never published is UNAVAILABLE, not quiet: the " +
       "guard that used to cover this required BOTH lists to be missing, so a payload " +
       "carrying one of the two published a measured-emptiness sentence about a ranking " +
       "nobody took — the confident zero one level up from the arithmetic");
    const longSil = await silenceAt(half, "#mktAgainst .mk-movers-col:nth-child(1) [data-empty]");
    ok(/never taken/.test(longSil.text),
       "and says the overlap was never taken rather than that it is empty");
    assert.deepEqual(ag("Short in calls").names, ["GGG #1"],
      "while the side that could be joined is joined, with its board rank"); checks++;
    const againstHalf = await cardWhy(half, "mkAgainstCard");
    const againstNote = [againstHalf.lead, ...Object.values(againstHalf.sections)].join(" ");
    ok(/1 of 2 published board names \(2 short\)/.test(againstNote),
       `THE DENOMINATOR COUNTS ONLY WHAT WAS JOINED (${againstNote}) — the long ` +
       "board's three names were never compared with anything and cannot sit in a " +
       '"1 of 5 appear" that reads as a measurement of agreement');
    ok(/long board \(3 names\) could not be joined/.test(againstNote),
       "and those three names are accounted for in words rather than silently deducted");

    ok(/the 1st highest of the 3 sessions in this window that quoted both legs/.test(part.rank),
       `the denominator is the sessions that could be RANKED (${part.rank}), under that ` +
       'noun — "of the 20 sessions this feed returned" over a denominator of 3 is the ' +
       "right number wearing the wrong population");
    ok(/5 sessions were returned; 2 quoted only one leg and cannot be ranked/.test(part.rank),
       "with the rows it could not rank counted out loud rather than quietly deducted");
    ok(/tied for the most put-leaning/.test(part.rank),
       `a session TIED at the top does not get the superlative (${part.rank}): "the most " +
       "put-leaning session in the window" is a claim about uniqueness that two equal " +
       "shares do not support`);
    ok(/2nd largest of the 3 sessions that quoted both legs/.test(part.rank),
       "and the size rank keeps its noun — \"the 2nd largest of 3\" is three what, " +
       "measured how");

    ok(/did not publish the refresh cadence/.test(part.stamp),
       `a pulse carrying no cadence says the page cannot judge the read (${part.stamp})`);
    ok(!/refreshes about every/.test(part.stamp),
       "rather than falling back to an interval nobody published");
    ok(!/0 minutes/.test(part.stamp),
       "and a read taken seconds ago does not round to \"0 minutes ago\" — a measurement " +
       "of nothing printed beside a sentence about a field that is missing");

    const sectorHalf = await cardWhy(half, "mkSectorsCard");
    const sectorNote = [sectorHalf.lead, ...Object.values(sectorHalf.sections), sectorHalf.text].join(" ");
    ok(/no full-scale band/.test(sectorNote),
       `a payload with no scaling block says so (${sectorNote.slice(0, 160)}) rather than silently ` +
       "inventing a band and drawing on it");
    ok(/never with another day/.test(sectorNote),
       "and the session-scaled caveat RETURNS on the session-scaled axis. It was retired " +
       "from the fixed-axis caption because it is false there; it is true here, and a " +
       "caption that dropped it on both would be wrong on one");
    eq(part.sectorBars.length, 2,
       "the row carrying a clamp score with no raw reading is not drawn — it cannot be " +
       "placed on a signed axis, and drawing it at neutral would invent a measurement");
    eq(part.sectorBars.find((r) => r.name === "Technology").width, "50%",
       "and the widest reading of the session fills the half-axis, which is what a " +
       "session-scaled axis means");
    ok(/1 sector published a clamp score with no raw reading/.test(sectorNote),
       "while the defective row is COUNTED and named as a payload defect " +
       "rather than silently dropped — a quietly shrinking panel is how the last two " +
       "defects on this surface stayed invisible for weeks");
    ok(!/too little history/.test(sectorNote),
       "and it is not filed under 'too little history', which is a statement about the " +
       "market and would hide a publisher bug behind a fact about a sector");

    await half.close();

    await put("board:long", { v: 2, side: "long", status: "ok", sessionDate: FRESH_SESSION, rows: [] });
    await put("board:short", { v: 2, side: "short", status: "ok", sessionDate: FRESH_SESSION, rows: [] });
    await put("movers", {
      v: 2, status: "ok", risers: [], fallers: [],
      premium: { bullish: [{ t: "GGG", netPrem: 4e8 }], bearish: [{ t: "DDD", netPrem: -6e8 }] },
    });

    const bare = await openMarket();
    const noneWhy = await cardWhy(bare, "mkAgainstCard");
    const none = await bare.evaluate(() => ({
      kinds: [...document.querySelectorAll("#mktAgainst .mk-movers-col [data-empty]")]
        .map((n) => n.getAttribute("data-empty")),
      metric: (document.querySelector("#mktAgainst .ui-metric .ui-metric-v") || {}).textContent || "",
      metricState: (document.querySelector("#mktAgainst .ui-metric .ui-state") || { dataset: {} }).dataset.state || null,
    }));
    const texts = [];
    for (const i of [1, 2]) texts.push((await silenceAt(bare, `#mktAgainst .mk-movers-col:nth-child(${i}) [data-empty]`)).text);
    ok(/no population to state a count against/.test(noneWhy.lead),
       `a join over two empty boards states that there is no population (${noneWhy.lead}) ` +
       'rather than publishing "0 of 0 published board names appear", which is a ratio ' +
       "over an empty set wearing the shape of a measurement");
    ok(!/0 of 0/.test(noneWhy.text) && !/0 of 0/.test(none.metric), "and the empty fraction never reaches the page");
    eq(none.metricState, "quiet", "the count is an em dash wearing the quiet glyph instead");
    assert.deepEqual(none.kinds, ["quiet", "quiet"],
      "both columns are QUIET: the boards were read and ranked nobody, which is a fact " +
      "about the boards"); checks++;
    ok(texts.every((t) => /ranked no name this session/.test(t)),
       "and each names the board rather than claiming the overlap is empty — an empty " +
       "board has no overlap to be empty");
    await bare.close();
  }

  {
    const stampFor = async (body) => {
      await put("pulse", body);
      const p = await openMarket();
      const out = await p.evaluate((feeds) => ({
        stamp: document.getElementById("mkPulseStamp").textContent,
        cards: feeds.filter((id) => (document.getElementById(id) || { childElementCount: 0 }).childElementCount > 0).length,
      }), FEEDS);
      await p.close();
      return out;
    };

    const slack = await stampFor(pulsePayload({
      readAt: new Date(Date.now() - 30 * 60000).toISOString(),
    }));
    ok(!/not keeping it current/.test(slack.stamp),
       `a read thirty minutes old is INSIDE one cadence plus one cadence of slack at the ` +
       `published ${FIXTURE_CADENCE} minutes (${slack.stamp}) — at the ` +
       `${REFRESH_CADENCE_MINUTES} this renderer used to mirror, the same read would be ` +
       "called stale and the reader told the refresh had stopped keeping up");
    ok(new RegExp("refreshes about every " + FIXTURE_CADENCE + " minutes").test(slack.stamp),
       "so it still claims the intraday refresh, in the payload's own interval");

    const zeroed = await stampFor(pulsePayload({ cadenceMinutes: 0 }));
    ok(!/every 0 minutes/.test(zeroed.stamp),
       `a published zero is never quoted as a schedule (${zeroed.stamp}): "refreshes about ` +
       'every 0 minutes" is what Number(null) prints, and it reads as a decision somebody ' +
       "made rather than a field nobody wrote");
    ok(!/not keeping it current/.test(zeroed.stamp),
       "nor is it judged by — `ageMin < 0 * 2` is false for every read ever taken, so a zero " +
       "cadence marks a payload written seconds ago as stale");
    ok(/did not publish the refresh cadence/.test(zeroed.stamp),
       "it is treated as the absence it is, and the verdict is withheld in the same words a " +
       "missing field gets: a refresh every zero minutes is not a schedule");
    eq(zeroed.cards, FEEDS.length,
       "and all seven feed modules are still drawn. A cadence nobody published costs this " +
       "section one sentence, not a module — the silence is in the stamp, where the missing " +
       "field is, and nowhere else");
  }

  {
    await put("pulse", pulsePayload({ seasonality: { status: "ok", seen: 3, cap: 12, shed: 0, rows: [
      { month: 1, avg: -0.0058, positivePct: 0.4737, years: 19 },
      { month: 1, avg: 0.0051, positivePct: 0.6316, years: 19 },
      { month: 2, avg: 0.0092, positivePct: 0.5556, years: 18 },
    ] } }));
    const twice = await openMarket();
    const cells = await twice.evaluate(() => document.querySelectorAll("#mkSeason .mk-sea-cell").length);
    const sil = await silenceAt(twice, "#mkSeason [data-empty]");
    await twice.close();
    eq(cells, 0,
       "a seasonality payload that repeats a month draws no calendar: the vendor sends one row per ticker per month, " +
       "and a publisher that drops the ticker leaves twelve Januaries that read as a broken year");
    eq(sil && sil.kind, "unavailable", "it is the payload's gap, marked as one");
    ok(/does not say which ticker/.test((sil && sil.text) || ""), `and says what is missing (${sil && sil.text})`);
    await put("pulse", pulsePayload());
  }

  const tapeOf = (pg) => pg.evaluate(() => [...document.querySelectorAll("#mktTape .ui-metric")].map((m) => ({
    k: m.dataset.metric,
    v: m.querySelector(".ui-metric-v").textContent.trim(),
    tone: m.querySelector(".ui-metric-v").dataset.tone || null,
    n: m.dataset.pop,
  })));

  {
    await put("market", Object.assign({}, payload, {
      premium: Object.assign({}, payload.premium, { net: "-2000000000" }),
      vol: Object.assign({}, payload.vol, { iv30dMedian: "0.3412" }),
      pcr: Object.assign({}, payload.pcr, { volume: "1.25", premium: "0.875" }),
    }));

    const quoted = await openMarket();
    const tape = await tapeOf(quoted);
    await quoted.close();

    eq(tape.length, 7,
       `the tape rendered all seven of its readings (${tape.length}) on a payload whose numbers ` +
       "arrived as strings. This is the no-throw witness: the two ratio rows formatted the " +
       "RAW payload field after testing it with the helper, so widening the helper sent a " +
       "quoted ratio into String.prototype.toFixed — and since the list is built before a " +
       "single row is appended, the TypeError cost the whole tape, not its tail");

    const netRow = tape.find((r) => /^Net premium/.test(r.k));
    eq(netRow.v, "−$2.00B",
       `a net premium quoted on the wire as "-2000000000" renders as the sum it is ` +
       `(${netRow.v}). Under the stricter helper this cell printed an em dash — the page's ` +
       "own mark for a reading nobody took — over two billion dollars that were measured");
    eq(netRow.tone, "down",
       `and the quoted reading keeps its sign in the DOM as well as in the glyph ` +
       `(${netRow.tone}): usdS() and toneOf() call the helper separately, so one that ` +
       "half-admitted a string could print the dollars and lose the tone qualifying them");
    eq(netRow.n, "180",
       "with the population beside it unmoved, because it arrived as a number all " +
       "along and widening the helper must not disturb what already worked");

    const volRow = tape.find((r) => /^Put contracts per call/.test(r.k));
    eq(volRow.v, "1.250",
       `a put/call ratio quoted as "1.25" renders to three places (${volRow.v}). This row ` +
       "tested the value with the helper and then formatted the RAW field, so widening the " +
       "helper made a quoted ratio reach String.prototype.toFixed — a TypeError, not an em " +
       "dash. It formats the coerced value now");
    const premRow = tape.find((r) => /^Put premium per call/.test(r.k));
    eq(premRow.v, "0.875",
       `and its premium twin the same (${premRow.v}), because the pair was written once and ` +
       "copied, which is how one of them being fixed and the other not would look normal");

    const ivRow = tape.find((r) => /implied vol/i.test(r.k));
    ok(ivRow, "the tape still has readings AFTER the two ratios — the no-throw witness. A " +
       "TypeError inside paintTape would leave this one unbuilt, and every assertion above " +
       "it could still pass on the readings that were appended before the throw");
    eq(ivRow.v, "34.1%",
       `a quoted "0.3412" reaches pct() and renders as ${ivRow.v} — the same reading the ` +
       "unquoted fixture above prints. The helper is reached from more than one formatter, " +
       "and admitting a string at one of them would not be the fix");
  }

  {
    const empty = {
      netPositive: 0, netNegative: 0, net: 0, priced: 0, oneLegged: 0, tilt: 0, topShare: 0,
    };
    await put("market", Object.assign({}, payload, {
      n: 0, screened: 0,
      premium: empty,
      breadth: { bull: 0, bear: 0, flat: 0, unpriced: 0, tilt: 0 },
      pcr: { volume: null, premium: null, quotedVolume: 0, quotedPremium: 0 },
      aggressor: { callAsk: 0, callBid: 0, putAsk: 0, putBid: 0, callLift: null, putLift: null, quoted: 0 },
      vol: { iv30dMedian: null, iv30dQuoted: 0, ivRankMedian: null, ivRankQuoted: 0 },
    }));

    const zero = await openMarket();
    const drawn = await zero.evaluate(() => ({
      status: document.getElementById("mktStatus").textContent,
      statusKind: document.getElementById("mktStatus").getAttribute("data-empty"),
      tape: document.querySelectorAll("#mktTape .ui-metric").length,
      breadth: (document.querySelector("#mktBreadth [data-empty]") || { getAttribute: () => null }).getAttribute("data-empty"),
    }));
    await zero.close();

    eq(drawn.tape, 7,
       "a session that screened zero names still DRAWS its tape: `status: \"ok\", n: 0` is a ladder " +
       "that admitted nobody, and the guard read `!isNum(m.n)` — isNum returns the reading, " +
       "0 is falsy, so the whole page took the never-published branch");
    eq(drawn.statusKind, null, "with no pending mark on a store that had been written to");
    eq(drawn.breadth, "quiet",
       "and the breadth split says QUIET — three published zeros are a measurement, not an absence");
    ok(!/no session has been measured yet/i.test(drawn.status),
       `and the reader is not told the pipeline has never run (${drawn.status}). That ` +
       "sentence is a claim about the STORE, and here the store had been written to");
    ok(/^0 screened names of 0 returned by the ladder/.test(drawn.status),
       `the status line keeps its denominator on a measured zero (${drawn.status}). It read ` +
       "`isNum(m.screened) ? … : \"\"`, so `screened: 0` dropped the clause entirely and left " +
       "no way to tell a ladder that returned nothing from a payload that never published " +
       "the field — the two silences this page spends its prose separating");
  }

  {
    await put("market", Object.assign({}, payload, {
      premium: Object.assign({}, payload.premium, { net: " " }),
      vol: Object.assign({}, payload.vol, { iv30dMedian: false }),

      breadth: Object.assign({}, payload.breadth, { unpriced: "20 " }),
    }));

    const blank = await openMarket();
    const tape = await tapeOf(blank);
    const breadthBlank = await cardWhy(blank, "mkBreadthCard");
    await blank.close();

    const netRow = tape.find((r) => /^Net premium/.test(r.k));
    eq(netRow.v, "—",
       `a net premium sent as a single space prints the em dash (${netRow.v}) — the mark ` +
       'this page keeps for a reading nobody took. Number(" ") is 0, and the guard excluded ' +
       'only the literal "", so the cell read "$0": not a missing number rendered wrongly ' +
       "but a measured sum invented out of whitespace");
    eq(netRow.tone, null,
       `and it carries no tone (${netRow.tone}) — toneOf() calls the helper too, so ` +
       "a blank that coerced to 0 would also have painted the cell as neither-way LEVEL, " +
       "which is a third claim about a session nobody measured");
    const ivRow = tape.find((r) => /implied vol/i.test(r.k));
    eq(ivRow.v, "—",
       `and a boolean prints the em dash rather than a measured 0.0% (${ivRow.v}). ` +
       "Number(false) is 0 and false is neither null nor undefined nor \"\", so the old " +
       "guard passed it straight into the coercion");

    const note = [breadthBlank.lead, ...Object.values(breadthBlank.sections)].join(" ");
    ok(/\b20 of 200 screened names quoted no usable\b/.test(note),
       `the breadth note prints the COERCED count (${note.slice(0, 120)}…). It tested ` +
       "`isNum(b.unpriced) !== null` and then concatenated the RAW field, so a count the " +
       "vendor quoted as \"20 \" reached the sentence carrying the vendor's whitespace — " +
       "the same guarded-then-raw shape that sent a quoted ratio into String.prototype." +
       "toFixed two rows up, one string concatenation away from being a crash instead of " +
       "a typo");
  }

  await put("market", payload);

  {
    const probe = await openMarket();
    const EXPECTED = await probe.evaluate(() => window.FlowsUI.freshness.market().expected);
    await probe.close();
    const SECTOR_NAMES = [["Basic Materials", "XLB"], ["Communication Services", "XLC"], ["Consumer Cyclical", "XLY"],
      ["Consumer Defensive", "XLP"], ["Energy", "XLE"], ["Financial Services", "XLF"], ["Healthcare", "XLV"],
      ["Industrials", "XLI"], ["Real Estate", "XLRE"], ["Technology", "XLK"], ["Utilities", "XLU"]];
    const pathOf = (k, amp) => ({ t0: EXPECTED + "T13:30:00.000Z", step: 15,
      pts: Array.from({ length: 12 }, (_, i) => [i * 15, Math.round(amp * Math.sin((i + k) / 3)), 500 + i]) });
    const REGIME = {
      v: 2, status: "ok", sessionDate: EXPECTED, generatedAt: new Date().toISOString(),
      volCurve: { status: "ok", byIndex: Object.fromEntries(["SPY", "QQQ", "IWM"].map((t, j) => [t, {
        status: "ok", tenors: [1, 5, 7, 14, 30, 60, 90, 180, 365],
        iv: [0.1, 0.11, 0.115, 0.12, 0.13, 0.14, 0.145, 0.15, 0.155].map((v) => +(v + j * 0.03).toFixed(3)),
        ivp: 30 + j * 10, rv20: 0.11 + j * 0.03, ts: -0.1, shape: "contango",
      }])) },
      impliedCorrelation: { status: "ok", byIndex: {
        SPY: { status: "ok", rho: 0.1153, dispersion: 0.2808, coverage: 0.974, weightsAsOf: EXPECTED },
        QQQ: { status: "ok", rho: 0.2241 } } },
      zeroDte: { status: "ok", np0: 36549131, npw: -16540492, share: 0.688442, equity: 1617105, index: -6343729,
        equityShare: 0.203133, path: { t0: EXPECTED + "T13:30:00.000Z", step: 5,
          pts: Array.from({ length: 12 }, (_, i) => [i * 5, 1e6 * (i - 3), 500 + i]) } },
      sectors: { status: "ok", rows: SECTOR_NAMES.map(([sector], k) => (k === 8
        ? { sector, status: "unavailable", reason: "the vendor answered 422 for this sector" }
        : { sector, status: "ok", net: (k - 5) * 2e6, path: pathOf(k, 4e6 + k * 1e5) })) },
      etfTide: { status: "ok", byEtf: Object.fromEntries(["SPY", "QQQ", "IWM"].map((t, j) => [t, {
        status: "ok", net: (j - 1) * 5e7, ownNet: 4e7, agree: j !== 0, path: pathOf(j, 6e7) }])) },
      fundFlows: { status: "ok", byEtf: Object.fromEntries(["SPY", "QQQ", "IWM"].map((t, j) => [t, {
        status: "ok", changeUsd: -9.7e8 + j * 1e8, cum20Usd: -4.9e8 + j * 3e8, z20: -0.83 + j * 0.5 }])) },
      groups: { status: "ok", rows: ["mag7", "semi", "bank", "technology", "energy", "healthcare",
        "financial services", "consumer cyclical"].map((group, k) => ({
        group, status: "ok", delta: (k - 3) * 1.2e6, vega: (k - 4) * 3e5, net: (k - 2) * 1e7, purity: 0.05 + k * 0.02 })) },
      volRadar: { status: "ok", asOf: EXPECTED, keep: 20,
        rich: { status: "ok", rows: [{ t: "SOXS", score: 75.9, n: 5, carded: false }, { t: "EEE", score: 62.2, n: 5, carded: true }] },
        cheap: { status: "ok", rows: [{ t: "UVXY", score: 58.1, n: 4, carded: false }] },
        bullish: { status: "ok", rows: [{ t: "XLE", score: 85.5, n: 12, carded: false }] },
        bearish: { status: "quiet", rows: [], reason: "The sentiment screen returned no bearish names today." } },
    };
    const chgScale = 10000;
    const UNIVERSE = {
      v: 2, status: "ok", sessionDate: EXPECTED, screened: 12,
      units: { chg: ["ratio", chgScale] },
      cols: { chg: [312, -120, 0, 45, -610, 88, null, 205, -33, 0, 510, -75] },
    };
    const liveT = Array.from({ length: 8 }, (_, i) => new Date(Date.parse(EXPECTED + "T13:30:00Z") + i * 300000).toISOString());
    const series = (a, b) => ({ status: "ok", t: liveT, ncp: liveT.map((_, i) => a * (i + 1)), npp: liveT.map((_, i) => b * (i + 1)),
      net: liveT.map((_, i) => (a - b) * (i + 1)) });
    const LIVE = {
      status: "ok", session: EXPECTED, fresh: { readAt: new Date().toISOString() },
      tide: series(4e7, 1e7), zeroDte: series(4e6, 3e6), etf: { SPY: series(2e6, 5e6), QQQ: series(1e6, 1e6) },
    };
    const json = (body, headers) => (route) => route.fulfill({ status: 200,
      headers: { "Content-Type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });

    const deepPage = await openMarket({ viewport: { width: 1440, height: 1000 }, routes: [
      ["**/api/flows/regime", json(REGIME)],
      ["**/api/flows/universe", json(UNIVERSE)],
      ["**/api/flows/lk?k=market", json(LIVE, { "X-Fresh-State": "live" })],
    ] });
    await deepPage.waitForSelector("#mkVol .ui-metric");
    const depth = await deepPage.evaluate(() => {
      const metrics = (id) => Object.fromEntries([...document.querySelectorAll("#" + id + " .ui-metric")].map((m) =>
        [m.querySelector(".ui-metric-l").textContent.trim(), m.querySelector(".ui-metric-v").textContent.trim()]));
      return {
        tideTabs: [...document.querySelectorAll("#mkTideSeg .ui-seg-i")].map((b) => b.textContent.trim()),
        tideNet: metrics("mkTideLegs").Net,
        smalls: [...document.querySelectorAll("#mkSecTides .mk-small")].map((c) => ({
          n: c.querySelector(".mk-small-n").textContent, full: c.querySelector(".mk-small-n").getAttribute("title"),
          v: c.querySelector(".mk-small-h b").textContent,
          chart: Boolean(c.querySelector("svg[role=img]")), empty: c.querySelector("[data-empty]") ? c.querySelector("[data-empty]").getAttribute("data-empty") : null,
          svgH: c.querySelector("svg[role=img]") ? Number(c.querySelector("svg[role=img]").getAttribute("height")) : null,
        })),
        spy: metrics("mkEtfSPY"), qqq: metrics("mkEtfQQQ"), iwm: metrics("mkEtfIWM"),
        etfCharts: ["SPY", "QQQ", "IWM"].map((t) => document.querySelectorAll("#mkEtf" + t + " svg[role=img]").length),
        expiry: metrics("mkExpiry"),
        gauge: (document.querySelector("#mkExpiry .mk-gauge") || {}).textContent || "",
        expiryChart: document.querySelectorAll("#mkExpiry .mk-expiry-p svg[role=img]").length,
        vol: metrics("mkVol"),
        volChart: document.querySelectorAll("#mkVol svg[role=img]").length,
        radarTabs: [...document.querySelectorAll("#mkRadarSeg .ui-seg-i")].map((b) => [b.textContent.trim(), b.disabled]),
        radarRows: [...document.querySelectorAll("#mkRadar .mk-rrow")].map((r) => [r.tagName, r.querySelector("b").textContent, r.getAttribute("href")]),
        groups: [...document.querySelectorAll("#mkGroups .mk-sector")].map((li) => [li.querySelector(".mk-sector-k").textContent,
          li.querySelector(".mk-sector-v").textContent, (li.querySelector(".mk-bar") || { className: "" }).className]),
        adv: metrics("mkAdv"),
        histBars: document.querySelectorAll("#mkAdv svg[role=img] rect").length,
        stale: [...document.querySelectorAll(".mk-grid .ui-mod-t .mk-mark[data-state=stale]")].length,
      };
    });

    deep(depth.tideTabs, ["Market", "0DTE", "SPY", "QQQ"],
      "a live market layer newer than the pulse gives the tide four views: the market, the zero-day, SPY and QQQ");
    eq(depth.tideNet, "+$240.0M", "and the market view's net is the live layer's, not the pulse's");
    await deepPage.locator("#mkTideSeg .ui-seg-i", { hasText: "0DTE" }).click();
    await deepPage.waitForFunction(() => /\+\$8\.0M/.test((document.querySelector("#mkTideLegs .ui-metric .ui-metric-v") || {}).textContent || ""),
      null, { timeout: 5000 }).catch(() => {});
    eq(await deepPage.evaluate(() => document.querySelector("#mkTideLegs .ui-metric .ui-metric-v").textContent.trim()), "+$8.0M",
      "and switching to the zero-day view redraws the legs off the zero-day series");

    eq(depth.smalls.length, 11, "the sector tides are eleven small multiples, one per sector");
    ok(depth.smalls.filter((c) => c.chart).length === 10 && depth.smalls.some((c) => c.empty === "unavailable"),
       "ten draw their session path, and the one the vendor refused says it is unavailable rather than drawing flat");
    ok(depth.smalls.every((c) => c.chart ? c.svgH === 56 : true), "each at the same small height, so they compare by shape");
    const nets = depth.smalls.filter((c) => c.v !== "—").map((c) => c.v);
    ok(nets[0].startsWith("+") && nets[nets.length - 1].startsWith("−"),
       `ordered from the most net-bought sector to the most net-sold (${nets.join(" ")})`);
    ok(depth.smalls.some((c) => c.n === "Cyclicals" && c.full === "Consumer Cyclical"),
       "with the long vendor sector names shortened to fit a small cell, and the full name kept on the cell");
    ok(depth.smalls.every((c) => c.n.length <= 13), `and no short name longer than a small cell holds (${depth.smalls.map((c) => c.n).join(", ")})`);

    eq(depth.spy["Net premium"], "−$24.0M",
      "the SPY module reads its own options tide off the live layer's ETF series, which is as new as the regime's");
    eq(depth.iwm["Net premium"], "+$50.0M", "IWM, which the live market layer does not carry, falls back to the regime's ETF tide");
    eq(depth.spy["Fund flow 20d"], "−$490.0M", "each ETF module carries its 20-session creation and redemption flow");
    eq(depth.spy["IV 30d"], "13.0%", "and its fixed-tenor 30-day implied volatility");
    deep(depth.etfCharts, [1, 1, 1], "and draws its own tide path");

    eq(depth.gauge.replace(/\s+/g, " ").trim().includes("69%"), true, `the expiry module's gauge reads the 0DTE share (${depth.gauge})`);
    eq(depth.expiry["0DTE net"], "+$36.5M", "beside the zero-day net");
    eq(depth.expiry["Weekly net"], "−$16.5M", "and the weekly net it is a share against");
    eq(depth.expiry.Equities, "20%", "with the equity share of the zero-day flow");
    eq(depth.expiryChart, 1, "and the zero-day path through the session");

    eq(depth.vol["IV 30d"], "13.0%", "the volatility module reads SPY's 30-day implied volatility");
    eq(depth.vol.Term, "Contango", "and names the term shape in one word");
    eq(depth.vol.Correlation, "0.12", "with the implied correlation");
    eq(depth.volChart, 1, "over the three index curves on one sqrt-tenor chart");

    deep(depth.radarTabs, [["Rich", false], ["Cheap", false], ["Bullish", false], ["Bearish", false]],
      "the radar offers all four screens");
    deep(depth.radarRows.map((r) => r[1]), ["SOXS", "EEE"], "the rich screen lists the vendor's names in its order");
    deep(depth.radarRows[1], ["A", "EEE", "/flows/ticker/?t=EEE"], "and a name with a card today links to its reader");
    eq(depth.radarRows[0][0], "DIV", "while one without a card is plain");
    await deepPage.locator("#mkRadarSeg .ui-seg-i", { hasText: "Bearish" }).click();
    await deepPage.waitForSelector("#mkRadar [data-empty]", { timeout: 5000 }).catch(() => {});
    const bearish = await silenceAt(deepPage, "#mkRadar [data-empty]");
    eq(bearish && bearish.kind, "quiet", "a screen that returned no names is QUIET, a fact about the day");
    ok(/no bearish names/.test((bearish && bearish.text) || ""), `in the vendor's own reason (${bearish && bearish.text})`);

    eq(depth.groups.length, 8, "the group module draws all eight industry groups");
    eq(depth.groups[0][0], "Consumer cyclical", "ordered by delta flow, most bought first");
    ok(depth.groups.some((g) => /Mag 7/.test(g[0])), "with mag7 named as a reader would say it");
    ok(depth.groups.every((g) => /is-(pos|neg|flat)/.test(g[2])), "each on a signed track");

    eq(depth.adv.Advancers, "5", "the advancers module counts the names up on the session");
    eq(depth.adv.Decliners, "4", "and down");
    eq(depth.adv.Unchanged, "2", "and unchanged, leaving out the one name with no change rather than calling it flat");
    ok(depth.histBars > 0, "over a histogram of the session's price change");

    eq(depth.stale, 0, "a regime of the latest session wears no stale mark on any module");

    const deepWhy = await cardWhy(deepPage, "mkVolCard");
    ok(/VIX/.test(deepWhy.lead), `the volatility disclosure says what stands in for the VIX curve (${deepWhy.lead})`);

    const wordy = await deepPage.evaluate(() => {
      const grid = document.querySelector(".mk-grid");
      const walker = document.createTreeWalker(grid, NodeFilter.SHOW_TEXT);
      const out = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest("svg, .visually-hidden, [hidden]") || !el.checkVisibility()) continue;
        if (n.textContent.trim().split(/\s+/).filter(Boolean).length > 6) out.push(n.textContent.trim());
      }
      return out;
    });
    deep(wordy, [], "no prose on the surface: no visible run of text on the market page is longer than six words");
    const titles = await deepPage.$$eval(".mk-grid .ui-mod-t", (hs) => hs.map((h) => h.childNodes[0].textContent.trim()));
    eq(titles.length, MODULES.length, "every module carries a title");
    for (const t of titles) {
      ok(t.split(/\s+/).length <= 3, `a module title is one to three words (${t})`);
      ok(!/^[A-Z0-9 ]{4,}$/.test(t) || /^(SPY|QQQ|IWM)$/.test(t), `and sentence case, never ALL-CAPS (${t})`);
    }
    const reasons = await deepPage.evaluate((mods) => mods.filter((id) => {
      const c = document.getElementById(id);
      return !(c.querySelector(".ui-mod-h > .ui-info") || c.querySelector("[data-empty] [data-info], [data-empty][data-info]"));
    }), MODULES);
    deep(reasons, [], "and every module carries its sentences one tap away, as a disclosure or behind its silence's Why");

    for (const width of [320, 390, 768]) {
      await deepPage.setViewportSize({ width, height: 900 });
      await deepPage.waitForTimeout(400);
      const over = await deepPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(over <= 1, `no horizontal overflow at ${width}px with every depth module drawn (${over}px)`);
    }
    await deepPage.close();
  }

  assert.deepEqual([...seenSilences.keys()].sort(), ["pending", "quiet", "unavailable", "unreadable"],
    "the scenarios above, taken together, met all four kinds of silence — an unpublished " +
    "key, a request that never came back, a published payload missing a field, and a " +
    "reading taken and found empty — each under its own data-empty"); checks++;
  eq(new Set(seenSilences.values()).size, seenSilences.size,
     "and no two kinds were printed under the same sentence");
  eq(errors.length, 0, `no uncaught page error on any market page (${errors[0] || ""})`);
} finally {
  await browser.close();
  await server.stop();
}

console.log(`✓ flows-market: ${checks} assertions — a level the board neutralises away by design, net premium measured only where both legs were quoted, ratios of sums over one population, an IV rank that is a fraction on both sides of the wire, sector momentum drawn from the RAW signed reading on the payload's own published band with a measured zero printed unsigned and unclassed, a failed request told apart from an unpublished key and from a quiet one by glyph and by sentence, twenty sessions of totals turned into a rank with its denominator, the boards read against the session's premium extremes, a stale banner that can finally fire carrying WHICH outage it found, no line bridged across a bucket the vendor never sent and none dropped either, a part-to-whole bar refused when one of its parts was never published, a rank whose denominator is the sessions that could be ranked and says so, a superlative withheld from a tie, a session date that parses but names no day refused before it can date anything, a reading the vendor quoted rendered as the number it is, two ratios that formatted the coerced value and a reading after them proving nothing threw, a ladder that admitted nobody rendered as the session it is, a blank string and a boolean refused before the coercion, the depth modules — sector tides as eleven small multiples, the three index ETFs with their tide, flow and vol, net flow by expiry, the index vol curve, the radar's four screens, group delta flow and the advancers histogram — pending by design until their keys ship, every chart asserted at its DRAWN size, and no prose on the surface`);
