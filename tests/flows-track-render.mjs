import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { trackPage } from "../shared/flows-pages.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const ROOT = new URL("../", import.meta.url);
const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const CLOSES = [["2026-08-31", 99], ["2026-09-01", 100], ["2026-09-02", 102], ["2026-09-03", 101],
  ["2026-09-04", 99], ["2026-09-05", 98], ["2026-09-08", 100], ["2026-09-09", 103], ["2026-09-10", 97]];

const TRACK = {
  v: 2, generatedAt: "2026-09-06T02:00:00.000Z", sessionDate: "2026-09-05", status: "ok",
  windowSessions: 5, deadBand: 1, epoch: null, namesSeen: 2, namesShed: 0, shedBy: null,
  archive: { probed: 10, failed: 0, abandoned: false }, sources: { full: 5, boardsOnly: 0 },
  sessions: DAYS.map((d) => ({ d, source: "scores", names: 2, preEpoch: false })),
  names: [
    { t: "AAA", s: [10, null, -30, 0, 40], n: 4, last: 40, lastAt: 4, d1: { v: 40, gap: 1, qv: 800, cross: "cleared" }, run: 1, ext: { hi: 40, hiAt: 4, lo: -30, loAt: 2 } },
    { t: "BBB", s: [null, 40, null, -40, null], n: 2, last: -40, lastAt: 3, d1: { v: -80, gap: 2, qv: -900, cross: "flipped" }, run: 1, ext: { hi: 40, hiAt: 1, lo: -40, loAt: 3 } },
  ],
  change: { session: "2026-09-05", prior: "2026-09-04", comparable: 1, consecutive: 1, moved: 1, held: 0, current: 1,
    entered: 0, left: 1, crossings: { cleared: 1, faded: 0, flipped: 0 }, status: "ok" },
  notes: {
    score: "The score is the board's own composite, unchanged.",
    gaps: "A gap means the name was not scored that session. It never means zero.",
  },
};
const CARD = {
  ticker: "AAA", sessionDate: "2026-09-05", generatedAt: "2026-09-06T02:00:00.000Z",
  panels: { context: { status: "ok", candleKeys: ["date", "open", "high", "low", "close", "volume"],
    candles: CLOSES.map(([d, c]) => [d, c, c, c, c, 1000]) } },
};

const browser = await chromium.launch();
const errors = [];
let trackBody = TRACK;

async function open(query = "", viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    const json = (b) => route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname === "/api/flows/scoretrack") return json(trackBody);
    if (u.pathname === "/api/flows/card") return json(u.searchParams.get("t") === "AAA" ? CARD : { ticker: u.searchParams.get("t"), status: "pending" });
    if (u.pathname.startsWith("/api/")) return json({ status: "pending" });
    if (u.pathname.startsWith("/assets/")) {
      const body = await readFile(new URL("." + u.pathname, ROOT)).catch(() => null);
      if (body === null) return route.fulfill({ status: 404, body: "" });
      const type = u.pathname.endsWith(".css") ? "text/css" : u.pathname.endsWith(".js") ? "text/javascript" : "application/octet-stream";
      return route.fulfill({ contentType: type + "; charset=utf-8", body });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: trackPage({ username: "tester" }) });
  });
  await page.goto("https://x.test/flows/track/" + query);
  await page.waitForFunction(() => { const s = document.getElementById("stStatus"); return s && !/^Loading/.test(s.textContent); });
  await page.waitForTimeout(250);
  return page;
}

const popOf = (page, sel) => page.evaluate((sel) => {
  const t = document.querySelector(sel);
  if (!t) return null;
  t.click();
  const text = document.getElementById("fxPop").textContent;
  window.FlowsUI.closeInfo();
  return text;
}, sel);

