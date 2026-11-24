(function () {
  "use strict";

  const UI = window.FlowsUI;
  const { h, s, clamp, DASH } = UI;
  const SERIES = [["up", "Upside"], ["down", "Downside"], ["vol", "Volatility"]];
  const ZONES = { up: "Upside amplification", down: "Downside amplification", volatile: "Volatility expansion", dampen: "Dampening" };
  const MODES = { "point-in-time": "Point-in-time capture", "historical-reconstruction": "Historical reconstruction", "historical-export": "Historical export" };
  const SHOCK = { normal: "Normal", thin: "Thin", ensemble: "Ensemble", short: "Short gamma", long: "Long gamma" };
  const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const DOLLAR = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const price = (n) => Number.isFinite(n) ? DOLLAR.format(n) : DASH;
  const count = (n) => Number.isFinite(n) ? INTEGER.format(n) : DASH;
  const ratio = (n) => Number.isFinite(n) ? n.toFixed(3) + "×" : DASH;
  const percent = (n, dp = 1) => Number.isFinite(n) ? (n * 100).toFixed(dp) + "%" : DASH;
  const midpoint = (rows, spot) => rows.reduce((best, row, i) => Math.abs(row.price - spot) < Math.abs(rows[best].price - spot) ? i : best, 0);
  const drawLine = (svg, x1, x2, y1, y2, cls) => s("line", { x1, x2, y1, y2, class: cls }, svg);
  const drawText = (svg, text, x, y, align) => s("text", { x, y, "text-anchor": align || "start", text }, svg);
  const path = (items, x, y) => items.map((item, index) => (index ? "L" : "M") + x(item, index).toFixed(2) + " " + y(item, index).toFixed(2)).join(" ");

  function chart(svg, width, history, result, index, shown) {
    const rows = result.rows, zones = result.zones;
    const height = 284, left = 46, right = width - 12, top = 23, bottom = height - 27;
    const split = rows.length ? left + (right - left) * (width < 480 ? .54 : .64) : right;
    const values = history.map((bar) => bar.price).concat(rows.map((row) => row.price), zones.flatMap((z) => [z.low, z.high]));
    const lower = Math.min(...values), upper = Math.max(...values), pad = Math.max((upper - lower) * .06, lower * .0008);
    const lo = lower - pad, hi = upper + pad;
    const y = (p) => top + (hi - p) / (hi - lo) * (bottom - top);
    const clocks = history.map((bar) => Date.parse(bar.timestamp)), first = clocks[0], span = clocks[clocks.length - 1] - first;
    const historyX = (_, i) => left + (split - left) * (span > 0 ? (clocks[i] - first) / span : i / (history.length - 1));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren();
    const lineLayer = s("g", {}, svg);
    drawText(lineLayer, "Recorded price · USD", left, 13);
    const barSteps = width < 400 ? [0, 1] : [0, .5, 1];
    for (const a of barSteps) {
      const i = Math.round((history.length - 1) * a);
      drawText(lineLayer, history[i].time, historyX(null, i), height - 9, a === 0 ? "start" : a === 1 ? "end" : "middle");
    }
    for (let i = 0; i < 5; i++) {
      const p = lo + (hi - lo) * i / 4, yy = y(p);
      drawLine(lineLayer, left, right, yy, yy, "ft-r-grid");
      drawText(lineLayer, Number(p.toFixed(2)).toString(), left - 6, yy + 4, "end");
    }
    s("path", { d: path(history, historyX, (item) => y(item.price)), class: "ft-r-history" }, svg);
    if (!rows.length) return null;
    const axisLeft = split + 7, center = (axisLeft + right) / 2;
    const deviation = Math.max(.001, ...rows.flatMap((row) => SERIES.map(([key]) => Math.abs(row[key] - 1))));
    const responseX = (value) => center + (value - 1) / deviation * (right - axisLeft) * .45;
    for (const zone of zones) s("rect", { x: axisLeft, width: right - axisLeft, y: y(zone.high), height: y(zone.low) - y(zone.high), class: "ft-r-zone", "data-kind": zone.kind }, svg);
    drawLine(svg, split, split, top, bottom, "ft-r-grid");
    drawLine(svg, center, center, top, bottom, "ft-r-baseline");
    drawText(svg, width < 425 ? "Response" : "Scenario response", axisLeft, 13);
    drawText(svg, "1.00×", center, height - 9, "middle");
    if (width >= 480) {
      drawText(svg, ratio(1 - deviation), axisLeft, height - 9);
      drawText(svg, ratio(1 + deviation), right, height - 9, "end");
    } else drawText(svg, "±" + percent(deviation, 2), right, 13, "end");
    for (const [key] of SERIES) if (shown.has(key)) s("path", { d: path(rows, (r) => responseX(r[key]), (r) => y(r.price)), class: "ft-r-trace", "data-series": key }, svg);
    const guide = drawLine(svg, left, right, y(rows[index].price), y(rows[index].price), "ft-r-guide");
    return { guide, height, top, bottom, left: axisLeft, right, lo, hi, y };
  }

  function mount(host, { ticker }) {
    let model = null, result = null, revision = 0, selected = 0, drawing = null, resize = null, timer = null;
    const cache = new Map(), shown = new Set(SERIES.map(([key]) => key));
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    const choose = h("button", { type: "button", class: "ft-gbtn", onclick: () => file.click() }, "Load snapshot");
    const save = h("button", { type: "button", class: "ft-gbtn", disabled: true }, "Export CSV");
    const source = h("p", { class: "ft-r-source" }, "Use a recorded market-data snapshot for " + ticker + ".");
    const status = h("p", { class: "ft-r-status", role: "status", hidden: true });
    const empty = h("div", { class: "ft-r-empty" }, h("b", null, "Awaiting market-data snapshot"), h("p", null, "An authorized JSON recording stays in this browser."),
      h("details", { class: "ft-r-method" }, h("summary", null, "Snapshot format"), h("p", null,
        "Use a normalized schema version 1 recording for this ticker. Include the source, capture mode, as-of timestamp, and completed price bars. Model responses also require timestamps, option chain and tape coverage, underlying volume, and the exchange session close.")));
    const controls = h("div", { class: "ft-r-controls", hidden: true });
    const select = (label) => {
      const n = h("select", { "aria-label": label, onchange: evaluate });
      controls.append(h("label", null, h("span", null, label), n));
      return n;
    };
    const horizon = select("Horizon"), liquidity = select("Liquidity"), inventory = select("Dealer inventory");
    const svg = s("svg", { role: "img", "aria-label": ticker + " recorded prices and conditional response by starting price" });
    const legend = h("div", { class: "ft-r-legend", role: "group", "aria-label": "Response traces" }, SERIES.map(([key, label]) =>
      h("button", { type: "button", "data-series": key, "aria-pressed": "true", onclick: (event) => {
        if (shown.has(key)) shown.delete(key); else shown.add(key);
        event.currentTarget.setAttribute("aria-pressed", String(shown.has(key)));
        repaint();
      } }, label)));
    const plot = h("div", { class: "ft-r-plot" }, svg, legend);
    const cursor = h("input", { type: "range", min: "0", step: "1", "aria-label": "Starting price", oninput: () => chooseRow(+cursor.value) });
    const spot = h("b", { class: "ft-r-spot" });
    const metrics = h("dl", { class: "ft-r-metrics", "aria-live": "polite", "aria-label": "Responses and scenario ranges" });
    const zones = h("div", { class: "ft-r-zones" });
    const detail = h("aside", { class: "ft-r-detail", "aria-label": "Scenario inspector" }, h("div", { class: "ft-r-node" }, h("span", null, "Starting price"), spot), cursor, metrics,
      h("p", { class: "ft-r-range-caption" }, "Ranges cover the 10th–90th scenario percentiles."), zones);
    const evidence = h("p", { class: "ft-r-evidence" });
    const method = h("details", { class: "ft-r-method" }, h("summary", null, "Model and assumptions"), h("p", null,
      "The model reprices the same option inventory after an up or down shock. Ratios compare modeled price movement and volatility with a baseline at each starting price. Dealer inventory and impact are assumptions. A zone requires a material change supported across scenarios."));
    const stage = h("div", { class: "ft-r-stage", hidden: true }, h("div", { class: "ft-r-grid-wrap" }, plot, detail), evidence, method);
    host.replaceChildren(h("div", { class: "ft-r-source-row" }, source, h("div", { class: "ft-r-tools" }, file, choose, save)), status, controls, empty, stage);

    function say(text, error = false) {
      status.hidden = !text;
      status.dataset.error = String(error);
      status.textContent = text;
    }

    function repaint() {
      if (!model || !result || host.hidden || plot.clientWidth < 1) return;
      drawing = chart(svg, Math.max(270, Math.floor(plot.clientWidth)), model.history, result, selected, shown);
    }

    function chooseRow(index) {
      if (!result || !result.rows.length) return;
      selected = clamp(index, 0, result.rows.length - 1);
      const row = result.rows[selected];
      cursor.value = String(selected);
      cursor.setAttribute("aria-valuetext", price(row.price));
      spot.textContent = price(row.price);
      metrics.replaceChildren(...SERIES.map(([key, label]) => h("div", { "data-series": key }, h("dt", null, label), h("dd", null,
        h("b", null, ratio(row[key])), h("span", null, ratio(row[key + "Low"]) + " – " + ratio(row[key + "High"]))))));
      for (const b of zones.querySelectorAll("button")) b.setAttribute("aria-pressed", String(+b.dataset.index === selected));
      if (drawing) {
        const y = drawing.y(row.price);
        drawing.guide.setAttribute("y1", y);
        drawing.guide.setAttribute("y2", y);
      }
    }

    function showResult(next) {
      const focus = result?.rows[selected]?.price || model.meta.spot;
      result = next;
      const ready = next.rows.length > 0;
      selected = ready ? midpoint(next.rows, focus) : 0;
      save.disabled = !ready;
      detail.hidden = legend.hidden = !ready;
      stage.hidden = false;
      empty.hidden = true;
      cursor.max = String(Math.max(0, next.rows.length - 1));
      zones.replaceChildren(...next.zones.map((zone) => {
        const index = midpoint(next.rows, zone.center);
        return h("button", { type: "button", class: "ft-r-zone-btn", "data-kind": zone.kind, "data-index": index, onclick: () => chooseRow(index) },
          ZONES[zone.kind] || "Response zone", h("b", null, price(zone.low) + " – " + price(zone.high)));
      }));
      if (ready && !next.zones.length) zones.append(h("p", null, "No zone passed the response and support thresholds."));
      const c = next.coverage || {};
      evidence.textContent = ready ? [next.contractCount + " option series", count(c.prints) + " prints", count(c.signedPrints) + " with eligible side", "±" + percent(next.shockPct / 100, 2) + " test shock", c.scope].filter(Boolean).join(" · ")
        : "Response withheld. " + (model.meta.withheld || "This horizon lacks enough eligible option series.");
      say("");
      repaint();
      if (ready) chooseRow(selected);
    }

    function evaluate() {
      if (!model) return;
      const stamp = ++revision;
      clearTimeout(timer);
      const scenario = { minutes: +horizon.value, liquidity: liquidity.value, inventory: inventory.value };
      const key = JSON.stringify(scenario);
      if (cache.has(key)) { showResult(cache.get(key)); return; }
      save.disabled = true;
      say("Calculating the response…");
      timer = setTimeout(() => {
        if (stamp !== revision) return;
        try {
          const next = model.evaluate(scenario);
          cache.set(key, next);
          showResult(next);
        } catch {
          stage.hidden = true;
          say("This snapshot could not be evaluated for the selected scenario.", true);
        }
      }, 0);
    }

    function options(field, values, title, defaultValue) {
      field.replaceChildren(...values.map((value) => h("option", { value }, title(value))));
      field.value = String(values.includes(defaultValue) ? defaultValue : values[0]);
    }

    file.addEventListener("change", async () => {
      const picked = file.files[0];
      file.value = "";
      if (!picked) return;
      if (picked.size > 10 * 1024 * 1024) { say("Choose a JSON snapshot up to 10 MB.", true); return; }
      choose.disabled = true;
      say("Reading the snapshot…");
      try {
        let input;
        try { input = JSON.parse(await picked.text()); } catch { throw new Error("Choose a valid JSON snapshot."); }
        const next = UI.researchModel.load(input, { symbol: ticker });
        if (next.meta.symbol !== ticker) throw new Error("Choose a snapshot for " + ticker + ".");
        cache.clear();
        result = null;
        model = next;
        options(horizon, next.meta.minutes, (n) => n + " min", 30);
        options(liquidity, next.meta.liquidity, (n) => SHOCK[n] || n, "normal");
        options(inventory, next.meta.inventory, (n) => SHOCK[n] || n, "ensemble");
        const at = new Date(next.meta.asOf);
        source.textContent = [next.meta.source, MODES[next.meta.captureMode], Number.isFinite(+at) ? CLOCK.format(at) + " Ankara time" : null].filter(Boolean).join(" · ");
        controls.hidden = !next.meta.modelReady;
        choose.textContent = "Replace snapshot";
        evaluate();
      } catch (error) { say(error instanceof Error ? error.message : "The snapshot could not be opened.", true); }
      finally { choose.disabled = false; }
    });
    save.addEventListener("click", () => {
      if (!result?.rows.length) return;
      const href = URL.createObjectURL(new Blob([model.csv(result)], { type: "text/csv;charset=utf-8" }));
      const link = h("a", { href, download: ticker + "-price-response-" + result.minutes + "m.csv" });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 4000);
    });
    svg.addEventListener("click", (event) => {
      if (!drawing || !result?.rows.length) return;
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      if (point.x < drawing.left || point.x > drawing.right || point.y < drawing.top || point.y > drawing.bottom) return;
      const wanted = drawing.hi - (point.y - drawing.top) / (drawing.bottom - drawing.top) * (drawing.hi - drawing.lo);
      chooseRow(midpoint(result.rows, wanted));
    });
    if (typeof ResizeObserver === "function") {
      resize = new ResizeObserver(repaint);
      resize.observe(plot);
    }
    return Object.freeze({ repaint, destroy() { revision++; clearTimeout(timer); resize?.disconnect(); host.replaceChildren(); } });
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, { tickerResponse: Object.freeze({ mount }) }));
})();
