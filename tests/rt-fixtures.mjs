import {
  fakeLiveVendor, fakeScreenerRows, fakeSpotExposures, fakeMarketTide, fakeSectorEtfs,
} from "../scripts/flows-legs/live-fake.mjs";
import { sessionOpen } from "../shared/flows-freshness.js";

const isoMicro = (ms) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");

export const ALERT_EVERY_MS = 1500;
export const NEWS_EVERY_MS = 20000;

export function createFakeVendor({ session, clock }) {
  const t0 = sessionOpen(session);
  const base = fakeLiveVendor({ session, now: () => clock() });
  const vendor = {
    session, clock, lagMs: 0, fault: null, retryAfterS: null, delayMs: 0, alertEveryMs: ALERT_EVERY_MS,
    calls: [], quoteStamps: true, tideStale: false,
    alertCount(at = clock()) {
      return Math.max(0, Math.floor((at - 900 - t0) / vendor.alertEveryMs) + 1);
    },
    alertAt(n) {
      const at = t0 + n * vendor.alertEveryMs;
      const names = ["NVDA", "AAPL", "TSLA", "SPY", "QQQ", "SYL001", "SYS002"];
      const t = names[n % names.length];
      const k = 100 + (n % 40) * 5;
      const cp = n % 2 ? "C" : "P";
      const exp = session.replace(/-/g, "").slice(2);
      const prem = 50000 + (n % 17) * 10000;
      return {
        id: `A${String(n).padStart(6, "0")}`, ticker: t,
        option_chain: `${t}${exp}${cp}${String(k * 1000).padStart(8, "0")}`,
        created_at: isoMicro(at + 900), start_time: at, end_time: at + 500,
        total_premium: String(prem), total_size: 10 + (n % 90), trade_count: 1 + (n % 7),
        total_ask_side_prem: String(Math.round(prem * 0.6)), total_bid_side_prem: String(Math.round(prem * 0.3)),
        has_sweep: n % 3 === 0, has_floor: false, has_singleleg: true, all_opening_trades: n % 4 === 0,
        open_interest: 1000 + n, volume_oi_ratio: "1.5", iv_start: "0.30", iv_end: "0.31", underlying_price: "100.5",
        strike: String(k), expiry: session, alert_rule: "RepeatedHits",
      };
    },
    alerts(params) {
      const at = clock();
      const total = vendor.alertCount(at);
      const since = params.newer_than && /T/.test(params.newer_than) ? Date.parse(params.newer_than) : -Infinity;
      const limit = Math.min(Number(params.limit) || 200, 200);
      const rows = [];
      for (let n = total - 1; n >= 0 && rows.length < limit; n--) {
        const row = vendor.alertAt(n);
        if (Date.parse(row.created_at) <= since) break;
        rows.push(row);
      }
      return { data: rows, newer_than: params.newer_than || session, older_than: rows.length ? rows[rows.length - 1].created_at : null };
    },
    news() {
      const at = clock();
      const total = Math.max(0, Math.floor((at - t0) / NEWS_EVERY_MS) + 1);
      const rows = [];
      for (let i = total - 1; i >= 0 && rows.length < 100; i--) {
        rows.push({
          meta: {}, source: i % 3 ? "Business Wire" : "Benzinga", created_at: new Date(t0 + i * NEWS_EVERY_MS).toISOString().slice(0, 19) + "Z",
          tags: ["tag-" + (i % 3)], tickers: i % 2 ? ["NVDA", "aapl"] : [], headline: `Synthetic headline ${i}`,
          is_major: i % 10 === 0, sentiment: ["neutral", "positive", "negative"][i % 3],
        });
      }
      return { data: rows };
    },
    screener(params) {
      const at = clock();
      const list = String(params.ticker || "").split(",").filter(Boolean);
      const body = fakeScreenerRows(list, { session, dated: true, now: at });
      body.data.forEach((row, i) => {
        const drift = 1 + 0.0004 * Math.sin(at / 4000 + i);
        row.close = (Number(row.close) * drift).toFixed(4);
        row.quote_time = vendor.quoteStamps ? Math.floor(at / 1000) * 1000 - vendor.lagMs - (i % 3) * 1000 : null;
      });
      return body;
    },
    async handle(path, params = {}) {
      vendor.calls.push({ path, params, at: clock() });
      if (vendor.delayMs) await new Promise((r) => setTimeout(r, vendor.delayMs));
      if (vendor.fault === "429") return { status: 429, body: { error: "rate" }, headers: vendor.retryAfterS ? { "Retry-After": String(vendor.retryAfterS) } : {} };
      if (vendor.fault === "500") return { status: 500, body: { error: "down" } };
      if (vendor.fault === "garbage") return { status: 200, body: "<html>not json</html>", raw: true };
      let body;
      if (path === "/api/screener/stocks") body = vendor.screener(params);
      else if (path === "/api/option-trades/flow-alerts") body = vendor.alerts(params);
      else if (path === "/api/news/headlines") body = vendor.news();
      else if (path === "/api/market/market-tide") body = fakeMarketTide({ session, now: vendor.tideStale ? clock() - 3600e3 : clock() });
      else if (path === "/api/market/sector-etfs") body = fakeSectorEtfs({ session });
      else if (/^\/api\/stock\/[^/]+\/spot-exposures$/.test(path)) {
        body = fakeSpotExposures(decodeURIComponent(path.split("/")[3]), { session, now: clock() });
      } else body = await base(path, params, { envelope: true });
      return { status: 200, body };
    },
    count: (re) => vendor.calls.filter((c) => re.test(c.path)).length,
    paramsOf: (re) => vendor.calls.filter((c) => re.test(c.path)).map((c) => c.params),
  };
  return vendor;
}

export function fetchFor(vendor) {
  return async (input, init = {}) => {
    const u = new URL(String(input));
    if (init.signal && init.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const abort = init.signal ? new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) : null;
    const work = vendor.handle(u.pathname, Object.fromEntries(u.searchParams.entries()));
    const out = await (abort ? Promise.race([work, abort]) : work);
    if (out.hang) await (abort || new Promise(() => {}));
    return new Response(out.raw ? out.body : JSON.stringify(out.body), { status: out.status, headers: out.headers || {} });
  };
}

export function vendorHandler(vendor) {
  return async (req, res) => {
    const u = new URL(req.url, "http://vendor");
    const out = await vendor.handle(u.pathname, Object.fromEntries(u.searchParams.entries()));
    res.writeHead(out.status, { "Content-Type": "application/json", ...(out.headers || {}) });
    res.end(out.raw ? out.body : JSON.stringify(out.body));
  };
}
