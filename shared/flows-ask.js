import { buildBrief, briefStoreFrom, briefAlertsFact, silenceOf, num } from "./flows-brief.js";
import { lastCompletedSession } from "./flows-freshness.js";

function served(store, key) {
  if (!store || typeof store !== "object" || !Object.hasOwn(store, key)) {
    return { status: "pending" };
  }

  if (store[key] === undefined) return { status: "pending" };

  return store[key] === null ? null : store[key];
}

const answered = (p) => (p && typeof p === "object" && p.status !== "pending" ? p : null);

const atOf = (p) => (p && typeof p === "object" && typeof p.generatedAt === "string" &&
  p.generatedAt.trim() !== "" ? p.generatedAt : null);

const PUBLISHED_QUIET = new Set(["quiet", "empty"]);
const PUBLISHED_UNREADABLE = new Set(["unreadable", "unavailable"]);

const NUMERAL_SOURCE = "(?<![\\d.])-?\\d+(?:,\\d+)*(?:\\.\\d+)?";

export function numeralsIn(text) {
  if (typeof text !== "string" || text === "") return [];
  return text.replace(/−/g, "-").match(new RegExp(NUMERAL_SOURCE, "g")) || [];
}

const FORECAST = /\b(will|should|expect(?:ed)?|likely|going to|forecast|predict)\b/i;

const NAME_LIKE = /^[A-Z][A-Za-z0-9.]{0,9}$/;

function addNames(set, v) {
  if (typeof v === "string") {
    if (NAME_LIKE.test(v)) set.add(v.toLowerCase());
    return;
  }
  if (Array.isArray(v)) for (const x of v) addNames(set, x);
}

function keywords(topic, source, n) {
  const set = new Set();
  for (const w of topic || []) set.add(String(w).toLowerCase());
  for (const part of String(source).split(/[:/\-_]/)) if (part) set.add(part.toLowerCase());
  for (const v of Object.values(n || {})) addNames(set, v);
  return [...set];
}

function maker(source, at) {
  return (id, topic, say, n, lead) => {
    const f = { id, topic: keywords(topic, source, n), say, n: n || {}, source, at: at || null };

    if (lead && typeof lead === "object" && Array.isArray(lead.keys) && lead.keys.length) {
      f.lead = lead;
    }
    return f;
  };
}

const all = (...v) => v.every((x) => x !== null);

function marketFacts(p, at) {
  const f = maker("market", at);
  const out = [];
  const b = p.breadth && typeof p.breadth === "object" ? p.breadth : {};
  const prem = p.premium && typeof p.premium === "object" ? p.premium : {};
  const pcr = p.pcr && typeof p.pcr === "object" ? p.pcr : {};
  const vol = p.vol && typeof p.vol === "object" ? p.vol : {};
  const agg = p.aggressor && typeof p.aggressor === "object" ? p.aggressor : {};

  const read = num(p.n), bull = num(b.bull), bear = num(b.bear);
  const flat = num(b.flat), unpriced = num(b.unpriced);
  if (all(read, bull, bear, flat, unpriced)) {
    out.push(f("market/breadth", ["breadth", "bullish", "bearish", "tape", "lean", "names"],
      "Across the " + read + " names this run read, " + bull +
      " leaned bullish on net option premium, " + bear + " leaned bearish, " + flat +
      " were exactly balanced and " + unpriced + " could not be priced at all.",
      { namesRead: read, bullishNames: bull, bearishNames: bear,
        flatNames: flat, unpricedNames: unpriced }));
  }

  const net = num(prem.net), priced = num(prem.priced), one = num(prem.oneLegged);
  if (all(net, priced, one)) {
    out.push(f("market/premium", ["premium", "dollars", "net", "flow", "money"],
      "Net option premium over the " + priced + " names that quoted both legs summed to " +
      net + " US dollars, and " + one + " names quoted one leg only and are counted beside " +
      "that total rather than inside it.",
      { netPremiumUsd: net, pricedNames: priced, oneLeggedNames: one }));
  }

  const share = num(prem.topShare);
  if (all(share, priced) && priced >= 5) {
    out.push(f("market/concentration", ["concentration", "share", "largest", "premium"],
      "The five largest absolute net-premium movements account for " + share +
      " of gross premium, as a ratio, over " + priced + " priced names.",
      { topShareRatio: share, pricedNames: priced }));
  }

  const pv = num(pcr.volume), pvn = num(pcr.quotedVolume);
  const pp = num(pcr.premium), ppn = num(pcr.quotedPremium);
  if (all(pv, pvn, pp, ppn)) {
    out.push(f("market/pcr", ["pcr", "put", "call", "ratio", "puts", "calls"],
      "The put/call ratio is " + pv + " on volume over " + pvn + " names and " + pp +
      " on premium over " + ppn + " names; both are ratios and neither is a count.",
      { pcrVolumeRatio: pv, quotedVolumeNames: pvn,
        pcrPremiumRatio: pp, quotedPremiumNames: ppn }));
  }

  const iv = num(vol.iv30dMedian), ivn = num(vol.iv30dQuoted);
  const rank = num(vol.ivRankMedian), rankn = num(vol.ivRankQuoted);
  if (all(iv, ivn, rank, rankn)) {
    out.push(f("market/vol", ["volatility", "iv", "implied", "rank", "vol"],
      "Median thirty-day implied volatility is " + iv + " over " + ivn +
      " names, and the median IV rank is " + rank + " on a zero-to-one scale over " +
      rankn + " names, never a percentage of a year.",
      { iv30dMedianRatio: iv, iv30dQuotedNames: ivn,
        ivRankMedianRatio: rank, ivRankQuotedNames: rankn }));
  }

  const cl = num(agg.callLift), pl = num(agg.putLift), qn = num(agg.quoted);
  if (all(cl, pl, qn)) {
    out.push(f("market/aggressor", ["aggressor", "lift", "offer", "bid", "ask"],
      "Over the " + qn + " names that quoted both sides, the call lift is " + cl +
      " and the put lift is " + pl + ", each the share of volume that traded at the " +
      "offer as a ratio.",
      { callLiftRatio: cl, putLiftRatio: pl, quotedNames: qn }));
  }
  return out;
}

function moversFacts(p, at) {
  const f = maker("movers", at);
  const out = [];
  const risers = Array.isArray(p.risers) ? p.risers : [];
  const fallers = Array.isArray(p.fallers) ? p.fallers : [];
  const prem = p.premium && typeof p.premium === "object" ? p.premium : {};
  const ranked = num(p.ranked), priced = num(p.priced);

  const up = risers[0] || null, down = fallers[0] || null;
  const upChange = up ? num(up.chg) : null, downChange = down ? num(down.chg) : null;
  if (up && down && up.t && down.t && all(upChange, downChange, ranked)) {

    out.push(f("movers/extremes", ["movers", "risers", "fallers", "move", "change", "gainers"],
      String(up.t) + " led the day's risers at a change ratio of " + upChange +
      " against its prior close and " + String(down.t) + " led the fallers at " +
      downChange + ", over " + ranked + " names that carried a prior close to rank against.",
      { riser: String(up.t), riserChangeRatio: upChange,
        faller: String(down.t), fallerChangeRatio: downChange, rankedNames: ranked }));
  }

  const universe = num(p.universe), cap = num(p.cap);
  const noClose = num(p.unrankedChange), noPremium = num(p.unrankedPremium);
  if (all(universe, cap, ranked, noClose, noPremium)) {
    out.push(f("movers/coverage", ["movers", "universe", "cap", "coverage", "population"],
      "The mover lists are cut from a universe of " + universe + " names and capped at " +
      cap + " rows a side; " + ranked + " names carried a prior close, " + noClose +
      " did not, and " + noPremium + " quoted no premium at all.",
      { universeNames: universe, rowCap: cap, rankedNames: ranked,
        unrankedChangeNames: noClose, unrankedPremiumNames: noPremium }));
  }

  const bulls = Array.isArray(prem.bullish) ? prem.bullish : [];
  const bears = Array.isArray(prem.bearish) ? prem.bearish : [];
  const topBull = bulls[0] || null, topBear = bears[0] || null;
  const bullUsd = topBull ? num(topBull.netPrem) : null;
  const bearUsd = topBear ? num(topBear.netPrem) : null;
  if (topBull && topBear && topBull.t && topBear.t && all(bullUsd, bearUsd, priced)) {
    out.push(f("movers/premium", ["premium", "dollars", "largest", "name", "money"],
      String(topBull.t) + " carried the largest positive net option premium at " + bullUsd +
      " US dollars and " + String(topBear.t) + " the most negative at " + bearUsd +
      " US dollars, over " + priced + " names that quoted both legs.",
      { bullishName: String(topBull.t), bullishNetPremiumUsd: bullUsd,
        bearishName: String(topBear.t), bearishNetPremiumUsd: bearUsd,
        pricedNames: priced }));
  }
  return out;
}

