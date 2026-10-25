import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHAPES_PATH = os.path.join(ROOT, "scripts", "flows-probe-shapes.json")
with open(SHAPES_PATH, "rb") as handle:
    SHAPES_BYTES = handle.read()
SHAPES = json.loads(SHAPES_BYTES)["ops"]

DAY = "2026-09-22"
NEXT = "2026-09-23"
A = "SYA101"
B = "SYB202"
HOST = "https://api.unusualwhales.com"
NATURE = ("synthetic bodies built to the schema, not vendor data: every value is invented, every key and JSON type is checked "
          "against the observed wire shape in scripts/flows-probe-shapes.json, and the generator fails where the two disagree")

PROBLEMS = []


def accepts(alts, value):
    for alt in alts.split("|"):
        if alt == "null" and value is None:
            return True
        if alt == "bool" and isinstance(value, bool):
            return True
        if alt == "num" and isinstance(value, (int, float)) and not isinstance(value, bool):
            return True
        if alt == "str" and isinstance(value, str):
            return True
        if alt == "str#" and isinstance(value, str):
            try:
                float(value)
                return True
            except ValueError:
                return False
        if alt == "arr" and isinstance(value, list):
            return True
        if alt == "obj" and isinstance(value, dict):
            return True
    return False


def conform(label, op, setname, row, full=False):
    entry = SHAPES.get(op)
    if entry is None or setname not in entry["sets"]:
        PROBLEMS.append("%s: no recorded shape for %s %s" % (label, op, setname))
        return
    shape = entry["sets"][setname]
    for key, value in row.items():
        if key not in shape:
            PROBLEMS.append("%s: key %s is not in the wire shape of %s" % (label, key, op))
        elif not accepts(shape[key], value):
            PROBLEMS.append("%s: key %s is %r, the wire shape says %s" % (label, key, value, shape[key]))
    if full:
        for key in shape:
            if key not in row:
                PROBLEMS.append("%s: key %s of %s is missing from a full row" % (label, key, op))


def spec_fields(op, setname):
    shape = SHAPES[op]["sets"][setname]
    out = []
    for key in sorted(shape):
        alts = shape[key]
        if "str#" in alts.split("|"):
            kind = "str#"
        elif alts == "null|str":
            kind = "str"
        else:
            kind = alts
        out.append("%s:%s" % (key, kind))
    return out


def money(x, places=2):
    return "%.*f" % (places, x)


def probe(pid, url, envelope, count, fields, row, **extra):
    out = {
        "id": pid,
        "url": HOST + url,
        "status": 200,
        "envelope": envelope,
        "rowCount": count,
        "envelopeFields": extra.pop("envelopeFields"),
        "fields": fields,
    }
    out.update(extra)
    out["row"] = row
    return out


def sector_etf_row(full):
    row = {
        "high": "543.14",
        "low": "540.57",
        "open": "541.03",
        "last": "541.38",
        "ticker": "SPY",
        "full_name": "S&P 500 Index",
        "volume": 28104337,
        "call_volume": 4313480,
        "put_volume": 3941873,
        "marketcap": "612326731841",
        "put_premium": "512152969.0000",
        "call_premium": "804114494.0000",
        "prev_date": "2026-09-21",
        "in_out_flow": [
            {"date": "2026-09-15", "change": 2100000},
            {"date": "2026-09-16", "change": -8450000},
            {"date": "2026-09-17", "change": 4300000},
            {"date": "2026-09-18", "change": -950000},
            {"date": "2026-09-21", "change": 6200000},
            {"date": "2026-09-22", "change": 2900000},
        ],
        "avg30_call_volume": "4112807.2667",
        "avg_30_day_call_volume": "4112807.2667",
        "avg30_put_volume": "4696733.2333",
        "avg_30_day_put_volume": "4696733.2333",
    }
    if full:
        row.update({
            "week52_high": "552.98",
            "week52_low": "438.12",
            "avg30_stock_volume": "52231211.4000",
            "avg_7_day_call_volume": "4211203.2857",
            "avg_7_day_put_volume": "4601992.0000",
            "bearish_premium": "514311440.0000",
            "bullish_premium": "806956023.0000",
            "prev_close": "539.02",
        })
    return row


def flow_alert_row(**over):
    row = {
        "iv_end": "0.2012734190",
        "option_chain": "SYB202260923P00500000",
        "gamma": 0.0121,
        "underlying_price": "512.40",
        "has_multileg": False,
        "delta": -0.3142,
        "end_time": 1790110520110,
        "total_ask_side_prem": "0",
        "issue_type": "Common Stock",
        "rule_id": "00000000-0000-4000-8000-00000000a1e1",
        "volume_oi_ratio": "5.7014218009",
        "start_time": 1790110520090,
        "iv_start": "0.2012734190",
        "total_premium": "64200",
        "trade_count": 4,
        "all_opening_trades": False,
        "total_bid_side_prem": "64200",
        "price": "12.84",
        "missing_periscope": True,
        "has_floor": False,
        "rho": -0.0412,
        "total_size": 50,
        "sector": "Technology",
        "next_earnings_date": "2026-11-18",
        "er_time": "postmarket",
        "expiry": NEXT,
        "bid": "12.80",
        "expiry_count": 1,
        "theta": -0.1931,
        "created_at": "2026-09-22T20:55:20.110139Z",
        "ask": "12.90",
        "has_singleleg": True,
        "id": "00000000-0000-4000-8000-00000000a1e2",
        "marketcap": "2410000000000",
        "strike": "500",
        "vega": 0.3714,
        "has_sweep": False,
        "iv": 0.2031,
        "ticker": B,
        "open_interest": 211,
        "type": "put",
        "theo": 12.83,
        "volume": 1203,
        "alert_rule": "RepeatedHits",
    }
    row.update(over)
    return row


