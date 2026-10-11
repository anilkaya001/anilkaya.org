import { SECTION_CAPS, forReading, readIndex, unknownEntries, vetReading } from "./flows-reading.js";
import { numeralsIn } from "./flows-ask.js";

export const SALVAGE_NOTE = "the model's reply was cut off; the list of what is not known is the site's own";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const FENCE = /^\s*```(?:json)?\s*/i;
const LIST_KEYS = Object.freeze(["drivers", "tensions", "watch"]);

function frameOf(type, start, key) {
  return { type, start, key, phase: type === "obj" ? "key" : "value", cur: null, idx: 0, fields: new Map(), items: [] };
}

export function scanReply(text) {
  const src = typeof text === "string" ? text : "";
  const lead = FENCE.exec(src);
  const begin = src.indexOf("{", lead ? lead[0].length : 0);
  const out = { begin, truncated: false, closedAt: -1, members: [], elements: [], open: null };
  if (begin < 0) return out;
  const stack = [];
  let inStr = false, esc = false, strStart = -1, strIsKey = false, prim = -1;
  const complete = (start, end) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (top.type === "obj") {
      top.fields.set(top.cur, [start, end]);
      top.phase = "comma";
      if (stack.length === 1) out.members.push({ key: top.cur, start, end });
    } else {
      top.items.push([start, end]);
      if (stack.length === 2 && stack[0].type === "obj") out.elements.push({ key: top.key, index: top.idx, start, end });
      top.idx += 1;
      top.phase = "comma";
    }
  };
  const n = src.length;
  let i = begin;
  for (; i < n; i++) {
    const c = src.charCodeAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (c === 92) esc = true;
      else if (c === 34) {
        inStr = false;
        if (strIsKey) {
          const top = stack[stack.length - 1];
          try { top.cur = JSON.parse(src.slice(strStart, i + 1)); } catch { top.cur = src.slice(strStart + 1, i); }
          top.phase = "colon";
        } else complete(strStart, i + 1);
      }
      continue;
    }
    if (prim >= 0) {
      if (c === 44 || c === 93 || c === 125 || c === 32 || c === 10 || c === 13 || c === 9) { complete(prim, i); prim = -1; } else continue;
    }
    if (c === 32 || c === 10 || c === 13 || c === 9) continue;
    if (c === 123 || c === 91) {
      const parent = stack[stack.length - 1];
      stack.push(frameOf(c === 123 ? "obj" : "arr", i, parent && parent.type === "obj" ? parent.cur : parent ? parent.key : null));
      if (parent && parent.type === "obj") parent.phase = "value";
      continue;
    }
    if (c === 125 || c === 93) {
      const f = stack[stack.length - 1];
      if (!f || (c === 125) !== (f.type === "obj")) { out.malformedAt = i; break; }
      stack.pop();
      if (!stack.length) { out.closedAt = i + 1; i += 1; break; }
      complete(f.start, i + 1);
      continue;
    }
    if (c === 34) {
      const top = stack[stack.length - 1];
      strIsKey = top.type === "obj" && top.phase === "key";
      strStart = i;
      inStr = true;
      continue;
    }
    if (c === 58) { const top = stack[stack.length - 1]; if (top.type === "obj") top.phase = "value"; continue; }
    if (c === 44) { const top = stack[stack.length - 1]; top.phase = top.type === "obj" ? "key" : "value"; continue; }
    prim = i;
  }
  const finished = out.closedAt >= 0;
  out.truncated = !finished && out.malformedAt === undefined;
  if (out.truncated) out.open = openItemOf(stack, src);
  out.length = src.length;
  return out;
}

function openItemOf(stack, src) {
  const slice = (pair) => (pair ? src.slice(pair[0], pair[1]) : null);
  let item = null, citesFrame = null;
  if (stack.length >= 2 && stack[1].type === "obj") {
    item = { section: stack[0].cur, index: null, frame: stack[1] };
    if (stack.length === 3 && stack[2].type === "arr" && stack[2].key === "cites") citesFrame = stack[2];
  } else if (stack.length >= 3 && stack[1].type === "arr" && stack[2].type === "obj") {
    item = { section: stack[1].key, index: stack[1].idx, frame: stack[2] };
    if (stack.length === 4 && stack[3].type === "arr" && stack[3].key === "cites") citesFrame = stack[3];
  }
  if (!item) return null;
  const textRaw = slice(item.frame.fields.get("text"));
  if (textRaw === null) return null;
  let text;
  try { text = JSON.parse(textRaw); } catch { return null; }
  if (typeof text !== "string") return null;
  const settled = slice(item.frame.fields.get("cites"));
  let cites = null;
  if (citesFrame) {
    cites = [];
    for (const raw of citesFrame.items.map(slice)) {
      try {
        const v = JSON.parse(raw);
        if (typeof v === "string") cites.push(v);
      } catch {
        continue;
      }
    }
  } else if (settled !== null) {
    try {
      const v = JSON.parse(settled);
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) cites = v;
    } catch {
      cites = null;
    }
  }
  return { section: item.section, index: item.index, text, cites, citesComplete: !citesFrame && cites !== null };
}

function parsedSlice(src, pair) {
  try { return { ok: true, value: JSON.parse(src.slice(pair[0], pair[1])) }; } catch { return { ok: false }; }
}

export function parseReadingPartial(text) {
  const src = typeof text === "string" ? text : "";
  const scan = scanReply(src);
  if (scan.begin < 0 || scan.malformedAt !== undefined) return { value: null, truncated: false, kept: 0, dropped: 0, members: [], open: null };
  const value = {};
  const wholeKeys = new Set();
  const raws = [];
  let kept = 0, dropped = 0;
  for (const m of scan.members) {
    const p = parsedSlice(src, [m.start, m.end]);
    if (!p.ok) { dropped += 1; continue; }
    value[m.key] = p.value;
    wholeKeys.add(m.key);
    raws.push({ path: m.key, start: m.start, end: m.end, raw: src.slice(m.start, m.end) });
    kept += Array.isArray(p.value) ? p.value.length : 1;
  }
  const partial = new Map();
  for (const e of scan.elements) {
    if (wholeKeys.has(e.key)) continue;
    const p = parsedSlice(src, [e.start, e.end]);
    if (!p.ok) { dropped += 1; continue; }
    if (!partial.has(e.key)) partial.set(e.key, []);
    partial.get(e.key).push(p.value);
    raws.push({ path: e.key + "." + e.index, start: e.start, end: e.end, raw: src.slice(e.start, e.end) });
    kept += 1;
  }
  for (const [key, list] of partial) value[key] = list;
  const closedObject = scan.closedAt >= 0;
  return { value: isObj(value) ? value : null, truncated: scan.truncated, complete: closedObject, kept, dropped, members: raws, open: scan.open };
}

const ABBREVIATION = /(?:^|[\s(])(?:inc|corp|co|ltd|llc|plc|lp|llp|ag|nv|sa|se|bv|spa|ab|asa|oyj|bhd|tbk|cie|mfg|intl|bros|hldgs|no|vs|etc|approx|dept|est|st|mt|ft|jr|sr|dr|mr|mrs|ms|u\.s|u\.k|e\.g|i\.e|[a-z])$/i;
const OPENER = /^["'“‘(\[]?[A-Z0-9$−-]/;

export function sentenceEnds(text) {
  const t = typeof text === "string" ? text : "";
  const ends = [];
  const re = /[.!?]+["'”’)\]]*(?=\s|$)/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const end = m.index + m[0].length;
    const rest = t.slice(end).trimStart();
    if (!rest) { ends.push(end); continue; }
    if (m[0][0] === "." && (ABBREVIATION.test(t.slice(0, m.index)) || !OPENER.test(rest))) continue;
    if (m[0][0] !== "." && !OPENER.test(rest)) continue;
    ends.push(end);
  }
  if (!ends.length || ends[ends.length - 1] < t.trimEnd().length) ends.push(t.trimEnd().length);
  return ends;
}

export function sentencesOf(text) {
  const t = typeof text === "string" ? text : "";
  let from = 0;
  return sentenceEnds(t).map((end) => { const s = t.slice(from, end); from = end; return s.trim(); }).filter(Boolean);
}

const STOP = new Set(["that", "this", "with", "from", "their", "there", "which", "while", "about", "after", "before", "have", "been", "than", "into", "over", "such", "also", "more", "most", "some", "only", "each", "other", "these", "those", "where", "when", "then"]);
const stems = (s) => (String(s).toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(?:ing|ed|es|s)$/, ""));
const unsigned = (list) => list.map((n) => n.replace(/^-/, ""));

export function usedBy(fact, sentence) {
  if (!fact || typeof sentence !== "string") return false;
  const display = String(fact.display === undefined || fact.display === null ? "" : fact.display).replace(/−/g, "-").replace(/…$/, "").trim();
  const s = sentence.replace(/−/g, "-");
  if (display && s.toLowerCase().includes(display.toLowerCase())) return true;
  const full = typeof fact.text === "string" ? fact.text : null;
  if (full !== null) {
    const mine = stems(full);
    if (!mine.length) return false;
    const have = new Set(stems(s));
    return mine.filter((w) => have.has(w)).length / mine.length >= 0.4;
  }
  const nums = unsigned(numeralsIn(display));
  if (nums.length) {
    const have = new Set(unsigned(numeralsIn(s)));
    return nums.every((x) => have.has(x));
  }
  const words = stems(display);
  if (!words.length) return false;
  const have = new Set(stems(s));
  return words.filter((w) => have.has(w)).length / words.length >= 0.5;
}

export function citesUsed(sentences, cites, index) {
  return cites.filter((id) => {
    const f = index.get(id);
    return f && !f.withheld && sentences.some((s) => usedBy(f, s));
  });
}

export function trimAt(item, k, index) {
  const text = typeof item.text === "string" ? item.text : "";
  const ends = sentenceEnds(text);
  if (!(k >= 1) || k > ends.length) return null;
  const kept = text.slice(0, ends[k - 1]).trimEnd();
  const cites = citesUsed(sentencesOf(kept), Array.isArray(item.cites) ? item.cites : [], index);
  return cites.length ? { ...item, text: kept, cites } : null;
}

function supported(sentence, cites, index) {
  const nums = unsigned(numeralsIn(sentence));
  if (!nums.length) return true;
  const have = new Set();
  for (const id of cites) {
    const f = index.get(id);
    if (!f || f.withheld) continue;
    for (const x of unsigned(numeralsIn(String(f.label) + ": " + (f.text !== null && f.text !== undefined ? f.text : f.display) + (f.note ? " (" + f.note + ")" : "")))) have.add(x);
  }
  return nums.every((x) => have.has(x));
}

export function trimToCites(item, index) {
  const text = typeof item.text === "string" ? item.text : "";
  const cites = Array.isArray(item.cites) ? item.cites : [];
  if (!cites.length) return null;
  const ends = sentenceEnds(text);
  let from = 0, keep = 0;
  for (let k = 0; k < ends.length; k++) {
    const s = text.slice(from, ends[k]).trim();
    from = ends[k];
    if (!s || !supported(s, cites, index)) break;
    keep = k + 1;
  }
  return keep ? trimAt(item, keep, index) : null;
}

function emptySections() {
  return { identity: null, now: null, drivers: [], tensions: [], unknown: [], watch: [] };
}

function keptCount(sections) {
  return (sections.identity ? 1 : 0) + (sections.now ? 1 : 0) + sections.drivers.length + sections.tensions.length + sections.watch.length;
}

function placeOpen(reply, open, trimmed) {
  if (open.section === "identity" || open.section === "now") {
    if (reply[open.section] === undefined) reply[open.section] = trimmed;
  } else if (LIST_KEYS.includes(open.section)) {
    reply[open.section] = Array.isArray(reply[open.section]) ? reply[open.section].concat([trimmed]) : [trimmed];
  }
}

export function salvageReading(text, dossier, tags, opts = {}) {
  const raw = typeof text === "string" ? text : "";
  const refuse = (why, detail) => ({
    ok: false, sections: emptySections(), tags: [], refused: [{ section: "reply", why, ...(detail ? { detail } : {}) }], surviving: 0,
    salvaged: false, truncated: false, kept: 0, scanned: 0, guard: null, note: null,
  });
  if (raw.length > SECTION_CAPS.reply) return refuse("oversize", raw.length + " characters against " + SECTION_CAPS.reply);
  const part = parseReadingPartial(raw);
  if (part.value === null) return refuse("unparsable");
  if (!part.truncated) {
    const whole = vetReading(part.value, dossier, tags, opts);
    return { ...whole, salvaged: false, truncated: false, kept: keptCount(whole.sections), scanned: part.kept, guard: null, note: null };
  }
  const reply = { ...part.value };
  delete reply.unknown;
  let trimmed = false;
  if (opts.trim === true && part.open && part.open.cites && part.open.cites.length) {
    const index = readIndex(forReading(dossier));
    const t = trimToCites({ text: part.open.text, cites: part.open.cites }, index);
    if (t) { placeOpen(reply, part.open, { text: t.text, cites: t.cites }); trimmed = true; }
  }
  const verdict = vetReading(reply, dossier, tags, opts);
  const kept = keptCount(verdict.sections);
  const sections = verdict.ok ? { ...verdict.sections, unknown: unknownEntries(dossier) } : verdict.sections;
  return {
    ...verdict, sections, salvaged: true, truncated: true, trimmed, kept, scanned: part.kept,
    guard: verdict.ok ? "read:salvaged:" + kept : null, note: SALVAGE_NOTE,
  };
}
