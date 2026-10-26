import datetime
import hashlib
import json
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "docs", "uw-openapi.yaml")
OUT_PATH = os.path.join(ROOT, "tests", "fixtures-vendor-extras.json")

with open(SPEC_PATH, "rb") as handle:
    SPEC_BYTES = handle.read()
SPEC = yaml.safe_load(SPEC_BYTES)
COMPONENTS = SPEC["components"]["schemas"]

OPS = {
    "dividends": "/api/companies/{ticker}/dividends",
    "splits": "/api/companies/{ticker}/splits",
    "interpolated-iv": "/api/stock/{ticker}/interpolated-iv",
    "etf-exposure": "/api/etfs/{ticker}/exposure",
}

NOW_DAY = "2026-10-20"
TICKER = "SYX101"
FUNDS = ["SYF101", "SYF102", "SYF103", "SYF104"]


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


def root_schema(op):
    response = SPEC["paths"][op]["get"]["responses"]["200"]
    return deref(response["content"]["application/json"]["schema"])


def type_of(schema, name):
    node = properties(schema).get(name)
    node = deref(node) if node is not None else {}
    return node.get("type") if isinstance(node, dict) else None


def day(offset):
    base = datetime.date.fromisoformat(NOW_DAY)
    return (base + datetime.timedelta(days=offset)).isoformat()


def build():
    bodies = {}
    div_item = properties(properties(root_schema(OPS["dividends"])).get("data", {})).get("dividends", {})
    div_props = properties(deref(div_item).get("items", {}))
    assert {"amount", "ex_date", "declaration_date", "record_date", "payment_date"} <= set(div_props), "the dividend row changed in the spec"
    quarterly = [-285, -194, -103, -11, 17]
    bodies["dividends"] = {"data": {"ticker": TICKER, "dividends": [
        {"amount": 0.25 if i < 4 else 0.26, "ex_date": day(d), "declaration_date": day(d - 25), "record_date": day(d), "payment_date": day(d + 14)}
        for i, d in enumerate(quarterly)
    ]}}
    bodies["dividends-empty"] = {"data": {"ticker": "SYX102", "dividends": []}}
    bodies["splits"] = {"data": {"ticker": TICKER, "splits": [{"effective_date": "2020-08-31", "split_factor": 4}]}}
    bodies["splits-empty"] = {"data": {"ticker": "SYX102", "splits": []}}
    iv_props = properties(root_schema(OPS["interpolated-iv"]))
    assert {"date", "days", "implied_move_perc", "percentile", "volatility"} <= set(iv_props), "the interpolated IV row changed in the spec"
    assert type_of(root_schema(OPS["interpolated-iv"]), "days") == "integer", "days is no longer an integer in the spec"
    bodies["interpolated-iv"] = {"data": [
        {"date": NOW_DAY, "days": days, "volatility": vol, "implied_move_perc": move, "percentile": pct}
        for days, vol, move, pct in [(7, "0.412", "0.021", "91.250"), (14, "0.371", "0.027", "63.000"), (30, "0.299", "0.058", "77.193"),
                                     (60, "0.288", "0.081", "55.500"), (90, "0.281", "0.098", "48.100"), (180, "0.274", "0.141", "40.800"), (365, "0.266", "0.198", "33.300")]
    ]}
    etf_props = properties(root_schema(OPS["etf-exposure"]))
    assert {"etf", "full_name", "last_price", "prev_price", "shares", "weight"} <= set(etf_props), "the ETF exposure row changed in the spec"
    bodies["etf-exposure"] = {"data": [
        {"etf": fund, "full_name": fund + " Fixture Fund", "last_price": "56.79", "prev_price": "56.10", "shares": shares, "weight": weight}
        for fund, shares, weight in zip(FUNDS, [48427939, 1200500, 305000, 99000], ["3.10", "0.35", "5.25", "0.35"])
    ]}
    return bodies


def problems(bodies):
    out = []
    for key, body in bodies.items():
        op = OPS[key.split("-empty")[0]] if key.split("-empty")[0] in OPS else OPS[key]
        allowed = documented(root_schema(op)) | {"data"}

        def walk(value, path):
            if isinstance(value, dict):
                for name, sub in value.items():
                    if name not in allowed:
                        out.append("%s.%s: not a name the spec documents" % (path, name))
                    walk(sub, "%s.%s" % (path, name))
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    walk(item, "%s[%d]" % (path, i))

        walk(body, key)
    return out


def main():
    bodies = build()
    found = problems(bodies)
    if found:
        for line in found:
            print("DRIFT: " + line, file=sys.stderr)
        sys.exit(1)
    doc = {
        "ticker": TICKER,
        "nowDay": NOW_DAY,
        "ops": OPS,
        "documented": {op: sorted(documented(root_schema(op)) | {"data"}) for op in OPS.values()},
        "bodies": bodies,
        "provenance": {
            "generator": "tests/gen-extras-fixtures.py",
            "nature": "synthetic bodies built to the committed OpenAPI schema with invented tickers and invented figures; spec-derived, not observed on the wire, not vendor data",
            "wire": "no weekly probe run has answered these four operations yet; scripts/flows-probe-shapes.json holds no shape for them",
            "spec": "docs/uw-openapi.yaml",
            "specSha256": hashlib.sha256(SPEC_BYTES).hexdigest(),
        },
    }
    with open(OUT_PATH, "w") as handle:
        json.dump(doc, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print("wrote %s" % os.path.relpath(OUT_PATH, ROOT))


if __name__ == "__main__":
    main()
