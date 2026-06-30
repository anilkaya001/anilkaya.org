/* Runs before every route. Attaches the signed-in user (or null) to
   context.data.user so downstream functions can authorise. */
import { verifySession, getCookie } from "../shared/session.js";

export async function onRequest(context) {
  const { request, env, data } = context;
  data.user = null;
  const token = getCookie(request, "session");
  if (token && env.SESSION_SECRET) {
    const p = await verifySession(token, env.SESSION_SECRET);
    if (p) data.user = { id: p.sub, email: p.email, name: p.name };
  }
  return context.next();
}