function unusualFacts(p, at) {
  const f = maker("unusual", at);
  const out = [];
  const c = p.contracts && typeof p.contracts === "object" ? p.contracts : {};
  const nm = p.names && typeof p.names === "object" ? p.names : {};

  const shown = num(c.shown), eligible = num(c.eligible);
  const cap = num(c.cap), perName = num(c.perName);
  const bound = typeof c.capBound === "string" && c.capBound ? c.capBound : null;
  if (all(shown, eligible, cap, perName) && bound !== null) {

    out.push(f("unusual/contracts", ["unusual", "contracts", "activity", "feed", "cap"],
      "The unusual-contract feed shows " + shown + " of " + eligible +
      " eligible contracts, capped at " + cap + " rows with at most " + perName +
      " per name, and the cap that bound was " + bound + ".",
      { shownContracts: shown, eligibleContracts: eligible, rowCap: cap,
        perNameCap: perName, capBound: bound }));
  }

  const nShown = num(nm.shown), nRanked = num(nm.ranked);
  const nUniverse = num(nm.universe), nUnranked = num(nm.unranked);
  if (all(nShown, nRanked, nUniverse, nUnranked)) {
    out.push(f("unusual/names", ["unusual", "names", "surprise", "volume", "ranked"],
      nShown + " of " + nRanked + " names ranked on volume surprise are shown, from a " +
      "universe of " + nUniverse + "; " + nUnranked + " carried no measured surprise and " +
      "sit outside the ordering rather than at the bottom of it.",
      { shownNames: nShown, rankedNames: nRanked,
        universeNames: nUniverse, unrankedNames: nUnranked }));
  }

  const seen = num(p.namesSeen), truncated = num(p.namesTruncated);
  if (all(seen, truncated)) {
    out.push(f("unusual/reach", ["unusual", "chains", "truncated", "ceiling", "coverage"],
      "Chains were read for " + seen + " names and " + truncated +
      " of them came back at the vendor's row ceiling, so those contract counts are " +
      "lower bounds rather than totals.",
      { namesRead: seen, namesTruncated: truncated }));
  }
  return out;
}

function newsFacts(p, at) {
  const f = maker("news", at);
  const out = [];
  const kept = num(p.kept), returned = num(p.returned);
  const requested = num(p.requested), cap = num(p.cap);
  if (all(kept, returned, requested, cap)) {
    out.push(f("news/coverage", ["news", "headlines", "tape", "coverage"],
      "The news tape holds " + kept + " headlines of the " + returned +
      " rows the vendor returned against a request for " + requested +
      ", under a cap of " + cap + " rows.",
      { keptHeadlines: kept, returnedRows: returned,
        requestedRows: requested, rowCap: cap }));
  }

  if (p.atVendorLimit === true && all(returned, requested) && returned >= requested) {
    out.push(f("news/ceiling", ["news", "ceiling", "limit", "truncated", "population"],
      "That response came back at the vendor's own limit of " + requested +
      " rows, so the population above it is unknown and at least " + returned + ".",
      { requestedRows: requested, returnedRows: returned }));
  }

  const newest = typeof p.newest === "string" && p.newest ? p.newest : null;
  const oldest = typeof p.oldest === "string" && p.oldest ? p.oldest : null;
  if (newest !== null && oldest !== null) {
    out.push(f("news/window", ["news", "window", "age", "span", "stamps"],
      "The stored headlines span " + oldest + " to " + newest +
      " by the vendor's own stamps.",
      { oldest, newest }));
  }
  return out;
}

function alertFacts(p, at) {
  const f = maker("flowalerts", at);
  const out = [];
  const rows = Array.isArray(p.rows) ? p.rows.length : null;
  const seen = num(p.seen), shed = num(p.shed), cap = num(p.cap);

  const unusable = num(p.unusable);
  if (all(rows, seen, shed, cap)) {
    out.push(f("flowalerts/coverage", ["alerts", "flow", "tape", "coverage", "cap"],
      "The flow-alert page holds " + rows + " of the " + seen + " alerts read, with " +
      shed + " removed by a cap of " + cap + " rows" +
      (unusable === null ? "" : ", beside " + unusable +
        " rows the vendor sent that this page could not read") + ".",
      Object.assign({ keptAlerts: rows, seenAlerts: seen, shedAlerts: shed, rowCap: cap },
        unusable === null ? {} : { unusableRows: unusable })));
  }

  const limit = num(p.vendorLimit);
  if (p.vendorTruncated === true && limit !== null) {
    out.push(f("flowalerts/ceiling", ["alerts", "ceiling", "limit", "truncated", "population"],
      "The alert read came back at the vendor's maximum of " + limit +
      " rows, so today's count is a ceiling rather than a measurement and the true " +
      "population is unknown and at least that large.",
      { vendorLimitRows: limit }));
  }
  const readLimit = num(p.readLimit);
  if (p.readTruncated === true && readLimit !== null) {
    out.push(f("flowalerts/read-ceiling", ["alerts", "ceiling", "limit", "truncated", "population"],
      "An intraday alert read this session came back full at this site's own cap of " + readLimit +
      " rows per read, so alerts flagged between reads may be missing from the record and " +
      "the true population is at least what it holds.",
      { readLimitRows: readLimit }));
  }
  return out;
}

function trixFacts(p, at) {
  const f = maker("sector:trix", at);
  const out = [];
  const measured = num(p.measured);
  const baskets = Array.isArray(p.sectors) ? p.sectors.length : null;
  const span = num(p.span);
  if (all(measured, baskets, span)) {

    out.push(f("sector:trix/coverage", ["sector", "sectors", "trix", "momentum", "rotation"],
      "TRIX momentum is measured for " + measured + " of " + baskets +
      " sector baskets over a span of " + span + " sessions, on SPDR Select Sector " +
      "ETFs rather than GICS index levels.",
      { measuredSectors: measured, basketCount: baskets, spanSessions: span }));
  }
  return out;
}

function recordFacts(p, at) {
  const f = maker("record", at);
  const out = [];
  const retained = num(p.retained);
  const first = typeof p.firstSession === "string" && p.firstSession ? p.firstSession : null;
  const last = typeof p.lastSession === "string" && p.lastSession ? p.lastSession : null;
  if (retained !== null && first !== null && last !== null) {
    out.push(f("record/retention", ["record", "history", "sessions", "archive", "retained"],
      "The scored record retains " + retained + " sessions, the earliest " + first +
      " and the latest " + last + ".",
      { retainedSessions: retained, firstSession: first, lastSession: last }));
  }
  return out;
}

