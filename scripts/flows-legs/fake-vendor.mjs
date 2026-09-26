import { addDays, weekdaysAhead, priorWeekdayIso, isWeekdayIso } from "../../shared/flows-cross.js";

function prng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const s = (v, d = 4) => (v === null ? null : Number(v).toFixed(d));

export const FAKE_INDEX = Object.freeze({ SPY: 774.26, QQQ: 601.18, IWM: 243.57 });

export const FAKE_FUNDS = Object.freeze({
  GLD: 391.645, IAU: 80.12, SLV: 43.21, CPER: 40.645, COPX: 55.31, GDX: 92.29, GDXJ: 118.44, SIL: 90.86, SILJ: 27.4,
});

const FAKE_ETF_NAMES = Object.freeze({
  SPY: "SPDR S&P 500 ETF Trust", QQQ: "Invesco QQQ Trust", IWM: "iShares Russell 2000 ETF",
  GLD: "SPDR Gold Shares", IAU: "iShares Gold Trust", SLV: "iShares Silver Trust",
  CPER: "United States Copper Index Fund", COPX: "Global X Copper Miners ETF",
  GDX: "VanEck Gold Miners ETF", GDXJ: "VanEck Junior Gold Miners ETF",
  SIL: "Global X Silver Miners ETF", SILJ: "Amplify Junior Silver Miners ETF",
});

const fakeEtfPx = (t) => FAKE_INDEX[t] || FAKE_FUNDS[t] || null;

const TENORS = [1, 5, 7, 14, 30, 60, 90, 180, 365];

export function augmentScreenerRow(row, { sessionDate }) {
  const rnd = prng(hash("aug:" + row.ticker));
  const close = Number(row.close) || 50;
  const iv30 = row.iv30d !== undefined ? Number(row.iv30d) : null;
  const out = { ...row, date: sessionDate };
  const slope = (rnd() - 0.55) * 0.3;
  for (const d of TENORS) {
    const v = iv30 === null ? null : Math.max(0.05, iv30 * (1 + slope * Math.log(d / 30) / Math.log(12)) * (d <= 7 ? 1 + (rnd() - 0.4) * 0.2 : 1));
    out["volatility_" + d] = v === null ? null : v.toFixed(3);
    out["implied_move_perc_" + d] = v === null ? null : (v * Math.sqrt(d / 365) * 0.8).toFixed(3);
  }
  const rv = iv30 === null ? 0.25 : iv30 * (0.7 + rnd() * 0.5);
  const adv = Math.round(2e6 + rnd() * 6e7);
  Object.assign(out, {
    iv_percentile_1y: (rnd() * 100).toFixed(1),
    iv_percentile_1m: String(Math.round(rnd() * 100)),
    iv_rank_1m: (rnd() * 100).toFixed(4),
    steepness_180_30: iv30 === null ? null : (Number(out.volatility_180) / Number(out.volatility_30)).toFixed(4),
    realized_volatility: rv.toFixed(6),
    variance_risk_premium: ((iv30 === null ? 0.3 : iv30) - rv * (0.8 + rnd() * 0.4)).toFixed(6),
    avg30_volume: String(adv),
    stock_volume: Math.round(adv * (0.5 + rnd())),
    shares_outstanding: String(Math.round(1e8 + rnd() * 5e9)),
    gex_gamma_per_one_percent_move_oi: String(Math.round((rnd() - 0.35) * adv * close * 0.08)),
    gex_gamma_per_one_percent_move_vol: String(Math.round((rnd() - 0.4) * adv * close * 0.05)),
    gex_gamma_per_one_percent_move_dir: String(Math.round((rnd() - 0.5) * adv * close * 0.02)),
    gex_daily_net_gex: String(Math.round((rnd() - 0.35) * 5e6)),
    gex_ratio: (0.3 + rnd() * 1.6).toFixed(4),
    gex_net_change: String(Math.round((rnd() - 0.5) * 1e6)),
    cum_dir_delta: Math.round((rnd() - 0.5) * adv * 0.05),
    cum_dir_gamma: Math.round((rnd() - 0.5) * adv * 0.002),
    cum_dir_vega: Math.round((rnd() - 0.5) * adv * 0.02),
    short_int: (rnd() * 0.12).toFixed(4),
    insider_buy_volume_3m: rnd() > 0.8 ? Math.round(rnd() * 5e5) : 0,
    insider_sell_volume_3m: Math.round(rnd() * 3e6),
    insider_buy_volume_12m: Math.round(rnd() * 1e6),
    insider_sell_volume_12m: Math.round(rnd() * 8e6),
    rv_1d_last_12q: (0.5 + rnd() * 0.9).toFixed(6),
    rsi_14: 20 + rnd() * 60,
    adx_14: 10 + rnd() * 40,
    atr_14: close * (0.01 + rnd() * 0.04),
    sma_50: close * (0.9 + rnd() * 0.2),
    bb_20_2_upper: close * (1.02 + rnd() * 0.06),
    bb_20_2_lower: close * (0.9 + rnd() * 0.06),
    bb_20_2_middle: close,
    industry_type: row.sector === "Technology" && rnd() > 0.6 ? "Semiconductors"
      : row.sector === "Financials" && rnd() > 0.5 ? "Banks - Regional" : "Other",
    er_time: rnd() > 0.5 ? "postmarket" : "premarket",
    z_score: ((rnd() - 0.5) * 3).toFixed(4),
  });
  if (out.sector === "Financials") out.sector = "Financial Services";
  return out;
}

