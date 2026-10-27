(() => {
  "use strict";
  const U = window.FlowsUI;
  const root = document.getElementById("fxMember");
  if (!U || !root || U.member) return;
  const { h, F, glyph } = U;
  const DASH = U.DASH;
  const PAGE = root.getAttribute("data-page") || "";
  const EXPORTS = root.getAttribute("data-exports") === "1";
  const NAME_RAW = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/;
  const REASON = { "not a ticker symbol": "format", "a reserved test name": "fixture", "not in the universe": "universe" };
  const grouped = (n) => Number(n).toLocaleString("en-US");
  const plural = (n, one, many) => grouped(n) + " " + (n === 1 ? one : many);

  const TEXT = {
    invalid: (n) => n + " is not a valid ticker.",
    uncovered: (n) => n + " is not a covered ticker.",
    full: (max) => "My list holds " + max + " names. Remove one to add another.",
    cannotCheck: "Could not check the ticker list. Try again.",
    notSaved: "Not saved.",
    conflict: "My list changed elsewhere. Close it and open it again.",
    unreadable: "Your saved list could not be read.",
    starUnreadable: "Your saved list could not be read. Open My list.",
    load: "Could not load. Reload the page.",
    ended: "Your session has ended. Sign in again.",
    keyAbsent: "Saving to your account is not available yet. This list stays on this device.",
    starOn: (n) => n + " added to My list.",
    starOff: (n) => n + " removed from My list.",
    starNot: (n) => "Not saved. " + n + " is not in My list.",
    starStill: (n) => "Not saved. " + n + " is still in My list.",
    paused: "Exports from this page are paused.",
    unavailable: "Exports are not available right now.",
    unreached: "Export failed. We could not reach the server.",
    failed: "Export failed. Try again in a moment.",
  };

  const model = {
    NAME_RAW,
    normalize(text) {
      const t = String(text == null ? "" : text).trim();
      return NAME_RAW.test(t) ? { ok: true, name: t.toUpperCase() } : { ok: false, name: t };
    },
    union: (list, names) => [...new Set([...list, ...names])].sort(),
    drop: (list, name) => list.filter((n) => n !== name),
    ifMatch: (version) => '"w' + version + '"',
    rejectedText(body) {
      if (body && typeof body.limit === "number") return TEXT.full(body.limit);
      const r = body && Array.isArray(body.rejected) ? body.rejected[0] : null;
      if (!r) return TEXT.notSaved;
      const name = r.ticker === null || r.ticker === undefined ? "" : String(r.ticker);
      const kind = REASON[r.reason];
      if (kind === "format") return TEXT.invalid(name);
      if (kind === "universe" || kind === "fixture") return TEXT.uncovered(name);
      return TEXT.notSaved;
    },
    waitText(header) {
      const s = Number(header);
      if (!Number.isFinite(s) || s < 1 || s > 3600) return "Too many requests. Try again in a minute.";
      if (s <= 45) return "Too many requests. Try again in " + Math.ceil(s) + (Math.ceil(s) === 1 ? " second." : " seconds.");
      const m = Math.ceil(s / 60);
      return "Too many requests. Try again in " + (m === 1 ? "a minute." : m + " minutes.");
    },
    quotaText(win, serverNow) {
      const left = Math.max(0, win.cap - win.used);
      if (left > 0) return left + " of " + win.cap + " exports left in 24 hours.";
      if (!Number.isFinite(win.freesAtMs)) return "Export limit reached.";
      const later = Number.isFinite(serverNow) && F.trtDay(win.freesAtMs) !== F.trtDay(serverNow);
      return "Export limit reached. Next export available " + (later ? "tomorrow at " : "at ") + F.time(win.freesAtMs) + ".";
    },
    fileName(disposition, page, format, now) {
      const d = String(disposition || "");
      let name = null;
      const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(d);
      if (star) { try { name = decodeURIComponent(star[1].trim()); } catch { name = null; } }
      if (!name) {
        const plain = /filename\s*=\s*"([^"]*)"/i.exec(d) || /filename\s*=\s*([^;]+)/i.exec(d);
        if (plain) name = plain[1].trim();
      }
      const bad = "\\/:*?\"<>|";
      const clean = name ? name.split("").filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127 && !bad.includes(c)).join("").replace(/^\.+/, "").slice(0, 100) : "";
      return /\.[A-Za-z0-9]{2,4}$/.test(clean) ? clean : "flows-" + page + "-" + F.trtDay(now) + "." + format;
    },
    exportedText(rows, available, format, truncated) {
      const kind = format === "csv" ? "CSV" : "JSON";
      if (truncated) return "Exported " + grouped(rows) + " of " + grouped(available) + " rows. The file holds the first " + grouped(rows) + " by ticker.";
      return "Exported " + plural(rows, "row", "rows") + " as " + kind + ".";
    },
    exportError(status, body, headers, now) {
      const code = body && body.error && body.error.code;
      if (status === 0) return TEXT.unreached;
      if (code === "export_held") return TEXT.paused;
      if (status === 403) return TEXT.unavailable;
      if (code === "export_limit") {
        const served = Number.isFinite(body.serverNow) ? body.serverNow : headers ? Date.parse(headers.get("Date") || "") : NaN;
        return model.quotaText({ used: 1, cap: 1, freesAtMs: body.freesAtMs }, Number.isFinite(served) ? served : now);
      }
      if (code === "rate_limited") return model.waitText(headers && headers.get("Retry-After"));
      if (status === 401) return TEXT.ended;
      if (status === 404) return TEXT.unavailable;
      return TEXT.failed;
    },
  };

  async function call(method, url, o = {}) {
    const headers = { Accept: "application/json" };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (o.version !== undefined) headers["If-Match"] = model.ifMatch(o.version);
    let res;
    try {
      res = await fetch(url, { method, credentials: "same-origin", cache: "no-store", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: AbortSignal.timeout?.(15000) });
    } catch {
      return { ok: false, status: 0, json: null, res: null };
    }
    let json = null;
    if (!o.raw || !res.ok) { try { json = await (o.raw ? res.clone() : res).json(); } catch { json = null; } }
    return { ok: res.ok, status: res.status, json, res };
  }

  const S = { loaded: false, at: 0, member: null, mode: "server", reason: null, version: 0, names: [], max: 200, unreadable: false, universe: null, ended: false, unsub: null };
  const listeners = new Set();
  const changed = () => { for (const f of listeners) f(); };

  const device = {
    read(member) {
      try {
        const v = window.IEWTStorage && member ? window.IEWTStorage.flowsWatchlist(member) : null;
        return v && Array.isArray(v.names) ? v.names.slice() : [];
      } catch { return []; }
    },
    write(member, names) {
      try {
        if (!window.IEWTStorage || !member) return { ok: false, saved: false };
        window.IEWTStorage.setFlowsWatchlist(member, { names });
        const back = window.IEWTStorage.flowsWatchlist(member);
        const ok = !!back && Array.isArray(back.names) && back.names.length === names.length && back.names.every((n, i) => n === names[i]);
        return { ok, saved: ok && window.IEWTStorage.flowsWatchlistSaved(member) };
      } catch { return { ok: false, saved: false }; }
    },
    clear(member) {
      try { if (window.IEWTStorage && member) window.IEWTStorage.clearFlowsWatchlist(member); } catch { return; }
    },
    saved(member) {
      try { return !!window.IEWTStorage && window.IEWTStorage.flowsWatchlistSaved(member); } catch { return false; }
    },
  };

  let storing = null;
  const storeReady = () => {
    if (window.IEWTStorage) return Promise.resolve(true);
    if (!storing) {
      storing = Promise.race([U.defer("member-store").then(() => !!window.IEWTStorage), new Promise((ok) => setTimeout(() => ok(false), 8000))]).then((loaded) => {
        if (!loaded) storing = null;
        return loaded;
      });
    }
    return storing;
  };

  function bindStore() {
    if (S.unsub || !S.member || !window.IEWTStorage || !window.IEWTStorage.onFlowsWatchlist) return;
    try {
      S.unsub = window.IEWTStorage.onFlowsWatchlist(S.member, () => { if (S.mode !== "server") { S.names = device.read(S.member); changed(); } });
    } catch { S.unsub = null; }
  }

  function adopt(j) {
    S.member = j.member;
    S.version = j.version;
    S.mode = j.mode === "server" ? "server" : "device";
    S.reason = j.reason || null;
    S.max = j.maxNames || 200;
    S.unreadable = j.unreadable === true;
    S.names = S.mode === "server" ? (Array.isArray(j.watchlist) ? j.watchlist.slice() : []) : device.read(j.member);
    S.loaded = true;
    S.ended = false;
    S.at = Date.now();
    bindStore();
  }

  async function pull() {
    const r = await call("GET", "/api/me/state");
    if (r.status === 401) S.ended = true;
    if (!r.ok || !r.json) return false;
    if (r.json.mode !== "server") await storeReady();
    adopt(r.json);
    return true;
  }

  async function ensure() {
    const ok = await pull();
    return ok || S.loaded;
  }

  let asked = null;
  function universe() {
    if (S.universe) return Promise.resolve(S.universe);
    if (!asked) {
      asked = call("GET", "/api/flows/universe?cols=t").then((r) => {
        asked = null;
        if (r.ok && r.json && r.json.status === "ok" && Array.isArray(r.json.t)) S.universe = new Set(r.json.t);
        return S.universe;
      });
    }
    return asked;
  }

  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.then(() => 0, () => 0);
    return run;
  };

  const same = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

  async function failure(r) {
    const code = r.json && r.json.error && r.json.error.code;
    if (r.status === 401) { S.ended = true; return { ok: false, text: TEXT.ended, ended: true }; }
    if (r.status === 400 && r.json && code === "invalid_watchlist") return { ok: false, text: model.rejectedText(r.json) };
    if (r.status === 429) return { ok: false, text: model.waitText(r.res && r.res.headers.get("Retry-After")), retry: true };
    if (code === "universe_unreadable") return { ok: false, text: TEXT.cannotCheck, retry: true };
    if (code === "unreadable_row") {
      if (!(await pull())) S.unreadable = true;
      changed();
      return S.unreadable ? { ok: false, unreadable: true, text: TEXT.unreadable } : { ok: false, text: TEXT.notSaved, retry: true };
    }
    if (code === "member_state_unavailable") {
      await pull();
      changed();
      return { ok: false, text: TEXT.notSaved + " " + TEXT.keyAbsent };
    }
    return { ok: false, text: TEXT.notSaved, retry: true };
  }

  function writeDevice(next) {
    const list = next(S.names);
    const w = device.write(S.member, list);
    if (!w.ok) return { ok: false, text: TEXT.notSaved, retry: true };
    S.names = list;
    changed();
    return { ok: true };
  }

  function change(next) {
    return serial(async () => {
      let again = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (S.mode !== "server") return writeDevice(next);
        if (S.unreadable) { changed(); return { ok: false, unreadable: true, text: TEXT.unreadable }; }
        const list = next(S.names);
        if (attempt > 0 && same(list, S.names)) { changed(); return { ok: true, again }; }
        const r = await call("PUT", "/api/me/state", { body: { deviceOnly: false, watchlist: list }, version: S.version });
        if (r.ok && r.json) { adopt(r.json); changed(); return { ok: true, again }; }
        if (r.status !== 412) return failure(r);
        if (!(await pull())) return { ok: false, text: TEXT.notSaved, retry: true };
        again = true;
      }
      changed();
      return { ok: false, text: TEXT.conflict };
    });
  }

  function restart() {
    return serial(async () => {
      const r = await call("PUT", "/api/me/state", { body: { deviceOnly: false, watchlist: [], replaceUnreadable: true }, version: S.version });
      if (r.ok && r.json) { adopt(r.json); changed(); return { ok: true }; }
      if (r.status === 412) { await pull(); changed(); return { ok: false, text: TEXT.conflict }; }
      return failure(r);
    });
  }

  function save(name, type, data) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const quota = { win: null, now: null };
  let exporting = false;

  async function download(page, format) {
    if (exporting) return;
    exporting = true;
    const summary = document.querySelector("details[data-member-export] > summary");
    if (summary) summary.setAttribute("aria-busy", "true");
    U.announce("Preparing the file.");
    try {
      const r = await call("POST", "/api/me/export", { body: { page, format }, raw: true });
      if (!r.ok) { U.announce(model.exportError(r.status, r.json, r.res && r.res.headers, Date.now())); return; }
      const blob = await r.res.blob();
      const header = r.res.headers;
      save(model.fileName(header.get("Content-Disposition"), page, format, Date.now()), format === "csv" ? "text/csv;charset=utf-8" : "application/json", blob);
      if (quota.win) quota.win.used += 1;
      U.announce(model.exportedText(Number(header.get("X-Export-Rows")), Number(header.get("X-Export-Available")), format, header.get("X-Export-Truncated") === "1"));
    } finally {
      exporting = false;
      if (summary) summary.removeAttribute("aria-busy");
    }
  }

  function remote() {
    const summary = () => document.querySelector("details[data-member-export] > summary");
    return {
      items: [
        { label: "CSV, nightly figures", limited: true, run: () => download(PAGE, "csv") },
        { label: "JSON, nightly figures", limited: true, run: () => download(PAGE, "json") },
        { label: "Export history", run: () => open("history", summary()) },
      ],
      quota: async () => {
        const r = await call("GET", "/api/me/exports");
        if (!r.ok || !r.json) throw new Error("quota");
        quota.win = r.json.window;
        quota.now = r.json.serverNow;
        return { text: model.quotaText(r.json.window, r.json.serverNow), full: r.json.window.used >= r.json.window.cap };
      },
    };
  }

  function exportMenu(details, event) {
    if (!U.exportMenu || !(details instanceof Element) || details.hasAttribute("data-bound")) return;
    details.setAttribute("data-bound", "");
    U.exportMenu({ el: details, name: "flows-" + PAGE, remote, event });
  }

  function open(kind, opener, cancelled) {
    return (kit.ui ? Promise.resolve() : U.defer("member-ui")).then(() => {
      if (kit.ui) return kit.ui.open(kind, opener, cancelled);
      U.announce(TEXT.load);
      return null;
    });
  }

  async function mountStar() {
    const slot = document.querySelector(".fm-star-slot");
    const title = document.getElementById("ftHeroT");
    if (!slot || !title || slot.querySelector(".fm-star")) return;
    const star = h("button", { type: "button", class: "fm-star", "aria-pressed": "false", "data-member": "", hidden: true }, glyph("star"));
    const current = () => { const n = model.normalize(title.textContent); return n.ok ? n.name : null; };
    const pending = new Map();
    const blocked = () => S.mode === "server" && S.unreadable;
    const paint = () => {
      const t = current();
      const wanted = t && pending.get(t);
      const listed = !!t && (wanted ? wanted.want : S.names.includes(t));
      const covered = !!t && (S.universe ? S.universe.has(t) : S.mode === "server");
      star.hidden = !t || !S.loaded || (!listed && !covered);
      if (star.hidden) return;
      star.setAttribute("aria-label", "Star " + t);
      star.setAttribute("aria-pressed", String(listed));
      star.setAttribute("aria-disabled", String(blocked()));
    };
    const flush = async (t, entry) => {
      let r;
      let sent;
      do {
        entry.dirty = false;
        sent = entry.want;
        r = await change((l) => (sent ? model.union(l, [t]) : model.drop(l, t)));
      } while (r.ok && entry.dirty && entry.want !== sent);
      pending.delete(t);
      paint();
      U.announce(r.ok ? (sent ? TEXT.starOn(t) : TEXT.starOff(t)) : r.ended ? TEXT.ended : r.unreadable ? TEXT.starUnreadable : S.names.includes(t) ? TEXT.starStill(t) : TEXT.starNot(t));
    };
    star.addEventListener("click", () => {
      const t = current();
      if (!t) return;
      if (blocked()) { U.announce(TEXT.starUnreadable); return; }
      const want = star.getAttribute("aria-pressed") !== "true";
      const held = pending.get(t);
      if (held) {
        held.want = want;
        held.dirty = true;
        paint();
        return;
      }
      const entry = { want, dirty: false };
      pending.set(t, entry);
      paint();
      flush(t, entry);
    });
    slot.append(star);
    new MutationObserver(paint).observe(title, { childList: true, characterData: true, subtree: true });
    listeners.add(paint);
    Promise.all([ensure(), universe()]).then(paint);
  }

  const stale = () => {
    if (S.loaded && Date.now() - S.at > 60000) pull().then((ok) => { if (ok) changed(); });
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") stale(); });
  root.addEventListener("member:resume", stale);

  const kit = {
    v: 1, ui: null, U, root, h, F, glyph, DASH, PAGE, EXPORTS, grouped, plural, TEXT, model, S, listeners, changed, device, storeReady, bindStore, call, ensure, pull, universe, serial, change, restart, failure, adopt, save,
  };
  const member = Object.freeze({ open, exportMenu, model, state: () => ({ names: S.names.slice(), mode: S.mode, reason: S.reason, version: S.version }) });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { member, memberKit: kit }));

  mountStar();
})();
