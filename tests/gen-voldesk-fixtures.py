import datetime
import hashlib
import json
import math
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "docs", "uw-openapi.yaml")
SHAPES_PATH = os.path.join(ROOT, "scripts", "flows-probe-shapes.json")
OUT_PATH = os.path.join(ROOT, "tests", "fixtures-voldesk.json")

with open(SPEC_PATH, "rb") as handle:
    SPEC_BYTES = handle.read()
with open(SHAPES_PATH, "rb") as handle:
    SHAPES_BYTES = handle.read()
with open(os.path.abspath(__file__), "rb") as handle:
    SELF_BYTES = handle.read()
SPEC = yaml.safe_load(SPEC_BYTES)
SHAPES = json.loads(SHAPES_BYTES)["ops"]
COMPONENTS = SPEC["components"]["schemas"]

SESSION = "2026-10-23"
PREV_SESSION = "2026-10-22"
TICKER = "SYX101"
FUNDS = ["SPY", "QQQ", "IWM", "DIA"]
SECTORS = ["XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE"]
CORR = FUNDS + SECTORS

PATHS = {
    "vix-term": "/api/volatility/vix-term-structure",
    "vol-character-top": "/api/volatility/character/top",
    "vol-realized": "/api/stock/{ticker}/volatility/realized",
    "vol-stats": "/api/stock/{ticker}/volatility/stats",
    "greeks": "/api/stock/{ticker}/greeks",
    "option-chains": "/api/stock/{ticker}/option-chains",
    "atm-chains": "/api/stock/{ticker}/atm-chains",
    "oi-per-expiry": "/api/stock/{ticker}/oi-per-expiry",
    "volume-oi-expiry": "/api/stock/{ticker}/option/volume-oi-expiry",
    "greek-exposure-strike": "/api/stock/{ticker}/greek-exposure/strike",
    "greek-exposure-strike-expiry": "/api/stock/{ticker}/greek-exposure/strike-expiry",
    "option-stance": "/api/stock/{ticker}/option-stance",
    "market-correlations": "/api/market/correlations",
    "term-structure": "/api/stock/{ticker}/volatility/term-structure",
}


def deref(schema):
    while isinstance(schema, dict) and "$ref" in schema:
        schema = COMPONENTS[schema["$ref"].split("/")[-1]]
    return schema


def properties(schema):
    schema = deref(schema)
    out = {}
    if not isinstance(schema, dict):
        return out
    for part in schema.get("allOf", []) + schema.get("oneOf", []):
        out.update(properties(part))
    out.update(schema.get("properties", {}) or {})
    return out


def documented(schema, into=None, depth=0):
    into = set() if into is None else into
    schema = deref(schema)
    if not isinstance(schema, dict) or depth > 6:
        return into
    for part in schema.get("allOf", []) + schema.get("oneOf", []):
        documented(part, into, depth + 1)
    if schema.get("type") == "array":
        documented(schema.get("items", {}), into, depth + 1)
    for name, sub in properties(schema).items():
        into.add(name)
        documented(sub, into, depth + 1)
    return into


def response_names(path):
    try:
        schema = SPEC["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    except KeyError:
        return set()
    return documented(schema)


def observed_keys(path):
    entry = SHAPES.get(path)
    if not entry:
        return None
    keys = set()
    for members in entry.get("sets", {}).values():
        keys.update(members.keys())
    return keys


PROBLEMS = []


def check(op, rows):
    path = PATHS[op]
    names = response_names(path)
    seen = observed_keys(path)
    for row in rows:
        for key in row:
            in_spec = bool(names) and key in names
            in_seen = seen is not None and key in seen
            if (names or seen is not None) and not in_spec and not in_seen and key != "data":
                PROBLEMS.append(f"{op}: key {key} is in neither the spec's response schema nor the observed set")


def noise(*parts):
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return (int.from_bytes(digest[:4], "big") / 0xFFFFFFFF) * 2 - 1


def ncdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))


