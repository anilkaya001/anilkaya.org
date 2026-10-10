import { num, callGammaLeg, putGammaLeg } from "../../../shared/flows-features.js";
import { unwrapRows as unwrapVendorRows } from "../../../shared/flows-political.js";
import {
  capBands, selectCoverage, NDX_100, NDX_AS_OF, PICK_INDEX, ndxConstantAge,
} from "../../../shared/flows-universe.js";
import { MAG7 as FOCUS_MAG7, FOCUS_MINERS, ndx10, ndxMembership, focusDeepSet } from "../../../shared/flows-focus.js";
import { harvestScreener, fetchMissingMembers, readHoldings } from "../../flows-legs/universe.mjs";
import { makeFakeVendor } from "../../flows-legs/fake-vendor.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { DRY_RUN } from "../flags.mjs";
import { EARNINGS_GATE_DAYS, SCREENER_PAGE_ROWS, SCREENER_SPLIT_DEPTH, UNIVERSE } from "../vendor-params.mjs";
import { poolWidth, runPooled, uw } from "../vendor.mjs";
import { ARCHIVE_DATE_RE } from "../store.mjs";
import {
  GATED_LIQUIDITY_MARGIN, candleCut, candleDate, collapseShareClasses, computeFeatures, daysToEarnings, eligible,
  enrich, gatedWorthEnriching, measureVariationProbes, netPremiumOf, onWire, partitionSides, scoreBoard, screenerTilt,
  sessionCandles,
} from "../rank.mjs";
import { fakeEnrichment, fakeFocusRows, fakeScreener } from "../fixtures.mjs";

export function judgeEndDate(rows, sessionDate) {
  const list = Array.isArray(rows) ? rows : [];
  const dates = list.map(candleDate).filter(Boolean).sort();
  const latest = dates.length ? dates[dates.length - 1] : null;
  const dated = ARCHIVE_DATE_RE.test(String(sessionDate || ""));
  return {
    send: list.length > 0,
    honoured: latest === null || !dated ? null : latest <= sessionDate,
    latest,
    past: dated ? dates.filter((d) => d > sessionDate).length : 0,
  };
}

const SCREENER_READ_KEYS = ["close", "marketcap", "call_volume", "put_volume"];

export function judgeScreenerDate(dated, undated) {
  const a = unwrapVendorRows(dated);
  const b = unwrapVendorRows(undated);
  if (!a.length) {
    return b.length
      ? { date: false, reason: `the dated probe returned no rows while the undated one returned ${b.length}` }
      : { date: true, reason: "neither probe returned rows, so the dated read is kept as the one correct by construction" };
  }
  const first = a[0] && typeof a[0] === "object" ? a[0] : {};
  const missing = SCREENER_READ_KEYS.filter((k) => !onWire(first[k]));
  if (missing.length) {
    return { date: false, reason: `the dated probe's first row carries no ${missing.join(", ")}` };
  }
  return { date: true, reason: `the dated probe returned ${a.length} readable row(s)` };
}

export async function sweepScreenerBand([min, max], readBand, {
  depth = SCREENER_SPLIT_DEPTH, pageRows = SCREENER_PAGE_ROWS,
} = {}) {
  const byTicker = new Map();
  const unnamed = [];
  const keep = (list) => {
    for (const row of list) {
      if (row && row.ticker) byTicker.set(row.ticker, row);
      else unnamed.push(row);
    }
  };
  const leaves = [];
  let reads = 0;
  const walk = async (lo, hi, level) => {
    reads++;
    const page = await readBand(lo, hi);
    const list = Array.isArray(page) ? page : [];
    const full = list.length >= pageRows;
    keep(list);
    if (!full || level >= depth) {
      leaves.push({ min: lo, max: hi, rows: list.length, truncated: full, level });
      return;
    }
    const mid = hi === null ? lo * 2 : Math.sqrt(lo * hi);
    await walk(lo, mid, level + 1);
    await walk(mid, hi, level + 1);
  };
  await walk(min, max, 0);
  return { rows: [...byTicker.values(), ...unnamed], leaves, reads,
    truncated: leaves.filter((l) => l.truncated).length, split: reads > 1 };
}

