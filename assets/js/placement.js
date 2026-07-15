/* =============================================================
   placement.js — lightweight Econometrics Placement Diagnostic.

   Persistence contract: only the five-field placement summary is passed to
   IEWTStorage/Auth. Individual responses never leave this in-memory session,
   and this feature never reads or mutates progress, mastery, or points.
   ============================================================= */
(() => {
  "use strict";

  const BANK_SCHEMA = 1;
  const QUESTION_COUNT = 15;
  const PLACEMENT_TYPES = Object.freeze(["choice", "boolean", "multi", "numeric", "fill"]);
  const PLACEMENT_BANDS = Object.freeze(["foundation", "applied", "advanced"]);
  const TOPIC_ORDER = Object.freeze(["ols", "iv2sls", "did", "panel", "var", "logit", "gmm"]);
  const FORMAT_LABEL = Object.freeze({
    choice: "Single choice",
    boolean: "True or false",
    multi: "Select all that apply",
    numeric: "Numeric response",
    fill: "Fill in the blank",
  });

  const COURSES = Object.freeze({
    ols: Object.freeze({ title: "Ordinary Least Squares", short: "OLS", href: "/lab/ordinary-least-squares/" }),
    iv2sls: Object.freeze({ title: "Instrumental Variables & 2SLS", short: "IV & 2SLS", href: "/lab/instrumental-variables-2sls/" }),
    did: Object.freeze({ title: "Difference-in-Differences", short: "DiD", href: "/lab/difference-in-differences/" }),
    panel: Object.freeze({ title: "Panel Data: Fixed & Random Effects", short: "Panel FE & RE", href: "/lab/panel-fixed-random-effects/" }),
    var: Object.freeze({ title: "Vector Autoregression (VAR)", short: "VAR", href: "/lab/vector-autoregression/" }),
    logit: Object.freeze({ title: "Logit & Probit (Binary Outcomes)", short: "Logit & Probit", href: "/lab/logit-probit/" }),
    gmm: Object.freeze({ title: "Generalized Method of Moments", short: "GMM", href: "/lab/generalized-method-of-moments/" }),
  });

  const APPLIED_ROUTES = Object.freeze({
    ols: Object.freeze(["ols", "iv2sls", "gmm"]),
    iv2sls: Object.freeze(["iv2sls", "gmm", "panel"]),
    did: Object.freeze(["did", "panel", "iv2sls"]),
    panel: Object.freeze(["panel", "did", "gmm"]),
    var: Object.freeze(["var", "gmm", "panel"]),
    logit: Object.freeze(["logit", "panel", "did"]),
    gmm: Object.freeze(["gmm", "var", "panel"]),
  });

  const ADVANCED_ROUTES = Object.freeze({
    ols: Object.freeze(["ols", "iv2sls", "gmm"]),
    iv2sls: Object.freeze(["iv2sls", "gmm", "panel"]),
    did: Object.freeze(["did", "panel", "gmm"]),
    panel: Object.freeze(["panel", "gmm", "var"]),
    var: Object.freeze(["var", "gmm", "panel"]),
    logit: Object.freeze(["logit", "gmm", "panel"]),
    gmm: Object.freeze(["gmm", "var", "panel"]),
  });

  let bankPromise = null;
  let session = null;
  let introMessage = "";

  const hasText = (value) => typeof value === "string" && value.trim().length > 0;

  function validDay(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function localDay(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function normalizedText(value) {
    let text = String(value == null ? "" : value).trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
    if (typeof text.normalize === "function") text = text.normalize("NFKC");
    return text.replace(/[‐‑‒–—−]/g, "-");
  }

  function numericValue(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return NaN;
    return Number(text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text);
  }

  function validChoice(question) {
    return Array.isArray(question.choices) && question.choices.length >= 2 && question.choices.length <= 6 &&
      question.choices.every(hasText) && Number.isInteger(question.answer) &&
      question.answer >= 0 && question.answer < question.choices.length;
  }

  function validMulti(question) {
    if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 7 ||
        !question.choices.every(hasText) || !Array.isArray(question.answers) || !question.answers.length) return false;
    const unique = new Set(question.answers);
    return unique.size === question.answers.length && question.answers.every((answer) =>
      Number.isInteger(answer) && answer >= 0 && answer < question.choices.length);
  }

  function validQuestion(question) {
    if (!question || typeof question !== "object" || Array.isArray(question) ||
        !hasText(question.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(question.id) ||
        !TOPIC_ORDER.includes(question.topic) || !hasText(question.topicTitle) ||
        !PLACEMENT_BANDS.includes(question.difficulty) || !PLACEMENT_TYPES.includes(question.type) ||
        !hasText(question.prompt) || !hasText(question.explanation)) return false;
    if (question.type === "choice") return validChoice(question);
    if (question.type === "boolean") return typeof question.answer === "boolean";
    if (question.type === "multi") return validMulti(question);
    if (question.type === "numeric") {
      return Number.isFinite(question.answer) && Number.isFinite(question.tolerance) && question.tolerance >= 0;
    }
    return (question.prompt.match(/___/g) || []).length === 1 &&
      Array.isArray(question.accept) && question.accept.length > 0 && question.accept.every(hasText) && hasText(question.displayAnswer);
  }

  function normalizeBank(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        payload.schemaVersion !== BANK_SCHEMA || !Array.isArray(payload.questions) ||
        payload.questions.length !== QUESTION_COUNT) throw new Error("invalid-placement-bank");
    const seen = new Set();
    for (const question of payload.questions) {
      if (!validQuestion(question) || seen.has(question.id)) throw new Error("invalid-placement-question");
      seen.add(question.id);
    }
    return payload.questions;
  }

  function isCorrect(question, response) {
    if (response === undefined || response === null) return false;
    if (question.type === "choice") return Number(response) === question.answer;
    if (question.type === "boolean") return response === question.answer;
    if (question.type === "multi") {
      if (!Array.isArray(response)) return false;
      const actual = [...new Set(response.map(Number))].sort((a, b) => a - b);
      const expected = [...question.answers].sort((a, b) => a - b);
      return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    }
    if (question.type === "numeric") {
      const actual = numericValue(response);
      return Number.isFinite(actual) && Math.abs(actual - question.answer) <= question.tolerance;
    }
    const answer = normalizedText(response);
    return !!answer && question.accept.some((accepted) => normalizedText(accepted) === answer);
  }

  function bandForScore(score, total = QUESTION_COUNT) {
    if (!Number.isInteger(score) || score < 0 || score > total || total !== QUESTION_COUNT) {
      throw new TypeError("Invalid placement score");
    }
    if (score <= 6) return "foundation";
    if (score <= 11) return "applied";
    return "advanced";
  }

  function weakestTopic(topicStats) {
    return TOPIC_ORDER.reduce((weakest, topic) => {
      const current = topicStats[topic];
      const prior = topicStats[weakest];
      const currentRate = current.total ? current.correct / current.total : 1;
      const priorRate = prior.total ? prior.correct / prior.total : 1;
      return currentRate < priorRate ? topic : weakest;
    }, TOPIC_ORDER[0]);
  }

  function recommendedTopicFor(band, weakest, score) {
    if (band === "foundation") return "ols";
    if (score === QUESTION_COUNT) return "gmm";
    if (band === "applied" && weakest === "gmm") return "iv2sls";
    return weakest;
  }

  function courseRoute(band, recommendedTopic) {
    if (!PLACEMENT_BANDS.includes(band) || !TOPIC_ORDER.includes(recommendedTopic)) {
      throw new TypeError("Invalid placement route");
    }
    if (band === "foundation") return Object.freeze(["ols", "logit", "did"]);
    return band === "applied" ? APPLIED_ROUTES[recommendedTopic] : ADVANCED_ROUTES[recommendedTopic];
  }

  function grade(questions, responses) {
    if (!Array.isArray(questions) || questions.length !== QUESTION_COUNT || !Array.isArray(responses)) {
      throw new TypeError("Invalid placement submission");
    }
    const topicStats = Object.fromEntries(TOPIC_ORDER.map((topic) => [topic, { correct: 0, total: 0 }]));
    const details = questions.map((question, index) => {
      const correct = isCorrect(question, responses[index]);
      topicStats[question.topic].total += 1;
      if (correct) topicStats[question.topic].correct += 1;
      return { question, response: responses[index], correct };
    });
    const score = details.filter((detail) => detail.correct).length;
    const band = bandForScore(score);
    const weakest = weakestTopic(topicStats);
    const recommendedTopic = recommendedTopicFor(band, weakest, score);
    return { score, total: QUESTION_COUNT, band, weakestTopic: weakest, recommendedTopic, topicStats, details };
  }

  function normalizeResult(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !PLACEMENT_BANDS.includes(value.band) || !Number.isInteger(value.score) ||
        value.total !== QUESTION_COUNT || value.score < 0 || value.score > value.total ||
        bandForScore(value.score, value.total) !== value.band || !validDay(value.completedDay) ||
        !TOPIC_ORDER.includes(value.recommendedTopic)) return null;
    return {
      band: value.band,
      score: value.score,
      total: value.total,
      completedDay: value.completedDay,
      recommendedTopic: value.recommendedTopic,
    };
  }

  const TEST_API = Object.freeze({
    QUESTION_COUNT,
    PLACEMENT_TYPES,
    PLACEMENT_BANDS,
    TOPIC_ORDER,
    COURSES,
    normalizeBank,
    isCorrect,
    bandForScore,
    recommendedTopicFor,
    courseRoute,
    grade,
    normalizeResult,
  });

  // The VM contract suite runs the pure engine without a browser. No test
  // global is installed in production because a real document exists there.
  if (typeof document === "undefined") {
    globalThis.__IEWTPlacementTest = TEST_API;
    return;
  }

  const byId = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function announce(message, tone = "") {
    const status = byId("placementStatus");
    if (!status) return;
    status.className = `placement-status${tone ? ` placement-status--${tone}` : ""}`;
    status.textContent = message || "";
  }

  function focusHeading(heading) {
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (heading.isConnected && document.activeElement !== heading) heading.focus({ preventScroll: true });
    });
  }

  function placementStore() {
    return window.IEWTStorage && typeof window.IEWTStorage.placement === "function" ? window.IEWTStorage : null;
  }

  function readSavedResult() {
    try {
      const store = placementStore();
      return store ? normalizeResult(store.placement()) : null;
    } catch {
      return null;
    }
  }

  async function persistResult(result) {
    if (window.Auth && typeof window.Auth.savePlacement === "function") {
      try {
        const saved = await window.Auth.savePlacement(result);
        const placement = saved && typeof saved === "object" ? normalizeResult(saved.placement) : null;
        return {
          saved: !!placement && saved.saved !== false,
          synced: !!placement && saved.synced === true,
        };
      } catch {
        // Auth owns owner/generation coordination when it is available. Do
        // not bypass a reset or account-change failure with a direct write.
        return { saved: false, synced: false };
      }
    }
    const store = placementStore();
    if (!store || typeof store.setPlacement !== "function") return { saved: false, synced: false };
    try {
      store.setPlacement(result);
      return { saved: true, synced: false };
    } catch {
      return { saved: false, synced: false };
    }
  }

  async function clearSavedResult() {
    if (window.Auth && typeof window.Auth.clearPlacement === "function") {
      try {
        return (await window.Auth.clearPlacement()) !== false;
      } catch {
        return false;
      }
    }
    const store = placementStore();
    if (!store || typeof store.setPlacement !== "function") return false;
    try {
      store.setPlacement(null);
      return true;
    } catch {
      return false;
    }
  }

  function loadBank() {
    if (bankPromise) return bankPromise;
    const version = document.documentElement.dataset.assetVersion;
    const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
    bankPromise = fetch(`/assets/data/placement-bank.json${suffix}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("placement-bank-unavailable");
      return normalizeBank(await response.json());
    }).catch((error) => {
      bankPromise = null;
      throw error;
    });
    return bankPromise;
  }

  function renderRouteList(band, recommendedTopic, compact = false) {
    const list = el("ol", compact ? "placement-mini-route" : "placement-route");
    courseRoute(band, recommendedTopic).forEach((topic, index) => {
      const course = COURSES[topic];
      const item = document.createElement("li");
      const step = el("span", "placement-route__number", String(index + 1).padStart(2, "0"));
      const link = el("a", "", course.title);
      link.href = course.href;
      item.append(step, link);
      list.append(item);
    });
    return list;
  }

  function formatCompletedDay(day) {
    if (!validDay(day)) return day;
    const [year, month, date] = day.split("-").map(Number);
    return new Date(year, month - 1, date, 12).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  }

  function resultBandTitle(band) {
    if (band === "foundation") return "Foundation builder";
    if (band === "applied") return "Applied practitioner";
    return "Advanced econometrician";
  }

  function renderIntro(message = introMessage, options = {}) {
    session = null;
    introMessage = message || "";
    const live = byId("placementLive");
    const app = byId("placementApp");
    if (!live || !app) return;
    app.setAttribute("aria-busy", "false");
    app.setAttribute("aria-labelledby", "placementAppTitle");
    app.setAttribute("aria-describedby", "placementAppDescription");

    const saved = readSavedResult();
    const wrap = el("div", "placement-intro");
    wrap.append(el("p", "placement-eyebrow", saved ? "Your last checkpoint" : "Your starting line"));
    const heading = el("h2", "", saved ? `${resultBandTitle(saved.band)} · ${saved.score}/${saved.total}` : "A diagnostic, not an exam.");
    heading.id = "placementAppTitle";
    wrap.append(heading);
    const description = el("p", "", saved ?
      `Completed ${formatCompletedDay(saved.completedDay)}. Retake whenever your course work has moved the frontier.` :
      "Move through one concise question at a time. The mix covers interpretation, identification, calculation, and model choice from foundation through advanced practice.");
    description.id = "placementAppDescription";
    wrap.append(description);

    if (saved) {
      const recommendation = el("div", "placement-saved-route");
      recommendation.append(el("span", "", "Recommended next"));
      const first = COURSES[saved.recommendedTopic];
      const link = el("a", "", first.title);
      link.href = first.href;
      recommendation.append(link, renderRouteList(saved.band, saved.recommendedTopic, true));
      wrap.append(recommendation);
    } else {
      const formats = el("div", "placement-format-strip");
      formats.setAttribute("aria-label", "Question formats");
      ["Choice", "True / false", "Select all", "Numeric", "Fill in"].forEach((label) => formats.append(el("span", "", label)));
      wrap.append(formats);
    }

    const actions = el("div", "placement-intro__actions");
    const start = el("button", "btn btn--gold placement-primary", saved ? "Retake diagnostic" : "Start 15-question diagnostic");
    start.type = "button";
    start.addEventListener("click", () => {
      // Preserve the last completed checkpoint throughout a retake. It is
      // overwritten only when all 15 new responses have been graded.
      void startDiagnostic(start);
    });
    actions.append(start);

    if (saved) {
      const clear = el("button", "btn btn--ghost", "Clear saved result");
      clear.type = "button";
      clear.addEventListener("click", async () => {
        clear.disabled = true;
        announce("Clearing the saved result…");
        if (await clearSavedResult()) {
          renderIntro("Saved placement result cleared.");
          announce("Saved placement result cleared.", "success");
        } else {
          clear.disabled = false;
          announce("The saved result could not be cleared. Nothing changed; please try again.", "error");
        }
      });
      actions.append(clear);
    }

    const courses = el("a", "btn btn--ghost", "Browse courses");
    courses.href = "/lab/";
    actions.append(courses);
    wrap.append(actions);
    wrap.append(el("p", "placement-privacy", "No points are awarded. Answers stay only in this page session for review and are never stored or sent; only your five-field placement summary persists."));

    live.replaceChildren(wrap);
    announce(message || "");
    if (options.focus !== false) focusHeading(heading);
  }

  async function startDiagnostic(button) {
    const app = byId("placementApp");
    if (!app) return;
    app.setAttribute("aria-busy", "true");
    if (button) button.disabled = true;
    announce("Loading the diagnostic…");
    try {
      const questions = await loadBank();
      session = { questions, responses: new Array(questions.length), index: 0, completed: false };
      announce("");
      renderQuestion();
    } catch {
      app.setAttribute("aria-busy", "false");
      if (button) button.disabled = false;
      announce("The diagnostic could not load. Your saved learning data is unchanged; please try again.", "error");
    }
  }

  function currentAnsweredCount() {
    return session.responses.reduce((count, value) => count + (value !== undefined ? 1 : 0), 0);
  }

  function renderSkillRail(question) {
    const rail = el("aside", "placement-skill-rail");
    rail.setAttribute("aria-label", "Diagnostic coverage and progress");
    const top = el("div", "placement-skill-rail__top");
    top.append(el("span", "", `Question ${session.index + 1} of ${session.questions.length}`),
      el("strong", "", `${currentAnsweredCount()} answered`));
    const progress = document.createElement("progress");
    progress.max = session.questions.length;
    progress.value = currentAnsweredCount();
    progress.setAttribute("aria-label", "Questions answered");
    rail.append(top, progress);

    const list = document.createElement("ol");
    TOPIC_ORDER.forEach((topic) => {
      const course = COURSES[topic];
      const indexes = session.questions.map((item, index) => item.topic === topic ? index : -1).filter((index) => index >= 0);
      const answered = indexes.filter((index) => session.responses[index] !== undefined).length;
      const item = document.createElement("li");
      if (question.topic === topic) item.classList.add("is-current");
      if (answered === indexes.length) item.classList.add("is-complete");
      const mark = el("span", "placement-skill-rail__mark", answered === indexes.length ? "✓" : String(answered));
      mark.setAttribute("aria-hidden", "true");
      item.append(mark, el("span", "", course.short), el("small", "", `${answered}/${indexes.length}`));
      list.append(item);
    });
    rail.append(list);
    return rail;
  }

  function makeOptionFields(question, response) {
    const fieldset = el("fieldset", `placement-options${question.type === "boolean" ? " placement-options--boolean" : ""}`);
    const legend = el("legend", "visually-hidden", question.type === "multi" ? "Select every correct answer" : "Choose one answer");
    fieldset.append(legend);
    const choices = question.type === "boolean" ? ["True", "False"] : question.choices;
    choices.forEach((choice, index) => {
      const value = question.type === "boolean" ? index === 0 : index;
      const id = `placement-answer-${session.index}-${index}`;
      const label = el("label", "placement-option");
      label.htmlFor = id;
      const input = document.createElement("input");
      input.id = id;
      input.name = "placement-answer";
      input.type = question.type === "multi" ? "checkbox" : "radio";
      input.value = String(value);
      if (question.type === "multi") input.checked = Array.isArray(response) && response.includes(index);
      else input.checked = response === value;
      label.append(input, el("span", "placement-option__letter", String.fromCharCode(65 + index)), el("span", "", choice));
      fieldset.append(label);
    });
    return fieldset;
  }

  function makeWrittenField(question, response) {
    const wrap = el("div", "placement-written");
    const id = `placement-answer-${session.index}`;
    const label = el("label", "visually-hidden", question.type === "numeric" ? "Numeric answer" : "Answer for the blank");
    label.htmlFor = id;
    const input = document.createElement("input");
    input.id = id;
    input.name = "placement-answer";
    input.className = "placement-input";
    input.type = "text";
    input.autocomplete = "off";
    input.value = response === undefined ? "" : String(response);
    if (question.type === "numeric") input.inputMode = "decimal";
    else {
      input.spellcheck = false;
      input.setAttribute("autocapitalize", "none");
    }
    wrap.append(label, input);
    if (question.type === "numeric" && hasText(question.unit)) wrap.append(el("span", "placement-input__unit", question.unit));
    return wrap;
  }

  function readResponse(form, question) {
    if (question.type === "choice" || question.type === "boolean") {
      const input = form.querySelector("input[name='placement-answer']:checked");
      if (!input) return { answered: false };
      return { answered: true, value: question.type === "boolean" ? input.value === "true" : Number(input.value) };
    }
    if (question.type === "multi") {
      const values = [...form.querySelectorAll("input[name='placement-answer']:checked")].map((input) => Number(input.value));
      return values.length ? { answered: true, value: values } : { answered: false };
    }
    const input = form.elements.namedItem("placement-answer");
    const value = input ? String(input.value).trim() : "";
    return value ? { answered: true, value } : { answered: false };
  }

  function showQuestionError(form) {
    const error = form.querySelector(".placement-question__error");
    if (error) {
      error.hidden = false;
      error.textContent = "Choose or enter an answer before continuing.";
    }
    const first = form.querySelector("input");
    if (first) first.focus();
  }

  function renderQuestion() {
    if (!session || session.completed) return;
    const app = byId("placementApp");
    const live = byId("placementLive");
    if (!app || !live) return;
    app.setAttribute("aria-busy", "false");
    app.setAttribute("aria-labelledby", "placementQuestionTitle");
    app.setAttribute("aria-describedby", "placementQuestionPrompt");
    const question = session.questions[session.index];
    const shell = el("div", "placement-question-shell");
    shell.append(renderSkillRail(question));

    const card = el("article", "placement-question");
    const meta = el("div", "placement-question__meta");
    meta.append(el("span", `placement-difficulty placement-difficulty--${question.difficulty}`, question.difficulty),
      el("span", "", question.topicTitle), el("span", "", FORMAT_LABEL[question.type]));
    const heading = el("h2", "", `Question ${session.index + 1}`);
    heading.id = "placementQuestionTitle";
    const prompt = el("p", "placement-question__prompt", question.prompt);
    prompt.id = "placementQuestionPrompt";
    card.append(meta, heading, prompt);

    const form = el("form", "placement-form");
    form.setAttribute("aria-labelledby", heading.id);
    form.setAttribute("aria-describedby", prompt.id);
    const prior = session.responses[session.index];
    form.append(question.type === "choice" || question.type === "boolean" || question.type === "multi" ?
      makeOptionFields(question, prior) : makeWrittenField(question, prior));
    const error = el("p", "placement-question__error");
    error.hidden = true;
    error.setAttribute("role", "alert");
    form.append(error);

    const actions = el("div", "placement-question__actions");
    const back = el("button", "btn btn--ghost", "Back");
    back.type = "button";
    back.disabled = session.index === 0;
    back.addEventListener("click", () => {
      const draft = readResponse(form, question);
      if (draft.answered) session.responses[session.index] = draft.value;
      session.index -= 1;
      renderQuestion();
    });
    const next = el("button", "btn btn--gold placement-primary", session.index === session.questions.length - 1 ? "Finish & see my route" : "Continue");
    next.type = "submit";
    actions.append(back, next);
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const answer = readResponse(form, question);
      if (!answer.answered) {
        showQuestionError(form);
        return;
      }
      session.responses[session.index] = answer.value;
      if (session.index < session.questions.length - 1) {
        session.index += 1;
        renderQuestion();
      } else {
        void finishDiagnostic(next);
      }
    });
    card.append(form);
    shell.append(card);
    live.replaceChildren(shell);
    announce(`Question ${session.index + 1} of ${session.questions.length}. ${question.topicTitle}.`);
    focusHeading(heading);
  }

  function responseText(question, response) {
    if (response === undefined || response === null) return "No answer";
    if (question.type === "choice") return question.choices[Number(response)] || "No answer";
    if (question.type === "boolean") return response ? "True" : "False";
    if (question.type === "multi") return Array.isArray(response) ? response.map((index) => question.choices[index]).filter(Boolean).join("; ") : "No answer";
    return String(response);
  }

  function correctAnswerText(question) {
    if (question.type === "choice") return question.choices[question.answer];
    if (question.type === "boolean") return question.answer ? "True" : "False";
    if (question.type === "multi") return question.answers.map((index) => question.choices[index]).join("; ");
    if (question.type === "numeric") return `${question.answer}${hasText(question.unit) ? ` ${question.unit}` : ""}`;
    return question.displayAnswer;
  }

  function renderExplanations(outcome) {
    const section = el("section", "placement-explanations");
    const head = el("div", "placement-results__section-head");
    head.append(el("p", "placement-eyebrow", "Answer review"), el("h2", "", "Turn every miss into a method."));
    section.append(head, el("p", "placement-explanations__intro", "Incorrect answers are expanded first. Every explanation remains available for review."));
    outcome.details.forEach((detail, index) => {
      const disclosure = document.createElement("details");
      disclosure.className = `placement-explanation ${detail.correct ? "is-correct" : "is-review"}`;
      disclosure.open = !detail.correct;
      const summary = document.createElement("summary");
      summary.append(el("span", "placement-explanation__number", String(index + 1).padStart(2, "0")),
        el("span", "placement-explanation__topic", detail.question.topicTitle),
        el("strong", "", detail.correct ? "Correct" : "Review"));
      const body = el("div", "placement-explanation__body");
      body.append(el("p", "placement-explanation__prompt", detail.question.prompt));
      const answers = el("dl", "placement-explanation__answers");
      const yourTerm = el("dt", "", "Your answer");
      const yourAnswer = el("dd", "", responseText(detail.question, detail.response));
      const correctTerm = el("dt", "", "Correct answer");
      const correctAnswer = el("dd", "", correctAnswerText(detail.question));
      answers.append(yourTerm, yourAnswer, correctTerm, correctAnswer);
      body.append(answers, el("p", "", detail.question.explanation));
      disclosure.append(summary, body);
      section.append(disclosure);
    });
    return section;
  }

  function renderTopicProfile(outcome) {
    const section = el("section", "placement-topic-profile");
    const heading = el("h2", "", "Your method profile");
    section.append(el("p", "placement-eyebrow", "Coverage map"), heading);
    const list = document.createElement("ul");
    TOPIC_ORDER.forEach((topic) => {
      const stats = outcome.topicStats[topic];
      const percent = Math.round((stats.correct / stats.total) * 100);
      const item = document.createElement("li");
      const label = el("div", "");
      label.append(el("span", "", COURSES[topic].short), el("strong", "", `${stats.correct}/${stats.total}`));
      const meter = el("span", "placement-topic-profile__meter");
      const fill = el("span", "");
      fill.style.width = `${percent}%`;
      meter.append(fill);
      item.append(label, meter);
      list.append(item);
    });
    section.append(list);
    return section;
  }

  async function finishDiagnostic(button) {
    if (!session || session.completed) return;
    session.completed = true;
    if (button) button.disabled = true;
    const outcome = grade(session.questions, session.responses);
    const result = {
      band: outcome.band,
      score: outcome.score,
      total: outcome.total,
      completedDay: localDay(),
      recommendedTopic: outcome.recommendedTopic,
    };
    renderResults(outcome, result);
    announce("Your route is ready. Saving the five-field placement summary…");
    const save = await persistResult(result);
    if (!save.saved) announce("Your route is ready, but this browser could not save the summary. Your course progress is unchanged.", "error");
    else if (save.synced) announce("Placement complete. Your result is saved to your learning profile.", "success");
    else announce("Placement complete. Your result is saved on this device.", "success");
  }

  function renderResults(outcome, result) {
    const live = byId("placementLive");
    const app = byId("placementApp");
    if (!live || !app) return;
    app.setAttribute("aria-busy", "false");
    app.setAttribute("aria-labelledby", "placementResultTitle");
    app.removeAttribute("aria-describedby");
    const wrap = el("div", "placement-results");

    const summary = el("header", "placement-results__hero");
    const score = el("div", "placement-score");
    score.style.setProperty("--placement-score", `${(outcome.score / outcome.total) * 360}deg`);
    score.setAttribute("aria-label", `${outcome.score} correct out of ${outcome.total}`);
    const scoreInner = el("span", "");
    scoreInner.append(el("strong", "", outcome.score), document.createTextNode(` / ${outcome.total}`));
    score.append(scoreInner);
    const copy = el("div", "placement-results__copy");
    copy.append(el("p", "placement-eyebrow", `${outcome.band} placement`));
    const heading = el("h2", "", resultBandTitle(outcome.band));
    heading.id = "placementResultTitle";
    copy.append(heading, el("p", "", outcome.band === "foundation" ?
      "Build a reliable regression base, then layer causal design and nonlinear outcomes on top." :
      outcome.band === "applied" ?
        "Your core reasoning is working. Strengthen the weakest method, then connect it to the next design." :
        "You are ready for advanced work. Begin at the edge that showed the most friction and move toward synthesis."));
    summary.append(score, copy);
    wrap.append(summary);

    const course = COURSES[outcome.recommendedTopic];
    const route = el("section", "placement-recommendation");
    const routeCopy = el("div", "placement-recommendation__copy");
    routeCopy.append(el("p", "placement-eyebrow", "Recommended first course"));
    const courseHeading = el("h2", "", course.title);
    routeCopy.append(courseHeading, el("p", "", outcome.band === "foundation" ?
      "OLS is the prerequisite base for every route. Build it first, then connect it to nonlinear outcomes and causal design." :
      "Your lowest relative coverage points here. Follow it with the two connected methods in your route."));
    const start = el("a", "btn btn--gold placement-primary", "Start this course →");
    start.href = course.href;
    routeCopy.append(start);
    const routePlan = el("div", "placement-recommendation__path");
    routePlan.append(el("p", "placement-eyebrow", "Your three-step route"), renderRouteList(outcome.band, outcome.recommendedTopic));
    route.append(routeCopy, routePlan);
    wrap.append(route, renderTopicProfile(outcome));

    const actions = el("div", "placement-results__actions");
    const retake = el("button", "btn btn--ghost", "Retake diagnostic");
    retake.type = "button";
    retake.addEventListener("click", () => {
      // A partial or abandoned retake must not erase the learner's last result.
      // Completing the new attempt atomically replaces that checkpoint.
      void startDiagnostic(retake);
    });
    const clear = el("button", "btn btn--ghost", "Clear saved result");
    clear.type = "button";
    clear.addEventListener("click", async () => {
      clear.disabled = true;
      announce("Clearing the saved result…");
      if (await clearSavedResult()) {
        renderIntro("Saved placement result cleared.");
        announce("Saved placement result cleared.", "success");
      } else {
        clear.disabled = false;
        announce("The saved result could not be cleared. Nothing changed; please try again.", "error");
      }
    });
    const lab = el("a", "btn btn--ghost", "Return to the Lab");
    lab.href = "/lab/";
    actions.append(retake, clear, lab);
    wrap.append(actions, el("p", "placement-results__no-points", "Diagnostic results do not award points, complete lessons, or change the Daily Mastery queue."), renderExplanations(outcome));

    live.replaceChildren(wrap);
    focusHeading(heading);
  }

  function init() {
    // Initial hydration must not steal focus from browser chrome, navigation,
    // or an assistive-technology reading position. User-triggered transitions
    // still focus their new question/result heading.
    renderIntro("", { focus: false });
    document.addEventListener("iewt:auth-ready", () => {
      if (!session) renderIntro(introMessage, { focus: false });
    });
    document.addEventListener("iewt:owner-changed", () => {
      if (!session) renderIntro("", { focus: false });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
