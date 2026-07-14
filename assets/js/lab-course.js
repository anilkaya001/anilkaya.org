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
  try {
    const version = document.documentElement.dataset.assetVersion;
    const response = await fetch(`/assets/data/courses/${encodeURIComponent(topicId)}.json${version ? `?v=${encodeURIComponent(version)}` : ""}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`course-payload-${response.status}`);
    topic = await response.json();
    if (!topic || topic.schemaVersion !== 1 || topic.id !== topicId || !Array.isArray(topic.modules) || !topic.modules.length ||
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

  // ---- Progress (on-device) -----------------------------------
  const store = window.IEWTStorage;
  const DEFAULT_POINTS = Object.freeze({
    read: 5, code: 10, interactive: 10, quiz: 15,
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
    if (QUESTION[st.type]) return buildQuestion(st, i);
    return null;
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
      running = true;
      const ok = await window.Lab.run(render(), { out, figs });
      running = false;
      if (ok && !launched) { launched = true; runBtn.textContent = "↻ Re-run"; mark(i, runBtn); }
      if (pending) { pending = false; exec(); }
    }
    function schedule() { if (!launched) return; if (running) { pending = true; return; } clearTimeout(schedule._t); schedule._t = setTimeout(exec, 180); }
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
      const tolerance = Math.max(absolute, relative * Math.abs(st.answer));
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
    if (st.hint) q.querySelector(".quiz__hint").addEventListener("click", () => { fb.className = "quiz__feedback hint"; fb.textContent = "Hint: " + st.hint; });
    else q.querySelector(".quiz__hint").remove();
    q.querySelectorAll('input[type="text"]').forEach((inp) => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkBtn.click(); } }));

    checkBtn.addEventListener("click", () => {
      if (q.classList.contains("is-solved")) return;
      const r = grade(st, q, name);
      if (r.empty) { fb.className = "quiz__feedback hint"; fb.textContent = emptyMsg(st.type); return; }
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
    handle.addEventListener("pointerup", (e) => {
      dragging = false; handle.classList.remove("drag");
      persist();   // persist once, not per move
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    });
  }

  // ---- Render one stage ---------------------------------------
  let cur = 0;
  function render(i) {
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

  function go(i) {
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
    const swap = () => {
      render(i);
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
  render(start);
  if (window.Gamify) window.Gamify.paint();
  document.addEventListener("iewt:synced", () => { paintProgress(); renderNav(cur); if (window.Gamify) window.Gamify.paint(); });
  document.addEventListener("iewt:progress-reset", () => { paintProgress(); renderNav(cur); if (window.Gamify) window.Gamify.paint(); });
})();
