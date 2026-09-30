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

  const CLOSED_AFTER_MS = 25 * 60 * 1000;
  const FRESH_FOR_MS = 60 * 60 * 1000;
  const CLOSE_GRACE_MS = 5 * 60 * 1000;
  const zone = "Europe/Istanbul";
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false });
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" });
  const dm = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" });

  function stampOf(q, updatedAt) {
    const at = Number(q.asOf);
    if (!Number.isFinite(at) || at <= 0) return null;
    const now = Date.now();
    const fetched = Number(updatedAt);
    const end = Number(q.sessionEnd);
    const closed = end > 0 ? at >= end - CLOSE_GRACE_MS
      : (Number.isFinite(fetched) && fetched > 0 ? fetched - at : now - at) > CLOSED_AFTER_MS || now - at > FRESH_FOR_MS;
    const today = ymd.format(now) === ymd.format(at);
    const recent = now - at < 6 * 24 * 3600 * 1000;
    const when = today ? hm.format(at) : recent ? wd.format(at) + (closed ? "" : " " + hm.format(at)) : dm.format(at);
    return { closed, text: (closed ? "Close " : "") + when, full: (closed ? "close, " : "quote, ") + wd.format(at) + " " + dm.format(at) + " " + hm.format(at) + " İstanbul time" };
  }

  function itemHTML(q, updatedAt) {
    const pct = Number(q.changePct);
    const based = "asOfDay" in q && q.changePct !== null && q.changePct !== undefined && Number.isFinite(pct);
    const flat = based && Math.abs(pct) < 0.005;
    const dir = !based ? "none" : flat ? "flat" : pct > 0 ? "up" : "down";
    const arrow = !based ? "" : flat ? "•" : pct > 0 ? "▲" : "▼";
    const stamp = stampOf(q, updatedAt);
    const basis = based && q.prevDay ? "against the close of " + q.prevDay : "against the previous close";
    return (
      '<span class="tk" data-dir="' + dir + '" title="' + esc(q.label + " " + priceFmt.format(Number(q.price)) + " " + q.currency +
        (based ? ", " + pctFmt.format(pct).replace("-", "\u2212") + "% " + basis : ", no previous close to compare with") +
        (stamp ? "; " + stamp.full : "")) + '">' +
        '<span class="tk__name">' + esc(q.label) + "</span>" +
        '<span class="tk__price">' + priceFmt.format(Number(q.price)) + "</span>" +
        '<span class="tk__cur">' + esc(q.currency) + "</span>" +
        '<span class="tk__chg">' + (based ? arrow + " " + pctFmt.format(pct).replace("-", "\u2212") + "%" : "\u2014") + "</span>" +
        (stamp ? '<span class="tk__asof" data-closed="' + stamp.closed + '">' + esc(stamp.text) + "</span>" : "") +
      "</span>"
    );
  }

  function noteHTML() {
    return '<span class="tk tk--note">Change from the previous close · times in İstanbul · Indicative only — not investment advice</span>';
  }

  function render(quotes, updatedAt) {
    const valid = (quotes || []).filter((q) => q && Number.isFinite(Number(q.price)));
    if (!valid.length) { mount.hidden = true; return; }
    const set = valid.map((q) => itemHTML(q, updatedAt)).join("") + noteHTML();

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
