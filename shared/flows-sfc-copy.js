import { REASON_LABELS, REASON_HOVERS } from "./flows-sides.js";
import { MINUS } from "./flows-sfc-display.js";

export const TITLE = "Premium ledger";

export const KEY_LINE = "Minus (−) means that column paid the premium; plus (+) means it received it.";

export const WINDOW_BASIS_REASONS = Object.freeze(["btw", "cross", "leg", "ns"]);

export const GROUPS = Object.freeze([
  Object.freeze({ id: "held", label: "Held windows", short: "Held", hover: "The flagged windows the live record kept.", cols: Object.freeze([0, 1]) }),
  Object.freeze({ id: "noside", label: "Side unknown", short: "Side unknown", hover: "Premium whose side is unknown, booked as a pair that nets to zero.", cols: Object.freeze([2, 3]) }),
  Object.freeze({ id: "outside", label: "Outside held", short: "Outside", hover: "Sector tide premium that the held windows do not hold.", cols: Object.freeze([4, 5]) }),
]);

export const COLUMN_COPY = Object.freeze([
  Object.freeze({ id: "TK", label: "Takers", sub: "held", group: "held", hover: "Held windows only: premium paid on the ask side, received on the bid side. Takers are inferred from the price against the quote." }),
  Object.freeze({ id: "LP", label: "Providers", sub: "held", group: "held", hover: "Held windows only: the passive side of each taker trade. It is anyone resting at the quote, not only market makers." }),
  Object.freeze({ id: "BN", label: "Buyers", sub: "held", group: "noside", hover: "Buyers in held windows whose side is unknown." }),
  Object.freeze({ id: "SN", label: "Sellers", sub: "held", group: "noside", hover: "Sellers in held windows whose side is unknown." }),
  Object.freeze({ id: "TO", label: "Takers", sub: "outside", group: "outside", hover: "Net taker premium outside held windows, from the sector tide." }),
  Object.freeze({ id: "LO", label: "Providers", sub: "outside", group: "outside", hover: "The other side of taker premium outside held windows." }),
]);

export const ROW_COPY = Object.freeze([
  Object.freeze({ id: "r1", label: "Calls, ask side", hover: "Premium on the ask side: takers paid, providers received." }),
  Object.freeze({ id: "r2", label: "Calls, bid side", hover: "Premium on the bid side: takers received, providers paid." }),
  Object.freeze({ id: "r3", label: "Puts, ask side", hover: "Premium on the ask side: takers paid, providers received." }),
  Object.freeze({ id: "r4", label: "Puts, bid side", hover: "Premium on the bid side: takers received, providers paid." }),
  Object.freeze({ id: "r5", label: "Side unknown: between quotes", short: "Between quotes", group: "side", hover: REASON_HOVERS.window.btw, reason: "btw" }),
  Object.freeze({ id: "r6", label: "Side unknown: floor trade", short: "Floor trade", group: "side", hover: REASON_HOVERS.window.cross, reason: "cross" }),
  Object.freeze({ id: "r7", label: "Side unknown: spread legs", short: "Spread legs", group: "side", hover: REASON_HOVERS.window.leg, reason: "leg" }),
  Object.freeze({ id: "r8", label: "Side unknown: not reported", short: "Not reported", group: "side", hover: REASON_HOVERS.window.ns, reason: "ns" }),
  Object.freeze({ id: "r9", label: "Net calls outside held", hover: "Sector tide net call premium, less the held-window net." }),
  Object.freeze({ id: "r10", label: "Net puts outside held", hover: "Sector tide net put premium, less the held-window net." }),
  Object.freeze({ id: "r11", label: "Balancing entry, defined", hover: "Closes each column; defined, not observed." }),
]);

export const GROUP_ROWS = Object.freeze({ side: Object.freeze({ label: "Side unknown", hover: "Booked both ways, so each pair nets to zero. Never split." }) });

export const NET_ROW = Object.freeze({ id: "net", label: "Net before balancing", hover: "What each column paid or received in the rows above." });

