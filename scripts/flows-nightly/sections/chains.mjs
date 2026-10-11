import { num } from "../../../shared/flows-features.js";
import { vannaScale, chainCallVanna } from "../../../shared/flows-variation.js";
import {
  buildChainPanels, CHAIN_PAGE_SIZE, CHAIN_MAX_PAGES, mergeChainPages, SKEW_MIN_DAYS, summariseSkewMisses,
} from "../../../shared/flows-chain.js";
import {
  rankUnusual, rankUnusualNames, poolOiBasis, UA_MIN_VOLUME, UA_MIN_OI, UNUSUAL_NOTES,
} from "../../../shared/flows-unusual.js";
import { activityBasis } from "../../../shared/flows-activity.js";
import { readActivity, activityEnabled } from "../../flows-legs/activity.mjs";
import { buildFlowAlerts, ALERT_ROWS, alertBand, nightlyAlerts } from "../../../shared/flows-alerts.js";
import { unwrapRows as unwrapVendorRows } from "../../../shared/flows-political.js";
import { parseOptionSymbol } from "../../../shared/flows-premium.js";
import * as QP from "../../flows-quant-pipeline.mjs";
import { readHeldAlerts } from "../../flows-legs/live.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { DRY_RUN } from "../flags.mjs";
import { ALERT_VENDOR_LIMIT, CHAIN_RESERVE_MS, DEADLINE_MS } from "../vendor-params.mjs";
import { poolWidth, runPooled, stats, uw } from "../vendor.mjs";
import { publish, publishedStore, readStored } from "../store.mjs";
import { readDayOf } from "../clock.mjs";
import { BOARD_SCHEMA_VERSION, boardVariationMeta, markNewContracts, priorNote } from "../rank.mjs";
import {
  fakeChain, fakeFlowAlerts, fakeLadderChain, fakeLadders, fakePriorUnusual, fakeTreasury,
} from "../fixtures.mjs";
import { archiveDatedBoards, fetchStoredPayload, republishWithChain } from "../archive.mjs";

export function nearestProbeExpiry(expiryRows, { asOf, minDays = SKEW_MIN_DAYS } = {}) {
  const base = Date.parse(String(asOf) + "T00:00:00Z");
  if (!Number.isFinite(base)) return null;
  const dates = (Array.isArray(expiryRows) ? expiryRows : [])
    .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => {
      const t = Date.parse(d + "T00:00:00Z");
      return Number.isFinite(t) && (t - base) / 86400000 >= minDays;
    })
    .sort();
  return dates.length ? dates[0] : null;
}

export function describeChainProbe(ticker, expiry, rows, { pageSize = CHAIN_PAGE_SIZE, maxList = 6 } = {}) {
  const list = Array.isArray(rows) ? rows : [];

  const seen = [...new Set(list
    .map((r) => {
      const p = parseOptionSymbol(r && r.option_symbol);
      return p ? p.expiry : null;
    })
    .filter(Boolean))].sort();
  const head = `  chain probe (${ticker}, expiry=${expiry}): ${list.length} row(s)`;
  if (!list.length) {
    return [`${head} — the filter was accepted and returned NOTHING, which is` +
      " neither working nor ignored; do not read it as either"];
  }
  const shown = seen.slice(0, maxList).join(", ") + (seen.length > maxList ? ` (+${seen.length - maxList} more)` : "");
  if (seen.length === 1 && seen[0] === expiry) {
    return [`${head} over expiries: ${shown}`,
      list.length >= pageSize
        ? "    FILTER WORKS but this single expiry still fills the page, so the" +
          " strike set is itself a subset — narrowing further is still needed"
        : "    FILTER WORKS: one call identifies the nearest expiry by" +
          " construction. Drop the truncation refusal for scalars read off it."];
  }
  return [`${head} over expiries: ${shown}`,
    `    FILTER IGNORED — ${seen.length} distinct expiries came back for a` +
    " single-expiry request, so narrowing must use `page` instead."];
}

