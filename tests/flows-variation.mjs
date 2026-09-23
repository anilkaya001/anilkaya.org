import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUT_TO_DEALER, VARIATION_LINES, VARIATION_VOTES, blackScholesGreeks, conventionProbe,
  putMultipliers, estimateKc, unitFamily, chainCallVanna, vannaScale, dealerNets, cardNets,
  sessionSigma, volOfVol, typicalDollarVolume, variation, cardVariationInput, variationSummary,
  scoreVarianceShares, nextSessionAfter, VARIATION_CODES, SILENCE_KINDS,
} from "../shared/flows-variation.js";
import {
  neutralize, gammaDecayCalendar, greekTermStructure, callVannaLeg, putVannaLeg,
  callCharmLeg, putCharmLeg, openInterestGammaBook, strikeBookPutSign, SIGN_CONVENTION,
} from "../shared/flows-features.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, tol, msg) => {
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol,
    `${msg} (got ${a}, want ${b} within ${tol})`);
  checks++;
};
const rel = (a, b, tol, msg) => near(a, b, Math.abs(b) * tol, msg);

const SESSION = "2026-09-21";
const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function vendorRows({ spot = 100, vol = 0.35, rate = 0.04, kc = 50, dtes = [4, 9, 32], seed = 1,
  mutate = null } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const strikes = [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2].map((m) => spot * m);
  const truth = { gamma: 0, delta: 0, vanna: 0, charm: 0 };
  const rows = dtes.map((dte) => {
    const r = { expiry: addDays(SESSION, dte), dte };
    let gc = 0, gp = 0, dc = 0, dp = 0, vc = 0, vp = 0, cc = 0, cp = 0;
    for (const k of strikes) {
      const oc = Math.round(500 + 4000 * rnd()), op = Math.round(500 + 4000 * rnd());
      const c = blackScholesGreeks({ spot, strike: k, days: dte, vol, rate, type: "C" });
      const p = blackScholesGreeks({ spot, strike: k, days: dte, vol, rate, type: "P" });
      gc += c.gamma * oc * 100; gp += p.gamma * op * 100;
      dc += c.delta * oc * 100; dp += p.delta * op * 100;
      vc += c.vanna * oc * 100; vp += p.vanna * op * 100;
      cc += kc * c.charmPerDay * oc * 100; cp += kc * p.charmPerDay * op * 100;
    }
    Object.assign(r, {
      call_gex: gc, put_gex: -gp, call_delta: dc, put_delta: dp,
      call_vanna: vc, put_vanna: vp, call_charm: cc, put_charm: cp,
    });
    if (dte >= 1) {
      truth.gamma += gc - gp;
      truth.delta += dc - dp;
      truth.vanna += vc - vp;
      if (dte > 1) truth.charm += cc - cp;
    }
    if (mutate) mutate(r);
    return r;
  });
  return { rows, truth };
}

{
  const g = blackScholesGreeks({ spot: 100, strike: 110, days: 10, vol: 0.4, rate: 0.04, type: "C" });
  ok(g.vanna > 0 && g.charmPerDay < 0,
     "an out-of-the-money call carries vanna above zero and charm below it — the quadrant every check below leans on");
  const itm = blackScholesGreeks({ spot: 100, strike: 99.5, days: 120, vol: 0.2, rate: 0.05, type: "C" });
  ok(itm.vanna < 0 && itm.charmPerDay < 0,
     "and a near-the-money call far enough out lands in (−,−): the rate term, which is why a count of same-signed rows proves nothing");
  const put = blackScholesGreeks({ spot: 100, strike: 110, days: 10, vol: 0.4, rate: 0.04, type: "P" });
  near(put.vanna, g.vanna, 1e-12, "a holder's put carries the same vanna as the call on its strike");
  near(put.charmPerDay, g.charmPerDay, 1e-12, "and, with no dividend, the same charm");
  eq(PUT_TO_DEALER.gamma, 1, "put gamma arrives dealer-signed, so it adds");
  for (const k of ["delta", "vanna", "charm"]) eq(PUT_TO_DEALER[k], -1, `put ${k} arrives holder-signed, so it subtracts`);
  eq(VARIATION_VOTES, false, "the hedge driver carries no vote until its per-session IC clears a shuffled null");
  eq(SILENCE_KINDS.join(","), "pending,unreadable,quiet,unavailable", "the four silences are the product's four");
}

