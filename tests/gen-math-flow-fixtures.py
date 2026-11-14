import hashlib
import json
import platform
import random
from decimal import Decimal, getcontext
from fractions import Fraction
from pathlib import Path

getcontext().prec = 60
HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-flow.json"
F = Fraction
SECTORS = ["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services",
           "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"]


def fl(x):
    return None if x is None else float(x)


def root(x):
    return F(Decimal(x.numerator).__truediv__(Decimal(x.denominator)).sqrt())


def tk(i):
    return "SYX" + str(100 + i)


def sample_sd(xs):
    n = len(xs)
    m = sum(xs, F(0)) / n
    return m, root(sum(((x - m) ** 2 for x in xs), F(0)) / (n - 1))


def flowlab(rng):
    out = []
    for i in range(240):
        vol = rng.choice([0, rng.randint(1, 40), rng.randint(200, 90000), rng.randint(200, 90000), rng.randint(200, 90000)])
        parts = [rng.randint(0, 100) for _ in range(4)]
        tot = sum(parts) or 1
        ask = vol * parts[0] // tot
        bid = vol * parts[1] // tot
        mid = vol * parts[2] // tot
        none = vol - ask - bid - mid
        if i % 17 == 0:
            ask, bid, mid, none = None, None, None, None
        if i % 23 == 0 and vol > 0:
            ask, bid, mid, none = 0, 0, 0, vol
        prem = rng.choice([0, rng.randint(1, 24999999), 25000000, rng.randint(25000001, 900000000), rng.randint(25000001, 900000000), rng.randint(25000001, 900000000)])
        oi = rng.choice([0, rng.randint(1, 50000)])
        tv = rng.choice([0, vol + rng.randint(0, 100000)])
        sweep = rng.choice([None, rng.randint(0, vol)])
        floor = rng.choice([None, rng.randint(0, vol)])
        cross = rng.choice([None, rng.randint(0, vol)])
        multi = rng.choice([None, rng.randint(0, vol)])
        smulti = rng.choice([None, rng.randint(0, vol)])
        cp = rng.choice(["c", "p"])
        row = dict(vol=vol, ask=ask, bid=bid, mid=mid, none=none, premC=prem, oi=oi, tickerVol=tv, sweep=sweep, floor=floor, cross=cross,
                   multi=multi, stockMulti=smulti, cp=cp)
        e = dict(voi=fl(F(vol, oi)) if oi > 0 else None, nameShare=fl(F(vol, tv)) if tv > 0 else None,
                 sweepShare=fl(F(sweep, vol)) if vol > 0 and sweep is not None else None,
                 floorShare=fl(F(floor, vol)) if vol > 0 and floor is not None else None,
                 crossShare=fl(F(cross, vol)) if vol > 0 and cross is not None else None,
                 multiShare=fl(F(multi + smulti, vol)) if vol > 0 and multi is not None and smulti is not None else None,
                 avgFill=fl(F(prem, vol * 100)) if vol > 0 else None)
        why = None
        if not vol > 0:
            why = "no-volume"
        elif ask is None:
            why = "noSides"
        elif not prem > 0:
            why = "noPremium"
        elif ask + bid == 0:
            why = "noSides"
        elif 5 * (ask + bid) < 2 * vol:
            why = "lowCoverage"
        elif prem < 25000000:
            why = "smallClassified"
        e["askWhy"] = why
        e["stated"] = fl(F(ask + bid, vol)) if vol > 0 and ask is not None and bid is not None and ask + bid <= vol else None
        if why is None:
            e["askLo"] = fl(F(ask, vol))
            e["askHi"] = fl(F(vol - bid, vol))
            buy = 1 if 2 * ask > vol else (-1 if 2 * (vol - bid) < vol else 0)
            e["lean"] = 0 if buy == 0 else (-buy if cp == "p" else buy)
        else:
            e["askLo"] = None
            e["askHi"] = None
            e["lean"] = None
        out.append(dict(row=row, expect=e))
    profiles = []
    for i in range(60):
        n = rng.randint(1, 30)
        px = sorted(rng.sample(range(5, 4000), n))
        levels = [dict(px=p, v=rng.choice([0, rng.randint(1, 5000)])) for p in px]
        if i % 9 == 0:
            for l in levels:
                l["v"] = 7
        total = sum(l["v"] for l in levels)
        vwap = None
        area = None
        if total > 0:
            num = sum(l["px"] * l["v"] for l in levels)
            vwap = (2 * num + total) // (2 * total)
            poc = 0
            for j in range(1, n):
                if levels[j]["v"] > levels[poc]["v"]:
                    poc = j
            lo = hi = poc
            have = levels[poc]["v"]
            while 10 * have < 7 * total and (lo > 0 or hi < n - 1):
                down = levels[lo - 1]["v"] if lo > 0 else -1
                up = levels[hi + 1]["v"] if hi < n - 1 else -1
                if up >= down:
                    hi += 1
                    have += levels[hi]["v"]
                else:
                    lo -= 1
                    have += levels[lo]["v"]
            area = dict(poc=levels[poc]["px"], lo=levels[lo]["px"], hi=levels[hi]["px"], v=have, of=total)
        profiles.append(dict(levels=levels, vwapC=vwap, area=area))
    strikes = []
    for i in range(60):
        n = rng.randint(1, 25)
        ks = sorted(rng.sample(range(10, 900), n))
        rows = [dict(k=k, callVol=rng.choice([0, rng.randint(0, 4000)]), putVol=rng.choice([0, rng.randint(0, 4000)])) for k in ks]
        if i % 11 == 0:
            for r in rows:
                r["callVol"] = 0
                r["putVol"] = 0
        total = sum(r["callVol"] + r["putVol"] for r in rows)
        med = None
        acc = 0
        if total > 0:
            for r in rows:
                v = r["callVol"] + r["putVol"]
                if v <= 0:
                    continue
                acc += v
                if 2 * acc >= total:
                    med = r["k"]
                    break
        rng.shuffle(rows)
        strikes.append(dict(rows=rows, median=med))
    return dict(screen=out, profiles=profiles, strikes=strikes)


