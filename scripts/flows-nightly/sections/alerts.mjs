import { sessionPrints, sessionPrintParams } from "../../../shared/flows-positioning.js";
import { buildPulse, PULSE_FEEDS, PULSE_CAPS } from "../../../shared/flows-pulse.js";
import { buildPolitical, POLITICAL_FEEDS, unwrapRows as unwrapVendorRows } from "../../../shared/flows-political.js";
import { totalsHistory } from "../../flows-legs/market.mjs";
import { makeFakeVendor } from "../../flows-legs/fake-vendor.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { DRY_RUN } from "../flags.mjs";
import { MARKET_CROSS_LIMIT, NEWS_VENDOR_LIMIT, deepNames } from "../vendor-params.mjs";
import { uw } from "../vendor.mjs";
import { publish } from "../store.mjs";
import { PIPELINE_CADENCE, readDayOf } from "../clock.mjs";
import { BOARD_SCHEMA_VERSION, NEWS_ROWS, SECTOR_ETFS, holdersRefusal, sectorLean, shapeNews } from "../rank.mjs";
import { fakeNewsHeadlines, fakePoliticalRaws, fakePulseRaws, fakeSectorEtfs } from "../fixtures.mjs";
import { fetchStoredPayload } from "../archive.mjs";

export const PULSE_TOTALS_HISTORY = 252;

export async function publishPulse({ sessionDate, generatedAt, tickers = [] }) {
  let crossRaws = null;

  try {
    const PULSE_FETCHES = {
      tide: ["/api/market/market-tide", { interval_5m: "true" }],
      totals: ["/api/market/total-options-volume", { limit: PULSE_TOTALS_HISTORY }],
      oiChange: ["/api/market/oi-change", { limit: MARKET_CROSS_LIMIT }],
      netImpact: ["/api/market/top-net-impact", { limit: PULSE_CAPS.netImpact }],
      insiders: ["/api/market/insider-buy-sells", { limit: PULSE_CAPS.insiders }],
      darkpool: ["/api/darkpool/recent", { limit: MARKET_CROSS_LIMIT,
        ...sessionPrintParams(sessionDate, { windowed: false }) }],
      seasonality: ["/api/seasonality/market", {}],
    };
    const raws = {};
    if (DRY_RUN) {
      Object.assign(raws, fakePulseRaws(tickers));
    } else {
      for (const [feed, [path, params]] of Object.entries(PULSE_FETCHES)) {
        try {
          raws[feed] = await uw(path, params);
        } catch (error) {
          raws[feed] = { __failed: error && error.message ? error.message : String(error) };
        }
      }
    }
    const readAt = stampNow();

    raws.darkpool = sessionPrints(raws.darkpool, sessionDate, { limit: MARKET_CROSS_LIMIT });
    crossRaws = { oiChange: raws.oiChange, darkpool: raws.darkpool, readAt };
    const pulse = buildPulse(raws);
    if (pulse.darkpool && raws.darkpool && raws.darkpool.session) pulse.darkpool.session = raws.darkpool.session;
    pulse.totalsHistory = totalsHistory(unwrapVendorRows(DRY_RUN
      ? await makeFakeVendor({ sessionDate })("/api/market/total-options-volume", { limit: PULSE_TOTALS_HISTORY })
      : raws.totals), { sessionDate });
    for (const feed of PULSE_FEEDS) {
      const f = pulse[feed];
      if (f.status === "quiet") {
        const first = (Array.isArray(raws[feed]) ? raws[feed] : (raws[feed] && raws[feed].data) || [])[0];
        if (first && typeof first === "object") {
          console.log(`  pulse ${feed}: NOTE returned rows but none shaped — first-row keys: ` +
            Object.keys(first).slice(0, 24).join(", "));
        }
      }
    }
    await publish("pulse", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt,
      readDay: readDayOf(readAt),
      refreshed: "nightly",
      ...pulse,
    });
    const okCount = PULSE_FEEDS.filter((f) => pulse[f].status === "ok").length;
    console.log(`  pulse: ${okCount} of ${PULSE_FEEDS.length} feeds ok — ` +
      PULSE_FEEDS.map((f) => `${f}:${pulse[f].status}${pulse[f].rows ? ":" + pulse[f].rows.length : pulse[f].points ? ":" + pulse[f].points.length : ""}`).join(" "));
  } catch (error) {
    console.warn(`  pulse: ${error.message} — every key above published before this leg ran`);
  }
  return crossRaws;
}

