(() => {
  "use strict";

  const statusEl = document.getElementById("mktStatus");
  const UI = window.FlowsUI;
  if (!UI) {
    if (statusEl) statusEl.textContent = "The shared UI library did not load, so this page cannot draw. Refresh to try again.";
    return;
  }
  const { h, F, isNum, DASH, MINUS, glyph } = UI;
  const C = UI.chart;
  const $ = (id) => document.getElementById(id);

  const signGlyph = (n) => (n < 0 ? MINUS : n > 0 ? "+" : "");
  const signed = F.unit.of("signed", { dp: 2 });
  const pct = F.unit.of("pct");
  const usd = F.unit.of("moneyCompact", { dp: "short" });
  const usdS = F.unit.of("moneyCompact", { dp: "short", signed: true });
  const tb = (v) => h("b", { "data-tone": toneOf(v) }, usdS(v));
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
    opening: ["clock", "Opening"],
    stale: ["clock", "Stale"],
  };
  const POP = { "aria-haspopup": "dialog", "aria-controls": "fxPop" };
  const disclose = (title, lead, more) => UI.info(() => Object.assign({ title, lead }, more || {}));

  function emptyLine(kind, text, what, height, said) {
    const [g, w] = KIND[kind] || KIND.unavailable;
    const word = said || w;
    return h("div", {
      class: "ui-silent mk-hush" + (height && height <= 72 ? " is-row" : ""), "data-empty": kind === "opening" || kind === "stale" ? null : kind, "data-state": kind, role: "note",
      "aria-label": word + ": " + (what || text), style: { "--silent-h": (height || 96) + "px" },
    }, glyph(g), h("div", { class: "ui-silent-t" }, word),
    h("button", { type: "button", ...POP, "data-info": disclose(cap1(what || word), text) }, "Why"));
  }

  function inlineHush(kind, text, label) {
    const [g, word] = KIND[kind] || KIND.unavailable;
    return h("button", {
      class: "ui-state mk-mark", type: "button", "data-empty": kind, "data-state": kind, title: word,
      "aria-label": word + ": " + label, ...POP,
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

  function chip(state, word, what, text) {
    return h("button", {
      class: "mk-chip mk-mark", type: "button", "data-state": state, title: word, "aria-label": word + ": " + what,
      ...POP, "data-info": disclose(cap1(what), text),
    }, glyph("clock"), h("span", null, word));
  }

  function staleMark(sectionId, session, what, calm) {
    const expected = UI.freshness.market().expected;
    if (!session || session >= expected) return headMark(sectionId, calm ? chip(calm.state, calm.word, what, calm.text) : null);
    headMark(sectionId, h("button", {
      class: "ui-state mk-mark", type: "button", "data-state": "stale", title: "Stale", "aria-label": "Stale: " + what,
      ...POP,
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
  const okFeed = (feed) => (feed && !pendingOf(feed) && !unreadable(feed) ? feed : null);
  const nums = (arr) => (Array.isArray(arr) ? arr.map(isNum) : []);
  const drawn = (path) => path.filter((x) => x !== null).length;
  const lastOf = (path) => { for (let i = path.length - 1; i >= 0; i--) if (path[i] !== null) return path[i]; return null; };
  const newer = (day, reg) => !reg || !reg.sessionDate || (Boolean(day) && day >= reg.sessionDate);
  const readSeries = (s) => Boolean(s && s.status === "ok" && Array.isArray(s.net) && nums(s.net).some((x) => x !== null));
  const readAtOf = (f) => (f && f.fresh && typeof f.fresh.readAt === "string" ? f.fresh.readAt : f && typeof f.readAt === "string" ? f.readAt : null);
  const recent = (at) => UI.freshness.market().open && Date.now() - Date.parse(at) <= 15 * 60000;

  function liveSer(live, breadth, pick, minDay) {
    const all = [];
    for (const [feed, src] of [[okFeed(breadth), "live:breadth"], [okFeed(live), "live:market"]]) {
      const s = feed && pick(feed, src);
      if (readSeries(s)) all.push({ s, src, session: feed.session || null, at: readAtOf(feed), n: drawn(nums(s.net)) });
    }
    const top = all.reduce((d, c) => (c.session && (!d || c.session > d) ? c.session : d), minDay || null);
    const kept = all.filter((c) => !top || (c.session && c.session >= top));
    return kept.find((c) => c.n >= 2) || kept.sort((a, b) => b.n - a.n || String(b.at).localeCompare(String(a.at)))[0] || null;
  }

  const gap = (v, feed, row, what) => (v === null ? rowState(feed, row, what) : null);
  function rowState(feed, row, what) {
    if (!feed || pendingOf(feed)) return { state: "pending", reason: what + " arrives with the nightly build." };
    const why = row && row.reason ? " (" + row.reason + ")." : ".";
    return row && row.status === "quiet" ? { state: "quiet", reason: what + " was read and came back empty" + why }
      : { state: "unavailable", reason: what + " was not carried this session" + why };
  }

  const openingSaid = (at) => "The session's first reading" + (at ? ", at " + clock(at) + " ET," : "") +
    " is in. A line needs two, so the path draws from the next refresh.";
  const staleSaid = (at) => "The live layer holds one reading of this session" + (at ? ", at " + clock(at) + " ET" : "") +
    ", and has not written since. A line needs two, so no path is drawn.";
  const calmOf = (t, what) => (t.opening ? (recent(t.at) ? { state: "opening", word: "Opening", text: openingSaid(t.at) }
    : { state: "stale", word: t.at ? clock(t.at) : "Stale", text: staleSaid(t.at) })
    : t.fellBack && t.session ? { state: "dated", word: F.day(t.session), text: "Today's live " + what + " holds a single reading" +
      (t.at ? ", at " + clock(t.at) + " ET" : "") + ", too few for a path, so this is the " + F.day(t.session) + " session in full." } : null);

  function unreadableLine(feed, what) {
    return emptyLine("unreadable",
      "The request for " + what + " did not come back" + (feed && feed.__reason ? " (" + feed.__reason + ")" : "") +
      ": a failed read, not a statement about what the payload holds. Reload before reading the rest.", what);
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
        said = "Both weightings came back exactly level: the names split evenly and so did the dollars.";
      } else {
        said = (b === 0
          ? "Counting names, the session was exactly level while the dollars leaned " + (p > 0 ? "positive" : "negative")
          : "The dollars were exactly level while more names leaned " + (b > 0 ? "positive" : "negative")) +
          ", so the two weightings neither agree nor disagree.";
        how = "One weighting has a sign and the other does not, which is why both are drawn.";
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
      glyph(b === null || p === null ? "unavailable" : agree ? (p > 0 ? "up" : p < 0 ? "down" : "flat") : "flat"),
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

  const PULSE_QUIET = "The feed answered with nothing: ordinary before the open, a vendor silence after the close.";

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

  function tideViews(pulse, live, breadth) {
    const views = [];
    const P = okFeed(pulse);
    const pulseDay = P ? (P.readDay || P.sessionDate || null) : null;
    const series = (label, sr, src, day, min) => {
      if (views.some((v) => v.label === label) || !sr || sr.status !== "ok" || !Array.isArray(sr.t) || sr.t.length < (min || 2)) return;
      const at = (arr, i) => (Array.isArray(arr) ? isNum(arr[i]) : null);
      views.push({ label, src, day, t: sr.t, call: sr.t.map((_, i) => at(sr.ncp, i)), put: sr.t.map((_, i) => at(sr.npp, i)),
        net: sr.t.map((_, i) => at(sr.net, i)) });
    };
    const fromPts = (tide) => {
      const pts = tide && Array.isArray(tide.points) ? tide.points : [];
      const leg = (k) => pts.map((p) => isNum(p && p[k]));
      const c = leg("callPrem"), q = leg("putPrem");
      return { status: tide && (tide.status || "ok"), t: pts.map((p) => p && p.t), ncp: c, npp: q, net: c.map((x, i) => (x === null || q[i] === null ? null : x - q[i])) };
    };
    const lv = liveSer(live, null, (f) => f.tide, pulseDay);
    const prior = P && P.tide && P.tide.prior;
    for (const min of [2, 1]) {
      if (lv) series("Market", lv.s, "live:market", lv.session, min);
      if (P) series("Market", fromPts(P.tide), P.live ? "pulse + live:market" : "pulse", pulseDay, min);
      if (prior && min === 2) series("Market", fromPts(prior), "pulse", prior.date || null, 2);
    }
    const zero = liveSer(live, breadth, (f, src) => (src === "live:market" ? f.zeroDte : f.dte && f.dte.zero), pulseDay);
    if (zero) series("0DTE", zero.s, zero.src, zero.session);
    for (const T of ["SPY", "QQQ"]) {
      const e = liveSer(live, breadth, (f) => f.etf && f.etf[T], pulseDay);
      if (e) series(T, e.s, e.src, e.session);
    }
    return { views, today: lv && lv.session };
  }

  let tideChart = null;
  let tideLabel = null;

  function paintTide(pulse, live, breadth) {
    const host = $("mkTide");
    const legs = clear("mkTideLegs");
    const seg = clear("mkTideSeg");
    if (!host) return;
    const drop = () => { if (tideChart) { tideChart.destroy(); tideChart = null; } host.replaceChildren(); };
    const { views, today } = tideViews(pulse, live, breadth);
    headMark("mkTideCard", null);
    if (!views.length) {
      drop();
      if (unreadable(pulse)) host.append(unreadableLine(pulse, "the market pulse (/api/flows/pulse)"));
      else if (pendingOf(pulse)) host.append(pendingLine("the market tide", "The live market layer and the pulse both fill during market hours."));
      else host.append(feedSilence(pulse.tide, "market tide"));
      return;
    }
    let active = Math.max(0, views.findIndex((v) => v.label === tideLabel));
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
      const kept = v.t.length >= 2 && tideChart && tideChart.el.isConnected && tideChart.el.parentNode === host ? tideChart : null;
      if (!kept) drop();
      const dated = v.day && today && v.day < today;
      headMark("mkTideCard", dated ? chip("dated", F.day(v.day), "tide", "Today's live tide holds too few readings for a path, so this is the " + F.day(v.day) + " session in full.") : null);
      if (v.t.length < 2) {
        const fresh = recent(v.t[0]);
        host.append(emptyLine(fresh ? "opening" : "stale", fresh ? openingSaid(v.t[0]) : staleSaid(v.t[0]), v.label.toLowerCase() + " tide", 180, fresh ? null : clock(v.t[0])));
        return;
      }
      const opts = {
          x: ax.x, xType: ax.xType, xTicks: ax.ticks(host.clientWidth || 600), xFormat: (x) => clock(x), zero: true, height: [220, 260, 300],
          series: [
            { values: v.call, color: "--up", label: "Net calls", format: usdS },
            { values: v.put, color: "--down", label: "Net puts", dash: true, format: usdS },
          ],
          yFormat: usdS, label: v.label + " tide: net call and net put premium across the session",
          readout: (i) => [C.part(clock(v.t[i]), "k"), C.part("Calls", "k"), h("b", { "data-tone": "up" }, usdS(v.call[i])),
            C.part("Puts", "k"), h("b", { "data-tone": "down" }, usdS(v.put[i])),
            C.part("Net " + (usdS(v.net[i])), "k")],
      };
      if (kept) { kept.set(opts); return; }
      const plot = h("div", { class: "mk-river" });
      host.append(plot, UI.legend([["--up", "ln", "Net calls"], ["--down", "ln", "Net puts"]]));
      tideChart = C.line(plot, opts);
    };
    if (seg && views.length > 1) seg.append(UI.segmented("Tide", views.map((v) => ({ label: v.label })), (i) => { active = i; tideLabel = views[i].label; draw(); }, active));
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

  function pulseStampOf(pulse) {
    stampSaid = "";
    if (unreadable(pulse) || !pulse || pulse.status === "pending") return;
    stampSaid = pulseStamp(pulse.readAt, pulse.refreshed, pulse.cadenceMinutes);
    const stampEl = $("mkPulseStamp");
    if (stampEl) stampEl.textContent = stampSaid;
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
    const lb = okFeed(breadth) && breadth.sectors && breadth.sectors.rows && typeof breadth.sectors.rows === "object" ? breadth : null;
    const reg = okFeed(regime) && regime.sectors && regime.sectors.status === "ok" && Array.isArray(regime.sectors.rows) ? regime : null;
    const liveCells = lb && newer(lb.session, reg) ? Object.entries(lb.sectors.rows).map(([name, r]) => {
      const path = r && r.status === "ok" ? nums(r.net) : [];
      return { name, net: lastOf(path), path, why: r && r.reason };
    }) : [];
    const nightCells = reg ? reg.sectors.rows.filter(Boolean).map((r) => ({ name: r.sector, net: r.status === "ok" ? isNum(r.net) : null, path: pathOf(r.path), why: r.reason })) : [];
    const liveDrawn = liveCells.some((c) => drawn(c.path) >= 2);
    const liveRead = liveCells.some((c) => c.net !== null);
    const useLive = liveCells.length && (liveDrawn || !nightCells.length);
    const cells = useLive ? liveCells : nightCells;
    const opening = useLive && !liveDrawn && liveRead;
    const fellBack = !useLive && liveRead;
    if (!cells.length) {
      if (!newGate(host, regime, "the sector tides", 160)) host.append(emptyLine("unavailable", "Neither the regime key nor the live breadth layer carried sector tides.", "sector tides", 160));
      headMark("mkSecTidesCard", null);
      return;
    }
    const liveTs = lb && Array.isArray(lb.sectors.t) ? lb.sectors.t : [];
    cells.sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity));
    const peak = Math.max(1, ...cells.map((c) => Math.max(...c.path.filter((x) => x !== null).map(Math.abs), 0)));
    const grid = h("div", { class: "mk-smalls" });
    host.append(grid);
    for (const c of cells) {
      const cell = h("div", { class: "mk-small", "data-tone": toneOf(c.net) },
        h("div", { class: "mk-small-h" }, h("span", { class: "mk-small-n", title: c.name }, TIDE_SHORT[c.name] || c.name),
          tb(c.net)));
      const plot = h("div", { class: "mk-small-p" });
      cell.append(plot);
      grid.append(cell);
      if (drawn(c.path) >= 2) {
        C.line(plot, { series: [{ values: c.path, format: usdS }], twoTone: true, zero: true, yDomain: [-peak, peak], height: 56,
          xAxis: false, yTicks: false, endLabels: false, gutter: 4, label: c.name + " sector tide", readout: (i) => [C.part(c.name, "k"), tb(c.path[i])] });
      } else if (opening && c.net !== null) {
        plot.append(h("div", { class: "mk-small-open", "aria-hidden": "true" }, h("i", { "data-tone": toneOf(c.net) })));
      } else {
        plot.append(h("div", { class: "mk-small-none" }, DASH, inlineHush("unavailable", c.why || "No path was carried for this sector.", c.name)));
      }
    }
    const session = useLive ? lb.session : reg && reg.sessionDate;
    staleMark("mkSecTidesCard", session, "sector tides", calmOf({ opening, fellBack, session, at: liveTs[liveTs.length - 1] }, "sector tide"));
    infoInto("mkSecTidesCard", "sector tides", () => ({
      title: "Sector tides", lead: "Net option premium through the session for each of the eleven sectors, on one shared scale so heights compare.",
      facts: [["Source", useLive ? "live:breadth" : "regime"], ["Session", session || null], ["Scale", "±" + usd(peak)]],
      notes: ["Net is net call premium minus net put premium, cumulative; the vendor's sector tide is assumed cumulative, and the session value is the last row."],
    }));
  }

  function paintEtfs(regime, live, breadth) {
    const reg = okFeed(regime);
    const tideOf = (T) => {
      const lv = liveSer(live, breadth, (f) => f.etf && f.etf[T]);
      const regRow = reg && reg.etfTide && reg.etfTide.byEtf ? reg.etfTide.byEtf[T] : null;
      const regOk = Boolean(regRow && regRow.status === "ok");
      const liveNewer = lv && newer(lv.session, reg);
      const at = liveNewer && Array.isArray(lv.s.t) ? lv.s.t[0] : null;
      if (liveNewer && (lv.n >= 2 || !regOk)) return { regRow, path: nums(lv.s.net), net: lastOf(nums(lv.s.net)), src: lv.src, session: lv.session, opening: lv.n < 2, at };
      if (regOk) return { regRow, path: pathOf(regRow.path), net: isNum(regRow.net), src: "regime", session: reg.sessionDate, fellBack: Boolean(liveNewer), at };
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
      const own = net === null && regRow ? isNum(regRow.ownNet) : null;
      if (src === null && !curve && !flow && own === null) {
        if (!newGate(host, regime, "the " + T + " tide", 150)) host.append(emptyLine("unavailable", "No tide was carried for " + T + ".", T + " tide", 150));
        headMark("mkEtf" + T + "Card", null);
        continue;
      }
      const tideMetric = net !== null || own === null
        ? UI.metric("Net premium", usdS(net), { tone: toneOf(net), state: gap(net, regime, regRow, "The " + T + " tide") })
        : UI.metric("Own net", usdS(own), { tone: toneOf(own), sub: T + " options" });
      host.append(UI.metrics([
        tideMetric,
        UI.metric("Fund flow 20d", usdS(f20), { tone: toneOf(f20), sub: z20 === null ? null : "z " + F.signed(z20, 1), state: gap(f20, regime, flow, "The creation and redemption flow") }),
        UI.metric("IV 30d", iv30 === null ? DASH : F.pct(iv30, 1), { state: gap(iv30, regime, curve, "The fixed-tenor IV") }),
      ], { min: 84 }));
      const plot = h("div", { class: "mk-etf-p" });
      host.append(plot);
      if (drawn(path) >= 2) {
        C.line(plot, { series: [{ values: path, format: usdS }], twoTone: true, zero: true, yDomain: shared, height: 84, xAxis: false, yTicks: false, gutter: 60,
          label: T + " options tide", readout: (i) => [C.part(T, "k"), tb(path[i])] });
      }
      staleMark("mkEtf" + T + "Card", session, T, calmOf(tides[T], T + " tide"));
      infoInto("mkEtf" + T + "Card", T.toLowerCase(), () => ({
        title: T, lead: "The ETF's own options tide, its creation and redemption flow, and its fixed-tenor implied volatility.",
        facts: [["Tide source", src || DASH], ["Session", session], ["Scale", "shared by SPY, QQQ and IWM, " + usdS(shared[0]) + " to " + usdS(shared[1])], ["Own net premium", regRow ? usdS(regRow.ownNet) : null],
          ["Constituents agree", regRow && typeof regRow.agree === "boolean" ? (regRow.agree ? "yes" : "no") : null],
          ["Creations today", flow && flow.status === "ok" ? usdS(flow.changeUsd) : null], ["20-session z", z20 === null ? (flow && flow.reason) || null : F.signed(z20, 2)]],
        notes: [net === null && own !== null ? "No " + T + " tide was carried, so Own net is the premium in " + T + "'s own options, not its holdings." : null,
          "The dossier opens the full reader for " + T + "."],
      }));
    }
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
        if (soon && r.status === 404) return { status: "pending" };
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (path === "/api/flows/market") {
          const stamp = r.headers.get("X-Payload-Updated");
          const ms = stamp === null || stamp === "" ? null : Number(stamp);
          marketUpdatedAt = ms !== null && Number.isFinite(ms) && ms > 0 ? ms : null;
        }
        return r.json();
      });
  }
  const unread = (path, error) => ({ __unreadable: true, __path: path, __reason: error && error.message ? error.message : String(error) });
  function optional(path, soon) {
    return get(path, soon).catch((error) => unread(path, error));
  }
  const LK = "/api/flows/lk?k=";
  function getLive(keys) {
    if (keys.length === 1) return optional(LK + keys[0], true).then((b) => ({ [keys[0]]: b }));
    return get(LK + keys.join(","), true)
      .then((env) => Object.fromEntries(keys.map((k) => [k, env && env.keys ? UI.liveBody ? UI.liveBody(env, k) : null : env])))
      .catch((error) => Object.fromEntries(keys.map((k) => [k, unread(LK + k, error)])));
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
      if (message) pill.append(h("button", { class: "mk-pill", type: "button", "data-state": "stale", ...POP,
        "data-info": disclose("Freshness", message, { state: "stale" }) }, glyph("clock"), h("span", null, "Stale")));
    }
  }

  const below = { fns: null, ask: new Map() };
  const later = (key, run) => {
    if (below.fns) run(below.fns);
    else below.ask.set(key, run);
  };
  const LENS = { on: false, strips: null, uni: null, priced: false, day: null, movers: null, hold: false, dirty: false, shown: false, ask: 0, px: null, sync: null };

  const marketKit = Object.freeze({
    $, LENS, getLive, cap1, capLine, clear, clock, count, emptyLine, feedSilence, gap, grouped, infoInto, inlineHush, newGate, newer, nums, okFeed, pct, pendingLine, pendingOf, rowState, signGlyph, signed, signedGrouped, staleMark, table, tb, timeAxis, toneOf, track, unreadable, unreadableLine, usd, usdS,
    get attached() { return below.fns !== null; },
    attach(fns) {
      if (below.fns) return;
      below.fns = fns;
      for (const run of below.ask.values()) {
        try { run(fns); } catch (error) {
          if (statusEl) {
            statusEl.textContent = "This page failed while drawing: " + error.message;
            statusEl.setAttribute("data-empty", "unreadable");
          }
        }
      }
      below.ask.clear();
    },
  });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { marketKit }));

  function lensDefault() {
    const host = $("mktMovers");
    LENS.on = Boolean(host && host.dataset.lens === "ivdays");
    return LENS.on;
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
    getLive(lensDefault() ? ["market", "breadth", "vol", "strips"] : ["market", "breadth", "vol"]),
  ]).then((all) => {
    const [m, sectors, movers, pulse, boardLong, boardShort, regime, universe, lk] = all;
    let live = lk.market, breadth = lk.breadth;
    const liveVol = lk.vol;
    if (!m) return;
    if (typeof m === "object") m.__updatedAt = marketUpdatedAt;
    const n = unreadable(m) ? null : isNum(m.n);
    const level = unreadable(m) ? "unreadable" : m.status === "pending" || n === null ? "pending" : "ok";
    const meta = $("mkMeta");
    if (level !== "ok") {
      marketSilence(level === "unreadable" ? unreadableLine(m, "the market level (/api/flows/market)")
        : pendingLine("the market level", "It appears with the next pipeline run."));
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
    pulseStampOf(pulse);
    paintTide(pulse, live, breadth);
    paintSectorTides(regime, breadth);
    paintEtfs(regime, live, breadth);
    later("below", (b) => {
      b.paintSectors(sectors);
      textInfo("mkSectorsCard", "momentum", $("mktSectors"), "Momentum");
      LENS.uni = b.uniRows(universe);
      LENS.priced = Boolean(LENS.uni && LENS.uni.some((r) => r.iv !== null));
      LENS.day = LENS.uni ? universe.sessionDate : null;
      if (lk.strips && okFeed(lk.strips)) LENS.strips = lk.strips;
      b.paintMovers(movers);
      textInfo("mkMoversCard", "extremes", $("mktMovers"), "Extremes", () => ({ notes: [($("mktMovers") || {}).dataset && $("mktMovers").dataset.pop,
        "Ranked over the whole screened universe, not over the board. Only names the board went deep on have a card."] }));
      b.paintAgainst([boardLong, boardShort], movers);
      textInfo("mkAgainstCard", "against the tape", $("mktAgainst"), "Against the tape", () => ({ notes: [
        "The board score is a residual, with sector and size divided out, while these lists are the raw level, so the two may disagree; a name where they do is one to read twice, not a signal to fade."] }));
      b.paintPulse(pulse);
      b.paintUniverse(universe);
      b.paintExpiry(regime, breadth);
      b.paintVol(regime, liveVol);
      b.paintRadar(regime);
      b.paintGroups(regime);
    });
    for (const [group, id] of [["skyline", "mkSkyline"]]) {
      const host = $(id);
      if (host && UI.defer) UI.defer(group, { when: "visible", el: host, label: "The " + group + " view" }).then(() => window.FlowsUI[group].mount(host, universe, null));
    }
    if (UI.defer) UI.defer("market-below", { when: "visible", el: $("mkSectorsCard"), label: "The lower modules" });
    if (typeof UI.heartbeat === "function") {
      const beat = (withStrips) => UI.heartbeat({ keys: withStrips ? ["market", "breadth", "strips"] : ["market", "breadth"], nightly: ["pulse"], page: "market",
        onChange(changed) {
          const keys = Array.isArray(changed) ? changed.map(String) : [];
          if (LENS.on && !(UI.rt && UI.rt.feeds("px")) && keys.some((c) => /live:strips(?!:)/.test(c))) {
            getLive(["strips"]).then((lk) => {
              const s = okFeed(lk.strips);
              if (!s) return;
              LENS.strips = s;
              later("lens", (b) => b.lensRepaint(false));
            }).catch(() => {});
          }
          const ask = ["market", "breadth"].filter((k) => keys.some((c) => c.includes("live:" + k)));
          if (!ask.length) return;
          getLive(ask).then((lk) => {
            const m = okFeed(lk.market), b = okFeed(lk.breadth);
            if (!m && !b) return;
            if (m) live = UI.rt && UI.rt.feeds("mk") ? UI.rt.market(m) : m;
            if (b) breadth = b;
            paintSectorTides(regime, breadth);
            later("expiry", (b) => b.paintExpiry(regime, breadth));
            paintEtfs(regime, live, breadth);
            paintTide(pulse, live, breadth);
          }).catch(() => {});
        } });
      let beating = beat(LENS.on), withStrips = LENS.on;
      LENS.sync = () => {
        if (LENS.on === withStrips || !LENS.on) return;
        withStrips = true;
        beating.stop();
        beating = beat(true);
      };
    }
    const rt = UI.rt && UI.rt.connect({ topics: ["mk"] });
    if (rt) {
      rt.on("mk", () => {
        const m = UI.rt.feeds("mk") ? UI.rt.market(live) : null;
        if (!m || m === live) return;
        live = m;
        paintEtfs(regime, live, breadth);
        paintTide(pulse, live, breadth);
      });
    }
  }).catch((error) => {
    if (statusEl) {
      statusEl.textContent = "This page failed while drawing: " + error.message;
      statusEl.setAttribute("data-empty", "unreadable");
    }
  });
})();
