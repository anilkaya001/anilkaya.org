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
 *
 * `list` NAMES THE ARRAY THE CALLER ACTUALLY LOOKED IN, and it exists
 * because assuming `rows` cost this module a whole section in silence.
 * sector:premium carries its eleven baskets under `sectors`, not
 * `rows` — so the fact block found nothing, fell to the else, and
 * silenceOf looked for `rows` too, found no array at all, and
 * returned null. Not a fact and not a silence: the sector lean simply
 * left the briefing, which is the one outcome every rule in this file
 * exists to make impossible. A caller reading a differently-named
 * array passes it, and the quiet branch judges the array that was
 * really read. Omitted, the behaviour is what it always was.
 */
export function silenceOf(payload, what, list) {
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
  const r = list === undefined ? rows(payload) : (Array.isArray(list) ? list : null);
  if (r !== null && r.length === 0) {
    return { kind: "quiet", what,
      say: "The " + what + " was measured and holds nothing. That is a reading, not a gap." };
  }
  /* THE PAYLOAD ANSWERED AND THIS BRIEFING STILL FOUND NOTHING USABLE.
     That is not one of the three silences — it is a fourth thing, and
     it is always a fault here rather than a fact about the session:
     the key was published, it parsed, and the shape this module
     expected was not the shape it got. Saying so is what turns the
     next field rename into a visible sentence instead of a section
     that quietly stops appearing. */
  if (r === null) {
    return { kind: "unreadable", what,
      say: "The " + what + " was published but this briefing could not find the " +
           "readings inside it, so nothing about it is stated here. That is a fault " +
           "on this page rather than a fact about the session." };
  }
  return null;
}

/**
 * A fact, its numbers kept apart from its sentence, and optionally which
 * of those numbers is the headline. `say` is what a page prints; `n` is
 * what may not be changed.
 *
 * `lead` NAMES KEYS IN `n`; IT NEVER CARRIES A VALUE OF ITS OWN. A
 * renderer that wants to set a figure large — a terminal-style label over
 * a number over its sentence — needs to know WHICH number leads, and the
 * only module that knows is this one, which built the sentence. The
 * alternative a mockup reached for was parsing the figure back out of
 * `say` with a regex, and that is the whole defect in miniature: it would
 * lift "53" out of "SYN053 fell 15 places" as readily as out of "53 lean
 * bearish", and a headline figure taken from a ticker is a confident
 * wrong number set in the largest type on the page.
 *
 * So `lead` is { label, keys, unit } where `keys` index `n`. The renderer
 * reads n[key] and draws em dashes for any that are absent — the same
 * absence rule as everywhere else, because a headline is exactly where a
 * missing reading must not become a zero. The SENTENCE IS ALWAYS DRAWN
 * BENEATH IT: the figure is a way in, never a replacement, and a number
 * without its sentence has lost its units and its qualification.
 */
const fact = (id, say, n, lead) => {
  const f = { id, say, n: n || {} };
  if (lead && typeof lead === "object" && Array.isArray(lead.keys) && lead.keys.length) {
    f.lead = { label: String(lead.label || ""), keys: lead.keys.slice(),
      unit: lead.unit === undefined ? null : String(lead.unit) };
  }
  return f;
};

const plural = (k, one, many) => (k === 1 ? one : many);

/* ---------- the store this module reads -------------------------- */

/**
 * WHICH PUBLISHED KEYS BECOME WHICH SLOTS, in one place.
 *
 * The functions below read `store.long`, `store.sectorPremium` and four
 * more; the pipeline publishes `board:long` and `sector:premium`. A colon
 * is not an identifier, so the rename is real work and every caller was
 * doing it by hand — the pipeline in one spelling, shared/flows-ask.js in
 * another. Two copies of a six-key rename is the drift this codebase keeps
 * consolidating, and it is worse here than usual: a mistyped slot does not
 * throw, it produces a SILENCE, and a briefing full of silences is
 * indistinguishable from a quiet market. It would have read as the product
 * working.
 */
export const BRIEF_SLOTS = Object.freeze({
  long: "board:long",
  short: "board:short",
  watch: "board:watch",
  events: "events",
  alerts: "flowalerts",
  sectorPremium: "sector:premium",
});

/**
 * Turn a store keyed by published key into the slots above.
 *
 * A KEY THE CALLER DOES NOT HOLD IS `pending`, NOT MISSING. silenceOf()
 * calls an absent object "unreadable", whose sentence says the fault is on
 * this page — a lie about a key that was simply never written. The Worker
 * already answers an unwritten key with {status:"pending"}, so handing the
 * same shape here keeps the briefing's account of a surface identical to
 * the account that surface's own page gives. Two pages disagreeing about
 * which kind of nothing happened is how a reader learns to trust neither.
 */
