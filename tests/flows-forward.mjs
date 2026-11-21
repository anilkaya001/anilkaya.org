import assert from "node:assert/strict";
import { black76, impliedVolB76, forwardDelta, normCdf, normPdf } from "../shared/flows-quant-bs.js";
import * as FWD from "../shared/flows-quant-forward.js";
import { bracketBook, winRange, outsideRange, BRACKET_TOL } from "../shared/flows-quant-bracket.js";
import * as QC from "../shared/flows-quant-card.js";
import * as ENG from "../shared/flows-quant-engine.js";
import * as PREM from "../shared/flows-premium.js";
import { closeUtcMs } from "../shared/flows-quant-time.js";
import { americanCRR } from "./lib/crr.mjs";
import { makeRng } from "./truth/rng.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import { symbolOf } from "./lib/sc-chain.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} against ${b} (tolerance ${tol})`); checks++; };
const rel = (a, b, tol, msg) => near(a, b, tol * Math.max(1, Math.abs(b)), msg);

const LINES = {
  REL_SPREAD: 0.25, WINDOW: 0.05, WIDEN_MAX: 0.15, WIDEN_PAIRS: 8, MAX_PAIRS: 12, MIN_PAIRS: 3, HALF_CENT: 0.005, RATE_SE: 0.02, BORROW_SE: 0.03,
  DIV_SE_UNKNOWN: 0.015, DIV_SHARE: 0.10, Z_TRUST: 3, VETO_Z: 4, BAND_PLAIN: 0.02, BAND_PM: 0.10, Z95: 1.96, BOUND_FLOOR: 0.51,
  PUT_DELTA_CUT: 0.30, CALL_DELTA_CUT: 0.70, EEP_SHARE: 0.15, EEP_SHIFT: 0.25, EEP_SD: 0.15, RAMP: 1, CARRY_WEIGHT_MIN: 0.05, SPOT_SE: 0.00015,
};

const refCarry = ({ S, r, T, q }) => {
  const known = typeof q === "number" && Number.isFinite(q);
  const F = S * Math.exp((r - (known ? q : 0)) * T);
  const div = known ? 0.10 * Math.abs(Math.exp(r * T) - Math.exp((r - q) * T)) : 0;
  const unk = known ? 0 : 0.015 * T;
  return { F, se: F * Math.sqrt(0.00015 ** 2 + (0.02 * T) ** 2 + (0.03 * T) ** 2 + div ** 2 + unk ** 2), known };
};

const refParity = (pairs, D) => {
  const rows = pairs.map(([K, cb, ca, pb, pa]) => {
    const hc = Math.max((ca - cb) / 2, 0.005), hp = Math.max((pa - pb) / 2, 0.005);
    const sigma = Math.sqrt(hc * hc + hp * hp) / (Math.sqrt(3) * D);
    return { K, sigma, Fi: K + ((cb + ca) / 2 - (pb + pa) / 2) / D };
  });
  const W = rows.reduce((a, x) => a + 1 / (x.sigma * x.sigma), 0);
  const F = rows.reduce((a, x) => a + x.Fi / (x.sigma * x.sigma), 0) / W;
  const n = rows.length;
  const chi = rows.reduce((a, x) => a + ((x.Fi - F) / x.sigma) ** 2, 0);
  const birge = n >= 2 ? Math.sqrt(chi / (n - 1)) : null;
  const kBar = rows.reduce((a, x) => a + x.K / (x.sigma * x.sigma), 0) / W;
  const stat = Math.sqrt(1 / W) * (birge === null ? 1 : Math.max(1, birge));
  const sys = 0.15 * kBar * (1 - D);
  let slopeZ = null;
  if (n >= 4) {
    const dk = rows.map((x) => x.K - kBar);
    const w = rows.map((x) => 1 / (x.sigma * x.sigma));
    const sxx = dk.reduce((a, d, i) => a + w[i] * d * d, 0);
    const slope = dk.reduce((a, d, i) => a + w[i] * d * (rows[i].Fi - F), 0) / sxx;
    const res = dk.reduce((a, d, i) => a + w[i] * (rows[i].Fi - F - slope * d) ** 2, 0);
    slopeZ = slope * Math.sqrt(sxx) / Math.max(1, Math.sqrt(res / (n - 2)));
  }
  return { F, se: Math.sqrt(stat * stat + sys * sys), birge, slopeZ, n };
};

const ramp = (x) => Math.min(1, Math.max(0, (x - 2) / 2));

const refBlend = ({ carry, par }) => {
  const z = (par.F - carry.F) / Math.sqrt(par.se ** 2 + carry.se ** 2);
  const early = ramp(-z) * (par.slopeZ === null ? 1 : ramp(-par.slopeZ));
  const gap = par.F - carry.F;
  const parF = par.F - early * 0.25 * Math.abs(gap);
  const sePar = early > 0 ? Math.sqrt(par.se ** 2 + (early * 0.15 * gap) ** 2) : par.se;
  const shifted = parF - carry.F;
  const seC = Math.sqrt(carry.se ** 2 + Math.max(0, shifted * shifted - sePar * sePar - carry.se * carry.se));
  const wp = 1 / sePar ** 2, wc = 1 / seC ** 2;
  return {
    F: (parF * wp + carry.F * wc) / (wp + wc), se: 1 / Math.sqrt(wp + wc), z, early, sePar, seC,
    src: wc / (wp + wc) < 0.05 ? "parity" : "blend",
    ee: z < -3 && par.slopeZ !== null && par.slopeZ < -3,
  };
};

const exactQuotes = ({ F, D, T, sigma, strikes, half = 0.005 }) => strikes.map((K) => {
  const c = black76(F, D, K, sigma, T, "C"), p = black76(F, D, K, sigma, T, "P");
  return { K, cb: c - half, ca: c + half, pb: p - half, pa: p + half, putRow: null };
});

const range = (lo, hi, step) => { const out = []; for (let k = lo; k <= hi + 1e-9; k += step) out.push(+k.toFixed(6)); return out; };

function battery(mod) {
  const bad = [];
  const fail = (label, cond) => { if (!cond) bad.push(label); };
  const close = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

  {
    const a = mod.carryOf({ S: 100, r: 0.04, T: 0.25, q: 0.015 }), b = refCarry({ S: 100, r: 0.04, T: 0.25, q: 0.015 });
    fail("carry forward", close(a.F, b.F, 1e-12));
    fail("carry se with a known yield", close(a.se, b.se, 1e-12));
    const c = mod.carryOf({ S: 250, r: 0.05, T: 2 / 365, q: null }), d = refCarry({ S: 250, r: 0.05, T: 2 / 365, q: null });
    fail("carry with the yield unknown", close(c.F, d.F, 1e-12) && close(c.se, d.se, 1e-12) && c.known === false);
    const e = mod.carryOf({ S: 100, r: 0.04, T: 2, q: 0.05 }), f = refCarry({ S: 100, r: 0.04, T: 2, q: 0.05 });
    fail("carry over two years", close(e.se, f.se, 1e-12));
  }

  {
    const D = Math.exp(-0.04 * 0.1);
    const pairs = [[98, 3.1, 3.3, 0.9, 1.0], [99, 2.4, 2.5, 1.2, 1.35], [100, 1.8, 1.95, 1.7, 1.9], [101, 1.25, 1.4, 2.3, 2.5], [102, 0.85, 0.95, 3.0, 3.3]];
    const got = mod.parityOf(pairs.map(([K, cb, ca, pb, pa]) => ({ K, cb, ca, pb, pa })), D);
    const want = refParity(pairs, D);
    fail("parity forward", close(got.F, want.F, 1e-12));
    fail("parity standard error with Birge ratio and exercise term", close(got.se, want.se, 1e-12));
    fail("parity Birge ratio", close(got.birge, want.birge, 1e-12));
    const one = mod.parityOf([{ K: 100, cb: 1, ca: 1, pb: 1, pa: 1 }], 0.99);
    const hs = 0.005;
    fail("a single pair has the half-cent floor, the root of three and the discount", close(one.seStat, Math.sqrt(2) * hs / (Math.sqrt(3) * 0.99), 1e-12));
    fail("a single pair has no Birge ratio", one.birge === null);
    fail("empty pairs", mod.parityOf([], 0.99) === null && mod.parityOf([{ K: 1, cb: 1, ca: 1, pb: 1, pa: 1 }], 0) === null);
  }

  {
    const s = (sigma, T) => sigma * Math.sqrt(T);
    for (const [sigma, T] of [[0.2, 1 / 365], [0.3, 0.1], [0.5, 0.5], [0.6, 2]]) {
      const sg = s(sigma, T);
      let worst = 0;
      for (let k = -8; k <= 8; k += 0.01) {
        const K = 100 * Math.exp(k * sg);
        const held = K >= 100 ? "C" : "P";
        const sens = mod.deltaSensitivity({ F: 100, K, sigma, T, held });
        if (sens !== null) worst = Math.max(worst, Math.abs(sens));
      }
      const cap = mod.dDeltaMax(1, 1, sigma, T);
      fail(`the delta bound dominates every strike (${sigma}, ${T})`, cap !== null && worst <= cap + 1e-12);
      fail(`the delta bound is the formula (${sigma}, ${T})`, cap !== null && close(cap, Math.max(0.51, sg) / sg, 1e-12));
    }
    fail("the bound refuses an unusable input", mod.dDeltaMax(1, 1, 0, 1) === null && mod.dDeltaMax(1, 0, 0.2, 1) === null && mod.dDeltaMax(1, 1, 0.2, 0) === null);
  }

  {
    const T = 0.05, sigma = 0.35, F = 100;
    let maxErr = 0;
    for (const K of [80, 92, 99, 100, 101, 108, 125]) {
      const held = K >= F ? "C" : "P";
      const price = black76(F, 0.998, K, sigma, T, held);
      const delta = (f) => {
        const iv = impliedVolB76(f, 0.998, K, T, price, held, null);
        return forwardDelta(f, K, iv, T, "C");
      };
      const h = 1e-4;
      const fd = (delta(F * Math.exp(h)) - delta(F * Math.exp(-h))) / (2 * h);
      const got = mod.deltaSensitivity({ F, K, sigma: impliedVolB76(F, 0.998, K, T, price, held, null), T, held });
      maxErr = Math.max(maxErr, Math.abs(Math.abs(fd) - Math.abs(got)) / Math.max(0.05, Math.abs(fd)));
    }
    fail("the delta sensitivity equals a finite difference of the re-solved delta", maxErr < 1e-4);
    const g = mod.deltaSensitivity({ F: 100, K: 100, sigma: 0.5 / Math.sqrt(1), T: 1, held: "P" }) * 0.5;
    fail("the put-held sensitivity at the money and s = 0.5 is 0.487", Math.abs(g - 0.487) < 1e-3);
    const gc = mod.deltaSensitivity({ F: 100, K: 100, sigma: 0.5, T: 1, held: "C" }) * 0.5;
    fail("the call-held value there is normPdf plus d2 times the cdf", Math.abs(gc - (normPdf(0.25) + (-0.25) * normCdf(0.25))) < 1e-9);
  }

  {
    const T = 0.05, sigma = 0.3, F = 100, K = 104;
    const base = mod.deltaSensitivity({ F, K, sigma, T, held: "C" });
    const seFor = (h95) => h95 * F / (1.96 * Math.abs(base));
    const at = (h95, extra = {}) => mod.deltaBand({ F, se: seFor(h95), K, sigma, T, held: "C", ...extra });
    fail("a band under two cents is plain", at(0.0199).band === "plain" && at(0.0199).half < 0.02);
    fail("exactly two cents is still plain", at(0.02).band === "plain");
    const pm = at(0.0201);
    fail("just over two cents is a plus-minus band", pm.band === "pm" && pm.half === 0.03);
    fail("the half-width rounds up, never down", at(0.0345).half === 0.04 && at(0.0301).half === 0.04 && at(0.0299999).half === 0.03);
    fail("a tenth is the last plus-minus band", at(0.0999).band === "pm" && at(0.0999).half === 0.1 && at(0.1).band === "pm");
    fail("past a tenth is a dash", at(0.1001).band === "dash" && at(0.1001).reason === "wide" && at(0.1001).half === null);
    fail("a vetoed forward is a dash", at(0.001, { veto: true }).band === "dash" && at(0.001, { veto: true }).reason === "veto");
    fail("a missing standard error is a dash", mod.deltaBand({ F, se: null, K, sigma, T, held: "C" }).band === "dash" && mod.deltaBand({ F, se: -1, K, sigma, T, held: "C" }).band === "dash");
    fail("an unusable volatility is a dash", mod.deltaBand({ F, se: 0.1, K, sigma: 0, T, held: "C" }).band === "dash");
    const rank = { plain: 0, pm: 1, dash: 2 };
    let last = 0, monotone = true;
    for (let h = 0.001; h < 0.2; h += 0.0005) { const r = rank[at(h).band]; if (r < last) monotone = false; last = r; }
    fail("a larger forward error never narrows the printed band", monotone && last === 2);
  }

  {
    const D = Math.exp(-0.04 * 0.1);
    const q = (K, cb, ca, pb, pa) => ({ K, cb, ca, pb, pa });
    const finite = (p) => p !== null && [p.F, p.se, p.seStat, p.sePure].every(Number.isFinite);
    const one = mod.parityOf([q(100, 1, 1.02, 1, 1.02)], D);
    fail("one pair gives a finite forward and error and no slope", finite(one) && one.slopeZ === null && one.birge === null);
    const two = mod.parityOf([q(100, 1, 1.02, 1, 1.02), q(101, 0.6, 0.62, 1.4, 1.42)], D);
    fail("two pairs give a finite forward and error and no slope", finite(two) && two.slopeZ === null && Number.isFinite(two.birge));
    const same = mod.parityOf([q(100, 1, 1.02, 1, 1.02), q(100, 1.01, 1.03, 1, 1.02), q(100, 1, 1.02, 1.01, 1.03), q(100, 1, 1.02, 1, 1.02)], D);
    fail("four pairs at one strike give a finite forward and no slope, never a NaN", finite(same) && same.slopeZ === null);
    const flat = mod.parityOf(exactQuotes({ F: 100, D, T: 0.1, sigma: 0.3, strikes: [98, 99, 100, 101, 102] }), D);
    fail("a set of pairs that all give one forward has a slope statistic of zero or a hair from it", finite(flat) && Math.abs(flat.slopeZ) < 1e-6);
    fail("negative discount rates are refused rather than squared", mod.parityOf([q(100, 1, 1.02, 1, 1.02)], -1) === null);
    const S = 100, r = 0.04, T = 30 / 365;
    const rec = (quotes) => mod.chooseForward({ quotes, S, r, T, q: 0.015 });
    const bad = [
      [q(100, 0, 1.02, 1, 1.02), q(101, 1, 1.02, 0, 1)],
      [q(100, 1.02, 1, 1, 1.02), q(101, 1, 1.02, 1.02, 1)],
      [q(100, NaN, 1.02, 1, 1.02), q(101, null, 1.02, 1, 1.02), q(102, undefined, 1, 1, 1)],
      [q(100, 1, 1.02, 1, 1.02), q(NaN, 1, 1.02, 1, 1.02), q(-5, 1, 1.02, 1, 1.02)],
    ];
    bad.forEach((quotes, i) => {
      const out = rec(quotes);
      fail("one-sided, crossed and non-numeric quotes leave a finite carry forward and no veto", Number.isFinite(out.F) && Number.isFinite(out.se) && out.src === "carry" && out.veto === false && out.n === (i === 3 ? 1 : 0));
    });
  }

  {
    const mk = (K, cb, ca, pb, pa) => ({ K, cb, ca, pb, pa });
    const Fc = 100, T = 0.05;
    const good = (K, w = 0.02) => mk(K, 2 - w, 2 + w, 2 - w, 2 + w);
    const pairs = (quotes, o = {}) => mod.selectPairs(quotes, { Fc, T, ...o }).map((p) => p.K);
    fail("a pair is kept at a relative spread of 0.24 and dropped at 0.26", pairs([mk(100, 1.88, 2.12, 1.88, 2.12)]).length === 1 && pairs([mk(100, 1.74, 2.26, 1.74, 2.26)]).length === 0);
    fail("a pair with a zero bid is dropped", pairs([mk(100, 0, 2, 2, 2.1), mk(101, 2, 2.1, 0, 2)]).length === 0);
    fail("a crossed quote is dropped", pairs([mk(100, 2.1, 2, 2, 2.1)]).length === 0);
    const ladder = range(90, 110, 0.5).map((K) => good(K));
    fail("with three or more pairs inside five per cent only those are used", pairs(ladder).every((K) => Math.abs(Math.log(K / Fc)) <= 0.05 + 1e-12));
    fail("at most twelve pairs, the nearest", pairs(ladder).length === 12 && Math.max(...pairs(ladder)) - Math.min(...pairs(ladder)) <= 6);
    const sparse = [good(100), good(101), good(110), good(112), good(114), good(116), good(88), good(89), good(90), good(91), good(86), good(84), good(82), good(80)];
    const wide = pairs(sparse);
    fail("with fewer than three inside, the window widens to fifteen per cent and caps at eight", wide.length === 8 && wide.every((K) => Math.abs(Math.log(K / Fc)) <= 0.15 + 1e-12));
    const cuts = [...range(95.5, 97.5, 0.5), ...range(102.5, 104.5, 0.5)].map((K) => good(K));
    const sigma = 0.3;
    const byDelta = (K) => forwardDelta(Fc, K, sigma, T, "C");
    const withCuts = mod.selectPairs(cuts, { Fc, T, sigma, divides: true });
    fail("calls under 0.30 delta are not used", withCuts.length > 0 && withCuts.every((p) => byDelta(p.K) >= 0.30 - 1e-12) && cuts.some((p) => byDelta(p.K) < 0.30));
    fail("calls over 0.70 delta are not used where a dividend may be paid", withCuts.every((p) => byDelta(p.K) <= 0.70 + 1e-12) && cuts.some((p) => byDelta(p.K) > 0.70));
    const noDiv = mod.selectPairs(cuts, { Fc, T, sigma, divides: false });
    fail("without dividends the upper cut is lifted", noDiv.some((p) => byDelta(p.K) > 0.70) && noDiv.every((p) => byDelta(p.K) >= 0.30 - 1e-12));
    fail("pairs come back in strike order", withCuts.every((p, i, a) => i === 0 || a[i - 1].K < p.K));
  }

  {
    const S = 100, r = 0.04, T = 30 / 365, D = Math.exp(-r * T), q = 0.015;
    const carry = refCarry({ S, r, T, q });
    const strikes = range(96, 104, 0.5);
    const sigma = 0.3;
    const exact = (F, half = 0.01, ks = strikes) => exactQuotes({ F, D, T, sigma, strikes: ks, half });
    const american = (F, a, c) => exact(F).map((x) => ({ ...x, pb: x.pb + a + c * (x.K - 100), pa: x.pa + a + c * (x.K - 100) }));
    const same = (got, want, label) => fail(label, close(got.F, want.F, 1e-9) && close(got.se, want.se, 1e-9) && close(got.sePar, want.sePar, 1e-9) && close(got.seC, want.seC, 1e-9) && got.src === want.src && got.ee === want.ee);
    const clean = mod.chooseForward({ quotes: exact(carry.F), S, r, T, q });
    const par0 = refParity(clean.pairs, D);
    const want0 = refBlend({ carry, par: par0 });
    fail("a chain that agrees with the carry sits on it", Math.abs(clean.z) < 1e-6 && clean.n >= 3 && clean.ee === false && close(clean.F, carry.F, 1e-9));
    same(clean, want0, "a chain that agrees with the carry is the reference blend");
    fail("an agreeing chain leaves the carry's own error alone", close(clean.seC, carry.se, 1e-12));
    const wide3 = mod.chooseForward({ quotes: exact(carry.F, 0.12, [99.5, 100, 100.5]), S, r, T, q });
    const wantW = refBlend({ carry, par: refParity(wide3.pairs, D) });
    fail("three wide pairs leave the carry more than five per cent of the weight and are labelled a blend", wide3.n === 3 && wide3.src === "blend" && wantW.src === "blend");
    fail("a tight chain leaves the carry under five per cent and is labelled parity", clean.src === "parity" && want0.src === "parity");
    for (const gapBp of [60, 150, -60, -150]) {
      const Ftrue = carry.F * (1 + gapBp / 1e4);
      const rec = mod.chooseForward({ quotes: exact(Ftrue), S, r, T, q });
      const par = refParity(rec.pairs, D);
      const want = refBlend({ carry, par });
      same(rec, want, `a chain ${gapBp} bp from the carry is read as the reference blend`);
      fail(`a flat chain ${gapBp} bp from the carry is not an early-exercise chain`, want.early === 0 && rec.ee === false && close(rec.sePar, par.se, 1e-9));
      fail(`the carry's own error grows with the disagreement (${gapBp} bp)`, rec.seC >= carry.se - 1e-12 && close(rec.seC, want.seC, 1e-9));
      fail(`the forward moves to the chain (${gapBp} bp)`, Math.abs(rec.F - Ftrue) < Math.abs(rec.Fc - Ftrue) || Math.abs(gapBp) < 5);
    }
    const flatBelow = mod.chooseForward({ quotes: exact(carry.F * (1 - 0.016)), S, r, T, q });
    const parFlat = refParity(flatBelow.pairs, D);
    fail("a flat chain far below the carry is a borrow fee or a dividend, not an exercise premium: no shift, no widening, no flag", flatBelow.z < -4 && flatBelow.ee === false && close(flatBelow.sePar, parFlat.se, 1e-9) && close(flatBelow.Fpar, parFlat.F, 1e-12));
    const parOf = (rec) => refParity(rec.pairs, D);
    let early = { none: 0, partial: 0, full: 0 }, flagged = 0, unflagged = 0;
    for (const a of [-1.5, 0, 0.3, 0.6, 0.9, 1.2, 1.8, 2.5, 4]) for (const c of [0, 0.0015, 0.0025, 0.0035, 0.02]) {
      const rec = mod.chooseForward({ quotes: american(carry.F, a, c), S, r, T, q });
      const want = refBlend({ carry, par: parOf(rec) });
      same(rec, want, `the early-exercise ramp and shift are the reference (offset ${a}, slope ${c})`);
      if (want.early === 0) early.none++; else if (want.early < 1) early.partial++; else early.full++;
      if (rec.ee) flagged++; else unflagged++;
      if (want.early > 0) {
        const par = parOf(rec);
        fail(`the shift moves the parity forward away from the carry, never toward it (offset ${a}, slope ${c})`, par.F < carry.F && close(rec.Fpar, par.F, 1e-12) && rec.F < carry.F);
        fail(`the exercise term widens the parity error (offset ${a}, slope ${c})`, rec.sePar > par.se);
      }
    }
    {
      const step = 0.02;
      let prev = null, worstF = 0, worstSe = 0;
      for (let a = 0; a <= 4 + 1e-9; a += step) {
        const out = mod.chooseForward({ quotes: american(carry.F, a, 0.02), S, r, T, q });
        if (prev) { worstF = Math.max(worstF, Math.abs(out.F - prev.F) / step); worstSe = Math.max(worstSe, Math.abs(out.se - prev.se) / step); }
        prev = out;
      }
      fail(`sweeping the level through the ramp moves the forward by at most 2 a unit and its error by at most 0.5 a unit, never by a jump (${worstF.toFixed(2)}, ${worstSe.toFixed(2)})`, worstF <= 2 && worstSe <= 0.5);
      prev = null; worstF = 0; worstSe = 0;
      for (let c = 0; c <= 0.006 + 1e-12; c += 0.0001) {
        const out = mod.chooseForward({ quotes: american(carry.F, 2.5, c), S, r, T, q });
        if (prev) { worstF = Math.max(worstF, Math.abs(out.F - prev.F)); worstSe = Math.max(worstSe, Math.abs(out.se - prev.se)); }
        prev = out;
      }
      fail(`sweeping the slope through the ramp moves the forward and its error by under 0.05 a step (${worstF.toFixed(3)}, ${worstSe.toFixed(3)})`, worstF < 0.05 && worstSe < 0.05);
    }
    fail("the grid covers no, partial and full early exercise", early.none > 0 && early.partial >= 3 && early.full >= 3 && flagged >= 3 && unflagged >= 3);
    const strong = mod.chooseForward({ quotes: american(carry.F, 2.5, 0.02), S, r, T, q });
    fail("a strongly sloped chain far below the carry is flagged as early exercise", strong.ee === true && strong.z < -3 && strong.slopeZ < -3);
    const slopeOnly = mod.chooseForward({ quotes: american(carry.F, 0, 0.02), S, r, T, q });
    fail("a slope with the level on the carry is not flagged", slopeOnly.ee === false && slopeOnly.slopeZ < -3 && slopeOnly.z > -1);
    const levelOnly = mod.chooseForward({ quotes: american(carry.F, 2.5, 0), S, r, T, q });
    fail("a level far below the carry without a slope is not flagged", levelOnly.ee === false && levelOnly.z < -4 && Math.abs(levelOnly.slopeZ) < 1);
    const above = mod.chooseForward({ quotes: american(carry.F, -2.5, -0.02), S, r, T, q });
    fail("a chain above the carry with a positive slope is never shifted or flagged", above.ee === false && above.z > 3 && close(above.sePar, parOf(above).se, 1e-9));
    const threeStrikes = mod.chooseForward({ quotes: american(carry.F, 2.5, 0.02).filter((x) => [99.5, 100, 100.5].includes(x.K)), S, r, T, q });
    const wantThree = refBlend({ carry, par: parOf(threeStrikes) });
    fail("with three pairs there is no slope and the level alone gates the shift, and it is never flagged", threeStrikes.n === 3 && wantThree.early > 0 && threeStrikes.ee === false && threeStrikes.slopeZ === null && close(threeStrikes.F, wantThree.F, 1e-9) && close(threeStrikes.sePar, wantThree.sePar, 1e-9));
    const few = mod.chooseForward({ quotes: exact(carry.F * (1 - 0.02)).filter((x) => x.K === 100 || x.K === 100.5), S, r, T, q });
    fail("two pairs a long way from the carry are a veto", few.n === 2 && few.veto === true && few.src === "carry" && few.F === carry.F);
    const fewAgree = mod.chooseForward({ quotes: exact(carry.F).filter((x) => x.K === 100 || x.K === 100.5), S, r, T, q });
    fail("two pairs that agree are not a veto but are not used", fewAgree.n === 2 && fewAgree.veto === false && fewAgree.src === "carry");
    const twoAt = (zTarget) => {
      const sv = 1 / Math.sqrt(2 / ((Math.sqrt(2) * 0.01) / (Math.sqrt(3) * D)) ** 2);
      return mod.chooseForward({ quotes: exact(carry.F + zTarget * Math.sqrt(sv * sv + carry.se * carry.se)).filter((x) => x.K === 100 || x.K === 100.5), S, r, T, q });
    };
    fail("two pairs at 3.9 sigma are not a veto", twoAt(3.9).veto === false && twoAt(-3.9).veto === false);
    fail("two pairs at 4.1 sigma are", twoAt(4.1).veto === true && twoAt(-4.1).veto === true);
    fail("two pairs at 2 sigma are not", twoAt(2).veto === false);
    const none = mod.chooseForward({ quotes: [], S, r, T, q });
    fail("no pairs leave the carry", none.src === "carry" && none.n === 0 && none.F === carry.F && none.veto === false);
    const unk = mod.chooseForward({ quotes: exact(carry.F), S, r, T, q: null });
    fail("an unknown yield is a wider carry and all pairs are allowed through the upper cut", unk.qKnown === false && unk.seC > carry.se);
  }

  return bad;
}

