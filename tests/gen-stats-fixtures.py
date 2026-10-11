import hashlib
import json
import math
import sys

import numpy as np
import scipy
import scipy.stats as st
import statsmodels
import statsmodels.api as sm

SEED = 20261010
rng = np.random.default_rng(SEED)
HERE = __file__


def clean(v):
    if isinstance(v, (np.floating, float)):
        return None if not math.isfinite(float(v)) else float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if isinstance(v, np.ndarray):
        return [clean(x) for x in v.tolist()]
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    return v


def series(n, scale=1.0, shift=0.0, ties=False):
    x = rng.normal(shift, scale, n)
    if ties:
        x = np.round(x * 2) / 2
    return x


out = {"provenance": {}}

out["location"] = []
for n in (1, 2, 3, 4, 5, 8, 21, 50):
    x = series(n, 3.0, 1.0)
    row = {"x": clean(x), "median": float(np.median(x)), "mean": float(np.mean(x)),
           "sd": float(np.std(x, ddof=1)) if n > 1 else None, "q": {}}
    for p in (0, 0.05, 0.25, 0.5, 0.8, 0.95, 1):
        row["q"][str(p)] = float(np.quantile(x, p, method="linear"))
    out["location"].append(row)
dirty = [1.5, None, 2.5, 9.0, None, -4.0, 0.5]
fin = np.array([v for v in dirty if v is not None])
out["dirty"] = {"x": dirty, "median": float(np.median(fin)), "mean": float(np.mean(fin)), "sd": float(np.std(fin, ddof=1)),
                "q80": float(np.quantile(fin, 0.8, method="linear"))}

out["rank"] = []
for n, ties in ((5, False), (9, True), (30, True)):
    x = series(n, 2.0, 0.0, ties)
    out["rank"].append({"x": clean(x), "pct": clean(st.rankdata(x, method="average") / (len(x) + 1))})

out["correlation"] = []
for n, ties in ((3, False), (7, False), (25, False), (25, True), (60, False)):
    x = series(n, 1.0, 0.0, ties)
    y = 0.6 * x + series(n, 1.0, 0.0, ties)
    r = st.pearsonr(x, y)
    rho = st.spearmanr(x, y)
    out["correlation"].append({"x": clean(x), "y": clean(y), "pearson": float(r.statistic), "spearman": float(rho.statistic)})

z975 = float(st.norm.ppf(0.975))
out["z975"] = z975
out["wilson"] = []
for k, n in ((0, 10), (1, 10), (5, 10), (10, 10), (13, 40), (87, 200), (3, 7), (0, 1), (1, 1), (500, 1000)):
    ci = st.binomtest(k, n).proportion_ci(confidence_level=0.95, method="wilson")
    out["wilson"].append({"k": k, "n": n, "p": k / n, "lo": float(ci.low), "hi": float(ci.high)})

out["t975"] = {str(df): float(st.t.ppf(0.975, df)) for df in list(range(1, 31)) + [31, 35, 40, 50, 60, 100, 250, 1000]}
out["meanCi"] = []
for n in (2, 3, 6, 12, 30, 31, 80):
    x = series(n, 2.0, 0.4)
    lo, hi = st.t.interval(0.95, n - 1, loc=float(np.mean(x)), scale=float(st.sem(x)))
    out["meanCi"].append({"x": clean(x), "mean": float(np.mean(x)), "se": float(st.sem(x)), "lo": float(lo), "hi": float(hi)})

out["newey"] = []
for n, phi in ((40, 0.0), (120, 0.5), (250, 0.8), (500, 0.3)):
    e = rng.normal(0, 1, n)
    x = np.zeros(n)
    for t in range(n):
        x[t] = (phi * x[t - 1] if t else 0.0) + e[t] + 0.2
    row = {"x": clean(x), "bylag": {}}
    for L in (0, 1, 3, 6):
        fit = sm.OLS(x, np.ones(n)).fit(cov_type="HAC", cov_kwds={"maxlags": L, "use_correction": False})
        row["bylag"][str(L)] = float(fit.bse[0])
    rule = int(math.floor(4 * (n / 100) ** (2 / 9)))
    fit = sm.OLS(x, np.ones(n)).fit(cov_type="HAC", cov_kwds={"maxlags": rule, "use_correction": False})
    row["rule"] = {"lags": rule, "se": float(fit.bse[0])}
    out["newey"].append(row)


