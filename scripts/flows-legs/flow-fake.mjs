import { sessionWindow, packSeries, toMs } from "../../shared/flows-positioning.js";

const hash = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

function prng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weekdaysEndingAt(day, count) {
  const out = [];
  let t = Date.parse(day + "T12:00:00Z");
  while (out.length < count && Number.isFinite(t)) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    t -= 86400000;
  }
  return out.reverse();
}

const nextWeekday = (day) => {
  let t = Date.parse(day + "T12:00:00Z") + 86400000;
  while ([0, 6].includes(new Date(t).getUTCDay())) t += 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

const s2 = (v, dp = 2) => v.toFixed(dp);
const occ = (t, expiry, cp, k) => `${t}${expiry.slice(2, 4)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}${cp}${String(Math.round(k * 1000)).padStart(8, "0")}`;

const strikeStep = (spot) => (spot >= 500 ? 10 : spot >= 200 ? 5 : spot >= 50 ? 2.5 : 1);

const expiriesFrom = (day, n) => {
  const out = [];
  let t = Date.parse(day + "T12:00:00Z");
  while (out.length < n) {
    t += 86400000;
    if (new Date(t).getUTCDay() === 5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};

const failAt = (t, mod, hit) => hash(t + "#" + mod) % mod === hit;

export function makeFlowFakeVendor({ sessionDate, spotOf = () => 100 }) {
  const win = sessionWindow(sessionDate);
  const history = weekdaysEndingAt(sessionDate, 260);
  const spotFor = (t) => {
    const s = Number(spotOf(t));
    return Number.isFinite(s) && s > 0 ? s : 50 + (hash(t) % 400);
  };

  const greekExposure = (t) => {
    const rnd = prng(hash(t + "gex"));
    const days = history.slice(-250);
    let level = (rnd() - 0.3) * 4e6;
    return {
      data: days.map((d) => {
        level = level * 0.93 + (rnd() - 0.45) * 1.2e6;
        const call = Math.abs(level) + 1e6 + rnd() * 2e6;
        const put = -(call - level);
        return {
          date: d,
          call_gamma: s2(call, 4), put_gamma: s2(put, 4),
          call_delta: s2(1.7e8 + rnd() * 2e7, 4), put_delta: s2(-2.2e7 - rnd() * 5e6, 4),
          call_charm: s2(-2.3e7 - rnd() * 4e6, 4), put_charm: s2(1.6e7 + rnd() * 4e6, 4),
          call_vanna: s2(2.1e7 + rnd() * 5e6, 4), put_vanna: s2(-5.4e7 - rnd() * 8e6, 4),
        };
      }),
    };
  };

  const optionsVolume = (t) => {
    const rnd = prng(hash(t + "ov"));
    const days = [...history.slice(-252), nextWeekday(sessionDate)];
    let oi = 3e6 + rnd() * 2e6;
    const rows = days.map((d) => {
      oi *= 1 + (rnd() - 0.48) * 0.02;
      const cv = Math.round(6e5 + rnd() * 6e5), pv = Math.round(2e5 + rnd() * 4e5);
      const ncp = (rnd() - 0.5) * 8e7, npp = (rnd() - 0.5) * 3e7;
      return {
        date: d, call_volume: cv, put_volume: pv,
        call_volume_ask_side: Math.round(cv * 0.46), call_volume_bid_side: Math.round(cv * 0.45),
        put_volume_ask_side: Math.round(pv * 0.46), put_volume_bid_side: Math.round(pv * 0.43),
        net_call_premium: s2(ncp, 4), net_put_premium: s2(npp, 2),
        call_premium: s2(4e8 + rnd() * 1e8, 4), put_premium: s2(1e8 + rnd() * 5e7, 2),
        avg_30_day_call_volume: s2(9.7e5, 4), avg_30_day_put_volume: s2(5.1e5, 4),
        avg_7_day_call_volume: s2(1e6, 4), avg_7_day_put_volume: "622941",
        bearish_premium: s2(2.7e8 + rnd() * 5e7, 4), bullish_premium: s2(2.1e8 + rnd() * 8e7, 4),
        put_open_interest: Math.round(oi * 0.42), call_open_interest: Math.round(oi * 0.58),
        avg_3_day_put_volume: s2(5.1e5, 4), avg_3_day_call_volume: s2(9.1e5, 4),
      };
    });
    return { data: rows.reverse() };
  };

  const gexLevelsBody = (t, params) => {
    const S = spotFor(t), step = strikeStep(S), rnd = prng(hash(t + "lv"));
    if (failAt(t, 19, 5)) return { data: [] };
    const k = (x) => Math.round(x / step) * step;
    const flip = S * (0.94 + rnd() * 0.08);
    const nearby = failAt(t, 7, 3) ? [flip] : [flip, flip * 0.985, flip * 1.02, flip * 0.97, flip * 1.035];
    return {
      data: {
        date: params.date || sessionDate, time: `${sessionDate}T20:15:00Z`, source: params.source || "oi",
        call_wall: s2(k(S * 1.03)), put_wall: s2(k(S * 0.96)),
        gamma_flip: failAt(t, 11, 6) ? null : s2(flip), gamma_magnet: s2(k(S)),
        nearby_flips: nearby.map((v) => s2(v)),
      },
    };
  };

  const flowRow = (t, rnd, extra) => {
    const cpa = rnd() * 3e7, cpb = rnd() * 3e7, ppa = rnd() * 1e7, ppb = rnd() * 1e7;
    const cv = Math.round(rnd() * 5e5), pv = Math.round(rnd() * 2e5);
    return {
      ...extra, ticker: t,
      call_volume: cv, put_volume: pv,
      call_volume_ask_side: Math.round(cv * 0.45), call_volume_bid_side: Math.round(cv * 0.45),
      put_volume_ask_side: Math.round(pv * 0.45), put_volume_bid_side: Math.round(pv * 0.42),
      put_premium: s2(ppa + ppb + rnd() * 2e6), call_premium: s2(cpa + cpb + rnd() * 6e6),
      call_premium_bid_side: s2(cpb), put_premium_bid_side: s2(ppb),
      call_premium_ask_side: s2(cpa), put_premium_ask_side: s2(ppa),
      call_trades: Math.round(cv / 5), put_trades: Math.round(pv / 5),
      call_otm_premium: s2((cpa + cpb) * 0.6), call_otm_trades: Math.round(cv / 7), call_otm_volume: Math.round(cv * 0.8),
      put_otm_premium: s2((ppa + ppb) * 0.6), put_otm_trades: Math.round(pv / 7), put_otm_volume: Math.round(pv * 0.8),
    };
  };

  const flowPerExpiry = (t) => {
    const rnd = prng(hash(t + "fe"));
    const date = failAt(t, 13, 7) ? weekdaysEndingAt(sessionDate, 2)[0] : sessionDate;
    const exps = [nextWeekday(sessionDate), ...expiriesFrom(sessionDate, 12),
      "2027-01-15", "2027-06-18", "2028-01-21"];
    return exps.map((e) => flowRow(t, rnd, { date, expiry: e }));
  };

  const flowPerStrike = (t, params) => {
    if (failAt(t, 17, 3)) throw new Error(`/api/stock/${t}/flow-per-strike -> HTTP 500`);
    const S = spotFor(t), step = strikeStep(S), rnd = prng(hash(t + "fs"));
    const out = [];
    for (let k = Math.max(step, Math.round(S * 0.5 / step) * step); k <= S * 1.6; k += step) {
      out.push(flowRow(t, rnd, {
        timestamp: `${params.date || sessionDate}T19:59:55.649000Z`, date: params.date || sessionDate, strike: s2(k),
      }));
    }
    return out;
  };

  const nopeBody = (t) => {
    const rnd = prng(hash(t + "np"));
    const rows = [];
    let cd = 0, pd = 0, sv = 0, cv = 0, pv = 0;
    for (let m = 0; m < 390; m++) {
      cd += rnd() * 1e5; pd -= rnd() * 0.8e5; sv += 5e4 + rnd() * 1e5; cv += Math.round(rnd() * 3000); pv += Math.round(rnd() * 1500);
      rows.push({
        timestamp: new Date(win.open + m * 60000).toISOString().replace(".000Z", "Z"),
        call_vol: cv, put_vol: pv, stock_vol: Math.round(sv),
        call_delta: cd.toFixed(6), put_delta: pd.toFixed(6),
        call_fill_delta: (cd * 1.4).toFixed(6), put_fill_delta: (pd * 0.8).toFixed(6),
        nope_fill: ((cd * 1.4 + pd * 0.8) / Math.round(sv)).toFixed(6),
        nope: ((cd + pd) / Math.round(sv)).toFixed(6),
      });
    }
    return { data: rows.reverse() };
  };

  const spotExposures = (t) => {
    const S = spotFor(t), rnd = prng(hash(t + "se"));
    const unfilled = failAt(t, 11, 2);
    const start = win.open - 180 * 60000;
    const rows = [];
    let g = (rnd() - 0.4) * 8e7, px = S * 0.995;
    for (let i = 0; i < 560; i++) {
      const at = start + i * 60000;
      const rth = at >= win.open && at < win.close;
      g += (rnd() - 0.5) * 6e6;
      px *= 1 + (rnd() - 0.5) * 0.001;
      const flow = rth && !unfilled;
      rows.push({
        time: new Date(at + 30795).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z"),
        ticker: t, start_time: new Date(at).toISOString().replace(".000Z", ".000000Z"),
        price: px.toFixed(4), ticker_id: hash(t) % 10000,
        charm_per_one_percent_move_dir: flow ? s2((rnd() - 0.5) * 4e8) : "0",
        charm_per_one_percent_move_oi: s2(-1.7e9 + rnd() * 2e8),
        charm_per_one_percent_move_vol: flow ? s2((rnd() - 0.5) * 3e8) : "0",
        gamma_per_one_percent_move_dir: flow ? s2((rnd() - 0.5) * 2e7) : "0",
        gamma_per_one_percent_move_oi: s2(g),
        gamma_per_one_percent_move_vol: flow ? s2(rnd() * 1e7) : "0",
        vanna_per_one_percent_move_dir: flow ? s2((rnd() - 0.5) * 5e6) : "0",
        vanna_per_one_percent_move_oi: s2(1.1e7 + rnd() * 1e6),
        vanna_per_one_percent_move_vol: flow ? s2(rnd() * 4e6) : "0",
      });
    }
    return { data: rows };
  };

  const oiPerStrike = (t, params) => {
    const S = spotFor(t), step = strikeStep(S), rnd = prng(hash(t + "oi"));
    const rows = [];
    for (let k = Math.max(step, Math.round(S * 0.4 / step) * step); k <= S * 1.8; k += step) {
      const near = Math.exp(-(((k - S) / (S * 0.08)) ** 2));
      rows.push({
        date: params.date || sessionDate, strike: s2(k),
        call_oi: Math.round((k >= S ? 1 : 0.4) * near * 4e4 * (0.5 + rnd()) + rnd() * 500),
        put_oi: Math.round((k <= S ? 1 : 0.4) * near * 3e4 * (0.5 + rnd()) + rnd() * 500),
      });
    }
    return { data: rows };
  };

  const contractHistoric = (id, params) => {
    const rnd = prng(hash(id + "ch"));
    const limit = Number(params.limit) || 60;
    const days = history.slice(-limit);
    let oi = 500 + Math.round(rnd() * 2000);
    const buildFrom = days.length - 1 - (2 + (hash(id) % 6));
    const rows = days.map((d, i) => {
      if (i > buildFrom) oi += Math.round(800 + rnd() * 4000);
      else oi = Math.max(0, oi + Math.round((rnd() - 0.5) * 300));
      const vol = Math.round(200 + rnd() * 6000);
      const ask = Math.round(vol * (0.3 + rnd() * 0.5));
      const bid = Math.round((vol - ask) * 0.8);
      return {
        date: d, trades: Math.round(vol / 4), open_interest: oi, volume: vol,
        last_price: s2(2 + rnd() * 10), ask_volume: ask, avg_price: s2(2 + rnd() * 10, 6), bid_volume: bid,
        canceled_volume: 0, cross_volume: 0, floor_volume: Math.round(vol * 0.03),
        high_price: s2(12), implied_volatility: (0.22 + rnd() * 0.08).toFixed(15),
        iv_high: "0.2502255994843325", iv_low: "0.22356743440045",
        last_tape_time: `${d}T21:30:49Z`, low_price: s2(1.5), mid_volume: vol - ask - bid,
        multi_leg_volume: Math.round(vol * 0.2), nbbo_ask: "8.45", nbbo_bid: "8.15", neutral_volume: 0,
        open_price: "8.70", stock_multi_leg_volume: 0, sweep_volume: Math.round(vol * 0.05),
        total_ask_changes: 2151, total_bid_changes: 2250, total_premium: s2(vol * 800),
        ticker_vol: 1281743, flex_oi_transfer: null,
      };
    });
    return { chains: rows.reverse(), etf_holdings: [] };
  };

  const darkpoolLevelsBody = (t, params) => {
    const S = spotFor(t), rnd = prng(hash(t + "dp"));
    if (failAt(t, 23, 4)) return { data: [], date: params.date || sessionDate };
    const rows = [{ price: s2(S * 0.74), dark_pool_volume: "419", regular_volume: "0" }];
    for (let i = 0; i < 22; i++) {
      const px = S * (0.985 + i * 0.0014);
      rows.push({ price: s2(px), dark_pool_volume: String(Math.round(rnd() * 2e6)), regular_volume: String(Math.round(rnd() * 3e6)) });
    }
    return { data: rows, date: params.date || sessionDate };
  };

  const alertsFor = (t) => {
    const rnd = prng(hash(t + "fa"));
    const n = 20 + (hash(t) % 70);
    const S = spotFor(t), step = strikeStep(S);
    const out = [];
    for (let i = 0; i < n; i++) {
      const at = win.open - 20 * 60000 + Math.floor(rnd() * (win.close - win.open + 20 * 60000));
      const call = rnd() > 0.4;
      const prem = Math.round(2e4 + rnd() * 3e6);
      const askPrem = Math.round(prem * rnd());
      const oi = Math.round(rnd() * 20000), vol = Math.round(rnd() * 30000);
      out.push({
        iv_end: "0.255691726648767", option_chain: occ(t, expiriesFrom(sessionDate, 3)[i % 3], call ? "C" : "P", Math.round(S / step) * step),
        gamma: null, underlying_price: s2(S), has_multileg: false, delta: null, end_time: at + 145,
        total_ask_side_prem: String(askPrem), issue_type: "Common Stock", rule_id: "a0979b52-28e4-4585-8f22-881faad2dd8e",
        volume_oi_ratio: oi ? String(vol / oi) : "0", start_time: at, iv_start: "0.252141337207799",
        total_premium: String(prem), trade_count: 9, all_opening_trades: rnd() > 0.6,
        total_bid_side_prem: String(prem - askPrem), price: "1.68", has_floor: false, rho: null, total_size: 151,
        sector: "Technology", next_earnings_date: "2026-10-29", er_time: "unknown",
        expiry: expiriesFrom(sessionDate, 3)[i % 3], bid: "1.68", expiry_count: 1, theta: null,
        created_at: new Date(at + 400).toISOString(), ask: "1.70", has_singleleg: true,
        id: `${t}-alert-${i}`, marketcap: "5000000000000.00", strike: s2(Math.round(S / step) * step),
        vega: null, has_sweep: rnd() > 0.5, iv: null, ticker: t, open_interest: oi, type: call ? "call" : "put",
        theo: null, volume: vol, alert_rule: "RepeatedHits",
      });
    }
    return out;
  };

  const flowAlerts = (params) => {
    const names = String(params.ticker_symbol || "").split(",").filter(Boolean);
    const lo = toMs(params.newer_than) ?? -Infinity, hi = toMs(params.older_than) ?? Infinity;
    const limit = Math.min(200, Number(params.limit) || 100);
    const rows = names.flatMap(alertsFor).filter((r) => r.start_time >= lo && r.start_time <= hi)
      .sort((a, b) => b.start_time - a.start_time).slice(0, limit);
    return {
      data: rows,
      newer_than: rows.length ? new Date(rows[0].start_time).toISOString() : String(params.newer_than || ""),
      older_than: rows.length ? new Date(rows[rows.length - 1].start_time).toISOString() : String(params.older_than || ""),
    };
  };

  const STRATEGIES = ["call_vertical_spread", "put_vertical_spread", "iron_condor", "call_calendar", "straddle",
    "strangle", "risk_reversal", "call_diagonal_spread"];

  const multiLegBody = (params) => {
    const t = String(params.ticker_symbol || "");
    const rnd = prng(hash(t + "ml"));
    const S = spotFor(t), step = strikeStep(S);
    const n = hash(t) % 5 === 0 ? 1200 : 30 + (hash(t) % 200);
    const lo = toMs(params.newer_than) ?? -Infinity, hi = toMs(params.older_than) ?? Infinity;
    const all = [];
    for (let i = 0; i < n; i++) {
      const at = win.open + Math.floor(rnd() * (win.close - win.open));
      const credit = rnd() > 0.55;
      const np = Math.round((credit ? -1 : 1) * (1000 + rnd() * 2e5));
      const k1 = Math.round(S * (0.9 + rnd() * 0.2) / step) * step;
      all.push({
        min_dte: 3 + (i % 50), underlying_price: s2(S), code: "mlet", net_theta: s2((rnd() - 0.5) * 10, 4),
        net_gamma: s2((rnd() - 0.5), 4), direction: ["long", "short", "unknown"][i % 3], max_dte: 3 + (i % 50) + (i % 4) * 30,
        diff_expirations: i % 4 !== 0, size: 1 + (i % 20), executed_at: new Date(at).toISOString().replace(".000Z", "Z"),
        strategy: STRATEGIES[i % STRATEGIES.length], max_strike: s2(k1 + step), max_profit: null, ratios: 11,
        all_otm: rnd() > 0.5, net_price: s2(np / 100), net_side: credit ? "bid" : "ask", iv_term_spread: null,
        breakevens: [], txns: 2, max_loss: null, bid_ask_spread: "1.00", net_premium: s2(np), strikes: [s2(k1), s2(k1 + step)],
        ivs: ["0.2780", "0.2523"], total_premium: s2(Math.abs(np) * (1.5 + rnd())), uniq_exchanges: ["XISX"],
        leg_count: 2 + (i % 3), net_delta: s2((rnd() - 0.5) * 100, 4), id: `${t}-ml-${i}`, diff_strikes: true,
        min_strike: s2(k1), net_vega: s2((rnd() - 0.5) * 200, 4), net_bid: "1.00", all_opening_legs: rnd() > 0.5,
        avg_iv: "0.2651", ticker: t, diff_types: false, net_ask: "1.10",
      });
    }
    const rows = all.filter((r) => { const x = toMs(r.executed_at); return x >= lo && x <= hi; })
      .sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1));
    const offset = Number(params.offset) || 0, limit = Math.min(500, Number(params.limit) || 50);
    return { data: rows.slice(offset, offset + limit) };
  };

  return async (path, params = {}) => {
    let m;
    if ((m = /^\/api\/stock\/([^/]+)\/greek-exposure$/.exec(path))) return greekExposure(m[1]);
    if ((m = /^\/api\/stock\/([^/]+)\/options-volume$/.exec(path))) return optionsVolume(m[1]);
    if ((m = /^\/api\/stock\/([^/]+)\/gex-levels$/.exec(path))) return gexLevelsBody(m[1], params);
    if ((m = /^\/api\/stock\/([^/]+)\/flow-per-expiry$/.exec(path))) return flowPerExpiry(m[1]);
    if ((m = /^\/api\/stock\/([^/]+)\/flow-per-strike$/.exec(path))) return flowPerStrike(m[1], params);
    if ((m = /^\/api\/stock\/([^/]+)\/nope$/.exec(path))) return nopeBody(m[1]);
    if ((m = /^\/api\/stock\/([^/]+)\/spot-exposures$/.exec(path))) return spotExposures(m[1]);
    if ((m = /^\/api\/stock\/([^/]+)\/oi-per-strike$/.exec(path))) return oiPerStrike(m[1], params);
    if ((m = /^\/api\/option-contract\/([^/]+)\/historic$/.exec(path))) return contractHistoric(m[1], params);
    if ((m = /^\/api\/darkpool\/([^/]+)\/price-levels$/.exec(path))) return darkpoolLevelsBody(m[1], params);
    if (path === "/api/option-trades/flow-alerts") return flowAlerts(params);
    if (path === "/api/option-trades/multi-leg") return multiLegBody(params);
    throw new Error(`${path} -> HTTP 404`);
  };
}

export function makeFlowFakeStore({ sessionDate }) {
  const prior = weekdaysEndingAt(sessionDate, 60).slice(0, -1);
  return async (key) => {
    const t = String(key).replace(/^hist:/, "");
    const h = hash(t + "hist");
    if (h % 3 === 0) return { payload: null, absent: true, status: 0 };
    const n = 12 + (h % 40);
    const d = prior.slice(-n);
    const rnd = prng(h);
    const base = Date.parse(d[0] + "T00:00:00Z");
    return {
      payload: {
        v: 1, ticker: t, sessionDate: d[d.length - 1], d0: d[0],
        dd: d.map((x) => Math.round((Date.parse(x + "T00:00:00Z") - base) / 86400000)),
        nope: { asOf: d[d.length - 1], ...packSeries(d.map(() => (rnd() - 0.45) * 0.6)) },
      },
      status: 200,
    };
  };
}
