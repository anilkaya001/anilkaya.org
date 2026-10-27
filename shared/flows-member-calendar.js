import { sessionsBetween } from "./flows-cross.js";
import { HORIZON_SESSIONS } from "./flows-horizon.js";

export { sessionsBetween, HORIZON_SESSIONS };

export function withinHorizon(fromDay, toDay) {
  const n = sessionsBetween(fromDay, toDay);
  return n !== null && n >= 0 && n <= HORIZON_SESSIONS;
}

export function contaminated(sessionsUntil) {
  return Number.isFinite(sessionsUntil) && sessionsUntil >= 0 && sessionsUntil <= HORIZON_SESSIONS;
}
