import hashlib
import json
import platform
from fractions import Fraction
from pathlib import Path

import mpmath
import numpy as np
import scipy
from mpmath import mp, mpf
from scipy.stats import median_abs_deviation, norm, percentileofscore, rankdata

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-vol.json"
mp.dps = 50
YEAR = 252
HAR_HORIZON = 21
Q75 = float(norm.ppf(0.75))
Q90 = float(norm.ppf(0.90))


def days_ending(n, last="2026-10-02"):
    end = np.datetime64(last)
    return [str(d) for d in np.busday_offset(end, -np.arange(n)[::-1], roll="backward")]


def make_bars(seed, n, vol, gap_share):
    rng = np.random.default_rng(seed)
    close = 100.0
    out = []
    for d in days_ending(n):
        gap = rng.normal(0, vol * gap_share)
        o = close * np.exp(gap)
        c = o * np.exp(rng.normal(0, vol * (1 - gap_share)))
        spread = abs(rng.normal(0, vol * 0.4))
        h = max(o, c) * np.exp(spread)
        l = min(o, c) * np.exp(-abs(rng.normal(0, vol * 0.4)))
        o, h, l, c = (round(float(x), 4) for x in (o, h, l, c))
        h = max(h, o, c)
        l = min(l, o, c)
        out.append([d, o, h, l, c])
        close = c
    return out


def arrays(bars):
    a = np.array([b[1:] for b in bars], dtype=float)
    return a[:, 0], a[:, 1], a[:, 2], a[:, 3]


def yz_k(n):
    return 0.34 / (1.34 + (n + 1) / (n - 1))


def expect_series(bars):
    o, h, l, c = arrays(bars)
    out = {"c2c": {}, "yz": {}, "park": {}, "gap": {}}
    for n in (5, 10, 21, 63):
        r = np.diff(np.log(c[-(n + 1):]))
        out["c2c"][str(n)] = float(np.std(r, ddof=1) * np.sqrt(YEAR))
        ow, cw, hw, lw = o[-n:], c[-n:], h[-n:], l[-n:]
        prev = c[-(n + 1):-1]
        ov = np.log(ow / prev)
        cv = np.log(cw / ow)
        rs = np.log(hw / cw) * np.log(hw / ow) + np.log(lw / cw) * np.log(lw / ow)
        k = yz_k(n)
        var = np.var(ov, ddof=1) + k * np.var(cv, ddof=1) + (1 - k) * np.mean(rs)
        out["yz"][str(n)] = float(np.sqrt(var * YEAR))
        out["park"][str(n)] = float(np.sqrt(np.mean(np.log(hw / lw) ** 2) / (4 * np.log(2)) * YEAR))
        cc = np.log(cw / prev)
        out["gap"][str(n)] = float(np.var(ov, ddof=1) / np.var(cc, ddof=1))
    r_all = np.diff(np.log(c))
    out["returns"] = [float(x) for x in r_all]
    roll = []
    n = 21
    for i in range(n - 1, len(r_all)):
        roll.append([i, float(np.std(r_all[i - n + 1:i + 1], ddof=1) * np.sqrt(YEAR))])
    out["roll21"] = roll
    k = yz_k(HAR_HORIZON)
    daily = []
    for i in range(1, len(bars)):
        ov = np.log(o[i] / c[i - 1])
        cv = np.log(c[i] / o[i])
        rs = np.log(h[i] / c[i]) * np.log(h[i] / o[i]) + np.log(l[i] / c[i]) * np.log(l[i] / o[i])
        daily.append(float(ov * ov + k * cv * cv + (1 - k) * rs))
    out["daily"] = daily
    out["estimators"] = {
        "closeToClose": float(np.std(r_all, ddof=1) * np.sqrt(YEAR)),
        "zeroMeanRms": float(np.sqrt(np.mean(r_all ** 2) * YEAR)),
        "parkinson": float(np.sqrt(np.mean(np.log(h / l) ** 2) / (4 * np.log(2)) * YEAR)),
    }
    return out


