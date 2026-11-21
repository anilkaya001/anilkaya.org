#!/usr/bin/env node

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseYaml, dumpYaml, YamlError } from "./feed-yaml.mjs";
import { digestSpec, diffDigests, formatDiff, SpecError } from "./uw-spec-diff.mjs";
import { buildCatalog, brandPattern, CatalogError } from "./gen-feed-catalog.mjs";

export const SPEC_FILE = "docs/uw-openapi.yaml";
export const BRANCH = "claude/feed-spec-refresh";
export const ADDRESS_ENV = "FEED_SPEC_ADDRESS";
export const KEY_ENV = "UW_API_KEY";
export const TOKEN_ENV = "GH_TOKEN";
export const REMOTE_ENV = "FEED_SPEC_REMOTE";
export const MIN_PATHS = 200;
export const MAX_BYTES = 20 * 1024 * 1024;
export const TIMEOUT_MS = 30000;
export const DOCS_PAGE = "/docs";
export const MAX_LINKS = 3;
export const MAX_LOST_SHARE = 0.1;
export const COMMITTER = Object.freeze({ name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" });

const REF = "#/components/schemas/";
const VERBS = ["get", "post", "put", "patch", "delete"];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class RefreshError extends Error {}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const ordered = (v) => (Array.isArray(v) ? v.map(ordered) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered(v[k])])) : v);

export const sameDocument = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

export function redactor(key) {
  return (text) => {
    let out = String(text);
    if (typeof key === "string" && key.length) {
      for (const form of [key, encodeURIComponent(key), Buffer.from(key).toString("base64")]) out = out.split(form).join("[key]");
    }
    return out.replace(/(authorization:?\s*(?:bearer|basic)\s+)\S+/gi, "$1[key]");
  };
}

export function feedOrigin(committedText) {
  const doc = parseYaml(committedText);
  const url = isObj(doc) && Array.isArray(doc.servers) && isObj(doc.servers[0]) ? doc.servers[0].url : null;
  try { return new URL(String(url)).origin; } catch { throw new RefreshError("the committed copy names no server, so there is no documentation address to derive"); }
}

export function impliedAddress(committedText, origin) {
  const page = origin + DOCS_PAGE;
  if (!committedText.includes(`${page}/`) && !committedText.includes(`${page}#`)) throw new RefreshError("the committed copy links to no documentation page; give the address of the document");
  return page;
}

