(() => {
  "use strict";

  const UI = window.FlowsUI;
  const root = document.getElementById("stMain");
  if (!UI || !root) return;
  const { h } = UI;
  const DASH = UI.DASH;
  const host = {
    meta: document.getElementById("stMeta"),
    ready: document.getElementById("stReady"),
    note: document.getElementById("stNote"),
    rail: document.getElementById("stRail"),
    night: document.getElementById("stNight"),
    ai: document.getElementById("stAi"),
    again: document.getElementById("stAgain"),
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const TRT_MS = 3 * 36e5;
  const pad = (k) => (k < 10 ? "0" : "") + k;

  const num = (v) => {
    if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const whole = (v) => (num(v) === null ? DASH : Math.round(num(v)).toLocaleString("en-US"));
  const clock = (ms) => {
    const t = new Date(ms + TRT_MS);
    return pad(t.getUTCHours()) + ":" + pad(t.getUTCMinutes()) + " TRT";
  };
  const trt = (value, now) => {
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(ms)) return DASH;
    const t = new Date(ms + TRT_MS), n = new Date(now + TRT_MS);
    const same = t.getUTCFullYear() === n.getUTCFullYear() && t.getUTCMonth() === n.getUTCMonth() && t.getUTCDate() === n.getUTCDate();
    return (same ? "" : t.getUTCDate() + " " + MONTHS[t.getUTCMonth()] + ", ") + clock(ms);
  };
  const span = (ms) => {
    const x = num(ms);
    if (x === null) return DASH;
    if (x < 1000) return Math.round(x) + " ms";
    if (x < 6e4) return (x / 1000).toFixed(1) + " s";
    if (x < 36e5) return Math.round(x / 6e4) + " min";
    return (x / 36e5).toFixed(1) + " h";
  };
  const ago = (ms, now) => (Number.isFinite(ms) ? span(Math.max(0, now - ms)) + " ago" : DASH);

  const table = (label, heads, rows) => {
    const body = h("tbody");
    for (const r of rows) {
      body.appendChild(h("tr", null, ...r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", null, c)))));
    }
    return h("div", { class: "ui-tbl-w st-tbl", tabindex: "0", role: "region", "aria-label": label },
      h("table", { class: "ui-tbl-t" }, h("thead", null, h("tr", null, ...heads.map((t, i) => h("th", { scope: "col", class: i ? "" : "st-l" }, t)))), body));
  };
  const facts = (pairs) => h("dl", { class: "st-kv" }, ...pairs.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
  const why = (items) => (items.length ? h("ul", { class: "st-why" }, ...items.map((t) => h("li", null, t))) : null);
  const fill = (el, ...kids) => { el.replaceChildren(...kids.filter(Boolean)); };

  const read = async (path) => {
    try {
      const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.ok) return { ok: true, body };
      const code = body && body.error && body.error.code ? body.error.code : "http_" + res.status;
      return { ok: false, reason: "HTTP " + res.status + " " + code };
    } catch {
      return { ok: false, reason: "the request did not complete" };
    }
  };

  const unread = (el, what, reason) => {
    fill(el, h("p", { class: "st-miss" }, DASH + " " + what + " was not read: " + reason + ". Nothing is claimed about it."));
    return false;
  };

  function paintRail(r, now) {
    if (!r.ok) return unread(host.rail, "The real-time rail", r.reason);
    const s = r.body || {};
    const sockets = s.sockets || {};
    const calls = s.calls || {};
    const sw = s.killSwitches || {};
    const gaps = [];
    const deg = s.degraded;
    const up = s.upstream || {};
    const topics = s.topics && typeof s.topics === "object" ? s.topics : {};
    const rows = Object.keys(topics).map((k) => {
      const t = topics[k] || {};
      const lag = t.lagMs || {};
      const c = t.calls || {};
      const age = num(t.lastFrameAgeMs);
      if (age === null) gaps.push(k + ": no frame yet in this epoch");
      if (!t.demanded) gaps.push(k + ": not demanded, so not polled");
      return [k, t.demanded ? "yes" : "no", age === null ? DASH : span(age) + " ago", span(lag.p50), span(lag.p95),
        whole(c.minute), whole(c.hour), whole(t.fails), t.fresh && t.fresh.state ? String(t.fresh.state) : DASH];
    });
    fill(host.rail,
      facts([
        ["Rail", s.running ? "running" : "idle, no viewer"],
        ["Mode", sw.FLOWS_RT_MODE ? String(sw.FLOWS_RT_MODE) : DASH],
        ["Audience", sw.FLOWS_RT_AUDIENCE ? String(sw.FLOWS_RT_AUDIENCE) : DASH],
        ["Upstream", up.kind ? String(up.kind) : DASH],
        ["Phase", s.phase ? s.phase.phase + (s.phase.trading ? ", trading day" : ", not a trading day") : DASH],
        ["Started", s.startedAt ? trt(s.startedAt, now) : DASH],
        ["Sockets", whole(sockets.n) + " of " + whole(sockets.max) + " (" + whole(sockets.userCap) + " a member)"],
        ["Vendor calls, this minute", whole(calls.minuteTotal) + " of " + whole(calls.perMinute) + " a minute"],
        ["Degraded", deg ? "since " + trt(deg.since, now) + ", " + String(deg.reason) + ", " + (deg.k || []).join(" ") : "no"],
      ]),
      table("Rail topics", ["Topic", "Demanded", "Last frame", "Lag p50", "Lag p95", "Calls, minute", "Calls, hour", "Failures", "Freshness"], rows),
      why(gaps));
    return true;
  }

  function paintNight(r, now) {
    if (!r.ok) return unread(host.night, "The nightly record", r.reason);
    const m = r.body || {};
    if (!m.generatedAt) return unread(host.night, "The nightly record", "no run has been published yet");
    const hl = m.health || null;
    const stages = Array.isArray(m.stages) ? m.stages : [];
    const gaps = [];
    if (!hl) gaps.push("health: this run's record carries no health line");
    if (!stages.length) gaps.push("stages: this run's record carries no stage ledger");
    const rows = stages.map((st) => [String(st.id), String(st.status), span(st.ms), whole(st.calls), whole(st.keys), st.why ? String(st.why) : DASH]);
    fill(host.night,
      facts([
        ["Written", trt(m.generatedAt, now) + " (" + ago(Date.parse(m.generatedAt), now) + ")"],
        ["Session", m.sessionDate ? String(m.sessionDate) : DASH],
        ["Universe", whole(m.universe) + " names"],
        ["Cards", whole(m.cardsBuilt) + " built, " + whole(m.cardsFailed) + " failed, " + whole(m.cardsSkipped) + " skipped"],
        ["Vendor calls", whole(m.apiCalls)],
        ["Health", hl ? whole(hl.failures) + " failures, " + whole(hl.warnings) + " warnings" : DASH],
      ]),
      hl && Array.isArray(hl.first) && hl.first.length ? h("ul", { class: "st-lines" }, ...hl.first.map((t) => h("li", null, String(t)))) : null,
      stages.length ? table("Nightly stages", ["Stage", "Status", "Time", "Calls", "Keys", "Why"], rows) : null,
      why(gaps));
    return true;
  }

  function paintAi(r, now) {
    if (!r.ok) return unread(host.ai, "The model spend", r.reason);
    const s = r.body && r.body.spend;
    if (!s) return unread(host.ai, "The model spend", "the store could not be read");
    const gaps = [];
    if (num(s.neurons) === null) gaps.push("neurons: a model on the day has no configured rate, so the total is not worked");
    for (const m of Array.isArray(s.byModel) ? s.byModel : []) {
      if (num(m.neurons) === null) gaps.push(String(m.model) + ": no configured rate, so its neurons are not worked");
    }
    const rows = (Array.isArray(s.byModel) ? s.byModel : []).map((m) => [String(m.model), whole(m.calls), whole(m.tokensIn), whole(m.tokensOut),
      num(m.neurons) === null ? DASH : whole(m.neurons)]);
    fill(host.ai,
      facts([
        ["Model day", String(s.day || DASH) + ", turns over at 03:00 TRT"],
        ["Calls", whole(s.calls)],
        ["Tokens in and out", whole(s.tokensIn) + " in, " + whole(s.tokensOut) + " out"],
        ["Neurons", num(s.neurons) === null ? DASH : whole(s.neurons) + " of " + whole(s.allowanceNeurons) + " free a day"],
        ["Remaining", num(s.remaining) === null ? DASH : whole(s.remaining) + " neurons"],
      ]),
      rows.length ? table("Spend by model", ["Model", "Calls", "Tokens in", "Tokens out", "Neurons"], rows) : null,
      why(gaps));
    return true;
  }

  function paintReady(r) {
    if (!host.ready) return true;
    if (!r.ok || !r.body || typeof r.body !== "object") {
      host.ready.textContent = "Readiness: " + DASH + " (" + (r.reason || "not read") + ").";
      return false;
    }
    const b = r.body;
    const opens = b.opens && Number.isFinite(b.opens.ms) ? b.opens.ms : null;
    const list = Array.isArray(b.blockers) ? b.blockers : [];
    const head = b.ok ? "Ready" : list.length + (list.length === 1 ? " blocker" : " blockers");
    const tail = opens === null ? "" : b.phase === "rth" ? ". US session open" : ". US open " + trt(opens, Date.now()) +
      (num(b.minutesToOpen) === null ? "" : ", in " + whole(b.minutesToOpen) + " min");
    host.ready.replaceChildren(h("strong", null, "Readiness: "), document.createTextNode(head + tail + "."),
      ...(list.length ? [h("ul", { class: "st-why" }, ...list.map((x) => h("li", null, String(x && x.sentence || x && x.code || DASH))))] : []));
    return true;
  }

  async function load() {
    host.again.disabled = true;
    host.note.textContent = "Reading the status…";
    const [rail, night, ai, ready] = await Promise.all([read("/api/rt/status"), read("/api/flows/meta"), read("/api/flows/ai-usage"), read("/api/flows/ready")]);
    paintReady(ready);
    const now = Date.now();
    const bad = [paintRail(rail, now), paintNight(night, now), paintAi(ai, now)].filter((x) => !x).length;
    host.meta.textContent = "Read at " + clock(now) + ". The page reads three existing routes and calls no vendor and no model.";
    host.note.textContent = bad ? bad + " of 3 sources could not be read." : "All three sources read.";
    host.again.disabled = false;
  }

  host.again.addEventListener("click", load);
  load();
})();