function trackFacts(p, at) {
  const f = maker("scoretrack", at);
  const out = [];
  const window = num(p.windowSessions);
  const kept = Array.isArray(p.names) ? p.names.length : null;
  const seen = num(p.namesSeen), shed = num(p.namesShed);
  const by = typeof p.shedBy === "string" && p.shedBy ? p.shedBy : null;
  if (all(window, kept, seen, shed)) {

    out.push(f("scoretrack/coverage", ["track", "scores", "history", "names", "window"],
      "The score track covers " + window + " sessions and carries " + kept + " of the " +
      seen + " names it saw, " + shed + " shed" +
      (by === null ? "" : " against the " + by + " ceiling") + ".",
      { windowSessions: window, keptNames: kept, seenNames: seen,
        shedNames: shed, shedBy: by }));
  }
  return out;
}

function politicalFacts(p, at, note) {
  const f = maker("political", at);
  const out = [];
  const w = p.window && typeof p.window === "object" ? p.window : {};
  const days = num(w.days), filings = num(p.filings), unusable = num(p.unusable);
  if (all(days, filings, unusable)) {
    out.push(f("political/window", ["political", "congress", "disclosure", "filings", "window"],
      "The disclosure window covers " + days + " days and holds " + filings +
      " readable filings, with " + unusable + " rows this page could not read.",
      { windowDays: days, readableFilings: filings, unusableRows: unusable }));
  }

  const latest = typeof p.latestFiled === "string" && p.latestFiled ? p.latestFiled : null;
  const fresh = num(p.freshFilings);
  if (latest !== null && fresh !== null) {
    out.push(f("political/latest", ["political", "congress", "disclosure", "newest", "filed"],
      "The newest disclosure in that window is dated " + latest + ", and " + fresh +
      " filings carry that date.",
      { latestFiled: latest, freshFilings: fresh }));
  }

  const census = blockCensus(p, "disclosure block", note);
  if (census.total > 0) {
    out.push(f("political/blocks", ["political", "congress", "blocks", "coverage"],
      census.answered + " of the " + census.total +
      " disclosure blocks on this key answered with rows.",
      { answeredBlocks: census.answered, blockCount: census.total }));
  }
  return out;
}

function pulseFacts(p, at, note) {
  const f = maker("pulse", at);
  const out = [];
  const census = blockCensus(p, "pulse feed", note);
  if (census.total === 0) return out;
  out.push(f("pulse/coverage", ["pulse", "feeds", "tide", "darkpool", "insiders", "coverage"],
    census.answered + " of the " + census.total +
    " market-wide pulse feeds answered with rows this session.",
    { answeredFeeds: census.answered, feedCount: census.total }));
  return out;
}

function metaFacts(p, at) {
  const f = maker("meta", at);
  const out = [];
  const universe = num(p.universe), enriched = num(p.enriched), scored = num(p.liquid);
  const built = num(p.cardsBuilt), failed = num(p.cardsFailed), skipped = num(p.cardsSkipped);
  if (all(universe, enriched, scored, built, failed, skipped)) {
    out.push(f("meta/run", ["run", "universe", "cards", "pipeline", "coverage"],
      "The run screened " + universe + " names, enriched " + enriched + " and scored " +
      scored + "; " + built + " cards were built, " + failed + " failed and " + skipped +
      " were skipped.",
      { universeNames: universe, enrichedNames: enriched, scoredNames: scored,
        cardsBuilt: built, cardsFailed: failed, cardsSkipped: skipped }));
  }
  const calls = num(p.apiCalls);
  if (calls !== null) {
    out.push(f("meta/calls", ["run", "calls", "vendor", "api", "budget"],
      "The run spent " + calls + " vendor calls.", { apiCalls: calls }));
  }
  return out;
}

function blockCensus(payload, label, note) {
  let answered = 0, total = 0;
  for (const key of Object.keys(payload)) {
    const block = payload[key];
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    if (typeof block.status !== "string") continue;
    total++;

    const what = key + " " + label;
    if (PUBLISHED_QUIET.has(block.status)) {
      note("quiet", what, silenceOf({ status: "ok", rows: [] }, what).say, block.reason);
      continue;
    }
    if (PUBLISHED_UNREADABLE.has(block.status)) {
      note("unreadable", what, silenceOf(null, what).say, block.reason);
      continue;
    }
    answered++;
  }
  return { answered, total };
}

const SURFACES = Object.freeze([
  { key: "market", what: "market-wide reading", build: marketFacts },
  { key: "movers", what: "movers list", build: moversFacts },
  { key: "unusual", what: "unusual-activity feed", build: unusualFacts },
  { key: "flowalerts", what: "flow-alert feed", build: alertFacts },
  { key: "news", what: "news tape", build: newsFacts },
  { key: "sector:trix", what: "sector momentum reading", build: trixFacts },
  { key: "pulse", what: "market pulse", build: pulseFacts },
  { key: "political", what: "disclosure feed", build: politicalFacts },
  { key: "scoretrack", what: "score track", build: trackFacts },
  { key: "record", what: "scored record", build: recordFacts },
  { key: "meta", what: "run summary", build: metaFacts },
]);

const SOURCE_ORDER = Object.freeze([
  "brief", "market", "movers", "unusual", "flowalerts", "news",
  "sector:trix", "pulse", "political", "scoretrack", "record", "meta",
]);

const sourceRank = (s) => {
  const i = SOURCE_ORDER.indexOf(s);
  return i === -1 ? SOURCE_ORDER.length : i;
};

const CARD_KEY = /^card:([A-Z][A-Z0-9.\-]{0,9})$/;

