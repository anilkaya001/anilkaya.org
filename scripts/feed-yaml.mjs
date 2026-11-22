export class YamlError extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.name = "YamlError";
    this.line = line;
  }
}

const INT = /^[-+]?[0-9]+$/;
const FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const OCTAL = /^0o[0-7]+$/;
const HEX = /^0x[0-9a-fA-F]+$/;
const NULLS = new Set(["", "null", "Null", "NULL", "~"]);
const TRUES = new Set(["true", "True", "TRUE"]);
const FALSES = new Set(["false", "False", "FALSE"]);
const INFS = new Map([[".inf", Infinity], [".Inf", Infinity], [".INF", Infinity], ["+.inf", Infinity], ["+.Inf", Infinity], ["+.INF", Infinity], ["-.inf", -Infinity], ["-.Inf", -Infinity], ["-.INF", -Infinity]]);
const NANS = new Set([".nan", ".NaN", ".NAN"]);

export function resolvePlain(text) {
  if (NULLS.has(text)) return null;
  if (TRUES.has(text)) return true;
  if (FALSES.has(text)) return false;
  if (INT.test(text)) return Number(text);
  if (OCTAL.test(text)) return parseInt(text.slice(2), 8);
  if (HEX.test(text)) return parseInt(text.slice(2), 16);
  if (FLOAT.test(text)) return Number(text);
  if (INFS.has(text)) return INFS.get(text);
  if (NANS.has(text)) return NaN;
  return text;
}

const ESCAPES = new Map([
  ["0", "\0"], ["a", "\x07"], ["b", "\b"], ["t", "\t"], ["\t", "\t"], ["n", "\n"], ["v", "\v"], ["f", "\f"], ["r", "\r"],
  ["e", "\x1b"], [" ", " "], ['"', '"'], ["/", "/"], ["\\", "\\"], ["N", "\x85"], ["_", "\xa0"], ["L", String.fromCharCode(0x2028)], ["P", String.fromCharCode(0x2029)],
]);
const HEX_ESCAPES = new Map([["x", 2], ["u", 4], ["U", 8]]);

export const MAX_DEPTH = 64;

const ENTRY = /^-(?: |$)/;
const PLAIN_REFUSED_FIRST = new Set(["&", "*", "!", "%", "@", "`", ",", "]", "}", "#"]);

const leadOf = (line) => {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
};

const isBlank = (line) => line.trim() === "";

const commentAt = (s) => {
  let at = s.indexOf(" #");
  if (at < 0) return -1;
  while (at > 0 && s[at - 1] === " ") at--;
  return at;
};

