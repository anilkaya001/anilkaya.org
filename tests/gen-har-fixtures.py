import json, math, hashlib, sys
import numpy as np
import statsmodels
import statsmodels.api as sm
from scipy import stats

SEED = 20261010
H = 21
LAG = 20
K = 0.34 / (1.34 + (H + 1) / (H - 1))
Z80 = float(stats.norm.ppf(0.9))


def make_bars(n, rng):
    omega, alpha, beta = 2.0e-6, 0.08, 0.90
    var = omega / (1 - alpha - beta)
    close = 100.0
    day = np.datetime64('2024-01-02')
    bars = []
    for i in range(n):
        while day.astype(object).weekday() >= 5:
            day += 1
        sig = math.sqrt(var)
        gap = rng.standard_normal() * sig * math.sqrt(0.2)
        o = close * math.exp(gap)
        m = 48
        steps = rng.standard_normal(m) * sig * math.sqrt(0.8 / m)
        path = o * np.exp(np.cumsum(steps))
        c = float(path[-1])
        h = float(max(o, path.max()))
        l = float(min(o, path.min()))
        r = math.log(c / close)
        bars.append({'d': str(day), 'o': round(o, 4), 'h': round(h, 4), 'l': round(l, 4), 'c': round(c, 4)})
        close = bars[-1]['c']
        var = omega + alpha * r * r + beta * var
        day += 1
    return bars


def daily_var(bars):
    out = []
    for i in range(1, len(bars)):
        b, p = bars[i], bars[i - 1]
        o = math.log(b['o'] / p['c'])
        c = math.log(b['c'] / b['o'])
        rs = math.log(b['h'] / b['c']) * math.log(b['h'] / b['o']) + math.log(b['l'] / b['c']) * math.log(b['l'] / b['o'])
        out.append(o * o + K * c * c + (1 - K) * rs)
    return np.array(out)


def design(v):
    n = len(v)
    X, y = [], []
    for t in range(20, n - H):
        X.append([1.0, v[t], v[t - 4:t + 1].mean(), v[t - 20:t + 1].mean()])
        y.append(v[t + 1:t + 1 + H].mean())
    last = n - 1
    xl = [1.0, v[last], v[last - 4:last + 1].mean(), v[last - 20:last + 1].mean()]
    return np.array(X), np.array(y), np.array(xl)


def fit(X, y, xl, lag):
    res = sm.OLS(y, X).fit(cov_type='HAC', cov_kwds={'maxlags': lag})
    cov = res.cov_params()
    s2 = float(res.ssr / (len(y) - X.shape[1]))
    yhat = float(xl @ res.params)
    sd = math.sqrt(s2 + float(xl @ cov @ xl))
    return {
        'lag': lag,
        'beta': [float(b) for b in res.params],
        'se': [float(b) for b in res.bse],
        'n': int(len(y)),
        's2': s2,
        'forecast': yhat,
        'sd': sd,
        'lo': max(yhat - Z80 * sd, 0.0),
        'hi': yhat + Z80 * sd,
    }


rng = np.random.default_rng(SEED)
bars = make_bars(330, rng)
v = daily_var(bars)
X, y, xl = design(v)
out = {
    'provenance': {
        'generator': 'tests/gen-har-fixtures.py',
        'statsmodels': statsmodels.__version__,
        'seed': SEED,
        'cov': "OLS(...).fit(cov_type='HAC', cov_kwds={'maxlags': L}), Bartlett weights, no small-sample correction",
        'k': K,
        'z80': Z80,
    },
    'bars': bars,
    'dailyVarHead': [float(x) for x in v[:5]],
    'dailyVarTail': [float(x) for x in v[-5:]],
    'rows': int(len(y)),
    'last': [float(x) for x in xl],
    'fits': [fit(X, y, xl, L) for L in (5, 20)],
    'short': {'bars': bars[:150]},
}
body = json.dumps(out, sort_keys=True, separators=(',', ':'))
out['provenance']['sha256'] = hashlib.sha256(body.encode()).hexdigest()
with open(sys.argv[1] if len(sys.argv) > 1 else 'fixtures-har.json', 'w') as f:
    json.dump(out, f, sort_keys=True, separators=(',', ':'))
    f.write('\n')