{
  const { rows, truth } = vendorRows({ seed: 7 });
  const nets = dealerNets(rows, { asOf: SESSION, h: 1 });
  rel(nets.gamma, truth.gamma, 1e-9, "the dealer gamma net is call + put, to the nine digits the rows carry");
  rel(nets.delta, truth.delta, 1e-9, "the dealer delta net is call − put");
  rel(nets.vanna, truth.vanna, 1e-9, "the dealer vanna net is call − put");
  rel(nets.charm, truth.charm, 1e-9, "the dealer charm net is call − put over the expiries that outlive the next session");
  eq(nets.expiries.live, 3, "three live expiries");

  const names = Array.from({ length: 10 }, (_, i) => ({ rows: vendorRows({ seed: 100 + i, spot: 60 + i * 9 }).rows }));
  const raw = conventionProbe(names, { asOf: SESSION });
  eq(raw.call, "raw", "Black-Scholes call legs read as raw");
  eq(raw.put, "raw", "and so do holder-signed put legs");
  ok(raw.oppositeShare.put >= VARIATION_LINES.PROBE_SHARE, `opposite-sign |charm| share ${raw.oppositeShare.put}`);

  const negated = names.map((n) => ({ rows: n.rows.map((r) => ({ ...r, put_charm: -r.put_charm })) }));
  eq(conventionProbe(negated, { asOf: SESSION }).put, "negated",
     "negating put charm moves the mass into (+,+) and the probe says so");
  eq(putMultipliers(conventionProbe(negated, { asOf: SESSION })).charm, 1,
     "and a negated put charm then adds instead of subtracting");

  const mixed = names.map((n, i) => (i % 2 ? { rows: n.rows.map((r) => ({ ...r, put_charm: -r.put_charm })) } : n));
  const mix = conventionProbe(mixed, { asOf: SESSION });
  eq(mix.put, "undetermined", `a half-and-half mix settles nothing (${mix.oppositeShare.put})`);
  const mult = putMultipliers(mix);
  eq(mult.charm, null, "so charm is not netted");
  eq(mult.vanna, null, "and neither is vanna, whose sign is only known relative to charm");

  const liveLike = [];
  for (let i = 0; i < 40; i++) {
    const big = i < 33;
    liveLike.push({ rows: [{ expiry: addDays(SESSION, 4), call_vanna: 10, call_charm: -5,
      put_vanna: big ? 4 : -1, put_charm: big ? -900 : -3 }] });
  }
  const ll = conventionProbe(liveLike, { asOf: SESSION });
  ok(ll.countShare.put < VARIATION_LINES.PROBE_SHARE,
     `a live-like book where only ${ll.countShare.put} of put rows are opposite-signed by count`);
  eq(ll.put, "raw",
     "still reads raw once each row is weighted by |charm|, which is how the 0.830 count and the 0.996 weight on the live card disagree");

  const card = { ticker: "T", sessionDate: SESSION, regime: { netGamma: 1e5 },
    panels: { levels: { status: "ok", spot: 100 }, pricedMove: { status: "ok", iv30: 0.35 },
      context: { status: "ok", candles: candlesFor(SESSION, 60) } } };
  const silentCharm = variation(cardVariationInput(card, { expiries: mixed[0].rows }),
    { probe: mix, kc: { status: "ok", value: 50 }, vannaScale: { status: "agree", ratio: 1, n: 5 } });
  eq(silentCharm.channels.charm, null, "the undetermined convention silences the charm channel");
  ok(silentCharm.silences.some((s) => s.channel === "charm" && s.code === "charm-unnetted"),
     "with the reason naming the convention");
}

function candlesFor(end, n, { from = 100, step = 0.01, volume = 1e6, after = [] } = {}) {
  const out = [];
  let px = from;
  let t = Date.parse(end + "T00:00:00Z");
  const days = [];
  while (days.length < n) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(t).toISOString().slice(0, 10));
    t -= 86400000;
  }
  days.reverse();
  days.forEach((d, i) => {
    px = px * Math.exp((i % 2 ? 1 : -1) * step * (1 + (i % 3) * 0.3));
    out.push([d, px, px * 1.01, px * 0.99, px, volume * (1 + (i % 5) * 0.1)]);
  });
  for (const a of after) out.push(a);
  return out;
}

