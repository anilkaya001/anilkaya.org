import hashlib
import json
import platform
import random
from pathlib import Path

import mpmath as mp

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-dealer.json"
mp.mp.dps = 50
SEED = 20261026


def N(x):
    return mp.ncdf(x)


def phi(x):
    return mp.npdf(x)


def d1d2(S, K, r, q, sigma, T):
    nu = sigma * mp.sqrt(T)
    d1 = (mp.log(S / K) + (r - q + sigma * sigma / 2) * T) / nu
    return d1, d1 - nu


def price(S, K, r, q, sigma, T, kind):
    d1, d2 = d1d2(S, K, r, q, sigma, T)
    if kind == "C":
        return S * mp.exp(-q * T) * N(d1) - K * mp.exp(-r * T) * N(d2)
    return K * mp.exp(-r * T) * N(-d2) - S * mp.exp(-q * T) * N(-d1)


def delta_fd(S, K, r, q, sigma, T, kind):
    h = S * mp.mpf(10) ** -12
    return (price(S + h, K, r, q, sigma, T, kind) - price(S - h, K, r, q, sigma, T, kind)) / (2 * h)


def closed(S, K, r, q, sigma, T, kind):
    d1, d2 = d1d2(S, K, r, q, sigma, T)
    nu = sigma * mp.sqrt(T)
    eq = mp.exp(-q * T)
    gamma = eq * phi(d1) / (S * nu)
    vanna = -eq * phi(d1) * d2 / sigma
    base = -eq * phi(d1) * (2 * (r - q) * T - d2 * nu) / (2 * T * nu)
    charm = q * eq * N(d1) + base if kind == "C" else -q * eq * N(-d1) + base
    delta = eq * N(d1) if kind == "C" else -eq * N(-d1)
    return {"delta": delta, "gamma": gamma, "vanna": vanna, "charm": charm}


def finite_difference(S, K, r, q, sigma, T, kind):
    h = S * mp.mpf(10) ** -10
    gamma = (price(S + h, K, r, q, sigma, T, kind) - 2 * price(S, K, r, q, sigma, T, kind) + price(S - h, K, r, q, sigma, T, kind)) / (h * h)
    hv = mp.mpf(10) ** -10
    vanna = (delta_fd(S, K, r, q, sigma + hv, T, kind) - delta_fd(S, K, r, q, sigma - hv, T, kind)) / (2 * hv)
    ht = T * mp.mpf(10) ** -8
    charm = -(delta_fd(S, K, r, q, sigma, T + ht, kind) - delta_fd(S, K, r, q, sigma, T - ht, kind)) / (2 * ht)
    return {"gamma": gamma, "vanna": vanna, "charm": charm}


def s17(x):
    return mp.nstr(x, 17)


def greek_cases(rng):
    cases = []
    spots = ["250", "37.5", "1450", "8.25", "612.34"]
    expiries = [mp.mpf(1) / 365, mp.mpf(7) / 365, mp.mpf(30) / 365, mp.mpf(91) / 365, mp.mpf(1) / 2, mp.mpf(2)]
    for S in spots:
        for T in expiries:
            for kind in ("C", "P"):
                moneyness = rng.choice(["0.8", "0.92", "0.98", "1", "1.03", "1.1", "1.25"])
                sigma = rng.choice(["0.15", "0.28", "0.45", "0.8", "1.2"])
                r = rng.choice(["0", "0.045"])
                q = rng.choice(["0", "0.012"])
                s_, k_ = mp.mpf(S), mp.mpf(S) * mp.mpf(moneyness)
                sg, rr, qq = mp.mpf(sigma), mp.mpf(r), mp.mpf(q)
                c = closed(s_, k_, rr, qq, sg, T, kind)
                f = finite_difference(s_, k_, rr, qq, sg, T, kind)
                for name in ("gamma", "vanna", "charm"):
                    if abs(c[name] - f[name]) > mp.mpf(10) ** -6 * max(abs(c[name]), mp.mpf(10) ** -9):
                        raise SystemExit("closed form and finite difference disagree: " + name + " " + str((S, moneyness, sigma, T, kind)))
                atm = closed(s_, s_, rr, qq, sg, T, kind)
                cases.append({
                    "S": S, "K": s17(k_), "r": r, "q": q, "sigma": sigma, "Tdays": s17(T * 365), "type": kind,
                    "closed": {k: s17(v) for k, v in c.items()},
                    "atm": {k: s17(abs(v)) for k, v in atm.items()},
                    "fd": {k: s17(v) for k, v in f.items()},
                })
    for S, K, r, q, sigma, T, kind in [
        ("250", "250", "0.045", "0.012", "0.28", mp.mpf(1) / (365 * 24), "C"),
        ("250", "250", "0.045", "0.012", "0.28", mp.mpf(1) / (365 * 24), "P"),
        ("37.5", "36", "0", "0", "0.05", mp.mpf(30) / 365, "C"),
        ("612.34", "400", "0.045", "0.012", "0.3", mp.mpf(91) / 365, "C"),
        ("612.34", "900", "0.045", "0.012", "0.3", mp.mpf(91) / 365, "P"),
        ("8.25", "8.25", "0", "0", "0.9", mp.mpf(2) / 365, "P"),
    ]:
        s_, k_, rr, qq, sg = mp.mpf(S), mp.mpf(K), mp.mpf(r), mp.mpf(q), mp.mpf(sigma)
        c = closed(s_, k_, rr, qq, sg, T, kind)
        atm = closed(s_, s_, rr, qq, sg, T, kind)
        cases.append({
            "S": S, "K": s17(k_), "r": r, "q": q, "sigma": sigma, "Tdays": s17(T * 365), "type": kind,
            "closed": {k: s17(v) for k, v in c.items()},
            "atm": {k: s17(abs(v)) for k, v in atm.items()},
            "fd": None,
        })
    return cases


