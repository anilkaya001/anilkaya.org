export const CASES_SRC = String.raw`
const DAYS = Array.from({ length: 24 }, (_, i) => "2026-09-" + String(i + 1).padStart(2, "0"));
const WAVE = DAYS.map((_, i) => Math.round(100 * Math.sin(i / 3) + i * 4));
const GAPPY = WAVE.map((v, i) => (i === 7 || i === 8 ? null : v));
const SIGNED = [12, -30, 0, 45, -8, null, 22, -60, 5, 0];
const GRID = [[1, -2, 0, null, 3], [0, 4, -5, 2, null], [-1, 0, 6, -3, 2], [2, 2, null, 0, -4]];
const CASES = {
  "line-dates": (C, el) => C.line(el, { label: "Net premium", series: [{ values: WAVE, area: true }, { values: WAVE.map((v) => v * 0.6), color: "--s-orange", label: "Other" }], x: DAYS, yFormat: (v) => "$" + v }),
  "line-twotone": (C, el) => C.line(el, { label: "Signed", series: [{ values: GAPPY }], x: DAYS, twoTone: true, zero: true, refs: [{ y: 50, dash: true }] }),
  "line-number-sqrt": (C, el) => C.line(el, { label: "Curve", series: [{ values: [0, 1, 4, 9, 16, 25] }], x: [0, 1, 4, 9, 16, 25], xType: "number", xScale: "sqrt", markers: [{ x: 4, y: 4, shape: "ring" }] }),
  "line-index": (C, el) => C.line(el, { label: "Indexed", series: [{ values: [3, 5, 4, 8, 6, 9, 7] }], endLabels: false, yTicks: false }),
  "bars": (C, el) => C.bars(el, { label: "Counts", values: [3, 8, 5, null, 9, 2, 6], labels: ["a", "b", "c", "d", "e", "f", "g"], cumulative: [0.1, 0.3, 0.5, null, 0.8, 0.9, 1], highlight: 4 }),
  "bars-colors": (C, el) => C.bars(el, { label: "Coloured", values: [1, 2, 3], colors: ["--up-mark", "--down-mark", "--s-blue"], labels: ["x", "y", "z"] }),
  "diverging-index": (C, el) => C.diverging(el, { label: "Signed bars", values: SIGNED, x: DAYS.slice(0, 10), endLabel: true }),
  "diverging-number": (C, el) => C.diverging(el, { label: "By strike", values: [-4, -2, 3, 8, 0, -1, 5], x: [90, 95, 100, 105, 110, 115, 120], xType: "number", spot: 104, palette: "gamma", markers: [{ x: 100, shape: "dia", color: "--lvl-flip", rule: true }], labels: [{ x: 105, text: "Wall" }], highlight: [100] }),
  "heatmap": (C, el) => C.heatmap(el, { label: "Grid", rows: ["r1", "r2", "r3", "r4"], cols: ["a", "b", "c", "d", "e"], grid: GRID, highlightRow: 1, highlightCol: 2 }),
  "heatmap-direction": (C, el) => C.heatmap(el, { label: "Grid", rows: ["r1", "r2", "r3", "r4"], cols: ["a", "b", "c", "d", "e"], grid: GRID, palette: "direction", cap: 4 }),
  "sparkline": (C, el) => C.sparkline(el, [1, 3, 2, null, 5, 4, 6], { label: "Spark", area: true, ref: 3 }),
  "payoff-host": (C, el) => C.payoff(el, { label: "Payoff", points: [[90, -5], [100, -5], [110, 6], [120, 16]], projected: [[90, -3], [105, 0], [120, 12]], breakevens: [105], spot: 102, maxLabel: "Max", minLabel: "Min" }),
  "line-empty": (C, el) => C.line(el, { label: "Empty", series: [{ values: [null, null] }], x: ["2026-09-01", "2026-09-02"] }),
  "bars-empty": (C, el) => C.bars(el, { label: "Empty", values: [] }),
};
const FREE = {
  "payoff-shape": (C) => C.payoff(null, { structure: "iron condor" }),
  "payoff-unknown": (C) => C.payoff(null, { structure: "mystery" }),
  "gauge": (C) => C.gauge({ value: 62, label: "Score", caption: "of 100" }),
  "gauge-diverging": (C) => C.gauge({ value: -35, min: -100, max: 100, diverging: true, label: "Tilt" }),
  "gauge-half": (C) => C.gauge({ value: 30, arc: 180, label: "Half", text: false }),
};
window.CASES = CASES;
window.FREE = FREE;
`;