export function candidateAddresses(address, origin, committedText) {
  const given = typeof address === "string" ? address.trim() : "";
  if (!given) return [impliedAddress(committedText, origin)];
  let url;
  try { url = new URL(given); } catch { throw new RefreshError("the address is not a URL"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) throw new RefreshError("the address must be https");
  if (url.username || url.password) throw new RefreshError("the address must carry no credentials");
  return [url.href];
}

export const mayCarryKey = (address, origin) => {
  try { return new URL(address).origin === origin; } catch { return false; }
};

export function looksLikeHtml(text, contentType) {
  return /^\s*(?:<!doctype html|<html[\s>])/i.test(text.slice(0, 2048)) || (/\btext\/html\b/i.test(contentType || "") && /^\s*</.test(text));
}

export function documentLinks(html, pageUrl) {
  const out = [];
  const page = new URL(pageUrl);
  for (const m of html.matchAll(/["'(=]\s*([^"'()\s<>]*(?:openapi|swagger)[^"'()\s<>]*)/gi)) {
    if (!m[1].includes("/") && !/\.(?:json|ya?ml)(?:$|[?#])/i.test(m[1])) continue;
    let url;
    try { url = new URL(m[1], page); } catch { continue; }
    if (url.origin !== page.origin || url.href === page.href) continue;
    if (/\.(?:js|css|png|svg|ico|map|html?)(?:$|[?#])/i.test(url.pathname)) continue;
    if (!out.includes(url.href)) out.push(url.href);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export function parseDocument(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (/^\s*\{/.test(body)) {
    try { return { doc: JSON.parse(body), format: "json" }; } catch (error) { throw new RefreshError(`the document does not parse as JSON (${String(error.message).slice(0, 120)})`); }
  }
  if (!body.endsWith("\n")) throw new RefreshError("the document does not end with a line break, so it was cut short");
  try { return { doc: parseYaml(body), format: "yaml" }; } catch (error) {
    if (error instanceof YamlError) throw new RefreshError(`the document does not parse as YAML (${error.message})`);
    throw error;
  }
}

export function checkDocument(doc) {
  if (!isObj(doc)) throw new RefreshError("the document is not an object");
  if (typeof doc.openapi !== "string" || !/^3\./.test(doc.openapi)) throw new RefreshError("the document does not say it is OpenAPI 3");
  if (!isObj(doc.info) || doc.info.version === undefined) throw new RefreshError("the document has no info.version");
  if (!isObj(doc.paths)) throw new RefreshError("the document has no paths");
  const paths = Object.keys(doc.paths);
  if (paths.length < MIN_PATHS) throw new RefreshError(`the document holds ${paths.length} paths, fewer than the ${MIN_PATHS} a whole copy has`);
  if (!Array.isArray(doc.servers) || !isObj(doc.servers[0]) || typeof doc.servers[0].url !== "string") throw new RefreshError("the document names no server, so it was cut short");
  const schemas = isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : null;
  if (!schemas) throw new RefreshError("the document has no component schemas");
  const trimmed = new Set(Object.keys(schemas).map((k) => k.trim()));
  const ids = new Set();
  let operations = 0;
  for (const p of paths) {
    if (!p.startsWith("/")) throw new RefreshError(`a path does not start with a slash: ${p.slice(0, 60)}`);
    const item = doc.paths[p];
    const verbs = isObj(item) ? VERBS.filter((v) => isObj(item[v])) : [];
    if (!verbs.length) throw new RefreshError(`${p} has no operation`);
    for (const v of verbs) {
      const id = item[v].operationId;
      if (typeof id !== "string" || !id) throw new RefreshError(`${v.toUpperCase()} ${p} has no operationId`);
      if (ids.has(id)) throw new RefreshError(`two operations share the operationId ${id}`);
      ids.add(id);
      operations += 1;
    }
  }
  const dangling = [];
  const walk = (node) => {
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "example" || k === "examples") continue;
      if (k === "$ref" && typeof v === "string") {
        if (!v.startsWith(REF) || !(Object.hasOwn(schemas, v.slice(REF.length)) || trimmed.has(v.slice(REF.length).trim()))) dangling.push(v);
      } else walk(v);
    }
  };
  walk(doc.paths);
  walk(schemas);
  if (dangling.length) throw new RefreshError(`${dangling.length} references point at no component, so the document was cut short (first: ${dangling[0].slice(0, 80)})`);
  return { paths: paths.length, operations };
}

export function committedLayout(text, format, doc, operations) {
  if (format !== "yaml") return dumpYaml(doc);
  try {
    return Object.keys(digestSpec(text).ops).length === operations ? text : dumpYaml(doc);
  } catch {
    return dumpYaml(doc);
  }
}

async function getText(fetchImpl, address, headers) {
  let response;
  try {
    response = await fetchImpl(address, { method: "GET", headers, redirect: headers.authorization ? "error" : "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new RefreshError(`the address did not answer (${error && error.name === "TimeoutError" ? "timed out" : "network failure"})`);
  }
  if (response.status !== 200) {
    try { await response.arrayBuffer(); } catch {}
    return { status: response.status, text: null, type: response.headers.get("content-type") || "" };
  }
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); } catch { throw new RefreshError("the transfer broke off before the document was whole"); }
  const declared = Number(response.headers.get("content-length"));
  const encoded = response.headers.get("content-encoding");
  if (!encoded && Number.isInteger(declared) && declared > 0 && declared !== bytes.length) throw new RefreshError("the transfer broke off before the document was whole");
  if (bytes.length > MAX_BYTES) throw new RefreshError("the answer is larger than a document can be");
  return { status: 200, text: bytes.toString("utf8"), type: response.headers.get("content-type") || "" };
}

const ACCEPT = "application/json, application/yaml;q=0.9, text/yaml;q=0.9, */*;q=0.5";

export const placeOf = (address, origin) => (address === origin || address.startsWith(`${origin}/`) ? `(the feed)${address.slice(origin.length) || "/"}` : address);

export async function download({ addresses, origin, key, fetchImpl, note }) {
  const failures = [];
  const at = (address) => placeOf(address, origin);
  for (const first of addresses) {
    const queue = [{ address: first, hop: 0 }];
    while (queue.length) {
      const { address, hop } = queue.shift();
      let got;
      try {
        got = await getText(fetchImpl, address, { accept: ACCEPT, "user-agent": "feed-spec-refresh" });
        if ((got.status === 401 || got.status === 403) && key && mayCarryKey(address, origin)) {
          note(`${at(address)} refused an anonymous request (${got.status}); asking again with the key`);
          got = await getText(fetchImpl, address, { accept: ACCEPT, "user-agent": "feed-spec-refresh", authorization: `Bearer ${key}` });
        }
      } catch (error) {
        if (!(error instanceof RefreshError)) throw error;
        failures.push(`${at(address)}: ${error.message}`);
        continue;
      }
      if (got.status !== 200) { failures.push(`${at(address)}: answered ${got.status}`); continue; }
      if (looksLikeHtml(got.text, got.type)) {
        const links = hop === 0 ? documentLinks(got.text, address) : [];
        if (!links.length) { failures.push(`${at(address)}: answered an HTML page${hop === 0 ? " that links to no document" : ""}`); continue; }
        note(`${at(address)} is a page; following ${links.length} link${links.length === 1 ? "" : "s"} to a document`);
        for (const link of links) queue.push({ address: link, hop: 1 });
        continue;
      }
      try {
        const parsed = parseDocument(got.text);
        const counts = checkDocument(parsed.doc);
        return { address, type: got.type, bytes: Buffer.byteLength(got.text), ...parsed, ...counts, text: got.text };
      } catch (error) {
        if (!(error instanceof RefreshError)) throw error;
        failures.push(`${at(address)}: ${error.message}`);
      }
    }
  }
  throw new RefreshError(failures.length ? failures.join("; ") : "no address was tried");
}

export async function refresh({ root, env = {}, fetchImpl = fetch, out = () => {}, summary = () => {}, write = writeFileSync }) {
  const key = typeof env[KEY_ENV] === "string" ? env[KEY_ENV] : "";
  const redact = redactor(key);
  const target = path.join(root, SPEC_FILE);
  const committed = readFileSync(target, "utf8");
  const origin = feedOrigin(committed);
  const brand = brandPattern(origin);
  const plain = (text) => redact(brand ? String(text).replace(brand, "the feed").replace(/\b([Tt])he the feed\b/g, "$1he feed") : String(text));
  const say = (line) => out(plain(line));
  const addresses = candidateAddresses(env[ADDRESS_ENV], origin, committed);
  let got;
  try {
    got = await download({ addresses, origin, key, fetchImpl, note: say });
  } catch (error) {
    if (error instanceof RefreshError) throw new RefreshError(plain(error.message));
    throw error;
  }
  const text = committedLayout(got.text, got.format, got.doc, got.operations);
  const before = digestSpec(committed);
  let after;
  let catalog;
  try {
    after = digestSpec(text);
    catalog = buildCatalog(text);
  } catch (error) {
    if (error instanceof CatalogError || error instanceof YamlError || error instanceof SpecError) throw new RefreshError(`the document cannot be read back (${error.message})`);
    throw error;
  }
  if (Object.keys(after.ops).length !== got.operations || catalog.ops.length !== got.operations) throw new RefreshError("the rewritten document does not read back with the operations it was given");
  const diff = diffDigests(before, after);
  const lost = Object.keys(before.ops).filter((k) => !Object.hasOwn(after.ops, k)).length;
  if (lost > Math.max(10, MAX_LOST_SHARE * Object.keys(before.ops).length)) throw new RefreshError(`the document lacks ${lost} of the ${Object.keys(before.ops).length} committed operations, so it was cut short or is another document`);
  const report = formatDiff(diff, { from: "committed", to: "downloaded" }).slice(1);
  const changed = text !== committed && !sameDocument(parseYaml(committed), got.doc);
  const head = [
    `address     ${placeOf(got.address, origin)} (${got.type || "no content type"}, ${got.bytes} bytes, ${got.format})`,
    `committed   sha256 ${sha256(committed).slice(0, 12)}  ${Object.keys(before.ops).length} operations, newest change ${before.changelog.slice().sort().pop() || "none"}`,
    `downloaded  sha256 ${sha256(text).slice(0, 12)}  ${got.paths} paths, ${got.operations} operations, ${catalog.channels.length} channels, newest change ${catalog.source.newestChange || "none"}`,
    changed ? `changed     ${SPEC_FILE} is rewritten in the working tree` : "unchanged   the downloaded document says what the committed copy says; nothing is written",
  ];
  for (const line of [...head, ...report]) say(line);
  summary(plain(["### Feed document refresh", "", "```", ...head, "```", "", "```", ...report, "```", ""].join("\n")));
  if (changed) write(target, text);
  return { changed, address: got.address, operations: got.operations, paths: got.paths, diff, text };
}

export function push({ root, env = {}, run = spawnSync, out = () => {} }) {
  const token = typeof env[TOKEN_ENV] === "string" ? env[TOKEN_ENV] : "";
  const redact = redactor(token);
  const git = (args, extra = {}) => {
    const done = run("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...extra } });
    if (done.status !== 0) throw new RefreshError(redact(`git ${args[0]} failed: ${String(done.stderr || done.error || "").trim().slice(0, 300)}`));
    return String(done.stdout || "");
  };
  if (!git(["status", "--porcelain", "--", SPEC_FILE]).trim()) { out("nothing to push: the document did not change"); return { pushed: false }; }
  const remote = env[REMOTE_ENV] || (env.GITHUB_REPOSITORY ? `https://github.com/${env.GITHUB_REPOSITORY}.git` : "");
  if (!remote) throw new RefreshError("no repository to push to");
  if (/^https:/.test(remote) && !token) throw new RefreshError("no token to push with");
  const text = readFileSync(path.join(root, SPEC_FILE), "utf8");
  checkDocument(parseDocument(text).doc);
  if (!BRANCH.startsWith("claude/")) throw new RefreshError("the refresh branch must be a claude/ branch");
  git(["checkout", "-B", BRANCH]);
  git(["add", "--", SPEC_FILE]);
  const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  if (staged.length !== 1 || staged[0] !== SPEC_FILE) throw new RefreshError("more than the document is staged; nothing was pushed");
  git(["-c", `user.name=${COMMITTER.name}`, "-c", `user.email=${COMMITTER.email}`, "commit", "-m", `Refresh the feed's OpenAPI document (${sha256(text).slice(0, 12)})`]);
  const held = Number.parseInt(process.env.GIT_CONFIG_COUNT || "0", 10);
  const slot = Number.isInteger(held) && held > 0 ? held : 0;
  const auth = token ? {
    GIT_CONFIG_COUNT: String(slot + 1),
    [`GIT_CONFIG_KEY_${slot}`]: "http.extraheader",
    [`GIT_CONFIG_VALUE_${slot}`]: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  } : {};
  git(["push", "--force", remote, `HEAD:refs/heads/${BRANCH}`], auth);
  out(`pushed ${SPEC_FILE} to ${BRANCH}`);
  return { pushed: true, branch: BRANCH };
}

export async function main(argv, io = {}) {
  const env = io.env || process.env;
  const out = io.out || ((line) => console.log(line));
  const err = io.err || ((line) => console.error(line));
  const root = io.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const redact = (text) => redactor(env[TOKEN_ENV])(redactor(env[KEY_ENV])(text));
  const known = new Set(["--push"]);
  if (argv.some((a) => !known.has(a))) { err("usage: node scripts/feed-spec-refresh.mjs [--push]"); return 2; }
  try {
    if (argv.includes("--push")) {
      push({ root, env, out, run: io.run || spawnSync });
      return 0;
    }
    const summaryFile = env.GITHUB_STEP_SUMMARY;
    const done = await refresh({
      root, env, out, fetchImpl: io.fetchImpl || fetch,
      summary: (text) => { if (summaryFile) appendFileSync(summaryFile, `${text}\n`); },
    });
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `changed=${done.changed}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof RefreshError)) throw error;
    err(redact(`feed-spec-refresh: ${error.message}`));
    return 1;
  }
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
