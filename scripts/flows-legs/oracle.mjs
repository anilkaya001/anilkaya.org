import { buildOracle } from "../../shared/flows-oracle.js";
import { normOf } from "./oracle-norm.mjs";
import { stampNow } from "./stamp.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export const ORACLE_BUILD_ENV = "FLOWS_ORACLE_BUILD";

export const oracleBuildOn = (env = process.env) => String(env[ORACLE_BUILD_ENV] === undefined ? "on" : env[ORACLE_BUILD_ENV]).trim().toLowerCase() !== "off";

export const ORACLE_JOB = Object.freeze({
  id: "oracle",
  async run(ticker, ctx) {
    if (!oracleBuildOn() || !ctx || typeof ctx.stored !== "function") return undefined;
    const card = ctx.stored("card:" + ticker);
    if (!isObj(card)) return undefined;
    const cardX = ctx.stored("card-x:" + ticker);
    const row = ctx.byTicker && typeof ctx.byTicker.get === "function" ? ctx.byTicker.get(ticker) : null;
    const sector = isObj(row) ? row.sector || row.sec || null : null;
    return buildOracle({
      ticker, session: ctx.sessionDate, card, cardX: isObj(cardX) ? cardX : null, sector,
      flowNorm: normOf(ctx.oracleNormNow || null, ticker), expectedSession: ctx.sessionDate, now: Date.parse(stampNow()),
    });
  },
});
