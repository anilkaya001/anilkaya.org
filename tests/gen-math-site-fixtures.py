import hashlib
import json
import math
import platform
import random
from decimal import ROUND_HALF_UP, Decimal, getcontext
from fractions import Fraction
from pathlib import Path

getcontext().prec = 50
HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-site.json"
F = Fraction
D = Decimal
BANDS = ["$1,001 - $15,000", "$15,001 - $50,000", "$50,001 - $100,000", "$100,001 - $250,000", "$250,001 - $500,000", "$500,001 - $1,000,000",
         "$1,000,001 - $5,000,000", "$5,000,001 - $25,000,000", "$25,000,001 - $50,000,000"]


def fl(x):
    return None if x is None else float(x)


def dec(x):
    return D(x.numerator) / D(x.denominator)


def half_up(x):
    return int((dec(x) if isinstance(x, Fraction) else x).quantize(D(1), rounding=ROUND_HALF_UP))


def conviction():
    out = []
    for fam in range(1, 5):
        for pos in range(0, fam + 1):
            for c in range(0, 6):
                for p in range(0, 21):
                    scores = [1] * pos + [-1] * (fam - pos)
                    total = sum(scores)
                    sign = 1 if total >= 0 else -1
                    agree = sum(1 for s in scores if s == sign)
                    value = F(45, 100) * F(agree, fam) + F(35, 100) * F(c, 5) + F(20, 100) * F(p, 20)
                    out.append([scores, c, p, half_up(100 * value), agree])
    return out


def scores(rng):
    scale = (D(1) + D("0.8")) / (D(1) - D("0.8"))
    scale = scale.ln() / 2 / 2
    out = []
    for _ in range(200):
        z = rng.randint(-40000, 40000) / 10000
        x = D(str(z)) * scale
        e = (2 * x).exp()
        v = 100 * (e - 1) / (e + 1)
        if abs(abs(v - v.to_integral_value(rounding=ROUND_HALF_UP)) - D("0.5")) < D("1e-9"):
            continue
        out.append([z, half_up(v)])
    return dict(scale=float(scale), cases=out)


def political(rng):
    rows = []
    for i in range(160):
        bl = rng.randint(1000, 5000000)
        bh = bl + rng.randint(0, 9000000)
        bought = (bl + bh) / 2
        sold = rng.choice([0, 0, rng.randint(1000, 12000000) / 2])
        open_bands = rng.choice([0, 0, 0, 1])
        filers = rng.randint(1, 9)
        row = dict(bought=bought, boughtLo=bl, boughtHi=bh, sold=sold, openBands=open_bands, filers=filers)
        b, s = F(str(bought)), F(str(sold))
        mid = b - s
        lo = F(bl) - 2 * s
        hi = F(bh) - s / 8
        share = mid / (b + s)
        if abs(abs(share) - F(1, 5)) < F(1, 10 ** 9) or lo == 0:
            continue
        state = "accF" if open_bands == 0 and lo > 0 else ("accM" if share >= F(1, 5) else ("redM" if share <= F(-1, 5) else "mix"))
        gross = dec(b + s)
        lag = rng.choice([None, rng.randint(-5, 80)])
        win = rng.choice([30, 45, 60])
        rows.append(dict(row=row, mid=fl(mid), lo=fl(lo), hi=fl(hi), state=state, weightUsd=float(gross.sqrt()), weightFil=float(filers + gross.sqrt() / 4000),
                         lag=lag, win=win, blind=None if lag is None else fl(min(F(1), max(F(0), F(lag, win))))))
    return dict(rows=rows, bands=BANDS)


def governor(rng):
    out = []
    B = dict(hardCap=900, minBatch=4, callsPerName=39, msPerName=6650, baselineCalls=6560, baselineMs=19 * 60000, deadlineMs=165 * 60000)
    for i in range(300):
        cap = rng.choice([860, 470, 100, 24, 3, 2000])
        backlog = rng.randint(0, 900)
        day = rng.choice([None, 60000, 100000000, 15000, rng.randint(8000, 70000)])
        so_far = rng.randint(0, 40000)
        seen = rng.choice([None, rng.randint(0, 60000)])
        elapsed = rng.randint(0, 170) * 60000
        d = day if day else 60000
        spent = max(so_far, seen or 0, B["baselineCalls"]) + F(B["baselineCalls"], 10)
        by_calls = math.floor((F(d) * F(85, 100) - spent) / B["callsPerName"])
        rem = max(B["baselineMs"] - elapsed, 0)
        by_time = math.floor((F(B["deadlineMs"]) * F(8, 10) - elapsed - rem) / B["msPerName"])
        limits = dict(cap=min(cap, B["hardCap"]), backlog=backlog, calls=max(0, by_calls), time=max(0, by_time))
        binding = "cap"
        for k in ["cap", "backlog", "calls", "time"]:
            if limits[k] < limits[binding]:
                binding = k
        n = limits[binding]
        out.append(dict(input=dict(cap=cap, backlog=backlog, dayLine=day, callsSoFar=so_far, dailySeen=seen, elapsedMs=elapsed),
                        limits=limits, binding=binding, n=n if n >= B["minBatch"] else 0))
    return out


def ncdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))


def b76(Fw, Dn, K, T, sigma, typ):
    nu = sigma * math.sqrt(T)
    d1 = math.log(Fw / K) / nu + nu / 2
    d2 = d1 - nu
    return Dn * (Fw * ncdf(d1) - K * ncdf(d2)) if typ == "C" else Dn * (K * ncdf(-d2) - Fw * ncdf(-d1))


def implied(Fw, Dn, K, T, price, typ):
    lo, hi = 1e-4, 6.0
    if not (b76(Fw, Dn, K, T, lo, typ) < price < b76(Fw, Dn, K, T, hi, typ)):
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if b76(Fw, Dn, K, T, mid, typ) < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def oracle(rng):
    out = []
    for i in range(140):
        Fw = rng.randint(3000, 40000) / 100
        T = rng.randint(14, 120) / 365
        Dn = math.exp(-0.04 * T)
        typ = rng.choice(["C", "P"])
        family = "long-call" if typ == "C" else rng.choice(["long-put", "short-put"])
        side = -1 if family == "short-put" else 1
        K = round(Fw * rng.uniform(0.85, 1.15), 0)
        iv = rng.randint(1500, 9000) / 10000
        model = b76(Fw, Dn, K, T, iv, typ)
        half = rng.choice([0.01, 0.03, 0.08, 0.3]) * max(model, 0.05)
        bid = round(max(model - half, 0.01), 2)
        ask = round(model + half, 2)
        mid = (bid + ask) / 2
        edge = rng.choice([-20.0, 0.0, 5.0, 14.99, 15.0, 22.5, 60.0, 140.0, 400.0])
        grade = rng.choice([1, 2, 3])
        n = rng.choice([5, 8, 12])
        dte = round(T * 365)
        leg = dict(type=typ, k=K, side=side, iv=iv, model=model, mid=mid, bid=bid, ask=ask, oi=rng.choice([3, 50, 900]), vol=rng.choice([0, 40]))
        struct = dict(id="s%d" % i, family=family, expiry="2026-12-18", dte=dte, grade=grade, legs=[leg], ev=dict(edge=edge, p=edge * 0.8),
                      prob=dict(popP=0.5), breakevens=[K], maxLoss=-100.0, maxProfit=250.0)
        block = dict(structures=[struct], expiries=[dict(expiry="2026-12-18", T=T, forward=dict(F=Fw, D=Dn), smile=dict(method="svi", n=n, checks=dict(ok=True)))],
                     facts=[], ideas=[])
        e = dict(skip=None)
        fair = model + side * edge / 100
        fair_iv = implied(Fw, Dn, K, T, fair, typ) if edge > 0 else None
        spread_cost = (ask - bid) * 100 / 2
        near = False
        if not (bid > 0 and ask >= bid and mid >= 0.05 and (ask - bid) < mid * 0.5):
            e["skip"] = "quote"
        elif not (leg["oi"] >= 10 or leg["vol"] >= 10):
            e["skip"] = "liquidity"
        elif not edge > 0:
            e["skip"] = "no-edge"
        elif fair_iv is None:
            e["skip"] = "fair-iv"
        else:
            ev = iv - fair_iv
            near = abs(abs(ev) - 0.02) < 1e-6 or (spread_cost > 0 and abs(edge / spread_cost - 1.5) < 1e-6) or abs((ev * 1e4) % 1 - 0.5) < 1e-3 or abs((fair_iv * 1e4) % 1 - 0.5) < 1e-3
            if not (abs(ev) >= 0.02 and edge >= 15 and spread_cost > 0 and edge / spread_cost >= 1.5):
                e["skip"] = "threshold"
            elif min(grade, 3 if n >= 8 else 2) < 2:
                e["skip"] = "grade"
            else:
                e.update(verdict="cheap" if side > 0 else "rich", fairIv=round(fair_iv, 4), edgeVol=round(ev, 4), edgeUsd=round(edge, 2),
                         grade=min(grade, 3 if n >= 8 else 2))
        if near:
            continue
        out.append(dict(card=dict(ticker="SYX%d" % (600 + i), engine=block), expect=e))
    return out


def main():
    rng = random.Random(20261112)
    body = dict(conviction=conviction(), scores=scores(rng), political=political(rng), governor=governor(rng), oracle=oracle(rng))
    body["provenance"] = dict(
        generator="tests/gen-math-site-fixtures.py",
        generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        python=platform.python_version(),
        oracle="fractions.Fraction and decimal.Decimal at 50 digits; the Oracle's fair volatility by 200 bisections of a Black-76 price written here with math.erfc; no production code is imported",
        nature="synthetic: every row and ticker is invented and seeded",
        seed=20261112,
    )
    OUT.write_text(json.dumps(body, separators=(",", ":")) + "\n")
    print(OUT.name, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
