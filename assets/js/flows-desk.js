(() => {
  "use strict";

  const entry = document.getElementById("deskEntry");
  const input = document.getElementById("deskInput");
  const list = document.getElementById("deskList");
  const allBox = document.getElementById("deskAll");
  const refreshBtn = document.getElementById("deskRefresh");
  const clearBtn = document.getElementById("deskClear");
  const strategySel = document.getElementById("deskStrategy");
  const rankSel = document.getElementById("deskRank");
  const statusEl = document.getElementById("deskStatus");
  const pane = document.getElementById("deskPane");
  const tableWrap = document.getElementById("deskTableWrap");
  const tbody = document.getElementById("deskBody");
  const foot = document.getElementById("deskFoot");
  const bpInput = document.getElementById("deskBP");
  const bpClear = document.getElementById("deskBPClear");
  const planEl = document.getElementById("deskPlan");
  const collectHead = document.getElementById("deskCollectHead");
  if (!entry || !input || !list || !tbody) return;

  const BASE_COLUMNS = 13;
  const MAX_BUYING_POWER = 1e11;
  const MAX_SYMBOLS = 20;
  const CONCURRENCY = 3;

  const AGE_TICK_MS = 30000;

  const QUOTE_STALE_SECONDS = 300;

  const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

  const MINUS = "−";
  const DASH = "—";

  const book = new Map();
  let inflight = 0;

  let statusOwned = true;
  function say(text) { statusEl.textContent = text; statusOwned = false; }

  let buyingPower = null;

  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const fmt2 = (v) => { const n = isNum(v); return n === null ? DASH : n.toFixed(2); };

  function fmtMoney(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function fmtPct(v, digits) {
    const n = isNum(v);
    if (n === null) return DASH;
    const s = (Math.abs(n) * 100).toFixed(digits === undefined ? 1 : digits);
    return (n < 0 ? MINUS : "") + s + "%";
  }

  function fmtSd(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : "") + Math.abs(n).toFixed(2) + " SD";
  }

  function fmtInt(v) {
    const n = isNum(v);
    return n === null ? DASH : Math.round(n).toLocaleString("en-US");
  }

  function fmtExpiry(iso, days) {
    if (!iso) return DASH;
    const d = isNum(days);
    return d === null ? iso : iso.slice(5) + " (" + d + "d)";
  }

  function formatBuyingPower(v) {
    const n = isNum(v);
    return n === null ? "" : Math.round(n).toLocaleString("en-US");
  }

  function fmtAge(seconds) {
    const n = isNum(seconds);
    if (n === null) return "";
    if (n < 45) return "just now";
    if (n < 5400) return Math.round(n / 60) + "m ago";
    return Math.round(n / 3600) + "h ago";
  }

  function ageOf(payload) {
    if (!payload) return null;
    const base = isNum(payload.__age);
    if (base === null) return null;
    const at = isNum(payload.__at);
    if (at === null) return base;
    return base + Math.max(0, (Date.now() - at) / 1000);
  }

  function quoteAge() {
    let oldest = null, unaged = 0;
    for (const symbol of selectedSymbols()) {
      const state = book.get(symbol);
      if (!state || state.state !== "ok" || !state.payload) continue;
      const age = ageOf(state.payload);
      if (age === null) { unaged++; continue; }
      if (oldest === null || age > oldest) oldest = age;
    }
    return { oldest, unaged };
  }

  function parseBuyingPower(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw)
      .trim().toLowerCase().replace(/[$,\s_]/g, "");
    if (!text) return null;
    const m = /^(\d*\.?\d+)([kmb])?$/.exec(text);
    if (!m) return null;
    const base = Number(m[1]);
    if (!Number.isFinite(base) || base <= 0) return null;
    const scale = m[2] === "b" ? 1e9 : m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1;
    const value = base * scale;
    if (!(value > 0) || value > MAX_BUYING_POWER) return null;
    return value;
  }

  function sizeRow(row, bp) {
    if (bp === null || !(bp > 0)) return null;
    const collateral = isNum(row && row.collateral);
    const premium = isNum(row && row.premium);
    if (collateral === null || !(collateral > 0)) return null;
    if (premium === null || !(premium > 0)) return null;
    const contracts = Math.floor(bp / collateral);
    const deployed = contracts * collateral;
    return {
      contracts,

      affordable: contracts > 0,
      collectible: contracts * premium,
      deployed,
      idle: bp - deployed,
      yieldOnDeployed: deployed > 0 ? (contracts * premium) / deployed : null,
    };
  }

  function readURL() {
    try {
      const q = new URLSearchParams(location.search);
      const raw = (q.get("t") || "").split(/[,\s]+/);
      const strategy = q.get("strategy");
      const rank = q.get("rank");
      if (strategySel && (strategy === "csp" || strategy === "cc")) strategySel.value = strategy;
      if (rankSel && rank && Array.from(rankSel.options).some((o) => o.value === rank)) {
        rankSel.value = rank;
      }

      const wantedSurface = String(q.get("surface") || "").trim().toUpperCase();
      surfaceSymbol = TICKER_RE.test(wantedSurface) ? wantedSurface : null;
      buyingPower = parseBuyingPower(q.get("bp"));
      if (bpInput && buyingPower !== null) bpInput.value = formatBuyingPower(buyingPower);

      if (rankSel && rankSel.value === "collectible" && buyingPower === null) {
        rankSel.value = "annualized";
      }
      return normalise(raw);
    } catch { return []; }
  }

  function writeURL() {
    try {
      const url = new URL(location.href);
      const symbols = Array.from(book.keys());
      if (symbols.length) url.searchParams.set("t", symbols.join(","));
      else url.searchParams.delete("t");
      url.searchParams.set("strategy", strategySel ? strategySel.value : "both");
      url.searchParams.set("rank", rankSel ? rankSel.value : "annualized");
      if (buyingPower !== null) url.searchParams.set("bp", String(Math.round(buyingPower)));
      else url.searchParams.delete("bp");
      if (surfaceSymbol !== null && book.has(surfaceSymbol)) url.searchParams.set("surface", surfaceSymbol);
      else url.searchParams.delete("surface");
      history.replaceState(null, "", url);
    } catch {   }
  }

  function normalise(raw) {
    const out = [];
    for (const piece of raw) {
      const t = String(piece || "").trim().toUpperCase();
      if (!TICKER_RE.test(t)) continue;
      if (out.includes(t)) continue;
      out.push(t);
      if (out.length >= MAX_SYMBOLS) break;
    }
    return out;
  }

  function noteFor(entryState) {
    if (!entryState) return "";
    if (entryState.state === "loading") return "loading…";
    if (entryState.state === "error") return entryState.error || "failed";
    const p = entryState.payload;
    if (!p) return "";
    const parts = [];
    if (isNum(p.spot) !== null) {

      parts.push("$" + fmt2(p.spot) + (p.spotSource === "daily-close" ? " close" : ""));
    }

    const shown = (p.rows || []).length;
    const priced = isNum(p.priced);
    parts.push((priced !== null && shown < priced
      ? fmtInt(shown) + " of " + fmtInt(priced)
      : fmtInt(priced)) + " sellable" + (p.truncated ? " of a partial chain" : ""));

    const seconds = ageOf(p);

    parts.push(seconds === null ? "age not stated" : fmtAge(seconds));
    return parts.join(" · ");
  }

  function renderList() {
    list.textContent = "";
    if (!book.size) {
      allBox.checked = false;
      allBox.indeterminate = false;
      allBox.disabled = true;
      return;
    }
    allBox.disabled = false;

    for (const [symbol, entryState] of book) {
      const chip = document.createElement("div");
      chip.className = "desk-chip is-" + entryState.state;

      const label = document.createElement("label");
      label.className = "desk-check";

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = entryState.selected;

      box.setAttribute("aria-label", "Include " + symbol);
      box.addEventListener("change", () => {
        entryState.selected = box.checked;
        syncAll();
        render();
      });

      const name = document.createElement("span");
      name.className = "desk-chip__sym";
      name.textContent = symbol;

      label.append(box, name);
      chip.append(label);

      const note = document.createElement("span");
      note.className = "desk-chip__note";
      note.textContent = noteFor(entryState);

      entryState.__note = note;
      chip.append(note);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "desk-chip__x";
      remove.setAttribute("aria-label", "Remove " + symbol);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        book.delete(symbol);
        writeURL();
        renderList();
        render();
      });
      chip.append(remove);

      list.append(chip);
    }
    syncAll();
  }

  function syncAll() {
    if (!book.size) { allBox.checked = false; allBox.indeterminate = false; return; }
    let on = 0;
    for (const e of book.values()) if (e.selected) on++;
    allBox.checked = on === book.size;
    allBox.indeterminate = on > 0 && on < book.size;
  }

  function serverRank(key) {
    return key === "collectible" ? "yieldOnCollateral" : key;
  }

  async function fetchOne(symbol, { refresh = false } = {}) {
    const state = book.get(symbol);
    if (!state) return;
    state.state = "loading";
    state.error = null;

    const seq = (state.seq || 0) + 1;
    state.seq = seq;
    renderList();

    const params = new URLSearchParams({
      t: symbol,
      strategy: strategySel ? strategySel.value : "both",
      rank: serverRank(rankSel ? rankSel.value : "annualized"),
    });
    if (refresh) params.set("refresh", "1");

    try {
      const response = await fetch("/api/flows/chain?" + params.toString(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {

        location.replace("/flows/");
        return;
      }

      const age = isNum(response.headers.get("X-Chain-Age"));
      const body = await response.json().catch(() => null);

      if (state.seq !== seq) return;
      if (!response.ok) {
        state.state = "error";
        state.error = messageFor(response.status, body);
        state.payload = null;
      } else if (!body) {

        state.state = "error";
        state.error = "unreadable response";
        state.payload = null;
      } else {
        state.state = "ok";
        state.payload = body;

        body.__age = age === null ? undefined : age;
        body.__at = age === null ? undefined : Date.now();
      }
    } catch {

      if (state.seq !== seq) return;
      state.state = "error";
      state.error = "network error";
      state.payload = null;
    }
    renderList();
    render();
  }

  function messageFor(status, body) {
    const code = body && body.error && body.error.code;
    if (code === "chain_empty" || status === 404) return "no listed options";
    if (code === "chain_rate_limited" || status === 429) return "rate limited — try again shortly";
    if (code === "chain_unconfigured") return "live lookup not configured";
    if (code === "chain_no_spot") return "no usable price";
    if (status >= 500) return "data provider unavailable";
    if (status === 400) return "not a valid symbol";
    return "failed (" + status + ")";
  }

  async function runPool(symbols, options) {
    const queue = symbols.slice();
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      workers.push((async () => {
        while (queue.length) {
          const next = queue.shift();
          inflight++;
          updateStatus();
          try { await fetchOne(next, options); } finally { inflight--; }
          updateStatus();
        }
      })());
    }
    await Promise.all(workers);
  }

  function selectedSymbols() {
    return Array.from(book.entries()).filter(([, e]) => e.selected).map(([s]) => s);
  }

  function render() {
    const chosen = selectedSymbols();
    const rows = [];
    let screened = 0, priced = 0;
    const gatedTotals = Object.create(null);

    const slices = [];

    const uncounted = [];

    for (const symbol of chosen) {
      const state = book.get(symbol);
      if (!state || state.state !== "ok" || !state.payload) continue;
      const p = state.payload;
      const kept = (p.rows || []).length;
      const screenedN = isNum(p.screened);
      const sellable = isNum(p.priced);

      if (screenedN === null || sellable === null) uncounted.push(symbol);
      else {
        screened += screenedN;
        priced += sellable;

        for (const [reason, n] of Object.entries(p.gated || {})) {
          gatedTotals[reason] = (gatedTotals[reason] || 0) + (isNum(n) || 0);
        }
      }
      if (sellable !== null && kept < sellable) {
        slices.push({ symbol, kept, sellable, rankedBy: p.rankedBy || null });
      }
      for (const r of p.rows || []) rows.push({ ...r, __spot: p.spot });
    }

    for (const r of rows) r.__sizing = sizeRow(r, buyingPower);

    renderSurface();

    const key = rankSel ? rankSel.value : "annualized";
    const sortKey = key === "collectible"
      ? (r) => (r.__sizing ? r.__sizing.collectible : null)
      : (r) => r[key];
    rows.sort((a, b) => {
      const x = sortKey(a), y = sortKey(b);
      const xn = x === null || x === undefined ? null : isNum(x);
      const yn = y === null || y === undefined ? null : isNum(y);
      if (xn === null && yn === null) return 0;
      if (xn === null) return 1;
      if (yn === null) return -1;
      return yn - xn;
    });

    tbody.textContent = "";
    if (!rows.length) {

      const priceable = chosen.filter((s) => (book.get(s) || {}).state === "ok");
      if (priceable.length && screened > 0) {
        showEmpty("Nothing on " + priceable.join(", ") + " clears the liquidity gates right now. " +
                  screened + " quoted contracts were screened.");
      } else {
        setPaneVisible(false);
      }
      foot.textContent = "";
      renderPlan([]);
      updateStatus();
      return;
    }

    if (collectHead) collectHead.hidden = buyingPower === null;

    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(rowFor(r));
    tbody.append(frag);
    setPaneVisible(true);
    renderPlan(rows);

    const dropped = Object.entries(gatedTotals)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => n + " " + reasonWord(reason));

    const cut = chosen.filter((s) => {
      const p = (book.get(s) || {}).payload;
      return p && p.truncated;
    });
    const universe = cut.length
      ? priced + " of at least " + screened + " quoted contracts are sellable"
      : priced + " of " + screened + " quoted contracts are sellable";

    const uncountedNote = uncounted.length
      ? " " + uncounted.join(", ") + " " + (uncounted.length === 1 ? "is" : "are") +
        " outside those two numbers: " + (uncounted.length === 1 ? "that payload" : "those payloads") +
        " did not say how many contracts were screened or how many are sellable, and a count " +
        "this page never received is not a count of nought."
      : "";

    const belowCut = slices.reduce((total, c) => total + (c.sellable - c.kept), 0);
    const sliceNote = slices.length
      ? " This table is a slice: " +
        slices.map((c) => c.symbol + " shows its top " + fmtInt(c.kept) + " of " +
          fmtInt(c.sellable) + " sellable lines, ranked by " + rankWord(c.rankedBy)).join("; ") +
        " — " + fmtInt(belowCut) + (belowCut === 1 ? " line" : " lines") +
        " below the cut " + (belowCut === 1 ? "is" : "are") + " not on this table, " +
        "and re-sorting the ones that are cannot bring them back — so changing the " +
        "ranking refetches " +
        (slices.length === 1 ? "this name" : "these names") + " rather than reordering " +
        "what is already here."
      : "";
    foot.textContent = universe +
      (dropped.length
        ? ". The rest fail a gate: " + dropped.join(", ") +
          " — each counted once, under the first gate it failed."
        : ".") +
      uncountedNote +
      sliceNote +
      (cut.length
        ? " " + cut.join(", ") + " " + (cut.length === 1 ? "has" : "have") +
          " more contracts than this desk fetches, so " +
          (cut.length === 1 ? "its" : "their") + " ranking is taken over a partial chain."
        : "");
    updateStatus();
  }

  function renderPlan(rows) {
    if (!planEl) return;
    if (buyingPower === null || !rows.length) { planEl.hidden = true; planEl.textContent = ""; return; }

    let best = null;
    let affordable = 0;
    for (const r of rows) {
      const z = r.__sizing;
      if (!z || !z.affordable) continue;
      affordable++;
      if (best === null || z.collectible > best.__sizing.collectible) best = r;
    }

    if (!best) {
      planEl.hidden = false;
      planEl.className = "desk-plan is-empty";

      let cheapest = null;
      for (const r of rows) {
        const c = isNum(r.collateral);
        if (c === null) continue;
        if (cheapest === null || c < cheapest) cheapest = c;
      }
      planEl.textContent = fmtMoney(buyingPower) + " does not cover a single contract here. " +
        (cheapest === null ? "" : "The cheapest line on the table ties up " + fmtMoney(cheapest) + ".");
      return;
    }

    const z = best.__sizing;
    const side = best.strategy === "cc" ? "covered call" : "cash-secured put";
    planEl.hidden = false;
    planEl.className = "desk-plan";
    planEl.textContent =
      fmtMoney(buyingPower) + " buying power · " + affordable + " of " + rows.length +
      " lines affordable · best single deployment: " + z.contracts + "\u00d7 " +
      (best.ticker || "?") + " " + fmt2(best.strike) + " " + side + " expiring " +
      (best.expiry || "?") + " collects " + fmtMoney(z.collectible) + ", deploying " +
      fmtMoney(z.deployed) + " and leaving " + fmtMoney(z.idle) + " idle (" +
      fmtPct(z.yieldOnDeployed, 2) + " on capital committed).";
  }

  const numOr = isNum;

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const key of Object.keys(attrs || {})) {
      const value = attrs[key];
      if (value === null || value === undefined) continue;
      node.setAttribute(key, String(value));
    }
    return node;
  }

  const TYPE = Object.freeze({
    "font-family": "Inter, system-ui, sans-serif", "font-size": 9, fill: "currentColor",
  });

  function fmtVol(v) {
    const n = numOr(v);
    return n === null ? DASH : (n * 100).toFixed(1);
  }

  function fmtSkew(v) {
    const n = numOr(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n * 100).toFixed(1);
  }

  function fmtMoneyness(v) {
    const n = numOr(v);
    if (n === null) return DASH;
    if (Math.abs(n) < 5e-5) return "0.0%";
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n * 100).toFixed(1) + "%";
  }

  let surfaceSymbol = null;
  let surfaceHost = null, surfaceSelect = null, surfacePlot = null, surfaceNote = null;
  let surfaceFrame = 0;

  let surfaceNumbersDrawn = true;

  function ensureSurfaceHost() {
    if (surfaceHost) return surfaceHost;
    if (!foot || !foot.parentNode) return null;

    surfaceHost = document.createElement("section");
    surfaceHost.className = "desk-surface";
    surfaceHost.id = "deskSurface";
    surfaceHost.hidden = true;

    const head = document.createElement("div");
    head.className = "desk-surface__head";

    const title = document.createElement("h2");
    title.className = "desk-surface__title";
    title.textContent = "Implied volatility surface";
    head.append(title);

    const field = document.createElement("span");
    field.className = "desk-field desk-surface__field";
    const label = document.createElement("label");
    label.setAttribute("for", "deskSurfaceSymbol");
    label.textContent = "Symbol";
    surfaceSelect = document.createElement("select");
    surfaceSelect.id = "deskSurfaceSymbol";
    surfaceSelect.addEventListener("change", () => {
      surfaceSymbol = surfaceSelect.value || null;
      writeURL();
      drawSurface();
    });
    field.append(label, surfaceSelect);
    head.append(field);
    surfaceHost.append(head);

    surfacePlot = document.createElement("div");
    surfacePlot.className = "desk-surface__plot";
    surfaceHost.append(surfacePlot);

    surfaceNote = document.createElement("p");
    surfaceNote.className = "desk-surface__note";
    surfaceHost.append(surfaceNote);

    foot.insertAdjacentElement("afterend", surfaceHost);
    return surfaceHost;
  }

  function surfaceCandidates() {
    return selectedSymbols().filter((s) => {
      const e = book.get(s);
      return e && e.state === "ok" && e.payload && e.payload.ivSurface;
    });
  }

  function renderSurface() {
    const host = ensureSurfaceHost();
    if (!host) return;
    const candidates = surfaceCandidates();
    if (!candidates.length) {
      host.hidden = true;
      if (surfacePlot) surfacePlot.textContent = "";
      return;
    }
    if (surfaceSymbol === null || !candidates.includes(surfaceSymbol)) {
      surfaceSymbol = candidates[0];
    }

    surfaceSelect.textContent = "";
    for (const symbol of candidates) {
      const option = document.createElement("option");
      option.value = symbol;
      option.textContent = symbol;
      surfaceSelect.append(option);
    }
    surfaceSelect.value = surfaceSymbol;

    surfaceSelect.disabled = candidates.length < 2;
    host.hidden = false;
    drawSurface();
  }

  function drawSurface() {
    if (!surfaceHost || surfaceHost.hidden || !surfacePlot) return;
    const state = book.get(surfaceSymbol);
    const payload = state && state.payload;
    const surface = payload && payload.ivSurface;
    surfacePlot.textContent = "";
    if (!surface) { surfaceNote.textContent = ""; return; }

    if (surface.status !== "ok") {

      surfaceNote.textContent = "No surface for " + surfaceSymbol + ": " +
        (surface.reason || "not available") + ".";
      return;
    }
    surfacePlot.append(surfaceSvg(surface, payload));
    surfaceNote.textContent = surfaceNoteText(surface, payload);
  }

  function earningsByExpiry(payload) {
    const out = new Map();
    for (const row of (payload && payload.rows) || []) {
      if (!row || !row.expiry) continue;
      const prior = out.get(row.expiry);
      if (row.crossesEarnings === true) out.set(row.expiry, true);
      else if (prior === undefined) out.set(row.expiry, row.crossesEarnings === false ? false : null);
      else if (prior === false && row.crossesEarnings === null) out.set(row.expiry, null);
    }
    return out;
  }

  function surfaceSvg(surface, payload) {
    const cols = surface.expiries, rows = surface.rows;
    const hostW = surfacePlot.getBoundingClientRect().width;
    const W = Math.max(280, Math.round(hostW || 320));
    const labelW = 52, padR = 10, padT = 30, gapTerm = 16, termH = 46;
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const colW = plotW / cols.length;

    const rowH = Math.max(11, Math.min(24, 300 / rows.length));
    const gridH = rows.length * rowH;
    const termT = padT + gridH + gapTerm;
    const H = Math.round(termT + termH);

    const withNumbers = colW >= 28 && rowH >= 12;
    surfaceNumbersDrawn = withNumbers;

    const svg = svgEl("svg", {
      class: "ivs", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
      "aria-label": surfaceAria(surface, payload),
    });

    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "ivsNeg", width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "ivs-negpat",
    });
    pat.append(svgEl("line", {
      x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6,
    }));
    defs.append(pat);
    svg.append(defs);

    const earnings = earningsByExpiry(payload);
    const cap = numOr(surface.skewCap);

    cols.forEach((e, j) => {
      const x = plotL + j * colW + colW / 2;
      const crosses = earnings.has(e.expiry) ? earnings.get(e.expiry) : undefined;

      const group = svgEl("g", { class: "ivs-colhead" });
      const title = svgEl("title");
      title.textContent = e.expiry + (e.days === null ? "" : ", " + e.days + " days") + ". " +
        (crosses === true
          ? "Contracts on this expiry outlive the next earnings report — the level here is priced against a jump, not a diffusion."
          : crosses === false
            ? "No earnings report falls before this expiry."
            : "Whether this expiry outlives the next earnings report is not determined: no contract on it survived the sale gates, so nothing on this column was dated.");
      group.append(title);

      const head = svgEl("text", {
        class: "ivs-exp" + (crosses === true ? " crosses-earnings" : ""),
        x, y: padT - 17, "text-anchor": "middle", ...TYPE, "fill-opacity": 0.8,
      });
      head.textContent = String(e.expiry).slice(5) + (crosses === true ? " ⚠" : "");
      group.append(head);

      const tenor = svgEl("text", {
        class: "ivs-days", x, y: padT - 6, "text-anchor": "middle", ...TYPE,
        "font-size": 8.5, "fill-opacity": 0.6,
      });
      tenor.textContent = e.days === null ? DASH : e.days + "d";
      group.append(tenor);
      svg.append(group);

      if (j > 0) {
        svg.append(svgEl("line", {
          class: "ivs-colrule", x1: plotL + j * colW - 0.5, x2: plotL + j * colW - 0.5,
          y1: padT, y2: padT + gridH,
          stroke: "currentColor", "stroke-width": 0.5, "stroke-opacity": 0.18,
        }));
      }
    });

    rows.forEach((r, i) => {
      const y = padT + i * rowH;
      cols.forEach((e, j) => {
        const x = plotL + j * colW;
        const w = Math.max(1, colW - 1), h = Math.max(1, rowH - 1);
        const cell = surface.grid[i][j];
        if (!cell) {

          svg.append(svgEl("rect", {
            class: "ivs-void", x, y, width: w, height: h,
            fill: "currentColor", "fill-opacity": 0.07,
          }));
          return;
        }

        const skew = numOr(cell.skew);
        const mag = skew !== null && cap !== null && cap > 0
          ? Math.min(1, Math.abs(skew) / cap) : 0;
        const neg = skew !== null && skew < 0;
        const rect = svgEl("rect", {

          class: "ivs-cell " + (skew === null ? "is-nolevel" : neg ? "is-neg" : "is-pos") +
            (cell.traded === false ? " is-stale" : cell.traded === null ? " is-unknown-age" : ""),
          x, y, width: w, height: h,
          fill: skew === null ? "none" : "currentColor",

          "fill-opacity": skew === null ? 0 : (0.12 + 0.46 * mag).toFixed(3),

          stroke: cell.traded === true && skew !== null ? "none" : "currentColor",
          "stroke-width": cell.traded === true && skew !== null ? 0 : 1,
          "stroke-dasharray": cell.traded === false ? "3 2" : cell.traded === null ? "1 2" : null,
          "stroke-opacity": cell.traded === true ? 0.35 : 0.85,
          "data-expiry": cell.expiry,
          "data-strike": cell.strike,
          "data-iv": cell.iv,
          "data-skew": skew === null ? "" : skew,
          "data-traded": cell.traded === null ? "unknown" : String(cell.traded),
          "data-crowd": cell.crowd,
        });

        const group = svgEl("g", { class: "ivs-cellgroup" });
        group.append(cellTitle(cell, e, surface));
        group.append(rect);

        if (neg && rowH >= 9 && colW >= 9) {
          group.append(svgEl("rect", {
            class: "ivs-hatch", x, y, width: w, height: h, fill: "url(#ivsNeg)",

            opacity: 0.5,
          }));
        }

        if (skew !== null && cap !== null && Math.abs(skew) > cap) {

          const slash = Math.min(9, Math.max(4, w - 4));
          group.append(svgEl("line", {
            class: "ivs-clip",
            x1: x + 3, y1: y + h - 3, x2: x + 3 + slash, y2: y + Math.max(2, h - 3 - slash),
            stroke: "currentColor", "stroke-width": 1.2, "stroke-opacity": 0.9,
          }));
        }
        if (withNumbers) {
          const t = svgEl("text", {
            class: "ivs-iv" + (cell.traded === true ? "" : " is-stale"),
            x: x + w / 2, y: y + h / 2 + 3.2, "text-anchor": "middle", ...TYPE,
          });
          t.textContent = fmtVol(cell.iv);
          group.append(t);
        }
        svg.append(group);
      });
    });

    const must = new Set([0, rows.length - 1]);
    const atmRow = rows.findIndex((r) => r.k === 0);
    if (atmRow >= 0) must.add(atmRow);
    const stride = Math.max(1, Math.ceil(13 / rowH));
    rows.forEach((r, i) => {
      if (!must.has(i) && i % stride !== 0) return;
      if (!must.has(i) && Array.from(must).some((m) => Math.abs(m - i) * rowH < 12)) return;
      const t = svgEl("text", {
        class: "ivs-m" + (r.k === 0 ? " is-atm" : ""),
        x: labelW - 6, y: padT + i * rowH + rowH / 2 + 3.2, "text-anchor": "end", ...TYPE,
        "fill-opacity": r.k === 0 ? 1 : 0.7,
      });
      t.textContent = r.k === 0 ? "ATM" : fmtMoneyness(r.m);
      svg.append(t);
    });

    const levels = cols.map((e) => numOr(e.atmIv));
    const present = levels.filter((v) => v !== null);
    const lo = present.length ? Math.min.apply(null, present) : 0;
    const hi = present.length ? Math.max.apply(null, present) : 1;
    const span = hi - lo;
    const bandT = termT, bandH = 24;
    const yOf = (v) => span > 1e-9
      ? bandT + bandH - ((v - lo) / span) * bandH
      : bandT + bandH / 2;

    svg.append(svgEl("line", {
      class: "ivs-termrule", x1: plotL, x2: plotL + plotW, y1: bandT + bandH + 4, y2: bandT + bandH + 4,
      stroke: "currentColor", "stroke-width": 1, "stroke-opacity": 0.2,
    }));
    const strip = svgEl("text", {
      class: "ivs-m is-atm", x: labelW - 6, y: bandT + bandH / 2 + 3.2, "text-anchor": "end", ...TYPE,
    });
    strip.textContent = "ATM";
    svg.append(strip);

    cols.forEach((e, j) => {
      const x = plotL + j * colW + colW / 2;
      const v = levels[j];
      const group = svgEl("g", { class: "ivs-levelgroup" });
      const title = svgEl("title");
      title.textContent = v === null
        ? e.expiry + " has no at-the-money level: " + (e.atmReason || "not measurable") + "."
        : e.expiry + " at the money: " + fmtVol(v) + "% implied, from the " + e.atmStrike +
          " " + (e.atmType === "P" ? "put" : "call") + " — " + fmtMoneyness(e.atmM) +
          " from spot and traded today.";
      group.append(title);
      const label = svgEl("text", {
        class: "ivs-level" + (v === null ? " is-missing" : ""),
        x, y: bandT + bandH + 16, "text-anchor": "middle", ...TYPE,
        "font-size": 10, "font-weight": 700, "fill-opacity": v === null ? 0.6 : 1,
      });
      label.textContent = v === null ? DASH : fmtVol(v);
      group.append(label);
      svg.append(group);

      if (v === null) return;
      svg.append(svgEl("circle", {
        class: "ivs-dot", cx: x, cy: yOf(v), r: 2.6, fill: "currentColor",
      }));

      const prev = levels[j - 1];
      if (j > 0 && prev !== null) {
        svg.append(svgEl("line", {
          class: "ivs-termline", fill: "none", stroke: "currentColor", "stroke-width": 1.4,
          x1: plotL + (j - 1) * colW + colW / 2, y1: yOf(prev), x2: x, y2: yOf(v),
        }));
      }
    });

    return svg;
  }

  function cellTitle(cell, expiry, surface) {
    const title = svgEl("title");
    const side = cell.type === "P" ? "put" : "call";
    const parts = [];
    parts.push(cell.strike + " " + side + " " + cell.expiry +
      " · " + fmtMoneyness(cell.m) + " from the money · " + fmtVol(cell.iv) + "% implied");
    if (numOr(cell.skew) !== null) {
      parts.push(fmtSkew(cell.skew) + " vol points against this expiry's at-the-money " +
        fmtVol(expiry.atmIv) + "%");
    } else {
      parts.push("No skew: " + (expiry.atmReason || "this expiry has no at-the-money level"));
    }
    if (cell.traded === false) {
      parts.push("This contract has NOT traded today, so its implied volatility is the last " +
        "transaction's — of unknown age. It is drawn but it did not set this expiry's level.");
    } else if (cell.traded === null) {
      parts.push("The vendor reported no volume for this contract, so the age of its implied " +
        "volatility is unknown. It did not set this expiry's level.");
    } else {
      parts.push("Traded " + fmtInt(cell.volume) + " today" +
        (cell.oi === null ? "" : ", open interest " + fmtInt(cell.oi)) + ".");
    }
    if (cell.crowd > 1) {
      parts.push(cell.crowd + " contracts fall in this row of this column; the one shown is " +
        "the print this surface prefers — today's first, then nearest the row's centre. " +
        "The cell is never an average of quotes.");
    }
    if (numOr(cell.skew) !== null && numOr(surface.skewCap) !== null &&
        Math.abs(cell.skew) > surface.skewCap) {
      parts.push("Past the shade cap of " + fmtSkew(surface.skewCap) +
        " vol points, so the shade understates it. Marked with a slash.");
    }
    title.textContent = parts.join(". ").replace(/\.\./g, ".");
    return title;
  }

  function surfaceAria(surface, payload) {
    const levels = surface.expiries.map((e) => String(e.expiry).slice(5) + " " +
      (numOr(e.atmIv) === null ? "no level" : fmtVol(e.atmIv) + " percent"));
    return "Implied volatility surface for " + (payload && payload.ticker ? payload.ticker : surfaceSymbol) +
      ": " + surface.expiriesShown + " expiries by " + surface.rowsShown +
      " moneyness bands. At-the-money implied volatility by expiry — " + levels.join(", ") +
      ". Shade is each contract's implied volatility against its own expiry's at-the-money quote.";
  }

  function surfaceNoteText(surface, payload) {
    const bits = [];
    bits.push("Rows are log-moneyness, ln(strike ÷ spot), in bands " +
      (surface.step * 100).toFixed(1) + "% wide; columns are expiries, nearest first");
    bits.push((surfaceNumbersDrawn
      ? "The number in a cell is the contract's own quoted implied volatility. "
      : "The columns are too narrow at this width to print a volatility inside each cell, so " +
        "every cell carries its own in a tooltip instead — drawing them anyway would overlap " +
        "them into a smear that looks like data. ") +
      "The shade is that volatility against its own expiry's at-the-money quote — hatched " +
      "below it, plain above — so the smile is readable without the term structure swamping " +
      "it. The level itself is the strip beneath the grid, which read left to right IS the " +
      "term structure");

    const levels = surface.expiries.map((e) => String(e.expiry).slice(5) + " " +
      (numOr(e.atmIv) === null ? DASH : fmtVol(e.atmIv) + "%"));
    bits.push("At the money: " + levels.join(", "));

    const noLevel = surface.expiries.filter((e) => numOr(e.atmIv) === null);
    if (noLevel.length) {
      bits.push(noLevel.map((e) => String(e.expiry).slice(5) + " has no level — " + e.atmReason)
        .join("; ") + ". Those columns carry their quoted volatilities and no shade, and the " +
        "term-structure line does not bridge them");
    }

    const agedBits = [];
    if (surface.stale > 0) agedBits.push(surface.stale + " did not");
    if (surface.unknownAge > 0) {
      agedBits.push(surface.unknownAge + " carr" + (surface.unknownAge === 1 ? "ies" : "y") +
        " no volume at all");
    }
    bits.push("This vendor's implied volatility is the LAST TRANSACTION's, not a quote. " +
      surface.fresh + " of " + surface.placed + " cells traded today" +
      (agedBits.length === 0 ? " — every cell on this surface is a print from today" :
        "; " + agedBits.join(" and ") + ", so their volatility is of unknown age. Those cells " +
        "are drawn with a broken border and NONE of them set an expiry's level — a stale cell " +
        "is one marked number, but a stale level would tilt a whole column's smile with no " +
        "marker on any cell it moved"));

    if (surface.crowded > 0) {
      bits.push(surface.crowded === 1
        ? "One contract shares a row with another; the cell shows one quoted contract and is " +
          "never an average of two"
        : surface.crowded + " contracts share a row with another; each cell shows one quoted " +
          "contract and is never an average of two");
    }
    if (surface.clipped > 0) {
      bits.push("The shade is capped at " + fmtSkew(surface.skewCap) + " vol points; " +
        surface.clipped + " cell" + (surface.clipped === 1 ? " runs" : "s run") +
        " past it and " + (surface.clipped === 1 ? "is" : "are") + " marked with a slash");
    }
    const windowed = [];
    if (surface.expiriesShown < surface.expiriesTotal) {
      windowed.push(surface.expiriesShown + " of " + surface.expiriesTotal + " expiries");
    }
    if (surface.rowsShown < surface.rowsTotal) {
      windowed.push(surface.rowsShown + " of " + surface.rowsTotal + " moneyness bands");
    }
    if (windowed.length) bits.push("Showing " + windowed.join(" and "));

    bits.push("Built from every contract with a two-sided quote, before the liquidity gates that " +
      "decide the table above and regardless of the Sell toggle — those gates fall hardest on the " +
      "wings, and a smile with its tails cut off is a different smile" +
      (payload && payload.truncated
        ? ". This chain is larger than the desk fetches, so the surface is taken over a partial chain"
        : ""));
    if (surface.ivBasis) bits.push("Volatility units resolved once for the whole chain: " + surface.ivBasis);
    bits.push("Quoted volatilities, and differences between quoted volatilities on the same expiry. " +
      "Nothing here is fitted, interpolated or repriced — that would need a rate and a dividend " +
      "yield, which this desk does not invent");

    return bits.join(". ") + ".";
  }

  function rankWord(key) {
    switch (key) {
      case "annualized": return "annualised yield";
      case "premium": return "premium received";
      case "yieldOnCollateral": return "yield on collateral";
      case "cushionSigmas": return "cushion";

      case null: case undefined: return "an ordering the payload did not name";
      default: return String(key);
    }
  }

  function reasonWord(reason) {
    switch (reason) {
      case "spread": return "too wide";
      case "openInterest": return "too thin";
      case "premium": return "paying too little";
      case "expiry": return "outside the tenor window";
      case "strategy": return "on the other side";
      case "unpriceable": return "with no quotable bid";
      default: return reason;
    }
  }

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function subLine(text, title) {
    const span = document.createElement("span");
    span.style.display = "block";
    span.style.fontSize = "0.72em";

    span.style.color = "var(--ink-faint)";
    span.style.letterSpacing = "0.02em";
    span.textContent = text;
    if (title) span.title = title;
    return span;
  }

  function strikeCell(r) {
    const td = document.createElement("td");
    td.className = "c-num";
    td.append(document.createTextNode(fmt2(r.strike)));
    const m = isNum(r.moneyness);
    const spot = isNum(r.__spot);
    if (m === null || (r.strategy !== "csp" && r.strategy !== "cc")) return td;
    const atTheMoney = Math.abs(m) < 5e-5;
    const otm = r.strategy === "csp" ? m < 0 : m > 0;
    const word = atTheMoney ? "at the money" : otm ? "OTM" : "ITM";
    const side = m < 0 ? "below" : "above";
    td.append(subLine(
      atTheMoney ? word : fmtPct(Math.abs(m), 1) + " " + word,
      atTheMoney
        ? "This strike is the spot price" + (spot === null ? "" : " of " + fmt2(spot)) + "."
        : "This strike is " + fmtPct(Math.abs(m), 1) + " " + side + " spot" +
          (spot === null ? "" : " of " + fmt2(spot)) + ", which for a " +
          (r.strategy === "csp" ? "cash-secured put" : "covered call") + " is " +
          (otm ? "out of the money" : "in the money") + "."));
    return td;
  }

  function yieldCell(r) {
    const td = document.createElement("td");
    td.className = "c-num";
    td.append(document.createTextNode(fmtPct(r.yieldOnCollateral, 2)));
    const collateral = isNum(r.collateral);
    if (collateral === null) {

      td.append(subLine("on no quotable collateral",
        "This line carries no collateral figure, so the yield above has no denominator."));
      return td;
    }
    td.append(subLine("on " + fmtMoney(collateral),
      r.strategy === "cc"
        ? "A covered call ties up 100 shares, worth " + fmtMoney(collateral) +
          " at spot — shares you have to already own."
        : "A cash-secured put ties up " + fmtMoney(collateral) +
          " in cash: the strike, times 100, reserved until expiry."));
    return td;
  }

  function rowFor(r) {
    const tr = document.createElement("tr");

    const sym = document.createElement("th");
    sym.scope = "row";

    const ticker = r.ticker ? String(r.ticker) : "";
    if (ticker) {
      const link = document.createElement("a");
      link.href = "/flows/ticker/?t=" + encodeURIComponent(ticker);
      link.textContent = ticker;
      link.title = "Open " + ticker + " on the analysis page. Cards are built only for " +
        "the names on today's board; if this one is not among them the page says so.";
      sym.append(link);
    } else {
      sym.textContent = DASH;
    }
    tr.append(sym);

    const side = r.strategy === "csp" ? "Cash-secured put"
      : r.strategy === "cc" ? "Covered call" : DASH;
    tr.append(cell(side, "c-side"));

    tr.append(strikeCell(r));

    const exp = cell(fmtExpiry(r.expiry, r.days), "c-num");
    if (r.crossesEarnings === true) {
      exp.className = "c-num crosses-earnings";
      exp.textContent = fmtExpiry(r.expiry, r.days) + " \u26a0";
      exp.title = "This contract expires after the next earnings report. The cushion on " +
        "this line is a diffusion number priced against a jump.";
    } else if (r.crossesEarnings === null) {

      exp.className = "c-num earnings-unknown";
      exp.title = "Whether this contract outlives the next earnings report could not be " +
        "determined. Treat the cushion with that in mind.";
    }
    tr.append(exp);
    tr.append(cell(fmt2(r.bid), "c-num"));
    tr.append(cell(fmtMoney(r.premium), "c-num"));

    if (buyingPower !== null) {
      const z = r.__sizing;
      const td = document.createElement("td");
      td.className = "c-num c-collect";
      if (!z) {
        td.textContent = DASH;
        td.title = "This line has no quotable collateral or premium to size against.";
      } else if (!z.affordable) {

        td.className = "c-num c-collect is-unaffordable";
        td.textContent = "$0";
        td.title = "One contract ties up " + fmtMoney(r.collateral) + ", which is more than " +
          fmtMoney(buyingPower) + ". Nothing to collect here.";
      } else {
        td.textContent = fmtMoney(z.collectible) + " (" + z.contracts + "\u00d7)";
        td.title = z.contracts + " contract" + (z.contracts === 1 ? "" : "s") + " at " +
          fmtMoney(r.premium) + " each. Deploys " + fmtMoney(z.deployed) + " of " +
          fmtMoney(buyingPower) + ", leaving " + fmtMoney(z.idle) + " idle — a return of " +
          fmtPct(z.yieldOnDeployed, 2) + " on the capital actually committed.";
      }
      tr.append(td);
    }

    tr.append(yieldCell(r));

    const ann = cell(fmtPct(r.annualized, 0), "c-num c-ann");
    if (r.annualizedIsConvention) {
      ann.title = "Simple 365/days scaling, for comparing tenors. Not a return anyone earns.";
    }
    tr.append(ann);

    const cushion = cell(fmtSd(r.cushionSigmas), "c-num" + (r.ivTraded === false ? " is-stale-iv" : ""));
    if (r.ivTraded === false) {
      cushion.title = "This contract has not traded today, so its implied volatility is the " +
        "last transaction's — of unknown age. The cushion is as old as that print.";
    }
    tr.append(cushion);
    tr.append(cell(fmt2(r.breakeven), "c-num"));

    const called = cell(fmtPct(r.assignedReturn, 1), "c-num");
    if (r.strategy === "cc") {
      if (isNum(r.capSigmas) !== null) {
        called.title = "Called away at " + fmt2(r.strike) + ", the whole position returns " +
          fmtPct(r.assignedReturn, 1) + ". The market has to run " + fmtSd(r.capSigmas) +
          " — in this option's own implied moves — to get there.";
      }
    } else {
      called.textContent = DASH;
      called.title = "A cash-secured put has no upside cap. Its best case is keeping the " +
        "premium, which is the Yield column.";
      called.className = "c-num is-na";
    }
    tr.append(called);
    tr.append(cell(fmtPct(r.spread, 1), "c-num"));

    const oi = isNum(r.oi);
    const change = isNum(r.oiChange);
    const oiText = oi === null ? DASH
      : change === null || change === 0 ? fmtInt(oi)
      : fmtInt(oi) + " (" + (change > 0 ? "+" : change < 0 ? MINUS : "") + fmtInt(Math.abs(change)) + ")";
    tr.append(cell(oiText, "c-num"));

    return tr;
  }

  function updateStatus() {

    statusOwned = true;
    if (inflight > 0) {
      statusEl.textContent = "Pricing " + inflight + " symbol" + (inflight === 1 ? "" : "s") + "…";
      return;
    }
    if (!book.size) { statusEl.textContent = "Add a symbol to begin."; return; }
    const chosen = selectedSymbols();
    if (!chosen.length) { statusEl.textContent = "Select a symbol to price it."; return; }
    const failed = chosen.filter((s) => (book.get(s) || {}).state === "error");

    const { oldest: oldestAge, unaged } = quoteAge();
    const age = oldestAge === null ? "" : " · quotes " + fmtAge(oldestAge);

    const unagedNote = unaged
      ? " · " + (unaged === 1
        ? "one symbol's quote age was not stated by the route"
        : unaged + " symbols' quote ages were not stated by the route")
      : "";

    const staleQuotes = oldestAge !== null && oldestAge > QUOTE_STALE_SECONDS
      ? " — older than this desk will call a price, so treat the table as a record " +
        "of the market rather than one you can trade; Refresh requotes it"
      : "";

    const sessions = new Set();
    const stale = [];
    for (const sym of chosen) {
      const p = (book.get(sym) || {}).payload;
      if (!p) continue;
      if (p.marketTime) sessions.add(String(p.marketTime));
      if (p.spotSource === "daily-close") stale.push(sym);
    }
    const session = sessions.size === 1 ? " · " + [...sessions][0] + " session" : "";
    const staleNote = stale.length
      ? " · " + stale.join(", ") + " priced off the last close, not a live print"
      : "";

    const earnBits = [];
    for (const sym of chosen) {
      const p = (book.get(sym) || {}).payload;
      if (!p || p.state === "error") continue;
      const e = p.earnings;
      const rows = (p.rows || []).filter((r) => r.ticker === sym || chosen.length === 1);
      const crossing = (p.rows || []).filter((r) => r.crossesEarnings === true).length;
      if (!e || !e.date) {

        const etf = e && /etf|index|fund/i.test(String(e.issueType || ""));
        earnBits.push(sym + (etf ? " has no earnings (" + e.issueType + ")" : " has no known earnings date"));
      } else if (crossing > 0) {
        earnBits.push(sym + " reports " + String(e.date).slice(5) + " — " + crossing +
          " of " + (p.rows || []).length + " lines expire after it");
      } else {
        earnBits.push(sym + " reports " + String(e.date).slice(5) + " — no line expires after it");
      }
    }
    const earnNote = earnBits.length ? " · " + earnBits.join("; ") : "";

    statusEl.textContent = (failed.length
      ? chosen.length - failed.length + " of " + chosen.length + " symbols priced · " +
        failed.join(", ") + " unavailable"
      : chosen.length + " symbol" + (chosen.length === 1 ? "" : "s") + " priced") +
      session + age + staleQuotes + unagedNote + staleNote + earnNote;
  }

  function showEmpty(text) {
    tbody.textContent = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = BASE_COLUMNS + (buyingPower === null ? 0 : 1);
    td.className = "flows-empty";
    td.textContent = text;
    tr.append(td);
    tbody.append(tr);
    setPaneVisible(true);
  }

  let announcePane = () => {};

  function setPaneVisible(on) {
    if (pane) pane.hidden = !on;
    else if (tableWrap) tableWrap.hidden = !on;
    if (on) announcePane();
  }

  (() => {
    const gripX = document.getElementById("deskGripX");
    const gripY = document.getElementById("deskGripY");
    const gripXY = document.getElementById("deskGripXY");
    const reset = document.getElementById("deskGripReset");
    if (!pane || !tableWrap) return;

    const MIN_W = 320, MIN_H = 160;
    const STEP = 48;

    function maxW() {
      const parent = pane.parentElement;
      return parent ? Math.max(MIN_W, parent.clientWidth) : MIN_W;
    }
    function maxH() {

      const top = pane.getBoundingClientRect().top;
      return Math.max(MIN_H, Math.round(window.innerHeight - top - 24));
    }

    const clamp = (v, lo, hi) => Math.round(Math.min(hi, Math.max(lo, v)));

    function announce() {
      const w = pane.getBoundingClientRect().width;
      const h = tableWrap.getBoundingClientRect().height;
      const pctW = String(clamp(w / maxW() * 100, 0, 100));
      const pctH = String(clamp(h / maxH() * 100, 0, 100));
      if (gripX) gripX.setAttribute("aria-valuenow", pctW);
      if (gripY) gripY.setAttribute("aria-valuenow", pctH);
      if (reset) reset.hidden = !pane.style.width && !tableWrap.style.height;
    }
    announcePane = announce;

    function setW(px) { pane.style.width = clamp(px, MIN_W, maxW()) + "px"; announce(); }
    function setH(px) { tableWrap.style.height = clamp(px, MIN_H, maxH()) + "px"; announce(); }

    function wire(grip, axes) {
      if (!grip) return;
      const doX = axes.indexOf("x") >= 0;
      const doY = axes.indexOf("y") >= 0;

      grip.addEventListener("pointerdown", (event) => {

        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX, startY = event.clientY;
        const startW = pane.getBoundingClientRect().width;
        const startH = tableWrap.getBoundingClientRect().height;
        try { grip.setPointerCapture(event.pointerId); } catch {   }
        pane.classList.add("is-resizing");

        const move = (e) => {
          if (doX) setW(startW + (e.clientX - startX));
          if (doY) setH(startH + (e.clientY - startY));
        };
        const stop = () => {
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", stop);
          grip.removeEventListener("pointercancel", stop);
          pane.classList.remove("is-resizing");
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", stop);
        grip.addEventListener("pointercancel", stop);
      });

      grip.addEventListener("keydown", (event) => {
        const k = event.key;
        const w = pane.getBoundingClientRect().width;
        const h = tableWrap.getBoundingClientRect().height;
        let handled = true;
        if (doX && k === "ArrowRight") setW(w + STEP);
        else if (doX && k === "ArrowLeft") setW(w - STEP);
        else if (doY && k === "ArrowDown") setH(h + STEP);
        else if (doY && k === "ArrowUp") setH(h - STEP);
        else if (k === "Home") { if (doX) setW(MIN_W); if (doY) setH(MIN_H); }
        else if (k === "End") { if (doX) setW(maxW()); if (doY) setH(maxH()); }
        else handled = false;
        if (handled) event.preventDefault();
      });
    }

    wire(gripX, "x");
    wire(gripY, "y");
    wire(gripXY, "xy");

    if (reset) {
      reset.addEventListener("click", () => {
        pane.style.width = "";
        tableWrap.style.height = "";
        announce();
      });
    }

    window.addEventListener("resize", () => {

      if (pane.style.width) setW(pane.getBoundingClientRect().width);
      if (tableWrap.style.height) setH(tableWrap.getBoundingClientRect().height);
    });
    announce();
  })();

  function tickAges() {
    let priced = false;
    for (const e of book.values()) {
      if (e.state !== "ok" || !e.payload) continue;
      priced = true;
      if (e.__note) e.__note.textContent = noteFor(e);
    }

    if (priced && statusOwned) updateStatus();
  }
  setInterval(tickAges, AGE_TICK_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tickAges();
  });

  (() => {

    const topbar = document.querySelector(".topbar");
    const barHeight = () => (topbar ? Math.round(topbar.getBoundingClientRect().height) : 0);

    const headCells = Array.from(document.querySelectorAll(".desk-table thead th"));
    headCells.forEach((th, i) => {
      th.style.top = "0px";

      th.style.zIndex = "3";
      if (i > 0) th.style.position = "sticky";

      th.style.boxShadow = "inset 0 -1px 0 var(--hairline)";
    });

    const controls = document.querySelector(".desk-controls");
    const wide = window.matchMedia("(min-width: 40.001rem)");
    function applyControls() {
      if (!controls) return;
      if (!wide.matches) {
        controls.style.position = "";
        controls.style.top = "";
        controls.style.zIndex = "";
        controls.style.background = "";
        controls.style.paddingBottom = "";
        controls.style.borderBottom = "";
        return;
      }
      controls.style.position = "sticky";
      controls.style.top = barHeight() + "px";

      controls.style.zIndex = "20";
      controls.style.background = "var(--bg)";
      controls.style.paddingBottom = "0.7rem";
      controls.style.borderBottom = "1px solid var(--hairline)";
    }
    applyControls();

    window.addEventListener("resize", applyControls);
    if (typeof wide.addEventListener === "function") wide.addEventListener("change", applyControls);
  })();

  function add(symbols) {
    const fresh = [];
    for (const s of symbols) {
      if (book.has(s)) continue;
      if (book.size >= MAX_SYMBOLS) break;
      book.set(s, { selected: true, state: "idle", payload: null, error: null });
      fresh.push(s);
    }
    writeURL();
    renderList();
    if (fresh.length) runPool(fresh, {});
    return fresh;
  }

  entry.addEventListener("submit", (event) => {
    event.preventDefault();
    const wanted = normalise(String(input.value || "").split(/[,\s]+/));
    if (!wanted.length) {
      say("That is not a symbol this desk can price.");
      return;
    }

    const needSlots = wanted.filter((w) => !book.has(w));
    const room = MAX_SYMBOLS - book.size;
    const added = add(wanted);
    input.value = "";
    if (!needSlots.length) {
      say(wanted.length === 1
        ? wanted[0] + " is already on the desk."
        : "Already on the desk.");
    } else if (added.length < needSlots.length) {

      const dropped = needSlots.filter((w) => !book.has(w));
      say("The desk holds " + MAX_SYMBOLS +
        " symbols; each one is a live lookup. " +
        (dropped.length ? "Not added: " + dropped.join(", ") + ". " : "") +
        "Remove one to add another.");
    }
  });

  allBox.addEventListener("change", () => {
    const on = allBox.checked;
    for (const e of book.values()) e.selected = on;
    allBox.indeterminate = false;
    renderList();
    render();

    const missing = selectedSymbols().filter((s) => {
      const e = book.get(s);
      return e && e.state === "idle";
    });
    if (missing.length) runPool(missing, {});
  });

  refreshBtn.addEventListener("click", () => {
    const chosen = selectedSymbols();
    if (!chosen.length) { say("Select a symbol to refresh."); return; }

    runPool(chosen, { refresh: true });
  });

  clearBtn.addEventListener("click", () => {
    book.clear();
    surfaceSymbol = null;
    writeURL();
    renderList();
    tbody.textContent = "";
    setPaneVisible(false);
    foot.textContent = "";
    renderPlan([]);

    renderSurface();
    updateStatus();
  });

  window.addEventListener("resize", () => {
    if (surfaceFrame) return;
    surfaceFrame = requestAnimationFrame(() => { surfaceFrame = 0; drawSurface(); });
  });

  function applyBuyingPower(raw) {
    const next = parseBuyingPower(raw);
    const changed = next !== buyingPower;
    buyingPower = next;
    if (bpClear) bpClear.hidden = !String(raw || "").trim();
    if (bpInput) {

      const dirty = String(raw || "").trim().length > 0;
      bpInput.classList.toggle("is-invalid", dirty && next === null);
      bpInput.setAttribute("aria-invalid", dirty && next === null ? "true" : "false");
    }

    if (buyingPower === null && rankSel && rankSel.value === "collectible") {
      rankSel.value = "annualized";
    }
    if (changed) { writeURL(); render(); }
  }

  if (bpInput) {
    bpInput.addEventListener("input", () => applyBuyingPower(bpInput.value));
    bpInput.addEventListener("change", () => {

      if (buyingPower !== null) bpInput.value = formatBuyingPower(buyingPower);
      applyBuyingPower(bpInput.value);
    });

    bpInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); bpInput.blur(); }
    });
  }

  if (bpClear) {
    bpClear.addEventListener("click", () => {
      if (bpInput) bpInput.value = "";
      applyBuyingPower("");
      if (bpInput) bpInput.focus();
    });
  }

  const RANK_REFETCH_MS = 250;
  const rankDebounceMs = () => {
    const v = Number(window.__flowsRankDebounceMs);
    return Number.isFinite(v) && v >= 0 ? v : RANK_REFETCH_MS;
  };
  let rankRefetchTimer = null;

  for (const sel of [strategySel, rankSel]) {
    if (!sel) continue;
    sel.addEventListener("change", () => {
      writeURL();

      if (sel === strategySel) {
        for (const e of book.values()) { e.state = "idle"; e.payload = null; }
        renderList();
        const chosen = selectedSymbols();
        if (chosen.length) runPool(chosen, {});
        else render();
      } else {

        if (sel.value === "collectible" && buyingPower === null) {
          sel.value = "annualized";
          writeURL();
          say("Enter a buying power to rank by premium collectible.");
          if (bpInput) { bpInput.focus(); bpInput.select(); }
          return;
        }

        const want = serverRank(sel.value);
        const recut = selectedSymbols().filter((sym) => {
          const p = (book.get(sym) || {}).payload;
          if (!p) return false;
          const sellable = isNum(p.priced);
          if (sellable === null || (p.rows || []).length >= sellable) return false;

          return p.rankedBy !== want;
        });
        render();

        if (rankRefetchTimer !== null) {
          clearTimeout(rankRefetchTimer);
          rankRefetchTimer = null;
        }
        if (!recut.length) return;
        const wait = rankDebounceMs();
        if (wait === 0) { runPool(recut, {}); return; }

        rankRefetchTimer = window.setTimeout(() => {
          rankRefetchTimer = null;
          runPool(recut, {});
        }, wait);
      }
    });
  }

  const initial = readURL();

  if (bpInput) applyBuyingPower(bpInput.value);
  if (initial.length) add(initial);
  else { renderList(); updateStatus(); }
})();