export function vannaProbeSample(ticker, { rows, expiry, sessionDate, expiries, spot }) {
  const exp = expiry || nearestProbeExpiry(expiries, { asOf: sessionDate, minDays: SKEW_MIN_DAYS });
  if (!exp || !sessionDate) return null;
  const chainRows = DRY_RUN
    ? (fakeLadders.has(ticker) ? fakeLadderChain(fakeLadders.get(ticker), exp) : null)
    : rows;
  if (!Array.isArray(chainRows) || !chainRows.length) return null;
  const vendorRow = (expiries || []).find((r) => r && String(r.expiry || "").slice(0, 10) === exp);
  const vendor = vendorRow ? num(vendorRow.call_vanna ?? vendorRow.call_vex, NaN) : NaN;
  if (!Number.isFinite(vendor)) return null;
  const parsed = [];
  for (const r of chainRows) {
    const p = r ? parseOptionSymbol(r.option_symbol) : null;
    if (!p) continue;
    parsed.push({ type: p.type, strike: p.strike, expiry: p.expiry,
      iv: num(r.implied_volatility, NaN), oi: num(r.open_interest, NaN) });
  }
  const model = chainCallVanna(parsed, { spot, asOf: sessionDate, expiry: exp });
  if (!model) return null;
  return { ticker, expiry: exp, vendor, model: model.value, contracts: model.contracts, spot: num(spot, null) };
}