function r4(v) {
  if (v === null || !Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return v;
  let places = 4;
  let out = Number(v.toFixed(places));
  while (out === 0 && v !== 0 && places < 12) { places++; out = Number(v.toFixed(places)); }
  return out;
}

function boardStanding(store) {
  const map = new Map();
  for (const side of ["long", "short"]) {
    const p = store["board:" + side];
    const list = p !== null && typeof p === "object" && p.status !== "pending" &&
      Array.isArray(p.rows) ? p.rows : null;
    if (list === null) continue;
    for (const row of list) {
      if (row === null || typeof row !== "object" || typeof row.t !== "string") continue;
      if (map.has(row.t)) continue;
      map.set(row.t, { side, rank: num(row.r), rows: list.length });
    }
  }
  return map;
}

function oneCard(t, card, at, st) {

  const f0 = maker("card:" + t, at);
  const f = (id, topic, say, n) => f0(id, topic, say, { ticker: t, ...n });
  const out = [];
  const reg = card.regime !== null && typeof card.regime === "object" ? card.regime : {};
  const panels = card.panels !== null && typeof card.panels === "object" ? card.panels : {};
  const ok = (p) => p !== null && typeof p === "object" && p.status === "ok" ? p : {};

  const score = num(card.score), conv = num(card.conviction);
  const label = typeof reg.label === "string" && reg.label ? reg.label : null;
  const labelFrom = reg.labelFrom === "book" ? "the open-interest gamma book is "
    : reg.labelFrom === "flow" ? "today's added gamma is " : "dealer gamma is labelled ";
  if (all(score, conv) && label !== null) {
    let say = t + " scored " + score + " this session with conviction " + conv +
      " of 100; " + labelFrom + label + ".";

    const n = { score, convictionOf100: conv, convictionScale: 100, regime: label };
    if (st !== null && st.rank !== null && st.rows !== null) {
      say += " It sits at rank " + st.rank + " of " + st.rows + " on the " + st.side + " board.";
      n.boardRank = st.rank; n.boardRows = st.rows; n.side = st.side;
    }
    out.push(f("card:" + t + "/standing", [t, "score", "conviction", "rank", "regime"], say, n));
  }

  const g = ok(panels.gamma);
  const lv = ok(panels.levels);
  const lvl = (kind) => {
    const hit = Array.isArray(lv.levels) ? lv.levels.find((x) => x && x.kind === kind) : null;
    return hit ? num(hit.px) : null;
  };
  const spot = num(g.spot) !== null ? num(g.spot) : num(lv.spot);
  const cw = lvl("call_wall"), pw = lvl("put_wall"), zg = lvl("zero_gamma");
  const peakLong = num(g.flowPeakLong) !== null ? num(g.flowPeakLong) : num(g.callWall);
  const peakShort = num(g.flowPeakShort) !== null ? num(g.flowPeakShort) : num(g.putWall);
  const book = cw !== null || pw !== null || zg !== null;
  if (spot !== null && label !== null && (book || all(peakLong, peakShort))) {
    const n = { spotPx: r4(spot) };
    let say;
    if (book) {
      const parts = [];
      if (cw !== null) { parts.push("call wall is at " + r4(cw)); n.callWallPx = r4(cw); }
      if (pw !== null) { parts.push("put wall at " + r4(pw)); n.putWallPx = r4(pw); }
      say = "For " + t + " at spot " + r4(spot) + (parts.length ? ", the open-interest book's " + parts.join(" and its ") : "");
      if (zg !== null) { say += (parts.length ? "; " : ", ") + "total dealer gamma changes sign at " + r4(zg); n.zeroGammaPx = r4(zg); }
      say += ".";
    } else {
      say = "Today's gamma flow in " + t + " at spot " + r4(spot) + " peaks at " + r4(peakLong) + " long and " +
        r4(peakShort) + " short, flow extremes and not walls.";
      n.flowPeakLongPx = r4(peakLong); n.flowPeakShortPx = r4(peakShort);
    }
    const cross = num(card.strikeSumCrossing) !== null ? num(card.strikeSumCrossing) : num(card.gammaFlip);
    const crossings = num(reg.crossings);
    const sideRaw = typeof reg.crossingSide === "string" && reg.crossingSide ? reg.crossingSide
      : typeof reg.flipSide === "string" && reg.flipSide ? reg.flipSide : null;
    if (n.zeroGammaPx === undefined && cross !== null) {
      say += " The flow's strike-sum crossing is at " + r4(cross) + (sideRaw ? " (" + sideRaw.replace(/_/g, " ") + ")" : "") + ".";
      n.strikeSumCrossingPx = r4(cross);
      if (crossings !== null) n.crossings = crossings;
    } else if (n.zeroGammaPx === undefined && crossings === 0) {
      say += " The flow's running sum never changes sign, so no strike-sum crossing is published (0 crossings).";
      n.crossings = 0;
    }
    out.push(f("card:" + t + "/gamma", [t, "gamma", "wall", "flip", "zero", "crossing", "dealer"], say, n));
  }

  const pm = ok(panels.pricedMove);
  const im = num(pm.impliedMove), rm = num(pm.realizedMove), sess = num(pm.sessions);
  const il = num(pm.impliedLow), ih = num(pm.impliedHigh);
  if (all(im, rm, sess, il, ih)) {
    const rule = typeof pm.horizonRule === "string" && pm.horizonRule ? pm.horizonRule : null;
    const say = "The priced move for " + t + " over " + sess + " sessions is " + r4(im) +
      " of spot as a fraction, implying a range of " + r4(il) + " to " + r4(ih) +
      ", against a realised move of " + r4(rm) + " over the same horizon" +
      (rule !== null ? "; the horizon is " + rule + "." : ".");
    out.push(f("card:" + t + "/move", [t, "move", "priced", "implied", "range"],
      say, { impliedMoveFraction: r4(im), realizedMoveFraction: r4(rm), sessions: sess,
        impliedLowPx: r4(il), impliedHighPx: r4(ih) }));
  }

  const path = ok(panels.path);
  const np = num(path.netPremium), pers = num(path.persistence), mins = num(path.minutes);
  if (all(np, pers, mins)) {
    const say = "Net option premium in " + t + " over the " + mins + " minutes read summed to " +
      np + " US dollars, with a persistence of " + r4(pers) + " as a ratio.";
    out.push(f("card:" + t + "/flow", [t, "premium", "flow", "dollars", "persistence"],
      say, { netPremiumUsd: np, persistenceRatio: r4(pers), minutesRead: mins }));
  }

  const vc = ok(panels.volContext);
  const ivr = vc.ivRank !== null && typeof vc.ivRank === "object" ? vc.ivRank : {};
  const unit = typeof ivr.rankUnit === "string" ? ivr.rankUnit : "";
  const latest = ivr.status === "ok" && Array.isArray(ivr.rows) && ivr.rows.length ? ivr.rows[0] : null;
  const rank = latest !== null && typeof latest === "object" ? num(latest.rank1y) : null;
  const asOf = latest !== null && typeof latest.date === "string" && latest.date ? latest.date : null;
  if (rank !== null && asOf !== null && /^percent\b/i.test(unit)) {
    out.push(f("card:" + t + "/ivrank", [t, "iv", "rank", "volatility", "cheap"],
      t + "'s one-year implied-volatility rank was " + r4(rank) + " percent on " + asOf +
      ", as published.",
      { ivRank1yPct: r4(rank), ivRankAsOf: asOf }));
  }

  return out;
}

export function cardFacts(store, options) {
  const s = store && typeof store === "object" ? store : {};
  const thin = options !== null && typeof options === "object" && options.includeThin === true;
  const standing = boardStanding(s);
  const entries = [];
  for (const key of Object.keys(s)) {
    const m = CARD_KEY.exec(key);
    if (m === null) continue;
    const card = s[key];

    if (card === null || typeof card !== "object" || card.status === "pending") continue;

    if ((card.depth === "cross-section" || card.depth === "index" || card.depth === "fund") && !thin) continue;
    const t = typeof card.ticker === "string" && card.ticker ? card.ticker : m[1];
    entries.push({ t, card, at: atOf(card), st: standing.get(t) || null });
  }

  const sideOrder = { long: 0, short: 1 };
  entries.sort((a, b) => {
    const sa = a.st === null ? 2 : sideOrder[a.st.side], sb = b.st === null ? 2 : sideOrder[b.st.side];
    if (sa !== sb) return sa - sb;
    const ra = a.st === null || a.st.rank === null ? Infinity : a.st.rank;
    const rb = b.st === null || b.st.rank === null ? Infinity : b.st.rank;
    if (ra !== rb) return ra - rb;
    return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
  });
  const facts = [];
  const names = [];
  for (const e of entries) {
    const built = oneCard(e.t, e.card, e.at, e.st);
    if (!built.length) continue;
    names.push(e.t);
    for (const item of built) facts.push(item);
  }
  return { facts, names };
}

export const CARD_CORE_FACTS = Object.freeze(["standing", "gamma", "move"]);

export function shedCardFacts(facts, names, measure, options) {
  let list = Array.isArray(facts) ? facts.slice() : [];
  const order = Array.isArray(names) ? names.slice() : [];
  const core = options !== null && typeof options === "object" && Array.isArray(options.lean) ? options.lean : null;
  const leaned = [];
  if (core !== null) {
    for (let i = order.length - 1; i >= 0 && measure(list) > 0; i--) {
      const src = "card:" + order[i];
      const kept = list.filter((f) => !(f && f.source === src) || core.includes(String(f.id).split("/").pop()));
      if (kept.length === list.length) continue;
      if (!kept.some((f) => f && f.source === src)) continue;
      list = kept;
      leaned.unshift(order[i]);
    }
  }
  let kept = order.length;
  while (kept > 0 && measure(list) > 0) {
    const drop = order[kept - 1];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].source === "card:" + drop) list.splice(i, 1);
    }
    kept--;
  }
  const namesIndexed = { of: order.length, indexed: kept, shed: order.length - kept };
  if (core !== null) namesIndexed.lean = leaned.filter((t) => order.indexOf(t) < kept).length;
  return { facts: list, namesIndexed, leaned: leaned.filter((t) => order.indexOf(t) < kept) };
}