export function briefStoreFrom(published) {
  const p = published && typeof published === "object" ? published : {};
  const out = {};
  for (const [slot, key] of Object.entries(BRIEF_SLOTS)) {
    out[slot] = Object.hasOwn(p, key) ? p[key] : { status: "pending" };
  }
  return out;
}

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
      { bullish: bull, bearish: bear, scored, neutral, session },
      { label: "lean bull / bear", keys: ["bullish", "bearish"], unit: "names" }));
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
  /* THE BASKETS ARE UNDER `sectors`, AND THE LEAN IS `leanRatio`. Both
     names were guessed wrong when this was written and both guesses
     failed silently, because a missing field reads as an absent
     reading rather than as an error. They are asserted now against the
     published payload's own vocabulary.

     RANKED ON leanRatio, NEVER ON DOLLARS, and sector:premium's own
     `lean.rejected` note says why: ranking the eleven on net premium
     ranks them by sector size, and XLK clears roughly four orders of
     magnitude more than XLB on a quiet day. The ratio is each basket
     measured against its own gross, which is the only way "most
     bullish" means what a reader thinks it means. */
  const sec = answered(s.sectorPremium);
  const secRows = sec && Array.isArray(sec.sectors) ? sec.sectors : null;
  if (sec && secRows && secRows.length) {
    const scored2 = secRows
      .map((r) => ({ t: (r && r.etf) || (r && r.sector), lean: num(r && r.leanRatio) }))
      .filter((r) => r.t && r.lean !== null)
      .sort((a, b) => b.lean - a.lean);
    if (scored2.length) {
      const hi = scored2[0], lo = scored2[scored2.length - 1];
      /* THE DENOMINATOR IS THE BASKETS RETURNED, NOT THE ONES THAT READ.
         Saying "across 8 sectors measured" while eleven were asked for
         invites the reader to think eight is the universe. The payload
         counts both, so the sentence carries both and the gap is the
         reader's to interpret. */
      const returned = num(sec.returned);
      facts.push(fact("sectors",
        "Sector premium leans most bullish in " + hi.t + " and most bearish in " + lo.t +
        ", across " + scored2.length + " " + plural(scored2.length, "basket", "baskets") +
        " with a readable lean" +
        (returned !== null && returned !== scored2.length ? " of " + returned + " returned" : "") +
        ".",
        { mostBullish: hi.t, mostBullishLean: hi.lean,
          mostBearish: lo.t, mostBearishLean: lo.lean,
          readable: scored2.length, returned }));
    } else {
      /* PUBLISHED, POPULATED, AND NOT ONE BASKET CARRIED BOTH SIDES OF
         its premium — which is what leanRatio needs. That is a reading
         about the tape, not a fault, so it is said rather than dropped. */
      facts.push(fact("sectors",
        "No sector basket returned both sides of its premium this session, so no lean " +
        "is stated for any of the " + secRows.length + " returned.",
        { returned: secRows.length, readable: 0 }));
    }
  } else {
    const q = silenceOf(s.sectorPremium, "sector premium lean", secRows);
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
    { entered: fresh.length, prior },
    { label: "new to a side", keys: ["entered"], unit: "names" }));

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

  /* SCHEDULED: WHO REPORTS — READ OFF THE CALENDAR, BECAUSE THE BOARD
     STRUCTURALLY CANNOT ANSWER IT.

     This block used to filter the board's own `edte`, and both facts
     it built were unreachable on every session this product has run.
     The earnings gate removes a name from scoring PRECISELY WHEN it
     has a report inside the window, so a surviving board row's report
     is always on the far side of the gate — the way a survivor of any
     filter is. Measured on the emitted corpus: the smallest `edte`
     across both sides is 13 against a 12-day gate, and there is no
     session on which it could be otherwise. Asking the board who
     reports before the next session asks the one population
     guaranteed not to, and the answer — nothing — was then not even
     printed, so the section's whole SCHEDULED half was silent by
     construction while reading as a quiet calendar.

     `events` is the key that holds them. It carries the gated names
     by name, `dte` measured from the same origin, and `byStage`
     counting how many the gate took. A NEGATIVE count is a vendor
     date that has gone stale rather than a report due today, so it is
     withheld rather than read as imminent — the same rule the board's
     own earnings mark uses. */
  const ev = answered(s.events);
  const evRows = rows(s.events);
  const due = (evRows || [])
    .map((r) => ({ t: r && r.t, dte: num(r && r.dte) }))
    .filter((r) => r.t && r.dte !== null && r.dte >= 0)
    .sort((a, b) => a.dte - b.dte);

  if (due.length) {
    const beforeNext = due.filter((r) => r.dte <= 1);
    if (beforeNext.length) {
      facts.push(fact("reporting",
        beforeNext.length + " " + plural(beforeNext.length, "name reports", "names report") +
        " before the next session: " + beforeNext.map((r) => r.t).join(", ") + ".",
        { count: beforeNext.length, tickers: beforeNext.map((r) => r.t), origin },
        { label: "report before next session", keys: ["count"], unit: "names" }));
    } else {
      /* THE ANSWER IS "NONE", AND IT IS PRINTED. Withholding it leaves
         a reader unable to tell a clear calendar from a section that
         did not look, which is the whole distinction this file keeps. */
      const near = due[0];
      facts.push(fact("reporting",
        "No name on the calendar reports before the next session; the nearest of " +
        due.length + " dated is " + near.t + " in " + near.dte + " " +
        plural(near.dte, "session", "sessions") + ".",
        { count: 0, dated: due.length, nearest: near.t, nearestDte: near.dte, origin }));
    }
  } else if (ev) {
    silences.push({ kind: "quiet", what: "the earnings calendar",
      say: "The earnings calendar was read and carries no dated report from this session " +
           "onward, so nothing is scheduled. That is a reading, not a gap." });
  } else {
    const q = silenceOf(s.events, "earnings calendar", evRows);
    if (q) silences.push(q);
  }

  /* WHO THE GATE TOOK, which is a fact about the BOARD a reader
     cannot get from the board: those names are absent from it. The
     count is the calendar's own, published under `byStage`, so this
     reports it rather than re-deriving a number that already exists. */
  const gatedCount = ev && ev.byStage ? num(ev.byStage.gated) : null;
  if (gatedCount !== null && gateDays !== null) {
    facts.push(fact("gate",
      gatedCount + " " + plural(gatedCount, "name was", "names were") + " held out of scoring " +
      "by the " + gateDays + "-day earnings gate, so " + plural(gatedCount, "it is", "they are") +
      " absent from both boards on the calendar rather than on a signal.",
      { count: gatedCount, gateDays, origin }));
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
