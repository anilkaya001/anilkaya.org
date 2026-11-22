import hashlib
import json
import os
import platform
import re
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_FILE = "docs/uw-openapi.yaml"
OUT_FILE = "tests/fixtures-feed-catalog-oracle.json"
GENERATOR = "tests/gen-feed-catalog-oracle.py"
POINTER = "#/components/schemas/"
VERBS = ("get", "post", "put", "patch", "delete")
SOCKET = "websocket"

CORE_NULL = {"", "null", "Null", "NULL", "~"}
CORE_TRUE = {"true", "True", "TRUE"}
CORE_FALSE = {"false", "False", "FALSE"}
CORE_INT = re.compile(r"^[-+]?[0-9]+$")
CORE_OCT = re.compile(r"^0o[0-7]+$")
CORE_HEX = re.compile(r"^0x[0-9a-fA-F]+$")
CORE_FLOAT = re.compile(r"^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$")
CORE_INF = {".inf": float("inf"), ".Inf": float("inf"), ".INF": float("inf"), "+.inf": float("inf"), "+.Inf": float("inf"), "+.INF": float("inf"),
            "-.inf": float("-inf"), "-.Inf": float("-inf"), "-.INF": float("-inf")}
CORE_NAN = {".nan", ".NaN", ".NAN"}

DECIMAL = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$")
ID_NAME = re.compile(r"(?:(?:^|_)(?:id|ids|identifier|cik|code|codes|symbol|cusip)|type)$")
TEXT_FORMATS = ("date", "date-time", "uuid")


def core_scalar(text):
    if text in CORE_NULL:
        return None
    if text in CORE_TRUE:
        return True
    if text in CORE_FALSE:
        return False
    if CORE_INT.match(text):
        return int(text)
    if CORE_OCT.match(text):
        return int(text[2:], 8)
    if CORE_HEX.match(text):
        return int(text[2:], 16)
    if CORE_FLOAT.match(text):
        return float(text)
    if text in CORE_INF:
        return CORE_INF[text]
    if text in CORE_NAN:
        return float("nan")
    return text


def build(node):
    if isinstance(node, yaml.ScalarNode):
        return core_scalar(node.value) if node.style is None else node.value
    if isinstance(node, yaml.MappingNode):
        out = {}
        for key, value in node.value:
            if key.value in out:
                raise SystemExit("duplicate key %s" % key.value)
            out[key.value] = build(value)
        return out
    return [build(item) for item in node.value]


def node_tree(node):
    if isinstance(node, yaml.ScalarNode):
        return ["p" if node.style is None else "q", node.value]
    if isinstance(node, yaml.MappingNode):
        return {key.value: node_tree(value) for key, value in node.value}
    return [node_tree(item) for item in node.value]


def fixed(number):
    text = format(float(number), ".10f").rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def canon(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return "#" + fixed(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canon(v) for v in value) + "]"
    return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(value[k]) for k in sorted(value)) + "}"


def digest(value):
    return hashlib.sha256(canon(value).encode("utf8")).hexdigest()[:16]


