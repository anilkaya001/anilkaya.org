export const BRACKET_TOL = 0.01;

const fin = (v) => typeof v === "number" && Number.isFinite(v);

function legs(quotes, bidKey, askKey, keep) {
  const out = [];
  for (const q of quotes) {
    if (!q || !fin(q.K) || !keep(q.K)) continue;
    const bid = q[bidKey], ask = q[askKey];
    if (!fin(bid) || !fin(ask) || !(bid >= 0) || !(ask >= bid)) continue;
    out.push({ K: q.K, bid, ask });
  }
  return out.sort((a, b) => a.K - b.K);
}

function upperBelow(list) {
  const best = new Array(list.length).fill(Infinity);
  for (let k = 0; k < list.length; k++) {
    for (let i = 0; i < k; i++) {
      const v = (list[i].ask - list[k].bid) / (list[k].K - list[i].K);
      if (v < best[k]) best[k] = v;
    }
    if (k > 0 && best[k - 1] < best[k]) best[k] = best[k - 1];
  }
  return best;
}

function lowerAbove(list) {
  const best = new Array(list.length).fill(-Infinity);
  for (let k = list.length - 1; k >= 0; k--) {
    for (let i = k + 1; i < list.length; i++) {
      const v = (list[k].bid - list[i].ask) / (list[i].K - list[k].K);
      if (v > best[k]) best[k] = v;
    }
    if (k + 1 < list.length && best[k + 1] > best[k]) best[k] = best[k + 1];
  }
  return best;
}

function lastAtOrBelow(list, B) {
  let lo = 0, hi = list.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].K <= B) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at;
}

function firstAtOrAbove(list, B) {
  let lo = 0, hi = list.length - 1, at = list.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].K >= B) { at = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return at;
}

export function bracketBook(quotes, F) {
  const rows = Array.isArray(quotes) ? quotes : [];
  const calls = legs(rows, "cb", "ca", (K) => K >= F);
  const puts = legs(rows, "pb", "pa", (K) => K < F);
  const cUpper = upperBelow(calls), cLower = lowerAbove(calls);
  const pLower = (() => {
    const out = new Array(puts.length).fill(-Infinity);
    for (let k = 0; k < puts.length; k++) {
      for (let i = 0; i < k; i++) {
        const v = (puts[k].bid - puts[i].ask) / (puts[k].K - puts[i].K);
        if (v > out[k]) out[k] = v;
      }
      if (k > 0 && out[k - 1] > out[k]) out[k] = out[k - 1];
    }
    return out;
  })();
  const pUpper = (() => {
    const out = new Array(puts.length).fill(Infinity);
    for (let k = puts.length - 1; k >= 0; k--) {
      for (let i = k + 1; i < puts.length; i++) {
        const v = (puts[i].ask - puts[k].bid) / (puts[i].K - puts[k].K);
        if (v < out[k]) out[k] = v;
      }
      if (k + 1 < puts.length && out[k + 1] < out[k]) out[k] = out[k + 1];
    }
    return out;
  })();
  return (B) => {
    if (!fin(B) || !(B > 0)) return null;
    if (B >= F) {
      const j = lastAtOrBelow(calls, B), a = firstAtOrAbove(calls, B);
      const hi = j >= 0 && fin(cUpper[j]) ? cUpper[j] : null;
      const lo = a < calls.length && fin(cLower[a]) ? Math.max(0, cLower[a]) : null;
      return { side: "C", lo, hi };
    }
    const j = lastAtOrBelow(puts, B), a = firstAtOrAbove(puts, B);
    const lo = j >= 0 && fin(pLower[j]) ? Math.max(0, pLower[j]) : null;
    const hi = a < puts.length && fin(pUpper[a]) ? pUpper[a] : null;
    return { side: "P", lo, hi };
  };
}

export function winRange({ side, lo, hi }, { profit, D }) {
  if (!(D > 0)) return null;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const l = fin(lo) ? lo / D : 0, h = fin(hi) ? Math.min(hi, D) / D : 1;
  const a = Math.min(l, h), b = Math.max(l, h);
  const flip = (side === "C") === (profit === "below");
  const range = flip ? [1 - b, 1 - a] : [a, b];
  return { lo: clamp(range[0]), hi: clamp(range[1]), trivial: !fin(lo) && !fin(hi) };
}

export function outsideRange(win, range, { side, D }) {
  if (!range || range.trivial || !fin(win)) return false;
  const tol = BRACKET_TOL + (side === "P" ? 1 - D : 0);
  return win < range.lo - tol || win > range.hi + tol;
}
