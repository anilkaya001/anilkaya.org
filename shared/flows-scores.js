/* =============================================================
   flows-scores.js — the per-name daily score, archived and traced.

   WHAT THIS IS. Every morning the pipeline scores its enriched pool
   and publishes two fifty-row slices of it. The slices are the
   product; the DISTRIBUTION is the evidence — and until this module,
   the middle of the distribution died with the run. A name sitting at
   +19 the session before it breaks out was archived only if it made a
   board, so the question "what did we say about this name every day"
   had an answer for at most a hundred names and silence for the rest.

   Two quantities, two keys:

     scores:YYYY-MM-DD — one session's whole scored pool, immutably.
       {t, s} per name, nothing else: the score is the subject here,
       and every other column already lives on the boards this key
       sits beside in the archive.

     scoretrack — the pooled trace: each name's score, session by
       session, over a stated window. Built by reading the dated keys
       back, exactly as the track record is, and REBUILT from scratch
       each run — it is a view of the archive, not a second store
       that could drift from it.

   WHAT A GAP MEANS, because it is the easiest thing here to misread:
   a null in a series says the name WAS NOT SCORED that session — it
   fell out of the screener, failed the liquidity floor, sat inside
   the earnings gate, or the pool simply chose differently. It never
   means zero. Zero is a score this pipeline can and does assign, and
   the two must not share a pixel.
   ============================================================= */

/* Number(null) is 0 — a CONFIDENT ZERO materialised out of an absent
   measurement, which on this page of all pages is the one defect that
   cannot exist. Absent in, absent out. The suite constructs exactly this
   row and caught exactly this coercion on its first run. */
const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* THE WINDOW IS A CHOICE AND IT IS PUBLISHED AS ONE. Forty-two sessions is
   the board's own sparkline window — two months — chosen so the two surfaces
   describe the same span of history rather than two arbitrary ones. Nothing
   in the data picks it; `windowSessions` rides on the payload so a reader
   can see the cut. The archive retains 126 days, so widening this later is
   a constant, not a migration. */
export const TRACK_SESSIONS = 42;

/* A ceiling on the names the pooled payload carries, against the ingest
   route's 128KB cap. In practice a window of 42 sessions unions to two or
   three hundred names; five hundred is headroom, not a target. When it
   binds, the names shed are the LEAST OBSERVED (smallest n, ties to the
   larger |last| kept) and the payload says how many went. */
export const TRACK_MAX_NAMES = 500;

export const SCORES_NOTES = Object.freeze({
  score:
    "The score is the board's own composite, unchanged: a cross-sectional " +
    "residual in fixed units, sign pointing long, with sector and " +
    "log-capitalisation neutralised out before ranking. This page adds no " +
    "arithmetic to it — it is the same number the board printed that " +
    "morning, traced.",
  gaps:
    "A gap means the name was not scored that session — out of the " +
    "screener, under the liquidity floor, inside the earnings gate, or not " +
    "selected for enrichment. It never means zero: zero is a score this " +
    "pipeline assigns, and an absence must not be drawn where a " +
    "measurement could be.",
  backfill:
    "Sessions marked board-only predate the dated scores key and were " +
    "reconstructed from the archived boards, which carry only the names " +
    "that made a board that day. The middle of that session's distribution " +
    "was never archived and cannot be recovered; those columns are " +
    "genuinely sparser, not quieter.",
  epoch:
    "Scores on either side of the selection epoch come from different " +
    "pools under different selection rules. A name's trace across the " +
    "epoch is two experiments wearing one line, and the page marks the " +
    "boundary rather than smoothing over it.",
  window:
    "The window length is a choice, stated on the payload as " +
    "windowSessions. The archive behind it retains 126 days.",
});

/**
 * One session's publishable score rows, from the partitioned pool.
 *
 * The WHOLE pool: long, short, and the dead-band middle. Sorted by ticker so
 * the archived bytes are deterministic — two runs on the same session write
 * identical rows, which is what makes a re-run idempotent rather than a
 * mutation.
 */
