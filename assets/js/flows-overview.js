(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const statusEl = $("flowsStatus");
  const staleEl = $("flowsStale");

  const UI = window.FlowsUI;
  if (!UI) {
    if (statusEl) {
      statusEl.textContent = "The shared UI library did not load, so this page " +
        "cannot draw. Nothing here is a reading about the session — refresh to try again.";
    }
    return;
  }
  const { h, F, isNum, DASH, MINUS, fmtSigned, fmtStamp, scoreStrip, glyph } = UI;
  const C = UI.chart;

  const ans = (p) => (p && p.status !== "pending" ? p : null);
  const POP = { "aria-haspopup": "dialog", "aria-controls": "fxPop" };
  const verdictHost = $("ccVerdict");
  const stage = $("hmStage"), hm = $("hm"), pager = $("hmPager");
  if (!statusEl || !verdictHost || !stage || !hm || !pager) return;
  const fitOf = () => getComputedStyle(stage).getPropertyValue("--hm-fit").trim() || "flat";

  const ROW_MAX = 10;
  const LIST_MAX = 8;
  const SHOW = 5;

  const NO_CARD_SAID =
    "No detail card: the chain and the card cost vendor calls the run spends " +
    "only on the names furthest from neutral. This row is scored and ranked " +
    "from the same five sources as every other.";

  const pct = F.unit.of("pct", { dp: 2, signed: true });
  const usd = F.unit.of("moneyCompact", { dp: "short" });
  const usdS = F.unit.of("moneyCompact", { dp: "short", signed: true });

  let tideOpts = null;
  const tideHeight = (plot) => {
    if (fitOf() !== "flat") {
      const cs = getComputedStyle(plot), key = plot.querySelector(".ui-legend");
      const inner = plot.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - ((key ? key.offsetHeight : 18) + (parseFloat(cs.rowGap) || 0));
      return Math.min(440, Math.max(64, Math.floor(inner)));
    }
    const room = plot.clientHeight - 30;
    return room > 190 ? Math.min(room, 440) : [190, 220, 236];
  };
  const hourTicks = (lo, hi, step) => {
    const out = [];
    const every = step || 60;
    for (let m = Math.ceil(lo / every) * every; m <= hi; m += every) out.push({ v: m, label: F.tick(m) });
    return out;
  };

  const sessionsSaid = (n) => n + (n === 1 ? " session" : " sessions");
  const daysSaid = (n) => n + (n === 1 ? " calendar day" : " calendar days");

  const capSaid = (shown, of) => (of > shown ? shown + " of " + of : "all " + of);
  const countSaid = (shown, of) => (of > shown ? shown + " of " + of : String(of));

  const toneOf = (v) => {
    const n = isNum(v);
    return n === null ? null : n > 0 ? "up" : n < 0 ? "down" : "flat";
  };

  const KIND = {
    pending: ["pending", "Pending"],
    empty: ["quiet", "Quiet"],
    unavailable: ["unavailable", "Unavailable"],
    unreadable: ["stop", "Unreadable"],
  };
  const disclose = (title, lead, more) => UI.info(() => Object.assign({ title, lead }, more || {}));
  const arr = (x) => (Array.isArray(x) ? x : []);
  const rowsOf = (p) => arr(p.rows);

  function hush(into, kind, text, what, height) {
    const [g, word] = KIND[kind] || KIND.unavailable;
    into.append(h("div", {
      class: "ui-silent hm-hush", "data-empty": kind, "data-state": kind, role: "note",
      "aria-label": word + ": " + what, style: { "--silent-h": (height || 112) + "px" },
    },
    glyph(g), h("div", { class: "ui-silent-t" }, word),
    h("button", { type: "button", ...POP, "data-info": disclose(cap1(what), text) }, "Why")));
    return true;
  }

  function mark(kind, text, label) {
    const [g, word] = KIND[kind] || KIND.unavailable;
    return h("button", {
      class: "ui-state hm-mark", type: "button", "data-empty": kind, "data-state": kind, title: word,
      "aria-label": word + ": " + label, ...POP,
      "data-info": disclose(cap1(label), text),
    }, glyph(g));
  }

  const cap1 = (t) => (typeof t === "string" && t ? t[0].toUpperCase() + t.slice(1) : t);

  function big(id, value, caption, tone, why) {
    const box = $(id + "N");
    if (!box) return;
    const v = box.querySelector(".hm-big-v"), c = box.querySelector(".hm-big-c");
    const none = value === null || value === undefined;
    v.textContent = none ? DASH : value;
    if (none) v.dataset.tone = "silent";
    else if (tone) v.dataset.tone = tone;
    else v.removeAttribute("data-tone");
    c.textContent = none ? (why ? why[3] : "not read") : caption;
    for (const old of box.querySelectorAll(".hm-mark")) old.remove();
    if (none && why) box.append(mark(why[0], why[1], why[2]));
  }

  const gone = (payload, what) => (!payload
    ? ["unreadable", "The " + what + " could not be read, so no figure is shown. That is a fault on this page and not a fact about the session.", what, "could not be read"]
    : payload.status === "pending"
      ? ["pending", "The " + what + " has not been published for this session yet. Nothing has been measured, so no figure is shown.", what, "not published yet"]
      : null);

  function silent(into, payload, what, height) {
    if (!payload) {
      return hush(into, "unreadable",
        "The " + what + " could not be read, so this region is blank. That is a " +
        "fault on this page and not a fact about the session — refresh to try again.", what, height);
    }
    if (payload.status === "pending") {
      return hush(into, "pending",
        "The " + what + " has not been published for this session yet. Nothing has " +
        "been measured here, so nothing is being claimed.", what, height);
    }
    return false;
  }

  function infoInto(sectionId, label, build) {
    const head = document.querySelector("#" + sectionId + " .ui-mod-h");
    if (!head) return;
    const old = head.querySelector(":scope > .ui-info");
    if (old) old.remove();
    head.append(UI.infoButton(label, build));
  }

  function headMark(sectionId, node) {
    const t = document.querySelector("#" + sectionId + " .ui-mod-t");
    if (!t) return;
    for (const old of t.querySelectorAll(".hm-mark")) old.remove();
    if (node) t.append(node);
  }

  function table(label, heads, rows) {
    return h("div", { class: "hm-tw", role: "region", "aria-label": label, tabindex: "0" },
      h("table", { class: "hm-tbl" },
        h("thead", null, h("tr", null, heads.map(([t, num, said]) =>
          h("th", { scope: "col", class: num ? "c-num" : null, title: said || null }, t)))),
        h("tbody", null, rows.map((r) => h("tr", r.attrs || null, r.cells.map((c) => {
          const cell = Array.isArray(c) ? c : [c];
          return h("td", { class: cell[1] || null, title: cell[2] || null }, cell[0]);
        }))))));
  }

  const rowCount = (payload) =>
    ans(payload) && Array.isArray(payload.rows)
      ? payload.rows.length : null;

  const poolCount = (payload) => {
    const rows = rowCount(payload);
    return rows === null ? null : (isNum(payload.cleared) ?? rows);
  };

  function ranked(rows) {
    const list = arr(rows).slice();
    const published = list.length > 0 && list.every((r) => isNum(r && r.r) !== null);
    if (published) { list.sort((a, b) => isNum(a.r) - isNum(b.r)); return list; }

    list.sort((a, b) => {
      const av = isNum(a && a.s), bv = isNum(b && b.s);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return Math.abs(bv) - Math.abs(av);
    });
    return list;
  }

  const readerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(t) + "&s=signal&from=overview";

  function nameNode(t, hasCard) {
    if (!t) return h("span", { class: "cc-flat" }, DASH);
    if (!hasCard) return h("span", { class: "cc-flat", title: NO_CARD_SAID }, t);
    return h("a", { class: "cc-open", href: readerHref(t), title: "Open the full reader for " + t }, t);
  }

  function earningsMark(row, ev) {
    const s = isNum(ev && ev.sdte);
    const d = isNum(row && row.edte);
    const date = (ev && ev.d) || (row && row.ed) || null;
    let text = null, said = null;
    if (s !== null) { text = s + "s"; said = sessionsSaid(s) + " away"; }
    else if (d !== null) { text = d + "d"; said = daysSaid(d) + " away"; }
    else if (date) { text = ""; said = null; }
    if (text === null) return null;
    const title = "Reports " + (date || "inside the events window") +
      (said ? " · " + said : "") +
      ". A signal carried into a print stops being the signal that was ranked.";
    const near = (s !== null && s <= 5) || (s === null && d !== null && d <= 7);
    return h("span", { class: "hm-tag cc-ern" + (near ? " is-near" : ""), title, "aria-label": title }, glyph("cal"), text);
  }

  const CROSS_WORDS = { cleared: "cleared", faded: "faded", flipped: "flipped" };
  const CROSS_SAID = {
    cleared: "Was inside the dead band at the previous scored session and is " +
      "outside it now. The name became actionable this session.",
    faded: "Was outside the dead band and is inside it now. The exit signal, " +
      "and exactly as load-bearing as the entry.",
    flipped: "Outside the band at both ends with opposite signs. The name did " +
      "not weaken and re-strengthen; it changed sides without resting in the middle.",
  };

  const strips = [];

  function drawStrips() {
    const shown = strips.find((s) => s.cell.isConnected && s.cell.clientWidth > 0);
    const base = shown ? Math.round(shown.cell.clientWidth) : 0;
    for (const s of strips) {
      if (!s.cell.isConnected) continue;
      const w = Math.round(s.cell.clientWidth) || base;
      if (!w || w === s.w) continue;
      s.w = w;
      s.cell.replaceChildren();
      scoreStrip(s.cell, {
        values: s.series, width: w, height: 28,
        domain: s.track.domain, deadBand: s.track.deadBand, prefix: "hm",
        ariaLabel: "Score for " + s.t + " across " + s.measured + " archived sessions",
      });
    }
  }

  const drawn = [];
  function trackInto({ t, trk, name }, track) {
    trk.removeAttribute("aria-busy");
    const series = track.byName[t];
    const measured = (series || []).filter((v) => isNum(v) !== null).length;
    if (series && measured) strips.push({ cell: trk, series, track, t, measured, w: 0 });
    else trk.textContent = DASH;
    const mv = track.moveBy[t];
    const cross = mv && mv.current && typeof mv.d1.cross === "string" ? mv.d1.cross : null;
    if (cross) name.firstChild.after(h("span", { class: "hm-tag cc-cross", "data-cross": cross, title: CROSS_SAID[cross] || null }, CROSS_WORDS[cross]));
  }

  function sideList(into, rows, knowsDeep, label) {
    const list = [];
    const shown = rows.slice(0, ROW_MAX);
    for (const row of shown) {
      const t = String((row && row.t) || "");
      const deep = !knowsDeep || (row && row.dp === 1);
      const card = Boolean(t) && deep;
      const name = h("span", { class: "hm-name cc-t" }, h("b", { class: "hm-t" }, t || DASH));
      const conv = isNum(row.cnv);
      const sub = h("span", { class: "hm-sub" },
        h("span", { class: "hm-prem", "data-tone": toneOf(row.netPrem) }, usdS(row.netPrem)),
        h("span", { class: "hm-conv", title: "Conviction measures agreement in the published inputs, not a probability of profit." },
          "conv " + (conv === null ? DASH : String(Math.round(conv)))));

      const trk = h("span", { class: "hm-trk cc-trk", "aria-busy": "true" });
      const c = namesChg(t, row);
      const chg = chgNode(c);

      const score = isNum(row.s);
      const kids = [
        h("span", { class: "hm-rk" }, isNum(row.r) === null ? DASH : String(row.r)),
        h("span", { class: "hm-who" }, name, sub),
        trk,
        h("span", { class: "hm-score cc-score", "data-tone": toneOf(score) }, fmtSigned(row.s)),
        chg,
      ];
      const node = card
        ? h("a", { class: "ui-row hm-lrow cc-open", href: readerHref(t), "aria-label": nameSaid(t, row, c, true), "data-ticker": t }, kids)
        : h("div", { class: "ui-row hm-lrow cc-flat", role: "listitem", title: t ? NO_CARD_SAID : null, "aria-label": nameSaid(t, row, c, false), "data-ticker": t }, kids);
      drawn.push({ t, row, name, trk, chg, node, card });
      list.push(node);
    }
    into.append(UI.list(list, { visible: SHOW, label }));
  }

  const nameSaid = (t, row, c, card) => t + ", score " + fmtSigned(row.s) + ", conviction " + (isNum(row.cnv) === null ? DASH : Math.round(row.cnv)) +
    ", price " + pct(c.v) + (c.live ? " today" : "") + ", net premium " + usd(row.netPrem) + (card ? ". Open the reader." : "");
  function namesChg(t, row) {
    const v = t ? focusRows([t])[0] : null;
    return v && v.src === "live" && v.chg !== null ? { v: v.chg, live: true } : { v: isNum(row.chg), stamp: stampFor(DAY.boards) };
  }
  const chgNode = (c) => h("span", { class: "hm-chg", "data-tone": toneOf(c.v), "data-src": c.live ? "live" : null, "data-session": c.stamp ? c.stamp.day : null,
    title: (c.live ? "Live price return over the previous close." : "Session price return, close over the prior close." + (c.stamp ? " " + c.stamp.said : "")) + " Not the score move." },
  pct(c.v), c.stamp ? h("span", { class: "hm-chg-s" }, c.stamp.text) : null);

  function patchNames() {
    for (const d of drawn) {
      if (!d.chg || !d.chg.isConnected) continue;
      const c = namesChg(d.t, d.row);
      const next = chgNode(c);
      if (next.textContent === d.chg.textContent && next.dataset.src === d.chg.dataset.src) continue;
      d.chg.replaceWith(next);
      d.chg = next;
      if (d.node) d.node.setAttribute("aria-label", nameSaid(d.t, d.row, c, d.card));
    }
  }

  function readTrack(payload) {
    const byName = Object.create(null);
    const moveBy = Object.create(null);
    const sessionRows = arr(payload && payload.sessions);
    const lastIndex = sessionRows.length - 1;
    let lo = 0, hi = 0, sessions = 0;
    if (payload && Array.isArray(payload.names)) {
      for (const name of payload.names) {
        if (!name || !name.t) continue;
        const series = arr(name.s);
        byName[name.t] = series;
        if (name.d1) {
          const at = isNum(name.lastAt);
          moveBy[name.t] = {
            d1: name.d1,
            at,
            last: isNum(name.last),
            current: lastIndex >= 0 && at !== null && at === lastIndex,
            on: at !== null && sessionRows[at] ? sessionRows[at].d || null : null,
          };
        }
        if (series.length > sessions) sessions = series.length;
        for (const value of series) {
          const v = isNum(value);
          if (v === null) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    return {
      byName, moveBy, domain: { lo, hi },
      dates: sessionRows.map((r) => (r && r.d) || null),
      deadBand: payload ? isNum(payload.deadBand) : null,
      label: sessions ? sessions + " sessions" : "Score track",
    };
  }

  const keySilence = (payload, read, quietSaid) => {
    if (!payload) return ["unreadable", "could not be read — refresh to try again"];
    if (payload.status === "pending") return ["pending", "not published yet"];
    if (read) return null;
    if (quietSaid) return ["empty", quietSaid];
    return ["unavailable", "not on this payload"];
  };

  function chip(o) {
    const attrs = {
      class: "ui-gchip hm-chip", type: "button", ...POP,
      "data-chip": o.key, "data-empty": o.silence ? o.silence[0] : null, "data-info": UI.info(o.info),
    };
    const g = o.silence
      ? h("span", { class: "ui-gchip-g hm-chip-g", "data-empty": o.silence[0] }, glyph((KIND[o.silence[0]] || KIND.unavailable)[0]))
      : o.g;
    if (o.stamp) attrs["data-session"] = o.stamp.day;
    const top = o.stamp
      ? h("span", { class: "hm-chip-top" }, g, h("span", { class: "hm-chip-s", title: o.stamp.said }, o.stamp.text, h("span", { class: "hm-chip-sx" }, " close")))
      : g;
    return h("button", attrs, top,
      h("span", { class: "ui-chip-v", "data-tone": o.silence ? "silent" : o.tone || null }, o.value),
      h("span", { class: "ui-chip-l" }, o.key));
  }

  function pair(a, b, word) {
    const whole = a !== null && b !== null && a + b > 0 ? Math.round((a / (a + b)) * 100) + "%" : null;
    return [h("span", { class: "hm-v-full" },
      h("span", { class: "hm-half", "data-tone": a === null ? null : "up" }, a === null ? DASH : String(a)), h("span", { class: "hm-sl" }, " / "),
      h("span", { class: "hm-half", "data-tone": b === null ? null : "down" }, b === null ? DASH : String(b)), h("span", { class: "visually-hidden" }, " " + word)),
    h("span", { class: "hm-v-short", "aria-hidden": "true" }, whole || (a === null ? DASH : String(a)) + "/" + (b === null ? DASH : String(b)))];
  }

  let verdictArgs = null;
  function stampFor(day) {
    const d = isoDayOf(day), p = pageDay(), t = Date.parse(d + "T12:00:00Z");
    if (!d || !p || d >= p) return null;
    return { day: d, text: Date.parse(p + "T12:00:00Z") - t < 6.5 * 864e5 ? dayShort(d).slice(0, 3) : F.day(d), said: "Close of " + dayShort(d) + "." };
  }

  function paintVerdict(into, long, short, market, alerts, pulse) {
    verdictArgs = [into, long, short, market, alerts, pulse];
    into.replaceChildren();
    const breadth = (market && market.breadth) || {};
    const premium = (market && market.premium) || {};

    const { silence: boardsSilence } = boardsRead(long, short);
    const bulls = poolCount(long);
    const bears = poolCount(short);

    const seen = isNum(alerts && alerts.seen);
    const atLimit = Boolean(alerts) && (alerts.vendorTruncated === true || alerts.readTruncated === true);
    const alertRows = alerts && Array.isArray(alerts.rows) ? alerts.rows.length : null;

    const bt = isNum(breadth.tilt);
    const pt = isNum(premium.tilt);
    const bull = isNum(breadth.bull), bear = isNum(breadth.bear);
    const leaned = bull !== null && bear !== null ? bull + bear : null;
    const up = isNum(premium.netPositive), down = isNum(premium.netNegative);
    const gross = up !== null && down !== null ? up + down : null;
    const btSilence = keySilence(market, bt !== null, leaned === 0 ? "no name leaned" : null);
    const ptSilence = keySilence(market, pt !== null, gross === 0 ? "no net premium was priced" : null);
    const brSilence = keySilence(market, bull !== null && bear !== null, null);

    const pc = pcOf(pulse);
    const pcSilence = keySilence(pulse, pc.now !== null, null);
    const clSilence = bulls === null && bears === null ? boardsSilence(false) : null;
    const flSilence = keySilence(alerts, seen !== null, null);

    const mDay = isoDayOf(market && market.sessionDate);
    const pDay = isoDayOf(pc.date) || isoDayOf(pulse && pulse.sessionDate);
    const aDay = isoDayOf(alerts && alerts.sessionDate);
    const stamps = { bias: ptSilence ? null : stampFor(mDay), breadth: brSilence ? null : stampFor(mDay), cleared: clSilence ? null : stampFor(DAY.boards),
      pc: pcSilence ? null : stampFor(pDay), flagged: flSilence ? null : stampFor(aDay) };
    const sessionFact = (d) => ["Session", d ? dayShort(d) : null];

    const share = (a, b) => (a !== null && b !== null && a + b > 0 ? a / (a + b) : null);
    const silenceSaid = (s, subject) => (!s ? null
      : s[0] === "unreadable" ? cap1(subject) + " could not be read — refresh to try again."
        : s[0] === "empty" ? cap1(subject) + " is empty: " + s[1] + "."
          : cap1(subject) + " is " + s[1] + ".");

    const chips = [
      chip({
        key: "Flow bias", value: pct(pt, 1), tone: toneOf(pt), silence: ptSilence, stamp: stamps.bias,
        g: UI.divRing(pt === null ? null : pt * 100, { max: 25 }),
        info: () => ({
          title: "Flow bias", state: null,
          lead: ptSilence ? silenceSaid(ptSilence, "the dollar-weighted tilt")
            : "Net premium over the sum of each name's absolute net premium across the screened universe, weighted by dollars.",
          facts: [
            ["By dollars", pct(pt, 1)],
            ["Names equally weighted", bt !== null ? pct(bt, 1) : btSilence ? btSilence[1] : DASH],
            ["Net premium, names leaning bullish", usd(premium.netPositive)],
            ["Net premium, names leaning bearish", usd(premium.netNegative)],
            sessionFact(mDay),
          ],
          notes: [bt !== null && pt !== null && (bt > 0) !== (pt > 0) && bt !== 0 && pt !== 0
            ? "The two weightings point opposite ways: breadth without size, or size without breadth." : null],
        }),
      }),
      chip({
        key: "Breadth", value: pair(bull, bear, "names net bought against net sold"), silence: brSilence, stamp: stamps.breadth,
        g: UI.ring(share(bull, bear), { color: "--up-mark" }),
        info: () => ({
          title: "Breadth",
          lead: brSilence ? silenceSaid(brSilence, "the breadth split")
            : "Screened names whose net premium was bought against those whose net premium was sold.",
          facts: [["Bought", bull === null ? DASH : String(bull)], ["Sold", bear === null ? DASH : String(bear)],
            ["Bought share", share(bull, bear) === null ? DASH : F.pct(share(bull, bear), 0)],
            ["Screened", isNum(market && market.n) === null ? DASH : String(market.n)], sessionFact(mDay)],
        }),
      }),
      chip({
        key: "Cleared", value: pair(bulls, bears, "names cleared the band bullish against bearish"),
        silence: clSilence, stamp: stamps.cleared,
        g: UI.ring(share(bulls, bears), { color: "--up-mark" }),
        info: () => ({
          title: "Cleared the band",
          lead: clSilence ? silenceSaid(clSilence, "the cleared pool")
            : "Names past the dead band on each board, counted whole rather than to the rows this page draws.",
          facts: [["Bullish", bulls === null ? DASH : String(bulls)], ["Bearish", bears === null ? DASH : String(bears)], sessionFact(DAY.boards)],
        }),
      }),
      chip({
        key: "Put/call", value: pc.now === null ? DASH : pc.now.toFixed(2), silence: pcSilence, stamp: stamps.pc,
        tone: pc.z === null ? null : pc.z > 1 ? "down" : pc.z < -1 ? "up" : null,
        g: pc.z !== null ? UI.divRing(-pc.z, { max: 3 }) : UI.ring(pc.now === null ? null : Math.min(1, pc.now / 1.5), { color: "--label-2" }),
        info: () => ({
          title: "Put/call volume",
          lead: pcSilence ? silenceSaid(pcSilence, "the put/call ratio")
            : "Put contracts traded per call contract across the whole options market, on the vendor's daily totals.",
          facts: [["Today", pc.now === null ? DASH : pc.now.toFixed(3)], ["Session", pc.date],
            ["z against the year", pc.z === null ? (pc.zWhy || "not published yet") : F.signed(pc.z, 2) + " sd"],
            ["Mean", pc.mean === null ? null : pc.mean.toFixed(3)], ["Sessions", pc.n === null ? null : String(pc.n)]],
        }),
      }),
      chip({
        key: "Flagged", value: seen === null ? DASH : (atLimit ? "≥" : "") + seen,
        silence: flSilence, stamp: stamps.flagged,
        g: UI.iconChip("unusual", "--s-orange"),
        info: () => ({
          title: "Flagged windows",
          lead: flSilence ? silenceSaid(flSilence, "the flagged-window count") : "Option windows the vendor's own rules flagged in this read." +
            (atLimit ? " The read hit the vendor's ceiling, so the count is a floor and never a census." : ""),
          facts: [["Seen", seen === null ? DASH : (atLimit ? "≥" : "") + seen], ["Carried", alertRows === null ? DASH : String(alertRows)], sessionFact(aDay)],
        }),
      }),
    ];
    into.append(UI.chips(chips, "Session readings"));
  }

  function pcOf(pulse) {
    const out = { now: null, z: null, mean: null, n: null, date: null, zWhy: null };
    if (!pulse || pulse.status === "pending") return out;
    const hist = pulse.totalsHistory && typeof pulse.totalsHistory === "object" ? pulse.totalsHistory : null;
    const pv = hist && hist.pcVolume && typeof hist.pcVolume === "object" ? hist.pcVolume : null;
    if (pv) {
      out.now = isNum(pv.now);
      out.z = isNum(pv.z);
      out.mean = isNum(pv.mean);
      out.n = isNum(hist.n);
      out.date = typeof hist.date === "string" ? hist.date : null;
      out.zWhy = typeof pv.reason === "string" ? pv.reason : null;
    }
    const tot = pulse.totals;
    if (out.now === null && tot && tot.status === "ok" && Array.isArray(tot.rows) && tot.rows[0]) {
      const c = isNum(tot.rows[0].callVol), p = isNum(tot.rows[0].putVol);
      out.now = c !== null && p !== null && c > 0 ? p / c : null;
      out.date = typeof tot.rows[0].date === "string" ? tot.rows[0].date : null;
    }
    return out;
  }

  function boardsRead(long, short) {
    const answered = [long, short].filter(ans);
    const longDate = answered.includes(long) ? long.sessionDate : null;
    const shortDate = answered.includes(short) ? short.sessionDate : null;
    const date = (typeof longDate === "string" && longDate) ||
      (typeof shortDate === "string" && shortDate) || null;
    const silence = (read) => read ? null
      : answered.length ? ["unavailable", "not on this payload"]
        : (!long || !short) ? ["unreadable", "could not be read — refresh to try again"]
          : ["pending", "not published yet"];
    return { silence, date };
  }

  const DAY = { boards: null, tide: null, quiet: null, read: false, word: null };
  const isoDayOf = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const pageDay = () => (DAY.tide && (!DAY.boards || DAY.tide > DAY.boards) ? DAY.tide : DAY.boards);

  function titleFor() {
    const m = UI.freshness.market();
    const word = (pageDay() || m.expected) === m.today ? "Today" : "Last session";
    if (word !== DAY.word) {
      DAY.word = word;
      const t = $("fxTitle");
      if (t) t.textContent = word;
      UI.shell.title(word);
    }
    paintDay();
  }

  function paintDay() {
    const el = $("ccMetaDate");
    if (!el || !DAY.read) return;
    const quiet = DAY.quiet;
    const day = !DAY.boards && quiet ? null : pageDay();
    el.replaceChildren();
    if (day) {
      el.setAttribute("datetime", day);
      el.textContent = dayLong(day);
      delete el.dataset.empty;
    } else {
      el.removeAttribute("datetime");
      el.append("Session ", mark(quiet ? quiet[0] : "unavailable", "The session " + (quiet ? quiet[1] : "is unknown") + ".", "session"));
      el.dataset.empty = quiet ? quiet[0] : "unavailable";
      el.dataset.said = "session " + (quiet ? quiet[1] : "unknown");
    }
    let note = $("hmBoardsDay");
    if (DAY.boards && day && DAY.boards !== day) {
      if (!note) { note = h("span", { class: "hm-boards-day", id: "hmBoardsDay" }); el.after(note); }
      note.textContent = "Boards from " + dayShort(DAY.boards);
    } else if (note) note.remove();
  }
  titleFor();

  function paintMeta(dateEl, screenedEl, boards, market) {
    const { silence: boardsSilence, date } = boardsRead(boards[0], boards[1]);
    if (dateEl) {
      DAY.boards = isoDayOf(date);
      DAY.quiet = boardsSilence(date !== null);
      DAY.read = true;
    }
    titleFor();
    const n = isNum(market && market.n);
    const nQuiet = keySilence(market, n !== null, null);
    if (screenedEl) {
      screenedEl.replaceChildren();
      if (n !== null) {
        screenedEl.textContent = n + " screened";
        delete screenedEl.dataset.empty;
      } else if (nQuiet) {
        screenedEl.append("Screened ", mark(nQuiet[0], "The screened population " + nQuiet[1] + ".", "screened names"));
        screenedEl.dataset.empty = nQuiet[0];
        screenedEl.dataset.said = "screened " + nQuiet[1];
      }
      screenedEl.hidden = n === null && !nQuiet;
    }
  }

  const dayShort = (iso) => dayLong(iso).replace(/^(\w{3})\w*/, "$1");

  function dayLong(iso) {
    const t = Date.parse(iso + "T12:00:00Z");
    if (!Number.isFinite(t)) return iso;
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(t));
    } catch { return iso; }
  }

  const bucket = (iso) => Math.floor(Date.parse(iso) / 300000);
  const onBuckets = (t, zt, zv) => {
    const by = new Map(zt.map((x, i) => [bucket(x), isNum(zv[i])]));
    return t.map((x) => by.get(bucket(x)) ?? null);
  };

  function liveSeries(lt, session, ff, readAt) {
    if (!lt || lt.status !== "ok" || !Array.isArray(lt.t) || !lt.t.length) return null;
    const at = (arr, i) => (Array.isArray(arr) ? isNum(arr[i]) : null);
    return {
      live: true, session: session || lt.date || null, readAt: readAt || null, ff: ff || null,
      t: lt.t.slice(), net: lt.t.map((_, i) => at(lt.net, i)),
      call: lt.t.map((_, i) => at(lt.ncp, i)), put: lt.t.map((_, i) => at(lt.npp, i)),
    };
  }

  function pulseSeries(pulse) {
    const pt = ans(pulse) && pulse.tide;
    if (!pt || pt.status !== "ok" || !Array.isArray(pt.points) || !pt.points.length) return null;
    const pts = pt.points;
    const call = pts.map((p) => isNum(p && p.callPrem)), put = pts.map((p) => isNum(p && p.putPrem));
    return {
      live: Boolean(pulse.live), session: pulse.readDay || pulse.sessionDate || null,
      readAt: pulse.readAt || null, ff: pulse.__ff || null, t: pts.map((p) => p && p.t), call, put,
      net: call.map((c, i) => (c === null || put[i] === null ? null : c - put[i])),
    };
  }

  function zeroOf(tide, S) {
    const lb = ans(S.liveBreadth) && S.liveBreadth.dte ? S.liveBreadth.dte.zero : null;
    const lm = ans(S.liveMkt) ? S.liveMkt.zeroDte : null;
    const reg = ans(S.regime) && S.regime.zeroDte && S.regime.zeroDte.status === "ok" ? S.regime.zeroDte : null;
    const same = (d) => !d || !tide.session || d === tide.session;
    if (tide.live) {
      for (const z of [lb, lm]) {
        if (z && z.status === "ok" && Array.isArray(z.t) && z.t.length && same(z.date)) {
          return { series: onBuckets(tide.t, z.t, z.net || []), last: lastOf(z.net) };
        }
      }
    }
    return { series: null, last: reg && same(reg.date || S.regime.sessionDate) ? isNum(reg.np0) : null };
  }

  function tideOf(S) {
    const p = pulseSeries(S.pulse);
    const pulseDay = ans(S.pulse) ? S.pulse.sessionDate || null : null;
    const lm = ans(S.liveMkt);
    const l = lm && (!pulseDay || !lm.session || lm.session >= pulseDay)
      ? liveSeries(lm.tide, lm.session, lm.__ff, lm.fresh && lm.fresh.readAt) : null;
    const tide = [l, p].find((x) => x && x.t.length >= 2) || [l, p].find(Boolean) || null;
    if (tide) {
      const z = zeroOf(tide, S);
      tide.zero = z.series && z.series.some((x) => x !== null) ? z.series : null;
      tide.zeroLast = lastOf(tide.zero) ?? z.last;
    }
    return tide;
  }

  const lastOf = (arr) => {
    if (!Array.isArray(arr)) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (isNum(arr[i]) !== null) return isNum(arr[i]);
    return null;
  };

  function heroState(tide, boardsDay) {
    if (!tide) return ["pending", "Pending", ""];
    const m = UI.freshness.market();
    const day = tide.session ? F.day(tide.session) : "";
    const past = tide.session && tide.session < m.today;
    const age = Date.now() - Date.parse(tide.readAt);
    let s = tide.live && tide.ff ? tide.ff.stateAt() : null;
    if (s === "stale" && !m.open && tide.ff.reason === "missed-close") s = "closed";
    if (!s && tide.session && tide.session < m.expected) return ["stale", "Stale", day];
    if (!tide.live) return past ? ["last", "Closed \u00b7 last session", day] : ["closed", "Closed", day];
    const broken = s === "closed" && tide.ff && tide.ff.phase === "closed" && m.open && !past;
    if (!s || broken) s = m.open && !past ? (age <= 600000 ? "live" : "stale") : "closed";
    const other = boardsDay && tide.session && tide.session !== boardsDay;
    const at = tide.readAt ? (other ? day + " " : "") + F.time(tide.readAt) : day;
    if (s === "live") return ["live", "Live", at];
    if (s === "fresh") return ["fresh", "Updated", at];
    if (s === "stale") return ["stale", "Stale", past ? day : at];
    return past ? ["last", "Closed \u00b7 last session", day] : ["closed", "Closed", day];
  }

  function paintPill(tide) {
    const pill = $("hmTideState");
    if (!pill) return "pending";
    const [state, word, when] = heroState(tide, S.boardsDay);
    const def = UI.STATES[state === "last" ? "fresh" : state] || UI.STATES.closed;
    pill.replaceChildren(h("button", {
      class: "hm-pill", type: "button", "data-state": state, ...POP,
      "data-info": UI.info(() => ({
        title: "Market tide", state: UI.STATES[state] ? state : "closed",
        lead: !tide ? "No tide is published yet." : tide.live ? "Read live during the session." : "The nightly record of this session; no live read is newer.",
        facts: [["Source", !tide ? DASH : tide.live ? "live:market" : "pulse"], ["Session", tide && tide.session],
          ["Read", tide && tide.readAt ? fmtStamp(tide.readAt) : null], ["Points", tide ? String(tide.t.length) : null]],
        notes: ["Net premium is net call premium minus net put premium, cumulative over the session; positive is bullish premium.",
          tide && tide.t.length < 2 ? "The river draws from the second read." : null],
      })),
    }, glyph(def.g), h("span", null, word), when ? h("span", { class: "hm-pill-when" }, "· " + when) : null));
    return state;
  }

  let tideChart = null;
  let tideShown = null;
  let heroTide = null;
  const S = { pulse: null, regime: null, liveMkt: null, liveBreadth: null, boardsDay: null };
  const hero = () => {
    paintHero(heroTide = tideOf(S));
    const was = pageDay();
    DAY.tide = heroTide ? isoDayOf(heroTide.session) : null;
    titleFor();
    if (pageDay() !== was) {
      if (verdictArgs) paintVerdict(...verdictArgs);
      patchNames();
    }
  };

  function paintHero(tide) {
    const v = $("hmTideV"), cap = $("hmTideCap"), legs = $("hmTideLegs"), plot = $("hmTide");
    if (!v || !plot) return;
    const state = paintPill(tide);
    const kept = tide && tide.t.length >= 2 && tideChart && tideChart.el.isConnected && tideChart.el.parentNode === plot ? tideChart : null;
    if (!kept) {
      if (tideChart) { tideChart.destroy(); tideChart = null; }
      plot.replaceChildren();
    }
    if (!tide) {
      v.replaceChildren(DASH);
      v.dataset.tone = "silent";
      if (cap) cap.replaceChildren();
      if (legs) legs.replaceChildren();
      hush(plot, S.liveMkt === null && S.pulse === null ? "unreadable" : "pending",
        "No tide is published yet, so the river has nothing to draw.", "market tide", 220);
      return;
    }
    const net = lastOf(tide.net);
    const text = net === null ? DASH : (net > 0 ? "+" : "") + usd(net);
    if (tideShown === null) UI.roll(v, text);
    else if (tideShown !== text) UI.roll(v, text, tideShown, true);
    tideShown = text;
    v.dataset.tone = toneOf(net) || "flat";
    if (cap) {
      const t = toneOf(net);
      cap.replaceChildren(UI.capsule(t === "up" ? "Bullish premium" : t === "down" ? "Bearish premium" : "Level", { tone: t || "flat" }));
    }
    if (legs) {
      const zero = tide.zeroLast;
      legs.replaceChildren(UI.metrics([
        UI.metric("Net calls", usdS(lastOf(tide.call)), { tone: toneOf(lastOf(tide.call)) }),
        UI.metric("Net puts", usdS(lastOf(tide.put)), { tone: toneOf(-(lastOf(tide.put) || 0)) }),
        UI.metric("0DTE", zero === null ? DASH : usdS(zero), { tone: toneOf(zero),
          state: zero === null ? (state === "live" || state === "fresh"
            ? { state: "pending", reason: "No 0DTE net flow was read for this session yet." }
            : { state: "quiet", reason: "No 0DTE net flow was read for this session." }) : null }),
      ], { min: 84 }));
    }
    if (tide.t.length < 2) {
      const first = state === "live" || state === "fresh";
      plot.append(h("div", { class: "ui-silent hm-hush", "data-state": "quiet", role: "note", style: { "--silent-h": "220px" } },
        glyph("clock"), h("div", { class: "ui-silent-t" }, first ? "First read" : "One read")));
      return;
    }
    const series = [{ values: tide.net, label: "Net", format: (x) => (x > 0 ? "+" : "") + usd(x) }];
    if (tide.zero) {
      series.push({ values: tide.zero, label: "0DTE", color: "--s-gray", dash: true, width: 1.25, format: (x) => (x > 0 ? "+" : "") + usd(x) });
    }
    const mins = tide.t.map((t) => F.axis(t, tide.session));
    const timed = mins.every((m) => m !== null) && mins.every((m, i) => i === 0 || m > mins[i - 1]);
    const ends = series.map((sr) => lastOf(sr.values)).filter((x) => x !== null).map((x) => C.tw(series[0].format(x)));
    const opts = {
      gutter: Math.ceil(Math.max(plot.clientWidth < 600 ? 54 : 62, ...ends)),
      x: timed ? mins : tide.t, xType: timed ? "number" : "index", xFormat: (m) => F.tick(m),
      xTicks: timed ? hourTicks(mins[0], mins[mins.length - 1], plot.clientWidth < 480 ? 120 : 60) : undefined, series, twoTone: true, zero: true,
      height: tideHeight(plot), live: state === "live",
      yFormat: (x) => ((x > 0 ? "+" : "") + usd(x)).replace(/\.0(?=[KMB])/, ""),
      label: "Market tide, net premium across the session, times in TRT",
      readout: (i) => [C.part(F.time(tide.t[i]), "k"), C.part("Net", "k"),
        h("b", { "data-tone": toneOf(tide.net[i]) }, tide.net[i] === null ? DASH : usdS(tide.net[i])),
        tide.zero ? C.part("0DTE " + (tide.zero[i] === null ? DASH : usdS(tide.zero[i])), "k") : null],
    };
    tideOpts = opts;
    const legend = UI.legend([
      h("span", { class: "ui-key" }, h("i", { class: "is-split", "aria-hidden": "true" }), "Net premium"),
      series.length > 1 ? ["--s-gray", "ln", "0DTE net"] : null,
    ].filter(Boolean));
    if (kept) {
      for (const n of [...plot.children]) if (n !== kept.el) n.remove();
      plot.append(legend);
      kept.set(opts);
    } else {
      const chartHost = h("div", { class: "hm-river" });
      plot.append(chartHost, legend);
      tideChart = C.line(chartHost, opts);
    }
    if (state === "live" && tide.readAt) UI.freshness({ readAt: tide.readAt, live: true, source: "live:market" });
  }

  function paintAlerts(into, payload) {
    if (silent(into, payload, "flow alerts feed")) return;
    const rows = rowsOf(payload);
    if (!rows.length) {
      hush(into, "empty", "The vendor's rules flagged nothing in this read.", "flagged windows");
      return;
    }
    const drawn = rows.slice(0, LIST_MAX);
    const priced = drawn.map((row) => isNum(row && row.prem)).filter((one) => one !== null);
    const pool = priced.reduce((sum, one) => sum + Math.abs(one), 0);
    const top = priced.length ? Math.max(...priced.map(Math.abs)) : null;
    const share = pool > 0 && top !== null ? top / pool : null;
    const lede = (drawn.length === 1
      ? "This is the largest flagged window by premium, not the newest"
      : "These " + drawn.length + " are the largest flagged windows by PREMIUM, not the newest") +
      (share === null
        ? " — and no row here quoted a premium, so nothing ranks them and the order is the " +
          "feed's own tie-break."
        : ", and the biggest is " + (share * 100).toFixed(1) + "% of the premium across them.");

    const contract = (row) => (row.cp || DASH) + " " + (isNum(row.k) === null ? DASH : row.k) +
      (row.exp ? " " + String(row.exp).slice(5) : "");

    const list = drawn.map((row, i) => {
      const a = F.askShare(row), s = a.share;
      return h("div", { class: "ui-row hm-arow", role: "listitem", "aria-label": (row.t || DASH) + " " + contract(row) + ", " + usd(row.prem) + ", " + F.askSaid(a) },
        h("span", { class: "ui-badge", "data-tone": row.cp === "C" ? "up" : row.cp === "P" ? "down" : null, "aria-label": row.cp === "C" ? "Call" : row.cp === "P" ? "Put" : null }, row.cp === "C" || row.cp === "P" ? row.cp : "·"),
        h("span", { class: "ui-row-m" }, h("b", null, row.t || DASH), h("span", null, (isNum(row.k) === null ? DASH : row.k) + (row.exp ? " · " + F.day(String(row.exp)) : ""))),
        a.classified === null ? h("span", { class: "ui-dash hm-side" }, DASH)
          : a.share === null ? h("span", { class: "hm-side hm-none", title: F.askLabel + ": none sided" }, "none sided")
          : h("span", { class: "ui-meter hm-side", title: F.askLabel + ": " + F.askSaid(a), "data-side": a.side }, h("i", { style: { "--w": ((s || 0) * 100).toFixed(1) + "%", "--i": String(i), "--c": UI.cssVar(a.side === "ask" ? "--label-1" : a.side === "bid" ? "--side-bid" : "--label-3") } })),
        h("span", { class: "ui-row-v" }, usd(row.prem)));
    });
    const label = "Flagged option windows, largest premium first";
    into.append(UI.list(list, { visible: SHOW, label }),
      UI.legend([["--label-1", "", "Mostly ask side"], ["--side-bid", "", "Mostly bid side"], ["--label-3", "", "Mixed or thinly sided"]]));
    const detail = table(label, [
      ["Time · TRT", false, "When the vendor's flagged window opened, in T\u00fcrkiye time."],
      ["Name", false], ["Contract", false], ["Premium", true],
      ["Side", true, F.askLabel + ", and the share of premium sided at all. For contract volume the vendor defines the ask side as a fill above the midpoint; it does not document the alert field, and it is never proof of a buyer."],
      ["Rule", false, "The vendor's name for the screen that flagged the window."],
    ], drawn.map((row) => {
      const at = F.time(row.spanStart, false) === DASH ? null : F.time(row.spanStart, false);
      const to = F.time(row.spanEnd, false) === DASH ? null : F.time(row.spanEnd, false);
      return {
        cells: [
          [at === null ? DASH : at, "c-num cc-dim", at === null ? null
            : row.spanFrom === "created_at" ? "Alert created " + at + " TRT; no window stated."
              : to === null ? "Window opened " + at + " TRT; the vendor stated no end for it." : "Window ran " + at + " to " + to + " TRT."],
          [row.t || DASH, "cc-t"], [contract(row), "cc-date"], [usd(row.prem), "c-num"],
          [F.askSaid(F.askShare(row)), "c-num"],
          [row.rule || DASH, "cc-dim", row.rule ? "Flagged by the vendor's " + String(row.rule).replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase() + " rule, under the vendor's own name for it." : null],
        ],
      };
    }));
    const seen = isNum(payload.seen);
    const cadence = payload.refreshed === "intraday" ? "intraday" : payload.refreshed === "nightly" ? "nightly" : null;
    const read = typeof payload.readAt === "string" && Number.isFinite(Date.parse(payload.readAt))
      ? (cadence ? cadence + " read " : "read ") + (fmtStamp(payload.readAt) || DASH) + (cadence ? "" : ", cadence not published")
      : cadence ? cadence + " read" : "cadence not published";
    infoInto("hmAlerts", "flagged windows", () => ({
      title: "Flagged windows", lead: lede,
      facts: [["Seen", seen === null ? DASH : (payload.vendorTruncated === true || payload.readTruncated === true ? "≥" : "") + seen],
        ["Read", read]],
      notes: ["The meter is the " + F.askLabel.toLowerCase() + ". It is coloured only where at least half the premium was sided and the ask-side share is 65% or more, or 35% or less. A dash is a window that does not state both sides; none sided, printed in place of a meter that would read as a measured zero, is one that put none of its premium on either side."],
      node: detail,
    }));
  }

  function paintWatch(into, payload) {
    if (silent(into, payload, "watch board")) return;
    const rows = ranked(payload.rows);
    if (!rows.length) {
      const band = isNum(payload.deadBand);
      if (payload.status === "thin" || isNum(payload.neutral) === 0) {
        hush(into, "empty", "Every scored name cleared the " + (band === null ? "dead" : "±" + band) + " band this session.", "nearly in");
      } else hush(into, "unavailable", "The watch board published no rows.", "nearly in");
      return;
    }
    const drawn = rows.slice(0, LIST_MAX);
    const sideOf = (row) => {
      const value = isNum(row && row.resid) !== null ? isNum(row.resid) : isNum(row && row.s);
      return value === null ? null : (value > 0 ? 1 : value < 0 ? -1 : 0);
    };
    const sides = drawn.map(sideOf);
    const [above, below, onRule, unplaced] = [1, -1, 0, null].map((v) => sides.filter((one) => one === v).length);
    const nearest = drawn.length + " name" + (drawn.length === 1 ? "" : "s") + " nearest the edge";
    const lede = above + below + onRule === 0
      ? "None of the " + nearest + " published a number to place against the zero rule, so " +
        "this list is ordered and unsided."
      : above + " of the " + nearest + " sit above the zero rule and " + below + " below it" +
        (onRule ? ", " + onRule + " exactly on it" : "") +
        (unplaced ? "; " + unplaced + " published no number to place" : "") + ".";
    const anyResid = drawn.some((row) => isNum(row.resid) !== null);
    const list = drawn.map((row) => {
      const resid = isNum(row.resid);
      const value = resid !== null ? resid : isNum(row.s);
      return UI.listRow({
        primary: row.t || DASH, secondary: "conv " + (isNum(row.cnv) === null ? DASH : Math.round(row.cnv)),
        signed: resid !== null ? [h("small", { class: "hm-unit" }, "resid "), fmtSigned(resid, 4)] : fmtSigned(row.s), signedValue: value,
        cols: resid !== null ? "minmax(0,1fr) auto" : "minmax(0,1fr) 72px",
      });
    });
    into.append(UI.list(list, { visible: SHOW, label: "Names inside the dead band, nearest the edge first" }));
    infoInto("hmWatch", "nearly in", () => ({
      title: "Nearly in", lead: lede,
      facts: [["Unit", anyResid ? "cross-sectional residual (resid)" : "score on the ±100 scale"], ["Rows", String(rows.length)]],
      notes: [anyResid
        ? "The residual is what the name was ranked on; rows are ordered on its size, which is how close the name is to leaving the band."
        : "The score is printed because this payload predates the residual on watch rows; on a narrow band every row rounds alike."],
    }));
  }

  const LEAN_TAIL = { quiet: 1, unreadable: 2 };
  function leanOrder(rows) {
    return rows.slice().sort((a, b) => {
      const av = isNum(a && a.leanRatio), bv = isNum(b && b.leanRatio);
      if (av !== null && bv !== null) return bv - av;
      if (av !== null) return -1;
      if (bv !== null) return 1;
      return (LEAN_TAIL[a && a.read] || 3) - (LEAN_TAIL[b && b.read] || 3);
    });
  }

  function paintLean(into, payload, segHost) {
    const sub = $("ccLeanSub");
    const saySub = (said) => { if (sub) sub.textContent = said; };
    saySub("");
    if (segHost) segHost.replaceChildren();
    const why = gone(payload, "sector premium lean") || (payload.status === "quiet"
      ? ["quiet", "The sector feed was read and returned no rows, so no basket is named.", "sector lean", "no basket read"]
      : payload.status === "unreadable" ? ["unreadable", "No basket carried a readable premium pair, so no basket is named.", "sector lean", "no basket readable"]
        : !arr(payload.sectors).length ? ["unavailable", "This payload carried no sector rows, so no basket is named.", "sector lean", "not on this payload"] : null);
    if (why) big("hmLean", null, "", null, why);
    if (silent(into, payload, "sector premium lean")) return;

    if (payload.status === "quiet") {
      hush(into, "empty",
        "The sector feed was read and the vendor returned no rows at all, so not one of the " +
        "eleven baskets could be placed. That is a measurement of the feed, not of the market.", "sector lean");
      return;
    }
    if (payload.status === "unreadable") {
      hush(into, "unreadable",
        "The sector feed returned rows and not one of the eleven baskets carried a readable " +
        "pair of premium sums. Nothing here is a reading about the session: the field names " +
        "on the wire and the ones this pipeline expects have parted company.", "sector lean");
      return;
    }
    const sectors = arr(payload.sectors);
    if (!sectors.length) {
      hush(into, "unavailable",
        "This payload carried no sector rows, so the page cannot say where any basket " +
        "leaned. A gap in the payload rather than a fact about the market.", "sector lean");
      return;
    }

    const ordered = leanOrder(sectors);
    const net = ordered.filter((r) => isNum(r && r.netPremiumUsd) !== null).sort((a, b) => b.netPremiumUsd - a.netPremiumUsd)[0];
    big("hmLean", net ? (net.netPremiumUsd > 0 ? (net.etf || net.sector || DASH) + " " + usdS(net.netPremiumUsd) : "None") : null, "most net bought sector",
      net && net.netPremiumUsd > 0 ? "up" : "ice", net ? null : ["unavailable", "No basket carried a readable net premium, so none is named.", "sector lean", "no net premium read"]);
    const leaned = ordered.filter((s) => isNum(s && s.leanRatio) !== null).length;
    const quietN = ordered.filter((s) => s && s.read === "quiet").length;
    const badN = ordered.length - leaned - quietN;
    const lean = payload.lean && typeof payload.lean === "object" ? payload.lean : null;

    const caveats = ["Bullish minus bearish OPTION premium on the eleven SPDR sector baskets, today only."];
    const method = [];
    if (lean && typeof lean.relation === "string" && lean.relation) {
      method.push("Derived: " + lean.relation + " — in words, net is bullish minus bearish " +
        "premium, gross is their sum, and the lean is net over gross.");
    }
    caveats.push("Ordered on the RATIO — the share of each basket's own two-sided premium " +
      "that leaned one way — because that is what the publisher ranks on" +
      (lean && typeof lean.rejected === "string" && lean.rejected ? ", having rejected " + lean.rejected : "") + ".");
    caveats.push("The dollars ride beside it because a ratio carries no size: +90% on $30k of " +
      "premium and +90% on $300M are not the same fact.");
    method.push("Sign is carried by POSITION in the table's lean bar and by the glyph on every number; the tint is only a second channel.");
    if (quietN) {
      caveats.push(quietN + (quietN === 1 ? " basket was" : " baskets were") +
        " read with both premium sums at zero: measured and empty, printed as the $0 they " +
        "are rather than dropped, and left off the axis because 0/0 is undefined and not a " +
        "neutral lean.");
    }
    if (badN) {
      caveats.push(badN + (badN === 1 ? " basket" : " baskets") + " could not be read at all " +
        "and print the em dash instead; the publisher's reason is on the row.");
    }
    if (typeof payload.basis === "string" && payload.basis) caveats.push("Basis: " + payload.basis + ".");
    if (typeof payload.notSameAs === "string" && payload.notSameAs) {
      caveats.push("This is not " + payload.notSameAs + " — that is the key the sector panel " +
        "on /flows/market/ draws, in basis points per session.");
    }

    const cts = (v) => {
      const n = isNum(v);
      if (n === null) return DASH;
      const sign = n < 0 ? MINUS : n > 0 ? "+" : "";
      const a = Math.abs(n);
      if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + "M";
      if (a >= 1e3) return sign + (a / 1e3).toFixed(0) + "K";
      return sign + String(Math.round(a));
    };
    const netCts = (r) => {
      const c = isNum(r && r.callVolume), p = isNum(r && r.putVolume);
      return c === null || p === null ? null : c - p;
    };
    const basket = (r) => r.sector || r.fullName || r.etf || DASH;
    const SHORT = { "Information Technology": "Technology", "Consumer Discretionary": "Discretionary",
      "Consumer Staples": "Staples", "Communication Services": "Comms" };
    const brief = (r) => SHORT[basket(r)] || basket(r);
    const MODES = [
      { label: "Ratio", noun: "share of its own premium", val: (r) => isNum(r && r.leanRatio), fmt: (v) => pct(v, 1), axis: 1,
        said: (n, d) => n + " of " + d + " leaned",
        two: (bh, vh, bl, vl) => bh + " leans most bullish at " + pct(vh, 1) + " of its own premium; " + bl + " most bearish at " + pct(vl, 1) + ".",
        one: (b, v) => b + " is the only basket with a readable lean, at " + pct(v, 1) + " of its own premium." },
      { label: "Premium", noun: "net option premium", val: (r) => isNum(r && r.netPremiumUsd), fmt: usdS, axis: null,
        said: (n, d) => n + " of " + d + " cleared premium",
        two: (bh, vh, bl, vl) => bh + " cleared the most bullish net premium at " + usd(vh) + "; " + bl + " the most bearish at " + usd(vl) + ".",
        one: (b, v) => b + " is the only basket with a readable premium sum, at " + usd(v) + " net." },
      { label: "Contracts", noun: "net contracts", val: netCts, fmt: cts, axis: null,
        said: (n, d) => n + " of " + d + " reported volume",
        two: (bh, vh, bl, vl) => bh + " traded the most calls over puts at " + cts(vh) + " contracts; " + bl + " the most puts over calls at " + cts(vl) + ".",
        one: (b, v) => b + " is the only basket that reported both volumes, at " + cts(v) + " contracts net." },
    ];
    let mode = 0;
    const strip = h("div", { class: "hm-heat", role: "list", "aria-label": "Sector lean, eleven baskets" });
    into.append(strip);

    const finding = (M, vals, reporting) => {
      if (!reporting.length) return "No basket carried a readable " + M.noun + " this session, so none is named.";
      const s = reporting.slice().sort((a, b) => vals.get(b) - vals.get(a));
      return s.length === 1 ? M.one(basket(s[0]), vals.get(s[0]))
        : M.two(basket(s[0]), vals.get(s[0]), basket(s[s.length - 1]), vals.get(s[s.length - 1]));
    };
    const draw = () => {
      const M = MODES[mode];
      const vals = new Map(ordered.map((r) => [r, M.val(r)]));
      const reporting = ordered.filter((r) => vals.get(r) !== null);
      saySub(M.said(reporting.length, ordered.length));
      const rank = reporting.slice().sort((a, b) => vals.get(b) - vals.get(a)).concat(ordered.filter((r) => vals.get(r) === null));
      const peak = M.axis !== null ? M.axis : reporting.reduce((m, r) => Math.max(m, Math.abs(vals.get(r))), 0);
      strip.replaceChildren(...rank.map((r, i) => {
        const v = vals.get(r);
        const read = typeof r.read === "string" ? r.read : "unreadable";
        const a = v === null || !(peak > 0) ? 0 : Math.sqrt(Math.min(1, Math.abs(v) / peak));
        const title = v === null
          ? (typeof r.reason === "string" && r.reason ? r.reason : read === "quiet"
            ? "Both premium sums were measured at zero: 0/0 is undefined, not neutral, so this basket is not placed."
            : "This basket carried no readable " + M.noun + ", so it is not placed.")
          : (r.etf ? r.etf + ": " : "") + M.fmt(v) + " " + M.noun + " · net " + usd(r.netPremiumUsd) +
            " · " + cts(netCts(r)) + " contracts · " + pct(r.leanRatio, 1) + " of its own premium.";
        return h("div", {
          class: "hm-cell", role: "listitem", "data-read": read, "data-etf": r.etf || null,
          "data-tone": v === null ? "silent" : toneOf(v), title,
          style: { "--a": a.toFixed(3), "--i": String(i) },
        },
        h("span", { class: "hm-cell-e" }, r.etf || DASH),
        h("span", { class: "hm-cell-v" }, v === null ? (read === "quiet" && M.axis === 1 ? "0/0" : DASH) : M.fmt(v)),
        h("span", { class: "hm-cell-n" }, brief(r)));
      }));
      strip.dataset.finding = finding(M, vals, reporting);
    };
    draw();
    if (segHost) segHost.append(UI.segmented("Sector quantity", MODES.map((m) => ({ label: m.label })), (i) => { mode = i; draw(); }, 0));

    const basketBar = (row) => {
      const r = isNum(row && row.leanRatio);
      if (r === null) {
        return row.read === "quiet"
          ? h("span", { class: "cc-ln-flat" }, "no premium")
          : h("span", { class: "cc-ln-none", title: typeof row.reason === "string" && row.reason ? row.reason : null }, DASH);
      }
      return leanBar(r, (row.sector || row.etf || "This basket") + " leaned " + pct(r, 1) + " of its two-sided option premium, " +
        (r < 0 ? "left of" : r > 0 ? "right of" : "exactly on") + " the zero rule.");
    };
    const detail = table("Sector option-premium lean, most bullish first", [
      ["Sector", false], ["Lean", false], ["Lean · % of premium", true], ["Net · $", true], ["Gross · $", true],
    ], ordered.map((row) => ({
      attrs: { "data-read": typeof row.read === "string" ? row.read : "unreadable" },
      cells: [[h("span", null, h("span", { class: "cc-t" }, basket(row)), " ", h("small", { class: "cc-etf" }, row.etf || DASH),
        row.read && row.read !== "ok" ? h("span", { class: "cc-dim cc-ln-tag", title: row.reason || null }, " " + row.read) : null), "cc-ln-name"],
      [basketBar(row), "cc-ln-c"], [pct(row.leanRatio, 1), "c-num"], [usd(row.netPremiumUsd), "c-num"], [usd(row.grossPremiumUsd), "c-num"]],
    })));
    infoInto("hmLean", "sector lean", () => ({
      title: "Sector lean",
      lead: finding(MODES[0], new Map(ordered.map((r) => [r, MODES[0].val(r)])), ordered.filter((r) => MODES[0].val(r) !== null)),
      sections: [{ title: "What it is", lines: caveats }, { title: "How it is derived", lines: method }],
      node: detail,
    }));
  }

  function leanBar(r, label) {
    const frac = Math.min(Math.abs(r), 1);
    return h("span", { class: "cc-ln-bar", role: "img", "aria-label": label },
      h("i", { class: "cc-ln-mid" }),
      h("i", { class: "cc-ln-fill", "data-tone": toneOf(r), style: { width: (frac * 50) + "%", left: r < 0 ? (50 - frac * 50) + "%" : "50%" } }));
  }

  const FOCUS = { focus: null, strips: null, series: null, live: null, lk: false, ed: new Map(), nightly: new Map(), streamed: false, lead: new URLSearchParams(location.search).get("lead"), pills: {} };
  const leadOn = () => { const m = $("hmLeaders"); if (m) m.dataset.lead = FOCUS.lead || "mag7"; };
  leadOn();
  const readOf = (s) => Date.parse(s.fresh && s.fresh.readAt);
  const newest = (a, b) => (readOf(b) || 0) - (readOf(a) || 0);
  const FK = ["px", "prev", "chg", "net", "lean", "iv30", "iv30p"];
  const IV_YEAR = Math.sqrt(252);
  const IV_EVENT = 21;
  const IV_APART = "Earnings within 30 days: event not separated.";
  const IV_GRADE = "From 30-day IV; no surface.";
  const ivDays = (chg, iv) => { const c = isNum(chg), v = isNum(iv); return c === null || v === null || !(v > 0) ? null : c / (v / IV_YEAR); };
  function ivdIndex(u) {
    const ok = u && u.status === "ok" && Array.isArray(u.t) && u.cols && u.units;
    const col = (k) => (ok && Array.isArray(u.cols[k]) && u.units[k] && isNum(u.units[k][1]) ? u.cols[k].map((x) => (isNum(x) === null ? null : x / u.units[k][1])) : null);
    const ed = col("ed"), iv = col("iv30p");
    FOCUS.ed = new Map(ed ? u.t.map((t, i) => [t, ed[i]]) : []);
    FOCUS.nightly = new Map(iv ? u.t.map((t, i) => [t, iv[i]]) : []);
  }
  const dossier = (t) => "/flows/ticker/?t=" + encodeURIComponent(t);
  const pick = (row, fields, k) => {
    if (Array.isArray(row)) { const i = Array.isArray(fields) ? fields.indexOf(k) : -1; return i < 0 ? null : isNum(row[i]); }
    return row && typeof row === "object" ? isNum(row[k]) : null;
  };
  const counted = (a) => a.filter((x) => x !== null).length;

  function focusRows(ts) {
    const f = ans(FOCUS.focus);
    const se = FOCUS.series;
    const fday = f && typeof f.sessionDate === "string" ? f.sessionDate : null;
    const nr = (t) => f && f.rows && f.rows[t];
    const lv = [FOCUS.live, FOCUS.strips].filter((s) => s && s.status === "ok" && s.rows && Array.isArray(s.fields) && typeof s.session === "string" &&
      (!fday || s.session > fday || (s.session === fday && !(readOf(s) <= Date.parse(f.readAt || f.generatedAt)))) &&
      ts.every((t) => s.rows[t] || !nr(t))).sort(newest);
    return ts.map((t) => {
      const s = lv.find((x) => x.rows[t]);
      const [src, row, fields, day] = s ? ["live", s.rows[t], s.fields, s.session]
        : nr(t) ? ["nightly", nr(t), f.fields, fday] : [];
      const v = { t, src, day, today: 0, s };
      for (const k of FK) v[k] = pick(row, fields, k);
      if (v.chg === null && v.px !== null && v.prev) v.chg = v.px / v.prev - 1;
      if (v.iv30p === null && src === "nightly") v.iv30p = FOCUS.nightly.has(t) ? FOCUS.nightly.get(t) : null;
      v.ed = FOCUS.ed.has(t) ? FOCUS.ed.get(t) : null;
      const b = se && se.base ? isNum(se.base[t]) : null;
      const col = se && se.cols && se.cols.px ? se.cols.px[t] : null;
      const d = s && Array.isArray(se && se.t) ? readOf(s) - Date.parse(se.t.at(-1)) : 0;
      if (b !== null && src === "live" && se.session === day && Array.isArray(col) && !(d < 0)) {
        const k = isNum(se.scale && se.scale.px) ?? 0.01;
        v.spark = col.map((x) => (isNum(x) === null ? null : b + x * k));
        if (d >= 1e3 && v.px !== null) v.spark.push(v.px);
        v.intraday = true;
      }
      if (!v.spark || counted(v.spark) < 2) {
        const c = f && f.closes && Array.isArray(f.closes[t]) ? f.closes[t].map(isNum) : [];
        v.today = +(src === "live" && day > fday && v.px !== null);
        v.spark = v.today ? c.concat(v.px) : c;
        v.intraday = false;
      }
      return v;
    });
  }

  const flowWord = (v) => {
    const l = v.lean !== null ? v.lean : v.net === null ? null : Math.sign(v.net);
    return l === null ? null : Math.abs(l) < 0.1 ? ["flat", "Even"] : l > 0 ? ["up", "Bullish"] : ["down", "Bearish"];
  };
  const tick = (v) => h("b", { class: "hm-t" }, v.t);
  const chgOf = (v) => h("span", { class: "hm-chg", "data-tone": toneOf(v.chg) }, pct(v.chg));
  const ivdOf = (v) => {
    const m = ivDays(v.chg, v.iv30p);
    const event = isNum(v.ed) !== null && v.ed <= IV_EVENT;
    return h("span", { class: "hm-qd", "data-tone": toneOf(m), title: m === null ? "No prior-close implied volatility" : "Day move over the IV struck at the previous close" },
      m === null ? DASH : fmtSigned(m, 1), event ? h("i", { class: "hm-qd-e", role: "img", title: IV_APART, "aria-label": IV_APART }) : null);
  };
  const premOf = (v) => h("span", { class: "hm-prem", "data-tone": toneOf(v.net) }, usdS(v.net));
  const said = (v, label) => [label, v.t, "price " + F.px(v.px), "day " + pct(v.chg), "net premium " + usd(v.net),
    (flowWord(v) || [0, "no flow read"])[1], "IV " + F.pct(v.iv30, 1)].filter(Boolean).join(", ") + ". Open the dossier.";
  const link = (v, cls, label, ...kids) => h("a", {
    class: cls, href: dossier(v.t), "data-ticker": v.t, "data-src": v.src, "data-label": label || null, "aria-label": said(v, label),
  }, ...kids);
  const netCell = (v, cls) => h("span", { class: cls }, premOf(v),
    v.lean === null ? null : leanBar(v.lean, "Bullish against bearish premium " + pct(v.lean, 0)));

  function mflow(v) {
    const fw = flowWord(v);
    return [fw ? UI.capsule(fw[1], { tone: fw[0] }) : h("span", { class: "ui-dash" }, DASH), netCell(v, "hm-mnet")];
  }

  function patchFocus(changed) {
    patchNames();
    const anchors = [...document.querySelectorAll("#ccMetals a[data-ticker], #ccLeaders a[data-ticker]")];
    if (!anchors.length) return;
    const rows = new Map(focusRows([...new Set(anchors.map((a) => a.dataset.ticker))]).map((v) => [v.t, v]));
    for (const a of anchors) {
      const v = rows.get(a.dataset.ticker);
      if (!v || !changed.has(v.t)) continue;
      const px = a.querySelector(".hm-mpx-v, .hm-qpx"), chg = a.querySelector(".hm-chg"), net = a.querySelector(".hm-qnet"), flow = a.querySelector(".hm-mflow"), iv = a.querySelector(".hm-qiv");
      if (px) px.textContent = F.px(v.px);
      if (chg) chg.replaceWith(chgOf(v));
      if (net) net.replaceWith(netCell(v, "hm-qnet"));
      const prem = a.classList.contains("hm-mrow") ? a.querySelector(".hm-prem") : null;
      if (prem) prem.replaceWith(premOf(v));
      if (flow) flow.replaceChildren(...mflow(v));
      if (iv) iv.textContent = F.pct(v.iv30, 1);
      a.dataset.src = v.src || "";
      a.setAttribute("aria-label", said(v, a.dataset.label || null));
    }
    for (const k in FOCUS.pills) {
      const [shown, title] = FOCUS.pills[k];
      whenPill(k, focusRows(shown.map((v) => v.t)), title);
    }
  }

  function mergeNews(body) {
    const live = UI.rt ? UI.rt.news() : [];
    if (!live.length || !body || typeof body !== "object" || !Array.isArray(body.rows)) return body;
    const key = (r) => (isNum(r.createdAtMs) === null ? "u" : r.createdAtMs) + "|" + String(r.headline || "").slice(0, 80);
    const have = new Set(body.rows.map(key));
    const add = live.filter((r) => r && typeof r.headline === "string" && !have.has(key(r)));
    if (!add.length) return body;
    const rows = add.concat(body.rows).sort((a, b) => (isNum(b.createdAtMs) ?? -1) - (isNum(a.createdAtMs) ?? -1)).slice(0, 60);
    const fr = UI.rt.fresh("nw");
    return Object.assign({}, body, { rows, status: "ok", live: true, readAt: (fr && fr.readAt) || body.readAt });
  }

  function stream() {
    const rt = UI.rt && UI.rt.connect({ topics: ["px", "mk", "nw"] });
    if (!rt) return;
    rt.on("px", (c) => {
      const s = UI.rt.strips();
      if (!s) return;
      FOCUS.strips = s;
      if (!FOCUS.streamed) { FOCUS.streamed = true; paintFocus(); } else patchFocus(new Set(c.ids));
    });
    rt.on("mk", () => {
      if (!UI.rt.feeds("mk")) return;
      const m = UI.rt.market(S.liveMkt);
      if (m && m !== S.liveMkt) { S.liveMkt = m; hero(); }
    });
    rt.on("nw", () => {
      const n = R.news ? mergeNews(R.news) : null;
      if (n && n !== R.news) { R.news = n; paintNewsLater(); }
    });
  }

  function sparkIn(host, v, height) {
    const n = counted(v.spark), t = toneOf(v.chg);
    if (!host.isConnected || n < 2) return;
    C.sparkline(host, v.spark, { height, color: v.intraday && (t === "up" || t === "down") ? "--" + t : "--label-2",
      ref: v.intraday ? v.prev : null, label: v.t + (v.intraday ? " today" : ", last " + (n - v.today) + " closes" + (v.today ? " and today" : "")) });
  }

  function whenPill(slotId, rows, title) {
    const slot = $(slotId);
    if (!slot) return;
    FOCUS.pills[slotId] = [rows, title];
    const m = UI.freshness.market();
    const s = rows.map((v) => v.s).filter(Boolean).sort(newest)[0];
    const live = rows.filter((v) => v.src === "live").length;
    const day = rows.map((v) => v.day).filter(Boolean).sort().pop() || null;
    const readAt = s && s.fresh ? s.fresh.readAt : null;
    const ff = s && s.__ff ? s.__ff.stateAt() : null;
    const state = ff === "live" ? "live" : ff === "stale" || (day && day < m.expected) ? "stale" : "fresh";
    const at = readAt && (state === "live" || ff === "stale") ? F.time(readAt) : null;
    const word = state === "live" ? "Live" : day ? F.day(day) : DASH;
    let b = slot.firstElementChild;
    if (!b) slot.append(b = h("button", { class: "hm-pill", type: "button", ...POP, "data-info": UI.info(() => b.$) }));
    b.$ = { title, state, lead: live ? "Read during the session." : "The nightly record of this session.",
      facts: [["Session", day ? F.day(day) : DASH], ["Read", readAt ? fmtStamp(readAt) : null],
        ["Live rows", live + " of " + rows.length], ["Missing", rows.filter((v) => !v.src).map((v) => v.t).join(", ") || null]] };
    if (b.k === state + word + at) return;
    b.k = state + word + at;
    b.dataset.state = state;
    b.replaceChildren(glyph(state === "live" ? "live" : "clock"), h("span", null, word), at ? h("span", { class: "hm-pill-when" }, "· " + at) : "");
  }

  function focusSilent(into, groups, what, pill) {
    const f = FOCUS.focus;
    into.closest("section").hidden = Boolean(f && f.status === "ok" && Array.isArray(f.groups) && !groups.length);
    const rows = focusRows(groups.flatMap((g) => g.tickers));
    if (rows.some((v) => v.src)) return rows;
    if (pill) { pill.replaceChildren(); delete FOCUS.pills[pill.id]; }
    if (!f) hush(into, "unreadable", "The focus payload could not be read. Refresh to try again.", what, 160);
    else if (f.status === "pending" || !groups.length) hush(into, "pending", "The focus names publish with the nightly run.", what, 160);
    else hush(into, "unavailable", cap1(typeof f.reason === "string" && f.reason ? f.reason : "the vendor returned none of these names") + ".", what, 160);
    return null;
  }

  function paintMetals(groups) {
    const into = $("ccMetals");
    if (!into) return;
    into.replaceChildren();
    const all = focusSilent(into, groups, "metals", $("ccMetalsWhen"));
    if (!all) return;
    const by = new Map(all.map((v) => [v.t, v]));
    const sparks = [];
    into.append(h("div", { class: "hm-metals" }, groups.map((g) => {
      const lead = by.get(g.tickers.includes(g.lead) ? g.lead : g.tickers[0]);
      const sp = h("span", { class: "hm-mspark" });
      sparks.push([sp, lead]);
      return h("div", { class: "hm-metal", role: "group", "aria-label": g.label || lead.t, "data-group": g.id || null },
        link(lead, "hm-mlead", g.label,
          h("span", { class: "hm-mhead" }, h("span", { class: "hm-mlabel" }, g.label || lead.t), tick(lead)),
          h("span", { class: "hm-mpx" }, h("span", { class: "hm-mpx-v" }, F.px(lead.px)), chgOf(lead)),
          sp,
          h("span", { class: "hm-mflow" }, ...mflow(lead))),
        h("div", { class: "ui-list hm-mrel", "data-more": "", role: "group", "aria-label": (g.label || lead.t) + " related" },
          g.tickers.filter((t) => t !== lead.t).map((t) => by.get(t)).map((v) => link(v, "ui-row hm-mrow", g.label, tick(v), chgOf(v), premOf(v)))));
    })));
    for (const [sp, v] of sparks) sparkIn(sp, v, 44);
    whenPill("ccMetalsWhen", all, "Metals");
  }

  function paintLeaders(groups) {
    const into = $("ccLeaders"), seg = $("ccLeadSeg");
    if (!into) return;
    into.replaceChildren();
    if (seg) seg.replaceChildren();
    if (!focusSilent(into, groups, "leaders", $("ccLeadersWhen"))) {
      big("hmLeaders", null, "", null, gone(FOCUS.focus, "leaders") || ["unavailable", "The focus payload carries none of these names, so no count is shown.", "leaders", "not on this payload"]);
      return;
    }
    let at = Math.max(0, groups.findIndex((g) => g.id === FOCUS.lead));
    const body = h("div", { class: "hm-qlist", role: "group" });
    into.append(body);
    const head = (two) => h("div", { class: "ui-row hm-qrow hm-qhead" + (two ? " is-2" : ""), "aria-hidden": "true" },
      ["", "", "Price", "Day", "Net premium", "IV 30d", "IV-days"].map((x) => h("span", x === "IV-days" ? { title: IV_GRADE } : null, x)));
    const draw = () => {
      const g = groups[at];
      const rows = focusRows(g.tickers);
      const n = Math.ceil(rows.length / 2);
      const row = (v) => link(v, "ui-row hm-qrow", null, tick(v), h("span", { class: "hm-qsp" }), h("span", { class: "hm-qpx" }, F.px(v.px)),
        chgOf(v), netCell(v, "hm-qnet"), h("span", { class: "hm-qiv" }, F.pct(v.iv30, 1)), ivdOf(v));
      body.setAttribute("aria-label", g.label || g.id);
      body.style.setProperty("--rows", String(n + 1));
      body.replaceChildren(head(), ...rows.slice(0, n).map(row), head(true), ...rows.slice(n).map(row));
      const cells = body.querySelectorAll(".hm-qsp");
      rows.forEach((v, i) => sparkIn(cells[i], v, 24));
      whenPill("ccLeadersWhen", rows, g.label || "Leaders");
      const chgs = rows.map((v) => v.chg).filter((x) => x !== null).sort((a, b) => a - b);
      const up = chgs.filter((x) => x > 0).length;
      const mid = chgs.length ? (chgs.length % 2 ? chgs[(chgs.length - 1) / 2] : (chgs[chgs.length / 2 - 1] + chgs[chgs.length / 2]) / 2) : null;
      const day = rows.some((v) => v.src === "live") && UI.freshness.market().open ? "today" : "at the close";
      big("hmLeaders", chgs.length ? up + "/" + chgs.length : null,
        chgs.length === rows.length ? (g.label || "Leaders") + " up " + day : "up · " + chgs.length + " of " + rows.length + " priced",
        mid === null ? null : mid > 0 ? "up" : mid < 0 ? "down" : "ice",
        chgs.length ? null : ["unavailable", "No name in this group carried a day change, so no count is shown.", "leaders", "no day change read"]);
    };
    draw();
    if (seg && groups.length > 1) {
      seg.append(UI.segmented("Leaders", groups.map((g) => ({ label: g.label || g.id })), (i) => {
        at = i;
        FOCUS.lead = groups[i].id;
        leadOn();
        const u = new URL(location.href);
        u.searchParams.set("lead", FOCUS.lead);
        history.replaceState(history.state, "", u);
        draw();
      }, at));
    }
  }

  function paintFocus() {
    patchNames();
    const a = document.activeElement;
    const q = a && a.closest && a.closest("#hmMetals, #hmLeaders") &&
      (a.dataset.ticker ? '[data-ticker="' + a.dataset.ticker + '"]' : a.closest("#ccLeadSeg") && "[aria-selected=true]");
    const f = FOCUS.focus;
    const groups = ans(f) && Array.isArray(f.groups)
      ? f.groups.filter((g) => g && Array.isArray(g.tickers) && g.tickers.length) : [];
    paintMetals(groups.filter((g) => g.kind === "metal"));
    paintLeaders(groups.filter((g) => g.kind !== "metal"));
    const back = q && document.querySelector("#hmMetals " + q + ", #hmLeaders " + q);
    if (back) back.focus();
  }

  function assessAge(payload) {
    if (typeof UI.staleness !== "function") {
      return {
        kind: "unavailable",
        message: "The freshness check could not run: this page's shared UI module " +
          "(flows-ui.js) is too old to carry it, so nothing here is confirmed to be " +
          "today's. The session named above is the payload's own claim about itself.",
      };
    }
    return UI.staleness(payload, Date.now(), { subject: "This session" });
  }

  function setStale(messages) {
    const text = messages.filter(Boolean).join(" ");
    if (staleEl) {
      staleEl.hidden = !text;
      staleEl.textContent = text;
    }
    document.body.classList.toggle("is-stale", Boolean(text));
    const slot = $("hmStale");
    if (slot) {
      slot.replaceChildren();
      if (text) {
        slot.append(h("button", {
          class: "hm-pill", type: "button", "data-state": "stale", ...POP,
          "data-info": disclose("Freshness", text, { state: "stale" }),
        }, glyph("clock"), h("span", null, "Stale")));
      }
    }
  }

  function setRailCount(side, n) {
    const slot = document.querySelector('[data-rail-count="' + side + '"]');
    if (!slot || n === null) return;
    slot.textContent = String(n);
    slot.hidden = false;
  }

  function stampUpdated(response, body) {
    const at = isNum(response.headers.get("X-Payload-Updated"));
    if (body && typeof body === "object") {
      body.__updatedAt = at !== null && at > 0 ? at : null;
      body.__ff = typeof UI.freshFrom === "function" ? UI.freshFrom(response) : null;
      if (body.__ff && !body.__ff.overlay) UI.freshness({ ff: body.__ff, source: response.url.replace(/^.*flows\//, "") });
    }
    return body;
  }

  let gated = false;
  const OPTS = () => ({ credentials: "same-origin", deadlineMs: 15000, headers: { Accept: "application/json" } });
  const LK = "/api/flows/lk?k=";

  const read = (r) => r.json().then((body) => stampUpdated(r, body));

  function loadBoard(side) {
    return fetch("/api/flows/board?side=" + side, OPTS()).then((r) => {
      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      return r.ok ? read(r) : null;
    }).catch(() => null);
  }

  function loadRegion(path, soon) {
    return fetch(path, OPTS())
      .then((r) => (r.ok ? read(r) : soon && r.status === 404 ? { status: "pending", __route: 404 } : null))
      .catch(() => null);
  }

  function loadLive(keys) {
    if (keys.length === 1) return loadRegion(LK + keys[0], true).then((b) => ({ [keys[0]]: b }));
    return fetch(LK + keys.join(","), OPTS()).then((r) => (r.ok ? r.json() : r.status === 404 ? { status: "pending" } : null))
      .catch(() => null)
      .then((env) => Object.fromEntries(keys.map((k) => [k, env && env.keys ? UI.liveBody ? UI.liveBody(env, k) : null : env])));
  }

  function neuronComputed(market) {
    const box = $("hmVerdict"), t = $("hmVerdictT");
    if (!box || !t || !box.classList.contains("is-pending")) return;
    const pt = isNum(market && market.premium && market.premium.tilt);
    const b = (market && market.breadth) || {};
    const up = isNum(b.bull), dn = isNum(b.bear);
    const names = up === null || dn === null ? null
      : dn > up ? dn + " names net sold against " + up + " bought" : up + " names net bought against " + dn + " sold";
    const line = pt !== null ? (pt > 0.02 ? "Bullish" : pt < -0.02 ? "Bearish" : "Balanced") + " premium: flow bias " + pct(pt, 1) +
      (names ? ", " + names : "") + "." : names ? cap1(names) + "." : null;
    if (!line) return;
    t.textContent = line;
    box.classList.replace("is-pending", "is-computed");
    box.dataset.nn = "plain";
    const orb = box.querySelector(".hm-verdict-g");
    if (orb) {
      const calc = h("span", { class: "hm-verdict-g nn-calc is-44", "aria-hidden": "true" }, glyph("calc"));
      orb.replaceWith(calc);
    }
    const by = box.querySelector(".hm-verdict-by");
    if (by) { by.classList.remove("nn-word"); by.textContent = "Computed"; }
    const mk = box.querySelector(".hm-verdict-meta .hm-mark");
    if (mk) {
      mk.replaceWith(h("button", {
        class: "ui-state hm-mark", type: "button", "data-state": "quiet", "aria-label": "Computed: no written summary yet",
        ...POP, "data-info": disclose("Neuron", "No written summary yet; this line is computed from the flow bias and breadth above."),
      }, glyph("quiet")));
    }
  }

  function neuronWire(lng, sht) {
    if (document.querySelector("#hmVerdict .nn-orb")) window.FlowsUI.defer("nn-orb", { when: "idle" }).then(() => { if (window.FlowsUI.nnOrb) window.FlowsUI.nnOrb.scan(); });
    const more = $("hmNeuronMore"), x = $("hmNeuronX");
    if (more && x) {
      more.addEventListener("click", () => openSheet($("hmVerdict"), (open) => {
        more.setAttribute("aria-expanded", String(open));
        x.hidden = !open;
      }));
    }
    const wrote = document.querySelector(".hm-verdict time");
    if (wrote && Number.isFinite(Date.parse(wrote.dateTime))) wrote.textContent = F.trtDay(wrote.dateTime) ? F.day(F.trtDay(wrote.dateTime)) + " " + F.time(wrote.dateTime) : wrote.textContent;
    const built = Date.parse((lng && lng.generatedAt) || (sht && sht.generatedAt) || "");
    if (wrote && Number.isFinite(built) && Date.parse(wrote.dateTime) < built) {
      const box = wrote.closest(".hm-verdict");
      box.classList.add("is-old");
      const note = " Written before the boards were rebuilt at " + fmtStamp(new Date(built).toISOString()) +
        ", so it reads an earlier publication.";
      const src = box.querySelector(".hm-verdict-src");
      if (src) src.append(note);
      const meta = box.querySelector(".hm-verdict-meta");
      if (meta) {
        meta.append(h("button", {
          class: "ui-state hm-mark", type: "button", "data-state": "stale", title: "Stale", "aria-label": "Stale: Neuron",
          ...POP, "data-info": disclose("Neuron", note.trim(), { state: "stale" }),
        }, glyph("clock")));
      }
    }
  }

  const askBtn = document.querySelector(".hm-ask");
  if (askBtn) {
    askBtn.addEventListener("click", () => {
      const tab = $("askDockTab"), phone = $("fxTabAsk");
      const via = tab && tab.getClientRects().length ? tab : phone && phone.getClientRects().length ? phone : tab || phone;
      if (via) via.click();
    });
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawStrips, 150);
  });

  function live(liveVol) {
    stream();
    if (typeof UI.heartbeat !== "function") return;
    UI.heartbeat({
      keys: ["market", "breadth", "strips", "focus", "news"], nightly: ["pulse", "focus"], page: "overview",
      onBeat() { if (heroTide && heroTide.live) paintPill(heroTide); for (const k in FOCUS.pills) whenPill(k, ...FOCUS.pills[k]); },
      onChange(changed) {
        if (!Array.isArray(changed)) return;
        const has = (re) => changed.some((k) => re.test(String(k)));
        const st = has(/strips/), fo = has(/^focus/), lf = has(/:focus/), mk = has(/market/), br = has(/breadth/), pu = has(/pulse/), nw = has(/news/);
        const keys = [mk && "market", br && "breadth", st && "strips", st && "strips:series", lf && "focus"].filter(Boolean);
        Promise.all([fo && loadRegion("/api/flows/focus"), pu && loadRegion("/api/flows/pulse"), keys.length && loadLive(keys), nw && loadRegion("/api/flows/news")]).then(([f, p, lk, n]) => {
          const l = lk || {};
          if (n) { R.news = mergeNews(n); paintNewsLater(); }
          if (f) FOCUS.focus = f;
          if (l.strips && !(UI.rt && UI.rt.feeds("px"))) { FOCUS.strips = l.strips; FOCUS.streamed = false; }
          if (l["strips:series"]) FOCUS.series = l["strips:series"];
          if (l.focus) FOCUS.live = l.focus;
          if (st || fo || lf) paintFocus();
          if (l.market) S.liveMkt = UI.rt && UI.rt.feeds("mk") ? UI.rt.market(l.market) : l.market;
          if (l.breadth) { S.liveBreadth = l.breadth; paintVolLater(S.regime, liveVol, l.breadth); }
          if (p) S.pulse = p;
          if (l.market || l.breadth || p) hero();
        });
      },
    });
  }

  const R = {};
  const P = { lng: loadBoard("long"), sht: loadBoard("short"), lk: loadLive(["market", "vol", "breadth", "strips", "strips:series", "focus"]) };
  for (const [k, path, soon] of [["watch", "board?side=watch"], ["market", "market"], ["alerts", "flowalerts"], ["events", "events"], ["track", "scoretrack"],
    ["ivd", "universe?cols=t,sec,chg,iv30p,ed", true],
    ["lean", "sector-premium"], ["news", "news"], ["pulse", "pulse"], ["regime", "regime", true], ["focus", "focus"]]) P[k] = loadRegion("/api/flows/" + path, soon);
  for (const k in P) P[k] = P[k].then((v) => (R[k] = v));

  const fail = (error) => {
    statusEl.textContent = "The session could not be loaded. Refresh to try again." + (error && error.message ? " (" + error.message + ")" : "");
  };
  const when = (keys, fn) => Promise.all(["lng", "sht", ...keys].map((k) => P[k])).then(() => { if (!gated) fn(R); }).catch(fail);

  const below = { fns: null, ask: new Map() };
  const later = (key, run) => {
    if (below.fns) run(below.fns);
    else below.ask.set(key, run);
  };
  const paintNewsLater = () => later("news", (b) => fill("ccNews", b.paintNews, R.news, index(R).cards, Date.now()));
  const paintVolLater = (regime, liveVol, liveBreadth) => later("vol", (b) => b.paintVol(regime, liveVol, liveBreadth));
  const homeKit = Object.freeze({
    $, ans, arr, rowsOf, cap1, capSaid, countSaid, sessionsSaid, disclose, POP, silent, hush, headMark, infoInto, table, big, gone, usd,
    earningsMark, nameNode, readerHref, toneOf, CROSS_SAID, CROSS_WORDS, NO_CARD_SAID, SHOW, LIST_MAX,
    get attached() { return below.fns !== null; },
    attach(fns) {
      if (below.fns) return;
      below.fns = fns;
      for (const run of below.ask.values()) {
        try { run(fns); } catch (error) { fail(error); }
      }
      below.ask.clear();
    },
  });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { homeKit }));
  for (const [id, what] of [["ccVol", "volatility"], ["ccEvents", "reporting soon"], ["ccNews", "headlines"]]) {
    const el = $(id);
    if (el && !el.firstChild && hush(el, "pending", "This module loads with What changed, a moment after the page.", what, 56)) el.firstChild.setAttribute("data-loading", "");
  }
  big("hmEvents", null, "", null, ["pending", "This module loads with What changed, a moment after the page.", "reporting soon", "loading"]);
  const FIT_MIN = 2;
  const sheet = h("dialog", { class: "hm-sheet" });
  document.body.append(sheet);
  let held = null;
  const fitBody = (mod) => mod.querySelector(":scope > .hm-body") || mod.querySelector(":scope > div:not(.ui-mod-h)");
  function openSheet(mod, expand) {
    if (held || typeof sheet.showModal !== "function") return;
    const ph = h("div", { class: "hm-ph", "aria-hidden": "true" });
    ph.style.gridArea = getComputedStyle(mod).gridArea;
    ph.dataset.page = mod.dataset.page || "";
    mod.before(ph);
    held = { mod, ph, expand, glance: mod.classList.contains("is-glance") };
    mod.setAttribute("data-sheet", "");
    mod.removeAttribute("data-row");
    mod.removeAttribute("data-strip");
    mod.classList.remove("is-glance");
    const inside = fitBody(mod);
    if (inside) inside.inert = false;
    if (expand) expand(true);
    const close = h("button", { type: "button", class: "hm-sheet-x", onclick: () => sheet.close() }, "Close");
    const t = mod.querySelector("h2");
    if (t && t.id) sheet.setAttribute("aria-labelledby", t.id);
    sheet.replaceChildren(close, mod);
    sheet.showModal();
    scheduleFit(mod);
    netDecide();
  }
  sheet.addEventListener("close", () => {
    if (!held) return;
    const { mod, ph, expand, glance } = held;
    held = null;
    mod.removeAttribute("data-sheet");
    if (glance) mod.classList.add("is-glance");
    glanceAria(mod);
    if (expand) expand(false);
    ph.replaceWith(mod);
    scheduleFit(mod);
    netDecide();
  });
  function fit(mod) {
    const body = fitBody(mod);
    if (!body || mod.classList.contains("fn-card") || !mod.getBoundingClientRect().height) return;
    const flat = fitOf() === "flat" || mod.hasAttribute("data-sheet") || mod.classList.contains("is-glance");
    mod.toggleAttribute("data-strip", !flat && mod.clientHeight < 96);
    mod.toggleAttribute("data-row", !flat && mod.clientHeight < 64);
    const floor = mod.hasAttribute("data-strip") ? 1 : FIT_MIN;
    const lists = [...body.querySelectorAll(".ui-list, .hm-qlist, .hm-metals, ul, ol, tbody, [role=list]")].filter((l) => l.children.length > floor && !l.closest("[hidden], [data-nofit]"));
    for (const l of lists) for (const c of l.children) { if (c.hasAttribute("data-fit")) { c.hidden = false; c.removeAttribute("data-fit"); } else if (c.hidden && !c.classList.contains("ui-disclose") && c.tagName !== "BUTTON") { c.hidden = false; c.setAttribute("data-fit", "1"); } }
    mod.removeAttribute("data-tight");
    const head = mod.querySelector(":scope > .ui-mod-h");
    let btn = head && head.querySelector(":scope > .hm-all");
    if (mod.hasAttribute("data-sheet") || mod.classList.contains("is-glance")) { if (btn) btn.hidden = true; return; }
    let hid = 0;
    const over = () => body.scrollHeight - body.clientHeight;
    let guard = 80;
    while (over() > 1 && guard-- > 0) {
      let best = null, bestN = floor;
      for (const l of lists) { const n = [...l.children].filter((c) => !c.hidden && c.tagName !== "BUTTON").length; if (n > bestN) { best = l; bestN = n; } }
      if (!best) break;
      const vis = [...best.children].filter((c) => !c.hidden && c.tagName !== "BUTTON");
      const last = vis[vis.length - 1];
      last.hidden = true;
      last.setAttribute("data-fit", "1");
      hid++;
    }
    if (over() > 1) mod.setAttribute("data-tight", "");
    const cut = [...body.querySelectorAll("[data-more]")].some((e) => e.firstChild && getComputedStyle(e).display === "none");
    if (hid || cut) {
      if (!btn) {
        btn = h("button", { type: "button", class: "hm-all", "aria-haspopup": "dialog" });
        btn.addEventListener("click", () => openSheet(mod));
        if (head) head.append(btn);
      }
      btn.textContent = "Show all";
      btn.setAttribute("aria-label", "Show all");
      btn.hidden = false;
    } else if (btn) btn.hidden = true;
  }
  const FITTING = new Map();
  function scheduleFit(mod) {
    if (FITTING.get(mod)) return;
    FITTING.set(mod, requestAnimationFrame(() => { FITTING.set(mod, 0); try { fit(mod); } catch (error) { void error; } }));
  }
  const tiles = () => [...stage.querySelectorAll(":scope > .hm-mod")];
  for (const mod of tiles()) {
    const body = fitBody(mod);
    if (!body) continue;
    new MutationObserver(() => scheduleFit(mod)).observe(body, { childList: true, subtree: true });
    if (typeof ResizeObserver === "function") { const ro = new ResizeObserver(() => scheduleFit(mod)); ro.observe(body); ro.observe(mod); }
    const title = mod.querySelector(".ui-mod-t");
    const open = h("button", { type: "button", class: "hm-open", "aria-label": "Open " + (title ? title.textContent : "this module"), "aria-haspopup": "dialog" });
    open.addEventListener("click", () => openSheet(mod));
    mod.append(open);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const mod of tiles()) scheduleFit(mod); });

  const heroOpen = h("button", { type: "button", class: "hm-open hm-hero-open", "aria-haspopup": "dialog", "aria-label": "Open Market tide" }, "Open");
  heroOpen.addEventListener("click", () => openSheet($("hmHero")));
  $("hmHero").append(heroOpen);

  const tidePlot = $("hmTide");
  if (tidePlot && typeof ResizeObserver === "function") {
    let drawn = 0;
    new ResizeObserver(() => {
      if (!tideChart || !tideOpts) return;
      const hgt = tideHeight(tidePlot);
      if (typeof hgt !== "number" || Math.abs(hgt - drawn) < 8) return;
      drawn = hgt;
      tideOpts = Object.assign({}, tideOpts, { height: hgt });
      tideChart.set(tideOpts);
    }).observe(tidePlot);
  }

  const PAGES = ["now", "flow", "names", "glance"];
  const PAGE_WORD = { now: "Now", flow: "Flow", names: "Names", glance: "Glance" };
  const VIEW_PAGE = { session: "now", flow: "flow", names: "names", focus: "glance", moves: "glance", calendar: "glance" };
  const VIEW_FIRST = { session: "hmHero", flow: "hmNet", names: "hmBull", focus: "hmLeaders", moves: "hmChg", calendar: "hmEvents" };
  let fitNow = "", page = "now", lowerAsked = false;
  const askLower = () => {
    if (lowerAsked || !UI.defer) return;
    lowerAsked = true;
    UI.defer("home-below", { when: "visible", el: $("hmChg"), label: "The lower modules" });
  };
  function setPage(p, focus, quiet) {
    page = PAGES.includes(p) ? p : "now";
    stage.dataset.page = page;
    for (const b of pager.querySelectorAll("button")) {
      const on = b.dataset.page === page;
      b.toggleAttribute("aria-current", on);
      if (on) b.setAttribute("aria-current", "true");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    for (const m of stage.children) m.inert = fitNow === "s" && m.dataset.page !== page;
    if (fitNow === "s" && page === "glance") askLower();
    if (!quiet) { try { history.replaceState(null, "", "#page=" + page); } catch (error) { void error; } }
  }
  const turn = (p, focus) => {
    setPage(p, focus);
    statusEl.textContent = "Page " + (PAGES.indexOf(page) + 1) + " of " + PAGES.length + ": " + PAGE_WORD[page] + ".";
  };
  pager.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-page]"); if (b) turn(b.dataset.page, false); });
  pager.addEventListener("keydown", (ev) => {
    const i = PAGES.indexOf(page);
    const to = ev.key === "Home" ? 0 : ev.key === "End" ? PAGES.length - 1 : ev.key === "ArrowRight" ? i + 1 : ev.key === "ArrowLeft" ? i - 1 : null;
    if (to === null) return;
    ev.preventDefault();
    turn(PAGES[(to + PAGES.length) % PAGES.length], true);
  });
  let swipe = null;
  stage.addEventListener("pointerdown", (ev) => { swipe = fitNow === "s" && !ev.target.closest("canvas, input, button, a") ? { id: ev.pointerId, x: ev.clientX, y: ev.clientY } : null; });
  stage.addEventListener("pointerup", (ev) => {
    if (!swipe || swipe.id !== ev.pointerId) return;
    const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > 2 * Math.abs(dy)) turn(PAGES[Math.max(0, Math.min(PAGES.length - 1, PAGES.indexOf(page) + (dx < 0 ? 1 : -1)))], false);
  });
  const hashOf = () => {
    const p = /page=([a-z]+)/.exec(location.hash), v = /view=([a-z]+)/.exec(location.hash);
    return p ? ["page", p[1]] : v ? ["view", v[1]] : null;
  };
  function fromHash() {
    const x = hashOf();
    const p = !x ? "now" : x[0] === "page" ? x[1] : VIEW_PAGE[x[1]];
    setPage(PAGES.includes(p) ? p : "now", false, true);
    const first = x && x[0] === "view" && fitNow !== "s" ? $(VIEW_FIRST[x[1]]) : null;
    const t = first && first.querySelector("h2");
    if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); }
  }
  function glanceAria(m) {
    const open = m.querySelector(":scope > .hm-open"), body = fitBody(m), numeral = $(m.id + "N");
    const on = m.classList.contains("is-glance");
    if (open) {
      const ids = [numeral && numeral.id, body && body.id].filter(Boolean);
      if (on && ids.length) open.setAttribute("aria-describedby", ids.join(" ")); else open.removeAttribute("aria-describedby");
    }
    if (body && !m.hasAttribute("data-sheet")) body.inert = on;
  }
  const fitGlance = (m) => (fitNow === "s" ? m.dataset.page === "glance" && m.classList.contains("hm-mod") : fitNow === "m" && m.id === "hmNet");
  function applyFit() {
    const f = fitOf();
    if (f === fitNow) return;
    fitNow = f;
    stage.dataset.fit = f;
    pager.hidden = f !== "s";
    for (const m of stage.children) m.classList.toggle("is-glance", fitGlance(m));
    for (const m of tiles()) glanceAria(m);
    if (f === "s") setPage(page, false, true);
    else { for (const m of stage.children) m.inert = false; askLower(); }
    for (const m of tiles()) scheduleFit(m);
    drawStrips();
    netApply();
  }
  if (typeof ResizeObserver === "function") {
    let rz = 0;
    new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(applyFit, 120); }).observe(hm);
  }
  document.addEventListener("transitionend", (ev) => { if (ev.target.classList && ev.target.classList.contains("ak-dock-panel")) netDecide(); }, true);

  const netHost = $("hmNetHost");
  let netNow = null, netIn, netMode = null, netTimer = 0, netTok = 0;
  const NET_3D = { w: 640, h: 340 }, NETMAP_MIN = { w: 260, h: 180 }, NET_CHROME = 44;
  const netSend = () => {
    if (!netNow || netIn === undefined) return;
    const rows = netIn && Array.isArray(netIn.rows) ? netIn.rows : null;
    netNow.take(rows ? netIn : null, rows ? { state: rows.length ? "ok" : "quiet", reason: "Nothing flagged in this read." }
      : { state: netIn ? "pending" : "unavailable", reason: netIn ? "The flagged windows are not published yet." : "The flagged windows could not be read." });
    netHost.classList.toggle("is-slot", netMode === "3d" && !!rows && rows.length > 0);
    netHost.classList.toggle("is-quiet", netMode === "3d" && (!rows || !rows.length));
  };
  const netSectors = (api) => {
    fetch("/api/flows/universe", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null)).catch(() => null)
      .then((u) => { if (api && typeof api.sectors === "function") api.sectors(u); });
  };
  const netCard = $("hmNet");
  const netWant = () => {
    if (!netHost) return null;
    const sheeted = Boolean(netHost.closest("[data-sheet]")), flat = fitOf() === "flat";
    if (!sheeted && fitGlance(netCard)) return "glance";
    const w = sheeted || flat ? netHost.clientWidth : netCard.clientWidth;
    const hh = sheeted || flat ? netHost.clientHeight : netCard.clientHeight - NET_CHROME;
    if (w >= NET_3D.w && (flat || hh >= NET_3D.h)) return "3d";
    if (w >= NETMAP_MIN.w && (flat || hh >= NETMAP_MIN.h)) return "map";
    return "glance";
  };
  const netLoad = (mode) => UI.defer("home-net", { when: "visible", el: netHost, label: "The flow network" })
    .then(() => (mode === "map" ? UI.defer("home-netmap", { when: "idle", el: netHost, label: "The flow network" }) : null));
  function netApply() {
    if (!netHost || !UI.defer) return;
    const want = netWant();
    if (!netHost.closest("[data-sheet]")) netCard.classList.toggle("is-glance", fitGlance(netCard) || want === "glance");
    if (want === netMode) return;
    const tok = ++netTok;
    if (want === "glance") {
      if (netNow) { netNow.destroy(); netNow = null; }
      netHost.classList.remove("is-slot", "is-quiet");
      netMode = want;
      return;
    }
    netLoad(want).then(() => {
      const api = window.FlowsUI;
      if (tok !== netTok || !api || !api.net) return;
      if (netNow) { netNow.destroy(); netNow = null; }
      netHost.classList.remove("is-slot", "is-quiet");
      netMode = want;
      if (want === "3d") netNow = api.net.mount(netHost, netHost.dataset.ambient === "1" ? { ambient: true, fit: true } : { fit: true });
      else if (api.netMap) { netNow = api.netMap.mount(netHost, {}); netSectors(netNow); }
      netSend();
    });
  }
  function netDecide() {
    if (!netHost) return;
    clearTimeout(netTimer);
    netTimer = setTimeout(netApply, 300);
  }
  when(["alerts"], ({ alerts }) => { netIn = alerts; netSend(); });

  applyFit();
  fromHash();
  addEventListener("hashchange", fromHash);
  addEventListener("load", applyFit);


  const fill = (id, paint, ...args) => {
    const el = $(id);
    if (el) { el.replaceChildren(); paint(el, ...args); }
  };
  const subSaid = (el, text, label) => {
    if (!el) return;
    el.textContent = text;
    if (label) el.setAttribute("aria-label", label);
    else el.removeAttribute("aria-label");
  };

  function index({ lng, sht, events }) {
    const bull = ranked(lng && lng.rows), bear = ranked(sht && sht.rows);
    const evBy = new Map();
    if (ans(events) && Array.isArray(events.rows)) {
      for (const row of events.rows) if (row && row.t) evBy.set(String(row.t), row);
    }
    const boardBy = new Map(), cards = new Set();
    for (const [payload, rows] of [[lng, bull], [sht, bear]]) {
      const knows = isNum(payload && payload.deep) !== null;
      for (const row of rows) {
        if (!row || !row.t) continue;
        const t = String(row.t);
        boardBy.set(t, row);
        if (!knows || row.dp === 1) cards.add(t);
      }
    }
    const meta = ans(lng) || ans(sht) || lng || sht || {};
    return { bull, bear, evBy, boardBy, cards, meta };
  }

  function lists() {
    const { lng, sht } = R;
    const { bull, bear } = index(R);
    for (const [id, subId, payload, rows, label, all, route] of [
      ["ccBull", "ccBullSub", lng, bull, "Bullish candidates, ranked", "bullish", "long"],
      ["ccBear", "ccBearSub", sht, bear, "Bearish candidates, ranked", "bearish", "short"],
    ]) {
      const into = $(id);
      const sub = $(subId);
      if (!into) continue;
      into.replaceChildren();
      const mod = "hm" + id.slice(2), tone = id === "ccBull" ? "up" : "down", said = "names cleared " + all;
      if (silent(into, payload, all + " board", 240)) {
        big(mod, null, said, tone, gone(payload, all + " board"));
        if (sub) { sub.textContent = ""; sub.hidden = true; }
        continue;
      }
      if (!rows.length) {
        hush(into, "empty", "No name leaned " + all + " past the band this session.", all + " board", 240);
        big(mod, "0", said, "silent");
        if (sub) { sub.textContent = "0"; sub.setAttribute("aria-label", "0 ranked"); sub.hidden = false; }
        continue;
      }
      big(mod, String(poolCount(payload) ?? rows.length), said, tone);
      sideList(into, rows, isNum(payload && payload.deep) !== null, label);
      infoInto("hm" + id.slice(2), all + " leaders", () => ({
        title: cap1(all), lead: "Names past the dead band on the " + all + " board, in the board's published rank order.",
        facts: [["Pool", String(poolCount(payload) ?? rows.length)], ["Drawn", String(Math.min(rows.length, ROW_MAX))], ["Strip", readTrack(ans(R.track)).label]],
        notes: ["Scores are a ranked attention signal on a fixed −100 to +100 scale, not a return forecast. Names inside the dead band are not published on either side.",
          "Each strip draws the name's score by archived session on one scale shared by both sides, against an always-drawn zero rule.",
          "The percentage is the session's price return: close over the prior close. It is not the score move.",
          NO_CARD_SAID],
      }));
      if (sub) {
        const pool = poolCount(payload) ?? rows.length;
        const shown = Math.min(rows.length, ROW_MAX);
        const said = shown < pool ? "top " + shown + " of " + pool : "all " + pool;
        sub.textContent = String(pool);
        sub.setAttribute("aria-label", said + " — open the " + route + " board");
        sub.dataset.said = said;
        sub.hidden = false;
      }
    }
    drawStrips();
  }

  P.b = when([], ({ lng, sht }) => {
    const { meta } = index(R);
    if (typeof meta.sessionDate === "string") {
      UI.freshness({ sessionDate: meta.sessionDate, generatedAt: meta.generatedAt, updatedAt: meta.__updatedAt, source: "boards" });
    }
    lists();

    neuronWire(lng, sht);

    const scored = isNum(meta.scored), neutral = isNum(meta.neutral);
    const sideSaid = (word, rows, pool) => word + " " + (rows === null ? DASH : pool !== null && pool > rows ? rows + " of " + pool : rows);
    const parts = [sideSaid("Bullish", rowCount(lng), poolCount(lng)), sideSaid("Bearish", rowCount(sht), poolCount(sht))];
    if (scored !== null && neutral) parts.push("Band " + neutral + " of " + scored);
    const unread = [lng ? null : "bullish", sht ? null : "bearish"].filter(Boolean);
    statusEl.textContent = parts.join(" · ") + "." + (unread.length
      ? " The " + unread.join(" and ") + " board" + (unread.length > 1 ? "s" : "") + " could not be read. Refresh to try again." : "");

    setRailCount("long", poolCount(lng));
    setRailCount("short", poolCount(sht));

    paintMeta($("ccMetaDate"), null, [lng, sht]);
    const notes = [];
    const ld = lng && lng.sessionDate, sd = sht && sht.sessionDate;
    if (ld && sd && ld !== sd) {
      notes.push("These two halves are from different sessions — bullish " +
        ld + ", bearish " + sd + ". Treat the comparison with care.");
    }
    const seenMsg = new Set();
    for (const one of [lng, sht]) {
      const verdict = one ? assessAge(one) : null;
      const message = (verdict && verdict.message) || null;
      if (message && !seenMsg.has(message)) { seenMsg.add(message); notes.push(message); }
    }
    setStale(notes);
  });

  when(["ivd"], ({ ivd }) => {
    ivdIndex(ivd);
    if (FOCUS.focus && FOCUS.lk) paintFocus();
  });
  when(["focus", "lk"], ({ focus, lk }) => {
    Object.assign(FOCUS, { focus, lk: true, strips: lk.strips, series: lk["strips:series"], live: lk.focus });
    requestAnimationFrame(() => setTimeout(paintFocus));
  });

  when(["market"], ({ lng, sht, market }) => {
    paintMeta(null, $("ccMetaScreened"), [lng, sht], market);
    neuronComputed(ans(market));
  });
  when(["market", "alerts", "pulse"], ({ lng, sht, market, alerts, pulse }) => paintVerdict(verdictHost, lng, sht, market, alerts, pulse));
  when(["pulse", "regime", "lk"], ({ lng, sht, pulse, regime, lk }) => {
    Object.assign(S, { pulse, regime, liveMkt: lk.market, liveBreadth: lk.breadth, boardsDay: boardsRead(lng, sht).date });
    hero();
    paintVolLater(regime, lk.vol, lk.breadth);
  });

  when(["track", "events"], ({ track }) => later("chg", (b) => {
    const { cards, evBy, boardBy } = index(R);
    fill("ccChgNote", b.paintChanged, track, cards, evBy, boardBy);
  }));
  when(["b", "track"], ({ track }) => {
    const trk = readTrack(ans(track));
    for (const d of drawn) trackInto(d, trk);
    drawStrips();
    const { bull, bear, meta } = index(R);
    meta.__bull = bull;
    meta.__bear = bear;
    meta.__moves = new Map(Object.entries(trk.moveBy));
    later("spine", (b) => b.renderSpine(meta));
  });

  when(["alerts"], ({ alerts }) => {
    fill("ccAlerts", paintAlerts, alerts);
    const rows = ans(alerts) && Array.isArray(alerts.rows) ? alerts.rows : null;
    const seen = rows && isNum(alerts.seen);
    const shown = rows && Math.min(rows.length, LIST_MAX);
    const of = seen === null ? rows && rows.length : seen;
    const floor = rows && (alerts.vendorTruncated === true || alerts.readTruncated === true);
    const off = rows ? null : gone(alerts, "flagged windows") || ["unavailable", "The flagged windows were read and carry no rows, so no figure is shown.", "flagged windows", "not on this payload"];
    big("hmAlerts", rows ? (floor ? "≥" : "") + of : null, "windows flagged this session", "ice", off);
    const premSum = rows ? rows.reduce((a, r) => a + (isNum(r && r.prem) ?? 0), 0) : null;
    big("hmNet", rows && rows.length ? (floor ? "≥" : "") + usd(premSum) : null, floor ? "premium in carried windows" : "flagged premium routed", "ice",
      rows && !rows.length ? ["quiet", "Nothing was flagged in this read, so no premium was routed.", "flagged premium", "nothing flagged"] : off);
    subSaid($("ccAlertsSub"), rows ? floor ? shown + " of ≥" + of : countSaid(shown, of) : "",
      rows && (floor ? shown + " of at least " + of : capSaid(shown, of)) + " flagged windows — open the unusual flow page");
  });

  when(["b", "events"], ({ events }) => {
    const { evBy } = index(R);
    for (const { t, row, name } of drawn) name.append(earningsMark(row, evBy.get(t)) || "");
    later("events", (b) => fill("ccEvents", b.paintEvents, events));
    const rows = ans(events) && Array.isArray(events.rows) ? events.rows : null;
    const inWindow = isNum(events && events.inWindow);
    const shown = rows && Math.min(rows.length, LIST_MAX);
    const of = rows && (inWindow === null ? rows.length : inWindow);
    subSaid($("ccEventsSub"), rows ? countSaid(shown, of) : "", rows && capSaid(shown, of) + " in the window — open the events page");
    setRailCount("events", ans(events) ? inWindow : null);
  });

  when(["lean"], ({ lean }) => fill("ccLean", paintLean, lean, $("ccLeanSeg")));
  when(["news"], paintNewsLater);

  when(["watch"], ({ watch }) => {
    fill("ccWatch", paintWatch, watch);
    const n = rowCount(watch), k = Math.min(n, LIST_MAX);
    big("hmWatch", n === null || (n === 0 && !(watch.status === "thin" || isNum(watch.neutral) === 0)) ? null : String(n), "one step from clearing", "ice",
      n === null ? gone(watch, "watch board") || ["unavailable", "The watch board was read and carries no rows list.", "watch board", "not on this payload"]
        : n === 0 && !(watch.status === "thin" || isNum(watch.neutral) === 0) ? ["unavailable", "The watch board published no rows, which is a gap in the payload and not a count of zero.", "watch board", "no rows published"] : null);
    subSaid($("ccWatchSub"), n === null ? "" : countSaid(k, n), n !== null && capSaid(k, n) + " inside the dead band — open the watch board");
    setRailCount("watch", n);
  });

  when(Object.keys(P), ({ lk }) => live(lk.vol));
})();
