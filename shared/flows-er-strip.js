const parse = (text) => {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export function stripOwner(stored) {
  if (!stored.payload.includes('"owner":{')) return stored;
  const body = parse(stored.payload);
  if (!body || !body.feed || typeof body.feed !== "object") return stored;
  const feed = { ...body.feed };
  delete feed.owner;
  return { ...stored, payload: JSON.stringify({ ...body, feed }) };
}

export function stripEr(stored) {
  if (!stored.payload.includes('"er":{')) return stored;
  const body = parse(stored.payload);
  if (!body || !("er" in body)) return stored;
  const rest = { ...body };
  delete rest.er;
  return { ...stored, payload: JSON.stringify(rest) };
}
