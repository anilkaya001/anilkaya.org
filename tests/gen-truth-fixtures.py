import hashlib
import json
import math
import os
import sys

import numpy as np
import scipy
from scipy import integrate, stats

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "fixtures-truth.json")
SCRIPT_BYTES = open(os.path.abspath(__file__), "rb").read()

MASK = 0xFFFFFFFF


class Sfc32:
    def __init__(self, seed):
        h = hashlib.sha256(str(seed).encode()).digest()
        self.a = int.from_bytes(h[0:4], "big")
        self.b = int.from_bytes(h[4:8], "big")
        self.c = int.from_bytes(h[8:12], "big")
        self.d = int.from_bytes(h[12:16], "big")
        for _ in range(15):
            self.next()

    def next(self):
        a, b, c, d = self.a, self.b, self.c, self.d
        t = (a + b) & MASK
        self.a = b ^ (b >> 9)
        self.b = (c + ((c << 3) & MASK)) & MASK
        self.c = (((c << 21) & MASK) | (c >> 11)) & MASK
        self.d = (d + 1) & MASK
        t = (t + self.d) & MASK
        self.c = (self.c + t) & MASK
        return t

    def uniform(self):
        return (self.next() + 0.5) / 4294967296.0


def rng_block():
    out = {}
    for seed in ("selftest|a", "selftest|b", "truth|w1|0"):
        r = Sfc32(seed)
        out[seed] = {"words": [r.next() for _ in range(6)]}
        r = Sfc32(seed)
        out[seed]["uniforms"] = [r.uniform() for _ in range(6)]
    return out


def hansen_consts(nu, lam):
    c = math.exp(math.lgamma((nu + 1) / 2) - math.lgamma(nu / 2)) / math.sqrt(math.pi * (nu - 2))
    a = 4 * lam * c * (nu - 2) / (nu - 1)
    b = math.sqrt(1 + 3 * lam * lam - a * a)
    return a, b, c


def hansen_pdf(z, nu, lam):
    a, b, c = hansen_consts(nu, lam)
    side = (1 - lam) if z < -a / b else (1 + lam)
    u = (b * z + a) / side
    return b * c * (1 + u * u / (nu - 2)) ** (-(nu + 1) / 2)


def hansen_cdf_closed(z, nu, lam):
    a, b, c = hansen_consts(nu, lam)
    unit = math.sqrt(nu / (nu - 2))
    if z < -a / b:
        return (1 - lam) * stats.t.cdf((b * z + a) / (1 - lam) * unit, nu)
    return (1 - lam) / 2 + (1 + lam) * (stats.t.cdf((b * z + a) / (1 + lam) * unit, nu) - 0.5)


def hansen_sf2_numeric(k, nu, lam):
    a, b, c = hansen_consts(nu, lam)
    split = -a / b
    right, _ = integrate.quad(lambda z: hansen_pdf(z, nu, lam), k, np.inf, epsabs=1e-14, epsrel=1e-12)
    if -k < split:
        left, _ = integrate.quad(lambda z: hansen_pdf(z, nu, lam), -np.inf, -k, epsabs=1e-14, epsrel=1e-12)
    else:
        left = 0.0
    return right + left


def hansen_block():
    rows = []
    ks = [2.0, 2.5, 3.0, 4.0, 5.0, 6.0]
    for nu, lam in ((4, -0.05), (5, -0.05), (8, -0.05), (5, -0.15), (4, -0.15), (8, 0.0)):
        a, b, c = hansen_consts(nu, lam)
        sf2 = []
        for k in ks:
            closed = 1 - hansen_cdf_closed(k, nu, lam) + hansen_cdf_closed(-k, nu, lam)
            numeric = hansen_sf2_numeric(k, nu, lam)
            if abs(closed - numeric) > 1e-9 * max(1.0, 1.0 / closed) * closed + 1e-13:
                raise SystemExit("closed form and quadrature disagree: nu=%s lam=%s k=%s %r %r" % (nu, lam, k, closed, numeric))
            sf2.append(closed)
        mass, _ = integrate.quad(lambda z: hansen_pdf(z, nu, lam), -np.inf, np.inf, epsabs=1e-13, limit=400)
        var, _ = integrate.quad(lambda z: z * z * hansen_pdf(z, nu, lam), -np.inf, np.inf, epsabs=1e-13, limit=400) if nu > 2.5 else (None, None)
        rows.append({"nu": nu, "lambda": lam, "a": a, "b": b, "c": c, "ks": ks, "sf2": sf2, "mass": mass, "variance": var})
    return rows


