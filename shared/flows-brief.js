/* =============================================================
   flows-brief.js — the three-session briefing.

   Three fixed questions the product must always be able to answer:
   what happened yesterday, what the session says today, and what is
   already scheduled to change before the next one.

   PURE, AND THAT IS THE WHOLE POINT. No DOM, no fetch, no model.
   It takes payloads the pipeline already published and returns a
   structured briefing. Every figure it emits is QUOTED from a
   payload field and travels in `n` beside the sentence that uses
   it — so a renderer draws it, and a language model, if one is ever
   put in front of this, can rephrase the prose while being
   structurally unable to alter a number. A briefing that could
   invent a gamma flip level would be worse than no briefing.

   THERE IS NO FORECAST HERE AND THERE MUST NEVER BE ONE. The
   "next" section is allowed exactly two kinds of statement:

     SCHEDULED FACTS — who reports before the next session, and
     therefore which names the earnings gate will remove. A calendar
     entry is not a prediction.

     THRESHOLD PROXIMITY — who sits close to something measurable:
     just outside the dead band, inside the exit band on incumbency,
     near their gamma flip. "X is 0.3 points from the band" is a
     measurement about TODAY, phrased so a reader can see what would
     change. "X will move tomorrow" is a claim nobody can support
     and this module may not produce one.

   AND EVERY SECTION OWNS ITS OWN SILENCE. Yesterday's board can be
   legitimately absent — a holiday, a first run, a key past the 126
   day retention — and "no board was published yesterday" is a
   different sentence from "yesterday's board was empty". The three
   silences this product distinguishes everywhere else are
   distinguished here too.
   ============================================================= */

/* THE MISSING-VALUE TEST BEFORE THE COERCION. Number(null) is 0 and
   0 is a legitimate score, a legitimate premium and a legitimate
   count, so a briefing that coerced first would state measured
   readings it never received. Admits the vendor's quoted numbers,
   refuses blanks and non-scalars — the canonical form, matching
   assets/js/flows-ui.js and shared/flows-market.js numOrNull. */
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const rows = (p) => (p && p.status !== "pending" && Array.isArray(p.rows) ? p.rows : null);
const answered = (p) => (p && typeof p === "object" && p.status !== "pending" ? p : null);

/**
 * WHICH SILENCE THIS IS, named rather than collapsed.
 *
 * The store answers an unpublished key with {status:"pending"}, an
 * unreadable one with null, and a measured-empty one with rows: [].
 * Three different facts about the world; three different sentences.
 */
export function silenceOf(payload, what) {
  if (payload === null || payload === undefined) {
    return { kind: "unreadable", what,
      say: "The " + what + " could not be read, so nothing about it is stated here. " +
           "That is a fault on this page rather than a fact about the session." };
  }
  if (typeof payload !== "object") {
    return { kind: "unreadable", what,
      say: "The " + what + " arrived in a shape this briefing cannot read." };
  }
  if (payload.status === "pending") {
    return { kind: "pending", what,
      say: "The " + what + " has not been published for this session yet. " +
           "Nothing has been measured, so nothing is claimed." };
  }
  const r = rows(payload);
  if (r !== null && r.length === 0) {
    return { kind: "quiet", what,
      say: "The " + what + " was measured and holds nothing. That is a reading, not a gap." };
  }
  return null;
}

/* A fact carries its numbers separately from its sentence. `say` is
   what a page prints; `n` is what may not be changed. */
const fact = (id, say, n) => ({ id, say, n: n || {} });

const plural = (k, one, many) => (k === 1 ? one : many);

/* ---------- TODAY ------------------------------------------------ */

/**
 * What this session says, from the keys that describe it.
 *
 * ORDERED BY WHAT A READER OPENS THE PAGE TO ASK: which way it
 * leans, how wide the read was, what is loudest on each side, where
 * the money went by sector, and what arrived since the morning run.
 */
