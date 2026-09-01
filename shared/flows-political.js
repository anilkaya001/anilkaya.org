/* =============================================================
   flows-political.js — disclosed political transactions, ranked
   by size.

   WHAT THIS SURFACE IS, AND THE THREE THINGS IT MAY NOT SAY.

   A row here is a STATUTORY DISCLOSURE, not a trade observed on a
   tape. Three consequences govern every number below, and the page
   states all three rather than burying them:

   1. IT IS NOT "NOW". The STOCK Act allows 45 days between a
      transaction and its filing, and late filers routinely exceed
      100. A name topping this ranking today may have transacted
      last week or last quarter. Every row therefore carries its own
      disclosure lag, and every aggregate carries the MEDIAN lag of
      the filings behind it — a ranking whose rows are 80 days old
      is a different object from one whose rows are 3 days old, and
      the reader is owed the difference.

   2. IT IS NOT A FIGURE, IT IS A BAND. Congressional disclosure
      reports a RANGE — "$1,000 - $15,000" — never an amount. Any
      ranking by size is therefore a ranking by a CONVENTION applied
      to bands. This module uses the band midpoint, publishes that
      choice as `basis`, and carries the summed low and high bounds
      beside every midpoint total so a reader can see the width of
      what they are trusting. Two members separated by less than the
      span of their own bands are not ranked apart in any real sense.

   3. IT IS NOT A RETURN, AND NOT A TRACK RECORD. shared/flows-card.js
      refuses those and this module inherits the refusal: a disclosure
      reports an OPENING with no paired closing print, so any
      performance attributed to it is invented. This surface ranks
      DISCLOSED SIZE. It never ranks skill.

      (One half of that refusal's stated reasoning has expired and is
      corrected there: the vendor's current spec gives congress-trader
      both `page` and `date_from`, so a member's history is now
      walkable. The second half — that an opening without a close is
      not a return — is permanent, and is why nothing here computes
      performance even though the history is now reachable.)

   ATTRIBUTION IS NOT COLLAPSED. A filing may cover a spouse's or a
   dependent's account, and treating those as the member's own
   judgement is the classic error this repository already names in
   the card's congress panel. Where the vendor supplies an `owner`
   (the holders feed does), it is carried per row and the aggregates
   report the self-filed share. Where it does not, the payload says
   so rather than assuming.

   FIELD PROVENANCE. Shapes follow docs/uw-openapi.yaml, read
   DEFENSIVELY, because that document is demonstrably wrong here:
   it types `member_type` as a boolean while the shipped card panel
   reads it as a chamber, and it types `is_active` as a string whose
   example is a Bioguide identifier. The pipeline dumps first-row
   keys on any feed that returns rows but shapes to nothing.
   ============================================================= */

/* Absent in, absent out — Number(null) is 0 and a confident zero is the
   house defect. Same idiom as flows-scores.js and flows-pulse.js. */
const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const unwrapRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return [];
};

export const POLITICAL_CAPS = Object.freeze({
  buyers: 25,
  assets: 25,
  recent: 60,
  holders: 40,
});

/** The ranking convention, published beside every total that uses it. */
export const SIZE_BASIS =
  "band midpoint: each disclosure reports a range, and the midpoint of that " +
  "range is summed. The summed low and high bounds are carried beside every " +
  "total so the width of the estimate stays visible.";

export const POLITICAL_NOTES = Object.freeze({
  unit:
    "One row is one statutory disclosure, not a transaction seen on a tape. " +
    "The filing states a date, a side, an issuer and a dollar RANGE — never " +
    "an amount — so every size on this page is an estimate from a band.",
  lag:
    "Disclosure is late by law and later in practice: the STOCK Act allows 45 " +
    "days and late filers routinely exceed 100. Each row carries the days " +
    "between its transaction and its filing, and each ranked total carries the " +
    "median lag of the filings behind it. This page ranks what has been " +
    "disclosed, which is never the same question as what is being done now.",
  size:
    "Ranked by " + SIZE_BASIS + " Two names whose totals differ by less than " +
    "the span of their own bands are not meaningfully ranked apart, and the " +
    "low and high columns are there to make that visible rather than implied.",
  attribution:
    "A filing may cover a spouse's or a dependent's account. Where the vendor " +
    "supplies an owner the rows carry it and the totals report the self-filed " +
    "share; where it does not, this payload says the share is unknown rather " +
    "than assuming the filer transacted for themselves.",
  /* WORDED TO NEED NO EXCEPTION. A refusals note has to name what it
     refuses, which is exactly where the vocabulary scan bites hardest —
     the first draft of this string tripped its own suite twice. The house
     answer is to rephrase until the ban needs no allow-list, not to widen
     the ban's exceptions, so "how a position fared" carries the meaning
     that the forbidden word would have. */
  refusals:
    "A disclosure is an opening with no paired closing print, so nothing here " +
    "measures how any position fared and no such measure is shown. Nothing " +
    "says why anyone transacted, and a ranking by disclosed size is not a " +
    "ranking of conviction, information or judgement.",
});

