import {
  DEPTHS, DEPTH_OF_CARD, L0_COLUMNS, NAME_KINDS, PANEL_IDS, STATE, STATE_NAMES, UNFETCHED_REASON, contractFor, expectedKinds,
} from "./flows-products.js";

export const COVERAGE_VERSION = 1;

export const FAILING_MAX = 100;

export const MIN_CANDLES = 200;

export const MIN_SURFACE_EXPIRIES = 3;

export const KEY_PRODUCTS = Object.freeze(["row", "card", "cardX", "hist"]);

const KIND_TO_PRODUCT = Object.freeze({ card: "card", "card-x": "cardX", hist: "hist" });

const RANK = Object.freeze({ [STATE.ok]: 0, [STATE.quiet]: 1, [STATE.pending]: 2, [STATE.stale]: 3, [STATE.unfetched]: 4, [STATE.failed]: 5 });

const SEVERITY = Object.freeze({ [STATE.failed]: 0, [STATE.stale]: 1, [STATE.unfetched]: 2, [STATE.pending]: 3, [STATE.quiet]: 4, [STATE.ok]: 5 });

const MISSES = Object.freeze([STATE.failed, STATE.unfetched, STATE.stale]);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const clip = (text, cap = 160) => (String(text).length > cap ? String(text).slice(0, cap - 1) + "…" : String(text));

const finite = (v) => typeof v === "number" && Number.isFinite(v);

export const stateName = (code) => STATE_NAMES[code] || "failed";

export const zeroCounts = () => Object.fromEntries(STATE_NAMES.map((n) => [n, 0]));

export function stateOfPanel(panel, absent = STATE.unfetched) {
  if (!isObject(panel)) return [absent, "the card carries no such panel"];
  const why = typeof panel.reason === "string" ? panel.reason : null;
  switch (panel.status) {
    case "ok": return [STATE.ok, null];
    case "quiet": return [STATE.quiet, why];
    case "pending": return [STATE.pending, why];
    case "stale": return [STATE.stale, why];
    case "thin": return [STATE.ok, null];
    case "unavailable":
      if (panel.code === "failed") return [STATE.failed, why];
      return [why && UNFETCHED_REASON.test(why) ? STATE.unfetched : STATE.failed, why];
    default: return [STATE.failed, why];
  }
}

function bestOf(list) {
  let best = null;
  for (const entry of list) if (best === null || RANK[entry[0]] < RANK[best[0]]) best = entry;
  return best || [STATE.unfetched, null];
}

const section = (x, key) => (isObject(x) && isObject(x[key]) ? x[key] : null);

function fromSection(x, key) {
  const s = section(x, key);
  if (s === null) return [STATE.unfetched, `no ${key} section`];
  const why = typeof s.reason === "string" ? s.reason : typeof s.why === "string" ? s.why : null;
  switch (s.status) {
    case "ok":
    case "thin": return [STATE.ok, null];
    case "quiet": return [STATE.quiet, why];
    case "stale": return [STATE.stale, why];
    case "pending": return [STATE.pending, why];
    case "unavailable": return [why && UNFETCHED_REASON.test(why) ? STATE.unfetched : STATE.failed, why];
    default: return [STATE.failed, why];
  }
}

function cardXProducts(cardX) {
  if (!isObject(cardX) || cardX.status === "absent") return null;
  if (cardX.status === "pending") return "pending";
  return cardX;
}

