import datetime
import hashlib
import json
import os
import random
import unicodedata
from fractions import Fraction

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures-positioning-oracle.json")
CAL = os.path.join(ROOT, "tests", "fixtures-calendar.json")

SECTORS = ["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy",
           "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"]

with open(CAL, "rb") as handle:
    CAL_BYTES = handle.read()
CALENDAR = json.loads(CAL_BYTES)
HOLIDAYS = set(CALENDAR["holidays"])
FIRST = "2020-01-01"
LAST = "2027-12-31"


def day(s):
    return datetime.date.fromisoformat(s)


def is_session(d):
    return d.weekday() < 5 and d.isoformat() not in HOLIDAYS


def sessions_between(a, b):
    if not (FIRST <= a <= LAST and FIRST <= b <= LAST):
        return None
    lo, hi = day(a), day(b)
    sign = 1
    if lo > hi:
        lo, hi, sign = hi, lo, -1
    n = 0
    d = lo + datetime.timedelta(days=1)
    while d <= hi:
        if is_session(d):
            n += 1
        d += datetime.timedelta(days=1)
    return sign * n


def half_up(fr, scale):
    x = fr * scale
    n = x.numerator // x.denominator
    rem = x - n
    if rem >= Fraction(1, 2):
        n += 1
    return n


def half_away(fr):
    sign = -1 if fr < 0 else 1
    return sign * half_up(abs(fr), 1)


def rotation_world(rng, i):
    n_filers = rng.randint(1, 9)
    filers = []
    for f in range(n_filers):
        kind = "ok"
        r = rng.random()
        if r < 0.12:
            kind = "notFiled"
        elif r < 0.2:
            kind = "unread"
        cells = {}
        for s in SECTORS:
            if rng.random() < 0.18:
                continue
            for q in ("now", "prior"):
                if rng.random() < 0.05 and q == "prior":
                    continue
                pos = rng.randint(1, 60)
                inc = rng.randint(0, pos)
                dec = rng.randint(0, pos - inc)
                cells[(s, q)] = {"value": rng.randint(1, 900) * 1_000_000 + rng.randint(0, 999), "positions": pos,
                                 "inc": inc, "dec": dec, "closed": rng.randint(0, 9)}
        if kind == "ok":
            for q in ("now", "prior"):
                if not any(k[1] == q for k in cells):
                    cells[(SECTORS[rng.randint(0, 10)], q)] = {"value": rng.randint(1, 900) * 1_000_000, "positions": 3, "inc": 1, "dec": 1, "closed": 0}
        filers.append({"kind": kind, "cells": cells})
    oks = [f for f in filers if f["kind"] == "ok"]
    off = [f for f in filers if f["kind"] == "notFiled"]
    if not oks:
        filers[0]["kind"] = "ok"
        for q in ("now", "prior"):
            if not any(k[1] == q for k in filers[0]["cells"]):
                filers[0]["cells"][(SECTORS[0], q)] = {"value": 5_000_000, "positions": 3, "inc": 1, "dec": 1, "closed": 0}
        oks = [filers[0]]
        off = [f for f in filers if f["kind"] == "notFiled"]
    for f in off[len(oks) - 1:]:
        f["kind"] = "unread"
        f["cells"] = {}
    return filers