export async function publishSectorPremium({ sessionDate, generatedAt }) {
  try {
    const raw = DRY_RUN
      ? fakeSectorEtfs()
      : await uw("/api/market/sector-etfs", {});
    const readAt = stampNow();
    const wire = unwrapVendorRows(raw);
    const sectors = sectorLean(raw);
    const measured = sectors.filter((s) => s.read === "ok").length;
    const quiet = sectors.filter((s) => s.read === "quiet").length;

    if (wire.length && measured + quiet < SECTOR_ETFS.length / 2) {
      const first = wire[0];
      if (first && typeof first === "object") {
        console.log("  sector:premium: NOTE returned rows but few shaped — first-row keys: " +
          Object.keys(first).slice(0, 24).join(", "));
      }
    }

    await publish("sector:premium", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt,
      readDay: readDayOf(readAt),
      refreshed: "nightly",
      vendorDated: false,
      basis: "SPDR Select Sector ETFs, not GICS index levels",

      units: {
        bullishPremiumUsd: "usd", bearishPremiumUsd: "usd",
        grossPremiumUsd: "usd", netPremiumUsd: "usd",
        leanRatio: "ratio", changeRatio: "ratio",
        callVolume: "contracts", putVolume: "contracts", stockVolume: "shares",
      },

      lean: {
        rank: "leanRatio",
        relation: "netPremiumUsd = bullishPremiumUsd - bearishPremiumUsd; " +
          "grossPremiumUsd = bullishPremiumUsd + bearishPremiumUsd; " +
          "leanRatio = netPremiumUsd / grossPremiumUsd",
        choice: true,
        rejected: "ranking the eleven on netPremiumUsd, which ranks them by " +
          "sector size: XLK clears three orders of magnitude more premium than " +
          "XLB on an ordinary day, so the dollar difference is dominated by the " +
          "basket rather than by the lean",
        undefinedAtZero: "leanRatio is null when grossPremiumUsd is 0 (0/0 is " +
          "undefined, not neutral); netPremiumUsd stays a visible measured 0",
      },

      notSameAs: "sector:trix — that key is TRIX on daily closes and contains " +
        "no option data; the two may disagree for weeks and neither is wrong",
      sectors,
      returned: wire.length,
      measured, quiet,
      unreadable: sectors.filter((s) => s.read === "unreadable").length,

      status: measured + quiet > 0 ? "ok" : (wire.length ? "unreadable" : "quiet"),
    });
    console.log(`  sector:premium: ${measured}/${SECTOR_ETFS.length} sectors leaned` +
      (quiet ? `, ${quiet} measured-and-empty` : "") +
      ` from ${wire.length} vendor row(s)`);
    for (const s of sectors) {
      if (s.reason) console.warn(`    ${s.sector} (${s.etf}): ${s.read} — ${s.reason}`);
    }
  } catch (error) {
    console.warn(`  sector:premium: ${error.message} — every key above published before this leg ran`);
  }
}

