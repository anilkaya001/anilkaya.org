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
OUT_PATH = os.path.join(ROOT, "tests", "fixtures-positioning-vendor.json")

with open(SPEC_PATH, "rb") as handle:
    SPEC_BYTES = handle.read()
SPEC = yaml.safe_load(SPEC_BYTES)
COMPONENTS = SPEC["components"]["schemas"]
with open(SHAPES_PATH, "rb") as handle:
    SHAPES_BYTES = handle.read()
SHAPES = json.loads(SHAPES_BYTES)

SESSION = "2026-10-26"
Q_NOW = "2026-09-30"
Q_PRIOR = "2026-06-30"
Q_OLD = "2026-03-31"
SECTORS = ["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy",
           "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"]
OPS = {
    "inst-list": "/api/institutions",
    "inst-latest": "/api/institutions/latest_filings",
    "inst-holdings": "/api/institution/{name}/holdings",
    "inst-activity-v1": "/api/institution/{name}/activity",
    "inst-activity": "/api/institution/{name}/activity/v2",
    "inst-sectors": "/api/institution/{name}/sectors",
    "insider-sector": "/api/insider/{sector}/sector-flow",
    "insiders": "/api/insider/{ticker}",
    "insider-bs": "/api/stock/{ticker}/insider-buy-sells",
    "ftds": "/api/shorts/{ticker}/ftds",
    "short-venues": "/api/shorts/{ticker}/volumes-by-exchange",
    "cg-unusual": "/api/congress/unusual-trades",
    "cg-unusual-tickers": "/api/congress/unusual-trades/by-tickers",
    "cg-unusual-stats": "/api/congress/unusual-trades/stats",
    "cg-unusual-chart": "/api/congress/unusual-trades/chart-data",
    "cg-late": "/api/congress/late-reports",
    "cg-politicians": "/api/congress/politicians",
    "cg-trader": "/api/congress/congress-trader",
    "pp-disclosures": "/api/politician-portfolios/disclosures",
    "pp-people": "/api/politician-portfolios/people",
    "pp-recent": "/api/politician-portfolios/recent_trades",
    "pp-portfolio": "/api/politician-portfolios/{politician_id}",
    "pol-trades": "/api/politics/politician/trades",
    "fec-candidates": "/api/politics/fec/candidates",
    "fec-companies": "/api/politics/fec/companies",
    "fec-contributions": "/api/politics/fec/contributions",
}
UNSPECIFIED = {"pol-trades", "fec-candidates", "fec-companies", "fec-contributions"}
TAGS = ["committee_conflict", "first_person_to_trade", "low_marketcap", "unusual_industry", "unusually_large_trade",
        "fec_donation_conflict"]
EXCHANGES = ["NYSE", "Nasdaq", "Cboe BZX", "Cboe BYX", "Cboe EDGX", "Cboe EDGA", "IEX", "MEMX", "NYSE Arca",
             "NYSE American", "NYSE Chicago", "NYSE National", "FINRA ADF", "Nasdaq BX"]
TXN = ["Buy", "Sell (partial)", "Purchase", "Sale (Partial)", "Sale (Full)", "Sell", "Exchange", "Receive"]
BANDS = ["$1,001 - $15,000", "$15,001 - $50,000", "$50,001 - $100,000", "$100,001 - $250,000",
         "$250,001 - $500,000", "$500,001 - $1,000,000"]
FIRST = ["Fixture", "Sample"]
MID = ["Harbor", "Meridian", "Summit", "Cedar", "Granite", "Lantern", "Orchard", "Beacon", "Willow", "Anchor"]
LAST = ["Capital LP", "Partners LLC", "Asset Management", "Advisors Inc", "Holdings LP", "Investments Ltd"]
MEMBERS = ["Fixture Member Alpha", "Fixture Member Bravo", "Fixture Member Charlie", "Fixture Member Delta",
           "Fixture Member Echo", "Fixture Member Foxtrot", "Fixture Member Golf", "Fixture Member Hotel"]


def deref(schema):
    while isinstance(schema, dict) and "$ref" in schema:
        schema = COMPONENTS[schema["$ref"].split("/")[-1]]
    return schema


def item_schema(op):
    response = SPEC["paths"][op]["get"]["responses"]["200"]
    schema = deref(response["content"]["application/json"]["schema"])
    if isinstance(schema, dict) and schema.get("type") == "array":
        return deref(schema.get("items", {}))
    props = (schema or {}).get("properties", {}) if isinstance(schema, dict) else {}
    if "data" in props:
        data = deref(props["data"])
        if isinstance(data, dict) and data.get("type") == "array":
            return deref(data.get("items", {}))
    return schema


