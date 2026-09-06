/* =============================================================
   flows-panels.js — the ticker page's panel registry.

   PURE DATA. No DOM, no network, no imports. Read by
   shared/flows-pages.js on the Worker side to EMIT the markup, and
   by tests to assert that the emitted markup, the browser's drawer
   table and the pipeline's shed order all name the same panels.

   WHY A REGISTRY AND NOT THREE HAND-WRITTEN LISTS. The retired card
   dialog's markup WAS ten hand-written <section class="fc-panel">
   blocks in flows-pages.js, its drawer table a second list in the
   browser, and the pipeline's shed ladder a third in
   flows-pipeline.mjs. Three hand-maintained lists of the same panels
   is three chances for one to exist in two of them and be silently
   invisible — which this repo has shipped: the four chain panels
   below were published in every card since the chain leg landed and
   NOTHING EVER DREW THEM. Two of those three went with the dialog —
   its markup blocks and its drawer table, both deleted with it. The
   third, the pipeline's shed ladder, is still live, and so is a
   fourth this count used to leave out: assets/js/flows-ticker.js's
   DRAW table, which exists only because `shared/` is never served
   and a browser module cannot import this file. So TWO hand-written
   lists remain, and tests/flows-ticker-contract.mjs pins both
   against this one: a key with no drawer renders a visible "no
   renderer is registered" panel, and a drawer with no key fails a
   test.

   `question` REACHES THE BROWSER AS MARKUP, NOT AS AN IMPORT.
   `shared/` is listed in .assetsignore and is never served, so a
   browser module cannot import this file. flows-pages.js emits each
   question into a data-question attribute and the drawer reads it
   from the DOM. A renderer that tried to read `entry.question` at
   runtime would get `undefined` and print an empty question with
   nothing failing.

   AND THAT IS WHY `group` AND `tier` HAVE A SECOND HOME. The markup
   emitter reads them from here; the browser cannot, so
   assets/js/flows-ticker.js carries a PANEL_CHROME table keyed by
   the same panel keys — the identical arrangement the DRAW table
   already has, and pinned the identical way: tests/flows-ticker-
   contract.mjs asserts the two agree key for key AND value for
   value, in both directions. A duplicate a test cannot see is a
   drift; a duplicate a test compares is a projection.
   ============================================================= */

/**
 * The panels of /flows/ticker/, in reading order.
 *
 * `span: 2` means the panel occupies both grid columns above the 76rem
 * breakpoint. It is a LAYOUT fact with a DATA consequence in exactly one
 * place: `ivSurface` and `skewTerm` are both `span: 2` and adjacent, which
 * is what lets the term line's j-th bar centre coincide with the surface's
 * j-th column centre. At span 1 and span 2 the two hosts measure 424px and
 * 896px at a 1216px viewport and could never share a column geometry at any
 * width — the alignment requirement and the layout would make each other
 * impossible, and the assertion that checks it would be unsatisfiable rather
 * than merely failing.
 *
 * `group` IS THE PAGE'S TABLE OF CONTENTS, and it is a field rather than a
 * heading because the heading has to be emitted in two places — once into
 * the served markup and once into the jump strip the controller builds — and
 * two hand-written lists of five headings is the same defect this file was
 * created to close, one level up.
 *
 * ORDER IS THE ARGUMENT THE PAGE MAKES, and the argument has changed twice.
 *
 * It used to be "the four chain panels come first because they are the half
 * of the card payload that has never been drawn" — correct while that was
 * true, and stale once they were drawn. It then became "the score derivation
 * leads, because a reader arrives from a board row carrying a score". That is
 * still the first entry, and it was still not enough: the remaining twenty
 * panels sat in the order they had been ADDED in, so `levels` was seven
 * panels away from `surface`, the three second-order Greeks sat below the
 * off-exchange tape, and a reader hunting the gamma roll-off scanned five to
 * seven screens of near-identical headings with no index to jump from.
 *
 * So the order is now GROUPED, and the groups are contiguous by contract:
 *
 *   signal      what the number is and what it just did
 *   convexity   the dealer book that produced it
 *   volatility  what the chain is charging for the move
 *   tape        what actually traded
 *   context     the name's own year, and who else is in it
 *
 * WITHIN A GROUP THE FIRST ENTRY IS ITS LEAD, and carries `tier: "lead"`.
 * That is not decoration: with 21 boxes of identical chrome the eye has no
 * way to find the primary reading of a section, so the lead wears heavier
 * chrome and everything under it is evidence for it. Exactly one lead per
 * group, always first — asserted, because "roughly one" is not a rule.
 *
 * `tier` IS THE PANEL'S SHAPE, NOT ITS IMPORTANCE (beyond the lead):
 *
 *   lead     the group's primary reading
 *   chart    a drawing, sized from its host
 *   table    rows the reader scans and scrolls
 *   reading  two or three numbers and a sentence
 *
 * A two-number panel and a fifty-row table wearing the same box is what made
 * the flat scroll unreadable; the tier is what lets the stylesheet tell them
 * apart without a per-panel rule.
 */
