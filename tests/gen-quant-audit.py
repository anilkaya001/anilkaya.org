import argparse, datetime as dt, hashlib, json, math, os, sys
from zoneinfo import ZoneInfo
import numpy as np
import scipy
from scipy import stats
from scipy.special import gamma

SEED = 20260930
PATHS = 2_000_000
OMEGA, ALPHA, BETA, NU, LAM, SIGMA2_NEXT = 1.45e-5, 0.08, 0.89, 5.0, -0.05, 5.5e-4
SPOT, RATE = 231.02, 0.04
HORIZONS = [1, 2, 3, 4, 5, 7, 10, 15, 21]
Z_GRID = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]
NEW_YORK = ZoneInfo('America/New_York')
SESSION_OPEN, SESSION_CLOSE = dt.time(9, 30), dt.time(16, 0)
SESSION_MINUTES = 390
YEAR = 365 * 86400
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures-quant-audit.json')

STUDENT_CDF = [(-2.0, 5.0), (1.3, 2.5), (-0.4, 30.0), (-40.0, 2.05), (3.2, 7.3)]
STUDENT_PPF = [(0.01, 5.0), (1e-09, 2.05), (0.3, 30.0), (0.4999, 3.3), (1e-06, 6.0)]
SKEWT_PPF = [
    (1e-05, 5.0, -0.05), (0.001, 5.0, -0.05), (0.05, 5.0, -0.05), (0.4, 5.0, -0.05), (0.5, 5.0, -0.05),
    (0.7, 5.0, -0.05), (0.95, 5.0, -0.05), (0.999, 5.0, -0.05), (0.99999, 5.0, -0.05),
    (0.001, 8.0, 0.3), (0.2, 8.0, 0.3), (0.9, 8.0, 0.3),
    (0.002, 3.5, -0.4), (0.6, 3.5, -0.4), (0.995, 3.5, -0.4),
]
PUT = {'K': 225, 'credit': 0.68, 'expiry': '2026-10-01'}
INTRADAY = [
    ('09:35', '2026-09-30T13:35:00Z'), ('11:30', '2026-09-30T15:30:00Z'), ('13:30', '2026-09-30T17:30:00Z'),
    ('15:30', '2026-09-30T19:30:00Z'), ('15:59', '2026-09-30T19:59:00Z'), ('20:00', '2026-10-01T00:00:00Z'),
]
ZDTE = [('zdte-15:30', '2026-10-01T19:30:00Z', 226.0, 0.02), ('zdte-10:00', '2026-10-01T14:00:00Z', 226.0, 0.35)]
EXPIRY_CLOSE = dt.datetime(2026, 10, 1, 20, 0, tzinfo=dt.timezone.utc)


def sig(x, n):
    return float('%.*g' % (n, x))


def intify(x):
    return int(x) if float(x).is_integer() else x


def skewt_ppf(u, nu, lam):
    c = gamma((nu + 1) / 2) / (np.sqrt(np.pi * (nu - 2)) * gamma(nu / 2))
    a = 4 * lam * c * (nu - 2) / (nu - 1)
    b = np.sqrt(1 + 3 * lam * lam - a * a)
    u = np.atleast_1d(np.asarray(u, dtype=float))
    low = u < (1 - lam) / 2
    out = np.empty_like(u)
    out[low] = (1 - lam) / b * np.sqrt((nu - 2) / nu) * stats.t.ppf(u[low] / (1 - lam), nu) - a / b
    out[~low] = (1 + lam) / b * np.sqrt((nu - 2) / nu) * stats.t.ppf((u[~low] + lam) / (1 + lam), nu) - a / b
    return out


def sessions(rng, weights):
    s2 = np.full(PATHS, SIGMA2_NEXT)
    total = np.zeros(PATHS)
    for w in weights:
        z = skewt_ppf(rng.random(PATHS), NU, LAM)
        r = np.sqrt(s2) * z
        total += w * r
        s2 = OMEGA + ALPHA * r * r + BETA * s2
    return total


def analytic_sd(h):
    phi = ALPHA + BETA
    long_run = OMEGA / (1 - phi)
    return math.sqrt((long_run + (SIGMA2_NEXT - long_run) * (1 - phi ** h) / (h * (1 - phi))) * h)


def law_ref():
    rng = np.random.default_rng(SEED)
    total = np.zeros(PATHS)
    s2 = np.full(PATHS, SIGMA2_NEXT)
    horizons = {}
    for d in range(1, max(HORIZONS) + 1):
        z = skewt_ppf(rng.random(PATHS), NU, LAM)
        r = np.sqrt(s2) * z
        total += r
        s2 = OMEGA + ALPHA * r * r + BETA * s2
        if d not in HORIZONS:
            continue
        x = total - np.log(np.mean(np.exp(total)))
        an = analytic_sd(d)
        ks = [g * an for g in Z_GRID]
        horizons[str(d)] = {
            'sdSample': sig(total.std(), 6),
            'sdAnalytic': sig(an, 6),
            'z': [intify(g) for g in Z_GRID],
            'cdf': [round(float((x <= k).mean()), 6) for k in ks],
            'callOverSpot': [sig(float(np.mean(np.maximum(np.exp(x) - math.exp(k), 0))), 6) for k in ks],
        }
    return {
        'provenance': 'scipy %s numpy %s; 2,000,000-path Hansen skew-t GARCH(1,1) (omega 1.45e-5, alpha .08, beta .89, nu 5, lambda -.05, sigma2Next 5.5e-4), inverse-CDF draws via scipy t.ppf, seed 20260930, log-returns shifted so E[S_T/S] = 1; cdf at k = z * analytic sd, call = E[(S_T/S - e^k)+]' % (scipy.__version__, np.__version__),
        'horizons': horizons,
    }


