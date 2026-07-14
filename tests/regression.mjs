/* End-to-end browser regression suite against the real local Worker runtime. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startWorker } from "./worker-server.mjs";

const server = await startWorker();
const BASE = server.baseURL;
let browser;
const TOPICS = { ols: 20, iv2sls: 31, did: 29, var: 30, panel: 30, logit: 32, gmm: 33 };
const SLUGS = {
  ols: "ordinary-least-squares",
  iv2sls: "instrumental-variables-2sls",
  did: "difference-in-differences",
  var: "vector-autoregression",
  panel: "panel-fixed-random-effects",
  logit: "logit-probit",
  gmm: "generalized-method-of-moments",
};
const courseRoute = (topic) => `/lab/${SLUGS[topic]}/`;
const PAGES = ["/", "/lab/", "/lab/placement/", "/lab/review/", courseRoute("ols"), "/articles/"];
const stageRoute = (topic, index, nonce = index) => `${courseRoute(topic)}?test=${nonce}#s${index}`;

function watch(page, ignored = () => false) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !ignored(message.text())) errors.push("console: " + message.text());
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "unknown";
    const navigationAbortedAuthProbe = reason === "net::ERR_ABORTED" &&
      ["/api/bootstrap", "/api/me"].includes(new URL(request.url()).pathname);
    const detail = `request failed: ${request.url()} (${reason})`;
    if (!navigationAbortedAuthProbe && !ignored(detail)) errors.push(detail);
  });
  return () => assert.deepEqual([...new Set(errors)], [], "unexpected browser errors");
}

const contrast = (a, b) => {
  const luminance = (color) => {
    const values = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

async function points(page) {
  return page.evaluate(() => window.Gamify.get().points);
}

async function waitForAcademy(page) {
  await page.waitForFunction(() => window.Auth && window.Auth.status() !== "checking" &&
    document.querySelector("#academyDashboard")?.getAttribute("aria-busy") === "false");
}

async function waitForCourse(page, position) {
  await page.waitForFunction((expected) => {
    const current = document.querySelector("#cPos")?.textContent.trim();
    return !!current && (!expected || current === expected);
  }, position || null);
}

async function mockSignedInAPI(page, { deleteStatus = 200, deleteGate = null } = {}) {
  const calls = [];
  let generation = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({
      path: url.pathname,
      method,
      owner: request.headers()["x-iewt-owner"] || null,
      generation: request.headers()["x-iewt-generation"] || null,
    });
    const reply = (body, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (url.pathname === "/api/bootstrap") return reply({
      user: { id: "g_browser", name: "Browser Learner", email: "" },
      progress: { ols: { done: [0, 1] } },
      stats: { points: 15, streak: 2, last: "2026-07-13" },
      mastery: {},
      placement: null,
      generation,
    });
    if (url.pathname === "/api/me") return reply({ user: { id: "g_browser", name: "Browser Learner", email: "" } });
    if (url.pathname === "/api/progress" && method === "GET") return reply({ progress: { ols: { done: [0, 1] } }, generation });
    if (url.pathname === "/api/stats" && method === "GET") return reply({ stats: { points: 15, streak: 2, last: "2026-07-13" }, generation });
    if (url.pathname === "/api/mastery" && method === "GET") return reply({ mastery: {}, generation });
    if (url.pathname === "/api/progress" && method === "DELETE") {
      if (deleteGate) await deleteGate;
      if (deleteStatus === 200) generation++;
      return deleteStatus === 200
        ? reply({ ok: true, progress: {}, stats: { points: 0, streak: 0, last: null }, mastery: {}, placement: null, generation })
        : reply({ error: { code: "temporary" } }, deleteStatus);
    }
    if (url.pathname === "/api/progress" && method === "PUT") return reply({ ok: true, generation });
    if (url.pathname === "/api/stats" && method === "PUT") return reply({ stats: { points: 15, streak: 2, last: "2026-07-13" }, generation });
    return reply({ error: { code: "not_found" } }, 404);
  });
  return calls;
}

async function solve(route, answer, expectedPoints, repeat) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const clean = watch(page);
  await page.goto(BASE + route, { waitUntil: "load" });
  await waitForCourse(page);
  await answer(page);
  await page.click(".quiz__check");
  await page.waitForSelector(".quiz__feedback.ok");
  assert.equal(await points(page), expectedPoints, `${route}: wrong award`);
  await page.click(".quiz__check");
  assert.equal(await points(page), expectedPoints, `${route}: double-submit awarded twice`);
  if (repeat) {
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.reload({ waitUntil: "load" });
    await waitForCourse(page);
    await answer(page);
    await page.click(".quiz__check");
    await page.waitForSelector(".quiz__feedback.ok");
    assert.equal(await points(page), expectedPoints, `${route}: completed stage awarded after reload`);
  }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  clean();
  await context.close();
}

try {
  browser = await chromium.launch();
  // Layout and console integrity at all supported viewports.
  for (const [width, height, mobile] of [[320, 720, true], [390, 844, true], [768, 1024, true], [1440, 900, false], [2048, 1152, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await context.newPage();
    const clean = watch(page);
    for (const route of PAGES) {
      await page.goto(BASE + route, { waitUntil: "load" });
      if (route === courseRoute("ols")) await waitForCourse(page, "1 / 20");
      if (route === "/lab/") await waitForAcademy(page);
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `[${width}px] horizontal overflow on ${route}: ${overflow}px`);
      if (route === "/lab/" && [320, 390, 1440, 2048].includes(width)) {
        const cockpit = await page.locator(".academy-cockpit").boundingBox();
        const hero = await page.locator(".lab-hero").boundingBox();
        const heroAction = await page.locator("#heroPrimaryCta").boundingBox();
        const diagnostic = await page.locator(".lab-hero__diagnostic").boundingBox();
        const resumeCard = await page.locator(".dashboard-resume").boundingBox();
        const resumeAction = await page.locator(".dashboard-resume .btn").boundingBox();
        assert(cockpit && hero && hero.y >= cockpit.y && hero.y + hero.height <= cockpit.y + cockpit.height,
          `[${width}px] academy identity escaped the cockpit`);
        assert(heroAction && heroAction.height >= 44, `[${width}px] hero action is not a 44px touch target`);
        assert(diagnostic && diagnostic.height >= 44, `[${width}px] placement diagnostic is not a 44px touch target`);
        assert(resumeAction && resumeAction.height >= 44, `[${width}px] resume action is not a 44px touch target`);
        if (width !== 320) {
          assert(resumeCard && resumeCard.y + resumeCard.height <= height,
            `[${width}px] personalized next-action card falls below the fold at ${Math.round((resumeCard?.y || 0) + (resumeCard?.height || 0))}px`);
        }
        if (width >= 1440) {
          const account = await page.locator("#account").boundingBox();
          const reset = await page.locator("#resetProgressBtn").boundingBox();
          const metrics = await page.locator(".dashboard-metrics").boundingBox();
          const firstCourse = await page.locator("#labGrid .model-card").first().boundingBox();
          assert(cockpit.height <= 620, `[desktop] academy cockpit is ${Math.round(cockpit.height)}px tall; expected at most 620px`);
          assert(account && account.y + account.height <= height, "[desktop] account and sync state are below the fold");
          assert(reset && reset.height >= 44 && reset.y + reset.height <= height, "[desktop] reset control is not fully visible and touch-safe");
          assert(metrics && metrics.y + metrics.height <= height, "[desktop] core progress metrics are below the fold");
          const requiredIntersection = width === 2048 ? 96 : 40;
          assert(firstCourse && firstCourse.y <= height - requiredIntersection,
            `[desktop] course discovery begins too late at ${Math.round(firstCourse?.y || 0)}px`);
          if (width === 2048) assert(cockpit.width >= 1320, `[wide desktop] cockpit underuses the viewport at ${Math.round(cockpit.width)}px`);
        }
      }
    }
    clean();
    await context.close();

  }

  // The initial HTML remains useful without JavaScript: the primary action is
  // a canonical course link and the crawlable course catalogue stays present.
  {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    assert.equal(new URL(await page.locator("#heroPrimaryCta").getAttribute("href"), BASE).pathname, courseRoute("ols"));
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Start with OLS/);
    assert.equal(new URL(await page.locator(".lab-hero__diagnostic").getAttribute("href"), BASE).pathname, "/lab/placement/");
    assert.equal(await page.locator("#labGrid .model-card").count(), 7, "no-JS course catalogue disappeared");
    await context.close();
  }

  // The faintest text token remains WCAG-AA on the base surface.
  {
    const page = await browser.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    const faint = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink-faint").trim());
    assert(contrast(faint, "#0a0a08") >= 4.5, `--ink-faint contrast is ${contrast(faint, "#0a0a08").toFixed(2)}`);
    await page.close();
  }

  // The academy dashboard, paths, and course discovery controls reflect real learner state.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem("iewt:progress", JSON.stringify({ ols: { done: [0, 1] } }));
      localStorage.setItem("iewt:gamify", JSON.stringify({ points: 15, streak: 1, last: "2026-07-13" }));
    });
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await waitForAcademy(page);

    assert.equal(await page.locator("#learningPaths .path-card").count(), 4, "learning paths did not render");
    assert.equal(await page.locator("#labGrid .model-card").count(), 7, "course catalogue did not render");
    assert.match(await page.locator(".dashboard-resume").textContent(), /2 of 20 lessons complete/);
    assert((await page.locator(".dashboard-resume a").getAttribute("href")).endsWith("#s2"), "resume link did not target the first unfinished lesson");
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Continue OLS · lesson 3/);
    assert((await page.locator("#heroPrimaryCta").getAttribute("href")).endsWith("#s2"), "hero action did not personalize to the next lesson");
    assert.equal(await page.locator("#dashboardFocus li").count(), 3, "focus plan did not render three steps");
    assert.deepEqual(await page.locator("#dashboardFocus li a").evaluateAll((links) => links.map((link) => link.hash)), ["#s2", "#s3", "#s4"]);
    assert.match(await page.locator("#dailyReviewCount").textContent(), /Build your review queue/);
    assert.equal(new URL(await page.locator("#dailyReviewCta").getAttribute("href"), BASE).pathname, "/lab/review/");
    assert.equal(await page.locator("#academyDashboard [role=progressbar]").count(), 2);
    assert.equal(await page.locator("#academyDashboard [role=progressbar]").first().getAttribute("aria-valuenow"), "10");
    assert(await page.evaluate(() => {
      const dashboard = document.querySelector("#academyDashboard");
      const account = document.querySelector("#account");
      const library = document.querySelector("#courseLibrary");
      const paths = document.querySelector("#learningPaths").closest("section");
      return !!(dashboard.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(library.compareDocumentPosition(paths) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), "learning-first DOM order drifted");

    await page.fill("#courseSearch", "binary outcomes");
    await page.waitForFunction(() => document.querySelector("#courseResults")?.textContent === "1 course");
    assert.equal((await page.locator("#labGrid .model-card h3").textContent()).trim(), "Logit & Probit (Binary Outcomes)");

    await page.fill("#courseSearch", "");
    await page.selectOption("#levelFilter", "Advanced");
    await page.waitForFunction(() => document.querySelector("#courseResults")?.textContent === "3 courses");
    assert.equal(await page.locator('#labGrid .model-card [class="model-card__badge"]', { hasText: "Advanced" }).count(), 3);

    await page.selectOption("#levelFilter", "all");
    await page.selectOption("#statusFilter", "in-progress");
    await page.waitForFunction(() => document.querySelector("#courseResults")?.textContent === "1 course");
    assert.equal(await page.locator('#labGrid .model-card[data-status="in-progress"] h3').textContent(), "Ordinary Least Squares");

    await page.fill("#courseSearch", "no-such-econometrics-method");
    await page.waitForFunction(() => document.querySelector("#courseResults")?.textContent === "0 courses");
    assert(await page.locator("#courseEmptyState").isVisible(), "empty search result was not announced visibly");
    const queuedItem = await page.evaluate(() => {
      const item = window.REVIEW_ITEMS[0];
      const snapshot = window.IEWTStorage.progress();
      const done = new Set((snapshot[item.courseId] || {}).done || []);
      done.add(item.stageIndex);
      snapshot[item.courseId] = { done: [...done].sort((a, b) => a - b) };
      window.IEWTStorage.setProgress(snapshot);
      document.dispatchEvent(new Event("iewt:synced"));
      return item.id;
    });
    assert(queuedItem, "review catalogue did not expose a deterministic first item");
    await page.waitForFunction(() => document.querySelector("#dailyReviewCta")?.dataset.due === "1");
    assert.equal((await page.locator("#dailyReviewCount").textContent()).trim(), "1 review due now");
    clean();
    await context.close();
  }

  // Daily Mastery Review grades every supported assessment type without
  // loading Pyodide, persists local mastery, and never changes course points.
  {
    const reviewItems = [
      {
        id: "ols:review-test-01", courseId: "ols", courseTitle: "Ordinary Least Squares",
        courseSlug: "ordinary-least-squares", stageIndex: 0, type: "quiz",
        title: "Coefficient interpretation", prompt: "Which answer is correct?",
        choices: ["The first answer", "The second answer"], answer: 1,
        hint: "Look at the second answer.", explain: "A coefficient is interpreted holding included regressors fixed.",
      },
      {
        id: "ols:review-test-02", courseId: "ols", courseTitle: "Ordinary Least Squares",
        courseSlug: "ordinary-least-squares", stageIndex: 1, type: "truefalse",
        title: "Exogeneity", prompt: "Zero conditional mean is an exogeneity condition.", answer: true,
        explain: "It restricts the conditional expectation of the disturbance.",
      },
      {
        id: "ols:review-test-03", courseId: "ols", courseTitle: "Ordinary Least Squares",
        courseSlug: "ordinary-least-squares", stageIndex: 2, type: "multi",
        title: "Select the assumptions", prompt: "Select both requested conditions.",
        choices: ["Linearity", "Perfect collinearity", "Finite variance"], answers: [0, 2],
        explain: "Linearity and finite variance are compatible with the classical setup.",
      },
      {
        id: "ols:review-test-04", courseId: "ols", courseTitle: "Ordinary Least Squares",
        courseSlug: "ordinary-least-squares", stageIndex: 3, type: "numeric",
        title: "Compute the estimate", prompt: "Enter the value.", answer: 2.5, tol: 0.01,
        explain: "The requested estimate is 2.5.",
      },
      {
        id: "ols:review-test-05", courseId: "ols", courseTitle: "Ordinary Least Squares",
        courseSlug: "ordinary-least-squares", stageIndex: 4, type: "fillblank",
        title: "Complete the statement", prompt: "A mean-reverting series is often called ___.",
        accept: ["stationary"], explain: "Stationarity formalizes stable distributional behavior over time.",
      },
    ];
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await context.addInitScript(() => {
      localStorage.setItem("iewt:progress", JSON.stringify({ ols: { done: [0, 1, 2, 3, 4] } }));
      localStorage.setItem("iewt:gamify", JSON.stringify({ points: 80, streak: 0, last: null }));
    });
    const page = await context.newPage();
    const requested = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.route("**/assets/data/review-bank.json*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, items: reviewItems }),
    }));
    const clean = watch(page);
    await page.goto(BASE + "/lab/review/", { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#reviewQuestionTitle")?.textContent === "Coefficient interpretation");
    const pointsBeforeReview = await points(page);
    assert.equal(await page.locator("#reviewApp").getAttribute("aria-busy"), "false");
    assert.equal(await page.locator("#reviewProgress").getAttribute("max"), "5");
    assert(!requested.some((pathname) => pathname.includes("pyodide") || pathname.startsWith("/assets/data/courses/")), "daily review loaded the Python runtime or a course payload");

    await page.click("button:has-text('Show hint')");
    await page.check("input[name='review-answer'][value='1']");
    await page.click("button:has-text('Check answer')");
    await page.waitForSelector(".review-feedback.is-correct");
    await page.click("button:has-text('Next question')");

    await page.check("input[name='review-answer'][value='true']");
    await page.click("button:has-text('Check answer')");
    await page.waitForSelector(".review-feedback.is-correct");
    await page.click("button:has-text('Next question')");

    await page.check("input[name='review-answer'][value='0']");
    await page.check("input[name='review-answer'][value='2']");
    await page.click("button:has-text('Check answer')");
    await page.waitForSelector(".review-feedback.is-correct");
    await page.click("button:has-text('Next question')");

    await page.fill("input[name='review-answer']", "2.5");
    await page.click("button:has-text('Check answer')");
    await page.waitForSelector(".review-feedback.is-correct");
    await page.click("button:has-text('Next question')");

    await page.fill("input[name='review-answer']", "stationary");
    await page.click("button:has-text('Check answer')");
    await page.waitForSelector(".review-feedback.is-correct");
    await page.click("button:has-text('See session summary')");
    await page.waitForSelector("#reviewSummaryTitle");

    const result = await page.evaluate(() => ({
      masteryCount: Object.keys(window.IEWTStorage.mastery()).length,
      outboxCount: window.IEWTStorage.masteryOutbox().length,
      gamify: window.Gamify.get(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    assert.equal(result.masteryCount, 5);
    assert.equal(result.outboxCount, 5, "signed-out review attempts must remain queued for a later account sync");
    assert.equal(result.gamify.points, pointsBeforeReview, "daily review must not award course points");
    assert.equal(result.gamify.streak, 1, "a complete five-question session must count as daily activity");
    assert(result.overflow <= 1, `daily review overflowed the 390px viewport by ${result.overflow}px`);
    assert.match(await page.locator(".review-summary__stats").textContent(), /5\s*Concepts reviewed[\s\S]*4\s*First-try recall[\s\S]*1\s*Hints opened/);
    clean();
    await context.close();
  }

  // Anonymous reset clears learning data, preserves layout preference, and returns focus to the dashboard.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await waitForAcademy(page);
    await page.evaluate(() => {
      window.IEWTStorage.setProgress({ ols: { done: [0, 1, 2] } });
      window.IEWTStorage.setGamify({ points: 25, streak: 2, last: "2026-07-13" });
      window.IEWTStorage.setGuideWidth(61.4);
      document.dispatchEvent(new Event("iewt:synced"));
    });
    await page.waitForFunction(() => document.querySelector(".dashboard-resume")?.textContent.includes("3 of 20"));
    await page.click("#resetProgressBtn");
    assert(await page.locator("#resetDialog").evaluate((dialog) => dialog.open), "reset confirmation did not open");
    assert.match(await page.locator("#resetScope").textContent(), /Only progress on this device/);
    assert(await page.locator(".reset-cancel").evaluate((button) => button === document.activeElement), "safe cancel action did not receive initial focus");
    await page.click("#resetConfirm");
    await page.waitForFunction(() => !document.querySelector("#resetDialog").open);
    const state = await page.evaluate(() => ({
      progress: window.IEWTStorage.progress(),
      gamify: window.Gamify.get(),
      guideWidth: window.IEWTStorage.guideWidth(),
      owner: window.IEWTStorage.owner(),
      dashboardFocused: document.activeElement === document.querySelector("#dashboardTitle"),
    }));
    assert.deepEqual(state, {
      progress: {},
      gamify: { points: 0, streak: 0, last: null },
      guideWidth: 61.4,
      owner: null,
      dashboardFocused: true,
    });
    assert.match(await page.locator(".dashboard-resume").textContent(), /0 of 20 lessons complete/);
    clean();
    await context.close();
  }

  // A completed placement checkpoint changes the no-progress starting route,
  // survives reload, and is included in the same anonymous full-reset closure.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem("iewt:placement:v2:anonymous", JSON.stringify({
        version: 2,
        owner: "anonymous",
        value: {
          band: "applied", score: 9, total: 15,
          completedDay: "2026-07-15", recommendedTopic: "did",
        },
      }));
    });
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await waitForAcademy(page);
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Start DiD · lesson 1/);
    assert.equal(new URL(await page.locator("#heroPrimaryCta").getAttribute("href"), BASE).pathname, courseRoute("did"));
    assert.match(await page.locator(".dashboard-resume h3").textContent(), /Difference-in-Differences/);
    assert.match(await page.locator("#dashboardSummary").textContent(), /applied diagnostic result recommends DiD first/i);
    assert.equal((await page.locator(".lab-hero__diagnostic").textContent()).trim(), "Retake diagnostic");
    assert.deepEqual(await page.evaluate(() => window.IEWTStorage.progress()), {}, "placement seeded course completion");

    await page.reload({ waitUntil: "load" });
    await waitForAcademy(page);
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Start DiD · lesson 1/, "placement route did not survive reload");
    await page.click("#resetProgressBtn");
    assert.match(await page.locator("#resetDescription").textContent(), /placement result/);
    await page.click("#resetConfirm");
    await page.waitForFunction(() => window.IEWTStorage.placement() === null && !document.querySelector("#resetDialog").open);
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Start OLS · lesson 1/);
    assert.equal((await page.locator(".lab-hero__diagnostic").textContent()).trim(), "Find your level");
    clean();
    await context.close();
  }

  // Signed-in reset is server-first and carries the verified owner binding.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const calls = await mockSignedInAPI(page);
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Auth?.status() === "ready" && window.Auth?.isSignedIn() && window.IEWTStorage.progress().ols?.done?.length === 2);
    assert.deepEqual(
      calls.filter((call) => call.method === "GET").map((call) => call.path),
      ["/api/bootstrap"],
      "signed-in hydration must use one read request without the legacy waterfall",
    );
    await page.click("#resetProgressBtn");
    assert.match(await page.locator("#resetScope").textContent(), /synced account record and this device/);
    await page.click("#resetConfirm");
    await page.waitForFunction(() => !document.querySelector("#resetDialog").open && Object.keys(window.IEWTStorage.progress()).length === 0);
    const deletes = calls.filter((call) => call.path === "/api/progress" && call.method === "DELETE");
    assert.deepEqual(deletes, [{ path: "/api/progress", method: "DELETE", owner: "g_browser", generation: null }]);
    assert.equal(await page.evaluate(() => window.IEWTStorage.syncGeneration()), 1);
    assert.deepEqual(await page.evaluate(() => window.Gamify.get()), { points: 0, streak: 0, last: null });
    clean();
    await context.close();
  }

  // A failed signed-in deletion leaves both owner-scoped progress and points intact.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    let releaseDelete;
    const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
    const calls = await mockSignedInAPI(page, { deleteStatus: 503, deleteGate });
    const clean = watch(page, (value) => value.includes("503 (Service Unavailable)"));
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Auth?.status() === "ready" && window.IEWTStorage.progress().ols?.done?.length === 2);
    await page.click("#resetProgressBtn");
    await page.click("#resetConfirm");
    await page.waitForFunction(() => document.querySelector("#resetDialog")?.dataset.resetBusy === "true");
    assert.equal(await page.locator("#resetDialog").getAttribute("aria-busy"), "true");
    await page.keyboard.press("Escape");
    assert(await page.locator("#resetDialog").evaluate((dialog) => dialog.open), "Escape dismissed a reset while DELETE was pending");
    releaseDelete();
    await page.waitForFunction(() => document.querySelector("#resetStatus")?.classList.contains("reset-dialog__status--error"));
    assert(await page.locator("#resetDialog").evaluate((dialog) => dialog.open), "failed reset closed its confirmation dialog");
    assert.match(await page.locator("#resetStatus").textContent(), /Nothing was removed from this device/);
    assert.deepEqual(await page.evaluate(() => ({ progress: window.IEWTStorage.progress(), gamify: window.Gamify.get() })), {
      progress: { ols: { done: [0, 1] } },
      gamify: { points: 15, streak: 2, last: "2026-07-13" },
    });
    assert(await page.locator("#resetConfirm").isEnabled());
    assert(await page.locator(".reset-cancel").evaluate((button) => button === document.activeElement));
    assert.equal(await page.locator("#resetDialog").getAttribute("aria-busy"), "false");
    assert.equal(calls.filter((call) => call.path === "/api/progress" && call.method === "DELETE" && call.owner === "g_browser").length, 1);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#resetDialog").open);
    clean();
    await context.close();
  }

  // Reset completion is bound to the account captured at confirmation time.
  // Switching owners mid-request preserves the new scope, and a later sign-in
  // cannot reupload state from before the server's reset generation.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const calls = [];
    let generation = 0;
    let serverProgress = { ols: { done: [0, 1] } };
    let serverStats = { points: 15, streak: 2, last: "2026-07-13" };
    let releaseDelete, markDeleteStarted;
    const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
    const deleteStarted = new Promise((resolve) => { markDeleteStarted = resolve; });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      calls.push({ path, method, generation: request.headers()["x-iewt-generation"] || null });
      const reply = (body, status = 200) => route.fulfill({
        status, contentType: "application/json", body: JSON.stringify(body),
      });
      if (path === "/api/bootstrap") return reply({
        user: { id: "g_switch", name: "Switching Learner", email: "" },
        progress: serverProgress,
        stats: serverStats,
        mastery: {},
        placement: null,
        generation,
      });
      if (path === "/api/me") return reply({ user: { id: "g_switch", name: "Switching Learner", email: "" } });
      if (path === "/api/progress" && method === "GET") return reply({ progress: serverProgress, generation });
      if (path === "/api/stats" && method === "GET") return reply({ stats: serverStats, generation });
      if (path === "/api/mastery" && method === "GET") return reply({ mastery: {}, generation });
      if (path === "/api/progress" && method === "DELETE") {
        markDeleteStarted();
        await deleteGate;
        generation = 1;
        serverProgress = {};
        serverStats = { points: 0, streak: 0, last: null };
        return reply({ ok: true, progress: serverProgress, stats: serverStats, mastery: {}, placement: null, generation });
      }
      if (method === "PUT") return reply({ ok: true, stats: serverStats, generation });
      return reply({ error: { code: "not_found" } }, 404);
    });
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Auth?.status() === "ready" && window.IEWTStorage.progress().ols?.done?.length === 2);
    await page.click("#resetProgressBtn");
    await page.click("#resetConfirm");
    await deleteStarted;
    await page.evaluate(() => {
      const marker = window.IEWTStorage.KEYS.activeOwner;
      localStorage.setItem(marker, "user:g_other");
      window.dispatchEvent(new StorageEvent("storage", { key: marker, newValue: "user:g_other" }));
      window.IEWTStorage.setProgress({ ols: { done: [3] } });
      window.IEWTStorage.setGamify({ points: 15, streak: 1, last: "2026-07-14" });
    });
    await page.waitForFunction(() => window.Auth?.status() === "account-changed" && window.IEWTStorage.owner() === null);
    releaseDelete();
    await page.waitForFunction(() => !document.querySelector("#resetDialog").open);
    const switched = await page.evaluate(() => {
      const account = "user:g_switch";
      const suffix = encodeURIComponent(account);
      return {
        activeProgress: window.IEWTStorage.progress(),
        activeGamify: window.IEWTStorage.gamify(),
        capturedProgress: JSON.parse(localStorage.getItem(`iewt:progress:v2:${suffix}`)).value,
        capturedGamify: JSON.parse(localStorage.getItem(`iewt:gamify:v2:${suffix}`)).value,
        capturedGeneration: JSON.parse(localStorage.getItem(`iewt:sync:v2:${suffix}`)).generation,
        status: window.Auth.status(),
      };
    });
    assert.deepEqual(switched, {
      activeProgress: { ols: { done: [3] } },
      activeGamify: { points: 15, streak: 1, last: "2026-07-14" },
      capturedProgress: {},
      capturedGamify: { points: 0, streak: 0, last: null },
      capturedGeneration: 1,
      status: "account-changed",
    });

    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.Auth?.status() === "ready" && window.Auth?.user()?.id === "g_switch" &&
      window.IEWTStorage.syncGeneration() === 1 && Object.keys(window.IEWTStorage.progress()).length === 0);
    assert.deepEqual(calls.filter((call) => call.method === "PUT"), [], "pre-reset state was reuploaded after returning sign-in");
    clean();
    await context.close();
  }

  // Signed-in sign-out uses a same-owner POST, then reloads into an anonymous device scope.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    let signedIn = true;
    const logoutCalls = [];
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const signedInUser = signedIn ? { id: "g_signout", name: "Sign-out Learner", email: "" } : null;
      const body = path === "/api/bootstrap" ? (signedInUser ? {
        user: signedInUser,
        progress: {},
        stats: { points: 0, streak: 0, last: null },
        mastery: {},
        placement: null,
        generation: 0,
      } : { user: null })
        : path === "/api/me" ? { user: signedInUser }
        : path === "/api/progress" ? { progress: {}, generation: 0 }
          : path === "/api/stats" ? { stats: { points: 0, streak: 0, last: null }, generation: 0 }
            : path === "/api/mastery" ? { mastery: {}, generation: 0 }
              : path === "/api/placement" ? { placement: null, generation: 0 }
                : { error: { code: "not_found" } };
      return route.fulfill({ status: path.startsWith("/api/") ? 200 : 404, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.route("**/auth/logout", (route) => {
      const request = route.request();
      logoutCalls.push({ method: request.method(), owner: request.headers()["x-iewt-owner"] || null });
      signedIn = false;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Auth?.status() === "ready" && window.Auth?.user()?.id === "g_signout");
    const navigated = page.waitForNavigation({ waitUntil: "load" });
    await page.click("#authBtn");
    await navigated;
    await page.waitForFunction(() => window.Auth?.status() === "ready" && !window.Auth?.isSignedIn() && window.IEWTStorage.owner() === null);
    assert.deepEqual(logoutCalls, [{ method: "POST", owner: "g_signout" }]);
    assert.equal(new URL(page.url()).pathname, "/lab/");
    clean();
    await context.close();
  }

  // The course shell exposes a real loading state and downloads only the selected topic payload.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requested = [];
    let releasePayload;
    const payloadGate = new Promise((resolve) => { releasePayload = resolve; });
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.route("**/assets/data/courses/ols.json*", async (route) => {
      await payloadGate;
      await route.continue();
    });
    const clean = watch(page);
    await page.goto(BASE + courseRoute("ols"), { waitUntil: "domcontentloaded" });
    await page.locator(".course-loading").waitFor();
    assert.equal(await page.locator("#course").getAttribute("aria-busy"), "true");
    releasePayload();
    await page.waitForFunction(() => document.querySelector("#cPos")?.textContent.trim() === "1 / 20");
    assert.equal(await page.locator("#course").getAttribute("aria-busy"), "false");
    assert.equal(requested.filter((path) => path === "/assets/data/courses/ols.json").length, 1, "selected course payload was not fetched exactly once");
    for (const script of ["/assets/js/curriculum.js", "/assets/js/curriculum-data.js", "/assets/js/curriculum-questions.js"]) {
      assert(!requested.includes(script), `course downloaded authoring bundle ${script}`);
    }
    assert(!requested.some((path) => /^\/assets\/data\/courses\/(?!ols\.json$)/.test(path)), "course downloaded another topic payload");
    clean();
    await context.close();
  }

  // Read lessons require an explicit completion action; stage arrows require Alt.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + stageRoute("ols", 0, "read-completion"), { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#cPos")?.textContent.trim() === "1 / 20");
    assert.deepEqual(await page.evaluate(() => window.IEWTStorage.progress()), {}, "displaying a reading auto-completed it");
    assert.match((await page.locator("#cNext").textContent()).trim(), /^Complete & next/);

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(80);
    assert.equal((await page.locator("#cPos").textContent()).trim(), "1 / 20", "bare ArrowRight navigated stages");
    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForFunction(() => document.querySelector("#cPos")?.textContent.trim() === "2 / 20");
    assert.deepEqual(await page.evaluate(() => window.IEWTStorage.progress()), {}, "keyboard navigation completed a reading");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForFunction(() => document.querySelector("#cPos")?.textContent.trim() === "1 / 20");

    await page.click("#cNext");
    await page.waitForFunction(() => document.querySelector("#cPos")?.textContent.trim() === "2 / 20");
    assert.deepEqual(await page.evaluate(() => window.IEWTStorage.progress()), { ols: { done: [0] } });
    assert.deepEqual(await page.locator("#cProgress").evaluate((node) => ({
      role: node.getAttribute("role"),
      min: node.getAttribute("aria-valuemin"),
      max: node.getAttribute("aria-valuemax"),
      now: node.getAttribute("aria-valuenow"),
      label: node.getAttribute("aria-label"),
    })), { role: "progressbar", min: "0", max: "100", now: "5", label: "Course completion" });
    clean();
    await context.close();
  }

  // Choice questions expose their answer set through fieldset/legend semantics.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + stageRoute("ols", 4, "quiz-semantics"), { waitUntil: "load" });
    await page.locator(".quiz__fieldset").waitFor();
    assert.equal(await page.locator(".quiz__fieldset").count(), 1);
    assert((await page.locator(".quiz__fieldset legend").textContent()).trim().length > 0, "quiz answer group has no legend");
    assert.equal(await page.locator('.quiz__fieldset input[type="radio"]').count(), 2);
    assert.equal(await page.locator('.quiz__fieldset input[type="radio"]').first().getAttribute("name"), await page.locator('.quiz__fieldset input[type="radio"]').last().getAttribute("name"));
    clean();
    await context.close();
  }

  // Pill tabs are equal and the indicator only translates.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => {
      const widths = [...document.querySelectorAll(".pill a")].map((link) => Math.round(link.getBoundingClientRect().width));
      const indicator = document.querySelector(".pill__ind").getBoundingClientRect();
      const current = document.querySelector(".pill a.is-current").getBoundingClientRect();
      return {
        equal: new Set(widths).size === 1,
        aligned: Math.abs(indicator.left - current.left) < 2 && Math.abs(indicator.width - current.width) < 2,
        transition: getComputedStyle(document.querySelector(".pill__ind")).transitionProperty,
      };
    });
    assert(metrics.equal && metrics.aligned && metrics.transition === "transform", `pill metrics: ${JSON.stringify(metrics)}`);
    await context.close();
  }

  // Coarse-pointer inputs avoid iOS zoom and primary targets are at least 44×44.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(BASE + stageRoute("ols", 1, "touch-code"), { waitUntil: "load" });
    await waitForCourse(page, "2 / 20");
    const editor = await page.evaluate(() => {
      const input = getComputedStyle(document.querySelector(".cell__editor"));
      const overlay = getComputedStyle(document.querySelector(".cell__hl"));
      return { font: parseFloat(input.fontSize), match: input.fontSize === overlay.fontSize && input.lineHeight === overlay.lineHeight, wrap: input.whiteSpace };
    });
    assert(editor.font >= 16 && editor.match && editor.wrap === "pre-wrap", `mobile editor: ${JSON.stringify(editor)}`);

    for (const selector of ["#cPrev", "#cNext", ".course-nav__mod", ".cell__run", ".cell__reset"]) {
      const box = await page.locator(selector).first().boundingBox();
      assert(box && box.width >= 44 && box.height >= 44, `${selector} is ${box?.width}×${box?.height}`);
    }
    await page.goto(BASE + stageRoute("ols", 2, "touch-range"), { waitUntil: "load" });
    await waitForCourse(page, "3 / 20");
    const range = await page.locator(".control__range").first().boundingBox();
    assert(range && range.width >= 44 && range.height >= 44, `range input is ${range?.width}×${range?.height}`);
    await page.goto(BASE + stageRoute("ols", 4, "touch-choice"), { waitUntil: "load" });
    await waitForCourse(page, "5 / 20");
    const choice = await page.locator(".quiz__choice").first().boundingBox();
    assert(choice && choice.width >= 44 && choice.height >= 44, `quiz choice is ${choice?.width}×${choice?.height}`);
    await page.goto(BASE + stageRoute("ols", 13, "touch-numeric"), { waitUntil: "load" });
    await waitForCourse(page, "14 / 20");
    const numeric = await page.locator(".q-num").boundingBox();
    assert(numeric && numeric.width >= 44 && numeric.height >= 44, `numeric input is ${numeric?.width}×${numeric?.height}`);
    await page.goto(BASE + stageRoute("iv2sls", 20, "touch-blank"), { waitUntil: "load" });
    await waitForCourse(page, "21 / 31");
    const blank = await page.locator(".q-blank").boundingBox();
    assert(blank && blank.width >= 44 && blank.height >= 44, `blank input is ${blank?.width}×${blank?.height}`);
    await context.close();

    const wideTouch = await browser.newContext({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const widePage = await wideTouch.newPage();
    await widePage.goto(BASE + stageRoute("ols", 1, "touch-splitter"), { waitUntil: "load" });
    await waitForCourse(widePage, "2 / 20");
    const splitter = await widePage.locator(".stage__handle").boundingBox();
    assert(splitter && splitter.width >= 44 && splitter.height >= 44, `splitter is ${splitter?.width}×${splitter?.height}`);
    await wideTouch.close();
  }

  // Rapid navigation advances from the target index, not a stale rendered index.
  {
    const page = await browser.newPage();
    await page.goto(BASE + courseRoute("ols"), { waitUntil: "load" });
    await waitForCourse(page, "1 / 20");
    assert.equal((await page.locator("#cPos").textContent()).trim(), "1 / 20");
    assert.equal(await page.locator('.course-nav__mod[aria-current="step"]').count(), 1);
    await page.click("#cNext"); await page.click("#cNext"); await page.click("#cNext");
    await page.waitForFunction(() => document.querySelector("#cPos").textContent.trim() === "4 / 20");
    assert.equal(await page.locator('.course-nav__mod[aria-current="step"]').count(), 1);
    await page.locator(".course-nav__mod").nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll(".course-nav__mod")[1]?.getAttribute("aria-current") === "step");
    assert.equal(await page.locator('.course-nav__mod[aria-current="step"]').count(), 1);
    assert(await page.locator('.course-nav__mod[aria-current="step"]').evaluate((node) => node === document.querySelectorAll(".course-nav__mod")[1]));
    await page.close();
  }

  // Background account synchronization repaints progress without destroying unsaved work.
  {
    const page = await browser.newPage();
    await page.goto(BASE + stageRoute("ols", 13), { waitUntil: "load" });
    await waitForCourse(page, "14 / 20");
    await page.fill(".q-num", "36");
    const state = await page.evaluate(() => {
      const input = document.querySelector(".q-num");
      window.IEWTStorage.setProgress({ ols: { done: [0] } });
      document.dispatchEvent(new Event("iewt:synced"));
      return {
        sameInput: input === document.querySelector(".q-num"),
        answer: document.querySelector(".q-num").value,
        progress: document.querySelector("#cBar").style.width,
      };
    });
    assert.deepEqual(state, { sameInput: true, answer: "36", progress: "5%" });
    await page.close();
  }

  // Every rendered stage has a non-skipping heading outline.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const clean = watch(page);
    for (const [topic, count] of Object.entries(TOPICS)) {
      for (let index = 0; index < count; index++) {
        await page.goto(BASE + stageRoute(topic, index), { waitUntil: "load" });
        await waitForCourse(page, `${index + 1} / ${count}`);
        await page.evaluate(() => document.fonts && document.fonts.ready);
        const levels = await page.evaluate(() => [...document.querySelectorAll("h1,h2,h3,h4")].map((heading) => Number(heading.tagName[1])));
        assert(levels.length >= 2, `${topic}#s${index}: missing headings`);
        for (let i = 1; i < levels.length; i++) assert(levels[i] - levels[i - 1] <= 1, `${topic}#s${index}: heading skip ${levels.join("→")}`);
      }
    }
    clean();
    await context.close();
  }

  // Legacy splitter state migrates; keyboard controls persist without stage navigation.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => localStorage.setItem("iewt:splitW", "61.4"));
    const page = await context.newPage();
    await page.goto(BASE + stageRoute("ols", 1), { waitUntil: "load" });
    await waitForCourse(page, "2 / 20");
    const migrated = await page.evaluate(() => ({
      width: document.querySelector(".stage__split").style.getPropertyValue("--guideW"),
      current: localStorage.getItem("iewt:guideW"), legacy: localStorage.getItem("iewt:splitW"),
      role: document.querySelector(".stage__handle").getAttribute("role"),
    }));
    assert.deepEqual(migrated, { width: "61.4%", current: "61.4", legacy: null, role: "separator" });
    const position = (await page.locator("#cPos").textContent()).trim();
    await page.locator(".stage__handle").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(".stage__handle").getAttribute("aria-valuenow"), "64");
    await page.keyboard.press("End");
    assert.equal(await page.locator(".stage__handle").getAttribute("aria-valuenow"), "72");
    assert.equal((await page.locator("#cPos").textContent()).trim(), position);
    await page.reload({ waitUntil: "load" });
    await waitForCourse(page, "2 / 20");
    assert.equal(await page.locator(".stage__handle").getAttribute("aria-valuenow"), "72");
    await context.close();
  }

  // Blocked and malformed storage never prevent the course from rendering.
  {
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
      Storage.prototype.removeItem = () => { throw new DOMException("blocked", "SecurityError"); };
    });
    const page = await blocked.newPage();
    const clean = watch(page);
    await page.goto(BASE + stageRoute("ols", 1), { waitUntil: "load" });
    await waitForCourse(page, "2 / 20");
    assert.equal((await page.locator("#cPos").textContent()).trim(), "2 / 20");
    assert(await page.locator(".cell__editor").isVisible());
    clean();
    await blocked.close();

    const malformed = await browser.newContext();
    await malformed.addInitScript(() => {
      localStorage.setItem("iewt:progress", "5");
      localStorage.setItem("iewt:gamify", "5");
    });
    const malformedPage = await malformed.newPage();
    await malformedPage.goto(BASE + courseRoute("ols"), { waitUntil: "load" });
    await waitForCourse(malformedPage, "1 / 20");
    const repaired = await malformedPage.evaluate(() => ({ progress: JSON.parse(localStorage.getItem("iewt:progress")), gamify: JSON.parse(localStorage.getItem("iewt:gamify")) }));
    assert.equal(typeof repaired.progress, "object");
    assert.deepEqual(Object.keys(repaired.gamify).sort(), ["last", "points", "streak"]);
    await malformed.close();

    const quota = await browser.newContext();
    await quota.addInitScript(() => {
      localStorage.setItem("iewt:progress", JSON.stringify({ ols: { done: [] } }));
      localStorage.setItem("iewt:gamify", JSON.stringify({ points: 0, streak: 0, last: null }));
      Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    });
    const quotaPage = await quota.newPage();
    await quotaPage.goto(BASE + stageRoute("ols", 4), { waitUntil: "load" });
    await waitForCourse(quotaPage, "5 / 20");
    await quotaPage.check('input[value="false"]');
    await quotaPage.click(".quiz__check");
    const quotaState = await quotaPage.evaluate(() => ({
      done: window.IEWTStorage.progress().ols.done,
      points: window.Gamify.get().points,
      persisted: JSON.parse(localStorage.getItem("iewt:progress")).ols.done,
    }));
    assert.deepEqual(quotaState, { done: [4], points: 10, persisted: [] }, "write-only storage failure restored stale state");
    await quota.close();

    const legacyScore = await browser.newContext();
    await legacyScore.addInitScript(() => {
      localStorage.setItem("iewt:progress", JSON.stringify({ ols: { done: [13] } }));
      localStorage.setItem("iewt:gamify", JSON.stringify({ points: 5, streak: 0, last: null }));
    });
    const scorePage = await legacyScore.newPage();
    await scorePage.goto(BASE + "/lab/", { waitUntil: "load" });
    assert.equal(await points(scorePage), 20, "legacy under-count was not reconciled from progress");
    const correctedHigh = await scorePage.evaluate(() => {
      window.IEWTStorage.setGamify({ points: 9999, streak: 0, last: null });
      return window.Gamify.get().points;
    });
    assert.equal(correctedHigh, 20, "stale high local points were not reconciled from progress");
    await legacyScore.close();
  }

  // Boot progress is announced without downloading Pyodide during the test.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => { window.loadPyodide = () => new Promise(() => {}); });
    const page = await context.newPage();
    const clean = watch(page, (value) => value.includes("cdn.jsdelivr.net"));
    await page.goto(BASE + stageRoute("ols", 1), { waitUntil: "load" });
    await waitForCourse(page, "2 / 20");
    await page.click(".cell__run");
    const boot = page.locator("#labBoot.show");
    await boot.waitFor();
    assert.equal(await boot.getAttribute("role"), "status");
    assert((await boot.textContent()).trim().length > 0, "boot status text missing");
    clean();
    await context.close();
  }

  // When progress sync fails, verified remote points remain a temporary floor.
  {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      const reply = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { "Content-Type": "application/json" },
      });
      window.fetch = (input, init = {}) => {
        const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
        const method = init.method || "GET";
        if (path === "/api/bootstrap") return Promise.resolve(reply({ error: { code: "not_found" } }, 404));
        if (path === "/api/me") return Promise.resolve(reply({ user: { id: "g_partial", name: "Partial Sync", email: "" } }));
        if (path === "/api/progress") return Promise.resolve(reply({ error: { code: "temporary" } }, 500));
        if (path === "/api/stats" && method === "GET") return Promise.resolve(reply({ stats: { points: 100, streak: 2, last: "2026-07-12" }, generation: 0 }));
        if (path === "/api/stats" && method === "PUT") return Promise.resolve(reply({ ok: true, stats: { points: 100, streak: 2, last: "2026-07-12" }, generation: 0 }));
        if (path === "/api/mastery" && method === "GET") return Promise.resolve(reply({ mastery: {}, generation: 0 }));
        if (path === "/api/placement" && method === "GET") return Promise.resolve(reply({ placement: null, generation: 0 }));
        return nativeFetch(input, init);
      };
    });
    const page = await context.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Gamify.get().points === 100 && window.Gamify.get().streak === 2);
    assert.deepEqual(await page.evaluate(() => window.Gamify.get()), { points: 100, streak: 2, last: "2026-07-12" });
    const reconciled = await page.evaluate(() => {
      window.IEWTStorage.setProgress({ ols: { done: [13] } });
      window.Gamify.merge({ points: 20, streak: 2, last: "2026-07-12" }, { progressComplete: true });
      return window.Gamify.get();
    });
    assert.deepEqual(reconciled, { points: 20, streak: 2, last: "2026-07-12" }, "successful progress sync did not clear the temporary remote floor");
    await context.close();
  }

  // Authored rewards and deterministic grading for every question family.
  await solve(stageRoute("ols", 4), (page) => page.check('input[value="false"]'), 10, true);
  await solve(stageRoute("ols", 3), (page) => page.check('input[value="2"]'), 15, false);
  await solve(stageRoute("ols", 13), (page) => page.fill(".q-num", "36"), 20, false);
  await solve(stageRoute("ols", 19), async (page) => {
    for (const value of [0, 1, 2]) await page.check(`input[value="${value}"]`);
  }, 20, false);
  await solve(stageRoute("iv2sls", 20), (page) => page.fill(".q-blank", "  THE fitted values. "), 15, false);
  await solve(stageRoute("iv2sls", 29), (page) => page.fill(".q-num", "−3.6"), 20, false);

  {
    const page = await browser.newPage();
    await page.goto(BASE + stageRoute("ols", 13), { waitUntil: "load" });
    await waitForCourse(page, "14 / 20");
    await page.fill(".q-num", "36abc"); await page.click(".quiz__check");
    assert(await page.locator(".quiz__feedback.err").isVisible());
    assert.equal(await points(page), 0);
    await page.fill(".q-num", "36.5"); await page.click(".quiz__check");
    assert(await page.locator(".quiz__feedback.ok").isVisible());
    await page.close();
  }

  console.log("✓ browser: academy, reset, payload isolation, layouts, accessibility, navigation, storage, splitter, boot, grading, rewards");
} finally {
  if (browser) await browser.close();
  await server.stop();
}
