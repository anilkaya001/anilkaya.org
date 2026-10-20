import hashlib
import json
import math
import os
import sys

import numpy as np
import scipy
import scipy.optimize as opt
import scipy.stats as st

SEED = 20261011
rng = np.random.default_rng(SEED)
HERE = os.path.abspath(__file__)
OUT = os.path.dirname(HERE)
CHI2_90 = float(st.chi2.ppf(0.9, 1))


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


def nll(y, xi, beta):
    z = xi * y / beta
    if np.any(1 + z <= 0) or beta <= 0:
        return math.inf
    if abs(xi) < 1e-9:
        return len(y) * math.log(beta) + float(np.sum(y)) / beta
    return len(y) * math.log(beta) + (1 + 1 / xi) * float(np.sum(np.log1p(z)))


def profile(y, xi):
    floor = max(0.0, -xi * float(np.max(y)))
    f = lambda t: nll(y, xi, floor + math.exp(t))
    r = opt.minimize_scalar(f, bounds=(-25, 25), method="bounded", options={"xatol": 1e-12})
    return r.fun, floor + math.exp(r.x)


def mle(y):
    c, loc, scale = st.genpareto.fit(y, floc=0)
    start = [math.log(scale), c]
    f = lambda p: nll(y, p[1], math.exp(p[0]))
    r = opt.minimize(f, start, method="Nelder-Mead", options={"xatol": 1e-12, "fatol": 1e-14, "maxiter": 4000})
    return {"xi": float(r.x[1]), "beta": math.exp(float(r.x[0])), "nll": float(r.fun), "scipyXi": float(c), "scipyBeta": float(scale)}


def interval(y, fit, crit):
    g = lambda xi: 2 * (profile(y, xi)[0] - fit["nll"]) - crit
    lo = opt.brentq(g, -0.9, fit["xi"] - 1e-6, xtol=1e-12)
    hi = opt.brentq(g, fit["xi"] + 1e-6, 3.0, xtol=1e-12)
    return float(lo), float(hi)


def pooled_nll(groups, xi):
    total = 0.0
    for y in groups:
        beta = float(np.mean(y)) * (1 - xi)
        total += nll(y, xi, beta)
    return total


gpd = []
for n, xi, beta in [(200, 0.2, 1.5), (200, 0.1, 0.8), (400, 0.3, 2.0), (60, 0.25, 1.0), (200, -0.1, 1.0), (1000, 0.4, 0.5), (120, 0.05, 2.5)]:
    y = st.genpareto.rvs(xi, scale=beta, size=n, random_state=rng)
    fit = mle(y)
    assert abs(fit["xi"] - fit["scipyXi"]) < 1e-3 and abs(fit["beta"] - fit["scipyBeta"]) < 1e-3 * max(1.0, fit["beta"])
    lo, hi = interval(y, fit, CHI2_90)
    gpd.append({"n": n, "trueXi": xi, "trueBeta": beta, "y": [round(float(v), 12) for v in y], "fit": fit, "interval90": [lo, hi]})

pooled = []
for names, xi in [(8, 0.25), (24, 0.2), (40, 0.3)]:
    counts = rng.integers(20, 70, size=names)
    betas = np.exp(rng.normal(0.0, 0.7, size=names))
    groups = [st.genpareto.rvs(xi, scale=float(b), size=int(c), random_state=rng) for b, c in zip(betas, counts)]
    f = lambda x: pooled_nll(groups, x)
    r = opt.minimize_scalar(f, bounds=(-0.4, 0.95), method="bounded", options={"xatol": 1e-12})
    hat = float(r.x)
    g = lambda x: 2 * (f(x) - float(r.fun)) - CHI2_90
    lo = float(opt.brentq(g, -0.4, hat - 1e-6, xtol=1e-12))
    hi = float(opt.brentq(g, hat + 1e-6, 0.95, xtol=1e-12))
    pooled.append({"trueXi": xi, "groups": [[round(float(v), 12) for v in y] for y in groups], "xi": hat, "nll": float(r.fun), "interval90": [lo, hi], "n": int(sum(len(y) for y in groups))})