export const TICKER_PANELS = Object.freeze([
  /* ---------- SIGNAL: the number, and what it just did -------------

     THE SCORE'S OWN DERIVATION, FIRST, and the ordering argument above has
     been rewritten because it expired.

     It used to sit LAST. That was defensible when it was written: the four
     chain panels were the half of the payload nothing drew, and putting them
     first was the argument the page made. They have been drawn for a while
     now, and four more panels have since been added above this one — so the
     explanation of the single number this page is about had drifted to entry
     21 of 21, below a twenty-panel scroll.

     A reader arrives here from a board row carrying a score. The first thing
     the page owes them is what that score is made of. Everything below is
     evidence for it. */
  { key: "__score", id: "ftWhy", span: 2, group: "signal", tier: "lead",
    title: "Score derivation",
    question: "Which components produced this score, and how heavily?" },
  /* THE ONE PANEL BUILT FROM TWO PAYLOADS, and the reason the join happens in
     the pipeline rather than the browser. The card carries a dated price
     window; `scoretrack` carries the dated score history for every name on
     the board. The pipeline holds both when it builds a card — the track is
     assembled before the card loop — so the join is done once, at build time,
     by a shaper that a contract test can run without a browser. Fetching the
     track in the page instead would put an untested date join inside a
     drawing function, which is exactly what shared/flows-overlay.js exists to
     prevent.

     IT MOVED FROM LAST TO SECOND. It was the final entry of 21, which put the
     only history on the page — the only thing that can say a reading is NEW —
     below every static snapshot of one session. This page is read as an early
     warning; the series that shows the warning belongs beside the number it
     is a series of. The header strip's overnight move is derived from these
     same rows, so the panel is also the working the strip is a summary of. */
  { key: "scoreOverlay", id: "ftOverlay", span: 2, group: "signal", tier: "chart",
    title: "Score over price",
    /* THE TYPOGRAPHIC APOSTROPHE, as every other question on this page uses.
       escapeHTML turns an ASCII ' into &#39;, and the worker suite compares
       the registry's string against the served markup — so a straight quote
       here fails a test whose message is about the question "reaching the
       markup", which is not what went wrong. U+2019 passes through untouched
       and is what this site sets prose in anyway. */
    question: "How has this name’s daily score moved against its own price?" },

  /* ---------- CONVEXITY: the dealer book ---------------------------
     Gamma leads: it is the one panel a reader opens on a name they already
     know. `levels` and `surface` sit under it now rather than seven entries
     away — the ladder, the rail measured against it, and the joint the two
     are marginals of belong in one eyeful. */
  { key: "gamma", id: "ftGamma", span: 1, group: "convexity", tier: "lead",
    title: "Gamma convexity",
    question: "Where is the dealer book long and short gamma?" },
  { key: "levels", id: "ftLevels", span: 1, group: "convexity", tier: "reading",
    title: "Key levels & distance to spot",
    question: "Where are the walls, and how far is spot from each in ATR?" },
  { key: "surface", id: "ftSurface", span: 2, group: "convexity", tier: "chart",
    title: "Gamma surface — strike × expiry",
    question: "Which expiries carry the standing gamma, and at which strikes?" },
  { key: "displacement", id: "ftDisp", span: 1, group: "convexity", tier: "reading",
    title: "Where the book is moving",
    question: "Is new gamma building above or below the standing book?" },
  { key: "calendar", id: "ftCal", span: 1, group: "convexity", tier: "chart",
    title: "Gamma roll-off",
    question: "How much of the book expires, and when?" },
  /* THE SECOND-ORDER GREEKS, PAID FOR AND THEN INVISIBLE.

     These three came off a vendor call the pipeline was already making for
     the gamma profile — no extra spend — and were published on every card
     while no renderer touched them. That is the same defect the four chain
     panels had, and the reason the registry test now asserts BOTH directions:
     every registry key names a published panel AND every published panel is
     either drawn or named in an explicit exemption. One direction only is how
     a payload comes to carry a field nobody has looked at in weeks.

     Three entries and one drawer: they differ in what the number means, and
     the payload carries that as `unit`. They sit here, under the gamma book
     they are derivatives of, rather than below the off-exchange tape where
     the order in which they were ADDED had left them. */
  { key: "deltaExposure", id: "ftDelta", span: 1, group: "convexity", tier: "chart",
    title: "Dealer delta by expiry",
    question: "How much directional exposure are dealers carrying, and where along the term?" },
  { key: "charm", id: "ftCharm", span: 1, group: "convexity", tier: "chart",
    title: "Charm by expiry",
    question: "How fast is that exposure decaying with time alone, spot unchanged?" },
  { key: "vanna", id: "ftVanna", span: 1, group: "convexity", tier: "chart",
    title: "Vanna by expiry",
    question: "How much would that exposure move on a one-point change in implied volatility?" },

  /* ---------- VOLATILITY: what the chain charges -------------------
     THE PAIR STAYS ADJACENT AND STAYS span 2. The term line's j-th bar centre
     has to coincide with the surface's j-th column centre, which can only
     hold if the two mount at the same host width. Moving either out of the
     other's shadow, or dropping one to span 1, does not merely misalign the
     chart — it makes the alignment assertion unsatisfiable. */
  { key: "ivSurface", id: "ftIvs", span: 2, group: "volatility", tier: "lead",
    title: "Implied volatility — moneyness × expiry",
    question: "What shape is the smile, and how does it change with tenor?" },
  { key: "skewTerm", id: "ftTerm", span: 2, group: "volatility", tier: "chart",
    title: "Term structure and skew",
    question: "Is the front bid over the back, and which wing is bid?" },
  { key: "pricedMove", id: "ftMove", span: 1, group: "volatility", tier: "reading",
    title: "The priced move",
    question: "What move is the option market pricing over the stated horizon?" },
  { key: "volContext", id: "ftVol", span: 1, group: "volatility", tier: "chart",
    title: "Volatility context",
    question: "What does the chain charge across tenors, and where does implied volatility sit in its own year?" },

  /* ---------- TAPE: what actually traded --------------------------- */
  { key: "aggressor", id: "ftAggr", span: 1, group: "tape", tier: "lead",
    title: "Who is lifting, by strike",
    question: "At which strikes were contracts taken at the offer?" },
  /* SPAN 2 BECAUSE THE COLUMN THAT PAYS IS THE LAST ONE. Nine columns in a
     span-1 host (456px at a 1216px viewport) push `Net aggr` outside the
     scroll wrapper's visible width, so the panel's whole answer — which lines
     were LIFTED — is off-screen until a reader thinks to scroll a table they
     have no reason to think scrolls. The wrapper still scrolls at phone
     widths, where nothing can fit nine columns. */
  { key: "topContracts", id: "ftTop", span: 2, group: "tape", tier: "table",
    title: "The day’s most-traded contracts",
    question: "Which single lines carried the volume?" },
  { key: "path", id: "ftPath", span: 1, group: "tape", tier: "chart",
    title: "Session path",
    question: "How did the flow accumulate through the session?" },
  /* TWO OF THE THREE WAVE-2 STOCK PANELS, published by shared/flows-stock.js
     since the per-name deep feeds shipped. Both are tape — reported equity
     executions and the clearing snapshots that follow them — so they sit with
     the tape rather than in an "added later" block of their own. The third,
     volContext, is a volatility reading and sits with volatility.
     All are span 1: none carries a table or a grid wide enough to earn both
     columns, and the landscape pass slots them as single cells. */
  { key: "darkpool", id: "ftDark", span: 1, group: "tape", tier: "table",
    title: "Off-exchange prints",
    question: "Which off-exchange prints carried the size in this name?" },
  { key: "oiDeltas", id: "ftOi", span: 1, group: "tape", tier: "table",
    title: "Open-interest changes",
    question: "Where did open interest move between clearing snapshots?" },

  /* ---------- CONTEXT: the name's own year, and who is in it ------- */
  { key: "context", id: "ftCtx", span: 1, group: "context", tier: "lead",
    title: "Price context",
    question: "Where does today sit in the name’s own year?" },
  { key: "congress", id: "ftCongress", span: 1, group: "context", tier: "table",
    title: "Disclosed congressional transactions",
    question: "Has anyone in Congress disclosed a trade in this name?" },
  /* THE CROSS-SECTION THE PER-NAME FEEDS CANNOT CARRY, off two market-wide
     reads this run already makes once for the market pulse.

     It sits in CONTEXT rather than in TAPE, and the two feeds it joins are
     tape feeds, so the placement is an argument. What this panel reports is
     not what traded — the darkpool and oiDeltas panels above already report
     that for this name, from per-name requests — it is whether the name
     PLACED against every other name, which is the same kind of question as
     "where does today sit in this name's own year". A rank has no meaning
     without the population beside it, and the population here is the market.

     span 1 AND tier "reading": it is two short readings and their prose, not
     a table and not a drawing, and at 320px it must not carry a row of
     columns that can only be reached by scrolling sideways. */
  { key: "marketRank", id: "ftCross", span: 1, group: "context", tier: "reading",
    title: "Market-wide standing",
    question: "Does this name place in the market’s own two lists, and from which session?" },
  /* NOT A PANEL KEY. The score derivation is drawn from the card's TOP-LEVEL
     fields (score, fam, weights, conv, quality), not from card.panels — so it
     is deliberately spelled with a sentinel that can never collide with a
     payload key, and the test that asserts "every registry key is a key of
     buildCard().panels" excludes exactly this one. */
]);

