import { vendorGate } from "../../shared/flows-regime.js";

export const LEG_WRITER = "flows-pipeline";

export async function read(uw, path, params = {}, { envelope = false } = {}) {
  try {
    const body = await uw(path, params, envelope ? { envelope: true } : {});
    return { ok: true, body, status: 200, error: null };
  } catch (error) {
    const gate = vendorGate(error);
    return {
      ok: false, body: null, status: gate.status, gated: gate.gated,
      error: String(error && error.message ? error.message : error),
    };
  }
}

export function rowsOf(body, key = "data") {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray(body[key])) return body[key];
  return [];
}

export function silenceOf(result, { what = "read" } = {}) {
  if (result.ok) return null;
  if (result.gated) {
    return { status: "unavailable", reason: "plan_gated", http: result.status, detail: `${what}: ${result.error}` };
  }
  return { status: "unavailable", reason: "unreadable", http: result.status, detail: `${what}: ${result.error}` };
}

export function freshStamp({ readAt, vendorAt = null, session = null, cadenceS = 0, source = "nightly", writer = LEG_WRITER } = {}) {
  return { v: 1, readAt: readAt || new Date().toISOString(), vendorAt, source, cadenceS, session, writer };
}

export function makeCallMeter(stats) {
  const start = stats && Number.isFinite(stats.calls) ? stats.calls : 0;
  return () => (stats && Number.isFinite(stats.calls) ? stats.calls - start : null);
}

export async function sequential(items, work) {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push(await work(items[i], i));
  return out;
}

export function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function pastDeadline(deadline) {
  return Number.isFinite(deadline) && Date.now() > deadline;
}
