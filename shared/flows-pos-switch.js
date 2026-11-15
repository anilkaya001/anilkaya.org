export const POSITIONING_CAP_DEFAULT = 600;

export const POSITIONING_CAP_MAX = 1500;

const word = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

export function positioningWord(env) {
  const mode = word(env && env.FLOWS_POSITIONING);
  if (mode === "on") return "on";
  if (mode === "off") return "off";
  return "owner";
}

export function positioningMode(env, owner) {
  const mode = positioningWord(env);
  return mode === "on" || (mode === "owner" && owner === true);
}

export function positioningNightly(env) {
  return word(env && env.FLOWS_POSITIONING_NIGHTLY) !== "off";
}

export function positioningCap(env) {
  const raw = env && env.FLOWS_POSITIONING_CAP;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(text)) return POSITIONING_CAP_DEFAULT;
  const n = Number(text);
  if (!Number.isSafeInteger(n)) return POSITIONING_CAP_DEFAULT;
  return Math.min(n, POSITIONING_CAP_MAX);
}
