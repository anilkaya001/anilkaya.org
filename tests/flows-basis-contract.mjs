import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  stateOf, isRegularSession, printOf, offMarket, bracket, fitUnderlying, coherence,
  BASIS_TOLERANCE, FIT_MIN_QUOTES,
} from "../shared/flows-basis.js";
import { rankChain, PRICING_RATE, deskCarry } from "../shared/flows-premium.js";
import { black76 } from "../shared/flows-quant-bs.js";
import { etDayOf, closeUtcMs, yearFraction } from "../shared/flows-quant-time.js";
import * as QC from "../shared/flows-quant-card.js";
import * as ENG from "../shared/flows-quant-engine.js";
import { FLOWS_COOKIE, FLOWS_USERNAMES, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const probe = JSON.parse(readFileSync(new URL("./fixtures-live-probe.json", import.meta.url), "utf8"));
const vol = JSON.parse(readFileSync(new URL("./fixtures-vol-probe.json", import.meta.url), "utf8"));

{
  const real = { data: probe.stockState.row };
  eq(stateOf(real).close, probe.stockState.row.close, "THE VENDOR'S ENVELOPE {data:{...}} IS UNWRAPPED: the real stock-state body is what the audit's parse read as an object with no close");
  eq(stateOf(real).tape_time, probe.stockState.row.tape_time, "with the tape time inside it");
  eq(stateOf(probe.stockState.row).close, probe.stockState.row.close, "a bare object, the shape every earlier mock returned, still reads");
  eq(stateOf(null), null, "null is no state");
  eq(stateOf([]), null, "an array is no state");
  eq(stateOf([{ close: 1 }]), null, "nor is a list of rows");
  eq(stateOf({ data: null }).data, null, "an envelope around nothing is read as itself, so it has no close and no live print");
  eq(stateOf({ data: [1, 2] }).data.length, 2, "an array under data is not a state either");
  eq(stateOf("x"), null, "a string is no state");
  for (const m of ["r", "R", " regular ", "regular"]) eq(isRegularSession(m), true, `"${m}" is the regular session`);
  for (const m of ["pr", "po", "premarket", "postmarket", "", null, undefined, 3, "closed"]) eq(isRegularSession(m), false, `${JSON.stringify(m)} is not`);
}

{
  const readMs = Date.parse("2026-09-24T22:00:00Z");
  const bars = [
    { date: "2026-09-24", market_time: "po", close: "341.20", volume: 90000 },
    { date: "2026-09-24", market_time: "r", close: "340.18", volume: 61000000 },
    { date: "2026-09-24", market_time: "pr", close: "339.10", volume: 40000 },
    { date: "2026-09-23", market_time: "po", close: "338.00" },
    { date: "2026-09-23", market_time: "r", close: "337.50" },
    { date: "2026-09-23", market_time: "pr", close: "336.00" },
  ];
  const state = { data: { close: "341.90", market_time: "postmarket", tape_time: "2026-09-24T21:44:00Z", prev_close: "337.50" } };
  const got = printOf({ state, bars, readMs });
  eq(got.spot, 340.18, "AFTER THE CLOSE the spot is the regular close, not the after-hours print and not the pre-market bar that shares its date");
  eq(got.source, "regular-close", "and the payload says which it took");
  eq(got.note, "regular close 4:00 pm ET", "in words a reader can check");
  eq(got.sessionDate, "2026-09-24", "for the session it belongs to");
  eq(printOf({ state, bars: [...bars].reverse(), readMs }).spot, 340.18, "and the feed's order does not matter: the vendor sends newest first, the fixtures oldest first");

  const morning = printOf({
    state: { data: { close: "339.90", market_time: "premarket", tape_time: "2026-09-25T11:00:00Z" } },
    bars: [{ date: "2026-09-25", market_time: "pr", close: "339.90" }, ...bars], readMs: Date.parse("2026-09-25T12:00:00Z"),
  });
  eq(morning.spot, 340.18, "BEFORE THE OPEN a pre-market bar is not the price either: Thursday's regular close is");
  eq(morning.note, "regular close 4:00 pm ET on 2026-09-24", "and the note names the day it is from");

  const live = printOf({
    state: { data: { close: "343.10", market_time: "regular", tape_time: "2026-09-25T15:30:00Z" } },
    bars, readMs: Date.parse("2026-09-25T15:31:00Z"),
  });
  eq(live.spot, 343.1, "in the regular session the live print is the spot");
  eq(live.source, "stock-state", "and is called one");
  eq(live.sessionDate, "2026-09-25", "dated by its own ET day");
  eq(live.note, "live print, regular session", "and described as one");

  const bare = printOf({ state: { close: "343.10", market_time: "r", tape_time: "2026-09-25 15:30:00+00:00" }, bars: [], readMs: Date.parse("2026-09-25T15:31:00Z") });
  eq(bare.spot, 343.1, "a bare state with the short session token and the legacy tape format reads too");
  eq(bare.sessionDate, "2026-09-25", "the space-separated tape time is parsed");

  const utcNight = printOf({ state: { data: { close: "1", market_time: "regular", tape_time: "2026-12-19T00:30:00Z" } }, bars: [], readMs: Date.parse("2026-12-19T00:31:00Z") });
  eq(utcNight.sessionDate, "2026-12-18", "A TAPE AT 00:30Z ON THE 19TH IS FRIDAY EVENING IN NEW YORK: the session is the 18th, not the UTC date");

  eq(printOf({ state: { data: { close: "343.10", market_time: "postmarket" } }, bars: [{ date: "2026-09-24", market_time: "po", close: "1" }, { date: "2026-09-24", market_time: "pr", close: "2" }], readMs }), null,
     "with nothing but extended-hours bars there is NO spot, not the least bad one");
  eq(printOf({ state: null, bars: [], readMs }), null, "and none at all is none");
  eq(printOf({ state: { data: { close: "0", market_time: "regular" } }, bars: [], readMs }), null, "a zero close is not a price");

  const unstated = printOf({ state: null, bars: [{ date: "2026-09-24", close: "340.18" }, { date: "2026-09-23", close: "337.50" }], readMs });
  eq(unstated.spot, 340.18, "bars that do not state their session are the daily bar of the newest day");
  eq(unstated.source, "daily-bar", "labelled a daily bar");
  eq(unstated.note, "daily bar of 2026-09-24, session not stated", "and the note says the session was not stated");

  const trading = printOf({
    state: null, bars: [{ date: "2026-09-25", market_time: "r", close: "342.00" }], readMs: Date.parse("2026-09-25T17:00:00Z"),
  });
  eq(trading.source, "daily-bar", "today's regular bar while the session is still open is not a close");
  ok(/still trading/.test(trading.note), `and says so (${trading.note})`);

  const half = printOf({ state: null, bars: [{ date: "2026-11-27", market_time: "r", close: "10" }], readMs: Date.parse("2026-11-28T15:00:00Z") });
  eq(half.note, "regular close 1:00 pm ET on 2026-11-27", "the day after Thanksgiving closes at one o'clock and the note says so");

  const mixed = printOf({ state: null, bars: [{ date: "2026-09-24", close: "1.00" }, { date: "2026-09-24", market_time: "r", close: "2.00" }], readMs });
  eq(mixed.spot, 2, "when a day carries both an unstated bar and a stated regular one, the stated one wins");

  const recorded = vol.probes["ohlc-1d:AAPL"];
  ok(recorded && recorded.row.market_time === "pr" && recorded.row.date === "2026-09-23",
     "the recorded vendor row for the newest date IS a pre-market segment, at the head of the list");
  eq(printOf({ state: null, bars: [recorded.row], readMs: Date.parse("2026-09-23T12:00:00Z") }), null,
     "and a chain read priced off it alone has no spot at all");
}

{
  const nine = [
    ["C", 227.5, "260930", 1.47], ["C", 227.5, "261002", 2.77], ["P", 225, "260930", 0.68], ["P", 225, "261002", 1.78],
    ["C", 230, "261002", 1.69], ["C", 230, "260930", 0.56], ["C", 227.5, "261005", 3.25], ["C", 227.5, "261007", 3.85],
    ["C", 227.5, "261009", 4.65],
  ];
  const rows = nine.map(([t, k, e, bid]) => ({
    option_symbol: `NVDA${e}${t}${String(Math.round(k * 1000)).padStart(8, "0")}`,
    nbbo_bid: String(bid), nbbo_ask: (bid + 0.02).toFixed(2), implied_volatility: "0.35", open_interest: "1000", volume: "50",
  }));
  const asOf = "2026-09-29";
  const readMs = Date.parse("2026-09-29T19:00:00Z");
  const PRINT = 231.02;

  const off = offMarket(rows, PRINT, "NVDA");
  deep(off.sort(), ["NVDA260930C00227500", "NVDA260930C00230000", "NVDA261002C00227500", "NVDA261005C00227500"],
    "AT THE SCREENSHOT'S SPOT four of the nine quotes are impossible: their asks are under what exercising them returns");
  eq(offMarket(rows, 227.28, "NVDA").length, 0, "at 227.28 none of them is");

  const br = bracket(rows, PRINT, "NVDA");
  eq(br.bracketed, true, "the request asks the vendor for out-of-the-money contracts only, so the chain brackets its own reference price");
  eq(br.low, 225, "the highest put strike present is 225");
  eq(br.high, 227.5, "and the lowest call strike present is 227.5");
  eq(br.step, 2.5, "on a 2.50 strike ladder");
  eq(br.itm, 7, "seven of the nine quotes are in the money at 231.02");
  eq(br.flagged, true, "which is 3.52 outside the bracket, more than one strike step");
  eq(bracket(rows, 226.5, "NVDA").flagged, false, "a spot inside the bracket is clean");
  eq(bracket(rows, 229.5, "NVDA").flagged, false, "and one within a strike of it is tolerated");
  eq(bracket(rows.filter((r) => /C/.test(r.option_symbol.slice(10))), PRINT, "NVDA").bracketed, false, "a chain with one wing cannot be bracketed, so it is not accused");

  const fit = fitUnderlying({ rows, spot: PRINT, readMs, ticker: "NVDA" });
  eq(fit.ok, true, "the nine bids fit one underlying");
  near(fit.spot, 227.28, 227.28 * 0.001, "and it is 227.28 to within a tenth of a percent, the audit's independent least-squares figure");
  ok(fit.rms < 0.05, `at a residual of ${fit.rms.toFixed(3)} dollars in the price, against the $1.006 the audit found when the spot was pinned at 231.02`);
  eq(fit.quotes, 9, "using all nine quotes, since the three nearest expiries hold fewer than nine");
  for (const h of [0, 3, 6, 10, 15, 19.9]) {
    const g = fitUnderlying({ rows, spot: PRINT, readMs: Date.parse("2026-09-29T00:00:00Z") + h * 3600000, ticker: "NVDA" });
    near(g.spot, 227.28, 0.25, `the answer does not move with the hour of the read (${h}h into the day: ${g.spot.toFixed(3)})`);
  }
  eq(fitUnderlying({ rows, spot: PRINT, readMs, ticker: "NVDA", rate: 0 }).ok, true, "and does not depend on the rate");

  const c = coherence({ rows, spot: PRINT, asOf, printSource: "stock-state", readMs, ticker: "NVDA" });
  eq(c.status, "rebased", "THE NINE BIDS AT 231.02 ARE A REBASED CHAIN");
  near(c.impliedSpot, 227.28, 227.28 * 0.001, "with the implied spot within 0.1% of 227.28");
  eq(c.spot, c.impliedSpot, "and the desk prices at it");
  eq(c.printSpot, PRINT, "while the print is kept beside it");
  eq(c.printSource, "stock-state", "and its source");
  eq(c.offMarket.length, 4, "with the four impossible quotes named");
  ok(Math.abs(c.spot / PRINT - 1) > BASIS_TOLERANCE, "the move is past the tolerance that triggers it");

  const dated = coherence({ rows, spot: PRINT, asOf, printSource: "stock-state", ticker: "NVDA" });
  eq(dated.status, "rebased", "without a read instant the fit runs from the close of the dated day and reaches the same verdict");
  near(dated.impliedSpot, 227.28, 227.28 * 0.001, "and the same spot");

  const after = rankChain(rows, { spot: c.spot, asOf, readMs, ticker: "NVDA" });
  eq(after.priced, 9, "priced at the implied spot every one of the nine survives");
  eq(after.gated.offMarket, 0, "none is off the market");
  for (const p of after.rows) {
    ok(p.ivMid > 0.25 && p.ivMid < 0.4, `${p.type} ${p.strike} ${p.expiry}: volatility ${(p.ivMid * 100).toFixed(1)}% is inside the 25-40% a sensible term structure gives`);
    ok(Math.abs(p.moneyness) < 0.02, `${p.type} ${p.strike}: and the moneyness is within 2% (${(p.moneyness * 100).toFixed(2)}%)`);
  }
  const before = rankChain(rows, { spot: PRINT, asOf, readMs, ticker: "NVDA" });
  eq(before.gated.offMarket, 4, "priced at the print, four are set aside as off the market");
  ok(before.rows.some((p) => p.ivMid < 0.16), "and the survivors carry volatilities of 8 to 15%, the contamination row-level filtering cannot see");
  ok(before.rows.filter((p) => p.type === "C").every((p) => p.annualized < p.annualizedGross),
     "and every surviving in-the-money call is ranked on its time value");

  const engineFor = (spot, p) => {
    const row = { K: p.strike, type: p.type, bid: p.bid, ask: p.ask, oi: p.oi, volume: p.volume, sym: p.symbol, ivSeed: p.iv };
    const fitted = QC.contractFit({ expiry: p.expiry, asOfMs: readMs, spot, rate: null, row });
    if (!fitted) return null;
    const setup = QC.labSetup({ asOfMs: readMs, spot, facts: [], state: null, pLaw: null, event: null, stale: false, books: [{ fit: fitted, rows: [row] }] });
    const legs = p.strategy === "cc" ? [{ type: "S", side: 1, qty: 1 }, { type: "C", K: p.strike, side: -1, qty: 1 }] : [{ type: "P", K: p.strike, side: -1, qty: 1 }];
    return ENG.priceStructure(setup, { family: p.strategy === "cc" ? "covered-call" : "short-put", expiry: p.expiry, legs, basis: "natural" });
  };
  const allRows = (spot) => rows.map((r) => rankChain([r], { spot, asOf, readMs, ticker: "NVDA", gates: { minOi: 0, maxSpread: 1 } }))
    .flatMap((x) => x.rows);
  const blank = allRows(PRINT).filter((p) => engineFor(PRINT, p) === null || engineFor(PRINT, p).prob.popQ === null);
  ok(blank.length + off.length >= 4, `at the print the engine leaves blanks (${blank.length}) beside the four the gate removes: the screenshot's dashes`);
  for (const p of allRows(c.spot)) {
    const e = engineFor(c.spot, p);
    ok(e && e.prob.popQ !== null && e.prob.popQ > 0.4 && e.prob.popQ < 0.9, `${p.type} ${p.strike} ${p.expiry}: the implied chance of profit is a number (${e && e.prob.popQ})`);
    const leg = e.legs.find((l) => l.type !== "S");
    ok(Math.abs(leg.delta) > 0.2 && Math.abs(leg.delta) < 0.6, `${p.type} ${p.strike} ${p.expiry}: with a delta a near-the-money short has (${leg.delta.toFixed(2)})`);
  }

  const wide = coherence({ rows, spot: 227.28, asOf, readMs, ticker: "NVDA" });
  eq(wide.status, "ok", "the same nine quotes against their own spot are coherent");
  eq(wide.spot, 227.28, "and the desk keeps the print it was given");
  eq(wide.offMarket.length, 0, "with nothing off the market");
  const near2 = coherence({ rows, spot: 227.28 * 1.002, asOf, readMs, ticker: "NVDA" });
  eq(near2.status, "ok", "a print 0.2% off is inside the 0.25% tolerance and is left alone");
  eq(coherence({ rows, spot: 227.28 * 1.004, asOf, readMs, ticker: "NVDA" }).status, "rebased", "and 0.4% off is not");
}

{
  const small = [
    { option_symbol: "SML260918P00095000", nbbo_bid: "1.00", nbbo_ask: "1.05", open_interest: "500" },
    { option_symbol: "SML260918C00105000", nbbo_bid: "1.00", nbbo_ask: "1.05", open_interest: "500" },
    { option_symbol: "SML260918C00110000", nbbo_bid: "0.40", nbbo_ask: "0.45", open_interest: "500" },
    { option_symbol: "SML260918P00090000", nbbo_bid: "0.50", nbbo_ask: "0.55", open_interest: "500" },
  ];
  const readMs = Date.parse("2026-08-25T15:00:00Z");
  const fit = fitUnderlying({ rows: small, spot: 100, readMs });
  eq(fit.ok, false, "four quotes are too few to place an underlying");
  ok(/only 4/.test(fit.reason), `and the reason is stated (${fit.reason})`);
  eq(FIT_MIN_QUOTES, 6, "the floor is six");
  const fine = coherence({ rows: small, spot: 100, readMs, ticker: "SML" });
  eq(fine.status, "ok", "a thin but coherent chain is not accused: no evidence against it, no verdict on it");
  eq(fine.impliedSpot, null, "and claims no implied spot");

  const stale = coherence({ rows: small, spot: 112, readMs, ticker: "SML" });
  eq(stale.status, "mismatch", "a thin chain that ALSO contradicts its spot cannot be rebased and is refused");
  eq(stale.spot, 112, "the print is reported as it was");
  ok(stale.offMarket.length >= 2 || stale.bracket.flagged, "on evidence");

  const garbage = [];
  for (const [i, k] of [90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110].entries()) {
    for (const [j, e] of ["260918", "261016"].entries()) {
      const type = k < 100 ? "P" : "C";
      const px = black76(100 * Math.exp(0.04 * (j ? 0.14 : 0.06)), 1, k, 0.3, j ? 0.14 : 0.06, type);
      const f = [0.55, 1.6, 0.8, 1.35, 0.65, 1.5, 0.9][(i * 2 + j) % 7];
      const bid = Math.max(0.05, Math.round(px * f * 100) / 100);
      garbage.push({ option_symbol: `SML${e}${type}${String(k * 1000).padStart(8, "0")}`, nbbo_bid: String(bid), nbbo_ask: (bid + 0.02).toFixed(2), open_interest: "500" });
    }
  }
  const noise = fitUnderlying({ rows: garbage, spot: 100, readMs, ticker: "SML" });
  eq(noise.ok, false, "quotes that are not one market cannot be fitted to one underlying");
  ok(/no single underlying/.test(noise.reason), `and the fit says so instead of returning its least bad guess (${noise.reason})`);
  eq(coherence({ rows: garbage, spot: 100, readMs, ticker: "SML" }).status, "ok",
     "a poor fit with nothing else against the print does not accuse it: the gate rebases on a good fit or refuses on evidence, never on noise");
  const oneWing = small.filter((r) => /C/.test(r.option_symbol.slice(9)));
  const calls = ["260918", "261016"].flatMap((e) => Array.from({ length: 8 }, (_, i) => ({
    option_symbol: `SML${e}C${String((105 + i) * 1000).padStart(8, "0")}`,
    nbbo_bid: String(3 - i * 0.3), nbbo_ask: String(3.05 - i * 0.3), open_interest: "500",
  })));
  const callsOnly = fitUnderlying({ rows: calls, spot: 100, readMs });
  eq(callsOnly.ok, false, "sixteen calls and no puts cannot place the underlying either");
  ok(/all calls/.test(callsOnly.reason), `and it says why (${callsOnly.reason})`);
  eq(oneWing.length, 2, "the fixture's one-wing subset is two calls");
  eq(coherence({ rows: [], spot: 100, readMs }).status, "ok", "an empty chain has nothing to contradict");
  eq(coherence({ rows: null, spot: 100, readMs }).status, "ok", "nor does a missing one");
  eq(coherence({ rows: small, spot: 0, readMs }).status, "ok", "and no spot is not a basis to judge");
}

{
  let seed = 20260930;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const readMs = Date.parse("2026-09-29T15:00:00Z");
  const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const chain = (S, days, sig0, skew, curv, step, noisy) => {
    const rows = [];
    for (const d of days) {
      const expiry = addDays("2026-09-29", d);
      const T = yearFraction(readMs, expiry);
      const base = Math.round(S / step) * step;
      const width = 0.05 + 1.5 * sig0 * Math.sqrt(T);
      for (let i = -80; i <= 80; i++) {
        const K = base + i * step;
        if (K <= 0 || Math.abs(Math.log(K / S)) > width) continue;
        const x = Math.log(K / S);
        const iv = Math.max(0.05, sig0 * Math.pow(30 / Math.max(d, 5), 0.1) + skew * x + curv * x * x + (noisy ? 4 * x ** 3 : 0));
        const type = K < S ? "P" : "C";
        const px = black76(S * Math.exp(PRICING_RATE * T), Math.exp(-PRICING_RATE * T), K, iv, T, type);
        const half = Math.max(0.01, 0.02 * px) / 2;
        let bid = Math.floor((px - half) / 0.01 + 1e-9) * 0.01;
        let ask = bid + Math.max(0.01, Math.round(2 * half / 0.01) * 0.01);
        if (bid < 0.05) continue;
        if (noisy) {
          let f = 1 + gauss() * 0.015;
          if (rnd() < 0.05) f *= 1 + (rnd() * 2 - 1) * 0.12;
          bid = Math.max(0.01, Math.round(bid * f * 100) / 100);
          ask = Math.max(bid + 0.01, Math.round(ask * f * 100) / 100);
        }
        rows.push({
          option_symbol: `TST${expiry.slice(2).replace(/-/g, "")}${type}${String(Math.round(K * 1000)).padStart(8, "0")}`,
          nbbo_bid: bid.toFixed(2), nbbo_ask: ask.toFixed(2), open_interest: "500",
        });
      }
    }
    return rows;
  };
  const spots = [48.3, 97.6, 231.0, 412.7];
  const days = [1, 3, 6, 8, 10, 17, 24, 45];
  for (const noisy of [false, true]) {
    const label = noisy ? "with 1.5% price noise, 5% stale quotes and a cubic smile term" : "on clean quotes";
    const tally = (bias) => {
      const out = { ok: 0, rebased: 0, mismatch: 0, worst: 0 };
      for (let n = 0; n < 16; n++) {
        const S = spots[n % 4];
        const rows = chain(S, days, 0.25 + rnd() * 0.35, -1 + rnd() * 0.95, 0.2 + rnd() * 3, S < 100 ? 0.5 : 2.5, noisy);
        const c = coherence({ rows, spot: S * (1 + bias), readMs, ticker: "TST" });
        out[c.status]++;
        if (c.impliedSpot !== null) out.worst = Math.max(out.worst, Math.abs(c.impliedSpot / S - 1));
      }
      return out;
    };
    const zero = tally(0);
    eq(zero.ok, 16, `a coherent chain at its own spot is left alone, ${label}, across steep skews and curvatures`);
    ok(zero.worst < 0.002, `the implied spot is within ${(zero.worst * 100).toFixed(3)}% of the truth ${label}`);
    for (const bias of [0.004, 0.0165, -0.0165, 0.03]) {
      const t = tally(bias);
      eq(t.rebased, 16, `a print ${(bias * 100).toFixed(2)}% off the chain is rebased, ${label}`);
      ok(t.worst < 0.002, `to within ${(t.worst * 100).toFixed(3)}% of the truth ${label}`);
    }
  }
}

{
  const cpu = () => { const c = process.threadCpuUsage(); return (c.user + c.system) / 1000; };
  const readMs = Date.parse("2026-09-29T15:00:00Z");
  const rows = [];
  const S = 231;
  for (const d of [1, 2, 3, 4, 5, 8, 9, 10, 15, 16, 17, 24, 31, 38, 45, 60]) {
    const expiry = new Date(Date.parse("2026-09-29T00:00:00Z") + d * 864e5).toISOString().slice(0, 10);
    const T = yearFraction(readMs, expiry);
    for (let K = 200; K <= 262; K += 1) {
      const x = Math.log(K / S);
      const type = K < S ? "P" : "C";
      const px = black76(S * Math.exp(0.04 * T), Math.exp(-0.04 * T), K, 0.3 - 0.4 * x + x * x, T, type);
      const bid = Math.max(0.05, Math.floor(px * 98) / 100);
      rows.push({ option_symbol: `TST${expiry.slice(2).replace(/-/g, "")}${type}${String(K * 1000).padStart(8, "0")}`, nbbo_bid: bid.toFixed(2), nbbo_ask: (bid * 1.03 + 0.01).toFixed(2), open_interest: "500" });
    }
  }
  const chain = rows.slice(0, 1000);
  for (let i = 0; i < 5; i++) coherence({ rows: chain, spot: S, readMs, ticker: "TST" });
  const windows = [];
  for (let w = 0; w < 7; w++) {
    const c0 = cpu();
    for (let i = 0; i < 5; i++) coherence({ rows: chain, spot: S, readMs, ticker: "TST" });
    windows.push((cpu() - c0) / 5);
  }
  windows.sort((a, b) => a - b);
  ok(windows[3] < 8, `THE CHECK FITS THE FREE TIER: a 1000-contract chain is judged in ${windows[3].toFixed(2)} ms of CPU at the median, under the 10 ms a request is allowed`);
}

{
  const readMs = Date.parse("2026-09-29T15:00:00Z");
  const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const S = 100, div = 1.5, exT = 8 / 365, sigma = 0.30, r = PRICING_RATE;
  const chain = (days, strikes) => {
    const rows = [];
    for (const d of days) {
      const expiry = addDays("2026-09-29", d);
      const T = yearFraction(readMs, expiry);
      const F = (S - div * Math.exp(-r * exT)) * Math.exp(r * T);
      for (const K of strikes) {
        const type = K < S ? "P" : "C";
        const px = black76(F, Math.exp(-r * T), K, sigma, T, type);
        const half = Math.max(0.01, 0.02 * px) / 2;
        rows.push({
          option_symbol: `TST${expiry.slice(2).replace(/-/g, "")}${type}${String(Math.round(K * 1000)).padStart(8, "0")}`,
          nbbo_bid: (px - half).toFixed(6), nbbo_ask: (px + half).toFixed(6), open_interest: "500", volume: "40",
        });
      }
    }
    return rows;
  };
  const strikes = [85, 90, 92.5, 95, 97.5, 100, 102.5, 105, 107.5, 110, 115];
  const rows = chain([14, 28, 45, 70], strikes);
  const c = coherence({ rows, spot: S, readMs, ticker: "TST" });
  eq(c.status, "rebased", "A DIVIDEND INSIDE THE NEAREST EXPIRY MAKES THE CHAIN A REBASED ONE: the print is 1.5% above the spot the quotes were struck from");
  near(c.spot, S - div * Math.exp(-r * exT), 0.05, "and the rebased spot is the print less the dividend's present value");

  const facts = [{ id: "carry.implied", v: 0.045, u: "frac", g: 3 }];
  eq(deskCarry(facts, c.status), null, "so the desk takes no carry for it: the rebased spot has absorbed it");

  const worst = (ranked) => Math.max(...ranked.rows.map((x) => Math.abs(x.ivMid - sigma)));
  const right = rankChain(rows, { spot: c.spot, asOf: "2026-09-29", readMs, ticker: "TST", limit: 100, gates: { minOi: 0, maxSpread: 1, minPremium: 0 }, carry: deskCarry(facts, c.status) });
  ok(right.rows.length >= 30, `${right.rows.length} lines are priced`);
  ok(worst(right) < 0.001, `ON THE REBASED CHAIN THE WORST MID VOLATILITY IS ${(worst(right) * 100).toFixed(4)} POINTS FROM THE 30% THAT PRICED IT, under the 0.1 point allowed`);
  ok(right.forwards.every((f) => f.method === "rate-only"), "every expiry's forward is the rate alone");

  const doubled = rankChain(rows, { spot: c.spot, asOf: "2026-09-29", readMs, ticker: "TST", limit: 100, gates: { minOi: 0, maxSpread: 1, minPremium: 0 }, carry: 0.045 });
  ok(worst(doubled) > 0.003, `counting the carry again would be ${(worst(doubled) * 100).toFixed(2)} points out, which is what the rebase rule prevents`);
}

const SESSION_SECRET = "basis-session-secret-abcdefghijklmnopqrstuvwxyz";
globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };
const emptyD1 = {
  prepare() {
    const st = { bind: () => st, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) };
    return st;
  },
  batch: async (list) => list.map(() => ({ results: [] })),
};
const worker = (await import("../worker.js?basis=1")).default;
const token = await signFlowsSession(FLOWS_USERNAMES[0], SESSION_SECRET, 3600, sessionEpoch({ SESSION_SECRET }));
const envFor = (extra = {}) => ({
  DB: emptyD1, SESSION_SECRET, UW_API_KEY: "test-key", UW_BASE: "http://uw.test",
  FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }), ...extra,
});

