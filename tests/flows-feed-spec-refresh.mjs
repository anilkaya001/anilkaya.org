import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadMutated } from "./truth/mutants.mjs";
import * as refreshModule from "../scripts/feed-spec-refresh.mjs";
import { parseYaml, dumpYaml } from "../scripts/feed-yaml.mjs";
import { brandPattern } from "../scripts/gen-feed-catalog.mjs";
import { digestSpec } from "../scripts/uw-spec-diff.mjs";
import { VENDOR_BASE_DEFAULT } from "../shared/flows-vendor-core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = "docs/uw-openapi.yaml";
const WORKFLOW = ".github/workflows/feed-spec-refresh.yml";
const KEY = "k3y-Never+Printed/0123456789";
const TOKEN = "t0ken-Never+Printed/9876543210";
const COMMITTED = fs.readFileSync(path.join(ROOT, SPEC), "utf8");
const REAL_ORIGIN = new URL(VENDOR_BASE_DEFAULT).origin;
const BRAND = brandPattern(VENDOR_BASE_DEFAULT);

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const temps = [];
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
const sweep = () => { for (const dir of temps.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
process.on("exit", sweep);
const readOr = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };

function makeRoot(specText) {
  const root = tempDir("feed-refresh-");
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, SPEC), specText);
  return root;
}

async function runMain(mod, root, env, extra = {}) {
  const lines = [];
  const summaryFile = path.join(root, "step-summary.md");
  const outputFile = path.join(root, "step-output.txt");
  let code;
  try {
    code = await mod.main(extra.argv || [], {
      root, env: { GITHUB_STEP_SUMMARY: summaryFile, GITHUB_OUTPUT: outputFile, ...env },
      out: (l) => lines.push(String(l)), err: (l) => lines.push(String(l)), fetchImpl: extra.fetchImpl, run: extra.run, origin: extra.origin, timeoutMs: extra.timeoutMs, readMs: extra.readMs,
    });
  } catch (error) {
    code = `threw ${error && error.message}`;
  }
  const printed = [lines.join("\n"), readOr(summaryFile), readOr(outputFile)].join("\n");
  return { code, text: lines.join("\n"), summary: readOr(summaryFile), output: readOr(outputFile), printed, spec: fs.readFileSync(path.join(root, SPEC), "utf8") };
}

function startServer() {
  const routes = new Map();
  const hits = [];
  const timers = new Set();
  const server = http.createServer((req, res) => {
    const route = req.url.split("?")[0];
    hits.push({ route, auth: req.headers.authorization || null });
    const handler = routes.get(route);
    if (!handler) { res.writeHead(404, { "content-type": "text/plain" }); res.end("nothing here"); return; }
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`, routes, hits,
      later: (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); },
      close: () => new Promise((done) => { for (const t of timers) clearTimeout(t); server.closeAllConnections(); server.close(done); }),
    }));
  });
}

const MIB = 1024 * 1024;

function flood(total, { status = 200, declare = null, type = "application/yaml" } = {}) {
  const sent = { bytes: 0, done: false };
  const handler = (req, res) => {
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    const headers = { "content-type": type };
    if (declare !== null) headers["content-length"] = declare;
    res.writeHead(status, headers);
    const more = () => {
      while (!res.destroyed && sent.bytes < total) {
        const ok = res.write(chunk);
        sent.bytes += chunk.length;
        if (!ok) { res.once("drain", more); return; }
      }
      if (!res.destroyed) res.end();
    };
    res.on("close", () => { sent.done = true; });
    more();
  };
  return { handler, sent };
}

const send = (body, type = "application/yaml", status = 200) => (req, res) => { res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) }); res.end(body); };
const refuseWithoutKey = (body, type) => (req, res) => (req.headers.authorization === `Bearer ${KEY}` ? send(body, type)(req, res) : send("forbidden", "text/plain", 403)(req, res));

function editedDocument(baseText) {
  const doc = parseYaml(baseText);
  const routes = Object.keys(doc.paths);
  const template = structuredClone(doc.paths["/api/darkpool/recent"].get);
  template.operationId = "PublicApi.SampleController.new_thing";
  template.summary = "A new thing";
  template.description = "Returns the new thing.\n\nIt needs the Sample Brand enterprise plan.\n";
  doc.paths["/api/sample/new-thing"] = { get: template };
  delete doc.paths["/api/darkpool/recent"];
  const flipped = doc.paths["/api/alerts"].get.parameters[0];
  flipped.required = flipped.required !== true;
  doc.info.description = `# 2099.01.02\n\nA newer entry.\n\n${doc.info.description}`;
  return { doc, routes, flipped: flipped.name };
}

const secretsAbsent = (printed) => ![KEY, encodeURIComponent(KEY), Buffer.from(KEY).toString("base64"), TOKEN, Buffer.from(`x-access-token:${TOKEN}`).toString("base64")].some((s) => printed.includes(s));
const piecesOf = (secret, length = 6) => Array.from({ length: secret.length - length + 1 }, (_, i) => secret.slice(i, i + length));
const noPieceOf = (secret, printed) => !piecesOf(secret).some((piece) => printed.includes(piece));

function git(cwd, args) {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr}`);
  return done.stdout.trim();
}

const AS_TESTER = ["-c", "user.name=t", "-c", "user.email=t@example.test"];
const AS_BOT = ["-c", `user.name=${refreshModule.COMMITTER.name}`, "-c", `user.email=${refreshModule.COMMITTER.email}`];
const REFRESH_REF = "refs/heads/claude/feed-spec-refresh";

function makeRepo(specText, { commits = 1 } = {}) {
  const work = tempDir("feed-refresh-work-");
  const bare = tempDir("feed-refresh-remote-");
  git(bare, ["init", "--bare", "--initial-branch=main", "."]);
  git(work, ["init", "--initial-branch=main", "."]);
  fs.mkdirSync(path.join(work, "docs"));
  fs.writeFileSync(path.join(work, SPEC), specText);
  for (let i = 1; i <= commits; i++) {
    fs.writeFileSync(path.join(work, "other.txt"), `${"one\n".repeat(i)}`);
    git(work, ["add", "-A"]);
    git(work, [...AS_TESTER, "commit", "-m", `base ${i}`]);
  }
  git(work, ["push", bare, "HEAD:refs/heads/main"]);
  return { work, bare, base: git(work, ["rev-parse", "HEAD"]) };
}

function cloneOf(bare, ref, options = []) {
  const dir = tempDir("feed-refresh-clone-");
  git(dir, ["clone", "--quiet", ...options, "--branch", ref, options.includes("--depth") ? `file://${bare}` : bare, "."]);
  return dir;
}

const tipOf = (bare, ref = REFRESH_REF) => { try { return git(bare, ["rev-parse", "--verify", "--quiet", ref]); } catch { return null; } };
const branchOf = (dir) => git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);

const CASES = {};
const measured = {};
const define = (name, fn) => { CASES[name] = fn; };

async function refreshProblems(mod, only = null) {
  const problems = [];
  const need = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
  const feedServer = await startServer();
  const other = await startServer();
  try {
    const base = COMMITTED.split(REAL_ORIGIN).join(feedServer.origin);
    const edited = editedDocument(base);
    const run = (root, env, extra = {}) => runMain(mod, root, env, { origin: feedServer.origin, ...extra });
    const world = { mod, need, run, feedServer, other, base, edited, editedYaml: dumpYaml(edited.doc), editedJson: JSON.stringify(edited.doc) };
    for (const [name, fn] of Object.entries(CASES)) {
      if (only && !only.includes(name)) continue;
      feedServer.routes.clear(); other.routes.clear(); feedServer.hits.length = 0; other.hits.length = 0;
      const began = Date.now();
      try { await fn(world); } catch (error) { problems.push(`${name}: threw ${error && error.stack ? error.stack.split("\n").slice(0, 3).join(" | ") : error}`); }
      if (process.env.FEED_SHOW && !only) console.log(`case ${name} (${((Date.now() - began) / 1000).toFixed(1)} s)`);
    }
  } finally {
    await feedServer.close();
    await other.close();
  }
  return problems;
}

define("a good document in the committed layout", async ({ run, need, feedServer, base, edited, editedYaml }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", send(editedYaml));
  const got = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 0, `a good document is refused (${got.text.slice(0, 200)})`);
  need(got.spec === editedYaml, "the working tree does not hold the downloaded document, byte for byte");
  need(got.output === "changed=true\n", `the step output is ${JSON.stringify(got.output)}`);
  need(got.summary.includes("+ operation GET /api/sample/new-thing") && got.summary.includes("- operation GET /api/darkpool/recent") && got.summary.includes("+ changelog 2099.01.02"), "the step summary does not carry the comparison's added and removed operations and the new changelog entry");
  need(new RegExp(`required (?:query|path):${edited.flipped}`).test(got.summary) && got.summary.includes("~ GET /api/alerts"), "the step summary does not name the parameter whose required flag flipped");
  need(got.summary.includes("218 operations") && got.text.includes("(the feed)/spec.yaml"), "the report does not say where the document came from and how large it is");
  need(feedServer.hits.length === 1 && feedServer.hits.every((h) => h.auth === null), "a document that answers an anonymous request was asked for with the key");
  need(secretsAbsent(got.printed), "the key was printed");
});

define("the default address is the documentation page the committed copy links to", async ({ run, need, feedServer, other, base, edited, editedJson }) => {
  const root = makeRoot(base);
  const decoy = structuredClone(edited.doc);
  decoy.paths["/api/decoy/only-elsewhere"] = structuredClone(decoy.paths["/api/sample/new-thing"]);
  decoy.paths["/api/decoy/only-elsewhere"].get.operationId = "PublicApi.DecoyController.elsewhere";
  other.routes.set("/openapi.json", send(JSON.stringify(decoy), "application/json"));
  const page = `<!doctype html><html><head><script src="/assets/swagger-ui-bundle.js"></script><link href="/openapi.css" rel="stylesheet"></head><body>
    <a href="${other.origin}/openapi.json">mirror</a><script>window.ui = SwaggerUIBundle({ url: "/docs/openapi.json" })</script></body></html>`;
  feedServer.routes.set("/docs", send(page, "text/html; charset=utf-8"));
  feedServer.routes.set("/docs/openapi.json", send(editedJson, "application/json"));
  const got = await run(root, {});
  need(got.code === 0, `the documentation page's own link is not followed to the document (${got.text.slice(0, 300)})`);
  need(got.code !== 0 || refreshModule.sameDocument(parseYaml(got.spec), edited.doc), "the document written is not the one the page on the feed's own origin links to");
  need(!got.spec.includes("only-elsewhere") && other.hits.length === 0, "a link to another origin was followed");
  need(got.code !== 0 || Object.keys(digestSpec(got.spec).ops).length === 218, "a document served as JSON is not rewritten in the layout the existing line reader reads");
  need(feedServer.hits.map((h) => h.route).join() === "/docs,/docs/openapi.json", `the page's script and stylesheet were asked for: ${feedServer.hits.map((h) => h.route).join()}`);
});

