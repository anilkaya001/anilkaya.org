export const LIVE_OIDC = Object.freeze({
  issuer: "https://token.actions.githubusercontent.com",
  jwks: "https://token.actions.githubusercontent.com/.well-known/jwks",
  audience: "https://anilkaya.org/api/flows/ingest#live",
  repository: "anilkaya001/anilkaya.org",
  repositoryId: "1284743712",
  ownerId: "107927045",
  workflowRef: "anilkaya001/anilkaya.org/.github/workflows/flows-live.yml@refs/heads/main",
  ref: "refs/heads/main",
  events: Object.freeze(["schedule", "workflow_dispatch"]),
  runner: "github-hosted",
  skewS: 60,
  maxLifeS: 3600,
  maxChars: 8192,
});

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const looksLikeJwt = (s) => typeof s === "string" && s.length <= LIVE_OIDC.maxChars && JWT_RE.test(s);

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function b64urlBytes(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return null;
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  const bytes = b64urlBytes(s);
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

export function decodeJwt(token) {
  if (!looksLikeJwt(token)) return null;
  const [h, p, s] = token.split(".");
  const header = b64urlJson(h);
  const claims = b64urlJson(p);
  const signature = b64urlBytes(s);
  if (!header || !claims || !signature) return null;
  return { header, claims, signature, signed: new TextEncoder().encode(h + "." + p) };
}

export function jwtExpiry(token) {
  const jwt = decodeJwt(token);
  return jwt && Number.isFinite(jwt.claims.exp) ? jwt.claims.exp * 1000 : 0;
}

export function claimsProblem(header, claims, nowS, policy = LIVE_OIDC) {
  if (header.alg !== "RS256") return "alg";
  if (typeof header.kid !== "string" || !header.kid) return "kid";
  if (claims.iss !== policy.issuer) return "iss";
  if (claims.aud !== policy.audience) return "aud";
  if (claims.repository !== policy.repository || claims.repository_id !== policy.repositoryId
    || claims.repository_owner_id !== policy.ownerId) return "repository";
  if (claims.workflow_ref !== policy.workflowRef) return "workflow";
  if (claims.job_workflow_ref !== undefined && claims.job_workflow_ref !== policy.workflowRef) return "workflow";
  if (claims.ref !== policy.ref) return "ref";
  if (!policy.events.includes(claims.event_name)) return "event";
  if (claims.runner_environment !== policy.runner) return "runner";
  const { exp, iat, nbf } = claims;
  if (!Number.isFinite(exp) || !Number.isFinite(iat)) return "time";
  if (exp <= nowS - policy.skewS) return "expired";
  if (iat > nowS + policy.skewS) return "early";
  if (nbf !== undefined && !(Number.isFinite(nbf) && nbf <= nowS + policy.skewS)) return "early";
  if (exp <= iat || exp - iat > policy.maxLifeS) return "lifetime";
  return null;
}

export function inspectLiveOidc(token, now, policy = LIVE_OIDC) {
  const jwt = decodeJwt(token);
  if (!jwt) return { ok: false, why: "malformed" };
  const why = claimsProblem(jwt.header, jwt.claims, Math.floor(now / 1000), policy);
  return why ? { ok: false, why } : { ok: true, jwt };
}

export function rsaKeys(body) {
  const keys = isObj(body) && Array.isArray(body.keys) ? body.keys : [];
  return keys.filter((k) => isObj(k) && k.kty === "RSA" && typeof k.kid === "string" && k.kid
    && typeof k.n === "string" && typeof k.e === "string"
    && (k.alg === undefined || k.alg === "RS256") && (k.use === undefined || k.use === "sig"));
}

export const jwkFor = (keys, kid) => (Array.isArray(keys) ? keys.find((k) => k.kid === kid) || null : null);

export async function rsaVerify(jwt, jwk, subtle = crypto.subtle) {
  try {
    const key = await subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await subtle.verify("RSASSA-PKCS1-v1_5", key, jwt.signature, jwt.signed);
  } catch {
    return false;
  }
}

export async function verifyLiveOidc(token, keys, now, policy = LIVE_OIDC) {
  const seen = inspectLiveOidc(token, now, policy);
  if (!seen.ok) return seen;
  const jwk = jwkFor(keys, seen.jwt.header.kid);
  if (!jwk) return { ok: false, why: "unknown-kid" };
  return (await rsaVerify(seen.jwt, jwk)) ? { ok: true, claims: seen.jwt.claims } : { ok: false, why: "signature" };
}

export async function actionsIdToken(env, { audience = LIVE_OIDC.audience, fetchImpl = fetch } = {}) {
  const url = env && env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error("no GitHub OIDC token: the job needs `permissions: id-token: write`");
  const u = new URL(url);
  u.searchParams.set("audience", audience);
  const res = await fetchImpl(u.toString(), {
    redirect: "error", headers: { Authorization: "Bearer " + bearer, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`the GitHub OIDC token request answered HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body || !looksLikeJwt(body.value)) throw new Error("the GitHub OIDC token request returned no token");
  return body.value;
}
