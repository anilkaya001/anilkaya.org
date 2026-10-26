const isInt = Number.isSafeInteger;

export function floorDiv(x, u) {
  if (!isInt(x) || !isInt(u) || u <= 0) throw new RangeError("floorDiv takes safe integers and a positive divisor");
  const m = ((x % u) + u) % u;
  return (x - m) / u;
}

function minCostFlow(size, arcs, source, sink, want) {
  const to = [], cap = [], cost = [], next = [];
  const head = new Array(size).fill(-1);
  const add = (a, b, c, w) => {
    to.push(b); cap.push(c); cost.push(w); next.push(head[a]); head[a] = to.length - 1;
    to.push(a); cap.push(0); cost.push(-w); next.push(head[b]); head[b] = to.length - 1;
    return to.length - 2;
  };
  const ids = arcs.map(([a, b, c, w]) => add(a, b, c, w));
  let flow = 0;
  while (flow < want) {
    const dist = new Array(size).fill(Infinity);
    const via = new Array(size).fill(-1);
    const queued = new Array(size).fill(false);
    dist[source] = 0;
    const queue = [source];
    queued[source] = true;
    for (let qi = 0; qi < queue.length; qi++) {
      const a = queue[qi];
      queued[a] = false;
      for (let e = head[a]; e !== -1; e = next[e]) {
        if (cap[e] > 0 && dist[a] + cost[e] < dist[to[e]]) {
          dist[to[e]] = dist[a] + cost[e];
          via[to[e]] = e;
          if (!queued[to[e]]) { queued[to[e]] = true; queue.push(to[e]); }
        }
      }
    }
    if (dist[sink] === Infinity) break;
    let push = want - flow;
    for (let b = sink; b !== source; b = to[via[b] ^ 1]) push = Math.min(push, cap[via[b]]);
    for (let b = sink; b !== source; b = to[via[b] ^ 1]) { cap[via[b]] -= push; cap[via[b] ^ 1] += push; }
    flow += push;
  }
  return { flow, used: ids.map((id) => cap[id ^ 1]) };
}

export function roundTable(cells, unit) {
  if (!Array.isArray(cells) || !cells.length || !Array.isArray(cells[0]) || !cells[0].length) throw new RangeError("roundTable takes a non-empty table");
  if (!isInt(unit) || unit <= 0) throw new RangeError("roundTable takes a positive integer unit");
  const rows = cells.length;
  const cols = cells[0].length;
  const grid = [];
  for (let i = 0; i < rows; i++) {
    if (!Array.isArray(cells[i]) || cells[i].length !== cols) throw new RangeError("roundTable takes a rectangular table");
    for (const x of cells[i]) if (!isInt(x)) throw new RangeError("roundTable takes safe integers");
    grid.push(cells[i].slice());
  }
  const rowSum = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const colSum = Array.from({ length: cols }, (_, j) => grid.reduce((a, row) => a + row[j], 0));
  const total = rowSum.reduce((a, b) => a + b, 0);
  for (const s of [...rowSum, ...colSum, total]) if (!isInt(s)) throw new RangeError("roundTable sums leave the safe integers");
  const ext = grid.map((row, i) => [...row, -rowSum[i]]);
  ext.push([...colSum.map((s) => -s), total]);
  const n = rows + 1;
  const m = cols + 1;
  const q = ext.map((row) => row.map((x) => floorDiv(x, unit)));
  const f = ext.map((row, i) => row.map((x, j) => x - q[i][j] * unit));
  const need = [];
  for (let i = 0; i < n; i++) {
    const s = f[i].reduce((a, b) => a + b, 0);
    if (s % unit !== 0) throw new RangeError("a row of the extended table does not close");
    need.push(s / unit);
  }
  const have = [];
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += f[i][j];
    if (s % unit !== 0) throw new RangeError("a column of the extended table does not close");
    have.push(s / unit);
  }
  const want = need.reduce((a, b) => a + b, 0);
  const source = 0;
  const sink = 1 + n + m;
  const arcs = [];
  for (let i = 0; i < n; i++) if (need[i] > 0) arcs.push([source, 1 + i, need[i], 0]);
  const cellArc = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    if (f[i][j] > 0) { cellArc.push([i, j, arcs.length]); arcs.push([1 + i, 1 + n + j, 1, unit - 2 * f[i][j]]); }
  }
  for (let j = 0; j < m; j++) if (have[j] > 0) arcs.push([1 + n + j, sink, have[j], 0]);
  const solved = minCostFlow(sink + 1, arcs, source, sink, want);
  if (solved.flow !== want) throw new RangeError("the table has no controlled rounding");
  const out = q.map((row) => row.slice());
  for (const [i, j, k] of cellArc) out[i][j] += solved.used[k];
  const cellsOut = [];
  for (let i = 0; i < rows; i++) cellsOut.push(out[i].slice(0, cols));
  return {
    unit,
    cells: cellsOut,
    rowTotals: Array.from({ length: rows }, (_, i) => -out[i][cols]),
    colTotals: Array.from({ length: cols }, (_, j) => -out[rows][j]),
    total: out[rows][cols],
  };
}

export function footsRounded(rounded) {
  const { cells, rowTotals, colTotals, total } = rounded;
  const rowsOk = cells.every((row, i) => row.reduce((a, b) => a + b, 0) === rowTotals[i]);
  const colsOk = colTotals.every((s, j) => cells.reduce((a, row) => a + row[j], 0) === s);
  return rowsOk && colsOk && rowTotals.reduce((a, b) => a + b, 0) === total && colTotals.reduce((a, b) => a + b, 0) === total;
}
