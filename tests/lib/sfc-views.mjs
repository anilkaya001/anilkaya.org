import { makeWorld } from "./sfc-world.mjs";
import { storedInput, NOW_INTRADAY, NOW_AFTER, breadthFor, recordFor } from "./sfc-stored.mjs";
import { workedExample } from "./sfc-golden.mjs";
import { ledgerView } from "../../shared/flows-sfc-view.js";
import { runProduction } from "./sfc-run.mjs";
import { SECTORS } from "../../shared/flows-sfc.js";

export const SAT = Date.parse("2026-10-24T15:00:00Z");

export const FRI_EVENING = Date.parse("2026-10-23T22:30:00Z");

const fresh = (world, extra = {}) => storedInput(world, extra);

export function fixtures() {
  const out = new Map();
  const w = makeWorld(777, { tickers: 24, perName: 18, pathologies: false });
  out.set("all", fresh(w));
  const held = runProduction(w);
  const sector = SECTORS.find((c) => held.columns.has(c));
  out.set("sector", { ...fresh(w), scope: { kind: "sector", sector, key: "sector:" + sector } });
  out.set("funds", { ...fresh(w), scope: { kind: "sector", sector: "Index & ETF", key: "sector:Index & ETF" } });
  out.set("nosector", { ...fresh(w), scope: { kind: "sector", sector: "No sector", key: "sector:No sector" } });
  const name = [...new Set(w.rows.map((r) => r.t))].find((t) => t.startsWith("SY")) || w.rows[0].t;
  out.set("name", { ...fresh(w), scope: { kind: "name", name, key: "name:" + name } });
  out.set("missing-name", { ...fresh(w), scope: { kind: "name", name: "SYZ999", key: "name:SYZ999" } });
  out.set("shed", fresh(w, { shed: 31 }));
  const pathological = makeWorld(31, { tickers: 30, perName: 20, pathologies: true });
  out.set("pathological", fresh(pathological));
  const notide = fresh(w);
  out.set("no-tide", { ...notide, breadth: null });
  const g = workedExample();
  const gin = fresh(makeWorld(5, { tickers: 1, perName: 0, pathologies: false }));
  out.set("worked", { ...gin, live: { ...gin.live, payload: { ...gin.live.payload, rows: g.rows, record: { date: g.session || "2026-10-23", everEntered: g.rows.length + 4, shed: 4 } } }, universe: g.universe, breadth: { payload: breadthFor({ session: "2026-10-23", tide: g.tide }, { end: gin.live.readAt }) } });
  out.set("saturday", { ...fresh(w, { now: SAT }), now: SAT });
  out.set("after-close", { ...fresh(w, { now: FRI_EVENING, liveAt: Date.parse("2026-10-23T20:58:00Z") }), now: FRI_EVENING });
  out.set("stale-live", { ...fresh(w, { liveAt: NOW_INTRADAY - 45 * 60000 }) });
  const empty = makeWorld(9, { tickers: 3, perName: 0, pathologies: false });
  out.set("quiet", fresh(empty));
  out.set("failed", { ...fresh(w), live: { payload: { ...recordFor(w), rows: "nope" }, readAt: NOW_INTRADAY - 60000, session: w.session } });
  out.set("session", { ...fresh(w, { now: NOW_AFTER, liveAt: Date.parse("2026-10-24T00:30:00Z") }), now: NOW_AFTER, period: "session" });
  out.set("five", { ...fresh(w), period: "five" });
  return out;
}

export const viewsOf = (fn = ledgerView) => [...fixtures()].map(([id, input]) => [id, fn(input)]);

export function cellsOf(value, out = []) {
  if (Array.isArray(value)) for (const v of value) cellsOf(v, out);
  else if (value !== null && typeof value === "object") {
    if (typeof value.t === "string" && typeof value.s === "string") out.push(value);
    for (const v of Object.values(value)) cellsOf(v, out);
  }
  return out;
}

export { NOW_INTRADAY, NOW_AFTER, breadthFor, recordFor, fresh };
