import hashlib
import json
import platform
import random
from decimal import ROUND_HALF_UP, Decimal, localcontext
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-format.json"
SEED = 20261026


def plain(d):
    s = format(d, "f")
    return s


def half_up(s, dp):
    with localcontext() as ctx:
        ctx.prec = 60
        q = Decimal(1).scaleb(-dp)
        return plain(Decimal(s).quantize(q, rounding=ROUND_HALF_UP))


def shortest(x):
    r = repr(float(x))
    d = Decimal(r)
    return format(d.normalize(), "f") if "e" not in r and "E" not in r else format(d, "f")


def decimals(rng):
    out = set()
    for dp in range(0, 7):
        for k in list(range(0, 40)) + [rng.randint(40, 10 ** 6) for _ in range(50)]:
            tie = Decimal(k) / Decimal(10) ** dp + Decimal(5) / Decimal(10) ** (dp + 1)
            out.add((format(tie, "f"), dp))
            below = tie - Decimal(1) / Decimal(10) ** (dp + 6)
            above = tie + Decimal(1) / Decimal(10) ** (dp + 6)
            out.add((format(below, "f"), dp))
            out.add((format(above, "f"), dp))
    for _ in range(3500):
        digits = rng.randint(1, 15)
        mant = rng.randint(10 ** (digits - 1), 10 ** digits - 1)
        exp = rng.randint(-12, 10)
        d = Decimal(mant).scaleb(exp)
        dp = rng.randint(0, 8)
        out.add((format(d, "f"), dp))
    for s in ["0", "0.5", "1.5", "2.5", "0.05", "0.005", "0.0005", "999.5", "999.995", "999949.5", "999950", "99.95", "9.995", "0.995", "0.9995", "1e-7", "5e-7", "4.9999e-7", "123456789012345.67", "1000000000000000"]:
        for dp in range(0, 7):
            d = Decimal(s)
            out.add((format(d, "f"), dp))
    cleaned = []
    for s, dp in sorted(out, key=lambda t: (t[1], Decimal(t[0]))):
        d = Decimal(s)
        if d.adjusted() > 15 or d.adjusted() < -12:
            continue
        digits = len(d.normalize().as_tuple().digits)
        if digits > 15:
            continue
        if repr(float(s)).replace("e", "E").upper() != "NAN" and Decimal(repr(float(s))) != d:
            continue
        cleaned.append([s, dp, half_up(s, dp)])
    return cleaned


MINUS = "\u2212"
NOISE = Decimal("1e-9")
UNITS = ["", "K", "M", "B", "T"]


def quant(d, dp):
    with localcontext() as ctx:
        ctx.prec = 80
        return d.quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)


def floor_text(dp):
    return "0." + "0" * (dp - 1) + "1" if dp else "1"


def fixed(v, dp, shift=0, prefix="", suffix="", plus=False, group=False):
    d = Decimal(v)
    a = abs(d)
    if a < NOISE:
        return prefix + format(quant(Decimal(0), dp), "f") + suffix
    sign = MINUS if d < 0 else ("+" if plus else "")
    q = quant(a.scaleb(shift), dp)
    if q == 0:
        return sign + "<" + prefix + floor_text(dp) + suffix
    return sign + prefix + format(q, ",f" if group else "f") + suffix


def compact_dp(n, i):
    if i == 0:
        return 0
    if n >= 100:
        return 0
    if n >= 10:
        return 1
    return 1 if i == 1 else 2


def short_dp(n, i):
    return [0, 0, 1, 2, 2][i]


def override_dp(dp):
    return compact_dp if dp is None else (lambda n, i: 0 if i == 0 else dp)


def scaled(v, dp_for, prefix="", plus=False):
    d = Decimal(v)
    a = abs(d)
    if a < NOISE:
        return prefix + "0"
    sign = MINUS if d < 0 else ("+" if plus else "")
    i = 0
    while i < 4 and a >= Decimal(10) ** (3 * (i + 1)):
        i += 1
    while True:
        x = a.scaleb(-3 * i)
        dp = dp_for(x, i)
        q = quant(x, dp)
        if q >= 1000 and i < 4:
            i += 1
            continue
        d2 = dp_for(q, i)
        if d2 < dp:
            q = quant(x, d2)
            dp = d2
        break
    if q == 0:
        return sign + "<" + prefix + floor_text(dp)
    return sign + prefix + format(q, "f") + UNITS[i]


