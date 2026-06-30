/* =============================================================
   worker.js — Cloudflare Worker (Static Assets + API).
   Serves the static site via the ASSETS binding and handles the
   dynamic routes (/auth/*, /api/*) with D1-backed Google sign-in.
   Replaces the Pages functions/ directory.
   ============================================================= */
import { signSession, verifySession, getCookie, cookie } from "./shared/session.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

async function currentUser(request, env) {
  const token = getCookie(request, "session");
  if (token && env.SESSION_SECRET) {
    const p = await verifySession(token, env.SESSION_SECRET);
    if (p) return { id: p.sub, email: p.email, name: p.name };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;

    // --- Start Google OAuth ---
    if (path === "/auth/google") {
      const state = crypto.randomUUID();
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: origin + "/auth/callback",
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "online",
        prompt: "select_account",
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
          "Set-Cookie": cookie("oauth_state", state, { maxAge: 600 }),
        },
      });
    }

    // --- OAuth callback ---
    if (path === "/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const saved = getCookie(request, "oauth_state");
      if (!code || !state || state !== saved) return Response.redirect(origin + "/lab/?auth=error", 302);

      const tok = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: origin + "/auth/callback",
          grant_type: "authorization_code",
        }),
      }).then((r) => r.json()).catch(() => ({}));
      if (!tok.access_token) return Response.redirect(origin + "/lab/?auth=error", 302);

      const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + tok.access_token },
      }).then((r) => r.json()).catch(() => ({}));
      if (!info.sub) return Response.redirect(origin + "/lab/?auth=error", 302);

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
      const headers = new Headers({ Location: origin + "/lab/?auth=ok" });
      headers.append("Set-Cookie", cookie("session", session, { maxAge: 60 * 60 * 24 * 30 }));
      headers.append("Set-Cookie", cookie("oauth_state", "", { maxAge: 0 }));
      return new Response(null, { status: 302, headers });
    }

    // --- Logout ---
    if (path === "/auth/logout") {
      return new Response(null, {
        status: 302,
        headers: { Location: origin + "/lab/", "Set-Cookie": cookie("session", "", { maxAge: 0 }) },
      });
    }

    // --- Who am I ---
    if (path === "/api/me") {
      return json({ user: await currentUser(request, env) });
    }

    // --- Progress ---
    if (path === "/api/progress") {
      const user = await currentUser(request, env);
      if (!user) return new Response("Unauthorized", { status: 401 });

      if (request.method === "GET") {
        const progress = {};
        if (env.DB) {
          const rows = await env.DB.prepare("SELECT model_id, done_json FROM progress WHERE user_id = ?").bind(user.id).all();
          for (const r of rows.results || []) {
            try { progress[r.model_id] = { done: JSON.parse(r.done_json || "[]") }; } catch { /* skip */ }
          }
        }
        return json({ progress });
      }
      if (request.method === "PUT") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body.model !== "string" || !Array.isArray(body.done)) return new Response("Bad request", { status: 400 });
        if (env.DB) {
          await env.DB.prepare(
            "INSERT INTO progress (user_id, model_id, done_json, updated_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(user_id, model_id) DO UPDATE SET done_json=excluded.done_json, updated_at=excluded.updated_at"
          ).bind(user.id, body.model, JSON.stringify(body.done), Date.now()).run();
        }
        return json({ ok: true });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // --- Points & streak ---
    if (path === "/api/stats") {
      const user = await currentUser(request, env);
      if (!user) return new Response("Unauthorized", { status: 401 });
      if (request.method === "GET") {
        let stats = { points: 0, streak: 0, last: null };
        if (env.DB) {
          const row = await env.DB.prepare("SELECT points, streak, last FROM stats WHERE user_id = ?").bind(user.id).first();
          if (row) stats = { points: row.points || 0, streak: row.streak || 0, last: row.last || null };
        }
        return json({ stats });
      }
      if (request.method === "PUT") {
        const b = await request.json().catch(() => null);
        if (!b) return new Response("Bad request", { status: 400 });
        if (env.DB) {
          await env.DB.prepare(
            "INSERT INTO stats (user_id, points, streak, last, updated_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(user_id) DO UPDATE SET points=excluded.points, streak=excluded.streak, last=excluded.last, updated_at=excluded.updated_at"
          ).bind(user.id, b.points | 0, b.streak | 0, b.last || null, Date.now()).run();
        }
        return json({ ok: true });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // --- Everything else: static assets (index.html, /lab/, css, js, ...) ---
    return env.ASSETS.fetch(request);
  },
};
