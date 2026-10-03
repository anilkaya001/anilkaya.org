import datetime
import hashlib
import json
import math
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "docs", "uw-openapi.yaml")
OUT_PATH = os.path.join(ROOT, "tests", "fixtures-dossier-vendor.json")

with open(SPEC_PATH, "rb") as handle:
    SPEC_BYTES = handle.read()
SPEC = yaml.safe_load(SPEC_BYTES)
COMPONENTS = SPEC["components"]["schemas"]

TICKER = "EXMP"
NOW_DAY = "2026-10-02"

OPS = {
    "info": "/api/stock/{ticker}/info",
    "profile": "/api/companies/{ticker}/profile",
    "financials": "/api/stock/{ticker}/financials",
    "breakdown": "/api/stock/{ticker}/fundamental-breakdown",
    "estimates": "/api/companies/{ticker}/earnings-estimates",
    "analysts": "/api/screener/analysts",
    "earnings": "/api/earnings/{ticker}",
    "ownership": "/api/institution/{ticker}/ownership",
    "short": "/api/shorts/{ticker}/interest-float/v2",
    "insiders": "/api/insider/{ticker}/ticker-flow",
    "news": "/api/news/headlines",
    "levels": "/api/darkpool/{ticker}/price-levels",
    "quote": "/api/stock/{ticker}/stock-state",
}


def deref(schema):
    while isinstance(schema, dict) and "$ref" in schema:
        schema = COMPONENTS[schema["$ref"].split("/")[-1]]
    return schema


def root_schema(op):
    response = SPEC["paths"][op]["get"]["responses"]["200"]
    content = response.get("content", {}).get("application/json", {})
    return deref(content["schema"])


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
    if not isinstance(schema, dict) or depth > 6:
        return into
    for part in schema.get("allOf", []) + schema.get("oneOf", []):
        documented(part, into, depth + 1)
    if schema.get("type") == "array":
        documented(schema.get("items", {}), into, depth + 1)
    for name, sub in properties(schema).items():
        into.add(name)
        documented(sub, into, depth + 1)
    return into


TYPES = {"string": str, "boolean": bool, "array": list, "object": dict}


def check_value(schema, value, path, problems):
    schema = deref(schema)
    if not isinstance(schema, dict):
        return
    declared = schema.get("type")
    if value is None:
        if not schema.get("nullable") and declared is not None:
            problems.append("%s: null where the schema is not nullable" % path)
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
            check_value(schema.get("items", {}), item, "%s[%d]" % (path, i), problems)
    elif declared == "object" or properties(schema):
        props = properties(schema)
        if props and isinstance(value, dict):
            for key, sub in value.items():
                if key not in props:
                    problems.append("%s.%s: not a documented property" % (path, key))
                else:
                    check_value(props[key], sub, "%s.%s" % (path, key), problems)


def validate(op, body):
    problems = []
    schema = root_schema(op)
    props = properties(schema)
    if "data" in props:
        check_value(schema, body, op, problems)
    else:
        for key, value in body.items():
            if key == "data":
                rows = value if isinstance(value, list) else [value]
                for i, row in enumerate(rows):
                    check_value(schema, row, "%s.data[%d]" % (op, i), problems)
            elif key in props:
                check_value(props[key], value, "%s.%s" % (op, key), problems)
            else:
                problems.append("%s.%s: not a documented property" % (op, key))
    return problems


def day(offset):
    base = datetime.date.fromisoformat(NOW_DAY)
    return (base + datetime.timedelta(days=offset)).isoformat()


def stamp(offset_days, hh=14, mm=30):
    return "%s %02d:%02d:00+00:00" % (day(offset_days), hh, mm)


def money(v, places=0):
    return ("%." + str(places) + "f") % v


def quarters(n, last="2026-06-30"):
    d = datetime.date.fromisoformat(last)
    out = []
    for i in range(n):
        out.append(d.isoformat())
        month = d.month - 3
        year = d.year
        if month <= 0:
            month += 12
            year -= 1
        end = {3: 31, 6: 30, 9: 30, 12: 31}[month]
        d = datetime.date(year, month, end)
    return out


