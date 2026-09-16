export const REFRESH_CADENCE_MINUTES = 15;

const OPEN_MINUTES = 9 * 60 + 15;
const CLOSE_MINUTES = 16 * 60 + 15;

export function easternDay(at) {

  const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
  const usable = at instanceof Date ||
    (typeof at === "string" && INSTANT.test(at.trim()));
  if (!usable) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]));
  return parts.year && parts.month && parts.day
    ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

export function easternClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : null;
  };
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return { weekday, minutes: (hour % 24) * 60 + minute };
}

export function isRefreshWindow(date) {
  const clock = easternClock(date);
  if (!clock) return false;
  if (clock.weekday === "Sat" || clock.weekday === "Sun") return false;
  return clock.minutes >= OPEN_MINUTES && clock.minutes <= CLOSE_MINUTES;
}

export function lastCompletedSession(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const clock = easternClock(d);
  if (!clock) return null;

  let steps = 0;
  const closed = clock.weekday !== "Sat" && clock.weekday !== "Sun" &&
    clock.minutes > CLOSE_MINUTES;
  if (!closed) steps = 1;
  for (let i = 0; i < 7; i++) {
    const at = new Date(d.getTime() - steps * 86400000);
    const c = easternClock(at);
    if (c && c.weekday !== "Sat" && c.weekday !== "Sun") return easternDay(at);
    steps += 1;
  }
  return null;
}
