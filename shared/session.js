/* Shared, stateless session helpers for the Cloudflare Worker.
   A session is a signed (HMAC-SHA256) token: base64url(json).base64url(sig).
   No server store needed — verification is pure crypto. */

const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  if (typeof s !== "string" || !s || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("invalid base64url");
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function hmacKey(secret) {
  if (typeof secret !== "string" || !secret) throw new Error("session secret missing");
  return crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(payload, secret) {
  if (!payload || typeof payload !== "object") throw new Error("session payload missing");
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + b64url(sig);
}

export async function verifySession(token, secret) {
  if (typeof token !== "string" || token.length > 4096 || !secret) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [body, sig] = parts;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!p || typeof p !== "object" || typeof p.sub !== "string" || !p.sub ||
        !Number.isFinite(p.exp) || Date.now() >= p.exp) return null;
    return p;
  } catch { return null; }
}

export function getCookie(request, name) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

export function cookie(name, value, opts = {}) {
  const parts = [name + "=" + encodeURIComponent(String(value)), "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (opts.maxAge != null) parts.push("Max-Age=" + Math.trunc(opts.maxAge));
  return parts.join("; ");
}
