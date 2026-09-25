import { nyseHolidays } from "./flows-quant-time.js";

export function capBands({ min = 1e9, max = 4e12, ratio = 1.3 } = {}) {
  if (!(min > 0) || !(max > min) || !(ratio > 1)) return [];
  const bands = [];
  let lo = min;
  while (lo < max) {
    const hi = lo * ratio;
    bands.push([lo, hi >= max ? null : hi]);
    if (hi >= max) break;
    lo = hi;
  }
  return bands;
}

export const NDX_AS_OF = "2026-01-01";

export const NDX_100 = Object.freeze([
  "AAPL", "ABNB", "ADBE", "ADI", "ADP", "ADSK", "AEP", "AMAT", "AMD", "AMGN",
  "AMZN", "ANSS", "APP", "ARM", "ASML", "AVGO", "AXON", "AZN", "BIIB", "BKNG",
  "BKR", "CCEP", "CDNS", "CDW", "CEG", "CHTR", "CMCSA", "COST", "CPRT", "CRWD",
  "CSCO", "CSGP", "CSX", "CTAS", "CTSH", "DASH", "DDOG", "DXCM", "EA", "EXC",
  "FANG", "FAST", "FTNT", "GEHC", "GFS", "GILD", "GOOG", "GOOGL", "HON", "IDXX",
  "INTC", "INTU", "ISRG", "KDP", "KHC", "KLAC", "LIN", "LRCX", "LULU", "MAR",
  "MCHP", "MDB", "MDLZ", "MELI", "META", "MNST", "MRVL", "MSFT", "MSTR", "MU",
  "NFLX", "NVDA", "NXPI", "ODFL", "ON", "ORLY", "PANW", "PAYX", "PCAR", "PDD",
  "PEP", "PLTR", "PYPL", "QCOM", "REGN", "ROP", "ROST", "SBUX", "SNPS", "TEAM",
  "TMUS", "TSLA", "TTD", "TTWO", "TXN", "VRSK", "VRTX", "WBD", "WDAY", "XEL",
  "ZS",
]);

export const PICK_SIZE = "size";
export const PICK_INDEX = "index";

export function selectCoverage(universe, { count = 100, guaranteed = NDX_100 } = {}) {
  const rows = Array.isArray(universe) ? universe.filter((r) => r && r.ticker) : [];
  const capOf = (r) => {
    const v = Number(r.marketcap);
    return Number.isFinite(v) ? v : -1;
  };
  const bySize = [...rows].sort((a, b) =>
    capOf(b) - capOf(a) || String(a.ticker).localeCompare(String(b.ticker)));

  const picked = new Map();
  for (const row of bySize.slice(0, Math.max(0, count))) {
    picked.set(row.ticker, { row, why: PICK_SIZE });
  }
  const want = new Set(guaranteed || []);
  for (const row of bySize) {
    if (picked.has(row.ticker) || !want.has(row.ticker)) continue;
    picked.set(row.ticker, { row, why: PICK_INDEX });
  }
  return [...picked.values()];
}

export const SELECTION_EPOCH = "2026-08-26";

export const NDX_STALE_DAYS = 400;

