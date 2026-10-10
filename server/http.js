import { TICKER_RE } from "../shared/flows-live.js";
import { errorEntry } from "./errors.js";

export const MAX_JSON_BYTES = 16 * 1024;

export class HttpError extends Error {
  constructor(status, code, message, headers, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.details = details;
  }

  static of(code, message, headers, details) {
    const known = errorEntry(code);
    if (known === null) throw new TypeError("HttpError.of: unknown error code " + String(code));
    return new HttpError(known[0], code, message === undefined ? known[1] : message, headers, details);
  }
}

export const errorText = (error) => (error instanceof Error ? error.message : String(error));

export const json = (value, status = 200, headers) => {
  const out = new Headers(headers);
  out.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: out });
};

export const apiError = (status, code, message, headers, details) =>
  json({ error: { code, message }, ...(details || {}) }, status, headers);

export const redirect = (location, status = 302, cookies = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status, headers });
};

export function requireMethod(request, allowed) {
  if (!allowed.includes(request.method)) {
    throw HttpError.of("method_not_allowed", undefined, { Allow: allowed.join(", ") });
  }
}

export function requireSameOrigin(request) {
  const expectedOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  let originMatches = true;
  if (suppliedOrigin !== null) {
    try {
      originMatches = new URL(suppliedOrigin).origin === expectedOrigin;
    } catch {
      originMatches = false;
    }
  }

  if (!originMatches || (fetchSite !== null && fetchSite.trim().toLowerCase() !== "same-origin")) {
    throw HttpError.of("forbidden", "Same-origin request required");
  }
}

export function requireMutationOwner(request, userId) {
  if (request.headers.get("X-IEWT-Owner") !== userId) {
    throw HttpError.of("account_changed");
  }
}

export function requireReadOwnerIfPresent(request, userId) {
  const owner = request.headers.get("X-IEWT-Owner");
  if (owner !== null && owner !== userId) {
    throw HttpError.of("account_changed");
  }
}

export async function readBounded(request, maxBytes, message) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw HttpError.of("payload_too_large", message);
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      throw HttpError.of("payload_too_large", message);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJSON(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw HttpError.of("unsupported_media_type");
  }

  if (!request.body) throw HttpError.of("invalid_json", "A JSON body is required");

  const bytes = await readBounded(request, MAX_JSON_BYTES, "JSON body is too large");
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch {
    throw HttpError.of("invalid_json");
  }
}

export const tickerParam = (url, name = "t") => String(url.searchParams.get(name) || "").trim().toUpperCase();

export function requireTicker(url, name = "t") {
  const ticker = tickerParam(url, name);
  if (!TICKER_RE.test(ticker)) throw HttpError.of("invalid_ticker");
  return ticker;
}

export function keepAlive(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(promise);
  return promise;
}

export const internalKey = (namespace, path) =>
  new Request(`https://flows-${namespace}.internal/${path}`, { method: "GET" });

const edgeHandle = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);

export const edgeCache = Object.freeze({
  handle: edgeHandle,
  async get(key) {
    const cache = edgeHandle();
    return cache ? await cache.match(key).catch(() => null) : null;
  },
  put(key, response) {
    const cache = edgeHandle();
    return cache ? cache.put(key, response).catch(() => {}) : Promise.resolve();
  },
});