{
  const names = [];
  for (let i = 0; i < 12; i++) {
    const vol = 0.2 + i * 0.03;
    names.push({ rows: vendorRows({ seed: 300 + i, vol, rate: 0, kc: 47, dtes: [2, 3, 5, 8, 11] }).rows, iv30: vol });
  }
  const kc = estimateKc(names, { asOf: SESSION });
  eq(kc.status, "ok", `enough readings to publish (${kc.n})`);
  rel(kc.value, 47, 1e-6, "with no rate term, the planted charm scale comes back exactly");

  const withRate = (dtes) => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const vol = 0.25 + i * 0.02;
      out.push({ rows: vendorRows({ seed: 400 + i, vol, rate: 0.04, kc: 52, dtes }).rows, iv30: vol });
    }
    return estimateKc(out, { asOf: SESSION }).value;
  };
  const front = withRate([2, 3, 4]), back = withRate([9, 10, 11]);
  ok(front > 52 && back > front,
     `with r above zero the rate term biases the estimate up, more so with time left (${front} at 2-4 days, ${back} at 9-11, ` +
     "against 52 planted): why the window stops at 11 days and a planted-scale check needs r = 0");

  const term = names.map((n) => ({ ...n, iv30: 5, term: n.rows.map((r) => ({ expiry: r.expiry, vol: n.iv30 })) }));
  rel(estimateKc(term, { asOf: SESSION }).value, 47, 1e-6,
      "the term vol is matched by expiry date, not by a day count that differs between feeds");

  const few = estimateKc(names.slice(0, 2), { asOf: SESSION });
  eq(few.status, "unavailable", "ten readings do not publish a scale");
  ok(/needs 30/.test(few.reason), `and the reason names the line (${few.reason})`);

  const noisy = names.map((n, i) => ({ ...n, iv30: n.iv30 * (i % 2 ? 3 : 0.3) }));
  eq(estimateKc(noisy, { asOf: SESSION }).status, "unavailable",
     "readings whose spread is wider than 60% of the median do not publish a scale");
}

{
  const shareNames = [60, 80, 120, 200, 450, 900].map((S) => ({ spot: S, callGex: 1e6, callGammaOi: 1e6 * 0.01 * S * S * 0.7 }));
  eq(unitFamily(shareNames).family, "share", "Σcall_gamma_oi / Σcall_gex near 0.01·S² reads as the share family, band bias and all");
  const pctNames = [60, 80, 120, 200, 450, 900].map((S) => ({ spot: S, callGex: 1e6, callGammaOi: 1.1e6 }));
  eq(unitFamily(pctNames).family, "pct$", "a ratio near one reads as dollars per 1% move");
  const cheap = [5, 8, 10, 12, 20, 30].map((S) => ({ spot: S, callGex: 1e6, callGammaOi: 1e6 * 0.01 * S * S }));
  const c = unitFamily(cheap);
  eq(c.n, 0, "names under 40 are not classified: at S = 10 the two hypotheses coincide");
  eq(c.family, "unresolved", "so the probe stays unresolved");
  eq(c.used, "share", "and the documented share unit stands, the probe being a guard");
}

{
  const spot = 100, days = 9, vol = 0.4;
  const rows = [];
  let direct = 0;
  for (const k of [85, 90, 95, 100, 105, 110, 115]) {
    const oi = 1000 + k;
    rows.push({ type: "C", strike: k, expiry: addDays(SESSION, days), iv: vol * 100, oi });
    rows.push({ type: "P", strike: k, expiry: addDays(SESSION, days), iv: vol, oi });
    direct += blackScholesGreeks({ spot, strike: k, days, vol, rate: VARIATION_LINES.RATE, type: "C" }).vanna * oi * 100;
  }
  const model = chainCallVanna(rows, { spot, asOf: SESSION, expiry: addDays(SESSION, days) });
  rel(model.value, direct, 1e-12, "the chain check sums call vanna × OI × 100, reading an implied volatility quoted in percent as a fraction");
  eq(model.contracts, 7, "and only the calls on that expiry");
  eq(vannaScale([{ vendor: 1.1, model: 1 }, { vendor: 0.95, model: 1 }, { vendor: 1.05, model: 1 }]).status, "agree",
     "vendor within a quarter of Black-Scholes agrees");
  eq(vannaScale([{ vendor: 100, model: 1 }, { vendor: 101, model: 1 }, { vendor: 99, model: 1 }]).status, "disagree",
     "a hundredfold scale is caught");
  eq(vannaScale([{ vendor: 1, model: 1 }]).status, "unmeasured", "one name measures nothing");
}