export function cardProducts(card, cardX, hist, opts = {}) {
  const depth = opts.depth || (isObject(card) ? DEPTH_OF_CARD[card.depth] : null) || "screen";
  const out = {};
  const why = {};
  const put = (id, entry) => {
    out[id] = entry[0];
    if (entry[1]) why[id] = entry[1];
  };
  const panels = isObject(card) && isObject(card.panels) ? card.panels : null;
  if (panels === null) {
    for (const id of PANEL_IDS) put(id, [STATE.unfetched, "no card"]);
    put("reading", [STATE.pending, null]);
    return { codes: out, why };
  }
  const spot = [panels.levels && panels.levels.spot, panels.pricedMove && panels.pricedMove.spot, card.readPx && card.readPx.px];
  put("quote", spot.some(finite) ? [STATE.ok, null] : [STATE.failed, "the card holds no price"]);
  const ctx = panels.context;
  if (isObject(ctx) && ctx.status === "ok") {
    const bars = Array.isArray(ctx.candles) ? ctx.candles.length : 0;
    put("chart", bars >= MIN_CANDLES ? [STATE.ok, null] : [STATE.quiet, `${bars} daily bars, under the ${MIN_CANDLES} a chart wants`]);
  } else put("chart", stateOfPanel(ctx));
  put("levels", stateOfPanel(panels.levels));
  put("gamma", stateOfPanel(panels.gamma));
  put("move", stateOfPanel(panels.pricedMove));
  put("vol", bestOf([stateOfPanel(panels.volContext), stateOfPanel(panels.skewTerm)]));
  const iv = panels.ivSurface;
  if (isObject(iv) && iv.status === "ok") {
    const n = Array.isArray(iv.expiries) ? iv.expiries.length : finite(iv.expiriesTotal) ? iv.expiriesTotal : 0;
    put("surface", n >= MIN_SURFACE_EXPIRIES ? [STATE.ok, null] : [STATE.quiet, `${n} expiries, under the ${MIN_SURFACE_EXPIRIES} a surface wants`]);
  } else put("surface", stateOfPanel(iv));
  const x = cardXProducts(cardX);
  if (x === "pending") {
    for (const id of ["flow", "events", "positioning"]) put(id, [STATE.pending, "the dossier publishes with tonight's run"]);
  } else if (x === null) {
    for (const id of ["flow", "events", "positioning"]) put(id, [STATE.unfetched, "no card-x for this name"]);
  } else {
    put("flow", bestOf(["flowExpiry", "flowStrike", "gex", "volume"].map((k) => fromSection(x, k))));
    put("events", fromSection(x, "earnings"));
    put("positioning", bestOf(["short", "insiders"].map((k) => fromSection(x, k))));
  }
  const engine = (isObject(card.engine) && card.engine.state) || (isObject(cardX) && isObject(cardX.engine) && cardX.engine.state) ? true : false;
  put("engine", engine ? [STATE.ok, null] : depth === "board" || depth === "focus" || depth === "deep" ? [STATE.failed, "the engine block did not build"] : [STATE.unfetched, "no engine for this tier"]);
  put("reading", opts.reading ? [STATE.ok, null] : [STATE.pending, null]);
  if (isObject(hist) && hist.status === "absent") why.hist = "no hist for this name";
  return { codes: out, why };
}

const decoded = (universe, key, i) => {
  const col = universe && universe.cols && universe.cols[key];
  return Array.isArray(col) && finite(col[i]) ? col[i] : null;
};

export function screenProducts(universe, i) {
  const codes = {};
  const why = {};
  const put = (id, entry) => {
    codes[id] = entry[0];
    if (entry[1]) why[id] = entry[1];
  };
  put("quote", decoded(universe, "px", i) !== null ? [STATE.ok, null] : [STATE.failed, "the universe row carries no price"]);
  for (const id of ["chart", "levels", "surface", "flow", "events", "positioning", "engine"]) put(id, [STATE.unfetched, "no card was built for this name"]);
  put("gamma", decoded(universe, "gexAdv", i) !== null ? [STATE.ok, null] : [STATE.unfetched, "the universe row carries no dealer gamma"]);
  put("move", decoded(universe, "im5", i) !== null || decoded(universe, "im30", i) !== null ? [STATE.ok, null] : [STATE.unfetched, "the universe row carries no implied move"]);
  put("vol", decoded(universe, "iv30", i) !== null ? [STATE.ok, null] : [STATE.unfetched, "the universe row carries no implied volatility"]);
  put("reading", [STATE.pending, null]);
  return { codes, why };
}

