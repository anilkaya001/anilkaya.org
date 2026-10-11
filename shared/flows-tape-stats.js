export const TIERS = Object.freeze(["A", "a", "m", "b", "B", "n"]);

export const SIDE_TAGS = Object.freeze(["ask_side", "bid_side", "mid_side", "no_side"]);

export const TIER_TAGS = Object.freeze({
  A: "ask_side", a: "ask_side", m: "mid_side", b: "bid_side", B: "bid_side", n: "no_side",
});

export const SIDE_WORDS = Object.freeze({
  A: "at or above the ask",
  a: "above the midpoint, below the ask",
  m: "at the midpoint",
  b: "below the midpoint, above the bid",
  B: "at or below the bid",
  n: "no usable quote",
});

export const FLAGS = Object.freeze({
  sweep: 1,
  multiLeg: 2,
  extended: 4,
  canceled: 8,
  excluded: 16,
  large: 32,
});

export const SWEEP_REPORT_FLAG = "intermarket_sweep";

export const SWEEP_UPSTREAM_CODE = "isoi";

export const MULTI_LEG_CODES = Object.freeze([
  "mlet", "mlat", "mlct", "mlft", "mesl", "masl", "mfsl", "tlet", "tlct", "tlft", "tesl", "tasl", "tfsl", "tlat",
]);

export const EXTENDED_REPORT_FLAG = "extended_hours";

export const EXTENDED_UPSTREAM_CODE = "exht";

export const EXCLUDED_TAGS = Object.freeze(["dividend", "arbitrage"]);

export const LARGE_PRINT_MULTIPLE = 10;

export const ASK_SHARE_RULE = Object.freeze({ askAt: 0.65, bidAt: 0.35, classifiedMin: 0.5 });

export const WINDOWS_S = Object.freeze([60, 300, 900]);

export const MULTIPLIER = 100;

const EPS = 1e-9;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const words = (v) => {
  if (Array.isArray(v)) return v.flatMap(words);
  if (typeof v !== "string") return [];
  return v.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
};

export function tierOf(price, bid, ask) {
  const p = num(price);
  const b = num(bid);
  const a = num(ask);
  if (p === null || b === null || a === null || p <= 0 || b < 0 || a <= 0 || a < b) return "n";
  const mid = (a + b) / 2;
  if (Math.abs(p - mid) <= EPS) return "m";
  if (p >= a) return "A";
  if (p <= b) return "B";
  return p > mid ? "a" : "b";
}

export function sideTagOf(tags) {
  const seen = words(tags).filter((t) => SIDE_TAGS.includes(t));
  const set = [...new Set(seen)];
  return set.length === 1 ? set[0] : null;
}

export function upstreamCodes(print) {
  if (!isObj(print)) return [];
  return [...new Set([...words(print.upstream_condition_detail), ...words(print.trade_code)])];
}

export function sweepOf(print) {
  if (!isObj(print)) return { sweep: false, reportFlag: false, upstreamCode: false };
  const reportFlag = words(print.report_flags).includes(SWEEP_REPORT_FLAG);
  const upstreamCode = upstreamCodes(print).includes(SWEEP_UPSTREAM_CODE);
  return { sweep: reportFlag || upstreamCode, reportFlag, upstreamCode };
}

export const flagNames = (mask) => Object.entries(FLAGS).filter(([, bit]) => (mask & bit) !== 0).map(([name]) => name);

export const hasFlag = (mask, name) => (mask & FLAGS[name]) !== 0;

export function largeAt(floor) {
  const f = num(floor);
  return f !== null && f > 0 ? f * LARGE_PRINT_MULTIPLE : null;
}

export function largeLabel(floor) {
  const at = largeAt(floor);
  return at === null ? null : `premium at least ${LARGE_PRINT_MULTIPLE} times the tape's floor of $${Math.round(num(floor)).toLocaleString("en-US")}`;
}

const sideOfTier = (tier) => (tier === "A" || tier === "a" ? 1 : tier === "b" || tier === "B" ? -1 : 0);

const sideOfTag = (tag) => (tag === "ask_side" ? 1 : tag === "bid_side" ? -1 : 0);

export function parityOf(tag, tier) {
  if (tag === null || tag === "no_side" || tier === "n") return "unchecked";
  return TIER_TAGS[tier] === tag ? "agree" : "disagree";
}