def log_density(y, xi, m):
    beta = m * (1 - xi)
    return -math.log(beta) - (1 + 1 / xi) * math.log1p(xi * y / beta)


def psi(y, xi, m, h=1e-6):
    return (log_density(y, xi + h, m) - log_density(y, xi - h, m)) / (2 * h)


def dpsi_dm(y, xi, m, h=1e-6):
    return (psi(y, xi, m * (1 + h)) - psi(y, xi, m * (1 - h))) / (2 * m * h)


def exceed(series, q):
    a = np.abs(series)
    u = np.sort(a)[int(math.floor(q * (len(a) - 1)))]
    idx = np.nonzero(a > u)[0]
    return a[idx] - u, idx


def pooled_hat(groups):
    f = lambda x: pooled_nll(groups, x)
    r = opt.minimize_scalar(f, bounds=(-0.4, 0.95), method="bounded", options={"xatol": 1e-12})
    return float(r.x), float(r.fun)


def pooled_curvature(groups, xi, h=1e-3):
    f = lambda x: pooled_nll(groups, x)
    return (f(xi + h) - 2 * f(xi) + f(xi - h)) / (h * h)


def student_unit(nu, size):
    g = rng.gamma(nu / 2, 2.0, size=size)
    return rng.standard_normal(size) / np.sqrt(g / nu) * math.sqrt((nu - 2) / nu)


def sandwich(series, q, days_total):
    ex = [exceed(row, q) for row in series]
    groups = [e[0] for e in ex]
    xi, nll_hat = pooled_hat(groups)
    d2 = pooled_curvature(groups, xi)
    clusters = {}
    for (y, idx) in ex:
        m = float(np.mean(y))
        u = y / (m * (1 - xi))
        corr = float(np.mean([dpsi_dm(v, xi, m) for v in y]))
        for v, t in zip(y, idx):
            clusters[int(t)] = clusters.get(int(t), 0.0) + psi(v, xi, m) + corr * (v - m)
    total = max(days_total, len(clusters))
    var = sum(v * v for v in clusters.values()) / (d2 * d2) * (total / (total - 1))
    return {"xi": xi, "modelSe": 1 / math.sqrt(d2), "se": math.sqrt(var), "clusters": len(clusters)}


def jackknife(series, q, blocks):
    days = series.shape[1]
    size = days // blocks
    est = []
    for g in range(blocks):
        lo = g * size
        hi = days if g == blocks - 1 else (g + 1) * size
        keep = np.concatenate([np.arange(0, lo), np.arange(hi, days)])
        groups = [exceed(row[keep], q)[0] for row in series]
        est.append(pooled_hat(groups)[0])
    est = np.array(est)
    var = (blocks - 1) / blocks * float(np.sum((est - est.mean()) ** 2))
    return {"se": math.sqrt(var), "estimates": [float(v) for v in est]}


cluster = []
for names, days, rho, nu in [(10, 160, 0.4, 5), (16, 240, 0.25, 6)]:
    factor = student_unit(nu, days)
    series = np.vstack([math.sqrt(rho) * factor + math.sqrt(1 - rho) * student_unit(nu, days) for _ in range(names)])
    sw = sandwich(series, 0.9, days)
    jk = jackknife(series, 0.9, 6)
    cluster.append({"names": names, "days": days, "q": 0.9, "series": [[round(float(v), 12) for v in row] for row in series], "sandwich": sw, "jackknife": jk, "blocks": 6})


def hill_ref(x, k):
    a = np.sort(np.abs(x))[::-1]
    return float(np.mean(np.log(a[:k] / a[k])))


def mean_excess_ref(x, us):
    a = np.abs(x)
    out = []
    for u in us:
        e = a[a > u] - u
        out.append({"u": float(u), "n": int(len(e)), "e": float(np.mean(e)), "se": float(np.std(e, ddof=1) / math.sqrt(len(e)))})
    return out


