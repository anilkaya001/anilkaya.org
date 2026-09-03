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

   AND THE CHANGE, WHICH IS THE PART THIS MODULE WAS MISSING.

   This product measured a LEVEL every morning and published it
   eleven ways. It measured CHANGE exactly once, in ten lines of
   browser arithmetic inside a renderer, and it published that number
   without its denominator:

       const measured = name.s.map(isNum).filter(v => v !== null);
       const delta = measured.at(-1) - measured.at(-2);

   Filtering the nulls out before subtracting is the defect. A gap in
   the series means the name WAS NOT SCORED that session, so the two
   surviving neighbours can be one session apart or twenty — and the
   subtraction produces the same integer either way. "+38" is the
   headline of the session when it happened overnight and is noise
   when it happened across three weeks the name spent off the board.
   The renderer had no way to tell those apart, because the number it
   printed had thrown away the only thing that distinguished them.

   So the change is derived HERE, once, beside the series it is
   derived from, and it travels WITH ITS DENOMINATOR:

     d1.v    the move, in score units
     d1.gap  how many sessions it took — 1 is overnight, and anything
             larger is a name that was absent in between
     d1.qv   the same move in RESIDUAL units, when both observations
             carried one

   `qv` is there because `s` saturates. The score is 100·tanh(residual
   / scale), so two names at +94 and +97 can be very far apart in the
   quantity that was actually ranked, and a move from +94 to +97 is a
   much larger event than a move from +4 to +7. In score units those
   are +3 and +3. The residual does not compress, so a reader with
   both numbers can see which kind of move they are looking at.

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

/* AND THE CEILING THAT IS ACTUALLY BINDING, IN THE UNIT THAT BINDS.

   The constraint is BYTES — the ingest route rejects a payload over
   FLOWS_MAX_PAYLOAD_BYTES with a 413 — and TRACK_MAX_NAMES is a guess at a
   byte count expressed as a name count. That guess was made when a name row
   was `{t, s, n, last}`; the row has since grown a change layer, a run length
   and a pair of window extremes, and the guess did not move with it.

   The arithmetic, measured on the emitted corpus: a name row costs about 243
   bytes at 23 sessions, of which the series is roughly 5 bytes a session and
   the scalars are a fixed ~80. At the published 42-session window and the
   two-to-three-hundred names a real union produces, that projects past 128KB
   — so the name cap would not have bound, the ROUTE would have, and the
   failure mode is a 413 in a log at 05:20 with the whole track key missing
   for the day rather than a stated shed on a payload that published.

   So the shed is driven by the measurement instead of by the guess. Both
   ceilings stand: whichever binds first, binds. The name cap keeps its job as
   a cheap upper bound; this one is the honest one, and it self-corrects the
   next time a field is added to the row.

   96KB against the route's 128KB: the envelope this body is wrapped in
   (`v`, `generatedAt`, `sessionDate`, the archive block) costs a few hundred
   bytes, `sessions` costs about 60 a session, and the notes are prose. A
   quarter of the cap is room for all of that plus the next field somebody
   adds without reading this comment. */
