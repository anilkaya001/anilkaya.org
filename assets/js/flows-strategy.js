/* =============================================================
   flows-strategy.js — the options strategy tester.

   Pick a name, build a position out of contracts that are actually
   listed, and see what it pays. Everything here is one of exactly
   three things, and the page never lets two of them wear the same
   typeface:

     MEASURED — the mid, the net debit or credit, the maximum profit
       and maximum loss at expiry, the breakevens, the payoff line
       itself, and the position's greeks as sums of the vendor's
       per-contract ones. All arithmetic on quoted numbers.

     A STATED CONVENTION — the projected curve (a Taylor expansion in
       those same greeks), monthly decay (thirty times a one-day
       derivative of a convex function), and the fixed bump sizes.
       Each is labelled where it is printed, the way
       `annualizedIsConvention` labels the premium desk's yield.

     REFUSED — buying power reduction and conditional value at risk,
       named on the page with the reason rather than quietly absent.

   THE ENGINE IS TAYLOR, NOT BLACK-SCHOLES, AND THAT WAS THE DECISION.
   Black-Scholes would draw a smoother curve and would need a
   risk-free rate and a dividend yield — the two free parameters
   shared/flows-chain.js and shared/flows-premium.js refuse by name,
   and the refusal is why this section has never shipped an
   assignment probability. A Taylor expansion needs nothing that is
   not on the wire. Its cost is that it is LOCAL: least accurate near
   a strike and near expiry, degrading with the horizon. That cost is
   printed beside the curve and the slider stops at the nearest leg's
   expiry rather than extrapolating through it.

   THE ABSENT GREEK IS A PER-ROW FACT. The vendor marks all five
   nullable and its own spec example carries a contract with none of
   them. So a null greek renders an em dash on its row AND WITHHOLDS
   the position total it belongs to — a sum that silently skips a leg
   is a confident number about a position nobody holds. The legs it
   is missing from are named.

   THE THREE SILENCES ARE THREE SENTENCES. Nothing has been asked
   for yet; the request did not come back; the read succeeded and
   there was nothing there. Only the third is a fact about the
   market, and only it may be phrased as one.
   ============================================================= */
