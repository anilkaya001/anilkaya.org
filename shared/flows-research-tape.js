const MULTI_LEG_CODES = new Set([
  "mlet", "mlat", "mlct", "mlft", "mesl", "masl", "mfsl",
  "tlet", "tlct", "tlft", "tesl", "tasl", "tfsl", "tlat", "cbmo",
  "multi_leg", "multileg", "stock_multi_leg",
]);

const SIDE_TAGS = new Set(["ask_side", "bid_side", "mid_side", "no_side"]);
const CANCEL_CODES = new Set(["canc", "cncl", "cnco", "cnol", "canceled", "cancelled"]);
const SPECIAL_TRADE_CODES = new Set([
  "late", "oseq", "open", "opnl", "late_report", "out_of_sequence",
  "slcn", "scli", "slci", "cross_trade",
  "slan", "slai", "slft", "futures_floor", "mctp",
  "exht", "extended_hours", "dividend", "arbitrage", "trade_through_exempt",
]);

function timestamp(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  if (/^\d{13}$/.test(value)) return Number(value);
  const iso = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!iso) return null;
  const milliseconds = Date.parse(iso[1].replace(" ", "T") + iso[3]);
  return Number.isFinite(milliseconds) ? milliseconds + Number(iso[2] ?? 0) * 1_000 : null;
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
  return values.flat().filter((value) => typeof value === "string")
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9_]+/)).filter(Boolean);
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
  return row.is_agg === true || row.is_aggregated === true || row.aggregated === true || codes.includes("summary")
    || (Array.isArray(row.trade_ids) && row.trade_ids.length > 0)
    || quantity(row.trade_count) > 1;
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
  if (bidAt > executedAt || askAt > executedAt || bidReceivedAt === null || askReceivedAt === null
    || bidReceivedAt < bidAt || askReceivedAt < askAt || Math.max(bidReceivedAt, askReceivedAt) > cutoffMs) {
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
  const quoteWeight = Math.max(-1, Math.min(1, ((fill - bid) - (ask - fill)) / (ask - bid)));
  const sideTags = new Set(tags.filter((tag) => SIDE_TAGS.has(tag)));
  if (sideTags.size > 1 || sideTags.has("no_side")
    || (sideTags.has("ask_side") && quoteWeight <= 1e-8)
    || (sideTags.has("bid_side") && quoteWeight >= -1e-8)
    || (sideTags.has("mid_side") && Math.abs(quoteWeight) > 1e-8)) {
    return { quoteWeight: 0, reason: "vendorSideConflict" };
  }
  if (Math.abs(quoteWeight) <= 1e-8) return { quoteWeight: 0, reason: "midpoint" };
  return { quoteWeight, reason: null, quoteSource: quote.source };
}

function tapeRow(event, cutoffMs, maxQuoteAgeMs, quoteMode) {
  const { row, codes, executedAt } = event;
  const contract = identifier(row.option_symbol ?? row.option_chain_id);
  const size = quantity(row.size);
  if (!contract || !Number.isSafeInteger(size) || size <= 0 || executedAt === null
    || executedAt > event.eventAt) return null;
  const side = quoteSide(row, codes, executedAt, cutoffMs, maxQuoteAgeMs, quoteMode);
  return {
    contract, size, executedAt, ...side,
    identity: JSON.stringify([
      contract, size, executedAt, quantity(row.price), quantity(row.nbbo_bid), quantity(row.nbbo_ask),
      timestamp(row.nbbo_bid_at), timestamp(row.nbbo_ask_at), side.quoteWeight, side.reason, side.quoteSource,
    ]),
  };
}

function contractTotals() {
  return {
    prints: 0, signedPrints: 0, uncertainPrints: 0, volume: 0, signedVolume: 0, signedContracts: 0,
    timestampSignedPrints: 0, vendorSignedPrints: 0, timestampSignedVolume: 0, vendorSignedVolume: 0,
  };
}

export function summarizeTape(records, {
  cutoffMs, windowMs = 120 * 60_000, decayMs = 55 * 60_000, maxQuoteAgeMs = 2_000,
  quoteMode = "require-timestamps", receiptCutoffMs = cutoffMs,
} = {}) {
  if (!Number.isFinite(cutoffMs) || !Number.isFinite(receiptCutoffMs) || receiptCutoffMs < cutoffMs
    || ![windowMs, decayMs, maxQuoteAgeMs].every((ms) => Number.isFinite(ms) && ms > 0)) {
    throw new RangeError("Tape replay requires a finite cutoff and positive window, decay and quote age");
  }
  if (!Array.isArray(records)) throw new TypeError("Tape records must be an array");
  if (!["require-timestamps", "vendor-at-trade"].includes(quoteMode)) throw new RangeError("Invalid tape quote mode");

  const counts = {
    records: records.length, afterCutoff: 0, malformed: 0, missingId: 0, aggregate: 0, nonExecution: 0,
    duplicates: 0, corrections: 0, cancellations: 0, conflictingIds: 0, outsideWindow: 0,
    ...contractTotals(), reasons: {},
  };
  const events = [];
  for (const row of records) {
    const event = normalize(row);
    if (!event) { counts.malformed++; continue; }
    if (event.eventAt > cutoffMs || event.receivedAt > receiptCutoffMs) { counts.afterCutoff++; continue; }
    if (aggregated(row, event.codes)) { counts.aggregate++; continue; }
    if (event.codes.includes("official_price_report")) { counts.nonExecution++; continue; }
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
    if (!target) { counts.missingId++; continue; }
    const key = aliases.get(target) ?? target;
    const previous = entries.get(key);
    if (action === "cancel") {
      if (previous?.canceled) { counts.duplicates++; continue; }
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
      if (!previous?.conflict && trade.identity === previous?.trade?.identity) { counts.duplicates++; continue; }
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
    if (age > windowMs) { counts.outsideWindow++; continue; }
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