def normal_block():
    ps = [1e-10, 1e-6, 0.001, 0.02425, 0.1, 0.5, 0.9, 0.975, 0.999]
    return {
        "quantiles": [{"p": p, "q": float(stats.norm.ppf(p))} for p in ps],
        "survival": [{"x": x, "sf": float(stats.norm.sf(x))} for x in (0.5, 1.96, 3.0, 5.0, 7.0)],
        "pStar2": float(2 * stats.norm.sf(2.0)),
    }


def bait_block():
    p_star = 2 * stats.norm.sf(2.0)
    rows = []
    for corr in (0.894, 0.707, 0.447, 0.243, 0.124):
        s2 = 1.0 / (corr * corr) - 1.0
        tau2 = s2 / (1 + s2)
        tau = math.sqrt(tau2)

        def q_of_x(x):
            mu = x / (1 + s2)
            return stats.norm.cdf((-2 - mu) / tau) + 1 - stats.norm.cdf((2 - mu) / tau)

        def kl(q, p):
            out = 0.0
            if q > 0:
                out += q * math.log(q / p)
            if q < 1:
                out += (1 - q) * math.log((1 - q) / (1 - p))
            return out

        sd = math.sqrt(1 + s2)

        def density(x):
            return stats.norm.pdf(x, scale=sd)

        d_log, _ = integrate.quad(lambda x: -kl(q_of_x(x), p_star) * density(x), -12 * sd, 12 * sd, epsabs=1e-14, limit=400)
        d_brier, _ = integrate.quad(lambda x: -((q_of_x(x) - p_star) ** 2) * density(x), -12 * sd, 12 * sd, epsabs=1e-14, limit=400)
        rows.append({"corr": corr, "meanDLog": d_log, "meanDBrier": d_brier})
    return {"pStar": p_star, "threshold": 2.0, "cells": rows}


def crps_block():
    base = 2.0 / math.sqrt(math.pi)
    return {
        "truth": 1.0 / math.sqrt(math.pi),
        "unfair": [{"m": m, "expected": base - base * (m - 1) / (2 * m)} for m in (2, 4, 16)],
    }


def dm_block():
    out = []
    for h in (3, 5, 8):
        rho2 = [((h - k) / h) ** 2 for k in range(1, h)]
        factor = 1 + 2 * sum((1 - k / h) * rho2[k - 1] for k in range(1, h))
        naive_factor = 1 + 2 * sum(rho2)
        out.append({
            "h": h,
            "bartlettFactor": factor,
            "rawFactor": naive_factor,
            "naiveRejection": float(2 * stats.norm.sf(1.96 / math.sqrt(naive_factor))),
        })
    return out


def w7_block():
    out = []
    p = 0.05
    z = float(stats.norm.isf(p))
    for rho in (0.05, 0.12, 0.15, 0.3):
        cov = [[1, rho], [rho, 1]]
        joint = float(stats.multivariate_normal(mean=[0, 0], cov=cov).cdf([-z, -z]))
        out.append({"p": p, "latentRho": rho, "indicatorCorrelation": (joint - p * p) / (p * (1 - p))})
    return out


def maxnormal_block():
    out = []
    for n in (10, 100, 1000):
        value, _ = integrate.quad(lambda x: x * n * stats.norm.pdf(x) * stats.norm.cdf(x) ** (n - 1), -10, 10, epsabs=1e-13, limit=400)
        out.append({"n": n, "expectedMax": value})
    return out


def probit_block():
    slope, noise, rho, base = 1.5, 0.4, 0.6, 0.05
    c = float(stats.norm.ppf(base)) * math.sqrt(1 + slope * slope)
    rows = []
    for oi in (-2.0, 0.0, 1.0, 3.0):
        for lag in (0, 1, 2):
            cov = rho ** lag
            var_oi = 1 + noise * noise
            mean = cov / var_oi * oi
            var = 1 - cov * cov / var_oi
            sd = math.sqrt(var)
            p, _ = integrate.quad(lambda x: stats.norm.cdf(c + slope * x) * stats.norm.pdf(x, loc=mean, scale=sd), mean - 12 * sd, mean + 12 * sd, epsabs=1e-14, limit=400)
            rows.append({"oi": oi, "lag": lag, "p": p})
    return {"slope": slope, "noise": noise, "rho": rho, "base": base, "c": c, "rows": rows}


