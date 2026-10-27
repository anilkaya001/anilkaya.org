import { ABSENT_MARK, DIGEST_QUADRANTS, LIMITS } from "../shared/ff-contract.js";
import { isTradingDay, phaseAt, shiftDay } from "../shared/flows-freshness.js";
import { tradingSessionsBetween } from "../shared/flows-universe.js";
import { API_VERSION, absent, hitRowView, present, rarityOf, timeView } from "./ff-records.js";

export const DIGEST = Object.freeze({
  windowSessions: 10,
  houseRows: 400,
  houseScan: 800,
  memberRows: 150,
  memberScan: 300,
  fenceDays: 5,
  groupAfter: LIMITS.groupInboxAfter,
  silentSessions: 30,
  hygieneMax: 20,
});

const REAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isRealDay = (text) => {
  if (typeof text !== "string" || !REAL_DAY.test(text)) return false;
  const at = new Date(text + "T00:00:00Z");
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text;
};

export function digestSession({ asked, now, clockRow = null }) {
  const ph = phaseAt(now, clockRow);
  if (ph === null) return { ok: false, code: "calendar" };
  const latest = ph.session || ph.lastClosed;
  if (asked === null || asked === undefined || asked === "") return { ok: true, session: latest, latest };
  if (!isRealDay(asked)) return { ok: false, code: "malformed" };
  if (asked > latest || !isTradingDay(asked, clockRow) || tradingSessionsBetween(asked, latest) > DIGEST.windowSessions) return { ok: false, code: "window", latest };
  return { ok: true, session: asked, latest };
}

const QUADRANT_TITLES = Object.freeze({
  "house-nightly": "House · Nightly",
  "house-live": "House · Live",
  "yours-nightly": "Yours · Nightly",
  "yours-live": "Yours · Live",
});

export function receiptsLine(receipts) {
  if (receipts.length === 0) return ABSENT_MARK + " no receipts for this session";
  const evaluated = receipts.filter((r) => r.status === "evaluated").length;
  const missed = receipts.filter((r) => r.status !== "evaluated");
  if (missed.length === 0) return evaluated + " evaluated";
  const reasons = new Map();
  for (const r of missed) reasons.set(r.reason || "unknown", (reasons.get(r.reason || "unknown") || 0) + 1);
  const text = [...reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => (n > 1 ? k + " ×" + n : k)).join(", ");
  return evaluated + " evaluated, " + missed.length + " not evaluated: " + text;
}

const quadrantOf = (kind, cadence) => (kind === "house" ? "house-" : "yours-") + (cadence === "live" ? "live" : "nightly");

function groupHits(rows, records, view) {
  const byWire = new Map();
  for (const r of rows) {
    if (!byWire.has(r.wire_id)) byWire.set(r.wire_id, []);
    byWire.get(r.wire_id).push(r);
  }
  const groups = [];
  for (const [wire, list] of byWire) {
    const rec = records.get(wire) || null;
    const rarity = rarityOf(rec);
    const grouped = list.length > DIGEST.groupAfter;
    groups.push(Object.freeze({
      wire: Object.freeze({ id: wire, title: list[0].title }),
      count: list.length,
      rarity,
      rarityRank: rarity.v === null ? 0 : rarity.v,
      grouped,
      hits: (grouped ? list.slice(0, DIGEST.groupAfter) : list).map(view),
      more: grouped ? list.length - DIGEST.groupAfter : 0,
    }));
  }
  return groups.sort((a, b) => b.rarityRank - a.rarityRank || b.count - a.count || (a.wire.id < b.wire.id ? -1 : 1));
}

function fenced(rows, limit, edge, session) {
  const fence = shiftDay(session, -DIGEST.fenceDays);
  if (rows.length >= limit) return rows.some((r) => r.session <= fence);
  return edge === null || edge === undefined || edge <= fence;
}

export function buildDigest({ member, session, now, read, clockRow = null }) {
  const records = new Map();
  for (const r of read.houseRecords) records.set(r.wire_id, r);
  for (const r of read.memberRecords) records.set(r.wire_id, r);
  const view = (row) => hitRowView(row, { memberId: member, readSeq: Infinity, houseReadSeq: Infinity, now });
  const completeHouse = fenced(read.houseHits, DIGEST.houseRows, read.houseEdge, session);
  const completeMember = fenced(read.memberHits, DIGEST.memberRows, read.memberEdge, session);
  const hits = { house: read.houseHits.filter((r) => r.session === session), member: read.memberHits.filter((r) => r.session === session) };
  const receipts = [...read.houseReceipts, ...read.memberReceipts];
  const quadrants = DIGEST_QUADRANTS.map((id) => {
    const house = id.startsWith("house");
    const cadence = id.endsWith("live") ? "live" : "nightly";
    const rows = (house ? hits.house : hits.member).filter((r) => quadrantOf(house ? "house" : "yours", r.wire_cadence) === id);
    const own = receipts.filter((r) => (r.layer === "house") === house && (r.cadence === "live" ? "live" : "nightly") === cadence);
    const complete = house ? completeHouse : completeMember;
    const run = cadence === "nightly" ? read.nightly : read.live;
    return Object.freeze({
      id,
      title: QUADRANT_TITLES[id],
      complete,
      incomplete: complete ? null : absent("not_measured", "the newest stored hits do not reach back past this session, so the list may be short"),
      hits: groupHits(rows, records, view),
      total: rows.length,
      receipts: Object.freeze({
        evaluated: own.filter((r) => r.status === "evaluated").length,
        notEvaluated: own.filter((r) => r.status !== "evaluated").length,
        line: receiptsLine(own),
      }),
      run: run
        ? Object.freeze({ status: run.status, finishedAt: run.finished_at ? timeView(run.finished_at, now) : absent("not_measured", "the run has not finished"), names: present(run.names_evaluated, String(run.names_evaluated)) })
        : absent("not_measured", "no run recorded for this session"),
    });
  });
  const silent = read.memberRecords
    .filter((r) => r.sessions >= DIGEST.silentSessions && (r.firings === 0 || r.last_session === null || (tradingSessionsBetween(r.last_session, session) ?? 0) >= DIGEST.silentSessions))
    .slice(0, DIGEST.hygieneMax)
    .map((r) => Object.freeze({
      wire: Object.freeze({ id: r.wire_id, title: r.title }),
      sessions: r.sessions,
      lastHit: r.last_session ? present(r.last_session, r.last_session) : absent("no_hits"),
      text: "No hit in " + DIGEST.silentSessions + " or more sessions",
    }));
  return Object.freeze({ v: API_VERSION, serverNow: now, session, quadrants, hygiene: Object.freeze({ silent }), complete: completeHouse && completeMember });
}
