/* =============================================================
   market-ticker.js — flowing tape of index prices + 1-day change.

   Reads the server-cached snapshot from same-origin /api/markets (no external
   calls, no keys) and renders a seamless horizontal marquee: latest close in
   the domestic currency and the 1-day % move, green up / red down. Degrades to
   hidden if there is no data, and to a static scrollable strip under
   prefers-reduced-motion.
   ============================================================= */
(() => {
  "use strict";
  const mount = document.getElementById("marketTicker");
  if (!mount || typeof fetch !== "function") return;

  const row = document.createElement("div");
  row.className = "market-ticker__row";
  mount.appendChild(row);

  const priceFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function itemHTML(q) {
    const up = Number(q.changePct) >= 0;
    return (
      '<span class="tk" data-dir="' + (up ? "up" : "down") + '">' +
        '<span class="tk__name">' + esc(q.label) + "</span>" +
        '<span class="tk__price">' + priceFmt.format(Number(q.price)) + "</span>" +
        '<span class="tk__cur">' + esc(q.currency) + "</span>" +
        '<span class="tk__chg">' + (up ? "▲" : "▼") + " " + pctFmt.format(Number(q.changePct)) + "%</span>" +
      "</span>"
    );
  }

  function render(quotes) {
    const valid = (quotes || []).filter((q) => q && Number.isFinite(Number(q.price)) && Number.isFinite(Number(q.changePct)));
    if (!valid.length) { mount.hidden = true; return; }
    const set = valid.map(itemHTML).join("");
    // Two identical sets: animating the row to translateX(-50%) lands exactly on
    // the start of the second set, so the loop is seamless. The copy is hidden
    // from assistive tech to avoid double-reading.
    row.innerHTML =
      '<span class="market-ticker__set">' + set + "</span>" +
      '<span class="market-ticker__set" aria-hidden="true">' + set + "</span>";
    mount.hidden = false;
    // Keep a constant scroll speed regardless of how many indices report: scale
    // the duration to one set's rendered width (~55px/s).
    requestAnimationFrame(() => {
      const first = row.querySelector(".market-ticker__set");
      const width = first ? first.getBoundingClientRect().width : 0;
      if (width > 0) row.style.setProperty("--ticker-duration", Math.max(18, Math.round(width / 55)) + "s");
    });
  }

  let inFlight = false;
  async function load() {
    if (inFlight) return;
    inFlight = true;
    try {
      const resp = await fetch("/api/markets", { headers: { Accept: "application/json" } });
      if (!resp.ok) throw new Error("markets " + resp.status);
      const data = await resp.json();
      render(Array.isArray(data.quotes) ? data.quotes : []);
    } catch {
      // Leave any prior render in place; hide only if nothing has rendered yet.
      if (!row.childElementCount) mount.hidden = true;
    } finally {
      inFlight = false;
    }
  }

  // Refresh on the edge-cache cadence; pause polling while the tab is hidden.
  let timer = null;
  function start() {
    load();
    if (timer === null) timer = setInterval(load, 5 * 60 * 1000);
  }
  function stop() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
})();