def series_cases():
    cases = []
    for name, seed, n, vol, gap in [
        ("quiet large cap, 120 sessions", 11, 120, 0.009, 0.3),
        ("volatile small cap, 300 sessions", 12, 300, 0.035, 0.5),
        ("gap-driven, 90 sessions", 13, 90, 0.02, 0.8),
        ("range-driven, 200 sessions", 14, 200, 0.015, 0.1),
    ]:
        bars = make_bars(seed, n, vol, gap)
        cases.append({"name": name, "bars": bars, "expect": expect_series(bars)})
    return cases


def rank_case(history, current, today_in):
    h = np.array(history, dtype=float)
    lo, hi = float(min(h.min(), current)), float(max(h.max(), current))
    return {
        "history": history,
        "current": current,
        "todayIn": today_in,
        "rank": None if not hi > lo else (current - lo) / (hi - lo),
        "pct": float(percentileofscore(h, current, kind="weak") / 100.0),
    }


def rank_cases():
    rng = np.random.default_rng(31)
    cases = []
    prior = [0.2] * 251 + [0.8]
    cases.append(rank_case(prior + [0.3], 0.3, True))
    cases.append(rank_case(prior, 0.3, False))
    for i in range(40):
        n = int(rng.choice([5, 20, 60, 252]))
        h = [round(float(x), 3) for x in np.clip(rng.normal(0.35, 0.12, n), 0.05, 1.5)]
        cur = h[-1] if i % 2 == 0 else round(float(rng.normal(0.35, 0.2)), 3)
        cases.append(rank_case(h, cur, i % 2 == 0))
    cases.append(rank_case([0.4, 0.4, 0.4, 0.4], 0.4, True))
    cases.append(rank_case([0.2, 0.3, 0.3, 0.3, 0.5], 0.3, True))
    return cases


def exact_event(s1, t1, s2, t2):
    s1, t1, s2, t2 = (Fraction(x) for x in (s1, t1, s2, t2))
    if not (t1 > 0 and t2 > t1):
        return {"code": "input-absent"}
    sd2 = (s2 * s2 * t2 - s1 * s1 * t1) / (t2 - t1)
    if not sd2 > 0:
        return {"code": "calendar-arbitrage"}
    j2 = t1 * (s1 * s1 - sd2)
    sd2m = mpf(sd2.numerator) / mpf(sd2.denominator)
    if not j2 > 0:
        return {"code": "no-premium", "diffusive": float(mp.sqrt(sd2m))}
    j = mp.sqrt(mpf(j2.numerator) / mpf(j2.denominator))
    return {"code": None, "diffusive": float(mp.sqrt(sd2m)), "sd": float(j), "meanAbs": float(j * mp.sqrt(2 / mp.pi))}


def exact_forward(s1, t1, s2, t2):
    s1, t1, s2, t2 = (Fraction(x) for x in (s1, t1, s2, t2))
    if not (t1 > 0 and t2 > t1):
        return {"code": "input-absent"}
    w = s2 * s2 * t2 - s1 * s1 * t1
    if not w > 0:
        return {"code": "calendar-arbitrage"}
    q = w / (t2 - t1)
    return {"code": None, "vol": float(mp.sqrt(mpf(q.numerator) / mpf(q.denominator)))}