eq(Object.keys(FWD.FWD_LINES).sort(), Object.keys(LINES).sort(), "the forward lines are exactly the declared set");
for (const [k, v] of Object.entries(LINES)) eq(FWD.FWD_LINES[k], v, `line ${k}`);
ok(Object.isFrozen(FWD.FWD_LINES), "the lines are frozen");

{
  const bad = battery(FWD);
  eq(bad, [], "the battery finds nothing wrong with the forward module");
}

{
  const T = 5 / 365, D = Math.exp(-0.04 * T), F = 100;
  const sigma = 0.25;
  const strikes = range(94, 106, 0.5);
  const quotes = exactQuotes({ F, D, T, sigma, strikes });
  const book = bracketBook(quotes, F);
  const digitalCall = (B) => -(black76(F, D, B * (1 + 1e-6), sigma, T, "C") - black76(F, D, B * (1 - 1e-6), sigma, T, "C")) / (2e-6 * B);
  const digitalPut = (B) => (black76(F, D, B * (1 + 1e-6), sigma, T, "P") - black76(F, D, B * (1 - 1e-6), sigma, T, "P")) / (2e-6 * B);
  let inside = 0, n = 0, widthAll = 0, widthAdj = 0;
  for (const B of range(94.3, 105.8, 0.37)) {
    const got = book(B);
    const truth = got.side === "C" ? digitalCall(B) : digitalPut(B);
    n++;
    if ((got.lo === null || truth >= got.lo - 1e-9) && (got.hi === null || truth <= got.hi + 1e-9)) inside++;
    widthAll += (got.hi === null ? 1 : got.hi) - (got.lo === null ? 0 : got.lo);
    const side = got.side === "C" ? quotes.filter((x) => x.K >= F).map((x) => ({ K: x.K, bid: x.cb, ask: x.ca })) : quotes.filter((x) => x.K < F).map((x) => ({ K: x.K, bid: x.pb, ask: x.pa }));
    let up = Infinity, lo = -Infinity;
    if (got.side === "C") {
      const below = side.filter((x) => x.K <= B), above = side.filter((x) => x.K >= B);
      for (let i = 1; i < below.length; i++) up = Math.min(up, (below[i - 1].ask - below[i].bid) / (below[i].K - below[i - 1].K));
      for (let i = 0; i + 1 < above.length; i++) lo = Math.max(lo, (above[i].bid - above[i + 1].ask) / (above[i + 1].K - above[i].K));
    } else {
      const below = side.filter((x) => x.K <= B), above = side.filter((x) => x.K >= B);
      for (let i = 1; i < below.length; i++) lo = Math.max(lo, (below[i].bid - below[i - 1].ask) / (below[i].K - below[i - 1].K));
      for (let i = 0; i + 1 < above.length; i++) up = Math.min(up, (above[i + 1].ask - above[i].bid) / (above[i + 1].K - above[i].K));
    }
    widthAdj += Math.min(1, up) - Math.max(lo, 0);
  }
  eq(inside, n, "the lognormal truth lies inside the bracket at every barrier");
  ok(widthAll <= widthAdj + 1e-9, "the all-pairs bracket is never wider than the adjacent-strikes one");
  ok(widthAll < widthAdj, "and is strictly tighter somewhere");

  const sparse = quotes.filter((_, i) => i % 3 === 1);
  const sb = bracketBook(sparse, F);
  let sInside = 0, sn = 0, sWide = 0;
  for (const B of range(95.1, 105.2, 0.41)) {
    const got = sb(B);
    const truth = got.side === "C" ? digitalCall(B) : digitalPut(B);
    sn++;
    if ((got.lo === null || truth >= got.lo - 1e-9) && (got.hi === null || truth <= got.hi + 1e-9)) sInside++;
    sWide += (got.hi === null ? 1 : got.hi) - (got.lo === null ? 0 : got.lo);
  }
  eq(sInside, sn, "with two thirds of the strikes deleted the truth is still inside");
  ok(sWide > widthAll, "and the bracket is wider for it");

  const crossed = quotes.map((x) => (x.K === 100 ? { ...x, cb: x.ca + 0.5 } : x));
  const cb = bracketBook(crossed, F)(100.3);
  const plain = bracketBook(quotes.filter((x) => x.K !== 100), F)(100.3);
  eq([cb.lo, cb.hi], [plain.lo, plain.hi], "a crossed quote is ignored, as if the strike were absent");

  const edge = bracketBook(quotes, F)(120);
  ok(edge.side === "C" && edge.hi !== null, "a barrier past the last strike keeps its upper bound from the strikes below it");
  ok(edge.lo === null, "and has no lower bound");
  const none = bracketBook([], F)(101);
  eq([none.lo, none.hi], [null, null], "no quotes bound nothing");
  eq(bracketBook(quotes, F)(0), null, "a non-positive barrier is no bracket");

  const wr = winRange({ side: "C", lo: 0.2, hi: 0.4 }, { profit: "below", D: 0.99 });
  near(wr.lo, 1 - 0.4 / 0.99, 1e-12, "a short call's win is one minus the digital call");
  near(wr.hi, 1 - 0.2 / 0.99, 1e-12, "both ends flip");
  const wp = winRange({ side: "P", lo: 0.2, hi: 0.4 }, { profit: "below", D: 0.99 });
  near(wp.lo, 0.2 / 0.99, 1e-12, "on the put side the digital is the win itself");
  const off = winRange({ side: "C", lo: 0.2, hi: 1.7 }, { profit: "below", D: 0.5 });
  ok(off.lo >= 0 && off.hi <= 1 && off.lo <= off.hi, "a server discount that is not the page's still gives a range inside zero and one");
  ok(winRange({ side: "C", lo: null, hi: null }, { profit: "below", D: 0.99 }).trivial, "an empty bracket is trivial");
  eq(winRange({ side: "C", lo: 0.1, hi: 0.2 }, { profit: "below", D: 0 }), null, "a zero discount gives no range");
  const r1 = { lo: 0.4, hi: 0.6, trivial: false };
  ok(!outsideRange(0.6 + BRACKET_TOL - 1e-9, r1, { side: "C", D: 0.99 }) && outsideRange(0.6 + BRACKET_TOL + 1e-3, r1, { side: "C", D: 0.99 }), "the call-side tolerance is one percentage point");
  ok(!outsideRange(0.6 + BRACKET_TOL + 0.02, r1, { side: "P", D: 0.98 }) && outsideRange(0.6 + BRACKET_TOL + 0.02 + 5e-3, r1, { side: "P", D: 0.98 }), "the put-side tolerance adds the discount");
  ok(!outsideRange(0.9, { lo: 0, hi: 1, trivial: true }, { side: "C", D: 1 }) && !outsideRange(NaN, r1, { side: "C", D: 1 }) && !outsideRange(0.5, null, { side: "C", D: 1 }), "a trivial range, a missing win and no range are never flags");
}

