(function () {
  "use strict";

  const grid = document.getElementById("ftGrid");
  if (!grid) return;

  const scroller = document.getElementById("ftScroll");
  const scrollPos = () => Math.round(window.scrollY + (scroller ? scroller.scrollTop : 0));

  const P = window.FlowsPanels;
  if (!P) {
    console.error(
      "flows-ticker: assets/js/flows-panels.js must load before this file — " +
      "the panel renderers live there and this page has nothing to draw with.");
    return;
  }

  const {
    el, svgEl, isNum, deadPanel, DASH, MINUS, AXIS_CH,
    neg, pct, px2, vol1, compact,

    appendMethod, leadReading,
  } = P;

  const statusEl = document.getElementById("ftStatus");
  const staleEl = document.getElementById("ftStale");
  const headEl = document.getElementById("ftHead");
  const footEl = document.getElementById("ftFoot");
  const picker = document.getElementById("ftPicker");
  const $ = (id) => document.getElementById(id);

  const ftWidth = P.panelWidth;

  function appendNotes(host, notes, summary) {
    appendMethod(host, (notes || [])
      .filter((n) => n && String(n).trim())
      .map((n) => el("p", "fc-note", String(n).trim().replace(/\.+$/, "") + ".")),
      summary || "How to read this panel");
  }

  const WHY_TERM_MAX = 48;
  const WHY_TERM_TAGS = ["TH", "H4", "DT"];

  function whyTerm(node) {

    if (node.classList.contains("fc-stat")) {
      const dt = node.querySelector("dt");
      return dt ? String(dt.textContent || "").trim() : "";
    }
    return WHY_TERM_TAGS.indexOf(node.tagName) >= 0
      ? String(node.textContent || "").replace(/\s+/g, " ").trim()
      : "";
  }

  function markExplained(host) {
    const rows = [];
    const seen = new Set();
    for (const node of host.querySelectorAll("[title]")) {
      const why = String(node.getAttribute("title") || "").trim();
      if (!why) continue;
      const shown = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (!shown || shown.length > WHY_TERM_MAX) continue;
      node.classList.add("fc-why");
      const term = whyTerm(node);
      if (!term) continue;

      const key = term + "\u0000" + why;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([term, why]);
    }
    if (!rows.length) return;
    const box = el("details", "ft-how ft-why");
    box.append(el("summary", "ft-how-s",
      "What the marked terms mean (" + rows.length + ")"));

    const dl = el("dl", "ft-why-l");
    for (const [term, why] of rows) {
      dl.append(el("dt", "ft-why-t", term));
      dl.append(el("dd", "ft-why-d", why));
    }
    box.append(dl);
    host.append(box);
  }

  function ftsVol(v) {
    const F = window.FlowsPanels;
    const n = F.isNum(v);
    return n === null ? F.DASH : (n * 100).toFixed(1);
  }

  function ftsPts(v) {
    const F = window.FlowsPanels;
    const n = F.isNum(v);
    if (n === null) return F.DASH;
    return (n < 0 ? F.MINUS : n > 0 ? "+" : "") + Math.abs(n * 100).toFixed(1);
  }

  function ftsBand(m, dp) {
    const F = window.FlowsPanels;
    const n = F.isNum(m);
    if (n === null) return F.DASH;

    const s = n.toFixed(dp);
    return F.neg(/^-0\.?0*$/.test(s) ? s.slice(1) : s);
  }

  function ftsPlural(n, one, many) {
    return n === 1 ? one : many;
  }

  function drawIvSurface(host, panel, card, question, mount) {
    const F = window.FlowsPanels;
    const { el, svgEl, isNum, deadPanel, panelHead, statList, DASH, AXIS_CH } = F;

    const q = question ||
      "Where on the smile is this book bid, and how much of the chain is that reading taken over?";

    if (panel === undefined || panel === null) {
      return deadPanel(host, q, "this card was built before the option chain leg shipped");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    const cols = Array.isArray(panel.expiries) ? panel.expiries : [];
    const ivM = Array.isArray(panel.iv) ? panel.iv : [];
    const skM = Array.isArray(panel.skew) ? panel.skew : [];
    const trM = Array.isArray(panel.traded) ? panel.traded : [];
    const kM = Array.isArray(panel.strike) ? panel.strike : [];

    if (!ivM.length || !cols.length || !rows.length) {
      return deadPanel(host, q, "no usable moneyness bands");
    }

    panelHead(host, q);

    const tag = String(mount || "grid");

    const W = ftWidth(host);
    const labelW = 46, padR = 10, padT = 34, keyH = 24;
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const colW = plotW / cols.length;

    const rowH = Math.max(11, Math.min(24, 300 / rows.length));
    const gridH = rows.length * rowH;
    const H = Math.round(padT + gridH + keyH);

    const withNumbers = colW >= 26 && rowH >= 12;

    const chW = (fs) => (AXIS_CH * fs) / 10;

    const cap = isNum(panel.skewCap);
    const step = isNum(panel.step);

    const dp = step !== null && step < 0.01 ? 3 : 2;

    const placed = isNum(panel.placed), fresh = isNum(panel.fresh);
    let peak = null;
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < cols.length; j++) {
        const sk = isNum(Array.isArray(skM[i]) ? skM[i][j] : null);
        if (sk === null) continue;
        if (peak === null || Math.abs(sk) > Math.abs(peak.s)) peak = { s: sk, i, j };
      }
    }
    const peakCell = peak === null ? null
      : ftsBand(isNum(rows[peak.i]), dp) + " · " +
        String((cols[peak.j] && cols[peak.j].expiry) || DASH).slice(5);
    leadReading(host, peak === null
      ? "No cell on this surface carries a measured distance from its own expiry's " +
        "at-the-money level, so the grid below shows where this book is listed and " +
        "nothing about how far off the level it is quoted."
      : peak.s === 0
        ? "Every quote on this surface sits exactly on its own expiry's at-the-money " +
          "level: a measured flat smile across " + rows.length + " " +
          ftsPlural(rows.length, "band", "bands") + " and " + cols.length + " " +
          ftsPlural(cols.length, "expiry", "expiries") + ", not an absence of readings."
        : "The steepest quote on this surface is " + ftsPts(peak.s) + " volatility points " +
          (peak.s > 0 ? "above" : "below") + " its own expiry’s at-the-money level, at " +
          peakCell + "." +
          (fresh === null || placed === null
            ? " How many of these cells traded today is not published."
            : " " + fresh + " of " + placed + " placed cells are prints from today."));

    let atmRow = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = isNum(rows[i]), b = isNum(rows[atmRow]);
      if (a === null) continue;
      if (b === null || Math.abs(a) < Math.abs(b)) atmRow = i;
    }

    const svg = svgEl("svg", {
      class: "fts", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: `ftsNeg-${tag}`, width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "fts-negpat",
    });
    pat.append(svgEl("line", {
      x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6,
    }));
    defs.append(pat);
    svg.append(defs);

    cols.forEach((e, j) => {
      const x = plotL + j * colW + colW / 2;
      const atmIv = isNum(e && e.atmIv);
      const days = isNum(e && e.days);

      const group = svgEl("g", { class: "fts-colhead" });
      const title = svgEl("title");
      const bits = [String(e && e.expiry) + (days === null ? "" : ", " + days + " days")];
      if (atmIv === null) {

        bits.push("No at-the-money level: " +
          ((e && e.atmReason) || "this expiry has no quote inside the band an at-the-money print may sit in") +
          ". Every cell in this column is drawn hollow, because their position on the smile is unknown");
      } else {
        const am = isNum(e.atmM), ak = isNum(e.atmStrike);
        bits.push("At the money " + ftsVol(atmIv) + "% implied" +
          (ak === null ? "" : ", from the " + ak.toFixed(2) + " strike") +
          (am === null ? "" : " at ln(K/S) " + ftsBand(am, dp)) +
          ", and it traded today — a level this surface will vouch for");
        bits.push("Every cell in this column is shaded against this number");
      }
      title.textContent = bits.join(". ") + ".";
      group.append(title);

      const lvl = svgEl("text", {
        class: "fts-level" + (atmIv === null ? " is-missing" : ""),
        x, y: padT - 27, "text-anchor": "middle",
        "font-family": "var(--font-figure)", "font-size": 9,
        fill: "currentColor", "fill-opacity": atmIv === null ? 0.55 : 1,
        "font-weight": atmIv === null ? 400 : 700,
      });
      lvl.textContent = atmIv === null ? DASH : ftsVol(atmIv);
      group.append(lvl);

      const head = svgEl("text", {
        class: "fts-exp", x, y: padT - 17, "text-anchor": "middle",
        "font-family": "var(--font-figure)", "font-size": 9,
        fill: "currentColor", "fill-opacity": 0.8,
      });

      head.textContent = String(e && e.expiry).slice(5);
      group.append(head);

      const tenor = svgEl("text", {
        class: "fts-days", x, y: padT - 6, "text-anchor": "middle",
        "font-family": "var(--font-figure)", "font-size": 8.5,
        fill: "currentColor", "fill-opacity": 0.6,
      });
      tenor.textContent = days === null ? DASH : days + "d";
      group.append(tenor);
      svg.append(group);

      if (j > 0) {
        svg.append(svgEl("line", {
          class: "fts-colrule", x1: plotL + j * colW - 0.5, x2: plotL + j * colW - 0.5,
          y1: padT, y2: padT + gridH,
          stroke: "currentColor", "stroke-width": 0.5, "stroke-opacity": 0.18,
        }));
      }
    });

    const cellW = Math.max(1, colW - 1), cellH = Math.max(1, rowH - 1);
    let hollow = 0, voids = 0, hatched = 0, clippedDrawn = 0;

    rows.forEach((mRaw, i) => {
      const y = padT + i * rowH;
      const m = isNum(mRaw);
      const ivRow = Array.isArray(ivM[i]) ? ivM[i] : [];
      const skRow = Array.isArray(skM[i]) ? skM[i] : [];
      const trRow = Array.isArray(trM[i]) ? trM[i] : [];
      const kRow = Array.isArray(kM[i]) ? kM[i] : [];

      cols.forEach((e, j) => {
        const x = plotL + j * colW;
        const iv = isNum(ivRow[j]);
        const skew = isNum(skRow[j]);
        const strike = isNum(kRow[j]);
        const traded = trRow[j] === 1 ? 1 : trRow[j] === 0 ? 0 : null;
        const atmIv = isNum(e && e.atmIv);

        if (iv === null) {
          voids++;
          const vg = svgEl("g", { class: "fts-cellgroup" });
          const vt = svgEl("title");
          vt.textContent = strike === null
            ? "No listed contract in the " + ftsBand(m, dp) + " band on " + String(e && e.expiry) +
              ". Not a volatility of zero — nothing was quoted here at all."
            : "A contract is listed at " + strike.toFixed(2) + " on " + String(e && e.expiry) +
              " but this surface carries no implied volatility for it, so the cell is left empty " +
              "rather than filled with a number nobody quoted.";
          vg.append(vt);
          vg.append(svgEl("rect", {
            class: "fts-void", x, y, width: cellW, height: cellH,
            fill: "currentColor", "fill-opacity": 0.07,
          }));
          svg.append(vg);
          return;
        }

        const mag = skew !== null && cap !== null && cap > 0
          ? Math.min(1, Math.abs(skew) / cap) : 0;
        const isNeg = skew !== null && skew < 0;

        const clipped = skew !== null && cap !== null && Math.abs(skew) > cap;
        if (clipped) clippedDrawn++;
        if (skew === null) hollow++;

        const group = svgEl("g", { class: "fts-cellgroup" });

        const title = svgEl("title");
        const parts = [];

        parts.push((strike === null ? "This contract" : strike.toFixed(2)) +
          " on " + String(e && e.expiry) + ", in the ln(K/S) " + ftsBand(m, dp) +
          " band · " + ftsVol(iv) + "% implied");
        if (skew === null) {
          parts.push("No skew: " +
            ((e && e.atmReason) || "this expiry has no at-the-money level this surface will vouch for") +
            ". Its position on the smile is unknown, which is why the cell is hollow — it is not flat");
        } else {
          parts.push(ftsPts(skew) + " volatility points against this expiry's at-the-money " +
            ftsVol(atmIv) + "%");
        }
        parts.push(traded === 1
          ? "This contract traded today, so its implied volatility is today's print"
          : traded === 0
            ? "This contract did NOT trade today. This vendor's implied volatility is the last transaction's, so this one is of unknown age — it is drawn, and it did not set this expiry's level"
            : "The vendor reported no volume for this contract at all, so whether this volatility is today's is unknown. Not the same fact as a contract that did not trade — it did not set this expiry's level either");
        if (clipped) {
          parts.push("Past the shade cap of " + ftsPts(cap) + " points, so the shade understates it. Marked with a slash");
        }
        title.textContent = parts.join(". ") + ".";
        group.append(title);

        const rect = svgEl("rect", {

          class: "fts-cell" + (skew === null ? " is-nolevel" : "") +
            (traded === 0 ? " is-stale" : traded === null ? " is-unknown-age" : ""),
          x, y, width: cellW, height: cellH,
          fill: skew === null ? "none" : "currentColor",
          "fill-opacity": skew === null ? null : (0.12 + 0.46 * mag).toFixed(3),

          stroke: "currentColor",
          "stroke-width": 1,
          "stroke-dasharray": traded === 0 ? "3 2" : traded === null ? "1 2" : null,
          "stroke-opacity": traded === 1 ? 0.5 : 0.9,
        });
        group.append(rect);

        if (skew === null) {

          const len = Math.min(9, Math.max(4, Math.min(cellW, cellH) - 4));
          const cx = x + cellW / 2, cy = y + cellH / 2;
          group.append(svgEl("line", {
            class: "fts-nolevel-mark",
            x1: (cx - len / 2).toFixed(2), y1: (cy - len / 2).toFixed(2),
            x2: (cx + len / 2).toFixed(2), y2: (cy + len / 2).toFixed(2),
            stroke: "currentColor", "stroke-width": 1,
          }));
        }

        if (isNeg && rowH >= 9 && colW >= 9) {
          hatched++;
          group.append(svgEl("rect", {
            class: "fts-hatch", x, y, width: cellW, height: cellH,
            fill: `url(#ftsNeg-${tag})`,

            opacity: 0.5,
          }));
        }

        if (clipped) {

          const slash = Math.min(9, Math.max(4, cellW - 4));
          group.append(svgEl("line", {
            class: "fts-clip",
            x1: (x + 3).toFixed(2), y1: (y + cellH - 3).toFixed(2),
            x2: (x + 3 + slash).toFixed(2), y2: Math.max(y + 2, y + cellH - 3 - slash).toFixed(2),
            stroke: "currentColor", "stroke-width": 1.2, "stroke-opacity": 0.9,
          }));
        }

        if (withNumbers) {
          const t = svgEl("text", {

            class: "fts-iv" + (traded === 1 ? "" : " is-stale"),
            x: x + cellW / 2, y: y + cellH / 2 + 3.2, "text-anchor": "middle",
            "font-family": "var(--font-figure)", "font-size": 9,
            fill: "currentColor",
          });
          t.textContent = ftsVol(iv);
          group.append(t);
        }
        svg.append(group);
      });
    });

    const must = new Set([0, rows.length - 1, atmRow]);
    const stride = Math.max(1, Math.ceil(13 / rowH));
    rows.forEach((mRaw, i) => {
      if (!must.has(i)) {
        if (i % stride !== 0) return;
        let crowds = false;
        must.forEach((k) => { if (Math.abs(k - i) * rowH < 12) crowds = true; });
        if (crowds) return;
      }
      const t = svgEl("text", {
        class: "fts-m" + (i === atmRow ? " is-atm" : ""),
        x: labelW - 6, y: padT + i * rowH + rowH / 2 + 3.2, "text-anchor": "end",
        "font-family": "var(--font-figure)", "font-size": 9.5,
        fill: "currentColor", "fill-opacity": i === atmRow ? 1 : 0.7,
        "font-weight": i === atmRow ? 700 : 400,
      });
      t.textContent = ftsBand(isNum(mRaw), dp);
      svg.append(t);
    });

    const keyTop = padT + gridH;
    const KEY_FS = 9, SW = 12, SWH = 8, PAD_LB = 3, GAP = 10;
    const kchW = chW(KEY_FS);
    const capTxt = cap === null ? null : (cap * 100).toFixed(1);

    const keyItems = [
      { kind: "ramp", n: 3, label: capTxt === null ? "shade carries no size" : "0 to " + capTxt + " pts" },
      { kind: "hatch", n: 1, label: "under ATM" },
      { kind: "hollow", n: 1, label: "no level" },
      { kind: "border", n: 1, dash: null, label: "today" },
      { kind: "border", n: 1, dash: "3 2", label: "not today" },
      { kind: "border", n: 1, dash: "1 2", label: "age unknown" },
    ];
    keyItems.forEach((it) => { it.w = it.n * SW + PAD_LB + it.label.length * kchW; });

    const KEY_ROWS = [keyTop + 4, keyTop + 15];
    let kr = 0, kx = 2;
    const drawSwatch = (x, y, cls, opacity, dash) => svgEl("rect", {
      class: cls, x, y, width: SW - 1, height: SWH,
      fill: opacity === null ? "none" : "currentColor",
      "fill-opacity": opacity === null ? null : opacity,
      stroke: "currentColor", "stroke-width": 1,
      "stroke-dasharray": dash || null,
      "stroke-opacity": dash ? 0.9 : 0.5,
    });

    keyItems.forEach((it) => {
      if (kx > 2 && kx + it.w > W - 2 && kr < KEY_ROWS.length - 1) { kr++; kx = 2; }
      const y = KEY_ROWS[kr];
      if (it.kind === "ramp") {

        [0, 0.5, 1].forEach((mg, n) => {
          svg.append(drawSwatch(kx + n * SW, y, "fts-cell", (0.12 + 0.46 * mg).toFixed(3), null));
        });
      } else if (it.kind === "hatch") {
        svg.append(drawSwatch(kx, y, "fts-cell", (0.58).toFixed(3), null));
        svg.append(svgEl("rect", {
          class: "fts-hatch", x: kx, y, width: SW - 1, height: SWH,
          fill: `url(#ftsNeg-${tag})`, opacity: 0.5,
        }));
      } else if (it.kind === "hollow") {
        svg.append(drawSwatch(kx, y, "fts-cell is-nolevel", null, null));
        svg.append(svgEl("line", {
          class: "fts-nolevel-mark",
          x1: kx + 2.5, y1: y + 1.5, x2: kx + SW - 3.5, y2: y + SWH - 1.5,
          stroke: "currentColor", "stroke-width": 1,
        }));
      } else {
        svg.append(drawSwatch(kx, y,
          "fts-cell" + (it.dash === "3 2" ? " is-stale" : it.dash === "1 2" ? " is-unknown-age" : ""),
          (0.12).toFixed(3), it.dash));
      }
      const t = svgEl("text", {
        class: "fts-key", x: kx + it.n * SW + PAD_LB, y: y + SWH - 1.2,
        "font-family": "var(--font-figure)", "font-size": KEY_FS,
        fill: "currentColor",
      });
      t.textContent = it.label;
      svg.append(t);
      kx += it.w + GAP;
    });

    const levelWords = cols.map((e) => String(e && e.expiry).slice(5) + " " +
      (isNum(e && e.atmIv) === null ? "no level" : ftsVol(e.atmIv) + " percent"));
    const hiBand = ftsBand(isNum(rows[0]), dp), loBand = ftsBand(isNum(rows[rows.length - 1]), dp);
    svg.setAttribute("aria-label",
      "Implied volatility by moneyness band and expiry" +
      (card && card.ticker ? " for " + card.ticker : "") + ". " +
      rows.length + " bands of log-moneyness from " + hiBand + " at the top down to " + loBand +
      ", across " + cols.length + " expiries. " +
      "At-the-money implied volatility by expiry: " + levelWords.join(", ") + ". " +
      "Each cell is that contract's own quoted volatility; the shade is how far it sits from its " +
      "own expiry's at-the-money quote, hatched below it and plain at or above it. " +
      "A solid border is a print from today, a dashed one did not trade today, a dotted one " +
      "carries no volume field at all.");

    if (window.FlowsCursor && cols.length) {
      window.FlowsCursor.attach(svg, {
        name: "Implied volatility surface, by expiry",
        band: { y0: padT, y1: padT + gridH },
        points: cols.map((e, j) => {
          const atmIv = isNum(e && e.atmIv);
          const days = isNum(e && e.days);
          const k = isNum(e && e.atmStrike);
          const fresh = isNum(e && e.fresh);
          return {
            x: plotL + j * colW + colW / 2,
            label: String((e && e.expiry) || DASH) +
              (days === null ? "" : " \u00b7 " + days + "d out"),
            rows: [

              { k: "At-the-money IV",
                v: atmIv === null
                  ? (e && e.atmReason ? String(e.atmReason) : "not published")
                  : ftsVol(atmIv) + "%" },

              { k: "At the strike", v: k === null ? "not published" : k.toFixed(2) },
              { k: "Traded today",
                v: fresh === null ? "not published" : fresh + " of this column's cells" },
            ],
          };
        }),
      });
    }

    host.append(svg);

    const pairs = [];
    pairs.push(["Bands", rows.length + (step === null ? "" : " × " + (step * 100).toFixed(1) + "%")]);
    pairs.push(["Expiries", String(cols.length)]);
    pairs.push(["Shade cap", cap === null ? DASH : "±" + capTxt + " pts"]);
    pairs.push(["Prints today", fresh === null || placed === null ? DASH : fresh + " of " + placed]);

    if (peak) pairs.push(["Steepest cell", ftsPts(peak.s) + " pts · " + peakCell]);
    host.append(statList(pairs));

    const notes = [];
    notes.push("Rows are ln(K/S), the natural log of strike over spot" +
      (step === null ? "" : ", in bands " + (step * 100).toFixed(1) + "% wide") +
      ", high strikes at the top. A row at 0.10 is a strike 10.5% above spot; a row at 0.50 " +
      "is 64.9% above — which is why these are printed as logs and not as percentages");
    notes.push("Columns are evenly spaced by listed expiry, not by elapsed time. Each column's " +
      "tenor is printed beneath it, and the volatility above it is that expiry's at-the-money " +
      "quote — read left to right, that top line is the term structure");
    notes.push(withNumbers
      ? "The number in a cell is that contract's own quoted implied volatility, as a percent"
      : "Columns are too narrow at this width to print the quoted volatilities — the shading and " +
        "the hatch carry the reading. Enlarge the panel for the numbers");
    if (cap === null) {
      notes.push("No shade scale could be measured for this grid, so shade carries no magnitude on it");
    } else {
      notes.push("The shade is that volatility against its own expiry's at-the-money quote: palest " +
        "at 0 and darkest at " + capTxt + " volatility points. THAT CAP IS THIS CHART'S OWN — a 0.9 " +
        "quantile of the skews on this grid, not a constant — so a shade here and a shade on another " +
        "name's surface are not the same number and the two panels must not be compared by eye");
    }

    notes.push("Sign is the hatch, not a colour: a hatched cell is quoted BELOW its column's " +
      "at-the-money level, a plain one at or above it — " + hatched + " of " +
      (placed === null ? rows.length * cols.length - voids : placed) + " here. There is no second " +
      "hue on this grid, so nothing about it is lost in greyscale or to a colour-blind reader");

    notes.push("A HOLLOW CELL IS NOT A FLAT ONE. It is a band on an expiry with no at-the-money " +
      "quote this surface will vouch for, so the contract's position on the smile is unknown — " +
      "note that the gamma surface on this same card draws a hollow cell for a dealer position " +
      "MEASURED at exactly zero, which is the opposite kind of fact. An empty tile is different " +
      "again: no contract listed in that band on that expiry at all");
    notes.push("Every cell carries a border, and it says where the number came from: solid is a " +
      "print from today, dashed did not trade today, dotted carries no volume field at all. This " +
      "vendor's implied volatility is the LAST TRANSACTION's, not a quote, and only a contract " +
      "that traded today was allowed to set an expiry's level — a stale cell is one marked number, " +
      "but a stale level would tilt a whole column's smile with no marker on any cell it moved");
    if (placed !== null && fresh !== null) {
      const aged = [];
      const st = isNum(panel.stale), un = isNum(panel.unknownAge);
      if (st !== null && st > 0) aged.push(st + " did not");
      if (un !== null && un > 0) {
        aged.push(un + " carr" + (un === 1 ? "ies" : "y") + " no volume at all");
      }
      notes.push(fresh + " of " + placed + " cells traded today" +
        (aged.length ? "; " + aged.join(" and ") : " — every cell on this surface is a print from today"));
    }
    if (hollow > 0) {
      notes.push(hollow + " " + ftsPlural(hollow, "cell is", "cells are") + " hollow");
    }
    if (voids > 0) {
      notes.push(voids + " " + ftsPlural(voids, "band on an expiry lists", "bands on an expiry list") +
        " no contract at all");
    }
    const clippedN = isNum(panel.clipped);
    if (cap !== null && clippedDrawn > 0) {
      notes.push("The shade is capped, so " + clippedDrawn + " " +
        ftsPlural(clippedDrawn, "cell runs", "cells run") + " past " + capTxt + " points and " +
        ftsPlural(clippedDrawn, "is", "are") + " marked with a slash rather than flattened silently " +
        "against every other saturated cell" +
        (clippedN !== null && clippedN !== clippedDrawn
          ? " (the payload counts " + clippedN + ", at a precision the wire rounds away: both the " +
            "skew and the cap are published to four decimals, and the marks here are the ones " +
            "those published numbers support)"
          : ""));
    } else if (cap !== null && clippedN !== null && clippedN > 0) {

      notes.push("The payload counts " + clippedN + " " +
        ftsPlural(clippedN, "cell", "cells") + " past the " + capTxt + "-point cap, but at the four " +
        "decimals the wire publishes none of them exceeds it, so none is marked");
    }
    const crowded = isNum(panel.crowded);
    if (crowded !== null && crowded > 0) {
      notes.push(crowded + " further " + ftsPlural(crowded, "contract falls", "contracts fall") +
        " into a band already occupied. THE CELL IS NEVER AN AVERAGE: one quoted contract is shown " +
        "— today's print first, then nearest the band's centre — because averaging two quoted " +
        "volatilities produces a number nobody quoted");
    }
    const windowed = [];
    const eS = isNum(panel.expiriesShown), eT = isNum(panel.expiriesTotal);
    const rS = isNum(panel.rowsShown), rT = isNum(panel.rowsTotal);
    if (eS !== null && eT !== null && eS < eT) windowed.push(eS + " of " + eT + " expiries");
    if (rS !== null && rT !== null && rS < rT) windowed.push(rS + " of " + rT + " moneyness bands");
    if (windowed.length) notes.push("Showing " + windowed.join(" and ") + ", nearest the money");
    if (panel.ivBasis) {
      notes.push("Volatility units resolved once for the whole chain: " + panel.ivBasis);
    }
    notes.push("Quoted volatilities, and differences between quoted volatilities on the same " +
      "expiry. Nothing here is fitted, interpolated or repriced — that would need a rate and a " +
      "dividend yield, which this desk does not invent. The band on a cell's tooltip is the band's " +
      "stated centre, not that contract's own moneyness, which the card payload does not carry");

    const cov = panel.coverage;
    if (cov && cov.truncated === true) {
      host.append(el("p", "fc-note is-qualifier",
        "The vendor returned a full page of 500 contracts in no documented order. This is an " +
        "arbitrary subset of the book — the skew and term readings are withheld for that reason."));
    } else if (cov) {
      const seen = isNum(cov.rowsSeen), priced = isNum(cov.pricedRows);
      notes.push("The vendor returned the whole chain" +
        (seen === null ? "" : ": " + seen + " " + ftsPlural(seen, "contract", "contracts") +
          (priced === null ? "" : ", " + priced + " of them priceable")) +
        ", so this surface is taken over the entire book rather than a page of it." +
        (cov.filter ? " " + cov.filter.charAt(0).toUpperCase() + cov.filter.slice(1) + "." : ""));
    } else {

      host.append(el("p", "fc-note is-qualifier",
        "This card publishes no coverage record for the chain, so how much of the book this " +
        "surface was taken over is not known."));
    }

    appendNotes(host, notes, "How to read this surface");
  }

  function drawSkewTerm(host, panel, card, question, mount) {

    const { el, svgEl, isNum, deadPanel, panelHead, statList, niceStep,
      DASH, MINUS, vol1 } = window.FlowsPanels;

    const q = question ||
      "Is the front bid over the back, and which wing is bid?";

    if (panel === undefined || panel === null) {
      return deadPanel(host, q,
        "this card was built before the option chain leg shipped");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const points = Array.isArray(panel.points) ? panel.points : [];
    if (!points.length) {
      return deadPanel(host, q,
        "the chain produced no listed expiries, so there is no term structure to draw");
    }

    panelHead(host, q);

    const skew = isNum(panel.skew);
    const skewB = panel.skewBasis || null;
    let skewSaid;
    if (skew === null || !skewB) {
      skewSaid =
        "The wing-to-wing skew is not published for this name. The reason it was " +
        "withheld is stated below, verbatim, rather than replaced by a zero — a " +
        "symmetric smile is a real and notable reading, and this is not one.";
    } else {

      skewSaid =
        `Skew ${volPts(skew)} volatility points at ` +
        `${skewB.days === null ? "an unstated tenor" : skewB.days + " days"} ` +
        `(${skewB.expiry}): ` +
        (skew > 0
          ? "the put wing is bid over the call wing."
          : skew < 0
            ? "the call wing is bid over the put wing."
            : "both wings are quoted at the same volatility.");
    }
    leadReading(host, skewSaid);

    const term = isNum(panel.term);
    const termB = panel.termBasis || null;
    let termSaid;
    if (term === null || !termB) {
      termSaid =
        "The term difference is not published for this name. The reason it was " +
        "withheld is stated below, verbatim.";
    } else {

      termSaid =
        `Term ${volPts(term)} volatility points from ` +
        `${termB.nearDays} days to ${termB.farDays} days: ` +
        (term < 0
          ? "the front is bid over the back — "
          : term > 0
            ? "the back is bid over the front — "
            : "front and back are quoted at the same level — ") +
        `at-the-money volatility ${vol1(termB.nearAtm)} at ${termB.near} against ` +
        `${vol1(termB.farAtm)} at ${termB.far}.`;
    }
    leadReading(host, termSaid);

    const W = ftWidth(host);

    const labelW = 46, padR = 10;
    const padT = 12, plotH = 132, padB = 30, railH = 14;
    const H = padT + plotH + padB + railH;
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const baseY = padT + plotH;
    const railY = baseY + railH / 2;

    const grid = termColumns(panel, card, points);
    const cols = grid.cols;
    const colW = plotW / cols.length;
    const cxOf = (j) => plotL + colW * (j + 0.5);

    const barW = Math.max(2, Math.min(colW - 8, 34));

    const levelOf = (col) => (col.point ? isNum(col.point.atmIv) : null);
    const tenorOf = (col) => (col.days === null ? "an unstated tenor" : col.days + " days");

    const levels = cols.map(levelOf);
    const measured = levels.filter((v) => v !== null);
    const maxIv = measured.length ? Math.max(...measured) : null;

    let step = 0, top = 0, nTicks = 0;
    if (maxIv !== null && maxIv > 0) {
      step = niceStep(maxIv / 4) || maxIv / 4;
      top = Math.ceil(maxIv / step) * step;
      if (top <= maxIv) top += step;
      nTicks = Math.round(top / step);
    }
    const yOf = (v) => baseY - (v / top) * plotH;

    const svg = svgEl("svg", {
      class: "ftm", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      preserveAspectRatio: "xMidYMid meet", role: "img",
    });

    const text = (cls, attrs, size, content) => {
      const t = svgEl("text", Object.assign({
        class: cls, "font-family": "var(--font-figure)", "font-size": size,
        fill: "currentColor",
      }, attrs));
      t.textContent = content;
      return t;
    };

    if (top > 0) {
      for (let i = 0; i <= nTicks; i++) {
        const v = i * step;
        const yy = Number(yOf(v).toFixed(1));

        if (i > 0) {
          svg.append(svgEl("line", {
            class: "ftm-axis", x1: plotL, x2: plotL + plotW, y1: yy, y2: yy,
            stroke: "currentColor", "stroke-opacity": 0.16,
          }));
        }
        svg.append(text("ftm-lab", {
          x: labelW - 6, y: yy + 3, "text-anchor": "end",
        }, 9, vol1(v)));
      }
    }

    svg.append(svgEl("line", {
      class: "ftm-base", x1: plotL, x2: plotL + plotW, y1: baseY, y2: baseY,
      stroke: "currentColor", "stroke-opacity": 0.5,
    }));

    const missing = cols.filter((c) => levelOf(c) === null);
    if (missing.length) {
      svg.append(svgEl("line", {
        class: "ftm-missrail", x1: plotL, x2: plotL + plotW, y1: railY, y2: railY,
        stroke: "currentColor", "stroke-opacity": 0.28, "stroke-dasharray": "2 3",
      }));
    }

    let d = "", open = false;
    cols.forEach((col, j) => {
      const cx = cxOf(j);
      const v = top > 0 ? levelOf(col) : null;

      if (v === null) {

        const why = col.point
          ? (col.point.reason || panel.atmReason ||
             "the surface levelled no at-the-money contract for this expiry")
          : grid.uncoveredReason;
        const g = svgEl("g", {});
        const title = svgEl("title", {});
        title.textContent = col.expiry +
          (col.days === null ? "" : ` (${col.days}d)`) + ": " + why;
        g.append(title);
        g.append(svgEl("circle", {
          class: "ftm-dot is-missing", cx: Number(cx.toFixed(1)), cy: railY, r: 2.6,
          fill: "none", stroke: "currentColor", "stroke-width": 1.2,
        }));
        svg.append(g);
        open = false;
        return;
      }

      const yTop = yOf(v);
      svg.append(svgEl("rect", {
        class: "ftm-bar", x: Number((cx - barW / 2).toFixed(1)), y: Number(yTop.toFixed(1)),
        width: Number(barW.toFixed(1)),
        height: Number(Math.max(0.5, baseY - yTop).toFixed(1)),
        fill: "currentColor", "fill-opacity": 0.28,
      }));
      d += (open ? "L" : "M") + cx.toFixed(1) + " " + yTop.toFixed(1) + " ";
      open = true;
    });

    if (d) {
      svg.append(svgEl("path", {
        class: "ftm-line", d: d.trim(), fill: "none", stroke: "currentColor",
        "stroke-width": 1.8, "stroke-linejoin": "round",
      }));
    }
    cols.forEach((col, j) => {
      const v = top > 0 ? levelOf(col) : null;
      if (v === null) return;
      const g = svgEl("g", {});
      const title = svgEl("title", {});
      title.textContent = col.expiry + (col.days === null ? "" : ` (${col.days}d)`) +
        ": at-the-money iv " + vol1(v);
      g.append(title);
      g.append(svgEl("circle", {
        class: "ftm-dot", cx: Number(cxOf(j).toFixed(1)), cy: Number(yOf(v).toFixed(1)),
        r: 2.6, fill: "currentColor",
      }));
      svg.append(g);
    });

    const labelNeed = 5 * 6 * 0.95 + 4;
    const stride = Math.max(1, Math.ceil(labelNeed / Math.max(1, colW)));
    cols.forEach((col, j) => {
      if (j % stride !== 0 && j !== cols.length - 1) return;
      const cx = Number(cxOf(j).toFixed(1));

      svg.append(text("ftm-lab", { x: cx, y: baseY + railH + 11, "text-anchor": "middle" },
        9.5, String(col.expiry || "").slice(5) || DASH));
      svg.append(text("ftm-lab is-tenor", { x: cx, y: baseY + railH + 21, "text-anchor": "middle" },
        9, col.days === null ? DASH : col.days + "d"));
    });

    const firstM = cols.find((c) => levelOf(c) !== null);
    const lastM = cols.slice().reverse().find((c) => levelOf(c) !== null);
    const plural = cols.length === 1 ? "expiry" : "expiries";
    svg.setAttribute("aria-label",
      measured.length === 0
        ? `At-the-money implied volatility across ${cols.length} listed ${plural}: no expiry ` +
          "carried a level this session, so no bar is drawn and every column is marked on " +
          "the rail below the axis."
        : `At-the-money implied volatility across ${cols.length} listed ${plural}, ` +
          (measured.length === 1
            ? `a single level of ${vol1(levelOf(firstM))} at ${tenorOf(firstM)}.`
            : `from ${vol1(levelOf(firstM))} at ${tenorOf(firstM)} to ` +
              `${vol1(levelOf(lastM))} at ${tenorOf(lastM)}.`) +
          (missing.length
            ? ` ${missing.length} of ${cols.length} columns carry no level and are marked ` +
              "on the rail below the axis."
            : ""));

    if (window.FlowsCursor && cols.length) {
      window.FlowsCursor.attach(svg, {
        name: "At-the-money level along the term",
        band: { y0: padT, y1: baseY },
        points: cols.map((col, j) => {
          const v = levelOf(col);
          const why = col.point && col.point.reason ? String(col.point.reason) : null;
          return {
            x: cxOf(j),
            label: String((col.point && col.point.expiry) || DASH) +
              " \u00b7 " + tenorOf(col),
            rows: [
              { k: "At-the-money IV",
                v: v === null ? (why || "no level on this column") : vol1(v) },
            ],
          };
        }),
      });
    }

    host.append(svg);

    if (skew !== null && skewB) {
      host.append(statList([
        ["Put wing", wingText(skewB.putM, skewB.putStrike, skewB.putIv, skewB.putTraded)],
        ["Call wing", wingText(skewB.callM, skewB.callStrike, skewB.callIv, skewB.callTraded)],
        ["Target", "ln(K/S) = " + MINUS + "0.10 and +0.10, nearest listed strike within 0.04"],
        ["Expiry floor", "7 days — measured on " + skewB.expiry +
          (skewB.days === null ? "" : " (" + skewB.days + "d)")],
      ]));
    }

    if (term !== null && termB) {
      host.append(statList([
        ["Near leg", termB.near + " (" + termB.nearDays + "d) · " + vol1(termB.nearAtm)],
        ["Far leg", termB.far + " (" + termB.farDays + "d) · " + vol1(termB.farAtm)],
        ["Far floor", "45 days — the nearest LEVELLED expiry at or past it"],
      ]));
    }

    const silence = (key) =>
      (key in panel ? (panel[key] === null ? "quiet" : "unreadable") : "unavailable");
    const atm = isNum(panel.atmIv);
    const band = isNum(panel.atmBand);
    host.append(statList([
      ["At-the-money level", atm === null ? DASH
        : vol1(atm) + (panel.atmExpiry ? " at " + panel.atmExpiry : ""),
        atm === null ? "is-null" : null,
        atm === null ? silence("atmIv") : null,
        atm === null ? panel.atmReason ||
          "This card's chain panel carries no at-the-money level and no reason for it." : null],
      ["Expiries levelled", `${measured.length} of ${cols.length} drawn`],
      ["Moneyness band", band === null ? DASH : "±" + band.toFixed(2) + " ln(K/S)",
        band === null ? "is-null" : null,
        band === null ? silence("atmBand") : null,
        band === null
          ? "The band a quote must sit inside to be counted at the money is this surface's " +
            "own constant, and this card does not state it, so the level above cannot be " +
            "read against the window it was taken from."
          : null],
    ]));

    const method = [];

    method.push(
      "Columns are evenly spaced by listed expiry, not by elapsed time. Each " +
      "column's tenor is printed beneath it. " +
      (top > 0
        ? `The axis runs from zero to ${vol1(top)} — the next round volatility point ` +
          `above the largest level drawn (${vol1(maxIv)}), on a ${vol1(step)} ladder. That is a ` +
          "round number rather than a headroom multiplier, so every tick is a volatility a " +
          "reader recognises. "
        : "There is no vertical scale: nothing on this chain carried a level to scale to. ") +
      "The origin is ZERO because at-the-money volatility is a level, not a change — " +
      "there is no “no move” reading to rule, and a truncated axis would make any " +
      "term structure look dramatic by construction. The cost is that levels a few points " +
      "apart draw as bars of similar height: read the LINE for the shape and the bars for " +
      "the level.");

    if (missing.length) {
      host.append(el("p", "fc-note is-qualifier",
        `${missing.length} of ${cols.length} columns carry no at-the-money level and sit on ` +
        "the rail BELOW the axis, not on it. Each marker carries that expiry's own stated " +
        "reason."));
      method.push(
        "A column with no level sits on the rail below the axis rather than on it because " +
        "the baseline is zero implied volatility, and a level the surface refused to vouch " +
        "for would be drawn there as a confident measurement of nothing. The line breaks " +
        "across those columns rather than crossing a value nobody measured.");
    }

    if (grid.borrowedNote) host.append(el("p", "fc-note is-qualifier", grid.borrowedNote));

    const cov = panel.coverage ||
      (card && card.panels && card.panels.ivSurface && card.panels.ivSurface.coverage) || null;
    if (cov) {
      const parts = [];
      if (cov.truncated) {
        const seen = isNum(cov.rowsSeen), pricedRows = isNum(cov.pricedRows);
        parts.push("THIS CHAIN WAS TRUNCATED." +
          (seen === null ? "" : ` The vendor returned ${seen} rows` +
            (pricedRows === null ? "." : `, ${pricedRows} of them quoted.`)) +
          " The levels drawn above are built from that slice of the book, not from the book.");
      }
      if (cov.filter) parts.push("Selection: " + cov.filter + ".");
      if (parts.length) host.append(el("p", "fc-note is-qualifier", parts.join(" ")));
    }

    const reasons = [];
    if (skew === null && panel.skewReason) reasons.push(["The skew", panel.skewReason]);
    if (term === null && panel.termReason) reasons.push(["The term difference", panel.termReason]);
    if (reasons.length === 2 && reasons[0][1] === reasons[1][1]) {
      host.append(el("p", "fc-note is-qualifier",
        "Neither scalar is published: " + reasons[0][1] + "."));
    } else {
      for (const pair of reasons) {
        host.append(el("p", "fc-note is-qualifier", pair[0] + " is not published: " + pair[1] + "."));
      }
    }

    if (panel.relation) host.append(el("p", "fc-note is-qualifier", panel.relation));

    appendNotes(host, method, "How to read this term structure");
  }

  function volPts(v) {
    const { signed } = window.FlowsPanels;
    return v === 0 ? "0.0" : signed(v * 100, (a) => a.toFixed(1));
  }

  function wingText(m, strike, iv, traded) {
    const { isNum, DASH, signed, px2, vol1 } = window.FlowsPanels;
    const mm = isNum(m), kk = isNum(strike), vv = isNum(iv);
    if (mm === null && kk === null && vv === null) return DASH;
    return "ln(K/S) " + (mm === null ? DASH : signed(mm, (a) => a.toFixed(4))) +
      " · K " + (kk === null ? DASH : px2(kk)) +
      " · iv " + (vv === null ? DASH : vol1(vv)) +
      " · " + (traded === 1 ? "traded today"
        : traded === 0 ? "quoted, did not trade today"
          : "volume not reported");
  }

  function termColumns(panel, card, points) {
    const { isNum } = window.FlowsPanels;

    const own = {
      cols: points.map((p) => ({ expiry: p.expiry, days: isNum(p.days), point: p })),
      borrowedNote: null,
      uncoveredReason: "this expiry carries no at-the-money reading on this panel",
    };

    const surf = card && card.panels && card.panels.ivSurface;
    const expiries = surf && surf.status === "ok" && Array.isArray(surf.expiries)
      ? surf.expiries : null;
    if (!expiries || !expiries.length) return own;

    const byExpiry = new Map();
    for (const p of points) if (p && p.expiry) byExpiry.set(p.expiry, p);

    if (byExpiry.size !== points.length) return own;
    if (!points.every((p) => expiries.some((e) => e.expiry === p.expiry))) return own;

    const cols = expiries.map((e) => ({
      expiry: e.expiry,
      days: isNum(e.days),
      point: byExpiry.get(e.expiry) || null,
    }));

    const identical = expiries.length === points.length &&
      expiries.every((e, j) => e.expiry === points[j].expiry);

    return {
      cols,
      borrowedNote: identical ? null
        : `The term line covers ${points.length} of the ${cols.length} expiries drawn on the ` +
          "surface above. The two panels were built from DIFFERENT reads of the same chain: " +
          "the surface from the broad call, the term line from a second, single-expiry call " +
          "the pipeline spends when the first page truncates. Columns are held aligned with " +
          "the surface, so the same x position means the same expiry on both panels, and the " +
          "expiries the term line does not cover carry no mark.",
      uncoveredReason:
        "the term line was rebuilt from a single-expiry read after the broad page truncated, " +
        "so it carries no level for this expiry",
    };
  }

  const TC_TRUNCATED_NOTE =
    "The vendor returned a full page of 500 contracts in no documented order. " +
    "This is an arbitrary subset of the book — the skew and term readings are " +
    "withheld for that reason.";

  const TC_SORT = new Map();

  function tcInt(v) {
    const { isNum, DASH } = window.FlowsPanels;
    const n = isNum(v);
    return n === null ? DASH : Math.round(n).toLocaleString("en-US");
  }

  function tcSignedInt(v) {
    const { isNum, DASH, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) return DASH;
    const r = Math.round(n);
    const body = Math.abs(r).toLocaleString("en-US");
    return r < 0 ? MINUS + body : r > 0 ? "+" + body : "0";
  }

  function tcSignedPct(v) {
    const { isNum, DASH, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) return DASH;
    const p = n * 100;
    const r = Math.abs(p) >= 100 ? Math.round(p) : Math.round(p * 10) / 10;
    const body = Math.abs(r).toLocaleString("en-US") + "%";
    return r < 0 ? MINUS + body : r > 0 ? "+" + body : "0%";
  }

  function tcCalendarDays(sessionDate, expiry) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sessionDate == null ? "" : sessionDate));
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry == null ? "" : expiry));
    if (!a || !b) return null;
    const from = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
    const to = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
    return Math.round((to - from) / 86400000);
  }

  function tcAggrCell(v) {
    const { isNum, DASH, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) {
      return {
        text: DASH,
        cls: "c-num ftt-aggr is-unreported",
        title: "The vendor reported no aggressor split for this contract. That is not " +
          "a balanced tape — it is no report at all, and the two are different facts.",
      };
    }
    const r = Math.round(n);
    const body = Math.abs(r).toLocaleString("en-US");
    if (r === 0) {
      return {
        text: "0",
        cls: "c-num ftt-aggr is-flat",
        title: "Ask volume and bid volume were equal on this contract. The split was " +
          "reported, and it was balanced. Neither arrow is true at zero, so neither is drawn.",
      };
    }

    return r > 0
      ? {
        text: "↑" + body,
        cls: "c-num ftt-aggr is-lifted",
        title: body + " more contracts hit the offer than the bid on this contract.",
      }
      : {
        text: "↓" + MINUS + body,
        cls: "c-num ftt-aggr is-hit",
        title: body + " more contracts hit the bid than the offer on this contract.",
      };
  }

  function tcDoiCell(v) {
    const { isNum } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) {
      return {
        text: tcSignedInt(null),
        cls: "c-num ftt-doi is-unknown",
        title: "The vendor published no previous open interest for this contract, so the " +
          "change is not computable. This is NOT a change of zero: an open interest that " +
          "did not move prints 0.",
      };
    }
    const r = Math.round(n);
    return {
      text: tcSignedInt(n),
      cls: "c-num ftt-doi " + (r > 0 ? "is-built" : r < 0 ? "is-closed" : "is-flat"),
      title: r === 0
        ? "Open interest was identical in both counts the vendor published: measured, and unchanged."
        : r > 0
          ? Math.abs(r).toLocaleString("en-US") +
            " more contracts were open at this strike in the later of the two counts."
          : Math.abs(r).toLocaleString("en-US") +
            " fewer contracts were open at this strike in the later of the two counts.",
    };
  }

  function tcStrikeTitle(row) {
    const { isNum, MINUS, vol1 } = window.FlowsPanels;
    const parts = [];
    const m = isNum(row && row.m);

    parts.push(m === null
      ? "Log-moneyness was not computed for this contract — the card published no " +
        "spot price to measure the strike against."
      : "ln(K/S) = " + (m < 0 ? MINUS : m > 0 ? "+" : "") + Math.abs(m).toFixed(3) +
        ", the natural log of strike over spot.");
    const iv = isNum(row && row.iv);
    parts.push(iv === null
      ? "The vendor quoted no implied volatility for this contract."
      : "Implied volatility " + vol1(iv) + ", the vendor's own quote on this line.");
    return parts.join(" ");
  }

  function tcCell(text, cls, title) {
    const { el } = window.FlowsPanels;
    const td = el("td", cls || null, text);
    if (title) td.title = title;
    return td;
  }

  const TC_COLS = [
    {
      key: "k", label: "Strike", name: "Strike", cls: "c-num", kind: "num", first: "asc",
      relation: "The contract's strike, from the option symbol.",
      get: (r) => window.FlowsPanels.isNum(r.k),
      cell: (r) => ({ text: window.FlowsPanels.px2(r.k), cls: "c-num ftt-k", title: tcStrikeTitle(r) }),
    },
    {
      key: "expiry", label: "Expiry", name: "Expiry", cls: "ftt-exp", kind: "text", first: "asc",
      relation: "The contract's expiry, from the option symbol, as an ISO date.",
      get: (r) => (r.expiry == null || r.expiry === "" ? null : String(r.expiry)),
      cell: (r, ctx) => {
        const { DASH } = window.FlowsPanels;
        if (r.expiry == null || r.expiry === "") {
          return { text: DASH, cls: "ftt-exp is-unknown", title: "This contract's symbol carried no parsable expiry." };
        }

        const days = tcCalendarDays(ctx.sessionDate, r.expiry);
        return {
          text: String(r.expiry),
          cls: "ftt-exp",
          title: days === null
            ? "Expiry, as the vendor's option symbol carries it."
            : days + " calendar days from the " + ctx.sessionDate + " session. Calendar days, " +
              "not trading days: the two differ by about a third and the choice is stated " +
              "rather than left for the reader to guess.",
        };
      },
    },
    {
      key: "cp", label: "C/P", name: "Call or put", cls: "ftt-cp", kind: "text", first: "asc",
      relation: "Call or put, from the option symbol.",
      get: (r) => (r.cp == null || r.cp === "" ? null : String(r.cp)),
      cell: (r) => {
        const { DASH } = window.FlowsPanels;
        const cp = r.cp == null ? "" : String(r.cp);

        const known = cp === "C" || cp === "P";
        return {
          text: cp === "" ? DASH : cp,
          cls: "ftt-cp " + (cp === "C" ? "is-call" : cp === "P" ? "is-put" : "is-unknown"),
          title: known
            ? (cp === "C" ? "Call" : "Put")
            : cp === ""
              ? "This contract's symbol carried no parsable type."
              : "The vendor sent an option type this panel does not recognise: " + cp,
        };
      },
    },
    {
      key: "vol", label: "Vol", name: "Volume", cls: "c-num", kind: "num", first: "desc",
      relation: "Contracts traded today on this line, the vendor's own count. This is the " +
        "column the table is ranked by.",
      get: (r) => window.FlowsPanels.isNum(r.vol),
      cell: (r) => ({
        text: tcInt(r.vol), cls: "c-num ftt-vol",
        title: window.FlowsPanels.isNum(r.vol) === null
          ? "The vendor reported no volume for this contract."
          : "Contracts traded today on this line.",
      }),
    },
    {
      key: "oi", label: "OI", name: "Open interest", cls: "c-num", kind: "num", first: "desc",
      relation: "Open interest: contracts outstanding on this line.",
      get: (r) => window.FlowsPanels.isNum(r.oi),
      cell: (r) => ({
        text: tcInt(r.oi), cls: "c-num ftt-oi",
        title: window.FlowsPanels.isNum(r.oi) === null
          ? "The vendor reported no open interest for this contract."
          : "Contracts outstanding on this line.",
      }),
    },
    {
      key: "doi", label: "OI", name: "Change in open interest", cls: "c-num", kind: "num", first: "desc",
      relation: "open_interest − prev_oi: the move between two vendor open-interest counts, " +
        "whose spacing the vendor does not state.",

      labelPrefix: { text: "Δ", cls: "ftt-greek" },
      get: (r) => window.FlowsPanels.isNum(r.doi),
      cell: (r) => tcDoiCell(r.doi),
    },
    {
      key: "bidPx", label: "Bid", name: "Bid", cls: "c-num", kind: "num", first: "desc",
      relation: "nbbo_bid, as quoted. Not averaged with the ask — see the note below the table.",
      get: (r) => window.FlowsPanels.isNum(r.bidPx),
      cell: (r) => ({
        text: window.FlowsPanels.px2(r.bidPx), cls: "c-num ftt-bid",
        title: window.FlowsPanels.isNum(r.bidPx) === null
          ? "No national best bid was quoted on this contract."
          : "The national best bid, as quoted.",
      }),
    },
    {
      key: "askPx", label: "Ask", name: "Ask", cls: "c-num", kind: "num", first: "desc",
      relation: "nbbo_ask, as quoted. Not averaged with the bid — see the note below the table.",
      get: (r) => window.FlowsPanels.isNum(r.askPx),
      cell: (r) => ({
        text: window.FlowsPanels.px2(r.askPx), cls: "c-num ftt-ask",
        title: window.FlowsPanels.isNum(r.askPx) === null
          ? "No national best offer was quoted on this contract."
          : "The national best offer, as quoted.",
      }),
    },
    {
      key: "aggr", label: "Net aggr (contracts)", name: "Net aggressor volume, in contracts",
      cls: "c-num", kind: "num", first: "desc",
      relation: "ask_volume − bid_volume, in contracts. The unit is in the header because " +
        "dollarising it would need a price basis, which is a choice this panel refuses to make.",
      get: (r) => window.FlowsPanels.isNum(r.aggr),
      cell: (r) => tcAggrCell(r.aggr),
    },
  ];

  function tcSortable(col, rows) {
    for (const r of rows) {
      const v = col.get(r);
      if (v !== null && v !== undefined) return true;
    }
    return false;
  }

  function tcCompare(col, dir, a, b) {
    const x = col.get(a);
    const y = col.get(b);
    const xn = x === undefined ? null : x;
    const yn = y === undefined ? null : y;
    if (xn === null && yn === null) return 0;
    if (xn === null) return 1;
    if (yn === null) return -1;
    const d = col.kind === "text" ? String(xn).localeCompare(String(yn)) : xn - yn;
    return dir === "asc" ? d : -d;
  }

  function tcOrdered(rows, state) {
    const view = rows.map((row, index) => ({ row, index }));
    if (!state || !state.col) return view;
    view.sort((p, q) => tcCompare(state.col, state.dir, p.row, q.row) || p.index - q.index);
    return view;
  }

  function drawTopContracts(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, DASH } = window.FlowsPanels;

    const q = question || "Which single lines carried the volume?";

    if (panel === undefined || panel === null) {
      return deadPanel(host, q, "this card was built before the option chain leg shipped, " +
        "so this panel was never in it.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    if (!rows.length) {
      return deadPanel(host, q, "no contract on this chain reported volume today");
    }

    panelHead(host, q);

    const ctx = { sessionDate: card && card.sessionDate ? String(card.sessionDate) : null };

    const live = new Map();
    for (const col of TC_COLS) live.set(col.key, tcSortable(col, rows));

    const stored = TC_SORT.get(mount) || null;
    let sortKey = stored && live.get(stored.key) ? stored.key : null;
    let sortDir = stored && stored.dir === "asc" ? "asc" : "desc";

    const table = el("table", "fc-levels ftt-table");
    const thead = el("thead");
    const headRow = el("tr", "ftt-headrow");
    const buttons = new Map();
    const headCells = new Map();

    for (const col of TC_COLS) {

      const th = el("th", col.cls + " ftt-h-" + col.key);
      th.scope = "col";
      th.title = col.relation;

      const button = el("button", "ftt-sort");
      button.type = "button";
      if (col.labelPrefix) button.append(el("span", col.labelPrefix.cls, col.labelPrefix.text));
      button.append(document.createTextNode(col.label));
      const ind = el("span", "ftt-sort-ind");
      ind.setAttribute("aria-hidden", "true");
      button.append(ind);
      button.addEventListener("click", () => toggleSort(col.key));
      th.append(button);
      headRow.append(th);
      buttons.set(col.key, button);
      headCells.set(col.key, th);
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = el("tbody");
    table.append(tbody);

    function syncHeaders() {
      for (const col of TC_COLS) {
        const th = headCells.get(col.key);
        const button = buttons.get(col.key);
        const can = live.get(col.key) === true;
        const on = can && sortKey === col.key;
        button.disabled = !can;
        if (!can) th.removeAttribute("aria-sort");
        else th.setAttribute("aria-sort", on ? (sortDir === "asc" ? "ascending" : "descending") : "none");
        const ind = button.querySelector(".ftt-sort-ind");
        if (ind) ind.textContent = on ? (sortDir === "asc" ? "↑" : "↓") : "";

        button.setAttribute("aria-label", col.name + ": " + (
          on
            ? "sorted " + (sortDir === "asc" ? "ascending" : "descending") +
              ", activate to " + (sortDir === col.first
                ? "reverse"
                : "return to the published order, by volume")
            : can
              ? "activate to sort"
              : "every value in this column is unreported on this chain, so it cannot be sorted"
        ));
      }
    }

    function paintRows() {
      const frag = document.createDocumentFragment();
      for (const { row } of tcOrdered(rows, sortKey ? { col: TC_COLS.find((c) => c.key === sortKey), dir: sortDir } : null)) {
        const tr = el("tr", "ftt-row");
        for (const col of TC_COLS) {
          const spec = col.cell(row, ctx);
          tr.append(tcCell(spec.text, spec.cls, spec.title));
        }
        frag.append(tr);
      }
      tbody.replaceChildren(frag);
    }

    function toggleSort(key) {
      if (live.get(key) !== true) return;
      const col = TC_COLS.find((c) => c.key === key);
      if (!col) return;
      if (sortKey !== key) { sortKey = key; sortDir = col.first; }
      else if (sortDir === col.first) { sortDir = col.first === "desc" ? "asc" : "desc"; }
      else { sortKey = null; sortDir = "desc"; }
      if (sortKey) TC_SORT.set(mount, { key: sortKey, dir: sortDir });
      else TC_SORT.delete(mount);
      syncHeaders();
      paintRows();
    }

    syncHeaders();
    paintRows();

    const wrap = el("div", "fc-tablewrap ftt-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "The day’s most-traded contracts");
    wrap.append(table);
    host.append(wrap);

    const shownN = rows.length;
    const total = isNum(panel.total);

    let reported = 0;
    for (const r of rows) if (isNum(r.aggr) !== null) reported += 1;
    const publishedReported = isNum(panel.aggressorReported);

    const count = el("p", "fc-note ftt-count");
    count.append(document.createTextNode(
      (total === null
        ? "The " + shownN + " most-traded contracts on this chain, ranked by volume. "
        : total > shownN
          ? "The " + shownN + " most-traded of the " + tcInt(total) + " contracts that reported " +
            "a volume on this chain today, ranked by volume. "
          : "All " + shownN + " contracts that reported a volume on this chain today, ranked " +
            "by volume. ") +
      reported + " of the " + shownN + " rows shown carried an aggressor split from the vendor; " +
      "the rest print " + DASH + ", because a split that was reported and came out balanced and " +
      "a split that was never reported are different facts and only one of them is a reading."));

    if (publishedReported !== null && publishedReported !== reported) {
      count.append(document.createTextNode(
        " The payload publishes aggressorReported = " + publishedReported + ", which does not " +
        "match the " + reported + " rows above that carry one; the rows are what is drawn."));
    }
    if (isNum(panel.shown) !== null && panel.shown !== shownN) {
      count.append(document.createTextNode(
        " The payload publishes shown = " + panel.shown + " against " + shownN + " rows; the " +
        "rows are what is drawn."));
    }
    host.append(count);

    const coverage = (panel && panel.coverage) ||
      (card && card.panels && card.panels.ivSurface && card.panels.ivSurface.coverage) || null;

    if (!coverage) {
      host.append(el("p", "fc-note ftt-cover",
        "This payload carries no coverage block, so how much of the chain these rows were " +
        "drawn from is not stated. Treat the ranking as unverified rather than as complete."));
    } else if (coverage.truncated === true) {
      const cover = el("p", "fc-note ftt-cover", TC_TRUNCATED_NOTE);
      const seen = isNum(coverage.rowsSeen);
      const priced = isNum(coverage.pricedRows);
      if (seen !== null) {
        cover.title = "Measured on this card: " + tcInt(seen) + " contract rows came back" +
          (priced === null ? "" : ", " + tcInt(priced) + " of them priced") + ".";
      }
      host.append(cover);

      host.append(el("p", "fc-note ftt-scope",
        "For this panel that qualifies the ranking, not the rows. Every line above is a " +
        "contract that really traded, at the volume the vendor reported for it, and a page " +
        "limit cannot make a print that happened un-happen. What it does undo is the word " +
        "“most”: these are the " + shownN + " busiest lines of the subset that came " +
        "back, not of the book, and a busier line may sit in the part of the chain that was " +
        "never paged. Read them as " + shownN + " real prints, not as a top " + shownN + "."));
    } else {
      const seen = isNum(coverage.rowsSeen);
      const priced = isNum(coverage.pricedRows);
      host.append(el("p", "fc-note ftt-cover",
        "The vendor returned the whole chain it holds for this name" +
        (seen === null
          ? ". "
          : ": " + tcInt(seen) + " contract rows" +
            (priced === null ? "" : ", " + tcInt(priced) + " of them priced") + ". ") +
        (coverage.filter
          ? String(coverage.filter).replace(/^./, (c) => c.toUpperCase()) + "."
          : "")));
    }

    const basis = el("p", "fc-note ftt-basis");
    basis.append(document.createTextNode(
      (panel.relation ? String(panel.relation) + ". " : "") +
      "ΔOI is open_interest − prev_oi: the move between the two open-interest counts the " +
      "vendor published, whatever span separates them. A " + DASH + " there means the vendor " +
      "published no previous open interest, so the change is not computable — it does not mean " +
      "the open interest held still, which prints 0. " +
      "Bid and Ask are the quoted NBBO in two columns and there is no Mid: (bid + ask) ÷ 2 " +
      "is a basis choice, and on the far out-of-the-money lines that make this table interesting " +
      "it is routinely nowhere near where anything traded. Each strike carries its log-moneyness " +
      "ln(K/S) and the vendor's implied volatility in its title, and each expiry its distance in " +
      "calendar days from this session."));
    host.append(basis);

    if (panel.oiBasis) tcOiBasisNote(host, panel.oiBasis);
  }

  function tcOiBasisNote(host, basis) {
    const seen = isNum(basis.seen);
    const exceeded = isNum(basis.exceeded);
    const floor = isNum(basis.minVolume);
    const pop = floor === null
      ? "the contracts that carried all three numbers"
      : "the " + tcInt(seen === null ? 0 : seen) + " contract" + (seen === 1 ? "" : "s") +
        " here that traded at least " + tcInt(floor) + " lots and carried an open interest, " +
        "a previous open interest and a volume together";

    if (basis.verdict === "no-data" || seen === null || seen === 0) {
      const note = el("p", "fc-note ftt-oibasis is-untested",
        "No contract on this chain carried a volume, an open interest and a previous open " +
        "interest together, so whether those two counts describe the same span could not be " +
        "checked here. Read ΔOI as a move between two vendor snapshots of unstated spacing.");
      note.setAttribute("data-empty", "quiet");
      host.append(note);
      return;
    }

    if (exceeded === null) {
      const note = el("p", "fc-note ftt-oibasis is-untested",
        "The basis check ran on this chain but published no count of contracts that " +
        "exceeded their own volume, so its verdict cannot be shown with the number it " +
        "rests on. Read ΔOI as a move between two vendor snapshots of unstated spacing.");
      note.setAttribute("data-empty", "unavailable");
      host.append(note);
      return;
    }

    if (basis.verdict === "falsified" && exceeded > 0) {
      host.append(el("p", "fc-note ftt-oibasis is-falsified",
        "Measured on this chain: " + tcInt(exceeded) + " of " + pop + " moved their open " +
        "interest further than their own volume. That cannot happen across a single " +
        "settlement — no more contracts can be opened than were traded — so on this name the " +
        "two counts are NOT describing the same span. Do not read ΔOI against the volume " +
        "beside it as “what stuck of what churned”; they are two snapshots whose spacing the " +
        "vendor does not state."));
      return;
    }

    if (basis.verdict !== "inconclusive" || exceeded !== 0) {
      const note = el("p", "fc-note ftt-oibasis is-untested",
        "The basis check published a verdict its own count does not support, so no reading " +
        "of it is shown. Read ΔOI as a move between two vendor snapshots of unstated spacing.");
      note.setAttribute("data-empty", "unavailable");
      host.append(note);
      return;
    }

    host.append(el("p", "fc-note ftt-oibasis is-inconclusive",
      "Measured on this chain: none of " + pop + " moved their open interest further than " +
      "their own volume. This is the weaker of the two outcomes and is INCONCLUSIVE — it is " +
      "what an aligned pair looks like, and equally what an intraday-updated open interest or " +
      "a quiet session looks like. It is not evidence that ΔOI and the volume beside it " +
      "describe the same span."));
  }

  function faTextW(s, fontPx) {
    return String(s).length * window.FlowsPanels.AXIS_CH * (fontPx / 10);
  }

  function faGrouped(n) {
    const F = window.FlowsPanels;
    const v = F.isNum(n);
    if (v === null) return F.DASH;
    const a = String(Math.abs(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (v < 0 ? F.MINUS : "") + a;
  }

  function faK1(n) {
    const F = window.FlowsPanels;
    const v = F.isNum(n);
    if (v === null) return F.DASH;
    const a = Math.abs(v);
    if (a < 1000) return faGrouped(v);
    return (v < 0 ? F.MINUS : "") + (a / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }

  function faTickLabel(v) {
    const a = Math.abs(v);
    if (a < 10000) return faGrouped(a);
    return (a / 1000).toFixed(2).replace(/\.?0+$/, "") + "K";
  }

  function drawAggressor(host, panel, card, question, mount) {
    const F = window.FlowsPanels;
    const { el, svgEl, isNum, deadPanel, panelHead, statList, niceStep,
            DASH, MINUS, neg } = F;

    const q = question || "At which strikes were contracts taken at the offer?";

    if (panel === undefined || panel === null) {
      return deadPanel(host, q, "this card was built before the option chain leg shipped");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const rawBars = Array.isArray(panel.bars) ? panel.bars : [];
    const unreportedN = isNum(panel.unreported);
    if (!rawBars.length) {
      return deadPanel(host, q, panel.reason || (unreportedN !== null && unreportedN > 0
        ? `the vendor reported no aggressor split on any of the ${unreportedN} contracts that traded`
        : "no strike on this chain carried an aggressor split"));
    }

    panelHead(host, q);

    const bars = rawBars.filter((b) => b && isNum(b.k) !== null && isNum(b.net) !== null);
    if (!bars.length) return deadPanel(host, q, "no strike on this chain published a usable net");
    bars.sort((a, b) => a.k - b.k);

    const W = ftWidth(host);

    const ROW = bars.length > 34 ? 9 : 12;
    const padT = 16, padB = 30, labelW = 46, railW = 112;
    const plotL = labelW, plotR = W - railW;
    const plotW = Math.max(60, plotR - plotL);
    const H = padT + bars.length * ROW + padB;

    const nets = bars.map((b) => b.net);

    const fMin = Math.min(...nets, 0);
    const fMax = Math.max(...nets, 0);

    const share = Math.abs(fMin) / (Math.abs(fMin) + Math.abs(fMax) || 1);
    const x0 = plotL + plotW * Math.min(0.82, Math.max(0.18, share));
    const negW = x0 - plotL, posW = plotR - x0;

    const rate = Math.min(
      Math.abs(fMin) > 0 ? negW / Math.abs(fMin) : Infinity,
      fMax > 0 ? posW / fMax : Infinity,
    );
    const barRate = Number.isFinite(rate) ? rate : 0;
    const xOf = (v) => x0 + v * barRate;

    const yOfIndex = (i) => padT + (bars.length - 1 - i) * ROW + ROW / 2;

    const svg = svgEl("svg", {
      class: "fa-svg", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    const tag = String(mount || "grid").replace(/[^A-Za-z0-9_-]/g, "") || "grid";
    const patId = `faNeg-${tag}`;
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: patId, width: 4, height: 4, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "fa-negpat gp-negpat",
    });
    pat.append(svgEl("line", { x1: 2, y1: 0, x2: 2, y2: 4, stroke: "currentColor", "stroke-width": 1.8 }));
    defs.append(pat);
    svg.append(defs);

    const valueSpan = fMax - fMin;
    const targetTicks = Math.max(2, plotW / 64);
    let step = niceStep(valueSpan / targetTicks);

    const tickCount = () => (barRate > 0 && step > 0
      ? Math.floor(negW / (step * barRate)) + Math.floor(posW / (step * barRate))
      : 0);

    for (let guard = 0; guard < 24 && step > 0 &&
         (step * barRate < 40 || tickCount() > 12); guard++) {
      const next = niceStep(step * 2);
      if (!(next > step)) break;
      step = next;
    }

    const sides = [];
    if (fMax > 0) sides.push(1);
    if (fMin < 0) sides.push(-1);

    const ticks = [];
    if (step > 0 && barRate > 0) {
      for (const sgn of sides) {
        for (let m = 1; m <= 60; m++) {
          const v = m * step;
          let x = x0 + sgn * v * barRate;

          if (x < plotL - 3 || x > plotR + 3) break;
          x = Math.min(plotR - 2, Math.max(plotL + 2, x));
          if (Math.abs(x - x0) < 18) continue;
          if (ticks.some((t) => Math.abs(t.x - x) < 40)) continue;
          ticks.push({ x, v, sgn });
        }
      }
    }
    for (const t of ticks) {
      svg.append(svgEl("line", { class: "fa-tick", x1: t.x, x2: t.x, y1: padT - 2, y2: H - padB + 2 }));
      const lab = svgEl("text", { class: "fa-ticklabel", x: t.x, y: H - padB + 14, "text-anchor": "middle" });

      lab.textContent = (t.sgn < 0 ? MINUS : t.sgn > 0 ? "+" : "") + faTickLabel(t.v);
      svg.append(lab);
    }

    svg.append(svgEl("line", { class: "fa-zero", x1: x0, x2: x0, y1: padT - 4, y2: H - padB + 4 }));

    const railX = plotR + 6;
    const railBudget = railW - 6 - 2;
    const priceX = labelW - 6;
    const priceBudget = priceX - 2;

    let partialRows = 0, nullVolRows = 0, zeroNetRows = 0;

    bars.forEach((b, i) => {
      const y = yOfIndex(i);
      const barY = y - (ROW - 4) / 2;
      const barH = ROW - 4;
      const vol = isNum(b.vol);
      const calls = isNum(b.calls);
      const puts = isNum(b.puts);
      const missing = isNum(b.volMissing) === null ? 0 : b.volMissing;
      if (vol === null) nullVolRows++;
      if (missing > 0 && vol !== null) partialRows++;

      if (b.net === 0) {

        zeroNetRows++;
        const g = svgEl("g");
        const ttl = svgEl("title");
        ttl.textContent = vol === null
          ? `${neg(b.k.toFixed(2))}: the aggressor split at this strike nets to exactly zero. ` +
            "No contract at this strike reported a volume, so there is no split to show beside it."
          : `${neg(b.k.toFixed(2))}: the aggressor split at this strike nets to exactly zero — ` +
            `${faGrouped(vol)} contracts traded, ` +
            (calls === null || puts === null
              ? "the call and put halves of that total were not published."
              : `${faGrouped(calls)} on calls and ${faGrouped(puts)} on puts.`);
        g.append(ttl);
        g.append(svgEl("line", {
          class: "fa-zeromark", x1: x0 - 4, x2: x0 + 4, y1: y, y2: y,
        }));
        svg.append(g);
      } else {
        const xg = xOf(b.net);
        const isNeg = b.net < 0;
        const bx = Math.min(x0, xg);

        const bw = Math.max(Math.abs(xg - x0), 1.5);

        const g = svgEl("g");
        const ttl = svgEl("title");
        ttl.textContent =
          `${neg(b.k.toFixed(2))}: ${faGrouped(Math.abs(b.net))} contracts net taken at the offer on ` +
          `${isNeg ? "puts" : "calls"} (net ${faGrouped(b.net)}).`;
        g.append(ttl);
        g.append(svgEl("rect", {
          class: "fa-bar " + (isNeg ? "is-neg" : "is-pos"),
          x: bx, y: barY, width: bw, height: barH,
        }));

        if (isNeg) {
          g.append(svgEl("rect", {
            class: "fa-barhatch", x: bx, y: barY, width: bw, height: barH,
            fill: `url(#${patId})`,
          }));
        }
        svg.append(g);
      }

      if (ROW >= 11 || i % 2 === 0) {
        let priceText = null;
        for (const dp of [2, 1, 0]) {
          const s = neg(b.k.toFixed(dp));
          if (faTextW(s, 10.5) <= priceBudget) { priceText = s; break; }
        }
        if (priceText === null) priceText = neg(String(Math.round(b.k)));
        const pt = svgEl("text", {
          class: "fa-price", x: priceX, y: y + 3, "text-anchor": "end",
        });
        pt.textContent = priceText;
        svg.append(pt);
      }

      const railG = svgEl("g");
      const railTtl = svgEl("title");
      const partial = vol !== null && missing > 0;
      let railText;

      if (vol === null) {
        railText = DASH;
        railTtl.textContent = "no contract at this strike reported a volume";
      } else {
        const base = faGrouped(vol);

        let splitText = "";
        if (b.net === 0 && calls !== null && puts !== null) {
          const long = ` ${faGrouped(calls)}c/${faGrouped(puts)}p`;
          const short = ` ${faK1(calls)}c/${faK1(puts)}p`;
          if (faTextW(base + long, 9.5) <= railBudget) splitText = long;
          else if (faTextW(base + short, 9.5) <= railBudget) splitText = short;
        }

        railText = base + (partial ? "…" : "") + splitText;
        railTtl.textContent = partial
          ? `${faGrouped(vol)} contracts at this strike, counted over the lines that reported a ` +
            `volume; ${faGrouped(missing)} further ${missing === 1 ? "line" : "lines"} at this ` +
            "strike reported none, so this total is a floor, not the whole strike."
          : `${faGrouped(vol)} contracts traded at this strike` +
            (calls !== null && puts !== null
              ? ` — ${faGrouped(calls)} on calls, ${faGrouped(puts)} on puts.`
              : ".");
      }

      railG.append(railTtl);
      const rt = svgEl("text", {
        class: "fa-rail" + (partial ? " is-partial" : ""),
        x: railX, y: y + 3, "text-anchor": "start",
      });
      rt.textContent = railText;
      railG.append(rt);
      svg.append(railG);
    });

    const axisLong = "< puts taken at the offer \u00b7 net contracts \u00b7 calls taken >";
    const axisShort = "< puts \u00b7 net contracts \u00b7 calls >";
    const axisText = faTextW(axisLong, 10) <= W - 8 ? axisLong : axisShort;
    const axisHalf = faTextW(axisText, 10) / 2;
    const axisX = Math.min(W - 4 - axisHalf, Math.max(4 + axisHalf, x0));
    const axis = svgEl("text", { class: "fa-axis", x: axisX, y: H - 3, "text-anchor": "middle" });
    axis.textContent = axisText;
    svg.append(axis);

    const biggestUp = bars.reduce((a, b) => (b.net > a.net ? b : a), bars[0]);
    const biggestDn = bars.reduce((a, b) => (b.net < a.net ? b : a), bars[0]);
    svg.setAttribute("aria-label",
      `Net aggressor flow by strike for ${card && card.ticker ? card.ticker : "this name"}, ` +
      `in contracts. ${bars.length} strikes. ` +

      (fMax > 0
        ? `Most calls taken at the offer at ${neg(biggestUp.k.toFixed(2))}, ` +
          `${faGrouped(Math.abs(biggestUp.net))} contracts net. `
        : "No strike nets to the call side. ") +
      (fMin < 0
        ? `Most puts taken at the offer at ${neg(biggestDn.k.toFixed(2))}, ` +
          `${faGrouped(Math.abs(biggestDn.net))} contracts net. `
        : "No strike nets to the put side. ") +
      (partialRows
        ? `${partialRows} of ${bars.length} strikes publish an incomplete volume total.`
        : "Every strike drawn publishes a complete volume total."));

    if (window.FlowsCursor && bars.length) {
      window.FlowsCursor.attach(svg, {
        name: "Net aggressor volume by strike",
        axis: "y",
        band: { x0: plotL, x1: plotR },
        points: bars.map((b, i) => {

          const side = (v) => (isNum(v) === null ? "not split" : faGrouped(v));
          return {
            y: yOfIndex(i),
            label: neg(b.k.toFixed(2)),
            rows: [
              { k: "Net aggressor", v: faGrouped(b.net),
                cls: b.net > 0 ? "is-pos" : b.net < 0 ? "is-neg" : "" },
              { k: "Call / put volume", v: side(b.calls) + " / " + side(b.puts) },
              { k: "Volume at strike",
                v: isNum(b.vol) === null ? "not reported" : faGrouped(b.vol) },
            ],
          };
        }),
      });
    }

    host.append(svg);

    const shown = isNum(panel.shown);
    const measured = isNum(panel.measuredStrikes);
    const total = isNum(panel.total);
    const unread = isNum(panel.strikesUnreported);

    const drawn = bars.length;
    const dropped = rawBars.length - drawn;
    if (dropped > 0) {
      host.append(el("p", "fc-note",
        `${faGrouped(dropped)} of the ${faGrouped(rawBars.length)} strikes on this payload ` +
        "published no usable strike price or no usable net and are not drawn. They are absences, " +
        "not zeroes, so they are left off the ladder rather than laid on the zero rule."));
    }

    const cut = (unread !== null && unread > 0) ||
                (shown !== null && measured !== null && shown < measured);
    if (cut) {
      const denom = total !== null ? total : measured;
      host.append(el("p", "fc-note",
        (denom !== null
          ? `${faGrouped(drawn)} of ${faGrouped(denom)} strikes on this chain shown, nearest the money. `
          : "Not every strike on this chain is shown; the ladder is kept nearest the money. ") +
        "That is where hedging happens and where the gamma ladder beside it is measured, " +
        "but it means the wings of this book are cut off rather than empty." +
        (unread !== null && unread > 0
          ? ` A further ${faGrouped(unread)} ${unread === 1 ? "strike" : "strikes"} on the chain ` +
            "carried no aggressor split at all and could not be laddered."
          : "")));
    }

    const cov = panel.coverage || {};
    if (cov.truncated === true) {
      const seen = isNum(cov.rowsSeen);
      host.append(el("p", "fc-note",
        "The vendor returned a full page of 500 contracts in no documented order" +
        (seen !== null ? ` (${faGrouped(seen)} rows seen)` : "") +
        ". This is an arbitrary subset of the book, so this ladder is a ladder over that " +
        "subset: a strike missing from it may be a strike with no flow, or a strike the page " +
        "cut off. The two cannot be told apart from here."));
    }

    if (partialRows) {
      host.append(el("p", "fc-note",
        `${faGrouped(partialRows)} of the ${faGrouped(bars.length)} strikes drawn publish a volume ` +
        "total that is INCOMPLETE: at least one contract at that strike traded without reporting a " +
        "volume, so the figure in the rail counts only the lines that did and is a floor. Those " +
        "rails end in an ellipsis. The bar itself is unaffected — the aggressor split and the " +
        "volume are separate vendor fields, and a line can report one without the other."));
    }

    if (nullVolRows) {
      host.append(el("p", "fc-note",
        `${faGrouped(nullVolRows)} ${nullVolRows === 1 ? "strike carries" : "strikes carry"} an ` +
        "aggressor split but no reported volume at all. " +
        `${nullVolRows === 1 ? "Its rail reads" : "Their rails read"} ` +
        "—, not zero: the bar beside it is a measurement and the volume is an absence, and " +
        "the two must not be printed in the same ink."));
    }

    const method = [];
    method.push(
      "This axis is LINEAR in contracts, unlike the gamma ladder above it: a bar twice as long " +
      "is twice the net flow, and the two halves share one scale, so the left and right sides are " +
      "directly comparable and neither is normalised against its own extreme. " +
      "The zero rule is placed by the data — at " +
      `${(Math.min(0.82, Math.max(0.18, share)) * 100).toFixed(0)}% of the plot, from ` +
      "|min| / (|min| + |max|), clamped to a chosen [18%, 82%] so a one-sided book still shows " +
      "its minority side — and it is DRAWN, because which side of it a bar sits on is how the " +
      "sign is read here. Colour repeats that and carries nothing on its own." +
      (zeroNetRows
        ? ` ${faGrouped(zeroNetRows)} ${zeroNetRows === 1 ? "strike nets" : "strikes net"} to ` +
          "exactly zero and " + (zeroNetRows === 1 ? "is" : "are") + " marked with a tick on the " +
          "rule, with the call and put halves of the volume beside " +
          (zeroNetRows === 1 ? "it" : "them") + ": a strike where a put and a call were each " +
          "lifted sixty-forty is not a strike where nothing happened."
        : ""));

    if (typeof panel.relation === "string" && panel.relation) method.push(panel.relation);
    appendNotes(host, method, "How to read this ladder");

    const rep = isNum(panel.reported);
    host.append(statList([
      ["contracts with a split", rep === null ? DASH : faGrouped(rep)],
      ["traded, no split published", unreportedN === null ? DASH : faGrouped(unreportedN)],
      ["strikes drawn", total === null
        ? faGrouped(drawn)
        : `${faGrouped(drawn)} of ${faGrouped(total)}`],
    ]));
  }

  const PREDATES_CHAIN =
    "this card was built before the option chain leg shipped, so this " +
    "panel was never in it.";
  const PREDATES_STOCK =
    "this card was built before the per-name deep feeds shipped, so this " +
    "panel was never in it.";

  const PREDATES_CROSS =
    "this card was built before the market-wide join shipped, so this panel " +
    "was never in it.";
  const STOCK_KEYS = new Set(["darkpool", "oiDeltas", "volContext"]);
  const CROSS_KEYS = new Set(["marketRank"]);
  const predatesSentence = (key) => (CROSS_KEYS.has(key)
    ? PREDATES_CROSS
    : STOCK_KEYS.has(key) ? PREDATES_STOCK : PREDATES_CHAIN);

  function ftQuiet(host, question, sentence) {
    const { el, panelHead } = window.FlowsPanels;
    panelHead(host, question);
    const p = el("p", "ft-quiet", sentence);
    p.setAttribute("data-empty", "quiet");
    host.append(p);
  }

  function fdpTime(at) {
    const m = /T(\d{2}):(\d{2})/.exec(String(at == null ? "" : at));
    return m ? m[1] + ":" + m[2] : window.FlowsPanels.DASH;
  }

  function drawDarkpool(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, px2, money, DASH } = window.FlowsPanels;

    const q = question || "Which off-exchange prints carried the size in this name?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_STOCK);
    if (panel.status === "quiet") {
      return ftQuiet(host, q,
        "The feed answered with nothing: no off-exchange print in this name " +
        "reached it with a dollar size to rank.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    if (!rows.length) {
      return ftQuiet(host, q,
        "The feed answered with nothing: no off-exchange print in this name " +
        "reached it with a dollar size to rank.");
    }

    panelHead(host, q);

    const table = el("table", "fc-levels fdp-table");
    const thead = el("thead");
    const hr = el("tr");
    const HEADS = [
      ["Time", "fdp-h-time", "The tape's own execution timestamp, UTC, to the minute."],
      ["Price", "c-num", "The reported execution price."],
      ["Size", "c-num", "Shares in the print, the tape's own count."],
      ["Dollars", "c-num",
        "The print's dollar size, the vendor's own premium field — the column these rows are ranked by."],
      ["Bid / Ask", "c-num",
        "The national best bid and offer beside the print, when the tape carried both."],
    ];
    for (const [label, cls, title] of HEADS) {
      const th = el("th", cls, label);
      th.scope = "col";
      th.title = title;
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr", "fdp-row" + (r.canceled === true ? " is-canceled" : ""));

      const timeTd = tcCell(fdpTime(r.at), "fdp-time",
        "The tape's own execution timestamp, UTC. The tape reports these prints with delay.");
      if (r.canceled === true) {
        const tag = el("span", "fdp-tag", "cancelled");
        tag.title = "The tape carries a cancel flag on this print.";
        timeTd.append(tag);
      }
      tr.append(timeTd);

      tr.append(tcCell(px2(r.px), "c-num fdp-px",
        isNum(r.px) === null ? "The tape carried no price on this row." : "The reported execution price."));
      tr.append(tcCell(tcInt(r.size), "c-num fdp-size",
        isNum(r.size) === null ? "The tape carried no share count on this row." : "Shares in the print."));
      tr.append(tcCell(money(r.prem), "c-num fdp-prem",
        "The print's dollar size, the vendor's own premium field. Size moved here; " +
        "which way anyone was positioned is not on the tape."));

      const bid = isNum(r.bid), ask = isNum(r.ask);
      tr.append(tcCell(
        bid !== null && ask !== null ? px2(bid) + " / " + px2(ask) : DASH,
        "c-num fdp-quote",
        bid !== null && ask !== null
          ? "The national best bid and offer around the print, as the tape reported them. " +
            "Context only: the tape attributes no side, so where the print sat in this " +
            "quote is not a reading of who initiated."
          : "The tape carried no usable bid and ask beside this print — not a quote of zero."));
      tbody.append(tr);
    }
    table.append(tbody);

    const wrap = el("div", "fc-tablewrap fdp-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Off-exchange prints");
    wrap.append(table);
    host.append(wrap);

    const seen = isNum(panel.seen);
    const shed = isNum(panel.shed);
    const unpriced = isNum(panel.unpriced);
    const bits = [];
    if (shed !== null && shed > 0 && seen !== null) bits.push(rows.length + " kept of " + seen);
    if (unpriced !== null && unpriced > 0) {
      bits.push("+" + unpriced + " unpriced print" + (unpriced === 1 ? "" : "s") + " counted out");
    }
    if (bits.length) host.append(el("p", "fc-note fdp-count", bits.join(" · ") + "."));
    appendNotes(host, [panel.note], "About these prints");
  }

  function foiContract(r) {
    const { isNum, DASH } = window.FlowsPanels;
    const cp = r.cp === "C" || r.cp === "P" ? r.cp : null;
    const k = isNum(r.k);
    const exp = typeof r.exp === "string" && r.exp ? r.exp : null;
    if (cp === null && k === null && exp === null) return DASH;
    return (cp || DASH) + " " + (k === null ? DASH : String(k)) + " · " +
      (exp ? exp.slice(5) : DASH);
  }

  function foiStreakSpan(v, label, title) {
    const { el, isNum, DASH } = window.FlowsPanels;
    const n = isNum(v);
    const span = el("span", "foi-streak" + (n === null ? " is-unknown" : ""),
      n === null ? DASH : n + "d " + label);
    span.title = n === null
      ? "The vendor published no counter for this line — not a streak of zero."
      : title;
    return span;
  }

  function drawOiDeltas(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, DASH } = window.FlowsPanels;

    const q = question || "Where did open interest move between clearing snapshots?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_STOCK);
    if (panel.status === "quiet") {
      return ftQuiet(host, q,
        "The feed answered with nothing: the vendor surfaced no contract-level " +
        "open-interest change in this name.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    if (!rows.length) {
      return ftQuiet(host, q,
        "The feed answered with nothing: the vendor surfaced no contract-level " +
        "open-interest change in this name.");
    }

    panelHead(host, q);

    const table = el("table", "fc-levels foi-table");
    const thead = el("thead");
    const hr = el("tr");

    const thChg = el("th", "c-num");
    thChg.scope = "col";
    thChg.title = "curr_oi minus the previous clearing snapshot's, the vendor's own difference. " +
      "A settled fact a day late by construction — never today's tape.";
    thChg.append(el("span", "ftt-greek", "Δ"));
    thChg.append(document.createTextNode("OI"));
    const heads = [
      [el("th", "foi-h-oc", "Contract"),
        "Call or put, strike and expiry, from the vendor's option symbol."],
      [thChg, null],
      [el("th", "c-num", "Growth"),
        "The same move as a share of the previous snapshot — the vendor's oi_change, " +
        "which is (curr_oi \u2212 last_oi) / last_oi and NOT a number of contracts. " +
        "This column and \u0394OI are two readings of one move, not two moves."],
      [el("th", "c-num", "Curr OI"), "Open interest at the newer of the two clearing snapshots."],
      [el("th", "c-num", "Vol"), "The vendor's contract volume beside the change."],
      [el("th", "foi-h-streaks", "Streaks"),
        "The vendor's own consecutive-session counters. Their rules are the vendor's and are not published."],
    ];
    for (const [th, title] of heads) {
      th.scope = "col";
      if (title) th.title = title;
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr", "foi-row");

      const exp = typeof r.exp === "string" && r.exp ? r.exp : null;
      tr.append(tcCell(foiContract(r), "foi-oc",
        (exp ? "Expiry " + exp + ". " : "") +
        (typeof r.oc === "string" && r.oc ? "Vendor symbol " + r.oc + "." : "")));

      const chg = isNum(r.diff);
      const growth = isNum(r.ratio);
      const prevOi = isNum(r.prevOi);
      const currOi = isNum(r.currOi);
      tr.append(tcCell(tcSignedInt(chg),
        "c-num foi-chg " + (chg === null ? "is-unknown" : chg > 0 ? "is-up" : chg < 0 ? "is-down" : "is-flat"),
        chg === null
          ? "The vendor published no contract difference for this line."
          : "Between the vendor's two clearing snapshots" +
            (prevOi !== null && currOi !== null
              ? ": " + tcInt(prevOi) + " to " + tcInt(currOi) : "") +
            ". A day late by construction, so it says what stuck — never today's tape."));
      tr.append(tcCell(tcSignedPct(growth),
        "c-num foi-growth " + (growth === null ? "is-unknown" : growth > 0 ? "is-up" : growth < 0 ? "is-down" : "is-flat"),
        growth === null
          ? "The vendor published no open-interest ratio for this line."
          : "The same move as a share of the previous snapshot. Not a contract count."));

      tr.append(tcCell(tcInt(r.currOi), "c-num foi-oi",
        currOi === null
          ? "The vendor published no current open interest for this line."
          : "Contracts outstanding at the newer clearing snapshot."));

      const vol = isNum(r.vol);
      const avgPx = isNum(r.avgPx);
      tr.append(tcCell(tcInt(r.vol), "c-num foi-vol",
        vol === null
          ? "The vendor published no volume for this line."
          : "The vendor's contract volume on this line" +
            (avgPx === null ? "" : ", at an average price of " + avgPx.toFixed(2)) + "."));

      const streaks = tcCell("", "foi-streaks", null);
      const up = isNum(r.oiUpDays);
      const vg = isNum(r.volGtOiDays);
      if (up === null && vg === null) {
        streaks.textContent = DASH;
        streaks.title = "The vendor published neither counter for this line — not streaks of zero.";
      } else {
        streaks.append(foiStreakSpan(r.oiUpDays, "↑OI",
          "The vendor's own counter: consecutive sessions of open-interest increases on this line."));
        streaks.append(document.createTextNode(" · "));
        streaks.append(foiStreakSpan(r.volGtOiDays, "V>OI",
          "The vendor's own counter: consecutive sessions with volume above open interest on this line."));
      }
      tr.append(streaks);
      tbody.append(tr);
    }
    table.append(tbody);

    const wrap = el("div", "fc-tablewrap foi-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Contract-level open-interest changes");
    wrap.append(table);
    host.append(wrap);

    const seen = isNum(panel.seen);
    const shed = isNum(panel.shed);
    if (shed !== null && shed > 0 && seen !== null) {
      host.append(el("p", "fc-note foi-count", rows.length + " kept of " + seen + "."));
    }
    appendNotes(host, [panel.note], "About this feed");
  }

  function fvcPct(v) {
    const { isNum, DASH } = window.FlowsPanels;
    const n = isNum(v);
    return n === null ? DASH : (n * 100).toFixed(0) + "%";
  }

  function fvcHalfSilence(halfHost, half, quietSentence) {
    const { el } = window.FlowsPanels;
    const quiet = half && half.status === "quiet";
    const p = el("p", "ft-quiet", quiet
      ? quietSentence
      : "This half's feed could not be read this run" +
        (half && half.reason ? ": " + String(half.reason).replace(/\.+$/, "") : "") + ".");
    p.setAttribute("data-empty", quiet ? "quiet" : "unavailable");
    halfHost.append(p);
  }

  function drawVolContext(host, panel, card, question, mount) {
    const { el, svgEl, isNum, deadPanel, panelHead, vol1, neg, DASH } = window.FlowsPanels;

    const q = question ||
      "What does the chain charge across tenors, and where does implied volatility sit in its own year?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_STOCK);
    if (panel.status === "quiet") {
      return ftQuiet(host, q,
        "Both volatility feeds answered with nothing for this name — no listed " +
        "term structure and no rank history.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    panelHead(host, q);

    const term = panel.term || null;
    const ivRank = panel.ivRank || null;
    const W = ftWidth(host);

    const termHost = el("div", "fvc-half fvc-termhalf");
    termHost.append(el("h4", "fvc-h", "Term structure"));

    const termRows = term && term.status === "ok" && Array.isArray(term.rows) ? term.rows : [];

    const pts = [];
    termRows.forEach((r, i) => {
      const y = isNum(r && r.vol);
      if (y === null) return;
      const dte = isNum(r && r.dte);
      pts.push({ x: dte === null ? i : dte, y, dte, r });
    });
    pts.sort((a, b) => a.x - b.x);

    if (!termRows.length) {
      fvcHalfSilence(termHost, term,
        "The vendor answered the term-structure read with nothing for this name.");
    } else if (!pts.length) {
      fvcHalfSilence(termHost, { status: "quiet" },
        "The vendor answered the term-structure read with nothing this curve can place.");
    } else {
      let rawLo = Infinity, rawHi = -Infinity, xLo = Infinity, xHi = -Infinity;
      for (const p of pts) {
        if (p.y < rawLo) rawLo = p.y;
        if (p.y > rawHi) rawHi = p.y;
        if (p.x < xLo) xLo = p.x;
        if (p.x > xHi) xHi = p.x;
      }

      const lo = rawHi - rawLo < 1e-9 ? rawLo - 0.01 : rawLo;
      const hi = rawHi - rawLo < 1e-9 ? rawHi + 0.01 : rawHi;
      if (xHi - xLo < 1e-9) xHi = xLo + 1;

      const H = 120, padL = 34, padR = 10, padT = 10, padB = 12;
      const xOf = (x) => padL + ((x - xLo) / (xHi - xLo)) * (W - padL - padR);
      const yOf = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

      const front = pts[0], back = pts[pts.length - 1];
      const svg = svgEl("svg", {
        class: "fvc-svg", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
        role: "img", preserveAspectRatio: "xMidYMid meet",
        "aria-label": "Implied-volatility term structure" +
          (card && card.ticker ? " for " + card.ticker : "") + ": " +
          pts.length + " listed expiries, from " + vol1(front.y) +
          (front.dte === null ? "" : " at " + front.dte + " days") + " out to " + vol1(back.y) +
          (back.dte === null ? "" : " at " + back.dte + " days") +
          ". Lowest " + vol1(rawLo) + ", highest " + vol1(rawHi) +
          ". Derived from quotes; none of it is a forecast.",
      });

      svg.append(svgEl("line", {
        class: "fvc-frame", x1: padL, x2: padL, y1: padT, y2: H - padB,
      }));
      svg.append(svgEl("polyline", {
        class: "fvc-line",
        points: pts.map((p) => xOf(p.x).toFixed(1) + "," + yOf(p.y).toFixed(1)).join(" "),
      }));
      for (const p of pts) {
        const g = svgEl("g", { class: "fvc-dotg" });
        const t = svgEl("title");
        const imp = isNum(p.r.impliedMovePerc);
        t.textContent = String(p.r.expiry) +
          (p.dte === null ? "" : ", " + p.dte + " days") +
          " · " + vol1(p.y) + " implied" +
          (imp === null ? "" : " · implied move " + vol1(imp) + " of spot") + ".";
        g.append(t);
        g.append(svgEl("circle", {
          class: "fvc-dot", cx: xOf(p.x).toFixed(1), cy: yOf(p.y).toFixed(1), r: 2,
        }));
        svg.append(g);
      }

      const rail = [[rawHi, yOf(rawHi)]];
      if (rawHi - rawLo >= 1e-9) rail.push([rawLo, yOf(rawLo)]);
      for (const [v, y] of rail) {
        const t = svgEl("text", {
          class: "fvc-axis", x: padL - 5, y: (y + 3.5).toFixed(1), "text-anchor": "end",
        });
        t.textContent = fvcPct(v);
        svg.append(t);
      }

      if (window.FlowsCursor && pts.length) {
        window.FlowsCursor.attach(svg, {
          name: "Implied volatility along the term",
          band: { y0: padT, y1: H - padB },
          points: pts.map((p) => {
            const imp = isNum(p.r.impliedMovePerc);
            return {
              x: xOf(p.x),
              label: String(p.r.expiry) +
                (p.dte === null ? "" : " \u00b7 " + p.dte + "d out"),
              rows: [
                { k: "Implied vol", v: vol1(p.y) },
                { k: "Implied move", v: imp === null ? "not reported" : vol1(imp) + " of spot" },
              ],
            };
          }),
        });
      }

      termHost.append(svg);

      const mt = el("table", "fc-levels fvc-mini");
      const mh = el("thead");
      const mhr = el("tr");
      for (const [label, cls, title] of [
        ["Expiry", "fvc-mh-exp", "The listed expiry, as published."],
        ["IV", "c-num", "That expiry's own implied volatility."],
        ["Implied move", "c-num",
          "The vendor's implied move as a share of spot — what the chain charges, not what will happen."],
      ]) {
        const th = el("th", cls, label);
        th.scope = "col";
        th.title = title;
        mhr.append(th);
      }
      mh.append(mhr);
      mt.append(mh);
      const mb = el("tbody");
      for (const r of termRows.slice(0, 4)) {
        const tr = el("tr");
        tr.append(tcCell(typeof r.expiry === "string" && r.expiry ? r.expiry : DASH, "fvc-exp", null));
        tr.append(tcCell(vol1(r.vol), "c-num", null));
        tr.append(tcCell(isNum(r.impliedMovePerc) === null ? DASH : vol1(r.impliedMovePerc),
          "c-num",
          isNum(r.impliedMovePerc) === null
            ? "The vendor published no implied move for this expiry — not a move of zero."
            : null));
        mb.append(tr);
      }
      mt.append(mb);
      const mwrap = el("div", "fc-tablewrap fvc-miniwrap");
      mwrap.append(mt);
      termHost.append(mwrap);

      const termBits = [];
      if (termRows.length > 4) {
        termBits.push("first 4 of " + termRows.length + " listed expiries — the curve draws all " +
          termRows.length);
      }
      const tSeen = isNum(term.seen), tShed = isNum(term.shed);
      if (tShed !== null && tShed > 0 && tSeen !== null) {
        termBits.push(termRows.length + " kept of " + tSeen);
      }
      if (termBits.length) {
        const cap = termBits.join(" · ");
        termHost.append(el("p", "fc-note fvc-count",
          cap.charAt(0).toUpperCase() + cap.slice(1) + "."));
      }
    }
    host.append(termHost);

    const rankHost = el("div", "fvc-half fvc-rankhalf");
    rankHost.append(el("h4", "fvc-h", "IV rank"));

    const rankRows = ivRank && ivRank.status === "ok" && Array.isArray(ivRank.rows) ? ivRank.rows : [];
    if (!rankRows.length) {
      fvcHalfSilence(rankHost, ivRank,
        "The vendor answered the rank-history read with nothing for this name.");
    } else {

      const latest = rankRows[0];
      const rank = isNum(latest && latest.rank1y);
      const headline = el("p", "fvc-rank");
      if (rank === null) {
        const n = el("span", "fvc-rank-n is-missing", DASH);
        n.title = "No rank published for the latest session — not a rank of zero.";
        headline.append(n);
        headline.append(el("span", "fvc-rank-u", " no rank published"));
      } else {
        const n = el("span", "fvc-rank-n", neg(rank.toFixed(1)));
        n.title = "Where the latest session's implied volatility ranks against this name's own " +
          "past year, in the payload's unit: " + (ivRank.rankUnit || "as published") + ".";
        headline.append(n);
        headline.append(el("span", "fvc-rank-u", " / 100"));
      }
      if (latest && typeof latest.date === "string" && latest.date) {
        headline.append(el("span", "fvc-rank-d", " · " + latest.date));
      }
      rankHost.append(headline);

      const series = rankRows.slice().reverse().map((r) => isNum(r && r.rank1y));
      const n = series.length;
      const gaps = series.filter((v) => v === null).length;
      if (n >= 2 && gaps < n) {
        const SW = Math.max(120, Math.min(220, W - 120)), SH = 40, sPadX = 3, sPadY = 4;
        const xO = (i) => sPadX + (i / (n - 1)) * (SW - sPadX * 2);

        const yO = (v) => sPadY + (1 - v / 100) * (SH - sPadY * 2);
        const svg = svgEl("svg", {
          class: "fvc-spark", viewBox: `0 0 ${SW} ${SH}`, width: SW, height: SH,
          role: "img", preserveAspectRatio: "xMidYMid meet",
          "aria-label": "One-year implied-volatility rank by session, oldest on the left, on the " +
            "rank's own 0 to 100 scale: " + n + " sessions" +
            (gaps > 0 ? ", " + gaps + " of them with no published rank, drawn as gaps in the line" : "") +
            (rank === null
              ? ". The latest session publishes no rank."
              : ". Latest " + neg(rank.toFixed(1)) + "."),
        });
        svg.append(svgEl("line", { class: "fvc-frame", x1: sPadX, x2: SW - sPadX, y1: yO(0), y2: yO(0) }));
        for (let i = 0; i + 1 < n; i++) {
          if (series[i] === null || series[i + 1] === null) continue;
          svg.append(svgEl("line", {
            class: "fvc-spark-l",
            x1: xO(i).toFixed(1), y1: yO(series[i]).toFixed(1),
            x2: xO(i + 1).toFixed(1), y2: yO(series[i + 1]).toFixed(1),
          }));
        }
        series.forEach((v, i) => {
          if (v === null) return;

          const lone = (i === 0 || series[i - 1] === null) && (i === n - 1 || series[i + 1] === null);
          if (!lone && i !== n - 1) return;
          svg.append(svgEl("circle", {
            class: "fvc-spark-d" + (i === n - 1 ? " is-now" : ""),
            cx: xO(i).toFixed(1), cy: yO(v).toFixed(1), r: i === n - 1 ? 2 : 1.5,
          }));
        });

        const dated = rankRows.slice().reverse();
        window.FlowsCursor && window.FlowsCursor.attach(svg, {
          name: "One-year implied-volatility rank by session",
          band: { y0: sPadY, y1: SH - sPadY },
          points: series.map((v, i) => ({
            x: xO(i),
            label: (dated[i] && dated[i].date) || "an unnamed session",
            rows: [
              { k: "IV rank", v: v === null ? "not published" : neg(v.toFixed(1)) },
            ],
          })),
        });

        rankHost.append(svg);
      }

      const rBits = [];
      const rSeen = isNum(ivRank.seen), rShed = isNum(ivRank.shed);
      if (rShed !== null && rShed > 0 && rSeen !== null) {
        rBits.push(rankRows.length + " kept of " + rSeen);
      }
      if (gaps > 0) {
        rBits.push(gaps + " session" + (gaps === 1 ? "" : "s") + " with no published rank — gaps " +
          "in the strip, never zeros");
      }
      if (rBits.length) {
        const cap = rBits.join(" · ");
        rankHost.append(el("p", "fc-note fvc-count",
          cap.charAt(0).toUpperCase() + cap.slice(1) + "."));
      }
    }
    host.append(rankHost);

    appendNotes(host, [panel.note], "About this panel");
  }

  const FMR_FEEDS = [
    ["oiChange", "Open-interest change",
      "The vendor's market-wide ranking of option contracts by open-interest change. " +
      "It compares two clearing snapshots, so it is a settled fact a day late by " +
      "construction and never today's tape."],
    ["darkpool", "Off-exchange prints",
      "The market-wide feed of the most recent off-exchange equity prints. These are " +
      "executions, reported with delay, attributing no side and no participant."],
  ];

  function fmrSilence(host, kind, sentence) {
    const { el } = window.FlowsPanels;
    const p = el("p", kind === "quiet" ? "ft-quiet fmr-empty" : "fc-dead fmr-empty");
    p.setAttribute("data-empty", kind);
    p.append(el("strong", null, kind === "quiet" ? "Not in this feed \u2014 " : "Unavailable \u2014 "));
    p.append(document.createTextNode(String(sentence).trim().replace(/\.+$/, "") + "."));
    host.append(p);
  }

  function fmrUnit(n, f, long) {
    if (!f.unit) return "";
    const one = Math.abs(n) === 1;
    return " " + (one ? (f.unitOne || f.unit) : f.unit) +
      (long && f.unitOf ? " " + f.unitOf : "");
  }

  function fmrValue(v, f, long) {
    const { isNum, money, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) return null;
    if (f.kind === "money") return money(n);
    if (f.kind === "count") return tcSignedInt(n) + fmrUnit(n, f, long);
    if (f.kind === "ratio") {
      const p = n * 100;
      const body = Math.abs(p).toFixed(1);

      return (p < 0 ? MINUS : p > 0 ? "+" : "") + body + fmrUnit(p, f, long);
    }
    return null;
  }

  function fmrStamp(at) {
    const s = String(at == null ? "" : at);
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s);
    return m ? m[1] + " " + m[2] + ":" + m[3] + " UTC" : null;
  }

  function fmrSessionLine(f, cardDate) {
    const { el } = window.FlowsPanels;
    let text;
    if (!f.asOfStated || !f.asOf) {
      text = "This feed states no session of its own, so which session the ranking is " +
        "from is unknown — it is not assumed to be this card's.";
    } else if (f.sameSession === true) {
      text = "The feed dates itself " + f.asOf + ", the same session this card describes.";
    } else if (f.sameSession === false) {
      text = "The feed dates itself " + f.asOf + ", which is NOT the session this card " +
        "describes" + (cardDate ? " (" + cardDate + ")" : "") + ". This ranking is from " +
        "another session and the per-name readings on this page are not.";
    } else {
      text = "The feed dates itself " + f.asOf + "; this card names no session to compare " +
        "it against.";
    }
    if (f.asOfSessions > 1) {
      text += " Its rows span " + f.asOfSessions + " sessions, so the date above is the " +
        "newest of them rather than the whole feed's.";
    }
    const p = el("p", "fc-note fmr-when", text);
    p.title = "This pipeline runs at 05:15 Eastern and the vendor states its market-wide " +
      "open-interest feed updates at about 06:45 Eastern, so a market-wide ranking read " +
      "here is usually the previous session's.";
    return p;
  }

  function fmrCutLine(f) {
    const { el } = window.FlowsPanels;
    if (!f.ordered) {
      return el("p", "fc-note fmr-cut",
        "The rows came back in no order this run could measure, so there is no cut-off " +
        "value to compare against: position in this feed is the vendor's arrangement, " +
        "not a threshold.");
    }
    if (f.cutAt) {
      const stamp = fmrStamp(f.cutAt);
      return el("p", "fc-note fmr-cut",
        "Ordered by " + f.orderedBy + ". The window reaches back to " +
        (stamp || "an unreadable stamp") + " — a name whose last off-exchange print is " +
        "older than that cannot be in this list at any size.");
    }
    const cut = fmrValue(f.cut, f, true);
    if (cut === null) {
      return el("p", "fc-note fmr-cut",
        "Ordered by " + f.orderedBy + ", but the value at the last place could not be " +
        "put in a unit this run could name, so it is not printed as a threshold.");
    }
    return el("p", "fc-note fmr-cut",
      "Ordered by " + f.orderedBy + ". The last place in the feed held " + cut +
      (f.capped
        ? ", so that is the cut this name is measured against."
        : ", and the feed returned fewer rows than this run asked for — nothing was cut " +
          "off by our own limit."));
  }

  function fmrCoverageLine(c) {
    const { el } = window.FlowsPanels;
    if (!c || typeof c.of !== "number" || typeof c.in !== "number" || !c.of) return null;
    const p = el("p", "fc-note fmr-cover",
      c.in + " of " + c.of + " name" + (c.of === 1 ? "" : "s") + " carrying a card today " +
      "appear" + (c.in === 1 ? "s" : "") + " in this feed" +
      (c.in * 5 < c.of
        ? ". At that reach most cards will say they are not in it, which is one thin join " +
          "rather than a finding about any one name."
        : "."));
    p.title = "Measured across the names this run built a card for, not across the whole " +
      "board and not across the market.";
    return p;
  }

  function drawMarketRank(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, statList, DASH } = window.FlowsPanels;

    const q = question || "Does this name place in the market’s own two lists, and from which session?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_CROSS);
    if (panel.status === "quiet") return ftQuiet(host, q, panel.reason || "");
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    panelHead(host, q);

    const feeds = panel.feeds || {};
    for (const [key, heading, blurb] of FMR_FEEDS) {
      const f = feeds[key];
      const block = el("section", "fmr-block");
      const h = el("h4", "fmr-h", heading);
      h.title = blurb;
      block.append(h);

      if (!f || f.status === "unavailable") {
        fmrSilence(block, "unavailable",
          (f && f.reason) || "this feed was not carried into the card build this run.");
        host.append(block);
        continue;
      }

      let said = null;
      if (f.status === "ok") {
        const fmrTitles = [];
        const value = fmrValue(f.value, f);
        const rank = isNum(f.rank);
        const pop = isNum(f.population);
        const count = isNum(f.count);

        const pairs = [
          ["Rank",
            rank === null || pop === null ? DASH : tcInt(rank) + " of " + tcInt(pop),
            "fmr-rank"],

          ["Value", value === null ? DASH : value,
            f.kind === "count"
              ? "fmr-val " + (isNum(f.value) === null ? "is-unknown"
                : f.value > 0 ? "is-up" : f.value < 0 ? "is-down" : "is-flat")
              : "fmr-val"],
        ];
        if (count !== null && count > 1) {

          const rows = Array.isArray(f.rows) ? f.rows : [];
          const shown = isNum(f.shown);
          const cell = ["Rows", tcInt(count) + (key === "oiChange" ? " contracts" : " prints"),
            "fmr-rows"];
          pairs.push(cell);
          fmrTitles.push([cell, rows.length
            ? "At position" + (rows.length === 1 ? " " : "s ") + rows.join(", ") +
              (shown !== null && shown < count
                ? " (the first " + shown + " of " + count + "; the rest are not listed)"
                : "") + " in the feed."
            : "The feed carried no positions for this name."]);
        }

        leadReading(block,
          (rank === null || pop === null
            ? "This name is in this market-wide list"
            : "This name ranks " + tcInt(rank) + " of " + tcInt(pop) +
              " in this market-wide list") +
          (value === null
            ? ", and the value it is ranked on could not be put in a unit this run " +
              "could name."
            : ", at " + fmrValue(f.value, f, true) + ".") +
          (count !== null && count > 1
            ? " " + tcInt(count) + " " + (key === "oiChange" ? "contracts" : "prints") +
              " of this name are in it."
            : ""));

        if (f.at) pairs.push(["Printed", fmrStamp(f.at) || DASH, "fmr-at"]);
        const dl = statList(pairs);

        for (const [pair, title] of fmrTitles) {
          const at = pairs.indexOf(pair);
          const wrap = at >= 0 ? dl.children[at] : null;
          if (wrap) wrap.title = title;
        }
        block.append(dl);

        if (value === null && isNum(f.value) !== null) {
          block.append(el("p", "fc-note fmr-nounit",
            "This run could not reconcile the vendor's own change field against the two " +
            "clearing snapshots it publishes beside it, so the value is not printed: a " +
            "number whose unit is unknown reads as contracts and might be a ratio."));
        }

        said = el("p", "fc-note fmr-said",
          "This ranking comes from a market-wide list this run reads once for the whole " +
          "board. That is a cross-section the per-name feeds on this page cannot report, " +
          "because a request for one name carries no other names in it.");
      } else {

        fmrSilence(block, "quiet", f.reason || "this name is not in this feed this run.");
      }

      const quiet = !(f.status === "ok");
      const cut = fmrCutLine(f);
      const when = fmrSessionLine(f, card && card.sessionDate);
      const cov = fmrCoverageLine((panel.coverage || {})[key]);
      const covData = (panel.coverage || {})[key];

      const covThin = !!(covData && typeof covData.of === "number" &&
        typeof covData.in === "number" && covData.of && covData.in * 5 < covData.of);

      const open = [], folded = [];
      (f.sameSession === true ? folded : open).push(when);
      (quiet ? open : folded).push(cut);
      if (cov) (covThin ? open : folded).push(cov);
      if (said) folded.push(said);

      for (const node of open) {
        node.classList.add("is-qualifier");
        block.append(node);
      }
      appendMethod(block, folded, "How this standing was read");
      host.append(block);
    }

    const notes = panel.notes || {};
    appendNotes(host, [notes.what, notes.absence, notes.rank, notes.timing, notes.units],
                "About this market-wide join");
  }

  const LEDGER_MAX = 20;

  function sessionLedger(host, _panel, card, question) {
    const { panelHead, quietPanel, emptyPanel, statList, isNum, el, money, px2, signed } = P;
    const panels = (card && card.panels) || {};
    const ovl = panels.scoreOverlay, prem = panels.premiumTrack;

    const ovlRows = ovl && ovl.status === "ok" && Array.isArray(ovl.rows) ? ovl.rows : [];
    const premRows = prem && prem.status === "ok" && Array.isArray(prem.rows) ? prem.rows : [];
    if (!ovlRows.length && !premRows.length) {
      return emptyPanel(host, question,
        ovl && ovl.status !== "ok" ? ovl
          : prem && prem.status !== "ok" ? prem
            : { status: "quiet", reason: "this card carries no dated session history" });
    }
    panelHead(host, question);

    const byDate = new Map();
    const take = (rows, fill) => {
      for (const r of rows) {
        const d = r && r.d;
        if (typeof d !== "string" || !d) continue;
        if (!byDate.has(d)) byDate.set(d, { d, close: null, score: null, p: null, source: null });
        fill(byDate.get(d), r);
      }
    };
    take(ovlRows, (row, r) => {
      row.close = isNum(r.close);
      row.score = isNum(r.score);
    });
    take(premRows, (row, r) => {
      row.p = isNum(r.p);
      row.source = typeof r.source === "string" ? r.source : null;
    });

    const all = [...byDate.values()].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    const rows = all.slice(0, LEDGER_MAX);

    const scoredIdx = [];
    all.forEach((r, i) => { if (r.score !== null) scoredIdx.push(i); });
    const priorScored = new Map();
    for (let k = 1; k < scoredIdx.length; k++) {

      priorScored.set(scoredIdx[k - 1], scoredIdx[k]);
    }

    const wrap = el("div", "fc-tablewrap");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "This name session by session, newest first");
    wrap.tabIndex = 0;
    const table = el("table", "fc-levels ft-ledger");
    const thead = el("thead"), htr = el("tr");

    for (const [label, cls, why] of [
      ["Session", null, "The trading session the row describes, newest first."],
      ["Close", "c-num", "The settled close for that session, from this card's own price window."],
      ["Score", "c-num",
        "The board's composite for that session, on a fixed −100 to +100 scale. " +
        "Not a return forecast."],
      ["Δ score", "c-num",
        "The move since this name's PREVIOUS SCORED session, which need not be the row " +
        "below: the span is in each cell's own title."],
      ["Net premium", "c-num",
        "Call premium minus put premium for that session, in dollars, as the board " +
        "published it that morning. The sign is the reading."],
    ]) {
      const th = el("th", cls, label);
      th.scope = "col";
      th.title = why;
      htr.append(th);
    }
    thead.append(htr);
    table.append(thead);

    const body = el("tbody");
    let drawn = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tr = el("tr");
      const d = el("td", "ft-ledger-d", r.d);

      if (r.source === "boards") {
        const mark = el("span", "ft-ledger-src", "· board");
        mark.title = "Reconstructed from the archived boards for that session, which " +
          "carry only the names that made a board that day.";
        d.append(mark);
      }
      tr.append(d);
      tr.append(el("td", "c-num", r.close === null ? DASH : px2(r.close)));
      tr.append(el("td", "c-num" + P.polarity(r.score),
        r.score === null ? DASH : signed(r.score, (a) => String(a))));

      const iAll = all.indexOf(r);
      const pj = priorScored.has(iAll) ? priorScored.get(iAll) : null;
      const dCell = el("td", "c-num");
      if (r.score !== null && pj !== null && all[pj].score !== null) {
        const mv = r.score - all[pj].score;
        const gap = pj - iAll;
        dCell.className = "c-num" + P.polarity(mv);
        dCell.textContent = signed(mv, (a) => String(a));
        dCell.title = mv + " score points since " + all[pj].d + ", " +
          gap + (gap === 1 ? " session" : " sessions") + " earlier.";
      } else {
        dCell.textContent = DASH;
        dCell.title = r.score === null
          ? "This name was not scored on this session."
          : "No earlier scored session inside this window to measure against.";
      }
      tr.append(dCell);

      const pCell = el("td", "c-num" + P.polarity(r.p));
      pCell.textContent = r.p === null ? DASH : money(r.p);
      if (r.p === null) {
        pCell.title = "No archived net premium for this name on this session — which is " +
          "not the same as a session it was priced flat in.";
      }
      tr.append(pCell);
      body.append(tr);
      drawn++;
    }
    table.append(body);
    wrap.append(table);
    host.append(wrap);

    const priced = all.filter((r) => r.p !== null).length;
    const scored = all.filter((r) => r.score !== null).length;
    host.append(statList([
      ["Sessions held", String(all.length)],
      ["Scored", scored + " of " + all.length],
      ["Priced", priced + " of " + all.length],
    ]));

    const capped = all.length > drawn;
    host.append(el("p", "fc-note is-qualifier",
      "One row a session, newest first, over the window this card's price history and " +
      "the score archive between them cover" +
      (capped ? " — the newest " + drawn + " of " + all.length + " are drawn" : "") +
      ". Close and score come from the score-over-price panel and net premium from the " +
      "net-premium panel; the two are joined on the DATE, not by position, because the " +
      "two windows need not be the same length or start on the same day. A dash is a " +
      "session that column has no reading for, never a zero."));
  }

  function keyStats(host, _panel, card, question) {
    const { panelHead, statList, isNum } = P;
    panelHead(host, question);
    const panels = (card && card.panels) || {};

    const silence = (p, what) => {
      if (!p) return ["unavailable", "The " + what + " panel is not on this card."];
      if (p.status === "quiet") return ["quiet", p.reason || "Measured, with nothing to report."];
      if (p.status === "pending") return ["pending", p.reason || "Not gathered yet."];
      return ["unavailable", p.reason || "The " + what + " panel could not be read."];
    };

    const money = (n) => "$" + n.toFixed(2);
    const pct1 = (n) => (n * 100).toFixed(1) + "%";

    const atrOf = (n) => (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(2) + " ATR";

    const pairs = [];
    const lv = panels.levels;
    const spot = lv ? isNum(lv.spot) : null;
    if (spot === null) {
      const [kind, why] = silence(lv, "levels");
      pairs.push(["Spot", DASH, null, kind, why]);
    } else {
      pairs.push(["Spot", money(spot)]);
    }

    const atr = isNum(card && card.atr);
    if (atr === null) {
      pairs.push(["ATR", DASH, null, "unavailable",
        "This card publishes no ATR, so the distances below are in percent only."]);
    } else {
      pairs.push(["ATR", money(atr)]);
    }

    const rows = (lv && Array.isArray(lv.levels)) ? lv.levels : null;
    for (const [kind, label] of [["max_pain", "Max pain"], ["put_wall", "Put wall"], ["call_wall", "Call wall"]]) {
      const row = rows ? rows.find((r) => r && r.kind === kind) : null;
      const px = row ? isNum(row.px) : null;
      const dist = row ? isNum(row.distAtr) : null;
      if (px === null) {
        const [k, why] = silence(lv, "levels");
        pairs.push([label, DASH, null, k, why]);
      } else {
        pairs.push([label, money(px) + (dist === null ? "" : " · " + atrOf(dist))]);
      }
    }

    const flip = isNum(card && card.gammaFlip);
    if (flip === null) {
      const gm = panels.gamma;
      if (gm && gm.status && gm.status !== "ok") {
        const [k, why] = silence(gm, "gamma");
        pairs.push(["Gamma flip", DASH, null, k, why]);
      } else {
        pairs.push(["Gamma flip", DASH, null, "quiet",
          "Net gamma does not change sign materially inside the drawn band, so " +
          "no flip level is published for this name."]);
      }
    } else {
      pairs.push(["Gamma flip", money(flip)]);
    }

    const pm = panels.pricedMove;
    const move = pm ? isNum(pm.movePerc) : null;
    if (move === null) {
      const [k, why] = silence(pm, "priced move");
      pairs.push(["Priced move", DASH, null, k, why]);
    } else {
      pairs.push(["Priced move", "±" + pct1(move)]);
    }

    const vc = panels.volContext;
    const ir = vc && vc.ivRank;
    let latest = null;
    if (ir && Array.isArray(ir.rows)) {
      for (const r of ir.rows) {
        if (!r || isNum(r.rank1y) === null || !r.date) continue;
        if (!latest || String(r.date) > String(latest.date)) latest = r;
      }
    }
    if (!latest) {
      const [k, why] = silence(ir || vc, "implied-volatility rank");
      pairs.push(["IV rank", DASH, null, k, why]);
    } else {
      const unit = typeof ir.rankUnit === "string" && /percent/i.test(ir.rankUnit) ? "%" : "";
      pairs.push(["IV rank", isNum(latest.rank1y).toFixed(1) + unit +
        " · " + String(latest.date)]);
    }

    host.append(statList(pairs));
  }

  const DRAW = {
    gamma: "gamma",
    aggressor: drawAggressor,
    ivSurface: drawIvSurface,
    skewTerm: drawSkewTerm,
    topContracts: drawTopContracts,
    levels: "levels",
    surface: "surface",
    displacement: "displacement",
    calendar: "calendar",
    pricedMove: "pricedMove",
    path: "path",
    premiumTrack: "premiumTrack",
    context: "context",
    congress: "congress",
    marketRank: drawMarketRank,
    darkpool: drawDarkpool,
    oiDeltas: drawOiDeltas,
    volContext: drawVolContext,
    deltaExposure: "deltaExposure",
    charm: "charm",
    vanna: "vanna",

    __score: (host, panel, card, question) => P.score(host, card, question),
    __stats: keyStats,
    __sessions: sessionLedger,
  };

  const drawnStations = new Map();

  function panelSections(only) {
    return [...(only
      ? grid.querySelectorAll('.ft-station[data-group="' + only + '"] .ft-panel[data-panel]')
      : grid.querySelectorAll(".ft-panel[data-panel]"))];
  }

  async function loadDrawersFor(sections) {
    if (!sections.some((s) => typeof DRAW[s.dataset.panel] === "string")) return;
    try { await P.need(); } catch {   }
  }

  function drawAll(card, mount, only) {
    const missing = [];
    for (const section of panelSections(only)) {
      const key = section.dataset.panel;
      const question = section.dataset.question || "";
      const host = section.querySelector("div");

      if (!host) { missing.push(key); continue; }

      const entry = DRAW[key];
      const drawer = typeof entry === "string" ? P[entry] : entry;
      if (typeof drawer !== "function") {
        deadPanel(host, question, "no renderer is registered for this panel.");
        continue;
      }

      const panel = card.panels && card.panels[key];

      if (panel === undefined && !section.hasAttribute("data-sentinel")) {
        deadPanel(host, question, predatesSentence(key));
        continue;
      }

      try {
        drawer(host, panel, card, question, mount);
      } catch (error) {
        deadPanel(host, question, drawFailed(error));
      }
    }

    for (const section of grid.querySelectorAll(".ft-panel[data-panel] > div")) {
      markExplained(section);
    }
    writePanelLeads(card);
    writeStationLeads();
    if (missing.length) {
      console.error("flows-ticker: no drawing host for panel(s): " + missing.join(", "));
    }
  }

  function writePanelLeads(card) {
    const panels = (card && card.panels) || {};
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
      const slot = section.querySelector(":scope > .ft-panel-one");
      if (!slot) continue;

      slot.textContent = "";
      const panel = panels[section.dataset.panel];
      const said = panel && panel.lead && typeof panel.lead.say === "string"
        ? panel.lead.say.trim() : "";
      if (said) slot.textContent = said;
    }
  }

  function writeStationLeads() {
    for (const station of grid.querySelectorAll(".ft-station[data-group]")) {
      const slot = station.querySelector(":scope > .ft-station-lead");
      if (!slot) continue;
      slot.textContent = "";
      const panels = [...station.querySelectorAll(":scope > .ft-panel[data-panel]")];
      if (!panels.length) continue;
      let unavailable = 0;
      let quiet = 0;
      let read = 0;
      for (const panel of panels) {
        const host = panel.querySelector(":scope > div");
        if (!host) continue;
        const empty = host.querySelector("[data-empty]");
        const kind = empty && empty.getAttribute("data-empty");
        if (kind === "unavailable") unavailable++;
        else if (kind === "quiet") quiet++;
        else read++;
      }

      const parts = [`${read} of ${panels.length} drawn`];
      if (unavailable) {
        parts.push(`${unavailable} withheld — the source did not return`);
      }
      if (quiet) {
        parts.push(`${quiet} quiet — the source answered and measured nothing`);
      }
      slot.textContent = parts.join("; ") + ".";
    }
  }

  function drawFailed(error) {
    return "this panel's renderer failed: " + String((error && error.message) || error);
  }

  const zoom = $("ftZoom");
  const zoomHost = $("ftZoomHost");
  const zoomTitle = zoom && zoom.querySelector(".ft-panel-t");
  let zoomKey = null;
  let zoomOpener = null;

  let hashBeforeZoom = "";

  function openZoom(key, section) {
    if (!zoom || !zoomHost || typeof zoom.showModal !== "function") return;
    zoomKey = key;
    zoomOpener = section.querySelector(".ft-zoom-open");

    hashBeforeZoom = String(location.hash || "").slice(1);
    writeHash("panel-" + key);
    const titleEl = section.querySelector(".ft-panel-t");
    if (zoomTitle) zoomTitle.textContent = titleEl ? titleEl.textContent : "";
    zoom.showModal();

    requestAnimationFrame(() => drawZoom());
  }

  function drawZoom() {
    if (!zoomKey || !zoomHost || !painted) return;
    const section = grid.querySelector('.ft-panel[data-panel="' + cssEscape(zoomKey) + '"]');
    const question = (section && section.dataset.question) || "";

    const zoomEntry = DRAW[zoomKey];
    const drawer = typeof zoomEntry === "string" ? P[zoomEntry] : zoomEntry;
    const panel = painted.panels && painted.panels[zoomKey];
    if (typeof drawer !== "function") {
      deadPanel(zoomHost, question, "no renderer is registered for this panel.");
      return;
    }

    if (panel === undefined && !(section && section.hasAttribute("data-sentinel"))) {
      deadPanel(zoomHost, question, predatesSentence(zoomKey));
      return;
    }
    try { drawer(zoomHost, panel, painted, question, "zoom"); }
    catch (error) { deadPanel(zoomHost, question, drawFailed(error)); }

    markExplained(zoomHost);
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  if (zoom) {
    grid.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest(".ft-zoom-open");
      if (!button) return;
      const section = button.closest(".ft-panel[data-panel]");
      if (section) openZoom(section.dataset.panel, section);
    });
    const closeButton = $("ftZoomClose");
    if (closeButton) closeButton.addEventListener("click", () => zoom.close());

    zoom.addEventListener("click", (event) => {
      const box = zoom.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right &&
        event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) zoom.close();
    });
    zoom.addEventListener("close", () => {
      zoomKey = null;
      writeHash(hashBeforeZoom);
      if (zoomHost) zoomHost.replaceChildren();
      if (zoomOpener && document.contains(zoomOpener)) zoomOpener.focus();
      zoomOpener = null;
    });
  }

  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!painted) return;

      syncBarHeight();

      for (const key of [...drawnStations.keys()]) {
        withAllStations(() => { drawAll(painted, "grid", key === ALL_STATIONS ? null : key); });
      }
      if (zoomKey) drawZoom();
    }, 160);
  });

  const fine = window.matchMedia("(pointer: fine)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  let spotlightOn = false;
  let frame = 0;
  let pending = null;

  function onPointerMove(event) {
    const panel = event.target.closest && event.target.closest(".ft-panel");
    if (!panel) return;
    pending = { panel, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pending) return;
      const { panel: target, x, y } = pending;
      const box = target.getBoundingClientRect();
      if (!box.width || !box.height) return;
      target.style.setProperty("--mx", (((x - box.left) / box.width) * 100).toFixed(1));
      target.style.setProperty("--my", (((y - box.top) / box.height) * 100).toFixed(1));
    });
  }

  function syncSpotlight() {
    const want = fine.matches && !calm.matches;
    if (want === spotlightOn) return;
    spotlightOn = want;
    if (want) {
      grid.addEventListener("pointermove", onPointerMove, { passive: true });
    } else {
      grid.removeEventListener("pointermove", onPointerMove);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      pending = null;
      for (const panel of grid.querySelectorAll(".ft-panel")) {
        panel.style.removeProperty("--mx");
        panel.style.removeProperty("--my");
      }
    }
  }
  for (const query of [fine, calm]) {
    if (query.addEventListener) query.addEventListener("change", syncSpotlight);
    else if (query.addListener) query.addListener(syncSpotlight);
  }
  syncSpotlight();

  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;

  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  let boardSession = null;

  function assessAge(card) {
    const now = Date.now();
    const parts = [];
    const mine = ISO_DAY.test(String(card.sessionDate || "")) ? String(card.sessionDate) : null;

    if (mine && boardSession) {

      if (mine < boardSession) {
        parts.push("every figure on this page is from the session of " + mine +
          ", and the board has since published " + boardSession);
      }
      return parts;
    }

    const stamped = isNum(card.__updatedAt);
    const written = stamped !== null && stamped > 0 ? stamped : null;
    if (written !== null && now - written > STALE_WRITE_MS) {
      const hours = Math.floor((now - written) / 3600000);
      const days = Math.floor(hours / 24);

      const age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");

      parts.push("this card was last written " + age + " ago" +
        (mine ? ", and the session it names has not yet been compared against the current run"
              : ", and it names no session it describes"));
    }
    return parts;
  }

  function setStale(parts) {
    if (!staleEl) return;

    if (!parts.length) {
      staleEl.hidden = true;
      staleEl.textContent = "";
      grid.classList.remove("is-stale");
      return;
    }
    staleEl.textContent = "Stale: " + parts.join(", ") + ".";
    staleEl.hidden = false;

    grid.classList.add("is-stale");
  }

  function readTicker() {
    try {
      const raw = new URL(location.href).searchParams.get("t");
      if (!raw) return null;
      const t = String(raw).trim().toUpperCase();
      return /^[A-Z][A-Z0-9.-]{0,9}$/.test(t) ? t : null;
    } catch { return null; }
  }

  function getJSON(url) {
    return fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then((response) => {
      if (response.status === 401) { location.replace("/flows/"); return null; }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
      return response.json().then((payload) => {
        if (payload && typeof payload === "object") payload.__updatedAt = updatedAt;
        return payload;
      });
    });
  }

  let painted = null;

  function fmtDate(iso) {
    if (!iso) return DASH;
    const d = new Date(String(iso).length <= 10 ? iso + "T00:00:00Z" : iso);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(iso);
  }

  const PANEL_CHROME = {
    __score: { group: "signal", tier: "lead" },
    __stats: { group: "signal", tier: "table" },
    __sessions: { group: "tape", tier: "table" },
    gamma: { group: "convexity", tier: "lead" },
    levels: { group: "convexity", tier: "reading" },
    displacement: { group: "convexity", tier: "reading" },
    surface: { group: "convexity", tier: "chart" },
    calendar: { group: "convexity", tier: "chart" },
    deltaExposure: { group: "convexity", tier: "chart" },
    charm: { group: "convexity", tier: "chart" },
    vanna: { group: "convexity", tier: "chart" },
    ivSurface: { group: "volatility", tier: "lead" },
    skewTerm: { group: "volatility", tier: "chart" },
    pricedMove: { group: "volatility", tier: "reading" },
    volContext: { group: "volatility", tier: "chart" },
    aggressor: { group: "tape", tier: "lead" },
    path: { group: "tape", tier: "chart" },
    premiumTrack: { group: "tape", tier: "chart" },
    topContracts: { group: "tape", tier: "table" },
    darkpool: { group: "tape", tier: "table" },
    oiDeltas: { group: "tape", tier: "table" },
    context: { group: "context", tier: "chart" },
    marketRank: { group: "context", tier: "lead" },
    congress: { group: "context", tier: "table" },
  };

  let barEl = null;
  let changeEl = null;

  function buildBar() {
    if (!headEl || barEl) return;
    barEl = $("ftBar");

    if (!barEl) return;
    barEl.insertBefore(headEl, barEl.firstChild);

    changeEl = el("section", "ft-change");
    changeEl.id = "ftChange";
    changeEl.hidden = true;
    changeEl.setAttribute("aria-labelledby", "ftChangeH");

    const band4 = document.querySelector(".ft-band4");
    if (band4) band4.insertBefore(changeEl, band4.firstChild);
    else {
      const after = document.querySelector(".ft-top") || $("ftCards") || barEl;
      after.parentNode.insertBefore(changeEl, after.nextSibling);
    }
  }

  function mountChrome() {
    const wrong = [];
    const seen = new Set();
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
      const key = section.dataset.panel;
      seen.add(key);
      const chrome = PANEL_CHROME[key];
      if (!chrome) {
        wrong.push(key + ": served, but this file has no chrome entry for it");
        continue;
      }
      if (section.dataset.group !== chrome.group || section.dataset.tier !== chrome.tier) {
        wrong.push(key + ": served as " + section.dataset.group + "/" +
          section.dataset.tier + ", this file says " + chrome.group + "/" + chrome.tier);
      }
    }
    for (const key in PANEL_CHROME) {
      if (!seen.has(key)) wrong.push(key + ": in this file's chrome table, not on the page");
    }
    if (wrong.length) {
      console.error("flows-ticker: the served panel chrome and this file disagree — " +
        wrong.join("; "));
    }
  }

  let fontsArmed = !!(document.fonts && document.fonts.ready);
  function syncBarHeight() {
    if (!barEl || barEl.hidden) return;
    const h = Math.round(barEl.getBoundingClientRect().height);
    if (h > 0) grid.style.setProperty("--ft-bar-h", h + "px");
    if (fontsArmed) {
      fontsArmed = false;
      document.fonts.ready.then(() => { syncBarHeight(); });
    }
  }

  if (typeof ResizeObserver === "function") {
    const settle = new ResizeObserver(() => {
      syncBarHeight();
      reHonourJump();
    });
    if (barEl) settle.observe(barEl);

    if (grid) settle.observe(grid);
  }

  function hashTarget() {
    let raw = "";
    try { raw = decodeURIComponent(String(location.hash || "").slice(1)); }
    catch { raw = String(location.hash || "").slice(1); }
    if (!raw) return null;

    const direct = document.getElementById(raw);
    if (!direct || !grid.contains(direct)) return null;
    return direct.classList.contains("ft-panel")
      ? direct
      : (direct.closest(".ft-panel") || direct);
  }

  let jumped = null;
  function reHonourJump() {
    if (!jumped) return;
    const { target, y } = jumped;
    jumped = null;
    if (!target.isConnected) return;
    if (Math.abs(scrollPos() - y) > 1) return;
    target.scrollIntoView({ block: "start" });
    jumped = { target, y: scrollPos() };
  }

  function honourHash() {
    const target = hashTarget();
    if (!target) return;

    const group = target.dataset ? target.dataset.group : null;
    if (group && station !== ALL_STATIONS && station !== group) {
      showStation(group, { url: true, push: false });
    }
    syncBarHeight();
    target.scrollIntoView({ block: "start" });

    jumped = { target, y: scrollPos() };

    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    markCurrentGroup(target.dataset ? target.dataset.group : null);
  }

  function markCurrentGroup(group) {
    if (!barEl) return;
    for (const a of barEl.querySelectorAll(".ft-tab[data-group]")) {
      if (group && a.dataset.group === group) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  }

  const ALL_STATIONS = "all";
  let station = null;

  const stationEls = () => grid.querySelectorAll(".ft-station[data-group]");

  function stationKeys() {
    const keys = [];
    for (const s of stationEls()) if (s.dataset.group) keys.push(s.dataset.group);
    return keys;
  }

  function withAllStations(fn) {
    const put = [];
    for (const s of stationEls()) if (s.hidden) { put.push(s); s.hidden = false; }
    try { return fn(); } finally { for (const s of put) s.hidden = true; }
  }

  function wantedStation() {
    const keys = stationKeys();
    if (!keys.length) return null;
    let asked = "";
    try { asked = new URL(location.href).searchParams.get("s") || ""; } catch { asked = ""; }
    if (asked === ALL_STATIONS || keys.indexOf(asked) !== -1) return asked;

    const target = hashTarget();
    const group = target && target.dataset ? target.dataset.group : null;
    if (group && keys.indexOf(group) !== -1) return group;

    return ALL_STATIONS;
  }

  function writeStation(key, push) {
    let url;
    try { url = new URL(location.href); } catch { return; }

    if (key === ALL_STATIONS) url.searchParams.delete("s");
    else url.searchParams.set("s", key);
    const next = url.pathname + url.search + url.hash;
    try {
      if (push) history.pushState({ s: key }, "", next);
      else history.replaceState({ s: key }, "", next);
    } catch {   }
  }

  function showStation(key, opts) {
    const keys = stationKeys();
    if (!keys.length) return;
    const next = (key === ALL_STATIONS || keys.indexOf(key) !== -1) ? key : keys[0];
    station = next;
    for (const s of stationEls()) {
      s.hidden = !(next === ALL_STATIONS || s.dataset.group === next);
    }
    if (barEl) {
      for (const a of barEl.querySelectorAll("[data-side]")) {
        const on = a.dataset.side === next;
        a.setAttribute("aria-selected", on ? "true" : "false");

        if (a.classList.contains("ft-tab")) a.tabIndex = on ? 0 : -1;
      }
    }

    if (next !== ALL_STATIONS) markCurrentGroup(next);
    if (opts && opts.url) writeStation(next, !!opts.push);

    drawStation(painted, "grid");
  }

  function drawStation(card, mount) {
    if (!card) return Promise.resolve();
    const key = station === ALL_STATIONS ? ALL_STATIONS : station;
    if (key === null) return Promise.resolve();

    const already = drawnStations.get(key);
    if (already) return already;

    const only = key === ALL_STATIONS ? null : key;
    const drawing = loadDrawersFor(panelSections(only)).then(() => {
      withAllStations(() => { drawAll(card, mount, only); });
    });
    drawnStations.set(key, drawing);
    return drawing;
  }

  function applyStation(opts) {
    const want = wantedStation();
    if (want === null) return;
    showStation(want, opts || { url: true, push: false });
  }

  function stationKeydown(event) {
    const keys = stationKeys();
    if (!keys.length || event.altKey || event.ctrlKey || event.metaKey) return;
    const here = event.target && event.target.closest
      ? event.target.closest(".ft-tab[data-side]") : null;
    if (!here) return;
    const at = keys.indexOf(here.dataset.side);
    if (at === -1) return;
    let to = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") to = (at + 1) % keys.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = (at - 1 + keys.length) % keys.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = keys.length - 1;
    else return;
    event.preventDefault();
    showStation(keys[to], { url: true, push: true });
    const tab = barEl && barEl.querySelector('.ft-tab[data-side="' + keys[to] + '"]');
    if (tab) { try { tab.focus(); } catch {   } }
  }

  function installStations() {
    if (!barEl) return;
    barEl.addEventListener("click", (event) => {
      const tab = event.target && event.target.closest
        ? event.target.closest("[data-side]") : null;
      if (!tab || !barEl.contains(tab)) return;

      if (event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showStation(tab.dataset.side, { url: true, push: true });

      const head = tab.dataset.side === ALL_STATIONS
        ? grid
        : grid.querySelector('.ft-station[data-group="' + tab.dataset.side + '"] .ft-group');
      if (head) {
        syncBarHeight();
        head.scrollIntoView({ block: "start" });
        if (!head.hasAttribute("tabindex")) head.tabIndex = -1;
        try { head.focus({ preventScroll: true }); } catch { head.focus(); }
      }
    });
    barEl.addEventListener("keydown", stationKeydown);

    window.addEventListener("popstate", () => applyStation({ url: false }));
  }

  function watchGroups() {
    if (typeof IntersectionObserver !== "function") return;

    const inBand = new Set();
    let queued = false;

    function choose() {
      queued = false;
      const bandTop = 0.25 * window.innerHeight, bandBottom = 0.4 * window.innerHeight;
      let best = null, bestSeen = 0;
      for (const node of inBand) {
        const r = node.getBoundingClientRect();
        const seen = Math.min(r.bottom, bandBottom) - Math.max(r.top, bandTop);
        if (seen > bestSeen) { bestSeen = seen; best = node; }
      }
      if (best) markCurrentGroup(best.dataset.group);
    }

    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(choose);
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) inBand.add(e.target); else inBand.delete(e.target);
      }
      choose();
    }, { rootMargin: "-25% 0px -60% 0px" });
    for (const station of grid.querySelectorAll(".ft-station[data-group]")) io.observe(station);
    addEventListener("scroll", schedule, { passive: true });
    if (scroller) scroller.addEventListener("scroll", schedule, { passive: true });
  }

  if (scroller) {
    const edge = () => scroller.classList.toggle("is-scrolled", scroller.scrollTop > 2);
    scroller.addEventListener("scroll", edge, { passive: true });
    edge();
  }

  function writeHash(value) {
    try {
      history.replaceState(null, "",
        location.pathname + location.search + (value ? "#" + value : ""));
    } catch {   }
  }

  function spotOf(card) {
    for (const key of ["levels", "pricedMove", "gamma"]) {
      const panel = card.panels && card.panels[key];
      if (!panel || panel.status !== "ok") continue;
      const v = isNum(panel.spot);
      if (v !== null) return { v, from: key };
    }
    return null;
  }

  function idChip(id, label, value, opts) {
    const o = opts || {};
    const node = $(id) || el("span", "fc-meta ft-id");
    node.id = id;
    node.className = "fc-meta ft-id" + (o.cls ? " " + o.cls : "");
    node.replaceChildren();
    if (label) node.append(document.createTextNode(label + " "));
    node.append(el("b", null, value));
    if (o.empty) node.setAttribute("data-empty", o.empty);
    else node.removeAttribute("data-empty");
    if (o.title) node.title = o.title;
    else node.removeAttribute("title");
    return node;
  }

  function sideOf(card, chg) {
    const score = isNum(card && card.score);
    const band = chg && chg.status === "ok" ? chg.band : null;
    if (score === null) {
      return { text: DASH, word: null, cls: "is-null", empty: "unavailable",
        title: "This card carries no score, so it has no side." };
    }
    const word = score < 0 ? "bearish" : score > 0 ? "bullish" : "neutral";
    if (band === null) {
      return { text: word, word, cls: P.polarity(score), empty: null,
        title: "No dead band was published on this card, so the side is stated " +
          "against zero rather than against the board's own membership rule." };
    }
    if (Math.abs(score) <= band) {
      return { text: "inside the dead band", word: null, cls: "is-flat", empty: null,
        title: "Within ±" + band + POINTS(band) + " of zero, which is the band " +
          "the board declines to rank inside." };
    }
    return { text: word, word, cls: P.polarity(score), empty: null,
      title: "Outside the published dead band of ±" + band + POINTS(band) + "." };
  }

  function paintHero(card, chg) {
    const hero = $("ftHero");
    if (!hero) return;

    const t = $("ftHeroT");
    if (t) t.textContent = card.ticker || "";

    const nm = typeof card.nm === "string" && card.nm.trim() ? card.nm.trim() : null;
    const nmEl = $("ftHeroNm");
    if (nmEl) {
      nmEl.textContent = nm && nm !== card.ticker ? nm : "";
      nmEl.hidden = !(nm && nm !== card.ticker);
    }

    const spot = spotOf(card);
    const px = $("ftHeroPx");
    if (px) {
      px.textContent = spot === null ? DASH : "$" + spot.v.toFixed(2);
      if (spot === null) px.setAttribute("data-empty", "unavailable");
      else px.removeAttribute("data-empty");
      px.title = spot === null
        ? "No panel on this card published a spot price."
        : "Spot as the " + spot.from + " panel resolved it.";
    }

    const ctx = card.panels && card.panels.context;
    const chgPct = ctx && ctx.status === "ok" ? isNum(ctx.changePct) : null;
    const chgEl = $("ftHeroChg");
    if (chgEl) {
      chgEl.textContent = chgPct === null ? "" : P.pct1(chgPct);
      chgEl.className = "ft-hero-chg" + P.polarity(chgPct);
      chgEl.hidden = chgPct === null;
      chgEl.title = "Change against the previous close, from the price context panel.";
    }

    const score = isNum(card.score);
    const sEl = $("ftHeroScore");
    if (sEl) {
      sEl.textContent = score === null ? DASH : P.signed(score, (a) => String(a));
      sEl.className = "ft-hero-v" + P.polarity(score);
      if (score === null) sEl.setAttribute("data-empty", "unavailable");
      else sEl.removeAttribute("data-empty");
    }
    const bar = $("ftHeroScoreBar");
    if (bar) {
      bar.replaceChildren();
      bar.hidden = score === null;
      if (score !== null) {
        const fill = el("i", P.polarity(score).trim() || null);

        const half = Math.min(50, Math.abs(score) / 2);
        fill.style.width = half + "%";
        fill.style.left = (score < 0 ? 50 - half : 50) + "%";
        bar.append(fill);
      }
    }

    const sd = sideOf(card, chg);
    const pill = $("ftHeroSide");
    if (pill) {
      pill.textContent = sd.word ? sd.word.toUpperCase() : "";
      pill.className = "ft-hero-pill" + (sd.word === "bullish" ? " is-pos"
        : sd.word === "bearish" ? " is-neg" : "");
      pill.title = sd.title;
      pill.hidden = !sd.word;
    }

    const conv = isNum(card.conviction);
    const cEl = $("ftHeroConv");
    if (cEl) {
      cEl.textContent = conv === null ? DASH : String(Math.round(conv));
      if (conv === null) cEl.setAttribute("data-empty", "unavailable");
      else cEl.removeAttribute("data-empty");
    }
    const seg = $("ftHeroConvSeg");
    if (seg) {
      seg.replaceChildren();
      seg.hidden = conv === null;
      if (conv !== null) {
        for (let i = 0; i < 5; i++) {
          seg.append(el("i", conv >= (i + 1) * 20 ? "is-on" : null));
        }
      }
    }

    const pm = card.panels && card.panels.pricedMove;
    const pmOk = pm && pm.status === "ok";
    const atmVol = pmOk ? isNum(pm.atmVol) : null;
    const ivRank = pmOk ? isNum(pm.ivRank) : null;
    const horizon = pmOk && typeof pm.horizonRule === "string" && pm.horizonRule
      ? pm.horizonRule : null;

    const ivB = $("ftHeroIvB"), ivEl = $("ftHeroIv"), ivSub = $("ftHeroIvSub");
    if (ivB && ivEl) {
      ivEl.textContent = atmVol === null ? DASH : (atmVol * 100).toFixed(1) + "%";
      if (atmVol === null) ivEl.setAttribute("data-empty", "unavailable");
      else ivEl.removeAttribute("data-empty");
      if (ivSub) {
        ivSub.textContent = horizon ? "at " + horizon : "";
        ivSub.hidden = !horizon;
      }
      ivB.title = atmVol === null
        ? "The priced-move panel published no at-the-money volatility for this name."
        : "At-the-money implied volatility, over " + (horizon || "the panel's own horizon") +
          ", as the priced-move panel measured it.";

      ivB.hidden = !pmOk;
    }

    const ivrB = $("ftHeroIvrB"), ivrEl = $("ftHeroIvr"), ivrSeg = $("ftHeroIvrSeg");
    if (ivrB && ivrEl) {
      ivrEl.textContent = ivRank === null ? DASH : Math.round(ivRank * 100) + "%";
      if (ivRank === null) ivrEl.setAttribute("data-empty", "unavailable");
      else ivrEl.removeAttribute("data-empty");
      if (ivrSeg) {
        ivrSeg.replaceChildren();
        ivrSeg.hidden = ivRank === null;
        if (ivRank !== null) {

          for (let i = 0; i < 5; i++) {
            ivrSeg.append(el("i", ivRank * 100 >= (i + 1) * 20 ? "is-on" : null));
          }
        }
      }
      ivrB.title = ivRank === null
        ? "The priced-move panel published no IV rank for this name."
        : "Where this name's implied volatility sits inside its own past year: " +
          Math.round(ivRank * 100) + "% of that year was lower. A percentile of its own " +
          "history, not a level comparable across names.";
      ivrB.hidden = !pmOk;
    }

    const sector = typeof card.sector === "string" && card.sector.trim()
      ? card.sector.trim() : null;

    const secEl = $("ftHeroSector"), whenEl = $("ftHeroWhen");
    const when = card.sessionDate ? "session " + fmtDate(card.sessionDate) : null;
    if (whenEl) whenEl.textContent = when || "";
    if (secEl) secEl.textContent = sector || "";

    hero.hidden = false;
    if (lastLive !== null) applyLive();
  }

  function paintCards(card) {
    const host = $("ftCards");
    if (!host) return;
    host.replaceChildren();
    const P0 = window.FlowsPanels;
    if (!P0) { host.hidden = true; return; }
    const panels = card.panels || {};
    const ok = (k) => {
      const p = panels[k];
      return p && p.status === "ok" ? p : null;
    };
    const n = (v) => isNum(v);

    const track = ok("premiumTrack"), path = ok("path"), aggr = ok("aggressor");
    const oiD = ok("oiDeltas"), dark = ok("darkpool");

    const spark = (vals) => {
      const pts = vals.map((v, i) => [i, n(v)]).filter((x) => x[1] !== null);
      if (pts.length < 2) return null;
      const W = 76, H = 20;
      let lo = Infinity, hi = -Infinity;
      for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo === hi) { lo -= 1; hi += 1; }
      const x = (i) => (i / Math.max(1, vals.length - 1)) * W;
      const y = (v) => H - ((v - lo) / (hi - lo)) * H;
      const svg = svgEl("svg", { class: "ft-card-spark", viewBox: "0 0 " + W + " " + H,
        width: W, height: H, preserveAspectRatio: "none", "aria-hidden": "true" });
      svg.append(svgEl("path", {

        class: "ft-card-line " + P0.polarity(pts[pts.length - 1][1]),
        fill: "none",
        d: pts.map(([i, v], k) => (k ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" "),
      }));
      return svg;
    };

    const bar = (v, peak) => {
      const val = n(v);
      if (val === null || !(peak > 0)) return null;
      const b = el("span", "ft-card-bar");
      const fill = el("i", val < 0 ? "is-neg" : val > 0 ? "is-pos" : "");
      const half = Math.min(50, (Math.abs(val) / peak) * 50);
      fill.style.width = Math.max(1.5, half) + "%";
      fill.style.left = (val < 0 ? 50 - half : 50) + "%";
      b.append(fill);
      return b;
    };

    const cards = [];

    if (track) {
      const rows = Array.isArray(track.rows) ? track.rows : [];
      cards.push(["Premium run", P0.money(track.net),
        P0.polarity(n(track.net)),
        track.sessions + " sessions, " + track.priced + " priced" +
          (track.gaps ? ", " + track.gaps + " unpriced" : ""),
        spark(rows.map((r) => r && r.p)),
        "Net premium — calls minus puts — summed over the sessions this card carries. " +
        (track.unit || "")]);
    }
    if (path) {

      const tape = Array.isArray(path.series) ? path.series : [];
      cards.push(["Session premium", P0.money(path.netPremium),
        P0.polarity(n(path.netPremium)),
        path.netPremiumUnit || "",
        spark(tape.map((r) => (Array.isArray(r) ? r[1] : null))),
        "What this one session cleared, side-signed, over " +
          (n(path.minutes) === null ? "the session" : path.minutes + " minutes") + "."]);
      cards.push(["Net delta", P0.fmtOr(path.netDelta, (v) => P0.signed(v, (a) => P0.compact(a))),
        P0.polarity(n(path.netDelta)),
        path.netDeltaUnit || "",
        spark(tape.map((r) => (Array.isArray(r) ? r[0] : null))),
        "Delta-weighted contracts the tape ended holding, signed by side."]);
    }
    if (aggr && aggr.lead && aggr.lead.n) {
      const net = n(aggr.lead.n.ladderNetExact);
      cards.push(["Aggressor", P0.fmtOr(net, (v) => P0.signed(v, (a) => P0.compact(a))),
        P0.polarity(net),
        aggr.reported + " reported, " + aggr.unreported + " not",

        bar(n(aggr.lead.n.topNetExact), Math.abs(net) || 0),
        aggr.relation || ""]);
    }
    if (oiD && oiD.lead && oiD.lead.n) {
      const cN = n(oiD.lead.n.callNet), pN = n(oiD.lead.n.putNet);
      const both = cN !== null && pN !== null;
      cards.push(["Open interest", both ? P0.signed(cN - pN, (a) => P0.compact(a)) : DASH,
        both ? P0.polarity(cN - pN) : "",
        both ? P0.compact(Math.abs(cN)) + " call / " + P0.compact(Math.abs(pN)) + " put" : "",
        both ? bar(cN - pN, Math.max(Math.abs(cN), Math.abs(pN))) : null,
        "Contract-level open-interest change on the lines the vendor surfaced. An open " +
        "interest change compares two clearing snapshots, so it is a settled fact a day " +
        "late by construction — never today's tape."]);
    }
    if (dark && dark.lead && dark.lead.n) {
      const d = n(dark.lead.n.dollars);
      cards.push(["Off-exchange", P0.money(d), "",
        dark.lead.n.kept + " of " + dark.lead.n.seen + " prints" +
          (n(dark.lead.n.topPct) === null ? "" : ", top " + dark.lead.n.topPct + "%"),
        null,
        "Off-exchange equity executions in this name, by their own dollar size. The tape " +
        "reports them with delay and attributes no side and no participant."]);
    }

    for (const [k, v, cls, sub, viz, why] of cards.slice(0, 6)) {
      const c = el("div", "ft-card");
      c.title = why || "";
      c.append(el("span", "ft-card-k", k));
      const row = el("span", "ft-card-row");
      row.append(el("span", "ft-card-v" + (cls ? " " + cls : ""), v));
      if (viz) row.append(viz);
      c.append(row);
      if (sub) c.append(el("span", "ft-card-s", sub));
      host.append(c);
    }
    host.hidden = !cards.length;
  }

  function paintBrief(card) {
    const host = $("ftBrief"), list = $("ftBriefL"), sub = $("ftBriefS");
    if (!host || !list) return;
    list.replaceChildren();
    const panels = card.panels || {};
    const found = [];
    for (const section of document.querySelectorAll(".ft-panel[data-panel]")) {
      const key = section.getAttribute("data-panel");
      const p = key ? panels[key] : null;
      const say = p && p.status === "ok" && p.lead && typeof p.lead.say === "string"
        ? p.lead.say.trim() : "";
      if (!say) continue;
      const title = section.querySelector(".ft-panel-t");
      const station = section.closest(".ft-station[data-group]");
      found.push({ key, say, title: title ? title.textContent.trim() : key,
        group: station ? String(station.getAttribute("data-group")) : "" });
    }
    const CAP = 5;
    for (const f of found.slice(0, CAP)) {
      const li = el("li", "ft-brief-i");
      const a = el("a", "ft-brief-a");
      a.href = "#panel-" + f.key;

      a.setAttribute("aria-label", f.say + " \u2014 open " + f.title);

      a.append(el("span", "ft-brief-d" + (f.group ? " is-" + f.group : "")));

      const t = el("span", "ft-brief-t");
      const words = f.say.split(/\s+/).filter(Boolean);
      words.forEach((w, wi) => {
        if (wi) t.append(" ");
        const s = el("span", "ak-w", w);
        s.style.setProperty("--d", String(Math.min(wi, 32)));
        t.append(s);
      });

      if (f === found[Math.min(found.length, CAP) - 1]) {
        const caret = el("span", "ak-caret");
        caret.style.setProperty("--d", String(Math.min(words.length, 32) + 1));
        caret.setAttribute("aria-hidden", "true");
        t.append(caret);
      }
      a.append(t);
      a.append(el("span", "ft-brief-c", "\u203a"));
      li.append(a);
      list.append(li);
    }

    if (sub) {
      sub.textContent = found.length > CAP
        ? "The first " + CAP + " of " + found.length + " findings on this card, in page order."
        : (found.length
          ? found.length + (found.length === 1 ? " finding" : " findings") +
            " on this card, in page order."
          : "This card carries no panel findings. It was built before the panels " +
            "published them, so there is nothing here to gather — the readings " +
            "themselves are on the panels below, unaffected.");
    }

    if (sub) {
      sub.classList.toggle("fb-empty", !found.length);
      if (found.length) sub.removeAttribute("data-empty");
      else sub.setAttribute("data-empty", "unavailable");
    }
    host.hidden = false;

    const form = $("ftBriefAsk");
    if (form) {
      form.hidden = !found.length;
      const field = $("ftBriefQ");
      if (field) {
        field.placeholder = "What changed in " + (card.ticker || "this name") + "?";
      }
      if (!askWired) {
        askWired = true;
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const q = $("ftBriefQ");
          const said = q ? q.value.trim() : "";

          const sym = painted && painted.ticker ? String(painted.ticker) : "";
          const text = said && sym && said.toUpperCase().indexOf(sym) === -1
            ? sym + ": " + said
            : said;
          handOff(text);
          if (q) q.value = "";
        });
      }
    }
  }
  let askWired = false;

  function handOff(text) {
    const tab = document.getElementById("askDockTab");
    if (!tab) return;
    if (tab.getAttribute("aria-expanded") !== "true") tab.click();

    let tries = 0;
    const place = () => {
      const field = document.getElementById("askQ");
      if (!field) { if (tries++ < 8) requestAnimationFrame(place); return; }
      if (text) {
        field.value = text;

        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      try {
        field.focus();
        if (field.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length);
      } catch (e) {   }
    };
    requestAnimationFrame(place);
  }

  const PERIODS = [
    { key: "1D", n: 1 },
    { key: "1W", n: 5 },
    { key: "1M", n: 21 },
    { key: "3M", n: 63 },
    { key: "6M", n: 126 },
    { key: "1Y", n: 252 },
    { key: "3Y", n: 756 },
  ];
  let period = "3M";

  let chartStyle = "candles";
  let showSma = true;

  const CHART_TABS = ["price", "iv", "volume", "premium", "netflow"];
  const CHART_LABEL = {
    price: "Price", iv: "IV", volume: "Volume",
    premium: "Premium", netflow: "Net Flow",
  };
  let chartTab = "price";

  function chartSeries(key, card) {
    const panels = (card && card.panels) || {};
    const ok = (k) => { const p = panels[k]; return p && p.status === "ok" ? p : null; };

    if (key === "price") {
      const c = ok("context");
      if (!c) return { silence: "No price window was published for this name this run." };
      const candles = Array.isArray(c.candles) ? c.candles : [];
      if (candles.length >= 2) {

        const sma = Array.isArray(c.sma50) ? c.sma50 : [];
        return {
          kind: chartStyle === "line" ? "line" : "candles", unit: "close" +
            (chartStyle === "line" ? "" : ", with each session's open, high and low"),
          clock: "one " + (chartStyle === "line" ? "mark" : "candle") + " a session, " +
            candles.length + " of them, " + candles[0][0] + " to " +
            candles[candles.length - 1][0] + " — a session the vendor could not price " +
            "is absent rather than bridged",
          sma: showSma && sma.some((v) => isNum(v) !== null),
          points: candles.map((r, i) => {
            const o = isNum(r[1]), h = isNum(r[2]), l = isNum(r[3]), v = isNum(r[4]);
            const vol = isNum(r[5]), m = isNum(sma[i]);
            return {
              v, o, h, l, vol, sma: m,
              label: r[0] ? String(r[0]) : "Session " + (i + 1),
              rows: [
                { k: "Open", v: o === null ? "not published" : px2(o) },
                { k: "High", v: h === null ? "not published" : px2(h) },
                { k: "Low", v: l === null ? "not published" : px2(l) },
                { k: "Close", v: px2(v) },
                { k: "Volume", v: vol === null ? "not published" : compact(vol) + " shares" },
                { k: "SMA 50", v: m === null ? "fewer than 50 sessions behind it" : px2(m) },
              ],
            };
          }),
        };
      }
      const closes = Array.isArray(c.closes) ? c.closes : [];
      const dates = Array.isArray(c.closeDates) ? c.closeDates : [];
      if (closes.length < 2) return { silence: "Fewer than two closes were published." };

      const dropped = isNum(c.dropped);
      return {
        kind: "line", unit: "close",
        clock: "one mark a session, " + closes.length + " of them" +
          (dates.length ? ", " + dates[0] + " to " + dates[dates.length - 1] : "") +
          (dropped ? " — " + dropped + " session" + (dropped === 1 ? "" : "s") +
            " the window could not price are absent, so the spacing is by index " +
            "rather than by date" : ""),
        points: closes.map((v, i) => ({
          v: isNum(v),
          label: dates[i] ? String(dates[i]) : "Session " + (i + 1),
          rows: [{ k: "Close", v: px2(v) }],
        })),
      };
    }

    if (key === "iv") {
      const v = ok("volContext");
      const term = v && v.term;
      if (!term || term.status !== "ok" || !Array.isArray(term.rows) || term.rows.length < 2) {
        return { silence: term && term.reason
          ? String(term.reason)
          : "No volatility term curve was published for this name this run." };
      }
      return {
        kind: "line", unit: "implied volatility",
        clock: "one mark an EXPIRY, " + term.rows.length + " of them — this axis is " +
          "tenor, not time, so it is a curve across the term and not a history",
        points: term.rows.map((r) => {
          const dte = isNum(r.dte);
          const mv = isNum(r.impliedMovePerc);
          return {
            v: isNum(r.vol),
            label: String(r.expiry || DASH) + (dte === null ? "" : " · " + dte + "d out"),
            rows: [
              { k: "Implied vol", v: isNum(r.vol) === null ? "not published" : vol1(r.vol) },
              { k: "Implied move",
                v: mv === null ? "not published" : vol1(mv) + " of spot" },
            ],
          };
        }),
      };
    }

    if (key === "volume") {

      const c = ok("context");
      const candles = c && Array.isArray(c.candles) ? c.candles : [];
      if (candles.length < 2 || !candles.some((r) => isNum(r[5]) !== null)) {
        return { silence: "This card publishes no per-name share-volume series — a field " +
          "cards built before the candles were published do not carry. Contract volume is " +
          "published per STRIKE, which the chain draws; it is not a series through time." };
      }
      return {
        kind: "bars", unit: "shares traded, one bar a session",
        clock: "one bar a session, " + candles.length + " of them, " + candles[0][0] + " to " +
          candles[candles.length - 1][0] + " — a bar takes the colour of its session, " +
          "close above open or below it",
        points: candles.map((r, i) => {
          const o = isNum(r[1]), v = isNum(r[4]), vol = isNum(r[5]);
          return {
            v: vol, tone: o === null || v === null ? "flat" : v > o ? "pos" : v < o ? "neg" : "flat",
            label: r[0] ? String(r[0]) : "Session " + (i + 1),
            rows: [
              { k: "Volume", v: vol === null ? "not published" : compact(vol) + " shares" },
              { k: "Close", v: v === null ? "not published" : px2(v) },
            ],
          };
        }),
      };
    }

    if (key === "premium") {
      const t = ok("premiumTrack");
      const rows = t && Array.isArray(t.rows) ? t.rows : [];
      if (!rows.length) return { silence: "No net-premium history was published for this name." };
      return {
        kind: "bars", unit: (t && t.unit) || "net premium",
        clock: "one bar a session, " + rows.length + " of them, against a marked zero",
        points: rows.map((r) => ({
          v: isNum(r.p),
          label: String(r.d || DASH),
          rows: [
            { k: "Net premium", v: isNum(r.p) === null ? "not priced" : "$" + compact(r.p),
              cls: isNum(r.p) === null ? "" : r.p > 0 ? "is-pos" : r.p < 0 ? "is-neg" : "" },

            { k: "Source", v: r.source ? String(r.source) : "not stated" },
          ],
        })),
      };
    }

    const p = ok("path");
    const series = p && Array.isArray(p.series) ? p.series : [];
    if (series.length < 2) {
      return { silence: (p && p.reason) ||
        "No intraday tape was published for this name this session." };
    }
    const mins = isNum(p.minutes);
    return {
      kind: "line", unit: (p && p.netPremiumUnit) || "cumulative net premium",
      clock: "one mark a five-minute bucket, " + series.length + " of them across the " +
        "session" + (mins === null ? "" : " (" + mins + " minutes of tape)") +
        " — this axis is intraday, where every other tab here is by session",
      points: series.map((row, i) => {
        const d = isNum(row && row[0]);
        return {
          v: isNum(row && row[1]),
          label: "Bucket " + (i + 1) + " of " + series.length,
          rows: [
            { k: "Net premium", v: isNum(row && row[1]) === null ? "not reported"
              : "$" + compact(row[1]),
              cls: !isNum(row && row[1]) ? "" : row[1] > 0 ? "is-pos" : row[1] < 0 ? "is-neg" : "" },
            { k: "Net delta", v: d === null ? "not reported" : compact(d) + " contracts" },
          ],
        };
      }),
    };
  }

  function paintChart(card) {
    const host = $("ftChart"), body = $("ftChartBody"), sub = $("ftChartS");
    const tabs = $("ftChartTabs");
    if (!host || !body) return;
    body.replaceChildren();
    if (tabs) tabs.replaceChildren();

    for (const key of CHART_TABS) {
      const b = el("button", "ft-chart-tab" + (chartTab === key ? " is-on" : ""),
        CHART_LABEL[key]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", chartTab === key ? "true" : "false");
      b.addEventListener("click", () => {
        if (chartTab === key) return;
        chartTab = key;
        paintChart(card);

        paintPeriod(card);
      });
      if (tabs) tabs.append(b);
    }

    if (tabs && chartTab === "price") {
      const ctl = el("span", "ft-chart-ctl");
      const style = el("button", "ft-chart-tab ft-chart-tab--ctl" +
        (chartStyle === "candles" ? " is-on" : ""), "Candles");
      style.type = "button";
      style.setAttribute("aria-pressed", chartStyle === "candles" ? "true" : "false");
      style.title = "Candles show each session's open, high, low and close; the line shows closes only.";
      style.addEventListener("click", () => {
        chartStyle = chartStyle === "candles" ? "line" : "candles";
        paintChart(card);
      });
      const sma = el("button", "ft-chart-tab ft-chart-tab--ctl ft-chart-tab--sma" +
        (showSma ? " is-on" : ""), "SMA (50)");
      sma.type = "button";
      sma.setAttribute("aria-pressed", showSma ? "true" : "false");
      sma.title = "The 50-session average of closes, as the card publishes it.";
      sma.addEventListener("click", () => { showSma = !showSma; paintChart(card); });
      ctl.append(style, sma);

      (tabs.parentNode || tabs).append(ctl);
    }

    const spec = chartSeries(chartTab, card);

    const per = PERIODS.find((x) => x.key === period) || null;
    let windowed = null;
    if (spec.points && per && chartTab !== "iv") {
      const have = spec.points.length;

      if (chartTab === "netflow") windowed = per.key === "1D" ? have : null;
      else if (per.n <= have) windowed = per.n;
      if (windowed !== null && windowed < have) {
        spec.points = spec.points.slice(have - windowed);
      }
    }

    if (spec.silence) {
      const p = el("p", "ft-chart-dead", spec.silence);
      body.append(p);
      if (sub) sub.textContent = "";
      host.hidden = false;
      return;
    }

    const live = spec.points.filter((pt) => pt.v !== null);
    if (live.length < 2) {
      const have = spec.points.length;
      body.append(el("p", "ft-chart-dead",
        have === 0
          ? "This series carries no points, so there is no shape to draw."
          : live.length === 0
            ? (have === 1
              ? "The one point in this series carries no value, so there is no shape to draw."
              : "None of the " + have + " points in this series carries a value, so there is " +
                "no shape to draw.")
            : (have === 1
              ? "This series holds one point. One reading is a level rather than a shape, so " +
                "nothing is drawn."
              : "Only one of the " + have + " points in this series carries a value. One " +
                "reading is a level rather than a shape, so nothing is drawn.")));
      if (sub) sub.textContent = "";
      host.hidden = false;
      return;
    }

    const hasVol = spec.kind === "candles" && spec.points.some((pt) => pt.vol !== null);
    const W = 620, H = hasVol ? 320 : 260, padL = 8, padR = 46, padT = 12, padB = 22;
    const volH = hasVol ? 56 : 0, volGap = hasVol ? 10 : 0;
    const plotL = padL, plotW = W - padL - padR;
    const plotT = padT, plotH = H - padT - padB - volH - volGap;

    let lo = Infinity, hi = -Infinity;
    for (const pt of live) {
      if (spec.kind === "candles") {

        for (const v of [pt.v, pt.h, pt.l, spec.sma ? pt.sma : null]) {
          if (v === null) continue;
          if (v < lo) lo = v; if (v > hi) hi = v;
        }
      } else {
        if (pt.v < lo) lo = pt.v; if (pt.v > hi) hi = pt.v;
      }
    }

    if (spec.kind === "bars") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (lo === hi) { lo -= 1; hi += 1; }

    const n = spec.points.length;
    const x = (i) => plotL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => plotT + plotH - ((v - lo) / (hi - lo)) * plotH;

    const svg = svgEl("svg", {
      class: "ft-chart-svg", viewBox: "0 0 " + W + " " + H,
      role: "img", tabindex: "0",
      "aria-label": CHART_LABEL[chartTab] + ", " + spec.points.length +
        ftsPlural(spec.points.length, " point", " points"),
    });

    for (const frac of [0, 0.5, 1]) {
      const v = lo + (hi - lo) * frac;
      const yy = y(v);
      svg.append(svgEl("line", { class: "ft-chart-rule",
        x1: plotL, x2: plotL + plotW, y1: yy, y2: yy }));
      const t = svgEl("text", { class: "ft-chart-ax", x: plotL + plotW + 4, y: yy + 3 });
      t.textContent = spec.kind === "bars" || Math.abs(v) >= 1000 ? compact(v) : px2(v);
      svg.append(t);
    }

    if (spec.kind === "bars") {
      const bw = Math.max(1.5, (plotW / n) * 0.62);
      const zero = y(0);
      for (let i = 0; i < n; i++) {
        const pt = spec.points[i];
        if (pt.v === null) continue;
        const yy = y(pt.v);
        svg.append(svgEl("rect", {
          class: "ft-chart-bar " + (pt.tone ? "is-" + pt.tone
            : pt.v > 0 ? "is-pos" : pt.v < 0 ? "is-neg" : "is-flat"),
          x: x(i) - bw / 2, width: bw,
          y: Math.min(yy, zero), height: Math.max(1, Math.abs(yy - zero)),
        }));
      }
      svg.append(svgEl("line", { class: "ft-chart-zero",
        x1: plotL, x2: plotL + plotW, y1: zero, y2: zero }));
    } else if (spec.kind === "candles") {

      const bw = Math.max(1.2, Math.min(9, (plotW / n) * 0.62));
      for (let i = 0; i < n; i++) {
        const pt = spec.points[i];
        if (pt.v === null) continue;
        const cx = x(i);

        const tone = pt.o === null ? "flat" : pt.v > pt.o ? "pos" : pt.v < pt.o ? "neg" : "flat";
        if (pt.h !== null && pt.l !== null) {
          svg.append(svgEl("line", { class: "ft-chart-wick is-" + tone,
            x1: cx, x2: cx, y1: y(pt.h), y2: y(pt.l) }));
        }
        const top = pt.o === null ? y(pt.v) : Math.min(y(pt.o), y(pt.v));
        const bot = pt.o === null ? y(pt.v) : Math.max(y(pt.o), y(pt.v));
        svg.append(svgEl("rect", { class: "ft-chart-body is-" + tone,
          x: cx - bw / 2, width: bw, y: top, height: Math.max(1, bot - top) }));
      }
      if (spec.sma) {
        let d = "", pen = false;
        for (let i = 0; i < n; i++) {
          const m = spec.points[i].sma;
          if (m === null) { pen = false; continue; }
          d += (pen ? "L" : "M") + x(i).toFixed(2) + " " + y(m).toFixed(2) + " ";
          pen = true;
        }
        if (d) svg.append(svgEl("path", { class: "ft-chart-sma", d: d.trim(), fill: "none" }));
      }

      const last = live[live.length - 1];
      const ly = y(last.v);
      svg.append(svgEl("rect", { class: "ft-chart-tag", x: plotL + plotW + 1, y: ly - 7,
        width: padR - 2, height: 14, rx: 3 }));
      const lt = svgEl("text", { class: "ft-chart-tag-t", x: plotL + plotW + padR / 2, y: ly + 3,
        "text-anchor": "middle" });
      lt.textContent = px2(last.v);
      svg.append(lt);
      if (hasVol) {
        let vmax = 0;
        for (const pt of spec.points) if (pt.vol !== null && pt.vol > vmax) vmax = pt.vol;
        const vTop = plotT + plotH + volGap, vBase = vTop + volH;
        for (let i = 0; i < n; i++) {
          const pt = spec.points[i];
          if (pt.vol === null || !(vmax > 0)) continue;
          const tone = pt.o === null || pt.v === null ? "flat"
            : pt.v > pt.o ? "pos" : pt.v < pt.o ? "neg" : "flat";
          const hh = (pt.vol / vmax) * volH;
          svg.append(svgEl("rect", { class: "ft-chart-vol is-" + tone,
            x: x(i) - bw / 2, width: bw, y: vBase - hh, height: Math.max(0.5, hh) }));
        }
        svg.append(svgEl("line", { class: "ft-chart-rule", x1: plotL, x2: plotL + plotW,
          y1: vBase, y2: vBase }));
        const vt = svgEl("text", { class: "ft-chart-ax", x: plotL + plotW + 4, y: vTop + 8 });
        vt.textContent = compact(vmax);
        svg.append(vt);
        const vl = svgEl("text", { class: "ft-chart-ax", x: plotL, y: vTop - 2 });
        vl.textContent = "Volume";
        svg.append(vl);
      }
    } else {

      let d = "", pen = false;
      for (let i = 0; i < n; i++) {
        const pt = spec.points[i];
        if (pt.v === null) { pen = false; continue; }
        d += (pen ? "L" : "M") + x(i).toFixed(2) + " " + y(pt.v).toFixed(2) + " ";
        pen = true;
      }
      svg.append(svgEl("path", { class: "ft-chart-line", d: d.trim(), fill: "none" }));
      if (spec.sma) {
        let m = "", pen2 = false;
        for (let i = 0; i < n; i++) {
          const v = spec.points[i].sma;
          if (v === null || v === undefined) { pen2 = false; continue; }
          m += (pen2 ? "L" : "M") + x(i).toFixed(2) + " " + y(v).toFixed(2) + " ";
          pen2 = true;
        }
        if (m) svg.append(svgEl("path", { class: "ft-chart-sma", d: m.trim(), fill: "none" }));
      }
    }

    const ends = svgEl("text", { class: "ft-chart-ax", x: plotL, y: H - 6 });
    ends.textContent = String(spec.points[0].label || "");
    svg.append(ends);
    const end2 = svgEl("text", {
      class: "ft-chart-ax", x: plotL + plotW, y: H - 6, "text-anchor": "end" });
    end2.textContent = String(spec.points[n - 1].label || "");
    svg.append(end2);

    if (spec.kind === "candles" || (chartTab === "price" && spec.points[n - 1].o !== undefined)) {
      const lastPt = spec.points[n - 1];
      const strip = el("div", "ft-chart-ohlc");
      for (const r of lastPt.rows) {
        const k = el("span", "ft-chart-ohlc-k", r.k === "SMA 50" ? "SMA 50" : r.k.charAt(0));
        const v = el("span", "ft-chart-ohlc-v" + (r.k === "SMA 50" ? " is-sma" : ""), r.v);
        if (r.k === "SMA 50" && !spec.sma) continue;
        strip.append(k, v);
      }
      body.append(strip);
    }

    body.append(svg);

    if (window.FlowsCursor) {
      window.FlowsCursor.attach(svg, {
        name: CHART_LABEL[chartTab] + " series",
        band: { y0: plotT, y1: plotT + plotH },
        points: spec.points.map((pt, i) => ({
          x: x(i),
          label: String(pt.label || ""),
          rows: pt.v === null
            ? [{ k: CHART_LABEL[chartTab], v: "not reported" }]
            : pt.rows,
        })),
      });
    }

    if (sub) {
      sub.textContent = CHART_LABEL[chartTab] + " — " + spec.unit + ". " +
        spec.clock.charAt(0).toUpperCase() + spec.clock.slice(1) + "." +
        (chartTab === "iv"
          ? " The period control does not apply to a curve across the term."
          : windowed !== null
            ? " Windowed to " + period + "."
            : " " + period + " is outside this card's window, so the whole " +
              "series is drawn.");
    }
    host.hidden = false;
  }

  function paintPeriod(card) {
    const host = $("ftPeriod");
    if (!host) return;
    host.replaceChildren();
    const spec = chartSeries(chartTab, card);
    const have = spec && spec.points ? spec.points.length : 0;
    for (const pd of PERIODS) {
      const b = el("button", "ft-period-b" + (period === pd.key ? " is-on" : ""), pd.key);
      b.type = "button";
      let can, why;
      if (chartTab === "iv") {
        can = false;
        why = "The volatility tab is a curve across the TERM, not a history, so a " +
          "period does not apply to it.";
      } else if (chartTab === "netflow") {
        can = pd.key === "1D";
        why = can
          ? "The intraday tape is one session, which is what 1D means here."
          : "The intraday tape is a single session, so it cannot be windowed to " +
            pd.key + ".";
      } else if (!have) {
        can = false;
        why = "This series published no points, so there is nothing to window.";
      } else {
        can = pd.n <= have;
        why = can
          ? "The last " + pd.n + " of the " + have + " points this card carries."
          : "This card carries " + have + " point" + (have === 1 ? "" : "s") + " and " +
            pd.key + " needs " + pd.n + ", so it is outside the published window.";
      }
      b.disabled = !can;
      b.title = why;
      b.setAttribute("aria-pressed", period === pd.key ? "true" : "false");
      b.setAttribute("aria-label", pd.key + ": " + why);
      b.addEventListener("click", () => {
        if (period === pd.key) return;
        period = pd.key;
        paintChart(card);
        paintPeriod(card);
      });
      host.append(b);
    }
  }

  const GARCH_PERIODS = [{ key: "1M", n: 21 }, { key: "3M", n: 63 }, { key: "6M", n: 126 },
    { key: "1Y", n: 252 }];
  let garchPeriod = "3M";

  function paintGarch(card) {
    const host = $("ftGarch"), body = $("ftGarchBody"), sub = $("ftGarchS");
    const tabs = $("ftGarchTabs");
    if (!host || !body) return;
    body.replaceChildren();
    if (tabs) tabs.replaceChildren();
    const c = (card.panels || {}).context;
    const g = c && c.status === "ok" ? c.garch : null;
    if (!g) { host.hidden = true; return; }
    if (g.status !== "ok" || !Array.isArray(g.condVol) || !Array.isArray(g.returns)) {
      body.append(el("p", "ft-chart-dead", "No volatility model was fitted for this name: " +
        String(g.reason || "the fit was not published") + "."));
      if (sub) sub.textContent = "";
      host.hidden = false;
      return;
    }
    const all = g.condVol.map((v, i) => ({
      v: isNum(v), r: isNum(g.returns[i]),
      label: Array.isArray(g.dates) && g.dates[i] ? String(g.dates[i]) : "Session " + (i + 1),
    }));
    const have = all.length;
    for (const pd of GARCH_PERIODS) {
      const b = el("button", "ft-period-b" + (garchPeriod === pd.key ? " is-on" : ""), pd.key);
      b.type = "button";
      const can = pd.n <= have;
      b.disabled = !can;
      b.title = can ? "The last " + pd.n + " of the " + have + " fitted sessions."
        : "The fit covers " + have + " sessions and " + pd.key + " needs " + pd.n + ".";
      b.setAttribute("aria-pressed", garchPeriod === pd.key ? "true" : "false");
      b.addEventListener("click", () => {
        if (garchPeriod === pd.key) return;
        garchPeriod = pd.key;
        paintGarch(card);
      });
      if (tabs) tabs.append(b);
    }
    const per = GARCH_PERIODS.find((x) => x.key === garchPeriod);
    const pts = per && per.n < have ? all.slice(have - per.n) : all;
    const n = pts.length;

    const W = 620, H = 230, padL = 34, padR = 10, padT = 14, padB = 20;
    const retH = 54, gap = 10;
    const plotL = padL, plotW = W - padL - padR;
    const plotT = padT, plotH = H - padT - padB - retH - gap;
    let vhi = 0, rmax = 0;
    for (const pt of pts) {
      if (pt.v !== null && pt.v > vhi) vhi = pt.v;
      if (pt.r !== null && Math.abs(pt.r) > rmax) rmax = Math.abs(pt.r);
    }
    if (!(vhi > 0)) vhi = 1;
    if (!(rmax > 0)) rmax = 1;
    const x = (i) => plotL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => plotT + plotH - (v / vhi) * plotH;
    const svg = svgEl("svg", { class: "ft-chart-svg ft-garch-svg", viewBox: "0 0 " + W + " " + H,
      role: "img", tabindex: "0",
      "aria-label": "Conditional volatility, " + n + " sessions, over the daily returns" });
    for (const frac of [0, 0.5, 1]) {
      const v = vhi * frac, yy = y(v);
      svg.append(svgEl("line", { class: "ft-chart-rule", x1: plotL, x2: plotL + plotW, y1: yy, y2: yy }));
      const t = svgEl("text", { class: "ft-chart-ax", x: plotL - 4, y: yy + 3, "text-anchor": "end" });
      t.textContent = v.toFixed(0) + "%";
      svg.append(t);
    }
    const bw = Math.max(1, Math.min(6, (plotW / n) * 0.6));
    const rTop = plotT + plotH + gap, rMid = rTop + retH / 2;
    for (let i = 0; i < n; i++) {
      const r = pts[i].r;
      if (r === null) continue;
      const hh = (Math.abs(r) / rmax) * (retH / 2);

      svg.append(svgEl("rect", { class: "ft-garch-ret is-" + (r < 0 ? "neg" : r > 0 ? "pos" : "flat"),
        x: x(i) - bw / 2, width: bw, y: r >= 0 ? rMid - hh : rMid, height: Math.max(0.5, hh) }));
    }
    svg.append(svgEl("line", { class: "ft-chart-zero", x1: plotL, x2: plotL + plotW, y1: rMid, y2: rMid }));
    const rl = svgEl("text", { class: "ft-chart-ax", x: plotL - 4, y: rTop + 4, "text-anchor": "end" });
    rl.textContent = "+" + rmax.toFixed(1) + "%";
    svg.append(rl);
    const rl2 = svgEl("text", { class: "ft-chart-ax", x: plotL - 4, y: rTop + retH, "text-anchor": "end" });
    rl2.textContent = "−" + rmax.toFixed(1) + "%";
    svg.append(rl2);
    let d = "", pen = false;
    for (let i = 0; i < n; i++) {
      const v = pts[i].v;
      if (v === null) { pen = false; continue; }
      d += (pen ? "L" : "M") + x(i).toFixed(2) + " " + y(v).toFixed(2) + " ";
      pen = true;
    }
    svg.append(svgEl("path", { class: "ft-chart-line ft-garch-line", d: d.trim(), fill: "none" }));
    const e0 = svgEl("text", { class: "ft-chart-ax", x: plotL, y: H - 6 });
    e0.textContent = pts[0].label;
    svg.append(e0);
    const e1 = svgEl("text", { class: "ft-chart-ax", x: plotL + plotW, y: H - 6, "text-anchor": "end" });
    e1.textContent = pts[n - 1].label;
    svg.append(e1);
    body.append(svg);
    if (window.FlowsCursor) {
      window.FlowsCursor.attach(svg, {
        name: "Conditional volatility",
        band: { y0: plotT, y1: rTop + retH },
        points: pts.map((pt, i) => ({
          x: x(i), label: pt.label,
          rows: [
            { k: "Conditional vol", v: pt.v === null ? "not published" : pt.v.toFixed(1) + "% annualised" },
            { k: "Daily return", v: pt.r === null ? "not published"
              : (pt.r > 0 ? "+" : pt.r < 0 ? "−" : "") + Math.abs(pt.r).toFixed(2) + "%",
              cls: pt.r === null ? "" : pt.r > 0 ? "is-pos" : pt.r < 0 ? "is-neg" : "" },
          ],
        })),
      });
    }
    const legend = el("div", "ft-garch-legend");
    legend.append(el("span", "ft-garch-lg is-vol", "Conditional volatility, annualised"),
      el("span", "ft-garch-lg is-ret", "Daily return"));
    body.append(legend);

    const wrap = el("div", "ft-garch-dist");
    const distH = el("h3", "ft-garch-h3", "Return distribution (GED)");
    wrap.append(distH);
    const row = el("div", "ft-garch-row");
    const DW = 360, DH = 120, dl = 8, dr = 8, dt = 8, db = 16;
    const dplotW = DW - dl - dr, dplotH = DH - dt - db;
    const Z = 4, BINS = 32;
    const counts = new Array(BINS).fill(0);
    let zn = 0;
    for (let i = 0; i < all.length; i++) {
      const v = all[i].v, r = all[i].r;
      if (v === null || r === null || !(v > 0)) continue;
      const z = r / (v / Math.sqrt(252));
      const b = Math.floor(((z + Z) / (2 * Z)) * BINS);
      if (b < 0 || b >= BINS) { zn++; continue; }
      counts[b]++; zn++;
    }
    const binW = (2 * Z) / BINS;
    const dens = counts.map((k) => (zn ? k / (zn * binW) : 0));
    const nu = isNum(g.nu);
    const ged = (z) => {
      if (nu === null) return 0;
      const lg = (t) => {
        if (t < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * t)) - lg(1 - t);
        const cc = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
          771.32342877765313, -176.61502916214059, 12.507343278686905,
          -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
        t -= 1;
        let a = cc[0];
        const tt = t + 7.5;
        for (let i = 1; i < 9; i++) a += cc[i] / (t + i);
        return 0.5 * Math.log(2 * Math.PI) + (t + 0.5) * Math.log(tt) - tt + Math.log(a);
      };
      const lam = Math.sqrt(Math.pow(2, -2 / nu) * Math.exp(lg(1 / nu) - lg(3 / nu)));
      const logC = Math.log(nu) - Math.log(lam) - (1 + 1 / nu) * Math.LN2 - lg(1 / nu);
      return Math.exp(logC - 0.5 * Math.pow(Math.abs(z / lam), nu));
    };
    let dmax = 0;
    for (const v of dens) if (v > dmax) dmax = v;
    for (let z = -Z; z <= Z; z += 0.05) { const v = ged(z); if (v > dmax) dmax = v; }
    if (!(dmax > 0)) dmax = 1;
    const dx = (z) => dl + ((z + Z) / (2 * Z)) * dplotW;
    const dy = (v) => dt + dplotH - (v / dmax) * dplotH;
    const dsvg = svgEl("svg", { class: "ft-chart-svg ft-garch-dsvg", viewBox: "0 0 " + DW + " " + DH,
      role: "img", "aria-label": "Histogram of " + zn + " standardised returns under the fitted GED density" });
    for (let b = 0; b < BINS; b++) {
      if (!counts[b]) continue;
      const z0 = -Z + b * binW;
      dsvg.append(svgEl("rect", { class: "ft-garch-bin", x: dx(z0) + 0.5, width: Math.max(0.5, (dplotW / BINS) - 1),
        y: dy(dens[b]), height: Math.max(0.5, dt + dplotH - dy(dens[b])) }));
    }
    if (nu !== null) {
      let dd = "";
      for (let z = -Z, k = 0; z <= Z + 1e-9; z += 0.05, k++) {
        dd += (k ? "L" : "M") + dx(z).toFixed(2) + " " + dy(ged(z)).toFixed(2) + " ";
      }
      dsvg.append(svgEl("path", { class: "ft-garch-ged", d: dd.trim(), fill: "none" }));
    }
    for (const z of [-4, -2, 0, 2, 4]) {
      const t = svgEl("text", { class: "ft-chart-ax", x: dx(z), y: DH - 4, "text-anchor": "middle" });
      t.textContent = z === 0 ? "0" : (z > 0 ? "+" : "−") + Math.abs(z) + " sd";
      dsvg.append(t);
    }
    row.append(dsvg);
    const table = el("dl", "ft-garch-params");
    const put = (k, v, title) => {
      const dk = el("dt", "", k);
      if (title) dk.title = title;
      table.append(dk, el("dd", "", v));
    };
    const f4 = (v) => (v === null ? DASH : v.toFixed(v < 0.01 ? 6 : 4));
    put("shape (nu)", nu === null ? DASH : nu.toFixed(2),
      "The GED shape: 2 is the normal, below it the tails are heavier.");
    put("omega", f4(isNum(g.omega)), "The constant in the variance recursion, in squared daily percent.");
    put("alpha", f4(isNum(g.alpha)), "How much yesterday's squared shock feeds today's variance.");
    put("beta", f4(isNum(g.beta)), "How much yesterday's variance carries into today's.");
    put("alpha + beta", isNum(g.persistence) === null ? DASH : g.persistence.toFixed(3),
      "Persistence: how slowly a shock decays. Close to 1 is slow.");
    put("long-run vol", isNum(g.longRunVol) === null ? DASH : g.longRunVol.toFixed(1) + "%",
      "The unconditional volatility the parameters imply, annualised.");
    row.append(table);
    wrap.append(row);
    body.append(wrap);

    if (sub) {
      const nn = isNum(g.n);
      const d0 = Array.isArray(g.dates) && g.dates.length ? g.dates[0] : null;
      const d1 = Array.isArray(g.dates) && g.dates.length ? g.dates[g.dates.length - 1] : null;
      sub.textContent = "Fitted by maximum likelihood on " + (nn === null ? "the" : nn) +
        " daily log returns" + (d0 && d1 ? ", " + d0 + " to " + d1 : "") +
        ", demeaned once. The path is the model's conditional standard deviation, annualised; " +
        "the histogram bins each return divided by that day's path, " + zn + " of them, " +
        "under the density the fitted shape implies" +
        (nu === null ? "" : " (2 would be normal; " + nu.toFixed(2) + " is " +
          (nu < 2 ? "heavier-tailed" : nu > 2 ? "thinner-tailed" : "normal") + ")") +
        ". Windowed to " + garchPeriod + "." +
        (g.converged === false ? " The fit did not settle: " + String(g.reason || "") +
          " — the path is what the likelihood found and no more." : "") +
        " No forecast is drawn: this describes the year, not tomorrow.";
    }
    host.hidden = false;
  }

  function paintIvt(card) {
    const host = $("ftIvt"), body = $("ftIvtBody"), sub = $("ftIvtS");
    if (!host || !body) return;
    body.replaceChildren();
    const spec = chartSeries("iv", card);
    if (spec.silence) {
      body.append(el("p", "ft-chart-dead", spec.silence));
      if (sub) sub.textContent = "";
      host.hidden = false;
      return;
    }
    const live = spec.points.filter((pt) => pt.v !== null);
    if (live.length < 2) { host.hidden = true; return; }
    const W = 360, H = 150, padL = 36, padR = 10, padT = 12, padB = 22;
    const plotL = padL, plotW = W - padL - padR, plotT = padT, plotH = H - padT - padB;
    let lo = Infinity, hi = -Infinity;
    for (const pt of live) { if (pt.v < lo) lo = pt.v; if (pt.v > hi) hi = pt.v; }
    if (lo === hi) { lo -= 0.01; hi += 0.01; }
    const n = spec.points.length;
    const x = (i) => plotL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => plotT + plotH - ((v - lo) / (hi - lo)) * plotH;
    const svg = svgEl("svg", { class: "ft-chart-svg", viewBox: "0 0 " + W + " " + H,
      role: "img", tabindex: "0", "aria-label": "Implied volatility by expiry, " + n + " expiries" });
    for (const frac of [0, 0.5, 1]) {
      const v = lo + (hi - lo) * frac, yy = y(v);
      svg.append(svgEl("line", { class: "ft-chart-rule", x1: plotL, x2: plotL + plotW, y1: yy, y2: yy }));
      const t = svgEl("text", { class: "ft-chart-ax", x: plotL - 4, y: yy + 3, "text-anchor": "end" });
      t.textContent = vol1(v);
      svg.append(t);
    }
    let d = "", pen = false;
    for (let i = 0; i < n; i++) {
      const pt = spec.points[i];
      if (pt.v === null) { pen = false; continue; }
      d += (pen ? "L" : "M") + x(i).toFixed(2) + " " + y(pt.v).toFixed(2) + " ";
      pen = true;
    }
    svg.append(svgEl("path", { class: "ft-chart-line", d: d.trim(), fill: "none" }));
    for (let i = 0; i < n; i++) {
      const pt = spec.points[i];
      if (pt.v === null) continue;
      svg.append(svgEl("circle", { class: "ft-ivt-dot", cx: x(i), cy: y(pt.v), r: 3 }));

      const every = Math.max(1, Math.ceil((n - 1) / 5));
      if (i !== 0 && i !== n - 1 && (i % every !== 0 || n - 1 - i < every)) continue;
      const t = svgEl("text", { class: "ft-chart-ax", x: x(i), y: H - 6,
        "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" });
      t.textContent = String(pt.label || "").split(" · ")[0].slice(5);
      svg.append(t);
    }
    body.append(svg);
    if (window.FlowsCursor) {
      window.FlowsCursor.attach(svg, {
        name: "Implied volatility by expiry",
        band: { y0: plotT, y1: plotT + plotH },
        points: spec.points.map((pt, i) => ({ x: x(i), label: String(pt.label || ""),
          rows: pt.v === null ? [{ k: "Implied vol", v: "not published" }] : pt.rows })),
      });
    }
    if (sub) sub.textContent = "Implied volatility — " + spec.unit + ". " +
      spec.clock.charAt(0).toUpperCase() + spec.clock.slice(1) + ".";
    host.hidden = false;
  }

  const CHAIN_ORDER = [
    { key: "k", label: "Strike", how: "by strike, ascending" },
    { key: "vol", label: "Volume", how: "by volume, largest first" },
  ];
  let chainOrder = "k";

  function paintChain(card) {
    const host = $("ftChain"), body = $("ftChainBody"), sub = $("ftChainS");
    const tabs = $("ftChainTabs");
    if (!host || !body) return;
    body.replaceChildren();
    if (tabs) tabs.replaceChildren();

    const panels = card.panels || {};
    const panel = panels.topContracts;
    const rows = panel && panel.status === "ok" && Array.isArray(panel.rows)
      ? panel.rows : [];

    if (!rows.length) { host.hidden = true; return; }

    const lv = panels.levels;
    const spot = lv && lv.status === "ok" ? isNum(lv.spot) : null;

    for (const o of CHAIN_ORDER) {
      const b = el("button", "ft-chain-tab" + (chainOrder === o.key ? " is-on" : ""), o.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", chainOrder === o.key ? "true" : "false");
      b.setAttribute("aria-label", "Order the chain " + o.how);
      b.addEventListener("click", () => {
        if (chainOrder === o.key) return;
        chainOrder = o.key;
        paintChain(card);
      });
      if (tabs) tabs.append(b);
    }

    const calls = [], puts = [];
    let untyped = 0;
    for (const r of rows) {
      if (r.cp === "C") calls.push(r);
      else if (r.cp === "P") puts.push(r);
      else untyped++;
    }

    const order = (list) => list.slice().sort((a, b) => {
      if (chainOrder === "vol") {
        const av = isNum(a.vol), bv = isNum(b.vol);

        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      }
      const ak = isNum(a.k), bk = isNum(b.k);
      if (ak === null && bk === null) return 0;
      if (ak === null) return 1;
      if (bk === null) return -1;
      return ak - bk;
    });

    const COLS = [
      { k: "k", label: "Strike", cls: "c-num ftc-k" },
      { k: "bidPx", label: "Bid", cls: "c-num ftc-bid" },
      { k: "askPx", label: "Ask", cls: "c-num ftc-ask" },
      { k: "vol", label: "Vol", cls: "c-num ftc-vol" },
      { k: "oi", label: "OI", cls: "c-num ftc-oi" },
      { k: "iv", label: "IV", cls: "c-num ftc-iv" },
    ];

    const cellText = (r, key) => {
      if (key === "k" || key === "bidPx" || key === "askPx") return px2(r[key]);
      if (key === "vol" || key === "oi") return compact(r[key]);

      return isNum(r.iv) === null ? DASH : vol1(r.iv);
    };

    const table = el("table", "ftc-table");
    const thead = el("thead");
    const hr = el("tr", "ftc-headrow");
    const corner = el("th", "ftc-side");
    corner.scope = "col";
    corner.append(el("span", "visually-hidden", "Side"));
    hr.append(corner);
    for (const c of COLS) {
      const th = el("th", c.cls, c.label);
      th.scope = "col";
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const nearestOf = (list) => {
      if (spot === null) return null;
      let best = null, bestD = Infinity;
      for (const r of list) {
        const k = isNum(r.k);
        if (k === null) continue;
        const d = Math.abs(k - spot);
        if (d < bestD) { bestD = d; best = r; }
      }
      return best;
    };

    const section = (label, list, cls) => {
      if (!list.length) return;
      const tbody = el("tbody", "ftc-body " + cls);
      const near = nearestOf(list);
      const shown = order(list);
      shown.forEach((r, i) => {
        const tr = el("tr", "ftc-row" + (r === near ? " is-near" : ""));
        if (i === 0) {
          const th = el("th", "ftc-side " + cls, label);
          th.scope = "rowgroup";
          th.rowSpan = shown.length;
          tr.append(th);
        }
        for (const c of COLS) {
          const td = el("td", c.cls, cellText(r, c.k));
          if (c.k === "k" && r.expiry) td.title = "Expires " + r.expiry;
          tr.append(td);
        }
        if (r === near) {
          tr.title = "Nearest the money on the " +
            (cls === "is-call" ? "call" : "put") + " side.";
        }
        tbody.append(tr);
      });
      table.append(tbody);
    };

    section("Calls", calls, "is-call");

    if (spot !== null) {
      const tb = el("tbody", "ftc-spotb");
      const tr = el("tr", "ftc-spot");
      const td = el("td", "ftc-spotc");
      td.colSpan = COLS.length + 1;
      td.append(el("span", "ftc-spot-k", "Spot"));
      td.append(el("span", "ftc-spot-v", px2(spot)));
      tr.append(td);
      tb.append(tr);
      table.append(tb);
    }

    section("Puts", puts, "is-put");
    body.append(table);

    if (sub) {
      const bits = [];
      bits.push("The " + rows.length + " contract" + (rows.length === 1 ? "" : "s") +
        " on this chain that traded today, " +
        (chainOrder === "vol" ? "by volume, largest first" : "by strike, ascending") +
        " within each side");
      bits.push(spot === null
        ? "no spot price resolved this run, so the sides are not ruled against one"
        : "the rule between them is the last price, not a strike boundary: a " +
          "call below it and a put above it are both ordinary");
      if (untyped) {
        bits.push(untyped + " row" + (untyped === 1 ? "" : "s") +
          " carried no parsable option type and " +
          (untyped === 1 ? "is" : "are") + " in neither ladder");
      }

      const total = isNum(panel.total);
      if (total !== null && total > rows.length) {
        bits.push("cut from " + total + " that traded, the largest by volume kept");
      }
      bits.push("no per-contract delta: it needs a rate and a dividend the vendor " +
        "does not send, so the column is absent rather than guessed");

      sub.textContent = bits
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(". ") + ".";
    }
    host.hidden = false;
  }

  function paintMix(card) {
    const host = $("ftMix"), body = $("ftMixBody"), sub = $("ftMixS");
    if (!host || !body) return;
    body.replaceChildren();
    const p = (card.panels || {}).aggressor;
    const bars = p && p.status === "ok" && Array.isArray(p.bars) ? p.bars : [];
    if (!bars.length) { host.hidden = true; return; }

    let calls = 0, puts = 0, missing = 0;
    for (const b of bars) {
      const c = isNum(b && b.calls), q = isNum(b && b.puts);
      if (c !== null) calls += c;
      if (q !== null) puts += q;
      const m = isNum(b && b.volMissing);
      if (m !== null) missing += m;
    }
    const total = calls + puts;
    if (!(total > 0)) { host.hidden = true; return; }

    const R = 54, T = 15, C = 70, TAU = Math.PI * 2;
    const svg = svgEl("svg", {
      class: "ft-mix-svg", viewBox: "0 0 140 140",
      role: "img",
      "aria-label": "Call and put volume, " + compact(calls) + " calls and " +
        compact(puts) + " puts of " + compact(total) + " contracts",
    });

    const circ = TAU * R;
    const ring = (share, cls, offset) => {
      const el2 = svgEl("circle", {
        class: "ft-mix-arc " + cls, cx: C, cy: C, r: R, fill: "none",
        "stroke-width": T,
        "stroke-dasharray": (circ * share).toFixed(2) + " " + (circ * (1 - share)).toFixed(2),
        "stroke-dashoffset": (-circ * offset).toFixed(2),
        transform: "rotate(-90 " + C + " " + C + ")",
      });
      svg.append(el2);
    };
    ring(calls / total, "is-call", 0);
    ring(puts / total, "is-put", calls / total);

    const mid = svgEl("text", { class: "ft-mix-v", x: C, y: C + 2,
      "text-anchor": "middle" });
    mid.textContent = compact(total);
    svg.append(mid);
    const cap = svgEl("text", { class: "ft-mix-c", x: C, y: C + 18,
      "text-anchor": "middle" });
    cap.textContent = "contracts";
    svg.append(cap);
    body.append(svg);

    const legend = el("ul", "ft-mix-l");
    const row = (label, v, cls) => {
      const li = el("li", "ft-mix-i");
      li.append(el("span", "ft-mix-dot " + cls));
      li.append(el("span", "ft-mix-k", label));
      li.append(el("span", "ft-mix-n", compact(v)));
      li.append(el("span", "ft-mix-p", Math.round((v / total) * 100) + "%"));
      legend.append(li);
    };
    row("Calls", calls, "is-call");
    row("Puts", puts, "is-put");
    body.append(legend);

    if (sub) {
      const shown = isNum(p.measuredStrikes);
      const all = isNum(p.total);
      const unrep = isNum(p.strikesUnreported);
      const bits = ["Contracts traded at the " + bars.length + " strike" +
        (bars.length === 1 ? "" : "s") + " this ladder draws" +
        (shown === null || all === null || all <= shown ? ""
          : ", of " + all + " on the chain")];
      if (unrep) {
        bits.push(unrep + " strike" + (unrep === 1 ? "" : "s") +
          " carried no aggressor split and are in neither arc");
      }
      if (missing) {
        bits.push(missing + " contract" + (missing === 1 ? "" : "s") +
          " the vendor reported no volume for are counted in neither");
      }
      bits.push("This is the volume SPLIT, not the net: the ladder beside it " +
        "draws calls lifted minus puts lifted, which is a direction and can be " +
        "zero where thousands traded");
      sub.textContent = bits.join(". ") + ".";
    }
    host.hidden = false;
  }

  function paintLevels(card) {
    const host = $("ftLv"), list = $("ftLvL"), sub = $("ftLvS");
    if (!host || !list) return;
    list.replaceChildren();
    const panels = card.panels || {};
    const p = panels.levels;
    const levels = p && p.status === "ok" && Array.isArray(p.levels) ? p.levels : [];
    if (!levels.length) { host.hidden = true; return; }

    const spot = isNum(p.spot);
    let widest = 0;
    for (const lv of levels) {
      const d = isNum(lv.distPct);
      if (d !== null && Math.abs(d) > widest) widest = Math.abs(d);
    }

    for (const lv of levels) {
      const li = el("li", "ft-lv-i");
      const px = isNum(lv.px);
      const d = isNum(lv.distPct);
      const above = d === null ? null : d > 0 ? true : d < 0 ? false : null;
      li.append(el("span", "ft-lv-px" + (
        above === null ? "" : above ? " is-pos" : " is-neg"), px2(px)));
      li.append(el("span", "ft-lv-k", lv.label || lv.kind || DASH));

      const bar = el("span", "ft-lv-bar");
      bar.setAttribute("aria-hidden", "true");
      if (d !== null && widest > 0) {
        const fill = el("span", "ft-lv-fill" + (
          above === null ? "" : above ? " is-pos" : " is-neg"));
        fill.style.width = Math.max(4, Math.round((Math.abs(d) / widest) * 100)) + "%";
        bar.append(fill);
      }
      li.append(bar);

      const dist = el("span", "ft-lv-d");

      const atr = isNum(lv.distAtr);
      dist.textContent = d === null ? DASH
        : neg((d * 100).toFixed(1)) + "%" + (atr === null ? "" : " · " +
          neg(Math.abs(atr).toFixed(2)) + " ATR");
      li.append(dist);

      li.title = (lv.label || lv.kind || "This level") +
        (px === null ? "" : " at " + px.toFixed(2)) +
        (spot === null || d === null ? "" :
          ", " + Math.abs(d * 100).toFixed(1) + "% " +
          (above ? "above" : "below") + " spot " + spot.toFixed(2)) +
        (atr === null ? ". ATR did not resolve this run, so there is no sigma distance."
          : ", " + Math.abs(atr).toFixed(2) + " ATR away.");
      list.append(li);
    }

    if (sub) {
      sub.textContent = levels.length + " level" + (levels.length === 1 ? "" : "s") +
        " resolved this run, nearest first" +
        (spot === null ? "" : ", against spot " + spot.toFixed(2)) +
        ". The bar is each level's distance as a share of the furthest drawn here, " +
        "not a probability.";
    }
    host.hidden = false;
  }

  function paintFlow(ticker, feed) {
    const host = $("ftFlow"), list = $("ftFlowL"), sub = $("ftFlowS");
    if (!host || !list) return;
    list.replaceChildren();

    if (!feed || typeof feed !== "object") {
      if (sub) {
        sub.textContent = "The vendor's flow alerts could not be read just now, so this " +
          "card cannot say whether any were raised on " + ticker + ". That is a failed " +
          "read, not a quiet name.";
      }
      host.hidden = false;
      return;
    }
    if (feed.status === "pending") {
      if (sub) {
        sub.textContent = "No flow-alert feed has been published yet this session, so " +
          "there is nothing to filter for " + ticker + " — nothing here is a reading " +
          "about the name.";
      }
      host.hidden = false;
      return;
    }

    const all = Array.isArray(feed.rows) ? feed.rows : [];
    const mine = all.filter((r) => r && String(r.t || "").toUpperCase() === ticker);

    const timed = mine.slice().sort((a, b) => {
      const at = a.spanStart ? Date.parse(a.spanStart) : NaN;
      const bt = b.spanStart ? Date.parse(b.spanStart) : NaN;
      const aok = Number.isFinite(at), bok = Number.isFinite(bt);
      if (!aok && !bok) return 0;
      if (!aok) return 1;
      if (!bok) return -1;
      return bt - at;
    });

    const CAP = 6;
    const shown = timed.slice(0, CAP);

    const clock = (iso) => {
      if (!iso) return DASH;
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return DASH;
      try {
        return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch (_) { return DASH; }
    };

    for (const r of shown) {
      const li = el("li", "ft-flow-i");
      li.append(el("span", "ft-flow-t", clock(r.spanStart)));

      const k = isNum(r.k);
      const side = r.cp === "C" ? "C" : r.cp === "P" ? "P" : "";
      const oc = el("span", "ft-flow-c" + (
        side === "C" ? " is-call" : side === "P" ? " is-put" : ""));
      oc.textContent = k === null || !side ? DASH : px2(k) + side;
      if (r.exp) oc.title = "Expires " + r.exp;
      li.append(oc);

      li.append(el("span", "ft-flow-z", compact(r.size)));

      const prem = el("span", "ft-flow-p");
      prem.textContent = isNum(r.prem) === null ? DASH : "$" + compact(r.prem);
      li.append(prem);

      if (r.sweep === true) {
        const s = el("span", "ft-flow-w", "SWEEP");
        s.title = "The vendor flagged this window as a sweep.";
        li.append(s);
      }

      const trades = isNum(r.trades);
      li.title = (k === null || !side ? "This alert" : px2(k) + side) +
        (r.exp ? " expiring " + r.exp : "") +
        (trades === null
          ? ", a window the vendor did not count executions for"
          : ", " + trades + " execution" + (trades === 1 ? "" : "s") + " aggregated") +
        (r.rule ? ", flagged by the vendor's " + r.rule + " rule." : ".");
      list.append(li);
    }

    if (sub) {
      const cap = isNum(feed.cap);
      const seen = isNum(feed.seen);
      const pool = "the " + all.length + " row" + (all.length === 1 ? "" : "s") +
        " this run kept" +
        (cap === null ? "" : " of a " + cap + "-row cap") +
        (seen === null || seen <= all.length ? "" : ", cut from " + seen + " read");
      if (!mine.length) {

        sub.textContent = "The vendor's rules flagged nothing on " + ticker + " in " +
          pool + ". The rules are the vendor's own and are not published, so this is " +
          "what its screens chose to raise — not a measurement of how much traded in " +
          "this name.";
      } else {
        sub.textContent = "Newest first" +
          (mine.length > CAP ? ", the " + CAP + " newest of " + mine.length : "") +
          ". Each row is one ALERT — a window of activity in one contract that a vendor " +
          "rule flagged, aggregating its executions — never a single trade. Selected " +
          "from " + pool + " by the vendor's own rules, which are not published.";
      }
    }
    host.hidden = false;
  }

  function paintRelated(card) {
    const host = $("ftRel"), list = $("ftRelL"), sub = $("ftRelS");
    if (!host || !list) return;
    list.replaceChildren();
    const mine = typeof card.sector === "string" && card.sector.trim()
      ? card.sector.trim() : null;
    const rows = mine && switchRows
      ? switchRows.filter((r) => r.sector === mine && r.t !== card.ticker)
      : [];

    const ranked = rows.slice().sort((a, b) => {
      const x = isNum(a.s), y = isNum(b.s);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return Math.abs(y) - Math.abs(x);
    });
    const CAP = 8;
    for (const r of ranked.slice(0, CAP)) {
      const sc = isNum(r.s);
      const chip = el(r.card === false ? "span" : "a",
        "ft-rel-c" + (sc === null ? "" : " " + P.polarity(sc)));
      if (r.card !== false) chip.href = "/flows/ticker/?t=" + encodeURIComponent(r.t);
      chip.append(el("span", "ft-rel-t", r.t));
      chip.append(el("span", "ft-rel-v", sc === null ? DASH : P.signed(sc, (a) => String(a))));
      chip.title = (r.card === false ? r.t + " was ranked but has no card, so there is nothing to open. " : "")
        + (sc === null ? "No score published for this name." : "Options score " + P.signed(sc, (a) => String(a)) + ".")
        + (r.chg === null ? "" : " Session move " + P.pct1(r.chg) + ".");
      list.append(chip);
    }

    if (mine && switchRows === null) {
      const b = el("button", "ft-rel-load", "Show sector peers");
      b.type = "button";
      b.title = "Reads today's two boards — an index of every name this run ranked — " +
        "to find the others in " + mine + ".";
      b.addEventListener("click", () => {
        b.disabled = true;
        b.textContent = "Reading today\u2019s boards\u2026";
        ensureBoards().then(() => paintRelated(card));
      });
      list.append(b);
    }
    if (sub) {
      sub.textContent = !mine
        ? "This card publishes no sector, so no peer set can be drawn."
        : switchRows === null

          ? "The other names in " + mine + " are on today's boards, which are two " +
            "requests about names other than this one. They are not read unless " +
            "you ask for them."
        : boardsWhy === "unreadable"
          ? "Today's boards did not come back, so the other " + mine +
            " names cannot be named. That is this page's failure to read them, " +
            "not a quiet sector."
        : boardsWhy === "pending"
          ? "Today's boards have not been published yet, so there is nothing to " +
            "compare this name against."
        : boardsWhy
          ? "Today's boards were read and carried no rows at all, so no " + mine +
            " peer can be named."
        : ranked.length
          ? (ranked.length > CAP ? CAP + " of " + ranked.length : String(ranked.length)) +
            " other " + mine + " name" + (ranked.length === 1 ? "" : "s") +
            " on today's boards, by score. Ranked together, not modelled together."
          : "No other " + mine + " name was ranked on today's boards.";
    }
    host.hidden = !mine;
  }

  function paintFlags(card, chg) {
    const host = $("ftFlags");
    if (!host) return;
    host.replaceChildren();

    const marks = [];
    const score = isNum(card.score);
    const conv = isNum(card.conviction);

    const sd = sideOf(card, chg);
    if (sd.word && score !== null) {
      marks.push([sd.word === "bullish" ? "Bullish flow" : "Bearish flow",
        sd.word === "bullish" ? "is-pos" : "is-neg", sd.title]);
    }

    const d1 = chg && chg.status === "ok" ? chg.d1 : null;
    const move = d1 ? isNum(d1.v) : null;
    if (move !== null && isNum(d1.gap) !== null && chg.stale === 0 && Math.abs(move) >= 10) {

      marks.push([move > 0 ? "Score up" : move < 0 ? "Score down" : "Score flat",
        P.polarity(move),
        P.signed(move, (a) => String(a)) + " score points over " +
        d1.gap + (d1.gap === 1 ? " session" : " sessions") +
        ", against a threshold of 10."]);
    }

    if (conv !== null && conv >= 70) {
      marks.push(["High conviction", "",
        "Conviction " + Math.round(conv) + ", against a threshold of 70. Conviction is " +
        "how strongly the components agree, not how large the move is."]);
    }

    const top = card.panels && card.panels.topContracts;
    const rows = top && top.status === "ok" && Array.isArray(top.rows) ? top.rows.length : 0;
    if (rows >= 10) {
      marks.push(["Unusual activity", "",
        rows + " contract lines carried enough volume to make this name's tape panel, " +
        "against a threshold of 10."]);
    }

    for (const [label, cls, why] of marks) {
      const chip = el("span", "ft-flag" + (cls ? " " + cls : ""), label);
      chip.title = why;
      host.append(chip);
    }
    host.hidden = !marks.length;
  }

  function paintIdentity(card, chg) {
    if (!headEl) return;
    const score = isNum(card.score);
    const spot = spotOf(card);
    const ctx = card.panels && card.panels.context;
    const chgPct = ctx && ctx.status === "ok" ? isNum(ctx.changePct) : null;

    const price = idChip("ftPrice", "", spot === null ? DASH : "$" + spot.v.toFixed(2), {
      empty: spot === null ? "unavailable" : null,
      title: spot === null
        ? "No panel on this card published a spot price: levels, priced move and gamma " +
          "are all unavailable for this name today."
        : "Spot as the " + spot.from + " panel resolved it, for the session of " +
          fmtDate(card.sessionDate) + ".",
    });
    const day = idChip("ftChgPct", "", chgPct === null ? DASH : P.pct1(chgPct), {
      cls: P.polarity(chgPct),
      empty: chgPct === null ? "unavailable" : null,
      title: chgPct === null
        ? "The price context panel published no session change for this name, so the " +
          "day's move is not stated rather than stated as flat."
        : "Change against the previous close, from the price context panel.",
    });

    const levelsPanel = card.panels && card.panels.levels;
    const flipLevel = levelsPanel && levelsPanel.status === "ok" &&
      Array.isArray(levelsPanel.levels)
      ? levelsPanel.levels.find((l) => l && l.kind === "gamma_flip") || null
      : null;
    const flipPct = flipLevel ? isNum(flipLevel.distPct) : null;
    const flipAtr = flipLevel ? isNum(flipLevel.distAtr) : null;
    const regime = card.regime || null;
    const bandLo = regime ? isNum(regime.bandMin) : null;
    const bandHi = regime ? isNum(regime.bandMax) : null;
    const bandSaid = bandLo !== null && bandHi !== null
      ? " The ladder was read over $" + bandLo.toFixed(2) + " to $" + bandHi.toFixed(2) +
        ", so this is the nearest sign change inside that window rather than in the whole book."
      : "";

    let flipNode;
    if (flipPct === null) {

      flipNode = idChip("ftFlip", "", DASH, {
        empty: "unavailable",
        title: levelsPanel && levelsPanel.status === "ok"
          ? "No gamma flip resolved on this name's ladder, so there is no distance to " +
            "one. That is not a distance of zero — a book with no sign change over the " +
            "strikes read has no flip to be near." + bandSaid
          : "The levels panel is unavailable for this name today, so the distance to the " +
            "gamma flip was not measured." + bandSaid,
      });
    } else {

      const atrSaid = flipAtr === null
        ? ""
        : " (" + P.signed(flipAtr, (a) => a.toFixed(2)) + " ATR)";

      const whereSaid = flipPct > 0 ? "above spot"
        : flipPct < 0 ? "below spot"
        : "exactly at spot — the name is sitting on its flip";
      flipNode = idChip("ftFlip", "", P.pct1(flipPct) + " to flip" + atrSaid, {
        cls: flipPct >= 0 ? "is-above" : "is-below",
        title: "Gamma flip at $" + flipLevel.px.toFixed(2) + ", " + whereSaid +
          ". Past it the sign of dealer " +
          "hedging reverses: the flow that has been damping moves starts amplifying " +
          "them." + (flipAtr === null
            ? " No ATR was published for this name, so the distance is stated in percent only."
            : " The second figure is that distance in this name's own average true range.") +
          bandSaid,
      });
    }

    const { text: sideText, cls: sideCls, empty: sideEmpty, title: sideTitle } =
      sideOf(card, chg);
    const side = idChip("ftSide", "", sideText,
      { cls: sideCls, empty: sideEmpty, title: sideTitle });

    let d1Node = null;
    if (chg && chg.status === "ok" && chg.d1) {

      d1Node = idChip("ftD1", "", P.signed(chg.d1.v, (a) => String(a)) + POINTS(chg.d1.v) +
        " over " + SESSIONS(chg.d1.gap), {
        cls: P.polarity(chg.d1.v),
        title: "Score points against the " + chg.d1.from + " session, the previous one " +
          "that scored this name, " + SESSIONS(chg.d1.gap) + " back in this card's " +
          "window. Full working in the change block below.",
      });
    } else if ($("ftD1")) {
      $("ftD1").remove();
    }

    const anchor = $("ftConv") || $("ftSwitch");
    for (const node of [price, day, side, d1Node, flipNode]) {
      if (!node) continue;
      if (anchor) headEl.insertBefore(node, anchor);
      else headEl.append(node);
    }
    paintRank();
  }

  function paintRank() {
    if (!headEl || !painted || !switchRows || !switchRows.length) return;
    const me = switchRows.find((r) => r.t === painted.ticker);
    if (!me || isNum(me.r) === null || isNum(me.of) === null) return;

    const chip = idChip("ftRank", "rank", me.r + " of " + me.of, {
      title: "Rank on today's " + (me.side === "short" ? "short" : "long") + " board, read " +
        "from the board payload the name switcher fetched. It is not published on this card.",
    });
    const anchor = $("ftConv") || $("ftSwitch");
    if (anchor) headEl.insertBefore(chip, anchor);
    else headEl.append(chip);
  }

  const SESSIONS = (n) => n + (n === 1 ? " session" : " sessions");

  const POINTS = (n) => (Math.abs(n) === 1 ? " score point" : " score points");

  const NAMES = (n) => n + (n === 1 ? " name" : " names");

  const CROSSING = {
    cleared: "Cleared the dead band — this name became actionable this session.",
    faded: "Faded into the dead band — the exit signal.",
    flipped: "Flipped sign — outside the band at both ends, on opposite sides.",
  };

  function paintChange(card) {
    const chg = P.changeFrom(card.panels && card.panels.scoreOverlay);
    if (!changeEl) return chg;
    changeEl.replaceChildren();
    changeEl.hidden = false;
    const h = el("h2", null, "What changed");
    h.id = "ftChangeH";
    changeEl.append(h);

    if (chg.status !== "ok") {

      const quiet = chg.status === "quiet";
      const p = el("p", quiet ? "fc-quiet" : "fc-dead");
      p.setAttribute("data-empty", quiet ? "quiet" : "unavailable");
      p.append(el("strong", null, quiet ? "Nothing to report \u2014 " : "Unavailable \u2014 "));
      p.append(document.createTextNode(chg.reason + "."));
      changeEl.append(p);
      return chg;
    }

    if (chg.stale > 0) {
      changeEl.append(el("p", "ft-chg-stale",
        "This reading is " + SESSIONS(chg.stale) + " old: the newest session in the joined " +
        "window is " + chg.window.to + " and it carries no score for this name. The newest " +
        "score below is " + chg.at.d + "."));
    }

    if (chg.cross) {
      changeEl.append(el("p", "ft-chg-e", CROSSING[chg.cross]));
    } else if (chg.crossKnown) {
      const tag = el("p", "ft-chg-e is-quiet", chg.inside
        ? "No crossing — inside the dead band at both ends."
        : "No crossing — outside the dead band at both ends, on the same side.");
      tag.setAttribute("data-empty", "quiet");
      changeEl.append(tag);
    } else {
      const tag = el("p", "ft-chg-e is-quiet", chg.band === null
        ? "No dead band was published on this card, so whether this move crossed one " +
          "cannot be stated — it is unknown, not absent."
        : "Only one session in this window carries a score for this name, so there is no " +
          "crossing to state.");
      tag.setAttribute("data-empty", chg.band === null ? "unavailable" : "quiet");
      changeEl.append(tag);
    }

    const mv = chg.d1 ? isNum(chg.d1.v) : null;
    const verdict = (() => {
      if (mv === null) return null;
      if (chg.cross === "cleared") return ["Cleared the band", "\u2191", "is-pos"];
      if (chg.cross === "faded") return ["Faded out of the band", "\u2193", "is-neg"];
      if (chg.cross === "flipped") {
        if (mv > 0) return ["Flipped bullish", "\u2191", "is-pos"];
        if (mv < 0) return ["Flipped bearish", "\u2193", "is-neg"];

        return ["Flipped", "\u2192", "is-flat"];
      }
      if (mv > 0) return ["Bullish drift", "\u2191", "is-pos"];
      if (mv < 0) return ["Bearish drift", "\u2193", "is-neg"];
      return ["Unchanged", "\u2192", "is-flat"];
    })();
    if (verdict) {
      const [word, glyph, cls] = verdict;
      const head = el("div", "ft-chg-verdict " + cls);
      const mark = el("span", "ft-chg-mark", glyph);
      mark.setAttribute("aria-hidden", "true");
      head.append(mark);
      head.append(el("span", "ft-chg-word", word));
      changeEl.append(head);
    }

    const lead = el("p", "ft-chg-lead");
    if (chg.d1) {
      lead.append(el("span", "ft-chg-v " + P.polarity(chg.d1.v),
        P.signed(chg.d1.v, (a) => String(a))));
      lead.append(document.createTextNode(
        (chg.d1.v === 0
          ? POINTS(chg.d1.v).trim() + " — unchanged since "
          : POINTS(chg.d1.v).trim() + " since ") +
        chg.d1.from + ", " + SESSIONS(chg.d1.gap) + " earlier" +
        (chg.d1.gap === 1
          ? ". "
          : " — this name carries no score for the " + SESSIONS(chg.d1.gap - 1) +
            " in between, so the move is not an overnight one. ") +
        "It stands at " + P.signed(chg.at.score, (a) => String(a)) + " on " + chg.at.d + "."));
    } else {
      lead.append(el("span", "ft-chg-v " + P.polarity(chg.at.score),
        P.signed(chg.at.score, (a) => String(a))));
      lead.append(document.createTextNode(
        POINTS(chg.at.score).trim() + " on " + chg.at.d +
        ". No earlier session in this window carries a score " +
        "for this name, so there is no move to state — which is not a move of zero."));
    }
    changeEl.append(lead);

    changeEl.append(P.statList([
      ["Move", chg.d1 === null ? DASH
        : P.signed(chg.d1.v, (a) => String(a)) + POINTS(chg.d1.v),
      chg.d1 === null ? "is-null" : P.polarity(chg.d1.v)],
      ["Sessions apart", chg.d1 === null ? DASH : String(chg.d1.gap)],
      ["Now", P.signed(chg.at.score, (a) => String(a)) + POINTS(chg.at.score),
        P.polarity(chg.at.score)],
      ["Run", chg.run === 0 ? "0 — at neutral"
        : (chg.runCapped ? "≥ " : "") + SESSIONS(chg.run)],

      ["Window high", P.signed(chg.ext.hi, (a) => String(a)) + POINTS(chg.ext.hi) +
        " on " + chg.ext.hiAt, P.polarity(chg.ext.hi)],
      ["Window low", P.signed(chg.ext.lo, (a) => String(a)) + POINTS(chg.ext.lo) +
        " on " + chg.ext.loAt, P.polarity(chg.ext.lo)],
      ["Dead band", chg.band === null ? DASH : "±" + chg.band + POINTS(chg.band)],
    ]));

    let runText;
    if (chg.run === 0) {
      runText = "The newest score is exactly zero — the centre of the dead band, which " +
        "is a reading this pipeline assigns and not an absence.";
    } else {
      const runSide = chg.at.score < 0 ? "bearish" : chg.at.score > 0 ? "bullish" : "neutral";
      runText = (chg.runCapped ? "At least " : "") + chg.run +
        (chg.run === 1 ? " scored session" : " consecutive scored sessions") +
        " on the " + runSide + " side" +
        (chg.runCapped
          ? ", which is as far back as this card's own window reaches — the run may be older."
          : chg.runBroken
            ? ", counted back to a session this name carries no score for. The run is not " +
              "stepped over that gap: continuity nobody measured is not continuity."
            : ".");
    }
    changeEl.append(el("p", "fc-note", runText));

    changeEl.append(el("p", "fc-note",
      "Derived from the " + SESSIONS(chg.window.sessions) + " between " + chg.window.from +
      " and " + chg.window.to + " that this card's price window shares with the score " +
      "archive, " + chg.window.scored + " of which carry a score for this name. Every " +
      "session count above counts THOSE sessions."));

    return chg;
  }

  function installWorkspace() {
    buildBar();
    mountChrome();
    installStations();
    watchGroups();
    window.addEventListener("hashchange", honourHash);
  }

  async function paint(card) {
    painted = card;

    drawnStations.clear();
    if (headEl) headEl.hidden = false;
    if (barEl) barEl.hidden = false;
    grid.hidden = false;
    if (picker) picker.hidden = true;

    $("ftTicker").textContent = card.ticker || DASH;
    const score = isNum(card.score);
    const badge = $("ftScore");
    badge.textContent = score === null ? DASH
      : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    badge.className = "fc-score " +
      (score === null ? "" : score < 0 ? "is-neg" : score > 0 ? "is-pos" : "is-flat");

    const chg = paintChange(card);

    paintHero(card, chg);
    paintCards(card);

    paintChart(card);
    paintPeriod(card);
    paintGarch(card);
    paintIvt(card);
    paintChain(card);
    paintMix(card);
    paintBrief(card);
    paintLevels(card);
    paintFlags(card, chg);

    paintRelated(card);
    paintIdentity(card, chg);

    applyStation({ url: true, push: false });
    await drawStation(card, "grid");
    setStale(assessAge(card));

    syncBarHeight();

    honourHash();

    statusEl.textContent = "";
    if (footEl) {
      footEl.textContent =
        "Every number here is read off the card payload the pipeline published " +
        "for " + fmtDate(card.sessionDate) + ". No vendor call is made by this page.";
    }
  }

  let switchRows = null;
  let boardsAsked = null;
  let boardsWhy = null;

  function ensureBoards() {
    if (boardsAsked) return boardsAsked;
    boardsAsked = Promise.all([
      getJSON("/api/flows/board?side=long").catch(() => null),
      getJSON("/api/flows/board?side=short").catch(() => null),
    ]).then(([long, short]) => {
      switchRows = boardRows(long, short);

      const side = (p) => {
        if (!p || typeof p !== "object") return "unreadable";
        if (p.status && p.status !== "ok") return p.status;
        return Array.isArray(p.rows) ? "ok" : "unavailable";
      };
      const states = [side(long), side(short)];
      boardsWhy = states.includes("ok") ? null
        : states.includes("unreadable") ? "unreadable"
        : states.includes("pending") ? "pending"
        : states[0];

      const bs = (p) => (p && ISO_DAY.test(String(p.sessionDate || "")) ? String(p.sessionDate) : null);
      boardSession = bs(long) || bs(short);
      paintRank();
      if (painted) paintRelated(painted);

      if (painted) setStale(assessAge(painted));
      return switchRows;
    });
    return boardsAsked;
  }

  const NEURON_CLAMP = 32;
  let neuronState = null;

  function paintNeuron(res) {
    const host = $("ftNeuron"), head = $("ftNeuronH"), say = $("ftNeuronSay"), src = $("ftNeuronSrc");
    if (!host || !head || !say || !src) return;
    const r = res && typeof res === "object" ? res : null;
    const status = r && typeof r.status === "string" ? r.status : "unavailable";
    const text = r && typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : "";
    const mark = host.querySelector(".ak-nn");
    host.hidden = false;
    host.classList.toggle("is-pending", status !== "ok");
    host.classList.toggle("is-llm", status === "ok" && r.llm === true);
    if (mark) mark.classList.toggle("is-live", status === "pending" || (status === "ok" && r.llm === true));

    head.replaceChildren(document.createTextNode("Neuron"));
    if (status === "ok" && typeof r.generatedAt === "string" && r.generatedAt.length >= 16) {
      const when = el("span", "ak-neuron-when");
      when.append(document.createTextNode(" \u00b7 written "));
      const time = document.createElement("time");
      time.dateTime = r.generatedAt;
      time.textContent = r.generatedAt.slice(11, 16) + " UTC";
      when.append(time);
      head.append(when);
    }

    if (status === "ok" && text) {
      if (neuronState === "ok:" + text) return;
      say.replaceChildren();
      say.removeAttribute("data-empty");
      const words = text.split(/\s+/).filter(Boolean);
      words.forEach((w, wi) => {
        if (wi) say.append(" ");
        const sp = el("span", "ak-w", w);
        sp.style.setProperty("--d", String(Math.min(wi, NEURON_CLAMP)));
        say.append(sp);
      });
      const caret = el("span", "ak-caret");
      caret.style.setProperty("--d", String(Math.min(words.length, NEURON_CLAMP) + 1));
      caret.setAttribute("aria-hidden", "true");
      say.append(caret);
      say.setAttribute("aria-label", text);
      src.textContent = typeof r.provenance === "string" && r.provenance
        ? r.provenance
        : (r.llm ? "Wording by a language model; figures measured by the pipeline."
          : "Deterministic reading. No model was asked.");
      neuronState = "ok:" + text;
      return;
    }

    const note = r && typeof r.note === "string" && r.note ? r.note : null;
    const said = status === "pending"
      ? (note || "Neuron is writing this name\u2019s summary now.")
      : status === "quiet"
        ? (note || "This card carries no reading a summary could be written over.")
        : status === "unreadable"
          ? (note || "The card was published and could not be read.")
          : "No summary could be read for this name.";
    if (neuronState === status + ":" + said) return;
    say.replaceChildren(document.createTextNode(said));
    say.removeAttribute("aria-label");
    say.setAttribute("data-empty", status === "pending" ? "pending"
      : status === "quiet" ? "quiet" : status === "unreadable" ? "unreadable" : "unavailable");
    src.textContent = status === "pending"
      ? "Not published yet \u2014 not a quiet name. Nothing here is claimed about it."
      : "Nothing here is claimed about the name.";
    neuronState = status + ":" + said;
  }

  function fetchNeuron(ticker) {
    if (!ticker) return Promise.resolve();
    return getJSON("/api/flows/summary?t=" + encodeURIComponent(ticker))
      .then((res) => paintNeuron(res))
      .catch(() => paintNeuron({ status: "unavailable" }));
  }

  let lastLive = null;
  let liveTimer = null;
  let liveTicks = 0;
  let liveTicker = null;

  function fmtClock(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    const two = (n) => String(n).padStart(2, "0");
    return two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + ":" + two(d.getUTCSeconds()) + " UTC";
  }

  function applyLive() {
    const badge = $("ftHeroLive");
    const px = $("ftHeroPx"), chgEl = $("ftHeroChg");
    const bar = $("ftPrice"), barChg = $("ftChgPct");
    const live = lastLive;
    if (!badge) return;
    badge.hidden = false;
    if (!live || live.status !== "ok" || isNum(live.price) === null) {
      badge.classList.remove("is-on");
      badge.setAttribute("data-empty", "unavailable");
      badge.textContent = live && live.status === "quiet"
        ? "live read empty \u00b7 session close"
        : "not live \u00b7 session close";
      badge.title = "The vendor\u2019s live quote could not be read on the last attempt, so the " +
        "price shown is the session close the card published. The page keeps trying every " +
        "five seconds.";
      return;
    }
    const price = isNum(live.price);
    const pct = isNum(live.changePct);
    const tick = (node, text) => {
      if (!node) return;
      if (node.textContent !== text) {
        node.textContent = text;
        node.classList.remove("is-ticked");
        void node.offsetWidth;
        node.classList.add("is-ticked");
      }
    };
    if (px) {
      tick(px, "$" + price.toFixed(2));
      px.removeAttribute("data-empty");
      px.title = "Last price from the vendor\u2019s live quote, read " + fmtClock(live.readAt) +
        (live.tapeTime ? "; tape time " + String(live.tapeTime) : "") + ".";
    }
    if (chgEl) {
      chgEl.textContent = pct === null ? "" : P.pct1(pct);
      chgEl.className = "ft-hero-chg" + P.polarity(pct);
      chgEl.hidden = pct === null;
      chgEl.title = pct === null
        ? "The live quote carried no previous close, so no day change is stated."
        : "Change against the previous close carried by the live quote.";
    }
    if (bar) {
      const b = bar.querySelector("b");
      if (b) tick(b, "$" + price.toFixed(2));
      bar.removeAttribute("data-empty");
      bar.title = "Last price from the vendor\u2019s live quote, read " + fmtClock(live.readAt) + ".";
    }
    if (barChg && pct !== null) {
      const b = barChg.querySelector("b");
      if (b) b.textContent = P.pct1(pct);
      barChg.className = "fc-meta ft-id" + P.polarity(pct);
      barChg.removeAttribute("data-empty");
      barChg.title = "Change against the previous close carried by the live quote.";
    }
    badge.classList.add("is-on");
    badge.removeAttribute("data-empty");
    badge.textContent = "live \u00b7 " + fmtClock(live.readAt);
    badge.title = "Re-read from the vendor every five seconds while this page is visible. " +
      "Every other reading on this page is the session\u2019s, as the card published it.";
  }

  function fetchLive(ticker) {
    return getJSON("/api/flows/live?t=" + encodeURIComponent(ticker))
      .then((live) => {
        lastLive = live && typeof live === "object" && typeof live.status === "string"
          ? live : { status: "unavailable" };
      })
      .catch(() => { lastLive = { status: "unavailable" }; })
      .then(applyLive);
  }

  function refreshCard(ticker) {
    return getJSON("/api/flows/card?t=" + encodeURIComponent(ticker)).then((card) => {
      if (!card || card.status === "pending" || !card.panels) return;
      const was = painted && painted.__updatedAt ? painted.__updatedAt : null;
      const now = card.__updatedAt || null;
      if (was !== null && now !== null && now <= was) return;
      if (was === null && now === null) return;
      return paint(card).then(() => { neuronState = null; return fetchNeuron(ticker); });
    }).catch(() => {});
  }

  function liveTick() {
    if (document.hidden || !liveTicker) return;
    liveTicks++;
    const t = liveTicker;
    fetchLive(t);
    if (neuronState === null || !neuronState.startsWith("ok:") || liveTicks % 12 === 0) fetchNeuron(t);
    if (liveTicks % 6 === 0) {
      getJSON("/api/flows/flowalerts").then((feed) => paintFlow(t, feed)).catch(() => {});
    }
    if (liveTicks % 12 === 0) refreshCard(t);
  }

  function startLive(ticker) {
    liveTicker = ticker || null;
    if (liveTimer !== null) { clearInterval(liveTimer); liveTimer = null; }
    if (!liveTicker) return;
    liveTicks = 0;
    fetchLive(liveTicker);
    fetchNeuron(liveTicker);
    liveTimer = setInterval(liveTick, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) liveTick(); });
  }

  function boardsWhenIdle(ticker) {
    const go = () => {
      if (!ticker) return;
      getJSON("/api/flows/flowalerts")
        .then((feed) => paintFlow(ticker, feed))
        .catch(() => paintFlow(ticker, null));

      getJSON("/api/flows/meta")
        .then((m) => {
          if (!m || !ISO_DAY.test(String(m.sessionDate || ""))) return;
          boardSession = String(m.sessionDate);
          if (painted) setStale(assessAge(painted));
        })
        .catch(() => {   });
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1200);
  }

  function wireSwitch(card) {
    const btn = document.getElementById("ftSwitch");
    if (!btn) return;
    btn.hidden = false;
    btn.onclick = async () => {
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Loading names…";
      try {
        await ensureBoards();
        const shown = carded(switchRows);
        if (!shown.length) {

          btn.textContent = switchRows.length
            ? "No other name has a card today"
            : "No board to switch to";
          return;
        }
        showPicker(shown,
          pickerNote(switchRows, shown,
            "You are on " + ((card && card.ticker) || "a name") + "."),
          (card && card.ticker) || null);
      } finally {
        btn.disabled = false;
        if (btn.textContent === "Loading names…") btn.textContent = prev;
      }
    };
  }

  function showPicker(rows, note, backTo) {
    if (!picker) return;
    grid.hidden = true;
    if (headEl) headEl.hidden = true;

    if (barEl) barEl.hidden = true;
    if (changeEl) changeEl.hidden = true;
    picker.hidden = false;

    const back = document.getElementById("ftBackTo");
    if (back) {
      if (backTo) {
        back.hidden = false;
        back.textContent = "\u2190 Back to " + backTo;
        back.onclick = () => {
          picker.hidden = true;
          grid.hidden = false;
          if (headEl) headEl.hidden = false;
          if (barEl) barEl.hidden = false;
          if (changeEl && painted) changeEl.hidden = false;
          syncBarHeight();
          const h = document.getElementById("ftTicker");
          if (h) h.focus();
        };
      } else {
        back.hidden = true;
        back.onclick = null;
      }
    }
    const body = $("ftPickerBody");
    body.replaceChildren();
    for (const row of rows) {
      const tr = el("tr");
      const tk = el("td");
      const a = el("a", "ft-link");
      a.href = "/flows/ticker/?t=" + encodeURIComponent(String(row.t || ""));
      a.textContent = String(row.t || DASH);
      tk.append(a);
      tr.append(tk);
      tr.append(el("td", null, row.side === "short" ? "Bearish" : "Bullish"));
      const rank = el("td", "c-num");
      rank.textContent = isNum(row.r) === null ? DASH : String(row.r);
      tr.append(rank);
      const sc = el("td", "c-num");
      const s = isNum(row.s);
      sc.textContent = s === null ? DASH : (s > 0 ? "+" : s < 0 ? MINUS : "") + Math.abs(s);
      tr.append(sc);
      body.append(tr);
    }
    const noteEl = $("ftPickerNote");
    if (noteEl) noteEl.textContent = note;
  }

  function boardRows(long, short) {
    const out = [];
    for (const [payload, side] of [[long, "long"], [short, "short"]]) {
      const rows = ((payload && payload.rows) || []).filter((r) => r && r.t);
      const knowsDeep = isNum(payload && payload.deep) !== null;
      for (const row of rows) {
        out.push({
          t: row.t, r: row.r, s: row.s, side,

          sector: typeof row.sector === "string" && row.sector ? row.sector : null,
          chg: isNum(row.chg),
          card: knowsDeep ? row.dp === 1 : null,
          of: rows.length,
        });
      }
    }
    return out;
  }

  const carded = (rows) => rows.filter((r) => r.card !== false);

  function pickerNote(all, shown, tail) {
    const unknown = all.some((r) => r.card === null);
    if (unknown) {
      return "All " + NAMES(all.length) + " on today’s board. This board does not " +
        "publish which of its rows the run went deep enough on to build a card for, so a " +
        "name here may still open a page with no card. " + tail;
    }
    if (all.length > shown.length) {

      return "Today’s board ranks " + NAMES(all.length) + " and this run built a card " +
        "for " + shown.length + " of them, which are the rows below. A card costs vendor " +
        "calls the run cannot spend on every name, so the rest are ranked without one and " +
        "are not listed: such a page would have nothing on it. " + tail;
    }
    return "All " + NAMES(all.length) + " on today’s board, every one of which " +
      "carries a card. " + tail;
  }

  function sayWhyAbsent(ticker, events, boardsRead) {

    const lead = boardsRead === false
      ? "Neither board could be read just now, so this page cannot say whether " + ticker +
        " is on today's board. What follows is the funnel's own account of it. "
      : ticker + " is not on today's board, so no card was built for it. ";
    const rows = events && Array.isArray(events.rows) ? events.rows : null;
    const row = rows ? rows.find((r) => r && String(r.t).toUpperCase() === ticker) : null;

    const parts = [lead];
    if (row && String(row.st || "").startsWith("board:")) {

      parts.push(
        "The funnel places it on today\u2019s " +
        (row.st === "board:short" ? "bearish" : "bullish") + " board, which the board " +
        "payload this page just read does not agree with \u2014 either that read failed " +
        "or the two payloads are from different runs. Reload before concluding anything " +
        "about this name.");
    } else if (!rows) {
      parts.push(
        "The earnings calendar could not be read just now, so this page cannot say which " +
        "stage of the funnel it stopped at. It is not on the watch list either: that list " +
        "holds only names that were scored and landed inside the dead band.");
    } else if (row && row.st === "gated") {
      const dte = isNum(row.dte);
      parts.push(
        "It reports on " + (row.d ? String(row.d) : "a date the calendar did not publish") +
        (dte === null
          ? ", with no calendar-day count published beside it, "
          : ", " + dte + " calendar " + (dte === 1 ? "day" : "days") + " from " +
            (events.gateOrigin || "the run's own Eastern date") + ", ") +
        "and the earnings gate removed it BEFORE the composite ran" +
        (isNum(events.gateDays) === null
          ? ". " : " \u2014 the gate covers day 0 to day " + events.gateDays + ". ") +
        "So there is no score under this name at all today, not a low one. It is not on " +
        "the watch list either: that list holds only names that were scored and landed " +
        "inside the dead band.");
    } else if (row) {
      parts.push(
        "The funnel stopped it at \u201c" + String(row.st || "an unclassified stage") +
        "\u201d: it cleared the earnings gate and did not reach the board. Cards are built " +
        "only for board names, so there is nothing to draw for it today.");
    } else {

      const win = isNum(events.windowDays);
      parts.push(
        "The earnings calendar carries no row for this name, so this page cannot say " +
        "which stage of the funnel it stopped at. That calendar holds only names " +
        "reporting within " +
        (win === null ? "its own window" : win + " calendar " + (win === 1 ? "day" : "days")) +
        " of " + (events.gateOrigin || "the run\u2019s own Eastern date") +
        (events.capBound === true
          ? ", and it was capped before it ran out of window, so it does not reach every " +
            "name even inside it"
          : "") +
        " \u2014 so its silence here is a missing row, not evidence about this name.");
    }

    statusEl.replaceChildren(document.createTextNode(parts.join("")));

    const link = el("a", "ft-link");
    link.href = "/flows/events/";
    link.textContent = " The earnings calendar and the whole funnel.";
    statusEl.append(link);
  }

  function start() {
    const ticker = readTicker();

    if (!ticker) {

      statusEl.textContent = "Choose a name.";
      Promise.all([
        getJSON("/api/flows/board?side=long").catch(() => null),
        getJSON("/api/flows/board?side=short").catch(() => null),
      ]).then(([long, short]) => {
        const all = boardRows(long, short);
        const rows = carded(all);
        if (!rows.length) {

          statusEl.textContent = all.length
            ? "Today’s board ranks " + NAMES(all.length) + ", and this run built a " +
              "card for none of them, so there is nothing to open here. The board itself " +
              "is published."
            : "No board has been published yet, so there is no name to choose.";
          return;
        }
        showPicker(rows, pickerNote(all, rows,
          "Each one opens its own workspace of panels."));
      });
      return;
    }

    getJSON("/api/flows/card?t=" + encodeURIComponent(ticker)).then((card) => {
      if (!card) return;
      if (card.status === "pending" || !card.panels) {

        return Promise.all([
          getJSON("/api/flows/board?side=long").catch(() => null),
          getJSON("/api/flows/board?side=short").catch(() => null),
          getJSON("/api/flows/events").catch(() => null),
        ]).then(([long, short, events]) => {

          const all = boardRows(long, short);
          const rows = carded(all);
          const me = all.find((r) => r.t === ticker);
          if (me && me.card === false) {

            statusEl.textContent =
              "The board ranks " + ticker + " " +
              (isNum(me.r) === null || isNum(me.of) === null
                ? "on its " + (me.side === "short" ? "bearish" : "bullish") + " side"
                : me.r + " of " + me.of + " on the " +
                  (me.side === "short" ? "bearish" : "bullish") + " side") +
              ", and this run built no card for it. A card costs vendor calls the run " +
              "spends only on the names furthest from neutral, so most of the board is " +
              "scored and ranked without one. This is not a lag, and reloading will not " +
              "produce a card.";
          } else if (me) {
            statusEl.textContent =
              "The board published " + ticker + " but its card has not landed yet. " +
              "Cards are published after the boards, so one can briefly lag its row.";
            return;
          } else {
            sayWhyAbsent(ticker, events, long !== null || short !== null);
          }
          if (rows.length) {
            showPicker(rows, pickerNote(all, rows,
              "These are the ones you can open today."));
          }
        });
      }
      paint(card);
      wireSwitch(card);
      boardsWhenIdle(ticker);
      startLive(ticker);
      return null;
    }).catch(() => {
      statusEl.textContent = "This page could not be loaded. Reload to try again.";

      grid.hidden = false;
      for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
        const host = section.querySelector("div");
        if (host) {
          deadPanel(host, section.dataset.question || "",
            "this page could not be loaded. Reload to try again.");
        }
      }
    });
  }

  installWorkspace();
  start();
})();