def build_info():
    return {"data": {
        "announce_time": "afterhours", "avg30_volume": "5400000", "beta": "1.31", "full_name": "EXAMPLE TECHNOLOGIES",
        "has_dividend": False, "has_earnings_history": True, "has_investment_arm": False, "has_options": True,
        "issue_type": "Common Stock", "logo": "https://example.invalid/exmp.png", "marketcap": "84200000000",
        "next_earnings_date": "2026-10-22", "sector": "Technology",
        "short_description": "Example Technologies sells subscription software and cloud infrastructure services to mid-sized "
                             "enterprises. It earns most of its revenue from recurring contracts.",
    }}


def build_profile():
    return {"data": {
        "analyst_target_price": 182.5, "asset_type": "Common Stock", "beta": 1.31, "cik": "0001234567", "country": "USA",
        "currency": "USD", "description": "Example Technologies Inc. develops cloud software and infrastructure for enterprises.",
        "dividend_yield": None, "ebitda": 5100000000, "eps": 3.9, "exchange": "NASDAQ", "industry": "Software - Infrastructure",
        "market_cap": 84200000000, "name": "Example Technologies Inc", "pe_ratio": 41.7, "peg_ratio": 2.2,
        "sector": "Technology", "shares_outstanding": 512000000, "ticker": TICKER, "week_52_high": 171.9, "week_52_low": 96.4,
    }}


def build_financials():
    qs = quarters(12)
    income, balance, cash, earnings = [], [], [], []
    for i, d in enumerate(qs):
        rev = 4_000_000_000 * (1.045 ** (11 - i))
        gp = rev * (0.71 + 0.001 * (11 - i))
        op = rev * (0.22 + 0.002 * (11 - i))
        net = op * 0.82
        income.append({
            "fiscal_date_ending": d, "report_type": "quarterly", "reported_currency": "USD", "ticker": TICKER,
            "total_revenue": money(rev), "gross_profit": money(gp), "operating_income": money(op), "net_income": money(net),
            "ebitda": money(op * 1.12), "inserted_at": "2026-08-01 12:00:00+00:00", "updated_at": "2026-08-01 12:00:00+00:00",
        })
        cash.append({
            "fiscal_date_ending": d, "report_type": "quarterly", "reported_currency": "USD", "ticker": TICKER,
            "operating_cashflow": money(net * 1.25), "capital_expenditures": money(-rev * 0.06),
            "inserted_at": "2026-08-01 12:00:00+00:00", "updated_at": "2026-08-01 12:00:00+00:00",
        })
        if i < 4:
            balance.append({
                "fiscal_date_ending": d, "report_type": "quarterly", "reported_currency": "USD", "ticker": TICKER,
                "cash_and_short_term_investments": money(6_200_000_000 + 80_000_000 * (3 - i)),
                "short_long_term_debt_total": money(3_100_000_000), "total_shareholder_equity": money(9_800_000_000),
                "total_assets": money(21_000_000_000), "total_liabilities": money(11_200_000_000),
                "total_current_assets": money(9_400_000_000), "total_current_liabilities": money(4_700_000_000),
                "common_stock_shares_outstanding": "512000000",
                "inserted_at": "2026-08-01 12:00:00+00:00", "updated_at": "2026-08-01 12:00:00+00:00",
            })
        est = 0.62 * (1.04 ** (11 - i))
        rep = est * (1.03 if i % 4 != 2 else 0.98)
        earnings.append({
            "fiscal_date_ending": d, "report_type": "quarterly", "ticker": TICKER, "estimated_eps": "%.2f" % est,
            "reported_eps": "%.2f" % rep, "report_date": day(-70 - 91 * i), "report_time": "postmarket",
            "surprise": "%.2f" % (rep - est), "surprise_percentage": "%.1f" % ((rep - est) / est * 100),
            "inserted_at": "2026-08-01 12:00:00+00:00", "updated_at": "2026-08-01 12:00:00+00:00",
        })
    for y in (2025, 2024):
        income.append({
            "fiscal_date_ending": "%d-12-31" % y, "report_type": "annual", "reported_currency": "USD", "ticker": TICKER,
            "total_revenue": money(16_000_000_000 if y == 2025 else 14_600_000_000), "gross_profit": money(11_300_000_000),
            "operating_income": money(3_900_000_000), "net_income": money(3_100_000_000), "ebitda": money(4_400_000_000),
        })
    return {"data": {"income_statements": income, "balance_sheets": balance, "cash_flows": cash, "earnings": earnings}}