{
  const S = 100, r = 0.08, T = 1, sigma = 0.3, D = Math.exp(-r * T);
  const F = S * Math.exp(r * T);
  const strikes = range(60, 100, 1);
  const quotes = strikes.map((K) => {
    const p = americanCRR({ S, K, r, sigma, T, type: "P", steps: 400, american: true });
    const c = black76(F, D, K, sigma, T, "C");
    return { K, cb: c, ca: c, pb: p, pa: p, putRow: null };
  });
  const book = bracketBook(quotes, F);
  let worstPlain = 0, flaggedWithout = 0, flaggedWith = 0;
  for (const B of range(66, 96, 2)) {
    const got = book(B);
    const rng = winRange(got, { profit: "below", D });
    const ez = (Math.log(F / B) - 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
    const model = normCdf(-ez);
    const miss = Math.max(rng.lo - model, model - rng.hi, 0);
    worstPlain = Math.max(worstPlain, miss);
    if (outsideRange(model, rng, { side: got.side, D })) flaggedWith++;
    if (model < rng.lo - BRACKET_TOL || model > rng.hi + BRACKET_TOL) flaggedWithout++;
  }
  ok(worstPlain > BRACKET_TOL, `the American put quotes at eight per cent rates move the bracket by ${worstPlain.toFixed(3)}, more than the bare tolerance`);
  eq(flaggedWith, 0, "and the tolerance that adds the discount does not flag a correct model");
  ok(flaggedWithout > 0, "while the bare tolerance would");
}

{
  const day = "2026-10-26";
  const readMs = closeUtcMs(day) - 3 * 3600 * 1000;
  const S = 100, r = 0.04, T = 3 / (24 * 365), D = Math.exp(-r * T), q = 0.015, F = S * Math.exp((r - q) * T);
  const strikes = range(99, 101.5, 0.25);
  const raw = [];
  for (const K of strikes) for (const type of ["C", "P"]) {
    const px = black76(F, D, K, 0.3, T, type);
    const bid = Math.max(0.01, +(px - 0.01).toFixed(2));
    raw.push({ option_symbol: symbolOf("SYA101", day, type, K), nbbo_bid: bid.toFixed(2), nbbo_ask: (bid + 0.02).toFixed(2), implied_volatility: "0.3", open_interest: "900", volume: "50" });
  }
  const ranked = PREM.rankChain(raw, { spot: S, asOf: day, strategy: "cc", limit: 500, ticker: "SYA101", readMs, rate: r, gates: { minDays: 0 }, fwdCarry: q });
  ok(ranked.fwd.length === 1, "a same-day expiry is priced when the gate admits it");
  near(ranked.fwd[0].T * 365 * 24, 3, 1e-9, "three hours left is three hours, not a day and not zero");
  eq(ranked.fwd[0].T > 0 && ranked.fwd[0].T < 1 / 365, true, "T is a fraction of a day");
  const row = { K: 100, type: "C", bid: 0.45, ask: 0.47, oi: 900, volume: 50, sym: "x", ivSeed: null, opposite: { bid: 0.44, ask: 0.46 } };
  const fit = QC.contractFit({ expiry: day, asOfMs: readMs, spot: S, rate: r, rateMethod: "given", facts: [{ id: "carry.implied", v: q, g: 3 }], expiries: null, row });
  near(fit.T * 365 * 24, 3, 1e-9, "the card's frame uses the same elapsed time");
  ok(fit.forward.F > 0 && Math.abs(fit.forward.F - F) < 1e-9, "and the forward it reports is the carry forward at that T");
}

{
  const S = 100, r = 0.04, T = 10 / 365, D = Math.exp(-r * T), q = 0.015;
  const day = "2026-11-05";
  const asOfMs = closeUtcMs("2026-10-26") - 3 * 3600 * 1000;
  const Ftrue = S * Math.exp((r - q) * T) * 1.004;
  const sigma = 0.32;
  const K = 103, mid = black76(Ftrue, D, K, sigma, T, "C");
  const vendorIv = impliedVolB76(S * Math.exp((r - q) * T), D, K, T, mid, "C", null);
  const row = { K, type: "C", bid: mid - 0.02, ask: mid + 0.02, oi: 500, volume: 10, sym: "x", ivSeed: vendorIv, opposite: null };
  const fwd = { F: Ftrue, se: 0.01, src: "parity", n: 6 };
  const fit = QC.contractFit({ expiry: day, asOfMs, spot: S, rate: r, rateMethod: "given", facts: [{ id: "carry.implied", v: q, g: 3 }], expiries: null, row, fwd });
  const Tm = (closeUtcMs(day) - asOfMs) / (365 * 86400000);
  near(fit.T, Tm, 1e-12, "the frame's T is the elapsed time over a 365-day year");
  near(fit.forward.F, Ftrue, 1e-12, "the forward behind the fit is the chosen one");
  const resolved = impliedVolB76(Ftrue, Math.exp(-r * Tm), K, Tm, (row.bid + row.ask) / 2, "C", null);
  near(fit.slice.contract.iv, resolved, 1e-9, "the volatility is re-solved from the mid under the chosen forward");
  ok(Math.abs(fit.slice.contract.iv - vendorIv) > 1e-4, "and is not the feed's, which was solved under another forward");
  eq(fit.forward.method, "parity", "the fit says which forward it used");
  const carryFit = QC.contractFit({ expiry: day, asOfMs, spot: S, rate: r, rateMethod: "given", facts: [{ id: "carry.implied", v: q, g: 3 }], expiries: null, row, fwd: { F: Ftrue, se: 0.01, src: "carry", n: 0 } });
  near(carryFit.forward.F, S * Math.exp((r - q) * Tm), 1e-12, "a record that says carry is not used as a forward");
  eq(QC.contractFit({ expiry: day, asOfMs, spot: S, rate: r, rateMethod: "given", facts: [], expiries: null, row: { ...row, ivSeed: null } }) === null, false, "no card at all still fits on the rate");
}

{
  const day = "2026-11-13";
  const asOfMs = closeUtcMs("2026-10-26") - 3 * 3600 * 1000;
  const S = 100, r = 0.04, q = 0.015;
  const Tm = (closeUtcMs(day) - asOfMs) / (365 * 86400000);
  const D = Math.exp(-r * Tm), Ftrue = S * Math.exp((r - q) * Tm) * 0.99;
  const callK = 103, putK = 97;
  const callMid = black76(Ftrue, D, callK, 0.30, Tm, "C"), putMid = black76(Ftrue, D, callK, 0.36, Tm, "P");
  const base = { expiry: day, asOfMs, spot: S, rate: r, rateMethod: "given", facts: [{ id: "carry.implied", v: q, g: 3 }], expiries: null };
  const callRow = { K: callK, type: "C", bid: callMid - 0.02, ask: callMid + 0.02, oi: 500, volume: 10, sym: "x", ivSeed: null, opposite: { bid: putMid - 0.02, ask: putMid + 0.02 } };
  const fwdOf = (ee) => ({ F: Ftrue, se: 0.2, src: "parity", n: 8, ee });
  const ivOf = (mod, input) => { const fit = mod.contractFit(input); return fit ? { iv: fit.slice.contract.iv, via: fit.slice.contract.via } : null; };
  const probe = (mod) => {
    const bad = [];
    const flagged = ivOf(mod, { ...base, row: callRow, fwd: fwdOf(true) });
    const plain = ivOf(mod, { ...base, row: callRow, fwd: fwdOf(false) });
    const absent = ivOf(mod, { ...base, row: callRow, fwd: { F: Ftrue, se: 0.2, src: "parity", n: 8 } });
    const wantPut = impliedVolB76(Ftrue, D, callK, Tm, putMid, "P", null), wantCall = impliedVolB76(Ftrue, D, callK, Tm, callMid, "C", null);
    if (!flagged || Math.abs(flagged.iv - wantPut) > 1e-9 || flagged.via !== "opposite") bad.push("flagged call is read from its put");
    if (!plain || Math.abs(plain.iv - wantCall) > 1e-9 || plain.via !== "own") bad.push("unflagged call is read from itself");
    if (!absent || Math.abs(absent.iv - wantCall) > 1e-9) bad.push("a record without the flag is unflagged");
    const ownPutMid = black76(Ftrue, D, putK, 0.33, Tm, "P");
    const putRow = { K: putK, type: "P", bid: ownPutMid - 0.02, ask: ownPutMid + 0.02, oi: 500, volume: 10, sym: "x", ivSeed: null, opposite: { bid: black76(Ftrue, D, putK, 0.3, Tm, "C") - 0.02, ask: black76(Ftrue, D, putK, 0.3, Tm, "C") + 0.02 } };
    const wantOwnPut = impliedVolB76(Ftrue, D, putK, Tm, ownPutMid, "P", null);
    const put = ivOf(mod, { ...base, row: putRow, fwd: fwdOf(true) });
    if (!put || Math.abs(put.iv - wantOwnPut) > 1e-9 || put.via !== "own") bad.push("a put is always read from itself");
    const itm = { ...callRow, K: 96, bid: black76(Ftrue, D, 96, 0.3, Tm, "C") - 0.02, ask: black76(Ftrue, D, 96, 0.3, Tm, "C") + 0.02, opposite: { bid: black76(Ftrue, D, 96, 0.3, Tm, "P") - 0.02, ask: black76(Ftrue, D, 96, 0.3, Tm, "P") + 0.02 } };
    const wantItm = impliedVolB76(Ftrue, D, 96, Tm, black76(Ftrue, D, 96, 0.3, Tm, "P"), "P", null);
    const itmGot = ivOf(mod, { ...base, row: itm, fwd: fwdOf(false) });
    if (!itmGot || Math.abs(itmGot.iv - wantItm) > 1e-6 || itmGot.via !== "opposite") bad.push("an in-the-money call is always read from its put");
    const noOpp = ivOf(mod, { ...base, row: { ...callRow, opposite: null }, fwd: fwdOf(true) });
    if (!noOpp || Math.abs(noOpp.iv - wantCall) > 1e-9 || noOpp.via !== "own") bad.push("with no put quote the call is read from itself");
    return bad;
  };
  eq(probe(QC), [], "the card reads a flagged call from its put and nothing else differently");
  const cases = [
    ["the flag ignored", [["const early = row.type === \"C\" && f.fwd !== null && f.fwd.ee === true;", "const early = false;"]]],
    ["every call read from its put", [["const early = row.type === \"C\" && f.fwd !== null && f.fwd.ee === true;", "const early = row.type === \"C\";"]]],
    ["the flag applied to puts too", [["const early = row.type === \"C\" && f.fwd !== null && f.fwd.ee === true;", "const early = f.fwd !== null && f.fwd.ee === true;"]]],
    ["an unset flag read as set", [["const early = row.type === \"C\" && f.fwd !== null && f.fwd.ee === true;", "const early = row.type === \"C\" && f.fwd !== null && f.fwd.ee !== false;"]]],
  ];
  const survived = [];
  for (const [title, transforms] of cases) {
    let mod;
    try { mod = await loadMutated("shared/flows-quant-card.js", transforms); } catch (e) { survived.push(title + " (did not apply: " + e.message.slice(0, 80) + ")"); continue; }
    if (probe(mod).length === 0) survived.push(title);
    checks++;
  }
  eq(survived, [], `all ${cases.length} planted wrong builds of the put-side read fail the probe`);
}

{
  const S = 100, r = 0.04, T = 20 / 365, D = Math.exp(-r * T), q = 0.015, sigma = 0.3;
  const F = S * Math.exp((r - q) * T);
  const day = "2026-11-13";
  const asOfMs = closeUtcMs("2026-10-26") - 3 * 3600 * 1000;
  const Tm = (closeUtcMs(day) - asOfMs) / (365 * 86400000);
  const K = 104;
  const mid = black76(F, D, K, sigma, Tm, "C");
  const bid = +(mid - 0.02).toFixed(2), ask = +(mid + 0.02).toFixed(2);
  const row = { K, type: "C", bid, ask, oi: 500, volume: 10, sym: "x", ivSeed: null, opposite: null };
  const fit = QC.contractFit({ expiry: day, asOfMs, spot: S, rate: r, rateMethod: "given", facts: [{ id: "carry.implied", v: q, g: 3 }], expiries: null, row });
  const setup = QC.labSetup({ asOfMs, spot: S, facts: [{ id: "carry.implied", v: q, g: 3 }], state: null, pLaw: null, event: null, stale: false, crossesEarnings: null, books: [{ fit, rows: [row] }], lawCache: new Map() });
  const st = ENG.priceStructure(setup, { family: "custom", fam: { id: "custom", risk: "undefined", dir: "neutral" }, expiry: day, legs: [{ type: "C", K, side: -1, qty: 1 }], basis: "natural" });
  const midFit = (bid + ask) / 2;
  near(st.ev.q, 100 * (bid - midFit), 0.2, "the market-pricing EV of a sale into the bid is the bid less the smile's value, per contract");
  ok(st.ev.q < 0, "so it is the half-spread given up, and negative");
  eq(st.ev.p, null, "with no real-world law there is no real-world EV");
  ok(st.ev.edge === null || Number.isFinite(st.ev.edge), "the edge is a number or absent");
}

{
  const EARLY = "const early = clamp01((-z - lo) / width) * (par.slopeZ === null ? 1 : clamp01((-par.slopeZ - lo) / width));";
  const mutants = [
    ["Birge ratio dropped", "shared/flows-quant-forward.js", [["const sePure = seStat * (birge === null ? 1 : Math.max(1, birge));", "const sePure = seStat;"]]],
    ["weights not squared", "shared/flows-quant-forward.js", [["const w = 1 / (sigma * sigma);", "const w = 1 / sigma;"]]],
    ["discount missing in the pair forward", "shared/flows-quant-forward.js", [["const Fi = p.K + ((p.cb + p.ca) / 2 - (p.pb + p.pa) / 2) / D;", "const Fi = p.K + ((p.cb + p.ca) / 2 - (p.pb + p.pa) / 2);"]]],
    ["quote error not divided by the root of three", "shared/flows-quant-forward.js", [["Math.sqrt(hsC * hsC + hsP * hsP) / (SQRT3 * D)", "Math.sqrt(hsC * hsC + hsP * hsP) / D"]]],
    ["half-cent floor missing", "shared/flows-quant-forward.js", [["const hsC = Math.max((p.ca - p.cb) / 2, H), hsP = Math.max((p.pa - p.pb) / 2, H);", "const hsC = (p.ca - p.cb) / 2, hsP = (p.pa - p.pb) / 2;"]]],
    ["exercise term dropped", "shared/flows-quant-forward.js", [["const sys = FWD_LINES.EEP_SHARE * kBar * (1 - D);", "const sys = 0;"]]],
    ["bound floor missing", "shared/flows-quant-forward.js", [["return Math.max(FWD_LINES.BOUND_FLOOR, s) * (se / F) / s;", "return s * (se / F) / s;"]]],
    ["carry error never grown", "shared/flows-quant-forward.js", [["const seC = Math.sqrt(carry.se * carry.se + Math.max(0, shifted * shifted - sePar * sePar - carry.se * carry.se));", "const seC = carry.se;"]]],
    ["early-exercise correction missing", "shared/flows-quant-forward.js", [[EARLY, "const early = 0;"]]],
    ["early-exercise correction not gated by the slope", "shared/flows-quant-forward.js", [[EARLY, "const early = clamp01((-z - lo) / width);"]]],
    ["early-exercise correction not gated by the level", "shared/flows-quant-forward.js", [[EARLY, "const early = par.slopeZ === null ? 1 : clamp01((-par.slopeZ - lo) / width);"]]],
    ["early-exercise correction on both sides", "shared/flows-quant-forward.js", [[EARLY, "const early = clamp01((Math.abs(z) - lo) / width) * (par.slopeZ === null ? 1 : clamp01((-par.slopeZ - lo) / width));"]]],
    ["early-exercise correction a hard step", "shared/flows-quant-forward.js", [[EARLY, "const early = z < -L.Z_TRUST && (par.slopeZ === null || par.slopeZ < -L.Z_TRUST) ? 1 : 0;"]]],
    ["early-exercise ramp a hundredth as wide", "shared/flows-quant-forward.js", [["RAMP: 1,", "RAMP: 0.01,"]]],
    ["parity shifted toward the carry", "shared/flows-quant-forward.js", [["const parF = par.F - early * L.EEP_SHIFT * Math.abs(gap);", "const parF = par.F + early * L.EEP_SHIFT * Math.abs(gap);"]]],
    ["parity shifted by the signed gap", "shared/flows-quant-forward.js", [["const parF = par.F - early * L.EEP_SHIFT * Math.abs(gap);", "const parF = par.F - early * L.EEP_SHIFT * gap;"]]],
    ["parity not shifted", "shared/flows-quant-forward.js", [["const parF = par.F - early * L.EEP_SHIFT * Math.abs(gap);", "const parF = par.F;"]]],
    ["shift a half instead of a quarter", "shared/flows-quant-forward.js", [["EEP_SHIFT: 0.25,", "EEP_SHIFT: 0.5,"]]],
    ["exercise error not added to the parity error", "shared/flows-quant-forward.js", [["const sePar = early > 0 ? Math.sqrt(par.se * par.se + (early * L.EEP_SD * gap) ** 2) : par.se;", "const sePar = par.se;"]]],
    ["exercise error not scaled by the ramp", "shared/flows-quant-forward.js", [["(early * L.EEP_SD * gap) ** 2", "(L.EEP_SD * gap) ** 2"]]],
    ["carry error measured from the unshifted gap", "shared/flows-quant-forward.js", [["Math.max(0, shifted * shifted - sePar * sePar - carry.se * carry.se)", "Math.max(0, gap * gap - sePar * sePar - carry.se * carry.se)"]]],
    ["label by the size of the disagreement", "shared/flows-quant-forward.js", [["out.src = wc / (wp + wc) < L.CARRY_WEIGHT_MIN ? \"parity\" : \"blend\";", "out.src = Math.abs(z) > L.Z_TRUST ? \"parity\" : \"blend\";"]]],
    ["label always a blend", "shared/flows-quant-forward.js", [["out.src = wc / (wp + wc) < L.CARRY_WEIGHT_MIN ? \"parity\" : \"blend\";", "out.src = \"blend\";"]]],
    ["flag without the slope", "shared/flows-quant-forward.js", [["out.ee = z < -L.Z_TRUST && par.slopeZ !== null && par.slopeZ < -L.Z_TRUST;", "out.ee = z < -L.Z_TRUST;"]]],
    ["flag on the slope alone", "shared/flows-quant-forward.js", [["out.ee = z < -L.Z_TRUST && par.slopeZ !== null && par.slopeZ < -L.Z_TRUST;", "out.ee = par.slopeZ !== null && par.slopeZ < -L.Z_TRUST;"]]],
    ["slope from three pairs", "shared/flows-quant-forward.js", [["if (n >= 4) {", "if (n >= 3) {"]]],
    ["slope without the weights", "shared/flows-quant-forward.js", [["sxy += r.w * dk * (r.Fi - F);", "sxy += dk * (r.Fi - F);"]]],
    ["slope t-statistic without the floor on the residual scale", "shared/flows-quant-forward.js", [["Math.max(1, Math.sqrt(res / (n - 2)))", "Math.sqrt(res / (n - 2))"]]],
    ["spot error forgotten", "shared/flows-quant-forward.js", [["L.SPOT_SE ** 2 + ", ""]]],
    ["blend weights swapped", "shared/flows-quant-forward.js", [["out.F = (parF * wp + carry.F * wc) / (wp + wc);", "out.F = (parF * wc + carry.F * wp) / (wp + wc);"]]],
    ["blend error is the smaller of the two", "shared/flows-quant-forward.js", [["out.se = 1 / Math.sqrt(wp + wc);", "out.se = Math.min(sePar, seC);"]]],
    ["veto at half a sigma", "shared/flows-quant-forward.js", [["VETO_Z: 4,", "VETO_Z: 0.5,"]]],
    ["band rounds down", "shared/flows-quant-forward.js", [["Math.ceil(h95 * 100 - 1e-9) / 100", "Math.floor(h95 * 100) / 100"]]],
    ["plus-minus band to a fifth", "shared/flows-quant-forward.js", [["BAND_PM: 0.10,", "BAND_PM: 0.20,"]]],
    ["plain band to a tenth", "shared/flows-quant-forward.js", [["BAND_PLAIN: 0.02,", "BAND_PLAIN: 0.10,"]]],
    ["sensitivity sign", "shared/flows-quant-forward.js", [["normPdf(d1) - d2 * normCdf(-d1) : normPdf(d1) + d2 * normCdf(d1)", "normPdf(d1) + d2 * normCdf(-d1) : normPdf(d1) - d2 * normCdf(d1)"]]],
    ["held side swapped", "shared/flows-quant-forward.js", [["const g = held === \"P\" ?", "const g = held === \"C\" ?"]]],
    ["window of fifty per cent", "shared/flows-quant-forward.js", [["WINDOW: 0.05,", "WINDOW: 0.5,"]]],
    ["spread gate at a half", "shared/flows-quant-forward.js", [["REL_SPREAD: 0.25,", "REL_SPREAD: 0.5,"]]],
    ["put delta cut removed", "shared/flows-quant-forward.js", [["if (call < L.PUT_DELTA_CUT) return false;", ""]]],
    ["call delta cut removed", "shared/flows-quant-forward.js", [["return !(divides && call > L.CALL_DELTA_CUT);", "return true;"]]],
    ["borrow error forgotten", "shared/flows-quant-forward.js", [["(L.BORROW_SE * T) ** 2", "0"]]],
    ["twelve pairs become thirty", "shared/flows-quant-forward.js", [["MAX_PAIRS: 12,", "MAX_PAIRS: 30,"]]],
    ["z taken from the parity error alone", "shared/flows-quant-forward.js", [["const z = (par.F - carry.F) / Math.sqrt(par.se * par.se + carry.se * carry.se);", "const z = (par.F - carry.F) / par.se;"]]],
  ];
  const survived = [];
  for (const [title, rel, transforms] of mutants) {
    const mod = await loadMutated(rel, transforms);
    if (battery({ ...FWD, ...mod }).length === 0) survived.push(title);
    checks++;
  }
  eq(survived, [], `all ${mutants.length} planted wrong builds of the forward module fail the battery`);
}

{
  const day = "2026-11-13";
  const asOfMs = closeUtcMs("2026-10-26") - 3 * 3600 * 1000;
  const S = 100, r = 0.04, q = 0.015;
  const Tm = (closeUtcMs(day) - asOfMs) / (365 * 86400000);
  const Ftrue = S * Math.exp((r - q) * Tm) * 1.004;
  const K = 103;
  const mid = black76(Ftrue, Math.exp(-r * Tm), K, 0.32, Tm, "C");
  const row = { K, type: "C", bid: mid - 0.02, ask: mid + 0.02, oi: 500, volume: 10, sym: "x", ivSeed: impliedVolB76(S * Math.exp((r - q) * Tm), Math.exp(-r * Tm), K, Tm, mid, "C", null), opposite: null };
  const input = { expiry: day, asOfMs, spot: S, rate: r, rateMethod: "given", facts: [{ id: "carry.implied", v: q, g: 3 }], expiries: null, row, fwd: { F: Ftrue, se: 0.01, src: "parity", n: 6 } };
  const probe = (mod) => {
    const bad = [];
    const fit = mod.contractFit(input);
    if (!fit) return ["no fit"];
    if (Math.abs(fit.forward.F - Ftrue) > 1e-9) bad.push("forward");
    const resolved = impliedVolB76(Ftrue, Math.exp(-r * Tm), K, Tm, (row.bid + row.ask) / 2, "C", null);
    if (Math.abs(fit.slice.contract.iv - resolved) > 1e-9) bad.push("iv");
    if (Math.abs(fit.T - Tm) > 1e-12) bad.push("T");
    return bad;
  };
  eq(probe(QC), [], "the card's fit passes the probe");
  const cases = [
    ["parity forward ignored: the carry forward is used and the volatility re-solved there", [["const used = fwd && fin(fwd.F) && fwd.F > 0 && (fwd.src === \"parity\" || fwd.src === \"blend\") ? fwd : null;", "const used = null;"]]],
    ["the feed's volatility combined with our forward", [["const iv = impliedVolB76(f.F, f.D, K, f.T, mid, type, seed);", "const iv = seed !== null ? seed : impliedVolB76(f.F, f.D, K, f.T, mid, type, seed);"]]],
    ["T in whole days", [["const T = yearFraction(asOfMs, expiry);\n  if (!(T > 0)) return { bad: \"expired\" };", "const T = calendarDays(etDayOf(asOfMs), expiry) / 365;\n  if (!(T > 0)) return { bad: \"expired\" };"]]],
    ["the forward refit on the rate alone", [["const F = used ? used.F : S * Math.exp((r - carry) * T);", "const F = S * Math.exp((r - carry) * T);"]]],
  ];
  const survived = [];
  for (const [title, transforms] of cases) {
    let mod;
    try { mod = await loadMutated("shared/flows-quant-card.js", transforms); } catch (e) { survived.push(title + " (did not apply: " + e.message.slice(0, 80) + ")"); continue; }
    if (probe(mod).length === 0) survived.push(title);
    checks++;
  }
  eq(survived, [], `all ${cases.length} planted wrong builds of the card's frame fail the probe`);
}

{
  const day = "2026-10-26";
  const readMs = closeUtcMs(day) - 3 * 3600 * 1000;
  const S = 100, r = 0.04, T = 3 / (24 * 365), D = Math.exp(-r * T), q = 0.015, F = S * Math.exp((r - q) * T);
  const raw = [];
  for (const K of range(99, 101.5, 0.25)) for (const type of ["C", "P"]) {
    const px = black76(F, D, K, 0.3, T, type);
    const bid = Math.max(0.01, +(px - 0.01).toFixed(2));
    raw.push({ option_symbol: symbolOf("SYA101", day, type, K), nbbo_bid: bid.toFixed(2), nbbo_ask: (bid + 0.02).toFixed(2), implied_volatility: "0.3", open_interest: "900", volume: "50" });
  }
  const run = (mod) => {
    const ranked = mod.rankChain(raw, { spot: S, asOf: day, strategy: "cc", limit: 500, ticker: "SYA101", readMs, rate: r, gates: { minDays: 0 }, fwdCarry: q });
    return ranked.fwd.length === 1 && Math.abs(ranked.fwd[0].T * 365 * 24 - 3) < 1e-9 ? [] : ["T"];
  };
  eq(run(PREM), [], "the premium module reads three hours as three hours");
  const mod = await loadMutated("shared/flows-premium.js", [["const yearsTo = (p, readMs) => (Number.isFinite(readMs) ? yearFraction(readMs, p.expiry) : p.days / DAYS_PER_YEAR);", "const yearsTo = (p, readMs) => p.days / DAYS_PER_YEAR;"]]);
  eq(run(mod).length > 0, true, "planted: T from the day count instead of the minutes");
}

console.log(`flows-forward: ${checks} checks`);
