(() => {
  "use strict";

  const MINUS = "−", DASH = "—";
  const HALF = 100;
  const ARROW_MAX = 20;
  const ARROW_COMPACT = 9;
  const ARROW_MIN = 1.5;
  const GLYPH = { pass: "✓", fail: "✕", absent: "○" };
  const STATE_WORD = { pass: "passes", fail: "fails", absent: "not checked" };
  const WORDS = {
    loading: "Loading the ledger…",
    retry: "Retry",
    failed: (clock) => "The record was unreadable at " + clock + ". No figures are shown rather than old ones.",
    view: { all: "Sectors", sector: "Names", name: "Windows" },
    drill: (label) => "Open " + label,
    summary: (head, pass, fail, absent) => head + " · " + pass + " pass" + (fail ? " · " + fail + " fail" : "") + (absent ? " · " + absent + " not checked" : ""),
    scaleHead: (text, unit) => unit + ", ±" + text,
    namesHead: ["Name", "Win.", "Premium", "Calls", "Puts", "Cap share", "Tilt"],
    windowsHead: ["Window (TRT)", "Contract", "Premium", "Ask side", "Bid side"],
    total: "Total",
    totalAll: "Total, all rows",
    showAll: (n) => "Show all " + n,
    heldBand: "Held windows",
    sideBand: "Side unknown",
    outBand: "Outside held windows",
    buyers: "Buyers",
    sellers: "Sellers",
    noside: "held",
    outside: "outside",
    held: "held",
    checksShort: "Checks",
    valve: "Ledger, scrollable",
    keyShort: "Minus (−) means paid. Plus (+) means received.",
    leanNone: "Waiting for the first held window.",
    tickNote: "The tick assumes unknown premium splits the same way.",
    nameBand: "Names carry no determination band, so no verdict.",
    group: { held: "Held", noside: "Side unknown", outside: "Outside" },
    proof: { up: ["▲", "Sign holds for any split"], down: ["▼", "Sign holds for any split"], open: ["◇", "Sign undecided: side unknown is as large"], even: ["=", "Net is zero"] },
    strip: {
      held: (h, t) => (t === null ? h + " held, shed count not recorded" : t > h ? h + " of " + t + " held" : h + " held"),
      tide: (at) => (at ? "as of " + at : "no sector tide"),
      windows: (at) => (at ? "as of " + at : "no window time"),
      unreadable: "not readable",
      quiet: "no held windows",
      pending: "not read yet",
      pollOk: (at) => at,
      pollLate: (at) => "late, " + at,
      pollNone: (at) => "no reply since " + at,
      pollPaused: (at) => "paused, " + at,
      pollOffline: (at) => "offline, last " + at,
      pollClosed: (at) => "closed, " + at,
    },
  };

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pad2 = (n) => String(n).padStart(2, "0");

  function tiltBar(c, w, scale, verdict) {
    const u = (v) => Math.max(-HALF, Math.min(HALF, (HALF * v) / scale));
    const lo = u(c - w);
    const hi = u(c + w);
    const mid = u(c);
    let fill = null;
    if (verdict === "above") fill = { x: 0, width: u(c - w) };
    else if (verdict === "below") fill = { x: u(c + w), width: -u(c + w) };
    return { lo, hi, mid, fill };
  }

  function nameBar(c, scale) {
    const m = Math.max(-HALF, Math.min(HALF, (HALF * c) / scale));
    return { x: Math.min(0, m), width: Math.abs(m), mid: m };
  }

  function arrowWidths(cents, max, cap = ARROW_MAX) {
    return cents.map((c) => (max > 0 && c > 0 ? Math.max(ARROW_MIN, (cap * c) / max) : 0));
  }

  function nextCell(grid, r, c, key) {
    const rows = grid.length;
    if (!rows) return null;
    const cols = grid[0].length;
    if (key === "Home" || key === "End") {
      for (let k = key === "Home" ? 0 : cols - 1; k >= 0 && k < cols; k += key === "Home" ? 1 : -1) if (grid[r][k]) return [r, k];
      return null;
    }
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key];
    if (!step) return null;
    let i = r + step[0], j = c + step[1];
    while (i >= 0 && i < rows && j >= 0 && j < cols) {
      if (grid[i][j]) return [i, j];
      i += step[0];
      j += step[1];
    }
    return null;
  }

  function parseHash(hash) {
    const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    const period = p.get("period");
    return { scope: p.get("scope") || "all", period: period === "intraday" || period === "session" || period === "five" ? period : null, w: p.get("w") === "flow" ? "flow" : "table" };
  }

  function hashOf(scope, period, w) {
    const p = new URLSearchParams();
    if (scope && scope !== "all") p.set("scope", scope);
    if (period) p.set("period", period);
    if (w === "flow") p.set("w", "flow");
    const text = p.toString();
    return text ? "#" + text : "";
  }

  if (typeof document === "undefined") {
    globalThis.__LedgerTest = Object.freeze({ tiltBar, nameBar, arrowWidths, nextCell, parseHash, hashOf, HALF, ARROW_MAX, ARROW_MIN });
    return;
  }

  const UI = window.FlowsUI;
  const root = document.getElementById("sf");
  if (!UI || !root) return;
  const $ = (id) => document.getElementById(id);
  const small = () => matchMedia("(max-width:899px)").matches;
  const short = () => matchMedia("(max-width:899px) and (max-height:720px)").matches;
  const clockOf = (ms) => {
    const d = new Date(ms + 3 * 3600 * 1000);
    return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + " TRT";
  };

  const S = { scope: "all", period: null, w: "table", group: "held", tab: "balance", data: null, seq: 0, beat: null, ff: null, recv: null, recvAt: 0, shownAt: Date.now(), cad: 60000, key: null };

  function readHash() {
    const h = parseHash(location.hash);
    S.scope = h.scope;
    S.period = h.period;
    S.w = h.w;
  }

  function writeHash() {
    const next = hashOf(S.scope, S.period, S.w);
    if (next !== (location.hash || "")) history.replaceState(null, "", location.pathname + location.search + next);
  }

  const say = (text) => { const el = $("sfStatus"); if (el.textContent !== text) el.textContent = text; };

  const put = (el, text) => {
    if (el.textContent === text) return false;
    el.textContent = text;
    return true;
  };

  const attr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };

  const data = (el, key, value) => { if (el.dataset[key] !== value) el.dataset[key] = value; };

  const fits = new Map();

  let watch = null;

  function spills(el) {
    const cs = getComputedStyle(el);
    const room = el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    const range = document.createRange();
    range.selectNodeContents(el);
    return room > 0 && range.getBoundingClientRect().width > room + 0.01;
  }

  function settle(el, fit) {
    let i = 0;
    el.classList.remove("vh");
    put(el, fit.steps[0]);
    while (i < fit.steps.length - 1 && spills(el)) put(el, fit.steps[++i]);
    if (fit.hide && spills(el)) el.classList.add("vh");
  }

  function fitText(el, steps, hide = false) {
    const list = steps.filter((s, i) => typeof s === "string" && s !== "" && steps.indexOf(s) === i);
    const fit = { steps: list.length ? list : [""], hide };
    if (watch && !fits.has(el)) watch.observe(el);
    fits.set(el, fit);
    settle(el, fit);
  }

  const refit = () => { for (const [el, fit] of fits) if (el.isConnected && el.dataset.on === undefined) settle(el, fit); };

  const capSteps = (text) => {
    const bare = String(text).replace(/\s*Hover for exact\.$/, "");
    const unit = bare.replace(/,\s*so totals foot\.$/, "");
    const steps = [text, bare, unit, unit.replace(/,\s*to\s+\S+$/, "")];
    return matchMedia("(hover: none)").matches ? steps.slice(1) : steps;
  };

  const firstSentence = (text) => String(text).replace(/(\.)\s.*$/, "$1");

  const footSteps = (text) => {
    const parts = String(text).split(" · ");
    const steps = [];
    for (let k = parts.length; k > 0; k--) steps.push(parts.slice(0, k).join(" · "));
    steps.push(firstSentence(steps[steps.length - 1]));
    return steps;
  };

  const html = (el, markup) => {
    if (el.__h === markup) return false;
    el.__h = markup;
    el.innerHTML = markup;
    return true;
  };

  let flashTimer = 0;
  const flashing = new Set();
  function flash(el) {
    el.classList.add("chg");
    flashing.add(el);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { for (const e of flashing) e.classList.remove("chg"); flashing.clear(); }, 2000);
  }

  function numTd(cell, id, proof) {
    const cls = "n c-" + id;
    if (!cell || cell.s === "blank") return '<td class="' + cls + '"></td>';
    if (cell.s === "absent") return '<td class="' + cls + ' a" data-s="absent" title="' + esc(cell.r) + '"><span aria-hidden="true">' + DASH + '</span><span class="visually-hidden">' + esc(cell.r) + "</span></td>";
    const pf = proof && WORDS.proof[proof] ? WORDS.proof[proof] : null;
    return '<td class="' + cls + '" data-s="' + cell.s + '"' + (pf ? ' data-proof="' + proof + '"' : "") + ' title="' + esc(cell.x + (pf ? " · " + pf[1] : "")) + '">' + esc(cell.t) + (pf && proof !== "even" ? '<span class="pf" aria-hidden="true">' + pf[0] + '</span><span class="visually-hidden">, ' + esc(pf[1].toLowerCase()) + "</span>" : "") + "</td>";
  }

  const compact = () => small() || $("sfSide").clientWidth < 560;

  function setCell(td, cell, rowLabel, col) {
    if (cell.s === "blank") return false;
    const absent = cell.s === "absent";
    const text = absent ? DASH : cell.t;
    const x = absent ? cell.r : cell.x;
    const was = td.dataset.s;
    td.classList.toggle("a", absent);
    data(td, "s", cell.s);
    data(td, "x", x);
    data(td, "m", rowLabel + " · " + col.label + " " + col.sub);
    attr(td, "aria-label", rowLabel + ", " + col.label + " " + col.sub + (absent ? ": absent. " : ": ") + x);
    return put(td, text) && was !== undefined && was !== "pending";
  }

  function paintGroups() {
    const host = $("sfGroups");
    if (!host.firstElementChild) host.innerHTML = Object.keys(WORDS.group).map((id) => '<button type="button" data-g="' + id + '" aria-pressed="false">' + WORDS.group[id] + "</button>").join("");
    for (const b of host.children) attr(b, "aria-pressed", String(b.dataset.g === S.group));
  }

  function armGrid(table) {
    let armed = false;
    for (const td of table.querySelectorAll("tbody td.c")) {
      const on = !armed && !td.classList.contains("b") && td.getClientRects().length > 0;
      const want = on ? 0 : -1;
      if (td.tabIndex !== want) td.tabIndex = want;
      if (on) armed = true;
    }
  }

  function paintLedger(d, quiet) {
    const L = d.ledger;
    fitText($("sfCap"), capSteps(L.caption));
    fitText($("sfKey"), [L.keyLine, WORDS.keyShort]);
    const line = $("sfCellLine");
    data(line, "zero", L.zeroLine);
    fits.set(line, { steps: [L.zeroLine, firstSentence(L.zeroLine)], hide: false });
    if (!line.dataset.on) settle(line, fits.get(line));
    paintGroups();
    const table = $("sfMatrix").querySelector("table.sf-lt");
    table.removeAttribute("aria-busy");
    data(table, "g", small() ? S.group : "all");
    const heads = table.querySelectorAll("thead tr:last-child th");
    L.columns.forEach((col, c) => {
      const th = heads[c];
      th.classList.toggle("off", !col.measured);
      attr(th, "title", col.hover);
      put(th.firstElementChild, col.label);
      put(th.lastElementChild, col.sub);
    });
    const body = L.rows.slice(0, 10).concat([{ ...L.net, always: true }, { ...L.rows[10], always: true }]);
    const trs = table.querySelectorAll("tbody tr:not(.sub)");
    body.forEach((row, i) => {
      const th = trs[i].firstElementChild;
      put(th, row.group ? row.short : row.label);
      attr(th, "title", row.hover);
      const tds = trs[i].querySelectorAll("td");
      row.cells.forEach((cell, c) => { if (setCell(tds[c], cell, row.label, L.columns[c]) && !quiet) flash(tds[c]); });
    });
    for (const sub of table.querySelectorAll("tr.sub td:first-child")) { attr(sub, "title", L.groupRows.side.hover); put(sub, L.groupRows.side.label); }
    armGrid(table);
  }

  function wireGrid(table) {
    const line = $("sfCellLine");
    const cells = () => [...table.querySelectorAll("tbody tr:not(.sub)")].filter((tr) => tr.getClientRects().length > 0).map((tr) => [...tr.querySelectorAll("td")]);
    const show = (td) => {
      if (!td) { delete line.dataset.on; if (S.data && S.data.status === "ok") settle(line, fits.get(line) || { steps: [line.dataset.zero || ""], hide: false }); return; }
      line.dataset.on = "1";
      put(line, td.dataset.m + ": " + td.dataset.x);
    };
    const live = (td) => td && td.dataset.m && !td.classList.contains("b");
    table.addEventListener("pointerover", (e) => { const td = e.target.closest("td.c"); if (live(td)) show(td); });
    table.addEventListener("pointerleave", () => { if (!table.contains(document.activeElement)) show(null); });
    table.addEventListener("click", (e) => { const td = e.target.closest("td.c"); if (live(td)) show(td); });
    table.addEventListener("focusin", (e) => { const td = e.target.closest("td.c"); if (td) show(td); });
    table.addEventListener("focusout", (e) => { if (!table.contains(e.relatedTarget)) show(null); });
    table.addEventListener("keydown", (e) => {
      const td = e.target.closest("td.c");
      if (!td) return;
      const tds = cells();
      const grid = tds.map((row) => row.map((x) => !x.classList.contains("b")));
      const r = tds.findIndex((row) => row.includes(td));
      const c = tds[r].indexOf(td);
      const to = nextCell(grid, r, c, e.key);
      if (!to) return;
      e.preventDefault();
      td.tabIndex = -1;
      const next = tds[to[0]][to[1]];
      next.tabIndex = 0;
      next.focus();
    });
  }

  function barSvg(b, verdict) {
    const fill = b.fill ? '<rect class="sf-fo ' + (verdict === "above" ? "up" : "dn") + '" x="' + b.fill.x.toFixed(2) + '" y="4" width="' + b.fill.width.toFixed(2) + '" height="8"/>' : "";
    return '<svg class="sf-bar" viewBox="-' + HALF + ' 0 ' + 2 * HALF + ' 16" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + fill +
      '<rect class="sf-bd" x="' + Math.min(b.lo, b.hi).toFixed(2) + '" y="3" width="' + Math.abs(b.hi - b.lo).toFixed(2) + '" height="10"/><line class="sf-ax" x1="0" x2="0" y1="0" y2="16"/><line class="sf-tk" x1="' + b.mid.toFixed(2) + '" x2="' + b.mid.toFixed(2) + '" y1="1" y2="15"/></svg>';
  }

  function nameSvg(b) {
    return '<svg class="sf-bar" viewBox="-' + HALF + ' 0 ' + 2 * HALF + ' 16" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="sf-fo nt" x="' + b.x.toFixed(2) + '" y="4" width="' + b.width.toFixed(2) + '" height="8"/><line class="sf-ax" x1="0" x2="0" y1="0" y2="16"/></svg>';
  }

  function tiltTd(cell, scale) {
    if (!cell || cell.s === "absent") {
      const why = cell ? cell.r : "";
      return '<td class="tl a" data-s="absent" title="' + esc(why) + '"><span aria-hidden="true">' + DASH + '</span><span class="visually-hidden">' + esc(why) + "</span></td>";
    }
    if (scale && num(cell.tiltC) !== null && num(cell.bandC) !== null) {
      return '<td class="tl" data-v="' + esc(cell.verdict) + '" title="' + esc(cell.x) + '"><div class="tw">' + barSvg(tiltBar(cell.tiltC, cell.bandC, scale, cell.verdict), cell.verdict) + '<span class="tv">' + esc(cell.t) + '</span><span class="vd"><i aria-hidden="true">' + esc(cell.glyph) + '</i><em> ' + esc(cell.word) + "</em></span></div></td>";
    }
    if (scale && num(cell.tiltC) !== null) return '<td class="tl" data-v="name" title="' + esc(cell.x) + '"><div class="tw">' + nameSvg(nameBar(cell.tiltC, scale)) + '<span class="tv">' + esc(cell.t) + "</span></div></td>";
    return '<td class="tl a" title="' + esc(cell.x) + '">' + esc(cell.t) + "</td>";
  }

  const drillBtn = (scope, label, shown) => '<button type="button" class="sf-drill" data-scope="' + esc(scope) + '" aria-label="' + esc(WORDS.drill(label)) + '">' + esc(shown || label) + "</button>";

  function sectorsHtml(T) {
    const scale = T.tiltScale ? T.tiltScale.cents : null;
    const head = T.headers.map((h, i) => '<th scope="col" class="h-' + h.id + (i ? " r" : "") + '" title="' + esc(h.hover) + '">' + esc(h.label) + (h.id === "tilt" && T.tiltScale ? "<small>" + esc(WORDS.scaleHead(T.tiltScale.text, T.tiltScale.unit)) + "</small>" : "") + "</th>").join("");
    const rows = T.rows.map((r) => '<tr data-k="' + esc(r.key) + '" data-n="' + r.windows + '"' + (r.windows ? ' data-scope="sector:' + esc(r.key) + '"' : "") + (r.selected ? ' aria-current="true"' : "") + '><th scope="row">' +
      (r.windows ? drillBtn("sector:" + r.key, r.label, compact() ? r.short : r.label) : '<span class="sf-nm">' + esc(compact() ? r.short : r.label) + "</span>") + "</th>" +
      numTd(r.taker, "taker", r.proof) + numTd(r.calls, "calls") + numTd(r.puts, "puts") + numTd(r.noside, "noside") + numTd(r.outside, "outside") + tiltTd(r.tilt, scale) + numTd(r.coverage, "coverage") + "</tr>").join("");
    const t = T.totals;
    const foot = '<tr class="tot"><th scope="row">' + WORDS.total + "</th>" + numTd(t.taker, "taker") + numTd(t.calls, "calls") + numTd(t.puts, "puts") + numTd(t.noside, "noside") + numTd(t.outside, "outside") + numTd(t.tilt, "tilt") + '<td class="n c-coverage"></td></tr>';
    return '<table class="sf-t sf-st"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody><tfoot>" + foot + "</tfoot></table>";
  }

  function namesHtml(N) {
    const scale = N.tiltScale ? N.tiltScale.cents : null;
    const ids = ["name", "windows", "premium", "calls", "puts", "weight", "tilt"];
    const head = WORDS.namesHead.map((h, i) => '<th scope="col" class="h-' + ids[i] + (i ? " r" : "") + '">' + esc(h) + (ids[i] === "tilt" && N.tiltScale ? "<small>" + esc(WORDS.scaleHead(N.tiltScale.text, N.tiltScale.unit)) + "</small>" : "") + "</th>").join("");
    const rows = N.rows.map((r) => '<tr' + (r.ticker && r.windows ? ' data-scope="name:' + esc(r.ticker) + '"' : "") + '><th scope="row">' + (r.ticker && r.windows ? drillBtn("name:" + r.ticker, r.label) : '<span class="sf-nm">' + esc(r.label) + "</span>") + "</th>" +
      '<td class="n c-windows">' + (r.windows || "") + "</td>" + numTd(r.premium, "premium") + numTd(r.calls, "calls") + numTd(r.puts, "puts") + numTd(r.weight, "weight") + tiltTd(r.tilt, scale) + "</tr>").join("");
    const t = N.total;
    const foot = '<tr class="tot"><th scope="row">' + WORDS.total + '</th><td class="n c-windows">' + t.windows + "</td>" + numTd(t.premium, "premium") + numTd(t.calls, "calls") + numTd(t.puts, "puts") + '<td class="n c-weight"></td>' + numTd(t.tilt, "tilt") + "</tr>";
    return '<table class="sf-t sf-st sf-nt"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody><tfoot>" + foot + "</tfoot></table>";
  }

  function windowsHtml(W) {
    const ids = ["time", "contract", "premium", "ask", "bid"];
    const head = WORDS.windowsHead.map((h, i) => '<th scope="col" class="h-' + ids[i] + (i > 1 ? " r" : "") + '">' + esc(h) + "</th>").join("");
    const rows = W.rows.map((r) => '<tr><th scope="row">' + esc(r.label) + '</th><td class="ct">' + esc(r.contract) + "</td>" + numTd(r.premium, "premium") + numTd(r.ask, "ask") + numTd(r.bid, "bid") + "</tr>").join("");
    return '<table class="sf-t sf-st sf-wt"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function lane(a, width) {
    const dir = a.from === "TK" ? "r" : "l";
    return '<div class="fl-lane ' + dir + '" data-id="' + a.id + '" title="' + esc(a.exact) + '"><span class="fl-lab">' + esc(a.label) + " <b>" + esc(a.text) + '</b></span><span class="fl-ar" data-w="' + width.toFixed(2) + '"></span></div>';
  }

  const ends = (left, right) => '<span class="fl-ends">' + esc(left) + " left, " + esc(right) + " right</span>";

  function flowHtml(F) {
    const cents = [...F.arrows.map((a) => a.cents), F.noside.cents, F.outside.cents === null ? 0 : Math.abs(F.outside.cents)];
    const max = Math.max(0, ...cents);
    const w = arrowWidths(cents, max, short() ? ARROW_COMPACT : ARROW_MAX);
    const held = F.arrows.map((a, i) => lane(a, w[i])).join("");
    const side = '<div class="fl-lane r" data-id="noside" title="' + esc(F.noside.exact) + '"><span class="fl-lab">' + esc(F.noside.line) + '</span><span class="fl-ar" data-w="' + w[4].toFixed(2) + '"></span></div>';
    const out = F.outside.s === "absent"
      ? '<div class="fl-lane gone" data-id="outside"><span class="fl-lab">' + esc(F.outside.line) + "</span></div>"
      : '<div class="fl-lane ' + (F.outside.cents >= 0 ? "r" : "l") + ' dashed" data-id="outside" title="' + esc(F.outside.exact) + '"><span class="fl-lab">' + esc(F.outside.line) + '</span><span class="fl-ar" data-w="' + w[5].toFixed(2) + '"></span></div>';
    const node = (name, sub, cls) => '<div class="fl-node ' + cls + '"><b>' + esc(name) + "</b><i>" + esc(sub) + "</i></div>";
    return '<div class="sf-fl">' +
      '<section class="fl-band" data-b="held"><h3>' + WORDS.heldBand + ends(F.takers, F.providers) + '</h3><div class="fl-grid">' + node(F.takers, WORDS.held, "l") + '<div class="fl-lanes">' + held + "</div>" + node(F.providers, WORDS.held, "r") + '</div><p class="fl-net">' + esc(F.net.line) + "</p></section>" +
      '<section class="fl-band" data-b="side"><h3>' + WORDS.sideBand + ends(WORDS.buyers, WORDS.sellers) + '</h3><div class="fl-grid">' + node(WORDS.buyers, WORDS.noside, "l") + '<div class="fl-lanes">' + side + "</div>" + node(WORDS.sellers, WORDS.noside, "r") + "</div></section>" +
      '<section class="fl-band" data-b="out"><h3>' + WORDS.outBand + ends(F.takers, F.providers) + '</h3><div class="fl-grid">' + node(F.takers, WORDS.outside, "l") + '<div class="fl-lanes">' + out + "</div>" + node(F.providers, WORDS.outside, "r") + "</div></section></div>";
  }

  function snap(host) {
    const m = new Map();
    host.querySelectorAll("tbody tr").forEach((tr, r) => {
      const k = tr.dataset.k || tr.dataset.scope || r;
      tr.querySelectorAll("td").forEach((td, c) => m.set(k + "|" + c, td.textContent));
    });
    return m;
  }

  function paintSide(d, quiet) {
    const kind = d.scope.kind;
    const name = WORDS.view[kind];
    put($("sfSideT"), name);
    put($("sfViewT"), name);
    const tab = document.querySelector('#sfTabs [data-v="side"]');
    if (tab) put(tab, name);
    $("sfSide").setAttribute("aria-label", name);
    for (const b of $("sfView").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.w === S.w));
    const body = $("sfBody");
    let markup, cap, foot;
    if (S.w === "flow") { markup = flowHtml(d.flow); cap = ""; foot = ""; }
    else if (kind === "all") { markup = sectorsHtml(d.sectors); cap = d.sectors.caption; foot = d.tilt.status === "ok" ? d.tilt.footer : d.tilt.reason; }
    else if (kind === "sector") { markup = namesHtml(d.names); cap = d.names.caption; foot = d.names.footer || ""; }
    else { markup = windowsHtml(d.windows); cap = d.windows.caption; foot = ""; }
    S.compact = compact();
    const sideKey = (S.w === "flow" ? "flow" : kind) + "|" + d.scope.key;
    const before = !quiet && body.dataset.key === sideKey && !body.querySelector("[data-skel]") ? snap(body) : null;
    S.sideHtml = S.w === "flow" ? null : markup;
    body.dataset.key = sideKey;
    const held = document.activeElement && body.contains(document.activeElement) && document.activeElement.classList.contains("sf-drill") ? document.activeElement.dataset.scope : null;
    if (html(body, markup)) {
      for (const el of body.querySelectorAll("[data-w]")) el.style.setProperty("--w", el.dataset.w + "px");
      if (held !== null) { const back = [...body.querySelectorAll(".sf-drill")].find((b) => b.dataset.scope === held); if (back) back.focus({ preventScroll: true }); }
      if (before) {
        const now = snap(body);
        body.querySelectorAll("tbody tr").forEach((tr, r) => {
          const k = tr.dataset.k || tr.dataset.scope || r;
          tr.querySelectorAll("td").forEach((td, c) => { const was = before.get(k + "|" + c); if (was !== undefined && was !== now.get(k + "|" + c)) flash(td); });
        });
      }
    }
    fitText($("sfSideCap"), cap ? capSteps(cap) : [""]);
    fitText($("sfFoot"), footSteps(foot), true);
    body.dataset.kind = S.w === "flow" ? "flow" : kind;
    const sideTable = body.querySelector("table.sf-st");
    if (sideTable && sideTable.tBodies[0]) body.style.setProperty("--n", String(sideTable.tBodies[0].rows.length));
    fit();
  }

  function fit() {
    const host = $("sfBody");
    const all = $("sfAll");
    const table = host.querySelector("table.sf-st");
    all.hidden = true;
    S.fitKey = null;
    if (!table || !table.tBodies[0] || host.clientHeight === 0) return;
    all.textContent = WORDS.showAll(table.tBodies[0].rows.length);
    all.hidden = false;
    const rows = [...table.tBodies[0].rows];
    const foot = table.tFoot && table.tFoot.rows[0];
    const show = (k) => { rows.forEach((r, i) => r.classList.toggle("cut", i >= k)); host.style.setProperty("--n", String(k)); };
    const over = () => table.getBoundingClientRect().height > host.getBoundingClientRect().height + 0.01;
    if (foot) foot.cells[0].textContent = WORDS.totalAll;
    show(rows.length);
    let k = rows.length;
    if (over()) {
      let lo = Math.min(3, rows.length);
      let hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        show(mid);
        if (over()) hi = mid - 1; else lo = mid;
      }
      k = lo;
      show(k);
    }
    const cut = rows.length - k;
    if (foot && !cut) foot.cells[0].textContent = WORDS.total;
    all.hidden = cut === 0;
    S.fitKey = host.clientHeight + "x" + host.clientWidth;
  }

  function paintRead(d) {
    let markup = '<ul class="rd-l">' + d.reading.map((t) => "<li>" + esc(t) + "</li>").join("") + "</ul>";
    markup += '<div class="rd-m"><p title="' + esc(d.stock.memo.exact) + '">' + esc(d.stock.memo.text) + "</p><p>" + esc(d.stock.notBuilt) + "</p></div>";
    html($("sfReadBox"), markup);
  }

  function paintHero(d, quiet) {
    const L = d.hero.lean;
    put($("sfLeanV"), L.bounds || DASH);
    put($("sfLeanVerdict"), L.verdict.text);
    put($("sfLeanSay"), L.verdict.long);
    const bar = $("sfLeanBar");
    const pc = (f) => (100 * f).toFixed(3) + "%";
    const lo = L.frac.lo, hi = L.frac.hi;
    const at = (cls, x, w) => { const r = bar.querySelector("." + cls); attr(r, "x", x); attr(r, "width", w); };
    at("a", "0%", pc(lo));
    at("u", pc(lo), pc(hi - lo));
    at("b", pc(hi), pc(1 - hi));
    const ln = (cls, x1, x2) => { const l = bar.querySelector("." + cls); attr(l, "x1", x1); attr(l, "x2", x2); };
    ln("br", pc(lo), pc(hi));
    ln("bl", pc(lo), pc(lo));
    ln("bh", pc(hi), pc(hi));
    const tk = bar.querySelector(".tk");
    tk.style.display = L.tick === null ? "none" : "";
    if (L.tick !== null) attr(tk, "x", pc(L.frac.share));
    attr(bar, "aria-label", (L.bar || WORDS.leanNone) + " " + L.tickLine + (L.tick === null ? "" : " " + WORDS.tickNote));
    attr($("sfLeanVerdict"), "title", L.verdict.long);
    data(bar, "s", "ok");
    $("sfLeanFig").querySelectorAll(".hr-f").forEach((li, i) => {
      const p = L.parts[i];
      if (put(li.querySelector(".hr-fv"), p.text) && !quiet && li.dataset.s === "ok") flash(li);
      data(li, "s", "ok");
      attr(li, "title", p.exact);
    });
    put($("sfLeanLine"), d.lean.line.text);
    $("sfCells").querySelectorAll(".hc").forEach((el, i) => {
      const c = d.hero.cells[i];
      const v = el.querySelector(".hc-v b");
      if (put(v, c.text) && !quiet && el.dataset.s === "ok") flash(el);
      put(el.querySelector(".hc-v i"), c.glyph);
      fitText(el.querySelector(".hc-r"), [c.line1, c.line1.replace(/^Range /, "")], true);
      fitText(el.querySelector(".hc-s"), [c.line2, c.line2.replace(/ at the session close$/, " at close")], true);
      data(el, "s", "ok");
      data(el, "proof", c.proof || "");
      attr(el, "title", c.why ? c.exact + ". " + c.why : c.exact);
    });
  }

  function paintChecks(d) {
    const items = d.checks.items;
    const host = $("sfChecks");
    for (const i of items) {
      const chip = host.querySelector('[data-id="' + i.id + '"]');
      if (!chip) continue;
      data(chip, "state", i.state);
      attr(chip, "title", i.hover);
      put(chip.firstElementChild, GLYPH[i.state]);
      if (chip.childNodes[1].nodeValue !== i.label) chip.childNodes[1].nodeValue = i.label;
      put(chip.lastElementChild, " " + STATE_WORD[i.state]);
    }
    S.checks = items;
    S.head = d.checks.head;
    if (!root.dataset.checks) root.dataset.checks = "closed";
    resetCheckLine();
  }

  function valve() {
    const mat = $("sfMatrix");
    const over = mat.getClientRects().length > 0 && mat.scrollHeight > mat.clientHeight + 1;
    if (over) {
      attr(mat, "tabindex", "0");
      attr(mat, "role", "region");
      attr(mat, "aria-label", WORDS.valve);
    } else {
      mat.removeAttribute("tabindex");
      mat.removeAttribute("role");
      mat.removeAttribute("aria-label");
    }
  }

  function lineRole() {
    const el = $("sfCheckLine");
    if (small() && el.textContent !== "") {
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-expanded", String(root.dataset.checks === "open"));
    } else {
      el.removeAttribute("role");
      el.removeAttribute("tabindex");
      el.removeAttribute("aria-expanded");
    }
  }

  function resetCheckLine() {
    const items = S.checks || [];
    const failing = items.find((i) => i.state === "fail");
    const count = (s) => items.filter((i) => i.state === s).length;
    const sum = (label) => WORDS.summary(label, count("pass"), count("fail"), count("absent"));
    fitText($("sfCheckLine"), failing ? [failing.text] : [sum(S.head.label), sum(WORDS.checksShort)]);
    attr($("sfCheckLine"), "title", S.head.hover);
    lineRole();
  }

  function paintHead(d) {
    const p = d.period;
    put($("sfStamp"), p.label || "");
    for (const b of $("sfPeriod").querySelectorAll("button")) {
      const info = d.periods.find((x) => x.id === b.dataset.p);
      attr(b, "aria-pressed", String(b.dataset.p === p.id));
      attr(b, "aria-disabled", String(!(info && info.ok)));
      if (info && !info.ok && info.reason) attr(b, "title", info.reason); else b.removeAttribute("title");
    }
    const crumbs = d.scope && d.scope.crumbs ? d.scope.crumbs : [{ label: "All sectors", key: "all" }];
    html($("sfCrumbs"), crumbs.map((c, i) => (i === crumbs.length - 1 ? '<span aria-current="page">' + esc(c.label) + "</span>" : '<button type="button" data-scope="' + esc(c.key) + '">' + esc(c.label) + "</button>")).join('<i aria-hidden="true">›</i>'));
    put($("sfScope"), d.scope && d.scope.line ? d.scope.line : "");
  }

  function setNote(text, retry) {
    const note = $("sfNote");
    note.hidden = !text;
    note.textContent = text || "";
    if (text && retry) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link";
      b.id = "sfRetry";
      b.textContent = WORDS.retry;
      note.append(" ", b);
    }
  }

  const clockSec = (ms) => {
    const d = new Date(ms + 3 * 3600 * 1000);
    return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds()) + " TRT";
  };

  const BEAT_DEADLINE_MS = 8000, STOP_MS = 300000;

  function chip(k, state, text) {
    const c = $("sfStrip").querySelector('[data-k="' + k + '"]');
    data(c, "s", state);
    fitText(c.querySelector(".sc-t"), [text, text.replace(/^as of /, ""), text.replace(/^as of /, "").replace(/ TRT$/, "")]);
  }

  let pollTimer = 0;

  const lateAfter = () => 2 * S.cad + BEAT_DEADLINE_MS;

  function noteRecv(serverMs) {
    const t = num(serverMs) !== null ? serverMs : Date.now();
    S.recv = S.recv === null ? t : Math.max(S.recv, t);
    S.recvAt = Date.now();
  }

  function polled(serverMs, cadenceMs) {
    noteRecv(serverMs);
    if (num(cadenceMs) !== null && cadenceMs > 0) S.cad = cadenceMs;
    paintPoll();
  }

  function paintPoll() {
    clearTimeout(pollTimer);
    if (S.recv === null) { chip("poll", "pending", WORDS.strip.pending); return; }
    const at = clockSec(S.recv);
    if (S.ff && S.ff.state === "closed") { chip("poll", "closed", WORDS.strip.pollClosed(at)); return; }
    if (document.hidden) { chip("poll", "held", WORDS.strip.pollPaused(at)); return; }
    if (navigator.onLine === false) { chip("poll", "unavailable", WORDS.strip.pollOffline(at)); return; }
    const age = Date.now() - Math.max(S.recvAt, S.shownAt);
    const late = lateAfter();
    if (age >= Math.max(STOP_MS, late)) { chip("poll", "unavailable", WORDS.strip.pollNone(at)); return; }
    if (age >= late) {
      chip("poll", "stale", WORDS.strip.pollLate(at));
      pollTimer = setTimeout(paintPoll, Math.max(STOP_MS, late) - age);
      return;
    }
    chip("poll", "fresh", WORDS.strip.pollOk(at));
    pollTimer = setTimeout(paintPoll, late - age);
  }

  function paintStrip() {
    const d = S.data;
    const st = S.ff ? S.ff.state : "fresh";
    if (!d || d.status !== "ok") {
      const bad = !d || d.status === "failed" || d.status === "unavailable";
      chip("windows", bad ? "unavailable" : "quiet", bad ? WORDS.strip.unreadable : WORDS.strip.quiet);
      chip("held", "withheld", DASH);
      chip("tide", "withheld", DASH);
    } else {
      chip("windows", st, WORDS.strip.windows(d.period.asOfText));
      const h = d.scope.held, t = d.scope.seen;
      chip("held", t === null ? "withheld" : t > h ? "partial" : "fresh", WORDS.strip.held(h, t));
      chip("tide", d.tide.at === null ? "withheld" : d.checks.failed.includes("session") ? "stale" : "fresh", WORDS.strip.tide(d.tide.at));
    }
    paintPoll();
  }

  function paint(d) {
    const key = d.scope && d.period ? d.scope.key + "|" + d.period.id : null;
    const quiet = S.key !== key;
    S.key = key;
    S.data = d;
    noteRecv(d.serverNow);
    root.dataset.state = d.status;
    if (d.status === "ok" && !S.painted) {
      S.painted = true;
      root.dataset.ent = "1";
      setTimeout(() => { delete root.dataset.ent; }, 400);
    }
    paintHead(d);
    if (d.status !== "ok") {
      $("sfCheckLine").textContent = "";
      lineRole();
      setNote(d.why || "", false);
      say(d.why || "");
      paintStrip();
      return;
    }
    setNote("", false);
    paintChecks(d);
    paintHero(d, quiet);
    paintLedger(d, quiet);
    paintSide(d, quiet);
    paintRead(d);
    paintStrip();
    valve();
    say(d.scope.line);
  }

  function freshFrom(res, body) {
    const upd = Number(res.headers.get("X-Payload-Updated")) || null;
    const f = typeof UI.freshFrom === "function" ? UI.freshFrom(res) : null;
    S.ff = f && f.state ? f : null;
    if (f && f.session) UI.freshness({ ...f.forFreshness(), updatedAt: upd, generatedAt: body && body.period ? body.period.asOf : undefined });
  }

  function load() {
    const seq = ++S.seq;
    root.dataset.busy = "true";
    const q = new URLSearchParams();
    q.set("scope", S.scope);
    if (S.period) q.set("period", S.period);
    return fetch("/api/flows/ledger?" + q.toString(), { credentials: "same-origin", headers: { Accept: "application/json" } }).then((res) => {
      if (res.status === 401) { location.replace("/flows/"); return null; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().then((body) => {
        if (!body || typeof body !== "object" || !Array.isArray(body.periods)) throw new Error("not a ledger");
        if (seq !== S.seq) return null;
        freshFrom(res, body);
        paint(body);
        return body;
      });
    }).catch(() => {
      if (seq !== S.seq) return null;
      root.dataset.state = "error";
      S.data = null;
      $("sfCheckLine").textContent = "";
      lineRole();
      setNote(WORDS.failed(clockOf(Date.now())), true);
      say(WORDS.failed(clockOf(Date.now())));
      paintStrip();
      return null;
    }).then((v) => { if (seq === S.seq) root.dataset.busy = "false"; return v; });
  }

  function go(next) {
    if (Object.hasOwn(next, "scope")) S.scope = next.scope;
    if (Object.hasOwn(next, "period")) S.period = next.period;
    if (Object.hasOwn(next, "w")) S.w = next.w;
    writeHash();
    return load();
  }

  function setTab(tab) {
    S.tab = tab;
    root.dataset.view = tab;
    for (const b of $("sfTabs").querySelectorAll("button")) {
      attr(b, "aria-selected", String(b.dataset.v === tab));
      attr(b, "tabindex", b.dataset.v === tab ? "0" : "-1");
    }
    refit();
    valve();
    if (tab === "side" && S.data && S.data.status === "ok") fit();
    if (tab === "ledger") armGrid($("sfMatrix").querySelector("table.sf-lt"));
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    const period = t.closest("#sfPeriod button");
    if (period) {
      if (period.getAttribute("aria-disabled") === "true") { setNote(period.title || "", false); return; }
      setNote("", false);
      go({ period: period.dataset.p });
      return;
    }
    const scope = t.closest("[data-scope]");
    if (scope && root.contains(scope)) { go({ scope: scope.dataset.scope }); return; }
    const view = t.closest("#sfView button");
    if (view) { go({ w: view.dataset.w }); return; }
    const group = t.closest("#sfGroups button");
    if (group) {
      S.group = group.dataset.g;
      paintGroups();
      const table = $("sfMatrix").querySelector("table.sf-lt");
      table.dataset.g = small() ? S.group : "all";
      armGrid(table);
      return;
    }
    const tab = t.closest("#sfTabs button");
    if (tab) { setTab(tab.dataset.v); return; }
    if (t.closest("#sfRetry")) { load(); return; }
    if (t.closest("#sfInfoBtn")) { $("sfInfoDlg").showModal(); return; }
    if (t.closest("#sfInfoX")) { $("sfInfoDlg").close(); return; }
    if (t.closest("#sfCheckLine") && small()) { root.dataset.checks = root.dataset.checks === "open" ? "closed" : "open"; $("sfCheckLine").setAttribute("aria-expanded", String(root.dataset.checks === "open")); return; }
    const chip = t.closest(".sf-chk");
    if (chip) { const item = (S.checks || []).find((i) => i.id === chip.dataset.id); if (item) $("sfCheckLine").textContent = item.text; }
  });

  $("sfInfoDlg").addEventListener("click", (e) => { if (e.target === $("sfInfoDlg")) $("sfInfoDlg").close(); });
  $("sfInfoX").addEventListener("click", () => $("sfInfoDlg").close());

  $("sfAll").addEventListener("click", () => {
    if (!S.sideHtml) return;
    $("sfAllT").textContent = $("sfSideT").textContent;
    $("sfAllBody").innerHTML = S.sideHtml;
    for (const el of $("sfAllBody").querySelectorAll("[data-w]")) el.style.setProperty("--w", el.dataset.w + "px");
    $("sfAllDlg").showModal();
  });
  $("sfAllDlg").addEventListener("click", (e) => {
    if (e.target === $("sfAllDlg") || e.target.closest("#sfAllX")) { $("sfAllDlg").close(); return; }
    const scope = e.target.closest("[data-scope]");
    if (scope) { $("sfAllDlg").close(); go({ scope: scope.dataset.scope }); }
  });
  $("sfAllDlg").addEventListener("close", () => { if (!$("sfAll").hidden) $("sfAll").focus(); });

  if (typeof ResizeObserver === "function") {
    let queued = false;
    watch = new ResizeObserver(() => {
      refit();
      valve();
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const host = $("sfBody");
        if (S.data && S.data.status === "ok" && S.compact !== compact()) { paintSide(S.data, true); return; }
        if (S.sideHtml && host.clientHeight + "x" + host.clientWidth !== S.fitKey) fit();
      });
    });
    watch.observe($("sfBody"));
    watch.observe($("sfMatrix"));
    for (const el of fits.keys()) watch.observe(el);
  }

  if (document.fonts) {
    document.fonts.addEventListener("loadingdone", refit);
    document.fonts.ready.then(refit);
  }

  const checks = $("sfChecks");
  const chipText = (e) => {
    const chip = e.target.closest(".sf-chk");
    const item = chip ? (S.checks || []).find((i) => i.id === chip.dataset.id) : null;
    if (item) $("sfCheckLine").textContent = item.text;
  };
  checks.addEventListener("pointerover", chipText);
  checks.addEventListener("focusin", chipText);
  checks.addEventListener("pointerleave", resetCheckLine);
  checks.addEventListener("focusout", (e) => { if (!checks.contains(e.relatedTarget)) resetCheckLine(); });

  addEventListener("hashchange", () => {
    const before = hashOf(S.scope, S.period, S.w);
    readHash();
    if (hashOf(S.scope, S.period, S.w) !== before) load();
  });

  matchMedia("(max-width:899px)").addEventListener("change", () => {
    lineRole();
    const table = $("sfMatrix").querySelector("table.sf-lt");
    table.dataset.g = small() ? S.group : "all";
    armGrid(table);
    if (S.data && S.data.status === "ok") { paintLedger(S.data, true); paintSide(S.data, true); }
  });

  wireGrid($("sfMatrix").querySelector("table.sf-lt"));

  $("sfTabs").addEventListener("keydown", (e) => {
    const tabs = [...$("sfTabs").querySelectorAll("button")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const to = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabs[to].dataset.v);
    tabs[to].focus();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) S.shownAt = Date.now();
    paintPoll();
  });
  addEventListener("online", paintPoll);
  addEventListener("offline", paintPoll);

  readHash();
  setTab(S.tab);
  say(WORDS.loading);
  load().then((body) => {
    if (typeof UI.heartbeat !== "function") return;
    S.beat = UI.heartbeat({
      keys: ["alerts", "breadth"], nightly: ["flowalerts"], page: "ledger",
      onBeat: (b) => { polled(b && b.body ? b.body.serverNow : null, typeof UI.heartbeatInterval === "function" ? UI.heartbeatInterval(b && b.body && b.body.phase ? b.body.phase.phase : null, "ledger", false) : null); },
      onChange: () => { load(); },
    });
    return body;
  });
})();