class Spec:
    def __init__(self, doc):
        self.doc = doc
        self.pool = doc.get("components", {}).get("schemas", {})
        self.by_trim = {}
        for name in self.pool:
            self.by_trim.setdefault(name.strip(), name)

    def target(self, pointer):
        name = pointer[len(POINTER):]
        if name in self.pool:
            return name
        return self.by_trim[name.strip()]

    def describe(self, schema, above=()):
        chain = []
        here = schema
        while isinstance(here, dict) and "$ref" in here:
            name = self.target(here["$ref"])
            if name in above or name in chain:
                return {"t": "any", "chain": tuple(chain), "null": False, "loop": True}
            chain.append(name)
            here = self.pool[name]
        chain = tuple(chain)
        if not isinstance(here, dict):
            return {"t": "any", "chain": chain, "null": False}
        deeper = tuple(above) + chain
        null = here.get("nullable") is True
        t = here.get("type")
        fmt = here.get("format")
        if t == "date":
            t, fmt = "string", "date"
        if fmt == "date_time":
            fmt = "date-time"
        props = dict(here["properties"]) if isinstance(here.get("properties"), dict) else None
        free = "additionalProperties" in here and here["additionalProperties"] is not False
        stand_in = None
        options = here.get("oneOf") if isinstance(here.get("oneOf"), list) else here.get("anyOf") if isinstance(here.get("anyOf"), list) else None
        if options is not None:
            kept = []
            for option in options:
                if isinstance(option, dict) and option.get("type") == "null":
                    null = True
                    continue
                if isinstance(option, dict) and not any(k in option for k in ("$ref", "type", "properties", "items")):
                    continue
                kept.append(self.describe(option, deeper))
            if len(kept) == 1 and props is None and t is None:
                stand_in = kept[0]
            elif kept and all(k["t"] == "object" for k in kept):
                props = props or {}
                for k in kept:
                    for name, sub in (k.get("props") or {}).items():
                        props.setdefault(name, sub)
                    if k.get("free") or not k.get("props"):
                        free = True
                t = "object"
            elif kept and props is None and t is None:
                return {"t": "any", "chain": chain, "null": null}
        for part in here.get("allOf", []) if isinstance(here.get("allOf"), list) else []:
            got = self.describe(part, deeper)
            if got.get("loop"):
                continue
            if got["null"]:
                null = True
            if got["t"] == "object":
                props = props or {}
                for name, sub in (got.get("props") or {}).items():
                    props.setdefault(name, sub)
                if got.get("free"):
                    free = True
                t = t or "object"
            elif t is None and props is None and stand_in is None:
                stand_in = got
        if stand_in is not None:
            merged = dict(stand_in)
            merged["null"] = null or stand_in["null"]
            merged["chain"] = chain + stand_in["chain"]
            return merged
        if t == "array" or "items" in here:
            return {"t": "array", "chain": chain, "null": null, "items": here.get("items"), "has_items": "items" in here}
        if t == "object" or props is not None or free:
            return {"t": "object", "chain": chain, "null": null, "props": props or {}, "free": free}
        if t == "null":
            return {"t": "any", "chain": chain, "null": True}
        if t not in ("string", "integer", "number", "boolean"):
            return {"t": "any", "chain": chain, "null": null}
        out = {"t": t, "chain": chain, "null": null}
        if isinstance(fmt, str):
            out["format"] = fmt
        if isinstance(here.get("enum"), list):
            out["enum"] = list(here["enum"])
        for src, dst in (("example", "example"), ("default", "default"), ("pattern", "pattern")):
            if src in here and (src != "pattern" or isinstance(here[src], str)):
                out[dst] = here[src]
        if isinstance(here.get("minimum"), (int, float)) and not isinstance(here.get("minimum"), bool):
            out["min"] = here["minimum"]
        if isinstance(here.get("maximum"), (int, float)) and not isinstance(here.get("maximum"), bool):
            out["max"] = here["maximum"]
        return out


def numeric_text(d, name):
    return (d["t"] == "string" and "enum" not in d and d.get("format") not in TEXT_FORMATS
            and isinstance(d.get("example"), str) and bool(DECIMAL.match(d["example"])) and not ID_NAME.search(name))


def field_row(path, d, name):
    row = {"path": path, "type": d["t"]}
    if "format" in d:
        row["format"] = d["format"]
    if "enum" in d:
        row["enum"] = d["enum"]
    if numeric_text(d, name):
        row["numeric"] = True
    if d["null"]:
        row["nullable"] = True
    if d.get("free"):
        row["open"] = True
    return row


def walk(spec, d, path, name, above, rows):
    rows.append(field_row(path, d, name))
    below = tuple(above) + d["chain"]
    if d["t"] == "array" and d.get("has_items"):
        walk(spec, spec.describe(d["items"], below), path + "[]", name, below, rows)
    if d["t"] == "object":
        for key in sorted(d["props"]):
            walk(spec, spec.describe(d["props"][key], below), key if path == "" else path + "." + key, key, below, rows)


def body_rows(spec, schema):
    top = spec.describe(schema)
    rows = []
    if top["t"] == "object" and top["props"]:
        for key in sorted(top["props"]):
            walk(spec, spec.describe(top["props"][key], top["chain"]), key, key, top["chain"], rows)
        return ("envelope" if "data" in top["props"] else "row"), rows
    if top["t"] == "array":
        if top.get("has_items"):
            walk(spec, spec.describe(top["items"], top["chain"]), "[]", "", top["chain"], rows)
        return "list", rows
    return "open", rows


def seen_kind(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str) and DECIMAL.match(value):
        return "numeric"
    return "text"


def seen_at(tops, path):
    layer = list(tops)
    for part in path.split("."):
        name = part
        depth = 0
        while name.endswith("[]"):
            name = name[:-2]
            depth += 1
        if name != "":
            layer = [v[name] for v in layer if isinstance(v, dict) and name in v]
        for _ in range(depth):
            layer = [item for v in layer if isinstance(v, list) for item in v]
    return [v for v in layer if v is not None]


