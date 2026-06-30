/* /api/progress
   GET — return this user's saved progress: { progress: { model: {done:[...]} } }
   PUT — body { model, done:[...] } upserts one model's progress.
   Both require a signed-in user (401 otherwise). */

export async function onRequestGet({ data, env }) {
  if (!data.user) return new Response("Unauthorized", { status: 401 });
  if (!env.DB) return Response.json({ progress: {} });
  const rows = await env.DB
    .prepare("SELECT model_id, done_json FROM progress WHERE user_id = ?")
    .bind(data.user.id).all();
  const progress = {};
  for (const r of rows.results || []) {
    try { progress[r.model_id] = { done: JSON.parse(r.done_json || "[]") }; } catch { /* skip */ }
  }
  return Response.json({ progress });
}

export async function onRequestPut({ request, data, env }) {
  if (!data.user) return new Response("Unauthorized", { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.model !== "string" || !Array.isArray(body.done)) {
    return new Response("Bad request", { status: 400 });
  }
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO progress (user_id, model_id, done_json, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(user_id, model_id) DO UPDATE SET done_json=excluded.done_json, updated_at=excluded.updated_at"
    ).bind(data.user.id, body.model, JSON.stringify(body.done), Date.now()).run();
  }
  return Response.json({ ok: true });
}