export function briefToday(store) {
  const s = store || {};
  const facts = [];
  const silences = [];

  const lng = answered(s.long), sht = answered(s.short);
  for (const [p, what] of [[s.long, "bullish board"], [s.short, "bearish board"]]) {
    const q = silenceOf(p, what);
    if (q) silences.push(q);
  }

  const lr = rows(s.long), sr = rows(s.short);
  const meta = lng || sht || null;
  const session = meta && meta.sessionDate ? String(meta.sessionDate) : null;

  /* THE POPULATION, NOT THE PAGE. `cleared` is the side's whole pool
     and `rows.length` is what fitted; a briefing that counted the
     page would understate the session the same way the rail badge
     did before it was fixed. */
  const bull = lng ? num(lng.cleared) ?? (lr ? lr.length : null) : null;
  const bear = sht ? num(sht.cleared) ?? (sr ? sr.length : null) : null;
  const scored = meta ? num(meta.scored) : null;
  const neutral = meta ? num(meta.neutral) : null;

  if (bull !== null || bear !== null) {
    facts.push(fact("tilt",
      (bull === null ? "—" : bull) + " " + plural(bull, "name leans", "names lean") + " bullish and " +
      (bear === null ? "—" : bear) + " lean bearish" +
      (scored === null ? "" : " out of " + scored + " scored") +
      (neutral === null ? "" : ", with " + neutral + " inside the dead band") + ".",
      { bullish: bull, bearish: bear, scored, neutral, session }));
  }

  /* THE LOUDEST NAME EACH SIDE, with the score that made it loudest.
     Rank 1 is the payload's own — re-deriving it here would be a
     second opinion about a ranking already published, and on the
     bear side the obvious re-derivation is wrong. */
  for (const [rs, side] of [[lr, "bullish"], [sr, "bearish"]]) {
    if (!rs || !rs.length) continue;
    const top = rs.find((r) => num(r && r.r) === 1) || rs[0];
    if (!top || !top.t) continue;
    const sc = num(top.s), cnv = num(top.cnv);
    facts.push(fact("top:" + side,
      "The " + side + " side is led by " + top.t +
      (sc === null ? "" : " at " + (sc > 0 ? "+" : "") + sc) +
      (cnv === null ? "" : ", conviction " + cnv) + ".",
      { ticker: String(top.t), score: sc, conviction: cnv, side }));
  }

  /* WHERE THE PREMIUM LEANT BY SECTOR. This is the options reading,
     not the price-momentum one: sector:premium and sector:trix are
     different quantities and a briefing that blurred them would be
     the drift both keys exist to keep apart. */
  const sec = answered(s.sectorPremium);
  const secRows = rows(s.sectorPremium);
  if (sec && secRows && secRows.length) {
    const scored2 = secRows
      .map((r) => ({ t: r && r.t, lean: num(r && r.lean) }))
      .filter((r) => r.t && r.lean !== null)
      .sort((a, b) => b.lean - a.lean);
    if (scored2.length) {
      const hi = scored2[0], lo = scored2[scored2.length - 1];
      facts.push(fact("sectors",
        "Sector premium leans most bullish in " + hi.t + " and most bearish in " + lo.t +
        " across " + scored2.length + " " + plural(scored2.length, "sector", "sectors") + " measured.",
        { mostBullish: hi.t, mostBullishLean: hi.lean,
          mostBearish: lo.t, mostBearishLean: lo.lean, measured: scored2.length }));
    }
  } else {
    const q = silenceOf(s.sectorPremium, "sector premium lean");
    if (q) silences.push(q);
  }

  /* WHAT ARRIVED SINCE THE MORNING RUN. The alerts key refreshes
     intraday and carries its own read stamp, so this is the one
     line in the section that can be newer than the board — and it
     says its own age rather than borrowing the session's. */
  const al = answered(s.alerts);
  const ar = rows(s.alerts);
  if (al && ar && ar.length) {
    facts.push(fact("alerts",
      ar.length + " flagged " + plural(ar.length, "window", "windows") + " on the tape" +
      (al.readAt ? ", read " + al.readAt : "") + ".",
      { flagged: ar.length, readAt: al.readAt || null }));
  }

  return { session, facts, silences };
}

/* ---------- YESTERDAY -------------------------------------------- */

/**
 * What changed since the previous scored session.
 *
 * MOSTLY A READ, NOT A COMPUTATION. Every board row already carries
 * its own memory — `nw` (new to this side), `hy` (here on
 * incumbency), `r0` (the rank it held) and `dr` (how far it moved) —
 * stamped by the pipeline against the previous board. This section
 * reports those rather than diffing two payloads, because a second
 * derivation of "what moved" is how two surfaces end up disagreeing
 * about the same session.
 */
