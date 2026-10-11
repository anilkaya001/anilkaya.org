export function rowsOrNull(body, key = "data") {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray(body[key])) return body[key];
  return null;
}

export function rowsOf(body, key = "data") {
  return rowsOrNull(body, key) || [];
}
