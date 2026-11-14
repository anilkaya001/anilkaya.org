import datetime
import hashlib
import json
import os
import random
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "docs", "uw-openapi.yaml")
SHAPES_PATH = os.path.join(ROOT, "scripts", "flows-probe-shapes.json")
OUT_PATH = os.path.join(ROOT, "tests", "fixtures-flowlab.json")
SELF_PATH = os.path.abspath(__file__)


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


with open(SPEC_PATH, "rb") as handle:
    SPEC = yaml.safe_load(handle.read())
COMPONENTS = SPEC["components"]["schemas"]
with open(SHAPES_PATH, "rb") as handle:
    SHAPES = json.loads(handle.read())

SESSION = "2026-10-23"
EXPIRY = "2026-11-20"
TICKERS = ["SYX101", "SYX202", "SYX303"]
GROUP = "mag7"

OPS = {
    "contract-screener": "/api/screener/option-contracts",
    "contract-flow": "/api/option-contract/{id}/flow",
    "contract-intraday": "/api/option-contract/{id}/intraday",
    "contract-profile": "/api/option-contract/{id}/volume-profile",
    "flow-alert-trades": "/api/option-trades/flow-alerts/{id}",
    "multi-leg-legs": "/api/option-trades/multi-leg/{id}/legs",
    "exchange-breakdown": "/api/option-trades/exchange-breakdown/{date}",
    "optionable-roots": "/api/option-trades/optionable-tickers",
    "strike-flow-intraday": "/api/stock/{ticker}/flow-per-strike-intraday",
    "flow-per-strike": "/api/stock/{ticker}/flow-per-strike",
    "flow-per-expiry": "/api/stock/{ticker}/flow-per-expiry",
    "greek-flow-expiry": "/api/stock/{ticker}/greek-flow/{expiry}",
    "group-greek-flow-expiry": "/api/group-flow/{flow_group}/greek-flow/{expiry}",
    "option-price-levels": "/api/stock/{ticker}/option/stock-price-levels",
    "darkpool-levels": "/api/darkpool/{ticker}/price-levels",
    "lit-recent": "/api/lit-flow/recent",
    "lit-ticker": "/api/lit-flow/{ticker}",
    "analytics-window": "/api/analytics/window",
    "analytics-sliding": "/api/analytics/sliding",
    "multi-leg": "/api/option-trades/multi-leg",
}

ASSUMED = ["analytics-window", "analytics-sliding"]


def deref(schema):
    while isinstance(schema, dict) and "$ref" in schema:
        schema = COMPONENTS[schema["$ref"].split("/")[-1]]
    return schema


def root_schema(op):
    response = SPEC["paths"][op]["get"]["responses"]["200"]
    return deref(response["content"]["application/json"]["schema"])


def properties(schema):
    schema = deref(schema)
    out = {}
    if not isinstance(schema, dict):
        return out
    for part in schema.get("allOf", []) + schema.get("oneOf", []):
        out.update(properties(part))
    out.update(schema.get("properties", {}) or {})
    return out


TYPES = {"string": str, "boolean": bool, "array": list, "object": dict}


def observed_extra(op):
    entry = SHAPES["ops"].get(op) or {}
    return set(entry.get("undocumented") or [])


def observed_types(op):
    entry = SHAPES["ops"].get(op) or {}
    out = {}
    for fields in (entry.get("sets") or {}).values():
        out.update(fields)
    return out


def wire_type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "num"
    if isinstance(value, str):
        try:
            float(value)
            return "str#"
        except ValueError:
            return "str"
    if isinstance(value, list):
        return "arr"
    return "obj"


def check_wire(op, rows, problems):
    types = observed_types(op)
    if not types:
        return
    for i, row in enumerate(rows):
        for key, value in row.items():
            want = types.get(key)
            if want is None:
                problems.append("%s[%d].%s: not a key the wire carried" % (op, i, key))
            elif wire_type(value) not in want.split("|"):
                problems.append("%s[%d].%s: %s where the wire carried %s" % (op, i, key, wire_type(value), want))


