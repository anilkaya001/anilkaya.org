export const TICKER_PANELS = Object.freeze([

  { key: "__score", id: "ftWhy", span: 3, group: "signal", tier: "lead",
    title: "Score derivation",
    question: "Which components produced this score, and how heavily?" },

  { key: "__stats", id: "ftStats", span: 3, group: "signal", tier: "table",
    title: "Key statistics",
    question: "What are this name’s headline figures, gathered from the panels that publish them?" },

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

  { key: "deltaExposure", id: "ftDelta", span: 1, group: "convexity", tier: "chart",
    title: "Dealer delta by expiry",
    question: "How much directional exposure are dealers carrying, and where along the term?" },
  { key: "vanna", id: "ftVanna", span: 1, group: "convexity", tier: "chart",
    title: "Vanna by expiry",
    question: "How much would that exposure move on a one-point change in implied volatility?" },

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

  { key: "aggressor", id: "ftAggr", span: 1, group: "tape", tier: "lead",
    title: "Who is lifting, by strike",
    question: "At which strikes were contracts taken at the offer?" },
  { key: "path", id: "ftPath", span: 1, group: "tape", tier: "chart",
    title: "Session path",
    question: "How did the flow accumulate through the session?" },

  { key: "premiumTrack", id: "ftPremTrack", span: 2, group: "tape", tier: "chart",
    title: "Net premium by session",
    question: "How has this name’s net premium moved across sessions?" },

  { key: "__sessions", id: "ftLedger", span: 2, group: "tape", tier: "table",
    title: "Session by session",
    question: "What did this name close, score and clear on each of the last sessions?" },

  { key: "topContracts", id: "ftTop", span: 2, group: "tape", tier: "table",
    title: "The day’s most-traded contracts",
    question: "Which single lines carried the volume?" },

  { key: "darkpool", id: "ftDark", span: 1, group: "tape", tier: "table",
    title: "Off-exchange prints",
    question: "Which off-exchange prints carried the size in this name?" },
  { key: "oiDeltas", id: "ftOi", span: 1, group: "tape", tier: "table",
    title: "Open-interest changes",
    question: "Where did open interest move between clearing snapshots?" },

  { key: "marketRank", id: "ftCross", span: 1, group: "context", tier: "lead",
    title: "Market-wide standing",
    question: "Does this name place in the market’s own two lists, and from which session?" },
  { key: "congress", id: "ftCongress", span: 1, group: "context", tier: "table",
    title: "Disclosed congressional transactions",
    question: "Has anyone in Congress disclosed a trade in this name?" },

  { key: "context", id: "ftCtx", span: 1, group: "context", tier: "chart",
    title: "Price context",
    question: "Where does today sit in the name’s own year?" },]);

export const SENTINEL_KEYS = new Set(["__score", "__stats", "__sessions"]);

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

export const PANEL_TIERS = Object.freeze(["lead", "chart", "table", "reading"]);

export const TICKER_PANEL_KEYS = Object.freeze(
  TICKER_PANELS.filter((p) => !SENTINEL_KEYS.has(p.key)).map((p) => p.key));

export const STATION_SIDE_COUNTS = Object.freeze(
  Object.fromEntries(TICKER_GROUPS.map((g) =>
    [g.key, TICKER_PANELS.filter((p) => p.group === g.key).length])));