export async function publishNews({ sessionDate, generatedAt, tickers = [] }) {
  try {
    const raw = DRY_RUN
      ? fakeNewsHeadlines(tickers)
      : await uw("/api/news/headlines", { limit: NEWS_VENDOR_LIMIT });
    const readAt = stampNow();
    const wire = unwrapVendorRows(raw);

    const news = shapeNews(raw, { requested: NEWS_VENDOR_LIMIT });

    if (news.status === "unreadable") {
      const first = wire[0];
      if (first && typeof first === "object") {
        console.log("  news: NOTE returned rows but none shaped — first-row keys: " +
          Object.keys(first).slice(0, 24).join(", "));
      }
    }

    await publish("news", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      readAt,
      readDay: readDayOf(readAt),
      refreshed: "nightly",

      cadence: PIPELINE_CADENCE,
      staleBy: "the next weekday's close",
      units: { returned: "rows", kept: "rows", shed: "rows", requested: "rows" },
      scope: "market-wide; `ticker` on this route is a filter on the same path, " +
        "so per-name news is a filter of `rows[].tickers` rather than a call",
      ...news,
    });
    console.log(`  news: ${news.kept} headline(s) kept of ${news.returned} returned` +
      (news.shed ? ` (${news.shed} shed by the ${NEWS_ROWS}-row cap)` : "") +
      (news.atVendorLimit
        ? ` — WHICH IS THE VENDOR'S MAXIMUM (${NEWS_VENDOR_LIMIT}), so the true ` +
          "population is unknown and at least that large"
        : "") +
      (news.unusable ? `, ${news.unusable} unusable` : "") +
      (news.undatedSeen
        ? `, ${news.undatedSeen} undated on the wire (${news.undatedKept} of them kept)`
        : "") +
      `; window ${news.oldest || "—"} .. ${news.newest || "—"}`);
  } catch (error) {
    console.warn(`  news: ${error.message} — every key above published before this leg ran`);
  }
}

