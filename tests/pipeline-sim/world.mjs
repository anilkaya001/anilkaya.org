import { makeRng } from "../truth/rng.mjs";

export function world(seed, label) {
  const rng = makeRng(label + ":" + seed);
  const trace = [];
  const violations = [];
  const self = {
    seed, label, rng, trace, violations, checks: 0, events: 0,
    uniform: () => rng.uniform(),
    int: (n) => Math.floor(rng.uniform() * n),
    pick: (list) => list[Math.floor(rng.uniform() * list.length)],
    chance: (p) => rng.uniform() < p,
    weighted(entries) {
      const total = entries.reduce((a, e) => a + e[0], 0);
      let r = rng.uniform() * total;
      for (const e of entries) { r -= e[0]; if (r < 0) return e[1]; }
      return entries[entries.length - 1][1];
    },
    log(line) {
      self.events++;
      trace.push(String(line));
      if (trace.length > 400) trace.shift();
    },
    check(condition, message) {
      self.checks++;
      if (!condition) violations.push({ seed, label, message, trace: trace.slice(-24) });
      return !!condition;
    },
  };
  return self;
}

export const tickers = (w, n) => {
  const out = new Set();
  while (out.size < n) {
    const len = 2 + w.int(3);
    let t = "";
    for (let i = 0; i < len; i++) t += String.fromCharCode(65 + w.int(26));
    out.add(t);
  }
  return [...out];
};

export function report(results) {
  const violations = results.flatMap((r) => r.violations);
  return { violations, checks: results.reduce((a, r) => a + (r.checks || 0), 0), events: results.reduce((a, r) => a + (r.events || 0), 0) };
}
