/* GET /auth/google — start the Google OAuth flow. */
import { cookie } from "../../shared/session.js";

export async function onRequestGet({ request, env }) {
  const base = env.BASE_URL || new URL(request.url).origin;
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: base + "/auth/callback",
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
