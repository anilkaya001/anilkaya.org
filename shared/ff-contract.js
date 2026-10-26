const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

export const FF_CONTRACT_VERSION = 1;
export const REGISTRY_VERSION = 1;
export const AST_VERSION = 1;
export const MIGRATION = "0026_ff.sql";

export const VOCABULARY = deepFreeze({
  product: "Fire & Forget",
  wire: "wire",
  wires: "wires",
  hit: "hit",
  hits: "hits",
  receipt: "receipt",
  house: "house wire",
  member: "your wire",
  note: "Your note",
});

export const COPY_BANNED = deepFreeze([
  "order", "orders", "tape", "bullish", "bearish", "buy", "sell", "forecast", "predict", "expect", "likely", "will", "should",
  "may", "might", "could", "would", "consider", "opportunity",
]);

export const LAYERS = deepFreeze(["house", "member"]);
export const CADENCES = deepFreeze(["nightly", "live"]);
export const CADENCES_RESERVED = deepFreeze(["rail"]);
export const EVALUATORS = deepFreeze(["nightly", "live"]);
export const SCOPE_KINDS = deepFreeze(["names", "sector", "universe"]);
export const SCOPE_KINDS_RESERVED = deepFreeze(["watchlist"]);
export const CONTROLS = deepFreeze(["fact", "bh"]);
export const CONTROLS_RESERVED = deepFreeze(["sr"]);
export const WIRE_STATUS = deepFreeze(["armed", "paused", "retired"]);
export const HIT_STATE = deepFreeze(["delivered", "held"]);
export const HIT_MARK = deepFreeze(["pinned", "dismissed"]);
export const HIT_FEEDBACK = deepFreeze(["useful", "noise"]);
export const RECEIPT_STATUS = deepFreeze(["evaluated", "not_evaluated"]);
export const CONFIRM_STATUS = deepFreeze(["confirmed", "not_confirmed", "unobservable"]);
export const RUN_STATUS = deepFreeze(["pending", "running", "done", "failed", "superseded"]);
export const SWITCH_STATE = deepFreeze(["on", "hold", "off"]);
export const SWITCH_SCOPES = deepFreeze(["evaluator", "template", "house", "wire", "member", "channel"]);
export const HOUSE_STREAM = "house";

export const HEALTH_STATES = deepFreeze(["live", "resting", "degraded", "down"]);
export const HEALTH_UNKNOWN = "unknown";
export const HEALTH = deepFreeze({
  live: { healthy: true, breathes: true },
  resting: { healthy: true, breathes: false },
  degraded: { healthy: false, breathes: false },
  down: { healthy: false, breathes: false },
  unknown: { healthy: null, breathes: false },
});
export const HEALTH_RULES = deepFreeze({
  liveCadenceS: 300,
  liveMaxAgeFactor: 2,
  degradedMaxAgeS: 900,
  nightlyDegradedLateSessions: 1,
  nightlyDownLateSessions: 2,
  pollS: 60,
  unreadCap: 99,
  precedence: ["unknown", "down", "degraded", "live", "resting"],
});
export const TIME = deepFreeze({
  zone: "TRT",
  offsetMin: 180,
  storedAs: "epoch milliseconds, UTC",
  sessionKey: "the New York trading date of the data evaluated, as YYYY-MM-DD",
  sessionLabels: ["pre-open", "open+<m>m", "open+<h>h<mm>m", "close", "post-close"],
  sessionLabelRe: "^(pre-open|open\\+\\d{1,2}m|open\\+\\d{1,2}h\\d{2}m|close|post-close)$",
  labelFrom: "data_as_of, never fired_at; latency is shown separately",
  nightlyDeadlineEt: "20:30",
  nightlyFinalEt: "09:30 of the next session",
  firstCheck: {
    nightly: "17:30 America/New_York after the next session close, labelled scheduled",
    live: "the next 5-minute Tier 1 tick or 15-minute Tier 2 loop, not before 09:35 America/New_York, labelled scheduled",
  },
  exportOffset: "+03:00",
});
export const UNITS = deepFreeze({
  usd: { step: 1000, xStep: 10000, h: { rel: 0.1, abs: 50000 }, display: "$1.24M", digits: 3, minus: "−" },
  contracts: { step: 1, xStep: 100, h: { rel: 0.1, abs: 100 }, display: "12,345", grouped: true },
  sigma: { step: 0.01, xStep: 0.25, h: { abs: 0.5 }, display: "3.10σ", decimals: 2 },
  vol_pt: { step: 0.1, xStep: 0.5, h: { abs: 0.5 }, display: "1.2 pts", decimals: 1 },
  pct: { step: 0.1, xStep: 0.5, h: { abs: 1 }, display: "4.5%", decimals: 1 },
  pctile: { step: 1, xStep: 5, h: { abs: 5 }, display: "87th", decimals: 0 },
  ratio: { step: 0.01, xStep: 0.05, h: { mul: 0.95 }, display: "0.85", decimals: 2 },
  sessions: { step: 1, xStep: 1, h: { abs: 0 }, display: "10 sessions", decimals: 0 },
  days: { step: 1, xStep: 1, h: { abs: 0 }, display: "21 days", decimals: 0 },
  bool: { step: 1, xStep: 1, h: { abs: 0 }, display: "yes", decimals: 0 },
});
export const ABSENT_MARK = "—";
export const ROUNDING = "half away from zero, on scaled integers; the quantized value is compared and is the value the evidence stores";

