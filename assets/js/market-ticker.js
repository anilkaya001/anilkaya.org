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
    const pct = Number(q.changePct);

    const flat = Math.abs(pct) < 0.005;
    const dir = flat ? "flat" : pct > 0 ? "up" : "down";
    const arrow = flat ? "•" : pct > 0 ? "▲" : "▼";
    return (
      '<span class="tk" data-dir="' + dir + '">' +
        '<span class="tk__name">' + esc(q.label) + "</span>" +
        '<span class="tk__price">' + priceFmt.format(Number(q.price)) + "</span>" +
        '<span class="tk__cur">' + esc(q.currency) + "</span>" +
        '<span class="tk__chg">' + arrow + " " + pctFmt.format(pct).replace("-", "\u2212") + "%</span>" +
      "</span>"
    );
  }

  const stampFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function noteHTML(updatedAt) {
    const stamp = Number(updatedAt);
    const asOf = Number.isFinite(stamp) && stamp > 0 ? "As of " + stampFmt.format(stamp) + " İst · " : "";
    return '<span class="tk tk--note">' + asOf + "Indicative only — not investment advice</span>";
  }

  function render(quotes, updatedAt) {
    const valid = (quotes || []).filter((q) => q && Number.isFinite(Number(q.price)) && Number.isFinite(Number(q.changePct)));
    if (!valid.length) { mount.hidden = true; return; }
    const set = valid.map(itemHTML).join("") + noteHTML(updatedAt);

    row.innerHTML =
      '<span class="market-ticker__set">' + set + "</span>" +
      '<span class="market-ticker__set" aria-hidden="true">' + set + "</span>";
    mount.hidden = false;

    requestAnimationFrame(() => {
      const first = row.querySelector(".market-ticker__set");
      const width = first ? first.getBoundingClientRect().width : 0;
      if (width > 0) row.style.setProperty("--ticker-duration", Math.max(18, Math.round(width / 55)) + "s");
    });
  }

  const hiddenByViewport = () => typeof matchMedia === "function" && matchMedia("(max-height: 480px)").matches;

  let inFlight = false;
  async function load() {
    if (inFlight || hiddenByViewport()) return;
    inFlight = true;
    try {
      const resp = await fetch("/api/markets", { headers: { Accept: "application/json" } });
      if (!resp.ok) throw new Error("markets " + resp.status);
      const data = await resp.json();
      render(Array.isArray(data.quotes) ? data.quotes : [], data.updatedAt);
    } catch {

      if (!row.childElementCount) mount.hidden = true;
    } finally {
      inFlight = false;
    }
  }

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

  const disclaimer = document.getElementById("marketDisclaimer");
  if (disclaimer) {
    const close = () => disclaimer.removeAttribute("open");
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && disclaimer.open) {
        close();
        const summary = disclaimer.querySelector("summary");
        if (summary) summary.focus();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (disclaimer.open && !disclaimer.contains(event.target)) close();
    });
  }
})();
