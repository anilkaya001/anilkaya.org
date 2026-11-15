import { rowsOf } from "./flows-rows.js";
import { isoDay } from "./flows-cross.js";
import { instantOf } from "./flows-time.js";
import { sanitizeText, cleanLabel } from "./flows-dossier.js";
import { phaseOf, sessionFloor } from "./flows-er-calendar.js";

export const SCHEDULE_ROWS = 40;
export const POST_ROWS = 60;
export const POST_CAP = 280;
export const POST_SESSIONS = 4;

export const POLICY_TAGS = Object.freeze({
  trade: Object.freeze(["tariff", "tariffs", "trade deal", "import", "export"]),
  rates: Object.freeze(["fed", "interest rate", "rates", "powell", "inflation"]),
  energy: Object.freeze(["oil", "gas", "energy", "opec", "drilling"]),
  defense: Object.freeze(["military", "defense", "pentagon", "missile"]),
  crypto: Object.freeze(["bitcoin", "crypto"]),
  china: Object.freeze(["china", "chinese", "beijing"]),
  tax: Object.freeze(["tax", "taxes"]),
});

const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TAG_RES = Object.freeze(Object.entries(POLICY_TAGS).map(([code, words]) => [code, new RegExp("(?:^|[^a-z0-9])(?:" + words.map(escape).join("|") + ")(?![a-z0-9])", "i")]));

export function tagsOf(text) {
  if (typeof text !== "string") return [];
  return TAG_RES.filter(([, re]) => re.test(text)).map(([code]) => code);
}

const TYPE = /^[a-z][a-z _-]{0,30}$/;

export function scheduleRows(reads, sessionDate) {
  const seen = new Set();
  const out = [];
  for (const read of Array.isArray(reads) ? reads : []) {
    for (const r of rowsOf(read && read.body !== undefined ? read.body : read, "data")) {
      if (!r || typeof r !== "object") continue;
      const d = isoDay(typeof r.date === "string" ? r.date : "");
      if (!d) continue;
      const timeRaw = typeof r.time === "string" ? r.time : null;
      const ms = timeRaw === null ? null : instantOf(timeRaw);
      const at = ms === null ? null : new Date(ms).toISOString();
      const details = typeof r.details === "string" ? r.details : "";
      const key = d + "|" + (timeRaw || "") + "|" + details;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = typeof r.type === "string" ? r.type.trim().toLowerCase() : "";
      out.push({
        d, at,
        type: TYPE.test(t) ? t : null,
        text: details ? sanitizeText(details, { cap: 160 }).text : null,
        where: cleanLabel(r.location, 60),
        cov: cleanLabel(r.coverage, 40),
        phase: at ? phaseOf(at) : null,
      });
    }
  }
  const kept = out.filter((r) => r.d >= sessionDate);
  kept.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.at === b.at ? 0 : a.at === null ? 1 : b.at === null ? -1 : a.at < b.at ? -1 : 1));
  return { rows: kept.slice(0, SCHEDULE_ROWS), total: kept.length, dates: [...new Set(kept.map((r) => r.d))].sort() };
}

const CASHTAG = /\$([A-Z][A-Z0-9]{0,9})\b/g;

export function postRows(raw, sessionDate, universe) {
  const known = universe instanceof Set ? universe : new Set(Array.isArray(universe) ? universe : []);
  const floor = sessionFloor(sessionDate, POST_SESSIONS);
  const rows = rowsOf(raw, "data");
  const out = [];
  let dropped = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") { dropped++; continue; }
    const ts = r.timestamp;
    if (!Number.isSafeInteger(ts) || ts < 946684800000 || ts > 4102444800000) { dropped++; continue; }
    if (floor === null || ts < floor) continue;
    const san = typeof r.post === "string" ? sanitizeText(r.post, { cap: POST_CAP }) : { text: null };
    if (san.text === null) { dropped++; continue; }
    const at = new Date(ts).toISOString();
    const tickers = [];
    for (const m of (typeof r.post === "string" ? r.post : "").matchAll(CASHTAG)) {
      if (known.has(m[1]) && !tickers.includes(m[1])) tickers.push(m[1]);
      if (tickers.length >= 5) break;
    }
    out.push({ at, phase: phaseOf(at), text: san.text, tags: tagsOf(san.text), tickers, cut: san.flags.includes("capped") ? 1 : 0 });
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { rows: out.slice(0, POST_ROWS), total: out.length, dropped, from: floor === null ? null : new Date(floor).toISOString() };
}