{
  const S = 100;
  const base = {
    ticker: "T", sessionDate: SESSION, regime: { netGamma: 5e5, bookGammaRaw: null },
    panels: {
      levels: { status: "ok", spot: S },
      pricedMove: { status: "ok", iv30: 0.3 },
      context: { status: "ok", candles: candlesFor(SESSION, 60) },
      volContext: { status: "ok", ivRank: { status: "ok", rows: ivRows(SESSION, 40, { rho: -0.5 }) } },
    },
  };
  const { rows } = vendorRows({ spot: S, vol: 0.3, seed: 11, mutate: (r) => {
    r.put_gex *= 0.3;
    r.call_charm = -Math.abs(r.call_charm);
    r.put_charm = Math.abs(r.call_charm) * 0.2;
  } });
  const opts = { probe: { call: "raw", put: "raw" }, kc: { status: "ok", value: 50, n: 100, iqrRatio: 0.2 },
    unit: { family: "share", used: "share" }, vannaScale: { status: "agree", ratio: 1, n: 5 } };
  const out = variation(cardVariationInput(base, { expiries: rows }), opts);
  eq(out.status, "ok", "a full card builds");
  eq(out.gammaSource, "book", "and its gamma channel is the open-interest book");
  const a = out.channels.gamma.perSigma, b = out.channels.vanna.perSigma, rho = out.inputs.rho;
  const V = a * a + b * b + 2 * a * b * rho;
  rel(out.variance.sd, Math.sqrt(V), 1e-6, "the sd is the square root of a² + b² + 2abρ");
  const sh = out.variance.shares;
  near(sh.gamma + sh.vanna + sh.cross, 1, 1e-5, "and the three shares sum to one");
  ok(Math.abs(rho) > 0.1, `on a series with a real spot-vol correlation (${rho})`);

  ok(!/explains/.test(out.lead.say), "the lead calls the shares shares, never 'explains', which a share above one would make false");
  const offsetCase = JSON.parse(JSON.stringify(base));
  offsetCase.panels.volContext.ivRank.rows = ivRows(SESSION, 40, { rho: -0.95 });
  const oc = variation(cardVariationInput(offsetCase, { expiries: rows }), opts);
  const ab = oc.channels.gamma.perSigma * oc.channels.vanna.perSigma * oc.inputs.rho;
  ok(ab < 0 && oc.variance.shares.cross < 0, `a strongly negative spot-vol link makes the cross share negative (${oc.variance.shares.cross})`);
  ok(/offset each other, so the parts exceed the whole/.test(oc.lead.say),
     `and the lead says the two channels offset rather than letting a share read as more than all of it (${oc.lead.say.slice(-120)})`);
  ok(!/offset each other/.test(out.lead.say) || out.variance.shares.cross < 0, "and says it only when the cross term is below zero");

  const flat = JSON.parse(JSON.stringify(base));
  flat.panels.volContext.ivRank.rows = ivRows(SESSION, 40, { rho: 0 });
  const f = variation(cardVariationInput(flat, { expiries: rows }), opts);
  near(f.inputs.rho, 0, 1e-9, "a series built with no spot-vol link measures ρ = 0");
  near(f.variance.shares.cross, 0, 1e-9, "and the cross share is then zero");

  const thin = JSON.parse(JSON.stringify(base));
  thin.panels.volContext.ivRank.rows = ivRows(SESSION, 4, { rho: -0.5 });
  const t = variation(cardVariationInput(thin, { expiries: rows }), opts);
  eq(t.variance.shares.vanna, null, "three changes give a vanna share of null, not zero");
  eq(t.variance.shares.cross, null, "and a cross share of null");
  near(t.variance.shares.gamma, 1, 1e-9, "the variance is gamma's alone");
  const why = t.silences.find((s) => s.channel === "vannaSize");
  ok(why && /3 daily implied-volatility changes/.test(why.reason), `and the reason names the count (${why && why.reason})`);
  ok(/too few to say how large a typical vol move is/.test(t.lead.say), "the lead says why the vol size is missing");

  const noSigma = JSON.parse(JSON.stringify(base));
  noSigma.panels.context = { status: "ok", candles: candlesFor(SESSION, 10) };
  const ns = variation(cardVariationInput(noSigma, { expiries: rows }), opts);
  eq(ns.status, "unavailable", "no GARCH level and too few closes silences the model");
  ok(!("gammaPerSigma" in ns) && !("grid" in ns), "with no number standing in for the missing sigma");
  ok(/no converged GARCH level and no realized volatility/.test(ns.reason), `and says why (${ns.reason})`);

  const noGamma = JSON.parse(JSON.stringify(base));
  noGamma.regime = {};
  const ng = variation(cardVariationInput(noGamma, { expiries: rows.map((r) => ({ ...r, call_gex: null, put_gex: null })) }), opts);
  eq(ng.status, "unavailable", "no book and no flow ladder is an unavailable panel");
  eq(ng.silences[0].code, "no-gamma", "coded so a board row can say why");

  eq(out.grid.cells.length * out.grid.cells[0].length, 15, "the grid holds 5 × 3 = 15 cells");
  ok(out.channels.gamma.perSigma > 0, "this book is long gamma");
  const up = out.grid.cells[3][1], origin = out.grid.cells[2][1];
  ok(up.flow - origin.flow < 0, "so a one-sigma rise has dealers sell: the kS = +1 cell sits below the origin");
  const longOnly = variation(cardVariationInput(base, { expiries: rows }), { ...opts, kc: { status: "unavailable" } });
  ok(longOnly.grid.cells[3][1].flow < 0, "and with no charm term the +1σ flow is negative outright");
  ok(out.inputs.charmNet < 0, "this book's charm nets below zero");
  ok(origin.flow > 0, "so at the origin time alone has dealers buy");
  eq(t.grid.cells.flat().filter((c) => c === null).length, 10,
     "with the vol size silent, the ten kV ≠ 0 cells are null");
  ok(t.grid.cells.every((row) => row[1] !== null), "and the kV = 0 column stands");
  ok(out.grid.rows.every((r) => r.linear === Math.abs(r.kS * out.inputs.sigmaDaily) >= VARIATION_LINES.LINEAR_MOVE),
     "rows five percent or more from spot are flagged as a linear approximation");

  const late = JSON.parse(JSON.stringify(base));
  late.panels.context.candles.push([addDays(SESSION, 1), 300, 320, 280, 310, 9e9]);
  const l = variation(cardVariationInput(late, { expiries: rows }), opts);
  eq(l.inputs.adv, out.inputs.adv, "a candle after the session does not move the typical day");
  eq(l.inputs.sigmaDaily, out.inputs.sigmaDaily, "nor the spot sigma");
  eq(typicalDollarVolume(late.panels.context.candles, null).adv > out.inputs.adv, true,
     "while an uncut series would have been moved by it — the cut is what holds");

  const lateIv = JSON.parse(JSON.stringify(base));
  lateIv.panels.volContext.ivRank.rows.unshift({ date: addDays(SESSION, 1), vol: 2, close: 999 });
  eq(volOfVol(lateIv.panels.volContext.ivRank.rows, SESSION).sigmaV,
     volOfVol(base.panels.volContext.ivRank.rows, SESSION).sigmaV,
     "an implied-volatility row dated after the session is dropped before the changes are taken");

  const garchLate = sessionSigma({ garch: { status: "ok", dist: "skewt", converged: true, nextVol: 40, dates: [addDays(SESSION, 1)] },
    candles: base.panels.context.candles, sessionDate: SESSION });
  eq(garchLate.source, "realized", "a GARCH fit whose window runs past the session is refused for the realized series");
  const garchOk = sessionSigma({ garch: { status: "ok", dist: "skewt", converged: true, nextVol: 40, dates: [SESSION] },
    candles: base.panels.context.candles, sessionDate: SESSION });
  eq(garchOk.source, "garch", "one that ends at the session is used");
  near(garchOk.daily, 0.4 / Math.sqrt(252), 1e-6, "at nextVol / 100 / √252");

  const noBook = variation(cardVariationInput(base), opts);
  eq(noBook.gammaSource, "flow", "a card with no expiry ladder falls back to the gamma added today");
  eq(noBook.variance, null, "and draws no share of variance");
  eq(noBook.grid, null, "and no scenario grid");
  eq(noBook.robustness.r, 1, "graded weak");
  ok(!/time alone moves/.test(noBook.lead.say), "with no drift framing in its lead");

  const summary = variationSummary(out);
  near(summary.gammaPerSigmaPctAdv, out.channels.gamma.pctAdv, 0, "the board summary carries the gamma share of a day");
  eq(summary.driftInSd, out.variance.driftInSd, "and the drift in sd");
  const flowSummary = variationSummary(noBook);
  eq(flowSummary.driftInSd, null, "a flow-only card has no drift");
  eq(flowSummary.why.driftInSd, "no-book", "and says why in a code");
  ok(Object.values(flowSummary.why).every((code) => Object.hasOwn(VARIATION_CODES, code)),
     "every code a row can carry is spelled out in the published code table");

  eq(JSON.stringify(variation(cardVariationInput(base, { expiries: rows }), opts)),
     JSON.stringify(out), "two builds from the same inputs are byte-identical");

  const leadNums = new Set(Object.values(out.lead.n).map(String));
  for (const lit of out.lead.say.match(/-?\d+(?:\.\d+)?/g) || []) {
    ok(leadNums.has(lit) || leadNums.has(String(Number(lit))), `"${lit}" in the lead is pinned in n`);
  }
}

