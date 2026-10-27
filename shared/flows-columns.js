export const METHOD_VERSION = "flows-export-1";

export const MIN_WINDOWS = 3;

export const MAX_ROWS = 1000;

export const BAND_EDGES_CENTS = Object.freeze([100000000, 500000000, 2500000000, 10000000000]);

export const BAND_LABELS = Object.freeze(["<1M", "1M-5M", "5M-25M", "25M-100M", "100M+"]);

export const UNITS = Object.freeze(["id", "stamp", "version", "list", "fraction", "z", "sessions", "count", "band", "label", "flag", "score"]);

export const REASONS = Object.freeze({
  held_licence: "held pending licence review",
  held_event_dates: "held until event dates are cleared",
  no_windows: "no flagged windows",
  few_windows: "fewer than 3 flagged windows",
  no_sides: "no premium has a stated side",
  thin_sided: "sided premium under 250k USD",
  low_coverage: "sided premium under 40 percent of total",
  record_capped: "night record hit its cap",
  flow_missing: "flow record did not load",
  flow_session: "flow record is from another session",
  short_history: "under 200 sessions of history",
  zero_scale: "typical move is zero",
  no_change: "no day change",
  rd_pending: "report distance not published yet",
  sweep_partial: "sweep flag missing on some windows",
  floor_partial: "floor flag missing on some windows",
  no_board: "not on the board",
  board_session: "board score is from another session",
  no_chamber: "chamber not carried in the feed",
  no_pol_score: "no score is published for this feed",
  no_event_date: "no session count for the event",
});

export const REASON_GRAMMAR = /^[A-Za-z0-9 ]{1,48}$/;

export const LEAN_REASONS = Object.freeze({
  noPremium: "no_windows",
  noSides: "no_sides",
  lowCoverage: "low_coverage",
  smallClassified: "thin_sided",
});

export const HOLDS = Object.freeze({
  pair_day_change: Object.freeze({ reason: "held_licence", owner: "OQ1" }),
  event_date: Object.freeze({ reason: "held_event_dates", owner: "OQ2" }),
  disclosure_use: Object.freeze({ reason: "held_licence", owner: "OQ4" }),
});

export const PAGE_HOLDS = Object.freeze({ events: "event_date", political: "disclosure_use" });

export const FORBIDDEN_PAIRS = Object.freeze([Object.freeze(["sig", "move_z"])]);

const C = (page, key, label, unit, prov, source, more = {}) =>
  Object.freeze({ page, key, label, unit, prov, source, dp: null, minN: 0, hold: null, note: "", ...more });

const F = { dp: 4, minN: MIN_WINDOWS };

export const COLUMNS = Object.freeze([
  C("*", "asof_trt", "As of", "stamp", "own", "stamp of the oldest generatedAt among the page's sources that loaded"),
  C("*", "method_version", "Method version", "version", "own", "METHOD_VERSION"),
  C("*", "absent", "Absent values", "list", "own", "the builder"),
  C("*", "ticker", "Ticker", "id", "own", "the symbol that keys the row", { note: "public identifier" }),
  C("*", "rd", "Sessions to report", "sessions", "own", "universe.cols.rd", { dp: 0, hold: "event_date" }),
  C("*", "ask_share", "Ask share of sided premium", "fraction", "agg", "A over A plus B, from integer cents of the name's flagged windows", F),
  C("*", "ask_share_lo", "Ask share lower bound", "fraction", "agg", "A over T", F),
  C("*", "ask_share_hi", "Ask share upper bound", "fraction", "agg", "T less B, over T", F),
  C("*", "coverage", "Sided share of premium", "fraction", "agg", "A plus B, over T", F),
  C("*", "lean", "Lean", "label", "agg", "leanRead side of the pooled windows", { minN: MIN_WINDOWS }),
  C("moves", "sig", "Typical daily move", "fraction", "own", "universe.cols.sig over its scale", { dp: 5, hold: "pair_day_change" }),
  C("moves", "move_z", "Move in typical moves", "z", "own", "ln(1 + universe.cols.chg) over universe.cols.sig", { dp: 2 }),
  C("unusual", "windows_n", "Flagged windows", "count", "agg", "valid windows after the duplicate rule", { dp: 0, minN: 1 }),
  C("unusual", "premium_band", "Premium band", "band", "agg", "BAND_LABELS at BAND_EDGES_CENTS of the name's total premium", { minN: MIN_WINDOWS }),
  C("unusual", "negotiated_share", "Floor window share", "fraction", "agg", "premium of windows with floor true, over T", F),
  C("unusual", "sweep_share", "Sweep window share", "fraction", "agg", "premium of windows with sweep true, over T", F),
  C("unusual", "score", "Board score", "score", "own", "board:long or board:short rows[].s", { dp: 0 }),
  C("events", "event_type", "Event type", "label", "own", "constant earnings"),
  C("events", "sessions_until", "Sessions until event", "sessions", "own", "events.rows[].sdte", { dp: 0, hold: "event_date" }),
  C("events", "contamination", "Event inside horizon", "flag", "own", "contaminated() of the calendar adapter", { hold: "event_date" }),
  C("political", "transactions_n", "Disclosed transactions", "count", "agg", "buys plus sells of the assets feed row", { dp: 0, minN: 1 }),
  C("political", "buys_n", "Disclosed buys", "count", "agg", "assets.rows[].buys", { dp: 0, minN: 1 }),
  C("political", "sells_n", "Disclosed sells", "count", "agg", "assets.rows[].sells", { dp: 0, minN: 1 }),
  C("political", "net_n", "Buys minus sells", "count", "agg", "buys less sells", { dp: 0, minN: 1 }),
  C("political", "house_n", "House transactions", "count", "agg", "not carried by the feed", { dp: 0, minN: 1 }),
  C("political", "senate_n", "Senate transactions", "count", "agg", "not carried by the feed", { dp: 0, minN: 1 }),
  C("political", "score", "Political score", "score", "own", "not published by the feed"),
  ...["px", "chg", "mcap", "iv30p", "total_premium", "prem", "strike", "expiry", "span_start", "span_end", "event_date", "implied_move", "sector", "amount_lo", "amount_hi", "filer"]
    .map((k) => C("*", k, k, "label", "vendor", "a field of the vendor's row")),
]);