define("a page that links to four documents", async ({ run, need, feedServer, base, editedJson }) => {
  const root = makeRoot(base);
  const page = `<html><body><a href="/docs/a/openapi.json">a</a><a href="/docs/b/openapi.yaml">b</a><a href="/docs/c/swagger.json">c</a><a href="/docs/d/openapi.json">d</a></body></html>`;
  feedServer.routes.set("/docs", send(page, "text/html"));
  feedServer.routes.set("/docs/a/openapi.json", send("gone", "text/plain", 410));
  feedServer.routes.set("/docs/b/openapi.yaml", send("openapi: 3.0.0\n"));
  feedServer.routes.set("/docs/c/swagger.json", send("{\"swagger\": \"2.0\"}", "application/json"));
  feedServer.routes.set("/docs/d/openapi.json", send(editedJson, "application/json"));
  const got = await run(root, {});
  need(got.code === 1 && got.spec === base, `the fourth link of a page is followed to a document (${got.text.slice(0, 200)})`);
  need(feedServer.hits.map((h) => h.route).join() === "/docs,/docs/a/openapi.json,/docs/b/openapi.yaml,/docs/c/swagger.json", `the links followed were ${feedServer.hits.map((h) => h.route).join()}`);
  need(/following 3 links/.test(got.text) && /answered 410/.test(got.text), "the report does not say how many links were followed and what each answered");
  need(refreshModule.MAX_LINKS === 3, "three links are followed");
});

define("a refusal without the key", async ({ run, need, feedServer, base, editedYaml }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", refuseWithoutKey(editedYaml));
  const got = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(got.code === 1 && /answered 403/.test(got.text), `a 403 is not reported as a 403 (${got.code}: ${got.text.slice(0, 200)})`);
  need(got.spec === base && got.output === "" && got.summary === "", "a refused download left something behind");
});

define("a refusal answered with the key", async ({ run, need, feedServer, base, editedYaml }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", refuseWithoutKey(editedYaml));
  const got = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 0 && got.spec === editedYaml, `the key did not open the document (${got.text.slice(0, 200)})`);
  need(feedServer.hits.length === 2 && feedServer.hits[0].auth === null && feedServer.hits[1].auth === `Bearer ${KEY}`, "the key was not held back until the anonymous request was refused");
  need(secretsAbsent(got.printed) && /asking again with the key/.test(got.text), "the key was printed, or the second request was not announced");
});

