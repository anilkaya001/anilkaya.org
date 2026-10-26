import { ASK_SHARE_RULE, FLAGS } from "./flows-tape-stats.js";

export const CENTS = 100;

export const CLASSIFIED_FLOOR_CENTS = 25000000;

export const COVERAGE_FLOOR = Object.freeze({ num: 2, den: 5 });

const isInt = Number.isSafeInteger;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export function centsOf(value, { signed = false } = {}) {
  let negative = false;
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    negative = value < 0;
    const abs = Math.abs(value);
    text = String(abs);
    if (/e/i.test(text)) return abs < 1 ? { cents: 0, rounded: abs > 0 } : null;
  } else if (typeof value === "string") {
    text = value.trim();
    if (text.startsWith("-")) { negative = true; text = text.slice(1); }
  } else return null;
  if (negative && !signed) return null;
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const frac = m[2] || "";
  let cents = Number(m[1]) * CENTS + Number((frac + "00").slice(0, 2));
  let rounded = false;
  if (frac.length > 2) {
    const rest = frac.slice(2);
    const lead = rest[0];
    const tail = /[1-9]/.test(rest.slice(1));
    if (lead > "5" || (lead === "5" && tail)) cents += 1;
    else if (lead === "5" && cents % 2 === 1) cents += 1;
    rounded = /[1-9]/.test(rest);
  }
  if (!isInt(cents)) return null;
  return { cents: negative && cents !== 0 ? -cents : cents, rounded };
}

export const WINDOW_REASONS = Object.freeze(["btw", "cross", "leg", "ns"]);

export const PRINT_REASONS = Object.freeze(["mid", "nq", "cross", "leg", "disagree"]);

export const REASON_LABELS = Object.freeze({
  window: Object.freeze({
    btw: "Between the quotes",
    cross: "Window includes a floor trade",
    leg: "Spread package legs",
    ns: "Side not reported",
  }),
  print: Object.freeze({
    mid: "Matched at the midpoint",
    nq: "No valid quote at the print",
    cross: "Crossed between customers",
    leg: "Leg of a spread package",
    disagree: "Side checks disagree",
  }),
});

export const REASON_HOVERS = Object.freeze({
  window: Object.freeze({
    btw: "Traded between the bid and ask, or with no quote: taker unknown.",
    cross: "Has a floor-crossed trade, so the side that initiated is unknown.",
    leg: "Every trade was a multi-leg package leg; a leg price hides the side.",
    ns: "The data provider did not report the ask or bid premium.",
  }),
  print: Object.freeze({
    mid: "Traded at the midpoint of bid and ask, so neither side is shown.",
    nq: "No valid bid and ask existed when this trade printed.",
    cross: "Two customers crossed on the floor; neither side initiated against a quote.",
    leg: "One leg of a multi-leg package; a leg price hides the side.",
    disagree: "Two side checks gave different answers, so neither side is counted.",
  }),
});

const statedSide = (v) => {
  if (v === null || v === undefined) return null;
  return centsOf(v);
};

const windowReason = (row) => {
  if (row.single === false) return "leg";
  if (row.floor === true) return "cross";
  return "btw";
};

export function windowEntry(row) {
  const r = row !== null && typeof row === "object" ? row : {};
  const total = centsOf(r.prem);
  if (total === null) return { ok: false, why: "premium" };
  const ask = statedSide(r.askPrem);
  const bid = statedSide(r.bidPrem);
  const askCents = ask === null ? 0 : ask.cents;
  const bidCents = bid === null ? 0 : bid.cents;
  const rounded = total.rounded || (ask !== null && ask.rounded) || (bid !== null && bid.rounded);
  if (askCents + bidCents > total.cents) return { ok: false, why: "sides", T: total.cents, rounded };
  const T = total.cents;
  if (ask === null || bid === null) {
    return { ok: true, T, A: 0, B: 0, U: T, reason: T > 0 ? "ns" : null, stated: false, rounded };
  }
  const U = T - askCents - bidCents;
  return { ok: true, T, A: askCents, B: bidCents, U, reason: U > 0 ? windowReason(r) : null, stated: true, rounded };
}

export const emptyTotals = () => ({ n: 0, T: 0, A: 0, B: 0, U: { btw: 0, cross: 0, leg: 0, ns: 0 } });

const plus = (a, b) => {
  const s = a + b;
  if (!isInt(s)) throw new RangeError("a premium sum left the safe integers");
  return s;
};

export function addEntry(totals, entry) {
  totals.n += 1;
  totals.T = plus(totals.T, entry.T);
  totals.A = plus(totals.A, entry.A);
  totals.B = plus(totals.B, entry.B);
  if (entry.reason !== null) totals.U[entry.reason] = plus(totals.U[entry.reason], entry.U);
  return totals;
}

export const unsidedTotal = (totals) => totals.U.btw + totals.U.cross + totals.U.leg + totals.U.ns;