export function briefYesterday(store) {
  const s = store || {};
  const facts = [];
  const silences = [];

  const lr = rows(s.long), sr = rows(s.short);
  const meta = answered(s.long) || answered(s.short) || null;

  /* THE COMPARAND IS NAMED. Every count below is measured against a
     specific prior board, and a briefing that said "since
     yesterday" without naming the date would be wrong on a Monday
     and on the session after a holiday. */
  const memory = meta && meta.memory && typeof meta.memory === "object" ? meta.memory : null;
  const prior = memory && memory.sessionDate ? String(memory.sessionDate) : null;

  if (!lr && !sr) {
    silences.push({ kind: "unreadable", what: "both boards",
      say: "Neither board could be read, so nothing is stated about what changed." });
    return { prior, facts, silences };
  }

  if (prior === null) {
    silences.push({ kind: "pending", what: "board memory",
      say: "No previous board was available to compare against, so no name is called new " +
           "or returning. That is the ordinary state on a first run and after a gap." });
    return { prior, facts, silences };
  }

  const all = [].concat(lr || [], sr || []);
  const fresh = all.filter((r) => r && r.nw === true);
  const held = all.filter((r) => r && r.hy === true);

  facts.push(fact("entered",
    fresh.length + " " + plural(fresh.length, "name is", "names are") +
    " new to a side since the " + prior + " board.",
    { entered: fresh.length, prior }));

  if (held.length) {
    facts.push(fact("incumbents",
      held.length + " " + plural(held.length, "name is", "names are") +
      " on the board by incumbency rather than by clearing the entry rank.",
      { incumbents: held.length, prior }));
  }

  /* THE BIGGEST MOVES, BOTH ENDS. A briefing that reported only
     climbs would describe half a session. `dr` is the published
     move; `r0` and `r` are its endpoints, and both are withheld
     together or not at all — "from rank null" is worse than no
     clause. */
  const moved = all
    .map((r) => ({ t: r && r.t, dr: num(r && r.dr), r0: num(r && r.r0), r: num(r && r.r) }))
    .filter((r) => r.t && r.dr !== null && r.dr !== 0);
  if (moved.length) {
    /* THE SHAPE OF THE MOVE BEFORE ITS EXTREMES. On the run this was
       first tested against, 29 names fell and NONE climbed — an
       entirely one-sided session, which is the most interesting thing
       about it and which naming only the biggest fall would have
       thrown away. The counts go first; the extremes qualify them.

       BOTH COUNTS ARE PRINTED EVEN WHEN ONE IS ZERO, because "none
       climbed" is a measurement here: `dr` was published for these
       names and it was never positive. That is different from a
       session where nothing could be compared, which is the branch
       above that returns on a missing comparand. */
    const climbs = moved.filter((m) => m.dr > 0).length;
    const falls = moved.filter((m) => m.dr < 0).length;
    facts.push(fact("moves",
      climbs + " " + plural(climbs, "name", "names") + " climbed and " +
      falls + " fell against the " + prior + " board, of " + moved.length +
      " with a rank on both.",
      { climbed: climbs, fell: falls, comparable: moved.length, prior }));

    const up = moved.slice().sort((a, b) => b.dr - a.dr)[0];
    const down = moved.slice().sort((a, b) => a.dr - b.dr)[0];
    const ends = (m) => (m.r0 === null || m.r === null ? "" : ", from rank " + m.r0 + " to " + m.r);
    if (up && up.dr > 0) {
      facts.push(fact("climbed",
        up.t + " climbed " + up.dr + " " + plural(up.dr, "place", "places") + ends(up) + ".",
        { ticker: up.t, places: up.dr, from: up.r0, to: up.r }));
    }
    if (down && down.dr < 0) {
      const n = Math.abs(down.dr);
      facts.push(fact("fell",
        down.t + " fell " + n + " " + plural(n, "place", "places") + ends(down) + ".",
        { ticker: down.t, places: n, from: down.r0, to: down.r }));
    }
  }

  return { prior, facts, silences };
}

/* ---------- NEXT SESSION ----------------------------------------- */

/**
 * What is already scheduled to change, and who sits on a threshold.
 *
 * READ THE MODULE HEADER BEFORE EDITING THIS FUNCTION. It may state
 * calendar facts and measured distances. It may not state what will
 * happen. If a future change here starts producing a sentence with
 * a verb in the future tense about a PRICE or a SCORE, that change
 * is wrong.
 */
