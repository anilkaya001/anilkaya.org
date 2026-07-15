/* Six-item conceptual-skill and course mastery challenges. */
(() => {
  "use strict";
  const app = document.getElementById("challengeApp");
  if (!app) return;
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const courseId = new URLSearchParams(location.search).get("course");
  let state = null;

  function choose(items) {
    const skills = window.SKILL_CATALOG || [];
    const eligible = courseId && window.TOPIC_BY_ID?.[courseId] ? skills.filter((skill) => skill.courseId === courseId).map((skill) => skill.id) : skills.map((skill) => skill.id);
    const mastery = window.IEWTStorage.skillMastery();
    const selected = courseId ? eligible.slice(0, 12) : window.SkillMasteryScheduler.selectWeakestSkills(eligible, mastery, day(), 3);
    const rotation = Number(day().replaceAll("-", "")) % 3;
    const questions = [];
    for (const skillId of selected) {
      const variants = items.filter((item) => item.skillId === skillId);
      const count = courseId ? 1 : 2;
      for (let offset = 0; offset < count && offset < variants.length; offset++) questions.push(variants[(rotation + offset) % variants.length]);
    }
    return questions.slice(0, courseId ? 12 : 6);
  }

  function render() {
    if (state.index >= state.items.length) return finish();
    const item = state.items[state.index], topic = window.TOPIC_BY_ID?.[item.courseId];
    app.innerHTML = '<header class="review-session__head"><div class="review-session__label"><b>Question ' + (state.index + 1) + ' of ' + state.items.length + '</b><span>' + esc(courseId ? "Course challenge" : "Weak-skill challenge") + '</span></div><span class="review-save-mode">Saved on this device</span><progress class="review-session__progress" max="' + state.items.length + '" value="' + state.index + '"></progress></header>' +
      '<article class="review-question"><div class="review-question__meta"><a class="review-question__course" href="/lab/' + esc(topic?.slug || "") + '/">' + esc(topic?.shortTitle || topic?.title || item.courseId) + '</a><span>' + esc(item.title) + '</span></div><h2>' + esc(item.title) + '</h2><p class="review-question__prompt">' + esc(item.prompt) + '</p><form class="review-form"><fieldset class="review-options"><legend class="visually-hidden">Choose one answer</legend>' + item.choices.map((choice, index) => '<label class="review-option"><input type="radio" name="answer" value="' + index + '"><span>' + esc(choice) + '</span></label>').join("") + '</fieldset><div class="review-actions"><button class="btn btn--ghost" id="challengeHint" type="button">Hint</button><button class="btn btn--gold" type="submit">Check answer</button></div><div class="review-feedback" id="challengeFeedback" tabindex="-1" hidden></div></form></article>';
    const form = app.querySelector("form"), feedback = app.querySelector("#challengeFeedback"); let hinted = false, answered = false;
    app.querySelector("#challengeHint").addEventListener("click", (event) => { hinted = true; event.currentTarget.disabled = true; feedback.hidden = false; feedback.className = "review-feedback is-hint"; feedback.innerHTML = '<strong>Hint</strong><p>' + esc(item.hint) + '</p>'; feedback.focus(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); if (answered) { state.index++; render(); return; }
      const selected = form.querySelector('input[name="answer"]:checked');
      if (!selected) { feedback.hidden = false; feedback.className = "review-feedback is-hint"; feedback.innerHTML = "<strong>Choose an answer first.</strong>"; return; }
      answered = true; const correct = Number(selected.value) === item.answer;
      if (correct) state.correct++;
      const result = window.Auth?.recordSkillAttempt ? await window.Auth.recordSkillAttempt(item.skillId, item.id, { correct, hinted }) : null;
      feedback.hidden = false; feedback.className = "review-feedback " + (correct ? "is-correct" : "is-incorrect"); feedback.innerHTML = '<strong>' + (correct ? "Correct" : "Not this time") + '</strong><p>' + esc(item.explain) + '</p><p class="review-feedback__save">' + esc(result?.synced ? "Saved to your account." : "Saved on this device.") + '</p>';
      form.querySelectorAll("input").forEach((input) => { input.disabled = true; });
      form.querySelector('button[type="submit"]').textContent = state.index === state.items.length - 1 ? "See results" : "Next question";
      feedback.focus();
    });
  }

  function finish() {
    const percent = Math.round(100 * state.correct / state.items.length), badge = courseId && percent >= 80;
    app.innerHTML = '<div class="review-empty"><p class="review-eyebrow">Challenge complete</p><h2>' + percent + '% correct</h2><p>' + (badge ? "Course challenge badge earned. Your skill schedule has been updated." : percent >= 80 ? "Strong retrieval. Your skill schedule has been updated." : "Your weakest skills are now scheduled for focused review.") + '</p><div class="review-empty__actions"><a class="btn btn--gold" href="/lab/">Return to Today</a><button class="btn btn--ghost" id="challengeAgain" type="button">Practice again</button></div></div>';
    app.querySelector("#challengeAgain").addEventListener("click", () => location.reload());
  }

  async function init() {
    try {
      const version = document.documentElement.dataset.assetVersion;
      const response = await fetch(`/assets/data/challenge-bank.json${version ? `?v=${version}` : ""}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("challenge-bank-unavailable");
      const payload = await response.json();
      if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.items)) throw new Error("invalid-challenge-bank");
      const items = choose(payload.items);
      if (!items.length) throw new Error("empty-challenge");
      state = { items, index: 0, correct: 0 }; render();
    } catch { app.innerHTML = '<div class="review-empty"><h2>The challenge could not load.</h2><p>Your progress is safe. Check the connection and try again.</p><button class="btn btn--gold" onclick="location.reload()">Try again</button></div>'; }
  }
  void init();
})();