export function tally(entries) {
  const totals = emptyTotals();
  const counts = { given: 0, zero: 0, invalid: 0, invalidCents: 0, unreadable: 0, rounded: 0 };
  for (const entry of entries) {
    counts.given += 1;
    if (!entry.ok) {
      if (entry.why === "sides") { counts.invalid += 1; counts.invalidCents = plus(counts.invalidCents, entry.T); }
      else counts.unreadable += 1;
      if (entry.rounded) counts.rounded += 1;
      continue;
    }
    if (entry.rounded) counts.rounded += 1;
    if (entry.T === 0) { counts.zero += 1; continue; }
    addEntry(totals, entry);
  }
  return { totals, counts };
}

const big = (n) => BigInt(n);

const pctNearest = (n, d) => Number((200n * n + d) / (2n * d));

const pctFloor = (n, d) => Number((100n * n) / d);

const pctCeil = (n, d) => Number((100n * n + d - 1n) / d);

export const LEAN_WHY = Object.freeze({
  noPremium: "No premium in this selection",
  noSides: "No premium was stated on an ask or bid side",
  lowCoverage: "Under 40% of premium has a stated side",
  smallClassified: "Under $250k of premium has a stated side",
});

export function leanRead(totals) {
  const T = big(totals.T), A = big(totals.A), B = big(totals.B);
  if (T === 0n) {
    return { share: null, coverage: null, lo: null, hi: null, side: null, why: "noPremium", reason: LEAN_WHY.noPremium, pct: null };
  }
  const sided = A + B;
  const coverage = Number(sided) / Number(T);
  const lo = Number(A) / Number(T);
  const hi = Number(T - B) / Number(T);
  const base = { coverage, lo, hi, pct: { share: null, coverage: pctNearest(sided, T), lo: pctFloor(A, T), hi: pctCeil(T - B, T) } };
  if (sided === 0n) return { ...base, share: null, side: null, why: "noSides", reason: LEAN_WHY.noSides };
  if (5n * sided < 2n * T) return { ...base, share: null, side: null, why: "lowCoverage", reason: LEAN_WHY.lowCoverage };
  if (sided < big(CLASSIFIED_FLOOR_CENTS)) return { ...base, share: null, side: null, why: "smallClassified", reason: LEAN_WHY.smallClassified };
  const share = Number(A) / Number(sided);
  base.pct.share = pctNearest(A, sided);
  const side = 2n * A > T ? "buyers" : 2n * B > T ? "sellers" : "undetermined";
  return { ...base, share, side, why: null, reason: null };
}

const whole = (v) => +(v * 100).toFixed(0);

export function askShareCompat(rows) {
  let ask = 0;
  let bid = 0;
  let prem = 0;
  let any = false;
  for (const row of [].concat(rows || [])) {
    const total = row ? centsOf(row.prem) : null;
    if (total === null || total.cents <= 0) continue;
    const a = row.askPrem === null || row.askPrem === undefined ? null : centsOf(row.askPrem);
    const b = row.bidPrem === null || row.bidPrem === undefined ? null : centsOf(row.bidPrem);
    const T = total.cents / CENTS;
    const x = a === null ? 0 : a.cents / CENTS;
    const y = b === null ? 0 : b.cents / CENTS;
    const k = x + y > T ? T / (x + y) : 1;
    prem += x * k + y * k + Math.max(0, T - (x + y) * k);
    if (a !== null && b !== null) {
      ask += x * k;
      bid += y * k;
      any = true;
    }
  }
  if (!any) return { share: null, classified: null, side: null, lean: null };
  const share = ask + bid > 0 ? ask / (ask + bid) : null;
  const classified = (ask + bid) / prem;
  let side = "thin";
  if (share !== null && whole(classified) >= whole(ASK_SHARE_RULE.classifiedMin)) {
    if (whole(share) >= whole(ASK_SHARE_RULE.askAt)) side = "ask";
    else if (whole(share) <= whole(ASK_SHARE_RULE.bidAt)) side = "bid";
    else side = "mixed";
  }
  return { share, classified, side, lean: side === "ask" || side === "bid" ? side : null };
}

export function printEntry(print) {
  const p = print !== null && typeof print === "object" ? print : {};
  if ((p.flags & FLAGS.canceled) !== 0) return { ok: false, why: "canceled" };
  if ((p.flags & FLAGS.excluded) !== 0) return { ok: false, why: "excluded" };
  const total = centsOf(p.premium);
  if (total === null) return { ok: false, why: "premium" };
  const T = total.cents;
  const make = (A, B, U, reason) => ({ ok: true, T, A, B, U, reason, stated: true, rounded: total.rounded });
  if ((p.flags & FLAGS.multiLeg) !== 0) return make(0, 0, T, "leg");
  if (p.cross === true) return make(0, 0, T, "cross");
  if (p.parity === "disagree") return make(0, 0, T, "disagree");
  if (p.tier === "n") return make(0, 0, T, "nq");
  if (p.tier === "m") return make(0, 0, T, "mid");
  if (p.side > 0) return make(T, 0, 0, null);
  if (p.side < 0) return make(0, T, 0, null);
  return make(0, 0, T, "nq");
}