/* ---------- the band ------------------------------------------- */

const BAND = /\$?\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|—|to)\s*\$?\s*([\d,]+(?:\.\d+)?)/i;
const OVER = /(?:over|above|more than|\+)\s*\$?\s*([\d,]+(?:\.\d+)?)/i;
const SINGLE = /^\s*\$?\s*([\d,]+(?:\.\d+)?)\s*$/;

/**
 * Parse a disclosed amount into its bounds and midpoint.
 *
 * An open-ended band ("Over $50,000,000") has NO midpoint — the upper bound
 * is not stated, so inventing one would put a fabricated number into a sum
 * that is then ranked. Such a row keeps its floor, reports `hi: null`, and is
 * counted in `openEnded` so a total built partly from open bands can say so.
 */
export function parseBand(raw) {
  const s = typeof raw === "string" ? raw : null;
  if (!s) return { lo: null, hi: null, mid: null, open: false };
  const m = BAND.exec(s);
  if (m) {
    const lo = num(m[1].replace(/,/g, ""));
    const hi = num(m[2].replace(/,/g, ""));
    if (lo === null || hi === null) return { lo, hi, mid: null, open: false };
    return { lo, hi, mid: (lo + hi) / 2, open: false };
  }
  const o = OVER.exec(s);
  if (o) {
    const lo = num(o[1].replace(/,/g, ""));
    return { lo, hi: null, mid: null, open: true };
  }
  const one = SINGLE.exec(s);
  if (one) {
    const v = num(one[1].replace(/,/g, ""));
    return { lo: v, hi: v, mid: v, open: false };
  }
  return { lo: null, hi: null, mid: null, open: false };
}

/**
 * The vendor's transaction vocabulary, mapped to a side.
 *
 * The enum carries `Receive` and partial/full sale spellings. `Receive` is a
 * transfer or gift and is NEITHER a purchase nor a sale — classifying it as
 * either would put an acquisition nobody paid for into a ranking of disclosed
 * purchase size. Unclassifiable rows are counted, never coerced.
 */
export function sideOf(txnType) {
  const s = typeof txnType === "string" ? txnType : "";
  if (/sale|sell|sold/i.test(s)) return "sell";
  if (/purchase|buy|bought/i.test(s)) return "buy";
  return null;
}

/** One disclosure, shaped. Null when it carries no usable identity. */
export function filingRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const who = str(raw.name) || str(raw.reporter);
  const t = str(raw.ticker);
  if (!who && !t) return null;

  const band = parseBand(raw.amounts);
  const txn = str(raw.transaction_date);
  const filed = str(raw.filed_at_date);
  const txnMs = txn ? Date.parse(txn + "T00:00:00Z") : NaN;
  const filedMs = filed ? Date.parse(filed + "T00:00:00Z") : NaN;

  return {
    who,
    id: str(raw.politician_id),
    /* Carried verbatim under the vendor's own key name. The spec types this
       as a boolean while the shipped card panel reads it as a chamber; until
       a live row settles it, this surface passes it through and names it for
       what the vendor calls it rather than asserting either reading. */
    memberType: raw.member_type === null || raw.member_type === undefined
      ? null : raw.member_type,
    t,
    issuer: str(raw.issuer),
    side: sideOf(raw.txn_type),
    txnType: str(raw.txn_type),
    lo: band.lo, hi: band.hi, mid: band.mid, openBand: band.open,
    txnDate: txn,
    filedDate: filed,
    lagDays: Number.isFinite(txnMs) && Number.isFinite(filedMs)
      ? Math.round((filedMs - txnMs) / 86400000) : null,
    reporter: str(raw.reporter),
    notes: str(raw.notes),
  };
}