export const ZERO_LINE = "Every row and column sums to zero by construction. The balancing row is defined, not observed.";

export const BALANCING_DEFINITION = "Defined, not observed: the entry that brings each column to zero. Trades can open or close positions, so it does not measure holdings. Open interest is not available here, so it cannot be checked.";

export const SECTOR_HEADERS = Object.freeze([
  Object.freeze({ id: "sector", label: "Sector", hover: "Eleven sectors, Index & ETF, and No sector." }),
  Object.freeze({ id: "taker", label: "Taker net", hover: "Ask-side premium minus bid-side premium." }),
  Object.freeze({ id: "calls", label: "Calls", hover: "Call premium on the ask side minus the bid side." }),
  Object.freeze({ id: "puts", label: "Puts", hover: "Put premium on the ask side minus the bid side." }),
  Object.freeze({ id: "noside", label: "Side unknown", hover: "Held-window premium whose side is unknown." }),
  Object.freeze({ id: "outside", label: "Outside", hover: "Sector tide net premium outside held windows: tide less the held-window net." }),
  Object.freeze({ id: "tilt", label: "Tilt", hover: "Delta-dollars against the sector's market-cap share, with its band. Not against usual options activity." }),
  Object.freeze({ id: "coverage", label: "Cov.", hover: "Share of sided premium whose windows have a computed delta." }),
]);

export const SECTOR_SHORT = Object.freeze({ "Communication Services": "Comm. services", "Consumer Cyclical": "Cons. cyclical", "Consumer Defensive": "Cons. defensive", "Financial Services": "Financials" });

export const PANEL_LINES = Object.freeze({
  ledger: "Who paid and who received option premium, by holder.",
  sectors: "Held-window premium by sector, with the outside remainder.",
  flow: "Premium on the ask side and on the bid side.",
  tilt: "Each sector's delta-dollars against its market-cap share.",
  stock: "Open positions are not stored, so this panel is not built.",
});

export const NOT_BUILT = Object.freeze([
  "Open interest: not built. Flows are not split into opening and closing.",
  "Individual trades: not built. Figures are window totals from the vendor.",
  "Earlier sessions: not built. Nothing is compared with past days.",
  "Beta: not built. Figures are not market-adjusted.",
  "Dividends: not built. Deltas assume no dividend.",
]);

export const NOT_BUILT_LINE = "Not built yet: open interest, beta adjustment, dividends in deltas, earlier sessions.";

export const DELTA_NOTES = Object.freeze([
  "Contracts per side are estimated from premium at the window's average price.",
  "Deltas use Black-Scholes at 4%, no dividends and window-end volatility.",
  "Delta uses the vendor's stock price for each window. Its time within the window is unstated.",
  "The band covers side-unknown contracts and windows without a delta.",
  "The band is proven for held windows, under these conventions.",
  "It takes the estimated contract counts and modelled deltas as given.",
]);

export const INFO = Object.freeze([
  "This page is a closed ledger of option premium in held windows. Every dollar paid is recorded once as received.",
  "Liquidity providers are a column of their own. So every row and every column sums to zero.",
  "A provider is whoever rested at the quote, not only a market maker.",
  "Only held flagged windows are booked. Smaller windows are shed and counted in the scope line.",
  "Figures are window totals, not trade by trade. Premium is booked by where a window traded against the bid and ask.",
  "Cells are rounded so rows and columns still add up. A cell can sit up to one unit from its exact figure.",
  "Hover or focus a cell for the exact figure.",
  "Premium whose side is unknown is booked both ways, so it nets to zero. It is never split.",
  "The ledger records no entries between sectors. Each sector closes on itself.",
  "Tilt compares a sector's delta-dollars with its market-cap share. It is exposure, not cash.",
  "Delta-dollars are taker contracts times 100 times delta times the stock price.",
  "Tilt is set against market-cap share, not against usual options activity.",
  "Index & ETF and No sector have no benchmark, so they carry no verdict.",
  "The top bar shows takers' share of held premium as a range.",
  "The hatched span is side unknown, drawn as a range, not a bucket.",
  "Every range is rounded outward, so it never claims more than the figures prove.",
  "A triangle beside a net means its sign holds for any side-unknown split. Calls and puts share that one total.",
  "A hollow diamond means the sign is undecided. Side unknown is at least as large as the net.",
  "The mark is decided from the printed range. It never claims a sign the figures do not show.",
  "The range under a net is an outer range, not a confidence interval. Calls and puts share one side unknown, so their ranges do not add.",
  "Nets count only trades with a matched side.",
  "The tick shows takers' share of premium with a stated side. It assumes unknown premium splits the same way.",
  "Sides come from matching trades to quotes, which can misplace a trade.",
  "The last poll turns late after two missed polls. It shows no reply, not stopped data, once five minutes pass.",
  "The checks test that figures agree with each other. They do not test the vendor's data.",
  "Outside rows are the sector tide less held windows. They also hold trades the vendor never flagged.",
  "All times are TRT.",
]);