def voldesk(rng):
    terms = []
    for i in range(80):
        n = rng.randint(2, 9)
        dtes = sorted(rng.sample([1, 2, 5, 7, 14, 21, 30, 45, 60, 90, 120, 180, 365], n))
        pts = [dict(dte=d, iv=rng.randint(800, 9000) / 10000) for d in dtes]
        if i % 7 == 0:
            base = pts[0]["iv"]
            for p in pts:
                p["iv"] = base

        def interp(d):
            if d < pts[0]["dte"] or d > pts[-1]["dte"]:
                return None
            lo, hi = pts[0], pts[-1]
            for a, b in zip(pts, pts[1:]):
                if a["dte"] <= d <= b["dte"]:
                    lo, hi = a, b
                    break
            wl = F(str(lo["iv"])) ** 2 * lo["dte"] / 365
            wh = F(str(hi["iv"])) ** 2 * hi["dte"] / 365
            w = wl if hi["dte"] == lo["dte"] else wl + (wh - wl) * (d - lo["dte"]) / (hi["dte"] - lo["dte"])
            return root(w / F(d, 365))
        i30, i90 = interp(30), interp(90)
        slope = None
        state = None
        if i30 is not None and i90 is not None:
            slope = (i90 - i30) * 100
            state = "contango" if slope >= F(1, 2) else ("backwardation" if slope <= F(-1, 2) else "flat")
            if abs(abs(slope) - F(1, 2)) < F(1, 10 ** 7):
                state = None
        probes = [rng.choice([3, 10, 30, 45, 90, 200]) for _ in range(3)]
        shuffled = pts[:]
        rng.shuffle(shuffled)
        terms.append(dict(points=shuffled, iv30=fl(i30), iv90=fl(i90), slope=fl(slope), state=state,
                          probes=[dict(d=d, iv=fl(interp(d))) for d in probes]))
    return dict(terms=terms)