def event_cases():
    rng = np.random.default_rng(41)
    out = []
    for s in (0.2, 0.25, 0.3, 0.35, 0.4, 0.55, 0.8, 1.1):
        for d1 in (1, 2, 3, 5, 7, 10, 14, 21):
            for d2 in (8, 14, 30, 45, 60, 90, 180):
                if d2 > d1:
                    out.append({"front": {"vol": s, "T": d1 / 365}, "back": {"vol": s, "T": d2 / 365}, "kind": "flat", "expect": exact_event(s, d1 / 365, s, d2 / 365), "fwd": exact_forward(s, d1 / 365, s, d2 / 365)})
    for _ in range(300):
        s1 = round(float(rng.uniform(0.15, 1.2)), 4)
        s2 = round(float(rng.uniform(0.15, 1.2)), 4)
        t1 = float(rng.integers(1, 40)) / 365 + float(rng.integers(0, 390)) / 525600
        t2 = t1 + float(rng.integers(1, 200)) / 365
        out.append({"front": {"vol": s1, "T": t1}, "back": {"vol": s2, "T": t2}, "kind": "random", "expect": exact_event(s1, t1, s2, t2), "fwd": exact_forward(s1, t1, s2, t2)})
    for front, back in [
        ({"vol": 0.4, "T": 0.1}, {"vol": 0.4, "T": 0.05}),
        ({"vol": 0.4, "T": 0.1}, {"vol": 0.5, "T": 0.1}),
        ({"vol": 0.4, "T": 0.0}, {"vol": 0.45, "T": 0.1}),
        ({"vol": 0.6, "T": 7 / 365}, {"vol": 0.45, "T": 30 / 365}),
        ({"vol": 0.3, "T": 7 / 365}, {"vol": 0.6, "T": 30 / 365}),
        ({"vol": 0.9, "T": 3 / 365}, {"vol": 0.2, "T": 4 / 365}),
    ]:
        out.append({"front": front, "back": back, "kind": "edge", "expect": exact_event(front["vol"], front["T"], back["vol"], back["T"]), "fwd": exact_forward(front["vol"], front["T"], back["vol"], back["T"])})
    return out


def z_cases():
    rng = np.random.default_rng(51)
    out = []
    for n in (40, 60, 63, 120, 252):
        xs = [round(float(x), 4) for x in rng.normal(0.4, 0.1, n)]
        x = round(float(rng.normal(0.45, 0.12)), 4)
        out.append({"x": x, "xs": xs, "min": 40, "z": float((x - np.mean(xs)) / np.std(xs, ddof=1)), "n": n, "degenerate": False})
    for v in (0.1, 0.2, 0.3, 0.35, 0.7, 1.1, 12.3):
        for n in (40, 60, 252):
            out.append({"x": v, "xs": [v] * n, "min": 40, "z": None, "n": n, "degenerate": True})
    return out


def pearson_cases():
    rng = np.random.default_rng(61)
    out = []
    for n in (5, 20, 60):
        x = [round(float(v), 4) for v in rng.normal(0, 1, n)]
        y = [round(float(0.5 * a + rng.normal(0, 1)), 4) for a in x]
        out.append({"x": x, "y": y, "r": float(np.corrcoef(x, y)[0, 1])})
    ys = [round(float(v), 4) for v in rng.normal(0, 1, 40)]
    for v in (0.1, 0.3, 0.7, 12.3):
        out.append({"x": [v] * 40, "y": ys, "r": None})
        out.append({"x": ys, "y": [v] * 40, "r": None})
    return out


