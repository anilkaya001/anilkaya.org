import assert from "node:assert/strict";
import { MARKET_INDICES, parseIndexQuote, buildSnapshot } from "../shared/markets.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-9) => { assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`); checks++; };

const index = (key) => MARKET_INDICES.find((i) => i.key === key);
const at = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm) / 1000;

const chart = ({ meta, timestamp, close }) => ({ chart: { result: [{
  meta, ...(timestamp ? { timestamp } : {}), indicators: { quote: [{ close }] },
}], error: null } });

const NEW_YORK = { currency: "USD", symbol: "^GSPC", gmtoffset: -14400, exchangeTimezoneName: "America/New_York" };

{
  const stamps = [at(2026, 9, 23, 13, 30), at(2026, 9, 24, 13, 30), at(2026, 9, 25, 13, 30), at(2026, 9, 28, 13, 30), at(2026, 9, 29, 13, 30)];
  const closes = [7700, 7710, 7720, 7686.7, 7670.84];
  const q = parseIndexQuote(index("sp500"), chart({
    meta: { ...NEW_YORK, regularMarketPrice: 7670.84, regularMarketTime: at(2026, 9, 29, 20, 38), chartPreviousClose: 7764.64 },
    timestamp: stamps, close: closes,
  }));
  near(q.changePct, (7670.84 / 7686.7 - 1) * 100, "THE DAY CHANGE IS AGAINST THE PREVIOUS SESSION'S CLOSE: 7670.84 over Monday's 7686.70", 1e-9);
  ok(q.changePct > -0.25 && q.changePct < -0.15,
     `about −0.21%, not the −1.21% that 7,764.64 gave — the close BEFORE the five-day range, which is what chartPreviousClose is (${q.changePct.toFixed(3)}%)`);
  eq(q.prevClose, 7686.7, "and the base is published beside the change");
  eq(q.prevDay, "2026-09-28", "with the exchange-local date of the session it belongs to");
  eq(q.asOfDay, "2026-09-29", "and the quote carries the exchange-local date of its own session");
  eq(q.asOf, at(2026, 9, 29, 20, 38) * 1000, "and its own instant, in milliseconds");
}

{
  const stamps = [at(2026, 9, 21, 13, 30), at(2026, 9, 22, 13, 30), at(2026, 9, 23, 13, 30), at(2026, 9, 24, 13, 30), at(2026, 9, 25, 13, 30)];
  const q = parseIndexQuote(index("sp500"), chart({
    meta: { ...NEW_YORK, regularMarketPrice: 7720, regularMarketTime: at(2026, 9, 25, 20, 0), chartPreviousClose: 7000 },
    timestamp: stamps, close: [7601, 7650, 7700, 7710, 7720],
  }));
  eq(q.prevClose, 7710, "ON A WEEKEND the last bar is Friday's and the base is Thursday's, whatever chartPreviousClose says");
  eq(q.asOfDay, "2026-09-25", "the quote is dated Friday, so the strip can say Close Fri instead of a time of day");
  near(q.changePct, (7720 / 7710 - 1) * 100, "and the change is Friday over Thursday", 1e-9);
}

{
  const stamps = [at(2026, 9, 23, 0, 0), at(2026, 9, 24, 0, 0), at(2026, 9, 25, 0, 0), at(2026, 9, 28, 0, 0), at(2026, 9, 29, 0, 0)];
  const q = parseIndexQuote(index("nikkei"), chart({
    meta: { currency: "JPY", gmtoffset: 32400, regularMarketPrice: 40100, regularMarketTime: at(2026, 9, 29, 6, 25), chartPreviousClose: 39000 },
    timestamp: stamps, close: [39500, 39600, 39700, 39800, 40100],
  }));
  eq(q.prevClose, 39800, "TOKYO: a bar stamped 00:00 UTC is 09:00 in Tokyo, the same local day as the 06:25 UTC close, so the base is the day before");
  eq(q.asOfDay, "2026-09-29", "dated by the exchange's own calendar through gmtoffset");
}