def check_row(op_id, row, problems):
    if op_id in UNSPECIFIED or op_id in ("cg-unusual-stats", "cg-unusual-chart", "pp-portfolio"):
        return
    schema = item_schema(OPS[op_id])
    props = (schema or {}).get("properties", {}) if isinstance(schema, dict) else {}
    if not props:
        return
    for key, value in row.items():
        if key not in props:
            problems.append(f"{op_id}: {key} is not documented")
            continue
        want = deref(props[key]).get("type") if isinstance(deref(props[key]), dict) else None
        nullable = isinstance(deref(props[key]), dict) and deref(props[key]).get("nullable")
        if value is None:
            if not nullable and want not in (None, "date"):
                problems.append(f"{op_id}.{key}: null where the spec is not nullable")
            continue
        ok = {
            "string": isinstance(value, str), "integer": isinstance(value, int) and not isinstance(value, bool),
            "boolean": isinstance(value, bool), "number": isinstance(value, (int, float)) and not isinstance(value, bool),
            "array": isinstance(value, list), "object": isinstance(value, dict), "date": isinstance(value, str),
            None: True,
        }.get(want, True)
        if not ok:
            problems.append(f"{op_id}.{key}: {type(value).__name__} where the spec says {want}")


def shape_keys(op):
    entry = SHAPES.get("ops", {}).get(op)
    if not entry:
        return None
    keys = set()
    for fields in entry.get("sets", {}).values():
        keys.update(fields.keys())
    return keys


def add_days(day, n):
    d = datetime.date.fromisoformat(day) + datetime.timedelta(days=n)
    return d.isoformat()


def weekdays_back(day, n):
    out = []
    d = datetime.date.fromisoformat(day)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= datetime.timedelta(days=1)
    return out