export function scoresRows(sides) {
  const pool = [
    ...(sides && Array.isArray(sides.long) ? sides.long : []),
    ...(sides && Array.isArray(sides.short) ? sides.short : []),
    ...(sides && Array.isArray(sides.neutralRows) ? sides.neutralRows : []),
  ];
  const rows = [];
  const seen = new Set();
  for (const r of pool) {
    const t = r && r.ticker;
    const s = num(r && r.score);
    if (!t || s === null || seen.has(t)) continue;
    seen.add(t);
    rows.push({ t, s });
  }
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return rows;
}

/**
 * The pooled trace, from whatever the archive walk found.
 *
 * @param {Array<{d: string, rows: Array<{t, s}>, source: "scores"|"boards"}>} days
 *   One entry per session the walk could reconstruct, either from the dated
 *   scores key (source "scores": the whole pool) or from the two archived
 *   boards (source "boards": only the names that made a board). Order free.
 * @returns the scoretrack payload body (no envelope fields).
 */
export function buildScoreTrack(days, {
  windowSessions = TRACK_SESSIONS,
  maxNames = TRACK_MAX_NAMES,
  deadBand = 1,
  epoch = null,
} = {}) {
  const byDate = new Map();
  for (const day of days || []) {
    if (!day || typeof day.d !== "string" || !Array.isArray(day.rows)) continue;
    /* A scores day beats a boards day for the same date — it is a superset
       by construction. Two entries of the SAME source for one date should
       not happen; last write wins and the count below would show it. */
    const have = byDate.get(day.d);
    if (have && have.source === "scores" && day.source !== "scores") continue;
    byDate.set(day.d, { rows: day.rows, source: day.source === "scores" ? "scores" : "boards" });
  }

  const dates = [...byDate.keys()].sort().slice(-windowSessions);

  const sessions = dates.map((d) => {
    const e = byDate.get(d);
    return {
      d,
      source: e.source,
      names: e.rows.length,
      preEpoch: epoch ? d < epoch : false,
    };
  });

  /* One pass per session, aligned series per name. */
  const series = new Map();
  dates.forEach((d, i) => {
    for (const row of byDate.get(d).rows) {
      const t = row && row.t;
      const s = num(row && row.s);
      if (!t || s === null) continue;
      if (!series.has(t)) series.set(t, new Array(dates.length).fill(null));
      series.get(t)[i] = s;
    }
  });

  let names = [...series.entries()].map(([t, s]) => {
    let n = 0, last = null;
    for (const v of s) if (v !== null) { n++; last = v; }
    return { t, s, n, last };
  });

  /* Most-observed first, then the stronger |last|, then the ticker — a
     total order, so the shed below and the payload bytes are deterministic. */
  names.sort((a, b) =>
    b.n - a.n
    || Math.abs(b.last) - Math.abs(a.last)
    || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const namesSeen = names.length;
  const shed = Math.max(0, namesSeen - maxNames);
  if (shed) names = names.slice(0, maxNames);

  return {
    windowSessions,
    deadBand,
    epoch,
    sessions,
    names,
    namesSeen,
    namesShed: shed,
    sources: {
      full: sessions.filter((x) => x.source === "scores").length,
      boardsOnly: sessions.filter((x) => x.source === "boards").length,
    },
    status: names.length ? "ok" : "empty",
    notes: SCORES_NOTES,
  };
}

/**
 * Board rows folded into a backfill day: the two archived slices of one
 * session, deduplicated. `s` is the same field the board row carries.
 */
export function boardsToScoreRows(boardRowsBySide) {
  const seen = new Set();
  const rows = [];
  for (const list of boardRowsBySide || []) {
    for (const r of list || []) {
      const t = r && r.t;
      const s = num(r && r.s);
      if (!t || s === null || seen.has(t)) continue;
      seen.add(t);
      rows.push({ t, s });
    }
  }
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return rows;
}
