import hashlib
import json
import platform
import random
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, getcontext
from fractions import Fraction
from pathlib import Path

getcontext().prec = 50
HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-browser.json"
F = Fraction
D = Decimal
SECTORS = ["Technology", "Energy", "Healthcare", "Financial Services"]
Z95 = D("1.959963984540054")


def fl(x):
    return None if x is None else float(x)


def dec(x):
    return D(x.numerator) / D(x.denominator) if isinstance(x, Fraction) else D(x)


def half_up(x):
    return int(dec(x).quantize(D(1), rounding=ROUND_HALF_UP))


def atanh(x):
    return (((1 + x) / (1 - x)).ln()) / 2


def tanh(x):
    e = (2 * x).exp()
    return (e - 1) / (e + 1)


def split(r):
    p = r["prem"]
    x = r["askPrem"] if r["askPrem"] is not None and r["askPrem"] >= 0 else None
    y = r["bidPrem"] if r["bidPrem"] is not None and r["bidPrem"] >= 0 else None
    a = F(x or 0)
    b = F(y or 0)
    k = F(p) / (a + b) if a + b > p else F(1)
    return a * k, b * k, max(F(0), p - (a + b) * k), x is not None, y is not None


def updown(r):
    a, b, _, _, _ = split(r)
    if r["cp"] == "C":
        return a, b
    if r["cp"] == "P":
        return b, a
    return F(0), F(0)


