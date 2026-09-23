import { freshStamp } from "./common.mjs";
import { compactNumbers } from "../../shared/flows-cross.js";

export const CARD_X_SCHEMA_VERSION = 1;

export const CARD_X_BUDGET_BYTES = 100 * 1024;

export const CARD_X_SHED = Object.freeze([
  ["insiders.dots", (p) => { if (p.insiders && p.insiders.dots) p.insiders.dots = p.insiders.dots.slice(-10); }],
  ["earnings.events", (p) => { if (p.earnings && p.earnings.events) p.earnings.events = p.earnings.events.slice(0, 8); }],
  ["short.volume.path", (p) => { if (p.short && p.short.volume) delete p.short.volume.path; }],
  ["short.borrow.path", (p) => { if (p.short && p.short.borrow) delete p.short.borrow.path; }],
]);

export function makeCardXStore() {
  const parts = new Map();
  return {
    add(ticker, key, value) {
      if (!ticker || value === undefined) return;
      if (!parts.has(ticker)) parts.set(ticker, {});
      parts.get(ticker)[key] = value;
    },
    has: (ticker) => parts.has(ticker),
    get: (ticker) => parts.get(ticker) || null,
    tickers: () => [...parts.keys()].sort(),
    size: () => parts.size,
  };
}

export function cardXPayload(ticker, parts, { generatedAt = null, sessionDate = null, readAt = null, budgetBytes = CARD_X_BUDGET_BYTES } = {}) {
  const payload = {
    v: CARD_X_SCHEMA_VERSION,
    ticker,
    generatedAt, sessionDate,
    fresh: freshStamp({ readAt, session: sessionDate }),
    ...compactNumbers(JSON.parse(JSON.stringify(parts || {}))),
    shed: [],
  };
  let bytes = JSON.stringify(payload).length;
  for (const [name, drop] of CARD_X_SHED) {
    if (bytes <= budgetBytes) break;
    drop(payload);
    payload.shed.push(name);
    bytes = JSON.stringify(payload).length;
  }
  payload.bytes = JSON.stringify(payload).length;
  return payload;
}

export async function publishCardX(store, publish, { generatedAt, sessionDate, readAt, log = () => {} } = {}) {
  let written = 0, failed = 0, over = 0, largest = 0;
  for (const t of store.tickers()) {
    const payload = cardXPayload(t, store.get(t), { generatedAt, sessionDate, readAt });
    largest = Math.max(largest, payload.bytes);
    if (payload.bytes > CARD_X_BUDGET_BYTES) { over++; log(`  card-x ${t}: ${payload.bytes} bytes after shedding, over the cap — not written`); continue; }
    try {
      await publish("card-x:" + t, payload);
      written++;
    } catch (error) {
      failed++;
      log(`  card-x ${t}: ${error.message}`);
    }
  }
  return { written, failed, over, largest };
}
