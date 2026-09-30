import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { MARKET_INDICES, parseIndexQuote, buildSnapshot } from "../shared/markets.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const SCRIPT = readFileSync(new URL("../assets/js/market-ticker.js", import.meta.url), "utf8");
const ORIGIN = "http://ticker.test";
const utc = (m, d, hh = 0, mm = 0) => Date.UTC(2026, m - 1, d, hh, mm);
const sec = (m, d, hh = 0, mm = 0) => utc(m, d, hh, mm) / 1000;
const chart = (meta, bars) => ({ chart: { result: [{ meta, timestamp: bars.map((b) => b[0]), indicators: { quote: [{ close: bars.map((b) => b[1]) }] } }], error: null } });
const index = (k) => MARKET_INDICES.find((i) => i.key === k);
const daily = (hh, mm, closes) => closes.map((c, i) => [sec(...[[9, 23], [9, 24], [9, 25], [9, 28], [9, 29]][i], hh, mm), c]);

const parsed = (key, response) => parseIndexQuote(index(key), response);
const regular = (end, gmtoffset) => ({ regular: { timezone: "EDT", start: end - 23400, end, gmtoffset } });
const tuesday = [
  parsed("sp500", chart({ currency: "USD", gmtoffset: -14400, regularMarketPrice: 7670.84, regularMarketTime: sec(9, 29, 20, 38), chartPreviousClose: 7764.64,
    currentTradingPeriod: regular(sec(9, 29, 20, 0), -14400) },
    daily(13, 30, [7700, 7710, 7720, 7686.7, 7670.84]))),
  parsed("nikkei", chart({ currency: "JPY", gmtoffset: 32400, regularMarketPrice: 40100, regularMarketTime: sec(9, 29, 6, 25), chartPreviousClose: 39000 },
    daily(0, 0, [39500, 39600, 39700, 39800, 40100]))),
  parsed("bist100", chart({ currency: "TRY", gmtoffset: 10800, regularMarketPrice: 13251.9, regularMarketTime: sec(9, 29, 15, 10), chartPreviousClose: 14000 },
    daily(7, 0, [13100, 13150, 13200, 13240, 13251.9]))),
];

const browser = await chromium.launch();