def rotation_expect(filers):
    used = []
    notfiled = unread = 0
    for f in filers:
        if f["kind"] == "unread" or not f["cells"]:
            unread += 1
            continue
        if f["kind"] == "notFiled":
            notfiled += 1
            continue
        vn = sum(c["value"] for (s, q), c in f["cells"].items() if q == "now")
        vp = sum(c["value"] for (s, q), c in f["cells"].items() if q == "prior")
        if vn <= 0 or vp <= 0:
            unread += 1
            continue
        used.append((f, vn, vp))
    out = {"compared": len(used), "notFiled": notfiled, "unread": unread, "sectors": []}
    if not used:
        return out
    k = len(used)
    for s in SECTORS:
        wn = sum(Fraction(100 * f["cells"].get((s, "now"), {"value": 0})["value"], vn) for f, vn, vp in used) / k
        wp = sum(Fraction(100 * f["cells"].get((s, "prior"), {"value": 0})["value"], vp) for f, vn, vp in used) / k
        inc = dec = closed = pos = 0
        vnow = vprior = 0
        held = 0
        for f, vn, vp in used:
            a = f["cells"].get((s, "now"))
            b = f["cells"].get((s, "prior"))
            if a:
                inc += a["inc"]
                dec += a["dec"]
                closed += a["closed"]
                pos += a["positions"]
                vnow += a["value"]
            if b:
                vprior += b["value"]
            if (a and a["value"] > 0) or (b and b["value"] > 0):
                held += 1
        out["sectors"].append({
            "s": s, "wNow": float(wn), "wPrior": float(wp), "dW": float(wn - wp), "inc": inc, "dec": dec, "closed": closed,
            "pos": pos, "breadth": None if pos == 0 else float(Fraction(inc - dec, pos)), "valueNow": vnow, "valuePrior": vprior, "n": held,
        })
    return out


def insider_world(rng, i):
    start = datetime.date(2026, 6, 1)
    days = []
    d = start
    while len(days) < rng.randint(20, 80):
        if d.weekday() < 5:
            days.append(d.isoformat())
        d += datetime.timedelta(days=1)
    world = {}
    for s in SECTORS:
        if rng.random() < 0.06:
            continue
        lo = rng.randint(0, 4)
        hi = len(days) - rng.randint(0, 4)
        rows = []
        for idx in range(lo, hi):
            if rng.random() < 0.07:
                continue
            for side in ("buy", "sell"):
                if rng.random() < 0.08:
                    continue
                n = rng.randint(0, 12)
                rows.append({"date": days[idx], "buy_sell": side, "transactions": n + rng.randint(0, 4), "uniq_insiders": n, "volume": n * rng.randint(10, 900)})
        if rows:
            world[s] = rows
    return world


def insider_expect(world, keep=60):
    maps = {}
    for s, rows in world.items():
        m = {}
        for r in rows:
            m.setdefault(r["date"], {})[r["buy_sell"]] = r
        if m:
            maps[s] = m
    if not maps:
        return None
    frm = max(min(m) for m in maps.values())
    to = min(max(m) for m in maps.values())
    union = sorted({d for m in maps.values() for d in m if frm <= d <= to})
    window = union[-keep:]
    if not window:
        return {"window": None, "sectors": []}
    out = {"window": {"from": window[0], "to": window[-1], "sessions": len(window)}, "sectors": []}
    for s in SECTORS:
        m = maps.get(s)
        if not m:
            continue
        b = x = btx = stx = bvol = svol = gaps = 0
        days = []
        for d in window:
            c = m.get(d)
            if c is None:
                gaps += 1
                days.append([d, None, None])
                continue
            bi = c.get("buy", {}).get("uniq_insiders", 0)
            si = c.get("sell", {}).get("uniq_insiders", 0)
            b += bi
            x += si
            btx += c.get("buy", {}).get("transactions", 0)
            stx += c.get("sell", {}).get("transactions", 0)
            bvol += c.get("buy", {}).get("volume", 0)
            svol += c.get("sell", {}).get("volume", 0)
            days.append([d, bi, si])
        net = None if b + x == 0 else float(Fraction(b - x, b + x))
        out["sectors"].append({"s": s, "buyers": b, "sellers": x, "buyTx": btx, "sellTx": stx, "buyVol": bvol, "sellVol": svol, "net": net, "gaps": gaps, "missing": [i for i, d in enumerate(days) if d[1] is None], "len": len(days), "last": days[-1], "first": days[0]})
    return out


