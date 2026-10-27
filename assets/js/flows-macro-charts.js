(() => {
  "use strict";

  const U = window.FlowsUI;
  const F = U.F;
  const DASH = U.DASH;
  const SVGNS = "http://www.w3.org/2000/svg";
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const r1 = (x) => Math.round(x * 10) / 10;
  const MATS = { "3month": 0.25, "2year": 2, "5year": 5, "7year": 7, "10year": 10, "30year": 30 };
  const LABELS = { "3month": "3M", "2year": "2Y", "5year": "5Y", "7year": "7Y", "10year": "10Y", "30year": "30Y" };
  const NAMES = { "3month": "3-month", "2year": "2-year", "5year": "5-year", "7year": "7-year", "10year": "10-year", "30year": "30-year" };

  function mount(host, draw) {
    if (!host) return;
    if (host._macroRo) host._macroRo.disconnect();
    draw();
    if (window.ResizeObserver) {
      let first = true;
      host._macroRo = new ResizeObserver(() => { if (first) { first = false; return; } draw(); });
      host._macroRo.observe(host);
    }
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1;
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
    return { ticks: out, step };
  }

  const dpFor = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4);

  function spark(points) {
    const v = (points || []).filter((x) => num(x) !== null);
    if (v.length < 2) return `<svg class="mc-svg s" viewBox="0 0 72 32" preserveAspectRatio="none" aria-hidden="true"></svg>`;
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const x = (i) => r1(2 + (i / (v.length - 1)) * 66);
    const y = (a) => r1(28 - ((a - lo) / span) * 24);
    const d = v.map((a, i) => (i ? "L" : "M") + x(i) + " " + y(a)).join("");
    return `<svg class="mc-svg s" viewBox="0 0 72 32" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="ln" d="${d}" vector-effect="non-scaling-stroke"/><circle class="dot" cx="${x(v.length - 1)}" cy="${y(v[v.length - 1])}" r="2"/></svg>`;
  }

  function shapeOf(kind, x, y, hollow) {
    if (kind === 0) return `<circle class="dot${hollow ? " hol" : ""}" cx="${x}" cy="${y}" r="3.5"/>`;
    if (kind === 1) return `<rect class="sq" x="${x - 3}" y="${y - 3}" width="6" height="6"${hollow ? ' fill="none" stroke="currentColor"' : ""}/>`;
    return `<path class="tri" d="M${x} ${y - 4}L${x + 4} ${y + 3}L${x - 4} ${y + 3}Z"/>`;
  }

  function curve(host, rates, read) {
    mount(host, () => {
      const rows = (rates && rates.curve) || [];
      const w = host.clientWidth || 400, h = host.clientHeight || 180;
      if (!rows.length || w < 40 || h < 40) { host.innerHTML = ""; return; }
      const series = [[1, "Now", "now"], [3, "1M", "m1"], [5, "1Y", "y1"]].map(([ci, name, cls], si) => ({ name, cls, si, pts: rows.map((r) => ({ m: r[0], v: r[ci], d: r[ci + 1] })).filter((p) => num(p.v) !== null) }));
      const all = series.flatMap((s) => s.pts.map((p) => p.v));
      let lo = Math.min(...all), hi = Math.max(...all);
      const pad = (hi - lo) * 0.12 || 0.1;
      lo -= pad; hi += pad;
      const nt = niceTicks(lo, hi, 4);
      const L = 40, R = 30, T = 8, B = 20;
      const lx = (m) => L + ((Math.log(MATS[m]) - Math.log(0.25)) / (Math.log(30) - Math.log(0.25))) * (w - L - R);
      const ly = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
      const latest = rows.find((r) => r[0] === "10year");
      const top = latest ? latest[2] : rows[0][2];
      let g = nt.ticks.map((t) => `<line class="grid" x1="${L}" x2="${w - R}" y1="${r1(ly(t))}" y2="${r1(ly(t))}"/><text x="${L - 6}" y="${r1(ly(t)) + 3}" text-anchor="end">${F.px(t, dpFor(nt.step))}</text>`).join("");
      g += Object.keys(MATS).map((m) => `<text x="${r1(lx(m))}" y="${h - 5}" text-anchor="middle">${LABELS[m]}</text>`).join("");
      for (const s of series) {
        if (s.pts.length < 2) continue;
        g += `<path class="ln ${s.cls}" d="${s.pts.map((p, i) => (i ? "L" : "M") + r1(lx(p.m)) + " " + r1(ly(p.v))).join("")}"/>`;
        const last = s.pts[s.pts.length - 1];
        g += `<text class="lab" x="${r1(lx(last.m)) + 6}" y="${r1(ly(last.v)) + 3}">${s.name}</text>`;
        g += s.pts.map((p) => shapeOf(s.si, r1(lx(p.m)), r1(ly(p.v)), s.si === 0 && p.d !== top)).join("");
      }
      host.innerHTML = `<svg class="mc-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" tabindex="0" aria-label="Treasury yield curve now, one month back and one year back. Arrow keys move across maturities and dates." focusable="true"><g>${g}</g><g id="mcCurveCur"></g></svg>`;
      const svg = host.firstChild;
      let mi = rows.findIndex((r) => r[0] === "10year"), si = 0;
      if (mi < 0) mi = 0;
      const say = () => {
        const s = series[si];
        const p = s.pts.find((q) => q.m === rows[mi][0]);
        const cur = svg.querySelector("#mcCurveCur");
        if (!p) { cur.innerHTML = ""; read.textContent = `${NAMES[rows[mi][0]]}, ${s.name}: ${DASH}`; return; }
        cur.innerHTML = `<circle cx="${r1(lx(p.m))}" cy="${r1(ly(p.v))}" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
        const note = s.si === 0 && p.d !== top ? ` This maturity is as of ${F.day(p.d)}.` : "";
        read.textContent = `${NAMES[p.m]}, ${F.day(p.d)}${s.si ? ", " + s.name + " back" : ""}: ${F.px(p.v, 2)}%.${note}`;
      };
      svg.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") mi = Math.min(rows.length - 1, mi + 1);
        else if (e.key === "ArrowLeft") mi = Math.max(0, mi - 1);
        else if (e.key === "ArrowUp") si = Math.max(0, si - 1);
        else if (e.key === "ArrowDown") si = Math.min(2, si + 1);
        else if (e.key === "Escape") { svg.querySelector("#mcCurveCur").innerHTML = ""; read.textContent = ""; return; } else return;
        e.preventDefault();
        say();
      });
      svg.addEventListener("pointermove", (e) => {
        const bx = svg.getBoundingClientRect();
        const x = e.clientX - bx.left;
        let best = 0, bd = Infinity;
        rows.forEach((r, i) => { const d = Math.abs(lx(r[0]) - x); if (d < bd) { bd = d; best = i; } });
        mi = best;
        say();
      });
      svg.addEventListener("focus", say);
    });
  }

  function line(host, bars, o) {
    mount(host, () => {
      const pts = (bars || []).filter((b) => num(b[1]) !== null);
      const w = host.clientWidth || 300, h = host.clientHeight || 160;
      if (pts.length < 2 || w < 40 || h < 40) { host.innerHTML = ""; return; }
      const t = pts.map((p) => Date.parse(p[0]));
      const v = pts.map((p) => p[1]);
      let lo = Math.min(...v), hi = Math.max(...v);
      const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.001 || 1;
      lo -= pad; hi += pad;
      const nt = niceTicks(lo, hi, 3);
      const L = 52, R = 8, T = 6, B = 20;
      const x = (i) => L + ((t[i] - t[0]) / (t[t.length - 1] - t[0] || 1)) * (w - L - R);
      const y = (a) => T + (1 - (a - lo) / (hi - lo)) * (h - T - B);
      const dp = Math.max(o.dp, dpFor(nt.step));
      let g = nt.ticks.map((tk) => `<line class="grid" x1="${L}" x2="${w - R}" y1="${r1(y(tk))}" y2="${r1(y(tk))}"/><text x="${L - 6}" y="${r1(y(tk)) + 3}" text-anchor="end">${F.px(tk, dp)}</text>`).join("");
      const ticks = [0, Math.floor(pts.length / 2), pts.length - 1];
      g += ticks.map((i, k) => `<text x="${r1(x(i))}" y="${h - 5}" text-anchor="${k === 0 ? "start" : k === 2 ? "end" : "middle"}">${esc(F.time(pts[i][0], false))}</text>`).join("");
      g += `<path class="ln now" d="${pts.map((p, i) => (i ? "L" : "M") + r1(x(i)) + " " + r1(y(p[1]))).join("")}"/><circle class="dot" cx="${r1(x(pts.length - 1))}" cy="${r1(y(pts[pts.length - 1][1]))}" r="3"/>`;
      const last = pts[pts.length - 1];
      const desc = `${o.label}, last ${F.px(last[1], o.dp)} at ${F.time(last[0])}, low ${F.px(Math.min(...v), o.dp)}, high ${F.px(Math.max(...v), o.dp)}.`;
      host.innerHTML = `<svg class="mc-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" tabindex="0" aria-label="${esc(desc)}" focusable="true"><g>${g}</g><g class="cur"></g></svg>`;
      const svg = host.firstChild;
      let cur = pts.length - 1;
      const say = () => {
        svg.querySelector(".cur").innerHTML = `<circle cx="${r1(x(cur))}" cy="${r1(y(pts[cur][1]))}" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
        o.read.textContent = `${o.label} ${F.time(pts[cur][0])}: ${F.px(pts[cur][1], o.dp)}.`;
      };
      svg.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") cur = Math.min(pts.length - 1, cur + 1);
        else if (e.key === "ArrowLeft") cur = Math.max(0, cur - 1);
        else if (e.key === "Home") cur = 0;
        else if (e.key === "End") cur = pts.length - 1;
        else if (e.key === "Escape") { svg.querySelector(".cur").innerHTML = ""; o.read.textContent = ""; return; } else return;
        e.preventDefault();
        say();
      });
      svg.addEventListener("pointermove", (e) => {
        const bx = svg.getBoundingClientRect();
        const px = e.clientX - bx.left;
        let best = 0, bd = Infinity;
        for (let i = 0; i < pts.length; i++) { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } }
        cur = best;
        say();
      });
    });
  }

  function contract(host, points, read) {
    mount(host, () => {
      const w = host.clientWidth || 300, h = host.clientHeight || 140;
      const pts = (points || []).filter((p) => num(p[2]) !== null);
      if (pts.length < 2 || w < 40 || h < 40) { host.innerHTML = ""; return; }
      const v = pts.map((p) => p[2]);
      let lo = Math.min(...v), hi = Math.max(...v);
      const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.001 || 1;
      lo -= pad; hi += pad;
      const nt = niceTicks(lo, hi, 3);
      const L = 52, R = 10, T = 8, B = 20;
      const x = (i) => L + (i / (pts.length - 1)) * (w - L - R);
      const y = (a) => T + (1 - (a - lo) / (hi - lo)) * (h - T - B);
      let g = nt.ticks.map((tk) => `<line class="grid" x1="${L}" x2="${w - R}" y1="${r1(y(tk))}" y2="${r1(y(tk))}"/><text x="${L - 6}" y="${r1(y(tk)) + 3}" text-anchor="end">${F.px(tk, Math.max(2, dpFor(nt.step)))}</text>`).join("");
      g += pts.map((p, i) => `<text x="${r1(x(i))}" y="${h - 5}" text-anchor="middle">${esc(p[1])}</text>`).join("");
      g += `<path class="ln now" d="${pts.map((p, i) => (i ? "L" : "M") + r1(x(i)) + " " + r1(y(p[2]))).join("")}"/>`;
      g += pts.map((p, i) => `<circle class="dot${p[6] ? " hol" : ""}" cx="${r1(x(i))}" cy="${r1(y(p[2]))}" r="3.5"/>`).join("");
      host.innerHTML = `<svg class="mc-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" tabindex="0" aria-label="Settlement by contract month. Arrow keys move across months." focusable="true"><g>${g}</g><g class="cur"></g></svg>`;
      const svg = host.firstChild;
      let cur = 0;
      const say = () => {
        const p = pts[cur];
        svg.querySelector(".cur").innerHTML = `<circle cx="${r1(x(cur))}" cy="${r1(y(p[2]))}" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
        read.textContent = `${p[1]}: ${F.px(p[2], 2)}, settled ${F.day(p[3])}${p[4] === null ? "" : ", open interest " + F.int(p[4])}.${p[6] ? " Not the last session." : ""}`;
      };
      svg.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") cur = Math.min(pts.length - 1, cur + 1);
        else if (e.key === "ArrowLeft") cur = Math.max(0, cur - 1);
        else if (e.key === "Escape") { svg.querySelector(".cur").innerHTML = ""; read.textContent = ""; return; } else return;
        e.preventDefault();
        say();
      });
      svg.addEventListener("pointermove", (e) => {
        const bx = svg.getBoundingClientRect();
        const px = e.clientX - bx.left;
        let best = 0, bd = Infinity;
        for (let i = 0; i < pts.length; i++) { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } }
        cur = best;
        say();
      });
    });
  }

  function split(b) {
    const buy = b.buy[1], sell = b.sell[1], none = b.none[1];
    const total = buy + sell + none || 1;
    const w1 = (buy / total) * 100, w2 = (sell / total) * 100, w3 = (none / total) * 100;
    return `<svg class="mc-svg" viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label="Buy ${F.int(buy)} contracts, sell ${F.int(sell)}, unsided ${F.int(none)}"><rect class="buy" x="0" y="2" width="${r1(w1)}" height="10"/><rect class="sell" x="${r1(w1)}" y="2" width="${r1(w2)}" height="10"/><rect class="bar hatch none" x="${r1(w1 + w2)}" y="2" width="${r1(w3)}" height="10"/></svg>`;
  }

  function bar(price, thin) {
    const p = Math.max(0, Math.min(1, price)) * 100;
    return `<svg class="mc-svg" viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label="${F.pct(price, 0)}${thin ? ", thin market" : ""}"><defs><pattern id="mcHatch${thin ? "T" : ""}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" stroke-width="1"/></pattern></defs><rect x="0" y="4" width="100" height="6" fill="none" stroke="currentColor" stroke-opacity="0.35"/>${thin ? `<rect x="0" y="4" width="${r1(p)}" height="6" fill="url(#mcHatchT)"/>` : `<rect class="bar" x="0" y="4" width="${r1(p)}" height="6"/>`}<line class="mid" x1="25" x2="25" y1="2" y2="12"/><line class="mid" x1="50" x2="50" y1="2" y2="12"/><line class="mid" x1="75" x2="75" y1="2" y2="12"/></svg>`;
  }

  function hist(history) {
    const v = (history || []).map((p) => p[1]).filter((x) => num(x) !== null);
    return spark(v);
  }

  function histBig(host, history) {
    mount(host, () => {
      const pts = (history || []).filter((p) => num(p[1]) !== null);
      const w = host.clientWidth || 300, h = host.clientHeight || 100;
      if (pts.length < 2 || w < 40 || h < 40) { host.innerHTML = ""; return; }
      const L = 34, R = 8, T = 6, B = 16;
      const x = (i) => L + (i / (pts.length - 1)) * (w - L - R);
      const y = (a) => T + (1 - a) * (h - T - B);
      let g = [0, 0.5, 1].map((t) => `<line class="grid" x1="${L}" x2="${w - R}" y1="${r1(y(t))}" y2="${r1(y(t))}"/><text x="${L - 6}" y="${r1(y(t)) + 3}" text-anchor="end">${F.pct(t, 0)}</text>`).join("");
      g += `<text x="${L}" y="${h - 3}">${esc(F.day(pts[0][0]))}</text><text x="${w - R}" y="${h - 3}" text-anchor="end">${esc(F.day(pts[pts.length - 1][0]))}</text>`;
      g += `<path class="ln now" d="${pts.map((p, i) => (i ? "L" : "M") + r1(x(i)) + " " + r1(y(p[1]))).join("")}"/>`;
      host.innerHTML = `<svg class="mc-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Price history, last ${F.pct(pts[pts.length - 1][1], 0)} on ${esc(F.day(pts[pts.length - 1][0]))}">${g}</svg>`;
    });
  }

  function interval(lo, hi, share) {
    const X = (p) => r1(p * 100);
    return `<svg class="mc-svg" viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label="Interval ${F.pct(lo, 0)} to ${F.pct(hi, 0)}, share ${F.pct(share, 0)}"><line class="mid" x1="50" x2="50" y1="0" y2="14"/><rect class="bar" x="${X(lo)}" y="4" width="${r1(Math.max(1, (hi - lo) * 100))}" height="6" rx="1"/><line class="tick" x1="${X(share)}" x2="${X(share)}" y1="1" y2="13"/></svg>`;
  }

  window.FlowsUI.macro.attach({ spark, curve, line, contract, split, bar, hist, histBig, interval });
})();
