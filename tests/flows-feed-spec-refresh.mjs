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
      out: (l) => lines.push(String(l)), err: (l) => lines.push(String(l)), fetchImpl: extra.fetchImpl, run: extra.run,
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
      close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
    }));
  });
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

function git(cwd, args) {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr}`);
  return done.stdout.trim();
}

function makeRepo(specText) {
  const work = tempDir("feed-refresh-work-");
  const bare = tempDir("feed-refresh-remote-");
  git(bare, ["init", "--bare", "--initial-branch=main", "."]);
  git(work, ["init", "--initial-branch=main", "."]);
  fs.mkdirSync(path.join(work, "docs"));
  fs.writeFileSync(path.join(work, SPEC), specText);
  fs.writeFileSync(path.join(work, "other.txt"), "one\n");
  git(work, ["add", "-A"]);
  git(work, ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-m", "base"]);
  git(work, ["push", bare, "HEAD:refs/heads/main"]);
  return { work, bare, base: git(work, ["rev-parse", "HEAD"]) };
}

const CASES = {};
const define = (name, fn) => { CASES[name] = fn; };

async function refreshProblems(mod, only = null) {
  const problems = [];
  const need = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
  const feedServer = await startServer();
  const other = await startServer();
  try {
    const base = COMMITTED.split(REAL_ORIGIN).join(feedServer.origin);
    const edited = editedDocument(base);
    const world = { mod, need, feedServer, other, base, edited, editedYaml: dumpYaml(edited.doc), editedJson: JSON.stringify(edited.doc) };
    for (const [name, fn] of Object.entries(CASES)) {
      if (only && !only.includes(name)) continue;
      feedServer.routes.clear(); other.routes.clear(); feedServer.hits.length = 0; other.hits.length = 0;
      try { await fn(world); } catch (error) { problems.push(`${name}: threw ${error && error.stack ? error.stack.split("\n").slice(0, 3).join(" | ") : error}`); }
    }
  } finally {
    await feedServer.close();
    await other.close();
  }
  return problems;
}

define("a good document in the committed layout", async ({ mod, need, feedServer, base, edited, editedYaml }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", send(editedYaml));
  const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 0, `a good document is refused (${got.text.slice(0, 200)})`);
  need(got.spec === editedYaml, "the working tree does not hold the downloaded document, byte for byte");
  need(got.output === "changed=true\n", `the step output is ${JSON.stringify(got.output)}`);
  need(got.summary.includes("+ operation GET /api/sample/new-thing") && got.summary.includes("- operation GET /api/darkpool/recent") && got.summary.includes("+ changelog 2099.01.02"), "the step summary does not carry the comparison's added and removed operations and the new changelog entry");
  need(new RegExp(`required (?:query|path):${edited.flipped}`).test(got.summary) && got.summary.includes("~ GET /api/alerts"), "the step summary does not name the parameter whose required flag flipped");
  need(got.summary.includes("218 operations") && got.text.includes("(the feed)/spec.yaml"), "the report does not say where the document came from and how large it is");
  need(feedServer.hits.length === 1 && feedServer.hits.every((h) => h.auth === null), "a document that answers an anonymous request was asked for with the key");
  need(secretsAbsent(got.printed), "the key was printed");
});

define("the default address is the documentation page the committed copy links to", async ({ mod, need, feedServer, other, base, edited, editedJson }) => {
  const root = makeRoot(base);
  const decoy = structuredClone(edited.doc);
  decoy.paths["/api/decoy/only-elsewhere"] = structuredClone(decoy.paths["/api/sample/new-thing"]);
  decoy.paths["/api/decoy/only-elsewhere"].get.operationId = "PublicApi.DecoyController.elsewhere";
  other.routes.set("/openapi.json", send(JSON.stringify(decoy), "application/json"));
  const page = `<!doctype html><html><head><script src="/assets/swagger-ui-bundle.js"></script><link href="/openapi.css" rel="stylesheet"></head><body>
    <a href="${other.origin}/openapi.json">mirror</a><script>window.ui = SwaggerUIBundle({ url: "/docs/openapi.json" })</script></body></html>`;
  feedServer.routes.set("/docs", send(page, "text/html; charset=utf-8"));
  feedServer.routes.set("/docs/openapi.json", send(editedJson, "application/json"));
  const got = await runMain(mod, root, {});
  need(got.code === 0, `the documentation page's own link is not followed to the document (${got.text.slice(0, 300)})`);
  need(got.code !== 0 || refreshModule.sameDocument(parseYaml(got.spec), edited.doc), "the document written is not the one the page on the feed's own origin links to");
  need(!got.spec.includes("only-elsewhere") && other.hits.length === 0, "a link to another origin was followed");
  need(got.code !== 0 || Object.keys(digestSpec(got.spec).ops).length === 218, "a document served as JSON is not rewritten in the layout the existing line reader reads");
  need(feedServer.hits.map((h) => h.route).join() === "/docs,/docs/openapi.json", `the page's script and stylesheet were asked for: ${feedServer.hits.map((h) => h.route).join()}`);
});