export async function runChains(ctx) {
  const {
    stages, deepTickers, focusCarded, byCard, payloads, sessionDate, variationRun, boardVariation, withTilt,
    generatedAt, tilted, liquid, moversPayload,
  } = ctx;
  const chainByTicker = new Map();
  const quantRows = new Map();
  let quantPass = { preps: new Map(), crossSection: new Map() };
  let quantRate = null;
  const vannaSamples = [];
  const chainMiss = new Map();
  await stages.run("chains", async () => {

  const boardTickers = deepTickers.slice();
  const spotByTicker = new Map();
  for (const t of focusCarded) {
    const px = num(byCard.get(t).features.spot) || num(byCard.get(t).row.close);
    if (px > 0) spotByTicker.set(t, px);
  }
  for (const side of ["long", "short"]) {
    for (const row of payloads[side].rows) {
      const px = num(row.px);
      if (px > 0) spotByTicker.set(row.t, px);
    }
  }

  let chainReported = false;

  let chainProbed = false;
  const expiriesByTicker = new Map([...byCard.values()].map((e) => [e.features.ticker, e.raw.expiries || []]));
  const spotOfLiquid = new Map([...byCard.values()].map((e) => [e.features.ticker, e.features.spot]));

  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  chains: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${boardTickers.length} calls on panels that would land after the cards were abandoned`);
  } else {
    const chainDeadline = stats.startedAt + DEADLINE_MS - CHAIN_RESERVE_MS;
    let scalarsRecovered = 0;

    const paging = { names: 0, extra: 0, completed: 0, stillFull: 0, ignored: 0, oneBased: 0 };

    const chainLane = poolWidth();
    console.log(`  chains: ${boardTickers.length} name(s), ${chainLane.width} in flight — ${chainLane.why}`);
    const chainRun = await runPooled(boardTickers, async (ticker, index) => {
      try {
        const readPage = async (page) => (DRY_RUN

          ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 7000 + index,
            { wide: index < 4, page: index === 0 ? page : index === 2 ? Math.max(0, page - 1) : 0 })
          : await uw(`/api/stock/${ticker}/option-contracts`, {

            exclude_zero_oi_chains: "true",
            limit: CHAIN_PAGE_SIZE,
            ...(page ? { page } : {}),
          }));
        const firstPage = await readPage(0);
        const pages = [firstPage];
        let nextPage = 1, countedFromOne = false;
        while (pages[pages.length - 1].length >= CHAIN_PAGE_SIZE && pages.length < CHAIN_MAX_PAGES &&
               Date.now() < chainDeadline) {
          let next;
          try { next = await readPage(nextPage); } catch (error) {
            console.warn(`  chain ${ticker}: page ${nextPage} failed — ${error.message}`);
            break;
          }
          next = Array.isArray(next) ? next : [];
          nextPage++;
          if (nextPage === 2 && next.length &&
              mergeChainPages([firstPage, next]).duplicates === next.length) {
            countedFromOne = true;
            continue;
          }
          pages.push(next);
          if (mergeChainPages(pages).duplicates) break;
        }
        const merged = mergeChainPages(pages);
        const rows = merged.rows;
        quantRows.set(ticker, rows.slice());
        if (nextPage > 1) {
          paging.names++;
          paging.extra += nextPage - 1;
          if (merged.complete) paging.completed++;
          else if (merged.duplicates || (countedFromOne && pages.length === 1)) paging.ignored++;
          else paging.stillFull++;
          if (countedFromOne && !merged.duplicates && pages.length > 1) paging.oneBased++;
        }

        if (!chainReported && rows.length) {
          chainReported = true;
          const first = rows[0];
          const want = ["option_symbol", "nbbo_bid", "nbbo_ask", "implied_volatility",
                        "volume", "ask_volume", "bid_volume", "open_interest", "prev_oi"];
          const present = want.filter((k) => first[k] !== undefined);
          const missing = want.filter((k) => first[k] === undefined);
          console.log(`  chain fields (${ticker}, ${rows.length} rows): ${present.join(", ")}`);
          if (missing.length) {
            console.warn(`    NOTE: absent on the first row: ${missing.join(", ")}` +
              ` — keys actually present: ${Object.keys(first).slice(0, 24).join(", ")}`);
          }
        }

        let panels = buildChainPanels(rows, {
          spot: spotByTicker.get(ticker) || null,
          asOf: sessionDate,
          ticker,
          ...(pages.length > 1 ? { complete: merged.complete, pages: pages.length } : {}),
        });
        let vannaRows = panels.status === "ok" && !panels.truncated ? rows : null;
        let vannaExpiry = null;

        if (panels.status === "ok" && panels.truncated && Date.now() < chainDeadline) {
          const near = nearestProbeExpiry(expiriesByTicker.get(ticker), {
            asOf: sessionDate, minDays: SKEW_MIN_DAYS,
          });
          if (near) {
            try {
              const narrow = DRY_RUN

                ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 8000 + index,
                  { wide: true, expiry: near })
                : await uw(`/api/stock/${ticker}/option-contracts`, {
                  expiry: near,
                  exclude_zero_oi_chains: "true",
                  limit: CHAIN_PAGE_SIZE,
                });
              if (Array.isArray(narrow) && narrow.length && narrow.length < CHAIN_PAGE_SIZE) {
                vannaRows = narrow;
                vannaExpiry = near;
              }
              if (Array.isArray(narrow) && narrow.length) quantRows.set(ticker, narrow.concat(quantRows.get(ticker) || []));
              const narrowPanels = buildChainPanels(narrow, {
                spot: spotByTicker.get(ticker) || null,
                asOf: sessionDate,
                ticker,
                requestedExpiry: near,
              });

              if (narrowPanels.status === "ok" && narrowPanels.identifiedExpiry) {
                panels = {
                  ...panels,
                  scalars: narrowPanels.scalars,
                  identifiedExpiry: narrowPanels.identifiedExpiry,
                  skewTerm: narrowPanels.skewTerm.status === "ok"
                    ? narrowPanels.skewTerm : panels.skewTerm,
                };
                scalarsRecovered++;
              }
            } catch (error) {
              console.warn(`  chain ${ticker}: single-expiry read failed — ${error.message}`);
            }
          }
        }

        try {
        if (!chainProbed && panels.truncated) {
          const probeExpiry = nearestProbeExpiry(expiriesByTicker.get(ticker), {
            asOf: sessionDate, minDays: SKEW_MIN_DAYS,
          });
          if (probeExpiry) {
            chainProbed = true;
            try {
              const probeRows = DRY_RUN

                ? fakeChain(ticker, spotByTicker.get(ticker) || 100, 9000).slice(0, 40)
                : await uw(`/api/stock/${ticker}/option-contracts`, {
                  expiry: probeExpiry,
                  exclude_zero_oi_chains: "true",
                  limit: CHAIN_PAGE_SIZE,
                });
              for (const line of describeChainProbe(ticker, probeExpiry, probeRows)) {
                console.log(line);
              }
            } catch (error) {
              console.warn(`  chain probe (${ticker}, expiry=${probeExpiry}): ${error.message}` +
                " — the parameter may be rejected outright, which is itself an answer");
            }
          }
        }
        } catch (error) {
          console.warn(`  chain probe (${ticker}): ${error.message} — the chain itself stands`);
        }
        try {
          const sample = vannaProbeSample(ticker, {
            rows: vannaRows, expiry: vannaExpiry, sessionDate,
            expiries: expiriesByTicker.get(ticker),
            spot: spotOfLiquid.get(ticker) || spotByTicker.get(ticker) || null,
          });
          if (sample) vannaSamples.push(sample);
        } catch (error) {
          console.warn(`  vanna check (${ticker}): ${error.message}`);
        }
        return panels;
      } catch (error) {
        console.warn(`  chain ${ticker}: ${error.message}`);
        return null;
      }
    }, {
      width: chainLane.width,

      stopEarly: () => Date.now() > chainDeadline,
    });

    let chainOk = 0, chainFailed = 0, chainSkipped = 0;
    boardTickers.forEach((ticker, i) => {
      if (!chainRun.attempted[i]) { chainSkipped++; return; }
      const panels = chainRun.results[i];
      if (!panels) {
        chainFailed++;
        chainMiss.set(ticker, "the option-chain read for this name failed this session, so " +
          "no contract-level panel could be built from it — the failure is named in the run " +
          "log, and the next run reads the chain again");
        return;
      }
      chainByTicker.set(ticker, panels);
      if (panels.status === "ok") chainOk++; else chainFailed++;
    });
    if (chainSkipped) {
      console.warn(
        `  chains: stopped after ${chainOk + chainFailed} names, ${chainSkipped} not attempted ` +
        `— within ${CHAIN_RESERVE_MS / 60000}min of the deadline and the cards still need it`);
    }
    const built = [...chainByTicker.entries()].filter(([, c]) => c.status === "ok");
    const levelled = built.filter(([, c]) => c.scalars.atmIv !== null).length;
    const skewed = built.filter(([, c]) => c.scalars.skew !== null).length;
    if (paging.names) {
      console.log(
        `  chains: ${paging.names} full first page(s) read on with ${paging.extra} further ` +
        `page call(s) (up to ${CHAIN_MAX_PAGES} pages a name): ${paging.completed} now complete, ` +
        `${paging.stillFull} still full at the last page` +
        (paging.ignored
          ? `, ${paging.ignored} where a later page repeated contracts already read — ` +
            "PAGE IGNORED or the order is unstable, so those stay truncated rather than claimed whole"
          : "") +
        (paging.oneBased
          ? `; on ${paging.oneBased} name(s) page=1 returned the first page again, so the ` +
            "vendor was read as counting pages from one there (the spec says zero)"
          : ""));
    }
    console.log(
      `  chains: ${chainOk} built, ${chainFailed} failed` +
      (chainSkipped ? `, ${chainSkipped} skipped for the deadline` : "") +
      `; ${levelled} levelled, ${skewed} with a skew reading` +
      (scalarsRecovered
        ? `, ${scalarsRecovered} of them recovered by a second single-expiry call`
        : ""));

    for (const [t, c] of built) {
      if (c.skewTerm.status !== "ok") continue;
      if (c.scalars.skew === null) console.warn(`    ${t}: no skew — ${c.skewTerm.skewReason}`);
      if (c.scalars.atmIv === null) console.warn(`    ${t}: no ATM level — ${c.skewTerm.atmReason}`);
      if (c.foreignRows) console.warn(`    ${t}: dropped ${c.foreignRows} adjusted-series row(s)`);
    }

    const misses = [];
    for (const [, c] of built) {
      if (c.skewTerm.status !== "ok" || c.scalars.skew !== null) continue;
      if (c.skewTerm.skewMiss) misses.push(c.skewTerm.skewMiss);
    }
    if (misses.length) {

      const sum = summariseSkewMisses(misses);
      console.log(
        `  skew misses: ${sum.names} name(s) with no reading, ${sum.wings} wing(s) between ` +
        `them — ${sum.outside} listed and priced but outside the ${sum.tolerance} window, ` +
        `${sum.unpriced} listed with no implied volatility, ${sum.unlisted} not listed at all` +
        (sum.inside
          ? `, ${sum.inside} already inside the window (the OTHER wing is what failed on ` +
            `those names, so no widening helps them)`
          : "") +
        (sum.outside
          ? `. Nearest misses ${sum.gaps.slice(0, 5).map((g) => g.toFixed(4)).join(", ")}` +
            `; a window of 0.05 would reach ${sum.wouldCatch(0.05)} of those WINGS, ` +
            `0.06 ${sum.wouldCatch(0.06)}, 0.08 ${sum.wouldCatch(0.08)} — and a name needs ` +
            `BOTH wings, so wings caught is an upper bound on readings recovered, not a count ` +
            `of them`
          : "") +
        ". A wider window reaches only the outside group; the rest are coverage facts no " +
        "constant can fix.");
    }

    if (built.length && !levelled) {
      console.warn(
        "  chains: NOT ONE name carried an at-the-money level. Every level requires a " +
        "contract that traded today, so this reads as `volume` being absent or zero " +
        "chain-wide at this hour rather than as a quiet session.");
    }
  }

  try {
    const atrOfLiquid = new Map([...byCard.values()].map((e) => [e.features.ticker, e.features.atr]));
    const spotOfQuant = (t) => spotOfLiquid.get(t) || spotByTicker.get(t) || null;
    const needTreasury = !QP.PARITY_SYMBOLS.some((sym) => quantRows.has(sym) && spotOfQuant(sym) > 0);
    const treasuryRaw = !needTreasury ? null : DRY_RUN ? fakeTreasury(sessionDate)
      : await uw("/api/economy/treasury-yield", { interval: "daily", maturity: "3month" }).catch(() => null);
    quantRate = QP.rateFromRuns({ rowsByTicker: quantRows, spotOf: spotOfQuant, sessionDate, treasuryRaw });
    const t0 = Date.now();
    quantPass = QP.preparePass({
      rowsByTicker: quantRows, sessionDate, rate: quantRate, spotOf: spotOfQuant,
      atrOf: (t) => atrOfLiquid.get(t) || null, expiriesOf: (t) => expiriesByTicker.get(t) || [],
      gammaUnit: variationRun.unit.used,
    });
    const zeros = [...quantPass.preps.values()].filter((p) => p.zero && p.zero.px !== null).length;
    const slices = [...quantPass.preps.values()].reduce((a, p) => a + p.built.length, 0);
    console.log(`  quant: rate ${quantRate.r} (${quantRate.method}); ${quantPass.preps.size} name(s) fitted from NBBO quotes, ` +
      `${slices} expiry smile(s), ${zeros} with a zero-gamma level, in ${Date.now() - t0}ms`);
  } catch (error) {
    console.warn(`  quant: the smile pre-pass failed — ${error.message}; cards publish without an engine block`);
  }

  variationRun.vannaScale = vannaScale(vannaSamples, { prior: variationRun.unit.used });
  console.log(`  variation: vanna scale ${variationRun.vannaScale.status}` +
    (variationRun.vannaScale.ratio === null ? "" : `, vendor over Black-Scholes ${variationRun.vannaScale.ratio}`) +
    ` across ${variationRun.vannaScale.n} name(s) with a complete single-expiry chain` +
    `, read in ${variationRun.vannaScale.used === "pct$" ? "dollars per 1% move" : "shares"} (unit ${variationRun.vannaScale.family}: ` +
    `${variationRun.vannaScale.votes.share} share, ${variationRun.vannaScale.votes.pct} dollars-per-1% among names priced far enough from $100 to tell them apart; ` +
    `mean log error ${variationRun.vannaScale.evidence.errorShare} in shares against ${variationRun.vannaScale.evidence.errorPct} in dollars per 1%, ` +
    `log10 likelihood ratio ${variationRun.vannaScale.evidence.log10Ratio} with 2 needed)` +
    (variationRun.vannaScale.reason ? ` — ${variationRun.vannaScale.reason}` : ""));
  const refreshVariation = variationRun.vannaScale.status === "unmeasured" ? null : (row) => {
    const next = boardVariation(row.t);
    if (!next) return false;
    row.variation = next;
    return true;
  };

  for (const line of await republishWithChain(payloads, chainByTicker, sessionDate, publish,
    refreshVariation, boardVariationMeta(variationRun))) {
    console.log(line);
  }
  if (!chainByTicker.size) {
    for (const line of await archiveDatedBoards(payloads, sessionDate, publish)) {
      console.log(line);
    }
  }

  try {
    const pooled = [];
    const coverage = [];
    let namesTruncated = 0, foreign = 0;
    const divisors = new Set();
    for (const [ticker, c] of chainByTicker) {
      if (!c || c.status !== "ok" || !Array.isArray(c.unusualRows)) continue;
      pooled.push(...c.unusualRows);
      if (c.truncated) namesTruncated++;
      foreign += Number(c.foreignRows) || 0;
      if (Number.isFinite(c.ivDivisor)) divisors.add(c.ivDivisor);
      coverage.push({
        t: ticker,
        rows: Number(c.rowsSeen) || 0,
        pages: Number(c.pagesRead) || 1,
        p: c.truncated ? 1 : 0,
        ivDivisor: Number.isFinite(c.ivDivisor) ? c.ivDivisor : null,
        ivBasis: c.ivBasis || null,
      });
    }
    const namesSeen = coverage.length;
    const contracts = rankUnusual(pooled, { namesSeen });
    const pooledOiBasis = poolOiBasis(
      [...chainByTicker.values()].filter((c) => c && c.status === "ok").map((c) => c.oiBasis),
      { dryRun: DRY_RUN });
    const names = rankUnusualNames(withTilt);

    const priorUnusual = DRY_RUN
      ? fakePriorUnusual(contracts.rows, sessionDate)
      : await fetchStoredPayload("unusual");

    const priorMark = markNewContracts(contracts.rows, priorUnusual, sessionDate);

    const dated = await readActivity({
      uw, sessionDate, contractRows: contracts.rows, enabled: activityEnabled(), dryRun: DRY_RUN,
    });
    const activity = dated.block;

    await publish("unusual", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt: generatedAt,
      volumeAsOf: null,
      volumeAsOfReason: "the chain endpoint accepts no date parameter and carries no as-of stamp",
      dteAnchor: "sessionDate",
      status: contracts.shown ? "ok" : (namesSeen ? "quiet" : "pending"),

      complete: namesSeen ? namesTruncated === 0 : null,
      namesSeen,
      namesTruncated,
      namesComplete: namesSeen - namesTruncated,
      foreign,
      ivConventionsSeen: divisors.size,

      prior: {
        status: priorMark.status,
        readAt: priorMark.readAt,
        sessionDate: priorMark.sessionDate,
        contracts: priorMark.contracts,
        fresh: priorMark.fresh,
        note: priorNote(priorMark, sessionDate, contracts.rows.length),
      },
      coverage,
      contracts,
      activity,
      names: { ...names, earningsGated: withTilt.length - tilted.length },
      basis: {
        unit: UNUSUAL_NOTES.unit,
        date: UNUSUAL_NOTES.date,
        rank: { key: "vor", choice: true, relation: "vor = volume / open_interest",
          reason: UNUSUAL_NOTES.rank },
        oiBasis: {
          chains: pooledOiBasis.chains, seen: pooledOiBasis.seen,
          exceeded: pooledOiBasis.exceeded, exceedShare: pooledOiBasis.exceedShare,
          minSeen: pooledOiBasis.minSeen, verdict: pooledOiBasis.verdict,
        },
        floors: { minVolume: UA_MIN_VOLUME, minOi: UA_MIN_OI, perName: contracts.perName,
          choice: true,
          reason: "A minimum volume keeps a 200-lot on a five-contract open interest " +
            "from dominating the ranking with a vor of forty; a minimum open interest " +
            "is the denominator, and is what makes vor finite by construction." },

        aggr: (() => {
          for (const c of chainByTicker.values()) {
            const r = c && c.topContracts && c.topContracts.relation;
            if (typeof r === "string" && r) return r;
          }
          return null;
        })(),

        new: "`nw` is 1 when this contract was absent from the previously published " +
          "counter feed, 0 when it was present in it, and null when NO comparison was " +
          "made — the earlier feed could not be read, or named nothing this run can " +
          "identify, or turned out to be this run's own output from a second run against " +
          "one session, which would have marked every line carried over. `prior.status` " +
          "says which of the six happened, `prior.note` says it in a sentence, and " +
          "`prior.sessionDate` and `prior.readAt` name the session and the read time the " +
          "comparison was made against. It is a statement about this list, not about the " +
          "strike: a contract can be absent from the earlier feed because it was quiet, or " +
          "because it sat below the per-name cap on that run.",
        lift: UNUSUAL_NOTES.lift,
        activity: activityBasis(),
        notional: UNUSUAL_NOTES.notional,
        iv: UNUSUAL_NOTES.iv,
        oi: UNUSUAL_NOTES.oi,
        zeroOi: UNUSUAL_NOTES.zeroOi,
        names: UNUSUAL_NOTES.names,
        refusals: UNUSUAL_NOTES.refusals,
      },
    });
    console.log(`  unusual dated classes: ${activity.status}` + (activity.code ? ` (${activity.code})` : "") +
      (activity.status === "ok" || activity.status === "quiet"
        ? `; ${activity.returned} row(s) read for ${activity.asOf}, ${activity.kept} kept, ${activity.offDate} off-session dropped, ` +
          `${activity.matched} of ${activity.of} ranked contract(s) carry classes, ${dated.calls} call(s)` : ""));
    console.log(
      `  unusual: ${contracts.shown} of ${contracts.eligible} contracts over ` +
      `${namesSeen} chain(s) (cap bound by ${contracts.capBound}, ${contracts.perName} per name); ` +
      `${names.shown} of ${names.ranked} names ranked of ${names.universe}` +
      (names.unranked ? `, ${names.unranked} unranked for want of a 30-day average` : "") +
      (divisors.size > 1 ? `; ${divisors.size} IV conventions in one table` : ""));

    console.log("  unusual memory: " + (DRY_RUN ? "[dry-run] " : "") + priorMark.status + " — " + (
      priorMark.status === "ok" || priorMark.status === "undated"
        ? `${priorMark.fresh} of ${contracts.rows.length} contract(s) absent from the ` +
          `${priorMark.contracts}-contract feed published for ` +
          `${priorMark.sessionDate || "an unstamped session"}` +
          (priorMark.status === "undated"
            ? " — which this run could NOT check was an earlier session than its own"
            : "")
        : priorMark.status === "same-session"
          ? `the prior feed is stamped ${priorMark.sessionDate}, the session this run is ` +
            `publishing, so it is this run's own output rather than a prior session: its ` +
            `${priorMark.contracts} contract(s) were discarded and no row claims to be new`
          : priorMark.status === "ahead"
            ? `the prior feed is stamped ${priorMark.sessionDate}, a LATER session than the ` +
              `${sessionDate} this run is publishing, so it cannot be this run's yesterday: ` +
              `its ${priorMark.contracts} contract(s) were discarded and no row claims to be new`
            : priorMark.status === "quiet"
              ? "the prior feed was read and named no contracts this run can identify, so no " +
                "row claims to be new"
              : "no prior feed could be read, so no row claims to be new"));

    console.log("  " + pooledOiBasis.line +
      (DRY_RUN
        ? " On synthetic rows this is two unrelated fixture formulas disagreeing," +
          " and is not evidence about the vendor."
        : ""));

    try {
      const raw = DRY_RUN
        ? fakeFlowAlerts((payloads.long.rows || []).map((r) => r.t))
        : await uw("/api/option-trades/flow-alerts", { limit: ALERT_VENDOR_LIMIT });
      const alertsReadAt = stampNow();

      const vendorRows = unwrapVendorRows(raw);
      const alertRowCount = vendorRows.length;

      const survivors = new Set((tilted || []).map((x) => x.row && x.row.ticker));
      const stage = new Map();
      for (const { row } of withTilt || []) {
        if (row && row.ticker) stage.set(row.ticker, survivors.has(row.ticker) ? "eligible" : "gated");
      }
      for (const e of liquid || []) if (e && e.row && e.row.ticker) stage.set(e.row.ticker, "scored");
      for (const side of ["long", "short"]) {
        for (const r of (payloads[side] && payloads[side].rows) || []) {
          if (r && r.t) stage.set(r.t, "board:" + side);
        }
      }

      const alerts = buildFlowAlerts(raw, { stageOf: (t) => stage.get(t) || null });
      const night = nightlyAlerts(alerts, await readHeldAlerts(readStored, sessionDate),
        { sessionDate, at: alertsReadAt, stageOf: (t) => stage.get(t) || null });
      let liveAlerts = night.held;
      if (night.alerts) {
        liveAlerts = {
          v: BOARD_SCHEMA_VERSION,
          generatedAt, sessionDate,

          readAt: alertsReadAt,
          readDay: readDayOf(alertsReadAt),
          refreshed: "nightly",
          ...night.alerts,

          vendorLimit: ALERT_VENDOR_LIMIT,
          vendorTruncated: alertRowCount >= ALERT_VENDOR_LIMIT,
          readLimit: night.readLimit,
          readTruncated: night.readTruncated,
        };
        await publish("flowalerts", liveAlerts);
      } else if (night.held) {
        publishedStore.flowalerts = night.held;
      }
      const nightSaid = {
        merged: () => `merged into the ${sessionDate} intraday record, now ${night.alerts.record.reads} ` +
          `read(s) holding ${night.alerts.rows.length} of ${night.alerts.seen} window(s) ` +
          `(${night.alerts.record.entered} new, ${night.alerts.record.again} seen again)`,
        kept: () => `NOT WRITTEN — the store holds the ${sessionDate} intraday record and this read ` +
          "shaped no rows, so the record stands rather than being replaced by an empty read",
        newer: () => `NOT WRITTEN — the store holds the ${night.day} intraday record, a later session ` +
          `than ${sessionDate}, and a read published under ${sessionDate} would replace it`,
        unverified: () => "NOT WRITTEN — the stored feed could not be read, so whether it is this " +
          "session's intraday record is unknown and a single read would replace it; the brief " +
          "states no alert count",
        snapshot: () => `published as a single read — the store holds no intraday record for ${sessionDate}`,
      };
      console.log("  flow-alerts: " + nightSaid[night.mode]());
      console.log(
        `  flow-alerts: ${alerts.rows.length} alert(s) kept of ${alerts.seen}` +
        (alertRowCount >= ALERT_VENDOR_LIMIT
          ? ` — WHICH IS THE VENDOR'S MAXIMUM (${ALERT_VENDOR_LIMIT}), so the true ` +
            "population is unknown and at least that large; this route's limit " +
            "cannot be raised, and today's count is a ceiling rather than a measurement"
          : "") +
        (alerts.shed ? ` (${alerts.shed} shed by the ${ALERT_ROWS}-row cap)` : "") +
        (alerts.unusable ? `, ${alerts.unusable} unusable` : "") +
        `; ${alerts.coverage.sweeps} sweep-flagged, ${alerts.coverage.opening} all-opening, ` +
        `${alerts.coverage.calls}C/${alerts.coverage.puts}P of ${alerts.coverage.withContract} with a parsed contract`);
      const first = vendorRows.find((r) => r && typeof r === "object") || null;
      console.log(`  flow-alerts: time fields on the first row — start_time ${first ? typeof first.start_time : "absent"}, ` +
        `end_time ${first ? typeof first.end_time : "absent"}, created_at ${first ? typeof first.created_at : "absent"}; ` +
        `${alerts.coverage.withSpan} of ${alerts.rows.length} kept rows carry a window` +
        (alerts.coverage.spanFromCreated ? `, ${alerts.coverage.spanFromCreated} of them dated only by created_at` : ""));
      if (alerts.rows.length && alerts.coverage.withSpan < alerts.rows.length / 2) {
        console.warn(`  flow-alerts: NOTE only ${alerts.coverage.withSpan} of ${alerts.rows.length} kept rows carry a ` +
          "time window, so the Window column is mostly a dash and repeated windows on one contract " +
          "collapse into one row of the day's record — first-row sample: " +
          JSON.stringify(first ? { start_time: first.start_time ?? null, end_time: first.end_time ?? null,
            created_at: first.created_at ?? null } : null));
      }

      if (moversPayload) {
        try {
          moversPayload.premium = { ...moversPayload.premium,
            byContract: alertBand(liveAlerts && Array.isArray(liveAlerts.rows) ? liveAlerts.rows : alerts.rows) };
          await publish("movers", moversPayload);
          console.log(`  movers band: ${moversPayload.premium.byContract.rows.length} contract window(s) ` +
            `of ${moversPayload.premium.byContract.seen} priced alerts`);
        } catch (error) {
          console.warn(`  movers band: ${error.message} — movers stand as first published, without the band`);
        }
      }
    } catch (error) {
      console.warn(`  flow-alerts: ${error.message} — the counter feed above published before this leg ran`);
    }
  } catch (error) {
    console.warn(`  unusual: ${error.message}`);
  }

  }, (error) => {
    console.warn(`  chains: ${error.message} — the boards published before this leg ran ` +
      "and are unaffected");
  });
  Object.assign(ctx, { chainByTicker, quantPass, quantRate, chainMiss });
}
