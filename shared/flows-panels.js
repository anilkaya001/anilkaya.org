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

   EVERYTHING THE BROWSER NEEDS FROM THIS FILE REACHES IT AS MARKUP.
   `shared/` is listed in .assetsignore and is never served, so a
   browser module cannot import it. flows-pages.js therefore emits
   each panel's `question` into a data-question attribute AND into a
   visible <p class="ft-panel-q">, its `group` and `tier` into
   data-group and data-tier, and its sentinel-ness into a bare
   data-sentinel — four facts the controller reads off the DOM rather
   than restating. A renderer reading `entry.question` at runtime
   gets `undefined` and prints an empty question, failing nothing.

   THE ONE PROJECTION THAT SURVIVES IS A CHECK, NOT A SOURCE.
   assets/js/flows-ticker.js still carries a PANEL_CHROME table of
   group and tier and no longer WRITES either: the served markup
   does, from this file, and mountChrome only reports a disagreement.
   It is pinned the way the DRAW table is — tests/flows-ticker-
   contract.mjs asserts the two agree key for key AND value for
   value, both directions. A duplicate a test cannot see is a drift;
   a duplicate a test compares is a projection.
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
 * IT IS ALSO HOW A PANEL IS TAKEN OUT OF THE PAIRING, and that use is newer
 * than the paragraph above. A grid row is as tall as its tallest member, so
 * two panels sharing a row share a height whether or not they have that much
 * to say: measured across six names and four widths, the worst mismatch on
 * this page was `__score` at 1034px beside `__stats` at 330px — 3.13x, and
 * the stretch handed an eight-row stat list seven hundred pixels of ground.
 * `gamma` and `__stats` are span 2 for that reason and for no geometric one;
 * each entry says so.
 *
 * WHICH ONE OF A MISMATCHED PAIR IS WIDENED IS NOT FREE, AND THE SUITE OWNS
 * THE ANSWER. Widening the TALL panel is the obvious move and it is wrong
 * here: this file tried it, and the contract refused with a measurement it
 * already held — `__score` is five gauges and their weights, which set their
 * own width, so a span-2 host spends the difference on white space. The rule
 * that survives is about the CONTENT, not the height: widen the panel whose
 * layout can absorb width. `__stats` is a `.fc-stats` grid, and that rule is
 * `repeat(auto-fit, minmax(min(8.5rem, 100%), 1fr))` — a wider host buys it
 * more COLUMNS and a shorter box, which is the opposite of what it buys the
 * gauges. So the short panel is widened and the tall one keeps its column.
 *
 * `group` IS THE PAGE'S TABLE OF CONTENTS, and it is a field rather than a
 * heading because a group is now three things at once — a served <section
 * class="ft-station">, a heading inside it, a tab in the bar above it — and
 * three hand-written lists of five labels is this file's own defect, one
 * level up.
 *
 * ORDER IS THE ARGUMENT THE PAGE MAKES, and it has changed three times. It
 * was "the four chain panels come first, being the half of the payload never
 * drawn" — correct until they were drawn. Then "the score derivation leads,
 * because a reader arrives from a board row carrying a score", with the other
 * twenty regrouped so `levels` sat beside `surface`.
 *
 * IT IS NOW A SEQUENCE OF STATIONS: five sections a reader tabs between
 * rather than five headings in one scroll, so a group is what a reader is ON
 * and the order within one is what they read top to bottom. Four entries
 * moved for that reading — `scoreOverlay` leads, being the only panel that
 * can say a reading is NEW, and `displacement`, `path` and `marketRank` each
 * move up beside the panel they are the second reading of.
 *
 * AND ORDER IS NOW ALSO A HEIGHT ARGUMENT, which is the fourth rewrite. At two
 * columns a station's span-1 panels pair off in this order, and a pair shares
 * the taller one's height — so which panels are adjacent decides how much
 * blank ground the page opens. Measured intrinsic heights turned that into a
 * matching problem with an answer: today's order left a worst row mismatch of
 * 704px and a mean of 280px; sorting by height alone fixed the mean (181px)
 * and not the worst; the order below, with `gamma` and `__stats` lifted out to
 * span 2, measures 233px worst and 99px mean. The remaining gaps — 19, 24, 47,
 * 85, 111, 172 and 233 pixels — are small enough for the shorter panel's own
 * drawing to grow into honestly, which is what the fills are for.
 *
 * AN ODD STATION LEAVES ITS SHORTEST PANEL ALONE, deliberately. `context`
 * (350px) ends its station without a row-mate; pairing it with either
 * neighbour stretched it, and the half-row that leaves is at the station's end
 * where it reads as a closing rather than as a defect. Which panel is left
 * alone is a choice, and the shortest is the only choice that asks nobody to
 * fill a gap — asserted in flows-ticker-contract.mjs, not just written here.
 *
 * The groups themselves are contiguous by contract:
 *
 *   signal      what the number is, what it just did, and its headline figures
 *   convexity   the dealer book that produced it
 *   volatility  what the chain is charging for the move
 *   tape        what actually traded
 *   context     the name's own year, and who else is in it
 *
 * WITHIN A GROUP THE FIRST ENTRY IS ITS LEAD, and carries `tier: "lead"`.
 * That is not decoration: with 23 boxes of identical chrome the eye has no
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
  /* ---------- SIGNAL: the number, what it did, and its figures ------

     THE HISTORY LEADS, and the ordering argument above has been rewritten a
     second time because it expired a second time.

     The score derivation led while this page was one scroll: a reader off a
     board row carrying a score was owed, first, what that score is made of.
     That is still true of the DERIVATION and it is not what a reader opens a
     station for. This is the one panel built from two payloads and the only
     one carrying a SERIES — the card's dated price window joined, in the
     pipeline, against the dated score history for every name on the board.
     Everything else describes one session in enormous detail; this is the
     only thing that can say a reading is NEW, the claim the product makes.

     The join is in the pipeline, which holds both payloads when it builds a
     card, so it is done once by a shaper a contract test can run without a
     browser; fetching the track in the page would put an untested date join
     inside a drawing function. The header strip's overnight move comes off
     these same rows, so this panel is the working that strip summarises. */
  { key: "scoreOverlay", id: "ftOverlay", span: 2, group: "signal", tier: "lead",
    title: "Score over price",
    /* THE TYPOGRAPHIC APOSTROPHE, as every other question on this page uses.
       escapeHTML turns an ASCII ' into &#39;, and the worker suite compares
       the registry's string against the served markup — so a straight quote
       here fails a test whose message is about the question "reaching the
       markup", which is not what went wrong. U+2019 passes through untouched
       and is what this site sets prose in anyway. */
    question: "How has this name’s daily score moved against its own price?" },
  /* THE DERIVATION, SECOND AND NARROWER. It gave up the lead to the series
     above it and its second column with it: five gauges and their weights are
     a column of rows, not a drawing, and a span-2 host spent the extra 470px
     on white space beside a list that sets its own width. `tier: "table"` for
     the same reason — rows a reader scans, not a chart sized from its host. */
  { key: "__score", id: "ftWhy", span: 1, group: "signal", tier: "table",
    title: "Score derivation",
    question: "Which components produced this score, and how heavily?" },
  /* THE SECOND SENTINEL, AND THE FIRST PANEL HERE NOT ABOUT ONE PAYLOAD KEY.
     Spot, ATR, the gamma flip, the priced move and the IV rank are each
     published by a DIFFERENT panel below and each answer the same kind of
     question — "what is the headline number" — so a reader hunting one opens
     whichever station it lives in and scans a chart for a figure that is one
     line of text. Gathering them costs no vendor call and no payload field.

     IT WAS DELIBERATELY EMPTY WHEN IT SHIPPED, and that sentence outlived the
     patch that filled it: keyStats() emits eight pairs — spot, ATR, max pain,
     both walls, the gamma flip, the priced move and the IV rank — each
     carrying the silence of the panel it was gathered from. The comment is
     corrected here rather than deleted, because "this panel is empty on
     purpose" is exactly the claim a later reader would have believed.

     AND IT IS span 2, WHICH IS A HEIGHT FIX APPLIED TO THE SHORT PANEL.
     Intrinsic heights: `__score` is 1034px and this panel is 330px — 3.13x,
     the widest mismatch on the page, and `signal` holds no third span-1 panel
     to pair either with. Stretch gave this eight-row list the derivation's
     full height and asked it to fill 700px it has nothing to say into.

     THE FIRST ATTEMPT WIDENED `__score` AND THE SUITE REFUSED IT, holding a
     measurement this change had not made: five gauges and their weights set
     their own width, so a span-2 host spends the difference on white space —
     vertical dead space traded for horizontal. This panel is the one that can
     take the width instead. `.fc-stats` is `repeat(auto-fit, minmax(min(
     8.5rem, 100%), 1fr))`, so a full-width host lays the same eight readings
     out in more columns and fewer rows: wider AND shorter, which ends the
     pairing from the other side.

     THE COST IS ONE HALF-ROW, STATED RATHER THAN HIDDEN. `__score` keeps its
     column and now has no row-mate, so the cell beside it is empty and that
     cell is not at the station's end. It is the smaller of the two costs —
     an empty half-row against 700px of stretched-open stat list — and it
     closes when this panel becomes the large-type readout it is headed for. */
  { key: "__stats", id: "ftStats", span: 2, group: "signal", tier: "table",
    title: "Key statistics",
    question: "What are this name’s headline figures, gathered from the panels that publish them?" },

  /* ---------- CONVEXITY: the dealer book ---------------------------
     Gamma leads: it is the one panel a reader opens on a name they already
     know. Then the joint its ladder is a marginal of, and only then the two
     short readings that measure spot against the same standing bars.

     THE ORDER MOVED SO THAT `levels` AND `displacement` ARE ACTUALLY BESIDE
     EACH OTHER. The sentence this replaces said `displacement` "belongs
     beside" `levels` and the registry did put them adjacent — but adjacency
     in a LIST is not adjacency in a GRID. At two columns the old order seated
     `levels` in row 1 column 2 and `displacement` in row 2 column 1: one below
     the other, which is the arrangement the sentence was written to refuse.
     `surface` moving up one place is what makes them row-mates, and it is
     also the better reading order — the joint before its marginals.

     AND IT CLOSES A HOLE. `surface` is span 2, so it can only begin a row.
     Sitting at an odd cell index it could not start until the next row and
     left the cell beside `displacement` empty — a gap in the middle of the
     station, which reads as a broken renderer rather than as the end of a
     section.

     `gamma` IS span 2 NOW, and that is what leaves it without a row-mate.
     Measured intrinsic heights put it at 795px against `levels` 313 and
     `displacement` 360; pairing it with either would have stretched a short
     reading across nearly 500px of ground it cannot fill. Its ladder is also
     the panel the 76rem breakpoint exists for (see .ft-station in flows.css),
     so the extra width is a reading improvement and not a layout dodge. */
  { key: "gamma", id: "ftGamma", span: 2, group: "convexity", tier: "lead",
    title: "Gamma convexity",
    question: "Where is the dealer book long and short gamma?" },
  { key: "surface", id: "ftSurface", span: 2, group: "convexity", tier: "chart",
    title: "Gamma surface — strike × expiry",
    question: "Which expiries carry the standing gamma, and at which strikes?" },
  { key: "levels", id: "ftLevels", span: 1, group: "convexity", tier: "reading",
    title: "Key levels & distance to spot",
    question: "Where are the walls, and how far is spot from each in ATR?" },
  { key: "displacement", id: "ftDisp", span: 1, group: "convexity", tier: "reading",
    title: "Where the book is moving",
    question: "Is new gamma building above or below the standing book?" },
  { key: "calendar", id: "ftCal", span: 1, group: "convexity", tier: "chart",
    title: "Gamma roll-off",
    question: "How much of the book expires, and when?" },
  { key: "charm", id: "ftCharm", span: 1, group: "convexity", tier: "chart",
    title: "Charm by expiry",
    question: "How fast is that exposure decaying with time alone, spot unchanged?" },
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
  { key: "vanna", id: "ftVanna", span: 1, group: "convexity", tier: "chart",
    title: "Vanna by expiry",
    question: "How much would that exposure move on a one-point change in implied volatility?" },

  /* ---------- VOLATILITY: what the chain charges -------------------
     THE PAIR STAYS ADJACENT AND STAYS span 2. The term line's j-th bar centre
     has to coincide with the surface's j-th column centre, which can only
     hold if the two mount at the same host width. Moving either out of the
     other's shadow, or dropping one to span 1, does not merely misalign the
     chart — it makes the alignment assertion unsatisfiable. Wrapping the
     groups in stations does not touch it: both panels are inside THIS
     station, and a station lays out nothing horizontally of its own. */
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

  /* ---------- TAPE: what actually traded ---------------------------
     THE TWO READINGS OF THE SAME TAPE ARE ADJACENT NOW. `aggressor` says
     which strikes were taken at the offer and `path` says how that flow
     accumulated through the session — the same executions, once by strike and
     once by clock. The fifty-row contract table used to sit between them, so
     a reader holding one against the other scrolled past it twice. */
  { key: "aggressor", id: "ftAggr", span: 1, group: "tape", tier: "lead",
    title: "Who is lifting, by strike",
    question: "At which strikes were contracts taken at the offer?" },
  { key: "path", id: "ftPath", span: 1, group: "tape", tier: "chart",
    title: "Session path",
    question: "How did the flow accumulate through the session?" },
  /* SPAN 2 BECAUSE THE COLUMN THAT PAYS IS THE LAST ONE. Nine columns in a
     span-1 host (456px at a 1216px viewport) push `Net aggr` outside the
     scroll wrapper's visible width, so the panel's whole answer — which lines
     were LIFTED — is off-screen until a reader thinks to scroll a table they
     have no reason to think scrolls. The wrapper still scrolls at phone
     widths, where nothing can fit nine columns. */
  { key: "topContracts", id: "ftTop", span: 2, group: "tape", tier: "table",
    title: "The day’s most-traded contracts",
    question: "Which single lines carried the volume?" },
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

  /* ---------- CONTEXT: the name's own year, and who is in it -------
     THE TWO PLACEMENT QUESTIONS ARE ADJACENT. "Where does today sit in this
     name's own year" and "does this name place against every other name" are
     one question asked at two scales, and the congressional table — a
     different kind of fact entirely, about disclosure rather than about
     price — used to sit between them.

     AND THIS IS THE ONE STATION THE HEIGHT PASS COULD NOT IMPROVE, which is
     worth writing down rather than leaving as an absence. Measured, `context`
     is 350px and `marketRank` is 865px, so as row-mates the shorter is
     stretched 515px — the widest mismatch left on the page. Three rules
     already argued in this file pin that arrangement: this panel is its
     group's lead so it must come first, `marketRank` must sit directly under
     it (asserted in flows-ticker-contract.mjs), and `congress` is the only
     other member. Every ordering that fixes the height breaks one of them.

     SO IT STAYS, AND IT IS AN EDITORIAL DECISION RATHER THAN A LAYOUT ONE.
     Closing it needs one of: this panel giving up the lead, the adjacency
     being dropped, or `marketRank` taking span 2 — each a claim about what
     the station SAYS, which is not a change a height measurement gets to
     make on its own. */
  { key: "context", id: "ftCtx", span: 1, group: "context", tier: "lead",
    title: "Price context",
    question: "Where does today sit in the name’s own year?" },
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
  { key: "congress", id: "ftCongress", span: 1, group: "context", tier: "table",
    title: "Disclosed congressional transactions",
    question: "Has anyone in Congress disclosed a trade in this name?" },]);