def settle(row, seen):
    if not seen or "enum" in row:
        return row
    kinds = set(seen_kind(v) for v in seen)
    figures = kinds <= {"number", "numeric"}
    name = row["path"].replace("[]", "").split(".")[-1]
    out = dict(row)
    loose = False
    if row["type"] == "string":
        if figures and ("number" in kinds or (row.get("format") != "uuid" and not ID_NAME.search(name))):
            if row.get("format") in TEXT_FORMATS:
                del out["format"]
            out["numeric"] = True
        elif kinds & {"boolean", "number", "list", "object"}:
            loose = True
        elif row.get("numeric") and "text" in kinds:
            del out["numeric"]
    elif row["type"] == "boolean":
        loose = kinds != {"boolean"}
    elif row["type"] in ("integer", "number"):
        loose = not figures
    if loose:
        out.pop("format", None)
        out.pop("numeric", None)
        out["type"] = "any"
    return out


def sample_tops(spec, schema, documents, wrapped):
    node = schema
    hops = 0
    while isinstance(node, dict) and "$ref" in node and hops < 32:
        node = spec.pool[spec.target(node["$ref"])]
        hops += 1
    sample = node.get("example") if isinstance(node, dict) else None
    if sample is None:
        return None
    if documents == "envelope":
        return [sample]
    inner = sample[wrapped[0]] if isinstance(sample, dict) and wrapped[1] == "example" and wrapped[0] in sample else sample
    if documents == "list":
        return [inner]
    return inner if isinstance(inner, list) else [inner]


WRAPPER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def wrapper(spec, schema, documents, rows):
    if documents == "envelope":
        return ["data", "schema", False, False]
    node = schema
    hops = 0
    while isinstance(node, dict) and "$ref" in node and hops < 32:
        node = spec.pool[spec.target(node["$ref"])]
        hops += 1
    sample = node.get("example") if isinstance(node, dict) else None
    if isinstance(sample, list) and sample and all(isinstance(item, dict) for item in sample):
        return ["data", "assumed", True, False]
    if isinstance(sample, dict):
        top = set(row["path"] for row in rows if "." not in row["path"] and "[" not in row["path"])
        named = [key for key in sample if key not in top and WRAPPER.match(key) and isinstance(sample[key], (list, dict))]
        if len(named) == 1:
            return [named[0], "example", False, False]
        if sample and (documents == "open" or any(key in top for key in sample)):
            return ["data", "assumed", False, True]
    return ["data", "assumed", False, False]


SINGLE_TOKEN = re.compile(r"^[A-Za-z0-9_.-]+$")


def stated_default(leaf):
    value = leaf["default"]
    if not isinstance(value, str):
        return True
    if "enum" in leaf:
        return value in leaf["enum"]
    return bool(SINGLE_TOKEN.match(value))


def param_row(spec, raw):
    if raw["in"] not in ("path", "query"):
        raise SystemExit("a parameter in the %s" % raw["in"])
    d = spec.describe(raw.get("schema"))
    row = {"name": str(raw["name"]), "in": str(raw["in"]), "required": raw.get("required") is True, "type": d["t"]}
    leaf = d
    if d["t"] == "array":
        leaf = spec.describe(d["items"], d["chain"]) if d.get("has_items") else {"t": "any", "null": False}
        row["items"] = leaf["t"]
    for key in ("format", "enum", "default", "min", "max", "pattern"):
        if key in leaf and (key != "default" or stated_default(leaf)):
            row[key] = leaf[key]
    if d["null"] or leaf.get("null"):
        row["nullable"] = True
    return row