define("a refusal without the key", async ({ mod, need, feedServer, base, editedYaml }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", refuseWithoutKey(editedYaml));
  const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(got.code === 1 && /answered 403/.test(got.text), `a 403 is not reported as a 403 (${got.code}: ${got.text.slice(0, 200)})`);
  need(got.spec === base && got.output === "" && got.summary === "", "a refused download left something behind");
});

define("a refusal answered with the key", async ({ mod, need, feedServer, base, editedYaml }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", refuseWithoutKey(editedYaml));
  const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 0 && got.spec === editedYaml, `the key did not open the document (${got.text.slice(0, 200)})`);
  need(feedServer.hits.length === 2 && feedServer.hits[0].auth === null && feedServer.hits[1].auth === `Bearer ${KEY}`, "the key was not held back until the anonymous request was refused");
  need(secretsAbsent(got.printed) && /asking again with the key/.test(got.text), "the key was printed, or the second request was not announced");
});

define("the key stays on the feed's own origin", async ({ mod, need, feedServer, other, base, editedYaml }) => {
  const root = makeRoot(base);
  other.routes.set("/spec.yaml", refuseWithoutKey(editedYaml));
  const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${other.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 1 && got.spec === base, "a document on another origin was opened with the key");
  need(other.hits.length === 1 && other.hits.every((h) => h.auth === null), "the key was sent to another origin");
});

