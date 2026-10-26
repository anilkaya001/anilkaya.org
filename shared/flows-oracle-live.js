import { liveSay, usdShort } from "./flows-oracle-words.js";
import { askSplit } from "./flows-tape-stats.js";

export const KINDS = Object.freeze(["surge", "repeat", "flip", "cluster", "sweeps", "size", "sector"]);

export const LIVE_LINES = Object.freeze({
  windowMs: 30 * 60000,
  repeatMs: 20 * 60000,
  sweepMs: 10 * 60000,
  earlierMs: 45 * 60000,
  warmupMs: 20 * 60000,
  cooldownMs: 30 * 60000,
  globalCap: 6,
  minWindows: 5,
  minNorm: 20,
  surgeFloor: 500000,
  surgeZ: 3.5,
  surgeWindows: 3,
  surgeSessions: 10,
  surgeSigmaMax: 1.5,
  repeatHits: 3,
  repeatFloor: 250000,
  repeatMedians: 2,
  flipSided: 400000,
  flipLean: 0.4,
  flipCoverage: 0.5,
  clusterShare: 0.6,
  clusterFloor: 300000,
  sweepHits: 4,
  sweepAskShare: 65,
  sweepFloor: 300000,
  sizeMultiple: 5,
  sizeFloor: 500,
  sizePremium: 250000,
  sectorNames: 4,
  sectorFloor: 5000000,
  eventSessions: 21,
  eventScale: 1.5,
  retainMs: 8 * 3600000,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export function createLiveState() {
  return { seen: new Set(), windows: new Map(), cool: new Map(), emitted: [], more: 0, silent: new Map() };
}

function windowOf(r) {
  if (!r || typeof r !== "object" || typeof r.t !== "string" || !r.t || !fin(r.prem) || r.prem < 0) return null;
  const at = fin(r.ts) ? r.ts : Date.parse(r.firstAt || r.spanStart || "");
  if (!Number.isFinite(at)) return null;
  const id = r.id !== undefined && r.id !== null ? String(r.id) : [r.t, r.exp, r.k, r.cp, r.firstAt || at, r.prem].join("|");
  const side = askSplit(r);
  return {
    id, t: r.t, at, cp: r.cp === "C" || r.cp === "P" ? r.cp : null, k: fin(r.k) ? r.k : null, exp: typeof r.exp === "string" ? r.exp : null,
    prem: r.prem, ask: side ? side.ask : 0, bid: side ? side.bid : 0, stated: !!(side && side.askStated && side.bidStated),
    size: fin(r.size) ? r.size : null, sweep: r.sweep === true,
  };
}

const sum = (list, key) => list.reduce((s, w) => s + w[key], 0);

function leanOf(list) {
  let num = 0, sided = 0, total = 0;
  for (const w of list) {
    total += w.prem;
    if (w.cp === null) continue;
    const up = w.cp === "C" ? w.ask - w.bid : w.bid - w.ask;
    num += up;
    sided += w.ask + w.bid;
  }
  return { lean: sided > 0 ? num / sided : null, sided, coverage: total > 0 ? sided / total : 0 };
}

const strengthOf = (value, bar) => {
  const r = value / bar;
  return r >= 3 ? 3 : r >= 1.5 ? 2 : 1;
};

function eventOf(ctx) {
  const e = ctx && ctx.earnings;
  return e && e.inWindow === true && fin(e.sessions) ? e.sessions : null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const Z90 = 1.2815515655446004;

export function surgeBar(norm, scale = 1) {
  const L = LIVE_LINES;
  if (!norm || !fin(norm.blk) || !(norm.blk >= 0) || !fin(norm.blkN) || norm.blkN < L.surgeSessions) return null;
  const med = norm.premiumMedian, p90 = norm.premiumP90;
  if (!fin(med) || !(med > 0) || !fin(p90) || !(p90 >= med)) return null;
  const sigma = clamp(Math.log(p90 / med) / Z90, 0, L.surgeSigmaMax);
  const w = med * Math.exp(1.5 * sigma * sigma);
  const own = scale * (norm.blk + L.surgeZ * Math.sqrt(norm.blk * w));
  return { own, bar: Math.max(own, L.surgeFloor), floor: own < L.surgeFloor };
}

export function detectName(ticker, wins, ctx, nowMs) {
  const L = LIVE_LINES;
  const norm = ctx && ctx.norm;
  if (!norm || !fin(norm.winN) || norm.winN < L.minNorm) return { reason: "thin-norm", found: [] };
  const found = [];
  const ev = eventOf(ctx);
  const scale = ev === null ? 1 : L.eventScale;
  const recent = wins.filter((w) => w.at > nowMs - L.windowMs && w.at <= nowMs);
  const add = (kind, strength, f, facts, at) => found.push({ ticker, kind, strength, f: { ...f, ...(ev === null ? {} : { event: ev }) }, facts, at });

  const sb = recent.length >= L.surgeWindows ? surgeBar(norm, scale) : null;
  if (sb !== null) {
    const P = sum(recent, "prem");
    const bar = sb.bar;
    if (P >= bar) {
      const minutes = (nowMs - Math.min(...recent.map((w) => w.at))) / 60000;
      add("surge", strengthOf(P, bar), { premium: P, n: recent.length, minutes: Math.max(minutes, 1), bar, floor: sb.floor },
        [{ label: "Flagged premium", display: usdShort(P) }, { label: sb.floor ? "Minimum bar" : "Bar for this name", display: usdShort(bar) }], nowMs);
    }
  }

  const rep = new Map();
  for (const w of wins) {
    if (w.at <= nowMs - L.repeatMs || w.at > nowMs || w.cp === null || w.k === null || w.exp === null) continue;
    const key = w.exp + "|" + w.k + "|" + w.cp;
    if (!rep.has(key)) rep.set(key, []);
    rep.get(key).push(w);
  }
  if (fin(norm.premiumMedian)) {
    const bar = Math.max(L.repeatMedians * norm.premiumMedian, L.repeatFloor) * scale;
    let best = null;
    for (const list of rep.values()) {
      const P = sum(list, "prem");
      if (list.length >= L.repeatHits && P >= bar && (best === null || P > best.P)) best = { list, P };
    }
    if (best) {
      const w0 = best.list[0];
      const minutes = (nowMs - Math.min(...best.list.map((w) => w.at))) / 60000;
      add("repeat", strengthOf(best.P, bar), { strike: w0.k, side: w0.cp, expiry: w0.exp, n: best.list.length, minutes: Math.max(minutes, 1), premium: best.P },
        [{ label: "Windows", display: String(best.list.length) }, { label: "Combined premium", display: usdShort(best.P) }], nowMs);
    }
  }

  const now30 = leanOf(recent);
  const earlier = leanOf(wins.filter((w) => w.at <= nowMs - L.windowMs));
  const earlierSpan = wins.filter((w) => w.at <= nowMs - L.windowMs);
  const span = earlierSpan.length ? Math.max(...earlierSpan.map((w) => w.at)) - Math.min(...earlierSpan.map((w) => w.at)) : 0;
  if (now30.lean !== null && earlier.lean !== null && now30.sided >= L.flipSided && earlier.sided >= L.flipSided &&
    now30.coverage >= L.flipCoverage && earlier.coverage >= L.flipCoverage && span >= L.earlierMs &&
    Math.abs(now30.lean) >= L.flipLean && Math.sign(now30.lean) * Math.sign(earlier.lean) === -1) {
    add("flip", Math.abs(now30.lean) >= 0.7 ? 3 : Math.abs(now30.lean) >= 0.55 ? 2 : 1, { now: now30.lean, before: earlier.lean },
      [{ label: "Lean now", display: Math.round(now30.lean * 100) + "%" }, { label: "Lean earlier", display: Math.round(earlier.lean * 100) + "%" }], nowMs);
  }

  const byExp = new Map();
  for (const w of recent) if (w.exp) byExp.set(w.exp, (byExp.get(w.exp) || 0) + w.prem);
  const exps = [...new Set(wins.map((w) => w.exp).filter(Boolean))].sort();
  const totalRecent = sum(recent, "prem");
  if (totalRecent > 0 && exps.length > 1) {
    for (const [exp, P] of byExp) {
      if (exp !== exps[0] && P >= L.clusterFloor && P / totalRecent >= L.clusterShare) {
        add("cluster", P / totalRecent >= 0.8 ? 3 : 2, { expiry: exp, share: P / totalRecent, premium: P },
          [{ label: "Share of recent flow", display: Math.round(P / totalRecent * 100) + "%" }], nowMs);
        break;
      }
    }
  }

  const sw = wins.filter((w) => w.sweep && w.at > nowMs - L.sweepMs && w.at <= nowMs);
  if (sw.length >= L.sweepHits) {
    const both = sw.filter((w) => w.stated), ask = sum(both, "ask"), bid = sum(both, "bid"), P = sum(sw, "prem");
    const share = ask + bid > 0 ? Math.round(ask / (ask + bid) * 100) : 0;
    if (share >= L.sweepAskShare && Math.round(100 * (ask + bid) / P) >= 50 && P >= L.sweepFloor) {
      const minutes = (nowMs - Math.min(...sw.map((w) => w.at))) / 60000;
      add("sweeps", P >= 3 * L.sweepFloor ? 3 : 2, { n: sw.length, minutes: Math.max(minutes, 1), premium: P },
        [{ label: "Fast windows", display: String(sw.length) }, { label: "Ask side share", display: share + "%" }], nowMs);
    }
  }

  if (fin(norm.sizeP90)) {
    const sizeBar = Math.max(L.sizeMultiple * norm.sizeP90, L.sizeFloor) * scale;
    let big = null;
    for (const w of recent) if (w.size !== null && w.size >= sizeBar && w.prem >= L.sizePremium * scale && (big === null || w.prem > big.prem)) big = w;
    if (big) {
      add("size", strengthOf(big.size, sizeBar), { size: big.size, strike: big.k, side: big.cp, expiry: big.exp, premium: big.prem, k: big.size / Math.max(norm.sizeP90, 1) },
        [{ label: "Contracts", display: String(big.size) }, { label: "Premium", display: usdShort(big.prem) }], big.at);
    }
  }
  return { reason: null, found };
}

export function detect(state, rows, contexts, nowMs, opts = {}) {
  const L = LIVE_LINES;
  const out = [];
  if (!state || !Array.isArray(rows) || !fin(nowMs)) return out;
  if (!fin(opts.openMs) || !fin(opts.closeMs) || nowMs < opts.openMs || nowMs > opts.closeMs) return out;
  for (const r of rows) {
    const w = windowOf(r);
    if (!w || state.seen.has(w.id)) continue;
    state.seen.add(w.id);
    if (!state.windows.has(w.t)) state.windows.set(w.t, []);
    state.windows.get(w.t).push(w);
  }
  for (const [t, list] of state.windows) {
    const kept = list.filter((w) => w.at > nowMs - L.retainMs);
    if (kept.length) state.windows.set(t, kept); else state.windows.delete(t);
  }
  if (opts.fresh === "stale") return out;
  if (nowMs < opts.openMs + L.warmupMs) return out;
  const ctxOf = (t) => (contexts && typeof contexts === "object" ? contexts[t] || null : null);
  const surged = [];
  const cands = [];
  for (const [t, list] of state.windows) {
    if (list.length < L.minWindows) continue;
    const res = detectName(t, list, ctxOf(t), nowMs);
    if (res.reason) state.silent.set(t, res.reason);
    for (const m of res.found) {
      cands.push(m);
      if (m.kind === "surge") surged.push(m);
    }
  }
  const bySector = new Map();
  for (const m of surged) {
    const c = ctxOf(m.ticker);
    const s = c && c.sector;
    if (!s) continue;
    if (!bySector.has(s)) bySector.set(s, new Map());
    bySector.get(s).set(m.ticker, m.f.premium);
  }
  for (const [sector, names] of bySector) {
    const P = [...names.values()].reduce((a, b) => a + b, 0);
    if (names.size >= L.sectorNames && P >= L.sectorFloor) {
      const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
      cands.push({ ticker: sector, kind: "sector", strength: P >= 3 * L.sectorFloor ? 3 : 2, f: { n: names.size, sector, names: top, premium: P },
        facts: [{ label: "Names", display: String(names.size) }, { label: "Flagged premium", display: usdShort(P) }], at: nowMs });
    }
  }
  state.emitted = state.emitted.filter((e) => e.at > nowMs - L.cooldownMs);
  cands.sort((a, b) => Number(b.kind === "sector") - Number(a.kind === "sector") || b.strength - a.strength || (b.f.premium || 0) - (a.f.premium || 0));
  state.more = 0;
  for (const m of cands) {
    const key = m.ticker + ":" + m.kind;
    const prev = state.cool.get(key);
    if (prev && nowMs - prev.at < L.cooldownMs && m.strength <= prev.strength) continue;
    if (state.emitted.length >= L.globalCap) { state.more++; continue; }
    state.cool.set(key, { at: nowMs, strength: m.strength });
    state.emitted.push({ at: nowMs });
    const bucket = Math.floor(nowMs / L.cooldownMs);
    const msg = { id: m.ticker + ":" + m.kind + ":" + bucket, ticker: m.ticker, kind: m.kind, strength: m.strength, facts: m.facts, f: m.f, at: m.at };
    msg.say = liveSay(msg);
    out.push(msg);
  }
  return out;
}