def regime(rng):
    zero = []
    for i in range(40):
        a = rng.choice([None, 0, rng.randint(-9000000, 9000000)])
        b = rng.choice([None, 0, rng.randint(-9000000, 9000000)])
        want = None
        if a is not None and b is not None and abs(a) + abs(b) > 0:
            want = fl(F(abs(a), abs(a) + abs(b)))
        zero.append(dict(a=a, b=b, share=want))
    flows = []
    for i in range(8):
        n = rng.choice([30, 79, 80, 81, 140])
        rows = []
        for j in range(n):
            usd = rng.randint(-50000000, 50000000)
            if i == 3 and j == n - 5:
                usd = None
            rows.append(dict(date="2026-%02d-%02d" % (1 + j // 28, 1 + j % 28), change_prem=usd, change=rng.randint(-9000, 9000), close=100))
        if i == 5:
            for r in rows:
                r["change_prem"] = 1000
        sums = []
        for k in range(19, n):
            w = [rows[q]["change_prem"] for q in range(k - 19, k + 1)]
            sums.append(None if any(x is None for x in w) else sum(w))
        cum = sums[-1] if sums else None
        prior = [F(x) for x in sums[:-1] if x is not None]
        z = None
        if cum is not None and len(prior) >= 60:
            m, sd = sample_sd(prior)
            if sd > 0:
                z = fl((F(cum) - m) / sd)
        flows.append(dict(rows=rows, session=rows[-1]["date"], cum20=cum, z20=z))
    pcs = []
    for i in range(8):
        n = rng.choice([40, 60, 61, 62, 90])
        rows = []
        for j in range(n):
            cv = rng.randint(1000, 900000)
            pv = rng.randint(1000, 900000)
            rows.append(dict(date="2026-%02d-%02d" % (1 + j // 28, 1 + j % 28), call_volume=cv, put_volume=pv,
                             call_premium=rng.randint(10 ** 5, 10 ** 9), put_premium=rng.randint(10 ** 5, 10 ** 9)))
        if i == 2:
            rows[-1]["call_volume"] = 0
        last = rows[-1]
        pcv = F(last["put_volume"], last["call_volume"]) if last["call_volume"] > 0 else None
        pcp = F(last["put_premium"], last["call_premium"])
        hv = [F(r["put_volume"], r["call_volume"]) for r in rows[:-1]]
        hp = [F(r["put_premium"], r["call_premium"]) for r in rows[:-1]]

        def zof(x, h):
            if x is None or len(h) < 60:
                return None
            m, sd = sample_sd(h)
            return fl((x - m) / sd) if sd > 0 else None
        vols = [r["call_volume"] + r["put_volume"] for r in rows]
        pct = fl(F(sum(1 for v in vols if v <= vols[-1]), len(vols)))
        pcs.append(dict(rows=rows, session=last["date"], pcVol=fl(pcv), pcPrem=fl(pcp), zVol=zof(pcv, hv), zPrem=zof(pcp, hp), volPct=pct))
    aligns = []
    for i in range(30):
        g = rng.choice([None, 0, rng.randint(-500, 500)])
        mem = [rng.choice([None, 0, rng.randint(-90, 90)]) for _ in range(rng.randint(0, 12))]
        signs = [m for m in mem if m is not None and m != 0]
        share = None
        agree = None
        if g is not None and g != 0 and signs:
            agree = sum(1 for m in signs if (m > 0) == (g > 0))
            share = fl(F(agree, len(signs)))
        aligns.append(dict(g=g, members=mem, n=len(signs), agree=agree, share=share))
    return dict(zero=zero, flows=flows, pcs=pcs, aligns=aligns)


def cross(rng):
    tilts = []
    for i in range(80):
        c = rng.choice([None, rng.randint(-10 ** 8, 10 ** 8)])
        p = rng.choice([None, rng.randint(-10 ** 8, 10 ** 8)])
        cp = rng.choice([None, 0, rng.randint(-10 ** 8, 10 ** 9)])
        pp = rng.choice([None, 0, rng.randint(-10 ** 8, 10 ** 9)])
        want = None
        if None not in (c, p, cp, pp) and abs(cp) + abs(pp) > 0:
            want = fl(F(c - p, abs(cp) + abs(pp)))
        gex = rng.choice([None, rng.randint(-10 ** 10, 10 ** 10)])
        vol = rng.choice([None, 0, rng.randint(1000, 10 ** 8)])
        close = rng.choice([None, 0, rng.randint(100, 150000) / 100])
        adv = None
        if gex is not None and vol and close:
            adv = fl(F(gex) / (F(vol) * F(str(close))))
        chg = rng.choice([None, rng.randint(-4000, 4000) / 10000])
        iv = rng.choice([None, 0, -0.2, rng.randint(50, 3000) / 1000])
        ivd = None
        if chg is not None and iv is not None and iv > 0:
            ivd = fl(F(str(chg)) * root(F(252)) / F(str(iv)))
        tilts.append(dict(row=dict(ticker=tk(i), net_call_premium=c, net_put_premium=p, call_premium=cp, put_premium=pp), tilt=want,
                          gex=gex, avgVol=vol, close=close, gexAdv=adv, chg=chg, iv30p=iv, ivDays=ivd))
    hist = []
    for i in range(40):
        n = rng.choice([10, 59, 60, 61, 120, 252, 270])
        base = [rng.randint(-1000, 1000) for _ in range(n)]
        if i % 8 == 0:
            base = [5] * n
        today = rng.choice([rng.randint(-1200, 1200), base[0] if base else 0])
        used = base[-252:]
        e = dict(n=len(used), pct=None, z=None, why=None)
        if len(used) < 60:
            e["why"] = "short-history"
        else:
            e["pct"] = fl(F(sum(1 for v in used if v <= today) + 1, len(used) + 1))
            m, sd = sample_sd([F(v) for v in used])
            if sd > 0:
                e["z"] = fl((F(today) - m) / sd)
            else:
                e["why"] = "zero-sd"
        hist.append(dict(series=base + [today], expect=e))
    return dict(tilts=tilts, history=hist)


def market(rng):
    out = []
    for i in range(20):
        rows = []
        for j in range(rng.randint(1, 40)):
            r = dict(ticker=tk(j))
            r["net_call_premium"] = rng.choice([None, rng.randint(-10 ** 7, 10 ** 7)])
            r["net_put_premium"] = rng.choice([None, rng.randint(-10 ** 7, 10 ** 7)])
            for k in ["put_volume", "call_volume", "put_premium", "call_premium", "call_volume_ask_side", "call_volume_bid_side",
                      "put_volume_ask_side", "put_volume_bid_side"]:
                r[k] = rng.choice([None, rng.randint(0, 10 ** 6)])
            rows.append(r)
        nu = [r["net_call_premium"] - r["net_put_premium"] for r in rows if r["net_call_premium"] is not None and r["net_put_premium"] is not None]
        one = sum(1 for r in rows if (r["net_call_premium"] is None) != (r["net_put_premium"] is None))
        net = sum(nu)
        gross = sum(abs(v) for v in nu)
        bull = sum(1 for v in nu if v > 0)
        bear = sum(1 for v in nu if v < 0)
        top = sum(sorted((abs(v) for v in nu), reverse=True)[:5])

        def joint(a, b):
            ok = [r for r in rows if r[a] is not None and r[b] is not None]
            den = sum(r[b] for r in ok)
            return fl(F(sum(r[a] for r in ok), den)) if den > 0 else None
        ag = [r for r in rows if None not in (r["call_volume_ask_side"], r["call_volume_bid_side"], r["put_volume_ask_side"], r["put_volume_bid_side"])]
        ca = sum(r["call_volume_ask_side"] for r in ag)
        cb = sum(r["call_volume_bid_side"] for r in ag)
        pa = sum(r["put_volume_ask_side"] for r in ag)
        pb = sum(r["put_volume_bid_side"] for r in ag)
        out.append(dict(rows=rows, expect=dict(
            net=net if nu else None, priced=len(nu), oneLegged=one, tilt=fl(F(net, gross)) if gross > 0 else None,
            topShare=fl(F(top, gross)) if gross > 0 else None, bull=bull, bear=bear,
            breadth=fl(F(bull - bear, bull + bear)) if bull + bear > 0 else None,
            pcrVolume=joint("put_volume", "call_volume"), pcrPremium=joint("put_premium", "call_premium"),
            callLift=fl(F(ca, ca + cb)) if ag and ca + cb > 0 else None, putLift=fl(F(pa, pa + pb)) if ag and pa + pb > 0 else None)))
    return out


def unusual(rng):
    rows = []
    exp = []
    spot = 137.25
    for i in range(120):
        k = rng.randint(20, 400)
        cp = rng.choice(["C", "P"])
        vol = rng.choice([None, rng.randint(0, 249), 250, rng.randint(251, 90000)])
        oi = rng.choice([None, rng.randint(0, 99), 100, rng.randint(101, 90000)])
        prev = rng.choice([None, rng.randint(0, 90000)])
        bid = rng.choice([None, rng.randint(1, 5000) / 100])
        ask = rng.choice([None, rng.randint(1, 5000) / 100])
        av = rng.choice([None, rng.randint(0, 50000)])
        bv = rng.choice([None, rng.randint(0, 50000)])
        sym = "SYX101" + "261218" + cp + ("%08d" % (k * 1000))
        rows.append(dict(option_symbol=sym, volume=vol, open_interest=oi, prev_oi=prev, nbbo_bid=bid, nbbo_ask=ask, ask_volume=av, bid_volume=bv))
        if vol is None or oi is None or vol < 250 or oi < 100:
            continue
        legs = av + bv if av is not None and bv is not None else None
        exp.append(dict(k=k, cp=cp, vol=vol, oi=oi, vor=fl(F(vol, oi)), doi=None if prev is None else oi - prev,
                        lift=fl(F(av, legs)) if legs else None, aggr=None if legs is None else av - bv,
                        nlo=None if bid is None or ask is None else fl(F(vol) * F(str(bid)) * 100),
                        nhi=None if bid is None or ask is None else fl(F(vol) * F(str(ask)) * 100)))
    return dict(rows=rows, spot=spot, expect=exp)


def dispersion(rng):
    out = []
    for i in range(30):
        n = rng.choice([12, 20, 21, 40, 60])
        raw = [rng.randint(1, 1000) for _ in range(n)]
        tot = sum(raw)
        mem = []
        for j in range(n):
            iv = rng.randint(1500, 9000) / 10000
            ev = rng.random() < (0.5 if i % 6 == 0 else 0.1)
            if rng.random() < 0.05:
                iv = None
            mem.append(dict(t=tk(j), w=raw[j] / tot, iv=iv, event=ev))
        idx = rng.choice([None, rng.randint(1200, 5600) / 10000, rng.randint(1200, 5600) / 10000, rng.randint(6000, 9000) / 10000])
        W = [F(raw[j], tot) for j in range(n)]
        use = [j for j in range(n) if not mem[j]["event"] and mem[j]["iv"] is not None]
        wc = sum((W[j] for j in use), F(0))
        e = dict(rho=None, raw=None, why=None, covered=len(use))
        if idx is None:
            e["why"] = "index-iv"
        elif len(use) < 20 or wc < F(6, 10):
            e["why"] = "coverage"
        else:
            avg = sum((W[j] * F(str(mem[j]["iv"])) for j in use), F(0)) / wc
            ivs = [F(str(mem[j]["iv"])) if j in use else avg for j in range(n)]
            pair = F(0)
            for a in range(n):
                for b in range(n):
                    if a != b:
                        pair += W[a] * W[b] * ivs[a] * ivs[b]
            own = sum((W[a] ** 2 * ivs[a] ** 2 for a in range(n)), F(0))
            if pair > 0:
                r = (F(str(idx)) ** 2 - own) / pair
                e["raw"] = fl(r)
                e["rho"] = fl(max(F(-1), min(F(1), r)))
            else:
                e["why"] = "degenerate"
        if abs(wc - F(6, 10)) < F(1, 10 ** 9):
            continue
        out.append(dict(indexIv=idx, members=mem, expect=e))
    return out


def ledger(rng):
    out = []
    for i in range(80):
        cols = {}
        weights = {}
        for s in SECTORS:
            if rng.random() < 0.85:
                cols[s] = dict(X=rng.randint(-10 ** 13, 10 ** 13) if i % 10 else 0, U=rng.choice([0, rng.randint(0, 10 ** 12)]) if i % 10 else 0)
            if rng.random() < 0.9:
                weights[s] = rng.randint(1, 10 ** 6)
        if i % 13 == 0:
            for s in cols:
                cols[s]["U"] = 0
        wt = [s for s in SECTORS if s in cols and weights.get(s, 0) > 0]
        rows = {}
        if wt:
            Wt = sum(weights[s] for s in wt)
            Xt = sum(cols[s]["X"] for s in wt)
            Ut = sum(cols[s]["U"] for s in wt)
            mag = abs(Xt)
            floors = [mag * weights[s] // Wt for s in wt]
            rems = [mag * weights[s] % Wt for s in wt]
            left = mag - sum(floors)
            order = sorted(range(len(wt)), key=lambda q: (-rems[q], q))
            for q in order[:left]:
                floors[q] += 1
            for q, s in enumerate(wt):
                a = floors[q] if Xt >= 0 else -floors[q]
                R = cols[s]["X"] - a
                Q = (Wt - weights[s]) * cols[s]["U"] + weights[s] * (Ut - cols[s]["U"])
                Wb = -(-Q // Wt)
                v = "at" if R == 0 and Wb == 0 else ("above" if R - Wb >= 1 else ("below" if R + Wb <= -1 else "undetermined"))
                exact = F(cols[s]["X"]) - F(Xt * weights[s], Wt)
                rows[s] = dict(a=str(a), R=str(R), W=str(Wb), verdict=v, off=fl(abs(F(R) - exact)))
        out.append(dict(columns={s: dict(X=str(c["X"]), U=str(c["U"])) for s, c in cols.items()}, weights=weights, weighted=wt, rows=rows))
    return out


def main():
    rng = random.Random(20261110)
    body = dict(flowlab=flowlab(rng), voldesk=voldesk(rng), regime=regime(rng), cross=cross(rng), market=market(rng), unusual=unusual(rng),
                dispersion=dispersion(rng), ledger=ledger(rng))
    body["provenance"] = dict(
        generator="tests/gen-math-flow-fixtures.py",
        generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        python=platform.python_version(),
        oracle="fractions.Fraction and decimal.Decimal at 60 digits, integers for cents and contracts; no production code is imported",
        nature="synthetic: every row and every ticker is invented and seeded; nothing was read from a data provider",
        seed=20261110,
    )
    OUT.write_text(json.dumps(body, separators=(",", ":")) + "\n")
    print(OUT.name, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