def build():
    rng = random.Random(20261026)
    problems = []
    ops = {}

    filers = []
    for i in range(70):
        filers.append({
            "cik": str(9000001 + i),
            "name": f"{FIRST[i % 2]} {MID[i % 10]} {LAST[(i // 10) % 6]} {i + 1:02d}",
            "short_name": f"{MID[i % 10]} {i + 1:02d}",
            "hf": i % 2 == 0,
            "total": int((900 - i * 9) * 1e9 / 10) * 10,
        })
    notfiled = {filers[11]["name"], filers[13]["name"], filers[15]["name"], filers[17]["name"], filers[19]["name"]}
    unread = {filers[21]["name"], filers[23]["name"], filers[25]["name"]}

    inst_rows = []
    for f in filers:
        filed_new = f["name"] not in notfiled
        inst_rows.append({
            "buy_value": str(int(f["total"] * 0.04)), "call_value": str(int(f["total"] * 0.02)),
            "cik": f["cik"], "date": Q_NOW if filed_new else Q_PRIOR,
            "filing_date": "2026-10-14" if filed_new else "2026-08-12", "is_hedge_fund": f["hf"],
            "name": f["name"], "put_value": str(int(f["total"] * 0.01)), "sell_value": str(int(f["total"] * 0.03)),
            "share_value": str(int(f["total"] * 0.9)), "short_name": f["short_name"], "total_value": str(f["total"]),
        })
    ops["inst-list"] = {"body": {"data": inst_rows}}
    latest = []
    for f, row in zip(filers, inst_rows):
        latest.append({"cik": f["cik"], "filing_date": row["filing_date"], "is_hedge_fund": f["hf"],
                       "name": f["name"], "short_name": f["short_name"]})
    latest.sort(key=lambda r: r["filing_date"], reverse=True)
    ops["inst-latest"] = {"body": {"data": latest[:50]}}

    universe = []
    for i in range(40):
        universe.append({"t": f"SYX{101 + i}", "sec": SECTORS[i % 11]})

    sectors_by = {}
    holdings_by = {}
    activity_by = {}
    activity_v1_by = {}
    for fi, f in enumerate(filers):
        name = f["name"]
        if name in unread:
            sectors_by[name] = {"data": []}
            continue
        base = {s: rng.randint(20, 400) * 10_000_000 for s in SECTORS}
        for s in rng.sample(SECTORS, 2):
            base[s] = 0
        rows = []
        quarters = [Q_PRIOR, Q_OLD] if name in notfiled else [Q_NOW, Q_PRIOR]
        for qi, q in enumerate(quarters):
            for s in SECTORS:
                v = base[s]
                if v == 0 and not (s == "Energy" and qi == 1):
                    continue
                if qi == 0 and name not in notfiled:
                    if s == "Technology" and f["hf"]:
                        v = int(v * 1.2)
                    if s == "Energy":
                        v = int(v * 0.8)
                if qi == 1 and s == "Energy" and base[s] == 0:
                    v = 5_000_000
                pos = rng.randint(5, 60)
                inc = rng.randint(0, pos // 2)
                dec = rng.randint(0, pos // 2)
                rows.append({"positions": pos, "positions_closed": rng.randint(0, 5), "positions_decreased": dec,
                             "positions_increased": inc, "report_date": q, "sector": s, "value": v})
        sectors_by[name] = {"data": rows}
        hold = []
        act = []
        for k in range(8):
            u = universe[(fi + k) % 40]
            hold.append({"avg_price": "101.25", "close": "110.40", "date": Q_NOW, "first_buy": Q_OLD,
                         "full_name": "Fixture Issuer", "perc_of_share_value": round(8.0 - k, 2),
                         "perc_of_total": round(7.0 - k, 2), "price_first_buy": "90.10", "put_call": "",
                         "sector": u["sec"], "security_type": "Share", "shares_outstanding": "1000000000",
                         "ticker": u["t"], "units": 1_000_000 * (9 - k), "units_change": (-1) ** k * 200_000 * (k + 1),
                         "value": 110_000_000 * (9 - k)})
            px = None if (fi + k) % 13 == 0 else str(round(50 + 7.5 * ((fi + k) % 11), 2))
            row = {"avg_price": "101.25", "buy_price": "99.10", "close": "110.40", "filing_date": "2026-10-14",
                   "price_on_filing": "108.00", "put_call": "", "report_date": Q_NOW,
                   "sell_price": "112.00", "security_type": "Share", "shares_outstanding": "1000000000",
                   "ticker": u["t"], "units": 1_000_000 * (9 - k), "units_change": (-1) ** k * 200_000 * (k + 1)}
            if px is not None:
                row["price_on_report"] = px
            act.append(row)
        holdings_by[name] = {"data": hold}
        activity_by[name] = {"data": act}
        activity_v1_by[name] = {"data": act}
    ops["inst-sectors"] = {"byName": sectors_by}
    ops["inst-holdings"] = {"byName": holdings_by}
    ops["inst-activity"] = {"byName": activity_by}
    ops["inst-activity-v1"] = {"byName": activity_v1_by}

    dates = weekdays_back(add_days(SESSION, -1), 62)
    by_sector = {}
    for si, s in enumerate(SECTORS):
        rows = []
        for di, d in enumerate(dates):
            if s == "Utilities" and di in (3, 4, 5):
                continue
            for side in ("buy", "sell"):
                n = rng.randint(1, 9) + (3 if (side == "buy") == (si % 2 == 0) else 0)
                rows.append({"avg_price": "41.20", "buy_sell": side, "date": d, "has_more": False,
                             "premium": "1250000.00", "transactions": n + rng.randint(0, 3),
                             "uniq_insiders": n, "volume": n * 1500})
        by_sector[s] = {"data": rows}
    ops["insider-sector"] = {"bySector": by_sector}

    ins_by = {}
    ibs_by = {}
    ftd_by = {}
    ven_by = {}
    for ui, u in enumerate(universe):
        t = u["t"]
        ins_by[t] = {"data": [{"cik": "1000" + str(ui), "id": ui, "is_person": j % 3 != 0, "logo_url": "",
                               "name": f"Fixture Insider {ui}-{j}", "name_slug": f"fixture-insider-{ui}-{j}",
                               "social_links": [], "ticker": t} for j in range(5)]}
        ibs_by[t] = {"data": [{"filing_date": d, "purchases": rng.randint(0, 6), "purchases_notional": "250000",
                               "sells": rng.randint(0, 9), "sells_notional": "900000"}
                              for d in weekdays_back("2026-10-23", 12)]}
        fd = weekdays_back("2026-10-09", 20)
        rows = []
        for di, d in enumerate(fd):
            heavy = ui % 7 == 0 and di == 0
            q = 4_000_000 if heavy else rng.randint(1000, 90_000)
            row = {"date": d, "quantity": str(q)}
            if not (ui == 5 and di == 0):
                row["price"] = str(round(20 + ui * 1.5, 2))
            rows.append(row)
        ftd_by[t] = {"data": rows}
        vrows = []
        for d in (weekdays_back(SESSION, 10) if ui < 22 else []):
            for xi, x in enumerate(EXCHANGES):
                total = rng.randint(50_000, 900_000) // (xi + 1)
                vrows.append({"date": d, "exchange_name": x, "market_center": chr(65 + xi),
                              "short_volume": int(total * rng.uniform(0.3, 0.6)), "total_volume": total})
        if vrows:
            ven_by[t] = {"data": vrows}
    ops["insiders"] = {"byTicker": ins_by}
    ops["insider-bs"] = {"byTicker": ibs_by}
    ops["ftds"] = {"byTicker": ftd_by}
    ops["short-venues"] = {"byTicker": ven_by}

    pid = {m: f"00000000-0000-4000-8000-0000000000{i:02d}" for i, m in enumerate(MEMBERS)}
    lags = [30, 45, 46, 400, 52, 61, 20, 47]
    late_rows = []
    for i in range(24):
        lag = lags[i % len(lags)]
        traded = add_days("2025-06-01" if lag == 400 else "2026-09-01", -(i * 3))
        m = MEMBERS[i % len(MEMBERS)]
        u = universe[i % 40]
        late_rows.append({"amounts": BANDS[i % len(BANDS)], "filed_at_date": add_days(traded, lag), "is_active": "true",
                          "issuer": "Fixture Issuer", "member_type": i % 2 == 0, "name": m, "notes": "",
                          "politician_id": pid[m], "reporter": m, "ticker": u["t"], "transaction_date": traded,
                          "txn_type": TXN[i % len(TXN)]})
    late_rows.append({"amounts": BANDS[0], "filed_at_date": "2020-01-10", "is_active": "true", "issuer": "Fixture Issuer",
                      "member_type": True, "name": MEMBERS[0], "notes": "", "politician_id": pid[MEMBERS[0]],
                      "reporter": MEMBERS[0], "ticker": universe[3]["t"], "transaction_date": "2019-11-01", "txn_type": "Buy"})
    ops["cg-late"] = {"body": {"data": late_rows}}
    ops["cg-trader"] = {"byName": {m: {"data": [dict(r) for r in late_rows if r["name"] == m]} for m in MEMBERS[:6]}}
    ops["cg-politicians"] = {"body": {"data": [{"amounts": "", "filed_at_date": "", "is_active": "true", "issuer": "",
                                                "member_type": i % 2 == 0, "name": m, "notes": "", "politician_id": pid[m],
                                                "reporter": m, "ticker": "", "transaction_date": "", "txn_type": "Buy"}
                                               for i, m in enumerate(MEMBERS)]}}
    unusual = []
    for i in range(14):
        m = MEMBERS[i % len(MEMBERS)]
        u = universe[(i * 3) % 40]
        traded = add_days("2026-09-10", -i)
        unusual.append({"amount": BANDS[i % len(BANDS)], "asset": "Fixture Issuer", "asset_type": "Stock",
                        "company_name": "Fixture Issuer", "filing_date": add_days(traded, 20 + i),
                        "id": f"10000000-0000-4000-8000-0000000000{i:02d}", "politician_id": pid[m],
                        "politician_name": m, "ticker": u["t"], "transaction_date": traded,
                        "transaction_type": "Purchase" if i % 3 else "Sale (Full)",
                        "unusual_activity_meta": [],
                        "unusual_activity_tags": ([TAGS[i % 6]] if i % 5 else [TAGS[i % 6], "planted_unknown_tag"])})
    ops["cg-unusual"] = {"body": {"data": unusual}}
    ops["cg-unusual-tickers"] = {"body": {"data": unusual[:6]}}
    ops["cg-unusual-stats"] = {"body": {"data": {"top_tickers": [{"ticker": u["t"], "count": 9 - i}
                                                               for i, u in enumerate(universe[:5])],
                                                  "industries": [{"industry": s, "count": 11 - i}
                                                                 for i, s in enumerate(SECTORS[:4])]},
                                         "date": SESSION, "type": "stats"}}
    spy = [{"close": round(500 + i * 0.7, 2), "date": d} for i, d in enumerate(reversed(weekdays_back(SESSION, 60)))]
    trades = []
    for i, r in enumerate(unusual):
        trades.append({"amount": r["amount"], "asset_type": "Stock", "company_name": "Fixture Issuer",
                       "filing_date": r["filing_date"], "id": r["id"], "is_unusual": True,
                       "mid_value": 8000.0, "politician_name": r["politician_name"],
                       "price_at_trade": None if i == 4 else (-1.0 if i == 6 else round(40 + i * 3.1, 2)),
                       "price_current": round(44 + i * 3.3, 2), "sector": SECTORS[i % 11], "ticker": r["ticker"],
                       "transaction_date": r["transaction_date"], "transaction_type": r["transaction_type"],
                       "unusual_activity_tags": r["unusual_activity_tags"]})
    ops["cg-unusual-chart"] = {"body": {"spy_prices": spy, "trades": trades}}

    ops["pp-disclosures"] = {"body": {"data": [{"chamber": "house" if i % 2 == 0 else "senate", "disclosure_year": 2026,
                                                "filing_date": "2026-08-14", "id": f"20000000-0000-4000-8000-0000000000{i:02d}",
                                                "name": m, "politician_id": pid[m], "politician_name": m,
                                                "url": "https://example.test/f.pdf", "version": 1}
                                               for i, m in enumerate(MEMBERS)]}}
    ops["pp-people"] = {"body": {"data": [{"id": pid[m], "name": m} for m in MEMBERS]}}
    ops["pp-recent"] = {"body": {"data": [dict(r) for r in late_rows[:10]]}}
    ops["pp-portfolio"] = {"byId": {pid[m]: {"data": [{"id": f"30000000-0000-4000-8000-0000000000{i:02d}", "owner": "self",
                                                          "last_annual_disclosure": 2025, "crypto_holdings": [],
                                                          "option_holdings": [],
                                                          "stock_holdings": [{"ticker": universe[(i + j) % 40]["t"], "units": 100 * (j + 1)}
                                                                             for j in range(4)]}]}
                                    for i, m in enumerate(MEMBERS[:6])}}
    ops["pol-trades"] = {"body": {"data": [dict(r) for r in late_rows[:10]]}}
    ops["fec-candidates"] = {"body": {"data": [{"candidate_id": f"C{i:05d}", "cycle": 2026} for i in range(60)],
                                       "total": 60}}
    ops["fec-companies"] = {"body": {"data": [{"ticker": universe[i]["t"], "cycle": 2026, "pac_total": 250000 + i * 1000,
                                               "pac_count": 3 + i % 4, "pac_contribution_count": 40 + i,
                                               "dem_total": 100000 + i * 300, "rep_total": 120000 + i * 400,
                                               "other_total": 30000, "lobbying_total": 1500000 + i * 5000,
                                               "employee_total_estimated": 80000 + i * 100} for i in range(20)]}}
    ops["fec-contributions"] = {"byTicker": {universe[i]["t"]: {"data": [{"ticker": universe[i]["t"], "candidate_id": f"C{k:05d}",
                                                                          "tier": "pac", "amount": 1000 * (k + 1)}
                                                                         for k in range(3)], "total_amount": 6000}
                                              for i in range(12)}}

    for op_id, entry in ops.items():
        entry["op"] = OPS[op_id]
        entry["observed"] = False
        entry["unspecified"] = op_id in UNSPECIFIED
        bodies = []
        if "body" in entry:
            bodies.append(entry["body"])
        for k in ("byName", "byTicker", "bySector", "byId"):
            if k in entry:
                bodies.extend(entry[k].values())
        observed = shape_keys(OPS[op_id])
        for b in bodies:
            rows = b.get("data", []) if isinstance(b, dict) else []
            if isinstance(rows, list):
                for r in rows:
                    check_row(op_id, r, problems)
                    if observed is not None:
                        for key in r:
                            if key not in observed:
                                problems.append(f"{op_id}: {key} was not on the wire")
    world = {"sessionDate": SESSION, "quarters": {"now": Q_NOW, "prior": Q_PRIOR}, "sectors": SECTORS,
             "universe": universe, "notFiled": sorted(notfiled), "unread": sorted(unread), "members": MEMBERS}
    out = {
        "provenance": {
            "generator": "tests/gen-positioning-fixtures.py",
            "nature": "synthetic, not observed on the wire",
            "specSha256": hashlib.sha256(SPEC_BYTES).hexdigest(),
            "shapesSha256": hashlib.sha256(SHAPES_BYTES).hexdigest(),
        },
        "world": world,
        "ops": ops,
    }
    return out, problems


def main():
    out, problems = build()
    if problems:
        for p in problems[:40]:
            print("FAIL " + p, file=sys.stderr)
        sys.exit(1)
    with open(OUT_PATH, "w") as handle:
        json.dump(out, handle, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")


if __name__ == "__main__":
    main()
