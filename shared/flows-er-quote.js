import { centsOf } from "./flows-sides.js";
import { vnum } from "./flows-cross.js";

export const QUOTE_SESSIONS = Object.freeze(["regular", "premarket", "postmarket"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const cents = (v) => {
  if (v === null || v === undefined) return null;
  const c = centsOf(typeof v === "number" ? String(v) : v);
  return c && Number.isSafeInteger(c.cents) && c.cents > 0 ? c.cents : null;
};

const instantMs = (v) => {
  const n = vnum(v);
  return n !== null && n > 946684800000 && n < 4102444800000 ? new Date(Math.round(n)).toISOString() : null;
};

const size = (v) => {
  const n = vnum(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};

const level = (l) => {
  if (!isObj(l)) return null;
  const pxC = cents(l.price);
  return pxC === null ? null : { pxC, size: size(l.size) };
};

export function shapeQuote(ticker, raw, readAtMs) {
  const readAt = new Date(readAtMs).toISOString();
  const d = isObj(raw) && isObj(raw.data) ? raw.data : null;
  if (d === null) return { t: ticker, status: "unavailable", why: "unshaped", readAt, last: null, bid: null, ask: null, quoteAt: null, session: null };
  const lt = isObj(d.last_trade) ? d.last_trade : null;
  const pxC = lt ? cents(lt.price) : null;
  const last = lt && pxC !== null ? { pxC, at: instantMs(lt.time), vol: size(lt.vol) } : null;
  const q = isObj(d.quote) ? d.quote : null;
  const bid = q ? level(q.bid) : null;
  const ask = q ? level(q.ask) : null;
  const session = QUOTE_SESSIONS.includes(d.market_time) ? d.market_time : null;
  const out = {
    t: ticker,
    status: last || bid || ask ? "ok" : "quiet",
    ...(last || bid || ask ? {} : { why: "no_quote" }),
    readAt, last, bid, ask, quoteAt: q ? instantMs(q.time) : null, session,
  };
  if (bid && ask && ask.pxC <= bid.pxC) out.crossed = 1;
  return out;
}