def xsec_cases():
    rng = np.random.default_rng(71)
    vectors = []
    for n in (2, 3, 7, 25, 120):
        base = rng.standard_t(3, n)
        vals = [round(float(x), 2) for x in base]
        vectors.append(vals)
    tied = [1.0, 1.0, 2.0, 2.0, 2.0, 5.0, 9.0, 9.0]
    vectors.append(tied)
    holes = [0.3, None, 0.1, 0.1, None, 4.0, -2.0, 0.1, 0.5, 0.2, 0.25]
    vectors.append(holes)
    vectors.append([7.0])
    vectors.append([3.0, 3.0, 3.0, 3.0])
    vectors.append([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])
    vectors.append([3.0] * 7 + [10.0, 20.0, 30.0])
    out = []
    for vals in vectors:
        a = np.array([np.nan if v is None else v for v in vals], dtype=float)
        fin = np.isfinite(a)
        ok = a[fin]
        m = ok.size
        pr = [None] * len(vals)
        if m == 1:
            pr[int(np.where(fin)[0][0])] = 0.5
        elif m > 1:
            ranks = rankdata(ok, method="average") / (m + 1)
            j = 0
            for i in range(len(vals)):
                if fin[i]:
                    pr[i] = float(ranks[j])
                    j += 1
        q = {}
        w = {}
        share = [None if not fin[i] else float(percentileofscore(ok, a[i], kind="weak") / 100.0) for i in range(len(vals))]
        mad = float(median_abs_deviation(ok, scale="normal")) if m else None
        var = float(np.var(ok, ddof=1)) if m > 1 else None
        if m:
            for p in (0.0, 0.02, 0.1, 0.25, 0.5, 0.9, 0.98, 1.0):
                q[str(p)] = float(np.quantile(ok, p))
            for p in (0.01, 0.02, 0.1):
                lo, hi = float(np.quantile(ok, p)), float(np.quantile(ok, 1 - p))
                w[str(p)] = [None if not fin[i] else float(min(max(a[i], lo), hi)) for i in range(len(vals))]
        out.append({"values": vals, "percentileRank": pr, "share": share, "mad": mad, "var": var, "quantile": q, "winsorize": w, "robustZ": robust_z(a)})
    return out


def robust_z(a, clamp=3.0):
    fin = np.isfinite(a)
    ok = a[fin]
    n = len(a)
    if ok.size < 2:
        return [0.0] * n
    med = float(np.median(ok))
    mad = float(median_abs_deviation(ok, scale="normal"))
    iqr = float((np.quantile(ok, 0.75) - np.quantile(ok, 0.25)) / (2 * Q75))
    wide = float((np.quantile(ok, 0.90) - np.quantile(ok, 0.10)) / (2 * Q90))
    scale = max(mad, iqr, wide)
    if not np.isfinite(scale) or scale <= 1e-12:
        mean = float(np.mean(ok))
        sd = float(np.std(ok, ddof=1))
        if not np.isfinite(sd) or sd <= 1e-12:
            return [0.0] * n
        return [float(min(max((x - mean) / sd, -clamp), clamp)) if np.isfinite(x) else 0.0 for x in a]
    return [float(min(max((x - med) / scale, -clamp), clamp)) if np.isfinite(x) else 0.0 for x in a]


def flat_var_cases():
    out = []
    for v in (0.1, 0.2, 0.3, 0.35, 0.7, 1.1, 12.3, 41.7):
        for n in (2, 3, 40, 60, 252):
            out.append({"values": [v] * n, "var": 0.0})
    return out


def move_cases():
    out = []
    for vol in (0.15, 0.3, 0.4, 0.9):
        for sessions in (1, 5, 10, 21):
            out.append({"vol": vol, "sessions": sessions, "move": float(mpf(vol) * mp.sqrt(mpf(sessions) / YEAR))})
    return out


def main():
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-vol-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "mpmath": mpmath.__version__,
            "references": "numpy.std ddof=1 and sqrt(252) for realized volatility, scipy.stats.percentileofscore kind=weak, scipy.stats.rankdata average, numpy.quantile linear, scipy.stats.median_abs_deviation scale=normal, mpmath at 50 digits for the term-structure algebra",
            "seed": [11, 12, 13, 14, 31, 41, 51, 61, 71],
            "synthetic": True,
        },
        "series": series_cases(),
        "rank": rank_cases(),
        "event": event_cases(),
        "z": z_cases(),
        "pearson": pearson_cases(),
        "xsec": xsec_cases(),
        "flatVar": flat_var_cases(),
        "move": move_cases(),
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False) + "\n")
    print({k: len(v) for k, v in doc.items() if isinstance(v, list)})


main()
