import copy
import datetime
import hashlib
import json
import math
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "docs", "uw-openapi.yaml")
SHAPES_PATH = os.path.join(ROOT, "scripts", "flows-probe-shapes.json")
OUT_PATH = os.path.join(ROOT, "tests", "fixtures-macro.json")

with open(SPEC_PATH, "rb") as handle:
    SPEC_BYTES = handle.read()
with open(SHAPES_PATH, "rb") as handle:
    SHAPES_BYTES = handle.read()
with open(os.path.abspath(__file__), "rb") as handle:
    SELF_BYTES = handle.read()
SPEC = yaml.safe_load(SPEC_BYTES)
SHAPES = json.loads(SHAPES_BYTES)
COMPONENTS = SPEC["components"]["schemas"]

SESSION = "2026-10-27"
NOW_ISO = "2026-10-27T21:40:00Z"
MATURITIES = ["3month", "2year", "5year", "7year", "10year", "30year"]
INDICATORS = ["cpi", "inflation", "unemployment", "payrolls", "retail-sales", "durables", "gdp", "gdp-per-capita"]
DAILY_COMM = ["wti", "brent", "natural-gas"]
MONTHLY_COMM = ["copper", "aluminum", "wheat", "corn", "cotton", "sugar", "coffee", "all-commodities"]
PAIRS = ["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "USDCNY", "USDTRY"]
CRYPTO = ["BTC", "ETH", "SOL"]
PRODUCTS = ["ES", "NQ", "RTY", "YM", "ZT", "ZN", "ZB", "CL", "NG", "GC", "SI", "HG", "6E", "6J"]
FUNDS = ["SPY", "QQQ", "IWM", "DIA", "XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"]
MONTH_CODES = "FGHJKMNQUVXZ"

OPS = {
    "futures-contracts": "/api/futures/contracts",
    "futures-flow": "/api/futures/flow",
    "futures-candles": "/api/futures/{contract}/candles",
    "futures-stats": "/api/futures/{contract}/stats",
    "futures-trades": "/api/futures/{contract}/trades",
    "commodity": "/api/commodities/{name}",
    "economy": "/api/economy/{indicator}",
    "fx-rate": "/api/forex/rate",
    "fx-history": "/api/forex/history",
    "fx-intraday": "/api/forex/intraday",
    "digital-history": "/api/digital-currencies/history",
    "digital-intraday": "/api/digital-currencies/intraday",
    "crypto-state": "/api/crypto/{pair}/state",
    "crypto-ohlc": "/api/crypto/{pair}/ohlc/{candle_size}",
    "crypto-whales": "/api/crypto/whales/recent",
    "crypto-whale-tx": "/api/crypto/whale-transactions",
    "market-movers": "/api/market/movers",
    "seasonality-performers": "/api/seasonality/{month}/performers",
    "seasonality-monthly": "/api/seasonality/{ticker}/monthly",
    "seasonality-year-month": "/api/seasonality/{ticker}/year-month",
    "pred-unusual": "/api/predictions/unusual",
    "pred-smart-money": "/api/predictions/smart-money",
    "pred-whales": "/api/predictions/whales",
    "pred-insiders": "/api/predictions/insiders",
    "pred-market": "/api/predictions/market/{asset_id}",
    "pred-liquidity": "/api/predictions/market/{asset_id}/liquidity",
    "pred-positions": "/api/predictions/market/{asset_id}/positions",
    "pred-user": "/api/predictions/user/{user_id}",
    "pm-companies": "/api/private-markets/companies",
    "pm-company": "/api/private-markets/companies/{npm_ticker}",
    "pm-funding": "/api/private-markets/companies/{npm_ticker}/funding",
    "pm-pricing": "/api/private-markets/companies/{npm_ticker}/pricing",
    "pm-investors-of": "/api/private-markets/companies/{npm_ticker}/investors",
    "pm-management": "/api/private-markets/companies/{npm_ticker}/management",
    "pm-investors": "/api/private-markets/investors",
    "pm-investor": "/api/private-markets/investors/{name}",
    "pm-search": "/api/private-markets/search",
}


def deref(schema):
    while isinstance(schema, dict) and "$ref" in schema:
        schema = COMPONENTS.get(schema["$ref"].replace("#/components/schemas/", ""), {})
    return schema


def properties(schema):
    schema = deref(schema)
    out = {}
    if not isinstance(schema, dict):
        return out
    for part in schema.get("allOf", []) + schema.get("oneOf", []):
        out.update(properties(part))
    out.update(schema.get("properties", {}) or {})
    return out


def documented(schema, into=None, depth=0):
    into = set() if into is None else into
    schema = deref(schema)
    if not isinstance(schema, dict) or depth > 8:
        return into
    for part in schema.get("allOf", []) + schema.get("oneOf", []):
        documented(part, into, depth + 1)
    if schema.get("type") == "array":
        documented(schema.get("items", {}), into, depth + 1)
    for name, sub in properties(schema).items():
        into.add(name)
        documented(sub, into, depth + 1)
    return into


def root_schema(op):
    response = SPEC["paths"][op]["get"]["responses"]["200"]
    return deref(response["content"]["application/json"]["schema"])


def lcg(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] / 4294967296.0

    return nxt


def sessions_back(n, end=SESSION):
    day = datetime.date.fromisoformat(end)
    out = []
    while len(out) < n:
        if day.weekday() < 5:
            out.append(day.isoformat())
        day -= datetime.timedelta(days=1)
    return list(reversed(out))


def walk(seed, start, vol, n, drift=0.0):
    r = lcg(seed)
    v = start
    out = []
    for _ in range(n):
        v = v * math.exp(drift + vol * (r() - 0.5) * 2)
        out.append(v)
    return out


def ok(body):
    return {"status": "ok", "body": body}


def macro_series(name, unit, interval, rows):
    return {"data": {"name": name, "unit": unit, "interval": interval, "data": [{"date": d, "value": v} for d, v in rows]}}


def monthly_dates(n, end="2026-09-01"):
    y, m = int(end[:4]), int(end[5:7])
    out = []
    for _ in range(n):
        out.append("%04d-%02d-01" % (y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(out))


def quarterly_dates(n, end="2026-04-01"):
    y, m = int(end[:4]), int(end[5:7])
    out = []
    for _ in range(n):
        out.append("%04d-%02d-01" % (y, m))
        m -= 3
        if m <= 0:
            m, y = m + 12, y - 1
    return list(reversed(out))


def treasury_body(maturity, level, days, unit="percent"):
    vals = walk(hash_seed("t" + maturity), level, 0.002, len(days))
    shift = level - vals[-1]
    rows = [(d, round(v + shift, 3)) for d, v in zip(days, vals)]
    return macro_series("Treasury yield " + maturity, unit, "daily", rows)


def hash_seed(text):
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


def contract_symbol(product, offset):
    y, m = 2026, 10 + offset
    while m > 12:
        m -= 12
        y += 1
    return "%s%s%d" % (product, MONTH_CODES[m - 1], y % 10)


def base_levels():
    return {"3month": 4.41, "2year": 4.02, "5year": 4.08, "7year": 4.19, "10year": 4.31, "30year": 4.82}


def series_world():
    days = sessions_back(300)
    world = {"session": SESSION, "generatedAt": NOW_ISO}
    lv = base_levels()
    treasury = {m: ok(treasury_body(m, lv[m], days)) for m in MATURITIES}
    treasury["fed-funds"] = ok(macro_series("Federal funds rate", "percent", "daily", [(d, 4.33) for d in days[-120:]]))
    world["treasury"] = treasury
    economy = {}
    for ind in INDICATORS:
        dates = quarterly_dates(24) if ind in ("gdp", "gdp-per-capita") else monthly_dates(36)
        vals = walk(hash_seed(ind), 100.0, 0.01, len(dates), 0.003)
        economy[ind] = ok(macro_series(ind, "index" if ind == "cpi" else "percent", "quarterly" if ind in ("gdp", "gdp-per-capita") else "monthly", [(d, round(v, 3)) for d, v in zip(dates, vals)]))
    world["economy"] = economy
    commodities = {}
    for name in DAILY_COMM:
        vals = walk(hash_seed(name), 70.0 if name != "natural-gas" else 3.1, 0.01, 120)
        commodities[name] = ok(macro_series(name, "dollars per barrel" if name != "natural-gas" else "dollars per million Btu", "daily", [(d, round(v, 3)) for d, v in zip(days[-120:], vals)]))
    for name in MONTHLY_COMM:
        dates = monthly_dates(36)
        vals = walk(hash_seed(name), 300.0, 0.02, 36)
        commodities[name] = ok(macro_series(name, "dollars per tonne", "monthly", [(d, round(v, 2)) for d, v in zip(dates, vals)]))
    world["commodities"] = commodities
    fx = {}
    starts = {"EURUSD": 1.09, "USDJPY": 152.4, "GBPUSD": 1.29, "USDCHF": 0.88, "AUDUSD": 0.66, "USDCAD": 1.37, "USDCNY": 7.2, "USDTRY": 34.1}
    for pair in PAIRS:
        vals = walk(hash_seed(pair), starts[pair], 0.004, 90)
        fx[pair] = ok({"data": {"from": pair[:3], "to": pair[3:], "interval": "daily", "time_zone": "UTC", "bars": [
            {"timestamp": d, "open": round(v * 0.999, 5), "high": round(v * 1.003, 5), "low": round(v * 0.996, 5), "close": round(v, 5), "volume": 0} for d, v in zip(days[-90:], vals)]}})
    world["fx"] = fx
    digital, ohlc = {}, {}
    cstart = {"BTC": 68000.0, "ETH": 3400.0, "SOL": 170.0}
    for sym in CRYPTO:
        vals = walk(hash_seed(sym), cstart[sym], 0.02, 90)
        cal = [(datetime.date.fromisoformat(SESSION) - datetime.timedelta(days=89 - i)).isoformat() for i in range(90)]
        digital[sym] = ok({"data": {"from": sym, "to": "USD", "interval": "daily", "time_zone": "UTC", "bars": [
            {"timestamp": d, "open": round(v, 2), "high": round(v * 1.01, 2), "low": round(v * 0.99, 2), "close": round(v, 2), "volume": 0} for d, v in zip(cal, vals)]}})
        ohlc[sym] = ok({"data": [{"pair": sym + "-USD", "start_time": d + "T00:00:00Z", "timestamp": d + "T23:59:59Z", "open": "%.2f" % v, "high": "%.2f" % (v * 1.01), "low": "%.2f" % (v * 0.99), "close": "%.2f" % v, "volume": "100.5"} for d, v in zip(cal, vals)]})
    world["digital"], world["cryptoOhlc"] = digital, ohlc
    rows = []
    for p in PRODUCTS:
        for off in range(0, 8):
            sym = contract_symbol(p, off)
            rows.append({"name": sym, "product": p, "security_id": "SY" + p + str(off), "is_spread": False, "volume": 90000 - off * 9000 + hash_seed(p) % 500, "trades": 4000 - off * 400, "high": "5100.25", "low": "5050.50", "last_trade": NOW_ISO})
        rows.append({"name": contract_symbol(p, 0) + "-" + contract_symbol(p, 1), "product": p, "security_id": "SY" + p + "S", "is_spread": True, "volume": 500000, "trades": 9000, "high": "1.5", "low": "0.5", "last_trade": NOW_ISO})
    world["futuresContracts"] = ok({"data": rows})
    stats = {}
    for p in ["ES", "CL", "ZN", "NQ", "RTY", "YM", "GC"]:
        for off in range(0, 6):
            sym = contract_symbol(p, off)
            stats[sym] = ok({"data": {"settlement": "%.2f" % (5000.0 + off * 12 + hash_seed(p) % 50), "settlement_date": SESSION, "open_interest": 2000000 - off * 200000, "session_volume": 900000 - off * 100000}})
    world["futuresStats"] = stats
    candles = {}
    for p in PRODUCTS:
        sym = contract_symbol(p, 0)
        vals = walk(hash_seed("c" + p), 5000.0 if p == "ES" else 100.0, 0.006, 63)
        candles[p] = {"sym": sym, "res": ok({"data": [{"o": "%.2f" % v, "h": "%.2f" % (v * 1.004), "l": "%.2f" % (v * 0.996), "c": "%.2f" % v, "v": 120000, "start": d + "T14:30:00Z", "end": d + "T21:00:00Z", "date": d} for d, v in zip(days[-63:], vals)]})}
    world["futuresCandles"] = candles
    prints = []
    for i, p in enumerate(["ES", "ES", "NQ", "ZN", "CL", "GC", "6E", "ES", "ES", "ZN"]):
        prints.append({"executed_at": "2026-10-27T14:%02d:00Z" % (31 + i), "product": p, "sym": contract_symbol(p, 0), "side": ["buy", "sell", "none", "buy", "sell", "buy", "none", "buy", "buy", "sell"][i], "size": [400, 250, 120, 900, 80, 60, 300, 150, 90, 700][i], "price": "5010.25", "nbbo_bid": "5010.00", "nbbo_ask": "5010.50", "crossed": i == 6, "trade_id": 900 + i})
    world["futuresFlow"] = [ok({"data": prints})]
    world["movers"] = ok(movers_body("fraction"))
    return world


def movers_body(unit):
    def row(t, price, change):
        frac = change / (price - change)
        cp = frac if unit == "fraction" else frac * 100
        if unit == "mixed" and t.endswith("2"):
            cp = frac * 100
        return {"ticker": t, "price": price, "change": change, "change_percent": round(cp, 5), "volume": 1200000}
    names = ["SYX101", "SYX102", "SYX103", "SYX104", "SYX105"]
    return {"data": {"last_updated": "2026-10-27T20:05:00Z", "top_gainers": [row(n, 50.0 + i, 2.5 - i * 0.3) for i, n in enumerate(names)], "top_losers": [row(n, 40.0 + i, -(2.0 - i * 0.2)) for i, n in enumerate(names)], "most_active": [row(n, 30.0 + i, 0.4 * (i - 2)) for i, n in enumerate(names)]}}


def season_world(years=26, percent=False, mismatch=False):
    sm = int(SESSION[5:7])
    ym, monthly = {}, {}
    r = lcg(77)
    for t in FUNDS:
        rows = []
        for y in range(2026 - years, 2027):
            for m in range(1, 13):
                if y == 2026 and m > sm:
                    continue
                o = 100 + r() * 50
                ch = (r() - 0.45) * 0.1
                c = o * (1 + ch)
                rows.append({"year": y, "month": m, "open": "%.2f" % o, "close": "%.2f" % c, "change": round(c / o - 1, 5) * (100 if percent else 1)})
        ym[t] = ok({"data": rows})
        mrows = []
        for m in range(1, 13):
            ys = [x for x in rows if x["month"] == m and x["year"] < 2026]
            mrows.append({"month": m, "years": len(ys) + (1 if mismatch and m == sm else 0), "positive_closes": sum(1 for x in ys if float(x["close"]) > float(x["open"])), "median_change": "0.005", "avg_change": "0.0003"})
        monthly[t] = ok({"data": mrows})
    return ym, monthly


def performers(null=True, strong=False):
    rows = []
    for i in range(50):
        years = 12 if null else 20
        pos = 7 + (i % 3) if null else 11 + (i % 3)
        if strong and i < 2:
            years, pos = 20, 19
        rows.append({"ticker": "SYX%03d" % (200 + i), "sector": ["Technology", "Healthcare", "Financial Services"][i % 3], "years": years, "positive_closes": pos, "positive_months_perc": "0.6", "median_change": "0.01"})
    return ok({"data": rows})


def predictions(kind="matched"):
    cal_at = "2026-10-29T18:00:00Z"
    base = {"asset_id": "A1", "market": "Will the Fed cut rates at the October FOMC meeting?", "outcome": "Yes", "current": "0.62", "resolves": cal_at, "category": "Finance", "volume": "250000", "smart_volume": "10000", "unusual_score": "1.0", "image": "", "tags": [], "top_insiders": []}
    base2 = dict(base, asset_id="A2", market="Will CPI inflation exceed 3.5 percent?", current="0.31", resolves="2026-10-30T12:00:00Z", volume="90000")
    lst = [base, base2] if kind != "none" else [dict(base, asset_id="A9", market="Will a team win the title?", category="Sports")]
    if kind == "unmatched":
        lst = [dict(base, asset_id="A5", market="Will the Fed hold rates in December?", resolves="2026-12-16T19:00:00Z")]
    out = {"unusual": ok({"data": {"categories": ["Finance"], "data": lst}}), "smart": ok({"data": {"categories": ["Finance"], "data": []}}), "whales": ok({"data": {"data": []}}), "insiders": ok({"data": {"data": []}})}
    details = {}
    for c in lst:
        aid = c["asset_id"]
        thin = kind == "thin"
        resolved = kind == "resolved"
        positions = [{"invested_usd": "%d" % (60000 - i * 4000), "tags": ["bot"] if i % 4 == 0 else [], "smart_score": "1", "user_address": "0x" + ("%02x" % (i + 1)) * 20} for i in range(12)]
        details[aid] = {
            "market": ok({"data": {"question": c["market"], "question_type": "binary", "outcomes": ["Yes", "No"], "outcome_index": 0, "category": "Finance", "volume": "250000", "end_date": c["resolves"], "closed": resolved, "active": not resolved, "liquidity": "100000", "outcome_assets": [{"asset_id": aid, "label": "Yes", "prices": [{"date": (datetime.date(2026, 10, 27) - datetime.timedelta(days=29 - i)).isoformat(), "price": "%.2f" % (0.5 + i * 0.004)} for i in range(30)]}]}}),
            "liquidity": ok({"data": {"best_bid": "0.61", "best_ask": "0.63" if not thin else "0.69", "mid_price": "0.62", "spread": "0.02" if not thin else "0.08", "bid_liquidity": "30000", "ask_liquidity": "30000", "total_liquidity": "60000" if not thin else "20000", "timestamp": NOW_ISO, "bids": [], "asks": []}}),
            "positions": ok({"data": positions}),
            "holders": [ok({"data": {"category_scores": [{"category": "Finance", "win_rate": "0.%d" % (55 + j), "num_markets": 30}]}}) for j in range(3)],
        }
    out["details"] = details
    return out


def calendar_rows(kind="matched"):
    rows = [
        {"at": "2026-10-29T18:00:00Z", "day": "2026-10-29", "event": "FOMC Interest Rate Decision", "tag": "fomc"},
        {"at": "2026-10-30T12:30:00Z", "day": "2026-10-30", "event": "Core PCE Price Index", "tag": "pce"},
        {"at": "2026-11-06T13:30:00Z", "day": "2026-11-06", "event": "Non-Farm Payrolls", "tag": "nfp"},
    ]
    if kind == "none":
        return rows[1:2]
    return rows


def pm_world(kind="ok"):
    companies = [{"id": i, "npm_ticker": "SYPM%02d" % i, "name": "Sample Robotics %d" % i, "sector": "Technology", "sub_sectors": ["Robotics"], "year_founded": 2015, "headquarters": "Sample City", "description": "An invented company."} for i in range(1, 9)]
    world = {"kind": kind, "query": "sample capital", "search": ok({"data": {"companies": [], "investors": [{"name": "Sample Capital Inc.", "company_count": 14}]}}),
             "investor": ok({"data": {"name": "Sample Capital Inc.", "companies": [{"npm_ticker": c["npm_ticker"], "name": c["name"], "sector": c["sector"]} for c in companies]}}),
             "companies": ok({"data": companies}), "investors": ok({"data": [{"name": "Sample Capital Inc.", "company_count": 14}, {"name": "Invented Ventures", "company_count": 9}]}),
             "details": {}}
    for c in companies:
        npm = c["npm_ticker"]
        world["details"][npm] = {
            "company": ok({"data": {"company": c, "total_funding": 1000000000 + c["id"] * 5e7, "investor_count": 12 + c["id"], "latest_price": {"date": "2026-10-20", "price": 100 + c["id"]}}}),
            "funding": ok({"data": [{"financing_round": "Series C", "investment_amount": 200000000, "investment_date": "2026-03-15"}, {"financing_round": "Series B", "investment_amount": 80000000, "investment_date": "2025-04-01"}]}),
            "pricing": ok({"data": [{"date": "2025-10-21", "price": 80}, {"date": "2026-04-01", "price": 90}, {"date": "2026-10-20", "price": 100 + c["id"]}]}),
            "investorsOf": ok({"data": [{"name": "Sample Capital Inc."}, {"name": "Invented Ventures"}]}),
            "management": ok({"data": [{"first_name": "Fixture", "last_name": "Person", "title": "Chief Executive Officer"}, {"first_name": "Other", "last_name": "Person", "title": ""}]}),
        }
    if kind == "unmatched":
        world["companies"] = ok({"data": []})
    if kind == "plan":
        for key in ("search", "investor", "companies", "investors"):
            world[key] = {"status": "plan", "why": "402"}
    if kind == "ambiguous":
        world["search"] = ok({"data": {"companies": [], "investors": [{"name": "Sample Capital Inc.", "company_count": 14}, {"name": "Sample Capital Corp", "company_count": 3}]}})
    return world


def live_world(zone="UTC"):
    fx_rate = {p: ok({"data": {"rate": 1.0842, "bid": 1.0841, "ask": 1.0843, "from": p[:3], "to": p[3:], "last_refreshed": "2026-10-27 21:35:00", "time_zone": zone}}) for p in PAIRS}
    crypto_state = {p: ok({"data": {"open_24h": "67000.00", "high_24h": "69000.00", "low_24h": "66500.00", "close_24h": "68000.00", "volume_24h": "12000.5", "timestamp": "2026-10-27T21:35:00Z", "date": None}}) for p in ["BTC-USD", "ETH-USD", "SOL-USD"]}
    futures = {p: ok({"data": {"settlement": "5012.25", "settlement_date": SESSION, "open_interest": 2100000, "session_volume": 880000}}) for p in ["ES", "NQ", "RTY", "YM", "ZN", "CL", "GC"]}
    bars = [{"timestamp": "2026-10-27 %02d:00:00" % h, "open": 1.08, "high": 1.09, "low": 1.07, "close": 1.08 + h * 0.0001, "volume": 0} for h in range(8, 22)]
    return {
        "board": {"fx": fx_rate, "crypto": crypto_state, "futures": futures},
        "futures": {"flow": ok({"data": [{"executed_at": "2026-10-27T20:%02d:00Z" % i, "product": "ES", "sym": "ESZ6", "side": "buy" if i % 2 else "sell", "size": 150, "price": "5010.25", "nbbo_bid": "5010.00", "nbbo_ask": "5010.50", "crossed": False, "trade_id": i} for i in range(6)]}),
                    "trades": ok({"data": [{"executed_at": "2026-10-27T20:%02d:00Z" % i, "side": "buy" if i % 2 else "sell", "size": 150, "price": "5010.25", "nbbo_bid": "5010.00", "nbbo_ask": "5010.50", "crossed": False, "trade_id": i} for i in range(6)]}),
                    "candles": ok({"data": [{"o": "5000.00", "h": "5004.00", "l": "4998.00", "c": "5002.00", "v": 4000, "start": "2026-10-27T20:%02d:00Z" % (i * 5), "end": "2026-10-27T20:%02d:59Z" % (i * 5 + 4), "date": SESSION} for i in range(10)]})},
        "crypto": {"ohlc": ok({"data": [{"pair": "BTC-USD", "start_time": "2026-10-27T%02d:%02d:00Z" % (20 + i // 12, (i % 12) * 5), "timestamp": "2026-10-27T%02d:%02d:59Z" % (20 + i // 12, (i % 12) * 5 + 4), "open": "67990.00", "high": "68010.00", "low": "67980.00", "close": "%.2f" % (68000 + i), "volume": "1.5"} for i in range(20)]}),
                   "digital": ok({"data": {"from": "BTC", "to": "USD", "interval": "5min", "time_zone": "UTC", "bars": [{"timestamp": "2026-10-27 21:%02d:00" % (i * 5), "open": 68000, "high": 68010, "low": 67990, "close": 68019.0, "volume": 0} for i in range(8)]}}),
                   "whales": ok({"data": [{"pair": "BTC-USD", "side": "buy" if i % 2 else "sell", "size": "10", "price": "68000", "total": "680000", "exchange": "x", "whaled_at": "2026-10-27T21:%02d:00Z" % (i + 10), "symbol": "BTC", "id": "w%d" % i} for i in range(6)]}),
                   "transfers": ok({"data": [{"usd_value": "2500000", "transaction_type": "transfer", "blockchain": "ethereum", "token_symbol": "ETH", "timestamp": "2026-10-27T21:%02d:00Z" % (i + 10), "whale_score": 7, "from_address": "0x" + "ab" * 20, "to_address": "0x" + "cd" * 20, "transaction_hash": "0x" + "ef" * 32} for i in range(4)]})},
        "fx": {"intraday": ok({"data": {"from": "EUR", "to": "USD", "interval": "60min", "time_zone": zone, "bars": bars}})},
    }


def worlds():
    base = series_world()
    ym, monthly = season_world()
    base["seasonYearMonth"], base["seasonMonthly"] = ym, monthly
    base["performersThis"] = performers(True)
    base["performersNext"] = performers(True)
    base["predictions"] = predictions("matched")
    base["calendar"] = calendar_rows()
    out = {"ok": base}

    def variant(name, fn):
        w = copy.deepcopy(base)
        fn(w)
        out[name] = {k: v for k, v in w.items() if v != base[k]}

    def curve_inverted(w):
        for m, delta in (("2year", 0.12),):
            body = w["treasury"][m]["body"]["data"]["data"]
            ten = w["treasury"]["10year"]["body"]["data"]["data"][-1]["value"]
            body[-1]["value"] = round(ten + delta, 3)
    variant("curve-inverted", curve_inverted)

    def curve_mixed(w):
        rows = w["treasury"]["5year"]["body"]["data"]["data"]
        rows.pop()
    variant("curve-mixed-dates", curve_mixed)

    def unit_null(w):
        w["economy"]["cpi"]["body"]["data"]["unit"] = None
        w["commodities"]["copper"]["body"]["data"]["unit"] = None
    variant("unit-null", unit_null)

    def fx_zone(w):
        for p in PAIRS:
            b = w["fx"][p]["body"]["data"]
            b["time_zone"] = "US/Eastern"
            for bar in b["bars"]:
                bar["timestamp"] = bar["timestamp"] + " 16:00:00"
    variant("fx-zone", fx_zone)

    def crypto_differs(w):
        rows = w["cryptoOhlc"]["BTC"]["body"]["data"]
        last = rows[-1]
        last["close"] = "%.2f" % (float(last["close"]) * 1.008)
    variant("crypto-differs", crypto_differs)

    def futures_stale(w):
        sym = contract_symbol("ES", 1)
        w["futuresStats"][sym]["body"]["data"]["settlement_date"] = "2026-10-23"
    variant("futures-stale", futures_stale)

    def symbol_bad(w):
        rows = w["futuresContracts"]["body"]["data"]
        rows.append({"name": "ESZ", "product": "ES", "security_id": "SYB1", "is_spread": False, "volume": 9999999, "trades": 1, "high": "1", "low": "1", "last_trade": NOW_ISO})
        rows.append({"name": "ES-Z6", "product": "ES", "security_id": "SYB2", "is_spread": False, "volume": 9999998, "trades": 1, "high": "1", "low": "1", "last_trade": NOW_ISO})
        rows.append({"name": "NQH9", "product": "NQ", "security_id": "SYB3", "is_spread": False, "volume": 9999997, "trades": 1, "high": "1", "low": "1", "last_trade": NOW_ISO})
    variant("symbol-bad", symbol_bad)

    for unit in ("percent", "fraction", "mixed"):
        variant("movers-" + unit, lambda w, unit=unit: w.__setitem__("movers", ok(movers_body(unit))))
    variant("season-few", lambda w: w.update(dict(zip(("seasonYearMonth", "seasonMonthly"), season_world(years=7)))))
    variant("season-percent-change", lambda w: w.update(dict(zip(("seasonYearMonth", "seasonMonthly"), season_world(percent=True)))))
    variant("season-feed-mismatch", lambda w: w.update(dict(zip(("seasonYearMonth", "seasonMonthly"), season_world(mismatch=True)))))
    variant("performers-null", lambda w: w.update({"performersThis": performers(True), "performersNext": performers(True)}))
    variant("performers-strong", lambda w: w.update({"performersThis": performers(False, True), "performersNext": performers(False, True)}))
    variant("odds-matched", lambda w: None)
    variant("odds-thin", lambda w: w.__setitem__("predictions", predictions("thin")))
    variant("odds-resolved", lambda w: w.__setitem__("predictions", predictions("resolved")))
    variant("odds-unmatched", lambda w: w.__setitem__("predictions", predictions("unmatched")))

    def odds_none(w):
        w["predictions"] = predictions("none")
        w["calendar"] = calendar_rows("none")
    variant("odds-none", odds_none)
    variant("limited", lambda w: w["fx"].__setitem__("EURUSD", {"status": "limited", "why": "429"}))
    variant("failed", lambda w: w.__setitem__("futuresContracts", {"status": "failed", "why": "500"}))
    out["pm-ok"] = pm_world("ok")
    out["pm-unmatched"] = pm_world("unmatched")
    out["pm-plan"] = pm_world("plan")
    out["pm-ambiguous"] = pm_world("ambiguous")
    return out


def operation_samples(ws):
    base = ws["ok"]
    return {
        "futures-contracts": base["futuresContracts"]["body"],
        "futures-flow": base["futuresFlow"][0]["body"],
        "futures-candles": base["futuresCandles"]["ES"]["res"]["body"],
        "futures-stats": next(iter(base["futuresStats"].values()))["body"],
        "futures-trades": live_world()["futures"]["trades"]["body"],
        "commodity": base["commodities"]["wti"]["body"],
        "economy": base["economy"]["cpi"]["body"],
        "fx-rate": live_world()["board"]["fx"]["EURUSD"]["body"],
        "fx-history": base["fx"]["EURUSD"]["body"],
        "fx-intraday": live_world()["fx"]["intraday"]["body"],
        "digital-history": base["digital"]["BTC"]["body"],
        "digital-intraday": live_world()["crypto"]["digital"]["body"],
        "crypto-state": live_world()["board"]["crypto"]["BTC-USD"]["body"],
        "crypto-ohlc": base["cryptoOhlc"]["BTC"]["body"],
        "crypto-whales": live_world()["crypto"]["whales"]["body"],
        "crypto-whale-tx": live_world()["crypto"]["transfers"]["body"],
        "market-movers": base["movers"]["body"],
        "seasonality-performers": base["performersThis"]["body"],
        "seasonality-monthly": base["seasonMonthly"]["SPY"]["body"],
        "seasonality-year-month": base["seasonYearMonth"]["SPY"]["body"],
        "pred-unusual": base["predictions"]["unusual"]["body"],
        "pred-smart-money": base["predictions"]["smart"]["body"],
        "pred-whales": base["predictions"]["whales"]["body"],
        "pred-insiders": base["predictions"]["insiders"]["body"],
        "pred-market": base["predictions"]["details"]["A1"]["market"]["body"],
        "pred-liquidity": base["predictions"]["details"]["A1"]["liquidity"]["body"],
        "pred-positions": base["predictions"]["details"]["A1"]["positions"]["body"],
        "pred-user": base["predictions"]["details"]["A1"]["holders"][0]["body"],
        "pm-companies": ws["pm-ok"]["companies"]["body"],
        "pm-company": ws["pm-ok"]["details"]["SYPM01"]["company"]["body"],
        "pm-funding": ws["pm-ok"]["details"]["SYPM01"]["funding"]["body"],
        "pm-pricing": ws["pm-ok"]["details"]["SYPM01"]["pricing"]["body"],
        "pm-investors-of": ws["pm-ok"]["details"]["SYPM01"]["investorsOf"]["body"],
        "pm-management": ws["pm-ok"]["details"]["SYPM01"]["management"]["body"],
        "pm-investors": ws["pm-ok"]["investors"]["body"],
        "pm-investor": ws["pm-ok"]["investor"]["body"],
        "pm-search": ws["pm-ok"]["search"]["body"],
    }


def problems(samples):
    out = []
    for key, body in samples.items():
        op = OPS[key]
        allowed = documented(root_schema(op)) | {"data"}

        def walk_names(value, path):
            if isinstance(value, dict):
                for name, sub in value.items():
                    if name not in allowed:
                        out.append("%s.%s: not a name the spec documents" % (path, name))
                    walk_names(sub, "%s.%s" % (path, name))
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    walk_names(item, "%s[%d]" % (path, i))

        walk_names(body, key)
    econ = SHAPES["ops"]["/api/economy/{indicator}"]["sets"]["data.data[]"]
    sample = samples["economy"]["data"]["data"][0]
    if sorted(econ) != sorted(sample):
        out.append("economy: the observed row keys %s differ from the fixture's %s" % (sorted(econ), sorted(sample)))
    obs = SHAPES["ops"]["/api/seasonality/market"]["sets"]["data[]"]
    row = samples["seasonality-performers"]["data"][0]
    if not {"ticker", "years", "positive_closes"} <= set(obs) or not {"ticker", "years", "positive_closes"} <= set(row):
        out.append("seasonality: the observed performer row lost a read name")
    return out


def main():
    ws = worlds()
    found = problems(operation_samples(ws))
    if found:
        for line in found:
            print("DRIFT: " + line, file=sys.stderr)
        sys.exit(1)
    doc = {
        "provenance": {
            "generator": "tests/gen-macro-fixtures.py",
            "generatorSha256": hashlib.sha256(SELF_BYTES).hexdigest(),
            "specSha256": hashlib.sha256(SPEC_BYTES).hexdigest(),
            "shapesSha256": hashlib.sha256(SHAPES_BYTES).hexdigest(),
            "nature": "synthetic, written from the schema; not feed data",
        },
        "session": SESSION,
        "now": NOW_ISO,
        "ops": OPS,
        "documented": {op: sorted(documented(root_schema(op)) | {"data"}) for op in OPS.values()},
        "worlds": ws,
        "live": {"ok": live_world("UTC"), "zone": live_world("US/Eastern")},
    }
    with open(OUT_PATH, "w") as handle:
        json.dump(doc, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
    print("wrote %s (%d bytes)" % (OUT_PATH, os.path.getsize(OUT_PATH)))


if __name__ == "__main__":
    main()
