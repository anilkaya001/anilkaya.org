export const NO_OPEN_INTEREST = "open interest is published once per session";

export const NET_CLOSING = "net closing; flagged windows do not mark closing trades";

const isInt = Number.isSafeInteger;

const plus = (a, b) => {
  const s = a + b;
  if (!isInt(s)) throw new RangeError("a stock figure left the safe integers");
  return s;
};

const times = (a, b) => {
  const p = a * b;
  if (!isInt(p)) throw new RangeError("a stock figure left the safe integers");
  return p;
};

const usable = (c) => c !== null && typeof c === "object" && typeof c.id === "string" && isInt(c.oi) && c.oi >= 0 && isInt(c.mark) && c.mark > 0 && isInt(c.mult) && c.mult > 0;

const valueOf = (c) => times(times(c.mult, c.oi), c.mark);

export function stockRecon(input) {
  if (!input || !Array.isArray(input.prev) || !Array.isArray(input.curr) || !input.prev.length || !input.curr.length) {
    return { status: "absent", reason: NO_OPEN_INTEREST };
  }
  const { prevDay, currDay } = input;
  const opening = isInt(input.openingCents) ? input.openingCents : null;
  const excluded = { prev: 0, curr: 0, alive: 0 };
  const prev = new Map();
  for (const c of input.prev) {
    if (!usable(c)) { excluded.prev += 1; continue; }
    prev.set(c.id, c);
  }
  const curr = new Map();
  for (const c of input.curr) {
    if (!usable(c)) { excluded.curr += 1; continue; }
    curr.set(c.id, c);
  }
  const lines = { added: 0, reval: 0, expired: 0, new: 0, adjusted: 0, unmatched: 0, dropped: 0 };
  const counts = { alive: 0, expired: 0, listed: 0, adjusted: 0, unmatched: 0, dropped: 0 };
  let addedPlus = 0;
  let netOi = 0;
  const taken = new Set();
  for (const c of curr.values()) {
    if (prev.has(c.id) && prev.get(c.id).mult !== c.mult) {
      const p = prev.get(c.id);
      taken.add(p.id);
      lines.adjusted = plus(lines.adjusted, valueOf(c) - valueOf(p));
      counts.adjusted += 1;
    } else if (prev.has(c.id)) {
      const p = prev.get(c.id);
      taken.add(p.id);
      lines.added = plus(lines.added, times(times(p.mult, p.mark), c.oi - p.oi));
      lines.reval = plus(lines.reval, times(times(c.mult, c.oi), c.mark - p.mark));
      if (c.oi > p.oi) addedPlus = plus(addedPlus, times(times(p.mult, p.mark), c.oi - p.oi));
      netOi += c.oi - p.oi;
      counts.alive += 1;
    } else if (typeof c.from === "string" && c.from) {
      if (prev.has(c.from) && !taken.has(c.from)) {
        taken.add(c.from);
        lines.adjusted = plus(lines.adjusted, valueOf(c) - valueOf(prev.get(c.from)));
        counts.adjusted += 1;
      } else {
        lines.unmatched = plus(lines.unmatched, valueOf(c));
        counts.unmatched += 1;
      }
    } else {
      lines.new = plus(lines.new, valueOf(c));
      counts.listed += 1;
    }
  }
  for (const p of prev.values()) {
    if (taken.has(p.id)) continue;
    const expiredHere = typeof p.expires === "string" && typeof prevDay === "string" && typeof currDay === "string" && p.expires > prevDay && p.expires <= currDay;
    if (expiredHere) { lines.expired = plus(lines.expired, -valueOf(p)); counts.expired += 1; } else { lines.dropped = plus(lines.dropped, -valueOf(p)); counts.dropped += 1; }
  }
  let before = 0;
  for (const p of prev.values()) before = plus(before, valueOf(p));
  let after = 0;
  for (const c of curr.values()) after = plus(after, valueOf(c));
  const sum = [lines.added, lines.reval, lines.expired, lines.new, lines.adjusted, lines.unmatched, lines.dropped].reduce(plus, 0);
  const identityDiff = before + sum - after;
  let residual;
  if (opening === null) residual = { status: "absent", reason: "opening premium is not available" };
  else if (netOi < 0) residual = { status: "absent", reason: NET_CLOSING };
  else if (addedPlus === 0) residual = { status: "absent", reason: "no position was added" };
  else residual = { status: "ok", added: addedPlus, opening, unexplained: addedPlus - opening, pct: ((addedPlus - opening) / addedPlus) * 100 };
  return { status: "ok", before, after, lines, counts, identityDiff, residual, excluded, memo: isInt(input.sameSessionCents) ? { sameSession: input.sameSessionCents } : null };
}