def operation(spec, verb, route, op):
    tags = [str(t) for t in op.get("tags", [])]
    params = []
    seen = set()
    for raw in op.get("parameters") or []:
        key = (raw["in"], raw["name"])
        if key in seen:
            continue
        seen.add(key)
        params.append(param_row(spec, raw))
    for token in re.findall(r"\{([^{}]+)\}", route):
        found = [p for p in params if p["in"] == "path" and p["name"] == token]
        if not found:
            params.append({"name": token, "in": "path", "required": True, "type": "string", "implied": True})
        else:
            found[0]["required"] = True
    responses = op.get("responses") or {}
    statuses = sorted(int(code) for code in responses if re.fullmatch(r"[0-9]+", str(code)))
    content = (responses.get("200") or {}).get("content") or {}
    kind = "socket" if SOCKET in tags else "json" if "application/json" in content else "file" if content else "none"
    documents, rows = (None, [])
    wrapped = [None, None, False, False]
    if kind == "json":
        documents, rows = body_rows(spec, content["application/json"]["schema"])
        wrapped = wrapper(spec, content["application/json"]["schema"], documents, rows)
        tops = sample_tops(spec, content["application/json"]["schema"], documents, wrapped)
        if tops is not None:
            rows = [settle(row, seen_at(tops, row["path"])) for row in rows]
    out = {"kind": kind, "statuses": statuses, "documents": documents, "wrapped": wrapped, "fields": rows, "params": params}
    request = op.get("requestBody")
    if isinstance(request, dict):
        schema = ((request.get("content") or {}).get("application/json") or {}).get("schema")
        sets = []
        fields = []
        if schema is not None:
            fields = body_rows(spec, schema)[1]
            node = schema
            hops = 0
            while isinstance(node, dict) and "$ref" in node and hops < 32:
                node = spec.pool[spec.target(node["$ref"])]
                hops += 1
            if isinstance(node, dict):
                if isinstance(node.get("required"), list):
                    sets.append([str(x) for x in node["required"]])
                for option in node.get("oneOf") or []:
                    if isinstance(option, dict) and isinstance(option.get("required"), list):
                        sets.append([str(x) for x in option["required"]])
        out["body"] = {"required": request.get("required") is True, "fields": fields, "requiredSets": sets}
    return out


FAMILY = re.compile(r"^[a-z][a-z0-9_-]*$")


def channel_name(raw):
    text = str(raw).strip()
    m = re.match(r"^([A-Za-z0-9_-]+)(?::(?:TICKER|<TICKER>))?$", text)
    if not m or not FAMILY.match(m.group(1)):
        return None
    return m.group(1), ("ticker" if ":" in text else "all")


def sample_kind(value):
    if value is None:
        return {"type": "any", "nullable": True}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, list):
        return {"type": "array"}
    if isinstance(value, dict):
        return {"type": "object"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "integer" if value.is_integer() else "number"}
    return {"type": "string"}


def table_words(text):
    words = {}
    for m in re.finditer(r"^\|((?: *`[^`|]+`,?)+) *\| *([^|]*?) *\|", text, re.M):
        for name in re.findall(r"`([^`]+)`", m.group(1)):
            if name in words and words[name] != m.group(2):
                words[name] = None
            elif name not in words:
                words[name] = m.group(2)
    return words


def payload_rows(payload, words, path, rows):
    for key in sorted(payload):
        value = payload[key]
        at = key if path == "" else path + "." + key
        row = {"path": at}
        row.update(sample_kind(value))
        word = words.get(key)
        if isinstance(word, str):
            if row["type"] == "string" and word in ("decimal", "decimal string"):
                row["numeric"] = True
            if row["type"] == "integer" and word in ("number", "float"):
                row["type"] = "number"
            if row["type"] == "string":
                if word == "ISO 8601 string":
                    row["format"] = "date-time"
                elif word.startswith("date string"):
                    row["format"] = "date"
                elif word == "uuid string":
                    row["format"] = "uuid"
        if row["type"] == "string" and isinstance(value, str) and DECIMAL.match(value) and "format" not in row and not ID_NAME.search(key):
            row["numeric"] = True
        rows.append(row)
        if row["type"] == "object":
            payload_rows(value, words, at, rows)
        if row["type"] == "array" and value:
            first = value[0]
            item = {"path": at + "[]"}
            item.update(sample_kind(first))
            if item["type"] == "string" and isinstance(first, str) and DECIMAL.match(first):
                item["numeric"] = True
            rows.append(item)
            if item["type"] == "object":
                payload_rows(first, words, at + "[]", rows)


def page_samples(text):
    found = {}
    for m in re.finditer(r"```[a-z]*\n(.*?)\n```", text, re.S):
        try:
            value = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], dict):
            found.setdefault(value[0].split(":")[0], value[1])
        elif isinstance(value, dict):
            found.setdefault(None, value)
    return found


