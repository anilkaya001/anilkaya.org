/* =============================================================
   lab-course.js — staged, horizontal course player.
   Reads CURRICULUM[?m], flattens modules→stages, and shows ONE
   stage at a time: a left module navigator, instructions on the
   left, the live workspace on the right, Prev/Next (+ arrow keys).
   ============================================================= */
(() => {
  "use strict";

  const root = document.getElementById("course");
  if (!root) return;
  const topic = (window.CURRICULUM || {})[new URLSearchParams(location.search).get("m")];

  if (!topic) {
    root.innerHTML =
      '<div class="course-empty"><a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a>' +
      "<h1>This module is being finalized</h1><p>It'll appear here shortly. Meanwhile, explore the other topics.</p></div>";
    return;
  }
  document.title = topic.title + " — Econometrics Lab";

  // ---- Flatten modules → stages -------------------------------
  const stages = [];
  topic.modules.forEach((m, mi) => m.stages.forEach((s, si) =>
    stages.push({ ...s, mi, si, mTitle: m.title, mId: m.id, first: si === 0 })));
  const N = stages.length;

  // ---- Progress (on-device) -----------------------------------
  const PKEY = "iewt:progress";
  const all = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } };
  const doneSet = () => new Set((all()[topic.id] || {}).done || []);
  function mark(i) {
    const a = all(); const d = new Set((a[topic.id] || {}).done || []);
    if (d.has(i)) return;
    d.add(i); a[topic.id] = { done: [...d] };
    localStorage.setItem(PKEY, JSON.stringify(a));
    paintProgress();
  }
  const pct = () => Math.round((100 * doneSet().size) / N);

  const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

  // ---- Shell --------------------------------------------------
  root.innerHTML =
    '<aside class="course-nav" id="cNav"></aside>' +
    '<section class="course-main">' +
      '<div class="course-head">' +
        '<a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a>' +
        "<h1>" + esc(topic.title) + "</h1>" +
        '<div class="course-progress"><div class="progress"><div class="progress__bar" id="cBar"></div></div>' +
        '<span class="progress-label" id="cPctL"></span></div>' +
      "</div>" +
      '<div class="stage" id="cStage"></div>' +
      '<div class="course-foot">' +
        '<button class="btn btn--ghost" id="cPrev" type="button">&larr; Back</button>' +
        '<span class="course-foot__pos" id="cPos"></span>' +
        '<button class="btn btn--gold" id="cNext" type="button">Next &rarr;</button>' +
      "</div>" +
    "</section>";

  const navEl = root.querySelector("#cNav");
  const stageEl = root.querySelector("#cStage");
  const prevBtn = root.querySelector("#cPrev");
  const nextBtn = root.querySelector("#cNext");

  function paintProgress() {
    root.querySelector("#cBar").style.width = pct() + "%";
    root.querySelector("#cPctL").textContent = pct() + "%";
    // refresh nav checkmarks
    const done = doneSet();
    navEl.querySelectorAll(".course-nav__mod").forEach((node) => {
      const mi = +node.dataset.mi;
      const idxs = stages.map((s, i) => (s.mi === mi ? i : -1)).filter((i) => i >= 0);
      const got = idxs.filter((i) => done.has(i)).length;
      node.querySelector(".course-nav__count").textContent = got + "/" + idxs.length;
      node.classList.toggle("is-done", got === idxs.length);
    });
  }

  function renderNav(current) {
    navEl.innerHTML = '<div class="course-nav__title">Modules</div>';
    topic.modules.forEach((m, mi) => {
      const firstIdx = stages.findIndex((s) => s.mi === mi);
      const node = el("button", "course-nav__mod");
      node.type = "button"; node.dataset.mi = mi;
      node.innerHTML = '<span class="course-nav__name">' + esc(m.title) + "</span>" +
        '<span class="course-nav__count"></span>';
      if (mi === stages[current].mi) node.classList.add("is-current");
      node.addEventListener("click", () => go(firstIdx));
      navEl.appendChild(node);
    });
    paintProgress();
  }

  // ---- Stage renderers ----------------------------------------
  function guideHTML(st) {
    if (st.type === "read") return st.html || "";
    if (st.type === "quiz") return "<h3>" + esc(st.title || "Question") + '</h3><p class="quiz__prompt">' + st.prompt + "</p>";
    return "<h3>" + esc(st.title || "") + "</h3>" + (st.note ? "<p>" + st.note + "</p>" : "");
  }

  function buildWork(st, i) {
    if (st.type === "code") {
      return window.Lab.makeCell({ code: st.code, title: (st.title || "python").toLowerCase().replace(/\s+/g, "_") + ".py", onRun: () => mark(i) }).el;
    }
    if (st.type === "interactive") return buildInteractive(st, i);
    if (st.type === "quiz") return buildQuiz(st, i);
    return null;
  }

  function buildInteractive(st, i) {
    const cell = el("div", "cell cell--interactive");
    const params = {}; st.params.forEach((p) => (params[p.name] = p.value));
    const bar = el("div", "cell__bar");
    bar.innerHTML = '<span class="cell__dot"></span><span class="cell__title">interactive</span><button class="cell__run" type="button">▶ Launch</button>';
    const body = el("div", "interactive");
    const controls = el("div", "interactive__controls");
    const out = el("div", "cell__out"); const figs = el("div", "cell__figs");
    const output = el("div", "interactive__output"); output.append(figs, out);
    st.params.forEach((p) => {
      const row = el("label", "control");
      row.innerHTML = '<span class="control__label">' + esc(p.label) + ' <b class="control__val"></b></span>' +
        '<input class="control__range" type="range" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" value="' + p.value + '">';
      const range = row.querySelector(".control__range"), val = row.querySelector(".control__val");
      val.textContent = p.value;
      range.addEventListener("input", () => { params[p.name] = parseFloat(range.value); val.textContent = range.value; schedule(); });
      controls.appendChild(row);
    });
    body.append(controls, output); cell.append(bar, body);
    const runBtn = bar.querySelector(".cell__run");
    let launched = false, running = false, pending = false;
    const render = () => st.template.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k]);
    async function exec() {
      running = true;
      const ok = await window.Lab.run(render(), { out, figs });
      running = false;
      if (ok && !launched) { launched = true; runBtn.textContent = "↻ Re-run"; mark(i); }
      if (pending) { pending = false; exec(); }
    }
    function schedule() { if (!launched) return; if (running) { pending = true; return; } clearTimeout(schedule._t); schedule._t = setTimeout(exec, 180); }
    runBtn.addEventListener("click", () => { if (!running) exec(); });
    return cell;
  }

  function buildQuiz(st, i) {
    const quiz = el("div", "quiz");
    const name = "q_" + topic.id + "_" + i;
    quiz.innerHTML =
      '<div class="quiz__choices">' +
      st.choices.map((c, k) => '<label class="quiz__choice"><input type="radio" name="' + name + '" value="' + k + '"><span>' + esc(c) + "</span></label>").join("") +
      "</div>" +
      '<div class="quiz__actions"><button class="quiz__hint btn btn--ghost" type="button">Hint</button><button class="quiz__check btn btn--gold" type="button">Check</button></div>' +
      '<div class="quiz__feedback" role="status"></div>';
    const fb = quiz.querySelector(".quiz__feedback");
    quiz.querySelector(".quiz__hint").addEventListener("click", () => { fb.className = "quiz__feedback hint"; fb.textContent = "Hint: " + st.hint; });
    quiz.querySelector(".quiz__check").addEventListener("click", () => {
      const sel = quiz.querySelector('input[name="' + name + '"]:checked');
      if (!sel) { fb.className = "quiz__feedback hint"; fb.textContent = "Pick an answer first."; return; }
      if (+sel.value === st.answer) { fb.className = "quiz__feedback ok"; fb.textContent = "Correct. " + st.explain; mark(i); }
      else { fb.className = "quiz__feedback err"; fb.textContent = "Not quite — try again, or tap Hint."; }
    });
    return quiz;
  }

  // ---- Render one stage ---------------------------------------
  let cur = 0;
  function render(i) {
    cur = i;
    const st = stages[i];
    const work = (st.type !== "read") ? buildWork(st, i) : null;

    stageEl.innerHTML = "";
    const kicker = el("div", "stage__kicker", esc(st.mTitle) + " &middot; step " + (st.si + 1));
    stageEl.appendChild(kicker);

    const body = el("div", work ? "stage__split" : "stage__solo");
    const guide = el("div", "stage__guide step--read", guideHTML(st));
    body.appendChild(guide);
    if (work) { const w = el("div", "stage__work"); w.appendChild(work); body.appendChild(w); }
    stageEl.appendChild(body);

    if (st.type === "read") mark(i);          // reading a page completes it

    prevBtn.disabled = i === 0;
    nextBtn.textContent = i === N - 1 ? "Finish ✓" : "Next →";
    root.querySelector("#cPos").textContent = (i + 1) + " / " + N;
    renderNav(i);
  }

  function go(i) {
    if (i < 0 || i >= N) {
      if (i >= N) { if (window.toast) window.toast("Topic complete — superb work. ✓"); location.href = "/lab/"; }
      return;
    }
    history.replaceState(null, "", "#s" + i);
    render(i);
    stageEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  prevBtn.addEventListener("click", () => go(cur - 1));
  nextBtn.addEventListener("click", () => go(cur + 1));
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowRight") go(cur + 1);
    if (e.key === "ArrowLeft") go(cur - 1);
  });

  const start = Math.max(0, Math.min(N - 1, parseInt((location.hash.match(/^#s(\d+)/) || [])[1], 10) || 0));
  render(start);
})();