def numeric_text(value):
    try:
        float(value)
        return True
    except ValueError:
        return False


def check_value(schema, value, path, problems, extra=frozenset(), wired=frozenset()):
    schema = deref(schema)
    if not isinstance(schema, dict):
        return
    declared = schema.get("type")
    if value is None:
        if not schema.get("nullable") and declared is not None:
            problems.append("%s: null where the schema is not nullable" % path)
        return
    if declared in ("integer", "number") and isinstance(value, str) and path.rsplit(".", 1)[-1] in wired and numeric_text(value):
        return
    if declared == "integer":
        if not (isinstance(value, int) and not isinstance(value, bool)):
            problems.append("%s: %r is not an integer" % (path, value))
        return
    if declared == "number":
        if not (isinstance(value, (int, float)) and not isinstance(value, bool)):
            problems.append("%s: %r is not a number" % (path, value))
        return
    if declared in TYPES and not isinstance(value, TYPES[declared]):
        problems.append("%s: %r is not %s" % (path, value, declared))
        return
    if declared == "array":
        for i, item in enumerate(value):
            check_value(schema.get("items", {}), item, "%s[%d]" % (path, i), problems, extra, wired)
    elif declared == "object" or properties(schema):
        props = properties(schema)
        if props and isinstance(value, dict):
            for key, sub in value.items():
                if key in extra:
                    continue
                if key not in props:
                    problems.append("%s.%s: not a documented property" % (path, key))
                else:
                    check_value(props[key], sub, "%s.%s" % (path, key), problems, extra, wired)


def validate(op, body):
    problems = []
    schema = root_schema(op)
    props = properties(schema)
    extra = observed_extra(op)
    wired = frozenset(k for k, t in observed_types(op).items() if "str#" in t.split("|"))
    if isinstance(body, list):
        for i, row in enumerate(body):
            check_value(schema, row, "%s[%d]" % (op, i), problems, extra, wired)
        check_wire(op, [r for r in body if isinstance(r, dict)], problems)
    elif "data" in props:
        check_value(schema, body, op, problems, extra, wired)
        rows = body.get("data") if isinstance(body, dict) else None
        if isinstance(rows, list):
            check_wire(op, [r for r in rows if isinstance(r, dict)], problems)
    elif deref(schema).get("type") == "array":
        rows = body["data"] if isinstance(body, dict) and "data" in body else body
        check_value(schema, rows, op, problems, extra, wired)
    else:
        for key, value in body.items():
            if key == "data":
                rows = value if isinstance(value, list) else [value]
                for i, row in enumerate(rows):
                    check_value(schema, row, "%s.data[%d]" % (op, i), problems, extra, wired)
            elif key in props:
                check_value(props[key], value, "%s.%s" % (op, key), problems, extra, wired)
            else:
                problems.append("%s.%s: not a documented property" % (op, key))
    return problems


def osi(root, expiry, cp, strike):
    return root + expiry[2:4] + expiry[5:7] + expiry[8:10] + cp + ("%08d" % int(round(strike * 1000)))


CONTRACT = osi("SYX101", EXPIRY, "C", 120.0)
OTHER = osi("SYX101", EXPIRY, "P", 110.0)
LEG_A = osi("SYX101", EXPIRY, "C", 115.0)
LEG_C = osi("SYX101", EXPIRY, "C", 125.0)


def uuid(rng):
    h = "".join(rng.choice("0123456789abcdef") for _ in range(32))
    return "%s-%s-%s-%s-%s" % (h[:8], h[8:12], h[12:16], h[16:20], h[20:])


def money(v):
    return "%.2f" % v


def dec(v, places=4):
    return ("%." + str(places) + "f") % v


