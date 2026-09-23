import { read, rowsOf, pastDeadline } from "./common.mjs";
import {
  latestShortInterest, borrowSummary, shortVolumeSummary, insiderSummary, groupInsiderRows,
  squeezePressure,
} from "../../shared/flows-ownership.js";
import { addDays, shortIntOf, SILENCE } from "../../shared/flows-cross.js";

export const BORROW_LOOKBACK_DAYS = 12;

const notRead = (why) => ({ status: "unavailable", reason: SILENCE.unread, why });

export async function readDeepOwnership(uw, tickers, {
  sessionDate = null, deadline = null, pool = null, width = 1,
} = {}) {
  const out = new Map();
  let calls = 0;
  const work = async (t) => {
    if (pastDeadline(deadline)) return;
    const borrow = await read(uw, `/api/shorts/${t}/data`, {
      ...(sessionDate ? { newer_than: addDays(sessionDate, -BORROW_LOOKBACK_DAYS) } : {}),
    });
    const volume = await read(uw, `/api/shorts/${t}/volume-and-ratio`, {}, { envelope: true });
    calls += 2;
    out.set(t, { borrow, volume });
  };
  const list = [...new Set(tickers)];
  if (pool) await pool(list, work, { width, stopEarly: () => pastDeadline(deadline) });
  else for (const t of list) await work(t);
  return { byTicker: out, calls };
}

export function ownershipParts({
  tickers = [], deepTickers = [], shortInterestRows = [], insiderRows = [], deep = new Map(),
  screenerByTicker = new Map(), sessionDate = null, insidersRead = true, shortRead = true,
  shortUnread = new Map(), insiderUnread = new Map(), insiderPartial = new Set(),
} = {}) {
  const si = latestShortInterest(shortInterestRows, { sessionDate });
  const insiders = groupInsiderRows(insiderRows);
  const deepSet = new Set(deepTickers);
  const parts = new Map();
  const squeezeInputs = [];

  for (const t of tickers) {
    const d = deep.get(t);
    const borrow = !deepSet.has(t) ? notRead("only the deep names carry a borrow read")
      : !d ? notRead("the deep read did not run before the deadline")
        : d.borrow.ok ? borrowSummary(rowsOf(d.borrow.body), { sessionDate })
          : { status: "unavailable", reason: d.borrow.gated ? SILENCE.gated : SILENCE.unreadable, http: d.borrow.status };
    const volume = !deepSet.has(t) ? notRead("only the deep names carry a short-volume read")
      : !d ? notRead("the deep read did not run before the deadline")
        : d.volume.ok ? shortVolumeSummary(rowsOf(d.volume.body, "si"), { sessionDate })
          : { status: "unavailable", reason: d.volume.gated ? SILENCE.gated : SILENCE.unreadable, http: d.volume.status };
    const interest = si.byTicker.get(t) || null;
    const row = screenerByTicker.get(t) || null;
    const measured = interest || borrow.status === "ok" || volume.status === "ok";
    const interestSilence = shortUnread.get(t) || null;
    const short = {
      status: measured ? "ok" : interestSilence ? "unavailable" : "quiet",
      interest: interest ? { ...interest }
        : interestSilence ? { ...interestSilence }
          : shortRead ? { status: "quiet", reason: SILENCE.absent }
            : notRead("the short-interest batch was not read"),
      siScreener: row ? shortIntOf(row) : null,
      borrow,
      volume,
      squeeze: null,
    };
    if (deepSet.has(t)) {
      const fresh = interest && interest.stale === false ? interest : null;
      squeezeInputs.push({
        t,
        si: fresh ? fresh.si : null,
        dtc: fresh ? fresh.dtc : null,
        fee: borrow.status === "ok" ? borrow.fee : null,
      });
    }
    const ins = insiderUnread.has(t) ? { ...insiderUnread.get(t) }
      : insidersRead ? insiderSummary(insiders.get(t) || [], { sessionDate })
        : notRead("the insider batch was not read");
    if (insiderPartial.has(t) && !insiderUnread.has(t)) {
      ins.complete = false;
      ins.why = "the batch this name was read in still had more pages when the read stopped, so older transactions can be missing";
    }
    parts.set(t, { short, insiders: ins });
  }

  const squeeze = squeezePressure(squeezeInputs);
  for (const [t, s] of squeeze) {
    const p = parts.get(t);
    if (p) {
      p.short.squeeze = {
        ...s,
        rule: "z(si_float) + z(days_to_cover) + z(fee) across the deep names, sample sd; null when any leg is absent or the settlement is stale",
      };
    }
  }
  return { parts, future: si.future };
}