export const SILENCE_KINDS = Object.freeze(["pending", "unreadable", "quiet", "unavailable"]);

export function emptySilences() {
  return { pending: [], unreadable: [], quiet: [], unavailable: [] };
}

export function fileSilence(silences, kind, what, say, source, reason) {
  if (!SILENCE_KINDS.includes(kind)) throw new Error("unknown silence kind: " + String(kind));
  silences[kind].push({ kind, what, say, source,
    reason: typeof reason === "string" && reason ? reason : null });
}

const BRIEF_SECTION_TOPICS = Object.freeze({
  today: ["today", "session", "now"],
  yesterday: ["yesterday", "changed", "moved", "prior"],
  next: ["next", "tomorrow", "scheduled", "calendar", "threshold"],
});

const SIDE_WORDS = Object.freeze({ bullish: ["long"], bearish: ["short"] });

function sideWords(id) {
  const out = [];
  for (const part of id.split(":")) for (const w of SIDE_WORDS[part] || []) out.push(w);
  return out;
}

function briefSectionFact(name, item, at) {
  return maker("brief", at)("brief:" + name + "/" + item.id,
    BRIEF_SECTION_TOPICS[name].concat(item.id.split(":"), sideWords(item.id)), item.say, item.n, item.lead);
}

export function buildFactIndex(store) {
  const s = store && typeof store === "object" ? store : {};
  const facts = [];

  const silences = emptySilences();
  const record = (kind, what, say, source, reason) => fileSilence(silences, kind, what, say, source, reason);

  const briefStore = briefStoreFrom(s);

  for (const slot of Object.keys(briefStore)) {
    if (briefStore[slot] === undefined) briefStore[slot] = { status: "pending" };
  }
  const brief = buildBrief(briefStore);
  const briefAt = atOf(briefStore.long) || atOf(briefStore.short) || atOf(briefStore.events);

  const pendingSlot = (slot) => {
    const held = briefStore[slot];
    return held !== null && typeof held === "object" && held.status === "pending";
  };

  const unmeasuredSlot = (slot) => {
    const held = briefStore[slot];
    return held === null || typeof held !== "object" || held.status === "pending";
  };

  const NEXT_SLOTS = ["long", "short", "watch", "events"];
  const boardsPending = ["long", "short"].filter(pendingSlot);
  const nextUnmeasured = NEXT_SLOTS.filter(unmeasuredSlot);

  const SECTIONS = [
    ["today", brief.today],
    ["yesterday", brief.yesterday],
    ["next", brief.next],
  ];

  for (const [name, section] of SECTIONS) {
    for (const item of section.facts) facts.push(briefSectionFact(name, item, briefAt));
    for (const q of section.silences) {

      if (name === "yesterday" && q.what === "both boards" &&
          q.kind === "unreadable" && boardsPending.length) {
        record("pending", q.what,
          boardsPending.length === 2
            ? "Neither board has been published for this session yet, so nothing has " +
              "been measured and nothing is claimed about what changed."

            : "One of the two boards has not been published for this session yet, so " +
              "there is nothing to measure this session against the previous one with, " +
              "and nothing is claimed about what changed.",
          "brief", null);
        continue;
      }
      if (name === "next" && q.what === "the next session" &&
          q.kind === "quiet" && nextUnmeasured.length) {

        const allPending = nextUnmeasured.every(pendingSlot);
        record(allPending ? "pending" : "unreadable", q.what,
          allPending
            ? "The surfaces the next session is read from have not all been published " +
              "for this session yet, so nothing is stated about it. Nothing has been " +
              "measured, so nothing is claimed — least of all that the calendar is empty."
            : "At least one of the surfaces the next session is read from could not be " +
              "read, so nothing is stated about it. That is a fault on this page rather " +
              "than an empty calendar.",
          "brief", null);
        continue;
      }
      record(q.kind, q.what, q.say, "brief", null);
    }
  }

  for (const surface of SURFACES) {
    const p = served(s, surface.key);
    const state = silenceOf(p, surface.what);

    if (state && (state.kind === "pending" || p === null || typeof p !== "object")) {
      record(state.kind, state.what, state.say, surface.key, null);
      continue;
    }
    const published = answered(p);
    if (!published) continue;

    if (PUBLISHED_QUIET.has(published.status)) {
      record("quiet", surface.what, silenceOf({ status: "ok", rows: [] }, surface.what).say,
        surface.key, null);
      continue;
    }
    if (PUBLISHED_UNREADABLE.has(published.status)) {
      record("unreadable", surface.what, silenceOf(null, surface.what).say,
        surface.key, typeof published.reason === "string" ? published.reason : null);
      continue;
    }

    const note = (kind, what, say, reason) => record(kind, what, say, surface.key, reason);
    const built = surface.build(published, atOf(published), note);
    if (built.length) {
      for (const item of built) facts.push(item);
      continue;
    }

    if (state && state.kind === "quiet") {
      record("quiet", state.what, state.say, surface.key, null);
      continue;
    }

    record("unreadable", surface.what,
      "The " + surface.what + " was published but this index could not find the readings " +
      "inside it, so nothing about it is stated here. That is a fault on this page rather " +
      "than a fact about the session.", surface.key, null);
  }

  const cards = cardFacts(s);
  for (const item of cards.facts) facts.push(item);

  let generatedAt = null, newest = null;
  for (const key of Object.keys(s)) {
    const stamp = atOf(s[key]);
    if (stamp === null) continue;
    const ms = Date.parse(stamp);
    if (!Number.isFinite(ms)) continue;
    if (newest === null || ms > newest) { newest = ms; generatedAt = stamp; }
  }

  return { facts, silences, generatedAt, cardNames: cards.names };
}

export const INTRADAY_SOURCES = Object.freeze(["flowalerts", "pulse"]);

export function refreshIntradayFacts(index, feeds) {
  const facts = index && Array.isArray(index.facts) ? index.facts.slice() : [];
  const replaced = {};
  let refreshedAt = index && typeof index.refreshedAt === "string" ? index.refreshedAt : null;
  let today = index && index.today && typeof index.today === "object" ? index.today : null;
  for (const key of INTRADAY_SOURCES) {
    const p = feeds && Object.hasOwn(feeds, key) ? feeds[key] : undefined;
    const published = answered(p);
    if (!published || PUBLISHED_QUIET.has(published.status) ||
        PUBLISHED_UNREADABLE.has(published.status)) continue;
    const surface = SURFACES.find((x) => x.key === key);
    if (!surface) continue;

    const at = typeof published.readAt === "string" && published.readAt
      ? published.readAt : atOf(published);
    const built = surface.build(published, at, () => {});
    if (!built.length) continue;
    let first = facts.findIndex((f) => f && f.source === key);
    const kept = facts.filter((f) => !f || f.source !== key);
    if (first === -1) first = kept.length;
    else first = Math.min(first, kept.length);
    kept.splice(first, 0, ...built);
    facts.length = 0; for (const f of kept) facts.push(f);
    replaced[key] = built.length;
    if (at && (refreshedAt === null || Date.parse(at) > Date.parse(refreshedAt))) refreshedAt = at;
    if (key === "flowalerts") today = refreshBriefAlerts(facts, today, published, at, replaced);
  }
  return { ...(index || {}), ...(today ? { today } : {}), facts, refreshedAt, replaced };
}

function refreshBriefAlerts(facts, today, published, at, replaced) {
  const item = briefAlertsFact(published);
  if (!item) return today;
  const id = "brief:today/" + item.id;
  const fresh = briefSectionFact("today", item, at);
  const held = facts.findIndex((f) => f && f.id === id);
  if (held !== -1) facts[held] = fresh;
  else {
    let last = -1;
    facts.forEach((f, i) => { if (f && typeof f.id === "string" && f.id.startsWith("brief:today/")) last = i; });
    facts.splice(last + 1, 0, fresh);
  }
  replaced.brief = (replaced.brief || 0) + 1;
  if (!today || typeof today !== "object" || !Array.isArray(today.facts)) return today;
  const list = today.facts.slice();
  const slot = list.findIndex((f) => f && f.id === item.id);
  if (slot === -1) list.push(item); else list[slot] = item;
  return { ...today, facts: list };
}