export function ndxConstantAge(sessionDate, { asOf = NDX_AS_OF, staleDays = NDX_STALE_DAYS } = {}) {
  const a = Date.parse(String(asOf) + "T00:00:00Z");
  const b = Date.parse(String(sessionDate || "") + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { days: null, stale: false };
  const days = Math.round((b - a) / 86400000);
  return { days, stale: days > staleDays };
}

export const UNIVERSE_NOTES = Object.freeze({
  rule:
    "Every name in the screened universe whose market capitalisation puts it in " +
    "the largest hundred, plus any Nasdaq-100 member the screen returned. " +
    "Market cap is the selection axis because it is observable, stable, and " +
    "independent of the option flow being scored — selecting on the flow itself " +
    "would trim the cross-section to its own tails before the score is taken.",
  index:
    "Nasdaq-100 membership is read each night from the vendor's QQQ holdings " +
    "(/api/etfs/QQQ/holdings, the stock rows with a positive weight), dated by " +
    "the holdings' own update stamp. When that read fails or lists fewer than " +
    "ninety weighted stocks, the repository constant dated " + NDX_AS_OF + " is " +
    "used instead, together with whatever the read did return. Membership only " +
    "ADDS names, never removes them, so a stale list costs calls rather than " +
    "correctness.",
  epoch:
    "Boards published before " + SELECTION_EPOCH + " were drawn from a different pool " +
    "and their scores are not comparable with later ones. The record scorer " +
    "reports the two separately rather than averaging them.",
});

export const ROSTER_DEPTHS = Object.freeze(["board", "focus", "cross", "index", "fund"]);

export const ROSTER_KEY_KINDS = Object.freeze(["card", "card-x", "hist"]);

export const RETIRE_AFTER_SESSIONS = 3;

export const ROSTER_BUDGET_BYTES = 32 * 1024;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const ROSTER_KEY_RE = /^(card|card-x|hist):([A-Z][A-Z0-9.-]{0,9})$/;

export function rosterKeyTicker(key) {
  const m = ROSTER_KEY_RE.exec(String(key || ""));
  return m ? m[2] : null;
}

export function tradingSessionsBetween(from, to) {
  if (!DAY_RE.test(String(from || "")) || !DAY_RE.test(String(to || ""))) return null;
  if (to < from) return 0;
  let n = 0;
  let t = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  while (t < end) {
    t += 86400000;
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !nyseHolidays(d.getUTCFullYear()).has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

export function cardDepthOf(depth) {
  if (depth === "cross-section") return "cross";
  return ROSTER_DEPTHS.includes(depth) ? depth : null;
}

export function priorLedger(prior) {
  const known = new Map();
  if (!prior || typeof prior !== "object" || Array.isArray(prior)) return { known, complete: false };
  const day = DAY_RE.test(String(prior.sessionDate || "")) ? prior.sessionDate : null;
  const depth = prior.depth && typeof prior.depth === "object" ? prior.depth : {};
  const session = prior.session && typeof prior.session === "object" ? prior.session : {};
  for (const t of Object.keys(depth)) {
    const s = DAY_RE.test(String(session[t] || "")) ? session[t] : day;
    if (rosterKeyTicker("card:" + t)) known.set("card:" + t, s);
  }
  const x = prior.x && typeof prior.x === "object" ? prior.x : {};
  for (const kind of ["card-x", "hist"]) {
    for (const t of Array.isArray(x[kind]) ? x[kind] : []) {
      if (rosterKeyTicker(kind + ":" + t)) known.set(kind + ":" + t, day);
    }
  }
  const held = prior.held && typeof prior.held === "object" && !Array.isArray(prior.held) ? prior.held : null;
  for (const [key, s] of Object.entries(held || {})) {
    if (!rosterKeyTicker(key) || known.has(key)) continue;
    known.set(key, DAY_RE.test(String(s || "")) ? s : null);
  }
  return { known, complete: !!held && prior.v === 1 && prior.ledger !== "bootstrap-partial" && prior.ledger !== "dropped" };
}

export function retirePlan({ sessionDate, known = new Map(), landed = new Set(), exempt = new Set(),
  after = RETIRE_AFTER_SESSIONS } = {}) {
  const retire = [];
  const held = {};
  const kept = { exempt: 0, young: 0, undated: 0 };
  for (const [key, s] of known) {
    if (landed.has(key)) continue;
    const t = rosterKeyTicker(key);
    if (!t) continue;
    if (exempt.has(t)) { held[key] = s; kept.exempt++; continue; }
    const age = s ? tradingSessionsBetween(s, sessionDate) : null;
    if (age === null) { held[key] = s; kept.undated++; continue; }
    if (age > after) retire.push(key);
    else { held[key] = s; kept.young++; }
  }
  retire.sort();
  return { retire, held, kept };
}

export function buildRoster({ sessionDate, generatedAt = null, depth = new Map(), landed = new Set(), held = {},
  retired = [], ledger = null, budgetBytes = ROSTER_BUDGET_BYTES } = {}) {
  const depthOut = {};
  const sessionOut = {};
  for (const [t, d] of [...depth].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const kind = cardDepthOf(d);
    if (!kind || !landed.has("card:" + t)) continue;
    depthOut[t] = kind;
    sessionOut[t] = sessionDate;
  }
  const x = { "card-x": [], hist: [] };
  for (const key of [...landed].sort()) {
    const m = ROSTER_KEY_RE.exec(key);
    if (m && m[1] !== "card") x[m[1]].push(m[2]);
  }
  const heldOut = {};
  for (const k of Object.keys(held).sort()) heldOut[k] = held[k];
  const payload = {
    v: 1, sessionDate, generatedAt,
    depth: depthOut, session: sessionOut,
    x, held: heldOut,
    counts: Object.fromEntries(ROSTER_DEPTHS.map((d) => [d, Object.values(depthOut).filter((v) => v === d).length])),
    retired: retired.length,
    ledger: ledger || "carried",
    retireAfterSessions: RETIRE_AFTER_SESSIONS,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  return { payload, bytes, fits: bytes <= budgetBytes };
}