{
  const stamps = [at(2026, 9, 24, 13, 30), at(2026, 9, 25, 13, 30), at(2026, 9, 28, 13, 30), at(2026, 9, 29, 13, 30)];
  const q = parseIndexQuote(index("sp500"), chart({
    meta: { ...NEW_YORK, regularMarketPrice: 7686.7, regularMarketTime: at(2026, 9, 28, 20, 0), chartPreviousClose: 7000 },
    timestamp: stamps, close: [7710, 7720, 7686.7, null],
  }));
  eq(q.prevClose, 7720, "A TRAILING BAR WITH NO CLOSE (today's, before the open) is dropped AFTER it is paired with its stamp, so Monday's base is Friday's");
  eq(q.prevDay, "2026-09-25", "and the pairing keeps dates aligned with closes when a null sits in the middle");
  const gap = parseIndexQuote(index("sp500"), chart({
    meta: { ...NEW_YORK, regularMarketPrice: 7720, regularMarketTime: at(2026, 9, 25, 20, 0) },
    timestamp: [at(2026, 9, 23, 13, 30), at(2026, 9, 24, 13, 30), at(2026, 9, 25, 13, 30)], close: [7700, null, 7720],
  }));
  eq(gap.prevClose, 7700, "a null in the middle is skipped, the last dated close before the quote's day is used");
}

{
  const dup = parseIndexQuote(index("dax"), chart({
    meta: { currency: "EUR", gmtoffset: 7200, regularMarketPrice: 18100, regularMarketTime: at(2026, 9, 29, 15, 35), chartPreviousClose: 17000 },
    timestamp: [at(2026, 9, 25, 7, 0), at(2026, 9, 28, 7, 0), at(2026, 9, 29, 7, 0), at(2026, 9, 29, 15, 35)],
    close: [17900, 18000, 18095, 18100],
  }));
  eq(dup.prevClose, 18000, "a second bar for the same local day is not a previous session: the base is the last bar of an earlier day");
}

{
  const legacy = parseIndexQuote(index("sp500"), chart({
    meta: { currency: "USD", regularMarketPrice: 105, chartPreviousClose: 100, regularMarketTime: 1790380000 },
    close: [100, 101, 102, 103, 105],
  }));
  eq(legacy.prevClose, 103, "WITHOUT TIMESTAMPS the second-to-last close is the base when the last close is the quote's own");
  eq(legacy.prevDay, null, "and the base's date is honestly unknown");
  const far = parseIndexQuote(index("sp500"), chart({
    meta: { currency: "USD", regularMarketPrice: 120, chartPreviousClose: 100, previousClose: 104 }, close: [100, 101, 102, 103, 105],
  }));
  eq(far.prevClose, 104, "and when the last bar is not the quote's the vendor's previousClose is used, never chartPreviousClose");
  const none = parseIndexQuote(index("sp500"), chart({
    meta: { currency: "USD", regularMarketPrice: 120, chartPreviousClose: 100 }, close: [105],
  }));
  ok(none.changePct === null && none.prevClose === null && none.price === 120,
     "WITH NO CONSISTENT BASE the price is kept and the change is null, so the strip prints a dash rather than a 5-session move");
}

{
  ok(parseIndexQuote(index("sp500"), { chart: { result: [] } }) === null, "no result, no quote");
  ok(parseIndexQuote(index("sp500"), chart({ meta: { currency: "USD" }, close: [] })) === null, "no price at all, no quote");
  const snapshot = buildSnapshot([{ key: "dax" }, null, { key: "bist100" }, { key: "unknown" }], 1234);
  eq(snapshot.quotes.map((x) => x.key).join(), "bist100,dax", "the snapshot keeps the configured order and drops unknown keys");
  eq(snapshot.updatedAt, 1234, "and stamps the fetch instant");
}

console.log(`✓ markets: ${checks} assertions — a day change taken against the previous session's close from the same response rather than the close before the range, dated by the exchange's own calendar, stamps paired with closes before nulls are dropped, weekends and Tokyo mornings, and a null change where no consistent base exists`);