def build_breakdown():
    rows = []
    for member, value in (("Cloud Infrastructure", 2_100_000_000), ("Subscription Software", 1_800_000_000), ("Professional Services", 520_000_000)):
        rows.append({
            "axis": ["ProductOrServiceAxis"], "field": "RevenueFromContractWithCustomerExcludingAssessedTax",
            "members": [member], "report_date": "2026-06-30", "rev_group": "product", "value": str(value),
        })
    for member, value in (("United States", 2_600_000_000), ("Europe", 1_100_000_000), ("Asia Pacific", 720_000_000)):
        rows.append({
            "axis": ["StatementGeographicalAxis"], "field": "RevenueFromContractWithCustomerExcludingAssessedTax",
            "members": [member], "report_date": "2026-06-30", "rev_group": "locations", "value": str(value),
        })
    return {"data": {"annual_only": False, "general": [], "rev_breakdown": rows}}


def build_estimates():
    return {"data": {"ticker": TICKER, "estimates": [
        {"date": "2026-09-30", "horizon": "0q", "eps_estimate_average": 0.98, "eps_estimate_high": 1.04, "eps_estimate_low": 0.91,
         "eps_estimate_analyst_count": 24, "revenue_estimate_average": 5_650_000_000, "revenue_estimate_high": 5_800_000_000,
         "revenue_estimate_low": 5_500_000_000, "revenue_estimate_analyst_count": 22},
        {"date": "2026-12-31", "horizon": "+1q", "eps_estimate_average": 1.05, "eps_estimate_high": 1.12, "eps_estimate_low": 0.97,
         "eps_estimate_analyst_count": 23, "revenue_estimate_average": 5_900_000_000, "revenue_estimate_high": 6_050_000_000,
         "revenue_estimate_low": 5_700_000_000, "revenue_estimate_analyst_count": 21},
    ]}}


def build_analysts():
    firms = ["Citi", "UBS", "Morgan Stanley", "Barclays", "Jefferies", "Wells Fargo", "Mizuho", "Needham", "Piper Sandler", "Baird"]
    recs = ["buy", "buy", "hold", "buy", "buy", "hold", "sell", "buy", "buy", "hold"]
    actions = ["upgraded", "maintained", "downgraded", "target raised", "reiterated", "maintained", "initiated", "maintained", "upgraded", "reiterated"]
    rows = []
    for i, firm in enumerate(firms):
        rows.append({
            "action": actions[i], "analyst_name": "Analyst %d" % (i + 1), "firm": firm, "recommendation": recs[i],
            "sector": "Technology", "target": "%.1f" % (150 + 4 * i), "ticker": TICKER, "timestamp": stamp(-3 - 6 * i, 11, 20),
        })
    rows.append({
        "action": "maintained", "analyst_name": "Old Analyst", "firm": "Stale Securities", "recommendation": "sell",
        "sector": "Technology", "target": "90.0", "ticker": TICKER, "timestamp": stamp(-200, 11, 20),
    })
    return {"data": rows}


