import hashlib
import json
import platform
import random
from datetime import date, timedelta
from decimal import Decimal, getcontext
from fractions import Fraction
from pathlib import Path

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-short.json"
WINDOW = 60
MIN_PRIOR = 40
LAST_DAY = date(2026, 10, 2)


def weekdays_back(n):
    out = []
    d = LAST_DAY
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return list(reversed(out))


def ratio_text(sv, tv):
    return f"{Decimal(sv) / Decimal(tv):.4f}"


def build(rng, n, shape):
    days = weekdays_back(n)
    rows = []
    base = rng.uniform(0.35, 0.55)
    for i, d in enumerate(days):
        tv = rng.randrange(200_000, 40_000_000)
        if shape == "constant":
            sv = int(tv * 0.5)
            tv = 2 * sv
        else:
            sv = int(tv * min(0.95, max(0.05, rng.gauss(base, 0.07))))
        row = {"market_date": d.isoformat(), "short_volume": sv, "total_volume": tv, "short_volume_ratio": ratio_text(sv, tv)}
        rows.append(row)
    if shape == "ratio-only-day":
        k = rng.randrange(max(0, n - 5), n)
        rows[k].pop("short_volume")
        rows[k].pop("total_volume")
    if shape == "zero-total-day":
        k = rng.randrange(max(0, n - 5), n)
        rows[k]["total_volume"] = 0
        rows[k]["short_volume"] = 0
        rows[k]["short_volume_ratio"] = "0.4500"
    if shape == "counts-only-day":
        k = rng.randrange(max(0, n - 5), n)
        rows[k].pop("short_volume_ratio")
    return rows


def number(row, key):
    v = row.get(key)
    return None if v is None else Fraction(str(v))


def daily(row):
    r = number(row, "short_volume_ratio")
    if r is not None:
        return r
    sv, tv = number(row, "short_volume"), number(row, "total_volume")
    if sv is not None and tv is not None and tv > 0:
        return sv / tv
    return None


def dec(f):
    return Decimal(f.numerator) / Decimal(f.denominator)


def expect(rows):
    rows = sorted(rows, key=lambda r: r["market_date"])
    latest = rows[-1]
    prior = [daily(r) for r in rows[:-1]][-WINDOW:]
    prior = [p for p in prior if p is not None]
    x = daily(latest)
    out = {"ratio": None if x is None else f"{dec(x):.20f}", "n": len(prior), "z": None, "mean60": None, "sd60": None, "reason": None}
    if x is None:
        out["reason"] = "absent"
    elif len(prior) < MIN_PRIOR:
        out["reason"] = "too_few"
    else:
        m = sum(prior, Fraction(0)) / len(prior)
        var = sum(((p - m) ** 2 for p in prior), Fraction(0)) / (len(prior) - 1)
        sd = dec(var).sqrt()
        out["mean60"] = f"{dec(m):.20f}"
        out["sd60"] = f"{sd:.20f}"
        if sd > 0:
            out["z"] = f"{(dec(x) - dec(m)) / sd:.20f}"
        else:
            out["reason"] = "degenerate"
    five = rows[-5:]
    if len(five) < 5:
        out.update({"ratio5": None, "ratio5Basis": None, "ratio5Why": "too_few"})
    elif all(number(r, "short_volume") is not None and number(r, "total_volume") is not None and number(r, "total_volume") > 0 for r in five):
        s = sum((number(r, "short_volume") for r in five), Fraction(0))
        t = sum((number(r, "total_volume") for r in five), Fraction(0))
        out.update({"ratio5": f"{dec(s / t):.20f}", "ratio5Basis": "pooled", "ratio5Why": None})
    elif all(daily(r) is not None for r in five):
        out.update({"ratio5": f"{dec(sum((daily(r) for r in five), Fraction(0)) / 5):.20f}", "ratio5Basis": "mean", "ratio5Why": None})
    else:
        out.update({"ratio5": None, "ratio5Basis": None, "ratio5Why": "too_few"})
    return out


def main():
    rng = random.Random(20261026)
    scenarios = []
    for i in range(70):
        shape = rng.choice(["plain", "plain", "plain", "ratio-only-day", "zero-total-day", "counts-only-day", "constant"])
        n = rng.choice([1, 2, 3, 4, 5, 6, 30, 41, 42, 45, 61, 70])
        rows = build(rng, n, shape)
        rng.shuffle(rows)
        scenarios.append({"name": f"{shape} over {n} days", "rows": rows, "expect": expect(rows)})
    thin = [
        {"market_date": "2026-09-28", "short_volume": 100, "total_volume": 1000, "short_volume_ratio": "0.10"},
        {"market_date": "2026-09-29", "short_volume": 9000, "total_volume": 10000, "short_volume_ratio": "0.90"},
        {"market_date": "2026-09-30", "short_volume": 100, "total_volume": 1000, "short_volume_ratio": "0.10"},
        {"market_date": "2026-10-01", "short_volume": 100, "total_volume": 1000, "short_volume_ratio": "0.10"},
        {"market_date": "2026-10-02", "short_volume": 100, "total_volume": 1000, "short_volume_ratio": "0.10"},
    ]
    scenarios.insert(0, {"name": "a heavy day among thin ones: pooled 9,400 of 14,000 is 0.6714, the mean of the five ratios is 0.26", "rows": thin, "expect": expect(thin)})
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-short-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "arithmetic": "fractions.Fraction for the sums and means, decimal.Decimal at 50 digits for the square root",
            "seed": 20261026,
            "synthetic": True,
        },
        "window": WINDOW,
        "min": MIN_PRIOR,
        "scenarios": scenarios,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    kinds = {}
    for s in scenarios:
        key = (s["expect"]["ratio5Basis"] or "none") + "/" + (s["expect"]["reason"] or "z")
        kinds[key] = kinds.get(key, 0) + 1
    print(len(scenarios), "scenarios", kinds)


main()
