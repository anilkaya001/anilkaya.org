import json
import math

import numpy as np
import scipy
from scipy import optimize, stats

SEED = 20261010
G = 25
PER = 20
Z = 1.96


def logistic(z):
    return 1.0 / (1.0 + np.exp(-z))


def make_rows(rng):
    rows = []
    for g in range(G):
        u = rng.normal(0.0, 0.4)
        for _ in range(PER):
            x = float(np.round(rng.beta(2.0, 2.0) * 0.8 + 0.15, 2))
            bth = int(rng.integers(2, 7))
            p = logistic(-0.2 + 0.9 * x + 0.1 * (bth - 4) + u)
            hit = int(rng.random() < p)
            y = float(np.round((0.004 + abs(rng.normal(0, 0.01))) * (1 if hit else -1), 5))
            rows.append({"g": g, "x": x, "bth": bth, "hit": hit, "y": y})
    return rows


def fit(X, y):
    k = X.shape[1]

    def neg(b):
        z = X @ b
        ll = np.sum(y * z - np.logaddexp(0.0, z))
        grad = X.T @ (y - logistic(z))
        return -ll, -grad

    res = optimize.minimize(neg, np.zeros(k), jac=True, method="BFGS", options={"gtol": 1e-12, "maxiter": 500})
    b = res.x
    for _ in range(8):
        p = logistic(X @ b)
        w = p * (1 - p)
        h = X.T @ (X * w[:, None])
        b = b + np.linalg.solve(h, X.T @ (y - p))
    return b


def sandwich(X, y, cluster, b):
    n, k = X.shape
    p = logistic(X @ b)
    w = p * (1 - p)
    h = X.T @ (X * w[:, None])
    bread = np.linalg.inv(h)
    score = (y - p)[:, None] * X
    ids = sorted(set(cluster.tolist()))
    meat = np.zeros((k, k))
    for g in ids:
        s = score[cluster == g].sum(axis=0)
        meat += np.outer(s, s)
    big_g = len(ids)
    c = big_g / (big_g - 1) * (n - 1) / (n - k)
    v = c * bread @ meat @ bread
    return np.sqrt(np.diag(v)), np.sqrt(np.diag(bread)), big_g


def wilson(p, n):
    z2 = Z * Z
    d = 1 + z2 / n
    c = (p + z2 / (2 * n)) / d
    m = Z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d
    return max(0.0, c - m), min(1.0, c + m)


def group(rows, ids):
    n = len(rows)
    hits = sum(r["hit"] for r in rows)
    p = hits / n
    by = {}
    for r in rows:
        s = by.setdefault(r["g"], [0, 0])
        s[0] += 1
        s[1] += r["hit"]
    cl = len(by)
    ss = sum((s[1] - p * s[0]) ** 2 for s in by.values())
    var_cluster = cl / (cl - 1) * ss / (n * n)
    var_binom = p * (1 - p) / n
    deff = max(1.0, var_cluster / var_binom)
    n_eff = n / deff
    lo, hi = wilson(p, n_eff)
    return {"n": n, "hits": hits, "rate": p, "deff": deff, "nEff": n_eff, "lo": lo, "hi": hi, "by": by}


def terciles(rows):
    xs = sorted(r["x"] for r in rows)
    n = len(xs)
    c1 = xs[max(0, math.ceil(n / 3) - 1)]
    c2 = xs[max(0, math.ceil(2 * n / 3) - 1)]
    parts = [[], [], []]
    for r in rows:
        parts[0 if r["x"] <= c1 else 2 if r["x"] > c2 else 1].append(r)
    stat = [group(p, None) for p in parts]
    lo, hi = stat[0], stat[2]
    z = {}
    for g, s in hi["by"].items():
        z[g] = z.get(g, 0.0) + (s[1] - hi["rate"] * s[0]) / hi["n"]
    for g, s in lo["by"].items():
        z[g] = z.get(g, 0.0) - (s[1] - lo["rate"] * s[0]) / lo["n"]
    big_g = G
    se = math.sqrt(big_g / (big_g - 1) * sum(v * v for v in z.values()))
    return c1, c2, stat, hi["rate"] - lo["rate"], se


def spearman_fixture(rows):
    x = np.array([r["x"] for r in rows])
    y = np.array([r["y"] for r in rows])
    cluster = np.array([r["g"] for r in rows])
    rx, ry = stats.rankdata(x), stats.rankdata(y)
    rho = float(np.corrcoef(rx, ry)[0, 1])
    left = []
    for g in sorted(set(cluster.tolist())):
        keep = cluster != g
        left.append(float(np.corrcoef(rx[keep], ry[keep])[0, 1]))
    m = sum(left) / len(left)
    se = math.sqrt((len(left) - 1) / len(left) * sum((v - m) ** 2 for v in left))
    ref = float(stats.spearmanr(x, y).statistic)
    return rho, se, ref


def main():
    rng = np.random.default_rng(SEED)
    rows = make_rows(rng)
    cluster = np.array([r["g"] for r in rows])
    y = np.array([r["hit"] for r in rows], dtype=float)
    x1 = np.column_stack([np.ones(len(rows)), [r["x"] for r in rows]])
    bth = np.array([r["bth"] for r in rows], dtype=float)
    x2 = np.column_stack([np.ones(len(rows)), [r["x"] for r in rows], bth - bth.mean()])
    b1 = fit(x1, y)
    se1, naive1, big_g = sandwich(x1, y, cluster, b1)
    b2 = fit(x2, y)
    se2, naive2, _ = sandwich(x2, y, cluster, b2)
    c1, c2, stat, diff, diff_se = terciles(rows)
    rho, rho_se, rho_ref = spearman_fixture(rows)
    t = float(stats.t.ppf(0.975, big_g - 1))
    out = {
        "provenance": f"numpy {np.__version__}, scipy {scipy.__version__}, seed {SEED}, {G} clusters of {PER} rows; "
                      "logistic fits by BFGS polished with Newton steps, cluster-robust sandwich with G/(G-1) and (n-1)/(n-k), "
                      "Student t on G-1 degrees of freedom, Wilson at z = 1.96 on the effective count, rank correlation from scipy.stats",
        "rows": rows,
        "clusters": big_g,
        "tCrit": t,
        "model1": {"beta": b1.tolist(), "se": se1.tolist(), "seNaive": naive1.tolist()},
        "model2": {"beta": b2.tolist(), "se": se2.tolist(), "seNaive": naive2.tolist(), "bthMean": float(bth.mean())},
        "terciles": {
            "cuts": [c1, c2],
            "groups": [
                {k: v for k, v in s.items() if k != "by"} for s in stat
            ],
            "diff": diff,
            "diffSe": diff_se,
        },
        "spearman": {"rho": rho, "se": rho_se, "scipy": rho_ref},
        "wilson": [
            {"p": 0.5, "n": 100, "lo": wilson(0.5, 100)[0], "hi": wilson(0.5, 100)[1]},
            {"p": 0.1, "n": 50, "lo": wilson(0.1, 50)[0], "hi": wilson(0.1, 50)[1]},
            {"p": 0.0, "n": 30, "lo": wilson(0.0, 30)[0], "hi": wilson(0.0, 30)[1]},
        ],
        "tTable": {str(df): float(stats.t.ppf(0.975, df)) for df in (1, 2, 5, 10, 24, 30)},
    }
    with open("fixtures-conviction.json", "w") as handle:
        json.dump(out, handle, separators=(",", ":"))
    print("rows", len(rows), "clusters", big_g, "slope", round(float(b1[1]), 4), "se", round(float(se1[1]), 4))


main()
