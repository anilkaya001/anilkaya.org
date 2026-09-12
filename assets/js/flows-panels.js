/* =============================================================
   flows-panels.js — the ten panel renderers, and the scaffolding
   they are built on.

   EXTRACTED FROM assets/js/flows-card.js RATHER THAN COPIED INTO A
   SECOND PAGE. These drawers lived inside that file's IIFE, behind a
   guard that returned when `#flowsCard` — the card dialog — was
   absent, so a second page wanting the same charts had two options:
   duplicate 2,003 of its 2,325 lines, or move them here. (2,003 is
   measured, not estimated: that file was 2,325 lines before the
   extraction and 322 after it, and AGENTS.md's allowlist entry cites
   the same pair.) Duplication would mean every future fix to a chart
   made twice, forever — the hazard shared/flows-chain.js names in its
   own header.

   THAT FILE HAS SINCE BEEN DELETED, which is why the extraction was
   worth doing rather than a reason to undo it: the dialog was retired
   for /flows/ticker/, and had these charts still been inside it,
   retiring the modal would have meant rewriting every one of them.
   The `#flowsCard` guard went with it. The ticker page is the one
   caller today; the argument order below is what keeps a second
   caller cheap.

   THE CONTRACT WITH ITS CALLERS. One deliberate global,
   `window.FlowsPanels`, and ONE ARGUMENT ORDER for every renderer in
   it: (host, panel, card, question[, mount]), the last two optional
   and each defaulting to what the drawer hardcoded before.
   flows-ticker.js's DRAW loop calls them all through that one shape,
   so a drawer DECLARING a different order does not fail — it silently
   reads one argument as another, which is how renderOverlay came to
   head itself "[object Object]". renderScore is the one exception,
   called by name because it draws the card's TOP LEVEL, not a panel.

   WHY `mount` EXISTS. SVG `<defs>` ids are document-global, so a page
   that draws one panel twice emits one id twice and the second drawing
   borrows the first's pattern. `mountId`, at the head of the drawers,
   carries the rest of that argument beside the code that acts on it.

   EVERY PANEL IS A TAGGED UNION. The renderer switches on panel.status
   BEFORE touching a number. A missing source must never reach a chart,
   because on a card there is no cross-section to normalise against and a
   fallback zero renders as the most extreme reading the panel can
   produce.
   ============================================================= */
