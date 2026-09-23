(() => {
  "use strict";

  const statusEl = document.getElementById("mktStatus");
  const UI = window.FlowsUI;
  if (!UI) {
    if (statusEl) statusEl.textContent = "The shared UI library did not load, so this page cannot draw. Refresh to try again.";
    return;
  }
  const { h, F, isNum, DASH, MINUS, fmtSigned, fmtStamp, glyph } = UI;
  const C = UI.chart;
  const $ = (id) => document.getElementById(id);

  const signGlyph = (n) => (n < 0 ? MINUS : n > 0 ? "+" : "");
  const signed = (v, dp) => {
    const n = isNum(v);
    return n === null ? DASH : signGlyph(n) + Math.abs(n).toFixed(dp === undefined ? 2 : dp);
  };
  const pct = (v, dp) => {
    const n = isNum(v);
    return n === null ? DASH : (n * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  };
  const usd = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const sign = n < 0 ? MINUS : "";
    const a = Math.abs(n);
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(0) + "K";
    return sign + "$" + a.toFixed(0);
  };
  const usdS = (v) => { const n = isNum(v); return n !== null && n > 0 ? "+" + usd(n) : usd(n); };
  const toneOf = (v) => { const n = isNum(v); return n === null ? null : n > 0 ? "up" : n < 0 ? "down" : "flat"; };
  const barClass = (n) => (n < 0 ? "is-neg" : n > 0 ? "is-pos" : "is-flat");
  const count = (v) => { const n = isNum(v); return n === null ? DASH : String(n); };
  const grouped = (v) => { const n = isNum(v); return n === null ? DASH : Math.round(n).toLocaleString("en-US"); };
  const signedGrouped = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const r = Math.round(n);
    return signGlyph(r) + Math.abs(r).toLocaleString("en-US");
  };
  const cap1 = (t) => (typeof t === "string" && t ? t[0].toUpperCase() + t.slice(1) : t);

  const KIND = {
    pending: ["pending", "Pending"],
    quiet: ["quiet", "Quiet"],
    unavailable: ["unavailable", "Unavailable"],
    unreadable: ["stop", "Unreadable"],
  };
  const disclose = (title, lead, more) => UI.info(() => Object.assign({ title, lead }, more || {}));

  function emptyLine(kind, text, what, height) {
    const [g, word] = KIND[kind] || KIND.unavailable;
    return h("div", {
      class: "ui-silent mk-hush" + (height && height <= 72 ? " is-row" : ""), "data-empty": kind, "data-state": kind, role: "note",
      "aria-label": word + ": " + (what || text), style: { "--silent-h": (height || 96) + "px" },
    }, glyph(g), h("div", { class: "ui-silent-t" }, word),
    h("button", { type: "button", "aria-haspopup": "dialog", "aria-controls": "fxPop", "data-info": disclose(cap1(what || word), text) }, "Why"));
  }

  function inlineHush(kind, text, label) {
    const [g, word] = KIND[kind] || KIND.unavailable;
    return h("button", {
      class: "ui-state mk-mark", type: "button", "data-empty": kind, "data-state": kind, title: word,
      "aria-label": word + ": " + label, "aria-haspopup": "dialog", "aria-controls": "fxPop",
      "data-info": disclose(cap1(label), text),
    }, glyph(g));
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
    for (const old of t.querySelectorAll(".mk-mark")) old.remove();
    if (node) t.append(node);
  }

  function staleMark(sectionId, session, what) {
    const expected = UI.freshness.market().expected;
    if (!session || session >= expected) return headMark(sectionId, null);
    headMark(sectionId, h("button", {
      class: "ui-state mk-mark", type: "button", "data-state": "stale", title: "Stale", "aria-label": "Stale: " + what,
      "aria-haspopup": "dialog", "aria-controls": "fxPop",
      "data-info": disclose(cap1(what), "These readings are the " + F.day(session) + " session; the last completed session is " + F.day(expected) + ".", { state: "stale" }),
    }, glyph("clock")));
  }

  function table(label, heads, rows) {
    return h("div", { class: "mk-tw", role: "region", "aria-label": label, tabindex: "0" },
      h("table", { class: "mk-tbl" },
        h("thead", null, h("tr", null, heads.map(([t, num]) => h("th", { scope: "col", class: num ? "c-num" : null }, t)))),
        h("tbody", null, rows.map((r) => h("tr", null, r.map((c, i) => {
          const cell = Array.isArray(c) ? c : [c];
          return h(i === 0 ? "th" : "td", { scope: i === 0 ? "row" : null, class: cell[1] || (heads[i] && heads[i][1] ? "c-num" : null), title: cell[2] || null }, cell[0]);
        }))))));
  }

  const clear = (id) => { const n = $(id); if (n) n.replaceChildren(); return n; };
  const unreadable = (feed) => Boolean(feed && feed.__unreadable === true);
  const pendingOf = (feed) => !feed || feed.status === "pending";

  function unreadableLine(feed, what) {
    return emptyLine("unreadable",
      "The request for " + what + " did not come back" +
      (feed && feed.__reason ? " (" + feed.__reason + ")" : "") +
      ". That is this page failing to READ the payload, not a statement about " +
      "what the payload holds — reload before drawing any conclusion from the " +
      "panels that did load.", what);
  }
  function pendingLine(what, cost) {
    return emptyLine("pending", "The pipeline has not published " + what + " yet. " + cost, what);
  }

  const NY_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const NY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const clock = (at) => { const t = Date.parse(at); return Number.isFinite(t) ? NY_CLOCK.format(new Date(t)) : DASH; };
  const nyMinutes = (at) => {
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return null;
    const p = Object.fromEntries(NY_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return (+p.hour % 24) * 60 + +p.minute;
  };
  const hourTicks = (lo, hi, every) => {
    const out = [];
    const step = hi - lo < 150 ? 30 : 60 * (every || 1);
    for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
      const hr = Math.floor(m / 60), mm = m % 60;
      out.push({ v: m, label: mm ? (hr % 12 || 12) + ":" + String(mm).padStart(2, "0") : (hr % 12 || 12) + (hr < 12 ? " AM" : " PM") });
    }
    return out;
  };
  const timeAxis = (ts) => {
    const mins = ts.map(nyMinutes);
    const ok = mins.length > 1 && mins.every((m, i) => m !== null && (i === 0 || m > mins[i - 1]));
    return ok ? { x: mins, xType: "number", ticks: (w) => hourTicks(mins[0], mins[mins.length - 1], w < 420 ? 2 : 1) } : { x: ts, xType: "index", ticks: () => undefined };
  };

  function ageWords(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m < 90) return m + (m === 1 ? " minute" : " minutes");
    const hh = Math.round(m / 60);
    if (hh < 36) return hh + (hh === 1 ? " hour" : " hours");
    const d = Math.round(hh / 24);
    return d + (d === 1 ? " day" : " days");
  }
  function utcStamp(t, withDay) {
    const iso = t.toISOString();
    return (withDay ? iso.slice(0, 16).replace("T", " ") : iso.slice(11, 16)) + " UTC";
  }

  function pulseStamp(readAt, refreshed, cadenceMinutes) {
    if (typeof readAt !== "string") return "";
    const t = new Date(readAt);
    if (Number.isNaN(t.getTime())) return "";
    const now = new Date();
    const sameDay = utcStamp(t, true).slice(0, 10) === utcStamp(now, true).slice(0, 10);
    const when = utcStamp(t, !sameDay);
    const ageMin = (now.getTime() - t.getTime()) / 60000;
    const build = refreshed === "nightly" ? " with the nightly build" : "";
    const minutes = isNum(cadenceMinutes);
    const cadence = minutes !== null && minutes > 0 ? minutes : null;
    if (cadence === null) {
      const since = Math.round(ageMin) >= 1 ? ", " + ageWords(ageMin) + " ago" : "";
      return "Read " + when + build + since + ". This payload did not publish the refresh " +
        "cadence, so this page cannot say whether that read is still current.";
    }
    const live = ageMin < cadence * 2;
    const stale = ", last read " + ageWords(ageMin) + " ago — the intraday refresh is not " +
      "keeping it current, so every number below is as of that stamp.";
    if (refreshed === "intraday") {
      return live
        ? "Read " + when + " (refreshes about every " + cadence + (cadence === 1 ? " minute" : " minutes") + " during market hours)."
        : "Read " + when + stale;
    }
    if (refreshed === "nightly") {
      return live ? "Read " + when + build + " (refreshes intraday during market hours)." : "Read " + when + build + stale;
    }
    return "Read " + when + (live ? "." : ", " + ageWords(ageMin) + " ago.");
  }

  function track(value, axis) {
    const n = isNum(value);
    const box = h("span", { class: "mk-track" }, h("i", { class: "mk-zero" }));
    if (n !== null) {
      const frac = Math.min(Math.abs(n) / (axis || 1), 1);
      box.append(h("i", { class: "mk-bar " + barClass(n), style: { width: (frac * 50) + "%", left: n >= 0 ? "50%" : (50 - frac * 50) + "%" } }));
    }
    return box;
  }

  function paintTilt(m) {
    const host = clear("mktTilt");
    if (!host) return;
    const breadth = m.breadth || {};
    const premium = m.premium || {};
    const b = isNum(breadth.tilt), p = isNum(premium.tilt);
    const row = (label, value, note) => h("div", { class: "mk-tilt", "data-note": note },
      h("span", { class: "mk-tilt-k" }, label), track(value, 1),
      h("span", { class: "mk-tilt-v", "data-tone": toneOf(value) }, signed(value, 3)));
    host.append(
      row("By names", breadth.tilt, count(breadth.bull) + " bought, " + count(breadth.bear) + " sold, " +
        count(breadth.flat) + " level, of " + count(premium.priced) + " names that quoted both legs."),
      row("By dollars", premium.tilt, usd(premium.netPositive) + " of net call premium against " +
        usd(premium.netNegative) + " of net put premium."),
      h("div", { class: "mk-scale", "aria-hidden": "true" }, h("span", null, MINUS + "1"), h("span", null, "0"), h("span", null, "+1")));
    let said = "", how = "";
    if (b === null || p === null) {
      said = "One of the two weightings could not be measured this session, so they cannot be compared.";
    } else if (b === 0 || p === 0) {
      if (b === 0 && p === 0) {
        said = "Both weightings came back exactly level: the names split evenly and so did the dollars. There is no lean to agree or disagree about.";
      } else {
        said = (b === 0
          ? "Counting names, the session was exactly level while the dollars leaned " + (p > 0 ? "positive" : "negative")
          : "The dollars were exactly level while more names leaned " + (b > 0 ? "positive" : "negative")) +
          ", so the two weightings neither agree nor disagree.";
        how = "One weighting has a sign and the other does not, which is itself a reading and the reason both are drawn.";
      }
    } else if ((b > 0) !== (p > 0)) {
      said = "The two weightings DISAGREE in sign: more names leaned " + (b > 0 ? "positive" : "negative") +
        " while the dollars leaned " + (p > 0 ? "positive" : "negative") + " — breadth without size, or size without breadth.";
    } else {
      said = "Both weightings agree in sign: names and dollars both leaned " + (b > 0 ? "positive" : "negative") + " this session.";
    }
    host.dataset.lead = said;
    host.dataset.note = how;
    const agree = b !== null && p !== null && b !== 0 && p !== 0 && (b > 0) === (p > 0);
    host.prepend(h("div", { class: "mk-verdict", "data-tone": b === null || p === null ? "silent" : agree ? toneOf(p) : "warn" },
      glyph(b === null || p === null ? "unavailable" : agree ? (p > 0 ? "up" : "down") : "flat"),
      h("span", null, b === null || p === null ? "Not comparable" : agree ? (p > 0 ? "Bought, both ways" : "Sold, both ways") : b === 0 || p === 0 ? "Level on one side" : "Weightings disagree")));
  }

  function paintBreadth(m) {
    const host = clear("mktBreadth");
    if (!host) return;
    const b = m.breadth || {}, p = m.premium || {};
    const bull = isNum(b.bull), bear = isNum(b.bear), flat = isNum(b.flat);
    let splitDrew = false;
    if (bull === null || bear === null || flat === null) {
      const absent = [];
      if (bull === null) absent.push("net bought");
      if (bear === null) absent.push("net sold");
      if (flat === null) absent.push("level");
      host.append(emptyLine("unavailable",
        "The breadth split cannot be drawn: this payload published no count of names " +
        absent.join(", ") + ", so its three parts do not add to a whole and drawing the " +
        "rest would publish a total that was never measured.", "breadth split", 72));
    } else if (bull + bear + flat === 0) {
      host.append(emptyLine("quiet",
        "No screened name quoted both a call and a put leg this session, so there is no " +
        "priced population to split. The three counts were published and all three are zero.", "breadth split", 72));
    } else {
      splitDrew = true;
      const total = bull + bear + flat;
      const bar = h("div", { class: "mk-stack", role: "img",
        "aria-label": bull + " names net bought, " + bear + " net sold, " + flat + " level, of " + total + " priced." });
      for (const [cls, n, word] of [["is-pos", bull, "bought"], ["is-flat", flat, "level"], ["is-neg", bear, "sold"]]) {
        if (!n) continue;
        bar.append(h("i", { class: "mk-seg " + cls, title: n + " " + word, style: { width: (n / total * 100) + "%" } }));
      }
      host.append(bar, h("div", { class: "mk-legend" },
        h("span", { "data-tone": "up" }, h("b", null, String(bull)), " bought"),
        h("span", null, h("b", null, String(flat)), " level"),
        h("span", { "data-tone": "down" }, h("b", null, String(bear)), " sold")));
    }
    const share = isNum(p.topShare);
    const caveats = [];
    const concentration = share === null ? null : "The five largest names account for " + pct(share) + " of all net premium moved.";
    if (!splitDrew && concentration) caveats.push(concentration);
    if (share !== null && share > 0.5) caveats.push("More than half the total is five names: read the aggregate as those names, not as the universe.");
    const unpriced = isNum(b.unpriced), oneLeg = isNum(p.oneLegged);
    if (unpriced !== null) {
      caveats.push(unpriced + " of " + count(m.n) + " screened names quoted no usable " +
        "net premium and are excluded from every total above rather than counted as level" +
        (oneLeg ? " — " + oneLeg + " of them quoted one leg only." : "."));
    }
    host.dataset.lead = splitDrew && concentration ? concentration : "";
    host.dataset.qual = caveats.join(" ");
    host.dataset.note = share !== null && share <= 0.5 ? "The total is spread across the universe rather than owned by a handful of prints." : "";
    if (share !== null) {
      host.append(h("div", { class: "mk-conc" }, h("span", null, "Top five"), h("span", { class: "mk-conc-t" }, h("i", { style: { width: Math.min(100, share * 100) + "%" } })),
        h("b", { "data-tone": share > 0.5 ? "warn" : null }, pct(share, 0))));
    }
  }

  function paintTape(m) {
    const host = clear("mktTape");
    if (!host) return;
    const p = m.premium || {}, pcr = m.pcr || {}, ag = m.aggressor || {}, vol = m.vol || {};
    const pcrVol = isNum(pcr.volume), pcrPrem = isNum(pcr.premium);
    const rows = [
      ["Net premium", "Net premium, signed", usdS(p.net), p.priced, toneOf(p.net)],
      ["P/C contracts", "Put contracts per call", pcrVol === null ? DASH : pcrVol.toFixed(3), pcr.quotedVolume, null],
      ["P/C premium", "Put premium per call", pcrPrem === null ? DASH : pcrPrem.toFixed(3), pcr.quotedPremium, null],
      ["Calls at offer", "Calls lifted at the offer", pct(ag.callLift), ag.quoted, null],
      ["Puts at offer", "Puts lifted at the offer", pct(ag.putLift), ag.quoted, null],
      ["IV 30d median", "Median 30-day implied vol", pct(vol.iv30dMedian), vol.iv30dQuoted, null],
      ["IV rank median", "Median IV rank", pct(vol.ivRankMedian), vol.ivRankQuoted, null],
    ];
    host.append(UI.metrics(rows.map(([label, long, value, pop, tone]) => {
      const n = isNum(pop);
      const shown = n === 0 ? DASH : value;
      const node = UI.metric(label, shown, { tone: n === 0 || shown === DASH ? null : tone, id: long });
      node.dataset.pop = n === null ? DASH : String(n);
      return node;
    }), { min: 120 }));
    host.dataset.rows = JSON.stringify(rows.map(([, long, value, pop]) => [long, isNum(pop) === 0 ? DASH : value, isNum(pop) === null ? DASH : String(isNum(pop))]));
  }

  const SECTOR_SHORT = { "Information Technology": "Technology", "Communication Services": "Communication",
    "Consumer Discretionary": "Discretionary", "Consumer Staples": "Staples" };

  const NARROW = { "Communication Services": "Comms", "consumer cyclical": "Cyclicals", "financial services": "Financials" };

  function sectorBp(r) {
    return isNum(r && r.trixBp);
  }

  function paintSectors(sectors) {
    const host = clear("mktSectors");
    if (!host) return;
    const entries = sectors && Array.isArray(sectors.sectors) ? sectors.sectors.slice() : [];
    host.dataset.lead = "";
    host.dataset.qual = "";
    host.dataset.note = "";
    if (unreadable(sectors)) { host.append(unreadableLine(sectors, "sector momentum (/api/flows/sectors)")); return; }
    if (!sectors || sectors.status === "pending") {
      host.append(pendingLine("sector momentum", "It costs eleven candle calls a run, so it appears with the first pipeline run after it shipped."));
      return;
    }
    if (!entries.length) {
      host.append(emptyLine("unavailable", "This payload carried no sector readings, so the page cannot say whether any " +
        "sector settled. That is a gap in the payload rather than a fact about the market.", "sector momentum"));
      return;
    }
    const measured = entries.filter((r) => sectorBp(r) !== null);
    const scoreOnly = entries.filter((r) => sectorBp(r) === null && isNum(r && r.trix) !== null).length;
    if (!measured.length) {
      const why = entries.filter((r) => r && r.reason).map((r) => r.reason)[0];
      host.append(emptyLine("quiet", "No sector carried enough history to settle a TRIX reading this session" +
        (why ? " (" + why + ")." : "."), "sector momentum"));
      return;
    }
    const scaling = (sectors && sectors.scaling) || {};
    const published = isNum(scaling.fullScaleBp);
    const fixedAxis = published !== null && published > 0;
    const axis = fixedAxis ? published : (measured.reduce((a, r) => Math.max(a, Math.abs(sectorBp(r))), 0) || 1);
    measured.sort((a, b) => sectorBp(b) - sectorBp(a));
    let railed = 0;
    const key = (r) => {
      const name = r.sector || r.etf || DASH;
      return h("span", { class: "mk-sector-k", title: name, "data-short": NARROW[name] || null },
        h("span", { class: "mk-k-full" }, SECTOR_SHORT[name] || name), r.etf && r.etf !== name ? h("small", { class: "mk-sector-etf" }, r.etf) : null);
    };
    const spoken = (r) => { const name = r.sector || r.etf || DASH; return name + (r.etf && r.etf !== name ? " (" + r.etf + ")" : ""); };
    const list = h("ul", { class: "mk-sectors" });
    measured.forEach((r) => {
      const bp = sectorBp(r);
      if (Math.abs(bp) > axis) railed++;
      const tr = track(bp, axis);
      tr.setAttribute("role", "img");
      tr.setAttribute("aria-label", spoken(r) + " " + signed(bp, 2) + " basis points per session, " +
        (bp < 0 ? "left of" : bp > 0 ? "right of" : "at") + " the zero rule.");
      list.append(h("li", { class: "mk-sector" }, key(r), tr, h("span", { class: "mk-sector-v", "data-tone": toneOf(bp) }, signed(bp, 2) + " bp")));
    });
    entries.forEach((r) => {
      if (!r || sectorBp(r) !== null || isNum(r.trix) !== null) return;
      list.append(h("li", { class: "mk-sector is-unsettled" }, key(r),
        h("span", { class: "mk-unset" }, DASH, inlineHush("unavailable", "not settled — " + (r.reason || "the payload gives no reason"), spoken(r)))));
    });
    host.append(list);
    const unmeasured = entries.length - measured.length - scoreOnly;
    const caveats = [];
    if (fixedAxis) {
      caveats.push("The axis is the payload's own published band, " + MINUS + axis + " to +" + axis +
        " bp, which is the same band every session: a bar can be read against another sector and against this sector last week.");
      if (railed) {
        caveats.push(railed + " sector" + (railed === 1 ? " sits" : "s sit") + " beyond that band and " +
          (railed === 1 ? "is" : "are") + " drawn at full width; the number beside " + (railed === 1 ? "it" : "them") +
          " is the true reading, not the rail.");
      }
    } else {
      caveats.push("This payload published no full-scale band, so the axis is scaled to the widest reading of this " +
        "session only — it compares sectors with each other and never with another day.");
    }
    if (sectors.basis) caveats.push("Basis: " + sectors.basis + ".");
    if (unmeasured > 0) {
      caveats.push(unmeasured + " of " + entries.length + " sector" + (entries.length === 1 ? "" : "s") +
        " had too little history to settle and " + (unmeasured === 1 ? "is" : "are") +
        " listed without a bar, with the payload's own reason beside the name, rather than drawn at zero.");
    }
    if (scoreOnly > 0) {
      caveats.push(scoreOnly + " sector" + (scoreOnly === 1 ? "" : "s") + " published a clamp score with no raw reading " +
        "beside it and cannot be drawn signed; that is a payload defect rather than a quiet sector.");
    }
    host.dataset.lead = measured.length + " of " + entries.length + " sector" + (entries.length === 1 ? "" : "s") + " settled a reading.";
    host.dataset.qual = caveats.join(" ");
    host.dataset.note = "TRIX in basis points per session: a triple-smoothed momentum reading on each sector ETF's own log closes, " +
      "so it describes the sector's trend rather than its level. Sign is carried by POSITION — left of the centre rule is " +
      "negative — and by the glyph on the number, so the panel survives greyscale and a monochrome printout.";
  }

  function moverList(title, rows, key, opts) {
    const o = opts || {};
    const said = o.said || title.toLowerCase();
    const box = h("div", { class: "mk-movers-col", "aria-label": cap1(said) });
    const head = h("h3", { class: "mk-movers-h", title: cap1(said) }, title);
    box.append(head);
    if (!Array.isArray(rows)) {
      box.append(emptyLine("unavailable", "This payload published no ranking for " + said +
        ", so this column was never measured. It is not a statement that no name qualified.", said, 64));
      return box;
    }
    if (!rows.length) {
      box.append(emptyLine("quiet", "The ranking for " + said + " was taken and came back with no name in it — a fact about the session.", said, 64));
      return box;
    }
    const shown = rows.slice(0, o.max || 8);
    head.append(h("span", { class: "mk-movers-n" }, " · " + shown.length + " of " + rows.length));
    const top = Math.max(...shown.map((r) => Math.abs(isNum(key === "chg" ? r.chg : r.netPrem) || 0)), 1e-12);
    box.append(h("ul", { class: "mk-movers" }, shown.map((r) => {
      const v = isNum(key === "chg" ? r.chg : r.netPrem);
      return h("li", null,
        h("span", { class: "mk-mv-t" }, o.label ? o.label(r) : r.t || DASH),
        h("span", { class: "mk-mv-m", "aria-hidden": "true" }, h("i", { "data-tone": toneOf(v), style: { width: (v === null ? 0 : Math.abs(v) / top * 100) + "%" } })),
        h("span", { class: "mk-mv-v", "data-tone": toneOf(v) }, key === "chg" ? (v === null ? DASH : signed(v * 100, 2) + "%") : usd(v)));
    })));
    return box;
  }

  function paintMovers(movers) {
    const host = clear("mktMovers");
    const seg = clear("mkMoversSeg");
    if (!host) return;
    host.dataset.pop = "";
    if (unreadable(movers)) { host.append(unreadableLine(movers, "the session's extremes (/api/flows/movers)")); return; }
    if (!movers || movers.status === "pending") {
      host.append(pendingLine("the session's extremes", "They are cut from screener rows the run already holds and cost no vendor call, so they appear with the first pipeline run after this shipped."));
      return;
    }
    const prem = movers.premium || {};
    const lists = [
      ["Risers", movers.risers, "chg", "the largest risers"], ["Fallers", movers.fallers, "chg", "the largest fallers"],
      ["Calls", prem.bullish, "netPrem", "the most net call premium"], ["Puts", prem.bearish, "netPrem", "the most net put premium"],
    ];
    if (!lists.some((spec) => spec[1] && spec[1].length)) {
      host.append(emptyLine("quiet", "This payload ranked no name on any of the four extremes. The screener answered " +
        "and the ranking came back empty, which is a statement about the session rather than a failure to read it.", "extremes"));
      return;
    }
    const cols = lists.map((spec) => moverList(spec[0], spec[1], spec[2], { said: spec[3] }));
    const grid = h("div", { class: "mk-movers-grid", "data-show": "0" }, cols);
    const show = (i) => { grid.dataset.show = String(i); cols.forEach((c, j) => c.classList.toggle("is-on", i === j)); };
    show(0);
    host.append(grid);
    if (seg) seg.append(UI.segmented("Extreme", lists.map((spec) => ({ label: spec[0] })), show, 0));
    const universe = isNum(movers.universe), ranked = isNum(movers.ranked), priced = isNum(movers.priced);
    const noChange = isNum(movers.unrankedChange), noPrem = isNum(movers.unrankedPremium);
    if (universe === null || ranked === null || priced === null || noChange === null || noPrem === null) {
      host.append(emptyLine("unavailable", "This payload published no count of the screened names it ranked, so the four " +
        "columns above carry no denominator. That is a gap in the payload, not a statement about the session.", "extremes population", 64));
    } else {
      host.dataset.pop = ranked + " of " + universe + " screened names could be ranked by change and " + priced +
        " by net premium; " + noChange + " quoted no change and " + noPrem + " no net premium, and those names are in no column. " +
        "Each column prints at most its first 8 names.";
    }
  }

  function crossBoard(boardRows, moverRows) {
    const out = [];
    const byTicker = new Map();
    for (const mv of Array.isArray(moverRows) ? moverRows : []) if (mv && mv.t) byTicker.set(mv.t, mv);
    for (const r of boardRows) {
      if (!r || !r.t || !byTicker.has(r.t)) continue;
      out.push({ t: r.t, rank: isNum(r.r), netPrem: isNum(byTicker.get(r.t).netPrem) });
    }
    out.sort((a, b) => (a.rank === null ? 1 : b.rank === null ? -1 : a.rank - b.rank));
    return out;
  }

  function paintAgainst(boards, movers) {
    const host = clear("mktAgainst");
    if (!host) return;
    host.dataset.lead = "";
    host.dataset.qual = "";
    const [boardLong, boardShort] = boards;
    if (unreadable(boardLong) || unreadable(boardShort)) {
      host.append(unreadableLine(unreadable(boardLong) ? boardLong : boardShort, "the boards this panel is joined against (/api/flows/board)"));
      return;
    }
    if (unreadable(movers)) { host.append(unreadableLine(movers, "the session's premium extremes (/api/flows/movers)")); return; }
    if (pendingOf(boardLong) || pendingOf(boardShort) || pendingOf(movers)) {
      host.append(pendingLine("both halves of this join", "It reads the two published boards against the session's premium extremes and needs both; it fills on the first run that writes them."));
      return;
    }
    const prem = movers.premium || {};
    const sides = [
      { title: "Long in puts", said: "Long board, in the largest net PUT premium", board: boardLong, side: "long", list: prem.bearish,
        ranking: "the session's largest net put premium", empty: "No long-board name appears in the session's largest net put premium." },
      { title: "Short in calls", said: "Short board, in the largest net CALL premium", board: boardShort, side: "short", list: prem.bullish,
        ranking: "the session's largest net call premium", empty: "No short-board name appears in the session's largest net call premium." },
    ];
    if (!sides.some((side) => Array.isArray(side.list))) {
      host.append(emptyLine("unavailable", "This movers payload published neither premium extreme, so there is nothing for " +
        "the boards to be joined against. The absence is in the payload, not in the overlap.", "against the tape"));
      return;
    }
    let hits = 0, population = 0;
    const joined = [], skipped = [];
    const grid = h("div", { class: "mk-movers-grid mk-against" });
    for (const side of sides) {
      const boardRows = side.board && Array.isArray(side.board.rows) ? side.board.rows : [];
      const col = h("div", { class: "mk-movers-col", "aria-label": side.said }, h("h3", { class: "mk-movers-h", title: side.said }, side.title));
      grid.append(col);
      if (!Array.isArray(side.list)) {
        skipped.push("the " + side.side + " board (" + boardRows.length + " name" + (boardRows.length === 1 ? "" : "s") +
          ") could not be joined, because this payload published no ranking of " + side.ranking);
        col.append(emptyLine("unavailable", "This movers payload published no ranking of " + side.ranking + ", so the " + side.side +
          " board could not be read against it. Nothing here says the overlap is empty — it says the overlap was never taken.", side.side + " board join", 64));
        continue;
      }
      if (!boardRows.length) {
        col.append(emptyLine("quiet", "The " + side.side + " board ranked no name this session, so there is nothing on " +
          "this side to read against the tape. That is a fact about the board rather than about the overlap.", side.side + " board join", 64));
        continue;
      }
      const found = crossBoard(boardRows, side.list);
      hits += found.length;
      population += boardRows.length;
      joined.push(boardRows.length + " " + side.side);
      col.append(found.length ? h("ul", { class: "mk-movers" }, found.map((r) => h("li", null,
        h("span", { class: "mk-mv-t" }, r.rank === null ? r.t + " (board rank not published)" : r.t + " #" + r.rank),
        h("span", { class: "mk-mv-v", "data-tone": toneOf(r.netPrem) }, usd(r.netPrem)))))
        : emptyLine("quiet", side.empty, side.side + " board join", 64));
    }
    host.prepend(UI.metrics([
      UI.metric("Against", population ? hits + " of " + population : DASH, { tone: hits ? "warn" : null, sub: population ? "board names" : null,
        state: population ? null : { state: "quiet", reason: "No board name was joined against the tape this session." } }),
    ], { min: 140 }));
    host.append(grid);
    host.dataset.lead = !population
      ? "No board name was joined against the tape this session, so there is no population to state a count against."
      : hits + " of " + population + " published board names (" + joined.join(", ") + ") appear in the opposite premium extreme this session.";
    const caveats = [];
    if (skipped.length) caveats.push(skipped.join("; ") + ".");
    caveats.push("Both mover lists are CAPPED extremes rather than the universe, so a name absent from them has not been " +
      "shown to agree with the tape: it has only been shown not to be one of the session's loudest disagreements.");
    host.dataset.qual = caveats.join(" ");
  }

  const PULSE_QUIET = "The feed answered this read with nothing — ordinary before the open for a series that fills during " +
    "market hours, and a vendor silence rather than a quiet market when the read is stamped after the close.";

  function feedSilence(feed, what) {
    if (!feed || feed.status === "unavailable") {
      return emptyLine("unavailable", "This feed could not be read on this run" + (feed && feed.reason ? ": " + feed.reason : "") +
        ". Its neighbours are unaffected.", what);
    }
    return emptyLine("quiet", PULSE_QUIET, what);
  }

  function capLine(feed, shown, noun) {
    const seen = isNum(feed.seen), shed = isNum(feed.shed);
    const capped = (shed !== null && shed > 0) || (seen !== null && shown < seen);
    return capped && seen !== null ? shown + " " + noun + " kept of " + seen + " the feed returned — a capped list, never the population." : null;
  }

  let stampSaid = "";

  function tideViews(pulse, live) {
    const views = [];
    const lv = live && !pendingOf(live) && !unreadable(live) ? live : null;
    const pulseDay = pulse && !pendingOf(pulse) && !unreadable(pulse) ? (pulse.readDay || pulse.sessionDate || null) : null;
    const series = (label, sr, src) => {
      if (!sr || sr.status !== "ok" || !Array.isArray(sr.t) || sr.t.length < 2) return;
      const at = (arr, i) => (Array.isArray(arr) ? isNum(arr[i]) : null);
      views.push({ label, src, t: sr.t, call: sr.t.map((_, i) => at(sr.ncp, i)), put: sr.t.map((_, i) => at(sr.npp, i)),
        net: sr.t.map((_, i) => at(sr.net, i)), px: Array.isArray(sr.px) ? sr.t.map((_, i) => at(sr.px, i)) : null });
    };
    if (lv && (!pulseDay || !lv.session || lv.session >= pulseDay)) series("Market", lv.tide, "live:market");
    if (!views.length && pulse && !pendingOf(pulse) && !unreadable(pulse) && pulse.tide && pulse.tide.status === "ok" &&
        Array.isArray(pulse.tide.points) && pulse.tide.points.length) {
      const pts = pulse.tide.points;
      views.push({ label: "Market", src: "pulse", t: pts.map((p) => p && p.t),
        call: pts.map((p) => isNum(p && p.callPrem)), put: pts.map((p) => isNum(p && p.putPrem)),
        net: pts.map((p) => { const c = isNum(p && p.callPrem), q = isNum(p && p.putPrem); return c === null || q === null ? null : c - q; }), px: null });
    }
    if (lv) {
      series("0DTE", lv.zeroDte, "live:market");
      if (lv.etf) { series("SPY", lv.etf.SPY, "live:market"); series("QQQ", lv.etf.QQQ, "live:market"); }
    }
    return views;
  }

  let tideChart = null;

  function paintTide(pulse, live) {
    const host = clear("mkTide");
    const legs = clear("mkTideLegs");
    const seg = clear("mkTideSeg");
    if (!host) return;
    if (tideChart) { tideChart.destroy(); tideChart = null; }
    const views = tideViews(pulse, live);
    if (!views.length) {
      if (unreadable(pulse)) host.append(unreadableLine(pulse, "the market pulse (/api/flows/pulse)"));
      else if (pendingOf(pulse)) host.append(pendingLine("the market tide", "The live market layer and the pulse both fill during market hours."));
      else host.append(feedSilence(pulse.tide, "market tide"));
      return;
    }
    let active = 0;
    const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i]; return null; };
    const draw = () => {
      const v = views[active];
      const ax = timeAxis(v.t);
      if (legs) {
        legs.replaceChildren(UI.metrics([
          UI.metric("Net", usdS(last(v.net)), { tone: toneOf(last(v.net)), hero: true }),
          UI.metric("Calls", usdS(last(v.call)), { tone: toneOf(last(v.call)) }),
          UI.metric("Puts", usdS(last(v.put)), { tone: toneOf(-(last(v.put) || 0)) }),
        ], { min: 110 }));
      }
      host.replaceChildren();
      const plot = h("div", { class: "mk-river" });
      host.append(plot, UI.legend([["--up", "ln", "Net calls"], ["--down", "ln", "Net puts"]]));
      if (tideChart) tideChart.destroy();
      tideChart = C.line(plot, {
          x: ax.x, xType: ax.xType, xTicks: ax.ticks(host.clientWidth || 600), xFormat: (x) => clock(x), zero: true, height: [220, 260, 300],
          series: [
            { values: v.call, color: "--up", label: "Net calls", format: usdS },
            { values: v.put, color: "--down", label: "Net puts", dash: true, format: usdS },
          ],
          yFormat: usdS, label: v.label + " tide: net call and net put premium across the session",
          readout: (i) => [C.part(clock(v.t[i]), "k"), C.part("Calls", "k"), h("b", { "data-tone": "up" }, v.call[i] === null ? DASH : usdS(v.call[i])),
            C.part("Puts", "k"), h("b", { "data-tone": "down" }, v.put[i] === null ? DASH : usdS(v.put[i])),
            C.part("Net " + (v.net[i] === null ? DASH : usdS(v.net[i])), "k")],
      });
    };
    if (seg && views.length > 1) seg.append(UI.segmented("Tide", views.map((v) => ({ label: v.label })), (i) => { active = i; draw(); }, 0));
    draw();
    const src = views[0].src;
    const notes = pulse && pulse.notes ? pulse.notes : {};
    infoInto("mkTideCard", "tide", () => ({
      title: "Tide",
      lead: src === "pulse" ? stampSaid : "Read from the live market layer, which refreshes every five minutes during the session.",
      facts: [["Source", src], ["Points", String(views[active].t.length)], ["View", views[active].label]],
      notes: [notes.tide, "Net call premium minus net put premium is the net; a put line below zero is puts sold.",
        pulse && pulse.tide && Array.isArray(pulse.tide.points) ? capLine(pulse.tide, pulse.tide.points.length, "buckets") : null],
    }));
  }

  function rankOf(rows, valueOf) {
    const measured = [];
    for (const r of rows) { const v = valueOf(r); if (v !== null) measured.push(v); }
    if (!measured.length) return null;
    const newest = valueOf(rows[0]);
    if (newest === null) return null;
    let above = 0, level = 0;
    for (const v of measured) { if (v > newest) above++; else if (v === newest) level++; }
    return { rank: above + 1, of: measured.length, value: newest, tied: level > 1 };
  }
  const putShare = (r) => { const c = isNum(r && r.callPrem), q = isNum(r && r.putPrem); if (c === null || q === null) return null; const t = c + q; return t > 0 ? q / t : null; };
  const twoSided = (r) => { const c = isNum(r && r.callPrem), q = isNum(r && r.putPrem); return c === null || q === null ? null : c + q; };
  const ordinal = (n) => {
    const m = n % 100;
    if (m >= 11 && m <= 13) return n + "th";
    const l = n % 10;
    return n + (l === 1 ? "st" : l === 2 ? "nd" : l === 3 ? "rd" : "th");
  };

  function rankSaid(rows) {
    const share = rankOf(rows, putShare), size = rankOf(rows, twoSided);
    const newest = rows[0] || {};
    const said = [];
    const unrankable = (r) => (r.of < rows.length ? " (" + rows.length + " sessions were returned; " + (rows.length - r.of) + " quoted only one leg and cannot be ranked)" : "");
    const extreme = (r, top, bottom) => (r.rank === 1 ? (r.tied ? " — tied for the " + top + " in the window." : " — the " + top + " session in the window.")
      : r.rank === r.of ? (r.tied ? " — tied for the " + bottom + " in the window." : " — the " + bottom + " session in the window.") : ".");
    if (share) {
      said.push("Put premium was " + pct(share.value, 1) + " of the two-sided total on " + (newest.date || "the newest session") +
        ", the " + ordinal(share.rank) + " highest of the " + share.of + " session" + (share.of === 1 ? "" : "s") +
        " in this window that quoted both legs" + unrankable(share) + extreme(share, "most put-leaning", "most call-leaning"));
    } else {
      said.push("No session in this window quoted both a call and a put premium, so the newest session cannot be ranked against the others.");
    }
    if (size) {
      said.push("Total premium of " + usd(size.value) + " was the " + ordinal(size.rank) + " largest of the " + size.of +
        " session" + (size.of === 1 ? "" : "s") + " that quoted both legs" + unrankable(size) + ".");
    }
    if (share || size) {
      const span = (share || size).of;
      said.push("A rank over " + span + " session" + (span === 1 ? "" : "s") + " is an ordinal claim and nothing more: this window is " +
        "far too short to support a standard deviation, and a sigma computed from it would be a confident number where the honest one is a position in a queue.");
    }
    return said.join(" ");
  }

  function dayTicks(svg, dates, xAt, w, y) {
    const N = dates.length;
    const every = Math.max(1, Math.ceil(N / (w < 600 ? 4 : 6)));
    let placed = null;
    for (let i = N - 1; i >= 0; i -= every) {
      if (!dates[i]) continue;
      const x = Math.max(22, Math.min(w - 22, xAt(i)));
      if (placed !== null && placed - x < 48) continue;
      UI.s("text", { x, y, "text-anchor": "middle", text: F.day(dates[i]), class: "mk-vol-x" }, svg);
      placed = x;
    }
  }

  function paintVolume(pulse) {
    const host = clear("mkVolume");
    if (!host) return;
    const tot = pulse.totals;
    const rows = tot && Array.isArray(tot.rows) ? tot.rows : [];
    if (!tot || tot.status !== "ok" || !rows.length) { host.append(feedSilence(tot, "volume")); return; }
    const hist = pulse.totalsHistory && typeof pulse.totalsHistory === "object" ? pulse.totalsHistory : null;
    const pv = hist && hist.pcVolume ? hist.pcVolume : null;
    const newest = rows[0] || {};
    const c0 = isNum(newest.callVol), p0 = isNum(newest.putVol);
    const pcNow = pv && isNum(pv.now) !== null ? isNum(pv.now) : c0 && p0 !== null ? p0 / c0 : null;
    const z = pv ? isNum(pv.z) : null;
    const volPct = hist && hist.volume ? isNum(hist.volume.pct) : null;
    const pending = { state: "pending", reason: "The year of daily totals arrives with the pulse history addition, which has not published yet." };
    host.append(UI.metrics([
      UI.metric("Market P/C", pcNow === null ? DASH : pcNow.toFixed(2), { sub: newest.date ? F.day(newest.date) : null }),
      UI.metric("z vs 1Y", z === null ? DASH : F.signed(z, 1), { tone: z === null ? null : z > 1 ? "down" : z < -1 ? "up" : null, state: z === null ? pending : null }),
      UI.metric("Volume pct", volPct === null ? DASH : F.pct(volPct > 1 ? volPct / 100 : volPct, 0), { state: volPct === null ? pending : null }),
    ], { min: 90 }));
    const ordered = rows.slice().reverse();
    const slot = h("div", { class: "mk-pairs-w" });
    host.append(slot, UI.legend([["--up-mark", "", "Calls"], ["--down-mark", "", "Puts"]]));
    const VIEWS = [
      { label: "Contracts", c: "callVol", p: "putVol", fmt: (v) => F.num(v), said: "contracts" },
      { label: "Premium", c: "callPrem", p: "putPrem", fmt: usd, said: "premium" },
    ];
    let view = 0;
    let chart = null;
    const draw = () => {
      const V = VIEWS[view];
      if (chart) chart.destroy();
      const plot = h("div", { class: "mk-pairs" });
      slot.replaceChildren(plot);
      chart = C.mount(plot, (el, w, animate) => {
        const H = w < 600 ? 150 : 170, top = 10, bot = 22, mid = top + (H - top - bot) / 2;
        const svg = C.svgRoot(el, w, H, animate, "Call " + V.said + " up and put " + V.said + " down per session, oldest at the left");
        const N = ordered.length, band = (w - 8) / N;
        const hi = Math.max(1, ...ordered.map((r) => Math.max(isNum(r[V.c]) || 0, isNum(r[V.p]) || 0)));
        const half = (H - top - bot) / 2 - 2;
        const bw = Math.max(2, Math.min(14, band * 0.62));
        UI.s("line", { x1: 0, x2: w, y1: mid, y2: mid, class: "base" }, svg);
        ordered.forEach((r, i) => {
          const x = 4 + band * (i + 0.5);
          const c = isNum(r[V.c]), q = isNum(r[V.p]);
          const last = i === N - 1;
          if (c === null) UI.s("circle", { cx: x, cy: mid - 3, r: 1.6, fill: UI.cssVar("--label-4") }, svg);
          else { const hh = Math.max(1, c / hi * half); UI.s("rect", { x: x - bw / 2, y: mid - hh, width: bw, height: hh, rx: Math.min(3, bw / 2), fill: UI.cssVar("--up-mark"), "fill-opacity": last ? 1 : 0.62, class: "grow", style: { "--i": String(i), "--origin": "bottom" } }, svg); }
          if (q === null) UI.s("circle", { cx: x, cy: mid + 3, r: 1.6, fill: UI.cssVar("--label-4") }, svg);
          else { const hh = Math.max(1, q / hi * half); UI.s("rect", { x: x - bw / 2, y: mid, width: bw, height: hh, rx: Math.min(3, bw / 2), fill: UI.cssVar("--down-mark"), "fill-opacity": last ? 1 : 0.62, class: "grow", style: { "--i": String(i), "--origin": "top" } }, svg); }
        });
        dayTicks(svg, ordered.map((r) => r.date), (i) => 4 + band * (i + 0.5), w, H - 6);
        C.scrub(el, svg, {
          xs: ordered.map((_, i) => 4 + band * (i + 0.5)), top, bottom: H - bot, label: "Call and put " + V.said + " per session",
          onMove: (i) => ({ parts: [C.part(F.day(ordered[i].date), "k"), C.part("Calls", "k"), h("b", { "data-tone": "up" }, V.fmt(ordered[i][V.c])),
            C.part("Puts", "k"), h("b", { "data-tone": "down" }, V.fmt(ordered[i][V.p]))] }),
        });
      });
    };
    draw();
    const volSeg = clear("mkVolumeSeg");
    if (volSeg) volSeg.append(UI.segmented("Volume unit", VIEWS.map((x) => ({ label: x.label })), (i) => { view = i; draw(); }, 0));
    const shown = rows.slice(0, 10);
    const detail = table("Total options volume and premium per session, split call and put",
      [["Session"], ["Call vol", true], ["Put vol", true], ["Call prem", true], ["Put prem", true]],
      shown.map((r) => [r.date || DASH, grouped(r.callVol), grouped(r.putVol), usd(r.callPrem), usd(r.putPrem)]));
    const notes = pulse.notes || {};
    const rank = rankSaid(rows);
    host.dataset.rank = rank;
    infoInto("mkVolumeCard", "volume", () => ({
      title: "Volume", lead: rank,
      facts: [["P/C volume z", z === null ? (pv && pv.reason) || "pending" : F.signed(z, 2)], ["Sessions in the year", hist ? count(hist.n) : "pending"]],
      notes: [notes.totals, capLine(tot, rows.length, "sessions"), rows.length > shown.length ? "The table lists the newest " + shown.length + " of the " + rows.length + " sessions above; the chart shows all " + rows.length + "." : null],
      node: detail,
    }));
  }

  function growthSaid(r) {
    const n = isNum(r.ratio), prev = isNum(r.prevOi);
    const p = n === null ? null : n * 100;
    const plain = n === null ? DASH : (() => { const v = Math.abs(p) >= 100 ? Math.round(p) : Math.round(p * 10) / 10; return signGlyph(v) + Math.abs(v).toLocaleString("en-US") + "%"; })();
    if (n === null || n <= 0) return [plain, null];
    if (prev !== null && prev < 100) return ["new", "From " + grouped(prev) + " contracts, a base too small for a percentage to mean anything"];
    if (n >= 1) {
      const x = 1 + n;
      const times = x >= 10 ? Math.round(x).toLocaleString("en-US") : x.toFixed(1);
      return ["×" + times, times + " times the previous snapshot's open interest (" + plain + ")"];
    }
    return [plain, null];
  }
  const contractLabel = (r) => (r.cp && isNum(r.k) !== null && r.exp ? (r.t || DASH) + " " + r.cp + String(r.k) + " " + String(r.exp).slice(5) : r.oc || (r.t || DASH) + " " + DASH);

  function paintOi(pulse) {
    const host = clear("mkOi");
    if (!host) return;
    const feed = pulse.oiChange;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "open interest")); return; }
    const top = Math.max(...rows.map((r) => Math.abs(isNum(r.diff) || 0)), 1);
    host.append(UI.list(rows.map((r, i) => {
      const [growth, why] = growthSaid(r);
      const d = isNum(r.diff);
      return h("div", { class: "ui-row mk-oirow", role: "listitem" },
        h("span", { class: "ui-badge", "data-tone": r.cp === "C" ? "up" : r.cp === "P" ? "down" : null }, r.cp || "·"),
        h("span", { class: "ui-row-m" }, h("b", null, r.t || DASH), h("span", null, (isNum(r.k) === null ? DASH : r.k) + (r.exp ? " · " + F.day(String(r.exp)) : ""))),
        h("span", { class: "ui-meter" }, h("i", { style: { "--w": (Math.abs(d || 0) / top * 100).toFixed(1) + "%", "--i": String(i), "--c": UI.cssVar("--s-blue") } })),
        h("span", { class: "ui-row-v", "data-tone": toneOf(d) }, signedGrouped(r.diff)),
        h("span", { class: "ui-row-v mk-growth", title: why }, growth));
    }), { visible: 6, label: "Contracts by open-interest change" }));
    const detail = table("Contracts the vendor ranked by open-interest change", [["Contract"], ["Change", true], ["Growth", true], ["Curr OI", true], ["Volume", true]],
      rows.map((r) => { const [g, why] = growthSaid(r); return [contractLabel(r), signedGrouped(r.diff), [g, "c-num", why], grouped(r.currOi), grouped(r.vol)]; }));
    const notes = pulse.notes || {};
    infoInto("mkOiCard", "open interest", () => ({
      title: "Open interest", lead: "Contracts whose open interest grew most between the two clearing snapshots.",
      notes: [notes.oiChange, capLine(feed, rows.length, "contracts")], node: detail,
    }));
  }

  function paintImpact(pulse) {
    const host = clear("mkImpact");
    if (!host) return;
    const feed = pulse.netImpact;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "net impact")); return; }
    const pos = [], neg = [];
    for (const r of rows) { const v = isNum(r.netPrem); if (v === null) continue; if (v > 0) pos.push(r); else if (v < 0) neg.push(r); }
    const byNet = (a, b) => Math.abs(b.netPrem) - Math.abs(a.netPrem);
    pos.sort(byNet);
    neg.sort(byNet);
    host.append(h("div", { class: "mk-movers-grid mk-two" }, moverList("Positive", pos, "netPrem", { max: 6, said: "positive net premium impact" }), moverList("Negative", neg, "netPrem", { max: 6, said: "negative net premium impact" })));
    const notes = pulse.notes || {};
    infoInto("mkImpactCard", "net impact", () => ({ title: "Net impact", lead: "The names the vendor ranks by net premium impact, split by sign.", notes: [notes.netImpact, capLine(feed, Math.min(pos.length, 6) + Math.min(neg.length, 6), "names")] }));
  }

  function paintInsiders(pulse) {
    const host = clear("mkInsiders");
    if (!host) return;
    const feed = pulse.insiders;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "insider filings")); return; }
    const ordered = rows.slice().reverse();
    const last = rows[0] || {};
    host.append(UI.metrics([
      UI.metric("Buys", usd(last.buysNotional), { sub: count(last.buys) + " filings" + (last.date ? " · " + F.day(last.date) : ""), tone: "up" }),
      UI.metric("Sells", usd(isNum(last.sellsNotional) === null ? null : Math.abs(last.sellsNotional)), { sub: count(last.sells) + " filings" + (last.date ? " · " + F.day(last.date) : ""), tone: "down" }),
    ], { min: 100 }));
    const plot = h("div", { class: "mk-pairs" });
    host.append(plot);
    C.mount(plot, (el, w, animate) => {
      const H = w < 600 ? 130 : 170, top = 6, bot = 20, mid = top + (H - top - bot) / 2, half = (H - top - bot) / 2 - 2;
      const svg = C.svgRoot(el, w, H, animate, "Insider buy and sell notional per filing day");
      const N = ordered.length, band = (w - 8) / N, bw = Math.max(2, Math.min(12, band * 0.6));
      const hi = Math.max(1, ...ordered.map((r) => Math.max(Math.abs(isNum(r.buysNotional) || 0), Math.abs(isNum(r.sellsNotional) || 0))));
      UI.s("line", { x1: 0, x2: w, y1: mid, y2: mid, class: "base" }, svg);
      ordered.forEach((r, i) => {
        const x = 4 + band * (i + 0.5);
        const b = isNum(r.buysNotional), q = isNum(r.sellsNotional);
        if (b === null) UI.s("circle", { cx: x, cy: mid - 3, r: 1.6, fill: UI.cssVar("--label-4") }, svg);
        else { const hb = Math.max(1, Math.abs(b) / hi * half); UI.s("rect", { x: x - bw / 2, y: mid - hb, width: bw, height: hb, rx: 2, fill: UI.cssVar("--up-mark"), class: "grow", style: { "--i": String(i), "--origin": "bottom" } }, svg); }
        if (q === null) UI.s("circle", { cx: x, cy: mid + 3, r: 1.6, fill: UI.cssVar("--label-4") }, svg);
        else { const hs = Math.max(1, Math.abs(q) / hi * half); UI.s("rect", { x: x - bw / 2, y: mid, width: bw, height: hs, rx: 2, fill: UI.cssVar("--down-mark"), class: "grow", style: { "--i": String(i), "--origin": "top" } }, svg); }
      });
      dayTicks(svg, ordered.map((r) => r.date), (i) => 4 + band * (i + 0.5), w, H - 5);
      C.scrub(el, svg, { xs: ordered.map((_, i) => 4 + band * (i + 0.5)), top, bottom: H - bot, label: "Insider filings per day",
        onMove: (i) => ({ parts: [C.part(F.day(ordered[i].date), "k"), C.part("Buys", "k"), h("b", { "data-tone": "up" }, usd(ordered[i].buysNotional)),
          C.part("Sells", "k"), h("b", { "data-tone": "down" }, isNum(ordered[i].sellsNotional) === null ? DASH : usd(Math.abs(ordered[i].sellsNotional)))] }) });
    });
    const detail = table("Aggregate insider filings per filing day", [["Filing day"], ["Buys", true], ["Sells", true], ["Buy notional", true], ["Sell notional", true]],
      rows.map((r) => [r.date || DASH, grouped(r.buys), grouped(r.sells), usd(r.buysNotional), usd(r.sellsNotional)]));
    const notes = pulse.notes || {};
    infoInto("mkInsidersCard", "insiders", () => ({ title: "Insiders", lead: "Form 4 buys against sells, in dollars, per filing day.", notes: [notes.insiders, capLine(feed, rows.length, "filing days")], node: detail }));
  }

  function paintDark(pulse) {
    const host = clear("mkDark");
    if (!host) return;
    const feed = pulse.darkpool;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "dark pool prints")); return; }
    const ranked = rows.slice().sort((a, b) => (isNum(b.prem) || 0) - (isNum(a.prem) || 0));
    const top = Math.max(1, isNum(ranked[0] && ranked[0].prem) || 1);
    host.append(UI.list(ranked.map((r, i) => h("div", { class: "ui-row mk-dprow", role: "listitem" },
      h("span", { class: "ui-row-m" }, h("b", null, r.t || DASH), h("span", null, (isNum(r.px) === null ? DASH : "$" + isNum(r.px).toFixed(2)) + " · " + grouped(r.size))),
      h("span", { class: "ui-meter" }, h("i", { style: { "--w": ((isNum(r.prem) || 0) / top * 100).toFixed(1) + "%", "--i": String(i), "--c": UI.cssVar("--s-purple") } })),
      h("span", { class: "ui-row-v" }, usd(r.prem)))), { visible: 6, label: "Largest off-exchange prints" }));
    const hhmm = (iso) => (typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) : DASH);
    const detail = table("Off-exchange equity trades reported to the tape, as the vendor surfaces them", [["Name"], ["Time", true], ["Price", true], ["Size", true], ["Premium", true]],
      rows.map((r) => [r.t || DASH, hhmm(r.at), isNum(r.px) === null ? DASH : "$" + isNum(r.px).toFixed(2), grouped(r.size), usd(r.prem)]));
    const notes = pulse.notes || {};
    infoInto("mkDarkCard", "dark pool", () => ({ title: "Dark pool", lead: "The largest off-exchange prints by dollar size.", notes: [notes.darkpool, capLine(feed, rows.length, "prints")], node: detail }));
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const signedVendorPct = (v) => { const n = isNum(v); if (n === null) return DASH; const r = +(n * 100).toFixed(2); return signGlyph(r) + Math.abs(r).toFixed(2) + "%"; };
  const vendorPct = (v) => { const n = isNum(v); return n === null ? DASH : (n * 100).toFixed(0) + "%"; };

  function paintSeason(pulse) {
    const host = clear("mkSeason");
    const seg = clear("mkSeasonSeg");
    if (!host) return;
    const feed = pulse.seasonality;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "seasonality")); return; }
    const symOf = (r) => (typeof r.t === "string" && r.t ? r.t : null);
    const syms = [];
    for (const r of rows) if (!syms.includes(symOf(r))) syms.push(symOf(r));
    const cells = new Map(rows.map((r) => [symOf(r) + ":" + isNum(r.month), r]));
    if (cells.size < rows.length) {
      host.append(emptyLine("unavailable", syms.some((t) => t) ?
        "The seasonality feed carried " + rows.length + " rows for " + cells.size + " ticker months, so at least one ticker repeats a month. Nothing is drawn rather than a calendar that averages two readings it cannot tell apart." :
        "The seasonality feed carried " + rows.length + " rows for " + new Set(rows.map((r) => isNum(r.month))).size + " distinct months. The vendor sends one row per ticker per month, and this " +
        "payload does not say which ticker a row is, so the rows cannot be told apart. Nothing is drawn rather than a " +
        "calendar that repeats a month.", "seasonality", 120));
      return;
    }
    const nowMonth = new Date().getMonth() + 1;
    if (syms.length > 1 || syms[0] !== null) {
      const VIEWS = [
        { label: "Average", of: (r) => isNum(r.avg), fmt: signedVendorPct, what: "Average change" },
        { label: "Up months", of: (r) => { const p = isNum(r.positivePct); return p === null ? null : p - 0.5; }, fmt: (v) => vendorPct(v + 0.5) + " up", what: "Share of years the month closed higher, against even odds" },
      ];
      let view = 0;
      const draw = () => {
        const V = VIEWS[view];
        const grid = syms.map((t) => MONTHS.map((_, i) => { const r = cells.get(t + ":" + (i + 1)); return r ? V.of(r) : null; }));
        const gridHost = h("div", { class: "mk-sea-hm" });
        host.replaceChildren(gridHost);
        C.heatmap(gridHost, { rows: syms, cols: MONTHS, grid, palette: "direction", left: 52, cellH: 24, highlightCol: nowMonth - 1,
          rowFormat: (t) => t || DASH, format: V.fmt, label: V.what + " by calendar month for " + syms.length + " index and sector funds" });
      };
      draw();
      if (seg) seg.append(UI.segmented("Seasonality view", VIEWS.map((x) => ({ label: x.label })), (i) => { view = i; draw(); }, 0));
      host.dataset.funds = String(syms.length);
    } else {
      const peak = Math.max(1e-9, ...rows.map((r) => Math.abs(isNum(r.avg) || 0)));
      host.append(h("div", { class: "mk-sea" }, rows.map((r) => {
        const m = isNum(r.month), a = isNum(r.avg);
        const tip = [];
        if (isNum(r.median) !== null) tip.push("median " + signedVendorPct(r.median));
        if (isNum(r.min) !== null && isNum(r.max) !== null) tip.push("range " + signedVendorPct(r.min) + " to " + signedVendorPct(r.max));
        if (isNum(r.years) !== null) tip.push("over " + r.years + " years");
        return h("div", { class: "mk-sea-cell" + (m === nowMonth ? " is-now" : ""), title: tip.join(" · ") || null,
          "data-tone": toneOf(a), style: { "--a": a === null ? "0" : Math.sqrt(Math.abs(a) / peak).toFixed(3) } },
        h("span", { class: "mk-sea-m" }, m !== null && m >= 1 && m <= 12 ? MONTHS[m - 1] : DASH),
        h("span", { class: "mk-sea-v", "data-tone": toneOf(a) }, signedVendorPct(r.avg)),
        h("span", { class: "mk-sea-p" }, vendorPct(r.positivePct)));
      })));
    }
    const notes = pulse.notes || {};
    const funds = syms.filter(Boolean);
    infoInto("mkSeasonCard", "seasonality", () => ({ title: "Seasonality", lead: funds.length ?
      "Average change in each calendar month for " + funds.join(", ") + ", over the years the vendor holds. Up months is the share of those years the month closed higher; the outlined column is this month." :
      "Average change in each calendar month over the years the vendor holds, with the share of those months that closed higher beneath it.",
      notes: [notes.seasonality, capLine(feed, rows.length, funds.length ? "fund months" : "months")] }));
  }

  function paintPulse(pulse) {
    const ids = ["mkVolume", "mkOi", "mkImpact", "mkInsiders", "mkDark", "mkSeason"];
    stampSaid = "";
    if (unreadable(pulse) || !pulse || pulse.status === "pending") {
      for (const id of ids) {
        const host = clear(id);
        if (!host) continue;
        host.append(unreadable(pulse) ? unreadableLine(pulse, "the market pulse (/api/flows/pulse)")
          : pendingLine("the market pulse", "Seven market-wide feeds are pooled under one key that refreshes during market hours; the section fills on the first run that writes it."));
      }
      return;
    }
    stampSaid = pulseStamp(pulse.readAt, pulse.refreshed, pulse.cadenceMinutes);
    const stampEl = $("mkPulseStamp");
    if (stampEl) stampEl.textContent = stampSaid;
    paintVolume(pulse);
    paintOi(pulse);
    paintImpact(pulse);
    paintInsiders(pulse);
    paintDark(pulse);
    paintSeason(pulse);
    const foot = $("mkPulseFoot");
    if (foot) foot.textContent = (pulse.notes && pulse.notes.refusals) || "";
  }

  const newGate = (host, feed, what, height) => {
    if (!feed) { host.append(emptyLine("unreadable", "The request for " + what + " did not come back; reload before reading anything into its absence.", what, height)); return true; }
    if (unreadable(feed)) { host.append(unreadableLine(feed, what)); return true; }
    if (feed.status === "pending") { host.append(emptyLine("pending", "The pipeline has not published " + what + " yet; the key fills on the first nightly run that writes it.", what, height)); return true; }
    return false;
  };

  function pathOf(p) {
    return p && Array.isArray(p.pts) ? p.pts.map((x) => (Array.isArray(x) ? isNum(x[1]) : null)) : [];
  }

  const TIDE_SHORT = { "Consumer Cyclical": "Cyclicals", "Consumer Defensive": "Defensives", "Communication Services": "Comms",
    "Financial Services": "Financials", "Basic Materials": "Materials" };

  function paintSectorTides(regime, breadth) {
    const host = clear("mkSecTides");
    if (!host) return;
    const lb = breadth && !pendingOf(breadth) && !unreadable(breadth) && breadth.sectors && breadth.sectors.rows ? breadth : null;
    const reg = regime && !pendingOf(regime) && !unreadable(regime) && regime.sectors && regime.sectors.status === "ok" ? regime : null;
    const useLive = lb && (!reg || !reg.sessionDate || (lb.session && lb.session >= reg.sessionDate));
    const cells = [];
    if (useLive) {
      for (const [name, r] of Object.entries(lb.sectors.rows)) {
        if (!r || r.status !== "ok" || !Array.isArray(r.net)) { cells.push({ name, etf: r && r.etf, net: null, path: [], why: r && r.reason }); continue; }
        const path = r.net.map(isNum);
        cells.push({ name, etf: r.etf, net: path.filter((x) => x !== null).pop() ?? null, path });
      }
    } else if (reg) {
      for (const r of reg.sectors.rows || []) cells.push({ name: r.sector, etf: null, net: r.status === "ok" ? isNum(r.net) : null, path: pathOf(r.path), why: r.reason });
    }
    if (!cells.length) {
      if (!newGate(host, regime, "the sector tides", 160)) host.append(emptyLine("unavailable", "Neither the regime key nor the live breadth layer carried sector tides.", "sector tides", 160));
      return;
    }
    cells.sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity));
    const peak = Math.max(1, ...cells.map((c) => Math.max(...c.path.filter((x) => x !== null).map(Math.abs), 0)));
    const grid = h("div", { class: "mk-smalls" });
    host.append(grid);
    for (const c of cells) {
      const cell = h("div", { class: "mk-small", "data-tone": toneOf(c.net) },
        h("div", { class: "mk-small-h" }, h("span", { class: "mk-small-n", title: c.name }, TIDE_SHORT[c.name] || c.name),
          h("b", { "data-tone": toneOf(c.net) }, c.net === null ? DASH : usdS(c.net))));
      const plot = h("div", { class: "mk-small-p" });
      cell.append(plot);
      grid.append(cell);
      if (c.path.filter((x) => x !== null).length >= 2) {
        C.line(plot, { series: [{ values: c.path, format: usdS }], twoTone: true, zero: true, yDomain: [-peak, peak], height: 56,
          xAxis: false, yTicks: false, endLabels: false, gutter: 4, label: c.name + " sector tide", readout: (i) => [C.part(c.name, "k"), h("b", { "data-tone": toneOf(c.path[i]) }, c.path[i] === null ? DASH : usdS(c.path[i]))] });
      } else {
        plot.append(h("div", { class: "mk-small-none" }, DASH, inlineHush("unavailable", c.why || "No path was carried for this sector.", c.name)));
      }
    }
    staleMark("mkSecTidesCard", useLive ? lb.session : reg && reg.sessionDate, "sector tides");
    infoInto("mkSecTidesCard", "sector tides", () => ({
      title: "Sector tides", lead: "Net option premium through the session for each of the eleven sectors, on one shared scale so heights compare.",
      facts: [["Source", useLive ? "live:breadth" : "regime"], ["Scale", "±" + usd(peak)]],
      notes: ["Net is net call premium minus net put premium, cumulative; the vendor's sector tide is assumed cumulative, and the session value is the last row."],
    }));
  }

  function paintEtfs(regime, live, breadth) {
    const reg = regime && !pendingOf(regime) && !unreadable(regime) ? regime : null;
    const lv = live && !pendingOf(live) && !unreadable(live) ? live : null;
    const lb = breadth && !pendingOf(breadth) && !unreadable(breadth) ? breadth : null;
    const tideOf = (T) => {
      const liveSer = T === "IWM" ? lb && lb.etf && lb.etf.IWM : lv && lv.etf && lv.etf[T];
      const regRow = reg && reg.etfTide && reg.etfTide.byEtf ? reg.etfTide.byEtf[T] : null;
      if (liveSer && liveSer.status === "ok" && Array.isArray(liveSer.net) && (!reg || !reg.sessionDate || ((T === "IWM" ? lb.session : lv.session) >= reg.sessionDate))) {
        const path = liveSer.net.map(isNum);
        return { regRow, path, net: path.filter((x) => x !== null).pop() ?? null, src: T === "IWM" ? "live:breadth" : "live:market", session: T === "IWM" ? lb.session : lv.session };
      }
      if (regRow && regRow.status === "ok") return { regRow, path: pathOf(regRow.path), net: isNum(regRow.net), src: "regime", session: reg.sessionDate };
      return { regRow, path: [], net: null, src: null, session: null };
    };
    const tides = { SPY: tideOf("SPY"), QQQ: tideOf("QQQ"), IWM: tideOf("IWM") };
    const seen = Object.values(tides).flatMap((t) => t.path.filter((x) => x !== null));
    const lo = Math.min(0, ...seen), hi = Math.max(0, ...seen), pad = (hi - lo) * 0.08 || 1;
    const shared = [lo - (lo < 0 ? pad : 0), hi + pad];
    for (const T of ["SPY", "QQQ", "IWM"]) {
      const host = clear("mkEtf" + T);
      if (!host) continue;
      const { regRow, path, net, src, session } = tides[T];
      const curve = reg && reg.volCurve && reg.volCurve.byIndex ? reg.volCurve.byIndex[T] : null;
      const iv30 = curve && Array.isArray(curve.iv) && Array.isArray(curve.tenors) ? isNum(curve.iv[curve.tenors.indexOf(30)]) : null;
      const flow = reg && reg.fundFlows && reg.fundFlows.byEtf ? reg.fundFlows.byEtf[T] : null;
      const f20 = flow && flow.status === "ok" ? isNum(flow.cum20Usd) : null;
      const z20 = flow && flow.status === "ok" ? isNum(flow.z20) : null;
      if (src === null && !curve && !flow) {
        if (!newGate(host, regime, "the " + T + " tide", 150)) host.append(emptyLine("unavailable", "No tide was carried for " + T + ".", T + " tide", 150));
        continue;
      }
      const pend = (what) => ({ state: "pending", reason: what + " arrives with the regime key." });
      host.append(UI.metrics([
        UI.metric("Net premium", net === null ? DASH : usdS(net), { tone: toneOf(net), state: net === null ? pend("The ETF tide") : null }),
        UI.metric("Fund flow 20d", f20 === null ? DASH : usdS(f20), { tone: toneOf(f20), sub: z20 === null ? null : "z " + F.signed(z20, 1), state: f20 === null ? pend("The creation and redemption flow") : null }),
        UI.metric("IV 30d", iv30 === null ? DASH : F.pct(iv30, 1), { state: iv30 === null ? pend("The fixed-tenor IV") : null }),
      ], { min: 84 }));
      const plot = h("div", { class: "mk-etf-p" });
      host.append(plot);
      if (path.filter((x) => x !== null).length >= 2) {
        C.line(plot, { series: [{ values: path, format: usdS }], twoTone: true, zero: true, yDomain: shared, height: 84, xAxis: false, yTicks: false, gutter: 60,
          label: T + " options tide", readout: (i) => [C.part(T, "k"), h("b", { "data-tone": toneOf(path[i]) }, path[i] === null ? DASH : usdS(path[i]))] });
      }
      staleMark("mkEtf" + T + "Card", session, T);
      infoInto("mkEtf" + T + "Card", T.toLowerCase(), () => ({
        title: T, lead: "The ETF's own options tide, its creation and redemption flow, and its fixed-tenor implied volatility.",
        facts: [["Tide source", src || DASH], ["Session", session], ["Scale", "shared by SPY, QQQ and IWM, " + usdS(shared[0]) + " to " + usdS(shared[1])], ["Own net premium", regRow ? usdS(regRow.ownNet) : null],
          ["Constituents agree", regRow && typeof regRow.agree === "boolean" ? (regRow.agree ? "yes" : "no") : null],
          ["Creations today", flow && flow.status === "ok" ? usdS(flow.changeUsd) : null], ["20-session z", z20 === null ? (flow && flow.reason) || null : F.signed(z20, 2)]],
        notes: ["The dossier opens the full reader for " + T + "."],
      }));
    }
  }

  function paintExpiry(regime, breadth) {
    const host = clear("mkExpiry");
    if (!host) return;
    const reg = regime && !pendingOf(regime) && !unreadable(regime) && regime.zeroDte && regime.zeroDte.status === "ok" ? regime.zeroDte : null;
    const lb = breadth && !pendingOf(breadth) && !unreadable(breadth) && breadth.dte ? breadth.dte : null;
    const useLive = lb && lb.share && isNum(lb.share.value) !== null && (!regime || !regime.sessionDate || (breadth.session && breadth.session >= regime.sessionDate));
    const share = useLive ? isNum(lb.share.value) : reg ? isNum(reg.share) : null;
    const zero = useLive ? isNum(lb.share.zeroNet) : reg ? isNum(reg.np0) : null;
    const weekly = useLive ? isNum(lb.share.weeklyNet) : reg ? isNum(reg.npw) : null;
    if (share === null && zero === null) {
      if (!newGate(host, regime, "net flow by expiry", 200)) host.append(emptyLine("unavailable", "Neither source carried a 0DTE share.", "net flow by expiry", 200));
      return;
    }
    const livePath = useLive && lb.zero && lb.zero.status === "ok" && Array.isArray(lb.zero.t) && Array.isArray(lb.zero.net) ? lb.zero : null;
    const gauge = C.gauge({ value: share === null ? null : share * 100, max: 100, arc: 180, size: 150, stroke: 10, color: "--s-orange",
      text: share === null ? DASH : Math.round(share * 100) + "%", label: "0DTE share of net premium" });
    host.append(h("div", { class: "mk-expiry-top" }, h("div", { class: "mk-gauge" }, gauge, h("span", null, "0DTE share")),
      UI.metrics([
        UI.metric("0DTE net", usdS(zero), { tone: toneOf(zero) }),
        UI.metric("Weekly net", usdS(weekly), { tone: toneOf(weekly) }),
        useLive ? null : UI.metric("Equities", reg && isNum(reg.equityShare) !== null ? F.pct(reg.equityShare, 0) : DASH, { sub: "of 0DTE", state: reg && isNum(reg.equityShare) !== null ? null : { state: "pending", reason: "The equity and index split arrives with the regime key." } }),
      ].filter(Boolean), { min: 90 })));
    const pts = useLive ? [] : reg && reg.path && Array.isArray(reg.path.pts) ? reg.path.pts : [];
    if (livePath && livePath.t.length >= 2) {
      const plot = h("div", { class: "mk-expiry-p" });
      host.append(plot);
      const ax = timeAxis(livePath.t);
      const net = livePath.t.map((_, i) => isNum(livePath.net[i]));
      C.line(plot, { x: ax.x, xType: ax.xType, xTicks: ax.ticks(0), xFormat: (x) => String(x), series: [{ values: net, format: usdS }],
        twoTone: true, zero: true, height: [120, 130, 140], yFormat: usdS, label: "0DTE net premium through the session",
        readout: (i) => [C.part(clock(livePath.t[i]), "k"), h("b", { "data-tone": toneOf(net[i]) }, net[i] === null ? DASH : usdS(net[i]))] });
    } else if (pts.length >= 2) {
      const plot = h("div", { class: "mk-expiry-p" });
      host.append(plot);
      const x = pts.map((p) => isNum(p[0]));
      const t0 = Date.parse(reg.path.t0);
      const at = (m) => (Number.isFinite(t0) && m !== null ? new Date(t0 + m * 60000).toISOString() : null);
      const mins = x.map((m) => nyMinutes(at(m)));
      const ok = mins.every((m, i) => m !== null && (i === 0 || m > mins[i - 1]));
      C.line(plot, { x: ok ? mins : x, xType: "number", xTicks: ok ? hourTicks(mins[0], mins[mins.length - 1], 2) : undefined, xFormat: (m) => String(m),
        series: [{ values: pts.map((p) => isNum(p[1])), format: usdS }], twoTone: true, zero: true, height: [120, 130, 140],
        yFormat: usdS, label: "0DTE net premium through the session",
        readout: (i) => [C.part(clock(at(x[i])), "k"), h("b", { "data-tone": toneOf(pts[i][1]) }, usdS(pts[i][1])), C.part("SPY " + (isNum(pts[i][2]) === null ? DASH : isNum(pts[i][2]).toFixed(2)), "k")] });
    }
    staleMark("mkExpiryCard", useLive ? breadth.session : regime && regime.sessionDate, "net flow by expiry");
    infoInto("mkExpiryCard", "expiry", () => ({
      title: "Expiry", lead: "How much of the session's net option premium sat in contracts expiring the same day, against the weekly expiries.",
      facts: [["Source", useLive ? "live:breadth" : "regime"], ["0DTE net", usdS(zero)], ["Weekly net", usdS(weekly)], ["Index 0DTE net", reg ? usdS(reg.index) : null], ["Equity 0DTE net", reg ? usdS(reg.equity) : null]],
      notes: ["The share is |0DTE net| over |0DTE net| plus |weekly net|, on the last cumulative values.", reg && reg.rule ? reg.rule : null],
    }));
  }

  function paintVol(regime, liveVol) {
    const host = clear("mkVol");
    if (!host) return;
    const reg = regime && !pendingOf(regime) && !unreadable(regime) ? regime : null;
    const curve = reg && reg.volCurve && reg.volCurve.byIndex ? reg.volCurve.byIndex : null;
    const lv = liveVol && !pendingOf(liveVol) && !unreadable(liveVol) && liveVol.index ? liveVol : null;
    const useLive = lv && (!reg || !reg.sessionDate || (lv.session && lv.session >= reg.sessionDate));
    const TEN = [1, 5, 7, 14, 30, 60, 90, 180, 365];
    const idx = {};
    for (const k of ["SPY", "QQQ", "IWM"]) {
      if (useLive && lv.index[k] && lv.index[k].status === "ok") {
        const r = lv.index[k];
        idx[k] = { iv: TEN.map((d) => isNum(r["v" + d])), iv30: isNum(r.iv30), ivp: isNum(r.ivRank), ivpWord: "rank", rv: isNum(r.rv), rvWord: "RV",
          ts: isNum(r.v30) !== null && isNum(r.v90) ? r.v30 / r.v90 - 1 : null };
      } else if (curve && curve[k] && curve[k].status === "ok" && Array.isArray(curve[k].iv)) {
        const r = curve[k], ten = Array.isArray(r.tenors) ? r.tenors : TEN;
        idx[k] = { iv: TEN.map((d) => { const j = ten.indexOf(d); return j < 0 ? null : isNum(r.iv[j]); }), iv30: isNum(r.iv[ten.indexOf(30)]),
          ivp: isNum(r.ivp), ivpWord: "pct", rv: isNum(r.rv20), rvWord: "RV 20d", ts: isNum(r.ts), shape: r.shape || null };
      }
    }
    const names = Object.keys(idx);
    if (!names.length) {
      if (!newGate(host, regime, "the index volatility curve", 240)) host.append(emptyLine("pending", "The live volatility layer has not published a curve yet.", "volatility", 240));
      return;
    }
    const spy = idx.SPY || idx[names[0]];
    const shape = spy.shape || (spy.ts === null ? null : spy.ts < 0 ? "contango" : spy.ts > 0 ? "backwardation" : "flat");
    const ic = reg && reg.impliedCorrelation && reg.impliedCorrelation.byIndex ? reg.impliedCorrelation.byIndex : {};
    const rho = ic.SPY && ic.SPY.status === "ok" ? ic.SPY : null;
    const vrp = spy.iv30 !== null && spy.rv !== null ? spy.iv30 - spy.rv : null;
    const pend = (what) => ({ state: "pending", reason: what + " arrives with the regime key, which has not published yet." });
    host.append(UI.metrics([
      UI.metric("IV 30d", spy.iv30 === null ? DASH : F.pct(spy.iv30, 1), { sub: "SPY" + (spy.ivp === null ? "" : " · " + spy.ivpWord + " " + Math.round(spy.ivp)) }),
      UI.metric(spy.rvWord, spy.rv === null ? DASH : F.pct(spy.rv, 1), { sub: vrp === null ? null : "IV − RV " + F.pts(vrp) + " pts" }),
      UI.metric("Term", shape ? cap1(shape) : DASH, { tone: shape === "backwardation" ? "warn" : null, sub: spy.ts === null ? null : "30/90 " + F.pct(spy.ts, 1, true) }),
      UI.metric("Correlation", rho ? isNum(rho.rho).toFixed(2) : DASH, { sub: rho && isNum(rho.dispersion) !== null ? "dispersion " + F.pts(rho.dispersion) + " pts" : null, state: rho ? null : pend("Implied correlation") }),
    ], { min: 100 }));
    const COL = { SPY: "--s-blue", QQQ: "--s-purple", IWM: "--s-teal" };
    const plot = h("div", { class: "mk-term" });
    host.append(plot, UI.legend(names.map((k) => [COL[k], "ln", k])));
    C.line(plot, {
      x: TEN, xType: "number", xScale: "sqrt", height: [180, 210, 230],
      xTicks: [{ v: 7, label: "1w" }, { v: 30, label: "1m" }, { v: 90, label: "3m" }, { v: 180, label: "6m" }, { v: 365, label: "1y" }],
      series: names.map((k) => ({ values: idx[k].iv, color: COL[k], label: k, format: (x) => F.pct(x, 1) })),
      yFormat: (x) => F.pct(x, 0), label: "Implied volatility by tenor for the index ETFs",
      readout: (i) => [C.part(TEN[i] + "d", "k")].concat(names.map((k) => C.part(k + " " + F.pct(idx[k].iv[i], 1), null))),
    });
    staleMark("mkVolCard", useLive ? lv.session : reg && reg.sessionDate, "volatility");
    infoInto("mkVolCard", "volatility", () => ({
      title: "Volatility", lead: "The index ETFs' fixed-tenor implied volatility stands in for the VIX curve, which the vendor plan does not serve.",
      facts: [["Source", useLive ? "live:vol" : "regime"], ["Implied correlation QQQ", ic.QQQ && ic.QQQ.status === "ok" ? isNum(ic.QQQ.rho).toFixed(3) : DASH],
        ["SPY coverage", rho ? F.pct(rho.coverage, 0) : null], ["Holdings as of", rho ? rho.weightsAsOf : null]],
      notes: ["Contango (a rising curve) is the calm shape; an inverted front is stress.",
        "Implied correlation is the index variance left after the members' own variances, over what perfect correlation would add; dispersion is the members' weighted 30-day IV less the index's, in volatility points."],
    }));
  }

  function paintRadar(regime) {
    const host = clear("mkRadar");
    const segHost = clear("mkRadarSeg");
    if (!host) return;
    const radar = regime && !pendingOf(regime) && !unreadable(regime) && regime.volRadar ? regime.volRadar : null;
    if (!radar || radar.status === "pending") {
      if (!newGate(host, regime, "the volatility radar", 240)) host.append(emptyLine("pending", "The volatility radar has not been published yet.", "volatility radar", 240));
      return;
    }
    const SIDES = [["rich", "Rich", "short"], ["cheap", "Cheap", "long"], ["bullish", "Bullish", "up"], ["bearish", "Bearish", "down"]];
    let active = 0;
    const body = h("div", { class: "mk-radar" });
    host.append(body);
    const draw = () => {
      const [key, word, tone] = SIDES[active];
      const side = radar[key];
      body.replaceChildren();
      if (!side || side.status !== "ok" || !Array.isArray(side.rows) || !side.rows.length) {
        body.append(emptyLine(side && side.status === "quiet" ? "quiet" : "unavailable", (side && (side.reason || side.code)) || "This side of the radar carried no rows.", word.toLowerCase() + " names", 200));
        return;
      }
      const top = Math.max(1e-9, ...side.rows.map((r) => Math.abs(isNum(r.score) || 0)));
      body.append(UI.list(side.rows.map((r, i) => {
        const kids = [
          h("span", { class: "ui-row-m" }, h("b", null, r.t), h("span", null, key === "rich" || key === "cheap"
            ? (isNum(r.n) === null ? "" : r.n + " signals") : "sentiment")),
          h("span", { class: "ui-meter" }, h("i", { style: { "--w": (Math.abs(isNum(r.score) || 0) / top * 100).toFixed(1) + "%", "--i": String(i),
            "--c": UI.cssVar(tone === "short" ? "--g-short" : tone === "long" ? "--g-long" : tone === "up" ? "--up-mark" : "--down-mark") } })),
          h("span", { class: "ui-row-v", "data-tone": tone }, signed(r.score, 1)),
        ];
        return r.carded ? h("a", { class: "ui-row mk-rrow", href: "/flows/ticker/?t=" + encodeURIComponent(r.t) }, kids) : h("div", { class: "ui-row mk-rrow", role: "listitem" }, kids);
      }), { visible: 6, label: word + " names on the volatility radar" }));
    };
    draw();
    if (segHost) segHost.append(UI.segmented("Radar side", SIDES.map((s) => ({ label: s[1], disabled: !radar[s[0]] })), (i) => { active = i; draw(); }, 0));
    staleMark("mkRadarCard", radar.asOf || regime.sessionDate, "volatility radar");
    infoInto("mkRadarCard", "radar", () => ({
      title: "Volatility radar", lead: "The vendor's anomaly screen ranks names whose options are rich or cheap against their own history; its sentiment screen ranks bullish and bearish positioning.",
      facts: [["As of", radar.asOf], ["Kept per side", count(radar.keep)]],
      notes: ["Rich and cheap use the dealer-regime colours rather than green and red: rich volatility is not bearish.", "A linked name has a card today and opens its reader."],
    }));
  }

  function paintGroups(regime) {
    const host = clear("mkGroups");
    if (!host) return;
    const groups = regime && !pendingOf(regime) && !unreadable(regime) && regime.groups && regime.groups.status === "ok" ? regime.groups.rows || [] : null;
    if (!groups) {
      if (!newGate(host, regime, "the group flows", 200)) host.append(emptyLine("unavailable", "The regime key carried no group flows.", "group flows", 200));
      return;
    }
    const rows = groups.filter((g) => g && g.status === "ok");
    const peak = Math.max(1, ...rows.map((g) => Math.abs(isNum(g.delta) || 0)));
    const list = h("ul", { class: "mk-sectors mk-groups" });
    rows.sort((a, b) => (isNum(b.delta) || 0) - (isNum(a.delta) || 0)).forEach((g) => {
      const d = isNum(g.delta);
      const tr = track(d, peak);
      tr.setAttribute("role", "img");
      tr.setAttribute("aria-label", g.group + " delta flow " + F.num(d, true));
      list.append(h("li", { class: "mk-sector" }, h("span", { class: "mk-sector-k", title: g.group, "data-short": NARROW[g.group] || null },
        h("span", { class: "mk-k-full" }, cap1(g.group === "mag7" ? "Mag 7" : g.group))), tr,
        h("span", { class: "mk-sector-v", "data-tone": toneOf(d) }, F.num(d, true), h("small", { class: "mk-unit" }, " Δ"))));
    });
    host.append(list);
    staleMark("mkGroupsCard", regime.sessionDate, "group flows");
    infoInto("mkGroupsCard", "groups", () => ({
      title: "Groups", lead: "Customer-signed delta flow for the session by industry group: positive is delta bought.",
      node: table("Group flows", [["Group"], ["Delta", true], ["Vega", true], ["Net premium", true], ["Purity", true]],
        rows.map((g) => [g.group, F.num(g.delta, true), F.num(g.vega, true), usdS(g.net), F.pct(g.purity, 0)])),
      notes: ["Purity is the directional delta over total delta traded: how one-sided the group's flow was."],
    }));
  }

  function paintUniverse(universe) {
    const host = clear("mkAdv");
    if (!host) return;
    const u = universe && !pendingOf(universe) && !unreadable(universe) && universe.status === "ok" ? universe : null;
    const col = u && u.cols && Array.isArray(u.cols.chg) ? u.cols.chg : null;
    const scale = u && u.units && u.units.chg ? isNum(u.units.chg[1]) : null;
    if (!col || !scale) {
      if (!newGate(host, universe, "the universe", 200)) host.append(emptyLine("unavailable", (u && u.reason) || "The universe carried no price change column.", "advancers", 200));
      return;
    }
    const chg = col.map((c) => (isNum(c) === null ? null : c / scale)).filter((v) => v !== null);
    const up = chg.filter((v) => v > 0).length, down = chg.filter((v) => v < 0).length, flat = chg.length - up - down;
    const edges = [];
    for (let e = -0.05; e <= 0.0501; e += 0.005) edges.push(+e.toFixed(3));
    const bins = new Array(edges.length + 1).fill(0);
    for (const v of chg) {
      let i = edges.findIndex((e) => v < e);
      if (i < 0) i = edges.length;
      bins[i]++;
    }
    const labels = bins.map((_, i) => (i === 0 ? "< " + F.pct(edges[0], 1, true) : i === edges.length ? "> " + F.pct(edges[edges.length - 1], 1, true) : F.pct(edges[i - 1], 1, true)));
    host.append(UI.metrics([
      UI.metric("Advancers", String(up), { tone: "up", sub: chg.length ? F.pct(up / chg.length, 0) : null }),
      UI.metric("Decliners", String(down), { tone: "down", sub: chg.length ? F.pct(down / chg.length, 0) : null }),
      UI.metric("Unchanged", String(flat)),
    ], { min: 90 }));
    const plot = h("div", { class: "mk-hist" });
    host.append(plot);
    const colors = bins.map((_, i) => (i <= edges.indexOf(0) ? "--down-mark" : "--up-mark"));
    C.bars(plot, { values: bins, labels, colors, height: [140, 150, 160], maxWidth: 16,
      label: "Distribution of the session's price change across the screened universe",
      readout: (i) => [C.part(labels[i], "k"), h("b", null, bins[i] + " names")] });
    staleMark("mkAdvCard", u.sessionDate, "advancers");
    infoInto("mkAdvCard", "advancers", () => ({
      title: "Advancers", lead: "The session's price change for every eligible name in the screened universe, in half-point bins.",
      facts: [["Names", String(chg.length)], ["Screened", count(u.screened)], ["Session", u.sessionDate]],
      notes: ["Eligibility: price at least $5, market cap at least $1B, option volume at least 1,000 and open interest at least 5,000; ETFs, indexes and ADRs excluded."],
    }));
  }

  function textInfo(sectionId, label, host, title, extra) {
    infoInto(sectionId, label, () => {
      const d = (host && host.dataset) || {};
      return Object.assign({ title, lead: d.lead || null, sections: [{ title: "Read with care", lines: d.qual ? [d.qual] : [] }], notes: [d.note, d.pop] }, extra ? extra() : {});
    });
  }

  let marketUpdatedAt = null;

  function get(path, soon) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => {
        if (r.status === 401) { location.replace("/flows/"); return null; }
        if (soon && r.status === 404) return { status: "pending", __route: 404 };
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (path === "/api/flows/market") {
          const stamp = r.headers.get("X-Payload-Updated");
          const ms = stamp === null || stamp === "" ? null : Number(stamp);
          marketUpdatedAt = ms !== null && Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        return r.json();
      });
  }
  function optional(path, soon) {
    return get(path, soon).catch((error) => ({ __unreadable: true, __path: path, __reason: error && error.message ? error.message : String(error) }));
  }

  function marketSilence(line) {
    for (const id of ["mktTilt", "mktBreadth", "mktTape"]) {
      const host = clear(id);
      if (host) host.append(line.cloneNode(true));
    }
  }

  function setStale(verdict) {
    const staleEl = $("mktStale");
    const message = (verdict && verdict.message) || "";
    if (staleEl) {
      staleEl.hidden = !message;
      staleEl.textContent = message;
      if (message) staleEl.setAttribute("data-stale", (verdict && verdict.kind) || "stale");
      else staleEl.removeAttribute("data-stale");
    }
    document.body.classList.toggle("is-stale", Boolean(message));
    const pill = $("mkStalePill");
    if (pill) {
      pill.replaceChildren();
      if (message) pill.append(h("button", { class: "mk-pill", type: "button", "data-state": "stale", "aria-haspopup": "dialog", "aria-controls": "fxPop",
        "data-info": disclose("Freshness", message, { state: "stale" }) }, glyph("clock"), h("span", null, "Stale")));
    }
  }

  Promise.all([
    optional("/api/flows/market"),
    optional("/api/flows/sectors"),
    optional("/api/flows/movers"),
    optional("/api/flows/pulse"),
    optional("/api/flows/board?side=long"),
    optional("/api/flows/board?side=short"),
    optional("/api/flows/regime", true),
    optional("/api/flows/universe", true),
    optional("/api/flows/lk?k=market", true),
    optional("/api/flows/lk?k=breadth", true),
    optional("/api/flows/lk?k=vol", true),
  ]).then((all) => {
    const [m, sectors, movers, pulse, boardLong, boardShort, regime, universe, live, breadth, liveVol] = all;
    if (!m) return;
    if (typeof m === "object") m.__updatedAt = marketUpdatedAt;
    const n = unreadable(m) ? null : isNum(m.n);
    const level = unreadable(m) ? "unreadable" : m.status === "pending" || n === null ? "pending" : "ok";
    const meta = $("mkMeta");
    if (level !== "ok") {
      marketSilence(level === "unreadable" ? unreadableLine(m, "the market level (/api/flows/market)")
        : pendingLine("the market level", "It is built from the same screener response the board is drawn from, so it appears with the first pipeline run after it shipped."));
      if (statusEl) {
        statusEl.textContent = level === "unreadable" ? "The market level did not come back: " + m.__reason + "." : "No session has been measured yet.";
        statusEl.setAttribute("data-empty", level);
      }
      if (meta) meta.replaceChildren(h("span", { "data-empty": level }, level === "unreadable" ? "Market level unreadable " : "No session yet ",
        inlineHush(level, statusEl ? statusEl.textContent : "", "market level")));
    } else {
      if (statusEl) statusEl.removeAttribute("data-empty");
      setStale(typeof UI.staleness === "function" ? UI.staleness(m, Date.now(), { subject: "This market level" }) : null);
      paintTilt(m);
      paintBreadth(m);
      paintTape(m);
      const screened = isNum(m.screened);
      if (statusEl) {
        statusEl.textContent = n + " screened names" + (screened === null ? "" : " of " + screened + " returned by the ladder") +
          " · session " + (m.sessionDate || "unknown") + (Number.isFinite(Date.parse(m.generatedAt)) ? " · built " + utcStamp(new Date(m.generatedAt), true) : "");
      }
      if (meta) {
        meta.replaceChildren(
          h("time", { datetime: m.sessionDate || "" }, m.sessionDate ? F.day(m.sessionDate) : DASH),
          h("span", null, n + " screened"));
      }
      if (typeof m.sessionDate === "string") UI.freshness({ sessionDate: m.sessionDate, generatedAt: m.generatedAt, updatedAt: m.__updatedAt, source: "market" });
      const notes = m.notes || {};
      const foot = $("mktFoot");
      if (foot) foot.textContent = [notes.population, notes.presence, notes.weighting, notes.refused].filter(Boolean).join(" ");
    }
    const tilt = $("mktTilt"), breadthHost = $("mktBreadth");
    textInfo("mkBreadthCard", "breadth", tilt, "Breadth", () => ({
      lead: [tilt && tilt.dataset.lead, breadthHost && breadthHost.dataset.lead].filter(Boolean).join(" ") || null,
      sections: [{ title: "Read with care", lines: [breadthHost && breadthHost.dataset.qual] }],
      notes: [tilt && tilt.dataset.note, breadthHost && breadthHost.dataset.note,
        ...[...document.querySelectorAll("#mktTilt .mk-tilt")].map((r) => r.dataset.note)],
    }));
    infoInto("mkTapeCard", "tape", () => {
      const rows = (() => { try { return JSON.parse(($("mktTape") || {}).dataset.rows || "[]"); } catch { return []; } })();
      const foot = $("mktFoot");
      return { title: "Tape", lead: "Seven aggregate readings over the screened universe; each names the population it was measured over.",
        notes: [foot && foot.textContent], node: table("Aggregate tape readings over the screened universe", [["Reading"], ["Value", true], ["Names", true]], rows) };
    });
    paintSectors(sectors);
    textInfo("mkSectorsCard", "momentum", $("mktSectors"), "Momentum");
    paintMovers(movers);
    textInfo("mkMoversCard", "extremes", $("mktMovers"), "Extremes", () => ({ notes: [($("mktMovers") || {}).dataset && $("mktMovers").dataset.pop,
      "Ranked over the whole screened universe, not over the board. Tickers here are plain text: a detail card exists only for the names the board went deep on."] }));
    paintAgainst([boardLong, boardShort], movers);
    textInfo("mkAgainstCard", "against the tape", $("mktAgainst"), "Against the tape", () => ({ notes: [
      "The board score is a residual — sector and size are divided out before the ranking — while these premium lists are the raw level, so the two are allowed to disagree; a name where they do is one to read twice, not a signal to fade."] }));
    paintPulse(pulse);
    paintTide(pulse, live);
    paintUniverse(universe);
    paintSectorTides(regime, breadth);
    paintEtfs(regime, live, breadth);
    paintExpiry(regime, breadth);
    paintVol(regime, liveVol);
    paintRadar(regime);
    paintGroups(regime);
    if (typeof UI.heartbeat === "function") {
      UI.heartbeat({ keys: ["market", "breadth"], nightly: ["pulse"], page: "market",
        onChange(changed) {
          const keys = Array.isArray(changed) ? changed.map(String) : [];
          if (keys.some((k) => /live:market/.test(k))) optional("/api/flows/lk?k=market", true).then((x) => { paintTide(pulse, x); paintEtfs(regime, x, breadth); });
          if (keys.some((k) => /live:breadth/.test(k))) optional("/api/flows/lk?k=breadth", true).then((x) => { paintSectorTides(regime, x); paintExpiry(regime, x); });
        } });
    }
  }).catch((error) => {
    if (statusEl) {
      statusEl.textContent = "This page failed while drawing: " + error.message;
      statusEl.setAttribute("data-empty", "unreadable");
    }
  });
})();
