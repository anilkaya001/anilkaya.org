(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F, DASH } = UI;
  const SESSIONS = 252;
  const FLOOR_N = 250;
  const MIN_RETURNS = 200;
  const MAX_GAP_DAYS = 4;
  const SIG_CEILING = 0.25;
  const SIZES = [1, 2, 3, 4];
  const PUBLISHED = { 2: "f2", 3: "f3" };
  const UNIVERSE_URL = "/api/flows/universe?cols=ed,f2,f3,rd,sig,t";
  const MULT = "×";
  const MINUS = "\u2212";
  const WHEN = { premarket: "before the open", afterhours: "after the close", postmarket: "after the close" };

  const num = (v) => {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const pos = (v) => (num(v) !== null && v > 0 ? Number(v) : null);
  const r2 = (x) => Math.round(x * 100 + 1e-7) / 100;
  const grouped = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const usd = (v) => {
    const [whole, cents] = r2(v).toFixed(2).split(".");
    return "$" + grouped(whole) + "." + cents;
  };
  const pctText = (x) => r2(x * 100).toFixed(2) + "%";
  const dayNumber = (d) => {
    const t = Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(t) ? Math.round(t / 864e5) : null;
  };
  const oneIn = (p) => Math.max(1, Math.round(1 / p));

  function wilson(hits, n) {
    const z = 1.96, p = hits / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
    const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return { lo: Math.max(0, (c - w) / d), hi: Math.min(1, (c + w) / d) };
  }

  function frequency(hits) {
    if (!Number.isInteger(hits) || hits < 0 || hits > SESSIONS) return null;
    if (hits === 0 || SESSIONS / hits > FLOOR_N) {
      const base = "rarer than 1 in " + FLOOR_N + " sessions for this name over the last year";
      return hits === 0 ? base + ", and fewer than 1 in " + Math.floor(1 / (1 - Math.pow(0.05, 1 / SESSIONS)) / 10) * 10 + " at 95%" : base;
    }
    const core = "about 1 in " + oneIn(hits / SESSIONS) + " sessions for this name over the last year";
    if (hits < 5) return core;
    const w = wilson(hits, SESSIONS);
    return core + " (95% interval 1 in " + oneIn(w.hi) + " to 1 in " + oneIn(w.lo) + ")";
  }

  function returnsOf(closes, breaks) {
    const list = [];
    for (const r of Array.isArray(closes) ? closes : []) {
      const c = num(r && r[1]);
      const d = r && typeof r[0] === "string" ? r[0].slice(0, 10) : null;
      const n = d ? dayNumber(d) : null;
      if (c !== null && n !== null) list.push({ d, n, c });
    }
    list.sort((a, b) => a.n - b.n);
    const broken = new Set(Array.isArray(breaks) ? breaks : []);
    const out = [];
    for (let i = Math.max(1, list.length - SESSIONS); i < list.length; i++) {
      const a = list[i - 1], b = list[i], gap = b.n - a.n;
      if (!(a.c > 0) || !(b.c > 0) || broken.has(a.d) || broken.has(b.d) || !(gap >= 1) || gap > MAX_GAP_DAYS) continue;
      out.push(Math.abs(Math.log(b.c / a.c)));
    }
    return out;
  }

  function counted(returns, sig, k) {
    if (returns.length < MIN_RETURNS) return { why: returns.length ? "This card carries " + returns.length + " usable daily returns and a year needs " + MIN_RETURNS + ", so it cannot be counted here." : "This card carries no daily closes, so it cannot be counted here." };
    let hits = 0;
    for (const r of returns) if (r >= k * sig) hits++;
    return { hits: returns.length === SESSIONS ? hits : Math.round((hits * SESSIONS) / returns.length), n: returns.length };
  }

  function rowOf(u, ticker, now = Date.now()) {
    const gone = (why, rwhy) => ({ sig: null, f2: null, f3: null, ed: null, rd: null, rdMax: null, edMax: null, hz: null, j: null, why, rwhy: rwhy || why });
    if (!u || typeof u !== "object") return gone("The nightly universe could not be read.");
    if (u.status === "pending") return gone("Tonight's universe has not published yet.");
    if (u.status !== "ok" || !Array.isArray(u.t)) return gone("The nightly universe is unavailable" + (u.reason ? ": " + String(u.reason).replace(/_/g, " ") : "") + ".");
    const i = u.t.indexOf(ticker);
    if (i < 0) return gone(ticker + " is not in tonight's screened universe, so no typical daily move is published for it.", ticker + " is not in tonight's screened universe, so its report is not classified.");
    const cell = (key) => {
      const col = u.cols && u.cols[key], unit = u.units && u.units[key];
      if (!Array.isArray(col) || !Array.isArray(unit) || !(num(unit[1]) > 0)) return undefined;
      const v = num(col[i]);
      return v === null ? null : v / unit[1];
    };
    const sig = cell("sig");
    const unstated = u.rdBasis && u.rdBasis.unstated ? u.rdBasis.unstated : {};
    const edUn = u.edUnstated && typeof u.edUnstated === "object" ? u.edUnstated : {};
    const hz = F.horizon(u.hz) ? u.hz : null;
    const row = { sig: pos(sig), f2: cell("f2") ?? null, f3: cell("f3") ?? null, ed: cell("ed") ?? null, rd: cell("rd") ?? null, rdMax: num(unstated[ticker]), edMax: F.later(edUn, u.edUnstatedThrough, ticker, cell("ed") ?? null), hz, j: hz === null ? null : F.elapsed(u.sessionDate, u.ahead, F.etDay(now)), why: null };
    if (sig === undefined) row.why = "The nightly run does not publish a typical daily move yet.";
    else if (row.sig === null) row.why = "No typical daily move is published for " + ticker + ": it needs " + MIN_RETURNS + " clean sessions of history, with report days, splits and data breaks left out.";
    return row;
  }

  function impliedOf(input) {
    const m = input.implied;
    if (!m || pos(m.move) === null) return { why: (m && m.why) || "The card carries no implied move for the nearest expiry." };
    return { move: Number(m.move), low: num(m.low), high: num(m.high), rule: typeof m.rule === "string" ? m.rule : null, asOf: m.asOf || null };
  }

  function reportOf(input, row) {
    const r = input.report;
    const hz = row && F.horizon(row.hz) ? row.hz : null;
    const st = hz !== null && Number.isInteger(row.j) ? F.earn({ ed: row.ed, rd: row.rd, rdMax: row.rdMax, edMax: row.edMax }, hz, row.j) : null;
    const gate = !!(r && r.gate);
    const sessions = st !== null && Number.isInteger(row.ed) ? row.ed - row.j : null;
    const out = { date: r ? r.d || null : null, sessions, hz, when: r && r.when ? r.when : null, confirmed: r && typeof r.confirmed === "boolean" ? r.confirmed : null, em: r && pos(r.em) !== null ? Number(r.em) : null, gate };
    if (st === "reaction" || st === "after") return { state: "reacted", age: st === "reaction" ? 0 : 1, ...out };
    if (st === "unstated") return { state: "unclear", ...out };
    if (gate || st === "ahead") return { state: "inside", ...out };
    if (st === "clear") return { state: "outside", ...out };
    if (!r && st !== "undated") return { state: "unknown", ...out, why: input.reportWhy || "No report date is on the card or in tonight's universe." };
    if (st === null && hz === null) return { state: "unknown", ...out, why: row && row.rwhy ? row.rwhy : "The nightly universe does not state the earnings window, so the report is not classified." };
    if (st === null) return { state: "unknown", ...out, why: "The nightly universe is more than two sessions old, so the report is not classified." };
    return { state: "unknown", ...out, why: !r ? input.reportWhy || "No report date is on the card or in tonight's universe." : "A report date is on the card but its distance in sessions is not." };
  }

  function model(input, row) {
    const inp = input || {};
    const r = row || { sig: null, f2: null, f3: null, ed: null, why: "Reading the nightly universe.", rwhy: "Reading the nightly universe." };
    const spot = pos(inp.spot);
    const sig = pos(r.sig);
    const out = { ticker: inp.ticker || null, spot, asOf: inp.asOf || null, sig, ladder: [], why: null, implied: impliedOf(inp), report: reportOf(inp, r) };
    if (spot === null) out.why = "The card carries no price for " + (inp.ticker || "this name") + ", so there is no level to move from.";
    else if (sig === null) out.why = r.why || "No typical daily move is published for " + (inp.ticker || "this name") + ".";
    else if (sig >= SIG_CEILING) { out.why = "The published typical daily move is " + pctText(sig) + ", outside any plausible range for a listed name, so the ladder is withheld rather than printed."; out.sig = null; }
    if (out.why) return out;
    const returns = returnsOf(inp.closes, inp.breaks);
    for (const k of SIZES) {
      const move = k * sig;
      const pub = PUBLISHED[k] ? num(r[PUBLISHED[k]]) : null;
      let count;
      if (pub !== null && Number.isInteger(pub) && pub >= 0 && pub <= SESSIONS) count = { hits: pub, n: null, basis: "nightly" };
      else {
        const c = counted(returns, sig, k);
        count = c.why ? { why: PUBLISHED[k] && r[PUBLISHED[k]] === null ? "No nightly count is published for this name, and " + c.why.charAt(0).toLowerCase() + c.why.slice(1) : c.why } : { hits: c.hits, n: c.n, basis: "card" };
      }
      if (count.hits !== undefined) count.how = frequency(count.hits);
      out.ladder.push({ k, move, up: spot * Math.exp(move), down: spot * Math.exp(-move), upPct: Math.expm1(move), downPct: -Math.expm1(-move), count });
    }
    return out;
  }

  let LOADED = null;
  let KEPT = null;
  function universe() {
    if (!LOADED) {
      LOADED = fetch(UNIVERSE_URL, { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((u) => { KEPT = u; return u; })
        .catch((e) => { LOADED = null; throw e; });
    }
    return LOADED;
  }

  const info = (label, build) => UI.infoButton(label, build);
  const why = (text) => h("p", { class: "ft-ml-why" }, DASH + " ", text);

  function head(m) {
    const t = m.ticker || "this name";
    return h("div", { class: "ft-ml-base" },
      h("p", null,
        h("b", null, "Typical daily move ", m.sig === null ? DASH : pctText(m.sig)),
        m.spot === null ? null : h("span", null, " from ", h("b", null, usd(m.spot)), m.asOf ? ", the card's price for " + F.day(m.asOf) : "")),
      info("the typical daily move", () => ({
        title: "Typical daily move",
        lead: "The size of an ordinary day for " + t + ": 1.4826 times the median absolute deviation of its daily log returns over the last " + SESSIONS + " sessions, published by the nightly run.",
        facts: [["Value", m.sig === null ? null : pctText(m.sig)], ["Window", "the last " + SESSIONS + " sessions, at least " + MIN_RETURNS + " usable"], ["Left out", "report sessions, splits, data breaks and gaps of more than " + MAX_GAP_DAYS + " calendar days"]],
        notes: ["It is a median-based scale, so one wild day does not move it. The size is a log move, so a level is the card's price multiplied by e raised to plus or minus the size and a close beyond it is a day the ladder counts. A rise and a fall of the same size differ in percent: a size of 12% is a rise of 12.75% or a fall of 11.31%."],
      })));
  }

  function ladder(m, retry) {
    const box = h("section", { class: "ft-ml-blk", "aria-labelledby": "ftMlLadder" },
      h("div", { class: "ft-ml-h" }, h("h3", { id: "ftMlLadder" }, "Size ladder"),
        info("the counts", () => ({
          title: "How the counts are made",
          lead: "Each size is a multiple of the typical daily move. The count is how many of the last " + SESSIONS + " sessions moved at least that far, up or down.",
          sections: [
            { title: "Two and three times", lines: ["The nightly run's own count, with report sessions left out, scaled to " + SESSIONS + " sessions."] },
            { title: "One and four times", lines: ["Counted here on the daily closes this card carries, report days kept in, scaled to " + SESSIONS + " sessions when fewer are held. A card with fewer than " + MIN_RETURNS + " usable returns gives no count."] },
            { title: "How rare", lines: ["Printed as one in N sessions from the count alone, with a 95% interval from five hits. Nothing rarer than 1 in " + FLOOR_N + " is claimed; a count of zero or one reads as rarer than that."] },
          ],
        }))));
    if (m.why) {
      box.append(why(m.why));
      if (retry && m.spot !== null) box.append(h("button", { class: "ft-scene-btn ft-ml-btn", type: "button", onclick: retry }, "Retry"));
      return box;
    }
    box.append(h("ol", { class: "ft-ml-rows", "aria-label": "Moves of 1 to 4 typical days" }, m.ladder.map((row) => {
      const c = row.count;
      return h("li", { class: "ft-ml-row", "data-k": String(row.k) },
        h("h4", { class: "ft-ml-k" }, h("b", null, row.k + MULT), " a typical day ", h("span", { class: "ft-ml-mv" }, "±" + pctText(row.move))),
        h("dl", { class: "ft-ml-lv" },
          h("div", null, h("dt", null, "Rise to"), h("dd", { "data-tone": "up" }, usd(row.up), h("small", { class: "ft-ml-pc" }, "+" + pctText(row.upPct)))),
          h("div", null, h("dt", null, "Fall to"), h("dd", { "data-tone": "down" }, usd(row.down), h("small", { class: "ft-ml-pc" }, MINUS + pctText(row.downPct))))),
        c.hits === undefined
          ? h("p", { class: "ft-ml-n" }, DASH + " ", h("span", { class: "ft-ml-cap" }, c.why))
          : [h("p", { class: "ft-ml-n" }, h("b", null, c.hits + " per " + SESSIONS + " sessions"),
            h("span", { class: "ft-ml-cap" }, c.basis === "nightly" ? " nightly count, report days left out" : " counted on this card's closes" + (c.n === SESSIONS ? "" : " (" + c.n + " returns, scaled)") + ", report days kept in")),
          h("p", { class: "ft-ml-how" }, c.how)]);
    })));
    return box;
  }

  function impliedBlock(m) {
    const im = m.implied;
    const box = h("section", { class: "ft-ml-blk", "aria-labelledby": "ftMlImplied" },
      h("div", { class: "ft-ml-h" }, h("h3", { id: "ftMlImplied" }, "The options market's own number"),
        info("the options market's number", () => ({
          title: "The options market's own number",
          lead: "What the nearest expiry's options charge for a move, as the feed quotes it. It is a price set by traders, not a forecast made here.",
          facts: [["Move", im.move === undefined ? null : "±" + pctText(im.move)], ["Expiry", im.rule || null], ["Read", im.asOf ? F.day(im.asOf) : null]],
        }))));
    if (im.move === undefined) { box.append(why(im.why)); return box; }
    box.append(
      h("p", { class: "ft-ml-big" }, "±" + pctText(im.move), h("span", { class: "ft-ml-cap" }, " to " + (im.rule || "the nearest expiry"))),
      im.low !== null && im.high !== null ? h("p", { class: "ft-ml-cap" }, "That prices " + usd(im.low) + " to " + usd(im.high) + (m.spot === null ? "" : " around " + usd(m.spot)) + ". It is the market's number, not a forecast of where the price goes.") : h("p", { class: "ft-ml-cap" }, "It is the market's number, not a forecast of where the price goes."));
    return box;
  }

  function reportBlock(m) {
    const r = m.report;
    const box = h("section", { class: "ft-ml-blk", "aria-labelledby": "ftMlReport", "data-state": r.state },
      h("div", { class: "ft-ml-h" }, h("h3", { id: "ftMlReport" }, "Earnings report"),
        r.state === "inside" || r.state === "unclear" ? UI.tag("Event-contaminated", { tone: "warn" }) : r.state === "reacted" ? UI.tag(r.age === 0 ? "Reacting today" : "Reacted one session ago", { tone: "warn" }) : null,
        info("the report row", () => ({
          title: "Earnings report",
          lead: r.hz ? "A report inside " + r.hz + " sessions is flagged because a report day is not an ordinary day. One that moved the price on the latest session, or the one before, is marked too." : "The nightly universe does not state the earnings window, so no report is flagged.",
          facts: r.state === "reacted" ? [] : [["Date", r.date ? F.day(r.date) : null], ["Sessions away", r.sessions === null || r.sessions === undefined ? null : String(r.sessions)], ["Time", r.when ? WHEN[String(r.when).toLowerCase()] || r.when : null], ["Basis", r.confirmed === null || r.confirmed === undefined ? null : r.confirmed ? "confirmed" : "estimated"]],
          notes: ["Sessions are counted to the session the report moves the price: a report after the close counts to the next session."],
        }))));
    if (r.state === "unknown") {
      if (r.date) box.append(h("p", { class: "ft-ml-big" }, F.day(r.date), h("span", { class: "ft-ml-cap" }, (r.when ? ", " + (WHEN[String(r.when).toLowerCase()] || r.when) : "") + (r.confirmed === null ? "" : r.confirmed ? ", confirmed" : ", estimated"))));
      box.append(why(r.why));
      return box;
    }
    if (r.state === "reacted") {
      box.append(h("p", { class: "ft-ml-big" }, "Reported", h("span", { class: "ft-ml-cap" }, (r.age === 0 ? ", the price reaction is today" : ", the price reaction was the session before"))),
        h("p", { class: "ft-ml-flag" }, "The move over the sessions since the report carries the report. The ladder above leaves report days out of its nightly counts."));
      return box;
    }
    if (r.state === "unclear") {
      box.append(h("p", { class: "ft-ml-big" }, "Report time not stated", h("span", { class: "ft-ml-cap" }, r.date ? ", " + F.day(r.date) : "")),
        h("p", { class: "ft-ml-flag" }, "The report is on the latest session or beside it, and it may not have come out yet. The ladder above leaves report days out of its nightly counts, so it does not describe that day."));
      return box;
    }
    const away = r.gate && r.sessions === null ? "inside the earnings gate" : r.sessions + (r.sessions === 1 ? " session" : " sessions") + " away";
    const timing = r.when ? ", " + (WHEN[String(r.when).toLowerCase()] || r.when) : "";
    const basis = r.confirmed === null ? "" : r.confirmed ? ", confirmed" : ", estimated";
    box.append(h("p", { class: "ft-ml-big" }, r.date ? F.day(r.date) : away.charAt(0).toUpperCase() + away.slice(1), h("span", { class: "ft-ml-cap" }, (r.date ? ", " + away : ", date not on the card") + timing + basis)));
    if (r.state === "outside") {
      box.append(h("p", { class: "ft-ml-cap" }, "More than " + r.hz + " sessions away, so it is not flagged here."));
      return box;
    }
    box.append(
      r.em === null ? why("The card carries no implied report move.") : h("p", { class: "ft-ml-cap" }, "The options market prices ±" + pctText(r.em) + " for the report. That is its number, not a forecast."),
      h("p", { class: "ft-ml-flag" }, "Event-contaminated: any expiry past the report prices the report too, and the report day is not an ordinary day. The ladder above leaves report days out of its nightly counts, so it does not describe that day."));
    return box;
  }

  const NOT = "What this is not: not a forecast, not a probability and not a price target. The levels are today's price moved by a multiple of a past typical day, the counts say how often that happened and not how often it will, and the options figure is what the market charges, not what it predicts.";

  function paint(host, input, row, retry) {
    const m = model(input, row);
    const body = host.querySelector(".ft-ml-in");
    const status = host.querySelector(".ft-ml-st");
    body.replaceChildren(head(m), h("div", { class: "ft-ml-cols" }, ladder(m, retry), h("div", { class: "ft-ml-side" }, impliedBlock(m), reportBlock(m))), h("p", { class: "ft-ml-not ft-ml-cap" }, NOT));
    host.classList.remove("is-slot");
    status.textContent = m.why ? "Move lab: the ladder is withheld. " + m.why : "Move lab ready.";
    return m;
  }

  const isoDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);

  function inputOf(raw) {
    const card = raw.card || {}, P = card.panels || {}, X = raw.cardX || {};
    const pm = P.pricedMove && P.pricedMove.status === "ok" ? P.pricedMove : null;
    const ctx = P.context && P.context.status === "ok" ? P.context : null;
    const E = X.earnings && (X.earnings.status === "ok" || X.earnings.status === "thin") ? X.earnings : null;
    const nx = E && E.next && isoDay(E.next.d) ? E.next : null;
    const gate = card.gate && isoDay(card.gate.earnings) ? card.gate.earnings : null;
    return {
      ticker: card.ticker, spot: raw.spot, asOf: card.sessionDate || null, closes: raw.closes,
      breaks: ctx && Array.isArray(ctx.breaks) ? ctx.breaks.map((b) => b && b.date).filter(isoDay) : [],
      implied: pm && num(pm.movePerc) !== null ? { move: pm.movePerc, low: pm.low, high: pm.high, rule: pm.horizonRule, asOf: pm.asOf || card.sessionDate }
        : { why: pm ? "The feed quoted no implied move for the nearest end-of-week expiry on this card." : "The card carries no priced move." },
      report: nx ? { d: nx.d, sessions: nx.sessions, when: nx.when, confirmed: nx.confirmed, em: E.impliedNext ? E.impliedNext.em : null } : gate ? { d: gate, sessions: null, gate: true } : null,
      reportWhy: E ? "No upcoming report on the calendar." : "The card carries no earnings record for this name.",
    };
  }

  function mount(host, raw) {
    if (!host || !raw || !raw.card) return;
    const input = inputOf(raw);
    if (!host.querySelector(".ft-ml-in")) host.replaceChildren(h("p", { class: "visually-hidden ft-ml-st", role: "status" }), h("div", { class: "ft-ml-in", tabindex: "-1" }));
    if (KEPT) { paint(host, input, rowOf(KEPT, input.ticker), null); return; }
    const pending = { sig: null, f2: null, f3: null, ed: null, why: "Reading the nightly universe\u2026", rwhy: "Reading the nightly universe\u2026" };
    const go = () => {
      paint(host, input, pending, null);
      universe().then((u) => paint(host, input, rowOf(u, input.ticker), null), () => {
        paint(host, input, { sig: null, f2: null, f3: null, ed: null, why: "The nightly universe could not be read, so the typical daily move is not available.", rwhy: "The nightly universe could not be read, so the report is not classified." }, () => { go(); host.querySelector(".ft-ml-in").focus({ preventScroll: true }); });
      });
    };
    go();
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, { moveLab: Object.freeze({ mount, model, inputOf, rowOf, returnsOf, counted, frequency, fmt: Object.freeze({ usd, pct: pctText }) }) }));
})();
