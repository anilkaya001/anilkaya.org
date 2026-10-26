import hashlib
import json
import platform
import random
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-darkpool.json"
NAME_CAP = 12
MARKET_CAP = 30
VOID_SHOWN = 3
TICKERS = ["SYA101", "SYA102", "SYB201", "SYB202", "SYC301", "SYC302", "SYD401", "SYE501", "SYF601", "SYG701"]


def money(rng, big):
    cents = rng.randrange(10_000, 900_000_000) if big else rng.randrange(100, 5_000_000)
    return Decimal(cents) / 100


def stamp(rng):
    h, m, s = rng.randrange(13, 21), rng.randrange(0, 60), rng.randrange(0, 60)
    return f"2026-10-02T{h:02d}:{m:02d}:{s:02d}Z"


def print_row(rng, ticker, canceled, priced):
    prem = money(rng, rng.random() < 0.3)
    px = Decimal(rng.randrange(500, 90000)) / 100
    row = {
        "ticker": ticker,
        "executed_at": stamp(rng),
        "price": f"{px}",
        "size": int(prem / px) or 1,
        "nbbo_bid": f"{px - Decimal('0.01')}",
        "nbbo_ask": f"{px + Decimal('0.01')}",
    }
    if priced:
        row["premium"] = f"{prem:.2f}"
    if canceled is not None:
        row["canceled"] = canceled
    return row, (prem if priced else None)


def key_of(r):
    return (-(r["prem"]), r["at"], -r["size"])


def per_name(raw_rows):
    live, voided, unpriced, canceled = [], [], 0, 0
    for r in raw_rows:
        item = None if r.get("premium") is None else {"prem": Decimal(r["premium"]), "at": r["executed_at"], "size": r["size"]}
        if r.get("canceled") is True:
            canceled += 1
            if item:
                voided.append(item)
            continue
        if item is None:
            unpriced += 1
            continue
        live.append(item)
    live.sort(key=key_of)
    voided.sort(key=key_of)
    kept = live[:NAME_CAP]
    total = sum((k["prem"] for k in kept), Decimal(0))
    out = {
        "live": [f"{k['prem']:.2f}" for k in kept],
        "voided": [f"{v['prem']:.2f}" for v in voided[:VOID_SHOWN]],
        "seen": len(live),
        "shed": len(live) - len(kept),
        "canceled": canceled,
        "unpriced": unpriced,
        "total": f"{total:.2f}",
    }
    if kept and total > 0:
        ratio = Fraction(kept[0]["prem"]) / Fraction(total)
        out["topPct"] = int((Decimal(ratio.numerator) / Decimal(ratio.denominator) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    else:
        out["topPct"] = None
    return out


def market(raw_rows):
    live = []
    voided = 0
    for r in raw_rows:
        if r.get("canceled") is True:
            voided += 1
            continue
        live.append(Decimal(r["premium"]) if r.get("premium") is not None else None)
    ranked = sorted((p for p in live), key=lambda p: (p is None, -(p if p is not None else 0)))
    return {"top": [None if p is None else f"{p:.2f}" for p in ranked[:MARKET_CAP]], "seen": len(live), "canceled": voided}


def cross(raw_rows, limit):
    seen = {}
    live = 0
    voided = 0
    for r in raw_rows:
        if r.get("canceled") is True:
            voided += 1
            continue
        live += 1
        seen.setdefault(r["ticker"], live)
    return {"limit": limit, "population": live, "canceled": voided, "ranks": seen, "capped": (live + voided) >= limit}


def scenario(rng, index):
    n = rng.choice([0, 1, 2, 5, 11, 12, 13, 20, 40, 60])
    cancel_rate = rng.choice([0, 0, 0.1, 0.25, 0.6, 1])
    unpriced_rate = rng.choice([0, 0, 0.1])
    rows = []
    for _ in range(n):
        canceled = None if rng.random() < 0.3 else (rng.random() < cancel_rate)
        rows.append(print_row(rng, rng.choice(TICKERS), canceled, rng.random() >= unpriced_rate)[0])
    if rows and rng.random() < 0.5:
        j = max(range(len(rows)), key=lambda i: Decimal(rows[i].get("premium") or "0"))
        rows[j]["canceled"] = True
    rows.sort(key=lambda r: r["executed_at"], reverse=True)
    return {"name": f"scenario {index}", "rows": rows, "perName": per_name(rows), "market": market(rows), "cross": cross(rows, rng.choice([5, 20, 80, 500]))}


def ties():
    rows = []
    for ticker, prem, canceled in [("SYA101", "285.00", False), ("SYA101", "200.00", False), ("SYA102", "200.00", False), ("SYB201", "150.00", False),
                                   ("SYB202", "165.00", False), ("SYA102", "9999999.00", True)]:
        rows.append({"ticker": ticker, "executed_at": "2026-10-02T15:00:00Z", "price": "10.00", "size": 1, "premium": prem, "canceled": canceled})
    return {"name": "a canceled print larger than every live one, and a share that is a decimal tie (285 of 1000 is 28.5)", "rows": rows,
            "perName": per_name(rows), "market": market(rows), "cross": cross(rows, 100)}


def main():
    rng = random.Random(20261026)
    scenarios = [ties()] + [scenario(rng, i) for i in range(1, 60)]
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-darkpool-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "arithmetic": "decimal.Decimal and fractions.Fraction on the premium strings, no float",
            "seed": 20261026,
            "synthetic": True,
        },
        "scenarios": scenarios,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    withc = sum(1 for s in scenarios if s["perName"]["canceled"])
    print(len(scenarios), "scenarios", withc, "with canceled prints")


main()
