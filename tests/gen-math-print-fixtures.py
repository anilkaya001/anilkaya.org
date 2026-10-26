import hashlib
import json
import platform
import random
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-print.json"
STEP = Fraction(1, 10000)


def frac(s):
    return None if s is None else Fraction(s)


def off_grid(x):
    return x is not None and (x * 1_000_000).denominator != 1


def classify(price, bid, ask):
    p, b, a = frac(price), frac(bid), frac(ask)
    if off_grid(p) or off_grid(b) or off_grid(a):
        return "n", "off-grid"
    if p is None or p <= 0:
        return "n", "no-price"
    if b is None or a is None or b < 0:
        return "n", "no-quote"
    if a <= 0:
        return "n", "no-offer"
    if a < b:
        return "n", "crossed"
    if a == b and p == a:
        return "n", "locked"
    if 2 * p == a + b:
        return "m", None
    if p >= a:
        return "A", None
    if p <= b:
        return "B", None
    return ("a" if 2 * p > a + b else "b"), None


def text(x):
    q = x / STEP
    assert q.denominator == 1
    n = int(q)
    whole, frac_part = divmod(n, 10000)
    return f"{whole}.{frac_part:04d}".rstrip("0").rstrip(".") if frac_part else f"{whole}.00"


def row(price, bid, ask):
    tier, why = classify(price, bid, ask)
    return [price, bid, ask, tier, why]


def main():
    rng = random.Random(20261026)
    hand = [
        ("1.12", "1.00", "1.10"), ("1.10", "1.00", "1.10"), ("1.09", "1.00", "1.10"), ("1.06", "1.00", "1.10"),
        ("1.05", "1.00", "1.10"), ("1.04", "1.00", "1.10"), ("1.01", "1.00", "1.10"), ("1.00", "1.00", "1.10"),
        ("0.95", "1.00", "1.10"),
        ("1.00", "1.00", "1.00"), ("1.01", "1.00", "1.00"), ("0.99", "1.00", "1.00"),
        ("0.05", "0.00", "0.05"), ("0.025", "0.00", "0.05"), ("0.01", "0.00", "0.05"), ("0.06", "0.00", "0.05"),
        ("0.01", "0.00", "0.00"), ("0.00", "0.00", "0.05"),
        ("0.15", "0.10", "0.20"), ("0.1500", "0.1000", "0.2000"), ("0.075", "0.07", "0.08"), ("0.2", "0.1", "0.3"),
        ("1.00", "1.10", "1.00"), ("1.05", "1.10", "1.00"),
        ("1.0500", "1.0499", "1.0501"), ("1.0499", "1.0499", "1.0501"), ("1.0501", "1.0499", "1.0501"),
        ("1.0499", "1.0498", "1.0500"), ("1.0500", "1.0498", "1.0500"), ("1.0499", "1.0499", "1.0499"),
        ("9999.9999", "9999.9998", "9999.9999"), ("0.0001", "0.0000", "0.0001"), ("0.0001", "0.0001", "0.0001"),
        ("1.0000005", "1.00", "1.10"), ("1.05", "1.0499995", "1.0500005"), ("1.050000", "1.000000", "1.100000"), ("1.0000001", "1.0000001", "1.0000001"),
        (None, "1", "2"), ("1.5", None, "2"), ("1.5", "1", None), ("0", "1", "2"), ("-1", "1", "2"), ("1.5", "-1", "2"),
        ("1.5", "1", "0"), (None, None, None),
    ]
    rows = [row(*h) for h in hand]
    quotes = [("0.00", "0.05"), ("0.00", "0.01"), ("0.01", "0.02"), ("0.05", "0.10"), ("0.95", "1.00"), ("1.00", "1.00"),
              ("1.00", "1.10"), ("2.50", "2.55"), ("2.50", "2.50"), ("10.00", "10.40"), ("125.10", "125.60"), ("0.0001", "0.0002")]
    for bid, ask in quotes:
        b, a = Fraction(bid), Fraction(ask)
        mid = (a + b) / 2
        marks = set()
        for centre in (b, a, mid):
            base = int(centre / STEP)
            for d in range(-4, 5):
                marks.add(base + d)
        low, high = max(1, int(b / STEP) - 6), int(a / STEP) + 6
        stride = max(1, (high - low) // 60)
        marks.update(range(low, high + 1, stride))
        for m in sorted(marks):
            if m >= 1:
                rows.append(row(text(m * STEP), bid, ask))
    for _ in range(6000):
        scale = rng.choice([1, 10, 100, 1000, 10000])
        b = Fraction(rng.randrange(0, 4000), 10000) * scale if rng.random() > 0.08 else Fraction(0)
        width = Fraction(rng.choice([0, 0, 1, 1, 2, 3, 5, 10, 25, 100, 400]), 10000) * (scale if rng.random() > 0.5 else 1)
        a = b + width if rng.random() > 0.03 else b - width
        spread = a - b
        p = b + spread * Fraction(rng.randrange(-30, 131), 100)
        p = (p / STEP).__floor__() * STEP if rng.random() > 0.5 else (p / STEP).__ceil__() * STEP
        if b < 0 or a < 0 or p < 0:
            continue
        rows.append(row(text(p), text(b), text(a)))
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-print-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "arithmetic": "fractions.Fraction on the decimal strings, no float",
            "seed": 20261026,
            "row": ["price", "bid", "ask", "tier", "why"],
            "synthetic": True,
        },
        "rows": rows,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    counts = {}
    for r in rows:
        key = r[3] + ("/" + r[4] if r[4] else "")
        counts[key] = counts.get(key, 0) + 1
    print(len(rows), "rows", counts)


main()