export const ALLOW = Object.freeze({
  moves: Object.freeze(["ticker", "sig", "move_z", "rd", "ask_share", "ask_share_lo", "ask_share_hi", "coverage", "lean"]),
  unusual: Object.freeze(["ticker", "windows_n", "premium_band", "ask_share", "ask_share_lo", "ask_share_hi", "coverage", "negotiated_share", "sweep_share", "score"]),
  events: Object.freeze(["ticker", "event_type", "sessions_until", "rd", "contamination"]),
  political: Object.freeze(["ticker", "transactions_n", "buys_n", "sells_n", "net_n", "house_n", "senate_n", "score"]),
});

export const ENVELOPE_HEAD = Object.freeze(["asof_trt", "method_version"]);

export const ENVELOPE_TAIL = Object.freeze(["absent"]);

export function pageHold(page, pageHolds = PAGE_HOLDS, holds = HOLDS) {
  const id = Object.hasOwn(pageHolds, page) ? pageHolds[page] : null;
  return id === null ? null : { id, ...holds[id] };
}

export function plan(page, { holds = HOLDS, pageHolds = PAGE_HOLDS, forbidden = FORBIDDEN_PAIRS } = {}) {
  const keys = Object.hasOwn(ALLOW, page) ? ALLOW[page] : null;
  if (keys === null) throw new Error("export: unknown page " + String(page));
  const hold = pageHold(page, pageHolds, holds);
  if (hold !== null) throw Object.assign(new Error("export: page held " + page), { code: "held", hold });
  const cols = [...ENVELOPE_HEAD, ...keys, ...ENVELOPE_TAIL].map((key) => {
    const hits = COLUMNS.filter((c) => c.key === key && (c.page === page || c.page === "*"));
    if (hits.length !== 1) throw new Error("export: unregistered or ambiguous " + page + "." + key);
    const col = hits[0];
    if (col.prov !== "own" && col.prov !== "agg") throw new Error("export: vendor column " + page + "." + key);
    if (col.prov === "agg" && !(col.minN >= 1)) throw new Error("export: agg without minN " + key);
    if (col.hold !== null && !Object.hasOwn(HOLDS, col.hold)) throw new Error("export: unknown hold " + key);
    return col;
  });
  const active = (c) => c.hold !== null && Object.hasOwn(holds, c.hold);
  const live = new Set(cols.filter((c) => !active(c)).map((c) => c.key));
  for (const [a, b] of forbidden) if (live.has(a) && live.has(b)) throw new Error("export: forbidden pair " + a + "+" + b);
  return cols.map((c) => ({ ...c, held: active(c) ? holds[c.hold] : null }));
}
