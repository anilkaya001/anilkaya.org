#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_HEALTH_PATH = "/api/health";
export const DEFAULT_PAGE_PATH = "/flows/login/";
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_FAIL_AFTER = 2;
export const DEFAULT_WEBHOOK_ENV = "PROBE_WEBHOOK_URL";
export const SECURITY_HEADERS = Object.freeze([
  "strict-transport-security", "x-content-type-options", "referrer-policy", "x-frame-options",
  "cross-origin-opener-policy", "permissions-policy", "x-permitted-cross-domain-policies",
]);

export function baseOf(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("base must be an absolute http(s) URL"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("base must be an absolute http(s) URL");
  if (url.username || url.password) throw new Error("base must not carry credentials");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function timed(fetchImpl, url, init, timeoutMs, now) {
  const started = now();
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    return { response, body, ms: now() - started, error: null };
  } catch (error) {
    const name = error && error.name ? error.name : "Error";
    return { response: null, body: "", ms: now() - started, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

const verdict = (name, url, result, problems) => ({
  name, url, ok: problems.length === 0, status: result.response ? result.response.status : null, ms: result.ms,
  reason: problems.length ? problems.join("; ") : null,
});

export async function checkHealth(base, path, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = {}) {
  const url = new URL(path, base).toString();
  const result = await timed(fetchImpl, url, { redirect: "manual", headers: { Accept: "application/json" } }, timeoutMs, now);
  const problems = [];
  if (result.error) problems.push(result.error);
  else {
    if (result.response.status !== 200) problems.push("status " + result.response.status);
    let body = null;
    try { body = JSON.parse(result.body); } catch { body = null; }
    if (!/^application\/json/i.test(result.response.headers.get("content-type") || "")) problems.push("not JSON");
    else if (body === null || typeof body !== "object") problems.push("unreadable body");
    else if (Object.hasOwn(body, "ok") && body.ok !== true) problems.push("ok is " + JSON.stringify(body.ok));
  }
  return verdict("health", url, result, problems);
}

export async function checkPage(base, path, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = {}) {
  const url = new URL(path, base).toString();
  const result = await timed(fetchImpl, url, { redirect: "manual", headers: { Accept: "text/html" } }, timeoutMs, now);
  const problems = [];
  if (result.error) problems.push(result.error);
  else {
    if (result.response.status !== 200) problems.push("status " + result.response.status);
    if (!/^text\/html/i.test(result.response.headers.get("content-type") || "")) problems.push("not HTML");
    else if (!/<title>[^<]+<\/title>/i.test(result.body)) problems.push("no title");
  }
  return verdict("page", url, result, problems);
}

export async function probeOnce(options) {
  const base = options.base;
  const shared = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, now: options.now };
  const checks = await Promise.all([
    checkHealth(base, options.healthPath || DEFAULT_HEALTH_PATH, shared),
    checkPage(base, options.pagePath || DEFAULT_PAGE_PATH, shared),
  ]);
  return { ok: checks.every((check) => check.ok), checks };
}

const header = (response, name) => response.headers.get(name) || "";

export async function smoke(base, { fetchImpl = fetch, timeoutMs = 10000, now = Date.now } = {}) {
  const results = [];
  const get = (path, init = {}) => timed(fetchImpl, new URL(path, base).toString(), { redirect: "manual", ...init }, timeoutMs, now);
  const record = (name, path, result, problems) => results.push(verdict(name, new URL(path, base).toString(), result, result.error ? [result.error] : problems));
  const json = (result) => { try { return JSON.parse(result.body); } catch { return null; } };

  {
    const r = await get("/");
    const problems = [];
    if (!r.error) {
      if (r.response.status !== 200) problems.push("status " + r.response.status);
      for (const name of SECURITY_HEADERS) if (!header(r.response, name)) problems.push("missing " + name);
      if (!/no-cache/i.test(header(r.response, "cache-control"))) problems.push("HTML is not no-cache");
      if (!header(r.response, "content-security-policy")) problems.push("missing content-security-policy");
      if (header(r.response, "clear-site-data")) problems.push("clear-site-data is back");
    }
    record("landing page and headers", "/", r, problems);
  }
  {
    const r = await get("/lab/course?m=ols");
    const problems = [];
    if (!r.error) {
      if (r.response.status !== 308) problems.push("status " + r.response.status);
      if (!/\/lab\/ordinary-least-squares\/$/.test(header(r.response, "location"))) problems.push("location " + header(r.response, "location"));
    }
    record("legacy course URL redirects", "/lab/course?m=ols", r, problems);
  }
  {
    const r = await get("/lab/ordinary-least-squares/");
    const problems = [];
    if (!r.error) {
      if (r.response.status !== 200) problems.push("status " + r.response.status);
      if (!/rel="canonical"/i.test(r.body)) problems.push("no canonical link");
      if (!/application\/ld\+json/i.test(r.body)) problems.push("no JSON-LD");
    }
    record("course page is rewritten", "/lab/ordinary-least-squares/", r, problems);
  }
  {
    const r = await get("/api/me", { headers: { Accept: "application/json" } });
    const body = json(r);
    const problems = [];
    if (!r.error) {
      if (r.response.status !== 200) problems.push("status " + r.response.status);
      if (!body || !Object.hasOwn(body, "user") || body.user !== null) problems.push("anonymous /api/me is not { user: null }");
      if (header(r.response, "cache-control") !== "no-store") problems.push("API is not no-store");
    }
    record("anonymous API session", "/api/me", r, problems);
  }
  {
    const r = await get("/api/no-such-route");
    const body = json(r);
    const problems = [];
    if (!r.error) {
      if (r.response.status !== 404) problems.push("status " + r.response.status);
      if (!body || !body.error || typeof body.error.code !== "string") problems.push("not the JSON error envelope");
    }
    record("unknown API route is JSON 404", "/api/no-such-route", r, problems);
  }
  {
    const r = await get("/auth/logout");
    const problems = [];
    if (!r.error && r.response.status !== 405) problems.push("GET logout answered " + r.response.status);
    record("logout is POST only", "/auth/logout", r, problems);
  }
  {
    const r = await get("/api/flows/board", { headers: { Accept: "application/json" } });
    const problems = [];
    if (!r.error) {
      if (r.response.status !== 401) problems.push("anonymous board answered " + r.response.status);
      if (header(r.response, "cache-control") !== "no-store") problems.push("not no-store");
    }
    record("Flows API is gated", "/api/flows/board", r, problems);
  }
  {
    const r = await get("/api/rt/snap?k=px");
    const problems = [];
    if (!r.error && ![401, 403, 404].includes(r.response.status)) problems.push("anonymous rail snapshot answered " + r.response.status);
    record("rail is gated", "/api/rt/snap?k=px", r, problems);
  }
  {
    const version = await get("/assets/version.txt");
    const problems = [];
    let token = "";
    if (!version.error) {
      token = version.body.trim();
      if (version.response.status !== 200) problems.push("status " + version.response.status);
      if (!/^\d+$/.test(token)) problems.push("version is not an integer");
      if (!/max-age=3600/.test(header(version.response, "cache-control"))) problems.push("version token is not one hour");
    }
    record("asset version token", "/assets/version.txt", version, problems);
    if (/^\d+$/.test(token)) {
      const path = "/assets/css/base.css?v=" + token;
      const css = await get(path);
      const cssProblems = [];
      if (!css.error) {
        if (css.response.status !== 200) cssProblems.push("status " + css.response.status);
        if (!/immutable/.test(header(css.response, "cache-control"))) cssProblems.push("versioned CSS is not immutable");
        for (const name of SECURITY_HEADERS) if (!header(css.response, name)) cssProblems.push("missing " + name);
      }
      record("versioned asset is immutable", path, css, cssProblems);
    }
  }
  return { ok: results.every((check) => check.ok), checks: results };
}

export function readState(file) {
  if (!file) return { fails: 0, down: false, since: null };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return {
      fails: Number.isSafeInteger(raw.fails) && raw.fails >= 0 ? raw.fails : 0,
      down: raw.down === true,
      since: typeof raw.since === "string" ? raw.since : null,
    };
  } catch {
    return { fails: 0, down: false, since: null };
  }
}

export function nextState(state, ok, failAfter, at) {
  if (ok) return { next: { fails: 0, down: false, since: null }, event: state.down ? "recovered" : null };
  const fails = state.fails + 1;
  if (!state.down && fails >= failAfter) return { next: { fails, down: true, since: at }, event: "down" };
  return { next: { fails, down: state.down, since: state.since }, event: null };
}

export function messageFor(event, base, probe, since) {
  const host = new URL(base).host;
  if (event === "recovered") return `${host} is answering again${since ? " (was down since " + since + ")" : ""}.`;
  const failing = probe.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.reason}`).join("; ");
  return `${host} is not answering: ${failing}.`;
}

export async function notify(webhookUrl, text, fetchImpl = fetch) {
  if (!webhookUrl) return false;
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function parseArgs(argv) {
  const out = { command: argv[0], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error("unexpected argument " + arg);
    const key = arg.slice(2);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error("--" + key + " needs a value");
    out.flags[key] = value;
  }
  return out;
}

export async function main(argv, env = process.env, io = { out: (line) => process.stdout.write(line + "\n"), err: (line) => process.stderr.write(line + "\n") }, fetchImpl = fetch) {
  let args;
  try { args = parseArgs(argv); } catch (error) { io.err(error.message); return 2; }
  if (!["probe", "smoke"].includes(args.command) || !args.flags.base) {
    io.err("usage: ops-probe.mjs probe|smoke --base https://host [--health /api/health] [--page /flows/login/] [--timeout ms] [--fail-after n] [--state file] [--webhook-env NAME]");
    return 2;
  }
  let base;
  try { base = baseOf(args.flags.base); } catch (error) { io.err(error.message); return 2; }
  const timeoutMs = Number(args.flags.timeout || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) { io.err("--timeout must be between 100 and 60000"); return 2; }

  if (args.command === "smoke") {
    const result = await smoke(base, { fetchImpl, timeoutMs: Math.max(timeoutMs, 10000) });
    io.out(JSON.stringify({ at: new Date().toISOString(), base: base.origin, ...result }));
    return result.ok ? 0 : 1;
  }

  const failAfter = Number(args.flags["fail-after"] || DEFAULT_FAIL_AFTER);
  if (!Number.isSafeInteger(failAfter) || failAfter < 1 || failAfter > 60) { io.err("--fail-after must be an integer from 1 to 60"); return 2; }
  const probe = await probeOnce({
    base, healthPath: args.flags.health, pagePath: args.flags.page, timeoutMs, fetchImpl,
  });
  const at = new Date().toISOString();
  const stateFile = args.flags.state || null;
  const state = readState(stateFile);
  const { next, event } = nextState(state, probe.ok, failAfter, at);
  let notified = false;
  if (event) {
    const hook = env[args.flags["webhook-env"] || DEFAULT_WEBHOOK_ENV];
    notified = await notify(hook, messageFor(event, base.toString(), probe, state.since), fetchImpl);
  }
  if (stateFile) writeFileSync(stateFile, JSON.stringify(next), { mode: 0o600 });
  io.out(JSON.stringify({ at, base: base.origin, ok: probe.ok, event, notified, fails: next.fails, checks: probe.checks }));
  return probe.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
