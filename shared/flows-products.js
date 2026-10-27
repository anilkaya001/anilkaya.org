import { LIVE_KEYS } from "./flows-live.js";

export const REGISTRY_VERSION = 1;

export const PAYLOAD_CAP_BYTES = 128 * 1024;

export const TICKER_GRAMMAR = /^[A-Z][A-Z0-9.-]{0,9}$/;

export const DAY_GRAMMAR = /^\d{4}-\d{2}-\d{2}$/;

export const SYNTHETIC_GRAMMAR = /^SYN\d{3}$/;

export const STATE = Object.freeze({ ok: 0, quiet: 1, failed: 2, unfetched: 3, stale: 4, pending: 5 });

export const STATE_NAMES = Object.freeze(["ok", "quiet", "failed", "unfetched", "stale", "pending"]);

export const DEPTHS = Object.freeze(["board", "focus", "deep", "cross", "index", "fund", "screen"]);

export const CARD_DEPTHS = Object.freeze(["board", "focus", "deepened", "cross-section", "breadth", "index", "fund"]);

export const DEPTH_OF_CARD = Object.freeze({ board: "board", focus: "focus", deepened: "deep", "cross-section": "cross", breadth: "cross", index: "index", fund: "fund" });

export const VOLATILE = Object.freeze(["generatedAt", "readAt", "screenerReadAt", "refreshedAt", "producer"]);

export const TARGET_BY_MIN = 150;

export const DUE_BY_MIN = 300;

const frozen = (o) => Object.freeze(o);

const product = (id, family, over) => frozen({
  id, family, key: null, pattern: null, level: "L2", exec: "actions", klass: "nightly", epoch: 1,
  capBytes: PAYLOAD_CAP_BYTES, volatile: VOLATILE, targetByMin: TARGET_BY_MIN, dueByMin: DUE_BY_MIN, required: frozen([]), ...over,
});

const global = (key, over = {}) => product(key, "global", { key, ...over });

const GLOBALS = [
  global("universe", { level: "L0", capBytes: 124 * 1024, required: ["n", "t", "cols", "units"] }),
  global("roster", { level: "L0", required: ["depth", "session", "sessionDate"] }),
  global("meta", { level: "L0", required: ["sessionDate", "stages"] }),
  global("board:long", { required: ["rows", "sessionDate", "side"] }),
  global("board:short", { required: ["rows", "sessionDate", "side"] }),
  global("board:watch", { required: ["rows", "sessionDate"] }),
  global("regime"),
  global("events", { capBytes: 120 * 1024 }),
  global("market"),
  global("movers"),
  global("record"),
  global("scoretrack"),
  global("calib"),
  global("dispersion"),
  global("voldesk", { capBytes: 64 * 1024, dueByMin: 120, volatile: frozen(["generatedAt"]), required: ["v", "session", "term"] }),
  global("voldesk-stance", { capBytes: 96 * 1024, dueByMin: 120, volatile: frozen(["generatedAt"]), required: ["v", "ring"] }),
  global("flowalerts"),
  global("pulse"),
  global("political"),
  global("unusual"),
  global("sector:trix"),
  global("sector:premium"),
  global("news"),
  global("brief"),
  global("ideas"),
  global("focus"),
  global("deepen"),
  global("reports", { required: ["v", "asOf", "t"] }),
  global("oracle-top", { capBytes: 16 * 1024, required: ["items", "sessionDate"] }),
  global("oracle-norm", { capBytes: 100 * 1024, required: ["t", "sessionDate"] }),
];

const dated = (id, source, over = {}) => product(id, "dated", { pattern: source, archive: true, ...over });

const DATED = [
  dated("board:dated", "^board:(long|short):\\d{4}-\\d{2}-\\d{2}$", { required: ["rows", "sessionDate", "side"] }),
  dated("scores:dated", "^scores:\\d{4}-\\d{2}-\\d{2}$", { required: ["rows", "sessionDate"] }),
  dated("ideas:dated", "^ideas:\\d{4}-\\d{2}-\\d{2}(:r\\d+)?$", { permanent: true }),
  dated("ideas-out:dated", "^ideas-out:\\d{4}-\\d{2}-\\d{2}(:r\\d+)?$", { permanent: true }),
];

const named = (id, over = {}) => product(id, "name", {
  pattern: "^" + id + ":[A-Z][A-Z0-9.-]{0,9}$", prefix: id + ":", population: "carded", required: ["ticker", "sessionDate"], ...over,
});

