/* =============================================================
   lab-ui.js — renders the Lab home grid and lesson pages.
   Handles read / code / interactive / quiz steps, tracks on-device
   progress (and pushes to the backend when signed in via auth.js).
   ============================================================= */
(() => {
  "use strict";
  const LESSONS = window.LESSONS || [];
  const ROADMAP = window.ROADMAP || [];
  const byId = (id) => LESSONS.find((l) => l.id === id);
  const TRACKED = new Set(["code", "interactive", "quiz"]);
  const tracked = (lesson) => lesson.steps.filter((s) => TRACKED.has(s.type) && s.id);

  // ---- Progress (on-device, with optional backend push) -------
  const PKEY = "iewt:progress";
  const Progress = {
    all() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } },
    done(id) { return (this.all()[id] || {}).done || []; },
    mark(id, stepId) {
      const a = this.all();
      const d = (a[id] && a[id].done) || [];
      if (d.includes(stepId)) return;
      d.push(stepId);
      a[id] = { done: d };
      localStorage.setItem(PKEY, JSON.stringify(a));
      if (window.Auth && typeof window.Auth.pushProgress === "function") {
        window.Auth.pushProgress(id, d);
      }
    },
    pct(lesson) {
      const all = tracked(lesson);
      if (!all.length) return 0;
      const ids = new Set(all.map((s) => s.id));
      const have = this.done(lesson.id).filter((s) => ids.has(s)).length;
      return Math.round((100 * Math.min(have, all.length)) / all.length);
    },
  };
  window.Progress = Progress; // let auth.js merge remote state in

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  // ============== LAB HOME =====================================
  function renderAccount() {
    const acc = document.getElementById("account");
    if (!acc) return;
    const signedIn = window.Auth && window.Auth.isSignedIn();
    const txt = signedIn
      ? "Signed in as <b>" + (window.Auth.user().name || window.Auth.user().email) + "</b> — progress syncs across your devices."
      : "Progress is saved <b>privately on this device</b>. Sign in with Google to sync across devices.";
    acc.innerHTML = '<span class="account__txt">' + txt + "</span>";
    const btn = el("button", "btn btn--ghost");
    btn.type = "button";
    btn.textContent = signedIn ? "Sign out" : "Sign in";
    btn.addEventListener("click", () => (signedIn ? window.Auth.signOut() : window.Auth.signIn()));
    acc.appendChild(btn);
  }

  function renderGrid(grid) {
    grid.innerHTML = "";
    LESSONS.forEach((lesson) => {
      const pct = Progress.pct(lesson);
      const cta = pct === 0 ? "Start" : pct === 100 ? "Review" : "Continue";
      const card = el("a", "model-card reveal");
      card.href = "/lab/lesson.html?m=" + encodeURIComponent(lesson.id);
      card.innerHTML =
        '<div class="model-card__top"><span class="model-card__badge">' + lesson.level +
        '</span><span class="model-card__num">' + lesson.num + "</span></div>" +
        "<h3>" + lesson.title + "</h3><p>" + lesson.blurb + "</p>" +
        '<div class="model-card__foot"><div class="progress"><div class="progress__bar" style="width:' +
        pct + '%"></div></div><span class="progress-label">' + pct + "%</span></div>" +
        '<div class="model-card__foot"><span class="model-card__cta">' + cta + " &rarr;</span></div>";
      grid.appendChild(card);
    });
    ROADMAP.forEach((m) => {
      const card = el("div", "model-card reveal");
      card.setAttribute("aria-disabled", "true");
      card.innerHTML =
        '<div class="model-card__top"><span class="model-card__badge">' + m.badge + "</span></div>" +
        "<h3>" + m.title + "</h3><p>" + m.blurb + "</p>" +
        '<div class="model-card__foot"><span class="model-card__cta">In&nbsp;preparation</span></div>';
      grid.appendChild(card);
    });
    revealCards(grid);
  }

  // Stagger the cards in with a depth tilt as they enter the viewport.
  function revealCards(grid) {
    const cards = Array.from(grid.querySelectorAll(".reveal"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      cards.forEach((c) => c.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const i = cards.indexOf(e.target);
        e.target.style.transitionDelay = Math.min(i, 8) * 65 + "ms";
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });
    cards.forEach((c) => io.observe(c));
    // Safety net: never leave a card hidden if the observer doesn't fire.
    setTimeout(() => cards.forEach((c) => c.classList.add("in")), 4000);
  }

  // ============== LESSON PAGE ==================================
  function renderLesson(root) {
    const id = new URLSearchParams(location.search).get("m");
    const lesson = byId(id);
    if (!lesson) {
      root.innerHTML = '<div class="lesson-head"><a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a><h1>Lesson not found</h1></div>';
      return;
    }
    document.title = lesson.title + " — Econometrics Lab";

    const head = el("div", "lesson-head");
    head.innerHTML =
      '<a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a><h1>' + lesson.title + "</h1>" +
      '<div class="lesson-head__meta"><span>' + lesson.level + "</span><span>" +
      lesson.tags.map((t) => "#" + t).join(" ") + "</span></div>";
    root.appendChild(head);

    const progWrap = el("div", "lesson-progress",
      '<div class="progress"><div class="progress__bar" id="lpBar"></div></div><span class="progress-label" id="lpLabel"></span>');
    root.appendChild(progWrap);

    const updateProg = () => {
      const pct = Progress.pct(lesson);
      document.getElementById("lpBar").style.width = pct + "%";
      document.getElementById("lpLabel").textContent = pct + "% complete";
      if (pct === 100) window.toast("Lesson complete — nicely done. ✓");
    };
    const mark = (stepId) => { Progress.mark(lesson.id, stepId); updateProg(); };

    lesson.steps.forEach((step) => {
      if (step.type === "read") root.appendChild(el("section", "step step--read", step.html));
      else if (step.type === "code") root.appendChild(renderCode(step, mark));
      else if (step.type === "interactive") root.appendChild(renderInteractive(step, mark));
      else if (step.type === "quiz") root.appendChild(renderQuiz(step, mark));
    });

    // Free scratchpad
    root.appendChild(el("section", "step step--read",
      "<h2>Python scratchpad</h2><p>The same engine, yours to experiment with — " +
      "<code>numpy</code>, <code>pandas</code>, <code>scipy</code>, <code>statsmodels</code> and <code>matplotlib</code> are loaded.</p>"));
    const scratch = el("section", "step");
    scratch.appendChild(window.Lab.makeCell({
      title: "scratchpad.py",
      code: "import statsmodels.api as sm, numpy as np\n\n# Ctrl/Cmd+Enter to run.\nprint('statsmodels', sm.__version__)\n",
    }).el);
    root.appendChild(scratch);

    root.appendChild(el("p", "lab-foot", "Computed live in your browser with Pyodide + statsmodels — real estimation, nothing sent to a server."));
    updateProg();
  }

  function renderCode(step, mark) {
    const wrap = el("section", "step");
    const cell = window.Lab.makeCell({ code: step.code, title: step.title || "python", onRun: () => mark(step.id) });
    wrap.appendChild(cell.el);
    return wrap;
  }

  // ---- Interactive widget (sliders -> live re-run) ------------
  function renderInteractive(step, mark) {
    const wrap = el("section", "step");
    const cell = el("div", "cell cell--interactive");
    const params = {};
    step.params.forEach((p) => (params[p.name] = p.value));

    const bar = el("div", "cell__bar");
    bar.innerHTML = '<span class="cell__dot"></span><span class="cell__title"></span><button class="cell__run" type="button">▶ Launch</button>';
    bar.querySelector(".cell__title").textContent = step.title || "interactive";

    const body = el("div", "interactive");
    const controls = el("div", "interactive__controls");
    const output = el("div", "interactive__output");
    const out = el("div", "cell__out");
    const figs = el("div", "cell__figs");
    output.append(figs, out);

    step.params.forEach((p) => {
      const row = el("label", "control");
      row.innerHTML =
        '<span class="control__label">' + p.label + ' <b class="control__val"></b></span>' +
        '<input class="control__range" type="range" min="' + p.min + '" max="' + p.max +
        '" step="' + p.step + '" value="' + p.value + '">';
      const range = row.querySelector(".control__range");
      const val = row.querySelector(".control__val");
      val.textContent = p.value;
      range.addEventListener("input", () => {
        params[p.name] = parseFloat(range.value);
        val.textContent = range.value;
        schedule();
      });
      controls.appendChild(row);
    });

    body.append(controls, output);
    cell.append(bar, body);
    wrap.appendChild(cell);

    const runBtn = bar.querySelector(".cell__run");
    let launched = false, running = false, pending = false;

    async function exec() {
      running = true;
      const ok = await window.Lab.run(step.code(params), { out, figs });
      running = false;
      if (ok && !launched) { launched = true; runBtn.textContent = "↻ Re-run"; mark(step.id); }
      if (pending) { pending = false; exec(); }
    }
    function schedule() {
      if (!launched) return;        // sliders are live only after launch
      if (running) { pending = true; return; }
      clearTimeout(schedule._t);
      schedule._t = setTimeout(exec, 180);
    }
    runBtn.addEventListener("click", () => { if (!running) exec(); });

    return wrap;
  }

  // ---- Quiz with hint ----------------------------------------
  function renderQuiz(step, mark) {
    const wrap = el("section", "step");
    const quiz = el("div", "quiz");
    const name = "q_" + step.id;
    const choices = step.choices.map((c, i) =>
      '<label class="quiz__choice"><input type="radio" name="' + name + '" value="' + i + '"><span>' + c + "</span></label>"
    ).join("");
    quiz.innerHTML =
      '<p class="quiz__prompt">' + step.prompt + "</p>" +
      '<div class="quiz__choices">' + choices + "</div>" +
      '<div class="quiz__actions"><button class="quiz__hint btn btn--ghost" type="button">Hint</button>' +
      '<button class="quiz__check btn btn--gold" type="button">Check</button></div>' +
      '<div class="quiz__feedback" role="status"></div>';
    wrap.appendChild(quiz);

    const fb = quiz.querySelector(".quiz__feedback");
    quiz.querySelector(".quiz__hint").addEventListener("click", () => {
      fb.className = "quiz__feedback hint"; fb.textContent = "Hint: " + step.hint;
    });
    quiz.querySelector(".quiz__check").addEventListener("click", () => {
      const sel = quiz.querySelector('input[name="' + name + '"]:checked');
      if (!sel) { fb.className = "quiz__feedback hint"; fb.textContent = "Pick an answer first."; return; }
      if (parseInt(sel.value, 10) === step.answer) {
        fb.className = "quiz__feedback ok"; fb.textContent = "Correct. " + step.explain;
        mark(step.id);
      } else {
        fb.className = "quiz__feedback err"; fb.textContent = "Not quite — try again, or tap Hint.";
      }
    });
    return wrap;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const grid = document.getElementById("labGrid");
    const lessonRoot = document.getElementById("lessonRoot");
    if (grid) { renderAccount(); renderGrid(grid); }
    if (lessonRoot) renderLesson(lessonRoot);

    // Refresh when the backend reports auth state / syncs progress.
    document.addEventListener("iewt:auth-ready", renderAccount);
    document.addEventListener("iewt:progress-synced", () => { if (grid) renderGrid(grid); });
  });
})();