define("the key stays on the feed's own origin", async ({ run, need, other, base, editedYaml }) => {
  const root = makeRoot(base);
  other.routes.set("/spec.yaml", refuseWithoutKey(editedYaml));
  const got = await run(root, { FEED_SPEC_ADDRESS: `${other.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 1 && got.spec === base, "a document on another origin was opened with the key");
  need(other.hits.length === 1 && other.hits.every((h) => h.auth === null), "the key was sent to another origin");
});

define("the feed's origin is the one production calls, whatever a document says", async ({ mod, run, need, feedServer, other, base, editedYaml }) => {
  need(mod.FEED_ORIGIN === REAL_ORIGIN && new URL(parseYaml(COMMITTED).servers[0].url).origin === REAL_ORIGIN, "the feed's origin is not the one the Worker's own client calls, or the committed copy names another server");
  const merged = makeRoot(base.split(feedServer.origin).join(other.origin));
  other.routes.set("/spec.yaml", refuseWithoutKey(editedYaml));
  other.routes.set("/docs", refuseWithoutKey(editedYaml));
  const typed = await run(merged, { FEED_SPEC_ADDRESS: `${other.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(typed.code === 1 && other.hits.length === 1 && other.hits.every((h) => h.auth === null), "a committed copy that names another server moved the origin the key may be sent to");
  other.hits.length = 0;
  const implied = await run(merged, { UW_API_KEY: KEY });
  need(implied.code === 1 && other.hits.length === 0 && feedServer.hits.length === 0 && /links to no documentation page/.test(implied.text), `a committed copy that names another server moved the default address (${implied.text.slice(0, 160)})`);
});

define("a keyed request is never aimed at a data path", async ({ mod, run, need, feedServer, base, editedYaml }) => {
  for (const route of ["/api/spec.yaml", "/api/stock/SYX101/spec.yaml", "/API/spec.yaml", "/%61pi/spec.yaml", "//api/spec.yaml", "/docs/../api/spec.yaml", "/api%2Fspec.yaml",
    "/docs/..%2fapi/spec.yaml", "/docs/..%5capi/spec.yaml", "/x/y/..%2F..%2Fapi/spec.yaml", "/docs%3F/..%2fapi/spec.yaml", "/docs/.%2f..%2fapi/spec.yaml"]) {
    feedServer.routes.clear();
    feedServer.hits.length = 0;
    const served = new URL(feedServer.origin + route).pathname;
    feedServer.routes.set(served, refuseWithoutKey(editedYaml));
    const got = await run(makeRoot(base), { FEED_SPEC_ADDRESS: feedServer.origin + route, UW_API_KEY: KEY });
    need(got.code === 1 && /answered 403/.test(got.text) && feedServer.hits.length === 1 && feedServer.hits.every((h) => h.auth === null), `the key was sent to the data path ${route} (${feedServer.hits.length} requests)`);
    need(secretsAbsent(got.printed), "the key was printed");
  }
  const mayCarry = (address) => mod.mayCarryKey(address, "https://feed.example.test");
  need(mayCarry("https://feed.example.test/docs/openapi.json") && mayCarry("https://feed.example.test/apidocs/openapi.json") && mayCarry("https://feed.example.test/api-docs/openapi.json") && mayCarry("https://feed.example.test/") &&
    mayCarry("https://feed.example.test/docs/v2/..%2fopenapi.json") && mayCarry("https://feed.example.test/docs/api/openapi.json"), "a documentation address on the feed's origin may not carry the key");
  need(!mayCarry("https://feed.example.test/api/x") && !mayCarry("https://feed.example.test/api") && !mayCarry("https://feed.example.test/%61%70%69/x") && !mayCarry("https://feed.example.test/%zz") && !mayCarry("https://other.example.test/docs") && !mayCarry("not an address"),
    "an address that is a data path, cannot be read or is on another origin may carry the key");
  for (const hidden of ["/docs/..%2fapi/x", "/docs/..%5Capi/x", "/a/b/..%2f..%2fapi/x", "/docs%23/..%2fapi/x", "/docs/%2e%2e%2fapi/x", "/docs/..%2f%2f..%2f%2fapi/x"]) {
    need(!mayCarry(`https://feed.example.test${hidden}`), `THE KEY NEVER REACHES A DATA PATH BY AN ENCODED STEP: ${hidden} names /api/ once its slashes are decoded and its dot segments resolved, and it may carry the key`);
  }
  need(typeof mod.resolvedSegments === "function" && JSON.stringify(mod.resolvedSegments("/Docs//v1/./..%2Fapi%5Cx/")) === JSON.stringify(["docs", "api", "x"]), "a path is not read as its segments once decoded, with backslashes as slashes and dot segments resolved");
});

define("the key does not follow a redirect", async ({ run, need, feedServer, other, base, editedYaml }) => {
  const root = makeRoot(base);
  other.routes.set("/spec.yaml", send(editedYaml));
  feedServer.routes.set("/spec.yaml", (req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) { send("forbidden", "text/plain", 403)(req, res); return; }
    res.writeHead(302, { location: `${other.origin}/spec.yaml` });
    res.end();
  });
  const got = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 1 && got.spec === base, "a keyed request was redirected to another origin and its answer taken");
  need(other.hits.every((h) => h.auth === null), "the key followed a redirect to another origin");
});

define("an HTML page instead of a document", async ({ run, need, feedServer, base, editedJson }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", send("<!DOCTYPE html><html><body><h1>Sign in</h1></body></html>", "text/html"));
  const plainPage = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(plainPage.code === 1 && /HTML page that links to no document/.test(plainPage.text) && plainPage.spec === base, `an HTML page is not named as one (${plainPage.text.slice(0, 200)})`);
  feedServer.routes.set("/docs", send("<html><body><a href=\"/docs/openapi.json\">spec</a></body></html>", "text/html"));
  feedServer.routes.set("/docs/openapi.json", send("<html><body><a href=\"/docs/v2/openapi.json\">moved</a></body></html>", "application/json"));
  feedServer.routes.set("/docs/v2/openapi.json", send(editedJson, "application/json"));
  const twice = await run(root, {});
  need(twice.code === 1 && /answered an HTML page/.test(twice.text) && twice.spec === base && feedServer.hits.length === 3, "a link that leads to another page is followed further, or taken for a document");
});

define("a document cut short", async ({ run, need, feedServer, base }) => {
  const root = makeRoot(base);
  const half = base.slice(0, Math.floor(base.length / 2));
  const address = { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` };
  feedServer.routes.set("/spec.yaml", (req, res) => { res.writeHead(200, { "content-type": "application/yaml", "content-length": Buffer.byteLength(base) }); res.write(half); feedServer.later(20, () => res.destroy()); });
  const broken = await run(root, address);
  need(broken.code === 1 && /broke off|did not answer/.test(broken.text) && broken.spec === base, `a transfer that breaks off is not refused (${broken.code}: ${broken.text.slice(0, 200)})`);
  const lines = base.split("\n");
  const midLine = lines.slice(0, 20000).join("\n").slice(0, -7);
  feedServer.routes.set("/spec.yaml", send(midLine));
  const mid = await run(root, address);
  need(mid.code === 1 && mid.spec === base, "a document cut in the middle of a line is taken");
  const pathLines = lines.map((l, i) => (/^ {2}\/api\//.test(l) ? i : -1)).filter((i) => i >= 0);
  const atBoundary = `${lines.slice(0, pathLines[212]).join("\n")}\n`;
  feedServer.routes.set("/spec.yaml", send(atBoundary));
  const boundary = await run(root, address);
  need(Object.keys(parseYaml(atBoundary).paths).length === 212, "the cut document of this case holds 212 whole paths");
  need(boundary.code === 1 && /names no server/.test(boundary.text) && boundary.spec === base, `a document cut at a line break after its 212th path is taken (${boundary.text.slice(0, 200)})`);
  const noFinalBreak = base.slice(0, base.lastIndexOf("tags: []")) + "tags:";
  feedServer.routes.set("/spec.yaml", send(noFinalBreak));
  const tail = await run(root, address);
  need(tail.code === 1 && /does not end with a line break/.test(tail.text) && tail.spec === base, `a document without its last line break is taken (${tail.code}: ${tail.text.slice(0, 200)})`);
  feedServer.routes.set("/spec.yaml", send(JSON.stringify(parseYaml(base)).slice(0, 400000), "application/json"));
  const json = await run(root, address);
  need(json.code === 1 && /does not parse as JSON/.test(json.text) && json.spec === base, "a JSON document cut short is taken");
  const dangling = parseYaml(base);
  for (const name of Object.keys(dangling.components.schemas).slice(400)) delete dangling.components.schemas[name];
  feedServer.routes.set("/spec.yaml", send(dumpYaml(dangling)));
  const refs = await run(root, address);
  need(refs.code === 1 && /references point at no component/.test(refs.text) && refs.spec === base, "a document whose schemas were cut away is taken");
});

define("an answer larger than a document can be", async ({ mod, run, need, feedServer, base }) => {
  const address = { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` };
  const limit = refreshModule.MAX_BYTES;
  need(limit === 20 * MIB, "a document may be 20 MiB");
  const declared = flood(64 * MIB, { declare: 64 * MIB });
  feedServer.routes.set("/spec.yaml", declared.handler);
  const first = await run(makeRoot(base), address);
  need(first.code === 1 && /larger than a document can be/.test(first.text) && first.spec === base, `an answer that declares 64 MiB is not refused (${first.text.slice(0, 160)})`);
  need(declared.sent.bytes <= 16 * MIB, `an answer that declares 64 MiB is refused only after ${Math.round(declared.sent.bytes / MIB)} MiB of it were sent`);
  const edge = flood(limit + 1, { declare: limit + 1 });
  feedServer.routes.set("/spec.yaml", edge.handler);
  const over = await run(makeRoot(base), address);
  need(over.code === 1 && /larger than a document can be/.test(over.text), `an answer that declares one byte over the limit is not refused (${over.text.slice(0, 160)})`);
  need(edge.sent.bytes <= limit - 2 * MIB, `an answer that declares one byte over the limit is read before it is refused: ${Math.round(edge.sent.bytes / MIB)} MiB were sent`);
  const within = flood(limit, { declare: limit });
  feedServer.routes.set("/spec.yaml", within.handler);
  const whole = await run(makeRoot(base), address);
  need(whole.code === 1 && !/larger than a document can be/.test(whole.text) && within.sent.bytes === limit + (64 * 1024 - (limit % (64 * 1024))) % (64 * 1024), `an answer of exactly the limit is refused for its size, or not read to its end (${whole.text.slice(0, 160)}; ${within.sent.bytes} bytes sent)`);
  const quiet = flood(64 * MIB);
  feedServer.routes.set("/spec.yaml", quiet.handler);
  const second = await run(makeRoot(base), address);
  need(second.code === 1 && /larger than a document can be/.test(second.text) && second.spec === base, `an answer of 64 MiB that declares no length is not refused (${second.text.slice(0, 160)})`);
  need(quiet.sent.bytes > limit - MIB && quiet.sent.bytes <= limit + 24 * MIB, `an answer that declares no length is cut off after ${Math.round(quiet.sent.bytes / MIB)} MiB, not at the limit of ${limit / MIB}`);
  const refusal = flood(64 * MIB, { status: 403, type: "text/plain" });
  feedServer.routes.set("/spec.yaml", refusal.handler);
  const third = await run(makeRoot(base), address);
  need(third.code === 1 && /answered 403/.test(third.text), `a refusal with a long body is not reported as a refusal (${third.text.slice(0, 160)})`);
  need(refusal.sent.bytes <= 32 * MIB, `the body of a refusal is read: ${Math.round(refusal.sent.bytes / MIB)} MiB were sent before the connection closed`);
  if (mod === refreshModule) Object.assign(measured, { declared: declared.sent.bytes, edge: edge.sent.bytes, quiet: quiet.sent.bytes, refusal: refusal.sent.bytes });
  const exact = `${base}${"\n".repeat(0)}`;
  feedServer.routes.set("/spec.yaml", send(exact));
  const fits = await run(makeRoot(base), address);
  need(fits.code === 0, "a document within the limit is refused");
});

define("an address that stops answering", async ({ run, need, feedServer, base }) => {
  const address = { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` };
  need(refreshModule.TIMEOUT_MS === 30000, "a request is given 30 seconds");
  feedServer.routes.set("/spec.yaml", (req, res) => { res.writeHead(200, { "content-type": "application/yaml" }); res.write(base.slice(0, 200000)); feedServer.later(2500, () => res.destroy()); });
  let started = Date.now();
  const stalled = await run(makeRoot(base), address, { timeoutMs: 300 });
  need(stalled.code === 1 && /did not finish in time/.test(stalled.text) && stalled.spec === base, `a body that stalls is not refused by name (${stalled.code}: ${stalled.text.slice(0, 160)})`);
  need(Date.now() - started < 2000, `a body that stalls is waited for ${Date.now() - started} ms where 300 were allowed`);
  feedServer.routes.set("/spec.yaml", (req, res) => { feedServer.later(2500, () => res.destroy()); });
  started = Date.now();
  const silent = await run(makeRoot(base), address, { timeoutMs: 300 });
  need(silent.code === 1 && /did not answer \(timed out\)/.test(silent.text) && Date.now() - started < 2000, `an address that never answers is not refused by name (${silent.text.slice(0, 160)}, ${Date.now() - started} ms)`);
});

const SLIDES = 80000;
const spins = (ms) => () => { const end = Date.now() + ms; while (Date.now() < end); };
const slides = (length) => () => "a".repeat(length).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "x");

define("a read is stopped when its time is up", async ({ mod, need }) => {
  need(mod.READ_MS === 60000, "a document is given a minute to be read");
  const roomy = mod.readBudget(60000);
  const kept = { a: [1] };
  need(roomy(() => kept) === kept, "a read that ends inside its time does not hand back what it made");
  class Named extends mod.RefreshError {}
  let raised = null;
  try { roomy(() => { throw new Named("named"); }); } catch (error) { raised = error; }
  need(raised instanceof Named && !(raised instanceof mod.SlowDocument) && raised.message === "named", "a refusal raised inside a read does not come out as it was raised");
  for (const [what, work] of [["a loop that runs for two seconds", spins(2000)], ["a regular expression that slides along 30,000 letters", slides(30000)]]) {
    const reading = mod.readBudget(50);
    let finished = false;
    let refusal = null;
    try { reading(() => { work(); finished = true; }); } catch (error) { refusal = error; }
    need(!finished, `A READ IS STOPPED, NOT WAITED FOR: ${what} was given 50 ms and ran to its end`);
    need(refusal instanceof mod.SlowDocument && refusal instanceof mod.RefreshError && /took longer than the 0\.05 seconds a document may take, so nothing was written$/.test(refusal.message),
      `${what} that outlasts its time is not refused by name (${refusal && refusal.message})`);
    let ran = false;
    let again = null;
    try { reading(() => { ran = true; }); } catch (error) { again = error; }
    need(!ran && again instanceof mod.SlowDocument, "THE TIME ALLOWED IS FOR THE WHOLE RUN: once it is spent, another read is started all the same");
  }
});

define("a document that takes too long to read", async ({ mod, run, need, feedServer, base, edited, editedYaml, editedJson }) => {
  const address = { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` };
  const refusedForTime = (got) => got.code === 1 && /took longer than the [0-9.]+ seconds a document may take/.test(got.text) && got.spec === base && got.output === "" && got.summary === "";
  feedServer.routes.set("/spec.yaml", send(editedYaml));
  const hurried = await run(makeRoot(base), address, { readMs: 1 });
  need(refusedForTime(hurried), `a document given a millisecond to be read is taken, or leaves something behind (${hurried.code}: ${hurried.text.slice(0, 160)})`);
  const unhurried = await run(makeRoot(base), address);
  need(unhurried.code === 0 && unhurried.spec === editedYaml, `the same document given the usual time is refused (${unhurried.text.slice(0, 160)})`);
  feedServer.routes.set("/docs", send(`<html><body>${"=".repeat(SLIDES)}</body></html>`, "text/html"));
  feedServer.hits.length = 0;
  const page = await run(makeRoot(base), {}, { readMs: 1000 });
  need(refusedForTime(page), `AN ANSWER IS READ INSIDE THE TIME ALLOWED: a page whose ${SLIDES} equals signs make the link scan slide is read to its end (${page.code}: ${page.text.slice(0, 160)})`);
  need(feedServer.hits.length === 1, `after a page ran out of time, ${feedServer.hits.length - 1} more requests were made`);
  const slow = structuredClone(edited.doc);
  slow.paths["/api/sample/new-thing"].get.description = `Returns the new thing. ${"a".repeat(SLIDES)}`;
  feedServer.routes.set("/spec.yaml", send(JSON.stringify(slow), "application/json"));
  const sliding = await run(makeRoot(base), address, { readMs: 1000 });
  need(refusedForTime(sliding), `THE DOCUMENT IS READ BACK INSIDE THE TIME ALLOWED: one whose description of ${SLIDES} letters makes the catalog's scan slide is read to its end and taken (${sliding.code}: ${sliding.text.slice(0, 160)})`);
  feedServer.routes.set("/spec.yaml", send(editedJson, "application/json"));
  feedServer.routes.set("/second.yaml", send(editedYaml));
  feedServer.hits.length = 0;
  let stopped = null;
  try {
    await mod.download({ addresses: [`${feedServer.origin}/spec.yaml`, `${feedServer.origin}/second.yaml`], origin: feedServer.origin, key: "", fetchImpl: fetch, note: () => {}, reading: mod.readBudget(0.5) });
  } catch (error) { stopped = error; }
  need(stopped instanceof mod.SlowDocument && feedServer.hits.map((h) => h.route).join() === "/spec.yaml", `once the time allowed is spent the run ends there: ${feedServer.hits.map((h) => h.route).join()} were asked for (${stopped && stopped.constructor.name})`);
});

define("fewer than 200 paths", async ({ run, need, feedServer, base }) => {
  const root = makeRoot(base);
  const small = parseYaml(base);
  for (const route of Object.keys(small.paths).slice(199)) delete small.paths[route];
  feedServer.routes.set("/spec.yaml", send(dumpYaml(small)));
  const got = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(got.code === 1 && /holds 199 paths, fewer than the 200/.test(got.text) && got.spec === base, `a document of 199 paths is taken (${got.text.slice(0, 200)})`);
  const enough = parseYaml(base);
  for (const route of Object.keys(enough.paths).slice(200)) delete enough.paths[route];
  feedServer.routes.set("/spec.yaml", send(dumpYaml(enough)));
  const exact = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(exact.code === 0 && Object.keys(parseYaml(exact.spec).paths).length === 200, `a document of exactly 200 paths is refused (${exact.text.slice(0, 200)})`);
});

define("another document of the right size", async ({ run, need, feedServer, base }) => {
  const root = makeRoot(base);
  const stranger = parseYaml(base);
  let moved = 0;
  for (const route of Object.keys(stranger.paths).slice(0, 30)) {
    moved += Object.keys(stranger.paths[route]).filter((verb) => ["get", "post", "put", "patch", "delete"].includes(verb)).length;
    stranger.paths[`/other${route}`] = stranger.paths[route];
    delete stranger.paths[route];
  }
  feedServer.routes.set("/spec.yaml", send(dumpYaml(stranger)));
  const got = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(moved > 22 && got.code === 1 && got.text.includes(`lacks ${moved} of the 218 committed operations`) && got.spec === base, `a document of the same size that lost ${moved} of the committed operations is taken (${got.text.slice(0, 200)})`);
  const fewer = parseYaml(base);
  for (const route of Object.keys(fewer.paths).slice(0, 12)) { fewer.paths[`/other${route}`] = fewer.paths[route]; delete fewer.paths[route]; }
  feedServer.routes.set("/spec.yaml", send(dumpYaml(fewer)));
  const fine = await run(makeRoot(base), { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(fine.code === 0 && /- operation /.test(fine.summary), `a document that renamed a dozen paths is refused (${fine.text.slice(0, 200)})`);
});

define("a document that names another server", async ({ run, need, feedServer, other, base, edited }) => {
  const address = { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` };
  const variants = [
    ["as its one server", (doc) => { doc.servers[0].url = other.origin; }],
    ["as a second server", (doc) => { doc.servers.push({ url: `${other.origin}/v2` }); }],
    ["for one path", (doc) => { doc.paths["/api/alerts"].servers = [{ url: other.origin }]; }],
    ["for one operation", (doc) => { doc.paths["/api/alerts"].get.servers = [{ url: other.origin }]; }],
    ["with the feed's host under another scheme", (doc) => { doc.servers[0].url = feedServer.origin.replace("http://", "https://"); }],
    ["with the feed's host as a subdomain of another", (doc) => { doc.servers[0].url = `${feedServer.origin.replace("127.0.0.1", "127.0.0.1.example.test")}`; }],
    ["as text that is no address", (doc) => { doc.servers[0].url = "{scheme}://{host}"; }],
    ["as a server with no address", (doc) => { doc.servers.push({ description: "sandbox" }); }],
  ];
  for (const [title, edit] of variants) {
    const doc = structuredClone(edited.doc);
    edit(doc);
    for (const [body, type] of [[dumpYaml(doc), "application/yaml"], [JSON.stringify(doc), "application/json"]]) {
      feedServer.routes.set("/spec.yaml", send(body, type));
      const root = makeRoot(base);
      const got = await run(root, address);
      need(got.code === 1 && /names a server that is not the feed's/.test(got.text) && got.spec === base && got.output === "" && got.summary === "", `a document that names another server ${title} is taken (${type}: ${got.code}, ${got.text.slice(0, 140)})`);
    }
  }
  const same = structuredClone(edited.doc);
  same.servers[0].url = `${feedServer.origin}/v1/`;
  feedServer.routes.set("/spec.yaml", send(dumpYaml(same)));
  const fine = await run(makeRoot(base), address);
  need(fine.code === 0, `a document that names the feed's own origin with a path is refused (${fine.text.slice(0, 160)})`);
});

define("the same document again", async ({ run, need, feedServer, base }) => {
  const root = makeRoot(base);
  const before = fs.statSync(path.join(root, SPEC)).mtimeMs;
  feedServer.routes.set("/spec.yaml", send(base));
  const same = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(same.code === 0 && same.output === "changed=false\n" && /nothing is written/.test(same.text) && /no difference in operations/.test(same.summary), `the committed copy served back is not reported as unchanged (${same.text.slice(0, 200)})`);
  feedServer.routes.set("/spec.yaml", send(JSON.stringify(parseYaml(base)), "application/json"));
  const asJson = await run(root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(asJson.code === 0 && asJson.output === "changed=false\nchanged=false\n" && asJson.spec === base && fs.statSync(path.join(root, SPEC)).mtimeMs === before, "the same document served as JSON rewrites the committed copy");
});

define("an address that may not be asked", async ({ run, need, feedServer, base }) => {
  const root = makeRoot(base);
  for (const address of ["ftp://files.example.test/spec.yaml", "http://files.example.test/spec.yaml", `http://user:pass@127.0.0.1:${new URL(feedServer.origin).port}/spec.yaml`, "not an address", "file:///etc/passwd"]) {
    const asked = [];
    const got = await run(root, { FEED_SPEC_ADDRESS: address }, { fetchImpl: async (url) => { asked.push(String(url)); return new Response("no", { status: 404 }); } });
    need(got.code === 1 && asked.length === 0 && feedServer.hits.length === 0 && got.spec === base, `the address ${address} is asked`);
  }
  const allowed = [];
  await run(root, { FEED_SPEC_ADDRESS: "https://files.example.test/spec.yaml" }, { fetchImpl: async (url) => { allowed.push(String(url)); return new Response("no", { status: 404 }); } });
  need(allowed.join() === "https://files.example.test/spec.yaml", "an https address on another host is not asked at all");
  const bad = await run(root, {}, { argv: ["--force"] });
  need(bad.code === 2, "an unknown flag is not a usage error");
  const linkless = makeRoot(base.split(`${feedServer.origin}/docs`).join(`${feedServer.origin}/manual`));
  const none = await run(linkless, {});
  need(none.code === 1 && /links to no documentation page/.test(none.text) && feedServer.hits.length === 0, "a committed copy that links to no documentation page still yields a default address");
});

define("the provider is not named in the log", async ({ mod, need }) => {
  const root = makeRoot(COMMITTED);
  const edited = editedDocument(COMMITTED);
  edited.doc.paths["/api/alerts"].get.description = `${edited.doc.paths["/api/alerts"].get.description}\n\nIt needs the ${new URL(REAL_ORIGIN).hostname.split(".").slice(-2, -1)[0]} enterprise plan.\n`;
  const asked = [];
  const fetchImpl = async (address, init) => {
    asked.push({ address: String(address), auth: (init.headers && init.headers.authorization) || null });
    if (String(address) === `${REAL_ORIGIN}/docs`) return new Response(JSON.stringify(edited.doc), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("no", { status: 404 });
  };
  const got = await runMain(mod, root, { UW_API_KEY: KEY }, { fetchImpl });
  need(got.code === 0 && asked.length === 1 && asked[0].auth === null, `the default address is not the documentation page on the feed's own origin (${got.text.slice(0, 200)})`);
  need(!BRAND.test(got.printed), "the provider is named in the log, the step summary or the step output"); BRAND.lastIndex = 0;
  need(/\+ plan sentence: It needs the feed enterprise plan\./.test(got.summary) && got.text.includes("(the feed)/docs"), "the report does not say the feed where the document names its provider");
  need(secretsAbsent(got.printed), "the key was printed");
});

define("nothing a document holds reaches the log as it is", async ({ run, need, feedServer, base, edited }) => {
  const address = { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` };
  const marker = "MARKER-0123456789";
  const brokenJson = `${JSON.stringify(edited.doc).slice(0, 5000)} ${marker} ${"x".repeat(40)}`;
  feedServer.routes.set("/spec.yaml", send(brokenJson, "application/json"));
  const json = await run(makeRoot(base), address);
  need(json.code === 1 && /does not parse as JSON/.test(json.text) && !json.printed.includes(marker.slice(0, 6)) && !json.printed.includes("xxxx") && /does not parse as JSON$/.test(json.text.trim()), `a JSON document that does not parse is quoted in the log (${json.text.slice(0, 200)})`);
  for (const [title, line] of [["a flow list", `bad: [${marker}, 2]`], ["a duplicate key", `openapi: ${marker}`], ["a tag", `bad: !${marker} 1`], ["an unknown escape", `bad: "\\q${marker}"`], ["a block header", `bad: |9x${marker}`]]) {
    feedServer.routes.set("/spec.yaml", send(`${base}${line}\n`));
    const yamlRun = await run(makeRoot(base), address);
    need(yamlRun.code === 1 && /does not parse as YAML \(line [0-9]+\)$/.test(yamlRun.text.trim()) && !yamlRun.printed.includes(marker.slice(0, 6)), `a YAML document with ${title} is quoted in the log (${yamlRun.text.slice(0, 200)})`);
  }
  const hostile = structuredClone(edited.doc);
  hostile.paths["/api/z\n::error title=injected::from a path\r\n::notice::and again\u2028::warning::and again"] = { description: "no operation here" };
  feedServer.routes.set("/spec.yaml", send(JSON.stringify(hostile), "application/json"));
  const lines = await run(makeRoot(base), address);
  need(lines.code === 1 && /has no operation/.test(lines.text) && lines.text.includes("/api/z ::error title=injected::from a path"), `a path with a line break in it is not reported (${lines.text.slice(0, 200)})`);
  need(!/[\r\u2028\u0000-\u0008\u000b-\u001f]/.test(lines.text) && lines.text.split("\n").every((line) => !line.startsWith("::")) && lines.text.split("\n").length === 1, `a line break inside a document starts a new line of the log: ${JSON.stringify(lines.text.slice(0, 200))}`);
  const ticks = structuredClone(edited.doc);
  ticks.paths["/api/alerts"].get.parameters.push({ name: "a```b", in: "query", required: true, schema: { type: "string" } });
  feedServer.routes.set("/spec.yaml", send(JSON.stringify(ticks), "application/json"));
  const fenced = await run(makeRoot(base), address);
  const summaryLines = fenced.summary.split("\n");
  need(fenced.code === 0 && fenced.summary.includes("query:a'''b") && summaryLines.filter((line) => line === "```").length === 4 && summaryLines.every((line) => line === "```" || !line.includes("`")), `a name holding backticks closes the summary's block: ${fenced.summary.slice(0, 300)}`);
  const holder = structuredClone(edited.doc);
  holder.info["x-nested"] = "NESTED-HERE";
  for (const [levels, refused] of [[62, false], [63, true], [200, true], [5000, true], [200000, true]]) {
    const nested = JSON.stringify(holder).replace("\"NESTED-HERE\"", `${"{\"k\":".repeat(levels)}1${"}".repeat(levels)}`);
    feedServer.routes.set("/spec.yaml", send(nested, "application/json"));
    const got = await run(makeRoot(base), address);
    need(refused ? got.code === 1 && /nested deeper than 64 levels|does not parse as JSON/.test(got.text) : got.code === 0, `a JSON document with ${levels + 2} levels ends as ${got.code}: ${got.text.slice(0, 160)}`);
  }
});

define("a secret never survives the redactor", async ({ mod, need }) => {
  const redact = mod.redactor(KEY);
  const dirty = `a ${KEY} b ${encodeURIComponent(KEY)} c ${Buffer.from(KEY).toString("base64")} d Authorization: Bearer abc.def e authorization: basic eC1hY2Nlc3M= f ${Buffer.from(`x-access-token:${KEY}`).toString("base64")}`;
  const clean = redact(dirty);
  need(!clean.includes(KEY) && !clean.includes(encodeURIComponent(KEY)) && !clean.includes(Buffer.from(KEY).toString("base64")) && !clean.includes("abc.def") && !clean.includes("eC1hY2Nlc3M=") && !clean.includes(Buffer.from(`x-access-token:${KEY}`).toString("base64")), `the redactor leaves a secret: ${clean}`);
  need(mod.redactor("")("plain text") === "plain text" && mod.redactor(undefined)("plain text") === "plain text", "the redactor changes text when there is no secret");
  need(mod.oneLine("a\nb\r\nc\u2028d\u0000e\u001b[31mf\u0085g") === "a b  c d e [31mf g" && mod.oneLine("plain text") === "plain text", `a line of the log keeps a control character: ${JSON.stringify(mod.oneLine("a\nb\r\nc\u2028d\u0000e\u001b[31mf\u0085g"))}`);
});

define("the push carries the document alone to its own branch", async ({ run, need, base, editedYaml }) => {
  const repo = makeRepo(base);
  const idle = await run(repo.work, { FEED_SPEC_REMOTE: repo.bare }, { argv: ["--push"] });
  need(idle.code === 0 && /nothing to push/.test(idle.text) && git(repo.bare, ["for-each-ref", "--format=%(refname)"]) === "refs/heads/main", `an unchanged document is pushed (${idle.text.slice(0, 200)})`);
  fs.writeFileSync(path.join(repo.work, SPEC), editedYaml);
  fs.writeFileSync(path.join(repo.work, "other.txt"), "two\n");
  fs.writeFileSync(path.join(repo.work, "stray.txt"), "left behind\n");
  const got = await run(repo.work, { FEED_SPEC_REMOTE: repo.bare }, { argv: ["--push"] });
  need(got.code === 0 && /pushed docs\/uw-openapi\.yaml to claude\/feed-spec-refresh/.test(got.text), `the changed document is not pushed (${got.text.slice(0, 300)})`);
  const refs = git(repo.bare, ["for-each-ref", "--format=%(refname) %(objectname)"]).split("\n").sort();
  need(refs.length === 2 && refs[0].startsWith("refs/heads/claude/feed-spec-refresh ") && refs[1] === `refs/heads/main ${repo.base}`, `the remote's branches are ${refs.join(", ")}: main must be untouched and the document on its own branch`);
  if (refs.length === 2 && refs[0].startsWith("refs/heads/claude/feed-spec-refresh ")) {
    const tip = refs[0].split(" ")[1];
    need(git(repo.bare, ["rev-parse", `${tip}^`]) === repo.base, "the pushed commit does not sit directly on the base");
    need(git(repo.bare, ["diff-tree", "--no-commit-id", "--name-only", "-r", tip]) === SPEC, `the pushed commit changes ${git(repo.bare, ["diff-tree", "--no-commit-id", "--name-only", "-r", tip])}`);
    need(git(repo.bare, ["show", `${tip}:${SPEC}`]) === editedYaml.trimEnd(), "the pushed document is not the one in the working tree");
    need(git(repo.bare, ["log", "-1", "--format=%an <%ae> | %cn", tip]) === "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> | github-actions[bot]", "the commit is not the workflow bot's");
    need(/^Refresh the feed's OpenAPI document \([0-9a-f]{12}\)$/.test(git(repo.bare, ["log", "-1", "--format=%s", tip])), "the commit message does not name what it carries");
  }
  const staged = makeRepo(base);
  fs.writeFileSync(path.join(staged.work, SPEC), editedYaml);
  fs.writeFileSync(path.join(staged.work, "other.txt"), "two\n");
  git(staged.work, ["add", "other.txt"]);
  const mixed = await run(staged.work, { FEED_SPEC_REMOTE: staged.bare }, { argv: ["--push"] });
  need(mixed.code === 1 && /more than the document is staged/.test(mixed.text) && git(staged.bare, ["for-each-ref", "--format=%(refname)"]) === "refs/heads/main", "a commit that would carry another file is pushed");
  const cut = makeRepo(base);
  fs.writeFileSync(path.join(cut.work, SPEC), base.slice(0, 300000));
  const partial = await run(cut.work, { FEED_SPEC_REMOTE: cut.bare }, { argv: ["--push"] });
  need(partial.code === 1 && git(cut.bare, ["for-each-ref", "--format=%(refname)"]) === "refs/heads/main" && branchOf(cut.work) === "main", "a document cut short in the working tree is pushed, or a branch is made for it");
  const elsewhere = makeRepo(base);
  fs.writeFileSync(path.join(elsewhere.work, SPEC), editedYaml.replace(new RegExp(`url: ${base.match(/url: (http:\/\/127\.0\.0\.1:[0-9]+)/)[1]}`), "url: https://other.example.test"));
  const foreign = await run(elsewhere.work, { FEED_SPEC_REMOTE: elsewhere.bare }, { argv: ["--push"] });
  need(foreign.code === 1 && /names a server that is not the feed's/.test(foreign.text) && tipOf(elsewhere.bare) === null, `a document that names another server is pushed (${foreign.text.slice(0, 160)})`);
});

define("a second run keeps what others put on the branch", async ({ run, need, base, edited, editedYaml }) => {
  const newer = structuredClone(edited.doc);
  newer.info.description = `# 2099.02.03\n\nNewer still.\n\n${newer.info.description}`;
  const newerYaml = dumpYaml(newer);
  const pushFrom = (dir, text, bare) => { fs.writeFileSync(path.join(dir, SPEC), text); return run(dir, { FEED_SPEC_REMOTE: bare }, { argv: ["--push"] }); };
  const commitOther = (dir, file, body, as = AS_TESTER, message = "follow-up work") => { fs.writeFileSync(path.join(dir, file), body); git(dir, ["add", "--", file]); git(dir, [...as, "commit", "-m", message]); return git(dir, ["rev-parse", "HEAD"]); };

  const repo = makeRepo(base, { commits: 2 });
  const first = await pushFrom(repo.work, editedYaml, repo.bare);
  const r1 = tipOf(repo.bare);
  need(first.code === 0 && r1 !== null && git(repo.bare, ["rev-parse", `${r1}^`]) === repo.base, `the first run did not put one commit on the base (${first.text.slice(0, 160)})`);

  const again = cloneOf(repo.bare, "main");
  const second = await pushFrom(again, newerYaml, repo.bare);
  const r2 = tipOf(repo.bare);
  need(second.code === 0 && r2 !== r1 && git(repo.bare, ["rev-parse", `${r2}^`]) === repo.base && git(repo.bare, ["show", `${r2}:${SPEC}`]) === newerYaml.trimEnd(), `a second run does not replace the workflow's own commit with a newer document (${second.code}: ${second.text.slice(0, 200)})`);

  const helper = cloneOf(repo.bare, "claude/feed-spec-refresh");
  const followUp = commitOther(helper, "catalog.txt", "regenerated by hand\n");
  git(helper, ["push", "--quiet", repo.bare, `HEAD:${REFRESH_REF}`]);
  const third = cloneOf(repo.bare, "main");
  const kept = await pushFrom(third, editedYaml, repo.bare);
  need(kept.code === 1 && tipOf(repo.bare) === followUp, `A SECOND RUN OVERWROTE FOLLOW-UP WORK on the refresh branch: the tip was ${followUp.slice(0, 12)} and is ${String(tipOf(repo.bare)).slice(0, 12)} (${kept.text.slice(0, 160)})`);
  need(/claude\/feed-spec-refresh holds work that is not this workflow's one refresh commit/.test(kept.text) && kept.text.includes(followUp.slice(0, 12)) && /Move that work to a branch of its own/.test(kept.text) && branchOf(third) === "main", `the refusal does not name the branch, its tip and what to do (${kept.text.slice(0, 260)})`);

  const onBranch = cloneOf(repo.bare, "claude/feed-spec-refresh");
  const forward = await pushFrom(onBranch, base.replace("openapi: 3.0.0", "openapi: 3.0.1"), repo.bare);
  const r3 = tipOf(repo.bare);
  need(forward.code === 0 && git(repo.bare, ["rev-parse", `${r3}^`]) === followUp && git(repo.bare, ["show", `${r3}:catalog.txt`]) === "regenerated by hand", `a run started from the branch itself does not add its commit on top of the work there (${forward.code}: ${forward.text.slice(0, 200)})`);

  const below = cloneOf(repo.bare, "main");
  const buried = await pushFrom(below, newerYaml, repo.bare);
  need(buried.code === 1 && tipOf(repo.bare) === r3 && /holds work that is not/.test(buried.text), `a refresh commit that sits on follow-up work was replaced, and the work under it lost (${buried.text.slice(0, 160)})`);

  const forged = makeRepo(base);
  await pushFrom(forged.work, editedYaml, forged.bare);
  const impostor = cloneOf(forged.bare, "main");
  fs.writeFileSync(path.join(impostor, SPEC), newerYaml);
  git(impostor, ["add", "--", SPEC]);
  git(impostor, [...AS_TESTER, "commit", "-m", "Refresh the feed's OpenAPI document (0123456789ab)"]);
  git(impostor, ["push", "--quiet", "--force", forged.bare, `HEAD:${REFRESH_REF}`]);
  const byHand = tipOf(forged.bare);
  const overHand = await pushFrom(cloneOf(forged.bare, "main"), editedYaml, forged.bare);
  need(overHand.code === 1 && tipOf(forged.bare) === byHand, "a commit someone else made with the workflow's message was replaced");

  const wide = makeRepo(base);
  await pushFrom(wide.work, editedYaml, wide.bare);
  const two = cloneOf(wide.bare, "main");
  fs.writeFileSync(path.join(two, SPEC), newerYaml);
  fs.writeFileSync(path.join(two, "catalog.txt"), "by hand\n");
  git(two, ["add", "-A"]);
  git(two, [...AS_BOT, "commit", "-m", "Refresh the feed's OpenAPI document (0123456789ab)"]);
  git(two, ["push", "--quiet", "--force", wide.bare, `HEAD:${REFRESH_REF}`]);
  const twoFiles = tipOf(wide.bare);
  const overTwo = await pushFrom(cloneOf(wide.bare, "main"), editedYaml, wide.bare);
  need(overTwo.code === 1 && tipOf(wide.bare) === twoFiles, "a commit that carries another file beside the document was replaced");

  const shallowRepo = makeRepo(base, { commits: 3 });
  const fresh = cloneOf(shallowRepo.bare, "main", ["--depth", "1"]);
  need(git(fresh, ["rev-parse", "--is-shallow-repository"]) === "true", "the shallow clone of this case is shallow");
  const firstShallow = await pushFrom(fresh, editedYaml, shallowRepo.bare);
  const s1 = tipOf(shallowRepo.bare);
  need(firstShallow.code === 0 && s1 !== null, `a shallow checkout cannot make the branch when there is none (${firstShallow.text.slice(0, 160)})`);
  const shallowAgain = cloneOf(shallowRepo.bare, "main", ["--depth", "1"]);
  const blind = await pushFrom(shallowAgain, newerYaml, shallowRepo.bare);
  need(blind.code === 1 && tipOf(shallowRepo.bare) === s1 && /this checkout is shallow/.test(blind.text), `a shallow checkout, which cannot see what the branch holds, pushed over it (${blind.code}: ${blind.text.slice(0, 160)})`);

  const racy = makeRepo(base);
  await pushFrom(racy.work, editedYaml, racy.bare);
  const racer = cloneOf(racy.bare, "claude/feed-spec-refresh");
  const late = cloneOf(racy.bare, "main");
  fs.writeFileSync(path.join(late, SPEC), newerYaml);
  let landed = null;
  const racing = (cmd, args, options) => {
    if (args[0] === "push" && landed === null) { landed = commitOther(racer, "catalog.txt", "pushed while the run was reading\n"); git(racer, ["push", "--quiet", racy.bare, `HEAD:${REFRESH_REF}`]); }
    return spawnSync(cmd, args, options);
  };
  const lost = await run(late, { FEED_SPEC_REMOTE: racy.bare }, { argv: ["--push"], run: racing });
  need(landed !== null && lost.code === 1 && tipOf(racy.bare) === landed && /git push failed/.test(lost.text), `work pushed to the branch between the run's reading and its push was overwritten (${lost.code}: ${lost.text.slice(0, 160)})`);
});

define("the token travels in the environment, never on the command line", async ({ run, need, editedYaml }) => {
  const root = makeRoot(editedYaml);
  const calls = [];
  const fake = (cmd, args, options) => {
    calls.push({ cmd, args, env: options.env });
    const stdout = args[0] === "status" ? ` M ${SPEC}\n` : args[0] === "diff" ? `${SPEC}\n` : "";
    return { status: 0, stdout, stderr: "" };
  };
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString("base64")}`;
  const carried = Object.keys(process.env).filter((name) => /^GIT_CONFIG_(?:COUNT|KEY_[0-9]+|VALUE_[0-9]+)$/.test(name)).map((name) => [name, process.env[name]]);
  const settings = [{}, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "http.sample.proxy", GIT_CONFIG_VALUE_0: "http://127.0.0.1:1", GIT_CONFIG_KEY_1: "user.sample", GIT_CONFIG_VALUE_1: "kept" }];
  let got = null;
  try {
    for (const given of settings) {
      for (const [name] of carried) delete process.env[name];
      Object.assign(process.env, given);
      calls.length = 0;
      const slot = Number(given.GIT_CONFIG_COUNT || 0);
      got = await run(root, { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: "owner/site" }, { argv: ["--push"], run: fake });
      const pushCall = calls.find((c) => c.args[0] === "push");
      const listCall = calls.find((c) => c.args[0] === "ls-remote");
      need(got.code === 0 && Boolean(pushCall) && Boolean(listCall), `the push is not made (${got.text.slice(0, 200)})`);
      need(Boolean(pushCall) && JSON.stringify(pushCall.args) === JSON.stringify(["push", "--force-with-lease=refs/heads/claude/feed-spec-refresh:", "https://github.com/owner/site.git", "HEAD:refs/heads/claude/feed-spec-refresh"]), `the push is ${pushCall && pushCall.args.join(" ")}`);
      need(Boolean(listCall) && JSON.stringify(listCall.args) === JSON.stringify(["ls-remote", "https://github.com/owner/site.git", "refs/heads/claude/feed-spec-refresh"]) && calls.indexOf(listCall) < calls.findIndex((c) => c.args[0] === "checkout"), "the branch is not read on the remote before anything is changed here");
      need(calls.every((c) => c.cmd === "git" && c.args.every((a) => !a.includes(TOKEN) && !a.includes(Buffer.from(`x-access-token:${TOKEN}`).toString("base64")))), "the token is on a command line");
      for (const call of [pushCall, listCall]) {
        need(Boolean(call) && call.env.GIT_CONFIG_COUNT === String(slot + 1) && call.env[`GIT_CONFIG_KEY_${slot}`] === "http.https://github.com/.extraheader" && call.env[`GIT_CONFIG_VALUE_${slot}`] === header, `the token is not handed to git as a request header for github.com alone, in its environment, after the ${slot} settings the environment already carries`);
        need(Boolean(call) && Array.from({ length: slot }, (_, i) => i).every((i) => call.env[`GIT_CONFIG_KEY_${i}`] === given[`GIT_CONFIG_KEY_${i}`] && call.env[`GIT_CONFIG_VALUE_${i}`] === given[`GIT_CONFIG_VALUE_${i}`]), "the configuration the environment already carries is overwritten");
      }
      need(calls.filter((c) => !["push", "ls-remote", "fetch"].includes(c.args[0])).every((c) => c.env.GIT_CONFIG_COUNT === given.GIT_CONFIG_COUNT && !Object.values(c.env).some((v) => typeof v === "string" && (v.includes(TOKEN) || v.includes(header)))), "the token is handed to a git command that does not talk to the remote");
      need(secretsAbsent(got.printed), "the token was printed");
    }
  } finally {
    for (const name of Object.keys(settings[1])) delete process.env[name];
    for (const [name, value] of carried) process.env[name] = value;
  }
  const failing = (cmd, args) => (args[0] === "push" ? { status: 1, stdout: "", stderr: `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/owner/site.git/'` } : fake(cmd, args, { env: {} }));
  const failed = await run(root, { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: "owner/site" }, { argv: ["--push"], run: failing });
  need(failed.code === 1 && secretsAbsent(failed.printed) && /git push failed/.test(failed.text), "a failed push prints the token, or is not reported");
  for (const lead of [refreshModule.ERROR_CHARS - TOKEN.length - 30, refreshModule.ERROR_CHARS - TOKEN.length - 1, refreshModule.ERROR_CHARS - 20, refreshModule.ERROR_CHARS - 1]) {
    for (const secret of [TOKEN, encodeURIComponent(TOKEN), Buffer.from(`x-access-token:${TOKEN}`).toString("base64")]) {
      const straddling = (cmd, args) => (args[0] === "push" ? { status: 1, stdout: "", stderr: `${"e".repeat(lead)}${secret} then more` } : fake(cmd, args, { env: {} }));
      const cutRun = await run(root, { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: "owner/site" }, { argv: ["--push"], run: straddling });
      need(cutRun.code === 1 && /git push failed/.test(cutRun.text) && noPieceOf(secret, cutRun.printed), `A SECRET THAT STRADDLES THE CUT IS PRINTED IN PART: with ${lead} characters before it, the log holds a piece of it`);
    }
  }
  need(refreshModule.ERROR_CHARS === 300, "a git error is cut at 300 characters");
  const noToken = await run(root, { GITHUB_REPOSITORY: "owner/site" }, { argv: ["--push"], run: fake });
  need(noToken.code === 1 && /no token to push with/.test(noToken.text), "a push to the remote is tried without a token");
  const nowhere = await run(root, { GH_TOKEN: TOKEN }, { argv: ["--push"], run: fake });
  need(nowhere.code === 1 && /no repository to push to/.test(nowhere.text), "a push is tried with no repository named");
  calls.length = 0;
  for (const remote of ["https://elsewhere.example.test/owner/site.git", "/tmp/somewhere", "git@elsewhere.example.test:owner/site.git"]) {
    const aimed = await run(root, { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: "owner/site", FEED_SPEC_REMOTE: remote }, { argv: ["--push"], run: fake });
    need(aimed.code === 1 && /another remote is taken only when there is no token/.test(aimed.text) && !calls.some((c) => ["push", "ls-remote", "fetch"].includes(c.args[0])), `with a token present, the remote ${remote} was talked to`);
  }
});

{
  const problems = await refreshProblems(refreshModule);
  deep(problems, [], "THE REFRESH TAKES A WHOLE DOCUMENT AND NOTHING ELSE: a good document in either format is written and compared, a refusal, a page, a cut document, a small one and a foreign one are each refused by name, the key goes to the feed's own origin only after an anonymous refusal, and the push carries the document alone to claude/feed-spec-refresh");
}
sweep();

const MUTANTS = [
  ["a document of any size taken", ["fewer than 200 paths"], [["export const MIN_PATHS = 200;", "export const MIN_PATHS = 1;"]]],
  ["the key sent to another origin", ["the key stays on the feed's own origin"], [["    if (url.origin !== origin) return false;\n", ""]]],
  ["the key sent before any refusal", ["a good document in the committed layout"], [["        got = await getText(fetchImpl, address, { accept: ACCEPT, \"user-agent\": \"feed-spec-refresh\" }, timeoutMs);\n        if (", "        got = await getText(fetchImpl, address, { accept: ACCEPT, \"user-agent\": \"feed-spec-refresh\", ...(key ? { authorization: `Bearer ${key}` } : {}) }, timeoutMs);\n        if ("]]],
  ["a keyed request following a redirect", ["the key does not follow a redirect"], [["redirect: headers.authorization ? \"error\" : \"follow\"", "redirect: \"follow\""]]],
  ["the key sent to a data path", ["a keyed request is never aimed at a data path"], [["    return resolvedSegments(url.pathname)[0] !== DATA_SEGMENT;", "    return true;"]]],
  ["a data path told from a document's by its spelling", ["a keyed request is never aimed at a data path"], [["    return resolvedSegments(url.pathname)[0] !== DATA_SEGMENT;", "    return !url.pathname.startsWith(DATA_PATHS);"]]],
  ["a data path told from a document's once decoded, with its dot segments left as they are", ["a keyed request is never aimed at a data path"], [["    return resolvedSegments(url.pathname)[0] !== DATA_SEGMENT;", "    return !decodeURIComponent(url.pathname).replace(/\\/+/g, \"/\").toLowerCase().startsWith(DATA_PATHS);"]]],
  ["a backslash in a path not read as a slash", ["a keyed request is never aimed at a data path"], [["  for (const part of decodeURIComponent(pathname).split(/[\\\\/]+/)) {", "  for (const part of decodeURIComponent(pathname).split(/\\/+/)) {"]]],
  ["a dot segment kept as a name", ["a keyed request is never aimed at a data path"], [["    if (part === \"..\") out.pop();", "    if (part === \"..\") out.push(part);"]]],
  ["the feed's origin read off the committed copy", ["the feed's origin is the one production calls, whatever a document says"], [["  const committed = readFileSync(target, \"utf8\");\n  const brand", "  const committed = readFileSync(target, \"utf8\");\n  origin = new URL(parseYaml(committed).servers[0].url).origin;\n  const brand"]]],
  ["the feed's origin another constant than production's", ["the feed's origin is the one production calls, whatever a document says"], [["export const FEED_ORIGIN = new URL(VENDOR_BASE_DEFAULT).origin;", "export const FEED_ORIGIN = \"https://feed.example.test\";"]]],
  ["a document that names another server taken", ["a document that names another server", "the push carries the document alone to its own branch"], [["    if (named !== origin) throw new RefreshError(\"the document names a server that is not the feed's, so it is another document\");\n", ""]]],
  ["only a document's first server looked at", ["a document that names another server"], [["  for (const url of serversOf(doc)) {", "  for (const url of serversOf(doc).slice(0, 1)) {"]]],
  ["the servers of paths and operations not looked at", ["a document that names another server"], [["    take(item.servers);\n    for (const verb of VERBS) if (isObj(item[verb])) take(item[verb].servers);\n", ""]]],
  ["a server compared by its host's ending", ["a document that names another server"], [["    try { named = new URL(url).origin; } catch { named = null; }\n    if (named !== origin)", "    try { named = new URL(url).host; } catch { named = null; }\n    if (named === null || !named.includes(new URL(origin).hostname))"]]],
  ["an HTML page not recognised", ["the default address is the documentation page the committed copy links to", "an HTML page instead of a document"], [["export function looksLikeHtml(text, contentType) {\n", "export function looksLikeHtml(text, contentType) {\n  if (text) return false;\n"]]],
  ["a link to another origin followed", ["the default address is the documentation page the committed copy links to"], [["    if (url.origin !== page.origin || url.href === page.href) continue;", "    if (url.href === page.href) continue;"]]],
  ["a page's scripts taken for documents", ["the default address is the documentation page the committed copy links to"], [["    if (/\\.(?:js|css|png|svg|ico|map|html?)(?:$|[?#])/i.test(url.pathname)) continue;\n", ""]]],
  ["links followed from a second page", ["an HTML page instead of a document"], [["return { links: hop === 0 ? documentLinks(got.text, address) : [] };", "return { links: documentLinks(got.text, address) };"]]],
  ["every link of a page followed", ["a page that links to four documents"], [["export const MAX_LINKS = 3;", "export const MAX_LINKS = 10;"]]],
  ["a declared length not looked at before the body", ["an answer larger than a document can be"], [["  if (Number.isFinite(declared) && declared > limit) {", "  if (declared < 0) {"]]],
  ["the whole body taken before its size is looked at", ["an answer larger than a document can be"], [["    if (size > limit) {\n      try { await reader.cancel(); } catch {}\n      throw new RefreshError(\"the answer is larger than a document can be\");\n    }\n    chunks.push(value);", "    chunks.push(value);"], ["  return Buffer.concat(chunks, size);", "  if (size > limit) throw new RefreshError(\"the answer is larger than a document can be\");\n  return Buffer.concat(chunks, size);"]]],
  ["no limit on a body that declares no length", ["an answer larger than a document can be"], [["    if (size > limit) {\n      try { await reader.cancel(); } catch {}\n      throw new RefreshError(\"the answer is larger than a document can be\");\n    }\n", ""]]],
  ["the body of a refusal read to its end", ["an answer larger than a document can be"], [["  if (response.status !== 200) {\n    await hangUp(response);", "  if (response.status !== 200) {\n    try { await response.arrayBuffer(); } catch {}"]]],
  ["a document of exactly the limit refused", ["an answer larger than a document can be"], [["    if (size > limit) {\n      try { await reader.cancel(); } catch {}", "    if (size >= limit) {\n      try { await reader.cancel(); } catch {}"]]],
  ["the time allowed not applied to the request it is given for", ["an address that stops answering"], [["signal: AbortSignal.timeout(timeoutMs) });", "signal: AbortSignal.timeout(TIMEOUT_MS) });"]]],
  ["a transfer that runs out of time called a broken one", ["an address that stops answering"], [["    throw new RefreshError(late(error) ? \"the transfer did not finish in time\" : \"the transfer broke off before the document was whole\");", "    throw new RefreshError(\"the transfer broke off before the document was whole\");"]]],
  ["no limit on the time a read may take", ["a read is stopped when its time is up"], [["      vm.runInNewContext(\"value = work()\", box, { timeout: Math.ceil(left) });", "      box.value = work();"]]],
  ["the time looked at only once the read is over", ["a read is stopped when its time is up"], [["      vm.runInNewContext(\"value = work()\", box, { timeout: Math.ceil(left) });", "      box.value = work();\n      if (Date.now() - started > left) throw Object.assign(new Error(\"late\"), { code: STOPPED });"]]],
  ["every read given the whole time again", ["a read is stopped when its time is up"], [["      left -= Date.now() - started;", "      left -= 0;"]]],
  ["a read that ran out of time reported as any other failure", ["a read is stopped when its time is up"], [["throw new SlowDocument(`reading what the address answered took longer", "throw new RefreshError(`reading what the address answered took longer"]]],
  ["an answer read outside the time allowed", ["a document that takes too long to read"], [["        seen = reading(() => {", "        seen = ((work) => work())(() => {"]]],
  ["the document read back outside the time allowed", ["a document that takes too long to read"], [["  const read = reading(() => {", "  const read = ((work) => work())(() => {"]]],
  ["the next address asked after the time allowed is spent", ["a document that takes too long to read"], [["        if (!(error instanceof RefreshError) || error instanceof SlowDocument) throw error;", "        if (!(error instanceof RefreshError)) throw error;"]]],
  ["a document without its servers taken", ["a document cut short"], [["  if (!Array.isArray(doc.servers) || !isObj(doc.servers[0]) || typeof doc.servers[0].url !== \"string\") throw new RefreshError(\"the document names no server, so it was cut short\");\n", ""]]],
  ["a document without its last line break taken", ["a document cut short"], [["  if (!body.endsWith(\"\\n\")) throw new RefreshError(\"the document does not end with a line break, so it was cut short\");\n", ""]]],
  ["references to missing schemas ignored", ["a document cut short"], [["  if (dangling.length) throw new RefreshError(", "  if (dangling.length < 0) throw new RefreshError("]]],
  ["a document that lost a tenth of its operations taken", ["another document of the right size"], [["  if (lost > Math.max(10, MAX_LOST_SHARE * Object.keys(before.ops).length)) throw new RefreshError(", "  if (lost < 0) throw new RefreshError("]]],
  ["the same document written again", ["the same document again"], [["  const changed = text !== committed && !sameDocument(parseYaml(committed), got.doc);", "  const changed = true;"]]],
  ["a layout change counted as a change", ["the same document again"], [["  const changed = text !== committed && !sameDocument(parseYaml(committed), got.doc);", "  const changed = text !== committed;"]]],
  ["an address of any scheme asked", ["an address that may not be asked"], [["  if (url.protocol !== \"https:\" && !(url.protocol === \"http:\" && LOOPBACK.has(url.hostname))) throw new RefreshError(\"the address must be https\");\n", ""]]],
  ["credentials in the address allowed", ["an address that may not be asked"], [["  if (url.username || url.password) throw new RefreshError(\"the address must carry no credentials\");\n", ""]]],
  ["the provider named in the log", ["the provider is not named in the log"], [["  const plain = (text) => oneLine(redact(brand ? String(text).replace(brand, \"the feed\").replace(/\\b([Tt])he the feed\\b/g, \"$1he feed\") : String(text)));", "  const plain = (text) => oneLine(redact(String(text)));"]]],
  ["the feed's host printed with the address", ["the provider is not named in the log"], [["placeOf(got.address, origin)", "got.address"]]],
  ["the article doubled before the feed", ["the provider is not named in the log"], [[".replace(/\\b([Tt])he the feed\\b/g, \"$1he feed\") : String(text)));", " : String(text)));"]]],
  ["a JSON parser's words printed", ["nothing a document holds reaches the log as it is"], [["    try { doc = JSON.parse(body); } catch { throw new RefreshError(\"the document does not parse as JSON\"); }", "    try { doc = JSON.parse(body); } catch (error) { throw new RefreshError(`the document does not parse as JSON (${String(error.message).slice(0, 120)})`); }"]]],
  ["a YAML reader's words printed", ["nothing a document holds reaches the log as it is"], [["throw new RefreshError(`the document does not parse as YAML (line ${error.line})`);", "throw new RefreshError(`the document does not parse as YAML (line ${error.line}: ${error.message})`);"]]],
  ["a line break in a document printed as one", ["nothing a document holds reaches the log as it is", "a secret never survives the redactor"], [["export const oneLine = (text) => String(text).replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]/g, \" \");", "export const oneLine = (text) => String(text);"]]],
  ["only the plain line break taken out of a line", ["nothing a document holds reaches the log as it is", "a secret never survives the redactor"], [["export const oneLine = (text) => String(text).replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]/g, \" \");", "export const oneLine = (text) => String(text).replace(/\\n/g, \" \");"]]],
  ["a backtick left in the summary's block", ["nothing a document holds reaches the log as it is"], [["...lines.map((line) => plain(line).replace(/`/g, \"'\")), \"```\", \"\"];", "...lines.map((line) => plain(line)), \"```\", \"\"];"]]],
  ["a JSON document of any depth walked", ["nothing a document holds reaches the log as it is"], [["    if (deeperThan(doc, MAX_DEPTH)) throw new RefreshError(`the document is nested deeper than ${MAX_DEPTH} levels`);\n", ""]]],
  ["a secret left by the redactor", ["a secret never survives the redactor"], [["      for (const form of [pushCredential(key), key, encodeURIComponent(key), Buffer.from(key).toString(\"base64\")]) out = out.split(form).join(\"[key]\");", "      for (const form of [key]) out = out.split(form).join(\"[key]\");"]]],
  ["a bearer value left by the redactor", ["a secret never survives the redactor", "the token travels in the environment, never on the command line"], [["    return out.replace(/(authorization:?\\s*(?:bearer|basic)\\s+)\\S+/gi, \"$1[key]\");", "    return out;"]]],
  ["a git error cut before it is redacted", ["the token travels in the environment, never on the command line"], [["`git ${args[0]} failed: ${oneLine(redact(String(done.stderr || done.error || \"\").trim())).slice(0, ERROR_CHARS)}`", "`git ${args[0]} failed: ${oneLine(redact(String(done.stderr || done.error || \"\").trim().slice(0, ERROR_CHARS)))}`"]]],
  ["the push aimed at main", ["the push carries the document alone to its own branch"], [["export const BRANCH = \"claude/feed-spec-refresh\";", "export const BRANCH = \"main\";"], ["  if (!BRANCH.startsWith(\"claude/\")) throw new RefreshError(\"the refresh branch must be a claude/ branch\");\n", ""]]],
  ["a branch outside claude/ allowed", ["the push carries the document alone to its own branch"], [["export const BRANCH = \"claude/feed-spec-refresh\";", "export const BRANCH = \"refresh\";"]]],
  ["everything in the tree committed", ["the push carries the document alone to its own branch"], [["  git([\"add\", \"--\", SPEC_FILE]);", "  git([\"add\", \"-A\"]);"], ["  if (staged.length !== 1 || staged[0] !== SPEC_FILE) throw new RefreshError(\"more than the document is staged; nothing was pushed\");\n", ""]]],
  ["a commit that carries what was already staged", ["the push carries the document alone to its own branch"], [["  if (staged.length !== 1 || staged[0] !== SPEC_FILE) throw new RefreshError(\"more than the document is staged; nothing was pushed\");\n", ""]]],
  ["a cut document pushed", ["the push carries the document alone to its own branch"], [["  checkDocument(parseDocument(text).doc, origin);\n  if (!BRANCH", "  if (!BRANCH"]]],
  ["an unchanged document pushed", ["the push carries the document alone to its own branch"], [["  if (!git([\"status\", \"--porcelain\", \"--\", SPEC_FILE]).trim()) { out(\"nothing to push: the document did not change\"); return { pushed: false }; }\n", ""]]],
  ["the branch overwritten whatever it holds", ["a second run keeps what others put on the branch"], [["  if (tip !== \"\") {", "  if (tip === null) {"]]],
  ["a forced push with no lease", ["a second run keeps what others put on the branch", "the token travels in the environment, never on the command line"], [["  git([\"push\", `--force-with-lease=${ref}:${tip}`, remote, `HEAD:${ref}`], auth);", "  git([\"push\", \"--force\", remote, `HEAD:${ref}`], auth);"]]],
  ["a commit taken for the workflow's by its message alone", ["a second run keeps what others put on the branch"], [["      const own = authorName === COMMITTER.name && authorEmail === COMMITTER.email && committerName === COMMITTER.name && committerEmail === COMMITTER.email &&\n        SUBJECT.test(String(subject))", "      const own = SUBJECT.test(String(subject))"]]],
  ["a commit that carries other files taken for the workflow's", ["a second run keeps what others put on the branch"], [[" && COMMIT.test(parent) && files.length === 1 && files[0] === SPEC_FILE;", " && COMMIT.test(parent);"]]],
  ["a refresh commit replaced whatever lies under it", ["a second run keeps what others put on the branch"], [["      if (!own || call([\"merge-base\", \"--is-ancestor\", parent, \"HEAD\"]).status !== 0) {", "      if (!own) {"]]],
  ["a run started on the branch refused", ["a second run keeps what others put on the branch"], [["    const kept = call([\"merge-base\", \"--is-ancestor\", tip, \"HEAD\"]).status === 0;", "    const kept = false;"]]],
  ["a shallow checkout trusted to know what the branch holds", ["a second run keeps what others put on the branch"], [["    if (git([\"rev-parse\", \"--is-shallow-repository\"]).trim() !== \"false\") throw new RefreshError(`${BRANCH} exists and this checkout is shallow, so what the branch holds cannot be checked; nothing was pushed`);\n", ""]]],
  ["the token on the command line", ["the token travels in the environment, never on the command line"], [["  git([\"push\", `--force-with-lease=${ref}:${tip}`, remote, `HEAD:${ref}`], auth);", "  git([\"push\", `--force-with-lease=${ref}:${tip}`, remote.replace(\"https://\", `https://x-access-token:${token}@`), `HEAD:${ref}`], {});"]]],
  ["the token handed to every git command", ["the token travels in the environment, never on the command line"], [["  const call = (args, extra = {}) => run(\"git\", args, { cwd: root, encoding: \"utf8\", env: { ...process.env, ...extra } });", "  const call = (args, extra = {}) => run(\"git\", args, { cwd: root, encoding: \"utf8\", env: { ...process.env, ...extra, FEED_PUSH_TOKEN: token } });"]]],
  ["the token's header sent to any host", ["the token travels in the environment, never on the command line"], [["    [`GIT_CONFIG_KEY_${slot}`]: `http.${PUSH_HOST}.extraheader`,", "    [`GIT_CONFIG_KEY_${slot}`]: \"http.extraheader\","]]],
  ["the environment's own git configuration overwritten", ["the token travels in the environment, never on the command line"], [["  const slot = Number.isInteger(held) && held > 0 ? held : 0;", "  const slot = 0;"]]],
  ["a push without a token tried", ["the token travels in the environment, never on the command line"], [["  if (/^https:/.test(remote) && !token) throw new RefreshError(\"no token to push with\");\n", ""]]],
  ["another remote taken while the token is present", ["the token travels in the environment, never on the command line"], [["  if (override && token) throw new RefreshError(\"another remote is taken only when there is no token to send it\");\n", ""]]],
  ["the branch changed here before it is read on the remote", ["the token travels in the environment, never on the command line"], [["  const ref = `refs/heads/${BRANCH}`;\n", "  const ref = `refs/heads/${BRANCH}`;\n  git([\"checkout\", \"-B\", BRANCH]);\n"]]],
];

let planted = 0;
for (const [title, cases, transforms] of MUTANTS) {
  for (const name of cases) assert.ok(Object.hasOwn(CASES, name), `the planted build "${title}" names a case that exists`);
  const mutated = await loadMutated("scripts/feed-spec-refresh.mjs", transforms, { salt: ++planted });
  const began = Date.now();
  const problems = await refreshProblems(mutated, cases);
  ok(problems.length > 0, `PLANTED WRONG BUILD, ${title}: the refresh checks must fail it`);
  ok(problems.some((line) => !/: threw /.test(line)), `PLANTED WRONG BUILD, ${title}: a check must fail it, not only a crash (${problems[0]})`);
  sweep();
  if (process.env.FEED_SHOW) console.log(`${title} (${((Date.now() - began) / 1000).toFixed(1)} s)\n${problems.slice(0, 3).map((line) => `    ${line.slice(0, 260)}`).join("\n")}${problems.length > 3 ? `\n    and ${problems.length - 3} more` : ""}`);
}

{
  const text = fs.readFileSync(path.join(ROOT, WORKFLOW), "utf8");
  const flow = parseYaml(text);
  deep(Object.keys(flow.on), ["workflow_dispatch"], "THE WORKFLOW RUNS ONLY WHEN SOMEONE STARTS IT: workflow_dispatch is its one trigger");
  ok(!/\bcron:|\bschedule:|pull_request|\bpush:/.test(text), "it has no schedule and no push or pull request trigger, so the keepalive list does not grow");
  deep(flow.permissions, { contents: "read" }, "its default permission is to read");
  deep(Object.keys(flow.jobs), ["refresh"], "it has one job");
  const job = flow.jobs.refresh;
  deep(job.permissions, { contents: "write" }, "the one job may write contents and nothing else");
  ok(job["runs-on"] === "ubuntu-24.04" && Number.isInteger(job["timeout-minutes"]) && job["timeout-minutes"] <= 15, "the job runs on the pinned runner image with a timeout");
  const pins = (file) => [...fs.readFileSync(path.join(ROOT, file), "utf8").matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  const house = new Set(pins(".github/workflows/regression.yml"));
  const mine = job.steps.filter((s) => s.uses).map((s) => s.uses);
  ok(mine.length === 2 && mine.every((u) => house.has(u) && /@[0-9a-f]{40}$/.test(u)), `its actions are the two the other workflows pin, at the same commits: ${mine.join(", ")}`);
  ok(job.steps[0].uses.startsWith("actions/checkout@") && job.steps[0].with["persist-credentials"] === false, "the checkout leaves no credential behind");
  ok(job.steps[0].with["fetch-depth"] === 0 && Object.keys(job.steps[0].with).length === 2, "the checkout takes the whole history, which the script needs to tell what the refresh branch already holds");
  const runs = job.steps.filter((s) => s.run).map((s) => s.run);
  deep(runs, ["node scripts/feed-spec-refresh.mjs", "node scripts/feed-spec-refresh.mjs --push"], "its two steps run the script, first to download and compare, then to push");
  ok(runs.every((r) => !r.includes("${{")), "no input or secret is written into a command line");
  const envs = job.steps.filter((s) => s.env).map((s) => s.env);
  deep(envs, [{ [refreshModule.ADDRESS_ENV]: "${{ inputs.address }}", [refreshModule.KEY_ENV]: "${{ inputs.with_key && secrets.UW_API_KEY || '' }}" }, { [refreshModule.TOKEN_ENV]: "${{ github.token }}" }],
    "the address and the key reach the first step through its environment, the key only when asked for; the push step gets the job's own token and not the key");
  ok((text.match(/secrets\./g) || []).length === 1 && fs.readFileSync(path.join(ROOT, ".github/workflows/flows-probe.yml"), "utf8").includes("secrets.UW_API_KEY"), "the one secret it names is the one the probe workflow already uses");
  deep(Object.keys(flow.on.workflow_dispatch.inputs), ["address", "with_key"], "its inputs are the address and whether to use the key");
  ok(flow.on.workflow_dispatch.inputs.address.default === "" && flow.on.workflow_dispatch.inputs.with_key.default === false, "by default it starts from the documentation page and sends no key");
  ok(refreshModule.BRANCH === "claude/feed-spec-refresh" && !/\bmain\b/.test(text) && !/gh pr|pull-requests/.test(text), "it pushes to claude/feed-spec-refresh, never to main, and opens no pull request");
  ok(flow.concurrency.group === "feed-spec-refresh" && flow.concurrency["cancel-in-progress"] === false, "two runs do not race for the branch");
  ok(!BRAND.test(text) && !BRAND.test(fs.readFileSync(path.join(ROOT, "scripts/feed-spec-refresh.mjs"), "utf8")), "neither the workflow nor the script names the provider"); BRAND.lastIndex = 0;
  ok(!/["'`]\/api\/[^"'`]/.test(fs.readFileSync(path.join(ROOT, "scripts/feed-spec-refresh.mjs"), "utf8")) && refreshModule.DATA_PATHS === "/api/", "the script spells no path of the feed, only the prefix its data paths share");
}

sweep();
const mib = (bytes) => (bytes / MIB).toFixed(1);
console.log(`✓ flows-feed-spec-refresh: ${checks} checks. ${Object.keys(CASES).length} cases against two loopback servers and local git remotes; ${MUTANTS.length} planted wrong builds fail; ` +
  `of a 64 MiB answer the server had sent ${mib(measured.declared)} MiB when its declared length refused it, ${mib(measured.quiet)} MiB when it declared none, and ${mib(measured.refusal)} MiB of a refusal's body`);
