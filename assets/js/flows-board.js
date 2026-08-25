/* =============================================================
   flows-board.js — the Flows board controller.

   Fetches a precomputed payload and renders it. All the arithmetic
   happened in the pipeline; this file does presentation only, which
   is the whole point of the architecture: the Worker streams stored
   bytes and the browser draws them.

   Framework-free IIFE, in the house idiom. No global is exported —
   nothing else on the page needs to talk to it.
   ============================================================= */
(() => {
  "use strict";

  const body = document.getElementById("flowsBody");
  const statusEl = document.getElementById("flowsStatus");
  const sideButtons = Array.from(document.querySelectorAll(".flows-side"));
  if (!body || !statusEl || !sideButtons.length) return;

  const COLUMNS = 9;                 // keep in sync with the <thead> in flows-pages.js
  const cache = new Map();           // side -> payload
  const inflight = new Map();        // side -> { promise, controller }
  let side = initialSide();

  /* ---------- formatting -----------------------------------------
     One place for every number. The rule throughout: never print a
     precision the data does not have. A missing value renders as an
     em dash, never as 0.00, because a confident zero is a lie. */

  const MINUS = "−";            // U+2212, not a hyphen
  const DASH = "—";

  const isNum = (v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const signed = (n, digits) => {
    const s = Math.abs(n).toFixed(digits);
    return n < 0 ? MINUS + s : n > 0 ? "+" + s : s;
  };

  function fmtPrice(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2);
  }

  function fmtPct(v, digits) {
    const n = isNum(v);
    return n === null ? DASH : signed(n * 100, digits) + "%";
  }

  function fmtInt(v) {
    const n = isNum(v);
    return n === null ? DASH : String(Math.round(n));
  }

  function fmtSignedInt(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const r = Math.round(n);
    return r < 0 ? MINUS + Math.abs(r) : r > 0 ? "+" + r : "0";
  }

  function fmtRatio(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2);
  }

  function fmtMoney(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const abs = Math.abs(n);
    const sign = n < 0 ? MINUS : "";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return sign + "$" + Math.round(abs / 1e3) + "K";
    return sign + "$" + Math.round(abs);
  }

  /* ---------- DOM helpers ---------------------------------------- */

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;          // textContent everywhere: no escaping to forget
    return td;
  }

  function toneClass(v) {
    const n = isNum(v);
    if (n === null || n === 0) return "fb-flat";
    return n > 0 ? "fb-pos" : "fb-neg";
  }

  function scoreCell(score) {
    const n = isNum(score);
    const td = document.createElement("td");
    td.className = "fb-score c-num " + toneClass(n);
    if (n !== null && n < 0) td.classList.add("is-neg");
    const bar = document.createElement("span");
    bar.className = "fb-bar";
    bar.style.setProperty("--w", n === null ? 0 : Math.min(Math.abs(n) / 100, 1));
    const label = document.createElement("span");
    label.textContent = fmtSignedInt(n);
    td.append(bar, label);
    return td;
  }

  function familyCell(fam) {
    const td = document.createElement("td");
    td.className = "c-num";
    const keys = ["F", "P", "D", "V", "O"];
    const wrap = document.createElement("span");
    wrap.className = "fb-fam";
    const parts = [];
    for (const k of keys) {
      const n = isNum(fam && fam[k]);
      const i = document.createElement("i");
      i.style.setProperty("--h", n === null ? 0 : Math.min(Math.abs(n) / 100, 1));
      if (n !== null && n < 0) i.className = "is-neg";
      wrap.append(i);
      parts.push(k + " " + (n === null ? DASH : fmtSignedInt(n)));
    }
    // The glyph is decorative; the numbers must still be readable to
    // a screen reader and on hover.
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Family scores: " + parts.join(", "));
    wrap.title = parts.join("  ");
    td.append(wrap);
    return td;
  }

  function regimeText(v) {
    if (v === "long") return "long Γ";
    if (v === "short") return "short Γ";
    return DASH;
  }

  function rowFor(row, index) {
    const tr = document.createElement("tr");
    tr.className = "fb-row";
    tr.append(cell(fmtInt(row.r != null ? row.r : index + 1), "c-rank"));
    tr.append(cell(String(row.t || DASH), "fb-tk"));

    const px = document.createElement("td");
    px.className = "c-num";
    px.textContent = fmtPrice(row.px);
    const chg = document.createElement("span");
    chg.className = " " + toneClass(row.chg);
    chg.textContent = "  " + fmtPct(row.chg, 2);
    px.append(chg);
    tr.append(px);

    tr.append(scoreCell(row.s));
    tr.append(cell(fmtInt(row.cnv), "c-num"));
    tr.append(cell(fmtRatio(row.purity), "c-num"));
    tr.append(cell(regimeText(row.gRegime), "c-num " + (row.gRegime === "short" ? "fb-neg" : "fb-flat")));
    tr.append(cell(row.gFlipDist == null ? DASH : fmtPct(row.gFlipDist, 1), "c-num"));
    tr.append(cell(fmtMoney(row.netPrem), "c-num " + toneClass(row.netPrem)));
    return tr;
  }

  function showMessage(text) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "fb-empty";
    td.colSpan = COLUMNS;
    td.textContent = text;
    tr.append(td);
    body.replaceChildren(tr);
  }

  /* ---------- data ------------------------------------------------ */

  function initialSide() {
    try {
      const q = new URLSearchParams(location.search).get("side");
      return q === "short" ? "short" : "long";
    } catch { return "long"; }
  }

  function load(which) {
    if (cache.has(which)) return Promise.resolve(cache.get(which));

    const pending = inflight.get(which);
    if (pending) return pending.promise;          // deduplicate concurrent asks

    const controller = new AbortController();
    const promise = fetch("/api/flows/board?side=" + encodeURIComponent(which), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then((response) => {
      if (response.status === 401) {
        // The session expired underneath us; the login page is the
        // honest destination, not an error message.
        location.replace("/flows/");
        return null;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then((payload) => {
      if (payload) cache.set(which, payload);
      return payload;
    }).finally(() => {
      inflight.delete(which);
    });

    inflight.set(which, { promise, controller });
    return promise;
  }

  function render(which) {
    statusEl.textContent = "Loading the " + which + " board…";
    // Cancel a superseded request so a slow response cannot land after
    // the user has already switched sides.
    for (const [key, entry] of inflight) {
      if (key !== which) { entry.controller.abort(); inflight.delete(key); }
    }

    load(which).then((payload) => {
      if (which !== side || !payload) return;     // user moved on, or redirected

      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (payload.status === "pending" || !rows.length) {
        showMessage(
          "No session has been published yet. The board fills in once the "
          + "pipeline completes its first run.",
        );
        statusEl.textContent = "Awaiting the first published session.";
        return;
      }

      const frag = document.createDocumentFragment();
      rows.forEach((row, i) => frag.append(rowFor(row, i)));
      body.replaceChildren(frag);                 // one insertion, 50 rows

      const when = payload.generatedAt
        ? new Date(payload.generatedAt).toLocaleString()
        : "an unknown time";
      statusEl.textContent =
        rows.length + " " + which + " candidates, generated " + when + ".";
    }).catch((error) => {
      if (error && error.name === "AbortError") return;
      showMessage("The board could not be loaded. Refresh to try again.");
      statusEl.textContent = "Could not reach the board service.";
    });
  }

  /* ---------- side toggle ----------------------------------------- */

  function select(which) {
    if (which !== "long" && which !== "short") return;
    side = which;
    for (const button of sideButtons) {
      const on = button.dataset.side === which;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    try {
      const url = new URL(location.href);
      url.searchParams.set("side", which);
      history.replaceState(null, "", url);
    } catch { /* deep-linking is a convenience, never a requirement */ }
    render(which);
  }

  for (const button of sideButtons) {
    button.addEventListener("click", () => select(button.dataset.side));
  }

  select(side);
})();