def ts(minute_offset, base_h=13, base_m=30):
    t = datetime.datetime(2026, 10, 23, base_h, base_m, tzinfo=datetime.timezone.utc) + datetime.timedelta(minutes=minute_offset)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def build_screener(rng, thin):
    rows = []
    specs = [
        (CONTRACT, 120.0, "call", EXPIRY, "SYX101", 118.4, 9200, 3100, 4600, 700, 1200, 700, 2400, 1900, 500, 300, 100, 61000),
        (OTHER, 110.0, "put", EXPIRY, "SYX101", 118.4, 5200, 12400, 1100, 3200, 700, 200, 1300, 500, 200, 800, 0, 61000),
        (osi("SYX202", "2026-11-13", "C", 45.0), 45.0, "call", "2026-11-13", "SYX202", 44.1, 4100, 900, 2800, 100, 600, 600, 2100, 400, 100, 0, 0, 26000),
        (osi("SYX303", "2026-12-18", "P", 300.0), 300.0, "put", "2026-12-18", "SYX303", 311.0, 2300, 1500, 300, 1500, 100, 400, 900, 100, 0, 0, 0, 12500),
        (osi("SYX202", "2026-10-30", "C", 47.0), 47.0, "call", "2026-10-30", "SYX202", 44.1, 1800, 0, 900, 300, 400, 200, 700, 200, 0, 0, 0, 26000),
    ]
    for (sym, k, cp, exp, root, spot, vol, oi, ask, bid, mid, none, sweep, floor, multi, smulti, cross, tvol) in specs:
        if thin:
            oi = 0
        avg = max(0.05, round(rng.uniform(1.1, 6.4), 2))
        rows.append({
            "ask_side_volume": ask, "avg_price": money(avg), "bid_side_volume": bid, "chain_prev_close": money(avg * 0.9),
            "close": money(avg), "cross_volume": cross, "er_time": "premarket", "expiry": exp, "floor_volume": floor,
            "high": money(avg * 1.2), "last_fill": "2026-10-23T19:41:12Z", "low": money(avg * 0.8), "mid_volume": mid,
            "multileg_volume": multi, "next_earnings_date": "2026-11-05", "no_side_volume": none, "open": money(avg * 0.95),
            "open_interest": oi, "option_symbol": sym, "option_type": cp, "premium": money(avg * vol * 100), "sector": "Technology",
            "stock_multi_leg_volume": smulti, "stock_price": money(spot), "strike": money(k), "sweep_volume": sweep,
            "ticker_vol": tvol, "total_ask_changes": 3, "total_bid_changes": 2, "trades": max(1, vol // 9), "volume": vol,
        })
    return {"data": rows}


def build_contract_flow(rng, thin):
    n = 5 if thin else 50
    rows = []
    alert_id = uuid(rng)
    for i in range(n):
        minute = 5 + i * 7
        bid = 4.80 + (i % 5) * 0.05
        ask = bid + 0.20
        px = ask if i % 3 == 0 else bid if i % 3 == 1 else (bid + ask) / 2
        size = 5 + (i * 13) % 60
        if i == 11 and not thin:
            size = 1200
        side_tags = ["ask_side"] if i % 3 == 0 else ["bid_side"] if i % 3 == 1 else ["mid_side"]
        rows.append({
            "ask_vol": size if i % 3 == 0 else 0, "bid_vol": size if i % 3 == 1 else 0, "canceled": (not thin) and i in (17, 33),
            "delta": dec(0.41), "er_time": "premarket", "ewma_nbbo_ask": money(ask), "ewma_nbbo_bid": money(bid), "exchange": ["XCBO", "XPHL", "XNAS", "XISX"][i % 4],
            "executed_at": ts(minute), "expiry": EXPIRY, "flow_alert_id": alert_id if i % 9 == 0 else "", "full_name": "SYNTHETIC EXAMPLE ONE",
            "gamma": dec(0.03), "id": uuid(rng), "implied_volatility": dec(0.52), "industry_type": "Software", "is_agg": False, "issue_type": None,
            "marketcap": "84200000000", "mid_vol": size if i % 3 == 2 else 0, "multi_vol": 0, "nbbo_ask": money(ask), "nbbo_bid": money(bid),
            "next_earnings_date": "2026-11-05", "no_side_vol": 0, "open_interest": 0 if thin else 3100, "option_chain_id": CONTRACT,
            "option_type": "call", "premium": money(px * size * 100), "price": money(px), "report_flags": ["normal"], "rho": dec(0.01),
            "rule_id": uuid(rng), "sector": "Technology", "size": size, "stock_multi_vol": 0, "strike": money(120), "tags": side_tags,
            "theo": money(px), "theta": dec(-0.04), "trade_ids": [uuid(rng)], "underlying_price": money(118.4), "underlying_symbol": "SYX101",
            "upstream_condition_detail": "auto", "vega": dec(0.12), "volume": size,
        })
    return {"data": rows}


def build_intraday(rng, thin):
    n = 12 if thin else 380
    rows = []
    price = 5.0
    for i in range(n):
        price = max(0.5, price + rng.uniform(-0.04, 0.05))
        vol = rng.randint(0, 30) if i % 4 else rng.randint(20, 90)
        ask = int(vol * rng.uniform(0.2, 0.7))
        bid = int(vol * rng.uniform(0.05, 0.3))
        mid = int(vol * 0.1)
        none = max(0, vol - ask - bid - mid)
        rows.append({
            "avg_price": money(price), "close": money(price), "expiry": EXPIRY, "high": money(price + 0.03), "iv_high": dec(0.53), "iv_low": dec(0.51),
            "low": money(price - 0.03), "open": money(price - 0.01), "option_symbol": CONTRACT, "premium_ask_side": money(ask * price * 100),
            "premium_bid_side": money(bid * price * 100), "premium_mid_side": money(mid * price * 100), "premium_no_side": money(none * price * 100),
            "start_time": ts(i), "volume_ask_side": ask, "volume_bid_side": bid, "volume_mid_side": mid, "volume_multi": 0, "volume_no_side": none,
            "volume_stock_multi": 0,
        })
    return {"data": rows}


def build_profile(rng, thin):
    n = 4 if thin else 30
    rows = []
    for i in range(n):
        px = 4.10 + i * 0.05
        v = int(40 + 400 * max(0.0, 1 - abs(i - 13) / 14.0))
        ask = int(v * 0.5)
        bid = int(v * 0.3)
        rows.append({
            "ask_vol": ask, "bid_vol": bid, "cross_vol": v // 20, "date": SESSION, "floor_vol": v // 10, "mid_vol": v - ask - bid, "multi_vol": v // 15,
            "price": money(px), "sweep_vol": v // 8, "transactions": max(1, v // 11), "volume": v,
        })
    return {"data": rows}


def build_alert(rng, thin):
    if thin:
        return {"alert": {}, "trades": [], "has_more": False}
    trades = []
    for i in range(6):
        trades.append({"executed_at": ts(20 + i), "price": money(5.0 + i * 0.01), "size": 40 + i, "premium": money((5.0 + i * 0.01) * (40 + i) * 100),
                       "nbbo_bid": money(4.95), "nbbo_ask": money(5.10), "exchange": "XCBO"})
    alert = {"alert_rule": "RepeatedHits", "option_chain": CONTRACT, "total_premium": money(125000), "total_size": 250, "created_at": ts(26),
             "has_sweep": True, "has_floor": False, "has_multileg": False}
    return {"alert": alert, "trades": trades, "has_more": True}


def build_legs(rng, thin):
    if thin:
        return {"data": []}
    def leg(sym, typ, strike, side, price):
        return {"delta": dec(0.4), "expiry": EXPIRY, "nbbo_ask": money(price + 0.1), "nbbo_bid": money(price - 0.1), "open_interest": 1200,
                "option_symbol": sym, "option_symbol_id": 1, "premium": money(price * 30 * 100), "price": money(price), "side": side, "size": 30,
                "strike": money(strike), "theta": dec(-0.05), "type": typ, "volume": 800}
    return {"data": [leg(LEG_A, "call", 115, "buy", 8.4), leg(CONTRACT, "call", 120, "sell", 5.1), leg(LEG_C, "call", 125, "buy", 2.9)]}


def build_multileg(rng, thin):
    if thin:
        return {"data": []}
    def row(rid, strikes, prem, minute, ticker="SYX101"):
        return {"all_opening_legs": False, "all_otm": False, "bid_ask_spread": "0.15", "breakevens": ["118.2"], "code": "mlet", "diff_expirations": False,
                "diff_strikes": True, "diff_types": False, "direction": "bullish", "executed_at": ts(minute), "id": rid, "ivs": ["0.5"],
                "leg_count": len(strikes), "max_dte": 28, "max_loss": "900", "max_profit": "2100", "max_strike": strikes[-1], "min_dte": 28,
                "min_strike": strikes[0], "net_ask": "2.5", "net_bid": "2.3", "net_delta": "0.3", "net_premium": money(prem * 0.4), "net_price": "2.4",
                "net_side": "ask", "net_theta": "-0.02", "size": 30, "strategy": "call_butterfly", "strikes": strikes, "ticker": ticker, "total_premium": money(prem),
                "txns": 3, "underlying_price": "118.4", "uniq_exchanges": ["XCBO"]}
    return {"data": [
        row("a0a0a0a0-0000-4000-8000-000000000001", ["115.00", "120.00", "125.00"], 93000, 33),
        row("a0a0a0a0-0000-4000-8000-000000000002", ["130.00", "135.00"], 41000, 41),
        row("a0a0a0a0-0000-4000-8000-000000000003", ["120.00"], 15500, 12, "SYX202"),
    ]}


def build_exchange(rng, thin):
    rows = []
    exchanges = [("XCBO", 5200, 9100, 640000.0), ("XPHL", 2100, 4300, 270000.5), ("XNAS", 1700, 3000, 180000.0), ("XISX", 900, 1500, 99000.25)]
    tickers = TICKERS[:1] if thin else TICKERS
    for t in tickers:
        for ex, trades, contracts, prem in exchanges:
            rows.append({"call_trades": trades // 2, "contracts": contracts, "exchange": ex, "premium": prem, "put_trades": trades - trades // 2,
                         "trade_code": "", "trade_count": trades, "underlying_symbol": t})
    return {"data": rows}


def build_codes(rng, thin):
    rows = []
    exchanges = [("XCBO", 5), ("XPHL", 3), ("XNAS", 2)]
    for t in TICKERS[:1] if thin else TICKERS:
        for code, trades, contracts, prem in [("auto", 4000, 7000, 500000.0), ("isoi", 1200, 2500, 210000.0), ("mlet", 600, 1300, 99000.0), ("late", 20, 40, 3000.0)]:
            for ex, part in exchanges:
                rows.append({"call_trades": trades * part // 20, "contracts": contracts * part // 10, "exchange": ex, "premium": prem * part / 10.0,
                             "put_trades": trades * part // 10 - trades * part // 20, "trade_code": code, "trade_count": trades * part // 10, "underlying_symbol": t})
    return {"data": rows}


def build_roots(rng, thin):
    return {"data": sorted(TICKERS + ["SYX404", "SYX505"]) if not thin else ["SYX101"]}


def strike_list():
    return [100 + 5 * i for i in range(9)]


def build_strike_flow(rng, thin):
    rows = []
    strikes = strike_list()[:3] if thin else strike_list()
    steps = 6 if thin else 39
    for s in range(steps):
        for k in strikes:
            ca, cb, pa, pb = rng.randint(0, 40), rng.randint(0, 25), rng.randint(0, 30), rng.randint(0, 35)
            rows.append({
                "call_premium": money((ca + cb) * 310), "call_premium_ask_side": money(ca * 310), "call_premium_bid_side": money(cb * 310), "call_trades": 3,
                "call_volume": ca + cb + 4, "call_volume_ask_side": ca, "call_volume_bid_side": cb, "date": SESSION, "put_premium": money((pa + pb) * 250),
                "put_premium_ask_side": money(pa * 250), "put_premium_bid_side": money(pb * 250), "put_trades": 2, "put_volume": pa + pb + 3,
                "put_volume_ask_side": pa, "put_volume_bid_side": pb, "strike": money(k), "ticker": "SYX101", "timestamp": ts(s * 10, 13, 30),
            })
    return {"data": rows}


def wire_money(v):
    return "%.1f" % v


def build_expiry(rng, thin):
    rows = []
    expiries = ["2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13", EXPIRY, "2026-12-18"][: (2 if thin else 6)]
    for i, exp in enumerate(expiries):
        cv = rng.randint(800, 9000)
        pv = rng.randint(500, 7000)
        cva, cvb = int(cv * rng.uniform(0.25, 0.55)), int(cv * rng.uniform(0.15, 0.35))
        pva, pvb = int(pv * rng.uniform(0.2, 0.5), ), int(pv * rng.uniform(0.15, 0.4))
        cpx, ppx = rng.uniform(0.6, 7.5), rng.uniform(0.5, 6.5)
        rows.append({
            "call_otm_premium": wire_money(cv * cpx * 40), "call_otm_trades": cv // 25, "call_otm_volume": cv // 2, "call_premium": wire_money(cv * cpx * 100),
            "call_premium_ask_side": wire_money(cva * cpx * 100), "call_premium_bid_side": wire_money(cvb * cpx * 100), "call_trades": cv // 9, "call_volume": cv,
            "call_volume_ask_side": cva, "call_volume_bid_side": cvb, "date": SESSION, "expiry": exp, "put_otm_premium": wire_money(pv * ppx * 45),
            "put_otm_trades": pv // 30, "put_otm_volume": pv // 2, "put_premium": wire_money(pv * ppx * 100), "put_premium_ask_side": wire_money(pva * ppx * 100),
            "put_premium_bid_side": wire_money(pvb * ppx * 100), "put_trades": pv // 8, "put_volume": pv, "put_volume_ask_side": pva, "put_volume_bid_side": pvb,
            "ticker": "SYX101",
        })
    return rows


def build_strike_day(rng, thin):
    rows = []
    strikes = [95 + 5 * i for i in range(6 if thin else 30)]
    for k in strikes:
        near = max(0.05, 1 - abs(k - 120) / 60.0)
        ca, cb = int(rng.randint(20, 900) * near), int(rng.randint(10, 600) * near)
        pa, pb = int(rng.randint(15, 700) * near), int(rng.randint(10, 800) * near)
        cx, px = int(rng.randint(0, 300) * near), int(rng.randint(0, 250) * near)
        cv, pv = ca + cb + cx, pa + pb + px
        cpx, ppx = max(0.05, (130 - k) / 6.0 + 1.2), max(0.05, (k - 110) / 6.0 + 1.1)
        rows.append({
            "call_otm_premium": wire_money(cv * cpx * 60 if k > 118 else 0), "call_otm_trades": cv // 30 if k > 118 else 0, "call_otm_volume": cv if k > 118 else 0,
            "call_premium": wire_money(cv * cpx * 100), "call_premium_ask_side": wire_money(ca * cpx * 100), "call_premium_bid_side": wire_money(cb * cpx * 100),
            "call_trades": max(1, cv // 7), "call_volume": cv, "call_volume_ask_side": ca, "call_volume_bid_side": cb, "date": SESSION,
            "put_otm_premium": wire_money(pv * ppx * 60 if k < 118 else 0), "put_otm_trades": pv // 30 if k < 118 else 0, "put_otm_volume": pv if k < 118 else 0,
            "put_premium": wire_money(pv * ppx * 100), "put_premium_ask_side": wire_money(pa * ppx * 100), "put_premium_bid_side": wire_money(pb * ppx * 100),
            "put_trades": max(1, pv // 7), "put_volume": pv, "put_volume_ask_side": pa, "put_volume_bid_side": pb, "strike": "%.1f" % k, "ticker": "SYX101",
            "timestamp": "2026-10-23T20:00:00Z",
        })
    return rows


def build_greek(rng, thin, group=False):
    rows = []
    for s in range(6 if thin else 39):
        d = (rng.random() - 0.35) * 90000
        v = (rng.random() - 0.4) * 30000
        row = {
            "dir_delta_flow": dec(d, 2), "dir_vega_flow": dec(v, 2), "expiry": EXPIRY, "otm_dir_delta_flow": dec(d * 0.6, 2), "otm_dir_vega_flow": dec(v * 0.6, 2),
            "otm_total_delta_flow": dec(abs(d) * 0.9, 2), "otm_total_vega_flow": dec(abs(v) * 0.9, 2), "timestamp": ts(s * 10), "total_delta_flow": dec(abs(d) * 1.5, 2),
            "total_vega_flow": dec(abs(v) * 1.5, 2), "transactions": 40 + s, "volume": 900 + 11 * s,
        }
        if group:
            row.update({"flow_group": GROUP, "net_call_premium": money(rng.uniform(-50000, 90000)), "net_call_volume": 100 + s,
                        "net_put_premium": money(rng.uniform(-60000, 40000)), "net_put_volume": 80 + s})
        else:
            row["ticker"] = "SYX101"
        rows.append(row)
    return {"data": rows}


def build_option_levels(rng, thin):
    n = 4 if thin else 25
    return {"data": [{"call_volume": int(300 * max(0.0, 1 - abs(i - 12) / 13.0)) + 5, "price": money(110 + i * 0.75), "put_volume": int(260 * max(0.0, 1 - abs(i - 9) / 13.0)) + 4} for i in range(n)]}


def build_darkpool_levels(rng, thin):
    n = 4 if thin else 20
    rows = []
    for i in range(n):
        rows.append({"dark_pool_volume": str(int(30000 * max(0.0, 1 - abs(i - 9) / 12.0)) + 200), "price": "%.2f" % (113 + i * 0.5),
                     "regular_volume": str(int(80000 * max(0.0, 1 - abs(i - 10) / 12.0)) + 500)})
    return {"data": rows, "date": SESSION}


def build_lit(rng, thin, ticker=None):
    rows = []
    n = 5 if thin else (120 if ticker else 60)
    for i in range(n):
        t = ticker or TICKERS[i % 3]
        px = 100 + (i % 17) * 0.13
        size = (100 if ticker else 5000) + (i * 37) % 4000
        rows.append({
            "canceled": (not thin) and i == 7, "executed_at": ts(i * 2), "ext_hour_sold_codes": "", "market_center": ["N", "Q", "P", "Z"][i % 4], "nbbo_ask": money(px + 0.02),
            "nbbo_ask_quantity": 200, "nbbo_bid": money(px - 0.02), "nbbo_bid_quantity": 300, "premium": money(px * size), "price": money(px), "sale_cond_codes": "@ F",
            "size": size, "ticker": t, "tracking_id": 1000 + i, "trade_code": "", "trade_settlement": "regular", "volume": 100000 + i * size,
        })
    return {"data": rows}


def build_analytics(rng, thin, sliding=False):
    syms = ["SPY", "SYX101", "SYX202"]
    payload = {}
    for a in syms:
        payload[a] = {}
        for b in syms:
            payload[a][b] = 1.0 if a == b else {("SPY", "SYX101"): 0.62, ("SPY", "SYX202"): 0.31, ("SYX101", "SYX202"): 0.44}.get(tuple(sorted((a, b), key=syms.index)), 0.0)
    return {"data": {"meta": {"symbols": syms, "calculations": ["correlation"]}, "payload": payload}}


def world(kind):
    rng = random.Random({"normal": 11, "thin": 13}[kind])
    thin = kind == "thin"
    return {
        "contract-screener": build_screener(rng, thin),
        "contract-flow": build_contract_flow(rng, thin),
        "contract-intraday": build_intraday(rng, thin),
        "contract-profile": build_profile(rng, thin),
        "flow-alert-trades": build_alert(rng, thin),
        "multi-leg-legs": build_legs(rng, thin),
        "multi-leg": build_multileg(rng, thin),
        "exchange-breakdown": build_exchange(rng, thin),
        "exchange-breakdown-codes": build_codes(rng, thin),
        "optionable-roots": build_roots(rng, thin),
        "strike-flow-intraday": build_strike_flow(rng, thin),
        "flow-per-strike": build_strike_day(rng, thin),
        "flow-per-expiry": build_expiry(rng, thin),
        "greek-flow-expiry": build_greek(rng, thin),
        "group-greek-flow-expiry": build_greek(rng, thin, True),
        "option-price-levels": build_option_levels(rng, thin),
        "darkpool-levels": build_darkpool_levels(rng, thin),
        "lit-recent": build_lit(rng, thin),
        "lit-ticker": build_lit(rng, thin, "SYX101"),
        "analytics-window": build_analytics(rng, thin),
        "analytics-sliding": build_analytics(rng, thin, True),
    }


LISTS = ["contract-screener", "contract-flow", "contract-intraday", "contract-profile", "multi-leg-legs", "multi-leg", "exchange-breakdown",
         "exchange-breakdown-codes", "optionable-roots", "strike-flow-intraday", "flow-per-strike", "flow-per-expiry", "greek-flow-expiry", "group-greek-flow-expiry",
         "option-price-levels", "darkpool-levels", "lit-recent", "lit-ticker"]


def empty_world():
    out = {k: {"data": []} for k in LISTS}
    out["flow-alert-trades"] = {"alert": {}, "trades": [], "has_more": False}
    out["analytics-window"] = {"data": {"meta": None, "payload": None}}
    out["analytics-sliding"] = {"data": {"meta": None, "payload": None}}
    return out


def unshaped_world():
    out = {k: {"data": {"unexpected": True}} for k in LISTS}
    out["flow-alert-trades"] = {"alert": "none", "trades": "none", "has_more": "no"}
    out["analytics-window"] = {"data": {"meta": {}, "payload": {"SPY": "bad"}}}
    out["analytics-sliding"] = {"data": {"meta": {}, "payload": {"SPY": {"SPY": 1.7}}}}
    out["optionable-roots"] = {"data": "AAPL"}
    return out


def plan_world():
    return {k: {"status": 403, "body": {"error": "not on the plan"}} for k in list(LISTS) + ["flow-alert-trades", "analytics-window", "analytics-sliding"]}


def op_of(key):
    return OPS["exchange-breakdown" if key == "exchange-breakdown-codes" else key]


def main():
    worlds = {"normal": world("normal"), "thin": world("thin"), "empty": empty_world(), "unshaped": unshaped_world(), "plan": plan_world()}
    problems = []
    for kind in ("normal", "thin"):
        for key, body in worlds[kind].items():
            problems.extend(validate(op_of(key), body))
    for key in worlds["empty"]:
        if key.startswith("analytics"):
            continue
        problems.extend(validate(op_of(key), worlds["empty"][key]))
    if problems:
        sys.stderr.write("DRIFT: %d fixture problem(s)\n" % len(problems))
        for line in problems[:40]:
            sys.stderr.write("  " + line + "\n")
        sys.exit(1)
    out = {
        "provenance": {
            "generator": "tests/gen-flowlab-fixtures.py",
            "generatorSha256": sha(SELF_PATH),
            "specSha256": sha(SPEC_PATH),
            "shapesSha256": sha(SHAPES_PATH),
            "pyyaml": yaml.__version__,
            "source": "bodies built from the 200-response schemas of docs/uw-openapi.yaml, with the key names and numeric strings the shape manifest observed where it records the operation; the bodies were not observed on the wire",
            "nature": "synthetic: invented tickers, invented ids, invented figures; not vendor data",
        },
        "session": SESSION,
        "expiry": EXPIRY,
        "contract": CONTRACT,
        "other": OTHER,
        "tickers": TICKERS,
        "group": GROUP,
        "ops": {k: v for k, v in OPS.items()},
        "entries": {k: {"shape": "assumed" if k in ASSUMED else "spec"} for k in OPS},
        "worlds": worlds,
    }
    with open(OUT_PATH, "w") as handle:
        json.dump(out, handle, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
    print("wrote %s (%d bytes)" % (os.path.relpath(OUT_PATH, ROOT), os.path.getsize(OUT_PATH)))


if __name__ == "__main__":
    main()