export function parseYaml(text, { nodes = false } = {}) {
  if (typeof text !== "string") throw new YamlError("the document is not text", 0);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let at = 0;
  const fail = (message, line = at) => { throw new YamlError(message, line + 1); };
  const plain = (raw) => (nodes ? ["p", raw] : resolvePlain(raw));
  const quoted = (value) => (nodes ? ["q", value] : value);

  const skip = () => {
    while (at < lines.length) {
      const line = lines[at];
      if (isBlank(line) || /^ *#/.test(line)) { at++; continue; }
      if (line.includes("\t") && /^ *\t/.test(line)) fail("a tab in the indentation");
      return true;
    }
    return false;
  };

  const readSingle = (s, from) => {
    let out = "";
    let i = from + 1;
    for (;;) {
      if (i >= s.length) fail("a single-quoted scalar does not close on its line");
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        return { value: out, end: i + 1 };
      }
      out += s[i];
      i++;
    }
  };

  const readDouble = (s, from) => {
    let out = "";
    let i = from + 1;
    for (;;) {
      if (i >= s.length) fail("a double-quoted scalar does not close on its line");
      const c = s[i];
      if (c === '"') return { value: out, end: i + 1 };
      if (c !== "\\") { out += c; i++; continue; }
      const e = s[i + 1];
      if (e === undefined) fail("a double-quoted scalar ends in a backslash");
      if (ESCAPES.has(e)) { out += ESCAPES.get(e); i += 2; continue; }
      if (HEX_ESCAPES.has(e)) {
        const width = HEX_ESCAPES.get(e);
        const digits = s.slice(i + 2, i + 2 + width);
        if (digits.length !== width || !/^[0-9a-fA-F]+$/.test(digits)) fail(`a bad \\${e} escape`);
        out += String.fromCodePoint(parseInt(digits, 16));
        i += 2 + width;
        continue;
      }
      fail(`an unknown escape \\${e}`);
    }
  };

  const tailIsEmpty = (s, from) => {
    const rest = s.slice(from);
    return rest.trim() === "" || /^ +#/.test(rest);
  };

  const cutComment = (s) => {
    const hit = commentAt(s);
    return (hit < 0 ? s : s.slice(0, hit)).trimEnd();
  };

  const keyOf = (s) => {
    if (s[0] === "'" || s[0] === '"') {
      const got = s[0] === "'" ? readSingle(s, 0) : readDouble(s, 0);
      let i = got.end;
      while (s[i] === " ") i++;
      if (s[i] !== ":" || (i + 1 < s.length && s[i + 1] !== " ")) return null;
      return { key: got.value, rest: s.slice(i + 1) };
    }
    if (s[0] === "?" && (s.length === 1 || s[1] === " ")) fail("a complex mapping key");
    const hit = /:(?: |$)/.exec(s);
    if (!hit) return null;
    const comment = commentAt(s);
    if (comment >= 0 && comment < hit.index) return null;
    const key = s.slice(0, hit.index).trimEnd();
    if (key === "") fail("an empty mapping key");
    return { key, rest: s.slice(hit.index + 1) };
  };

  const blockScalar = (header, parent) => {
    const m = /^([|>])([-+]?)([1-9]?)([-+]?)(?: +#.*)?$/.exec(header.trimEnd());
    if (!m) fail(`a block scalar header this reader does not know: ${header.trim()}`);
    if (m[1] === ">") fail("a folded block scalar");
    if (m[2] && m[4]) fail("a block scalar header with two chomping marks");
    const chomp = m[2] || m[4];
    at++;
    let width = m[3] ? parent + Number(m[3]) : null;
    const body = [];
    while (at < lines.length) {
      const line = lines[at];
      if (isBlank(line)) {
        body.push(width !== null && line.length > width ? line.slice(width) : "");
        at++;
        continue;
      }
      const lead = leadOf(line);
      if (width === null) {
        if (lead <= parent) break;
        width = lead;
      }
      if (lead < width) break;
      body.push(line.slice(width));
      at++;
    }
    let end = body.length;
    while (end > 0 && body[end - 1] === "") end--;
    const kept = body.slice(0, end);
    const trailing = body.length - end;
    let value = kept.join("\n");
    if (chomp === "+") value += "\n".repeat(trailing + (kept.length ? 1 : 0));
    else if (chomp !== "-" && kept.length) value += "\n";
    return quoted(value);
  };

  const inline = (raw, parent) => {
    const s = raw.trimStart();
    const c = s[0];
    if (c === "|" || c === ">") return blockScalar(s, parent);
    let value;
    if (c === "'" || c === '"') {
      const got = c === "'" ? readSingle(s, 0) : readDouble(s, 0);
      if (!tailIsEmpty(s, got.end)) fail("text after a quoted scalar");
      value = quoted(got.value);
    } else if (c === "{" || c === "[") {
      const body = cutComment(s);
      if (/^\{ *\}$/.test(body)) value = {};
      else if (/^\[ *\]$/.test(body)) value = [];
      else fail("a flow collection that is not empty");
    } else if (PLAIN_REFUSED_FIRST.has(c) || /^[-?:](?: |$)/.test(s)) {
      fail(`a plain scalar cannot start with ${c}`);
    } else {
      const body = cutComment(s);
      if (/: /.test(body) || body.endsWith(":")) fail("a plain scalar that holds a mapping separator");
      value = plain(body);
    }
    at++;
    return value;
  };

  let depth = 0;
  const deeper = (read) => {
    if (depth >= MAX_DEPTH) fail(`nested deeper than the ${MAX_DEPTH} levels this reader follows`);
    depth++;
    const value = read();
    depth--;
    return value;
  };

  const nested = (parent, flush) => {
    at++;
    if (!skip()) return plain("");
    const line = lines[at];
    const lead = leadOf(line);
    if (lead > parent) return node(lead);
    if (flush && lead === parent && ENTRY.test(line.slice(lead))) return deeper(() => sequence(lead));
    return plain("");
  };

  const mapping = (indent) => {
    const out = {};
    while (skip()) {
      const line = lines[at];
      const lead = leadOf(line);
      if (lead < indent) break;
      if (lead > indent) fail("a line indented deeper than its mapping");
      const body = line.slice(indent);
      if (ENTRY.test(body)) fail("a sequence entry where a mapping key was expected");
      const got = keyOf(body);
      if (!got) fail("a line that is not a mapping entry");
      if (Object.hasOwn(out, got.key)) fail(`a duplicate key ${got.key}`);
      const value = cutComment(got.rest) === "" ? nested(indent, true) : inline(got.rest, indent);
      Object.defineProperty(out, got.key, { value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };

  const sequence = (indent) => {
    const out = [];
    while (skip()) {
      const line = lines[at];
      const lead = leadOf(line);
      if (lead < indent) break;
      if (lead > indent) fail("a line indented deeper than its sequence");
      const body = line.slice(indent);
      if (!ENTRY.test(body)) break;
      const rest = body.slice(1);
      if (cutComment(rest) === "") { out.push(nested(indent, false)); continue; }
      const pad = leadOf(rest);
      const item = rest.slice(pad);
      const inner = indent + 1 + pad;
      if (ENTRY.test(item) || (item[0] !== "|" && item[0] !== ">" && keyOf(item))) {
        lines[at] = " ".repeat(inner) + item;
        out.push(deeper(() => (ENTRY.test(item) ? sequence(inner) : mapping(inner))));
      } else {
        out.push(inline(item, indent));
      }
    }
    return out;
  };

  const node = (indent) => deeper(() => (ENTRY.test(lines[at].slice(indent)) ? sequence(indent) : keyOf(lines[at].slice(indent)) ? mapping(indent) : inline(lines[at].slice(indent), indent - 1)));

  if (!skip()) return plain("");
  if (/^%/.test(lines[at])) fail("a directive");
  if (/^---(?: |$)/.test(lines[at])) {
    if (lines[at].trim() !== "---") fail("content on the document start line");
    at++;
    if (!skip()) return plain("");
  }
  const start = leadOf(lines[at]);
  const value = node(start);
  if (skip()) {
    if (/^(?:---|\.\.\.)(?: |$)/.test(lines[at])) fail("a second document");
    fail("content this reader could not place");
  }
  return value;
}

const CONTROL_CODES = new Set([0x7f, 0x85, 0x2028, 0x2029, 0xfeff]);

const hasControl = (s) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 9 || (c > 10 && c < 32) || CONTROL_CODES.has(c)) return true;
  }
  return false;
};

const INDICATOR_FIRST = new Set(["!", "&", "*", "#", "|", ">", "@", "`", "%", "{", "}", "[", "]", ",", "'", '"']);

function needsQuotes(s) {
  if (s === "" || s === "=" || s === "<<") return true;
  if (typeof resolvePlain(s) !== "string") return true;
  if (INDICATOR_FIRST.has(s[0])) return true;
  if (/^[-?:](?: |$)/.test(s)) return true;
  if (s.startsWith("---") || s.startsWith("...")) return true;
  if (s[0] === " " || s[s.length - 1] === " ") return true;
  if (s.includes(": ") || s.includes(" #") || s.endsWith(":")) return true;
  return s.includes("\t") || s.includes("\n") || hasControl(s);
}

const DOUBLE_ESCAPES = new Map([["\\", "\\\\"], ['"', '\\"'], ["\n", "\\n"], ["\t", "\\t"], ["\r", "\\r"], ["\0", "\\0"], ["\b", "\\b"], ["\f", "\\f"], ["\v", "\\v"], ["\x07", "\\a"], ["\x1b", "\\e"], ["\x85", "\\N"], [String.fromCharCode(0x2028), "\\L"], [String.fromCharCode(0x2029), "\\P"]]);

function doubleQuoted(s) {
  let out = '"';
  for (const c of s) {
    if (DOUBLE_ESCAPES.has(c)) out += DOUBLE_ESCAPES.get(c);
    else if (hasControl(c)) out += `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else out += c;
  }
  return `${out}"`;
}

function flowScalar(s) {
  if (!needsQuotes(s)) return s;
  if (s.includes("'") || s.includes("\t") || s.includes("\n") || hasControl(s)) return doubleQuoted(s);
  return `'${s}'`;
}

const blockable = (s) => s.includes("\n") && !s.includes("\t") && !hasControl(s);

function scalarText(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ".nan";
    if (value === Infinity) return ".inf";
    if (value === -Infinity) return "-.inf";
    return String(value);
  }
  if (typeof value === "string") return flowScalar(value);
  throw new YamlError(`a value of type ${typeof value} cannot be written`, 0);
}

function blockLines(s, pad) {
  let trailing = 0;
  while (trailing < s.length && s[s.length - 1 - trailing] === "\n") trailing++;
  const body = s.slice(0, s.length - trailing);
  const lines = body === "" ? [] : body.split("\n");
  const chomp = trailing === 0 ? "-" : trailing === 1 && lines.length ? "" : "+";
  const extra = chomp === "+" ? trailing - (lines.length ? 1 : 0) : 0;
  const first = lines.find((l) => l !== "");
  const explicit = first !== undefined && first[0] === " " ? "2" : "";
  const out = [`|${explicit}${chomp}`];
  for (const line of lines) out.push(pad + line);
  for (let i = 0; i < extra; i++) out.push(pad);
  return out;
}

const isLeaf = (v) => v === null || typeof v !== "object" || (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);

function leafText(v) {
  if (v !== null && typeof v === "object") return Array.isArray(v) ? "[]" : "{}";
  return scalarText(v);
}

function emit(value, indent, out, lead, depth) {
  if (depth > MAX_DEPTH) throw new YamlError(`nested deeper than the ${MAX_DEPTH} levels this writer follows`, 0);
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    let prefix = lead;
    for (const item of value) {
      const head = `${prefix === null ? pad : prefix}- `;
      prefix = null;
      if (typeof item === "string" && blockable(item)) {
        const lines = blockLines(item, `${pad}  `);
        out.push(head + lines[0], ...lines.slice(1));
      } else if (isLeaf(item)) out.push(head + leafText(item));
      else emit(item, indent + 2, out, head, depth + 1);
    }
    return;
  }
  let prefix = lead;
  for (const key of Object.keys(value).sort()) {
    const head = `${prefix === null ? pad : prefix}${flowScalar(key)}:`;
    prefix = null;
    const v = value[key];
    if (typeof v === "string" && blockable(v)) {
      const lines = blockLines(v, `${pad}  `);
      out.push(`${head} ${lines[0]}`, ...lines.slice(1));
    } else if (v === null) out.push(head);
    else if (isLeaf(v)) out.push(`${head} ${leafText(v)}`);
    else {
      out.push(head);
      emit(v, indent + 2, out, null, depth + 1);
    }
  }
}

export function dumpYaml(value) {
  const out = ["---"];
  if (isLeaf(value)) out.push(leafText(value));
  else emit(value, 0, out, null, 1);
  return `${out.join("\n")}\n`;
}
