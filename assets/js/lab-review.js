/* =============================================================
   lab-review.js — up-to-five-question Daily Mastery Review.

   This page intentionally does not load Pyodide and never awards course
   points. Auth.recordMasteryAttempt owns local-first, owner-scoped storage and
   optional server synchronization; stable attempt ids make a save retry safe.
   ============================================================= */
(() => {
  "use strict";

  const SUPPORTED_TYPES = new Set(["quiz", "truefalse", "multi", "numeric", "fillblank"]);
  const TYPE_LABELS = Object.freeze({
    quiz: "Single choice",
    truefalse: "True or false",
    multi: "Select all that apply",
    numeric: "Numeric response",
    fillblank: "Fill in the blank",
  });

  let initialized = false;
  let bankPromise = null;
  let startGeneration = 0;
  let state = null;

  const byId = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function localDay(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function attemptId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    const random = Math.random().toString(36).slice(2, 14);
    return `review-${Date.now().toString(36)}-${random}`;
  }

  function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validChoiceQuestion(item) {
    return Array.isArray(item.choices) && item.choices.length >= 2 &&
      item.choices.every(hasText) && Number.isInteger(item.answer) &&
      item.answer >= 0 && item.answer < item.choices.length;
  }

  function validMultiQuestion(item) {
    if (!Array.isArray(item.choices) || item.choices.length < 2 || !item.choices.every(hasText) ||
        !Array.isArray(item.answers) || !item.answers.length) return false;
    const answers = new Set(item.answers);
    return answers.size === item.answers.length &&
      item.answers.every((value) => Number.isInteger(value) && value >= 0 && value < item.choices.length);
  }

  function validItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        !hasText(item.id) || !/^[A-Za-z0-9._:-]{1,128}$/.test(item.id) || !hasText(item.courseId) ||
        !Number.isInteger(item.stageIndex) || item.stageIndex < 0 ||
        !SUPPORTED_TYPES.has(item.type) || !hasText(item.title) || !hasText(item.prompt)) return false;

    if (item.type === "quiz") return validChoiceQuestion(item);
    if (item.type === "truefalse") return typeof item.answer === "boolean";
    if (item.type === "multi") return validMultiQuestion(item);
    if (item.type === "numeric") return Number.isFinite(Number(item.answer));
    return Array.isArray(item.accept) && item.accept.length > 0 && item.accept.every(hasText);
  }

  function normalizeBank(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        payload.schemaVersion !== 2 || !Array.isArray(payload.items)) {
      throw new Error("invalid-review-bank");
    }
    const seen = new Set();
    const items = payload.items.filter((item) => {
      if (!validItem(item) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    if (!items.length) throw new Error("empty-review-bank");
    return items;
  }

  async function loadBank() {
    if (bankPromise) return bankPromise;
    const version = document.documentElement.dataset.assetVersion;
    const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
    bankPromise = fetch(`/assets/data/review-bank.json${suffix}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("review-bank-unavailable");
      return normalizeBank(await response.json());
    });
    return bankPromise;
  }

  function courseMeta(item) {
    const catalogue = window.TOPIC_BY_ID && window.TOPIC_BY_ID[item.courseId];
    const title = hasText(item.courseTitle) ? item.courseTitle.trim() :
      catalogue && hasText(catalogue.title) ? catalogue.title : item.courseId.toUpperCase();
    const candidateSlug = hasText(item.courseSlug) ? item.courseSlug.trim() : catalogue && catalogue.slug;
    const slug = typeof candidateSlug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidateSlug) ? candidateSlug : null;
    return { title, href: slug ? `/lab/${slug}/` : "/lab/" };
  }

  function saveMode() {
    const auth = window.Auth;
    if (auth && typeof auth.isSignedIn === "function" && auth.isSignedIn()) return "Account sync on";
    if (auth && typeof auth.status === "function" && auth.status() === "checking") return "Checking saved progress";
    return "Saved on this device";
  }

  function refreshSaveMode() {
    document.querySelectorAll("[data-review-save-mode]").forEach((node) => {
      node.textContent = saveMode();
    });
  }

  function setFallbackError(message) {
    const app = byId("reviewApp");
    const status = byId("reviewBootStatus");
    if (app) app.setAttribute("aria-busy", "false");
    if (status) {
      status.classList.add("is-error");
      status.textContent = message;
    }
  }

  function revealLive(content) {
    const app = byId("reviewApp");
    const fallback = byId("reviewFallback");
    const live = byId("reviewLive");
    if (!app || !fallback || !live) return;
    live.replaceChildren(content);
    fallback.hidden = true;
    live.hidden = false;
    app.setAttribute("aria-busy", "false");
  }

  function readMastery() {
    const value = window.IEWTStorage.mastery();
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value.items && typeof value.items === "object" && !Array.isArray(value.items) ? { ...value.items } : { ...value };
  }

  function readProgress() {
    const value = window.IEWTStorage.progress();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function hasCompletedWork(progress) {
    return Object.values(progress).some((entry) => Array.isArray(entry && entry.done) && entry.done.length > 0);
  }

  function renderEmpty(progress) {
    const wrap = el("div", "review-empty");
    wrap.append(el("p", "review-eyebrow", "Daily mastery"));
    const heading = el("h2", "", hasCompletedWork(progress) ? "You are caught up for today." : "Complete an assessment to unlock review.");
    heading.id = "reviewEmptyTitle";
    wrap.append(heading);
    wrap.append(el("p", "", hasCompletedWork(progress) ?
      "Nothing eligible is due right now. Concepts return here as their review dates arrive, so your next session stays focused instead of repetitive." :
      "Daily review only draws from quiz and short-answer stages you have already completed. Start a course, solve an assessment, and it will enter your mastery schedule."));
    const actions = el("div", "review-empty__actions");
    const library = el("a", "btn btn--gold", hasCompletedWork(progress) ? "Continue learning" : "Choose a course");
    library.href = "/lab/";
    actions.append(library);
    wrap.append(actions);
    revealLive(wrap);
  }

  function createSessionHeader() {
    const head = el("header", "review-session__head");
    const label = el("div", "review-session__label");
    const position = el("span", "review-session__position", `Question 1 of ${state.items.length}`);
    position.id = "reviewPosition";
    const sessionLabel = el("span", "", "Daily mastery review");
    label.append(position, sessionLabel);
    const mode = el("span", "review-save-mode", saveMode());
    mode.dataset.reviewSaveMode = "";
    const progress = document.createElement("progress");
    progress.className = "review-session__progress";
    progress.id = "reviewProgress";
    progress.max = state.items.length;
    progress.value = 0;
    progress.setAttribute("aria-label", "Questions completed");
    head.append(label, mode, progress);
    return head;
  }

  function updateSessionHeader(completed = state.index) {
    const position = byId("reviewPosition");
    const progress = byId("reviewProgress");
    if (position) position.textContent = `Question ${Math.min(state.index + 1, state.items.length)} of ${state.items.length}`;
    if (progress) progress.value = Math.max(0, Math.min(state.items.length, completed));
  }

  function makeChoiceField(item, name, sessionKey) {
    const fieldset = el("fieldset", `review-options${item.type === "truefalse" ? " review-options--truefalse" : ""}`);
    const legend = el("legend", "visually-hidden", item.type === "multi" ? "Select every correct answer" : "Choose one answer");
    fieldset.append(legend);
    const choices = item.type === "truefalse" ? ["True", "False"] : item.choices;
    choices.forEach((choice, index) => {
      const id = `review-${sessionKey}-${state.index}-${index}`;
      const label = el("label", "review-option");
      label.htmlFor = id;
      const input = document.createElement("input");
      input.id = id;
      input.name = name;
      input.type = item.type === "multi" ? "checkbox" : "radio";
      input.value = item.type === "truefalse" ? String(index === 0) : String(index);
      const text = el("span", "", choice);
      label.append(input, text);
      fieldset.append(label);
    });
    return fieldset;
  }

  function makeWrittenField(item, sessionKey) {
    const wrap = el("div", "review-written");
    const id = `review-written-${sessionKey}-${state.index}`;
    const input = document.createElement("input");
    input.id = id;
    input.name = "review-answer";
    input.className = "review-input";
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("aria-label", item.type === "numeric" ? "Numeric answer" : "Answer for the blank");

    if (item.type === "numeric") {
      input.inputMode = "decimal";
      const label = el("label", "visually-hidden", "Numeric answer");
      label.htmlFor = id;
      wrap.append(label, input);
      if (hasText(item.unit)) wrap.append(el("span", "review-input__unit", item.unit.trim()));
      return wrap;
    }

    input.spellcheck = false;
    input.setAttribute("autocapitalize", "none");
    const prompt = el("p", "review-written__prompt");
    const marker = item.prompt.indexOf("___");
    if (marker >= 0) {
      prompt.append(document.createTextNode(item.prompt.slice(0, marker)), input,
        document.createTextNode(item.prompt.slice(marker + 3)));
    } else {
      const label = el("label", "", item.prompt);
      label.htmlFor = id;
      prompt.append(label);
      wrap.append(prompt, input);
      return wrap;
    }
    wrap.append(prompt);
    return wrap;
  }

  function normalizedText(value) {
    const text = String(value).trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
    return typeof text.normalize === "function" ? text.normalize("NFKC") : text;
  }

  function numericValue(value) {
    const text = String(value).trim();
    if (!text) return NaN;
    const normalized = text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text;
    return Number(normalized);
  }

  function readAnswer(form, item) {
    if (item.type === "quiz" || item.type === "truefalse") {
      const checked = form.querySelector("input[name='review-answer']:checked");
      return checked ? { answered: true, value: checked.value } : { answered: false };
    }
    if (item.type === "multi") {
      const values = [...form.querySelectorAll("input[name='review-answer']:checked")].map((input) => Number(input.value));
      return values.length ? { answered: true, value: values } : { answered: false };
    }
    const input = form.elements.namedItem("review-answer");
    const value = input ? input.value : "";
    return String(value).trim() ? { answered: true, value } : { answered: false };
  }

  function isCorrect(item, response) {
    if (item.type === "quiz") return Number(response) === item.answer;
    if (item.type === "truefalse") return (response === "true") === item.answer;
    if (item.type === "multi") {
      const actual = [...response].sort((a, b) => a - b);
      const expected = [...item.answers].sort((a, b) => a - b);
      return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    }
    if (item.type === "fillblank") {
      const answer = normalizedText(response);
      return item.accept.some((accepted) => normalizedText(accepted) === answer);
    }

    const actual = numericValue(response);
    const expected = Number(item.answer);
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    const absolute = Number(item.tol ?? item.tolerance);
    const relative = Number(item.rtol);
    const absTol = Number.isFinite(absolute) && absolute >= 0 ? absolute : 0;
    const relTol = Number.isFinite(relative) && relative >= 0 ? relative * Math.abs(expected) : 0;
    const tolerance = Math.max(absTol, relTol, Number.EPSILON * Math.max(1, Math.abs(expected)) * 8);
    return Math.abs(actual - expected) <= tolerance;
  }

  function explanationFor(item) {
    const parts = [];
    if (hasText(item.explain)) parts.push(item.explain.trim());
    if (hasText(item.why) && !parts.includes(item.why.trim())) parts.push(item.why.trim());
    return parts;
  }

  function setFeedback(feedback, kind, title, paragraphs = [], saveText = "") {
    feedback.className = `review-feedback${kind ? ` is-${kind}` : ""}`;
    feedback.replaceChildren(el("strong", "", title));
    paragraphs.filter(hasText).forEach((paragraph) => feedback.append(el("p", "", paragraph)));
    if (saveText) feedback.append(el("p", "review-feedback__save", saveText));
    feedback.hidden = false;
    feedback.focus({ preventScroll: true });
  }

  function resultSaveText(result) {
    if (result && result.duplicate) return "The original attempt was recovered; it was not counted twice.";
    if (result && result.synced) return "Saved to your account.";
    if (window.Auth && typeof window.Auth.isSignedIn === "function" && window.Auth.isSignedIn()) {
      return "Saved on this device. Account sync will retry when the connection is available.";
    }
    return "Saved on this device.";
  }

  function projectRecord(item, pending) {
    return window.MasteryScheduler.apply(state.mastery[item.id], {
      correct: pending.correct,
      hinted: pending.hinted,
      today: state.today,
      attemptId: pending.attemptId,
    });
  }

  function renderQuestion() {
    const item = state.items[state.index];
    const host = byId("reviewQuestionHost");
    if (!item || !host) return;

    updateSessionHeader(state.index);
    const article = el("article", "review-question");
    const meta = el("p", "review-question__meta");
    const course = courseMeta(item);
    const courseLink = el("a", "review-question__course", course.title);
    courseLink.href = course.href;
    const moduleName = hasText(item.moduleTitle) ? item.moduleTitle.trim() : `Stage ${item.stageIndex + 1}`;
    meta.append(courseLink, el("span", "", moduleName), el("span", "", TYPE_LABELS[item.type]));

    const title = el("h2", "", item.title);
    title.id = "reviewQuestionTitle";
    title.tabIndex = -1;
    article.setAttribute("aria-labelledby", title.id);
    article.append(meta, title);
    if (item.type !== "fillblank") article.append(el("p", "review-question__prompt", item.prompt));
    if (hasText(item.lead)) article.append(el("p", "review-question__lead", item.lead.trim()));

    const form = el("form", "review-form");
    form.noValidate = true;
    const sessionKey = state.sessionKey;
    form.append(item.type === "quiz" || item.type === "truefalse" || item.type === "multi" ?
      makeChoiceField(item, "review-answer", sessionKey) : makeWrittenField(item, sessionKey));

    const actions = el("div", "review-form__actions");
    const submit = el("button", "btn btn--gold", "Check answer");
    submit.type = "submit";
    actions.append(submit);

    let hintButton = null;
    let hint = null;
    let hinted = false;
    if (hasText(item.hint)) {
      hintButton = el("button", "btn btn--ghost", "Show hint");
      hintButton.type = "button";
      hintButton.setAttribute("aria-expanded", "false");
      hintButton.setAttribute("aria-controls", "reviewHint");
      hint = el("p", "review-hint", item.hint.trim());
      hint.id = "reviewHint";
      hint.hidden = true;
      hintButton.addEventListener("click", () => {
        hinted = true;
        state.hintedItems.add(item.id);
        const willShow = hint.hidden;
        hint.hidden = !willShow;
        hintButton.setAttribute("aria-expanded", String(willShow));
        hintButton.textContent = willShow ? "Hide hint" : "Show hint";
        if (willShow) hint.focus({ preventScroll: true });
      });
      hint.tabIndex = -1;
      actions.append(hintButton);
    }

    const feedback = el("div", "review-feedback");
    feedback.hidden = true;
    feedback.tabIndex = -1;
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("aria-atomic", "true");
    if (hint) form.append(hint);
    form.append(feedback, actions);
    article.append(form);
    host.replaceChildren(article);
    title.focus({ preventScroll: true });

    const controls = [...form.querySelectorAll("input")];
    let pending = null;
    let busy = false;

    function disableInputs(disabled) {
      controls.forEach((control) => { control.disabled = disabled; });
      if (hintButton) hintButton.disabled = disabled;
    }

    async function persistPending() {
      if (!pending || busy) return;
      busy = true;
      submit.disabled = true;
      submit.textContent = "Saving…";
      disableInputs(true);

      try {
        const projected = projectRecord(item, pending);
        const result = await window.Auth.recordMasteryAttempt(item.id, {
          correct: pending.correct,
          hinted: pending.hinted,
          attemptId: pending.attemptId,
          day: state.today,
        });
        state.mastery[item.id] = result && result.record ? result.record : projected;
        state.totalAttempts += 1;
        const itemAttempts = (state.attemptsByItem.get(item.id) || 0) + 1;
        state.attemptsByItem.set(item.id, itemAttempts);
        const savedPending = pending;
        pending = null;

        if (savedPending.correct) {
          state.solved += 1;
          if (itemAttempts === 1 && !state.hintedItems.has(item.id)) state.firstTry += 1;
          updateSessionHeader(state.index + 1);
          setFeedback(feedback, "correct", "Correct.", explanationFor(item), resultSaveText(result));
          submit.hidden = true;
          if (hintButton) hintButton.disabled = true;
          const next = el("button", "btn btn--gold", state.index === state.items.length - 1 ? "See session summary" : "Next question");
          next.type = "button";
          next.addEventListener("click", () => {
            if (state.index === state.items.length - 1) finishSession();
            else {
              state.index += 1;
              renderQuestion();
            }
          }, { once: true });
          actions.append(next);
        } else {
          setFeedback(feedback, "wrong", "Not yet — adjust your answer and try again.", explanationFor(item), resultSaveText(result));
          disableInputs(false);
          submit.disabled = false;
          submit.textContent = "Try again";
        }
      } catch {
        setFeedback(feedback, "error", "Your answer was graded, but it could not be saved.", [
          "Retry the save before continuing. The same attempt identifier will be reused, so a delayed response cannot count it twice.",
        ]);
        submit.disabled = false;
        submit.textContent = "Retry saving answer";
      } finally {
        busy = false;
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (busy) return;
      if (pending) {
        void persistPending();
        return;
      }
      const response = readAnswer(form, item);
      if (!response.answered) {
        setFeedback(feedback, "error", "Choose or enter an answer first.");
        return;
      }
      pending = {
        correct: isCorrect(item, response.value),
        hinted,
        attemptId: attemptId(),
      };
      void persistPending();
    });
  }

  function renderSession() {
    const session = el("section", "review-session");
    session.setAttribute("aria-label", "Daily mastery review session");
    session.append(createSessionHeader());
    const host = el("div", "");
    host.id = "reviewQuestionHost";
    session.append(host);
    revealLive(session);
    renderQuestion();
  }

  function finishSession() {
    if (!state || state.solved !== state.items.length) return;
    // Credit the streak for any fully-solved session, not only a full five —
    // selectSession() returns up to five, so a diligent learner with a small
    // due queue was previously denied credit for clearing it.
    if (state.items.length >= 1 && window.Gamify && typeof window.Gamify.touch === "function") {
      try { void window.Gamify.touch(); }
      catch { /* Mastery is already saved; streak activity is non-critical. */ }
    }

    const wrap = el("div", "review-summary");
    wrap.append(el("p", "review-eyebrow", "Session complete"));
    const heading = el("h2", "", "Today’s retrieval work is done.");
    heading.id = "reviewSummaryTitle";
    heading.tabIndex = -1;
    wrap.append(heading);
    wrap.append(el("p", "review-summary__intro", state.firstTry === state.items.length ?
      "Every concept came back cleanly on the first attempt. The mastery scheduler will give those ideas more space before they return." :
      "You strengthened the concepts that needed another pass. Their next review timing now reflects today’s answers and hint use."));

    const stats = el("div", "review-summary__stats");
    const values = [
      [state.solved, "Concepts reviewed"],
      [state.firstTry, "First-try recall"],
      [state.hintedItems.size, "Hints opened"],
    ];
    values.forEach(([value, label]) => {
      const card = el("div", "review-summary__stat");
      card.append(el("strong", "", value), el("span", "", label));
      stats.append(card);
    });
    wrap.append(stats);
    wrap.append(el("p", "review-summary__note", `${state.totalAttempts} answer attempt${state.totalAttempts === 1 ? "" : "s"} saved. Course points were not changed; this session only updates mastery timing.`));

    const actions = el("div", "review-summary__actions");
    const more = el("button", "btn btn--gold", "Review more concepts");
    more.type = "button";
    more.addEventListener("click", () => { void startSession(); });
    const academy = el("a", "btn btn--ghost", "Return to the academy");
    academy.href = "/lab/";
    actions.append(more, academy);
    wrap.append(actions);
    revealLive(wrap);
    heading.focus({ preventScroll: true });
  }

  function dependenciesReady() {
    return !!(window.IEWTStorage && typeof window.IEWTStorage.mastery === "function" &&
      typeof window.IEWTStorage.progress === "function" && window.MasteryScheduler &&
      typeof window.MasteryScheduler.selectSession === "function" &&
      typeof window.MasteryScheduler.apply === "function" && window.Auth &&
      typeof window.Auth.recordMasteryAttempt === "function");
  }

  async function startSession() {
    const generation = ++startGeneration;
    const app = byId("reviewApp");
    if (app) app.setAttribute("aria-busy", "true");

    try {
      if (!dependenciesReady()) throw new Error("review-dependencies-unavailable");
      const authReady = typeof window.Auth.whenReady === "function" ? window.Auth.whenReady() : Promise.resolve();
      const [bank] = await Promise.all([loadBank(), authReady]);
      if (generation !== startGeneration) return;

      const mastery = readMastery();
      const progress = readProgress();
      const today = localDay();
      const selected = window.MasteryScheduler.selectSession(bank, mastery, progress, today, 5);
      const eligible = Array.isArray(selected) ? selected.filter(validItem).slice(0, 5) : [];
      if (!eligible.length) {
        state = null;
        renderEmpty(progress);
        return;
      }

      state = {
        bank,
        mastery,
        progress,
        today,
        items: eligible,
        index: 0,
        solved: 0,
        firstTry: 0,
        totalAttempts: 0,
        attemptsByItem: new Map(),
        hintedItems: new Set(),
        sessionKey: attemptId().replace(/[^a-z0-9-]/gi, "").slice(0, 36),
      };
      renderSession();
    } catch {
      if (generation !== startGeneration) return;
      setFallbackError("Today’s review could not be prepared. Your course progress is unchanged; refresh to try again.");
    }
  }

  function init() {
    if (initialized || !byId("reviewApp")) return;
    initialized = true;
    document.addEventListener("iewt:auth-state", refreshSaveMode);
    document.addEventListener("iewt:synced", refreshSaveMode);
    document.addEventListener("iewt:owner-changed", () => { void startSession(); });
    document.addEventListener("iewt:progress-reset", () => { void startSession(); });
    void startSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
  // Deferred scripts execute after their markup is parsed. Starting here also
  // avoids waiting behind an unrelated third-party deferred script in Safari.
  init();
})();
