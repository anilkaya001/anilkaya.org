function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dayKey(v) {
  if (typeof v !== "string") return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export const OVERLAY_NOTES = Object.freeze({
  join: "The two series are matched by session date. They are not zipped by " +
    "position: both are about forty points long and both run oldest first, so " +
    "an index join would draw a plausible chart out of two windows that need " +
    "not describe the same days.",

  gap: "A missing bar is a session the archive holds no score for this name — " +
    "the name was off the board, or that day's board was never written. The " +
    "series breaks rather than bridging: a bridged gap is a score nobody " +
    "computed, and a zero would be a NEUTRAL score, which is a reading this " +
    "system publishes and means.",

  axes: "Two units on one date axis. Price is in dollars and has no meaningful " +
    "zero; the score is bounded to plus or minus one hundred and its zero is the " +
    "centre of the dead band. They are drawn against separate scales, so the " +
    "bars and the line cannot be compared by height.",
  window: "The overlap is the intersection of the price window and the score " +
    "window, and either can be the shorter. Sessions outside it are counted and " +
    "named rather than silently dropped.",
});

export function joinScoreToPrice({
  closes = null, closeDates = null, sessions = null, scores = null, deadBand = null,
} = {}) {
  const unavailable = (reason) => ({ status: "unavailable", reason });

  if (!Array.isArray(closes) || !Array.isArray(closeDates)) {
    return unavailable(
      "this card carries no dated price history — closes and their dates are " +
      "published together, and a card built before that pairing shipped has the " +
      "prices without the days to hang them on");
  }
  if (!Array.isArray(sessions) || !Array.isArray(scores)) {
    return unavailable(
      "the score track was not read for this name in this run, so there is no " +
      "score history to lay over the price");
  }

  const priceByDay = new Map();
  let undatedCloses = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = numOrNull(closes[i]);
    const d = dayKey(closeDates[i]);
    if (c === null || !(c > 0)) continue;
    if (d === null) { undatedCloses++; continue; }
    priceByDay.set(d, c);
  }

  const scoreByDay = new Map();
  let undatedSessions = 0;
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const d = dayKey(s && s.d);
    if (d === null) { undatedSessions++; continue; }
    scoreByDay.set(d, numOrNull(scores[i]));
  }

  const priceDays = [...priceByDay.keys()].sort();
  const scoreDays = [...scoreByDay.keys()].sort();

  if (!priceDays.length) {
    return unavailable(
      "no close on this card carried both a price and a date, so nothing could " +
      "be placed on a date axis");
  }
  if (!scoreDays.length) {
    return unavailable(
      "the score track carried no dated session, so its scores cannot be placed " +
      "against anything");
  }

  const span = (days) => ({ from: days[0], to: days[days.length - 1], sessions: days.length });
  const priceSpan = span(priceDays);
  const scoreSpan = span(scoreDays);

  const rows = [];
  for (const d of priceDays) {
    if (!scoreByDay.has(d)) continue;
    rows.push({ d, close: priceByDay.get(d), score: scoreByDay.get(d) });
  }

  if (!rows.length) {

    return {
      status: "quiet",
      reason: "the price window and the score window do not share a single session",
      priceSpan, scoreSpan,
      overlap: 0,
      undatedCloses, undatedSessions,
    };
  }

  let scored = 0;
  for (const r of rows) if (r.score !== null) scored++;

  return {
    status: "ok",
    rows,
    overlap: rows.length,
    scored,

    gaps: rows.length - scored,
    priceSpan,
    scoreSpan,

    priceOnly: priceDays.length - rows.length,
    scoreOnly: scoreDays.length - rows.length,
    undatedCloses, undatedSessions,
    deadBand: numOrNull(deadBand),
    notes: OVERLAY_NOTES,
  };
}

export function scoreRowFor(track, ticker) {
  if (!track || !Array.isArray(track.names) || typeof ticker !== "string") return null;
  const want = ticker.toUpperCase();
  for (const row of track.names) {
    if (row && typeof row.t === "string" && row.t.toUpperCase() === want) return row;
  }
  return null;
}
