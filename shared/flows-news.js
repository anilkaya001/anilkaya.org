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
