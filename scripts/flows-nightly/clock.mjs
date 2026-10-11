import { nextTradingDay, easternDay, easternClock, isTradingDay } from "../../shared/flows-freshness.js";
import { ARCHIVE_DATE_RE } from "./store.mjs";

export const SESSION_OPEN_MINUTES = 9 * 60 + 30;

export const SESSION_CLOSE_MINUTES = 16 * 60;

export const PIPELINE_CADENCE =
  "once per weekday after the close, at 21:30 UTC in summer and 22:30 UTC in winter — " +
  "17:30 America/New_York either way";

export function easternNow(at = new Date()) {
  const date = easternDay(at);
  const clock = easternClock(at);
  if (!date || !clock) throw new RangeError(`easternNow: ${String(at)} is not an instant`);
  return { date, minutes: clock.minutes };
}

export function sessionBarOverdue(sessionDate, wall) {
  return !!sessionDate && wall.date > sessionDate && isTradingDay(wall.date) && wall.minutes >= SESSION_CLOSE_MINUTES;
}

const clockSaid = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function intradayRefusal(sessionDate, { at = new Date(), allow = false } = {}) {
  const clock = easternNow(at);
  const inside = isTradingDay(clock.date) &&
    clock.minutes >= SESSION_OPEN_MINUTES && clock.minutes < SESSION_CLOSE_MINUTES;
  const said = `the Eastern clock reads ${clockSaid(clock.minutes)} on ${clock.date}, inside ` +
    `the ${clockSaid(SESSION_OPEN_MINUTES)}–${clockSaid(SESSION_CLOSE_MINUTES)} session`;
  return {
    inside,
    allowed: inside && !!allow,
    refuse: inside && !allow,
    clock,
    message: !inside ? null
      : allow
        ? `PUBLISHING FROM AN IN-PROGRESS TAPE because allow_intraday was set: ${said}. ` +
          `Candles are still cut at ${sessionDate || "the unresolved session"}, but the ` +
          "screener, chains, flow alerts, news and every other undated read describe " +
          `${clock.date}'s session in progress, published under ${sessionDate || "no session date"}.`
        : `refusing to publish session ${sessionDate || "(unresolved)"} from an in-progress ` +
          `tape: ${said}, so every undated vendor read — the screener, the chains, flow ` +
          `alerts, news — would describe ${clock.date}'s session in progress under the ` +
          `${sessionDate || "unresolved"} label. Run after the close, or dispatch with ` +
          "allow_intraday to publish it anyway.",
  };
}

export function closedPriceWindow(generatedAt, day) {
  if (!ARCHIVE_DATE_RE.test(String(day || ""))) return false;
  const at = typeof generatedAt === "string" ? new Date(generatedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return false;
  const clock = easternNow(at);
  const next = nextTradingDay(day, null);
  if (clock.date === day) return clock.minutes >= SESSION_CLOSE_MINUTES;
  if (clock.date < day || next === null) return false;
  if (clock.date < next) return true;
  return clock.date === next && clock.minutes < SESSION_OPEN_MINUTES;
}

export const easternDayOf = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v.trim())) {
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
  }
  const at = new Date(v.trim());
  return Number.isNaN(at.getTime()) ? null : easternNow(at).date;
};

export const readDayOf = (readAt) => easternDayOf(readAt);