def alerts(rng):
    names = ["SYX%d" % (101 + i) for i in range(18)] + ["SPY", "QQQ", "XLK", "SYX190"]
    sec = {n: rng.randrange(len(SECTORS)) for n in names if n.startswith("SYX")}
    sec["SYX117"] = None
    del sec["SYX190"]
    open_at = datetime(2026, 11, 2, 14, 30, tzinfo=timezone.utc)
    rows = []
    for i in range(420):
        t = rng.choice(names[:14]) if i % 3 else rng.choice(names)
        prem = rng.randint(20000, 4000000)
        mode = rng.random()
        if mode < 0.08:
            a, b = None, None
        elif mode < 0.12:
            a, b = rng.randint(0, prem), None
        elif mode < 0.16:
            a, b = prem, rng.randint(1, prem)
        else:
            a = rng.randint(0, prem)
            b = rng.randint(0, prem - a)
        minute = rng.randint(0, 389)
        cp = rng.choice(["C", "P"]) if rng.random() > 0.02 else None
        rows.append(dict(t=t, cp=cp, prem=prem, askPrem=a, bidPrem=b, size=rng.choice([None, rng.randint(1, 9000)]),
                         spanStart=(open_at + timedelta(minutes=minute)).strftime("%Y-%m-%dT%H:%M:%SZ"), exp="2026-11-20"))
    rows.append(dict(t="SYX101", cp="C", prem=0, askPrem=0, bidPrem=0, size=1, spanStart="2026-11-02T15:00:00Z", exp="2026-11-20"))
    uni_t = [n for n in names if n.startswith("SYX") and n != "SYX190"]
    universe = dict(status="ok", t=uni_t, sec=[sec[n] for n in uni_t], sectors=SECTORS)
    good = [r for r in rows if r["prem"] > 0]

    def klass(t):
        if t in ("SPY", "QQQ"):
            return "funds:" + t
        if t == "XLK":
            return "etf:XLK"
        s = sec.get(t)
        return "stocks:" + (SECTORS[s] if s is not None else "No sector")
    tiles = {}
    total = sum(r["prem"] for r in good)
    for r in good:
        up, down = updown(r)
        x = tiles.setdefault(klass(r["t"]), dict(n=0, prem=0, up=F(0), down=F(0), vol=0, volN=0))
        x["n"] += 1
        x["prem"] += r["prem"]
        x["up"] += up
        x["down"] += down
        if r["size"] is not None:
            x["vol"] += r["size"]
            x["volN"] += 1
    floor = {}
    for k, x in tiles.items():
        net = x["up"] - x["down"]
        ratio = net / x["prem"]
        floor[k] = dict(n=x["n"], prem=x["prem"], up=fl(x["up"]), down=fl(x["down"]), nx=fl(x["prem"] - x["up"] - x["down"]), vol=x["vol"], volN=x["volN"],
                        net=fl(net), share=fl(F(x["prem"], total)), ratio=fl(ratio),
                        cat=None if abs(abs(ratio) - F(1, 10)) < F(1, 10 ** 9) else ("mixed" if abs(ratio) < F(1, 10) else ("up" if ratio > 0 else "down")))

    def lane(t):
        if t in ("SPY", "QQQ"):
            return "Index funds"
        s = sec.get(t)
        return SECTORS[s] if s is not None else "No sector"
    lanes = {}
    sides = []
    for r in good:
        up, down = updown(r)
        x = lanes.setdefault(lane(r["t"]), dict(n=0, prem=0, up=F(0), down=F(0)))
        x["n"] += 1
        x["prem"] += r["prem"]
        x["up"] += up
        x["down"] += down
        a, b, none, sa, sb = split(r)
        side = "nx"
        if r["cp"] in ("C", "P") and sa and sb:
            cls = half_up((a + b) / (a + b + none) * 100)
            if a + b > 0 and cls >= 50:
                sh = half_up(a / (a + b) * 100)
                word = "ask" if sh >= 65 else ("bid" if sh <= 35 else "mixed")
                c = r["cp"] == "C"
                side = ("up" if c else "down") if word == "ask" else (("down" if c else "up") if word == "bid" else "nx")
        sides.append(side)
    river = dict(total=total, pMax=max(r["prem"] for r in good), sides=sides,
                 lanes={k: dict(n=x["n"], prem=x["prem"], up=fl(x["up"]), down=fl(x["down"]), nx=fl(x["prem"] - x["up"] - x["down"])) for k, x in lanes.items()})

    bull = bear = noside = F(0)
    by = {}
    for r in good:
        if r["cp"] in ("C", "P"):
            a, b, _, _, _ = split(r)
        else:
            a, b = F(0), F(0)
        c = r["cp"] == "C"
        bull += a if c else b
        bear += b if c else a
        noside += max(F(0), r["prem"] - a - b)
        for kind, v in ((("ca" if c else "pa"), a), (("cb" if c else "pb"), b)):
            if v > F(r["prem"]) / 10 ** 9:
                by[r["t"] + "|" + kind] = by.get(r["t"] + "|" + kind, F(0)) + v
    flagged = total
    net = dict(flagged=flagged, total=fl(bull + bear), bull=fl(bull), bear=fl(bear), nx=fl(noside), share=fl((bull + bear) / flagged),
               bullLo=fl(bull / flagged), bullHi=fl((flagged - bear) / flagged), bearLo=fl(bear / flagged), bearHi=fl((flagged - bull) / flagged),
               windows=len(good), top={k: fl(v) for k, v in by.items()})

    parts = []
    for r in good:
        at = int(datetime.strptime(r["spanStart"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000)
        if r["cp"] in ("C", "P"):
            a, b, _, _, _ = split(r)
            lean = a - b if r["cp"] == "C" else b - a
        else:
            lean = F(0)
        parts.append((r["t"], at, r["prem"], lean))
    bin_ms = 600000
    b0 = min(p[1] for p in parts) // bin_ms
    B = max(p[1] for p in parts) // bin_ms - b0 + 1
    ser = {}
    for t, at, prem, lean in parts:
        s = ser.setdefault(t, dict(A=[F(0)] * B, L=[F(0)] * B, prem=0, active=set()))
        b = at // bin_ms - b0
        s["A"][b] += prem
        s["L"][b] += lean
        s["prem"] += prem
        s["active"].add(b)
    cand = sorted([t for t in ser if len(ser[t]["active"]) >= 4], key=lambda t: (-ser[t]["prem"], t))[:12]

    def pearson(x, y):
        n = len(x)
        if n < 3:
            return None
        mx = sum(x) / n
        my = sum(y) / n
        sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
        sxx = sum((a - mx) ** 2 for a in x)
        syy = sum((b - my) ** 2 for b in y)
        if not sxx > 0 or not syy > 0:
            return None
        return max(D(-1), min(D(1), sxy / (sxx * syy).sqrt()))

    def resid(x, f):
        n = len(x)
        mx = sum(x) / n
        mf = sum(f) / n
        sff = sum((v - mf) ** 2 for v in f)
        b = sum((a - mx) * (v - mf) for a, v in zip(x, f)) / sff if sff > 0 else D(0)
        return [a - mx - b * (v - mf) for a, v in zip(x, f)]

    def partial(x, y, f):
        if len(x) < 4:
            return None
        return pearson(resid(x, f), resid(y, f))

    def std(x):
        n = len(x)
        m = sum(x) / n
        sd = (sum((v - m) ** 2 for v in x) / n).sqrt()
        return [(v - m) / sd if sd > 0 else D(0) for v in x]

    def fisher(r, n, k):
        if r is None or n - k < 4:
            return None
        rr = max(D("-0.999999"), min(D("0.999999"), r))
        z = atanh(rr)
        se = 1 / D(n - k - 3).sqrt()
        return tanh(z - Z95 * se), tanh(z + Z95 * se)
    A = {t: [dec(v) for v in ser[t]["A"]] for t in cand}
    L = {t: [dec(v) for v in ser[t]["L"]] for t in cand}
    zs = {t: std(A[t]) for t in cand}
    tot = [sum(zs[t][b] for t in cand) for b in range(B)]
    half = B // 2
    pairs = {"A": {}, "L": {}, "P": {}}
    sgn = lambda v: (v > 0) - (v < 0)
    for layer in "ALP":
        src = L if layer == "L" else A
        for i, a in enumerate(cand):
            for b in cand[i + 1:]:
                x, y = src[a], src[b]
                if layer == "P":
                    f = [tot[q] - zs[a][q] - zs[b][q] for q in range(B)]
                    r = partial(x, y, f)
                    r1 = partial(x[:half], y[:half], f[:half])
                    r2 = partial(x[half:], y[half:], f[half:])
                    ci = fisher(r, B, 1)
                else:
                    r = pearson(x, y)
                    r1 = pearson(x[:half], y[:half])
                    r2 = pearson(x[half:], y[half:])
                    ci = fisher(r, B, 0)
                passed = r is not None and ci is not None and (ci[0] > 0 or ci[1] < 0) and abs(r) >= D("0.3")
                same = r1 is not None and r2 is not None and sgn(r1) == sgn(r) and sgn(r2) == sgn(r)
                edge = r is None or abs(abs(r) - D("0.3")) < D("1e-9") or (ci is not None and (abs(ci[0]) < D("1e-9") or abs(ci[1]) < D("1e-9")))
                pairs[layer][a + "|" + b] = dict(r=fl(r), lo=fl(ci[0]) if ci else None, hi=fl(ci[1]) if ci else None, r1=fl(r1), r2=fl(r2),
                                                 passed=None if edge else passed, stable=None if edge else (passed and same))
    relations = dict(bins=B, windows=len(good), names=cand, A={t: [fl(v) for v in ser[t]["A"]] for t in cand},
                     L={t: [fl(v) for v in ser[t]["L"]] for t in cand}, pairs=pairs)
    return dict(rows=rows, universe=universe, session="2026-11-02", floor=dict(total=total, tiles=floor), river=river, net=net, relations=relations)


def wilson(hits, n):
    z = D("1.96")
    p = D(hits) / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    w = z * (p * (1 - p) / n + z * z / (4 * n * n)).sqrt()
    return max(D(0), (c - w) / d), min(D(1), (c + w) / d)


def one_in(p):
    return max(1, int((1 / p).quantize(D(1), rounding=ROUND_HALF_UP)))


def frequency(hits):
    if hits == 0 or D(252) / hits > 250:
        base = "rarer than 1 in 250 sessions for this name over the last year"
        if hits == 0:
            bound = int((1 / (1 - (D("0.05").ln() / 252).exp())) / 10) * 10
            base += ", and fewer than 1 in %d at 95%%" % bound
        return base
    core = "about 1 in %d sessions for this name over the last year" % max(1, half_up(F(252, hits)))
    if hits < 5:
        return core
    lo, hi = wilson(hits, D(252))
    return core + " (95%% interval 1 in %d to 1 in %d)" % (one_in(hi), one_in(lo))


def moves(rng):
    rows = []
    for i in range(160):
        chg = rng.randint(-1500, 1500)
        iv = rng.choice([None, 0, rng.randint(120, 1500)])
        sig = rng.choice([None, rng.randint(600, 4000)])
        f2 = rng.randint(0, 30)
        f3 = rng.randint(0, min(f2, 6))
        if i % 9 == 0:
            f3 = 0
        rows.append(dict(t="SYX%d" % (300 + i), chg=chg, iv=iv, sig=sig, f2=f2, f3=f3))
    exp = []
    ps = []
    for r in rows:
        c = F(r["chg"], 10 ** 4)
        e = dict(m=None, z=None, level=None, hits=None, p=None, state=None, edge=False)
        if r["iv"]:
            e["m"] = fl(dec(c) * D(252).sqrt() / dec(F(r["iv"], 10 ** 3)))
        if r["sig"] is None:
            e["state"] = "noscale"
        else:
            s = dec(F(r["sig"], 10 ** 5))
            lm = (1 + dec(c)).ln()
            e["z"] = fl(lm / s)
            ratio = abs(lm) / s
            e["edge"] = min(abs(ratio - 2), abs(ratio - 3)) < D("1e-9")
            if ratio < 2:
                e["state"] = "below"
                e["p"] = 1.0
                ps.append((len(exp), F(1)))
            else:
                e["state"] = "tested"
                e["level"] = 3 if ratio >= 3 else 2
                e["hits"] = r["f3"] if e["level"] == 3 else r["f2"]
                p = F(e["hits"] + 1, 253)
                e["p"] = fl(p)
                e["text"] = frequency(e["hits"])
                ps.append((len(exp), p))
        exp.append(e)
    order = sorted(ps, key=lambda q: q[1])
    m = len(order)
    prev = F(1)
    adj = {}
    for rank in range(m, 0, -1):
        i, p = order[rank - 1]
        prev = min(prev, p * m / rank)
        adj[i] = prev
    flagged = 0
    for i, e in enumerate(exp):
        if e["state"] == "tested":
            e["adj"] = fl(adj[i])
            e["flag"] = None if abs(adj[i] - F(1, 10)) < F(1, 10 ** 12) else adj[i] <= F(1, 10)
            flagged += 1 if adj[i] <= F(1, 10) else 0
    return dict(rows=rows, expect=exp, m=m, flagged=flagged, frequency=[frequency(h) for h in range(253)])


def glance(rng):
    out = []
    for i in range(40):
        S = rng.randint(2000, 90000) / 100
        Hs = rng.choice([5, 10, 21])
        qh = round(S * (1 + rng.randint(2, 15) / 100), 2)
        ql = round(S * (1 - rng.randint(2, 15) / 100), 2)
        ph = round(S * (1 + rng.randint(1, 12) / 100), 2)
        pl = round(S * (1 - rng.randint(1, 12) / 100), 2)
        sessions = rng.choice([None, 1, 3, 7, 12, 20, 25])
        when = rng.choice(["postmarket", "premarket", "unknown"])
        term_sd = rng.choice([None, rng.randint(20, 120) / 1000])
        em = rng.choice([None, rng.randint(20, 120) / 1000])
        n_rep = rng.choice([0, 3, 4, 8, 12, 15])
        reports = [["2025-%02d-%02d" % (1 + (k * 3) % 12, 1 + k), None, None, rng.randint(-1500, 1500) / 10000] for k in range(n_rep)]
        if i % 10 == 0:
            reports = [[r[0], None, None, 0.0001] for r in reports]
        Sd, qhd, qld, phd, pld = D(str(S)), D(str(qh)), D(str(ql)), D(str(ph)), D(str(pl))
        q = ((qhd / Sd).ln() ** 2 / Hs, (Sd / qld).ln() ** 2 / Hs)
        p = ((phd / Sd).ln() ** 2 / Hs, (Sd / pld).ln() ** 2 / Hs)
        inside = sessions is not None and 1 <= sessions <= 20
        tE = None
        jq = None
        jp = None
        if inside:
            tE = min(D(20), D(sessions) + (D("0.5") if when == "postmarket" else D("-0.5") if when == "premarket" else D(0)))
            jq = D(str(term_sd)) if term_sd is not None else (D(str(em)) * (D("3.14159265358979323846264338327950288") / 2).sqrt() if em is not None else None)
            rows = sorted(reports, key=lambda r: r[0])[-12:]
            if len(rows) >= 4:
                second = sum(((1 + D(str(r[3]))).ln()) ** 2 for r in rows) / len(rows)
                extra = second - (p[0] + p[1]) / 2
                jp = extra.sqrt() if extra > 0 else None
        steps = []
        done = tE is None
        for k in range(21):
            if not done and k > tE:
                steps += [(tE, False), (tE, True)]
                done = True
            steps.append((D(k), tE is not None and k > tE))
        if not done:
            steps += [(tE, False), (tE, True)]

        def cone(b, j):
            jj = j if j is not None else D(0)
            res = []
            for h, ev in steps:
                su = (h * b[0] + (jj * jj if ev else 0)).sqrt()
                sd = (h * b[1] + (jj * jj if ev else 0)).sqrt()
                res.append([fl(h), fl(Sd * su.exp()), fl(Sd * (-sd).exp())])
            return res
        card = dict(ticker="SYX%d" % (500 + i), sessionDate="2026-11-02",
                    panels=dict(pricedMove=dict(status="ok", spot=S, sessions=Hs, impliedHigh=qh, impliedLow=ql, realizedHigh=ph, realizedLow=pl)))
        cardx = dict(earnings=dict(status="ok", next=None if sessions is None else dict(d="2026-11-20", sessions=sessions, when=when),
                                   impliedNext=None if em is None else dict(em=em), events=reports),
                     term=None if term_sd is None else dict(status="ok", eventMove=dict(sd=term_sd)))
        out.append(dict(card=card, cardX=cardx, q=cone(q, jq), p=cone(p, jp), eventQ=fl(jq) if inside else None, eventP=fl(jp) if inside else None,
                        eventH=fl(tE)))
    return out


def movelab(rng):
    out = []
    for n in [150, 199, 200, 230, 252, 252, 217, 252]:
        rets = [round(abs(rng.gauss(0, 0.02)), 6) for _ in range(n)]
        sig = rng.randint(1000, 2500) / 100000
        hits = []
        for k in (1, 2, 3, 4):
            h = sum(1 for r in rets if F(str(r)) >= k * F(str(sig)))
            hits.append(None if n < 200 else (h if n == 252 else half_up(F(h * 252, n))))
        out.append(dict(returns=rets, sig=sig, hits=hits, n=n))
    return out


def main():
    rng = random.Random(20261111)
    body = dict(alerts=alerts(rng), moves=moves(rng), glance=glance(rng), movelab=movelab(rng))
    body["provenance"] = dict(
        generator="tests/gen-math-browser-fixtures.py",
        generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        python=platform.python_version(),
        oracle="fractions.Fraction, integers and decimal.Decimal at 50 digits (square roots, logarithms, exponentials); no production code is imported",
        nature="synthetic: every row is invented and seeded; SYX names are invented, and the fund symbols appear only because the code keys on them",
        seed=20261111,
    )
    OUT.write_text(json.dumps(body, separators=(",", ":")) + "\n")
    print(OUT.name, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
