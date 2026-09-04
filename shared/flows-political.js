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
  /* 24, DOWN FROM 60, AND THE REASON IS THE RENDERED PAGE. At 60 the
     newest-disclosures table stood three times taller than both ranked
     panels combined, so the surface answering "who bought the most" was
     buried under the tape that merely lists what came in. The ranking is
     what this page is for; the raw filings are context beneath it. What the
     cap removes is counted and published as `shed`, so the reader is told
     the window held more rather than being shown a shorter list silently. */
  recent: 24,
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
    "The filing states a date, a side, a security and a dollar RANGE — never " +
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
  listed:
    "A filing need not name a listed security. Treasury bills, funds and " +
    "partnership interests carry no ticker, and their disclosed size was being " +
    "summed into a filer's total beside a name count of zero while the panel " +
    "ranking securities — which needs a ticker — excluded the same money. Each " +
    "filer's total is now split into the part that named a listed security and " +
    "the part that did not, so the two panels reconcile and a filer who " +
    "disclosed no equity at all reports no name count rather than a count of " +
    "zero.",
  breadth:
    "Size is the weakest thing this data knows. One account's large purchase " +
    "of a single name outranks five separate filers converging on another, " +
    "because the ranking is by dollars and dollars are what a band midpoint " +
    "estimates. The clusters block orders the same aggregates by the number of " +
    "DISTINCT filers instead, with a stated floor, and applies no weighting: " +
    "each key breaks ties in the one before it, so nothing here is a composite " +
    "nobody can argue with.",
  fresh:
    "The newest filing date the window contains is published, together with how " +
    "many disclosures carry it. That date is what \"new\" means on this page — " +
    "not the session date, because on the ordinary morning nothing at all is " +
    "filed, and marking every row stale against a day with no filings would " +
    "describe the calendar rather than the tape.",
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

/**
 * The numeric-triple spelling of the same fact, folded onto the band shape so
 * that everything downstream — the sums, the carried bounds, the open-ended
 * flag — works on one structure regardless of which endpoint fed it.
 */
export function valueBand(raw) {
  const lo = num(raw.low_value);
  const hi = num(raw.high_value);
  if (lo !== null && hi !== null) {
    return { lo, hi, mid: (lo + hi) / 2, open: false };
  }
  const stated = num(raw.mid_value);
  if (lo !== null || hi !== null) {
    /* One bound and no other: a floor with no ceiling is open-ended, and a
       stated midpoint alongside a missing bound is not evidence of the bound.
       No midpoint is invented here for the same reason parseBand invents
       none for "Over $50,000,000" — these are the largest rows, where a
       guess would move the ranking most. */
    return { lo, hi, mid: null, open: true };
  }
  return { lo: null, hi: null, mid: stated, open: false };
}

/**
 * One disclosure, shaped. Null when it carries no usable identity.
 *
 * `issuer` IS NOT THE COMPANY, AND THIS FILE USED TO SAY IT WAS. The line
 * below read `raw.issuer || raw.asset` on the belief that the two were spellings
 * of one field. They are two different fields on two different schemas, and the
 * vendor's own spec settles it:
 *
 *   Insider Trades Issuer:  "The person who executed the transaction."
 *                           example: spouse        (docs/uw-openapi.yaml:6042)
 *   Politician Trades:      asset: NVIDIA Corporation - Common Stock
 *                           ticker: NVDA           (docs/uw-openapi.yaml:9573)
 *
 * `issuer` takes values like "self", "spouse", "joint" and "not-disclosed" —
 * WHOSE ACCOUNT the trade came from — and it does not appear on the
 * /congress/recent-trades schema at all. Preferring it meant that on every row
 * the live feed happened to carry it, the page printed "joint" or
 * "not-disclosed" beside the ticker in the place a company name belongs. That
 * is not a missing label, it is a wrong one, and it shipped.
 *
 * Both fields are now read for what they are. The executing account is worth
 * keeping — a spouse's trade is a different fact from the member's own — but
 * it is a qualifier on the filing, never its name.
 *
 * TWO WIRE SPELLINGS, ONE ROW. The congress endpoints return `txn_type` with
 * an `amounts` RANGE STRING ("$15,001 - $50,000"); the unusual-trades family
 * returns `transaction_type` with a numeric `low_value`/`mid_value`/
 * `high_value` triple and names the security `asset` (docs/uw-openapi.yaml,
 * "Senate Stock" and "Politician Trades"). Reading only the first spelling
 * would not throw on the second — it would classify every side as null and
 * every band as unparseable, and the ranking would come back CONFIDENTLY
 * EMPTY, which is the failure this repository refuses to ship. Both are read.
 *
 * Where the numeric triple states both bounds, the midpoint is computed from
 * them rather than taken from the vendor's `mid_value`, so that ONE basis —
 * the one SIZE_BASIS publishes — produces every summed number on the page.
 * The vendor's stated midpoint is used only where the bounds are absent, and
 * a lone bound stays open-ended with no midpoint, exactly as a band string
 * reading "Over $50,000,000" does.
 */
