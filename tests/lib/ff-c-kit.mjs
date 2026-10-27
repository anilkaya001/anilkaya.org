import { isDeepStrictEqual } from "node:util";
import { emitKeys } from "./emit-keys.mjs";
import { nightlyEmit } from "./nightly-emit.mjs";
import { addSessions } from "../../shared/flows-calendar.js";
import { UNITS, metricById } from "../../shared/ff-contract.js";

export function recorder() {
  const fails = [];
  let checks = 0;
  return {
    ok(c, m) {
      checks++;
      if (!c) fails.push(m);
    },
    eq(a, b, m) {
      checks++;
      if (!isDeepStrictEqual(a, b)) fails.push(m + " | got " + JSON.stringify(a)?.slice(0, 160) + " want " + JSON.stringify(b)?.slice(0, 160));
    },
    get fails() {
      return fails;
    },
    get checks() {
      return checks;
    },
  };
}

let emitMemo = null;

export function emit() {
  if (!emitMemo) {
    const { keys } = emitKeys(nightlyEmit());
    emitMemo = keys;
  }
  return emitMemo;
}

export const clone = (x) => JSON.parse(JSON.stringify(x));

export const median = (list) => {
  const v = list.slice().sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export const unpack = (p) => (p && Array.isArray(p.x) ? p.x.map((q) => (q === null || q === undefined ? null : p.s >= 0 ? q * 10 ** p.s : q / 10 ** -p.s)) : []);

export const dateAdd = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function histSeries(h) {
  const base = h.d0;
  const days = h.dd.map((o) => dateAdd(base, o));
  const out = {};
  for (const key of ["np", "vol", "pc"]) {
    const values = unpack(h.volume[key]);
    out[key] = new Map(days.map((d, i) => [d, values[i]]).filter(([, v]) => typeof v === "number"));
  }
  return out;
}

export function makeHist(session, days, np, vol = null, pc = null, over = {}) {
  const d0 = days[0];
  const x = (list) => ({ s: 0, x: list });
  return {
    v: 1, ticker: "SYX101", sessionDate: session, generatedAt: session + "T22:00:00.000Z", fresh: {}, d0, dd: days.map((d) => Math.round((Date.parse(d) - Date.parse(d0)) / 86400000)),
    volume: { asOf: session, np: x(np), vol: x(vol || np.map(() => 1000)), pc: x(pc || np.map(() => 1)) }, ...over,
  };
}

export const priorDays = (session, k) => Array.from({ length: k }, (_, i) => addSessions(session, -(k - i)));

export function zOracle(x, series, session, spec) {
  const days = priorDays(session, 20);
  const log = spec.zSpace === "log";
  const vals = days.map((d) => series.get(d)).filter((v) => typeof v === "number" && (!log || v > 0)).map((v) => (log ? Math.log(v) : v));
  if (vals.length < 15) return { reason: "warming", n: vals.length };
  const xv = log ? Math.log(x) : x;
  const med = median(vals);
  const mad = median(vals.map((v) => Math.abs(v - med)));
  const spread = 1.4826 * mad;
  const lower = Math.max(spec.floor.abs || 0, (spec.floor.rel || 0) * Math.abs(med));
  const scale = Math.max(spread, lower);
  if (!(scale > 0)) return { reason: "thin", n: vals.length };
  return { z: (xv - med) / scale, n: vals.length, floored: spread < lower };
}

export const stepOf = (id) => UNITS[metricById(id).unit].step;

export const quant = (v, id) => {
  const s = stepOf(id);
  const n = Math.round(Number((Math.abs(v) / s).toPrecision(12)));
  return v < 0 && n !== 0 ? -n : n;
};
