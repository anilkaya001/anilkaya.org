import hashlib
import json
import math
import random
import re
import statistics
import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures-er.json"
CAL = json.loads((ROOT / "tests" / "fixtures-calendar.json").read_text())
NY = ZoneInfo("America/New_York")
HOLIDAYS = set(CAL["holidays"])
EARLY = {e["d"] for e in CAL["earlyCloses"]}


def r(x, dp):
    if x is None:
        return None
    q = Decimal(repr(float(x))).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)
    return float(q)


def betacf(a, b, x):
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 400):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-15:
            break
    return h


def ibeta(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    bt = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return bt * betacf(a, b, x) / a
    return 1 - bt * betacf(b, a, 1 - x) / b


def t_cdf(t, df):
    x = df / (df + t * t)
    tail = 0.5 * ibeta(df / 2.0, 0.5, x)
    return 1 - tail if t > 0 else tail


def t_ppf975(df):
    lo, hi = 0.0, 200.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if t_cdf(mid, df) < 0.975:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def wilson(p, n, z=1.96):
    z2 = z * z
    d = 1 + z2 / n
    c = (p + z2 / (2 * n)) / d
    m = (z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d
    return max(0.0, c - m), min(1.0, c + m)


def sign(x):
    return (x > 0) - (x < 0)


def hist_expect(events, em_now):
    missing = zeros = 0
    xs, ln, ratios, absm = [], [], [], []
    beats = 0
    for ev in events:
        em, m1d = ev[2], ev[3]
        if em is None or m1d is None or not em > 0:
            missing += 1
            continue
        a = abs(m1d)
        absm.append(a)
        ratios.append(a / em)
        if a > em:
            beats += 1
        if a == 0:
            zeros += 1
            continue
        xs.append(math.log(a / em))
        ln.append(math.log(a))
    used = len(xs)
    n = used + zeros
    mean_log = lo = hi = None
    if used >= 1:
        mean_log = sum(xs) / used
    if used >= 2:
        half = t_ppf975(used - 1) * statistics.stdev(xs) / math.sqrt(used)
        lo, hi = mean_log - half, mean_log + half
    verdict = "few" if used < 6 else "rich" if hi < 0 else "cheap" if lo > 0 else "inline"
    beat = beats / n if n else None
    w = wilson(beat, n) if n else None
    hit_n = sum(1 for ev in events if ev[6] is not None)
    hits = sum(1 for ev in events if ev[6] is not None and ev[6] > 0)
    mv = statistics.median(absm) if n else None
    h = {
        "n": n, "used": used, "zeros": zeros, "missing": missing,
        "medR": r(statistics.median(ratios), 6) if n else None,
        "beat": r(beat, 6), "beatLo": r(w[0], 6) if w else None, "beatHi": r(w[1], 6) if w else None,
        "meanLog": r(mean_log, 4), "lo": r(lo, 4), "hi": r(hi, 4), "verdict": verdict,
        "mv": r(mv, 6) if n else None, "hit": r(hits / hit_n, 6) if hit_n else None, "hitN": hit_n,
    }
    today_r = r(em_now / mv, 6) if em_now is not None and mv is not None and mv > 0 else None
    today_z = None
    if em_now is not None and em_now > 0 and used >= 6 and len(ln) >= 2:
        sd = statistics.stdev(ln)
        if sd > 0:
            today_z = r((math.log(em_now) - sum(ln) / len(ln)) / sd, 4)
    return h, today_r, today_z


def conc_expect(rows):
    w = a = f = n = 0
    for _, _, m, s in rows:
        if m is None or s is None:
            continue
        n += 1
        if m == 0 or s == 0:
            f += 1
        elif sign(m) == sign(s):
            w += 1
        else:
            a += 1
    dec = w + a
    lo = hi = None
    if dec >= 4:
        lo, hi = wilson(w / dec, dec)
    return {"n": n, "with": w, "against": a, "flat": f, "lo": r(lo, 6), "hi": r(hi, 6)}


def pooled_expect(hists):
    counts = {"rich": 0, "cheap": 0, "inline": 0, "few": 0}
    means = []
    for h in hists:
        counts[h["verdict"]] += 1
        if h["used"] >= 6 and h["meanLog"] is not None:
            means.append(h["meanLog"])
    n = len(means)
    if n < 2:
        return {"n": n, **counts, "meanLog": r(sum(means) / n, 4) if n else None, "lo": None, "hi": None}
    m = sum(means) / n
    half = t_ppf975(n - 1) * statistics.stdev(means) / math.sqrt(n)
    return {"n": n, **counts, "meanLog": r(m, 4), "lo": r(m - half, 4), "hi": r(m + half, 4)}


def day_str(d):
    return d.isoformat()


def history(rng):
    n = rng.choice([0, 1, 2, 3, 4, 5, 6, 6, 7, 8, 9, 10, 11, 12, 12, 12])
    base = date(2026, 9, 1)
    scale = math.exp(rng.uniform(math.log(0.015), math.log(0.2)))
    bias = rng.choice([-0.5, -0.2, 0.0, 0.0, 0.2, 0.5])
    out = []
    for i in range(n):
        d = base - timedelta(days=91 * i + rng.randint(0, 6))
        em = r(scale * math.exp(rng.gauss(0, 0.25)), 6)
        mag = r(em * math.exp(bias + rng.gauss(0, 0.6)), 6)
        if rng.random() < 0.08:
            mag = em
        m1d = mag if rng.random() < 0.5 else -mag
        roll = rng.random()
        if roll < 0.06:
            em = None
        elif roll < 0.12:
            m1d = None
        elif roll < 0.16:
            m1d = 0.0
        elif roll < 0.19:
            em = 0.0
        ls = rng.choice([None, 0.12, -0.08, 0.03, -0.2, 0.0])
        out.append([day_str(d), rng.choice(["premarket", "postmarket", None]), em, m1d, None, None, ls, None])
    return out


def exact(s):
    m = re.fullmatch(r"([+-])?(\d{1,15})(?:\.(\d+))?", s.strip())
    if not m:
        return None
    v = Decimal(m.group(2) + ("." + m.group(3) if m.group(3) else ""))
    v = (v * 10000).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    n = int(v)
    if n > 2 ** 53 - 1:
        return None
    return -n if m.group(1) == "-" and n != 0 else n


def sx_expect(rep, est):
    if rep is None or est is None or est == 0:
        return None
    q = (Decimal(rep - est) / Decimal(abs(est))).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    return float(q)


def eps_strings(rng):
    out = []
    fixed = ["1.23", "-0.5", "+3", "0.12345", "0.00005", "0.00004", "-0.00005", ".5", "1e3", "abc", "1,2", "", "  4.2  ", "0", "-0", "0.0000", "12", "007.10", "1.99995", "1.99994", "-1.99995", "999999999999999", "1000000000000000", "5.", "--1", "1 2"]
    for s in fixed:
        out.append({"s": s, "h": exact(s)})
    while len(out) < 2000:
        sgn = rng.choice(["", "", "-", "+"])
        ip = str(rng.randint(0, 9999))
        fp = "".join(rng.choice("0123456789") for _ in range(rng.randint(0, 7)))
        s = sgn + ip + ("." + fp if fp else "")
        out.append({"s": s, "h": exact(s)})
    return out


def surprise_cases(rng):
    out = []
    for _ in range(600):
        est = rng.choice([0, rng.randint(-5000000, 5000000), rng.randint(1, 20000), None])
        rep = rng.choice([None, rng.randint(-5000000, 5000000), rng.randint(1, 20000)])
        out.append({"rep": rep, "est": est, "sx": sx_expect(rep, est)})
    out.append({"rep": 1, "est": 2000000, "sx": sx_expect(1, 2000000)})
    out.append({"rep": 1000001, "est": 2000000, "sx": sx_expect(1000001, 2000000)})
    out.append({"rep": 0, "est": 200000, "sx": sx_expect(0, 200000)})
    return out


def when_of(v):
    if not isinstance(v, str):
        return None
    w = v.strip().lower()
    if w in ("premarket", "bmo"):
        return "pre"
    if w in ("postmarket", "amc"):
        return "post"
    return None


def reduce_expect(rows):
    keep = []
    for x in rows:
        if str(x.get("report_type", "")).strip().lower() != "quarterly":
            continue
        fe = x.get("fiscal_date_ending")
        if not fe:
            continue
        rep = exact(x["reported_eps"]) if x.get("reported_eps") is not None else None
        est = exact(x["estimated_eps"]) if x.get("estimated_eps") is not None else None
        sx = sx_expect(rep, est)
        feed = x.get("surprise_percentage")
        unit = None
        if sx is not None and feed is not None:
            fv = float(feed)
            unit = 1 if abs(fv / 100 - sx) <= 0.0005 else 0
        keep.append([fe, x.get("report_date"), when_of(x.get("report_time")), rep, est, sx, unit])
    keep.sort(key=lambda z: z[0], reverse=True)
    return keep[:12]


def eps_bodies(rng):
    cases = []
    for k in range(60):
        rows = []
        d = date(2026, 9, 30)
        for i in range(rng.randint(0, 16)):
            fe = d - timedelta(days=91 * i)
            est = round(rng.uniform(-1, 4), rng.choice([2, 3, 4, 5]))
            rep = round(est * rng.uniform(0.7, 1.4) + rng.uniform(-0.1, 0.1), rng.choice([2, 3, 4]))
            sx = (rep - est) / abs(est) if est else None
            sp = None if sx is None or rng.random() < 0.2 else (sx * 100 if rng.random() < 0.7 else sx * 100 + 3)
            rows.append({
                "ticker": "SYE001", "report_type": rng.choice(["quarterly", "quarterly", "quarterly", "annual"]),
                "fiscal_date_ending": fe.isoformat(),
                "report_date": (fe + timedelta(days=rng.randint(20, 45))).isoformat() if rng.random() > 0.05 else None,
                "report_time": rng.choice(["premarket", "postmarket", "BMO", "amc", "unknown", None]),
                "reported_eps": None if rng.random() < 0.05 else f"{rep}", "estimated_eps": None if rng.random() < 0.05 else f"{est}",
                "surprise": None, "surprise_percentage": None if sp is None else f"{sp:.4f}",
            })
        cases.append({"data": rows, "expect": reduce_expect(rows)})
    return cases


def join_cases(rng):
    out = []
    for _ in range(120):
        evs = []
        eps = []
        fin = []
        for i in range(rng.randint(1, 6)):
            d = date(2026, 6, 1) - timedelta(days=91 * i)
            evs.append([d.isoformat(), None, 0.05, rng.choice([0.04, -0.03]), None, None, None, None])
            off = rng.choice([0, 1, -2, 3, -3, 4, 5])
            if rng.random() < 0.7:
                eps.append([(d - timedelta(days=100)).isoformat(), (d + timedelta(days=off)).isoformat(), None, 120000, 100000, rng.choice([0.2, -0.1, None]), None])
            if rng.random() < 0.5:
                fin.append({"d": (d - timedelta(days=100)).isoformat(), "rd": (d + timedelta(days=rng.choice([0, 2, -3, 6]))).isoformat(), "rep": rng.choice([1.2, 0.95, None]), "est": rng.choice([1.0, 1.0, 0, None])})
            if rng.random() < 0.15 and eps:
                eps.append([(d - timedelta(days=99)).isoformat(), (d + timedelta(days=-off if off else 1)).isoformat(), None, 90000, 100000, -0.1, None])
        out.append({"events": evs, "eps": eps, "fin": fin})
    return out


def join_expect(case):
    res = []

    def gap(a, b):
        return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)

    for ev in case["events"]:
        d = ev[0]
        cands = [x for x in case["eps"] if x[1] and gap(x[1], d) <= 3]
        sx = None
        if cands:
            best = min(cands, key=lambda x: (gap(x[1], d), x[1]))
            sx = best[5]
        else:
            fc = [x for x in case["fin"] if x["rd"] and gap(x["rd"], d) <= 3]
            if fc:
                best = min(fc, key=lambda x: (gap(x["rd"], d), x["rd"]))
                rep = exact(repr(best["rep"])) if best["rep"] is not None else None
                est = exact(repr(best["est"])) if best["est"] is not None else None
                sx = sx_expect(rep, est)
        res.append([d, ev[2], ev[3], sx])
    return res


def is_session(d):
    return d.weekday() < 5 and d.isoformat() not in HOLIDAYS


def close_time(d):
    return time(13, 0) if d.isoformat() in EARLY else time(16, 0)


def et(d, t):
    return datetime.combine(d, t, tzinfo=NY).astimezone(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def impact_cases(rng):
    out = []
    d0 = date(2024, 1, 2)
    for _ in range(300):
        d = d0 + timedelta(days=rng.randint(0, 1450))
        for when in ("pre", "post"):
            res = None
            if when == "pre":
                x = d
                while not is_session(x):
                    x += timedelta(days=1)
                res = iso(et(x, time(9, 30)))
            elif is_session(d):
                res = iso(et(d, close_time(d)))
            out.append({"d": d.isoformat(), "when": when, "at": res})
    return out


def phase_of(ts_ms):
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).astimezone(NY)
    d = dt.date()
    if not is_session(d):
        return "closed"
    pre, op, cl, post = et(d, time(4, 0)), et(d, time(9, 30)), et(d, close_time(d)), et(d, time(20, 0))
    t = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
    if pre <= t < op:
        return "pre"
    if op <= t < cl:
        return "rth"
    if cl <= t < post:
        return "post"
    return "closed"


def phase_cases(rng):
    out = []
    start = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    for _ in range(400):
        d = rng.randint(0, 600)
        minute = rng.choice([rng.randint(0, 1439), rng.choice([239, 240, 569, 570, 599, 600, 779, 780, 959, 960, 1199, 1200])])
        ts = start + d * 86400000 + minute * 60000 + rng.choice([0, 0, 30000])
        out.append({"ms": ts, "at": iso(datetime.fromtimestamp(ts / 1000, tz=timezone.utc)), "phase": phase_of(ts)})
    return out


def main():
    rng = random.Random(20261027)
    hist = []
    for _ in range(400):
        evs = history(rng)
        em_now = rng.choice([None, r(rng.uniform(0.01, 0.2), 6), r(rng.uniform(0.01, 0.2), 6)])
        h, tr, tz = hist_expect(evs, em_now)
        hist.append({"events": evs, "emNow": em_now, "hist": h, "todayR": tr, "todayZ": tz})
    conc = []
    for _ in range(200):
        rows = []
        for i in range(rng.randint(0, 12)):
            m = rng.choice([None, 0.0, r(rng.uniform(-0.2, 0.2), 6)])
            s = rng.choice([None, 0.0, r(rng.uniform(-0.5, 0.5), 6)])
            rows.append([f"2026-0{1 + i % 9}-01", 0.05, m, s])
        conc.append({"rows": rows, "expect": conc_expect(rows)})
    pooled = []
    for _ in range(40):
        picks = rng.sample(hist, rng.randint(0, 25))
        pooled.append({"hists": [p["hist"] for p in picks], "expect": pooled_expect([p["hist"] for p in picks])})
    bodies = eps_bodies(rng)
    jc = join_cases(rng)
    data = {
        "provenance": {
            "generator": "tests/gen-er-fixtures.py",
            "nature": "synthetic, computed by an independent standard-library implementation; not observed feed data",
            "python": sys.version.split()[0],
            "calendarFixture": "tests/fixtures-calendar.json",
            "t": "Student t quantile by bisection over the regularised incomplete beta; numpy and scipy were not installed where this was written",
        },
        "hist": hist, "conc": conc, "pooled": pooled,
        "hundredths": eps_strings(rng), "surprise": surprise_cases(rng),
        "reduce": bodies,
        "join": [{**c, "expect": join_expect(c)} for c in jc],
        "impact": impact_cases(rng), "phase": phase_cases(rng),
    }
    gen = Path(__file__).read_bytes()
    data["provenance"]["generatorSha256"] = hashlib.sha256(gen).hexdigest()
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=True) + "\n")
    print("wrote", OUT, OUT.stat().st_size)


main()
