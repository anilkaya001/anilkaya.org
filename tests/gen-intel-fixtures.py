import datetime
import hashlib
import json
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_PATH = os.path.join(ROOT, "docs", "uw-openapi.yaml")
OUT_PATH = os.path.join(ROOT, "tests", "fixtures-intel.json")

with open(SPEC_PATH, "rb") as handle:
    SPEC_BYTES = handle.read()
with open(os.path.abspath(__file__), "rb") as handle:
    SELF_BYTES = handle.read()
SPEC = yaml.safe_load(SPEC_BYTES)
COMPONENTS = SPEC["components"]["schemas"]

SESSION = "2026-10-27"

OPS = {
    "ipo-calendar": "/api/calendar/ipo",
    "listings": "/api/companies/listings",
    "potus-schedule": "/api/potus/schedule",
}


def deref(schema):
    while isinstance(schema, dict) and "$ref" in schema:
        schema = COMPONENTS.get(schema["$ref"].replace("#/components/schemas/", ""), {})
    return schema


def documented(schema, into=None, depth=0):
    into = set() if into is None else into
    schema = deref(schema)
    if not isinstance(schema, dict) or depth > 8:
        return into
    if schema.get("type") == "array":
        documented(schema.get("items", {}), into, depth + 1)
    for name, sub in (schema.get("properties") or {}).items():
        into.add(name)
        documented(sub, into, depth + 1)
    return into


def nullable(schema, name):
    schema = deref(schema)
    if schema.get("type") == "array":
        return nullable(schema.get("items", {}), name)
    props = schema.get("properties") or {}
    if name in props:
        return bool(deref(props[name]).get("nullable"))
    for sub in props.values():
        found = nullable(sub, name)
        if found is not None:
            return found
    return None


def root_schema(op):
    response = SPEC["paths"][op]["get"]["responses"]["200"]
    return deref(response["content"]["application/json"]["schema"])


def day(offset):
    return (datetime.date.fromisoformat(SESSION) + datetime.timedelta(days=offset)).isoformat()


def ipo_body():
    rows = [
        {"ticker": "SYX501", "name": "Synthetic Holdings Alpha", "exchange": "NASDAQ", "ipo_date": day(2), "price_range_low": 14.0, "price_range_high": 16.0, "currency": "USD"},
        {"ticker": "SYX502", "name": "Synthetic Bio Beta", "exchange": "NYSE", "ipo_date": day(2), "price_range_low": 21.5, "price_range_high": 23.5, "currency": "usd"},
        {"ticker": "SYX503", "name": "Synthetic Energy Gamma", "exchange": "NASDAQ", "ipo_date": day(11), "price_range_low": None, "price_range_high": None, "currency": "USD"},
        {"ticker": "SYX504", "name": "Synthetic Systems Delta", "exchange": "NYSE", "ipo_date": day(19), "price_range_low": 10.0, "price_range_high": 12.0, "currency": None},
        {"ticker": "SYX505", "name": "Synthetic Freight Epsilon", "exchange": "NASDAQ", "ipo_date": day(25), "price_range_low": 18.0, "price_range_high": 17.0, "currency": "USD"},
        {"ticker": None, "name": "Synthetic Unnamed Zeta", "exchange": None, "ipo_date": None, "price_range_low": None, "price_range_high": None, "currency": None},
        {"ticker": "SYX506", "name": "Synthetic Past Eta", "exchange": "NYSE", "ipo_date": day(-3), "price_range_low": 8.0, "price_range_high": 9.0, "currency": "USD"},
        {"ticker": "SYX507", "name": "Synthetic Far Theta", "exchange": "NASDAQ", "ipo_date": day(140), "price_range_low": 30.0, "price_range_high": 34.0, "currency": "USD"},
        {"ticker": "SYX508", "name": "Synthetic Foreign Iota", "exchange": "NASDAQ", "ipo_date": day(40), "price_range_low": 4.0, "price_range_high": 5.0, "currency": "EUR"},
        {"ticker": "SYX501", "name": "Synthetic Holdings Alpha", "exchange": "NASDAQ", "ipo_date": day(2), "price_range_low": 14.0, "price_range_high": 16.0, "currency": "USD"},
    ]
    return {"data": {"ipos": rows}}


def listings_body():
    rows = [
        {"ticker": "SYX601", "name": "Synthetic Delisted One", "exchange": "NYSE", "asset_type": "Stock", "status": "Delisted", "ipo_date": "2014-05-02", "delisting_date": day(-4)},
        {"ticker": "SYX602", "name": "Synthetic Delisted Two", "exchange": "NASDAQ", "asset_type": "ETF", "status": "Delisted", "ipo_date": None, "delisting_date": day(-1)},
    ]
    return {"data": {"date": SESSION, "status": "delisted", "listings": rows}}


def potus_body():
    rows = [
        {"type": "President Schedule", "date": SESSION, "time": SESSION + "T15:00:00Z", "coverage": "Closed Press", "location": "Synthetic Room", "details": "A synthetic policy meeting", "url": None, "video_url": None},
        {"type": "President Schedule", "date": SESSION, "time": None, "coverage": None, "location": None, "details": None, "url": None, "video_url": None},
    ]
    return {"data": rows}


def keys_of(value, into):
    if isinstance(value, list):
        for v in value:
            keys_of(v, into)
    elif isinstance(value, dict):
        for k, v in value.items():
            into.add(k)
            keys_of(v, into)
    return into


def check(op_id, body):
    op = OPS[op_id]
    schema = root_schema(op)
    names = documented(schema) | {"data"}
    extra = sorted(keys_of(body, set()) - names)
    if extra:
        sys.stderr.write(op_id + ": keys the spec does not document: " + ", ".join(extra) + "\n")
        sys.exit(1)
    return sorted(names)


def main():
    bodies = {"ipo-calendar": ipo_body(), "listings": listings_body(), "potus-schedule": potus_body()}
    documented_names = {k: check(k, v) for k, v in bodies.items()}
    for name in ["price_range_low", "price_range_high", "currency", "ipo_date", "ticker"]:
        if nullable(root_schema(OPS["ipo-calendar"]), name) is not True:
            sys.stderr.write("ipo-calendar: " + name + " is no longer nullable in the spec\n")
            sys.exit(1)
    out = {
        "provenance": {
            "generator": "tests/gen-intel-fixtures.py",
            "nature": "synthetic bodies written from the committed spec's 200-response schemas, invented tickers, not vendor data and not observed on the wire",
            "specSha256": hashlib.sha256(SPEC_BYTES).hexdigest(),
            "generatorSha256": hashlib.sha256(SELF_BYTES).hexdigest(),
            "session": SESSION,
        },
        "ops": OPS,
        "documented": documented_names,
        "bodies": bodies,
    }
    with open(OUT_PATH, "w") as handle:
        handle.write(json.dumps(out, sort_keys=True, separators=(",", ":")) + "\n")


main()