const realFetch = globalThis.fetch;
async function route(path, world, envExtra = {}) {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.href || input.url);
    const ticker = (url.pathname.match(/\/api\/stock\/([^/]+)\//) || [])[1];
    const t = ticker ? decodeURIComponent(ticker) : "";
    const body = world(url, t);
    if (body === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const req = new Request("https://anilkaya.org" + path, {
      headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" },
    });
    const res = await worker.fetch(req, envFor(envExtra), { waitUntil() {} });
    return { res, body: await res.json() };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const AAPL = (expiry) => [
  { option_symbol: `AAPL${expiry}P00170000`, nbbo_bid: "2.50", nbbo_ask: "2.60", implied_volatility: "0.28", open_interest: "1200", volume: "340" },
  { option_symbol: `AAPL${expiry}C00190000`, nbbo_bid: "3.20", nbbo_ask: "3.35", implied_volatility: "0.26", open_interest: "950", volume: "400" },
];
const worldOf = ({ state, bars, chain, info }) => (url) => {
  if (url.pathname.endsWith("/option-contracts")) return { data: chain };
  if (url.pathname.includes("/ohlc/")) return { data: bars };
  if (url.pathname.endsWith("/stock-state")) return state === null ? undefined : state;
  if (url.pathname.endsWith("/info")) return info === undefined ? { data: { next_earnings_date: "2026-12-30", announce_time: "premarket", issue_type: "Common Stock" } } : info;
  return undefined;
};
const BARS = [
  { date: "2026-08-25", market_time: "po", close: "190.00" },
  { date: "2026-08-25", market_time: "r", close: "183.40" },
  { date: "2026-08-25", market_time: "pr", close: "181.00" },
  { date: "2026-08-24", market_time: "po", close: "180.50" },
  { date: "2026-08-24", market_time: "r", close: "180.00" },
];
const NOW = "2026-08-25T18:10:00Z";
const REGULAR = { close: "183.40", prev_close: "179.10", market_time: "regular", tape_time: "2026-08-25T18:06:00Z" };
const chainOf = (state, extra = {}) => route("/api/flows/chain?t=AAPL&refresh=1",
  worldOf({ state, bars: BARS, chain: AAPL("260918"), ...(extra.world || {}) }), { UW_NOW: NOW, ...(extra.env || {}) });

{
  const enveloped = await chainOf({ data: REGULAR });
  eq(enveloped.res.status, 200, "the chain route answers on the vendor's real stock-state envelope");
  eq(enveloped.body.spotSource, "stock-state", "AND USES THE LIVE PRINT IT CONTAINS (the audit's parse read this shape as an object with no close and priced every desk off a daily bar)");
  eq(enveloped.body.spot, 183.4, "at the print");
  eq(enveloped.body.tapeTime, "2026-08-25T18:06:00Z", "with its tape time");
  eq(enveloped.body.marketTime, "regular", "and its session");
  eq(enveloped.body.prevClose, 179.1, "and its previous close");
  eq(enveloped.body.basis.printSource, "stock-state", "the basis names the print's source");
  eq(enveloped.body.basis.status, "ok", "a chain that agrees with its spot is ok");
  eq(enveloped.body.basis.printSpot, 183.4, "with the print in the basis");
  eq(enveloped.body.basis.impliedSpot, null, "and no implied spot, since three quotes place nothing");
  eq(enveloped.body.basis.offMarket, 0, "and no quote off the market");
  eq(enveloped.body.basis.printNote, "live print, regular session", "in words");
  eq(enveloped.body.sessionDate, "2026-08-25", "the session of the price ships for the freshness pill");

  const bare = await chainOf(REGULAR);
  eq(bare.body.spotSource, "stock-state", "a bare state body, the shape every earlier fixture returned, is still read");
  eq(bare.body.spot, 183.4, "to the same price");
  eq(bare.body.tapeTime, "2026-08-25T18:06:00Z", "and tape time");
}

{
  const post = await chainOf({ data: { close: "190.00", prev_close: "180.00", market_time: "postmarket", tape_time: "2026-08-25T21:30:00Z" } },
    { env: { UW_NOW: "2026-08-25T22:00:00Z" } });
  eq(post.body.spot, 183.4, "AFTER HOURS THE SPOT IS THE REGULAR CLOSE, not the 190.00 after-hours print");
  eq(post.body.basis.printSource, "regular-close", "named as one");
  eq(post.body.basis.printNote, "regular close 4:00 pm ET", "in words");
  eq(post.body.spotSource, "daily-close", "the legacy source field says a close");
  eq(post.body.marketTime, "postmarket", "while the vendor's own session name still passes through");
  eq(post.body.basis.printSpot, 183.4, "the print in the basis is the close");

  const pre = await chainOf({ data: { close: "181.00", market_time: "premarket", tape_time: "2026-08-26T11:00:00Z" } },
    { env: { UW_NOW: "2026-08-26T12:00:00Z" } });
  eq(pre.body.spot, 183.4, "BEFORE THE OPEN it is the prior session's regular close, not a pre-market bar");
  eq(pre.body.basis.printNote, "regular close 4:00 pm ET on 2026-08-25", "dated");
  eq(pre.body.asOf, "2026-08-26", "while asOf is the read's own date: the days to expiry count from the morning of the read, not from the bar's session");
  eq(pre.body.sessionDate, "2026-08-25", "and the session of the price it used is the bar's, for the freshness pill");

  const none = await chainOf(null, { world: { bars: [{ date: "2026-08-25", market_time: "po", close: "190" }] } });
  eq(none.res.status, 502, "with no regular-session price at all the route refuses rather than price against an extended-hours bar");
  eq(none.body.error.code, "chain_no_spot", "in the project's error envelope");
}

{
  const winter = await route("/api/flows/chain?t=AAPL&refresh=1", worldOf({
    state: { data: { close: "183.40", market_time: "postmarket", tape_time: "2026-12-19T00:30:00Z" } },
    bars: [{ date: "2026-12-18", market_time: "r", close: "183.40" }, { date: "2026-12-18", market_time: "po", close: "184.10" }],
    chain: [
      { option_symbol: "AAPL261218P00170000", nbbo_bid: "0.50", nbbo_ask: "0.55", implied_volatility: "0.28", open_interest: "1200", volume: "1" },
      { option_symbol: "AAPL261221P00170000", nbbo_bid: "0.90", nbbo_ask: "0.95", implied_volatility: "0.28", open_interest: "1200", volume: "1" },
      { option_symbol: "AAPL261221C00190000", nbbo_bid: "0.90", nbbo_ask: "0.95", implied_volatility: "0.28", open_interest: "1200", volume: "1" },
    ],
  }), { UW_NOW: "2026-12-19T00:30:00Z" });
  eq(winter.body.asOf, "2026-12-18", "A READ AT 00:30Z ON THE 19TH IS FRIDAY EVENING: asOf is the 18th, the ET date of the read, not the UTC date");
  eq(winter.body.gated.unpriceable, 0, "the Friday line is no longer priced at minus one day and dropped as unpriceable");
  eq(winter.body.gated.expiry, 1, "it is an expiring-today line and is set aside as one");
  const monday = winter.body.rows.find((r) => r.expiry === "2026-12-21" && r.type === "P");
  eq(monday.days, 3, "Monday's line is three days out: Friday's date to Monday's");
  const years = (Date.UTC(2026, 11, 21, 21, 0, 0) - Date.parse("2026-12-19T00:30:00Z")) / (365 * 86400000);
  const implied = Math.pow(Math.log(winter.body.spot / monday.breakeven) / (monday.cushionSigmas * monday.ivMid), 2);
  near(implied, years, years * 1e-6, "and its time to expiry runs to 21:00Z, the close in winter, not to 20:00Z");
  eq(closeUtcMs("2026-12-21"), Date.UTC(2026, 11, 21, 21), "which is the module's own winter close");
  eq(closeUtcMs("2026-08-21"), Date.UTC(2026, 7, 21, 20), "and 20:00Z in summer");
  eq(winter.body.generatedAt, "2026-12-19T00:30:00.000Z", "the payload is stamped with the instant of the read");

  const morning = await route("/api/flows/chain?t=AAPL&refresh=1", worldOf({
    state: null,
    bars: [{ date: "2026-08-27", market_time: "r", close: "183.40" }, { date: "2026-08-27", market_time: "po", close: "184.10" }],
    chain: [
      { option_symbol: "AAPL260828P00170000", nbbo_bid: "0.50", nbbo_ask: "0.55", implied_volatility: "0.28", open_interest: "1200", volume: "1" },
      { option_symbol: "AAPL260831P00170000", nbbo_bid: "0.90", nbbo_ask: "0.95", implied_volatility: "0.28", open_interest: "1200", volume: "1" },
    ],
  }), { UW_NOW: "2026-08-28T14:00:00Z" });
  eq(morning.body.asOf, "2026-08-28", "read on the morning of an expiry day with yesterday's bar the newest, the read's date is today's");
  eq(morning.body.gated.expiry, 1, "so the line expiring today is not 1d but an expiring-today line");
  eq(morning.body.rows[0].days, 3, "and the Monday line is three days out, not four");

  const wall = await route("/api/flows/chain?t=AAPL&refresh=1", worldOf({ state: { data: REGULAR }, bars: BARS, chain: AAPL("260918") }), { UW_NOW: undefined });
  const today = etDayOf(Date.now());
  eq(wall.body.asOf, today, "WITHOUT A PIN the read is the wall clock");
  const pinned = await route("/api/flows/chain?t=AAPL&refresh=1", worldOf({ state: { data: REGULAR }, bars: BARS, chain: AAPL("260918") }),
    { UW_NOW: "2001-01-02T15:00:00Z", UW_BASE: undefined });
  eq(pinned.body.asOf, today, "and a pin is ignored unless the vendor origin has been redirected away from production too");

  const hosts = new Set();
  const hostile = await route("/api/flows/chain?t=AAPL&refresh=1", (url, t) => {
    hosts.add(url.host);
    return worldOf({ state: { data: REGULAR }, bars: BARS, chain: AAPL("260918") })(url, t);
  }, { UW_NOW: "2001-01-02T15:00:00Z", UW_BASE: "https://evil.example" });
  deep(Array.from(hosts), ["api.unusualwhales.com"], "a hostile UW_BASE is ignored: the vendor key goes only to the production host");
  eq(hostile.body.asOf, today, "and it does not unlock the pinned read clock");
  const loop = new Set();
  await route("/api/flows/chain?t=AAPL&refresh=1", (url, t) => {
    loop.add(url.host);
    return worldOf({ state: { data: REGULAR }, bars: BARS, chain: AAPL("260918") })(url, t);
  }, { UW_BASE: "http://127.0.0.1:9" });
  deep(Array.from(loop), ["127.0.0.1:9"], "a loopback UW_BASE still redirects the Worker's vendor calls");
}

{
  const brk = (expiry) => [
    { option_symbol: `BRKB${expiry}P00480000`, nbbo_bid: "2.20", nbbo_ask: "2.30", implied_volatility: "0.2", open_interest: "900", volume: "10" },
    { option_symbol: `BRKB${expiry}C00520000`, nbbo_bid: "3.20", nbbo_ask: "3.30", implied_volatility: "0.2", open_interest: "900", volume: "10" },
  ];
  const r = await route("/api/flows/chain?t=BRK.B&refresh=1", worldOf({
    state: { data: { close: "500.00", market_time: "regular", tape_time: "2026-08-25T18:06:00Z" } },
    bars: [{ date: "2026-08-24", market_time: "r", close: "499.00" }], chain: brk("260918"),
  }), { UW_NOW: NOW });
  eq(r.res.status, 200, "a dotted ticker is accepted");
  eq(r.body.priced, 2, "and its dotless option root is matched: BRK.B chains are no longer all gated as adjusted series");
  eq(r.body.gated.nonStandard, 0, "with none counted as nonstandard");
}

{
  const nine = [
    ["C", 227.5, "260930", 1.47], ["C", 227.5, "261002", 2.77], ["P", 225, "260930", 0.68], ["P", 225, "261002", 1.78],
    ["C", 230, "261002", 1.69], ["C", 230, "260930", 0.56], ["C", 227.5, "261005", 3.25], ["C", 227.5, "261007", 3.85],
    ["C", 227.5, "261009", 4.65],
  ];
  const chain = nine.map(([t, k, e, bid]) => ({
    option_symbol: `NVDA${e}${t}${String(Math.round(k * 1000)).padStart(8, "0")}`,
    nbbo_bid: String(bid), nbbo_ask: (bid + 0.02).toFixed(2), implied_volatility: "0.35", open_interest: "1000", volume: "50",
  }));
  const world = (print) => worldOf({
    state: { data: { close: String(print), prev_close: "229.00", market_time: "regular", tape_time: "2026-09-29T19:00:00Z" } },
    bars: [{ date: "2026-09-28", market_time: "r", close: "229.00" }], chain,
    info: { data: { next_earnings_date: "2026-11-19", announce_time: "afterhours", issue_type: "Common Stock" } },
  });
  const r = await route("/api/flows/chain?t=NVDA&refresh=1", world(231.02), { UW_NOW: "2026-09-29T19:00:00Z" });
  eq(r.body.basis.status, "rebased", "THE SCREENSHOT, THROUGH THE ROUTE: nine bids against a 231.02 print come back rebased");
  near(r.body.basis.impliedSpot, 227.28, 227.28 * 0.001, "to 227.28");
  eq(r.body.spot, r.body.basis.spot, "the payload's spot is the spot every column was priced at");
  eq(r.body.basis.printSpot, 231.02, "the print rides beside it");
  eq(r.body.basis.offMarket, 4, "four quotes were off the market at the print");
  eq(r.body.gated.offMarket, 0, "none is at the implied spot");
  eq(r.body.priced, 9, "all nine are priced");
  ok(r.body.rows.every((x) => x.ivMid > 0.25 && x.ivMid < 0.4), "every one with a volatility between 25% and 40%");
  ok(r.body.rows.every((x) => typeof x.intrinsic === "number" && typeof x.extrinsic === "number" && typeof x.annualizedGross === "number"),
     "and with intrinsic, extrinsic and gross annualization beside the annualization");
  eq(r.body.rows.filter((x) => x.crossesEarnings === true).length, 0, "no line here reaches the November report");

  const gone = await route("/api/flows/chain?t=NVDA&refresh=1", worldOf({
    state: { data: { close: "600.00", market_time: "regular", tape_time: "2026-09-29T19:00:00Z" } },
    bars: [{ date: "2026-09-28", market_time: "r", close: "229.00" }], chain,
  }), { UW_NOW: "2026-09-29T19:00:00Z" });
  eq(gone.body.basis.status, "mismatch", "a print 2.6 times the chain's own price is beyond any rebase window and is refused, not chased");
  deep(gone.body.rows, [], "with no rows");
}

{
  const chain = ["260930", "261002"].flatMap((e) => [
    { option_symbol: `NVDA${e}C00227500`, nbbo_bid: "1.47", nbbo_ask: "1.49", implied_volatility: "0.35", open_interest: "1000", volume: "50" },
    { option_symbol: `NVDA${e}C00230000`, nbbo_bid: "0.56", nbbo_ask: "0.58", implied_volatility: "0.35", open_interest: "1000", volume: "50" },
  ]);
  const r = await route("/api/flows/chain?t=NVDA&refresh=1", worldOf({
    state: { data: { close: "231.02", market_time: "regular", tape_time: "2026-09-29T19:00:00Z" } },
    bars: [{ date: "2026-09-28", market_time: "r", close: "229.00" }], chain,
  }), { UW_NOW: "2026-09-29T19:00:00Z" });
  eq(r.res.status, 200, "a chain that contradicts its spot and cannot be rebased is still an answer");
  eq(r.body.basis.status, "mismatch", "with a status that says so");
  deep(r.body.rows, [], "and no rows: no Implied, Real-world or EV is shown on a basis that failed");
  eq(r.body.priced, 0, "nothing is priced");
  eq(r.body.gated.offMarket, 4, "every contract is accounted for under the gate that set it aside");
  eq(r.body.screened, 4, "out of the four the vendor sent");
  eq(r.body.basis.spot, 231.02, "the print is reported as it was");
  eq(r.body.ivSurface.status, "empty", "and no smile is drawn against a spot that does not belong to it");
  ok(/same moment/.test(r.body.ivSurface.reason), `for a stated reason (${r.body.ivSurface.reason})`);
}

{
  const etf = await route("/api/flows/chain?t=SPY&refresh=1", worldOf({
    state: { data: { close: "183.40", market_time: "regular", tape_time: "2026-08-25T18:06:00Z" } },
    bars: BARS, chain: AAPL("260918").map((r) => ({ ...r, option_symbol: r.option_symbol.replace("AAPL", "SPY") })),
    info: { data: { next_earnings_date: null, announce_time: null, issue_type: "ETF" } },
  }), { UW_NOW: NOW });
  ok(etf.body.rows.length > 0 && etf.body.rows.every((r) => r.crossesEarnings === false),
     "AN ETF HAS NO EARNINGS: every line is false, not the unknown mark that read as 'could not be determined'");
  eq(etf.body.earnings.issueType, "ETF", "and the payload says why");

  const stock = await route("/api/flows/chain?t=AAPL&refresh=1", worldOf({
    state: { data: REGULAR }, bars: BARS, chain: AAPL("260918"),
    info: { data: { next_earnings_date: null, announce_time: null, issue_type: "Common Stock" } },
  }), { UW_NOW: NOW });
  ok(stock.body.rows.every((r) => r.crossesEarnings === null), "while a stock with no date stays unknown");

  const past = await route("/api/flows/chain?t=AAPL&refresh=1", worldOf({
    state: { data: REGULAR }, bars: BARS, chain: AAPL("260918"),
    info: { data: { next_earnings_date: "2026-08-01", announce_time: "afterhours", issue_type: "Common Stock" } },
  }), { UW_NOW: NOW });
  ok(past.body.rows.every((r) => r.crossesEarnings === null), "a report dated before the read is not a crossing: it is null");
  eq(past.body.earnings.past, true, "and the payload flags the date as past");
}

{
  const T = yearFraction(Date.parse(NOW), "2026-09-18");
  const F = 500 * Math.exp(PRICING_RATE * T), D = Math.exp(-PRICING_RATE * T);
  const side = (type) => [470, 480, 490, 500, 510, 520, 530].map((K) => {
    const px = black76(F, D, K, 0.24 - 0.0004 * (K - 500), T, type);
    return {
      option_symbol: `BRKB260918${type}${String(K * 1000).padStart(8, "0")}`,
      nbbo_bid: (px - 0.05).toFixed(2), nbbo_ask: (px + 0.05).toFixed(2), implied_volatility: "0.24",
      open_interest: "900", volume: "10", delta: "0.5", gamma: "0.01", theta: "-0.1", vega: "0.5", rho: "0.1",
    };
  });
  const r = await route("/api/flows/strategy?t=BRK.B&expiry=2026-09-18&engine=1", (url, t) => {
    if (url.pathname.endsWith("/stock-state")) return { data: { close: "500.00", market_time: "regular", tape_time: "2026-08-25T18:06:00Z" } };
    if (url.pathname.endsWith("/option-contracts")) return { data: url.searchParams.get("option_type") === "call" ? side("C") : side("P") };
    return undefined;
  }, { UW_NOW: NOW });
  eq(r.res.status, 200, "the strategy lab reads a dotted ticker's expiry");
  eq(r.body.calls.length, 7, "with its seven calls");
  eq(r.body.engine.status, "ok", "AND ITS ENGINE PRICES THEM: the book was filtered on the raw ticker BRK.B against the option root BRKB, and answered that no contract parsed as the ticker's own");
}

{
  const ctx = (state, bars, nowIso) => route("/api/flows/strategy?t=AAPL", (url, t) => {
    if (url.pathname.endsWith("/stock-state")) return t === "SPY" ? { data: { close: "600.00", tape_time: nowIso } } : state === null ? undefined : state;
    if (url.pathname.includes("/ohlc/")) return { data: bars };
    if (url.pathname.endsWith("/info")) return { data: { next_earnings_date: "2026-12-30", announce_time: "premarket", issue_type: "Common Stock", beta: "1.2" } };
    if (url.pathname.endsWith("/expiry-breakdown")) return { data: [{ expires: "2026-09-18", chains: 5, open_interest: 100, volume: 10 }] };
    return undefined;
  }, { UW_NOW: nowIso });
  const live = await ctx({ data: REGULAR }, BARS, NOW);
  eq(live.body.spotSource, "stock-state", "the strategy context reads the real envelope too");
  eq(live.body.spot, 183.4, "at the live print");
  eq(live.body.tapeTime, "2026-08-25T18:06:00Z", "with its tape time");
  eq(live.body.basis.status, "unchecked", "there is no chain in a context read, so its basis says it was not checked");
  eq(live.body.basis.printSource, "stock-state", "but says what the print is");
  eq(live.body.asOf, "2026-08-25", "and dates the session by the print's ET day");
  const post = await ctx({ data: { close: "190.00", market_time: "postmarket", tape_time: "2026-08-25T21:30:00Z" } }, BARS, "2026-08-25T22:00:00Z");
  eq(post.body.spot, 183.4, "after hours the strategy lab's spot is the regular close too");
  eq(post.body.spotSource, "daily-close", "labelled a close");
  eq(post.body.asOf, "2026-08-25", "of that session");
  const utc = await ctx({ data: { close: "183.40", market_time: "regular", tape_time: "2026-12-19T00:30:00Z" } }, BARS, "2026-12-19T00:31:00Z");
  eq(utc.body.asOf, "2026-12-18", "a tape at 00:30Z is dated by its New York day, not by its UTC one");
  const bare = await ctx(REGULAR, BARS, NOW);
  eq(bare.body.spotSource, "stock-state", "and a bare body still reads");
}

console.log(`✓ flows-basis: ${checks} assertions — the vendor's real stock-state envelope, a spot that is only ever a regular-session price, ` +
  `impossible quotes counted and never ranked, a strike bracket the request itself guarantees, one underlying fitted to the nearest expiries ` +
  `(the screenshot's nine bids give 227.28 against a 231.02 print), a rebase past 0.25% and a refusal when the fit is too thin, ` +
  `an ET read date with the winter close, and the whole thing inside the Free tier's CPU`);