def sp_fit(x, tail, absolute, min_tail=20):
    xs = np.sort(np.abs(x) if absolute else x)
    n = len(xs)
    k = int(math.floor(tail * n))

    def side(sign):
        edge = xs[n - 1 - k] if sign > 0 else xs[k]
        e = (xs - edge) if sign > 0 else (edge - xs)
        e = e[e > 0]
        fit = mle(e)
        return {"u": float(edge), "xi": fit["xi"], "beta": fit["beta"], "n": int(len(e)), "rate": len(e) / n}

    return xs, side(1), None if absolute else side(-1)


def sp_sf(xs, up, lo, x):
    n = len(xs)
    if x > up["u"]:
        return up["rate"] * float(st.genpareto.sf(x - up["u"], up["xi"], scale=up["beta"]))
    if lo is not None and x < lo["u"]:
        return 1 - lo["rate"] * float(st.genpareto.sf(lo["u"] - x, lo["xi"], scale=lo["beta"]))
    return float(np.sum(xs > x)) / n


def sp_isf(xs, up, lo, p):
    if p < up["rate"]:
        return up["u"] + float(st.genpareto.isf(p / up["rate"], up["xi"], scale=up["beta"]))
    if lo is not None and 1 - p < lo["rate"]:
        return lo["u"] - float(st.genpareto.isf((1 - p) / lo["rate"], lo["xi"], scale=lo["beta"]))
    return float(np.quantile(xs, 1 - p))


tail_cases = {}
sample = st.t.rvs(4, size=3000, random_state=rng)
tail_cases["hill"] = {"x": [round(float(v), 12) for v in sample], "rows": [{"k": k, "xi": hill_ref(sample, k)} for k in (30, 100, 300)]}
us = [float(np.quantile(np.abs(sample), p)) for p in (0.8, 0.9, 0.95)]
tail_cases["meanExcess"] = mean_excess_ref(sample, us)

series = np.vstack([math.sqrt(0.3) * student_unit(5, 300) + math.sqrt(0.7) * student_unit(5, 300) for _ in range(12)])
stab = []
for q in (0.8, 0.85, 0.9, 0.925, 0.95):
    groups = [exceed(row, q)[0] for row in series]
    xi, _ = pooled_hat(groups)
    stab.append({"q": q, "xi": xi, "se": 1 / math.sqrt(pooled_curvature(groups, xi)), "n": int(sum(len(g) for g in groups))})
tail_cases["stability"] = {"series": [[round(float(v), 12) for v in row] for row in series], "rows": stab}

sp = []
for absolute in (False, True):
    xs, up, lo = sp_fit(sample, 0.075, absolute)
    xq = [float(np.quantile(xs, p)) for p in (0.1, 0.5, 0.9, 0.95)] + [up["u"] + 0.5, up["u"] + 3.0, up["u"] + 10.0]
    if lo is not None:
        xq += [lo["u"] - 0.5, lo["u"] - 3.0]
    sp.append({"absolute": absolute, "tail": 0.075, "upper": up, "lower": lo, "sf": [{"x": x, "sf": sp_sf(xs, up, lo, x)} for x in xq],
               "isf": [{"p": p, "x": sp_isf(xs, up, lo, p)} for p in (0.5, 0.2, 0.05, 0.01, 0.001, 0.8, 0.99, 0.999)]})
tail_cases["semiParametric"] = sp


def cov_nll(theta, y, X):
    eta = X @ theta[:-1]
    xi = theta[-1]
    z = xi * y * np.exp(-eta)
    if np.any(1 + z <= 0):
        return math.inf
    return float(np.sum(eta) + (1 + 1 / xi) * np.sum(np.log1p(z)))


