export const HORIZON_SESSIONS = 21;

export const RD_MAX = 99;

export const AHEAD_SESSIONS = 5;

export const REACTION_BACK_SESSIONS = 1;

export const LIVE_ELAPSED_MAX = 2;

const whole = (v) => Number.isInteger(v);

export const EVENT_STATES = Object.freeze({ reaction: true, unstated: true, after: true, ahead: true, clear: false, undated: false });

const ageState = (age, back) => (age === 0 ? "reaction" : age <= back ? "after" : "clear");

const agreed = (a, b) => (a === b ? a : "unstated");

const PRECEDENCE = Object.freeze(["reaction", "unstated", "after"]);

export function earningsState(row, hz, j, back = REACTION_BACK_SESSIONS) {
  if (!row || typeof row !== "object" || !whole(hz) || hz < 1 || !whole(j) || j < 0 || !whole(back) || back < 0) return null;
  const { ed, rd, rdMax, edMax } = row;
  const seen = [];
  if (whole(rd) && rd >= 0) seen.push(ageState(rd + j, back));
  if (whole(rdMax) && rdMax >= 0) seen.push(agreed(ageState(rdMax + j, back), rdMax - 1 + j >= 0 ? ageState(rdMax - 1 + j, back) : "ahead"));
  if (whole(ed) && ed >= 0 && ed <= j) {
    const late = whole(edMax) ? (edMax > ed ? edMax : null) : ed === 0 ? 1 : null;
    const first = ageState(j - ed, back);
    seen.push(late === null ? first : agreed(first, late <= j ? ageState(j - late, back) : "ahead"));
  }
  for (const state of PRECEDENCE) if (seen.includes(state)) return state;
  if (!whole(ed) || ed < 0) return "undated";
  return ed - j >= 1 && ed - j <= hz ? "ahead" : "clear";
}

export function laterCandidate(map, through, ticker, ed) {
  if (!whole(ed) || ed < 0) return null;
  if (map && typeof map === "object" && whole(map[ticker])) return map[ticker];
  return whole(through) && ed <= through ? null : ed + 1;
}

export function earningsInside(row, hz, j, back = REACTION_BACK_SESSIONS) {
  const s = earningsState(row, hz, j, back);
  return s === null ? null : EVENT_STATES[s];
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