/**
 * The keys that name no `card.panels` entry at all.
 *
 * NOT PANEL KEYS, AND SPELLED SO THEY CAN NEVER COLLIDE WITH ONE. `__score`
 * is drawn from the card's TOP-LEVEL fields (score, fam, weights, conv,
 * quality); `__stats` is drawn from the OTHER PANELS, gathering one figure
 * each out of several of them. Both mount and both draw, and neither is a key
 * the pipeline publishes.
 *
 * A SET AND NOT A CONSTANT, BECAUSE ONE OF THEM WAS ABOUT TO LEAK. While
 * there was exactly one sentinel it was a string, `SCORE_KEY`, and every
 * exclusion in the repo was written `!== SCORE_KEY` — a shape that silently
 * admits the second sentinel the moment it exists. Two things go wrong then
 * and neither loudly: TICKER_PANEL_KEYS starts demanding a
 * `card.panels.__stats` on every card, and the pipeline's shed ladder becomes
 * free to name a key it can never drop, "shedding" a panel nobody publishes
 * to save nothing. Both are asserted against this set in
 * tests/flows-ticker-contract.mjs, in the direction that fails.
 */
export const SENTINEL_KEYS = new Set(["__score", "__stats"]);

/**
 * The five stations, in the order the page reads them.
 *
 * `blurb` IS THE GROUP'S OWN SENTENCE and it is here rather than in the
 * controller for the same reason every `question` is: it is prose about the
 * payload, and prose about the payload is what the vocabulary suites scan.
 * The controller no longer keeps a copy of any of it — the worker emits the
 * label and the blurb into each station's own <h2> from this array, so the
 * five sentences exist once instead of twice.
 *
 * `hash` IS PART OF THE CONTRACT, not a slug computed at render time. A
 * colleague pastes `…/flows/ticker/?t=NVDA#ftg-convexity` into a message and
 * it has to survive a rename of the label above it.
 *
 * `key` IS ALSO THE STATION'S ADDRESS — the `?s=` value every board row, deck
 * tile and watch row already links here with (`…&s=signal&from=long`). That
 * is why the first label reads "Overview" over a group keyed "signal": the
 * LABEL is what a reader sees, and it changed when the group stopped being a
 * heading and became the station a reader lands ON; the KEY is in links that
 * were sent before this change and must still open after it.
 */