function ivRows(end, n, { rho = 0 } = {}) {
  let t = Date.parse(end + "T00:00:00Z");
  const days = [];
  while (days.length < n) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(t).toISOString().slice(0, 10));
    t -= 86400000;
  }
  days.reverse();
  const dv = days.slice(1).map((_, i) => 0.01 * (Math.sin(i * 1.7) + Math.cos(i * 0.37)));
  const w = days.slice(1).map((_, i) => 0.01 * (Math.sin(i * 2.9 + 1) - Math.cos(i * 1.13)));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const mdv = mean(dv), mw = mean(w);
  const cdv = dv.map((v) => v - mdv), cw = w.map((v) => v - mw);
  const dot = cw.reduce((a, v, i) => a + v * cdv[i], 0);
  const nn = cdv.reduce((a, v) => a + v * v, 0);
  const ortho = cw.map((v, i) => v - (nn > 0 ? dot / nn : 0) * cdv[i]);
  const ret = ortho.map((v, i) => 2 * (rho * cdv[i] + Math.sqrt(1 - rho * rho) * v));
  const out = [];
  let vol = 0.3, close = 100;
  days.forEach((d, i) => {
    if (i > 0) { vol += dv[i - 1]; close *= Math.exp(ret[i - 1]); }
    out.push({ date: d, vol, close });
  });
  return out.reverse();
}

