import { rowsOf as unwrapVendorRows } from "./flows-rows.js";

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

const uniq = (list, f) =>
  (Array.isArray(list) ? [...new Set(list.filter((t) => typeof t === "string" && t.trim()).map(f))] : []);

export function newsFields(row) {
  if (!row || typeof row !== "object") return null;
  const headline = text(row.headline);
  if (headline === null) return null;
  const createdAt = text(row.created_at);
  const parsed = createdAt === null ? NaN : Date.parse(createdAt);
  const createdAtMs = Number.isFinite(parsed) ? parsed : null;
  return {
    headline,
    source: text(row.source),
    createdAt, createdAtMs,
    major: row.is_major === null || row.is_major === undefined ? null : Boolean(row.is_major),
    sentiment: text(row.sentiment),
    tickers: uniq(row.tickers, (t) => t.trim().toUpperCase()),
    tags: uniq(row.tags, (t) => t.trim()),
  };
}

export function newsRow(row, at) {
  const fields = newsFields(row);
  if (fields === null) return null;
  return {
    id: `${fields.createdAtMs === null ? "u" : fields.createdAtMs}|${fields.headline.slice(0, 80)}`,
    ts: fields.createdAtMs === null ? at : fields.createdAtMs,
    ...fields,
  };
}

export const NEWS_ROWS = 60;
export const NEWS_VENDOR_LIMIT = 100;

export function shapeNews(raw, { cap = NEWS_ROWS, requested = NEWS_VENDOR_LIMIT } = {}) {
  const wire = unwrapVendorRows(raw);

  let unusable = 0, undatedSeen = 0;
  const shaped = [];
  for (const row of wire) {
    const fields = newsFields(row);
    if (fields === null) { unusable++; continue; }
    if (fields.createdAtMs === null) undatedSeen++;
    shaped.push(fields);
  }

  shaped.sort((a, b) => {
    if (a.createdAtMs === null && b.createdAtMs === null) return 0;
    if (a.createdAtMs === null) return 1;
    if (b.createdAtMs === null) return -1;
    return b.createdAtMs - a.createdAtMs;
  });

  const rows = shaped.slice(0, cap);
  const dated = rows.map((r) => r.createdAtMs).filter((ms) => ms !== null);

  return {
    rows,

    requested, returned: wire.length, kept: rows.length,
    cap, capped: shaped.length > cap, shed: Math.max(0, shaped.length - cap),
    atVendorLimit: wire.length >= requested,
    unusable,

    undatedKept: rows.filter((r) => r.createdAtMs === null).length,
    undatedSeen,

    newest: dated.length ? new Date(Math.max(...dated)).toISOString() : null,
    oldest: dated.length ? new Date(Math.min(...dated)).toISOString() : null,
    ordered: true, orderedBy: "createdAt", orderedDesc: true,

    status: rows.length ? "ok" : (wire.length ? "unreadable" : "quiet"),
    reason: rows.length
      ? null
      : (wire.length
        ? `the headlines feed returned ${wire.length} row(s) and none carried a headline`
        : "the headlines feed was read and returned no rows"),
  };
}