export const TICKER_GROUPS = Object.freeze([
  { key: "signal", label: "Overview", hash: "ftg-signal",
    blurb: "The published score, what it has done since the last session that " +
      "scored this name, what it is made of, and the figures the rest of this " +
      "page derives." },
  { key: "convexity", label: "Convexity", hash: "ftg-convexity",
    blurb: "The dealer book: where gamma sits along the strike ladder and the " +
      "term, and how it is moving." },
  { key: "volatility", label: "Volatility", hash: "ftg-volatility",
    blurb: "What the option chain charges — the smile, the term structure, and " +
      "the move those two imply." },
  { key: "tape", label: "Tape", hash: "ftg-tape",
    blurb: "What actually traded: the lifted strikes, the session path, the " +
      "largest lines and the off-exchange prints." },
  { key: "context", label: "Context", hash: "ftg-context",
    blurb: "Where this session sits in the name’s own year, whether it places " +
      "against the rest of the market, and who has disclosed a trade in it." },
]);

/** The legal `tier` values. A tier with no stylesheet rule is a box with no chrome. */
export const PANEL_TIERS = Object.freeze(["lead", "chart", "table", "reading"]);

/** Every registry key that names a `card.panels` entry. */
export const TICKER_PANEL_KEYS = Object.freeze(
  TICKER_PANELS.filter((p) => !SENTINEL_KEYS.has(p.key)).map((p) => p.key));

/**
 * How many panels each station holds, keyed by its `?s=` address.
 *
 * ONE NUMBER, MORE THAN ONE READER. The tab in the bar prints it, the station
 * that tab opens holds exactly that many, and the controller that will hide
 * four of the five has to say how many panels a reader is not looking at.
 * COUNTED FROM TICKER_PANELS rather than written down: a hand-typed 8 beside
 * a nine-panel station is not wrong about any panel, only about how many
 * there are, which is the one error a per-panel assertion cannot see.
 */
export const STATION_SIDE_COUNTS = Object.freeze(
  Object.fromEntries(TICKER_GROUPS.map((g) =>
    [g.key, TICKER_PANELS.filter((p) => p.group === g.key).length])));