export function fakeIndexRow(ticker, { sessionDate }) {
  const px = fakeEtfPx(ticker) || 100;
  const rnd = prng(hash("idx:" + ticker));
  const extra = prng(hash("etf:" + ticker));
  const base = ticker === "IWM" ? 0.21 : ticker === "QQQ" ? 0.19 : FAKE_FUNDS[ticker] ? 0.24 + extra() * 0.12 : 0.15;
  const row = {
    ticker, date: sessionDate, close: px.toFixed(2), prev_close: (px * (1 - (rnd() - 0.5) * 0.01)).toFixed(2),
    issue_type: "ETF", is_index: false, sector: null, marketcap: null,
    volatility: base.toFixed(3), iv30d: base.toFixed(3), iv30d_1d: (base * 1.02).toFixed(3),
    iv_percentile_1y: (10 + rnd() * 40).toFixed(1), realized_volatility: (base * 0.8).toFixed(6),
    net_call_premium: String(Math.round((rnd() - 0.4) * 4e8)),
    net_put_premium: String(Math.round((rnd() - 0.5) * 5e8)),
    call_volume: Math.round(3e6 + rnd() * 4e6), put_volume: Math.round(4e6 + rnd() * 5e6),
    call_premium: String(Math.round(1.5e9 + rnd() * 1e9)), put_premium: String(Math.round(1.8e9 + rnd() * 1e9)),
    avg30_volume: String(Math.round(5e7 + rnd() * 5e7)),
  };
  for (const d of TENORS) {
    const v = base * (1 + 0.12 * Math.log(d / 30) / Math.log(12)) * (d <= 5 ? 1.08 : 1);
    row["volatility_" + d] = v.toFixed(3);
  }
  row.volatility_30 = base.toFixed(3);
  row.steepness_180_30 = (Number(row.volatility_180) / base).toFixed(4);
  if (FAKE_FUNDS[ticker]) {
    Object.assign(row, {
      marketcap: String(Math.round(1e8 + extra() * 1e11)), full_name: FAKE_ETF_NAMES[ticker],
      bullish_premium: String(Math.round(extra() * 3e8)), bearish_premium: String(Math.round(extra() * 3e8)),
      iv_rank: (extra() * 100).toFixed(2), implied_move_perc: (base * 0.06).toFixed(4),
      relative_volume: (0.6 + extra() * 1.6).toFixed(2), stock_volume: Math.round(2e6 + extra() * 4e7),
      put_call_ratio: (row.put_volume / row.call_volume).toFixed(4),
      total_open_interest: Math.round(2e5 + extra() * 5e6),
    });
  }
  return row;
}

function minuteSeries(day, rnd, make) {
  const t0 = Date.parse(day + "T13:30:00Z");
  return Array.from({ length: 390 }, (_, i) => make(new Date(t0 + i * 60000).toISOString(), i));
}

function cumulativeTide(day, rnd, { scale = 4e6, px = null, strings = true } = {}) {
  let c = 0, p = 0, v = 0, price = px;
  const drift = (rnd() - 0.5) * 0.6;
  return minuteSeries(day, rnd, (ts) => {
    c += (rnd() - 0.5 + drift) * scale;
    p += (rnd() - 0.5 - drift) * scale * 0.8;
    v += Math.round((rnd() - 0.45) * 800);
    if (price !== null) price *= 1 + (rnd() - 0.5) * 0.0008;
    const row = { timestamp: ts, date: day, net_call_premium: c.toFixed(4), net_put_premium: p.toFixed(4) };
    row.net_volume = strings ? String(v) : v;
    if (price !== null) row.underlying_price = price.toFixed(2);
    return row;
  });
}