const SCREENER_PROBE = Object.freeze({
  min_underlying_price: 5, min_volume: 1000, min_oi: 5000, min_marketcap: 5e11,
});

export async function verifyDating(sessionDate, { read = uw } = {}) {
  if (!sessionDate || DRY_RUN) {
    return { date: !!sessionDate, endDate: !!sessionDate, endDateHonoured: null,
      endDateLatest: null, screenerDate: !!sessionDate, screenerReason: null };
  }

  const usable = (rows) => (rows || []).some(
    (r) => r && r.expiry && (num(callGammaLeg(r)) !== 0 || num(putGammaLeg(r)) !== 0));

  const PROBE = "AAPL";

  const [dated, undated, capped, screenDated, screenUndated] = await Promise.all([
    read(`/api/stock/${PROBE}/greek-exposure/expiry`, { date: sessionDate }).catch(() => []),
    read(`/api/stock/${PROBE}/greek-exposure/expiry`).catch(() => []),
    read(`/api/stock/${PROBE}/ohlc/1d`, { timeframe: "1M", end_date: sessionDate }).catch(() => []),
    read("/api/screener/stocks", { ...SCREENER_PROBE, date: sessionDate }).catch(() => []),
    read("/api/screener/stocks", SCREENER_PROBE).catch(() => []),
  ]);

  const date = usable(dated) || !usable(undated);
  const cap = judgeEndDate(capped, sessionDate);
  const endDate = cap.send;
  const screener = judgeScreenerDate(screenDated, screenUndated);

  if (!usable(dated) && !usable(undated)) {
    console.warn(
      `NOTE: ${PROBE} /greek-exposure/expiry returns no usable gamma either dated ` +
      `(${sessionDate}) or undated, so this probe cannot tell whether \`date\` is at ` +
      "fault. Keeping `date` — the dated call is the one that is correct by " +
      "construction. The gamma roll-off panel will be unavailable on every card " +
      "until that endpoint returns greeks; see the shape report below.");
  } else if (!date) {
    console.warn(
      `WARNING: /greek-exposure/expiry?date=${sessionDate} returns no usable gamma for ` +
      `${PROBE} while the undated call does — dropping \`date\` for this run. The board ` +
      "will carry whatever session the vendor defaults to, which is the behaviour " +
      "that mislabelled it before.");
  }
  if (!endDate) {
    console.warn(
      `WARNING: /ohlc/1d?end_date=${sessionDate} returned no candles for ${PROBE} — ` +
      "dropping `end_date` for this run. Every candle series is still cut at " +
      `${sessionDate} locally before any feature reads it.`);
  } else if (cap.honoured === false) {
    console.warn(
      `WARNING: /ohlc/1d?end_date=${sessionDate} returned ${cap.past} bar(s) dated after ` +
      `the session for ${PROBE} (latest ${cap.latest}) — the vendor does NOT honour ` +
      "end_date on this read. The parameter is kept, since it costs nothing, and every " +
      `candle series is cut at ${sessionDate} locally before any feature reads it.`);
  }
  if (!screener.date) {
    console.warn(
      `WARNING: /screener/stocks?date=${sessionDate} is not usable — ${screener.reason}. ` +
      "Dropping `date` from the screener for this run, so its volumes and prices are " +
      "whatever the vendor holds at read time.");
  }

  if (!usable(dated) || !usable(undated)) {
    for (const [label, rows] of [["dated", dated], ["undated", undated]]) {
      const arr = Array.isArray(rows) ? rows : [];
      if (!arr.length) { console.warn(`  ${PROBE} expiry ${label}: 0 rows`); continue; }
      const shape = Object.entries(arr[0])
        .map(([k, v]) => `${k}=${v === null ? "null" : String(v).slice(0, 14)}`)
        .join(" ");
      console.warn(`  ${PROBE} expiry ${label}: ${arr.length} rows, first: ${shape}`);
    }
  }

  return { date, endDate, endDateHonoured: cap.honoured, endDateLatest: cap.latest,
    screenerDate: screener.date, screenerReason: screener.reason };
}

