(() => {
  "use strict";

  const MINUS = "−", DASH = "—";
  const HALF = 100;
  const ARROW_MAX = 20;
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
    noside: "side unknown",
    outside: "outside",
    held: "held",
    leanTitle: "Share of premium on the ask side",
    leanKey: "Bar: proven bounds. Tick: share of stated-side premium.",
    nameBand: "Names carry no determination band, so no verdict.",
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

  function arrowWidths(cents, max) {
    return cents.map((c) => (max > 0 && c > 0 ? Math.max(ARROW_MIN, (ARROW_MAX * c) / max) : 0));
  }

  function groupColumns(groups, id) {
    const g = groups.find((x) => x.id === id);
    return g ? g.cols.slice() : [0, 1, 2, 3, 4, 5];
  }

  function rowsFor(rows, cols) {
    return rows.filter((row) => row.always || row.cells.some((cell, c) => cols.includes(c) && cell.s !== "blank"));
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
    globalThis.__LedgerTest = Object.freeze({ tiltBar, nameBar, arrowWidths, groupColumns, rowsFor, nextCell, parseHash, hashOf, HALF, ARROW_MAX, ARROW_MIN });
    return;
  }

  const UI = window.FlowsUI;
  const root = document.getElementById("sf");
  if (!UI || !root) return;
  const $ = (id) => document.getElementById(id);
  const small = () => matchMedia("(max-width:899px)").matches;
  const clockOf = (ms) => {
    const d = new Date(ms + 3 * 3600 * 1000);
    return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + " TRT";
  };

  const S = { scope: "all", period: null, w: "table", group: "held", tab: "ledger", data: null, seq: 0, beat: null, cols: [0, 1, 2, 3, 4, 5] };

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

  const capText = (text) => (small() ? String(text).replace(/\s*Hover for exact\.$/, "") : text);

  const say = (text) => { $("sfStatus").textContent = text; };

  function numTd(cell, id) {
    const cls = "n c-" + id;
    if (!cell || cell.s === "blank") return '<td class="' + cls + '"></td>';
    if (cell.s === "absent") return '<td class="' + cls + ' a" data-s="absent" title="' + esc(cell.r) + '"><span aria-hidden="true">' + DASH + '</span><span class="visually-hidden">' + esc(cell.r) + "</span></td>";
    return '<td class="' + cls + '" data-s="' + cell.s + '" title="' + esc(cell.x) + '">' + esc(cell.t) + "</td>";
  }

  function matrixTd(cell, meta) {
    if (cell.s === "blank") return '<td class="c b" aria-hidden="true"></td>';
    if (cell.s === "absent") return '<td class="c a" data-s="absent" data-x="' + esc(cell.r) + '" tabindex="-1" aria-label="' + esc(meta + ": absent. " + cell.r) + '"><span aria-hidden="true">' + DASH + "</span></td>";
    return '<td class="c" data-s="' + cell.s + '" data-x="' + esc(cell.x) + '" tabindex="-1" aria-label="' + esc(meta + ": " + cell.x) + '">' + esc(cell.t) + "</td>";
  }

  function paintGroups(L) {
    const host = $("sfGroups");
    host.hidden = !small();
    host.innerHTML = host.hidden ? "" : L.groups.map((g) => '<button type="button" data-g="' + g.id + '" aria-pressed="' + (g.id === S.group) + '" title="' + esc(g.label) + '">' + esc(g.short) + "</button>").join("");
  }

  function paintLedger(d) {
    const L = d.ledger;
    $("sfCap").textContent = capText(L.caption);
    $("sfKey").textContent = L.keyLine;
    $("sfCellLine").dataset.zero = L.zeroLine;
    $("sfCellLine").textContent = L.zeroLine;
    paintGroups(L);
    const cols = small() ? groupColumns(L.groups, S.group) : [0, 1, 2, 3, 4, 5];
    const body = L.rows.slice(0, 10).concat([{ ...L.net, always: true, kind: "net" }, { ...L.rows[10], always: true, kind: "bal" }]);
    const shown = rowsFor(body, cols);
    const heads = L.groups.map((g) => ({ g, n: g.cols.filter((c) => cols.includes(c)).length })).filter((x) => x.n > 0);
    let html = '<table class="sf-t sf-lt" role="grid" aria-readonly="true"><caption class="visually-hidden">Premium ledger. A minus is premium paid and a plus is premium received.</caption><thead>';
    if (!small()) html += '<tr class="gr"><td></td>' + heads.map((x) => '<th scope="colgroup" colspan="' + x.n + '" class="g-' + x.g.id + '" title="' + esc(x.g.hover) + '">' + esc(x.g.label) + "</th>").join("") + "</tr>";
    html += '<tr><td class="corner"></td>' + cols.map((c) => {
      const col = L.columns[c];
      return '<th scope="col" class="' + (col.measured ? "" : "off") + '" title="' + esc(col.hover) + '"><b>' + esc(col.label) + "</b><i>" + esc(col.sub) + "</i></th>";
    }).join("") + "</tr></thead><tbody>";
    let group = null;
    for (const row of shown) {
      if (row.group !== group) {
        group = row.group;
        if (group) html += '<tr class="sub" aria-hidden="true"><td colspan="' + (cols.length + 1) + '" title="' + esc(L.groupRows[group].hover) + '">' + esc(L.groupRows[group].label) + "</td></tr>";
      }
      html += '<tr class="' + (row.kind || "") + (row.group ? " in" : "") + '"><th scope="row" title="' + esc(row.hover) + '">' + esc(row.group ? row.short : row.label) + "</th>" + cols.map((c) => matrixTd(row.cells[c], row.label + ", " + L.columns[c].label + " " + L.columns[c].sub)).join("") + "</tr>";
    }
    html += "</tbody></table>";
    const host = $("sfMatrix");
    host.innerHTML = html;
    wireGrid(host.querySelector("table"), shown, L, cols);
  }

  function wireGrid(table, rows, L, cols) {
    const line = $("sfCellLine");
    const trs = [...table.querySelectorAll("tbody tr:not(.sub)")];
    const tds = trs.map((tr) => [...tr.querySelectorAll("td")]);
    const grid = tds.map((row) => row.map((td) => !td.classList.contains("b")));
    const locate = (td) => {
      const tr = td.parentElement;
      return [trs.indexOf(tr), tds[trs.indexOf(tr)].indexOf(td)];
    };
    const show = (td) => {
      if (!td) { line.textContent = line.dataset.zero || ""; return; }
      const [r, c] = locate(td);
      line.textContent = rows[r].label + " · " + L.columns[cols[c]].label + " " + L.columns[cols[c]].sub + ": " + td.dataset.x;
    };
    let armed = false;
    for (let r = 0; r < tds.length && !armed; r++) for (let c = 0; c < tds[r].length && !armed; c++) if (grid[r][c]) { tds[r][c].tabIndex = 0; armed = true; }
    table.addEventListener("pointerover", (e) => { const td = e.target.closest("td.c"); if (td && !td.classList.contains("b")) show(td); });
    table.addEventListener("pointerleave", () => { if (!table.contains(document.activeElement)) show(null); });
    table.addEventListener("click", (e) => { const td = e.target.closest("td.c"); if (td && !td.classList.contains("b")) show(td); });
    table.addEventListener("focusin", (e) => { const td = e.target.closest("td.c"); if (td) show(td); });
    table.addEventListener("focusout", (e) => { if (!table.contains(e.relatedTarget)) show(null); });
    table.addEventListener("keydown", (e) => {
      const td = e.target.closest("td.c");
      if (!td) return;
      const [r, c] = locate(td);
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
      (r.windows ? drillBtn("sector:" + r.key, r.label, small() ? r.short : r.label) : '<span class="sf-nm">' + esc(small() ? r.short : r.label) + "</span>") + "</th>" +
      numTd(r.taker, "taker") + numTd(r.calls, "calls") + numTd(r.puts, "puts") + numTd(r.noside, "noside") + numTd(r.outside, "outside") + tiltTd(r.tilt, scale) + numTd(r.coverage, "coverage") + "</tr>").join("");
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

  function flowHtml(F) {
    const cents = [...F.arrows.map((a) => a.cents), F.noside.cents, F.outside.cents === null ? 0 : Math.abs(F.outside.cents)];
    const max = Math.max(0, ...cents);
    const w = arrowWidths(cents, max);
    const held = F.arrows.map((a, i) => lane(a, w[i])).join("");
    const side = '<div class="fl-lane r" data-id="noside" title="' + esc(F.noside.exact) + '"><span class="fl-lab">' + esc(F.noside.line) + '</span><span class="fl-ar" data-w="' + w[4].toFixed(2) + '"></span></div>';
    const out = F.outside.s === "absent"
      ? '<div class="fl-lane gone" data-id="outside"><span class="fl-lab">' + esc(F.outside.line) + "</span></div>"
      : '<div class="fl-lane ' + (F.outside.cents >= 0 ? "r" : "l") + ' dashed" data-id="outside" title="' + esc(F.outside.exact) + '"><span class="fl-lab">' + esc(F.outside.line) + '</span><span class="fl-ar" data-w="' + w[5].toFixed(2) + '"></span></div>';
    const node = (name, sub, cls) => '<div class="fl-node ' + cls + '"><b>' + esc(name) + "</b><i>" + esc(sub) + "</i></div>";
    return '<div class="sf-fl">' +
      '<section class="fl-band" data-b="held"><h3>' + WORDS.heldBand + '</h3><div class="fl-grid">' + node(F.takers, WORDS.held, "l") + '<div class="fl-lanes">' + held + "</div>" + node(F.providers, WORDS.held, "r") + '</div><p class="fl-net">' + esc(F.net.line) + "</p></section>" +
      '<section class="fl-band" data-b="side"><h3>' + WORDS.sideBand + '</h3><div class="fl-grid">' + node(WORDS.buyers, WORDS.noside, "l") + '<div class="fl-lanes">' + side + "</div>" + node(WORDS.sellers, WORDS.noside, "r") + "</div></section>" +
      '<section class="fl-band" data-b="out"><h3>' + WORDS.outBand + '</h3><div class="fl-grid">' + node(F.takers, WORDS.outside, "l") + '<div class="fl-lanes">' + out + "</div>" + node(F.providers, WORDS.outside, "r") + "</div></section></div>";
  }

  function paintSide(d) {
    const kind = d.scope.kind;
    const name = WORDS.view[kind];
    $("sfSideT").textContent = name;
    $("sfViewT").textContent = name;
    const tab = document.querySelector('#sfTabs [data-v="side"]');
    if (tab) tab.textContent = name;
    $("sfSide").setAttribute("aria-label", name);
    for (const b of $("sfView").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.w === S.w));
    const body = $("sfBody");
    let html, cap, foot;
    if (S.w === "flow") { html = flowHtml(d.flow); cap = ""; foot = ""; }
    else if (kind === "all") { html = sectorsHtml(d.sectors); cap = d.sectors.caption; foot = d.tilt.status === "ok" ? d.tilt.footer : d.tilt.reason; }
    else if (kind === "sector") { html = namesHtml(d.names); cap = d.names.caption; foot = d.names.footer || ""; }
    else { html = windowsHtml(d.windows); cap = d.windows.caption; foot = ""; }
    body.innerHTML = html;
    S.sideHtml = S.w === "flow" ? null : html;
    for (const el of body.querySelectorAll("[data-w]")) el.style.setProperty("--w", el.dataset.w + "px");
    $("sfSideCap").textContent = capText(cap);
    $("sfFoot").textContent = foot;
    $("sfBody").dataset.kind = S.w === "flow" ? "flow" : kind;
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
    const show = (k) => rows.forEach((r, i) => r.classList.toggle("cut", i >= k));
    const over = () => host.scrollHeight > host.clientHeight + 1;
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

  function leanSvg(lean) {
    const p = lean.pct;
    return '<svg class="sf-lean" viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label="' + esc(lean.line.text) + '"><rect class="sf-ltr" x="0" y="4" width="100" height="4"/><rect class="sf-lbr" x="' + p.lo + '" y="2" width="' + Math.max(p.hi - p.lo, 0.8) + '" height="8"/><line class="sf-lsh" x1="' + p.share + '" x2="' + p.share + '" y1="0" y2="12"/></svg>';
  }

  function paintRead(d) {
    const lean = d.lean;
    let html = '<div class="rd-lean"><p class="rd-t">' + esc(lean.line.text) + "</p>" + (lean.line.shown ? leanSvg(lean) + '<p class="rd-k">' + esc(WORDS.leanKey) + "</p>" : "") + "</div>";
    html += '<ul class="rd-l">' + d.reading.slice(0).map((t) => "<li>" + esc(t) + "</li>").join("") + "</ul>";
    html += '<div class="rd-m"><p title="' + esc(d.stock.memo.exact) + '">' + esc(d.stock.memo.text) + "</p><p>" + esc(d.stock.notBuilt) + "</p></div>";
    $("sfReadBox").innerHTML = html;
  }

  function paintChecks(d) {
    const items = d.checks.items;
    $("sfChecks").innerHTML = items.map((i) => '<button type="button" class="sf-chk" data-id="' + i.id + '" data-state="' + i.state + '" title="' + esc(i.hover) + '"><i aria-hidden="true">' + GLYPH[i.state] + "</i>" + esc(i.label) + '<span class="visually-hidden"> ' + STATE_WORD[i.state] + "</span></button>").join("");
    S.checks = items;
    S.head = d.checks.head;
    if (!root.dataset.checks) root.dataset.checks = "closed";
    resetCheckLine();
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
    $("sfCheckLine").textContent = failing ? failing.text : WORDS.summary(S.head.label, count("pass"), count("fail"), count("absent"));
    $("sfCheckLine").title = S.head.hover;
    lineRole();
  }

  function paintHead(d) {
    const p = d.period;
    $("sfStamp").textContent = p.label || "";
    for (const b of $("sfPeriod").querySelectorAll("button")) {
      const info = d.periods.find((x) => x.id === b.dataset.p);
      b.setAttribute("aria-pressed", String(b.dataset.p === p.id));
      b.setAttribute("aria-disabled", String(!(info && info.ok)));
      if (info && !info.ok && info.reason) b.title = info.reason; else b.removeAttribute("title");
    }
    const crumbs = d.scope && d.scope.crumbs ? d.scope.crumbs : [{ label: "All sectors", key: "all" }];
    $("sfCrumbs").innerHTML = crumbs.map((c, i) => (i === crumbs.length - 1 ? '<span aria-current="page">' + esc(c.label) + "</span>" : '<button type="button" data-scope="' + esc(c.key) + '">' + esc(c.label) + "</button>")).join('<i aria-hidden="true">›</i>');
    $("sfScope").textContent = d.scope && d.scope.line ? d.scope.line : "";
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

  function paint(d) {
    S.data = d;
    root.dataset.state = d.status;
    paintHead(d);
    if (d.status !== "ok") {
      $("sfChecks").innerHTML = "";
      $("sfCheckLine").textContent = "";
      lineRole();
      setNote(d.why || "", false);
      say(d.why || "");
      return;
    }
    setNote("", false);
    paintChecks(d);
    paintLedger(d);
    paintSide(d);
    paintRead(d);
    say(d.scope.line);
  }

  function freshFrom(res, body) {
    const upd = Number(res.headers.get("X-Payload-Updated")) || null;
    const f = typeof UI.freshFrom === "function" ? UI.freshFrom(res) : null;
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
      $("sfChecks").innerHTML = "";
      $("sfCheckLine").textContent = "";
      lineRole();
      setNote(WORDS.failed(clockOf(Date.now())), true);
      say(WORDS.failed(clockOf(Date.now())));
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
    $("sfStage").dataset.view = tab;
    for (const b of $("sfTabs").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.v === tab));
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
    if (group) { S.group = group.dataset.g; if (S.data && S.data.status === "ok") paintLedger(S.data); return; }
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
    new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const host = $("sfBody");
        if (S.sideHtml && host.clientHeight + "x" + host.clientWidth !== S.fitKey) fit();
      });
    }).observe($("sfBody"));
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

  matchMedia("(max-width:899px)").addEventListener("change", () => { lineRole(); if (S.data && S.data.status === "ok") { paintLedger(S.data); paintSide(S.data); } });

  readHash();
  say(WORDS.loading);
  load().then((body) => {
    if (typeof UI.heartbeat !== "function") return;
    S.beat = UI.heartbeat({
      keys: ["alerts", "breadth"], nightly: ["flowalerts"], page: "ledger",
      onChange: () => { load(); },
    });
    return body;
  });
})();
