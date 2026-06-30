/* GET /api/me — who am I? Returns { user: {...} | null }. */
export function onRequestGet({ data }) {
  return Response.json({ user: data.user || null });
}