/** The sentinel key that is drawn from the card's top level, not its panels. */
export const SCORE_KEY = "__score";

/**
 * The five groups, in the order the page reads them.
 *
 * `blurb` IS THE GROUP'S OWN SENTENCE and it is here rather than in the
 * controller for the same reason every `question` is: it is prose about the
 * payload, and prose about the payload is what the vocabulary suites scan.
 *
 * `hash` IS PART OF THE CONTRACT, not a slug computed at render time. A
 * colleague pastes `…/flows/ticker/?t=NVDA#ftg-convexity` into a message and
 * it has to survive a rename of the label above it.
 */
export const TICKER_GROUPS = Object.freeze([
  { key: "signal", label: "Signal", hash: "ftg-signal",
    blurb: "The published score, what it is made of, and what it has done since " +
      "the last session that scored this name." },
  { key: "convexity", label: "Convexity", hash: "ftg-convexity",
    blurb: "The dealer book: where gamma sits along the strike ladder and the " +
      "term, and how it is moving." },
  { key: "volatility", label: "Volatility", hash: "ftg-volatility",
    blurb: "What the option chain charges — the smile, the term structure, and " +
      "the move those two imply." },
  { key: "tape", label: "Tape", hash: "ftg-tape",
    blurb: "What actually traded: the lifted strikes, the largest lines, the " +
      "session path and the off-exchange prints." },
  { key: "context", label: "Context", hash: "ftg-context",
    blurb: "Where this session sits in the name’s own year, who has " +
      "disclosed a trade in it, and whether it places against the rest of " +
      "the market." },
]);

/** The legal `tier` values. A tier with no stylesheet rule is a box with no chrome. */
export const PANEL_TIERS = Object.freeze(["lead", "chart", "table", "reading"]);

/** Every registry key that names a `card.panels` entry. */
export const TICKER_PANEL_KEYS = Object.freeze(
  TICKER_PANELS.filter((p) => p.key !== SCORE_KEY).map((p) => p.key));