def build_live():
    out = {"source": "Synthetic bodies built to the schema, not vendor data (generated by tests/gen-probe-fixtures.py); the session is " + DAY + "."}
    tide_row = {
        "timestamp": "2026-09-22T09:30:00-04:00",
        "date": DAY,
        "net_call_premium": "8250000.0000",
        "net_put_premium": "-3150000.0000",
        "net_volume": 84200,
    }
    conform("marketTide", "/api/market/market-tide", "data[]", tide_row, True)
    out["marketTide"] = probe("market-tide", "/api/market/market-tide?date=2026-09-22&interval_5m=true", "{data:[81],date:str}", 81,
                              spec_fields("/api/market/market-tide", "data[]"), tide_row,
                              envelopeFields=["data:arr(81)", "date:str"], date=DAY)
    block_rows = [
        ("13:30", "431.26", "70210.80", "-198400.00", "391"),
        ("13:31", "431.94", "-18110.50", "-531230.40", "802"),
        ("13:32", "431.76", "41250.20", "-702980.20", "1190"),
        ("13:33", "431.375", "-41250.30", "-860400.70", "1320"),
    ]
    block = {
        "moneyness": "all",
        "tide_type": "all",
        "data": [{"timestamp": "2026-09-22T%s:00Z" % t, "date": DAY, "underlying_price": px, "net_call_premium": c,
                  "net_put_premium": p, "net_volume": v} for t, px, c, p, v in block_rows],
    }
    out["netFlowExpiry"] = {
        "id": "net-flow-expiry",
        "url": HOST + "/api/net-flow/expiry?date=2026-09-22&moneyness=all&moneyness=otm&tide_type=all&tide_type=equity_only&tide_type=index_only&expiration=zero_dte&expiration=weekly",
        "status": 200,
        "envelope": "{data:[1],date:str,expiration:[1],moneyness:[1],tide_type:[1]}",
        "rowCount": 1,
        "envelopeFields": ["data:arr(1)", "date:str", "expiration:arr(1)", "moneyness:arr(1)", "tide_type:arr(1)"],
        "fields": ["data:arr", "moneyness:str", "tide_type:str"],
        "date": DAY,
        "block": block,
    }
    etf_row = {
        "timestamp": "2026-09-22T13:30:00Z",
        "date": DAY,
        "net_call_premium": "418250.0000",
        "net_put_premium": "612730.0000",
        "underlying_price": "541.26",
        "net_volume": "8214",
    }
    conform("etfTideSpy", "/api/market/{ticker}/etf-tide", "data[]", etf_row, True)
    out["etfTideSpy"] = probe("etf-tide-spy", "/api/market/SPY/etf-tide?date=2026-09-22", "{data:[390],date:str}", 390,
                              spec_fields("/api/market/{ticker}/etf-tide", "data[]"), etf_row,
                              envelopeFields=["data:arr(390)", "date:str"], date=DAY)
    sector_row = {
        "timestamp": "2026-09-22T13:30:00Z",
        "date": DAY,
        "net_call_premium": "1936400.0000",
        "net_put_premium": "702150.0000",
        "net_volume": 9310,
    }
    conform("sectorTide", "/api/market/{sector}/sector-tide", "data[]", sector_row, True)
    out["sectorTideTechnology"] = probe("sector-tide-technology", "/api/market/Technology/sector-tide?date=2026-09-22",
                                        "{data:[391],date:str}", 391, spec_fields("/api/market/{sector}/sector-tide", "data[]"),
                                        sector_row, envelopeFields=["data:arr(391)", "date:str"], date=DAY)
    full = sector_etf_row(True)
    clipped = sector_etf_row(False)
    conform("sectorEtfs", "/api/market/sector-etfs", "data[]", full, True)
    out["sectorEtfs"] = probe("sector-etfs", "/api/market/sector-etfs", "{data:[12]}", 12,
                              spec_fields("/api/market/sector-etfs", "data[]"), clipped, envelopeFields=["data:arr(12)"],
                              full=full)
    alert = flow_alert_row()
    conform("flowAlerts", "/api/option-trades/flow-alerts", "data[]", alert, True)
    out["flowAlerts"] = probe("flow-alerts", "/api/option-trades/flow-alerts?limit=200&newer_than=2026-09-22",
                              "{data:[200],newer_than:str,older_than:str}", 200,
                              spec_fields("/api/option-trades/flow-alerts", "data[]"), alert,
                              envelopeFields=["data:arr(200)", "newer_than:str", "older_than:str"])
    spot = {
        "time": "2026-09-22T10:30:30.795000Z",
        "ticker": A,
        "start_time": "2026-09-22T10:30:00.000000Z",
        "price": "412.3869",
        "ticker_id": 9001,
        "charm_per_one_percent_move_dir": "0",
        "charm_per_one_percent_move_oi": "-1322257830.68",
        "charm_per_one_percent_move_vol": "0",
        "gamma_per_one_percent_move_dir": "0",
        "gamma_per_one_percent_move_oi": "61615247.93",
        "gamma_per_one_percent_move_vol": "0",
        "vanna_per_one_percent_move_dir": "0",
        "vanna_per_one_percent_move_oi": "9619719.33",
        "vanna_per_one_percent_move_vol": "0",
    }
    conform("spotExposures1m", "/api/stock/{ticker}/spot-exposures", "data[]", spot, True)
    out["spotExposures1m"] = probe("spot-exposures-1m:" + A, "/api/stock/%s/spot-exposures?date=2026-09-22" % A, "{data:[551]}", 551,
                                   spec_fields("/api/stock/{ticker}/spot-exposures", "data[]"), spot, envelopeFields=["data:arr(551)"])
    ticks = {
        "date": DAY,
        "call_volume": 17009,
        "put_volume": 2639,
        "call_volume_ask_side": 11820,
        "call_volume_bid_side": 5410,
        "put_volume_ask_side": 989,
        "put_volume_bid_side": 1487,
        "net_call_premium": "982350.00",
        "net_call_volume": 6410,
        "net_put_premium": "-154200.00",
        "net_put_volume": -498,
        "tape_time": "2026-09-22T13:30:00.000000Z",
        "net_delta": "98432.700123456789",
    }
    conform("netPremTicks", "/api/stock/{ticker}/net-prem-ticks", "data[]", ticks, True)
    out["netPremTicks"] = probe("net-prem-ticks:" + A, "/api/stock/%s/net-prem-ticks?date=2026-09-22" % A, "{data:[390]}", 390,
                                spec_fields("/api/stock/{ticker}/net-prem-ticks", "data[]"), ticks, envelopeFields=["data:arr(390)"])
    news = {
        "meta": {},
        "source": "Example Wire",
        "created_at": "2026-09-23T10:08:26Z",
        "tags": [],
        "tickers": [],
        "headline": "Example Beverage Co. introduces a new seasonal flavour for the autumn menu",
        "is_major": False,
        "sentiment": "neutral",
    }
    conform("news", "/api/news/headlines", "data[]", news, True)
    out["news"] = probe("news", "/api/news/headlines?limit=100", "{data:[100]}", 100, spec_fields("/api/news/headlines", "data[]"),
                        news, envelopeFields=["data:arr(100)"])
    state = {
        "close": "412.18",
        "high": "412.79",
        "low": "411.87",
        "open": "412.49",
        "volume": 41383,
        "total_volume": 41383,
        "market_time": "premarket",
        "tape_time": "2026-09-23T10:09:13Z",
        "prev_close": "411.75",
    }
    conform("stockState", "/api/stock/{ticker}/stock-state", "data", state, True)
    out["stockState"] = probe("stock-state:" + A, "/api/stock/%s/stock-state" % A, "{data:{9}}", 1,
                              spec_fields("/api/stock/{ticker}/stock-state", "data"), state, envelopeFields=["data:obj(9 keys)"])
    top = {"ticker": "SYC303", "net_premium": 98123456.5}
    conform("topNetImpact", "/api/market/top-net-impact", "data[]", top, True)
    out["topNetImpact"] = probe("top-net-impact", "/api/market/top-net-impact?date=2026-09-22&limit=100", "{data:[100]}", 100,
                                spec_fields("/api/market/top-net-impact", "data[]"), top, envelopeFields=["data:arr(100)"])
    total = {
        "date": DAY,
        "call_volume": 36255508,
        "put_volume": 24895745,
        "put_premium": "13142883165.20",
        "call_premium": "31694997463.09",
    }
    conform("totalOptionsVolume", "/api/market/total-options-volume", "data[]", total, True)
    out["totalOptionsVolume"] = probe("total-options-volume", "/api/market/total-options-volume?limit=252", "{data:[252]}", 252,
                                      spec_fields("/api/market/total-options-volume", "data[]"), total, envelopeFields=["data:arr(252)"])
    dark = darkpool_row("SYD404", 400, "187.4155", 15926587, "2026-09-22T23:59:58Z", "98366.2000", "187.86", "187.14", 10, 100,
                        30786400000001)
    conform("darkpoolRecent", "/api/darkpool/recent", "data[]", dark, True)
    out["darkpoolRecent"] = probe("darkpool-recent", "/api/darkpool/recent?date=2026-09-22&limit=200", "{data:[200]}", 200,
                                  spec_fields("/api/darkpool/recent", "data[]"), dark, envelopeFields=["data:arr(200)"])
    screener_fields = spec_fields("/api/screener/stocks", "data[]")
    screener = {
        "three_month_perc": "0.0817524802300503",
        "avg30_volume": "98220632.8",
        "macd_12_26_9": 1.7212594154908,
        "shares_outstanding_growth_12q": "-0.0192914979757085",
        "gex_daily_net_vanna": "92375858.3146",
        "volatility_1": "0.285",
        "iv30d": "0.288",
        "volatility_14": "0.271",
        "put_premium": "142658931.00",
        "five_year_close": "18.41",
        "bid": None,
        "one_month_close": "187.72",
        "one_week_close": "185.17",
        "gex_daily_put_vanna": "-41012540.1315",
        "implied_move_perc": "0.052",
        "atr_14": 5.8479152119,
        "iv30d_1m": "0.371",
        "one_week_perc": "0.0618518640712636",
        "macd_12_26_9_histogram": 0.3283230959766,
        "implied_move_1": "2.381",
        "latest_dividend_payment_date": "2026-10-01",
    }
    conform("screenerLive", "/api/screener/stocks", "data[]", screener)
    out["screenerLive"] = probe("screener-tickers-live", "/api/screener/stocks?ticker=%s,%s&limit=500" % (A, B), "{data:[2]}", 2,
                                screener_fields, screener, envelopeFields=["data:arr(2)"])
    out["provenance"] = provenance("live-probe")
    return out