const grouped = (n) => String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const centsText = (n) => `${n < 0 ? MINUS : ""}${grouped(n)} ¢`;

export const CHECKS = Object.freeze({
  rows: Object.freeze({
    label: "Rows foot",
    pass: (n) => `Rows foot over ${n} rows, exactly and as displayed.`,
    fail: (row, x) => `Rows do not foot: ${row} sums to ${centsText(x)}.`,
    absent: "— · no held windows in this scope",
    hover: "Each row is one payment, so receipts and payments cancel.",
  }),
  columns: Object.freeze({
    label: "Columns close",
    pass: (k, largest) => (k === 6 ? `Defined balancing entries close all 6 columns; the largest is ${largest}.` : `Defined balancing entries close ${k} of 6 columns. The outside columns are absent.`),
    fail: (x) => `Balancing entries sum to ${centsText(x)}, not zero.`,
    absent: "— · no held windows in this scope",
    hover: "What one holder pays, another receives; the closing entries cancel.",
  }),
  sides: Object.freeze({
    label: "Sides close",
    pass: (n) => `Bought + sold + side unknown = total premium, over ${n} windows.`,
    fail: (x) => `Sides do not close: off by ${centsText(x)}.`,
    absent: "— · no held windows in this scope",
    hover: "Each held-window premium dollar is bought, sold or side unknown, once.",
  }),
  sectors: Object.freeze({
    label: "Sectors add up",
    pass: "The sector table adds to the ledger, to the cent.",
    fail: (x) => `Sector table differs from the ledger by ${centsText(x)}.`,
    absent: "— · no held windows in this scope",
    single: "— · one scope: the sector table is not summed",
    hover: "The thirteen sector rows add to the ledger's taker and side-unknown totals.",
  }),
  tilt: Object.freeze({
    label: "Tilts sum to zero",
    pass: (sum, n) => `Tilt sums to ${sum} delta-dollars over ${n} weighted ${n === 1 ? "sector" : "sectors"}. Index & ETF and No sector are excluded.`,
    fail: (sum, n) => `Tilt sums to ${sum} over ${n} sectors, not zero.`,
    absent: "— · no sector has a market-cap weight",
    hover: "Tilt compares each sector to its weight share, so tilts cancel.",
  }),
  session: Object.freeze({
    label: "Same session",
    pass: (date, tideAt, windowsAt) => `Windows and tide are both from ${date}. Tide at ${tideAt}, windows at ${windowsAt}.`,
    fail: (date) => `Sector tide is from ${date}; outside rows withheld.`,
    absent: "— · no sector tide in this scope",
    hover: "Outside rows need the tide and the windows from one session.",
  }),
  stock: Object.freeze({
    label: "Stock identity",
    absent: "Not checked: open interest is not stored.",
    hover: "Opening less closing trades equals the change in open interest.",
  }),
});

export const CHECKS_HEAD = Object.freeze({ label: "Internal checks", hover: "They test that the figures agree, not that the vendor's data is right." });

