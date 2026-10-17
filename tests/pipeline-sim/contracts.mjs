import { world } from "./world.mjs";

const SESSION = "2026-08-24";

const VOLATILE = ["readAt", "generatedAt", "producer", "screenerReadAt", "refreshedAt"];

const clone = (v) => JSON.parse(JSON.stringify(v));

const BASE_ARGS = (ticker) => ({
  ticker, row: { close: 100, prev_close: 99 }, features: {}, strikes: [], ticks: [], expiries: [], maxPain: [], surface: [], chain: null,
  darkpool: null, oiDeltas: null, termStructure: null, ivRank: null, sessionDate: SESSION, generatedAt: SESSION + "T22:00:00Z",
});

export const CARD_CORRUPTIONS = Object.freeze([
  { id: "ticker", code: "ticker_mismatch", path: "ticker", apply: (p) => { p.ticker = "ZZZ"; } },
  { id: "session-date", code: "bad_session", path: "sessionDate", apply: (p) => { p.sessionDate = "2026-02-30"; } },
  { id: "session-missing", code: "bad_session", path: "sessionDate", apply: (p) => { delete p.sessionDate; } },
  { id: "stamp", code: "bad_stamp", path: "generatedAt", apply: (p) => { p.generatedAt = "21:45"; } },
  { id: "schema-high", code: "schema_version", path: "v", apply: (p) => { p.v = 99; } },
  { id: "schema-low", code: "schema_version", path: "v", apply: (p) => { p.v = 1; } },
  { id: "depth", code: "bad_shape", path: "depth", apply: (p) => { p.depth = "deep"; } },
  { id: "panels-list", code: "bad_shape", path: "panels", apply: (p) => { p.panels = []; } },
  { id: "panel-status", code: "bad_shape", path: "panels.levels", apply: (p) => { p.panels.levels.status = "great"; } },
  { id: "core-missing", code: "missing_field", path: "panels.gamma", apply: (p) => { delete p.panels.gamma; } },
  { id: "infinite", code: "non_finite", path: "score", apply: (p) => { p.score = Number.POSITIVE_INFINITY; } },
  { id: "nan-nested", code: "non_finite", path: "panels.levels.spot", apply: (p) => { p.panels.levels.spot = Number.NaN; } },
  { id: "fixture", code: "synthetic_refused", path: "fixture", apply: (p) => { p.fixture = true; } },
  { id: "synthetic-inside", code: "synthetic_refused", path: "panels.marketRank.peers.0", apply: (p) => { p.panels.marketRank = { status: "ok", peers: ["SYN007"] }; } },
]);

const rand = (w, depth = 0) => {
  const n = 2 + w.int(4);
  const out = {};
  for (let i = 0; i < n; i++) {
    const key = w.pick(["a", "b", "c", "d", "e", "x", "y", "readAt", "generatedAt", "producer", "screenerReadAt", "refreshedAt"]) + (w.chance(0.3) ? w.int(3) : "");
    const r = w.uniform();
    out[key] = depth < 2 && r < 0.3 ? rand(w, depth + 1) : r < 0.5 ? Array.from({ length: w.int(4) }, () => w.int(100)) : r < 0.8 ? w.int(1000) : "s" + w.int(50);
  }
  return out;
};

const shuffled = (w, value, stamp) => {
  if (Array.isArray(value)) return value.map((v) => shuffled(w, v, stamp));
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value);
  for (let i = keys.length - 1; i > 0; i--) { const j = w.int(i + 1); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  const out = {};
  for (const k of keys) out[k] = ["readAt", "generatedAt", "producer", "screenerReadAt", "refreshedAt"].includes(k) ? "stamp-" + stamp + "-" + w.int(1e6) : shuffled(w, value[k], stamp);
  return out;
};

const firstLeaf = (value, path = []) => {
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) { const r = firstLeaf(value[i], [...path, i]); if (r) return r; } return null; }
  if (value !== null && typeof value === "object") {
    for (const k of Object.keys(value)) {
      if (["readAt", "generatedAt", "producer", "screenerReadAt", "refreshedAt"].includes(k)) continue;
      const r = firstLeaf(value[k], [...path, k]);
      if (r) return r;
    }
    return null;
  }
  return path.length ? path : null;
};