def channels(doc):
    paths = doc["paths"]
    overview = None
    for route in sorted(paths):
        op = paths[route].get("get")
        if isinstance(op, dict) and SOCKET in (op.get("tags") or []) and route.endswith("/socket"):
            overview = route
    if overview is None:
        return []
    pages = {}
    for route in sorted(paths):
        op = paths[route].get("get")
        if not isinstance(op, dict) or SOCKET not in (op.get("tags") or []) or route == overview:
            continue
        text = op.get("description") or ""
        note = re.search(r"documentation for (?:the )?websocket channels? ([^\n]*)", text)
        families = []
        for name in re.findall(r"`([^`]+)`", note.group(1) if note else ""):
            got = channel_name(name)
            if got and got[0] not in families:
                families.append(got[0])
        samples = page_samples(text)
        words = table_words(text)
        for family in families:
            payload = samples.get(family)
            if payload is None and len(families) == 1:
                payload = samples.get(None) or (list(samples.values())[0] if samples else None)
            rows = []
            if payload:
                payload_rows(payload, words, "", rows)
            pages[family] = {"page": route, "fields": rows}
    out = []
    seen = set()
    for m in re.finditer(r"^\| *([^|\n]+?) *\| *([^|\n]*?) *\|$", paths[overview]["get"].get("description") or "", re.M):
        got = channel_name(m.group(1))
        if not got:
            continue
        family, scope = got
        cid = family + ":<T>" if scope == "ticker" else family
        if cid in seen:
            continue
        seen.add(cid)
        page = pages.get(family)
        out.append({"id": cid, "family": family, "scope": scope, "page": page["page"] if page else None, "fields": page["fields"] if page else []})
    return out


def main():
    with open(os.path.join(ROOT, SPEC_FILE), "rb") as handle:
        raw = handle.read()
    root = yaml.compose(raw.decode("utf8"))
    tree = json.dumps(node_tree(root), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    doc = build(root)
    spec = Spec(doc)
    ops = {}
    counts = {"paths": len(doc["paths"]), "operations": 0, "json": 0, "file": 0, "socket": 0, "none": 0, "params": 0, "fields": 0, "numeric": 0, "nullable": 0,
              "schemas": len(spec.pool)}
    for route in sorted(doc["paths"]):
        for verb in VERBS:
            op = doc["paths"][route].get(verb)
            if not isinstance(op, dict):
                continue
            got = operation(spec, verb, route, op)
            counts["operations"] += 1
            counts[got["kind"]] += 1
            counts["params"] += len(got["params"])
            counts["fields"] += len(got["fields"])
            counts["numeric"] += sum(1 for f in got["fields"] if f.get("numeric"))
            counts["nullable"] += sum(1 for f in got["fields"] if f.get("nullable"))
            entry = {
                "shape": digest([got["kind"], got["statuses"], got["documents"]] + got["wrapped"]),
                "params": digest(got["params"]),
                "fields": digest(got["fields"]),
                "n": [len(got["params"]), len(got["fields"])],
            }
            if "body" in got:
                entry["body"] = digest(got["body"])
            ops["%s %s" % (verb.upper(), route)] = entry
    chans = channels(doc)
    counts["channels"] = len(chans)
    with open(os.path.join(ROOT, GENERATOR), "rb") as handle:
        own = hashlib.sha256(handle.read()).hexdigest()
    out = {
        "provenance": {
            "generator": GENERATOR,
            "generatorSha256": own,
            "python": platform.python_version(),
            "pyyaml": yaml.__version__,
            "spec": SPEC_FILE,
            "specSha256": hashlib.sha256(raw).hexdigest(),
            "nature": "hashes and counts of what an independent reader (PyYAML and this script) derives from the committed document; no value of the document and no data from the feed",
        },
        "tree": {"sha256": hashlib.sha256(tree).hexdigest(), "bytes": len(tree)},
        "counts": counts,
        "ops": ops,
        "channels": {c["id"]: {"shape": digest([c["family"], c["scope"], c["page"]]), "fields": digest(c["fields"]), "n": len(c["fields"])} for c in chans},
    }
    text = json.dumps(out, indent=1, sort_keys=True) + "\n"
    target = os.path.join(ROOT, OUT_FILE)
    if "--check" in sys.argv[1:]:
        with open(target, "r", encoding="utf8") as handle:
            if handle.read() != text:
                print("%s differs from what %s derives; run python3 %s" % (OUT_FILE, GENERATOR, GENERATOR), file=sys.stderr)
                sys.exit(1)
        print("%s is current" % OUT_FILE)
        return
    with open(target, "w", encoding="utf8") as handle:
        handle.write(text)
    print("wrote %s: %d operations, %d channels" % (OUT_FILE, counts["operations"], counts["channels"]))


if __name__ == "__main__":
    main()