export function classifyPrint(print, { floor = null } = {}) {
  const p = isObj(print) ? print : {};
  const price = num(p.price);
  const bid = num(p.nbbo_bid);
  const ask = num(p.nbbo_ask);
  const size = num(p.size);
  const premium = num(p.premium);
  const tier = tierOf(price, bid, ask);
  const tag = sideTagOf(p.tags);
  const parity = parityOf(tag, tier);
  const sw = sweepOf(p);
  const codes = upstreamCodes(p);
  const tagWords = words(p.tags);
  let mask = 0;
  if (sw.sweep) mask |= FLAGS.sweep;
  if (p.is_multi_leg === true || codes.some((c) => MULTI_LEG_CODES.includes(c))) mask |= FLAGS.multiLeg;
  if (words(p.report_flags).includes(EXTENDED_REPORT_FLAG) || codes.includes(EXTENDED_UPSTREAM_CODE)) mask |= FLAGS.extended;
  if (p.canceled === true) mask |= FLAGS.canceled;
  if (tagWords.some((t) => EXCLUDED_TAGS.includes(t))) mask |= FLAGS.excluded;
  const largeFrom = largeAt(floor);
  if (largeFrom !== null && premium !== null && premium >= largeFrom) mask |= FLAGS.large;
  let side = tag !== null ? sideOfTag(tag) : sideOfTier(tier);
  let basis = tag !== null ? "tag" : tier === "n" ? "none" : "tier";
  if (parity === "disagree") { side = 0; basis = "conflict"; }
  const dropped = (mask & (FLAGS.multiLeg | FLAGS.excluded | FLAGS.canceled)) !== 0;
  if (dropped) side = 0;
  return {
    id: typeof p.id === "string" || typeof p.id === "number" ? p.id : null,
    side,
    tier,
    tag,
    parity,
    basis,
    flags: mask,
    right: p.option_type === "call" ? "c" : p.option_type === "put" ? "p" : null,
    size,
    price,
    premium,
    signed: !dropped && side !== 0 && premium !== null,
    at: timeOf(p.executed_at),
    sweepVia: sw.reportFlag && sw.upstreamCode ? "both" : sw.reportFlag ? "report_flags" : sw.upstreamCode ? "upstream_code" : null,
  };
}

function timeOf(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v.includes("T") ? v : v.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

const blank = () => ({
  n: 0, undated: 0, unpriced: 0, canceled: 0, gross: 0, askPrem: 0, bidPrem: 0, otherPrem: 0,
  callSigned: 0, putSigned: 0, sweeps: 0, large: 0, multiLeg: 0, excluded: 0, extended: 0, conflicts: 0,
});

export function aggregate(prints, { now, windowsS = WINDOWS_S, floor = null } = {}) {
  const rows = (Array.isArray(prints) ? prints : []).map((p) => classifyPrint(p, { floor }));
  const out = {};
  for (const w of windowsS) {
    const acc = blank();
    for (const r of rows) {
      if (r.at === null || !Number.isFinite(now)) { acc.undated += 1; continue; }
      if (r.at > now || r.at <= now - w * 1000) continue;
      if ((r.flags & FLAGS.canceled) !== 0) { acc.canceled += 1; continue; }
      acc.n += 1;
      if (r.parity === "disagree") acc.conflicts += 1;
      if ((r.flags & FLAGS.sweep) !== 0) acc.sweeps += 1;
      if ((r.flags & FLAGS.large) !== 0) acc.large += 1;
      if ((r.flags & FLAGS.multiLeg) !== 0) acc.multiLeg += 1;
      if ((r.flags & FLAGS.excluded) !== 0) acc.excluded += 1;
      if ((r.flags & FLAGS.extended) !== 0) acc.extended += 1;
      if (r.premium === null) { acc.unpriced += 1; continue; }
      acc.gross += r.premium;
      if (r.signed && r.side > 0) acc.askPrem += r.premium;
      else if (r.signed && r.side < 0) acc.bidPrem += r.premium;
      else acc.otherPrem += r.premium;
      if (r.signed) {
        if (r.right === "c") acc.callSigned += r.side * r.premium;
        else if (r.right === "p") acc.putSigned += r.side * r.premium;
      }
    }
    out[w] = {
      ...acc,
      unclassifiedShare: acc.gross > 0 ? acc.otherPrem / acc.gross : null,
      ...askShareRead({ askPrem: acc.askPrem, bidPrem: acc.bidPrem, prem: acc.gross }),
    };
  }
  return out;
}

export function reconciles(window) {
  return Math.abs(window.askPrem + window.bidPrem + window.otherPrem - window.gross) <= EPS * Math.max(1, Math.abs(window.gross));
}

export function askShare({ askPrem, bidPrem, prem } = {}) {
  const a = num(askPrem);
  const b = num(bidPrem);
  const total = num(prem);
  if (a === null || b === null || a < 0 || b < 0) return { share: null, classified: null };
  const sided = a + b;
  const share = sided > 0 ? a / sided : null;
  const classified = total !== null && total > 0 ? sided / total : null;
  return { share, classified };
}

export function askShareRead(row) {
  const { share, classified } = askShare(row);
  let lean = null;
  if (share !== null && classified !== null && classified >= ASK_SHARE_RULE.classifiedMin) {
    if (share >= ASK_SHARE_RULE.askAt) lean = "ask";
    else if (share <= ASK_SHARE_RULE.bidAt) lean = "bid";
  }
  return { share, classified, lean };
}
