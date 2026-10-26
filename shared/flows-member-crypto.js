const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const SALT = enc.encode("flows-member-state/v1/salt");
const KID_INFO = enc.encode("flows-member-state/v1/kid");
const KEY_INFO = "flows-member-state/v1/watchlist|";
const AAD_PREFIX = "flows-member-state/v1|";
const MEMBER_RE = /^[a-z0-9_.-]{3,32}$/;
const NAME_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export const MAX_NAMES = 200;
export const MIN_SECRET_BYTES = 32;
export const IV_BYTES = 12;
export const PLAIN_BYTES = 2624;
export const CT_BYTES = PLAIN_BYTES + 16;
export const CT_CHARS = 3520;
export const IV_CHARS = 16;

export function secretUsable(secret) {
  return typeof secret === "string" && enc.encode(secret).length >= MIN_SECRET_BYTES;
}

function needSecret(secret) {
  if (!secretUsable(secret)) throw new TypeError("member_crypto_secret");
}

function needMember(memberId) {
  if (typeof memberId !== "string" || !MEMBER_RE.test(memberId)) throw new TypeError("member_crypto_member");
}

function needVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("member_crypto_version");
}

const ikm = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveBits", "deriveKey"]);

export function toB64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i += 1) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  try {
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function keyId(secret) {
  needSecret(secret);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: KID_INFO }, await ikm(secret), 32);
  return new DataView(bits).getUint32(0, false);
}

export async function pickSecret(secrets, kid) {
  for (const secret of secrets) {
    if (secretUsable(secret) && (await keyId(secret)) === kid) return secret;
  }
  return null;
}

export async function deriveKey(secret, memberId) {
  needSecret(secret);
  needMember(memberId);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(KEY_INFO + memberId) },
    await ikm(secret),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function aad(memberId, version) {
  needMember(memberId);
  needVersion(version);
  return enc.encode(AAD_PREFIX + memberId + "|" + version);
}

export function canonicalNames(names) {
  if (!Array.isArray(names) || names.some((n) => typeof n !== "string" || !NAME_RE.test(n))) throw new TypeError("member_crypto_names");
  const list = [...new Set(names)].sort();
  if (list.length > MAX_NAMES) throw new TypeError("member_crypto_names");
  return list;
}

function pad(list) {
  const body = enc.encode(JSON.stringify(list));
  if (body.length > PLAIN_BYTES) throw new TypeError("member_crypto_names");
  const out = new Uint8Array(PLAIN_BYTES).fill(0x20);
  out.set(body, 0);
  return out;
}

export async function seal(secret, memberId, version, names, iv) {
  const nonce = iv === undefined ? crypto.getRandomValues(new Uint8Array(IV_BYTES)) : iv;
  if (!(nonce instanceof Uint8Array) || nonce.length !== IV_BYTES) throw new TypeError("member_crypto_iv");
  const plain = pad(canonicalNames(names));
  const key = await deriveKey(secret, memberId);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(memberId, version), tagLength: 128 }, key, plain));
  return { kid: await keyId(secret), iv: toB64(nonce), ct: toB64(sealed) };
}

export async function open(secret, memberId, version, iv, ct) {
  const nonce = fromB64(iv);
  const body = fromB64(ct);
  if (nonce === null || nonce.length !== IV_BYTES || body === null || body.length !== CT_BYTES) throw new TypeError("member_crypto_shape");
  const key = await deriveKey(secret, memberId);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(memberId, version), tagLength: 128 }, key, body);
  const list = JSON.parse(dec.decode(plain));
  const canon = canonicalNames(list);
  if (canon.length !== list.length || canon.some((n, i) => n !== list[i])) throw new TypeError("member_crypto_plain");
  return canon;
}