def build_earnings():
    rows = []
    for i in range(10):
        em = 0.065 + 0.002 * (i % 3)
        move = (-1) ** i * (0.04 + 0.012 * (i % 4))
        rows.append({
            "actual_eps": "%.2f" % (0.6 + 0.02 * (9 - i)), "ending_fiscal_quarter": quarters(12)[i], "expected_move": "%.2f" % (em * 120),
            "expected_move_perc": "%.4f" % em, "long_straddle_1d": "%.4f" % (-0.05 + 0.03 * (i % 4)),
            "long_straddle_1w": "%.4f" % (-0.04 + 0.02 * (i % 5)), "post_earnings_move_1d": "%.4f" % move,
            "post_earnings_move_1w": "%.4f" % (move * 1.3), "post_earnings_move_2w": "%.4f" % (move * 1.1),
            "post_earnings_move_3d": "%.4f" % (move * 1.2), "pre_earnings_move_1d": "%.4f" % (0.004 * (i % 3)),
            "pre_earnings_move_1w": "%.4f" % (0.012 * ((i % 4) - 1)), "pre_earnings_move_2w": "%.4f" % 0.01,
            "pre_earnings_move_3d": "%.4f" % 0.006, "report_date": day(-70 - 91 * i), "report_time": "postmarket",
            "short_straddle_1d": "%.4f" % (0.05 - 0.03 * (i % 4)), "short_straddle_1w": "%.4f" % 0.02,
            "source": "company", "street_mean_est": "%.2f" % (0.58 + 0.02 * (9 - i)),
        })
    rows.insert(0, {
        "actual_eps": "", "ending_fiscal_quarter": "2026-09-30", "expected_move": "6.80", "expected_move_perc": "0.0534", "long_straddle_1d": "",
        "long_straddle_1w": "", "post_earnings_move_1d": "", "post_earnings_move_1w": "", "post_earnings_move_2w": "", "post_earnings_move_3d": "",
        "pre_earnings_move_1d": "", "pre_earnings_move_1w": "", "pre_earnings_move_2w": "", "pre_earnings_move_3d": "", "report_date": "2026-10-22",
        "report_time": "postmarket", "short_straddle_1d": "", "short_straddle_1w": "", "source": "company", "street_mean_est": "0.98",
    })
    return {"data": rows}


def build_ownership():
    names = [("VANGUARD GROUP INC", "Vanguard"), ("BLACKROCK INC.", "BlackRock"), ("STATE STREET CORP", "State Street"),
             ("FMR LLC", "Fidelity"), ("GEODE CAPITAL MANAGEMENT", "Geode"), ("T. ROWE PRICE", "T. Rowe"),
             ("NORTHERN TRUST CORP", "Northern Trust"), ("CAPITAL WORLD INVESTORS", "Capital World")]
    rows = []
    for i, (name, short) in enumerate(names):
        units = int(52_000_000 / (1 + i * 0.6))
        change = int((-1) ** i * 900_000 / (1 + i))
        rows.append({
            "avg_price": "112.40", "filing_date": "2026-08-14", "first_buy": "2019-03-31", "historical_units": [units - change, units],
            "inst_share_value": "%d" % (units * 150), "inst_value": "%d" % (units * 900), "name": name, "people": [],
            "report_date": "2026-06-30", "shares_outstanding": "512000000", "short_name": short, "tags": ["index"],
            "units": units, "units_change": change, "value": units * 150,
        })
    return {"data": rows}


def build_short():
    return {"data": [
        {"days_to_cover": "2.4", "fee_rate": "0.31", "market_date": "2026-09-15", "rebate_rate": "4.1", "short_interest": 9_800_000,
         "short_shares_available": 10_000_000, "si_float": "0.0210", "si_float_with_synth_long_pct_of_total_shares": "0.0207",
         "symbol": TICKER, "total_float": 466_000_000},
        {"days_to_cover": "2.2", "fee_rate": "0.30", "market_date": "2026-08-31", "rebate_rate": "4.2", "short_interest": 9_100_000,
         "short_shares_available": 10_000_000, "si_float": "0.0195", "si_float_with_synth_long_pct_of_total_shares": "0.0192",
         "symbol": TICKER, "total_float": 466_000_000},
    ]}


