import { LIVE_KEYS, freshEnvelope } from "./flows-live.js";
import { liveRows, rowsOf } from "./flows-floor-funds.js";

export function shapeFunds(raw, { at, session, writer } = {}) {
  return {
    v: 1, key: "live:funds", session,
    fresh: freshEnvelope({ readAt: at, source: "actions", cadenceS: LIVE_KEYS["live:funds"].cadenceS, session, writer }),
    units: { prem: "usd", vol: "contracts", net: "usd" },
    basis: "whole-session options activity per fund, as the feed reports it",
    rows: liveRows(rowsOf(raw), session),
  };
}
