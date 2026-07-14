/* =============================================================
   lab-ui.js — learner dashboard, pathways, catalogue, and reset UI.
   All learner state flows through IEWTStorage/Auth; no raw storage access.
   ============================================================= */
(() => {
  "use strict";

  const META = window.TOPIC_META || [];
  const PATHS = window.LEARNING_PATHS || [];
  const byId = window.TOPIC_BY_ID || Object.fromEntries(META.map((topic) => [topic.id, topic]));
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const store = () => window.IEWTStorage;
  const progress = () => store().progress();

  function courseState(topic, snapshot = progress()) {
    const source = ((snapshot[topic.id] || {}).done || []);
    const done = [...new Set(source.filter((index) => Number.isInteger(index) && index >= 0 && index < topic.stages))].sort((a, b) => a - b);
    const firstOpen = Array.from({ length: topic.stages }, (_, index) => index).find((index) => !done.includes(index));
    const percent = topic.stages ? Math.round((100 * done.length) / topic.stages) : 0;
    return {
      done,
      firstOpen: firstOpen == null ? 0 : firstOpen,
      percent,
      status: done.length === 0 ? "not-started" : done.length >= topic.stages ? "completed" : "in-progress",
    };
  }

  function hrefFor(topic, index = 0) {
    return `/lab/${encodeURIComponent(topic.slug)}/${index > 0 ? `#s${index}` : ""}`;
  }

  function progressHTML(percent, label) {
    return '<div class="progress" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '">' +
      '<div class="progress__bar" style="width:' + percent + '%"></div></div>';
  }

  function renderAccount() {
    const container = document.getElementById("account");
    if (!container) return;
    const auth = window.Auth;
    const status = auth && typeof auth.status === "function" ? auth.status() : "checking";
    const signedIn = !!(auth && auth.isSignedIn());
    const user = signedIn ? auth.user() : null;
    const busy = ["checking", "syncing", "resetting", "signing-out"].includes(status);
    const identity = user && (user.name || user.email);

    let note;
    if (status === "checking") note = "Checking your account and saved progress…";
    else if (status === "syncing") note = "Synchronizing your latest learning state…";
    else if (status === "resetting") note = "Resetting your learning state securely…";
    else if (status === "signing-out") note = "Signing out securely…";
    else if (signedIn) note = "Signed in as <b>" + esc(identity || "you") + "</b> — progress syncs across your devices.";
    else if (status === "offline") note = "Learning offline — progress is safely stored on this device.";
    else note = "Progress is saved on this device. Sign in when you want secure cross-device sync.";

    container.className = "account" + (busy ? " account--loading" : "");
    container.innerHTML = '<span class="account__txt">' + note + '</span><span class="account__right">' +
      '<span class="gamify" data-gamify></span>' +
      '<button class="btn btn--quiet" id="resetProgressBtn" type="button"' + (busy ? " disabled" : "") + '>Reset progress</button>' +
      '<button class="btn btn--ghost" id="authBtn" type="button"' + (busy ? " disabled" : "") + '>' + (signedIn ? "Sign out" : "Sign in") + "</button></span>";

    container.querySelector("#authBtn").addEventListener("click", () => (signedIn ? auth.signOut() : auth.signIn()));
    container.querySelector("#resetProgressBtn").addEventListener("click", openResetDialog);
    if (window.Gamify) window.Gamify.paint();
  }

  function renderDashboard() {
    const section = document.getElementById("academyDashboard");
    const grid = document.getElementById("dashboardGrid");
    if (!section || !grid) return;
    const snapshot = progress();
    const states = META.map((topic) => ({ topic, ...courseState(topic, snapshot) }));
    const totalLessons = META.reduce((sum, topic) => sum + topic.stages, 0);
    const completedLessons = states.reduce((sum, state) => sum + state.done.length, 0);
    const completeCourses = states.filter((state) => state.status === "completed").length;
    const active = states.find((state) => state.status === "in-progress") || states.find((state) => state.status === "not-started") || states[0];
    const overall = totalLessons ? Math.round((100 * completedLessons) / totalLessons) : 0;
    const gamify = window.Gamify ? window.Gamify.get() : { points: 0, streak: 0 };
    const resumeLabel = active.status === "not-started" ? "Start the foundations" : active.status === "completed" ? "Review any course" : "Resume where you stopped";

    grid.innerHTML =
      '<article class="dashboard-resume"><p class="academy-kicker">' + resumeLabel + '</p><h3>' + esc(active.topic.title) + '</h3>' +
        '<p>' + active.done.length + " of " + active.topic.stages + " lessons complete · next: lesson " + (active.firstOpen + 1) + "</p>" +
        '<div class="dashboard-resume__progress">' + progressHTML(active.percent, active.topic.title + " completion") + '<span>' + active.percent + "%</span></div>" +
        '<a class="btn btn--gold" href="' + hrefFor(active.topic, active.firstOpen) + '">' + (active.status === "not-started" ? "Begin course" : "Continue learning") + " &rarr;</a></article>" +
      '<div class="dashboard-metrics">' +
        '<article><span class="dashboard-metric__value">' + completedLessons + '</span><span class="dashboard-metric__label">Lessons completed</span><small>of ' + totalLessons + "</small></article>" +
        '<article><span class="dashboard-metric__value">' + completeCourses + '</span><span class="dashboard-metric__label">Courses complete</span><small>of ' + META.length + "</small></article>" +
        '<article><span class="dashboard-metric__value">' + Number(gamify.points || 0).toLocaleString() + '</span><span class="dashboard-metric__label">Knowledge points</span><small>' + Number(gamify.streak || 0) + " day streak</small></article>" +
        '<article class="dashboard-overall"><span class="dashboard-metric__value">' + overall + '%</span><span class="dashboard-metric__label">Core curriculum</span>' + progressHTML(overall, "Core curriculum completion") + "</article>" +
      "</div>";
    section.setAttribute("aria-busy", "false");
    const summary = document.getElementById("dashboardSummary");
    if (summary) summary.textContent = completedLessons
      ? `${completedLessons} lessons completed across ${states.filter((state) => state.done.length).length} courses.`
      : "Begin with OLS, or choose a path aligned to your goal.";
  }

  function renderPaths() {
    const root = document.getElementById("learningPaths");
    if (!root) return;
    const snapshot = progress();
    root.innerHTML = "";
    PATHS.forEach((path, index) => {
      const topics = path.courses.map((id) => byId[id]).filter(Boolean);
      const states = topics.map((topic) => ({ topic, ...courseState(topic, snapshot) }));
      const complete = states.filter((state) => state.status === "completed").length;
      const totalLessons = topics.reduce((sum, topic) => sum + topic.stages, 0);
      const completedLessons = states.reduce((sum, state) => sum + state.done.length, 0);
      const percent = totalLessons ? Math.round((100 * completedLessons) / totalLessons) : 0;
      const next = states.find((state) => state.status !== "completed") || states[0];
      const card = document.createElement("article");
      card.className = "path-card" + (index === 0 ? " path-card--featured" : "");
      card.innerHTML = '<div class="path-card__top"><div><p class="academy-kicker">' + esc(path.eyebrow) + '</p><h3>' + esc(path.title) + '</h3></div><span>' + complete + "/" + topics.length + " courses</span></div>" +
        '<p class="path-card__blurb">' + esc(path.blurb) + "</p>" +
        '<ol class="path-sequence" aria-label="' + esc(path.title) + ' course sequence">' + states.map((state, step) =>
          '<li data-state="' + state.status + '"><span aria-hidden="true">' + (state.status === "completed" ? "✓" : step + 1) + '</span><a href="' + hrefFor(state.topic, state.firstOpen) + '">' + esc(state.topic.shortTitle || state.topic.title) + "</a></li>").join("") + "</ol>" +
        '<div class="path-card__foot">' + progressHTML(percent, path.title + " path completion") + '<a href="' + hrefFor(next.topic, next.firstOpen) + '">' + (percent === 0 ? "Start path" : percent === 100 ? "Review path" : "Continue path") + " &rarr;</a></div>";
      root.appendChild(card);
    });
  }

  function renderGrid() {
    const grid = document.getElementById("labGrid");
    if (!grid) return;
    const query = (document.getElementById("courseSearch")?.value || "").trim().toLowerCase();
    const level = document.getElementById("levelFilter")?.value || "all";
    const status = document.getElementById("statusFilter")?.value || "all";
    const snapshot = progress();
    const visible = META.filter((topic) => {
      const state = courseState(topic, snapshot);
      const haystack = [topic.title, topic.shortTitle, topic.blurb, ...(topic.tags || []), ...(topic.outcomes || [])].join(" ").toLowerCase();
      return (!query || haystack.includes(query)) && (level === "all" || topic.level === level) && (status === "all" || state.status === status);
    });

    grid.innerHTML = "";
    visible.forEach((topic) => {
      const state = courseState(topic, snapshot);
      const cta = state.status === "not-started" ? "Start" : state.status === "completed" ? "Review" : "Continue";
      const card = document.createElement("a");
      card.className = "model-card";
      card.href = hrefFor(topic, state.firstOpen);
      card.dataset.status = state.status;
      card.innerHTML = '<div class="model-card__top"><span class="model-card__badge">' + esc(topic.level) + '</span><span class="model-card__num">' + esc(topic.num) + "</span></div>" +
        "<h3>" + esc(topic.title) + "</h3><p>" + esc(topic.blurb) + "</p>" +
        '<ul class="model-card__tags" aria-label="Topics">' + (topic.tags || []).slice(0, 3).map((tag) => "<li>" + esc(tag) + "</li>").join("") + "</ul>" +
        '<div class="model-card__foot">' + progressHTML(state.percent, topic.title + " completion") + '<span class="progress-label">' + state.percent + "%</span></div>" +
        '<div class="model-card__foot"><span class="model-card__cta">' + cta + ' &rarr;</span><span class="model-card__num">' + topic.stages + " lessons · " + topic.modules + " modules</span></div>";
      grid.appendChild(card);
    });

    const result = document.getElementById("courseResults");
    if (result) result.textContent = `${visible.length} ${visible.length === 1 ? "course" : "courses"}`;
    const empty = document.getElementById("courseEmptyState");
    if (empty) empty.hidden = visible.length !== 0;
  }

  function renderAll() {
    renderAccount();
    renderDashboard();
    renderPaths();
    renderGrid();
  }

  function openResetDialog() {
    const dialog = document.getElementById("resetDialog");
    if (!dialog || typeof dialog.showModal !== "function") return;
    const signedIn = !!(window.Auth && window.Auth.isSignedIn());
    dialog.querySelector("#resetScope").textContent = signedIn
      ? "Your synced account record and this device will both be reset. Local data is removed only after the server confirms success."
      : "Only progress on this device will be reset. Nothing is sent to a server.";
    dialog.querySelector("#resetStatus").textContent = "";
    dialog.querySelector("#resetConfirm").disabled = false;
    dialog.querySelector(".reset-cancel").disabled = false;
    delete dialog.dataset.resetBusy;
    dialog.setAttribute("aria-busy", "false");
    dialog.showModal();
    dialog.querySelector(".reset-cancel").focus();
  }

  async function confirmReset() {
    const dialog = document.getElementById("resetDialog");
    const confirm = dialog.querySelector("#resetConfirm");
    const cancel = dialog.querySelector(".reset-cancel");
    const status = dialog.querySelector("#resetStatus");
    dialog.dataset.resetBusy = "true";
    dialog.setAttribute("aria-busy", "true");
    confirm.disabled = true;
    cancel.disabled = true;
    status.className = "reset-dialog__status";
    status.textContent = window.Auth && window.Auth.isSignedIn() ? "Resetting your synced account securely…" : "Resetting progress on this device…";
    try {
      if (!window.Auth || typeof window.Auth.resetProgress !== "function") throw new Error("Reset is not ready. Refresh the page and try again.");
      await window.Auth.resetProgress();
      delete dialog.dataset.resetBusy;
      dialog.setAttribute("aria-busy", "false");
      dialog.close();
      renderAll();
      const dashboard = document.getElementById("dashboardTitle");
      if (dashboard) { dashboard.setAttribute("tabindex", "-1"); dashboard.focus(); }
    } catch (error) {
      delete dialog.dataset.resetBusy;
      dialog.setAttribute("aria-busy", "false");
      status.className = "reset-dialog__status reset-dialog__status--error";
      status.textContent = error && error.message ? error.message : "Progress could not be reset. Nothing was removed from this device.";
      confirm.disabled = false;
      cancel.disabled = false;
      cancel.focus();
    }
  }

  let renderFrame = 0;
  function scheduleRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; renderAll(); });
  }

  let initialized = false;
  function init() {
    if (initialized || !document.getElementById("account")) return;
    initialized = true;
    document.getElementById("courseSearch")?.addEventListener("input", renderGrid);
    document.getElementById("levelFilter")?.addEventListener("change", renderGrid);
    document.getElementById("statusFilter")?.addEventListener("change", renderGrid);
    document.getElementById("resetConfirm")?.addEventListener("click", confirmReset);
    document.getElementById("resetDialog")?.addEventListener("cancel", (event) => {
      if (event.currentTarget.dataset.resetBusy === "true") event.preventDefault();
    });
    renderAll();
    for (const eventName of ["iewt:auth-ready", "iewt:auth-state", "iewt:synced", "iewt:progress-reset", "iewt:owner-changed", "iewt:storage-reset"]) {
      document.addEventListener(eventName, scheduleRender);
    }
  }

  // This file is loaded with `defer`, so its DOM is parsed before execution.
  // Initialize now even when a browser still reports `loading`: Safari can keep
  // DOMContentLoaded pending behind an unrelated CSP-blocked deferred beacon.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
  init();
})();
