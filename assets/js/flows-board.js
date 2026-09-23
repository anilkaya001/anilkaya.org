(() => {
  "use strict";

  const body = document.getElementById("flowsBody");
  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");
  const viewButtons = Array.from(document.querySelectorAll(".flows-view"));

  const SECTOR_TINT = new Map([
    ["information technology", "tech"], ["technology", "tech"],
    ["communication services", "comm"], ["communications", "comm"],
    ["consumer discretionary", "disc"], ["consumer cyclical", "disc"],
    ["consumer staples", "staples"], ["consumer defensive", "staples"],
    ["energy", "energy"],
    ["financials", "fin"], ["financial services", "fin"], ["financial", "fin"],
    ["health care", "health"], ["healthcare", "health"],
    ["industrials", "ind"],
    ["materials", "mat"], ["basic materials", "mat"],
    ["real estate", "re"],
    ["utilities", "util"],
  ]);

  const tintFor = (sector) => {
    const key = typeof sector === "string" ? sector.trim().toLowerCase() : "";
    const slug = key ? SECTOR_TINT.get(key) : undefined;
    return "var(--sect-" + (slug || "none") + ")";
  };

  function emphasisFor(view) {
    const col = sortKey ? colByKey(sortKey) : null;
    const get = col && sortable(col) && col.kind === "num"
      ? (row, index) => col.get(row, index)
      : (row) => isNum(row.cnv);
    let max = 0;
    const mags = view.map(({ row, index }) => {
      const raw = get(row, index);
      const mag = raw === null || raw === undefined || !isFinite(raw) ? null : Math.abs(raw);
      if (mag !== null && mag > max) max = mag;
      return mag;
    });
    return (i) => {
      const mag = mags[i];
      if (mag === null || max <= 0) return 0;
      return Math.pow(mag / max, 0.45);
    };
  }

  const ARRIVE_STEPS = 10;

  const deck = document.getElementById("flowsDeck");
  const tableWrap = document.getElementById("flowsTableWrap");
  if (!body || !statusEl) return;

  const UI = window.FlowsUI || null;
  if (UI) {
    UI.scrollHint(tableWrap);
    UI.scrollHint(document.querySelector(".flows-rail"));
  }

  const table = document.getElementById("flowsTable");
  const headCells = table
    ? Array.from(table.querySelectorAll("thead th"))
    : [];

  const COLUMNS = headCells.length || 10;
  const cache = new Map();
  const inflight = new Map();
  const side = initialSide();

  let painted = null;

  const MINUS = "−";
  const DASH = "—";

  const NO_CARD_SAID =
    "No detail card: the chain and the card cost vendor calls the run spends " +
    "only on the names furthest from neutral. This row is scored and ranked " +
    "from the same five sources as every other.";

  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
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

  function fmtPosition(v) {
    const n = isNum(v);
    return n === null ? DASH : Math.round(n * 100) + "%";
  }

  function fmtVolPoints(v) {
    const n = isNum(v);
    return n === null ? DASH : signed(n * 100, 1);
  }

  function cell(text, className, title) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    if (title) td.title = title;
    return td;
  }

  function convictionTitle(row) {
    const agree = isNum(row && row.agr);
    const breadth = isNum(row && row.bth);
    if (agree === null || breadth === null || breadth <= 0) return "";
    return agree + " of " + breadth + " signed axes agree, which is the heaviest of the " +
      "three terms behind this number. It is a COUNT out of " + breadth + ", so it moves in " +
      "steps and never smoothly, and two names a few points apart may differ by a whole axis " +
      "or by nothing but coverage. The full arithmetic is on the name's own card.";
  }

  function toneClass(v) {
    const n = isNum(v);
    if (n === null || n === 0) return "fb-flat";
    return n > 0 ? "fb-pos" : "fb-neg";
  }

  const EARNINGS_SOON_DAYS = 20;

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

  let rowMemory = "absent";
  let memoryStatus = null;
  let memoryNote = null;
  let priorSession = null;

  function comparand() {
    return priorSession ? "the " + priorSession + " board" : "the previously published board";
  }

  function readMemoryBlock(payload) {
    const block = payload && typeof payload.memory === "object" && payload.memory
      ? payload.memory : null;
    memoryStatus = block && typeof block.status === "string" ? block.status : null;
    memoryNote = block && typeof block.note === "string" && block.note ? block.note : null;

    priorSession = block && typeof block.sessionDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(block.sessionDate) ? block.sessionDate : null;
  }

  function memoryMark(row) {
    if (!row) return null;
    if (row.nw === true) {
      return {
        cls: "fb-mem is-new", glyph: "NEW",
        say: "new to this side: it was not on " + comparand(),
      };
    }
    const dr = isNum(row.dr);
    if (dr === null) return null;
    const places = (n) => n + (n === 1 ? " place" : " places");

    const from = isNum(row.r0);
    const now = isNum(row.r);
    const ends = from !== null && now !== null ? ", from rank " + from + " to rank " + now : "";
    if (dr > 0) {
      return { cls: "fb-mem is-up", glyph: "↑" + dr,
               say: "climbed " + places(dr) + " since " + comparand() + ends };
    }
    if (dr < 0) {
      return { cls: "fb-mem is-down", glyph: "↓" + Math.abs(dr),
               say: "fell " + places(Math.abs(dr)) + " since " + comparand() + ends };
    }
    return { cls: "fb-mem is-same", glyph: "=",
             say: "the same rank as on " + comparand() +
               (now === null ? "" : ", still rank " + now) };
  }

  function tenureMarks(row) {
    const out = [];
    if (row && row.hy === true) {
      out.push({
        cls: "fb-hold", glyph: "incumbent",
        say: "on the board on incumbency: it did not clear the entry rank this session " +
          "and sits inside the exit band, so it is on its way off",
      });
    }
    const dte = isNum(row && row.edte);
    if (dte !== null && dte >= 0 && dte <= EARNINGS_SOON_DAYS) {
      out.push({
        cls: "fb-earn", glyph: "earnings in " + dte + "d",
        say: "reports in " + dte + (dte === 1 ? " day" : " days") +
          (row.ed ? ", on " + row.ed : "") + ". Every name here cleared the earnings gate " +
          "for this session; this one clears it by days, so it is about to leave the board for " +
          "a calendar reason rather than a signal one",
      });
    }
    return out;
  }

  function markNode(mark) {
    const span = document.createElement("span");
    span.className = mark.cls;
    span.textContent = mark.glyph;
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", mark.say);
    span.title = mark.say.charAt(0).toUpperCase() + mark.say.slice(1) + ".";
    return span;
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

  let legacyFamilies = false;

  let horizonSessions = null;

  let knowsDeep = false;

  function familyGlyph(fam) {
    const keys = ["F", "P", "D", "V", "O"];
    const wrap = document.createElement("span");
    wrap.className = "fb-fam";
    const parts = [];
    for (const k of keys) {

      const gauge = k === "V" || k === "O";
      const n = legacyFamilies && gauge ? null : isNum(fam && fam[k]);
      const i = document.createElement("i");
      i.style.setProperty("--h", n === null ? 0 : Math.min(Math.abs(n) / 100, 1));

      if (n === null) i.className = "is-null";
      else if (gauge) i.className = "is-gauge";
      else if (n < 0) i.className = "is-neg";
      wrap.append(i);

      parts.push(k + " " + (n === null ? DASH : gauge ? String(n) : fmtSignedInt(n)));
    }

    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Family scores: " + parts.join(", "));
    wrap.title = parts.join("  ");
    return wrap;
  }

  function familyCell(fam) {
    const td = document.createElement("td");
    td.className = "c-num";
    td.append(familyGlyph(fam));
    return td;
  }

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function unpackSpark(str) {
    if (typeof str !== "string" || str.length < 4 || str.length % 2) return null;
    const out = [];
    for (let i = 0; i < str.length; i += 2) {
      const hi = B64.indexOf(str[i]), lo = B64.indexOf(str[i + 1]);
      if (hi < 0 || lo < 0) return null;
      out.push((hi << 6) | lo);
    }
    return out;
  }

  function sparkSvg(values, up) {
    const W = 120, H = 30, pad = 2;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fd-spark " + (up ? "is-pos" : "is-neg"));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const xOf = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);

    const yOf = (v) => pad + (1 - v / 4095) * (H - pad * 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "fd-sparkline");

    path.setAttribute("pathLength", "1");
    path.setAttribute("d", values.map((v, i) =>
      (i ? "L" : "M") + xOf(i).toFixed(1) + " " + yOf(v).toFixed(1)).join(" "));
    svg.append(path);
    return svg;
  }

  function retChip(label, bp) {
    const n = isNum(bp);
    const chip = document.createElement("div");
    chip.className = "fd-ret " + (n === null ? "is-flat" : n > 0 ? "is-pos" : n < 0 ? "is-neg" : "is-flat");
    const k = document.createElement("span");
    k.className = "fd-ret-k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "fd-ret-v";
    v.textContent = n === null ? DASH : (n < 0 ? MINUS : n > 0 ? "+" : "") + (Math.abs(n) / 100).toFixed(1) + "%";
    chip.append(k, v);
    return chip;
  }

  const readerHref = (t) =>
    "/flows/ticker/?t=" + encodeURIComponent(String(t || "")) +
    "&s=signal&from=" + encodeURIComponent(side);

  function deckCard(row, index, emph) {

    const deep = !knowsDeep || row.dp === 1;
    const card = document.createElement(deep ? "a" : "div");
    card.className = deep ? "fd-card" : "fd-card fd-flat";
    card.setAttribute("role", "listitem");
    if (deep) card.href = readerHref(row.t);

    card.dataset.flip = String(row.t || "");
    card.style.setProperty("--i", String(Math.min(index, ARRIVE_STEPS)));
    card.style.setProperty("--tint", tintFor(row.sector));
    card.style.setProperty("--emph", (emph === undefined ? 0 : emph).toFixed(3));

    const score = isNum(row.s);

    const head = document.createElement("div");
    head.className = "fd-head";
    const rank = document.createElement("span");
    rank.className = "fd-rank";
    rank.textContent = fmtInt(row.r != null ? row.r : index + 1);
    const tk = document.createElement("span");
    tk.className = "fd-tk";
    tk.textContent = String(row.t || DASH);
    const sc = document.createElement("span");
    sc.className = "fd-score " + toneClass(score);
    sc.textContent = score === null ? DASH : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    head.append(rank, tk, sc);
    card.append(head);

    if (typeof row.sector === "string" && row.sector.trim()) {
      const sect = document.createElement("div");
      sect.className = "fd-sect";
      sect.textContent = row.sector.trim();
      card.append(sect);
    }

    const memMarks = [memoryMark(row), ...tenureMarks(row)].filter(Boolean);
    if (memMarks.length) {
      const mem = document.createElement("div");
      mem.className = "fd-mem";
      for (const mark of memMarks) mem.append(markNode(mark));
      card.append(mem);
    }

    const price = document.createElement("div");
    price.className = "fd-price";
    const px = document.createElement("span");
    px.className = "fd-px";
    px.textContent = fmtPrice(row.px);
    const chg = document.createElement("span");
    chg.className = "fd-chg " + toneClass(row.chg);
    chg.textContent = fmtPct(row.chg, 2);
    price.append(px, chg);
    card.append(price);

    const spark = unpackSpark(row.spark);
    if (spark && spark.length >= 2) {
      card.append(sparkSvg(spark, spark[spark.length - 1] >= spark[0]));
    } else {
      const gap = document.createElement("div");
      gap.className = "fd-spark is-empty";
      card.append(gap);
    }

    const rets = document.createElement("div");
    rets.className = "fd-rets";
    const pr = Array.isArray(row.pr) ? row.pr : [];
    rets.append(retChip("5D", pr[0]), retChip("21D", pr[1]), retChip("42D", pr[2]));
    card.append(rets);

    const track = document.createElement("div");
    track.className = "fd-track";
    const zero = document.createElement("b");
    zero.className = "fd-zero";
    const bar = document.createElement("i");
    bar.className = score === null ? "is-flat"
      : score < 0 ? "is-neg" : score > 0 ? "is-pos" : "is-flat";
    bar.style.setProperty("--w", score === null ? 0 : Math.min(Math.abs(score) / 100, 1));
    track.append(zero, bar);
    card.append(track);

    const ev = document.createElement("div");
    ev.className = "fd-ev";
    ev.append(familyGlyph(row.fam));
    const prem = document.createElement("span");
    prem.className = "fd-prem " + toneClass(row.netPrem);
    prem.textContent = fmtMoney(row.netPrem);
    prem.title = "Net premium: call premium bought minus put premium bought, " +
      "summed across the session. The sign is the direction of the money.";
    ev.append(prem);
    card.append(ev);

    const foot = document.createElement("div");
    foot.className = "fd-foot";
    const conv = document.createElement("span");
    conv.textContent = isNum(row.cnv) === null ? DASH : row.cnv + " conv";

    const convWhy = convictionTitle(row);
    if (convWhy) conv.title = convWhy;

    const move = document.createElement("span");
    move.className = "fd-move";
    const hmN = isNum(row.hm);
    if (hmN === null) {

      move.textContent = "\u00b1" + DASH;
      move.dataset.empty = "unavailable";
      move.title = "No priced move on this row: the run had no usable 30-day implied " +
        "volatility for this name to scale to the board's horizon.";
    } else {
      move.textContent = "\u00b1" + (hmN * 100).toFixed(1) + "% priced";
      move.title = horizonSessions
        ? `The option market prices ±${(hmN * 100).toFixed(1)}% over ${horizonSessions} trading sessions` +
          (isNum(row.hr) !== null ? `; this name has delivered ±${(row.hr * 100).toFixed(1)}% over the same horizon.` : ".")
        : "";
    }

    const reg = document.createElement("span");
    reg.textContent = regimeText(row.gRegime);
    foot.append(conv, move, reg);
    card.append(foot);

    card.setAttribute("aria-label",
      `${row.t}, rank ${row.r != null ? row.r : index + 1}, score ${score === null ? "unavailable" : score}, ` +
      `last ${fmtPrice(row.px)}, ${fmtPct(row.chg, 2)} today, conviction ${row.cnv}` +

      (isNum(row.agr) === null || isNum(row.bth) === null
        ? ". "
        : `, with ${row.agr} of ${row.bth} signed axes agreeing. `) +
      (hmN === null ? `Priced move unavailable. `
        : `The option market prices plus or minus ${(hmN * 100).toFixed(1)} percent over ` +
          `${horizonSessions || 10} trading sessions. `) +

      (memMarks.length ? memMarks.map((m) => m.say).join("; ") + ". " : "") +
      (isNum(row.netPrem) === null
        ? `Net premium unavailable. `
        : `Net premium ${fmtMoney(row.netPrem)}. `) +
      (deep ? `Open the full reader for ${row.t}.` : NO_CARD_SAID));
    return card;
  }

  function regimeText(v) {
    if (v === "long") return "long Γ";
    if (v === "short") return "short Γ";
    return DASH;
  }

  const RANK = (row, index) => (row.r != null ? isNum(row.r) : index + 1);

  const COLS = [
    { key: "r",     kind: "num",  first: "asc",  name: "Rank", get: RANK },
    { key: "t",     kind: "text", first: "asc",  name: "Ticker", get: (row) => (row.t ? String(row.t) : null) },

    { key: "px",    kind: "num",  first: "desc", name: "Last price", get: (row) => isNum(row.px) },
    { key: "s",     kind: "num",  first: "desc", name: "Score", get: (row) => isNum(row.s) },
    { key: "cnv",   kind: "num",  first: "desc", name: "Conviction", get: (row) => isNum(row.cnv) },
    null,

    { key: "purity", kind: "num", first: "desc", name: "Purity", withheld: () => legacyFamilies,
      get: (row) => (legacyFamilies ? null : isNum(row.purity)) },
    { key: "gRegime", kind: "text", first: "asc", name: "Gamma regime",
      get: (row) => (row.gRegime === "long" || row.gRegime === "short" ? row.gRegime : null) },
    { key: "gFlipDist", kind: "num", first: "desc", name: "Distance to the gamma flip", get: (row) => isNum(row.gFlipDist) },
    { key: "netPrem", kind: "num", first: "desc", name: "Net premium", get: (row) => isNum(row.netPrem) },
    { key: "w52",   kind: "num",  first: "desc", name: "52-week range position", get: (row) => isNum(row.w52) },
    { key: "vrp",   kind: "num",  first: "desc", name: "Implied minus realised volatility", get: (row) => isNum(row.vrp) },
    { key: "ivr",   kind: "num",  first: "desc", name: "Implied volatility rank", get: (row) => isNum(row.ivr) },
  ];

  const EXTRA_CELLS = [
    { at: 10, build: (row) => cell(fmtPosition(row.w52), "c-num") },
    { at: 11, build: (row) => cell(fmtVolPoints(row.vrp), "c-num") },
    { at: 12, build: (row) => cell(fmtPosition(row.ivr), "c-num") },
  ];

  let sortKey = null;
  let sortDir = "desc";
  let currentRows = [];

  let filterText = "";

  const EXTRA_SORTS = [
    {
      key: "dr", virtual: true, kind: "num", first: "desc",
      name: "Places climbed since the previous board",
      get: (row) => isNum(row.dr),
      available: (rows) => !rows.length || rows.some((r) => r && isNum(r.dr) !== null),
    },
    {
      key: "nw", virtual: true, kind: "num", first: "desc",
      name: "New to this side today",

      get: (row) => (row.nw === true ? 1 : row.nw === false ? 0 : null),
      available: (rows) => !rows.length || rows.some((r) => r && (r.nw === true || r.nw === false)),
    },
    {
      key: "edte", virtual: true, kind: "num", first: "asc",
      name: "Days to earnings",

      get: (row) => { const n = isNum(row.edte); return n === null || n < 0 ? null : n; },
      available: (rows) => !rows.length ||
        rows.some((r) => { const n = isNum(r && r.edte); return n !== null && n >= 0; }),
    },
  ];

  const colByKey = (key) =>
    COLS.find((c) => c && c.key === key) || EXTRA_SORTS.find((c) => c.key === key) || null;

  const colIndex = (key) => COLS.findIndex((c) => c && c.key === key);

  function sortable(col) {
    if (!col) return false;

    if (col.virtual) return typeof col.available === "function" ? col.available(currentRows) : true;
    const i = colIndex(col.key);
    if (i < 0 || i >= headCells.length) return false;
    return !(col.withheld && col.withheld());
  }

  function compareBy(col, dir, a, b, ai, bi) {
    const x = col.get(a, ai);
    const y = col.get(b, bi);
    const xn = x === undefined ? null : x;
    const yn = y === undefined ? null : y;
    if (xn === null && yn === null) return 0;
    if (xn === null) return 1;
    if (yn === null) return -1;
    const d = col.kind === "text"
      ? String(xn).localeCompare(String(yn))
      : xn - yn;
    return dir === "asc" ? d : -d;
  }

  function orderedRows() {

    const view = [];
    currentRows.forEach((row, index) => {
      if (filterText && !String((row && row.t) || "").toUpperCase().includes(filterText)) return;
      view.push({ row, index });
    });
    const col = sortKey ? colByKey(sortKey) : null;
    if (!col || !sortable(col)) return view;

    view.sort((p, q) => compareBy(col, sortDir, p.row, q.row, p.index, q.index) || p.index - q.index);
    return view;
  }

  function readSort() {
    try {
      const q = new URL(location.href).searchParams;
      const col = colByKey(q.get("sort"));
      if (!col) return;

      if (colIndex(col.key) >= headCells.length) return;

      if (!sortable(col)) return;
      sortKey = col.key;
      sortDir = q.get("dir") === "asc" ? "asc" : q.get("dir") === "desc" ? "desc" : col.first;
    } catch {   }
  }

  function writeSort() {
    try {
      const url = new URL(location.href);
      if (sortKey) {
        url.searchParams.set("sort", sortKey);
        url.searchParams.set("dir", sortDir);
      } else {
        url.searchParams.delete("sort");
        url.searchParams.delete("dir");
      }
      history.replaceState(null, "", url);
    } catch {   }
  }

  function toggleSort(key) {
    const col = colByKey(key);
    if (!col || !sortable(col)) return;
    if (sortKey !== key) { sortKey = key; sortDir = col.first; }
    else if (sortDir === col.first) { sortDir = col.first === "desc" ? "asc" : "desc"; }
    else { sortKey = null; sortDir = "desc"; }
    writeSort();
    syncHeaders();

    syncSortSelect();
    paintRows();
  }

  function syncHeaders() {
    headCells.forEach((th, i) => {
      const col = COLS[i];
      const button = th.querySelector(".fb-sort");

      if (!col || !button) { th.removeAttribute("aria-sort"); return; }

      const live = sortable(col);
      const on = live && sortKey === col.key;
      button.disabled = !live;
      if (!live) th.removeAttribute("aria-sort");
      else th.setAttribute("aria-sort", on ? (sortDir === "asc" ? "ascending" : "descending") : "none");
      const ind = button.querySelector(".fb-sort-ind");
      if (ind) ind.textContent = on ? (sortDir === "asc" ? "↑" : "↓") : "";

      button.setAttribute("aria-label",
        (col.name || (th.textContent || col.key).replace(/[↑↓]/g, "").trim()) + ": " +
        (on
          ? "sorted " + (sortDir === "asc" ? "ascending" : "descending") +
            ", activate to " + (sortDir === col.first ? "reverse" : "return to the published rank")
          : sortable(col)
            ? "activate to sort"
            : "not sortable on this board"));
    });
  }

  function wireHeaders() {
    headCells.forEach((th, i) => {
      const col = COLS[i];
      if (!col) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fb-sort";
      while (th.firstChild) button.append(th.firstChild);
      const ind = document.createElement("span");
      ind.className = "fb-sort-ind";
      ind.setAttribute("aria-hidden", "true");
      button.append(ind);
      button.addEventListener("click", () => toggleSort(col.key));
      th.append(button);
    });
    syncHeaders();
  }

  let controlsBuilt = false;
  let sortSelectEl = null;
  let countEl = null;
  let memNoteEl = null;

  const SORT_CHOICES = [
    { key: null,      dir: "desc", label: "Published rank" },
    { key: "s",       dir: "desc", label: "Score, strongest first" },
    { key: "cnv",     dir: "desc", label: "Conviction, highest first" },
    { key: "dr",      dir: "desc", label: "Biggest climb since the previous board" },
    { key: "nw",      dir: "desc", label: "New to this side first" },
    { key: "edte",    dir: "asc",  label: "Closest to earnings first" },
    { key: "netPrem", dir: "desc", label: "Net premium, largest first" },
    { key: "t",       dir: "asc",  label: "Ticker, A to Z" },
  ];

  const choiceValue = (key, dir) => (key ? key + ":" + dir : "");

  function applySortValue(value) {
    const parts = String(value || "").split(":");
    const col = parts[0] ? colByKey(parts[0]) : null;
    if (!col || !sortable(col)) { sortKey = null; sortDir = "desc"; }
    else { sortKey = col.key; sortDir = parts[1] === "asc" ? "asc" : "desc"; }
    writeSort();
    syncHeaders();
    syncSortSelect();
    paintRows();
  }

  function syncSortSelect() {
    if (!sortSelectEl) return;
    const want = choiceValue(sortKey, sortDir);
    const curated = Array.prototype.some.call(sortSelectEl.options,
      (o) => o.value === want && o.dataset.adhoc !== "1");
    let adhoc = sortSelectEl.querySelector('option[data-adhoc="1"]');
    if (curated) {
      if (adhoc) adhoc.remove();
    } else {
      if (!adhoc) {
        adhoc = document.createElement("option");
        adhoc.dataset.adhoc = "1";
        sortSelectEl.append(adhoc);
      }
      const col = colByKey(sortKey);
      adhoc.value = want;
      adhoc.textContent = (col && col.name ? col.name : "This board") +
        (sortDir === "asc" ? ", low to high" : ", high to low");
    }
    sortSelectEl.value = want;
  }

  const typedEcho = () =>
    "\u201c" + (filterText.length > 12 ? filterText.slice(0, 12) + "\u2026" : filterText) + "\u201d";

  function updateCount(shown) {
    if (!countEl) return;
    if (!filterText) { countEl.hidden = true; countEl.textContent = ""; return; }
    countEl.hidden = false;
    countEl.textContent = shown + " of " + currentRows.length + " names match " + typedEcho();
  }

  function buildControls() {
    if (controlsBuilt) return;
    const host = document.querySelector(".flows-controls");
    if (!host || !UI || typeof UI.searchBox !== "function" || typeof UI.sortSelect !== "function") return;
    controlsBuilt = true;

    const wrap = UI.el("div", "st-controls fb-controls");
    const search = UI.searchBox({
      label: "Find", placeholder: "Ticker", prefix: "st", id: "fbQ",

      onInput: (v) => { filterText = String(v || "").trim().toUpperCase(); paintRows(); },
    });

    const sort = UI.sortSelect({
      label: "Order", prefix: "st", id: "fbSort",
      options: SORT_CHOICES
        .filter((c) => !c.key || sortable(colByKey(c.key)))
        .map((c) => ({ value: choiceValue(c.key, c.dir), label: c.label })),
      onChange: applySortValue,
    });
    sortSelectEl = sort.select;

    countEl = UI.el("span", "fb-count");
    countEl.setAttribute("role", "status");
    countEl.hidden = true;

    wrap.append(search.root, sort.root, countEl);

    host.parentNode.insertBefore(wrap, host.nextSibling);
    syncSortSelect();
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
    "The run that published this board reported the comparison as \u201c" +
    String(status).slice(0, 32) + "\u201d and sent no sentence with it, so that one word is " +
    "all this page has: no name here claims to be new and no rank move is drawn. It does not " +
    "say why beyond that, and only the run that wrote it saw the earlier board.";

  const UNDATED_UNSAID =
    "This run could not date the board it compared against, and said no more than that. The " +
    "marks here are a comparison against a board this page cannot name, rather than against a " +
    "named session: read them as unverified.";

  function memoryNoteFor() {
    if (memoryStatus === "ok") return null;

    const published = typeof memoryNote === "string" && memoryNote.trim() !== "" ? memoryNote : null;
    if (memoryStatus !== null) {
      const tag = MEMORY_EMPTY[memoryStatus];
      const caveat = memoryStatus === "undated";
      if (published) {
        return {
          status: memoryStatus, text: published, caveat,
          tag: tag === undefined ? "unavailable" : tag,
        };
      }

      if (rowMemory === "warm") {
        return caveat
          ? { status: memoryStatus, text: UNDATED_UNSAID, tag: null, caveat: true }
          : null;
      }
      return {
        status: memoryStatus, text: statusOnlySaid(memoryStatus), caveat: false,
        tag: tag === undefined ? "unavailable" : tag,
      };
    }
    if (rowMemory === "warm") return null;
    return rowMemory === "absent"
      ? { status: "pre-memory", text: PRE_MEMORY_SAID, tag: "unavailable", caveat: false }
      : { status: "unstated", text: COLD_UNSTATED_SAID, tag: "unavailable", caveat: false };
  }

  function setMemoryNote() {
    const anchor = deck || tableWrap;
    const say = memoryNoteFor();
    if (!say || !anchor || !anchor.parentNode) {
      if (memNoteEl) { memNoteEl.remove(); memNoteEl = null; }
      return;
    }
    if (!memNoteEl) {
      memNoteEl = document.createElement("p");
      anchor.parentNode.insertBefore(memNoteEl, anchor);
    }
    memNoteEl.className = "flows-empty fb-memnote" + (say.caveat ? " is-caveat" : "");

    memNoteEl.dataset.memory = say.status;
    if (say.tag) memNoteEl.dataset.empty = say.tag;
    else delete memNoteEl.dataset.empty;
    memNoteEl.textContent = say.text;
  }

  function rowFor(row, index) {
    const tr = document.createElement("tr");
    tr.className = "fb-row";

    if (row.hy === true) tr.classList.add("is-holdover");

    const rankCell = cell(fmtInt(row.r != null ? row.r : index + 1), "c-rank");
    const move = memoryMark(row);
    if (move) rankCell.append(markNode(move));
    tr.append(rankCell);

    const tk = document.createElement("td");
    tk.className = "fb-tk";

    const deep = !knowsDeep || row.dp === 1;
    const open = document.createElement(deep ? "a" : "span");
    open.className = deep ? "fb-open" : "fb-open fb-flat";
    open.textContent = String(row.t || DASH);
    if (deep) {
      open.href = readerHref(row.t);
      open.title = "Open the full reader for " + String(row.t || "");
    } else {
      open.title = NO_CARD_SAID;
    }
    tk.append(open);

    for (const mark of tenureMarks(row)) tk.append(markNode(mark));
    tr.append(tk);

    const px = document.createElement("td");
    px.className = "c-num";
    px.textContent = fmtPrice(row.px);
    const chg = document.createElement("span");
    chg.className = " " + toneClass(row.chg);
    chg.textContent = "  " + fmtPct(row.chg, 2);
    px.append(chg);
    tr.append(px);

    tr.append(scoreCell(row.s));
    tr.append(cell(fmtInt(row.cnv), "c-num", convictionTitle(row) || undefined));
    tr.append(familyCell(row.fam));

    tr.append(cell(legacyFamilies ? DASH : fmtRatio(row.purity), "c-num"));

    tr.append(cell(regimeText(row.gRegime), "c-num fb-flat"));
    tr.append(cell(row.gFlipDist == null ? DASH : fmtPct(row.gFlipDist, 1), "c-num"));
    tr.append(cell(fmtMoney(row.netPrem), "c-num " + toneClass(row.netPrem)));

    for (const extra of EXTRA_CELLS) {
      if (extra.at < headCells.length) tr.append(extra.build(row));
    }
    return tr;
  }

  function assessAge(payload) {
    if (!UI || typeof UI.staleness !== "function") {
      return {
        kind: "unavailable",
        message: "The freshness check could not run: this page's shared UI module " +
          "(flows-ui.js) is not loaded, so nothing here is confirmed to be today's. " +
          "The session date in the line above is the payload's own claim about itself.",
      };
    }
    return UI.staleness(payload, Date.now(), { subject: "This board" });
  }

  function setStale(verdict) {
    if (!staleEl) return;
    const message = verdict && verdict.message ? verdict.message : "";
    staleEl.hidden = !message;
    staleEl.textContent = message;
    if (message) staleEl.dataset.stale = (verdict && verdict.kind) || "stale";
    else delete staleEl.dataset.stale;
    document.body.classList.toggle("is-stale", Boolean(message));
  }

  function showMessage(text, kind) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "fb-empty";
    td.colSpan = COLUMNS;
    td.textContent = text;

    if (kind) td.dataset.empty = kind;
    tr.append(td);
    body.replaceChildren(tr);

    if (deck) {
      const note = document.createElement("p");
      note.className = "fb-empty";
      note.textContent = text;
      if (kind) note.dataset.empty = kind;
      deck.replaceChildren(note);
    }
  }

  let deckPainted = false;
  let flipFrame = 0;

  function flipDeck(draw) {
    const animate = deckPainted && deck && !calm.matches;
    if (!animate) {
      draw();

      if (deck && !deckPainted && !calm.matches) {
        for (const card of deck.children) card.classList.add("is-arriving");
      }
      deckPainted = true;
      return;
    }

    clearFlip();

    const before = new Map();
    for (const card of deck.children) {
      if (card.dataset.flip) before.set(card.dataset.flip, card.getBoundingClientRect());
    }

    draw();

    const moves = [];
    for (const card of deck.children) {
      const prev = before.get(card.dataset.flip);
      if (!prev) continue;
      const now = card.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      moves.push({ card, dx, dy });
    }
    if (!moves.length) return;
    for (const { card, dx, dy } of moves) {
      card.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    }

    flipFrame = requestAnimationFrame(() => {
      flipFrame = 0;
      for (const { card } of moves) {
        card.classList.add("is-flipping");
        card.style.transform = "";
      }
    });
  }

  function clearFlip() {
    if (flipFrame) { cancelAnimationFrame(flipFrame); flipFrame = 0; }
    if (!deck) return;
    for (const card of deck.querySelectorAll(".fd-card.is-flipping")) {
      card.classList.remove("is-flipping");
      card.style.removeProperty("transform");
    }
  }

  if (deck) {

    const settleFlip = (event) => {
      if (event.propertyName !== "transform") return;
      const card = event.target;
      if (card && card.classList && card.classList.contains("is-flipping")) {
        card.classList.remove("is-flipping");
      }
    };
    deck.addEventListener("transitionend", settleFlip);
    deck.addEventListener("transitioncancel", settleFlip);

    deck.addEventListener("animationend", (event) => {
      const card = event.target && event.target.closest && event.target.closest(".fd-card");
      if (!card || !card.classList.contains("is-arriving")) return;
      if (event.animationName === "fd-draw"
          || (event.animationName === "fd-arrive" && !card.querySelector(".fd-sparkline"))) {
        card.classList.remove("is-arriving");
      }
    });
  }

  function paintRows() {

    if (!currentRows.length) return;
    const view = orderedRows();
    updateCount(view.length);

    if (!view.length) {
      showMessage("No name on this board matches " + typedEcho() + ". All " +
        currentRows.length + " rows are still loaded — clear the field to see them.", "filtered");
      return;
    }
    const tableFrag = document.createDocumentFragment();
    for (const { row, index } of view) tableFrag.append(rowFor(row, index));
    body.replaceChildren(tableFrag);
    if (deck) {

      const emphasis = emphasisFor(view);
      flipDeck(() => {
        const deckFrag = document.createDocumentFragment();
        view.forEach(({ row, index }, i) => deckFrag.append(deckCard(row, index, emphasis(i))));
        deck.replaceChildren(deckFrag);
      });
    }
  }

  function initialSide() {
    try {
      if (/\/flows\/short\/?$/.test(location.pathname)) return "short";
      if (/\/flows\/long\/?$/.test(location.pathname)) return "long";
      const q = new URLSearchParams(location.search).get("side");
      return q === "short" ? "short" : "long";
    } catch { return "long"; }
  }

  function load(which) {
    if (cache.has(which)) return Promise.resolve(cache.get(which));

    const pending = inflight.get(which);
    if (pending) return pending.promise;

    const controller = new AbortController();
    const promise = fetch("/api/flows/board?side=" + encodeURIComponent(which), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then((response) => {
      if (response.status === 401) {

        location.replace("/flows/");
        return null;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);

      const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
      return response.json().then((body) => {
        if (body && typeof body === "object") body.__updatedAt = updatedAt;
        return body;
      });
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

    delete statusEl.dataset.empty;

    if (painted !== null && painted !== which) {
      body.replaceChildren();
      if (deck) deck.replaceChildren();
      painted = null;
    }
    body.setAttribute("aria-busy", "true");

    for (const [key, entry] of inflight) {
      if (key !== which) { entry.controller.abort(); inflight.delete(key); }
    }

    load(which).then((payload) => {
      if (which !== side || !payload) return;

      const rows = Array.isArray(payload.rows) ? payload.rows : [];

      const slot = document.querySelector('[data-rail-count="' + which + '"]');

      const scoredN = isNum(payload.scored);
      if (slot && (rows.length || scoredN > 0)) {
        const clearedN = isNum(payload.cleared);
        slot.textContent = String(clearedN === null ? rows.length : clearedN);
        slot.hidden = false;
      }

      if (!rows.length && scoredN > 0) {

        const neutralN = isNum(payload.neutral);
        const bandN = isNum(payload.deadBand);
        showMessage(
          "No name on this side cleared " +
          (bandN === null ? "the dead band" : "the ±" + bandN + " band") + " this session. " +
          scoredN + " names were scored" +
          (neutralN === null ? "" : ", " + neutralN + " of them inside the band") +
          "; the other side may hold the rest.",

          "quiet",
        );
        statusEl.textContent =
          "No " + which + " candidates this session · session " +
          (payload.sessionDate || "unknown") + ".";
        statusEl.dataset.empty = "quiet";
        setStale(assessAge(payload));
        painted = which;
        return;
      }

      if (payload.status === "pending" || !rows.length) {

        const kind = payload.reason === "read-failed" ? "unreadable"
          : payload.status === "pending" ? "pending" : "unavailable";
        showMessage(
          kind === "unreadable"
            ? "The store could not be read for this side, so whether a board is published " +
              "is unknown. Refresh to try again."
            : kind === "pending"
              ? "No board has been published for this side yet. The first pipeline run stamps it."
              : "This side's board was published with no rows and no scored population to " +
                "explain them, so this page cannot say whether the session was quiet or the " +
                "run measured nothing.",
          kind,
        );
        statusEl.textContent = kind === "unreadable" ? "The board store could not be read."
          : kind === "pending" ? "No board published yet." : "A board with no rows and no count.";
        statusEl.dataset.empty = kind;
        setStale(null);
        return;
      }

      legacyFamilies = (isNum(payload.v) ?? 1) < 2;
      horizonSessions = isNum(payload.horizonSessions);
      knowsDeep = isNum(payload.deep) !== null;

      currentRows = rows;

      rowMemory = memoryState(rows);

      readMemoryBlock(payload);
      setMemoryNote();

      buildControls();

      if (sortKey && !sortable(colByKey(sortKey))) { sortKey = null; sortDir = "desc"; writeSort(); }
      syncHeaders();
      syncSortSelect();
      paintRows();
      painted = which;

      const when = (UI && UI.fmtStamp(payload.generatedAt)) || "an unknown time";

      const parts = [
        rows.length + " " + which + " candidate" + (rows.length === 1 ? "" : "s"),
        "session " + (payload.sessionDate || "unknown"),
      ];
      if (isNum(payload.neutral) !== null && isNum(payload.deadBand) !== null) {
        parts.push(payload.neutral + " of " + (payload.scored || "?") +
          " inside the ±" + payload.deadBand + " band");
      }

      const shed = isNum(payload.shed);
      if (shed !== null && shed > 0) {
        const cleared = isNum(payload.cleared);
        parts.push(shed + " more cleared the band and did not fit" +
          (cleared === null ? "" : " (" + rows.length + " of " + cleared + " shown)"));
      }

      if (rowMemory === "warm") {
        const fresh = rows.filter((r) => r && r.nw === true).length;
        const incumbent = rows.filter((r) => r && r.hy === true).length;
        parts.push((fresh === 0 ? "no new names on this side" : fresh + " new to this side") +
          " since " + comparand());
        if (incumbent > 0) parts.push(incumbent + " held on incumbency");
      }

      if (isNum(payload.dispersion) !== null) {

        parts.push("spread " + payload.dispersion.toFixed(2) +
          " composite units (95th pct of |residual|, not the score's scale)");
      }
      parts.push("built " + when);
      statusEl.textContent = parts.join(" · ") + ".";
      if (UI && UI.keepDates) UI.keepDates(statusEl);
      setStale(assessAge(payload));
    }).catch((error) => {
      if (error && error.name === "AbortError") return;

      showMessage("The board could not be loaded. Refresh to try again.", "unreadable");
      statusEl.textContent = "Could not reach the board service.";
      statusEl.dataset.empty = "unreadable";
    }).finally(() => {
      body.removeAttribute("aria-busy");
    });
  }

  function readView() {
    try {
      const v = new URL(location.href).searchParams.get("view");
      return v === "table" ? "table" : "deck";
    } catch { return "deck"; }
  }

  function selectView(which) {
    const view = which === "table" ? "table" : "deck";
    if (deck) deck.hidden = view !== "deck";
    if (tableWrap) tableWrap.hidden = view !== "table";
    for (const button of viewButtons) {
      const on = button.dataset.view === view;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    try {
      const url = new URL(location.href);

      if (view === "table") url.searchParams.set("view", "table");
      else url.searchParams.delete("view");
      history.replaceState(null, "", url);
    } catch {   }
  }

  for (const button of viewButtons) {
    button.addEventListener("click", () => selectView(button.dataset.view));
  }
  selectView(readView());

  wireHeaders();
  readSort();
  syncHeaders();

  const fine = window.matchMedia("(pointer: fine)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  let spotlightOn = false;
  let frame = 0;
  let pending = null;

  function onPointerMove(event) {
    const card = event.target.closest && event.target.closest(".fd-card");
    if (!card) return;
    pending = { card, x: event.clientX, y: event.clientY };

    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pending) return;
      const { card: target, x, y } = pending;
      const box = target.getBoundingClientRect();
      if (!box.width || !box.height) return;
      target.style.setProperty("--mx", (((x - box.left) / box.width) * 100).toFixed(1));
      target.style.setProperty("--my", (((y - box.top) / box.height) * 100).toFixed(1));
    });
  }

  function syncSpotlight() {

    if (calm.matches) {
      clearFlip();
      if (deck) {
        for (const card of deck.querySelectorAll(".fd-card.is-arriving")) {
          card.classList.remove("is-arriving");
        }
      }
    }
    const want = fine.matches && !calm.matches;
    if (want === spotlightOn || !deck) return;
    spotlightOn = want;
    if (want) {
      deck.addEventListener("pointermove", onPointerMove, { passive: true });
    } else {
      deck.removeEventListener("pointermove", onPointerMove);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      pending = null;

      for (const card of deck.querySelectorAll(".fd-card")) {
        card.style.removeProperty("--mx");
        card.style.removeProperty("--my");
      }
    }
  }
  for (const query of [fine, calm]) {
    if (query.addEventListener) query.addEventListener("change", syncSpotlight);
    else if (query.addListener) query.addListener(syncSpotlight);
  }
  syncSpotlight();

  render(side);
})();
