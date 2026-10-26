export const GOLDEN_SESSION = "2026-10-23";

const at = (minute, extra = 0) => new Date(Date.UTC(2026, 9, 23, 0, 0) + (minute + 4 * 60 + extra) * 60000).toISOString();

export const win = (t, cp, prem, ask, bid, extra = {}) => ({
  t, oc: `${t}261120${cp}00100000${extra.tag || ""}`, cp, k: 100, exp: "2026-11-20", prem, askPrem: ask, bidPrem: bid, floor: false, single: true,
  size: null, px: null, ivStart: null, ivEnd: null, spanStart: at(extra.minute || 600), spanEnd: at((extra.minute || 600) + 5), ...extra,
});

export const workedExample = () => ({
  rows: [
    win("SYA101", "C", 800000, 600000, 200000, { tag: "a" }),
    win("SYA101", "P", 400000, 300000, 100000, { tag: "b" }),
    win("SYB102", "C", 150000, 0, 0, { tag: "c", minute: 610 }),
    win("SYB102", "P", 60000, 0, 0, { tag: "d", floor: true, minute: 620 }),
    win("SYA101", "C", 30000, 0, 0, { tag: "e", single: false, minute: 630 }),
    win("SYB102", "P", 10000, null, null, { tag: "f", minute: 640 }),
  ],
  universe: { t: ["SYA101", "SYB102"], sectors: ["Energy"], sec: [0, 0], cols: { mcap: [1000, 500] }, units: { mcap: ["usd", 1e-8] } },
  tide: { Energy: { calls: 90000000, puts: 15000000 } },
  expected: {
    rows: [
      [-60000000, 60000000, null, null, null, null],
      [20000000, -20000000, null, null, null, null],
      [-30000000, 30000000, null, null, null, null],
      [10000000, -10000000, null, null, null, null],
      [null, null, -15000000, 15000000, null, null],
      [null, null, -6000000, 6000000, null, null],
      [null, null, -3000000, 3000000, null, null],
      [null, null, -1000000, 1000000, null, null],
      [null, null, null, null, -50000000, 50000000],
      [null, null, null, null, 5000000, -5000000],
      [60000000, -60000000, 25000000, -25000000, 45000000, -45000000],
    ],
    total: 145000000,
  },
});

export const tiltGolden = () => {
  const row = (t, cp, size, prem, ask, bid, d, px, tag) => ({ ...win(t, cp, prem, ask, bid, { tag }), size, px, d });
  return {
    rows: [
      row("SYA101", "C", 100, 10000, 7000, 2000, 500000, 200, "w1"),
      row("SYA101", "P", 200, 20000, 5000, 15000, -250000, 200, "w2"),
      row("SYA101", "C", 7, 300, 100, 50, 123457, 200, "w8"),
      row("SYC103", "C", 400, 40000, 30000, 6000, 400000, 125, "w3"),
      row("SYC103", "P", 200, 20000, 2000, 18000, -400000, 125, "w4"),
      row("SYD104", "P", 50, 5000, 4500, 500, -500000, 100, "w5"),
      row("SYD104", "C", 52, 2600, 2000, 600, null, 100, "w6"),
      row("SPY", "P", 1000, 50000, 40000, 5000, -300000, 400, "w7"),
    ],
    universe: {
      t: ["SYA101", "SYB102", "SYC103", "SYD104", "SYE105", "SPY"],
      sectors: ["Technology", "Financial Services", "Energy"],
      sec: [0, 0, 1, 2, null, 0],
      cols: { mcap: [120000, 60000, 90000, 30000, 5000, 999] },
      units: { mcap: ["usd", 1e-8] },
    },
    expected: {
      X: { Technology: 100288066n, "Financial Services": 200000000n, Energy: -20000000n, "Index & ETF": -840000000n },
      U: { Technology: 10864199n, "Financial Services": 20000000n, Energy: 52000000n, "Index & ETF": 120000000n },
      total: 280288066n,
      a: { Energy: 28028807n, "Financial Services": 84086420n, Technology: 168172839n },
      R: { Energy: -48028807n, "Financial Services": 115913580n, Technology: -67884773n },
      W: { Energy: 49886420n, "Financial Services": 32859260n, Technology: 47545680n },
      verdict: { Energy: "undetermined", "Financial Services": "above", Technology: "below" },
    },
  };
};