export const ABSENT_REASONS = deepFreeze([
  "stale", "missing", "thin", "warming", "out_of_range", "not_carded", "not_in_live_set", "record_truncated", "event_inside_window",
  "sector_coverage", "short_history", "unit_unverified",
]);
export const RECEIPT_REASONS = deepFreeze([
  "run_failed", "run_late", "source_stale", "source_missing", "record_truncated", "switch_off", "switch_hold", "metric_warming",
  "metric_hidden", "evaluator_error", "registry_conflict", "metrics_superseded", "registry_version", "no_looks",
]);

export const METRIC_ID_RE = "^(flow|vol|oi|px|contract|earn|sector|desk)\\.[a-z][a-z0-9_]{1,31}(\\.[0-9]{1,3}d)?(\\.(chg1d|z20|pct252|zvov|x0))?$";
export const METRIC_SUBJECTS = deepFreeze(["ticker", "window", "sector"]);
export const METRIC_STATUS = deepFreeze(["ready", "limited", "warming", "hidden"]);
export const SYMBOL_RE = "^[A-Z][A-Z0-9.-]{0,9}$";

const metric = (id, over) => ({
  id, unit: "ratio", subject: "ticker", kind: "fact", edge: "state", cadence: ["nightly"], source: { nightly: null, live: null },
  range: [-1e12, 1e12], maxAgeSessions: 0, maxAgeS: 1800, baseline: null, nullLaw: null, h: null, status: "ready", reason: null, unlock: null,
  history: null, label: id, ...over,
});
const hist = (path) => ({ key: "hist", path });
const cardX = (path) => ({ key: "card-x", path });
const universe = (path) => ({ key: "universe", path });
const strips = (path) => ({ key: "live:strips", path });
const windows = (key) => ({ key, path: "rows[]" });
const robust = (floorAbs, floorRel, zSpace = "linear") => ({ kind: "hist", window: 20, min: 15, zSpace, floor: { abs: floorAbs, rel: floorRel } });