def darkpool_row(ticker, size, price, volume, executed, premium, ask, bid, askq, bidq, tracking):
    return {
        "size": size,
        "ticker": ticker,
        "price": price,
        "volume": volume,
        "executed_at": executed,
        "canceled": False,
        "premium": premium,
        "sale_cond_codes": None,
        "nbbo_ask": ask,
        "nbbo_bid": bid,
        "ext_hour_sold_codes": "extended_hours_trade",
        "market_center": "L",
        "nbbo_ask_quantity": askq,
        "nbbo_bid_quantity": bidq,
        "tracking_id": tracking,
        "trade_code": None,
        "trade_settlement": "regular",
        "trf_executed_at": executed,
    }


def provenance(name):
    return {
        "generator": "tests/gen-probe-fixtures.py",
        "fixture": name,
        "nature": NATURE,
        "shapes": "scripts/flows-probe-shapes.json",
        "shapesSha256": hashlib.sha256(SHAPES_BYTES).hexdigest(),
    }


def build_vol():
    p = {}

    def add(key, url, envelope, count, rows_at, row, op, setname):
        conform(key, op, setname, row)
        p[key] = {"url": url, "envelope": envelope, "rowsAt": rows_at, "rowCount": count, "row": row}

    iv_op = "/api/stock/{ticker}/interpolated-iv/distribution"
    add("iv-dist:" + A, "/api/stock/%s/interpolated-iv/distribution?date=2026-09-22" % A, "{data:[6]}", 6, "data[]", {
        "max": "0.482", "min": "0.131", "date": DAY, "ticker": A, "days": 7, "median": "0.236000", "percentile": "0.3105",
        "volatility": "0.214", "samples": 251, "first_date": "2025-09-23", "q1": "0.218500", "q3": "0.268500"}, iv_op, "data[]")
    add("iv-dist:" + B, "/api/stock/%s/interpolated-iv/distribution?date=2026-09-22" % B, "{data:[6]}", 6, "data[]", {
        "max": "0.791", "min": "0.236", "date": DAY, "ticker": B, "days": 7, "median": "0.352000", "percentile": "0.0612",
        "volatility": "0.263", "samples": 251, "first_date": "2025-09-23", "q1": "0.311500", "q3": "0.404500"}, iv_op, "data[]")
    ts_op = "/api/stock/{ticker}/volatility/term-structure/distribution"
    add("term-structure-dist:" + A, "/api/stock/%s/volatility/term-structure/distribution?date=2026-09-22" % A, "{data:[19]}", 19,
        "data[]", {
            "max": "0.2612384995799855", "min": "0.1934116316708722", "date": DAY, "ticker": A, "median": "0.231166",
            "percentile": "0.6818", "volatility": "0.2381408225954508", "expiry": NEXT, "samples": 11, "first_date": "2026-09-08",
            "dte": 1, "q1": "0.226122", "q3": "0.243307"}, ts_op, "data[]")
    add("term-structure-dist:" + B, "/api/stock/%s/volatility/term-structure/distribution?date=2026-09-22" % B, "{data:[18]}", 18,
        "data[]", {
            "max": "0.3156347508713565", "min": "0.2522521164837225", "date": DAY, "ticker": B, "median": "0.308428",
            "percentile": "0.4141", "volatility": "0.2928932023611", "expiry": NEXT, "samples": 11, "first_date": "2026-09-08",
            "dte": 1, "q1": "0.283062", "q3": "0.311274"}, ts_op, "data[]")
    vrp_op = "/api/stock/{ticker}/volatility/variance-risk-premium"
    add("vrp:" + A, "/api/stock/%s/volatility/variance-risk-premium?days=21&date=2026-09-22" % A, "{data:[231]}", 231, "data[]", {
        "date": "2025-09-23", "ticker": A, "rank": "0.5120481927710843", "implied_volatility": "0.241000",
        "realized_volatility": "0.236112", "realized_volatility_days": 21, "implied_volatility_days": 30,
        "realized_date": "2025-10-21", "risk_premium": "0.004888"}, vrp_op, "data[]")
    add("vrp:" + B, "/api/stock/%s/volatility/variance-risk-premium?days=21&date=2026-09-22" % B, "{data:[231]}", 231, "data[]", {
        "date": "2025-09-23", "ticker": B, "rank": "0.3614457831325301", "implied_volatility": "0.352000",
        "realized_volatility": "0.311358", "realized_volatility_days": 21, "implied_volatility_days": 30,
        "realized_date": "2025-10-21", "risk_premium": "0.040642"}, vrp_op, "data[]")
    rr_op = "/api/stock/{ticker}/historical-risk-reversal-skew"
    rr25 = {"date": "2026-02-19", "ticker": A, "delta": 25, "risk_reversal": "0.00812349187365"}
    add("rr-skew-25:" + A, "/api/stock/%s/historical-risk-reversal-skew?expiry=2026-10-16&delta=25&timeframe=1Y&date=2026-09-22" % A,
        "{data:[149]}", 149, "data[]", rr25, rr_op, "data[]")
    add("rr-skew-025:" + A, "/api/stock/%s/historical-risk-reversal-skew?expiry=2026-10-16&delta=0.25&timeframe=1Y&date=2026-09-22" % A,
        "{data:[149]}", 149, "data[]", dict(rr25), rr_op, "data[]")
    add("rr-skew-10:" + A, "/api/stock/%s/historical-risk-reversal-skew?expiry=2026-10-16&delta=10&timeframe=1Y&date=2026-09-22" % A,
        "{data:[149]}", 149, "data[]", {"date": "2026-02-19", "ticker": A, "delta": 10, "risk_reversal": "0.069410379539127"},
        rr_op, "data[]")
    add("iv-rank:" + A, "/api/stock/%s/iv-rank?timespan=1y&date=2026-09-22" % A, "{data:[251]}", 251, "data[]", {
        "close": "401.43", "date": "2025-09-23", "updated_at": "2025-09-23T22:35:04.325313Z", "volatility": "0.2410",
        "iv_rank_1y": "21.7438"}, "/api/stock/{ticker}/iv-rank", "data[]")
    add("ohlc-1d:" + A, "/api/stock/%s/ohlc/1d?timeframe=2Y&end_date=2026-09-22" % A, "{data:[1504]}", 1504, "data[]", {
        "close": "412.18", "high": "412.79", "low": "411.87", "open": "412.49", "date": NEXT, "volume": 41383, "total_volume": 41383,
        "market_time": "pr"}, "/api/stock/{ticker}/ohlc/{candle_size}", "data[]")
    add("vol-anomaly:" + A, "/api/stock/%s/volatility/anomaly?date=2026-09-22" % A, "{data:{history:[68],latest:{7}}}", 68,
        "data.history[]", {"date": "2026-06-09", "direction": "short_vol", "score": "31.402918512907"},
        "/api/stock/{ticker}/volatility/anomaly", "data.history[]")
    add("vol-sentiment:" + A, "/api/stock/%s/volatility/option-sentiment?date=2026-09-22" % A, "{data:{history:[174],latest:{9}}}",
        174, "data.history[]", {"date": "2026-01-13", "direction": "neutral", "score": "14.82", "vwks": "0.018421", "avar": "0.00231"},
        "/api/stock/{ticker}/volatility/option-sentiment", "data.history[]")
    add("vol-character:" + A, "/api/stock/%s/volatility/character?date=2026-09-22" % A, "{data:{history:[67],latest:{11}}}", 67,
        "data.history[]", {"date": "2026-06-09", "character": "moderate", "half_life_days": "31.24518803472",
                           "hurst_rv": "0.5834120571381"}, "/api/stock/{ticker}/volatility/character", "data.history[]")
    add("vol-anomaly-top", "/api/volatility/anomaly/top?direction=short_vol&date=2026-09-22&limit=50", "{data:[4],date:str,direction:str}",
        4, "data[]", {
            "date": DAY, "ticker": "SYX505",
            "components": {
                "iv_percentile": {"raw": 78.4, "value": 0.568},
                "regime_score": {"crash_probability": 0.4, "raw": -0.18852342671238, "value": -0.18852342671238},
                "skew_percentile": {"percentile": 0.91, "raw": 0.3501961723345, "value": 0.8199999999999},
                "vov_percentile": {"raw": 58.17699115044, "value": 0.11176991150442},
                "vrp_z": {"mean": 0.016322678041190, "raw": 1.177676, "std": 0.435353048977888, "value": 0.8228970768937}},
            "direction": "short_vol", "updated_at": "2026-09-22T23:15:10.809504Z", "score": "48.26299244513",
            "sample_size": 5}, "/api/volatility/anomaly/top", "data[]")
    add("vol-sentiment-top", "/api/volatility/option-sentiment/top?direction=bullish&date=2026-09-22&limit=50", "{data:[50],date:str}",
        50, "data[]", {
            "date": DAY, "ticker": "SYY606",
            "components": {"avar": {"norm": 1, "value": 0.38755}, "vwks": {"norm": 1, "value": 0.172703}},
            "direction": "bullish", "updated_at": "2026-09-22T23:20:01.005530Z", "score": "100.0", "vwks": "0.172703",
            "avar": "0.38755", "sample_size": 12}, "/api/volatility/option-sentiment/top", "data[]")
    return {
        "source": "Synthetic bodies built to the schema, not vendor data (generated by tests/gen-probe-fixtures.py); the session is " + DAY + ".",
        "session": DAY,
        "provenance": provenance("vol-probe"),
        "probes": p,
    }


