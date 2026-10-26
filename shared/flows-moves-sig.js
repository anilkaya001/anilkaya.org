import { benjaminiHochberg } from "./flows-stats.js";
import { HORIZON_SESSIONS, earningsInside, horizonWords } from "./flows-horizon.js";

export const SIG_SESSIONS = 252;
export const SIG_EVENT_SESSIONS = HORIZON_SESSIONS;
export const SIG_MIN_Z = 2;
export const SIG_Q = 0.1;

export const SIG_FLAGGED_LINE = "Beyond the usual for this name, after correcting for how many names were tested.";
export const SIG_PLAIN_LINE = "Not beyond the usual for this name, after correcting for how many were tested.";
export const SIG_REASONS = Object.freeze({
  below: "Below 2 typical days: not tested, but counted in the correction.",
  event: horizonWords(SIG_EVENT_SESSIONS).untested,
  noscale: "No typical day is published, so no test.",
  nocount: "The count of days beyond that is not published, so no test.",
});
export const SIG_INFO_SENTENCES = Object.freeze([
  "The test asks if today's move is beyond the name's own one-year rate.",
  "The rate is days beyond 2 or 3 typical days, plus one, over 253.",
  "So the smallest p is 1 in 253, and few names can pass.",
  "Every name with a typical day and no earnings is counted in the correction.",
  "Names are corrected together at a 10% false-discovery rate.",
  "Big market days move many names at once, so the test can overstate.",
  "It is a ranking aid, not a forecast.",
]);
export const SIG_FOOT_NONE = "No name could be tested.";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function sigOf(x) {
  const chg = num(x.chg), sig = num(x.sig);
  if (chg === null || sig === null || !(sig > 0)) return { t: x.t, state: "noscale", z: null, level: null, hits: null, p: null };
  const lm = chg > -1 ? Math.log1p(chg) : null;
  if (lm === null) return { t: x.t, state: "nomove", z: null, level: null, hits: null, p: null };
  const z = lm / sig;
  if (earningsInside(x, SIG_EVENT_SESSIONS, 0) === true) return { t: x.t, state: "event", z, level: null, hits: null, p: null };
  if (Math.abs(lm) < SIG_MIN_Z * sig) return { t: x.t, state: "below", z, level: null, hits: null, p: 1 };
  const level = Math.abs(lm) >= 3 * sig ? 3 : 2;
  const hits = level === 3 ? x.f3 : x.f2;
  if (!Number.isInteger(hits) || hits < 0 || hits > SIG_SESSIONS) return { t: x.t, state: "nocount", z, level, hits: null, p: null };
  return { t: x.t, state: "tested", z, level, hits, p: (hits + 1) / (SIG_SESSIONS + 1) };
}

export function sigRun(rows, q = SIG_Q) {
  const items = rows.map(sigOf);
  const bh = benjaminiHochberg(items.map((i) => i.p), q);
  let tested = 0, flagged = 0;
  const out = items.map((it, i) => {
    const flag = it.state === "tested" && bh.reject[i] === true;
    if (it.state === "tested") tested++;
    if (flag) flagged++;
    return { ...it, adj: it.state === "tested" ? bh.adjusted[i] : null, flag, counted: it.p !== null };
  });
  return { q, m: bh.m, tested, flagged, items: out };
}