{
  const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-variation-cards.json"), "utf8"));
  const opts = { probe: { call: "raw", put: "raw" }, kc: { status: "ok", value: 50, n: 326, iqrRatio: 0.22 },
    unit: { family: "share", used: "share" }, vannaScale: { status: "agree", ratio: 1, n: 5 } };
  const GOLD = {
    B: { sigma: 0.023301, sigmaDollars: 1.0073, adv: 380.7e6, a: 376.6e3, v: 3.834e6, c: -2.000e6, vAdv: 0.0101, cAdv: -0.00525, seen: 15 },
    CHTR: { sigma: 0.03999, sigmaDollars: 4.936, adv: 332.5e6, a: -1.386e6, v: 1.964e6, c: -497.5e3, vAdv: 0.0059, cAdv: -0.0015, seen: 14 },
  };
  for (const [t, g] of Object.entries(GOLD)) {
    const card = fixtures[t];
    ok(card.panels.context.candles.some((c) => c[0] > card.sessionDate),
       `${t}: the live card carries a bar dated after its session (${card.panels.context.candles.slice(-1)[0][0]}), which the model must cut`);
    const out = variation(cardVariationInput(card), opts);
    rel(out.inputs.sigmaDaily, g.sigma, 0.005, `${t}: the spot sigma from 21 returns cut at the session`);
    eq(out.inputs.sigmaSource, "realized", `${t}: the GARCH on this snapshot ran past the session and has no skewed-t, so sigma is realized`);
    rel(out.inputs.sigmaDollars, g.sigmaDollars, 0.005, `${t}: one sigma in dollars`);
    rel(out.inputs.adv, g.adv, 0.005, `${t}: the typical day from 20 sessions cut at the session`);
    rel(out.channels.gamma.perSigma, g.a, 0.005, `${t}: gamma per one-sigma move on the day's flow`);
    rel(out.channels.vanna.perPoint, g.v, 0.005, `${t}: vanna per vol point, netted call − put over the drawn expiries`);
    rel(out.channels.charm.perSession, g.c, 0.005, `${t}: charm over one session at K_c = 50`);
    rel(out.channels.vanna.pctAdvPerPoint, g.vAdv, 0.02, `${t}: vanna as a share of the day`);
    rel(out.channels.charm.pctAdv, g.cAdv, 0.02, `${t}: charm as a share of the day`);
    eq(out.gammaSource, "flow", `${t}: the snapshot carries no open-interest book`);
    eq(out.variance, null, `${t}: so no variance shares are published`);
    eq(out.driftInSd, null, `${t}: and no drift in sd`);
    ok(out.silences.some((s) => s.code === "no-book"), `${t}: and the silence is named`);
    ok(out.silences.some((s) => s.channel === "vannaSize" && /3 daily/.test(s.reason)),
       `${t}: three implied-volatility changes, too few for a vol-of-vol`);
    const fallback = cardNets(card, { h: 1 });
    eq(fallback.fallback.vanna.drawn, 12, `${t}: the fallback sums the 12 drawn expiries`);
    eq(fallback.fallback.vanna.seen, g.seen, `${t}: of the ${g.seen} the vendor published`);
    ok(out.conventions.nets.includes(`12 of ${g.seen} expiries`), `${t}: and says so (${out.conventions.nets})`);
    const stated = card.panels.charm.rows.reduce((s, r) => s + (r.call ?? 0) + (r.put ?? 0), 0);
    const netted = card.panels.charm.rows.reduce((s, r) => s + (r.call ?? 0) - (r.put ?? 0), 0);
    if (t === "CHTR") rel(stated / netted, 5.568, 0.01, "CHTR: the old stated convention would have misstated charm 5.57-fold");
  }
}

