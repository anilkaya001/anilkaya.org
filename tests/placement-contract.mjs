#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";

const ROOT = resolve(new URL("../", import.meta.url).pathname);
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const bank = JSON.parse(read("assets/data/placement-bank.json"));
const source = read("assets/js/placement.js");
const html = read("lab/placement/index.html");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "assets/js/placement.js" });
const core = sandbox.__IEWTPlacementTest;
assert(core && Object.isFrozen(core), "placement pure engine was not exposed to the VM contract");

const questions = core.normalizeBank(bank);
assert.equal(questions.length, 15);
assert.equal(new Set(questions.map((question) => question.id)).size, 15);
assert.deepEqual(
  Object.fromEntries([...core.PLACEMENT_TYPES].map((type) => [type, questions.filter((question) => question.type === type).length])),
  { choice: 3, boolean: 3, multi: 3, numeric: 3, fill: 3 },
  "placement interactions are not exactly balanced",
);
assert.deepEqual(
  Object.fromEntries([...core.PLACEMENT_BANDS].map((difficulty) => [difficulty, questions.filter((question) => question.difficulty === difficulty).length])),
  { foundation: 5, applied: 5, advanced: 5 },
  "placement difficulty tiers are not exactly balanced",
);
assert.deepEqual([...new Set(questions.map((question) => question.topic))].sort(), [...core.TOPIC_ORDER].sort());
for (const question of questions) {
  assert(question.prompt.length <= 220, `${question.id}: prompt is no longer concise`);
  assert(question.explanation.length >= 60, `${question.id}: explanation is too thin`);
}

const correctResponse = (question) => {
  if (question.type === "choice") return question.answer;
  if (question.type === "boolean") return question.answer;
  if (question.type === "multi") return [...question.answers];
  if (question.type === "numeric") return String(question.answer);
  return question.accept[0];
};
const wrongResponse = (question) => {
  if (question.type === "choice") return (question.answer + 1) % question.choices.length;
  if (question.type === "boolean") return !question.answer;
  if (question.type === "multi") return [];
  if (question.type === "numeric") return String(question.answer + Math.max(10, question.tolerance * 100));
  return "definitely-not-the-answer";
};
const boundaryOutcome = (correctCount) => core.grade(questions, questions.map((question, index) =>
  index < correctCount ? correctResponse(question) : wrongResponse(question)));

assert.equal(boundaryOutcome(0).band, "foundation");
assert.equal(boundaryOutcome(6).band, "foundation");
assert.equal(boundaryOutcome(7).band, "applied");
assert.equal(boundaryOutcome(11).band, "applied");
assert.equal(boundaryOutcome(12).band, "advanced");
assert.equal(boundaryOutcome(15).band, "advanced");
assert.equal(boundaryOutcome(6).recommendedTopic, "ols", "foundation route must begin with the prerequisite base");
assert.equal(boundaryOutcome(7).recommendedTopic, "iv2sls", "applied GMM weakness must route through IV first");
assert.equal(boundaryOutcome(15).recommendedTopic, "gmm", "perfect placement must recommend the advanced capstone");
assert.deepEqual(plain(boundaryOutcome(7)), plain(boundaryOutcome(7)), "placement recommendation is not deterministic");

for (const [band, topic] of [["foundation", "ols"], ["applied", "did"], ["advanced", "gmm"]]) {
  const route = [...core.courseRoute(band, topic)];
  assert.equal(route.length, 3, `${band}: route must have exactly three courses`);
  assert.equal(new Set(route).size, 3, `${band}: route repeats a course`);
  assert.equal(route[0], topic, `${band}: persisted recommendation must be the first course`);
  for (const courseId of route) assert.match(core.COURSES[courseId].href, /^\/lab\/[a-z0-9-]+\/$/);
}

const persisted = core.normalizeResult({
  band: "applied",
  score: 8,
  total: 15,
  completedDay: "2026-07-15",
  recommendedTopic: "did",
  responses: ["must never survive"],
  email: "must never survive",
});
assert.deepEqual(plain(persisted), {
  band: "applied", score: 8, total: 15, completedDay: "2026-07-15", recommendedTopic: "did",
}, "placement result did not sanitize to the exact five-field shape");
assert.equal(core.normalizeResult({ ...persisted, total: 14 }), null);
assert.equal(core.normalizeResult({ ...persisted, band: "advanced" }), null);
assert.throws(() => core.bandForScore(16), /Invalid placement score/);

assert(!source.includes("localStorage"), "placement bypassed IEWTStorage with direct localStorage access");
assert(!source.includes("Gamify"), "placement must never integrate with points");
assert(!/\.set(?:Progress|Gamify|Mastery)\s*\(/.test(source), "placement mutates a learning-progress store");
assert(!html.includes("pyodide") && !html.includes("lab-core.js") && !html.includes("course-catalog.js"), "placement HTML loads a heavyweight learning payload");
assert(!html.includes("ols-slope-meaning") && !html.includes("data-answer") && !html.includes('"answer":'), "static HTML fallback exposes an answer key");
assert(html.includes("application/ld+json") && html.includes('href="https://anilkaya.org/lab/placement/"'), "placement metadata is incomplete");
for (const href of Object.values(core.COURSES).map((course) => course.href)) {
  assert(html.includes(`href="${href}"`), `crawlable fallback is missing ${href}`);
}

const MIME = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
});

function staticServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/bootstrap" || url.pathname === "/api/me") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({
        user: null, progress: {}, stats: { points: 0, streak: 0, last: null }, mastery: {}, placement: null, generation: 0,
      }));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const relative = normalize(pathname).replace(/^[/\\]+/, "");
    const file = resolve(ROOT, relative);
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error("not-file");
      response.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function answerEveryQuestionCorrectly(page) {
  for (let index = 0; index < bank.questions.length; index++) {
    const question = bank.questions[index];
    if (question.type === "choice") {
      await page.locator(`input[name="placement-answer"][value="${question.answer}"]`).check();
    } else if (question.type === "boolean") {
      await page.locator(`input[name="placement-answer"][value="${question.answer}"]`).check();
    } else if (question.type === "multi") {
      for (const answer of question.answers) await page.locator(`input[name="placement-answer"][value="${answer}"]`).check();
    } else if (question.type === "numeric") {
      await page.locator("input[name='placement-answer']").fill(String(question.answer));
    } else {
      await page.locator("input[name='placement-answer']").fill(question.accept[0]);
    }
    await page.locator("form.placement-form button[type='submit']").click();
    if (index < bank.questions.length - 1) {
      await page.getByRole("heading", { name: `Question ${index + 2}`, exact: true }).waitFor();
    }
  }
}

