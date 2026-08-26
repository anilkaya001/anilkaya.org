/* =============================================================
   flows-panels.js — the ticker page's panel registry.

   PURE DATA. No DOM, no network, no imports. Read by
   shared/flows-pages.js on the Worker side to EMIT the markup, and
   by tests to assert that the emitted markup, the browser's drawer
   table and the pipeline's shed order all name the same panels.

   WHY A REGISTRY AND NOT THREE HAND-WRITTEN LISTS. The card dialog's
   markup is ten hand-written <section class="fc-panel"> blocks in
   flows-pages.js, its drawer table is a second list in the browser,
   and the pipeline's shed ladder is a third in flows-pipeline.mjs.
   Three lists of the same panels, maintained by hand, is three
   chances for a panel to exist in two of them and be silently
   invisible in the product — which this repo has shipped: the four
   chain panels below have been published in every card since the
   chain leg landed and NOTHING HAS EVER DRAWN THEM. A key with no
   drawer now renders a visible "no renderer is registered" panel,
   and a drawer with no key fails a test.

   `question` REACHES THE BROWSER AS MARKUP, NOT AS AN IMPORT.
   `shared/` is listed in .assetsignore and is never served, so a
   browser module cannot import this file. flows-pages.js emits each
   question into a data-question attribute and the drawer reads it
   from the DOM. A renderer that tried to read `entry.question` at
   runtime would get `undefined` and print an empty question with
   nothing failing.
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
 * ORDER IS THE ARGUMENT THE PAGE MAKES. The four chain panels come first
 * because they are what this page exists to show — they are the half of the
 * card payload that has never been drawn. Gamma leads because it is the one
 * panel a reader opens the page for on a name they already know.
 */
export const TICKER_PANELS = Object.freeze([
  { key: "gamma", id: "ftGamma", span: 1,
    title: "Gamma convexity",
    question: "Where is the dealer book long and short gamma?" },
  { key: "aggressor", id: "ftAggr", span: 1,
    title: "Who is lifting, by strike",
    question: "At which strikes were contracts taken at the offer?" },
  { key: "ivSurface", id: "ftIvs", span: 2,
    title: "Implied volatility — moneyness × expiry",
    question: "What shape is the smile, and how does it change with tenor?" },
  { key: "skewTerm", id: "ftTerm", span: 2,
    title: "Term structure and skew",
    question: "Is the front bid over the back, and which wing is bid?" },
  /* SPAN 2 BECAUSE THE COLUMN THAT PAYS IS THE LAST ONE. Nine columns in a
     span-1 host (456px at a 1216px viewport) push `Net aggr` outside the
     scroll wrapper's visible width, so the panel's whole answer — which lines
     were LIFTED — is off-screen until a reader thinks to scroll a table they
     have no reason to think scrolls. The wrapper still scrolls at phone
     widths, where nothing can fit nine columns. */
  { key: "topContracts", id: "ftTop", span: 2,
    title: "The day’s most-traded contracts",
    question: "Which single lines carried the volume?" },
  { key: "levels", id: "ftLevels", span: 1,
    title: "Key levels & distance to spot",
    question: "Where are the walls, and how far is spot from each in ATR?" },
  { key: "surface", id: "ftSurface", span: 2,
    title: "Gamma surface — strike × expiry",
    question: "Which expiries carry the standing gamma, and at which strikes?" },
  { key: "displacement", id: "ftDisp", span: 1,
    title: "Where the book is moving",
    question: "Is new gamma building above or below the standing book?" },
  { key: "calendar", id: "ftCal", span: 1,
    title: "Gamma roll-off",
    question: "How much of the book expires, and when?" },
  { key: "pricedMove", id: "ftMove", span: 1,
    title: "The priced move",
    question: "What move is the option market pricing over the stated horizon?" },
  { key: "path", id: "ftPath", span: 1,
    title: "Session path",
    question: "How did the flow accumulate through the session?" },
  { key: "context", id: "ftCtx", span: 1,
    title: "Price context",
    question: "Where does today sit in the name’s own year?" },
  { key: "congress", id: "ftCongress", span: 1,
    title: "Disclosed congressional transactions",
    question: "Has anyone in Congress disclosed a trade in this name?" },
  /* NOT A PANEL KEY. The score derivation is drawn from the card's TOP-LEVEL
     fields (score, fam, weights, conv, quality), not from card.panels — so it
     is deliberately spelled with a sentinel that can never collide with a
     payload key, and the test that asserts "every registry key is a key of
     buildCard().panels" excludes exactly this one. */
  { key: "__score", id: "ftWhy", span: 2,
    title: "Score derivation",
    question: "Which components produced this score, and how heavily?" },
]);

/** The sentinel key that is drawn from the card's top level, not its panels. */
export const SCORE_KEY = "__score";

/** Every registry key that names a `card.panels` entry. */
export const TICKER_PANEL_KEYS = Object.freeze(
  TICKER_PANELS.filter((p) => p.key !== SCORE_KEY).map((p) => p.key));
