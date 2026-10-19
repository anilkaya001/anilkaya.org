import hashlib
import json
import platform
import random
import sys
from fractions import Fraction as Fr
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-shortcall.json"


def half_up(x):
    return int((x + Fr(1, 2)) // 1)


def collateral(conv, S, K, d, h, f):
    if conv == "shares":
        return 100 * S, "shares"
    if conv == "regt":
        a = Fr(1, 5) * S - max(Fr(0), K - S)
        fl = Fr(1, 10) * S
        return 100 * max(a, fl), ("regt-otm" if a > fl else "floor")
    t = h * d
    return 100 * S * max(t, f), ("delta" if t > f else "floor")


def case(conv, S, K, d, h, f, bid, days, N, bp):
    s, k, dd, hh, ff, b = Fr(S), Fr(K), Fr(d), Fr(h), Fr(f), Fr(bid)
    m, binding = collateral(conv, s, k, dd, hh, ff)
    m1 = half_up(m * 100)
    bidc = half_up(b * 10000)
    intr = half_up(max(Fr(0), s - k) * 10000)
    tv = max(0, bidc - intr)
    out = {"in": {"convention": conv, "spot": S, "strike": K, "delta": d, "haircut": h, "floor": f, "bid": bid, "days": days, "contracts": N, "buyingPower": bp}}
    if m1 <= 0:
        out["out"] = {"ok": False, "why": "no-collateral"}
        return out
    n = N if bp is None else min(N, int(Fr(bp) * 100 // m1))
    out["out"] = {
        "ok": True, "binding": binding, "m1C": m1, "bidC": bidc, "intrC": intr, "tvC": tv, "n": n,
        "premiumC": n * bidc, "collateralC": n * m1,
        "idleC": None if bp is None else half_up(Fr(bp) * 100) - n * m1,
        "ratio": float(Fr(tv, m1)), "grossRatio": float(Fr(bidc, m1)),
        "annRatio": float(Fr(tv, m1) * 365 / days),
        "affordable": n >= 1, "limited": bp is not None and n < N,
    }
    return out


def dec(rng, lo, hi, places):
    q = 10 ** places
    return f"{rng.randint(int(lo * q), int(hi * q)) / q:.{places}f}"


def main():
    rng = random.Random(20261018)
    cases = []
    base = ("227.28", "230.00", "0.3603", "0.30", "0.10", "1.69", 3, 100, None)
    for conv in ("delta", "regt", "shares"):
        cases.append(case(conv, *base[:9]))
    cases.append(case("delta", "227.28", "230.00", "0.3603", "0.30", "0.10", "1.69", 3, 100, "400000"))
    cases.append(case("delta", "227.28", "230.00", "0.3603", "0.30", "0.10", "1.69", 3, 100, "25000"))
    cases.append(case("delta", "227.28", "250.00", "0.0700", "0.30", "0.10", "0.20", 3, 100, None))
    cases.append(case("delta", "227.28", "220.00", "0.6600", "0.30", "0.10", "8.60", 12, 100, None))
    cases.append(case("delta", "100.00", "110.00", "0.3333", "0.30", "0.10", "1.00", 10, 1, None))
    cases.append(case("delta", "100.00", "110.00", "0.3334", "0.30", "0.10", "1.00", 10, 1, None))
    cases.append(case("delta", "100.00", "110.00", "0.3333333", "0.30", "0.10", "1.00", 10, 1, None))
    cases.append(case("delta", "0.05", "0.05", "0.0000", "0.30", "0.10", "0.0100", 5, 1, None))
    cases.append(case("delta", "0.05", "0.05", "0.5000", "0.30", "0.10", "0.0100", 5, 1, None))
    cases.append(case("delta", "10.00", "10.00", "0.0000", "0.30", "0.00", "0.50", 5, 1, None))
    cases.append(case("delta", "10.00", "10.00", "1.0000", "1.00", "0.50", "0.50", 5, 1, None))
    cases.append(case("delta", "10.00", "10.00", "1.0000", "0.05", "0.00", "0.50", 5, 1, None))
    for i in range(12):
        S = Fr(rng.randint(1, 40)) / 100 + Fr(rng.randint(0, 3)) / 1000
        cases.append(case(rng.choice(["delta", "regt", "shares"]), f"{float(S):.3f}", f"{float(S):.3f}", f"{rng.randint(0, 10000) / 10000:.4f}", "0.30", "0.10", "0.0500", 7, rng.choice([1, 3, 100]), None))
    while len(cases) < 600:
        S = dec(rng, 0.5, 900, 2)
        K = dec(rng, float(S) * 0.7, float(S) * 1.4, 2)
        d = dec(rng, 0, 1, 4)
        h = rng.choice(["0.30", "0.20", "0.05", "0.5", "1.00", "0.25", "0.333"])
        f = rng.choice(["0.10", "0.05", "0.00", "0.50", "0.15", "0.075"])
        intr = max(0.0, float(S) - float(K))
        bid = f"{intr + rng.randint(1, 800) / 100:.2f}"
        days = rng.choice([1, 2, 3, 5, 7, 12, 30, 91, 180, 365])
        N = rng.choice([1, 2, 10, 50, 100, 1000, 100000])
        bp = rng.choice([None, None, "1000", "25000", "400000", "1000000.55"])
        cases.append(case(rng.choice(["delta", "delta", "regt", "shares"]), S, K, d, h, f, bid, days, N, bp))
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {"generator": "tests/gen-shortcall-fixtures.py", "generatorSha256": hashlib.sha256(script).hexdigest(), "python": platform.python_version(), "seed": 20261018, "arithmetic": "fractions.Fraction, round half up on exact ties", "synthetic": True},
        "cases": cases,
    }
    OUT.write_text(json.dumps(doc, indent=1) + "\n")
    print(len(cases), "cases", file=sys.stderr)


main()