export function briefAge(index, now) {
  const session = index && typeof index.sessionDate === "string" && index.sessionDate
    ? index.sessionDate.slice(0, 10) : null;
  const expected = now === undefined || now === null ? null : lastCompletedSession(now);
  const stale = session !== null && expected !== null && session < expected;
  const refreshedAt = index && typeof index.refreshedAt === "string" ? index.refreshedAt : null;
  const generatedAt = index && typeof index.generatedAt === "string" ? index.generatedAt : null;
  let say = null;
  if (stale) {
    say = "These readings describe the session of " + session + ". The most recent session " +
      "that has closed is " + expected + " and its briefing has not been published, so " +
      "nothing here is a reading of that session or of today.";
  }
  return { sessionDate: session, expected, stale, generatedAt, refreshedAt, say };
}

function factsHeader(meta) {
  const a = meta && typeof meta === "object" ? meta : {};
  const parts = [];
  if (a.sessionDate) parts.push("These facts describe the trading session of " + a.sessionDate);
  else parts.push("These facts describe one trading session");
  if (a.generatedAt) parts.push("the briefing was built at " + a.generatedAt);
  if (a.refreshedAt) {
    parts.push("the flow-alert and market-pulse readings were last re-read at " + a.refreshedAt);
  }
  let line = parts.join("; ") + ".";
  if (a.stale && a.say) {
    line += " STALE: " + a.say + " If asked about today or the latest session, say that the " +
      "facts are from " + a.sessionDate + " and that " + a.expected + " has not been published.";
  }
  return line;
}

const TICKER = /\b[A-Z][A-Z0-9]{0,4}\b/g;

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "in", "on", "for", "to", "and",
  "or", "what", "how", "did", "do", "does", "this", "that", "it", "its", "my", "me",
  "you", "we", "they", "there", "here", "be", "been", "at", "by", "with", "from",
  "as", "any", "all", "some", "than", "then", "so", "if", "but", "not", "no", "yes",
  "about", "tell", "show", "give", "please", "can", "could", "would", "who", "why",
]);

