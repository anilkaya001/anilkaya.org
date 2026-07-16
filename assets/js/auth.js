/* =============================================================
   auth.js — account, synchronization, and reset coordination.

   All server mutations share one serialized lane and carry a mutation epoch.
   Reset invalidates queued work, waits for an in-flight mutation to finish,
   deletes server state, and only then clears the matching local owner scope.
   ============================================================= */
(() => {
  "use strict";
  let user = null, backend = false;
  let authStatus = "checking", lastError = null;
  let mutationEpoch = 0, mutationTail = Promise.resolve();
  let resetting = false, resetPromise = null;
  const store = window.IEWTStorage;
  // Snapshot the anonymous profile before later deferred scripts can record a
  // course interaction. If the initial account probe resolves to a returning account, only the
  // post-snapshot delta is transferred; pre-existing anonymous work remains an
  // isolated device profile.
  const bootAnonymousProgress = store.progress();
  const bootAnonymousGamify = store.gamify();
  const bootAnonymousStableProgress = store.stableProgress();
  let accountScopeExisted = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function emit(name, detail) {
    if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(name, { detail }));
    else document.dispatchEvent(new Event(name));
  }

  function setStatus(value, error = null) {
    authStatus = value;
    lastError = error;
    emit("iewt:auth-state", { status: value, user, error });
  }

  let toastEl;
  window.toast = (msg, ms = 4200) => {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), ms);
  };

  async function getJSON(url, opts = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...opts });
    const contentType = response.headers.get("content-type") || "";
    let value = null;
    if (contentType.includes("application/json")) {
      try { value = await response.json(); }
      catch { /* handled by the response validation below */ }
    }
    if (!response.ok || value == null) {
      const error = new Error("request-failed");
      error.status = response.status;
      error.code = value && value.error && value.error.code ? value.error.code : "request_failed";
      const bodyGeneration = value && value.generation;
      const headerGeneration = response.headers.get("x-iewt-generation");
      error.generation = parseGeneration(bodyGeneration, parseGeneration(headerGeneration));
      throw error;
    }
    return value;
  }

  function ownerHeaders(owner, extra = {}) {
    return { ...extra, "X-IEWT-Owner": owner };
  }

  function parseGeneration(value, fallback = null) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
    return fallback;
  }

  function payloadGeneration(payload) {
    const generation = parseGeneration(payload && payload.generation);
    if (generation == null) {
      const error = new Error("invalid-generation");
      error.code = "invalid_generation";
      throw error;
    }
    return generation;
  }

  const putJSON = (url, body, owner, generation) => getJSON(url, {
    method: "PUT",
    headers: ownerHeaders(owner, {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-IEWT-Generation": String(generation),
    }),
    body: JSON.stringify(body),
  });

  const deleteProgress = (owner) => getJSON("/api/progress", {
    method: "DELETE",
    headers: ownerHeaders(owner, { Accept: "application/json" }),
  });

  const deletePlacement = (owner, generation) => getJSON("/api/placement", {
    method: "DELETE",
    headers: ownerHeaders(owner, {
      Accept: "application/json",
      "X-IEWT-Generation": String(generation),
    }),
  });

  function enqueue(operation) {
    const result = mutationTail.catch(() => undefined).then(operation);
    // Keep the lane usable after one request fails while still returning the
    // original result/rejection to the caller that owns that operation.
    mutationTail = result.catch(() => undefined);
    return result;
  }

  function current(owner, epoch, allowReset = false) {
    return epoch === mutationEpoch && !!user && user.id === owner &&
      store.ownerMatches(owner) && (allowReset || !resetting);
  }

  function capturedOwnerActive(owner) {
    return owner == null ? !user && store.owner() == null :
      !!user && user.id === owner && store.ownerMatches(owner);
  }

  function replaceStaleGeneration(owner, generation, options = {}) {
    const localGeneration = store.syncGeneration(owner);
    if (generation < localGeneration) {
      const error = new Error("stale-generation-response");
      error.code = "stale_generation";
      throw error;
    }
    if (generation === localGeneration) return false;

    const active = capturedOwnerActive(owner);
    store.resetLearning(owner, { generation, announce: active });
    if (active && window.Gamify && typeof window.Gamify.reset === "function") {
      window.Gamify.reset({ storageAlreadyCleared: true });
    }
    if (options.invalidate === true) mutationEpoch++;
    if (active) {
      emit("iewt:progress-reset", { owner, generation, remote: true });
      emit("iewt:synced", { owner, progressComplete: true, statsComplete: true, masteryComplete: true, placementComplete: true, reset: true, remote: true });
    }
    return true;
  }

  function acceptGeneration(payload, owner) {
    const generation = payloadGeneration(payload);
    return { generation, replaced: replaceStaleGeneration(owner, generation) };
  }

  function handleGenerationConflict(error, owner) {
    const generation = parseGeneration(error && error.generation);
    if (!error || error.code !== "reset_required" || generation == null) return false;
    if (generation <= store.syncGeneration(owner)) return false;
    return replaceStaleGeneration(owner, generation, { invalidate: true });
  }

  function doneSet(value) {
    return new Set(Array.isArray(value && value.done) ?
      value.done.filter((index) => Number.isInteger(index) && index >= 0) : []);
  }

  function mergeLocalProgress(model, done) {
    if (typeof model !== "string" || !Array.isArray(done)) return null;
    const progress = store.progress();
    const union = new Set([...doneSet(progress[model]), ...doneSet({ done })]);
    progress[model] = { done: [...union].sort((a, b) => a - b) };
    const saved = store.setProgress(progress);
    return saved[model] && saved[model].done;
  }

  function followingDay(value) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function mergeLocalActivity(stats) {
    const state = store.gamify();
    const activityDay = store.normalizeDay(stats && stats.last);
    const currentDay = store.normalizeDay(state.last);
    if (activityDay && (!currentDay || activityDay > currentDay)) {
      state.streak = currentDay && followingDay(currentDay) === activityDay ?
        Math.min(100000, (state.streak || 0) + 1) : 1;
      state.last = activityDay;
    }
    return store.setGamify(state);
  }

  function validMasteryItem(value) {
    return typeof value === "string" && /^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value);
  }

  function newAttemptId() {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);
    return "r_" + [...bytes].map((value) => value.toString(36)).join("_");
  }

  function validAttemptId(value) {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
  }

  function localDay() {
    const date = new Date();
    const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    // The server rejects any activity day beyond UTC-tomorrow (a local calendar
    // can sit one day ahead of UTC near midnight). Clamp a fast clock to that
    // ceiling so we never queue an attempt the server will permanently 400.
    const max = new Date(Date.now() + 86400000);
    const utcMax = `${max.getUTCFullYear()}-${String(max.getUTCMonth() + 1).padStart(2, "0")}-${String(max.getUTCDate()).padStart(2, "0")}`;
    return local <= utcMax ? local : utcMax;
  }

  const PLACEMENT_BANDS = new Set(["foundation", "applied", "advanced"]);
  const PLACEMENT_TOPICS = new Set(["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"]);

  function placementValue(value) {
    if (value == null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !PLACEMENT_BANDS.has(value.band) || !PLACEMENT_TOPICS.has(value.recommendedTopic)) return undefined;
    const completedDay = store.normalizeDay(value.completedDay);
    const expectedBand = value.score <= 6 ? "foundation" : value.score <= 11 ? "applied" : "advanced";
    const latestDay = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!Number.isSafeInteger(value.score) || value.total !== 15 || value.score < 0 || value.score > value.total ||
        value.band !== expectedBand || !completedDay || completedDay > latestDay) return undefined;
    return {
      band: value.band,
      score: value.score,
      total: value.total,
      completedDay,
      recommendedTopic: value.recommendedTopic,
    };
  }

  function saveMasteryRecord(itemId, record) {
    const mastery = store.mastery();
    mastery[itemId] = record;
    const saved = store.setMastery(mastery);
    if (!saved[itemId]) throw new Error("invalid-mastery-record");
    return saved[itemId];
  }

  function saveSkillRecord(skillId, record) {
    const mastery = store.skillMastery();
    mastery[skillId] = record;
    const saved = store.setSkillMastery(mastery);
    if (!saved[skillId]) throw new Error("invalid-skill-mastery-record");
    return saved[skillId];
  }

  // A 4xx that is not a generation/reset conflict (e.g. a validation reject on a
  // malformed day or an item dropped by payload regeneration) will never
  // succeed on retry. Draining must drop it and move on, or one poison event
  // blocks every attempt queued behind it forever. Missing/5xx status ⇒ network
  // or server transient ⇒ keep and retry later.
  function isPoison(error) {
    if (!error || typeof error.status !== "number" || error.status < 400 || error.status >= 500) return false;
    return error.code !== "reset_required" && error.code !== "invalid_generation" && error.code !== "stale_generation";
  }

  async function flushSkillOutbox(owner, epoch, generation) {
    let complete = true;
    for (const event of store.skillOutbox()) {
      if (!current(owner, epoch)) return false;
      try {
        const payload = await putJSON("/api/v2/attempt", event, owner, generation);
        if (!current(owner, epoch)) return false;
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return false;
        if (!payload.record || typeof payload.record !== "object" || Array.isArray(payload.record)) throw new Error("invalid-skill-response");
        saveSkillRecord(event.skillId, payload.record);
        store.removeSkillAttempt(event.attemptId);
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "skills", error: error.code || error.message });
        complete = false;
        if (isPoison(error)) { store.removeSkillAttempt(event.attemptId); continue; }
        break;
      }
    }
    return complete && store.skillOutbox().length === 0;
  }

  function mergeStableProgress(remote, local) {
    const merged = {};
    for (const source of [remote, local]) {
      for (const [courseId, value] of Object.entries(source || {})) {
        const done = new Set((merged[courseId] && merged[courseId].done) || []);
        for (const stageId of Array.isArray(value && value.done) ? value.done : []) done.add(stageId);
        merged[courseId] = { done: [...done] };
      }
    }
    return store.setStableProgress(merged);
  }

  async function pullAcademyState(payload, owner, epoch, generation) {
    if (!payload || !Object.hasOwn(payload, "stableProgress")) return { stableComplete: false, skillComplete: false, preferencesComplete: false, projectsComplete: false };
    let stableComplete = false, skillComplete = false, preferencesComplete = false, projectsComplete = false;

    try {
      const remote = payload.stableProgress;
      if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-stable-progress");
      const merged = mergeStableProgress(remote, store.stableProgress());
      for (const [courseId, value] of Object.entries(merged)) {
        const remoteDone = new Set(Array.isArray(remote[courseId] && remote[courseId].done) ? remote[courseId].done : []);
        for (const stageId of value.done) {
          if (remoteDone.has(stageId)) continue;
          const saved = await putJSON("/api/v2/progress", { courseId, stageId, complete: true }, owner, generation);
          if (!current(owner, epoch)) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
          const accepted = acceptGeneration(saved, owner);
          if (accepted.generation !== generation || accepted.replaced) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
        }
      }
      stableComplete = true;
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "stable-progress", error: error.code || error.message });
    }

    try {
      if (!payload.skillMastery || typeof payload.skillMastery !== "object" || Array.isArray(payload.skillMastery)) throw new Error("invalid-skill-mastery");
      store.setSkillMastery(payload.skillMastery);
      skillComplete = await flushSkillOutbox(owner, epoch, generation);
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "skills", error: error.code || error.message });
    }

    try {
      const local = store.preferences();
      const selected = accountScopeExisted ? payload.preferences : local;
      const saved = accountScopeExisted ? { preferences: selected, generation } :
        await putJSON("/api/v2/preferences", selected, owner, generation);
      if (!current(owner, epoch)) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
      const accepted = acceptGeneration(saved, owner);
      if (accepted.generation !== generation || accepted.replaced || !saved.preferences) throw new Error("invalid-preferences-response");
      store.setPreferences(saved.preferences);
      preferencesComplete = true;
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "preferences", error: error.code || error.message });
    }

    try {
      if (!payload.projects || typeof payload.projects !== "object" || Array.isArray(payload.projects)) throw new Error("invalid-projects");
      const local = store.projects();
      const merged = { ...payload.projects };
      for (const [projectId, value] of Object.entries(local)) {
        const remote = payload.projects[projectId];
        merged[projectId] = {
          mode: value.mode || (remote && remote.mode) || "guided",
          done: [...new Set([...(remote && remote.done || []), ...(value.done || [])])],
        };
      }
      for (const [projectId, value] of Object.entries(merged)) {
        const remote = payload.projects[projectId];
        if (remote && remote.mode === value.mode && remote.done.length === value.done.length && value.done.every((taskId) => remote.done.includes(taskId))) continue;
        const saved = await putJSON("/api/v2/project", { projectId, mode: value.mode, completedTaskIds: value.done }, owner, generation);
        if (!current(owner, epoch)) return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
        const accepted = acceptGeneration(saved, owner);
        if (accepted.generation !== generation || accepted.replaced || !saved.project) throw new Error("invalid-project-response");
        merged[projectId] = saved.project;
      }
      store.setProjects(merged);
      projectsComplete = true;
    } catch (error) {
      handleGenerationConflict(error, owner);
      if (current(owner, epoch)) emit("iewt:sync-error", { area: "projects", error: error.code || error.message });
    }

    return { stableComplete, skillComplete, preferencesComplete, projectsComplete };
  }

  async function flushMasteryOutbox(owner, epoch, generation) {
    let complete = true;
    for (const event of store.masteryOutbox()) {
      if (!current(owner, epoch)) return false;
      try {
        const payload = await putJSON("/api/mastery", event, owner, generation);
        if (!current(owner, epoch)) return false;
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return false;
        if (!payload.record || typeof payload.record !== "object" || Array.isArray(payload.record)) {
          throw new Error("invalid-mastery-response");
        }
        saveMasteryRecord(event.itemId, payload.record);
        store.removeMasteryAttempt(event.attemptId);
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "mastery", error: error.code || error.message });
        complete = false;
        if (isPoison(error)) { store.removeMasteryAttempt(event.attemptId); continue; }
        break;
      }
    }
    return complete && store.masteryOutbox().length === 0;
  }

  async function pullAll(epoch, owner, bootstrapPayload = null) {
    return enqueue(async () => {
      if (!current(owner, epoch)) return false;
      let progressComplete = false, statsComplete = false, masteryComplete = false, placementComplete = false;
      let progressUploaded = false;

      try {
        const payload = bootstrapPayload || await getJSON("/api/progress", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation } = acceptGeneration(payload, owner);
        const remote = payload.progress;
        if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-progress");

        const local = store.progress();
        const combined = { ...remote };
        for (const [model, value] of Object.entries(local)) {
          const union = new Set([...doneSet(remote[model]), ...doneSet(value)]);
          combined[model] = { done: [...union].sort((a, b) => a - b) };
        }
        const merged = store.setProgress(combined);
        const pending = Object.entries(merged).filter(([model, value]) => {
          const remoteDone = doneSet(remote[model]);
          return value.done.some((index) => !remoteDone.has(index));
        });
        if (pending.length) {
          await Promise.all(pending.map(([model, value]) =>
            putJSON("/api/progress", { model, done: value.done }, owner, generation)));
          progressUploaded = true;
        }
        if (!current(owner, epoch)) return false;
        progressComplete = true;
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "progress", error: error.code || error.message });
      }

      try {
        if (!current(owner, epoch)) return false;
        // The bootstrap snapshot precedes any local progress uploads made just
        // above. Refresh stats only in that merge case so derived points match
        // the newly unioned D1 progress; the usual hydration remains one read.
        const payload = bootstrapPayload && !progressUploaded ? bootstrapPayload : await getJSON("/api/stats", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation, replaced } = acceptGeneration(payload, owner);
        if (replaced) progressComplete = false;
        const remote = payload.stats;
        if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-stats");
        if (window.Gamify) {
          window.Gamify.merge(remote, { progressComplete });
          const local = window.Gamify.get();
          const remoteLast = store.normalizeDay(remote.last);
          const remoteStreak = Number.isSafeInteger(Number(remote.streak)) ? Number(remote.streak) : 0;
          // Streak writes are needed only when this device contributed newer
          // activity. Points are always derived by the Worker from progress.
          if (local.last !== remoteLast || local.streak !== remoteStreak) {
            const saved = await putJSON("/api/stats", { streak: local.streak || 0, last: local.last || null }, owner, generation);
            if (!current(owner, epoch)) return false;
            if (saved.stats) window.Gamify.merge(saved.stats, { progressComplete });
          }
        }
        statsComplete = true;
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "stats", error: error.code || error.message });
      }

      try {
        if (!current(owner, epoch)) return false;
        const payload = bootstrapPayload || await getJSON("/api/mastery", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation, replaced } = acceptGeneration(payload, owner);
        if (replaced) { progressComplete = false; statsComplete = false; }
        const remote = payload.mastery;
        if (!remote || typeof remote !== "object" || Array.isArray(remote)) throw new Error("invalid-mastery");
        store.setMastery(remote);
        masteryComplete = await flushMasteryOutbox(owner, epoch, generation);
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "mastery", error: error.code || error.message });
      }

      try {
        if (!current(owner, epoch)) return false;
        const payload = bootstrapPayload || await getJSON("/api/placement", {
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!current(owner, epoch)) return false;
        const { generation, replaced } = acceptGeneration(payload, owner);
        if (replaced) { progressComplete = false; statsComplete = false; masteryComplete = false; }
        const remote = placementValue(payload.placement);
        if (remote === undefined) throw new Error("invalid-placement");
        const local = store.placement();
        let selected = remote;
        if (local && (!remote || local.completedDay >= remote.completedDay)) {
          const saved = await putJSON("/api/placement", local, owner, generation);
          if (!current(owner, epoch)) return false;
          const accepted = acceptGeneration(saved, owner);
          if (accepted.generation !== generation || accepted.replaced) return false;
          selected = placementValue(saved.placement);
          if (selected === undefined || selected == null) throw new Error("invalid-placement-response");
        }
        store.setPlacement(selected);
        placementComplete = true;
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "placement", error: error.code || error.message });
      }

      if (!current(owner, epoch)) return false;
      const academy = await pullAcademyState(bootstrapPayload, owner, epoch, store.syncGeneration(owner));
      if (!current(owner, epoch)) return false;
      emit("iewt:synced", { owner, progressComplete, statsComplete, masteryComplete, placementComplete, ...academy });
      return progressComplete && statsComplete && masteryComplete && placementComplete &&
        Object.values(academy).every(Boolean);
    });
  }

  function safeResetError(error) {
    const wrapped = new Error("Your account progress could not be reset. Nothing was removed from this device.");
    wrapped.code = error && error.code ? error.code : "reset_failed";
    wrapped.status = error && error.status;
    return wrapped;
  }

  async function resetProgress() {
    await ready;
    if (resetPromise) return resetPromise;

    const signedIn = !!user;
    const owner = user && user.id;
    const epoch = ++mutationEpoch;
    resetting = true;
    setStatus("resetting");
    emit("iewt:reset-state", { state: "starting", signedIn });

    const operation = enqueue(async () => {
      // A signed-in reset is server-first. A failed DELETE preserves local
      // state; a successful DELETE always clears the owner captured above,
      // even if another account becomes active while the request is pending.
      if (signedIn) {
        if (!backend || !current(owner, epoch, true)) throw new Error("account-changed");
        const payload = await deleteProgress(owner);
        const generation = payloadGeneration(payload);
        const active = capturedOwnerActive(owner);
        const cleared = store.resetLearning(owner, { generation, announce: active });
        if (active && window.Gamify && typeof window.Gamify.reset === "function") {
          window.Gamify.reset({ storageAlreadyCleared: true });
        }
        const result = { ok: true, signedIn, owner, generation, active, cleared };
        if (active) {
          emit("iewt:progress-reset", result);
          emit("iewt:synced", { owner, progressComplete: true, statsComplete: true, masteryComplete: true, placementComplete: true, reset: true, generation });
          setStatus("ready");
        } else if (authStatus === "resetting") {
          setStatus("account-changed");
        }
        emit("iewt:reset-state", { state: "success", signedIn, owner, active, generation });
        return result;
      }

      const generation = store.syncGeneration(null);
      const active = capturedOwnerActive(null);
      const cleared = store.resetLearning(null, { generation, announce: active });
      if (active && window.Gamify && typeof window.Gamify.reset === "function") {
        window.Gamify.reset({ storageAlreadyCleared: true });
      }
      const result = { ok: true, signedIn, owner: null, generation, active, cleared };
      if (active) {
        emit("iewt:progress-reset", result);
        emit("iewt:synced", { owner: null, progressComplete: true, statsComplete: true, masteryComplete: true, placementComplete: true, reset: true, generation });
        setStatus(backend ? "ready" : "offline");
      } else if (authStatus === "resetting") {
        setStatus("account-changed");
      }
      emit("iewt:reset-state", { state: "success", signedIn, owner: null, active, generation });
      return result;
    });

    resetPromise = operation.catch((error) => {
      const safe = safeResetError(error);
      if (capturedOwnerActive(owner)) setStatus("error", safe.message);
      else if (authStatus === "resetting") setStatus("account-changed");
      emit("iewt:reset-state", { state: "error", signedIn, error: safe.message, code: safe.code });
      throw safe;
    }).finally(() => {
      resetting = false;
      resetPromise = null;
    });
    return resetPromise;
  }

  async function recordMasteryAttempt(itemId, options = {}) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    if (!validMasteryItem(itemId) || typeof options.correct !== "boolean" || typeof options.hinted !== "boolean") {
      throw new TypeError("Invalid mastery attempt");
    }
    const day = store.normalizeDay(options.day || localDay());
    const attemptId = options.attemptId || newAttemptId();
    if (!day || !validAttemptId(attemptId)) throw new TypeError("Invalid mastery attempt");
    const scheduler = window.MasteryScheduler;
    if (!scheduler || typeof scheduler.apply !== "function") throw new Error("Review engine is unavailable.");

    const event = { itemId, correct: options.correct, hinted: options.hinted, attemptId, day };
    const previous = store.mastery()[itemId] || null;
    const localRecord = saveMasteryRecord(itemId, scheduler.apply(previous, {
      correct: event.correct,
      hinted: event.hinted,
      attemptId: event.attemptId,
      today: event.day,
    }));
    store.queueMasteryAttempt(event);
    emit("iewt:mastery-state", { itemId, record: localRecord, synced: false });

    if (!backend || !user) return { record: localRecord, synced: false };
    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { record: localRecord, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/mastery", event, owner, generation);
        if (!current(owner, epoch)) return { record: localRecord, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return { record: localRecord, synced: false };
        if (!payload.record || typeof payload.record !== "object" || Array.isArray(payload.record)) {
          throw new Error("invalid-mastery-response");
        }
        const record = saveMasteryRecord(itemId, payload.record);
        store.removeMasteryAttempt(attemptId);
        emit("iewt:mastery-state", { itemId, record, synced: true, duplicate: !!payload.duplicate });
        return { record, synced: true, duplicate: !!payload.duplicate };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "mastery", error: error.code || error.message });
        return { record: localRecord, synced: false };
      }
    });
  }

  async function recordSkillAttempt(skillId, itemId, options = {}) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    if (!validMasteryItem(skillId) || !validMasteryItem(itemId) || typeof options.correct !== "boolean" || typeof options.hinted !== "boolean") {
      throw new TypeError("Invalid skill attempt");
    }
    const day = store.normalizeDay(options.day || localDay());
    const attemptId = options.attemptId || newAttemptId();
    if (!day || !validAttemptId(attemptId)) throw new TypeError("Invalid skill attempt");
    const scheduler = window.SkillMasteryScheduler;
    if (!scheduler || typeof scheduler.apply !== "function") throw new Error("Skill mastery engine is unavailable.");
    const event = { skillId, itemId, correct: options.correct, hinted: options.hinted, attemptId, day };
    const previous = store.skillMastery()[skillId] || null;
    const localRecord = saveSkillRecord(skillId, scheduler.apply(previous, {
      correct: event.correct,
      hinted: event.hinted,
      attemptId: event.attemptId,
      today: event.day,
    }));
    store.queueSkillAttempt(event);
    emit("iewt:skill-state", { skillId, record: localRecord, synced: false });
    if (!backend || !user) return { record: localRecord, synced: false };

    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { record: localRecord, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/v2/attempt", event, owner, generation);
        if (!current(owner, epoch)) return { record: localRecord, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return { record: localRecord, synced: false };
        const record = saveSkillRecord(skillId, payload.record);
        store.removeSkillAttempt(attemptId);
        emit("iewt:skill-state", { skillId, record, synced: true, duplicate: !!payload.duplicate });
        return { record, synced: true, duplicate: !!payload.duplicate };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "skills", error: error.code || error.message });
        return { record: localRecord, synced: false };
      }
    });
  }

  async function savePreferences(value) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    const local = store.setPreferences(value);
    emit("iewt:preferences-state", { preferences: local, synced: false });
    if (!backend || !user) return { preferences: local, synced: false };
    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { preferences: local, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/v2/preferences", local, owner, generation);
        if (!current(owner, epoch)) return { preferences: local, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced || !payload.preferences) return { preferences: local, synced: false };
        const saved = store.setPreferences(payload.preferences);
        emit("iewt:preferences-state", { preferences: saved, synced: true });
        return { preferences: saved, synced: true };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "preferences", error: error.code || error.message });
        return { preferences: local, synced: false };
      }
    });
  }

  async function saveProject(projectId, mode, completedTaskIds) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    const projects = store.projects();
    projects[projectId] = { mode, done: completedTaskIds };
    const local = store.setProjects(projects);
    if (!local[projectId]) throw new TypeError("Invalid project progress");
    emit("iewt:project-state", { projectId, project: local[projectId], synced: false });
    if (!backend || !user) return { project: local[projectId], synced: false };
    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { project: local[projectId], synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/v2/project", { projectId, mode: local[projectId].mode, completedTaskIds: local[projectId].done }, owner, generation);
        if (!current(owner, epoch)) return { project: local[projectId], synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced || !payload.project) return { project: local[projectId], synced: false };
        local[projectId] = payload.project;
        store.setProjects(local);
        emit("iewt:project-state", { projectId, project: payload.project, synced: true });
        return { project: payload.project, synced: true };
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "projects", error: error.code || error.message });
        return { project: local[projectId], synced: false };
      }
    });
  }

  async function savePlacement(value) {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    const placement = placementValue(value);
    if (!placement) throw new TypeError("Invalid placement result");
    const local = store.setPlacement(placement);
    emit("iewt:placement-state", { placement: local, synced: false });
    if (!backend || !user) return { placement: local, synced: false };

    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) return { placement: local, synced: false };
      const generation = store.syncGeneration(owner);
      try {
        const payload = await putJSON("/api/placement", local, owner, generation);
        if (!current(owner, epoch)) return { placement: local, synced: false };
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) return { placement: local, synced: false };
        const saved = placementValue(payload.placement);
        if (!saved) throw new Error("invalid-placement-response");
        store.setPlacement(saved);
        emit("iewt:placement-state", { placement: saved, synced: true });
        return { placement: saved, synced: true };
      } catch (error) {
        const reset = handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "placement", error: error.code || error.message });
        if (reset) return { placement: null, synced: false, saved: false, reset: true };
        return { placement: local, synced: false, saved: true };
      }
    });
  }

  async function clearPlacement() {
    if (authStatus === "checking" || authStatus === "syncing") await ready;
    if (resetting) throw new Error("Learning data is being reset. Try again in a moment.");
    if (!backend || !user) {
      store.setPlacement(null);
      emit("iewt:placement-state", { placement: null, synced: false, cleared: true });
      return { placement: null, synced: false };
    }

    const owner = user.id, epoch = mutationEpoch;
    return enqueue(async () => {
      if (!current(owner, epoch)) throw new Error("account-changed");
      const generation = store.syncGeneration(owner);
      try {
        const payload = await deletePlacement(owner, generation);
        if (!current(owner, epoch)) throw new Error("account-changed");
        const accepted = acceptGeneration(payload, owner);
        if (accepted.generation !== generation || accepted.replaced) throw new Error("reset-required");
        store.setPlacement(null);
        emit("iewt:placement-state", { placement: null, synced: true, cleared: true });
        return { placement: null, synced: true };
      } catch (error) {
        const reset = handleGenerationConflict(error, owner);
        if (reset) {
          emit("iewt:placement-state", { placement: null, synced: true, cleared: true, reset: true });
          return { placement: null, synced: true, reset: true };
        }
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "placement", error: error.code || error.message });
        throw error;
      }
    });
  }

  const Auth = {
    user() { return user; },
    isSignedIn() { return !!user; },
    hasBackend() { return backend; },
    status() { return authStatus; },
    error() { return lastError; },
    isResetting() { return resetting; },
    whenReady() { return ready; },
    signIn() {
      if (backend) location.href = "/auth/google";
      else window.toast("Google sign-in is unavailable right now. Progress is still saved on this device.");
    },
    async signOut() {
      if (!backend || !user || resetting) return false;
      const owner = user.id;
      const epoch = ++mutationEpoch;
      setStatus("signing-out");
      try {
        await getJSON("/auth/logout", {
          method: "POST",
          headers: ownerHeaders(owner, { Accept: "application/json" }),
        });
        if (!user || user.id !== owner || epoch !== mutationEpoch) return false;
        user = null;
        store.bindOwner(null, { claimAnonymous: false, announce: true });
        setStatus("ready");
        location.href = "/lab/";
        return true;
      } catch (error) {
        if (user && user.id === owner && epoch === mutationEpoch) {
          setStatus("error", "Sign out could not be completed.");
          window.toast("Sign out could not be completed. Your account and saved progress are unchanged.");
        }
        return false;
      }
    },
    async pushProgress(model, done) {
      // A course interaction can land during the initial account request. Wait
      // for owner binding, then merge that exact interaction into the verified
      // account scope instead of leaking the whole anonymous/device profile.
      const waitedForOwner = authStatus === "checking" || authStatus === "syncing";
      if (waitedForOwner && !resetting) await ready;
      if (!backend || !user || resetting) return false;
      const owner = user.id, epoch = mutationEpoch;
      let transferable = done;
      if (waitedForOwner && accountScopeExisted) {
        const baseline = doneSet(bootAnonymousProgress[model]);
        transferable = Array.isArray(done) ? done.filter((index) => !baseline.has(index)) : done;
      }
      const completed = mergeLocalProgress(model, transferable);
      if (!completed) return false;
      if (waitedForOwner && accountScopeExisted) store.removeAnonymousProgress(model, transferable);
      emit("iewt:synced", { owner, progressComplete: false, statsComplete: false, local: true });
      return enqueue(async () => {
        if (!current(owner, epoch)) return false;
        const generation = store.syncGeneration(owner);
        try {
          await putJSON("/api/progress", { model, done: completed }, owner, generation);
          return current(owner, epoch);
        } catch (error) {
          handleGenerationConflict(error, owner);
          if (current(owner, epoch)) emit("iewt:sync-error", { area: "progress", error: error.code || error.message });
          return false;
        }
      });
    },
    async pushStableProgress(courseId, stageId) {
      const waitedForOwner = authStatus === "checking" || authStatus === "syncing";
      if (waitedForOwner && !resetting) await ready;
      if (resetting || typeof courseId !== "string" || typeof stageId !== "string") return false;
      const progress = store.stableProgress();
      const done = new Set(Array.isArray(progress[courseId] && progress[courseId].done) ? progress[courseId].done : []);
      done.add(stageId);
      progress[courseId] = { done: [...done] };
      const saved = store.setStableProgress(progress);
      if (!saved[courseId] || !saved[courseId].done.includes(stageId)) return false;
      if (!backend || !user) return true;
      const owner = user.id, epoch = mutationEpoch;
      if (waitedForOwner && accountScopeExisted) {
        const baseline = new Set((bootAnonymousStableProgress[courseId] && bootAnonymousStableProgress[courseId].done) || []);
        if (!baseline.has(stageId)) store.removeAnonymousStableProgress(courseId, [stageId]);
      }
      return enqueue(async () => {
        if (!current(owner, epoch)) return false;
        const generation = store.syncGeneration(owner);
        try {
          await putJSON("/api/v2/progress", { courseId, stageId, complete: true }, owner, generation);
          return current(owner, epoch);
        } catch (error) {
          handleGenerationConflict(error, owner);
          if (current(owner, epoch)) emit("iewt:sync-error", { area: "stable-progress", error: error.code || error.message });
          return false;
        }
      });
    },
    async pushStats(stats) {
      const waitedForOwner = authStatus === "checking" || authStatus === "syncing";
      if (waitedForOwner && !resetting) await ready;
      if (!backend || !user || resetting) return false;
      const owner = user.id, epoch = mutationEpoch;
      const local = mergeLocalActivity(stats);
      if (waitedForOwner && accountScopeExisted) store.setAnonymousGamify(bootAnonymousGamify);
      const snapshot = { streak: local.streak || 0, last: local.last || null };
      return enqueue(async () => {
        if (!current(owner, epoch)) return false;
        const generation = store.syncGeneration(owner);
        try {
          const saved = await putJSON("/api/stats", snapshot, owner, generation);
          if (!current(owner, epoch)) return false;
          if (saved.stats && window.Gamify) window.Gamify.merge(saved.stats);
          return true;
        } catch (error) {
          handleGenerationConflict(error, owner);
          if (current(owner, epoch)) emit("iewt:sync-error", { area: "stats", error: error.code || error.message });
          return false;
        }
      });
    },
    recordMasteryAttempt,
    recordSkillAttempt,
    savePreferences,
    saveProject,
    savePlacement,
    clearPlacement,
    resetProgress,
    resetLearningData: resetProgress,
  };

  async function initialPayload() {
    try {
      return {
        payload: await getJSON("/api/v2/bootstrap", { headers: { Accept: "application/json" } }),
        bootstrap: true,
        academy: true,
      };
    } catch (error) {
      // During a rolling deploy, an older Worker can serve a newly cached
      // client. Only a route-level absence falls back; real backend failures
      // remain visible instead of being masked by a second request sequence.
      if (!error || (error.status !== 404 && error.status !== 405)) throw error;
      try {
        return {
          payload: await getJSON("/api/bootstrap", { headers: { Accept: "application/json" } }),
          bootstrap: true,
          academy: false,
        };
      } catch (legacyError) {
        if (!legacyError || (legacyError.status !== 404 && legacyError.status !== 405)) throw legacyError;
        return {
          payload: await getJSON("/api/me", { headers: { Accept: "application/json" } }),
          bootstrap: false,
          academy: false,
        };
      }
    }
  }

  async function init() {
    setStatus("checking");
    try {
      const initial = await initialPayload();
      const payload = initial.payload;
      backend = true;
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("user" in payload)) {
        throw new Error("invalid-user-response");
      }
      if (payload.user != null && (!payload.user || typeof payload.user.id !== "string" || !payload.user.id.trim())) {
        throw new Error("invalid-user");
      }
      user = payload.user ? { ...payload.user, id: payload.user.id.trim() } : null;
      accountScopeExisted = !!user && store.hasOwnerState(user.id);
      store.bindOwner(user && user.id, { claimAnonymous: true, announce: true });
      if (user) {
        setStatus("syncing");
        await pullAll(mutationEpoch, user.id, initial.bootstrap ? payload : null);
      }
      if (authStatus !== "account-changed") setStatus("ready");
    } catch (error) {
      backend = false;
      user = null;
      // A network failure does not prove that another tab signed out, so do
      // not overwrite the cross-tab owner marker. This page stays anonymous.
      store.bindOwner(null, { claimAnonymous: false, announce: false });
      setStatus("offline", error && error.message ? error.message : "offline");
    } finally {
      resolveReady();
      emit("iewt:auth-ready", { status: authStatus, user });
    }
  }

  document.addEventListener("iewt:owner-external", (event) => {
    const observed = event.detail && event.detail.owner;
    if (!user || observed === user.id) return;
    // Another tab verified a different account (or signed out). Stop using the
    // stale cookie/account association immediately; a navigation will perform
    // a fresh account check before this tab can sync again.
    mutationEpoch++;
    user = null;
    store.bindOwner(null, { claimAnonymous: false, announce: false });
    setStatus("account-changed");
    emit("iewt:auth-ready", { status: authStatus, user: null });
    emit("iewt:synced", { owner: null, progressComplete: false, statsComplete: false, masteryComplete: false, placementComplete: false });
  });

  window.Auth = Object.freeze(Auth);
  void init();
})();