export async function runAlerts(ctx) {
  const { stages, sessionDate, generatedAt, payloads, published, deepSet } = ctx;
  stages.step("pulse");
  const crossRaws = await publishPulse({
    sessionDate, generatedAt, tickers: (payloads.long.rows || []).map((r) => r.t),
  });

  let politicalFilings = null;

  const POLITICAL_WINDOW_DAYS = 90;

  await stages.run("political", async () => {
    const POLITICAL_PAGE_LIMIT = 200;
    const POLITICAL_MAX_PAGES = 8;
    const POLITICAL_HOLDER_NAMES = 6;
    const from = new Date(Date.parse((sessionDate || stampNow().slice(0, 10)) +
      "T00:00:00Z") - POLITICAL_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

    const raws = {};
    let pagesRead = 0, paginated = null, fellBack = false;
    if (DRY_RUN) {
      Object.assign(raws, fakePoliticalRaws((payloads.long.rows || []).map((r) => r.t)));

      if (Array.isArray(raws.filings) && raws.filings.length) politicalFilings = raws.filings;

      pagesRead = null;
    } else {
      const filings = [];
      const seenRows = new Set();
      const identity = (r) => `${r && r.politician_id || r && r.name || ""}|` +
        `${r && r.ticker || ""}|${r && r.transaction_date || ""}|` +
        `${r && r.filed_at_date || ""}|${r && r.amounts || r && r.mid_value || ""}`;
      try {

        let cursor = sessionDate || null;
        for (let rung = 1; rung <= POLITICAL_MAX_PAGES; rung++) {
          const rows = unwrapVendorRows(await uw("/api/congress/recent-trades", {
            limit: POLITICAL_PAGE_LIMIT, date: cursor || undefined,
          }));
          if (!rows.length) break;

          let added = 0;
          let oldest = null;
          for (const r of rows) {
            const d = r && typeof r.transaction_date === "string"
              ? r.transaction_date.slice(0, 10) : null;
            if (d && (oldest === null || d < oldest)) oldest = d;

            if (d && d < from) continue;
            const key = identity(r);
            if (seenRows.has(key)) continue;
            seenRows.add(key);
            filings.push(r);
            added++;
          }
          pagesRead++;

          if (!added) {

            paginated = pagesRead > 1;
            break;
          }
          if (rows.length < POLITICAL_PAGE_LIMIT) { paginated = pagesRead > 1 ? true : null; break; }
          if (!oldest || oldest < from) { paginated = pagesRead > 1; break; }
          if (oldest === cursor) {

            console.warn(`  political: the ladder stalled at ${cursor} — a single ` +
              "date carries more filings than one page holds, so the window is " +
              "read only back to there");
            paginated = pagesRead > 1;
            break;
          }
          cursor = oldest;
          if (rung === POLITICAL_MAX_PAGES) paginated = true;
        }
      } catch (error) {

        if (!filings.length) {
          fellBack = true;
          console.warn(`  political: the recent-trades ladder refused on its first ` +
            `rung (${error.message}) — falling back to one unwindowed page`);
          try {
            filings.push(...unwrapVendorRows(await uw("/api/congress/recent-trades",
              { limit: POLITICAL_PAGE_LIMIT })));
            pagesRead = 1;
          } catch (inner) {
            raws.filings = { __failed: inner && inner.message ? inner.message : String(inner) };
          }
        } else {
          console.warn(`  political: page ${pagesRead + 1} failed (${error.message}) — ` +
            `ranking on the ${filings.length} filing(s) already read`);
        }
      }
      if (!raws.filings) raws.filings = filings;

      if (Array.isArray(filings) && filings.length) politicalFilings = filings;

      const holderNames = deepNames(published, POLITICAL_HOLDER_NAMES).map((d) => d.t);
      const holders = [];
      const refusal = holdersRefusal(await fetchStoredPayload("political"), sessionDate);
      if (refusal) {
        raws.holders = { __failed: refusal.reason };
        console.log(`  political holders: ${refusal.reason}`);
      }
      for (const ticker of refusal ? [] : holderNames) {
        try {
          holders.push({ ticker, raw: await uw(`/api/politician-portfolios/holders/${ticker}`, {}) });
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          if (!holders.length) {
            raws.holders = { __failed: message };

            console.log(`  political holders: ${message} — the spec marks this route ` +
              "enterprise-only, but the status above is what the vendor actually " +
              "returned; one refusal ends the walk rather than buying five more");
            break;
          }
          console.warn(`  political holders ${ticker}: ${message} — the names already read stand`);
        }
      }
      if (!raws.holders) raws.holders = holders;
    }

    const political = buildPolitical(raws);

    if (political.buyers.status === "quiet") {
      const first = unwrapVendorRows(raws.filings)[0];
      if (first && typeof first === "object") {
        console.log("  political: NOTE filings returned rows but none ranked — first-row keys: " +
          Object.keys(first).slice(0, 24).join(", "));
      }
    }
    await publish("political", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      readAt: stampNow(),

      carded: [...deepSet].sort(),
      window: { from, to: sessionDate || null, days: POLITICAL_WINDOW_DAYS },

      source: {
        route: DRY_RUN ? "dry-run fixture"
          : fellBack ? "recent-trades (single page, unwindowed)"
          : "recent-trades (date ladder)",
        pages: pagesRead, pageLimit: POLITICAL_PAGE_LIMIT, paginated,
        windowed: !fellBack,
      },
      ...political,
    });
    const okCount = POLITICAL_FEEDS.filter((f) => political[f].status === "ok").length;
    console.log(`  political: ${okCount} of ${POLITICAL_FEEDS.length} feeds ok — ` +
      `${political.filings ?? 0} filing(s) over ${pagesRead === null ? "no" : pagesRead} ` +
      `page(s) from ${from}, ` +
      POLITICAL_FEEDS.map((f) => `${f}:${political[f].status}` +
        `${political[f].rows ? ":" + political[f].rows.length : ""}`).join(" "));
  }, (error) => {
    console.warn(`  political: ${error.message} — every key above published before this leg ran`);
  });

  stages.step("sector-news");
  await publishSectorPremium({ sessionDate, generatedAt });

  await publishNews({
    sessionDate, generatedAt, tickers: (payloads.long.rows || []).map((r) => r.t),
  });
  Object.assign(ctx, { crossRaws, politicalFilings, POLITICAL_WINDOW_DAYS });
}