def contract_set(rng, S, expiries, strikes_per, call_peak, put_peak, put_peak2=None):
    contracts = []
    for T in expiries:
        for j in range(strikes_per):
            moneyness = mp.mpf("0.82") + mp.mpf("0.36") * j / (strikes_per - 1)
            K = mp.nint(S * moneyness * 4) / 4
            atm = mp.mpf(rng.choice(["0.22", "0.31", "0.4"]))
            sigma = atm * (1 + mp.mpf("0.9") * (1 - moneyness) ** 2 - mp.mpf("0.25") * (1 - moneyness))
            for kind in ("C", "P"):
                peak = call_peak if kind == "C" else put_peak
                weight = mp.exp(-((moneyness - peak[0]) / peak[1]) ** 2) * peak[2]
                if kind == "P" and put_peak2 is not None:
                    weight += mp.exp(-((moneyness - put_peak2[0]) / put_peak2[1]) ** 2) * put_peak2[2]
                oi = int(weight * (mp.mpf("0.8") + mp.mpf(rng.random()) * mp.mpf("0.4")))
                if oi:
                    contracts.append({"K": K, "T": T, "sigma": sigma, "type": kind, "oi": oi})
    return contracts


def profile_value(contracts, x, r, q):
    total = mp.mpf(0)
    for c in contracts:
        d1, d2 = d1d2(x, c["K"], r, q, c["sigma"], c["T"])
        gamma = mp.exp(-q * c["T"]) * phi(d1) / (x * c["sigma"] * mp.sqrt(c["T"]))
        sign = 1 if c["type"] == "C" else -1
        total += sign * c["oi"] * 100 * gamma * x * x * mp.mpf("0.01")
    return total


def profile_cases(rng):
    out = []
    plans = [
        ("250", (1.06, 0.07, 9000), (0.94, 0.07, 9000), None),
        ("37.5", (1.04, 0.06, 7000), (0.95, 0.05, 11000), None),
        ("1450", (1.10, 0.05, 6000), (0.90, 0.05, 6500), (1.12, 0.03, 12000)),
        ("8.25", (1.00, 0.20, 3000), (1.00, 0.20, 900), None),
        ("612.34", (1.02, 0.10, 2500), (0.97, 0.10, 8000), None),
        ("250", (1.20, 0.05, 1000), (0.80, 0.05, 1000), None),
    ]
    for S, call_peak, put_peak, put_peak2 in plans:
        spot = mp.mpf(S)
        expiries = [mp.mpf(d) / 365 for d in (3, 17, 45)]
        contracts = contract_set(rng, spot, expiries, 13, call_peak, put_peak, put_peak2)
        r, q = mp.mpf("0.04"), mp.mpf("0.01")
        points, span = 121, mp.mpf("0.15")
        grid = [spot * (1 - span + 2 * span * i / (points - 1)) for i in range(points)]
        values = [profile_value(contracts, x, r, q) for x in grid]
        roots = []
        for i in range(1, points):
            if (values[i - 1] < 0) != (values[i] < 0):
                root = mp.findroot(lambda x: profile_value(contracts, x, r, q), (grid[i - 1], grid[i]), solver="anderson", tol=mp.mpf(10) ** -30, maxsteps=200)
                roots.append(root)
        roots.sort(key=lambda x: (abs(x - spot), x))
        out.append({
            "spot": S, "r": "0.04", "q": "0.01", "points": 121, "span": "0.15",
            "contracts": [{"K": s17(c["K"]), "Tdays": s17(c["T"] * 365), "sigma": s17(c["sigma"]), "type": c["type"], "oi": c["oi"]} for c in contracts],
            "grid": [s17(x) for x in grid],
            "profile": [s17(v) for v in values],
            "roots": [s17(x) for x in roots],
        })
    return out


