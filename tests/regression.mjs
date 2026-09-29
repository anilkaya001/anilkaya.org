import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startWorker } from "./worker-server.mjs";

const server = await startWorker();
const BASE = server.baseURL;
let browser;
const TOPICS = { ols: 20, iv2sls: 31, did: 29, var: 30, panel: 30, logit: 32, gmm: 33, foundations: 32, mle: 32, forecast: 32, coint: 32, financial: 32 };
const SLUGS = {
  ols: "ordinary-least-squares",
  iv2sls: "instrumental-variables-2sls",
  did: "difference-in-differences",
  var: "vector-autoregression",
  panel: "panel-fixed-random-effects",
  logit: "logit-probit",
  gmm: "generalized-method-of-moments",
  foundations: "statistical-foundations-simulation-asymptotics",
  mle: "maximum-likelihood-numerical-econometrics",
  forecast: "univariate-time-series-forecasting",
  coint: "cointegration-vecm-state-space",
  financial: "financial-econometrics-risk-factor-models",
};
const courseRoute = (topic) => `/lab/${SLUGS[topic]}/`;
const PAGES = ["/", "/lab/", "/lab/placement/", "/lab/review/", "/lab/challenge/", courseRoute("ols"), courseRoute("foundations"),
  "/lab/projects/macro-forecasting-desk/", "/lab/projects/fx-volatility-risk/", "/lab/projects/factor-pricing-lab/", "/articles/"];
const stageRoute = (topic, index, nonce = index) => `${courseRoute(topic)}?test=${nonce}#s${index}`;

function watch(page, ignored = () => false) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !ignored(message.text())) errors.push("console: " + message.text());
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "unknown";

    const navigationAborted = reason === "net::ERR_ABORTED" &&
      ["/api/v2/bootstrap", "/api/bootstrap", "/api/me", "/api/markets"].includes(new URL(request.url()).pathname);
    const detail = `request failed: ${request.url()} (${reason})`;
    if (!navigationAborted && !ignored(detail)) errors.push(detail);
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

