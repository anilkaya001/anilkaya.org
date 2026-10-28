import { fakeFundsRead, FUNDS_FAKE_SCREENER_GAPS } from "../../scripts/flows-legs/funds-fake.mjs";
import { fundActivity, metaFrom, readList, rowsOf } from "../../shared/flows-floor-funds.js";
import { shapeFunds } from "../../shared/flows-floor-funds-live.js";

export const FUNDS_SESSION = "2026-09-29";

export function screenerBody(session = FUNDS_SESSION) {
  return fakeFundsRead("/api/screener/stocks", { ticker: readList().join(",") }, session);
}

export function nightlyFunds({ session = FUNDS_SESSION, readAt = session + "T20:41:00.000Z", metaFor = 12, reasons = new Map(), drop = [], mode = "on" } = {}) {
  const screener = { rows: rowsOf(screenerBody(session)).filter((r) => !drop.includes(r.ticker)), date: session };
  const volume = new Map(FUNDS_FAKE_SCREENER_GAPS.map((t) => [t, fakeFundsRead(`/api/stock/${t}/options-volume`, {}, session)]));
  const meta = new Map();
  for (const t of readList().slice(0, metaFor)) {
    const m = metaFrom({
      at: readAt,
      info: fakeFundsRead(`/api/etfs/${t}/info`, {}, session),
      weights: fakeFundsRead(`/api/etfs/${t}/weights`, {}, session),
      flow: fakeFundsRead(`/api/etfs/${t}/in-outflow`, {}, session),
    });
    if (m) meta.set(t, m);
  }
  const block = fundActivity({ session, readAt, screener, volume, reasons, meta, mode });
  return { ...block, fixture: true };
}

export function liveFunds({ session = FUNDS_SESSION, at = Date.parse(session + "T19:55:00.000Z"), drop = [] } = {}) {
  const raw = { data: rowsOf(screenerBody(session)).filter((r) => !drop.includes(r.ticker)) };
  return { ...shapeFunds(raw, { at, session, writer: "flows-live" }), fixture: true };
}