def short_world(rng, i):
    names = []
    for k in range(rng.randint(2, 12)):
        sec = rng.choice(SECTORS)
        base = day("2026-10-09")
        ftd_rows = []
        for j in range(rng.randint(1, 5)):
            d = base - datetime.timedelta(days=j * rng.randint(1, 3))
            q = rng.choice([0, rng.randint(1, 5000), rng.randint(10_000, 4_000_000)])
            px = rng.choice([None, rng.randint(1, 90000)])
            ftd_rows.append([d.isoformat(), q, px])
        venues = []
        days = []
        for j in range(rng.randint(1, 6)):
            d = (day("2026-10-26") - datetime.timedelta(days=j)).isoformat()
            vs = []
            for x in range(rng.randint(1, 5)):
                tot = rng.randint(0, 500_000)
                vs.append(["V%d" % x, "M%d" % x, rng.randint(0, tot), tot])
            days.append([d, sum(v[2] for v in vs), sum(v[3] for v in vs)])
            if j == 0:
                venues = vs
        adv = rng.choice([None, 0, rng.randint(1000, 90_000_000)])
        names.append({"t": "SYX%03d" % (100 + k), "sec": sec, "ftd": ftd_rows, "svx": {"days": days, "venues": venues, "date": days[0][0]}, "adv": adv,
                      "hasSvx": rng.random() < 0.8})
    return names


def short_expect(names):
    rows = []
    for n in names:
        newest = max(n["ftd"], key=lambda r: r[0])
        q, pxc = newest[1], newest[2]
        notional = None if pxc is None else half_away(Fraction(q * pxc, 100))
        adv = n["adv"] if n["adv"] and n["adv"] > 0 else None
        share = None if adv is None else float(Fraction(q, adv))
        rows.append({"t": n["t"], "sec": n["sec"], "date": newest[0], "q": q, "notional": notional, "share": share})
    sectors = []
    asof = max(r["date"] for r in rows)
    for s in SECTORS:
        mine = [r for r in rows if r["sec"] == s]
        newest = max((r["date"] for r in mine), default=None)
        fresh = [] if newest is None else [r for r in mine if (day(newest) - day(r["date"])).days <= 21]
        priced = [r for r in fresh if r["notional"] is not None]
        heavy = sum(1 for r in fresh if r["share"] is not None and r["share"] >= 0.005)
        in_sector = [n for n in names if n["sec"] == s]
        sectors.append({"s": s, "notional": sum(r["notional"] for r in priced) if priced else None, "heavy": heavy, "n": len(priced),
                        "unread": len(in_sector) - len(fresh)})
    mix = {}
    sec = {s: [0, 0, 0] for s in SECTORS}
    top = []
    for n in names:
        if not n["hasSvx"]:
            continue
        v = n["svx"]["venues"]
        short = sum(x[2] for x in v)
        total = sum(x[3] for x in v)
        for x in v:
            m = mix.setdefault(x[0], [0, 0])
            m[0] += x[2]
            m[1] += x[3]
        s10 = sum(d[1] for d in n["svx"]["days"])
        t10 = sum(d[2] for d in n["svx"]["days"])
        sec[n["sec"]][0] += short
        sec[n["sec"]][1] += total
        sec[n["sec"]][2] += 1
        top.append({"t": n["t"], "ratio": None if total == 0 else float(Fraction(short, total)), "ratio10": None if t10 == 0 else float(Fraction(s10, t10))})
    shorts = sum(m[0] for m in mix.values())
    return {
        "asOfFtd": asof, "ftdSectors": sectors, "ftdRows": rows,
        "mix": {k: {"short": m[0], "total": m[1], "share": None if shorts == 0 else float(Fraction(m[0], shorts))} for k, m in mix.items()},
        "venueSectors": {s: {"short": v[0], "total": v[1], "ratio": None if v[1] == 0 else float(Fraction(v[0], v[1])), "n": v[2]} for s, v in sec.items() if v[2]},
        "top": top,
    }


def lag_cases(rng):
    pairs = [["2026-09-01", "2026-10-16"], ["2026-09-01", "2026-10-15"], ["2026-11-23", "2026-11-27"], ["2026-11-26", "2026-11-27"],
             ["2026-12-24", "2026-12-28"], ["2026-07-02", "2026-07-06"], ["2026-10-10", "2026-10-12"], ["2026-10-12", "2026-10-12"],
             ["2019-11-01", "2020-01-10"], ["2026-01-02", "2028-01-02"], ["2025-06-01", "2026-07-06"], ["2026-10-14", "2026-10-13"], ["2026-08-31", "2026-10-16"]]
    for _ in range(80):
        a = day("2024-01-01") + datetime.timedelta(days=rng.randint(0, 1000))
        b = a + datetime.timedelta(days=rng.randint(0, 420))
        pairs.append([a.isoformat(), b.isoformat()])
    return [{"from": a, "to": b, "n": sessions_between(a, b), "days": (day(b) - day(a)).days} for a, b in pairs]


