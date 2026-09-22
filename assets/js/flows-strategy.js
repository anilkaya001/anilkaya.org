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

  const MULT = 100;

  const DEFAULT_VOL_BUMP = 0;

  const fmtUSD = (v, signed, dp) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const d = dp === undefined ? 2 : dp;
    const c = Math.round(n * 10 ** d) / 10 ** d;
    const body = "$" + Math.abs(c).toLocaleString("en-US",
      { minimumFractionDigits: d, maximumFractionDigits: d });
    return (c < 0 ? MINUS : signed && c > 0 ? "+" : "") + body;
  };

  const fmtPx = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const s = (n < 0 ? MINUS : "") + "$" + Math.abs(n).toFixed(2);
    return s.replace(/\.00$/, "");
  };

  const fmtQuote = (v) => {
    const n = isNum(v);
    return n === null ? DASH : "$" + n.toFixed(2);
  };

  const fmtNum = (v, dp) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const d = dp === undefined ? 2 : dp;
    const c = Math.round(n * 10 ** d) / 10 ** d;
    return (c < 0 ? MINUS : c > 0 ? "+" : "") + Math.abs(c).toFixed(d);
  };

  const fmtPlain = (v, dp) => {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(dp === undefined ? 2 : dp);
  };

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

  const daysBetween = (fromDay, toDay) => {
    const a = Date.parse(String(fromDay).slice(0, 10) + "T00:00:00Z");
    const b = Date.parse(String(toDay).slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  };

  const signOf = (leg) => (leg.side === "long" ? 1 : -1);

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

  function netCost(legs) {
    let sum = 0;
    for (const l of legs) {
      if (l.price === null) return null;
      sum += signOf(l) * l.qty * MULT * l.price;
    }
    return sum;
  }

  function markValue(legs) {
    let sum = 0;
    for (const l of legs) {
      if (l.mid === null) return null;
      sum += signOf(l) * l.qty * MULT * l.mid;
    }
    return sum;
  }

  const intrinsic = (type, k, S) => (type === "call" ? Math.max(0, S - k) : Math.max(0, k - S));

  function payoffAt(legs, cost, S) {
    let v = 0;
    for (const l of legs) v += signOf(l) * l.qty * MULT * intrinsic(l.type, l.k, S);
    return v - cost;
  }

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

  function extremes(legs, cost) {
    const rs = rightSlope(legs);
    const cands = [{ S: 0, p: payoffAt(legs, cost, 0) }];
    for (const k of strikesOf(legs)) cands.push({ S: k, p: payoffAt(legs, cost, k) });
    let best = cands[0].p, worst = cands[0].p;
    for (const c of cands) {
      if (c.p > best) best = c.p;
      if (c.p < worst) worst = c.p;
    }

    const at = (target) => cands
      .map((c, i) => ({ ...c, i }))
      .filter((c) => Math.abs(c.p - target) < 1e-9);
    const spread = (list) => list.length > 1 && list[list.length - 1].i - list[0].i === list.length - 1;

    const runs = (list) => {
      const out = [];
      for (const c of list) {
        const last = out[out.length - 1];
        if (last && c.i === last[last.length - 1].i + 1) last.push(c);
        else out.push([c]);
      }
      return out.map((r) => ({ from: r[0].S, to: r[r.length - 1].S, flat: r.length > 1 }));
    };
    const bestAt = at(best), worstAt = at(worst);

    const topK = cands[cands.length - 1].S;
    const toRight = (list) => rs === 0 && list.some((c) => c.S === topK);
    return {
      rightSlope: rs,
      profitUnbounded: rs > 0,
      lossUnbounded: rs < 0,
      maxProfit: rs > 0 ? null : best,
      maxProfitAt: rs > 0 ? null : bestAt.map((c) => c.S),
      maxProfitFlat: rs > 0 ? false : spread(bestAt),
      maxProfitToRight: rs > 0 ? false : toRight(bestAt),
      maxProfitRuns: rs > 0 ? null : runs(bestAt),
      maxLoss: rs < 0 ? null : worst,
      maxLossAt: rs < 0 ? null : worstAt.map((c) => c.S),
      maxLossFlat: rs < 0 ? false : spread(worstAt),
      maxLossToRight: rs < 0 ? false : toRight(worstAt),
      maxLossRuns: rs < 0 ? null : runs(worstAt),
    };
  }

  function whereText(runs, toRight) {
    if (!runs || !runs.length) return "";
    const ray = toRight
      ? " and at every price above " + fmtPx(runs[runs.length - 1].to) : "";

    if (runs.length === 1) {
      const r = runs[0];
      return (r.flat
        ? "anywhere from " + fmtPx(r.from) + " to " + fmtPx(r.to) +
          " at expiry, where the payoff is flat"
        : "at an underlying of " + fmtPx(r.from) + " at expiry") + ray;
    }

    return "at expiry " + runs.map((r) => (r.flat
      ? "anywhere from " + fmtPx(r.from) + " to " + fmtPx(r.to) +
        " (where the payoff is flat)"
      : "at " + fmtPx(r.from))).join(", ") + ray;
  }

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

  const TAYLOR_GREEKS = ["dl", "gm", "th", "vg"];

  function taylor(legs, { dS, dDays, dVol }) {
    let sum = 0;
    for (const l of legs) {
      for (const g of TAYLOR_GREEKS) if (l[g] === null) return null;
      const per = l.dl * dS + 0.5 * l.gm * dS * dS + l.th * dDays + l.vg * dVol;
      sum += signOf(l) * l.qty * MULT * per;
    }
    return sum;
  }

  const state = {
    ticker: "",
    context: null,
    contextAt: null,
    contextAge: null,
    contextError: null,
    expiry: "",
    books: new Map(),
    bookError: new Map(),

    bookPending: new Set(),
    loading: 0,
    legs: [],
    basis: "mid",
    window: 0.25,
    scene: { px: null, days: 0, vol: DEFAULT_VOL_BUMP },

    centred: null,
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

  async function readStrategy(params) {
    const response = await fetch("/api/flows/strategy?" + params.toString(), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {

      location.replace("/flows/");
      return { gone: true };
    }
    const age = isNum(response.headers.get("X-Chain-Age"));
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body && body.error && body.error.code;
      return { error: messageFor(response.status, code) };
    }

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

    if (ticker !== state.ticker) return;
    if (out.error) state.bookError.set(expiry, out.error);
    else state.books.set(expiry, out.body);
    render();
  }

  function resolveLegs() {
    const resolved = [], unresolved = [];
    for (const leg of state.legs) {
      const book = state.books.get(leg.expiry);
      const rows = book ? (leg.type === "call" ? book.calls : book.puts) : null;
      const row = rows ? rows.find((r) => r.sym === leg.sym) : null;
      if (!row) {
        unresolved.push({
          leg,

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

    if (state.context.expirySource === "exposure") {
      parts.push("listed from open interest rather than the session's activity, " +
        "so no expiry above carries its contract count");
    }
    parts.push(state.legs.length
      ? state.legs.length + (state.legs.length === 1 ? " leg" : " legs")
      : "no legs yet — use Buy or Sell on a row below");
    statusEl.textContent = parts.join(" " + MID + " ");
  }

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
      const cell = el("div", "sg-fact");
      const dt = el("dt", null, term);
      if (hint) dt.title = hint;
      cell.append(dt, el("dd", null, value));
      dl.append(cell);
    };

    add("Spot", fmtPx(c.spot) + " " + MID + " " +
      (c.spotSource === "stock-state" ? "live print" : "prior daily close"),
      "The price every reading on this page is measured from.");

    const ageText = contextAgeText();
    add("Read", ageText.text, ageText.hint);

    add("Session", c.asOf || DASH, "The trading session the days-to-expiry count is measured from.");

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

    const windowEmpty = width > 0 && shown.length === 0 && rows.length > 0;
    const use = shown.length ? shown : rows;

    const atm = atmStrike(use, spot);
    for (const r of use) chainBody.append(strikeRow(r, spot, atm));
    if (chainWrap) chainWrap.hidden = false;

    const anchor = state.expiry + "/" + width;
    if (chainWrap && atm !== null && state.centred !== anchor) {
      state.centred = anchor;
      const row = chainBody.querySelector("tr.is-atm");
      if (row) {

        const mid = row.offsetTop - (chainWrap.clientHeight / 2) + (row.offsetHeight / 2);
        chainWrap.scrollTop = Math.max(0, mid);
      }
    }

    if (note) {
      note.textContent = "";
      const bits = [];

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

      const off = isNum(book.offExpiry);
      if (off !== null && off > 0) {
        bits.push(off + " row" + (off === 1 ? "" : "s") + " the provider returned " +
          "belonged to a different expiry or a different option type and were dropped. " +
          "This table asked for one expiry and one type at a time, so what came back " +
          "is not what was asked for — treat the strike list here as incomplete.");
      }
      if (book.ivBasis) bits.push("Implied volatility units, resolved once for the whole expiry: " + book.ivBasis + ".");
      note.textContent = bits.join(" ");
    }
  }

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

  function atmStrike(rows, spot) {
    if (spot === null) return null;
    let best = null, gap = Infinity;
    for (const r of rows) {
      const d = Math.abs(r.k - spot);
      if (d < gap) { gap = d; best = r.k; }
    }
    return best;
  }

  function strikeRow(entryRow, spot, atm) {
    const tr = el("tr");

    if (atm !== null && entryRow.k === atm) tr.className = "is-atm";

    const quoteCells = (row, side) => {
      const cells = [];
      const num = (text) => el("td", "c-num", text);
      if (!row) {
        for (let i = 0; i < 4; i++) {
          const td = num(DASH);
          td.title = "No " + side + " is listed at this strike";
          cells.push(td);
        }
        return cells;
      }
      const quote = (which) => {
        const px = isNum(which === "bid" ? row.bid : row.ask);
        const td = el("td", "c-num sg-q");
        if (px === null) {
          td.textContent = DASH;
          td.title = "The provider quotes no " + which + " for this contract, so there is " +
            "nothing to price a leg at.";
          return td;
        }
        const dir = which === "ask" ? "long" : "short";
        const b = el("button", "sg-qb sg-qb--" + dir, fmtQuote(px));
        b.type = "button";
        b.setAttribute("aria-label",
          (dir === "long" ? "Buy" : "Sell") + " the " + state.expiry + " " +
          fmtPx(entryRow.k) + " " + side + " at the " + which + ", " + fmtQuote(px));
        b.title = (dir === "long" ? "Buy" : "Sell") + " at the " + which;
        b.addEventListener("click", () => addLeg(row.sym, side, dir));
        td.append(b);
        return td;
      };
      cells.push(quote("bid"));
      cells.push(quote("ask"));
      const iv = isNum(row.iv);
      cells.push(num(iv === null ? DASH : (iv * 100).toFixed(1) + "%"));
      cells.push(num(fmtNum(row.dl, 3)));
      return cells;
    };

    const c = quoteCells(entryRow.call, "call");
    tr.append(c[3], c[2], c[0], c[1]);

    const th = el("th", "c-num sg-k", fmtPx(entryRow.k));
    th.scope = "row";
    tr.append(th);

    const p = quoteCells(entryRow.put, "put");
    tr.append(p[0], p[1], p[2], p[3]);
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

  function renderReadings(host, note, legs, cost, ext, bes) {
    if (!host) return;
    const dl = el("dl", "sg-facts");

    const add = (term, value, hint, cls) => {
      const cell = el("div", "sg-fact");
      const dt = el("dt", null, term);
      if (hint) dt.title = hint;
      cell.append(dt, el("dd", cls || null, value));
      dl.append(cell);
    };

    add(cost >= 0 ? "Net debit" : "Net credit", fmtUSD(Math.abs(cost)),
      "What opening the whole position costs (a debit) or pays (a credit), " +
      "priced at " + (state.basis === "mid" ? "the mid of each leg" : "the marketable side of each leg") + ".");

    const mark = markValue(legs);
    if (mark !== null) {
      const spread = cost - mark;
      add("Spread crossed", state.basis === "mid" ? "zero by construction" : fmtUSD(spread),
        state.basis === "mid"
          ? "Zero by construction under the mid basis: the mid assumes you trade at it. " +
            "Switch the basis above to see what crossing actually costs."
          : "What the position is down the instant it is opened, purely from paying the " +
            "ask and receiving the bid on every leg.",
        state.basis === "mid" ? "is-unbounded" : null);
    }

    add("Max profit",
      ext.profitUnbounded ? "unbounded" : fmtUSD(ext.maxProfit, true),
      ext.profitUnbounded
        ? "The position is net long calls, so its profit rises without limit as the " +
          "underlying rises. There is no number here, so none is printed."
        : "Reached " + whereText(ext.maxProfitRuns, ext.maxProfitToRight) + ".",
      ext.profitUnbounded ? "is-unbounded" : null);

    const zeroOnly = !ext.lossUnbounded && ext.maxLossAt.length === 1 && ext.maxLossAt[0] === 0;
    add("Max loss",
      ext.lossUnbounded ? "unbounded" : fmtUSD(ext.maxLoss, true),
      ext.lossUnbounded
        ? "The position is net short calls. A share has no upper bound, so neither does " +
          "this loss — which is why it is reported as unbounded and not as a large number."
        : "Reached " + whereText(ext.maxLossRuns, ext.maxLossToRight) + "." +
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

  const PLOT_H = 300;
  const PAD = { top: 18, right: 16, bottom: 34, left: 62 };
  const PROJ_BAND = 0.15;
  let zoneSeq = 0;

  function renderPlot(host, note, legs, cost, ext, bes) {
    if (!host) return;

    const width = Math.max(300, host.clientWidth || 0);

    const spot = isNum((state.context || {}).spot);
    const strikes = strikesOf(legs);
    const marks = [...strikes, ...bes];
    if (spot !== null) marks.push(spot);
    let lo = Math.max(0, Math.min(...marks) * 0.8);
    let hi = Math.max(...marks) * 1.2;
    if (!(hi > lo)) { lo = Math.max(0, (marks[0] || 1) * 0.5); hi = (marks[0] || 1) * 1.5; }

    const xs = [lo, ...strikes.filter((k) => k > lo && k < hi), hi];
    xs.sort((a, b) => a - b);
    const expiryPts = xs.map((S) => ({ x: S, y: payoffAt(legs, cost, S) }));

    const days = state.scene.days;
    const vol = state.scene.vol;
    let projPts = null;
    if (days > 0 || vol !== 0) {
      const mark = markValue(legs);
      if (mark !== null && spot !== null) {
        const pts = [];
        let ok = true;
        const b0 = Math.max(lo, spot * (1 - PROJ_BAND)), b1 = Math.min(hi, spot * (1 + PROJ_BAND));
        for (let i = 0; i <= 72; i++) {
          const S = b0 + (b1 - b0) * (i / 72);
          const t = taylor(legs, { dS: S - spot, dDays: days, dVol: vol });
          if (t === null) { ok = false; break; }
          let y = mark + t - cost;
          if (!ext.profitUnbounded) y = Math.min(y, ext.maxProfit);
          if (!ext.lossUnbounded) y = Math.max(y, ext.maxLoss);
          pts.push({ x: S, y });
        }
        if (ok) projPts = pts;
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

    const caption = svgEl("title", {});
    caption.textContent =
      "Profit and loss at expiry against the underlying price, from " + fmtPx(lo) +
      " to " + fmtPx(hi) + ". Maximum profit " +
      (ext.profitUnbounded ? "unbounded" : fmtUSD(ext.maxProfit, true)) +
      ", maximum loss " + (ext.lossUnbounded ? "unbounded" : fmtUSD(ext.maxLoss, true)) +
      (bes.length ? ", breakeven at " + bes.map(fmtPx).join(" and ") : ", no breakeven") + ".";
    svg.append(caption);

    const zeroY = Y(0);
    const zoneId = "sgZone" + (++zoneSeq);
    const defs = svgEl("defs", {});
    const clipUp = svgEl("clipPath", { id: zoneId + "p" });
    clipUp.append(svgEl("rect", { x: 0, y: 0, width, height: Math.max(0, zeroY).toFixed(2) }));
    const clipDn = svgEl("clipPath", { id: zoneId + "l" });
    clipDn.append(svgEl("rect", { x: 0, y: zeroY.toFixed(2), width,
      height: Math.max(0, PLOT_H - zeroY).toFixed(2) }));
    defs.append(clipUp, clipDn);
    svg.append(defs);
    const area = [X(lo).toFixed(2) + "," + zeroY.toFixed(2)]
      .concat(expiryPts.map((p) => X(p.x).toFixed(2) + "," + Y(p.y).toFixed(2)))
      .concat([X(hi).toFixed(2) + "," + zeroY.toFixed(2)]).join(" ");
    svg.append(svgEl("polygon", { class: "sg-zone sg-zone--profit", points: area,
      "clip-path": "url(#" + zoneId + "p)" }));
    svg.append(svgEl("polygon", { class: "sg-zone sg-zone--loss", points: area,
      "clip-path": "url(#" + zoneId + "l)" }));
    svg.append(svgEl("line", {
      class: "sg-zero", x1: PAD.left, y1: zeroY.toFixed(2),
      x2: width - PAD.right, y2: zeroY.toFixed(2),
    }));
    const zlab = svgEl("text", {
      class: "sg-axis", x: PAD.left - 6, y: (zeroY + 3).toFixed(2), "text-anchor": "end",
    });
    zlab.textContent = "$0";
    svg.append(zlab);

    const eys = expiryPts.map((p) => p.y);
    for (const v of [Math.max(...eys), Math.min(...eys)]) {
      if (Math.abs(Y(v) - zeroY) < 14) continue;
      const t = svgEl("text", {
        class: "sg-axis", x: PAD.left - 6, y: (Y(v) + 3).toFixed(2), "text-anchor": "end",
      });
      t.textContent = fmtUSD(v, true, 0);
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
        "carried by position, never by colour alone; the profit zone is tinted green and " +
        "the loss zone red so the side reads at a glance, and the tint carries no figure.",
      ];
      if (projPts) {
        bits.push("The DASHED line is a Taylor expansion in the provider's own greeks at " +
          days + " day" + (days === 1 ? "" : "s") + " from now" +
          (vol ? " with implied volatility " + fmtNum(vol, 1) + " point" +
            (Math.abs(vol) === 1 ? "" : "s") + " higher on every leg" : "") +
          ". It is a LOCAL approximation and is least accurate exactly where you are " +
          "looking hardest: near a strike, where gamma is largest, and near expiry. It is " +
          "drawn within 15% of spot only, and clipped to the position's maximum profit " +
          "and loss, which no value before expiry can cross.");
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

  function renderScene(host, note, legs, cost) {
    if (!host) return;
    const c = state.context || {};
    const spot = isNum(c.spot);

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
      const cell = el("div", "sg-fact");
      const dt = el("dt", null, term);
      if (hint) dt.title = hint;
      cell.append(dt, el("dd", null, value));
      dl.append(cell);
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

  setInterval(() => { if (state.context) renderContext(); }, 30000);

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
