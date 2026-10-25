import datetime
import hashlib
import json
import math
import sys

import numpy as np
import scipy
import scipy.stats as st

SEED = 20261017
BIN_MS = 10 * 60000
HERE = __file__


def build(rng, names, n_windows, minutes, factor_names, strength):
    start = datetime.datetime(2026, 9, 29, 13, 30, tzinfo=datetime.timezone.utc)
    nb = minutes // 10
    factor = rng.normal(0, 1, nb)
    rows = []
    for i in range(n_windows):
        t = names[int(rng.integers(0, len(names)))]
        b = int(rng.integers(0, nb))
        if t in factor_names and rng.random() < 0.7:
            cand = np.where(factor > 0.6)[0]
            b = int(cand[int(rng.integers(0, len(cand)))])
        at = start + datetime.timedelta(minutes=b * 10 + int(rng.integers(0, 10)))
        cp = "C" if rng.random() < 0.55 else "P"
        prem = int(round(100000 * math.exp(rng.random() * 3)))
        share = 0.5 + 0.4 * (np.tanh(strength * factor[b]) if t in factor_names else (rng.random() - 0.5))
        share = min(0.95, max(0.05, share))
        ask = int(round(prem * 0.8 * share))
        bid = int(round(prem * 0.8 * (1 - share)))
        rows.append({"t": t, "cp": cp, "prem": prem, "askPrem": ask, "bidPrem": bid, "spanStart": at.isoformat().replace("+00:00", ".000Z")})
    return rows


def ms_of(iso):
    d = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=datetime.timezone.utc)
    return int(d.timestamp() * 1000)


def pearson(x, y):
    if len(x) < 3:
        return None
    if np.std(x) == 0 or np.std(y) == 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def residual(x, f):
    a = np.column_stack([np.ones(len(f)), f])
    coef, *_ = np.linalg.lstsq(a, x, rcond=None)
    return x - a @ coef


def partial(x, y, f):
    if len(x) < 4:
        return None
    return pearson(residual(x, f), residual(y, f))


def zscore(x):
    sd = np.std(x)
    return (x - np.mean(x)) / sd if sd > 0 else np.zeros(len(x))


def fisher(r, n, k=0):
    if r is None or n - k < 4:
        return None
    rr = max(-0.999999, min(0.999999, r))
    z = math.atanh(rr)
    se = 1 / math.sqrt(n - k - 3)
    q = float(st.norm.ppf(0.975))
    return [math.tanh(z - q * se), math.tanh(z + q * se)]


def expected(rows, params):
    t0 = min(ms_of(r["spanStart"]) for r in rows)
    t1 = max(ms_of(r["spanStart"]) for r in rows)
    b0 = t0 // BIN_MS
    B = t1 // BIN_MS - b0 + 1
    ser = {}
    for r in rows:
        t = r["t"]
        s = ser.setdefault(t, {"A": np.zeros(B), "L": np.zeros(B), "prem": 0.0, "active": set()})
        b = ms_of(r["spanStart"]) // BIN_MS - b0
        lean = (r["askPrem"] - r["bidPrem"]) if r["cp"] == "C" else (r["bidPrem"] - r["askPrem"])
        s["A"][b] += r["prem"]
        s["L"][b] += lean
        s["prem"] += r["prem"]
        s["active"].add(b)
    cand = [(t, s) for t, s in ser.items() if len(s["active"]) >= params["minActive"]]
    cand.sort(key=lambda p: (-p[1]["prem"], p[0]))
    cand = cand[: params["names"]]
    half = B // 2
    out = {"bins": B, "windows": len(rows), "names": [t for t, _ in cand], "pairs": {"A": [], "L": [], "P": []}}
    zs = [zscore(s["A"]) for _, s in cand]
    total = np.sum(zs, axis=0) if zs else None
    for L in ("A", "L", "P"):
        cond = L == "P"
        if cond and len(cand) - 2 < params["minOthers"]:
            continue
        key = "A" if cond else L
        for i in range(len(cand)):
            for j in range(i + 1, len(cand)):
                x, y = cand[i][1][key], cand[j][1][key]
                if cond:
                    factor = total - zs[i] - zs[j]
                    r = partial(x, y, factor)
                    r1 = partial(x[:half], y[:half], factor[:half])
                    r2 = partial(x[half:], y[half:], factor[half:])
                else:
                    r = pearson(x, y)
                    r1 = pearson(x[:half], y[:half])
                    r2 = pearson(x[half:], y[half:])
                ci = fisher(r, B, 1 if cond else 0)
                same = r1 is not None and r2 is not None and np.sign(r1) == np.sign(r) and np.sign(r2) == np.sign(r)
                passed = bool(r is not None and ci is not None and (ci[0] > 0 or ci[1] < 0) and abs(r) >= params["minCorr"])
                out["pairs"][L].append({"a": cand[i][0], "b": cand[j][0], "r": r, "lo": ci[0] if ci else None, "hi": ci[1] if ci else None, "r1": r1, "r2": r2, "n": B, "passed": passed, "stable": bool(passed and same)})
    return out


def main():
    rng = np.random.default_rng(SEED)
    params = {"binMin": 10, "names": 12, "minBins": 20, "minActive": 4, "minWindows": 40, "minCorr": 0.3, "minOthers": 4}
    cases = []
    names = ["NVDA", "AMD", "AVGO", "TSLA", "AAPL", "META", "MSFT", "XOM", "JPM", "LLY"]
    for label, nwin, minutes, fac, strength in [("factor", 420, 400, ["NVDA", "AMD", "AVGO"], 2.0), ("null", 300, 360, [], 0.0), ("short", 90, 240, ["NVDA", "AMD"], 1.5)]:
        rows = build(rng, names, nwin, minutes, fac, strength)
        cases.append({"label": label, "rows": rows, "expected": expected(rows, params)})
    prov = {
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "seed": SEED,
        "script_sha256": hashlib.sha256(open(HERE, "rb").read()).hexdigest(),
        "method": "Pearson r of per-name ten-minute series (numpy.corrcoef); Fisher z interval with scipy.stats.norm.ppf(0.975) and se 1/sqrt(n-3); first and second half r; layer P is the partial r of the pair's Active series after OLS residuals on the sum of the other kept names' z-scored Active series (the pair itself left out, which removes the -1/(K-1) bias of conditioning on a sum that contains both), Fisher se 1/sqrt(n-4); no P pairs when fewer than minOthers other names remain",
    }
    json.dump({"provenance": prov, "params": params, "cases": cases}, open(sys.argv[1] if len(sys.argv) > 1 else "fixtures-relations.json", "w"), separators=(",", ":"))


main()
