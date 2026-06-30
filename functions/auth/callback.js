/* GET /auth/callback — exchange the code, upsert the user, set a session. */
import { signSession, cookie, getCookie } from "../../shared/session.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const base = env.BASE_URL || url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = getCookie(request, "oauth_state");

  if (!code || !state || state !== saved) {
    return Response.redirect(base + "/lab/?auth=error", 302);
  }

  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: base + "/auth/callback",
      grant_type: "authorization_code",
    }),
  }).then((r) => r.json()).catch(() => ({}));

  if (!tok.access_token) return Response.redirect(base + "/lab/?auth=error", 302);

  const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + tok.access_token },
  }).then((r) => r.json()).catch(() => ({}));

  if (!info.sub) return Response.redirect(base + "/lab/?auth=error", 302);
  const user = { sub: "g_" + info.sub, email: info.email || "", name: info.name || info.email || "Learner" };

  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name"
    ).bind(user.sub, user.email, user.name, Date.now()).run();
  }

  const session = await signSession(
    { sub: user.sub, email: user.email, name: user.name, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 },
    env.SESSION_SECRET
  );

  const headers = new Headers({ Location: base + "/lab/?auth=ok" });
  headers.append("Set-Cookie", cookie("session", session, { maxAge: 60 * 60 * 24 * 30 }));
  headers.append("Set-Cookie", cookie("oauth_state", "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}