export async function contractsScenario(seed, mod, { card, products }) {
  const w = world(seed, "contracts");
  const ticker = "T" + String.fromCharCode(65 + w.int(26)) + String.fromCharCode(65 + w.int(26));
  const key = "card:" + ticker;
  const base = card.buildCard(BASE_ARGS(ticker));
  w.check(mod.validate(key, base, { allowSynthetic: true }).ok, `${key}: the card straight from the builder is valid`);
  w.check(mod.validate(key, base).ok, `${key}: and valid with no allowance, since its name is not synthetic`);

  const picks = [];
  const pool = [...CARD_CORRUPTIONS];
  if (seed % (CARD_CORRUPTIONS.length + 3) < CARD_CORRUPTIONS.length) picks.push(pool.splice(seed % (CARD_CORRUPTIONS.length + 3), 1)[0]);
  const extra = w.chance(0.4) ? 1 : 0;
  for (let i = 0; i < extra; i++) picks.push(pool.splice(w.int(pool.length), 1)[0]);
  const bad = clone(base);
  for (const c of picks.slice()) {
    try { c.apply(bad); } catch { picks.splice(picks.indexOf(c), 1); }
  }
  const strictAllow = { allowSynthetic: false };
  const result = mod.validate(key, bad, strictAllow);
  w.log(`card ${key} with ${picks.map((c) => c.id).join(", ") || "no corruption"}`);
  w.check(result.ok === (picks.length === 0), picks.length === 0 ? "a clean card is refused" : `A CORRUPT CARD IS ACCEPTED (${picks.map((c) => c.id).join(", ")})`);
  for (const c of picks) {
    const found = result.structural.some((s) => s.code === c.code && (s.path === c.path || c.code === "synthetic_refused"));
    const shadow = picks.some((o) => o !== c && (o.id === "panels-list" || o.id === "core-missing"));
    w.check(found || shadow, `${c.id}: ${c.code} at ${c.path} expected among ${JSON.stringify(result.structural.slice(0, 4))}`);
  }
  if (picks.length === 0) w.check(mod.checkPayload(key, base, strictAllow).ok === true, "checkPayload agrees on a clean card");
  else w.check(mod.checkPayload(key, bad, strictAllow).ok === false, "checkPayload agrees on a corrupt one");

  const synth = clone(base);
  synth.ticker = ticker;
  synth.panels.marketRank = { status: "ok", peers: ["SYN" + String(100 + w.int(900))] };
  w.check(mod.validate(key, synth).ok === false, "SYNTHETIC NAMES ARE REFUSED outside a test: a card that names a SYN### peer is not accepted");
  w.check(mod.validate(key, synth, { allowSynthetic: true }).ok === true, "and accepted when the test allows it");
  w.check(mod.validate("card:SYN" + String(100 + w.int(900)), { ...base, ticker: "SYN001" }).ok === false, "a card keyed by a synthetic ticker is refused");

  const a = rand(w);
  const b = shuffled(w, a, seed);
  const product = products.productOf(key);
  w.check(mod.canonical(a, product) === mod.canonical(b, product), "CANONICAL FORM: key order and volatile stamps do not change it");
  const leaf = firstLeaf(a);
  if (leaf) {
    const c = clone(a);
    let node = c;
    for (let i = 0; i < leaf.length - 1; i++) node = node[leaf[i]];
    const last = leaf[leaf.length - 1];
    node[last] = typeof node[last] === "number" ? node[last] + 1 : node[last] + "!";
    w.check(mod.canonical(c, product) !== mod.canonical(a, product), "while a changed value does change it");
    const ha = await mod.canonicalHash(a, product);
    const hb = await mod.canonicalHash(b, product);
    const hc = await mod.canonicalHash(c, product);
    w.check(ha === hb && ha !== hc, "and the hash follows the canonical form");
  }
  const reordered = { ...a };
  const arrKey = Object.keys(a).find((k) => !VOLATILE.includes(k) && Array.isArray(a[k]) && a[k].length > 1 && new Set(a[k]).size > 1);
  if (arrKey) {
    reordered[arrKey] = [...a[arrKey]].reverse();
    w.check(mod.canonical(reordered, product) !== mod.canonical(a, product), "an array keeps its order in the canonical form");
  }
  return { violations: w.violations, checks: w.checks, events: w.events };
}
