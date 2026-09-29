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

const localDay = (seconds, offset) => new Date((seconds + offset) * 1000).toISOString().slice(0, 10);

const SAME_BAR = 0.005;

export function parseIndexQuote(index, data) {
  const result = data && data.chart && Array.isArray(data.chart.result) ? data.chart.result[0] : null;
  const meta = result && result.meta ? result.meta : null;
  if (!meta) return null;

  const raw = (result.indicators && result.indicators.quote && result.indicators.quote[0] &&
    result.indicators.quote[0].close) || [];
  const stamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const offset = Number.isFinite(meta.gmtoffset) ? meta.gmtoffset : 0;
  const dated = stamps.length === raw.length;
  const bars = [];
  for (let i = 0; i < raw.length; i++) {
    if (Number.isFinite(raw[i]) && raw[i] > 0) bars.push({ close: raw[i], day: dated && Number.isFinite(stamps[i]) ? localDay(stamps[i], offset) : null });
  }
  const last = bars.length ? bars[bars.length - 1] : null;
  let price = num(meta.regularMarketPrice);
  if (!Number.isFinite(price) && last) price = last.close;

  const asOfSec = num(meta.regularMarketTime);
  const asOfDay = Number.isFinite(asOfSec) && asOfSec > 0 ? localDay(asOfSec, offset) : last && last.day;
  let prev = NaN;
  let prevDay = null;
  if (asOfDay && bars.some((bar) => bar.day)) {
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].day && bars[i].day < asOfDay) { prev = bars[i].close; prevDay = bars[i].day; break; }
    }
  } else if (bars.length > 1 && Math.abs(last.close / price - 1) <= SAME_BAR) {
    prev = bars[bars.length - 2].close;
  }
  if (!Number.isFinite(prev)) prev = num(meta.previousClose);
  if (!Number.isFinite(price)) return null;
  const based = Number.isFinite(prev) && prev > 0;

  return {
    key: index.key,
    label: index.label,
    city: index.city,
    currency: typeof meta.currency === "string" && meta.currency ? meta.currency : index.currency,
    price,
    changePct: based ? ((price - prev) / prev) * 100 : null,
    prevClose: based ? prev : null,
    prevDay: based ? prevDay : null,
    asOf: Number.isFinite(asOfSec) && asOfSec > 0 ? Math.round(asOfSec * 1000) : null,
    asOfDay: asOfDay || null,
  };
}

export function buildSnapshot(quotes, now) {
  const byKey = new Map(quotes.filter(Boolean).map((q) => [q.key, q]));
  const ordered = MARKET_INDICES.map((index) => byKey.get(index.key)).filter(Boolean);
  return { quotes: ordered, updatedAt: now };
}

export const MARKET_STALE_MS = 45 * 60 * 1000;
export const MARKET_CRON_STALE_MS = 25 * 60 * 1000;

export function marketRefreshDue(ageMs, inWindow) {
  if (inWindow) return true;
  return !(typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs <= MARKET_CRON_STALE_MS);
}
