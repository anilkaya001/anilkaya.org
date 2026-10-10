export const VENDOR_BASE_DEFAULT = "https://api.unusualwhales.com";

export const VENDOR_ENVELOPE = "data";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

const TEST_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+test$/;

export function vendorBaseInfo(raw) {
  if (raw === undefined || raw === null || raw === "") return { base: VENDOR_BASE_DEFAULT, status: "unset" };
  const fallback = { base: VENDOR_BASE_DEFAULT, status: "invalid" };
  if (typeof raw !== "string" || raw.length > 200 || raw !== raw.trim()) return fallback;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return fallback;
  if (!/^[a-z0-9.:/-]+$/i.test(raw)) return fallback;
  const host = url.hostname;
  if (url.origin === VENDOR_BASE_DEFAULT) return { base: VENDOR_BASE_DEFAULT, status: "default" };
  if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
  if (LOOPBACK.has(host) || TEST_HOST.test(host)) return { base: url.origin, status: "redirect" };
  return fallback;
}

export const vendorBase = (env) => vendorBaseInfo(env && env.UW_BASE).base;

export const vendorRedirected = (env) => vendorBaseInfo(env && env.UW_BASE).status === "redirect";

export function vendorUrl(base, path, params) {
  const url = new URL(base + path);
  for (const [name, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  return url;
}

export function unwrap(raw) {
  if (isObj(raw) && Object.hasOwn(raw, VENDOR_ENVELOPE) && (isObj(raw.data) || Array.isArray(raw.data))) return raw.data;
  return raw;
}

export function classifyStatus(status) {
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  if (status >= 200 && status < 300) return null;
  return "http_4xx";
}

export function retryAfterMs(value, now) {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = Number(value);
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
  const d = Date.parse(value);
  return Number.isFinite(d) ? Math.max(0, d - now) : null;
}