n_cov = 600
X = np.column_stack([np.ones(n_cov), rng.standard_normal(n_cov), rng.standard_normal(n_cov)])
gamma_true = np.array([0.2, 0.5, -0.3])
y_cov = st.genpareto.rvs(0.25, scale=np.exp(X @ gamma_true), size=n_cov, random_state=rng)
start = np.concatenate([np.linalg.lstsq(X, np.log(y_cov), rcond=None)[0], [0.2]])
r1 = opt.minimize(cov_nll, start, args=(y_cov, X), method="BFGS", options={"gtol": 1e-10})
r2 = opt.minimize(cov_nll, r1.x, args=(y_cov, X), method="Nelder-Mead", options={"xatol": 1e-11, "fatol": 1e-14, "maxiter": 20000})
theta = r2.x
q = len(theta)
H = np.zeros((q, q))
hs = 1e-4 * np.maximum(1.0, np.abs(theta))


def bump(da, a, db=0.0, b=None):
    t = theta.copy()
    t[a] += da
    if b is not None:
        t[b] += db
    return cov_nll(t, y_cov, X)


f0 = cov_nll(theta, y_cov, X)
for a in range(q):
    H[a, a] = (bump(hs[a], a) - 2 * f0 + bump(-hs[a], a)) / hs[a] ** 2
    for b in range(a):
        H[a, b] = H[b, a] = (bump(hs[a], a, hs[b], b) - bump(hs[a], a, -hs[b], b) - bump(-hs[a], a, hs[b], b) + bump(-hs[a], a, -hs[b], b)) / (4 * hs[a] * hs[b])
se = np.sqrt(np.diag(np.linalg.inv(H)))
tail_cases["covariate"] = {"n": n_cov, "X": [[round(float(v), 12) for v in row] for row in X], "y": [round(float(v), 12) for v in y_cov],
                           "gamma": [float(v) for v in theta[:-1]], "xi": float(theta[-1]), "nll": float(r2.fun),
                           "se": {"gamma": [float(v) for v in se[:-1]], "xi": float(se[-1])}, "trueGamma": [float(v) for v in gamma_true], "trueXi": 0.25}

src = open(HERE, "rb").read()
provenance = {
    "generator": "tests/gen-moves-fixtures.py",
    "generatorSha256": hashlib.sha256(src).hexdigest(),
    "seed": SEED,
    "numpy": np.__version__,
    "scipy": scipy.__version__,
    "python": sys.version.split()[0],
}

with open(os.path.join(OUT, "fixtures-moves-gpd.json"), "w") as fh:
    json.dump(clean({
        "provenance": {**provenance, "note": "GPD maximum likelihood by Nelder-Mead on (ln beta, xi) from scipy's genpareto.fit with the location fixed at zero, asserted to agree with scipy within 1e-3; the 90% profile-likelihood interval by brentq on the chi-square(1) line; the pooled shape by bounded minimisation of the concentrated likelihood with each name's scale set to its mean excess times (1 - xi)."},
        "gpd": gpd,
        "pooled": pooled,
    }), fh, separators=(",", ":"))

with open(os.path.join(OUT, "fixtures-moves-cluster.json"), "w") as fh:
    json.dump(clean({
        "provenance": {**provenance, "note": "The pooled shape's cluster-robust variance by date: the score of each exceedance with respect to the shape (the scale moving with it as the mean excess times 1 - xi) plus the name-level correction for the estimated mean excess, summed by day and squared, over the squared curvature, with numerical derivatives written independently of the module's closed forms; and the delete-a-block jackknife over six blocks of days with the thresholds re-estimated. Series are a one-factor Student t world."},
        "cluster": cluster,
    }), fh, separators=(",", ":"))

with open(os.path.join(OUT, "fixtures-moves-tail.json"), "w") as fh:
    json.dump(clean({
        "provenance": {**provenance, "note": "Hill and mean-excess statistics in numpy; the threshold-stability rows by bounded minimisation of the concentrated pooled likelihood on a one-factor Student t world; the semi-parametric law with an empirical body and generalised Pareto tails fitted by Nelder-Mead, evaluated with scipy's genpareto; the covariate generalised Pareto (log scale linear in two covariates, one shape) by BFGS polished with Nelder-Mead on the full likelihood, its standard errors from the same step-scaled central-difference Hessian."},
        **tail_cases,
    }), fh, separators=(",", ":"))
