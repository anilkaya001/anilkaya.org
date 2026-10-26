export const HORIZON_SESSIONS = 21;

export const RD_MAX = 99;

export const AHEAD_SESSIONS = 5;

export const REACTION_BACK_SESSIONS = 1;

export const LIVE_ELAPSED_MAX = 2;

const whole = (v) => Number.isInteger(v);

export function earningsState(row, hz, j = 0, back = REACTION_BACK_SESSIONS) {
  if (!row || typeof row !== "object" || !whole(hz) || hz < 1 || !whole(j) || j < 0 || !whole(back) || back < 0) return null;
  const { ed, rd, rdMax } = row;
  const ages = [];
  if (whole(rd) && rd >= 0) ages.push(rd + j);
  if (whole(ed) && ed >= 0 && ed <= j) ages.push(j - ed);
  if (whole(rdMax) && rdMax >= 0) ages.push(Math.max(rdMax - 1, 0) + j);
  const age = ages.length ? Math.min(...ages) : null;
  if (age !== null && age <= back) return age === 0 ? "reaction" : "after";
  if (!whole(ed) || ed < 0) return "undated";
  if (ed - j >= 1 && ed - j <= hz) return "ahead";
  return "clear";
}

export function earningsInside(row, hz, j = 0, back = REACTION_BACK_SESSIONS) {
  const s = earningsState(row, hz, j, back);
  return s === null ? null : s === "reaction" || s === "after" || s === "ahead";
}

export function horizonWords(hz) {
  if (!whole(hz) || hz < 1) return null;
  const sessions = hz + " sessions";
  return {
    n: hz,
    sessions,
    apart: "Earnings within " + sessions + ": event not separated.",
    untested: "Earnings within " + sessions + ": not tested.",
    leftOut: "Names reporting within " + sessions + " are left out of every row.",
    allEvent: "Every measured name reports within " + sessions + ".",
    ringed: "ring: earnings within " + sessions,
  };
}