def parse(iso):
    return dt.datetime.strptime(iso, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)


def minutes_left(tape):
    local = tape.astimezone(NEW_YORK)
    opened = dt.datetime.combine(local.date(), SESSION_OPEN, NEW_YORK)
    closed = dt.datetime.combine(local.date(), SESSION_CLOSE, NEW_YORK)
    if local < opened:
        return SESSION_MINUTES
    if local >= closed:
        return 0
    return round((closed - local).total_seconds() / 60)


def priced(total, T, strike, credit):
    x = total - np.log(np.mean(np.exp(total))) + RATE * T
    st = SPOT * np.exp(x)
    pop = round(float((st >= strike - credit).mean()), 7)
    payoff = float(np.maximum(strike - st, 0).mean())
    return pop, 100 * (credit - math.exp(-RATE * T) * payoff)


def intraday():
    rng = np.random.default_rng(SEED)
    cases, zdte = [], []
    for label, iso in INTRADAY:
        tape = parse(iso)
        left = minutes_left(tape)
        T = (EXPIRY_CLOSE - tape).total_seconds() / YEAR
        if left == 0:
            h_eff, weights = 1, [1.0]
        else:
            h_eff, weights = 1 + left / SESSION_MINUTES, [math.sqrt(left / SESSION_MINUTES), 1.0]
        total = sessions(rng, weights)
        pop, ev = priced(total, T, PUT['K'], PUT['credit'])
        cases.append({'label': label, 'tape': iso, 'hEff': h_eff, 'T': T, 'popP': pop, 'evP': ev})
    for label, iso, strike, bid in ZDTE:
        tape = parse(iso)
        left = minutes_left(tape)
        T = (EXPIRY_CLOSE - tape).total_seconds() / YEAR
        h_eff = left / SESSION_MINUTES
        total = sessions(rng, [math.sqrt(h_eff)])
        pop, ev = priced(total, T, strike, bid)
        zdte.append({'label': label, 'tape': iso, 'hEff': h_eff, 'T': T, 'K': strike, 'bid': bid, 'popP': pop, 'evP': ev})
    return {
        'provenance': 'scipy %s numpy %s; 2,000,000-path skew-t GARCH(1,1) by scipy t.ppf inverse-CDF, seed %d; first session weighted by sqrt(fraction of the session left)' % (scipy.__version__, np.__version__, SEED),
        'cases': cases, 'zdte': zdte,
    }


def build():
    return {
        'garch': {'omega': OMEGA * 1e4, 'alpha': ALPHA, 'beta': BETA, 'nu': intify(NU), 'lambda': LAM, 'sigma2Next': SIGMA2_NEXT},
        'lawRef': law_ref(),
        'studentCdf': [{'t': t, 'nu': nu, 'p': float('%.13g' % stats.t.cdf(t, nu))} for t, nu in STUDENT_CDF],
        'studentPpf': [{'p': p, 'nu': nu, 'q': float('%.12g' % stats.t.ppf(p, nu))} for p, nu in STUDENT_PPF],
        'skewtPpf': [{'u': u, 'nu': nu, 'lambda': lam, 'z': float('%.12g' % skewt_ppf([u], nu, lam)[0])} for u, nu, lam in SKEWT_PPF],
        'intraday': intraday(),
    }


def self_hash():
    with open(os.path.abspath(__file__), 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def strip(doc):
    return {k: v for k, v in doc.items() if k != 'generator'}


def close(a, b, path, bad):
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            bad.append('%s: keys %s vs %s' % (path, sorted(a), sorted(b)))
            return
        for k in a:
            close(a[k], b[k], path + '.' + k, bad)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            bad.append('%s: length %d vs %d' % (path, len(a), len(b)))
            return
        for i, (x, y) in enumerate(zip(a, b)):
            close(x, y, '%s[%d]' % (path, i), bad)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if a != b and abs(a - b) > 1e-12 * max(1.0, abs(b)):
            bad.append('%s: %r vs %r' % (path, a, b))
    elif a != b:
        bad.append('%s: %r vs %r' % (path, a, b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    doc = build()
    doc = {'generator': {'path': 'tests/gen-quant-audit.py', 'sha256': self_hash(),
                         'numpy': np.__version__, 'scipy': scipy.__version__}, **doc}
    if args.check:
        with open(args.out) as f:
            committed = json.load(f)
        bad = []
        close(strip(doc), strip(committed), '$', bad)
        if committed.get('generator', {}).get('sha256') != doc['generator']['sha256']:
            bad.append('generator.sha256: %s vs %s' % (doc['generator']['sha256'], committed.get('generator', {}).get('sha256')))
        for line in bad:
            print(line)
        print('gen-quant-audit: %d difference(s)' % len(bad))
        sys.exit(1 if bad else 0)
    with open(args.out, 'w') as f:
        json.dump(doc, f, indent=1)
    print('wrote', args.out)


main()
