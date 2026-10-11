import { sessionOpen, sessionClose, easternInstant, closeMinutes, isTradingDay, PHASE_MINUTES }
  from "./flows-freshness.js";

export const TRT_OFFSET_MIN = 180;
export const TRT_LABEL = "TRT";

const MINUTE_MS = 60000;
const DAY_MIN = 1440;
const TRT_MS = TRT_OFFSET_MIN * MINUTE_MS;
const MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999) - TRT_MS;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)$/;
const WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

const two = (n) => (n < 10 ? "0" : "") + n;

const real = (y, mo, d) => {
  const x = new Date(Date.UTC(y, mo - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === mo - 1 && x.getUTCDate() === d;
};

const dayStart = (day) => {
  const m = typeof day === "string" ? DAY_RE.exec(day) : null;
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  return real(y, mo, d) ? Date.UTC(y, mo - 1, d) : null;
};

const stampMs = (s) => {
  const m = STAMP_RE.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = +m[4];
  const mi = +m[5];
  const sec = m[6] === undefined ? 0 : +m[6];
  if (h > 23 || mi > 59 || sec > 59 || !real(y, mo, d)) return null;
  const frac = m[7] === undefined ? 0 : +(m[7] + "00").slice(0, 3);
  let off = 0;
  if (m[9] !== undefined) {
    const oh = +m[10];
    const om = m[11] === undefined ? 0 : +m[11];
    if (oh > 23 || om > 59) return null;
    off = (m[9] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  return Date.UTC(y, mo - 1, d, h, mi, sec, frac) - off * MINUTE_MS;
};

const dateMs = (v) => {
  try {
    return Date.prototype.getTime.call(v);
  } catch {
    return NaN;
  }
};

export function instantOf(v) {
  let t = null;
  if (typeof v === "number") t = v;
  else if (typeof v === "string") t = stampMs(v);
  else if (typeof v === "object" && v !== null) t = dateMs(v);
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  t = Math.floor(t);
  return t > 0 && t <= MAX_MS ? t : null;
}

const shifted = (v) => {
  const t = instantOf(v);
  return t === null ? null : new Date(t + TRT_MS);
};

const hhmm = (d) => two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
const ymd = (d) => d.toISOString().slice(0, 10);

export function clock(v, zone = true) {
  const d = shifted(v);
  if (d === null) return null;
  return hhmm(d) + (zone === false ? "" : " " + TRT_LABEL);
}

export function stamp(v) {
  const d = shifted(v);
  return d === null ? null : ymd(d) + " " + hhmm(d) + " " + TRT_LABEL;
}

export function day(v) {
  const d = shifted(v);
  return d === null ? null : ymd(d);
}

export function when(v, now) {
  const d = shifted(v);
  if (d === null) return null;
  const n = shifted(now);
  return n !== null && ymd(n) === ymd(d) ? hhmm(d) + " " + TRT_LABEL : ymd(d) + " " + hhmm(d) + " " + TRT_LABEL;
}

export function axisMinutes(v, sessionDay) {
  const t = instantOf(v);
  const base = dayStart(sessionDay);
  if (t === null || base === null) return null;
  return Math.floor((t + TRT_MS - base) / MINUTE_MS);
}

export function tick(m) {
  if (typeof m !== "number" || !Number.isFinite(m)) return null;
  const n = ((Math.floor(m) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return two(Math.floor(n / 60)) + ":" + two(n % 60);
}

export function boundaries(sessionDay, row) {
  if (dayStart(sessionDay) === null || !isTradingDay(sessionDay, row)) return null;
  const at = (ms) => Object.freeze({ ms, trt: clock(ms, false), nextDay: day(ms) > sessionDay });
  return Object.freeze({
    pre: at(easternInstant(sessionDay, PHASE_MINUTES.preOpen)),
    open: at(sessionOpen(sessionDay)),
    close: at(sessionClose(sessionDay, row)),
    post: at(easternInstant(sessionDay, PHASE_MINUTES.postEnd)),
    early: closeMinutes(sessionDay, row) !== PHASE_MINUTES.close,
  });
}

export function sessionSaid(sessionDay, row) {
  const b = boundaries(sessionDay, row);
  return b === null ? null : "Regular " + b.open.trt + "-" + b.close.trt + " " + TRT_LABEL;
}

export function phaseSaid(phase, sessionDay, row) {
  if (phase === "closed") return "Closed";
  if (phase === "rth") return sessionSaid(sessionDay, row);
  const b = phase === "pre" || phase === "post" ? boundaries(sessionDay, row) : null;
  if (b === null) return null;
  return phase === "pre"
    ? "Pre-market " + b.pre.trt + "-" + b.open.trt + " " + TRT_LABEL
    : "After hours " + b.close.trt + "-" + b.post.trt + " " + TRT_LABEL;
}

export function nextOpenSaid(phase) {
  const d = shifted(phase && phase.nextOpen);
  return d === null ? null : "opens " + WEEKDAYS[d.getUTCDay()] + " " + hhmm(d) + " " + TRT_LABEL;
}