async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
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
    if (url.pathname === "/api/v2/bootstrap") return reply({
      user: { id: "g_browser", name: "Browser Learner", email: "" },
      progress: { ols: { done: [0, 1] } },
      stats: { points: 15, streak: 2, last: "2026-07-13" },
      mastery: {},
      stableProgress: { ols: { done: ["ols-line-01", "ols-line-02"] } },
      skillMastery: {},
      preferences: { activePathId: "complete-core", sessionMinutes: 20, weeklyGoalMinutes: 120 },
      projects: {},
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
        ? reply({ ok: true, progress: {}, stats: { points: 0, streak: 0, last: null }, mastery: {}, stableProgress: {}, skillMastery: {}, projects: {}, placement: null, generation })
        : reply({ error: { code: "temporary" } }, deleteStatus);
    }
    if (url.pathname === "/api/v2/preferences" && method === "PUT") {
      return reply({ ok: true, preferences: JSON.parse(request.postData() || "{}"), generation });
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

  for (const [width, height, mobile] of [[320, 720, true], [390, 844, true], [481, 900, true], [640, 900, true], [768, 1024, true], [1024, 768, true], [1280, 720, false], [1440, 900, false], [2048, 1152, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await context.newPage();
    const clean = watch(page);
    for (const route of PAGES) {
      await page.goto(BASE + route, { waitUntil: "load" });
      if (route === courseRoute("ols")) await waitForCourse(page, "1 / 20");
      if (route === courseRoute("foundations")) await waitForCourse(page, "1 / 32");
      if (route === "/lab/") await waitForAcademy(page);
      if (route === "/lab/review/") await page.locator("#reviewApp[aria-busy='false']").waitFor();
      if (route === "/lab/challenge/") await page.locator(".review-form").waitFor();
      if (route.startsWith("/lab/projects/")) await page.locator("#projectTasks input").first().waitFor();
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `[${width}px] horizontal overflow on ${route}: ${overflow}px`);

      const nav = await page.evaluate(() => {
        const pill = document.querySelector(".pill");
        if (!pill) return null;
        const social = document.querySelector(".topbar__social");
        const brand = document.querySelector(".topbar__brand");
        const boxes = [pill, social, brand].filter(Boolean).map((n) => n.getBoundingClientRect());
        return {
          right: Math.max(...boxes.map((b) => b.right)),
          left: Math.min(...boxes.map((b) => b.left)),
          vw: window.innerWidth,
          tabs: [...pill.querySelectorAll("a")].map((a) => ({
            label: a.textContent.trim().slice(0, 20),
            right: a.getBoundingClientRect().right,
            left: a.getBoundingClientRect().left,
          })),
        };
      });
      if (nav) {
        assert(nav.right <= nav.vw + 1,
          `[${width}px] topbar clipped on ${route}: right edge at ${Math.round(nav.right)} in a ${nav.vw}px viewport`);
        assert(nav.left >= -1,
          `[${width}px] topbar overflows left on ${route}: left edge at ${Math.round(nav.left)}`);
        const offscreen = nav.tabs.filter((t) => t.right > nav.vw + 1 || t.left < -1);
        assert(offscreen.length === 0,
          `[${width}px] nav tab off-screen on ${route}: ${offscreen.map((t) => `${t.label}@${Math.round(t.right)}`).join(", ")}`);
      }
      if (route === "/lab/") {
        const today = await page.locator(".today").boundingBox();
        const heroAction = await page.locator("#heroPrimaryCta").boundingBox();
        const session = await page.locator(".session-control").boundingBox();
        const resumeCard = await page.locator(".dashboard-resume").boundingBox();
        const resumeAction = await page.locator(".dashboard-resume .btn").boundingBox();

        const firstCourseEl = page.locator("#labGrid .model-card").first();
        await firstCourseEl.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
        const firstCourse = await firstCourseEl.boundingBox();
        assert(today && today.y + today.height <= height, `[${width}px] Today surface falls below the initial viewport`);
        assert(heroAction && heroAction.height >= 44, `[${width}px] hero action is not a 44px touch target`);
        assert(session && session.height >= 44, `[${width}px] session planner is not a 44px touch target`);
        assert(resumeAction && resumeAction.height >= 44, `[${width}px] resume action is not a 44px touch target`);
        if (width >= 390) {
          assert(resumeCard && resumeCard.y + resumeCard.height <= height,
            `[${width}px] personalized next-action card falls below the fold at ${Math.round((resumeCard?.y || 0) + (resumeCard?.height || 0))}px`);
        }
        if ([390, 1024, 1280, 1440, 2048].includes(width)) {

          assert(firstCourse,
            `[${width}px] no course card was laid out in #labGrid within 10s — the grid ` +
            "is filled asynchronously, so this is an absent element, not a misplaced one");
          assert(firstCourse.y <= height - 100,
            `[${width}px] first course preview begins too late at ${Math.round(firstCourse.y)}px`);
        }
      }
      if (route === courseRoute("foundations") && width === 1280) {
        const stage = await page.locator(".stage").boundingBox();
        assert(stage && stage.y <= 280, `[1280px] course content begins too late at ${Math.round(stage?.y || 0)}px`);
      }
    }
    clean();
    await context.close();

  }

  {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    assert.equal(new URL(await page.locator("#heroPrimaryCta").getAttribute("href"), BASE).pathname, courseRoute("foundations"));
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Start learning/);
    assert.equal(new URL(await page.locator(".lab-hero__diagnostic").getAttribute("href"), BASE).pathname, "/lab/placement/");
    assert.equal(await page.locator("#labGrid .model-card").count(), 12, "no-JS course catalogue disappeared");
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      window.__pythonLoads = Number(sessionStorage.getItem("academy:test-python-loads") || 0);
      window.__pythonBoots = []; window.__pythonPackageLoads = []; window.__pythonRuns = [];
      window.loadPyodide = async (config = {}) => {
        window.__pythonLoads++;
        sessionStorage.setItem("academy:test-python-loads", String(window.__pythonLoads));
        const loadedPackages = {};
        for (const name of config.packages || []) loadedPackages[name] = "default channel";
        window.__pythonBoots.push(Array.from(config.packages || []));
        return {
          loadedPackages,
          loadPackage: async (names) => { const list = Array.from([].concat(names)); window.__pythonPackageLoads.push(list); for (const name of list) loadedPackages[name] = "default channel"; },
          setStdout: () => {}, setStderr: () => {},
          runPythonAsync: async (code) => { window.__pythonRuns.push(code); return code === "_grab_figs()" ? { toJs: () => [], destroy: () => {} } : undefined; },
        };
      };
    });
    const page = await context.newPage();
    const requested = [];
    page.on("request", (request) => requested.push(request.url()));
    const clean = watch(page);
    await page.goto(BASE + stageRoute("foundations", 1, "native-formats"), { waitUntil: "load" });
    await waitForCourse(page, "2 / 32");

    assert(await page.locator(".cell--interactive .control__range").count() >= 1, "interactive lab has no sliders");
    const labSlider = page.locator(".cell--interactive .control__range").first();
    assert(await labSlider.evaluate((el) => !!(el.closest("label") && el.closest("label").textContent.trim())), "interactive lab slider has no accessible label");
    assert.equal(await page.locator(".cell--interactive .cell__run").count(), 1, "interactive lab has no run button");
    assert.equal(await page.evaluate(() => window.__pythonLoads), 0, "interactive lab eagerly loaded Python");

    await page.goto(BASE + stageRoute("foundations", 3, "native-code"));
    await waitForCourse(page, "4 / 32");
    assert.equal(await page.evaluate(() => window.__pythonLoads), 0, "code challenge loaded Python before Run");
    await page.getByRole("button", { name: "Reveal hint 1" }).click();
    assert(await page.locator(".quiz__feedback.hint").isVisible());
    await page.locator(".cell__run").click();
    await page.locator(".quiz__feedback.ok").waitFor();
    assert.equal(await page.evaluate(() => window.__pythonLoads), 1, "code challenge did not use one lazy Python runtime");
    assert.deepEqual(await page.evaluate(() => window.__pythonBoots), [["numpy"]], "a NumPy-only challenge did not boot Python with NumPy alone");
    assert.deepEqual(await page.evaluate(() => window.__pythonPackageLoads), [], "a NumPy-only challenge loaded packages in a second round");
    assert(!(await page.evaluate(() => window.__pythonRuns.some((code) => code.includes("matplotlib") || code.includes("pandas") || code === "_grab_figs()"))), "a NumPy-only challenge set up Matplotlib or pandas");
    await page.locator("#cPrev").click();
    await waitForCourse(page, "3 / 32");
    await page.locator("#cPrev").click();
    await waitForCourse(page, "2 / 32");
    await page.locator(".cell--interactive .cell__run").click();
    await page.waitForFunction(() => document.querySelector(".cell--interactive .cell__run")?.textContent.includes("Re-run"));
    assert.equal(await page.evaluate(() => window.__pythonLoads), 1, "the second stage booted another Python runtime");
    assert.deepEqual(await page.evaluate(() => window.__pythonPackageLoads), [["scipy", "matplotlib"]], "the interactive lab did not load its missing packages in one call");
    const labRuns = await page.evaluate(() => window.__pythonRuns);
    const setupAt = labRuns.findIndex((code) => code.includes('matplotlib.use("AGG")'));
    const templateAt = labRuns.findIndex((code) => code.includes("import scipy") || code.includes("from scipy"));
    assert(setupAt >= 0 && templateAt > setupAt, "the Matplotlib theme was not applied before the lab ran");
    assert.equal(labRuns.filter((code) => code.includes('matplotlib.use("AGG")')).length, 1, "the Matplotlib theme was applied more than once");
    assert.equal(labRuns.at(-1), "_grab_figs()", "figures were not captured once Matplotlib was loaded");

    await page.goto(BASE + stageRoute("foundations", 4, "native-case"));
    await waitForCourse(page, "5 / 32");
    await page.locator('.case-study__choice[data-answer="0"]').click();
    await page.locator('.case-study__choice[data-answer="0"]').click();
    await page.locator(".case-study__complete").waitFor();

    await page.goto(BASE + stageRoute("foundations", 5, "native-match"));
    await waitForCourse(page, "6 / 32");
    await page.locator('.match-lab__rows label:has-text("Good practice") select').selectOption({ label: "Use expectations for location and variance for dispersion around the mean." });
    await page.locator('.match-lab__rows label:has-text("Diagnostic evidence") select').selectOption({ label: "units, existence of moments, and covariance terms" });
    await page.locator('.match-lab__rows label:has-text("Failure to guard against") select').selectOption({ label: "dropping dependence terms or confusing spread with level" });
    await page.getByRole("button", { name: "Check map" }).click();
    await page.locator(".match-lab .quiz__feedback.ok").waitFor();
    assert.equal(await page.evaluate(() => window.__pythonLoads), 1, "non-code interactions loaded Python");
    assert(requested.some((url) => url.includes("/assets/data/courses/foundations/manifest.json")), "course manifest did not load");
    assert(requested.some((url) => url.includes("/assets/data/courses/foundations/probability.json")), "active module payload did not load");
    assert(!requested.some((url) => /cdn\.jsdelivr\.net\/pyodide/.test(url)), "fake lazy runtime was bypassed by a CDN request");
    clean();
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + "/lab/projects/macro-forecasting-desk/", { waitUntil: "load" });
    await page.locator("#projectTasks input").first().waitFor();
    assert.equal(await page.locator("#projectTasks input").count(), 6);
    await page.getByRole("button", { name: "Unguided" }).click();
    assert.equal(await page.locator("#projectTasks small").count(), 0, "unguided mode exposed guided instructions");
    await page.locator("#projectTasks input").first().check();
    assert.deepEqual(await page.evaluate(() => window.IEWTStorage.projects()["macro-forecasting-desk"]), {
      mode: "unguided", done: ["inspect-vintage"],
    });
    const notebookEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export .ipynb" }).click();
    const notebookDownload = await notebookEvent;
    assert.equal(notebookDownload.suggestedFilename(), "macro-forecasting-desk.ipynb");
    const notebook = JSON.parse(await downloadText(notebookDownload));
    assert.equal(notebook.nbformat, 4);
    assert.equal(notebook.metadata.academyProject, "macro-forecasting-desk");
    assert.equal(notebook.cells.some((cell) => cell.cell_type === "code"), true);
    const reportEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export HTML report" }).click();
    const reportDownload = await reportEvent;
    assert.equal(reportDownload.suggestedFilename(), "macro-forecasting-desk-report.html");
    const report = await downloadText(reportDownload);
    assert.match(report, /^<!doctype html>/i);
    assert.match(report, /Dataset SHA-256:/);
    assert.match(report, /no code or output was stored in D1/i);
    clean();
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + "/lab/challenge/", { waitUntil: "load" });
    for (let index = 0; index < 6; index++) {
      await page.locator('.review-form input[name="answer"]').first().check();
      await page.locator('.review-form button[type="submit"]').click();
      await page.locator("#challengeFeedback:not([hidden])").waitFor();
      await page.locator('.review-form button[type="submit"]').click();
    }
    await page.getByRole("heading", { name: /% correct/ }).waitFor();
    const mastery = await page.evaluate(() => window.IEWTStorage.skillMastery());
    assert.equal(Object.keys(mastery).length, 3, "weak-skill challenge did not target exactly three skills");
    assert(Object.values(mastery).every((record) => record.attempts === 2), "weak-skill challenge did not use two variants per skill");
    clean();
    await context.close();

    const courseContext = await browser.newContext();
    const coursePage = await courseContext.newPage();
    await coursePage.goto(BASE + "/lab/challenge/?course=ols", { waitUntil: "load" });

    const olsItems = await coursePage.evaluate(async () => {
      const payload = await (await fetch(`/assets/data/challenge-bank.json?v=${document.documentElement.dataset.assetVersion}`)).json();
      return payload.items.filter((item) => item.courseId === "ols").map((item) => ({ prompt: item.prompt, answer: item.answer }));
    });

    let previousPrompt = null;
    for (let index = 0; index < 7; index++) {
      const handle = await coursePage.waitForFunction(({ items, previous }) => {
        const prompt = document.querySelector(".review-question__prompt")?.textContent;
        if (!prompt || prompt === previous) return null;
        const hit = items.find((item) => item.prompt === prompt);
        return Number.isInteger(hit?.answer) ? { prompt, answer: hit.answer } : null;
      }, { items: olsItems, previous: previousPrompt });
      const matched = await handle.jsonValue();
      assert(matched && Number.isInteger(matched.answer), "course challenge answer fixture could not match the rendered prompt");
      previousPrompt = matched.prompt;
      await coursePage.locator(`.review-form input[name="answer"][value="${matched.answer}"]`).check();
      await coursePage.locator('.review-form button[type="submit"]').click();
      await coursePage.locator("#challengeFeedback.is-correct").waitFor();
      await coursePage.locator('.review-form button[type="submit"]').click();
    }
    await coursePage.getByRole("heading", { name: "100% correct" }).waitFor();
    assert.match(await coursePage.locator(".review-empty").textContent(), /Course challenge badge earned/);
    await courseContext.close();
  }

  {
    const page = await browser.newPage();
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    const faint = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink-faint").trim());
    assert(contrast(faint, "#0a0a08") >= 4.5, `--ink-faint contrast is ${contrast(faint, "#0a0a08").toFixed(2)}`);
    await page.close();
  }

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

    assert.equal(await page.locator("#learningPaths .path-card").count(), 5, "learning paths did not render");
    assert.equal(await page.locator("#labGrid .model-card").count(), 12, "course catalogue did not render");
    assert.match(await page.locator(".dashboard-resume").textContent(), /2 \/ 20 complete · next lesson 3/);
    assert((await page.locator(".dashboard-resume a").getAttribute("href")).endsWith("#s2"), "resume link did not target the first unfinished lesson");
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Continue OLS · lesson 3/);
    assert((await page.locator("#heroPrimaryCta").getAttribute("href")).endsWith("#s2"), "hero action did not personalize to the next lesson");
    assert.equal(await page.locator("#dashboardFocus li").count(), 3, "focus plan did not render three steps");
    assert.deepEqual(await page.locator("#dashboardFocus li a").evaluateAll((links) => links.map((link) => link.hash)), ["#s2", "#s3", "#s4"]);
    assert.match(await page.locator("#dailyReviewCount").textContent(), /Start your mastery map/);
    assert.equal(new URL(await page.locator("#dailyReviewCta").getAttribute("href"), BASE).pathname, "/lab/challenge/");
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
    await page.waitForFunction(() => document.querySelector("#courseResults")?.textContent === "4 courses");
    assert.equal(await page.locator('#labGrid .model-card [class="model-card__badge"]', { hasText: "Advanced" }).count(), 4);

    await page.selectOption("#levelFilter", "all");
    await page.selectOption("#statusFilter", "in-progress");
    await page.waitForFunction(() => document.querySelector("#courseResults")?.textContent === "1 course");
    assert.equal(await page.locator('#labGrid .model-card[data-status="in-progress"] h3').textContent(), "Ordinary Least Squares");

    await page.fill("#courseSearch", "no-such-econometrics-method");
    await page.waitForFunction(() => document.querySelector("#courseResults")?.textContent === "0 courses");
    assert(await page.locator("#courseEmptyState").isVisible(), "empty search result was not announced visibly");
    const queuedItem = await page.evaluate(() => {
      const skill = window.SKILL_CATALOG[0];
      window.IEWTStorage.setSkillMastery({ [skill.id]: {
        level: 1, dueDay: "2026-07-15", attempts: 1, correct: 1,
        lastResult: true, lastAttemptId: "browser-due", updatedAt: Date.now(),
      } });
      document.dispatchEvent(new Event("iewt:synced"));
      return skill.id;
    });
    assert(queuedItem, "skill catalogue did not expose a deterministic first item");
    await page.waitForFunction(() => document.querySelector("#dailyReviewCta")?.dataset.due === "1");
    assert.equal((await page.locator("#dailyReviewCount").textContent()).trim(), "1 skill due now");
    clean();
    await context.close();
  }

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
      body: JSON.stringify({ schemaVersion: 2, items: reviewItems }),
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
    await page.waitForFunction(() => document.querySelector(".dashboard-resume")?.textContent.includes("3 / 20 complete"));
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
      dashboardFocused: document.activeElement === document.querySelector("#academyTitle"),
    }));
    assert.deepEqual(state, {
      progress: {},
      gamify: { points: 0, streak: 0, last: null },
      guideWidth: 61.4,
      owner: null,
      dashboardFocused: true,
    });
    assert.match(await page.locator(".dashboard-resume").textContent(), /Statistical Foundations[\s\S]*0 \/ 32 complete · next lesson 1/);
    clean();
    await context.close();
  }

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
    assert.match(await page.locator(".dashboard-resume h2").textContent(), /Difference-in-Differences/);
    assert.match(await page.locator("#dashboardSummary").textContent(), /applied diagnostic result recommends DiD first/i);
    assert.equal((await page.locator(".lab-hero__diagnostic").textContent()).trim(), "Retake diagnostic");
    assert.deepEqual(await page.evaluate(() => window.IEWTStorage.progress()), {}, "placement seeded course completion");

    await page.reload({ waitUntil: "load" });
    await waitForAcademy(page);
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Start DiD · lesson 1/, "placement route did not survive reload");
    await page.click("#resetProgressBtn");
    assert.match(await page.locator("#resetDescription").textContent(), /placement/);
    await page.click("#resetConfirm");
    await page.waitForFunction(() => window.IEWTStorage.placement() === null && !document.querySelector("#resetDialog").open);
    assert.match(await page.locator("#heroPrimaryCta").textContent(), /Start Foundations · lesson 1/);
    assert.equal((await page.locator(".lab-hero__diagnostic").textContent()).trim(), "Find your level");
    clean();
    await context.close();
  }

  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const calls = await mockSignedInAPI(page);
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Auth?.status() === "ready" && window.Auth?.isSignedIn() && window.IEWTStorage.progress().ols?.done?.length === 2);
    assert.deepEqual(
      calls.filter((call) => call.method === "GET").map((call) => call.path),
      ["/api/v2/bootstrap"],
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
      if (path === "/api/v2/bootstrap") return reply({
        user: { id: "g_switch", name: "Switching Learner", email: "" },
        progress: serverProgress,
        stats: serverStats,
        mastery: {},
        stableProgress: generation === 0 ? { ols: { done: ["ols-line-01", "ols-line-02"] } } : {}, skillMastery: {},
        preferences: { activePathId: "complete-core", sessionMinutes: 20, weeklyGoalMinutes: 120 },
        projects: {},
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
        return reply({ ok: true, progress: serverProgress, stats: serverStats, mastery: {}, stableProgress: {}, skillMastery: {}, projects: {}, placement: null, generation });
      }
      if (path === "/api/v2/preferences" && method === "PUT") return reply({ ok: true, preferences: JSON.parse(request.postData() || "{}"), generation });
      if (method === "PUT") return reply({ ok: true, stats: serverStats, generation });
      return reply({ error: { code: "not_found" } }, 404);
    });
    const clean = watch(page);
    await page.goto(BASE + "/lab/", { waitUntil: "load" });
    await page.waitForFunction(() => window.Auth?.status() === "ready" && window.IEWTStorage.progress().ols?.done?.length === 2);
    const initialPutCount = calls.filter((call) => call.method === "PUT").length;
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
    assert.deepEqual(calls.filter((call) => call.method === "PUT").slice(initialPutCount), [], "pre-reset state was reuploaded after returning sign-in");
    clean();
    await context.close();
  }

  {
    const context = await browser.newContext();
    const page = await context.newPage();
    let signedIn = true;
    const logoutCalls = [];
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const signedInUser = signedIn ? { id: "g_signout", name: "Sign-out Learner", email: "" } : null;
      const body = path === "/api/v2/bootstrap" ? (signedInUser ? {
        user: signedInUser,
        progress: {},
        stats: { points: 0, streak: 0, last: null },
        mastery: {},
        stableProgress: {}, skillMastery: {},
        preferences: { activePathId: "complete-core", sessionMinutes: 20, weeklyGoalMinutes: 120 },
        projects: {},
        placement: null,
        generation: 0,
      } : { user: null })
        : path === "/api/me" ? { user: signedInUser }
        : path === "/api/progress" ? { progress: {}, generation: 0 }
          : path === "/api/stats" ? { stats: { points: 0, streak: 0, last: null }, generation: 0 }
            : path === "/api/mastery" ? { mastery: {}, generation: 0 }
              : path === "/api/placement" ? { placement: null, generation: 0 }
                : path === "/api/v2/preferences" ? { ok: true, preferences: JSON.parse(request.postData() || "{}"), generation: 0 }
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

  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requested = [];
    let releasePayload;
    const payloadGate = new Promise((resolve) => { releasePayload = resolve; });
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.route("**/assets/data/courses/ols/manifest.json*", async (route) => {
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
    assert.equal(requested.filter((path) => path === "/assets/data/courses/ols/manifest.json").length, 1, "course manifest was not fetched exactly once");
    assert.equal(requested.filter((path) => path === "/assets/data/courses/ols/ols-line.json").length, 1, "selected module payload was not fetched exactly once");
    assert(!requested.includes("/assets/data/courses/ols.json"), "course aggregate loaded despite a valid module manifest");
    for (const script of ["/assets/js/curriculum.js", "/assets/js/curriculum-data.js", "/assets/js/curriculum-questions.js"]) {
      assert(!requested.includes(script), `course downloaded authoring bundle ${script}`);
    }
    assert(!requested.some((path) => /^\/assets\/data\/courses\/(?!ols\/)/.test(path)), "course downloaded another topic payload");
    assert(!requested.some((path) => /^\/assets\/data\/courses\/ols\/(?!manifest\.json$|ols-line\.json$)/.test(path)), "course downloaded an unrelated module payload");
    clean();
    await context.close();
  }

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
    assert.equal((await boot.textContent()).trim(), "Loading Python · NumPy · pandas · SciPy · statsmodels · Matplotlib…", "boot status does not name the packages being loaded");
    await page.goto(BASE + stageRoute("ols", 2), { waitUntil: "load" });
    await waitForCourse(page, "3 / 20");
    const launch = page.locator(".cell--interactive .cell__run");
    await launch.click();
    await page.waitForFunction(() => document.querySelector(".cell--interactive .cell__run")?.textContent === "Running…");
    assert.equal(await launch.getAttribute("aria-busy"), "true", "Launch shows no busy state while Python loads");
    assert(await launch.isDisabled(), "Launch stays clickable while Python loads");
    clean();
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      window.__pythonBoots = []; window.__pythonPackageLoads = []; window.__pythonRuns = [];
      window.loadPyodide = async (config = {}) => {
        const loadedPackages = {};
        for (const name of config.packages || []) loadedPackages[name] = "default channel";
        window.__pythonBoots.push(Array.from(config.packages || []));
        const ran = (fragment) => window.__pythonRuns.some((code) => code.includes(fragment));
        return {
          loadedPackages,
          loadPackage: async (names) => { const list = Array.from([].concat(names)); window.__pythonPackageLoads.push(list); for (const name of list) loadedPackages[name] = "default channel"; },
          setStdout: () => {}, setStderr: () => {},
          pyimport: (name) => {
            if (name !== "pyodide.code") throw new Error("No module named '" + name + "'");
            return {
              find_imports: (code) => {
                const found = [];
                for (const line of code.replace(/\\\n/g, " ").split("\n")) {
                  const m = line.match(/^\s*import\s+(.+)$/);
                  if (m) for (const part of m[1].split(",")) found.push(part.trim().split(/[\s.]/)[0]);
                }
                return { toJs: () => found, destroy: () => {} };
              },
              destroy: () => {},
            };
          },
          runPythonAsync: async (code) => {
            window.__pythonRuns.push(code);
            if (code === "_grab_figs()") return { toJs: () => [], destroy: () => {} };
            const fail = (text) => { throw new Error("Traceback (most recent call last):\n  File \"<exec>\", line 1, in <module>\n" + text + "\n"); };
            if (code.includes("scipy.stats as st") && !loadedPackages.scipy) fail("ModuleNotFoundError: No module named 'scipy'");
            if (code.includes("statsmodels.api as sm") && !loadedPackages.statsmodels) fail("ModuleNotFoundError: No module named 'statsmodels'");
            if (code.includes("value = pd") && !ran("import pandas as pd")) fail("NameError: name 'pd' is not defined");
            if (code.includes(".plot()") && !loadedPackages.matplotlib) fail('ImportError: matplotlib is required for plotting when the default backend "matplotlib" is selected.');
            if (code.includes("rank_corr()") && !loadedPackages.scipy) fail("ImportError: Missing optional dependency 'scipy'.  Use pip or conda to install scipy.");
            if (code.includes("import sklearn")) fail("ModuleNotFoundError: No module named 'sklearn'");
            if (code.includes("stubborn()")) fail("ModuleNotFoundError: No module named 'patsy'");
            return undefined;
          },
        };
      };
    });
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + stageRoute("ols", 1, "lazy-statsmodels"), { waitUntil: "load" });
    await waitForCourse(page, "2 / 20");
    await page.locator(".stage__work .cell__run").click();
    await page.waitForFunction(() => { const b = document.querySelector(".stage__work .cell__run"); return !b.disabled && b.textContent.includes("Run") && !b.textContent.includes("Running"); });
    assert.deepEqual(await page.evaluate(() => window.__pythonBoots), [["numpy", "pandas", "scipy", "statsmodels", "matplotlib"]], "a statsmodels stage did not resolve its whole package set at boot");
    assert.deepEqual(await page.evaluate(() => window.__pythonPackageLoads), [], "a statsmodels stage loaded packages in a second round");
    assert.equal(await page.evaluate(() => window.__pythonRuns.at(-1)), "_grab_figs()", "the statsmodels stage did not capture its figures");

    await page.goto(BASE + stageRoute("foundations", 2, "lazy-retry"), { waitUntil: "load" });
    await waitForCourse(page, "3 / 32");
    const cell = page.locator(".stage__work .cell");
    const runEdited = async (code) => {
      await cell.locator(".cell__editor").fill(code);
      const before = await page.evaluate(() => window.__pythonRuns.length);
      await cell.locator(".cell__run").click();
      await page.waitForFunction(() => { const b = document.querySelector(".stage__work .cell__run"); return !b.disabled && !b.textContent.includes("Running"); });
      return {
        runs: await page.evaluate((from) => window.__pythonRuns.slice(from), before),
        error: await cell.locator(".cell__out .err").count() ? await cell.locator(".cell__out .err").textContent() : null,
      };
    };
    const count = (runs, code) => runs.filter((ran) => ran === code).length;

    let result = await runEdited("value = pd");
    assert.deepEqual(await page.evaluate(() => window.__pythonBoots), [["numpy"]], "a run without imports booted more than NumPy");
    assert.equal(result.error, null, "a bare pd reference was not retried after loading pandas");
    assert.equal(count(result.runs, "value = pd"), 2, "a NameError for a PREAMBLE global did not retry exactly once");
    assert.deepEqual(await page.evaluate(() => window.__pythonPackageLoads), [["pandas"]], "pandas was not loaded for the retry");

    result = await runEdited("s = pd.Series([1.0, 2.0])\ns.plot()");
    assert.equal(result.error, null, "an indirect Matplotlib use was not retried");
    assert.equal(count(result.runs, "s = pd.Series([1.0, 2.0])\ns.plot()"), 2, "the plotting retry did not run exactly twice");
    assert(result.runs.findIndex((code) => code.includes('matplotlib.use("AGG")')) > 0, "the Matplotlib theme was not applied before the retry");
    assert.equal(result.runs.at(-1), "_grab_figs()", "the retried plot was not captured");

    result = await runEdited("rank_corr()");
    assert.equal(result.error, null, "a missing optional dependency was not loaded and retried");
    assert.equal(count(result.runs, "rank_corr()"), 2);

    result = await runEdited("import sklearn");
    assert.match(result.error || "", /No module named 'sklearn'/, "an unknown module error was hidden");
    assert.equal(count(result.runs, "import sklearn"), 1, "an unknown module was retried");

    result = await runEdited("stubborn()");
    assert.match(result.error || "", /No module named 'patsy'/, "a failed retry did not surface its error");
    assert.equal(count(result.runs, "stubborn()"), 2, "a failing retry looped");
    assert.deepEqual(await page.evaluate(() => window.__pythonPackageLoads), [["pandas"], ["matplotlib"], ["scipy"], ["patsy"]], "each retry must load exactly the one missing package");
    assert.equal((await page.locator("#labBoot .boot__txt").textContent()).trim().length > 0, true, "boot status text emptied");

    await page.goto(BASE + stageRoute("foundations", 2, "lazy-semicolon"), { waitUntil: "load" });
    await waitForCourse(page, "3 / 32");
    result = await runEdited("import numpy as np; import scipy.stats as st\nprint('ok')");
    assert.equal(result.error, null, "a second import after a semicolon failed");
    assert.deepEqual(await page.evaluate(() => window.__pythonBoots), [["numpy", "scipy"]], "an import after a semicolon was not part of the boot set");
    assert.equal(count(result.runs, "import numpy as np; import scipy.stats as st\nprint('ok')"), 1, "an import after a semicolon needed a retry");

    await page.goto(BASE + stageRoute("foundations", 2, "lazy-continuation"), { waitUntil: "load" });
    await waitForCourse(page, "3 / 32");
    const spread = "import numpy as np, \\\n    scipy.stats as st, \\\n    statsmodels.api as sm\nprint('ok')";
    result = await runEdited(spread);
    assert.equal(result.error, null, "two packages the scan missed were not both recovered by the one retry");
    assert.deepEqual(await page.evaluate(() => window.__pythonBoots), [["numpy"]], "the scan should have missed the continued imports");
    assert.equal(count(result.runs, spread), 2, "the retry for two missing packages did not run exactly twice");
    assert.deepEqual(await page.evaluate(() => window.__pythonPackageLoads), [["pandas", "scipy", "statsmodels"]], "the retry did not load every package the code imports in one call");
    clean();
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.__status = () => {
        const b = document.getElementById("labBoot");
        return !b ? "(none)" : b.classList.contains("show") ? b.querySelector(".boot__txt").textContent.trim() : "(hidden)";
      };
      window.__loadStatus = []; window.__runStatus = [];
      window.loadPyodide = async (config = {}) => {
        await wait(300);
        const loadedPackages = {};
        for (const name of config.packages || []) loadedPackages[name] = "default channel";
        return {
          loadedPackages,
          loadPackage: async (names) => {
            const list = Array.from([].concat(names));
            window.__loadStatus.push([list.join("+"), "start", window.__status()]);
            await wait(500);
            window.__loadStatus.push([list.join("+"), "end", window.__status()]);
            for (const name of list) loadedPackages[name] = "default channel";
          },
          setStdout: () => {}, setStderr: () => {},
          runPythonAsync: async (code) => {
            window.__runStatus.push([code, window.__status()]);
            if (code.includes("slow()")) await wait(600);
            return code === "_grab_figs()" ? { toJs: () => [], destroy: () => {} } : undefined;
          },
        };
      };
    });
    const page = await context.newPage();
    const clean = watch(page);
    await page.goto(BASE + stageRoute("foundations", 2, "overlap"), { waitUntil: "load" });
    await waitForCourse(page, "3 / 32");

    const first = await page.evaluate(async () => {
      const cell = () => ({ out: document.createElement("div") });
      const early = window.Lab.run("print(1)", cell());
      await new Promise((resolve) => setTimeout(resolve, 50));
      const late = window.Lab.run("import scipy.stats as st", cell());
      const okEarly = await early;
      const whileLateLoads = window.__status();
      const okLate = await late;
      return { okEarly, okLate, whileLateLoads, after: window.__status(), loads: window.__loadStatus };
    });
    assert(first.okEarly && first.okLate, "overlapping runs failed");
    assert.equal(first.whileLateLoads, "Loading SciPy…", "the first run's end replaced or hid the status while the second run was still downloading");
    assert.deepEqual(first.loads, [["scipy", "start", "Loading SciPy…"], ["scipy", "end", "Loading SciPy…"]], "the status changed while SciPy was downloading");
    assert.equal(first.after, "(hidden)", "the status stayed up after every run finished");

    const second = await page.evaluate(async () => {
      const cell = () => ({ out: document.createElement("div") });
      const slow = window.Lab.run("import patsy\nslow()", cell());
      await new Promise((resolve) => setTimeout(resolve, 50));
      const quick = window.Lab.run("import statsmodels.api as sm", cell());
      await quick;
      const whileSlowRuns = window.__status();
      await slow;
      return { whileSlowRuns, after: window.__status(), runs: window.__runStatus.filter(([code]) => code.includes("patsy") || code.includes("statsmodels")) };
    });
    assert.deepEqual(second.runs, [
      ["import patsy\nslow()", "Loading pandas · statsmodels…"],
      ["import statsmodels.api as sm", "Running…"],
    ], "Running… replaced a package download that was still in flight");
    assert.equal(second.whileSlowRuns, "Running…", "a finished run hid the status while another run was still executing");
    assert.equal(second.after, "(hidden)", "the status stayed up after every run finished");

    await page.goto(BASE + stageRoute("foundations", 1, "focus"), { waitUntil: "load" });
    await waitForCourse(page, "2 / 32");
    const launchButton = page.locator(".cell--interactive .cell__run");
    await launchButton.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".cell--interactive .cell__run")?.textContent.includes("Re-run"));
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".cell--interactive .cell__run")), true, "keyboard focus was lost when Launch ran");

    await page.goto(BASE + stageRoute("foundations", 2, "focus-cell"), { waitUntil: "load" });
    await waitForCourse(page, "3 / 32");
    await page.locator(".stage__work .cell__run").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => { const b = document.querySelector(".stage__work .cell__run"); return !b.disabled && !b.textContent.includes("Running"); });
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".stage__work .cell__run")), true, "keyboard focus was lost when Run finished");
    clean();
    await context.close();
  }

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
        if (path === "/api/v2/bootstrap" || path === "/api/bootstrap") return Promise.resolve(reply({ error: { code: "not_found" } }, 404));
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