def evaluate(fn, args):
    if fn == "px":
        return fixed(args[0], args[1])
    if fn == "pct":
        return fixed(args[0], args[1], shift=2, suffix="%", plus=args[2])
    if fn == "pts":
        return fixed(args[0], args[1], shift=2, plus=True)
    if fn == "signed":
        return fixed(args[0], args[1], plus=True)
    if fn == "int":
        return fixed(args[0], 0, plus=args[1], group=True)
    if fn == "num":
        return scaled(args[0], override_dp(args[2]), "", args[1])
    if fn == "money":
        return scaled(args[0], override_dp(args[2]), "$", args[1])
    if fn == "short":
        return scaled(args[0], short_dp, "$", args[1])
    if fn == "exact":
        return fixed(args[0], 2 if abs(Decimal(args[0])) < 1000 else 0, prefix="$", plus=args[1], group=True)
    raise SystemExit("unknown function " + fn)


BOUNDARIES = [
    "0", "0.4", "0.5", "0.95", "0.995", "0.9995", "0.0004", "0.0005", "0.004", "0.005", "0.04", "0.05", "0.00004", "0.00005",
    "1", "9.5", "9.95", "9.995", "99.5", "99.95", "99.995", "999", "999.4", "999.5", "999.95", "999.995", "1000",
    "9994", "9995", "9999", "99949", "99950", "99999", "999499", "999500", "999949", "999950", "999999", "1000000",
    "9994999", "9995000", "99949999", "99950000", "999499999", "999500000", "999949999", "999950000", "999999999", "1000000000",
    "999949999999", "999950000000", "1000000000000", "1500000000000", "999999999999999",
    "1.005", "2.675", "1.45", "4.35", "0.125", "0.375", "8.345", "10.075", "1234.5", "1234.565", "12345.678", "0.0145", "0.0285", "1.0115",
]


def function_cases(rng):
    rows = []
    values = set(BOUNDARIES)
    for _ in range(110):
        digits = rng.randint(1, 8)
        mant = rng.randint(10 ** (digits - 1), 10 ** digits - 1)
        exp = rng.randint(-8, 13)
        values.add(format(Decimal(mant).scaleb(exp), "f"))
    ordered = sorted(values, key=Decimal)
    for s in ordered:
        for neg in (False, True):
            v = ("-" + s) if neg and Decimal(s) != 0 else s
            for dp in (0, 1, 2, 4):
                rows.append(["px", [v, dp], evaluate("px", [v, dp])])
            for dp in (0, 1, 2):
                for signed in (False, True):
                    rows.append(["pct", [v, dp, signed], evaluate("pct", [v, dp, signed])])
                rows.append(["pts", [v, dp], evaluate("pts", [v, dp])])
                rows.append(["signed", [v, dp], evaluate("signed", [v, dp])])
            for signed in (False, True):
                rows.append(["int", [v, signed], evaluate("int", [v, signed])])
                for dp in (None, 0, 1):
                    rows.append(["num", [v, signed, dp], evaluate("num", [v, signed, dp])])
                    rows.append(["money", [v, signed, dp], evaluate("money", [v, signed, dp])])
                rows.append(["short", [v, signed], evaluate("short", [v, signed])])
                rows.append(["exact", [v, signed], evaluate("exact", [v, signed])])
    rng.shuffle(rows)
    return rows


def main():
    rng = random.Random(SEED)
    cases = decimals(rng)
    functions = function_cases(rng)
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-format-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "seed": SEED,
            "arithmetic": "decimal.Decimal on the decimal string, quantize ROUND_HALF_UP (ties away from zero), inputs limited to 15 significant digits so the double reads back as the same decimal",
            "synthetic": True,
        },
        "round": cases,
        "functions": functions,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(len(cases), "rounding cases", len(functions), "function cases")


main()