(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { isNum, el, svgEl, MINUS, DASH, MID, emptyState } = UI;

  const entry = document.getElementById("sgEntry");
  const tickerInput = document.getElementById("sgTicker");
  const repriceBtn = document.getElementById("sgReprice");
  const statusEl = document.getElementById("sgStatus");
  const expirySel = document.getElementById("sgExpiry");
  const windowSel = document.getElementById("sgWindow");
  const basisSel = document.getElementById("sgBasis");
  const clearBtn = document.getElementById("sgClear");
  const chainBody = document.getElementById("sgChainBody");
  const chainWrap = document.getElementById("sgChainWrap");
  const legsBody = document.getElementById("sgLegsBody");
  const legsWrap = document.getElementById("sgLegsWrap");
  const scenePx = document.getElementById("sgScenePx");
  const sceneDays = document.getElementById("sgSceneDays");
  if (!entry || !tickerInput || !chainBody || !legsBody) return;

  const panel = (id) => document.getElementById(id);
  const show = (id, on) => { const n = panel(id); if (n) n.hidden = !on; };

  /* One contract is 100 shares. Named for the reason flows-premium.js names
     it: a bare 100 in a premium formula reads like a percentage and has been
     mistaken for one. */
  const MULT = 100;

  /* The vol bump the scenario panel offers by default, in POINTS of implied
     volatility. A visible input rather than a constant — see setScene(). */
  const DEFAULT_VOL_BUMP = 0;

  /* =============================================================
     FORMATTERS

     FlowsUI.fmtMoney rounds to a scale ("$2K"), which is right for a
     premium total and wrong for a maximum loss: a reader comparing
     $1,950 against $2,050 cannot do it in thousands. These print
     exact dollars and cents, with the same U+2212 and the same em
     dash for an absence that every other Flows surface uses.
     ============================================================= */

  const fmtUSD = (v, signed) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const body = "$" + Math.abs(n).toLocaleString("en-US",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? MINUS : signed && n > 0 ? "+" : "") + body;
  };

  /* A strike or an underlying price: two decimals only when it has them, so a
     $180 strike does not read as $180.00 beside a $182.50 one. */
  const fmtPx = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const s = (n < 0 ? MINUS : "") + "$" + Math.abs(n).toFixed(2);
    return s.replace(/\.00$/, "");
  };

  /* A quoted premium, always two decimals: options are quoted in cents and a
     $1.90 bid that printed as $1.9 would be the only price on the page not in
     the form the market states it in. */
  const fmtQuote = (v) => {
    const n = isNum(v);
    return n === null ? DASH : "$" + n.toFixed(2);
  };

  const fmtNum = (v, dp) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(dp === undefined ? 2 : dp);
  };

  /* Unsigned, for a quantity or a count. */
  const fmtPlain = (v, dp) => {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(dp === undefined ? 2 : dp);
  };

  /* =============================================================
     THE OPTION SYMBOL

     Mirrors shared/flows-premium.js's regex and, crucially, its
     STRIKE DIVISOR: the eight digits carry three implied decimals,
     so they are divided by 1000 rather than multiplied. That file
     settles the ambiguity in the vendor's own spec with an example —
     UVIX240920C00025000 is a $25.00 strike on an ETF that trades in
     the teens, not a $25,000 one.

     A SECOND COPY EXISTS ONLY BECAUSE THE BROWSER HAS NO MODULE
     LOADER HERE: every Flows page is a plain deferred script and
     shared/ is Worker-side. It is used for exactly one thing — the
     legs restored from a shared link, whose expiry and type must be
     known BEFORE the book that would otherwise supply them can be
     fetched. Every other read of a strike or a type on this page
     comes from the payload, not from here.
     ============================================================= */
  const SYMBOL_RE = /^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/;
  function parseSymbol(symbol) {
    if (typeof symbol !== "string") return null;
    const m = SYMBOL_RE.exec(symbol.trim().toUpperCase());
    if (!m) return null;
    const month = Number(m[3]), day = Number(m[4]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const strike = Number(m[6]) / 1000;
    if (!(strike > 0)) return null;
    return {
      expiry: `20${m[2]}-${m[3]}-${m[4]}`,
      type: m[5] === "C" ? "call" : "put",
      strike,
    };
  }

  /** Whole CALENDAR days between two ISO days. Calendar rather than trading,
   *  for the reason flows-premium.js gives: premium decays over weekends too,
   *  and every convention on this page is stated in calendar days. */
  const daysBetween = (fromDay, toDay) => {
    const a = Date.parse(String(fromDay).slice(0, 10) + "T00:00:00Z");
    const b = Date.parse(String(toDay).slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  };

  /* =============================================================
     THE ENGINE

     Pure functions over resolved legs. A resolved leg is
       { sym, expiry, type: "call"|"put", k, qty, side, price,
         bid, ask, mid, iv, dl, gm, th, vg, rh }
     with `price` set by the chosen basis and every greek either a
     finite number or null.
     ============================================================= */

  const signOf = (leg) => (leg.side === "long" ? 1 : -1);

  /**
   * The entry price per share for one leg under the chosen basis.
   *
   * THE MID NEEDS BOTH SIDES. `(bid + ask) / 2` with an absent ask is not a
   * mid at all, and Number(null) would have made it half the bid — a price
   * nobody quoted, on a page whose whole claim is that every number is
   * recoverable from something somebody did quote.
   *
   * The marketable basis is what crossing the spread actually costs: you buy
   * at the ask and you sell at the bid. It is the pessimistic reading and it
   * is the only one that is observable end to end.
   */
  function priceLeg(row, side, basis) {
    const bid = isNum(row.bid), ask = isNum(row.ask);
    if (basis === "marketable") return side === "long" ? ask : bid;
    if (bid === null || ask === null) return null;
    return (bid + ask) / 2;
  }

  const midOf = (row) => {
    const bid = isNum(row.bid), ask = isNum(row.ask);
    return bid === null || ask === null ? null : (bid + ask) / 2;
  };

  /** Net cash at open, in dollars. POSITIVE IS A DEBIT PAID, negative a credit
   *  received. Null when any leg could not be priced — a position missing one
   *  leg's price has an unknown cost, not a smaller one. */
  function netCost(legs) {
    let sum = 0;
    for (const l of legs) {
      if (l.price === null) return null;
      sum += signOf(l) * l.qty * MULT * l.price;
    }
    return sum;
  }

  /** The position's value at today's mids. Null if any mid is absent. */
  function markValue(legs) {
    let sum = 0;
    for (const l of legs) {
      if (l.mid === null) return null;
      sum += signOf(l) * l.qty * MULT * l.mid;
    }
    return sum;
  }

  const intrinsic = (type, k, S) => (type === "call" ? Math.max(0, S - k) : Math.max(0, k - S));

  /**
   * PROFIT AND LOSS AT EXPIRY, and this is the model-free line.
   *
   * At expiry an option is worth its intrinsic value and nothing else. No
   * volatility, no rate, no dividend, no distribution enters here — which is
   * why this is the one curve on the diagram that is exact rather than
   * approximate, and why the maximum profit, the maximum loss and the
   * breakevens read off it are exact too.
   */
  function payoffAt(legs, cost, S) {
    let v = 0;
    for (const l of legs) v += signOf(l) * l.qty * MULT * intrinsic(l.type, l.k, S);
    return v - cost;
  }

  /**
   * The slope of the expiry payoff above the highest strike, in dollars of
   * P&L per dollar of underlying.
   *
   * Only calls contribute: above every strike, every put is worthless and
   * stays worthless. A non-zero slope here is the ONLY way this page's payoff
   * can be unbounded, because the underlying is bounded below by zero.
   */
  function rightSlope(legs) {
    let s = 0;
    for (const l of legs) if (l.type === "call") s += signOf(l) * l.qty * MULT;
    return s;
  }

  const strikesOf = (legs) => {
    const seen = new Set();
    for (const l of legs) seen.add(l.k);
    return [...seen].sort((a, b) => a - b);
  };

  /**
   * Maximum profit and maximum loss at expiry.
   *
   * THE PAYOFF IS PIECEWISE LINEAR, so its extremes can only sit at a
   * breakpoint or at an end of the domain. The breakpoints are the strikes;
   * the left end is S = 0 and the right end is infinity. Sampling a grid
   * would find approximately the same numbers and would occasionally miss a
   * peak entirely; evaluating the breakpoints finds them exactly.
   *
   * DOWNSIDE IS NEVER UNBOUNDED AND SAYING OTHERWISE IS THE COMMON ERROR. A
   * naked short put is routinely described as having unlimited risk. It does
   * not: a share cannot trade below zero, so the loss is exactly the strike
   * less the credit, and this returns that number with the price it occurs
   * at. Only a short call is genuinely unbounded, and that is reported as
   * unbounded rather than as a large number, because there is no number.
   */
  function extremes(legs, cost) {
    const rs = rightSlope(legs);
    const cands = [{ S: 0, p: payoffAt(legs, cost, 0) }];
    for (const k of strikesOf(legs)) cands.push({ S: k, p: payoffAt(legs, cost, k) });
    let best = cands[0].p, worst = cands[0].p;
    for (const c of cands) {
      if (c.p > best) best = c.p;
      if (c.p < worst) worst = c.p;
    }
    /* WHERE, AS A SET RATHER THAN A POINT. A long call loses its whole premium
       at EVERY price at or below its strike, and reporting one endpoint of that
       range as "the" maximum-loss price is a fact about which candidate the
       loop happened to visit first. Ties are collected and the caller says
       "anywhere from A to B" when they are adjacent breakpoints — which, the
       payoff being linear between them, is exactly when the whole segment is
       flat at that value. */
    const at = (target) => cands
      .map((c, i) => ({ ...c, i }))
      .filter((c) => Math.abs(c.p - target) < 1e-9);
    const spread = (list) => list.length > 1 && list[list.length - 1].i - list[0].i === list.length - 1;
    const bestAt = at(best), worstAt = at(worst);
    return {
      rightSlope: rs,
      profitUnbounded: rs > 0,
      lossUnbounded: rs < 0,
      maxProfit: rs > 0 ? null : best,
      maxProfitAt: rs > 0 ? null : bestAt.map((c) => c.S),
      maxProfitFlat: rs > 0 ? false : spread(bestAt),
      maxLoss: rs < 0 ? null : worst,
      maxLossAt: rs < 0 ? null : worstAt.map((c) => c.S),
      maxLossFlat: rs < 0 ? false : spread(worstAt),
    };
  }

  /** "at $100", "anywhere from $0 to $100", "at $95 and at $120". */
  function whereText(list, flat) {
    if (!list || !list.length) return "";
    if (list.length === 1) return "at an underlying of " + fmtPx(list[0]) + " at expiry";
    if (flat) {
      return "anywhere from " + fmtPx(list[0]) + " to " + fmtPx(list[list.length - 1]) +
        " at expiry, where the payoff is flat";
    }
    return "at " + list.map(fmtPx).join(" and at ") + " at expiry";
  }

  /** Every underlying price at which the expiry payoff is exactly zero. */
  function breakevens(legs, cost) {
    const pts = [0, ...strikesOf(legs)];
    const out = [];
    const push = (x) => {
      if (!Number.isFinite(x) || x < 0) return;
      if (out.some((v) => Math.abs(v - x) < 1e-9)) return;
      out.push(x);
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const pa = payoffAt(legs, cost, a), pb = payoffAt(legs, cost, b);
      if (pa === 0) push(a);
      if (pb === 0) push(b);
      /* A SIGN CHANGE, not a small value. A segment whose ends are both
         negative can dip no lower and rise no higher than its ends — the
         function is linear on it — so there is nothing between them to find. */
      if (pa * pb < 0) push(a + (b - a) * (-pa) / (pb - pa));
    }
    const last = pts[pts.length - 1];
    const pl = payoffAt(legs, cost, last);
    const rs = rightSlope(legs);
    if (pl === 0) push(last);
    else if (rs !== 0) {
      const x = last + (-pl) / rs;
      if (x > last) push(x);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  /**
   * A position greek: the signed, quantity-weighted, contract-multiplied sum.
   *
   * WITHHELD RATHER THAN PARTIAL. If any leg is missing this greek the total
   * is null and the legs that are missing it are named. Summing the rest
   * would publish a number for a position that is not the one on the page —
   * the exact shape of "Number(null) is 0", one abstraction up.
   */
  function greekTotal(legs, key) {
    let sum = 0;
    const missing = [];
    for (const l of legs) {
      const g = l[key];
      if (g === null) { missing.push(l); continue; }
      sum += signOf(l) * l.qty * MULT * g;
    }
    return missing.length ? { value: null, missing } : { value: sum, missing: [] };
  }

  /* The four greeks the projection needs. Rho is deliberately not among them:
     it moves the price with the interest rate, and this page has no rate to
     move — that is the parameter it declined to invent. It is still printed
     as a position total, because the vendor quoted it. */
  const TAYLOR_GREEKS = ["dl", "gm", "th", "vg"];

  /**
   * THE PROJECTION. A second-order expansion in the underlying, first order
   * in time and in implied volatility, using the vendor's own quoted greeks:
   *
   *   dV ≈ Σ_legs sign · qty · 100 · [ δ·dS + ½·Γ·dS² + Θ·dDays + V·dVolPts ]
   *
   * IT IS A CONVENTION AND NOT A MEASUREMENT, in three separate places, and
   * each is stated on the page rather than only here:
   *   — theta is taken as a one-day derivative, which is the vendor's own
   *     convention for the field;
   *   — vega is taken as the price change for a ONE-POINT move in implied
   *     volatility, likewise;
   *   — and the expansion itself is local, so it degrades with dS and with
   *     dDays and is worst exactly at a strike, where gamma is largest and a
   *     second-order term is least sufficient.
   *
   * Null when any leg is missing any of the four. There is no partial answer
   * here: an expansion missing one leg's delta describes a different position.
   */
  function taylor(legs, { dS, dDays, dVol }) {
    let sum = 0;
    for (const l of legs) {
      for (const g of TAYLOR_GREEKS) if (l[g] === null) return null;
      const per = l.dl * dS + 0.5 * l.gm * dS * dS + l.th * dDays + l.vg * dVol;
      sum += signOf(l) * l.qty * MULT * per;
    }
    return sum;
  }

  /* =============================================================
     STATE

     THE POSITION LIVES IN THE URL, like the premium desk's
     watchlist and for the same reasons: assets/js/storage.js is the
     sanctioned owner of browser storage on this site and a second
     owner is how two of them disagree, and a link is the only form
     of a position that survives a reload and can be sent to someone.

     Legs carry no PRICES in the URL. A quote is a fact about a
     moment; a link opened tomorrow that restored yesterday's mid
     would draw a diagram that was never true. The link carries the
     contracts, and the page re-reads what they are worth now.
     ============================================================= */
  const state = {
    ticker: "",
    context: null,
    contextAt: null,     // Date.now() when the context payload was received
    contextAge: null,    // X-Chain-Age at that instant, in seconds, or null
    contextError: null,
    expiry: "",
    books: new Map(),    // expiry -> the expiry payload
    bookError: new Map(),
    /* IN FLIGHT, NOT MERELY UNLOADED. Restoring a shared link asks for the
       displayed expiry and then for every leg's expiry, which are usually the
       same one — and `books.has()` is still false while the first request is
       in the air, so both would fire. Two concurrent misses are two calls on a
       shared vendor quota for one answer. */
    bookPending: new Set(),
    loading: 0,
    legs: [],            // { sym, expiry, type, k, qty, side }
    basis: "mid",
    window: 0.25,
    scene: { px: null, days: 0, vol: DEFAULT_VOL_BUMP },
    seq: 0,
  };

  const legKey = (l) => l.sym + "|" + l.side;

  function readURL() {
    const q = new URLSearchParams(location.search);
    const t = String(q.get("t") || "").trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) state.ticker = t;
    const basis = q.get("basis");
    if (basis === "mid" || basis === "marketable") state.basis = basis;
    const expiry = q.get("expiry");
    if (expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) state.expiry = expiry;
    const legs = String(q.get("legs") || "").split(",").filter(Boolean);
    for (const raw of legs) {
      const at = raw.lastIndexOf("@");
      if (at <= 0) continue;
      const sym = raw.slice(0, at).toUpperCase();
      const qty = Number(raw.slice(at + 1));
      const parsed = parseSymbol(sym);
      /* A LEG THAT DOES NOT PARSE IS DROPPED, NOT GUESSED AT. A hand-edited
         link with a mangled strike would otherwise draw a diagram of a
         contract that does not exist, and every number on it would render. */
      if (!parsed || !Number.isFinite(qty) || qty === 0) continue;
      const n = Math.min(999, Math.abs(Math.round(qty)));
      if (!n) continue;
      state.legs.push({
        sym, expiry: parsed.expiry, type: parsed.type, k: parsed.strike,
        qty: n, side: qty > 0 ? "long" : "short",
      });
    }
  }

  function writeURL() {
    const q = new URLSearchParams();
    if (state.ticker) q.set("t", state.ticker);
    if (state.expiry) q.set("expiry", state.expiry);
    if (state.basis !== "mid") q.set("basis", state.basis);
    if (state.legs.length) {
      q.set("legs", state.legs
        .map((l) => l.sym + "@" + (l.side === "long" ? "" : "-") + l.qty).join(","));
    }
    const next = location.pathname + (q.toString() ? "?" + q.toString() : "");
    if (next !== location.pathname + location.search) {
      history.replaceState(null, "", next);
    }
  }

  /* =============================================================
     THE FETCHES
     ============================================================= */

  /**
   * ONE HELPER FOR BOTH READS, and the age header is the reason it is worth
   * one. `headers.get` answers null for a header that was not sent, Number(null)
   * is 0 and Number.isFinite(0) is true — so a naive read publishes an ABSENT
   * age as an age of nought, "just now", for a body of unknown vintage. The
   * route also sends a real `X-Chain-Age: 0` on a cache miss and means
   * measured-fresh by it. isNum() keeps those two apart; nothing else does.
   */
  async function readStrategy(params) {
    const response = await fetch("/api/flows/strategy?" + params.toString(), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {
      /* The session expired underneath us. The sign-in page is the honest
         destination, not an error on a page that cannot work. */
      location.replace("/flows/");
      return { gone: true };
    }
    const age = isNum(response.headers.get("X-Chain-Age"));
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body && body.error && body.error.code;
      return { error: messageFor(response.status, code) };
    }
    /* A 200 THAT DID NOT PARSE IS NOT A PAYLOAD. Letting it through as `ok`
       with a null body is how the premium desk once counted a symbol among
       those it had priced while holding no table for it. */
    if (!body || typeof body !== "object") return { error: "the response could not be read" };
    return { body, age, at: Date.now() };
  }

  function messageFor(status, code) {
    if (code === "chain_unconfigured") return "live lookup is not configured on this deployment";
    if (code === "invalid_ticker") return "that is not a symbol this route accepts";
    if (code === "invalid_expiry") return "that is not a date this route accepts";
    if (code === "chain_rate_limited" || status === 429) return "the data provider is rate limiting";
    if (code === "chain_no_spot") return "the provider returned no usable price for that symbol";
    if (code === "chain_empty") return "the provider lists no options for that symbol";
    if (status >= 500) return "the data provider did not answer";
    return "the request failed (" + status + ")";
  }

  async function loadContext(refresh) {
    if (!state.ticker) return;
    const seq = ++state.seq;
    state.loading++;
    state.contextError = null;
    render();
    const params = new URLSearchParams({ t: state.ticker });
    if (refresh) params.set("refresh", "1");
    let out;
    try { out = await readStrategy(params); }
    catch { out = { error: "the request did not reach the server" }; }
    state.loading--;
    if (out.gone) return;
    /* A SUPERSEDED RESPONSE IS DROPPED. Typing a second symbol before the
       first returns leaves two requests in the air, and they do not come back
       in the order they were sent. The stale one is not bad data — it is the
       answer to a question the reader has already moved on from. */
    if (seq !== state.seq) return;
    if (out.error) {
      state.contextError = out.error;
      state.context = null;
    } else {
      state.context = out.body;
      state.contextAge = out.age;
      state.contextAt = out.at;
      state.books.clear();
      state.bookError.clear();
      state.bookPending.clear();
      const expiries = out.body.expiries || [];
      const keep = expiries.some((e) => e.expiry === state.expiry);
      if (!keep) state.expiry = expiries.length ? expiries[0].expiry : "";
      if (state.scene.px === null) state.scene.px = isNum(out.body.spot);
    }
    render();
    if (state.expiry) loadExpiry(state.expiry);
    /* THE RESTORED LEGS' OWN EXPIRIES, not only the one on screen. A shared
       four-leg calendar spans two expiries and the position cannot be priced
       until both books are in hand. */
    for (const exp of new Set(state.legs.map((l) => l.expiry))) loadExpiry(exp);
  }

  async function loadExpiry(expiry, refresh) {
    if (!state.ticker || !expiry) return;
    if (state.books.has(expiry) && !refresh) return;
    if (state.bookPending.has(expiry)) return;
    state.bookPending.add(expiry);
    const ticker = state.ticker;
    state.loading++;
    state.bookError.delete(expiry);
    render();
    const params = new URLSearchParams({ t: ticker, expiry });
    if (refresh) params.set("refresh", "1");
    let out;
    try { out = await readStrategy(params); }
    catch { out = { error: "the request did not reach the server" }; }
    state.loading--;
    state.bookPending.delete(expiry);
    if (out.gone) return;
    /* Keyed on the SYMBOL as well as the expiry: switching names mid-flight
       must not file NVDA's October book under AMD. */
    if (ticker !== state.ticker) return;
    if (out.error) state.bookError.set(expiry, out.error);
    else state.books.set(expiry, out.body);
    render();
  }

  /* =============================================================
     RESOLVING LEGS

     A leg in `state.legs` is an identity. A leg the engine can use
     is that identity joined to the quote and the greeks the book
     currently holds, which is a JOIN AT RENDER TIME rather than a
     copy taken when the leg was added — so a re-price moves every
     leg at once and the diagram cannot be drawn from a mixture of
     two reads.
     ============================================================= */
  function resolveLegs() {
    const resolved = [], unresolved = [];
    for (const leg of state.legs) {
      const book = state.books.get(leg.expiry);
      const rows = book ? (leg.type === "call" ? book.calls : book.puts) : null;
      const row = rows ? rows.find((r) => r.sym === leg.sym) : null;
      if (!row) {
        unresolved.push({
          leg,
          /* THE THREE SILENCES, PER LEG. Which one it is decides what the
             reader should do, and they may not share a sentence. */
          why: state.bookError.has(leg.expiry) ? "unreadable"
            : book ? "gone" : "pending",
        });
        continue;
      }
      const mid = midOf(row);
      resolved.push({
        sym: leg.sym, expiry: leg.expiry, type: leg.type, k: leg.k,
        qty: leg.qty, side: leg.side,
        bid: isNum(row.bid), ask: isNum(row.ask), mid,
        price: priceLeg(row, leg.side, state.basis),
        iv: isNum(row.iv),
        dl: isNum(row.dl), gm: isNum(row.gm), th: isNum(row.th),
        vg: isNum(row.vg), rh: isNum(row.rh),
      });
    }
    return { resolved, unresolved };
  }

  /* =============================================================
     RENDER
     ============================================================= */

  function render() {
    renderStatus();
    renderContext();
    renderChain();
    renderPosition();
    writeURL();
  }

  const legLabel = (l) =>
    (l.side === "long" ? "Long" : "Short") + " " + l.qty + " " +
    l.expiry + " " + fmtPx(l.k) + " " + (l.type === "call" ? "call" : "put");

  function renderStatus() {
    if (!statusEl) return;
    if (state.loading > 0) {
      statusEl.textContent = "Reading the book…";
      statusEl.dataset.empty = "pending";
      return;
    }
    delete statusEl.dataset.empty;
    if (!state.ticker) { statusEl.textContent = "Enter a symbol to begin."; return; }
    if (state.contextError) {
      statusEl.textContent = state.ticker + ": " + state.contextError + ". " +
        "Nothing below was read — this is the request failing, not the market being quiet.";
      statusEl.dataset.empty = "unreadable";
      return;
    }
    if (!state.context) { statusEl.textContent = "Enter a symbol to begin."; return; }
    const ex = state.context.expiries || [];
    if (state.context.expiryStatus === "unreadable") {
      statusEl.textContent = state.ticker + ": the expiry list did not come back, so there is " +
        "nothing to pick from. The price above was read; this one request was not.";
      statusEl.dataset.empty = "unreadable";
      return;
    }
    if (!ex.length) {
      statusEl.textContent = state.ticker + " was read and lists no option expiries. " +
        "That is a reading about the name, not a failure of this page.";
      statusEl.dataset.empty = "quiet";
      return;
    }
    const parts = [state.ticker + " " + MID + " " + ex.length + " listed " +
      (ex.length === 1 ? "expiry" : "expiries")];
    parts.push(state.legs.length
      ? state.legs.length + (state.legs.length === 1 ? " leg" : " legs")
      : "no legs yet — use Buy or Sell on a row below");
    statusEl.textContent = parts.join(" " + MID + " ");
  }

  /* ---------- the context strip ---------------------------------- */

  function renderContext() {
    const host = document.getElementById("sgContext");
    const note = document.getElementById("sgContextNote");
    if (!host) return;
    host.textContent = "";
    if (note) note.textContent = "";
    const c = state.context;
    show("sgContextPanel", !!c);
    if (repriceBtn) repriceBtn.hidden = !c;
    if (!c) return;

    const dl = el("dl", "sg-facts");
    const add = (term, value, hint) => {
      const dt = el("dt", null, term);
      if (hint) dt.title = hint;
      dl.append(dt, el("dd", null, value));
    };

    /* WHICH PRICE, AND HOW OLD, both ship — the premium desk's rule, and it
       matters more here: every strike's moneyness, the diagram's whole x-axis
       and the beta weighting are measured from this one number. */
    add("Spot", fmtPx(c.spot) + " " + MID + " " +
      (c.spotSource === "stock-state" ? "live print" : "prior daily close"),
      "The price every reading on this page is measured from.");

    const ageText = contextAgeText();
    add("Read", ageText.text, ageText.hint);

    add("Session", c.asOf || DASH, "The trading session the days-to-expiry count is measured from.");

    /* BETA IS PRINTED EVEN WHEN THE BETA-WEIGHTED DELTA CANNOT BE. They are
       different absences: a name with no beta and a name whose index quote
       failed produce the same blank in the readings, and only this line can
       tell them apart. */
    /* THE VALUE HANDED BACK, NOT THE RAW FIELD. isNum RETURNS the reading, so
       the idiom is to bind it and format the binding — asking `isNum(x)` and
       then printing `x` is how a string that happened to parse gets printed as
       a string, and how a field that did not gets printed at all. */
    const beta0 = isNum(c.beta);
    add("Beta", beta0 === null ? DASH : fmtPlain(beta0, 2),
      "The vendor's beta for this name. An em dash means the vendor has none — " +
      "never a beta of zero, which would be a very different claim.");

    const idx = c.index;
    const idxSpot0 = idx ? isNum(idx.spot) : null;
    add("Reference index",
      idxSpot0 === null ? DASH : idx.symbol + " " + fmtPx(idxSpot0),
      "The index a beta-weighted delta is weighted TO. The reading is meaningless " +
      "without it, so it is named rather than assumed.");

    const earn = c.earnings;
    add("Next earnings",
      earn && earn.date ? earn.date + (earn.announceTime ? " " + MID + " " + earn.announceTime : "")
        : (earn && earn.issueType && /etf|index/i.test(earn.issueType)
          ? "not applicable " + MID + " " + earn.issueType
          : DASH),
      "A contract that outlives an earnings report is a different trade at the same premium.");

    host.append(dl);

    if (note) {
      note.textContent =
        "Every expiry below is priced against this one spot, read once. Re-price " +
        "re-reads it; picking a different expiry does not, because a second price " +
        "read per pick would spend a shared vendor quota to re-learn a number this " +
        "page already holds and can date.";
    }
  }

  function contextAgeText() {
    /* THE AGE IS A FUNCTION OF NOW, not a number frozen at fetch. The premium
       desk shipped the frozen version: a page priced at 09:31 and left open
       still said "just now" at 10:11. The header states the age AT THE INSTANT
       OF THE RESPONSE; everything after it is wall clock, so the two are added
       here and the whole strip is re-rendered on a slow tick. */
    if (state.contextAge === null || state.contextAt === null) {
      return {
        text: "age unknown",
        hint: "The response carried no age header, so how old this price is cannot be " +
          "stated. That is not the same as it being fresh.",
      };
    }
    const seconds = state.contextAge + Math.max(0, (Date.now() - state.contextAt) / 1000);
    const text = seconds < 45 ? "moments ago"
      : seconds < 5400 ? Math.round(seconds / 60) + " min ago"
        : Math.round(seconds / 3600) + " h ago";
    return {
      text,
      hint: "How old the quote behind this price is: the provider's cached age when it " +
        "was served, plus the time this page has been open since.",
    };
  }

  /* ---------- the chain ------------------------------------------ */

  function renderChain() {
    const c = state.context;
    show("sgChainPanel", !!(c && (c.expiries || []).length));
    if (!c) return;
    const expiries = c.expiries || [];
    if (!expiries.length) return;

    if (expirySel && expirySel.dataset.for !== state.ticker + "|" + expiries.length) {
      expirySel.dataset.for = state.ticker + "|" + expiries.length;
      expirySel.textContent = "";
      for (const e of expiries) {
        const days = daysBetween(c.asOf, e.expiry);
        const chains = isNum(e.chains);
        /* THE SIZE OF THE EXPIRY IS IN THE PICKER, BEFORE IT IS READ. The
           vendor caps a page at 500 contracts and its own spec example shows
           single expiries carrying 12,223 — so an expiry that cannot fit in
           the two pages this page fetches is knowable in advance, and warning
           before the read beats confessing after it. */
        const label = e.expiry +
          (days === null ? "" : "  " + MID + "  " + days + "d") +
          (chains === null ? "" : "  " + MID + "  " + chains + " listed");
        const opt = el("option", null, label);
        opt.value = e.expiry;
        expirySel.append(opt);
      }
    }
    if (expirySel && expirySel.value !== state.expiry) expirySel.value = state.expiry;

    const note = document.getElementById("sgChainNote");
    const book = state.books.get(state.expiry);
    const failed = state.bookError.get(state.expiry);
    chainBody.textContent = "";

    if (failed) {
      if (chainWrap) chainWrap.hidden = true;
      if (note) { note.textContent = ""; note.append(emptyState("unreadable",
        "The book for " + state.expiry + " did not come back: " + failed + ". " +
        "Nothing is listed below because nothing was read, which is not the same as " +
        "this expiry being empty.")); }
      return;
    }
    if (!book) {
      if (chainWrap) chainWrap.hidden = true;
      if (note) { note.textContent = ""; note.append(emptyState("pending",
        "Reading every listed contract at " + (state.expiry || "this expiry") + "…")); }
      return;
    }

    const rows = mergeStrikes(book);
    if (!rows.length) {
      if (chainWrap) chainWrap.hidden = true;
      if (note) { note.textContent = ""; note.append(emptyState("quiet",
        state.expiry + " was read and lists no contracts this page could parse. " +
        "That is a reading about the expiry.")); }
      return;
    }

    const spot = isNum(state.context.spot);
    const width = state.window;
    const inWindow = (k) => !width || spot === null || Math.abs(k / spot - 1) <= width;
    const shown = rows.filter((r) => inWindow(r.k));
    /* A FALLBACK THAT SAYS NOTHING IS A CONTROL THAT LIES. A ±10% window on a
       chain whose nearest strike is 30% away leaves nothing to draw, and
       quietly showing every strike instead would answer a question the reader
       did not ask under a control that claims otherwise. The rows are shown
       and the note below says the window caught nothing. */
    const windowEmpty = width > 0 && shown.length === 0 && rows.length > 0;
    const use = shown.length ? shown : rows;

    for (const r of use) chainBody.append(strikeRow(r, spot));
    if (chainWrap) chainWrap.hidden = false;

    if (note) {
      note.textContent = "";
      const bits = [];
      /* A LIST THAT TRUNCATES WITHOUT SAYING SO READS AS A POPULATION, and on
         a calculator the consequence is sharper than on a ranked table: the
         reader's strike is simply not there and nothing says a strike is
         missing. Both cuts are stated — the one this page made, and the one
         the vendor's page limit made. */
      if (windowEmpty) {
        bits.push("No listed strike falls within " + Math.round(width * 100) +
          "% of spot, so every one of the " + rows.length + " strikes is shown instead — " +
          "the window caught nothing rather than the expiry being narrow.");
      } else {
        bits.push("Showing " + use.length + " of " + rows.length + " listed strikes" +
          (use.length ? ", " + fmtPx(use[0].k) + " to " + fmtPx(use[use.length - 1].k) : "") +
          ". Widen the strike window above to see the rest.");
      }
      if (book.callsTruncated || book.putsTruncated) {
        const which = book.callsTruncated && book.putsTruncated ? "Both sides"
          : book.callsTruncated ? "The call side" : "The put side";
        bits.push(which + " of this expiry is CUT OFF: the provider caps a page at " +
          book.pageSize + " contracts and this page reads " + book.pagesPerType +
          " of them per side, so strikes beyond those are not listed here at all. " +
          "Pick a nearer expiry, or narrow what you are looking for.");
      }
      const gaps = isNum(book.missingGreeks);
      if (gaps !== null && gaps > 0) {
        bits.push(gaps + " of these contracts carry no greeks from the " +
          "provider. Their rows show em dashes, and a position containing one has no " +
          "projected curve — the vendor marks all five greeks nullable and its own " +
          "example carries a contract with none of them.");
      }
      /* THE FILTER STOPPED BEING HONOURED. Zero on every ordinary read, so
         this sentence never appears — but if the provider ever stops applying
         `expiry` or `option_type`, the rows it sent for other expiries are
         dropped here and a table that looks complete would be a table missing
         whatever the drop took with it. Saying so is the difference between a
         quiet gap and a reported one. */
      const off = isNum(book.offExpiry);
      if (off !== null && off > 0) {
        bits.push(off + " row" + (off === 1 ? "" : "s") + " the provider returned " +
          "belonged to a different expiry or a different option type and were dropped. " +
          "This table asked for one expiry and one type at a time, so what came back " +
          "is not what was asked for — treat the strike list here as incomplete.");
      }
      if (book.ivBasis) bits.push("Implied volatility read as a fraction: " + book.ivBasis + ".");
      note.textContent = bits.join(" ");
    }
  }

  /** One row per strike, both sides joined — the shape a chain is read in. */
  function mergeStrikes(book) {
    const byStrike = new Map();
    const put = (row, side) => {
      const k = isNum(row.k);
      if (k === null) return;
      if (!byStrike.has(k)) byStrike.set(k, { k, call: null, put: null });
      byStrike.get(k)[side] = row;
    };
    for (const r of book.calls || []) put(r, "call");
    for (const r of book.puts || []) put(r, "put");
    return [...byStrike.values()].sort((a, b) => a.k - b.k);
  }

  function strikeRow(entryRow, spot) {
    const tr = el("tr");
    if (spot !== null && Math.abs(entryRow.k / spot - 1) < 0.005) tr.className = "is-atm";

    const quoteCells = (row, side) => {
      const cells = [];
      const num = (text) => {
        const td = el("td", "c-num", text);
        return td;
      };
      if (!row) {
        /* NOT LISTED AT ALL is a different absence from LISTED WITH NO QUOTE,
           and both are em dashes — so the row's title says which. */
        for (let i = 0; i < 4; i++) {
          const td = num(DASH);
          td.title = "No " + side + " is listed at this strike";
          cells.push(td);
        }
        return cells;
      }
      cells.push(num(fmtQuote(row.bid)));
      cells.push(num(fmtQuote(row.ask)));
      const iv = isNum(row.iv);
      cells.push(num(iv === null ? DASH : (iv * 100).toFixed(1) + "%"));
      cells.push(num(fmtNum(row.dl, 3)));
      return cells;
    };

    const actionCell = (row, side) => {
      const td = el("td", "c-num sg-act");
      if (!row) { td.textContent = DASH; return td; }
      for (const dir of ["long", "short"]) {
        const b = el("button", "sg-btn sg-btn--" + dir, dir === "long" ? "Buy" : "Sell");
        b.type = "button";
        b.setAttribute("aria-label",
          (dir === "long" ? "Buy" : "Sell") + " the " + state.expiry + " " +
          fmtPx(entryRow.k) + " " + side);
        b.addEventListener("click", () => addLeg(row.sym, side, dir));
        td.append(b);
      }
      return td;
    };

    const c = quoteCells(entryRow.call, "call");
    tr.append(c[0], c[1], c[2], c[3]);
    tr.append(actionCell(entryRow.call, "call"));

    const th = el("th", "c-num sg-k", fmtPx(entryRow.k));
    th.scope = "row";
    tr.append(th);

    tr.append(actionCell(entryRow.put, "put"));
    const p = quoteCells(entryRow.put, "put");
    tr.append(p[3], p[2], p[0], p[1]);
    return tr;
  }

  function addLeg(sym, type, side) {
    const existing = state.legs.find((l) => l.sym === sym && l.side === side);
    if (existing) { existing.qty = Math.min(999, existing.qty + 1); render(); return; }
    const parsed = parseSymbol(sym);
    if (!parsed) return;
    state.legs.push({
      sym, expiry: parsed.expiry, type, k: parsed.strike, qty: 1, side,
    });
    render();
  }

  /* ---------- the position, the readings, the diagram ------------ */

  function renderPosition() {
    const has = state.legs.length > 0;
    show("sgLegsPanel", has);
    show("sgReadPanel", has);
    show("sgPlotPanel", has);
    show("sgScenePanel", has);
    if (!has) { legsBody.textContent = ""; return; }

    const { resolved, unresolved } = resolveLegs();
    renderLegs(resolved, unresolved);

    const readHost = document.getElementById("sgReadings");
    const readNote = document.getElementById("sgReadNote");
    const plotHost = document.getElementById("sgPlot");
    const plotNote = document.getElementById("sgPlotNote");
    const sceneHost = document.getElementById("sgScene");
    const sceneNote = document.getElementById("sgSceneNote");
    for (const n of [readHost, plotHost, sceneHost]) if (n) n.textContent = "";
    for (const n of [readNote, plotNote, sceneNote]) if (n) n.textContent = "";

    if (unresolved.length || !resolved.length) {
      const pend = unresolved.filter((u) => u.why === "pending");
      const bad = unresolved.filter((u) => u.why === "unreadable");
      const gone = unresolved.filter((u) => u.why === "gone");
      const say = (host, kind, text) => { if (host) host.append(emptyState(kind, text)); };
      const which = (list) => list.map((u) => legLabel(u.leg)).join("; ");
      for (const host of [readHost, plotHost, sceneHost]) {
        if (bad.length) {
          say(host, "unreadable", "Withheld: the book for " + which(bad) +
            " did not come back. Nothing here is computed from a partial position.");
        } else if (gone.length) {
          say(host, "quiet", "Withheld: " + which(gone) + " is no longer listed at that " +
            "expiry. The contract was read for and is not in the book — remove the leg.");
        } else if (pend.length) {
          say(host, "pending", "Reading the book that prices " + which(pend) + "…");
        } else {
          say(host, "pending", "Add a leg to see what the position pays.");
        }
      }
      return;
    }

    const cost = netCost(resolved);
    if (cost === null) {
      const unpriced = resolved.filter((l) => l.price === null).map(legLabel).join("; ");
      for (const host of [readHost, plotHost, sceneHost]) {
        if (host) {
          host.append(emptyState("unavailable",
            "Withheld: " + unpriced + " has no " +
            (state.basis === "mid" ? "two-sided quote, so it has no mid"
              : "quote on the side this basis would trade at") +
            ". A position with one unpriced leg has an unknown cost, not a smaller one."));
        }
      }
      return;
    }

    const ext = extremes(resolved, cost);
    const bes = breakevens(resolved, cost);
    renderReadings(readHost, readNote, resolved, cost, ext, bes);
    renderPlot(plotHost, plotNote, resolved, cost, ext, bes);
    renderScene(sceneHost, sceneNote, resolved, cost);
  }

  function renderLegs(resolved, unresolved) {
    legsBody.textContent = "";
    if (legsWrap) legsWrap.hidden = false;
    const byKey = new Map(resolved.map((l) => [legKey(l), l]));

    for (const leg of state.legs) {
      const r = byKey.get(legKey(leg));
      const tr = el("tr");
      const th = el("th", null, legLabel(leg));
      th.scope = "row";
      tr.append(th);

      const qtyTd = el("td", "c-num");
      const dec = el("button", "sg-qty", MINUS);
      dec.type = "button";
      dec.setAttribute("aria-label", "One fewer contract of " + legLabel(leg));
      dec.addEventListener("click", () => {
        leg.qty -= 1;
        if (leg.qty <= 0) state.legs = state.legs.filter((l) => l !== leg);
        render();
      });
      const inc = el("button", "sg-qty", "+");
      inc.type = "button";
      inc.setAttribute("aria-label", "One more contract of " + legLabel(leg));
      inc.addEventListener("click", () => { leg.qty = Math.min(999, leg.qty + 1); render(); });
      qtyTd.append(dec, el("span", "sg-qtyv", String(leg.qty)), inc);
      tr.append(qtyTd);

      const cell = (text, title) => {
        const td = el("td", "c-num", text);
        if (title) td.title = title;
        return td;
      };
      if (!r) {
        const why = (unresolved.find((u) => u.leg === leg) || {}).why;
        const text = why === "unreadable" ? DASH : why === "gone" ? DASH : DASH;
        const title = why === "unreadable" ? "The book for this expiry did not come back"
          : why === "gone" ? "This contract is not in the book that was read"
            : "The book that prices this leg has not arrived yet";
        for (let i = 0; i < 7; i++) tr.append(cell(text, title));
      } else {
        tr.append(cell(fmtQuote(r.bid)));
        tr.append(cell(fmtQuote(r.ask)));
        tr.append(cell(fmtQuote(r.price),
          state.basis === "mid" ? "The mid of the two-sided quote"
            : r.side === "long" ? "The ask — what buying it costs"
              : "The bid — what selling it pays"));
        /* EACH GREEK ASKED FOR SEPARATELY. A contract with a delta and no vega
           keeps its delta: absence is per field, not per row. */
        tr.append(cell(fmtNum(r.dl, 3), "Delta, per share, as quoted"));
        tr.append(cell(fmtNum(r.gm, 4), "Gamma, per share per dollar, as quoted"));
        tr.append(cell(fmtNum(r.th, 3), "Theta, taken as a one-day derivative"));
        tr.append(cell(fmtNum(r.vg, 3), "Vega, per one point of implied volatility"));
      }

      const rm = el("td");
      const btn = el("button", "sg-remove", "Remove");
      btn.type = "button";
      btn.setAttribute("aria-label", "Remove " + legLabel(leg));
      btn.addEventListener("click", () => {
        state.legs = state.legs.filter((l) => l !== leg);
        render();
      });
      rm.append(btn);
      tr.append(rm);
      legsBody.append(tr);
    }

    const note = document.getElementById("sgLegsNote");
    if (!note) return;
    note.textContent = "";
    const nulls = resolved.filter((l) => TAYLOR_GREEKS.some((g) => l[g] === null));
    if (nulls.length) {
      note.append(emptyState("unavailable",
        "The provider sent no complete set of greeks for " +
        nulls.map(legLabel).join("; ") + ". Every reading below that is a SUM of greeks " +
        "is withheld rather than computed without them, and there is no projected curve. " +
        "The expiry payoff is unaffected: it needs no greek at all."));
    }
  }

  /* ---------- readings ------------------------------------------- */

  function renderReadings(host, note, legs, cost, ext, bes) {
    if (!host) return;
    const dl = el("dl", "sg-facts");
    const add = (term, value, hint, cls) => {
      const dt = el("dt", null, term);
      if (hint) dt.title = hint;
      const dd = el("dd", cls || null, value);
      dl.append(dt, dd);
    };

    /* UNITS TRAVEL WITH NUMBERS. Every term below names what the number is
       counted in, because a ratio and a dollar sum must never share a name and
       "delta" alone is three different quantities depending on who says it. */
    add(cost >= 0 ? "Net debit" : "Net credit", fmtUSD(Math.abs(cost)),
      "What opening the whole position costs (a debit) or pays (a credit), " +
      "priced at " + (state.basis === "mid" ? "the mid of each leg" : "the marketable side of each leg") + ".");

    const mark = markValue(legs);
    if (mark !== null) {
      const spread = cost - mark;
      add("Spread crossed", fmtUSD(spread),
        state.basis === "mid"
          ? "Zero by construction under the mid basis: the mid assumes you trade at it. " +
            "Switch the basis above to see what crossing actually costs."
          : "What the position is down the instant it is opened, purely from paying the " +
            "ask and receiving the bid on every leg.");
    }

    add("Max profit",
      ext.profitUnbounded ? "unbounded" : fmtUSD(ext.maxProfit, true),
      ext.profitUnbounded
        ? "The position is net long calls, so its profit rises without limit as the " +
          "underlying rises. There is no number here, so none is printed."
        : "Reached " + whereText(ext.maxProfitAt, ext.maxProfitFlat) + ".",
      ext.profitUnbounded ? "is-unbounded" : null);

    /* THE BOUNDED SHORT PUT, SAID OUT LOUD. A naked short put is routinely
       described as having unlimited risk and it does not: a share cannot trade
       below zero, so the loss is exactly the strike less the credit. The note
       is attached only when zero is the SOLE price the worst case is reached
       at, which is precisely the shape that gets mis-described. */
    const zeroOnly = !ext.lossUnbounded && ext.maxLossAt.length === 1 && ext.maxLossAt[0] === 0;
    add("Max loss",
      ext.lossUnbounded ? "unbounded" : fmtUSD(ext.maxLoss, true),
      ext.lossUnbounded
        ? "The position is net short calls. A share has no upper bound, so neither does " +
          "this loss — which is why it is reported as unbounded and not as a large number."
        : "Reached " + whereText(ext.maxLossAt, ext.maxLossFlat) + "." +
          (zeroOnly
            ? " A share cannot trade below zero, so this loss is bounded — the 'unlimited " +
              "downside' often printed against a naked short put is not what the " +
              "arithmetic says."
            : ""),
      ext.lossUnbounded ? "is-unbounded" : null);

    add("Breakeven" + (bes.length === 1 ? "" : "s"),
      bes.length ? bes.map(fmtPx).join("  " + MID + "  ") : "none",
      bes.length
        ? "Underlying prices at which the position is exactly flat at expiry."
        : "The payoff never crosses zero: this position is either profitable everywhere " +
          "at expiry or loss-making everywhere.");

    /* ---- the greeks, each with its own unit and its own absence ---- */
    const dlt = greekTotal(legs, "dl");
    const gmt = greekTotal(legs, "gm");
    const tht = greekTotal(legs, "th");
    const vgt = greekTotal(legs, "vg");
    const rht = greekTotal(legs, "rh");
    const withheld = (t) => "Withheld: " + t.missing.map(legLabel).join("; ") +
      " carries no such greek from the provider. A sum that skipped it would be a " +
      "confident number about a position nobody holds.";

    add("Position delta",
      dlt.value === null ? DASH : fmtNum(dlt.value, 1) + " share-equivalents",
      dlt.value === null ? withheld(dlt)
        : "The shares of the underlying this position currently behaves like.");

    /* BETA-WEIGHTED DELTA, DONE PROPERLY OR NOT AT ALL. It is not delta times
       beta. The relation is stated in full here and the two inputs it needs
       beyond delta — this name's beta and the reference index's live price —
       are both printed in the context strip above, so nothing in it is a
       parameter the reader cannot see. */
    const c = state.context || {};
    const beta = isNum(c.beta);
    const idxSpot = c.index ? isNum(c.index.spot) : null;
    const spot = isNum(c.spot);
    const idxName = (c.index && c.index.symbol) || "the index";
    let bw = null;
    if (dlt.value !== null && beta !== null && idxSpot !== null && idxSpot > 0 && spot !== null) {
      bw = dlt.value * beta * (spot / idxSpot);
    }
    add("Beta-weighted delta",
      bw === null ? DASH : fmtNum(bw, 1) + " " + idxName + " share-equivalents",
      bw === null
        ? "Withheld. It needs the position delta, this name's beta and a live price for " +
          "the reference index, and at least one of those is absent above. It is NOT " +
          "delta times beta, so there is no cheaper version of it to print instead."
        : "delta × beta × (this name's price ÷ " + idxName + "'s price) = " +
          fmtNum(dlt.value, 1) + " × " + fmtPlain(beta, 2) + " × (" + fmtPx(spot) + " ÷ " +
          fmtPx(idxSpot) + "). Weighted to " + idxName + "; against a different index it " +
          "is a different number.");

    add("Position gamma",
      gmt.value === null ? DASH : fmtNum(gmt.value, 2) + " share-equivalents per $1",
      gmt.value === null ? withheld(gmt)
        : "How much the position delta above changes for a one-dollar move in the underlying.");

    add("Decay, one day",
      tht.value === null ? DASH : fmtUSD(tht.value, true) + " per day",
      tht.value === null ? withheld(tht)
        : "The provider's theta, taken as a one-day derivative of each contract's price. " +
          "That reading of the field is the vendor's convention, restated because it is one.");

    /* THE MONTHLY FIGURE IS A CONVENTION AND WEARS THE LABEL, exactly the way
       the premium desk's annualised yield carries `annualizedIsConvention`.
       Theta is convex in time: thirty days of decay is not thirty of today's,
       and the number is offered because it is the scale a reader compares
       against a position's cost — not because anybody collects it. */
    add("Decay, thirty days",
      tht.value === null ? DASH : fmtUSD(tht.value * 30, true) + " — a convention",
      tht.value === null ? withheld(tht)
        : "Thirty times a one-day derivative, which is a LINEAR extrapolation of a CONVEX " +
          "function and therefore a convention rather than a forecast. Nobody earns or " +
          "pays this number; it is here for scale.");

    add("Vega exposure",
      vgt.value === null ? DASH : fmtUSD(vgt.value, true) + " per volatility point",
      vgt.value === null ? withheld(vgt)
        : "What one point of implied volatility, added to every leg at once, is worth. " +
          "Vega read as a per-one-point quantity is the vendor's convention.");

    add("Rho exposure",
      rht.value === null ? DASH : fmtUSD(rht.value, true) + " per rate point",
      rht.value === null ? withheld(rht)
        : "The provider's rho, summed. It is printed because it was quoted — this page " +
          "has no interest rate of its own to move, which is the parameter it declined " +
          "to invent.");

    host.append(dl);

    if (note) {
      note.textContent =
        "The first six readings are exact arithmetic on the quotes in the table above and " +
        "on the strikes — no volatility, no rate, no distribution. The greeks below them " +
        "are the provider's own per-contract numbers, signed by side, multiplied by the " +
        "quantity and by 100 shares per contract, and summed. Buying power reduction and " +
        "conditional value at risk are refused; the panel at the foot says why.";
    }
  }

  /* ---------- the diagram ---------------------------------------- */

  const PLOT_H = 260;
  const PAD = { top: 18, right: 16, bottom: 34, left: 62 };

  function renderPlot(host, note, legs, cost, ext, bes) {
    if (!host) return;
    /* MEASURED FROM A VISIBLE HOST. A hidden element reports clientWidth 0,
       and FlowsUI's own contract is that one viewBox unit is one CSS pixel —
       so a width taken while the panel was still hidden would stretch every
       unit and the whole drawing with it. The panel is unhidden by
       renderPosition() before this runs.

       300 IS THE FLOOR THIS FILE ALREADY USES, stated at .fc-panel in
       flows.css: below it a chart is clamped up and letterboxed rather than
       drawn at a scale where 10px axis type renders at 7. The panel gives its
       side padding back to the chart under 30rem for exactly this reason, so
       the clamp almost never fires; when it does, `max-width: 100%` keeps the
       drawing inside its box at the cost of the pixel contract, which is the
       trade every other chart in this section already makes. */
    const width = Math.max(300, host.clientWidth || 0);

    const spot = isNum((state.context || {}).spot);
    const strikes = strikesOf(legs);
    const marks = [...strikes, ...bes];
    if (spot !== null) marks.push(spot);
    let lo = Math.max(0, Math.min(...marks) * 0.8);
    let hi = Math.max(...marks) * 1.2;
    if (!(hi > lo)) { lo = Math.max(0, (marks[0] || 1) * 0.5); hi = (marks[0] || 1) * 1.5; }

    /* THE EXPIRY LINE IS SAMPLED AT ITS BREAKPOINTS, NOT ON A GRID. It is
       piecewise linear, so its vertices ARE the strikes and the two ends; a
       grid would round every corner off by half a cell and would occasionally
       draw a peak that is not where the peak is. */
    const xs = [lo, ...strikes.filter((k) => k > lo && k < hi), hi];
    xs.sort((a, b) => a - b);
    const expiryPts = xs.map((S) => ({ x: S, y: payoffAt(legs, cost, S) }));

    /* The projected curve, only when every leg carries every greek it needs,
       and only inside the nearest expiry — see the slider's own bound. */
    const days = state.scene.days;
    const vol = state.scene.vol;
    let projPts = null;
    if (days > 0 || vol !== 0) {
      const mark = markValue(legs);
      if (mark !== null) {
        const pts = [];
        let ok = true;
        for (let i = 0; i <= 72; i++) {
          const S = lo + (hi - lo) * (i / 72);
          const t = taylor(legs, { dS: spot === null ? 0 : S - spot, dDays: days, dVol: vol });
          if (t === null) { ok = false; break; }
          pts.push({ x: S, y: mark + t - cost });
        }
        if (ok && spot !== null) projPts = pts;
      }
    }

    const ys = expiryPts.map((p) => p.y);
    if (projPts) for (const p of projPts) ys.push(p.y);
    ys.push(0);
    let yLo = Math.min(...ys), yHi = Math.max(...ys);
    const padY = Math.max(1, (yHi - yLo) * 0.12);
    yLo -= padY; yHi += padY;

    const X = (v) => PAD.left + (v - lo) / (hi - lo) * (width - PAD.left - PAD.right);
    const Y = (v) => PAD.top + (yHi - v) / (yHi - yLo) * (PLOT_H - PAD.top - PAD.bottom);

    const svg = svgEl("svg", {
      class: "sg-plot",
      width, height: PLOT_H,
      viewBox: `0 0 ${width} ${PLOT_H}`,
      role: "img",
    });
    /* THE DRAWING IS NOT THE ONLY CHANNEL. The readings above carry every
       number in this picture as text, and the table below carries the payoff
       at each turning point — so a reader who cannot see the line is not
       missing a reading, only a shape. The label says the shape. */
    const caption = svgEl("title", {});
    caption.textContent =
      "Profit and loss at expiry against the underlying price, from " + fmtPx(lo) +
      " to " + fmtPx(hi) + ". Maximum profit " +
      (ext.profitUnbounded ? "unbounded" : fmtUSD(ext.maxProfit, true)) +
      ", maximum loss " + (ext.lossUnbounded ? "unbounded" : fmtUSD(ext.maxLoss, true)) +
      (bes.length ? ", breakeven at " + bes.map(fmtPx).join(" and ") : ", no breakeven") + ".";
    svg.append(caption);

    /* THE ZERO RULE IS THE SIGN CHANNEL. Profit is above this line and loss is
       below it, which is a POSITION and survives greyscale, a monochrome
       printout and every form of colour blindness. Nothing on this diagram
       carries its sign in a hue. */
    const zeroY = Y(0);
    svg.append(svgEl("line", {
      class: "sg-zero", x1: PAD.left, y1: zeroY.toFixed(2),
      x2: width - PAD.right, y2: zeroY.toFixed(2),
    }));
    const zlab = svgEl("text", {
      class: "sg-axis", x: PAD.left - 6, y: (zeroY + 3).toFixed(2), "text-anchor": "end",
    });
    zlab.textContent = "$0";
    svg.append(zlab);

    for (const [v, anchor] of [[yHi, "end"], [yLo, "end"]]) {
      const t = svgEl("text", {
        class: "sg-axis", x: PAD.left - 6,
        y: (Y(v) + (v === yHi ? 8 : 0)).toFixed(2), "text-anchor": anchor,
      });
      t.textContent = fmtUSD(v, true);
      svg.append(t);
    }

    for (const k of strikes) {
      if (k <= lo || k >= hi) continue;
      svg.append(svgEl("line", {
        class: "sg-strike", x1: X(k).toFixed(2), y1: PAD.top,
        x2: X(k).toFixed(2), y2: PLOT_H - PAD.bottom,
      }));
    }

    if (spot !== null && spot > lo && spot < hi) {
      svg.append(svgEl("line", {
        class: "sg-spot", x1: X(spot).toFixed(2), y1: PAD.top,
        x2: X(spot).toFixed(2), y2: PLOT_H - PAD.bottom,
      }));
      const t = svgEl("text", {
        class: "sg-axis sg-axis--spot", x: X(spot).toFixed(2),
        y: (PLOT_H - PAD.bottom + 22).toFixed(2), "text-anchor": "middle",
      });
      t.textContent = "spot " + fmtPx(spot);
      svg.append(t);
    }

    for (const [v, anchor] of [[lo, "start"], [hi, "end"]]) {
      const t = svgEl("text", {
        class: "sg-axis", x: X(v).toFixed(2),
        y: (PLOT_H - PAD.bottom + 14).toFixed(2), "text-anchor": anchor,
      });
      t.textContent = fmtPx(v);
      svg.append(t);
    }

    if (projPts) {
      svg.append(svgEl("polyline", {
        class: "sg-proj",
        points: projPts.map((p) => X(p.x).toFixed(2) + "," + Y(p.y).toFixed(2)).join(" "),
      }));
    }
    svg.append(svgEl("polyline", {
      class: "sg-payoff",
      points: expiryPts.map((p) => X(p.x).toFixed(2) + "," + Y(p.y).toFixed(2)).join(" "),
    }));

    for (const b of bes) {
      if (b <= lo || b >= hi) continue;
      svg.append(svgEl("circle", {
        class: "sg-be", cx: X(b).toFixed(2), cy: zeroY.toFixed(2), r: 3,
      }));
    }

    host.append(svg);
    host.append(payoffTable(legs, cost, bes, spot));

    if (note) {
      const bits = [
        "The SOLID line is the payoff at expiry and it is exact: at expiry an option is " +
        "worth its intrinsic value, so nothing here needs a volatility, a rate or a " +
        "distribution. Profit is above the $0 rule and loss is below it — the sign is " +
        "carried by position, never by colour.",
      ];
      if (projPts) {
        bits.push("The DASHED line is a Taylor expansion in the provider's own greeks at " +
          days + " day" + (days === 1 ? "" : "s") + " from now" +
          (vol ? " with implied volatility " + fmtNum(vol, 1) + " point" +
            (Math.abs(vol) === 1 ? "" : "s") + " higher on every leg" : "") +
          ". It is a LOCAL approximation and is least accurate exactly where you are " +
          "looking hardest: near a strike, where gamma is largest, and near expiry.");
      } else if (days > 0 || vol !== 0) {
        bits.push("No projected line: it needs delta, gamma, theta and vega for every leg, " +
          "and at least one leg is missing one of them. A curve drawn from the legs that " +
          "have greeks would be a picture of a different position.");
      } else {
        bits.push("Move the day slider or the volatility field below to draw a projected " +
          "curve over this one.");
      }
      note.textContent = bits.join(" ");
    }
  }

  /**
   * THE PAYOFF AT EVERY TURNING POINT, AS TEXT.
   *
   * A diagram cannot be read to the dollar, and this is the page's central
   * claim — so the numbers the line is drawn from are printed beside it rather
   * than left to a reader's eye against an axis. It is also the reading a
   * screen reader gets, and it is the only form of the payoff that can be
   * quoted, copied or checked.
   */
  function payoffTable(legs, cost, bes, spot) {
    const wrap = el("div", "flows-tablewrap sg-payoffwrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Profit and loss at expiry, at each turning point");
    const table = el("table", "flows-table sg-payoff-t");
    const cap = el("caption", "flows-caption",
      "The payoff is piecewise linear, so these rows are its corners and its ends — " +
      "between any two of them it is a straight line. Zero is a MEASURED payoff at a " +
      "breakeven, not an absence.");
    const thead = el("thead");
    const hr = el("tr");
    for (const [h, cls] of [["Underlying at expiry", ""], ["P&L", "c-num"], ["What it is", ""]]) {
      const th = el("th", cls, h);
      th.scope = "col";
      hr.append(th);
    }
    thead.append(hr);
    const tbody = el("tbody");

    const rows = [];
    const push = (S, what) => {
      if (!Number.isFinite(S) || S < 0) return;
      const seen = rows.find((r) => Math.abs(r.S - S) < 1e-9);
      if (seen) { if (!seen.what.includes(what)) seen.what.push(what); return; }
      rows.push({ S, what: [what] });
    };
    push(0, "the underlying at zero");
    for (const k of strikesOf(legs)) push(k, "a strike");
    for (const b of bes) push(b, "breakeven");
    if (spot !== null) push(spot, "spot today");
    rows.sort((a, b) => a.S - b.S);

    for (const r of rows) {
      const tr = el("tr");
      const th = el("th", null, fmtPx(r.S));
      th.scope = "row";
      tr.append(th);
      tr.append(el("td", "c-num", fmtUSD(payoffAt(legs, cost, r.S), true)));
      tr.append(el("td", null, r.what.join(", ")));
      tbody.append(tr);
    }
    table.append(cap, thead, tbody);
    wrap.append(table);
    return wrap;
  }

  /* ---------- the scenario --------------------------------------- */

  function renderScene(host, note, legs, cost) {
    if (!host) return;
    const c = state.context || {};
    const spot = isNum(c.spot);

    /* THE SLIDER STOPS AT THE NEAREST EXPIRY, and that is the whole design
       decision made visible. A Taylor expansion around today's greeks says
       nothing about a world in which one of the legs has already settled, and
       a slider that ran past it would return a confident number for a
       position that no longer exists in the form it was expanded around. */
    let minDTE = null;
    for (const l of legs) {
      const d = daysBetween(c.asOf, l.expiry);
      if (d === null) continue;
      minDTE = minDTE === null ? d : Math.min(minDTE, d);
    }
    const maxDays = minDTE === null ? 0 : Math.max(0, minDTE);
    if (sceneDays) {
      sceneDays.max = String(maxDays);
      if (state.scene.days > maxDays) state.scene.days = maxDays;
      sceneDays.value = String(state.scene.days);
      sceneDays.disabled = maxDays === 0;
      sceneDays.setAttribute("aria-valuetext", state.scene.days + " of " + maxDays +
        " days to the nearest expiry");
    }
    if (scenePx && document.activeElement !== scenePx) {
      scenePx.value = state.scene.px === null ? "" : String(state.scene.px);
    }

    const px = state.scene.px === null ? spot : state.scene.px;
    const dl = el("dl", "sg-facts");
    const add = (term, value, hint) => {
      const dt = el("dt", null, term);
      if (hint) dt.title = hint;
      dl.append(dt, el("dd", null, value));
    };

    if (px === null) {
      host.append(emptyState("unavailable",
        "No underlying price to run a scenario against: type one above."));
      return;
    }

    add("At expiry, underlying " + fmtPx(px),
      fmtUSD(payoffAt(legs, cost, px), true),
      "Exact. At expiry an option is worth its intrinsic value and nothing else, so this " +
      "number contains no model at all.");

    const mark = markValue(legs);
    const t = taylor(legs, {
      dS: px - (spot === null ? px : spot),
      dDays: state.scene.days,
      dVol: state.scene.vol,
    });
    add("In " + state.scene.days + " day" + (state.scene.days === 1 ? "" : "s") +
      (state.scene.vol ? ", vol " + fmtNum(state.scene.vol, 1) + " pt" : ""),
      t === null || mark === null ? DASH : fmtUSD(mark + t - cost, true),
      t === null
        ? "Withheld: this needs delta, gamma, theta and vega for every leg and at least " +
          "one leg is missing one. There is no partial version of an expansion."
        : mark === null
          ? "Withheld: a leg has no two-sided quote, so the position has no mark to expand from."
          : "A Taylor expansion in the provider's quoted greeks — second order in the " +
            "underlying, first order in time and in implied volatility. A stated " +
            "convention, not a measurement, and least accurate near a strike and near expiry.");

    host.append(dl);

    if (note) {
      note.textContent =
        "Both parameters the projection needs are controls here rather than constants in " +
        "this file: the underlying you are asking about, and how far ahead. The " +
        "volatility shift is the third, below. The day slider stops at " + maxDays +
        (maxDays === 1 ? " day" : " days") + " — the nearest leg's expiry — because past " +
        "that the expansion is around greeks for a contract that has already settled, and " +
        "the exact line above is the answer instead.";
    }
  }

  /* =============================================================
     THE VOLATILITY INPUT

     Built here rather than in the document because it belongs to
     the scenario controls and would otherwise be a fourth id the
     page shell and this file both have to agree about. Its value is
     a POINT of implied volatility — the same unit the vega reading
     is quoted in, said in both places.
     ============================================================= */
  const volField = (() => {
    const scene = document.querySelector("#sgScenePanel .sg-controls");
    if (!scene) return null;
    const span = el("span", "sg-field");
    const label = el("label", null, "Implied vol shift (points)");
    label.htmlFor = "sgSceneVol";
    const input = el("input");
    input.id = "sgSceneVol";
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = String(DEFAULT_VOL_BUMP);
    span.append(label, input);
    scene.append(span);
    return input;
  })();

  /* =============================================================
     WIRING
     ============================================================= */

  entry.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = String(tickerInput.value || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) {
      if (statusEl) {
        statusEl.textContent = "That is not a symbol this page accepts: one to ten " +
          "characters, starting with a letter.";
        statusEl.dataset.empty = "unavailable";
      }
      return;
    }
    if (t === state.ticker) { loadContext(true); return; }
    state.ticker = t;
    state.context = null;
    state.expiry = "";
    state.books.clear();
    state.bookError.clear();
    state.bookPending.clear();
    /* THE LEGS DO NOT SURVIVE A CHANGE OF NAME. A position built on NVDA
       contracts is not a position on AMD, and carrying the legs across would
       leave rows nothing in the new book can price — silently unresolvable,
       and indistinguishable from a book that failed to load. */
    state.legs = [];
    state.scene.px = null;
    loadContext(false);
  });

  if (repriceBtn) repriceBtn.addEventListener("click", () => {
    loadContext(true);
    if (state.expiry) loadExpiry(state.expiry, true);
  });

  if (expirySel) expirySel.addEventListener("change", () => {
    state.expiry = expirySel.value;
    render();
    loadExpiry(state.expiry);
  });

  if (windowSel) windowSel.addEventListener("change", () => {
    const v = Number(windowSel.value);
    state.window = Number.isFinite(v) ? v : 0.25;
    render();
  });

  if (basisSel) basisSel.addEventListener("change", () => {
    state.basis = basisSel.value === "marketable" ? "marketable" : "mid";
    render();
  });

  if (clearBtn) clearBtn.addEventListener("click", () => { state.legs = []; render(); });

  if (scenePx) scenePx.addEventListener("input", () => {
    const raw = String(scenePx.value || "").replace(/[$,\s]/g, "");
    const n = raw === "" ? null : Number(raw);
    /* TESTED FOR ABSENCE BEFORE COERCION, in the one place on this page where
       a reader can type an empty string: Number("") is 0 and 0 is a real
       underlying price, so the naive read would answer "what does this pay if
       the stock goes to zero" every time the field is cleared. */
    state.scene.px = raw === "" || !Number.isFinite(n) || n < 0 ? null : n;
    renderPosition();
  });

  if (sceneDays) sceneDays.addEventListener("input", () => {
    const n = Number(sceneDays.value);
    state.scene.days = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    renderPosition();
  });

  if (volField) volField.addEventListener("input", () => {
    const raw = String(volField.value || "").trim();
    const n = raw === "" ? 0 : Number(raw);
    state.scene.vol = Number.isFinite(n) ? n : 0;
    renderPosition();
  });

  /* THE AGE TICKS, NOTHING ELSE DOES. Only the context strip depends on wall
     clock; re-rendering the whole page on a timer would fight a reader typing
     in the scenario field. Thirty seconds because the age is printed in
     minutes and nothing here is a live quote. */
  setInterval(() => { if (state.context) renderContext(); }, 30000);

  /* Redraw on resize because the SVG is sized in CSS pixels rather than in
     percentages — one viewBox unit is one pixel, which is FlowsUI's contract
     and the reason its charts do not stretch. */
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.legs.length) renderPosition(); }, 150);
  });

  readURL();
  if (basisSel) basisSel.value = state.basis;
  if (windowSel) windowSel.value = String(state.window);
  if (tickerInput && state.ticker) tickerInput.value = state.ticker;
  render();
  if (state.ticker) loadContext(false);
})();