function universeNames(universe) {
  return universe && Array.isArray(universe.t) ? universe.t : [];
}

const depthOf = (roster, t) => {
  const d = roster && isObject(roster.depth) ? roster.depth[t] : null;
  return DEPTHS.includes(d) && d !== "screen" ? d : "screen";
};

export function coverageLedger({ universe, roster = null, cards = new Map(), expected = null, reading = null } = {}) {
  const names = universeNames(universe);
  const n = names.length;
  const products = Object.fromEntries(PANEL_IDS.map((id) => [id, new Array(n).fill(STATE.unfetched)]));
  const counts = Object.fromEntries(PANEL_IDS.map((id) => [id, zeroCounts()]));
  const reasons = Object.fromEntries(PANEL_IDS.map((id) => [id, {}]));
  const missing = {};
  const failing = [];
  const depth = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = names[i];
    const d = depthOf(roster, t);
    depth[i] = d;
    const held = cards instanceof Map ? cards.get(t) : null;
    const read = held && held.card ? cardProducts(held.card, held.cardX, held.hist, { depth: d, reading: reading && reading.has(t) }) : screenProducts(universe, i);
    for (const id of PANEL_IDS) {
      const code = read.codes[id];
      products[id][i] = code;
      counts[id][stateName(code)]++;
    }
    for (const id of contractFor(d)) {
      const code = read.codes[id];
      if (!MISSES.includes(code)) continue;
      missing[id] = (missing[id] || 0) + 1;
      const label = stateName(code);
      reasons[id][label] = (reasons[id][label] || 0) + 1;
      failing.push({ t, p: id, code, why: clip(read.why[id] || label), d });
    }
  }
  failing.sort((a, b) => SEVERITY[a.code] - SEVERITY[b.code] || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.p < b.p ? -1 : 1));
  return {
    v: COVERAGE_VERSION,
    sessionDate: expected,
    n,
    t: names.slice(),
    depth,
    products,
    counts,
    reasons,
    failing: failing.slice(0, FAILING_MAX).map(({ t, p, code, why, d }) => ({ t, p, code, why, d })),
    failingTotal: failing.length,
    contract: { ok: failing.length === 0, missing },
  };
}

function entryState(entry, expected, truncated) {
  if (!entry || entry.present === false) return truncated ? [STATE.pending, "the listing was cut before this key"] : [STATE.failed, "not stored"];
  const session = typeof entry.sessionDate === "string" && DAY.test(entry.sessionDate) ? entry.sessionDate : null;
  if (session === null) return [STATE.failed, "stored with no session date"];
  if (expected === null) return [STATE.pending, "no expected session could be worked out"];
  if (session < expected) return [STATE.stale, `dated ${session}, behind ${expected}`];
  return [STATE.ok, null];
}

function rowState(universe, i) {
  const gaps = L0_COLUMNS.filter((k) => decoded(universe, k, i) === null);
  return gaps.length ? [STATE.unfetched, `no ${gaps.join(", ")} in the universe row`] : [STATE.ok, null];
}