def book_cases():
    cases = []

    def row(k, c, p):
        return {"strike": k, "call_gamma_oi": c, "put_gamma_oi": p}

    def net(rows):
        return sum(int(r["call_gamma_oi"]) for r in rows) - sum(abs(int(r["put_gamma_oi"])) for r in rows)

    five = [(240, 900000, 2250000), (245, 1100000, 1800000), (250, 3750000, 1000000), (255, 2600000, 400000), (260, 500000, 100000)]
    dealer = [row(k, str(c), str(-p)) for k, c, p in five]
    holder = [row(k, str(c), str(p)) for k, c, p in five]
    cases.append({"name": "dealer-signed puts, spot 250", "spot": 250, "rows": dealer,
                  "expect": {"callWall": 250, "putWall": 240, "putSign": "dealer", "gex": net(dealer)}})
    cases.append({"name": "holder-signed puts, spot 250", "spot": 250, "rows": holder,
                  "expect": {"callWall": 250, "putWall": 240, "putSign": "holder", "gex": net(holder)}})
    one_d = [row(250, "3750000", "-2000000")]
    one_h = [row(250, "3750000", "2000000")]
    cases.append({"name": "one strike, dealer-signed, the net is not the per-dollar call gamma", "spot": 250, "rows": one_d,
                  "expect": {"callWall": 250, "putWall": 250, "putSign": "dealer", "gex": 1750000}})
    cases.append({"name": "one strike, holder-signed", "spot": 250, "rows": one_h,
                  "expect": {"callWall": 250, "putWall": 250, "putSign": "holder", "gex": 1750000}})
    strikes = [200 + 2.5 * i for i in range(40)]
    base = [row(k, "500000", "-500000") for k in strikes]

    def with_flip(row_index, value):
        out = [dict(r) for r in base]
        out[row_index]["put_gamma_oi"] = str(value)
        return out

    cases.append({"name": "one flipped row carrying 0.02% of the put dollars", "spot": 250, "rows": with_flip(3, 4000), "expect": {"putSign": "dealer"}})
    cases.append({"name": "one flipped row carrying 0.9% of the put dollars", "spot": 250, "rows": with_flip(3, 180000), "expect": {"putSign": "dealer"}})
    cases.append({"name": "one flipped row carrying 1.5% of the put dollars", "spot": 250, "rows": with_flip(3, 300000), "expect": {"putSign": "mixed"}})
    three = [dict(r) for r in base]
    for i in (10, 11, 12):
        three[i]["put_gamma_oi"] = "500000"
    cases.append({"name": "three flipped rows of forty, 7.5% of the put dollars", "spot": 250, "rows": three, "expect": {"putSign": "mixed"}})
    big = [dict(r) for r in base]
    for r in big:
        r["put_gamma_oi"] = "-1000"
    big[20]["put_gamma_oi"] = "400000"
    cases.append({"name": "the largest strike flipped: few rows, most of the dollars", "spot": 250, "rows": big, "expect": {"putSign": "mixed"}})
    calls_only = [row(k, "500000", "0") for k in strikes[:5]]
    cases.append({"name": "no put gamma at all", "spot": 250, "rows": calls_only, "expect": {"putSign": "none"}})
    return cases


def main():
    rng = random.Random(SEED)
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-dealer-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "mpmath": mp.__version__,
            "dps": 50,
            "seed": SEED,
            "arithmetic": "mpmath at 50 digits; greeks by closed form and by central finite differences of the Black-Scholes-Merton price; the zero-gamma root by mp.findroot on the bracketing grid cell",
            "synthetic": True,
        },
        "greeks": greek_cases(rng),
        "profiles": profile_cases(rng),
        "books": book_cases(),
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(len(doc["greeks"]), "greek cases", len(doc["profiles"]), "profiles")


main()