export const TRACK_MAX_BYTES = 96 * 1024;

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
  run:
    "The run is how many consecutive scored sessions a name has held its " +
    "current sign. It is counted over the sessions the name was actually " +
    "scored, so a day out of the screener does not read as a change of side, " +
    "and a score of exactly zero belongs to neither side and ends the run. A " +
    "run of one is a new opinion; a run of thirty is an old one.",
  change:
    "A change is stated with the number of sessions it took. The two " +
    "observations behind it are the last two on which the name was actually " +
    "scored, and those need not be adjacent: a name off the board for three " +
    "weeks returns with a large move that took three weeks. A gap of one is " +
    "an overnight move and is the only kind that describes this session.",
  crossing:
    "A crossing is a change of category rather than of degree. Inside the " +
    "dead band a name is published as watch-only and reaches no board; " +
    "outside it the name is ranked. A name that CLEARED the band became " +
    "actionable this session, one that FADED stopped being so, and one that " +
    "FLIPPED changed sides without resting in the middle. Everything else " +
    "the change layer reports is drift, however large.",
  saturation:
    "The score is a bounded transform of the residual that was ranked, so it " +
    "compresses at the ends: a move from +94 to +97 covers far more of the " +
    "underlying quantity than a move from +4 to +7, and both read as three " +
    "points. Where both observations carried a residual, the move is also " +
    "given in residual units, which do not compress.",
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
    /* `q` IS THE QUANTITY THAT WAS ACTUALLY RANKED, and it is archived
       because `s` is a lossy view of it.

       partitionSides orders on the FULL-PRECISION residual and says so
       explicitly — "score is for display; residual decides" — and then the
       archive kept only the display copy. That was survivable while the
       archive answered "what did we say", and stops being survivable the
       moment it has to answer "how much did that change": 100·tanh saturates,
       so at the ends of the distribution the score stops moving long before
       the residual does. A name grinding from 2.1 to 3.4 residual sigma is a
       large event that the score reports as +96 to +98.

       Scaled by 1e4 and rounded to an integer: residuals live around ±0.02
       and the band edge sits near 0.0055, so four decimal places resolve the
       band edge to about a fifteenth of its own width, and an integer is
       shorter on the wire than the decimal it replaces. Null rather than 0
       when the row carried no residual — a backfilled day has none, and a
       zero residual is a real reading that means "exactly at the pool
       median". */
    const q = num(r && r.residual);
    rows.push(q === null ? { t, s } : { t, s, q: Math.round(q * 1e4) });
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
  maxBytes = TRACK_MAX_BYTES,
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

  /* One pass per session, aligned series per name. The residual rides in a
     PARALLEL map rather than in the published series: it is needed for exactly
     one subtraction per name, and forty-two of them per name would roughly
     double a payload that already sits against a 128KB cap. */
  const series = new Map();
  const resid = new Map();
  dates.forEach((d, i) => {
    for (const row of byDate.get(d).rows) {
      const t = row && row.t;
      const s = num(row && row.s);
      if (!t || s === null) continue;
      if (!series.has(t)) series.set(t, new Array(dates.length).fill(null));
      series.get(t)[i] = s;
      const q = num(row && row.q);
      if (q !== null) {
        if (!resid.has(t)) resid.set(t, new Array(dates.length).fill(null));
        resid.get(t)[i] = q;
      }
    }
  });

  const lastIndex = dates.length - 1;
  const priorIndex = dates.length - 2;

  /* THE CHANGE LAYER. Derived here, from the series, in the same pass that
     already walks it — and travelling with the two facts that decide whether
     it means anything: how many sessions it spans, and where it ends.

     WHY THE LAST TWO *SCORED* SESSIONS AND NOT THE LAST TWO SESSIONS. A name
     absent from yesterday's pool has no yesterday to subtract. The choice is
     between "no change" (which is a lie: it moved, we just were not watching)
     and "the move since we last looked, with how long ago that was" — and only
     the second is a statement a reader can act on or discard on its own terms.
     `gap` is what makes it discardable: a consumer wanting strictly overnight
     moves filters on gap === 1, and a consumer wanting "what has happened
     since we last had an opinion" takes them all. Neither can be recovered
     from a bare delta, which is why the renderer that computed one was
     publishing a number nobody could interpret. */
  let names = [...series.entries()].map(([t, s]) => {
    let n = 0, last = null, lastAt = -1, prev = null, prevAt = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === null) continue;
      n++;
      prev = last; prevAt = lastAt;
      last = s[i]; lastAt = i;
    }

    /* GUARDED ON THE INDEX, NOT ON THE VALUE. `prev === null` is the sentinel
       and it is also a legal reading — a score of 0 sits at the centre of the
       dead band and this pipeline assigns it. An index of -1 cannot be
       anything but "there was no earlier observation". */
    let d1 = null;
    if (prevAt >= 0) {
      d1 = { v: last - prev, gap: lastAt - prevAt };
      const qs = resid.get(t);
      /* Both ends or neither. A residual differenced against an absent one is
         not a smaller number, it is a different quantity. Board-only backfill
         days carry no residual at all, so this is null across most of the
         archive's older half and says so by being absent. */
      if (qs && qs[lastAt] !== null && qs[prevAt] !== null) d1.qv = qs[lastAt] - qs[prevAt];

      /* THE CROSSING — the one move on this page that is an EVENT rather than
         a drift, and it was one comparison away from a number already here.

         Everything else the change layer publishes is a magnitude, and a
         magnitude is a matter of degree: +88 to +91 is the same kind of thing
         as +4 to +7, only larger. The dead band is the one threshold this
         product actually acts on — inside it a name is published as
         watch-only and reaches no board, outside it the name is ranked and
         gets a card — so a name crossing it did not merely move, it changed
         category. That is the sentence an early-warning surface exists to
         print, and until now nothing computed it: `deadBand` rode on this
         payload and was used only to draw a shaded strip behind a sparkline.

         THREE TRANSITIONS, and they are mutually exclusive by construction:

           cleared — was inside the band, is now outside it. The name became
                     actionable this session. Sign says which side.
           faded   — was outside, is now inside. The name stopped being
                     actionable, which is the exit signal and is exactly as
                     load-bearing as the entry.
           flipped — outside the band at both ends, opposite signs. The name
                     did not weaken and re-strengthen; it changed its mind,
                     and it did so without ever resting in the middle.

         A NULL BAND MEANS NO CLASSIFICATION, not a band of zero. num() would
         answer 0 for an absent deadBand and every name would then read as
         permanently outside a zero-width band — the confident zero, on the
         one field whose whole job is to be a threshold. */
      const band = num(deadBand);
      if (band !== null && band >= 0) {
        const wasIn = Math.abs(prev) <= band;
        const isIn = Math.abs(last) <= band;
        if (wasIn && !isIn) d1.cross = "cleared";
        else if (!wasIn && isIn) d1.cross = "faded";
        else if (!wasIn && !isIn && Math.sign(prev) !== Math.sign(last)) d1.cross = "flipped";
      }
    }

    /* THE RUN AND THE EXTREMES — two more facts the matrix already contains
       and nobody was deriving from it.

       This payload shipped a 42-by-N matrix with four scalars beside it, and
       the three orderings the track page offers are all snapshots of the
       newest column: strongest last score, last score, most sessions
       measured. A forty-two-session history page on which a reader cannot ask
       which name MOVED is a table of levels wearing a chart's clothes.

       `run` is how many consecutive measured sessions the name has held its
       current sign — the answer to "is this a new opinion or an old one",
       which is the question that separates a name worth opening from a name
       that has been shouting the same thing for a month. Counted over
       MEASURED sessions only: a gap is not evidence of a side change, and
       breaking the run on one would make a name that fell out of the screener
       for a day look like it had just turned.

       `ext` is the window's own high and low with the sessions they happened
       on, which turns "highest score in forty-two sessions" from something a
       reader has to eyeball off a sparkline into a stated event with a date.

       BOTH ARE FREE IN THE SAME PASS and neither needs a vendor call. A name
       at its window high on the first session of a new side is the strongest
       thing this archive can say, and until now it could not say it. */
    let run = 0, hi = null, hiAt = -1, lo = null, loAt = -1;
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (v === null) continue;
      if (hi === null || v > hi) { hi = v; hiAt = i; }
      if (lo === null || v < lo) { lo = v; loAt = i; }
      /* Math.sign(0) is 0, and a score of zero is a real reading at the
         centre of the dead band — it belongs to neither side, so it ends
         whatever run was going rather than extending or flipping it. */
      run = (last !== null && v !== 0 && Math.sign(v) === Math.sign(last)) ? run + 1 : 0;
    }

    return {
      t, s, n, last, lastAt, d1, run,
      ext: hiAt < 0 ? null : { hi, hiAt, lo, loAt },
    };
  });

  /* WHAT THE CHANGE IS A CHANGE *OF*, counted over the whole pool rather than
     over the handful of rows a page happens to draw. A reader shown "eight
     names moved" needs to know whether eight is out of twelve or out of four
     hundred, and a renderer counting its own visible rows cannot tell them. */
  const change = (() => {
    if (dates.length < 2) {
      return {
        session: dates[lastIndex] || null, prior: null,
        comparable: 0, consecutive: 0, moved: 0, held: 0,
        current: 0, entered: 0, left: 0,
        band: num(deadBand),
        crossings: { cleared: 0, faded: 0, flipped: 0 },
        status: "single-session",
      };
    }
    let comparable = 0, consecutive = 0, moved = 0, held = 0;
    let current = 0, entered = 0, left = 0;
    const crossings = { cleared: 0, faded: 0, flipped: 0 };
    for (const nm of names) {
      if (nm.lastAt === lastIndex) {
        current++;
        if (!nm.d1) entered++;
      } else if (nm.lastAt === priorIndex) {
        left++;
      }
      if (!nm.d1) continue;
      comparable++;
      if (nm.d1.gap === 1) consecutive++;
      if (nm.d1.v === 0) held++; else moved++;
      if (nm.d1.cross) crossings[nm.d1.cross]++;
    }
    return {
      session: dates[lastIndex], prior: dates[priorIndex],
      comparable, consecutive, moved, held, current, entered, left,
      /* THE BAND ITSELF, beside the counts it produced. A crossing count with
         no threshold attached cannot be checked, and this payload is read by
         a renderer that would otherwise restate the constant in its own prose
         — a second copy of a number that has already moved once. */
      band: num(deadBand),
      crossings,
      /* THREE OUTCOMES, THREE WORDS, and they are not the same absence.
         "cold" — nothing has two observations, so no change exists to report.
         "flat" — everything was compared and nothing moved, which is a
         reading about the session rather than about the archive.
         "ok"   — something moved. */
      status: !comparable ? "cold" : (moved ? "ok" : "flat"),
    };
  })();

  /* Most-observed first, then the stronger |last|, then the ticker — a
     total order, so the shed below and the payload bytes are deterministic. */
  names.sort((a, b) =>
    b.n - a.n
    || Math.abs(b.last) - Math.abs(a.last)
    || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const namesSeen = names.length;
  if (names.length > maxNames) names = names.slice(0, maxNames);

  /* THE BYTE SHED. Measured rather than modelled: a row's cost depends on the
     window length, on how many of its sessions are gaps (`null` is four
     characters and a score is one to four), and on whether it carries a
     residual change — none of which a per-row constant can know.

     Cumulative and forward, so the sort order above decides who survives and
     the result is deterministic: the same archive builds the same bytes, which
     is the property the once-per-session immutability contract rests on. The
     `+ 1` is the comma JSON.stringify would put between rows, and `[]` is the
     two brackets; a budget that ignored them would be a budget that is wrong
     by the number of names, which is exactly the size of the thing being
     budgeted. */
  let used = 2;
  let fits = names.length;
  for (let i = 0; i < names.length; i++) {
    const cost = JSON.stringify(names[i]).length + (i ? 1 : 0);
    if (used + cost > maxBytes) { fits = i; break; }
    used += cost;
  }
  if (fits < names.length) names = names.slice(0, fits);

  /* COUNTED AGAINST WHAT WAS SEEN, not against either cap, so the number a
     reader is shown is "how many names exist that you are not being shown"
     rather than "how many the second of two ceilings removed". */
  const shed = Math.max(0, namesSeen - names.length);

  return {
    windowSessions,
    deadBand,
    epoch,
    sessions,
    names,
    namesSeen,
    namesShed: shed,
    /* WHICH CEILING BOUND, because "40 names shed" invites two different
       reactions and only one of them is right: a name cap that bound is a
       constant somebody chose and can raise, and a byte cap that bound is the
       row shape having outgrown the route. */
    shedBy: !shed ? null : (namesSeen > maxNames && names.length === maxNames ? "names" : "bytes"),
    namesBytes: used,
    /* COUNTED BEFORE THE SIZE CAP SHEDS, and that is deliberate: `change`
       describes the SESSION, and a name dropped for payload budget was still
       scored. Counting after the shed would make the published totals a
       function of TRACK_MAX_NAMES, which is a wire constraint and not a fact
       about the market. `namesShed` beside it says how many rows a reader is
       not being shown. */
    change,
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
