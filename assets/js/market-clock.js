/* =============================================================
   market-clock.js — live countdown to major stock-market opens.

   Every duration is timezone-independent (a countdown is the same number
   of minutes anywhere), and each open time is also shown converted to
   İstanbul (Europe/Istanbul) so a Turkish reader sees exactly when in
   their own day each market rings the bell. All math is local — Intl time
   zones, no network, no library — so it costs nothing to run.

   Sessions are treated as one continuous open→close block Mon–Fri; midday
   breaks (Tokyo, Hong Kong, Shanghai) and market holidays are not modelled,
   so "Open" is an at-a-glance signal, not a trading feed.
   ============================================================= */
(() => {
  "use strict";
  const board = document.getElementById("marketBoard");
  if (!board) return;

  // Bail cleanly if the engine can't resolve IANA zones (very old browsers).
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul" }).format(0);
  } catch {
    board.remove();
    return;
  }

  const IST = "Europe/Istanbul";
  const MARKETS = [
    { city: "İstanbul",  flag: "🇹🇷", tz: "Europe/Istanbul",  open: [10, 0], close: [18, 0] },
    { city: "London",    flag: "🇬🇧", tz: "Europe/London",    open: [8, 0],  close: [16, 30] },
    { city: "Frankfurt", flag: "🇩🇪", tz: "Europe/Berlin",    open: [9, 0],  close: [17, 30] },
    { city: "New York",  flag: "🇺🇸", tz: "America/New_York", open: [9, 30], close: [16, 0] },
    { city: "Tokyo",     flag: "🇯🇵", tz: "Asia/Tokyo",       open: [9, 0],  close: [15, 0] },
    { city: "Hong Kong", flag: "🇭🇰", tz: "Asia/Hong_Kong",   open: [9, 30], close: [16, 0] },
    { city: "Shanghai",  flag: "🇨🇳", tz: "Asia/Shanghai",    open: [9, 30], close: [15, 0] },
    { city: "Mumbai",    flag: "🇮🇳", tz: "Asia/Kolkata",     open: [9, 15], close: [15, 30] },
  ];
  const TRADING = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const DAY_MS = 86400000;

  // Cache one formatter per zone; formatToParts is the hot path.
  const partsFmt = new Map();
  function tzParts(tz, ms) {
    let fmt = partsFmt.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, hour12: false, weekday: "short",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      partsFmt.set(tz, fmt);
    }
    const o = {};
    for (const { type, value } of fmt.formatToParts(ms)) o[type] = value;
    return o;
  }

  // Offset (ms) of `tz` at instant `ms`: localWallAsUTC − ms.
  function tzOffset(tz, ms) {
    const o = tzParts(tz, ms);
    return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) - ms;
  }

  // The UTC instant of a wall-clock time (y, mo, d, h, mi) in `tz`. Two passes
  // settle the fixed point t = wall − offset(t) across DST boundaries.
  function zonedToUtc(tz, y, mo, d, h, mi) {
    const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
    let t = wall - tzOffset(tz, wall);
    t = wall - tzOffset(tz, t);
    return t;
  }

  const istHM = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
  const istWeekday = new Intl.DateTimeFormat("en-GB", { timeZone: IST, weekday: "short" });

  // The next open→close block for a market that has not yet ended, scanning
  // forward over trading days (skips weekends).
  function nextSession(m, nowMs) {
    for (let i = 0; i < 8; i++) {
      const local = tzParts(m.tz, nowMs + i * DAY_MS);
      if (!TRADING.has(local.weekday)) continue;
      const openMs = zonedToUtc(m.tz, +local.year, +local.month, +local.day, m.open[0], m.open[1]);
      const closeMs = zonedToUtc(m.tz, +local.year, +local.month, +local.day, m.close[0], m.close[1]);
      if (nowMs < closeMs) return { openMs, closeMs, isOpen: nowMs >= openMs };
    }
    return null;
  }

  function hoursMinutes(ms) {
    const total = Math.max(0, Math.round(ms / 60000));
    return Math.floor(total / 60) + "h " + String(total % 60).padStart(2, "0") + "m";
  }

  const cards = MARKETS.map((m) => {
    const card = document.createElement("article");
    card.className = "market";
    card.innerHTML =
      '<span class="market__top">' +
        '<span class="market__dot" aria-hidden="true"></span>' +
        '<span class="market__city">' + m.city + "</span>" +
        '<span class="market__flag" aria-hidden="true">' + m.flag + "</span>" +
      "</span>" +
      '<span class="market__status"></span>';
    board.appendChild(card);
    return { m, card, status: card.querySelector(".market__status") };
  });

  function render() {
    const now = Date.now();
    for (const c of cards) {
      const s = nextSession(c.m, now);
      if (!s) {
        c.card.dataset.open = "false";
        c.status.textContent = "—";
        c.card.setAttribute("aria-label", c.m.city + " market schedule unavailable");
        continue;
      }
      if (s.isOpen) {
        const left = hoursMinutes(s.closeMs - now);
        c.card.dataset.open = "true";
        c.status.innerHTML = '<b>Open</b> · closes ' + left;
        c.card.setAttribute("aria-label", c.m.city + " is open, closes in " + left);
      } else {
        const until = hoursMinutes(s.openMs - now);
        const day = istWeekday.format(s.openMs);
        const today = istWeekday.format(now);
        const at = (day === today ? "" : day + " ") + istHM.format(s.openMs);
        c.card.dataset.open = "false";
        c.status.innerHTML = "opens <b>" + until + "</b> · " + at;
        c.card.setAttribute("aria-label", c.m.city + " opens in " + until + ", at " + at + " İstanbul time");
      }
    }
  }

  // Minute precision, so a 30s cadence keeps every countdown fresh. Pause while
  // the tab is hidden and resync (with an immediate render) on return.
  let timer = null;
  function start() {
    render();
    if (timer === null) timer = setInterval(render, 30000);
  }
  function stop() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
})();
