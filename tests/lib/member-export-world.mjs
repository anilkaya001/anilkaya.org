export const SESSION = "2026-10-23";
export const UNIVERSE_AT = "2026-10-23T21:10:00.000Z";
export const FLOW_AT = "2026-10-23T21:45:00.000Z";
export const BOARD_AT = "2026-10-23T21:30:00.000Z";

export function columnStore(rows) {
  const keys = Object.keys(rows[0].cols);
  const scales = { sig: 1e5, chg: 1e4, ed: 1, rd: 1 };
  const cols = {};
  const units = {};
  for (const k of keys) {
    cols[k] = rows.map((r) => (r.cols[k] === null ? null : Math.round(r.cols[k] * scales[k])));
    units[k] = ["x", scales[k]];
  }
  return { v: 1, sessionDate: SESSION, generatedAt: UNIVERSE_AT, status: "ok", n: rows.length, t: rows.map((r) => r.t), units, cols };
}

export const UNIVERSE_ROWS = [
  { t: "SYA001", cols: { sig: 0.02, chg: 0.06, ed: 30 } },
  { t: "SYA002", cols: { sig: 0.015, chg: -0.0502, ed: 4 } },
  { t: "SYA003", cols: { sig: null, chg: 0.01, ed: null } },
  { t: "SYA004", cols: { sig: 0, chg: 0.01, ed: 0 } },
  { t: "SYA005", cols: { sig: 0.02, chg: null, ed: 1 } },
  { t: "SYA006", cols: { sig: 0.02, chg: -1, ed: 60 } },
  { t: "SYA007", cols: { sig: 0.03, chg: 0.0001, ed: 21 } },
  { t: "SYA008", cols: { sig: 0.03, chg: -0.0002, ed: 22 } },
];

let seq = 0;
export function win(t, prem, ask, bid, flags = {}) {
  seq += 1;
  const start = "2026-10-23T14:" + String(10 + (seq % 40)).padStart(2, "0") + ":00.000Z";
  return {
    t, oc: t + "261120C00100000", cp: "C", k: 100, exp: "2026-11-20", prem, askPrem: ask, bidPrem: bid,
    sweep: false, floor: false, single: true, spanStart: start, spanEnd: start.replace(":00.000Z", ":30.000Z"), rule: "r" + seq, ...flags,
  };
}

export const FLOW_ROWS = [
  win("SYA001", 1000000, 600000, 200000, { sweep: true }),
  win("SYA001", 500000, 100000, 300000),
  win("SYA001", 2500000, 1500000, 500000, { sweep: true, floor: true }),
  win("SYA001", 250000, null, null),
  win("SYA001", 750000, 250000, 250000),
  win("SYA002", 400000, 300000, 50000),
  win("SYA002", 300000, 100000, 100000),
  win("SYA004", 100000, 90000, 10000),
  win("SYA004", 90000, 80000, 5000),
  win("SYA004", 80000, 70000, 5000),
  win("SYA005", 3000000, 2700000, 100000, { sweep: true }),
  win("SYA005", 2000000, 1800000, 100000, { sweep: true }),
  win("SYA005", 1000000, 900000, 50000, { sweep: false }),
  win("SYA006", 600000, 100000, 480000, { sweep: null, floor: null }),
  win("SYA006", 500000, 50000, 400000, { sweep: true, floor: false }),
  win("SYA006", 400000, 30000, 350000, { sweep: false, floor: false }),
];

export function flowPayload(rows = FLOW_ROWS, extra = {}) {
  return { v: 2, sessionDate: SESSION, generatedAt: FLOW_AT, readAt: FLOW_AT, status: "ok", rows, seen: rows.length, shed: 0, cap: 180, record: { date: SESSION, shed: 0, reset: null }, ...extra };
}

export function boardPayload(side, rows) {
  return { v: 1, side, sessionDate: SESSION, generatedAt: BOARD_AT, rows };
}

export function eventsPayload(rows) {
  return { v: 1, sessionDate: SESSION, generatedAt: UNIVERSE_AT, gateOrigin: SESSION, rows };
}

export function politicalPayload(rows) {
  return { v: 1, sessionDate: SESSION, generatedAt: UNIVERSE_AT, assets: { status: "ok", rows } };
}

export function sources(extra = {}) {
  return {
    universe: columnStore(UNIVERSE_ROWS),
    flowalerts: flowPayload(),
    "board:long": boardPayload("long", [{ t: "SYA001", s: 58 }, { t: "SYA002", s: 12 }]),
    "board:short": boardPayload("short", [{ t: "SYA005", s: -40 }]),
    ...extra,
  };
}

const TOTALS_FLOOR = 25000000n;

export function oracleFlow(rows) {
  const cents = (x) => BigInt(Math.round(x * 100));
  let T = 0n;
  let A = 0n;
  let B = 0n;
  let floorT = 0n;
  let sweepT = 0n;
  let n = 0;
  let floorMissing = false;
  let sweepMissing = false;
  for (const r of rows) {
    const t = cents(r.prem);
    const stated = r.askPrem !== null && r.bidPrem !== null;
    const a = stated ? cents(r.askPrem) : 0n;
    const b = stated ? cents(r.bidPrem) : 0n;
    if (a + b > t || t === 0n) continue;
    n += 1;
    T += t;
    A += a;
    B += b;
    if (r.floor === true) floorT += t; else if (r.floor !== false) floorMissing = true;
    if (r.sweep === true) sweepT += t; else if (r.sweep !== false) sweepMissing = true;
  }
  const digits = (num, den) => {
    const q = (2n * num * 10000n + den) / (2n * den);
    return (q / 10000n).toString() + "." + (q % 10000n).toString().padStart(4, "0");
  };
  const out = { n, T, A, B, floorMissing, sweepMissing };
  if (n === 0) return out;
  out.lo = digits(A, T);
  out.hi = digits(T - B, T);
  out.coverage = digits(A + B, T);
  out.floor = digits(floorT, T);
  out.sweep = digits(sweepT, T);
  const sided = A + B;
  out.shareNull = sided === 0n ? "no_sides" : 5n * sided < 2n * T ? "low_coverage" : sided < TOTALS_FLOOR ? "thin_sided" : null;
  if (out.shareNull === null) {
    out.share = digits(A, sided);
    out.lean = 2n * A > T ? "buyers" : 2n * B > T ? "sellers" : "undetermined";
  }
  return out;
}

export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomWindows(seed, tickers) {
  const rnd = seeded(seed);
  const rows = [];
  for (const t of tickers) {
    const n = Math.floor(rnd() * 7);
    for (let i = 0; i < n; i += 1) {
      const prem = (1 + Math.floor(rnd() * 4000)) * 1000;
      const unstated = rnd() < 0.15;
      const ask = unstated ? null : Math.floor(rnd() * prem * 0.9 / 1000) * 1000;
      const bid = unstated ? null : Math.floor(rnd() * (prem - ask) / 1000) * 1000;
      rows.push(win(t, prem, ask, bid, { sweep: rnd() < 0.5, floor: rnd() < 0.3 }));
    }
  }
  return rows;
}
