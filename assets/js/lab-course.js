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
  function mark(i, originEl) {
    const a = all(); const d = new Set((a[topic.id] || {}).done || []);
    if (d.has(i)) return;
    d.add(i); a[topic.id] = { done: [...d] };
    try { localStorage.setItem(PKEY, JSON.stringify(a)); } catch { /* private mode */ }
    paintProgress();
    const pts = ({ read: 5, code: 10, interactive: 10, quiz: 15 })[stages[i].type] || 5;
    if (window.Gamify) window.Gamify.award(pts);
    const badge = root.querySelector("[data-gamify]");
    if (window.FX && window.FX.coin) window.FX.coin(originEl, badge, pts);
    else if (window.FX) window.FX.floatPoints(pts, badge);
    if (window.Auth && typeof window.Auth.pushProgress === "function") window.Auth.pushProgress(topic.id, [...d]);
    // Module finished? quiet cheer. Whole topic? big one (also handled at Finish).
    const mi = stages[i].mi;
    const modIdxs = stages.map((s, k) => (s.mi === mi ? k : -1)).filter((k) => k >= 0);
    if (window.FX && modIdxs.every((k) => d.has(k))) window.FX.moduleDone(root.querySelector(".course-nav__mod.is-current"));
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
        '<span class="progress-label" id="cPctL"></span><span class="gamify" data-gamify></span></div>' +
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
  const QUESTION = { quiz: 1, truefalse: 1, multi: 1, numeric: 1, fillblank: 1 };
  // Each stage's title is an <h2> so the page has a real h1(topic) → h2(stage)
  // outline that screen-reader users can navigate by heading.
  function guideHTML(st) {
    if (st.type === "read") return st.html || "";
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

  // Deterministic grading for every question type. Returns {ok} or {empty:true}.
  function grade(st, root, name) {
    if (st.type === "numeric") {
      const v = parseFloat((root.querySelector(".q-num").value || "").replace(/[,%=\s]/g, ""));
      if (!isFinite(v)) return { empty: true };
      const ok = Math.abs(v - st.answer) <= st.tol || (st.rtol && Math.abs(v - st.answer) <= st.rtol * Math.abs(st.answer));
      return { ok: !!ok };
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
    const radios = (items, type) => '<div class="quiz__choices' + (type === "tf" ? " quiz__choices--tf" : "") + '">' +
      items.map((it) => '<label class="quiz__choice"><input type="' + (st.type === "multi" ? "checkbox" : "radio") +
        '" name="' + name + '" value="' + it.v + '"><span>' + esc(it.label) + "</span></label>").join("") + "</div>";
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
    const saved = parseFloat(localStorage.getItem("iewt:splitW"));
    let lastP = (saved >= 25 && saved <= 72) ? saved : 38;
    if (saved >= 25 && saved <= 72) splitEl.style.setProperty("--guideW", saved + "%");
    const persist = () => { if (lastP >= 25 && lastP <= 72) { try { localStorage.setItem("iewt:splitW", lastP.toFixed(1)); } catch { /* private mode */ } } };
    const set = (p) => {
      lastP = Math.max(25, Math.min(72, p));
      splitEl.style.setProperty("--guideW", lastP + "%");
      handle.setAttribute("aria-valuenow", Math.round(lastP));
    };
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("aria-label", "Resize guide and workspace panels");
    handle.setAttribute("aria-valuemin", "25");
    handle.setAttribute("aria-valuemax", "72");
    handle.setAttribute("aria-valuenow", Math.round(lastP));
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

    if (st.type === "read") mark(i);          // reading a page completes it

    prevBtn.disabled = i === 0;
    nextBtn.textContent = i === N - 1 ? "Finish ✓" : "Next →";
    root.querySelector("#cPos").textContent = (i + 1) + " / " + N;
    renderNav(i);
  }

  function go(i) {
    if (i < 0 || i >= N) {
      if (i >= N) {
        if (window.FX) window.FX.celebrate("Topic complete — superb work.");
        else if (window.toast) window.toast("Topic complete — superb work. ✓");
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
  nextBtn.addEventListener("click", () => go(cur + 1));
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowRight") go(cur + 1);
    if (e.key === "ArrowLeft") go(cur - 1);
  });

  const start = Math.max(0, Math.min(N - 1, parseInt((location.hash.match(/^#s(\d+)/) || [])[1], 10) || 0));
  render(start);
  if (window.Gamify) window.Gamify.paint();
  document.addEventListener("iewt:synced", () => { render(cur); if (window.Gamify) window.Gamify.paint(); });
})();