def deterministic(name):
    return int(hashlib.sha256(name.encode()).hexdigest()[:8], 16) / 4294967296.0


def spec_screener_row():
    shape = SHAPES["/api/screener/stocks"]["sets"]["data[]"]
    row = {}
    for name in sorted(shape):
        kind = shape[name]
        x = deterministic(name)
        if "str#" in kind.split("|"):
            if any(w in name for w in ("perc", "growth", "z_score", "yield", "stddevs", "range_position")):
                row[name] = money((x - 0.4) * 0.5, 6)
            elif any(w in name for w in ("volatility", "iv", "implied_move", "rank", "ratio", "steepness", "variance")):
                row[name] = money(0.1 + x * 0.6, 4)
            elif any(w in name for w in ("close", "high", "low", "open", "week_52", "price", "dividend")):
                row[name] = money(40 + x * 300, 2)
            else:
                row[name] = money((x - 0.3) * 3e8, 2)
        elif kind == "num":
            if any(w in name for w in ("volume", "interest", "oi", "obv", "cum_dir")):
                row[name] = int(x * 2e7)
            else:
                row[name] = round((x - 0.3) * 120, 6)
        elif kind == "bool":
            row[name] = name == "has_options"
        elif kind == "null":
            row[name] = None
        else:
            row[name] = None
    row.update({
        "ticker": B,
        "date": "2026-09-15",
        "full_name": None,
        "sector": "Technology",
        "issue_type": "Common Stock",
        "industry_type": "Semiconductors",
        "er_time": "postmarket",
        "next_earnings_date": "2026-11-18",
        "last_earnings_date": "2026-08-19",
        "latest_dividend_date": "2026-06-11",
        "latest_dividend_payment_date": "2026-07-02",
        "next_dividend_date": "2026-09-10",
        "quote_time": None,
        "close": "184.60",
        "prev_close": "183.10",
        "marketcap": "3012000000000",
        "avg30_volume": "96400000.5",
        "shares_outstanding": "16300000000",
        "volatility_7": "0.322",
        "volatility_30": "0.298",
        "volatility_90": "0.309",
        "iv30d": "0.298",
        "iv30d_1d": "0.291",
        "iv30d_1w": "0.305",
        "iv30d_1m": "0.318",
        "realized_volatility": "0.389",
        "variance_risk_premium": "-0.091",
        "rv_1d_last_12q": "0.034",
        "iv_percentile_1y": "0.071",
        "gex_ratio": "1.84",
        "relative_volume": "0.8412",
        "gex_gamma_per_one_percent_move_oi": "412350000.40",
        "gex_delta_per_one_percent_move_oi": "61884500000.50",
        "gex_vanna_per_one_percent_move_oi": "118215271.33",
        "gex_charm_per_one_percent_move_oi": "-95120000000.25",
        "implied_move_perc_5": "0.024",
        "implied_move_perc_30": "0.058",
        "net_call_premium": "45200000.00",
        "net_put_premium": "-12100000.00",
        "call_premium": "310400000.00",
        "put_premium": "168200000.00",
        "cum_dir_delta": -412000,
        "cum_dir_gamma": -163000,
        "cum_dir_vega": -521000,
        "insider_buy_volume_3m": 0,
        "insider_sell_volume_3m": 1840000,
        "short_int": "0",
    })
    conform("specScreenerRow", "/api/screener/stocks", "data[]", row, True)
    return row


