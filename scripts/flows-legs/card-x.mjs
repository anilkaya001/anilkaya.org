import { freshStamp } from "./common.mjs";
import { compactNumbers } from "../../shared/flows-cross.js";
import { hasLiveParts, shedNextPart, stubSection } from "../../shared/flows-vendor-extras.js";
import { servedBytes, wireBytes } from "../../shared/flows-card-pack.js";

export const CARD_X_SCHEMA_VERSION = 1;

export const CARD_X_BUDGET_BYTES = 100 * 1024;
export const CARD_X_SOFT_BYTES = 60 * 1024;
export const CARD_X_SERVED_BYTES = Math.floor(0.9 * CARD_X_BUDGET_BYTES);

export const cardXWire = () => process.env.FLOWS_CARDX_WIRE === "pack";

export const cardXBytes = (payload) => (cardXWire() ? wireBytes(payload) : servedBytes(payload));

const BYTES_FIELD = 16;

const overSoft = (payload) => cardXBytes(payload) + BYTES_FIELD > CARD_X_SOFT_BYTES || servedBytes(payload) + BYTES_FIELD > CARD_X_SERVED_BYTES;

function fitSoft(payload) {
  while (overSoft(payload)) {
    const id = shedNextPart(payload);
    if (!id) break;
    const mark = id === "va" ? "va.soft" : "extras.soft";
    if (!payload.shed.includes(mark)) payload.shed.push(mark);
  }
}

export const CARD_X_SHED = Object.freeze([
  ["va", (p) => { if (!p.va) return false; delete p.va; return true; }],
  ["dx.parts", (p) => { if (!hasLiveParts(p.dx)) return false; p.dx = stubSection(p.dx, "dx"); return true; }],
  ["vx.parts", (p) => { if (!hasLiveParts(p.vx)) return false; p.vx = stubSection(p.vx, "vx"); return true; }],
  ["ps.parts", (p) => { if (!hasLiveParts(p.ps)) return false; p.ps = stubSection(p.ps, "ps"); return true; }],
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
  fitSoft(payload);
  let bytes = JSON.stringify(payload).length;
  for (const [name, drop] of CARD_X_SHED) {
    if (bytes <= budgetBytes) break;
    if (drop(payload) === false) continue;
    payload.shed.push(name);
    bytes = JSON.stringify(payload).length;
  }
  payload.bytes = JSON.stringify(payload).length;
  return payload;
}

function samePrior(prior, sessionDate) {
  return prior && typeof prior === "object" && !Array.isArray(prior) && prior.sessionDate === sessionDate ? prior : null;
}

function mergeFresh(a, b) {
  if (!a || typeof a !== "object") return b;
  if (!b || typeof b !== "object") return a;
  const older = (x, y) => (!x ? y : !y ? x : x < y ? x : y);
  const newer = (x, y) => (!x ? y : !y ? x : x > y ? x : y);
  return { ...a, ...b, readAt: older(a.readAt, b.readAt), vendorAt: newer(a.vendorAt, b.vendorAt) };
}

export function composeCardXPayload(prior, own, { budgetBytes = CARD_X_BUDGET_BYTES } = {}) {
  const base = samePrior(prior, own.sessionDate);
  if (!base) return own;
  const payload = {
    ...base, ...own,
    fresh: mergeFresh(base.fresh, own.fresh),
    shed: [...new Set([...(Array.isArray(base.shed) ? base.shed : []), ...own.shed])],
  };
  delete payload.bytes;
  fitSoft(payload);
  let bytes = JSON.stringify(payload).length;
  for (const [name, drop] of CARD_X_SHED) {
    if (bytes <= budgetBytes) break;
    if (drop(payload) === false) continue;
    if (!payload.shed.includes(name)) payload.shed.push(name);
    bytes = JSON.stringify(payload).length;
  }
  payload.bytes = JSON.stringify(payload).length;
  return payload;
}

export async function publishCardX(store, publish, { generatedAt, sessionDate, readAt, stored = () => null, log = () => {}, skip = new Set() } = {}) {
  let written = 0, failed = 0, over = 0, largest = 0, largestWire = 0, kept = 0;
  for (const t of store.tickers()) {
    if (skip.has(t)) { kept++; continue; }
    const payload = composeCardXPayload(stored("card-x:" + t), cardXPayload(t, store.get(t), { generatedAt, sessionDate, readAt }));
    largest = Math.max(largest, payload.bytes);
    largestWire = Math.max(largestWire, cardXBytes(payload));
    if (payload.bytes > CARD_X_BUDGET_BYTES) { over++; log(`  card-x ${t}: ${payload.bytes} bytes after shedding, over the cap — not written`); continue; }
    try {
      await publish("card-x:" + t, payload);
      written++;
    } catch (error) {
      failed++;
      log(`  card-x ${t}: ${error.message}`);
    }
  }
  return { written, failed, over, largest, largestWire, kept };
}