define("the key does not follow a redirect", async ({ mod, need, feedServer, other, base, editedYaml }) => {
  const root = makeRoot(base);
  other.routes.set("/spec.yaml", send(editedYaml));
  feedServer.routes.set("/spec.yaml", (req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) { send("forbidden", "text/plain", 403)(req, res); return; }
    res.writeHead(302, { location: `${other.origin}/spec.yaml` });
    res.end();
  });
  const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml`, UW_API_KEY: KEY });
  need(got.code === 1 && got.spec === base, "a keyed request was redirected to another origin and its answer taken");
  need(other.hits.every((h) => h.auth === null), "the key followed a redirect to another origin");
});

define("an HTML page instead of a document", async ({ mod, need, feedServer, base, editedJson }) => {
  const root = makeRoot(base);
  feedServer.routes.set("/spec.yaml", send("<!DOCTYPE html><html><body><h1>Sign in</h1></body></html>", "text/html"));
  const plainPage = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(plainPage.code === 1 && /HTML page that links to no document/.test(plainPage.text) && plainPage.spec === base, `an HTML page is not named as one (${plainPage.text.slice(0, 200)})`);
  feedServer.routes.set("/docs", send("<html><body><a href=\"/docs/openapi.json\">spec</a></body></html>", "text/html"));
  feedServer.routes.set("/docs/openapi.json", send("<html><body><a href=\"/docs/v2/openapi.json\">moved</a></body></html>", "application/json"));
  feedServer.routes.set("/docs/v2/openapi.json", send(editedJson, "application/json"));
  const twice = await runMain(mod, root, {});
  need(twice.code === 1 && /answered an HTML page/.test(twice.text) && twice.spec === base && feedServer.hits.length === 3, "a link that leads to another page is followed further, or taken for a document");
});

define("a document cut short", async ({ mod, need, feedServer, base }) => {
  const root = makeRoot(base);
  const half = base.slice(0, Math.floor(base.length / 2));
  const address = { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` };
  feedServer.routes.set("/spec.yaml", (req, res) => { res.writeHead(200, { "content-type": "application/yaml", "content-length": Buffer.byteLength(base) }); res.write(half); setTimeout(() => res.destroy(), 20); });
  const broken = await runMain(mod, root, address);
  need(broken.code === 1 && /broke off|did not answer/.test(broken.text) && broken.spec === base, `a transfer that breaks off is not refused (${broken.code}: ${broken.text.slice(0, 200)})`);
  const lines = base.split("\n");
  const midLine = lines.slice(0, 20000).join("\n").slice(0, -7);
  feedServer.routes.set("/spec.yaml", send(midLine));
  const mid = await runMain(mod, root, address);
  need(mid.code === 1 && mid.spec === base, "a document cut in the middle of a line is taken");
  const pathLines = lines.map((l, i) => (/^ {2}\/api\//.test(l) ? i : -1)).filter((i) => i >= 0);
  const atBoundary = `${lines.slice(0, pathLines[212]).join("\n")}\n`;
  feedServer.routes.set("/spec.yaml", send(atBoundary));
  const boundary = await runMain(mod, root, address);
  need(Object.keys(parseYaml(atBoundary).paths).length === 212, "the cut document of this case holds 212 whole paths");
  need(boundary.code === 1 && /names no server/.test(boundary.text) && boundary.spec === base, `a document cut at a line break after its 212th path is taken (${boundary.text.slice(0, 200)})`);
  const noFinalBreak = base.slice(0, base.lastIndexOf("tags: []")) + "tags:";
  feedServer.routes.set("/spec.yaml", send(noFinalBreak));
  const tail = await runMain(mod, root, address);
  need(tail.code === 1 && /does not end with a line break/.test(tail.text) && tail.spec === base, `a document without its last line break is taken (${tail.code}: ${tail.text.slice(0, 200)})`);
  feedServer.routes.set("/spec.yaml", send(JSON.stringify(parseYaml(base)).slice(0, 400000), "application/json"));
  const json = await runMain(mod, root, address);
  need(json.code === 1 && /does not parse as JSON/.test(json.text) && json.spec === base, "a JSON document cut short is taken");
  const dangling = parseYaml(base);
  for (const name of Object.keys(dangling.components.schemas).slice(400)) delete dangling.components.schemas[name];
  feedServer.routes.set("/spec.yaml", send(dumpYaml(dangling)));
  const refs = await runMain(mod, root, address);
  need(refs.code === 1 && /references point at no component/.test(refs.text) && refs.spec === base, "a document whose schemas were cut away is taken");
});

define("fewer than 200 paths", async ({ mod, need, feedServer, base }) => {
  const root = makeRoot(base);
  const small = parseYaml(base);
  for (const route of Object.keys(small.paths).slice(199)) delete small.paths[route];
  feedServer.routes.set("/spec.yaml", send(dumpYaml(small)));
  const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(got.code === 1 && /holds 199 paths, fewer than the 200/.test(got.text) && got.spec === base, `a document of 199 paths is taken (${got.text.slice(0, 200)})`);
  const enough = parseYaml(base);
  for (const route of Object.keys(enough.paths).slice(200)) delete enough.paths[route];
  feedServer.routes.set("/spec.yaml", send(dumpYaml(enough)));
  const exact = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(exact.code === 0 && Object.keys(parseYaml(exact.spec).paths).length === 200, `a document of exactly 200 paths is refused (${exact.text.slice(0, 200)})`);
});