def build_legs():
    p = {}

    def add(pid, url, envelope, count, sample, op=None, setname="data[]", status=200, unobserved=(), **extra):
        if op and sample is not None:
            conform(pid, op, setname, {k: v for k, v in sample.items() if k not in unobserved})
        entry = {"id": pid, "status": status, "url": HOST + url, "envelope": envelope, "rowCount": count, "sample": sample}
        entry.update(extra)
        p[pid] = entry

    add("screener-tickers", "/api/screener/stocks?ticker=%s,%s&limit=500&date=2026-09-22" % (A, B), "{data:[2]}", 2, {
        "sma_20": 190.5324999999, "insider_buy_volume_12m": 0, "eps_growth_8q": "1.84615384615384615385", "iv_percentile_1y": "0.62",
        "volatility_30": "0.287", "volatility_365": "0.371", "put_call_ratio": "0.5144831851380441",
        "one_week_close": "185.17", "gex_vanna_per_one_percent_move_oi": "112214143", "volatility_5": "0.264",
        "prev_close": "183.10", "volatility": "0.287", "obv": 290451932, "avg_30_day_put_oi": "5905351.3333", "cci_14": 61.5051701109,
        "prev_call_oi": 6399357, "avg_30_day_call_oi": "7128438.7", "gex_net_change": "605992.3177", "sma_50": 185.1084,
        "relative_volume": "0.6211977975597819", "week_52_low": "141.27", "gex_daily_net_charm": "-28320580.7195",
        "iv30d_1w": "0.329", "avg30_volume": "1252206"}, "/api/screener/stocks")
    add("short-screener", "/api/short_screener?tickers=%s,%s&limit=500" % (A, B), "{data:[252]}", 252, {
        "symbol": A, "short_interest": 91242133, "market_date": "2021-06-15", "short_shares_available": None,
        "total_float": 15240311000, "si_float": "0.0053128471939201", "si_float_with_synth_long_pct_of_total_shares": "0.0052491259461552",
        "days_to_cover": "1.84", "fee_rate": None, "rebate_rate": None}, "/api/short_screener")
    add("insider-transactions", "/api/insider/transactions?ticker_symbol=%s,%s&form_types[]=4&transaction_codes[]=P&transaction_codes[]=S&start_date=2026-06-22&end_date=2026-09-22&limit=500" % (A, B),
        "{data:[14],has_more:bool}", 14, {
            "id": "00000000-0000-4000-8000-00000000b1d1", "ticker": B, "amount": -842000, "transactions": 2, "price": "187.3150",
            "is_officer": False, "sector": "Technology", "is_ten_percent_owner": False, "is_s_p_500": True,
            "transaction_date": "2026-09-18", "is_director": True, "owner_name": "EXAMPLE OWNER ONE",
            "reporter_is_public_company": False, "marketcap": "3012000000000", "next_earnings_date": "2026-11-18",
            "filing_date": "2026-09-22", "stock_price": "184.60", "formtype": "4", "security_title": "Common Stock",
            "transaction_code": "S", "is_10b5_1": False, "reporter_cik": "0000000001", "security_ad_code": "ND",
            "shares_owned_after": 770531, "officer_title": "", "shares_owned_before": 1612531, "director_indirect": "I",
            "natureofownership": "By Trust"}, "/api/insider/transactions")
    add("earnings:" + A, "/api/earnings/%s" % A, "{data:[125]}", 125, {
        "source": "estimation", "report_date": "2026-10-29", "report_time": "unknown", "expected_move_perc": None,
        "ending_fiscal_quarter": "2026-09-30", "expected_move": None, "street_mean_est": "1.83", "actual_eps": None,
        "post_earnings_move_1d": None, "post_earnings_move_1w": None, "post_earnings_move_2w": None, "post_earnings_move_3d": None,
        "pre_earnings_move_1d": None, "pre_earnings_move_1w": None, "pre_earnings_move_2w": None, "pre_earnings_move_3d": None,
        "short_straddle_1w": None, "short_straddle_1d": None, "long_straddle_1w": None, "long_straddle_1d": None},
        "/api/earnings/{ticker}")
    add("shorts-data:" + A, "/api/shorts/%s/data?newer_than=2026-09-15" % A, "{data:[76]}", 76, {
        "name": "EXAMPLE A CORP", "timestamp": "2026-09-22T15:22:50Z", "symbol": A, "short_shares_available": 10000000,
        "fee_rate": "0.3100", "rebate_rate": "3.4200"}, "/api/shorts/{ticker}/data")
    add("shorts-volume:" + A, "/api/shorts/%s/volume-and-ratio" % A, "{si:[500]}", 500, {
        "total_volume": 12683082, "market_date": DAY, "short_volume": 6357440, "short_volume_ratio": "0.5012345678901234"},
        "/api/shorts/{ticker}/volume-and-ratio", "si[]")
    add("total-options-volume", "/api/market/total-options-volume?limit=252", "{data:[252]}", 252, {
        "date": DAY, "call_volume": 36255508, "put_volume": 24895745, "put_premium": "13142883165.20",
        "call_premium": "31694997463.09"}, "/api/market/total-options-volume")
    add("daily-report", "/api/market/daily-report?date=2026-09-22&limit=25",
        "{data:{date:str,vol:{2},flow:{2},skew:[25],catalysts:{5},stock_movers:[6],tide:{2},unusual_options:[25]}}", 25, {
            "date": DAY, "ticker": "SYF606",
            "components": {
                "iv_percentile": {"raw": 3.1, "value": -0.938},
                "regime_score": {"crash_probability": 0.4, "raw": -2.12928721836439, "value": -1},
                "skew_percentile": {"percentile": 0, "raw": 0.021210143021341, "value": -1},
                "vov_percentile": {"raw": 71.29571106094808, "value": 0.21295711060948},
                "vrp_z": {"raw": None, "value": None}},
            "direction": "long_vol", "updated_at": "2026-09-22T23:15:10.945995Z", "score": "-58.12234762979683",
            "sample_size": 4}, "/api/market/daily-report", "data.skew[]")
    nf = {"data": [
        {"timestamp": "2026-09-22T13:30:00Z", "date": DAY, "underlying_price": "431.26", "net_call_premium": "70210.80",
         "net_put_premium": "-198400.00", "net_volume": "391"},
        {"timestamp": "2026-09-22T13:31:00Z", "date": DAY, "underlying_price": "431.94", "net_call_premium": "-18110.50",
         "net_put_premium": "-531230.40", "net_volume": "802"},
        {"timestamp": "2026-09-22T13:32:00Z", "date": DAY, "underlying_price": "431.76", "net_call_premium": "41250.20",
         "net_put_premium": "-702980.20", "net_volume": "1190"},
        {"timestamp": "2026-09-22T13:33:00Z", "date": DAY, "underlying_price": "431.375", "net_call_premium": "-41250.30",
         "net_put_premium": "-860400.70", "net_volume": "1320"},
        {}]}
    add("net-flow-expiry",
        "/api/net-flow/expiry?date=2026-09-22&moneyness=all&moneyness=otm&tide_type=all&tide_type=equity_only&tide_type=index_only&expiration=zero_dte&expiration=weekly",
        "{data:[1],date:str,expiration:[1],moneyness:[1],tide_type:[1]}", 1, nf)
    add("economic-calendar", "/api/market/economic-calendar", "{data:[18]}", 18, {
        "type": "report", "time": "2026-09-25T14:00:00Z", "prev": "50.3", "event": "Example Consumer Sentiment Survey",
        "forecast": "48.8", "reported_period": "September"}, "/api/market/economic-calendar", unobserved=("forecast",))
    add("vix-term-structure", "/api/volatility/vix-term-structure?history_days=90", None, None, None, status=403,
        error="code=scope_required  message=synthetic refusal body standing in for a route the plan does not include")
    add("earnings-afterhours", "/api/earnings/afterhours?date=2026-09-22&limit=100", "{data:[3]}", 3, {
        "symbol": "SYG707", "source": "company", "country_code": "US", "full_name": "EXAMPLE G HOLDINGS", "sector": "Consumer Cyclical",
        "is_s_p_500": False, "reaction": None, "has_options": True, "marketcap": "2479039684", "report_date": DAY,
        "report_time": "postmarket", "expected_move_perc": "0.0712340", "ending_fiscal_quarter": "2026-08-31",
        "expected_move": "4.00", "street_mean_est": "0.74", "country_name": "UNITED STATES", "continent": "North America",
        "actual_eps": None, "pre_earnings_date": DAY, "pre_earnings_close": "44.19", "post_earnings_date": None,
        "post_earnings_close": None}, None)
    add("earnings-premarket", "/api/earnings/premarket?date=2026-09-23&limit=100", "{data:[5]}", 5, {
        "symbol": "SYH808", "source": "company", "country_code": "US", "full_name": "EXAMPLE H SERVICES", "sector": "Industrials",
        "is_s_p_500": True, "reaction": None, "has_options": True, "marketcap": "69553708727", "report_date": NEXT,
        "report_time": "premarket", "expected_move_perc": "0.0317213", "ending_fiscal_quarter": "2026-08-31",
        "expected_move": "6.25", "street_mean_est": "1.21", "country_name": "UNITED STATES", "continent": "North America",
        "actual_eps": None, "pre_earnings_date": DAY, "pre_earnings_close": "190.4", "post_earnings_date": None,
        "post_earnings_close": None}, None)
    add("etf-holdings-qqq", "/api/etfs/QQQ/holdings", "{data:[102]}", 102, {
        "close": "184.60", "high": "185.98", "low": "183.5", "name": None, "open": "183.85", "type": "stock", "ticker": B,
        "updated": "2026-09-21", "weight": "7.412530", "country_code": "US", "etf": "QQQ", "volume": "75746746",
        "sector": "Technology", "call_volume": 1203910, "put_volume": 553427, "isin": None, "has_options": True,
        "call_premium": "565333641.00", "put_premium": "142668847.00", "avg30_volume": "103249576.04761905",
        "week52_high": "196.54", "week52_low": "141.27", "bearish_premium": "292370639.00", "bullish_premium": "350752264.00",
        "short_name": "EXAMPLE B", "prev_price": "183.10", "country_name": "UNITED STATES", "continent": "North America",
        "shares": "160706263", "cusip": None}, "/api/etfs/{ticker}/holdings")
    add("etf-flow-spy", "/api/etfs/SPY/in-outflow?start_date=2025-09-22&end_date=2026-09-22", "{data:[252],years:[7156]}", 252, {
        "close": "541.38", "date": DAY, "change": 2900000, "volume": 24456025, "expiration_cycle": "weekly",
        "change_prem": "2214300000", "is_fomc": False}, "/api/etfs/{ticker}/in-outflow")
    add("etf-tide-spy", "/api/market/SPY/etf-tide?date=2026-09-22", "{data:[390],date:str}", 390, {
        "timestamp": "2026-09-22T13:30:00Z", "date": DAY, "net_call_premium": "418250.0000", "net_put_premium": "612730.0000",
        "underlying_price": "541.26", "net_volume": "8214"}, "/api/market/{ticker}/etf-tide")
    add("group-flow-mag7", "/api/group-flow/mag7/greek-flow?date=2026-09-22", "{data:[390]}", 390, {
        "timestamp": "2026-09-22T13:30:00Z", "transactions": 24159, "volume": 103451, "flow_group": "mag7",
        "net_call_premium": "964800.0000", "net_call_volume": 6826, "net_put_premium": "-1240028.0000", "net_put_volume": -3290,
        "dir_delta_flow": "160120.6458874110", "dir_vega_flow": "90419.2547098559", "otm_dir_delta_flow": "98695.7070922938",
        "otm_dir_vega_flow": "73338.6783578760", "otm_total_delta_flow": "1022557.3267561192",
        "otm_total_vega_flow": "1454574.1471429903", "total_delta_flow": "1565865.8091589327",
        "total_vega_flow": "1989099.6513490204", "otm_net_call_premium": "979329.00", "otm_net_call_volume": 5463,
        "otm_net_put_premium": "-152026.00"}, "/api/group-flow/{flow_group}/greek-flow")
    add("sector-tide-technology", "/api/market/Technology/sector-tide?date=2026-09-22", "{data:[391],date:str}", 391, {
        "timestamp": "2026-09-22T13:30:00Z", "date": DAY, "net_call_premium": "1936400.0000", "net_put_premium": "702150.0000",
        "net_volume": 9310}, "/api/market/{sector}/sector-tide")
    add("fda-calendar", "/api/market/fda-calendar?limit=100", "{data:[100]}", 100, {
        "status": "Phase 3", "time": "07:44:07", "description": "Example Therapeutics announces first patient dosed in a Phase 3 trial",
        "ticker": "SYI909", "created_at": "2021-04-13T13:22:07Z", "event_type": "Top-line Data Due",
        "updated_at": "2021-04-13T13:23:09Z", "outcome": "Final analysis from the trial is expected in 2025",
        "source_type": "Press Release", "start_date": "2021-04-13", "end_date": None,
        "notes": "Example Therapeutics announces first patient dosed in a Phase 3 trial", "has_options": True,
        "marketcap": "641640166", "target_date": "2025-MID", "catalyst": "Top-line Data Due", "drug": "Examplamab (EX-301)",
        "indication": "Example Condition (EC)"}, "/api/market/fda-calendar")
    add("options-pulse-total", "/api/options-pulse/total?date=2026-09-22", "{data:{latest:{7},intraday:[40]},date:str}", 40, {
        "put_txn": 98318, "call_txn": 341905, "sntm_score": 0.47, "trd_dt": DAY, "hr_min": "0940", "intvl_sntm_score": 0.47,
        "mkt_sntm": 301.22}, "/api/options-pulse/total", "data.latest")
    return {
        "source": "Synthetic bodies built to the schema, not vendor data (generated by tests/gen-probe-fixtures.py); the session is " + DAY + ".",
        "session": DAY,
        "provenance": provenance("flows-legs-probe"),
        "probes": p,
        "specScreenerRow": {
            "source": "synthetic bodies built to the schema, not vendor data: the whole screener field list of the observed wire shape, every value invented",
            "row": spec_screener_row(),
        },
    }


