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
  // course interaction. If /api/me resolves to a returning account, only the
  // post-snapshot delta is transferred; pre-existing anonymous work remains an
  // isolated device profile.
  const bootAnonymousProgress = store.progress();
  const bootAnonymousGamify = store.gamify();
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
      emit("iewt:synced", { owner, progressComplete: true, statsComplete: true, reset: true, remote: true });
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

  async function pullAll(epoch, owner) {
    return enqueue(async () => {
      if (!current(owner, epoch)) return false;
      let progressComplete = false, statsComplete = false;

      try {
        const payload = await getJSON("/api/progress", {
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
        }
        if (!current(owner, epoch)) return false;
        progressComplete = true;
      } catch (error) {
        handleGenerationConflict(error, owner);
        if (current(owner, epoch)) emit("iewt:sync-error", { area: "progress", error: error.code || error.message });
      }

      try {
        if (!current(owner, epoch)) return false;
        const payload = await getJSON("/api/stats", {
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

      if (!current(owner, epoch)) return false;
      emit("iewt:synced", { owner, progressComplete, statsComplete });
      return progressComplete && statsComplete;
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
          emit("iewt:synced", { owner, progressComplete: true, statsComplete: true, reset: true, generation });
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
        emit("iewt:synced", { owner: null, progressComplete: true, statsComplete: true, reset: true, generation });
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
      // A course interaction can land during the initial /api/me request. Wait
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
    resetProgress,
    resetLearningData: resetProgress,
  };

  async function init() {
    setStatus("checking");
    try {
      const payload = await getJSON("/api/me", { headers: { Accept: "application/json" } });
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
        await pullAll(mutationEpoch, user.id);
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
    // a fresh /api/me check before this tab can sync again.
    mutationEpoch++;
    user = null;
    store.bindOwner(null, { claimAnonymous: false, announce: false });
    setStatus("account-changed");
    emit("iewt:auth-ready", { status: authStatus, user: null });
    emit("iewt:synced", { owner: null, progressComplete: false, statsComplete: false });
  });

  window.Auth = Object.freeze(Auth);
  void init();
})();
