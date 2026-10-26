(() => {
  "use strict";

  const UI = window.FlowsUI;
  const holder = document.querySelector('i[data-defer="ledger-live"]');
  const kit = UI && UI.ledgerKit;
  const rt = UI && UI.rt;
  if (!holder || !kit || !rt || UI.ledgerLive) return;

  const VERIFY_MS = 15000;
  const HIDDEN_REFETCH_MS = 20000;
  const FETCH_MS = 12000;
  const ANNOUNCE_GAP_MS = 10000;
  const TICK_MS = 420;
  const SNAP_MS = 120;
  const DRIFT_PAUSE = 3;
  const SLEEP_MS = 5000;
  const KEEP_ATTRS = new Set(["tabindex", "style"]);
  const KEEP_CLASS = new Set(["cut", "chg"]);

  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  const L = {
    ledger: kit.createLiveLedger(), bridge: null, active: false, paused: null, handle: null, offs: [], skew: 0,
    hidden: document.hidden, hiddenAt: 0, catching: false, caughtAt: null, inflight: null, lag: kit.createSamples(),
    parity: { state: "pending", at: null, text: null }, drift: { runs: 0, count: 0, events: 0, at: null, rebuiltAt: null }, pageOnly: 0, serverReadAt: null,
    timers: { strip: 0, verify: 0 }, view: null, viewKey: "", strip: null, last: null,
    announced: "", announceAt: 0, ticks: new WeakMap(), lastTotal: null, announcedState: "", holdList: false, holdSel: false, lastWall: 0, lastMono: 0,
    counts: { frames: 0, rows: 0, bases: 0, paints: 0, skipped: 0, writes: 0, verifies: 0, fetchFails: 0, snapshots: 0 },
    base: null, dirty: false, raf: 0,
  };

  const nowMs = () => Date.now() + L.skew;

  function loadCss() {
    const href = holder.getAttribute("data-css");
    if (!href || document.querySelector('link[href="' + href + '"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function syncAttrs(a, b) {
    for (const at of Array.from(b.attributes)) {
      const name = at.name;
      if (KEEP_ATTRS.has(name) && a.hasAttribute(name)) continue;
      if (name === "class") {
        const keep = Array.from(a.classList).filter((c) => KEEP_CLASS.has(c));
        const want = new Set([...at.value.split(/\s+/).filter(Boolean), ...keep]);
        const have = new Set(Array.from(a.classList));
        if (want.size !== have.size || [...want].some((c) => !have.has(c))) { a.setAttribute("class", [...want].join(" ")); L.counts.writes++; }
        continue;
      }
      if (a.getAttribute(name) !== at.value) { a.setAttribute(name, at.value); L.counts.writes++; }
    }
    for (const at of Array.from(a.attributes)) {
      if (KEEP_ATTRS.has(at.name) || at.name === "class") continue;
      if (!b.hasAttribute(at.name)) { a.removeAttribute(at.name); L.counts.writes++; }
    }
  }

  function morphChildren(a, b) {
    const A = a.childNodes;
    const B = b.childNodes;
    for (let i = 0; i < B.length; i++) {
      const x = A[i];
      const y = B[i];
      if (!x) {
        a.appendChild(y.cloneNode(true));
        L.counts.writes++;
        continue;
      }
      if (x.nodeType !== y.nodeType || (x.nodeType === 1 && x.tagName !== y.tagName)) {
        a.replaceChild(y.cloneNode(true), x);
        L.counts.writes++;
        continue;
      }
      if (x.nodeType !== 1) {
        if (x.nodeValue !== y.nodeValue) {
          x.nodeValue = y.nodeValue;
          L.counts.writes++;
        }
        continue;
      }
      syncAttrs(x, y);
      morphChildren(x, y);
    }
    while (A.length > B.length) {
      a.removeChild(a.lastChild);
      L.counts.writes++;
    }
  }

  function selecting() {
    const sel = typeof getSelection === "function" ? getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const root = $("sf");
    const range = sel.getRangeAt(0);
    return !!root && root.contains(range.commonAncestorContainer) && !!sel.toString().trim();
  }

  const rowSig = (root) => {
    const table = root.querySelector("table");
    return (table ? table.className : "") + "#" + Array.from(root.querySelectorAll("tbody tr")).map((tr) => tr.getAttribute("data-scope") || tr.getAttribute("data-k") || (tr.cells[0] ? tr.cells[0].textContent : "")).join("|");
  };

  const sameTable = (a, b) => a.slice(0, a.indexOf("#")) === b.slice(0, b.indexOf("#"));

  function interacting(host) {
    if (host.contains(document.activeElement) && document.activeElement !== document.body) return true;
    return matchMedia("(hover: hover)").matches && host.matches(":hover");
  }

  function morph(host, markup) {
    const tpl = document.createElement("template");
    tpl.innerHTML = markup;
    if (host.id === "sfBody") {
      const was = rowSig(host);
      const now = rowSig(tpl.content);
      if (was !== now && sameTable(was, now) && interacting(host)) { L.holdList = true; return -1; }
      L.holdList = false;
    }
    const before = L.counts.writes;
    morphChildren(host, tpl.content);
    return L.counts.writes - before;
  }

  const totalOf = (view) => {
    if (!view || view.status !== "ok" || !L.ledger.engine()) return null;
    const scope = view.scope;
    const snap = L.ledger.engine().snapshot();
    let cents = 0;
    for (const b of snap.books.values()) {
      if (scope.kind === "all" || (scope.kind === "sector" && b.column === scope.sector) || (scope.kind === "name" && b.ticker === scope.name)) cents += b.T;
    }
    return cents;
  };

  function tickTo(el, to) {
    const rec = L.ticks.get(el) || { shown: to, raf: 0, at: 0 };
    L.ticks.set(el, rec);
    cancelAnimationFrame(rec.raf);
    const from = rec.shown;
    const t0 = performance.now();
    const snap = from === to || reduced() || document.hidden || t0 - rec.at < SNAP_MS;
    rec.at = t0;
    if (snap) { rec.shown = to; rec.raf = 0; setText(el, kit.moneyShort(to)); return; }
    const step = (now) => {
      const p = (now - t0) / TICK_MS;
      rec.shown = kit.countFrame(from, to, p);
      el.textContent = kit.moneyShort(rec.shown);
      rec.raf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    rec.raf = requestAnimationFrame(step);
  }

  function decorate(view) {
    const el = $("sfScope");
    const cents = totalOf(view);
    if (!el || cents === null) { L.lastTotal = null; return; }
    const text = kit.moneyShort(cents);
    let n = el.querySelector("b.lv-n");
    if (!n) {
      const node = el.firstChild;
      const at = node && node.nodeType === 3 ? node.nodeValue.indexOf(text) : -1;
      if (at < 0) return;
      const after = node.splitText(at);
      after.nodeValue = after.nodeValue.slice(text.length);
      n = document.createElement("b");
      n.className = "lv-n";
      n.textContent = text;
      el.insertBefore(n, after);
      L.ticks.set(n, { shown: L.lastTotal === null ? cents : L.lastTotal, raf: 0, at: 0 });
    }
    n.dataset.c = String(cents);
    tickTo(n, cents);
    L.lastTotal = cents;
  }

  function statusText() {
    const s = L.paused || "";
    return s;
  }

  function paintNow() {
    const b = L.bridge;
    if (!b || !L.active) return false;
    const st = b.state();
    if (st.period && st.period !== "intraday") return false;
    if (selecting()) { L.holdSel = true; return false; }
    L.holdSel = false;
    const scope = kit.parseScope(st.scope) || kit.ALL_SCOPE;
    const view = L.ledger.view({ now: nowMs(), scope, period: st.period });
    const key = kit.textHash(JSON.stringify(view)) + "|" + st.scope + "|" + (st.group || "") + "|" + st.w;
    L.view = view;
    if (key === L.viewKey && b.painted()) { L.counts.skipped++; return false; }
    L.viewKey = key;
    b.paint(view, L.counts.paints === 0);
    decorate(view);
    L.counts.paints++;
    return true;
  }

  function announce(text) {
    const now = performance.now();
    if (text === L.announced || now - L.announceAt < ANNOUNCE_GAP_MS) return;
    L.announced = text;
    L.announceAt = now;
    if (L.bridge) L.bridge.say(text);
  }

  function tideOf() {
    const v = L.view;
    if (!v || !v.align || !v.align.on || !Number.isFinite(v.align.at)) return null;
    return { atMs: v.align.at, newer: v.align.newer };
  }

  function modelNow() {
    const st = rt.status();
    const T = st.topics.fl || {};
    const readAtMs = Date.parse(T.readAt || "");
    const hub = T.synced && Number.isFinite(readAtMs) && Number.isFinite(T.at) && T.perf > 0 ? { atMs: T.at, readAtMs, perf: T.perf } : null;
    const mt = rt.measure().transitMs;
    const stats = L.ledger.engine() ? L.ledger.stats() : { held: null, seen: null };
    return {
      nowPerf: performance.now(), nowMs: nowMs(), mode: L.paused || !L.active ? "off" : st.transport, pollMs: st.pollMs, hidden: L.hidden, catching: L.catching,
      closed: st.closed ? { reason: st.closed.reason } : null, closedText: st.closed ? "market closed" : null, paused: L.paused,
      hub, serverReadAtMs: L.serverReadAt !== null ? L.serverReadAt : L.bridge ? L.bridge.serverReadAt() : null, lag: L.lag.summary(), transit: mt ? { n: mt.n, p50: mt.p50, p95: mt.p95 } : null,
      newestEndMs: L.ledger.engine() ? L.ledger.newestEnd() : null, held: stats.held, seen: L.ledger.engine() ? L.ledger.seenTotal() : null,
      pageOnly: L.pageOnly, parity: L.parity, drift: L.drift, tide: tideOf(),
      holdText: L.holdSel ? "held while you select text" : L.holdList ? "list held while you point at it" : null,
    };
  }

  function mountStrip() {
    if (L.strip) return;
    const title = document.querySelector(".sf-title");
    const info = $("sfInfoBtn");
    if (!title) return;
    const host = document.createElement("div");
    host.className = "lv";
    host.id = "sfLive";
    host.dataset.state = "pending";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lv-b";
    btn.setAttribute("aria-haspopup", "dialog");
    const dot = document.createElement("i");
    dot.setAttribute("aria-hidden", "true");
    const word = document.createElement("b");
    const val = document.createElement("span");
    val.className = "lv-v";
    const more = document.createElement("span");
    more.className = "lv-x";
    btn.append(dot, word, val, more);
    host.append(btn);
    title.insertBefore(host, info);
    L.strip = { host, btn, dot, word, val, more, tone: "", verdict: "" };
    btn.addEventListener("click", () => {
      const m = L.last || kit.stripModel(modelNow());
      const facts = m.chips.map((c) => [c.label, c.value]);
      const state = { live: "live", delayed: "fresh", stale: "stale", closed: "closed", pending: "pending" }[m.verdict.state];
      UI.openInfo(btn, { title: "Live ledger", state, lead: m.chips[0].title || m.chips[0].value, facts });
    });
  }

  function renderStrip() {
    if (!L.strip) return;
    const m = kit.stripModel(modelNow());
    L.last = m;
    const feed = m.chips[0];
    const lag = m.chips[2];
    const s = L.strip;
    if (s.host.dataset.state !== m.verdict.state) s.host.dataset.state = m.verdict.state;
    if (s.host.dataset.tone !== feed.tone) s.host.dataset.tone = feed.tone;
    setText(s.word, m.verdict.word);
    const caught = L.caughtAt !== null && nowMs() - L.caughtAt < 10000 && m.verdict.state !== "hidden" ? " · caught up " + kit.trtClock(L.caughtAt, { seconds: true }) : "";
    setText(s.val, feed.value + caught);
    setText(s.more, lag.value === "— no new windows yet" || lag.value.startsWith("—") ? "" : "Vendor to hub " + lag.value);
    const label = "Live ledger: " + m.verdict.word + ". Open for the latency details.";
    if (s.btn.getAttribute("aria-label") !== label) s.btn.setAttribute("aria-label", label);
    if (m.verdict.state !== L.announcedState) {
      L.announcedState = m.verdict.state;
      if (["live", "delayed", "stale", "paused", "closed"].includes(m.verdict.state)) announce("Live ledger: " + m.verdict.word + ". " + feed.value);
    }
    return m;
  }

  function slept() {
    const wall = Date.now();
    const mono = performance.now();
    const gap = L.lastWall === 0 ? 0 : (wall - L.lastWall) - (mono - L.lastMono);
    L.lastWall = wall;
    L.lastMono = mono;
    return gap > SLEEP_MS;
  }

  function armStrip() {
    clearTimeout(L.timers.strip);
    L.timers.strip = 0;
    if (L.hidden || !L.strip) return;
    if (L.active && slept()) { catchUp("resumed"); return; }
    const m = renderStrip();
    const wait = m && Number.isFinite(m.ageS) ? kit.nextTickMs(m.ageS) : 60000;
    L.timers.strip = setTimeout(armStrip, wait);
  }

  function disarm() {
    clearTimeout(L.timers.strip);
    clearTimeout(L.timers.verify);
    L.timers.strip = 0;
    L.timers.verify = 0;
  }

  function runVerify() {
    if (!L.ledger.engine()) return true;
    L.counts.verifies++;
    const r = L.ledger.verify();
    L.drift.runs++;
    L.drift.at = nowMs();
    if (r.ok) return true;
    L.drift.count += r.drift.length;
    L.drift.events++;
    if (L.drift.events >= DRIFT_PAUSE) {
      pause("The live books drifted from a full recompute.");
      return false;
    }
    L.ledger.engine().rebuild();
    L.drift.rebuiltAt = nowMs();
    L.viewKey = "";
    if (L.active) schedulePaint();
    renderStrip();
    return true;
  }

  function armVerify() {
    clearTimeout(L.timers.verify);
    L.timers.verify = 0;
    if (L.hidden || !L.active) return;
    L.timers.verify = setTimeout(() => { if (runVerify()) armVerify(); }, VERIFY_MS);
  }

  function dropRail() {
    for (const off of L.offs.splice(0)) off();
    if (L.handle) { L.handle.close(); L.handle = null; }
  }

  function pause(reason) {
    L.paused = "Live ledger paused. " + reason + " Showing the server ledger as of " + kit.trtClock(nowMs(), { seconds: true }) + ".";
    L.parity = { state: "mismatch", at: nowMs(), text: reason };
    L.active = false;
    dropRail();
    cancelAnimationFrame(L.raf);
    L.raf = 0;
    clearTimeout(L.timers.verify);
    L.timers.verify = 0;
    renderStrip();
    if (L.bridge) {
      L.bridge.setLive(false);
      Promise.resolve(L.bridge.server()).then(() => { if (L.paused) L.bridge.say(L.paused); });
    }
  }

  function standDown(why) {
    L.active = false;
    L.viewKey = "";
    clearTimeout(L.timers.verify);
    L.timers.verify = 0;
    if (L.bridge) L.bridge.setLive(false);
    if (why === "rail") dropRail();
    renderStrip();
    if (L.bridge) L.bridge.server();
  }

  function onFlow(change) {
    if (!L.ledger.engine() || L.paused) return;
    L.counts.frames++;
    if (change.snap) L.counts.snapshots++;
    if (change.reset) { reload("epoch"); return; }
    const fresh = change.fresh;
    const readAt = fresh && fresh.state !== "pending" ? Date.parse(fresh.readAt) : NaN;
    if (!Number.isFinite(readAt)) { renderStrip(); return; }
    const rows = change.rows || [];
    if (rows.length) {
      L.counts.rows += rows.length;
      L.ledger.put(rows, { at: readAt });
      if (!change.snap) for (const r of rows) if (Number.isFinite(r.ts) && readAt >= r.ts) L.lag.add(readAt - r.ts);
    }
    L.ledger.setRead(readAt);
    L.ledger.settle();
    if (L.hidden) { L.dirty = true; return; }
    if (L.active) schedulePaint();
    armStrip();
  }

  function schedulePaint() {
    if (L.raf) return;
    L.raf = requestAnimationFrame(() => {
      L.raf = 0;
      if (!L.hidden) paintNow();
    });
  }

  function onTransport(ev) {
    if (ev && ev.mode === "off" && L.active) standDown("rail");
  }

  function ensureRail() {
    if (L.handle || L.paused) return;
    L.handle = rt.connect({ topics: ["fl"], primary: ["fl"] });
    if (!L.handle) return;
    L.offs.push(L.handle.on("fl", onFlow), L.handle.on("transport", onTransport));
  }

  function process(base) {
    L.counts.bases++;
    L.skew = Number.isFinite(base.serverNow) ? base.serverNow - Date.now() : L.skew;
    L.serverReadAt = base.readAt;
    L.base = base;
    const parity = kit.baseParity(base);
    if (!parity.ok) { pause("This browser built a different ledger than the server."); return false; }
    const bad = L.ledger.deltaCheck(base);
    if (bad.length) { pause("This browser computed a different delta for " + bad.length + (bad.length === 1 ? " window" : " windows") + " than the server."); return false; }
    L.ledger.applyBase(base);
    const keys = new Set(base.rows.map((r) => r.t + "|" + r.oc + "|" + r.spanStart));
    let only = 0;
    for (const r of L.ledger.engine().heldRows()) if (!keys.has(r.t + "|" + r.oc + "|" + r.spanStart)) only++;
    L.pageOnly = only;
    L.parity = { state: "ok", at: nowMs(), text: null };
    if (!runVerify()) return false;
    L.active = true;
    L.bridge.setLive(true);
    ensureRail();
    armVerify();
    armStrip();
    return true;
  }

  function fetchBase(reason) {
    if (L.inflight) return L.inflight;
    const v = L.bridge ? L.bridge.updated() : null;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const guard = setTimeout(() => { if (ctrl) ctrl.abort(); }, FETCH_MS);
    L.inflight = fetch("/api/flows/ledger?part=book" + (v ? "&v=" + v : ""), {
      credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined,
    }).then((res) => {
      if (res.status === 401) { location.replace("/flows/"); return null; }
      if (res.status === 404) { standDown("off"); return null; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then((base) => {
      if (!base) return false;
      if (base.status !== "ok") { standDown("period"); return false; }
      return process(base);
    }).catch(() => {
      L.counts.fetchFails++;
      renderStrip();
      return false;
    }).then((r) => {
      clearTimeout(guard);
      L.inflight = null;
      return r;
    });
    return L.inflight;
  }

  function reload(reason) {
    return fetchBase(reason).then((ok) => {
      if (ok) paintNow();
      renderStrip();
      return ok;
    });
  }

  function catchUp(why) {
    if (L.catching || L.paused || !L.bridge) return Promise.resolve(false);
    L.dirty = false;
    L.catching = true;
    renderStrip();
    return reload(why).then((ok) => {
      L.catching = false;
      L.caughtAt = nowMs();
      armStrip();
      armVerify();
      return ok;
    });
  }

  function onVisibility() {
    const was = L.hidden;
    L.hidden = document.hidden;
    if (L.hidden && !was) {
      L.hiddenAt = Date.now();
      disarm();
      return;
    }
    if (!L.hidden && was) {
      const away = Date.now() - L.hiddenAt;
      if (!L.active || away < HIDDEN_REFETCH_MS) {
        if (L.active && L.dirty) { L.dirty = false; paintNow(); }
        armStrip();
        armVerify();
        return;
      }
      catchUp("returned");
    }
  }

  function onPageShow(e) {
    if (e && e.persisted && L.active) catchUp("restored");
  }

  function onSelection() {
    if (L.holdSel && !selecting()) {
      L.holdSel = false;
      L.viewKey = "";
      schedulePaint();
      renderStrip();
    }
  }

  function releaseList() {
    if (!L.holdList) return;
    const host = $("sfBody");
    if (host && interacting(host)) return;
    L.holdList = false;
    L.viewKey = "";
    schedulePaint();
    renderStrip();
  }

  function beat(e) {
    if (!L.active || !e || !e.fresh) return;
    for (const k of Object.keys(e.fresh)) if (e.fresh[k]) UI.freshness({ ff: e.fresh[k], source: k, role: "secondary" });
  }

  function status() {
    const e = L.ledger.engine();
    return {
      active: L.active, paused: L.paused, hidden: L.hidden, painting: L.raf !== 0, hold: L.holdSel ? "selection" : L.holdList ? "list" : null, counts: { ...L.counts }, drift: { ...L.drift }, parity: { ...L.parity },
      held: e ? e.stats() : null, fingerprint: e ? L.ledger.fingerprint() : null, pageOnly: L.pageOnly, lag: L.lag.summary(),
      timers: (L.timers.strip ? 1 : 0) + (L.timers.verify ? 1 : 0), verdict: L.last ? L.last.verdict.state : null,
      chips: L.last ? L.last.chips.map((c) => [c.id, c.tone, c.value]) : null,
    };
  }

  function attach(bridge) {
    if (L.bridge) return;
    L.bridge = bridge;
    loadCss();
    mountStrip();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("selectionchange", onSelection);
    const side = $("sfBody");
    if (side) {
      side.addEventListener("pointerleave", releaseList);
      side.addEventListener("focusout", () => setTimeout(releaseList, 0));
    }
    renderStrip();
    reload("start");
    armStrip();
  }

  const api = {
    attach, morph, active: (period) => L.active && !L.paused && (period === null || period === "intraday"),
    repaint: () => { L.viewKey = ""; return paintNow(); }, reload, beat, status,
    verify: () => runVerify(), hold: () => L.ledger.engine(), strip: () => { renderStrip(); return L.last; },
  };

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ledgerLive: Object.freeze(api) }));
})();