def build_positioning():
    out = {"source": "Synthetic bodies built to the schema, not vendor data (generated by tests/gen-probe-fixtures.py); the session is " + DAY + ".",
           "provenance": provenance("flows-positioning"), "sessionDate": DAY, "spot": 341.2, "atr": 6.85}
    greek = {"date": "2025-09-24", "call_gamma": "2846913.4200", "put_gamma": "-1162844.7136", "call_delta": "152307118.4410",
             "put_delta": "-19718203.5527", "call_charm": "-18433721.8870", "put_charm": "12905567.1442",
             "call_vanna": "17368420.6603", "put_vanna": "-41672305.9011"}
    conform("greekExposure", "/api/stock/{ticker}/greek-exposure", "data[]", greek, True)
    out["greekExposure"] = {"data": [greek]}
    opt = {"date": DAY, "call_volume": 801224, "put_volume": 297310, "call_volume_ask_side": 361248, "call_volume_bid_side": 352159,
           "put_volume_ask_side": 133822, "put_volume_bid_side": 124755, "net_call_premium": "-38987757.0000",
           "net_put_premium": "9102282.00", "call_premium": "362361516.0000", "put_premium": "89173480.00",
           "avg_30_day_call_volume": "873121.3333", "avg_30_day_put_volume": "453682.6333", "avg_7_day_call_volume": "907177.1429",
           "avg_7_day_put_volume": "552941", "bearish_premium": "240876420.0000", "bullish_premium": "194836481.0000",
           "put_open_interest": 1769666, "call_open_interest": 2359889, "avg_3_day_put_volume": "463796.6667",
           "avg_3_day_call_volume": "812294.3333"}
    conform("optionsVolume", "/api/stock/{ticker}/options-volume", "data[]", opt, True)
    out["optionsVolume"] = {"data": [opt]}
    out["gexLevels"] = {"data": {"date": DAY, "time": "2026-09-22T20:00:00Z", "source": "oi", "call_wall": "345", "put_wall": "320",
                                 "gamma_flip": "331.42", "gamma_magnet": "340",
                                 "nearby_flips": ["331.42", "328", "336.15", "324.5", "340.6"]}}
    expiry = {"date": DAY, "ticker": A, "expiry": NEXT, "call_volume": 465838, "put_volume": 139415, "call_volume_ask_side": 213178,
              "call_volume_bid_side": 206456, "put_volume_ask_side": 66996, "put_volume_bid_side": 60618,
              "put_premium": "18216377.00", "call_premium": "58722619.00", "call_premium_bid_side": "24106442.00",
              "put_premium_bid_side": "7204215.00", "call_premium_ask_side": "26418310.00", "put_premium_ask_side": "9331806.00",
              "call_trades": 103655, "put_trades": 31481, "call_otm_premium": "31288140.00", "call_otm_trades": 85338,
              "call_otm_volume": 402968, "put_otm_premium": "10463872.00", "put_otm_trades": 26158, "put_otm_volume": 124434}
    conform("flowPerExpiry", "/api/stock/{ticker}/flow-per-expiry", "[]", expiry, True)
    out["flowPerExpiry"] = [expiry]
    strike = {"timestamp": "2026-09-22T19:59:55.649000Z", "date": DAY, "ticker": A, "call_volume": 3, "put_volume": 24,
              "call_volume_ask_side": 1, "call_volume_bid_side": 2, "put_volume_ask_side": 2, "put_volume_bid_side": 13,
              "strike": "5", "put_premium": "131.00", "call_premium": "52410.0000", "call_premium_bid_side": "52410.0000",
              "put_premium_bid_side": "41.00", "call_premium_ask_side": "0", "put_premium_ask_side": "7.00", "call_trades": 3,
              "put_trades": 24, "call_otm_premium": "0", "call_otm_trades": 0, "call_otm_volume": 0, "put_otm_premium": "131.00",
              "put_otm_trades": 24, "put_otm_volume": 24}
    conform("flowPerStrike", "/api/stock/{ticker}/flow-per-strike", "[]", strike, True)
    out["flowPerStrike"] = [strike]
    nope = nope_row()
    conform("nope", "/api/stock/{ticker}/nope", "data[]", nope, True)
    out["nope"] = {"data": [nope]}
    spot = {"time": "2026-09-22T10:30:30.795000Z", "ticker": A, "start_time": "2026-09-22T10:30:00.000000Z", "price": "341.0869",
            "ticker_id": 9001, "charm_per_one_percent_move_dir": "0", "charm_per_one_percent_move_oi": "-1422257830.68",
            "charm_per_one_percent_move_vol": "0", "gamma_per_one_percent_move_dir": "0",
            "gamma_per_one_percent_move_oi": "71615247.93", "gamma_per_one_percent_move_vol": "0",
            "vanna_per_one_percent_move_dir": "0", "vanna_per_one_percent_move_oi": "10619719.33", "vanna_per_one_percent_move_vol": "0"}
    conform("spotExposures", "/api/stock/{ticker}/spot-exposures", "data[]", spot, True)
    out["spotExposures"] = {"data": [spot]}
    oi = {"date": DAY, "strike": "5", "call_oi": 120, "put_oi": 2210}
    conform("oiPerStrike", "/api/stock/{ticker}/oi-per-strike", "data[]", oi, True)
    out["oiPerStrike"] = {"data": [oi]}
    chain = {"date": DAY, "trades": 985, "open_interest": 96490, "volume": 1098534, "last_price": "7.40", "ask_volume": 1456,
             "avg_price": "8.378617531617", "bid_volume": 2133, "canceled_volume": 0, "cross_volume": 0, "floor_volume": 93,
             "high_price": "11.01", "implied_volatility": "0.231169661655", "iv_high": "0.2402255994843", "iv_low": "0.21356743440045",
             "last_tape_time": "2026-09-22T21:30:49Z", "low_price": "6.95", "mid_volume": 247, "multi_leg_volume": 960,
             "nbbo_ask": "7.45", "nbbo_bid": "7.15", "neutral_volume": 0, "open_price": "7.70", "stock_multi_leg_volume": 0,
             "sweep_volume": 113, "total_ask_changes": 1951, "total_bid_changes": 2050, "total_premium": "3601034.00",
             "ticker_vol": 1098534, "flex_oi_transfer": None}
    conform("contractHistoric", "/api/option-contract/{id}/historic", "chains[]", chain, True)
    out["contractHistoric"] = {"chains": [chain], "etf_holdings": []}
    dp = darkpool_row(A, 640, "341.84", 30711698, "2026-09-22T23:59:11Z", "218777.60", "341.92", "341.80", 3, 61, 26946700000001)
    conform("darkpool", "/api/darkpool/{ticker}", "data[]", dp, True)
    out["darkpool"] = {"data": [dp]}
    dr = darkpool_row("SYD404", 400, "187.4155", 15926587, "2026-09-22T23:59:58Z", "98366.2000", "187.86", "187.14", 10, 100,
                      30786400000001)
    conform("darkpoolRecent", "/api/darkpool/recent", "data[]", dr, True)
    out["darkpoolRecent"] = {"data": [dr]}
    level = {"price": "260", "dark_pool_volume": "377", "regular_volume": "0"}
    conform("darkpoolLevels", "/api/darkpool/{ticker}/price-levels", "data[]", level, True)
    out["darkpoolLevels"] = {"data": [level], "date": DAY}
    alert = flow_alert_row(**{
        "iv_end": "0.245691726648", "option_chain": "SYA101260923C00340000", "underlying_price": "341.20", "end_time": 1790107190568,
        "total_ask_side_prem": "2130", "rule_id": "00000000-0000-4000-8000-00000000a1e3", "volume_oi_ratio": "5.5632151828",
        "start_time": 1790107190423, "iv_start": "0.242141337207", "total_premium": "31862", "trade_count": 7, "price": "1.88",
        "total_size": 171, "sector": "Technology", "next_earnings_date": "2026-10-29", "er_time": "unknown", "bid": "1.88",
        "created_at": "2026-09-22T20:00:00Z", "ask": "1.90", "id": "00000000-0000-4000-8000-00000000a1e4",
        "marketcap": "4043000000000.00", "strike": "340", "ticker": A, "open_interest": 1590, "type": "call", "volume": 8779,
        "total_bid_side_prem": "29732", "delta": 0.4812, "gamma": 0.0132, "iv": 0.2461, "rho": 0.0612, "theo": 1.89,
        "theta": -0.2331, "vega": 0.2914, "issue_type": "Common Stock"})
    conform("flowAlerts", "/api/option-trades/flow-alerts", "data[]", alert, True)
    out["flowAlerts"] = {"data": [alert], "newer_than": "2026-09-22T13:30:00Z", "older_than": "2026-09-22T20:00:00Z"}
    ml = {"min_dte": 59, "underlying_price": "341.19", "code": "mlet", "net_theta": "-1.4184", "net_gamma": "-0.2410",
          "direction": "short", "max_dte": 115, "diff_expirations": True, "size": 2, "executed_at": "2026-09-22T19:59:59Z",
          "strategy": "call_diagonal_spread", "max_strike": "340", "max_profit": None, "ratios": 11, "all_otm": False,
          "net_price": "17.10", "net_side": "ask", "iv_term_spread": "0.0237", "breakevens": [], "txns": 2, "max_loss": None,
          "bid_ask_spread": "2.000", "net_premium": "3410.00", "strikes": ["310", "340"], "ivs": ["0.2680", "0.2423"],
          "total_premium": "12380.00", "uniq_exchanges": ["XISX"], "leg_count": 2, "net_delta": "48.2649",
          "id": "00000000-0000-4000-8000-00000000c1d1", "diff_strikes": True, "min_strike": "310", "net_vega": "-71.8760",
          "net_bid": "16.90", "all_opening_legs": False, "avg_iv": "0.2551", "ticker": A, "diff_types": False, "net_ask": "18.90"}
    conform("multiLeg", "/api/option-trades/multi-leg", "data[]", ml, True)
    out["multiLeg"] = {"data": [ml]}
    eb = {"expires": NEXT, "open_interest": 65260, "volume": 635253, "chains": 86}
    conform("expiryBreakdown", "/api/stock/{ticker}/expiry-breakdown", "data[]", eb, True)
    out["expiryBreakdown"] = {"data": [eb]}
    oc = {"trades": 545, "volume": 11791, "option_symbol": "SYA101260923P00340000", "underlying_symbol": A,
          "avg_price": "3.0203799579436", "curr_oi": 10510, "last_fill": "2.80", "prev_ask_volume": 1582, "prev_bid_volume": 10750,
          "prev_mid_volume": 239, "prev_multi_leg_volume": 55, "prev_neutral_volume": 0, "prev_stock_multi_leg_volume": 1,
          "prev_total_premium": "3579136.00", "curr_date": DAY, "last_date": "2026-09-21", "oi_change": "5.7248322147651",
          "days_of_vol_greater_than_oi": 3, "days_of_oi_increases": 8, "last_ask": "3.05", "last_oi": 1590, "oi_diff_plain": 8920,
          "percentage_of_total": "0.00839008372842", "last_bid": "2.55", "rnk": 27}
    conform("oiChange", "/api/stock/{ticker}/oi-change", "data[]", oc, True)
    out["oiChange"] = {"data": [oc]}
    return out