const median = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
};

/* ---------- who: ranked by disclosed purchase size -------------- */

/**
 * Rank filers by summed midpoint of their disclosed PURCHASES.
 *
 * Sales are aggregated too but do not drive the ranking: "who disclosed the
 * largest purchases" and "who disclosed the most activity" are different
 * questions, and mixing them would let a large seller top a list captioned
 * about buying.
 */
export function rankBuyers(rows, { cap = POLITICAL_CAPS.buyers } = {}) {
  const by = new Map();
  for (const r of rows) {
    if (!r || !r.who) continue;
    const key = r.id || r.who;
    let a = by.get(key);
    if (!a) {
      a = {
        who: r.who, id: r.id, memberType: r.memberType,
        boughtMid: 0, boughtLo: 0, boughtHi: 0, buys: 0,
        soldMid: 0, sells: 0, openBands: 0, unclassified: 0,
        tickers: new Set(), lags: [],
      };
      by.set(key, a);
    }
    if (r.t) a.tickers.add(r.t);
    if (r.lagDays !== null) a.lags.push(r.lagDays);
    if (r.openBand) a.openBands++;
    if (r.side === "buy") {
      a.buys++;
      if (r.mid !== null) a.boughtMid += r.mid;
      if (r.lo !== null) a.boughtLo += r.lo;
      if (r.hi !== null) a.boughtHi += r.hi;
    } else if (r.side === "sell") {
      a.sells++;
      if (r.mid !== null) a.soldMid += r.mid;
    } else {
      a.unclassified++;
    }
  }

  const out = [];
  for (const a of by.values()) {
    if (!a.buys) continue;            // a purchase ranking needs a purchase
    out.push({
      who: a.who, id: a.id, memberType: a.memberType,
      bought: a.boughtMid, boughtLo: a.boughtLo, boughtHi: a.boughtHi,
      sold: a.soldMid, buys: a.buys, sells: a.sells,
      names: a.tickers.size,
      medianLagDays: median(a.lags),
      openBands: a.openBands,
      unclassified: a.unclassified,
    });
  }
  /* Total order: size, then name, so one response publishes one byte string. */
  out.sort((x, y) => (y.bought - x.bought)
    || (x.who < y.who ? -1 : x.who > y.who ? 1 : 0));
  const seen = out.length;
  const kept = out.slice(0, cap);
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap, shed: seen - kept.length, basis: SIZE_BASIS,
  };
}

/* ---------- what: ranked by disclosed purchase size -------------- */

export function rankAssets(rows, { cap = POLITICAL_CAPS.assets } = {}) {
  const by = new Map();
  for (const r of rows) {
    if (!r || !r.t) continue;
    let a = by.get(r.t);
    if (!a) a = { t: r.t, issuer: r.issuer, boughtMid: 0, boughtLo: 0, boughtHi: 0,
                  soldMid: 0, buys: 0, sells: 0, who: new Set(), lags: [] }, by.set(r.t, a);
    if (r.who) a.who.add(r.id || r.who);
    if (r.lagDays !== null) a.lags.push(r.lagDays);
    if (r.side === "buy") {
      a.buys++;
      if (r.mid !== null) a.boughtMid += r.mid;
      if (r.lo !== null) a.boughtLo += r.lo;
      if (r.hi !== null) a.boughtHi += r.hi;
    } else if (r.side === "sell") {
      a.sells++;
      if (r.mid !== null) a.soldMid += r.mid;
    }
  }
  const out = [];
  for (const a of by.values()) {
    if (!a.buys) continue;
    out.push({
      t: a.t, issuer: a.issuer,
      bought: a.boughtMid, boughtLo: a.boughtLo, boughtHi: a.boughtHi,
      sold: a.soldMid, buys: a.buys, sells: a.sells,
      filers: a.who.size, medianLagDays: median(a.lags),
    });
  }
  out.sort((x, y) => (y.bought - x.bought) || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  const seen = out.length;
  const kept = out.slice(0, cap);
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap, shed: seen - kept.length, basis: SIZE_BASIS,
  };
}