def mulberry32(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def stationary(xs, reps, mean_block, seed):
    rand = mulberry32(seed)
    n = len(xs)
    keep = 1 / max(1, mean_block)
    res = []
    for _ in range(reps):
        at = int(math.floor(rand() * n))
        total = xs[at]
        for _i in range(1, n):
            if rand() < keep:
                at = int(math.floor(rand() * n))
            else:
                at = (at + 1) % n
            total += xs[at]
        res.append(total / n)
    return res


out["bootstrap"] = []
for n, reps, block, seed in ((12, 40, 3, 7), (30, 25, 6, 20261010), (30, 25, 1, 5)):
    x = [round(float(v), 6) for v in series(n, 1.0, 0.1)]
    out["bootstrap"].append({"x": x, "reps": reps, "meanBlock": block, "seed": seed, "means": stationary(x, reps, block, seed)})

out["score"] = []
for n, bins in ((40, 5), (200, 10), (75, 4)):
    p = rng.uniform(0, 1, n)
    y = (rng.uniform(0, 1, n) < np.clip(0.15 + 0.7 * p, 0, 1)).astype(int)
    bs = float(np.mean((p - y) ** 2))
    eps = 1e-12
    q = np.clip(p, eps, 1 - eps)
    ll = float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q)))
    base = float(np.mean(y))
    cells = []
    rel = res = within = cov = 0.0
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        if i == bins - 1:
            mask = (p >= lo) & (p <= hi)
        else:
            mask = (p >= lo) & (p < hi)
        m = int(mask.sum())
        if not m:
            cells.append({"n": 0, "p": None, "y": None})
            continue
        pb, yb = float(p[mask].mean()), float(y[mask].mean())
        rel += m * (pb - yb) ** 2
        res += m * (yb - base) ** 2
        within += float(((p[mask] - pb) ** 2).sum())
        cov += float(((p[mask] - pb) * y[mask]).sum())
        cells.append({"n": m, "p": pb, "y": yb})
    assert abs(bs - (rel / n - res / n + base * (1 - base) + within / n - 2 * cov / n)) < 1e-12
    out["score"].append({"p": clean(p), "y": y.tolist(), "bins": bins, "brier": bs, "logScore": ll, "base": base,
                         "reliability": rel / n, "resolution": res / n, "uncertainty": base * (1 - base),
                         "withinBin": within / n, "withinCovariance": cov / n, "cells": cells})

out["bh"] = []
for m in (1, 5, 20, 60):
    ps = np.sort(rng.uniform(0, 1, m) ** 2)
    ps = rng.permutation(ps)
    adj = st.false_discovery_control(ps, method="bh")
    out["bh"].append({"p": clean(ps), "adjusted": clean(adj), "reject05": [bool(a <= 0.05) for a in adj], "reject20": [bool(a <= 0.20) for a in adj]})

out["effectiveN"] = [
    {"n": 100, "k": 20, "icc": 0.0, "want": 100.0},
    {"n": 100, "k": 20, "icc": 0.25, "want": 100 / (1 + (5 - 1) * 0.25)},
    {"n": 100, "clusterSize": 10, "icc": 0.1, "want": 100 / (1 + 9 * 0.1)},
    {"n": 100, "k": 100, "icc": 0.9, "want": 100.0},
    {"n": 100, "k": 1, "icc": 1.0, "want": 100 / 100},
]

src = open(HERE, "rb").read()
out["provenance"] = {
    "generator": "tests/gen-stats-fixtures.py",
    "generatorSha256": hashlib.sha256(src).hexdigest(),
    "seed": SEED,
    "numpy": np.__version__,
    "scipy": scipy.__version__,
    "statsmodels": statsmodels.__version__,
    "python": sys.version.split()[0],
    "note": "Wilson from scipy binomtest proportion_ci; Newey-West from statsmodels OLS HAC (Bartlett, use_correction False); BH from scipy false_discovery_control; t from scipy t.ppf; the bootstrap reference repeats the module's mulberry32 and stationary-block draw in Python.",
}
json.dump(clean(out), sys.stdout, indent=None, separators=(",", ":"))
