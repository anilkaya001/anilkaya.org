import json, math, datetime as dt
import mpmath as mp
import scipy

mp.mp.dps = 40
UTC = dt.timezone.utc
YEAR = 365 * 86400
R = 0.04
S = 231.02
TAPE = dt.datetime(2026, 9, 30, 19, 59, tzinfo=UTC)
NIGHTLY = dt.datetime(2026, 9, 29, 20, 0, tzinfo=UTC)


def close_utc(day):
    y, m, d = map(int, day.split('-'))
    return dt.datetime(y, m, d, 20, 0, tzinfo=UTC)


def year_fraction(at, day):
    return (close_utc(day) - at).total_seconds() / YEAR


def svi_w(p, k):
    return p['a'] + p['b'] * (p['rho'] * (k - p['m']) + mp.sqrt((k - p['m']) ** 2 + p['sigma'] ** 2))


def svi_for(atm, T, b, rho, m, sigma):
    a = atm * atm * T - b * (rho * (0 - m) + math.sqrt(m * m + sigma * sigma))
    return {'a': a, 'b': b, 'rho': rho, 'm': m, 'sigma': sigma}


def make(expiry, atm, b, rho, m, sigma):
    T = year_fraction(TAPE, expiry)
    F = S * math.exp(R * T)
    D = math.exp(-R * T)
    p = svi_for(atm, T, b, rho, m, sigma)
    return T, F, D, p


def black76(F, D, K, vol, T, typ):
    v = vol * mp.sqrt(T)
    d1 = (mp.log(F / K) + v * v / 2) / v
    d2 = d1 - v
    N = lambda x: mp.ncdf(x)
    if typ == 'C':
        return D * (F * N(d1) - K * N(d2))
    return D * (K * N(-d2) - F * N(-d1))


def vol_at(p, F, T, K):
    return mp.sqrt(svi_w(p, mp.log(K / F)) / T)


def prob_above(p, F, D, T, x):
    c = lambda K: black76(F, D, K, vol_at(p, F, T, K), T, 'C')
    return float(-mp.e ** (R * T) * mp.diff(c, mp.mpf(x)))


def group(name, expiry, atm, b, rho, m, sigma, card_expiry, card_atm, lines):
    T, F, D, p = make(expiry, atm, b, rho, m, sigma)
    rows = []
    lo = math.ceil(F * 0.86 / 0.5) * 0.5
    hi = math.floor(F * 1.14 / 0.5) * 0.5
    K = lo
    while K <= hi + 1e-9:
        vol = float(vol_at(p, F, T, K))
        for typ in ('C', 'P'):
            px = float(black76(F, D, K, vol, T, typ))
            hs = max(0.005, 0.02 * px)
            rows.append({'K': K, 'type': typ, 'bid': max(0.01, round(px - hs, 2)), 'ask': round(px + hs, 2), 'iv': vol})
        K = round(K + 0.5, 6)
    Tc = year_fraction(NIGHTLY, card_expiry)
    pc = svi_for(card_atm, Tc, b, rho, m, sigma)
    out_lines = []
    for K, typ in lines:
        row = next(r for r in rows if r['K'] == K and r['type'] == typ)
        be = K - row['bid'] if typ == 'P' else S - row['bid']
        out_lines.append({'K': K, 'type': typ, 'strategy': 'csp' if typ == 'P' else 'cc', 'bid': row['bid'], 'ask': row['ask'],
                          'breakeven': round(be, 4), 'popQ': prob_above(p, F, D, T, be)})
    return {'name': name, 'expiry': expiry, 'T': T, 'F': F, 'D': D, 'svi': p,
            'card': {'expiry': card_expiry, 'T': Tc, 'params': pc, 'atm': card_atm},
            'rows': rows, 'lines': out_lines}


LINES = [(215.0, 'P'), (220.0, 'P'), (225.0, 'P'), (227.5, 'P'), (235.0, 'C'), (237.5, 'C'), (240.0, 'C')]
groups = [
    group('exact', '2026-10-01', 0.42, 0.0055, -0.3, 0.0, 0.03, '2026-10-01', 0.40, LINES),
    group('neighbour', '2026-10-02', 0.40, 0.0075, -0.3, 0.0, 0.04, '2026-10-01', 0.40, LINES),
]
out = {
    'source': 'mpmath %s / scipy %s, 40 digits. Each group is a synthetic chain priced off a raw SVI smile w(k) = a + b (rho (k - m) + sqrt((k - m)^2 + sigma^2)) at F = S e^{rT} with S = 231.02, r = 0.04, read at 2026-09-30T19:59Z, quotes = price -/+ max(0.005, 2%% of price) rounded to the cent. popQ is the risk-neutral probability of profit by Breeden-Litzenberger, P(S_T > x) = -e^{rT} dC/dK at x, with dC/dK taken by mpmath numerical differentiation of the Black-76 call priced on the generating smile: x is the breakeven K - bid for a short put and S - bid for a covered call (q = 0, so the shares pay no dividend). The card is the same shape at yesterday\'s level and clock (SVI for card.expiry at 2026-09-29 close), which is what the desk borrows.' % (mp.__version__, scipy.__version__),
    'spot': S, 'rate': R, 'tape': TAPE.strftime('%Y-%m-%dT%H:%M:%SZ'), 'groups': groups,
}
json.dump(out, open('fixtures-desk-lab.json', 'w'), indent=None, separators=(',', ':'))
for g in groups:
    print(g['name'], 'T', g['T'], 'rows', len(g['rows']))
    for l in g['lines']:
        print('  ', l['K'], l['type'], l['bid'], l['ask'], l['breakeven'], round(l['popQ'], 5))