{
  const n = 60;
  const col = (f) => Array.from({ length: n }, (_, i) => f(i));
  const cols = {
    fDelta: col((i) => Math.sin(i)), fTilt: col((i) => Math.cos(i * 1.3)), fNet: col((i) => Math.sin(i * 0.7) * 0.5),
    fOi: col((i) => ((i * 37) % 11) / 5 - 1), fVol: col((i) => Math.cos(i * 2.1)), pDisp: col((i) => Math.sin(i * 0.2)),
    dPath: col((i) => ((i * 13) % 7) / 3 - 1),
  };
  const fam = { fDelta: "F", fTilt: "F", fNet: "F", fOi: "F", fVol: "F", pDisp: "P", dPath: "D" };
  const weights = { F: 2.1, D: 0.9 };
  const gate = col((i) => 0.4 + ((i * 7) % 9) / 6);
  const liveF = 5;
  const blended = col((i) => (weights.F / 3) / liveF * (cols.fDelta[i] + cols.fTilt[i] + cols.fNet[i] + cols.fOi[i] + cols.fVol[i]) +
    (weights.D / 3) * cols.dPath[i]);
  const composite = blended.map((b, i) => b * gate[i]);
  const caps = col((i) => Math.log(1e9 * (1 + (i % 10))));
  const sectors = col((i) => ["A", "B", "C", "D"][i % 4]);
  const residual = neutralize(composite, { numeric: [caps], groups: sectors });
  const sv = scoreVarianceShares(cols, weights, gate, residual, { families: fam });
  const total = Object.entries(sv.columns).reduce((s, [, v]) => s + v, 0);
  near(total, 1, 1e-5, "the columns and the gate account for the residual's whole variance");
  eq(sv.columns.pDisp, 0, "a column outside the blend carries no share");
  near(sv.families.F + sv.families.D + sv.families.P + sv.gate, 1, 1e-5, "and so do the families with the gate");
  ok(/residual/.test(sv.basis) && /blended/.test(sv.blended.basis), "each set of shares names what it is a share of");
  near(sv.blended.families.F + sv.blended.families.D, 1, 1e-5, "the blended shares sum to one on their own basis");
}

