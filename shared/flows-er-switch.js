const word = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export function eventRiskMode(env) {
  const w = word(env && env.FLOWS_EVENTRISK);
  return w === "on" || w === "off" ? w : "owner";
}

export function eventRiskOpen(env, owner) {
  const m = eventRiskMode(env);
  return m === "on" || (m === "owner" && owner === true);
}

export function eventRiskNightly(env) {
  return word(env && env.FLOWS_EVENTRISK_NIGHTLY) !== "off";
}

export const EVENTRISK_CAP_DEFAULT = 400;
export const EVENTRISK_CAP_MAX = 1000;

export function eventRiskCap(env) {
  const raw = env && env.FLOWS_EVENTRISK_CAP;
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^\d+$/.test(s)) return EVENTRISK_CAP_DEFAULT;
  return Math.min(Number(s), EVENTRISK_CAP_MAX);
}

export function eventRiskHalts(env) {
  return word(env && env.FLOWS_EVENTRISK_HALTS) === "on";
}