(function () {
  "use strict";

  const DASH = "—";

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* THE MISSING-VALUE TEST COMES BEFORE THE COERCION, and this copy used to
     be the odd one out.

     It read `typeof v === "number" && Number.isFinite(v) ? v : null`, which
     is safe against the confident zero — Number(null) never runs — but it is
     STRICTER than the contract every other surface in this product holds. The
     canonical form (assets/js/flows-ui.js, and numOrNull in shared/) admits a
     numeric STRING, because the vendor quotes several fields that way and the
     pipeline passes some of them through untouched. So one payload field
     rendered as a value on the board and as an em dash in the card panel, for
     the same card, in the same session — the two files disagreeing about what
     "present" means, with nothing failing either way.

     Written out rather than delegated to window.FlowsUI, which is loaded on
     two of the eleven Flows routes against this file's four: the duplication
     is the smaller defect, and the DIVERGENCE was the real one. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  /* ONE MINUS SIGN, U+2212, everywhere on the card. JavaScript's own toFixed
     emits U+002D, which is narrower and sits lower, so a card mixed the two
     within a single numeric column — the money formatter used the typographic
     minus and every other formatter the hyphen. */
  const MINUS = "\u2212";
  const neg = (str) => String(str).replace(/-/g, MINUS);
  const signed = (n, body) => (n < 0 ? MINUS : n > 0 ? "+" : "") + body(Math.abs(n));

  /**
   * Guard once, then format the value THE GUARD RETURNED.
   *
   * Sixteen sites in this file were written as
   * `isNum(x) === null ? DASH : <expression using x>` — they tested one thing
   * and then formatted another. That was harmless only while isNum was the
   * narrow copy that could not coerce; the moment it was aligned with the
   * canonical contract (which admits a numeric string, because the vendor
   * quotes several fields that way) `x.toFixed(2)` on a passing value became
   * a TypeError inside a renderer. A guard whose result is discarded is not a
   * guard, it is a comment with a runtime cost.
   *
   * The em dash is the absence, not a zero: this whole helper exists so a
   * missing reading can never arrive as one.
   */
  const fmtOr = (v, body) => { const n = isNum(v); return n === null ? DASH : body(n); };

  /* THE SIGN AS A CLASS, THREE-WAY, IN ONE PLACE.

     Four call sites in this file each wrote their own two-armed version —
     `x >= 0 ? "is-pos" : "is-neg"` — which tints a reading of exactly zero
     with a side it does not hold. Zero is the centre of the dead band and a
     score this pipeline assigns; it is not a small positive, and it is not an
     absence either, which is what `is-null` and the em dash are for.

     A helper rather than four corrected ternaries, because the version that
     gets forgotten on the next new chart is the one that was never written
     down. `is-flat` is the stylesheet's existing word for this and the
     families that use it carry their own neutral rule, since the base classes
     set `fill: none` or no stroke at all — a path with a polarity class that
     has no rule is not a neutral line, it is an invisible one. */
  /* AND THE ABSENCE TEST IS isNum's, NOT A SECOND ONE WRITTEN HERE. The first
     draft carried its own, spelled `!Number.isFinite(Number(n))` — and
     Number("") is 0, so an empty string arrived as a MEASURED ZERO tinted
     `is-flat`: the confident zero, rebuilt inside the helper written to stop
     two-armed ternaries from doing exactly this. */
  const polarity = (v) => {
    const n = isNum(v);
    return n === null ? "is-null" : n < 0 ? "is-neg" : n > 0 ? "is-pos" : "is-flat";
  };
  const pct = (v) => fmtOr(v, (n) => signed(n, (a) => (a * 100).toFixed(2) + "%"));
  const pct1 = (v) => fmtOr(v, (n) => signed(n, (a) => (a * 100).toFixed(1) + "%"));
  /* THE UNIT IS SPELLED, NOT LETTERED. This printed "2.00σ" until the type
     stack became one family: Latin Modern draws Γ but not σ, so the one
     glyph would have fallen to whatever the platform offered and changed
     width mid-string — beside the number that IS the reading. "2.00 ATR"
     needs no glyph outside the face and names the denominator outright,
     which the notation only implied. */
  const atrDist = (v) => fmtOr(v, (n) => signed(n, (a) => a.toFixed(2) + " ATR"));
  const px2 = (v) => fmtOr(v, (n) => neg(n.toFixed(2)));
  const vol1 = (v) => fmtOr(v, (n) => neg((n * 100).toFixed(1)) + "%");
  // "$-1.23B" prints the sign inside the currency symbol. The minus belongs in
  // front of the whole quantity, which is where a reader scanning a column
  // expects it.
  const money = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : "") + "$" + compact(Math.abs(n));
  };
  /**
   * A magnitude, shortened — WITHOUT throwing away a fifth of it.
   *
   * The thousands branch rounded to whole K: compact(2500) returned "3K",
   * which is 20% high, and compact(1500) returned "2K", 33% high. Every other
   * branch keeps a decimal (2 for billions, 1 for millions) and the smallest
   * one, where the relative cost of rounding is LARGEST, kept none. On a tick
   * label that is a ruler mark that lies about where it is — a gridline drawn
   * at 2,500 with "3K" printed beside it — and the label is the only thing a
   * reader can measure a bar against.
   *
   * One decimal below 10K, none above it, so "9.8K" is precise where it must
   * be and "47K" does not carry a digit nobody reads.
   */
  const compact = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const a = Math.abs(n);
    const s = n < 0 ? MINUS : "";
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e4) return s + (a / 1e3).toFixed(0) + "K";
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "K";
    return s + a.toFixed(0);
  };

  /* Mono character advance, in px per px of font-size divided by 10.

     5.5, AND THE FACE UNDERNEATH IT CHANGED, WHICH IS WHY THE NUMBER DID.
     This was 6.5 against a MONOSPACED face (JetBrains Mono, 0.600 em +
     0.4px letter-spacing = 6.421 measured), where one constant was an exact
     width for every string. Flows is now set in Latin Modern, which is
     proportional, so re-measuring was not optional: a constant fitted to the
     old face is not a small error here, it is a different kind of quantity.

     RE-MEASURED the way the old figure was — getComputedTextLength() / length
     at font-size 10px with letter-spacing 0.4px, in Chromium, on the real
     caption strings — across ten of them:

       "← short  net dealer Γ (log scale)  long →"      4.600
       "strike distance from spot, in ATR(14) units"    4.842
       "implied volatility by moneyness, 30-day"        4.862
       "−0.76 ATR   −0.12 ATR   +1.40 ATR"             5.079   <- widest real
       "WWWWWWWWWWWWWWWWWWWW"                          10.400   <- not a caption

     5.5 is the widest real caption rounded up, +8.3%. The old constant kept
     its own margin the same way (6.421 measured -> 6.5).

     ERRS WIDE ON PURPOSE, AND THE GUARANTEE IS NOW WEAKER — say so rather
     than let the next reader inherit the old sentence. A label estimated too
     narrow collides or leaves the canvas silently; one estimated too wide
     falls back to a shorter form a little sooner, and only the first is a
     defect a reader can see. On a monospaced face that was a true bound for
     ANY string. On a proportional one it is a bound for the strings that
     exist: the 10.400 row above is what an all-caps-W caption would cost, and
     nothing here would catch it. That is tolerable only because these
     captions are a fixed set of English prose written in this repository —
     never user input, never a ticker, never a vendor string. A caption built
     from data that could contain runs of wide capitals must measure itself
     with getComputedTextLength() instead of asking this constant.

     Hoisted to module scope from inside renderGamma when the renderers were
     extracted: it is the only text-metric constant on the page, and a second
     copy of it in a new drawer is a second number to keep in step. Scale it by
     the actual font size rather than using it raw at 9px. */
  const AXIS_CH = 5.5;

  /* ---------- panel scaffolding ----------------------------------- */

  /** A panel that could not be built says so, and shows no numbers. */
  /**
   * A panel whose SOURCE DID NOT ARRIVE.
   *
   * data-empty carries the kind, because a test that has to match on prose to
   * tell two silences apart is a test that breaks on a reworded sentence and
   * passes on a swapped meaning. Every other section in this product tags its
   * empties this way; the card dialog — the most-opened view, and the one a
   * reader consults on a name they are about to trade — was the last surface
   * with no machine-readable tag at all.
   */
  function deadPanel(host, question, reason) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    const note = el("p", "fc-dead");
    note.setAttribute("data-empty", "unavailable");
    note.append(el("strong", null, "Unavailable \u2014 "));
    note.append(document.createTextNode(
      reason || "This panel's data source did not return.",
    ));
    host.append(note);
  }

  /**
   * A panel whose source ARRIVED AND MEASURED NOTHING.
   *
   * The distinction deadPanel could not draw. "Unavailable. no disclosed
   * transactions" shipped on every card: an unavailability heading over a
   * measured-emptiness reason, so a reader could not tell a failed request
   * from a real absence of filings. The word changes, the tag changes, and
   * the sentence is the payload's own — a measured empty is a finding about
   * the market and deserves to be phrased as one.
   */
  function quietPanel(host, question, reason) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    const note = el("p", "fc-quiet");
    note.setAttribute("data-empty", "quiet");
    note.append(el("strong", null, "Nothing to report \u2014 "));
    note.append(document.createTextNode(
      reason || "This panel's source answered and measured nothing.",
    ));
    host.append(note);
  }

  /**
   * Route a non-ok panel to the right silence.
   *
   * ONE PLACE THAT KNOWS THE TAXONOMY. Fourteen call sites shared the guard
   * `if (!panel || panel.status !== "ok") return deadPanel(...)`, which is
   * how every measured emptiness on this card came to be announced as an
   * unavailability. A dispatcher means the next panel added cannot get it
   * wrong by copying its neighbour, which is exactly how the last one did.
   */
  function emptyPanel(host, question, panel, fallback) {
    if (panel && panel.status === "quiet") {
      return quietPanel(host, question, panel.reason || fallback);
    }
    return deadPanel(host, question, (panel && panel.reason) || fallback);
  }

  /**
   * A definition list whose pairs cannot come apart.
   *
   * The stat block was a grid of `repeat(auto-fit, minmax(8rem, 1fr))` with dt
   * and dd as separate children, so six items in five columns wrapped the last
   * dt onto a new row and orphaned its dd under the WRONG label — on every
   * desktop card, silently, because the six-item case only appeared once the
   * panel grew. Wrapping each pair makes the grid item atomic.
   */
  /**
   * @param pairs — [label, value, class, emptyKind, explanation]: the last two
   *   turn an em dash into a reading about the payload, `emptyKind` carrying
   *   the taxonomy's word on data-empty and `explanation` the sentence that
   *   says WHICH silence it is. Callers used to hang those on afterwards with
   *   `stats.querySelector("dd").title`, which reaches the FIRST pair and no
   *   other, so every later withheld figure stayed a bare dash.
   */
  function statList(pairs) {
    const dl = el("dl", "fc-stats");
    for (const [k, v, cls, empty, why] of pairs) {
      const wrap = el("div", "fc-stat");
      wrap.append(el("dt", null, k));
      const dd = el("dd", cls || null, v);
      if (empty) dd.setAttribute("data-empty", empty);
      if (why) dd.title = why;
      wrap.append(dd);
      dl.append(wrap);
    }
    return dl;
  }

  function panelHead(host, question) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    return host;
  }

  /* ---------- the reading first, the method behind a disclosure -------

     THE SPLIT IS NOT BY LENGTH. A note that could change WHAT THE READING
     MEANS stays open as `.fc-note.is-qualifier` — a band narrower than the
     book, a ranking from another session, a column with no unit. A note
     saying HOW THE READING WAS MADE folds, and NOTHING IS EVER DELETED: a
     folded paragraph is still in textContent, so find-in-page still reaches
     it. A rule with only the first half is a rule that hides caveats.

     THE FOLD CAME FROM flows-ticker.js, where the removal note left in its
     place carries the survey that prompted it, the argument for moving it and
     its cost in bytes on each of the four routes this file is drawn on. */
  const NOTE_WALL_CHARS = 420;

  /**
   * A panel's method paragraphs, behind a disclosure once they are a wall.
   *
   * NOT SHORTER, JUST NOT FIRST. Every sentence here is load-bearing — what a
   * shade means, that a quantile is this chart's own and not comparable
   * between names — and a chart whose marks are unexplained is one a reader
   * misreads confidently. But four hundred words of unbroken prose under a
   * chart is a rule nobody finishes, and a rule nobody finishes is a rule
   * nobody was told. A SHORT SET STAYS OPEN: a one-line decoder behind a
   * click is a click for nothing.
   *
   * IT TAKES ELEMENTS, NOT STRINGS, because several callers cannot supply
   * strings — convictionArithmetic below hangs its own class on its paragraph
   * — and re-deriving those branches as strings would put them in two places.
   * flows-ticker.js's appendNotes is the string-shaped adapter over this, and
   * it is the only one.
   */
  /* WHICH NOTES GO BEHIND THE WALL, decided once here rather than argued at
     every call site. A note is METHOD when it says how a reading was built —
     the scaling rule, the units, the summation convention — and folds. A note
     is a QUALIFIER when it could change what the reading MEANS: a withheld
     input, a truncated population, a session date, a horizon that is not the
     panel's, a NOT CLAIMED list. Qualifiers stay open, as `qualifier()` below.
     Folding is never deletion: the node is MOVED, so a folded sentence is
     still in textContent and still found by find-in-page. */
  /**
   * @param always — fold even under the wall. The wall asks "is this enough
   *   text to be worth a disclosure", which is the right question for a caller
   *   that hands over everything it has and lets length decide. A caller that
   *   has ALREADY applied the split rule above has answered the better one, so
   *   its method note folds at any length. The overlay is the first: its three
   *   sentences cleared the wall together, and separating out the two that
   *   must stay open would otherwise have put the third back on the panel.
   */
  function appendMethod(host, nodes, summary, always) {
    const list = (nodes || []).filter(Boolean);
    if (!list.length) return;
    /* THE COUNT IS OF THE TEXT A READER MEETS, punctuation included — the
       wall is a reading-length judgement, not a measurement of the inputs. */
    const chars = list.reduce((n, node) => n + String(node.textContent || "").length, 0);
    if (!always && chars <= NOTE_WALL_CHARS) {
      for (const node of list) host.append(node);
      return;
    }
    const box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary || "How this reading was made"));
    for (const node of list) box.append(node);
    host.append(box);
  }

  /**
   * The panel's finding, first, in the largest type the panel owns. The full
   * argument for the modifier is on `.fc-reading.is-lead` in flows.css.
   *
   * AN ABSENCE LEADS TOO. A withheld reading is a finding about the book and
   * is placed like one; demoting it would make a silence cheaper to ship than
   * a number, which is the one incentive this product cannot afford.
   */
  function leadReading(host, text) {
    const p = el("p", "fc-reading is-lead");
    p.textContent = text;
    host.append(p);
    return p;
  }

  /* A note that qualifies the reading rather than explaining it. Deliberately
     not a helper for the plain `.fc-note` too: four renderers already declare
     a local `const note`, and a module-level one of that name would shadow
     into them. */
  const qualifier = (text) => el("p", "fc-note is-qualifier", text);

  /* ---------- the flagship: gamma profile -------------------------- */

  /**
   * Symlog: linear inside a threshold, logarithmic beyond it.
   *
   * Per-strike dealer gamma spans four or five orders of magnitude within one
   * name. Linear collapses every non-ATM strike to a sub-pixel sliver and the
   * wing structure — where the interesting hedging pressure builds — vanishes.
   * Pure log can represent neither a sign nor a zero, and both are load-bearing
   * here. Symlog is sign-preserving, zero-admitting and monotonic, so the
   * cumulative curve's zero crossing is still drawn at exactly the right place;
   * only magnitude COMPARISON is compressed, which is the trade taken
   * knowingly and declared in the axis note.
   */
  function symlog(tau, vmax, lambda) {
    const lam = lambda === undefined ? 0.35 : lambda;
    const span = vmax > tau ? Math.log10(vmax / tau) : 0;
    return (v) => {
      const a = Math.abs(v);
      const s = v < 0 ? -1 : 1;
      if (a <= tau || span <= 0) return s * (tau > 0 ? lam * (a / tau) : 0);
      return s * (lam + (1 - lam) * (Math.log10(a / tau) / span));
    };
  }

  /**
   * THE VIEWBOX UNIT MUST BE ONE CSS PIXEL, on every panel.
   *
   * A viewBox fixed at 560 units, emitted with width="100%", is scaled by the
   * browser to whatever the container is — and it scales the TEXT with it.
   * Measured at a 320px viewport, where the card dialog's inner width was 288:
   * the factor is 288/560 = 0.514, so a 9px axis label renders at 4.6 CSS px
   * and a 10.5px one at 5.4. Unreadable, silently, because nothing overflows.
   *
   * THE CEILING WAS THE CARD DIALOG'S 760, AND IT STOPPED BEING RIGHT THE
   * MOMENT A SECOND SURFACE DREW THESE PANELS. Against it: a /flows/ticker/
   * is-wide panel at a 1280px viewport gets a 958px host, so width:100%
   * stretched the drawing by 1.261 and every 9px label rendered at 11.3. The
   * card dialog's own 777.6px host bound it too, by 17.6px — a 1.023 stretch
   * that sat inside the suite's old tolerance and was never caught.
   *
   * 1900 IS THE WIDEST HOST THE GRID CAN PRODUCE: a full-row .is-wide at the
   * three-column tier, just below the four-column breakpoint, is viewport
   * 2111 - 13rem rail - 2x2.5rem pad = 1823px.
   *
   * NEITHER BOUND IS COSMETIC: outside them the SVG keeps its viewBox and
   * width:100% rescales it, so the axis type moves with the drawing and
   * nothing overflows to say so. The ticker suite asserts the drawn width at
   * 320, 1280 and 1840px, to within a pixel, and caught both directions.
   *
   * ONE FUNCTION, NOT FOUR, WHICH IS WHAT IT WAS. renderGamma, renderPath and
   * flows-ticker.js's renderSkewTerm each measured their own host before this
   * existed; each call site now says what its inlined clamp cost. N width
   * policies is N answers to "how wide is this chart", on panels drawn by two
   * controllers that must agree to a pixel.
   */
  function panelWidth(host) {
    /* THE FLOOR IS FOR AN UNMEASURABLE HOST, NEVER A NARROW ONE, and it was
       applied to both: `Math.max(300, …)` drew 300 units into the 282px host
       a 320px viewport gives this page, so base.css's `max-width: 100%` shrank
       all twelve charts to 0.940 CSS px per unit and a phone got 8.5px type
       from a 9px drawing. Same invariant as the cap above, same silence, other
       direction — and 0.94 sat inside the suite's old band as the dialog's
       1.023 did.

       FLOORED, AND FROM THE BOX. clientWidth is pre-rounded and rounds up half
       the time, so a 282.6px host reads 283 and the drawing overflows by a
       subpixel; floor() of the fractional box can only be narrower. 560 is for
       a host with no layout at all — detached, display:none — the one case a
       number must be invented. */
    const box = host && typeof host.getBoundingClientRect === "function"
      ? host.getBoundingClientRect().width : 0;
    const measured = Math.floor(box > 0 ? box : ((host && host.clientWidth) || 0));
    if (!(measured > 0)) return 560;
    return Math.min(1900, measured);
  }

  /** A round tick interval at or just below `raw`: 1, 2, 2.5 or 5 times a power of ten. */
  function niceStep(raw) {
    if (!(raw > 0)) return 0;
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [5, 2.5, 2, 1]) if (m * e <= raw) return m * e;
    return e;
  }

  function quantileAbs(values, q) {
    const s = values.map(Math.abs).sort((a, b) => a - b);
    if (!s.length) return 0;
    const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
    return s[i];
  }

  /**
   * Suffix an SVG <defs> id with the mount it belongs to.
   *
   * SVG IDS ARE DOCUMENT-GLOBAL AND url(#id) TAKES THE FIRST MATCH IN
   * DOCUMENT ORDER. With the dialog the only surface drawing these panels a
   * bare id was safe; /flows/ticker/ holds a grid copy and an enlarged copy
   * at once — two <pattern id="gpNeg"> in one document — and the second
   * drawing silently borrows the first's tile. The two tiles are identical
   * today so it happens to look right; the moment one scales with its drawing
   * it is wrong and NOTHING LOOKS WRONG. The default keeps every existing
   * caller byte-identical.
   */
  const mountId = (base, mount) => (mount ? base + "-" + mount : base);

  const AXES = [
    { k: "F", signed: true, label: "Flow", blurb: "net directional delta, premium tilt, aggressor volume and open-interest change — every column a ratio, so the column ranks flow rather than market capitalisation" },
    { k: "P", signed: true, label: "Positioning", blurb: "where today's flow is building dealer gamma relative to where the standing book already is, in ATR units" },
    { k: "D", signed: true, label: "Path", blurb: "how the day accumulated — steady work against the tape, or one spike already in the price" },
    { k: "V", signed: false, label: "Vol regime", blurb: "how rich options are against delivered vol, where 30-day IV sits in its own year, and whether it is rising" },
    { k: "O", signed: false, label: "Quality", blurb: "the multiplier this name earned: directional share of the tape, near-money rather than lottery, direction rather than vol, and dealer gamma at spot" },
  ];

  /**
   * The decomposition.
   *
   * THREE SIGNED AXES AND TWO GAUGES, drawn differently on purpose. F, P and D
   * carry a direction and are drawn from a centre origin; V and O carry none
   * and are drawn as left-origin gauges, because putting an unsigned quantity
   * on a signed axis is exactly the confusion that let unsigned magnitudes into
   * the composite in the first place. A gauge at zero is a real reading; a
   * signed axis at null is an absent one, and those must not look alike.
   */
  /**
   * How the three terms become the one number, checked before it is claimed.
   *
   * THE PANEL SHOWED THE PARTS AND NEVER THE ARITHMETIC. A reader could see
   * agreement 67%, sources 5 of 5 and persistence 56% beside a conviction of
   * 76 and had no way to combine them — the weights lived only in
   * shared/flows-features.js. So the composite was, in practice, an opaque
   * number with three suggestive numbers under it.
   *
   * THE WEIGHTS COME FROM THE PAYLOAD, NEVER FROM A COPY HERE. Restating
   * 0.45/0.35/0.20 in this file would be a second copy of a constant that has
   * already moved once, and on the day it moves again this page would describe
   * arithmetic the pipeline did not do — the sector-momentum defect exactly,
   * in prose instead of in a field name.
   *
   * AND IT IS VERIFIED BEFORE IT IS SHOWN. If the terms do not reconstruct the
   * published conviction, the line is not drawn: an identity that does not hold
   * is worse than no identity, because it invites a reader to trust a
   * derivation the numbers do not support. A card from before these fields
   * were published simply has no persistence and lands here too.
   */
  function convictionArithmetic(host, card, conv) {
    const w = conv.weights;
    if (!w || typeof w !== "object") return;
    const a = isNum(conv.agreement), c = isNum(conv.coverage), pn = isNum(conv.persistence);
    const wa = isNum(w.agreement), wc = isNum(w.coverage), wp = isNum(w.persistence);
    const published = isNum(card.conviction);
    if (a === null || c === null || pn === null ||
        wa === null || wc === null || wp === null || published === null) return;

    const recon = Math.round(100 * (wa * a + wc * c + wp * pn));
    if (recon !== published) return;

    const pct = (x) => Math.round(x * 100) + "%";
    const term = (weight, value) => pct(weight) + " of " + pct(value);
    const note = el("p", "fc-note fc-conv-math");
    note.append(document.createTextNode(
      "Conviction " + published + " is " + term(wa, a) + " agreement, plus " +
      term(wc, c) + " source coverage, plus " + term(wp, pn) + " persistence. " +
      /* THE SHAPE OF THE DOMINANT TERM, because it is what makes two nearby
         convictions mean different things. Agreement is agree-over-present
         across at most three signed axes, so it can only be 33%, 67% or 100%
         — a category, carrying the heaviest weight. Two names ten points
         apart may sit in the same category and differ only in coverage, or
         sit in different ones; the composite alone does not say which. */
      "Agreement is a COUNT — how many of the signed axes point the same way, out of the " +
      "ones that were measured at all — so it moves in steps and never smoothly, and it " +
      "carries the heaviest of the three weights. Two names a few points apart on this " +
      "number may differ by a whole axis, or by nothing but coverage."));
    /* THE ARITHMETIC OF A PUBLISHED NUMBER IS METHOD, so it folds by the rule
       at NOTE_WALL_CHARS. "Conviction 81 is 45% of 67% agreement, plus 35% of
       100% source coverage, plus 20% of 78% persistence" is how the figure in
       the stat list above was made; the reader who wants to check the weights
       opens it, and the reader who wants the score does not scroll past a
       paragraph to reach the next card. `always`, because this panel has
       already sorted its own notes and its length should not decide. */
    appendMethod(host, [note], "How conviction was computed", true);
  }

  /**
   * The daily-close score laid over the price it was scored against.
   *
   * TWO PAYLOADS, ONE CHART, AND THE JOIN IS THE HARD PART. The card carries
   * a dated price window; `scoretrack` carries a dated score history. Both are
   * about forty points and both run oldest first, so zipping them by position
   * produces a chart that looks right and is fiction. shared/flows-overlay.js
   * does the join by date and this function only draws what it returns.
   *
   * THE SCORE AXIS IS FIXED AT PLUS OR MINUS ONE HUNDRED, not scaled to the
   * name. The score's unit is fixed by construction — that is the whole point
   * of the bounded tanh — so a scaled axis would make a name that never left
   * plus-or-minus fifteen look exactly like one that swung to the rail, and
   * two names on two screens would stop being comparable. A flat line near the
   * middle is the honest picture of a name that did not move.
   *
   * THE PRICE AXIS IS SCALED TO THE WINDOW, because price has no fixed range
   * and no meaningful zero. The two lines crossing therefore means nothing,
   * which the note says out loud: they share only the date axis.
   */
  /**
   * WHAT CHANGED — derived from the same joined rows the overlay draws.
   *
   * THE PAGE LED ON A SNAPSHOT AND THE PRODUCT IS AN EARLY WARNING. Twenty-one
   * panels described one session in enormous detail and NOTHING on the page
   * said what the number had just done: no move against the previous scored
   * session, no run length, no crossing of the dead band, no note that the
   * newest reading was three sessions old. A reader could not tell a name that
   * had just cleared the band from one that had been sitting outside it for a
   * month, which is the single distinction this product exists to draw.
   *
   * WHY IT IS DERIVED HERE AND NOT FETCHED. The `scoretrack` payload publishes
   * d1/run/ext/lastAt per name and is the RIGHT home for this arithmetic — it
   * is computed once, in the pipeline, against the track's own session
   * calendar. But the card already carries `panels.scoreOverlay.rows`: the
   * dated score joined onto the dated close, built by shared/flows-overlay.js
   * and already on the wire. Fetching the track from this page would spend a
   * second read on every ticker view to recompute what is in the payload the
   * page has already parsed. So: derived from the card, and the derivation
   * lives here beside the renderer that draws the same rows rather than inside
   * the controller, so a test can call it on a staged payload.
   *
   * THE ONE THING THIS CANNOT SAY, and the renderer must not pretend it can:
   * `gap` counts sessions of the JOINED window — the sessions the card's price
   * window and the score archive have in common — not sessions of the track's
   * own calendar. Where the price window is shorter, a gap of 2 here can be a
   * gap of 2 there or fewer. The sentence beside it names the window.
   *
   * @param {object} join `card.panels.scoreOverlay`, in any of its states.
   * @returns a tagged union: unavailable / quiet / ok. Never a number on its own.
   */
  function changeFrom(join) {
    /* THE THREE SILENCES, told apart before a number is touched. `undefined`
       is a card built before the overlay panel existed; "unavailable" is the
       pipeline declining, with its own reason; "quiet" is both windows read
       in full and found disjoint, which is an ordinary state for a name new
       to the board. One generic "no data" would collapse all three. */
    if (join === undefined || join === null) {
      return { status: "unavailable",
        reason: "this card was built before the score overlay existed, so it carries " +
          "no score history to measure a move against" };
    }
    if (join.status !== "ok") {
      return { status: join.status === "quiet" ? "quiet" : "unavailable",
        reason: join.reason ||
          (join.status === "quiet"
            ? "the score archive and this card's price window share no session"
            : "the score history for this name was not published on this card") };
    }

    const rows = Array.isArray(join.rows) ? join.rows : [];
    const scored = [];
    for (let i = 0; i < rows.length; i++) {
      if (isNum(rows[i] && rows[i].score) !== null) scored.push(i);
    }
    if (!scored.length) {
      return { status: "quiet",
        reason: "not one of the " + rows.length + " sessions this card shares with the " +
          "score archive carries a score for this name" };
    }

    const window = {
      sessions: rows.length,
      from: rows[0].d,
      to: rows[rows.length - 1].d,
      scored: scored.length,
    };
    const iAt = scored[scored.length - 1];
    const at = { i: iAt, d: rows[iAt].d, score: isNum(rows[iAt].score) };
    /* THE STALENESS COUNT, which is `lastAt` stated as a distance. Zero means
       the newest session in the window scored this name; anything else means
       the reading below is not about the latest session and a page leading on
       CHANGE has to say so before it says anything else. */
    const stale = rows.length - 1 - iAt;

    let prior = null, d1 = null;
    if (scored.length >= 2) {
      const iPrior = scored[scored.length - 2];
      prior = { i: iPrior, d: rows[iPrior].d, score: isNum(rows[iPrior].score) };
      d1 = {
        v: at.score - prior.score,
        /* ALWAYS BESIDE THE DELTA. A move of +23 over one session and the same
           +23 over five — with the name absent from the board in between — are
           different facts, and a delta printed without its gap is the exact
           defect this layer replaced. */
        gap: iAt - iPrior,
        from: prior.d, to: at.d,
      };
    }

    /* THE RUN, on the CURRENT SIGN. A run of 1 is a new opinion; 30 is an old
       one. Zero is its own answer: the newest score is exactly zero, which is
       the centre of the dead band and a reading this pipeline assigns — not a
       run of length zero on some side. */
    let run = 0, runBroken = false, runCapped = false;
    if (at.score === 0) {
      run = 0;
    } else {
      const sign = at.score < 0 ? -1 : 1;
      let i = iAt;
      for (;;) {
        run++;
        if (i === 0) { runCapped = true; break; }
        const prevV = isNum(rows[i - 1].score);
        /* AN UNSCORED SESSION ENDS THE RUN RATHER THAN BEING STEPPED OVER.
           Claiming six consecutive sessions across a day nobody scored would
           be a continuity nothing measured — the same refusal the overlay
           line makes when it breaks at a gap instead of bridging it. */
        if (prevV === null) { runBroken = true; break; }
        if ((prevV < 0 ? -1 : prevV > 0 ? 1 : 0) !== sign) break;
        i--;
      }
    }

    let hi = null, hiAt = null, lo = null, loAt = null;
    for (const i of scored) {
      const v = isNum(rows[i].score);
      if (hi === null || v > hi) { hi = v; hiAt = rows[i].d; }
      if (lo === null || v < lo) { lo = v; loAt = rows[i].d; }
    }

    /* THE DEAD BAND IS THE BOARD'S MEMBERSHIP RULE, so crossing it is the
       event: a name that has just left the band became actionable this
       session, and one that has just entered it is the exit signal. Without a
       published band neither can be stated, and the renderer says THAT rather
       than quietly reporting no crossing — "we cannot tell" and "it did not
       happen" are different sentences. */
    const band = isNum(join.deadBand);
    const bandKnown = band !== null && band >= 0;
    const insideOf = (v) => Math.abs(v) <= band;
    let cross = null;
    if (bandKnown && prior) {
      const wasIn = insideOf(prior.score), isIn = insideOf(at.score);
      if (wasIn && !isIn) cross = "cleared";
      else if (!wasIn && isIn) cross = "faded";
      else if (!wasIn && !isIn && Math.sign(prior.score) !== Math.sign(at.score)) cross = "flipped";
    }

    return {
      status: "ok",
      window, at, prior, d1, stale,
      run, runBroken, runCapped,
      ext: { hi, hiAt, lo, loAt },
      band: bandKnown ? band : null,
      inside: bandKnown ? insideOf(at.score) : null,
      cross,
      crossKnown: bandKnown && !!prior,
    };
  }

  /* THE FILE'S CALL SHAPE, AND THIS DRAWER WAS THE ONE EXCEPTION TO IT.

     It was declared `(host, join, questionIn)` where every other renderer
     takes (host, panel, card, questionIn[, mount]) — renderLevels and
     renderDisplacement both accept a `card` they never read. DRAW calls them
     all as `drawer(host, panel, card, question, mount)`, on its own argument
     that "the widest signature is safe for all of them", which holds only
     while every drawer DECLARES the same order. Here the card landed in
     `questionIn`, so the "Score over price" panel headed itself with
     String(card) — "[object Object]" — on every ticker page, for every name,
     for as long as the panel has been mounted. */
  function renderOverlay(host, join, card, questionIn) {
    const question = questionIn ||
      "How has this name\u2019s daily score moved against its own price?";
    if (!join || join.status !== "ok") return emptyPanel(host, question, join);
    panelHead(host, question);

    const rows = Array.isArray(join.rows) ? join.rows : [];
    if (rows.length < 2) {
      return quietPanel(host, question,
        "one session is a dot, not a history — this name and its scores share " +
        (rows.length === 1 ? "exactly one session" : "no session") + " so far.");
    }

    /* 132, DOWN FROM 190. The panel is a dense card on a page a reader wants
       whole, and the score is now drawn as bars against a marked zero — a bar
       chart reads its sign and its magnitude at a height a line needs slope
       room for. The price line loses amplitude with it, which is the right
       trade: the price is CONTEXT on this panel and the units note has always
       said the two cannot be compared by height. */
    const W = panelWidth(host), H = 132, padL = 4, padR = 4, padT = 10, padB = 18;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    let lo = Infinity, hi = -Infinity;
    for (const r of rows) { if (r.close < lo) lo = r.close; if (r.close > hi) hi = r.close; }
    const span = hi - lo || 1;
    const xOf = (i) => padL + (i / (rows.length - 1)) * plotW;
    const yPrice = (v) => padT + (1 - (v - lo) / span) * plotH;
    /* SYMMETRIC ABOUT ZERO, AND NO LONGER FIXED AT ±100.

       The full ±100 domain was right for a LINE: the zero sat at the exact
       middle on every name and two panels could be compared without reading
       an axis. Drawn as BARS it is wrong, and the first render said so — a
       name scoring +9 to +16 got bars four pixels tall sitting on the zero
       line, which reads as a dashed rule rather than as a chart. Most names
       are not extreme, so most panels showed nothing.

       THE DOMAIN IS THE NAME'S OWN EXTENT, FLOORED AT 25. Zero stays centred
       and the scale stays symmetric, so the sign still reads off the axis and
       the dead band is still drawn in place. The floor is what stops a quiet
       name being amplified into drama: a name whose scores never leave ±3
       draws against ±25 and looks like the small readings they are, rather
       than filling the panel.

       AND THE DOMAIN IS PRINTED, in the stat list below, because losing
       cross-name comparability silently would be the worse trade. A reader
       holding two panels can now see in one figure whether they share a
       scale. */
    let peak = 0;
    for (const r of rows) {
      const v = isNum(r.score);
      if (v !== null && Math.abs(v) > peak) peak = Math.abs(v);
    }
    const scoreMax = Math.min(100, Math.max(25, Math.ceil(peak)));
    const yScore = (v) => padT +
      (1 - (Math.max(-scoreMax, Math.min(scoreMax, v)) + scoreMax) / (2 * scoreMax)) * plotH;

    const svg = svgEl("svg", {
      class: "ovl", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      /* One viewBox unit is one CSS pixel — `meet` with a matching height
         takes the smaller of the two scales, which is 1. `none` would scale
         the axes independently and distort every slope on the panel. */
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    /* THE DEAD BAND, drawn first so both lines sit over it. It is a band in
       SCORE units and it is what the board's membership rule is stated in, so
       a score line inside it is a name the board would not have ranked. */
    const band = isNum(join.deadBand);
    if (band !== null && band > 0) {
      svg.append(svgEl("rect", {
        class: "ovl-band", x: padL, width: plotW,
        y: yScore(band), height: Math.max(1, yScore(-band) - yScore(band)),
      }));
    }
    svg.append(svgEl("line", {
      class: "ovl-zero", x1: padL, x2: W - padR, y1: yScore(0), y2: yScore(0),
    }));

    /* Price first, score over it: the score is the reading this page is about
       and the price is the context it is read against. */
    svg.append(svgEl("path", {
      class: "ovl-px",
      d: rows.map((r, i) => (i ? "L" : "M") + xOf(i).toFixed(1) + " " + yPrice(r.close).toFixed(1)).join(" "),
    }));

    /* THE SCORE IS BARS FROM ITS OWN ZERO, NOT A SECOND LINE.

       A bar chart is what this quantity actually is: bounded, signed, and
       measured once per session with nothing between two sessions to
       interpolate. The line it replaced had three defects a rect does not
       have, and each was patched in code that this change deletes:

         - A GAP HAD TO BE PROGRAMMED. A run of scored sessions was one
           subpath and a null ended it, because bridging would draw a score on
           a day nobody scored and a zero would be worse still — zero is
           NEUTRAL, a reading this system publishes and defends. A session
           with no score now simply has no bar. The refusal is structural:
           there is nothing to bridge.
         - A LONE SCORED SESSION BETWEEN TWO GAPS DREW NOTHING. A one-point
           subpath has no length and renders as empty, which is a measured
           score disappearing off a chart; it needed a hand-placed dot. A lone
           bar is a bar like any other.
         - TWO LINES INVITED A CROSSING. The units note has always had to end
           by saying that the two crossing means nothing at all, because two
           strokes on one date axis look like two comparable series. Bars
           against a marked zero beside a price LINE are visibly two different
           kinds of object, and the note is shorter for it.

       THE BARS ARE GROUPED, and the group keeps the class the suite and the
       stylesheet already know. A minimum height of 0.8 keeps a score of zero
       — a real measurement, and the centre of the dead band — from rendering
       as no bar at all, which would make it indistinguishable from the
       unscored session next to it. */
    const step = rows.length > 1 ? plotW / (rows.length - 1) : plotW;
    const barW = Math.max(1, Math.min(9, step * 0.62));
    const bars = svgEl("g", { class: "ovl-score" });
    const zeroY = yScore(0);
    let drawn = 0;
    for (let i = 0; i < rows.length; i++) {
      const v = isNum(rows[i].score);
      if (v === null) continue;
      const y = yScore(v);
      drawn++;
      bars.append(svgEl("rect", {
        class: "ovl-bar" + (v < 0 ? " is-neg" : v > 0 ? " is-pos" : " is-zero"),
        x: (xOf(i) - barW / 2).toFixed(1), width: barW.toFixed(1),
        y: Math.min(y, zeroY).toFixed(1),
        height: Math.max(0.8, Math.abs(zeroY - y)).toFixed(1),
      }));
    }
    if (drawn) svg.append(bars);
    const segments = drawn;

    const first = rows[0], last = rows[rows.length - 1];
    svg.setAttribute("aria-label",
      join.overlap + " sessions from " + first.d + " to " + last.d + ", " +
      "price from " + px2(first.close) + " to " + px2(last.close) + ", " +
      "score from " + (isNum(first.score) === null ? "unscored" : first.score) +
      " to " + (isNum(last.score) === null ? "unscored" : last.score) + "." +
      (join.gaps ? " " + join.gaps + " session" + (join.gaps === 1 ? "" : "s") +
        " in that window carry no score and are drawn as no bar at all." : ""));
    host.append(svg);

    /* THE CURSOR READS THE ROWS THE MARKS WERE DRAWN FROM, which is the whole
       reason it cannot disagree with them: `xOf(i)` is the same function that
       placed the price vertex and the score bar, and the values are the same
       `rows[i]`. A cursor that re-derived either would be a second opinion
       about one series.

       AN UNSCORED SESSION SAYS SO RATHER THAN PRINTING A ZERO. The bar for it
       was deliberately not drawn — this panel's own comment explains that a
       zero "would be worse still" — so the readout keeps that distinction
       instead of quietly filling the gap the drawing refuses to fill.

       THE RULE IS BOUNDED TO THE PLOT so it does not run down through the date
       axis, and the chart's aria-label above already says what it is; the
       cursor adds the per-point reading a static chart withholds. */
    if (window.FlowsCursor && rows.length) {
      window.FlowsCursor.attach(svg, {
        name: "Score against price",
        band: { y0: padT, y1: padT + plotH },
        points: rows.map((r, i) => {
          const sc = isNum(r.score);
          return {
            x: xOf(i),
            label: r.d,
            rows: [
              { k: "Close", v: px2(r.close) },
              { k: "Score", v: sc === null ? "unscored" : (sc > 0 ? "+" : "") + sc,
                cls: sc === null ? "" : sc > 0 ? "is-pos" : sc < 0 ? "is-neg" : "" },
            ],
          };
        }),
      });
    }

    host.append(statList([
      ["Shared sessions", String(join.overlap)],
      ["From", first.d],
      ["To", last.d],
      ["Scored", join.scored + " of " + join.overlap],
      ["Dead band", band === null ? DASH : "±" + band],
      /* THE SCALE THE BARS ARE DRAWN AGAINST. It is the name's own extent
         floored at 25, not a constant, so two panels are only comparable by
         height when this figure matches on both. Stating it is what makes the
         adaptive domain honest rather than a silent rescale. */
      ["Scale", "±" + scoreMax + " score points"],
    ]));

    /* WHAT THE OVERLAP LEFT OUT, in both directions and as counts. "23
       sessions" under a card that says "42 daily closes" reads as lost data
       until the reason is beside it. */
    const outside = [];
    if (isNum(join.priceOnly) && join.priceOnly > 0) {
      outside.push(join.priceOnly + " session" + (join.priceOnly === 1 ? "" : "s") +
        " of price with no score for this name");
    }
    if (isNum(join.scoreOnly) && join.scoreOnly > 0) {
      outside.push(join.scoreOnly + " scored session" + (join.scoreOnly === 1 ? "" : "s") +
        " with no close on this card");
    }
    /* THE PANEL'S OWN SPLIT RULE, FINALLY APPLIED HERE. This was ONE
       paragraph of three unrelated sentences and the largest block of text on
       the ticker page, which is what made the card too big to take in. The
       rule at NOTE_WALL_CHARS says which of the three may fold:

         OPEN — the population and what it left out ("drawn over the 23
         sessions the two windows share; outside it, 19 of price with no
         score"): the qualifier case by the letter of the rule.
         OPEN — the units, since separate scales and no comparison by height
         is a thing that changes what the drawing MEANS.
         FOLDS — the join ("matched by session date, not zipped by position")
         is HOW the series were brought together, and is the longest.

       Nothing is deleted: appendMethod MOVES the node, so the sentence is
       still in textContent for a find-in-page, which the suite asserts. */
    const notes = (join.notes || {});
    host.append(el("p", "fc-note is-qualifier ovl-note",
      (outside.length
        ? "Drawn over the " + join.overlap + " sessions the two windows share. Outside it: " +
          outside.join(", ") + ". "
        : "The two windows cover the same " + join.overlap + " sessions exactly. ") +
      (notes.axes || "")));
    if (notes.join) {
      appendMethod(host, [el("p", "fc-note ovl-join", notes.join)],
        "How the two series were joined", true);
    }

    if (join.gaps > 0) {
      host.append(el("p", "fc-note ovl-gaps",
        join.gaps + " of these " + join.overlap + " sessions carry no score for this name. " +
        (notes.gap || "")));
    }
    if (segments === 0) {
      const dead = el("p", "fc-note ovl-none",
        "No session in the shared window carries a score for this name, so only the " +
        "price line is drawn and there are no bars.");
      dead.setAttribute("data-empty", "quiet");
      host.append(dead);
    }
  }

  /**
   * The score as a POSITION, which is the one thing the digit cannot say.
   *
   * THE NUMBER IS ALREADY ON THIS PAGE — the hero states it and this panel's
   * own stat list repeats it — so a gauge that only restated it would be a
   * third copy of one sentence. What it adds is the SCALE: this score is
   * bounded to ±100, and until now that bound was stated in exactly one
   * place, a closing sentence inside the score-over-price note. A reader
   * seeing "+16" had nothing on the page telling them whether that is most of
   * the range or a rounding error in it. The arc says so by construction.
   *
   * THE ENDS ARE LABELLED, THE MARKER IS NOT. "Bearish" and "Bullish" sit at
   * the ends as AXIS LABELS — they name what the left and right of the scale
   * mean, the same job "$10" and "$60" do on a price axis. The verdict word
   * for THIS name stays in the hero, which owns it; printing it again here
   * would be the copy this file's own rule refuses, and a copy is the thing
   * that drifts.
   *
   * NO DEAD BAND IS DRAWN, because the card does not publish one at this
   * level — it reaches the page inside the overlay panel's join, and a band
   * this function guessed at would be a free parameter dressed as a
   * measurement. So the arc is a scale and not a verdict, and a score of 0
   * sits at the top of it as the real reading it is rather than as a side.
   *
   * AND AN ABSENT SCORE DOES NOT POINT AT ZERO. The marker is withheld
   * entirely when there is nothing to place, because a needle standing
   * straight up is the most confident thing this drawing can do and "no score
   * was published" is the opposite of confident.
   */
  const GAUGE_MAX = 100;
  function scoreGauge(host, card) {
    const score = isNum(card.score);
    /* SIZED FROM THE HOST, THROUGH panelWidth, LIKE EVERY OTHER DRAWING HERE.

       THE FIRST DRAFT HARD-CODED 128x78 and the ticker suite refused it in
       one line: "a span-1 panel at least doubles when enlarged (128 to 128)".
       A fixed viewBox makes the enlarge button a no-op — the dialog hands the
       drawing ~1100px of host and the gauge kept drawing 128 of it — which is
       the one thing that button exists not to do. Going through panelWidth
       rather than reading clientWidth here also buys the floor and the
       rounding rule that helper's own comment argues for, instead of a
       seventh answer to "how wide is this chart". */
    const W = panelWidth(host);
    /* The radius is capped so a 1900px dialog does not draw a half-circle
       taller than the screen, and floored so a 282px phone still gets an arc
       whose ends are distinguishable. Between those it tracks the host, so
       enlarging genuinely enlarges. */
    const R = Math.max(46, Math.min(150, W * 0.3));
    const SW = R * 0.17;
    const CX = W / 2, CY = R + SW / 2 + 2, H = CY + 4;
    /* Polar on the upper half: -100 is due left, +100 due right, 0 straight
       up. One conversion, used by the arc ends and by the marker, so the
       scale the segments draw and the scale the marker lands on cannot
       disagree. */
    const pt = (v) => {
      const a = Math.PI * (1 - (v + GAUGE_MAX) / (2 * GAUGE_MAX));
      return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
    };
    const arc = (from, to, cls) => {
      const [x1, y1] = pt(from), [x2, y2] = pt(to);
      return svgEl("path", {
        class: cls, "stroke-width": SW.toFixed(2),
        d: "M" + x1.toFixed(2) + " " + y1.toFixed(2) +
          "A" + R.toFixed(2) + " " + R.toFixed(2) + " 0 0 1 " +
          x2.toFixed(2) + " " + y2.toFixed(2),
      });
    };

    const box = el("div", "fc-gauge" + (score === null ? " is-null" : ""));
    /* The number sits over the arc's mouth and the end labels under its ends,
       so both are positioned from the radius rather than from a constant that
       would only be right at one width. */
    box.style.setProperty("--gauge-lift", (R * 0.52).toFixed(1) + "px");
    box.style.setProperty("--gauge-w", (2 * R).toFixed(1) + "px");
    const svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H.toFixed(2), width: W, height: H.toFixed(2),
      preserveAspectRatio: "xMidYMid meet", role: "img",
      "aria-label": "Options score on a scale from " + MINUS + GAUGE_MAX +
        ", most bearish, to +" + GAUGE_MAX + ", most bullish" +
        (score === null ? " \u2014 no score published for this name" : ""),
    });
    /* Three segments rather than a gradient: a gradient invites reading a
       colour as a value, and only the marker carries a value here. */
    svg.append(arc(-GAUGE_MAX, -GAUGE_MAX / 3, "fc-gauge-a is-neg"));
    svg.append(arc(-GAUGE_MAX / 3, GAUGE_MAX / 3, "fc-gauge-a is-flat"));
    svg.append(arc(GAUGE_MAX / 3, GAUGE_MAX, "fc-gauge-a is-pos"));

    if (score !== null) {
      /* CLAMPED, AND THE CLAMP IS VISIBLE. The scorer bounds to +/-100, so a
         value outside it is a payload this drawing cannot represent; it is
         pinned to the end and marked, never silently folded back inside. */
      const at = Math.max(-GAUGE_MAX, Math.min(GAUGE_MAX, score));
      const [mx, my] = pt(at);
      const inset = R * 0.26;
      const [ix, iy] = [CX + (R - inset) * (mx - CX) / R, CY + (R - inset) * (my - CY) / R];
      svg.append(svgEl("line", {
        class: "fc-gauge-n " + polarity(score), "stroke-width": (SW * 0.42).toFixed(2),
        x1: ix.toFixed(2), y1: iy.toFixed(2), x2: mx.toFixed(2), y2: my.toFixed(2),
      }));
      if (at !== score) svg.append(svgEl("circle", {
        class: "fc-gauge-clip", cx: mx.toFixed(2), cy: my.toFixed(2), r: (SW * 0.4).toFixed(2) }));
    }
    /* NO CURSOR HERE, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.

       Every other drawing in this section encodes a SERIES, where the value
       at a given point is recoverable only by measuring pixels against an
       axis — which is the whole case for the shared cursor. This dial
       encodes ONE observation, and the box it sits in prints that number
       over the arc's mouth with the scale's ends labelled beneath. A cursor
       would step through a list of length one and announce a figure already
       on screen an inch above it.

       Said in the markup rather than left to be rediscovered: the preview
       harness counts drawings against cursors, and without this attribute
       that census reports a working panel as unfinished work every time it
       runs. `face` means the drawing prints its own reading. */
    svg.dataset.fxRead = "face";
    box.append(svg);

    const read = el("div", "fc-gauge-read");
    const v = el("b", "fc-gauge-v " + (score === null ? "is-null" : polarity(score)),
      score === null ? DASH : score > 0 ? "+" + score : score < 0 ? MINUS + Math.abs(score) : "0");
    read.append(v);
    read.append(el("span", "fc-gauge-scale",
      score === null ? "no score published for this name"
        : "of " + MINUS + GAUGE_MAX + " to +" + GAUGE_MAX));
    box.append(read);

    /* THE ENDS CARRY THE WORDS AND NOT THE NUMBERS. Both were here in the
       first draft — "Bearish -100" and "+100 Bullish" — which put the bounds
       on the page twice, two lines apart, and at the gauge's real width the
       two labels ran into each other into "Bearish -100+100 Bullish". The
       line above states the bounds; these name what the ends MEAN. */
    const ends = el("div", "fc-gauge-ends");
    ends.append(el("span", null, "Bearish"));
    ends.append(el("span", null, "Bullish"));
    box.append(ends);
    if (score === null) box.setAttribute("data-empty", "unavailable");
    host.append(box);
  }

  function renderScore(host, card, questionIn) {
    const question = questionIn || "Why is this name on the board, and how much of the score came from where?";
    if (!card.fam) return deadPanel(host, question, "no decomposition was published");
    panelHead(host, question);
    /* THE GAUGE LEADS, because the panel's question is "why is this name on
       the board" and the first half of that answer is how far onto it the
       score actually reaches. The decomposition below then says where those
       points came from. */
    scoreGauge(host, card);

    const weights = card.weights || {};
    const wTotal = Object.values(weights).reduce((a, w) => a + (isNum(w) || 0), 0);

    /* A CARD FROM BEFORE THE GAUGES EXISTED must not have its numbers redrawn
       under the new meaning. In v1, fam.V and fam.O were signed votes; drawn as
       gauges, a published 53 becomes a 53%-full bar labelled "no direction" and
       a published -22 becomes a negative width under the number -22. F, P and D
       did not change meaning and still render. */
    const legacy = (isNum(card.v) ?? 1) < 2;

    const list = el("ul", "fc-fam");
    for (const axis of AXES) {
      const v = legacy && !axis.signed ? null : isNum(card.fam[axis.k]);
      const li = el("li", (axis.signed ? "is-signed " : "is-gauge ") +
        (v === null ? "is-null" : !axis.signed ? "is-pos" : polarity(v)));
      li.append(el("span", "fc-fam-k", axis.k));

      const track = el("span", "fc-fam-track");
      // A zero mark on every signed track. Family V used to publish 0 on every
      // name, be classed positive, and render as literally nothing — an empty
      // track that looked identical to a track whose bar was too small to see.
      if (axis.signed) track.append(el("b", "fc-fam-zero"));
      const bar = el("i");
      bar.style.setProperty("--w", v === null ? 0 : (axis.signed ? Math.min(Math.abs(v) / 100, 1) : Math.min(v / 100, 1)));
      track.append(bar);
      li.append(track);

      li.append(el("span", "fc-fam-v", v === null ? DASH
        : axis.signed ? (v > 0 ? "+" + v : v < 0 ? MINUS + Math.abs(v) : "0")
        : String(v)));

      const lab = el("span", "fc-fam-l");
      lab.append(document.createTextNode(axis.label));
      if (axis.signed && wTotal > 0 && isNum(weights[axis.k]) !== null) {
        const w = el("span", "fc-fam-w");
        w.textContent = " " + Math.round((weights[axis.k] / wTotal) * 100) + "% of the blend";
        lab.append(w);
      } else if (!axis.signed) {
        lab.append(el("span", "fc-fam-w",
          legacy ? " not published on this card" : " gauge — no direction"));
      }
      lab.title = axis.blurb;
      li.append(lab);
      list.append(li);
    }
    host.append(list);

    const conv = card.conv || {};
    host.append(statList([
      ["Score", fmtOr(card.score, (n) => signed(n, (a) => String(a)))],
      ["Conviction", fmtOr(card.conviction, (n) => String(n))],
      ["Agreement", fmtOr(conv.agreement, (n) => Math.round(n * 100) + "%")],
      ["Axes present", fmtOr(conv.breadth, (n) => n + " of 3")],
      ["Sources", fmtOr(conv.coverage, (n) => Math.round(n * 5) + " of 5")],
      /* THE THIRD TERM OF THE COMPOSITE, which this list showed two of.
         A reader could see agreement and coverage, could not see persistence,
         and so watched a published conviction move by eleven points with
         nothing on the card accounting for it. */
      ["Persistence", fmtOr(conv.persistence, (n) => Math.round(n * 100) + "%")],
      ["Quality gate", fmtOr(conv.gate, (n) => "\u00d7" + n.toFixed(2))],
    ]));

    convictionArithmetic(host, card, conv);

    /* THE TWO REASONS THE QUALITY GAUGE IS LOW, spelled out.

       O is a single digit and a PRODUCT of four oriented axes, so a 38 can
       mean "this name's flow is lottery tickets", "this participant is
       trading vol, not direction", or neither. Those call for opposite
       handling — one says the direction is real but the sizing is a punt, the
       other that there is no directional view to read — and the digit alone
       lets a reader recover neither.

       Both are ratios of gross sums with no free parameter. otmShare is in
       [0, 1] by construction (|otm directional delta| <= |directional delta|
       row by row); vegaTilt is gross vega flow per unit of gross delta flow,
       unbounded above, and its floor of zero is "every dollar of this flow was
       spent on direction". Neither is thresholded into an adjective here: the
       scorer ranks them cross-sectionally, so no absolute cut is identified,
       and inventing one would be exactly the free parameter this project has
       refused elsewhere. */
    const quality = card.quality;
    if (!quality) {
      if (!legacy) host.append(el("p", "fc-note",
        "The two quality readings behind the O gauge — the out-of-the-money share of " +
        "directional flow and the vega tilt — are not published on this card. It was " +
        "built before they were, so they are shown as unmeasured rather than as zeros: " +
        "zero is the BEST possible reading of both once they are oriented, and imputing " +
        "it would reward a name for having no data. They return on the next published " +
        "session."));
    } else {
      const otm = isNum(quality.otmShare);
      const tilt = isNum(quality.vegaTilt);
      host.append(statList([
        ["OTM share of directional flow", otm === null ? DASH : Math.round(otm * 100) + "%"],
        ["Vega flow per unit delta", tilt === null ? DASH : neg(tilt.toFixed(2))],
      ]));
      host.append(el("p", "fc-note",
        (otm === null && tilt === null
          ? "Neither quality reading is measurable on this name: there was no directional " +
            "delta flow to divide by, which is \"no directional view\", never infinite " +
            "conviction — so both are withheld rather than floored at their best value. "
          : "") +
        (otm !== null
          ? `${Math.round(otm * 100)}% of this name's directional delta flow traded ` +
            `out-of-the-money. A high share is lottery tickets — cheap, convex, and ` +
            `frequently written by someone with no view at all; a low one is near-money ` +
            `conviction that has to be paid for. `
          : "") +
        (tilt !== null
          ? `Each unit of gross delta flow came with ${neg(tilt.toFixed(2))} of gross vega ` +
            `flow. A high tilt says this participant is trading VOLATILITY rather than ` +
            `direction, which is the cleanest reason on the card to suppress a directional ` +
            `read rather than to misinterpret it as a view. `
          : "") +
        "Both enter the score only through the O gauge, ranked against the rest of the " +
        "board rather than against a fixed cut — there is no identified threshold at " +
        "which a share becomes \"too high\"."));
    }

    if (legacy) {
      host.append(el("p", "fc-note",
        "This card was built before the volatility and quality readings became " +
        "gauges, so those two are shown as unavailable rather than redrawn under " +
        "a meaning they did not have. They return on the next published session."));
    }

    appendMethod(host, [el("p", "fc-note",
      "The three signed axes are blended by EFFECTIVE breadth — a family of five " +
      "columns that all restate the same tape counts as one signal, not five — and " +
      "the blend is then multiplied by the quality gate, which is bounded above by " +
      "two and averages one across the board, so it can amplify or damp a reading " +
      "but never reverse it. The result is neutralised against sector and market cap, " +
      "then mapped through a FIXED scale — score = 100·tanh(composite × 0.5493) — so " +
      "a composite of 2.0 scores 80 on every session and at every board size, and a " +
      "quiet day prints quiet scores. The composite is a weighted mean of columns each " +
      "measured in its own median-absolute-deviation units, so 2.0 is two of those, " +
      "not two standard deviations of anything. This is a ranked attention signal, " +
      "not a return forecast.")], "How the score is computed");
  }

  /* ---------- the one deliberate global ----------------------------- */
  /* Named in AGENTS.md's production-globals allowlist. The scaffolding is
     exported alongside the renderers because a second page draws panels of
     its own with the same vocabulary — deadPanel, the formatters and isNum
     are exactly the pieces that must not be reimplemented, since a fourth
     copy of `isNum` is a fourth chance to write `Number(v)` and turn a
     missing reading into a confident zero.

     IT IS NO LONGER FROZEN, AND THAT IS THE WHOLE COST OF THE DEFERRAL.
     Nine of the eleven drawers now live in assets/js/flows-drawers.js and
     arrive through `__register` after a fetch, so the object cannot be sealed
     at definition. What replaces the freeze is `need()`: every caller that
     draws a panel awaits it, and until it resolves the nine keys are simply
     absent — which the DRAW walk already handles, because a key with no
     drawer is the same condition as a panel the payload never carried. The
     failure mode a freeze protected against (a late writer redefining `isNum`)
     is not the failure mode of a loader, and pretending otherwise would have
     meant shipping 105.6 KiB on first paint to keep an Object.freeze. */
  let drawersPromise = null;

  /**
   * Fetch and register the deferred drawers, once per page.
   *
   * RESOLVES ON LOAD, REJECTS ON ERROR, AND NEVER RESOLVES TWICE. The promise
   * is memoised on first call, so a reader who switches station four times
   * pays one fetch. A rejection is memoised too, deliberately: a station that
   * silently retried on every switch would turn a dead asset into a loop, and
   * the caller's own empty state is a better answer than an invisible retry.
   */
  function need() {
    if (drawersPromise) return drawersPromise;
    drawersPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      /* THE VERSION IS READ OFF THIS FILE'S OWN TAG, not hardcoded. Both
         assets are stamped by the same ritual, so the one already in the DOM
         carries the query the deferred one needs — hardcoding it here would
         be a fifth place the version ritual has to be kept in step. */
      const own = document.querySelector('script[src*="flows-panels.js"]');
      const q = own && own.src.indexOf("?") >= 0
        ? own.src.slice(own.src.indexOf("?")) : "";
      s.src = "/assets/js/flows-drawers.js" + q;
      /* ONLOAD IS NOT PROOF THAT ANYTHING REGISTERED, and this is the failure
         a plain onload/onerror pair cannot see. `onerror` fires for a network
         failure, but a request answered with a 200 and an HTML body — a
         single-page-app rewrite, a captive portal, an asset the deploy left
         behind so the route serves its 404 page — parses as script, throws a
         SyntaxError inside the tag, and fires ONLOAD. The promise would
         resolve, the walk would proceed, and every deferred panel would report
         "no renderer is registered" with the loader insisting it succeeded.
         So the resolve condition is what the fetch was FOR: the drawers are in
         the registry. */
      s.onload = () => (typeof api.gamma === "function"
        ? resolve(api)
        : reject(new Error("flows-drawers.js loaded but registered no drawers")));
      s.onerror = () => reject(new Error("flows-drawers.js did not load"));
      document.head.append(s);
    });
    return drawersPromise;
  }

  const api = {
    /* the two drawers the default station needs, parsed on first paint */
    overlay: renderOverlay,
    score: renderScore,

    /* THE OVERLAY'S ARITHMETIC, exported beside the drawer that draws the
       same rows, so it is a function here rather than a second copy in the
       controller that leads on it. It stays eager because the ticker's header
       reads it before any panel draws. */
    changeFrom,

    /* the loader, and the door the deferred file registers through */
    need,
    __register(drawers) { Object.assign(api, drawers); },

    /* scaffolding */
    el, svgEl, isNum, fmtOr, polarity, deadPanel, quietPanel, emptyPanel, statList,
    panelHead, panelWidth, appendMethod, leadReading, qualifier, mountId,
    niceStep, quantileAbs, symlog,
    DASH, MINUS, neg, signed, pct, pct1, atrDist, px2, vol1, money, compact,
    AXIS_CH,
  };

  window.FlowsPanels = api;
})();