export function briefNext(store, options) {
  const s = store || {};
  const o = options || {};
  const facts = [];
  const silences = [];

  /* THE ORIGIN IS STATED BECAUSE EVERY DAY COUNT BELOW IS MEASURED
     FROM IT. A briefing read on a Saturday about "the next session"
     means Monday, and "reports in 1 day" without an origin is how a
     page ends up drawing its window off the wrong clock. */
  const meta = answered(s.long) || answered(s.short) || answered(s.events) || null;
  const origin = meta && meta.gateOrigin ? String(meta.gateOrigin) : null;
  const gateDays = meta ? num(meta.gateDays) : null;

  const lr = rows(s.long), sr = rows(s.short);
  const board = [].concat(lr || [], sr || []);

  /* SCHEDULED: who reports, and therefore who the gate removes.
     `edte` is days to the report measured from the origin above. A
     NEGATIVE count is a vendor date that has gone stale, not a
     report due today, so it is withheld rather than read as
     imminent — the same rule the board's own earnings mark uses. */
  const soon = board
    .map((r) => ({ t: r && r.t, edte: num(r && r.edte), ed: r && r.ed }))
    .filter((r) => r.t && r.edte !== null && r.edte >= 0)
    .sort((a, b) => a.edte - b.edte);

  const beforeNext = soon.filter((r) => r.edte <= 1);
  if (beforeNext.length) {
    facts.push(fact("reporting",
      beforeNext.length + " ranked " + plural(beforeNext.length, "name reports", "names report") +
      " before the next session: " + beforeNext.map((r) => r.t).join(", ") + ".",
      { count: beforeNext.length, tickers: beforeNext.map((r) => r.t), origin }));
  }

  if (gateDays !== null) {
    const gated = soon.filter((r) => r.edte <= gateDays);
    if (gated.length) {
      facts.push(fact("gate",
        gated.length + " ranked " + plural(gated.length, "name sits", "names sit") +
        " inside the " + gateDays + "-day earnings gate and leaves the board on the calendar " +
        "rather than on its signal.",
        { count: gated.length, gateDays, tickers: gated.map((r) => r.t), origin }));
    }
  }

  /* THRESHOLD: who sits nearest the edge of the dead band. The watch
     board is exactly the names that were scored and did not clear.

     TWO TRAPS HERE, AND THE FIRST DRAFT OF THIS BLOCK FELL INTO BOTH.

     THE SCORE HAS NO RESOLUTION INSIDE THE BAND. `s` is an integer
     and the band is ±1, so every watch row carries s: 0 — sorting on
     it ranked three names that all read "0" and then printed that 0
     as though it were the measurement. Worse, 0 is the CENTRE of the
     band: the name it named as closest to leaving was the furthest
     from it. `resid` is the quantity the rows are actually ordered
     by, which assets/js/flows-watch.js states in as many words.

     AND THE RANKING IS THE PAYLOAD'S. `r` is published, computed
     against the same residual, so re-deriving an order here would be
     a second opinion about a ranking that already exists — the exact
     mistake the board's own comment warns about. Rank 1 is the name
     nearest the edge; this reads it rather than re-sorting.

     The residual is quoted in its own units and never converted:
     turning it into score units needs SCORE_SCALE, which lives in the
     renderer, and a briefing that borrowed it would be the second
     copy of a constant this codebase keeps consolidating. */
  const wr = rows(s.watch);
  if (wr && wr.length) {
    const first = wr.find((r) => num(r && r.r) === 1) || wr[0];
    const resid = first ? num(first.resid) : null;
    facts.push(fact("nearly-in",
      wr.length + " " + plural(wr.length, "name sits", "names sit") + " inside the dead band" +
      (first && first.t
        ? ", " + first.t + " ranked nearest its edge" +
          (resid === null ? "" : " at a residual of " + resid)
        : "") + ".",
      { inBand: wr.length,
        nearest: first && first.t ? String(first.t) : null,
        nearestResidual: resid }));
  } else {
    const q = silenceOf(s.watch, "watch board");
    if (q) silences.push(q);
  }

  /* THRESHOLD: who is sitting on their gamma flip. `gFlipDist` is a
     published distance in the payload's own units; this reports the
     smallest absolute one and never converts it. */
  const flips = board
    .map((r) => ({ t: r && r.t, d: num(r && r.gFlipDist) }))
    .filter((r) => r.t && r.d !== null)
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  if (flips.length) {
    const f = flips[0];
    facts.push(fact("flip",
      f.t + " sits closest to its gamma flip, " + (f.d > 0 ? "+" : "") + f.d + " away.",
      { ticker: f.t, distance: f.d }));
  }

  if (!facts.length) {
    silences.push({ kind: "quiet", what: "the next session",
      say: "Nothing is scheduled and no name sits on a threshold this session, so there is " +
           "nothing to say about the next one. That is a measured emptiness." });
  }

  return { origin, gateDays, facts, silences, isForecast: false };
}

/**
 * The whole briefing, in the order a reader wants it: what the
 * session says, what moved to get here, what is already scheduled.
 */
export function buildBrief(store) {
  return {
    today: briefToday(store),
    yesterday: briefYesterday(store),
    next: briefNext(store),
  };
}