def initials_of(name):
    folded = unicodedata.normalize("NFD", name)
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    words = []
    for w in folded.split():
        w = "".join(c for c in w if c.isascii() and c.isalpha())
        if w and w.lower() not in {"hon", "rep", "sen", "mr", "mrs", "ms", "dr", "representative", "senator", "jr", "sr", "ii", "iii", "iv"}:
            words.append(w)
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][0].upper()
    return words[0][0].upper() + words[-1][0].upper()


NAMES = ["Hon. Mary Ann Smith Jr.", "Dr. Zoë Álvarez", "Sen. Prince", "Mr.", "A", "Rep. John Q. Public III", "  Li   Na  ", "José María", "O'Neil", "", "123 456",
         "Ng", "Anne-Marie Dupont-Lee", "Fixture Member Alpha", "Mrs. Jane Doe IV", "Émile Zola", "Senator Joe Blow"]


def chart_world(rng, i):
    spy = []
    d = day("2026-07-01")
    px = Fraction(500)
    while d <= day("2026-10-20"):
        if d.weekday() < 5:
            px += Fraction(rng.randint(-300, 300), 100)
            spy.append([d.isoformat(), float(px)])
        d += datetime.timedelta(days=1)
    cases = []
    for k in range(6):
        txn = day("2026-07-10") + datetime.timedelta(days=rng.randint(0, 90))
        p0 = rng.choice([None, 0, -1.0, round(rng.uniform(5, 300), 2)])
        p1 = rng.choice([None, round(rng.uniform(5, 300), 2), round(rng.uniform(5, 300), 2)])
        r = None
        if p0 is not None and p1 is not None and p0 > 0 and p1 > 0:
            r = Fraction(str(p1)) / Fraction(str(p0)) - 1
        base = None
        for dd, c in spy:
            if dd <= txn.isoformat():
                base = c
        rspy = None
        if base is not None:
            rspy = Fraction(spy[-1][1]) / Fraction(base) - 1
        ex = None if r is None or rspy is None else r - rspy
        cases.append({"txn": txn.isoformat(), "p0": p0, "p1": p1, "r": None if r is None else float(r), "rSpy": None if rspy is None else float(rspy),
                      "ex": None if ex is None else float(ex)})
    return {"spy": spy, "cases": cases}


def main():
    rng = random.Random(20261027)
    rot = []
    for i in range(300):
        filers = rotation_world(rng, i)
        rot.append({"filers": [{"kind": f["kind"], "cells": [[SECTORS.index(s), 0 if q == "now" else 1, c["value"], c["positions"], c["inc"], c["dec"], c["closed"]] for (s, q), c in f["cells"].items()]} for f in filers], "expect": rotation_expect(filers)})
    ins = []
    for i in range(50):
        w = insider_world(rng, i)
        ins.append({"rows": {s: [[r["date"], r["buy_sell"], r["transactions"], r["uniq_insiders"], r["volume"]] for r in rows] for s, rows in w.items()}, "expect": insider_expect(w)})
    sh = []
    for i in range(100):
        names = short_world(rng, i)
        sh.append({"names": names, "expect": short_expect(names)})
    out = {
        "provenance": {
            "generator": "tests/gen-positioning-oracle.py",
            "nature": "synthetic worlds with exact rational answers, not vendor data",
            "calendarSha256": hashlib.sha256(CAL_BYTES).hexdigest(),
            "scriptSha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest(),
        },
        "rotation": rot, "insiders": ins, "short": sh,
        "lag": lag_cases(rng),
        "initials": [[n, initials_of(n)] for n in NAMES],
        "chart": [chart_world(rng, i) for i in range(20)],
    }
    with open(OUT, "w") as handle:
        json.dump(out, handle, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
    print("wrote", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
