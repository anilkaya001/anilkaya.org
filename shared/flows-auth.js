import { signSession, verifySession } from "./session.js";
import { easternDay } from "./flows-freshness.js";

export const FLOWS_AUDIENCE = "flows";
export const LEARN_AUDIENCE = "learn";
export const FLOWS_COOKIE = "flows_session";
export const PBKDF2_ITERATIONS = 10000;
export const FLOWS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export const FLOWS_USERNAMES = Object.freeze([
  "firatgok", "dincersen", "mehmetsen", "ferhatyukselturk", "berkkocak",
  "anilkaya", "isaatceken", "bektastorun", "yigiteyi", "ahmetcan", "canaci",
  "ozgurhatipoglu",
]);

export const MEMBER_NAME = /^[a-z0-9_.-]{3,32}$/;
export const MEMBER_HASH_MAX = 256;
export const MEMBER_EPOCH_MAX = 1000000;
export const MEMBER_SECRET_MAX_BYTES = 5000;
export const THROTTLE_SHARED_BUCKET = "*";

const enc = new TextEncoder();

function b64(bytes) {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s);
}

export async function deriveHash(username, password, pepper, iterations = PBKDF2_ITERATIONS) {
  if (typeof username !== "string" || !username) throw new Error("username required");
  if (typeof password !== "string") throw new Error("password required");
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password + "\u0000" + String(pepper || "")), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode("flows:" + username), iterations },
    key, 256,
  );
  return b64(bits);
}

export function timingSafeEqual(a, b) {
  const x = String(a ?? "");
  const y = String(b ?? "");
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isMemberDay(day) {
  if (typeof day !== "string" || !DAY.test(day)) return false;
  const at = new Date(day + "T00:00:00Z");
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day;
}

export function memberRecord(value) {
  if (typeof value === "string") {
    return value && value.length <= MEMBER_HASH_MAX ? Object.freeze({ hash: value, until: null, epoch: 0 }) : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const hash = Object.hasOwn(value, "hash") ? value.hash : undefined;
  const until = Object.hasOwn(value, "until") ? value.until : null;
  const epoch = Object.hasOwn(value, "epoch") ? value.epoch : 0;
  if (typeof hash !== "string" || !hash || hash.length > MEMBER_HASH_MAX) return null;
  if (until !== null && !isMemberDay(until)) return null;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > MEMBER_EPOCH_MAX) return null;
  return Object.freeze({ hash, until, epoch });
}

export const NO_MEMBERS = Object.freeze(Object.create(null));

let membersMemo = { raw: undefined, members: NO_MEMBERS };

export function readMembers(raw) {
  if (raw === membersMemo.raw) return membersMemo.members;
  let members = NO_MEMBERS;
  if (raw && typeof raw === "string") {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out = Object.create(null);
      for (const name of Object.keys(parsed)) {
        if (!MEMBER_NAME.test(name)) continue;
        const record = memberRecord(parsed[name]);
        if (record) out[name] = record;
      }
      members = Object.freeze(out);
    }
  }
  membersMemo = { raw, members };
  return members;
}

export function parseCredentials(raw) {
  const members = readMembers(raw);
  return Object.keys(members).length ? members : null;
}

export function memberOf(credentials, name) {
  if (!credentials || typeof credentials !== "object") return null;
  if (typeof name !== "string" || !MEMBER_NAME.test(name) || !Object.hasOwn(credentials, name)) return null;
  return memberRecord(credentials[name]);
}

export function memberActive(member, now = Date.now()) {
  if (!member) return false;
  if (member.until === null) return true;
  const today = easternDay(now);
  return typeof today === "string" && today <= member.until;
}

export function throttleAddress(ip) {
  const s = typeof ip === "string" ? ip.trim().toLowerCase() : "";
  if (!s || s.length > 64) return "unknown";
  if (!s.includes(":")) return s;
  if (s.includes(".")) return s.slice(s.lastIndexOf(":") + 1);
  const halves = s.split("::");
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 2 && fill < 1)) return s;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return s;
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64";
}

export function throttleBucket(username) {
  return typeof username === "string" && FLOWS_USERNAMES.includes(username) ? username : THROTTLE_SHARED_BUCKET;
}

export async function verifyCredential(username, password, credentials, pepper, now = Date.now()) {
  const name = typeof username === "string" ? username.trim().toLowerCase() : "";
  const member = memberOf(credentials, name);

  const target = member ? name : "\u0000unknown-user-decoy";
  const derived = await deriveHash(target, typeof password === "string" ? password : "", pepper);

  const expected = member ? member.hash : "\u0000never-matches";
  const matched = timingSafeEqual(derived, expected);
  const active = memberActive(member, now);
  return matched && member && active ? name : null;
}

export const DEFAULT_SESSION_EPOCH = "1";

export function sessionEpoch(env) {
  const raw = env && env.FLOWS_SESSION_EPOCH;
  return typeof raw === "string" && raw ? raw : DEFAULT_SESSION_EPOCH;
}

export async function signFlowsSession(username, secret, ttlSeconds = FLOWS_SESSION_TTL_SECONDS, epoch = DEFAULT_SESSION_EPOCH, memberEpoch = 0) {
  const claims = { sub: username, aud: FLOWS_AUDIENCE, epoch, exp: Date.now() + ttlSeconds * 1000 };
  if (Number.isSafeInteger(memberEpoch) && memberEpoch > 0) claims.uep = memberEpoch;
  return signSession(claims, secret);
}

export async function verifyFlowsSession(token, secret, epoch = DEFAULT_SESSION_EPOCH, members = null, now = Date.now()) {
  const payload = await verifySession(token, secret);
  if (!payload || payload.aud !== FLOWS_AUDIENCE) return null;
  if (payload.epoch !== epoch) return null;

  if (members) {
    const member = memberOf(members, payload.sub);
    if (!member || !memberActive(member, now)) return null;
    const claimed = Object.hasOwn(payload, "uep") ? payload.uep : 0;
    if (claimed !== member.epoch) return null;
  } else if (!FLOWS_USERNAMES.includes(payload.sub)) {
    return null;
  }
  return { username: payload.sub, exp: payload.exp, epoch: payload.epoch };
}

export function isLearnAudience(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.aud === undefined || payload.aud === null) return true;
  return payload.aud === LEARN_AUDIENCE;
}

export const LOCKOUT = Object.freeze({
  maxFailures: 8,
  windowSeconds: 15 * 60,
  lockSeconds: 15 * 60,
});

export function isLocked(record, now = Date.now()) {
  if (!record) return false;
  const windowMs = LOCKOUT.windowSeconds * 1000;
  if (!Number.isFinite(record.first_at) || now - record.first_at > windowMs) return false;
  return Number.isFinite(record.failures) && record.failures >= LOCKOUT.maxFailures;
}

export function staleFailureCutoff(now = Date.now()) {
  return now - LOCKOUT.windowSeconds * 1000;
}

export function nextFailureState(record, now = Date.now()) {
  const windowMs = LOCKOUT.windowSeconds * 1000;
  if (!record || !Number.isFinite(record.first_at) || now - record.first_at > windowMs) {
    return { failures: 1, first_at: now };
  }
  return { failures: (Number(record.failures) || 0) + 1, first_at: record.first_at };
}