/* ---------- the filings themselves ------------------------------- */

export function shapeRecent(rows, { cap = POLITICAL_CAPS.recent } = {}) {
  /* Newest DISCLOSURE first, because the filing date is what changed today;
     the transaction date can be months behind and is carried beside it. */
  const usable = rows.filter((r) => r && (r.who || r.t));
  usable.sort((a, b) => {
    const x = a.filedDate || "", y = b.filedDate || "";
    return (y < x ? -1 : y > x ? 1 : 0) || ((b.mid ?? -1) - (a.mid ?? -1));
  });
  const seen = usable.length;
  const kept = usable.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

/* ---------- holders of one name ---------------------------------- */

/**
 * The holders feed is the strongest data on this page: the vendor states
 * min/mid/max as NUMBERS rather than a range string, and names the account
 * owner. Ranked by the vendor's own midpoint.
 */
export function shapeHolders(raw, ticker, { cap = POLITICAL_CAPS.holders } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const who = str(r.full_name);
    const mid = num(r.mid_amount);
    if (!who) continue;
    rows.push({
      t: ticker || null,
      who, id: str(r.id),
      owner: str(r.owner),
      min: num(r.min_amount), mid, max: num(r.max_amount),
    });
  }
  rows.sort((a, b) => ((b.mid ?? -1) - (a.mid ?? -1))
    || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  const withOwner = kept.filter((r) => r.owner !== null).length;
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap, shed: seen - kept.length,
    /* Stated rather than assumed: if the vendor sent no owner on these rows,
       the self-filed share is UNKNOWN, not 100%. */
    selfFiled: withOwner ? kept.filter((r) => /self/i.test(r.owner || "")).length : null,
    ownerKnown: withOwner,
  };
}

/* ---------- the composite ---------------------------------------- */

export const POLITICAL_FEEDS = Object.freeze(["buyers", "assets", "recent", "holders"]);

/**
 * Assemble the published payload. `raws.filings` is the market-wide
 * disclosure feed; `raws.holders` is an array of {ticker, raw} for board
 * names. A feed that failed its fetch arrives as {__failed: reason} and
 * publishes unavailable-with-reason without touching its neighbours.
 */
export function buildPolitical(raws = {}) {
  const out = { notes: POLITICAL_NOTES };

  const f = raws.filings;
  if (f && typeof f === "object" && !Array.isArray(f) && f.__failed) {
    const reason = String(f.__failed);
    out.buyers = { status: "unavailable", reason };
    out.assets = { status: "unavailable", reason };
    out.recent = { status: "unavailable", reason };
  } else {
    const shaped = [];
    let unusable = 0;
    for (const raw of unwrapRows(f)) {
      const row = filingRow(raw);
      if (row) shaped.push(row); else unusable++;
    }
    out.buyers = rankBuyers(shaped);
    out.assets = rankAssets(shaped);
    out.recent = shapeRecent(shaped);
    out.filings = shaped.length;
    out.unusable = unusable;
  }

  const h = raws.holders;
  if (h && typeof h === "object" && !Array.isArray(h) && h.__failed) {
    out.holders = { status: "unavailable", reason: String(h.__failed) };
  } else if (Array.isArray(h)) {
    const rows = [];
    for (const entry of h) {
      if (!entry || !entry.raw) continue;
      for (const r of shapeHolders(entry.raw, entry.ticker).rows) rows.push(r);
    }
    rows.sort((a, b) => ((b.mid ?? -1) - (a.mid ?? -1))
      || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
    const seen = rows.length;
    const kept = rows.slice(0, POLITICAL_CAPS.holders);
    const ownerKnown = kept.filter((r) => r.owner !== null).length;
    out.holders = {
      status: kept.length ? "ok" : "quiet",
      rows: kept, seen, cap: POLITICAL_CAPS.holders, shed: seen - kept.length,
      names: new Set(kept.map((r) => r.t)).size,
      selfFiled: ownerKnown ? kept.filter((r) => /self/i.test(r.owner || "")).length : null,
      ownerKnown,
    };
  } else {
    out.holders = { status: "unavailable", reason: "not fetched" };
  }

  return out;
}
