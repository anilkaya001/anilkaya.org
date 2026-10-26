import hashlib
import json
import platform
from pathlib import Path

import numpy as np
import scipy
from scipy.stats import median_abs_deviation

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-sigma.json"
WINDOW = 252
MIN_RETURNS = 200
SCALE = 1.4826


def sessions(n, last="2026-10-02"):
    end = np.datetime64(last)
    days = np.busday_offset(end, -np.arange(n)[::-1], roll="backward")
    return [str(d) for d in days]


def series(rng, n, df, vol):
    r = rng.standard_t(df, n - 1) * vol / np.sqrt(df / (df - 2))
    close = 100.0 * np.exp(np.concatenate([[0.0], np.cumsum(r)]))
    return [round(float(c), 6) for c in close]


def expect(days, closes):
    c = np.array(closes, dtype=float)
    r = np.log(c[1:] / c[:-1])
    r = r[-WINDOW:]
    n = len(r)
    out = {"n": n}
    if n < MIN_RETURNS:
        out.update({"ok": False, "reason": "history", "s": None, "f2": None, "f3": None})
        return out
    s = float(median_abs_deviation(r, scale=1.0 / SCALE))
    if not s > 0:
        out.update({"ok": False, "reason": "degenerate", "s": None, "f2": None, "f3": None})
        return out
    per = lambda k: int(np.floor(np.count_nonzero(np.abs(r) >= k * s) * 252 / n + 0.5))
    out.update({"ok": True, "reason": None, "s": s, "f2": per(2), "f3": per(3)})
    return out


def main():
    rng = np.random.default_rng(20261026)
    scenarios = []
    for i in range(32):
        n = int(rng.choice([150, 199, 200, 201, 230, 253, 254, 300, 400]))
        df = float(rng.choice([3.0, 4.0, 6.0, 30.0]))
        vol = float(rng.choice([0.004, 0.012, 0.02, 0.05]))
        days = sessions(n)
        closes = series(rng, n, df, vol)
        scenarios.append({"name": f"{n} sessions, t({df:g}), daily vol {vol}", "days": days, "closes": closes, "expect": expect(days, closes)})
    flat_days = sessions(260)
    flat = [50.0] * 260
    for k in (30, 90, 200):
        flat[k] = 51.0
    scenarios.append({"name": "an unchanged price on most sessions: the median absolute deviation is zero", "days": flat_days, "closes": flat, "expect": expect(flat_days, flat)})
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-sigma-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "reference": "scipy.stats.median_abs_deviation(r, scale=1/1.4826) on the last 252 log returns",
            "seed": 20261026,
            "synthetic": True,
        },
        "scenarios": scenarios,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    kinds = {}
    for s in scenarios:
        e = s["expect"]
        key = "ok" if e["ok"] else e["reason"]
        kinds[key] = kinds.get(key, 0) + 1
    print(len(scenarios), "scenarios", kinds)


main()