export const METRICS = deepFreeze([
  metric("flow.net_premium", {
    unit: "usd", cadence: ["nightly", "live"], range: [-5e10, 5e10], label: "net premium",
    source: { nightly: hist("volume.np"), live: strips("rows[T].net") }, history: 252,
  }),
  metric("flow.net_premium.z20", {
    unit: "sigma", kind: "anomaly", edge: "event", range: [-50, 50], label: "net premium z", nullLaw: "t5", h: { abs: 0.5 },
    source: { nightly: hist("volume.np"), live: null }, baseline: robust(100000, 0), history: 252,
  }),
  metric("flow.volume.z20", {
    unit: "sigma", kind: "anomaly", edge: "event", range: [-50, 50], label: "option volume z", nullLaw: "t5", h: { abs: 0.5 },
    source: { nightly: hist("volume.vol"), live: null }, baseline: robust(500, 0.1), history: 252,
  }),
  metric("flow.pc_volume.z20", {
    unit: "sigma", kind: "anomaly", edge: "event", range: [-50, 50], label: "put to call volume z", nullLaw: "t5", h: { abs: 0.5 },
    source: { nightly: hist("volume.pc"), live: null }, baseline: robust(0.1, 0, "log"), history: 252,
    reason: "rebuilt from the stored volume and put to call volume ratio; unknown under 100 contracts on either side",
  }),
  metric("flow.put_premium", {
    unit: "usd", cadence: ["nightly", "live"], range: [0, 5e10], label: "put premium",
    source: { nightly: hist("volume.pp"), live: strips("rows[T].pp") }, status: "warming",
    reason: "the stored history has net premium only; the vendor options-volume row carries put_premium and the leg does not keep it",
    unlock: "hist gains cp and pp columns from the options-volume row, 252 sessions of backfill on the first run",
  }),
  metric("flow.put_premium.z20", {
    unit: "sigma", kind: "anomaly", edge: "event", range: [-50, 50], label: "put premium z", nullLaw: "t5", h: { abs: 0.5 },
    source: { nightly: hist("volume.pp"), live: null }, baseline: robust(100000, 0), status: "warming",
    reason: "no stored put premium history", unlock: "hist gains cp and pp columns from the options-volume row",
  }),
  metric("flow.pc_premium.z20", {
    unit: "sigma", kind: "anomaly", edge: "event", range: [-50, 50], label: "put to call premium z", nullLaw: "t5", h: { abs: 0.5 },
    source: { nightly: hist("volume.pp,volume.cp"), live: null }, baseline: robust(0.1, 0, "log"), status: "warming",
    reason: "no stored call or put premium history", unlock: "hist gains cp and pp columns from the options-volume row",
  }),
  metric("earn.sessions", {
    unit: "sessions", range: [0, 400], maxAgeSessions: 5, label: "sessions to the next report",
    source: { nightly: universe("ed"), live: null },
  }),
  metric("earn.confirmed", {
    unit: "bool", range: [0, 1], maxAgeSessions: 5, label: "report date confirmed",
    source: { nightly: cardX("earnings.next.confirmed"), live: null },
  }),
  metric("earn.clear_10", {
    unit: "bool", range: [0, 1], maxAgeSessions: 5, label: "no report within 10 sessions",
    source: { nightly: universe("ed"), live: null },
    reason: "1 when no report is due within 10 sessions or the name never reports; unknown for a company with no calendar date",
  }),
  metric("earn.implied_ratio", {
    unit: "ratio", range: [0, 20], label: "implied move over past report moves",
    source: { nightly: cardX("term.eventMove.meanAbs;earnings.events"), live: null }, history: 12,
    reason: "implied mean absolute move over the mean absolute 1d move of the last 8 reports; at least 6 reports or unknown",
  }),
  metric("vol.iv.30d.chg1d", {
    unit: "vol_pt", range: [-200, 200], label: "30-day implied volatility change",
    source: { nightly: universe("dIv1d"), live: null },
  }),
  metric("vol.iv.30d.zvov", {
    unit: "sigma", kind: "anomaly", edge: "event", range: [-50, 50], label: "30-day volatility change z", nullLaw: "t5", h: { abs: 0.5 },
    source: { nightly: cardX("ivDyn.volOfVol;universe.dIv1d"), live: null },
    baseline: { kind: "volOfVol", window: null, min: null, zSpace: "linear", floor: { abs: 0.005, rel: 0 } },
    reason: "the day's change over the volatility of daily changes, both in decimal volatility; carded names only",
  }),
  metric("vol.rr25.30d", {
    unit: "vol_pt", range: [-100, 100], label: "25-delta call minus put implied volatility",
    source: { nightly: { key: "card", path: "engine.facts[skew.rr25.30]" }, live: null }, status: "limited",
    reason: "carded and priced names only", history: 150,
  }),
  metric("vol.rr25.30d.x0", {
    unit: "bool", edge: "event", range: [0, 1], label: "call minus put implied volatility crossed above zero",
    source: { nightly: cardX("skew.series.rr25"), live: null }, status: "limited", history: 150,
    reason: "from the stored put minus call series with the sign inverted; carded names only, 0.5 vol point band",
  }),
  metric("contract.premium", {
    unit: "usd", subject: "window", edge: "event", cadence: ["live", "nightly"], range: [0, 5e10], label: "window premium",
    source: { nightly: windows("flowalerts"), live: windows("live:alerts") },
  }),
  metric("contract.dte", {
    unit: "days", subject: "window", edge: "event", cadence: ["live", "nightly"], range: [0, 1500], label: "days to expiry",
    source: { nightly: windows("flowalerts"), live: windows("live:alerts") },
  }),
  metric("contract.otm_pct", {
    unit: "pct", subject: "window", edge: "event", cadence: ["live", "nightly"], range: [-100, 1000], label: "distance out of the money",
    source: { nightly: windows("flowalerts"), live: windows("live:alerts") },
    reason: "positive means out of the money for calls and puts, from the strike and the underlying price at the window",
  }),
  metric("contract.vol_oi", {
    unit: "ratio", subject: "window", edge: "event", cadence: ["live", "nightly"], range: [0, 100000], label: "volume over open interest",
    source: { nightly: windows("flowalerts"), live: windows("live:alerts") },
  }),
  metric("contract.oi_confirm", {
    unit: "ratio", subject: "window", edge: "event", range: [0, 1], label: "open interest confirmed", status: "limited",
    source: { nightly: { key: "ff-carry", path: "windows[]; card:<T> panels.oiDeltas.rows" }, live: null },
    reason: "next-day open interest is held only inside each name's ten largest changes; absence is unobservable, never a refutation",
  }),
  metric("sector.net_premium.z20", {
    unit: "sigma", subject: "sector", kind: "anomaly", edge: "event", range: [-50, 50], label: "sector net premium z", nullLaw: "t5", h: { abs: 0.5 },
    source: { nightly: hist("volume.np;sum by sector"), live: null }, baseline: robust(1000000, 0), history: 252,
    reason: "the sum of net premium over the carded constituents of a sector, same constituent set each night, at least 10 constituents",
  }),
  metric("sector.breadth_pos", {
    unit: "ratio", subject: "sector", range: [0, 1], label: "share of constituents with positive net premium",
    source: { nightly: hist("volume.np;share above zero by sector"), live: null }, history: 252,
  }),
  metric("desk.yield_cc", {
    unit: "pct", range: [0, 1000], label: "annualised covered-call yield", status: "hidden", cadence: ["nightly"],
    source: { nightly: null, live: null }, reason: "the Premium Desk computes yield on demand from a chain read; nothing is stored per name",
    unlock: "a nightly stage that runs the Premium Desk's own functions over the chain already held for deep names",
  }),
  metric("desk.win_cc", {
    unit: "pct", range: [0, 100], label: "risk-neutral Win %", status: "hidden", cadence: ["nightly"],
    source: { nightly: null, live: null }, reason: "the Premium Desk computes Win % on demand from a chain read; nothing is stored per name",
    unlock: "a nightly stage that runs the Premium Desk's own functions over the chain already held for deep names",
  }),
  metric("oi.strike_share", {
    unit: "ratio", range: [0, 1], label: "open interest at one strike over front-month open interest", status: "hidden",
    source: { nightly: null, live: null }, reason: "per-strike open-interest contract counts are not stored; the gamma grid is a different quantity",
    unlock: "a nightly product with per-strike open interest for the front monthly expiry",
  }),
]);