export const WITHHELD = Object.freeze({
  ledger: (hash) => `Ledger checks failed; figures withheld; logged as ${hash}.`,
  tilt: (hash) => `Tilt did not sum to zero; tilt withheld; logged as ${hash}.`,
});

export const NOTES = Object.freeze({
  held: Object.freeze({
    text: (h, t) => (t === null ? `${h} windows held; the record does not say how many were shed.` : `${h} of ${t} windows held, ${t - h} shed.`),
    hover: "The live record keeps held windows only; smaller ones are shed.",
  }),
  tide: Object.freeze({
    text: (k) => `Sector tide for ${k} of 13 groups.`,
    hover: "Eleven sectors have a tide; Index & ETF and No sector have none.",
  }),
  rounding: Object.freeze({
    text: (step) => `Shown to ${step}; rows and columns still add up.`,
    hover: "Rounding is adjusted so shown cells add; hover for exact cents.",
  }),
});

export const EMPTY = Object.freeze({
  page: Object.freeze({
    pending: (period) => `Waiting for the first held window of ${period}. The ledger fills in on arrival.`,
    quiet: (period) => `${period} holds no windows, so there is no premium to ledger.`,
    failed: (clock) => `The record was unreadable at ${clock}. No figures are shown rather than old ones.`,
    unavailable: (period, reason) => `${period} is not available: ${reason}`,
  }),
  ledger: Object.freeze({ pending: "No held window yet; the ledger opens with the first.", quiet: "No premium traded in held windows.", failed: "The ledger was not built from the record." }),
  sectors: Object.freeze({ pending: "Sectors appear with the first held window.", quiet: "No sector traded premium in held windows.", failed: "The sector map was not read." }),
  flow: Object.freeze({ pending: "The drawing appears with the first held window.", quiet: "Nothing was paid or received.", failed: "The flows were not built." }),
  tilt: Object.freeze({ pending: "Tilt appears with the first held window.", quiet: "No delta exposure in held windows.", failed: "Delta exposure was not computed." }),
  stock: Object.freeze({ pending: "The memo appears with the first held window.", quiet: "No held window expires this session.", failed: "The memo was not computed." }),
});

export const OVERFLOW = "Total too large to sum exactly.";

export const SCOPE_LINE = Object.freeze({
  all: (money, held, shed, total) => (total === null || shed === 0 ? `${money} traded in ${held} held flagged windows.` : `${money} traded in ${held} held flagged windows. ${shed} of ${total} were shed and are not counted.`),
  sector: (money, n, sector, shed) => `${money} traded in ${n} held flagged ${sector} windows.${shed ? ` ${shed} were shed across all sectors.` : ""}`,
  name: (money, n, name, shed) => `${money} traded in ${n} held flagged ${name} windows.${shed ? ` ${shed} were shed across all names.` : ""}`,
});

export const FLOW_LINES = Object.freeze({
  paid: (m) => `Takers paid ${m} net in held windows.`,
  received: (m) => `Takers received ${m} net in held windows.`,
  even: "Takers paid and received the same in held windows.",
  noside: (m) => `Buyers to sellers: ${m}.`,
  outsidePaid: (m) => `Takers paid ${m} net.`,
  outsideReceived: (m) => `Takers received ${m} net.`,
  outsideEven: "Takers paid and received the same.",
  outsideAbsent: "— · sector tide missing",
  takers: "Takers",
  providers: "Providers",
});

export const TILT_VERDICT = Object.freeze({
  above: Object.freeze({ glyph: "▶", word: "Above share", long: "Above share" }),
  below: Object.freeze({ glyph: "◀", word: "Below share", long: "Below share" }),
  undetermined: Object.freeze({ glyph: "○", word: "Within band", long: "Undetermined" }),
  at: Object.freeze({ glyph: "○", word: "At share", long: "At share" }),
});