function questionWords(question) {
  const text = typeof question === "string" ? question : "";
  const words = text.toLowerCase().match(/[a-z0-9.]{2,}/g) || [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

function questionTickers(question) {
  const text = typeof question === "string" ? question : "";
  if (!/[a-z]/.test(text)) return [];
  return [...new Set((text.match(TICKER) || []).map((t) => t.toLowerCase()))];
}

const NAMED_WEIGHT = 100;
const SUBJECT_WEIGHT = 50;

const WORD_ONLY_NAMES = 4;

function subjectTickers(subject) {
  const list = subject && typeof subject === "object" && Array.isArray(subject.tickers)
    ? subject.tickers : [];
  const out = [];
  for (const t of list) {
    if (typeof t !== "string") continue;
    const u = t.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(u)) continue;
    const l = u.toLowerCase();
    if (!out.includes(l)) out.push(l);
  }
  return out.slice(0, 2);
}

const plural = (n, word) => word + (n === 1 ? "" : "s");

function joinClauses(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

export function selectFacts(index, question, options) {
  const o = options || {};
  const max = num(o.max) === null ? 14 : Math.max(1, Math.trunc(num(o.max)));
  const facts = index && Array.isArray(index.facts) ? index.facts : [];
  if (!facts.length) {
    return { picked: [], capped: false, subjectApplied: false,
      why: "The index holds no facts at all, so nothing was selected." };
  }

  const typed = questionTickers(question);
  const subject = typed.length ? [] : subjectTickers(o.subject);
  const named = typed.length ? typed : subject;
  const weight = typed.length ? NAMED_WEIGHT : SUBJECT_WEIGHT;

  const words = questionWords(question).filter((w) => !named.includes(w));

  let oldest = null, newestMs = null;
  for (const f of facts) {
    const ms = f.at === null ? NaN : Date.parse(f.at);
    if (!Number.isFinite(ms)) continue;
    if (oldest === null || ms < oldest) oldest = ms;
    if (newestMs === null || ms > newestMs) newestMs = ms;
  }
  const span = oldest !== null && newestMs !== null ? newestMs - oldest : 0;

  const cardName = (f) => (typeof f.source === "string" && f.source.startsWith("card:")
    ? f.source.slice(5).toLowerCase() : null);

  const scored = facts.map((f, i) => {
    const topic = new Set(f.topic || []);
    let hitNamed = 0, hitWords = 0, first = null;
    for (const t of named) if (topic.has(t)) { hitNamed++; if (first === null) first = t; }
    for (const w of words) if (topic.has(w)) hitWords++;
    const ms = f.at === null ? NaN : Date.parse(f.at);
    const recency = span > 0 && Number.isFinite(ms) ? (ms - oldest) / span : 0;
    const name = cardName(f);
    const wordOnly = name !== null && hitNamed === 0 && hitWords > 0;
    const score = wordOnly ? 10 : hitNamed * weight + hitWords * 10;
    return { f, i, hitNamed, hitWords, first, name, wordOnly, recency, score };
  });

  const matched = scored.filter((x) => x.hitNamed > 0 || x.hitWords > 0);
  const pool = matched.length ? matched : scored;

  const byRank = (a, b) => (b.score - a.score) ||
    (sourceRank(a.f.source) - sourceRank(b.f.source)) ||
    (b.recency - a.recency) || (a.i - b.i);

  const general = pool.filter((x) => !x.wordOnly).sort(byRank);

  const perName = [];
  const seenNames = new Set();
  const wordOnlyNames = new Set();
  for (const x of pool) {
    if (!x.wordOnly) continue;
    wordOnlyNames.add(x.name);
    if (seenNames.has(x.name) || perName.length >= WORD_ONLY_NAMES) continue;
    seenNames.add(x.name);
    perName.push(x);
  }

  let ordered;
  if (named.length >= 2) {
    const groups = new Map(named.map((t) => [t, []]));
    const rest = [];
    for (const x of general) {
      if (x.hitNamed > 0) groups.get(x.first).push(x);
      else rest.push(x);
    }
    const dealt = [];
    let dealing = true;
    while (dealing) {
      dealing = false;
      for (const t of named) {
        const g = groups.get(t);
        if (g.length) { dealt.push(g.shift()); dealing = true; }
      }
    }
    ordered = dealt.concat(rest, perName);
  } else {
    ordered = general.concat(perName);
  }

  const chosen = ordered.slice(0, max);
  const picked = chosen.map((x) => x.f);
  const capped = ordered.length > max;

  const upper = (t) => t.toUpperCase();
  const hitWordList = words.filter((w) => pool.some((x) => x.f.topic && x.f.topic.includes(w)));
  const wordsPhrase = "the words " + hitWordList.slice(0, 4).join(", ") +
    (hitWordList.length > 4 ? " and " + (hitWordList.length - 4) + " more" : "");
  const pageNote = (t) => (subject.includes(t)
    ? (subject.length === 1 ? ", the name on this page" : ", a name on this page") : "");

  let withheld = null;
  let why;
  if (matched.length) {
    const clauses = [];
    const missing = [];
    for (const t of named) {
      const about = general.filter((x) => x.hitNamed > 0 && x.first === t).length;
      if (!about) { missing.push(t); continue; }
      const served = chosen.filter((x) => x.hitNamed > 0 && x.first === t).length;
      clauses.push(served + " of the " + about + plural(about, " fact") + " about " + upper(t) + pageNote(t));
    }
    const wordGeneral = general.filter((x) => x.hitNamed === 0).length;
    if (wordGeneral) {
      const served = chosen.filter((x) => !x.wordOnly && x.hitNamed === 0).length;
      clauses.push(served + " of the " + wordGeneral + plural(wordGeneral, " fact") + " that matched " + wordsPhrase);
    }
    if (wordOnlyNames.size) {
      const served = chosen.filter((x) => x.wordOnly).length;
      clauses.push(served + " per-name reading" + (served === 1 ? "" : "s") + " on " +
        wordsPhrase + ", one each from " + served + " of the " + wordOnlyNames.size +
        " name" + (wordOnlyNames.size === 1 ? "" : "s") + " that carry one");
    }
    if (missing.length) {
      withheld = "Nothing indexed is about " +
        joinClauses(missing.map((t) => upper(t) + pageNote(t))) +
        ", so no reading below is about " + (missing.length === 1 ? "it" : "them") + ".";
    }
    why = (missing.length
      ? "Nothing indexed is about " + joinClauses(missing.map((t) => upper(t) + pageNote(t))) + ". "
      : "") +
      "Picked " + joinClauses(clauses) + (capped ? ", cut at the cap of " + max + "." : ".");
  } else {

    withheld = (subject.length
      ? "Nothing indexed is about " + joinClauses(subject.map(upper)) +
        (subject.length === 1 ? ", the name on this page. " : ", the names on this page. ")
      : "") +
      "Nothing in the question matched a ticker or a topic word in the index, so the " +
      "readings below are the session's headline facts in the order the briefing states " +
      "them rather than an answer to what was asked.";
    why = (subject.length
      ? "Nothing indexed is about " + joinClauses(subject.map(upper)) +
        (subject.length === 1 ? ", the name on this page. " : ", the names on this page. ")
      : "") +
      "Nothing in the question matched a ticker or a topic word in the index, so these " +
      "are the session's headline readings in the order the briefing states them: " +
      picked.length + " of " + facts.length + " facts" +
      (capped ? ", cut at the cap." : ".");
  }

  return { picked, capped, why, withheld, subjectApplied: subject.length > 0 };
}

const WORD_NUMBERS = new Map([
  ["zero", "0"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"],
  ["six", "6"], ["seven", "7"], ["eight", "8"], ["nine", "9"], ["ten", "10"],
  ["eleven", "11"], ["twelve", "12"], ["thirteen", "13"], ["fourteen", "14"],
  ["fifteen", "15"], ["sixteen", "16"], ["seventeen", "17"], ["eighteen", "18"],
  ["nineteen", "19"], ["twenty", "20"], ["thirty", "30"], ["forty", "40"],
  ["fifty", "50"], ["sixty", "60"], ["seventy", "70"], ["eighty", "80"],
  ["ninety", "90"],
]);

function unsupportedWordNumbers(text, facts, allowed) {
  const said = (f) => (f && typeof f.say === "string" ? f.say : "");
  const out = [];
  for (const [word, digits] of WORD_NUMBERS) {
    const re = new RegExp("\\b" + word + "\\b", "i");
    if (!re.test(text)) continue;
    if (allowed.has(digits)) continue;
    if (facts.some((f) => re.test(said(f)))) continue;
    out.push(word);
  }
  return out;
}

function whitelisted(token, allowSmall) {
  if (/^\d{4}$/.test(token)) {
    const y = Number(token);
    if (y >= 1900 && y <= 2100) return true;
  }
  if (allowSmall && /^\d{1,2}$/.test(token)) {
    const v = Number(token);
    if (v >= 1 && v <= 12) return true;
  }
  return false;
}

export function guardAnswer(answer, picked, options) {
  const o = options || {};
  const allowSmall = o.smallIntegers === undefined ? true : o.smallIntegers === true;
  const text = typeof answer === "string" ? answer : "";
  const facts = Array.isArray(picked) ? picked : [];

  if (text.trim() === "") {
    return { ok: false, rejected: [], numerals: [], invented: false, forecast: false,
      reason: "The model returned no text, so there is nothing to check and nothing " +
        "to show." };
  }

  const allowed = new Set();
  for (const f of facts) for (const t of numeralsIn(f && f.say)) allowed.add(t);

  const numerals = numeralsIn(text);
  const rejected = [];
  for (const token of numerals) {
    if (allowed.has(token)) continue;
    if (whitelisted(token, allowSmall)) continue;
    rejected.push(token);
  }

  for (const word of unsupportedWordNumbers(text, facts, allowed)) rejected.push(word);
  const invented = rejected.length;

  const verbs = text.match(new RegExp(FORECAST.source, "gi")) || [];
  for (const v of verbs) rejected.push(v);

  if (!rejected.length) {
    return { ok: true, rejected: [], reason: null, numerals, invented: false, forecast: false };
  }

  const parts = [];
  if (invented) {
    parts.push("The answer stated a figure that appears in none of the facts it was " +
      "given, which means it was computed or invented rather than quoted");
  }
  if (verbs.length) {
    parts.push("The answer claimed the future, and this product states what was " +
      "measured and what is already on the calendar");
  }

  return { ok: false, rejected, numerals,
    invented: invented > 0, forecast: verbs.length > 0,
    reason: parts.join(". ") + ". The refused tokens are listed in `rejected`, and the " +
      "deterministic reading is served in its place." };
}

const ENGLISH_LETTERS = new Set(["i", "a"]);

export function tickerCoverage(picked, question) {
  const facts = Array.isArray(picked) ? picked : [];
  const tickers = questionTickers(question);
  const words = questionWords(question);
  const covered = new Set();
  let wordHit = false;
  for (const f of facts) {
    const topic = new Set(f && Array.isArray(f.topic) ? f.topic : []);
    for (const t of tickers) if (topic.has(t)) covered.add(t);
    for (const w of words) if (topic.has(w)) wordHit = true;
  }
  const allowed = new Set();
  for (const f of facts) for (const n of numeralsIn(f && typeof f.say === "string" ? f.say : "")) allowed.add(n);
  const printable = (t) => numeralsIn(t).every((n) => allowed.has(n));
  const said = (list) => list.filter(printable).map((t) => t.toUpperCase());
  const hit = tickers.filter((t) => covered.has(t));
  const miss = tickers.filter((t) => !covered.has(t) && !ENGLISH_LETTERS.has(t));
  return { hit, miss, wordHit, hitSaid: said(hit), missSaid: said(miss) };
}

function nameList(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}

export function renderFactsPlain(picked, question) {
  const facts = Array.isArray(picked) ? picked : [];
  if (!facts.length) {

    return "No reading this index holds speaks to this question, so there is nothing to " +
      "quote. Whether nothing has been published for this session, whether what was " +
      "published could not be read, or whether what was measured was empty are " +
      "different facts from one another, and this sentence is not where they are told apart — the " +
      "silences beside it name each surface one at a time. None of them is a " +
      "statement about the market.";
  }

  const cov = tickerCoverage(facts, question);
  const one = cov.miss.length === 1;
  const missPhrase = cov.missSaid.length ? nameList(cov.missSaid)
    : (one ? "the name you asked about" : "the names you asked about");
  const withheld = "None of the readings below is about " + missPhrase + ".";

  let lead;
  if (cov.miss.length === 0 && (cov.hit.length > 0 || cov.wordHit)) {
    lead = "These are the published readings that bear on what you asked.";
  } else if (cov.miss.length > 0 && cov.hit.length > 0) {
    const hitPhrase = cov.hitSaid.length ? nameList(cov.hitSaid) : "the name it does cover";
    lead = "These are the published readings that bear on " + hitPhrase + ". " + withheld;
  } else if (cov.miss.length > 0 && cov.wordHit) {
    lead = withheld + " They are the session's readings on the other words in the question.";
  } else if (cov.miss.length > 0) {
    lead = withheld + " Nothing else in the question matched a topic the published payloads " +
      "carry, so these are the session's headline readings.";
  } else {
    lead = "Nothing in the question matched a name or a topic the published payloads carry, " +
      "so these are the session's headline readings.";
  }
  const body = facts.map((f) => "- " + f.say).join("\n");
  return lead + "\n\n" + body + "\n\n" +
    "Every figure above is quoted from a payload this pipeline published; none of it " +
    "was computed for this answer.";
}

export function promptFor(picked, question, meta) {
  const facts = Array.isArray(picked) ? picked : [];
  const system = [
    "You answer questions about a stock options briefing using ONLY the facts supplied " +
      "in the next message. You are the prose; the numbers are already decided.",
    "",
    "1. NEVER write a number that does not already appear, character for character, in " +
      "one of the supplied facts. Do not add, subtract, total, average, rank, round, " +
      "convert a ratio into a percentage, or turn a figure into millions. There is no " +
      "arithmetic you are permitted to do. If answering would need a number nobody " +
      "measured, say that it was not measured.",
    "2. NEVER say what the market is going to do. No prediction, no expectation, no " +
      "likelihood. The facts are measurements and calendar entries that already exist, " +
      "and nothing in them supports a claim about a future price or score.",
    "3. FOUR KINDS OF SILENCE ARE FOUR DIFFERENT FACTS and may never be merged into " +
      "one sentence. PENDING means the payload has not been published for this session, " +
      "so nothing was measured and nothing is claimed. UNREADABLE means it was " +
      "published and could not be read, which is a fault on our side rather than a fact " +
      "about the session. QUIET means it was measured and holds nothing, which is a " +
      "reading in its own right. UNAVAILABLE means the payload was published and this " +
      "particular reading is not on it, so nothing is claimed about that reading. Never " +
      "answer that a market was quiet when the truth is that a job has not run.",
    "4. UNITS TRAVEL WITH NUMBERS. A ratio and a dollar sum are not interchangeable; " +
      "quote the unit the fact itself uses, in the fact's own words.",
    "5. A capped list is not a population. If a fact says a count was capped or came " +
      "back at a vendor's limit, keep that qualification in your answer.",
    "6. If the supplied facts do not answer the question, say so plainly and say what " +
      "they do cover. A short honest answer is the goal.",
    "7. If a COVERAGE line says a name in the question has no reading among the facts, " +
      "never attach a figure to that name. A market-wide figure is not a reading for one " +
      "name, and writing one beside it is the same as inventing it.",
    "",
    "Write two or three plain sentences. No lists, no headings, no markdown, and do " +
      "not refer to the facts by number or position.",
  ].join("\n");

  const cov = tickerCoverage(facts, question);
  const coverage = cov.miss.length
    ? "\n\nCOVERAGE: the question names " +
      (cov.missSaid.length ? nameList(cov.missSaid) : "a symbol") +
      ", and none of the facts below is a reading for " +
      (cov.miss.length === 1 ? "that name" : "those names") +
      ". Do not attribute any figure to " + (cov.miss.length === 1 ? "it" : "them") +
      "; say that no reading for " + (cov.miss.length === 1 ? "it" : "them") +
      " was supplied."
    : "";
  const user = "Question: " + (typeof question === "string" ? question.trim() : "") +
    coverage +
    "\n\n" + factsHeader(meta) +
    "\n\nFacts measured for this session:\n" +
    facts.map((f) => "- " + f.say).join("\n");

  return { system, user };
}

export function promptForSummary(picked, meta, options) {
  const facts = Array.isArray(picked) ? picked : [];
  const o = options !== null && typeof options === "object" ? options : {};
  const subject = typeof o.subject === "string" && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(o.subject)
    ? o.subject : null;
  const system = [
    subject === null
      ? "You write a short standing summary of a stock options briefing using ONLY the " +
        "facts supplied in the next message. You are the prose; the numbers are already " +
        "decided. Nobody asked a question: you are summarising what was measured."
      : "You write a short standing summary of ONE name, " + subject + ", from a stock " +
        "options briefing, using ONLY the facts supplied in the next message. You are the " +
        "prose; the numbers are already decided. Nobody asked a question: you are " +
        "summarising what was measured for " + subject + " and nothing else.",
    "",
    "1. NEVER write a number that does not already appear, character for character, in " +
      "one of the supplied facts. Do not add, subtract, total, average, rank, round, " +
      "convert a ratio into a percentage, or turn a figure into millions. There is no " +
      "arithmetic you are permitted to do — and that includes COUNTING the facts " +
      "themselves. How many readings there are is not one of the readings.",
    "2. NEVER say what the market is going to do. No prediction, no expectation, no " +
      "likelihood. The facts are measurements and calendar entries that already exist.",
    "3. FOUR KINDS OF SILENCE ARE FOUR DIFFERENT FACTS and may never be merged into " +
      "one sentence. PENDING means the payload has not been published for this session. " +
      "UNREADABLE means it was published and could not be read, which is a fault on our " +
      "side rather than a fact about the session. QUIET means it was measured and holds " +
      "nothing, which is a reading in its own right. UNAVAILABLE means the payload was " +
      "published and this reading is not on it. Never summarise a market as quiet when " +
      "the truth is that a job has not run.",
    "4. UNITS TRAVEL WITH NUMBERS. A ratio and a dollar sum are not interchangeable; " +
      "quote the unit the fact itself uses, in the fact's own words.",
    "5. A capped list is not a population. If a fact says a count was capped or came " +
      "back at a vendor's limit, keep that qualification.",
    "6. YOU ARE CHOOSING WHAT TO LEAD WITH, AND THAT IS THE ONE THING THIS TASK ASKS " +
      "OF YOU THAT THE FACTS DO NOT DECIDE. Lead with what a reader would want first. " +
      "But never call a reading the largest, the biggest, the most unusual or a record " +
      "unless a supplied fact says so in those words — a superlative is a claim about " +
      "every reading you were NOT given.",
    "7. Name the symbol a reading belongs to. A market-wide figure is not a reading for " +
      "one name, and attaching it to one is the same as inventing it.",
    "",
    subject === null
      ? "Write three or four plain sentences. No lists, no headings, no markdown, no " +
        "preamble such as \"here is a summary\", and do not refer to the facts by number " +
        "or position."
      : "Write two or three plain sentences about " + subject + " only, naming it in the " +
        "first sentence. No lists, no headings, no markdown, no preamble such as \"here " +
        "is a summary\", and do not refer to the facts by number or position.",
  ].join("\n");

  const user = factsHeader(meta) +
    (subject === null
      ? "\n\nFacts measured for this session:\n"
      : "\n\nFacts measured for " + subject + " this session:\n") +
    facts.map((f) => "- " + f.say).join("\n");

  return { system, user };
}

export function renderSummaryPlain(picked) {
  const facts = Array.isArray(picked) ? picked : [];
  if (!facts.length) {

    return "No readings are in hand for this session, so there is nothing to summarise. " +
      "Whether nothing has been published, whether what was published could not be " +
      "read, or whether what was measured was empty are different facts from one " +
      "another, and this sentence is not where they are told apart. None of them is a " +
      "statement about the market.";
  }
  return "The readings below were measured by the pipeline for this session and are " +
    "shown as they were published. The sentence that usually stands here is written " +
    "by a model over them, and on this session there is none to show — every figure " +
    "below is the pipeline's own either way.";
}

export function summaryFingerprint(picked) {
  const facts = Array.isArray(picked) ? picked : [];

  const joined = facts
    .map((f) => (f && typeof f.say === "string" ? f.say : ""))
    .join("");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = (((h << 5) + h) ^ joined.charCodeAt(i)) >>> 0;
  return h.toString(36) + "." + facts.length;
}