export const METRIC_IDS = deepFreeze(METRICS.map((m) => m.id));
export const metricById = (id) => METRICS.find((m) => m.id === id) || null;

const clause = (m, op, x) => ({ m, op, x });
const COOLDOWN_DEFAULT = { live: 1, nightly: 5 };
const ast = (cadence, scope, all, persist = 1) => ({ v: AST_VERSION, cadence, scope, all, persist, cooldown: { unit: "session", n: COOLDOWN_DEFAULT[cadence] } });
const UNIVERSE = { kind: "universe" };

export const TEMPLATES = deepFreeze([
  {
    id: "T01", title: "Earnings run-up", cadence: "nightly", subject: "n", house: ["h-t01"], control: "bh",
    ast: ast("nightly", UNIVERSE, [clause("flow.net_premium.z20", ">=", 3), clause("earn.confirmed", "==", 1), clause("earn.sessions", "<=", 10), clause("earn.sessions", ">=", 1)]),
    note: "Live form removed: a cumulative intraday value against a full-day baseline is not a valid z.",
  },
  {
    id: "T02", title: "Opening confirmed", cadence: "nightly", subject: "c", house: ["h-t02"], control: "fact",
    ast: ast("nightly", UNIVERSE, [clause("contract.vol_oi", ">=", 5), clause("contract.premium", ">=", 500000), clause("contract.oi_confirm", ">=", 0.7)]),
    note: "Reads each name's ten largest open-interest changes; confirmation crosses two nights through ff-carry.",
  },
  {
    id: "T03", title: "Short-dated OTM aggression", cadence: "live", subject: "c", house: ["h-t03"], control: "fact", catchup: true,
    ast: ast("live", UNIVERSE, [clause("contract.dte", "<=", 21), clause("contract.otm_pct", ">=", 10), clause("contract.premium", ">=", 1000000), clause("contract.vol_oi", ">=", 3)]),
    note: "Vendor-flagged windows only. States facts and never says who traded.",
  },
  {
    id: "T04", title: "Hedge demand on my names", cadence: "nightly", subject: "n", house: ["h-t04"], control: "bh",
    ast: ast("nightly", UNIVERSE, [clause("flow.put_premium.z20", ">=", 2.5), clause("flow.pc_premium.z20", ">=", 2.5), clause("flow.put_premium", ">=", 2000000)]),
    note: "Waits for the put premium history column.",
  },
  {
    id: "T05", title: "Vol break without a catalyst", cadence: "nightly", subject: "n", house: ["h-t05"], control: "bh",
    ast: ast("nightly", UNIVERSE, [clause("vol.iv.30d.chg1d", ">=", 4), clause("vol.iv.30d.zvov", ">=", 2), clause("earn.clear_10", "==", 1)]),
    note: "Names with a report inside 10 sessions are excluded and listed.",
  },
  {
    id: "T06", title: "Upside skew flip", cadence: "nightly", subject: "n", house: ["h-t06"], control: "fact",
    ast: ast("nightly", UNIVERSE, [clause("vol.rr25.30d.x0", "==", 1)]),
    note: "Call minus put implied volatility crossed above zero from below; carded names only.",
  },
  {
    id: "T07", title: "Implied move vs history", cadence: "nightly", subject: "n", house: ["h-t07a", "h-t07b"], control: "fact",
    ast: ast("nightly", UNIVERSE, [clause("earn.implied_ratio", ">=", 1.5)]),
    variants: [
      { id: "h-t07a", sentence: "Implied move above past report moves", clauses: [clause("earn.implied_ratio", ">=", 1.5)] },
      { id: "h-t07b", sentence: "Implied move below past report moves", clauses: [clause("earn.implied_ratio", "<=", 0.7)] },
    ],
    note: "Two house wires because the grammar has no or; fewer than 6 past reports is unknown.",
  },
  {
    id: "T08", title: "Sector premium surge with breadth", cadence: "nightly", subject: "s", house: ["h-t08"], control: "bh",
    ast: ast("nightly", UNIVERSE, [clause("sector.net_premium.z20", ">=", 2), clause("sector.breadth_pos", ">=", 0.6)]),
    note: "Net premium is calls minus puts, summed over the carded constituents of the sector.",
  },
  { id: "T09", title: "Overwrite window", cadence: "nightly", subject: "n", house: [], control: "fact", ast: null, note: "Reserved; no second definition of yield or Win %." },
  { id: "T10", title: "Pin into expiry", cadence: "nightly", subject: "n", house: [], control: "fact", ast: null, note: "Reserved; no stored per-strike open interest." },
]);
export const TEMPLATE_IDS = deepFreeze(TEMPLATES.map((t) => t.id));
export const HOUSE_IDS = deepFreeze(TEMPLATES.flatMap((t) => t.house));
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;