def nb_logpmf_ratio_terms(x, mu, r):
    return r * np.log(r / (r + mu)) + x * np.log(mu / (r + mu))


def f1_fixed_block():
    from scipy.special import gammaln
    rng = np.random.default_rng(20261011)
    minutes = 390
    lam = 20000 / 390 / 3.0
    r = 2.0
    thetas = np.array([1.5, 2.0, 3.0, 5.0, 8.0])
    m2 = 1200
    harmonic = sum(1.0 / k for k in range(1, m2 + 1))
    line = m2 * harmonic / 0.10
    sessions = 12000
    chunk = 1000
    rows = []
    for sd_day in (0.0, 0.15, 0.25, 0.40):
        crossed = 0
        over20 = 0
        for _ in range(sessions // chunk):
            u = np.exp(rng.normal(-sd_day ** 2 / 2, sd_day, chunk)) if sd_day > 0 else np.ones(chunk)
            mu = lam * u[:, None] * np.ones((chunk, minutes))
            counts = rng.negative_binomial(r, r / (r + mu))
            l0 = nb_logpmf_ratio_terms(counts, lam, r)
            k = 0.0
            for th in thetas:
                k = k + np.exp(np.minimum(np.cumsum(nb_logpmf_ratio_terms(counts, th * lam, r) - l0, axis=1), 700))
            k = k / len(thetas)
            crossed += int(np.sum(np.any(k >= line, axis=1)))
            over20 += int(np.sum(np.max(k, axis=1) >= 20))
        rows.append({
            "sdDay": sd_day,
            "sessions": sessions,
            "crossLine": crossed / sessions,
            "maxAtLeast20": over20 / sessions,
        })
    return {"lambda": lam, "r": r, "thetas": thetas.tolist(), "line": line, "mPrime": m2, "alpha": 0.10, "minutes": minutes, "rows": rows}


def jump_gaussian_block():
    out = []
    c = 5.47
    for nu in (4, 5, 6, 8):
        scale = math.sqrt(nu / (nu - 2))
        p = 2 * float(stats.t.sf(c * scale, nu))
        out.append({"nu": nu, "threshold": c, "minutes": 390, "perMinute": p, "perNameDay": 1 - (1 - p) ** 390})
    p = 2 * float(stats.norm.sf(c))
    out.append({"nu": None, "threshold": c, "minutes": 390, "perMinute": p, "perNameDay": 1 - (1 - p) ** 390})
    return out


def multiplicity_block():
    m = 670
    alpha = 0.10
    harmonic = sum(1.0 / k for k in range(1, m + 1))
    return {
        "m": m,
        "alpha": alpha,
        "bhCompleteNull": 1 - (1 - alpha / m) ** m,
        "byCompleteNull": 1 - (1 - alpha / (m * harmonic)) ** m,
        "harmonic": harmonic,
    }


def main():
    out = {
        "provenance": {
            "generator": "tests/gen-truth-fixtures.py",
            "generatorSha256": hashlib.sha256(SCRIPT_BYTES).hexdigest(),
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "nature": "independent references for tests/truth/*: the generator's own sfc32 streams, the Hansen skew-t constants and "
                      "two-sided tail probabilities by closed form and by quadrature, the look-ahead bait's exact mean score "
                      "differences, the fair CRPS expectation, the overlap variance factor and the indicator correlation of the "
                      "calibration world; scipy for every distribution function, no draws",
        },
        "rng": rng_block(),
        "hansen": hansen_block(),
        "normal": normal_block(),
        "bait": bait_block(),
        "crps": crps_block(),
        "dm": dm_block(),
        "w7": w7_block(),
        "maxNormal": maxnormal_block(),
        "probit": probit_block(),
        "f1Fixed": f1_fixed_block(),
        "jumpGaussian": jump_gaussian_block(),
        "multiplicity": multiplicity_block(),
    }
    with open(OUT_PATH, "w") as handle:
        json.dump(out, handle, indent=1, sort_keys=True)
        handle.write("\n")
    print("wrote %s" % os.path.relpath(OUT_PATH, os.path.dirname(HERE)))


if __name__ == "__main__":
    main()