{
  eq(nextSessionAfter("2026-09-18").h, 3, "a Friday session is three calendar days from the next");
  eq(nextSessionAfter("2026-09-21").h, 1, "a Monday is one");
  const rows = [
    { expiry: SESSION, call_gex: 50, put_gex: -40, call_vanna: 5, put_vanna: 1, call_charm: -2, put_charm: -1,
      call_delta: 100, put_delta: -80 },
    { expiry: addDays(SESSION, 4), call_gex: 30, put_gex: -20, call_vanna: 5, put_vanna: 1, call_charm: -2, put_charm: -1,
      call_delta: 60, put_delta: -30, dte: 3 },
  ];
  const cal = gammaDecayCalendar(rows, { asOf: SESSION });
  eq(cal.schedule[0].expiry, addDays(SESSION, 4), "an expiry that expired at the session's close does not lead the roll-off");
  eq(cal.frontLoad, 1, "and it takes no share of it");
  const vanna = greekTermStructure(rows, { name: "vanna", callLeg: callVannaLeg, putLeg: putVannaLeg, asOf: SESSION });
  eq(vanna.rows.length, 1, "nor a row of the vanna ladder");
  eq(vanna.expired, 1, "which counts what it dropped");
  eq(vanna.rows[0].dte, 4, "and counts days from the session, not the vendor's own dte of 3");
  eq(vanna.rows[0].dealer, 4, "each expiry carries its dealer net, call − put");
  eq(vanna.signConvention, SIGN_CONVENTION, "and the corrected convention");
  const charm = greekTermStructure(rows, { name: "charm", callLeg: callCharmLeg, putLeg: putCharmLeg, asOf: SESSION });
  eq(charm.rows[0].dealer, -1, "charm nets call − put as well");
  const book = openInterestGammaBook(rows, { asOf: SESSION });
  eq(book.net, 10, "the open-interest gamma book sums call + put over live expiries only");
  eq(book.gross, 50, "against a gross of |call| + |put|");
  const nets = dealerNets(rows, { asOf: SESSION, h: 1 });
  eq(nets.rollOff.expiries, 1, "the lapsed expiry is reported as roll-off context");
  eq(nets.rollOff.delta, 180, "its delta netted call − put, with no flow sign attached");
  eq(nets.charm, -1, "the four-day expiry's charm nets call \u2212 put; the lapsed one contributes nothing");
  const front = dealerNets([{ ...rows[1], expiry: addDays(SESSION, 1) }], { asOf: SESSION, h: 1 });
  eq(front.charm, null, "an expiry that closes at the next session is held out of the charm drift");
  eq(front.charmFront.expiries, 1, "and reported beside it, since charm is far from linear in an option's last day");
  eq(strikeBookPutSign([[{ put_gamma_oi: -3 }, { put_gamma_oi: -1 }, { put_gamma_oi: 0 }]]).sign, 1,
     "put_gamma_oi below zero on every non-zero row reads as dealer-signed");
  eq(strikeBookPutSign([[{ put_gamma_oi: -3 }, { put_gamma_oi: 4 }]]).sign, null, "and a mix builds no strike book");
}

console.log(`✓ flows-variation: ${checks} assertions — Black-Scholes vendor rows netted call + put for gamma and call − put for delta, vanna and charm to nine digits, a |charm|-weighted convention probe that reads a live-like book raw and a half-and-half one as nothing, a charm scale recovered where the rate term allows, a unit probe that refuses to classify cheap stocks, a vanna scale checked against the chain, a variance whose shares sum to one and fall silent as null rather than zero, a 15-cell grid with the right signs, candles and implied-volatility rows after the session ignored, golden B and CHTR readings from their own cut series, and a score decomposition that accounts for the residual whole`);
