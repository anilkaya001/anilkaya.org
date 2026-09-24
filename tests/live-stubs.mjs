import http from "node:http";
import { easternInstant } from "../shared/flows-freshness.js";
import { fakeLiveVendor } from "../scripts/flows-legs/live-fake.mjs";
import { LIVE_OIDC } from "../shared/flows-oidc.js";

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const TAPE_ROUTE = /^\/api\/stock\/[^/]+\/(net-prem-ticks|spot-exposures)$/;

export async function startStubVendor({ marketSession, marketNow, tapeSession, tapeNow = null } = {}) {
  const hits = new Map();
  const market = fakeLiveVendor({ session: marketSession, now: () => marketNow.value });
  const tapeAt = tapeNow ?? easternInstant(tapeSession, 16 * 60 + 5);
  const tape = fakeLiveVendor({ session: tapeSession, now: tapeAt });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const path = url.pathname;
    hits.set(path, (hits.get(path) || 0) + 1);
    const params = Object.fromEntries(url.searchParams.entries());
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer stub-uw-key") return send(401, { reason: "malformed_token" });
    const stock = /^\/api\/stock\/([^/]+)\/stock-state$/.exec(path);
    if (stock) {
      return send(200, { data: { close: "101.50", high: "102.00", low: "100.10", open: "100.40", volume: 123456,
        total_volume: 123456, market_time: "r", tape_time: new Date().toISOString(), prev_close: "100.00" } });
    }
    try {
      const pick = TAPE_ROUTE.test(path) || (path === "/api/option-trades/flow-alerts" && params.ticker_symbol) ? tape : market;
      send(200, await pick(path, params, { envelope: true }));
    } catch (error) {
      send(404, { error: String(error && error.message) });
    }
  });
  const port = await listen(server);
  return {
    base: `http://127.0.0.1:${port}`, hits,
    count: (re) => Array.from(hits.entries()).filter(([p]) => re.test(p)).reduce((a, [, n]) => a + n, 0),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function oidcIssuer({ kid = "stub-oidc-key" } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, use: "sig", alg: "RS256" };
  delete jwk.key_ops;
  delete jwk.ext;
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims = (now = Date.now(), over = {}) => {
    const s = Math.floor(now / 1000);
    return {
      jti: "stub-" + s, sub: `repo:${LIVE_OIDC.repository}:ref:${LIVE_OIDC.ref}`, aud: LIVE_OIDC.audience,
      ref: LIVE_OIDC.ref, sha: "0".repeat(40), repository: LIVE_OIDC.repository, repository_owner: "anilkaya001",
      repository_id: LIVE_OIDC.repositoryId, repository_owner_id: LIVE_OIDC.ownerId, repository_visibility: "public",
      run_id: "1", run_number: "1", run_attempt: "1", runner_environment: "github-hosted", actor: "github-actions",
      workflow: "flows-live", event_name: "schedule", ref_type: "branch",
      workflow_ref: LIVE_OIDC.workflowRef, job_workflow_ref: LIVE_OIDC.workflowRef, iss: LIVE_OIDC.issuer,
      nbf: s - 600, iat: s, exp: s + 300, ...over,
    };
  };
  const sign = async (body, header = {}) => {
    const input = part({ typ: "JWT", alg: "RS256", kid, ...header }) + "." + part(body);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
    return input + "." + Buffer.from(sig).toString("base64url");
  };
  return { jwk, jwks: { keys: [jwk] }, claims, sign, mint: (now, over) => sign(claims(now, over)) };
}

export async function startStubGithub({ jwks = null } = {}) {
  const dispatches = [];
  let jwksHits = 0;
  const server = http.createServer((req, res) => {
    if (jwks && req.method === "GET" && req.url === "/.well-known/jwks") {
      jwksHits++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      dispatches.push({ method: req.method, path: req.url, auth: req.headers.authorization || null,
        agent: req.headers["user-agent"] || null, body: parsed });
      res.writeHead(204);
      res.end();
    });
  });
  const port = await listen(server);
  return {
    base: `http://127.0.0.1:${port}`, dispatches, jwksHits: () => jwksHits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