{
  const page = await open();
  eq(await page.evaluate(() => document.querySelector(".st-row[aria-pressed='true']").dataset.t), "AAA",
     "the page opens on the strongest score in the latest session: AAA's +40 is today's, while " +
     "BBB's −40 is a reading from an older session and is not promoted over a measured one");
  eq(await page.evaluate(() => new URL(location.href).searchParams.get("t")), "AAA",
     "and the selection is written into the address, so the view can be linked");

  const bars = await page.evaluate(() => {
    const svg = document.querySelector("#stChart svg");
    return {
      bars: svg.querySelectorAll("rect.st-pos, rect.st-neg, rect.st-in").length,
      gaps: svg.querySelectorAll("circle.st-gap").length,
      zero: svg.querySelectorAll("rect.st-in").length,
    };
  });
  eq(bars.bars, 4,
     "the score chart draws one bar per scored session and no bar for the session AAA was not " +
     "scored: four measurements, four bars");
  eq(bars.gaps, 1, "and the unscored session is a gap dot on the rule, never a zero-height bar");
  eq(bars.zero, 1,
     "while a measured zero IS drawn, as a mark inside the dead band — an absence must not " +
     "borrow a pixel a measurement could own, and a measurement must not lose one");

  const strips = await page.evaluate(() => {
    const h = (t, i) => {
      const rects = [...document.querySelectorAll(`.st-row[data-t="${t}"] .st-strip rect`)];
      return rects.map((r) => +r.getAttribute("height"));
    };
    return { aaa: h("AAA"), bbb: h("BBB") };
  });
  ok(Math.abs(Math.max(...strips.aaa) - Math.max(...strips.bbb)) < 0.01,
     "every strip in the list is drawn on ONE scale for the whole page: AAA's +40 and BBB's " +
     "±40 are bars of the same height, so two names can be compared by eye (" +
     JSON.stringify(strips) + ")");

  const out = await page.evaluate(() => {
    const m = (id) => { const n = document.querySelector(`#stOutcomes [data-metric="${id}"]`); return n ? n.textContent : null; };
    return { hit: m("hit"), calls: document.querySelectorAll("#stOutcomes .st-calls rect.grow").length,
      open: !!document.querySelector("#stOutcomes .st-m-wh.is-open"),
      tone: document.querySelector('#stOutcomes [data-metric="hit"] .ui-metric-v').getAttribute("data-tone") };
  });
  ok(out.open && !out.tone,
     "two closed calls at a five-session horizon are under two independent windows, so the adjusted " +
     "interval is drawn unbounded across the whole meter and the hit rate stays uncoloured — not a " +
     "Wilson interval on a sample rounded up to one (" + JSON.stringify({ open: out.open, tone: out.tone }) + ")");
  ok(/50%/.test(out.hit) && /1 of 2 calls/.test(out.hit),
     "five sessions after each call, AAA was right once in two closed calls: the bullish call on " +
     "Sep 1 closed flat (100 → 100, not a hit), the bearish call on Sep 3 fell 101 → 97 (a hit) — " +
     "and the zero on Sep 4 is inside the band, so it is no call at all (" + out.hit + ")");
  ok(/1 open/.test(out.hit) && !/of 3 calls/.test(out.hit),
     "the call on Sep 5 has no close five sessions later yet, so it is counted open beside the hit rate, " +
     "not added to its denominator as a miss (" + out.hit + ")");

  const settled = (before) => page.waitForFunction((b) => {
    const n = document.querySelector('#stOutcomes [data-metric="hit"]');
    return n && n.textContent !== b;
  }, before, { timeout: 4000 }).catch(() => {});
  await page.click("#stOutcomes .ui-seg-i >> nth=0");
  await settled(out.hit);
  const one = await page.evaluate(() => document.querySelector('#stOutcomes [data-metric="hit"]').textContent);
  ok(await page.evaluate(() => !document.querySelector("#stOutcomes .st-m-wh.is-open") && !!document.querySelector("#stOutcomes .st-m-wh")),
     "while three one-session calls are three independent windows, and the adjusted interval is bounded");
  ok(/100%/.test(one) && /3 of 3 calls/.test(one),
     "one session after each call all three were right: +2.0% after the bullish Sep 1, −2.0% " +
     "after the bearish Sep 3, +2.0% after the bullish Sep 5 (" + one + ")");
  await page.click("#stOutcomes .ui-seg-i >> nth=2");
  await settled(one);
  const ten = await page.evaluate(() => document.querySelector('#stOutcomes [data-metric="hit"] .ui-state') !== null);
  ok(ten, "and at ten sessions no call has closed yet, so the hit rate is a pending glyph rather than 0%");

  const outInfo = await popOf(page, "#stOutcomes .ui-mod-h .ui-info");
  ok(/adjusted 95% interval/i.test(outInfo) && /divided by the horizon/.test(outInfo),
     "the outcomes disclosure states both intervals and why the adjusted one is wider");

  const basis = await popOf(page, "#stBasis");
  ok(/never zero/i.test(basis),
     "the page's own disclosure states that a gap is not a zero — the one sentence a reader must " +
     "not have to infer, one tap from the title");
  ok(/What a gap means/.test(basis) && /It never means zero/.test(basis),
     "and it carries the pipeline's own basis notes, under their labels");
  ok(/1 of the 1 names with two scored sessions moved|1 names with two scored sessions moved|1 of the 1/.test(basis),
     "and the session's change summary with its population");
  await page.close();
}

{
  const page = await open("?t=BBB");
  eq(await page.evaluate(() => document.querySelector(".st-row[aria-pressed='true']").dataset.t), "BBB",
     "a link that names a ticker opens on that name");
  await page.waitForTimeout(300);
  const sil = await page.evaluate(() => {
    const s = document.querySelector("#stOutcomes .ui-silent");
    return s ? s.getAttribute("data-state") : null;
  });
  eq(sil, "unavailable",
     "a name with no published card has no closes on hand, so its outcomes are drawn as the " +
     "unavailable state rather than as zero calls or an empty chart");
  const why = await popOf(page, "#stOutcomes .ui-silent [data-info]");
  ok(/BBB/.test(why) && /closes/.test(why),
     "and the reason names the name and what is missing (" + why + ")");
  await page.close();
}

{
  trackBody = { status: "pending" };
  const page = await open();
  eq(await page.evaluate(() => document.querySelector("#stTrack .ui-silent").getAttribute("data-state")), "pending",
     "an unpublished track is the pending state");
  ok(/not published this key yet/.test(await page.evaluate(() => document.getElementById("stStatus").textContent)),
     "and says it has not been published, not that the pool was empty");
  await page.close();
  trackBody = TRACK;
}

{
  const page = await open("", { width: 390, height: 844 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, "nothing widens the document at 390px (" + over + "px)");
  const order = await page.evaluate(() => [...document.querySelectorAll("#stTrack > .ui-mod")].map((m) => m.id));
  ok(order.indexOf("stName") < order.indexOf("stOutcomes") && order.indexOf("stOutcomes") < order.indexOf("stNames"),
     "on a phone the selected name and its outcomes come before the list of every name (" + order.join(", ") + ")");
  await page.close();
}

eq(errors.length, 0, "and the page threw nothing: " + errors.join(" | "));
await browser.close();

console.log(`✓ flows-track-render: ${checks} assertions — a score track that draws a bar per ` +
  `measurement and a gap per absence, a measured zero kept, one scale shared by every strip, a ` +
  `page that opens on today's strongest reading and on any linked name, calls scored against ` +
  `the closes that followed them at 1, 5 and 10 sessions with open calls left open, a name ` +
  `without closes drawn unavailable rather than empty, and the gap-is-not-zero sentence one tap ` +
  `from the title`);