export const OPS = deepFreeze([">=", "<=", "=="]);
export const AST_GRAMMAR = deepFreeze({
  body: ["v", "cadence", "scope", "all", "persist", "cooldown"],
  scope: {
    universe: ["kind"],
    sector: ["kind", "sector"],
    names: ["kind", "symbols"],
  },
  clause: ["m", "op", "x"],
  cooldown: ["unit", "n"],
  derived: ["rv", "control", "q", "clauses"],
  derivedClause: ["step", "h", "floor", "zSpace"],
  rejectedFromClient: ["control", "q", "h", "step", "floor", "zSpace", "rv", "template", "deliver"],
});

export const LIMITS = deepFreeze({
  clausesMin: 1,
  clausesMax: 8,
  clausesPerMetric: 2,
  symbolsMax: 25,
  persistNightly: [1, 3],
  persistLive: [1, 4],
  astBytes: 4096,
  sentenceChars: 280,
  titleChars: 80,
  noteChars: 500,
  armedMemberWires: 50,
  universeMemberWires: 5,
  liveMemberWires: 5,
  armedMemberWiresGlobal: 2000,
  versionsPerWirePerSession: 10,
  mutesPerMember: 500,
  hitsPerMemberWirePerSession: 25,
  hitsPerMemberPerSession: 200,
  hitsGlobalPerSession: 10000,
  evidenceBytes: 4096,
  groupInboxAfter: 3,
  budgetChoices: [1, 2, 5],
  budgetDefault: 2,
  cooldownUnit: "session",
  cooldownChoices: [1, 2, 5, 10, 20],
  cooldownDefault: COOLDOWN_DEFAULT,
  bhQ: 0.05,
  baselineWindow: 20,
  baselineMin: 15,
  madScale: 1.4826,
  minConstituents: 10,
  minPastReports: 6,
  maxPastReports: 8,
  thinContracts: 100,
});

export const EVIDENCE_REJECT_KEYS = deepFreeze(["px", "ref_px", "ret", "pnl", "price", "iv"]);
export const SCHEMA_BANNED_COLUMN_RE = "(^|_)(px|price|ret|pnl|iv)(_|$)";
export const EXPORT_COLUMNS = deepFreeze([
  "hit_id", "wire_id", "wire_version", "layer", "template", "symbol", "session", "session_label", "fired_at", "data_as_of", "evaluator",
  "sentence", "evidence_json",
]);

export const STALENESS = deepFreeze({
  nightlyMaxAgeSessions: 0,
  slowFieldMaxAgeSessions: 5,
  tier1S: 720,
  tier2S: 1800,
  liveSessionStartEt: "09:30",
  liveLastValidEt: "16:00",
});

export const PAYLOADS = deepFreeze({
  metrics: {
    key: "ff-metrics", maxBytes: 98304, writer: "scripts/flows-legs/ff-metrics.mjs", reader: "server/ff-eval.js",
    top: ["v", "sessionDate", "generatedAt", "registryVersion", "t", "cols", "n", "f", "why", "sectors", "windows"],
    cols: "metric id to an array aligned with t, integers at the metric's step, null where absent",
    n: "anomaly metric id to baseline session counts aligned with t",
    f: "anomaly metric id to 0 or 1, the floor was the scale",
    why: "metric id to reason to the list of indices in t",
  },
  carry: {
    key: "ff-carry", maxBytes: 98304, writer: "scripts/flows-legs/ff-carry.mjs", reader: "scripts/flows-legs/ff-metrics.mjs",
    top: ["v", "sessionDate", "generatedAt", "windows"],
    windows: "at most 180 flagged opening windows of the session, each with oc, t, size, oi, spanStart",
  },
  calibration: {
    key: "ff-calibration", maxBytes: 65536, writer: "scripts/flows-legs/ff-calibrate.mjs", reader: "server/ff-records.js",
    top: ["v", "generatedAt", "registryVersion", "wires"],
    wires: "house wire id and version to sessions replayed, expected and observed firings on shuffled sessions, placebo count",
  },
  registration: "owned by lane G together with the lane that writes the payload, because the registry suite requires the dry-run emit to write every registered key",
  readiness: "non-gating",
});