def build_insiders():
    rows = []
    for i in range(8):
        rows.append({"avg_price": "%.2f" % (150.0 - i), "buy_sell": "sell" if i % 3 else "buy", "date": day(-5 - 11 * i),
                     "premium": "%d" % (400_000 + 50_000 * i), "transactions": 3 + i, "uniq_insiders": 1 + (i % 3),
                     "volume": 2_500 + 300 * i})
    return {"data": rows, "has_more": False}


def build_news():
    def item(offset_h, headline, tickers, sentiment, major, source):
        base = datetime.datetime.fromisoformat(NOW_DAY + "T14:00:00+00:00") - datetime.timedelta(hours=offset_h)
        return {"created_at": base.strftime("%Y-%m-%d %H:%M:%S+00:00"), "headline": headline, "is_major": major, "meta": {},
                "sentiment": sentiment, "source": source, "tags": ["earnings"], "tickers": tickers}
    return {"data": [
        item(2, "Example Technologies raises full-year guidance after strong cloud demand", [TICKER], "positive", True, "Reuters"),
        item(9, "Example Technologies announces a new data-centre region in Frankfurt", [TICKER, "OTHR"], "neutral", False, "BusinessWire"),
        item(20, "Analysts split on Example Technologies ahead of October earnings", [TICKER], "neutral", False, "Barron's"),
        item(30, "Unrelated Corp shares slide on supply concerns", ["OTHR"], "negative", False, "Reuters"),
        item(70, "Example Technologies faces a regulatory inquiry in the EU over bundling", [TICKER], "negative", True, "Financial Times"),
    ]}


def build_levels():
    rows = []
    for i in range(24):
        px = 118.0 + i * 0.5
        dark = int(40_000 * math.exp(-((i - 9) ** 2) / 18)) + 2_000
        regular = int(160_000 * math.exp(-((i - 11) ** 2) / 30)) + 5_000
        rows.append({"dark_pool_volume": dark, "price": "%.2f" % px, "regular_volume": regular})
    return {"data": rows, "date": "2026-10-01"}


def build_quote():
    return {"data": {"close": "127.40", "high": "128.10", "low": "125.90", "market_time": "market", "open": "126.20",
                     "prev_close": "125.80", "tape_time": "2026-10-02 14:29:40+00:00", "total_volume": 2_150_000, "volume": 800}}


BUILD = {
    "info": build_info, "profile": build_profile, "financials": build_financials, "breakdown": build_breakdown,
    "estimates": build_estimates, "analysts": build_analysts, "earnings": build_earnings, "ownership": build_ownership,
    "short": build_short, "insiders": build_insiders, "news": build_news, "levels": build_levels, "quote": build_quote,
}


def main():
    bodies = {}
    docs = {}
    problems = []
    for key, op in OPS.items():
        body = BUILD[key]()
        found = validate(op, body)
        problems.extend(found)
        bodies[key] = body
        docs[op] = sorted(documented(root_schema(op)))
    if problems:
        print("fixtures do not conform to the spec:", file=sys.stderr)
        for line in problems:
            print("  " + line, file=sys.stderr)
        sys.exit(1)
    out = {
        "provenance": {
            "generator": "tests/gen-dossier-fixtures.py",
            "spec": "docs/uw-openapi.yaml",
            "specSha256": hashlib.sha256(SPEC_BYTES).hexdigest(),
            "nature": "synthetic bodies for the fictional ticker " + TICKER + ", built to the 200-response schema of each operation "
                      "(names, JSON types and nullability checked against the spec by the generator); not vendor data",
            "nowDay": NOW_DAY,
        },
        "ticker": TICKER,
        "ops": OPS,
        "documented": docs,
        "bodies": bodies,
    }
    with open(OUT_PATH, "w") as handle:
        json.dump(out, handle, indent=1, sort_keys=True)
        handle.write("\n")
    print("wrote %s: %d operations, every body conforms" % (os.path.relpath(OUT_PATH, ROOT), len(OPS)))


if __name__ == "__main__":
    main()
