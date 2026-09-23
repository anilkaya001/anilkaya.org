(() => {
  "use strict";

  const UI = window.FlowsUI;
  const mod = document.getElementById("bdMod");
  if (!UI || !mod) return;
  const { h, s, F } = UI;
  const num = UI.isNum;
  const DASH = UI.DASH;

  const page = document.body.dataset.flowsPage;
  const WATCH = page === "watch";
  const side = WATCH ? "watch" : page === "short" ? "short" : "long";
  const lean = side === "short" ? "down" : "up";
  const statusEl = document.getElementById(WATCH ? "watchStatus" : "flowsStatus");
  const body = document.getElementById(WATCH ? "watchBody" : "flowsBody");
  const headRow = document.getElementById("bdHead");
  const table = document.getElementById("bdTable");
  const tools = document.getElementById("bdTools");
  const hero = document.getElementById("bdHero");
  const mapHost = document.getElementById("bdMap");
  const emptyHost = document.getElementById("bdEmpty");
  const modHead = mod.querySelector(".ui-mod-h");
  if (!statusEl || !body || !headRow || !table || !emptyHost) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

  const SIDE_WORD = { long: "Bullish", short: "Bearish", watch: "Watchlist" }[side];
  const EARNINGS_SOON_DAYS = 20;
  const SCORE_SCALE = Math.atanh(0.80) / 2.0;

  const NO_CARD_SAID =
    "No detail card: the chain and the card cost vendor calls the run spends " +
    "only on the names furthest from neutral. This row is scored and ranked " +
    "from the same five sources as every other.";

  const st = {
    payload: null, rows: [], sortKey: null, sortDir: "desc", q: "", view: "list",
    trackState: "loading", uni: null, uniIndex: null, uniState: { state: "pending", reason: "Reading the cross-section." },
    horizon: null, knowsDeep: false, painted: false, mapChart: null, hasIdea: false,
  };
  const mem = { rows: "absent", status: null, note: null, prior: null };

  const fmtPrice = (v) => F.px(num(v), 2);
  const fmtPct = (v, dp) => F.pct(num(v), dp, true);
  const fmtMoney = (v) => F.money(num(v), true);
  const signedInt = (v) => F.signed(num(v), 0);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
  const toneOf = (v) => { const n = num(v); return n === null || n === 0 ? "flat" : n > 0 ? "up" : "down"; };
  const readerHref = (t) =>
    "/flows/ticker/?t=" + encodeURIComponent(String(t || "")) + "&s=signal&from=" + encodeURIComponent(side);

  function memoryState(rows) {
    if (!Array.isArray(rows) || !rows.length) return "absent";
    let sawKey = false;
    for (const row of rows) {
      if (!row || typeof row !== "object" || !("nw" in row)) continue;
      sawKey = true;
      if (row.nw !== null) return "warm";
    }
    return sawKey ? "cold" : "absent";
  }

  function readMemoryBlock(payload) {
    const block = payload && typeof payload.memory === "object" && payload.memory ? payload.memory : null;
    mem.status = block && typeof block.status === "string" ? block.status : null;
    mem.note = block && typeof block.note === "string" && block.note ? block.note : null;
    mem.prior = block && typeof block.sessionDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(block.sessionDate) ? block.sessionDate : null;
  }

  const comparand = () => (mem.prior ? "the " + mem.prior + " board" : "the previously published board");

  function memoryMark(row) {
    if (!row) return null;
    if (row.nw === true) return { kind: "new", text: "New", say: "new to this side: it was not on " + comparand() };
    const dr = num(row.dr);
    if (dr === null) return null;
    const places = (n) => n + (n === 1 ? " place" : " places");
    const from = num(row.r0);
    const now = num(row.r);
    const ends = from !== null && now !== null ? ", from rank " + from + " to rank " + now : "";
    if (dr > 0) return { kind: "up", g: "up", text: String(dr), say: "climbed " + places(dr) + " since " + comparand() + ends };
    if (dr < 0) return { kind: "down", g: "down", text: String(-dr), say: "fell " + places(-dr) + " since " + comparand() + ends };
    return { kind: "same", quiet: true, say: "the same rank as on " + comparand() + (now === null ? "" : ", still rank " + now) };
  }

  function tenureMarks(row) {
    const out = [];
    if (row && row.hy === true) {
      out.push({ kind: "hold", g: "history", text: "Hold",
        say: "on the board on incumbency: it did not clear the entry rank this session " +
          "and sits inside the exit band, so it is on its way off" });
    }
    const dte = num(row && row.edte);
    if (dte !== null && dte >= 0 && dte <= EARNINGS_SOON_DAYS) {
      out.push({ kind: "earn", g: "cal", text: dte + "d",
        say: "reports in " + dte + (dte === 1 ? " day" : " days") + (row.ed ? ", on " + row.ed : "") +
          ". Every name here cleared the earnings gate for this session; this one clears it by days, so it is " +
          "about to leave the board for a calendar reason rather than a signal one" });
    }
    return out;
  }

  const MEMORY_EMPTY = { quiet: "quiet", undated: null };
  const PRE_MEMORY_SAID =
    "This board was published before the board kept a memory, so it carries no answer to " +
    "what changed since the previous session: its rows have no new-today, rank-move or " +
    "earnings-countdown fields at all. The next pipeline run stamps them.";
  const COLD_UNSTATED_SAID =
    "No comparison with a previously published board is reflected here: no name claims to be " +
    "new and no rank move is drawn, because every row's memory is null together and false " +
    "would be an answer where there is none. This payload does not say why the comparison did " +
    "not happen, and only the run that wrote it saw the earlier board — so nothing on this " +
    "page will guess at a cause.";
  const statusOnlySaid = (status) =>
    "The run that published this board reported the comparison as “" +
    String(status).slice(0, 32) + "” and sent no sentence with it, so that one word is " +
    "all this page has: no name here claims to be new and no rank move is drawn. It does not " +
    "say why beyond that, and only the run that wrote it saw the earlier board.";
  const UNDATED_UNSAID =
    "This run could not date the board it compared against, and said no more than that. The " +
    "marks here are a comparison against a board this page cannot name, rather than against a " +
    "named session: read them as unverified.";

  function memoryNoteFor() {
    if (mem.status === "ok") return null;
    const published = typeof mem.note === "string" && mem.note.trim() !== "" ? mem.note : null;
    if (mem.status !== null) {
      const tag = MEMORY_EMPTY[mem.status];
      const caveat = mem.status === "undated";
      if (published) return { status: mem.status, text: published, caveat, tag: tag === undefined ? "unavailable" : tag };
      if (mem.rows === "warm") return caveat ? { status: mem.status, text: UNDATED_UNSAID, tag: null, caveat: true } : null;
      return { status: mem.status, text: statusOnlySaid(mem.status), caveat: false, tag: tag === undefined ? "unavailable" : tag };
    }
    if (mem.rows === "warm") return null;
    return mem.rows === "absent"
      ? { status: "pre-memory", text: PRE_MEMORY_SAID, tag: "unavailable", caveat: false }
      : { status: "unstated", text: COLD_UNSTATED_SAID, tag: "unavailable", caveat: false };
  }

  function convictionTitle(row) {
    const agree = num(row && row.agr);
    const breadth = num(row && row.bth);
    if (agree === null || breadth === null || breadth <= 0) return "";
    return agree + " of " + breadth + " signed axes agree, which is the heaviest of the " +
      "three terms behind this number. It is a COUNT out of " + breadth + ", so it moves in " +
      "steps and never smoothly, and two names a few points apart may differ by a whole axis " +
      "or by nothing but coverage. The full arithmetic is on the name's own card.";
  }

  const SECTORS = [
    [/tech/, "tech"], [/health/, "health"], [/financ/, "fin"], [/cyclical|discretionary/, "disc"],
    [/defensive|staples/, "staples"], [/industr/, "ind"], [/energy/, "energy"], [/material/, "mat"],
    [/real estate/, "re"], [/utilit/, "util"], [/communic/, "comm"],
  ];
  const sectorOf = (row) => (row && typeof row.sector === "string" && row.sector.trim() ? row.sector.trim() : null);
  function sectorKey(name) {
    const k = String(name || "").toLowerCase();
    for (const [re, key] of SECTORS) if (re.test(k)) return key;
    return "none";
  }
  const SECTOR_SHORT = {
    tech: "Tech", health: "Health", fin: "Financial", disc: "Cyclical", staples: "Defensive", ind: "Industrials",
    energy: "Energy", mat: "Materials", re: "Real estate", util: "Utilities", comm: "Communication",
  };
  const sectorGlyph = (name) => h("span", {
    class: "bd-sg", "data-sec": sectorKey(name), role: "img", "aria-label": name || "No sector", title: name || "No sector",
  }, UI.glyph("sec-" + sectorKey(name)));

  function distanceToBand(row, band) {
    const b = num(band);
    if (b === null) return null;
    const resid = num(row && row.resid);
    if (resid !== null) {
      const exact = 100 * Math.tanh(resid / SCORE_SCALE);
      return { value: Math.max(0, b - Math.abs(exact)), exact, edge: b };
    }
    const sc = num(row && row.s);
    if (sc === null) return null;
    return { value: Math.max(0, b - Math.abs(sc)), exact: null, edge: b };
  }

  function approachOf(row, band, entry) {
    const here = distanceToBand(row, band);
    if (here === null || here.exact === null) return null;
    if (!entry || !entry.d1) return null;
    const qv = num(entry.d1.qv);
    const gap = num(entry.d1.gap);
    const resid = num(row && row.resid);
    if (qv === null || resid === null || gap === null || gap < 1) return null;
    const b = num(band);
    if (b === null) return null;
    const before = 100 * Math.tanh((resid - qv / 1e4) / SCORE_SCALE);
    const beforeDist = Math.max(0, b - Math.abs(before));
    const moved = beforeDist - here.value;
    const per = moved / gap;
    let sessions = null;
    if (per > 0 && gap <= 3) {
      const n = here.value / per;
      if (Number.isFinite(n) && n <= 21) sessions = n;
    }
    return { now: here.value, before: beforeDist, per, gap, sessions, moved };
  }

  const trackBy = new Map();
  const entryFor = (row) => trackBy.get(String((row && row.t) || "").toUpperCase()) || null;
  const nearEdge = (d) => d !== null && d.edge > 0 && d.value <= d.edge * 0.2;
  const bandOf = () => (st.payload ? st.payload.deadBand : null);

  function uniPct(key, row) {
    if (!st.uni || !st.uniIndex) return null;
    const i = st.uniIndex.get(String(row.t || "").toUpperCase());
    const col = st.uni.pct && st.uni.pct[key];
    if (i === undefined || !Array.isArray(col)) return null;
    return num(col[i]);
  }

  function lastFive(row) {
    const e = entryFor(row);
    if (!e || !Array.isArray(e.s)) return null;
    const vals = e.s.slice(-5).map((v) => num(v));
    while (vals.length < 5) vals.unshift(null);
    return vals;
  }

  const RANK = (row, index) => (row.r != null ? num(row.r) : index + 1);
  const ideaOf = (row) => {
    const i = row && row.idea;
    const name = typeof i === "string" ? i : i && typeof i.structure === "string" ? i.structure : null;
    return name && UI.chart.shapeOf(name) ? name : null;
  };

  const cellText = (text, cls, attrs) => h("span", { class: cls || "bd-n", ...(attrs || {}) }, text);

  const isDeep = (row) => !st.knowsDeep || row.dp === 1;
  const labelOf = (row, index) => (WATCH ? watchAria : ariaFor)(row, index, isDeep(row));

  function nameCell(row, index) {
    const deep = isDeep(row);
    const t = String(row.t || DASH);
    const label = labelOf(row, index);
    const open = deep
      ? h("a", { class: "bd-open", href: readerHref(row.t), "aria-label": label }, t)
      : h("span", { class: "bd-open is-flat", role: "link", "aria-disabled": "true", "aria-label": label, title: NO_CARD_SAID }, t);
    const marks = [];
    const m = memoryMark(row);
    if (m && !m.quiet) marks.push(m);
    for (const x of tenureMarks(row)) marks.push(x);
    if (WATCH) {
      const e = entryFor(row);
      if (e && e.d1 && e.d1.cross === "faded") {
        marks.push({ kind: "faded", g: "down", text: "Back in", cls: "c-faded",
          say: "this name was outside the band when it was last scored and is inside it now. It did not approach the edge; it came back through it" });
      }
    }
    const sector = sectorOf(row);
    return [
      sectorGlyph(sector),
      h("span", { class: "bd-nm" },
        h("span", { class: "bd-nm-1" }, open, marks.map((x) => h("span", {
          class: "bd-flag" + (x.cls ? " " + x.cls : ""), "data-kind": x.kind, role: "img", "aria-label": x.say, title: cap(x.say),
        }, x.g ? UI.glyph(x.g) : null, x.text ? h("span", { class: "bd-flag-t" }, x.text) : null))),
        h("span", { class: "bd-sec" }, sector || DASH)),
    ];
  }

  function scoreCell(row) {
    const n = num(row.s);
    const w = n === null ? 0 : Math.min(1, Math.abs(n) / 100);
    return [
      h("span", { class: "bd-v", "data-tone": n === null ? "silent" : toneOf(n) }, n === null ? DASH : signedInt(n)),
      h("span", { class: "bd-meter", "aria-hidden": "true", "data-tone": toneOf(n) }, h("i", { style: { "--w": w.toFixed(3) } })),
    ];
  }

  function convCell(row) {
    const n = num(row.cnv);
    return h("span", { class: "bd-n bd-conv", title: convictionTitle(row) || null },
      n === null ? null : UI.ring(Math.max(0, Math.min(1, n / 100)), { size: 15, stroke: 3.4 }),
      h("span", null, n === null ? DASH : String(Math.round(n))));
  }

  function priceCell(row) {
    return [
      h("span", { class: "bd-px" + (row.__live ? " is-live" : "") }, fmtPrice(row.px)),
      h("span", { class: "bd-chg", "data-tone": toneOf(row.chg) }, fmtPct(row.chg, 2)),
    ];
  }

  function stripSvg(vals) {
    const W = 52, H = 28, n = vals.length, bw = 7;
    const gap = (W - n * bw) / Math.max(1, n - 1);
    const mid = H / 2;
    const svg = s("svg", { class: "bd-strip", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
    s("line", { x1: 0, x2: W, y1: mid, y2: mid, class: "z" }, svg);
    vals.forEach((v, i) => {
      const x = i * (bw + gap);
      if (v === null) { s("circle", { cx: x + bw / 2, cy: mid, r: 1.4, class: "gap" }, svg); return; }
      if (v === 0) { s("rect", { x: x.toFixed(2), y: (mid - 0.75).toFixed(2), width: bw, height: 1.5, rx: 0.75, class: "zero" + (i === n - 1 ? " last" : "") }, svg); return; }
      const hg = Math.max(1.5, (Math.min(100, Math.abs(v)) / 100) * (mid - 1));
      s("rect", {
        x: x.toFixed(2), y: (v > 0 ? mid - hg : mid).toFixed(2), width: bw, height: hg.toFixed(2), rx: 1.5,
        class: (v > 0 ? "up" : "down") + (i === n - 1 ? " last" : ""), style: `--i:${i}`,
      }, svg);
    });
    return svg;
  }

  function stripCell(row) {
    if (st.trackState === "loading") return h("span", { class: "bd-dash is-wait" }, DASH);
    const vals = lastFive(row);
    if (!vals || vals.every((v) => v === null)) {
      return h("span", { class: "bd-dash", title: st.trackState === "failed" ? "The score trace did not load" : st.trackState === "pending" ? "The score trace is not published yet" : "Not in the score trace" }, DASH);
    }
    const said = vals.map((v) => (v === null ? "not scored" : signedInt(v))).join(", ");
    return h("span", { class: "bd-strip-w", role: "img", "aria-label": "Last five sessions: " + said, title: "Last five sessions: " + said }, stripSvg(vals));
  }

  function moveCell(row) {
    const hm = num(row.hm);
    if (hm === null) {
      return h("span", {
        class: "bd-n bd-move", "data-empty": "unavailable",
        title: "No priced move on this row: the run had no usable 30-day implied volatility for this name to scale to the board's horizon.",
      }, "±" + DASH);
    }
    const hr = num(row.hr);
    return h("span", {
      class: "bd-n bd-move",
      title: st.horizon
        ? `The option market prices ±${(hm * 100).toFixed(1)}% over ${st.horizon} trading sessions` +
          (hr !== null ? `; this name has delivered ±${(hr * 100).toFixed(1)}% over the same horizon.` : ".")
        : "",
    }, "±" + (hm * 100).toFixed(1) + "%");
  }

  function gammaCell(row) {
    const g = row.gRegime === "long" || row.gRegime === "short" ? row.gRegime : null;
    const say = g ? "Dealer " + g + " gamma: hedging " + (g === "long" ? "damps" : "amplifies") + " moves. A hedging state, not a direction." : "No gamma regime on this row.";
    return h("span", { class: "bd-g", "data-regime": g || "none", "data-tone": g || "silent", role: "img", "aria-label": say, title: say },
      g ? (g === "long" ? "+" : UI.MINUS) + "\u03b3" : DASH);
  }

  function quietPct(v, title) {
    const n = num(v);
    if (n === null) return h("span", { class: "bd-q", title: title || null }, DASH);
    const x = n >= 80 ? "hi" : n <= 20 ? "lo" : null;
    return h("span", { class: "bd-q", "data-x": x }, String(Math.round(n)));
  }

  function uniCell(key) {
    return (row) => {
      if (st.uniState.state !== "ok") return h("span", { class: "bd-q" }, DASH);
      const v = uniPct(key, row);
      return quietPct(v, v === null ? "Not in the cross-section of eligible names" : null);
    };
  }

  function ideaCell(row) {
    const name = ideaOf(row);
    if (!name) return h("span", { class: "bd-q" }, DASH);
    const svg = UI.chart.payoff(null, { structure: name });
    return h("span", { class: "bd-idea", role: "img", "aria-label": "Lead idea: " + name, title: cap(name) }, svg);
  }

  function bandCell(row) {
    const band = bandOf();
    const d = distanceToBand(row, band);
    const wrap = h("span", { class: "bd-band" });
    const ap = approachOf(row, band, entryFor(row));
    const fill = d === null || !(d.edge > 0) ? 0 : Math.max(0, Math.min(1, 1 - d.value / d.edge));
    wrap.append(
      h("span", { class: "bd-band-1" },
        h("span", { class: "bd-v" }, d === null ? DASH : d.exact !== null ? d.value.toFixed(2) : d.value.toFixed(0)),
        h("span", { class: "bd-meter is-edge", "aria-hidden": "true" }, h("i", { style: { "--w": fill.toFixed(3) } }))));
    if (ap !== null) {
      const line = h("span", { class: "c-approach" + (ap.per > 0 ? " is-closing" : ap.per < 0 ? " is-widening" : "") });
      const arrow = ap.per > 0 ? "▸" : ap.per < 0 ? "◂" : "·";
      line.textContent = arrow + " " + F.signed(ap.per, 2) +
        (ap.sessions === null ? "" : "  ≈" + (ap.sessions < 1 ? "<1" : Math.round(ap.sessions)) + "s");
      line.title =
        (ap.moved >= 0 ? "Closer to the edge by " : "Further from the edge by ") +
        Math.abs(ap.moved).toFixed(2) + " score points across " + ap.gap +
        (ap.gap === 1 ? " session" : " sessions, shown here divided by " + ap.gap) +
        ", measured between the two sessions this name was actually scored." +
        (ap.sessions === null ? ""
          : " At that rate it reaches the edge in about " +
            (ap.sessions < 1 ? "less than one session" : Math.round(ap.sessions) + " sessions") +
            " — " + ap.now.toFixed(2) + " points divided by " + ap.per.toFixed(2) +
            " a session. That is an extrapolation of one observation and not a " +
            "forecast; it is withheld entirely where the rate was measured across " +
            "more than three sessions, or where the answer runs past the archive's " +
            "own window.");
      wrap.append(line);
    }
    return wrap;
  }

  function bandCellAttrs(row) {
    const d = distanceToBand(row, bandOf());
    const near = nearEdge(d);
    let title = near ? "Within a fifth of the band's half-width of the edge." : "";
    if (d !== null && d.exact !== null) {
      title = (title ? title + " " : "") + "Score points, computed from the unrounded score (" +
        d.exact.toFixed(2) + ") rather than the integer shown beside it.";
    }
    return { cls: "c-toband" + (near ? " is-near" : ""), title: title || null };
  }

  function surpriseCell(row) {
    return h("span", { class: "bd-n" }, F.signed(num(row.surpriseTilt), 2));
  }
  function surpriseAttrs(row) {
    const sur = num(row.surpriseTilt);
    return sur !== null && Math.abs(sur) >= Math.log(3)
      ? { cls: "is-surprise", title: "One side's volume surprise is at least three times the other's, against this name's own thirty-day norms. A tilt of its own tape, which says nothing about the size of that tape." }
      : null;
  }

  const SIDE_COLS = [
    { key: "r", label: "#", title: "Published rank", sort: { first: "asc", get: RANK }, cell: (row, i) => cellText(String(RANK(row, i) ?? DASH), "bd-rank") },
    { key: "t", label: "Name", sort: { first: "asc", text: true, get: (row) => (row.t ? String(row.t) : null) }, cell: nameCell },
    { key: "s", label: "Score", sort: { first: "desc", get: (row) => num(row.s) }, cell: scoreCell },
    { key: "cnv", label: "Conv", title: "Conviction", sort: { first: "desc", get: (row) => num(row.cnv) }, cell: convCell },
    { key: "px", label: "Price", title: "Last price and today's change; sorts by the change", sort: { first: "desc", get: (row) => num(row.chg) }, cell: priceCell },
    { key: "strip", label: "5d", title: "Score over the last five scored sessions", cell: stripCell },
    { key: "netPrem", label: "Premium", title: "Net premium", sort: { first: "desc", get: (row) => num(row.netPrem) }, cell: (row) => cellText(fmtMoney(row.netPrem), "bd-n", { "data-tone": toneOf(row.netPrem) }) },
    { key: "hm", label: "Move", title: "Priced move over the board's horizon", sort: { first: "desc", get: (row) => num(row.hm) }, cell: moveCell },
    { key: "g", label: "γ", title: "Dealer gamma regime", sort: { first: "asc", text: true, get: (row) => (row.gRegime === "long" || row.gRegime === "short" ? row.gRegime : null) }, cell: gammaCell },
    { key: "ivr", label: "IVR", title: "Implied volatility rank, own year", sort: { first: "desc", get: (row) => num(row.ivr) }, cell: (row) => quietPct(num(row.ivr) === null ? null : row.ivr * 100) },
    { key: "vrpP", label: "VRP", title: "Volatility risk premium, percentile across the market", uni: true, sort: { first: "desc", get: (row) => uniPct("vrp", row) }, cell: uniCell("vrp") },
    { key: "siP", label: "SI", title: "Short interest, percentile across the market", uni: true, sort: { first: "desc", get: (row) => uniPct("si", row) }, cell: uniCell("si") },
    { key: "idea", label: "Idea", title: "The lead idea's structure", optional: true, cell: ideaCell },
  ];

  const WATCH_COLS = [
    { key: "r", label: "#", title: "Nearest the edge first", sort: { first: "asc", get: (row) => num(row.__edge) }, cell: (row) => cellText(String(row.__edge ?? DASH), "bd-rank") },
    { key: "t", label: "Name", sort: { first: "asc", text: true, get: (row) => (row.t ? String(row.t) : null) }, cell: nameCell },
    { key: "band", label: "To band", title: "Distance from the band edge, in score points", sort: { first: "asc", get: (row) => { const d = distanceToBand(row, bandOf()); return d === null ? null : d.value; } }, cell: bandCell, attrs: bandCellAttrs },
    { key: "s", label: "Score", sort: { first: "desc", get: (row) => num(row.s) }, cell: (row) => cellText(signedInt(row.s), "bd-n", { "data-tone": toneOf(row.s) }) },
    { key: "cnv", label: "Conv", title: "Conviction", sort: { first: "desc", get: (row) => num(row.cnv) }, cell: convCell },
    { key: "px", label: "Price", title: "Last price and today's change; sorts by the change", sort: { first: "desc", get: (row) => num(row.chg) }, cell: priceCell },
    { key: "strip", label: "5d", title: "Score over the last five scored sessions", cell: stripCell },
    { key: "sur", label: "Surprise", title: "Call against put volume surprise", sort: { first: "desc", get: (row) => num(row.surpriseTilt) }, cell: surpriseCell, attrs: surpriseAttrs },
    { key: "rvol", label: "Rel vol", title: "Relative share volume", sort: { first: "desc", get: (row) => num(row.relVolume) }, cell: (row) => cellText(num(row.relVolume) === null ? DASH : num(row.relVolume).toFixed(2) + "×") },
    { key: "pcr", label: "P/C", title: "Put to call volume", sort: { first: "desc", get: (row) => num(row.putCallRatio) }, cell: (row) => cellText(num(row.putCallRatio) === null ? DASH : num(row.putCallRatio).toFixed(2)) },
    { key: "w52", label: "52w", title: "Position in the 52-week range", sort: { first: "desc", get: (row) => num(row.w52) }, cell: (row) => cellText(F.pct(num(row.w52), 0)) },
  ];

  const COLS = WATCH ? WATCH_COLS : SIDE_COLS;
  const shownCols = () => COLS.filter((c) => !c.optional || st.hasIdea);

  const EXTRA_SORTS = WATCH ? [] : [
    { key: "dr", sort: { first: "desc", get: (row) => num(row.dr) }, available: (rows) => !rows.length || rows.some((r) => r && num(r.dr) !== null) },
    { key: "nw", sort: { first: "desc", get: (row) => (row.nw === true ? 1 : row.nw === false ? 0 : null) }, available: (rows) => !rows.length || rows.some((r) => r && (r.nw === true || r.nw === false)) },
    { key: "edte", sort: { first: "asc", get: (row) => { const n = num(row.edte); return n === null || n < 0 ? null : n; } },
      available: (rows) => !rows.length || rows.some((r) => { const n = num(r && r.edte); return n !== null && n >= 0; }) },
  ];

  const SORT_CHOICES = WATCH ? [
    { key: null, dir: "asc", label: "Nearest edge" },
    { key: "s", dir: "desc", label: "Score" },
    { key: "cnv", dir: "desc", label: "Conviction" },
    { key: "sur", dir: "desc", label: "Surprise" },
    { key: "rvol", dir: "desc", label: "Relative volume" },
    { key: "t", dir: "asc", label: "Ticker" },
  ] : [
    { key: null, dir: "desc", label: "Rank" },
    { key: "s", dir: "desc", label: "Score" },
    { key: "cnv", dir: "desc", label: "Conviction" },
    { key: "dr", dir: "desc", label: "Climb" },
    { key: "nw", dir: "desc", label: "New first" },
    { key: "edte", dir: "asc", label: "Earnings" },
    { key: "netPrem", dir: "desc", label: "Net premium" },
    { key: "t", dir: "asc", label: "Ticker" },
  ];

  const colByKey = (key) => COLS.find((c) => c.key === key && c.sort) || EXTRA_SORTS.find((c) => c.key === key) || null;

  function sortable(col) {
    if (!col || !col.sort) return false;
    if (col.available) return col.available(st.rows);
    if (col.uni) return st.uniState.state === "ok";
    if (col.optional) return st.hasIdea;
    return true;
  }

  function compareBy(col, dir, a, b, ai, bi) {
    const x = col.sort.get(a, ai);
    const y = col.sort.get(b, bi);
    const xn = x === undefined ? null : x;
    const yn = y === undefined ? null : y;
    if (xn === null && yn === null) return 0;
    if (xn === null) return 1;
    if (yn === null) return -1;
    const d = col.sort.text ? String(xn).localeCompare(String(yn)) : xn - yn;
    return dir === "asc" ? d : -d;
  }

  function matches(row) {
    if (!st.q) return true;
    const t = String((row && row.t) || "").toUpperCase();
    if (t.includes(st.q)) return true;
    const sec = sectorOf(row);
    return st.q.length >= 3 && !!sec && sec.toUpperCase().split(/\s+/).some((w) => w.startsWith(st.q));
  }

  function orderedRows() {
    const view = [];
    st.rows.forEach((row, index) => { if (matches(row)) view.push({ row, index }); });
    const col = st.sortKey ? colByKey(st.sortKey) : null;
    if (!col || !sortable(col)) return view;
    view.sort((p, q) => compareBy(col, st.sortDir, p.row, q.row, p.index, q.index) || p.index - q.index);
    return view;
  }

  function readUrl() {
    try {
      const q = new URL(location.href).searchParams;
      st.view = !WATCH && q.get("view") === "map" ? "map" : "list";
      const col = colByKey(q.get("sort"));
      if (!col || !sortable(col)) return;
      st.sortKey = col.key;
      st.sortDir = q.get("dir") === "asc" ? "asc" : q.get("dir") === "desc" ? "desc" : col.sort.first;
    } catch { st.view = "list"; }
  }

  function writeUrl() {
    try {
      const url = new URL(location.href);
      if (st.sortKey) { url.searchParams.set("sort", st.sortKey); url.searchParams.set("dir", st.sortDir); }
      else { url.searchParams.delete("sort"); url.searchParams.delete("dir"); }
      if (st.view === "map") url.searchParams.set("view", "map"); else url.searchParams.delete("view");
      history.replaceState(null, "", url);
    } catch { return; }
  }

  let sortSel = null;
  let countEl = null;
  let searchEl = null;
  let seg = null;

  const choiceValue = (key, dir) => (key ? key + ":" + dir : "");

  function syncSortSelect() {
    if (!sortSel) return;
    const want = choiceValue(st.sortKey, st.sortDir);
    const curated = Array.prototype.some.call(sortSel.options, (o) => o.value === want && o.dataset.adhoc !== "1");
    let adhoc = sortSel.querySelector('option[data-adhoc="1"]');
    if (curated) { if (adhoc) adhoc.remove(); }
    else {
      if (!adhoc) { adhoc = h("option", { "data-adhoc": "1" }); sortSel.append(adhoc); }
      const col = COLS.find((c) => c.key === st.sortKey);
      adhoc.value = want;
      adhoc.textContent = (col ? col.title || col.label : "This board") + (st.sortDir === "asc" ? ", low to high" : ", high to low");
    }
    sortSel.value = want;
  }

  function setSort(key, dir) {
    const col = key ? colByKey(key) : null;
    if (!col || !sortable(col)) { st.sortKey = null; st.sortDir = "desc"; }
    else { st.sortKey = col.key; st.sortDir = dir === "asc" ? "asc" : "desc"; }
    writeUrl();
    paintHead();
    syncSortSelect();
    paintRows(true);
    if (st.view === "map") redrawMap();
  }

  function toggleSort(key) {
    const col = colByKey(key);
    if (!col || !sortable(col)) return;
    if (st.sortKey !== key) setSort(key, col.sort.first);
    else if (st.sortDir === col.sort.first) setSort(key, col.sort.first === "desc" ? "asc" : "desc");
    else setSort(null);
  }

  const typedEcho = () => "“" + (st.q.length > 12 ? st.q.slice(0, 12) + "…" : st.q) + "”";

  function updateCount(shown) {
    if (!countEl) return;
    if (!st.q) { countEl.hidden = true; countEl.textContent = ""; return; }
    countEl.hidden = false;
    countEl.textContent = shown + " of " + st.rows.length + " names match " + typedEcho();
  }

  function buildTools() {
    if (sortSel) return;
    searchEl = h("input", {
      class: "bd-q-in", id: "fbQ", type: "search", placeholder: "Search",
      autocomplete: "off", spellcheck: "false", autocapitalize: "characters", "aria-label": "Filter by ticker or sector",
    });
    searchEl.addEventListener("input", () => {
      st.q = String(searchEl.value || "").trim().toUpperCase();
      paintRows(false);
      if (st.view === "map") redrawMap();
    });
    sortSel = h("select", { class: "bd-sort-sel", id: "fbSort", "aria-label": "Order" });
    buildSortOptions();
    sortSel.addEventListener("change", () => {
      const [k, d] = String(sortSel.value || "").split(":");
      setSort(k || null, d);
    });
    countEl = h("span", { class: "fb-count", role: "status", hidden: true });
    tools.replaceChildren(
      h("label", { class: "bd-search" }, UI.glyph("search"), searchEl),
      countEl,
      h("span", { class: "bd-tools-sp" }),
      h("label", { class: "bd-sort" }, sortSel, UI.glyph("chev")));
  }

  function paintHead() {
    const cols = shownCols();
    table.style.setProperty("--n", String(cols.length));
    table.dataset.idea = st.hasIdea ? "1" : "0";
    headRow.replaceChildren(...cols.map((c) => {
      const cell = h("div", { class: "bd-c", role: "columnheader", "data-col": c.key });
      const live = sortable(c);
      const on = live && st.sortKey === c.key;
      if (c.sort) {
        const ind = h("span", { class: "bd-sort-ind", "aria-hidden": "true" }, on ? (st.sortDir === "asc" ? "↑" : "↓") : "");
        const b = h("button", {
          class: "bd-hs", type: "button", disabled: !live || null, title: c.title || null,
          "aria-label": (c.title || c.label) + ": " + (on
            ? "sorted " + (st.sortDir === "asc" ? "ascending" : "descending") + ", activate to " + (st.sortDir === c.sort.first ? "reverse" : "return to the published rank")
            : live ? "activate to sort" : "not sortable on this board"),
        }, c.label, ind);
        b.addEventListener("click", () => toggleSort(c.key));
        cell.append(b);
        if (live) cell.setAttribute("aria-sort", on ? (st.sortDir === "asc" ? "ascending" : "descending") : "none");
      } else {
        cell.append(h("span", { class: "bd-hl", title: c.title || null }, c.label));
      }
      if (c.uni && st.uniState.state !== "ok") cell.append(UI.stateButton(st.uniState, c.title || c.label));
      if (c.key === "strip" && (st.trackState === "failed" || st.trackState === "pending")) {
        cell.append(UI.stateButton(st.trackState === "failed"
          ? { state: "unavailable", reason: "The score trace did not load, so no session history is drawn." }
          : { state: "pending", reason: "The score trace publishes with the next pipeline run." }, "Five sessions"));
      }
      return cell;
    }));
  }

  const rowCache = new Map();

  function rowFor(row, index) {
    const cached = rowCache.get(row);
    if (cached) return cached;
    const r = h("div", { class: "bd-row", role: "row", "data-flip": String(row.t || index) });
    if (!isDeep(row)) r.classList.add("is-flat");
    for (const c of shownCols()) {
      const extra = c.attrs ? c.attrs(row) : null;
      r.append(h("div", {
        class: "bd-c" + (extra && extra.cls ? " " + extra.cls : ""), role: "cell", "data-col": c.key,
        title: extra && extra.title ? extra.title : null,
      }, c.cell(row, index)));
    }
    rowCache.set(row, r);
    return r;
  }

  function ariaFor(row, index, deep) {
    const score = num(row.s);
    const hm = num(row.hm);
    const marks = [memoryMark(row), ...tenureMarks(row)].filter(Boolean);
    return `${row.t}, rank ${row.r != null ? row.r : index + 1}, score ${score === null ? "unavailable" : score}, ` +
      `last ${fmtPrice(row.px)}, ${fmtPct(row.chg, 2)} today, conviction ${num(row.cnv) === null ? "unavailable" : Math.round(num(row.cnv))}` +
      (num(row.agr) === null || num(row.bth) === null ? ". " : `, with ${row.agr} of ${row.bth} signed axes agreeing. `) +
      (hm === null ? "Priced move unavailable. "
        : `The option market prices plus or minus ${(hm * 100).toFixed(1)} percent over ${st.horizon || 10} trading sessions. `) +
      (marks.length ? marks.map((m) => cap(m.say)).join(" ") + " " : "") +
      (num(row.netPrem) === null ? "Net premium unavailable. " : `Net premium ${fmtMoney(row.netPrem)}. `) +
      (deep ? `Open the full reader for ${row.t}.` : NO_CARD_SAID);
  }

  function watchAria(row, index, deep) {
    const d = distanceToBand(row, bandOf());
    return `${row.t}, score ${signedInt(row.s)}, ` +
      (d === null ? "distance to the band unavailable" : (d.exact !== null ? d.value.toFixed(2) : d.value.toFixed(0)) + " score points from the band edge") +
      `, last ${fmtPrice(row.px)}, ${fmtPct(row.chg, 2)} today. ` + (deep ? `Open the full reader for ${row.t}.` : NO_CARD_SAID);
  }

  let flipFrame = 0;

  function paintRows(animate) {
    if (!st.rows.length) return;
    const view = orderedRows();
    updateCount(view.length);
    const move = animate && st.painted && !calm.matches;
    const before = new Map();
    if (move) {
      if (flipFrame) { cancelAnimationFrame(flipFrame); flipFrame = 0; }
      for (const r of body.children) if (r.dataset.flip) before.set(r.dataset.flip, r.getBoundingClientRect().top);
    }
    if (!view.length) {
      const clear = h("button", { type: "button", class: "bd-clear" }, "Clear");
      clear.addEventListener("click", () => { searchEl.value = ""; st.q = ""; paintRows(false); if (st.view === "map") redrawMap(); searchEl.focus(); });
      body.replaceChildren(h("div", { class: "bd-row bd-none", role: "row", "data-empty": "filtered" },
        h("div", { class: "bd-c", role: "cell" }, h("span", null, "No match"), clear)));
      return;
    }
    const first = !st.painted;
    body.replaceChildren(...view.map(({ row, index }, i) => {
      const r = rowFor(row, index);
      r.style.removeProperty("transform");
      r.classList.remove("is-flip");
      if (first) { r.classList.add("is-in"); r.style.setProperty("--i", String(Math.min(i, 14))); }
      else r.classList.remove("is-in");
      return r;
    }));
    st.painted = true;
    if (!move) return;
    const moved = [];
    for (const r of body.children) {
      const top = before.get(r.dataset.flip);
      if (top === undefined) continue;
      const dy = top - r.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      r.classList.remove("is-in");
      r.style.transform = `translateY(${dy.toFixed(1)}px)`;
      moved.push(r);
    }
    if (!moved.length) return;
    flipFrame = requestAnimationFrame(() => {
      flipFrame = 0;
      for (const r of moved) { r.classList.add("is-flip"); r.style.removeProperty("transform"); }
    });
  }

  body.addEventListener("transitionend", (e) => {
    if (e.propertyName === "transform" && e.target.classList) e.target.classList.remove("is-flip");
  });

  function median(list) {
    const v = list.filter((x) => x !== null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function sideHero(payload, rows) {
    const scored = num(payload.scored);
    const cleared = num(payload.cleared) ?? rows.length;
    const neutral = num(payload.neutral);
    const band = num(payload.deadBand);
    const shed = num(payload.shed);
    const asOf = payload.sessionDate ? "Session " + F.day(payload.sessionDate) : null;
    const scores = rows.map((r) => num(r.s));
    const med = median(scores);
    const prem = rows.map((r) => num(r.netPrem)).filter((x) => x !== null);
    const sum = prem.reduce((a, b) => a + b, 0);
    const gross = prem.reduce((a, b) => a + Math.abs(b), 0);
    const known = rows.filter((r) => r.gRegime === "long" || r.gRegime === "short");
    const shortG = known.filter((r) => r.gRegime === "short").length;
    const note = memoryNoteFor();
    const fresh = rows.filter((r) => r && r.nw === true).length;
    const held = rows.filter((r) => r && r.hy === true).length;

    const clearedChip = UI.gaugeChip({
      ring: scored ? Math.min(1, cleared / scored) : null, color: "--label-1", value: F.int(cleared), label: "Cleared",
      info: () => ({
        title: "Cleared the band", asOf,
        lead: cleared + " of " + (scored ?? "?") + " scored names cleared " + (band === null ? "the dead band" : "the ±" + band + " band") + " on this side" +
          (rows.length < cleared ? "; the board holds the " + rows.length + " strongest." : "."),
        facts: [["Shown", String(rows.length)], ["Scored", scored === null ? null : String(scored)],
          ["Inside the band", neutral === null ? null : String(neutral)], ["Did not fit", shed ? String(shed) : null]],
      }),
    });

    const newChip = mem.rows === "warm" && !(note && !note.caveat && note.tag)
      ? UI.gaugeChip({
        icon: "star", color: "--accent-ink", value: String(fresh), label: "New",
        info: () => ({
          title: "New to this side", asOf,
          lead: (fresh === 0 ? "No new names on this side" : fresh + " new to this side") + " since " + comparand() + "." +
            (held ? " " + held + " held on incumbency." : ""),
          notes: note ? [note.text] : [],
        }),
      })
      : UI.gaugeChip({
        icon: note && note.tag === "quiet" ? "quiet" : "unavailable", color: "--label-3", value: DASH, label: "New",
        info: () => ({ title: "New to this side", state: note && note.tag === "quiet" ? "quiet" : "unavailable", lead: note ? note.text : COLD_UNSTATED_SAID }),
      });
    newChip.id = "bdMem";
    if (note) {
      newChip.dataset.memory = note.status;
      if (note.tag) newChip.dataset.empty = note.tag;
    }

    const scoreChip = UI.gaugeChip({
      diverging: med, value: med === null ? DASH : signedInt(med), label: "Median", tone: med === null ? null : toneOf(med),
      info: () => ({
        title: "Median score", asOf,
        lead: "The middle score of the " + rows.length + " names on this board. Scores run from −100 to +100 and rank names against every scored name; they are a ranked attention signal, not a return forecast.",
        facts: [["Strongest", signedInt(scores.filter((x) => x !== null).sort((a, b) => Math.abs(b) - Math.abs(a))[0])],
          ["Spread", num(payload.dispersion) === null ? null : payload.dispersion.toFixed(2) + " composite units"]],
      }),
    });

    const premChip = UI.gaugeChip({
      diverging: gross ? (sum / gross) * 100 : null, value: prem.length ? F.money(sum, true) : DASH, label: "Premium",
      tone: prem.length ? toneOf(sum) : null,
      info: () => ({
        title: "Net premium", asOf,
        lead: "Call premium bought minus put premium bought, summed across the session and across the " + prem.length + " names that carry it. The ring is that sum over the gross, so a full ring means every dollar leaned one way.",
        facts: [["Names", String(prem.length)], ["Gross", F.money(gross)]],
      }),
    });

    const gammaChip = UI.gaugeChip({
      ring: known.length ? shortG / known.length : null, color: "--g-short-ink", value: known.length ? String(shortG) : DASH, label: "Short γ",
      info: () => ({
        title: "Dealer short gamma", asOf,
        lead: shortG + " of " + known.length + " names sit where dealers are short gamma, so their hedging adds to moves; the other " +
          (known.length - shortG) + " are long gamma, where hedging damps them. A hedging state, not a direction.",
      }),
    });
    return [clearedChip, newChip, scoreChip, premChip, gammaChip];
  }

  function watchCounts(rows) {
    const band = bandOf();
    let comparable = 0, closing = 0, projected = 0, faded = 0;
    for (const r of rows) {
      const e = entryFor(r);
      if (e && e.d1 && e.d1.cross === "faded") faded++;
      const ap = approachOf(r, band, e);
      if (ap === null) continue;
      comparable++;
      if (ap.per > 0) closing++;
      if (ap.sessions !== null) projected++;
    }
    const near = rows.filter((r) => nearEdge(distanceToBand(r, band))).length;
    return { comparable, closing, projected, faded, near };
  }

  function watchHero(payload, rows) {
    const c = watchCounts(rows);
    const scored = num(payload.scored);
    const inBand = num(payload.neutral) ?? rows.length;
    const band = num(payload.deadBand);
    const asOf = payload.sessionDate ? "Session " + F.day(payload.sessionDate) : null;
    const trackSilence = st.trackState === "failed"
      ? { state: "unavailable", reason: "The score trace did not load, so no direction of travel is shown." }
      : !c.comparable ? { state: "quiet", reason: "No name here has a prior scored session to measure against yet." } : null;
    return [
      UI.gaugeChip({
        ring: scored ? Math.min(1, inBand / scored) : null, color: "--label-1", value: String(inBand), label: "In band",
        info: () => ({ title: "Inside the band", asOf,
          lead: inBand + (scored === null ? "" : " of " + scored + " scored") + " names sit inside the ±" + (band ?? "") + " band on neither side" +
            (inBand > rows.length ? "; this list shows the " + rows.length + " closest." : ".") +
            " A name inside the band is one the cross-section could not separate from noise this session: proximity to the edge is not a weaker version of a signal, it is the absence of one, measured." }),
      }),
      UI.gaugeChip({
        ring: rows.length ? c.near / rows.length : null, color: "--accent-ink", value: String(c.near), label: "Near edge",
        info: () => ({ title: "Near the edge", asOf, lead: c.near + " within a fifth of the band's half-width of the edge. A row near zero is one session from appearing on a board." }),
      }),
      UI.gaugeChip(trackSilence
        ? { icon: trackSilence.state, color: "--label-3", value: DASH, label: "Closing in", info: () => ({ title: "Closing in", state: trackSilence.state, lead: trackSilence.reason }) }
        : { ring: c.closing / c.comparable, color: "--up-mark", value: c.closing + "/" + c.comparable, label: "Closing in",
          info: () => ({ title: "Closing in", asOf,
            lead: c.closing + " of " + c.comparable + " measurable moved toward the edge since their prior scored session" + (c.projected ? ", " + c.projected + " within a projectable distance." : "."),
            notes: ["Under a distance, ▸ is a name that moved toward the edge and ◂ one that moved away, at the signed rate beside it per session; ≈ns is the sessions to the edge at that rate, withheld where the rate spans more than three sessions."] }) }),
      UI.gaugeChip({
        icon: "down", color: "--label-2", value: String(c.faded), label: "Came back",
        info: () => ({ title: "Came back inside", asOf, lead: c.faded + (c.faded === 1 ? " name" : " names") + " came back through the edge: outside the band when last scored, inside it now." }),
      }),
    ];
  }

  function paintHero() {
    if (!hero) return;
    const p = st.payload;
    if (!p || !st.rows.length) { hero.replaceChildren(); hero.hidden = true; return; }
    hero.hidden = false;
    hero.replaceChildren(UI.chips(WATCH ? watchHero(p, st.rows) : sideHero(p, st.rows), "Summary"));
  }

  const COLUMN_NOTES = WATCH ? [
    "To band: how far the score sits from the nearest edge of the dead band, in score points. Zero means it would publish.",
    "Surprise: the log ratio of call-side to put-side volume surprise, each side against this name's own thirty-day norm. 0 is a balanced day for this name; positive means the call side is doing the surprising.",
    "Rel vol: today's share volume against its own recent norm, as the vendor reports it. P/C: put contracts traded per call contract, a ratio of the tape and not a positioning estimate.",
    "52w: where the last price sits between the 52-week low and high.",
    "5d: the score over the last five scored sessions, oldest first; a dot is a session the name was not scored.",
    "Back in: the name was outside the band when it was last scored and is inside it now; it came back through the edge.",
  ] : [
    "Score: the composite ranked across every scored name, +100 strongest bullish and −100 strongest bearish. Conv: how much of the evidence agrees; the count behind it is on the name's card.",
    "5d: the score over the last five scored sessions, oldest first; a dot is a session the name was not scored.",
    "Premium: call premium bought minus put premium bought across the session. Move: the option market's priced move over the board's horizon.",
    "Dealer γ: blue where dealers are long gamma and hedging damps moves, orange where they are short and hedging amplifies them.",
    "IVR: where 30-day implied volatility sits within its own past year, 0 at the low and 100 at the high. VRP: implied minus realized volatility as a percentile across every eligible name. SI: short interest as a share of float, as a percentile across every eligible name.",
    "Flags: New to this side, places climbed or fallen since the previous board, held on incumbency, and earnings within " + EARNINGS_SOON_DAYS + " days.",
  ];

  function statusFacts() {
    const p = st.payload || {};
    const rows = st.rows;
    const facts = [];
    const scored = num(p.scored);
    if (WATCH) {
      const c = watchCounts(rows);
      facts.push(["Inside the band", (num(p.neutral) ?? rows.length) + (scored === null ? "" : " of " + scored)]);
      facts.push(["Band", num(p.deadBand) === null ? null : "\u00b1" + p.deadBand]);
      facts.push(["Near the edge", String(c.near)]);
      facts.push(["Moving toward it", c.comparable ? c.closing + " of " + c.comparable : null]);
      facts.push(["Came back", c.faded ? String(c.faded) : null]);
    } else {
      const cleared = num(p.cleared);
      facts.push(["Shown", rows.length + (cleared === null ? "" : " of " + cleared)]);
      facts.push(["Inside the band", num(p.neutral) === null ? null : p.neutral + " of " + (scored ?? "?")]);
      facts.push(["Band", num(p.deadBand) === null ? null : "\u00b1" + p.deadBand]);
      if (mem.rows === "warm") facts.push(["New since", mem.prior ? F.day(mem.prior) : "the last board"]);
      facts.push(["Spread", num(p.dispersion) === null ? null : p.dispersion.toFixed(2) + " composite units"]);
      facts.push(["Horizon", st.horizon === null ? null : st.horizon + " sessions"]);
    }
    facts.push(["Built", p.generatedAt ? F.time(p.generatedAt) : null]);
    return facts;
  }

  function moduleInfo() {
    const p = st.payload || {};
    return {
      title: WATCH ? "Near the band" : SIDE_WORD + " board",
      asOf: p.sessionDate ? "Session " + F.day(p.sessionDate) : null,
      lead: WATCH
        ? "Scored names that did not clear the band on either side, ranked by how close they came. Nothing here is a candidate."
        : "Names leaning " + (side === "short" ? "bearish" : "bullish") + " this session, ranked by score. A row opens that name's reader.",
      facts: statusFacts(),
      sections: [
        { title: "Columns", lines: COLUMN_NOTES },
        { title: "Reading", lines: WATCH
          ? ["Read this list for what is stirring, never for what to do: proximity to the edge is the absence of a signal, measured.", statusEl.textContent]
          : ["Scores are a ranked attention signal, not a return forecast. Whether this side has been right is measured, session by session, on the track record.", statusEl.textContent] },
      ],
    };
  }

  function mapInfo() {
    return {
      title: "Board map",
      lead: "Every name on the board, grouped by sector. A tile's area is its net premium and its color is its score, deeper for stronger.",
      notes: ["Names whose premium is under one percent of the board's gross are drawn at that floor so every name stays visible; the readout and the list carry the exact figure.",
        "A tile marked with a triangle carries premium against the board's direction; the triangle points the way that premium leans."],
    };
  }

  function buildHeader() {
    if (modHead.dataset.built) return;
    modHead.dataset.built = "1";
    const bits = [];
    if (!WATCH && mapHost) {
      seg = UI.segmented("Board view", [{ label: "List" }, { label: "Map" }], (i) => setView(i === 1 ? "map" : "list"), st.view === "map" ? 1 : 0);
      bits.push(seg);
    }
    bits.push(UI.infoButton(WATCH ? "the watchlist" : "this board", moduleInfo));
    modHead.append(...bits);
  }

  function setStale(verdict) {
    const t = modHead.querySelector(".ui-mod-t");
    const old = t && t.querySelector(".ui-state");
    if (old) old.remove();
    const message = verdict && verdict.message ? verdict.message : "";
    document.body.classList.toggle("is-stale", Boolean(message));
    if (message && t) {
      const b = UI.stateButton({ state: "stale", reason: message }, "Board");
      b.dataset.stale = (verdict && verdict.kind) || "stale";
      b.id = "bdStale";
      t.append(b);
    }
  }

  function setView(which) {
    st.view = which === "map" && !WATCH ? "map" : "list";
    writeUrl();
    const map = st.view === "map";
    table.hidden = map || !st.rows.length;
    if (mapHost) mapHost.hidden = !map || !st.rows.length;
    const sortWrap = tools.querySelector(".bd-sort");
    if (sortWrap) sortWrap.hidden = map;
    if (map) redrawMap();
  }

  function squarify(items, x, y, w, hgt) {
    const out = [];
    let rest = items.slice();
    let rx = x, ry = y, rw = w, rh = hgt;
    const total = rest.reduce((a, b) => a + b.v, 0) || 1;
    const scale = (w * hgt) / total;
    const worst = (row, len) => {
      const sum = row.reduce((a, b) => a + b.v * scale, 0);
      let mx = 0;
      for (const it of row) {
        const a = it.v * scale;
        const r = Math.max((len * len * a) / (sum * sum), (sum * sum) / (len * len * a));
        if (r > mx) mx = r;
      }
      return mx;
    };
    while (rest.length) {
      const len = Math.min(rw, rh);
      const row = [rest[0]];
      let i = 1;
      while (i < rest.length && worst(row.concat(rest[i]), len) <= worst(row, len)) { row.push(rest[i]); i++; }
      rest = rest.slice(i);
      const sum = row.reduce((a, b) => a + b.v * scale, 0);
      if (rw >= rh) {
        const cw = rest.length ? sum / rh : rw;
        let cy = ry;
        for (const it of row) { const ch = (it.v * scale) / cw; out.push({ ...it, x: rx, y: cy, w: cw, h: ch }); cy += ch; }
        rx += cw; rw -= cw;
      } else {
        const ch = rest.length ? sum / rw : rh;
        let cx = rx;
        for (const it of row) { const cw = (it.v * scale) / ch; out.push({ ...it, x: cx, y: ry, w: cw, h: ch }); cx += cw; }
        ry += ch; rh -= ch;
      }
    }
    return out;
  }

  function drawMap(host, w, animate) {
    const view = orderedRows();
    if (!view.length) {
      host.append(h("div", { class: "bd-map-none" }, "No match"));
      return;
    }
    const H = w < 600 ? Math.round(w * 1.65) : Math.round(Math.min(620, Math.max(400, w * 0.5)));
    const prem = view.map(({ row }) => Math.abs(num(row.netPrem) || 0));
    const gross = prem.reduce((a, b) => a + b, 0);
    const floor = Math.max(gross * 0.01, 1);
    const groups = new Map();
    view.forEach(({ row, index }, i) => {
      const sec = sectorOf(row) || "Other";
      if (!groups.has(sec)) groups.set(sec, { name: sec, v: 0, kids: [] });
      const g = groups.get(sec);
      const v = Math.max(prem[i], floor);
      g.v += v;
      g.kids.push({ v, row, index });
    });
    const secs = [...groups.values()].sort((a, b) => b.v - a.v);
    for (const g of secs) g.kids.sort((a, b) => b.v - a.v);
    const svg = UI.chart.svgRoot(host, w, H, animate, "Board map: " + view.length + " names by sector, area net premium, color score");
    svg.classList.add("bd-map-svg");
    const up = UI.cssVar(lean === "down" ? "--down-mark" : "--up-mark");
    const other = UI.cssVar(lean === "down" ? "--up-mark" : "--down-mark");
    const tiles = [];
    const G = 3;
    for (const g of squarify(secs, 0, 0, w, H)) {
      const gx = g.x + G / 2, gy = g.y + G / 2, gw = g.w - G, gh = g.h - G;
      if (gw <= 1 || gh <= 1) continue;
      const head = gh > 54 && gw > 64 ? 18 : 0;
      const grp = s("g", { class: "grp" }, svg);
      if (head) {
        const short = SECTOR_SHORT[sectorKey(g.name)] || g.name;
        const name = measure(g.name, 11, 600) + 8 < gw ? g.name : measure(short, 11, 600) + 8 < gw ? short : null;
        if (name) s("text", { x: gx + 4, y: gy + 12, class: "sec" }, grp).textContent = name;
      }
      for (const k of squarify(g.kids, gx, gy + head, gw, gh - head)) {
        const tx = k.x + 1, ty = k.y + 1, tw = Math.max(0, k.w - 2), th = Math.max(0, k.h - 2);
        if (tw < 1 || th < 1) continue;
        const sc = num(k.row.s);
        const mag = sc === null ? 0 : Math.min(1, Math.abs(sc) / 100);
        const against = sc !== null && ((lean === "up" && sc < 0) || (lean === "down" && sc > 0));
        const t = s("g", { class: "tile", style: `--i:${Math.min(tiles.length, 40)}` }, svg);
        s("rect", {
          x: tx.toFixed(1), y: ty.toFixed(1), width: tw.toFixed(1), height: th.toFixed(1), rx: Math.min(6, tw / 4, th / 4).toFixed(1),
          fill: against ? other : up, "fill-opacity": (0.26 + 0.66 * Math.pow(mag, 0.75)).toFixed(3), class: "tr",
        }, t);
        const tick = String(k.row.t || "");
        const pad = tw < 48 ? 5 : 7;
        let fs = Math.max(11, Math.min(24, Math.round(Math.min(tw / 3.6, th / 2.6))));
        while (fs > 10 && measure(tick, fs, 600) > tw - pad * 2) fs--;
        if (fs >= 11 && th > fs + 10) {
          const tk = s("text", { x: tx + pad, y: ty + 5 + fs * 0.9, class: "tk", style: `font-size:${fs}px` }, t);
          tk.textContent = tick;
          const sc2 = signedInt(k.row.s);
          const pm = fmtMoney(k.row.netPrem);
          const y2 = ty + 5 + fs * 0.9 + 15;
          if (th > fs + 26 && measure(sc2, 11, 600) < tw - pad * 2) {
            const sub = s("text", { x: tx + pad, y: y2, class: "sub" }, t);
            s("tspan", { class: "sub-s", text: sc2 }, sub);
            if (measure(sc2 + "   " + pm, 11, 500) < tw - pad * 2) s("tspan", { dx: 6, text: pm }, sub);
          }
        }
        const p = num(k.row.netPrem);
        if (p !== null && ((lean === "up" && p < 0) || (lean === "down" && p > 0)) && tw > 18 && th > 18) {
          const cx = tx + tw - 9, cy = ty + th - 9, d = p < 0 ? 1 : -1;
          s("path", { d: `M${cx - 4} ${cy - 2.5 * d}L${cx + 4} ${cy - 2.5 * d}L${cx} ${cy + 3.5 * d}Z`, class: "against" }, t);
        }
        tiles.push({ x: tx, y: ty, w: tw, h: th, row: k.row, index: k.index, g: t, rank: view.findIndex((v) => v.row === k.row) });
      }
    }
    tiles.sort((a, b) => a.rank - b.rank);
    wireMap(host, svg, tiles);
  }

  let measureCtx;
  let measureFamily = "";
  function measure(text, size, weight) {
    if (measureCtx === undefined) {
      measureCtx = document.createElement("canvas").getContext("2d") || null;
      measureFamily = getComputedStyle(document.body).fontFamily;
    }
    if (!measureCtx) return String(text).length * size * 0.62;
    measureCtx.font = weight + " " + size + "px " + measureFamily;
    return measureCtx.measureText(String(text)).width;
  }

  const mapState = { tiles: [], svg: null, readout: null, cur: -1, armed: -1 };

  function mapShow(i, speak) {
    const { tiles, svg, readout } = mapState;
    const host = mapState.host;
    if (!svg || i < 0 || i >= tiles.length) return;
    if (mapState.cur >= 0 && tiles[mapState.cur]) tiles[mapState.cur].g.classList.remove("is-on");
    mapState.cur = i;
    const t = tiles[i];
    t.g.classList.add("is-on");
    svg.classList.add("has-on");
    const row = t.row;
    readout.replaceChildren(
      h("span", { class: "bd-ro-1" }, h("b", null, String(row.t || DASH)), h("span", { class: "k" }, sectorOf(row) || "")),
      h("span", { class: "bd-ro-2" },
        h("span", { class: "k" }, "Score"), h("b", { "data-tone": toneOf(row.s) }, signedInt(row.s)),
        h("span", { class: "k" }, "Premium"), h("b", { "data-tone": toneOf(row.netPrem) }, fmtMoney(row.netPrem)),
        h("span", { class: "k" }, "Price"), h("b", null, fmtPrice(row.px)), h("b", { "data-tone": toneOf(row.chg) }, fmtPct(row.chg, 2))));
    readout.classList.add("is-on");
    const W = host.clientWidth, rw = readout.offsetWidth, rh = readout.offsetHeight;
    readout.style.left = Math.max(0, Math.min(W - rw, t.x + t.w / 2 - rw / 2)) + "px";
    readout.style.top = (t.y > rh + 10 ? t.y - rh - 6 : Math.min(t.y + t.h + 6, host.clientHeight - rh)) + "px";
    if (speak) UI.announce(row.t + ", " + (sectorOf(row) || "") + ", score " + signedInt(row.s) + ", net premium " + fmtMoney(row.netPrem));
  }

  function mapHide() {
    const { tiles, svg, readout } = mapState;
    if (mapState.cur >= 0 && tiles[mapState.cur]) tiles[mapState.cur].g.classList.remove("is-on");
    mapState.cur = -1;
    mapState.armed = -1;
    if (svg) svg.classList.remove("has-on");
    if (readout) readout.classList.remove("is-on");
  }

  function wireMap(host, svg, tiles) {
    const readout = h("div", { class: "ui-readout bd-readout", "aria-hidden": "true" });
    host.append(readout);
    Object.assign(mapState, { host, svg, tiles, readout, cur: -1, armed: -1 });
    if (host.dataset.wired) return;
    host.dataset.wired = "1";
    host.tabIndex = 0;
    host.setAttribute("role", "group");
    host.setAttribute("aria-roledescription", "chart");
    host.setAttribute("aria-label", "Board map. Use the arrow keys to move between names and Enter to open one.");
    const at = (e) => {
      const sv = mapState.svg;
      if (!sv) return -1;
      const b = sv.getBoundingClientRect();
      const x = (e.clientX - b.left) * (sv.viewBox.baseVal.width / b.width);
      const y = (e.clientY - b.top) * (sv.viewBox.baseVal.height / b.height);
      let best = -1, near = 8;
      mapState.tiles.forEach((t, i) => {
        const d = Math.hypot(Math.max(t.x - x, 0, x - t.x - t.w), Math.max(t.y - y, 0, y - t.y - t.h));
        if (d < near) { near = d; best = i; }
      });
      return best;
    };
    const open = (i) => {
      const t = mapState.tiles[i];
      if (t && isDeep(t.row)) location.assign(readerHref(t.row.t));
    };
    host.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") return; const i = at(e); if (i >= 0 && i !== mapState.cur) mapShow(i); });
    host.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") mapHide(); });
    host.addEventListener("click", (e) => {
      const i = at(e);
      if (i < 0) { mapHide(); return; }
      if (e.pointerType === "mouse" || mapState.armed === i) { open(i); return; }
      mapShow(i);
      mapState.armed = i;
    });
    host.addEventListener("blur", mapHide);
    host.addEventListener("keydown", (e) => {
      const k = e.key;
      const n = mapState.tiles.length;
      const cur = mapState.cur;
      if (k === "ArrowRight" || k === "ArrowDown") { e.preventDefault(); mapShow(Math.min(n - 1, cur + 1), true); }
      else if (k === "ArrowLeft" || k === "ArrowUp") { e.preventDefault(); mapShow(Math.max(0, cur < 0 ? 0 : cur - 1), true); }
      else if (k === "Home") { e.preventDefault(); mapShow(0, true); }
      else if (k === "End") { e.preventDefault(); mapShow(n - 1, true); }
      else if (k === "Enter" && cur >= 0) { e.preventDefault(); open(cur); }
      else if (k === "Escape") mapHide();
    });
  }

  function redrawMap() {
    if (!mapHost || mapHost.hidden) return;
    if (!st.mapChart) {
      const legend = UI.legend([
        h("span", { class: "ui-key bd-ramp" }, h("i", { "aria-hidden": "true" }), "Score"),
        h("span", { class: "ui-key" }, h("i", { class: "bd-areakey", "aria-hidden": "true" }), "Area net premium"),
        h("span", { class: "ui-key" }, UI.glyph(lean === "down" ? "up" : "down", "bd-againstkey"), "Premium against"),
      ]);
      const plot = h("div", { class: "bd-map-plot" });
      mapHost.replaceChildren(plot, h("div", { class: "bd-map-foot" }, legend, UI.infoButton("the board map", mapInfo, { small: true })));
      st.mapChart = UI.chart.mount(plot, drawMap);
    } else {
      st.mapChart.redraw(false);
    }
  }

  const SILENT_GLYPH = { pending: ["pending", "Pending"], quiet: ["quiet", "Quiet"], unavailable: ["unavailable", "Unavailable"], unreadable: ["stop", "Unreadable"] };

  function showSilence(text, kind) {
    const [g, word] = SILENT_GLYPH[kind] || SILENT_GLYPH.unavailable;
    const label = WATCH ? "Watchlist" : SIDE_WORD + " board";
    emptyHost.replaceChildren(h("div", {
      class: "ui-silent bd-silent", "data-state": kind === "unreadable" ? "unavailable" : kind, "data-empty": kind, role: "note", "aria-label": word + ": " + label,
    },
    UI.glyph(g), h("div", { class: "ui-silent-t" }, word),
    h("button", { type: "button", "aria-haspopup": "dialog", "aria-controls": "fxPop", "data-info": UI.info(() => ({ title: label, lead: text })) }, "Why")));
    emptyHost.hidden = false;
    table.hidden = true;
    if (mapHost) mapHost.hidden = true;
    tools.hidden = true;
    if (seg) seg.hidden = true;
    if (hero) { hero.replaceChildren(); hero.hidden = true; }
  }

  function clearSilence() {
    emptyHost.replaceChildren();
    emptyHost.hidden = true;
    tools.hidden = false;
    if (seg) seg.hidden = false;
  }

  function railCount(payload, rows) {
    const slot = document.querySelector('[data-rail-count="' + side + '"]');
    if (!slot) return;
    if (WATCH) {
      if (rows.length) { slot.textContent = String(rows.length); slot.hidden = false; }
      return;
    }
    const scoredN = num(payload.scored);
    if (rows.length || scoredN > 0) {
      const clearedN = num(payload.cleared);
      slot.textContent = String(clearedN === null ? rows.length : clearedN);
      slot.hidden = false;
    }
  }

  function sideStatus(payload, rows) {
    const when = UI.fmtStamp(payload.generatedAt) || "an unknown time";
    const parts = [
      rows.length + " " + side + " candidate" + (rows.length === 1 ? "" : "s"),
      "session " + (payload.sessionDate || "unknown"),
    ];
    if (num(payload.neutral) !== null && num(payload.deadBand) !== null) {
      parts.push(payload.neutral + " of " + (payload.scored || "?") + " inside the ±" + payload.deadBand + " band");
    }
    const shed = num(payload.shed);
    if (shed !== null && shed > 0) {
      const cleared = num(payload.cleared);
      parts.push(shed + " more cleared the band and did not fit" + (cleared === null ? "" : " (" + rows.length + " of " + cleared + " shown)"));
    }
    if (mem.rows === "warm") {
      const fresh = rows.filter((r) => r && r.nw === true).length;
      const incumbent = rows.filter((r) => r && r.hy === true).length;
      parts.push((fresh === 0 ? "no new names on this side" : fresh + " new to this side") + " since " + comparand());
      if (incumbent > 0) parts.push(incumbent + " held on incumbency");
    }
    if (num(payload.dispersion) !== null) {
      parts.push("spread " + payload.dispersion.toFixed(2) + " composite units (95th pct of |residual|, not the score's scale)");
    }
    parts.push("built " + when);
    return parts.join(" · ") + ".";
  }

  function watchStatus(payload, rows) {
    const c = watchCounts(rows);
    const scored = num(payload.scored);
    const band = payload.deadBand;
    const parts = [rows.length + (scored === null ? "" : " of " + scored + " scored") + " inside the ±" + (band ?? "") + " band"];
    if (payload.sessionDate) parts.push("session " + payload.sessionDate);
    if (c.near) parts.push(c.near + " within a fifth of the band's half-width of the edge");
    if (c.comparable) {
      parts.push(c.closing + " of " + c.comparable + " measurable moved toward the edge" +
        (c.projected ? ", " + c.projected + " within a projectable distance" : ""));
    } else if (st.trackState === "ok" || st.trackState === "pending") {
      parts.push("no name here has a prior scored session to measure against yet");
    } else {
      parts.push("the score trace did not load, so no direction of travel is shown");
    }
    if (c.faded) parts.push(c.faded + (c.faded === 1 ? " name" : " names") + " came back through the edge");
    const inBand = num(payload.neutral);
    if (inBand !== null && inBand > rows.length) parts.push("showing the " + rows.length + " closest of " + inBand);
    return parts.join(" · ") + ".";
  }

  function edgeOrder(rows) {
    const band = bandOf();
    const sorted = rows.slice().sort((a, b) => {
      const pa = approachOf(a, band, entryFor(a));
      const pb = approachOf(b, band, entryFor(b));
      const ea = pa && pa.sessions !== null ? pa.sessions : Infinity;
      const eb = pb && pb.sessions !== null ? pb.sessions : Infinity;
      if (ea !== eb) return ea - eb;
      const x = distanceToBand(a, band), y = distanceToBand(b, band);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return x.value - y.value;
    });
    sorted.forEach((r, i) => { r.__edge = i + 1; });
    return sorted;
  }

  const getJson = (url) => fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) {
        const e = new Error("HTTP " + r.status);
        e.status = r.status;
        return r.text().then(() => { throw e; }, () => { throw e; });
      }
      const updatedAt = Number(r.headers.get("X-Payload-Updated")) || null;
      return r.json().then((b) => { if (b && typeof b === "object") b.__updatedAt = updatedAt; return b; });
    });

  function takeTrack(track) {
    trackBy.clear();
    if (track && typeof track === "object") {
      if (Array.isArray(track.names)) for (const n of track.names) if (n && n.t) trackBy.set(String(n.t).toUpperCase(), n);
      st.trackState = track.status === "pending" && !trackBy.size ? "pending" : "ok";
    } else {
      st.trackState = "failed";
    }
  }

  function refresh(keys, live) {
    const cols = shownCols().filter((c) => keys.includes(c.key));
    st.rows.forEach((row, index) => {
      const node = rowCache.get(row);
      if (!node) return;
      for (const c of cols) {
        const cell = node.querySelector(':scope > [data-col="' + c.key + '"]');
        const open = live && c.key === "t" && cell && cell.querySelector(".bd-open");
        if (open) open.setAttribute("aria-label", labelOf(row, index));
        else if (cell) cell.replaceChildren(...[].concat(c.cell(row, index)));
      }
    });
    if (!live) paintHead();
    if (st.view === "map") redrawMap();
  }

  function loadExtras() {
    if (!WATCH) {
      getJson("/api/flows/scoretrack").then(takeTrack, () => takeTrack(null)).then(() => { if (st.rows.length) refresh(["strip"]); });
    }
    if (!WATCH) {
      getJson("/api/flows/universe").then((u) => {
        if (u && u.status === "ok" && Array.isArray(u.t) && u.pct) {
          st.uni = u;
          st.uniIndex = new Map(u.t.map((t, i) => [String(t).toUpperCase(), i]));
          st.uniState = { state: "ok", reason: null };
        } else {
          st.uniState = u && u.status === "unavailable"
            ? { state: "unavailable", reason: "The cross-section of eligible names was not published this session" + (u.reason ? " (" + u.reason + ")" : "") + "." }
            : { state: "pending", reason: "The cross-section of every eligible name publishes with the next pipeline run." };
        }
      }, () => {
        st.uniState = { state: "pending", reason: "The cross-section of every eligible name publishes with the next pipeline run." };
      }).then(() => { if (st.rows.length) { buildSortOptions(); refresh(["vrpP", "siP"]); } });
    }
    getJson("/api/flows/lk?k=strips").then(takeLive, () => null);
  }

  function buildSortOptions() {
    if (!sortSel) return;
    const want = sortSel.value;
    sortSel.replaceChildren(...SORT_CHOICES.filter((c) => !c.key || sortable(colByKey(c.key)))
      .map((c) => h("option", { value: choiceValue(c.key, c.dir) }, c.label)));
    sortSel.value = want;
    syncSortSelect();
  }

  let livePoll = 0;
  function pollLive(ms) {
    clearTimeout(livePoll);
    livePoll = setTimeout(function go() {
      if (document.hidden) { document.addEventListener("visibilitychange", go, { once: true }); return; }
      getJson("/api/flows/lk?k=strips").then(takeLive, () => null);
    }, ms);
  }

  function takeLive(live) {
    const p = st.payload;
    if (!live || live.status !== "ok" || !Array.isArray(live.fields) || !live.rows || !p) return;
    const session = typeof live.session === "string" ? live.session : null;
    if (!session || !p.sessionDate || session <= p.sessionDate) return;
    const ix = { px: live.fields.indexOf("px"), chg: live.fields.indexOf("chg") };
    if (ix.px < 0) return;
    let hit = 0;
    for (const row of st.rows) {
      const v = live.rows[String(row.t || "").toUpperCase()];
      if (!Array.isArray(v)) continue;
      const px = num(v[ix.px]);
      if (px === null) continue;
      row.px = px;
      if (ix.chg >= 0 && num(v[ix.chg]) !== null) row.chg = num(v[ix.chg]);
      row.__live = true;
      hit++;
    }
    if (!hit) return;
    pollLive(Math.max(60, num(live.fresh && live.fresh.cadenceS) || 300) * 1000);
    table.dataset.live = "1";
    if (live.fresh && typeof live.fresh.readAt === "string") UI.freshness({ readAt: live.fresh.readAt, live: true, source: "strips" });
    refresh(["t", "px"], true);
  }

  function render() {
    statusEl.textContent = WATCH ? "Loading the session…" : "Loading the " + side + " board…";
    delete statusEl.dataset.empty;
    body.setAttribute("aria-busy", "true");
    const boardP = getJson("/api/flows/board?side=" + encodeURIComponent(side));
    const trackP = WATCH ? getJson("/api/flows/scoretrack").catch(() => null) : null;
    Promise.all([boardP, trackP]).then(([payload, track]) => {
      if (!payload) return;
      st.payload = payload;
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      railCount(payload, rows);
      UI.freshness({ sessionDate: payload.sessionDate, generatedAt: payload.generatedAt, updatedAt: payload.__updatedAt, source: "board" });
      const scoredN = num(payload.scored);

      if (!WATCH && !rows.length && scoredN > 0) {
        const neutralN = num(payload.neutral);
        const bandN = num(payload.deadBand);
        showSilence("No name on this side cleared " + (bandN === null ? "the dead band" : "the ±" + bandN + " band") +
          " this session. " + scoredN + " names were scored" + (neutralN === null ? "" : ", " + neutralN + " of them inside the band") +
          "; the other side may hold the rest.", "quiet");
        statusEl.textContent = "No " + side + " candidates this session · session " + (payload.sessionDate || "unknown") + ".";
        statusEl.dataset.empty = "quiet";
        setStale(UI.staleness(payload, Date.now(), { subject: "This board" }));
        return;
      }

      if (payload.status === "pending" || !rows.length) {
        const kind = payload.reason === "read-failed" ? "unreadable" : payload.status === "pending" ? "pending" : "unavailable";
        const said = WATCH
          ? (payload.status === "pending"
            ? "No watch list has been published yet. This list is built by the pipeline, which runs after the close on weekdays — it will appear after the first run following this deploy."
            : "No name was scored inside the band this session, which is unusual enough to be worth treating as a publishing fault rather than a reading.")
          : kind === "unreadable"
            ? "The store could not be read for this side, so whether a board is published is unknown. Refresh to try again."
            : kind === "pending"
              ? "No board has been published for this side yet. The first pipeline run stamps it."
              : "This side's board was published with no rows and no scored population to explain them, so this page cannot say whether the session was quiet or the run measured nothing.";
        showSilence(said, WATCH && kind === "unavailable" ? "unavailable" : kind);
        statusEl.textContent = WATCH ? "Nothing to watch."
          : kind === "unreadable" ? "The board store could not be read." : kind === "pending" ? "No board published yet." : "A board with no rows and no count.";
        statusEl.dataset.empty = kind;
        setStale(null);
        return;
      }

      clearSilence();
      st.horizon = num(payload.horizonSessions);
      st.knowsDeep = num(payload.deep) !== null;
      st.hasIdea = !WATCH && rows.some((r) => ideaOf(r));
      mem.rows = memoryState(rows);
      readMemoryBlock(payload);
      if (WATCH) takeTrack(track);
      st.rows = WATCH ? edgeOrder(rows) : rows;
      readUrl();
      if (st.sortKey && !sortable(colByKey(st.sortKey))) { st.sortKey = null; st.sortDir = "desc"; }
      writeUrl();
      buildHeader();
      buildTools();
      statusEl.textContent = WATCH ? watchStatus(payload, st.rows) : sideStatus(payload, st.rows);
      paintHead();
      paintRows(false);
      paintHero();
      setView(st.view);
      setStale(UI.staleness(payload, Date.now(), { subject: WATCH ? "This list" : "This board" }));
      loadExtras();
    }).catch(() => {
      showSilence(WATCH ? "The watch list could not be loaded. Refresh to try again." : "The board could not be loaded. Refresh to try again.", "unreadable");
      statusEl.textContent = WATCH ? "The watch list could not be loaded. Refresh to try again." : "Could not reach the board service.";
      statusEl.dataset.empty = "unreadable";
    }).finally(() => {
      body.removeAttribute("aria-busy");
    });
  }

  render();
})();