function anomaly(ticker, dir, rnd, day) {
  const score = (dir === "long_vol" ? -1 : 1) * (30 + rnd() * 60);
  return {
    date: day, ticker, direction: dir, updated_at: day + "T23:15:10.945995Z",
    score: String(score), sample_size: 4 + Math.floor(rnd() * 3),
    components: {
      iv_percentile: { raw: rnd() * 100, value: rnd() * 2 - 1 },
      regime_score: { crash_probability: rnd(), raw: rnd() * 6 - 3, value: rnd() * 2 - 1 },
      skew_percentile: { percentile: rnd() * 100, raw: rnd() * 0.05, value: rnd() * 2 - 1 },
      vov_percentile: { raw: rnd() * 100, value: rnd() * 2 - 1 },
      vrp_z: rnd() > 0.3 ? { mean: 0.01, std: 0.02, raw: rnd() * 0.05, value: rnd() * 4 - 2 } : { raw: null, value: null },
    },
  };
}

export function makeFakeVendor({ sessionDate, screenerRows = [], carded = [] } = {}) {
  const S = sessionDate;
  const augmented = screenerRows.map((r) => augmentScreenerRow(r, { sessionDate: S }));
  const tickers = augmented.map((r) => r.ticker);
  const cardedList = carded.length ? carded : tickers.slice(0, 150);
  const calls = [];

  const handlers = [
    [/^\/api\/screener\/stocks$/, (p) => {
      if (p.ticker) {
        const want = String(p.ticker).split(",");
        const idx = want.filter((t) => fakeEtfPx(t)).map((t) => fakeIndexRow(t, { sessionDate: S }));
        return { data: [...idx, ...augmented.filter((r) => want.includes(r.ticker))] };
      }
      const limit = Number(p.limit) || 50;
      const page = Number(p.offset) || 0;
      const sorted = augmented.slice().sort((a, b) => Number(b.marketcap) - Number(a.marketcap));
      return { data: sorted.slice(page * limit, page * limit + limit) };
    }],
    [/^\/api\/short_screener$/, (p) => {
      const want = String(p.tickers || "").split(",").filter(Boolean);
      const data = [];
      for (const t of want) {
        const rnd = prng(hash("si:" + t));
        for (const back of [23, 8]) {
          data.push({
            symbol: t, short_interest: Math.round(rnd() * 5e7), market_date: addDays(S, -back),
            short_shares_available: null, total_float: Math.round(1e8 + rnd() * 5e9),
            si_float: String(rnd() * 0.15), si_float_with_synth_long_pct_of_total_shares: String(rnd() * 0.15),
            days_to_cover: (0.5 + rnd() * 6).toFixed(2), fee_rate: null, rebate_rate: null,
          });
        }
      }
      return { data };
    }],
    [/^\/api\/insider\/transactions$/, (p) => {
      const want = String(p.ticker_symbol || "").split(",").filter(Boolean);
      const page = Number(p.page) || 0;
      if (page > 0) return { data: [], has_more: false };
      const data = [];
      for (const t of want) {
        const rnd = prng(hash("ins:" + t));
        if (rnd() > 0.45) continue;
        const cluster = rnd() > 0.7;
        const n = cluster ? 4 : 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          const buy = cluster || rnd() > 0.6;
          const shares = Math.round(1000 + rnd() * 90000);
          const day = addDays(S, -(cluster ? 3 + i * 4 : Math.floor(rnd() * 88)));
          data.push({
            id: `ins-${t}-${i}`, ticker: t, amount: buy ? shares : -shares, transactions: 1,
            price: (20 + rnd() * 300).toFixed(4), is_officer: i % 2 === 0, is_director: i % 2 === 1,
            is_ten_percent_owner: false, sector: "Technology", is_s_p_500: true,
            transaction_date: day, filing_date: addDays(day, 2) > S ? S : addDays(day, 2),
            owner_name: `INSIDER ${t} ${i}`, reporter_cik: String(1000000 + hash(t + i) % 9000000),
            formtype: "4", security_title: "Common Stock", transaction_code: buy ? "P" : "S",
            is_10b5_1: !buy && rnd() > 0.5, shares_owned_before: 1e6, shares_owned_after: 1e6 + (buy ? shares : -shares),
            officer_title: "", director_indirect: "D", natureofownership: null, ids: [`ins-${t}-${i}`],
            marketcap: "1000000000", next_earnings_date: addDays(S, 30), stock_price: "100.00",
            reporter_is_public_company: false, security_ad_code: buy ? "NA" : "ND",
            date_excercisable: null, price_excercisable: null, expiration_date: null,
          });
        }
      }
      return { data, has_more: false };
    }],
    [/^\/api\/volatility\/vix-term-structure$/, () => {
      throw new Error("/api/volatility/vix-term-structure -> HTTP 403");
    }],
    [/^\/api\/net-flow\/expiry$/, (p) => {
      const rnd = prng(hash("nf:" + p.expiration + p.tide_type + p.moneyness));
      const scale = p.expiration === "zero_dte" ? 3e5 : 9e5;
      const rows = cumulativeTide(S, rnd, { scale: p.tide_type === "all" ? scale : scale / 2, px: FAKE_INDEX.SPY });
      return {
        data: [{ data: rows, moneyness: p.moneyness || "all", tide_type: p.tide_type || "all" }],
        date: S, expiration: [p.expiration || "zero_dte"], moneyness: [p.moneyness || "all"], tide_type: [p.tide_type || "all"],
      };
    }],
    [/^\/api\/market\/daily-report$/, () => {
      const rnd = prng(hash("dr:" + S));
      const pick = () => tickers[Math.floor(rnd() * tickers.length)];
      return { data: {
        date: S,
        vol: {
          richest: Array.from({ length: 4 }, () => anomaly(pick(), "short_vol", rnd, S)),
          cheapest: Array.from({ length: 6 }, () => anomaly(pick(), "long_vol", rnd, S)),
        },
        flow: {
          bullish: Array.from({ length: 5 }, () => ({ ticker: pick(), net_premium: Math.round(rnd() * 2e8) })),
          bearish: Array.from({ length: 5 }, () => ({ ticker: pick(), net_premium: -Math.round(rnd() * 2e8) })),
        },
        skew: Array.from({ length: 10 }, () => anomaly(pick(), rnd() > 0.5 ? "long_vol" : "short_vol", rnd, S)),
        catalysts: {
          data: [
            { meta: {}, type: "econ", date: addDays(S, 2), title: "Consumer Price Index", ticker: null, datetime: addDays(S, 2) + "T12:30:00Z", has_options: null, marketcap: null, impact: "forecast 0.3%", source_url: null, subtitle: null },
            { meta: {}, type: "fda", date: addDays(S, 5), title: "PDUFA decision", ticker: pick(), datetime: null, has_options: true, marketcap: "4200000000", impact: "FDA decision", source_url: null, subtitle: "sNDA" },
            { meta: {}, type: "earnings", date: addDays(S, 1), title: "Earnings", ticker: pick(), datetime: addDays(S, 1) + "T20:05:00Z", has_options: true, marketcap: "95000000000", impact: "±6.2%", source_url: null, subtitle: null },
          ],
          types: ["econ", "fda", "earnings"], counts_by_type: { econ: 1, fda: 1, earnings: 1 },
          date_min: S, date_max: addDays(S, 7),
        },
        stock_movers: Array.from({ length: 6 }, () => ({ ticker: pick() })),
        tide: { data: [], date: S },
        unusual_options: Array.from({ length: 25 }, () => ({ ticker: pick() })),
      } };
    }],
    [/^\/api\/market\/([^/]+)\/sector-tide$/, (p, m) => {
      const rnd = prng(hash("st:" + m[1]));
      return { data: cumulativeTide(S, rnd, { scale: 2e5, strings: false }).map((r) => ({ ...r, net_volume: Number(r.net_volume) })), date: S };
    }],
    [/^\/api\/market\/([A-Z]+)\/etf-tide$/, (p, m) => {
      const rnd = prng(hash("et:" + m[1]));
      return { data: cumulativeTide(S, rnd, { scale: 6e5, px: FAKE_INDEX[m[1]] || 100 }), date: S };
    }],
    [/^\/api\/etfs\/([A-Z]+)\/in-outflow$/, (p, m) => {
      const rnd = prng(hash("io:" + m[1]));
      const data = [];
      let d = S;
      for (let i = 0; i < 252; i++) {
        const close = (FAKE_INDEX[m[1]] || 100) * (1 - i * 0.0005);
        const change = Math.round((rnd() - 0.48) * 8e6);
        data.push({ close: close.toFixed(2), date: d, change, volume: Math.round(3e7 + rnd() * 3e7),
          expiration_cycle: "weekly", change_prem: String(Math.round(change * close)), is_fomc: rnd() > 0.97 });
        d = priorWeekdayIso(d);
      }
      return { data, years: Array.from({ length: 12 }, (_, i) => 2015 + i) };
    }],
    [/^\/api\/etfs\/([A-Z]+)\/holdings$/, (p, m) => {
      const rnd = prng(hash("hold:" + m[1]));
      const members = augmented.slice().sort((a, b) => Number(b.marketcap) - Number(a.marketcap))
        .slice(0, m[1] === "QQQ" ? 100 : 300);
      const raw = members.map(() => rnd() ** 2 + 0.01);
      const total = raw.reduce((a, b) => a + b, 0);
      return { data: members.map((r, i) => ({
        ticker: r.ticker, weight: String((raw[i] / total) * 100), type: "stock", etf: m[1],
        updated: priorWeekdayIso(S), close: r.close, sector: r.sector, has_options: true,
        week52_high: r.week_52_high, week52_low: r.week_52_low, shares: String(Math.round(rnd() * 1e8)),
        name: null, isin: null, cusip: null,
      })) };
    }],
    [/^\/api\/group-flow\/([^/]+)\/greek-flow$/, (p, m) => {
      const rnd = prng(hash("gf:" + m[1]));
      const drift = rnd() - 0.5;
      return { data: minuteSeries(S, rnd, (ts) => {
        const d = (rnd() - 0.5 + drift * 0.5) * 2e5;
        const total = Math.abs(d) * (1.5 + rnd() * 3);
        return {
          timestamp: ts, transactions: Math.round(rnd() * 3e4), volume: Math.round(rnd() * 1.5e5),
          flow_group: decodeURIComponent(m[1]),
          net_call_premium: ((rnd() - 0.45) * 2e6).toFixed(4), net_call_volume: Math.round((rnd() - 0.45) * 8000),
          net_put_premium: ((rnd() - 0.5) * 1.5e6).toFixed(4), net_put_volume: Math.round((rnd() - 0.5) * 5000),
          dir_delta_flow: String(d), dir_vega_flow: String((rnd() - 0.5) * 1e5),
          otm_dir_delta_flow: String(d * 0.6), otm_dir_vega_flow: String((rnd() - 0.5) * 7e4),
          otm_total_delta_flow: String(total * 0.6), otm_total_vega_flow: String(rnd() * 1.5e6),
          total_delta_flow: String(total), total_vega_flow: String(rnd() * 2e6),
          otm_net_call_premium: ((rnd() - 0.45) * 1e6).toFixed(2), otm_net_call_volume: Math.round(rnd() * 6000),
          otm_net_put_premium: ((rnd() - 0.5) * 5e5).toFixed(2), otm_net_put_volume: Math.round(rnd() * 3000),
        };
      }) };
    }],
    [/^\/api\/options-pulse\/total$/, () => {
      const rnd = prng(hash("op:" + S));
      const intraday = Array.from({ length: 40 }, (_, i) => {
        const m = 9 * 60 + 40 + i * 10;
        return { put_txn: Math.round(1e5 + rnd() * 3e4), call_txn: Math.round(3e5 + rnd() * 1e5),
          sntm_score: Number((0.4 + rnd() * 0.3).toFixed(2)), trd_dt: S,
          hr_min: String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0"),
          intvl_sntm_score: Number((0.4 + rnd() * 0.3).toFixed(2)), mkt_sntm: Number((300 + rnd() * 50).toFixed(2)) };
      });
      return { data: { latest: intraday[intraday.length - 1], intraday }, date: S };
    }],
    [/^\/api\/market\/total-options-volume$/, (p) => {
      const rnd = prng(hash("tov:" + S));
      const n = Math.min(Number(p.limit) || 20, 252);
      const data = [];
      let d = S;
      for (let i = 0; i < n; i++) {
        const cv = Math.round(3e7 + rnd() * 2e7), pv = Math.round(cv * (0.55 + rnd() * 0.4));
        data.push({ date: d, call_volume: cv, put_volume: pv,
          call_premium: (cv * (800 + rnd() * 200)).toFixed(2), put_premium: (pv * (500 + rnd() * 300)).toFixed(2) });
        d = priorWeekdayIso(d);
      }
      return { data };
    }],
    [/^\/api\/shorts\/([^/]+)\/data$/, (p, m) => {
      const rnd = prng(hash("sd:" + m[1]));
      const base = rnd() > 0.85 ? 0.03 + rnd() * 0.3 : 0.0025 + rnd() * 0.01;
      const data = [];
      let d = S;
      for (let k = 0; k < 9; k++) {
        for (let h = 0; h < 12; h++) {
          const fee = base * (1 + (8 - k) * 0.02 + (rnd() - 0.5) * 0.05);
          data.push({ name: m[1] + " INC", timestamp: `${d}T${String(13 + Math.floor(h / 2)).padStart(2, "0")}:${h % 2 ? "45" : "15"}:00Z`,
            symbol: m[1], short_shares_available: rnd() > 0.5 ? 10000000 : Math.round(rnd() * 5e6),
            fee_rate: (fee * 100).toFixed(4), rebate_rate: (3.6 - fee * 100).toFixed(4) });
        }
        d = priorWeekdayIso(d);
      }
      return { data: data.sort(() => rnd() - 0.5) };
    }],
    [/^\/api\/shorts\/([^/]+)\/volume-and-ratio$/, (p, m) => {
      const rnd = prng(hash("sv:" + m[1]));
      const si = [];
      let d = S;
      for (let i = 0; i < 120; i++) {
        const tv = Math.round(5e6 + rnd() * 2e7);
        const r = 0.42 + rnd() * 0.18;
        si.push({ total_volume: tv, market_date: d, short_volume: Math.round(tv * r), short_volume_ratio: String(r) });
        d = priorWeekdayIso(d);
      }
      return { si };
    }],
    [/^\/api\/market\/economic-calendar$/, () => {
      const events = [
        ["FOMC Rate Decision", "fomc", 2, "18:00", "5.25", "5.25"],
        ["Consumer Price Index (MoM)", "report", 3, "12:30", "0.2", "0.3"],
        ["Initial Jobless Claims", "report", 3, "12:30", "221K", "225K"],
        ["Nonfarm Payrolls", "report", 5, "12:30", "142", "160"],
        ["U. Michigan Final Consumer Survey", "report", 4, "14:00", "51.7", "47.1"],
        ["Fed Chair Powell Speaks", "speech", 1, "16:00", null, null],
        ["GDP (QoQ) Final", "report", 6, "12:30", "3.0", "3.0"],
        ["Retail Sales", "report", 0, "12:30", "0.1", "0.2"],
      ];
      return { data: events.map(([event, type, ahead, hm, prev, forecast]) => ({
        type, time: `${ahead ? weekdaysAhead(S, ahead)[ahead - 1] : S}T${hm}:00Z`, prev, event, forecast,
        reported_period: ahead ? "September" : null,
      })) };
    }],
    [/^\/api\/market\/fda-calendar$/, () => {
      const rnd = prng(hash("fda:" + S));
      const y = Number(S.slice(0, 4));
      const targets = [addDays(S, 12), addDays(S, 40), `${y}-Q4`, `${y}-LATE`, `${y}-MID`, `${y + 1}-H1`,
        addDays(S, 90), `${y}-11`, "2025-MID", addDays(S, 200), "TBD", addDays(S, 7)];
      return { data: targets.map((tgt, i) => ({
        status: "Phase 3", time: "07:44:07", description: "synthetic", ticker: i === 10 ? "NOPT" : tickers[(i * 37) % tickers.length],
        created_at: S + "T13:22:07Z", event_type: i % 2 ? "PDUFA" : "Top-line Data Due", updated_at: S + "T13:23:09Z",
        outcome: "", source_type: "Press Release", start_date: S, end_date: null, notes: "", has_options: i !== 10,
        marketcap: String(Math.round(1e9 + rnd() * 3e10)), target_date: tgt, catalyst: i % 2 ? "PDUFA" : "Top-line Data Due",
        drug: "Drug-" + i, indication: "Indication " + i, source_link: "", benzinga_id: String(i), commentary: "",
        date_string: tgt, nic_number: "", outcome_brief: "", unique_identifier: "fda-" + i,
      })) };
    }],
    [/^\/api\/earnings\/(premarket|afterhours)$/, (p, m) => {
      const rnd = prng(hash("cal:" + m[1] + p.date));
      const n = isWeekdayIso(p.date) ? Math.floor(rnd() * 7) : 0;
      const data = [];
      for (let i = 0; i < n; i++) {
        const t = tickers[Math.floor(rnd() * tickers.length)];
        const pre = 20 + rnd() * 300;
        const em = 0.03 + rnd() * 0.08;
        const reacted = p.date <= S;
        const post = reacted ? pre * (1 + (rnd() - 0.5) * em * 3) : null;
        data.push({
          symbol: t, source: "company", country_code: "US", full_name: t + " INC", sector: "Technology",
          is_s_p_500: rnd() > 0.5, reaction: null, has_options: true, marketcap: String(Math.round(2e9 + rnd() * 2e11)),
          report_date: p.date, report_time: m[1] === "premarket" ? "premarket" : "postmarket",
          expected_move_perc: String(em), ending_fiscal_quarter: "2026-08-31", expected_move: (pre * em).toFixed(2),
          street_mean_est: (rnd() * 3).toFixed(2), country_name: "UNITED STATES", continent: "North America",
          actual_eps: null, pre_earnings_date: priorWeekdayIso(p.date), pre_earnings_close: pre.toFixed(2),
          post_earnings_date: reacted ? (m[1] === "premarket" ? p.date : weekdaysAhead(p.date, 1)[0]) : null,
          post_earnings_close: post === null ? null : post.toFixed(2),
        });
      }
      return { data };
    }],
    [/^\/api\/earnings\/([A-Z0-9.]+)$/, (p, m) => {
      const rnd = prng(hash("ern:" + m[1]));
      const data = [{
        source: "estimation", report_date: addDays(S, 10 + Math.floor(rnd() * 60)), report_time: "unknown",
        expected_move_perc: null, ending_fiscal_quarter: "2026-09-30", expected_move: null, street_mean_est: "1.99",
        actual_eps: null, post_earnings_move_1d: null, post_earnings_move_1w: null, post_earnings_move_2w: null,
        post_earnings_move_3d: null, pre_earnings_move_1d: null, pre_earnings_move_1w: null, pre_earnings_move_2w: null,
        pre_earnings_move_3d: null, short_straddle_1w: null, short_straddle_1d: null, long_straddle_1w: null, long_straddle_1d: null,
      }];
      const count = rnd() > 0.15 ? 16 : 4;
      for (let q = 0; q < count; q++) {
        const d = addDays(S, -(20 + q * 91));
        const em = 0.03 + rnd() * 0.07;
        const m1d = (rnd() - 0.5) * em * 3;
        const m1w = m1d + (rnd() - 0.5) * em;
        const ls1d = Math.abs(m1d) / em - 1;
        data.push({
          source: "company", report_date: d, report_time: rnd() > 0.5 ? "postmarket" : "premarket",
          expected_move_perc: s(em, 6), ending_fiscal_quarter: d, expected_move: s(em * 100, 2), street_mean_est: "1.50",
          actual_eps: "1.60", post_earnings_move_1d: s(m1d, 6), post_earnings_move_1w: s(m1w, 6),
          post_earnings_move_2w: s(m1w * 1.1, 6), post_earnings_move_3d: s(m1d * 1.05, 6),
          pre_earnings_move_1d: s((rnd() - 0.5) * 0.02, 6), pre_earnings_move_1w: s((rnd() - 0.5) * 0.05, 6),
          pre_earnings_move_2w: s((rnd() - 0.5) * 0.07, 6), pre_earnings_move_3d: s((rnd() - 0.5) * 0.03, 6),
          short_straddle_1w: s(-ls1d * 0.8, 6), short_straddle_1d: s(-ls1d, 6),
          long_straddle_1w: s(ls1d * 0.8, 6), long_straddle_1d: s(ls1d, 6),
        });
      }
      return { data };
    }],
  ];

  const vendor = async (path, params = {}, { envelope = false } = {}) => {
    calls.push(path);
    for (const [re, handler] of handlers) {
      const m = re.exec(path);
      if (!m) continue;
      const body = handler(params, m);
      if (envelope) return body;
      return Array.isArray(body) ? body : (body && body.data) || [];
    }
    throw new Error(`${path} -> HTTP 404`);
  };
  vendor.calls = calls;
  vendor.augmented = augmented;
  vendor.carded = cardedList;
  return vendor;
}