async function tickerAt({ now, snapshot }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.addInitScript((fixed) => { Date.now = () => fixed; }, now);
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/markets") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
    if (path === "/assets/js/market-ticker.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: SCRIPT });
    return route.fulfill({ status: 200, contentType: "text/html",
      body: '<!doctype html><meta charset="utf-8"><title>ticker</title><div id="marketTicker" hidden></div><script src="/assets/js/market-ticker.js"></script>' });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector("#marketTicker:not([hidden]) .tk");
  const items = await page.$$eval("#marketTicker .market-ticker__set:first-child .tk", (els) => els.map((el) => ({
    text: el.textContent, title: el.getAttribute("title"), dir: el.dataset.dir,
    name: (el.querySelector(".tk__name") || {}).textContent, chg: (el.querySelector(".tk__chg") || {}).textContent,
    asof: (el.querySelector(".tk__asof") || {}).textContent || null,
    closed: el.querySelector(".tk__asof") ? el.querySelector(".tk__asof").dataset.closed : null,
    note: el.classList.contains("tk--note"),
  })));
  await page.close();
  eq(errors.join(" | "), "", "no page error while rendering");
  return { items, byName: Object.fromEntries(items.filter((i) => !i.note).map((i) => [i.name, i])) };
}

{
  const { items, byName: by } = await tickerAt({ now: utc(9, 29, 20, 40), snapshot: buildSnapshot(tuesday, utc(9, 29, 20, 39)) });
  eq(Object.keys(by).length, 3, "three quotes render");
  eq(by["S&P 500"].asof, "Close 23:38", "THE S&P QUOTE SHOWS ITS OWN TIME, 20:38 UTC as İstanbul's 23:38, not a fetch stamp");
  eq(by["S&P 500"].closed, "true", "and reads as the close, because the exchange's session ended at 20:00 UTC and the quote was struck 38 minutes after it, within minutes of the fetch");
  eq(by["Nikkei 225"].asof, "Close 09:25", "Tokyo's 06:25 UTC close reads as a close, with its own İstanbul time");
  eq(by["Nikkei 225"].closed, "true", "flagged closed");
  eq(by["BIST 100"].asof, "Close 18:10", "and so does Istanbul's own, hours older than the fetch");
  eq(by["S&P 500"].chg, "▼ \u22120.21%", "THE CHANGE IS AGAINST MONDAY'S CLOSE: 7,670.84 over 7,686.70, not the −1.21% of the close before the five-day range");
  eq(by["Nikkei 225"].chg, "▲ +0.75%", "and Tokyo's is 40,100 over the day before's 39,800");
  ok(by["S&P 500"].title.includes("against the close of 2026-09-28"), "the tooltip names the session the change is against");
  ok(by["S&P 500"].title.includes("İstanbul time"), "and the zone of the time it prints");
  ok(!items.some((i) => /As of/i.test(i.text)), "NO SINGLE 'AS OF' STAMP sits over eight prices of different ages");
  const note = items.find((i) => i.note);
  ok(note && !/\d\d:\d\d/.test(note.text), "the note carries no clock time at all");
  ok(note && /previous close/.test(note.text), "and says what the change is against");
}

{
  const session = (asOf, sessionEnd) => ({ key: "sp500", label: "S&P 500", city: "New York", currency: "USD", price: 7670.84, changePct: -0.21,
    prevClose: 7686.7, prevDay: "2026-09-28", asOf, asOfDay: "2026-09-29", sessionEnd });
  const view = async (quote, fetched, now) => (await tickerAt({ now, snapshot: { quotes: [quote], updatedAt: fetched } })).byName["S&P 500"];
  const shut = utc(9, 29, 20, 0);
  const late = await view(session(shut, shut), utc(9, 29, 20, 5), utc(9, 29, 20, 40));
  ok(late.closed === "true" && late.asof === "Close 23:00",
    `A MARKET THAT CLOSED 40 MINUTES AGO READS AS A CLOSE though the fetch was five minutes after it and the viewer's clock is under an hour ahead (${late.asof})`);
  const behind = await view(session(utc(9, 29, 15, 0), shut), utc(9, 29, 15, 40), utc(9, 29, 15, 45));
  ok(behind.closed === "false" && behind.asof === "18:00",
    `while a live session whose feed runs 40 minutes behind is a quote at its own time, never a close (${behind.asof})`);
  ok(/^quote,/.test(behind.title.split("; ")[1]), "and its hover says quote");
  const stuck = await view(session(utc(9, 29, 15, 0), shut), utc(9, 29, 22, 0), utc(9, 29, 22, 5));
  ok(stuck.closed === "false" && stuck.asof === "Tue 18:00",
    `and a mid-session print the snapshot never replaced is not promoted to a close either: it keeps its own time, with the weekday once İstanbul's date has moved on (${stuck.asof})`);
  const edge = await view(session(utc(9, 29, 19, 56), shut), utc(9, 29, 20, 3), utc(9, 29, 20, 4));
  ok(edge.closed === "true", "the last print within five minutes of the end is the close: an exchange's final tick is not always on the minute");
  const noEnd = await view(session(utc(9, 29, 20, 38)), utc(9, 29, 21, 0), utc(9, 29, 21, 2));
  ok(noEnd.closed === "false" && noEnd.asof === "Tue 23:38",
    "WITHOUT A SESSION END (a snapshot stored before it was kept) the old reading applies: a quote within 25 minutes of the fetch is a quote");
  const oldNoEnd = await view(session(utc(9, 29, 18, 0)), utc(9, 29, 19, 30), utc(9, 29, 19, 32));
  ok(oldNoEnd.closed === "true", "and one more than 25 minutes behind the fetch is a close");
}

{
  const friday = (key, label, city, currency, price, changePct, prev, asOf) => ({ key, label, city, currency, price, changePct, prevClose: prev,
    prevDay: "2026-09-24", asOf, asOfDay: "2026-09-25" });
  const quotes = [
    friday("sp500", "S&P 500", "New York", "USD", 7720, 0.13, 7710, utc(9, 25, 20, 0)),
    friday("nikkei", "Nikkei 225", "Tokyo", "JPY", 40100, -0.4, 40260, utc(9, 25, 6, 25)),
  ];
  const { byName: by } = await tickerAt({ now: utc(9, 27, 12, 5), snapshot: { quotes, updatedAt: utc(9, 27, 12, 0) } });
  ok(Object.values(by).every((i) => i.closed === "true"),
     "ON A SUNDAY every quote is a close, though the snapshot was fetched five minutes ago");
  eq(by["S&P 500"].asof, "Close Fri",
     "and a close from an earlier day names its weekday instead of reading as a time of day: Friday's 23:00 does not look like Sunday afternoon");
  eq(by["Nikkei 225"].asof, "Close Fri", "for every market");
  ok(by["S&P 500"].title.includes("Fri Sep 25 23:00"), "with the full day and time one hover away");
  const week = await tickerAt({ now: utc(10, 12, 12, 0), snapshot: { quotes, updatedAt: utc(10, 12, 11, 55) } });
  eq(week.byName["S&P 500"].asof, "Close Sep 25", "and a close more than a week old carries its date");
}

{
  const old = { quotes: [{ key: "sp500", label: "S&P 500", city: "New York", currency: "USD", price: 7666.18, changePct: -1.268, asOf: utc(9, 29, 18, 0) }],
    updatedAt: utc(9, 29, 18, 0) };
  const { items } = await tickerAt({ now: utc(9, 29, 18, 5), snapshot: old });
  const spx = items.find((i) => !i.note);
  eq(spx.chg, "\u2014", "A QUOTE STORED BEFORE THE BASE WAS FIXED (no asOfDay) prints a dash, not its five-session percentage");
  eq(spx.dir, "none", "and takes no arrow or tone");
  ok(/no previous close/.test(spx.title), "and its tooltip says why");
  eq(spx.asof, "21:00", "while its own time still shows");
}

{
  const none = { quotes: [{ key: "sp500", label: "S&P 500", city: "New York", currency: "USD", price: 120, changePct: null, prevClose: null,
    prevDay: null, asOf: utc(9, 29, 18, 0), asOfDay: "2026-09-29" }], updatedAt: utc(9, 29, 18, 0) };
  const { items } = await tickerAt({ now: utc(9, 29, 18, 5), snapshot: none });
  eq(items.find((i) => !i.note).chg, "\u2014", "a quote with no consistent base is shown with its price and a dash");
}

await browser.close();

console.log(`✓ market-ticker-render: ${checks} assertions — each quote printed with its own İstanbul time, a close read as a close from the exchange's own session end (a quote struck after it, a market that closed forty minutes ago, a delayed live feed that is not one) with the weekday when it is from an earlier day and the date when it is older than a week, no single fetch-time stamp over eight prices, the change stated against the previous session's close, and a dash for a quote with no base or one stored before the base was fixed`);