export async function runUniverse(ctx) {
  const { stages, sessionDate, gateOrigin } = ctx;
  stages.step("universe");
  const dating = await verifyDating(sessionDate);
  console.log(`dating: date=${dating.date} end_date=${dating.endDate ? "sent" : "dropped"}` +
    (dating.endDateHonoured === null ? ""
      : dating.endDateHonoured ? " (honoured by the vendor)"
        : ` (NOT honoured: the probe returned ${dating.endDateLatest}; candles are cut locally)`) +
    ` screener date=${dating.screenerDate}`);

  const CAP_BANDS = capBands({ min: UNIVERSE.minMarketCap, max: 4e12, ratio: 1.3 });

  let screener;
  let screenerTruncated = 0;
  let screenerReadAt = null;
  const screenerFilters = {
    min_underlying_price: UNIVERSE.minPrice, min_volume: UNIVERSE.minOptionVolume,
    min_oi: UNIVERSE.minOpenInterest, min_marketcap: UNIVERSE.minMarketCap,
  };
  const screenerDate = sessionDate && dating.screenerDate ? sessionDate : null;
  let harvest = null;
  let universeSource = null;
  if (!DRY_RUN) {
    const read = await harvestScreener(uw, { filters: screenerFilters, date: screenerDate });
    console.log(`  screener harvest: ${read.rows.length} row(s) in ${read.pages} page(s) of ${read.limit}` +
      (read.truncated ? " — TRUNCATED at the page cap" : "") + (read.repeated ? " — a page repeated" : "") +
      (read.errors.length ? ` — ${read.errors.join("; ")}` : ""));
    if (read.rows.length && !read.truncated && !read.repeated && !read.errors.length) harvest = read;
    else console.warn("  screener harvest: not usable, so the cap-band sweep reads the universe instead");
  }
  const dryScreener = DRY_RUN ? [...fakeScreener(420), ...fakeFocusRows()] : null;
  const vendor = DRY_RUN ? makeFakeVendor({ sessionDate, screenerRows: dryScreener }) : uw;
  if (DRY_RUN) {
    screener = dryScreener.filter((r) => num(r.marketcap) >= UNIVERSE.minMarketCap);
    screenerReadAt = stampNow();
  } else if (harvest) {
    screener = harvest.rows;
    screenerReadAt = stampNow();
  } else {
    const byTicker = new Map();
    const sweepStartedAt = stampNow();
    let saturated = 0, split = 0, sweepReads = 0;
    const readBand = (min, max) => uw("/api/screener/stocks", {
      min_underlying_price: UNIVERSE.minPrice,
      min_volume: UNIVERSE.minOptionVolume,
      min_oi: UNIVERSE.minOpenInterest,
      min_marketcap: min,
      ...(max === null ? {} : { max_marketcap: max }),
      ...(sessionDate && dating.screenerDate ? { date: sessionDate } : {}),
    }).catch(() => []);
    for (const band of CAP_BANDS) {
      const [min, max] = band;
      const swept = await sweepScreenerBand(band, readBand);
      sweepReads += swept.reads || 0;
      for (const row of swept.rows) if (row && row.ticker) byTicker.set(row.ticker, row);
      const label = max === null
        ? `>= $${(min / 1e9).toFixed(1)}B`
        : `$${(min / 1e9).toFixed(1)}-${(max / 1e9).toFixed(1)}B`;

      if (swept.split) split++;
      saturated += swept.truncated;
      console.log(`  screener ${label.padEnd(14)} ${String(swept.rows.length).padStart(3)} rows` +
                  `${swept.truncated ? " CAP" : "   "}` +
                  `  (union ${byTicker.size})` +
                  (swept.split
                    ? ` — the first page was full, so the band was split into ` +
                      `${swept.leaves.length} and read ${swept.reads} time(s)`
                    : ""));
    }
    screener = [...byTicker.values()];
    screenerReadAt = stampNow();
    screenerTruncated = saturated;
    universeSource = {
      rows: screener, calls: sweepReads, pages: sweepReads, limit: SCREENER_PAGE_ROWS,
      truncated: saturated > 0, repeated: false, errors: [], dated: !!screenerDate, source: "sweep",
      readAt: sweepStartedAt,
    };
    if (saturated) {
      console.warn(
        `  screener: ${saturated} band leaf/leaves still returned the full ` +
        `${SCREENER_PAGE_ROWS}-row page after splitting ${SCREENER_SPLIT_DEPTH} level(s) ` +
        `deep, so those leaves are TRUNCATED and the universe inside them is incomplete.`);
    } else if (split) {
      console.log(`  screener: ${split} full band(s) were split and every leaf read whole`);
    }
  }

  const holdings = await readHoldings(vendor);
  const membership = ndxMembership(holdings.rows, { fallback: NDX_100 });
  const ndx = ndx10(holdings.rows, screener, { fallback: NDX_100 });
  const focusDeep = focusDeepSet(ndx);
  const coverageNotes = [];
  console.log(`  nasdaq-100: ${membership.members.length} member(s) from ` +
    (membership.fallback
      ? `the ${NDX_AS_OF} constant plus the read — FALLBACK: ${membership.fallback}`
      : `the vendor's QQQ holdings dated ${membership.asOf || "undated"}`) +
    (membership.added.length ? `; ${membership.added.length} not in the constant (${membership.added.slice(0, 12).join(", ")})` : "") +
    (membership.dropped.length ? `; ${membership.dropped.length} in the constant and no longer held (${membership.dropped.slice(0, 12).join(", ")})` : ""));
  console.log(`  NDX 10: ${ndx.tickers.join(", ") || "none"} (${ndx.source})`);
  if (membership.fallback) coverageNotes.push(`Nasdaq-100 membership fell back to the ${NDX_AS_OF} constant: ${membership.fallback}.`);
  if (ndx.source.startsWith("fallback")) coverageNotes.push(`The NDX 10 was ranked by market cap (${ndx.source}).`);
  const ndxAge = ndxConstantAge(sessionDate);
  if (ndxAge.stale) {
    coverageNotes.push(`The Nasdaq-100 fallback constant is ${ndxAge.days} days old (dated ${NDX_AS_OF}); refresh it from the QQQ holdings.`);
    console.warn(`  nasdaq-100: the fallback constant is ${ndxAge.days} days old (dated ${NDX_AS_OF})`);
  }
  const guaranteed = [...new Set([...membership.members, ...FOCUS_MAG7, ...FOCUS_MINERS, ...ndx.tickers])];
  {
    const fetched = await fetchMissingMembers(vendor, guaranteed, new Set(screener.map((r) => r && r.ticker)),
      { date: screenerDate });
    if (fetched.rows.length) screener = screener.concat(fetched.rows);
    console.log(`  guaranteed names: ${guaranteed.length}; ${fetched.asked.length} absent from the harvest` +
      (fetched.calls ? `, read by ticker in ${fetched.calls} call(s): ${fetched.rows.length} returned` +
        (fetched.missing.length ? `, ${fetched.missing.length} unknown to the screener (${fetched.missing.slice(0, 12).join(", ")})` : "") +
        (fetched.ok ? "" : ` — the read FAILED (${fetched.error})`) : ""));
  }

  const eligibleFor = (row) => eligible(row) || (!!row && focusDeep.has(row.ticker) && eligible(row, { skipCap: true }));
  const universe = screener.filter(eligibleFor);
  console.log(`universe: ${universe.length} eligible of ${screener.length} screened`);
  if (universe.length < 50) throw new Error(`universe too small (${universe.length}) — refusing to publish`);

  const screenerByTicker = new Map(universe.map((r) => [r.ticker, r]));

  const withTilt = universe.map((row) => ({ row, tilt: screenerTilt(row) }));
  const gateOf = (row) => {
    const dte = daysToEarnings(row, gateOrigin);
    return dte === null || dte < 0 || dte > EARNINGS_GATE_DAYS ? null
      : { earnings: String(row.next_earnings_date).slice(0, 10), dte };
  };
  const tilted = withTilt.filter(({ row }) => !gateOf(row));
  const gatedTickers = new Set(withTilt.filter(({ row }) => gateOf(row)).map(({ row }) => row.ticker));
  console.log(`after earnings gate: ${tilted.length}`);

  const tiltByPick = new Map(withTilt.map(({ row, tilt }) => [row.ticker, tilt]));
  const scoredCoverage = selectCoverage(tilted.map(({ row }) => row), {
    count: UNIVERSE.enrichCount,
    guaranteed,
  });
  const scoredPicked = new Set(scoredCoverage.map(({ row }) => row.ticker));
  const gatedPool = selectCoverage(withTilt.map(({ row }) => row), {
    count: UNIVERSE.enrichCount,
    guaranteed,
  }).filter(({ row }) => !scoredPicked.has(row.ticker) && gatedTickers.has(row.ticker));
  const gatedCoverage = gatedPool.filter(({ row }) => gatedWorthEnriching(row, { focus: focusDeep }));
  const gatedThin = gatedPool.filter(({ row }) => !gatedWorthEnriching(row, { focus: focusDeep })).map(({ row }) => row.ticker);
  const picks = scoredCoverage.concat(gatedCoverage).map(({ row, why }) => ({
    row, why, tilt: tiltByPick.get(row.ticker) || screenerTilt(row), gate: gateOf(row),
  }));
  const byIndex = scoredCoverage.filter((p) => p.why === PICK_INDEX).length;
  const focusMissing = [...focusDeep].filter((t) => !picks.some((p) => p.row.ticker === t));
  console.log(
    `enriching ${picks.length} names: ${scoredCoverage.length - byIndex} by market cap ` +
    `(the largest ${UNIVERSE.enrichCount} of ${tilted.length} gated), ` +
    `${byIndex} added by Nasdaq-100 membership, the Mag 7 and the miners ` +
    `(${membership.fallback ? `constant dated ${NDX_AS_OF}` : `QQQ holdings ${membership.asOf || "undated"}`}), ` +
    `${gatedCoverage.length} inside the ${EARNINGS_GATE_DAYS}-day earnings gate carded without a score` +
    (gatedThin.length ? ` (${gatedThin.length} more gated name(s) skipped before enrichment: their 30-day average ` +
      `dollar volume is under ${Math.round(GATED_LIQUIDITY_MARGIN * 100)}% of the ` +
      `$${(UNIVERSE.minDollarVolume / 1e6).toFixed(0)}M card floor — ${gatedThin.slice(0, 12).join(", ")})` : "") + "; " +
    `${focusDeep.size - focusMissing.length} of ${focusDeep.size} focus name(s) among them` +
    (focusMissing.length ? ` (not screened or not eligible: ${focusMissing.join(", ")})` : ""));

  stages.step("enrich");
  const enriched = [];
  let failed = 0;
  let pastNames = 0, pastBars = 0, pastLatest = null;
  {
    const lane = poolWidth(2);
    console.log(`  enrichment: ${lane.width} name(s) in flight — ${lane.why}`);

    const { results } = await runPooled(picks, async (pick, i) => {
      const ticker = pick.row.ticker;
      const spot = num(pick.row.close);
      try {
        let raw;
        if (DRY_RUN) {
          const fake = fakeEnrichment(ticker, spot, 1000 + i, pick.tilt ? pick.tilt.iv30 : null);
          const past = candleCut(fake.ohlc, sessionDate);
          raw = { ...fake, ohlc: sessionCandles(fake.ohlc, sessionDate) };
          if (past.past) { pastNames++; pastBars += past.past; }
        } else {
          const read = await enrich(ticker, spot, sessionDate, dating);
          raw = read.raw;
          if (read.pastSession) {
            pastNames++;
            pastBars += read.pastSession;
            if (!pastLatest || read.pastLatest > pastLatest) pastLatest = read.pastLatest;
          }
        }
        const features = computeFeatures({ ...raw, ticker, spot, sessionDate, tilt: pick.tilt });
        return { features, raw, tilt: pick.tilt, row: pick.row, gate: pick.gate || null };
      } catch (error) {
        console.warn(`  ${ticker}: enrichment failed — ${error.message}`);
        return null;
      }
    }, { width: lane.width });
    for (const e of results) {
      if (e) enriched.push(e); else failed++;
    }
  }
  console.log(pastNames
    ? `  candles: ${pastNames} name(s) came back with ${pastBars} bar(s) dated after ` +
      `${sessionDate}${pastLatest ? ` (latest ${pastLatest})` : ""} — cut before any feature ` +
      "read them, so no partial session reaches ATR, realized vol, GARCH, returns or the record"
    : `  candles: no name returned a bar dated after ${sessionDate || "the session"}`);
  {
    const onRead = enriched.filter((e) => e.features.spotBasis !== "session-close").length;
    console.log(`  reference price: ${enriched.length - onRead} of ${enriched.length} name(s) ` +
      `priced from the ${sessionDate || "session"} daily close` +
      (onRead ? `; ${onRead} carried no bar for the session and use the screener's read price` : ""));
  }

  const completeness = enriched.length / picks.length;
  console.log(`enrichment: ${enriched.length}/${picks.length} (${(completeness * 100).toFixed(1)}%), ${failed} failed`);
  if (completeness < 0.8) {
    throw new Error(
      `completeness ${(completeness * 100).toFixed(1)}% below the 80% gate — publishing nothing`,
    );
  }

  stages.step("score");
  const MIN_ROWS = 10;

  const scorable = enriched.filter((e) => !e.gate);
  const liquid = scorable.filter((e) => e.features.dollarVolume >= UNIVERSE.minDollarVolume);
  const dropped = scorable.length - liquid.length;
  console.log(
    `liquidity floor: ${liquid.length}/${scorable.length} clear ` +
    `$${(UNIVERSE.minDollarVolume / 1e6).toFixed(0)}M median daily dollar volume` +
    (dropped ? ` (${dropped} dropped)` : ""),
  );
  const byCard = new Map(liquid.map((e) => [e.features.ticker, e]));
  for (const e of enriched) {
    const t = e.features.ticker;
    if (byCard.has(t)) continue;
    if (focusDeep.has(t) || (e.gate && e.features.dollarVolume >= UNIVERSE.minDollarVolume)) byCard.set(t, e);
  }
  const focusCarded = [...focusDeep].filter((t) => byCard.has(t));
  console.log(`  cards planned: ${byCard.size} name(s) — ${liquid.length} scored, ` +
    `${[...byCard.values()].filter((e) => e.gate).length} gated, ` +
    `${focusCarded.length} focus name(s) built deep whatever their board rank`);
  if (liquid.length < 2 * MIN_ROWS) {
    throw new Error(
      `only ${liquid.length} names clear the liquidity floor — publishing nothing ` +
      `rather than a board of names that cannot be traded at these costs`,
    );
  }

  const variationRun = measureVariationProbes(scorable, sessionDate);
  for (const line of variationRun.lines) console.log(line);

  const { kept: unique, dropped: shareClasses } = collapseShareClasses(liquid);
  for (const d of shareClasses) {
    console.log(
      `share class: kept ${d.kept}, dropped ${d.dropped} ` +
      `(same sector and market cap, return correlation ${d.corr.toFixed(3)})`);
  }

  const tiltByTicker = new Map(unique.map((e) => [e.features.ticker, e.tilt]));

  const scored = scoreBoard(

    unique.map((e) => ({ ...e.features, netPrem: netPremiumOf(e.row) })),
    unique.map((e) => e.tilt),
    unique.map((e) => e.row.sector || ""),
    unique.map((e) => num(e.row.marketcap)),
  );

  const generatedAt = stampNow();
  const sides = partitionSides(scored);
  console.log(
    `sides: ${sides.long.length} long, ${sides.short.length} short, ` +
    `${sides.neutral} inside the +-${sides.deadBand} dead band ` +
    `(dispersion ${(scored[0] && scored[0].dispersion || 0).toFixed(3)})`);

  if (!sides.long.length && !sides.short.length) {
    throw new Error(
      `no name on either side cleared the +-${sides.deadBand} dead band across ` +
      `${scored.length} scored names — publishing nothing rather than an empty board`,
    );
  }
  Object.assign(ctx, {
    dating, screener, screenerTruncated, screenerReadAt, screenerFilters, screenerDate, harvest, universeSource,
    vendor, holdings, membership, ndx, focusDeep, coverageNotes, ndxAge, guaranteed, eligibleFor, universe,
    screenerByTicker, withTilt, tilted, picks, enriched, scorable, liquid, byCard, focusCarded, variationRun, unique,
    shareClasses, tiltByTicker, scored, generatedAt, sides,
  });
}
