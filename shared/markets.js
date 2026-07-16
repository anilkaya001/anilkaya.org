/* =============================================================
   markets.js — index list + Yahoo-chart parsing for the live ticker.

   Pure, side-effect-free helpers shared by the Worker (which does the
   fetching/caching) and the test suite. The browser never imports this; it
   only ever reads the cached snapshot from same-origin /api/markets.
   ============================================================= */

// One entry per exchange shown on the landing page. `yahoo` is the chart-API
// symbol; `currency` is the domestic-currency fallback if the payload omits it.
export const MARKET_INDICES = Object.freeze([
  { key: "bist100", label: "BIST 100",   city: "İstanbul",  yahoo: "XU100.IS",  currency: "TRY" },
  { key: "ftse100", label: "FTSE 100",   city: "London",    yahoo: "^FTSE",     currency: "GBP" },
  { key: "dax",     label: "DAX",        city: "Frankfurt", yahoo: "^GDAXI",    currency: "EUR" },
  { key: "sp500",   label: "S&P 500",    city: "New York",  yahoo: "^GSPC",     currency: "USD" },
  { key: "nikkei",  label: "Nikkei 225", city: "Tokyo",     yahoo: "^N225",     currency: "JPY" },
  { key: "hsi",     label: "Hang Seng",  city: "Hong Kong", yahoo: "^HSI",      currency: "HKD" },
  { key: "sse",     label: "SSE Comp.",  city: "Shanghai",  yahoo: "000001.SS", currency: "CNY" },
  { key: "nifty",   label: "NIFTY 50",   city: "Mumbai",    yahoo: "^NSEI",     currency: "INR" },
].map(Object.freeze));

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : NaN);

// Normalize one Yahoo /v8/finance/chart/<symbol> payload into a compact quote,
// or null if the shape is missing/unusable. Prefers meta.regularMarketPrice and
// meta.chartPreviousClose, falling back to the last two valid daily closes so a
// partial payload still yields a 1-day change.
export function parseIndexQuote(index, data) {
  const result = data && data.chart && Array.isArray(data.chart.result) ? data.chart.result[0] : null;
  const meta = result && result.meta ? result.meta : null;
  if (!meta) return null;

  const closes = ((result.indicators && result.indicators.quote && result.indicators.quote[0] &&
    result.indicators.quote[0].close) || []).filter((v) => Number.isFinite(v));
  let price = num(meta.regularMarketPrice);
  if (!Number.isFinite(price)) price = num(closes[closes.length - 1]);
  let prev = num(meta.chartPreviousClose);
  if (!Number.isFinite(prev)) prev = num(meta.previousClose);
  if (!Number.isFinite(prev)) prev = num(closes[closes.length - 2]);
  if (!Number.isFinite(price) || !Number.isFinite(prev) || prev === 0) return null;

  const asOfSec = num(meta.regularMarketTime);
  return {
    key: index.key,
    label: index.label,
    city: index.city,
    currency: typeof meta.currency === "string" && meta.currency ? meta.currency : index.currency,
    price,
    changePct: ((price - prev) / prev) * 100,
    asOf: Number.isFinite(asOfSec) && asOfSec > 0 ? Math.round(asOfSec * 1000) : null,
  };
}

// Assemble the snapshot the client consumes. Quotes are ordered to match
// MARKET_INDICES regardless of fetch-completion order.
export function buildSnapshot(quotes, now) {
  const byKey = new Map(quotes.filter(Boolean).map((q) => [q.key, q]));
  const ordered = MARKET_INDICES.map((index) => byKey.get(index.key)).filter(Boolean);
  return { quotes: ordered, updatedAt: now };
}
