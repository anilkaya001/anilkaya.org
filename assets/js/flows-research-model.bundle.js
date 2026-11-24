(() => {
"use strict";
var FlowsResearchModel = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  var flows_research_model_exports = {};
  __export(flows_research_model_exports, {
    load: () => load
  });

  var MULTI_LEG_CODES = new Set([
    "mlet",
    "mlat",
    "mlct",
    "mlft",
    "mesl",
    "masl",
    "mfsl",
    "tlet",
    "tlct",
    "tlft",
    "tesl",
    "tasl",
    "tfsl",
    "tlat",
    "cbmo",
    "multi_leg",
    "multileg",
    "stock_multi_leg"
  ]);
  var SIDE_TAGS = new Set(["ask_side", "bid_side", "mid_side", "no_side"]);
  var CANCEL_CODES = new Set(["canc", "cncl", "cnco", "cnol", "canceled", "cancelled"]);
  var SPECIAL_TRADE_CODES = new Set([
    "late",
    "oseq",
    "open",
    "opnl",
    "late_report",
    "out_of_sequence",
    "slcn",
    "scli",
    "slci",
    "cross_trade",
    "slan",
    "slai",
    "slft",
    "futures_floor",
    "mctp",
    "exht",
    "extended_hours",
    "dividend",
    "arbitrage",
    "trade_through_exempt"
  ]);
  function timestamp(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    if (/^\d{13}$/.test(value)) return Number(value);
    const iso = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!iso) return null;
    const milliseconds = Date.parse(iso[1].replace(" ", "T") + iso[3]);
    return Number.isFinite(milliseconds) ? milliseconds + Number(iso[2] ?? 0) * 1e3 : null;
  }
  function quantity(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function identifier(value) {
    if (typeof value === "string" && value.trim()) return value.trim();
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  function words(...values) {
    return values.flat().filter((value) => typeof value === "string").flatMap((value) => value.toLowerCase().split(/[^a-z0-9_]+/)).filter(Boolean);
  }
  function actionOf(row, codes) {
    if (row.canceled === true || row.action === "cancel" || codes.some((code) => CANCEL_CODES.has(code))) return "cancel";
    if (row.corrected === true || row.action === "correct" || identifier(row.corrects_trade_id)) return "correct";
    return "trade";
  }
  function normalize(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const codes = words(row.trade_code, row.upstream_condition_detail, row.report_flags);
    const action = actionOf(row, codes);
    const executedAt = timestamp(row.executed_at);
    const eventAt = timestamp(row.event_at ?? row.executed_at);
    const receivedAt = timestamp(row.received_at);
    if (eventAt === null || receivedAt === null || receivedAt < eventAt) return null;
    return { row, codes, action, executedAt, eventAt, receivedAt };
  }
  function aggregated(row, codes) {
    return row.is_agg === true || row.is_aggregated === true || row.aggregated === true || codes.includes("summary") || Array.isArray(row.trade_ids) && row.trade_ids.length > 0 || quantity(row.trade_count) > 1;
  }
  function quoteProvenance(row, executedAt, cutoffMs, maxQuoteAgeMs, quoteMode) {
    if ((row.nbbo_bid_at ?? row.nbbo_bid_time) == null && (row.nbbo_ask_at ?? row.nbbo_ask_time) == null && quoteMode === "vendor-at-trade") {
      return { source: "vendor" };
    }
    const bidAt = timestamp(row.nbbo_bid_at ?? row.nbbo_bid_time);
    const askAt = timestamp(row.nbbo_ask_at ?? row.nbbo_ask_time);
    if (bidAt === null || askAt === null) return { reason: "missingQuoteTime" };
    const bidReceivedAt = timestamp(row.nbbo_bid_received_at ?? row.received_at);
    const askReceivedAt = timestamp(row.nbbo_ask_received_at ?? row.received_at);
    if (bidAt > executedAt || askAt > executedAt || bidReceivedAt === null || askReceivedAt === null || bidReceivedAt < bidAt || askReceivedAt < askAt || Math.max(bidReceivedAt, askReceivedAt) > cutoffMs) {
      return { reason: "quoteTiming" };
    }
    if (executedAt - Math.min(bidAt, askAt) > maxQuoteAgeMs) return { reason: "staleQuote" };
    return { source: "timestamp" };
  }
  function quoteSide(row, codes, executedAt, cutoffMs, maxQuoteAgeMs, quoteMode) {
    const tags = words(row.tags);
    if (row.is_multi_leg === true || [...codes, ...tags].some((code) => MULTI_LEG_CODES.has(code))) {
      return { quoteWeight: 0, reason: "complex" };
    }
    if ([...codes, ...tags].some((code) => SPECIAL_TRADE_CODES.has(code))) {
      return { quoteWeight: 0, reason: "condition" };
    }
    const bid = quantity(row.nbbo_bid);
    const ask = quantity(row.nbbo_ask);
    const fill = quantity(row.price);
    if (bid === null || ask === null || fill === null || bid < 0 || ask <= bid || fill <= 0) {
      return { quoteWeight: 0, reason: "invalidQuote" };
    }
    const quote = quoteProvenance(row, executedAt, cutoffMs, maxQuoteAgeMs, quoteMode);
    if (quote.reason) return { quoteWeight: 0, reason: quote.reason };
    const tolerance = (ask - bid) * 1e-8;
    if (fill < bid - tolerance || fill > ask + tolerance) {
      return { quoteWeight: 0, reason: "outsideQuote" };
    }
    const quoteWeight = Math.max(-1, Math.min(1, (fill - bid - (ask - fill)) / (ask - bid)));
    const sideTags = new Set(tags.filter((tag) => SIDE_TAGS.has(tag)));
    if (sideTags.size > 1 || sideTags.has("no_side") || sideTags.has("ask_side") && quoteWeight <= 1e-8 || sideTags.has("bid_side") && quoteWeight >= -1e-8 || sideTags.has("mid_side") && Math.abs(quoteWeight) > 1e-8) {
      return { quoteWeight: 0, reason: "vendorSideConflict" };
    }
    if (Math.abs(quoteWeight) <= 1e-8) return { quoteWeight: 0, reason: "midpoint" };
    return { quoteWeight, reason: null, quoteSource: quote.source };
  }
  function tapeRow(event, cutoffMs, maxQuoteAgeMs, quoteMode) {
    const { row, codes, executedAt } = event;
    const contract = identifier(row.option_symbol ?? row.option_chain_id);
    const size = quantity(row.size);
    if (!contract || !Number.isSafeInteger(size) || size <= 0 || executedAt === null || executedAt > event.eventAt) return null;
    const side = quoteSide(row, codes, executedAt, cutoffMs, maxQuoteAgeMs, quoteMode);
    return {
      contract,
      size,
      executedAt,
      ...side,
      identity: JSON.stringify([
        contract,
        size,
        executedAt,
        quantity(row.price),
        quantity(row.nbbo_bid),
        quantity(row.nbbo_ask),
        timestamp(row.nbbo_bid_at),
        timestamp(row.nbbo_ask_at),
        side.quoteWeight,
        side.reason,
        side.quoteSource
      ])
    };
  }
  function contractTotals() {
    return {
      prints: 0,
      signedPrints: 0,
      uncertainPrints: 0,
      volume: 0,
      signedVolume: 0,
      signedContracts: 0,
      timestampSignedPrints: 0,
      vendorSignedPrints: 0,
      timestampSignedVolume: 0,
      vendorSignedVolume: 0
    };
  }
  function summarizeTape(records, {
    cutoffMs,
    windowMs = 120 * 6e4,
    decayMs = 55 * 6e4,
    maxQuoteAgeMs = 2e3,
    quoteMode = "require-timestamps",
    receiptCutoffMs = cutoffMs
  } = {}) {
    if (!Number.isFinite(cutoffMs) || !Number.isFinite(receiptCutoffMs) || receiptCutoffMs < cutoffMs || ![windowMs, decayMs, maxQuoteAgeMs].every((ms) => Number.isFinite(ms) && ms > 0)) {
      throw new RangeError("Tape replay requires a finite cutoff and positive window, decay and quote age");
    }
    if (!Array.isArray(records)) throw new TypeError("Tape records must be an array");
    if (!["require-timestamps", "vendor-at-trade"].includes(quoteMode)) throw new RangeError("Invalid tape quote mode");
    const counts = {
      records: records.length,
      afterCutoff: 0,
      malformed: 0,
      missingId: 0,
      aggregate: 0,
      nonExecution: 0,
      duplicates: 0,
      corrections: 0,
      cancellations: 0,
      conflictingIds: 0,
      outsideWindow: 0,
      ...contractTotals(),
      reasons: {}
    };
    const events = [];
    for (const row of records) {
      const event = normalize(row);
      if (!event) {
        counts.malformed++;
        continue;
      }
      if (event.eventAt > cutoffMs || event.receivedAt > receiptCutoffMs) {
        counts.afterCutoff++;
        continue;
      }
      if (aggregated(row, event.codes)) {
        counts.aggregate++;
        continue;
      }
      if (event.codes.includes("official_price_report")) {
        counts.nonExecution++;
        continue;
      }
      events.push(event);
    }
    const priority = { trade: 0, correct: 1, cancel: 2 };
    events.sort((a, b) => a.receivedAt - b.receivedAt || a.eventAt - b.eventAt || priority[a.action] - priority[b.action]);
    const entries = new Map();
    const aliases = new Map();
    for (const event of events) {
      const { row, action } = event;
      const id = identifier(row.id ?? row.trade_id);
      const target = action === "trade" ? id : identifier(row.corrects_trade_id ?? row.original_trade_id) ?? id;
      if (!target) {
        counts.missingId++;
        continue;
      }
      const key = aliases.get(target) ?? target;
      const previous = entries.get(key);
      if (action === "cancel") {
        if (previous?.canceled) {
          counts.duplicates++;
          continue;
        }
        counts.cancellations++;
        entries.set(key, { canceled: true });
        continue;
      }
      const trade = tapeRow(event, receiptCutoffMs, maxQuoteAgeMs, quoteMode);
      if (!trade) {
        counts.malformed++;
        if (action === "correct" && previous?.trade && !previous.canceled) {
          entries.set(key, { trade: previous.trade, conflict: true });
        }
        continue;
      }
      if (action === "correct") {
        if (id && id !== key && id !== target) {
          entries.delete(id);
          aliases.set(id, key);
        }
        if (!previous?.conflict && trade.identity === previous?.trade?.identity) {
          counts.duplicates++;
          continue;
        }
        counts.corrections++;
        entries.set(key, { trade, corrected: true });
      } else if (previous) {
        if (!previous.canceled && !previous.corrected && previous.trade.identity !== trade.identity) {
          if (!previous.conflict) counts.conflictingIds++;
          entries.set(key, { trade: previous.trade, conflict: true });
        } else counts.duplicates++;
      } else entries.set(key, { trade });
    }
    const byContract = new Map();
    for (const { trade, canceled, conflict } of entries.values()) {
      if (canceled) continue;
      const age = cutoffMs - trade.executedAt;
      if (age > windowMs) {
        counts.outsideWindow++;
        continue;
      }
      const totals = byContract.get(trade.contract) ?? contractTotals();
      byContract.set(trade.contract, totals);
      const reason = conflict ? "conflictingId" : trade.reason;
      const signedContracts = trade.size * trade.quoteWeight * Math.exp(-age / decayMs);
      for (const target of [totals, counts]) {
        target.prints++;
        target.volume += trade.size;
        if (reason) target.uncertainPrints++;
        else {
          target.signedPrints++;
          target.signedVolume += trade.size;
          target.signedContracts += signedContracts;
          if (trade.quoteSource === "timestamp") {
            target.timestampSignedPrints++;
            target.timestampSignedVolume += trade.size;
          } else {
            target.vendorSignedPrints++;
            target.vendorSignedVolume += trade.size;
          }
        }
      }
      if (reason) counts.reasons[reason] = (counts.reasons[reason] ?? 0) + 1;
    }
    return { byContract, counts };
  }

  var paths = 256;
  var minutesPerYear = 365 * 24 * 60;
  var threshold = Object.freeze({ amplify: 1.1, dampen: 0.93, volatile: 1.1, support: 0.6 });
  var clamp = (x, low, high) => Math.min(high, Math.max(low, x));
  var round = (x, digits = 2) => Number(x.toFixed(digits));
  function seeded(seed) {
    return function() {
      seed = seed * 1664525 + 1013904223 >>> 0;
      return (seed + 0.5) / 4294967296;
    };
  }
  function gaussian(random) {
    return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  }
  function normalCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const tail = Math.exp(-x * x / 2) * t / Math.sqrt(2 * Math.PI) * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - tail : tail;
  }
  var settings = [
    [-0.018, 0.32, 1.1, 0.3, 0.8],
    [0.017, 0.5, 0.84, 0.48, 0.92],
    [-0.034, 0.43, 0.94, 0.68, 0.81],
    [0, 0.4, 1, 1, 0.85],
    [0.031, 0.6, 1.19, 0.86, 0.7],
    [-0.063, 0.27, 1.26, 1.24, 0.94],
    [0.055, 0.54, 1.05, 1.36, 1]
  ];
  function dealerPositions(options, inventoryMode, prior, flowWeight) {
    const signed = inventoryMode === "short" ? -0.075 + prior / 3 : inventoryMode === "long" ? 0.075 + prior / 3 : prior;
    return options.map((option) => signed * option.openInterest - flowWeight * option.flow);
  }
  function hedgeAt(spot, elapsed, positions, leverage, market) {
    let hedge = 0;
    for (let j = 0; j < market.options.length; j++) {
      const option = market.options[j];
      const time = (option.expiry - elapsed) / minutesPerYear;
      const iv = clamp(option.iv + leverage * option.skew * Math.log(market.spot / spot), 0.05, 4);
      const width = iv * Math.sqrt(time);
      const d1 = (Math.log(spot / option.strike) + (market.rate - market.dividendYield + 0.5 * iv * iv) * time) / width;
      const optionDelta = Math.exp(-market.dividendYield * time) * (normalCdf(d1) - (option.kind === "put" ? 1 : 0));
      hedge -= option.multiplier * positions[j] * optionDelta;
    }
    return hedge;
  }
  function hedgeCurve(elapsed, positions, leverage, market) {
    const first = 0.78 * market.spot;
    const last = 1.28 * market.spot;
    const size = 561;
    const tick = (last - first) / (size - 1);
    const values = new Float64Array(size);
    for (let i = 0; i < size; i++) values[i] = hedgeAt(first + tick * i, elapsed, positions, leverage, market);
    return function(spot) {
      if (spot < first || spot > last) return hedgeAt(spot, elapsed, positions, leverage, market);
      const index = (spot - first) / tick;
      const lower = Math.min(Math.floor(index), size - 2);
      return values[lower] + (index - lower) * (values[lower + 1] - values[lower]);
    };
  }
  function shareImpact(direction, liquidity, impactScale, market) {
    const thin = liquidity === "thin" ? 1.65 : 1;
    const imbalance = direction > 0 ? market.depthRatio : 1 / market.depthRatio;
    const depth = market.volume5 * imbalance;
    return 0.01 * market.spot / depth * thin * impactScale;
  }
  function shockResponse(spot, shock, hedge, liquidity, impactScale, hedgeFraction, market) {
    const signedShares = hedgeFraction * (hedge(spot + shock) - hedge(spot));
    const impact = shareImpact(shock, liquidity, impactScale, market) * signedShares;
    const relativeImpact = clamp(impact / shock, -0.65, 0.95);
    const feedback = relativeImpact * shock;
    return { gain: 1 + feedback / shock, shares: signedShares, feedback };
  }
  function innovations(steps, baseSigma) {
    const random = seeded(710241);
    const stepSigma = baseSigma / Math.sqrt(steps * (0.94 ** 2 + 0.018 * 2.4 ** 2));
    return Array.from({ length: paths }, () => Array.from({ length: steps }, () => stepSigma * (0.94 * gaussian(random) + (random() < 0.018 ? 2.4 * gaussian(random) : 0))));
  }
  function simulate(spot, curves, shocks, liquidity, impactScale, hedgeFraction, market) {
    let baselineVariance = 0;
    let feedbackVariance = 0;
    for (const path of shocks) {
      let current = spot;
      path.forEach((innovation, step) => {
        const externalMove = current * Math.expm1(innovation);
        const feedback = shockResponse(
          current,
          externalMove || Number.EPSILON,
          curves[step],
          liquidity,
          impactScale,
          hedgeFraction,
          market
        ).feedback;
        const gain = Math.log1p((externalMove + feedback) / current);
        baselineVariance += innovation * innovation;
        feedbackVariance += gain * gain;
        current += externalMove + feedback;
      });
    }
    return Math.sqrt(feedbackVariance / baselineVariance);
  }
  function quantile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = percentile * (sorted.length - 1);
    const lower = Math.floor(index);
    return sorted[lower] + (index - lower) * (sorted[Math.ceil(index)] - sorted[lower]);
  }
  function classify(up, down, vol) {
    if (up >= threshold.amplify && down >= threshold.amplify && vol >= threshold.volatile) return "volatile";
    if (up >= threshold.amplify && up - down >= 0.045) return "up";
    if (down >= threshold.amplify && down - up >= 0.045) return "down";
    if (up <= threshold.dampen && down <= threshold.dampen && vol <= 0.97) return "dampen";
    return "mixed";
  }
  function runs(rows) {
    const result = [];
    for (let start = 0; start < rows.length; ) {
      let end = start + 1;
      const kind = rows[start].kind;
      while (end < rows.length && rows[end].kind === kind) end++;
      if (kind !== "mixed" && end - start >= 2) {
        const metrics = rows[Math.floor((start + end - 1) / 2)];
        result.push({
          id: kind + "-" + rows[start].price,
          low: round(rows[start].price - (rows[1].price - rows[0].price) / 2, 4),
          high: round(rows[end - 1].price + (rows[1].price - rows[0].price) / 2, 4),
          kind,
          center: metrics.price,
          metrics
        });
      }
      start = end;
    }
    return result;
  }
  function evaluate(market, meta, { minutes = 30, liquidity = "normal", inventory = "ensemble" } = {}) {
    if (!meta.minutes.includes(minutes) || !meta.liquidity.includes(liquidity) || !meta.inventory.includes(inventory)) {
      throw new RangeError("Unknown research scenario.");
    }
    const report = { spot: meta.spot, minutes, liquidity, inventory, threshold, coverage: market.coverage };
    const usable = market.options.filter((option) => option.expiry >= minutes);
    if (!meta.modelReady || usable.length < 5) {
      return {
        ...report,
        shockPct: null,
        baseSigmaPct: null,
        paths: 0,
        scenarios: 0,
        contractCount: usable.length,
        rows: [],
        zones: []
      };
    }
    const horizonMarket = { ...market, options: usable };
    const steps = minutes / 5;
    const baseSigma = clamp(market.sigmaPerMinute * Math.sqrt(minutes), 25e-5, 0.12);
    const band = clamp(4.5 * baseSigma, 0.022, 0.16);
    const first = meta.spot * (1 - band);
    const tick = 2 * band * meta.spot / 76;
    const unitShocks = innovations(steps, baseSigma);
    const scenarios = settings.map(([prior, flowWeight, impactScale, leverage, fraction]) => {
      const positions = dealerPositions(usable, inventory, prior, flowWeight);
      const curves = Array.from({ length: steps }, (_, step) => hedgeCurve(step * 5, positions, leverage, horizonMarket));
      return { impactScale, curves, fraction };
    });
    const rows = [];
    for (let index = 0; index <= 76; index++) {
      const price = round(first + index * tick, 4);
      const readings = scenarios.map(({ impactScale, curves, fraction }) => {
        const up2 = shockResponse(price, price * baseSigma, curves[0], liquidity, impactScale, fraction, horizonMarket);
        const down2 = shockResponse(price, -price * baseSigma, curves[0], liquidity, impactScale, fraction, horizonMarket);
        const vol2 = simulate(price, curves, unitShocks, liquidity, impactScale, fraction, horizonMarket);
        return {
          up: up2.gain,
          down: down2.gain,
          vol: vol2,
          upShares: up2.shares,
          downShares: down2.shares,
          kind: classify(up2.gain, down2.gain, vol2)
        };
      });
      const value = (key, p = 0.5) => quantile(readings.map((reading) => reading[key]), p);
      const up = value("up");
      const down = value("down");
      const vol = value("vol");
      const dominant = classify(up, down, vol);
      const support = readings.filter((reading) => reading.kind === dominant).length / readings.length;
      rows.push({
        price,
        up,
        down,
        vol,
        upLow: value("up", 0.1),
        upHigh: value("up", 0.9),
        downLow: value("down", 0.1),
        downHigh: value("down", 0.9),
        volLow: value("vol", 0.1),
        volHigh: value("vol", 0.9),
        upShares: Math.round(value("upShares")),
        downShares: Math.round(value("downShares")),
        kind: support >= threshold.support ? dominant : "mixed",
        support
      });
    }
    return {
      ...report,
      shockPct: baseSigma * 100,
      baseSigmaPct: baseSigma * 100,
      benchmarkShareVolume: market.volume5 * steps,
      paths,
      scenarios: scenarios.length,
      contractCount: usable.length,
      rows,
      zones: runs(rows)
    };
  }
  function csv(meta, result) {
    const keys = [
      "price",
      "kind",
      "up",
      "upLow",
      "upHigh",
      "down",
      "downLow",
      "downHigh",
      "vol",
      "volLow",
      "volHigh",
      "upShares",
      "downShares",
      "support"
    ];
    const headers = ["source", "as_of", "capture_mode", "symbol", "horizon_min", "liquidity", "inventory", ...keys];
    return [headers, ...result.rows.map((row) => [
      meta.source,
      meta.asOf,
      meta.captureMode,
      meta.symbol,
      result.minutes,
      result.liquidity,
      result.inventory,
      ...keys.map((key) => typeof row[key] === "number" ? round(row[key], 6) : row[key])
    ])].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }
  function csvCell(value) {
    if (typeof value !== "string") return String(value ?? "");
    const cell = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
    return /[",\r\n]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell;
  }
  var SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
  var OSI = /^([A-Z0-9]{1,6})( *)(\d{6})([CP])(\d{8})$/;
  var MAX_SERIES = 220;
  function labelText(value, size) {
    if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return "";
    const label = value.trim();
    return label.length <= size ? label : "";
  }
  function optionId(value, root) {
    if (typeof value !== "string" || value.length > 21) return null;
    const parts = OSI.exec(value);
    if (!parts || parts[1] !== root || parts[2] && parts[1].length + parts[2].length !== 6) return null;
    const [, , , end, side, strike] = parts;
    return { id: root + end + side + strike, end, kind: side === "C" ? "call" : "put", strike: Number(strike) / 1e3 };
  }
  var expiryDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  });
  function expiryCode(at) {
    const parts = Object.fromEntries(expiryDate.formatToParts(at).map(({ type, value }) => [type, value]));
    return parts.year + parts.month + parts.day;
  }
  var timeFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  var dateFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  var MINUTE = 6e4;
  function timestamp2(value) {
    if (Number.isSafeInteger(value) && value >= 1e12) return value;
    return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  }
  function statistic(bars) {
    const recent = bars.slice(-61);
    const step = (recent.at(-1).at - recent.at(-2).at) / MINUTE;
    if (step !== 1 && step !== 5) return { sigmaPerMinute: null, volume5: null };
    const returns = [];
    const volumes = [];
    for (let i = recent.length - 1; i > 0 && returns.length * step < 90; i--) {
      if (recent[i].at - recent[i - 1].at !== step * MINUTE) break;
      returns.push(Math.log(recent[i].price / recent[i - 1].price));
      if (recent[i].volume > 0) volumes.push(recent[i].volume * (5 / step));
    }
    if (returns.length * step < 45) return { sigmaPerMinute: null, volume5: null };
    return {
      sigmaPerMinute: Math.sqrt(returns.reduce((sum, change) => sum + change * change, 0) / (returns.length * step)),
      volume5: volumes.length >= returns.length * 0.8 ? quantile(volumes, 0.5) : null
    };
  }
  function optionRows(contracts, cutoff, spot, horizon, tape, root) {
    const selected = new Map();
    for (const row of contracts) {
      const contract = optionId(row?.id, root);
      if (!contract) continue;
      const quoteAt = timestamp2(row.quoteAt);
      const interestAt = timestamp2(row.openInterestAsOf);
      const expiryAt = timestamp2(row.expiresAt);
      const expiry = (expiryAt - cutoff) / MINUTE;
      if (!(expiry >= horizon && expiry <= 65 * 24 * 60) || !(quoteAt <= cutoff && quoteAt >= cutoff - 10 * MINUTE)) continue;
      if (!(interestAt <= cutoff && interestAt >= cutoff - 7 * 24 * 60 * MINUTE)) continue;
      if (!(Number.isFinite(row.strike) && Math.abs(Math.log(row.strike / spot)) <= 0.22 && Number.isFinite(row.iv) && row.iv >= 0.05 && row.iv <= 4 && Number.isSafeInteger(row.openInterest) && row.openInterest >= 0 && row.multiplier === 100)) continue;
      const { id, kind, strike, end } = contract;
      if (kind !== row.type || strike !== row.strike || end !== expiryCode(expiryAt) || selected.get(id)?.quoteAt >= quoteAt) continue;
      selected.set(id, {
        id,
        strike,
        quoteAt,
        expiry,
        kind,
        iv: row.iv,
        multiplier: row.multiplier,
        openInterest: row.openInterest,
        flow: tape.byContract.get(id)?.signedContracts ?? 0
      });
    }
    return [...selected.values()].sort((a, b) => Math.abs(Math.log(a.strike / spot)) - Math.abs(Math.log(b.strike / spot)));
  }
  function checkedSnapshot(input, expectedSymbol) {
    const source = labelText(input?.source, 80);
    const symbol = typeof input?.symbol === "string" ? input.symbol : "";
    if (input?.schemaVersion !== 1 || !source || !SYMBOL.test(symbol) || !["point-in-time", "historical-export", "historical-reconstruction"].includes(input.captureMode)) {
      throw new Error("Load a recorded market-data snapshot in the documented format.");
    }
    if (expectedSymbol != null && expectedSymbol !== symbol) {
      throw new Error("This recording is for " + symbol + ". Open its ticker before loading it.");
    }
    const cutoff = timestamp2(input.asOf);
    if (!Number.isFinite(cutoff) || cutoff > Date.now() + MINUTE) throw new Error("The snapshot needs a valid as-of timestamp.");
    if (!Array.isArray(input.bars) || input.bars.length > 2e3) throw new Error("The snapshot needs completed price bars.");
    const unique = new Map();
    for (const row of input.bars) {
      const at = timestamp2(row?.time);
      if (!Number.isFinite(at) || at > cutoff || at < cutoff - 24 * 60 * MINUTE || !Number.isFinite(row.close) || row.close <= 0 || row.close > 1e7) {
        throw new Error("The snapshot contains a malformed or out-of-window price bar.");
      }
      const existing = unique.get(at);
      const volume = Number.isSafeInteger(row.volume) && row.volume >= 0 ? row.volume : null;
      if (existing && (existing.price !== row.close || existing.volume !== null && volume !== null && existing.volume !== volume)) {
        throw new Error("The snapshot contains conflicting bars for one timestamp.");
      }
      unique.set(at, { at, time: timeFormat.format(at), price: row.close, volume: volume ?? existing?.volume ?? null });
    }
    const bars = [...unique.values()].sort((a, b) => a.at - b.at);
    if (bars.length < 2) throw new Error("At least two completed price bars are required.");
    const contracts = input.contracts ?? [];
    const trades = input.trades ?? [];
    if (!Array.isArray(contracts) || contracts.length > 25e3 || !Array.isArray(trades) || trades.length > 2e5) {
      throw new Error("The options snapshot exceeds the import limits or has an invalid shape.");
    }
    if (input.quoteMode && !["vendor-at-trade", "timestamped"].includes(input.quoteMode)) {
      throw new Error("Unknown quote timestamp provenance.");
    }
    return { bars, contracts, trades, cutoff, source, symbol, root: symbol.replace(/[.-]/g, "") };
  }
  function skewByExpiry(options) {
    const expiries = new Map();
    for (const option of options) {
      const rows = expiries.get(option.expiry) ?? [];
      rows.push(option);
      expiries.set(option.expiry, rows);
    }
    for (const rows of expiries.values()) {
      const slopes = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const spacing = Math.log(rows[j].strike / rows[i].strike);
          if (Math.abs(spacing) >= 6e-3) slopes.push((rows[j].iv - rows[i].iv) / spacing);
        }
      }
      const skew = slopes.length >= 5 ? clamp(quantile(slopes, 0.5), -2, 2) : 0;
      for (const row of rows) row.skew = skew;
    }
  }
  function liquidityEvidence(input, cutoff) {
    const sample = input.litQuoteSummary;
    const at = timestamp2(sample?.asOf);
    if (!Number.isFinite(at) || at > cutoff || at < cutoff - 5 * MINUTE || !Number.isSafeInteger(sample?.prints) || sample.prints < 15 || !(sample.bidShares > 0) || !(sample.askShares > 0)) return null;
    if (!Number.isFinite(sample.bidShares) || !Number.isFinite(sample.askShares)) return null;
    return {
      prints: sample.prints,
      asOf: new Date(at).toISOString(),
      bidShares: sample.bidShares,
      askShares: sample.askShares,
      ratio: clamp(Math.sqrt(sample.askShares / sample.bidShares), 0.65, 1.55)
    };
  }
  function tapeEvidence(input, trades, cutoff, capturedAt, root) {
    const packet = input.tapeSummary;
    if (!packet || trades.length) {
      const normalized = trades.map((trade) => {
        const rawId = trade?.option_symbol ?? trade?.option_chain_id;
        if (rawId == null) return trade;
        const series = optionId(rawId, root);
        if (!series) throw new Error("The option tape contains a contract outside this ticker or in an unsupported format.");
        return { ...trade, option_symbol: series.id };
      });
      return summarizeTape(normalized, {
        cutoffMs: cutoff,
        receiptCutoffMs: capturedAt,
        quoteMode: input.quoteMode === "vendor-at-trade" ? "vendor-at-trade" : "require-timestamps"
      });
    }
    const counts = packet.counts;
    if (!/^[a-f0-9]{64}$/.test(packet.archiveSha256 ?? "") || !Array.isArray(packet.byContract) || packet.byContract.length > 25e3 || !counts || !Number.isSafeInteger(counts.records) || !Number.isSafeInteger(counts.prints) || !Number.isSafeInteger(counts.signedPrints) || counts.records < counts.prints || counts.prints < counts.signedPrints || counts.signedPrints < 0) {
      throw new Error("The traceable trade summary has an invalid manifest.");
    }
    const byContract = new Map();
    let prints = 0;
    let signedPrints = 0;
    for (const pair of packet.byContract) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error("Invalid trade summary entry.");
      const [rawId, read] = pair;
      const id = optionId(rawId, root)?.id;
      if (!id || byContract.has(id) || !Number.isSafeInteger(read?.prints) || !Number.isSafeInteger(read?.signedPrints) || read.prints < read.signedPrints || read.signedPrints < 0 || !Number.isFinite(read.volume) || read.volume < 0 || !Number.isFinite(read.signedContracts) || Math.abs(read.signedContracts) > read.volume + 1e-8) {
        throw new Error("Invalid per-contract trade summary.");
      }
      prints += read.prints;
      signedPrints += read.signedPrints;
      byContract.set(id, read);
    }
    if (prints !== counts.prints || signedPrints !== counts.signedPrints) {
      throw new Error("Trade-summary counts do not reconcile.");
    }
    return { byContract, counts, archiveSha256: packet.archiveSha256 };
  }
  function load(input, { symbol: expectedSymbol } = {}) {
    const { bars, contracts, trades, cutoff, source, symbol, root } = checkedSnapshot(input, expectedSymbol);
    const retrospective = input.captureMode === "historical-reconstruction";
    const capturedAt = retrospective ? timestamp2(input.capturedAt) : cutoff;
    if (!Number.isFinite(capturedAt) || capturedAt < cutoff || capturedAt > Date.now() + MINUTE) {
      throw new Error("A historical reconstruction needs its actual capture timestamp.");
    }
    const tape = tapeEvidence(input, trades, cutoff, capturedAt, root);
    const spot = bars.at(-1).price;
    const options = optionRows(contracts, cutoff, spot, 15, tape, root);
    if (options.length <= MAX_SERIES) skewByExpiry(options);
    const depth = liquidityEvidence(input, cutoff);
    const { sigmaPerMinute, volume5 } = statistic(bars);
    const reasons = [];
    if (bars.at(-1).at < cutoff - 10 * MINUTE) reasons.push("the most recent price bar is older than ten minutes");
    if (!(sigmaPerMinute > 0)) reasons.push("fewer than 45 consecutive minutes of usable price data");
    if (!(volume5 > 0)) reasons.push("underlying share volume is unavailable");
    if (options.length < 5) reasons.push("fewer than five timestamped, valid option series");
    if (!options.some((option) => Math.abs(option.flow) > 0)) reasons.push("no matched option prints with an eligible side");
    if (options.length > MAX_SERIES) reasons.push("the option strip exceeds the " + MAX_SERIES + "-series limit");
    if (input.captureMode === "historical-export") reasons.push("the export lacks a point-in-time receipt archive");
    const sessionClose = timestamp2(input.sessionEndsAt);
    if (!Number.isFinite(sessionClose)) reasons.push("the exchange session close is unverified");
    const minutes = [15, 30, 60].filter((horizon) => !Number.isFinite(sessionClose) || cutoff + horizon * MINUTE <= sessionClose);
    if (minutes.length === 0) reasons.push("fewer than 15 minutes remain in the selected session");
    if (input.coverage?.chainComplete !== true) reasons.push("chain coverage is unverified");
    if (input.coverage?.tapeComplete !== true) reasons.push("raw tape coverage is unverified");
    const rate = Number.isFinite(input.rate) ? clamp(input.rate, -0.1, 0.25) : 0;
    const dividendYield = Number.isFinite(input.dividendYield) ? clamp(input.dividendYield, 0, 0.25) : 0;
    const coverage = {
      ...tape.counts,
      contracts: options.length,
      reportedOptions: contracts.length,
      bars: bars.length,
      chainComplete: input.coverage?.chainComplete === true,
      tapeComplete: input.coverage?.tapeComplete === true,
      quoteMode: input.quoteMode ?? "timestamped",
      volume5,
      listedContracts: Number.isSafeInteger(input.coverage?.listedContracts) ? input.coverage.listedContracts : null,
      scope: typeof input.coverage?.scope === "string" ? input.coverage.scope.slice(0, 180) : null,
      paginationWindows: Number.isSafeInteger(input.coverage?.paginationWindows) ? input.coverage.paginationWindows : null,
      archiveSha256: tape.archiveSha256 ?? null,
      depth
    };
    const meta = Object.freeze({
      symbol,
      name: labelText(input.name, 100) || symbol,
      spot,
      source,
      version: "2.0.1-research",
      asOf: new Date(cutoff).toISOString(),
      asOfLabel: timeFormat.format(cutoff) + " TRT",
      capturedAt: new Date(capturedAt).toISOString(),
      sessionLabel: dateFormat.format(cutoff) + " · Ankara time",
      captureMode: input.captureMode,
      priceBasis: input.priceBasis === "spot-marks" ? "spot-marks" : "completed-bars",
      seriesLabel: input.priceBasis === "spot-marks" ? "Underlying spot marks" : "Completed price bars",
      provenance: source + (input.priceBasis === "spot-marks" ? " · recorded spot marks" : " · recorded price bars and options tape"),
      minutes: Object.freeze(minutes.length ? minutes : [15, 30, 60]),
      liquidity: Object.freeze(["normal", "thin"]),
      inventory: Object.freeze(["ensemble", "short", "long"]),
      modelReady: reasons.length === 0,
      withheld: reasons.join(" · ")
    });
    const market = { options, spot, rate, dividendYield, sigmaPerMinute, volume5, coverage, depthRatio: depth?.ratio ?? 1 };
    return Object.freeze({
      meta,
      history: Object.freeze(bars.map((bar) => Object.freeze({ time: bar.time, timestamp: new Date(bar.at).toISOString(), price: bar.price }))),
      evaluate: (scenario) => evaluate(market, meta, { minutes: meta.minutes.includes(30) ? 30 : meta.minutes[0], ...scenario }),
      csv: (result) => csv(meta, result)
    });
  }
  return __toCommonJS(flows_research_model_exports);
})();
window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { researchModel: FlowsResearchModel }));
})();
