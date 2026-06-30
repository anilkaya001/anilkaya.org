/* GET /auth/logout — clear the session cookie. */
import { cookie } from "../../shared/session.js";

export async function onRequestGet({ request, env }) {
  const base = env.BASE_URL || new URL(request.url).origin;
  return new Response(null, {
    status: 302,
    headers: { Location: base + "/lab/", "Set-Cookie": cookie("session", "", { maxAge: 0 }) },
  });
}