export const ROUTES = deepFreeze({
  family: "ff",
  memberFrom: "session",
  api: [
    { id: "ff-health", path: "/api/ff/health", methods: ["GET"], auth: "flows", note: "ETag; state, last evaluator times, unread counts" },
    { id: "ff-wires", path: "/api/ff/wires", methods: ["GET", "POST", "PATCH"], auth: "flows", note: "list or one by id; create; adjust or change status" },
    { id: "ff-house", path: "/api/ff/house", methods: ["GET", "POST"], auth: "flows", note: "house wires with records; follow or leave one" },
    { id: "ff-hits", path: "/api/ff/hits", methods: ["GET", "POST"], auth: "flows", note: "list or one by id; mark or give feedback" },
    { id: "ff-read", path: "/api/ff/read", methods: ["POST"], auth: "flows", note: "advance the two inbox cursors" },
    { id: "ff-preview", path: "/api/ff/preview", methods: ["POST"], auth: "flows", note: "would-hit now and coverage, never later prices" },
    { id: "ff-receipts", path: "/api/ff/receipts", methods: ["GET"], auth: "flows", note: "by wire, version or session" },
    { id: "ff-records", path: "/api/ff/records", methods: ["GET"], auth: "flows", note: "calibration, confirmation, latency, firings, coverage" },
    { id: "ff-symbol", path: "/api/ff/symbol", methods: ["GET"], auth: "flows", note: "own wires on one name, ?t=" },
    { id: "ff-digest", path: "/api/ff/digest", methods: ["GET"], auth: "flows", note: "?d=, computed when read, no model" },
    { id: "ff-export", path: "/api/ff/export", methods: ["GET"], auth: "flows", note: "CSV of hits with timestamps, ?from=&to=" },
    { id: "ff-mute", path: "/api/ff/mute", methods: ["POST"], auth: "flows", note: "mute or unmute a name" },
    { id: "ff-note", path: "/api/ff/note", methods: ["PUT", "DELETE"], auth: "flows", note: "Your note on a wire, never exported" },
    { id: "ff-run", path: "/api/ff/run", methods: ["POST"], auth: "none", note: "bearer only, same tokens as ingest; internal" },
  ],
  pages: [
    { id: "ff-fire", path: "/flows/fire/", bare: "/flows/fire", page: "fire", lane: "D" },
    { id: "ff-inbox", path: "/flows/inbox/", bare: "/flows/inbox", page: "inbox", lane: "E", deepLink: "?hit=<hit_id>" },
    { id: "ff-digest-page", path: "/flows/digest/", bare: "/flows/digest", page: "digest", lane: "E" },
    { id: "ff-wires-page", path: "/flows/wires/", bare: "/flows/wires", page: "wires", lane: "E", deepLink: "?wire=<wire_id>" },
  ],
  pageRule: "a page is canonical with its trailing slash like every Flows page; the bare form is a 308 row to it; both are GET and HEAD with auth none and the sign-in page for an anonymous reader",
  note: "The router matches exact paths, so ids travel in the query or the body and no path carries a parameter.",
});

export const ERROR_CODES = deepFreeze({
  ff_off: [404, "Fire & Forget is off"],
  ff_wire_not_found: [404, "No such wire"],
  ff_hit_not_found: [404, "No such hit"],
  ff_wire_limit: [409, "The wire limit is reached; retire a wire first"],
  ff_symbol_outside_universe: [422, "That name is not in the universe, so no wire can watch it"],
  ff_grammar_invalid: [400, "The wire is not valid"],
  ff_grammar_precision: [400, "A threshold is finer than the metric allows"],
  ff_metric_unavailable: [409, "That quantity is not available yet"],
  ff_version_immutable: [409, "An armed version cannot be changed; adjust the wire to make a new version"],
  ff_house_readonly: [403, "A house wire cannot be edited"],
  ff_house_duplicate: [409, "This is the house wire. Adjust it or turn the house wire off."],
  ff_scope_reserved: [400, "That scope is not available"],
  ff_note_too_long: [400, "The note is too long"],
  ff_cursor_invalid: [400, "The cursor is not valid"],
  ff_evaluator_unavailable: [503, "The evaluator is not available"],
  ff_export_range: [400, "Choose a shorter date range"],
  ff_budget_exceeded: [409, "The weekly false-alarm budget is spent; loosen or retire a wire"],
});