const NAMES = [
  named("card", { required: ["v", "ticker", "depth", "sessionDate", "generatedAt", "panels"], capBytes: 100 * 1024 }),
  named("card-x", { population: "carded" }),
  named("hist", { population: "carded" }),
];

const UNLISTED_NAMES = [
  named("oracle", { population: "carded", capBytes: 6 * 1024, required: ["v", "ticker", "sessionDate", "generatedAt", "state", "calls"] }),
];

const live = Object.entries(LIVE_KEYS).map(([key, spec]) => product(key, "live", {
  key, level: "L0", exec: spec.writer, klass: spec.klass, capBytes: spec.maxBytes, targetByMin: null, dueByMin: null, cadenceS: spec.cadenceS,
}));

export const PRODUCTS = frozen([...GLOBALS, ...DATED, ...NAMES, ...UNLISTED_NAMES, ...live]);

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

const PATTERNS = PRODUCTS.filter((p) => p.pattern).map((p) => ({ p, re: new RegExp(p.pattern) }));

export const productById = (id) => BY_ID.get(id) || null;

export function productOf(key) {
  if (typeof key !== "string") return null;
  const exact = BY_ID.get(key);
  if (exact && exact.key === key) return exact;
  for (const { p, re } of PATTERNS) if (re.test(key)) return p;
  return null;
}

export const keysOf = (family) => PRODUCTS.filter((p) => p.family === family && p.key !== null).map((p) => p.key);

export const GLOBAL_KEYS = frozen(keysOf("global"));

export const NAME_KINDS = frozen(NAMES.map((p) => p.id));

export function tickerOfKey(key) {
  const p = productOf(key);
  if (!p || p.family !== "name") return null;
  return key.slice(p.prefix.length);
}

export const PANELS = frozen([
  frozen({ id: "quote", from: "universe row px, else the card's read price" }),
  frozen({ id: "chart", from: "card panels.context: 200 or more daily candles" }),
  frozen({ id: "levels", from: "card panels.levels" }),
  frozen({ id: "gamma", from: "card panels.gamma" }),
  frozen({ id: "move", from: "card panels.pricedMove, else the universe's implied moves" }),
  frozen({ id: "vol", from: "card panels.volContext or skewTerm, else the universe's implied and realised volatility" }),
  frozen({ id: "surface", from: "card panels.ivSurface with three or more expiries" }),
  frozen({ id: "flow", from: "card-x flowExpiry, flowStrike, gex or volume" }),
  frozen({ id: "events", from: "card-x earnings" }),
  frozen({ id: "positioning", from: "card-x short or insiders" }),
  frozen({ id: "engine", from: "card engine block" }),
  frozen({ id: "reading", from: "the stored reading, outside the nightly" }),
]);

export const PANEL_IDS = frozen(PANELS.map((p) => p.id));

const BASE = ["quote", "chart", "levels", "move", "vol", "reading"];

export const CONTRACT = frozen({
  screen: frozen(BASE.slice()),
  cross: frozen([...BASE, "gamma"]),
  index: frozen([...BASE, "gamma", "surface"]),
  fund: frozen([...BASE, "gamma", "surface"]),
  focus: frozen([...BASE, "gamma", "surface", "flow", "events", "positioning", "engine"]),
  deep: frozen([...BASE, "gamma", "surface", "flow", "events", "positioning", "engine"]),
  board: frozen([...BASE, "gamma", "surface", "flow", "events", "positioning", "engine"]),
});

export const contractFor = (depth) => (Object.hasOwn(CONTRACT, depth) ? CONTRACT[depth] : CONTRACT.screen);

export const NAME_KEY_EXPECTED = frozen({
  board: frozen(["card", "card-x", "hist"]),
  focus: frozen(["card", "card-x", "hist"]),
  deep: frozen(["card", "card-x", "hist"]),
  cross: frozen(["card", "card-x", "hist"]),
  index: frozen(["card", "card-x"]),
  fund: frozen(["card", "card-x"]),
  screen: frozen([]),
});

export const expectedKinds = (depth) => (Object.hasOwn(NAME_KEY_EXPECTED, depth) ? NAME_KEY_EXPECTED[depth] : NAME_KEY_EXPECTED.screen);

export const UNFETCHED_REASON = /never requested/i;

export const L0_COLUMNS = frozen(["sig", "f2", "f3", "iv30p"]);