define("another document of the right size", async ({ mod, need, feedServer, base }) => {
  const root = makeRoot(base);
  const stranger = parseYaml(base);
  let moved = 0;
  for (const route of Object.keys(stranger.paths).slice(0, 30)) {
    moved += Object.keys(stranger.paths[route]).filter((verb) => ["get", "post", "put", "patch", "delete"].includes(verb)).length;
    stranger.paths[`/other${route}`] = stranger.paths[route];
    delete stranger.paths[route];
  }
  feedServer.routes.set("/spec.yaml", send(dumpYaml(stranger)));
  const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(moved > 22 && got.code === 1 && got.text.includes(`lacks ${moved} of the 218 committed operations`) && got.spec === base, `a document of the same size that lost ${moved} of the committed operations is taken (${got.text.slice(0, 200)})`);
  const fewer = parseYaml(base);
  for (const route of Object.keys(fewer.paths).slice(0, 12)) { fewer.paths[`/other${route}`] = fewer.paths[route]; delete fewer.paths[route]; }
  feedServer.routes.set("/spec.yaml", send(dumpYaml(fewer)));
  const fine = await runMain(mod, makeRoot(base), { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(fine.code === 0 && /- operation /.test(fine.summary), `a document that renamed a dozen paths is refused (${fine.text.slice(0, 200)})`);
});

define("the same document again", async ({ mod, need, feedServer, base }) => {
  const root = makeRoot(base);
  const before = fs.statSync(path.join(root, SPEC)).mtimeMs;
  feedServer.routes.set("/spec.yaml", send(base));
  const same = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(same.code === 0 && same.output === "changed=false\n" && /nothing is written/.test(same.text) && /no difference in operations/.test(same.summary), `the committed copy served back is not reported as unchanged (${same.text.slice(0, 200)})`);
  feedServer.routes.set("/spec.yaml", send(JSON.stringify(parseYaml(base)), "application/json"));
  const asJson = await runMain(mod, root, { FEED_SPEC_ADDRESS: `${feedServer.origin}/spec.yaml` });
  need(asJson.code === 0 && asJson.output === "changed=false\nchanged=false\n" && asJson.spec === base && fs.statSync(path.join(root, SPEC)).mtimeMs === before, "the same document served as JSON rewrites the committed copy");
});

define("an address that may not be asked", async ({ mod, need, feedServer, base }) => {
  const root = makeRoot(base);
  for (const address of ["ftp://files.example.test/spec.yaml", "http://files.example.test/spec.yaml", `http://user:pass@127.0.0.1:${new URL(feedServer.origin).port}/spec.yaml`, "not an address", "file:///etc/passwd"]) {
    const asked = [];
    const got = await runMain(mod, root, { FEED_SPEC_ADDRESS: address }, { fetchImpl: async (url) => { asked.push(String(url)); return new Response("no", { status: 404 }); } });
    need(got.code === 1 && asked.length === 0 && feedServer.hits.length === 0 && got.spec === base, `the address ${address} is asked`);
  }
  const allowed = [];
  await runMain(mod, root, { FEED_SPEC_ADDRESS: "https://files.example.test/spec.yaml" }, { fetchImpl: async (url) => { allowed.push(String(url)); return new Response("no", { status: 404 }); } });
  need(allowed.join() === "https://files.example.test/spec.yaml", "an https address on another host is not asked at all");
  const bad = await runMain(mod, root, {}, { argv: ["--force"] });
  need(bad.code === 2, "an unknown flag is not a usage error");
  const linkless = makeRoot(base.split(`${feedServer.origin}/docs`).join(`${feedServer.origin}/manual`));
  const none = await runMain(mod, linkless, {});
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

define("a secret never survives the redactor", async ({ mod, need }) => {
  const redact = mod.redactor(KEY);
  const dirty = `a ${KEY} b ${encodeURIComponent(KEY)} c ${Buffer.from(KEY).toString("base64")} d Authorization: Bearer abc.def e authorization: basic eC1hY2Nlc3M=`;
  const clean = redact(dirty);
  need(!clean.includes(KEY) && !clean.includes(encodeURIComponent(KEY)) && !clean.includes(Buffer.from(KEY).toString("base64")) && !clean.includes("abc.def") && !clean.includes("eC1hY2Nlc3M="), `the redactor leaves a secret: ${clean}`);
  need(mod.redactor("")("plain text") === "plain text" && mod.redactor(undefined)("plain text") === "plain text", "the redactor changes text when there is no secret");
});

define("the push carries the document alone to its own branch", async ({ mod, need, base, editedYaml }) => {
  const repo = makeRepo(base);
  const idle = await runMain(mod, repo.work, { FEED_SPEC_REMOTE: repo.bare }, { argv: ["--push"] });
  need(idle.code === 0 && /nothing to push/.test(idle.text) && git(repo.bare, ["for-each-ref", "--format=%(refname)"]) === "refs/heads/main", `an unchanged document is pushed (${idle.text.slice(0, 200)})`);
  fs.writeFileSync(path.join(repo.work, SPEC), editedYaml);
  fs.writeFileSync(path.join(repo.work, "other.txt"), "two\n");
  fs.writeFileSync(path.join(repo.work, "stray.txt"), "left behind\n");
  const got = await runMain(mod, repo.work, { FEED_SPEC_REMOTE: repo.bare }, { argv: ["--push"] });
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
  const mixed = await runMain(mod, staged.work, { FEED_SPEC_REMOTE: staged.bare }, { argv: ["--push"] });
  need(mixed.code === 1 && /more than the document is staged/.test(mixed.text) && git(staged.bare, ["for-each-ref", "--format=%(refname)"]) === "refs/heads/main", "a commit that would carry another file is pushed");
  const cut = makeRepo(base);
  fs.writeFileSync(path.join(cut.work, SPEC), base.slice(0, 300000));
  const partial = await runMain(mod, cut.work, { FEED_SPEC_REMOTE: cut.bare }, { argv: ["--push"] });
  need(partial.code === 1 && git(cut.bare, ["for-each-ref", "--format=%(refname)"]) === "refs/heads/main" && git(cut.work, ["rev-parse", "--abbrev-ref", "HEAD"]) === "main", "a document cut short in the working tree is pushed, or a branch is made for it");
});

define("the token travels in the environment, never on the command line", async ({ mod, need, base, editedYaml }) => {
  const root = makeRoot(editedYaml);
  const calls = [];
  const run = (cmd, args, options) => {
    calls.push({ cmd, args, env: options.env });
    const stdout = args[0] === "status" ? ` M ${SPEC}\n` : args[0] === "diff" ? `${SPEC}\n` : "";
    return { status: 0, stdout, stderr: "" };
  };
  const got = await runMain(mod, root, { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: "owner/site" }, { argv: ["--push"], run });
  const pushCall = calls.find((c) => c.args[0] === "push");
  need(got.code === 0 && Boolean(pushCall), `the push is not made (${got.text.slice(0, 200)})`);
  need(Boolean(pushCall) && JSON.stringify(pushCall.args) === JSON.stringify(["push", "--force", "https://github.com/owner/site.git", "HEAD:refs/heads/claude/feed-spec-refresh"]), `the push is ${pushCall && pushCall.args.join(" ")}`);
  need(calls.every((c) => c.cmd === "git" && c.args.every((a) => !a.includes(TOKEN) && !a.includes(Buffer.from(`x-access-token:${TOKEN}`).toString("base64")))), "the token is on a command line");
  const slot = Number.parseInt(process.env.GIT_CONFIG_COUNT || "0", 10) || 0;
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString("base64")}`;
  need(Boolean(pushCall) && pushCall.env.GIT_CONFIG_COUNT === String(slot + 1) && pushCall.env[`GIT_CONFIG_KEY_${slot}`] === "http.extraheader" && pushCall.env[`GIT_CONFIG_VALUE_${slot}`] === header, "the token is not handed to git as a request header in its environment, after whatever configuration the environment already carries");
  need(Boolean(pushCall) && Array.from({ length: slot }, (_, i) => i).every((i) => pushCall.env[`GIT_CONFIG_KEY_${i}`] === process.env[`GIT_CONFIG_KEY_${i}`] && pushCall.env[`GIT_CONFIG_VALUE_${i}`] === process.env[`GIT_CONFIG_VALUE_${i}`]), "the configuration the environment already carries is overwritten");
  need(calls.filter((c) => c.args[0] !== "push").every((c) => c.env.GIT_CONFIG_COUNT === process.env.GIT_CONFIG_COUNT && !Object.values(c.env).some((v) => typeof v === "string" && (v.includes(TOKEN) || v.includes(header)))), "the token is handed to a git command that does not talk to the remote");
  need(secretsAbsent(got.printed), "the token was printed");
  const failing = (cmd, args) => (args[0] === "push" ? { status: 1, stdout: "", stderr: `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/owner/site.git/'` } : run(cmd, args, { env: {} }));
  const failed = await runMain(mod, root, { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: "owner/site" }, { argv: ["--push"], run: failing });
  need(failed.code === 1 && secretsAbsent(failed.printed) && /git push failed/.test(failed.text), "a failed push prints the token, or is not reported");
  const noToken = await runMain(mod, root, { GITHUB_REPOSITORY: "owner/site" }, { argv: ["--push"], run });
  need(noToken.code === 1 && /no token to push with/.test(noToken.text), "a push to the remote is tried without a token");
  const nowhere = await runMain(mod, root, { GH_TOKEN: TOKEN }, { argv: ["--push"], run });
  need(nowhere.code === 1 && /no repository to push to/.test(nowhere.text), "a push is tried with no repository named");
});

{
  const problems = await refreshProblems(refreshModule);
  deep(problems, [], "THE REFRESH TAKES A WHOLE DOCUMENT AND NOTHING ELSE: a good document in either format is written and compared, a refusal, a page, a cut document, a small one and a foreign one are each refused by name, the key goes to the feed's own origin only after an anonymous refusal, and the push carries the document alone to claude/feed-spec-refresh");
}

const MUTANTS = [
  ["a document of any size taken", ["fewer than 200 paths"], [["export const MIN_PATHS = 200;", "export const MIN_PATHS = 1;"]]],
  ["the key sent to another origin", ["the key stays on the feed's own origin"], [["  try { return new URL(address).origin === origin; } catch { return false; }", "  return true;"]]],
  ["the key sent before any refusal", ["a good document in the committed layout"], [["        got = await getText(fetchImpl, address, { accept: ACCEPT, \"user-agent\": \"feed-spec-refresh\" });\n        if (", "        got = await getText(fetchImpl, address, { accept: ACCEPT, \"user-agent\": \"feed-spec-refresh\", ...(key ? { authorization: `Bearer ${key}` } : {}) });\n        if ("]]],
  ["a keyed request following a redirect", ["the key does not follow a redirect"], [["redirect: headers.authorization ? \"error\" : \"follow\"", "redirect: \"follow\""]]],
  ["an HTML page not recognised", ["the default address is the documentation page the committed copy links to", "an HTML page instead of a document"], [["export function looksLikeHtml(text, contentType) {\n", "export function looksLikeHtml(text, contentType) {\n  if (text) return false;\n"]]],
  ["a link to another origin followed", ["the default address is the documentation page the committed copy links to"], [["    if (url.origin !== page.origin || url.href === page.href) continue;", "    if (url.href === page.href) continue;"]]],
  ["a page's scripts taken for documents", ["the default address is the documentation page the committed copy links to"], [["    if (/\\.(?:js|css|png|svg|ico|map|html?)(?:$|[?#])/i.test(url.pathname)) continue;\n", ""]]],
  ["links followed from a second page", ["an HTML page instead of a document"], [["        const links = hop === 0 ? documentLinks(got.text, address) : [];", "        const links = documentLinks(got.text, address);"]]],
  ["a document without its servers taken", ["a document cut short"], [["  if (!Array.isArray(doc.servers) || !isObj(doc.servers[0]) || typeof doc.servers[0].url !== \"string\") throw new RefreshError(\"the document names no server, so it was cut short\");\n", ""]]],
  ["a document without its last line break taken", ["a document cut short"], [["  if (!body.endsWith(\"\\n\")) throw new RefreshError(\"the document does not end with a line break, so it was cut short\");\n", ""]]],
  ["references to missing schemas ignored", ["a document cut short"], [["  if (dangling.length) throw new RefreshError(", "  if (dangling.length < 0) throw new RefreshError("]]],
  ["a document that lost a tenth of its operations taken", ["another document of the right size"], [["  if (lost > Math.max(10, MAX_LOST_SHARE * Object.keys(before.ops).length)) throw new RefreshError(", "  if (lost < 0) throw new RefreshError("]]],
  ["the same document written again", ["the same document again"], [["  const changed = text !== committed && !sameDocument(parseYaml(committed), got.doc);", "  const changed = true;"]]],
  ["a layout change counted as a change", ["the same document again"], [["  const changed = text !== committed && !sameDocument(parseYaml(committed), got.doc);", "  const changed = text !== committed;"]]],
  ["an address of any scheme asked", ["an address that may not be asked"], [["  if (url.protocol !== \"https:\" && !(url.protocol === \"http:\" && LOOPBACK.has(url.hostname))) throw new RefreshError(\"the address must be https\");\n", ""]]],
  ["credentials in the address allowed", ["an address that may not be asked"], [["  if (url.username || url.password) throw new RefreshError(\"the address must carry no credentials\");\n", ""]]],
  ["the provider named in the log", ["the provider is not named in the log"], [["  const plain = (text) => redact(brand ? String(text).replace(brand, \"the feed\").replace(/\\b([Tt])he the feed\\b/g, \"$1he feed\") : String(text));", "  const plain = (text) => redact(String(text));"]]],
  ["the feed's host printed with the address", ["the provider is not named in the log"], [["placeOf(got.address, origin)", "got.address"]]],
  ["the article doubled before the feed", ["the provider is not named in the log"], [[".replace(/\\b([Tt])he the feed\\b/g, \"$1he feed\") : String(text));", " : String(text));"]]],
  ["a secret left by the redactor", ["a secret never survives the redactor"], [["      for (const form of [key, encodeURIComponent(key), Buffer.from(key).toString(\"base64\")]) out = out.split(form).join(\"[key]\");", "      for (const form of [key]) out = out.split(form).join(\"[key]\");"]]],
  ["a bearer value left by the redactor", ["a secret never survives the redactor", "the token travels in the environment, never on the command line"], [["    return out.replace(/(authorization:?\\s*(?:bearer|basic)\\s+)\\S+/gi, \"$1[key]\");", "    return out;"]]],
  ["the push aimed at main", ["the push carries the document alone to its own branch"], [["export const BRANCH = \"claude/feed-spec-refresh\";", "export const BRANCH = \"main\";"], ["  if (!BRANCH.startsWith(\"claude/\")) throw new RefreshError(\"the refresh branch must be a claude/ branch\");\n", ""]]],
  ["a branch outside claude/ allowed", ["the push carries the document alone to its own branch"], [["export const BRANCH = \"claude/feed-spec-refresh\";", "export const BRANCH = \"refresh\";"]]],
  ["everything in the tree committed", ["the push carries the document alone to its own branch"], [["  git([\"add\", \"--\", SPEC_FILE]);", "  git([\"add\", \"-A\"]);"], ["  if (staged.length !== 1 || staged[0] !== SPEC_FILE) throw new RefreshError(\"more than the document is staged; nothing was pushed\");\n", ""]]],
  ["a commit that carries what was already staged", ["the push carries the document alone to its own branch"], [["  if (staged.length !== 1 || staged[0] !== SPEC_FILE) throw new RefreshError(\"more than the document is staged; nothing was pushed\");\n", ""]]],
  ["a cut document pushed", ["the push carries the document alone to its own branch"], [["  checkDocument(parseDocument(text).doc);\n  if (!BRANCH", "  if (!BRANCH"]]],
  ["an unchanged document pushed", ["the push carries the document alone to its own branch"], [["  if (!git([\"status\", \"--porcelain\", \"--\", SPEC_FILE]).trim()) { out(\"nothing to push: the document did not change\"); return { pushed: false }; }\n", ""]]],
  ["the token on the command line", ["the token travels in the environment, never on the command line"], [["  git([\"push\", \"--force\", remote, `HEAD:refs/heads/${BRANCH}`], auth);", "  git([\"push\", \"--force\", remote.replace(\"https://\", `https://x-access-token:${token}@`), `HEAD:refs/heads/${BRANCH}`], {});"]]],
  ["the token handed to every git command", ["the token travels in the environment, never on the command line"], [["    const done = run(\"git\", args, { cwd: root, encoding: \"utf8\", env: { ...process.env, ...extra } });", "    const done = run(\"git\", args, { cwd: root, encoding: \"utf8\", env: { ...process.env, ...extra, FEED_PUSH_TOKEN: token } });"]]],
  ["the environment's own git configuration overwritten", ["the token travels in the environment, never on the command line"], [["  const slot = Number.isInteger(held) && held > 0 ? held : 0;", "  const slot = 0;"]]],
  ["a push without a token tried", ["the token travels in the environment, never on the command line"], [["  if (/^https:/.test(remote) && !token) throw new RefreshError(\"no token to push with\");\n", ""]]],
];

let planted = 0;
for (const [title, cases, transforms] of MUTANTS) {
  for (const name of cases) assert.ok(Object.hasOwn(CASES, name), `the planted build "${title}" names a case that exists`);
  const mutated = await loadMutated("scripts/feed-spec-refresh.mjs", transforms, { salt: ++planted });
  const problems = await refreshProblems(mutated, cases);
  ok(problems.length > 0, `PLANTED WRONG BUILD, ${title}: the refresh checks must fail it`);
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
  ok(!/"\/api\//.test(fs.readFileSync(path.join(ROOT, "scripts/feed-spec-refresh.mjs"), "utf8")), "the script spells no path of the feed");
}

for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
console.log(`✓ flows-feed-spec-refresh: ${checks} checks. ${Object.keys(CASES).length} cases against two loopback servers and local git remotes; ${MUTANTS.length} planted wrong builds fail`);