export const HOOKS = deepFreeze({
  attributes: ["data-ff-page", "data-ff-hit", "data-ff-wire", "data-ff-state", "data-ff-absent", "data-ff-slot"],
  pages: ["fire", "inbox", "digest", "wires"],
  slots: ["mark", "name-panel", "history", "record"],
  slotOwners: { mark: "G inserts, F fills", "name-panel": "G inserts, E fills", history: "D reserves, phase 2 fills", record: "E reserves, phase 2 fills" },
  states: ["live", "resting", "degraded", "down", "unknown"],
  classPrefix: "ffx-",
  existingClasses: [".ff-brand", ".ff-word"],
  events: {
    "ff:unread": { detail: ["house", "member", "total"], source: "F" },
    "ff:health": { detail: ["state", "evaluator"], source: "F" },
    "ff:read": { detail: ["stream", "seq"], source: "E" },
  },
  poller: "F",
  pollS: 60,
  flowsUiProperties: ["ffKernel", "ffClient", "ffMark", "ffFire", "ffInbox", "ffWires", "ffDigest", "ffNamePanel"],
  tokens: [
    "--ff-live", "--ff-resting", "--ff-degraded", "--ff-down", "--ff-unknown", "--ff-hit", "--ff-absent", "--ff-ink", "--ff-ink-dim",
    "--ff-rule", "--ff-surface",
  ],
  tokensFile: "assets/css/flows-ff-tokens.css",
  breathes: { cycleS: 4.2, easing: "ease-in-out", only: "live", reducedMotion: "never" },
  viewports: [[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [1024, 660], [390, 844], [390, 664]],
});

export const SWITCHES = deepFreeze({
  master: { var: "FF_MODE", on: "on", shadow: "shadow", otherwise: "off" },
  routes: ["FF_ROUTE_WIRES", "FF_ROUTE_INBOX", "FF_ROUTE_FIRE", "FF_ROUTE_EXPORT"],
  routeRule: "on, anything else off",
  precedence: "FF_MODE first, then the most restrictive matching ff_switches row (off over hold over on); no row means on",
  unreadable: "evaluation is off and past hits stay readable",
  off: "not evaluated; receipt reason switch_off",
  hold: "evaluated; hits stored as held, counted in the record, never delivered when the hold is lifted",
  shadow: "evaluated; every hit stored as held, nothing delivered",
});

export const BUDGET = deepFreeze({
  note: "rows per weekday are declared in tests/lib/d1-budget-ff.mjs and summed by tests/flows-d1-budget.mjs",
  nightlyEvaluationDeadlineEt: "20:30",
  runLeaseMs: 120000,
  runAttemptsMax: 6,
  runRetention: 14,
  archive: { table: "ff_arch", switch: "channel:archive", rowsPerSession: 28, bytesPerRowMax: 131072 },
  worstHitBytesPerSession: 40960000,
});

export const DIGEST_QUADRANTS = deepFreeze(["house-nightly", "house-live", "yours-nightly", "yours-live"]);

export const RECORD = deepFreeze({
  fields: ["firings", "sessions", "budget", "placebo", "placebo_n", "confirmation", "confirm_n", "lat_p50_s", "lat_p95_s", "coverage"],
  periods: "YYYY-Www of the New York session date, or all",
  priceScoring: false,
  nullIsDash: true,
  zeroFiringsIsZero: true,
});

export const ID_RULES = deepFreeze({
  base32: "abcdefghijklmnopqrstuvwxyz234567",
  hitIdLength: 20,
  clauseHashLength: 10,
  memberWire: "w-<16 random lowercase base32 characters>",
  houseWire: "h-t<nn>[<letter>], permanent, never reused",
  subject: ["n:<SYMBOL>", "c:<SYMBOL>:<OCC>", "s:<SECTOR>", "u"],
  dedupeKey: "<subject>:<session>[:<clause_hash> member wires only][:r<1-999> operator rerun only]",
  hitId: "base32 lowercase of sha256 over utf-8 of wire_id + '|' + dedupe_key, first 20 characters",
  clauseHash: "first 10 hex of sha256 over the canonical JSON of the clauses sorted by their canonical strings",
  astHash: "sha256 hex over the canonical JSON of the stored body including the derived block",
  evaluatorInKey: false,
  oneHitPerKeyPerSession: true,
  versionsPerWirePerSession: 10,
});

export const ROBUST = deepFreeze({
  formula: "z = (x - median20) / max(1.4826 * MAD20, floor)",
  floor: "max(abs, rel * abs(median20)), in log units when zSpace is log",
  baselineExcludesCurrentSession: true,
  minimumSessions: 15,
  nullDistribution: "student t with 5 degrees of freedom",
  pValue: "upper tail for >=, lower tail for <=; max over the anomaly clauses of a wire",
  family: "scope and names with valid anomaly inputs; hit only if rejected by BH at q, every anomaly threshold passes, every fact clause is true",
});

export const EDGE = deepFreeze({
  state: "needs an observed FALSE before the TRUE, so a new wire or version never fires on its first look",
  event: "fires whenever TRUE and not already firing",
  entry: "all clauses TRUE for persist consecutive looks, none of them inside the quiet period",
  exit: "any clause FALSE at its threshold relaxed by h",
  cooldown: "after a hit the wire and subject are quiet for n sessions on the XNYS calendar, the hit's own session the first, so 1 is the rest of the session; looks in the quiet period are read, the exit rule runs, nothing counts towards persistence and no hit is written",
  rearm: "the exit has been observed and the quiet period has ended",
  unknown: "freezes the count and the phase",
});

export const LANES = deepFreeze({
  A: {
    name: "core",
    files: ["shared/ff-grammar.js", "shared/ff-stats.js", "shared/ff-engine.js", "shared/ff-sentence.js", "shared/ff-session.js", "shared/ff-ids.js", "shared/ff-house.js"],
    prefix: "ff-a-",
    order: 1,
  },
  B: {
    name: "store and API",
    files: [
      "server/ff-store.js", "server/ff-eval.js", "server/ff-health.js", "server/ff-preview.js", "server/ff-records.js", "server/ff-digest.js",
      "server/ff-export.js", "server/routes/flows-ff.js", "tests/lib/d1-budget-ff.mjs",
    ],
    prefix: "ff-b-",
    order: 2,
  },
  C: {
    name: "legs",
    files: [
      "scripts/flows-legs/ff-metrics.mjs", "scripts/flows-legs/ff-carry.mjs", "scripts/flows-legs/ff-calibrate.mjs",
      "scripts/flows-nightly/sections/ff.mjs", ".github/workflows/flows-ff-calibrate.yml",
    ],
    prefix: "ff-c-",
    order: 2,
  },
  U: {
    name: "ui kernel",
    files: ["assets/css/flows-ff-tokens.css", "assets/js/flows-ff-kernel.js", "assets/js/flows-ff-client.js"],
    prefix: "ff-u-",
    order: 1,
  },
  D: {
    name: "fire page",
    files: ["assets/js/flows-ff-fire.js", "assets/js/flows-ff-composer.js", "assets/js/flows-ff-preview.js", "assets/css/flows-ff-fire.css", "shared/ff-pages-fire.js"],
    prefix: "ff-d-",
    order: 2,
  },
  E: {
    name: "inbox, digest, wires and name panel",
    files: [
      "assets/js/flows-ff-inbox.js", "assets/js/flows-ff-evidence.js", "assets/js/flows-ff-digest.js", "assets/js/flows-ff-wires.js",
      "assets/js/flows-ff-name-panel.js", "assets/css/flows-ff-inbox.css", "shared/ff-pages-inbox.js",
    ],
    prefix: "ff-e-",
    order: 2,
  },
  F: {
    name: "mark",
    files: ["assets/js/flows-ff-mark.js", "assets/css/flows-ff-mark.css"],
    prefix: "ff-f-",
    order: 2,
  },
  H: {
    name: "acceptance",
    files: [],
    prefix: "ff-accept-",
    order: 2,
  },
});

export const PHASE0_FILES = deepFreeze([
  "shared/ff-contract.js", "shared/ff-schema.js", "migrations/0026_ff.sql", "docs/ff/contract.md", "docs/ff/inventory.md",
  "tests/ff-contract.mjs", "tests/suites/ff-contract.json", "tests/fixtures-ff-contract.json",
]);

export const TEST_ARTIFACTS = deepFreeze([
  "tests/ff-<p>*.mjs", "tests/lib/ff-<p>*.mjs", "tests/fixtures-ff-<p>*.json", "tests/suites/ff-<p>*.json", "docs/ff/<l>-*.md",
]);

export const SHARED_EDITS = deepFreeze({
  owner: "G",
  files: [
    "worker.js", "server/router.js", "server/errors.js", "shared/flows-pages.js", "server/routes/flows-pages.js", "shared/flows-products.js",
    "server/store.js", "shared/flows-ready.js", "scripts/flows-pipeline.mjs", "scripts/flows-nightly/stages.mjs", "scripts/flows-legs/flow.mjs",
    "shared/flows-positioning.js", "wrangler.toml", "wrangler.staging.toml", "assets/js/nav.js", "assets/css/flows.css", "assets/version.txt",
    "tests/lib/d1-budget.mjs", "tests/flows-weight.mjs", "tests/fixtures-pipeline-golden.json", "tests/flows-registry-contract.mjs", "DEPLOY.md",
  ],
  regenerated: ["AGENTS.md", "docs/index.md"],
  assetTrain: "any assets/css, assets/js or assets/data change bumps assets/version.txt; the integrator merges client lanes as a train and runs bump-assets once",
});

export const FORBIDDEN = deepFreeze({
  imports: [
    "shared/flows-vendor-core.js", "shared/flows-vendor-ops.js", "shared/flows-vendor-extras.js", "shared/flows-dossier-vendor.js",
    "shared/flows-dossier-worker.js", "shared/flows-ai.js", "shared/flows-ai-broker.js", "server/ai.js", "scripts/flows-nightly/vendor.mjs",
  ],
  sourceTokens: ["uwFetch", "askModels", "cappedAi", "env.AI"],
  fetchAllowedIn: ["scripts/flows-legs/ff-metrics.mjs", "scripts/flows-legs/ff-carry.mjs", "scripts/flows-legs/ff-calibrate.mjs"],
  rule: "evaluation never calls the vendor and reads only what the pipeline already holds",
});

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: numbers are finite");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  throw new TypeError("canonicalJson: unsupported " + typeof value);
}