export function filingRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const who = str(raw.name) || str(raw.reporter);
  const t = str(raw.ticker);
  if (!who && !t) return null;

  const band = raw.low_value !== undefined || raw.high_value !== undefined
    || raw.mid_value !== undefined
    ? valueBand(raw)
    : parseBand(raw.amounts);
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
    /* THE SECURITY, from the field that names the security. */
    asset: str(raw.asset),
    /* WHOSE ACCOUNT EXECUTED IT — "self", "spouse", "joint", "not-disclosed".
       null when the feed does not carry it, which is most of /recent-trades:
       absent and "not-disclosed" are different facts and only one of them is
       the member declining to say. */
    executedBy: str(raw.issuer) || null,
    side: sideOf(raw.txn_type || raw.transaction_type),
    txnType: str(raw.txn_type) || str(raw.transaction_type),
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
export function rankBuyers(rows, { cap = POLITICAL_CAPS.buyers, latestFiled = null } = {}) {
  /* WHETHER "NEW" CAN BE MEASURED AT ALL ON THIS WINDOW. Decided once, here,
     so every row of one response answers the same way. */
  const freshKnown = typeof latestFiled === "string" && latestFiled !== "";
  const by = new Map();
  for (const r of rows) {
    if (!r || !r.who) continue;
    const key = r.id || r.who;
    let a = by.get(key);
    if (!a) {
      a = {
        who: r.who, id: r.id, memberType: r.memberType,
        boughtMid: 0, boughtLo: 0, boughtHi: 0, openFloor: 0, buys: 0,
        listedMid: 0, otherMid: 0, buysListed: 0, buysOther: 0,
        soldMid: 0, sells: 0, openBands: 0, unclassified: 0,
        ownerKnown: 0, selfFiled: 0, freshBuys: 0,
        tickers: new Set(), lags: [],
      };
      by.set(key, a);
    }
    if (r.t) a.tickers.add(r.t);
    if (r.lagDays !== null) a.lags.push(r.lagDays);
    if (r.openBand) a.openBands++;
    /* WHOSE ACCOUNT, COUNTED RATHER THAN ASSUMED. POLITICAL_NOTES.attribution
       has promised since this module shipped that "the totals report the
       self-filed share", and until now only the holders block — the one feed
       that 422s — actually did. The vendor supplies the executing account on
       the unusual-trades spelling of a filing; where it does not, the share is
       UNKNOWN and is published as null rather than as 100%. */
    if (r.executedBy !== null && r.executedBy !== undefined) {
      a.ownerKnown++;
      if (/self/i.test(r.executedBy)) a.selfFiled++;
    }
    if (r.side === "buy") {
      a.buys++;
      /* LISTED OR NOT, and the split is the whole point of the column.

         A filing that names no ticker is a Treasury bill, a fund, or a
         partnership interest — "US Treas Bills Int Rate 0.000% MAT 8/5/2026"
         is a live example. Its midpoint used to be summed into `bought` while
         the ticker set it could not join stayed empty, so the row published
         two million dollars beside a NAMES count of 0 and the assets panel
         beside it — which requires a ticker — silently excluded the same
         money. Ten of twenty-five live rows read that way.

         The total still ranks the panel, because "who disclosed the largest
         purchases" is a question about purchases and a Treasury purchase is
         one. What changes is that the total is now DECOMPOSED, so a reader can
         see which half of it the equity page beside it can speak to, and the
         two panels reconcile instead of disagreeing in silence. */
      if (r.t) a.buysListed++; else a.buysOther++;
      if (r.filedDate && latestFiled && r.filedDate === latestFiled) a.freshBuys++;
      /* ALL THREE OR NONE, over one population.

         The low, the midpoint and the high are a triple describing the SAME
         set of filings, and lo <= mid <= hi only holds while that is true.
         An open-ended band ("Over $50,000,000") states a floor and no
         ceiling, so it has no midpoint by design — adding its floor to the
         low total while it contributes nothing to the other two produced a
         low that EXCEEDED its own high, which a synthetic run caught before
         any reader could. Such a row is counted in openBands and its floor
         totalled separately in openFloor, so the size held back is published
         rather than dropped. */
      if (r.mid !== null) {
        a.boughtMid += r.mid;
        if (r.t) a.listedMid += r.mid; else a.otherMid += r.mid;
        if (r.lo !== null) a.boughtLo += r.lo;
        if (r.hi !== null) a.boughtHi += r.hi;
      } else if (r.lo !== null) {
        a.openFloor += r.lo;
      }
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
      /* THE SAME TOTAL, SPLIT BY WHETHER A LISTED SECURITY WAS NAMED. Only the
         midpoints split: the low and high bounds stay on the whole, because
         splitting a triple that must satisfy lo <= mid <= hi into two triples
         doubles the ways that invariant can be broken for a column nobody
         asked for. The counts split beside them so the reader can see how many
         filings are behind each half. */
      boughtListed: a.listedMid,
      boughtOther: a.otherMid,
      buysListed: a.buysListed,
      buysOther: a.buysOther,
      sold: a.soldMid, buys: a.buys, sells: a.sells,
      /* NULL, NOT ZERO, WHEN NO FILING NAMED A LISTED SECURITY. A filer whose
         whole disclosure was Treasury bills named no equity, and "0 names"
         beside two million dollars reads as a measurement — a filer who bought
         nothing identifiable — rather than as the truth, which is that this
         page's name column has nothing to say about that money. */
      names: a.tickers.size || null,
      medianLagDays: median(a.lags),
      openBands: a.openBands,
      /* The disclosed floor of the purchases the totals above could not
         include. Zero when there were none. */
      openFloor: a.openFloor,
      unclassified: a.unclassified,
      /* The self-filed share, over the filings whose account the vendor
         stated. Null when it stated none: unknown is not "all their own". */
      ownerKnown: a.ownerKnown,
      selfFiled: a.ownerKnown ? a.selfFiled : null,
      /* Purchases disclosed on the newest filing date in this window.

         A ZERO HERE IS ONLY A MEASUREMENT WHEN THERE IS A DATE TO MEASURE
         AGAINST. With a `latestFiled` in hand, 0 says "this filer disclosed
         nothing that day" — a reading, and the date is published beside it so
         the reader can check what day that was. With none — a window whose
         filings carried no filing date at all, or a caller that did not state
         one — every row's counter is 0 for the same reason nothing was
         compared, and publishing that as a measured zero is the confident zero
         this file already refuses one line above on `names`. Null instead, and
         the renderer draws no mark either way. */
      freshBuys: freshKnown ? a.freshBuys : null,
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

export function rankAssets(rows, { cap = POLITICAL_CAPS.assets, latestFiled = null } = {}) {
  const freshKnown = typeof latestFiled === "string" && latestFiled !== "";
  const by = new Map();
  for (const r of rows) {
    if (!r || !r.t) continue;
    let a = by.get(r.t);
    if (!a) a = { t: r.t, asset: r.asset, boughtMid: 0, boughtLo: 0, boughtHi: 0,
                  openFloor: 0, openBands: 0, ownerKnown: 0, selfFiled: 0, freshBuys: 0,
                  soldMid: 0, buys: 0, sells: 0, who: new Set(), lags: [] }, by.set(r.t, a);
    if (r.who) a.who.add(r.id || r.who);
    if (r.lagDays !== null) a.lags.push(r.lagDays);
    if (r.openBand) a.openBands++;
    /* THE SECURITY'S OWN NAME, PREFERRED OVER WHICHEVER ROW ARRIVED FIRST.
       The aggregate used to keep the description from the first filing for
       this ticker and never look again, so the label a reader saw depended on
       vendor row order and could change between two runs over the same window
       — a non-deterministic string in a byte-identical payload. The first
       NON-NULL description wins now, which is a stated rule rather than an
       accident of ordering. */
    if (a.asset === null || a.asset === undefined) a.asset = r.asset;
    if (r.executedBy !== null && r.executedBy !== undefined) {
      a.ownerKnown++;
      if (/self/i.test(r.executedBy)) a.selfFiled++;
    }
    if (r.side === "buy") {
      a.buys++;
      if (r.filedDate && latestFiled && r.filedDate === latestFiled) a.freshBuys++;
      /* The same all-three-or-none rule the buyer ranking keeps — see there
         for why a floor without a ceiling stays out of the summed triple. */
      if (r.mid !== null) {
        a.boughtMid += r.mid;
        if (r.lo !== null) a.boughtLo += r.lo;
        if (r.hi !== null) a.boughtHi += r.hi;
      } else if (r.lo !== null) {
        a.openFloor += r.lo;
      }
    } else if (r.side === "sell") {
      a.sells++;
      if (r.mid !== null) a.soldMid += r.mid;
    }
  }
  const out = [];
  for (const a of by.values()) {
    if (!a.buys) continue;
    out.push({
      t: a.t, asset: a.asset,
      bought: a.boughtMid, boughtLo: a.boughtLo, boughtHi: a.boughtHi,
      sold: a.soldMid, buys: a.buys, sells: a.sells,
      filers: a.who.size, medianLagDays: median(a.lags),
      openBands: a.openBands, openFloor: a.openFloor,
      ownerKnown: a.ownerKnown,
      selfFiled: a.ownerKnown ? a.selfFiled : null,
      /* Null rather than a confident 0 when no newest date was stated — see
         rankBuyers for the argument; the two rankings answer it identically
         so a reader cannot learn one rule on one panel and the other on the
         next. */
      freshBuys: freshKnown ? a.freshBuys : null,
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

/* ---------- what: ranked by how many filers converged on it ------ */

/**
 * Names that more than one filer disclosed buying, ordered by BREADTH.
 *
 * WHY A THIRD BLOCK AND NOT A THIRD SORT KEY. The two panels above rank by
 * disclosed size, which is the question they were built for and the one the
 * band midpoint can answer. Size is also the WEAKEST thing this dataset knows:
 * one spouse's $3.75M in a single name tops the live ranking on two filings by
 * one filer, while five independent filers converging on one name sits third
 * because it is smaller in dollars. Breadth and freshness are already computed
 * on every aggregate — `filers`, `buys`, `medianLagDays` — and neither had ever
 * ordered anything.
 *
 * THE ORDERING IS NOT A WEIGHTING. Nothing here blends breadth with size into
 * a composite; that would be an invented number nobody could argue with. The
 * order is: distinct filers, then freshness by median lag, then size, then the
 * ticker. Each key is a published column, and every one of them is a tiebreak
 * on the one before, so a reader can reconstruct the ordering by eye.
 *
 * THE FLOOR IS STATED AND IS NOT 2. A pair of filers is the smallest number
 * that can be called convergence at all, and on a market-wide window a great
 * many names collect two by coincidence. Three is the floor this block claims,
 * it is published as `minFilers`, and a window that produces none says so
 * rather than relaxing it to fill the panel.
 */
export function rankClusters(rows, {
  cap = POLITICAL_CAPS.assets, minFilers = 3, latestFiled = null,
} = {}) {
  const ranked = rankAssets(rows, { cap: Infinity, latestFiled });
  const wide = ranked.rows.filter((r) => r.filers >= minFilers);
  wide.sort((x, y) =>
    (y.filers - x.filers) ||
    /* Fresher first, and an unknown lag sorts BEHIND every known one rather
       than ahead of it: a name whose filings carry no transaction date has not
       demonstrated recency, and letting null win a recency tiebreak is the
       same confident-absence defect as ranking it at zero. */
    ((x.medianLagDays === null ? Infinity : x.medianLagDays) -
     (y.medianLagDays === null ? Infinity : y.medianLagDays)) ||
    (y.bought - x.bought) ||
    (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  const seen = wide.length;
  const kept = wide.slice(0, cap);
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap: cap === Infinity ? null : cap, shed: seen - kept.length,
    minFilers,
    /* The population the floor was applied to, so "no clusters" can be told
       apart from "no filings": one is a reading about convergence, the other
       is a reading about the window. */
    namesSeen: ranked.rows.length,
    basis: "ordered by the number of DISTINCT filers who disclosed a purchase, then by " +
      "median disclosure lag, then by summed midpoint. No weighting is applied and no " +
      "composite is computed: each key breaks ties in the one before it.",
  };
}

/**
 * The newest FILING date in a shaped window, or null.
 *
 * WHAT "NEW" MEANS HERE, AND WHY IT IS NOT "TODAY". A subscriber opening this
 * page daily could not tell what had arrived since yesterday: the tape is
 * ordered by filing date and nothing marked the newest one. Marking rows
 * against the session date would be wrong on the ordinary morning when nothing
 * was filed — every row would read as stale with no statement of how stale.
 * The newest date the window actually contains is a measured fact, it is
 * published so the page can NAME it, and a reader comparing it against the
 * payload's own sessionDate learns whether "new" means today or last week.
 */
export function newestFiled(rows) {
  let newest = null;
  for (const r of rows || []) {
    if (!r || !r.filedDate) continue;
    if (newest === null || r.filedDate > newest) newest = r.filedDate;
  }
  return newest;
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
 * The holders feed states min/mid/max as NUMBERS rather than a range string,
 * and names the account owner. Ranked by the vendor's own midpoint.
 *
 * THE NUMBERS ARE NOT DOLLARS. The spec describes all three as "the
 * portfolio's ... share quantity" (docs/uw-openapi.yaml, Portfolio Holder),
 * and its own example — 9 / 76 / 143 — is not a STOCK Act dollar band. Every
 * other number in this module is dollars, so a field called `mid` here would
 * be read as dollars by the first renderer that touched it and printed with a
 * currency mark: the same defect class as the "1352% of its year" scar, where
 * a number outlived the unit it was measured in. The fields are therefore
 * named `minQty/midQty/maxQty`, the unit rides on the block as `qtyUnit`, and
 * that unit says the reading is the VENDOR'S CLAIM rather than a measured
 * fact — this repository has been wrong about this spec five times, so the
 * renderer is told what the documentation says, not what is true.
 *
 * The practical consequence is a refusal: a share count cannot be added to,
 * ranked against, or divided by the dollar bands on the rest of this page.
 */
export const HOLDER_QTY_UNIT =
  "share quantity as the vendor's specification describes it, not dollars — " +
  "so these numbers carry no currency mark and are never summed with, or " +
  "ranked against, the disclosed dollar bands elsewhere on this page";

export function shapeHolders(raw, ticker, { cap = POLITICAL_CAPS.holders } = {}) {
  const rows = [];
  for (const r of unwrapRows(raw)) {
    if (!r || typeof r !== "object") continue;
    const who = str(r.full_name);
    if (!who) continue;
    rows.push({
      t: ticker || null,
      who, id: str(r.id),
      owner: str(r.owner),
      minQty: num(r.min_amount),
      midQty: num(r.mid_amount),
      maxQty: num(r.max_amount),
    });
  }
  rows.sort((a, b) => ((b.midQty ?? -1) - (a.midQty ?? -1))
    || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
  const seen = rows.length;
  const kept = rows.slice(0, cap);
  const withOwner = kept.filter((r) => r.owner !== null).length;
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap, shed: seen - kept.length,
    qtyUnit: HOLDER_QTY_UNIT,
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
    /* THE SAME SILENCE AS ITS NEIGHBOURS. A block that simply went missing
       when the feed failed would render as "measured and empty" on a page
       whose whole discipline is telling those two apart. */
    out.clusters = { status: "unavailable", reason };
    out.recent = { status: "unavailable", reason };
    out.latestFiled = null;
    out.freshFilings = null;
  } else {
    const shaped = [];
    let unusable = 0;
    for (const raw of unwrapRows(f)) {
      const row = filingRow(raw);
      if (row) shaped.push(row); else unusable++;
    }
    /* THE NEWEST DISCLOSURE DATE IN THIS WINDOW, decided once and handed to
       every block, so "new" means the same thing in all three of them. Two
       blocks deriving it separately is two chances for the tape's mark and the
       ranking's count to disagree about the same day. */
    const latestFiled = newestFiled(shaped);
    out.buyers = rankBuyers(shaped, { latestFiled });
    out.assets = rankAssets(shaped, { latestFiled });
    out.clusters = rankClusters(shaped, { latestFiled });
    out.recent = shapeRecent(shaped);
    out.filings = shaped.length;
    out.unusable = unusable;
    out.latestFiled = latestFiled;
    /* How many of the window's filings arrived on that date. A measured zero
       is impossible here — the date came FROM a filing — so this is at least
       1 whenever latestFiled is non-null, and null when no row carried a
       filing date at all. */
    out.freshFilings = latestFiled === null
      ? null
      : shaped.filter((r) => r.filedDate === latestFiled).length;
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
    rows.sort((a, b) => ((b.midQty ?? -1) - (a.midQty ?? -1))
      || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
    const seen = rows.length;
    const kept = rows.slice(0, POLITICAL_CAPS.holders);
    const ownerKnown = kept.filter((r) => r.owner !== null).length;
    out.holders = {
      status: kept.length ? "ok" : "quiet",
      rows: kept, seen, cap: POLITICAL_CAPS.holders, shed: seen - kept.length,
      qtyUnit: HOLDER_QTY_UNIT,
      names: new Set(kept.map((r) => r.t)).size,
      selfFiled: ownerKnown ? kept.filter((r) => /self/i.test(r.owner || "")).length : null,
      ownerKnown,
    };
  } else {
    out.holders = { status: "unavailable", reason: "not fetched" };
  }

  return out;
}
