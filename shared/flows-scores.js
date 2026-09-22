const num = (v, d = null) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const TRACK_SESSIONS = 42;

export const TRACK_MAX_NAMES = 500;

export const TRACK_MAX_BYTES = 96 * 1024;

export const SCORES_NOTES = Object.freeze({
  score:
    "The score is the board's own composite, unchanged: a cross-sectional " +
    "residual in fixed units, sign pointing long, with sector and " +
    "log-capitalisation neutralised out before ranking. This page adds no " +
    "arithmetic to it — it is the same number the board printed for that " +
    "session, traced.",
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

    const q = num(r && r.residual);

    const prem = (() => {
      if (!r) return null;
      const direct = num(r.netPrem);
      if (direct !== null) return direct;
      const call = r.net_call_premium, put = r.net_put_premium;
      if (call === undefined && put === undefined) return null;
      const c = num(call), pu = num(put);
      if (c === null && pu === null) return null;
      return (c || 0) - (pu || 0);
    })();
    const row = q === null ? { t, s } : { t, s, q: Math.round(q * 1e4) };
    if (prem !== null) row.p = Math.round(prem);
    rows.push(row);
  }
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return rows;
}

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

  const series = new Map();
  const resid = new Map();

  const premium = new Map();
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

      const pv = num(row && row.p);
      if (pv !== null) {
        if (!premium.has(t)) premium.set(t, new Array(dates.length).fill(null));
        premium.get(t)[i] = pv;
      }
    }
  });

  const lastIndex = dates.length - 1;
  const priorIndex = dates.length - 2;

  let names = [...series.entries()].map(([t, s]) => {
    let n = 0, last = null, lastAt = -1, prev = null, prevAt = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === null) continue;
      n++;
      prev = last; prevAt = lastAt;
      last = s[i]; lastAt = i;
    }

    let d1 = null;
    if (prevAt >= 0) {
      d1 = { v: last - prev, gap: lastAt - prevAt };
      const qs = resid.get(t);

      if (qs && qs[lastAt] !== null && qs[prevAt] !== null) d1.qv = qs[lastAt] - qs[prevAt];

      const band = num(deadBand);
      if (band !== null && band >= 0) {
        const wasIn = Math.abs(prev) <= band;
        const isIn = Math.abs(last) <= band;
        if (wasIn && !isIn) d1.cross = "cleared";
        else if (!wasIn && isIn) d1.cross = "faded";
        else if (!wasIn && !isIn && Math.sign(prev) !== Math.sign(last)) d1.cross = "flipped";
      }
    }

    let run = 0, hi = null, hiAt = -1, lo = null, loAt = -1;
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (v === null) continue;
      if (hi === null || v > hi) { hi = v; hiAt = i; }
      if (lo === null || v < lo) { lo = v; loAt = i; }

      run = (last !== null && v !== 0 && Math.sign(v) === Math.sign(last)) ? run + 1 : 0;
    }

    return {
      t, s, n, last, lastAt, d1, run,
      ext: hiAt < 0 ? null : { hi, hiAt, lo, loAt },
    };
  });

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

      band: num(deadBand),
      crossings,

      status: !comparable ? "cold" : (moved ? "ok" : "flat"),
    };
  })();

  names.sort((a, b) =>
    b.n - a.n
    || Math.abs(b.last) - Math.abs(a.last)
    || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const namesSeen = names.length;
  if (names.length > maxNames) names = names.slice(0, maxNames);

  let used = 2;
  let fits = names.length;
  for (let i = 0; i < names.length; i++) {
    const cost = JSON.stringify(names[i]).length + (i ? 1 : 0);
    if (used + cost > maxBytes) { fits = i; break; }
    used += cost;
  }
  if (fits < names.length) names = names.slice(0, fits);

  const shed = Math.max(0, namesSeen - names.length);

  return {
    windowSessions,
    deadBand,
    epoch,
    sessions,
    names,
    namesSeen,
    namesShed: shed,

    shedBy: !shed ? null : (namesSeen > maxNames && names.length === maxNames ? "names" : "bytes"),
    namesBytes: used,

    change,
    sources: {
      full: sessions.filter((x) => x.source === "scores").length,
      boardsOnly: sessions.filter((x) => x.source === "boards").length,
    },
    status: names.length ? "ok" : "empty",
    notes: SCORES_NOTES,

    premium,
  };
}

export function boardsToScoreRows(boardRowsBySide) {
  const seen = new Set();
  const rows = [];
  for (const list of boardRowsBySide || []) {
    for (const r of list || []) {
      const t = r && r.t;
      const s = num(r && r.s);
      if (!t || s === null || seen.has(t)) continue;
      seen.add(t);

      const p = num(r && r.netPrem);
      const out = { t, s };
      if (p !== null) out.p = Math.round(p);
      rows.push(out);
    }
  }
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return rows;
}
