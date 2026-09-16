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

  recent: 24,
  holders: 40,
});

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

const BAND = /\$?\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|—|to)\s*\$?\s*([\d,]+(?:\.\d+)?)/i;
const OVER = /(?:over|above|more than|\+)\s*\$?\s*([\d,]+(?:\.\d+)?)/i;
const SINGLE = /^\s*\$?\s*([\d,]+(?:\.\d+)?)\s*$/;

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

export function sideOf(txnType) {
  const s = typeof txnType === "string" ? txnType : "";
  if (/sale|sell|sold/i.test(s)) return "sell";
  if (/purchase|buy|bought/i.test(s)) return "buy";
  return null;
}

export function valueBand(raw) {
  const lo = num(raw.low_value);
  const hi = num(raw.high_value);
  if (lo !== null && hi !== null) {
    return { lo, hi, mid: (lo + hi) / 2, open: false };
  }
  const stated = num(raw.mid_value);
  if (lo !== null || hi !== null) {

    return { lo, hi, mid: null, open: true };
  }
  return { lo: null, hi: null, mid: stated, open: false };
}

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

    memberType: raw.member_type === null || raw.member_type === undefined
      ? null : raw.member_type,
    t,

    asset: str(raw.asset),

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

export function rankBuyers(rows, { cap = POLITICAL_CAPS.buyers, latestFiled = null } = {}) {

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

    if (r.executedBy !== null && r.executedBy !== undefined) {
      a.ownerKnown++;
      if (/self/i.test(r.executedBy)) a.selfFiled++;
    }
    if (r.side === "buy") {
      a.buys++;

      if (r.t) a.buysListed++; else a.buysOther++;
      if (r.filedDate && latestFiled && r.filedDate === latestFiled) a.freshBuys++;

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
    if (!a.buys) continue;
    out.push({
      who: a.who, id: a.id, memberType: a.memberType,
      bought: a.boughtMid, boughtLo: a.boughtLo, boughtHi: a.boughtHi,

      boughtListed: a.listedMid,
      boughtOther: a.otherMid,
      buysListed: a.buysListed,
      buysOther: a.buysOther,
      sold: a.soldMid, buys: a.buys, sells: a.sells,

      names: a.tickers.size || null,
      medianLagDays: median(a.lags),
      openBands: a.openBands,

      openFloor: a.openFloor,
      unclassified: a.unclassified,

      ownerKnown: a.ownerKnown,
      selfFiled: a.ownerKnown ? a.selfFiled : null,

      freshBuys: freshKnown ? a.freshBuys : null,
    });
  }

  out.sort((x, y) => (y.bought - x.bought)
    || (x.who < y.who ? -1 : x.who > y.who ? 1 : 0));
  const seen = out.length;
  const kept = out.slice(0, cap);
  return {
    status: kept.length ? "ok" : "quiet",
    rows: kept, seen, cap, shed: seen - kept.length, basis: SIZE_BASIS,
  };
}

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

    if (a.asset === null || a.asset === undefined) a.asset = r.asset;
    if (r.executedBy !== null && r.executedBy !== undefined) {
      a.ownerKnown++;
      if (/self/i.test(r.executedBy)) a.selfFiled++;
    }
    if (r.side === "buy") {
      a.buys++;
      if (r.filedDate && latestFiled && r.filedDate === latestFiled) a.freshBuys++;

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

export function rankClusters(rows, {
  cap = POLITICAL_CAPS.assets, minFilers = 3, latestFiled = null,
} = {}) {
  const ranked = rankAssets(rows, { cap: Infinity, latestFiled });
  const wide = ranked.rows.filter((r) => r.filers >= minFilers);
  wide.sort((x, y) =>
    (y.filers - x.filers) ||

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

    namesSeen: ranked.rows.length,
    basis: "ordered by the number of DISTINCT filers who disclosed a purchase, then by " +
      "median disclosure lag, then by summed midpoint. No weighting is applied and no " +
      "composite is computed: each key breaks ties in the one before it.",
  };
}

export function newestFiled(rows) {
  let newest = null;
  for (const r of rows || []) {
    if (!r || !r.filedDate) continue;
    if (newest === null || r.filedDate > newest) newest = r.filedDate;
  }
  return newest;
}

export function shapeRecent(rows, { cap = POLITICAL_CAPS.recent } = {}) {

  const usable = rows.filter((r) => r && (r.who || r.t));
  usable.sort((a, b) => {
    const x = a.filedDate || "", y = b.filedDate || "";
    return (y < x ? -1 : y > x ? 1 : 0) || ((b.mid ?? -1) - (a.mid ?? -1));
  });
  const seen = usable.length;
  const kept = usable.slice(0, cap);
  return { status: kept.length ? "ok" : "quiet", rows: kept, seen, cap, shed: seen - kept.length };
}

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

    selfFiled: withOwner ? kept.filter((r) => /self/i.test(r.owner || "")).length : null,
    ownerKnown: withOwner,
  };
}

export const POLITICAL_FEEDS = Object.freeze(["buyers", "assets", "recent", "holders"]);

export function buildPolitical(raws = {}) {
  const out = { notes: POLITICAL_NOTES };

  const f = raws.filings;
  if (f && typeof f === "object" && !Array.isArray(f) && f.__failed) {
    const reason = String(f.__failed);
    out.buyers = { status: "unavailable", reason };
    out.assets = { status: "unavailable", reason };

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

    const latestFiled = newestFiled(shaped);
    out.buyers = rankBuyers(shaped, { latestFiled });
    out.assets = rankAssets(shaped, { latestFiled });
    out.clusters = rankClusters(shaped, { latestFiled });
    out.recent = shapeRecent(shaped);
    out.filings = shaped.length;
    out.unusable = unusable;
    out.latestFiled = latestFiled;

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