export const TILT_LINES = Object.freeze({
  definition: "Tilt is a sector's net delta-dollars minus its market-cap share of the total.",
  total: (n) => `The total covers flagged windows in the ${n} weighted ${n === 1 ? "sector" : "sectors"} only.`,
  reading: "Above share means more long delta than that share; below means less.",
  funds: "Index and fund options are shown but not in the total.",
  shed: (s) => `${s} smaller windows were shed and are outside the tilt.`,
  unweighted: "— · no market-cap weight",
  coverageLow: (pct) => `— · delta for ${pct}% of sided premium, under 80%`,
  noWeight: "— · no sector has a market-cap weight",
  noWindows: "— · no flagged windows in weighted sectors",
});

export const SECTOR_ORDER = Object.freeze([
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services",
  "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities", "Index & ETF", "No sector",
]);

export const PENDING_LINE = "Waiting for the first reading of today's flagged premium.";

export const HERO = Object.freeze({
  lean: Object.freeze({
    head: "Taker share",
    tail: " of held premium",
    pending: "Waiting for the first held window.",
    ask: "Ask side",
    bid: "Bid side",
    unknown: "Side unknown",
    tick: (pct) => `Tick: ${pct}% of premium with a stated side.`,
    noTick: (reason) => `No tick: ${reason}`,
    bar: (say) => `Takers bought ${say} of held premium.`,
    verdict: Object.freeze({
      paid: Object.freeze({ short: "Takers paid more, any split.", long: "In the held windows, takers paid more than they received. This holds for any split of side-unknown premium, if each matched side is right." }),
      received: Object.freeze({ short: "Takers received more, any split.", long: "In the held windows, takers received more than they paid. This holds for any split of side-unknown premium, if each matched side is right." }),
      open: Object.freeze({ short: "Undecided: the range includes 50%.", long: "Undecided: the range includes 50%, so the unknown premium decides which way it falls." }),
      noSides: Object.freeze({ short: "Undecided: every side is unknown.", long: "Undecided: no premium was stated on an ask or bid side." }),
      lowCoverage: Object.freeze({ short: "Undecided: under 40% has a side.", long: "Undecided: under 40% of premium has a stated side." }),
      smallClassified: Object.freeze({ short: "Undecided: under $250k has a side.", long: "Undecided: under $250k of premium has a stated side." }),
    }),
    basis: "Sides come from matching trades to quotes.",
    held: Object.freeze({ shed: (n) => `${n} windows shed from the held set are not counted.`, unrecorded: "The shed count is not recorded." }),
  }),
  cells: Object.freeze({
    held: Object.freeze({ label: "Held premium", line1: (n) => `${n} windows`, line2: (money) => `${money} expires at the session close` }),
    calls: Object.freeze({ label: "Net calls" }),
    puts: Object.freeze({ label: "Net puts" }),
    rangeLabel: "Range",
    range: (lo, hi) => `Range ${lo} to ${hi}`,
    glyph: Object.freeze({ up: "▲", down: "▼", open: "◇", even: "=" }),
    proof: Object.freeze({
      even: Object.freeze({ short: "Net is zero.", long: "Takers paid and received the same amount." }),
      up: Object.freeze({ short: "Sign holds for any split.", long: "Takers paid more, even counting side unknown against them." }),
      down: Object.freeze({ short: "Sign holds for any split.", long: "Takers received more, even counting side unknown against them." }),
      open: Object.freeze({ short: "Undecided: side unknown is as large.", long: "Undecided: side unknown is at least as large as the stated net." }),
    }),
  }),
});

export const STRIP = Object.freeze({
  label: "Data health",
  windows: Object.freeze({ id: "windows", name: "Windows", pending: "waiting for the first read", asOf: (t) => `as of ${t}` }),
  held: Object.freeze({ id: "held", name: "Held set", pending: "not counted yet" }),
  tide: Object.freeze({ id: "tide", name: "Sector tide", pending: "not read yet", asOf: (t) => `as of ${t}`, none: "no sector tide" }),
  poll: Object.freeze({ id: "poll", name: "Last poll", pending: "not read yet" }),
});