export function clauseCanon(clauses) {
  return "[" + clauses.map(canonicalJson).sort().join(",") + "]";
}

export function base32Lower(bytes) {
  const alphabet = ID_RULES.base32;
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

const SEGMENT_BAD = /[:|]/;

export function subjectKey(kind, symbol = null, occ = null, sector = null) {
  const parts = kind === "n" ? [symbol] : kind === "c" ? [symbol, occ] : kind === "s" ? [sector] : [];
  if (parts.some((p) => typeof p !== "string" || p === "" || SEGMENT_BAD.test(p))) throw new TypeError("subjectKey: a segment is empty or holds : or |");
  if (kind === "u") return "u";
  if (kind === "n" || kind === "c" || kind === "s") return kind + ":" + parts.join(":");
  throw new TypeError("subjectKey: unknown kind");
}

export function dedupeKey({ layer, subject, session, clauseHash = null, revision = 0 }) {
  if (!LAYERS.includes(layer)) throw new TypeError("dedupeKey: unknown layer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) throw new TypeError("dedupeKey: session is YYYY-MM-DD");
  let key = subject + ":" + session;
  if (layer === "member") {
    if (typeof clauseHash !== "string" || !/^[0-9a-f]{10}$/.test(clauseHash)) throw new TypeError("dedupeKey: a member key carries a clause hash");
    key += ":" + clauseHash;
  } else if (clauseHash !== null) throw new TypeError("dedupeKey: a house key carries no clause hash");
  if (revision !== 0) {
    if (!Number.isInteger(revision) || revision < 1 || revision > 999) throw new TypeError("dedupeKey: revision is 1 to 999");
    key += ":r" + revision;
  }
  return key;
}

export const hitIdInput = (wireId, key) => wireId + "|" + key;

export function absentLine(reason, detail = "") {
  if (!ABSENT_REASONS.includes(reason) && !RECEIPT_REASONS.includes(reason)) throw new TypeError("absentLine: unknown reason");
  return ABSENT_MARK + " " + reason + (detail ? ": " + detail : "");
}

export function sessionLabelText(clock, label) {
  return clock + " " + TIME.zone + " · " + label;
}
