import { houseWires, limits, previewFor } from "./ff-d-world.mjs";

export const FF_API_VERSION = 1;

export function ffAnswer(pathname, method, body, now) {
  const reply = (fields) => ({ v: FF_API_VERSION, serverNow: now, ...fields });
  if (pathname === "/api/ff/wires" && method === "GET") return reply({ status: "live", wires: [], limits: limits() });
  if (pathname === "/api/ff/house" && method === "GET") return reply({ wires: houseWires() });
  if (pathname === "/api/ff/preview" && method === "POST" && body && body.ast) return reply({ preview: previewFor(body.ast) });
  return null;
}

export async function fulfilFf(route, now) {
  const request = route.request();
  const url = new URL(request.url());
  let body = null;
  try { body = request.postDataJSON(); } catch { body = null; }
  const answer = ffAnswer(url.pathname, request.method(), body, now);
  return route.fulfill({
    status: answer ? 200 : 404, contentType: "application/json",
    body: JSON.stringify(answer || { error: { code: "not_found", message: "Not found" } }),
  });
}