export function verifyCoverage({ universe, roster = null, listing = null, globals = null, expected = null } = {}) {
  const names = universeNames(universe);
  const n = names.length;
  const keys = listing && isObject(listing.keys) ? listing.keys : {};
  const truncated = !!(listing && listing.truncated);
  const listed = listing !== null;
  const columns = Object.fromEntries(KEY_PRODUCTS.map((p) => [p, new Array(n).fill(STATE.unfetched)]));
  const counts = Object.fromEntries(KEY_PRODUCTS.map((p) => [p, zeroCounts()]));
  const byDepth = {};
  const failing = [];
  const depth = new Array(n);
  const predicates = { P1: { failing: 0, of: 0 }, P2: { failing: 0, of: 0 }, P4: { failing: 0, of: 0 }, P7: { failing: 0, of: n } };
  const rosterSessions = roster && isObject(roster.session) ? roster.session : {};
  for (let i = 0; i < n; i++) {
    const t = names[i];
    const d = depthOf(roster, t);
    depth[i] = d;
    const bucket = byDepth[d] || (byDepth[d] = { n: 0, ...Object.fromEntries(KEY_PRODUCTS.map((p) => [p, zeroCounts()])) });
    bucket.n++;
    const wanted = expectedKinds(d);
    const row = rowState(universe, i);
    const put = (product, entry) => {
      columns[product][i] = entry[0];
      counts[product][stateName(entry[0])]++;
      bucket[product][stateName(entry[0])]++;
      if (entry[0] === STATE.failed || entry[0] === STATE.stale) failing.push({ t, d, p: product, code: entry[0], why: clip(entry[1] || stateName(entry[0])) });
    };
    put("row", row);
    if (row[0] !== STATE.ok) predicates.P7.failing++;
    const sessions = {};
    for (const kind of NAME_KINDS) {
      const product = KIND_TO_PRODUCT[kind];
      if (!wanted.includes(kind)) {
        put(product, [STATE.unfetched, "this tier has none by design"]);
        continue;
      }
      const entry = listed ? keys[`${kind}:${t}`] : null;
      sessions[kind] = entry && typeof entry.sessionDate === "string" ? entry.sessionDate : null;
      put(product, listed ? entryState(entry, expected, truncated) : [STATE.pending, "the store listing could not be read"]);
    }
    if (wanted.includes("card")) {
      predicates.P1.of++;
      if (columns.card[i] !== STATE.ok) predicates.P1.failing++;
      for (const kind of wanted.filter((k) => k !== "card")) {
        if (sessions.card && sessions[kind]) {
          predicates.P2.of++;
          if (sessions[kind] !== sessions.card) predicates.P2.failing++;
        }
      }
      if (sessions.card && typeof rosterSessions[t] === "string") {
        predicates.P4.of++;
        if (rosterSessions[t] !== sessions.card) predicates.P4.failing++;
      }
    }
  }
  failing.sort((a, b) => SEVERITY[a.code] - SEVERITY[b.code] || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.p < b.p ? -1 : 1));
  const conservation = { ok: true, expected: n, counted: {} };
  for (const p of KEY_PRODUCTS) {
    const sum = Object.values(counts[p]).reduce((a, b) => a + b, 0);
    conservation.counted[p] = sum;
    if (sum !== n) conservation.ok = false;
  }
  const globalReport = {};
  let globalsOk = true;
  if (isObject(globals)) {
    for (const [key, entry] of Object.entries(globals)) {
      const s = entryState(entry, expected, false);
      globalReport[key] = { state: stateName(s[0]), session: entry && typeof entry.sessionDate === "string" ? entry.sessionDate : null, why: s[1] };
      if (s[0] !== STATE.ok) globalsOk = false;
    }
  }
  const held = roster && isObject(roster.held) ? Object.keys(roster.held).length : 0;
  const complete = conservation.ok && globalsOk && failing.length === 0 && predicates.P1.failing === 0 && predicates.P2.failing === 0 && predicates.P4.failing === 0 && listed && !truncated;
  return {
    v: COVERAGE_VERSION,
    expected,
    universe: { n, sessionDate: universe && DAY.test(String(universe.sessionDate || "")) ? universe.sessionDate : null },
    roster: { sessionDate: roster && DAY.test(String(roster.sessionDate || "")) ? roster.sessionDate : null, held, counts: roster && isObject(roster.counts) ? roster.counts : null },
    listing: { read: listed, truncated },
    products: counts,
    byDepth,
    predicates,
    failing: failing.slice(0, FAILING_MAX),
    failingTotal: failing.length,
    globals: globalReport,
    conservation,
    complete,
    columns: { t: names.slice(), depth, ...columns },
  };
}