const { server, origin } = await staticServer();
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const requests = [];
  const browserErrors = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });

  await page.goto(origin + "/lab/placement/", { waitUntil: "load" });
  await page.locator("#placementAppTitle").waitFor();
  assert(await page.evaluate(() => document.activeElement === document.body), "background placement hydration stole keyboard focus");
  assert.equal(await page.locator(".placement-method-grid a").count(), 7);
  const startBox = await page.locator(".placement-intro__actions .placement-primary").boundingBox();
  assert(startBox && startBox.height >= 44, "mobile placement start control is not touch-safe");
  assert((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, "placement intro overflows at 390px");

  await page.locator(".placement-intro__actions .placement-primary").click();
  await page.getByRole("heading", { name: "Question 1", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "placementQuestionTitle", "question heading did not receive focus");
  assert((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, "placement question overflows at 390px");
  await page.locator("input[name='placement-answer']").first().focus();
  await page.keyboard.press("Space");
  assert(await page.locator("input[name='placement-answer']").first().isChecked(), "native keyboard selection failed");

  await answerEveryQuestionCorrectly(page);

  await page.getByRole("heading", { name: "Advanced econometrician", exact: true }).waitFor();
  assert.match(await page.locator(".placement-score").getAttribute("aria-label"), /15 correct out of 15/);
  assert.equal(await page.locator(".placement-route li").count(), 3);
  assert.equal(await page.locator(".placement-explanation").count(), 15);
  assert.equal(await page.locator(".placement-topic-profile li").count(), 7);
  assert((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, "placement result overflows at 390px");

  const saved = await page.evaluate(() => window.IEWTStorage.placement());
  assert.deepEqual(Object.keys(saved).sort(), ["band", "completedDay", "recommendedTopic", "score", "total"]);
  assert.deepEqual({ band: saved.band, score: saved.score, total: saved.total, recommendedTopic: saved.recommendedTopic }, {
    band: "advanced", score: 15, total: 15, recommendedTopic: "gmm",
  });
  assert.deepEqual(await page.evaluate(() => window.IEWTStorage.progress()), {}, "placement changed course completion");
  assert.deepEqual(await page.evaluate(() => window.IEWTStorage.gamify()), { points: 0, streak: 0, last: null }, "placement changed points or streak");

  await page.getByRole("button", { name: "Retake diagnostic" }).click();
  await page.getByRole("heading", { name: "Question 1", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.IEWTStorage.placement())).score, 15, "starting a retake erased the last completed checkpoint");
  await page.reload({ waitUntil: "load" });
  await page.getByRole("heading", { name: /Advanced econometrician/ }).waitFor();
  await page.getByRole("button", { name: "Clear saved result" }).click();
  await page.getByRole("heading", { name: "A diagnostic, not an exam." }).waitFor();
  assert.equal(await page.evaluate(() => window.IEWTStorage.placement()), null, "explicit clear retained the placement result");

  assert.equal(requests.filter((path) => path === "/assets/data/placement-bank.json").length, 1, "placement bank was not fetched exactly once");
  assert(!requests.some((path) => path.includes("pyodide") || path.startsWith("/assets/data/courses/") ||
    path === "/assets/data/review-bank.json" || path.includes("curriculum")), "placement loaded a Python, course, or review payload");
  assert.deepEqual([...new Set(browserErrors)], [], "placement emitted browser errors");
  await context.close();

  // A reset in another tab can advance the server generation while a save or
  // clear is in flight. The result must be discarded and the UI must never
  // report the pre-reset summary as saved on this device.
  const conflictContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const conflictPage = await conflictContext.newPage();
  const conflictRequests = [];
  await conflictPage.route("**/api/bootstrap", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify({
      user: { id: "g_conflict", name: "Conflict Learner", email: "" },
      progress: {}, stats: { points: 0, streak: 0, last: null }, mastery: {}, placement: null, generation: 0,
    }),
  }));
  await conflictPage.route("**/api/placement", (route) => {
    const method = route.request().method();
    const headers = route.request().headers();
    conflictRequests.push({ method, generation: headers["x-iewt-generation"] });
    const generation = method === "PUT" ? 1 : 2;
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store", "X-IEWT-Generation": String(generation) },
      body: JSON.stringify({ error: { code: "reset_required" }, generation }),
    });
  });
  await conflictPage.goto(origin + "/lab/placement/", { waitUntil: "load" });
  await conflictPage.evaluate(() => window.Auth.whenReady());
  await conflictPage.locator(".placement-intro__actions .placement-primary").click();
  await conflictPage.getByRole("heading", { name: "Question 1", exact: true }).waitFor();
  await answerEveryQuestionCorrectly(conflictPage);
  await conflictPage.getByRole("heading", { name: "Advanced econometrician", exact: true }).waitFor();
  await conflictPage.locator("#placementStatus").getByText(/could not save the summary/i).waitFor();
  assert.equal(await conflictPage.evaluate(() => window.IEWTStorage.placement()), null,
    "generation-conflicted save resurrected the discarded placement result");
  assert.equal(await conflictPage.evaluate(() => window.IEWTStorage.syncGeneration()), 1,
    "generation-conflicted save did not adopt the reset generation");

  await conflictPage.evaluate(() => window.IEWTStorage.setPlacement({
    band: "advanced", score: 15, total: 15, completedDay: "2026-07-15", recommendedTopic: "gmm",
  }));
  await conflictPage.getByRole("button", { name: "Clear saved result" }).click();
  await conflictPage.getByRole("heading", { name: "A diagnostic, not an exam." }).waitFor();
  assert.equal(await conflictPage.evaluate(() => window.IEWTStorage.placement()), null,
    "generation-conflicted clear retained stale placement data");
  assert.equal(await conflictPage.evaluate(() => window.IEWTStorage.syncGeneration()), 2,
    "generation-conflicted clear did not adopt the reset generation");
  assert.deepEqual(conflictRequests, [
    { method: "PUT", generation: "0" },
    { method: "DELETE", generation: "1" },
  ], "placement generation-conflict request fencing drifted");
  await conflictContext.close();

  for (const viewport of [{ width: 320, height: 720 }, { width: 1440, height: 900 }]) {
    const layout = await browser.newContext({ viewport });
    const layoutPage = await layout.newPage();
    await layoutPage.goto(origin + "/lab/placement/", { waitUntil: "load" });
    await layoutPage.locator("#placementAppTitle").waitFor();
    assert((await layoutPage.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
      `placement intro overflows at ${viewport.width}px`);
    const appBox = await layoutPage.locator("#placementApp").boundingBox();
    const actionBox = await layoutPage.locator(".placement-intro__actions .placement-primary").boundingBox();
    assert(actionBox && actionBox.height >= 44, `placement action is not touch-safe at ${viewport.width}px`);
    if (viewport.width === 1440) {
      assert(appBox && appBox.y + appBox.height <= viewport.height,
        `desktop diagnostic command center falls below the first viewport at ${Math.round((appBox?.y || 0) + (appBox?.height || 0))}px`);
    }
    await layoutPage.locator(".placement-intro__actions .placement-primary").click();
    await layoutPage.getByRole("heading", { name: "Question 1", exact: true }).waitFor();
    assert((await layoutPage.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
      `placement question overflows at ${viewport.width}px`);
    await layout.close();
  }

  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const noJsPage = await noJs.newPage();
  await noJsPage.goto(origin + "/lab/placement/", { waitUntil: "load" });
  assert.equal(await noJsPage.locator(".placement-method-grid a").count(), 7, "no-JS method guide disappeared");
  assert.match(await noJsPage.locator(".placement-noscript").textContent(), /JavaScript is required/);
  assert(await noJsPage.locator("#placementStartFallback").isDisabled(), "no-JS fallback exposes an inert enabled start button");
  assert((await noJsPage.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, "no-JS placement fallback overflows at 390px");
  await noJs.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log("Placement contract OK: 15 balanced questions, deterministic routes, five-field persistence, and mobile/no-JS runtime verified.");
