/* =============================================================
   lab-ui.js — renders the Lab home grid and the lesson pages from
   window.LESSONS, tracks on-device progress, and wires the IDE.
   ============================================================= */
(() => {
  "use strict";
  const LESSONS = window.LESSONS || [];
  const ROADMAP = window.ROADMAP || [];
  const byId = (id) => LESSONS.find((l) => l.id === id);
  const codeSteps = (lesson) => lesson.steps.filter((s) => s.type === "code");

  // ---- On-device progress -------------------------------------
  const PKEY = "iewt:progress";
  const Progress = {
    all() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } },
    done(id) { return (this.all()[id] || {}).done || []; },
    mark(id, stepId) {
      const a = this.all();
      const d = (a[id] && a[id].done) || [];
      if (!d.includes(stepId)) d.push(stepId);
      a[id] = { done: d };
      localStorage.setItem(PKEY, JSON.stringify(a));
    },
    pct(lesson) {
      const total = codeSteps(lesson).length;
      if (!total) return 0;
      const have = this.done(lesson.id).filter((s) => codeSteps(lesson).some((c) => c.id === s)).length;
      return Math.round((100 * Math.min(have, total)) / total);
    },
  };

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  // ============== LAB HOME =====================================
  function renderHome(grid) {
    // Account strip
    const acc = document.getElementById("account");
    if (acc) {
      acc.innerHTML =
        '<span class="account__txt">Your progress is saved <b>privately on this device</b>. ' +
        "Sign-in with Google (to sync across devices) is coming soon.</span>";
      const btn = el("button", "btn btn--ghost");
      btn.type = "button";
      btn.textContent = "Sign in";
      btn.addEventListener("click", () => window.Auth.signIn());
      acc.appendChild(btn);
    }

    LESSONS.forEach((lesson) => {
      const pct = Progress.pct(lesson);
      const cta = pct === 0 ? "Start" : pct === 100 ? "Review" : "Continue";
      const card = el("a", "model-card");
      card.href = "/lab/lesson.html?m=" + encodeURIComponent(lesson.id);
      card.innerHTML =
        '<div class="model-card__top">' +
          '<span class="model-card__badge">' + lesson.level + "</span>" +
          '<span class="model-card__num">' + lesson.num + "</span>" +
        "</div>" +
        "<h3>" + lesson.title + "</h3>" +
        "<p>" + lesson.blurb + "</p>" +
        '<div class="model-card__foot">' +
          '<div class="progress"><div class="progress__bar" style="width:' + pct + '%"></div></div>' +
          '<span class="progress-label">' + pct + "%</span>" +
        "</div>" +
        '<div class="model-card__foot"><span class="model-card__cta">' + cta + " &rarr;</span></div>";
      grid.appendChild(card);
    });

    ROADMAP.forEach((m) => {
      const card = el("div", "model-card");
      card.setAttribute("aria-disabled", "true");
      card.innerHTML =
        '<div class="model-card__top"><span class="model-card__badge">' + m.badge + "</span></div>" +
        "<h3>" + m.title + "</h3><p>" + m.blurb + "</p>" +
        '<div class="model-card__foot"><span class="model-card__cta">In&nbsp;preparation</span></div>';
      grid.appendChild(card);
    });
  }

  // ============== LESSON PAGE ==================================
  function renderLesson(root) {
    const id = new URLSearchParams(location.search).get("m");
    const lesson = byId(id);
    if (!lesson) {
      root.innerHTML =
        '<div class="lesson-head"><a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a>' +
        "<h1>Lesson not found</h1><p>Pick a model from the Lab.</p></div>";
      return;
    }
    document.title = lesson.title + " — Econometrics Lab";

    const head = el("div", "lesson-head");
    head.innerHTML =
      '<a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a>' +
      "<h1>" + lesson.title + "</h1>" +
      '<div class="lesson-head__meta"><span>' + lesson.level + "</span><span>" +
      lesson.tags.map((t) => "#" + t).join(" ") + "</span></div>";
    root.appendChild(head);

    const total = codeSteps(lesson).length;
    const progWrap = el("div", "lesson-progress");
    progWrap.innerHTML =
      '<div class="progress"><div class="progress__bar" id="lpBar"></div></div>' +
      '<span class="progress-label" id="lpLabel"></span>';
    root.appendChild(progWrap);

    const updateProg = () => {
      const pct = Progress.pct(lesson);
      document.getElementById("lpBar").style.width = pct + "%";
      document.getElementById("lpLabel").textContent = pct + "% complete";
      if (pct === 100) window.toast("Lesson complete — nicely done. ✓");
    };

    lesson.steps.forEach((step) => {
      if (step.type === "read") {
        root.appendChild(el("section", "step step--read", step.html));
      } else {
        const wrap = el("section", "step step--code");
        const cell = window.Lab.makeCell({
          code: step.code,
          title: step.title || "python",
          onRun: () => { Progress.mark(lesson.id, step.id); updateProg(); },
        });
        wrap.appendChild(cell.el);
        root.appendChild(wrap);
      }
    });

    // Free Python scratchpad
    root.appendChild(el("section", "step step--read",
      "<h2>Python scratchpad</h2><p>The same engine, yours to experiment with. " +
      "<code>numpy</code>, <code>pandas</code>, <code>scipy</code>, " +
      "<code>statsmodels</code> and <code>matplotlib</code> are all loaded.</p>"));
    const scratch = el("section", "step step--code");
    scratch.appendChild(window.Lab.makeCell({
      title: "scratchpad.py",
      code: "import statsmodels.api as sm\nimport numpy as np\n\n# Try anything. Press Ctrl/Cmd+Enter to run.\nprint(sm.__version__)\n",
    }).el);
    root.appendChild(scratch);

    root.appendChild(el("p", "lab-foot",
      "Computed live in your browser with Pyodide + statsmodels — real estimation, nothing sent to a server."));

    updateProg();
  }

  // ---- Boot ---------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const grid = document.getElementById("labGrid");
    const lessonRoot = document.getElementById("lessonRoot");
    if (grid) renderHome(grid);
    if (lessonRoot) renderLesson(lessonRoot);
  });
})();