def nope_row():
    stock = 31200000
    call_delta = 21406339.118273
    put_delta = -12508176.402811
    call_fill = 30511412.990332
    put_fill = -9706308.896667
    return {
        "timestamp": "2026-09-22T19:59:00Z",
        "call_vol": 801224,
        "put_vol": 297310,
        "stock_vol": stock,
        "call_delta": "%.6f" % call_delta,
        "put_delta": "%.6f" % put_delta,
        "call_fill_delta": "%.6f" % call_fill,
        "put_fill_delta": "%.6f" % put_fill,
        "nope_fill": "%.6f" % ((call_fill + put_fill) / stock),
        "nope": "%.6f" % ((call_delta + put_delta) / stock),
    }


def main():
    docs = {
        "fixtures-live-probe.json": build_live(),
        "fixtures-vol-probe.json": build_vol(),
        "fixtures-flows-legs-probe.json": build_legs(),
        "fixtures-flows-positioning.json": build_positioning(),
    }
    if PROBLEMS:
        print("fixtures do not conform to the observed wire shape:", file=sys.stderr)
        for line in PROBLEMS:
            print("  " + line, file=sys.stderr)
        sys.exit(1)
    for name, doc in docs.items():
        with open(os.path.join(ROOT, "tests", name), "w") as handle:
            json.dump(doc, handle, indent=1, ensure_ascii=False)
            handle.write("\n")
    print("wrote %d fixtures, every row conforms" % len(docs))


if __name__ == "__main__":
    main()
