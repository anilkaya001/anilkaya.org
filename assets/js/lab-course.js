/* =============================================================
   lab-course.js — staged, horizontal course player.
   Resolves the course slug, flattens modules→stages, and shows ONE
   stage at a time: a left module navigator, instructions on the
   left, the live workspace on the right, Prev/Next (+ arrow keys).
   ============================================================= */
(async () => {
  "use strict";

  const root = document.getElementById("course");
  if (!root) return;
  const slug = location.pathname.split("/").filter(Boolean).pop();
  const queryId = new URLSearchParams(location.search).get("m");
  const meta = (window.TOPIC_META || []).find((item) => item.slug === slug || item.id === queryId);
  // Query fallback keeps the backing template usable in a plain static preview;
  // production permanently redirects every legacy ?m= URL to a clean slug.
  const topicId = meta && meta.id;
  if (!topicId) {
    root.innerHTML =
      '<div class="course-empty"><a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a>' +
      "<h1>Course not found</h1><p>Choose a verified course from the academy catalogue.</p></div>";
    return;
  }

  root.setAttribute("aria-busy", "true");
  root.innerHTML = '<div class="course-loading" role="status"><span class="course-loading__mark" aria-hidden="true">β</span><p>Loading the course workspace…</p></div>';
  let topic;
  let modular = false;
  try {
    const version = document.documentElement.dataset.assetVersion;
    let response = await fetch(`/assets/data/courses/${encodeURIComponent(topicId)}/manifest.json${version ? `?v=${encodeURIComponent(version)}` : ""}`, {
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      topic = await response.json();
      modular = true;
    } else {
      response = await fetch(`/assets/data/courses/${encodeURIComponent(topicId)}.json${version ? `?v=${encodeURIComponent(version)}` : ""}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`course-payload-${response.status}`);
      topic = await response.json();
    }
    if (!topic || ![1, 2].includes(topic.schemaVersion) || topic.id !== topicId || !Array.isArray(topic.modules) || !topic.modules.length ||
        topic.modules.some((module) => !module || !Array.isArray(module.stages))) throw new Error("invalid-course-payload");
  } catch {
    root.setAttribute("aria-busy", "false");
    root.innerHTML =
      '<div class="course-empty"><a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a>' +
      '<h1>The course could not load</h1><p>Your saved progress is safe. Check your connection and try again.</p>' +
      '<button class="btn btn--gold" id="courseRetry" type="button">Try again</button></div>';
    root.querySelector("#courseRetry").addEventListener("click", () => location.reload());
    return;
  }
  root.setAttribute("aria-busy", "false");
  document.title = topic.title + " — Econometrics Lab";

  // ---- Flatten modules → stages -------------------------------
  const stages = [];
  topic.modules.forEach((m, mi) => m.stages.forEach((s, si) =>
    stages.push({ ...s, mi, si, mTitle: m.title, mId: m.id, first: si === 0 })));
  const N = stages.length;
  const modulePromises = new Map();
  async function ensureModule(mi) {
    if (!modular || topic.modules[mi]._loaded) return;
    if (modulePromises.has(mi)) return modulePromises.get(mi);
    const promise = (async () => {
      const version = document.documentElement.dataset.assetVersion;
      const moduleId = topic.modules[mi].id;
      const response = await fetch(`/assets/data/courses/${encodeURIComponent(topicId)}/${encodeURIComponent(moduleId)}.json${version ? `?v=${encodeURIComponent(version)}` : ""}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`module-payload-${response.status}`);
      const payload = await response.json();
      if (!payload || payload.schemaVersion !== 2 || payload.courseId !== topicId || !payload.module || payload.module.id !== moduleId || !Array.isArray(payload.module.stages)) throw new Error("invalid-module-payload");
      const firstIndex = stages.findIndex((stage) => stage.mi === mi);
      payload.module.stages.forEach((stage, si) => { stages[firstIndex + si] = { ...stage, mi, si, mTitle: payload.module.title, mId: moduleId, first: si === 0 }; });
      topic.modules[mi] = { ...payload.module, _loaded: true };
    })();
    modulePromises.set(mi, promise);
    try { await promise; }
    finally { modulePromises.delete(mi); }
  }

  // ---- Progress (on-device) -----------------------------------
  const store = window.IEWTStorage;
  const DEFAULT_POINTS = Object.freeze({
    read: 5, code: 10, interactive: 10, conceptlab: 10, codechallenge: 20, case: 15, match: 15, quiz: 15,
    truefalse: 10, fillblank: 15, numeric: 20, multi: 20,
  });
  const all = () => store.progress();
  const doneSet = () => new Set((all()[topic.id] || {}).done || []);
  function mark(i, originEl) {
    const a = all(); const d = new Set((a[topic.id] || {}).done || []);
    if (d.has(i)) return;
    d.add(i); a[topic.id] = { done: [...d].sort((x, y) => x - y) };
    store.setProgress(a);
    paintProgress();
    const manifest = window.COURSE_STAGE_POINTS && window.COURSE_STAGE_POINTS[topic.id];
    const canonical = manifest && manifest[i];
    const authored = stages[i].points;
    const pts = Number.isSafeInteger(canonical) && canonical >= 0 ? canonical :
      Number.isSafeInteger(authored) && authored >= 0 ? authored : (DEFAULT_POINTS[stages[i].type] || 5);
    if (window.Gamify) window.Gamify.award(pts);
    const badge = root.querySelector("[data-gamify]");
    if (window.FX && window.FX.coin) window.FX.coin(originEl, badge, pts);
    else if (window.FX) window.FX.floatPoints(pts, badge);
    if (window.Auth && typeof window.Auth.pushProgress === "function") void window.Auth.pushProgress(topic.id, [...d]);
    if (stages[i].id && window.Auth && typeof window.Auth.pushStableProgress === "function") void window.Auth.pushStableProgress(topic.id, stages[i].id);
    // Module finished? quiet cheer. Whole topic? big one (also handled at Finish).
    const mi = stages[i].mi;
    const modIdxs = stages.map((s, k) => (s.mi === mi ? k : -1)).filter((k) => k >= 0);
    if (window.FX && modIdxs.every((k) => d.has(k))) window.FX.moduleDone(root.querySelector(".course-nav__mod.is-current"));
  }
  const pct = () => Math.max(0, Math.min(100, Math.round((100 * doneSet().size) / N)));

  const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
  const topicById = window.TOPIC_BY_ID || Object.fromEntries((window.TOPIC_META || []).map((item) => [item.id, item]));
  const prerequisites = (meta.prerequisites || []).map((id) => topicById[id]).filter(Boolean);
  const prerequisiteHTML = prerequisites.length
    ? prerequisites.map((item) => '<a href="/lab/' + encodeURIComponent(item.slug) + '/">' + esc(item.shortTitle || item.title) + "</a>").join(" · ")
    : "No prior econometrics course required";
  const outcomesHTML = (meta.outcomes || []).map((outcome) => "<li>" + esc(outcome) + "</li>").join("");
  const outlineHTML = topic.modules.map((module) => "<li><b>" + esc(module.title) + "</b><span>" + esc(module.summary || "") + "</span></li>").join("");

  // ---- Shell --------------------------------------------------
  root.innerHTML =
    '<aside class="course-nav" id="cNav"></aside>' +
    '<section class="course-main">' +
      '<div class="course-head">' +
        '<a class="lesson-head__back" href="/lab/">&larr; Econometrics Lab</a>' +
        '<div class="course-head__meta"><span class="model-card__badge">' + esc(meta.level) + '</span><span>' + N + " lessons · " + topic.modules.length + " modules</span></div>" +
        "<h1>" + esc(topic.title) + "</h1>" +
        '<div class="course-progress"><div class="progress" id="cProgress" role="progressbar" aria-label="Course completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress__bar" id="cBar"></div></div>' +
        '<span class="progress-label" id="cPctL"></span><span class="gamify" data-gamify></span></div>' +
        '<details class="course-brief"><summary>Course guide</summary><div class="course-brief__grid">' +
          '<section><h2>What you will be able to do</h2><ul>' + outcomesHTML + "</ul></section>" +
          '<section><h2>Prerequisites</h2><p>' + prerequisiteHTML + '</p><h2>Learning design</h2><p>Read the intuition, run the model, manipulate it, then prove your understanding.</p></section>' +
          '<section class="course-brief__outline"><h2>Module map</h2><ol>' + outlineHTML + "</ol></section>" +
        "</div></details>" +
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
    const percent = pct();
    root.querySelector("#cBar").style.width = percent + "%";
    root.querySelector("#cPctL").textContent = percent + "%";
    root.querySelector("#cProgress").setAttribute("aria-valuenow", String(percent));
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
      if (mi === stages[current].mi) {
        node.classList.add("is-current");
        node.setAttribute("aria-current", "step");
      }
      node.addEventListener("click", () => go(firstIdx));
      navEl.appendChild(node);
    });
    paintProgress();
  }

  // ---- Stage renderers ----------------------------------------
  const QUESTION = { quiz: 1, truefalse: 1, multi: 1, numeric: 1, fillblank: 1 };
  // Each stage's title is an <h2> so the page has a real h1(topic) → h2(stage)
  // outline that screen-reader users can navigate by heading.
  function guideHTML(st) {
    if (st.type === "read") {
      const html = st.html || "";
      return /<h2\b/i.test(html) ? html : '<h2 class="stage__h2">' + esc(st.title || "Lesson") + "</h2>" + html;
    }
    // prompt-in-guide question types (the blank/expression lives in the work column for fillblank)
    if (st.type === "quiz" || st.type === "truefalse" || st.type === "multi" || st.type === "numeric")
      return '<h2 class="stage__h2">' + esc(st.title || "Question") + '</h2><p class="quiz__prompt">' + st.prompt + "</p>";
    if (st.type === "fillblank")
      return '<h2 class="stage__h2">' + esc(st.title || "Question") + "</h2>" + (st.lead ? "<p>" + st.lead + "</p>" : "");
    return '<h2 class="stage__h2">' + esc(st.title || "") + "</h2>" + (st.note ? "<p>" + st.note + "</p>" : "");
  }

  function buildWork(st, i, figsEl) {
    if (st.type === "code") {
      return window.Lab.makeCell({ code: st.code, title: (st.title || "python").toLowerCase().replace(/\s+/g, "_") + ".py", onRun: (el) => mark(i, el), figsEl }).el;
    }
    if (st.type === "interactive") return buildInteractive(st, i, figsEl);
    if (st.type === "conceptlab") return buildConceptLab(st, i);
    if (st.type === "codechallenge") return buildCodeChallenge(st, i, figsEl);
    if (st.type === "case") return buildCase(st, i);
    if (st.type === "match") return buildMatch(st, i);
    if (QUESTION[st.type]) return buildQuestion(st, i);
    return null;
  }

  function recordSkills(st, correct, hinted) {
    if (!window.Auth || typeof window.Auth.recordSkillAttempt !== "function") return;
    for (const skillId of st.skillIds || []) void window.Auth.recordSkillAttempt(skillId, st.variantId || st.id, { correct, hinted });
  }

  function buildCodeChallenge(st, i, figsEl) {
    const wrap = el("div", "challenge-cell");
    const feedback = el("div", "quiz__feedback"); feedback.setAttribute("role", "status");
    const hint = el("button", "btn btn--ghost", "Reveal hint 1"); hint.type = "button";
    let hintIndex = 0, hinted = false;
    const cell = window.Lab.makeCell({
      code: st.starter,
      title: "graded_challenge.py",
      figsEl,
      prepareCode: (code) => `${code}\n\n# Deterministic local grader\n${st.tests}`,
      onResult: (ok, button) => {
        recordSkills(st, ok, hinted);
        feedback.className = "quiz__feedback " + (ok ? "ok" : "err");
        feedback.textContent = ok ? st.success : "The grader did not pass yet. Read the output, revise one line, and run again.";
        if (ok) { mark(i, button); hint.disabled = true; }
      },
    });
    hint.addEventListener("click", () => {
      hinted = true;
      const hints = st.hints || [];
      feedback.className = "quiz__feedback hint";
      feedback.textContent = "Hint: " + (hints[hintIndex] || "Compare each required variable with the task statement.");
      hintIndex = Math.min(hints.length, hintIndex + 1);
      hint.textContent = hintIndex < hints.length ? `Reveal hint ${hintIndex + 1}` : "All hints shown";
      if (hintIndex >= hints.length) hint.disabled = true;
    });
    wrap.append(cell.el, hint, feedback);
    return wrap;
  }

  function buildConceptLab(st, i) {
    const lab = el("div", "concept-lab");
    const id = `concept_${topic.id}_${i}`;
    lab.innerHTML = '<label class="control" for="' + id + '"><span class="control__label">' + esc(st.param.label) + ' <b class="control__val"></b></span>' +
      '<input class="control__range" id="' + id + '" type="range" min="' + st.param.min + '" max="' + st.param.max + '" step="' + st.param.step + '" value="' + st.param.value + '"></label>' +
      '<svg class="concept-lab__plot" viewBox="0 0 640 260" role="img" aria-labelledby="' + id + '_title ' + id + '_desc"><title id="' + id + '_title">Live ' + esc(st.title) + '</title><desc id="' + id + '_desc">A curve that updates when the control changes.</desc><path class="concept-lab__axis" d="M44 218H620M44 18V218"></path><path class="concept-lab__curve"></path><circle class="concept-lab__point" r="6"></circle></svg>' +
      '<p class="concept-lab__readout" role="status"></p><button class="btn btn--gold concept-lab__complete" type="button">Record insight</button>';
    const range = lab.querySelector("input"), value = lab.querySelector(".control__val"), curve = lab.querySelector(".concept-lab__curve"), point = lab.querySelector(".concept-lab__point"), readout = lab.querySelector(".concept-lab__readout");
    const update = () => {
      const v = Number(range.value), lo = Number(range.min), hi = Number(range.max), normalized = (v - lo) / Math.max(1e-9, hi - lo);
      value.textContent = range.value;
      const points = Array.from({ length: 81 }, (_, k) => {
        const x = k / 80, center = 0.18 + 0.64 * normalized;
        const y = st.kind === "ar" || st.kind === "garch" ? Math.pow(Math.max(0, 1 - x), 0.35 + 3 * (1 - normalized)) : Math.exp(-Math.pow((x - center) / (0.11 + 0.13 * (1 - normalized)), 2));
        return [44 + 576 * x, 218 - 178 * y];
      });
      curve.setAttribute("d", points.map((p, k) => (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" "));
      const chosen = points[Math.round(normalized * 80)]; point.setAttribute("cx", chosen[0]); point.setAttribute("cy", chosen[1]);
      readout.textContent = `${st.param.label}: ${range.value}. ${st.insight}`;
    };
    range.addEventListener("input", update); update();
    lab.querySelector("button").addEventListener("click", (event) => { mark(i, event.currentTarget); event.currentTarget.textContent = "Insight recorded ✓"; event.currentTarget.disabled = true; });
    return lab;
  }

  function buildCase(st, i) {
    const box = el("div", "case-study");
    let step = 0, clean = true;
    const renderStep = () => {
      const current = st.steps[step];
      box.innerHTML = '<p class="academy-kicker">Decision ' + (step + 1) + ' of ' + st.steps.length + '</p><h3>' + esc(current.prompt) + '</h3><div class="quiz__choices">' + current.choices.map((choice, index) => '<button class="quiz__choice case-study__choice" type="button" data-answer="' + index + '"><span>' + esc(choice) + '</span></button>').join("") + '</div><div class="quiz__feedback" role="status"></div>';
      box.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        const ok = Number(button.dataset.answer) === current.answer;
        if (!ok) clean = false;
        const fb = box.querySelector(".quiz__feedback"); fb.className = "quiz__feedback " + (ok ? "ok" : "err"); fb.textContent = ok ? current.explain : "That action is not defensible here. Re-read the diagnostic risk and choose again.";
        if (!ok) { recordSkills(st, false, false); return; }
        setTimeout(() => { step++; if (step < st.steps.length) renderStep(); else { recordSkills(st, true, !clean); mark(i, button); box.innerHTML = '<div class="case-study__complete"><span aria-hidden="true">✓</span><h3>Case resolved</h3><p>' + esc(current.explain) + '</p></div>'; } }, 420);
      }));
    };
    renderStep(); return box;
  }

  function buildMatch(st, i) {
    const box = el("div", "match-lab");
    const rights = st.pairs.map((pair) => pair.right).slice().reverse();
    box.innerHTML = '<p>Use each select to build the evidence map. No dragging is required.</p><div class="match-lab__rows">' + st.pairs.map((pair, index) => '<label><span>' + esc(pair.left) + '</span><select data-match="' + index + '"><option value="">Choose evidence…</option>' + rights.map((right) => '<option value="' + esc(right) + '">' + esc(right) + '</option>').join("") + '</select></label>').join("") + '</div><button class="btn btn--gold" type="button">Check map</button><div class="quiz__feedback" role="status"></div>';
    box.querySelector("button").addEventListener("click", (event) => {
      const picks = [...box.querySelectorAll("select")].map((select) => select.value);
      if (picks.some((value) => !value)) { const fb = box.querySelector(".quiz__feedback"); fb.className = "quiz__feedback hint"; fb.textContent = "Choose evidence for every role first."; return; }
      const ok = picks.every((value, index) => value === st.pairs[index].right);
      recordSkills(st, ok, false);
      const fb = box.querySelector(".quiz__feedback"); fb.className = "quiz__feedback " + (ok ? "ok" : "err"); fb.textContent = ok ? "Evidence map complete. Each claim now has the right diagnostic role." : "Some roles are mismatched. Compare the good practice, diagnostic, and failure mode.";
      if (ok) { mark(i, event.currentTarget); event.currentTarget.disabled = true; }
    });
    return box;
  }

  function buildInteractive(st, i, figsEl) {
    const cell = el("div", "cell cell--interactive");
    const params = {}; st.params.forEach((p) => (params[p.name] = p.value));
    const bar = el("div", "cell__bar");
    bar.innerHTML = '<span class="cell__dot"></span><span class="cell__title">interactive</span><button class="cell__run" type="button">▶ Launch</button>';
    const body = el("div", "interactive");
    const controls = el("div", "interactive__controls");
    const out = el("div", "cell__out"); const figs = figsEl || el("div", "cell__figs");
    const output = el("div", "interactive__output"); if (figsEl) output.append(out); else output.append(figs, out);
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
      clearTimeout(schedule._t);   // cancel any pending scheduled run so it can't double-fire
      running = true;
      const ok = await window.Lab.run(render(), { out, figs });
      running = false;
      if (ok && !launched) { launched = true; runBtn.textContent = "↻ Re-run"; mark(i, runBtn); }
      if (pending) { pending = false; exec(); }
    }
    function schedule() { if (!launched) return; if (running) { pending = true; return; } clearTimeout(schedule._t); schedule._t = setTimeout(() => { if (!running) exec(); }, 180); }
    runBtn.addEventListener("click", () => { if (!running) exec(); });
    return cell;
  }

  // Normalize a free-text answer the same way for the input and the accept list.
  const normTxt = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/^[\s"'(]+|[\s"'.,;:!?)]+$/g, "").replace(/^the\s+/, "");

  // Parse the entire answer instead of accepting a numeric prefix ("36abc").
  // A single decimal comma is accepted for learners using that locale.
  function parseNumeric(value) {
    let text = String(value).trim().replace(/\u2212/g, "-").replace(/\s+/g, "");
    if (!text) return null;
    const commas = (text.match(/,/g) || []).length;
    if (commas === 1 && !text.includes(".")) text = text.replace(",", ".");
    else if (commas) return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  // Deterministic grading for every question type. Returns {ok} or {empty:true}.
  function grade(st, root, name) {
    if (st.type === "numeric") {
      const raw = root.querySelector(".q-num").value || "";
      if (!raw.trim()) return { empty: true };
      const value = parseNumeric(raw);
      if (value == null) return { invalid: true };
      const absolute = Number.isFinite(st.tol) && st.tol >= 0 ? st.tol : 0;
      const relative = Number.isFinite(st.rtol) && st.rtol >= 0 ? st.rtol : 0;
      // Match the daily-review grader: always allow a few float-epsilons so an
      // exact-but-for-binary-rounding answer isn't marked wrong when tol/rtol=0.
      const tolerance = Math.max(absolute, relative * Math.abs(st.answer), Number.EPSILON * Math.max(1, Math.abs(st.answer)) * 8);
      return { ok: Number.isFinite(st.answer) && Math.abs(value - st.answer) <= tolerance };
    }
    if (st.type === "fillblank") {
      const raw = root.querySelector(".q-blank").value;
      if (!raw.trim()) return { empty: true };
      return { ok: new Set((st.accept || []).map(normTxt)).has(normTxt(raw)) };
    }
    if (st.type === "multi") {
      const picked = [...root.querySelectorAll('input[name="' + name + '"]:checked')].map((e) => +e.value).sort((a, b) => a - b);
      if (!picked.length) return { empty: true };
      const ans = [...(st.answers || [])].sort((a, b) => a - b);
      return { ok: picked.length === ans.length && picked.every((v, k) => v === ans[k]) };
    }
    const sel = root.querySelector('input[name="' + name + '"]:checked');   // quiz / truefalse
    if (!sel) return { empty: true };
    if (st.type === "truefalse") return { ok: (sel.value === "true") === !!st.answer, sel };
    return { ok: +sel.value === st.answer, sel };
  }

  function emptyMsg(t) {
    return t === "numeric" ? "Enter a number." : t === "fillblank" ? "Type the missing term."
      : t === "multi" ? "Select all that apply first." : "Pick an answer first.";
  }
  function wrongMsg(st, r) {
    if (r.invalid) return "Enter a valid number using digits and an optional decimal point or comma.";
    if (st.why && r.sel && st.why[+r.sel.value]) return esc(st.why[+r.sel.value]);
    if (st.type === "multi") return "Close — some right, some wrong. Try again, or tap Hint.";
    return "Not quite — try again, or tap Hint.";
  }
  function markCorrect(st, root, name) {
    const tag = (v) => { const c = root.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (c && c.closest(".quiz__choice")) c.closest(".quiz__choice").classList.add("is-correct"); };
    if (st.type === "quiz") tag(st.answer);
    else if (st.type === "truefalse") tag(st.answer ? "true" : "false");
    else if (st.type === "multi") (st.answers || []).forEach(tag);
  }

  function buildQuestion(st, i) {
    const q = el("div", "quiz quiz--" + st.type);
    const name = "q_" + topic.id + "_" + i;
    const radios = (items, type) => '<fieldset class="quiz__fieldset"><legend class="sr-only">' + esc(st.title || "Question") + ' answer choices</legend><div class="quiz__choices' + (type === "tf" ? " quiz__choices--tf" : "") + '">' +
      items.map((it) => '<label class="quiz__choice"><input type="' + (st.type === "multi" ? "checkbox" : "radio") +
        '" name="' + name + '" value="' + it.v + '"><span>' + esc(it.label) + "</span></label>").join("") + "</div></fieldset>";
    let inputHTML = "";
    if (st.type === "quiz") inputHTML = radios(st.choices.map((c, k) => ({ v: k, label: c })));
    else if (st.type === "multi") inputHTML = radios(st.choices.map((c, k) => ({ v: k, label: c })));
    else if (st.type === "truefalse") inputHTML = radios([{ v: "true", label: "True" }, { v: "false", label: "False" }], "tf");
    else if (st.type === "numeric") inputHTML = '<div class="q-numwrap"><input class="q-num" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Your numeric answer">' + (st.unit ? '<span class="q-unit">' + esc(st.unit) + "</span>" : "") + "</div>";
    else if (st.type === "fillblank") { const parts = String(st.prompt).split("___"); inputHTML = '<p class="q-fill">' + (parts[0] || "") + '<input class="q-blank" type="text" autocomplete="off" spellcheck="false" aria-label="Fill in the blank">' + (parts.slice(1).join("___")) + "</p>"; }

    q.innerHTML = inputHTML +
      '<div class="quiz__actions"><button class="quiz__hint btn btn--ghost" type="button">Hint</button><button class="quiz__check btn btn--gold" type="button">Check</button></div>' +
      '<div class="quiz__feedback" role="status"></div>';
    const fb = q.querySelector(".quiz__feedback");
    const checkBtn = q.querySelector(".quiz__check");
    let hinted = false;
    if (st.hint) q.querySelector(".quiz__hint").addEventListener("click", () => { hinted = true; fb.className = "quiz__feedback hint"; fb.textContent = "Hint: " + st.hint; });
    else q.querySelector(".quiz__hint").remove();
    q.querySelectorAll('input[type="text"]').forEach((inp) => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkBtn.click(); } }));

    checkBtn.addEventListener("click", () => {
      if (q.classList.contains("is-solved")) return;
      const r = grade(st, q, name);
      if (r.empty) { fb.className = "quiz__feedback hint"; fb.textContent = emptyMsg(st.type); return; }
      if (typeof r.ok === "boolean" && st.id && window.Auth && typeof window.Auth.recordMasteryAttempt === "function") {
        void window.Auth.recordMasteryAttempt(topic.id + ":" + st.id, { correct: r.ok, hinted });
      }
      if (typeof r.ok === "boolean") recordSkills(st, r.ok, hinted);
      if (r.ok) {
        fb.className = "quiz__feedback ok"; fb.innerHTML = "Correct. " + (st.explain || "");
        q.classList.add("is-solved"); markCorrect(st, q, name);
        if (window.FX) window.FX.correct(checkBtn);
        mark(i, checkBtn);
      } else {
        fb.className = "quiz__feedback err"; fb.innerHTML = wrongMsg(st, r);
        if (r.sel) { const ch = r.sel.closest(".quiz__choice"); if (ch) { ch.classList.add("is-wrong"); setTimeout(() => ch.classList.remove("is-wrong"), 700); } }
        if (window.FX) window.FX.wrong(q);
      }
    });
    return q;
  }

  // ---- Draggable horizontal splitter (persisted, keyboard-operable) ----
  function wireResize(splitEl, handle) {
    const saved = store.guideWidth();
    let lastP = (saved >= 25 && saved <= 72) ? saved : 38;
    if (saved >= 25 && saved <= 72) splitEl.style.setProperty("--guideW", saved + "%");
    const persist = () => { if (lastP >= 25 && lastP <= 72) store.setGuideWidth(lastP); };
    const set = (p) => {
      lastP = Math.max(25, Math.min(72, p));
      splitEl.style.setProperty("--guideW", lastP + "%");
      handle.setAttribute("aria-valuenow", Math.round(lastP));
      handle.setAttribute("aria-valuetext", Math.round(lastP) + "% guide width");
    };
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("aria-label", "Resize guide and workspace panels");
    handle.setAttribute("aria-valuemin", "25");
    handle.setAttribute("aria-valuemax", "72");
    handle.setAttribute("aria-valuenow", Math.round(lastP));
    handle.setAttribute("aria-valuetext", Math.round(lastP) + "% guide width");
    handle.addEventListener("keydown", (e) => {
      const act = { ArrowLeft: () => set(lastP - 3), ArrowRight: () => set(lastP + 3), Home: () => set(25), End: () => set(72) }[e.key];
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();   // keep arrows from ALSO triggering stage navigation
      act(); persist();
    });
    let dragging = false, raf = 0, lastX = 0;
    const apply = () => {
      raf = 0;
      const r = splitEl.getBoundingClientRect();
      set(((lastX - r.left) / r.width) * 100);
    };
    const move = (e) => { if (!dragging) return; lastX = e.clientX; if (!raf) raf = requestAnimationFrame(apply); };
    handle.addEventListener("pointerdown", (e) => { dragging = true; handle.classList.add("drag"); handle.setPointerCapture(e.pointerId); e.preventDefault(); });
    handle.addEventListener("pointermove", move);
    const endDrag = (e) => {
      dragging = false; handle.classList.remove("drag");
      persist();   // persist once, not per move
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    };
    handle.addEventListener("pointerup", endDrag);
    // pointercancel (scroll/gesture takeover) would otherwise leave dragging=true,
    // so the panel keeps resizing on later moves with no button held.
    handle.addEventListener("pointercancel", endDrag);
  }

  // ---- Render one stage ---------------------------------------
  let cur = 0;
  async function render(i) {
    await ensureModule(stages[i].mi);
    cur = i;
    const st = stages[i];
    // Charts render in the LEFT guide column (under the prompt) so a tall code
    // cell doesn't push them far down the page.
    const figsEl = st.type === "code" ? el("div", "stage__figs")
      : st.type === "interactive" ? el("div", "stage__figs stage__figs--live") : null;
    const work = (st.type !== "read") ? buildWork(st, i, figsEl) : null;

    stageEl.innerHTML = "";
    const kicker = el("div", "stage__kicker", esc(st.mTitle) + " &middot; step " + (st.si + 1));
    stageEl.appendChild(kicker);

    const body = el("div", work ? "stage__split" : "stage__solo");
    const guide = el("div", "stage__guide step--read", guideHTML(st));
    if (figsEl) guide.appendChild(figsEl);
    body.appendChild(guide);
    if (work) {
      const handle = el("div", "stage__handle");
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      handle.title = "Drag to resize";
      const w = el("div", "stage__work"); w.appendChild(work);
      body.append(handle, w);
      wireResize(body, handle);
    }
    stageEl.appendChild(body);

    prevBtn.disabled = i === 0;
    const complete = doneSet().has(i);
    nextBtn.textContent = i === N - 1
      ? (st.type === "read" && !complete ? "Complete & finish ✓" : "Finish ✓")
      : (st.type === "read" && !complete ? "Complete & next →" : "Next →");
    root.querySelector("#cPos").textContent = (i + 1) + " / " + N;
    renderNav(i);
  }

  async function go(i) {
    if (i < 0 || i >= N) {
      if (i >= N) {
        const done = doneSet();
        const firstOpen = stages.findIndex((_, index) => !done.has(index));
        if (firstOpen >= 0) {
          if (window.toast) window.toast((N - done.size) + " lessons remain — your progress is saved.");
          go(firstOpen);
          return;
        }
        if (window.FX) window.FX.celebrate("Course complete — superb work.");
        else if (window.toast) window.toast("Course complete — superb work. ✓");
        setTimeout(() => { location.href = "/lab/"; }, window.FX ? 1900 : 0);
      }
      return;
    }
    const dir = i >= cur ? 1 : -1;
    cur = i;   // set NOW — render() runs after the page-turn delay, and rapid
               // Next/arrow presses must step from the target, not a stale index
    history.replaceState(null, "", "#s" + i);
    const swap = async () => {
      try { await render(i); }
      catch { if (window.toast) window.toast("This module could not load. Your progress is safe."); return; }
      stageEl.scrollIntoView({ block: "start", behavior: "auto" });
      const h = stageEl.querySelector(".stage__guide h2, .stage__guide h1, .stage__kicker");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }   // focus follows the turn
    };
    if (window.FX && window.FX.pageTurn) window.FX.pageTurn(stageEl, dir, swap);
    else swap();
  }

  prevBtn.addEventListener("click", () => go(cur - 1));
  nextBtn.addEventListener("click", () => {
    if (stages[cur].type === "read") mark(cur, nextBtn);
    go(cur + 1);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (!e.altKey) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1); }
  });

  const hashMatch = location.hash.match(/^#s(\d+)/);
  const firstOpen = stages.findIndex((_, index) => !doneSet().has(index));
  const requestedStart = hashMatch ? Number(hashMatch[1]) : (firstOpen >= 0 ? firstOpen : 0);
  const start = Math.max(0, Math.min(N - 1, Number.isInteger(requestedStart) ? requestedStart : 0));
  await render(start);
  if (window.Gamify) window.Gamify.paint();
  document.addEventListener("iewt:synced", () => { paintProgress(); renderNav(cur); if (window.Gamify) window.Gamify.paint(); });
  document.addEventListener("iewt:progress-reset", () => { paintProgress(); renderNav(cur); if (window.Gamify) window.Gamify.paint(); });
})();