def npdf(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def s(x, places=6):
    return f"{x:.{places}f}"


def add_days(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


SPOT = 250.0
CARRY = 0.01
RATE = 0.04
EXPIRIES = [
    {"dte": 9, "sigma": 0.31},
    {"dte": 30, "sigma": 0.28},
    {"dte": 58, "sigma": 0.27},
]
STRIKES = [round(SPOT * m, 4) for m in (0.90, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075, 1.10)]
CHOSEN_DTE = 30


def expiry_of(dte):
    return add_days(SESSION, dte)


def engine_expiry(e):
    T = e["dte"] / 365
    F = SPOT * math.exp(CARRY * T)
    D = math.exp(-RATE * T)
    return {
        "expiry": expiry_of(e["dte"]), "dte": e["dte"], "T": T, "sessions": max(1, round(e["dte"] * 5 / 7)),
        "forward": {"F": round(F, 6), "D": round(D, 8)},
        "smile": {"method": "flat", "params": {"sigma": e["sigma"]}},
    }


def d1(F, K, sigma, T):
    nu = sigma * math.sqrt(T)
    return math.log(F / K) / nu + nu / 2


def call_delta(F, K, sigma, T):
    return ncdf(d1(F, K, sigma, T))


def gamma_spot(F, D, K, sigma, T):
    nu = sigma * math.sqrt(T)
    return (D * F / SPOT) * npdf(d1(F, K, sigma, T)) / (SPOT * nu)


def oi_of(dte, K, kind):
    base = 1000 + int(K * 7) % 400
    return base + (60 if kind == "C" else 0) + dte


def symbol(dte, K, kind):
    return f"SYX101{expiry_of(dte).replace('-', '')[2:]}{kind}{int(K * 1000):08d}"


def chain_rows(truncated=False):
    rows = []
    for e in EXPIRIES:
        for K in STRIKES:
            for kind in ("C", "P"):
                rows.append({"expiry": expiry_of(e["dte"]), "K": K, "type": kind, "oi": oi_of(e["dte"], K, kind)})
    return {"rows": rows, "truncated": truncated}


def card():
    return {"ticker": TICKER, "spot": SPOT, "engine": {"spot": SPOT, "expiries": [engine_expiry(e) for e in EXPIRIES]}}


def world_inputs(mods):
    gscale = mods.get("gammaScale", 1.0)
    dshift = mods.get("deltaShift", 0.0)
    ivshift = mods.get("ivShift", 0.0)
    gnoise = mods.get("gammaNoise", 0.03)
    oi_scale = mods.get("oiExpiryScale", 1.0)
    date = mods.get("greeksDate", SESSION)
    chosen = next(e for e in EXPIRIES if e["dte"] == CHOSEN_DTE)
    ex = engine_expiry(chosen)
    F = ex["forward"]["F"]
    D = ex["forward"]["D"]
    T = ex["T"]
    sigma = chosen["sigma"]
    greeks = []
    for K in STRIKES:
        cd = call_delta(F, K, sigma, T)
        g = gamma_spot(F, D, K, sigma, T) * gscale * (1 + gnoise * noise("g", K))
        vol = sigma + ivshift + 0.004 * noise("v", K)
        greeks.append({
            "call_delta": s(cd + dshift + 0.008 * noise("cd", K)), "put_delta": s(cd - 1 + dshift + 0.008 * noise("pd", K)),
            "call_gamma": s(g, 8), "put_gamma": s(g, 8),
            "call_volatility": s(vol), "put_volatility": s(vol + 0.001),
            "call_theta": "-0.012345", "put_theta": "-0.011111", "call_vega": "0.045", "put_vega": "0.045",
            "call_rho": "0.01", "put_rho": "-0.01", "call_charm": "0.001", "put_charm": "0.001", "call_vanna": "0.002", "put_vanna": "0.002",
            "call_option_symbol": symbol(CHOSEN_DTE, K, "C"), "put_option_symbol": symbol(CHOSEN_DTE, K, "P"),
            "date": date, "expiry": expiry_of(CHOSEN_DTE), "strike": s(K, 2),
        })
    chain = chain_rows(mods.get("truncated", False))
    atm = []
    for K in (STRIKES[4], STRIKES[5]):
        for kind in ("C", "P"):
            atm.append({
                "option_symbol": symbol(CHOSEN_DTE, K, kind), "expiry": expiry_of(CHOSEN_DTE), "strike": s(K, 2),
                "option_type": "call" if kind == "C" else "put", "open_interest": oi_of(CHOSEN_DTE, K, kind) + (mods.get("selfOff", 0) if (K == STRIKES[4] and kind == "C") else 0),
                "stock_price": s(SPOT * (1 + mods.get("spotOff", 0.0)), 4), "volume": 120,
            })
    option_chains = []
    for K in STRIKES:
        for kind in ("C", "P"):
            option_chains.append({
                "option_symbol": symbol(CHOSEN_DTE, K, kind), "strike": s(K, 2), "expires": expiry_of(CHOSEN_DTE),
                "option_type": "call" if kind == "C" else "put", "open_interest": oi_of(CHOSEN_DTE, K, kind),
                "implied_volatility": s(sigma), "delta": s(call_delta(F, K, sigma, T) - (0 if kind == "C" else 1)), "gamma": s(gamma_spot(F, D, K, sigma, T), 8),
            })
    oi_per_expiry = []
    for e in EXPIRIES:
        c = sum(r["oi"] for r in chain["rows"] if r["expiry"] == expiry_of(e["dte"]) and r["type"] == "C")
        p = sum(r["oi"] for r in chain["rows"] if r["expiry"] == expiry_of(e["dte"]) and r["type"] == "P")
        scale = oi_scale if e["dte"] == CHOSEN_DTE else 1.0
        oi_per_expiry.append({"date": SESSION, "expiry": expiry_of(e["dte"]), "call_oi": int(round(c * scale)), "put_oi": int(round(p * scale))})
    volume_oi = []
    for e in EXPIRIES:
        total = sum(r["oi"] for r in chain["rows"] if r["expiry"] == expiry_of(e["dte"]))
        volume_oi.append({"expires": expiry_of(e["dte"]), "oi": total, "volume": 900})
    strike_expiry = []
    for K in STRIKES:
        cd = call_delta(F, K, sigma, T)
        strike_expiry.append({
            "strike": s(K, 2), "expiry": expiry_of(CHOSEN_DTE),
            "call_delta": s(cd * oi_of(CHOSEN_DTE, K, "C") * 100 * (1 + mods.get("dexScale", 0.0)), 2),
            "put_delta": s((cd - 1) * oi_of(CHOSEN_DTE, K, "P") * 100 * (1 + mods.get("dexScale", 0.0)), 2),
            "call_gex": "1.0", "put_gex": "1.0", "call_charm": "1", "put_charm": "1", "call_vanna": "1", "put_vanna": "1",
        })
    strike_rows = []
    for K in STRIKES:
        total = 0.0
        for e in EXPIRIES:
            ee = engine_expiry(e)
            total += gamma_spot(ee["forward"]["F"], ee["forward"]["D"], K, e["sigma"], ee["T"]) * (oi_of(e["dte"], K, "C") + oi_of(e["dte"], K, "P")) * 100
        strike_rows.append({
            "strike": s(K, 2), "call_gex": s(total / 2 * (1 + mods.get("gexScale", 0.0)), 4), "put_gex": s(total / 2 * (1 + mods.get("gexScale", 0.0)), 4),
            "call_delta": "0", "put_delta": "0", "call_charm": "1", "put_charm": "1", "call_vanna": "1", "put_vanna": "1",
        })
    return {
        "card": card(), "chain": chain, "greeks": greeks, "chains": option_chains, "atm": atm,
        "oiExpiry": oi_per_expiry, "volOi": volume_oi, "exStrike": strike_rows, "exStrikeExpiry": strike_expiry, "session": SESSION,
    }


def world_meta(inp):
    chosen = next(e for e in EXPIRIES if e["dte"] == CHOSEN_DTE)
    ex = engine_expiry(chosen)
    F = ex["forward"]["F"]
    D = ex["forward"]["D"]
    T = ex["T"]
    sigma = chosen["sigma"]
    rows = [r for r in inp["greeks"]]
    rows = [r for r in rows if r["date"] == SESSION]
    near = sorted(rows, key=lambda r: (abs(float(r["strike"]) - F), float(r["strike"])))[:5]
    ks = [float(r["strike"]) for r in near]
    eD = sum(call_delta(F, K, sigma, T) for K in ks) / len(ks) if ks else None
    fD = sum(float(r["call_delta"]) for r in near) / len(near) if near else None
    ratios = sorted(float(r["call_gamma"]) / gamma_spot(F, D, float(r["strike"]), sigma, T) for r in near) if near else []
    ratio = None
    if ratios:
        mid = len(ratios) // 2
        ratio = ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2
    return {"F": F, "strikes": ks, "engineDelta": eD, "feedDelta": fD, "gammaRatio": ratio}


def expected(inp, name):
    meta = world_meta(inp)
    out = {"meta": meta}
    tol = {"delta": 0.03, "ivPts": 1.5, "gammaRel": 0.15, "oiRel": 0.01, "dexRel": 0.05, "gexRel": 0.10, "spotRel": 0.0025}
    rows = {}
    chosen = next(e for e in EXPIRIES if e["dte"] == CHOSEN_DTE)
    expiry = expiry_of(CHOSEN_DTE)
    spot_feed = float(inp["atm"][0]["stock_price"])
    rows["spot"] = "agree" if abs(SPOT - spot_feed) / max(SPOT, spot_feed) <= tol["spotRel"] + 1e-12 else "differs"
    date_off = any(r["date"] != SESSION for r in inp["greeks"])
    if date_off:
        for k in ("delta", "iv", "gamma"):
            rows[k] = "nc"
    else:
        rows["delta"] = "agree" if abs(meta["feedDelta"] - meta["engineDelta"]) <= tol["delta"] + 1e-12 else "differs"
        ivs = []
        evs = []
        for K in meta["strikes"]:
            r = next(x for x in inp["greeks"] if float(x["strike"]) == K)
            ivs.append(float(r["call_volatility"] if K >= meta["F"] else r["put_volatility"]))
            evs.append(chosen["sigma"])
        gap = (sum(ivs) / len(ivs) - sum(evs) / len(evs)) * 100
        rows["iv"] = "agree" if abs(gap) <= tol["ivPts"] + 1e-12 else "differs"
        ratio = meta["gammaRatio"]
        if 1 / 1.15 <= ratio <= 1.15:
            unit = "per$"
        elif (SPOT / 100) / 1.15 <= ratio <= (SPOT / 100) * 1.15:
            unit = "per1%"
        else:
            unit = None
        out["unit"] = unit
        if unit == "per$":
            eg = []
            fg = []
            ee = engine_expiry(chosen)
            for K in meta["strikes"]:
                r = next(x for x in inp["greeks"] if float(x["strike"]) == K)
                eg.append(gamma_spot(ee["forward"]["F"], ee["forward"]["D"], K, chosen["sigma"], ee["T"]))
                fg.append(float(r["call_gamma"]))
            a = sum(eg) / len(eg)
            b = sum(fg) / len(fg)
            rows["gamma"] = "agree" if abs(a - b) / max(abs(a), abs(b), 1e-4) <= tol["gammaRel"] + 1e-12 else "differs"
        else:
            rows["gamma"] = "nc"
    if inp["chain"]["truncated"]:
        for k in ("oiExpiry", "oiAll", "dexExpiry", "gexAll"):
            rows[k] = "nc"
    else:
        eoi = sum(r["oi"] for r in inp["chain"]["rows"] if r["expiry"] == expiry)
        foi = sum(r["call_oi"] + r["put_oi"] for r in inp["oiExpiry"] if r["expiry"] == expiry)
        rows["oiExpiry"] = "agree" if abs(eoi - foi) / max(eoi, foi) <= tol["oiRel"] + 1e-12 else "differs"
        rows["oiAll"] = "agree"
        ee = engine_expiry(chosen)
        edex = 0.0
        gross = 0.0
        for r in inp["chain"]["rows"]:
            if r["expiry"] != expiry:
                continue
            cd = call_delta(ee["forward"]["F"], r["K"], chosen["sigma"], ee["T"])
            d = (cd if r["type"] == "C" else cd - 1) * r["oi"] * 100
            edex += d
            gross += abs(d)
        fdex = sum(float(r["call_delta"]) + float(r["put_delta"]) for r in inp["exStrikeExpiry"])
        rows["dexExpiry"] = "agree" if abs(edex - fdex) / max(gross, 1) <= tol["dexRel"] + 1e-12 else "differs"
        if out.get("unit") == "per$":
            egex = 0.0
            for e in EXPIRIES:
                x = engine_expiry(e)
                for r in inp["chain"]["rows"]:
                    if r["expiry"] != x["expiry"]:
                        continue
                    egex += gamma_spot(x["forward"]["F"], x["forward"]["D"], r["K"], e["sigma"], x["T"]) * r["oi"] * 100 * SPOT * SPOT / 100
            fgex = sum(float(r["call_gex"]) + float(r["put_gex"]) for r in inp["exStrike"]) * SPOT * SPOT / 100
            rows["gexAll"] = "agree" if abs(egex - fgex) / max(abs(egex), abs(fgex)) <= tol["gexRel"] + 1e-12 else "differs"
        else:
            rows["gexAll"] = "nc"
    atm_by = {r["option_symbol"]: r["open_interest"] for r in inp["atm"]}
    chains_by = {r["option_symbol"]: r["open_interest"] for r in inp["chains"]}
    matched = [k for k in atm_by if k in chains_by]
    rows["chainSelf"] = "nc" if not matched else ("agree" if all(atm_by[k] == chains_by[k] for k in matched) else "differs")
    out["rows"] = rows
    judged = {k: v for k, v in rows.items() if k != "chainSelf"}
    compared = sum(1 for v in judged.values() if v in ("agree", "differs"))
    out["v"] = "differs" if any(v == "differs" for v in judged.values()) else ("agree" if compared >= 3 else "nc")
    return out


def worlds():
    defs = {
        "agree": {},
        "differs": {"deltaShift": 0.05, "oiExpiryScale": 0.97},
        "per1pct": {"gammaScale": SPOT / 100},
        "nounit": {"gammaScale": 7.0},
        "dateoff": {"greeksDate": PREV_SESSION},
        "truncated": {"truncated": True},
        "spotoff": {"spotOff": 0.01},
        "selfoff": {"selfOff": 5},
    }
    out = {}
    for name, mods in defs.items():
        inp = world_inputs(mods)
        out[name] = {"mods": mods, "input": inp, "expect": expected(inp, name)}
    out["plan"] = {"mods": {}, "input": {**world_inputs({}), "greeks": {"why": "plan"}, "oiExpiry": {"why": "limited"}}, "expect": None}
    out["failed"] = {"mods": {}, "input": {**world_inputs({}), "greeks": {"why": "failed"}}, "expect": None}
    return out


def term_rows(shape):
    dtes = [7, 14, 30, 60, 90, 180, 365]
    rows = []
    for d in dtes:
        if shape == "contango":
            v = 0.14 + 0.00012 * d
        elif shape == "backwardation":
            v = 0.26 - 0.00018 * d
        elif shape == "flat":
            v = 0.2
        else:
            v = 0.2
        if shape == "short" and d > 60:
            continue
        rows.append({"date": SESSION, "dte": d, "expiry": expiry_of(d), "ticker": "SPY", "volatility": s(v), "implied_move": "1.0", "implied_move_perc": "0.01"})
    check("term-structure", rows)
    return rows


def realized(offset_days=0, count=30):
    rows = []
    for i in range(count):
        day = add_days(SESSION, -(count - 1 - i) - offset_days)
        rows.append({"date": day, "implied_volatility": s(0.18 + 0.01 * noise("riv", i)), "realized_volatility": s(0.14 + 0.01 * noise("rrv", i)), "price": s(500 + i, 2), "unshifted_rv_date": day})
    rows[-1]["implied_volatility"] = "0.1850"
    rows[-1]["realized_volatility"] = "0.1400"
    check("vol-realized", rows)
    return rows


def stats(ticker):
    row = {"ticker": ticker, "date": SESSION, "iv": "0.1850", "iv_high": "0.3000", "iv_low": "0.1000", "rv": "0.1400", "iv_rank": "42.5", "rv_high": "0.4", "rv_low": "0.05"}
    check("vol-stats", [row])
    return row


def corr_rows(world):
    rows = []
    for i, a in enumerate(CORR):
        for j, b in enumerate(CORR):
            if i >= j:
                continue
            r = round(0.35 + 0.5 * (1 - abs(noise("c", a, b))) - (0.9 if (a in SECTORS and b in SECTORS and noise("neg", a, b) > 0.85) else 0), 4)
            r = max(-0.99, min(0.99, r))
            base = {"fst": a, "snd": b, "correlation": s(r, 4), "rows": 63, "min_date": "2026-07-24", "max_date": SESSION}
            rows.append(base)
            rows.append({**base, "fst": b, "snd": a})
    if world == "asym":
        rows[1] = {**rows[1], "correlation": s(float(rows[1]["correlation"]) + 0.01, 4)}
    if world == "absent":
        rows = [r for r in rows if not (r["fst"] == "SPY" and r["snd"] == "QQQ") and not (r["fst"] == "QQQ" and r["snd"] == "SPY")]
    if world == "few":
        pairs = sorted({tuple(sorted((r["fst"], r["snd"]))) for r in rows if r["fst"] in SECTORS and r["snd"] in SECTORS})
        gone = set(pairs[:20])
        rows = [r for r in rows if tuple(sorted((r["fst"], r["snd"]))) not in gone]
    check("market-correlations", rows)
    return rows


def char_rows(prev=False):
    names = ["SYX201", "SYX202", "SYX203", "SYX204", "SYX205", "SYX206"]
    labels = ["mean-reverting", "moderate", "persistent"]
    out = []
    for i, t in enumerate(names):
        hl = 2.0 + i * 1.5 + (0.0 if not prev else (0.4 if i == 1 else (3.0 if i == 2 else 0.0)))
        label = labels[i % 3]
        if not prev and i == 4:
            label = "persistent"
        if prev and i == 4:
            label = "moderate"
        out.append({"ticker": t, "character": label, "half_life_days": s(hl, 4), "hurst_rv": s(0.3 + 0.08 * i, 4), "date": SESSION if not prev else PREV_SESSION})
    return out


def stance_rows():
    out = []
    for i, dte in enumerate([5, 14, 15, 9]):
        out.append({
            "option_symbol": symbol(30, STRIKES[4] + i, "C"), "pop": s(0.55 + 0.01 * i, 4), "delta": s(0.3 + 0.01 * i, 4), "iv": s(0.3, 4), "dte": dte,
            "fit_score": s(4.5 - 0.3 * i, 3), "expires": expiry_of(dte), "option_type": "call", "strike": s(STRIKES[4] + i, 2),
            "components": {"x": 1}, "explanation": "text", "roc": "0.1", "premium": "1.0", "avg_price": "1.0", "rank_metric": "1", "disclaimer": "d",
        })
    return out


def vix_rows():
    out = []
    for i, d in enumerate([20, 48, 76, 104, 139, 167]):
        out.append({"expiry": expiry_of(d), "price": s(17.5 + 0.55 * i, 3), "vix": "16.8"})
    return out


def main():
    ws = worlds()
    fx = {
        "session": SESSION,
        "ticker": TICKER,
        "fixture": True,
        "worlds": ws,
        "term": {k: term_rows(k) for k in ("contango", "backwardation", "flat", "short")},
        "realized": {"fresh": realized(), "stale": realized(offset_days=3)},
        "stats": {"SPY": stats("SPY")},
        "corr": {k: corr_rows(k) for k in ("ok", "asym", "absent", "few")},
        "character": {
            "today": char_rows(False), "prev": char_rows(True),
        },
        "vix": {"rows": vix_rows(), "history": [{"date": PREV_SESSION, "expiry": expiry_of(20), "price": "17.2"}]},
        "stance": stance_rows(),
        "shapes": {
            "conjectured": {"ops": {
                PATHS["vix-term"]: {"sets": {"data.latest[]": {"expiry": "str", "price": "str#", "vix": "str#"}, "data.history[]": {"date": "str", "expiry": "str", "price": "str#"}}},
                PATHS["vol-character-top"]: {"sets": {"data[]": {"ticker": "str", "character": "str", "half_life_days": "str#", "hurst_rv": "str#", "date": "str"}}},
            }},
            "conjecturedNoPrice": {"ops": {
                PATHS["vix-term"]: {"sets": {"data.latest[]": {"expiry": "str", "vix": "str#"}}},
                PATHS["vol-character-top"]: {"sets": {"data[]": {"ticker": "str", "character": "str", "half_life_days": "str#", "date": "str"}}},
            }},
        },
        "provenance": {
            "generator": "tests/gen-voldesk-fixtures.py",
            "generatorSha256": hashlib.sha256(SELF_BYTES).hexdigest(),
            "specSha256": hashlib.sha256(SPEC_BYTES).hexdigest(),
            "shapesSha256": hashlib.sha256(SHAPES_BYTES).hexdigest(),
            "nature": "synthetic, written from the schema; not feed data",
        },
    }
    for name, w in ws.items():
        inp = w["input"]
        for op, key in (("greeks", "greeks"), ("option-chains", "chains"), ("atm-chains", "atm"), ("oi-per-expiry", "oiExpiry"),
                        ("volume-oi-expiry", "volOi"), ("greek-exposure-strike", "exStrike"), ("greek-exposure-strike-expiry", "exStrikeExpiry")):
            if isinstance(inp[key], list):
                check(op, inp[key])
    check("option-stance", fx["stance"])
    if PROBLEMS:
        for p in sorted(set(PROBLEMS)):
            print(p, file=sys.stderr)
        sys.exit(1)
    with open(OUT_PATH, "w") as handle:
        json.dump(fx, handle, indent=1, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
